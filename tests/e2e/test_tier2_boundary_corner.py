"""Tier 2: Boundary Value Analysis & Corner Cases End-to-End Tests for Swanada.

Covers boundary value analysis and edge-case operational limits:
1. Empty Audio Buffers (0 bytes, 0 samples, empty WAV payload, empty chunk push)
2. Digital Silence & Low-Energy Gating (0 RMS, room tone below 1e-4, zero hallucinations)
3. Sub-100ms Micro-Chunks (10ms, 20ms, 50ms, 80ms, unaligned prime-sized chunk buffers)
4. Buffer Capacity Ceiling (61,440 samples = 3.84s buffer cap, context sliding, no memory leaks)
5. Loud Noise & Acoustic Overdrive (high-amplitude white noise, 2.5x clipping containment, DC bias)
6. Multi-Rate Resampling (8 kHz narrowband, 22.05 kHz, 44.1 kHz CD audio, 48 kHz broadcast)
"""
from __future__ import annotations

import math
import struct
import wave
from pathlib import Path
from typing import Any, Callable

import numpy as np
import pytest

from tests.e2e.helpers import (
    ALL_12_LANGUAGES,
    FRAME_HOP_SAMPLES,
    FRAME_WINDOW_SAMPLES,
    SAMPLE_RATE,
    create_noise_pcm,
    create_silence_pcm,
    create_sine_pcm,
    encode_wav_bytes,
    get_sample_wav_path,
    load_sample_pcm,
    verify_pcm_samples,
    verify_transcription_result,
    verify_wav_header,
)

try:
    from swanada import Swanada, resample_audio
except ImportError:
    Swanada = None  # type: ignore[assignment]
    resample_audio = None  # type: ignore[assignment]


# ==============================================================================
# 1. Empty Audio Buffers and Zero-Length Payloads
# ==============================================================================

@pytest.mark.tier2
def test_bva_empty_audio_transcribe_buffer(engine_factory: Callable[[str], Any]) -> None:
    """BVA 1.1: Transcribing empty float numpy array returns empty transcript without crash."""
    engine = engine_factory("sa")
    empty_pcm = np.array([], dtype=np.float32)
    result = engine.transcribe(empty_pcm)
    assert result.text == "", f"Expected empty text for 0 samples, got: {result.text!r}"
    assert result.tokens == []


@pytest.mark.tier2
def test_bva_empty_audio_stream_push(engine_factory: Callable[[str], Any]) -> None:
    """BVA 1.2: Pushing empty chunk into SwanadaStream returns None or empty transcript without error."""
    engine = engine_factory("sa")
    stream = engine.stream(chunk_size_samples=1600)
    empty_chunk = np.array([], dtype=np.float32)

    step = stream.push(empty_chunk)
    assert step is None or step.text == ""

    final_result = stream.finish()
    assert final_result.text == ""


@pytest.mark.tier2
def test_bva_empty_wav_file(engine_factory: Callable[[str], Any], tmp_path: Path) -> None:
    """BVA 1.3: Transcribing a valid 44-byte WAV file with zero data payload returns empty result."""
    empty_wav = tmp_path / "zero_payload.wav"
    wav_bytes = encode_wav_bytes([])
    empty_wav.write_bytes(wav_bytes)

    engine = engine_factory("hi")
    result = engine.transcribe(str(empty_wav))
    assert result.text == ""
    assert len(result.tokens) == 0


@pytest.mark.tier2
@pytest.mark.parametrize("length", [1, 2, 10, 128, 160, 399])
def test_bva_sub_frame_minimal_lengths(length: int, engine_factory: Callable[[str], Any]) -> None:
    """BVA 1.4: Sub-frame audio inputs (< 400 window samples) handle boundary without buffer underflow."""
    engine = engine_factory("sa")
    sub_frame_pcm = np.zeros(length, dtype=np.float32)
    result = engine.transcribe(sub_frame_pcm)
    assert isinstance(result.text, str)
    assert len(result.text) == 0


# ==============================================================================
# 2. Digital Silence & Low-Energy Gating
# ==============================================================================

