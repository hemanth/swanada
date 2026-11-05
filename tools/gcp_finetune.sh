#!/usr/bin/env bash
# ==============================================================================
# Swanada GCP Spot GPU Execution Wrapper with Strict Traps & Resource Attribution
# ==============================================================================
set -euo pipefail

# Mandatory resource attribution per project skill standards
export CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity"

PROJECT="${1:-hemanth-hm}"
ZONE="${2:-us-central1-a}"
MAX_DURATION="${3:-1800}"
TIMESTAMP="$(date +%s)"
RAND_SUFFIX="$(head -c 3 /dev/urandom | od -An -tx1 | tr -d ' \n')"
INSTANCE_NAME="swanada-gpu-${TIMESTAMP}-${RAND_SUFFIX}"

echo "=== [swanada] Initializing GCP Spot Execution: ${INSTANCE_NAME} ==="
echo "Project: ${PROJECT} | Zone: ${ZONE} | Max Duration: ${MAX_DURATION}s"

# Safety invariant check against protected instances
if [[ "${INSTANCE_NAME}" == "agy-remote" || "${INSTANCE_NAME}" == "ninada-istft-w4b" || "${INSTANCE_NAME}" == "piragi-airbench-gpu" ]]; then
  echo "FATAL: Target instance matches protected instance whitelist!" >&2
  exit 1
fi

cleanup() {
  local exit_code=$?
  echo "=== [swanada-trap] Intercepted exit/signal (code: ${exit_code}). Running cleanup for ${INSTANCE_NAME}... ==="
  if [[ "${INSTANCE_NAME}" =~ ^swanada-gpu-[0-9]+-[a-f0-9]+$ ]]; then
    echo "=== [swanada-trap] Deleting instance ${INSTANCE_NAME}... ==="
    CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity" \
    gcloud compute instances delete "${INSTANCE_NAME}" \
      --project="${PROJECT}" \
      --zone="${ZONE}" \
      --quiet || true
    echo "=== [swanada-trap] Teardown command finished. ==="
  fi
  exit "${exit_code}"
}

# Register traps for clean exit and termination signals
trap cleanup EXIT INT TERM

# Verify authentication
echo "=== [swanada] Verifying GCP Authentication ==="
CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity" \
gcloud auth list --format="json" | grep -q "ACTIVE" || {
  echo "FATAL: No active GCP credentials detected. Run 'gcloud auth login'." >&2
  exit 1
}

# Execute Python manager with hard timeout
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
python3 "${SCRIPT_DIR}/gcp_finetune.py" \
  --project="${PROJECT}" \
  --zone="${ZONE}" \
  --timeout="${MAX_DURATION}"

echo "=== [swanada] Execution completed successfully. ==="
