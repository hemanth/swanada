#!/usr/bin/env python3
"""Evaluate Swanada (`studio` 177.4 MiB vs `mobile` 25.35 MiB) on Standard Open Public ASR Benchmarks.

Open Benchmarks Evaluated (100% unseen official `test` splits streamed via Hugging Face Parquet API):
  1. `google/fleurs` (`test` split across all 11 Indic + English FLEURS languages:
     `en_us`, `hi_in`, `kn_in`, `mr_in`, `bn_in`, `ta_in`, `te_in`, `ml_in`, `gu_in`, `pa_in`, `or_in`)
  2. `prathoshap/sushrota-sanskrit-asr-data` (`in_the_wild_test` split — real wild Classical Sanskrit `sa`)
  3. `openslr/librispeech_asr` (`clean/test` — OpenASR Leaderboard standard LibriSpeech test-clean)
  4. `openslr/librispeech_asr` (`other/test` — OpenASR Leaderboard noisy/challenging LibriSpeech test-other)
  5. `MushanW/GLOBE` (`default/test` — unseen multi-accent global & South Asian English speakers)
  6. `edinburghcstr/ami` (`ihm/test` — real spontaneous conversational meeting speech)

Outputs:
  - `bench/open_benchmarks_results.json` with `B = 1,000` bootstrap 95% CIs for CER, WER, and RTF.
"""

from __future__ import annotations

import argparse
import io
import json
import math
from pathlib import Path
import shutil
import sys
import time
from typing import Any, Dict, List, Optional, Tuple
import urllib.request

import numpy as np
import pyarrow.parquet as pq
import scipy.signal
import soundfile as sf

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT / "python" / "src") not in sys.path:
    sys.path.insert(0, str(REPO_ROOT / "python" / "src"))
if str(REPO_ROOT / "tools") not in sys.path:
    sys.path.insert(0, str(REPO_ROOT / "tools"))

from gcp_joint_12lang_train import FLEURS_LANG_MAP, levenshtein_seq, list_parquet_urls, normalize_eval_text
from swanada.core import Swanada

OPEN_SUITES: List[Tuple[str, str, str, str, str]] = [
    # (suite_id, repo_id, config, split, swanada_lang)
    ("librispeech_test_clean", "openslr/librispeech_asr", "clean", "test", "en"),
    ("librispeech_test_other", "openslr/librispeech_asr", "other", "test", "en"),
    ("globe_multi_accent_test", "MushanW/GLOBE", "default", "test", "en"),
    ("ami_spontaneous_meeting_test", "edinburghcstr/ami", "ihm", "test", "en"),
    ("sushrota_sanskrit_wild_test", "prathoshap/sushrota-sanskrit-asr-data", "default", "in_the_wild_test", "sa"),
] + [
    (f"fleurs_{lang}_test", "google/fleurs", fl_cfg, "test", lang)
    for lang, fl_cfg in FLEURS_LANG_MAP.items()
]


def _download_parquet(url: str, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 1024:
        return dest
    tmp = dest.with_suffix(".part")
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=120) as resp, open(tmp, "wb") as f:
                shutil.copyfileobj(resp, f)
            tmp.replace(dest)
            return dest
        except Exception:
            if attempt == 3:
                raise
            time.sleep(2 * (attempt + 1))
    return dest


