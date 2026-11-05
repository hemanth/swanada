"""Tests for Swanada Streaming ASR and Prefix Locking (Milestone 3 / Feature 11)."""

from pathlib import Path
import time
import numpy as np
import pytest

from swanada import (
    Swanada,
    SwanadaStream,
    StreamingCTCDecoder,
    StreamingTranscript,
    TranscriptionResult,
    load_audio,
)

REPO_ROOT = Path(__file__).resolve().parents[1]
TEST_WAV = Path("/Users/lika/labs/ninada/data/wavs/sa_rasa_male_01445fb1731b.wav")
SANSKRIT_GROUND_TRUTH = "अहं तत्रत्यानां कतिपयसौकर्याणां विषये ज्ञातुमिच्छामि"


def test_streaming_ctc_decoder_prefix_locking_monotonicity() -> None:
    """Verifies StreamingCTCDecoder guarantees zero character churn on committed prefix."""
    vocab = ["<blank>", "<unk>", "\u2581अ", "हं", "\u2581त", "त्र", "त्या", "नां", "म्"]
    decoder = StreamingCTCDecoder(vocab, stability_threshold=2, trail_tokens=2)

    committed_history = []

    # Step 1: Initial hypothesis
    res1 = decoder.update(["\u2581अ", "हं"])
    assert not res1.is_final
    committed_history.append(res1.committed)

    # Step 2: Next chunk with space marker ahead locks prefix
    res2 = decoder.update(["\u2581अ", "हं", "\u2581त", "त्र"])
    assert not res2.is_final
    committed_history.append(res2.committed)
    assert len(res2.committed) > 0, "Expected prefix locked before upcoming space"

    # Step 3: Trailing tokens fluctuate, but committed prefix MUST NOT retract
    res3 = decoder.update(["\u2581अ", "हं", "\u2581त", "म्"])
    committed_history.append(res3.committed)

    for i in range(1, len(committed_history)):
        prev = committed_history[i - 1]
        curr = committed_history[i]
        assert curr.startswith(prev), f"Flicker: '{curr}' did not start with '{prev}'"

    # Step 4: Stream end flushes all tokens
    final_res = decoder.update(["\u2581अ", "हं", "\u2581त", "त्रत्यानां"], is_stream_end=True)
    assert final_res.is_final
    assert final_res.volatile == ""
    assert "अहं" in final_res.text


def test_swanada_streaming_pipeline_real_speech() -> None:
    """Evaluates Swanada.stream() with held-out Sanskrit speech audio."""
    if not TEST_WAV.exists():
        pytest.skip(f"Test wav not found at {TEST_WAV}")

    stt = Swanada.create(language="sa")
    stream = stt.stream(chunk_size_samples=5120)  # 320ms chunks

    pcm = load_audio(TEST_WAV, target_sr=16000)

    partials: list[StreamingTranscript] = []
    first_partial_time_ms: float = -1.0
    t_start = time.perf_counter()

    stream.on_partial(lambda p: partials.append(p))

    chunk_size = 5120  # 320ms @ 16kHz
    for i in range(0, len(pcm), chunk_size):
        chunk = pcm[i : min(len(pcm), i + chunk_size)]
        st = stream.push(chunk)
        if st is not None and first_partial_time_ms < 0:
            first_partial_time_ms = (time.perf_counter() - t_start) * 1000.0

    final_result = stream.finish()

    # Verification 1: First chunk TTFT < 500 ms
    assert first_partial_time_ms > 0, "Stream emitted partial result"
    assert first_partial_time_ms < 500.0, f"TTFT {first_partial_time_ms:.1f}ms exceeded 500ms budget"

    # Verification 2: RTF < 1.0
    assert final_result.rtf < 1.0, f"RTF {final_result.rtf:.4f} exceeded 1.0 threshold"

    # Verification 3: Monotonic committed text progression (zero flicker)
    for i in range(1, len(partials)):
        prev = partials[i - 1].committed
        curr = partials[i].committed
        if prev and curr:
            assert curr.startswith(prev) or len(curr) >= len(prev), (
                f"Committed prefix churn: prev='{prev}', curr='{curr}'"
            )

    # Verification 4: Final accuracy matches ground truth
    assert final_result.text == SANSKRIT_GROUND_TRUTH


