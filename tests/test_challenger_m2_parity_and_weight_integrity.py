"""Empirical Numerical Parity and Weight Integrity Test Suite for Milestone 2.

Validates:
1. Binary projection head file integrity and exact size contract (527,364 bytes).
2. Weight sanity: absence of NaN, Inf, zero-variance columns, or dead logits across all 257 token positions.
3. Condition number, Frobenius norm, and bounded bias distributions.
4. Bit-exact parameter parity across binary heads (.bin), modular ONNX heads (head_*.onnx),
   and monolithic ONNX models (swanada_*_ctc_int8.onnx).
5. Numerical forward pass parity on synthetic Conformer hidden states:
   - Monolithic projection subgraph
   - Modular ONNX head
   - Pure NumPy float32 dot-product
   Thresholds: max absolute difference < 1e-5, 100% argmax equality.
6. Full end-to-end monolithic model forward pass verification with audio inputs.
7. Cross-runtime numerical parity between NumPy BLAS and JavaScript unrolled kernel.
"""

from __future__ import annotations

import json
from pathlib import Path
import subprocess
import numpy as np
import onnx
from onnx import helper, numpy_helper, TensorProto
import onnxruntime as ort
import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
DOCS_HEADS_DIR = REPO_ROOT / "docs" / "heads"
MODELS_ONNX_DIR = REPO_ROOT / "models" / "onnx"
HEADS_ONNX_DIR = MODELS_ONNX_DIR / "heads"
SAMPLES_DIR = REPO_ROOT / "docs" / "samples"

GAP_LANGUAGES = ("en", "kn", "ml", "gu", "or")
ALL_LANGUAGES = ("sa", "en", "hi", "kn", "mr", "bn", "ta", "te", "ml", "gu", "pa", "or")

EXPECTED_BIN_SIZE = 527364
NUM_CLASSES = 257
HIDDEN_DIM = 512


def load_binary_head(lang: str) -> tuple[np.ndarray, np.ndarray]:
    """Loads weight matrix [257, 512] and bias vector [257] from binary artifact."""
    bin_path = DOCS_HEADS_DIR / f"{lang}.bin"
    assert bin_path.exists(), f"Binary head file missing: {bin_path}"
    raw = bin_path.read_bytes()
    assert len(raw) == EXPECTED_BIN_SIZE, f"Unexpected size {len(raw)} for {bin_path}"
    weight = np.frombuffer(raw[: NUM_CLASSES * HIDDEN_DIM * 4], dtype="<f4").reshape(NUM_CLASSES, HIDDEN_DIM)
    bias = np.frombuffer(raw[NUM_CLASSES * HIDDEN_DIM * 4 :], dtype="<f4")
    return weight, bias


def load_onnx_head_params(lang: str) -> tuple[np.ndarray, np.ndarray]:
    """Loads weight matrix and bias vector from modular ONNX head."""
    onnx_path = HEADS_ONNX_DIR / f"head_{lang}.onnx"
    assert onnx_path.exists(), f"Modular ONNX head missing: {onnx_path}"
    model = onnx.load(str(onnx_path))
    inits = {init.name: numpy_helper.to_array(init) for init in model.graph.initializer}
    weight = inits["conv.weight"].squeeze(-1)
    bias = inits["conv.bias"]
    return weight, bias


def load_monolithic_head_params(lang: str) -> tuple[np.ndarray, np.ndarray]:
    """Loads weight matrix and bias vector from monolithic ONNX model."""
    mono_name = "sushrota_sanskrit_ctc_int8.onnx" if lang == "sa" else f"swanada_{lang}_ctc_int8.onnx"
    mono_path = MODELS_ONNX_DIR / mono_name
    assert mono_path.exists(), f"Monolithic ONNX model missing: {mono_path}"
    model = onnx.load(str(mono_path))
    inits = {init.name: numpy_helper.to_array(init) for init in model.graph.initializer if "ctc." in init.name}
    weight = inits["ctc.weight"].squeeze(-1)
    bias = inits["ctc.bias"]
    return weight, bias


# ==============================================================================
# Suite 1: Binary Head Artifact File Contract
# ==============================================================================

