"""Unit tests for Swanada Linear-Time Greedy CTC Decoder and Multilingual Normalizer."""

import json
from pathlib import Path
import unicodedata
import numpy as np
import pytest

from swanada.core import Swanada
from swanada.decoder import (
    CTCDecodeResult,
    CTCGreedyDecoder,
    decode_ctc,
    decode_ctc_tokens,
    is_special_token,
)
from swanada.engine import AcousticEngine
from swanada.normalizer import (
    assemble_text,
    dedup_marks,
    normalize_indic_text,
)

REPO_ROOT = Path(__file__).resolve().parents[1]
MODEL_PATH = REPO_ROOT / "models" / "onnx" / "sushrota_sanskrit_ctc_int8.onnx"
VOCAB_PATH = REPO_ROOT / "models" / "vocabularies" / "sanskrit_vocab.json"
TEST_WAV = Path("/Users/lika/labs/ninada/data/wavs/sa_rasa_male_01445fb1731b.wav")

DUMMY_VOCAB = [
    "<blank>",  # 0
    "<unk>",    # 1
    "\u2581स",   # 2
    "त्य",      # 3
    "म्",       # 4
    "\u2581व",   # 5
    "द",        # 6
    "\u2581b",   # 7
    "o",        # 8
    "k",        # 9
]


def test_blank_elimination() -> None:
    """Verify class 0 blank tokens are never emitted into text or tokenIds."""
    # Sequence [0, 2, 0, 3, 0] -> emits [2, 3]
    tokens = [0, 2, 0, 3, 0]
    res = decode_ctc_tokens(tokens, DUMMY_VOCAB)
    assert res.token_ids == [2, 3]
    assert res.tokens == ["\u2581स", "त्य"]
    assert res.text == "सत्य"

    # All blanks -> empty string
    all_blanks = [0, 0, 0, 0]
    res_blank = decode_ctc_tokens(all_blanks, DUMMY_VOCAB)
    assert res_blank.token_ids == []
    assert res_blank.tokens == []
    assert res_blank.text == ""


def test_consecutive_duplicate_collapse() -> None:
    """Verify consecutive identical tokens are collapsed into single instances."""
    # [2, 2, 2, 3, 3, 4] -> emits [2, 3, 4] (" सत्यम्")
    tokens = [2, 2, 2, 3, 3, 4]
    res = decode_ctc_tokens(tokens, DUMMY_VOCAB)
    assert res.token_ids == [2, 3, 4]
    assert res.text == "सत्यम्"


def test_blank_separated_duplicates_preserved() -> None:
    """Verify intermediate blank resets state, allowing legitimate double letters."""
    # English "book": [7, 8, 8, 0, 8, 8, 9] -> 'b', 'o', [blank resets], 'o', 'k'
    tokens = [7, 8, 8, 0, 8, 8, 9]
    res = decode_ctc_tokens(tokens, DUMMY_VOCAB)
    assert res.token_ids == [7, 8, 8, 9]
    assert res.text == "book"


def test_sentencepiece_whitespace_restoration() -> None:
    """Verify \\u2581 and legacy marker ▁ are converted to standard ASCII spaces."""
    tokens = ["\u2581सत्यम्", "\u2581वद", "\u2581धर्मम्", "▁चर"]
    text = assemble_text(tokens)
    assert text == "सत्यम् वद धर्मम् चर"


def test_combining_mark_deduplication() -> None:
    """Verify duplicate combining marks are deduplicated while double letters are preserved."""
    # Duplicate u-matra artifact: 'स' + ' ु' + ' ु' -> 'सु'
    double_matra = "सु\u0941"
    normalized = dedup_marks(double_matra)
    assert normalized == "सु"

    # Duplicate virama: 'त' + '्' + '्' -> 'त्'
    double_virama = "त\u094D\u094D"
    assert dedup_marks(double_virama) == "त्"

    # Double letters/consonants in English must NOT be collapsed
    hello = "hello book"
    assert dedup_marks(hello) == "hello book"

    # Devanagari double consonants with virama must be preserved
    double_consonant = "सल्लल्लाहु"
    assert dedup_marks(double_consonant) == "सल्लल्लाहु"


def test_unicode_nfc_canonical_composition() -> None:
    """Verify output strings are strictly normalized to Unicode NFC canonical form."""
    # Decomposed Bengali O-kar: e-kar (09C7) + aa-kar (09BE) -> canonical O-kar (09CB)
    decomposed_bn = "\u09C7\u09BE"
    norm_bn = normalize_indic_text(decomposed_bn)
    assert norm_bn == "\u09CB"
    assert unicodedata.is_normalized("NFC", norm_bn)

    # Decomposed Tamil O-kar: 0BC6 + 0BBE -> 0BCA
    decomposed_ta = "\u0BC6\u0BBE"
    norm_ta = normalize_indic_text(decomposed_ta)
    assert norm_ta == "\u0BCA"
    assert unicodedata.is_normalized("NFC", norm_ta)

    # Roman IAST combining marks
    iast_decomposed = "r\u0323\u0304 a\u0304 i\u0304 u\u0304 s\u0301 s\u0323"
    iast_norm = normalize_indic_text(iast_decomposed)
    assert iast_norm == "ṝ ā ī ū ś ṣ"
    assert unicodedata.is_normalized("NFC", iast_norm)


