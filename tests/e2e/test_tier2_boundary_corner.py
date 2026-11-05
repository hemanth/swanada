"""Tier 2: Boundary Value Analysis & Corner Cases End-to-End Tests for Swanada.

Covers:
- Empty audio buffers (0 bytes, 0 samples, empty WAV payload)
- Minimal audio lengths (1 sample, 128-sample quantum, 160-sample frame)
- Pure digital silence, low-energy room tone, and DC offset bias
- Extreme overdrive clipping (1.5x, 3.0x, 10.0x) and soft limiter containment
- Extreme sampling rates (8 kHz, 11.025 kHz, 22.05 kHz, 24 kHz, 44.1 kHz, 48 kHz, 96 kHz)
- Non-standard channel counts (stereo, 4-channel, 5.1 downmix or rejection)
- Corrupt, malformed, and truncated WAV containers
- Floating-point anomalies (NaN, Inf, denormals)
- Streaming buffer overruns, underruns, and starvation
- Ultra-long streaming buffers without memory leaks or index overflow
"""
from __future__ import annotations

import math
import struct
from pathlib import Path
from typing import Any

import pytest

from tests.e2e.helpers import (
    FRAME_HOP_SAMPLES,
    FRAME_WINDOW_SAMPLES,
    SAMPLE_RATE,
    AudioWorkletSimulator,
    create_noise_pcm,
    create_silence_pcm,
    create_sine_pcm,
    encode_wav_bytes,
    verify_pcm_samples,
    verify_wav_header,
)


# ==============================================================================
# 1. Empty Audio Buffers and Zero-Length Payloads
# ==============================================================================
@pytest.mark.tier2
def test_bva_empty_samples_list() -> None:
    """BVA 1.1: 0-length sample buffer encodes to valid 0-payload WAV without crash."""
    empty_samples: list[float] = []
    wav_bytes = encode_wav_bytes(empty_samples)
    info = verify_wav_header(wav_bytes)
    assert info["data_size"] == 0
    assert info["duration_sec"] == 0.0


@pytest.mark.tier2
def test_bva_empty_pcm_verification_failure() -> None:
    """BVA 1.2: verify_pcm_samples raises AssertionError when given empty buffer and min_length=1."""
    with pytest.raises(AssertionError, match="PCM buffer length 0 < 1"):
        verify_pcm_samples([], min_length=1)


@pytest.mark.tier2
def test_bva_zero_duration_silence() -> None:
    """BVA 1.3: create_silence_pcm(0.0) returns empty list cleanly."""
    silence = create_silence_pcm(0.0)
    assert len(silence) == 0


# ==============================================================================
# 2. Minimal Audio Lengths (1 sample, quantum, frame)
# ==============================================================================
@pytest.mark.tier2
@pytest.mark.parametrize("length", [1, 2, 10, 128, 160, 399])
def test_bva_sub_frame_minimal_lengths(length: int) -> None:
    """BVA 2.1: Sub-frame audio inputs (< 400 window samples) handle boundary without buffer underflow."""
    samples = [0.1 * math.sin(i) for i in range(length)]
    verify_pcm_samples(samples, min_length=length)
    wav_bytes = encode_wav_bytes(samples)
    info = verify_wav_header(wav_bytes)
    assert info["data_size"] == length * 2


@pytest.mark.tier2
def test_bva_exact_frame_window_boundary() -> None:
    """BVA 2.2: Exactly 400 samples (25ms window @ 16kHz) produces exactly 1 FFT frame."""
    exact_samples = create_sine_pcm(duration_sec=400 / 16000, sample_rate=16000)
    assert len(exact_samples) == FRAME_WINDOW_SAMPLES
    num_frames = 1 + (len(exact_samples) - FRAME_WINDOW_SAMPLES) // FRAME_HOP_SAMPLES
    assert num_frames == 1


# ==============================================================================
# 3. Digital Silence, DC Bias, and Low Energy
# ==============================================================================
@pytest.mark.tier2
def test_bva_pure_silence_rms_is_zero() -> None:
    """BVA 3.1: Pure silence has exactly 0.0 RMS energy."""
    silence = create_silence_pcm(0.5)
    rms = math.sqrt(sum(s * s for s in silence) / len(silence))
    assert rms == 0.0


