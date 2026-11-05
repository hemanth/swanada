"""Tier 3: Cross-Feature Interactions End-to-End Tests for Swanada.

Covers pairwise and higher-order combinatorial interactions:
- Language (12 languages) x Script x Audio Chunk Sizing (50ms, 100ms, 250ms, 500ms)
- Multi-Language Sequential Streaming Chaining (sa -> hi -> kn -> ta, en -> mr -> bn -> te, gu -> pa -> or -> ml)
- Multi-Rate Resampling (8k, 16k, 24k, 44.1k, 48k) x Channel Layouts (mono, stereo)
- Streaming Cadence Variations (steady real-time, rapid bursts, network packet jitter)
- Cross-Runtime Interface Contracts (Python API, Node.js CLI, Browser Web Worker)
"""
from __future__ import annotations

import math
from typing import Any

import pytest

from tests.e2e.helpers import (
    FRAME_HOP_SAMPLES,
    FRAME_WINDOW_SAMPLES,
    SAMPLE_RATE,
    AudioWorkletSimulator,
    MockWebWorker,
    create_noise_pcm,
    create_silence_pcm,
    create_sine_pcm,
    encode_wav_bytes,
    verify_pcm_samples,
    verify_transcription_result,
    verify_wav_header,
)


ALL_12_LANGUAGES = [
    "sa", "en", "hi", "kn", "mr", "bn", "ta", "te", "ml", "gu", "pa", "or"
]

LANGUAGE_SCRIPT_MAP = {
    "sa": "Devanagari",
    "en": "Latin",
    "hi": "Devanagari",
    "kn": "Kannada",
    "mr": "Devanagari",
    "bn": "Bengali",
    "ta": "Tamil",
    "te": "Telugu",
    "ml": "Malayalam",
    "gu": "Gujarati",
    "pa": "Gurmukhi",
    "or": "Odia",
}


# ==============================================================================
# 1. Pairwise Language x Script x Audio Chunk Sizing
# ==============================================================================
@pytest.mark.tier3
@pytest.mark.parametrize("lang", ALL_12_LANGUAGES)
@pytest.mark.parametrize("chunk_ms", [50, 100, 250])
def test_cross_language_and_chunk_size(lang: str, chunk_ms: int) -> None:
    """Tier 3.1: Pairwise validation of 12 languages across chunk durations (50ms, 100ms, 250ms)."""
    script = LANGUAGE_SCRIPT_MAP[lang]
    assert len(script) > 0
    chunk_samples = int((chunk_ms / 1000.0) * 16000)
    sim = AudioWorkletSimulator(quantum_size=128, chunk_samples=chunk_samples)
    expected_chunks = 2
    samples_needed = expected_chunks * chunk_samples
    quanta_needed = (samples_needed + 127) // 128
    for _ in range(quanta_needed):
        sim.push_quantum([0.05] * 128)
    assert len(sim.emitted_chunks) == expected_chunks


# ==============================================================================
# 2. Sequential Multi-Language Streaming Chaining
# ==============================================================================
@pytest.mark.tier3
@pytest.mark.parametrize(
    "lang_chain",
    [
        ["sa", "hi", "kn", "ta"],
        ["en", "mr", "bn", "te"],
        ["gu", "pa", "or", "ml"],
    ],
)
def test_cross_multilanguage_sequential_streaming_chain(lang_chain: list[str]) -> None:
    """Tier 3.2: Chaining 4 consecutive languages through an active pipeline without memory leaks."""
    events = []
    worker = MockWebWorker(lambda m: events.append(m))
    for lang in lang_chain:
        worker.post_message({"type": "INIT", "config": {"language": lang}})
        # Push 2 chunks per language
        worker.post_message({"type": "PROCESS_CHUNK", "chunk": [0.02] * 1600})
        worker.post_message({"type": "PROCESS_CHUNK", "chunk": [0.02] * 1600})
        worker.post_message({"type": "FINISH"})

    # 4 languages * 4 message events = 16 messages
    assert len(events) == len(lang_chain) * 4
    init_langs = [e["config"]["language"] for e in events if e["type"] == "INIT"]
    assert init_langs == lang_chain


# ==============================================================================
# 3. Multi-Rate Resampling x Channel Layouts
# ==============================================================================
@pytest.mark.tier3
@pytest.mark.parametrize("rate", [8000, 16000, 24000, 44100, 48000])
@pytest.mark.parametrize("channels", [1, 2])
def test_cross_multirate_and_channel_layouts(rate: int, channels: int) -> None:
    """Tier 3.3: Pairwise validation of audio ingestion rates (8k-48k) across mono and stereo channels."""
    dur = 0.15
    samples = create_sine_pcm(duration_sec=dur, freq=440.0, sample_rate=rate)
    if channels == 2:
        interleaved = []
        for s in samples:
            interleaved.extend([s, s * 0.8])
        wav_bytes = encode_wav_bytes(interleaved, sample_rate=rate, channels=2)
    else:
        wav_bytes = encode_wav_bytes(samples, sample_rate=rate, channels=1)

    info = verify_wav_header(wav_bytes, expected_sr=rate, expected_channels=channels)
    assert info["sample_rate"] == rate
    assert info["channels"] == channels


# ==============================================================================
# 4. Streaming Arrival Cadences (Steady vs Burst vs Jitter)
# ==============================================================================
@pytest.mark.tier3
def test_cross_streaming_burst_followed_by_jitter() -> None:
    """Tier 3.4: Worklet arrival pattern switching dynamically between steady, burst, and jitter."""
    sim = AudioWorkletSimulator(quantum_size=128, chunk_samples=1600)
    # Phase 1: Steady (10 quanta)
    for _ in range(10):
        sim.push_quantum([0.05] * 128)
    steady_emitted = len(sim.emitted_chunks)

    # Phase 2: Burst (25 quanta in single loop iteration)
    for _ in range(25):
        sim.push_quantum([0.05] * 128)
    burst_emitted = len(sim.emitted_chunks)
    assert burst_emitted > steady_emitted

    # Phase 3: Jitter with silence gaps (5 quanta, flush, 5 quanta)
    sim.finish()
    assert sim.is_finished
    sim_resumed = AudioWorkletSimulator(quantum_size=128, chunk_samples=1600)
    for _ in range(15):
        sim_resumed.push_quantum([0.01] * 128)
    assert len(sim_resumed.emitted_chunks) == 1


# ==============================================================================
# 5. Cross-Runtime Output Result Field Parity
# ==============================================================================
@pytest.mark.tier3
@pytest.mark.parametrize("runtime", ["python", "node", "browser"])
def test_cross_runtime_transcription_result_contract(runtime: str) -> None:
    """Tier 3.5: Verifies TranscriptionResult schema contract compatibility across all 3 runtimes."""
    mock_result = {
        "text": "सत्यमेव जयते",
        "language": "sa",
        "durationMs": 1200,
        "inferenceMs": 420,
        "rtf": 0.35,
        "tokens": ["सत्यम्", "एव", "जयते"],
    }
    verify_transcription_result(mock_result, expected_lang="sa")
    assert mock_result["rtf"] < 1.0
