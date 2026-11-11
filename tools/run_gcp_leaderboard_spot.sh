#!/usr/bin/env bash
set -euo pipefail

export CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity"

PROJECT="hemanth-hm"
REPO_ROOT="/Users/lika/labs/swanada"
VM_NAME="swanada-l4-spot-lb-$(date +%s)"
SELECTED_ZONE=""
UPLOAD_TAR="/tmp/${VM_NAME}_input.tar.gz"
DOWNLOAD_TAR="/tmp/${VM_NAME}_output.tar.gz"
REMOTE_SCRIPT="/tmp/${VM_NAME}_remote_job.sh"
SA_RASA_LOCAL="/Users/lika/labs/ninada/data/wavs/sa_rasa_male_01445fb1731b.wav"

cleanup() {
  rm -f "${UPLOAD_TAR}" "${DOWNLOAD_TAR}" "${REMOTE_SCRIPT}" "${REPO_ROOT}/_gcp_sanity_sa_rasa.wav"
  if [[ -n "${SELECTED_ZONE}" ]]; then
    echo "[cleanup] Deleting ephemeral Spot GPU VM ${VM_NAME} in ${SELECTED_ZONE}..."
    CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity" \
      gcloud compute instances delete "${VM_NAME}" \
      --project="${PROJECT}" \
      --zone="${SELECTED_ZONE}" \
      --quiet || true
  fi
}
trap cleanup EXIT INT TERM

echo "[1/6] Packing lightweight workspace archive (Studio + Mobile encoders fetched at 10 Gbps on GCP)..."
cd "${REPO_ROOT}"
EXTRA_UPLOAD=()
if [[ -f "${SA_RASA_LOCAL}" ]]; then
  cp -f "${SA_RASA_LOCAL}" "${REPO_ROOT}/_gcp_sanity_sa_rasa.wav"
  EXTRA_UPLOAD+=("_gcp_sanity_sa_rasa.wav")
fi

COPYFILE_DISABLE=1 tar --no-xattrs -czf "${UPLOAD_TAR}" \
  tools/gcp_joint_12lang_train.py \
  tools/gcp_distill_mobile_25mb.py \
  tools/gcp_leaderboard_distill_all.py \
  bench/benchmark_accuracy.py \
  bench/eval_slang_and_accents.py \
  bench/test_speech_suite.jsonl \
  docs/samples \
  docs/heads \
  docs/heads_mobile \
  models/preprocessor.onnx \
  models/vocabularies \
  python \
  "${EXTRA_UPLOAD[@]}"
rm -f "${REPO_ROOT}/_gcp_sanity_sa_rasa.wav"
ls -lh "${UPLOAD_TAR}"

HF_TOK_VAL=$(.venv/bin/python -c "import sys; sys.path.insert(0, 'tools'); from publish_to_hf import resolve_auth_token; print(resolve_auth_token() or '')" 2>/dev/null || true)

cat > "${REMOTE_SCRIPT}" << 'REMOTEEOF'
#!/usr/bin/env bash
set -euo pipefail
trap 'RC=$?; echo "${RC}" > /tmp/swanada_job.rc' EXIT

if [[ -f /tmp/swanada_hf_tok ]]; then
  export HF_TOKEN="$(cat /tmp/swanada_hf_tok)"
  rm -f /tmp/swanada_hf_tok
fi

mkdir -p /tmp/swanada_work/models/onnx /tmp/swanada_work/models/onnx_mobile
cd /tmp/swanada_work
tar -xzf /tmp/swanada_input.tar.gz 2>/dev/null || tar -xzf /tmp/swanada_input.tar.gz
rm -f /tmp/swanada_input.tar.gz

python3 -m pip install -q --upgrade onnx onnxruntime-gpu pyarrow soundfile scipy huggingface_hub pyyaml

echo "[remote] Fetching converged Studio + Mobile base encoders from Hugging Face at 10 Gbps..."
curl -sSL --retry 4 -o /tmp/swanada_work/models/onnx/sushrota_sanskrit_ctc_int8.onnx \
  "https://huggingface.co/gnumanth/swanada/resolve/main/onnx/sushrota_sanskrit_ctc_int8.onnx"
