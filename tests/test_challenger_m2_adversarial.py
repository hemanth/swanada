"""Empirical Challenger Adversarial Stress Suite for Milestone 2.

Covers:
1. Multilingual Vocabularies across all 12 languages (257 classes, blank=0, unk=1, bijection).
2. Script Detection (Python detect_script & TypeScript detectScript parity and robustness).
3. Classical Sanskrit Roman IAST Transliteration (Devanagari to IAST across complex Vedic hymns,
   accents, vocalic liquids, conjuncts, avagrahas, ayogavahas, with 100% bit-level parity).
"""

import json
from pathlib import Path
import subprocess
import unicodedata
import pytest

from swanada.vocab import (
    REGISTRY,
    Vocabulary,
    LanguageMeta,
    detect_script,
    devanagari_to_iast,
    transliterate_iast,
    SUPPORTED_LANGUAGES,
    BLANK_TOKEN_ID,
    UNK_TOKEN_ID,
)

REPO_ROOT = Path(__file__).resolve().parents[1]
VOCAB_DIR = REPO_ROOT / "models" / "vocabularies"
JS_DIR = REPO_ROOT / "js"


# ==============================================================================
# Suite 1: Multilingual Vocabularies Adversarial Stress Tests
# ==============================================================================

@pytest.mark.parametrize("lang", SUPPORTED_LANGUAGES)
def test_vocabulary_adversarial_invariants(lang: str) -> None:
    """Stress-test vocabulary file structural invariants and bijection."""
    v_path = VOCAB_DIR / f"{lang}_vocab.json"
    assert v_path.exists(), f"Vocabulary file missing for {lang}: {v_path}"
    
    with open(v_path, "r", encoding="utf-8") as f:
        tokens = json.load(f)
    
    # 1. Exact 257 classes invariant
    assert len(tokens) == 257, f"Language {lang} vocabulary size {len(tokens)} != 257"
    
    # 2. Blank at index 0 and UNK at index 1
    assert tokens[BLANK_TOKEN_ID] == "<blank>", f"Language {lang} index 0 must be <blank>"
    assert tokens[UNK_TOKEN_ID] == "<unk>", f"Language {lang} index 1 must be <unk>"
    
    # 3. All tokens must be non-empty strings
    for idx, tok in enumerate(tokens):
        assert isinstance(tok, str), f"Language {lang} token at {idx} is not string: {type(tok)}"
        assert len(tok) > 0, f"Language {lang} token at {idx} is empty string"
    
    # 4. Strict Bijection: Zero duplicates, zero token collisions
    unique_tokens = set(tokens)
    assert len(unique_tokens) == 257, (
        f"Language {lang} has duplicate tokens! Unique count: {len(unique_tokens)} vs 257"
    )
    
    # 5. Vocabulary class initialization & bijective mapping
    vocab = Vocabulary(tokens, language=lang)
    assert len(vocab) == 257
    for idx, tok in enumerate(tokens):
        assert vocab.get_token(idx) == tok
        assert vocab.get_id(tok) == idx
    
    # 6. Out-of-bounds index lookup returns <unk>
    assert vocab.get_token(-1) == "<unk>"
    assert vocab.get_token(257) == "<unk>"
    assert vocab.get_token(9999) == "<unk>"
    
    # 7. Unseen token lookup returns UNK_TOKEN_ID (1)
    assert vocab.get_id("__UNSEEN_TOKEN_TEST__") == UNK_TOKEN_ID


def test_legacy_sanskrit_vocab_parity() -> None:
    """Verify legacy sanskrit_vocab.json is byte-identical to sa_vocab.json."""
    sa_path = VOCAB_DIR / "sa_vocab.json"
    legacy_path = VOCAB_DIR / "sanskrit_vocab.json"
    assert legacy_path.exists()
    
    with open(sa_path, "r", encoding="utf-8") as f1, open(legacy_path, "r", encoding="utf-8") as f2:
        sa_tokens = json.load(f1)
        legacy_tokens = json.load(f2)
    assert sa_tokens == legacy_tokens


# ==============================================================================
# Suite 2: Script Detection Adversarial Stress Tests
# ==============================================================================

