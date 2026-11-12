#!/usr/bin/env bash
set -euo pipefail

export CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity"

PROJECT="hemanth-hm"
REPO_ROOT="/Users/lika/labs/swanada"
VM_NAME="swanada-spot-indic2-$(date +%s)"
SELECTED_ZONE=""
UPLOAD_TAR="/tmp/${VM_NAME}_input.tar.gz"
DOWNLOAD_TAR="/tmp/${VM_NAME}_output.tar.gz"
REMOTE_SCRIPT="/tmp/${VM_NAME}_remote_job.sh"
GCS_CKPT_DIR="gs://training-gemina/swanada_indic_adapters_v2"

cleanup() {
  rm -f "${UPLOAD_TAR}" "${DOWNLOAD_TAR}" "${REMOTE_SCRIPT}"
  if [[ -n "${SELECTED_ZONE}" ]]; then
    echo "[cleanup] Deleting ephemeral Spot worker VM ${VM_NAME} in ${SELECTED_ZONE}..."
    CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity" \
      gcloud compute instances delete "${VM_NAME}" \
      --project="${PROJECT}" \
      --zone="${SELECTED_ZONE}" \
      --quiet || true
  fi
}
trap cleanup EXIT INT TERM

echo "[1/6] Packing lightweight workspace archive (<25 MB; frozen encoders & shards fetched at 10 Gbps on GCP)..."
cd "${REPO_ROOT}"
COPYFILE_DISABLE=1 tar --no-xattrs -czf "${UPLOAD_TAR}" \
  tools/gcp_joint_12lang_train.py \
  tools/gcp_distill_mobile_25mb.py \
  tools/train_en_adapter_gcp.py \
  tools/train_indic_adapters_gcp.py \
  bench/eval_slang_and_accents.py \
  bench/test_speech_suite.jsonl \
  docs/samples \
  docs/heads \
  docs/heads_mobile \
  models/vocabularies \
  python
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

rm -rf /var/tmp/swanada_work
mkdir -p /var/tmp/swanada_work/models/onnx/heads /var/tmp/swanada_work/models/onnx_mobile/heads /var/tmp/swanada_work/docs/heads /var/tmp/swanada_work/docs/heads_mobile /var/tmp/swanada_work/docs/vocabularies /var/tmp/swanada_work/bench
cd /var/tmp/swanada_work
tar -xzf /tmp/swanada_input.tar.gz 2>/dev/null || tar -xzf /tmp/swanada_input.tar.gz
rm -f /tmp/swanada_input.tar.gz

if ! command -v python3 >/dev/null 2>&1 || ! python3 -m pip --version >/dev/null 2>&1 || ! dpkg -s libsndfile1 >/dev/null 2>&1; then
  sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq python3-pip libsndfile1 curl
fi
if ! python3 -c "import torch" >/dev/null 2>&1; then
  echo "[remote] Installing oneDNN / AVX-512 PyTorch CPU wheel..."
  python3 -m pip install -q --upgrade pip
  python3 -m pip install -q --index-url https://download.pytorch.org/whl/cpu torch
fi
python3 -m pip install -q --upgrade onnx onnxruntime sentencepiece pyarrow soundfile scipy huggingface_hub pyyaml numpy

echo "[remote] Fetching frozen Studio (177.4 MiB) + Mobile (25.35 MiB) encoders from Hugging Face at 10 Gbps..."
curl -sSL --retry 4 -o /var/tmp/swanada_work/models/onnx/sushrota_sanskrit_ctc_int8.onnx \
  "https://huggingface.co/gnumanth/swanada/resolve/main/onnx/sushrota_sanskrit_ctc_int8.onnx"
curl -sSL --retry 4 -o /var/tmp/swanada_work/models/onnx_mobile/swanada_mobile_ctc_int8.onnx \
  "https://huggingface.co/gnumanth/swanada/resolve/main/onnx_mobile/swanada_mobile_ctc_int8.onnx"
