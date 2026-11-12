"""Cross-runtime parity and integration tests for SENH v2 English Adapter."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest
import torch

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT / "tools") not in sys.path:
    sys.path.insert(0, str(REPO_ROOT / "tools"))

from swanada.en_adapter import (
    SENH_MAGIC,
    SENH_VERSION,
    load_en_adapter,
    parse_en_adapter_bytes,
    serialize_en_adapter_bytes,
)
from swanada.lid import decode_bilingual_codeswitch
from train_en_adapter_gcp import PyTorchEnglishAdapter


def test_senh_v2_pytorch_numpy_js_three_way_parity(tmp_path: Path) -> None:
    """Verify < 1e-5 max_abs_diff across PyTorch QAT, Python NumPy, and JS ESM/CJS."""
    torch.manual_seed(42)
    dilations = (1, 2, 3, 4, 6, 8)
    model = PyTorchEnglishAdapter(
        d_model=512,
        d_inner=416,
        kernel_size=7,
        dilations=dilations,
        num_classes=129,
        dropout=0.0,
    ).eval()

    senh_bytes = serialize_en_adapter_bytes(model.to_senh_weights())
    assert senh_bytes[:4] == SENH_MAGIC
    bin_path = tmp_path / "en_adapter.bin"
    bin_path.write_bytes(senh_bytes)

    py_weights = load_en_adapter(bin_path)
    assert py_weights.d_model == 512
    assert py_weights.d_inner == 416
    assert py_weights.kernel_size == 7
    assert py_weights.num_classes == 129
    assert tuple(b.dilation for b in py_weights.blocks) == dilations

    # Verify padding invariance in PyTorch (padded batch vs exact length)
    rng = np.random.default_rng(123)
    h17 = rng.standard_normal((17, 512)).astype(np.float32)
    h85 = rng.standard_normal((85, 512)).astype(np.float32)
    batch_h = np.zeros((2, 85, 512), dtype=np.float32)
    batch_h[0, :17] = h17
    batch_h[1, :85] = h85

    with torch.no_grad():
        pt_b = model(
            torch.from_numpy(batch_h),
            torch.tensor([17, 85], dtype=torch.long),
            qat=True,
        ).numpy()
        pt_17 = model(
            torch.from_numpy(h17[None]),
            torch.tensor([17], dtype=torch.long),
            qat=True,
        )[0].numpy()

    assert float(np.max(np.abs(pt_b[0, :17] - pt_17))) == 0.0

    # Verify PyTorch QAT <-> Python NumPy parity
    np_17 = py_weights.forward(h17)
    np_85 = py_weights.forward(h85)
    assert np_17.shape == (17, 129)
    assert np_85.shape == (85, 129)
    assert float(np.max(np.abs(pt_17 - np_17))) < 1e-5
    assert float(np.max(np.abs(pt_b[1] - np_85))) < 1e-5

    # Verify Python NumPy <-> JS ESM (dist/index.mjs & docs/swanada.mjs) & CJS parity
    h17_path = tmp_path / "h17.bin"
    h17_path.write_bytes(h17.tobytes())

    node_script = f"""
import fs from 'node:fs';
import {{ createRequire }} from 'node:module';
import {{ isEnAdapterBytes, parseEnAdapterBytes, forwardEnAdapter, SENH_VERSION }} from {(REPO_ROOT / 'js/dist/index.mjs').as_uri()!r};
import * as docsMod from {(REPO_ROOT / 'docs/swanada.mjs').as_uri()!r};

const require = createRequire(import.meta.url);
const cjsMod = require({str(REPO_ROOT / 'js/dist/index.cjs')!r});

const raw = fs.readFileSync({str(bin_path)!r});
const u8 = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
if (!isEnAdapterBytes(u8) || SENH_VERSION !== {SENH_VERSION}) {{
  throw new Error('SENH magic/version mismatch');
}}
const wEsm = parseEnAdapterBytes(u8);
const wDocs = docsMod.parseEnAdapterBytes(u8);
const wCjs = cjsMod.parseEnAdapterBytes(u8);

const hRaw = fs.readFileSync({str(h17_path)!r});
const h17 = new Float32Array(hRaw.buffer, hRaw.byteOffset, hRaw.byteLength / 4);

const outEsm = forwardEnAdapter(wEsm, h17, 17);
const outDocs = docsMod.forwardEnAdapter(wDocs, h17, 17);
const outCjs = cjsMod.forwardEnAdapter(wCjs, h17, 17);

