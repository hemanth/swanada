#!/usr/bin/env python3
"""Calibrates Indian English CTC head on IndicTTS-English with strict train/val/test separation and regularization."""

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
CACHE_PATH = ROOT / "tools" / ".en_features_cache_v2.pt"
TEST_SUITE_PATH = ROOT / "bench" / "test_speech_suite.jsonl"


def normalize_key(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def load_heldout_keys() -> set[str]:
    heldout = {normalize_key("The king was troubled with jealousy.")}
    if TEST_SUITE_PATH.exists():
        with open(TEST_SUITE_PATH, "r", encoding="utf-8") as f:
            for line in f:
                if not line.strip():
                    continue
                obj = json.loads(line)
                if obj.get("lang") == "en":
                    heldout.add(normalize_key(obj["text"]))
    return heldout


def load_vocab() -> tuple[list[str], dict[str, int]]:
    with open(VOCAB_PATH, "r", encoding="utf-8") as f:
        vocab = json.load(f)
    token_to_id = {tok: idx for idx, tok in enumerate(vocab)}
    return vocab, token_to_id


def tokenize_en(text: str, token_to_id: dict[str, int]) -> list[int]:
    clean_text = re.sub(r"[^a-zA-Z0-9\s.,?!']", "", text.lower()).strip()
    words = clean_text.split()
    tokens: list[int] = []
    for w in words:
        rem = "\u2581" + w
        while rem:
            matched = False
            for length in range(len(rem), 0, -1):
                sub = rem[:length]
                if sub in token_to_id:
                    tokens.append(token_to_id[sub])
                    rem = rem[length:]
                    matched = True
                    break
            if not matched:
                tokens.append(token_to_id.get(rem[0], 1))
                rem = rem[1:]
    return tokens


def greedy_decode(logits_2d: np.ndarray, vocab: list[str]) -> str:
    preds = logits_2d.argmax(axis=-1)
    chars: list[str] = []
    prev = -1
    for p in preds:
        idx = int(p)
        if idx != 0 and idx != prev and idx < len(vocab):
            tok = vocab[idx]
            if tok not in ("<blank>", "<unk>"):
                chars.append(tok)
        prev = idx
    return "".join(chars).replace("\u2581", " ").strip()


def edit_distance(a: str, b: str) -> int:
    if not a:
        return len(b)
    if not b:
        return len(a)
    dp = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        prev = dp[0]
        dp[0] = i
        for j, cb in enumerate(b, 1):
            cur = dp[j]
            dp[j] = prev if ca == cb else 1 + min(prev, dp[j], dp[j - 1])
            prev = cur
    return dp[-1]


def extract_features(max_samples: int = 1800) -> list[dict]:
    heldout = load_heldout_keys()
    if CACHE_PATH.exists():
        print(f"Loading cached disjoint features from {CACHE_PATH}...")
        cached = torch.load(CACHE_PATH, weights_only=False)
        filtered = [x for x in cached if normalize_key(x["text"]) not in heldout]
        if len(filtered) >= 1200:
            return filtered

    print(f"Extracting up to {max_samples} held-out-disjoint utterances from IndicTTS-English...")
    sess_opts = ort.SessionOptions()
    sess_opts.intra_op_num_threads = 6
    prep_sess = ort.InferenceSession(str(PREPROCESSOR_PATH), sess_options=sess_opts, providers=["CPUExecutionProvider"])

    base_m = onnx.load(str(BASE_MODEL_PATH))
    intermediate_tensor = onnx.helper.make_tensor_value_info("transpose_207", onnx.TensorProto.FLOAT, [None, 512, None])
    base_m.graph.output.append(intermediate_tensor)
    encoder_sess = ort.InferenceSession(base_m.SerializeToString(), sess_options=sess_opts, providers=["CPUExecutionProvider"])

    _, token_to_id = load_vocab()

    parquet_files = sorted(
        glob.glob(os.path.expanduser("~/.cache/huggingface/hub/datasets--SPRINGLab--IndicTTS-English/snapshots/*/data/*.parquet"))
    )
    if not parquet_files:
        raise FileNotFoundError("IndicTTS-English parquet dataset not found in ~/.cache/huggingface/hub/")

    table = pq.read_table(parquet_files[0])
    total_rows = table.num_rows
    print(f"Loaded parquet table with {total_rows} records (excluding {len(heldout)} held-out test prompts).")

    # Evenly stride across the full 5,416-utterance corpus for phonetic & speaker diversity
    rng = np.random.default_rng(42)
    indices = rng.permutation(total_rows)

    dataset: list[dict] = []
    skipped_heldout = 0
    for raw_idx in indices:
        if len(dataset) >= max_samples:
            break
        idx = int(raw_idx)
        text = table["text"][idx].as_py()
        if normalize_key(text) in heldout:
            skipped_heldout += 1
            continue

        audio_bytes = table["audio"][idx].as_py()["bytes"]
        with wave.open(io.BytesIO(audio_bytes), "rb") as wf:
            sr = wf.getframerate()
            frames = wf.readframes(wf.getnframes())
            pcm = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0

        if len(pcm) < 4000 or len(pcm) > 16000 * 14:
            continue

        if sr != 16000:
            pcm = scipy.signal.resample_poly(pcm, 16000, sr).astype(np.float32) if sr % 100 == 0 else scipy.signal.resample(pcm, int(len(pcm) * 16000 / sr)).astype(np.float32)

        mel = prep_sess.run(None, {"audio_signal": pcm[None, :], "length": np.array([len(pcm)], dtype=np.int64)})[0]
        enc_out = encoder_sess.run(["transpose_207"], {"audio_signal": mel, "length": np.array([mel.shape[2]], dtype=np.int64)})[0]

        tokens = tokenize_en(text, token_to_id)
        if len(tokens) > 0 and enc_out.shape[2] > len(tokens) + 2:
            dataset.append({
                "feat": torch.from_numpy(enc_out).half(),  # store FP16 on disk for speed
                "tokens": torch.tensor(tokens, dtype=torch.long),
                "text": text,
            })
            if len(dataset) % 250 == 0:
                print(f"  Extracted {len(dataset)}/{max_samples} utterances...")

    print(f"Extracted {len(dataset)} utterances (strictly skipped {skipped_heldout} held-out matches).")
    torch.save(dataset, CACHE_PATH)
    return dataset


class EnglishCTCHead(nn.Module):
    def __init__(self, in_features: int = 512, num_classes: int = 257, dropout: float = 0.15):
        super().__init__()
        self.drop = nn.Dropout(dropout)
        self.conv = nn.Conv1d(in_features, num_classes, kernel_size=1)
        nn.init.xavier_uniform_(self.conv.weight)
        nn.init.zeros_(self.conv.bias)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        logits = self.conv(self.drop(x))
        return logits.transpose(1, 2)


def train_head(dataset: list[dict], vocab: list[str], epochs: int = 75, lr: float = 2.5e-3) -> EnglishCTCHead:
    # Cpu is super fast for 1x1 conv on cached [1, 512, T] tensors and supports CTCLoss natively without MPS fallback overhead
    device = torch.device("cpu")
    val_size = min(180, max(60, len(dataset) // 10))
    train_set = dataset[:-val_size]
    val_set = dataset[-val_size:]
    print(f"Training regularized English CTC head: {len(train_set)} train / {len(val_set)} val utterances...")

    model = EnglishCTCHead(dropout=0.15).to(device)
    optimizer = optim.AdamW(model.parameters(), lr=lr, weight_decay=3e-4)
    scheduler = optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs, eta_min=1e-4)
    criterion = nn.CTCLoss(blank=0, zero_infinity=True)

    best_val_cer = 1.0
    best_state = None
    rng = np.random.default_rng(108)

    for epoch in range(1, epochs + 1):
        model.train()
        total_loss = 0.0
        count = 0
        order = rng.permutation(len(train_set))

        # Mini-batch accumulation of 8 utterances for smoother gradients
        optimizer.zero_grad()
        accum = 0
        for idx in order:
            item = train_set[int(idx)]
            feat = item["feat"].float().to(device)  # [1, 512, T]
            # Feature-space Gaussian noise + random time-frame masking (SpecAugment equivalent)
            feat = feat + 0.03 * torch.randn_like(feat)
            t_len = feat.size(2)
            if t_len > 24 and rng.random() < 0.5:
                mask_w = int(rng.integers(2, min(8, t_len // 6)))
                mask_t0 = int(rng.integers(0, t_len - mask_w))
                feat[:, :, mask_t0:mask_t0 + mask_w] = 0.0

            targets = item["tokens"].to(device).unsqueeze(0)
            logits = model(feat)
            log_probs = logits.log_softmax(dim=-1).transpose(0, 1)

            input_lengths = torch.tensor([logits.size(1)], dtype=torch.long, device=device)
            target_lengths = torch.tensor([targets.size(1)], dtype=torch.long, device=device)

            loss = criterion(log_probs, targets, input_lengths, target_lengths)
            if not torch.isnan(loss) and not torch.isinf(loss):
                (loss / 8.0).backward()
                total_loss += loss.item()
                count += 1
                accum += 1
                if accum == 8:
                    torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=5.0)
                    optimizer.step()
                    optimizer.zero_grad()
                    accum = 0

        if accum > 0:
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=5.0)
            optimizer.step()
            optimizer.zero_grad()

        scheduler.step()
        avg_loss = total_loss / max(1, count)

        if epoch % 5 == 0 or epoch == 1 or epoch == epochs:
            model.eval()
            val_edits = 0
            val_chars = 0
            with torch.no_grad():
                for v_item in val_set:
                    v_feat = v_item["feat"].float().to(device)
                    v_logits = model(v_feat)[0].cpu().numpy()
                    hyp = greedy_decode(v_logits, vocab)
                    ref = re.sub(r"[^a-z0-9\s.,?!']", "", v_item["text"].lower()).strip()
                    val_edits += edit_distance(hyp, ref)
                    val_chars += max(1, len(ref))
            val_cer = val_edits / max(1, val_chars)
            print(f"Epoch {epoch:2d}/{epochs:2d} — Train CTCLoss: {avg_loss:.4f} | Val CER: {val_cer*100:.2f}%")
            if val_cer < best_val_cer:
                best_val_cer = val_cer
                best_state = {k: v.detach().clone() for k, v in model.state_dict().items()}

    if best_state is not None:
        model.load_state_dict(best_state)
    model.eval()
    print(f"Selected best validation checkpoint with Val CER = {best_val_cer*100:.2f}%")
    return model


def export_models(head_model: EnglishCTCHead) -> None:
    print("Exporting generalized English CTC head to ONNX...")
    w = head_model.conv.weight.data.numpy()  # [257, 512, 1]
    b = head_model.conv.bias.data.numpy()    # [257]

    # Export clean inference module without dropout wrapper
    export_mod = nn.Conv1d(512, 257, kernel_size=1)
    export_mod.weight.data.copy_(head_model.conv.weight.data)
    export_mod.bias.data.copy_(head_model.conv.bias.data)

    class CleanExportHead(nn.Module):
        def __init__(self, conv: nn.Conv1d):
            super().__init__()
            self.conv = conv

        def forward(self, x: torch.Tensor) -> torch.Tensor:
            return self.conv(x).transpose(1, 2)

    clean_head = CleanExportHead(export_mod).eval()
    OUTPUT_HEAD_PATH.parent.mkdir(parents=True, exist_ok=True)
    dummy_input = torch.randn(1, 512, 50, dtype=torch.float32)
    torch.onnx.export(
        clean_head,
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

    base_model = onnx.load(str(BASE_MODEL_PATH))
    for init in base_model.graph.initializer:
        if init.name == "ctc.weight":
            init.CopyFrom(numpy_helper.from_array(w, name="ctc.weight"))
        elif init.name == "ctc.bias":
            init.CopyFrom(numpy_helper.from_array(b, name="ctc.bias"))

    onnx.save(base_model, str(OUTPUT_MONOLITHIC_PATH))
    print(f"Saved monolithic INT8 model to {OUTPUT_MONOLITHIC_PATH}")


def main() -> None:
    vocab, _ = load_vocab()
    dataset = extract_features(max_samples=1600)
    trained_head = train_head(dataset, vocab, epochs=75, lr=2.5e-3)
    export_models(trained_head)
    print("Regularized English CTC head calibration complete!")


if __name__ == "__main__":
    main()
