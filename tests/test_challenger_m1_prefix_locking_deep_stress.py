"""Empirical Challenger Deep Stress Test Harness for Prefix Locking and Character Churn Invariance.

Evaluates:
1. Fixed chunk size invariance: 1600, 3200, 5120 samples across all 12 languages.
2. Jittered chunk size invariance: fluctuating chunks (800 to 6400 samples) across all 12 languages.
3. Long pause scenarios: silence gaps (1.0s, 2.0s, 3.0s) inserted at speech boundaries across all 12 languages.
4. Odia (or) and Gujarati (gu) targeted morphology stress: verify complete elimination of non-monotonic churn.
5. Character churn calculation: assert strictly 0.00% churn and strictly monotonic prefix growth everywhere.

Repository style constraint: Zero first-person pronouns in docstrings, comments, or identifiers.
"""

from __future__ import annotations

import random
import unicodedata
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


def calculate_character_churn(committed_history: Sequence[str]) -> float:
    """Calculates character churn percentage across sequential committed emissions.

    Churn occurs if a previously committed string is deleted or overwritten in a subsequent step.
    Zero churn means current_committed.startswith(previous_committed) holds for all steps.
    """
    total_deletions = 0
    total_characters = 0

    for i in range(1, len(committed_history)):
        prev = committed_history[i - 1]
        curr = committed_history[i]
        total_characters += len(curr)

        # Check common prefix length
        common_len = 0
        for c1, c2 in zip(prev, curr):
            if c1 == c2:
                common_len += 1
            else:
                break

        # Any characters in prev after common_len were retracted
        deletions = len(prev) - common_len
        total_deletions += deletions

    if total_characters == 0:
        return 0.0
    return float(total_deletions) / float(total_characters)


def assert_prefix_invariance(committed_history: Sequence[str], context: str) -> None:
    """Asserts that committed text grows monotonically without character retraction."""
    for i in range(1, len(committed_history)):
        prev = committed_history[i - 1]
        curr = committed_history[i]
        assert curr.startswith(prev), (
            f"Prefix churn violation in {context} at step {i}: "
            f"previous='{prev}' does not prefix current='{curr}'"
        )


# ==============================================================================
# Suite 1: Fixed Chunk Sizes (1600, 3200, 5120) Across All 12 Languages
# ==============================================================================

@pytest.mark.parametrize("chunk_size", [1600, 3200, 5120])
@pytest.mark.parametrize("lang", ALL_12_LANGUAGES)
def test_prefix_invariance_fixed_chunk_sizes_all_languages(lang: str, chunk_size: int) -> None:
    """Verifies 0.00% character churn and monotonic prefix progression at fixed chunk sizes."""
    wav_path = SAMPLES_DIR / f"{lang}.wav"
    assert wav_path.exists(), f"Sample audio missing for {lang}: {wav_path}"

    pcm = load_audio(wav_path, target_sr=16000)
    stt = Swanada.create(language=lang)
    stream = stt.stream(chunk_size_samples=chunk_size)

    committed_history: list[str] = []
    for offset in range(0, len(pcm), chunk_size):
        chunk = pcm[offset : min(len(pcm), offset + chunk_size)]
        st = stream.push(chunk)
        if st is not None:
            committed_history.append(st.committed)

    final_res = stream.finish()
    assert len(final_res.text.strip()) > 0, f"Final transcript empty for {lang} at chunk_size {chunk_size}"

    # Filter consecutive identical committed states to evaluate state transitions
    transitions = [c for i, c in enumerate(committed_history) if i == 0 or c != committed_history[i - 1]]
    non_empty = [c for c in transitions if c]

    # 1. Monotonic prefix progression check
    assert_prefix_invariance(non_empty, f"fixed chunk size {chunk_size} [{lang}]")

    # 2. Strict 0.00% character churn calculation
    churn = calculate_character_churn(committed_history)
    assert churn == 0.0, (
        f"Character churn violation for {lang} at chunk_size {chunk_size}: "
        f"measured {churn * 100:.2f}% (expected 0.00%)"
    )

    # 3. Final transcript contains or matches the committed prefix
    if non_empty:
        last_committed = non_empty[-1]
        assert last_committed in final_res.text or final_res.text.startswith(last_committed), (
            f"Final text divergence for {lang} at chunk_size {chunk_size}: "
            f"last_committed='{last_committed}' not in final='{final_res.text}'"
        )


# ==============================================================================
# Suite 2: Highly Jittered Chunk Sizes (800 to 6400) Across All 12 Languages
# ==============================================================================

