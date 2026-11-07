"""Empirical Challenger Test Harness for Streaming RTF and Long Continuous Latency.

Evaluates:
1. Streaming RTF across all 12 languages under varying chunk sizes (160, 320, 800, 1600, 2560, 5120 samples).
2. Chunk latency and sliding buffer ceiling in long continuous streaming (>= 30 seconds audio).
3. Prefix locking stability and 0.00% character churn.

Repository style constraint: Zero first-person pronouns in docstrings, comments, or identifiers.
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Sequence
import numpy as np
import pytest

from swanada import Swanada, load_audio

REPO_ROOT = Path(__file__).resolve().parents[1]
SAMPLES_DIR = REPO_ROOT / "docs" / "samples"
ALL_12_LANGUAGES = [
    "sa", "en", "hi", "kn", "mr", "bn", "ta", "te", "ml", "gu", "pa", "or"
]
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


# ==============================================================================
# Suite 1: Streaming RTF Across All 12 Languages Under Varying Chunk Sizes
# ==============================================================================

@pytest.mark.parametrize("chunk_size", CHUNK_SIZES)
@pytest.mark.parametrize("lang", ALL_12_LANGUAGES)
def test_streaming_rtf_under_varying_chunk_sizes(lang: str, chunk_size: int) -> None:
    """Verifies that RTF remains strictly below 1.0 across all languages and chunk sizes."""
    wav_path = SAMPLES_DIR / f"{lang}.wav"
    assert wav_path.exists(), f"Sample audio missing for {lang}: {wav_path}"

    pcm = load_audio(wav_path, target_sr=16000)
    audio_duration = float(len(pcm)) / 16000.0
    assert audio_duration > 0.0

    stt = Swanada.create(language=lang)
    stream = stt.stream(chunk_size_samples=chunk_size)

    total_push_time = 0.0
    committed_history: list[str] = []

    for offset in range(0, len(pcm), chunk_size):
        chunk = pcm[offset : min(len(pcm), offset + chunk_size)]
        t0 = time.perf_counter()
        st = stream.push(chunk)
        t1 = time.perf_counter()
        total_push_time += (t1 - t0)
        if st is not None:
            committed_history.append(st.committed)

    t0_fin = time.perf_counter()
    final_res = stream.finish()
    t1_fin = time.perf_counter()
    total_inference_time = total_push_time + (t1_fin - t0_fin)

    rtf = total_inference_time / audio_duration

    # Assert RTF < 1.0
    assert rtf < 1.0, (
        f"RTF violation for {lang} at chunk_size {chunk_size}: "
        f"measured RTF={rtf:.4f} (audio_dur={audio_duration:.2f}s, infer_time={total_inference_time:.2f}s)"
    )

    # Assert non-empty output
    assert len(final_res.text.strip()) > 0, (
        f"Empty transcript for {lang} at chunk_size {chunk_size}"
    )

    # Assert zero churn
    churn = calculate_character_churn(committed_history)
    assert churn == 0.0, (
        f"Character churn violation for {lang} at chunk_size {chunk_size}: {churn * 100:.2f}%"
    )


# ==============================================================================
# Suite 2: Long Continuous Streaming (>= 30 seconds audio) Latency & Buffer
# ==============================================================================

@pytest.mark.parametrize("chunk_size", [800, 1600])
@pytest.mark.parametrize("lang", ["sa", "en", "hi", "kn", "ta", "mr"])
def test_long_continuous_streaming_latency_and_buffer(lang: str, chunk_size: int) -> None:
    """Measures chunk latency and buffer size in continuous streaming >= 30 seconds.

    Verifies:
    1. Chunk latency mean < 50.0 ms.
    2. Chunk latency P95 < 50.0 ms.
    3. Audio buffer size <= 61440 samples at every single step.
    4. Prefix character churn == 0.00%.
    """
    wav_path = SAMPLES_DIR / f"{lang}.wav"
    assert wav_path.exists(), f"Sample audio missing for {lang}: {wav_path}"

    base_pcm = load_audio(wav_path, target_sr=16000)
    target_samples = 32 * 16000  # 32 seconds audio
    repeats = int(np.ceil(target_samples / len(base_pcm)))
    silence = np.zeros(8000, dtype=np.float32)  # 0.5s silence gap

    segments = []
    for _ in range(repeats):
        segments.append(base_pcm)
        segments.append(silence)
    long_pcm = np.concatenate(segments)[:target_samples]
    total_duration = float(len(long_pcm)) / 16000.0
    assert total_duration >= 30.0, f"Continuous audio duration {total_duration:.2f}s < 30.0s"

    stt = Swanada.create(language=lang)
    stream = stt.stream(chunk_size_samples=chunk_size)

    chunk_latencies_ms: list[float] = []
    buffer_sizes: list[int] = []
    committed_history: list[str] = []

    for offset in range(0, len(long_pcm), chunk_size):
        chunk = long_pcm[offset : min(len(long_pcm), offset + chunk_size)]
        t0 = time.perf_counter()
        st = stream.push(chunk)
        t1 = time.perf_counter()
        chunk_latencies_ms.append((t1 - t0) * 1000.0)

        # Direct inspection of stream buffer length
        buf_len = len(stream.audio_buffer)
        buffer_sizes.append(buf_len)
        assert buf_len <= 61440, (
            f"Buffer ceiling violation for {lang}: current buffer {buf_len} > 61440"
        )

        if st is not None:
            committed_history.append(st.committed)

    final_res = stream.finish()
    assert len(final_res.text.strip()) > 0

    mean_latency_ms = float(np.mean(chunk_latencies_ms))
    p95_latency_ms = float(np.percentile(chunk_latencies_ms, 95))
    max_buffer = max(buffer_sizes)

    assert mean_latency_ms < 50.0, (
        f"Mean chunk latency violation for {lang} (chunk_size {chunk_size}): "
        f"measured {mean_latency_ms:.2f} ms >= 50.0 ms"
    )
    assert p95_latency_ms < 50.0, (
        f"P95 chunk latency violation for {lang} (chunk_size {chunk_size}): "
        f"measured {p95_latency_ms:.2f} ms >= 50.0 ms"
    )
    assert max_buffer <= 61440, (
        f"Max buffer violation for {lang}: {max_buffer} > 61440"
    )

    churn = calculate_character_churn(committed_history)
    assert churn == 0.0, (
        f"Character churn violation in long stream for {lang}: {churn * 100:.2f}%"
    )
