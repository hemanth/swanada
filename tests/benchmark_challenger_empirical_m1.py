"""Empirical Challenger Evaluation Runner for M1 Iteration 3.

Measures and prints comprehensive verification data:
1. Complete RTF matrix across 12 languages x 6 chunk sizes (160, 320, 800, 1600, 2560, 5120 samples).
2. Long continuous streaming (>= 30 seconds audio) across all 12 languages measuring mean latency, P95 latency, max buffer size, and churn.
3. Prefix locking invariance and character churn summary.

Repository style constraint: Zero first-person pronouns in docstrings, comments, or identifiers.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
import numpy as np

from swanada import Swanada, load_audio

REPO_ROOT = Path(__file__).resolve().parents[1]
SAMPLES_DIR = REPO_ROOT / "docs" / "samples"
ALL_12_LANGUAGES = [
    "sa", "en", "hi", "kn", "mr", "bn", "ta", "te", "ml", "gu", "pa", "or"
]
CHUNK_SIZES = [160, 320, 800, 1600, 2560, 5120]


def calculate_character_churn(committed_history: list[str]) -> float:
    """Calculates character churn percentage across sequential committed emissions."""
    total_deletions = 0
    total_characters = 0

    for i in range(1, len(committed_history)):
        prev = committed_history[i - 1]
        curr = committed_history[i]
        total_characters += len(curr)

        common_len = 0
        for c1, c2 in zip(prev, curr):
            if c1 == c2:
                common_len += 1
            else:
                break

        deletions = len(prev) - common_len
        total_deletions += deletions

    if total_characters == 0:
        return 0.0
    return float(total_deletions) / float(total_characters)


def run_rtf_sweep() -> dict[str, dict[int, float]]:
    """Runs empirical RTF measurement across all 12 languages and 6 chunk sizes."""
    print("=" * 80)
    print("EMPIRICAL CHALLENGER RTF SWEEP (12 Languages x 6 Chunk Sizes)")
    print("=" * 80)

    rtf_results: dict[str, dict[int, float]] = {}

    for lang in ALL_12_LANGUAGES:
        wav_path = SAMPLES_DIR / f"{lang}.wav"
        pcm = load_audio(wav_path, target_sr=16000)
        audio_dur = float(len(pcm)) / 16000.0
        stt = Swanada.create(language=lang)
        rtf_results[lang] = {}

        print(f"[{lang}] audio duration: {audio_dur:.2f}s")
        for csize in CHUNK_SIZES:
            stream = stt.stream(chunk_size_samples=csize)
            committed_history: list[str] = []
            t_total = 0.0

            for offset in range(0, len(pcm), csize):
                chunk = pcm[offset : min(len(pcm), offset + csize)]
                t0 = time.perf_counter()
                st = stream.push(chunk)
                t1 = time.perf_counter()
                t_total += (t1 - t0)
                if st is not None:
                    committed_history.append(st.committed)

            t0_f = time.perf_counter()
            final_res = stream.finish()
            t1_f = time.perf_counter()
            t_total += (t1_f - t0_f)

            rtf = t_total / audio_dur
            churn = calculate_character_churn(committed_history)
            rtf_results[lang][csize] = rtf
            status = "PASS" if rtf < 1.0 and churn == 0.0 else "FAIL"
            print(f"  chunk_size={csize:4d} | RTF={rtf:.4f} | Churn={churn*100:.2f}% | Status={status}")

    return rtf_results


def run_long_stream_benchmark() -> list[dict[str, object]]:
    """Runs long continuous streaming benchmark (32 seconds audio) across all 12 languages."""
    print("\n" + "=" * 80)
    print("LONG CONTINUOUS STREAMING BENCHMARK (>= 30 Seconds Audio Across 12 Languages)")
    print("=" * 80)

    results: list[dict[str, object]] = []

    for lang in ALL_12_LANGUAGES:
        wav_path = SAMPLES_DIR / f"{lang}.wav"
        base_pcm = load_audio(wav_path, target_sr=16000)
        target_samples = 32 * 16000  # 32.0 seconds
        repeats = int(np.ceil(target_samples / len(base_pcm)))
        silence = np.zeros(8000, dtype=np.float32)  # 0.5s silence gap

        segments = []
        for _ in range(repeats):
            segments.append(base_pcm)
            segments.append(silence)
        long_pcm = np.concatenate(segments)[:target_samples]
        total_duration = float(len(long_pcm)) / 16000.0

        stt = Swanada.create(language=lang)
        stream = stt.stream(chunk_size_samples=1600)  # 100ms chunk

        chunk_latencies_ms: list[float] = []
        buffer_sizes: list[int] = []
        committed_history: list[str] = []

        for offset in range(0, len(long_pcm), 1600):
            chunk = long_pcm[offset : min(len(long_pcm), offset + 1600)]
            t0 = time.perf_counter()
            st = stream.push(chunk)
            t1 = time.perf_counter()
            chunk_latencies_ms.append((t1 - t0) * 1000.0)
            buffer_sizes.append(len(stream.audio_buffer))
            if st is not None:
                committed_history.append(st.committed)

        t0_fin = time.perf_counter()
        final_res = stream.finish()
        t1_fin = time.perf_counter()

        mean_latency = float(np.mean(chunk_latencies_ms))
        p95_latency = float(np.percentile(chunk_latencies_ms, 95))
        max_buffer = max(buffer_sizes)
        churn = calculate_character_churn(committed_history)
        total_inf_time = (sum(chunk_latencies_ms) / 1000.0) + (t1_fin - t0_fin)
        rtf = total_inf_time / total_duration

        res = {
            "language": lang,
            "duration_s": total_duration,
            "mean_latency_ms": round(mean_latency, 2),
            "p95_latency_ms": round(p95_latency, 2),
            "max_buffer_samples": max_buffer,
            "buffer_ceiling_ok": max_buffer <= 61440,
            "churn_percent": round(churn * 100.0, 4),
            "rtf": round(rtf, 4),
            "status": "PASS" if mean_latency < 50.0 and p95_latency < 50.0 and max_buffer <= 61440 and churn == 0.0 else "FAIL"
        }
        results.append(res)
        print(f"[{lang}] dur={total_duration:.1f}s | mean_lat={mean_latency:5.2f}ms | p95_lat={p95_latency:5.2f}ms | max_buf={max_buffer:5d} | Churn={churn*100:.2f}% | RTF={rtf:.4f} | {res['status']}")

    return results


if __name__ == "__main__":
    rtf_table = run_rtf_sweep()
    long_stream_results = run_long_stream_benchmark()
    output_path = REPO_ROOT / "tests" / "challenger_benchmark_results.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump({"rtf_table": rtf_table, "long_stream": long_stream_results}, f, indent=2)
    print(f"\nEmpirical results saved to {output_path}")
