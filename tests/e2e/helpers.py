"""Acoustic, structural, and contract verification helpers for Swanada E2E Test Suite."""
from __future__ import annotations

import math
import struct
import unicodedata
from typing import Any, Callable, Sequence


SAMPLE_RATE = 16000
FRAME_HOP_SAMPLES = 160  # 10 ms @ 16 kHz
FRAME_WINDOW_SAMPLES = 400  # 25 ms @ 16 kHz
N_MELS = 80
BLANK_TOKEN_ID = 0


def create_sine_pcm(
    duration_sec: float,
    freq: float = 440.0,
    sample_rate: int = SAMPLE_RATE,
    amplitude: float = 0.5,
) -> list[float]:
    """Generate deterministic sinusoidal PCM audio samples normalized to [-1.0, 1.0]."""
    total_samples = int(duration_sec * sample_rate)
    samples: list[float] = []
    omega = 2.0 * math.pi * freq / sample_rate
    for i in range(total_samples):
        val = amplitude * math.sin(omega * i)
        samples.append(val)
    return samples


def create_silence_pcm(duration_sec: float, sample_rate: int = SAMPLE_RATE) -> list[float]:
    """Generate pure digital silence PCM samples."""
    total_samples = int(duration_sec * sample_rate)
    return [0.0] * total_samples


def create_noise_pcm(
    duration_sec: float,
    sample_rate: int = SAMPLE_RATE,
    amplitude: float = 0.1,
    seed: int = 42,
) -> list[float]:
    """Generate pseudo-random deterministic white noise samples."""
    total_samples = int(duration_sec * sample_rate)
    samples: list[float] = []
    state = seed
    for _ in range(total_samples):
        # Linear Congruential Generator (LCG) for deterministic cross-platform noise
        state = (1103515245 * state + 12345) & 0x7FFFFFFF
        unit_val = (state / 0x7FFFFFFF) * 2.0 - 1.0
        samples.append(unit_val * amplitude)
    return samples