curl -sSL --retry 4 -o /tmp/swanada_work/models/onnx_mobile/swanada_mobile_ctc_int8.onnx \
  "https://huggingface.co/gnumanth/swanada/resolve/main/onnx_mobile/swanada_mobile_ctc_int8.onnx"
ls -lh /tmp/swanada_work/models/onnx/sushrota_sanskrit_ctc_int8.onnx /tmp/swanada_work/models/onnx_mobile/swanada_mobile_ctc_int8.onnx

export PYTHONUNBUFFERED=1
export PYTHONPATH="/tmp/swanada_work/python/src:/tmp/swanada_work/tools:${PYTHONPATH:-}"

GCS_CKPT_PREFIX="gs://training-gemina/swanada_lb_ckpt_v111"

echo "=== STAGE 1: ZERO-LEAKAGE 12-LANG CORPUS + 12 SPECIALIST FP32 TEACHERS (NEMO EN + 10 INDIC + SA) ==="
if CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity" \
  gcloud storage ls "${GCS_CKPT_PREFIX}/lang_or.pt" >/dev/null 2>&1; then
  echo "[remote] All 12 Stage-1 shards already ready in ${GCS_CKPT_PREFIX}; streaming directly into Stage 2A!"
else
  python3 tools/gcp_leaderboard_distill_all.py \
    --work-dir /tmp/swanada_work \
    --stage prepare \
    --indic-target-clips 2900 \
    --en-target-clips 15500 \
    --gcs-ckpt-prefix "${GCS_CKPT_PREFIX}"
fi

echo "=== STAGE 2A: STUDIO 17-LAYER CONFORMER-LARGE DISTILLATION + QINT8 HEAD CALIBRATION ==="
if CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity" \
  gcloud storage cp --quiet "${GCS_CKPT_PREFIX}/studio_done.tar.gz" /tmp/studio_done.tar.gz 2>/dev/null; then
  echo "[remote] Restored already-completed Stage-2A Studio archive in 5s; proceeding directly to Stage 2B + Stage 3!"
  tar -xzf /tmp/studio_done.tar.gz -C /tmp/swanada_work
  rm -f /tmp/studio_done.tar.gz
else
  python3 tools/gcp_leaderboard_distill_all.py \
    --work-dir /tmp/swanada_work \
    --stage train-studio \
    --studio-epochs 10 \
    --studio-batch-size 32 \
    --studio-encoder-lr 1.0e-4 \
    --studio-head-lr 2.5e-4 \
    --gcs-ckpt-prefix "${GCS_CKPT_PREFIX}"
fi

echo "=== STAGE 2B + STAGE 3: <30 MiB MOBILE CONFORMER + 12-WAY NEURAL AUTO-LID HEADS (lid.bin, SLID v1) ==="
python3 tools/gcp_leaderboard_distill_all.py \
  --work-dir /tmp/swanada_work \
  --stage mobile-and-lid \
  --mobile-epochs 8 \
  --mobile-batch-size 56 \
  --mobile-encoder-lr 9.0e-4 \
  --gcs-ckpt-prefix "${GCS_CKPT_PREFIX}"

echo "=== PACKING STUDIO (~177.4 MiB) + MOBILE (<30 MiB) SHARED ENCODERS & ALL 24 HEADS ==="
tar -czf /tmp/swanada_output.tar.gz \
  models/onnx/sushrota_sanskrit_ctc_int8.onnx \
  models/onnx/heads \
  docs/heads \
  models/onnx_mobile/swanada_mobile_ctc_int8.onnx \
  models/onnx_mobile/heads \
  docs/heads_mobile
ls -lh /tmp/swanada_output.tar.gz
CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity" \
  gcloud storage cp --quiet /tmp/swanada_output.tar.gz "${GCS_CKPT_PREFIX}/final_output.tar.gz" || true
REMOTEEOF

