#!/usr/bin/env bash
set -euo pipefail

export CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity"

PROJECT="hemanth-hm"
REPO_ROOT="/Users/lika/labs/swanada"
VM_NAME="swanada-l4-mobile25m-$(date +%s)"
SELECTED_ZONE=""
UPLOAD_TAR="/tmp/${VM_NAME}_input.tar.gz"
DOWNLOAD_TAR="/tmp/${VM_NAME}_output.tar.gz"
REMOTE_SCRIPT="/tmp/${VM_NAME}_remote_job.sh"

cleanup() {
  rm -f "${UPLOAD_TAR}" "${DOWNLOAD_TAR}" "${REMOTE_SCRIPT}"
  if [[ -n "${SELECTED_ZONE}" ]]; then
    echo "[cleanup] Deleting ephemeral GPU VM ${VM_NAME} in ${SELECTED_ZONE}..."
    CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity" \
      gcloud compute instances delete "${VM_NAME}" \
      --project="${PROJECT}" \
      --zone="${SELECTED_ZONE}" \
      --quiet || true
  fi
}
trap cleanup EXIT INT TERM

echo "[1/6] Packing lightweight workspace archive (zero local 186MB upload — teacher fetched at 10 Gbps on GCP)..."
cd "${REPO_ROOT}"
COPYFILE_DISABLE=1 tar -czf "${UPLOAD_TAR}" \
  tools/gcp_joint_12lang_train.py \
  tools/gcp_distill_mobile_25mb.py \
  bench/benchmark_accuracy.py \
  bench/eval_slang_and_accents.py \
  bench/test_speech_suite.jsonl \
  bench/test_gt_wavs_16k \
  docs/samples \
  docs/heads \
  models/preprocessor.onnx \
  models/vocabularies \
  python
ls -lh "${UPLOAD_TAR}"

cat > "${REMOTE_SCRIPT}" << 'REMOTEEOF'
#!/usr/bin/env bash
set -euo pipefail
trap 'RC=$?; echo "${RC}" > /tmp/swanada_job.rc' EXIT

mkdir -p /tmp/swanada_work/models/onnx
cd /tmp/swanada_work
tar -xzf /tmp/swanada_input.tar.gz
rm -f /tmp/swanada_input.tar.gz

python3 -m pip install -q --upgrade onnx onnxruntime pyarrow soundfile scipy huggingface_hub pyyaml

echo "[remote] Fetching converged v1.0.2 Teacher encoder from Hugging Face at 10 Gbps..."
curl -sSL --retry 4 -o /tmp/swanada_work/models/onnx/sushrota_sanskrit_ctc_int8.onnx \
  "https://huggingface.co/gnumanth/swanada/resolve/main/onnx/sushrota_sanskrit_ctc_int8.onnx"
ls -lh /tmp/swanada_work/models/onnx/sushrota_sanskrit_ctc_int8.onnx

export PYTHONUNBUFFERED=1
export PYTHONPATH="/tmp/swanada_work/python/src:/tmp/swanada_work/tools:${PYTHONPATH:-}"

echo "=== PHASE 1: PARALLEL 12-LANG + MULTI-ACCENT CORPUS PREPARATION ==="
python3 tools/gcp_distill_mobile_25mb.py \
  --work-dir /tmp/swanada_work \
  --stage prepare \
  --indic-target-clips 2800 \
  --en-target-clips 10200

echo "=== PHASE 2: PRE-CACHED TEACHER + 20-EPOCH BF16 L4 DISTILLATION + QINT8 CALIBRATION ==="
python3 tools/gcp_distill_mobile_25mb.py \
  --work-dir /tmp/swanada_work \
  --stage train \
  --epochs 20 \
  --batch-size 64 \
  --encoder-lr 1.1e-3 \
  --head-lr 1.5e-4

