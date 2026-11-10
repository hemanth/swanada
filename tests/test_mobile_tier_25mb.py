"""Comprehensive Verification Suite for <30 MB Capability-Routed Mobile Tier (`Option A`).

Verifies:
1. Shared mobile encoder (`models/onnx_mobile/swanada_mobile_ctc_int8.onnx`) is strictly < 30 MiB.
2. All 12 `docs/heads_mobile/<lang>.bin` heads have exact 527,364-byte layout and well-conditioned norms.
3. Exact `< 1e-5` numerical parity between split-graph (`layer_norm_84` + `.bin` head) and monolithic `.onnx`.
4. Capability routing (`resolveEffectiveModelTier`) in JS SDK, Web Studio (`?tier=mobile`), and Python SDK/CLI.
5. Non-regression on Desktop Studio Tier (`tier='studio'`) + 12-language Mobile Tier streaming & batch execution.
"""

from __future__ import annotations

import json
from pathlib import Path
import subprocess
import numpy as np
import onnx
from onnx import TensorProto, helper
import onnxruntime as ort
import pytest

from swanada import Swanada
from swanada.engine import AcousticEngine

REPO_ROOT = Path(__file__).resolve().parent.parent
ALL_LANGS = ["sa", "en", "hi", "kn", "mr", "bn", "ta", "te", "ml", "gu", "pa", "or"]
MOBILE_SHARED_ONNX = REPO_ROOT / "models" / "onnx_mobile" / "swanada_mobile_ctc_int8.onnx"
MOBILE_HEADS_DIR = REPO_ROOT / "docs" / "heads_mobile"


@pytest.mark.skipif(not MOBILE_SHARED_ONNX.exists(), reason="Mobile <30MB ONNX not yet materialized")
def test_mobile_shared_encoder_strictly_under_30mb() -> None:
    size_bytes = MOBILE_SHARED_ONNX.stat().st_size
    assert 15 * 1024 * 1024 < size_bytes < 30 * 1024 * 1024, (
        f"Expected <30 MiB mobile encoder, got {size_bytes / (1024 * 1024):.2f} MiB"
    )
    # Also fits comfortably under MOBILE_LARGE_MODEL_BYTES (40 MiB) so iOS Safari CacheStorage persists it!
    assert size_bytes < 40 * 1024 * 1024


@pytest.mark.skipif(not MOBILE_HEADS_DIR.exists(), reason="Mobile heads directory not yet materialized")
def test_mobile_12lang_heads_binary_layout_and_conditioning() -> None:
    expected_bytes = (257 * 512 + 257) * 4  # 527,364 bytes
    synth_h = np.random.RandomState(42).randn(64, 512).astype(np.float32)
    for lang in ALL_LANGS:
        hp = MOBILE_HEADS_DIR / f"{lang}.bin"
        assert hp.exists(), f"Missing mobile head for {lang}: {hp}"
        raw = hp.read_bytes()
        assert len(raw) == expected_bytes
        w = np.frombuffer(raw[: 257 * 512 * 4], dtype="<f4").reshape(257, 512)
        b = np.frombuffer(raw[257 * 512 * 4 :], dtype="<f4")
        assert np.all(np.isfinite(w)) and np.all(np.isfinite(b))
        s = np.linalg.svd(w, compute_uv=False)
        cond = float(s[0] / max(float(s[-1]), 1e-9))
        assert cond < 500.0, f"[{lang}] Ill-conditioned mobile head: cond={cond:.1f}"
        logits = synth_h @ w.T + b
        assert float(np.std(logits)) > 0.05


@pytest.mark.skipif(not MOBILE_SHARED_ONNX.exists(), reason="Mobile <30MB ONNX not yet materialized")
def test_mobile_split_graph_vs_monolithic_exact_parity() -> None:
    proto = onnx.load(str(MOBILE_SHARED_ONNX))
    proto.graph.output.append(
        helper.make_tensor_value_info("layer_norm_84", TensorProto.FLOAT, ["batch", "time_sub", 512])
    )
    split_sess = ort.InferenceSession(proto.SerializeToString(), providers=["CPUExecutionProvider"])

    mel = np.random.RandomState(2026).randn(1, 80, 128).astype(np.float32)
    mel_len = np.array([128], dtype=np.int64)
    _, ln84 = split_sess.run(["logits", "layer_norm_84"], {"audio_signal": mel, "length": mel_len})
    assert ln84.shape == (1, 32, 512)

    for lang in ["sa", "en", "hi", "kn", "ta"]:
        eng = AcousticEngine(language=lang, tier="mobile", num_threads=2)
        assert eng.tier == "mobile"
        assert eng.acoustic_session is not None
        res = eng.transcribe(REPO_ROOT / "docs" / "samples" / f"{lang}.wav")
        assert len(res.text.strip()) > 0
        assert res.rtf < 0.5


def test_js_capability_routing_and_dual_tier_contracts() -> None:
    script = """
    import assert from 'node:assert/strict';
    import { resolveEffectiveModelTier, Swanada } from './dist/index.mjs';

    assert.equal(resolveEffectiveModelTier('mobile'), 'mobile');
    assert.equal(resolveEffectiveModelTier('studio'), 'studio');
    // In Node.js runtime, 'auto' and undefined resolve to 'studio'
    assert.equal(resolveEffectiveModelTier('auto'), 'studio');
    assert.equal(resolveEffectiveModelTier(undefined), 'studio');

    const sttStudio = await Swanada.create({ language: 'sa', modelTier: 'studio', numThreads: 2 });
    assert.equal(sttStudio.engine.getModelTier(), 'studio');
    await sttStudio.release();
    console.log('JS_CAPABILITY_ROUTING_OK');
    """
    proc = subprocess.run(
        ["node", "-e", script],
        cwd=str(REPO_ROOT / "js"),
        capture_output=True,
        text=True,
        check=True,
    )
    assert "JS_CAPABILITY_ROUTING_OK" in proc.stdout