SCRIPT_TEST_CASES_VALID = [
    # Clean sentences in each of the 12 languages
    ("संस्कृतम् जगतः प्राचीना भाषा अस्ति", "sa"),
    ("हिन्दी भारतस्य एका प्रमुखा भाषा अस्ति", "sa"),  # Devanagari range -> 'sa'
    ("महाराष्ट्र राज्य मराठी भाषा", "sa"),              # Devanagari range -> 'sa'
    ("ಕನ್ನಡವು ಭಾರತದ ಅತ್ಯಂತ ಪ್ರಾಚೀನ ಭಾಷೆಗಳಲ್ಲಿ ಒಂದು", "kn"),
    ("தமிழ் ஒரு தொன்மையான செம்மொழி ஆகும்", "ta"),
    ("తెలుగు భారతదేశంలో అత్యంత మధురమైన భాష", "te"),
    ("മലയാളം കേരളത്തിലെ പ്രധാന ഭാഷയാണ്", "ml"),
    ("বাংলা ভাষা আমাদের মাতৃভাষা ও অহংকার", "bn"),
    ("ગુજરાતી ભાષા ભારતની સમૃદ્ધ ભાષા છે", "gu"),
    ("ਪੰਜਾਬੀ ਬੋਲੀ ਪੰਜਾਬ ਦੇ ਲੋਕਾਂ ਦੀ ਬੋਲੀ ਹੈ", "pa"),
    ("ଓଡ଼ିଆ ଭାଷା ଏକ ପ୍ରାଚୀନ ଶାସ୍ତ୍ରୀୟ ଭାଷା", "or"),
    ("Swanada is an in-browser multilingual speech recognition library", "en"),

    # Single-character inputs
    ("अ", "sa"), ("क", "sa"), ("्", "sa"),
    ("ಅ", "kn"), ("ಕ", "kn"),
    ("அ", "ta"), ("க", "ta"),
    ("అ", "te"), ("క", "te"),
    ("അ", "ml"), ("ക", "ml"),
    ("অ", "bn"), ("ক", "bn"),
    ("અ", "gu"), ("ક", "gu"),
    ("ਅ", "pa"), ("ਕ", "pa"),
    ("ଅ", "or"), ("କ", "or"),
    ("x", "en"), ("Z", "en"),

    # Numerals in native scripts vs Latin
    ("०१२३४५६७८९", "sa"),
    ("೦೧೨೩೪೫೬೭೮೯", "kn"),
    ("௦௧௨௩௪௫௬௭௮௯", "ta"),
    ("౦౧౨౩౪౫௬౭౮౯", "te"),
    ("൦൧൨൩൪൫൬൭൮൯", "ml"),
    ("০১২৩৪৫৬৭৮৯", "bn"),
    ("૦૧૨૩૪૫૬૭૮૯", "gu"),
    ("੦੧੨੩੪੫੬੭੮੯", "pa"),
    ("୦୧୨୩୪୫୬୭୮୯", "or"),
    ("0123456789", None),

    # Non-supported scripts without ASCII spaces
    ("", None),
    ("你好，这是一个中文句子测试", None),
    ("مرحبا", None),
    ("Привет", None),
    ("Γειάσου", None),
    ("🚀🔥🎉✨🎙️🎧", None),
    ("\t\n\r", None),

    # Mixed-script sentences: majority script wins
    ("अहं speech recognition करोमि", "en"),  # 20 Latin chars vs 9 Devanagari chars
    ("अहं तत्रत्यानां कतिपयसौकर्याणां विषये ज्ञातुमिच्छामि (audio test)", "sa"), # 45 Devanagari vs 12 Latin
]


@pytest.mark.parametrize("inp, expected", SCRIPT_TEST_CASES_VALID)
def test_detect_script_python_valid(inp: str, expected: str) -> None:
    """Verify Python script detection on valid inputs."""
    res = detect_script(inp)
    assert res == expected, f"Expected {expected} for {inp!r}, got {res!r}"


# Challenge Failure / Vulnerability SD-1
@pytest.mark.parametrize("inp, expected", [
    ("مرحبا بكم في عالم التعرف على الكلام", None),
    ("Привет, это проверка распознавания речи", None),
    ("Γειά σου κόσμε", None),
    ("क! ख? ग.", "sa"),
    ("   ", None),
])
def test_detect_script_vulnerability_sd1_whitespace_leakage(inp: str, expected: str) -> None:
    """Challenge SD-1: en unicode_range (0x20..0x7E) includes space and punctuation, causing false en detection."""
    actual = detect_script(inp)
    assert actual == expected, (
        f"Defect SD-1: {inp!r} detected as {actual!r} instead of {expected!r}"
    )


