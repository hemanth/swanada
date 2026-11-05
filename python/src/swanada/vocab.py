"""Multilingual Vocabulary Registry, Script Metadata, and Sanskrit IAST for Swanada."""

from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import unicodedata
from typing import Dict, List, Optional, Tuple, Union

SUPPORTED_LANGUAGES = (
    "sa", "en", "hi", "kn", "mr", "bn", "ta", "te", "ml", "gu", "pa", "or"
)
BLANK_TOKEN_ID = 0
UNK_TOKEN_ID = 1


@dataclass(frozen=True)
class LanguageMeta:
    code: str
    name: str
    native_name: str
    script: str
    unicode_range: Tuple[int, int]
    vocab_filename: str
    model_filename: str


REGISTRY: Dict[str, LanguageMeta] = {
    "sa": LanguageMeta("sa", "Sanskrit", "संस्कृतम्", "Devanagari", (0x0900, 0x097F), "sa_vocab.json", "swanada_sa_ctc_int8.onnx"),
    "hi": LanguageMeta("hi", "Hindi", "हिन्दी", "Devanagari", (0x0900, 0x097F), "hi_vocab.json", "swanada_hi_ctc_int8.onnx"),
    "kn": LanguageMeta("kn", "Kannada", "ಕನ್ನಡ", "Kannada", (0x0C80, 0x0CFF), "kn_vocab.json", "swanada_kn_ctc_int8.onnx"),
    "mr": LanguageMeta("mr", "Marathi", "मराठी", "Devanagari", (0x0900, 0x097F), "mr_vocab.json", "swanada_mr_ctc_int8.onnx"),
    "bn": LanguageMeta("bn", "Bengali", "বাংলা", "Bengali", (0x0980, 0x09FF), "bn_vocab.json", "swanada_bn_ctc_int8.onnx"),
    "ta": LanguageMeta("ta", "Tamil", "தமிழ்", "Tamil", (0x0B80, 0x0BFF), "ta_vocab.json", "swanada_ta_ctc_int8.onnx"),
    "te": LanguageMeta("te", "Telugu", "తెలుగు", "Telugu", (0x0C00, 0x0C7F), "te_vocab.json", "swanada_te_ctc_int8.onnx"),
    "ml": LanguageMeta("ml", "Malayalam", "മലയാളം", "Malayalam", (0x0D00, 0x0D7F), "ml_vocab.json", "swanada_ml_ctc_int8.onnx"),
    "gu": LanguageMeta("gu", "Gujarati", "ગુજરાતી", "Gujarati", (0x0A80, 0x0AFF), "gu_vocab.json", "swanada_gu_ctc_int8.onnx"),
    "pa": LanguageMeta("pa", "Punjabi", "ਪੰਜਾਬੀ", "Gurmukhi", (0x0A00, 0x0A7F), "pa_vocab.json", "swanada_pa_ctc_int8.onnx"),
    "or": LanguageMeta("or", "Odia", "ଓଡ଼ିଆ", "Odia", (0x0B00, 0x0B7F), "or_vocab.json", "swanada_or_ctc_int8.onnx"),
    "en": LanguageMeta("en", "Indian English", "English", "Latin", (0x0020, 0x007E), "en_vocab.json", "swanada_en_ctc_int8.onnx"),
}


class Vocabulary:
    """Bijective token vocabulary manager for CTC decoding."""

    def __init__(self, tokens: List[str], language: str = "sa"):
        self.language = language
        self.id_to_token: List[str] = list(tokens)
        self.token_to_id: Dict[str, int] = {tok: idx for idx, tok in enumerate(tokens)}
        assert len(self.id_to_token) == len(self.token_to_id), "Token mapping must be bijective"
        assert self.id_to_token[BLANK_TOKEN_ID] == "<blank>", "Index 0 must be <blank>"

    def __len__(self) -> int:
        return len(self.id_to_token)

    def get_token(self, token_id: int) -> str:
        if 0 <= token_id < len(self.id_to_token):
            return self.id_to_token[token_id]
        return "<unk>"

    def get_id(self, token: str) -> int:
        return self.token_to_id.get(token, UNK_TOKEN_ID)

    @classmethod
    def load(cls, vocab_path: Union[str, Path], language: str = "sa") -> "Vocabulary":
        path = Path(vocab_path)
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, list):
            tokens = data
        elif isinstance(data, dict):
            # Sort by integer keys or values
            try:
                tokens = [data[str(i)] for i in range(len(data))]
            except KeyError:
                tokens = list(data.values())
        else:
            raise ValueError(f"Unsupported vocabulary format in {path}")
        return cls(tokens=tokens, language=language)


