"""Adversarial stress harness for Milestone 4 Challenger 2 verification.

Empirical verification of 5 edge and failure boundary dimensions:
1. Corrupt WAV byte headers, zero sample rates, zero channels.
2. Arrays with NaN, +Inf, -Inf PCM audio samples.
3. Extreme negative SNR noise floors and Dirac impulse trains.
4. Suffix window freezing under long streaming sequences with zero word boundaries.
5. Illegal Unicode combining mark sequences at string start and cross-script collisions.
"""

import io
import math
import struct
import numpy as np
import pytest

from swanada.audio import load_audio, parse_wav, resample_audio
from swanada.frontend import extract_log_mel_features
from swanada.denoise import enhance_speech_with_telemetry
from swanada.streaming import StreamingCTCDecoder
from swanada.normalizer import (
    dedup_marks,
    repair_brahmic_orthography,
    normalize_indic_text,
    join_subwords,
)
from swanada import Swanada


# ==============================================================================
# Dimension 1: Corrupt WAV byte headers, zero sample rates, zero channels
# ==============================================================================

def test_dim1_truncated_headers():
    """Verify that truncated WAV byte buffers (< 44 bytes) raise descriptive exceptions."""
    for length in [0, 1, 4, 12, 36, 43]:
        trunc_buf = b"RIFF" + b"\x00" * max(0, length - 4)
        with pytest.raises(Exception):
            parse_wav(trunc_buf[:length])


def test_dim1_corrupt_magic_headers():
    """Verify that non-RIFF and non-WAVE magic headers are rejected."""
    bad_magic_1 = b"NOPE" + b"\x00" * 40
    with pytest.raises(Exception):
        parse_wav(bad_magic_1)

    bad_magic_2 = bytearray(44)
    bad_magic_2[0:4] = b"RIFF"
    struct.pack_into("<L", bad_magic_2, 4, 36)
    bad_magic_2[8:12] = b"FAIL"
    with pytest.raises(Exception):
        parse_wav(bytes(bad_magic_2))


def test_dim1_zero_sample_rate_and_channels():
    """Verify that zero sample rate or zero channels are rejected safely."""
    # Zero sample rate
    hdr_zero_sr = bytearray(44)
    hdr_zero_sr[0:4] = b"RIFF"
    struct.pack_into("<L", hdr_zero_sr, 4, 36)
    hdr_zero_sr[8:12] = b"WAVE"
    hdr_zero_sr[12:16] = b"fmt "
    struct.pack_into("<L", hdr_zero_sr, 16, 16)
    struct.pack_into("<H", hdr_zero_sr, 20, 1)
    struct.pack_into("<H", hdr_zero_sr, 22, 1)
    struct.pack_into("<L", hdr_zero_sr, 24, 0)
    struct.pack_into("<L", hdr_zero_sr, 28, 0)
    struct.pack_into("<H", hdr_zero_sr, 32, 2)
    struct.pack_into("<H", hdr_zero_sr, 34, 16)
    hdr_zero_sr[36:40] = b"data"
    struct.pack_into("<L", hdr_zero_sr, 40, 0)
    with pytest.raises(Exception):
        parse_wav(bytes(hdr_zero_sr))

    # Zero channels
    hdr_zero_ch = bytearray(44)
    hdr_zero_ch[0:4] = b"RIFF"
    struct.pack_into("<L", hdr_zero_ch, 4, 36)
    hdr_zero_ch[8:12] = b"WAVE"
    hdr_zero_ch[12:16] = b"fmt "
    struct.pack_into("<L", hdr_zero_ch, 16, 16)
    struct.pack_into("<H", hdr_zero_ch, 20, 1)
    struct.pack_into("<H", hdr_zero_ch, 22, 0)
    struct.pack_into("<L", hdr_zero_ch, 24, 16000)
    struct.pack_into("<L", hdr_zero_ch, 28, 32000)
    struct.pack_into("<H", hdr_zero_ch, 32, 2)
    struct.pack_into("<H", hdr_zero_ch, 34, 16)
    hdr_zero_ch[36:40] = b"data"
    struct.pack_into("<L", hdr_zero_ch, 40, 0)
    with pytest.raises(Exception):
        parse_wav(bytes(hdr_zero_ch))


# ==============================================================================
# Dimension 2: Arrays with NaN, +Inf, -Inf PCM audio samples
# ==============================================================================

def test_dim2_non_finite_pcm_arrays():
    """Verify that non-finite PCM arrays execute without crashing."""
    stt = Swanada(language="sa")

    test_vectors = [
        ("all_nan", np.full(16000, np.nan, dtype=np.float32)),
        ("all_pos_inf", np.full(16000, np.inf, dtype=np.float32)),
        ("all_neg_inf", np.full(16000, -np.inf, dtype=np.float32)),
        ("interleaved_non_finite", np.array([np.nan, np.inf, -np.inf, 0.0] * 4000, dtype=np.float32)),
    ]

    for name, pcm in test_vectors:
        # Denoise telemetry
        telem = enhance_speech_with_telemetry(pcm)
        assert isinstance(telem.is_speech_likely, bool)

        # Feature extraction
        feats, flen = extract_log_mel_features(pcm)
        assert feats.shape[0] == 1
        assert feats.shape[1] == 80
        assert flen == len(pcm) // 160

        # High-level transcribe
        res = stt.transcribe(pcm)
        assert isinstance(res.text, str)
        assert res.duration_ms > 0


