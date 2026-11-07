#!/usr/bin/env python3
"""Multi-language CTC Projection Head Calibration on GCP GPU.

Calibrates linear CTC projection heads for target languages (en, kn, ml, gu, or)
over frozen Conformer acoustic backbone representations with AdamW and CTCLoss.
Exports calibrated binary heads (docs/heads/<lang>.bin), modular ONNX models
(models/onnx/heads/head_<lang>.onnx), and updated monolithic ONNX models
(models/onnx/swanada_<lang>_ctc_int8.onnx) with numerical parity verification.
"""

from __future__ import annotations

import argparse
import copy
import io
import json
import logging
import os
from pathlib import Path
import re
import sys
import time
from typing import Dict, List, Optional, Tuple

import numpy as np
import onnx
from onnx import helper, numpy_helper, TensorProto
import onnxruntime as ort
import scipy.signal
import soundfile as sf
import torch
import torch.nn as nn
import torch.optim as optim

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] [calibrate] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("calibrate")


def normalize_text_key(text: str) -> str:
    """Normalize text string for held-out key collision checking."""
    return re.sub(r"\s+", " ", text.strip().lower())


def load_heldout_prompts(test_suite_path: Path) -> set[str]:
    """Load held-out evaluation transcripts to prevent test set contamination."""
    heldout = {
        normalize_text_key("The king was troubled with jealousy."),
        normalize_text_key("ಹಾಗಾಗಿ ಬ್ಯಾಂಕ್ ಇದ್ನ ಸ್ಥಗಿತಗೊಳ್ಸಿದೆ"),
        normalize_text_key("ഉമ്മായ്ക്കതിൽ പരിപൂർണവിശ്വാസമുണ്ട്"),
        normalize_text_key("જો એવું હોય તો હું બસથી જઈશ."),
        normalize_text_key("ସନ୍ଧ୍ୟାଙ୍କୁ ଇମେଲ କରି ଏହା ଲେଖ"),
    }
    if test_suite_path.exists():
        with open(test_suite_path, "r", encoding="utf-8") as f:
            for line in f:
                if not line.strip():
                    continue
                try:
                    obj = json.loads(line)
                    txt = obj.get("text") or obj.get("transcript") or ""
                    if txt:
                        heldout.add(normalize_text_key(txt))
                except Exception:
                    continue
    logger.info("Loaded %d held-out prompt keys for contamination filtering.", len(heldout))
    return heldout


def load_vocabulary(vocab_path: Path) -> Tuple[List[str], Dict[str, int]]:
    """Load per-language vocabulary tokens and build token-to-id mapping."""
    with open(vocab_path, "r", encoding="utf-8") as f:
        vocab = json.load(f)
    token_to_id = {tok: idx for idx, tok in enumerate(vocab)}
    assert len(vocab) == 257, f"Expected 257 tokens, got {len(vocab)} in {vocab_path}"
    assert vocab[0] == "<blank>", f"Index 0 must be <blank> in {vocab_path}"
    return vocab, token_to_id


def tokenize_text(text: str, token_to_id: Dict[str, int]) -> List[int]:
    """Tokenize text using SentencePiece forward longest-match with word prefix."""
    words = text.strip().split()
    tokens: List[int] = []
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


def greedy_decode_logits(logits_2d: np.ndarray, vocab: List[str]) -> str:
    """Greedy CTC argmax decoding with blank filtering and repeat collapsing."""
    preds = logits_2d.argmax(axis=-1)
    chars: List[str] = []
    prev = -1
    for p in preds:
        idx = int(p)
        if idx != 0 and idx != prev and idx < len(vocab):
            tok = vocab[idx]
            if tok not in ("<blank>", "<unk>"):
                chars.append(tok)
        prev = idx
    return "".join(chars).replace("\u2581", " ").strip()


def calculate_edit_distance(hyp: str, ref: str) -> int:
    """Compute Levenshtein character edit distance between hypothesis and reference."""
    if not hyp:
        return len(ref)
    if not ref:
        return len(hyp)
    dp = list(range(len(ref) + 1))
    for i, ch_hyp in enumerate(hyp, 1):
        prev = dp[0]
        dp[0] = i
        for j, ch_ref in enumerate(ref, 1):
            cur = dp[j]
            dp[j] = prev if ch_hyp == ch_ref else 1 + min(prev, dp[j], dp[j - 1])
            prev = cur
    return dp[-1]


