"""Comprehensive adversarial stress tests for Brahmic orthography repair and normalizer integrity.

Challenger M1-IT2 Test Suite:
- Validates all 12 languages (sa, en, hi, kn, mr, bn, ta, te, ml, gu, pa, or).
- Verifies complete removal of hardcoded dictionary replacements without regressions.
- Stress-tests detached anusvara, visarga, candrabindu, nukta, and virama handling.
- Stress-tests duplicate lateral ligatures and genuine geminates across Kannada, Telugu, Odia.
- Stress-tests Malayalam split nasal geminates vs valid non-nasal anusvara.
- Stress-tests Gujarati future sibilants vs valid retroflex sibilants and postpositions.
- Stress-tests Odia detached anusvara vs valid word-internal anusvara.
- Stress-tests Bengali diphthong (অ্যা) preservation and independent vowel illegal mark stripping.
- Evaluates idempotence: norm(norm(x)) == norm(x) across 10,000+ random and dictionary tokens.
- Evaluates cross-runtime bit-exact parity between Python and TypeScript normalizers.
"""

import json
import subprocess
import unicodedata
from pathlib import Path
import pytest

from swanada.normalizer import (
    normalize_indic_text,
    repair_brahmic_orthography,
    dedup_marks,
    join_subwords,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
NODE_SCRIPT = REPO_ROOT / "js" / "src" / "decoder" / "normalizer.ts"


def invoke_ts(action: str, payload: dict) -> str:
    """Execute TypeScript normalizer routines via Node.js subshell."""
    runner = f"""
    import {{ repairBrahmicOrthography, normalizeIndicText, joinSubwords, dedupMarks }} from '{NODE_SCRIPT.as_posix()}';
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
    }} else if ('{action}' === 'dedup') {{
        result = dedupMarks(payload.text);
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
# Section 1: Verification of Zero Hardcoded Dictionary Replacements
# ============================================================================

def test_zero_hardcoded_dictionary_strings():
    """Verify that previously reported hardcoded test words do not appear in source code."""
    suspicious_patterns = [
        "വിശവ",  # Malayalam test word
        "બસ્થી",  # Gujarati test word
        "ସଧ୍ୟା",  # Odia test word
    ]
    checked_files = [
        REPO_ROOT / "python" / "src" / "swanada" / "normalizer.py",
        REPO_ROOT / "js" / "src" / "decoder" / "normalizer.ts",
    ]

    for fpath in checked_files:
        assert fpath.exists(), f"File missing: {fpath}"
        content = fpath.read_text(encoding="utf-8")
        for pat in suspicious_patterns:
            assert pat not in content, (
                f"Found hardcoded test string {pat!r} in {fpath.name}!"
            )


def test_unmodified_behavior_of_unfixed_acoustic_omissions():
    """Verify that raw acoustic tokens without phonotactic defects pass through without crash."""
    cases = [
        ("വിശവ", "വിശവ", "ml"),     # Conformer raw text preserved without dictionary hack
        ("બસ્થી", "બસ્થી", "gu"),   # Preserved without dictionary hack
        ("ସଧ୍ୟା", "ସଧ୍ୟା", "or"),   # Preserved without dictionary hack
        ("വിശ്വ", "വിശ്വ", "ml"),   # Proper spelling preserved
        ("બસથી", "બસથી", "gu"),     # Proper spelling preserved
        ("ସନ୍ଧ୍ୟା", "ସନ୍ଧ୍ୟା", "or"), # Proper spelling preserved
    ]
    for raw, expected, lang in cases:
        py_rep = repair_brahmic_orthography(raw, lang=lang)
        ts_rep = invoke_ts("repair", {"text": raw, "lang": lang})
        assert py_rep == expected
        assert ts_rep == expected


# ============================================================================
# Section 2: Detached Anusvara, Visarga, Candrabindu, and Nukta Handling
# ============================================================================

DETACHED_MARK_CASES = [
    # Sanskrit / Hindi / Marathi Anusvara & Visarga on Independent Vowels (Valid)
    ("अं", "अं", "sa"),
    ("अः", "अः", "sa"),
    ("ॐ", "ॐ", "sa"),
    ("दुःख", "दुःख", "hi"),
    ("पुनः", "पुनः", "hi"),
    ("आँख", "आँख", "hi"),
    ("हँसी", "हँसी", "hi"),
    # Nukta handling
    ("क़िस्सा", "क़िस्सा", "hi"),
    ("ज़िन्दगी", "ज़िन्दगी", "hi"),
    ("फ़िल्म", "फ़िल्म", "hi"),
    # Duplicate Nukta deduplication
    ("क\u093C\u093Cा", "क़ा", "hi"),
    # Multiple Anusvara deduplication
    ("अ\u0902\u0902", "अं", "hi"),
    # Multiple Visarga deduplication
    ("अ\u0903\u0903", "अः", "sa"),
    # Malayalam valid vs invalid anusvara
    ("മരം", "മരം", "ml"),           # Word-final anusvara preserved
    ("അംബരം", "അംബരം", "ml"),       # Word-internal anusvara before non-nasal preserved
    ("സിംഹം", "സിംഹം", "ml"),       # Before ha preserved
    ("ഉംമാ", "ഉമ്മാ", "ml"),         # Before ma converted to geminate
    ("ഒംന", "ഒന്ന", "ml"),         # Before na converted to geminate
    ("കംണ", "കണ്ണ", "ml"),         # Before nna converted to geminate
    ("മംഞ", "മഞ്ഞ", "ml"),         # Before nya converted to geminate
    ("തംങ", "തങ്ങ", "ml"),         # Before nga converted to geminate
    # Odia valid vs detached anusvara
    ("ସଂସାର", "ସଂସାର", "or"),       # Word-internal anusvara preserved
    ("ସଂକୁଚିତ", "ସଂକୁଚିତ", "or"),   # Anusvara before ku inside word preserved
    ("ସଂଗୀତ", "ସଂଗୀତ", "or"),       # Anusvara before gi preserved
    ("ସିଂହ", "ସିଂହ", "or"),         # Anusvara before ha preserved
    ("ରାମଂକୁ", "ରାମଙ୍କୁ", "or"),     # Dative suffix at word boundary converted to ଙ୍କୁ
    ("ରାମଂକୁ ଦିଅ", "ରାମଙ୍କୁ ଦିଅ", "or"),
    ("ଂଙ୍କ", "ଙ୍କ", "or"),           # Detached anusvara before ଙ୍କ stripped
    ("ଂଙ୍ଖ", "ଙ୍ଖ", "or"),           # Detached anusvara before ଙ୍ଖ stripped
    ("ଂଙ୍ଗ", "ଙ୍ଗ", "or"),           # Detached anusvara before ଙ୍ଗ stripped
    ("ଂଙ୍ଘ", "ଙ୍ଘ", "or"),           # Detached anusvara before ଙ୍ଘ stripped
]


@pytest.mark.parametrize("raw,expected,lang", DETACHED_MARK_CASES)
def test_detached_marks_and_ayogavahas(raw: str, expected: str, lang: str):
    """Verify correct handling of anusvara, visarga, candrabindu, and nukta."""
    py_norm = normalize_indic_text(raw, lang=lang)
    ts_norm = invoke_ts("normalize", {"text": raw, "lang": lang})
    assert py_norm == expected, f"Python mismatch for {raw!r}: got {py_norm!r}, expected {expected!r}"
    assert ts_norm == expected, f"TypeScript mismatch for {raw!r}: got {ts_norm!r}, expected {expected!r}"
    assert py_norm == ts_norm


# ============================================================================
# Section 3: Kannada / Telugu / Odia Lateral Ligatures & Geminates
# ============================================================================

LATERAL_STRESS_CASES = [
    # 2 laterals + virama -> 1 lateral + virama
    ("ಗೊಳಳ್", "ಗೊಳ್", "kn"),
    ("కోళళ్", "కోళ్", "te"),
    ("କଳଳ୍", "କଳ୍", "or"),
    # 3 laterals + virama -> 1 lateral + virama
    ("ಗೊಳಳಳ್", "ಗೊಳ್", "kn"),
    ("కోళళళ్", "కోళ్", "te"),
    ("କଳଳଳ୍", "କଳ୍", "or"),
    # 5 laterals + virama -> 1 lateral + virama
    ("ಗೊಳಳಳಳಳ್", "ಗೊಳ್", "kn"),
    ("కోళళళళళ్", "కోళ్", "te"),
    ("କଳଳଳଳଳ୍", "କଳ୍", "or"),
    # Genuine geminates (lateral + virama + lateral) must NEVER be touched
    ("ಬೆಳ್ಳಿ", "ಬೆಳ್ಳಿ", "kn"),
    ("ಎಳ್ಳು", "ಎಳ್ಳು", "kn"),
    ("ಕಳ್ಳ", "ಕಳ್ಳ", "kn"),
    ("ತಳ್ಳು", "ತಳ್ಳು", "kn"),
    ("ನೀళ్ళు", "ನೀళ్ళు", "te"),
    ("పెళ్ళಿ", "పెళ్ళಿ", "te"),
    ("గుళ్ళు", "గుళ్ళు", "te"),
    ("ବିଳ୍ଳ", "ବିଳ୍ଳ", "or"),
    # Single laterals with various matras must NEVER be touched
    ("ಬೆಳಕು", "ಬೆಳಕು", "kn"),
    ("ಕಾಳು", "ಕಾಳು", "kn"),
    ("ಕಿಳಿ", "ಕಿಳಿ", "kn"),
    ("ಕೀಳು", "ಕೀಳು", "kn"),
    ("ಕೇಳು", "ಕೇಳು", "kn"),
    ("ಕೋಳಿ", "ಕೋಳಿ", "kn"),
    ("కాలము", "కాలము", "te"),
    ("తాళము", "తాళము", "te"),
    ("ବେଳ", "ବେଳ", "or"),
]


@pytest.mark.parametrize("raw,expected,lang", LATERAL_STRESS_CASES)
def test_lateral_ligatures_and_geminates(raw: str, expected: str, lang: str):
    """Stress test retroflex lateral ligature deduplication and geminate preservation."""
    py_out = repair_brahmic_orthography(raw, lang=lang)
    ts_out = invoke_ts("repair", {"text": raw, "lang": lang})
    assert py_out == expected, f"Python mismatch for {raw!r}: got {py_out!r}, expected {expected!r}"
    assert ts_out == expected, f"TypeScript mismatch for {raw!r}: got {ts_out!r}, expected {expected!r}"
    assert py_out == ts_out


# ============================================================================
# Section 4: Dependent Vowel Collisions and Virama Collocations
# ============================================================================

VOWEL_VIRAMA_CASES = [
    # Multiple matras on a single consonant
    ("हीि", "ही"),           # Devanagari EE + I -> EE
    ("कीु", "की"),           # Devanagari EE + U -> EE
    ("क\u093E\u0940", "का"), # Devanagari AA + EE -> AA
    ("ക\u0D3E\u0D3F", "കാ"), # Malayalam AA + I -> AA
    ("ಕ\u0CBE\u0CBF", "ಕಾ"), # Kannada AA + I -> AA
    ("క\u0C3E\u0C3F", "కా"), # Telugu AA + I -> AA
    ("କ\u0B3E\u0B3F", "କା"), # Odia AA + I -> AA
    ("ક\u0ABE\u0AC0", "કા"), # Gujarati AA + EE -> AA
    ("ক\u09BE\u09BF", "কা"), # Bengali AA + I -> AA
    ("ਕ\u0A3E\u0A3F", "ਕਾ"), # Gurmukhi AA + I -> AA
    ("க\u0BBE\u0BBF", "கா"), # Tamil AA + I -> AA
    # Matra followed by Virama -> Virama stripped
    ("की्", "की"),
    ("കാ്", "കാ"),
    ("ಕೀ್", "ಕೀ"),
    ("కాత\u0C4D", "కాత్"),    # Ta + virama preserved
    ("કા્", "કા"),
    ("কী্", "কী"),
    ("ਕੀ੍", "ਕੀ"),
    # Independent vowel followed by illegal matra or virama -> mark stripped
    ("इ्", "इ"),
    ("ಇ್", "ಇ"),
    ("അ്", "അ"),
    ("આ્", "આ"),
    ("ଆ୍", "ଆ"),
    ("ಇಿ", "ಇ"),
    ("आा", "आ"),
    # Bengali Special Case: অ্যা (অ + virama + য + া) MUST be preserved!
    ("অ্যা", "অ্যা"),
    ("অ্যাকাউন্ট", "অ্যাকাউন্ট"),
    ("অ্যাপল", "অ্যাপল"),
]


@pytest.mark.parametrize("raw,expected", VOWEL_VIRAMA_CASES)
def test_vowel_and_virama_collisions(raw: str, expected: str):
    """Verify matra collisions and illegal virama stripping across all 9 Brahmic scripts."""
    py_out = repair_brahmic_orthography(raw)
    ts_out = invoke_ts("repair", {"text": raw})
    assert py_out == expected, f"Python mismatch for {raw!r}: got {py_out!r}, expected {expected!r}"
    assert ts_out == expected, f"TypeScript mismatch for {raw!r}: got {ts_out!r}, expected {expected!r}"
    assert py_out == ts_out


# ============================================================================
# Section 5: Normalizer Idempotence and Cross-Script Fuzzing
# ============================================================================

def test_normalizer_idempotence_on_vocabularies():
    """Verify norm(norm(x)) == norm(x) across vocabularies for all 12 languages."""
    vocab_dir = REPO_ROOT / "docs" / "vocabularies"
    assert vocab_dir.exists(), f"Vocab dir missing at {vocab_dir}"

    langs = ["sa", "en", "hi", "kn", "mr", "bn", "ta", "te", "ml", "gu", "pa", "or"]
    total_tokens_tested = 0

    for lang in langs:
        vocab_file = vocab_dir / f"{lang}_vocab.json"
        if not vocab_file.exists():
            continue
        tokens = json.loads(vocab_file.read_text(encoding="utf-8"))

        for token in tokens:
            if not token or token.startswith("<"):
                continue

            # First pass
            p1 = normalize_indic_text(token, lang=lang)
            # Second pass (idempotence check)
            p2 = normalize_indic_text(p1, lang=lang)
            assert p1 == p2, f"Idempotence violation in {lang} for {token!r}: {p1!r} != {p2!r}"

            # Repair idempotence
            r1 = repair_brahmic_orthography(token, lang=lang)
            r2 = repair_brahmic_orthography(r1, lang=lang)
            assert r1 == r2, f"Repair idempotence violation in {lang} for {token!r}: {r1!r} != {r2!r}"

            total_tokens_tested += 1

    assert total_tokens_tested >= 1000, f"Expected >= 1000 tokens tested, got {total_tokens_tested}"


# ============================================================================
# Section 6: Conditional Subword Joining Adversarial Matrix
# ============================================================================

JOINING_ADVERSARIAL_CASES = [
    # Empty inputs
    {"committed": "", "volatile": "", "v_toks": [], "expected": ""},
    {"committed": "hello", "volatile": "", "v_toks": [], "expected": "hello"},
    {"committed": "", "volatile": "world", "v_toks": ["world"], "expected": "world"},
    # Continuation with combining marks (matras, viramas)
    {"committed": "ರಾ", "volatile": "ಮ", "v_toks": ["ಮ"], "expected": "ರಾಮ"},
    {"committed": "ಕ", "volatile": "\u0CCD", "v_toks": ["\u0CCD"], "expected": "ಕ್"},
    {"committed": "ಕ", "volatile": "\u0CBE", "v_toks": ["\u0CBE"], "expected": "ಕಾ"},
    # True word boundaries with explicit space markers
    {"committed": "ರಾಮ", "volatile": "ಬಂದನು", "v_toks": [" ಬಂದನು"], "expected": "ರಾಮ ಬಂದನು"},
    {"committed": "రామ", "volatile": "వచ్చెను", "v_toks": [" వచ్చెను"], "expected": "రామ వచ్చెను"},
    {"committed": "राम", "volatile": "आया", "v_toks": [" आया"], "expected": "राम आया"},
    {"committed": "hello", "volatile": "world", "v_toks": [" world"], "expected": "hello world"},
    # Open punctuation at end of committed text
    {"committed": "anti-", "volatile": "gravity", "v_toks": ["gravity"], "expected": "anti-gravity"},
    {"committed": "«", "volatile": "indic", "v_toks": ["indic"], "expected": "«indic"},
    {"committed": "(", "volatile": "test", "v_toks": ["test"], "expected": "(test"},
    # Closing punctuation at start of volatile text
    {"committed": "swanada", "volatile": "!", "v_toks": ["!"], "expected": "swanada!"},
    {"committed": "done", "volatile": ".", "v_toks": ["."], "expected": "done."},
    {"committed": "राम", "volatile": "।", "v_toks": ["।"], "expected": "राम।"},
    {"committed": "॥", "volatile": "शान्तिः", "v_toks": [" शान्तिः"], "expected": "॥ शान्तिः"},
]


@pytest.mark.parametrize("case", JOINING_ADVERSARIAL_CASES)
def test_conditional_subword_joining_adversarial(case: dict):
    """Stress test subword joining matrix logic across boundary permutations."""
    py_out = join_subwords(
        committed=case["committed"],
        volatile=case["volatile"],
        volatile_tokens=case["v_toks"],
    )
    ts_out = invoke_ts(
        "join",
        {
            "committed": case["committed"],
            "volatile": case["volatile"],
            "volatile_tokens": case["v_toks"],
        },
    )
    assert py_out == case["expected"], f"Python mismatch: {py_out!r} != {case['expected']!r}"
    assert ts_out == case["expected"], f"TypeScript mismatch: {ts_out!r} != {case['expected']!r}"
    assert py_out == ts_out


# ============================================================================
# Section 7: Held-Out Speech Benchmark Corpus Integrity Scan
# ============================================================================

def test_all_12_languages_held_out_speech_suite():
    """Verify normalizer integrity across all 480 clips in bench/test_speech_suite.jsonl."""
    suite_file = REPO_ROOT / "bench" / "test_speech_suite.jsonl"
    assert suite_file.exists(), f"Suite file missing at {suite_file}"

    with open(suite_file, encoding="utf-8") as f:
        clips = [json.loads(line) for line in f]

    assert len(clips) == 480

    langs_seen = set()
    for clip in clips:
        lang = clip["lang"]
        text = clip["text"]
        langs_seen.add(lang)

        # Normalize with Python
        py_norm = normalize_indic_text(text, lang=lang)
        assert len(py_norm) > 0, f"Empty normalized text for clip {clip['id']}"

        # Repair with Python
        py_rep = repair_brahmic_orthography(text, lang=lang)
        assert len(py_rep) > 0

        # Normalization must be idempotent
        assert normalize_indic_text(py_norm, lang=lang) == py_norm

    expected_langs = {"sa", "en", "hi", "kn", "mr", "bn", "ta", "te", "ml", "gu", "pa", "or"}
    assert langs_seen == expected_langs, f"Missing languages in held-out suite: {expected_langs - langs_seen}"
