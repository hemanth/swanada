#!/usr/bin/env bash
set -euo pipefail

export CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity"

PROJECT="hemanth-hm"
REPO_ROOT="/Users/lika/labs/swanada"
VM_NAME="swanada-l4-joint-$(date +%s)"
SELECTED_ZONE=""
UPLOAD_TAR="/tmp/${VM_NAME}_input.tar.gz"
DOWNLOAD_TAR="/tmp/${VM_NAME}_output.tar.gz"
REMOTE_SCRIPT="/tmp/${VM_NAME}_remote_job.sh"

cleanup() {
  rm -f "${UPLOAD_TAR}" "${DOWNLOAD_TAR}" "${REMOTE_SCRIPT}"
  if [[ -n "${SELECTED_ZONE}" ]]; then
    echo "[cleanup] Deleting GPU VM ${VM_NAME} in ${SELECTED_ZONE}..."
    CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity" \
      gcloud compute instances delete "${VM_NAME}" \
      --project="${PROJECT}" \
      --zone="${SELECTED_ZONE}" \
      --quiet || true
  fi
}
trap cleanup EXIT INT TERM

echo "[1/6] Packing lightweight workspace archive (~65 MB, zero local compute)..."
cd "${REPO_ROOT}"
cp -f /Users/lika/labs/ninada/data/wavs/sa_rasa_male_01445fb1731b.wav "${REPO_ROOT}/_gcp_sanity_sa_rasa.wav"
COPYFILE_DISABLE=1 tar -czf "${UPLOAD_TAR}" \
  tools/gcp_joint_12lang_train.py \
  bench/benchmark_accuracy.py \
  bench/eval_streaming.py \
  bench/check_bench_thresholds.py \
  bench/test_speech_suite.jsonl \
  bench/test_gt_wavs_16k \
  docs/samples \
  docs/heads \
  models/preprocessor.onnx \
  models/vocabularies \
  python \
  _gcp_sanity_sa_rasa.wav
rm -f "${REPO_ROOT}/_gcp_sanity_sa_rasa.wav"
ls -lh "${UPLOAD_TAR}"

cat > "${REMOTE_SCRIPT}" << 'REMOTEEOF'
#!/usr/bin/env bash
set -euo pipefail
trap 'RC=$?; echo "${RC}" > /tmp/swanada_job.rc' EXIT

mkdir -p /tmp/swanada_work
cd /tmp/swanada_work
tar -xzf /tmp/swanada_input.tar.gz
rm -f /tmp/swanada_input.tar.gz

python3 -m pip install -q --upgrade onnx onnxruntime-gpu pyarrow soundfile scipy huggingface_hub pyyaml

NVIDIA_LIBS=$(python3 -c 'import site, glob, os; p=[]; [p.extend(glob.glob(os.path.join(s, "nvidia", "*", "lib"))) for s in site.getsitepackages()]; print(":".join(p))')
export LD_LIBRARY_PATH="${NVIDIA_LIBS}:/usr/local/cuda/lib64:${LD_LIBRARY_PATH:-}"
export PYTHONUNBUFFERED=1

echo "=== Phase 1 (Isolated Process): Parallel 12-Language Corpus Prep & FP32 Teacher Posterior Extraction ==="
python3 -u tools/gcp_joint_12lang_train.py \
  --work-dir /tmp/swanada_work \
  --stage prepare \
  --en-target-clips 11000 \
  --indic-target-clips 2000

echo "=== Phase 2 (Fresh Clean GPU Process): Joint 12-Language Conformer BF16 Training, ONNX INT8 Export & Fleurs Test ==="
python3 -u tools/gcp_joint_12lang_train.py \
  --work-dir /tmp/swanada_work \
  --stage train \
  --epochs 7 \
  --batch-size 48 \
  --encoder-lr 9.5e-5 \
  --head-lr 1.5e-3 \
  --freeze-until-layer 4

echo "=== Running Full 480-Clip Held-Out Batch Benchmark (B=1,000 Bootstrap) ==="
python3 -u bench/benchmark_accuracy.py

echo "=== Running Full 72-Session Streaming Latency & Stability Benchmark ==="
python3 -u bench/eval_streaming.py

echo "=== Verifying Benchmark Thresholds ==="
python3 -u bench/check_bench_thresholds.py

echo "=== Evaluating All 12 Studio Presets (Batch & 100ms Streaming) ==="
python3 -u - << 'PYEOF'
import json, sys
from pathlib import Path
sys.path.insert(0, "/tmp/swanada_work/python/src")
from swanada.engine import AcousticEngine
from swanada.streaming import SwanadaStream
from swanada.audio import load_audio

