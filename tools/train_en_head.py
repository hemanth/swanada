#!/usr/bin/env python3
"""Calibrates Indian English CTC head on IndicTTS-English speech data."""

from __future__ import annotations

import glob
import io
import json
import os
from pathlib import Path
import re
import wave
import numpy as np
import pyarrow.parquet as pq
import scipy.signal
import torch
import torch.nn as nn
import torch.optim as optim
import onnx
import onnxruntime as ort
from onnx import numpy_helper

ROOT = Path(__file__).resolve().parent.parent
VOCAB_PATH = ROOT / "models" / "vocabularies" / "en_vocab.json"
BASE_MODEL_PATH = ROOT / "models" / "onnx" / "sushrota_sanskrit_ctc_int8.onnx"
PREPROCESSOR_PATH = ROOT / "models" / "preprocessor.onnx"
OUTPUT_HEAD_PATH = ROOT / "models" / "onnx" / "heads" / "head_en.onnx"
OUTPUT_MONOLITHIC_PATH = ROOT / "models" / "onnx" / "swanada_en_ctc_int8.onnx"
CACHE_PATH = ROOT / "tools" / ".en_features_cache.pt"


def load_vocab():
    with open(VOCAB_PATH, "r", encoding="utf-8") as f:
        vocab = json.load(f)
    token_to_id = {tok: idx for idx, tok in enumerate(vocab)}
    return vocab, token_to_id


def tokenize_en(text: str, token_to_id: dict[str, int]) -> list[int]:
    clean_text = re.sub(r"[^a-zA-Z0-9\s.,?!]", "", text.lower()).strip()
    words = clean_text.split()
    tokens = []
    for w in words:
        rem = "\u2581" + w
        while rem:
            matched = False
            for l in range(len(rem), 0, -1):
                sub = rem[:l]
                if sub in token_to_id:
                    tokens.append(token_to_id[sub])
                    rem = rem[l:]
                    matched = True
                    break
            if not matched:
                tokens.append(token_to_id.get(rem[0], 1))
                rem = rem[1:]
    return tokens


def extract_features(num_samples: int = 250):
    if CACHE_PATH.exists():
        print(f"Loading cached features from {CACHE_PATH}...")
        return torch.load(CACHE_PATH, weights_only=False)

    print("Extracting encoder representations from IndicTTS-English...")
    prep_sess = ort.InferenceSession(str(PREPROCESSOR_PATH), providers=["CPUExecutionProvider"])
    
    base_m = onnx.load(str(BASE_MODEL_PATH))
    intermediate_tensor = onnx.helper.make_tensor_value_info("transpose_207", onnx.TensorProto.FLOAT, [None, 512, None])
    base_m.graph.output.append(intermediate_tensor)
    encoder_sess = ort.InferenceSession(base_m.SerializeToString(), providers=["CPUExecutionProvider"])

    vocab, token_to_id = load_vocab()

    parquet_files = glob.glob(os.path.expanduser("~/.cache/huggingface/hub/datasets--SPRINGLab--IndicTTS-English/snapshots/*/data/*.parquet"))
    if not parquet_files:
        raise FileNotFoundError("IndicTTS-English parquet dataset not found in ~/.cache/huggingface/hub/")

    table = pq.read_table(parquet_files[0])
    print(f"Loaded parquet table with {table.num_rows} records.")

    dataset = []
    for idx in range(min(num_samples, table.num_rows)):
        row = {col: table[col][idx].as_py() for col in table.column_names}
        audio_bytes = row["audio"]["bytes"]
        text = row["text"]

        with wave.open(io.BytesIO(audio_bytes), "rb") as wf:
            sr = wf.getframerate()
            frames = wf.readframes(wf.getnframes())
            pcm = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0

        if sr != 16000:
            pcm = scipy.signal.resample(pcm, int(len(pcm) * 16000 / sr)).astype(np.float32)

        mel = prep_sess.run(None, {"audio_signal": pcm[None, :], "length": np.array([len(pcm)], dtype=np.int64)})[0]
        enc_out = encoder_sess.run(["transpose_207"], {"audio_signal": mel, "length": np.array([mel.shape[2]], dtype=np.int64)})[0]

        tokens = tokenize_en(text, token_to_id)
        if len(tokens) > 0 and enc_out.shape[2] > len(tokens):
            dataset.append({
                "feat": torch.from_numpy(enc_out).float(),  # [1, 512, T]
                "tokens": torch.tensor(tokens, dtype=torch.long),
                "text": text,
            })

    print(f"Extracted and cached {len(dataset)} items.")
    torch.save(dataset, CACHE_PATH)
    return dataset


