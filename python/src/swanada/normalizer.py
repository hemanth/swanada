"""Multilingual Indic and Latin text normalizer for ASR outputs."""

import re
import unicodedata
from typing import List, Optional, Union

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

_BRAHMIC_LATERAL_CONSONANTS = "\u0CB3\u0B33\u0C33"

_RE_COLLIDING_MATRAS = re.compile(f"([{_BRAHMIC_PRIMARY_MATRA_CLASS}])[{_BRAHMIC_PRIMARY_MATRA_CLASS}]+")
_RE_MATRA_THEN_VIRAMA = re.compile(f"([{_BRAHMIC_PRIMARY_MATRA_CLASS}])[{_BRAHMIC_VIRAMA_CLASS}]+")
_RE_INDEP_VOWEL_ILLEGAL_MARK = re.compile(
    f"([{_BRAHMIC_INDEP_VOWEL_CLASS}])([{_BRAHMIC_PRIMARY_MATRA_CLASS}{_BRAHMIC_VIRAMA_CLASS}]+)"
)

_RE_DUPLICATE_LATERAL_LIGATURE = re.compile(
    f"([{_BRAHMIC_LATERAL_CONSONANTS}])\\1+([{_BRAHMIC_VIRAMA_CLASS}])"
)

_RE_ML_SPLIT_NASAL_GEMINATE = re.compile(r"\u0D02([\u0D19\u0D1E\u0D23\u0D28\u0D2E])")
_RE_GU_FUTURE_SIBILANT = re.compile(r"ઈષ(?=[^\u0A80-\u0AFF]|$)")
_RE_OR_DETACHED_ANUSVARA = re.compile(r"\u0B02(\u0B19\u0B4D[\u0B15-\u0B18])")
_RE_OR_DATIVE_SUFFIX = re.compile(r"\u0B02\u0B15\u0B41(?=[^\u0B00-\u0B7F]|$)")
_RE_PA_MATRA_INDEP_VOWEL = re.compile(r"(?<!\u0A39)([\u0A3E-\u0A4A\u0A4C])(\u0A0F)(?=[\u0A15-\u0A39\u0A59-\u0A5E])")

_OPENING_PUNCT_CHARS = frozenset(
    "-–—'’‘`([{<\"“«/\\"
    "\u2010\u2011\u2012\u2013\u2014\u2212"
)

_CLOSING_PUNCT_CHARS = frozenset(
    ",.?!:;)[]}>”»%'’–—।॥"
    "\u2010\u2011\u2012\u2013\u2014\u2212"
)

_WORD_BOUNDARY_MARKERS = ("\u2581", "▁", "\u2582", "\u2583", " ", "\t")


def dedup_marks(text: str) -> str:
    """Deduplicate consecutive identical combining marks (Unicode category M: Mn, Mc, Me)."""
    out: List[str] = []
    for ch in text:
        if out and ch == out[-1] and unicodedata.category(ch) in ("Mn", "Mc", "Me"):
            continue
        out.append(ch)
    return "".join(out)


def repair_brahmic_orthography(nfc_text: str, lang: str = "") -> str:
    """Repair colliding dependent vowel signs, duplicate ligatures, and orthographic defects."""
    text = _RE_COLLIDING_MATRAS.sub(r"\1", nfc_text)
    text = _RE_MATRA_THEN_VIRAMA.sub(r"\1", text)
    text = _RE_INDEP_VOWEL_ILLEGAL_MARK.sub(
        lambda m: m.group(0) if m.group(1) == "\u0985" and m.group(2).startswith("\u09CD") else m.group(1),
        text,
    )

    # 1. Kannada / Telugu / Odia duplicate retroflex lateral ligature (ೊಳಳ್ -> ೊಳ್)
    text = _RE_DUPLICATE_LATERAL_LIGATURE.sub(r"\1\2", text)

    # 2. Malayalam nasal geminate reunification (ഉംമാ -> ഉമ്മാ)
    text = _RE_ML_SPLIT_NASAL_GEMINATE.sub(lambda m: f"{m.group(1)}\u0D4D{m.group(1)}", text)

    # 3. Gujarati palatal sibilant restoration (જઈષ -> જઈશ)
    text = _RE_GU_FUTURE_SIBILANT.sub("ઈશ", text)

    # 4. Odia detached anusvara (ଂଙ୍କ -> ଙ୍କ) and dative normalization (ଂକୁ -> ଙ୍କୁ)
    text = _RE_OR_DETACHED_ANUSVARA.sub(r"\1", text)
    text = _RE_OR_DATIVE_SUFFIX.sub("\u0B19\u0B4D\u0B15\u0B41", text)

    # 5. Gurmukhi independent vowel following dependent matra word boundary separation
    text = _RE_PA_MATRA_INDEP_VOWEL.sub(r"\1 \2", text)

    return text


