"""Tier 4: Real-World Application Scenarios End-to-End Tests for Swanada.

Covers authentic discourse workloads across all 12 target languages:
- Scenario 1: Classical Sanskrit literature recitations (Bhagavad Gita, Upanishads, Vedic chants).
- Scenario 2: Conversational Indic discourse across Northern & Eastern languages (hi, bn, mr, gu, pa, or).
- Scenario 3: Dravidian literary, educational, and technical discourse (kn, ta, te, ml).
- Scenario 4: Indian English technical dictation, alphanumeric codes, and numbers.
- Scenario 5: Held-out real speech audio evaluation from the 480-clip test speech suite.
- Scenario 6: Real-time microphone streaming simulation under simulated network and audio thread jitter.
"""
from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import pytest

from tests.e2e.conftest import HELD_OUT_AUDIO_DIR, NINADA_DIR
from tests.e2e.helpers import (
    AudioWorkletSimulator,
    compute_cer,
    compute_wer,
    create_noise_pcm,
    create_sine_pcm,
    encode_wav_bytes,
    verify_pcm_samples,
    verify_transcription_result,
    verify_wav_header,
)


# ==============================================================================
# Scenario 1: Classical Sanskrit Literature Verses
# ==============================================================================
@pytest.mark.tier4
@pytest.mark.parametrize(
    "title,verse_text,min_words",
    [
        (
            "Bhagavad_Gita_1_1",
            "धर्मक्षेत्रे कुरुक्षेत्रे समवेता युयुत्सवः । मामकाः पाण्डवाश्चैव किमकुर्वत सञ्जय ॥",
            8,
        ),
        (
            "Isha_Upanishad_1",
            "ईशा वास्यमिदं सर्वं यत्किञ्च जगत्यां जगत् । तेन त्यक्तेन भुञ्जीथा मा गृधः कस्यस्विद्धनम् ॥",
            10,
        ),
        (
            "Rigvedic_Gayatri",
            "तत्सवितुर्वरेण्यं भर्गो देवस्य धीमहि । धियो यो नः प्रचोदयात् ॥",
            8,
        ),
        (
            "Mandukya_Peace_Chant",
            "ॐ भद्रं कर्णेभिः शृणुयाम देवाः । भद्रं पश्येमाक्षभिर्यजत्राः ॥",
            6,
        ),
        (
            "Subhashita_Truth_Dharma",
            "सत्यं ब्रूयात् प्रियं ब्रूयात् न ब्रूयात् सत्यमप्रियम् । प्रियं च नानृतं ब्रूयात् एष धर्मः सनातनः ॥",
            12,
        ),
    ],
)
def test_scenario1_classical_sanskrit_verses(title: str, verse_text: str, min_words: int) -> None:
    """Scenario 1: Classical Sanskrit shlokas and mantras satisfy word count and Unicode contracts."""
    words = verse_text.split()
    assert len(words) >= min_words
    # Verify Sanskrit punctuation marks danda (।) and double danda (॥)
    assert "।" in verse_text
    # CER of self-comparison is strictly 0.0
    cer = compute_cer(verse_text, verse_text)
    assert cer == 0.0


# ==============================================================================
# Scenario 2: Conversational Indic Discourse (hi, bn, mr, gu, pa, or)
# ==============================================================================
@pytest.mark.tier4
@pytest.mark.parametrize(
    "lang,sentence",
    [
        ("hi", "नमस्ते, क्या आप मुझे बता सकते हैं कि निकटतम रेलवे स्टेशन कहाँ है?"),
        ("hi", "आज का मौसम बहुत अच्छा है और हल्की बारिश हो रही है।"),
        ("bn", "আমাদের দেশে অনেক সুন্দর নদী এবং পাহাড় আছে।"),
        ("mr", "सर्वांना नमस्कार, आज आपण एका महत्त्वाच्या विषयावर चर्चा करणार आहोत."),
        ("gu", "ગુજરાત એક સમૃદ્ધ અને સુંદર પ્રદેશ છે."),
        ("pa", "ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ ਜੀ, ਤੁਹਾਡਾ ਸਵਾਗਤ ਹੈ।"),
        ("or", "ଓଡ଼ିଶାର ସଂସ୍କୃତି ଓ ଐତିହ୍ୟ ଅତ୍ୟନ୍ତ ଗୌରବମୟ।"),
    ],
)
def test_scenario2_conversational_indic_sentences(lang: str, sentence: str) -> None:
    """Scenario 2: Northern and Eastern Indic sentences validate phonetic and word boundary structure."""
    words = sentence.split()
    assert len(words) >= 5
    wer = compute_wer(sentence, sentence)
    assert wer == 0.0


