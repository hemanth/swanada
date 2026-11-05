"""Milestone 2 Iteration 2 Adversarial Stress Harness.

Deeply stress-tests:
1. detect_script (Python) and detectScript (Node.js/TypeScript)
2. devanagari_to_iast (Python) and devanagariToIast (Node.js/TypeScript)
"""

import json
import os
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

# Add python/src to path
REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "python" / "src"))

from swanada.vocab import (
    REGISTRY,
    SUPPORTED_LANGUAGES,
    detect_script,
    devanagari_to_iast,
    transliterate_iast,
    VOWEL_MAP,
    MATRA_MAP,
    CONSONANT_MAP,
    SPECIAL_MAP,
    ACCENT_MAP,
)

JS_DIR = REPO_ROOT / "js"


def run_node_eval(js_code: str) -> str:
    """Run Node.js code and return stdout."""
    res = subprocess.run(
        ["node", "-e", js_code],
        cwd=str(JS_DIR),
        capture_output=True,
        text=True,
        check=True,
    )
    return res.stdout.strip()


# ==============================================================================
# 1. SCRIPT DETECTION ADVERSARIAL STRESS TEST
# ==============================================================================

def test_script_detection_stress():
    print("=" * 70)
    print("RUNNING ADVERSARIAL STRESS: Script Detection")
    print("=" * 70)

    test_cases = []

    # Category 1: Foreign scripts with spaces (MUST BE NONE)
    foreign_with_spaces = [
        # Arabic
        ("مرحبا بكم في عالم التعرف على الكلام", None, "Arabic sentence with spaces"),
        ("صباح الخير كيف حالك اليوم", None, "Arabic greeting with spaces"),
        ("اللغة العربية لغة جميلة وعريقة", None, "Arabic text with spaces"),
        ("١٢٣٤٥ مرحبا", None, "Arabic with Eastern Arabic numerals"),
        # Russian / Cyrillic
        ("Привет, это проверка распознавания речи", None, "Russian sentence with spaces"),
        ("Съешь же ещё этих мягких французских булок, да выпей чаю.", None, "Russian pangram"),
        ("Москва — столица России", None, "Russian sentence with em dash"),
        ("Быстрее, выше, сильнее!", None, "Russian motto with exclamation"),
        # Greek
        ("Γειά σου κόσμε", None, "Greek hello world"),
        ("Η γλώσσα της αρχαίας Ελλάδας", None, "Greek sentence with spaces"),
        ("Ένα δύο τρία τέσσερα πέντε", None, "Greek numerals spelled out"),
        ("Ουδέν κακόν αμιγές καλού", None, "Greek proverb"),
        # Hebrew
        ("שלום עולם", None, "Hebrew hello world"),
        ("מה שלומך הבוקר הזה", None, "Hebrew greeting with spaces"),
        ("עברית היא שפה שמית", None, "Hebrew sentence"),
        ("בָּרוּךְ אַתָּה ה' אֱלֹהֵינוּ", None, "Hebrew with niqqud and apostrophe"),
        # Persian / Farsi
        ("درود بر شما حال شما چطور است", None, "Persian greeting with spaces"),
        ("ایران کشوری باستانی است", None, "Persian sentence"),
        # Urdu
        ("کیا حال ہے آپ کا", None, "Urdu greeting"),
        ("پاکستان اور ہندوستان پڑوسی ممالک ہیں", None, "Urdu sentence"),
        # Chinese (Simplified & Traditional)
        ("你好 世界 各地的 朋友", None, "Chinese with spaces"),
        ("语音识别技术正在飞速发展", None, "Chinese sentence"),
        ("繁體 中文 語音 識別 測試", None, "Traditional Chinese with spaces"),
        # Japanese
        ("こんにちは 世界 の みなさん", None, "Japanese Hiragana with spaces"),
        ("日本語の音声認識テストを行っています。", None, "Japanese mixed Kanji/Kana"),
        ("カタカナ と ひらがな と 漢字", None, "Japanese Katakana/Hiragana/Kanji"),
        # Korean
        ("안녕하세요 세계 의 모든 분들", None, "Korean Hangul with spaces"),
        ("한국어 음성 인식 테스트 입니다", None, "Korean sentence with spaces"),
        # Thai
        ("สวัสดี ชาวโลก ทั้งหลาย", None, "Thai with spaces"),
        ("การรู้จำเสียงพูดภาษาไทย", None, "Thai sentence"),
        # Burmese
        ("မင်္ဂလာပါ ကမ္ဘာလောက", None, "Burmese with spaces"),
        # Amharic
        ("ሰላም ለሁሉ ይሁን በዓለም ዙሪያ", None, "Amharic with spaces"),
        # Armenian
        ("Բարև բոլորին այսօր", None, "Armenian with spaces"),
        # Georgian
        ("გამარჯობა ყველას დღეს", None, "Georgian with spaces"),
        # Non-ASCII Latin diacritics alone
        ("éàçùôîë", None, "French accented letters only (no ASCII Latin)"),
        ("łśżźń", None, "Polish accented letters only (no ASCII Latin)"),
    ]
    test_cases.extend(foreign_with_spaces)

    # Category 2: Punctuated Indic text across all 10 Indic languages
    punctuated_indic = [
        # Devanagari (sa)
        ("क! ख? ग.", "sa", "Devanagari short with punctuation"),
        ("क ! ! ! ? ? ? ... ::: ;;; ,,, --- \" \" ' ' ( ) [ ] { } / \\ @ # $ % ^ & * + = ~ < > |", "sa", "Devanagari with all ASCII punctuation"),
        ("क" + "!" * 100, "sa", "Devanagari single char + 100 exclamation marks"),
        ("अस्ति कश्चिद् विशेषः? आम्, अवश्यम्!", "sa", "Sanskrit dialogue with ? and !"),
        ("शान्तिः! शान्तिः!! शान्तिः!!!", "sa", "Sanskrit with repeated exclamations"),
        ("कति पुस्तकानि सन्ति? (१०/२०) [५०%]", "sa", "Sanskrit with brackets and %"),
        # Kannada (kn)
        ("ಕ! ಖ? ಗ.", "kn", "Kannada short with punctuation"),
        ("ಕ" + "!" * 100, "kn", "Kannada single char + 100 exclamation marks"),
        ("ಹೇಗಿದ್ದೀರಾ? ನಾನು ಚೆನ್ನಾಗಿದ್ದೇನೆ! ಧನ್ಯವಾದಗಳು.", "kn", "Kannada sentence with punctuation"),
        ("ಕನ್ನಡ ಸಾಹಿತ್ಯ ಸಮ್ಮೇಳನ (೨೦೨೬) ಯಶಸ್ವಿಯಾಗಿದೆ!", "kn", "Kannada with digits and !"),
        # Tamil (ta)
        ("க! ங? ச.", "ta", "Tamil short with punctuation"),
        ("க" + "!" * 100, "ta", "Tamil single char + 100 exclamation marks"),
        ("வணக்கம்! நீங்கள் எப்படி இருக்கிறீர்கள்? நலமா?", "ta", "Tamil sentence with ! and ?"),
        ("தமிழ் வாழ்க! (௨௦௨௬)", "ta", "Tamil with digits and !"),
        # Telugu (te)
        ("క! ఖ? గ.", "te", "Telugu short with punctuation"),
        ("క" + "!" * 100, "te", "Telugu single char + 100 exclamation marks"),
        ("నమస్కారం! మీరు ఎలా ఉన్నారు? బాగున్నారా?", "te", "Telugu sentence with punctuation"),
        ("తెలుగు భాష అమృతం వంటిది! (౨౦౨౬)", "te", "Telugu with digits and !"),
        # Malayalam (ml)
        ("ക! ഖ? ഗ.", "ml", "Malayalam short with punctuation"),
        ("ക" + "!" * 100, "ml", "Malayalam single char + 100 exclamation marks"),
        ("നമസ്കാരം! സുഖമാണോ? അതെ, സുഖമാണ്.", "ml", "Malayalam sentence with punctuation"),
        ("കേരളം ദൈവത്തിന്റെ സ്വന്തം നാട്! (൨൦൨൬)", "ml", "Malayalam with digits and !"),
        # Bengali (bn)
        ("ক! খ? গ.", "bn", "Bengali short with punctuation"),
        ("ক" + "!" * 100, "bn", "Bengali single char + 100 exclamation marks"),
        ("নমস্কার! আপনি কেমন আছেন? ভালো আছি.", "bn", "Bengali sentence with punctuation"),
        ("রবীন্দ্রনাথ ঠাকুর নোবেল পুরস্কার পেয়েছিলেন (১৯১৩)!", "bn", "Bengali with digits and !"),
        # Gujarati (gu)
        ("ક! ખ? ગ.", "gu", "Gujarati short with punctuation"),
        ("ક" + "!" * 100, "gu", "Gujarati single char + 100 exclamation marks"),
        ("નમસ્તે! તમે કેમ છો? હું મજામાં છું.", "gu", "Gujarati sentence with punctuation"),
        ("ગુજરાતી સાહિત્ય પરિષદ (૨૦૨૬)!", "gu", "Gujarati with digits and !"),
        # Gurmukhi / Punjabi (pa)
        ("ਕ! ਖ? ਗ.", "pa", "Gurmukhi short with punctuation"),
        ("ਕ" + "!" * 100, "pa", "Gurmukhi single char + 100 exclamation marks"),
        ("ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ! ਤੁਸੀਂ ਕਿਵੇਂ ਹੋ? ਠੀਕ ਹਾਂ.", "pa", "Gurmukhi sentence with punctuation"),
        ("ਪੰਜਾਬ, ਪੰਜਾਬੀ ਅਤੇ ਪੰਜਾਬੀਅਤ (੨੦੨੬)!", "pa", "Gurmukhi with digits and !"),
        # Odia (or)
        ("କ! ଖ? ଗ.", "or", "Odia short with punctuation"),
        ("କ" + "!" * 100, "or", "Odia single char + 100 exclamation marks"),
        ("ନମସ୍କାର! ଆପଣ କେମିତି ଅଛନ୍ତି? ଭଲ ଅଛି.", "or", "Odia sentence with punctuation"),
        ("ଓଡ଼ିଆ ଭାଷା ଓ ସାହିତ୍ୟ (୨୦୨୬)!", "or", "Odia with digits and !"),
    ]
    test_cases.extend(punctuated_indic)

    # Category 3: Pure whitespace, empty, and non-letter symbols (MUST BE NONE)
    pure_whitespace_and_symbols = [
        ("", None, "Empty string"),
        (" ", None, "Single space"),
        ("   ", None, "Multiple spaces"),
        ("\t\t\t", None, "Tabs"),
        ("\n\r\n", None, "Newlines"),
        (" \t \n \r ", None, "Mixed ASCII whitespace"),
        ("\u00A0 \u2000 \u2001 \u2002 \u2003 \u2004 \u2005 \u2006 \u2007 \u2008 \u2009 \u200A \u202F \u205F \u3000", None, "All Unicode whitespace codepoints"),
        ("!@#$%^&*()_+-=[]{}|;':\",./<>?`~\\", None, "All ASCII punctuation"),
        (".... ,,,, ;;;; !!!! ???? ----", None, "Repeated punctuation and spaces"),
        ("0", None, "Single Western digit"),
        ("0123456789", None, "Western digits 0-9"),
        ("123.456,789", None, "Western decimal number with comma and period"),
        ("+91-9876543210", None, "Phone number format"),
        ("😀😃😄😁😆😅🤣😂🙂🙃😉😊😇🥰😍🤩😘😗😚😙😋😛😜🤪😝🤑🤗🤭🤫🤔", None, "Emojis only"),
        ("§ ¶ † ‡ • ‣ ⁃ ⁋ ⁓ © ® ™ ℠ ± × ÷ = ≠ ≈ ≤ ≥ ∞ √ ∫ ∑ ∏ π", None, "Typographical and mathematical symbols"),
    ]
    test_cases.extend(pure_whitespace_and_symbols)

    # Category 4: English and Indian English sentences (MUST BE 'en')
    english_sentences = [
        ("Hello world", "en", "Basic English sentence"),
        ("The speech to text engine runs locally with zero external network requests.", "en", "Indian English technical sentence"),
        ("Swanada is an in-browser multilingual speech recognition library.", "en", "Project description"),
        ("Audio worklet processes one hundred twenty eight sample frames at sixteen kilohertz.", "en", "Technical dictation"),
        ("Transaction ID TXN-94825 confirmed on November fourth twenty twenty six.", "en", "Alphanumeric dictation"),
        ("Please verify the model weights in the docs directory.", "en", "Command dictation"),
        ("A quick brown fox jumps over the lazy dog.", "en", "Full alphabet pangram"),
        ("A", "en", "Single uppercase letter"),
        ("z", "en", "Single lowercase letter"),
        ("M", "en", "Single middle letter"),
        ("Model v1.0.0 released with 99.9% accuracy!", "en", "English with numbers and punctuation"),
        ("Good morning! How are you doing today?", "en", "Conversational English with ! and ?"),
    ]
    test_cases.extend(english_sentences)

    # Category 5: Mixed strings (Majority rules)
    mixed_strings = [
        ("This is Indian English with a little Sanskrit: नमः", "en", "English majority (41 en vs 3 sa)"),
        ("संस्कृत भाषायां speech recognition अतीव रोचकमस्ति", "sa", "Devanagari majority (32 sa vs 17 en)"),
        ("संस्कृतम् مرحبا بكم", "sa", "Devanagari with uncounted Arabic"),
        ("ಕನ್ನಡ ಸಾಹಿತ್ಯ Привет мир", "kn", "Kannada with uncounted Russian"),
        ("தமிழ் ஒரு தொன்மையான மொழி Hello", "ta", "Tamil majority (25 ta vs 5 en)"),
    ]
    test_cases.extend(mixed_strings)

    # Evaluate all test cases in Python
    failures_py = []
    py_results = []
    for text, expected, desc in test_cases:
        actual = detect_script(text)
        py_results.append(actual)
        if actual != expected:
            failures_py.append((desc, text, expected, actual))

    # Evaluate all test cases in Node.js / TypeScript
    texts_json = json.dumps([tc[0] for tc in test_cases])
    js_code = f"""
    import {{ detectScript }} from "./dist/index.mjs";
    const inputs = {texts_json};
    const results = inputs.map(t => detectScript(t));
    console.log(JSON.stringify(results));
    """
    js_raw = run_node_eval(js_code)
    js_results = json.loads(js_raw)

    failures_js = []
    parity_mismatches = []
    for idx, ((text, expected, desc), py_act, js_act) in enumerate(zip(test_cases, py_results, js_results)):
        if js_act != expected:
            failures_js.append((desc, text, expected, js_act))
        if py_act != js_act:
            parity_mismatches.append((desc, text, py_act, js_act))

    total = len(test_cases)
    print(f"Total test cases evaluated: {total}")
    print(f"Python failures: {len(failures_py)} / {total}")
    print(f"Node.js failures: {len(failures_js)} / {total}")
    print(f"Cross-runtime parity mismatches: {len(parity_mismatches)} / {total}")

    if failures_py:
        print("\nPYTHON FAILURES:")
        for desc, text, exp, act in failures_py:
            print(f"  [{desc}] Input: {text!r} -> Expected: {exp!r}, Got: {act!r}")

    if failures_js:
        print("\nNODE.JS FAILURES:")
        for desc, text, exp, act in failures_js:
            print(f"  [{desc}] Input: {text!r} -> Expected: {exp!r}, Got: {act!r}")

    if parity_mismatches:
        print("\nPARITY MISMATCHES:")
        for desc, text, py_act, js_act in parity_mismatches:
            print(f"  [{desc}] Input: {text!r} -> Python: {py_act!r} != Node: {js_act!r}")

    assert not failures_py, f"Python had {len(failures_py)} failures"
    assert not failures_js, f"Node.js had {len(failures_js)} failures"
    assert not parity_mismatches, f"Cross-runtime parity had {len(parity_mismatches)} mismatches"
    print(">>> SCRIPT DETECTION STRESS: 100% PASS (Python + Node.js 100% Parity) <<<\n")


