"""Adversarial latency, RTF benchmarking, and 60-second continuous streaming stress tests."""

from pathlib import Path
import time
import numpy as np
import pytest

from swanada import Swanada, load_audio

TEST_WAV = Path("/Users/lika/labs/ninada/data/wavs/sa_rasa_male_01445fb1731b.wav")


def test_adversarial_ttft_and_rtf_benchmarks() -> None:
    """Verifies TTFT < 500 ms and streaming RTF < 1.0 on real Sanskrit speech audio."""
    if not TEST_WAV.exists():
        pytest.skip(f"Test wav not found at {TEST_WAV}")

    pcm = load_audio(TEST_WAV, target_sr=16000)
    stt = Swanada.create(language="sa")
    stream = stt.stream(chunk_size_samples=5120)  # 320 ms @ 16 kHz

    first_partial_time_ms: float = -1.0
    latencies: list[float] = []
    t_start = time.perf_counter()

    chunk_size = 5120
    for i in range(0, len(pcm), chunk_size):
        chunk = pcm[i : min(len(pcm), i + chunk_size)]
        t0 = time.perf_counter()
        st = stream.push(chunk)
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        latencies.append(elapsed_ms)

        if st is not None and first_partial_time_ms < 0:
            first_partial_time_ms = (time.perf_counter() - t_start) * 1000.0

    final_res = stream.finish()

    # 1. TTFT Assertion
    assert first_partial_time_ms > 0, "No partial transcript emitted"
    assert first_partial_time_ms < 500.0, (
        f"TTFT violation: {first_partial_time_ms:.2f} ms exceeded 500 ms budget"
    )

    # 2. RTF Assertion
    chunk_rtf = (sum(latencies) / 1000.0) / (len(pcm) / 16000.0)
    assert chunk_rtf < 1.0, f"Streaming RTF violation: {chunk_rtf:.4f} >= 1.0"
    assert final_res.rtf < 1.0, f"Final result RTF violation: {final_res.rtf:.4f} >= 1.0"


def test_adversarial_60s_continuous_streaming_memory_and_latency() -> None:
    """Stress tests 60+ seconds continuous speech stream for O(1) memory and flat latency."""
    if not TEST_WAV.exists():
        pytest.skip(f"Test wav not found at {TEST_WAV}")

    pcm = load_audio(TEST_WAV, target_sr=16000)
    stt = Swanada.create(language="sa")

    # 320 ms chunks (5120 samples), max buffer defaults to 3840 ms (61440 samples)
    chunk_size = 5120
    max_buffer = 61440
    stream = stt.stream(chunk_size_samples=chunk_size)

    # Simulate 64 seconds of continuous speech (200 chunks x 320 ms)
    num_chunks = 200
    pcm_loop = np.tile(pcm, int(np.ceil((num_chunks * chunk_size) / len(pcm))))

    latencies: list[float] = []
    buffer_sizes: list[int] = []

    for i in range(num_chunks):
        chunk = pcm_loop[i * chunk_size : (i + 1) * chunk_size]
        t0 = time.perf_counter()
        stream.push(chunk)
        elapsed_ms = (time.perf_counter() - t0) * 1000.0

        latencies.append(elapsed_ms)
        buffer_sizes.append(len(stream.audio_buffer))

    # Memory Bounding Verification: audio_buffer must never exceed max_buffer + chunk_size
    max_observed_buffer = max(buffer_sizes)
    assert max_observed_buffer <= max_buffer + chunk_size, (
        f"Memory leak: audio_buffer reached {max_observed_buffer} samples "
        f"(cap is {max_buffer + chunk_size})"
    )

    # Verify sliding window operates after warmup: minimum buffer size after warmup must be <= left_context
    assert min(buffer_sizes[20:]) <= 20480 + chunk_size, "Sliding window did not trim audio buffer"

    # Latency Stability Verification: Latency curve must be flat O(1), not O(T) or growing
    x = np.arange(10, len(latencies))
    slope, _ = np.polyfit(x, latencies[10:], 1)
    assert slope < 0.5, (
        f"Latency regression: chunk latency is drifting upward with slope {slope:.5f} ms/chunk"
    )

    # Average RTF across entire 64s session
    total_audio_s = (num_chunks * chunk_size) / 16000.0
    total_compute_s = sum(latencies) / 1000.0
    session_rtf = total_compute_s / total_audio_s
    assert session_rtf < 1.0, f"64s session RTF violation: {session_rtf:.4f} >= 1.0"

    # Final cleanup
    final_res = stream.finish()
    assert len(stream.audio_buffer) == 0, "Audio buffer not freed on finish()"
    assert isinstance(final_res.text, str)
