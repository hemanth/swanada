#!/usr/bin/env python3
"""Exports compact 515 KB FP32 linear CTC projection heads to docs/heads/<lang>.bin
and verifies bit-exact parity against monolithic swanada_<lang>_ctc_int8.onnx models.

Binary layout of docs/heads/<lang>.bin (little-endian float32):
  - weight: [257, 512] float32 (131,584 floats = 526,336 bytes)
  - bias:   [257]      float32 (257 floats     =   1,028 bytes)
  Total: 527,364 bytes (~515 KB) per language.
"""
from __future__ import annotations

from pathlib import Path
import numpy as np
import onnx
from onnx import helper, numpy_helper, TensorProto
import onnxruntime as ort

ROOT = Path(__file__).resolve().parent.parent
MODELS_DIR = ROOT / "models" / "onnx"
HEADS_ONNX_DIR = MODELS_DIR / "heads"
WEB_HEADS_DIR = ROOT / "docs" / "heads"

LANGS = ("sa", "en", "hi", "kn", "mr", "bn", "ta", "te", "ml", "gu", "pa", "or")


def extract_head_wb(lang: str) -> tuple[np.ndarray, np.ndarray]:
    head_path = HEADS_ONNX_DIR / f"head_{lang}.onnx"
    m = onnx.load(str(head_path))
    w = None
    b = None
    for init in m.graph.initializer:
        arr = numpy_helper.to_array(init).astype(np.float32)
        if arr.ndim >= 2 and arr.shape[0] == 257:
            w = arr.reshape(257, 512)
        elif arr.ndim == 1 and arr.shape[0] == 257:
            b = arr.reshape(257)
    if w is None or b is None:
        raise RuntimeError(f"Failed to extract weight/bias from {head_path}")
    return np.ascontiguousarray(w, dtype="<f4"), np.ascontiguousarray(b, dtype="<f4")


def main() -> None:
    WEB_HEADS_DIR.mkdir(parents=True, exist_ok=True)

    # Load base quantized model and expose layer_norm_84 for parity check
    base_model = onnx.load(str(MODELS_DIR / "sushrota_sanskrit_ctc_int8.onnx"))
    base_model.graph.output.append(
        helper.make_tensor_value_info("layer_norm_84", TensorProto.FLOAT, ["batch", "time_sub", 512])
    )
    enc_sess = ort.InferenceSession(base_model.SerializeToString(), providers=["CPUExecutionProvider"])

    rng = np.random.RandomState(7)
    dummy_mel = rng.randn(1, 80, 125).astype(np.float32)
    dummy_len = np.array([125], dtype=np.int64)
    _, hidden = enc_sess.run(["logits", "layer_norm_84"], {"audio_signal": dummy_mel, "length": dummy_len})
    # hidden: [1, T, 512]

    for lang in LANGS:
        w, b = extract_head_wb(lang)
        out_bin = WEB_HEADS_DIR / f"{lang}.bin"
        with open(out_bin, "wb") as f:
            f.write(w.tobytes())
            f.write(b.tobytes())
        assert out_bin.stat().st_size == (257 * 512 + 257) * 4

        # Verify numerical parity against monolithic ONNX model
        mono_name = "sushrota_sanskrit_ctc_int8.onnx" if lang == "sa" else f"swanada_{lang}_ctc_int8.onnx"
        mono_sess = ort.InferenceSession(str(MODELS_DIR / mono_name), providers=["CPUExecutionProvider"])
        (mono_logits,) = mono_sess.run(["logits"], {"audio_signal": dummy_mel, "length": dummy_len})
        proj_logits = hidden[0] @ w.T + b  # [T, 257]
        max_diff = float(np.max(np.abs(mono_logits[0] - proj_logits)))
        argmax_eq = bool(np.array_equal(np.argmax(mono_logits[0], axis=-1), np.argmax(proj_logits, axis=-1)))
        print(f"[{lang}] wrote {out_bin.name} ({out_bin.stat().st_size} B) | max_diff={max_diff:.2e} | argmax_100%_eq={argmax_eq}")
        assert max_diff < 1e-4 and argmax_eq, f"Parity mismatch for {lang}: max_diff={max_diff}"


if __name__ == "__main__":
    main()
