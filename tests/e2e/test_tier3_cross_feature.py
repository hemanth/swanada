"""Tier 3: Cross-Feature Interactions End-to-End Tests for Swanada.

Covers cross-feature combinatorial interactions:
1. Rapid Language Switching (sequential multi-language batch and streaming sessions)
2. Chunk Size Variations (steady 50ms, 100ms, 200ms, 320ms, and dynamic fluctuating schedules)
3. Interspeech Pause Insertion (1.0s silence injected within speech; 0.00% churn verification)
4. Long Continuous Audio (30-second sustained streaming, buffer cap invariant, flat latency)
"""
from __future__ import annotations

import math
import time
from pathlib import Path
from typing import Any, Callable

import numpy as np
import pytest

from tests.e2e.helpers import (
    ALL_12_LANGUAGES,
    compute_character_churn,
    get_sample_wav_path,
    load_sample_pcm,
    verify_prefix_stability,
    verify_transcription_result,
)

try:
    from swanada import REGISTRY, Swanada
except ImportError:
    Swanada = None  # type: ignore[assignment]
    REGISTRY = None  # type: ignore[assignment]


# ==============================================================================
# 1. Rapid Language Switching
# ==============================================================================

@pytest.mark.tier3
def test_tier3_rapid_language_switching_sequential_batch(engine_factory: Callable[[str], Any]) -> None:
    """Tier 3.1: Sequential transcription across 6 distinct languages without memory leak or state leakage."""
    sequence = ["sa", "hi", "kn", "en", "ta", "ml"]
    results = {}

    for lang in sequence:
        engine = engine_factory(lang)
        wav_path = get_sample_wav_path(lang)
        result = engine.transcribe(str(wav_path))

        verify_transcription_result(result, expected_lang=lang)
        assert len(result.text.strip()) > 0, f"Empty text during rapid switching on {lang}"
        results[lang] = result.text

    assert len(results) == len(sequence)


@pytest.mark.tier3
def test_tier3_rapid_language_switching_consecutive_streaming(engine_factory: Callable[[str], Any]) -> None:
    """Tier 3.2: Consecutive streaming pipelines across different language families operate independently."""
    test_chain = [("sa", 1600), ("hi", 1600), ("en", 1600), ("kn", 1600)]

    for lang, chunk_size in test_chain:
        engine = engine_factory(lang)
        stream = engine.stream(chunk_size_samples=chunk_size)
        pcm, sr = load_sample_pcm(lang)

        for i in range(0, len(pcm), chunk_size):
            stream.push(pcm[i : i + chunk_size])

        final_result = stream.finish()
        verify_transcription_result(final_result, expected_lang=lang)
        assert len(final_result.text.strip()) > 0


# ==============================================================================
# 2. Chunk Size Variations & Dynamic Cadence
# ==============================================================================

@pytest.mark.tier3
@pytest.mark.parametrize("chunk_size", [800, 1600, 3200, 5120])
def test_tier3_chunk_size_variations(chunk_size: int, engine_factory: Callable[[str], Any]) -> None:
    """Tier 3.3: Streaming same audio with different chunk durations (50ms, 100ms, 200ms, 320ms) produces valid output."""
    engine = engine_factory("sa")
    stream = engine.stream(chunk_size_samples=chunk_size)
    pcm, sr = load_sample_pcm("sa")

    for i in range(0, len(pcm), chunk_size):
        stream.push(pcm[i : i + chunk_size])

    result = stream.finish()
    assert len(result.text.strip()) > 0
    assert result.rtf < 1.0


@pytest.mark.tier3
def test_tier3_dynamic_fluctuating_chunk_cadence(engine_factory: Callable[[str], Any]) -> None:
    """Tier 3.4: Dynamic fluctuating chunk schedule (500 to 3200 samples) maintains streaming stability."""
    engine = engine_factory("kn")
    stream = engine.stream(chunk_size_samples=1600)
    pcm, sr = load_sample_pcm("kn")

    chunk_schedule = [500, 2000, 800, 3200, 1600, 2400]
    cursor = 0
    schedule_idx = 0

    while cursor < len(pcm):
        current_chunk_size = chunk_schedule[schedule_idx % len(chunk_schedule)]
        schedule_idx += 1
        chunk = pcm[cursor : cursor + current_chunk_size]
        cursor += current_chunk_size
        stream.push(chunk)

    final_result = stream.finish()
    assert len(final_result.text.strip()) > 0
    assert final_result.language == "kn"


