#!/usr/bin/env python3
"""Slices IndicConformer multilingual heads and extracts 256-token subword vocabularies.

Extracts vocabularies and weights from NeMo checkpoint:
  - models/vocabularies/<lang>_vocab.json (257 classes total with <blank> at 0)
  - models/vocabularies/sanskrit_vocab.json (Sanskrit copy for backward compatibility)
  - models/onnx/swanada_<lang>_ctc_int8.onnx (INT8 quantized monolithic models)
  - models/onnx/heads/head_<lang>.onnx (Modular CTC heads)
"""
from __future__ import annotations

import argparse
import copy
import json
import os
from pathlib import Path
import sys
import tarfile
from typing import Dict, List, Optional
import yaml
import numpy as np
import torch
import torch.nn as nn
import onnx
from onnx import numpy_helper

DEFAULT_CHECKPOINT = "/Users/lika/labs/sushrota-sanskrit-asr/models/sushrota_sanskrit_asr_v13b.nemo"

# Mapping of language code to index in 22-language NeMo checkpoint
TARGET_INDIC_LANGS: Dict[str, int] = {
    "as": 0,
    "bn": 1,
    "brx": 2,
    "doi": 3,
    "kok": 4,
    "gu": 5,
    "hi": 6,
    "kn": 7,
    "ks": 8,
    "mai": 9,
    "ml": 10,
    "mr": 11,
    "mni": 12,
    "ne": 13,
    "or": 14,
    "pa": 15,
    "sa": 16,
    "sat": 17,
    "sd": 18,
    "ta": 19,
    "te": 20,
    "ur": 21,
}

SWANADA_LANGUAGES = (
    "sa", "en", "hi", "kn", "mr", "bn", "ta", "te", "ml", "gu", "pa", "or"
)

BLANK_COL_INDEX = 5632


def generate_en_vocabulary() -> List[str]:
    """Constructs 257-token Indian English subword vocabulary with <blank> at 0."""
    tokens = ["<blank>", "<unk>"]

    # Key tech & Indian English vocabulary prioritized
    priority_words = [
        "audio", "worklet", "stream", "model", "python", "speech", "text",
        "client", "server", "browser", "recognition", "conformer", "onnx",
        "wasm", "kernel", "data", "input", "output", "tensor", "layer",
        "lakh", "crore", "lakhs", "crores", "aadhaar", "chai", "rupee",
        "rupees", "babu", "masala", "desh", "pan", "station", "railway"
    ]
    for w in priority_words:
        tokens.append(f"▁{w}")

    # Digits
    for d in "0123456789":
        tokens.append(d)

    # Punctuation
    for p in [".", ",", "?", "!", "-", "'", '"', ":", ";", "(", ")", "/", "%"]:
        tokens.append(p)

    # Subwords & common suffixes
    suffixes = [
        "ing", "ed", "er", "ly", "tion", "es", "al", "ment", "able", "ness",
        "ity", "ic", "ful", "ous", "ive", "less", "ize", "ion", "en", "est",
        "in", "an", "on", "at", "or", "th", "st", "nd", "rd"
    ]
    for s in suffixes:
        if s not in tokens:
            tokens.append(s)

    # Lowercase letters and word prefixes
    for c in "abcdefghijklmnopqrstuvwxyz":
        pref = f"▁{c}"
        if pref not in tokens:
            tokens.append(pref)
        if c not in tokens:
            tokens.append(c)

    # Common English words
    common_words = [
        "the", "and", "to", "of", "a", "in", "is", "that", "for", "it",
        "as", "was", "with", "on", "be", "at", "by", "this", "have", "from",
        "or", "one", "had", "not", "word", "but", "what", "some", "we", "can",
        "out", "other", "were", "all", "there", "when", "up", "use", "your",
        "how", "said", "an", "each", "she", "which", "do", "their", "time",
        "if", "will", "way", "about", "many", "then", "them", "would", "write",
        "like", "so", "these", "her", "long", "make", "thing", "see", "him",
        "two", "has", "look", "more", "day", "could", "go", "come", "did",
        "number", "sound", "no", "most", "people", "my", "over", "know",
        "water", "than", "call", "first", "who", "may", "down", "side", "been",
        "now", "find", "any", "new", "work", "part", "take", "get", "place",
        "made", "live", "where", "after", "back", "little", "only", "round",
        "man", "year", "came", "show", "every", "good", "me", "give", "our",
        "under", "name", "very", "code", "loss", "weight", "sample", "rate",
        "frame", "buffer", "ticket"
    ]
    for w in common_words:
        pref = f"▁{w}"
        if pref not in tokens:
            tokens.append(pref)

    # Ensure uniqueness while preserving order
    dedup: List[str] = list(dict.fromkeys(tokens))
    if len(dedup) > 257:
        dedup = dedup[:257]
    elif len(dedup) < 257:
        for idx in range(257 - len(dedup)):
            dedup.append(f"token_{idx}")

    assert len(dedup) == 257
    assert dedup[0] == "<blank>"
    return dedup