ZONES=(
  "us-central1-a" "us-central1-b" "us-central1-c"
  "us-east1-b" "us-east1-c" "us-east1-d"
  "us-east4-a" "us-east4-c"
  "us-west1-a" "us-west1-b" "us-west1-c"
  "us-west4-a" "us-west4-c"
  "northamerica-northeast1-c" "northamerica-northeast2-a" "northamerica-northeast2-b"
  "europe-west4-b" "europe-west4-a" "europe-west4-c"
  "europe-west1-b" "europe-west1-c"
  "europe-west2-a" "europe-west2-b"
  "europe-west3-a" "europe-west3-b"
  "europe-west6-b" "europe-west6-c"
  "asia-northeast1-b" "asia-northeast1-a" "asia-northeast1-c"
  "asia-southeast1-b" "asia-southeast1-a" "asia-southeast1-c"
  "asia-east1-b" "asia-east1-c" "asia-east1-a"
)
MACHINE_TYPES=("g2-standard-12" "g2-standard-16" "g2-standard-8")

PIPELINE_DONE=0
for spot_attempt in $(seq 1 12); do
  VM_NAME="swanada-l4-spot-lb-$(date +%s)"
  SELECTED_ZONE=""
  echo "[2/6] (Spot Attempt ${spot_attempt}/12) Provisioning SPOT-ONLY NVIDIA L4 GPU VM (${VM_NAME}) on GCP (${PROJECT})..."

  for mtype in "${MACHINE_TYPES[@]}"; do
    for z in "${ZONES[@]}"; do
      echo "  Trying SPOT ${mtype} (1x L4) in ${z}..."
      if CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity" \
        gcloud compute instances create "${VM_NAME}" \
          --project="${PROJECT}" \
          --zone="${z}" \
          --machine-type="${mtype}" \
          --accelerator="type=nvidia-l4,count=1" \
          --maintenance-policy="TERMINATE" \
          --provisioning-model="SPOT" \
          --instance-termination-action="DELETE" \
          --max-run-duration="18000s" \
          --scopes="https://www.googleapis.com/auth/devstorage.read_write" \
          --image-family="pytorch-2-9-cu129-ubuntu-2204-nvidia-580" \
          --image-project="deeplearning-platform-release" \
          --boot-disk-size="200GB" \
          --boot-disk-type="pd-ssd" \
          --quiet 2>/tmp/swanada_gcloud_create.err; then
        SELECTED_ZONE="${z}"
        echo "  Provisioned SPOT ${VM_NAME} (${mtype}, 1x L4) in ${SELECTED_ZONE}!"
        break 2
      fi
    done
  done
  rm -f /tmp/swanada_gcloud_create.err

  if [[ -z "${SELECTED_ZONE}" ]]; then
    echo "ERROR: Could not allocate SPOT L4 GPU across candidate global zones." >&2
    exit 1
  fi

  echo "[3/6] Waiting for SSH readiness on ${VM_NAME}..."
  SSH_READY=0
  for attempt in $(seq 1 30); do
    if CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity" \
      gcloud compute ssh "${VM_NAME}" --project="${PROJECT}" --zone="${SELECTED_ZONE}" --quiet \
        --ssh-flag="-o ServerAliveInterval=15" \
        --command="nvidia-smi --query-gpu=name,memory.total --format=csv,noheader && free -h | head -n 2" 2>/dev/null; then
      SSH_READY=1
      break
    fi
    sleep 6
  done
  if [[ "${SSH_READY}" != "1" ]]; then
    echo "[monitor] Spot VM ${VM_NAME} did not reach SSH readiness; rotating zone..."
    CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity" \
      gcloud compute instances delete "${VM_NAME}" --project="${PROJECT}" --zone="${SELECTED_ZONE}" --quiet 2>/dev/null || true
    SELECTED_ZONE=""
    continue
  fi

  echo "[4/6] Uploading workspace archive & detached runner to ${VM_NAME}..."
  if [[ -n "${HF_TOK_VAL}" ]]; then
    (umask 077 && printf "%s" "${HF_TOK_VAL}" > "/tmp/${VM_NAME}_hf_tok")
    CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity" \
      gcloud compute scp "/tmp/${VM_NAME}_hf_tok" "${VM_NAME}:/tmp/swanada_hf_tok" \
      --project="${PROJECT}" --zone="${SELECTED_ZONE}" --quiet || true
    rm -f "/tmp/${VM_NAME}_hf_tok"
  fi
  CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity" \
    gcloud compute scp "${UPLOAD_TAR}" "${VM_NAME}:/tmp/swanada_input.tar.gz" \
    --project="${PROJECT}" --zone="${SELECTED_ZONE}" --quiet
  CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity" \
    gcloud compute scp "${REMOTE_SCRIPT}" "${VM_NAME}:/tmp/remote_job.sh" \
    --project="${PROJECT}" --zone="${SELECTED_ZONE}" --quiet

  echo "[5/6] Launching detached daemon Spot GPU job & streaming logs..."
  CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity" \
    gcloud compute ssh "${VM_NAME}" --project="${PROJECT}" --zone="${SELECTED_ZONE}" --quiet \
      --ssh-flag="-o ServerAliveInterval=15" \
      --command='
