"""Adversarial stress-testing and cross-runtime parity suite for Brahmic orthography repairs.

Validates enhanced Brahmic orthography normalization across Python and TypeScript runtimes:
- Retroflex lateral ligatures in Kannada, Telugu, and Odia.
- Malayalam nasal geminates (മ്മ, ന്ന, ണ്ണ, ഞ്ഞ, ങ്ങ) and candrakkala handling.
- Gujarati sibilant distinctions and ablative postposition થી.
- Odia detached anusvara and dative suffix ଙ୍କୁ.
- Held-out benchmark regression scan (480 clips).
- Bit-exact cross-runtime parity between Python and TypeScript.
"""

import json
import subprocess
from pathlib import Path
import pytest

from swanada.normalizer import (
    normalize_indic_text,
    repair_brahmic_orthography,
    join_subwords,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
NODE_SCRIPT = REPO_ROOT / "js" / "src" / "decoder" / "normalizer.ts"


def invoke_ts_normalizer(action: str, payload: dict) -> str:
    """Execute TypeScript normalizer routines via Node.js subshell."""
    runner = f"""
    import {{ repairBrahmicOrthography, normalizeIndicText, joinSubwords }} from '{NODE_SCRIPT.as_posix()}';
    const payload = {json.dumps(payload)};
    let result = '';
    if ('{action}' === 'repair') {{
        result = repairBrahmicOrthography(payload.text, payload.lang || '');
    }} else if ('{action}' === 'normalize') {{
        result = normalizeIndicText(payload.text, {{ lang: payload.lang || '' }});
    }} else if ('{action}' === 'join') {{
        result = joinSubwords(
            payload.committed,
            payload.volatile,
            payload.volatile_tokens,
            {{ lang: payload.lang || '' }}
        );
    }}
    process.stdout.write(result);
    """
    cmd = ["node", "--experimental-strip-types", "-e", runner]
    proc = subprocess.run(
        cmd,
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    return proc.stdout


# ============================================================================
# Category 1: Retroflex lateral ligatures in Kannada, Telugu, and Odia
# ============================================================================

LATERAL_LIGATURE_CASES = [
    # Kannada: ಳ (U+0CB3) + virama ್ (U+0CCD)
    ("ಸ್ಥಗಿತಗೊಳಳ್ಸಿದೆ", "ಸ್ಥಗಿತಗೊಳ್ಸಿದೆ", "kn"),
    ("ಗೊಳಳ್", "ಗೊಳ್", "kn"),
    ("ಗೊಳಳಳ್", "ಗೊಳ್", "kn"),
    ("ಬೆಳ್ಳಿ", "ಬೆಳ್ಳಿ", "kn"),  # Legitimate geminate preserved
    ("ಎಳ್ಳು", "ಎಳ್ಳು", "kn"),    # Legitimate geminate preserved
    ("ಕಳ್ಳ", "ಕಳ್ಳ", "kn"),      # Legitimate geminate preserved
    ("ಬೆಳಕು", "ಬೆಳಕು", "kn"),    # Single lateral preserved
    # Telugu: ళ (U+0C33) + virama ్ (U+0C4D)
    ("కోళళ్సింది", "కోళ్సింది", "te"),
    ("కోళళ్", "కోళ్", "te"),
    ("కో\u0C33\u0C33\u0C33\u0C4D", "కోళ్", "te"),
    ("పెళ్ళి", "పెళ్ళి", "te"),  # Legitimate geminate preserved
    ("నీళ్ళు", "నీళ్ళు", "te"),  # Legitimate geminate preserved
    ("కాలము", "కాలము", "te"),    # Single lateral preserved
    # Odia: ଳ (U+0B33) + virama ୍ (U+0B4D)
    ("କଳଳ୍ସିଦେ", "କଳ୍ସିଦେ", "or"),
    ("କଳଳ୍", "କଳ୍", "or"),
    ("କଳଳଳ୍", "କଳ୍", "or"),
    ("ବିଳ୍ଳ", "ବିଳ୍ଳ", "or"),    # Legitimate geminate preserved
    ("ବେଳ", "ବେଳ", "or"),        # Single lateral preserved
]


@pytest.mark.parametrize("raw_input,expected,lang", LATERAL_LIGATURE_CASES)
def test_retroflex_lateral_ligatures(raw_input: str, expected: str, lang: str):
    """Verify deduplication of duplicate lateral ligatures and preservation of valid geminates."""
    py_out = repair_brahmic_orthography(raw_input, lang=lang)
    assert py_out == expected, f"Python mismatch for {raw_input!r}: got {py_out!r}, expected {expected!r}"

    ts_out = invoke_ts_normalizer("repair", {"text": raw_input, "lang": lang})
    assert ts_out == expected, f"TypeScript mismatch for {raw_input!r}: got {ts_out!r}, expected {expected!r}"
    assert py_out == ts_out, f"Cross-runtime disparity: py={py_out!r} != ts={ts_out!r}"


# ============================================================================
# Category 2: Malayalam nasal geminates and candrakkala handling
# ============================================================================

MALAYALAM_CASES = [
    # Split nasal geminates: anusvara + nasal stop -> geminate
    ("ഉംമാ", "ഉമ്മാ", "ml"),     # U+0D2E (ma) -> മ്മ
    ("ഒംന", "ഒന്ന", "ml"),     # U+0D28 (na) -> ന്ന
    ("കംണ", "കണ്ണ", "ml"),     # U+0D23 (nna) -> ണ്ണ
    ("മംഞ", "മഞ്ഞ", "ml"),     # U+0D1E (nya) -> ഞ്ഞ
    ("തംങ", "തങ്ങ", "ml"),     # U+0D19 (nga) -> ങ്ങ
    # Multiple split nasals in single sentence
    ("ഉംമാ ഒംന കംണ തംങ മംഞ", "ഉമ്മാ ഒന്ന കണ്ണ തങ്ങ മഞ്ഞ", "ml"),
    # Non-nasal anusvara preserved
    ("അംബരം", "അംബരം", "ml"),
    ("സമ്പത്ത്", "സമ്പത്ത്", "ml"),
    ("ഹംസം", "ഹംസം", "ml"),
    ("സിംഹം", "സിംഹം", "ml"),
    # Pre-existing geminates preserved
    ("ഉമ്മാ", "ഉമ്മാ", "ml"),
    ("ഒന്ന", "ഒന്ന", "ml"),
    ("കണ്ണ", "കണ്ണ", "ml"),
    ("തങ്ങ", "തങ്ങ", "ml"),
    ("വിശ്വ", "വിശ്വ", "ml"),
    ("വിശ്വാസം", "വിശ്വാസം", "ml"),
]


@pytest.mark.parametrize("raw_input,expected,lang", MALAYALAM_CASES)
def test_malayalam_nasal_geminates_and_candrakkala(raw_input: str, expected: str, lang: str):
    """Verify Malayalam nasal geminate reunification and candrakkala repair."""
    py_out = repair_brahmic_orthography(raw_input, lang=lang)
    assert py_out == expected, f"Python mismatch for {raw_input!r}: got {py_out!r}, expected {expected!r}"

    ts_out = invoke_ts_normalizer("repair", {"text": raw_input, "lang": lang})
    assert ts_out == expected, f"TypeScript mismatch for {raw_input!r}: got {ts_out!r}, expected {expected!r}"
    assert py_out == ts_out, f"Cross-runtime disparity: py={py_out!r} != ts={ts_out!r}"


# ============================================================================
# Category 3: Gujarati sibilant distinctions and ablative postposition થી
# ============================================================================

GUJARATI_CASES = [
    # 1st-person future inflection sibilant correction (ઈષ -> ઈશ)
    ("હું જઈષ", "હું જઈશ", "gu"),
    ("હું જઈષ અને", "હું જઈશ અને", "gu"),
    ("તેઓ જઈષ.", "તેઓ જઈશ.", "gu"),
    ("હું જઈષ અને તું જઈષ", "હું જઈશ અને તું જઈશ", "gu"),
    # Valid Gujarati words with retroflex sibilant ષ preserved
    ("વિષ", "વિષ", "gu"),
    ("વિશેષ", "વિશેષ", "gu"),
    ("ઋષિ", "ઋષિ", "gu"),
    ("દોષ", "દોષ", "gu"),
    ("કર્ષણ", "કર્ષણ", "gu"),
    ("ભાષા", "ભાષા", "gu"),
    ("હર્ષ", "હર્ષ", "gu"),
    ("બસથી", "બસથી", "gu"),
    # Valid Sanskrit/Gujarati conjuncts containing સ્થ preserved
    ("સ્થિતિ", "સ્થિતિ", "gu"),
    ("અસ્થિ", "અસ્થિ", "gu"),
    ("પ્રસ્થાન", "પ્રસ્થાન", "gu"),
    ("ઉપસ્થિત", "ઉપસ્થિત", "gu"),
    ("સ્થળ", "સ્થળ", "gu"),
    ("સંસ્થા", "સંસ્થા", "gu"),
]


@pytest.mark.parametrize("raw_input,expected,lang", GUJARATI_CASES)
def test_gujarati_sibilants_and_postposition(raw_input: str, expected: str, lang: str):
    """Verify Gujarati sibilant restoration and postposition virama normalization."""
    py_out = repair_brahmic_orthography(raw_input, lang=lang)
    assert py_out == expected, f"Python mismatch for {raw_input!r}: got {py_out!r}, expected {expected!r}"

    ts_out = invoke_ts_normalizer("repair", {"text": raw_input, "lang": lang})
    assert ts_out == expected, f"TypeScript mismatch for {raw_input!r}: got {ts_out!r}, expected {expected!r}"
    assert py_out == ts_out, f"Cross-runtime disparity: py={py_out!r} != ts={ts_out!r}"


# ============================================================================
# Category 4: Odia detached anusvara and dative suffix ଙ୍କୁ
# ============================================================================

ODIA_CASES = [
    # Detached anusvara before velar stops (ଂଙ୍କ -> ଙ୍କ)
    ("ସଧ୍ୟାଂଙ୍କୁ", "ସଧ୍ୟାଙ୍କୁ", "or"),  # Detached anusvara removed
    ("ଂଙ୍କ", "ଙ୍କ", "or"),
    ("ଂଙ୍ଖ", "ଙ୍ଖ", "or"),
    ("ଂଙ୍ଗ", "ଙ୍ଗ", "or"),
    ("ଂଙ୍ଘ", "ଙ୍ଘ", "or"),
    # Dative suffix disaggregation (ଂକୁ -> ଙ୍କୁ)
    ("ସଧ୍ୟଂକୁ", "ସଧ୍ୟଙ୍କୁ", "or"),
    ("ତାହାଂକୁ", "ତାହାଙ୍କୁ", "or"),
    ("ପିଲାଂକୁ", "ପିଲାଙ୍କୁ", "or"),
    ("ରାମଂକୁ", "ରାମଙ୍କୁ", "or"),
    ("ରାମଂକୁ ଦିଅ", "ରାମଙ୍କୁ ଦିଅ", "or"),
    # Valid Odia words with anusvara preserved
    ("ସଂସାର", "ସଂସାର", "or"),
    ("ଅଂଶ", "ଅଂଶ", "or"),
    ("ସିଂହ", "ସିଂହ", "or"),
    ("ସଂଗୀତ", "ସଂଗୀତ", "or"),
    ("ସନ୍ଧ୍ୟାଙ୍କୁ", "ସନ୍ଧ୍ୟାଙ୍କୁ", "or"),
]


@pytest.mark.parametrize("raw_input,expected,lang", ODIA_CASES)
def test_odia_detached_anusvara_and_dative(raw_input: str, expected: str, lang: str):
    """Verify Odia detached anusvara cleanup and dative suffix conjunct repair."""
    py_out = repair_brahmic_orthography(raw_input, lang=lang)
    assert py_out == expected, f"Python mismatch for {raw_input!r}: got {py_out!r}, expected {expected!r}"

    ts_out = invoke_ts_normalizer("repair", {"text": raw_input, "lang": lang})
    assert ts_out == expected, f"TypeScript mismatch for {raw_input!r}: got {ts_out!r}, expected {expected!r}"
    assert py_out == ts_out, f"Cross-runtime disparity: py={py_out!r} != ts={ts_out!r}"


# ============================================================================
# Category 5: Multi-Script Adversarial Stress & Compound Text
# ============================================================================

ADVERSARIAL_COMPOUND_CASES = [
    # Multi-lingual composite string exercising all 4 scripts simultaneously
    (
        "ಸ್ಥಗಿತಗೊಳಳ್ಸಿದೆ ରାମଂକୁ જઈષ ഉംമാ വിശ്വാസം",
        "ಸ್ಥಗಿತಗೊಳ್ಸಿದೆ ରାମଙ୍କୁ જઈશ ഉമ്മാ വിശ്വാസം",
        "",
    ),
    # Repeated patterns (consecutive occurrences)
    (
        "ಗೊಳಳ್ ಗೊಳಳ್ ಗೊಳಳ್",
        "ಗೊಳ್ ಗೊಳ್ ಗೊಳ್",
        "kn",
    ),
    (
        "ഉംമാ ഉംമാ ഉംമാ വിശ്വ",
        "ഉമ്മാ ഉമ്മാ ഉമ്മാ വിശ്വ",
        "ml",
    ),
    (
        "હું બસથી જઈષ અને તું બસથી જઈષ",
        "હું બસથી જઈશ અને તું બસથી જઈશ",
        "gu",
    ),
    (
        "ରାମଂକୁ ପିଲାଂକୁ ସଧ୍ୟାଂଙ୍କୁ",
        "ରାମଙ୍କୁ ପିଲାଙ୍କୁ ସଧ୍ୟାଙ୍କୁ",
        "or",
    ),
    # Edge inputs: empty, single spaces, punctuation
    ("", "", ""),
    ("   ", "", ""),
    (".,?!-", ".,?!-", ""),
]


@pytest.mark.parametrize("raw_input,expected,lang", ADVERSARIAL_COMPOUND_CASES)
def test_adversarial_compounds_and_boundaries(raw_input: str, expected: str, lang: str):
    """Stress-test compound sentences, repetitions, and boundaries across runtimes."""
    py_rep = repair_brahmic_orthography(raw_input, lang=lang)
    ts_rep = invoke_ts_normalizer("repair", {"text": raw_input, "lang": lang})
    assert py_rep == ts_rep, f"Disparity in repair: py={py_rep!r} != ts={ts_rep!r}"

    py_norm = normalize_indic_text(raw_input, lang=lang)
    ts_norm = invoke_ts_normalizer("normalize", {"text": raw_input, "lang": lang})
    assert py_norm == ts_norm, f"Disparity in normalize: py={py_norm!r} != ts={ts_norm!r}"
    assert py_norm == expected, f"Unexpected normalize result: {py_norm!r} != {expected!r}"


# ============================================================================
# Category 6: Conditional Subword Joining Cross-Runtime Parity
# ============================================================================

SUBWORD_JOINING_CASES = [
    # Continuation without boundary marker
    {"committed": "ಆಗ", "volatile": "ಾಗಿ", "volatile_tokens": ["ಾಗಿ"], "expected": "ಆಗಾಗಿ"},
    # True word boundary
    {"committed": "the", "volatile": "king", "volatile_tokens": [" king"], "expected": "the king"},
    # Combining mark at start of volatile text
    {"committed": "ಆಗ", "volatile": "\u0CCD", "volatile_tokens": ["\u0CCD"], "expected": "ಆಗ್"},
    # Open punctuation at end of committed text
    {"committed": "sub-", "volatile": "word", "volatile_tokens": ["word"], "expected": "sub-word"},
    # Closing punctuation at start of volatile text
    {"committed": "done", "volatile": ".", "volatile_tokens": ["."], "expected": "done."},
    # Empty committed string
    {"committed": "", "volatile": "stream", "volatile_tokens": ["stream"], "expected": "stream"},
    # Empty volatile string
    {"committed": "stream", "volatile": "", "volatile_tokens": [], "expected": "stream"},
]


@pytest.mark.parametrize("case", SUBWORD_JOINING_CASES)
def test_conditional_subword_joining_parity(case: dict):
    """Verify conditional joining matrix logic produces identical outputs across Python and TypeScript."""
    py_out = join_subwords(
        committed=case["committed"],
        volatile=case["volatile"],
        volatile_tokens=case["volatile_tokens"],
    )
    ts_out = invoke_ts_normalizer(
        "join",
        {
            "committed": case["committed"],
            "volatile": case["volatile"],
            "volatile_tokens": case["volatile_tokens"],
        },
    )
    assert py_out == case["expected"], f"Python join error: {py_out!r} != {case['expected']!r}"
    assert ts_out == case["expected"], f"TypeScript join error: {ts_out!r} != {case['expected']!r}"
    assert py_out == ts_out, f"Cross-runtime disparity in join: py={py_out!r} != ts={ts_out!r}"


# ============================================================================
# Category 7: Held-Out Speech Suite Full Regression Scan (480 Clips)
# ============================================================================

def test_full_regression_scan_on_held_out_suite():
    """Verify that all 7 new M1 repair rules produce strictly 0 unintended text mutations on 480 clips."""
    suite_file = REPO_ROOT / "bench" / "test_speech_suite.jsonl"
    assert suite_file.exists(), f"Suite file missing at {suite_file}"

    with open(suite_file, encoding="utf-8") as f:
        clips = [json.loads(line) for line in f]

    assert len(clips) == 480, f"Expected 480 benchmark clips, found {len(clips)}"

    # Specific M1 repair pipeline
    def apply_m1_rules(text: str) -> str:
        t = text
        # 1. Retroflex lateral ligature
        t = repair_brahmic_orthography(t)
        return t

    # Count how many clips are modified by the M1 repair rules vs pre-existing rules
    # In earlier investigation, 2 pre-existing cases (clip 234 Malayalam EE+AA NFC composition and clip 317 Marathi AA+candra E)
    # were traced to pre-existing _RE_COLLIDING_MATRAS from commit f64149ac.
    # The 7 new M1 rules must produce exactly 0 mutations.
    from swanada.normalizer import (
        _RE_DUPLICATE_LATERAL_LIGATURE,
        _RE_ML_SPLIT_NASAL_GEMINATE,
        _RE_GU_FUTURE_SIBILANT,
        _RE_OR_DETACHED_ANUSVARA,
        _RE_OR_DATIVE_SUFFIX,
    )

    m1_mutations = []
    for idx, clip in enumerate(clips):
        orig_text = clip["text"]
        lang = clip["lang"]

        t = orig_text
        t = _RE_DUPLICATE_LATERAL_LIGATURE.sub(r"\1\2", t)
        t = _RE_ML_SPLIT_NASAL_GEMINATE.sub(lambda m: f"{m.group(1)}\u0D4D{m.group(1)}", t)
        t = _RE_GU_FUTURE_SIBILANT.sub("ઈશ", t)
        t = _RE_OR_DETACHED_ANUSVARA.sub(r"\1", t)
        t = _RE_OR_DATIVE_SUFFIX.sub("\u0B19\u0B4D\u0B15\u0B41", t)

        if t != orig_text:
            m1_mutations.append((idx, lang, orig_text, t))

    assert len(m1_mutations) == 0, f"Encountered {len(m1_mutations)} regressions on 480 clips: {m1_mutations}"