PRESETS = {
    "sa": "व्यायामः देहस्य अङ्गेषु पुष्टिं ददाति",
    "en": "The king was troubled with jealousy.",
    "hi": "अपने हेडमास्टर साहब ही को देखो",
    "kn": "ಹಾಗಾಗಿ ಬ್ಯಾಂಕ್ ಇದ್ನ ಸ್ಥಗಿತಗೊಳ್ಸಿದೆ",
    "mr": "हो. आणखीही काही आहे.",
    "bn": "সেজন্য যেন আবার দাদার উপর অভিমান করে বসিনে।",
    "ta": "அதோ கலங்கரை விளக்கமும் தெரிகிறது",
    "te": "నాకు కూడా ప్రయాణం చేయటం, చదవటం ఇష్టం",
    "ml": "ഉമ്മായ്ക്കതിൽ പരിപൂർണവിശ്വാസമുണ്ട്",
    "gu": "જો એવું હોય તો હું બસથી જઈશ.",
    "pa": "ਉਦਯੋਗਨਗਰੀ ਐਕਸਪ੍ਰੈਸ",
    "or": "ସନ୍ଧ୍ୟାଙ୍କୁ ଇମେଲ କରି ଏହା ଲେଖ",
}

root = Path("/tmp/swanada_work")
rows = {}
for lang, ref in PRESETS.items():
    mname = "sushrota_sanskrit_ctc_int8.onnx" if lang == "sa" else f"swanada_{lang}_ctc_int8.onnx"
    vname = "sanskrit_vocab.json" if lang == "sa" else f"{lang}_vocab.json"
    eng = AcousticEngine(
        model_path=root / "models" / "onnx" / mname,
        vocab_path=root / "models" / "vocabularies" / vname,
        preprocessor_path=root / "models" / "preprocessor.onnx",
        language=lang,
        num_threads=4,
        preprocessor_mode="onnx",
        denoise=False,
    )
    pcm = load_audio(root / "docs" / "samples" / f"{lang}.wav", target_sr=16000)
    batch_res = eng.transcribe(pcm)
    stream = SwanadaStream(eng, chunk_size_samples=1600)
    for off in range(0, len(pcm), 1600):
        stream.push(pcm[off:off+1600])
    stream_res = stream.finish()
    rows[lang] = {"ref": ref, "batch": batch_res.text, "stream": stream_res.text}
    print(f"[{lang}] REF   : {ref}")
    print(f"[{lang}] BATCH : {batch_res.text}")
    print(f"[{lang}] STREAM: {stream_res.text}")
    print("-" * 60)

(root / "bench" / "presets_eval.json").write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")
PYEOF

tar -czf /tmp/swanada_output.tar.gz \
  models/onnx/sushrota_sanskrit_ctc_int8.onnx \
  models/onnx/heads \
  docs/heads \
  bench/results.json \
  bench/streaming_results.json \
  bench/expanded_fleurs_test_results.json \
  bench/presets_eval.json \
  bench/ACCURACY_REPORT.md
ls -lh /tmp/swanada_output.tar.gz
REMOTEEOF

echo "[2/6] Provisioning non-preemptible 64GB RAM NVIDIA L4 GPU VM (${VM_NAME}) on GCP (${PROJECT})..."
ZONES=("us-east1-c" "us-central1-c" "us-central1-a" "us-central1-b" "us-west1-b" "us-west4-a" "us-east1-d")

for PROV_MODEL in "STANDARD" "SPOT"; do
  for z in "${ZONES[@]}"; do
    echo "  Trying ${PROV_MODEL} g2-standard-16 in ${z}..."
    if [[ "${PROV_MODEL}" == "SPOT" ]]; then
      EXTRA_FLAGS=(--provisioning-model="SPOT" --instance-termination-action="DELETE" --max-run-duration="10800s")
    else
      EXTRA_FLAGS=(--provisioning-model="STANDARD")
    fi
    if CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity" \
      gcloud compute instances create "${VM_NAME}" \
        --project="${PROJECT}" \
        --zone="${z}" \
        --machine-type="g2-standard-16" \
        --accelerator="type=nvidia-l4,count=1" \
        --maintenance-policy="TERMINATE" \
        "${EXTRA_FLAGS[@]}" \
        --image-family="pytorch-2-9-cu129-ubuntu-2204-nvidia-580" \
        --image-project="deeplearning-platform-release" \
        --boot-disk-size="200GB" \
        --boot-disk-type="pd-ssd" \
        --quiet; then
      SELECTED_ZONE="${z}"
      echo "  Provisioned ${PROV_MODEL} ${VM_NAME} (g2-standard-16, 64GB RAM, 1x L4) in ${SELECTED_ZONE}!"
      break 2
    fi
  done
done

if [[ -z "${SELECTED_ZONE}" ]]; then
  echo "ERROR: Could not allocate L4 GPU across candidate zones." >&2
  exit 1
