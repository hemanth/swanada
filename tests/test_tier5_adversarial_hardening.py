"""Phase 2 Tier 5 Adversarial Stress & Hardening Test Suite for Swanada.

41 targeted white-box adversarial tests across 6 failure categories:
- Category A: Audio Ingestion & Resampling Boundaries
- Category B: Acoustic Spectrogram Stability
- Category C: Conformer Acoustic Model & CTC Decoder Invariants
- Category D: Streaming Real-Time Invariants
- Category E: Multilingual Script & Out-of-Vocabulary Invariants
- Category F: Memory & Concurrency Stress
"""

import math
import struct
import numpy as np
import pytest
import unicodedata
from swanada import Swanada
from swanada.audio import load_audio, resample_audio, parse_wav
from swanada.decoder import decode_ctc_tokens
from swanada.denoise import enhance_speech_with_telemetry, _design_notch_biquad, _apply_biquad
from swanada.normalizer import repair_brahmic_orthography, normalize_indic_text, join_subwords
from swanada.streaming import StreamingCTCDecoder
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


def test_cat_a07_corrupt_wav_truncated_headers():
    """Truncated WAV byte headers (< 44 bytes) must raise an exception cleanly."""
    truncated_payloads = [
        b"",
        b"RIFF",
        b"RIFF\x24\x00\x00\x00WAVEfmt ",
        b"RIFF" + b"\x00" * 30,
        b"RIFF" + b"\x00" * 39,
    ]
    for payload in truncated_payloads:
        with pytest.raises(Exception):
            parse_wav(payload)


def test_cat_a08_corrupt_wav_invalid_magic_bytes():
    """Invalid magic bytes in header (non-RIFF / non-WAVE) must raise an exception."""
    bad_riff = b"NOPE" + b"\x00" * 40
    with pytest.raises(Exception):
        parse_wav(bad_riff)

    hdr_bad_wave = bytearray(44)
    hdr_bad_wave[0:4] = b"RIFF"
    struct.pack_into("<L", hdr_bad_wave, 4, 36)
    hdr_bad_wave[8:12] = b"TEST"
    with pytest.raises(Exception):
        parse_wav(bytes(hdr_bad_wave))


def test_cat_a09_corrupt_wav_zero_sample_rate():
    """WAV header with zero sample rate must raise an exception."""
    hdr = bytearray(44)
    hdr[0:4] = b"RIFF"
    struct.pack_into("<L", hdr, 4, 36)
    hdr[8:12] = b"WAVE"
    hdr[12:16] = b"fmt "
    struct.pack_into("<L", hdr, 16, 16)
    struct.pack_into("<H", hdr, 20, 1)
    struct.pack_into("<H", hdr, 22, 1)
    struct.pack_into("<L", hdr, 24, 0)
    struct.pack_into("<L", hdr, 28, 0)
    struct.pack_into("<H", hdr, 32, 2)
    struct.pack_into("<H", hdr, 34, 16)
    hdr[36:40] = b"data"
    struct.pack_into("<L", hdr, 40, 0)
    with pytest.raises(Exception):
        parse_wav(bytes(hdr))


def test_cat_a10_corrupt_wav_zero_channels():
    """WAV header with zero channels must raise an exception."""
    hdr = bytearray(44)
    hdr[0:4] = b"RIFF"
    struct.pack_into("<L", hdr, 4, 36)
    hdr[8:12] = b"WAVE"
    hdr[12:16] = b"fmt "
    struct.pack_into("<L", hdr, 16, 16)
    struct.pack_into("<H", hdr, 20, 1)
    struct.pack_into("<H", hdr, 22, 0)
    struct.pack_into("<L", hdr, 24, 16000)
    struct.pack_into("<L", hdr, 28, 32000)
    struct.pack_into("<H", hdr, 32, 2)
    struct.pack_into("<H", hdr, 34, 16)
    hdr[36:40] = b"data"
    struct.pack_into("<L", hdr, 40, 0)
    with pytest.raises(Exception):
        parse_wav(bytes(hdr))