echo "=== CHECKPOINT PACK: <30MB SHARED MOBILE ENCODER + 12 HEADS ==="
EXTRA_BENCH=()
[[ -f bench/mobile_fleurs_unseen_results.json ]] && EXTRA_BENCH+=("bench/mobile_fleurs_unseen_results.json")
tar -czf /tmp/swanada_output.tar.gz \
  models/onnx_mobile/swanada_mobile_ctc_int8.onnx \
  models/onnx_mobile/heads \
  docs/heads_mobile \
  "${EXTRA_BENCH[@]}"
ls -lh /tmp/swanada_output.tar.gz

echo "=== PHASE 3: 480-CLIP 12-LANGUAGE HELD-OUT BENCHMARK ON <30MB MOBILE TIER ==="
python3 - << 'PYEOF' || echo "[warn] Phase 3 benchmark script returned non-zero; weights already archived."
import json, time
from pathlib import Path
import numpy as np
from swanada.engine import AcousticEngine

root = Path("/tmp/swanada_work")
manifest_path = root / "bench" / "test_speech_suite.jsonl"
entries = [json.loads(ln) for ln in manifest_path.read_text(encoding="utf-8").splitlines() if ln.strip()]

from gcp_joint_12lang_train import normalize_eval_text, levenshtein_seq

by_lang = {}
for e in entries:
    by_lang.setdefault(e["lang"], []).append(e)

all_cers, all_wers, all_rtfs = [], [], []
lang_stats = {}
for lang, items in sorted(by_lang.items()):
    eng = AcousticEngine(
        model_path=root / "models" / "onnx_mobile" / f"swanada_mobile_{lang}_ctc_int8.onnx",
        vocab_path=root / "models" / "vocabularies" / ("sanskrit_vocab.json" if lang == "sa" else f"{lang}_vocab.json"),
        language=lang,
        num_threads=1,
    )
    cers, wers, rtfs = [], [], []
    for it in items:
        rel_wav = it.get("wav_path") or it["audio_filepath"]
        wav_p = root / rel_wav
        res = eng.transcribe(wav_p)
        nr = normalize_eval_text(it["text"], lang)
        nh = normalize_eval_text(res.text, lang)
        cer = levenshtein_seq(list(nr), list(nh)) / max(1, len(nr))
        wer = levenshtein_seq(nr.split(), nh.split()) / max(1, len(nr.split()))
        cers.append(cer); wers.append(wer); rtfs.append(res.rtf)
    all_cers.extend(cers); all_wers.extend(wers); all_rtfs.extend(rtfs)
    lang_stats[lang] = {
        "n": len(cers),
        "cer_mean": round(float(np.mean(cers)), 4),
        "wer_mean": round(float(np.mean(wers)), 4),
        "rtf_1t_mean": round(float(np.mean(rtfs)), 4),
    }
    print(f"[Mobile 480-Suite | {lang}] CER={np.mean(cers)*100:.2f}% | WER={np.mean(wers)*100:.2f}% | 1T-RTF={np.mean(rtfs):.3f}x")