fi

echo "[3/6] Waiting for SSH readiness on ${VM_NAME}..."
for attempt in $(seq 1 30); do
  if CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity" \
    gcloud compute ssh "${VM_NAME}" --project="${PROJECT}" --zone="${SELECTED_ZONE}" --quiet \
      --ssh-flag="-o ServerAliveInterval=15" \
      --command="nvidia-smi --query-gpu=name,memory.total --format=csv,noheader && free -h | head -n 2" 2>/dev/null; then
    break
  fi
  sleep 6
done

echo "[4/6] Uploading workspace archive & detached runner to ${VM_NAME}..."
CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity" \
  gcloud compute scp "${UPLOAD_TAR}" "${VM_NAME}:/tmp/swanada_input.tar.gz" \
  --project="${PROJECT}" --zone="${SELECTED_ZONE}" --quiet
CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity" \
  gcloud compute scp "${REMOTE_SCRIPT}" "${VM_NAME}:/tmp/remote_job.sh" \
  --project="${PROJECT}" --zone="${SELECTED_ZONE}" --quiet

echo "[5/6] Launching detached daemon GPU job & streaming logs with resilient reconnect..."
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
    echo "[monitor] Transient SSH poll retry (${FAIL_STREAK})..."
    if [[ ${FAIL_STREAK} -ge 24 ]]; then
      echo "ERROR: VM unreachable after 24 consecutive retries." >&2
      exit 1
    fi
    sleep 10
    continue
  }
  FAIL_STREAK=0

  # Print new log lines cleanly
  printf "%s\n" "${STATUS_OUT}" | grep -v "^__SWANADA_CURSOR__:" | grep -v "^__SWANADA_RC__:" || true

  NEW_CURSOR=$(printf "%s\n" "${STATUS_OUT}" | sed -n 's/^__SWANADA_CURSOR__://p' | tail -n 1)
  if [[ -n "${NEW_CURSOR}" ]]; then
    LAST_LINE="${NEW_CURSOR}"
  fi

  JOB_RC=$(printf "%s\n" "${STATUS_OUT}" | sed -n 's/^__SWANADA_RC__://p' | tail -n 1)
  if [[ -n "${JOB_RC}" ]]; then
    echo "[monitor] Remote GPU pipeline finished with exit code ${JOB_RC}."
    if [[ "${JOB_RC}" != "0" ]]; then
      exit "${JOB_RC}"
    fi
    break
  fi
  sleep 12
done

echo "[6/6] Downloading trained INT8 base encoder, 12 heads, and evaluation artifacts..."
SCP_OK=0
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
if [[ "${SCP_OK}" != "1" ]]; then
  echo "ERROR: Failed to download /tmp/swanada_output.tar.gz after 12 attempts." >&2
  exit 1
fi

cd "${REPO_ROOT}"
tar -xzf "${DOWNLOAD_TAR}"
mkdir -p "${REPO_ROOT}/models/heads"
cp -f "${REPO_ROOT}/docs/heads/"*.bin "${REPO_ROOT}/models/heads/"

echo "Splicing local monolithic swanada_<lang>_ctc_int8.onnx files from updated shared INT8 encoder + .bin heads..."
"${REPO_ROOT}/.venv/bin/python3" - << 'PYEOF'
import copy
from pathlib import Path
import numpy as np
import onnx
from onnx import numpy_helper

root = Path("/Users/lika/labs/swanada")
base = onnx.load(str(root / "models" / "onnx" / "sushrota_sanskrit_ctc_int8.onnx"))
langs = ["sa", "en", "hi", "kn", "mr", "bn", "ta", "te", "ml", "gu", "pa", "or"]
for lang in langs:
    raw = (root / "docs" / "heads" / f"{lang}.bin").read_bytes()
    assert len(raw) == (257 * 512 + 257) * 4
    w = np.frombuffer(raw[: 257 * 512 * 4], dtype="<f4").reshape(257, 512, 1).copy()
    b = np.frombuffer(raw[257 * 512 * 4 :], dtype="<f4").copy()
    m = copy.deepcopy(base)
    for idx, init in enumerate(m.graph.initializer):
        if init.name == "ctc.weight":
            m.graph.initializer[idx].CopyFrom(numpy_helper.from_array(w, name="ctc.weight"))
        elif init.name == "ctc.bias":
            m.graph.initializer[idx].CopyFrom(numpy_helper.from_array(b, name="ctc.bias"))
    onnx.save(m, str(root / "models" / "onnx" / f"swanada_{lang}_ctc_int8.onnx"))
    print(f"  Spliced models/onnx/swanada_{lang}_ctc_int8.onnx")
PYEOF

echo "=== ALL GCP L4 JOINT TRAINING & EVALUATIONS COMPLETE ==="