def encode_wav_bytes(
    samples: Sequence[float],
    sample_rate: int = SAMPLE_RATE,
    channels: int = 1,
    bits_per_sample: int = 16,
) -> bytes:
    """Encode float PCM samples into standard 16-bit PCM RIFF WAV byte format."""
    num_samples = len(samples)
    byte_rate = sample_rate * channels * (bits_per_sample // 8)
    block_align = channels * (bits_per_sample // 8)
    data_size = num_samples * block_align
    total_size = 36 + data_size

    header = bytearray()
    # RIFF chunk descriptor
    header.extend(b"RIFF")
    header.extend(struct.pack("<I", total_size))
    header.extend(b"WAVE")

    # fmt sub-chunk
    header.extend(b"fmt ")
    header.extend(struct.pack("<I", 16))  # Subchunk1Size for PCM
    header.extend(struct.pack("<H", 1))   # AudioFormat: 1 = PCM
    header.extend(struct.pack("<H", channels))
    header.extend(struct.pack("<I", sample_rate))
    header.extend(struct.pack("<I", byte_rate))
    header.extend(struct.pack("<H", block_align))
    header.extend(struct.pack("<H", bits_per_sample))

    # data sub-chunk
    header.extend(b"data")
    header.extend(struct.pack("<I", data_size))

    # Sample conversion to 16-bit signed integer
    payload = bytearray(data_size)
    max_val = 32767.0
    for idx, s in enumerate(samples):
        clamped = max(-1.0, min(1.0, float(s)))
        int_sample = int(round(clamped * max_val))
        if int_sample < -32768:
            int_sample = -32768
        elif int_sample > 32767:
            int_sample = 32767
        struct.pack_into("<h", payload, idx * 2, int_sample)

    return bytes(header + payload)


def verify_wav_header(
    wav_bytes: bytes,
    expected_sr: int = SAMPLE_RATE,
    expected_channels: int = 1,
) -> dict[str, Any]:
    """Verify RIFF WAV binary structure, fmt chunk, and payload integrity."""
    assert len(wav_bytes) >= 44, f"WAV byte sequence too short ({len(wav_bytes)} bytes)"
    riff, total_size, wave = struct.unpack("<4sI4s", wav_bytes[:12])
    assert riff == b"RIFF", f"Expected b'RIFF', got {riff}"
    assert wave == b"WAVE", f"Expected b'WAVE', got {wave}"

    fmt_idx = wav_bytes.find(b"fmt ")
    assert fmt_idx != -1, "Missing b'fmt ' subchunk"
    fmt, fmt_size = struct.unpack("<4sI", wav_bytes[fmt_idx : fmt_idx + 8])
    assert fmt == b"fmt ", f"Expected b'fmt ', got {fmt}"
    assert fmt_size >= 16, f"Expected fmt_size >= 16, got {fmt_size}"

    audio_format, channels, sample_rate, byte_rate, block_align, bits_per_sample = struct.unpack(
        "<HHIIHH", wav_bytes[fmt_idx + 8 : fmt_idx + 24]
    )
    assert audio_format == 1, f"Expected PCM format (1), got {audio_format}"
    assert channels == expected_channels, f"Expected {expected_channels} channels, got {channels}"
    assert sample_rate == expected_sr, f"Expected {expected_sr} Hz, got {sample_rate}"
    assert bits_per_sample == 16, f"Expected 16-bit audio, got {bits_per_sample}"

    data_idx = wav_bytes.find(b"data")
    assert data_idx != -1, "Missing b'data' subchunk"
    data_size = struct.unpack("<I", wav_bytes[data_idx + 4 : data_idx + 8])[0]
    assert data_size >= 0, "Negative data size"
    assert len(wav_bytes) >= data_idx + 8 + data_size, "Truncated WAV audio data"

    duration_sec = data_size / (sample_rate * channels * 2) if sample_rate > 0 else 0.0

    return {
        "sample_rate": sample_rate,
        "channels": channels,
        "bits_per_sample": bits_per_sample,
        "data_size": data_size,
        "duration_sec": duration_sec,
    }


def verify_pcm_samples(samples: Sequence[float], min_length: int = 1) -> None:
    """Verify float PCM buffer contains valid non-NaN/non-Inf values within [-1.05, 1.05]."""
    assert len(samples) >= min_length, f"PCM buffer length {len(samples)} < {min_length}"
    for idx, s in enumerate(samples[:2000]):
        val = float(s)
        assert not math.isnan(val), f"NaN found at index {idx}"
        assert not math.isinf(val), f"Inf found at index {idx}"
        assert abs(val) <= 1.05, f"PCM sample out of normalized range at index {idx}: {val}"


def verify_transcription_result(result: Any, expected_lang: str | None = None) -> None:
    """Verify transcription result object satisfies the public API contract."""
    # Attribute or dict-style access
    if hasattr(result, "text"):
        text = result.text
        language = result.language
        duration_ms = result.durationMs if hasattr(result, "durationMs") else result.duration_ms
        inference_ms = result.inferenceMs if hasattr(result, "inferenceMs") else result.inference_ms
        rtf = result.rtf
        tokens = result.tokens
    elif isinstance(result, dict):
        text = result.get("text", "")
        language = result.get("language", "")
        duration_ms = result.get("durationMs", result.get("duration_ms", 0))
        inference_ms = result.get("inferenceMs", result.get("inference_ms", 0))
        rtf = result.get("rtf", 0.0)
        tokens = result.get("tokens", [])
    else:
        raise AssertionError(f"Unexpected result object type: {type(result)}")

    assert isinstance(text, str), f"Expected text to be str, got {type(text)}"
    assert isinstance(language, str), f"Expected language to be str, got {type(language)}"
    if expected_lang:
        assert language == expected_lang, f"Expected lang {expected_lang}, got {language}"
    assert duration_ms >= 0, f"Expected duration_ms >= 0, got {duration_ms}"
    assert inference_ms >= 0, f"Expected inference_ms >= 0, got {inference_ms}"
    assert rtf >= 0.0, f"Expected rtf >= 0.0, got {rtf}"
    assert isinstance(tokens, list), f"Expected tokens to be list, got {type(tokens)}"


def compute_levenshtein_distance(seq1: Sequence[Any], seq2: Sequence[Any]) -> int:
    """Compute standard Levenshtein edit distance between two sequences."""
    n1, n2 = len(seq1), len(seq2)
    dp = [list(range(n2 + 1))] + [[i + 1] + [0] * n2 for i in range(n1)]
    for i in range(n1):
        for j in range(n2):
            cost = 0 if seq1[i] == seq2[j] else 1
            dp[i + 1][j + 1] = min(
                dp[i][j + 1] + 1,       # deletion
                dp[i + 1][j] + 1,       # insertion
                dp[i][j] + cost         # substitution
            )
    return dp[n1][n2]


def compute_cer(reference: str, hypothesis: str) -> float:
    """Compute Character Error Rate (CER) with Unicode NFC normalization."""
    ref_norm = unicodedata.normalize("NFC", reference.strip())
    hyp_norm = unicodedata.normalize("NFC", hypothesis.strip())
    if not ref_norm:
        return 0.0 if not hyp_norm else 1.0
    dist = compute_levenshtein_distance(list(ref_norm), list(hyp_norm))
    return float(dist) / float(len(ref_norm))


def compute_wer(reference: str, hypothesis: str) -> float:
    """Compute Word Error Rate (WER) after whitespace tokenization."""
    ref_words = reference.strip().split()
    hyp_words = hypothesis.strip().split()
    if not ref_words:
        return 0.0 if not hyp_words else 1.0
    dist = compute_levenshtein_distance(ref_words, hyp_words)
    return float(dist) / float(len(ref_words))


class AudioWorkletSimulator:
    """Simulates the 128-sample quantum buffer and streaming chunk accumulator of the browser AudioWorklet."""

    def __init__(self, quantum_size: int = 128, chunk_samples: int = 1600):
        self.quantum_size = quantum_size
        self.chunk_samples = chunk_samples
        self.ring_buffer: list[float] = []
        self.emitted_chunks: list[list[float]] = []
        self.is_finished = False

    def push_quantum(self, quantum: Sequence[float]) -> list[list[float]]:
        """Push a quantum (typically 128 samples) into the simulator."""
        assert len(quantum) == self.quantum_size or len(quantum) > 0, "Invalid quantum size"
        self.ring_buffer.extend(quantum)
        new_chunks = []
        while len(self.ring_buffer) >= self.chunk_samples:
            chunk = self.ring_buffer[: self.chunk_samples]
            self.ring_buffer = self.ring_buffer[self.chunk_samples :]
            self.emitted_chunks.append(chunk)
            new_chunks.append(chunk)
        return new_chunks

    def finish(self) -> list[float]:
        """Flush any remaining tail samples."""
        self.is_finished = True
        tail = list(self.ring_buffer)
        self.ring_buffer.clear()
        return tail


class MockWebWorker:
    """Emulates stt-worker.mjs postMessage event loop off the main thread."""

    def __init__(self, message_handler: Callable[[dict[str, Any]], None]):
        self.handler = message_handler
        self.is_terminated = False
        self.message_history: list[dict[str, Any]] = []

    def post_message(self, message: dict[str, Any]) -> None:
        """Post a message to the worker simulator."""
        if self.is_terminated:
            raise RuntimeError("Cannot post message to terminated WebWorker")
        self.message_history.append(message)
        # Dispatch to handler
        self.handler(message)

    def terminate(self) -> None:
        """Terminate the worker."""
        self.is_terminated = True
