#!/usr/bin/env python3
"""Assembles and pre-resamples all 480 held-out evaluation audio clips to 16 kHz."""

from __future__ import annotations

import json
from pathlib import Path
import tarfile
import wave
import numpy as np
import scipy.signal

ROOT = Path(__file__).resolve().parent.parent
MANIFEST_SRC = Path("/Users/lika/labs/ninada/artifacts/ninada_v5/test_v5.jsonl")
V3_DIR = Path("/Users/lika/labs/ninada/artifacts/ninada_v3/test_gt_wavs")
V5_SPLITS = Path("/Users/lika/labs/ninada/artifacts/ninada_v5/eval_splits")

OUT_WAVS_DIR = ROOT / "bench" / "test_gt_wavs_16k"
OUT_MANIFEST = ROOT / "bench" / "test_speech_suite.jsonl"


def main():
    OUT_WAVS_DIR.mkdir(parents=True, exist_ok=True)
    OUT_MANIFEST.parent.mkdir(parents=True, exist_ok=True)

    with open(MANIFEST_SRC, "r", encoding="utf-8") as f:
        items = [json.loads(line) for line in f if line.strip()]

    print(f"Loaded {len(items)} items from master manifest.")
    assert len(items) == 480

    tar_handles: dict[str, tarfile.TarFile] = {}
    for lang in ["bn", "en", "gu", "mr", "or", "pa"]:
        tar_path = V5_SPLITS / f"{lang}_eval.tar.gz"
        tar_handles[lang] = tarfile.open(tar_path, "r:gz")

    processed_manifest = []

    for idx, item in enumerate(items):
        utt_id = item["utt_id"]
        lang = item["lang"]
        text = item["text"]
        out_wav_path = OUT_WAVS_DIR / f"{utt_id}.wav"

        if not out_wav_path.exists():
            if lang in ["sa", "hi", "kn", "ta", "te", "ml"]:
                src_wav = V3_DIR / f"{utt_id}.wav"
                with wave.open(str(src_wav), "rb") as wf:
                    sr = wf.getframerate()
                    pcm_raw = wf.readframes(wf.getnframes())
                    pcm = np.frombuffer(pcm_raw, dtype=np.int16).astype(np.float32) / 32768.0
            else:
                tf = tar_handles[lang]
                member_path = f"test_gt_wavs/{utt_id}.wav"
                f_obj = tf.extractfile(member_path)
                with wave.open(f_obj, "rb") as wf:
                    sr = wf.getframerate()
                    pcm_raw = wf.readframes(wf.getnframes())
                    pcm = np.frombuffer(pcm_raw, dtype=np.int16).astype(np.float32) / 32768.0

            if sr != 16000:
                new_len = int(round(len(pcm) * 16000 / sr))
                pcm = scipy.signal.resample(pcm, new_len).astype(np.float32)

            pcm = np.clip(pcm, -1.0, 1.0)
            pcm_int16 = (pcm * 32767.0).astype(np.int16)

            with wave.open(str(out_wav_path), "wb") as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)
                wf.setframerate(16000)
                wf.writeframes(pcm_int16.tobytes())

        with wave.open(str(out_wav_path), "rb") as wf:
            dur = wf.getnframes() / wf.getframerate()
            samples = wf.getnframes()

        processed_manifest.append({
            "utt_id": utt_id,
            "lang": lang,
            "text": text,
            "wav_path": str(out_wav_path.relative_to(ROOT)),
            "duration_sec": round(dur, 4),
            "sample_rate": 16000,
            "samples": samples,
            "char_count": len(text),
            "word_count": len(text.split()),
        })

        if (idx + 1) % 80 == 0 or idx + 1 == len(items):
            print(f"Processed {idx + 1}/{len(items)} audio files...")

    for tf in tar_handles.values():
        tf.close()

    with open(OUT_MANIFEST, "w", encoding="utf-8") as f:
        for entry in processed_manifest:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    print(f"Completed! 480 clips in {OUT_WAVS_DIR} and manifest in {OUT_MANIFEST}")


if __name__ == "__main__":
    main()