def test_detect_script_cross_runtime_parity() -> None:
    """Stress-test Python and TypeScript script detection for 100% parity."""
    test_inputs = [tc[0] for tc in SCRIPT_TEST_CASES_VALID] + [
        "தமிழ்বাংলা",
        "বাংলাதமிழ்",
        "తెలుగుಕನ್ನಡ",
        "ಕನ್ನಡతెలుగు",
        "ગુજરાતીਪੰਜਾਬੀ",
        "ਪੰਜਾਬੀગુજરાતી",
        "१२३ 123",
        "123 १२३",
        "A" * 10 + "क" * 5,
        "क" * 10 + "A" * 5,
        "ಕ" * 20 + "t" * 5,
        "தமிழ்" + " " * 10,
    ]

    py_results = [detect_script(text) for text in test_inputs]

    js_code = """
    import { detectScript } from "./dist/index.mjs";
    const inputs = %s;
    const res = inputs.map(t => detectScript(t));
    console.log(JSON.stringify(res));
    """ % json.dumps(test_inputs)

    proc = subprocess.run(
        ["node", "-e", js_code],
        cwd=str(JS_DIR),
        capture_output=True,
        text=True,
        check=True
    )
    js_results = json.loads(proc.stdout.strip())

    for idx, (inp, py_res, js_res) in enumerate(zip(test_inputs, py_results, js_results)):
        assert py_res == js_res, (
            f"Script detection mismatch at index {idx} ({inp!r}): Python={py_res!r} != JS={js_res!r}"
        )


# ==============================================================================
# Suite 3: Classical Sanskrit Roman IAST Transliteration Stress Tests
# ==============================================================================

IAST_BENCHMARK_CASES = [
    # 1. Dispatch Explicit Benchmark Sentences
    ("अहं तत्रत्यानां कतिपयसौकर्याणां विषये ज्ञातुमिच्छामि",
     "ahaṃ tatratyānāṃ katipayasaukaryāṇāṃ viṣaye jñātumicchāmi"),
    ("त्स्न्य", "tsnya"),
    ("र्त्स्न्यम्", "rtsnyam"),
    ("सोऽहम्", "so'ham"),
    ("भोऽऽऽ", "bho'''"),

    # 2. Vocalic Liquids: Standalone, Matras, and Lexical Items
    ("ऋ", "ṛ"),
    ("ॠ", "ṝ"),
    ("ऌ", "ḷ"),
    ("ॡ", "ḹ"),
    ("कृ", "kṛ"),
    ("कॄ", "kṝ"),
    ("कॢ", "kḷ"),
    ("कॣ", "kḹ"),
    ("ऋषि", "ṛṣi"),
    ("ऋतम्", "ṛtam"),
    ("ऋग्वेद", "ṛgveda"),
    ("पितॄन्", "pitṝn"),
    ("मातॄन्", "mātṝn"),
    ("कॢप्त", "kḷpta"),
    ("ऌकार", "ḷkāra"),
    ("ॡकार", "ḹkāra"),
    ("तवल्कार", "tavalkāra"),

    # 3. Ayogavāhas & Candrabindu
    ("अहं", "ahaṃ"),
    ("संस्कृतम्", "saṃskṛtam"),
    ("रामः", "rāmaḥ"),
    ("दुःखम्", "duḥkham"),
    ("अन्तःकरणम्", "antaḥkaraṇam"),
    ("हँस", "ham̐sa"),
    ("सँ", "sam̐"),

    # 4. Complex Consonant Clusters (Samyuktākṣaras)
    ("कार्त्स्न्यम्", "kārtsnyam"),
    ("क्ष्म्ला", "kṣmlā"),
    ("त्य्क्त्वा", "tyktvā"),
    ("र्द्ध्वम्", "rddhvam"),
    ("सत्त्व", "sattva"),
    ("दृष्ट्वा", "dṛṣṭvā"),
    ("विद्वान्", "vidvān"),
    ("आश्चर्य", "āścarya"),
    ("उज्जीवित", "ujjīvita"),
    ("प्रद्युम्न", "pradyumna"),
    ("स्वाच्छन्द्य", "svācchandya"),
    ("सत्", "sat"),
    ("जगत्", "jagat"),
    ("तस्मात्", "tasmāt"),
    ("शिवोऽहम्", "śivo'ham"),
    ("रामोऽवदत्", "rāmo'vadat"),
    ("हाऽऽ", "hā''"),
    ("कोऽपि", "ko'pi"),

    # 5. Dandas and Punctuation
    ("शान्तिः । शान्तिः ॥", "śāntiḥ . śāntiḥ .."),
    ("वृद्धिरादैच् ॥", "vṛddhirādaic .."),
]


@pytest.mark.parametrize("inp, expected", IAST_BENCHMARK_CASES)
def test_sanskrit_iast_phonetic_accuracy(inp: str, expected: str) -> None:
    """Verify phonetic transliteration correctness for Classical Sanskrit."""
    actual_py = devanagari_to_iast(inp)
    assert actual_py == expected, f"Devanagari {inp!r}: expected {expected!r}, got {actual_py!r}"
    assert transliterate_iast(inp) == expected


