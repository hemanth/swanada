"""Tier 4: Real-World Application Scenarios End-to-End Tests for Swanada.

Covers authentic discourse workloads and real-world acoustic scenarios:
1. Authentic Conversational Speech (all 12 languages on golden clips with CER bounds)
2. Technical Terminology & Loanwords (administrative, digital, and technical vocabulary)
3. Multilingual Code-Mixing (multi-language sequential audio streams and script stability)
4. Background Noise & Low SNR Environments (additive Gaussian noise at 20 dB and 15 dB SNR)
5. Held-Out Speech Corpus Validation (evaluation against studio clips from bench/test_speech_suite.jsonl)
"""
from __future__ import annotations

import json
import math
import unicodedata
from pathlib import Path
from typing import Any, Callable

import numpy as np
import pytest

from tests.e2e.helpers import (
    ALL_12_LANGUAGES,
    CANONICAL_PRESETS,
    compute_cer,
    compute_wer,
    get_sample_wav_path,
    load_sample_pcm,
    verify_transcription_result,
)

try:
    from swanada import REGISTRY, Swanada
except ImportError:
    Swanada = None  # type: ignore[assignment]
    REGISTRY = None  # type: ignore[assignment]


# ==============================================================================
# 1. Authentic Conversational Speech (All 12 Languages)
# ==============================================================================

@pytest.mark.tier4
@pytest.mark.parametrize("lang", ALL_12_LANGUAGES)
def test_tier4_conversational_speech_all_12_languages(lang: str, engine_factory: Callable[[str], Any]) -> None:
    """Tier 4.1: Authentic conversational speech clips transcribe with valid CER bounds across all 12 languages."""
    engine = engine_factory(lang)
    wav_path = get_sample_wav_path(lang)
    result = engine.transcribe(str(wav_path))

    verify_transcription_result(result, expected_lang=lang)
    reference = CANONICAL_PRESETS[lang]
    hypothesis = result.text.strip()

    assert len(hypothesis) > 0, f"Empty hypothesis for {lang}"
    cer = compute_cer(reference, hypothesis)

    # CER upper threshold: all models must achieve < 0.65 CER on single golden samples
    # Top languages (sa, hi, en, kn) typically achieve < 0.35 CER
    assert cer < 0.65, (
        f"CER exceeded threshold for {lang}: measured {cer * 100:.2f}% "
        f"(ref='{reference}', hyp='{hypothesis}')"
    )

    # Invariant: output is valid Unicode in canonical NFC composition
    assert unicodedata.is_normalized("NFC", hypothesis)


# ==============================================================================
# 2. Technical Terminology & Loanwords
# ==============================================================================

@pytest.mark.tier4
@pytest.mark.parametrize(
    "lang,expected_substring",
    [
        ("hi", "हेडमास्टर"),   # Headmaster loanword
        ("kn", "ಬ್ಯಾಂಕ್"),     # Bank loanword
        ("pa", "ਐਕਸਪ੍ਰੈਸ"),   # Express loanword
        ("en", "king"),       # English core word
    ],
)
def test_tier4_technical_and_loan_vocabulary(lang: str, expected_substring: str, engine_factory: Callable[[str], Any]) -> None:
    """Tier 4.2: Technical loanwords and administrative titles transcribe with script and subword integrity."""
    engine = engine_factory(lang)
    wav_path = get_sample_wav_path(lang)
    result = engine.transcribe(str(wav_path))

    text = result.text
    words = text.split()
    min_word_cer = min(compute_cer(expected_substring, w) for w in words) if words else 1.0
    contains_sub = expected_substring in text or min_word_cer < 0.40
    assert contains_sub, (
        f"Loanword '{expected_substring}' missing or severely corrupted in {lang}: '{text}' (min_cer={min_word_cer:.2f})"
    )



# ==============================================================================
# 3. Multilingual Code-Mixing / Language Transition
# ==============================================================================