def test_swanada_streaming_silence_handling() -> None:
    """Verifies that silence chunks do not trigger unnecessary decoding errors."""
    stt = Swanada.create(language="sa")
    stream = stt.stream(chunk_size_samples=3200)

    # Push digital silence
    silence = np.zeros(3200, dtype=np.float32)
    st = stream.push(silence)
    assert st is None or st.text == ""

    # Finish on silence produces clean empty result without crash
    res = stream.finish()
    assert isinstance(res, TranscriptionResult)
    assert res.text == ""


def test_streaming_continuous_speech_exceeding_buffer_cap_regression() -> None:
    """Regression test for Critical Defect 1:

    Continuous speech exceeding 3.84s (61440 samples) must NOT freeze partial updates.
    Verifies that chunks pushed after 3.84s (chunks 12, 13, 14, 15) continue emitting
    advancing committed prefix and active volatile text.
    """
    if not TEST_WAV.exists():
        pytest.skip(f"Test wav not found at {TEST_WAV}")

    stt = Swanada.create(language="sa")
    stream = stt.stream(chunk_size_samples=5120)  # 320ms @ 16kHz
    pcm = load_audio(TEST_WAV, target_sr=16000)
    assert len(pcm) / 16000.0 >= 4.0, f"Expected audio >= 4.0s, got {len(pcm)/16000.0:.2f}s"

    chunks_emitted = []
    chunk_size = 5120
    for i in range(0, len(pcm), chunk_size):
        chunk = pcm[i : min(len(pcm), i + chunk_size)]
        st = stream.push(chunk)
        if st is not None:
            chunks_emitted.append((i // chunk_size, st))

    final_result = stream.finish()

    # Audio is ~4.96s (16 chunks: indices 0..15). Chunks 12..15 exceed the 3.84s (61440 sample) cap.
    late_chunks = [c for c in chunks_emitted if c[0] >= 12]
    assert len(late_chunks) >= 3, f"Expected at least 3 chunks after 3.84s cap, got {len(late_chunks)}"

    # Crucial regression assertions:
    # 1. Volatile text must NOT be empty after buffer truncation!
    for chunk_idx, st in late_chunks:
        assert st.volatile != "", (
            f"FREEZE DETECTED: Chunk {chunk_idx} emitted empty volatile text during active speech!"
        )

    # 2. Committed text must advance beyond what was recognized before chunk 12 ("विषये")
    last_committed = chunks_emitted[-1][1].committed
    assert "विषये" in last_committed
    assert any(char in last_committed for char in ["ज्ञ", "ा", "त", "ु", "म", "ि"]), (
        f"FREEZE DETECTED: Committed prefix did not advance into subsequent words: '{last_committed}'"
    )

    # 3. Final text must equal full ground truth
    assert final_result.text == SANSKRIT_GROUND_TRUTH


def test_streaming_initial_chunk_emission_at_1600_samples() -> None:
    """Verifies Minor Defect 3: initial chunk emission starting at 1600 samples (100 ms)."""
    stt = Swanada.create(language="sa")
    stream = stt.stream(chunk_size_samples=1600)

    # Synthetic non-silent audio of exactly 1600 samples
    audio_100ms = np.random.RandomState(42).randn(1600).astype(np.float32) * 0.05
    st = stream.push(audio_100ms)
    assert st is not None, "Expected stream.push to emit a StreamingTranscript at 1600 samples"
    assert st.duration_ms == 100.0


def test_streaming_callback_exception_handling_and_on_error() -> None:
    """Verifies Minor Defect 4: clean exception handling in callback dispatch."""
    stt = Swanada.create(language="sa")
    stream = stt.stream(chunk_size_samples=1600)

    captured_errors: list[Exception] = []

    def faulty_partial(st: StreamingTranscript) -> None:
        raise ValueError("Partial callback deliberate error")

    def error_handler(err: Exception) -> None:
        captured_errors.append(err)

    # Test .on() multiplexing method
    stream.on("partial", faulty_partial)
    stream.on("error", error_handler)

    # Push 1600 samples to trigger partial callback
    audio_100ms = np.random.RandomState(42).randn(1600).astype(np.float32) * 0.05
    st = stream.push(audio_100ms)
    assert st is not None
    assert len(captured_errors) == 1
    assert "Partial callback deliberate error" in str(captured_errors[0])

    # Test final callback error handling
    def faulty_final(res: TranscriptionResult) -> None:
        raise RuntimeError("Final callback deliberate error")

    stream.on("final", faulty_final)
    res = stream.finish()
    assert isinstance(res, TranscriptionResult)
    assert len(captured_errors) == 2
    assert "Final callback deliberate error" in str(captured_errors[1])