def extract_vocabularies(
    tar: tarfile.TarFile,
    cfg: dict,
    output_dir: Path,
) -> Dict[str, List[str]]:
    """Extracts 256-token SentencePiece subwords and outputs 257-token JSON vocabularies."""
    output_dir.mkdir(parents=True, exist_ok=True)
    langs_info = cfg.get("tokenizer", {}).get("langs", {})
    extracted: Dict[str, List[str]] = {}

    for lang in SWANADA_LANGUAGES:
        if lang == "en":
            tokens = generate_en_vocabulary()
        else:
            if lang not in langs_info:
                raise ValueError(f"Language '{lang}' missing from NeMo tokenizer config.")
            spe_path = langs_info[lang]["spe_tokenizer_vocab"].replace("nemo:", "./")
            f = tar.extractfile(spe_path)
            if f is None:
                raise FileNotFoundError(f"Missing tokenizer file in tar: {spe_path}")
            lines = f.read().decode("utf-8").strip().split("\n")
            tokens = ["<blank>"] + [l.split("\t")[0] for l in lines]
            if len(tokens) != 257:
                raise ValueError(f"Expected 257 tokens for {lang}, got {len(tokens)}")

        extracted[lang] = tokens
        out_file = output_dir / f"{lang}_vocab.json"
        with open(out_file, "w", encoding="utf-8") as out_f:
            json.dump(tokens, out_f, ensure_ascii=False, indent=2)

    # Mirror sa_vocab.json to sanskrit_vocab.json for backward compatibility
    sa_tokens = extracted["sa"]
    with open(output_dir / "sanskrit_vocab.json", "w", encoding="utf-8") as out_f:
        json.dump(sa_tokens, out_f, ensure_ascii=False, indent=2)

    print(f"Extracted {len(extracted)} vocabularies into {output_dir}")
    return extracted


def build_modular_head_onnx(
    weight: np.ndarray,
    bias: np.ndarray,
    out_path: Path,
) -> None:
    """Exports a lightweight modular CTC projection head ONNX model (Conv1d 512 -> 257)."""
    # weight: [257, 512, 1]
    # bias: [257]
    class ModularCTCHead(nn.Module):
        def __init__(self, w: np.ndarray, b: np.ndarray):
            super().__init__()
            self.conv = nn.Conv1d(512, 257, kernel_size=1)
            self.conv.weight.data.copy_(torch.from_numpy(w))
            self.conv.bias.data.copy_(torch.from_numpy(b))

        def forward(self, encoder_output: torch.Tensor) -> torch.Tensor:
            # encoder_output: [batch, 512, time]
            logits = self.conv(encoder_output)  # [batch, 257, time]
            return logits.transpose(1, 2)  # [batch, time, 257]

    model = ModularCTCHead(weight, bias).eval()
    dummy_input = torch.randn(1, 512, 50, dtype=torch.float32)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    torch.onnx.export(
        model,
        dummy_input,
        str(out_path),
        input_names=["encoder_output"],
        output_names=["logits"],
        dynamic_axes={
            "encoder_output": {0: "batch", 2: "time"},
            "logits": {0: "batch", 1: "time"},
        },
        opset_version=17,
        do_constant_folding=True,
    )


