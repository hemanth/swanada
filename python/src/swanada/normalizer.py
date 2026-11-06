"""Multilingual Indic and Latin text normalizer for ASR outputs."""

import re
import unicodedata
from typing import List

_BRAHMIC_PRIMARY_MATRA_CLASS = (
    "\u093E-\u094C\u094E-\u094F\u0962-\u0963"
    "\u09BE-\u09C4\u09C7-\u09C8\u09CB-\u09CC\u09E2-\u09E3"
    "\u0A3E-\u0A42\u0A47-\u0A48\u0A4B-\u0A4C"
    "\u0ABE-\u0AC5\u0AC7-\u0AC9\u0ACB-\u0ACC\u0AE2-\u0AE3"
    "\u0B3E-\u0B44\u0B47-\u0B48\u0B4B-\u0B4C\u0B62-\u0B63"
    "\u0BBE-\u0BC2\u0BC6-\u0BC8\u0BCA-\u0BCC"
    "\u0C3E-\u0C44\u0C46-\u0C48\u0C4A-\u0C4C\u0C62-\u0C63"
    "\u0CBE-\u0CC4\u0CC6-\u0CC8\u0CCA-\u0CCC\u0CE2-\u0CE3"
    "\u0D3E-\u0D44\u0D46-\u0D48\u0D4A-\u0D4C\u0D62-\u0D63"
)

_BRAHMIC_VIRAMA_CLASS = "\u094D\u09CD\u0A4D\u0ACD\u0B4D\u0BCD\u0C4D\u0CCD\u0D4D"

_BRAHMIC_INDEP_VOWEL_CLASS = (
    "\u0904-\u0914\u0960-\u0961"
    "\u0985-\u0994\u09E0-\u09E1"
    "\u0A05-\u0A14"
    "\u0A85-\u0A94\u0AE0-\u0AE1"
    "\u0B05-\u0B14\u0B60-\u0B61"
    "\u0B85-\u0B94"
    "\u0C05-\u0C14\u0C60-\u0C61"
    "\u0C85-\u0C94\u0CE0-\u0CE1"
    "\u0D05-\u0D14\u0D60-\u0D61"
)

_RE_COLLIDING_MATRAS = re.compile(f"([{_BRAHMIC_PRIMARY_MATRA_CLASS}])[{_BRAHMIC_PRIMARY_MATRA_CLASS}]+")
_RE_MATRA_THEN_VIRAMA = re.compile(f"([{_BRAHMIC_PRIMARY_MATRA_CLASS}])[{_BRAHMIC_VIRAMA_CLASS}]+")
_RE_INDEP_VOWEL_ILLEGAL_MARK = re.compile(
    f"([{_BRAHMIC_INDEP_VOWEL_CLASS}])[{_BRAHMIC_PRIMARY_MATRA_CLASS}{_BRAHMIC_VIRAMA_CLASS}]+"
)


def dedup_marks(text: str) -> str:
    """Deduplicate consecutive identical combining marks (Unicode category M: Mn, Mc, Me)."""
    out: List[str] = []
    for ch in text:
        if out and ch == out[-1] and unicodedata.category(ch) in ("Mn", "Mc", "Me"):
            continue
        out.append(ch)
    return "".join(out)


def repair_brahmic_orthography(nfc_text: str) -> str:
    """Repair colliding dependent vowel signs and illegal virama placements on NFC text."""
    text = _RE_COLLIDING_MATRAS.sub(r"\1", nfc_text)
    text = _RE_MATRA_THEN_VIRAMA.sub(r"\1", text)
    text = _RE_INDEP_VOWEL_ILLEGAL_MARK.sub(r"\1", text)
    return text


def normalize_indic_text(
    raw_text: str,
    dedup: bool = True,
    normalize_nfc: bool = True,
    space_marker: str = "\u2581",
) -> str:
    """Normalizes ASR output text across all 12 Indic languages and Latin/IAST."""
    text = raw_text

    # 1. Replace SentencePiece space marker with standard ASCII space
    if space_marker:
        text = text.replace(space_marker, " ")
    text = re.sub(r"[\u2581\u2582\u2583▁]", " ", text)

    # 2. Deduplicate combining marks and repair Brahmic matra collisions
    if dedup:
        text = unicodedata.normalize("NFC", text)
        text = dedup_marks(text)
        text = repair_brahmic_orthography(text)
        text = unicodedata.normalize("NFD", text)
        text = dedup_marks(text)

    # 3. Recompose to canonical NFC
    if normalize_nfc:
        text = unicodedata.normalize("NFC", text)
        if dedup:
            text = repair_brahmic_orthography(text)

    # 4. Collapse multiple whitespace and trim
    return re.sub(r"\s+", " ", text).strip()


def assemble_text(
    tokens: List[str],
    dedup: bool = True,
    normalize_nfc: bool = True,
    space_marker: str = "\u2581",
) -> str:
    """Stitch list of token strings into normalized text."""
    return normalize_indic_text(
        "".join(tokens),
        dedup=dedup,
        normalize_nfc=normalize_nfc,
        space_marker=space_marker,
    )