cat > /tmp/poll_log.sh << "POLLEOF"
#!/usr/bin/env bash
START_AFTER="${1:-0}"
TOTAL=$(wc -l < /tmp/swanada_job.log 2>/dev/null || echo 0)
if [[ "${TOTAL}" -gt "${START_AFTER}" ]]; then
  NEXT=$((START_AFTER + 1))
  sed -n "${NEXT},${TOTAL}p" /tmp/swanada_job.log
fi
echo "__SWANADA_CURSOR__:${TOTAL}"
if [[ -f /tmp/swanada_job.rc ]]; then
  echo "__SWANADA_RC__:$(cat /tmp/swanada_job.rc)"
fi
POLLEOF
chmod +x /tmp/poll_log.sh /tmp/remote_job.sh
rm -f /tmp/swanada_job.rc /tmp/swanada_job.log
python3 -c "import subprocess; p = subprocess.Popen([\"/tmp/remote_job.sh\"], stdin=subprocess.DEVNULL, stdout=open(\"/tmp/swanada_job.log\", \"w\"), stderr=subprocess.STDOUT, start_new_session=True, close_fds=True); print(\"Started detached PID\", p.pid)"
'

  LAST_LINE=0
  FAIL_STREAK=0
  PREEMPTED=0
  while true; do
    STATUS_OUT=$(CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity" \
      gcloud compute ssh "${VM_NAME}" --project="${PROJECT}" --zone="${SELECTED_ZONE}" --quiet \
        --ssh-flag="-o ServerAliveInterval=15 -o ConnectTimeout=20" \
        --command="bash /tmp/poll_log.sh ${LAST_LINE}" 2>/dev/null) || {
      FAIL_STREAK=$((FAIL_STREAK + 1))
      echo "[monitor] Transient SSH poll retry (${FAIL_STREAK}/6)..."
      if [[ ${FAIL_STREAK} -ge 6 ]]; then
        echo "[monitor] Spot preemption detected on ${VM_NAME} (${SELECTED_ZONE})! Rotating zone and auto-resuming from GCS checkpoint..."
        PREEMPTED=1
        break
      fi
      sleep 10
      continue
    }
    FAIL_STREAK=0

    printf "%s\n" "${STATUS_OUT}" | grep -v "^__SWANADA_CURSOR__:" | grep -v "^__SWANADA_RC__:" || true

    NEW_CURSOR=$(printf "%s\n" "${STATUS_OUT}" | sed -n 's/^__SWANADA_CURSOR__://p' | tail -n 1)
    if [[ -n "${NEW_CURSOR}" ]]; then
      LAST_LINE="${NEW_CURSOR}"
    fi

    JOB_RC=$(printf "%s\n" "${STATUS_OUT}" | sed -n 's/^__SWANADA_RC__://p' | tail -n 1)
    if [[ -n "${JOB_RC}" ]]; then
      echo "[monitor] Remote Spot GPU pipeline finished with exit code ${JOB_RC}."
      if [[ "${JOB_RC}" != "0" ]]; then
        exit "${JOB_RC}"
      fi
      PIPELINE_DONE=1
      break
    fi
    sleep 15
  done

  if [[ "${PIPELINE_DONE}" == "1" ]]; then
    break
  fi

  # Clean up preempted VM (if still visible) and rotate SELECTED_ZONE to the end of ZONES
  OLD_ZONE="${SELECTED_ZONE}"
  CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity" \
    gcloud compute instances delete "${VM_NAME}" --project="${PROJECT}" --zone="${OLD_ZONE}" --quiet 2>/dev/null || true
  SELECTED_ZONE=""
  NEW_ZONES=()
  for z in "${ZONES[@]}"; do
    if [[ "${z}" != "${OLD_ZONE}" ]]; then
      NEW_ZONES+=("${z}")
    fi
  done
  NEW_ZONES+=("${OLD_ZONE}")
  ZONES=("${NEW_ZONES[@]}")