sha256sum /var/tmp/swanada_work/models/onnx/sushrota_sanskrit_ctc_int8.onnx /var/tmp/swanada_work/models/onnx_mobile/swanada_mobile_ctc_int8.onnx

export PYTHONUNBUFFERED=1
export PYTHONPATH="/var/tmp/swanada_work/python/src:/var/tmp/swanada_work/tools:${PYTHONPATH:-}"
EN_GCS_CKPT_DIR="gs://training-gemina/swanada_en_adapter_v2"
GCS_CKPT_DIR="gs://training-gemina/swanada_indic_adapters_v2"

echo "=== [STAGE 1/2] RUNNING SENH v2 10-LANGUAGE INDIC ADAPTER DISTILLATION (STUDIO + MOBILE) ==="
python3 tools/train_indic_adapters_gcp.py \
  --work-dir /var/tmp/swanada_work \
  --cache-dir /var/tmp/swanada_indic_v2_cache \
  --source-shards-gcs "gs://training-gemina/swanada_lb_ckpt_v111" \
  --gcs-ckpt-dir "${GCS_CKPT_DIR}"
rm -rf /var/tmp/swanada_indic_v2_cache

echo "=== [STAGE 2/2] RUNNING SENH v2 ENGLISH ADAPTER + 129-BPE DISTILLATION (MOBILE FIRST + REUSE STUDIO) ==="
python3 tools/train_en_adapter_gcp.py \
  --work-dir /var/tmp/swanada_work \
  --cache-dir /var/tmp/swanada_en_v2_cache \
  --source-shards-gcs "gs://training-gemina/swanada_lb_ckpt_v111" \
  --gcs-ckpt-dir "${EN_GCS_CKPT_DIR}" \
  --mobile-first
rm -rf /var/tmp/swanada_en_v2_cache

echo "=== REFRESHING ADAPTER MANIFESTS & PACKING ALL SENH v2 ENGLISH + 10-INDIC ADAPTERS ==="
python3 - << 'PYEOF'
import json, pathlib, tarfile
root = pathlib.Path("/var/tmp/swanada_work")
for sub in ["docs/heads", "docs/heads_mobile", "models/onnx/heads", "models/onnx_mobile/heads"]:
    d = root / sub
    d.mkdir(parents=True, exist_ok=True)
    langs = sorted(p.name[:-len("_adapter.bin")] for p in d.glob("*_adapter.bin") if p.stat().st_size > 1024)
    (d / "adapters.json").write_text(json.dumps(langs, indent=2) + "\n")
    print(sub, "->", langs)

targets = []
for rel in [
    "models/vocabularies/en_bpe_vocab.json",
    "docs/vocabularies/en_bpe_vocab.json",
    "docs/heads/adapters.json",
    "docs/heads_mobile/adapters.json",
    "bench/indic_senh_v2_summary.json",
]:
    p = root / rel
    if p.exists():
        targets.append(rel)
for sub in ["docs/heads", "docs/heads_mobile", "models/onnx/heads", "models/onnx_mobile/heads"]:
    d = root / sub
    if d.exists():
        for p in sorted(d.glob("*_adapter.bin")):
            targets.append(str(p.relative_to(root)))
        aj = d / "adapters.json"
        if aj.exists() and str(aj.relative_to(root)) not in targets:
            targets.append(str(aj.relative_to(root)))
with tarfile.open("/var/tmp/swanada_all_v2_output.tar.gz", "w:gz") as tf:
    for rel in targets:
        tf.add(root / rel, arcname=rel)
print(f"Packed {len(targets)} files into /var/tmp/swanada_all_v2_output.tar.gz")
PYEOF

ls -lh /var/tmp/swanada_all_v2_output.tar.gz
CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity" \
  gcloud storage cp --quiet /var/tmp/swanada_all_v2_output.tar.gz "${GCS_CKPT_DIR}/final_all_adapters_v2.tar.gz"
REMOTEEOF

