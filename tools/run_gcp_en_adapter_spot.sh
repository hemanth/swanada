#!/usr/bin/env bash
set -euo pipefail

export CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity"

PROJECT="hemanth-hm"
REPO_ROOT="/Users/lika/labs/swanada"
VM_NAME="swanada-l4-spot-en-$(date +%s)"
SELECTED_ZONE=""
UPLOAD_TAR="/tmp/${VM_NAME}_input.tar.gz"
DOWNLOAD_TAR="/tmp/${VM_NAME}_output.tar.gz"
REMOTE_SCRIPT="/tmp/${VM_NAME}_remote_job.sh"
GCS_CKPT_DIR="gs://training-gemina/swanada_en_adapter_v2"

cleanup() {
  rm -f "${UPLOAD_TAR}" "${DOWNLOAD_TAR}" "${REMOTE_SCRIPT}"
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

echo "[1/6] Packing lightweight workspace archive (<15 MB; frozen encoders fetched at 10 Gbps on GCP)..."
cd "${REPO_ROOT}"
COPYFILE_DISABLE=1 tar --no-xattrs -czf "${UPLOAD_TAR}" \
  tools/gcp_joint_12lang_train.py \
  tools/train_en_adapter_gcp.py \
  bench/eval_slang_and_accents.py \
  bench/test_speech_suite.jsonl \
  docs/samples \
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

mkdir -p /tmp/swanada_work/models/onnx/heads /tmp/swanada_work/models/onnx_mobile/heads /tmp/swanada_work/docs/heads /tmp/swanada_work/docs/heads_mobile /tmp/swanada_work/docs/vocabularies
cd /tmp/swanada_work
tar -xzf /tmp/swanada_input.tar.gz 2>/dev/null || tar -xzf /tmp/swanada_input.tar.gz
rm -f /tmp/swanada_input.tar.gz

python3 -m pip install -q --upgrade onnx onnxruntime sentencepiece pyarrow soundfile scipy huggingface_hub pyyaml

echo "[remote] Fetching frozen Studio (177.4 MiB) + Mobile (25.35 MiB) encoders from Hugging Face at 10 Gbps..."
curl -sSL --retry 4 -o /tmp/swanada_work/models/onnx/sushrota_sanskrit_ctc_int8.onnx \
  "https://huggingface.co/gnumanth/swanada/resolve/main/onnx/sushrota_sanskrit_ctc_int8.onnx"
curl -sSL --retry 4 -o /tmp/swanada_work/models/onnx_mobile/swanada_mobile_ctc_int8.onnx \
  "https://huggingface.co/gnumanth/swanada/resolve/main/onnx_mobile/swanada_mobile_ctc_int8.onnx"
sha256sum /tmp/swanada_work/models/onnx/sushrota_sanskrit_ctc_int8.onnx /tmp/swanada_work/models/onnx_mobile/swanada_mobile_ctc_int8.onnx

export PYTHONUNBUFFERED=1
export PYTHONPATH="/tmp/swanada_work/python/src:/tmp/swanada_work/tools:${PYTHONPATH:-}"
GCS_CKPT_DIR="gs://training-gemina/swanada_en_adapter_v2"

echo "=== RUNNING SENH v2 ENGLISH ADAPTER + 1024-BPE DISTILLATION (STUDIO + MOBILE) ==="
python3 tools/train_en_adapter_gcp.py \
  --work-dir /tmp/swanada_work \
  --cache-dir /tmp/swanada_en_v2_cache \
  --gcs-ckpt-dir "${GCS_CKPT_DIR}"

echo "=== PACKING SENH v2 STUDIO + MOBILE ADAPTERS + BPE VOCAB ==="
tar -czf /tmp/swanada_en_output.tar.gz \
  docs/heads/en_adapter.bin \
  docs/heads_mobile/en_adapter.bin \
  models/onnx/heads/en_adapter.bin \
  models/onnx_mobile/heads/en_adapter.bin \
  models/vocabularies/en_bpe_vocab.json \
  docs/vocabularies/en_bpe_vocab.json
ls -lh /tmp/swanada_en_output.tar.gz
CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity" \
  gcloud storage cp --quiet /tmp/swanada_en_output.tar.gz "${GCS_CKPT_DIR}/final_en_adapter_v2.tar.gz"
REMOTEEOF

ZONES=(
  "northamerica-northeast2-b" "northamerica-northeast2-a" "northamerica-northeast1-c"
  "us-central1-a" "us-central1-b" "us-central1-c"
  "us-east1-b" "us-east1-c" "us-east1-d"
  "us-east4-a" "us-east4-c"
  "us-west1-a" "us-west1-b" "us-west1-c"
  "us-west4-a" "us-west4-c"
  "europe-west4-b" "europe-west4-a" "europe-west4-c"
  "europe-west1-b" "europe-west1-c"
  "europe-west2-a" "europe-west2-b"
  "europe-west3-a" "europe-west3-b"
  "europe-west6-b" "europe-west6-c"
  "asia-northeast1-b" "asia-northeast1-a" "asia-northeast1-c"
  "asia-southeast1-b" "asia-southeast1-a" "asia-southeast1-c"
  "asia-east1-b" "asia-east1-c" "asia-east1-a"
)
MACHINE_TYPES=("g2-standard-16" "g2-standard-12" "g2-standard-8")

PIPELINE_DONE=0
for spot_attempt in $(seq 1 10); do
  VM_NAME="swanada-l4-spot-en-$(date +%s)"
  SELECTED_ZONE=""
  echo "[2/6] (Spot Attempt ${spot_attempt}/10) Provisioning SPOT-ONLY NVIDIA L4 GPU VM (${VM_NAME}) on GCP (${PROJECT})..."

  for wait_slot in $(seq 1 90); do
    LAST_ERR=""
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
            --max-run-duration="14400s" \
            --scopes="https://www.googleapis.com/auth/devstorage.read_write" \
            --image-family="pytorch-2-9-cu129-ubuntu-2204-nvidia-580" \
            --image-project="deeplearning-platform-release" \
            --boot-disk-size="200GB" \
            --boot-disk-type="pd-ssd" \
            --quiet 2>&1); then
          SELECTED_ZONE="${z}"
          echo "  Provisioned SPOT ${VM_NAME} (${mtype}, 1x L4) in ${SELECTED_ZONE}!"
          break 3
        else
          LAST_ERR="${ERR_MSG}"
          if printf "%s" "${ERR_MSG}" | grep -q "GPUS_ALL_REGIONS"; then
            echo "  [quota-wait ${wait_slot}/90] Project GPUS_ALL_REGIONS (1/1) currently occupied by another active VM; waiting 20s..."
            sleep 20
            continue 3
          fi
        fi
      done
    done
    echo "  [zone-retry ${wait_slot}/90] Last gcloud message: $(printf '%s' "${LAST_ERR}" | tail -n 2 | tr '\n' ' ')"
    sleep 20
  done

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
  while true; do
    STATUS_OUT=$(CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity" \
      gcloud compute ssh "${VM_NAME}" --project="${PROJECT}" --zone="${SELECTED_ZONE}" --quiet \
        --ssh-flag="-o ServerAliveInterval=15 -o ConnectTimeout=20" \
        --command="bash /tmp/poll_log.sh ${LAST_LINE}" 2>/dev/null) || {
      FAIL_STREAK=$((FAIL_STREAK + 1))
      echo "[monitor] Transient SSH poll retry (${FAIL_STREAK}/6)..."
      if [[ ${FAIL_STREAK} -ge 6 ]]; then
        echo "[monitor] Spot preemption detected on ${VM_NAME} (${SELECTED_ZONE})! Rotating zone and auto-resuming from GCS checkpoint..."
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
  echo "ERROR: English SENH v2 Spot pipeline did not complete after 10 attempts." >&2
  exit 1
fi

echo "[6/6] Downloading Studio + Mobile SENH v2 English Adapters & 1024-BPE Vocab..."
SCP_OK=0
if CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity" \
  gcloud storage cp --quiet "${GCS_CKPT_DIR}/final_en_adapter_v2.tar.gz" "${DOWNLOAD_TAR}"; then
  SCP_OK=1
fi
if [[ "${SCP_OK}" != "1" ]]; then
  for attempt in $(seq 1 10); do
    if CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity" \
      gcloud compute scp "${VM_NAME}:/tmp/swanada_en_output.tar.gz" "${DOWNLOAD_TAR}" \
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
ls -lh docs/heads/en_adapter.bin docs/heads_mobile/en_adapter.bin models/vocabularies/en_bpe_vocab.json docs/vocabularies/en_bpe_vocab.json
echo "=== ALL SPOT L4 ENGLISH SENH v2 DISTILLATION COMPLETE ==="
