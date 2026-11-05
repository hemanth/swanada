#!/usr/bin/env python3
"""Swanada English CTC Head Fine-Tuning on NVIDIA L4 GPU (Cloud Run Jobs).

Trains and calibrates the 512 -> 257 CTC acoustic projection head for Indian English
on IndicTTS-English representations using PyTorch with CUDA acceleration on an NVIDIA L4 GPU.
"""

from __future__ import annotations

import os
import sys
import time
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from google.cloud import storage


class EnglishCTCHead(nn.Module):
    def __init__(self, in_features: int = 512, num_classes: int = 257):
        super().__init__()
        self.conv = nn.Conv1d(in_features, num_classes, kernel_size=1)
        nn.init.xavier_uniform_(self.conv.weight)
        nn.init.zeros_(self.conv.bias)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        logits = self.conv(x)  # [batch, 257, time]
        return logits.transpose(1, 2)  # [batch, time, 257]


def main() -> None:
    print("=" * 60)
    print("Swanada NVIDIA L4 GPU Calibration Execution")
    print("=" * 60)

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is not available. GPU is required for this execution.")

    device = torch.device("cuda:0")
    gpu_name = torch.cuda.get_device_name(0)
    gpu_mem = torch.cuda.get_device_properties(0).total_memory / (1024 ** 3)
    cuda_ver = torch.version.cuda
    print(f"Device: {device}")
    print(f"GPU Accelerator: {gpu_name}")
    print(f"GPU Total VRAM: {gpu_mem:.2f} GiB")
    print(f"CUDA Version: {cuda_ver}")

    cache_file = "/tmp/en_features_cache.pt"
    if not os.path.exists(cache_file):
        raise FileNotFoundError(f"Feature cache not found at {cache_file}")

    print(f"Loading cached features from {cache_file}...")
    dataset = torch.load(cache_file, weights_only=False)
    print(f"Loaded {len(dataset)} training utterances.")

    model = EnglishCTCHead(in_features=512, num_classes=257).to(device)
    optimizer = optim.AdamW(model.parameters(), lr=3e-3, weight_decay=1e-4)
    criterion = nn.CTCLoss(blank=0, zero_infinity=True)

    epochs = 80
    print(f"Starting CTC loss optimization on {gpu_name} for {epochs} epochs...")
    t0 = time.time()

    initial_loss = None
    final_loss = None

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
        if epoch == 1:
            initial_loss = avg_loss
        if epoch == epochs:
            final_loss = avg_loss

        if epoch % 10 == 0 or epoch == 1:
            print(f"Epoch {epoch:2d}/{epochs:2d} — CTCLoss: {avg_loss:.4f}")

    elapsed = time.time() - t0
    print(f"GPU optimization finished in {elapsed:.2f}s ({elapsed/epochs:.3f}s/epoch).")
    print(f"Loss trajectory: {initial_loss:.4f} -> {final_loss:.4f}")

    weight_np = model.conv.weight.detach().cpu().numpy()  # [257, 512, 1]
    bias_np = model.conv.bias.detach().cpu().numpy()      # [257]

    weight_norm = float(np.linalg.norm(weight_np))
    bias_norm = float(np.linalg.norm(bias_np))
    print(f"Optimized weight norm: {weight_norm:.4f}, bias norm: {bias_norm:.4f}")

    output_path = "/tmp/trained_en_head.pt"
    torch.save({
        "weight": weight_np,
        "bias": bias_np,
        "initial_loss": initial_loss,
        "final_loss": final_loss,
        "gpu_name": gpu_name,
        "epochs": epochs,
        "elapsed_sec": elapsed,
    }, output_path)
    print(f"Saved checkpoint locally to {output_path}")

    # Upload to Google Cloud Storage
    bucket_name = "training-gemina"
    blob_name = "swanada/trained_en_head.pt"
    print(f"Uploading trained artifact to gs://{bucket_name}/{blob_name}...")
    client = storage.Client()
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(blob_name)
    blob.upload_from_filename(output_path)
    print("Artifact successfully uploaded to GCS.")
    print("=" * 60)
    print("Execution complete with code 0.")
    print("=" * 60)


if __name__ == "__main__":
    main()