def test_special_token_filtering() -> None:
    """Verify special non-speech tokens like <unk> and <blank> are not emitted in text."""
    assert is_special_token("<unk>") is True
    assert is_special_token("<blank>") is True
    assert is_special_token("[PAD]") is True
    assert is_special_token("\u2581स") is False

    # Logits emitting token 1 (<unk>)
    tokens = [0, 1, 2, 3]  # <blank>, <unk>, स, त्य
    res = decode_ctc_tokens(tokens, DUMMY_VOCAB, skip_special_tokens=True)
    assert res.text == "सत्य"
    assert "<unk>" not in res.tokens


def test_streaming_chunk_continuity() -> None:
    """Verify CTCGreedyDecoder preserves state across consecutive audio chunks."""
    decoder = CTCGreedyDecoder(DUMMY_VOCAB)

    # Chunk 1 ends on token 2 (स)
    c1_logits = [[0.0] * len(DUMMY_VOCAB) for _ in range(3)]
    for row in c1_logits:
        row[2] = 5.0  # token 2
    res1 = decoder.decode_chunk(c1_logits)
    assert res1.token_ids == [2]

    # Chunk 2 begins on the SAME token 2 (prolonged speech across chunk boundary)
    c2_logits = [[0.0] * len(DUMMY_VOCAB) for _ in range(3)]
    for row in c2_logits:
        row[2] = 5.0  # token 2
    res2 = decoder.decode_chunk(c2_logits)
    # Token 2 should NOT be re-emitted in chunk 2
    assert res2.token_ids == []

    # Chunk 3 transitions to token 3 (त्य)
    c3_logits = [[0.0] * len(DUMMY_VOCAB) for _ in range(2)]
    for row in c3_logits:
        row[3] = 5.0  # token 3
    res3 = decoder.decode_chunk(c3_logits)
    assert res3.token_ids == [3]


def test_end_to_end_sanskrit_speech_transcription() -> None:
    """Verify full end-to-end transcription on real Sanskrit speech audio."""
    if not MODEL_PATH.exists() or not VOCAB_PATH.exists() or not TEST_WAV.exists():
        pytest.skip("Model or test audio assets not found")

    stt = Swanada.create(language="sa")
    res = stt.transcribe(str(TEST_WAV))

    assert res.language == "sa"
    assert res.duration_ms > 4000.0
    assert res.rtf < 0.20  # Well within RTF < 1.0 real-time threshold

    expected_text = "अहं तत्रत्यानां कतिपयसौकर्याणां विषये ज्ञातुमिच्छामि"
    assert res.text == expected_text, f"Transcription mismatch! Got: {res.text}"
    assert len(res.tokens) == 30


def test_two_part_brahmic_combining_mark_deduplication() -> None:
    """Verify composite two-part Brahmic vowel signs across scripts deduplicate properly."""
    cases = [
        ("bengali_o_matra", "ক\u09cb\u09cb", "কো"),
        ("bengali_au_matra", "ক\u09cc\u09cc", "কৌ"),
        ("odia_ai_matra", "କ\u0b48\u0b48", "କୈ"),
        ("odia_o_matra", "କ\u0b4b\u0b4b", "କୋ"),
        ("odia_au_matra", "କ\u0b4c\u0b4c", "କୌ"),
        ("tamil_o_matra", "க\u0bca\u0bca", "கொ"),
        ("tamil_oo_matra", "க\u0bcb\u0bcb", "கோ"),
        ("tamil_au_matra", "க\u0bcc\u0bcc", "கௌ"),
        ("telugu_ai_matra", "క\u0c48\u0c48", "కై"),
        ("kannada_ii_matra", "ಕ\u0cc0\u0cc0", "ಕೀ"),
        ("kannada_ee_matra", "ಕ\u0cc7\u0cc7", "ಕೇ"),
        ("kannada_ai_matra", "ಕ\u0cc8\u0cc8", "ಕೈ"),
        ("kannada_o_matra", "ಕ\u0cca\u0cca", "ಕೊ"),
        ("kannada_oo_matra", "ಕ\u0ccb\u0ccb", "ಕೋ"),
        ("malayalam_o_matra", "ക\u0d4a\u0d4a", "കൊ"),
        ("malayalam_oo_matra", "ക\u0d4b\u0d4b", "കോ"),
        ("malayalam_au_matra", "ക\u0d4c\u0d4c", "കൌ"),
    ]
    for name, raw, expected in cases:
        norm = normalize_indic_text(raw)
        assert norm == expected, f"Failed for {name}: {raw!r} -> {norm!r} (expected {expected!r})"


def test_empty_nested_list_guard() -> None:
    """Verify decode_ctc([[]]) handles empty inner lists gracefully without ValueError."""
    res = decode_ctc([[]], DUMMY_VOCAB)
    assert res.text == ""
    assert res.tokens == []
    assert res.token_ids == []

    decoder = CTCGreedyDecoder(DUMMY_VOCAB)
    res_stream = decoder.decode_chunk([[]])
    assert res_stream.text == ""
    assert res_stream.tokens == []
    assert res_stream.token_ids == []


def test_empty_numpy_logits_guard() -> None:
    """Verify decode_ctc handles empty and zero-class numpy arrays safely."""
    res_0xV = decode_ctc(np.zeros((0, 10), dtype=np.float32), DUMMY_VOCAB)
    assert res_0xV.text == ""

    res_Tx0 = decode_ctc(np.zeros((5, 0), dtype=np.float32), DUMMY_VOCAB)
    assert res_Tx0.text == ""

    res_3d = decode_ctc(np.zeros((1, 0, 10), dtype=np.float32), DUMMY_VOCAB)
    assert res_3d.text == ""
