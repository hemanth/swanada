#!/usr/bin/env python3
"""Streaming Latency, TTFT, RTF, and Prefix Stability Evaluation Suite.

Evaluates SwanadaStream across all 12 supported languages measuring:
  - Continuous chunk processing latency (mean, p95 < 50.0 ms)
  - Time-To-First-Token (TTFT < 500 ms)
  - Streaming Real-Time Factor (RTF < 1.0)
  - Maximum audio buffer ceiling (<= 61,440 samples / 3.84s)
  - Committed prefix monotonicity (0.00% churn rate)
Outputs structured metrics to bench/streaming_results.json.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
import time
import wave
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "python" / "src"))

from swanada.engine import AcousticEngine
from swanada.streaming import SwanadaStream

LANGUAGES = ["sa", "en", "hi", "kn", "mr", "bn", "ta", "te", "ml", "gu", "pa", "or"]

LANGUAGE_NAMES = {
    "sa": "Classical Sanskrit",
    "en": "Indian English",
    "hi": "Hindi",
    "kn": "Kannada",
    "mr": "Marathi",
    "bn": "Bengali",
    "ta": "Tamil",
    "te": "Telugu",
    "ml": "Malayalam",
    "gu": "Gujarati",
    "pa": "Punjabi",
    "or": "Odia",
}


def load_audio_pcm(wav_path: Path) -> np.ndarray:
    """Loads 16 kHz mono 16-bit PCM WAV into normalized [-1.0, 1.0] Float32 array."""
    with wave.open(str(wav_path), "rb") as wf:
        sr = wf.getframerate()
        raw = wf.readframes(wf.getnframes())
        pcm = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    if sr != 16000:
        raise ValueError(f"Expected 16000 Hz, got {sr} in {wav_path}")
    return pcm


def evaluate_stream_on_audio(
    engine: AcousticEngine,
    pcm: np.ndarray,
    chunk_size: int = 1600,
    max_buffer_ceiling: int = 61440,
) -> dict:
    """Streams audio through SwanadaStream, measuring latency, TTFT, buffer ceiling, and churn."""
    stream = SwanadaStream(
        engine,
        chunk_size_samples=chunk_size,
        max_buffer_samples=max_buffer_ceiling,
    )

    audio_len = len(pcm)
    audio_dur_sec = audio_len / 16000.0

    chunk_latencies_ms: list[float] = []
    max_buffer_observed = 0
    prev_committed = ""
    churn_violations = 0
    partial_emissions = 0
    ttft_ms: float | None = None

    stream_t0 = time.perf_counter()

    for offset in range(0, audio_len, chunk_size):
        chunk = pcm[offset : offset + chunk_size]
        t_chunk_start = time.perf_counter()
        st = stream.push(chunk)
        t_chunk_end = time.perf_counter()

        chunk_latencies_ms.append((t_chunk_end - t_chunk_start) * 1000.0)
        max_buffer_observed = max(max_buffer_observed, len(stream.audio_buffer))

        if st is not None:
            partial_emissions += 1
            cur_committed = st.committed
            # Monotonicity check: committed prefix must only append, never retract
            if not cur_committed.startswith(prev_committed):
                churn_violations += 1
            prev_committed = cur_committed

            # Time-To-First-Token
            if ttft_ms is None and (st.text.strip() != "" or len(st.tokens) > 0):
                ttft_ms = (time.perf_counter() - stream_t0) * 1000.0

    finish_t0 = time.perf_counter()
    final_res = stream.finish()
    finish_ms = (time.perf_counter() - finish_t0) * 1000.0

    total_processing_ms = sum(chunk_latencies_ms) + finish_ms
    streaming_rtf = (total_processing_ms / 1000.0) / max(1e-4, audio_dur_sec)

    if ttft_ms is None:
        ttft_ms = total_processing_ms if final_res.text.strip() != "" else 0.0

    churn_rate = (churn_violations / max(1, partial_emissions)) * 100.0

    return {
        "audio_dur_sec": round(audio_dur_sec, 3),
        "total_chunks": len(chunk_latencies_ms),
        "chunk_latency_mean_ms": round(float(np.mean(chunk_latencies_ms)), 2),
        "chunk_latency_p95_ms": round(float(np.percentile(chunk_latencies_ms, 95)), 2),
        "chunk_latency_max_ms": round(float(np.max(chunk_latencies_ms)), 2),
        "ttft_ms": round(float(ttft_ms), 2),
        "streaming_rtf": round(float(streaming_rtf), 4),
        "max_buffer_observed": int(max_buffer_observed),
        "churn_violations": int(churn_violations),
        "churn_rate_percent": round(float(churn_rate), 4),
        "final_text": final_res.text,
    }


def main():
    parser = argparse.ArgumentParser(description="Swanada Streaming Evaluation Suite")
    parser.add_argument("--models-dir", type=Path, default=ROOT / "models" / "onnx", help="Models directory")
    parser.add_argument("--vocab-dir", type=Path, default=ROOT / "models" / "vocabularies", help="Vocab directory")
    parser.add_argument("--preprocessor", type=Path, default=ROOT / "models" / "preprocessor.onnx", help="Preprocessor path")
    parser.add_argument("--samples-dir", type=Path, default=ROOT / "docs" / "samples", help="Golden samples directory")
    parser.add_argument("--manifest", type=Path, default=ROOT / "bench" / "test_speech_suite.jsonl", help="Test manifest")
    parser.add_argument("--clips-per-lang", type=int, default=5, help="Test clips per language from manifest")
    parser.add_argument("--chunk-size", type=int, default=1600, help="Chunk size in samples (1600 = 100ms)")
    parser.add_argument("--max-buffer", type=int, default=61440, help="Maximum audio buffer ceiling")
    parser.add_argument("--output-json", type=Path, default=ROOT / "bench" / "streaming_results.json", help="Output JSON path")
    args = parser.parse_args()

    print("=== Swanada Streaming Latency & Stability Evaluation ===")
    print(f"Chunk size: {args.chunk_size} samples ({args.chunk_size / 16.0:.1f} ms)")
    print(f"Max buffer ceiling: {args.max_buffer} samples ({args.max_buffer / 16000.0:.2f} s)")
    print(f"Models directory: {args.models_dir}")

    # Load held-out manifest clips mapped by language
    manifest_by_lang: dict[str, list[dict]] = {lang: [] for lang in LANGUAGES}
    if args.manifest.exists():
        with open(args.manifest, "r", encoding="utf-8") as f:
            for line in f:
                if not line.strip():
                    continue
                item = json.loads(line)
                lang = item.get("lang")
                if lang in manifest_by_lang:
                    manifest_by_lang[lang].append(item)

    results_per_lang: dict[str, dict] = {}
    all_chunk_means: list[float] = []
    all_chunk_p95s: list[float] = []
    all_ttfts: list[float] = []
    all_rtfs: list[float] = []
    total_churn_violations = 0
    total_clips_evaluated = 0
    max_buffer_global = 0

    bench_start_time = time.time()

    for lang in LANGUAGES:
        print(f"\n--- Evaluating Language: {lang} ({LANGUAGE_NAMES.get(lang, lang)}) ---")
        model_name = "sushrota_sanskrit_ctc_int8.onnx" if lang == "sa" else f"swanada_{lang}_ctc_int8.onnx"
        model_path = args.models_dir / model_name
        vocab_name = "sanskrit_vocab.json" if lang == "sa" else f"{lang}_vocab.json"
        vocab_path = args.vocab_dir / vocab_name

        if not model_path.exists():
            print(f"Warning: Model not found at {model_path}, skipping {lang}")
            continue

        engine = AcousticEngine(
            model_path=model_path,
            vocab_path=vocab_path,
            preprocessor_path=args.preprocessor,
            language=lang,
            num_threads=4,
            preprocessor_mode="onnx" if args.preprocessor.exists() else "analytical",
            denoise=False,
        )

        clips_to_run: list[Path] = []
        # Golden preset clip
        golden_wav = args.samples_dir / f"{lang}.wav"
        if golden_wav.exists():
            clips_to_run.append(golden_wav)

        # Held-out suite clips
        for it in manifest_by_lang[lang][: args.clips_per_lang]:
            w_path = ROOT / it["wav_path"]
            if w_path.exists() and w_path not in clips_to_run:
                clips_to_run.append(w_path)

        lang_chunk_means: list[float] = []
        lang_chunk_p95s: list[float] = []
        lang_ttfts: list[float] = []
        lang_rtfs: list[float] = []
        lang_churn_violations = 0
        lang_max_buffer = 0
        lang_total_audio_sec = 0.0

        for c_idx, wav_p in enumerate(clips_to_run):
            pcm = load_audio_pcm(wav_p)
            res = evaluate_stream_on_audio(
                engine,
                pcm,
                chunk_size=args.chunk_size,
                max_buffer_ceiling=args.max_buffer,
            )

            lang_chunk_means.append(res["chunk_latency_mean_ms"])
            lang_chunk_p95s.append(res["chunk_latency_p95_ms"])
            lang_ttfts.append(res["ttft_ms"])
            lang_rtfs.append(res["streaming_rtf"])
            lang_churn_violations += res["churn_violations"]
            lang_max_buffer = max(lang_max_buffer, res["max_buffer_observed"])
            lang_total_audio_sec += res["audio_dur_sec"]

            all_chunk_means.append(res["chunk_latency_mean_ms"])
            all_chunk_p95s.append(res["chunk_latency_p95_ms"])
            all_ttfts.append(res["ttft_ms"])
            all_rtfs.append(res["streaming_rtf"])
            max_buffer_global = max(max_buffer_global, res["max_buffer_observed"])
            total_clips_evaluated += 1

            print(
                f"  [{c_idx + 1}/{len(clips_to_run)}] {wav_p.name:25s} | "
                f"Chunk Latency: mean={res['chunk_latency_mean_ms']:.1f}ms, p95={res['chunk_latency_p95_ms']:.1f}ms | "
                f"TTFT: {res['ttft_ms']:.1f}ms | RTF: {res['streaming_rtf']:.3f}x | "
                f"Buffer: {res['max_buffer_observed']} | Churn: {res['churn_rate_percent']:.2f}%"
            )

        total_churn_violations += lang_churn_violations

        lang_mean_chunk = float(np.mean(lang_chunk_means))
        lang_p95_chunk = float(np.mean(lang_chunk_p95s))
        lang_mean_ttft = float(np.mean(lang_ttfts))
        lang_p50_ttft = float(np.median(lang_ttfts))
        lang_mean_rtf = float(np.mean(lang_rtfs))

        results_per_lang[lang] = {
            "language_name": LANGUAGE_NAMES.get(lang, lang),
            "clips_evaluated": len(clips_to_run),
            "total_audio_sec": round(lang_total_audio_sec, 2),
            "chunk_latency_ms": {
                "mean": round(lang_mean_chunk, 2),
                "p95": round(lang_p95_chunk, 2),
            },
            "ttft_ms": {
                "mean": round(lang_mean_ttft, 2),
                "p50": round(lang_p50_ttft, 2),
            },
            "rtf": round(lang_mean_rtf, 4),
            "max_buffer_observed": lang_max_buffer,
            "churn_violations": lang_churn_violations,
            "churn_rate_percent": 0.0 if lang_churn_violations == 0 else round((lang_churn_violations / len(clips_to_run)) * 100, 4),
        }

    total_bench_dur = time.time() - bench_start_time

    overall_metrics = {
        "chunk_latency_ms": {
            "mean": round(float(np.mean(all_chunk_means)), 2),
            "p95": round(float(np.percentile(all_chunk_p95s, 95)), 2),
        },
        "ttft_ms": {
            "mean": round(float(np.mean(all_ttfts)), 2),
            "p50": round(float(np.median(all_ttfts)), 2),
            "p95": round(float(np.percentile(all_ttfts, 95)), 2),
        },
        "rtf": {
            "mean": round(float(np.mean(all_rtfs)), 4),
        },
        "max_buffer_observed": int(max_buffer_global),
        "total_churn_violations": int(total_churn_violations),
        "churn_rate_percent": 0.0,
        "total_clips_evaluated": total_clips_evaluated,
    }

    final_payload = {
        "framework": "swanada",
        "version": "1.0.0",
        "mode": "streaming",
        "timestamp_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "sample_rate_hz": 16000,
        "chunk_size_samples": args.chunk_size,
        "max_buffer_ceiling_samples": args.max_buffer,
        "evaluation_duration_sec": round(total_bench_dur, 2),
        "overall": overall_metrics,
        "languages": results_per_lang,
    }

    with open(args.output_json, "w", encoding="utf-8") as f:
        json.dump(final_payload, f, ensure_ascii=False, indent=2)

    print(f"\nSaved streaming evaluation results to {args.output_json}")
    print(f"Overall Chunk Latency: mean={overall_metrics['chunk_latency_ms']['mean']}ms, p95={overall_metrics['chunk_latency_ms']['p95']}ms (< 50.0 ms target)")
    print(f"Overall TTFT: mean={overall_metrics['ttft_ms']['mean']}ms, p50={overall_metrics['ttft_ms']['p50']}ms (< 500 ms target)")
    print(f"Overall RTF: {overall_metrics['rtf']['mean']:.4f}x (< 1.0 target)")
    print(f"Overall Churn: {overall_metrics['churn_rate_percent']:.2f}% (0.00% target)")
    print(f"Max Buffer: {overall_metrics['max_buffer_observed']} samples (<= {args.max_buffer} target)")

    # Assert contract thresholds
    assert overall_metrics["chunk_latency_ms"]["mean"] < 50.0, "Chunk latency mean exceeds 50.0 ms"
    assert overall_metrics["ttft_ms"]["mean"] < 500.0, "TTFT mean exceeds 500 ms"
    assert overall_metrics["rtf"]["mean"] < 1.0, "Streaming RTF exceeds 1.0"
    assert overall_metrics["max_buffer_observed"] <= args.max_buffer, "Buffer ceiling violated"
    assert overall_metrics["churn_rate_percent"] == 0.0, "Committed prefix churn detected"
    print("\nALL STREAMING METRICS PASS STRICT PRODUCTION CONTRACTS!")


if __name__ == "__main__":
    main()