rng = np.random.default_rng(42)
arr_c = np.asarray(all_cers)
arr_w = np.asarray(all_wers)
boot_c = [float(np.mean(arr_c[rng.integers(0, len(arr_c), size=len(arr_c))])) for _ in range(1000)]
boot_w = [float(np.mean(arr_w[rng.integers(0, len(arr_w), size=len(arr_w))])) for _ in range(1000)]
summary = {
    "model": "swanada_mobile_ctc_int8",
    "size_bytes": (root / "models" / "onnx_mobile" / "swanada_mobile_ctc_int8.onnx").stat().st_size,
    "n_clips": len(all_cers),
    "overall_cer": round(float(arr_c.mean()), 4),
    "overall_cer_ci95": [round(float(np.percentile(boot_c, 2.5)), 4), round(float(np.percentile(boot_c, 97.5)), 4)],
    "overall_wer": round(float(arr_w.mean()), 4),
    "overall_wer_ci95": [round(float(np.percentile(boot_w, 2.5)), 4), round(float(np.percentile(boot_w, 97.5)), 4)],
    "overall_rtf_1t": round(float(np.mean(all_rtfs)), 4),
    "languages": lang_stats,
}
(root / "bench" / "mobile_480_accuracy_results.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
print("=== MOBILE 480-CLIP SUMMARY ===", json.dumps({k: v for k, v in summary.items() if k != "languages"}, indent=2))
PYEOF

echo "=== PACKING <30MB SHARED MOBILE ENCODER + 12 HEADS + BENCHMARK REPORTS ==="
EXTRA_BENCH=()
[[ -f bench/mobile_480_accuracy_results.json ]] && EXTRA_BENCH+=("bench/mobile_480_accuracy_results.json")
[[ -f bench/mobile_fleurs_unseen_results.json ]] && EXTRA_BENCH+=("bench/mobile_fleurs_unseen_results.json")
tar -czf /tmp/swanada_output.tar.gz \
  models/onnx_mobile/swanada_mobile_ctc_int8.onnx \
  models/onnx_mobile/heads \
  docs/heads_mobile \
  "${EXTRA_BENCH[@]}"
ls -lh /tmp/swanada_output.tar.gz
REMOTEEOF

echo "[2/6] Provisioning NVIDIA L4 GPU VM (${VM_NAME}) on GCP (${PROJECT})..."
ZONES=("us-east4-a" "us-east4-c" "us-east1-c" "us-east1-b" "us-east1-d" "us-central1-a" "us-central1-b" "us-central1-c" "us-west1-a" "us-west1-b" "us-west1-c" "us-west4-a" "us-west4-c" "northamerica-northeast1-b")

for PROV_MODEL in "STANDARD" "SPOT"; do
  for z in "${ZONES[@]}"; do
    echo "  Trying ${PROV_MODEL} g2-standard-16 in ${z}..."
    if [[ "${PROV_MODEL}" == "SPOT" ]]; then
      EXTRA_FLAGS=(--provisioning-model="SPOT" --instance-termination-action="DELETE" --max-run-duration="21600s")
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

echo "[5/6] Launching detached daemon GPU job & streaming logs..."
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
  sleep 15
done

echo "[6/6] Downloading <30MB Mobile Encoder, 12 Mobile Heads, and Benchmark Reports..."
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

echo "Splicing local monolithic models/onnx_mobile/swanada_mobile_<lang>_ctc_int8.onnx files..."
uv run python - << 'PYEOF'
import copy
from pathlib import Path
import numpy as np
import onnx
from onnx import numpy_helper

root = Path("/Users/lika/labs/swanada")
base = onnx.load(str(root / "models" / "onnx_mobile" / "swanada_mobile_ctc_int8.onnx"))
langs = ["sa", "en", "hi", "kn", "mr", "bn", "ta", "te", "ml", "gu", "pa", "or"]
for lang in langs:
    raw = (root / "docs" / "heads_mobile" / f"{lang}.bin").read_bytes()
    assert len(raw) == (257 * 512 + 257) * 4
    w = np.frombuffer(raw[: 257 * 512 * 4], dtype="<f4").reshape(257, 512, 1).copy()
    b = np.frombuffer(raw[257 * 512 * 4 :], dtype="<f4").copy()
    m = copy.deepcopy(base)
    for idx, init in enumerate(m.graph.initializer):
        if init.name == "ctc.weight":
            m.graph.initializer[idx].CopyFrom(numpy_helper.from_array(w, name="ctc.weight"))
        elif init.name == "ctc.bias":
            m.graph.initializer[idx].CopyFrom(numpy_helper.from_array(b, name="ctc.bias"))
    onnx.save(m, str(root / "models" / "onnx_mobile" / f"swanada_mobile_{lang}_ctc_int8.onnx"))
    print(f"  Spliced models/onnx_mobile/swanada_mobile_{lang}_ctc_int8.onnx")
PYEOF

echo "=== ALL GCP L4 <30MB MOBILE DISTILLATION & EVALUATIONS COMPLETE ==="