@pytest.mark.tier2
@pytest.mark.parametrize("duration_sec", [0.5, 1.0, 2.0, 3.0])
def test_bva_pure_silence_batch_gating(duration_sec: float, engine_factory: Callable[[str], Any]) -> None:
    """BVA 2.1: Pure digital silence across various durations produces zero phantom text emissions."""
    engine = engine_factory("kn")
    num_samples = int(duration_sec * 16000)
    silence_pcm = np.zeros(num_samples, dtype=np.float32)

    result = engine.transcribe(silence_pcm)
    assert result.text.strip() == "", f"Silence hallucination detected: {result.text!r}"
    assert len(result.tokens) == 0


@pytest.mark.tier2
def test_bva_silence_streaming_gating(engine_factory: Callable[[str], Any]) -> None:
    """BVA 2.2: Continuous stream of silence chunks triggers silence gating without accumulating tokens."""
    engine = engine_factory("en")
    stream = engine.stream(chunk_size_samples=1600)
    silence_chunk = np.zeros(1600, dtype=np.float32)

    for step_idx in range(20):  # 2.0 seconds of silence
        step = stream.push(silence_chunk)
        # Silence gating suppresses inference (returning None) or emits empty committed text
        assert step is None or step.committed == "", (
            f"Committed non-empty text during silence at step {step_idx}: {getattr(step, 'committed', None)!r}"
        )

    final_result = stream.finish()
    assert final_result.text.strip() == ""



@pytest.mark.tier2
def test_bva_low_energy_dither_silence(engine_factory: Callable[[str], Any]) -> None:
    """BVA 2.3: Audio below acoustic RMS threshold (< 1e-4) is suppressed by the silence gate."""
    engine = engine_factory("sa")
    num_samples = 16000  # 1.0 second
    # Synthesize sub-threshold low energy dither
    dither = np.random.uniform(-5e-5, 5e-5, size=num_samples).astype(np.float32)
    rms = float(np.sqrt(np.mean(dither ** 2)))
    assert rms < 1e-4

    result = engine.transcribe(dither)
    assert result.text.strip() == ""


# ==============================================================================
# 3. Very Short (<100ms) Micro-Chunks
# ==============================================================================

@pytest.mark.tier2
@pytest.mark.parametrize("chunk_samples", [160, 320, 800, 1280])
def test_bva_sub_100ms_micro_chunks(chunk_samples: int, engine_factory: Callable[[str], Any]) -> None:
    """BVA 3.1: Sub-100ms chunks (10ms, 20ms, 50ms, 80ms) stream without buffer underflow or index errors."""
    engine = engine_factory("sa")
    stream = engine.stream(chunk_size_samples=chunk_samples)
    pcm, sr = load_sample_pcm("sa")

    # Push in micro-chunk increments
    for i in range(0, len(pcm), chunk_samples):
        chunk = pcm[i : i + chunk_samples]
        stream.push(chunk)

    final_result = stream.finish()
    assert len(final_result.text.strip()) > 0
    assert len(final_result.tokens) > 0


@pytest.mark.tier2
@pytest.mark.parametrize("chunk_size", [137, 251, 509, 1021])
def test_bva_unaligned_prime_chunks(chunk_size: int, engine_factory: Callable[[str], Any]) -> None:
    """BVA 3.2: Prime-sized and non-frame-multiple chunks process seamlessly through the ring buffer."""
    engine = engine_factory("hi")
    stream = engine.stream(chunk_size_samples=1600)
    pcm, sr = load_sample_pcm("hi")

    for i in range(0, len(pcm), chunk_size):
        chunk = pcm[i : i + chunk_size]
        stream.push(chunk)

    final_result = stream.finish()
    assert len(final_result.text.strip()) > 0


# ==============================================================================
# 4. Maximum Buffer Ceiling Enforcement (61,440 samples = 3.84s)
# ==============================================================================

@pytest.mark.tier2
def test_bva_max_buffer_ceiling_enforcement(engine_factory: Callable[[str], Any]) -> None:
    """BVA 4.1: Stream buffer size is strictly capped at max_buffer_samples (61440) under sustained audio."""
    engine = engine_factory("sa")
    stream = engine.stream(chunk_size_samples=5120, max_buffer_samples=61440)
    pcm, sr = load_sample_pcm("sa")

    # Repeat audio to exceed 100,000 samples (over 6 seconds)
    long_pcm = np.tile(pcm, 3)
    assert len(long_pcm) > 100000

    chunk_size = 5120
    for i in range(0, len(long_pcm), chunk_size):
        chunk = long_pcm[i : i + chunk_size]
        stream.push(chunk)
        # Verify internal buffer cap invariant
        assert len(stream.audio_buffer) <= 61440, (
            f"Buffer ceiling violated: buffer length {len(stream.audio_buffer)} exceeds 61440 cap"
        )

    final_result = stream.finish()
    assert len(final_result.text) > 0