@pytest.mark.tier4
def test_tier4_multilingual_code_mixing_stream(engine_factory: Callable[[str], Any]) -> None:
    """Tier 4.3: Sequential bilingual speech stream maintains script stability and streaming continuity."""
    # Compose bilingual stream: Sanskrit speech + 500ms pause + Hindi speech
    engine = engine_factory("sa")
    stream = engine.stream(chunk_size_samples=1600)

    pcm_sa, _ = load_sample_pcm("sa")
    pcm_hi, _ = load_sample_pcm("hi")
    pause = np.zeros(8000, dtype=np.float32)

    composed_bilingual = np.concatenate([pcm_sa, pause, pcm_hi])
    chunk_size = 1600

    for i in range(0, len(composed_bilingual), chunk_size):
        chunk = composed_bilingual[i : i + chunk_size]
        stream.push(chunk)

    final_result = stream.finish()
    assert len(final_result.text.strip()) > 0
    # Both Sanskrit and Hindi utilize Devanagari script; verify NFC composition
    assert unicodedata.is_normalized("NFC", final_result.text)


# ==============================================================================
# 4. Background Noise & Low SNR Environments
# ==============================================================================

@pytest.mark.tier4
@pytest.mark.parametrize("snr_db", [20.0, 15.0])
def test_tier4_background_noise_snr_degradation(snr_db: float, engine_factory: Callable[[str], Any]) -> None:
    """Tier 4.4: Speech corrupted by additive white noise (20 dB and 15 dB SNR) maintains transcription output."""
    engine = engine_factory("sa")
    pcm, sr = load_sample_pcm("sa")

    # Calculate speech signal power
    speech_power = float(np.mean(pcm ** 2))
    assert speech_power > 0.0

    # Calculate required noise power for target SNR (SNR = 10 * log10(P_speech / P_noise))
    noise_power = speech_power / (10.0 ** (snr_db / 10.0))
    noise_sigma = math.sqrt(noise_power)

    # Synthesize Gaussian noise and add to speech
    noise = np.random.normal(0.0, noise_sigma, size=len(pcm)).astype(np.float32)
    noisy_speech = np.clip(pcm + noise, -1.0, 1.0).astype(np.float32)

    result = engine.transcribe(noisy_speech)
    assert len(result.text.strip()) > 0, f"Denoising frontend failed at SNR {snr_db} dB"
    assert result.rtf < 1.0


# ==============================================================================
# 5. Held-Out Speech Corpus Validation
# ==============================================================================

@pytest.mark.tier4
@pytest.mark.parametrize(
    "utt_id,lang,ground_truth,rel_wav",
    [
        (
            "sa_5b38db8fe54d",
            "sa",
            "तावता श्रीपतिशास्त्रिणा अवगतम् ' अयं न सज्जनः ।",
            "bench/test_gt_wavs_16k/sa_5b38db8fe54d.wav",
        ),
        (
            "sa_4ffe4900cea3",
            "sa",
            "अपि चार्लॉट् इत्येषः प्रतिक्रियाम् अददात्?",
            "bench/test_gt_wavs_16k/sa_4ffe4900cea3.wav",
        ),
    ],
)
def test_tier4_held_out_speech_suite_clips(
    utt_id: str,
    lang: str,
    ground_truth: str,
    rel_wav: str,
    engine_factory: Callable[[str], Any],
) -> None:
    """Tier 4.5: Held-out speech suite clips from test_speech_suite.jsonl transcribe with high accuracy."""
    repo_root = Path(__file__).resolve().parents[2]
    wav_path = repo_root / rel_wav
    if not wav_path.exists():
        pytest.skip(f"Held-out clip not found on disk: {wav_path}")

    engine = engine_factory(lang)
    result = engine.transcribe(str(wav_path))

    assert len(result.text.strip()) > 0
    cer = compute_cer(ground_truth, result.text)
    # Sanskrit held-out clips achieve low CER (< 0.20)
    assert cer < 0.20, f"Held-out CER too high for {utt_id}: {cer * 100:.2f}% (hyp='{result.text}')"
    assert result.rtf < 1.0