def slice_models(
    ckpt_dict: dict,
    base_onnx_path: Path,
    output_dir: Path,
    modular: bool = True,
) -> None:
    """Slices CTC projection weights and exports per-language ONNX models."""
    output_dir.mkdir(parents=True, exist_ok=True)
    orig_w = ckpt_dict["ctc_decoder.decoder_layers.0.weight"].numpy()  # [5633, 512, 1]
    orig_b = ckpt_dict["ctc_decoder.decoder_layers.0.bias"].numpy()    # [5633]

    if not base_onnx_path.exists():
        raise FileNotFoundError(f"Base quantized ONNX model not found at {base_onnx_path}")

    base_model = onnx.load(str(base_onnx_path))

    heads_dir = output_dir / "heads"
    if modular:
        heads_dir.mkdir(parents=True, exist_ok=True)

    for lang in SWANADA_LANGUAGES:
        if lang == "en":
            # Deterministic Xavier uniform initialization with blank bound to col 5632
            rng = np.random.RandomState(42)
            bound = np.sqrt(6.0 / (512 + 257))
            w_sub = rng.uniform(-bound, bound, size=(256, 512, 1)).astype(np.float32)
            b_sub = np.zeros(256, dtype=np.float32)

            w_slice = np.concatenate([orig_w[[BLANK_COL_INDEX]], w_sub], axis=0)
            b_slice = np.concatenate([orig_b[[BLANK_COL_INDEX]], b_sub], axis=0)
        else:
            idx = TARGET_INDIC_LANGS[lang]
            cols = [BLANK_COL_INDEX] + list(range(idx * 256, (idx + 1) * 256))
            w_slice = orig_w[cols].astype(np.float32)
            b_slice = orig_b[cols].astype(np.float32)

        # 1. Monolithic sliced model: replace ctc.weight & ctc.bias in base ONNX model
        lang_model = copy.deepcopy(base_model)
        for init in lang_model.graph.initializer:
            if init.name == "ctc.weight":
                new_init = numpy_helper.from_array(w_slice, name="ctc.weight")
                init.CopyFrom(new_init)
            elif init.name == "ctc.bias":
                new_init = numpy_helper.from_array(b_slice, name="ctc.bias")
                init.CopyFrom(new_init)

        monolithic_path = output_dir / f"swanada_{lang}_ctc_int8.onnx"
        onnx.save(lang_model, str(monolithic_path))

        # 2. Modular head export
        if modular:
            head_path = heads_dir / f"head_{lang}.onnx"
            build_modular_head_onnx(w_slice, b_slice, head_path)

        print(f"Exported model for '{lang}': {monolithic_path.name}")

    # Mirror swanada_sa_ctc_int8.onnx to sushrota_sanskrit_ctc_int8.onnx if not present
    sushrota_target = output_dir / "sushrota_sanskrit_ctc_int8.onnx"
    if not sushrota_target.exists():
        import shutil
        shutil.copy2(output_dir / "swanada_sa_ctc_int8.onnx", sushrota_target)


def main() -> None:
    parser = argparse.ArgumentParser(description="Slice multilingual models and extract vocabularies for Swanada")
    parser.add_argument("--checkpoint", type=Path, default=Path(DEFAULT_CHECKPOINT), help="Path to sushrota .nemo archive")
    parser.add_argument("--vocab-dir", type=Path, default=Path("models/vocabularies"), help="Output directory for vocabularies")
    parser.add_argument("--models-dir", type=Path, default=Path("models/onnx"), help="Output directory for ONNX models")
    parser.add_argument("--base-onnx", type=Path, default=Path("models/onnx/sushrota_sanskrit_ctc_int8.onnx"), help="Base Conformer ONNX model")
    parser.add_argument("--skip-models", action="store_true", help="Skip ONNX weight slicing (vocabularies only)")
    parser.add_argument("--modular", action="store_true", default=True, help="Export modular CTC projection heads")
    args = parser.parse_args()

    checkpoint_path = args.checkpoint.resolve()
    if not checkpoint_path.exists():
        print(f"Error: Checkpoint file not found: {checkpoint_path}", file=sys.stderr)
        sys.exit(1)

    print(f"=== Swanada Multilingual Slicing Tool ===")
    print(f"Checkpoint: {checkpoint_path}")
    print(f"Vocab Dir:  {args.vocab_dir}")
    print(f"Models Dir: {args.models_dir}")

    with tarfile.open(checkpoint_path, "r") as tar:
        cfg_f = tar.extractfile("./model_config.yaml")
        if cfg_f is None:
            raise FileNotFoundError("model_config.yaml not found in checkpoint")
        cfg = yaml.safe_load(cfg_f)

        # 1. Extract vocabularies
        extract_vocabularies(tar, cfg, args.vocab_dir.resolve())

        # 2. Slice models
        if not args.skip_models:
            ckpt_f = tar.extractfile("./model_weights.ckpt")
            if ckpt_f is None:
                raise FileNotFoundError("model_weights.ckpt not found in checkpoint")
            ckpt_dict = torch.load(ckpt_f, map_location="cpu")
            slice_models(ckpt_dict, args.base_onnx.resolve(), args.models_dir.resolve(), modular=args.modular)

    print("Multilingual extraction and model slicing completed successfully.")


if __name__ == "__main__":
    main()