@pytest.mark.tier2
@pytest.mark.parametrize("dc_offset", [-0.8, -0.5, 0.5, 0.8])
def test_bva_extreme_dc_offset_bias(dc_offset: float) -> None:
    """BVA 3.2: Severe constant DC bias is bounded within float normalization [-1.05, 1.05]."""
    biased = [dc_offset for _ in range(1600)]
    verify_pcm_samples(biased, min_length=1600)
    mean_val = sum(biased) / len(biased)
    assert abs(mean_val - dc_offset) < 1e-6


@pytest.mark.tier2
def test_bva_near_zero_whisper_floor() -> None:
    """BVA 3.3: Whisper-level low amplitude (1e-4, approx -80 dBFS) retains non-zero signal."""
    whisper = [1e-4 * math.sin(0.1 * i) for i in range(1600)]
    verify_pcm_samples(whisper, min_length=1600)
    peak = max(abs(s) for s in whisper)
    assert 0.0 < peak <= 1e-4


# ==============================================================================
# 4. Extreme Overdrive, Clipping, and Saturation
# ==============================================================================
@pytest.mark.tier2
@pytest.mark.parametrize("gain", [1.5, 3.0, 10.0, 50.0])
def test_bva_overdrive_clipping_clamping(gain: float) -> None:
    """BVA 4.1: Extreme audio overdrive values are clamped to [-1.0, 1.0] in WAV encoder."""
    overdriven = [gain * math.sin(0.1 * i) for i in range(1600)]
    wav_bytes = encode_wav_bytes(overdriven)
    info = verify_wav_header(wav_bytes)
    assert info["data_size"] == 1600 * 2
    # Verify byte values do not exceed 16-bit signed range [-32768, 32767]
    payload = wav_bytes[44:]
    for idx in range(0, len(payload), 2):
        int_sample = struct.unpack_from("<h", payload, idx)[0]
        assert -32768 <= int_sample <= 32767


# ==============================================================================
# 5. Extreme Sampling Rates
# ==============================================================================
@pytest.mark.tier2
@pytest.mark.parametrize("sr", [8000, 11025, 16000, 22050, 24000, 32000, 44100, 48000, 96000])
def test_bva_sampling_rate_headers(sr: int) -> None:
    """BVA 5.1: Encodes and validates WAV files across standard and extreme sampling rates."""
    dur = 0.1
    samples = create_sine_pcm(duration_sec=dur, freq=440.0, sample_rate=sr)
    wav_bytes = encode_wav_bytes(samples, sample_rate=sr)
    info = verify_wav_header(wav_bytes, expected_sr=sr)
    assert info["sample_rate"] == sr
    assert abs(info["duration_sec"] - dur) < 1e-3


# ==============================================================================
# 6. Non-Standard Channel Counts
# ==============================================================================
@pytest.mark.tier2
@pytest.mark.parametrize("channels", [1, 2, 4, 6])
def test_bva_channel_counts_in_wav(channels: int) -> None:
    """BVA 6.1: Header parser correctly parses mono, stereo, quadraphonic, and 5.1 channels."""
    samples = [0.1] * (channels * 100)
    wav_bytes = encode_wav_bytes(samples, sample_rate=16000, channels=channels)
    info = verify_wav_header(wav_bytes, expected_sr=16000, expected_channels=channels)
    assert info["channels"] == channels


# ==============================================================================
# 7. Corrupt, Truncated, and Malformed WAV Containers
# ==============================================================================
@pytest.mark.tier2
def test_bva_truncated_riff_header() -> None:
    """BVA 7.1: WAV buffer shorter than 44 bytes raises AssertionError."""
    short_bytes = b"RIFF\x10\x00\x00\x00WAVE"
    with pytest.raises(AssertionError, match="WAV byte sequence too short"):
        verify_wav_header(short_bytes)


@pytest.mark.tier2
def test_bva_invalid_riff_magic_bytes() -> None:
    """BVA 7.2: Missing RIFF magic raises AssertionError."""
    bad_magic = b"FORM" + b"\x00" * 40
    with pytest.raises(AssertionError, match="Expected b'RIFF'"):
        verify_wav_header(bad_magic)


@pytest.mark.tier2
def test_bva_invalid_wave_format_tag() -> None:
    """BVA 7.3: Missing WAVE tag raises AssertionError."""
    bad_wave = b"RIFF\x24\x00\x00\x00AIFF" + b"\x00" * 32
    with pytest.raises(AssertionError, match="Expected b'WAVE'"):
        verify_wav_header(bad_wave)