class EnglishCTCHead(nn.Module):
    def __init__(self, in_features: int = 512, num_classes: int = 257):
        super().__init__()
        self.conv = nn.Conv1d(in_features, num_classes, kernel_size=1)
        # Initialize with standard Xavier
        nn.init.xavier_uniform_(self.conv.weight)
        nn.init.zeros_(self.conv.bias)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: [batch, 512, time]
        logits = self.conv(x)  # [batch, 257, time]
        return logits.transpose(1, 2)  # [batch, time, 257]


def train_head(dataset: list[dict], epochs: int = 60, lr: float = 3e-3):
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    print(f"Training English CTC head on {device} ({len(dataset)} utterances)...")

    model = EnglishCTCHead().to(device)
    optimizer = optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)
    criterion = nn.CTCLoss(blank=0, zero_infinity=True)

    for epoch in range(1, epochs + 1):
        model.train()
        total_loss = 0.0
        count = 0

        for item in dataset:
            feat = item["feat"].to(device)  # [1, 512, T]
            targets = item["tokens"].to(device).unsqueeze(0)  # [1, L]

            optimizer.zero_grad()
            logits = model(feat)  # [1, T, 257]
            log_probs = logits.log_softmax(dim=-1).transpose(0, 1)  # [T, 1, 257]

            input_lengths = torch.tensor([logits.size(1)], dtype=torch.long, device=device)
            target_lengths = torch.tensor([targets.size(1)], dtype=torch.long, device=device)

            loss = criterion(log_probs, targets, input_lengths, target_lengths)
            if not torch.isnan(loss) and not torch.isinf(loss):
                loss.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=5.0)
                optimizer.step()
                total_loss += loss.item()
                count += 1

        avg_loss = total_loss / max(1, count)
        if epoch % 10 == 0 or epoch == 1:
            print(f"Epoch {epoch:2d}/{epochs:2d} — CTCLoss: {avg_loss:.4f}")

    return model.cpu()


def export_models(head_model: EnglishCTCHead):
    print("Exporting trained English head to ONNX...")
    w = head_model.conv.weight.data.numpy()  # [257, 512, 1]
    b = head_model.conv.bias.data.numpy()    # [257]

    print(f"Trained weight norm: {np.linalg.norm(w):.2f}, bias norm: {np.linalg.norm(b):.2f}")

    # 1. Modular head
    OUTPUT_HEAD_PATH.parent.mkdir(parents=True, exist_ok=True)
    dummy_input = torch.randn(1, 512, 50, dtype=torch.float32)
    torch.onnx.export(
        head_model,
        dummy_input,
        str(OUTPUT_HEAD_PATH),
        input_names=["encoder_output"],
        output_names=["logits"],
        dynamic_axes={
            "encoder_output": {0: "batch", 2: "time"},
            "logits": {0: "batch", 1: "time"},
        },
        opset_version=17,
        do_constant_folding=True,
    )
    print(f"Saved modular head to {OUTPUT_HEAD_PATH}")

    # 2. Monolithic INT8 model
    base_model = onnx.load(str(BASE_MODEL_PATH))
    for init in base_model.graph.initializer:
        if init.name == "ctc.weight":
            init.CopyFrom(numpy_helper.from_array(w, name="ctc.weight"))
        elif init.name == "ctc.bias":
            init.CopyFrom(numpy_helper.from_array(b, name="ctc.bias"))

    onnx.save(base_model, str(OUTPUT_MONOLITHIC_PATH))
    print(f"Saved monolithic INT8 model to {OUTPUT_MONOLITHIC_PATH}")


def main():
    dataset = extract_features(num_samples=250)
    trained_head = train_head(dataset, epochs=50, lr=3e-3)
    export_models(trained_head)
    print("English CTC head calibration complete!")


if __name__ == "__main__":
    main()
