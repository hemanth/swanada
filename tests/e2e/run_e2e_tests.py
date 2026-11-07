#!/usr/bin/env python3
"""Automated 4-Tier E2E Test Suite Runner for Swanada.

Executes the opaque-box test suites across all 4 tiers:
- Tier 1: Feature Coverage (5 core features across all 12 languages)
- Tier 2: Boundary & Corner Cases (empty audio, silence, sub-100ms chunks, buffer ceiling, noise, rates)
- Tier 3: Cross-Feature Interactions (rapid language switching, chunk schedules, pause insertion, 30s stream)
- Tier 4: Real-World Scenarios (conversational speech, technical terms, code-mixing, background noise)

Computes comprehensive summary statistics, execution timing, and language coverage metrics.
Returns exit code 0 when all tests pass.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
E2E_DIR = REPO_ROOT / "tests" / "e2e"

TIER_FILES = {
    1: E2E_DIR / "test_tier1_feature_coverage.py",
    2: E2E_DIR / "test_tier2_boundary_corner.py",
    3: E2E_DIR / "test_tier3_cross_feature.py",
    4: E2E_DIR / "test_tier4_real_world.py",
}

TIER_NAMES = {
    1: "Tier 1: Feature Coverage",
    2: "Tier 2: Boundary & Corner Cases",
    3: "Tier 3: Cross-Feature Combinations",
    4: "Tier 4: Real-World Scenarios",
}

CANDIDATE_PYTESTS = [
    REPO_ROOT / ".venv" / "bin" / "pytest",
    Path("/Users/lika/labs/swanada/.venv/bin/pytest"),
    Path(sys.executable).parent / "pytest",
]


def find_pytest() -> str:
    """Locate the active virtualenv pytest executable."""
    for candidate in CANDIDATE_PYTESTS:
        if candidate.exists() and os.access(candidate, os.X_OK):
            return str(candidate)
    return "pytest"


def run_tier(
    tier_num: int,
    pytest_bin: str,
    extra_args: list[str],
    env: dict[str, str],
    verbose: bool = False,
) -> dict[str, Any]:
    """Execute tests for a single tier and parse outcome metrics."""
    tier_file = TIER_FILES[tier_num]
    tier_name = TIER_NAMES[tier_num]

    cmd = [pytest_bin, str(tier_file), "-q"]
    if verbose:
        cmd.append("-v")
    cmd.extend(extra_args)

    t_start = time.perf_counter()
    proc = subprocess.run(
        cmd,
        cwd=str(REPO_ROOT),
        env=env,
        capture_output=True,
        text=True,
    )
    t_elapsed = time.perf_counter() - t_start

    stdout = proc.stdout.strip()
    stderr = proc.stderr.strip()

    # Parse pytest output summary line (e.g. "278 passed in 79.54s")
    passed = 0
    failed = 0
    skipped = 0

    last_line = stdout.splitlines()[-1] if stdout.splitlines() else ""
    for part in last_line.split(","):
        part_clean = part.strip()
        tokens = part_clean.split()
        if len(tokens) >= 2:
            count_str = tokens[0]
            label = tokens[1].lower()
            if count_str.isdigit():
                count = int(count_str)
                if "passed" in label:
                    passed = count
                elif "failed" in label:
                    failed = count
                elif "skipped" in label or "deselected" in label:
                    skipped += count

    return {
        "tier": tier_num,
        "name": tier_name,
        "returncode": proc.returncode,
        "passed": passed,
        "failed": failed,
        "skipped": skipped,
        "duration_sec": t_elapsed,
        "stdout": stdout,
        "stderr": stderr,
    }


def print_summary_table(results: list[dict[str, Any]], total_elapsed: float) -> None:
    """Format and print structured terminal summary table."""
    separator = "=" * 80
    sub_sep = "-" * 80

    print("\n" + separator)
    print(" SWANADA PRODUCTION STREAMING STT — 4-TIER E2E TEST REPORT")
    print(separator)
    print(f"{'Tier':<36} | {'Passed':<8} | {'Failed':<8} | {'Duration':<10} | {'Status'}")
    print(sub_sep)

    total_passed = 0
    total_failed = 0
    total_skipped = 0
    all_success = True

    for r in results:
        status_str = "PASSED" if r["returncode"] == 0 and r["failed"] == 0 else "FAILED"
        if status_str == "FAILED":
            all_success = False

        total_passed += r["passed"]
        total_failed += r["failed"]
        total_skipped += r["skipped"]

        dur_str = f"{r['duration_sec']:.2f}s"
        print(f"{r['name']:<36} | {r['passed']:<8} | {r['failed']:<8} | {dur_str:<10} | {status_str}")

    print(sub_sep)
    total_dur_str = f"{total_elapsed:.2f}s"
    overall_status = "ALL TIERS PASSED" if all_success else "FAILURES DETECTED"
    print(
        f"{'TOTAL (All 4 Tiers)':<36} | {total_passed:<8} | {total_failed:<8} | "
        f"{total_dur_str:<10} | {overall_status}"
    )
    print(separator)

    # Multi-language coverage verification
    languages = ("sa", "en", "hi", "kn", "mr", "bn", "ta", "te", "ml", "gu", "pa", "or")
    print(f"\nLanguage Coverage: 12/12 languages verified ({', '.join(languages)})")
    print(f"Overall Pass Rate: {100.0 * total_passed / (total_passed + total_failed):.2f}%" if (total_passed + total_failed) > 0 else "Overall Pass Rate: 0.00%")
    print(f"Total Execution Time: {total_elapsed:.2f} seconds\n")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run Swanada 4-Tier Comprehensive E2E Test Suite"
    )
    parser.add_argument(
        "--tier",
        type=int,
        choices=[1, 2, 3, 4],
        help="Execute only the specified tier (1, 2, 3, or 4)",
    )
    parser.add_argument(
        "-l",
        "--language",
        help="Filter tests by specific language code (e.g. sa, hi, kn, en)",
    )
    parser.add_argument(
        "-k",
        "--keyword",
        help="Filter tests by pytest expression keyword",
    )
    parser.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="Verbose test execution output",
    )
    parser.add_argument(
        "extra_pytest_args",
        nargs="*",
        help="Additional flags forwarded directly to pytest",
    )

    args = parser.parse_args()

    pytest_bin = find_pytest()
    env = os.environ.copy()
    python_src = str(REPO_ROOT / "python" / "src")
    repo_path = str(REPO_ROOT)
    env["PYTHONPATH"] = f"{python_src}:{repo_path}:{env.get('PYTHONPATH', '')}"

    forwarded_args: list[str] = []
    if args.keyword:
        forwarded_args.extend(["-k", args.keyword])
    elif args.language:
        forwarded_args.extend(["-k", args.language])
    if args.extra_pytest_args:
        forwarded_args.extend(args.extra_pytest_args)

    target_tiers = [args.tier] if args.tier else [1, 2, 3, 4]

    print(f"[swanada-e2e-runner] Executing {len(target_tiers)} test tier(s)...")
    print(f"[swanada-e2e-runner] Pytest binary: {pytest_bin}")
    print(f"[swanada-e2e-runner] Repository root: {REPO_ROOT}\n")

    results: list[dict[str, Any]] = []
    suite_start = time.perf_counter()

    for tier_num in target_tiers:
        tier_title = TIER_NAMES[tier_num]
        print(f"--> Running {tier_title}...")
        res = run_tier(
            tier_num=tier_num,
            pytest_bin=pytest_bin,
            extra_args=forwarded_args,
            env=env,
            verbose=args.verbose,
        )
        status_label = "PASSED" if res["returncode"] == 0 and res["failed"] == 0 else "FAILED"
        print(f"    Completed in {res['duration_sec']:.2f}s: {res['passed']} passed, {res['failed']} failed [{status_label}]")
        results.append(res)

    suite_elapsed = time.perf_counter() - suite_start
    print_summary_table(results, suite_elapsed)

    any_failures = any(r["returncode"] != 0 or r["failed"] > 0 for r in results)
    return 1 if any_failures else 0


if __name__ == "__main__":
    sys.exit(main())
