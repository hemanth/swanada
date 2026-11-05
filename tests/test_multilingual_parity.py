"""Unit tests for Multilingual Vocabularies, Registry, Sanskrit IAST, and VAD Energy Gate."""

import json
from pathlib import Path
import numpy as np
import pytest

from swanada import (
    REGISTRY,
    Vocabulary,
    detect_script,
    devanagari_to_iast,
    transliterate_iast,
    Swanada,
    AcousticEngine,
    SUPPORTED_LANGUAGES,
    BLANK_TOKEN_ID,
)

REPO_ROOT = Path(__file__).resolve().parents[1]
VOCAB_DIR = REPO_ROOT / "models" / "vocabularies"
ONNX_DIR = REPO_ROOT / "models" / "onnx"


def test_registry_covers_all_12_languages() -> None:
    assert len(SUPPORTED_LANGUAGES) == 12
    for lang in SUPPORTED_LANGUAGES:
        assert lang in REGISTRY
        meta = REGISTRY[lang]
        assert meta.code == lang
        assert meta.vocab_filename.endswith(".json")
        assert meta.model_filename.endswith(".onnx")
        start, end = meta.unicode_range
        assert start < end


def test_vocabularies_exist_and_conform_to_257_classes() -> None:
    for lang in SUPPORTED_LANGUAGES:
        v_file = VOCAB_DIR / f"{lang}_vocab.json"
        assert v_file.exists(), f"Missing vocabulary file for {lang}: {v_file}"
        with open(v_file, "r", encoding="utf-8") as f:
            tokens = json.load(f)
        assert len(tokens) == 257, f"Expected 257 tokens for {lang}, got {len(tokens)}"
        assert tokens[BLANK_TOKEN_ID] == "<blank>"
        assert tokens[1] == "<unk>"

    # Check sanskrit_vocab.json backward compatibility copy
    sa_legacy = VOCAB_DIR / "sanskrit_vocab.json"
    assert sa_legacy.exists()
    with open(sa_legacy, "r", encoding="utf-8") as f:
        sa_tokens = json.load(f)
    assert len(sa_tokens) == 257
    assert sa_tokens[0] == "<blank>"


def test_vocabulary_class_bijective_and_oov_handling() -> None:
    tokens = ["<blank>", "<unk>", "a", "b", "c"]
    vocab = Vocabulary(tokens, language="en")
    assert len(vocab) == 5
    assert vocab.get_token(0) == "<blank>"
    assert vocab.get_token(2) == "a"
    assert vocab.get_token(99) == "<unk>"
    assert vocab.get_id("<blank>") == 0
    assert vocab.get_id("a") == 2
    assert vocab.get_id("nonexistent") == 1


def test_detect_script() -> None:
    assert detect_script("संस्कृतम्") == "sa"
    assert detect_script("ಕನ್ನಡ") == "kn"
    assert detect_script("தமிழ்") == "ta"
    assert detect_script("తెలుగు") == "te"
    assert detect_script("മലയാളം") == "ml"
    assert detect_script("বাংলা") == "bn"
    assert detect_script("ગુજરાતી") == "gu"
    assert detect_script("ਪੰਜਾਬੀ") == "pa"
    assert detect_script("ଓଡ଼ିଆ") == "or"
    assert detect_script("Hello Indian English") == "en"
    assert detect_script("") is None


def test_sanskrit_iast_exact_sentence() -> None:
    input_text = "अहं तत्रत्यानां कतिपयसौकर्याणां विषये ज्ञातुमिच्छामि"
    expected = "ahaṃ tatratyānāṃ katipayasaukaryāṇāṃ viṣaye jñātumicchāmi"
    actual = devanagari_to_iast(input_text)
    assert actual == expected
    assert transliterate_iast(input_text) == expected
    assert Swanada.transliterate_iast(input_text) == expected


def test_sanskrit_iast_vocalic_liquids_and_accents() -> None:
    assert devanagari_to_iast("ऋषि") == "ṛṣi"
    assert devanagari_to_iast("पितॄन्") == "pitṝn"
    assert devanagari_to_iast("कॢप्त") == "kḷpta"
    assert devanagari_to_iast("नमः शिवाय") == "namaḥ śivāya"
    assert devanagari_to_iast("सोऽहम्") == "so'ham"
    assert devanagari_to_iast("हँस") == "ham̐sa"
    assert devanagari_to_iast("शान्तिः । शान्तिः ॥") == "śāntiḥ . śāntiḥ .."

    # Vedic accents
    vedic = "अ॒ग्निमी॑ळे"
    iast_vedic = devanagari_to_iast(vedic)
    assert "gni" in iast_vedic
    assert "ḻe" in iast_vedic


def test_vad_silence_energy_gate() -> None:
    engine = AcousticEngine(language="sa")
    silence = np.zeros(16000, dtype=np.float32)

    res = engine.transcribe(silence)
    assert res.text == ""
    assert res.tokens == []
    assert res.duration_ms == 1000.0
    assert res.inference_ms < 2.0  # Bypassed Mel and Conformer layers!
    assert res.language == "sa"


def test_sliced_onnx_models_exist() -> None:
    for lang in SUPPORTED_LANGUAGES:
        m_file = ONNX_DIR / f"swanada_{lang}_ctc_int8.onnx"
        assert m_file.exists(), f"Missing ONNX model for {lang}: {m_file}"
        assert m_file.stat().st_size > 100_000_000, f"Model file abnormally small: {m_file}"
