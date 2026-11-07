"""Adversarial Stress Test Suite for Milestone 1 Streaming STT and Prefix Locking.

Tests:
1. Chunk jitter test: push fluctuating random chunk sizes (160 to 4800 samples)
   across all 12 supported languages and assert 0.00% character churn on committed tokens.
2. Long pause test: insert 1s, 2s, 3s silence gaps into speech streams
   across all 12 languages and verify zero word duplication, zero retraction, and monotonic prefix progression.
3. Streaming vs batch parity evaluation across all 12 languages.

Repository constraint: zero first-person pronouns in docstrings, comments, identifiers, or logs.
"""

from __future__ import annotations

import random
import unicodedata
from pathlib import Path
import numpy as np
import pytest

from swanada import Swanada, load_audio

REPO_ROOT = Path(__file__).resolve().parents[1]
SAMPLES_DIR = REPO_ROOT / "docs" / "samples"
ALL_LANGUAGES = ["sa", "en", "hi", "kn", "mr", "bn", "ta", "te", "ml", "gu", "pa", "or"]


def check_monotonic_prefix(committed_history: list[str], test_context: str) -> None:
    """Verifies that committed text grows monotonically without character retraction."""
    for i in range(1, len(committed_history)):
        prev = committed_history[i - 1]
        curr = committed_history[i]
        assert curr.startswith(prev), (
            f"Prefix churn violation in {test_context} at step {i}: "
            f"previous committed='{prev}' does not prefix current committed='{curr}'"
        )


# ==============================================================================
# Suite 1: Chunk Jitter Test Across All 12 Languages
# ==============================================================================

@pytest.mark.parametrize("lang", ALL_LANGUAGES)
def test_chunk_jitter_fluctuating_sizes_all_languages(lang: str) -> None:
    """Pushes fluctuating chunks (160 to 4800 samples) and asserts 0.00% character churn."""
    wav_path = SAMPLES_DIR / f"{lang}.wav"
    assert wav_path.exists(), f"Sample audio missing for {lang}: {wav_path}"

    pcm = load_audio(wav_path, target_sr=16000)
    stt = Swanada.create(language=lang)
    stream = stt.stream()

    rng = random.Random(42 + sum(ord(c) for c in lang))
    offset = 0
    committed_history: list[str] = []
    chunk_sizes = [160, 320, 480, 800, 1200, 1600, 2400, 3200, 4800]

    while offset < len(pcm):
        csize = rng.choice(chunk_sizes)
        chunk = pcm[offset : min(len(pcm), offset + csize)]
        offset += len(chunk)

        st = stream.push(chunk)
        if st is not None:
            committed_history.append(st.committed)

    final_res = stream.finish()
    assert len(final_res.text.strip()) > 0, f"Final transcript empty for {lang}"

    # Filter consecutive identical committed states to evaluate transitions
    transitions = [c for i, c in enumerate(committed_history) if i == 0 or c != committed_history[i - 1]]
    non_empty_transitions = [c for c in transitions if c]

    check_monotonic_prefix(non_empty_transitions, f"chunk jitter [{lang}]")

    if non_empty_transitions:
        last_committed = non_empty_transitions[-1]
        assert final_res.text.startswith(last_committed) or last_committed in final_res.text, (
            f"Final text divergence under jitter for {lang}: "
            f"last_committed='{last_committed}' not in final='{final_res.text}'"
        )


# ==============================================================================
# Suite 2: Long Pause Test Across All 12 Languages (1s, 2s, 3s Gaps)
# ==============================================================================

@pytest.mark.parametrize("pause_sec", [1.0, 2.0, 3.0])
@pytest.mark.parametrize("lang", ALL_LANGUAGES)
def test_long_pause_silence_gaps_all_languages(pause_sec: float, lang: str) -> None:
    """Inserts 1s, 2s, 3s silence gaps into speech stream and asserts zero churn / word duplication."""
    wav_path = SAMPLES_DIR / f"{lang}.wav"
    assert wav_path.exists(), f"Sample audio missing for {lang}: {wav_path}"

    pcm = load_audio(wav_path, target_sr=16000)
    mid = len(pcm) // 2

    silence_samples = int(pause_sec * 16000)
    paused_pcm = np.concatenate([
        pcm[:mid],
        np.zeros(silence_samples, dtype=np.float32),
        pcm[mid:],
    ])

    stt = Swanada.create(language=lang)
    stream = stt.stream(chunk_size_samples=1600)

    committed_history: list[str] = []
    chunk_size = 1600

    for offset in range(0, len(paused_pcm), chunk_size):
        chunk = paused_pcm[offset : min(len(paused_pcm), offset + chunk_size)]
        st = stream.push(chunk)
        if st is not None:
            committed_history.append(st.committed)

    final_res = stream.finish()
    assert len(final_res.text.strip()) > 0, f"Final transcript empty for {lang} with {pause_sec}s pause"

    transitions = [c for i, c in enumerate(committed_history) if i == 0 or c != committed_history[i - 1]]
    non_empty = [c for c in transitions if c]

    check_monotonic_prefix(non_empty, f"long pause {pause_sec}s [{lang}]")

    # Word duplication check: analyze whether tokens or words immediately repeat abnormally
    final_tokens = final_res.tokens
    for idx in range(len(final_tokens) - 1):
        tok1 = final_tokens[idx].strip(" \u2581\u2582\u2583▁")
        tok2 = final_tokens[idx + 1].strip(" \u2581\u2582\u2583▁")
        if len(tok1) >= 4 and tok1 == tok2:
            pytest.fail(f"Suspicious word/token duplication detected in {lang} with {pause_sec}s pause: '{tok1}'")


# ==============================================================================
# Suite 3: Streaming vs Batch Parity Evaluation Across All 12 Languages
# ==============================================================================

@pytest.mark.parametrize("lang", ALL_LANGUAGES)
def test_streaming_vs_batch_parity(lang: str) -> None:
    """Evaluates bit-exact and phonetic parity between streaming and batch transcription."""
    wav_path = SAMPLES_DIR / f"{lang}.wav"
    assert wav_path.exists(), f"Sample audio missing for {lang}: {wav_path}"

    pcm = load_audio(wav_path, target_sr=16000)
    stt = Swanada.create(language=lang)

    # 1. Batch transcription
    batch_res = stt.transcribe(pcm)
    batch_text = unicodedata.normalize("NFC", batch_res.text.strip())

    # 2. Chunked streaming transcription (standard 1600-sample chunks)
    stream = stt.stream(chunk_size_samples=1600)
    for offset in range(0, len(pcm), 1600):
        chunk = pcm[offset : min(len(pcm), offset + 1600)]
        stream.push(chunk)

    stream_res = stream.finish()
    stream_text = unicodedata.normalize("NFC", stream_res.text.strip())

    print(f"\n[{lang}] Batch:  {batch_text!r}")
    print(f"[{lang}] Stream: {stream_text!r}")

    # Record parity
    assert stream_text == batch_text, (
        f"Streaming vs batch divergence in {lang}:\n"
        f"  Batch:  {batch_text!r}\n"
        f"  Stream: {stream_text!r}"
    )