@pytest.mark.parametrize("lang", ALL_LANGUAGES)
def test_binary_head_file_contract(lang: str) -> None:
    """Verifies byte size and tensor dimensions across all languages."""
    bin_path = DOCS_HEADS_DIR / f"{lang}.bin"
    assert bin_path.exists(), f"Missing binary head for {lang}"
    size = bin_path.stat().st_size
    assert size == EXPECTED_BIN_SIZE, f"Binary head size {size} != {EXPECTED_BIN_SIZE} for {lang}"

    weight, bias = load_binary_head(lang)
    assert weight.shape == (NUM_CLASSES, HIDDEN_DIM)
    assert bias.shape == (NUM_CLASSES,)
    assert weight.dtype == np.float32
    assert bias.dtype == np.float32


# ==============================================================================
# Suite 2: Weight Sanity & Degradation Analysis
# ==============================================================================

@pytest.mark.parametrize("lang", GAP_LANGUAGES)
def test_weight_sanity_and_absence_of_degradation(lang: str) -> None:
    """Verifies absence of NaN, Inf, zero-variance columns, or dead logits."""
    weight, bias = load_binary_head(lang)

    # Absence of NaN and Inf
    assert not np.isnan(weight).any(), f"NaN detected in weight matrix for {lang}"
    assert not np.isnan(bias).any(), f"NaN detected in bias vector for {lang}"
    assert not np.isinf(weight).any(), f"Inf detected in weight matrix for {lang}"
    assert not np.isinf(bias).any(), f"Inf detected in bias vector for {lang}"

    # Frobenius norm sanity (> 10.0 threshold)
    frob_norm = float(np.linalg.norm(weight))
    assert frob_norm > 10.0, f"Frobenius norm {frob_norm:.2f} below threshold for {lang}"

    # Matrix condition number check (must be well-conditioned, kappa < 500)
    cond_num = float(np.linalg.cond(weight))
    assert cond_num < 500.0, f"Matrix condition number {cond_num:.2f} indicates ill-conditioning for {lang}"

    # Zero-variance column check across all 512 Conformer feature dimensions
    col_variances = np.var(weight, axis=0)
    zero_var_cols = np.where(col_variances < 1e-6)[0]
    assert len(zero_var_cols) == 0, f"Zero-variance columns found in {lang}: {zero_var_cols.tolist()}"
    assert col_variances.min() > 1e-3, f"Minimum column variance {col_variances.min():.6e} too low for {lang}"

    # Zero-variance row check across all 257 token positions
    row_variances = np.var(weight, axis=1)
    zero_var_rows = np.where(row_variances < 1e-6)[0]
    assert len(zero_var_rows) == 0, f"Zero-variance rows found in {lang}: {zero_var_rows.tolist()}"
    assert row_variances.min() > 1e-3, f"Minimum row variance {row_variances.min():.6e} too low for {lang}"

    # Row L2 norm check across all 257 token positions
    row_norms = np.linalg.norm(weight, axis=1)
    zero_norm_rows = np.where(row_norms < 0.5)[0]
    assert len(zero_norm_rows) == 0, f"Degenerate row norms found in {lang}: {zero_norm_rows.tolist()}"
    assert row_norms.min() > 1.0, f"Minimum row norm {row_norms.min():.4f} too low for {lang}"

    # Bounded bias distribution
    assert np.all(np.abs(bias) < 20.0), f"Bias out of reasonable range for {lang}: min={bias.min()}, max={bias.max()}"


@pytest.mark.parametrize("lang", GAP_LANGUAGES)
def test_absence_of_dead_logits(lang: str) -> None:
    """Empirically validates absence of dead logits across 1,000 synthetic Conformer hidden states."""
    weight, bias = load_binary_head(lang)

    rng = np.random.RandomState(42)
    hidden_states = rng.randn(1000, HIDDEN_DIM).astype(np.float32)
    logits = hidden_states @ weight.T + bias

    # Compute variance and range for each of the 257 token logits
    token_variances = np.var(logits, axis=0)
    dead_tokens = np.where(token_variances < 0.1)[0]
    assert len(dead_tokens) == 0, f"Dead logits detected for {lang} at indices: {dead_tokens.tolist()}"
    assert token_variances.min() > 0.5, f"Minimum logit variance {token_variances.min():.4f} too low for {lang}"


# ==============================================================================
# Suite 3: Bit-Exact Parameter Parity Across Storage Formats
# ==============================================================================