done

if [[ "${PIPELINE_DONE}" != "1" ]]; then
  echo "ERROR: Pipeline did not complete after 12 Spot attempts." >&2
  exit 1
fi

echo "[6/6] Downloading Studio + Mobile Shared Encoders and All 24 Calibrated Heads..."
SCP_OK=0
if CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity" \
  gcloud storage cp --quiet "gs://training-gemina/swanada_lb_ckpt_v111/final_output.tar.gz" "${DOWNLOAD_TAR}"; then
  SCP_OK=1
fi
if [[ "${SCP_OK}" != "1" ]]; then
  for attempt in $(seq 1 12); do
    if CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity" \
      gcloud compute scp "${VM_NAME}:/tmp/swanada_output.tar.gz" "${DOWNLOAD_TAR}" \
      --project="${PROJECT}" --zone="${SELECTED_ZONE}" --quiet; then
      SCP_OK=1
      break
    fi
    echo "[scp] Retry ${attempt}/12 after transient network timeout..."
    sleep 10
  done
fi
if [[ "${SCP_OK}" != "1" ]]; then
  echo "ERROR: Failed to download final output archive." >&2
  exit 1
fi

cd "${REPO_ROOT}"
tar -xzf "${DOWNLOAD_TAR}"

echo "Splicing local monolithic Studio (models/onnx/swanada_<lang>_ctc_int8.onnx) & Mobile (models/onnx_mobile/swanada_mobile_<lang>_ctc_int8.onnx) files..."
.venv/bin/python - << 'PYEOF'
import copy
from pathlib import Path
import numpy as np
import onnx
from onnx import numpy_helper

root = Path("/Users/lika/labs/swanada")
langs = ["sa", "en", "hi", "kn", "mr", "bn", "ta", "te", "ml", "gu", "pa", "or"]

for tier_base, heads_dir, out_dir, prefix in [
    (root / "models" / "onnx" / "sushrota_sanskrit_ctc_int8.onnx", root / "docs" / "heads", root / "models" / "onnx", "swanada_"),
    (root / "models" / "onnx_mobile" / "swanada_mobile_ctc_int8.onnx", root / "docs" / "heads_mobile", root / "models" / "onnx_mobile", "swanada_mobile_"),
]:
    base = onnx.load(str(tier_base))
    for lang in langs:
        raw = (heads_dir / f"{lang}.bin").read_bytes()
        assert len(raw) == (257 * 512 + 257) * 4
        w = np.frombuffer(raw[: 257 * 512 * 4], dtype="<f4").reshape(257, 512, 1).copy()
        b = np.frombuffer(raw[257 * 512 * 4 :], dtype="<f4").copy()
        m = copy.deepcopy(base)
        for idx, init in enumerate(m.graph.initializer):
            if init.name == "ctc.weight":
                m.graph.initializer[idx].CopyFrom(numpy_helper.from_array(w, name="ctc.weight"))
            elif init.name == "ctc.bias":
                m.graph.initializer[idx].CopyFrom(numpy_helper.from_array(b, name="ctc.bias"))
        out_p = out_dir / f"{prefix}{lang}_ctc_int8.onnx"
        onnx.save(m, str(out_p))
        print(f"  Spliced {out_p.relative_to(root)}")
    lid_p = heads_dir / "lid.bin"
    assert lid_p.exists() and lid_p.stat().st_size == 405324, f"Missing or invalid {lid_p}"
    print(f"  Verified {lid_p.relative_to(root)} (405,324 bytes SLID v1)")
PYEOF

echo "=== ALL SPOT L4 STUDIO + MOBILE LEADERBOARD DISTILLATION COMPLETE ==="