# ==============================================================================
# Dimension 3: Extreme negative SNR noise floors and Dirac impulse trains
# ==============================================================================

def test_dim3_extreme_negative_snr():
    """Verify that severe negative SNR noise floors (-15 dB to -30 dB) are attenuated."""
    sr = 16000
    n = sr * 2
    np.random.seed(42)

    for snr_db in [-15.0, -20.0, -30.0]:
        noise = np.random.normal(0, 0.3, n).astype(np.float32)
        tone_amp = 0.3 * (10.0 ** (snr_db / 20.0))
        t = np.arange(n) / sr
        signal = np.clip(noise + tone_amp * np.sin(2 * np.pi * 1000 * t), -1.0, 1.0).astype(np.float32)

        telem = enhance_speech_with_telemetry(signal)
        assert np.all(np.isfinite(telem.pcm))
        assert telem.suppression_db >= 10.0


def test_dim3_dirac_impulse_trains():
    """Verify that alternating and high-density Dirac impulse trains remain bounded."""
    sr = 16000
    n = sr * 2

    # Alternating +/- 1.0 Dirac deltas
    dirac_alt = np.zeros(n, dtype=np.float32)
    dirac_alt[::80] = 1.0
    dirac_alt[40::80] = -1.0

    telem_alt = enhance_speech_with_telemetry(dirac_alt)
    assert np.all(np.isfinite(telem_alt.pcm))
    assert np.max(np.abs(telem_alt.pcm)) <= 1.05

    # Dense Dirac deltas (every 10 samples)
    dirac_dense = np.zeros(n, dtype=np.float32)
    dirac_dense[::10] = 1.0

    telem_dense = enhance_speech_with_telemetry(dirac_dense)
    assert np.all(np.isfinite(telem_dense.pcm))
    assert np.max(np.abs(telem_dense.pcm)) <= 1.05


# ==============================================================================
# Dimension 4: Suffix window freezing under long streaming with zero word boundaries
# ==============================================================================

def test_dim4_suffix_window_freezing_zero_boundaries():
    """Verify that long continuous token sequences with zero spaces freeze stably."""
    decoder = StreamingCTCDecoder(
        vocab={},
        stability_threshold=2,
        trail_tokens=3,
        suffix_window_tokens=15,
        high_stability_threshold=4,
    )

    syllables = ["वि", "द्या", "ल", "य", "स्य", "म", "हा", "रा", "ज"] * 30  # 270 tokens
    committed_lens = []

    for step in range(len(syllables)):
        tokens = syllables[:step + 1]
        for _ in range(5):
            res = decoder.update(tokens, is_stream_end=False)
        committed_lens.append(len(decoder.committed_tokens))

    # Verify strict monotonicity of committed token count
    assert all(committed_lens[i] <= committed_lens[i + 1] for i in range(len(committed_lens) - 1))
    assert len(decoder.committed_tokens) >= 250

    # Verify that frozen token count advanced
    assert decoder._frozen_token_count > 0
    assert decoder._frozen_token_count <= len(decoder.committed_tokens)

    # Verify that zero space characters were injected into continuous Sanskrit compound word
    assert " " not in decoder.committed_text

    # Final flush
    final_res = decoder.update(syllables, is_stream_end=True)
    assert final_res.is_final is True
    assert len(final_res.text) > 0


# ==============================================================================
# Dimension 5: Illegal Unicode combining mark sequences at string start and cross-script collisions
# ==============================================================================

def test_dim5_illegal_combining_marks_and_cross_script():
    """Verify safe normalization of initial combining marks and cross-script collisions."""
    # Combining matra at position 0
    s_matra_0 = "\u093E\u0915\u093E"
    norm_matra_0 = normalize_indic_text(s_matra_0)
    assert norm_matra_0 == "ाका"

    # Subword join with matra at pos 0 of volatile
    joined = join_subwords("राम", "\u093E")
    assert joined == "रामा"

    # Cross-script matra collision: Devanagari base + Devanagari AA + Bengali AA + Gujarati virama
    s_cross = "\u0915\u093E\u09BE\u0ACD"
    norm_cross = normalize_indic_text(s_cross)
    assert norm_cross == "का"

    # Consecutive viramas across scripts
    s_viramas = "\u0915\u094D\u0C4D\u0BCD"
    norm_viramas = normalize_indic_text(s_viramas)
    assert norm_viramas.startswith("क्")

    # Independent vowel with illegal dependent vowel sign
    s_indep = "\u0905\u093E\u094D\u0B3E"
    norm_indep = normalize_indic_text(s_indep)
    assert norm_indep == "अ"

    # Idempotency check: normalize(normalize(x)) == normalize(x)
    corpus = [
        s_matra_0,
        s_cross,
        s_viramas,
        s_indep,
        "संस्कृृतम्",
        "ಸ್ಥಗಿತಗೊಳಳ್ಸಿದೆ",
        "ಉಂಮಾ",
        "હું જઈષ",
        "ସଧ୍ୟାଂଙ୍କୁ",
        "ਉਹ ਇੱਥੇ",
    ]
    for s in corpus:
        n1 = normalize_indic_text(s)
        n2 = normalize_indic_text(n1)
        assert n1 == n2
