"""Milestone 5 Gate Verification: Adversarial Multi-Language Transcription Suite.

Validates transcription accuracy, script detection, and acoustic model integrity
across all 12 supported languages: sa, en, hi, kn, mr, bn, ta, te, ml, gu, pa, or.
Strictly zero first-person pronouns in comments, code, and docstrings.
"""

import json
from pathlib import Path
import numpy as np
import onnx
from onnx import numpy_helper
import pytest

from swanada import Swanada, load_audio
from swanada.vocab import detect_script, REGISTRY

REPO_ROOT = Path(__file__).resolve().parents[1]
DOCS_SAMPLES = REPO_ROOT / "docs" / "samples"
BENCH_JSONL = REPO_ROOT / "bench" / "test_speech_suite.jsonl"
MODELS_ONNX = REPO_ROOT / "models" / "onnx"

SUPPORTED_LANGUAGES = [
    "sa", "en", "hi", "kn", "mr", "bn",
    "ta", "te", "ml", "gu", "pa", "or"
]

EXPECTED_SCRIPTS = {
    "sa": "Devanagari",
    "en": "Latin",
    "hi": "Devanagari",
    "kn": "Kannada",
    "mr": "Devanagari",
    "bn": "Bengali",
    "ta": "Tamil",
    "te": "Telugu",
    "ml": "Malayalam",
    "gu": "Gujarati",
    "pa": "Gurmukhi",
    "or": "Odia",
}


def compute_levenshtein(s1: str, s2: str) -> int:
    """Computes Levenshtein edit distance between two sequences."""
    n1, n2 = len(s1), len(s2)
    dp = [[0] * (n2 + 1) for _ in range(n1 + 1)]
    for idx1 in range(n1 + 1):
        dp[idx1][0] = idx1
    for idx2 in range(n2 + 1):
        dp[0][idx2] = idx2
    for idx1 in range(1, n1 + 1):
        for idx2 in range(1, n2 + 1):
            cost = 0 if s1[idx1 - 1] == s2[idx2 - 1] else 1
            dp[idx1][idx2] = min(dp[idx1 - 1][idx2] + 1, dp[idx1][idx2 - 1] + 1, dp[idx1 - 1][idx2 - 1] + cost)
    return dp[n1][n2]


def test_acoustic_head_weights_norm_non_random() -> None:
    """Verifies that all 12 CTC projection heads have trained weights (Frobenius norm > 10.0)."""
    for lang in SUPPORTED_LANGUAGES:
        head_path = MODELS_ONNX / "heads" / f"head_{lang}.onnx"
        if not head_path.exists():
            head_path = MODELS_ONNX / f"swanada_{lang}_ctc_int8.onnx"
        assert head_path.exists(), f"Model file missing for language {lang}: {head_path}"

        model = onnx.load(str(head_path))
        tensors = []
        for init in model.graph.initializer:
            arr = numpy_helper.to_array(init)
            tensors.append(arr)

        assert len(tensors) > 0, f"No initializers found in {head_path}"
        max_norm = max(float(np.linalg.norm(t)) for t in tensors)
        print(f"[{lang}] Model max tensor Frobenius norm: {max_norm:.3f}")
        assert max_norm > 10.0, (
            f"Language [{lang}] has suspiciously low weight norm ({max_norm:.3f} <= 10.0), "
            "indicating untrained random initialization."
        )


def test_docs_samples_transcription_across_all_12_languages() -> None:
    """Verifies that real speech WAVs in docs/samples/ transcribe to non-empty text across all 12 languages."""
    for lang in SUPPORTED_LANGUAGES:
        sample_path = DOCS_SAMPLES / f"{lang}.wav"
        assert sample_path.exists(), f"Sample audio missing for language {lang}: {sample_path}"

        stt = Swanada(language=lang)
        res = stt.transcribe(sample_path)

        print(f"[{lang}] docs/samples text: '{res.text}' | Duration: {res.duration_ms:.1f}ms | RTF: {res.rtf:.4f}")

        assert len(res.text.strip()) > 0, f"Transcription output for {lang} is empty string"
        assert res.duration_ms > 500.0, f"Audio duration too short for {lang}: {res.duration_ms}ms"
        assert res.rtf < 1.0, f"Real-Time Factor exceeds 1.0 for {lang}: {res.rtf}"

        detected_lang = detect_script(res.text)
        assert detected_lang is not None, f"Could not detect script from '{res.text}' for language {lang}"
        detected_script = REGISTRY[detected_lang].script
        expected_script = REGISTRY[lang].script
        assert detected_script == expected_script, (
            f"Script mismatch for language [{lang}]: expected {expected_script}, detected {detected_script} ({detected_lang}) in '{res.text}'"
        )

        if lang == "sa":
            iast = Swanada.transliterate_iast(res.text)
            assert len(iast.strip()) > 0, "IAST transliteration for Sanskrit is empty"
            print(f"[sa] IAST: '{iast}'")


def test_held_out_speech_suite_multi_language_accuracy() -> None:
    """Evaluates transcription accuracy against held-out speech suite in bench/test_speech_suite.jsonl."""
    assert BENCH_JSONL.exists(), f"Benchmark suite missing: {BENCH_JSONL}"

    items_by_lang: dict[str, list[dict]] = {lang: [] for lang in SUPPORTED_LANGUAGES}
    with open(BENCH_JSONL, "r", encoding="utf-8") as f:
        for line in f:
            item = json.loads(line)
            l = item.get("lang")
            if l in items_by_lang:
                items_by_lang[l].append(item)

    for lang in SUPPORTED_LANGUAGES:
        assert len(items_by_lang[lang]) >= 10, f"Insufficient benchmark items for {lang}"

    # Evaluate 2 representative utterances per language (24 utterances total)
    for lang in SUPPORTED_LANGUAGES:
        stt = Swanada(language=lang)
        selected = items_by_lang[lang][:2]
        for utt in selected:
            wav_path = REPO_ROOT / utt["wav_path"]
            assert wav_path.exists(), f"WAV file not found: {wav_path}"

            ref_text = utt["text"].strip()
            res = stt.transcribe(wav_path)
            hyp_text = res.text.strip()

            assert len(hyp_text) > 0, f"Empty transcription for {utt['utt_id']} ({lang})"

            dist = compute_levenshtein(ref_text, hyp_text)
            cer = dist / max(1, len(ref_text))

            print(f"[{lang}] {utt['utt_id']}: Ref='{ref_text[:30]}...', Hyp='{hyp_text[:30]}...', CER={cer:.2%}")
            # Ensure model produces intelligible text with CER < 0.60
            assert cer < 0.60, f"CER too high ({cer:.2%}) for {utt['utt_id']} ({lang})"
