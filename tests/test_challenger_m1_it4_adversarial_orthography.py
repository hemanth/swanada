"""Empirical adversarial challenger test suite for Milestone 1 Iteration 4.

Validates Gurmukhi Rule 5 linguistic precision, speech corpus preservation,
and comprehensive Brahmic orthography repair invariants across 12 languages.
"""

from __future__ import annotations

import json
import subprocess
import unicodedata
from pathlib import Path
import pytest

from swanada.normalizer import (
    _RE_PA_MATRA_INDEP_VOWEL,
    dedup_marks,
    join_subwords,
    normalize_indic_text,
    repair_brahmic_orthography,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
NODE_SCRIPT = REPO_ROOT / "js" / "src" / "decoder" / "normalizer.ts"


def invoke_ts_normalizer(action: str, payload: dict) -> str:
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
# Section 1: Gurmukhi Rule 5 Native Punjabi Verbal Vocabulary Preservation
# ============================================================================

PUNJABI_VERBAL_VOCABULARY = [
    # Verbs ending in hora + e (\u0A4B\u0A0F)
    "ਹੋਏ",
    "ਸੋਏ",
    "ਰੋਏ",
    "ਧੋਏ",
    "ਖੋਏ",
    # Verbs with future marker ga
    "ਹੋਏਗਾ",
    "ਰੋਏਗਾ",
    "ਸੋਏਗਾ",
    "ਧੋਏਗਾ",
    "ਖੋਏਗਾ",
    # Verbs with bihari + e preceded by ha (\u0A39\u0A40\u0A0F)
    "ਕਹੀਏ",
    "ਰਹੀਏ",
    "ਸਹੀਏ",
    "ਬਹੀਏ",
    "ਕਹੀਏਗਾ",
    "ਰਹੀਏਗਾ",
    "ਸਹੀਏਗਾ",
    "ਚਾਹੀਏ",
    "ਚਾਹੀਏਗਾ",
    "ਲਹੀਏ",
    "ਦਹੀਏ",
]


@pytest.mark.parametrize("word", PUNJABI_VERBAL_VOCABULARY)
def test_gurmukhi_verbal_vocabulary_unmutated_python(word: str):
    """Verify native Punjabi verbal forms remain 100% unmutated in Python."""
    regex_res = _RE_PA_MATRA_INDEP_VOWEL.sub(r"\1 \2", word)
    assert regex_res == word, f"Rule 5 regex mutated native verb: {word!r} -> {regex_res!r}"

    repair_res = repair_brahmic_orthography(word, lang="pa")
    assert repair_res == word, f"repair_brahmic_orthography mutated native verb: {word!r} -> {repair_res!r}"

    norm_res = normalize_indic_text(word, lang="pa")
    assert norm_res == word, f"normalize_indic_text mutated native verb: {word!r} -> {norm_res!r}"


@pytest.mark.parametrize("word", PUNJABI_VERBAL_VOCABULARY)
def test_gurmukhi_verbal_vocabulary_unmutated_typescript(word: str):
    """Verify native Punjabi verbal forms remain 100% unmutated in TypeScript."""
    ts_repair = invoke_ts_normalizer("repair", {"text": word, "lang": "pa"})
    assert ts_repair == word, f"TS repair mutated native verb: {word!r} -> {ts_repair!r}"

    ts_norm = invoke_ts_normalizer("normalize", {"text": word, "lang": "pa"})
    assert ts_norm == word, f"TS normalize mutated native verb: {word!r} -> {ts_norm!r}"


SENTENCE_CONTEXT_CASES = [
    ("ਉਹ ਘਰ ਆਏ ਅਤੇ ਸੋਏ ਸਨ", "ਉਹ ਘਰ ਆਏ ਅਤੇ ਸੋਏ ਸਨ"),
    ("ਅਸੀਂ ਕੀ ਕਹੀਏ ਜਾਂ ਕੀ ਸੁਣੀਏ", "ਅਸੀਂ ਕੀ ਕਹੀਏ ਜਾਂ ਕੀ ਸੁਣੀਏ"),
    ("ਜੇ ਉਹ ਹੋਏਗਾ ਤਾਂ ਕੰਮ ਹੋਵੇਗਾ", "ਜੇ ਉਹ ਹੋਏਗਾ ਤਾਂ ਕੰਮ ਹੋਵੇਗਾ"),
    ("ਕੱਪੜੇ ਧੋਏ ਗਏ ਹਨ ਅਤੇ ਸੁੱਕ ਰਹੇ ਹਨ", "ਕੱਪੜੇ ਧੋਏ ਗਏ ਹਨ ਅਤੇ ਸੁੱਕ ਰਹੇ ਹਨ"),
    ("ਸਦਾ ਸੱਚ ਕਹੀਏ ਅਤੇ ਧਰਮ ਵਿਚ ਰਹੀਏ", "ਸਦਾ ਸੱਚ ਕਹੀਏ ਅਤੇ ਧਰਮ ਵਿਚ ਰਹੀਏ"),
]


@pytest.mark.parametrize("raw_sent,expected", SENTENCE_CONTEXT_CASES)
def test_gurmukhi_verbs_in_sentence_contexts(raw_sent: str, expected: str):
    """Verify Punjabi verbal expressions within continuous sentences."""
    py_out = repair_brahmic_orthography(raw_sent, lang="pa")
    assert py_out == expected, f"Python corrupted sentence: {py_out!r} != {expected!r}"

    ts_out = invoke_ts_normalizer("repair", {"text": raw_sent, "lang": "pa"})
    assert ts_out == expected, f"TypeScript corrupted sentence: {ts_out!r} != {expected!r}"


# ============================================================================
# Section 2: Gurmukhi Loanword Compound Separation
# ============================================================================

LOANWORD_COMPOUND_CASES = [
    ("ਨਗਰੀਏਕਸਪ੍ਰੇਸ", "ਨਗਰੀ ਏਕਸਪ੍ਰੇਸ"),
    ("ਦਿੱਲੀਏਕਸਪ੍ਰੈਸ", "ਦਿੱਲੀ ਏਕਸਪ੍ਰੈਸ"),
    ("ਪੰਜਾਬੀਏਕਤਾ", "ਪੰਜਾਬੀ ਏਕਤਾ"),
    ("ਕੌਮੀਏਕਤਾ", "ਕੌਮੀ ਏਕਤਾ"),
    ("ਸੰਸਦੀਏਜੰਡਾ", "ਸੰਸਦੀ ਏਜੰਡਾ"),
    ("ਸਰਕਾਰੀਏਜੰਸੀ", "ਸਰਕਾਰੀ ਏਜੰਸੀ"),
]


@pytest.mark.parametrize("compound,expected", LOANWORD_COMPOUND_CASES)
def test_gurmukhi_loanword_compound_separation(compound: str, expected: str):
    """Verify loanword compounds properly separate dependent matra from independent vowel."""
    py_rep = repair_brahmic_orthography(compound, lang="pa")
    assert py_rep == expected, f"Python compound separation failed: {py_rep!r} != {expected!r}"

    ts_rep = invoke_ts_normalizer("repair", {"text": compound, "lang": "pa"})
    assert ts_rep == expected, f"TypeScript compound separation failed: {ts_rep!r} != {expected!r}"

    py_norm = normalize_indic_text(compound, lang="pa")
    assert py_norm == expected, f"Python normalize failed on compound: {py_norm!r} != {expected!r}"

    ts_norm = invoke_ts_normalizer("normalize", {"text": compound, "lang": "pa"})
    assert ts_norm == expected, f"TypeScript normalize failed on compound: {ts_norm!r} != {expected!r}"


# ============================================================================
# Section 3: Benchmark Suite Clip 410 Verification
# ============================================================================

def test_benchmark_clip_410_preserved():
    """Verify Clip 410 in test_speech_suite.jsonl is preserved with zero modifications."""
    suite_file = REPO_ROOT / "bench" / "test_speech_suite.jsonl"
    with open(suite_file, "r", encoding="utf-8") as f:
        clips = [json.loads(line) for line in f]

    clip_410 = clips[410]
    raw_text = clip_410["text"]
    assert "ਕਹੀਏ" in raw_text, f"Expected ਕਹੀਏ in Clip 410 text: {raw_text!r}"

    # Verify direct regex execution
    reg_out = _RE_PA_MATRA_INDEP_VOWEL.sub(r"\1 \2", raw_text)
    assert reg_out == raw_text, f"Rule 5 mutated Clip 410 text: {reg_out!r}"

    # Verify Python normalizer execution
    py_rep = repair_brahmic_orthography(raw_text, lang="pa")
    assert py_rep == raw_text, f"Python repair mutated Clip 410 text: {py_rep!r}"

    py_norm = normalize_indic_text(raw_text, lang="pa")
    assert py_norm == raw_text, f"Python normalize mutated Clip 410 text: {py_norm!r}"

    # Verify TypeScript normalizer execution
    ts_rep = invoke_ts_normalizer("repair", {"text": raw_text, "lang": "pa"})
    assert ts_rep == raw_text, f"TypeScript repair mutated Clip 410 text: {ts_rep!r}"

    ts_norm = invoke_ts_normalizer("normalize", {"text": raw_text, "lang": "pa"})
    assert ts_norm == raw_text, f"TypeScript normalize mutated Clip 410 text: {ts_norm!r}"


# ============================================================================
# Section 4: Full 480-Clip Speech Suite Scan
# ============================================================================

def test_full_speech_suite_480_clips_zero_rule5_mutations():
    """Scan all 480 clips in test_speech_suite.jsonl and assert strictly 0 mutations from Rule 5."""
    suite_file = REPO_ROOT / "bench" / "test_speech_suite.jsonl"
    with open(suite_file, "r", encoding="utf-8") as f:
        clips = [json.loads(line) for line in f]

    assert len(clips) == 480, f"Expected 480 clips, found {len(clips)}"

    rule5_mutations = []
    for idx, clip in enumerate(clips):
        orig_text = clip["text"]
        mutated_text = _RE_PA_MATRA_INDEP_VOWEL.sub(r"\1 \2", orig_text)
        if mutated_text != orig_text:
            rule5_mutations.append({
                "index": idx,
                "utt_id": clip.get("utt_id"),
                "lang": clip.get("lang"),
                "original": orig_text,
                "mutated": mutated_text,
            })

    assert len(rule5_mutations) == 0, (
        f"Detected {len(rule5_mutations)} unintended mutations introduced by Gurmukhi Rule 5: {rule5_mutations}"
    )


# ============================================================================
# Section 5: Adversarial Tests Across All 12 Brahmic Scripts
# ============================================================================

# 5.1 Consonant-Matra Collisions across 9 Brahmic script blocks
COLLIDING_MATRA_CASES = [
    # Sanskrit / Hindi / Marathi (Devanagari): AA + II matras on KA
    ("काी", "का", "hi"),
    ("कीा", "की", "hi"),
    ("कौे", "कौ", "hi"),
    # Bengali: AA + I matras on KA
    ("কাি", "কা", "bn"),
    ("কিা", "কি", "bn"),
    # Gurmukhi: AA + II matras on KA
    ("ਕਾੀ", "ਕਾ", "pa"),
    ("ਕੀਾ", "ਕੀ", "pa"),
    # Gujarati: AA + II matras on KA
    ("કાી", "કા", "gu"),
    ("કીા", "કી", "gu"),
    # Odia: AA + I matras on KA
    ("କାି", "କା", "or"),
    # Tamil: AA + I matras on KA
    ("காி", "கா", "ta"),
    # Telugu: AA + I matras on KA
    ("కాి", "కా", "te"),
    # Kannada: AA + I matras on KA
    ("ಕಾಿ", "ಕಾ", "kn"),
    # Malayalam: AA + I matras on KA
    ("കാി", "കാ", "ml"),
]


@pytest.mark.parametrize("corrupt_input,expected,lang", COLLIDING_MATRA_CASES)
def test_colliding_dependent_vowels_all_scripts(corrupt_input: str, expected: str, lang: str):
    """Verify collapsing of colliding dependent vowel signs across all Brahmic scripts."""
    py_out = repair_brahmic_orthography(corrupt_input, lang=lang)
    assert py_out == expected, f"Python failing on colliding matras: {py_out!r} != {expected!r}"

    ts_out = invoke_ts_normalizer("repair", {"text": corrupt_input, "lang": lang})
    assert ts_out == expected, f"TypeScript failing on colliding matras: {ts_out!r} != {expected!r}"


# 5.2 Matra Followed by Illegal Virama
MATRA_THEN_VIRAMA_CASES = [
    # Devanagari: KA + AA matra + Virama
    ("का्", "का", "hi"),
    ("की्", "की", "sa"),
    ("के्", "के", "mr"),
    # Bengali
    ("কা্", "কা", "bn"),
    # Gurmukhi
    ("ਕਾ੍", "ਕਾ", "pa"),
    # Gujarati
    ("કા્", "કા", "gu"),
    # Odia
    ("କା୍", "କା", "or"),
    # Tamil
    ("கா்", "கா", "ta"),
    # Telugu
    ("కా్", "కా", "te"),
    # Kannada
    ("ಕಾ್", "ಕಾ", "kn"),
    # Malayalam
    ("കാ്", "കാ", "ml"),
]


@pytest.mark.parametrize("corrupt_input,expected,lang", MATRA_THEN_VIRAMA_CASES)
def test_matra_then_virama_removal_all_scripts(corrupt_input: str, expected: str, lang: str):
    """Verify illegal viramas following dependent vowels are stripped across all Brahmic scripts."""
    py_out = repair_brahmic_orthography(corrupt_input, lang=lang)
    assert py_out == expected, f"Python failing on matra+virama: {py_out!r} != {expected!r}"

    ts_out = invoke_ts_normalizer("repair", {"text": corrupt_input, "lang": lang})
    assert ts_out == expected, f"TypeScript failing on matra+virama: {ts_out!r} != {expected!r}"


# 5.3 Independent Vowel Followed by Illegal Dependent Mark
INDEP_VOWEL_ILLEGAL_MARK_CASES = [
    # Devanagari: AA + virama -> AA; AA + II matra -> AA
    ("आ्", "आ", "hi"),
    ("आी", "आ", "hi"),
    # Bengali: preserve Bengali /æ/ diphthong (অ + virama + য)
    ("অ্য", "অ্য", "bn"),
    # Bengali: illegal mark without ya
    ("আ্", "আ", "bn"),
    # Kannada: I + virama -> I; I + II matra -> I
    ("ಇ್", "ಇ", "kn"),
    ("ಇಿ", "ಇ", "kn"),
    # Telugu: A + virama -> A
    ("అ్", "అ", "te"),
    # Malayalam: U + virama -> U; U + AA matra -> U
    ("ഉ്", "ഉ", "ml"),
    ("ഉാ", "ഉ", "ml"),
    # Odia: A + virama -> A
    ("ଅ୍", "ଅ", "or"),
    # Gujarati: A + virama -> A
    ("અ્", "અ", "gu"),
]


@pytest.mark.parametrize("corrupt_input,expected,lang", INDEP_VOWEL_ILLEGAL_MARK_CASES)
def test_independent_vowel_illegal_mark_handling(corrupt_input: str, expected: str, lang: str):
    """Verify illegal marks on independent vowels are removed while preserving valid Bengali diphthongs."""
    py_out = repair_brahmic_orthography(corrupt_input, lang=lang)
    assert py_out == expected, f"Python failing on indep vowel marks: {py_out!r} != {expected!r}"

    ts_out = invoke_ts_normalizer("repair", {"text": corrupt_input, "lang": lang})
    assert ts_out == expected, f"TypeScript failing on indep vowel marks: {ts_out!r} != {expected!r}"


# 5.4 Deduplication of Category M Combining Marks vs Consonants
DEDUP_MARKS_CASES = [
    # Repeated matras
    ("कूू", "कू"),
    ("ਕੂੂ", "ਕੂ"),
    ("കൂൂ", "കൂ"),
    # Repeated anusvara
    ("कंं", "कं"),
    ("ಕಂಂ", "ಕಂ"),
    # Repeated candrabindu
    ("कँँ", "कँ"),
    ("ਕਁਁ", "ਕਁ"),
    # Repeated nukta
    ("क़़", "क़"),
    ("ਫ਼਼", "ਫ਼"),
    # Legitimate consonants and Latin characters MUST be preserved
    ("hello", "hello"),
    ("speed", "speed"),
    ("बच्चा", "बच्चा"),
    ("पत्ता", "पत्ता"),
    ("ಅಮ್ಮ", "ಅಮ್ಮ"),
    ("அம்மா", "அம்மா"),
]


@pytest.mark.parametrize("raw_input,expected", DEDUP_MARKS_CASES)
def test_deduplicate_combining_marks_fidelity(raw_input: str, expected: str):
    """Verify Category M marks deduplicate while preserving legitimate consonant geminates and English words."""
    py_dedup = dedup_marks(raw_input)
    assert py_dedup == expected, f"Python dedup_marks mismatch: {py_dedup!r} != {expected!r}"

    ts_dedup = invoke_ts_normalizer("dedup", {"text": raw_input})
    assert ts_dedup == expected, f"TypeScript dedupMarks mismatch: {ts_dedup!r} != {expected!r}"


# 5.5 Script-Specific Orthographic Rules Hardening
SCRIPT_SPECIFIC_CASES = [
    # 1. Kannada / Telugu / Odia retroflex lateral ligature
    ("ಸ್ಥಗਿਤಗೊಳಳ್ಸಿದೆ", "ಸ್ಥಗਿਤಗೊಳ್ಸಿದೆ", "kn"),
    ("కోళళ్సింది", "కోళ్సింది", "te"),
    ("କଳଳ୍ସିଦେ", "କଳ୍ସିଦେ", "or"),
    # Legitimate geminates preserved
    ("ಬೆಳ್ಳಿ", "ಬೆಳ್ಳಿ", "kn"),
    ("ಪೆళ్ళಿ", "ಪೆళ్ళಿ", "te"),
    ("ବିଳ୍ଳ", "ବିଳ୍ଳ", "or"),
    # 2. Malayalam nasal geminates reunification
    ("ഉംമാ", "ഉമ്മാ", "ml"),
    ("ഒംന", "ഒന്ന", "ml"),
    ("\u0D15\u0D02\u0D23", "\u0D15\u0D23\u0D4D\u0D23", "ml"),
    ("മംഞ", "മഞ്ഞ", "ml"),
    ("തംങ", "തങ്ങ", "ml"),
    # Legitimate non-geminate anusvaras preserved
    ("അംബരം", "അംബരം", "ml"),
    ("സമ്പത്ത്", "സമ്പത്ത്", "ml"),
    ("വിശ്വാസം", "വിശ്വാസം", "ml"),
    # 3. Gujarati palatal sibilant restoration
    ("હું જઈષ", "હું જઈશ", "gu"),
    ("તેઓ જઈષ.", "તેઓ જઈશ.", "gu"),
    # Valid sibilants preserved
    ("ઋષિ", "ઋષિ", "gu"),
    ("દોષ", "દોષ", "gu"),
    ("વિશેષ", "વિશેષ", "gu"),
    ("બસથી", "બસથી", "gu"),
    # 4. Odia detached anusvara and dative suffix
    ("ସଧ୍ୟାଂଙ୍କୁ", "ସଧ୍ୟାଙ୍କୁ", "or"),
    ("ରାମଂକୁ", "ରାମଙ୍କୁ", "or"),
    ("ପିଲାଂକୁ", "ପିଲାଙ୍କୁ", "or"),
    ("ତାହାଂକୁ", "ତାହାଙ୍କୁ", "or"),
    # Valid Odia anusvara preserved
    ("ସଂସਾਰ", "ସଂସਾਰ", "or"),
    ("ଅଂଶ", "ଅଂଶ", "or"),
    ("ସିଂହ", "ସିଂହ", "or"),
]


@pytest.mark.parametrize("corrupt_input,expected,lang", SCRIPT_SPECIFIC_CASES)
def test_script_specific_orthographic_rules(corrupt_input: str, expected: str, lang: str):
    """Verify script-specific rules across Kannada, Telugu, Odia, Malayalam, and Gujarati."""
    py_rep = repair_brahmic_orthography(corrupt_input, lang=lang)
    assert py_rep == expected, f"Python script-specific mismatch: {py_rep!r} != {expected!r}"

    ts_rep = invoke_ts_normalizer("repair", {"text": corrupt_input, "lang": lang})
    assert ts_rep == expected, f"TypeScript script-specific mismatch: {ts_rep!r} != {expected!r}"