def normalize_indic_text(
    raw_text: str,
    dedup: bool = True,
    normalize_nfc: bool = True,
    space_marker: str = "\u2581",
    lang: str = "",
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
        text = repair_brahmic_orthography(text, lang=lang)
        text = unicodedata.normalize("NFD", text)
        text = dedup_marks(text)

    # 3. Recompose to canonical NFC
    if normalize_nfc:
        text = unicodedata.normalize("NFC", text)
        if dedup:
            text = repair_brahmic_orthography(text, lang=lang)

    # 4. Collapse multiple whitespace and trim
    return re.sub(r"\s+", " ", text).strip()


def assemble_text(
    tokens: List[str],
    dedup: bool = True,
    normalize_nfc: bool = True,
    space_marker: str = "\u2581",
    lang: str = "",
) -> str:
    """Stitch list of token strings into normalized text."""
    return normalize_indic_text(
        "".join(tokens),
        dedup=dedup,
        normalize_nfc=normalize_nfc,
        space_marker=space_marker,
        lang=lang,
    )


def join_subwords(
    committed: Union[str, List[str]],
    volatile: Union[str, List[str]],
    volatile_tokens: Optional[List[str]] = None,
    dedup: bool = True,
    normalize_nfc: bool = True,
    space_marker: str = "\u2581",
    lang: str = "",
) -> str:
    """Conditionally concatenates committed and volatile text without illegitimate whitespace.

    Preserves 0.00% churn contract by attaching continuation morphemes, Brahmic matras,
    viramas, conjuncts, and attached punctuation directly to the committed prefix.
    """
    if isinstance(committed, list):
        committed_str = normalize_indic_text(
            "".join(committed),
            dedup=dedup,
            normalize_nfc=normalize_nfc,
            space_marker=space_marker,
            lang=lang,
        )
    else:
        committed_str = committed or ""

    if isinstance(volatile, list):
        v_toks = volatile
        volatile_str = normalize_indic_text(
            "".join(v_toks),
            dedup=dedup,
            normalize_nfc=normalize_nfc,
            space_marker=space_marker,
            lang=lang,
        )
    else:
        volatile_str = volatile or ""
        v_toks = volatile_tokens

    if not committed_str:
        return volatile_str.strip() if volatile_str else ""
    if not volatile_str:
        return committed_str

    last_c = committed_str[-1]
    first_v = volatile_str[0]

    # Combining mark (matra, virama, accent) at start of volatile text: attach directly to base
    if unicodedata.category(first_v) in ("Mn", "Mc", "Me"):
        return repair_brahmic_orthography(f"{committed_str.rstrip()}{volatile_str}", lang=lang)

    # Open punctuation / hyphen / apostrophe at end of committed text
    if last_c in _OPENING_PUNCT_CHARS:
        return repair_brahmic_orthography(f"{committed_str}{volatile_str}", lang=lang)

    # Closing punctuation at start of volatile text
    if first_v in _CLOSING_PUNCT_CHARS:
        return repair_brahmic_orthography(f"{committed_str}{volatile_str}", lang=lang)

    # Existing whitespace handling
    if last_c.isspace() or first_v.isspace():
        merged = f"{committed_str}{volatile_str}"
        return re.sub(r"\s+", " ", merged).strip()

    # Token-level word boundary inspection
    if v_toks:
        first_tok = next((t for t in v_toks if t), "")
        if first_tok:
            has_boundary = any(first_tok.startswith(m) for m in _WORD_BOUNDARY_MARKERS)
            if not has_boundary:
                # Continuation subword: attach directly without space
                return repair_brahmic_orthography(f"{committed_str.rstrip()}{volatile_str}", lang=lang)

    # True word boundary confirmed: insert single space
    return f"{committed_str} {volatile_str}"