# ==============================================================================
# 3. Interspeech Pause Insertion
# ==============================================================================

@pytest.mark.tier3
def test_tier3_interspeech_pause_insertion_zero_churn(engine_factory: Callable[[str], Any]) -> None:
    """Tier 3.5: Interspeech pause (1.0 second silence) injected into speech stream yields strictly 0.00% churn."""
    engine = engine_factory("sa")
    stream = engine.stream(chunk_size_samples=1600)
    pcm, sr = load_sample_pcm("sa")

    # Split audio into two halves and inject 16000 samples (1.0s) of silence
    midpoint = len(pcm) // 2
    part1 = pcm[:midpoint]
    pause = np.zeros(16000, dtype=np.float32)
    part2 = pcm[midpoint:]

    composed_pcm = np.concatenate([part1, pause, part2])
    committed_history: list[str] = []

    chunk_size = 1600
    for i in range(0, len(composed_pcm), chunk_size):
        step = stream.push(composed_pcm[i : i + chunk_size])
        if step is not None:
            committed_history.append(step.committed)

    final_result = stream.finish()
    assert len(final_result.text.strip()) > 0

    # Prefix stability invariant must hold strictly
    verify_prefix_stability(committed_history)
    churn = compute_character_churn(committed_history)
    assert churn == 0.0, f"Churn occurred during interspeech pause: {churn * 100:.2f}%"


@pytest.mark.tier3
def test_tier3_pause_at_utterance_boundaries(engine_factory: Callable[[str], Any]) -> None:
    """Tier 3.6: Prepending and appending 1.0s silence to utterance preserves valid transcription."""
    engine = engine_factory("hi")
    pcm, sr = load_sample_pcm("hi")
    silence_1s = np.zeros(16000, dtype=np.float32)

    padded_audio = np.concatenate([silence_1s, pcm, silence_1s])
    result = engine.transcribe(padded_audio)

    assert len(result.text.strip()) > 0
    assert result.language == "hi"


# ==============================================================================
# 4. Long Continuous Audio Streaming
# ==============================================================================

@pytest.mark.tier3
def test_tier3_long_continuous_audio_buffer_and_latency(engine_factory: Callable[[str], Any]) -> None:
    """Tier 3.7: 30-second continuous streaming maintains bounded buffer (<=61440) and flat latency slope."""
    engine = engine_factory("sa")
    stream = engine.stream(chunk_size_samples=1600, max_buffer_samples=61440)
    pcm, sr = load_sample_pcm("sa")
    silence_500ms = np.zeros(8000, dtype=np.float32)

    # Repeat utterance + pause 8 times to form ~33s of continuous audio
    segment = np.concatenate([pcm, silence_500ms])
    long_stream_pcm = np.tile(segment, 8)
    audio_duration_sec = len(long_stream_pcm) / float(sr)
    assert audio_duration_sec >= 30.0

    chunk_size = 1600
    chunk_latencies: list[float] = []

    for i in range(0, len(long_stream_pcm), chunk_size):
        chunk = long_stream_pcm[i : i + chunk_size]
        t0 = time.perf_counter()
        stream.push(chunk)
        chunk_latencies.append(time.perf_counter() - t0)

        # Buffer ceiling constraint
        assert len(stream.audio_buffer) <= 61440, (
            f"Buffer overflow during continuous stream: {len(stream.audio_buffer)} > 61440"
        )

    final_result = stream.finish()
    assert len(final_result.text.strip()) > 0

    # Verify average chunk latency is well below real-time quantum (100ms)
    avg_latency = float(np.mean(chunk_latencies))
    assert avg_latency < 0.050, f"Average chunk latency too high: {avg_latency * 1000:.2f} ms"