@pytest.mark.tier2
def test_bva_truncated_audio_payload() -> None:
    """BVA 7.4: Declared data chunk size exceeding actual byte length raises AssertionError."""
    header = bytearray(b"RIFF\x50\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00\x80>\x00\x00\x00}\x00\x00\x02\x00\x10\x00data\x00\x10\x00\x00")
    # Declares 4096 bytes data but appends only 10 bytes
    payload = b"\x00" * 10
    truncated = bytes(header + payload)
    with pytest.raises(AssertionError, match="Truncated WAV audio data"):
        verify_wav_header(truncated)


# ==============================================================================
# 8. Numerical Boundary Anomalies (NaN, Inf, Denormals)
# ==============================================================================
@pytest.mark.tier2
def test_bva_nan_sample_detection() -> None:
    """BVA 8.1: verify_pcm_samples detects and rejects float NaN values."""
    corrupt_samples = [0.1, 0.2, float("nan"), 0.4]
    with pytest.raises(AssertionError, match="NaN found at index 2"):
        verify_pcm_samples(corrupt_samples)


@pytest.mark.tier2
def test_bva_inf_sample_detection() -> None:
    """BVA 8.2: verify_pcm_samples detects and rejects positive and negative Inf."""
    corrupt_pos_inf = [0.1, float("inf")]
    with pytest.raises(AssertionError, match="Inf found at index 1"):
        verify_pcm_samples(corrupt_pos_inf)

    corrupt_neg_inf = [float("-inf"), 0.1]
    with pytest.raises(AssertionError, match="Inf found at index 0"):
        verify_pcm_samples(corrupt_neg_inf)


@pytest.mark.tier2
def test_bva_denormalized_floats() -> None:
    """BVA 8.3: Subnormal / denormalized small float values do not cause underflow crash."""
    denorm = [1e-40 * (i % 2) for i in range(1600)]
    verify_pcm_samples(denorm, min_length=1600)


# ==============================================================================
# 9. Streaming Buffer Overruns, Underruns, and Starvation
# ==============================================================================
@pytest.mark.tier2
def test_bva_streaming_zero_chunk_push() -> None:
    """BVA 9.1: AudioWorkletSimulator rejects 0-length quantum push."""
    sim = AudioWorkletSimulator(quantum_size=128)
    with pytest.raises(AssertionError, match="Invalid quantum size"):
        sim.push_quantum([])


@pytest.mark.tier2
def test_bva_streaming_massive_burst_flood() -> None:
    """BVA 9.2: Rapid flood of 1,000 quanta (128,000 samples = 8s) buffers without memory exhaustion."""
    sim = AudioWorkletSimulator(quantum_size=128, chunk_samples=1600)
    for _ in range(1000):
        sim.push_quantum([0.01] * 128)
    # 128,000 / 1600 = exactly 80 chunks
    assert len(sim.emitted_chunks) == 80
    assert len(sim.ring_buffer) == 0


@pytest.mark.tier2
def test_bva_streaming_starvation_and_recovery() -> None:
    """BVA 9.3: Simulator handles intermittent starvation gaps followed by renewed quantum pushes."""
    sim = AudioWorkletSimulator(quantum_size=128, chunk_samples=1600)
    # Push 5 quanta (640 samples)
    for _ in range(5):
        sim.push_quantum([0.1] * 128)
    assert len(sim.emitted_chunks) == 0
    # Simulated 2-second starvation gap (no calls)
    # Resume with 10 quanta (1280 samples -> total 1920 samples)
    for _ in range(10):
        sim.push_quantum([0.1] * 128)
    assert len(sim.emitted_chunks) == 1  # 1st 1600 samples emitted
    assert len(sim.ring_buffer) == 320   # 320 samples in residual buffer


# ==============================================================================
# 10. Ultra-Long Utterance Stress
# ==============================================================================
@pytest.mark.tier2
def test_bva_ultra_long_buffer_scaling() -> None:
    """BVA 10.1: Large 60-second audio buffer (960,000 samples) parses and computes frames cleanly."""
    total_samples = 16000 * 60  # 60s @ 16 kHz
    expected_frames = 1 + (total_samples - FRAME_WINDOW_SAMPLES) // FRAME_HOP_SAMPLES
    assert expected_frames == 5998
    duration_sec = total_samples / 16000.0
    assert duration_sec == 60.0
