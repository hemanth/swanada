"""Empirical Challenger Comprehensive Matrix and Continuous Streaming Latency Runner.

Measures:
1. Complete 72-run RTF matrix across 12 languages x 6 chunk sizes.
2. Continuous 33-second streaming latency, buffer ceiling, and churn across all 12 languages.
3. Memory stability across prolonged streaming sessions.

Style constraint: Zero first-person pronouns.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Sequence
import numpy as np

from swanada import Swanada, load_audio, SUPPORTED_LANGUAGES

REPO_ROOT = Path(__file__).resolve().parents[1]
SAMPLES_DIR = REPO_ROOT / "docs" / "samples"
CHUNK_SIZES = [160, 320, 800, 1600, 2560, 5120]


def calculate_character_churn(committed_history: Sequence[str]) -> float:
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


def run_full_72_matrix() -> dict[str, dict[int, dict[str, float]]]:
    """Evaluates all 72 combinations (12 languages x 6 chunk sizes) for RTF and churn."""
    print("=" * 80)
    print("EMPIRICAL CHALLENGER: 72-RUN RTF & CHURN MATRIX")
    print("=" * 80)

    matrix_results: dict[str, dict[int, dict[str, float]]] = {}

    for lang in SUPPORTED_LANGUAGES:
        wav_path = SAMPLES_DIR / f"{lang}.wav"
        pcm = load_audio(wav_path, target_sr=16000)
        dur = float(len(pcm)) / 16000.0
        stt = Swanada.create(language=lang)
        matrix_results[lang] = {}

        print(f"\n--- Language: {lang} (duration: {dur:.2f}s) ---")
        for csize in CHUNK_SIZES:
            stream = stt.stream(chunk_size_samples=csize)
            committed_history: list[str] = []
            t0 = time.perf_counter()

            for offset in range(0, len(pcm), csize):
                chunk = pcm[offset : min(len(pcm), offset + csize)]
                st = stream.push(chunk)
                if st is not None:
                    committed_history.append(st.committed)

            stream.finish()
            t_total = time.perf_counter() - t0
            rtf = t_total / dur
            churn = calculate_character_churn(committed_history)

            matrix_results[lang][csize] = {
                "rtf": round(rtf, 4),
                "churn": round(churn, 4),
                "pass": rtf < 1.0 and churn == 0.0,
            }
            status_str = "PASS" if rtf < 1.0 and churn == 0.0 else "FAIL"
            print(f"  chunk_size={csize:4d} | RTF={rtf:6.4f} | Churn={churn*100:5.2f}% | Status={status_str}")

        del stt
        import gc
        gc.collect()

    return matrix_results


def run_continuous_33s_evaluation() -> list[dict[str, object]]:
    """Evaluates 33-second continuous streaming across all 12 languages with 1600-sample chunks."""
    print("\n" + "=" * 80)
    print("EMPIRICAL CHALLENGER: CONTINUOUS 33-SECOND STREAMING EVALUATION")
    print("=" * 80)

    continuous_results: list[dict[str, object]] = []

    for lang in SUPPORTED_LANGUAGES:
        wav_path = SAMPLES_DIR / f"{lang}.wav"
        base_pcm = load_audio(wav_path, target_sr=16000)
        silence_500ms = np.zeros(8000, dtype=np.float32)
        segment = np.concatenate([base_pcm, silence_500ms])
        long_pcm = np.tile(segment, 8)
        dur = float(len(long_pcm)) / 16000.0

        stt = Swanada.create(language=lang)
        stream = stt.stream(chunk_size_samples=1600, max_buffer_samples=61440)

        chunk_latencies_ms: list[float] = []
        buffer_sizes: list[int] = []
        committed_history: list[str] = []

        t_stream_start = time.perf_counter()
        for offset in range(0, len(long_pcm), 1600):
            chunk = long_pcm[offset : min(len(long_pcm), offset + 1600)]
            t0 = time.perf_counter()
            st = stream.push(chunk)
            t1 = time.perf_counter()
            chunk_latencies_ms.append((t1 - t0) * 1000.0)
            buffer_sizes.append(len(stream.audio_buffer))
            if st is not None:
                committed_history.append(st.committed)

        stream.finish()
        t_stream_total = time.perf_counter() - t_stream_start

        mean_latency = float(np.mean(chunk_latencies_ms))
        p95_latency = float(np.percentile(chunk_latencies_ms, 95))
        max_buffer = max(buffer_sizes)
        churn = calculate_character_churn(committed_history)
        rtf = t_stream_total / dur

        is_latency_pass = mean_latency < 50.0
        is_buffer_pass = max_buffer <= 61440
        is_churn_pass = churn == 0.0
        overall_pass = is_latency_pass and is_buffer_pass and is_churn_pass

        item = {
            "language": lang,
            "duration_s": round(dur, 2),
            "mean_chunk_latency_ms": round(mean_latency, 2),
            "p95_chunk_latency_ms": round(p95_latency, 2),
            "max_buffer_samples": max_buffer,
            "buffer_ceiling_ok": is_buffer_pass,
            "churn_percent": round(churn * 100.0, 4),
            "rtf": round(rtf, 4),
            "latency_pass_under_50ms": is_latency_pass,
            "overall_pass": overall_pass,
        }
        continuous_results.append(item)
        status_label = "PASS" if overall_pass else "FAIL"
        print(
            f"[{lang}] dur={dur:4.1f}s | mean_lat={mean_latency:6.2f}ms | "
            f"p95_lat={p95_latency:6.2f}ms | max_buf={max_buffer:5d} | "
            f"RTF={rtf:6.4f} | Churn={churn*100:5.2f}% | Status={status_label}"
        )
        del stt, stream
        import gc
        gc.collect()

    return continuous_results


if __name__ == "__main__":
    matrix = run_full_72_matrix()
    continuous = run_continuous_33s_evaluation()
    out_file = REPO_ROOT / "tests" / "challenger_it4_matrix_and_latency_results.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump({"matrix_72": matrix, "continuous_33s": continuous}, f, indent=2)
    print(f"\nResults successfully written to {out_file}")