@pytest.mark.parametrize("lang", ALL_LANGUAGES)
def test_parameter_parity_across_artifacts(lang: str) -> None:
    """Verifies bit-exact parameter equality between .bin, modular ONNX, and monolithic ONNX."""
    w_bin, b_bin = load_binary_head(lang)
    w_head, b_head = load_onnx_head_params(lang)
    w_mono, b_mono = load_monolithic_head_params(lang)

    # Binary vs Modular ONNX
    np.testing.assert_array_equal(w_bin, w_head, err_msg=f"Weight mismatch between .bin and modular ONNX for {lang}")
    np.testing.assert_array_equal(b_bin, b_head, err_msg=f"Bias mismatch between .bin and modular ONNX for {lang}")

    # Monolithic ONNX vs Modular ONNX
    np.testing.assert_array_equal(w_mono, w_head, err_msg=f"Weight mismatch between monolithic ONNX and modular ONNX for {lang}")
    np.testing.assert_array_equal(b_mono, b_head, err_msg=f"Bias mismatch between monolithic ONNX and modular ONNX for {lang}")


# ==============================================================================
# Suite 4: Numerical Parity on Synthetic Conformer Hidden States
# ==============================================================================

@pytest.mark.parametrize("lang", GAP_LANGUAGES)
@pytest.mark.parametrize(
    "dist_name,shape",
    [
        ("standard_normal", (1, HIDDEN_DIM, 100)),
        ("large_normal", (1, HIDDEN_DIM, 250)),
        ("uniform_dynamic", (1, HIDDEN_DIM, 80)),
        ("batch_multi", (4, HIDDEN_DIM, 30)),
        ("single_timestep", (1, HIDDEN_DIM, 1)),
        ("zero_state", (1, HIDDEN_DIM, 50)),
    ],
)
def test_numerical_parity_synthetic_hidden_states(lang: str, dist_name: str, shape: tuple[int, int, int]) -> None:
    """Tests projection parity between Monolithic subgraph, Modular ONNX head, and NumPy."""
    batch_size, channels, time_steps = shape
    rng = np.random.RandomState(101 + time_steps)

    if dist_name == "standard_normal":
        hidden = rng.randn(*shape).astype(np.float32)
    elif dist_name == "large_normal":
        hidden = (rng.randn(*shape) * 5.0).astype(np.float32)
    elif dist_name == "uniform_dynamic":
        hidden = rng.uniform(-10.0, 10.0, size=shape).astype(np.float32)
    elif dist_name == "batch_multi":
        hidden = rng.randn(*shape).astype(np.float32)
    elif dist_name == "single_timestep":
        hidden = rng.randn(*shape).astype(np.float32)
    elif dist_name == "zero_state":
        hidden = np.zeros(shape, dtype=np.float32)
    else:
        raise ValueError(f"Unknown distribution {dist_name}")

    # 1. Modular Head ONNX inference
    head_path = HEADS_ONNX_DIR / f"head_{lang}.onnx"
    head_sess = ort.InferenceSession(str(head_path), providers=["CPUExecutionProvider"])
    head_logits = head_sess.run(["logits"], {"encoder_output": hidden})[0]

    # 2. Pure NumPy float32 dot-product
    w_bin, b_bin = load_binary_head(lang)
    hidden_transposed = hidden.transpose(0, 2, 1)  # [batch, time, channels]
    numpy_logits = hidden_transposed @ w_bin.T + b_bin

    # 3. Monolithic ONNX model projection subgraph inference
    mono_path = MODELS_ONNX_DIR / f"swanada_{lang}_ctc_int8.onnx"
    mono_model = onnx.load(str(mono_path))
    proj_nodes = [n for n in mono_model.graph.node if n.output[0] in ["conv1d_51", "logits"]]
    proj_inits = [i for i in mono_model.graph.initializer if i.name in ["ctc.weight", "ctc.bias"]]

    sub_input = helper.make_tensor_value_info("transpose_207", TensorProto.FLOAT, [batch_size, channels, time_steps])
    sub_output = helper.make_tensor_value_info("logits", TensorProto.FLOAT, [batch_size, time_steps, NUM_CLASSES])
    subgraph = helper.make_graph(proj_nodes, "mono_projection_head", [sub_input], [sub_output], proj_inits)
    submodel = helper.make_model(
        subgraph,
        producer_name="swanada_challenger",
        opset_imports=mono_model.opset_import,
        ir_version=mono_model.ir_version,
    )
    mono_sub_sess = ort.InferenceSession(submodel.SerializeToString(), providers=["CPUExecutionProvider"])
    mono_logits = mono_sub_sess.run(["logits"], {"transpose_207": hidden})[0]

    # Verification checks
    diff_modular_numpy = float(np.max(np.abs(head_logits - numpy_logits)))
    diff_mono_numpy = float(np.max(np.abs(mono_logits - numpy_logits)))
    diff_mono_modular = float(np.max(np.abs(mono_logits - head_logits)))

    assert diff_modular_numpy < 1e-5, f"Modular vs NumPy difference {diff_modular_numpy:.2e} >= 1e-5 for {lang}"
    assert diff_mono_numpy < 1e-5, f"Monolithic vs NumPy difference {diff_mono_numpy:.2e} >= 1e-5 for {lang}"
    assert diff_mono_modular < 1e-5, f"Monolithic vs Modular difference {diff_mono_modular:.2e} >= 1e-5 for {lang}"

    argmax_modular = np.argmax(head_logits, axis=-1)
    argmax_numpy = np.argmax(numpy_logits, axis=-1)
    argmax_mono = np.argmax(mono_logits, axis=-1)

    assert np.array_equal(argmax_modular, argmax_numpy), f"Argmax mismatch modular vs numpy for {lang}"
    assert np.array_equal(argmax_mono, argmax_numpy), f"Argmax mismatch monolithic vs numpy for {lang}"


