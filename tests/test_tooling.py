"""Unit tests for Swanada developer tooling: HF publishing and GCP fine-tuning."""

import json
from pathlib import Path
import subprocess
import sys
import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from tools.publish_to_hf import (
    build_manifest,
    generate_model_card,
    sha256_file,
    LANGUAGE_REGISTRY,
)
from tools.gcp_finetune import (
    INSTANCE_NAME_PATTERN,
    PROTECTED_INSTANCES,
    METRICS_TAG,
)

MODELS_DIR = REPO_ROOT / "models"


def test_hf_manifest_builder() -> None:
    manifest = build_manifest(MODELS_DIR)
    assert manifest["version"] == "1.0.0"
    assert "preprocessor.onnx" in manifest["files"]
    assert "onnx/swanada_sa_ctc_int8.onnx" in manifest["files"]
    assert "vocabularies/sa_vocab.json" in manifest["files"]
    for path, meta in manifest["files"].items():
        assert meta["size_bytes"] > 0
        assert len(meta["sha256"]) == 64


def test_hf_model_card_generator() -> None:
    bench_file = REPO_ROOT / "bench" / "results.json"
    card = generate_model_card(MODELS_DIR, bench_file, "gnumanth/swanada")
    assert "pipeline_tag: automatic-speech-recognition" in card
    assert "library_name: onnx" in card
    for code, name, script, _, _ in LANGUAGE_REGISTRY:
        assert f"- {code}" in card
        assert name in card


def test_hf_publish_dry_run() -> None:
    cmd = [sys.executable, str(REPO_ROOT / "tools" / "publish_to_hf.py"), "--dry-run", "--models-dir", str(MODELS_DIR)]
    proc = subprocess.run(cmd, capture_output=True, text=True, cwd=str(REPO_ROOT))
    assert proc.returncode == 0
    assert "Dry-run completed successfully" in proc.stdout


def test_gcp_safety_invariants() -> None:
    assert "agy-remote" in PROTECTED_INSTANCES
    assert "ninada-istft-w4b" in PROTECTED_INSTANCES
    assert "piragi-airbench-gpu" in PROTECTED_INSTANCES

    # Valid name pattern: ^swanada-gpu-[0-9]{10}-[a-f0-9]{6}$
    valid_name = "swanada-gpu-1762326400-f4a2b1"
    assert INSTANCE_NAME_PATTERN.match(valid_name)

    # Invalid names must NOT match
    assert not INSTANCE_NAME_PATTERN.match("agy-remote")
    assert not INSTANCE_NAME_PATTERN.match("ninada-istft-w4b")
    assert not INSTANCE_NAME_PATTERN.match("swanada-gpu")
    assert not INSTANCE_NAME_PATTERN.match("swanada-gpu-12345")


def test_gcp_metrics_attribution_tag() -> None:
    assert METRICS_TAG == "datacloud.antigravity"


def test_gcp_finetune_dry_run() -> None:
    cmd = [sys.executable, str(REPO_ROOT / "tools" / "gcp_finetune.py"), "--dry-run", "--project=hemanth-hm", "--zone=us-central1-a"]
    proc = subprocess.run(cmd, capture_output=True, text=True, cwd=str(REPO_ROOT))
    assert proc.returncode == 0
    combined = proc.stdout + proc.stderr
    assert "Dry-run requested" in combined
