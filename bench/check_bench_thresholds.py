#!/usr/bin/env python3
"""Threshold assertion script for Swanada empirical benchmarks."""

from __future__ import annotations

import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent


def main():
    results_path = ROOT / "bench" / "results.json"
    if not results_path.exists():
        print(f"Error: {results_path} not found. Run bench/benchmark_accuracy.py first.", file=sys.stderr)
        sys.exit(1)

    with open(results_path, "r", encoding="utf-8") as f:
        res = json.load(f)

    print("=== Swanada Benchmark Thresholds Verification ===")
    assert res.get("framework") == "swanada", f"Expected framework=swanada, got {res.get('framework')}"
    assert res.get("num_test_utterances") == 480, f"Expected 480 test utterances, got {res.get('num_test_utterances')}"
    assert res.get("num_languages") == 12, f"Expected 12 languages, got {res.get('num_languages')}"
    assert res.get("sample_rate_hz") == 16000, f"Expected 16000 Hz, got {res.get('sample_rate_hz')}"
    assert res.get("bootstrap_iterations", 0) >= 1000, f"Expected >= 1000 bootstrap iterations"

    overall = res["overall"]
    overall_rtf = float(overall["rtf"]["mean"])
    overall_cer = float(overall["cer"]["mean"])
    overall_wer = float(overall["wer"]["mean"])

    print(f"Overall Metrics: CER={overall_cer * 100:.2f}%, WER={overall_wer * 100:.2f}%, RTF={overall_rtf:.4f}x")
    assert overall_rtf < 1.0, f"Overall RTF {overall_rtf:.4f}x exceeds 1.0x"
    assert overall_cer < 0.30, f"Overall CER {overall_cer:.4f} exceeds 0.30"

    languages = res["languages"]
    assert len(languages) == 12, f"Expected 12 language evaluations, got {len(languages)}"

    for lang, metrics in languages.items():
        cer = float(metrics["cer"]["mean"])
        wer = float(metrics["wer"]["mean"])
        rtf = float(metrics["rtf"]["mean"])
        num_utt = metrics["num_utterances"]

        print(f"Language [{lang:2s}]: {num_utt} clips, CER={cer * 100:.2f}%, WER={wer * 100:.2f}%, RTF={rtf:.4f}x")
        assert num_utt == 40, f"Expected 40 utterances for {lang}, got {num_utt}"
        assert rtf < 1.0, f"RTF for {lang} {rtf:.4f}x exceeds 1.0x"
        assert cer < 0.35, f"CER for {lang} {cer:.4f} exceeds 0.35"
        assert wer < 0.95, f"WER for {lang} {wer:.4f} exceeds 0.95"

        # Check bootstrap bounds exist
        for metric_name in ["cer", "wer", "rtf"]:
            stat = metrics[metric_name]
            assert "ci_lower" in stat and "ci_upper" in stat, f"Missing bootstrap CI in {lang} {metric_name}"
            assert stat["ci_lower"] <= stat["mean"] <= stat["ci_upper"] or abs(stat["ci_lower"] - stat["mean"]) < 1e-4

    report_path = ROOT / "bench" / "ACCURACY_REPORT.md"
    assert report_path.exists(), f"{report_path} not found"

    print("\nALL SWANADA ACCURACY & LATENCY BENCHMARK THRESHOLDS SATISFIED!")


if __name__ == "__main__":
    main()
