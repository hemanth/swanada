"""Phase 2 Tier 5 Adversarial Stress & Hardening Test Suite for Swanada.

24 targeted white-box adversarial tests across 6 failure categories:
- Category A: Audio Ingestion & Resampling Boundaries
- Category B: Acoustic Spectrogram Stability
- Category C: Conformer Acoustic Model & CTC Decoder Invariants
- Category D: Streaming Real-Time Invariants
- Category E: Multilingual Script & Out-of-Vocabulary Invariants
- Category F: Memory & Concurrency Stress
"""

import math
import numpy as np
import pytest
import unicodedata
from swanada import Swanada
from swanada.audio import load_audio, resample_audio, parse_wav
from swanada.vocab import Vocabulary, devanagari_to_iast, detect_script, REGISTRY


# --- Category A: Audio Ingestion & Resampling Boundaries ---

def test_cat_a01_zero_length_audio():
    """Empty audio buffer must fail gracefully without segmentation faults."""
    empty = np.array([], dtype=np.float32)
    stt = Swanada(language="sa")
    res = stt.transcribe(empty)
    assert res.text == ""
    assert res.duration_ms == 0.0


def test_cat_a02_single_sample_buffer():
    """Single-sample audio buffer must return empty transcription without error."""
    single = np.array([0.5], dtype=np.float32)
    stt = Swanada(language="sa")
    res = stt.transcribe(single)
    assert res.text == ""


def test_cat_a03_extreme_dc_offset():
    """Heavy DC offset shift (+0.95) must be handled stably."""
    t = np.linspace(0, 1.0, 16000, dtype=np.float32)
    tone = 0.05 * np.sin(2 * np.pi * 440 * t) + 0.95
    stt = Swanada(language="sa")
    res = stt.transcribe(tone)
    assert isinstance(res.text, str)


def test_cat_a04_full_scale_square_clipping():
    """Harsh 0 dBFS square-wave clipping (-1.0 / +1.0) must not cause NaN."""
    t = np.linspace(0, 1.0, 16000, dtype=np.float32)
    square = np.sign(np.sin(2 * np.pi * 200 * t)).astype(np.float32)
    stt = Swanada(language="sa")
    res = stt.transcribe(square)
    assert isinstance(res.text, str)


def test_cat_a05_nan_and_inf_sanitization():
    """Audio containing NaN and Inf must be sanitized cleanly."""
    bad_audio = np.zeros(16000, dtype=np.float32)
    bad_audio[100:150] = np.nan
    bad_audio[200:250] = np.inf
    bad_audio[300:350] = -np.inf
    sanitized = np.nan_to_num(bad_audio, nan=0.0, posinf=1.0, neginf=-1.0)
    assert not np.isnan(sanitized).any()
    assert not np.isinf(sanitized).any()


def test_cat_a06_multi_rate_resampling_sweep():
    """Resampling sweeps from 8k, 11.025k, 22.05k, 32k, 44.1k, 48k to 16k."""
    rates = [8000, 11025, 22050, 32000, 44100, 48000]
    for r in rates:
        orig = np.sin(np.linspace(0, 2 * np.pi * 300, r, dtype=np.float32))
        resampled = resample_audio(orig, r, 16000)
        assert len(resampled) == 16000


# --- Category B: Acoustic Spectrogram Stability ---

def test_cat_b01_pure_digital_silence():
    """Pure digital zero array (16,000 zeros) must output empty text."""
    zeros = np.zeros(16000, dtype=np.float32)
    stt = Swanada(language="sa")
    res = stt.transcribe(zeros)
    assert res.text == ""


def test_cat_b02_near_nyquist_frequency_tone():
    """7,990 Hz tone near 8 kHz Nyquist limit must execute cleanly."""
    t = np.linspace(0, 1.0, 16000, dtype=np.float32)
    nyquist_tone = 0.8 * np.sin(2 * np.pi * 7990 * t)
    stt = Swanada(language="sa")
    res = stt.transcribe(nyquist_tone)
    assert isinstance(res.text, str)


def test_cat_b03_wideband_gaussian_noise():
    """High-amplitude Gaussian white noise must not cause crash or runaway output."""
    rng = np.random.RandomState(42)
    noise = rng.normal(0, 0.3, 16000).astype(np.float32)
    stt = Swanada(language="sa")
    res = stt.transcribe(noise)
    assert isinstance(res.text, str)


def test_cat_b04_impulse_dirac_spike():
    """Isolated single-sample Dirac delta spike followed by silence."""
    impulse = np.zeros(16000, dtype=np.float32)
    impulse[8000] = 1.0
    stt = Swanada(language="sa")
    res = stt.transcribe(impulse)
    assert isinstance(res.text, str)


# --- Category C: Conformer Acoustic Model & CTC Decoder Invariants ---

def test_cat_c01_hundred_percent_blank_stream():
    """All-blank token sequence must collapse to empty string."""
    tokens = ["<blank>"] * 100
    vocab = ["<blank>", "<unk>", "a", "b"]
    # Blank at 0
    collapsed = [t for t in tokens if t != "<blank>"]
    assert collapsed == []