@pytest.mark.parametrize("seed", [101, 202, 303])
@pytest.mark.parametrize("lang", ALL_12_LANGUAGES)
def test_prefix_invariance_jittered_chunking_all_languages(lang: str, seed: int) -> None:
    """Pushes pseudo-random fluctuating chunks (800 to 6400 samples) and verifies 0.00% churn."""
    wav_path = SAMPLES_DIR / f"{lang}.wav"
    assert wav_path.exists(), f"Sample audio missing for {lang}: {wav_path}"

    pcm = load_audio(wav_path, target_sr=16000)
    stt = Swanada.create(language=lang)
    stream = stt.stream()

    rng = random.Random(seed + sum(ord(c) for c in lang))
    offset = 0
    committed_history: list[str] = []
    chunk_pool = [800, 1200, 1600, 2400, 3200, 4000, 4800, 5600, 6400]

    while offset < len(pcm):
        csize = rng.choice(chunk_pool)
        chunk = pcm[offset : min(len(pcm), offset + csize)]
        offset += len(chunk)

        st = stream.push(chunk)
        if st is not None:
            committed_history.append(st.committed)

    final_res = stream.finish()
    assert len(final_res.text.strip()) > 0, f"Final transcript empty for {lang} under jitter seed {seed}"

    transitions = [c for i, c in enumerate(committed_history) if i == 0 or c != committed_history[i - 1]]
    non_empty = [c for c in transitions if c]

    assert_prefix_invariance(non_empty, f"jittered chunking seed {seed} [{lang}]")

    churn = calculate_character_churn(committed_history)
    assert churn == 0.0, (
        f"Character churn violation for {lang} under jitter seed {seed}: "
        f"measured {churn * 100:.2f}% (expected 0.00%)"
    )

    if non_empty:
        last_committed = non_empty[-1]
        assert last_committed in final_res.text or final_res.text.startswith(last_committed), (
            f"Final text divergence under jitter seed {seed} for {lang}: "
            f"last_committed='{last_committed}' not in final='{final_res.text}'"
        )


# ==============================================================================
# Suite 3: Multi-Point Long Pause Scenarios (1s, 2s, 3s Gaps)
# ==============================================================================

@pytest.mark.parametrize("pause_sec", [1.0, 2.0, 3.0])
@pytest.mark.parametrize("lang", ALL_12_LANGUAGES)
def test_prefix_invariance_multi_pause_all_languages(pause_sec: float, lang: str) -> None:
    """Inserts long silence gaps and verifies strictly 0.00% churn and zero token stutter."""
    wav_path = SAMPLES_DIR / f"{lang}.wav"
    assert wav_path.exists(), f"Sample audio missing for {lang}: {wav_path}"

    pcm = load_audio(wav_path, target_sr=16000)
    p1 = len(pcm) // 3
    p2 = (2 * len(pcm)) // 3
    silence = np.zeros(int(pause_sec * 16000), dtype=np.float32)

    # Insert silence at two distinct points in speech stream
    multi_paused_pcm = np.concatenate([
        pcm[:p1],
        silence,
        pcm[p1:p2],
        silence,
        pcm[p2:],
    ])

    stt = Swanada.create(language=lang)
    stream = stt.stream(chunk_size_samples=1600)

    committed_history: list[str] = []
    chunk_size = 1600

    for offset in range(0, len(multi_paused_pcm), chunk_size):
        chunk = multi_paused_pcm[offset : min(len(multi_paused_pcm), offset + chunk_size)]
        st = stream.push(chunk)
        if st is not None:
            committed_history.append(st.committed)

    final_res = stream.finish()
    assert len(final_res.text.strip()) > 0, f"Final transcript empty for {lang} with {pause_sec}s multi-pause"

    transitions = [c for i, c in enumerate(committed_history) if i == 0 or c != committed_history[i - 1]]
    non_empty = [c for c in transitions if c]

    assert_prefix_invariance(non_empty, f"multi-pause {pause_sec}s [{lang}]")

    churn = calculate_character_churn(committed_history)
    assert churn == 0.0, (
        f"Character churn violation for {lang} with {pause_sec}s multi-pause: "
        f"measured {churn * 100:.2f}% (expected 0.00%)"
    )

    if non_empty:
        last_committed = non_empty[-1]
        assert last_committed in final_res.text or final_res.text.startswith(last_committed), (
            f"Final text divergence with {pause_sec}s multi-pause for {lang}: "
            f"last_committed='{last_committed}' not in final='{final_res.text}'"
        )


# ==============================================================================
# Suite 4: Targeted Odia (or) and Gujarati (gu) Non-Monotonic Churn Remediation
# ==============================================================================

@pytest.mark.parametrize("lang", ["or", "gu"])
def test_targeted_odia_gujarati_churn_elimination(lang: str) -> None:
    """Verifies that non-monotonic churn previously observed in Odia and Gujarati is completely eliminated."""
    wav_path = SAMPLES_DIR / f"{lang}.wav"
    assert wav_path.exists(), f"Sample audio missing for {lang}: {wav_path}"

    pcm = load_audio(wav_path, target_sr=16000)
    stt = Swanada.create(language=lang)

    # Test fine-grained tiny chunk feeding (320 samples = 20ms) to maximize boundary token churn potential
    stream = stt.stream(chunk_size_samples=320)
    committed_history: list[str] = []

    for offset in range(0, len(pcm), 320):
        chunk = pcm[offset : min(len(pcm), offset + 320)]
        st = stream.push(chunk)
        if st is not None:
            committed_history.append(st.committed)

    final_res = stream.finish()
    assert len(final_res.text.strip()) > 0, f"Final transcript empty for {lang} on fine-grained chunking"

    transitions = [c for i, c in enumerate(committed_history) if i == 0 or c != committed_history[i - 1]]
    non_empty = [c for c in transitions if c]

    assert_prefix_invariance(non_empty, f"fine-grained 20ms chunking [{lang}]")

    churn = calculate_character_churn(committed_history)
    assert churn == 0.0, (
        f"Character churn violation in targeted {lang} test: "
        f"measured {churn * 100:.2f}% (expected strictly 0.00%)"
    )

    if non_empty:
        last_committed = non_empty[-1]
        assert last_committed in final_res.text or final_res.text.startswith(last_committed), (
            f"Final text divergence in targeted {lang} test: "
            f"last_committed='{last_committed}' not in final='{final_res.text}'"
        )