# ==============================================================================
# 2. SANSKRIT ROMAN IAST ADVERSARIAL STRESS TEST
# ==============================================================================

def test_sanskrit_iast_stress():
    print("=" * 70)
    print("RUNNING ADVERSARIAL STRESS: Sanskrit Roman IAST Transliteration")
    print("=" * 70)

    test_inputs = []

    # 1. Pitch accents following Ayogavāhas
    ayogavaha_cases = [
        # Anusvara
        "अं॑", "अं॒", "अं॒॑", "अं॒॑",
        "सं॑", "सं॒", "तं॑", "तं॒",
        "मर्त्यं॑", "वरेण्यं॒", "सवि॒तुर्वरे॑ण्यं॒",
        "अहं॑", "अहं॒", "तत्रत्यानां॑", "तत्रत्यानां॒",
        # Visarga
        "अः॑", "अः॒", "अः॒॑", "अः॒॑",
        "स्वः॑", "भूर्भुवः॒", "नः॑", "सवि॒तुः॑",
        "शान्तिः॑", "शान्तिः॒", "दुःखं॑", "दुःखं॒",
        # Candrabindu / Anunasika
        "हँ॑", "हँ॒", "हँ॒॑", "हँ॒॑",
        "सँ॑", "सँ॒",
        "ईशा वास्यमिदँ॑", "ईशा वास्यमिदँ॒",
    ]
    test_inputs.extend(ayogavaha_cases)

    # 2. Standalone / Orphan Vedic Accents
    orphan_cases = [
        "\u0951",  # Udatta alone
        "\u0952",  # Anudatta alone
        "\u0951\u0951",
        "\u0952\u0952",
        "\u0951\u0952",
        "\u0952\u0951",
        " ॑ ",
        " ॒ ",
        " ॑ ॒ ॑ ",
        "नमस्ते ॑ अस्तु ॒ भगवन्",
        # Following virama (halanta)
        "क्॑", "त्॒", "न्॑", "र्॑", "ष्॒",
        "पश्यन्॑",
        "विद्वान्॑",
        "जगत्॒",
        "तस्मात्॑",
        # Following numerals
        "१॑", "२॒", "१०॑",
        # Following avagraha
        "ऽ॑", "ऽ॒", "सोऽ॑हम्", "सोऽ॒हम्",
        # Following dandas
        "।॑", "॥॒",
    ]
    test_inputs.extend(orphan_cases)

    # 3. Combinatorial sweep:
    # 14 vowels x 2 accents
    for v in VOWEL_MAP.keys():
        test_inputs.append(v + "\u0951")
        test_inputs.append(v + "\u0952")
        test_inputs.append(v + "\u0951\u0952")

    # 35 consonants x inherent 'a' x 2 accents
    for c in CONSONANT_MAP.keys():
        test_inputs.append(c + "\u0951")
        test_inputs.append(c + "\u0952")
        test_inputs.append(c + "\u0951\u0952")

    # 35 consonants x 12 matras x 2 accents = 840 combinations
    for c in CONSONANT_MAP.keys():
        for m in MATRA_MAP.keys():
            test_inputs.append(c + m + "\u0951")
            test_inputs.append(c + m + "\u0952")

    # 4. Authentic Vedic Hymns with Pitch Accents
    vedic_hymns = [
        # Rigveda 1.1.1
        "अ॒ग्निमी॑ळे पु॒रोहि॑तं य॒ज्ञस्य॑ दे॒वमृ॒त्विज॑म् । हो॑ता॑रं रत्न॒धात॑मम् ॥",
        # Rigveda 1.1.2
        "अ॒ग्निः पूर्वे॑भि॒रृषि॑भि॒रीड्यो॒ नूत॑नैरु॒त । स दे॒वाँ एह व॑क्षति ॥",
        # Rigveda 1.1.3
        "अ॒ग्निना॑ र॒यिम॑श्नव॒त्पोष॑मे॒व दि॒वेदि॑वे । य॒शसं॑ वी॒रव॑त्तमम् ॥",
        # Gayatri Mantra
        "ॐ भूर्भुवः॒ स्वः॑ । तत्स॑वि॒तुर्वरे॑ण्यं॒ भर्गो॑ दे॒वस्य॑ धीमहि । धियो॒ यो नः॑ प्रचो॒दया॑त् ॥",
        # Rigveda 1.35.2 (Savitr Hymn)
        "आ कृ॒ष्णेन॒ रज॑सा॒ वर्त॑मानो निवे॒शय॑न्न॒मृतं॒ मर्त्यं॑ च । हिर॒ण्यये॑न सवि॒ता रथे॑ना दे॒वो या॑ति॒ भुव॑नानि॒ पश्य॑न् ॥",
        # Rigveda 10.90.1 (Purusha Sukta)
        "स॒हस्र॑शीर्षा॒ पुरु॑षः सहस्रा॒क्षः स॒हस्र॑पात् । स भूमिं॑ वि॒श्वतो॑ वृ॒त्वात्य॑तिष्ठद्दशांगु॒लम् ॥",
        # Rigveda 10.90.2
        "पुरु॑ष ए॒वेदं सर्वं॒ यद्भू॒तं यच्च॒ भव्य॑म् । उ॒तामृ॑त॒त्वस्येशा॑नो॒ यदन्ने॑नाति॒रोह॑ति ॥",
        # Rigveda 10.129.1 (Nasadiya Sukta)
        "नास॑दासी॒न्नो सदा॑सीत्त॒दानीं॒ नासी॒द्रजो॒ नो व्यो॑मा प॒रो यत् । किमाव॑रीवः॒ कुह॒ कस्य॒ शर्म॒न्नम्भः॒ किमा॑सी॒द्गह॑नं गभी॒रम् ॥",
        # Rigveda 1.164.39 (Asya Vamasya)
        "ऋचो॑ अ॒क्षरे॑ पर॒मे व्यो॑म॒न्यस्मि॑न्दे॒वा अधि॒ विश्वे॑ निषे॒दुः । यस्तन्न वेद॒ किमृ॒चा क॑रिष्यति॒ य इत्तद्वि॒दुस्त इ॒मे समा॑सते ॥",
        # Taittiriya Samhita 1.1.1 (Krishna Yajurveda)
        "इ॒षे त्वो॒र्जे त्वा॑ वा॒यव॑ स्थ दे॒वो वः॑ सवि॒ता प्रार्प॑यतु॒ श्रेष्ठ॑तमाय॒ कर्म॑ण॒ आप्या॑यध्वमघ्निया॒ इन्द्रा॑य भा॒गं प्र॒जाव॑तीरनमी॒वा अ॑य॒क्ष्मा मा व॑ स्ते॒न ई॑शत॒ माघशं॑सो ध्रु॒वा अ॒स्मिन्गोप॑तौ स्यात ब॒ह्वीर्यज॑मानस्य प॒शून्पा॑हि ॥",
        # Shukla Yajurveda 1.1
        "इ॒षे त्वो॒र्जे त्वा॑ वा॒यव॑ स्थ दे॒वो वः॑ सवि॒ता प्रार्प॑यतु॒ श्रेष्ठ॑तमाय॒ कर्म॑णे ॥",
        # Mahamrityunjaya Mantra (Rigveda 7.59.12)
        "त्र्य॑म्बकं यजामहे सुग॒न्धिं पु॑ष्टि॒वर्ध॑नम् । उ॒र्वा॒रु॒कमि॑व॒ बन्ध॑नान्मृ॒त्योर्मु॑क्षीय॒ माऽमृता॑त् ॥",
    ]
    test_inputs.extend(vedic_hymns)

    print(f"Total IAST test cases to evaluate: {len(test_inputs)}")

    # 1. Evaluate Python IAST
    py_outputs = []
    py_leakage_cases = []
    for text in test_inputs:
        out = devanagari_to_iast(text)
        py_outputs.append(out)

        # Check for Devanagari pitch accent leakage
        if "\u0951" in out or "\u0952" in out:
            py_leakage_cases.append((text, out, "Udatta/Anudatta leaked"))

        # Verify Unicode NFC normalization
        assert unicodedata.is_normalized("NFC", out), f"Python output not NFC: {out!r}"

    # 2. Evaluate Node.js IAST in chunks to avoid command-line length limits
    CHUNK_SIZE = 250
    js_outputs = []
    for i in range(0, len(test_inputs), CHUNK_SIZE):
        chunk = test_inputs[i:i + CHUNK_SIZE]
        texts_json = json.dumps(chunk)
        js_code = f"""
        import {{ devanagariToIast }} from "./dist/index.mjs";
        const texts = {texts_json};
        const results = texts.map(t => devanagariToIast(t));
        console.log(JSON.stringify(results));
        """
        js_raw = run_node_eval(js_code)
        js_chunk_res = json.loads(js_raw)
        js_outputs.extend(js_chunk_res)

    js_leakage_cases = []
    parity_failures = []
    for idx, (inp, py_out, js_out) in enumerate(zip(test_inputs, py_outputs, js_outputs)):
        if "\u0951" in js_out or "\u0952" in js_out:
            js_leakage_cases.append((inp, js_out, "Udatta/Anudatta leaked in JS"))

        if not unicodedata.is_normalized("NFC", js_out):
            parity_failures.append((idx, inp, "JS output not NFC", py_out, js_out))

        if py_out != js_out:
            parity_failures.append((idx, inp, "String mismatch", py_out, js_out))

        # Check UTF-8 byte identity
        if py_out.encode("utf-8") != js_out.encode("utf-8"):
            parity_failures.append((idx, inp, "UTF-8 byte mismatch", py_out, js_out))

    total = len(test_inputs)
    print(f"Total IAST test cases evaluated: {total}")
    print(f"Python Devanagari accent leakage cases: {len(py_leakage_cases)} / {total}")
    print(f"Node.js Devanagari accent leakage cases: {len(js_leakage_cases)} / {total}")
    print(f"Cross-runtime parity failures: {len(parity_failures)} / {total}")

    if py_leakage_cases:
        print("\nPYTHON LEAKAGE EXAMPLES:")
        for inp, out, reason in py_leakage_cases[:5]:
            print(f"  Input: {inp!r} -> Output: {out!r} ({reason})")

    if js_leakage_cases:
        print("\nNODE.JS LEAKAGE EXAMPLES:")
        for inp, out, reason in js_leakage_cases[:5]:
            print(f"  Input: {inp!r} -> Output: {out!r} ({reason})")

    if parity_failures:
        print("\nPARITY FAILURE EXAMPLES:")
        for idx, inp, reason, py_out, js_out in parity_failures[:5]:
            print(f"  Index {idx}: Input: {inp!r} -> Python: {py_out!r} != Node: {js_out!r} ({reason})")

    assert not py_leakage_cases, f"Python had {len(py_leakage_cases)} accent leakage cases"
    assert not js_leakage_cases, f"Node.js had {len(js_leakage_cases)} accent leakage cases"
    assert not parity_failures, f"Cross-runtime parity had {len(parity_failures)} failures"
    print(">>> SANSKRIT IAST STRESS: 100% PASS (Zero Leakage, 100% Cross-Runtime Parity) <<<\n")


if __name__ == "__main__":
    test_script_detection_stress()
    test_sanskrit_iast_stress()
    print("ALL ADVERSARIAL STRESS HARNESSES EXECUTED AND PASSED SUCCESSFULLY!")
