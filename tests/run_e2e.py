#!/usr/bin/env python3
"""Automated E2E Test Suite Runner for Swanada.

Executes the 4-tier opaque-box test suite under tests/e2e/, supporting
milestone filtering (-m m1, -m tier1), verbose reporting, and summary exit codes.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
E2E_DIR = REPO_ROOT / "tests" / "e2e"

# Search for suitable pytest executable
CANDIDATE_PYTESTS = [
    Path("/Users/lika/labs/sntts/.venv/bin/pytest"),
    REPO_ROOT / ".venv" / "bin" / "pytest",
    Path(sys.executable).parent / "pytest",
]


def find_pytest() -> str:
    for candidate in CANDIDATE_PYTESTS:
        if candidate.exists() and os.access(candidate, os.X_OK):
            return str(candidate)
    return "pytest"


def main() -> int:
    parser = argparse.ArgumentParser(description="Run Swanada 4-Tier E2E Test Suite")
    parser.add_argument("-m", "--mark", help="Filter by pytest marker (e.g. tier1, tier2, m1, m2)")
    parser.add_argument("-v", "--verbose", action="store_true", default=True, help="Verbose test execution")
    parser.add_argument("-k", "--keyword", help="Filter by test function keyword expression")
    parser.add_argument("pytest_args", nargs="*", help="Additional arguments forwarded to pytest")
    args = parser.parse_args()

    pytest_bin = find_pytest()
    cmd = [pytest_bin, str(E2E_DIR)]
    if args.verbose:
        cmd.append("-v")
    if args.mark:
        cmd.extend(["-m", args.mark])
    if args.keyword:
        cmd.extend(["-k", args.keyword])
    if args.pytest_args:
        cmd.extend(args.pytest_args)

    print(f"[swanada-test-runner] Executing: {' '.join(cmd)}")
    env = os.environ.copy()
    env["PYTHONPATH"] = f"{REPO_ROOT / 'python' / 'src'}:{REPO_ROOT}:{env.get('PYTHONPATH', '')}"

    result = subprocess.run(cmd, env=env, cwd=str(REPO_ROOT))
    return result.returncode


if __name__ == "__main__":
    sys.exit(main())