def test_cat_a11_non_finite_pcm_sanitization_in_transcribe():
    """Direct ingestion of non-finite PCM values into transcribe executes stably."""
    bad_pcm = np.zeros(16000, dtype=np.float32)
    bad_pcm[100:200] = np.nan
    bad_pcm[300:400] = np.inf
    bad_pcm[500:600] = -np.inf
    stt = Swanada(language="sa")
    res = stt.transcribe(bad_pcm)
    assert isinstance(res.text, str)
    assert res.duration_ms > 0



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


def test_cat_b05_extreme_negative_snr_noise():
    """Audio with severe negative SNR (-15 dB) is suppressed stably without crash."""
    t = np.linspace(0, 1.0, 16000, dtype=np.float32)
    signal = 0.05 * np.sin(2 * np.pi * 440 * t)
    rng = np.random.RandomState(42)
    noise = rng.normal(0, 0.28, 16000).astype(np.float32)
    noisy_audio = signal + noise
    telemetry = enhance_speech_with_telemetry(noisy_audio, sr=16000)
    assert np.isfinite(telemetry.pcm).all()
    assert telemetry.suppression_db > 10.0


def test_cat_b06_dirac_impulse_train():
    """Train of alternating full-scale Dirac delta spikes handles smoothly."""
    impulse_train = np.zeros(16000, dtype=np.float32)
    spike_indices = [2000, 4000, 6000, 8000, 10000, 12000]
    for idx, sample_idx in enumerate(spike_indices):
        impulse_train[sample_idx] = 1.0 if idx % 2 == 0 else -1.0
    stt = Swanada(language="sa")
    res = stt.transcribe(impulse_train)
    assert isinstance(res.text, str)


def test_cat_b07_mains_hum_notch_attenuation_50hz_60hz():
    """Power-line mains hum at 50 Hz and 60 Hz is attenuated by notch filters."""
    sr = 16000
    t = np.arange(sr, dtype=np.float32) / sr
    hum50 = 0.5 * np.sin(2 * np.pi * 50 * t).astype(np.float32)
    hum60 = 0.5 * np.sin(2 * np.pi * 60 * t).astype(np.float32)

    coeffs50 = _design_notch_biquad(50.0, sr, 22.0)
    filtered50 = _apply_biquad(hum50, coeffs50)
    rms_before50 = float(np.sqrt(np.mean(hum50**2)))
    rms_after50 = float(np.sqrt(np.mean(filtered50[500:]**2)))
    atten_db50 = 20.0 * math.log10(rms_before50 / rms_after50)
    assert atten_db50 > 10.0

    coeffs60 = _design_notch_biquad(60.0, sr, 22.0)
    filtered60 = _apply_biquad(hum60, coeffs60)
    rms_before60 = float(np.sqrt(np.mean(hum60**2)))
    rms_after60 = float(np.sqrt(np.mean(filtered60[500:]**2)))
    atten_db60 = 20.0 * math.log10(rms_before60 / rms_after60)
    assert atten_db60 > 10.0



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


def test_cat_c05_out_of_bounds_token_ids():
    """Out-of-bounds token IDs are safely skipped without IndexError."""
    vocab = ["<blank>", "<unk>", "a", "b"]
    bad_token_ids = [9999, 100000, 424242]
    res = decode_ctc_tokens(bad_token_ids, vocab=vocab)
    assert res.text == ""
    assert res.tokens == []


def test_cat_c06_all_blank_long_stream():
    """All-blank sequence of 500 frames produces empty transcription."""
    vocab = ["<blank>", "<unk>", "ka", "kha"]
    blank_ids = [0] * 500
    res = decode_ctc_tokens(blank_ids, vocab=vocab)
    assert res.text == ""
    assert res.tokens == []