let maxDocsDiff = 0;
let maxCjsDiff = 0;
for (let i = 0; i < outEsm.length; i++) {{
  maxDocsDiff = Math.max(maxDocsDiff, Math.abs(outEsm[i] - outDocs[i]));
  maxCjsDiff = Math.max(maxCjsDiff, Math.abs(outEsm[i] - outCjs[i]));
}}
const outPath = {str(tmp_path / 'js_out17.bin')!r};
fs.writeFileSync(outPath, Buffer.from(outEsm.buffer, outEsm.byteOffset, outEsm.byteLength));
console.log(JSON.stringify({{ len: outEsm.length, maxDocsDiff, maxCjsDiff }}));
"""
    proc = subprocess.run(
        ["node", "--input-type=module", "-e", node_script],
        cwd=str(REPO_ROOT),
        check=True,
        capture_output=True,
        text=True,
    )
    meta = json.loads(proc.stdout.strip().splitlines()[-1])
    assert meta["len"] == 17 * 129
    assert meta["maxDocsDiff"] == 0.0
    assert meta["maxCjsDiff"] == 0.0

    js_17 = np.frombuffer((tmp_path / "js_out17.bin").read_bytes(), dtype=np.float32).reshape(17, 129)
    assert float(np.max(np.abs(np_17 - js_17))) < 1e-5
    assert float(np.max(np.abs(pt_17 - js_17))) < 1e-5


def test_senh_v2_serialization_roundtrip_exact() -> None:
    """Verify serialize_en_adapter_bytes -> parse_en_adapter_bytes is bit-exact after Int8 quantization."""
    torch.manual_seed(7)
    model = PyTorchEnglishAdapter(
        d_model=512,
        d_inner=256,
        kernel_size=7,
        dilations=(1, 2),
        num_classes=129,
        dropout=0.0,
    ).eval()
    b1 = serialize_en_adapter_bytes(model.to_senh_weights())
    w1 = parse_en_adapter_bytes(b1)
    b2 = serialize_en_adapter_bytes(w1)
    w2 = parse_en_adapter_bytes(b2)

    x = np.random.default_rng(9).standard_normal((12, 512)).astype(np.float32)
    y1 = w1.forward(x)
    y2 = w2.forward(x)
    assert float(np.max(np.abs(y1 - y2))) == 0.0


def test_codeswitch_mixed_vocab_dims_257_indic_and_129_en_bpe() -> None:
    """Verify +EN code-switching handles [T, 257] Indic logits alongside [T, 129] English BPE logits."""
    t_steps = 24
    vocab_kn = ["<blank>"] + [f"▁ಕ{i}" for i in range(1, 257)]
    vocab_en = ["<blank>", "▁offline", "▁phone"] + [f"▁w{i}" for i in range(3, 129)]

    logits_kn = np.full((t_steps, 257), -8.0, dtype=np.float32)
    logits_kn[:, 0] = 4.0
    logits_kn[2:5, 0] = -4.0
    logits_kn[2:5, 1] = 6.0  # Indic token at frames 2..4
    logits_kn[12:16, 0] = 0.5
    logits_kn[12:16, 2] = 0.8  # Weak Indic hypothesis where English is spoken

    logits_en = np.full((t_steps, 129), -8.0, dtype=np.float32)
    logits_en[:, 0] = 4.0
    logits_en[12:16, 0] = -6.0
    logits_en[12:16, 1] = 9.0  # Strong English BPE word `▁offline`

    cs_py = decode_bilingual_codeswitch(
        logits_kn, vocab_kn, "kn", logits_en, vocab_en
    )
    assert "offline" in cs_py.text
    assert any(s.word == "offline" for s in cs_py.english_spans)
    assert len(cs_py.tokens) >= 2

    # Verify JS decodeBilingualCodeswitch matches on [T, 257] + [T, 129]
    js_code = f"""
import {{ decodeBilingualCodeswitch }} from {(REPO_ROOT / 'js/dist/index.mjs').as_uri()!r};
const vocabKn = {json.dumps(vocab_kn)};
const vocabEn = {json.dumps(vocab_en)};
const lKn = new Float32Array({json.dumps(logits_kn.reshape(-1).tolist())});
const lEn = new Float32Array({json.dumps(logits_en.reshape(-1).tolist())});
const res = decodeBilingualCodeswitch(lKn, {t_steps}, vocabKn, 'kn', lEn, vocabEn, false);
console.log(JSON.stringify(res));
"""
    proc = subprocess.run(
        ["node", "--input-type=module", "-e", js_code],
        cwd=str(REPO_ROOT),
        check=True,
        capture_output=True,
        text=True,
    )
    res_js = json.loads(proc.stdout.strip().splitlines()[-1])
    assert res_js["text"] == cs_py.text
    assert [s["word"] for s in res_js["englishSpans"]] == [s.word for s in cs_py.english_spans]