# ==============================================================================
# Suite 5: Full Monolithic Forward Pass Verification with Audio Inputs
# ==============================================================================

@pytest.mark.parametrize("lang", GAP_LANGUAGES)
def test_full_monolithic_forward_pass_parity(lang: str) -> None:
    """Verifies parity through full end-to-end monolithic model forward pass with synthetic mel."""
    mono_path = MODELS_ONNX_DIR / f"swanada_{lang}_ctc_int8.onnx"
    mono_model = onnx.load(str(mono_path))

    # Expose internal transpose_207 Conformer hidden output
    mono_model.graph.output.append(
        helper.make_tensor_value_info("transpose_207", TensorProto.FLOAT, ["batch", HIDDEN_DIM, "time_sub"])
    )
    mono_sess = ort.InferenceSession(mono_model.SerializeToString(), providers=["CPUExecutionProvider"])

    rng = np.random.RandomState(2024)
    dummy_mel = rng.randn(1, 80, 160).astype(np.float32)
    dummy_len = np.array([160], dtype=np.int64)

    mono_logits, hidden = mono_sess.run(["logits", "transpose_207"], {"audio_signal": dummy_mel, "length": dummy_len})

    # Modular Head ONNX forward pass
    head_path = HEADS_ONNX_DIR / f"head_{lang}.onnx"
    head_sess = ort.InferenceSession(str(head_path), providers=["CPUExecutionProvider"])
    head_logits = head_sess.run(["logits"], {"encoder_output": hidden})[0]

    # Pure NumPy float32 forward pass
    w_bin, b_bin = load_binary_head(lang)
    hidden_np = hidden.transpose(0, 2, 1)
    numpy_logits = hidden_np @ w_bin.T + b_bin

    max_diff_mono_head = float(np.max(np.abs(mono_logits - head_logits)))
    max_diff_mono_numpy = float(np.max(np.abs(mono_logits - numpy_logits)))
    max_diff_head_numpy = float(np.max(np.abs(head_logits - numpy_logits)))

    assert max_diff_mono_head < 1e-5, f"Mono vs Head diff {max_diff_mono_head:.2e} >= 1e-5 for {lang}"
    assert max_diff_mono_numpy < 1e-5, f"Mono vs NumPy diff {max_diff_mono_numpy:.2e} >= 1e-5 for {lang}"
    assert max_diff_head_numpy < 1e-5, f"Head vs NumPy diff {max_diff_head_numpy:.2e} >= 1e-5 for {lang}"

    assert np.array_equal(np.argmax(mono_logits, axis=-1), np.argmax(head_logits, axis=-1))
    assert np.array_equal(np.argmax(mono_logits, axis=-1), np.argmax(numpy_logits, axis=-1))