def _extract_clips_from_parquet(
    parquet_path: Path, max_clips: int, min_sec: float = 1.0, max_sec: float = 16.0
) -> List[Tuple[np.ndarray, str]]:
    clips: List[Tuple[np.ndarray, str]] = []
    pf = pq.ParquetFile(parquet_path)
    filler_only = {"mm", "uh", "um", "hmm", "mhm", "erm", "ah", "eh", "yeah", "okay", "ok"}
    for batch in pf.iter_batches(batch_size=128):
        if len(clips) >= max_clips:
            break
        for row in batch.to_pylist():
            if len(clips) >= max_clips:
                break
            txt = None
            for col in ("raw_transcription", "transcription", "transcript", "text", "sentence"):
                v = row.get(col)
                if isinstance(v, str) and len(v.strip()) >= 3:
                    txt = v.strip()
                    break
            if not txt or "<" in txt or "[" in txt:
                continue
            words = [w.strip(".,?!'\":;-").lower() for w in txt.split()]
            words = [w for w in words if w]
            if len(words) < 2 or all(w in filler_only for w in words):
                continue

            aud = row.get("audio")
            if not isinstance(aud, dict):
                continue
            try:
                if aud.get("bytes"):
                    pcm, sr = sf.read(io.BytesIO(aud["bytes"]), dtype="float32")
                elif aud.get("array") is not None:
                    pcm = np.asarray(aud["array"], dtype="float32")
                    sr = int(aud.get("sampling_rate", 16000))
                else:
                    continue
                if pcm.ndim > 1:
                    pcm = pcm.mean(axis=-1)
                if sr != 16000:
                    g = math.gcd(sr, 16000)
                    pcm = scipy.signal.resample_poly(pcm, 16000 // g, sr // g).astype(np.float32)
            except Exception:
                continue

            dur = len(pcm) / 16000.0
            if not (min_sec <= dur <= max_sec):
                continue
            if float(np.max(np.abs(pcm))) < 1e-4:
                continue
            clips.append((pcm.astype(np.float32), txt))
    return clips


def bootstrap_ci95(vals: List[float], n_boot: int = 1000, seed: int = 42) -> Tuple[float, List[float]]:
    if not vals:
        return 0.0, [0.0, 0.0]
    arr = np.asarray(vals, dtype=np.float64)
    rng = np.random.default_rng(seed)
    boots = [float(np.mean(arr[rng.integers(0, len(arr), size=len(arr))])) for _ in range(n_boot)]
    return round(float(arr.mean()), 4), [
        round(float(np.percentile(boots, 2.5)), 4),
        round(float(np.percentile(boots, 97.5)), 4),
    ]


def evaluate_tier(
    tier: str,
    suites_clips: Dict[str, Tuple[str, List[Tuple[np.ndarray, str]]]],
    num_threads: int = 4,
) -> Dict[str, Any]:
    engines: Dict[str, Swanada] = {}
    suite_reports: Dict[str, Any] = {}
    fleurs_cers: List[float] = []
    fleurs_wers: List[float] = []
    all_cers: List[float] = []
    all_wers: List[float] = []
    all_rtfs: List[float] = []

    for suite_id, (lang, clips) in suites_clips.items():
        if lang not in engines:
            engines[lang] = Swanada.create(language=lang, tier=tier, num_threads=num_threads)
        stt = engines[lang]
        cers, wers, rtfs = [], [], []
        total_audio_sec = 0.0
        for pcm, ref in clips:
            nr = normalize_eval_text(ref, lang)
            if not nr:
                continue
            res = stt.transcribe(pcm, sample_rate=16000)
            nh = normalize_eval_text(res.text, lang)
            cer = levenshtein_seq(list(nr), list(nh)) / max(1, len(nr))
            wer = levenshtein_seq(nr.split(), nh.split()) / max(1, len(nr.split()))
            cers.append(cer)
            wers.append(wer)
            rtfs.append(float(res.rtf))
            total_audio_sec += len(pcm) / 16000.0

        cer_m, cer_ci = bootstrap_ci95(cers)
        wer_m, wer_ci = bootstrap_ci95(wers)
        rtf_m, rtf_ci = bootstrap_ci95(rtfs)
        suite_reports[suite_id] = {
            "language": lang,
            "n_clips": len(cers),
            "audio_sec": round(total_audio_sec, 1),
            "cer_mean": cer_m,
            "cer_ci95": cer_ci,
            "wer_mean": wer_m,
            "wer_ci95": wer_ci,
            "rtf_mean": rtf_m,
            "rtf_ci95": rtf_ci,
        }
        if suite_id.startswith("fleurs_") or suite_id == "sushrota_sanskrit_wild_test":
            fleurs_cers.extend(cers)
            fleurs_wers.extend(wers)
        all_cers.extend(cers)
        all_wers.extend(wers)
        all_rtfs.extend(rtfs)
        print(
            f"[{tier.upper():6s} | {suite_id:30s} | {lang}] n={len(cers):3d} | "
            f"CER={cer_m*100:5.2f}% [{cer_ci[0]*100:.2f}%, {cer_ci[1]*100:.2f}%] | "
            f"WER={wer_m*100:5.2f}% | RTF={rtf_m:.3f}x",
            flush=True,
        )

    fl_cer_m, fl_cer_ci = bootstrap_ci95(fleurs_cers)
    fl_wer_m, fl_wer_ci = bootstrap_ci95(fleurs_wers)
    ov_cer_m, ov_cer_ci = bootstrap_ci95(all_cers)
    ov_wer_m, ov_wer_ci = bootstrap_ci95(all_wers)
    ov_rtf_m, ov_rtf_ci = bootstrap_ci95(all_rtfs)
    return {
        "tier": tier,
        "total_clips": len(all_cers),
        "overall_cer_mean": ov_cer_m,
        "overall_cer_ci95": ov_cer_ci,
        "overall_wer_mean": ov_wer_m,
        "overall_wer_ci95": ov_wer_ci,
        "overall_rtf_mean": ov_rtf_m,
        "overall_rtf_ci95": ov_rtf_ci,
        "multilingual_12lang_wild_cer_mean": fl_cer_m,
        "multilingual_12lang_wild_cer_ci95": fl_cer_ci,
        "multilingual_12lang_wild_wer_mean": fl_wer_m,
        "multilingual_12lang_wild_wer_ci95": fl_wer_ci,
        "suites": suite_reports,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tiers", nargs="+", default=["studio", "mobile"], choices=["studio", "mobile"])
    ap.add_argument("--clips-per-suite", type=int, default=80)
    ap.add_argument("--threads", type=int, default=4)
    ap.add_argument("--cache-dir", type=Path, default=Path("/tmp/swanada_open_bench_cache"))
    ap.add_argument("--output", type=Path, default=REPO_ROOT / "bench" / "open_benchmarks_results.json")
    args = ap.parse_args()

    args.cache_dir.mkdir(parents=True, exist_ok=True)
    suites_clips: Dict[str, Tuple[str, List[Tuple[np.ndarray, str]]]] = {}

    for suite_id, repo_id, cfg, split, lang in OPEN_SUITES:
        npz_cache = args.cache_dir / f"{suite_id}_{args.clips_per_suite}.npz"
        json_cache = args.cache_dir / f"{suite_id}_{args.clips_per_suite}.json"
        if npz_cache.exists() and json_cache.exists():
            arrs = np.load(npz_cache)
            txts = json.loads(json_cache.read_text(encoding="utf-8"))
            clips = [(arrs[f"a_{i}"], txts[i]) for i in range(len(txts))]
            suites_clips[suite_id] = (lang, clips)
            continue

        urls = list_parquet_urls(repo_id, config=cfg, split=split)
        collected: List[Tuple[np.ndarray, str]] = []
        for u_idx, url in enumerate(urls[:2]):
            if len(collected) >= args.clips_per_suite:
                break
            pq_file = args.cache_dir / f"{suite_id}_shard{u_idx}.parquet"
            _download_parquet(url, pq_file)
            batch_clips = _extract_clips_from_parquet(pq_file, max_clips=args.clips_per_suite - len(collected))
            collected.extend(batch_clips)
            pq_file.unlink(missing_ok=True)
        np.savez(npz_cache, **{f"a_{i}": c[0] for i, c in enumerate(collected)})
        json_cache.write_text(json.dumps([c[1] for c in collected], ensure_ascii=False), encoding="utf-8")
        suites_clips[suite_id] = (lang, collected)
        print(f"[cache] Prepared {len(collected)} open test clips for {suite_id} ({repo_id} {cfg}/{split})", flush=True)

    existing: Dict[str, Any] = {}
    if args.output.exists():
        try:
            existing = json.loads(args.output.read_text(encoding="utf-8"))
        except Exception:
            existing = {}

    results_by_tier = existing.get("tiers", {})
    for t in args.tiers:
        results_by_tier[t] = evaluate_tier(t, suites_clips, num_threads=args.threads)

    out_payload = {
        "benchmark": "swanada_open_public_benchmarks_v1_1_0",
        "bootstrap_resamples": 1000,
        "clips_per_suite": args.clips_per_suite,
        "tiers": results_by_tier,
    }
    args.output.write_text(json.dumps(out_payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Saved open benchmark results to {args.output}")


if __name__ == "__main__":
    main()
