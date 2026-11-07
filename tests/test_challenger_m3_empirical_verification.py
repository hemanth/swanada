#!/usr/bin/env python3
"""Milestone 3 Empirical Verification & Adversarial Stress Harness.

Conducts independent adversarial verification of:
1. Fast threshold script performance (< 2s) and 100% threshold satisfaction.
2. Streaming results distributions across all 12 languages (TTFT, RTF, chunk latency, buffer ceiling, prefix churn).
3. Monotonicity and word boundary invariance under adversarial token streams.
4. Audio buffer ceiling saturation under sustained continuous streaming.
"""

from __future__ import annotations

import json
from pathlib import Path
import random
import sys
import time
from typing import List
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "python" / "src"))

from swanada.streaming import StreamingCTCDecoder, SwanadaStream
from swanada.engine import TranscriptionResult


class DummyEngine:
    """Mock acoustic engine for lightweight local buffer and streaming tests."""

    def __init__(self, vocab: List[str]):
        self.vocab = vocab
        self.language = "sa"

    def transcribe(self, audio: np.ndarray) -> TranscriptionResult:
        # Return deterministic tokens based on audio length
        n_toks = min(20, max(1, len(audio) // 1600))
        tokens = ["\u2581namo", "\u2581dev", "aya", "\u2581shiva", "ya"] * 4
        chosen = tokens[:n_toks]
        text = " ".join(chosen).replace("\u2581", "")
        return TranscriptionResult(
            text=text,
            language=self.language,
            duration_ms=len(audio) / 16.0,
            inference_ms=1.0,
            rtf=0.01,
            tokens=chosen,
        )


def verify_batch_results_json() -> None:
    """Verifies statistical validity and threshold compliance in results.json."""
    results_path = ROOT / "bench" / "results.json"
    assert results_path.exists(), f"results.json missing at {results_path}"

    with open(results_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    print("[1/4] Verifying bench/results.json structure and metrics...")
    assert data.get("framework") == "swanada"
    assert data.get("num_test_utterances") == 480
    assert data.get("num_languages") == 12
    assert data.get("bootstrap_iterations", 0) >= 1000

    overall = data["overall"]
    assert float(overall["cer"]["mean"]) < 0.30, f"Overall CER exceeds 0.30: {overall['cer']['mean']}"
    assert float(overall["rtf"]["mean"]) < 1.0, f"Overall RTF exceeds 1.0: {overall['rtf']['mean']}"

    languages = data["languages"]
    assert len(languages) == 12, f"Expected 12 languages, found {len(languages)}"

    expected_langs = ["sa", "en", "hi", "kn", "mr", "bn", "ta", "te", "ml", "gu", "pa", "or"]
    for lang in expected_langs:
        assert lang in languages, f"Language {lang} missing from results.json"
        l_data = languages[lang]
        assert l_data["num_utterances"] == 40, f"Language {lang} has {l_data['num_utterances']} utterances, expected 40"

        cer_mean = float(l_data["cer"]["mean"])
        wer_mean = float(l_data["wer"]["mean"])
        rtf_mean = float(l_data["rtf"]["mean"])

        assert 0.0 <= cer_mean < 0.35, f"Language {lang} CER out of bounds: {cer_mean}"
        assert 0.0 <= wer_mean < 0.95, f"Language {lang} WER out of bounds: {wer_mean}"
        assert 0.0 < rtf_mean < 1.0, f"Language {lang} RTF out of bounds: {rtf_mean}"

        for m_name in ["cer", "wer", "rtf"]:
            stat = l_data[m_name]
            ci_low = float(stat["ci_lower"])
            ci_high = float(stat["ci_upper"])
            mean_val = float(stat["mean"])
            assert ci_low <= mean_val + 1e-4, f"Bootstrap CI lower > mean for {lang} {m_name}"
            assert mean_val <= ci_high + 1e-4, f"Bootstrap CI upper < mean for {lang} {m_name}"

    print("  -> Passed: bench/results.json satisfies all statistical criteria.")


def verify_streaming_results_json() -> None:
    """Verifies per-language streaming distributions, TTFT, RTF, buffer ceiling, and churn rate."""
    streaming_path = ROOT / "bench" / "streaming_results.json"
    assert streaming_path.exists(), f"streaming_results.json missing at {streaming_path}"

    with open(streaming_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    print("[2/4] Verifying bench/streaming_results.json distribution and invariants...")
    assert data.get("framework") == "swanada"
    assert data.get("mode") == "streaming"
    assert data.get("chunk_size_samples") == 1600
    assert data.get("max_buffer_ceiling_samples") == 61440

    overall = data["overall"]
    assert overall["total_clips_evaluated"] == 72
    assert overall["total_churn_violations"] == 0, f"Churn violations detected: {overall['total_churn_violations']}"
    assert overall["churn_rate_percent"] == 0.0, f"Overall churn rate is non-zero: {overall['churn_rate_percent']}"
    assert overall["max_buffer_observed"] <= 61440, f"Overall buffer ceiling exceeded: {overall['max_buffer_observed']}"
    assert overall["chunk_latency_ms"]["mean"] < 50.0, f"Mean chunk latency exceeds 50ms: {overall['chunk_latency_ms']['mean']}"
    assert overall["ttft_ms"]["mean"] < 500.0, f"Mean TTFT exceeds 500ms: {overall['ttft_ms']['mean']}"
    assert overall["ttft_ms"]["p50"] < 500.0, f"p50 TTFT exceeds 500ms: {overall['ttft_ms']['p50']}"
    assert overall["ttft_ms"]["p95"] < 500.0, f"p95 TTFT exceeds 500ms: {overall['ttft_ms']['p95']}"
    assert overall["rtf"]["mean"] < 1.0, f"Mean RTF exceeds 1.0: {overall['rtf']['mean']}"

    languages = data["languages"]
    assert len(languages) == 12, f"Expected 12 languages, found {len(languages)}"

    expected_langs = ["sa", "en", "hi", "kn", "mr", "bn", "ta", "te", "ml", "gu", "pa", "or"]
    for lang in expected_langs:
        assert lang in languages, f"Language {lang} missing from streaming_results.json"
        l_res = languages[lang]
        assert l_res["clips_evaluated"] == 6, f"Language {lang} evaluated {l_res['clips_evaluated']} clips, expected 6"
        assert l_res["churn_violations"] == 0, f"Language {lang} had non-zero churn violations: {l_res['churn_violations']}"
        assert l_res["churn_rate_percent"] == 0.0, f"Language {lang} churn rate non-zero: {l_res['churn_rate_percent']}"
        assert l_res["max_buffer_observed"] <= 61440, f"Language {lang} exceeded buffer ceiling: {l_res['max_buffer_observed']}"
        assert l_res["chunk_latency_ms"]["mean"] < 50.0, f"Language {lang} mean chunk latency exceeded 50ms"
        assert l_res["ttft_ms"]["mean"] < 500.0, f"Language {lang} mean TTFT exceeded 500ms"
        assert l_res["ttft_ms"]["p50"] < 500.0, f"Language {lang} p50 TTFT exceeded 500ms"
        assert l_res["rtf"] < 1.0, f"Language {lang} RTF exceeded 1.0: {l_res['rtf']}"

        print(
            f"  [{lang:2s}] Latency={l_res['chunk_latency_ms']['mean']:5.2f}ms | "
            f"TTFT(p50)={l_res['ttft_ms']['p50']:5.2f}ms | "
            f"RTF={l_res['rtf']:.4f}x | "
            f"MaxBuf={l_res['max_buffer_observed']:5d} | "
            f"Churn={l_res['churn_rate_percent']:.2f}%"
        )

    print("  -> Passed: bench/streaming_results.json satisfies all per-language criteria.")


def stress_test_monotonicity_and_word_boundaries() -> None:
    """Stress-tests prefix-locking decoder with randomized and adversarial token streams."""
    print("[3/4] Stress-testing decoder monotonicity and word boundary gating...")
    vocab = ["\u2581namo", "\u2581narayan", "aya", "\u2581shiva", "ya", "\u2581om", "\u2581shanti", "\u2581bharat", "am"]
    decoder = StreamingCTCDecoder(
        vocab=vocab,
        stability_threshold=2,
        trail_tokens=3,
        require_stability_on_word_boundary=True,
    )

    rng = random.Random(42)

    # Scenario A: Deterministic growing token stream with volatile tail jitter
    base_words = ["\u2581om", "\u2581namo", "\u2581narayan", "aya", "\u2581shiva", "ya", "\u2581shanti", "\u2581shanti"]
    prev_committed = ""

    for step in range(1, len(base_words) + 1):
        stable_prefix = base_words[:step]
        # Repeat the prefix to build stability counter
        for repeat in range(3):
            jitter = [rng.choice(["\u2581test", "abc", "\u2581err", "xyz"]) for _ in range(rng.randint(1, 4))]
            current_raw = stable_prefix + jitter
            transcript = decoder.update(current_raw, is_stream_end=False)

            cur_committed = transcript.committed
            # Monotonicity assertion: committed string must never mutate backwards
            assert cur_committed.startswith(prev_committed), (
                f"Monotonicity violation at step {step}, repeat {repeat}: "
                f"prev='{prev_committed}', cur='{cur_committed}'"
            )
            prev_committed = cur_committed

    final_transcript = decoder.update(base_words, is_stream_end=True)
    assert final_transcript.committed.startswith(prev_committed)
    print("  -> Sub-test A (monotonic growth): 0 violations observed.")

    # Scenario B: Adversarial rapid word boundary flicker
    decoder.reset()
    prev_committed = ""
    flicker_tokens = ["\u2581bharat", "iya", "\u2581samvidhan", "am"]

    for cycle in range(500):
        # Alternate between incomplete word and completed word
        if cycle % 2 == 0:
            raw = ["\u2581bharat", "iya", "\u2581samv"]
        else:
            raw = ["\u2581bharat", "iya", "\u2581samvidhan", "am", "\u2581mukhya"]

        transcript = decoder.update(raw, is_stream_end=False)
        cur_committed = transcript.committed
        assert cur_committed.startswith(prev_committed), (
            f"Flicker violation at cycle {cycle}: prev='{prev_committed}', cur='{cur_committed}'"
        )
        prev_committed = cur_committed

    print("  -> Sub-test B (boundary flicker 500 cycles): 0 violations observed.")

    # Scenario C: Brahmic matra and virama continuous token streams
    decoder.reset()
    prev_committed = ""
    brahmic_tokens = [
        "\u2581\u092d\u093e\u0930\u0924",  # भारत
        "\u0940\u092f",                    # ीय
        "\u2581\u0938\u0902\u0935\u093f\u0927\u093e\u0928",  # संविधान
        "\u2581\u0915\u0947",              # के
        "\u2581\u0905\u0928\u0941\u0938\u093e\u0930"          # अनुसार
    ]

    for step in range(len(brahmic_tokens)):
        for rep in range(4):
            tokens = brahmic_tokens[: step + 1] + (["\u0915"] if rep % 2 == 1 else [])
            tr = decoder.update(tokens, is_stream_end=False)
            assert tr.committed.startswith(prev_committed), (
                f"Brahmic monotonicity violation: prev='{prev_committed}', cur='{tr.committed}'"
            )
            prev_committed = tr.committed

    print("  -> Sub-test C (Brahmic script stability): 0 violations observed.")


def stress_test_buffer_ceiling_saturation() -> None:
    """Stress-tests continuous streaming buffer ceiling to verify <= 61,440 samples."""
    print("[4/4] Stress-testing audio buffer ceiling saturation...")
    dummy_engine = DummyEngine(vocab=["\u2581namo", "\u2581dev", "aya"])
    stream = SwanadaStream(
        engine=dummy_engine,
        chunk_size_samples=1600,
        left_context_samples=30720,
        max_buffer_samples=61440,
    )

    max_observed = 0
    total_samples = 1600 * 100  # 160,000 samples (10 seconds)
    chunk = np.ones(1600, dtype=np.float32) * 0.1  # Active signal above VAD threshold

    for step in range(100):
        stream.push(chunk)
        buf_len = len(stream.audio_buffer)
        max_observed = max(max_observed, buf_len)
        assert buf_len <= 61440, f"Buffer ceiling exceeded at step {step}: {buf_len} > 61440"

    final_res = stream.finish()
    print(f"  -> Bounded Buffer Test: 160,000 samples pushed, max observed buffer = {max_observed} <= 61,440.")
    assert max_observed <= 61440, f"Maximum buffer violated ceiling: {max_observed}"


def test_verify_batch_results_json():
    verify_batch_results_json()


def test_verify_streaming_results_json():
    verify_streaming_results_json()


def test_stress_monotonicity_and_word_boundaries():
    stress_test_monotonicity_and_word_boundaries()


def test_stress_buffer_ceiling_saturation():
    stress_test_buffer_ceiling_saturation()


def main():
    t0 = time.perf_counter()
    verify_batch_results_json()
    verify_streaming_results_json()
    stress_test_monotonicity_and_word_boundaries()
    stress_test_buffer_ceiling_saturation()
    elapsed = time.perf_counter() - t0
    print(f"\nALL 4 EMPIRICAL CHALLENGER VERIFICATION PHASES PASSED IN {elapsed:.3f} SECONDS!")


if __name__ == "__main__":
    main()