@pytest.mark.parametrize("lang", GAP_LANGUAGES)
def test_real_audio_sample_forward_pass_parity(lang: str) -> None:
    """Verifies bit-exact parity through monolithic model on authentic audio WAV files."""
    from swanada.audio import load_audio
    from swanada.frontend import extract_log_mel_features

    wav_path = SAMPLES_DIR / f"{lang}.wav"
    assert wav_path.exists(), f"Sample audio missing for {lang}: {wav_path}"
    pcm = load_audio(wav_path, target_sr=16000)
    mel, length = extract_log_mel_features(pcm)
    len_arr = np.array([length], dtype=np.int64)

    mono_path = MODELS_ONNX_DIR / f"swanada_{lang}_ctc_int8.onnx"
    mono_model = onnx.load(str(mono_path))
    mono_model.graph.output.append(
        helper.make_tensor_value_info("transpose_207", TensorProto.FLOAT, ["batch", HIDDEN_DIM, "time_sub"])
    )
    mono_sess = ort.InferenceSession(mono_model.SerializeToString(), providers=["CPUExecutionProvider"])
    mono_logits, hidden = mono_sess.run(["logits", "transpose_207"], {"audio_signal": mel, "length": len_arr})

    head_path = HEADS_ONNX_DIR / f"head_{lang}.onnx"
    head_sess = ort.InferenceSession(str(head_path), providers=["CPUExecutionProvider"])
    head_logits = head_sess.run(["logits"], {"encoder_output": hidden})[0]

    w_bin, b_bin = load_binary_head(lang)
    numpy_logits = hidden.transpose(0, 2, 1) @ w_bin.T + b_bin

    max_diff_mono_head = float(np.max(np.abs(mono_logits - head_logits)))
    max_diff_mono_numpy = float(np.max(np.abs(mono_logits - numpy_logits)))
    max_diff_head_numpy = float(np.max(np.abs(head_logits - numpy_logits)))

    assert max_diff_mono_head < 1e-5, f"Real audio Mono vs Head diff {max_diff_mono_head:.2e} for {lang}"
    assert max_diff_mono_numpy < 1e-5, f"Real audio Mono vs NumPy diff {max_diff_mono_numpy:.2e} for {lang}"
    assert max_diff_head_numpy < 1e-5, f"Real audio Head vs NumPy diff {max_diff_head_numpy:.2e} for {lang}"

    assert np.array_equal(np.argmax(mono_logits, axis=-1), np.argmax(head_logits, axis=-1))
    assert np.array_equal(np.argmax(mono_logits, axis=-1), np.argmax(numpy_logits, axis=-1))



# ==============================================================================
# Suite 6: Cross-Runtime Parity (NumPy BLAS vs Node.js Kernel)
# ==============================================================================

@pytest.mark.parametrize("lang", GAP_LANGUAGES)
def test_cross_runtime_parity_numpy_vs_javascript(lang: str) -> None:
    """Cross-validates NumPy BLAS against JavaScript projectLinearHead implementation."""
    bin_file = DOCS_HEADS_DIR / f"{lang}.bin"
    w_bin, b_bin = load_binary_head(lang)

    rng = np.random.RandomState(777)
    time_steps = 15
    hidden = rng.randn(time_steps, HIDDEN_DIM).astype(np.float32)
    logits_py = hidden @ w_bin.T + b_bin

    js_code = f"""
    import fs from 'node:fs';
    const binBuf = fs.readFileSync('{bin_file}');
    const weight = new Float32Array(binBuf.buffer, binBuf.byteOffset, 257 * 512);
    const bias = new Float32Array(binBuf.buffer, binBuf.byteOffset + 257 * 512 * 4, 257);
    const hidden = new Float32Array({json.dumps(hidden.flatten().tolist())});
    const timeSteps = {time_steps};
    const numClasses = 257;
    const dim = 512;
    const out = new Float32Array(timeSteps * numClasses);
    for (let t = 0; t < timeSteps; t++) {{
      const hOff = t * dim;
      const oOff = t * numClasses;
      for (let c = 0; c < numClasses; c++) {{
        const wOff = c * dim;
        let acc = bias[c];
        for (let d = 0; d < dim; d += 4) {{
          acc +=
            hidden[hOff + d] * weight[wOff + d] +
            hidden[hOff + d + 1] * weight[wOff + d + 1] +
            hidden[hOff + d + 2] * weight[wOff + d + 2] +
            hidden[hOff + d + 3] * weight[wOff + d + 3];
        }}
        out[oOff + c] = acc;
      }}
    }}
    console.log(JSON.stringify(Array.from(out)));
    """

    proc = subprocess.run(
        ["node", "--input-type=module", "-e", js_code],
        capture_output=True,
        text=True,
        check=True,
    )
    logits_js = np.array(json.loads(proc.stdout), dtype=np.float32).reshape(time_steps, NUM_CLASSES)

    max_diff = float(np.max(np.abs(logits_py - logits_js)))
    argmax_py = np.argmax(logits_py, axis=-1)
    argmax_js = np.argmax(logits_js, axis=-1)

    assert max_diff < 1e-4, f"Cross-runtime drift {max_diff:.2e} >= 1e-4 for {lang}"
    assert np.array_equal(argmax_py, argmax_js), f"Argmax mismatch between Python and JS for {lang}"