@pytest.mark.tier2
def test_bva_exact_buffer_boundary(engine_factory: Callable[[str], Any]) -> None:
    """BVA 4.2: Pushing exactly 61,440 samples does not cause off-by-one truncation or overflow."""
    engine = engine_factory("mr")
    stream = engine.stream(chunk_size_samples=1600, max_buffer_samples=61440)

    # Push exactly 61440 samples of speech-level tone
    total_samples = 61440
    tone_pcm = 0.1 * np.sin(2.0 * np.pi * 440.0 * np.arange(total_samples) / 16000.0).astype(np.float32)

    for i in range(0, total_samples, 1600):
        stream.push(tone_pcm[i : i + 1600])

    assert len(stream.audio_buffer) <= 61440
    final_result = stream.finish()
    assert isinstance(final_result.text, str)


# ==============================================================================
# 5. Loud Noise & Acoustic Overdrive
# ==============================================================================

@pytest.mark.tier2
def test_bva_loud_white_noise_stability(engine_factory: Callable[[str], Any]) -> None:
    """BVA 5.1: High-amplitude white noise (0.95 amplitude) processes safely without NaN or Inf."""
    engine = engine_factory("ta")
    noise = np.random.uniform(-0.95, 0.95, size=32000).astype(np.float32)

    result = engine.transcribe(noise)
    assert isinstance(result.text, str)
    assert not math.isnan(result.rtf)
    assert not math.isinf(result.rtf)


@pytest.mark.tier2
def test_bva_overdrive_clipping_containment(engine_factory: Callable[[str], Any]) -> None:
    """BVA 5.2: Heavily clipped speech (2.5x gain saturated to [-1.0, 1.0]) transcribes without crash."""
    engine = engine_factory("sa")
    pcm, sr = load_sample_pcm("sa")
    clipped = np.clip(pcm * 2.5, -1.0, 1.0).astype(np.float32)

    result = engine.transcribe(clipped)
    assert len(result.text.strip()) > 0
    assert result.rtf < 1.0


@pytest.mark.tier2
def test_bva_high_dc_offset_bias(engine_factory: Callable[[str], Any]) -> None:
    """BVA 5.3: Speech with substantial DC bias (+0.5 offset) is sanitized by filterbank frontend."""
    engine = engine_factory("bn")
    pcm, sr = load_sample_pcm("bn")
    biased = np.clip(pcm + 0.5, -1.0, 1.0).astype(np.float32)

    result = engine.transcribe(biased)
    assert isinstance(result.text, str)
    assert len(result.text) > 0


# ==============================================================================
# 6. Multi-Rate Resampling
# ==============================================================================

@pytest.mark.tier2
@pytest.mark.parametrize(
    "source_rate",
    [8000, 22050, 44100, 48000],
)
def test_bva_multi_rate_resampling(source_rate: int, engine_factory: Callable[[str], Any], tmp_path: Path) -> None:
    """BVA 6.1: Non-standard sample rates (8k, 22.05k, 44.1k, 48k) resample and transcribe cleanly."""
    if resample_audio is None:
        pytest.skip("resample_audio function not available")

    engine = engine_factory("sa")
    pcm_16k, _ = load_sample_pcm("sa")

    # Generate synthetic speech-duration sine at source_rate
    duration = 1.0
    t = np.linspace(0, duration, int(duration * source_rate), endpoint=False)
    source_audio = (0.2 * np.sin(2.0 * np.pi * 300.0 * t)).astype(np.float32)

    # Resample to 16 kHz
    resampled_16k = resample_audio(source_audio, source_rate, 16000)
    expected_length = int(duration * 16000)
    assert abs(len(resampled_16k) - expected_length) <= 10, (
        f"Resampled length mismatch: expected ~{expected_length}, got {len(resampled_16k)}"
    )

    result = engine.transcribe(resampled_16k, sample_rate=16000)
    assert isinstance(result.text, str)