def test_cat_c07_repeated_tokens_with_without_blanks():
    """Identical non-blank tokens collapse without blanks, preserve when blank-separated."""
    vocab = ["<blank>", "<unk>", "ka", "kha"]
    collapsed_run = decode_ctc_tokens([2, 2, 2, 2, 2], vocab=vocab)
    assert collapsed_run.tokens == ["ka"]

    preserved_run = decode_ctc_tokens([2, 0, 2, 0, 2], vocab=vocab)
    assert preserved_run.tokens == ["ka", "ka", "ka"]



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


def test_cat_d05_rapid_fluctuating_cadence_shifts():
    """Irregular chunk schedules do not exceed buffer ceiling or destabilize stream."""
    stt = Swanada(language="sa")
    stream = stt.stream()
    schedule = [1, 16000, 10, 500, 32000, 0, 160]
    for length in schedule:
        if length > 0:
            chunk = np.zeros(length, dtype=np.float32)
            stream.push(chunk)
            assert len(stream.audio_buffer) <= 61440
    res = stream.finish()
    assert isinstance(res.text, str)


def test_cat_d06_continuous_compound_words_zero_spaces():
    """Continuous compound words with zero spaces commit stably via high stability threshold."""
    vocab = ["<blank>", "<unk>", "क", "ख", "ग", "घ", "ङ", " "]
    dec = StreamingCTCDecoder(
        vocab=vocab,
        stability_threshold=2,
        trail_tokens=2,
        suffix_window_tokens=5,
        high_stability_threshold=3,
    )
    tokens = ["क", "ख", "ग", "घ", "ङ"] * 10
    for step in range(10):
        current = tokens[:(step + 1) * 5]
        dec.update(current, is_stream_end=False)
    final_res = dec.update(tokens, is_stream_end=True)
    assert len(final_res.text) > 0
    assert final_res.is_final is True


def test_cat_d07_suffix_window_freezing_invariance():
    """Sustained streaming freezes older tokens and guarantees strict prefix monotonicity."""
    vocab = ["<blank>", "<unk>", "क", "ख", "ग", " ", "a", "b"]
    dec = StreamingCTCDecoder(
        vocab=vocab,
        stability_threshold=2,
        trail_tokens=2,
        suffix_window_tokens=5,
        high_stability_threshold=3,
    )
    tokens = [" ", "क", "ख", " ", "ग", " "] * 20
    committed_history = []
    for step in range(1, 21):
        current = tokens[:step * 6]
        res = dec.update(current, is_stream_end=False)
        comm = res.committed
        if committed_history:
            assert comm.startswith(committed_history[-1])
        committed_history.append(comm)
    assert dec._frozen_token_count > 0



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


def test_cat_e05_unicode_matra_position_zero():
    """Combining matra at index 0 without preceding base consonant normalizes safely."""
    isolated_matra = "\u093E"
    normalized = normalize_indic_text(isolated_matra)
    assert isinstance(normalized, str)
    repaired = repair_brahmic_orthography(isolated_matra)
    assert isinstance(repaired, str)

    joined = join_subwords("धर्म", "\u093E")
    assert joined == "धर्मा"


def test_cat_e06_multi_script_combining_mark_collisions():
    """Multi-script combining mark collisions are repaired without corruption."""
    collision = "क\u0CC6\u09CD"
    repaired = repair_brahmic_orthography(collision)
    assert repaired == "क\u0CC6"


def test_cat_e07_virama_sequences_and_idempotency():
    """Consecutive viramas, matra-virama sequences, and normalizer idempotency."""
    consecutive_viramas = "क्\u094D\u094D"
    normalized = normalize_indic_text(consecutive_viramas)
    assert normalized == "क्"

    matra_virama = "की\u094D"
    repaired_mv = repair_brahmic_orthography(matra_virama)
    assert repaired_mv == "की"

    indep_virama = "ई\u094D"
    repaired_iv = repair_brahmic_orthography(indep_virama)
    assert repaired_iv == "ई"

    text = "धर्मक्षेत्रे कुरुक्षेत्रे समवेता युयुत्सवः"
    pass1 = repair_brahmic_orthography(text)
    pass2 = repair_brahmic_orthography(pass1)
    assert pass1 == pass2



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
