"""SENH v2: Dilated Conformer-GLU Temporal Adapter + 1,024-BPE CTC Head for English.

Operates directly on frozen `layer_norm_84` (`[T, 512]`) representations from either
Swanada Studio (`sushrota_sanskrit_ctc_int8.onnx`) or Swanada Mobile
(`swanada_mobile_ctc_int8.onnx`) with zero modifications to the shared encoder
and 0.00e+00 drift on all 11 Indic languages.

Binary format (`SENH` v2):
  - Header: `b"SENH"` + `<6I` (`version=2, d_model, n_blocks, d_inner, kernel_size, num_classes`)
    + `<{n_blocks}I` (`dilations`)
  - Per-row symmetric Int8 quantized linear weights (`int8` + `float32` row scales)
    dequantized once at load time into contiguous `float32` BLAS matrices.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import struct
from typing import List, Sequence, Tuple, Union
import numpy as np

SENH_MAGIC = b"SENH"
SENH_VERSION = 2


def _quantize_rows_int8(w: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    w_f32 = np.ascontiguousarray(w, dtype=np.float32)
    max_abs = np.max(np.abs(w_f32), axis=1)
    scales = np.where(max_abs > 1.0e-12, max_abs / 127.0, 1.0e-8).astype(np.float32)
    q = np.clip(np.round(w_f32 / scales[:, None]), -127.0, 127.0).astype(np.int8)
    return scales, q


def _layer_norm_2d(x: np.ndarray, gamma: np.ndarray, beta: np.ndarray, eps: float = 1.0e-5) -> np.ndarray:
    mean = np.mean(x, axis=-1, keepdims=True)
    diff = x - mean
    var = np.mean(diff * diff, axis=-1, keepdims=True)
    return (diff / np.sqrt(var + eps)) * gamma + beta


def _silu(x: np.ndarray) -> np.ndarray:
    clipped = np.clip(x, -40.0, 40.0)
    return x / (1.0 + np.exp(-clipped))


def _depthwise_dilated_conv1d(
    x: np.ndarray,
    dw_weight: np.ndarray,
    dw_bias: np.ndarray,
    dilation: int,
) -> np.ndarray:
    """Symmetric zero-padded 1D depthwise dilated convolution on `x` `[T, C]`."""
    t_steps, channels = x.shape
    k_size = dw_weight.shape[1]
    half = k_size // 2
    out = np.broadcast_to(dw_bias, (t_steps, channels)).astype(np.float32, copy=True)
    for k in range(k_size):
        shift = (k - half) * dilation
        w_k = dw_weight[:, k]  # [C]
        if shift == 0:
            out += x * w_k
        elif shift < 0:
            s = -shift
            if s < t_steps:
                out[s:] += x[: t_steps - s] * w_k
        else:
            if shift < t_steps:
                out[: t_steps - shift] += x[shift:] * w_k
    return out


@dataclass
class AdapterBlockWeights:
    dilation: int
    ln1_gamma: np.ndarray  # [d_model]
    ln1_beta: np.ndarray   # [d_model]
    w_in: np.ndarray       # [2 * d_inner, d_model]
    b_in: np.ndarray       # [2 * d_inner]
    dw_weight: np.ndarray  # [d_inner, kernel_size]
    dw_bias: np.ndarray    # [d_inner]
    ln2_gamma: np.ndarray  # [d_inner]
    ln2_beta: np.ndarray   # [d_inner]
    w_out: np.ndarray      # [d_model, d_inner]
    b_out: np.ndarray      # [d_model]


@dataclass
class EnglishAdapterWeights:
    d_model: int
    d_inner: int
    kernel_size: int
    num_classes: int
    blocks: Tuple[AdapterBlockWeights, ...]
    ln_out_gamma: np.ndarray  # [d_model]
    ln_out_beta: np.ndarray   # [d_model]
    w_ctc: np.ndarray         # [num_classes, d_model]
    b_ctc: np.ndarray         # [num_classes]

    def forward(self, hidden: np.ndarray) -> np.ndarray:
        """Maps `hidden` `[T, d_model]` or `[1, T, d_model]` -> `logits` `[T, num_classes]` (or `[1, T, num_classes]`)."""
        is_3d = hidden.ndim == 3
        x = np.ascontiguousarray(hidden[0] if is_3d else hidden, dtype=np.float32)
        if x.shape[0] == 0:
            empty = np.zeros((0, self.num_classes), dtype=np.float32)
            return empty[None, :, :] if is_3d else empty

        d_in = self.d_inner
        for blk in self.blocks:
            h = _layer_norm_2d(x, blk.ln1_gamma, blk.ln1_beta)
            proj = h @ blk.w_in.T + blk.b_in  # [T, 2 * d_inner]
            u = proj[:, :d_in]
            v = proj[:, d_in:]
            g = u * _silu(v)
            c = _depthwise_dilated_conv1d(g, blk.dw_weight, blk.dw_bias, blk.dilation)
            c = _silu(_layer_norm_2d(c, blk.ln2_gamma, blk.ln2_beta))
            x = x + (c @ blk.w_out.T + blk.b_out)

        h_out = _layer_norm_2d(x, self.ln_out_gamma, self.ln_out_beta)
        logits = (h_out @ self.w_ctc.T + self.b_ctc).astype(np.float32, copy=False)
        return logits[None, :, :] if is_3d else logits


def serialize_en_adapter_bytes(weights: EnglishAdapterWeights) -> bytes:
    n_blocks = len(weights.blocks)
    dilations = [int(b.dilation) for b in weights.blocks]
    header = (
        SENH_MAGIC
        + struct.pack(
            "<6I",
            SENH_VERSION,
            int(weights.d_model),
            int(n_blocks),
            int(weights.d_inner),
            int(weights.kernel_size),
            int(weights.num_classes),
        )
        + struct.pack(f"<{n_blocks}I", *dilations)
    )
    chunks: List[bytes] = [header]

    def add_f32(arr: np.ndarray) -> None:
        chunks.append(np.ascontiguousarray(arr, dtype="<f4").tobytes())

    def add_qmat(mat: np.ndarray) -> None:
        sc, q = _quantize_rows_int8(mat)
        chunks.append(np.ascontiguousarray(sc, dtype="<f4").tobytes())
        chunks.append(np.ascontiguousarray(q, dtype=np.int8).tobytes())

    for blk in weights.blocks:
        add_f32(blk.ln1_gamma)
        add_f32(blk.ln1_beta)
        add_qmat(blk.w_in)
        add_f32(blk.b_in)
        add_f32(blk.dw_weight)
        add_f32(blk.dw_bias)
        add_f32(blk.ln2_gamma)
        add_f32(blk.ln2_beta)
        add_qmat(blk.w_out)
        add_f32(blk.b_out)

    add_f32(weights.ln_out_gamma)
    add_f32(weights.ln_out_beta)
    add_qmat(weights.w_ctc)
    add_f32(weights.b_ctc)
    return b"".join(chunks)


def parse_en_adapter_bytes(raw: bytes) -> EnglishAdapterWeights:
    if len(raw) < 28 or raw[:4] != SENH_MAGIC:
        raise ValueError("Invalid en_adapter.bin header: expected magic b'SENH'")
    version, d_model, n_blocks, d_inner, kernel_size, num_classes = struct.unpack("<6I", raw[4:28])
    if version != SENH_VERSION:
        raise ValueError(f"Unsupported en_adapter.bin version={version}")
    pos = 28
    dil_bytes = 4 * n_blocks
    if len(raw) < pos + dil_bytes:
        raise ValueError("Truncated en_adapter.bin dilations header")
    dilations = struct.unpack(f"<{n_blocks}I", raw[pos : pos + dil_bytes])
    pos += dil_bytes

    mv = memoryview(raw)

    def read_f32(shape: Sequence[int]) -> np.ndarray:
        nonlocal pos
        cnt = 1
        for s in shape:
            cnt *= s
        nbytes = cnt * 4
        if pos + nbytes > len(raw):
            raise ValueError(f"Truncated en_adapter.bin reading float32{tuple(shape)} at {pos}")
        arr = np.frombuffer(mv[pos : pos + nbytes], dtype="<f4").astype(np.float32, copy=True).reshape(shape)
        pos += nbytes
        return arr

    def read_qmat(rows: int, cols: int) -> np.ndarray:
        nonlocal pos
        scales = read_f32((rows,))
        nbytes = rows * cols
        if pos + nbytes > len(raw):
            raise ValueError(f"Truncated en_adapter.bin reading int8({rows}, {cols}) at {pos}")
        q = np.frombuffer(mv[pos : pos + nbytes], dtype=np.int8).reshape((rows, cols))
        pos += nbytes
        return np.ascontiguousarray(q.astype(np.float32) * scales[:, None], dtype=np.float32)

    blocks: List[AdapterBlockWeights] = []
    for i in range(n_blocks):
        ln1_g = read_f32((d_model,))
        ln1_b = read_f32((d_model,))
        w_in = read_qmat(2 * d_inner, d_model)
        b_in = read_f32((2 * d_inner,))
        dw_w = read_f32((d_inner, kernel_size))
        dw_b = read_f32((d_inner,))
        ln2_g = read_f32((d_inner,))
        ln2_b = read_f32((d_inner,))
        w_out = read_qmat(d_model, d_inner)
        b_out = read_f32((d_model,))
        blocks.append(
            AdapterBlockWeights(
                dilation=int(dilations[i]),
                ln1_gamma=ln1_g,
                ln1_beta=ln1_b,
                w_in=w_in,
                b_in=b_in,
                dw_weight=dw_w,
                dw_bias=dw_b,
                ln2_gamma=ln2_g,
                ln2_beta=ln2_b,
                w_out=w_out,
                b_out=b_out,
            )
        )

    ln_out_g = read_f32((d_model,))
    ln_out_b = read_f32((d_model,))
    w_ctc = read_qmat(num_classes, d_model)
    b_ctc = read_f32((num_classes,))

    return EnglishAdapterWeights(
        d_model=int(d_model),
        d_inner=int(d_inner),
        kernel_size=int(kernel_size),
        num_classes=int(num_classes),
        blocks=tuple(blocks),
        ln_out_gamma=ln_out_g,
        ln_out_beta=ln_out_b,
        w_ctc=w_ctc,
        b_ctc=b_ctc,
    )


def load_en_adapter(path: Union[str, Path]) -> EnglishAdapterWeights:
    return parse_en_adapter_bytes(Path(path).read_bytes())