ZONES=(
  "us-central1-a" "us-central1-b" "us-central1-c" "us-central1-f"
  "us-east1-b" "us-east1-c" "us-east1-d"
  "us-east4-a" "us-east4-b" "us-east4-c"
  "us-west1-a" "us-west1-b" "us-west1-c"
  "us-west4-a" "us-west4-b"
  "northamerica-northeast2-b" "northamerica-northeast2-a" "northamerica-northeast1-c"
  "europe-west4-b" "europe-west4-a" "europe-west4-c"
  "europe-west1-b" "europe-west1-c"
)
MACHINE_TYPES=("g2-standard-16" "g2-standard-12" "g2-standard-8")
CPU_FAST_TYPES=("c3-standard-22" "c2d-standard-16" "n2-standard-16" "c3-standard-8" "c2d-standard-8" "n2-standard-8" "e2-standard-8" "c3-standard-4" "c2d-standard-4" "n2-standard-4")

PIPELINE_DONE=0
for spot_attempt in $(seq 1 10); do
  VM_NAME="swanada-spot-indic2-$(date +%s)"
  SELECTED_ZONE=""
  echo "[2/6] (Spot Attempt ${spot_attempt}/10) Provisioning SPOT L4 GPU or AVX-512/Zen3 worker (${VM_NAME}) on GCP (${PROJECT})..."

  for mtype in "${MACHINE_TYPES[@]}"; do
    for z in "${ZONES[@]}"; do
      echo "  Trying SPOT ${mtype} (1x L4) in ${z}..."
      if ERR_MSG=$(CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity" \
        gcloud compute instances create "${VM_NAME}" \
          --project="${PROJECT}" \
          --zone="${z}" \
          --machine-type="${mtype}" \
          --accelerator="type=nvidia-l4,count=1" \
          --maintenance-policy="TERMINATE" \
          --provisioning-model="SPOT" \
          --instance-termination-action="DELETE" \
          --max-run-duration="28800s" \
          --scopes="https://www.googleapis.com/auth/devstorage.read_write" \
          --image-family="pytorch-2-9-cu129-ubuntu-2204-nvidia-580" \
          --image-project="deeplearning-platform-release" \
          --boot-disk-size="200GB" \
          --boot-disk-type="pd-ssd" \
          --quiet 2>&1); then
        SELECTED_ZONE="${z}"
        echo "  Provisioned SPOT GPU ${VM_NAME} (${mtype}, 1x L4) in ${SELECTED_ZONE}!"
        break 2
      else
        if printf "%s" "${ERR_MSG}" | grep -q "GPUS_ALL_REGIONS"; then
          echo "  [avx512-fallback] GPUS_ALL_REGIONS (1/1) occupied; switching immediately to Spot AVX-512/Zen3 VM!"
          break 2
        fi
      fi
    done
  done

  if [[ -z "${SELECTED_ZONE}" ]]; then
    for cmtype in "${CPU_FAST_TYPES[@]}"; do
      for z in "${ZONES[@]}"; do
        echo "  Trying SPOT AVX-512/Zen3 ${cmtype} in ${z}..."
        if ERR_MSG=$(CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity" \
          gcloud compute instances create "${VM_NAME}" \
            --project="${PROJECT}" \
            --zone="${z}" \
            --machine-type="${cmtype}" \
            --maintenance-policy="TERMINATE" \
            --provisioning-model="SPOT" \
            --instance-termination-action="DELETE" \
            --max-run-duration="28800s" \
            --scopes="https://www.googleapis.com/auth/devstorage.read_write" \
            --image-family="ubuntu-2204-lts" \
            --image-project="ubuntu-os-cloud" \
            --boot-disk-size="200GB" \
            --boot-disk-type="pd-balanced" \
            --quiet 2>&1); then
          SELECTED_ZONE="${z}"
          echo "  Provisioned SPOT AVX-512/Zen3 ${VM_NAME} (${cmtype}) in ${SELECTED_ZONE}!"
          break 2
        else
          if printf "%s" "${ERR_MSG}" | grep -q "CPUS_ALL_REGIONS"; then
            echo "  [quota] ${cmtype} exceeds remaining CPUS_ALL_REGIONS; stepping down to next vCPU size..."
            break
          fi
        fi
      done
    done
  fi

  if [[ -z "${SELECTED_ZONE}" ]]; then
    echo "ERROR: Could not allocate SPOT L4 or High-vCPU VM across candidate global zones." >&2
    exit 1
  fi

  echo "[3/6] Waiting for SSH readiness on ${VM_NAME}..."
  SSH_READY=0
  for attempt in $(seq 1 30); do
    if CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity" \
      gcloud compute ssh "${VM_NAME}" --project="${PROJECT}" --zone="${SELECTED_ZONE}" --quiet \
        --ssh-flag="-o ServerAliveInterval=15" \
        --command="(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null || lscpu | grep -E 'Model name|^CPU\(s\):' | head -n 2) && free -h | head -n 2" 2>/dev/null; then
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

  echo "[5/6] Launching detached daemon Spot job & streaming logs..."
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
  while true; do
    STATUS_OUT=$(CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity" \
      gcloud compute ssh "${VM_NAME}" --project="${PROJECT}" --zone="${SELECTED_ZONE}" --quiet \
        --ssh-flag="-o ServerAliveInterval=15 -o ConnectTimeout=20" \
        --command="bash /tmp/poll_log.sh ${LAST_LINE}" 2>/dev/null) || {
      FAIL_STREAK=$((FAIL_STREAK + 1))
      echo "[monitor] Transient SSH poll retry (${FAIL_STREAK}/6)..."
      if [[ ${FAIL_STREAK} -ge 6 ]]; then
        echo "[monitor] Spot preemption detected on ${VM_NAME} (${SELECTED_ZONE})! Rotating zone and auto-resuming per-language from GCS checkpoint..."
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
      echo "[monitor] Remote Spot pipeline finished with exit code ${JOB_RC}."
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
  echo "ERROR: Parallel SENH v2 Spot pipeline did not complete after 10 attempts." >&2
  exit 1
fi

echo "[6/6] Downloading Studio + Mobile SENH v2 English + 10-Indic Adapters & Manifests..."
SCP_OK=0
if CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity" \
  gcloud storage cp --quiet "${GCS_CKPT_DIR}/final_all_adapters_v2.tar.gz" "${DOWNLOAD_TAR}"; then
  SCP_OK=1
fi
if [[ "${SCP_OK}" != "1" ]]; then
  for attempt in $(seq 1 10); do
    if CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity" \
      gcloud compute scp "${VM_NAME}:/var/tmp/swanada_all_v2_output.tar.gz" "${DOWNLOAD_TAR}" \
      --project="${PROJECT}" --zone="${SELECTED_ZONE}" --quiet; then
      SCP_OK=1
      break
    fi
    sleep 10
  done
fi
if [[ "${SCP_OK}" != "1" ]]; then
  echo "ERROR: Failed to download final SENH v2 output archive." >&2
  exit 1
fi

cd "${REPO_ROOT}"
tar -xzf "${DOWNLOAD_TAR}"
.venv/bin/python -c '
import json, pathlib
for sub in ["docs/heads", "docs/heads_mobile", "models/onnx/heads", "models/onnx_mobile/heads"]:
    d = pathlib.Path(sub)
    d.mkdir(parents=True, exist_ok=True)
    langs = sorted(p.name[:-len("_adapter.bin")] for p in d.glob("*_adapter.bin") if p.stat().st_size > 1024)
    (d / "adapters.json").write_text(json.dumps(langs, indent=2) + "\n")
    print(sub, "->", langs)
'
ls -lh docs/heads/*_adapter.bin docs/heads/adapters.json docs/heads_mobile/*_adapter.bin docs/heads_mobile/adapters.json || true
echo "=== ALL PARALLEL SPOT 10-INDIC + ENGLISH SENH v2 DISTILLATION COMPLETE ==="
