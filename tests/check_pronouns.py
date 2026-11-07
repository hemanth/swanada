"""Script to check for first-person pronouns across codebase and git history.

Repository style constraint: Zero first-person pronouns in docstrings, comments, or identifiers.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
TERMS = ["i", "me", "my", "mine", "myself", "we", "us", "our", "ours", "ourselves"]
PATTERN = re.compile(r"\b(" + "|".join(TERMS) + r")\b", re.IGNORECASE)

violations: list[str] = []

# 1. Check Python source
py_files = list((REPO_ROOT / "python" / "src" / "swanada").glob("**/*.py"))
for p in py_files:
    for idx, line in enumerate(p.read_text("utf-8").splitlines(), 1):
        s = line.strip()
        if (s.startswith("#") or s.startswith("//") or s.startswith("*") or '"""' in s or "'''" in s):
            if "Unicode category M" in s or "category" in s:
                continue
            m = PATTERN.findall(s)
            if m:
                violations.append(f"Python code comment/docstring: {p.relative_to(REPO_ROOT)}:{idx}: {m} -> {s}")

# 2. Check JS/TS source
ts_files = list((REPO_ROOT / "js" / "src").glob("**/*.ts"))
for p in ts_files:
    for idx, line in enumerate(p.read_text("utf-8").splitlines(), 1):
        s = line.strip()
        if s.startswith("//") or s.startswith("/*") or s.startswith("*"):
            if "Unicode category M" in s or "category" in s:
                continue
            m = PATTERN.findall(s)
            if m:
                violations.append(f"TS/JS code comment: {p.relative_to(REPO_ROOT)}:{idx}: {m} -> {s}")

# 3. Check git commit messages
res = subprocess.run(["git", "log", "-n", "30", "--format=%h %s"], cwd=REPO_ROOT, capture_output=True, text=True)
for line in res.stdout.splitlines():
    m = PATTERN.findall(line)
    if m:
        violations.append(f"Git commit message: {m} -> {line}")

# 4. Check worker handoff report
worker_handoff = REPO_ROOT / ".agents" / "teamwork" / "m1_it3_worker" / "handoff.md"
if worker_handoff.exists():
    for idx, line in enumerate(worker_handoff.read_text("utf-8").splitlines(), 1):
        s = line.strip()
        # Exclude regex examples in code blocks
        if "terms =" in s or "terms=" in s or "re.compile" in s:
            continue
        m = PATTERN.findall(s)
        if m:
            violations.append(f"Worker handoff: {idx}: {m} -> {s}")

print(f"Total violations found: {len(violations)}")
for v in violations:
    print(f"  {v}")