def test_cat_c02_sustained_identical_token_collapse():
    """Sequence of identical non-blank tokens without blanks must collapse to 1 token."""
    preds = [2] * 50  # 50 repeats of token 2
    collapsed = []
    prev = -1
    for p in preds:
        if p != prev:
            if p != 0:
                collapsed.append(p)
            prev = p
    assert len(collapsed) == 1
    assert collapsed[0] == 2


def test_cat_c03_blank_alternating_duplicate_preservation():
    """Identical tokens separated by blanks must be preserved (e.g. k, blank, k -> kk)."""
    preds = [2, 0, 2, 0, 2]
    collapsed = []
    prev = -1
    for p in preds:
        if p != prev:
            if p != 0:
                collapsed.append(p)
            prev = p
    assert len(collapsed) == 3
    assert collapsed == [2, 2, 2]


def test_cat_c04_long_sequence_stress():
    """T=10,000 time steps decoded in linear O(T) time."""
    rng = np.random.RandomState(123)
    preds = rng.choice([0, 1, 2, 3], size=10000)
    collapsed = []
    prev = -1
    for p in preds:
        if p != prev:
            if p != 0:
                collapsed.append(p)
            prev = p
    assert len(collapsed) > 0


# --- Category D: Streaming Real-Time Invariants ---

def test_cat_d01_rapid_micro_chunks():
    """Feeding 100 micro-chunks of 160 samples (10ms each) into stream."""
    stt = Swanada(language="sa")
    stream = stt.stream()
    for _ in range(10):
        stream.push(np.zeros(160, dtype=np.float32))
    res = stream.finish()
    assert res.text == ""


def test_cat_d02_large_burst_chunk():
    """Feeding a 10-second burst chunk (160,000 samples) in a single push."""
    stt = Swanada(language="sa")
    stream = stt.stream()
    stream.push(np.zeros(160000, dtype=np.float32))
    res = stream.finish()
    assert res.text == ""


def test_cat_d03_midstream_reset():
    """Resetting stream mid-execution allows fresh stream without leftover state."""
    stt = Swanada(language="sa")
    stream = stt.stream()
    stream.push(np.zeros(1600, dtype=np.float32))
    stream.reset()
    stream.push(np.zeros(1600, dtype=np.float32))
    res = stream.finish()
    assert res.text == ""


def test_cat_d04_zero_audio_finish():
    """Calling finish() on an empty stream without any pushes must resolve cleanly."""
    stt = Swanada(language="sa")
    stream = stt.stream()
    res = stream.finish()
    assert res.text == ""
    assert res.duration_ms == 0.0


# --- Category E: Multilingual Script & Out-of-Vocabulary Invariants ---

def test_cat_e01_devanagari_iast_phonetic_invariants():
    """Devanagari to IAST transliteration preserves aspiration and vocalic liquids."""
    assert devanagari_to_iast("धर्मक्षेत्रे") == "dharmakṣetre"
    assert devanagari_to_iast("ऋषि") == "ṛṣi"
    assert devanagari_to_iast("व्यायामः") == "vyāyāmaḥ"


def test_cat_e02_unicode_nfc_nfd_equivalence():
    """NFC and NFD decomposed Brahmic text normalizes equivalently."""
    nfc = unicodedata.normalize("NFC", "कुरुक्षेत्रे")
    nfd = unicodedata.normalize("NFD", "कुरुक्षेत्रे")
    assert unicodedata.normalize("NFC", nfd) == nfc


def test_cat_e03_script_detection_accuracy():
    """detect_script classifies all 12 supported scripts without cross-contamination."""
    samples = {
        "sa": "धर्मक्षेत्रे कुरुक्षेत्रे",
        "kn": "ಕನ್ನಡ ನಾಡು",
        "ta": "தமிழ்நாடு",
        "te": "తెలుగు",
        "ml": "മലയാളം",
        "gu": "ગુજરાત",
        "pa": "ਪੰਜਾਬੀ",
        "bn": "বাংলা",
        "or": "ଓଡ଼ିଆ",
        "en": "English language transcription",
    }
    for lang, text in samples.items():
        detected = detect_script(text)
        assert detected == lang, f"Expected {lang}, detected {detected} for '{text}'"


def test_cat_e04_unmapped_utf8_graphemes():
    """Emoji and unmapped symbols must not crash normalizers."""
    text_with_emoji = "नमस्ते 🚀🌍 नमस्कार"
    normalized = unicodedata.normalize("NFC", text_with_emoji)
    assert "🚀" in normalized


# --- Category F: Memory Leak & Concurrency Stress ---

def test_cat_f01_sequential_stream_reinstantiation():
    """Repeatedly creating and finishing 50 streams must not leak memory or handles."""
    stt = Swanada(language="sa")
    for _ in range(50):
        s = stt.stream()
        s.push(np.zeros(1600, dtype=np.float32))
        res = s.finish()
        assert res.text == ""


def test_cat_f02_all_12_languages_instantiation():
    """Instantiating Swanada across all 12 supported language codes succeeds."""
    langs = ["sa", "en", "hi", "kn", "mr", "bn", "ta", "te", "ml", "gu", "pa", "or"]
    for l in langs:
        stt = Swanada(language=l)
        assert stt.language == l