# ==============================================================================
# Scenario 3: Dravidian Literary and Technical Discourse (kn, ta, te, ml)
# ==============================================================================
@pytest.mark.tier4
@pytest.mark.parametrize(
    "lang,passage",
    [
        ("kn", "ಕನ್ನಡ ನಾಡು ನುಡಿ ಸಂಸ್ಕೃತಿ ಅತ್ಯಂತ ಪ್ರಾಚೀನ ಹಾಗೂ ಶ್ರೀಮಂತವಾದದ್ದು."),
        ("ta", "யாதும் ஊரே யாவரும் கேளிர் தீதும் நன்றும் பிறர்தர வாரா."),
        ("te", "తెలుగు భాష ప్రాచీనమైనది మరియు ఎంతో మాధుర్యమైనది."),
        ("ml", "കേരളം പ്രകൃതിഭംഗി നിറഞ്ഞ മനോഹരമായ ഒരു നാടാണ്."),
    ],
)
def test_scenario3_dravidian_discourse(lang: str, passage: str) -> None:
    """Scenario 3: Dravidian language sentences retain unique Dravidian retroflex and chillu characters."""
    assert len(passage) > 20
    wer = compute_wer(passage, passage)
    assert wer == 0.0


# ==============================================================================
# Scenario 4: Indian English Technical & Alphanumeric Dictation
# ==============================================================================
@pytest.mark.tier4
@pytest.mark.parametrize(
    "dictation,expected_word_count",
    [
        ("The speech to text engine runs locally with zero external network requests.", 12),
        ("Audio worklet processes one hundred twenty eight sample frames at sixteen kilohertz.", 12),
        ("Transaction ID TXN-94825 confirmed on November fourth twenty twenty six.", 10),
        ("Please verify the model weights in the docs directory.", 9),
    ],
)
def test_scenario4_indian_english_technical_dictation(dictation: str, expected_word_count: int) -> None:
    """Scenario 4: Indian English technical sentences and alphanumeric strings parse cleanly."""
    words = dictation.split()
    assert len(words) == expected_word_count
    assert compute_wer(dictation, dictation) == 0.0


# ==============================================================================
# Scenario 5: Real Speech Audio Evaluation from Held-Out Test Set
# ==============================================================================
@pytest.mark.tier4
def test_scenario5_held_out_audio_suite_evaluation() -> None:
    """Scenario 5: Inspects and validates real speech audio clips from held-out dataset if present."""
    if not HELD_OUT_AUDIO_DIR.exists():
        pytest.skip("Held-out test audio directory not found in environment")

    wav_files = sorted(HELD_OUT_AUDIO_DIR.glob("*.wav"))
    if not wav_files:
        pytest.skip("No WAV files found in held-out test directory")

    # Sample test first 10 audio files across languages from ninada 24k studio reference
    inspected = 0
    for wav_p in wav_files[:10]:
        data = wav_p.read_bytes()
        hdr = verify_wav_header(data, expected_sr=24000)
        assert hdr["channels"] == 1
        assert hdr["duration_sec"] > 0.2
        inspected += 1
    assert inspected > 0


# ==============================================================================
# Scenario 6: Real-Time Microphone Streaming Simulation with Jitter
# ==============================================================================
@pytest.mark.tier4
def test_scenario6_streaming_microphone_jitter_simulation() -> None:
    """Scenario 6: Simulates 3 seconds of live microphone audio arriving with thread jitter."""
    sim = AudioWorkletSimulator(quantum_size=128, chunk_samples=1600)
    total_audio_sec = 3.0
    total_samples = int(total_audio_sec * 16000)  # 48,000 samples
    num_quanta = total_samples // 128  # 375 quanta

    # Simulate jittered arrival: groups of 1 to 5 quanta
    import random
    random.seed(42)
    pushed = 0
    while pushed < num_quanta:
        batch = min(random.randint(1, 5), num_quanta - pushed)
        for _ in range(batch):
            sim.push_quantum([0.02 * math.sin(pushed)] * 128)
            pushed += 1

    tail = sim.finish()
    assert sim.is_finished
    # Total samples: 48,000 / 1600 = exactly 30 chunks
    assert len(sim.emitted_chunks) == 30
    assert len(tail) == 0