class LinearCTCProjectionHead(nn.Module):
    """Linear CTC projection head (Conv1d 512 -> 257) with dropout regularization."""

    def __init__(self, in_features: int = 512, num_classes: int = 257, dropout: float = 0.15):
        super().__init__()
        self.drop = nn.Dropout(dropout)
        self.conv = nn.Conv1d(in_features, num_classes, kernel_size=1)
        nn.init.xavier_uniform_(self.conv.weight)
        nn.init.zeros_(self.conv.bias)

    def load_warmstart_weights(self, weight: np.ndarray, bias: np.ndarray) -> None:
        """Initialize projection layer from prior weights."""
        if weight.ndim == 2:
            weight = weight[:, :, None]
        w_copy = np.ascontiguousarray(weight, dtype=np.float32).copy()
        b_copy = np.ascontiguousarray(bias, dtype=np.float32).copy()
        self.conv.weight.data.copy_(torch.from_numpy(w_copy))
        self.conv.bias.data.copy_(torch.from_numpy(b_copy))
        logger.info(
            "Warm-started projection head: weight norm=%.2f, bias norm=%.2f",
            float(torch.linalg.norm(self.conv.weight.detach())),
            float(torch.linalg.norm(self.conv.bias.detach())),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """Forward pass taking [batch, 512, time] returning [batch, time, 257]."""
        logits = self.conv(self.drop(x))
        return logits.transpose(1, 2)


class FeatureExtractor:
    """Extracts hidden representations (transpose_207) from frozen Conformer backbone."""

    def __init__(self, base_model_path: Path, preprocessor_path: Path):
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = 4
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL

        logger.info("Initializing preprocessor session from %s", preprocessor_path)
        self.prep_sess = ort.InferenceSession(str(preprocessor_path), sess_options=opts, providers=["CPUExecutionProvider"])

        logger.info("Initializing Conformer encoder session with intermediate tap transpose_207...")
        base_proto = onnx.load(str(base_model_path))
        base_proto.graph.output.append(
            helper.make_tensor_value_info("transpose_207", TensorProto.FLOAT, [None, 512, None])
        )
        self.enc_sess = ort.InferenceSession(base_proto.SerializeToString(), sess_options=opts, providers=["CPUExecutionProvider"])

    def extract_features(self, pcm_16k: np.ndarray) -> np.ndarray:
        """Extract [1, 512, T] hidden feature representation from 16 kHz audio array."""
        pcm = pcm_16k.astype(np.float32)
        if pcm.ndim > 1:
            pcm = pcm.mean(axis=-1)
        # Normalize amplitude range
        max_val = np.max(np.abs(pcm))
        if max_val > 1.0:
            pcm = pcm / max_val

        mel = self.prep_sess.run(None, {"audio_signal": pcm[None, :], "length": np.array([len(pcm)], dtype=np.int64)})[0]
        enc_out = self.enc_sess.run(["transpose_207"], {"audio_signal": mel, "length": np.array([mel.shape[2]], dtype=np.int64)})[0]
        return enc_out


def train_single_language_head(
    lang: str,
    dataset: List[dict],
    vocab: List[str],
    device: torch.device,
    epochs: int = 60,
    lr: float = 2.0e-3,
    weight_decay: float = 3.0e-4,
    initial_weights: Optional[Tuple[np.ndarray, np.ndarray]] = None,
) -> LinearCTCProjectionHead:
    """Train linear projection head on paired speech features with AdamW and CTCLoss."""
    val_size = min(60, max(20, len(dataset) // 8))
    train_set = dataset[:-val_size]
    val_set = dataset[-val_size:]

    logger.info("[%s] Beginning calibration: %d train utterances, %d val utterances.", lang, len(train_set), len(val_set))
    model = LinearCTCProjectionHead(dropout=0.15).to(device)
    if initial_weights is not None:
        model.load_warmstart_weights(initial_weights[0], initial_weights[1])

    optimizer = optim.AdamW(model.parameters(), lr=lr, weight_decay=weight_decay)
    scheduler = optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs, eta_min=1.0e-4)
    criterion = nn.CTCLoss(blank=0, zero_infinity=True)

    best_val_cer = 1.0
    best_state: Optional[dict] = None
    rng = np.random.default_rng(108)

    for epoch in range(1, epochs + 1):
        model.train()
        total_loss = 0.0
        sample_count = 0
        order = rng.permutation(len(train_set))

        optimizer.zero_grad()
        accum = 0

        for idx in order:
            item = train_set[int(idx)]
            feat = item["feat"].float().to(device)  # [1, 512, T]

            # Regularization: Gaussian noise + random time-frame masking
            feat = feat + 0.03 * torch.randn_like(feat)
            t_len = feat.size(2)
            if t_len > 20 and rng.random() < 0.5:
                mask_w = int(rng.integers(2, min(8, max(3, t_len // 6))))
                mask_t0 = int(rng.integers(0, max(1, t_len - mask_w)))
                feat[:, :, mask_t0:mask_t0 + mask_w] = 0.0

            targets = item["tokens"].to(device).unsqueeze(0)
            logits = model(feat)  # [1, T, 257]
            log_probs = logits.log_softmax(dim=-1).transpose(0, 1)  # [T, 1, 257]

            input_lengths = torch.tensor([logits.size(1)], dtype=torch.long, device=device)
            target_lengths = torch.tensor([targets.size(1)], dtype=torch.long, device=device)

            loss = criterion(log_probs, targets, input_lengths, target_lengths)
            if not torch.isnan(loss) and not torch.isinf(loss):
                (loss / 8.0).backward()
                total_loss += loss.item()
                sample_count += 1
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
        avg_loss = total_loss / max(1, sample_count)

        if epoch % 5 == 0 or epoch == 1 or epoch == epochs:
            model.eval()
            val_edits = 0
            val_chars = 0
            with torch.no_grad():
                for v_item in val_set:
                    v_feat = v_item["feat"].float().to(device)
                    v_logits = model(v_feat)[0].cpu().numpy()
                    hyp = greedy_decode_logits(v_logits, vocab)
                    ref = v_item["text"].strip()
                    val_edits += calculate_edit_distance(hyp, ref)
                    val_chars += max(1, len(ref))
            val_cer = val_edits / max(1, val_chars)
            logger.info("[%s] Epoch %2d/%2d — Train CTCLoss: %.4f | Val CER: %.2f%%", lang, epoch, epochs, avg_loss, val_cer * 100)

            if val_cer <= best_val_cer or best_state is None:
                best_val_cer = val_cer
                best_state = {k: v.detach().clone() for k, v in model.state_dict().items()}

    if best_state is not None:
        model.load_state_dict(best_state)
    model.eval()
    logger.info("[%s] Calibration complete. Selected best checkpoint with Val CER = %.2f%%", lang, best_val_cer * 100)
    return model


def export_calibrated_artifacts(
    lang: str,
    model: LinearCTCProjectionHead,
    base_model_path: Path,
    out_dir: Path,
) -> Tuple[Path, Path, Path]:
    """Export binary head, modular ONNX head, and updated monolithic model."""
    heads_bin_dir = out_dir / "heads_bin"
    heads_onnx_dir = out_dir / "heads_onnx"
    mono_onnx_dir = out_dir / "monolithic_onnx"
    heads_bin_dir.mkdir(parents=True, exist_ok=True)
    heads_onnx_dir.mkdir(parents=True, exist_ok=True)
    mono_onnx_dir.mkdir(parents=True, exist_ok=True)

    weight_data = model.conv.weight.data.cpu().numpy()  # [257, 512, 1]
    bias_data = model.conv.bias.data.cpu().numpy()      # [257]

    w_flat = weight_data.reshape(257, 512).astype("<f4")
    b_flat = bias_data.reshape(257).astype("<f4")

    # 1. Export binary head (exactly 527,364 bytes)
    bin_path = heads_bin_dir / f"{lang}.bin"
    with open(bin_path, "wb") as f:
        f.write(w_flat.tobytes())
        f.write(b_flat.tobytes())

    bin_size = bin_path.stat().st_size
    assert bin_size == 527364, f"Binary head size error: {bin_size} != 527364"
    w_norm = float(np.linalg.norm(w_flat))
    assert w_norm > 10.0, f"Weight norm error: {w_norm} <= 10.0"
    logger.info("[%s] Exported binary head %s (%d bytes, weight norm=%.2f)", lang, bin_path.name, bin_size, w_norm)

    # 2. Export modular ONNX head
    head_onnx_path = heads_onnx_dir / f"head_{lang}.onnx"

    class ModularHeadExport(nn.Module):
        def __init__(self, w: np.ndarray, b: np.ndarray):
            super().__init__()
            self.conv = nn.Conv1d(512, 257, kernel_size=1)
            self.conv.weight.data.copy_(torch.from_numpy(w.copy()))
            self.conv.bias.data.copy_(torch.from_numpy(b.copy()))

        def forward(self, encoder_output: torch.Tensor) -> torch.Tensor:
            return self.conv(encoder_output).transpose(1, 2)

    export_module = ModularHeadExport(weight_data, bias_data).eval()
    dummy_input = torch.randn(1, 512, 50, dtype=torch.float32)
    torch.onnx.export(
        export_module,
        dummy_input,
        str(head_onnx_path),
        input_names=["encoder_output"],
        output_names=["logits"],
        dynamic_axes={
            "encoder_output": {0: "batch", 2: "time"},
            "logits": {0: "batch", 1: "time"},
        },
        opset_version=17,
        do_constant_folding=True,
    )
    logger.info("[%s] Exported modular ONNX head %s", lang, head_onnx_path.name)

    # 3. Export monolithic model
    mono_path = mono_onnx_dir / f"swanada_{lang}_ctc_int8.onnx"
    base_model = onnx.load(str(base_model_path))
    for init in base_model.graph.initializer:
        if init.name == "ctc.weight":
            init.CopyFrom(numpy_helper.from_array(weight_data.astype(np.float32), name="ctc.weight"))
        elif init.name == "ctc.bias":
            init.CopyFrom(numpy_helper.from_array(bias_data.astype(np.float32), name="ctc.bias"))
    onnx.save(base_model, str(mono_path))
    logger.info("[%s] Exported monolithic ONNX model %s", lang, mono_path.name)

    # 4. Verify numerical parity
    verify_parity(base_model_path, w_flat, b_flat, mono_path)
    return bin_path, head_onnx_path, mono_path


def verify_parity(base_model_path: Path, weight: np.ndarray, bias: np.ndarray, mono_path: Path) -> None:
    """Verify bit-exact numerical parity between linear projection and monolithic model."""
    base_proto = onnx.load(str(base_model_path))
    base_proto.graph.output.append(
        helper.make_tensor_value_info("layer_norm_84", TensorProto.FLOAT, ["batch", "time_sub", 512])
    )
    enc_sess = ort.InferenceSession(base_proto.SerializeToString(), providers=["CPUExecutionProvider"])
    mono_sess = ort.InferenceSession(str(mono_path), providers=["CPUExecutionProvider"])

    rng = np.random.RandomState(42)
    dummy_mel = rng.randn(1, 80, 100).astype(np.float32)
    dummy_len = np.array([100], dtype=np.int64)

    _, hidden = enc_sess.run(["logits", "layer_norm_84"], {"audio_signal": dummy_mel, "length": dummy_len})
    (mono_logits,) = mono_sess.run(["logits"], {"audio_signal": dummy_mel, "length": dummy_len})

    proj_logits = hidden[0] @ weight.T + bias
    max_diff = float(np.max(np.abs(mono_logits[0] - proj_logits)))
    argmax_equal = bool(np.array_equal(np.argmax(mono_logits[0], axis=-1), np.argmax(proj_logits, axis=-1)))
    logger.info("Numerical parity check: max_diff=%.2e, argmax_100%%_equal=%s", max_diff, argmax_equal)
    assert max_diff < 1e-4 and argmax_equal, f"Parity verification failed: max_diff={max_diff}"


def load_dataset_for_language(
    lang: str,
    payload_dir: Path,
    extractor: FeatureExtractor,
    vocab: List[str],
    token_to_id: Dict[str, int],
    heldout_prompts: set[str],
    max_samples: int = 1200,
) -> List[dict]:
    """Assemble paired speech features and token sequences for target language."""
    dataset: List[dict] = []

    # Priority 1: Pre-extracted feature cache if available
    en_cache = payload_dir / "tools" / ".en_features_cache_v2.pt"
    if lang == "en" and en_cache.exists():
        logger.info("[en] Loading cached features from %s", en_cache)
        cached = torch.load(en_cache, weights_only=False)
        for item in cached:
            if normalize_text_key(item["text"]) not in heldout_prompts:
                dataset.append(item)
                if len(dataset) >= max_samples:
                    break
        logger.info("[en] Loaded %d cached utterances.", len(dataset))
        return dataset

    # Priority 2: Staged local wav directories and manifests in payload
    manifest_candidates = [
        payload_dir / f"{lang}_train.jsonl",
        payload_dir / "data" / "train_meta.jsonl",
        payload_dir / "bench" / f"{lang}_train.jsonl",
    ]
    for man_path in manifest_candidates:
        if man_path.exists():
            logger.info("[%s] Reading utterances from manifest: %s", lang, man_path)
            with open(man_path, "r", encoding="utf-8") as f:
                for line in f:
                    if len(dataset) >= max_samples:
                        break
                    if not line.strip():
                        continue
                    obj = json.loads(line)
                    if obj.get("lang") != lang:
                        continue
                    text = obj.get("native_text") or obj.get("text") or ""
                    if not text or normalize_text_key(text) in heldout_prompts:
                        continue
                    wav_path_str = obj.get("wav_relpath") or obj.get("wav_path") or ""
                    cand_wav = payload_dir / wav_path_str
                    if not cand_wav.exists():
                        cand_wav = payload_dir / "data" / "wavs" / Path(wav_path_str).name
                    if not cand_wav.exists():
                        continue

                    try:
                        audio, sr = sf.read(str(cand_wav))
                        if sr != 16000:
                            audio = scipy.signal.resample(audio, int(round(len(audio) * 16000 / sr))).astype(np.float32)
                        feat = extractor.extract_features(audio)
                        tokens = tokenize_text(text, token_to_id)
                        if len(tokens) > 0 and feat.shape[2] > len(tokens) + 2:
                            dataset.append({
                                "feat": torch.from_numpy(feat).half(),
                                "tokens": torch.tensor(tokens, dtype=torch.long),
                                "text": text,
                            })
                    except Exception as exc:
                        logger.warning("Error processing %s: %s", cand_wav, exc)

    if len(dataset) >= 100:
        logger.info("[%s] Assembled %d utterances from local manifests.", lang, len(dataset))
        return dataset

    # Priority 3: Download from Hugging Face public dataset (google/fleurs)
    logger.info("[%s] Fetching utterances from google/fleurs...", lang)
    fleurs_code = f"{lang}_in"
    try:
        from datasets import load_dataset, Audio
        ds = load_dataset("google/fleurs", fleurs_code, split="train").cast_column("audio", Audio(decode=False))
        logger.info("[%s] Loaded %d raw fleurs records.", lang, len(ds))

        skipped = 0
        for row in ds:
            if len(dataset) >= max_samples:
                break
            text = row.get("transcription") or row.get("raw_transcription") or ""
            if not text or normalize_text_key(text) in heldout_prompts:
                skipped += 1
                continue

            audio_bytes = row["audio"]["bytes"]
            audio, sr = sf.read(io.BytesIO(audio_bytes))
            if sr != 16000:
                audio = scipy.signal.resample(audio, int(round(len(audio) * 16000 / sr))).astype(np.float32)

            # Keep utterance length reasonable (0.5s to 12s)
            if len(audio) < 8000 or len(audio) > 16000 * 12:
                continue

            feat = extractor.extract_features(audio)
            tokens = tokenize_text(text, token_to_id)
            if len(tokens) > 0 and feat.shape[2] > len(tokens) + 2:
                dataset.append({
                    "feat": torch.from_numpy(feat).half(),
                    "tokens": torch.tensor(tokens, dtype=torch.long),
                    "text": text,
                })
                if len(dataset) % 100 == 0:
                    logger.info("  [%s] Extracted %d/%d utterances...", lang, len(dataset), max_samples)

        logger.info("[%s] Finished extracting %d utterances from fleurs (skipped %d).", lang, len(dataset), skipped)
    except Exception as exc:
        logger.error("[%s] Error loading dataset from fleurs: %s", lang, exc)

    return dataset


def load_existing_head_weights(lang: str, payload_dir: Path) -> Optional[Tuple[np.ndarray, np.ndarray]]:
    """Load existing projection weights for warm-start if present."""
    # Check binary head first
    bin_path = payload_dir / "docs" / "heads" / f"{lang}.bin"
    if bin_path.exists() and bin_path.stat().st_size == 527364:
        raw = bin_path.read_bytes()
        floats = np.frombuffer(raw, dtype="<f4")
        w = floats[:131584].reshape(257, 512, 1)
        b = floats[131584:]
        logger.info("[%s] Loaded warmstart weights from %s", lang, bin_path)
        return w, b

    # Check modular ONNX head
    head_onnx = payload_dir / "models" / "onnx" / "heads" / f"head_{lang}.onnx"
    if head_onnx.exists():
        m = onnx.load(str(head_onnx))
        w = None
        b = None
        for init in m.graph.initializer:
            arr = numpy_helper.to_array(init).astype(np.float32)
            if "weight" in init.name:
                w = arr
            elif "bias" in init.name:
                b = arr
        if w is not None and b is not None:
            if w.ndim == 2:
                w = w[:, :, None]
            logger.info("[%s] Loaded warmstart weights from %s", lang, head_onnx)
            return w, b

    return None


def main() -> None:
    parser = argparse.ArgumentParser(description="Multi-language CTC Head Calibration on GCP GPU")
    parser.add_argument("--languages", nargs="+", default=["en", "kn", "ml", "gu", "or"], help="Target languages")
    parser.add_argument("--epochs", type=int, default=60, help="Training epochs per language")
    parser.add_argument("--lr", type=float, default=2.0e-3, help="Peak learning rate for AdamW")
    parser.add_argument("--payload-dir", type=Path, default=Path("."), help="Payload base directory")
    parser.add_argument("--output-dir", type=Path, default=Path("exported_artifacts"), help="Output directory")
    args = parser.parse_args()

    payload_dir = args.payload_dir.resolve()
    out_dir = args.output_dir.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    base_model = payload_dir / "models" / "onnx" / "sushrota_sanskrit_ctc_int8.onnx"
    preprocessor = payload_dir / "models" / "preprocessor.onnx"
    test_suite = payload_dir / "bench" / "test_speech_suite.jsonl"

    assert base_model.exists(), f"Base model missing: {base_model}"
    assert preprocessor.exists(), f"Preprocessor missing: {preprocessor}"

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    logger.info("Running calibration on compute device: %s", device)

    heldout_prompts = load_heldout_prompts(test_suite)
    extractor = FeatureExtractor(base_model, preprocessor)

    results_summary: Dict[str, dict] = {}

    for lang in args.languages:
        logger.info("==================================================")
        logger.info("Starting CTC Projection Head Calibration for: %s", lang)
        logger.info("==================================================")

        vocab_path = payload_dir / "models" / "vocabularies" / f"{lang}_vocab.json"
        assert vocab_path.exists(), f"Vocabulary missing: {vocab_path}"
        vocab, token_to_id = load_vocabulary(vocab_path)

        dataset = load_dataset_for_language(
            lang=lang,
            payload_dir=payload_dir,
            extractor=extractor,
            vocab=vocab,
            token_to_id=token_to_id,
            heldout_prompts=heldout_prompts,
            max_samples=1200,
        )
        assert len(dataset) >= 50, f"Insufficient dataset size for {lang}: {len(dataset)} items"

        warmstart_wb = load_existing_head_weights(lang, payload_dir)
        trained_head = train_single_language_head(
            lang=lang,
            dataset=dataset,
            vocab=vocab,
            device=device,
            epochs=args.epochs,
            lr=args.lr,
            initial_weights=warmstart_wb,
        )

        bin_path, head_onnx, mono_path = export_calibrated_artifacts(
            lang=lang,
            model=trained_head,
            base_model_path=base_model,
            out_dir=out_dir,
        )

        results_summary[lang] = {
            "binary_head": str(bin_path.name),
            "binary_size": bin_path.stat().st_size,
            "weight_norm": float(np.linalg.norm(np.frombuffer(bin_path.read_bytes()[:526336], dtype="<f4"))),
            "modular_onnx": str(head_onnx.name),
            "monolithic_onnx": str(mono_path.name),
            "dataset_utterances": len(dataset),
        }

    summary_file = out_dir / "calibration_summary.json"
    with open(summary_file, "w", encoding="utf-8") as f:
        json.dump(results_summary, f, indent=2)

    logger.info("==================================================")
    logger.info("All language heads calibrated and exported successfully!")
    logger.info("Summary saved to %s", summary_file)
    logger.info("==================================================")


if __name__ == "__main__":
    main()