VEDIC_HYMNS = [
    # Rigveda 1.1.1
    "अ॒ग्निमी॑ळे पु॒रोहि॑तं य॒ज्ञस्य॑ दे॒वमृ॒त्विज॑म् । हो॑ता॑रं रत्न॒धात॑मम् ॥",
    # Gayatri Mantra
    "ॐ भूर्भुवः॒ स्वः॑ । तत्स॑वि॒तुर्वरे॑ण्यं॒ भर्गो॑ दे॒वस्य॑ धीमहि । धियो॒ यो नः॑ प्रचो॒दया॑त् ॥",
    # Rigveda 10.129.1 (Nasadiya Sukta)
    "नास॑दासी॒न्नो सदा॑सीत्त॒दानीं॒ नासी॒द्रजो॒ नो व्यो॑मा प॒रो यत् । किमाव॑रीवः॒ कुह॒ कस्य॒ शर्म॒न्नम्भः॒ किमा॑सी॒द्गह॑नं गभी॒रम् ॥",
    # Rigveda 1.35.2 (Savitr Hymn)
    "आ कृ॒ष्णेन॒ रज॑सा॒ वर्त॑मानो निवे॒शय॑न्न॒मृतं॒ मर्त्यं॑ च । हिर॒ण्यये॑न सवि॒ता रथे॑ना दे॒वो या॑ति॒ भुव॑नानि॒ पश्य॑न् ॥",
    # Rigveda 10.90.1 (Purusha Sukta)
    "स॒हस्र॑शीर्षा॒ पुरु॑षः सहस्रा॒क्षः स॒हस्र॑पात् । स भूमिं॑ वि॒श्वतो॑ वृ॒त्वात्य॑तिष्ठद्दशांगु॒लम् ॥",
    # Isha Upanishad 1
    "ईशा वास्यमिदँ सर्वं यत्किञ्च जगत्यां जगत् । तेन त्यक्तेन भुञ्जीथा मा गृधः कस्यस्विद्धनम् ॥",
    # Bhagavad Gita 2.47
    "कर्मण्येवाधिकारस्ते मा फलेषु कदाचन । मा कर्मफलहेतुर्भूर्मा ते सङ्गोऽस्त्वकर्मणि ॥",
    # Shiva Tandava Stotram 1
    "जटाटवीगलज्जलप्रवाहपावितस्थले गलेऽवलम्ब्य लम्बितां भुजङ्गतुङ्गमालिकाम् ।",
]


def test_vedic_hymns_python_typescript_bit_level_parity() -> None:
    """Test full Vedic hymns with pitch accents and confirm 100% bit-level parity with TypeScript."""
    all_cases = [c[0] for c in IAST_BENCHMARK_CASES] + VEDIC_HYMNS

    # Compute Python IAST
    py_outputs = [devanagari_to_iast(text) for text in all_cases]

    # Compute TypeScript IAST
    js_code = """
    import { devanagariToIast } from "./dist/index.mjs";
    const texts = %s;
    const res = texts.map(t => devanagariToIast(t));
    console.log(JSON.stringify(res));
    """ % json.dumps(all_cases)

    proc = subprocess.run(
        ["node", "-e", js_code],
        cwd=str(JS_DIR),
        capture_output=True,
        text=True,
        check=True
    )
    js_outputs = json.loads(proc.stdout.strip())

    assert len(py_outputs) == len(js_outputs) == len(all_cases)

    parity_failures = []
    for idx, (inp, py_str, js_str) in enumerate(zip(all_cases, py_outputs, js_outputs)):
        assert unicodedata.is_normalized("NFC", py_str)
        assert unicodedata.is_normalized("NFC", js_str)
        if py_str.encode("utf-8") != js_str.encode("utf-8"):
            parity_failures.append({"index": idx, "input": inp, "py": py_str, "js": js_str})

    assert not parity_failures, f"Bit-level parity failures between Python and JS: {parity_failures}"


# Challenge Failure / Vulnerability IAST-1
@pytest.mark.parametrize("inp, unexpected_codepoints", [
    ("भूर्भुवः॒", ["\u0952"]),
    ("स्वः॑", ["\u0951"]),
    ("वरेण्यं॒", ["\u0952"]),
    ("मर्त्यं॑", ["\u0951"]),
])
def test_iast_vulnerability_iast1_accent_leakage(inp: str, unexpected_codepoints: list) -> None:
    """Challenge IAST-1: Accents following ayogavahas leak raw Devanagari U+0951/U+0952 into Roman IAST."""
    iast = devanagari_to_iast(inp)
    for cp in unexpected_codepoints:
        assert cp not in iast, (
            f"Vulnerability IAST-1: {inp!r} -> {iast!r} leaks raw Devanagari accent {hex(ord(cp))} "
            "because accents following ayogavahas are unhandled by branch 3 (SPECIAL_MAP)."
        )