def detect_script(text: str) -> Optional[str]:
    """Detect language/script from Unicode codepoint frequencies."""
    counts: Dict[str, int] = {}
    for ch in text:
        cp = ord(ch)
        for lang, meta in REGISTRY.items():
            if lang == "en":
                # Restrict English strictly to Latin alphabetic letters (A-Z, a-z)
                # to prevent ASCII spaces and punctuation from leaking into English.
                if (0x41 <= cp <= 0x5A) or (0x61 <= cp <= 0x7A):
                    counts[lang] = counts.get(lang, 0) + 1
                    break
            else:
                start, end = meta.unicode_range
                if start <= cp <= end:
                    counts[lang] = counts.get(lang, 0) + 1
                    break
    if not counts:
        return None
    return max(counts.items(), key=lambda item: item[1])[0]


# Classical Sanskrit Devanagari to Roman IAST Transliteration

VOWEL_MAP = {
    "अ": "a", "आ": "ā", "इ": "i", "ई": "ī", "उ": "u", "ऊ": "ū",
    "ऋ": "ṛ", "ॠ": "ṝ", "ऌ": "ḷ", "ॡ": "ḹ",
    "ए": "e", "ऐ": "ai", "ओ": "o", "औ": "au",
}

MATRA_MAP = {
    "ा": "ā", "ि": "i", "ी": "ī", "ु": "u", "ू": "ū",
    "ृ": "ṛ", "ॄ": "ṝ", "ॢ": "ḷ", "ॣ": "ḹ",
    "े": "e", "ै": "ai", "ो": "o", "ौ": "au",
}

CONSONANT_MAP = {
    "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "ṅ",
    "च": "c", "छ": "ch", "ज": "j", "झ": "jh", "ञ": "ñ",
    "ट": "ṭ", "ठ": "ṭh", "ड": "ḍ", "ढ": "ḍh", "ण": "ṇ",
    "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n",
    "प": "p", "फ": "ph", "ब": "b", "भ": "bh", "म": "m",
    "य": "y", "र": "r", "ल": "l", "व": "v",
    "श": "ś", "ष": "ṣ", "स": "s", "ह": "h",
    "ळ": "ḻ", "ऴ": "ḻh",
}

SPECIAL_MAP = {
    "ं": "ṃ",   # Anusvara
    "ः": "ḥ",   # Visarga
    "ँ": "m̐",  # Anunasika / Candrabindu
    "ऽ": "'",   # Avagraha
    "।": ".",   # Danda
    "॥": "..",  # Double Danda
}

ACCENT_MAP = {
    "\u0951": "\u0301",  # Udatta (combining acute)
    "\u0952": "\u0300",  # Anudatta (combining grave)
}


def devanagari_to_iast(text: str) -> str:
    """Deterministically converts Devanagari Sanskrit text to Roman IAST with Vedic accents."""
    text = unicodedata.normalize("NFC", text)
    result: List[str] = []
    i = 0
    n = len(text)

    while i < n:
        ch = text[i]

        # 1. Standalone Vowels
        if ch in VOWEL_MAP:
            result.append(VOWEL_MAP[ch])
            i += 1
            while i < n and text[i] in ACCENT_MAP:
                result.append(ACCENT_MAP[text[i]])
                i += 1
            continue

        # 2. Consonants with inherent schwa
        if ch in CONSONANT_MAP:
            base_c = CONSONANT_MAP[ch]
            i += 1
            if i < n and text[i] == "्":  # Virama suppresses inherent 'a'
                result.append(base_c)
                i += 1
            elif i < n and text[i] in MATRA_MAP:  # Matra replaces inherent 'a'
                result.append(base_c)
                result.append(MATRA_MAP[text[i]])
                i += 1
                while i < n and text[i] in ACCENT_MAP:
                    result.append(ACCENT_MAP[text[i]])
                    i += 1
            else:  # Inherent 'a'
                result.append(base_c)
                result.append("a")
                while i < n and text[i] in ACCENT_MAP:
                    result.append(ACCENT_MAP[text[i]])
                    i += 1
            continue

        # 3. Special Characters and Diacritics
        if ch in SPECIAL_MAP:
            result.append(SPECIAL_MAP[ch])
            i += 1
            while i < n and text[i] in ACCENT_MAP:
                result.append(ACCENT_MAP[text[i]])
                i += 1
            continue

        # 3b. Standalone / Orphan Vedic accents
        if ch in ACCENT_MAP:
            result.append(ACCENT_MAP[ch])
            i += 1
            continue

        # 4. Numerals, spaces, and pass-through characters
        result.append(ch)
        i += 1

    composed = "".join(result)
    return unicodedata.normalize("NFC", composed)


def transliterate_iast(text: str) -> str:
    """Alias for devanagari_to_iast."""
    return devanagari_to_iast(text)
