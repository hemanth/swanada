"""Multilingual Indic and Latin text normalizer for ASR outputs."""

import re
import unicodedata
from typing import List, Optional


def dedup_marks(text: str) -> str:
    """Deduplicate consecutive identical combining marks (Unicode category M: Mn, Mc, Me).

    Prevents the CTC greedy artifact where prolonged vowels produce duplicated
    matras (e.g. [matra, blank, matra] -> 'सुु' -> 'सु').
    Consonants and letters (e.g. double 'l' in "hello") are preserved.
    """
    out: List[str] = []
    for ch in text:
        if out and ch == out[-1] and unicodedata.category(ch) in ("Mn", "Mc", "Me"):
            continue
        out.append(ch)
    return "".join(out)


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

    # 2. Deduplicate combining marks
    # Two-pass deduplication: NFC handles composite two-part vowel signs (e.g. Bengali \u09cb, Tamil \u0bca),
    # followed by NFD to handle decomposed combining sequences, before final recomposition.
    if dedup:
        text = unicodedata.normalize("NFC", text)
        text = dedup_marks(text)
        text = unicodedata.normalize("NFD", text)
        text = dedup_marks(text)

    # 3. Recompose to canonical NFC
    if normalize_nfc:
        text = unicodedata.normalize("NFC", text)

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
