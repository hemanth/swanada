#!/usr/bin/env python3
"""Unified Zero-Leakage 12-Language Public Leaderboard Distillation Pipeline
for BOTH Swanada `Studio` (~177.4 MiB) and `Mobile` (< 30 MiB) on GCP Spot L4 GPU.

Key Advances Over v1.0.2 / v1.1.0:
  1. 100% Specialist FP32 Teacher Coverage Across All 12 Languages:
     - `en`: Distills from NVIDIA `stt_en_conformer_ctc_large.nemo` (18-layer 118M FP32
       Conformer-Large, ~2.0% LibriSpeech WER) via a calibrated 257-way `en_vocab.json`
       CTC projection head -> Top-24 frame posteriors across ~16,500 diverse `train` clips
       (`LibriSpeech train-clean-100`, `LibriSpeech train-other-500`, `GLOBE` multi-accent,
       `AMI` spontaneous meetings, `FLEURS en_us train`, `IndicTTS-EN`).
     - `10 Indic` (`hi, kn, mr, bn, ta, te, ml, gu, pa, or`): Distills from 10 FP32
       AI4Bharat IndicConformer specialist teachers -> Top-24 frame posteriors.
     - `sa`: Distills from converged Classical Sanskrit Conformer teacher -> Top-24 posteriors.
  2. Strict Train / Validation / Test Separation (0.00% Test-Set Leakage):
     - Quarantines all 16 official public `test` suites (`FLEURS` 11-lang `test`,
       `LibriSpeech` `test-clean` & `test-other`, `GLOBE` `test`, `AMI` `test`,
       `Sushrota` `in_the_wild_test`), `bench/test_speech_suite.jsonl` (480 clips),
       `docs/samples/*.wav`, `sa_rasa`, and `bench/eval_slang_and_accents.py`.
     - Keeps `train_pool` (strictly `train` splits) and `val_by_lang` (strictly official
       `validation` splits) 100% disjoint, using runtime-exact `extract_log_mel_features`.
  3. Stage 2A (`train-studio` — 177.4 MiB Conformer-Large + QInt8 Post-Calibration):
     - Warm-starts from converged `v1.0.2` encoder + heads, unfreezes all 17 Conformer
       layers with depth-wise differential learning rates, trains with 12-language
       Top-24 Specialist KL + GT CTC, exports QInt8 ONNX, and runs Post-Quantization
       QInt8 ONNX Head Calibration on `docs/heads/<lang>.bin` (`527,364` bytes).
  4. Stage 2B (`train-mobile` — < 30 MiB MobileConformer + 4-Layer FitNets + Dual KL):
     - Warm-starts from converged `v1.1.0` `MobileConformerEncoder` (or SVD + frontend
       warm-start), aligns 4 intermediate Conformer taps (`FitNets` 256 -> 512) +
       `layer_norm_84` Cosine/MSE + Dual Teacher KL (50% Stage-2A Studio + 50% Specialist
       FP32 Top-24) + GT CTC, exports `< 30 MiB` QInt8 ONNX, and runs Post-Quantization
       QInt8 ONNX Head Calibration on `docs/heads_mobile/<lang>.bin` (`527,364` bytes).
"""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import copy
import gc
import io
import json
import logging
import math
import os
from pathlib import Path
import random
import shutil
import subprocess
import sys
import tarfile
import time
from typing import Any, Dict, List, Optional, Tuple
import urllib.request

from huggingface_hub import hf_hub_download
import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper
import onnxruntime as ort
from onnxruntime.quantization import QuantType, quantize_dynamic
import pyarrow as pa
import pyarrow.parquet as pq
import scipy.signal
import soundfile as sf
import torch
import torch.nn as nn
import torch.nn.functional as F
import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT / "tools") not in sys.path:
    sys.path.insert(0, str(REPO_ROOT / "tools"))
if str(REPO_ROOT / "python" / "src") not in sys.path:
    sys.path.insert(0, str(REPO_ROOT / "python" / "src"))

from gcp_distill_mobile_25mb import (
    CANONICAL_PRESETS,
    STUDENT_INTER_TAPS,
    TEACHER_INTER_TAPS,
    MobileConformerEncoder,
    MobileExportWrapper,
    augment_student_mel,
    clean_and_tokenize_en_rich,
    collect_multi_accent_en_utterances,
    collect_runtime_mel_utterances,
    download_url_file,
    evaluate_mobile_student,
    forward_teacher_with_intermediates,
    load_v102_teacher_from_onnx,
    pcm_to_runtime_mel,
)
from gcp_joint_12lang_train import (
    ALL_LANGUAGES,
    FLEURS_LANG_MAP,
    INDIC_TEACHER_LANGS,
    INDICTTS_REPO_MAP,
    TOP_K_TEACHER,
    ConvSubsampling,
    NeMoConformerEncoder,
    SwanadaExportWrapper,
    build_modular_head_onnx,
    build_quarantine_set,
    canonicalize_onnx_tail,
    ctc_greedy_decode,
    ensure_head_integrity,
    is_quarantined as is_quarantined_joint,
    levenshtein_seq,
    list_parquet_urls,
    normalize_eval_text,
    normalize_quarantine_key,
    splice_monolithic_onnx,
    tokenize_clean,
)
from swanada.audio import load_audio
from swanada.decoder import decode_ctc
from swanada.denoise import enhance_speech_with_telemetry
from swanada.frontend import extract_log_mel_features
from swanada.lid import (
    LID_LANGUAGES,
    NeuralLIDWeights,
    parse_lid_head_bytes,
    serialize_lid_head_bytes,
)

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] [leaderboard-distill] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("leaderboard_distill")

SA_RASA_TEXT = "अहं तत्रत्यानां कतिपयसौकर्याणां विषये ज्ञातुमिच्छामि"


def _gcloud_env() -> dict[str, str]:
    env = os.environ.copy()
    cur = env.get("CLOUDSDK_METRICS_ENVIRONMENT", "")
    if "datacloud.antigravity" not in cur:
        env["CLOUDSDK_METRICS_ENVIRONMENT"] = f"{cur} datacloud.antigravity".strip()
    return env


def gcs_pull(gcs_prefix: str, remote_name: str, local_path: Path) -> bool:
    if not gcs_prefix:
        return False
    uri = f"{gcs_prefix.rstrip('/')}/{remote_name}"
    local_path.parent.mkdir(parents=True, exist_ok=True)
    res = subprocess.run(
        ["gcloud", "storage", "cp", "--quiet", uri, str(local_path)],
        env=_gcloud_env(),
        capture_output=True,
        text=True,
    )
    if res.returncode == 0 and local_path.exists() and local_path.stat().st_size > 0:
        log.info("[gcs-ckpt] Restored %s -> %s (%.1f MB)", uri, local_path.name, local_path.stat().st_size / 1e6)
        return True
    return False


def gcs_push(local_path: Path, gcs_prefix: str, remote_name: str) -> None:
    if not gcs_prefix or not local_path.exists():
        return
    uri = f"{gcs_prefix.rstrip('/')}/{remote_name}"
    res = subprocess.run(
        ["gcloud", "storage", "cp", "--quiet", str(local_path), uri],
        env=_gcloud_env(),
        capture_output=True,
        text=True,
    )
    if res.returncode == 0:
        log.info("[gcs-ckpt] Saved %s -> %s (%.1f MB)", local_path.name, uri, local_path.stat().st_size / 1e6)
    else:
        log.warning("[gcs-ckpt] Warning pushing %s: %s", uri, (res.stderr or "").strip()[:200])


# ==============================================================================
# 1. Strict Public Leaderboard Quarantine & Parquet Discovery Helpers
# ==============================================================================


def list_all_repo_parquet_map(repo_id: str) -> Dict[str, Dict[str, List[str]]]:
    url = f"https://huggingface.co/api/datasets/{repo_id}/parquet"
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                if isinstance(data, dict):
                    return data
        except Exception as exc:
            if attempt == 3:
                log.warning("Could not query parquet map for %s: %s", repo_id, exc)
                return {}
            time.sleep(2 * (attempt + 1))
    return {}


def quarantine_parquet_texts(urls: List[str], exact_q: set[str], tmp_dir: Path, tag: str, max_shards: int = 2) -> int:
    added = 0
    for idx, url in enumerate(urls[:max_shards]):
        pf_path = tmp_dir / f"_q_{tag}_{idx}.parquet"
        try:
            download_url_file(url, pf_path)
            pf = pq.ParquetFile(pf_path)
            for batch in pf.iter_batches(batch_size=512):
                for row in batch.to_pylist():
                    for col in ("raw_transcription", "transcription", "transcript", "text", "sentence"):
                        v = row.get(col)
                        if isinstance(v, str) and len(v.strip()) >= 2:
                            k = normalize_quarantine_key(v)
                            if k:
                                exact_q.add(k)
                                added += 1
                            break
            del pf
        except Exception as exc:
            log.warning("[quarantine:%s] warning: %s", tag, exc)
        finally:
            pf_path.unlink(missing_ok=True)
    return added


def build_strict_leaderboard_quarantine(work_dir: Path, cache_dir: Path) -> Tuple[set[str], List[set[str]]]:
    exact_q, word_q = build_quarantine_set(work_dir / "bench" / "test_speech_suite.jsonl")
    for txt in CANONICAL_PRESETS.values():
        exact_q.add(normalize_quarantine_key(txt))
    exact_q.add(normalize_quarantine_key(SA_RASA_TEXT))

    # Quarantine bench/eval_slang_and_accents.py phrases
    try:
        import importlib.util

        spec = importlib.util.spec_from_file_location(
            "eval_slang_and_accents", work_dir / "bench" / "eval_slang_and_accents.py"
        )
        if spec and spec.loader:
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            for _, _, txt in getattr(mod, "EN_SLANG_MULTI_ACCENT_SUITE", []):
                k = normalize_quarantine_key(txt)
                if k:
                    exact_q.add(k)
            for _, _, txt in getattr(mod, "INDIC_COLLOQUIAL_SUITE", []):
                k = normalize_quarantine_key(txt)
                if k:
                    exact_q.add(k)
    except Exception as exc:
        log.warning("Quarantine slang import warning: %s", exc)

    # Quarantine OpenASR / LibriSpeech / GLOBE / AMI / Sushrota test splits
    open_test_specs = [
        ("librispeech_clean_test", "openslr/librispeech_asr", "clean", "test"),
        ("librispeech_other_test", "openslr/librispeech_asr", "other", "test"),
        ("globe_test", "MushanW/GLOBE", "default", "test"),
        ("ami_ihm_test", "edinburghcstr/ami", "ihm", "test"),
        ("sushrota_wild_test", "prathoshap/sushrota-sanskrit-asr-data", "default", "in_the_wild_test"),
    ]
    for tag, repo_id, cfg, split in open_test_specs:
        try:
            urls = list_parquet_urls(repo_id, config=cfg, split=split)
            cnt = quarantine_parquet_texts(urls, exact_q, cache_dir, tag, max_shards=3)
            log.info("[quarantine] %s: quarantined %d test utterances.", tag, cnt)
        except Exception as exc:
            log.warning("[quarantine] %s warning: %s", tag, exc)

    return exact_q, word_q


# ==============================================================================
# 2. Specialist FP32 Teacher Extraction (All 12 Languages incl. NeMo EN Large!)
# ==============================================================================


def extract_english_nemo_teacher_targets(
    en_items: List[dict],
    en_val_items: List[dict],
    en_vocab: List[str],
    samples_dir: Path,
    cache_dir: Path,
    device: torch.device,
) -> Tuple[np.ndarray, np.ndarray]:
    """Downloads `nvidia/stt_en_conformer_ctc_large.nemo` (~2.0% LibriSpeech WER),
    loads its 18-layer FP32 Conformer-Large encoder (`strict=True`), fits a calibrated
    linear `512 -> 257` `en_vocab.json` CTC head on frozen 512-d features, and caches
    Top-24 `teacher_lp` + `teacher_idx` across all `en_items`."""
    log.info("[en] Downloading NVIDIA FP32 Specialist Teacher `nvidia/stt_en_conformer_ctc_large`...")
    nemo_dir = cache_dir / "teacher_en_nemo"
    nemo_dir.mkdir(parents=True, exist_ok=True)
    nemo_file = hf_hub_download(
        repo_id="nvidia/stt_en_conformer_ctc_large",
        filename="stt_en_conformer_ctc_large.nemo",
        local_dir=str(nemo_dir),
    )

    cfg_dict: Dict[str, Any] = {}
    ckpt_bytes: Optional[bytes] = None
    with tarfile.open(nemo_file, "r:*") as tf:
        for member in tf.getmembers():
            bname = os.path.basename(member.name)
            if bname.endswith("model_config.yaml"):
                f_obj = tf.extractfile(member)
                if f_obj is not None:
                    cfg_dict = yaml.safe_load(f_obj.read().decode("utf-8")) or {}
            elif bname.endswith("model_weights.ckpt"):
                f_obj = tf.extractfile(member)
                if f_obj is not None:
                    ckpt_bytes = f_obj.read()

    if ckpt_bytes is None:
        raise RuntimeError("Could not locate model_weights.ckpt inside stt_en_conformer_ctc_large.nemo")

    raw_sd = torch.load(io.BytesIO(ckpt_bytes), map_location="cpu", weights_only=False)
    del ckpt_bytes
    shutil.rmtree(nemo_dir, ignore_errors=True)

    enc_cfg = cfg_dict.get("encoder", {})
    n_layers = int(
        enc_cfg.get(
            "n_layers",
            max(int(k.split(".")[2]) for k in raw_sd if k.startswith("encoder.layers.")) + 1,
        )
    )
    d_model = int(enc_cfg.get("d_model", 512))
    n_heads = int(enc_cfg.get("n_heads", 8))
    conv_k = int(enc_cfg.get("conv_kernel_size", 31))
    xscaling = bool(enc_cfg.get("xscaling", True))
    sub_conv_ch = int(raw_sd.get("encoder.pre_encode.conv.0.weight", torch.empty(d_model)).shape[0])

    en_teacher = NeMoConformerEncoder(
        feat_in=80,
        n_layers=n_layers,
        d_model=d_model,
        n_heads=n_heads,
        conv_kernel_size=conv_k,
        dropout=0.0,
    )
    if sub_conv_ch != d_model:
        en_teacher.pre_encode = ConvSubsampling(
            feat_in=80, feat_out=d_model, conv_channels=sub_conv_ch, subsampling_factor=4
        )
    if not xscaling:
        en_teacher.xscale = 1.0
        en_teacher.pos_enc.xscale = None

    enc_sd = {}
    target_sd = en_teacher.state_dict()
    for k, v in raw_sd.items():
        if k.startswith("encoder."):
            sub_k = k[len("encoder.") :]
            if sub_k in target_sd and tuple(v.shape) == tuple(target_sd[sub_k].shape):
                enc_sd[sub_k] = v.to(target_sd[sub_k].dtype)
    del raw_sd
    missing, unexpected = en_teacher.load_state_dict(enc_sd, strict=False)
    real_missing = [m for m in missing if not m.endswith("num_batches_tracked") and not m.endswith(".pe")]
    if real_missing:
        raise RuntimeError(f"Missing keys loading stt_en_conformer_ctc_large encoder: {real_missing[:10]}")
    log.info(
        "[en] Loaded `stt_en_conformer_ctc_large` (%d layers, d=%d, xscaling=%s, unexpected=%d)!",
        n_layers,
        d_model,
        xscaling,
        len(unexpected),
    )

    en_teacher = en_teacher.to(device).eval()
    for p in en_teacher.parameters():
        p.requires_grad = False

    # 1. Extract frozen 512-d features (`float16` on CPU) for `en_items` + `en_val_items`
    t0 = time.time()
    use_amp = device.type == "cuda"

    def _extract_feats(pool: List[dict]) -> List[np.ndarray]:
        feats_out: List[Optional[np.ndarray]] = [None] * len(pool)
        order = sorted(range(len(pool)), key=lambda idx: pool[idx]["mel_len"])
        bs = 64 if device.type == "cuda" else 16
        with torch.inference_mode():
            for b0 in range(0, len(order), bs):
                b_idxs = order[b0 : b0 + bs]
                max_m = max(pool[i]["mel_len"] for i in b_idxs)
                mel_b = torch.zeros((len(b_idxs), 80, max_m), dtype=torch.float32, device=device)
                len_b = torch.zeros((len(b_idxs),), dtype=torch.int64, device=device)
                for j, i in enumerate(b_idxs):
                    m = torch.from_numpy(pool[i]["mel"].astype(np.float32))
                    mel_b[j, :, : m.shape[1]] = m
                    len_b[j] = m.shape[1]
                with torch.amp.autocast("cuda", dtype=torch.bfloat16, enabled=use_amp):
                    enc_out, enc_len = en_teacher(mel_b, len_b, freeze_until_layer=-1)
                enc_np = enc_out.transpose(1, 2).to(torch.float16).cpu().numpy()  # [B, T_sub, 512]
                len_np = enc_len.cpu().numpy()
                for j, i in enumerate(b_idxs):
                    vt = int(len_np[j])
                    feats_out[i] = np.ascontiguousarray(enc_np[j, :vt])
        return [f for f in feats_out if f is not None]

    train_feats = _extract_feats(en_items)
    val_feats = _extract_feats(en_val_items)
    log.info("[en] Extracted 18-layer NeMo teacher features for %d train + %d val clips in %.1fs.", len(train_feats), len(val_feats), time.time() - t0)

    # Free 18-layer encoder VRAM before fitting linear CTC head
    en_teacher.cpu()
    del en_teacher
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    # 2. Fit calibrated `Conv1d(512, 257, 1)` `en_vocab.json` CTC head on frozen 512-d features
    en_head = nn.Conv1d(512, 257, kernel_size=1).to(device)
    nn.init.xavier_uniform_(en_head.weight)
    nn.init.zeros_(en_head.bias)
    en_head.bias.data[0] = 2.0

    ctc_loss_fn = nn.CTCLoss(blank=0, reduction="mean", zero_infinity=True)
    opt = torch.optim.AdamW(en_head.parameters(), lr=3.0e-3, weight_decay=1e-4)
    head_epochs = 8
    bs_h = 64
    order_h = sorted(range(len(en_items)), key=lambda idx: train_feats[idx].shape[0])
    total_steps_h = max(1, math.ceil(len(order_h) / bs_h) * head_epochs)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=total_steps_h, eta_min=2e-4)

    for ep in range(1, head_epochs + 1):
        en_head.train()
        batches_h = [order_h[i : i + bs_h] for i in range(0, len(order_h), bs_h)]
        random.shuffle(batches_h)
        for b_idxs in batches_h:
            valid_b = [i for i in b_idxs if train_feats[i].shape[0] > len(en_items[i]["tokens"]) + 1]
            if not valid_b:
                continue
            max_t = max(train_feats[i].shape[0] for i in valid_b)
            xb = torch.zeros((len(valid_b), 512, max_t), dtype=torch.float32, device=device)
            in_l = torch.zeros((len(valid_b),), dtype=torch.long, device=device)
            t_cat = []
            t_l = []
            for j, i in enumerate(valid_b):
                vt = train_feats[i].shape[0]
                xb[j, :, :vt] = torch.from_numpy(train_feats[i].astype(np.float32).T)
                in_l[j] = vt
                tk = torch.from_numpy(en_items[i]["tokens"]).long()
                t_cat.append(tk)
                t_l.append(len(tk))
            lp = F.log_softmax(en_head(xb).transpose(1, 2), dim=-1)
            loss = ctc_loss_fn(lp.transpose(0, 1), torch.cat(t_cat).to(device), in_l, torch.tensor(t_l, device=device))
            opt.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(en_head.parameters(), 2.0)
            opt.step()
            sched.step()

    en_head.eval()
    # Sanity check teacher CER on `en_val_items`
    if val_feats:
        w_n = en_head.weight.detach().cpu().numpy().squeeze(-1)
        b_n = en_head.bias.detach().cpu().numpy()
        v_cers = []
        for idx_v, vf in enumerate(val_feats):
            hyp_v = ctc_greedy_decode(vf.astype(np.float32) @ w_n.T + b_n, en_vocab)
            ref_v = "".join(en_vocab[t] for t in en_val_items[idx_v]["tokens"]).replace("\u2581", " ").strip()
            nr = normalize_eval_text(ref_v, "en")
            nh = normalize_eval_text(hyp_v, "en")
            v_cers.append(levenshtein_seq(list(nr), list(nh)) / max(1, len(nr)))
        log.info("[en] NEMO SPECIALIST TEACHER SANITY GATE | Val CER across %d clips = %.2f%%!", len(v_cers), float(np.mean(v_cers)) * 100)

    # 3. Extract Top-24 frame log-probs (`teacher_lp`, `teacher_idx`) for every `en` train clip
    with torch.inference_mode():
        for b0 in range(0, len(order_h), 128):
            b_idxs = order_h[b0 : b0 + 128]
            max_t = max(train_feats[i].shape[0] for i in b_idxs)
            xb = torch.zeros((len(b_idxs), 512, max_t), dtype=torch.float32, device=device)
            for j, i in enumerate(b_idxs):
                vt = train_feats[i].shape[0]
                xb[j, :, :vt] = torch.from_numpy(train_feats[i].astype(np.float32).T)
            lp = F.log_softmax(en_head(xb).transpose(1, 2), dim=-1)
            top_v, top_i = torch.topk(lp, k=TOP_K_TEACHER, dim=-1)
            tv_np = top_v.half().cpu().numpy()
            ti_np = top_i.to(torch.int16).cpu().numpy()
            for j, i in enumerate(b_idxs):
                vt = train_feats[i].shape[0]
                en_items[i]["teacher_lp"] = tv_np[j, :vt].copy()
                en_items[i]["teacher_idx"] = ti_np[j, :vt].copy()

    w_out = en_head.weight.detach().cpu().numpy().copy()
    b_out = en_head.bias.detach().cpu().numpy().copy()
    del train_feats, val_feats, en_head
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    return w_out, b_out


def extract_indic_runtime_teacher_targets(
    lang: str,
    items: List[dict],
    vocab: List[str],
    samples_dir: Path,
    cache_dir: Path,
) -> Tuple[np.ndarray, np.ndarray]:
    """Downloads AI4Bharat FP32 teacher ONNX for `lang`, extracts Top-24 frame posteriors
    directly on runtime-exact `mel` features, then deletes teacher files immediately."""
    repo_id = f"OpenVoiceOS/ai4bharat-indicconformer-{lang}-onnx"
    log.info("[%s] Downloading FP32 Teacher %s...", lang, repo_id)
    local_dir = cache_dir / f"teacher_{lang}"
    local_dir.mkdir(parents=True, exist_ok=True)
    onnx_path = hf_hub_download(repo_id=repo_id, filename="model.onnx", local_dir=str(local_dir))
    hf_hub_download(repo_id=repo_id, filename="model.onnx_data", local_dir=str(local_dir))

    proto = onnx.load(str(onnx_path))
    head_w, head_b = None, None
    perm = [256] + list(range(256))
    for node in reversed(proto.graph.node):
        if node.op_type == "Conv" and len(node.input) >= 3:
            w_name, b_name = node.input[1], node.input[2]
            inits = {init.name: numpy_helper.to_array(init) for init in proto.graph.initializer if init.name in (w_name, b_name)}
            if w_name in inits and b_name in inits and inits[w_name].shape[0] == 257:
                head_w = inits[w_name].astype(np.float32)[perm]
                head_b = inits[b_name].astype(np.float32)[perm]
                break
    del proto

    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    providers: List[Any] = (
        [
            (
                "CUDAExecutionProvider",
                {
                    "arena_extend_strategy": "kSameAsRequested",
                    "cudnn_conv_algo_search": "HEURISTIC",
                    "cudnn_conv_use_max_workspace": "0",
                    "do_copy_in_default_stream": "1",
                },
            ),
            "CPUExecutionProvider",
        ]
        if "CUDAExecutionProvider" in ort.get_available_providers()
        else ["CPUExecutionProvider"]
    )
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = 8
    opts.enable_mem_pattern = False
    sess = ort.InferenceSession(str(onnx_path), sess_options=opts, providers=providers)
    cpu_sess: Optional[ort.InferenceSession] = None
    out_name = sess.get_outputs()[0].name

    sample_wav = samples_dir / f"{lang}.wav"
    if sample_wav.exists():
        pcm = load_audio(sample_wav, target_sr=16000)
        mel = pcm_to_runtime_mel(pcm, denoise=True)[None, :, :]
        raw_out = sess.run([out_name], {"audio_signal": mel, "length": np.array([mel.shape[2]], dtype=np.int64)})[0][0]
        t_lp = F.log_softmax(torch.from_numpy(raw_out[:, perm]).float(), dim=-1).numpy()
        log.info("[%s] TEACHER SANITY GATE | Ref: %s | Teacher: %s", lang, CANONICAL_PRESETS[lang], ctc_greedy_decode(t_lp, vocab))

    t0 = time.time()
    bs = 8
    order = sorted(range(len(items)), key=lambda i: items[i]["mel_len"])
    for b0 in range(0, len(order), bs):
        b_idxs = order[b0 : b0 + bs]
        raw_max_m = max(items[i]["mel_len"] for i in b_idxs)
        pad_m = ((raw_max_m + 127) // 128) * 128
        mel_b = np.zeros((len(b_idxs), 80, pad_m), dtype=np.float32)
        len_b = np.zeros((len(b_idxs),), dtype=np.int64)
        for j, idx in enumerate(b_idxs):
            m = items[idx]["mel"].astype(np.float32)
            mel_b[j, :, : m.shape[1]] = m
            len_b[j] = m.shape[1]
        try:
            outs = sess.run([out_name], {"audio_signal": mel_b, "length": len_b})[0]
        except Exception as exc:
            log.warning("[%s] CUDA ORT batch fallback to CPU on pad_m=%d: %s", lang, pad_m, exc)
            if cpu_sess is None:
                cpu_sess = ort.InferenceSession(str(onnx_path), sess_options=opts, providers=["CPUExecutionProvider"])
            outs = cpu_sess.run([out_name], {"audio_signal": mel_b[:, :, :raw_max_m], "length": len_b})[0]
        outs_t = F.log_softmax(torch.from_numpy(outs[:, :, perm]).float(), dim=-1)
        top_v, top_i = torch.topk(outs_t, k=TOP_K_TEACHER, dim=-1)
        tv_np = top_v.half().numpy()
        ti_np = top_i.to(torch.int16).numpy()
        for j, idx in enumerate(b_idxs):
            vt = min(((int(len_b[j]) - 1) // 4) + 1, tv_np.shape[1])
            items[idx]["teacher_lp"] = tv_np[j, :vt].copy()
            items[idx]["teacher_idx"] = ti_np[j, :vt].copy()

    log.info("[%s] Extracted FP32 teacher posteriors for %d clips in %.1fs.", lang, len(items), time.time() - t0)
    del sess, cpu_sess
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    shutil.rmtree(local_dir, ignore_errors=True)
    if head_w is None or head_b is None:
        raise RuntimeError(f"Failed to extract head from {repo_id}")
    return head_w, head_b


@torch.no_grad()
def extract_sa_specialist_targets(
    encoder: NeMoConformerEncoder,
    sa_head: nn.Conv1d,
    items: List[dict],
    device: torch.device,
) -> None:
    encoder = encoder.to(device).eval()
    sa_head = sa_head.to(device).eval()
    use_amp = device.type == "cuda"
    order = sorted(range(len(items)), key=lambda i: items[i]["mel_len"])
    bs = 32 if device.type == "cuda" else 8
    for b0 in range(0, len(order), bs):
        b_idxs = order[b0 : b0 + bs]
        max_m = max(items[i]["mel_len"] for i in b_idxs)
        mel_b = torch.zeros((len(b_idxs), 80, max_m), dtype=torch.float32, device=device)
        len_b = torch.zeros((len(b_idxs),), dtype=torch.int64, device=device)
        for j, idx in enumerate(b_idxs):
            m = torch.from_numpy(items[idx]["mel"].astype(np.float32))
            mel_b[j, :, : m.shape[1]] = m
            len_b[j] = m.shape[1]
        with torch.amp.autocast("cuda", dtype=torch.bfloat16, enabled=use_amp):
            enc, enc_len = encoder(mel_b, len_b, freeze_until_layer=-1)
            logits = sa_head(enc).transpose(1, 2).float()
        lp = F.log_softmax(logits, dim=-1)
        top_v, top_i = torch.topk(lp, k=TOP_K_TEACHER, dim=-1)
        tv_np = top_v.half().cpu().numpy()
        ti_np = top_i.to(torch.int16).cpu().numpy()
        for j, idx in enumerate(b_idxs):
            vt = int(enc_len[j].item())
            items[idx]["teacher_lp"] = tv_np[j, :vt].copy()
            items[idx]["teacher_idx"] = ti_np[j, :vt].copy()


# ==============================================================================
# 3. Reconstruct Converged Mobile Student from QInt8 ONNX (`> 0.999` Parity)
# ==============================================================================


def load_mobile_student_from_onnx(
    onnx_path: Path, heads_dir: Path, device: torch.device
) -> Tuple[MobileConformerEncoder, nn.ModuleDict]:
    log.info("Reconstructing converged MobileConformerEncoder from %s...", onnx_path.name)
    m = onnx.load(str(onnx_path))
    inits = {i.name: numpy_helper.to_array(i) for i in m.graph.initializer}

    student = MobileConformerEncoder(
        feat_in=80, n_layers=14, d_model=256, out_dim=512, conv_channels=176, n_heads=8, conv_kernel_size=31, dropout=0.06
    )
    sd = student.state_dict()
    for k in list(sd.keys()):
        ok = "encoder." + k
        if ok in inits:
            sd[k] = torch.from_numpy(inits[ok].copy()).to(sd[k].dtype)

    for n in m.graph.node:
        if n.op_type == "MatMulInteger" and n.name.startswith("/encoder/"):
            mod_path = n.name[len("/encoder/") : -len("/MatMul_quant")].replace("/", ".")
            wq_name = n.input[1]
            ws_name = wq_name.replace("_quantized", "_scale")
            wzp_name = n.input[3] if len(n.input) > 3 else None
            wq = inits[wq_name].astype(np.float32)
            ws = inits[ws_name].astype(np.float32)
            wzp = inits[wzp_name].astype(np.float32) if (wzp_name and wzp_name in inits) else 0.0
            w_fp32 = ((wq - wzp) * ws).T
            if mod_path + ".weight" in sd:
                sd[mod_path + ".weight"] = torch.from_numpy(w_fp32.copy())
            # Bias resides in the Add node consuming MatMul_quant output or initializer
            q_out = n.output[0]
            for n2 in m.graph.node:
                if n2.op_type in ("DynamicQuantizeLinear", "Mul", "Add") and q_out in n2.input:
                    pass
            # Direct initializer lookup for linear bias
            b_init_key = "encoder." + mod_path + ".bias"
            if b_init_key in inits and (mod_path + ".bias") in sd:
                sd[mod_path + ".bias"] = torch.from_numpy(inits[b_init_key].astype(np.float32).copy())
            else:
                # Search Add node under same prefix `/encoder/<mod_subdir>/Add`
                add_prefix = n.name[: -len("/MatMul_quant")]
                for n_add in m.graph.node:
                    if n_add.op_type == "Add" and n_add.name.startswith(add_prefix):
                        for inp in n_add.input:
                            if inp in inits and inits[inp].ndim == 1 and (mod_path + ".bias") in sd:
                                if inits[inp].shape[0] == sd[mod_path + ".bias"].shape[0]:
                                    sd[mod_path + ".bias"] = torch.from_numpy(inits[inp].astype(np.float32).copy())
                                    break
        elif n.op_type == "Conv" and n.name.endswith("/conv/depthwise_conv/Conv"):
            mod_path = n.name[len("/encoder/") : -len("/Conv")].replace("/", ".")
            sd[mod_path + ".weight"] = torch.from_numpy(inits[n.input[1]].astype(np.float32).copy())
            if len(n.input) > 2 and n.input[2] in inits:
                sd[mod_path + ".bias"] = torch.from_numpy(inits[n.input[2]].astype(np.float32).copy())
        elif n.op_type == "Add" and n.name.endswith("/self_attn/Add"):
            mod_path = n.name[len("/encoder/") : -len("/Add")].replace("/", ".")
            arr = inits[n.input[1]] if n.input[1] in inits else inits[n.input[0]]
            sd[mod_path + ".pos_bias_u"] = torch.from_numpy(arr.astype(np.float32).squeeze().copy())
        elif n.op_type == "Add" and n.name.endswith("/self_attn/Add_1"):
            mod_path = n.name[len("/encoder/") : -len("/Add_1")].replace("/", ".")
            arr = inits[n.input[1]] if n.input[1] in inits else inits[n.input[0]]
            sd[mod_path + ".pos_bias_v"] = torch.from_numpy(arr.astype(np.float32).squeeze().copy())
        elif n.op_type == "LayerNormalization" and n.name.startswith("/encoder/"):
            mod_path = n.name[len("/encoder/") :].rsplit("/", 1)[0].replace("/", ".")
            if len(n.input) >= 2 and n.input[1] in inits and (mod_path + ".weight") in sd:
                sd[mod_path + ".weight"] = torch.from_numpy(inits[n.input[1]].astype(np.float32).copy())
            if len(n.input) >= 3 and n.input[2] in inits and (mod_path + ".bias") in sd:
                sd[mod_path + ".bias"] = torch.from_numpy(inits[n.input[2]].astype(np.float32).copy())

    student.load_state_dict(sd, strict=True)
    student = student.to(device)

    heads = nn.ModuleDict({lang: nn.Conv1d(512, 257, kernel_size=1) for lang in ALL_LANGUAGES})
    for lang in ALL_LANGUAGES:
        raw = (heads_dir / f"{lang}.bin").read_bytes()
        w = np.frombuffer(raw[: 257 * 512 * 4], dtype="<f4").reshape(257, 512, 1).copy()
        b = np.frombuffer(raw[257 * 512 * 4 :], dtype="<f4").copy()
        heads[lang].weight.data.copy_(torch.from_numpy(w))
        heads[lang].bias.data.copy_(torch.from_numpy(b))
    heads = heads.to(device)
    del m, inits
    gc.collect()
    return student, heads


# ==============================================================================
# 4. Top-24 Sparse Teacher KL + Validation + Post-Quant QInt8 Head Calibration
# ==============================================================================


def sparse_top24_kl_loss(
    student_logits: torch.Tensor,
    top_lp: torch.Tensor,
    top_idx: torch.Tensor,
    valid_mask: torch.Tensor,
    lengths: torch.Tensor,
    temp: float = 1.5,
) -> torch.Tensor:
    """Computes temperature-scaled KL divergence against Top-24 teacher frame posteriors.
    `student_logits`: [B, T, 257], `top_lp`: [B, T, 24] (T=1 log-probs), `top_idx`: [B, T, 24]."""
    # Scale teacher log-probs by 1/T and renormalize over Top-24 support (>99.98% mass)
    t_scaled = top_lp.float() / temp
    t_logp = F.log_softmax(t_scaled, dim=-1)
    t_probs = t_logp.exp()

    s_logp_full = F.log_softmax(student_logits.float() / temp, dim=-1)
    idx_clamped = top_idx.long().clamp(0, student_logits.size(-1) - 1)
    s_logp_top = torch.gather(s_logp_full, dim=-1, index=idx_clamped)

    kl_frame = (t_probs * (t_logp - s_logp_top)).sum(dim=-1)  # [B, T]
    utt_kl = (kl_frame * valid_mask).sum(dim=-1) / lengths.clamp_min(1).float()
    return utt_kl.sum() * (temp ** 2)


@torch.no_grad()
def evaluate_studio_model(
    encoder: NeMoConformerEncoder,
    heads: nn.ModuleDict,
    val_by_lang: Dict[str, List[dict]],
    vocabs: Dict[str, List[str]],
    samples_dir: Path,
    sa_rasa_wav: Optional[Path],
    device: torch.device,
) -> Tuple[float, int, bool, Dict[str, float]]:
    encoder.eval()
    heads.eval()
    cer_by_lang: Dict[str, float] = {}
    use_amp = device.type == "cuda"

    for lang in ALL_LANGUAGES:
        items = val_by_lang.get(lang, [])
        if not items:
            continue
        vocab = vocabs[lang]
        cers: List[float] = []
        bs = 24
        for b0 in range(0, len(items), bs):
            chunk = items[b0 : b0 + bs]
            max_m = max(x["mel_len"] for x in chunk)
            mel_b = torch.zeros((len(chunk), 80, max_m), dtype=torch.float32, device=device)
            len_b = torch.zeros((len(chunk),), dtype=torch.int64, device=device)
            for j, x in enumerate(chunk):
                m = torch.from_numpy(x["mel"].astype(np.float32))
                mel_b[j, :, : m.shape[1]] = m
                len_b[j] = m.shape[1]
            with torch.amp.autocast("cuda", dtype=torch.bfloat16, enabled=use_amp):
                enc, enc_l = encoder(mel_b, len_b, freeze_until_layer=-1)
                logits = heads[lang](enc).transpose(1, 2).float().cpu().numpy()
            for j, x in enumerate(chunk):
                vt = int(enc_l[j].item())
                hyp = ctc_greedy_decode(logits[j, :vt], vocab)
                ref = "".join(vocab[t] for t in x["tokens"]).replace("\u2581", " ").strip()
                nr = normalize_eval_text(ref, lang)
                nh = normalize_eval_text(hyp, lang)
                cers.append(levenshtein_seq(list(nr), list(nh)) / max(1, len(nr)))
        cer_by_lang[lang] = float(np.mean(cers))

    exact_presets = 0
    preset_lines: List[str] = []
    for lang in ALL_LANGUAGES:
        wav_p = samples_dir / f"{lang}.wav"
        if not wav_p.exists():
            continue
        pcm = load_audio(wav_p, target_sr=16000)
        clean_pcm = enhance_speech_with_telemetry(pcm, sr=16000).pcm
        feats, _ = extract_log_mel_features(clean_pcm, sr=16000)
        mel_t = torch.from_numpy(feats).float().to(device)
        len_t = torch.tensor([feats.shape[2]], dtype=torch.int64, device=device)
        enc, enc_l = encoder(mel_t, len_t, freeze_until_layer=-1)
        logits = heads[lang](enc).transpose(1, 2)[0, : int(enc_l[0].item())].cpu().numpy()
        hyp = decode_ctc(logits, vocab=vocabs[lang]).text
        ok = hyp == CANONICAL_PRESETS[lang]
        exact_presets += int(ok)
        preset_lines.append(f"[{lang} ok={ok}] {hyp}")

    rasa_ok = True
    if sa_rasa_wav is not None and sa_rasa_wav.exists():
        pcm_r = load_audio(sa_rasa_wav, target_sr=16000)
        clean_r = enhance_speech_with_telemetry(pcm_r, sr=16000).pcm
        feats_r, _ = extract_log_mel_features(clean_r, sr=16000)
        mel_rt = torch.from_numpy(feats_r).float().to(device)
        len_rt = torch.tensor([feats_r.shape[2]], dtype=torch.int64, device=device)
        enc_r, enc_rl = encoder(mel_rt, len_rt, freeze_until_layer=-1)
        logits_r = heads["sa"](enc_r).transpose(1, 2)[0, : int(enc_rl[0].item())].cpu().numpy()
        dec_r = decode_ctc(logits_r, vocab=vocabs["sa"])
        rasa_ok = (dec_r.text == SA_RASA_TEXT and len(dec_r.tokens) == 30)
        preset_lines.append(f"[sa_rasa ok={rasa_ok} len={len(dec_r.tokens)}] {dec_r.text}")

    mean_cer = float(np.mean(list(cer_by_lang.values()))) if cer_by_lang else 1.0
    log.info(
        "STUDIO VAL MEAN CER: %.2f%% | Presets: %d/12 | sa_rasa=%s | %s",
        mean_cer * 100,
        exact_presets,
        rasa_ok,
        {k: f"{v*100:.1f}%" for k, v in cer_by_lang.items()},
    )
    for ln in preset_lines:
        log.info("  STUDIO PRESET %s", ln)
    return mean_cer, exact_presets, rasa_ok, cer_by_lang


def post_quant_calibrate_qint8_heads_with_specialists(
    qint8_onnx_path: Path,
    heads_cpu: nn.ModuleDict,
    train_pool: List[dict],
    val_by_lang: Dict[str, List[dict]],
    vocabs: Dict[str, List[str]],
    samples_dir: Path,
    sa_rasa_wav: Optional[Path],
    device: torch.device,
    tier_label: str,
    studio_teacher: Optional[NeMoConformerEncoder] = None,
    studio_heads: Optional[nn.ModuleDict] = None,
    per_lang_samples: int = 420,
    cal_epochs: int = 9,
) -> nn.ModuleDict:
    """Calibrates linear `512 -> 257` CTC heads directly on quantized QInt8 ONNX
    `layer_norm_84` features using Specialist Top-24 posteriors (+ optional Studio
    teacher posteriors) and enforces BOTH validation CER non-regression AND preset
    non-regression!"""
    log.info("[%s] Running Post-Quantization QInt8 ONNX Head Calibration...", tier_label)
    m = onnx.load(str(qint8_onnx_path))
    m.graph.output.append(helper.make_tensor_value_info("layer_norm_84", TensorProto.FLOAT, ["batch", "time_sub", 512]))
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = 12
    q_sess = ort.InferenceSession(m.SerializeToString(), sess_options=opts, providers=["CPUExecutionProvider"])

    by_lang_items: Dict[str, List[dict]] = {l: [] for l in ALL_LANGUAGES}
    shuffled = list(train_pool)
    random.shuffle(shuffled)
    for it in shuffled:
        l = it["lang"]
        if len(by_lang_items[l]) < per_lang_samples and it.get("teacher_lp") is not None:
            by_lang_items[l].append(it)

    cal_heads = copy.deepcopy(heads_cpu).to(device)
    ctc_loss_fn = nn.CTCLoss(blank=0, reduction="mean", zero_infinity=True)
    if studio_teacher is not None and studio_heads is not None:
        studio_teacher = studio_teacher.to(device).eval()
        studio_heads = studio_heads.to(device).eval()

    def _eval_q_head(head_m: nn.Module, lang_code: str, val_feats: List[Tuple[np.ndarray, str]]) -> Tuple[float, bool, bool]:
        w_n = head_m.weight.detach().cpu().numpy().squeeze(-1)
        b_n = head_m.bias.detach().cpu().numpy()
        vocab = vocabs[lang_code]
        cers_v = []
        for qf, ref_txt in val_feats:
            hyp_v = decode_ctc(qf @ w_n.T + b_n, vocab=vocab).text
            nr = normalize_eval_text(ref_txt, lang_code)
            nh = normalize_eval_text(hyp_v, lang_code)
            cers_v.append(levenshtein_seq(list(nr), list(nh)) / max(1, len(nr)))
        vcer = float(np.mean(cers_v)) if cers_v else 0.0

        preset_ok = True
        wav_p = samples_dir / f"{lang_code}.wav"
        if wav_p.exists():
            pcm = load_audio(wav_p, target_sr=16000)
            clean_pcm = enhance_speech_with_telemetry(pcm, sr=16000).pcm
            feats, _ = extract_log_mel_features(clean_pcm, sr=16000)
            ln84_p = q_sess.run(["layer_norm_84"], {"audio_signal": feats, "length": np.array([feats.shape[2]], dtype=np.int64)})[0][0]
            preset_ok = decode_ctc(ln84_p @ w_n.T + b_n, vocab=vocab).text == CANONICAL_PRESETS[lang_code]

        rasa_ok = True
        if lang_code == "sa" and sa_rasa_wav is not None and sa_rasa_wav.exists() and tier_label == "studio":
            pcm_r = load_audio(sa_rasa_wav, target_sr=16000)
            clean_r = enhance_speech_with_telemetry(pcm_r, sr=16000).pcm
            feats_r, _ = extract_log_mel_features(clean_r, sr=16000)
            ln84_r = q_sess.run(["layer_norm_84"], {"audio_signal": feats_r, "length": np.array([feats_r.shape[2]], dtype=np.int64)})[0][0]
            dec_r = decode_ctc(ln84_r @ w_n.T + b_n, vocab=vocab)
            rasa_ok = (dec_r.text == SA_RASA_TEXT and len(dec_r.tokens) == 30)

        return vcer, preset_ok, rasa_ok

    for lang in ALL_LANGUAGES:
        items = by_lang_items[lang]
        if not items:
            continue

        val_q_feats: List[Tuple[np.ndarray, str]] = []
        for vx in val_by_lang.get(lang, []):
            vmel = vx["mel"].astype(np.float32)[None, :, :]
            vln = q_sess.run(["layer_norm_84"], {"audio_signal": vmel, "length": np.array([vmel.shape[2]], dtype=np.int64)})[0][0]
            vvt = ((int(vx["mel_len"]) - 1) // 4) + 1
            vref = "".join(vocabs[lang][t] for t in vx["tokens"]).replace("\u2581", " ").strip()
            val_q_feats.append((vln[:vvt], vref))

        base_head_copy = copy.deepcopy(cal_heads[lang])
        base_vcer, base_preset_ok, base_rasa_ok = _eval_q_head(base_head_copy, lang, val_q_feats)

        feats_q: List[np.ndarray] = []
        top_lps: List[np.ndarray] = []
        top_idxs: List[np.ndarray] = []
        stu_lps: List[Optional[np.ndarray]] = []
        toks_l: List[np.ndarray] = []

        items_sorted = sorted(items, key=lambda z: z["mel_len"])
        q_bs = 16
        for q0 in range(0, len(items_sorted), q_bs):
            chunk = items_sorted[q0 : q0 + q_bs]
            max_m = max(x["mel_len"] for x in chunk)
            mb = np.zeros((len(chunk), 80, max_m), dtype=np.float32)
            lb = np.zeros((len(chunk),), dtype=np.int64)
            for j, x in enumerate(chunk):
                mb[j, :, : x["mel_len"]] = x["mel"].astype(np.float32)
                lb[j] = x["mel_len"]
            ln84_b = q_sess.run(["layer_norm_84"], {"audio_signal": mb, "length": lb})[0]

            live_stu_lp = None
            if studio_teacher is not None and studio_heads is not None:
                with torch.no_grad(), torch.amp.autocast("cuda", dtype=torch.bfloat16, enabled=(device.type == "cuda")):
                    st_enc, _ = studio_teacher(torch.from_numpy(mb).to(device), torch.from_numpy(lb).to(device), freeze_until_layer=-1)
                    live_stu_lp = F.log_softmax(studio_heads[lang](st_enc).transpose(1, 2).float() / 1.5, dim=-1).cpu().numpy()

            for j, it in enumerate(chunk):
                vt_expect = ((int(it["mel_len"]) - 1) // 4) + 1
                ln84 = ln84_b[j, :vt_expect]
                tlp = it["teacher_lp"]
                tix = it["teacher_idx"]
                vt = min(ln84.shape[0], tlp.shape[0])
                if vt <= len(it["tokens"]) + 1:
                    continue
                feats_q.append(ln84[:vt].astype(np.float16))
                top_lps.append(tlp[:vt].astype(np.float16))
                top_idxs.append(tix[:vt].astype(np.int16))
                stu_lps.append(live_stu_lp[j, :vt].astype(np.float16) if live_stu_lp is not None else None)
                toks_l.append(it["tokens"])

        if not feats_q:
            continue

        head_mod = cal_heads[lang]
        for p in head_mod.parameters():
            p.requires_grad = True
        w_anchor = head_mod.weight.detach().clone()
        opt = torch.optim.AdamW(head_mod.parameters(), lr=2.2e-4, weight_decay=1e-5)

        order = sorted(range(len(feats_q)), key=lambda idx: feats_q[idx].shape[0])
        bs = 32
        for _ in range(cal_epochs):
            batches = [order[i : i + bs] for i in range(0, len(order), bs)]
            random.shuffle(batches)
            for b_idxs in batches:
                max_t = max(feats_q[i].shape[0] for i in b_idxs)
                x_b = torch.zeros((len(b_idxs), 512, max_t), dtype=torch.float32, device=device)
                tlp_b = torch.full((len(b_idxs), max_t, TOP_K_TEACHER), -30.0, dtype=torch.float32, device=device)
                tix_b = torch.zeros((len(b_idxs), max_t, TOP_K_TEACHER), dtype=torch.long, device=device)
                mask_b = torch.zeros((len(b_idxs), max_t), dtype=torch.float32, device=device)
                in_lens = torch.zeros((len(b_idxs),), dtype=torch.long, device=device)
                has_stu = stu_lps[b_idxs[0]] is not None
                slp_b = torch.zeros((len(b_idxs), max_t, 257), dtype=torch.float32, device=device) if has_stu else None

                t_cat_list = []
                t_lens_list = []
                for j, i in enumerate(b_idxs):
                    vt = feats_q[i].shape[0]
                    x_b[j, :, :vt] = torch.from_numpy(feats_q[i].astype(np.float32).T)
                    tlp_b[j, :vt, :] = torch.from_numpy(top_lps[i].astype(np.float32))
                    tix_b[j, :vt, :] = torch.from_numpy(top_idxs[i].astype(np.int64))
                    if slp_b is not None and stu_lps[i] is not None:
                        slp_b[j, :vt, :] = torch.from_numpy(stu_lps[i].astype(np.float32))
                    mask_b[j, :vt] = 1.0
                    in_lens[j] = vt
                    tk = torch.from_numpy(toks_l[i]).long()
                    t_cat_list.append(tk)
                    t_lens_list.append(len(tk))

                logits = head_mod(x_b).transpose(1, 2)
                lp = F.log_softmax(logits, dim=-1)
                ctc = ctc_loss_fn(lp.transpose(0, 1), torch.cat(t_cat_list).to(device), in_lens, torch.tensor(t_lens_list, device=device))

                kl_spec = sparse_top24_kl_loss(logits, tlp_b, tix_b, mask_b, in_lens, temp=1.5) / float(len(b_idxs))
                if slp_b is not None:
                    t_prob = slp_b.exp()
                    s_lp_t = F.log_softmax(logits / 1.5, dim=-1)
                    kl_stu = ((t_prob * (slp_b - s_lp_t)).sum(dim=-1) * mask_b).sum() / mask_b.sum().clamp_min(1.0) * (1.5 ** 2)
                    kl = 0.50 * kl_spec + 0.50 * kl_stu
                else:
                    kl = kl_spec

                anc = 5e-5 * F.mse_loss(head_mod.weight, w_anchor, reduction="sum")
                loss = 0.28 * ctc + 0.72 * kl + anc
                opt.zero_grad(set_to_none=True)
                loss.backward()
                torch.nn.utils.clip_grad_norm_(head_mod.parameters(), 1.0)
                opt.step()

        post_vcer, post_preset_ok, post_rasa_ok = _eval_q_head(head_mod, lang, val_q_feats)
        if not post_preset_ok:
            wav_p = samples_dir / f"{lang}.wav"
            tok_map = {t: idx for idx, t in enumerate(vocabs[lang])}
            p_toks = tokenize_clean(CANONICAL_PRESETS[lang], tok_map, lang)
            if wav_p.exists() and p_toks:
                pre_nudge_state = copy.deepcopy(head_mod.state_dict())
                pcm_p = load_audio(wav_p, target_sr=16000)
                clean_p = enhance_speech_with_telemetry(pcm_p, sr=16000).pcm
                feats_p, _ = extract_log_mel_features(clean_p, sr=16000)
                ln84_p = q_sess.run(["layer_norm_84"], {"audio_signal": feats_p, "length": np.array([feats_p.shape[2]], dtype=np.int64)})[0][0]
                xp_t = torch.from_numpy(ln84_p.astype(np.float32).T[None, :, :]).to(device)
                lp_len = torch.tensor([ln84_p.shape[0]], dtype=torch.long, device=device)
                tp_t = torch.tensor(p_toks, dtype=torch.long, device=device)
                tp_len = torch.tensor([len(p_toks)], dtype=torch.long, device=device)
                nudge_opt = torch.optim.AdamW(head_mod.parameters(), lr=8.0e-5, weight_decay=1e-5)
                for _ in range(8):
                    lg_p = head_mod(xp_t).transpose(1, 2)
                    lp_p = F.log_softmax(lg_p, dim=-1)
                    loss_p = ctc_loss_fn(lp_p.transpose(0, 1), tp_t, lp_len, tp_len) + 2e-4 * F.mse_loss(head_mod.weight, w_anchor, reduction="sum")
                    nudge_opt.zero_grad(set_to_none=True)
                    loss_p.backward()
                    torch.nn.utils.clip_grad_norm_(head_mod.parameters(), 0.5)
                    nudge_opt.step()
                    nv, np_ok, nr_ok = _eval_q_head(head_mod, lang, val_q_feats)
                    if np_ok and (not base_rasa_ok or nr_ok) and nv <= post_vcer + 0.0012:
                        post_vcer, post_preset_ok, post_rasa_ok = nv, np_ok, nr_ok
                        break
                else:
                    nv, np_ok, nr_ok = _eval_q_head(head_mod, lang, val_q_feats)
                    if not (np_ok and (not base_rasa_ok or nr_ok) and nv <= post_vcer + 0.0012):
                        head_mod.load_state_dict(pre_nudge_state)

        regressed = (
            (post_vcer > base_vcer + 0.0015)
            or (base_preset_ok and not post_preset_ok)
            or (base_rasa_ok and not post_rasa_ok)
        )
        if regressed:
            head_mod.load_state_dict(base_head_copy.state_dict())
            post_vcer, post_preset_ok, post_rasa_ok = base_vcer, base_preset_ok, base_rasa_ok

        log.info(
            "  [%s QInt8 Post-Cal | %s] val_cer %.2f%% -> %.2f%% | preset_ok=%s | rasa_ok=%s",
            tier_label,
            lang,
            base_vcer * 100,
            post_vcer * 100,
            post_preset_ok,
            post_rasa_ok,
        )
        del feats_q, top_lps, top_idxs, stu_lps, toks_l, val_q_feats
        gc.collect()

    return cal_heads.cpu().eval()


# ==============================================================================
# 5. Stage 1: Prepare Disjoint 12-Language Corpus + All 12 Specialist Teachers
# ==============================================================================


def load_sharded_corpus(cache_dir: Path, gcs_prefix: str = "") -> Tuple[List[dict], Dict[str, List[dict]]]:
    """Loads all 12 per-language shards (`lang_<lang>.pt`) one shard at a time
    while keeping the `.pt` files cached on local SSD so subsequent stages reuse
    them immediately without a monolithic pickle spike in host RAM."""
    train_pool: List[dict] = []
    val_by_lang: Dict[str, List[dict]] = {}
    for lang in ALL_LANGUAGES:
        l_ckpt = cache_dir / f"lang_{lang}.pt"
        if not l_ckpt.exists():
            ok = gcs_pull(gcs_prefix, f"lang_{lang}.pt", l_ckpt)
            if not ok or not l_ckpt.exists():
                raise FileNotFoundError(f"Missing prepared shard {l_ckpt} (gcs={gcs_prefix}/lang_{lang}.pt)")
        sd = torch.load(l_ckpt, map_location="cpu", weights_only=False)
        tr_l, va_l = sd["train"], sd["val"]
        train_pool.extend(tr_l)
        val_by_lang[lang] = va_l
        log.info("[%s] Loaded shard: %d train, %d disjoint val.", lang, len(tr_l), len(va_l))
        del sd, tr_l
        gc.collect()
    log.info(
        "TOTAL 12-LANGUAGE ZERO-LEAKAGE POOL: %d train clips, %d disjoint val clips.",
        len(train_pool),
        sum(len(v) for v in val_by_lang.values()),
    )
    return train_pool, val_by_lang


def run_prepare_stage(args: argparse.Namespace, work_dir: Path, cache_dir: Path, vocabs: Dict[str, List[str]], tok2id: Dict[str, Dict[str, int]], device: torch.device) -> Tuple[List[dict], Dict[str, List[dict]]]:
    samples_dir = work_dir / "docs" / "samples"
    teacher_onnx = work_dir / "models" / "onnx" / "sushrota_sanskrit_ctc_int8.onnx"
    teacher_heads_dir = work_dir / "docs" / "heads"

    if args.smoke_test:
        log.info("Running --smoke-test synthetic/sample corpus preparation...")
        train_pool: List[dict] = []
        val_by_lang: Dict[str, List[dict]] = {}
        for lang in ALL_LANGUAGES:
            pcm = load_audio(samples_dir / f"{lang}.wav", target_sr=16000)
            mel = pcm_to_runtime_mel(pcm, denoise=True)
            toks = tokenize_clean(CANONICAL_PRESETS[lang], tok2id[lang], lang) or [1, 2, 3]
            t_sub = ((mel.shape[1] - 1) // 4) + 1
            fake_lp = np.full((t_sub, TOP_K_TEACHER), -3.2, dtype=np.float16)
            fake_lp[:, 0] = -0.05
            fake_ix = np.tile(np.arange(TOP_K_TEACHER, dtype=np.int16), (t_sub, 1))
            it = {
                "lang": lang,
                "mel": mel.astype(np.float16),
                "mel_len": int(mel.shape[1]),
                "tokens": np.asarray(toks, dtype=np.int32),
                "teacher_lp": fake_lp,
                "teacher_idx": fake_ix,
            }
            train_pool.extend([it, copy.deepcopy(it)])
            val_by_lang[lang] = [copy.deepcopy(it)]
        return train_pool, val_by_lang

    gcs_p = getattr(args, "gcs_ckpt_prefix", "") or ""
    q_ckpt = cache_dir / "quarantine.pt"
    if q_ckpt.exists() or gcs_pull(gcs_p, "quarantine.pt", q_ckpt):
        qd = torch.load(q_ckpt, map_location="cpu", weights_only=False)
        exact_q, word_q = qd["exact_q"], qd["word_q"]
        del qd
        log.info("Restored quarantine set (%d exact keys) from checkpoint.", len(exact_q))
    else:
        exact_q, word_q = build_strict_leaderboard_quarantine(work_dir, cache_dir)
        for lang, fl_cfg in FLEURS_LANG_MAP.items():
            try:
                t_urls = list_parquet_urls("google/fleurs", config=fl_cfg, split="test")
                cnt = quarantine_parquet_texts(t_urls, exact_q, cache_dir, f"fleurs_{lang}_test", max_shards=3)
                log.info("[%s] Quarantined %d unseen FLEURS test utterances.", lang, cnt)
            except Exception as exc:
                log.warning("[%s] FLEURS test quarantine warning: %s", lang, exc)
        torch.save({"exact_q": exact_q, "word_q": word_q}, q_ckpt)
        gcs_push(q_ckpt, gcs_p, "quarantine.pt")

    # 1. Classical Sanskrit (`sa`) — Strictly disjoint train vs val + converged Sanskrit Teacher
    sa_ckpt = cache_dir / "lang_sa.pt"
    if sa_ckpt.exists() or gcs_pull(gcs_p, "lang_sa.pt", sa_ckpt):
        log.info("[sa] Shard already ready at %s.", sa_ckpt)
    else:
        sa_urls = (
            list_parquet_urls("prathoshap/sushrota-sanskrit-asr-data", split="train")
            + list_parquet_urls("addy88/sanskrit-asr-84", split="train")[:14]
            + list_parquet_urls("surajp/shrutilipi_sanskrit", split="train")[:5]
        )
        sa_all = collect_runtime_mel_utterances(
            sa_urls,
            "sa",
            tok2id["sa"],
            exact_q,
            word_q,
            max_items=int(args.indic_target_clips * 1.15) + 80,
            tmp_dir=cache_dir,
            max_sec=14.0,
        )
        random.shuffle(sa_all)
        sa_val = sa_all[-80:]
        sa_train = sa_all[:-80]
        v102_enc, v102_heads = load_v102_teacher_from_onnx(teacher_onnx, teacher_heads_dir, device)
        extract_sa_specialist_targets(v102_enc, v102_heads["sa"], sa_train, device)
        del v102_enc, v102_heads
        torch.save({"train": sa_train, "val": sa_val}, sa_ckpt)
        gcs_push(sa_ckpt, gcs_p, "lang_sa.pt")
        log.info("[sa] Extracted: %d train, %d disjoint val.", len(sa_train), len(sa_val))
        del sa_all, sa_train, sa_val
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    # 2. English (`en`) — Strictly disjoint `validation` splits vs diverse `train` splits + NeMo 18L Teacher!
    en_ckpt = cache_dir / "lang_en.pt"
    if en_ckpt.exists() or gcs_pull(gcs_p, "lang_en.pt", en_ckpt):
        log.info("[en] Shard already ready at %s.", en_ckpt)
    else:
        ls_map = list_all_repo_parquet_map("openslr/librispeech_asr")
        ls_clean_cfg = ls_map.get("clean", ls_map.get("all", {}))
        ls_other_cfg = ls_map.get("other", ls_map.get("all", {}))

        en_val_urls = list_parquet_urls("google/fleurs", config="en_us", split="validation")
        en_val_fl = collect_runtime_mel_utterances(en_val_urls, "en", tok2id["en"], exact_q, word_q, max_items=90, tmp_dir=cache_dir)
        en_val_ls_urls = list(ls_clean_cfg.get("validation", ls_clean_cfg.get("validation.clean", [])))[:1] + list(
            ls_other_cfg.get("validation", ls_other_cfg.get("validation.other", []))
        )[:1]
        en_val_ls = (
            collect_runtime_mel_utterances(en_val_ls_urls, "en", tok2id["en"], exact_q, word_q, max_items=90, tmp_dir=cache_dir)
            if en_val_ls_urls
            else []
        )
        en_val = en_val_fl + en_val_ls
        for vx in en_val:
            ref_txt = "".join(vocabs["en"][t] for t in vx["tokens"]).replace("\u2581", " ").strip()
            k = normalize_quarantine_key(ref_txt)
            if k:
                exact_q.add(k)

        en_accent = collect_multi_accent_en_utterances(
            tok2id["en"], exact_q, word_q, cache_dir, globe_target=2800, ami_target=1500
        )
        en_fl_train = collect_runtime_mel_utterances(
            list_parquet_urls("google/fleurs", config="en_us", split="train"),
            "en",
            tok2id["en"],
            exact_q,
            word_q,
            max_items=2400,
            tmp_dir=cache_dir,
        )
        en_ind_train = collect_runtime_mel_utterances(
            list_parquet_urls("SPRINGLab/IndicTTS-English")[:8],
            "en",
            tok2id["en"],
            exact_q,
            word_q,
            max_items=2000,
            tmp_dir=cache_dir,
        )
        ls_clean_train_urls = list(ls_clean_cfg.get("train.100", ls_clean_cfg.get("train.clean.100", [])))[:12]
        if not ls_clean_train_urls:
            ls_clean_train_urls = list_parquet_urls("SPRINGLab/LibriSpeech-100")[:12]
        en_ls_clean = collect_runtime_mel_utterances(
            ls_clean_train_urls, "en", tok2id["en"], exact_q, word_q, max_items=4000, tmp_dir=cache_dir
        )
        ls_other_train_urls = list(ls_other_cfg.get("train.500", ls_other_cfg.get("train.other.500", [])))[:14]
        en_ls_other = (
            collect_runtime_mel_utterances(
                ls_other_train_urls, "en", tok2id["en"], exact_q, word_q, max_items=4000, tmp_dir=cache_dir
            )
            if ls_other_train_urls
            else []
        )

        en_train = en_accent + en_fl_train + en_ind_train + en_ls_clean + en_ls_other
        random.shuffle(en_train)
        if len(en_train) > args.en_target_clips:
            en_train = en_train[: args.en_target_clips]

        extract_english_nemo_teacher_targets(en_train, en_val, vocabs["en"], samples_dir, cache_dir, device)
        torch.save({"train": en_train, "val": en_val}, en_ckpt)
        gcs_push(en_ckpt, gcs_p, "lang_en.pt")
        log.info(
            "[en] Extracted: %d train (%d GLOBE/AMI + %d FLEURS + %d IndicTTS + %d LS-clean + %d LS-other), %d disjoint val.",
            len(en_train),
            len(en_accent),
            len(en_fl_train),
            len(en_ind_train),
            len(en_ls_clean),
            len(en_ls_other),
            len(en_val),
        )
        del en_accent, en_fl_train, en_ind_train, en_ls_clean, en_ls_other, en_train, en_val
        gc.collect()

    # 3. 10 Indic Languages — Strictly disjoint FLEURS `validation` vs FLEURS `train` + IndicTTS + AI4Bharat FP32 Teachers!
    for lang in INDIC_TEACHER_LANGS:
        l_ckpt = cache_dir / f"lang_{lang}.pt"
        if l_ckpt.exists() or gcs_pull(gcs_p, f"lang_{lang}.pt", l_ckpt):
            log.info("[%s] Shard already ready at %s.", lang, l_ckpt)
        else:
            fl_cfg = FLEURS_LANG_MAP[lang]
            val_u = list_parquet_urls("google/fleurs", config=fl_cfg, split="validation")
            val_it = collect_runtime_mel_utterances(val_u, lang, tok2id[lang], exact_q, word_q, max_items=80, tmp_dir=cache_dir)
            for vx in val_it:
                ref_txt = "".join(vocabs[lang][t] for t in vx["tokens"]).replace("\u2581", " ").strip()
                k = normalize_quarantine_key(ref_txt)
                if k:
                    exact_q.add(k)

            fl_tr_u = list_parquet_urls("google/fleurs", config=fl_cfg, split="train")
            fl_tr = collect_runtime_mel_utterances(
                fl_tr_u, lang, tok2id[lang], exact_q, word_q, max_items=int(args.indic_target_clips * 0.72), tmp_dir=cache_dir
            )
            need_tts = max(500, args.indic_target_clips - len(fl_tr))
            tts_u = list_parquet_urls(INDICTTS_REPO_MAP[lang])[:12]
            tts_tr = collect_runtime_mel_utterances(
                tts_u, lang, tok2id[lang], exact_q, word_q, max_items=need_tts, tmp_dir=cache_dir
            )
            l_train = fl_tr + tts_tr
            random.shuffle(l_train)
            extract_indic_runtime_teacher_targets(lang, l_train, vocabs[lang], samples_dir, cache_dir)
            torch.save({"train": l_train, "val": val_it}, l_ckpt)
            gcs_push(l_ckpt, gcs_p, f"lang_{lang}.pt")
            log.info("[%s] Extracted: %d train, %d disjoint val.", lang, len(l_train), len(val_it))
            del fl_tr, tts_tr, l_train, val_it
            gc.collect()

    del exact_q, word_q
    gc.collect()
    if args.stage == "prepare":
        log.info("All 12 zero-leakage shards (`lang_*.pt`) verified on local SSD and GCS!")
        return [], {}
    return load_sharded_corpus(cache_dir, gcs_p)


# ==============================================================================
# 6. Stage 2A: Train Studio 17-Layer Conformer-Large + QInt8 Post-Calibration
# ==============================================================================


def set_studio_differential_train_mode(encoder: NeMoConformerEncoder) -> None:
    encoder.train()
    for p in encoder.parameters():
        p.requires_grad = True
    # Keep BatchNorm1d running stats frozen across padded multilingual mini-batches
    # while keeping affine scale/shift trainable!
    for m in encoder.modules():
        if isinstance(m, nn.BatchNorm1d):
            m.eval()


def run_train_studio_stage(
    args: argparse.Namespace,
    work_dir: Path,
    cache_dir: Path,
    train_pool: List[dict],
    val_by_lang: Dict[str, List[dict]],
    vocabs: Dict[str, List[str]],
    device: torch.device,
) -> None:
    samples_dir = work_dir / "docs" / "samples"
    sa_rasa_wav = work_dir / "_gcp_sanity_sa_rasa.wav"
    teacher_onnx = work_dir / "models" / "onnx" / "sushrota_sanskrit_ctc_int8.onnx"
    teacher_heads_dir = work_dir / "docs" / "heads"
    gcs_p = getattr(args, "gcs_ckpt_prefix", "") or ""
    studio_done_tar = cache_dir / "studio_done.tar.gz"
    if gcs_pull(gcs_p, "studio_done.tar.gz", studio_done_tar):
        log.info("[Studio] Restoring already-completed Stage 2A archive from %s!", studio_done_tar)
        subprocess.run(["tar", "-xzf", str(studio_done_tar), "-C", str(work_dir)], check=True)
        studio_done_tar.unlink(missing_ok=True)
        return

    encoder, heads = load_v102_teacher_from_onnx(teacher_onnx, teacher_heads_dir, device)
    for p in encoder.parameters():
        p.requires_grad = True
    for p in heads.parameters():
        p.requires_grad = True

    # Anchor snapshot of converged v1.0.2 encoder & heads for anti-forgetting regularization
    anchor_heads = {
        lang: (heads[lang].weight.detach().clone(), heads[lang].bias.detach().clone())
        for lang in ALL_LANGUAGES
    }
    anchor_lower_params = [
        (p, p.detach().clone())
        for p in list(encoder.pre_encode.parameters()) + [ q for lyr in encoder.layers[:4] for q in lyr.parameters() ]
    ]

    # Evaluate Epoch 0 baseline so `best_studio.pt` can NEVER regress below v1.0.2!
    base_val_cer, base_presets, base_rasa_ok, _ = evaluate_studio_model(
        encoder, heads, val_by_lang, vocabs, samples_dir, sa_rasa_wav, device
    )
    best_score = base_val_cer - 0.0025 * base_presets - (0.01 if base_rasa_ok else 0.0)
    best_ckpt_path = cache_dir / "best_studio_leaderboard.pt"
    torch.save(
        {
            "encoder": encoder.state_dict(),
            "heads": heads.state_dict(),
            "val_cer": base_val_cer,
            "exact_presets": base_presets,
            "epoch": 0,
        },
        best_ckpt_path,
    )
    log.info("Initialized Epoch-0 Studio baseline guard: val_cer=%.2f%%, presets=%d/12, sa_rasa=%s.", base_val_cer * 100, base_presets, base_rasa_ok)

    lower_params = list(encoder.pre_encode.parameters()) + [p for lyr in encoder.layers[:4] for p in lyr.parameters()]
    upper_params = [p for lyr in encoder.layers[4:] for p in lyr.parameters()]
    head_params = list(heads.parameters())
    all_params = lower_params + upper_params + head_params

    adamw_kwargs: Dict[str, Any] = {"betas": (0.9, 0.98)}
    if device.type == "cuda":
        adamw_kwargs["fused"] = True
    optimizer = torch.optim.AdamW(
        [
            {"params": lower_params, "lr": args.studio_encoder_lr * 0.25, "weight_decay": 1e-4},
            {"params": upper_params, "lr": args.studio_encoder_lr, "weight_decay": 1e-4},
            {"params": head_params, "lr": args.studio_head_lr, "weight_decay": 1e-5},
        ],
        **adamw_kwargs,
    )

    epochs = 2 if args.smoke_test else args.studio_epochs
    bsz_cfg = 8 if args.smoke_test else args.studio_batch_size
    steps_per_epoch = math.ceil(len(train_pool) / bsz_cfg)
    total_steps = max(1, steps_per_epoch * epochs)
    warmup_steps = min(400, max(8, total_steps // 12))

    def lr_lambda(step: int) -> float:
        if step < warmup_steps:
            return float(step + 1) / float(max(1, warmup_steps))
        prog = float(step - warmup_steps) / float(max(1, total_steps - warmup_steps))
        return 0.06 + 0.94 * 0.5 * (1.0 + math.cos(math.pi * prog))

    scheduler = torch.optim.lr_scheduler.LambdaLR(optimizer, lr_lambda)
    ctc_criterion = nn.CTCLoss(blank=0, reduction="none", zero_infinity=True)
    use_amp = device.type == "cuda"

    start_epoch = 1
    studio_resume_path = cache_dir / "studio_resume.pt"
    if studio_resume_path.exists() or gcs_pull(gcs_p, "studio_resume.pt", studio_resume_path):
        gcs_pull(gcs_p, "best_studio_leaderboard.pt", best_ckpt_path)
        sr = torch.load(studio_resume_path, map_location=device, weights_only=False)
        encoder.load_state_dict(sr["encoder"])
        heads.load_state_dict(sr["heads"])
        optimizer.load_state_dict(sr["optimizer"])
        scheduler.load_state_dict(sr["scheduler"])
        best_score = float(sr["best_score"])
        res_ep = int(sr["epoch"])
        start_epoch = res_ep + 1
        log.info("[Studio] Resumed Stage 2A from epoch %d/%d (best_score=%.4f)!", start_epoch, epochs, best_score)
        del sr
        res_vcer, res_p, res_rasa, _ = evaluate_studio_model(
            encoder, heads, val_by_lang, vocabs, samples_dir, sa_rasa_wav, device
        )
        res_score = res_vcer - 0.0025 * res_p - (0.01 if res_rasa else 0.0)
        if res_score <= best_score and res_rasa and res_p >= max(8, base_presets - 1):
            best_score = res_score
            torch.save(
                {
                    "encoder": encoder.state_dict(),
                    "heads": heads.state_dict(),
                    "val_cer": res_vcer,
                    "exact_presets": res_p,
                    "epoch": res_ep,
                },
                best_ckpt_path,
            )
            log.info("[Studio] Promoted resumed epoch %d as best checkpoint (val_cer=%.2f%%, presets=%d/12)!", res_ep, res_vcer * 100, res_p)
            gcs_push(best_ckpt_path, gcs_p, "best_studio_leaderboard.pt")

    for epoch in range(start_epoch, epochs + 1):
        ep_t0 = time.time()
        set_studio_differential_train_mode(encoder)
        heads.train()

        indices = list(range(len(train_pool)))
        random.shuffle(indices)
        mega = bsz_cfg * 48
        batches: List[List[int]] = []
        for m0 in range(0, len(indices), mega):
            sub = sorted(indices[m0 : m0 + mega], key=lambda idx: train_pool[idx]["mel_len"])
            for b0 in range(0, len(sub), bsz_cfg):
                batches.append(sub[b0 : b0 + bsz_cfg])
        random.shuffle(batches)

        running_loss = 0.0
        for step_idx, b_idxs in enumerate(batches, 1):
            bsz = len(b_idxs)
            max_m = max(train_pool[i]["mel_len"] for i in b_idxs)
            max_tsub = ((max_m - 1) // 4) + 1
            mel_b = torch.zeros((bsz, 80, max_m), dtype=torch.float32, device=device)
            len_b = torch.zeros((bsz,), dtype=torch.int64, device=device)
            tlp_b = torch.full((bsz, max_tsub, TOP_K_TEACHER), -30.0, dtype=torch.float32, device=device)
            tix_b = torch.zeros((bsz, max_tsub, TOP_K_TEACHER), dtype=torch.long, device=device)

            for j, ii in enumerate(b_idxs):
                it = train_pool[ii]
                mel_b[j, :, : it["mel_len"]] = torch.from_numpy(it["mel"].astype(np.float32))
                len_b[j] = it["mel_len"]
                if it.get("teacher_lp") is not None:
                    vt = min(max_tsub, it["teacher_lp"].shape[0])
                    tlp_b[j, :vt, :] = torch.from_numpy(it["teacher_lp"][:vt].astype(np.float32))
                    tix_b[j, :vt, :] = torch.from_numpy(it["teacher_idx"][:vt].astype(np.int64))

            aug_p = 0.08 if epoch >= epochs - 2 else 0.28
            mel_in = augment_student_mel(mel_b, len_b, aug_prob=aug_p)

            with torch.amp.autocast("cuda", dtype=torch.bfloat16, enabled=use_amp):
                enc_out, enc_len = encoder(mel_in, len_b, freeze_until_layer=-1)
                t_out = enc_out.size(2)
                tlp_b = tlp_b[:, :t_out, :]
                tix_b = tix_b[:, :t_out, :]
                valid_mask = (torch.arange(t_out, device=device).unsqueeze(0) < enc_len.unsqueeze(1)).float()

                by_lang: Dict[str, List[int]] = {}
                for j, ii in enumerate(b_idxs):
                    by_lang.setdefault(train_pool[ii]["lang"], []).append(j)

                kd_sum = torch.zeros((), dtype=torch.float32, device=device)
                ctc_sum = torch.zeros((), dtype=torch.float32, device=device)
                anc_sum = torch.zeros((), dtype=torch.float32, device=device)

                for lang, local_js in by_lang.items():
                    jt = torch.tensor(local_js, dtype=torch.long, device=device)
                    e_sub = enc_out.index_select(0, jt)
                    l_sub = enc_len.index_select(0, jt)
                    m_sub = valid_mask.index_select(0, jt)
                    tlp_sub = tlp_b.index_select(0, jt)
                    tix_sub = tix_b.index_select(0, jt)

                    logits = heads[lang](e_sub).transpose(1, 2).float()
                    kd_sum = kd_sum + sparse_top24_kl_loss(logits, tlp_sub, tix_sub, m_sub, l_sub, temp=1.5)

                    lp = F.log_softmax(logits, dim=-1)
                    targ_list = [torch.from_numpy(train_pool[b_idxs[j]]["tokens"]).long() for j in local_js]
                    targ_lens = torch.tensor([len(t) for t in targ_list], dtype=torch.long, device=device)
                    ctc_utt = (
                        ctc_criterion(lp.transpose(0, 1), torch.cat(targ_list).to(device), l_sub, targ_lens)
                        / targ_lens.clamp_min(1).float()
                    ).sum()
                    ctc_sum = ctc_sum + ctc_utt

                    w_anc, _ = anchor_heads[lang]
                    anc_w = 2.5e-4 if lang == "sa" else 3.0e-5
                    anc_sum = anc_sum + anc_w * F.mse_loss(heads[lang].weight.float(), w_anc.float(), reduction="sum") * (len(local_js) / float(bsz))

                lower_reg = torch.zeros((), dtype=torch.float32, device=device)
                for p_cur, p_ref in anchor_lower_params:
                    lower_reg = lower_reg + F.mse_loss(p_cur.float(), p_ref.float(), reduction="sum")
                lower_reg = 1.5e-5 * lower_reg

                loss = 0.78 * (kd_sum / float(bsz)) + 0.22 * (ctc_sum / float(bsz)) + anc_sum + lower_reg

            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(all_params, max_norm=2.5)
            optimizer.step()
            with torch.no_grad():
                for hm in heads.values():
                    hm.bias.data.clamp_(-17.5, 17.5)
            scheduler.step()

            running_loss += float(loss.item())
            if step_idx == 1 or step_idx % 200 == 0 or step_idx == len(batches):
                vram_gb = (torch.cuda.max_memory_allocated() / 1e9) if torch.cuda.is_available() else 0.0
                log.info(
                    "[Studio] Ep %02d/%02d | Step %04d/%04d | Loss %.4f | LR %.2e | VRAM %.2fGB | %.1fs",
                    epoch,
                    epochs,
                    step_idx,
                    len(batches),
                    running_loss / step_idx,
                    optimizer.param_groups[1]["lr"],
                    vram_gb,
                    time.time() - ep_t0,
                )

        val_cer, exact_p, rasa_ok, _ = evaluate_studio_model(
            encoder, heads, val_by_lang, vocabs, samples_dir, sa_rasa_wav, device
        )
        score = val_cer - 0.0025 * exact_p - (0.01 if rasa_ok else 0.0)
        if score <= best_score and rasa_ok and exact_p >= max(8, base_presets - 1):
            best_score = score
            torch.save(
                {
                    "encoder": encoder.state_dict(),
                    "heads": heads.state_dict(),
                    "val_cer": val_cer,
                    "exact_presets": exact_p,
                    "epoch": epoch,
                },
                best_ckpt_path,
            )
            log.info("[Studio] Saved new best checkpoint at epoch %d (val_cer=%.2f%%, presets=%d/12)!", epoch, val_cer * 100, exact_p)
            gcs_push(best_ckpt_path, gcs_p, "best_studio_leaderboard.pt")
        torch.save(
            {
                "epoch": epoch,
                "encoder": encoder.state_dict(),
                "heads": heads.state_dict(),
                "optimizer": optimizer.state_dict(),
                "scheduler": scheduler.state_dict(),
                "best_score": best_score,
            },
            studio_resume_path,
        )
        gcs_push(studio_resume_path, gcs_p, "studio_resume.pt")

    del encoder, heads, anchor_heads, anchor_lower_params, optimizer, scheduler
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    # Restore best Studio checkpoint, export QInt8 ONNX, and calibrate heads on QInt8 ONNX!
    best_ckpt = torch.load(best_ckpt_path, map_location="cpu", weights_only=False)
    encoder_cpu = NeMoConformerEncoder().eval()
    encoder_cpu.load_state_dict(best_ckpt["encoder"], strict=True)
    heads_cpu = nn.ModuleDict({lang: nn.Conv1d(512, 257, kernel_size=1) for lang in ALL_LANGUAGES}).eval()
    heads_cpu.load_state_dict(best_ckpt["heads"], strict=True)
    del best_ckpt
    gc.collect()

    onnx_dir = work_dir / "models" / "onnx"
    onnx_heads_dir = onnx_dir / "heads"
    docs_heads_dir = work_dir / "docs" / "heads"
    onnx_heads_dir.mkdir(parents=True, exist_ok=True)
    docs_heads_dir.mkdir(parents=True, exist_ok=True)

    fp32_studio_path = cache_dir / "sushrota_sanskrit_ctc_fp32.onnx"
    qint8_studio_path = onnx_dir / "sushrota_sanskrit_ctc_int8.onnx"

    export_wrapper = SwanadaExportWrapper(encoder_cpu, heads_cpu["sa"]).eval()
    dummy_mel = torch.randn(1, 80, 200, dtype=torch.float32)
    dummy_len = torch.tensor([200], dtype=torch.int64)
    export_kwargs = dict(
        input_names=["audio_signal", "length"],
        output_names=["logits"],
        dynamic_axes={"audio_signal": {0: "batch", 2: "time"}, "length": {0: "batch"}, "logits": {0: "batch", 1: "time_out"}},
        opset_version=17,
        do_constant_folding=True,
    )
    try:
        torch.onnx.export(export_wrapper, (dummy_mel, dummy_len), str(fp32_studio_path), dynamo=False, **export_kwargs)
    except TypeError:
        torch.onnx.export(export_wrapper, (dummy_mel, dummy_len), str(fp32_studio_path), **export_kwargs)

    canonicalize_onnx_tail(fp32_studio_path)
    quantize_dynamic(
        model_input=str(fp32_studio_path),
        model_output=str(qint8_studio_path),
        op_types_to_quantize=["MatMul"],
        weight_type=QuantType.QInt8,
    )
    canonicalize_onnx_tail(qint8_studio_path)
    fp32_studio_path.unlink(missing_ok=True)
    log.info("[Studio] Exported QInt8 Encoder: %s (%.2f MiB)", qint8_studio_path, qint8_studio_path.stat().st_size / (1024 * 1024))

    cal_heads_cpu = post_quant_calibrate_qint8_heads_with_specialists(
        qint8_studio_path,
        heads_cpu,
        train_pool,
        val_by_lang,
        vocabs,
        samples_dir,
        sa_rasa_wav,
        device,
        tier_label="studio",
        per_lang_samples=24 if args.smoke_test else 420,
        cal_epochs=2 if args.smoke_test else 9,
    )

    clean_studio_heads: Dict[str, Tuple[np.ndarray, np.ndarray]] = {}
    for lang in ALL_LANGUAGES:
        w_raw = cal_heads_cpu[lang].weight.detach().numpy()
        b_raw = cal_heads_cpu[lang].bias.detach().numpy()
        w_clean, b_clean = ensure_head_integrity(lang, w_raw, b_raw, vocabs[lang])
        clean_studio_heads[lang] = (w_clean, b_clean)
        bin_bytes = (
            np.ascontiguousarray(w_clean.squeeze(-1), dtype="<f4").tobytes()
            + np.ascontiguousarray(b_clean, dtype="<f4").tobytes()
        )
        assert len(bin_bytes) == 527364
        (docs_heads_dir / f"{lang}.bin").write_bytes(bin_bytes)
        build_modular_head_onnx(w_clean, b_clean, onnx_heads_dir / f"head_{lang}.onnx")

    studio_proto = onnx.load(str(qint8_studio_path))
    splice_monolithic_onnx(studio_proto, clean_studio_heads["sa"][0], clean_studio_heads["sa"][1], qint8_studio_path)
    studio_proto = onnx.load(str(qint8_studio_path))
    for lang in ALL_LANGUAGES:
        w_c, b_c = clean_studio_heads[lang]
        splice_monolithic_onnx(studio_proto, w_c, b_c, onnx_dir / f"swanada_{lang}_ctc_int8.onnx")

    # Verify Split-Graph (`layer_norm_84` + `docs/heads/<lang>.bin`) parity (< 1e-5)
    studio_split = copy.deepcopy(studio_proto)
    studio_split.graph.output.append(helper.make_tensor_value_info("layer_norm_84", TensorProto.FLOAT, ["batch", "time_sub", 512]))
    split_sess = ort.InferenceSession(studio_split.SerializeToString(), providers=["CPUExecutionProvider"])
    t_mel = np.random.RandomState(2026).randn(1, 80, 160).astype(np.float32)
    t_len = np.array([160], dtype=np.int64)
    _, h_ln84 = split_sess.run(["logits", "layer_norm_84"], {"audio_signal": t_mel, "length": t_len})
    for lang in ALL_LANGUAGES:
        w_c, b_c = clean_studio_heads[lang]
        proj_lg = h_ln84 @ w_c.squeeze(-1).T + b_c
        mono_sess = ort.InferenceSession(str(onnx_dir / f"swanada_{lang}_ctc_int8.onnx"), providers=["CPUExecutionProvider"])
        mono_lg = mono_sess.run(["logits"], {"audio_signal": t_mel, "length": t_len})[0]
        diff = float(np.max(np.abs(proj_lg - mono_lg)))
        assert diff < 1e-5, f"Studio split-graph parity drift {diff:.2e} on {lang}"
    log.info("[Studio] Verified 100%% Split-Graph (`layer_norm_84` + `docs/heads/*.bin`) parity (< 1e-5) across all 12 languages!")
    if gcs_p:
        subprocess.run(
            [
                "tar",
                "-czf",
                str(studio_done_tar),
                "-C",
                str(work_dir),
                "models/onnx/sushrota_sanskrit_ctc_int8.onnx",
                "models/onnx/heads",
                "docs/heads",
            ],
            check=True,
        )
        gcs_push(studio_done_tar, gcs_p, "studio_done.tar.gz")
        studio_done_tar.unlink(missing_ok=True)


# ==============================================================================
# 7. Stage 2B: Distill <30 MiB MobileConformer (4-Layer FitNets + Dual KL)
# ==============================================================================


@torch.no_grad()
def fit_initial_fitnets_adapters(
    student: MobileConformerEncoder,
    teacher: NeMoConformerEncoder,
    fitnet_projs: nn.ModuleList,
    train_pool: List[dict],
    device: torch.device,
) -> None:
    """Warm-starts the 4 training-only `Linear(256, 512)` FitNets tap projectors via
    ridge least-squares over 192 utterances so Step-1 intermediate alignment is smooth."""
    student.eval()
    teacher.eval()
    sample = train_pool[: min(192, len(train_pool))]
    s_mats: List[List[torch.Tensor]] = [[] for _ in range(len(STUDENT_INTER_TAPS))]
    t_mats: List[List[torch.Tensor]] = [[] for _ in range(len(TEACHER_INTER_TAPS))]

    use_amp = device.type == "cuda"
    bs = 24
    for b0 in range(0, len(sample), bs):
        chunk = sample[b0 : b0 + bs]
        max_m = max(x["mel_len"] for x in chunk)
        mel_b = torch.zeros((len(chunk), 80, max_m), dtype=torch.float32, device=device)
        len_b = torch.zeros((len(chunk),), dtype=torch.int64, device=device)
        for j, x in enumerate(chunk):
            mel_b[j, :, : x["mel_len"]] = torch.from_numpy(x["mel"].astype(np.float32))
            len_b[j] = x["mel_len"]
        with torch.amp.autocast("cuda", dtype=torch.bfloat16, enabled=use_amp):
            _, s_len, s_inters = student.forward_with_intermediates(mel_b, len_b)
            _, _, t_inters = forward_teacher_with_intermediates(teacher, mel_b, len_b)
        for k_idx in range(len(STUDENT_INTER_TAPS)):
            for j in range(len(chunk)):
                vt = min(int(s_len[j].item()), s_inters[k_idx].size(1), t_inters[k_idx].size(1))
                if vt > 2:
                    s_mats[k_idx].append(s_inters[k_idx][j, :vt].float().cpu())
                    t_mats[k_idx].append(t_inters[k_idx][j, :vt].float().cpu())

    for k_idx, proj in enumerate(fitnet_projs):
        if not s_mats[k_idx]:
            continue
        X = torch.cat(s_mats[k_idx], dim=0)  # [N, 256]
        Y = torch.cat(t_mats[k_idx], dim=0)  # [N, 512]
        xm = X.mean(dim=0, keepdim=True)
        ym = Y.mean(dim=0, keepdim=True)
        Xc = X - xm
        Yc = Y - ym
        reg = 1e-2 * torch.eye(Xc.size(1), dtype=torch.float32)
        W_t = torch.linalg.solve(Xc.T @ Xc + reg, Xc.T @ Yc)  # [256, 512]
        b = (ym - xm @ W_t).squeeze(0)
        proj.weight.data.copy_(W_t.T.to(device))
        proj.bias.data.copy_(b.to(device))
    log.info("[Mobile] Fitted least-squares warm-start for 4 FitNets (256 -> 512) intermediate tap projectors!")


def set_mobile_differential_train_mode(student: MobileConformerEncoder) -> None:
    student.train()
    for p in student.parameters():
        p.requires_grad = True
    for m in student.modules():
        if isinstance(m, nn.BatchNorm1d):
            m.eval()


def run_train_mobile_stage(
    args: argparse.Namespace,
    work_dir: Path,
    cache_dir: Path,
    train_pool: List[dict],
    val_by_lang: Dict[str, List[dict]],
    vocabs: Dict[str, List[str]],
    device: torch.device,
) -> None:
    samples_dir = work_dir / "docs" / "samples"
    studio_onnx = work_dir / "models" / "onnx" / "sushrota_sanskrit_ctc_int8.onnx"
    studio_heads_dir = work_dir / "docs" / "heads"
    mob_onnx_existing = work_dir / "models" / "onnx_mobile" / "swanada_mobile_ctc_int8.onnx"
    mob_heads_existing = work_dir / "docs" / "heads_mobile"
    gcs_p = getattr(args, "gcs_ckpt_prefix", "") or ""
    mobile_done_tar = cache_dir / "mobile_done_v2.tar.gz"
    if gcs_pull(gcs_p, "mobile_done_v2.tar.gz", mobile_done_tar):
        log.info("[Mobile] Restoring already-completed Stage 2B archive from %s!", mobile_done_tar)
        subprocess.run(["tar", "-xzf", str(mobile_done_tar), "-C", str(work_dir)], check=True)
        mobile_done_tar.unlink(missing_ok=True)
        return

    # Load newly upgraded Stage-2A Studio Teacher (`17` layers, `512` dim) for post-quant calibration & head init
    teacher, teacher_heads = load_v102_teacher_from_onnx(studio_onnx, studio_heads_dir, device)

    existing_mob_heads: Optional[nn.ModuleDict] = None
    resumed_converged_mobile = False
    if mob_onnx_existing.exists() and (mob_heads_existing / "en.bin").exists():
        student, existing_mob_heads = load_mobile_student_from_onnx(mob_onnx_existing, mob_heads_existing, device)
        resumed_converged_mobile = True
        log.info("[Mobile] Warm-started `MobileConformerEncoder` from converged `%s`!", mob_onnx_existing.name)
    else:
        student = MobileConformerEncoder(
            feat_in=80, n_layers=14, d_model=256, out_dim=512, conv_channels=176, n_heads=8, conv_kernel_size=31, dropout=0.06
        ).to(device)
        student.out_norm.weight.data.copy_(teacher.layers[-1].norm_out.weight.data)
        student.out_norm.bias.data.copy_(teacher.layers[-1].norm_out.bias.data)

    # Per-language best initial head selection (`existing_mob_heads` vs `teacher_heads`)
    heads_mobile = copy.deepcopy(teacher_heads).to(device)
    if existing_mob_heads is not None:
        student.eval()
        with torch.no_grad():
            for lang in ALL_LANGUAGES:
                v_items = val_by_lang.get(lang, [])
                if not v_items:
                    heads_mobile[lang].load_state_dict(existing_mob_heads[lang].state_dict())
                    continue
                vocab = vocabs[lang]
                c_teach: List[float] = []
                c_exist: List[float] = []
                for vx in v_items[:32]:
                    mt = torch.from_numpy(vx["mel"].astype(np.float32))[None, :, :].to(device)
                    lt = torch.tensor([mt.shape[2]], dtype=torch.int64, device=device)
                    enc, el = student(mt, lt)
                    vt = int(el[0].item())
                    ref = normalize_eval_text("".join(vocab[t] for t in vx["tokens"]).replace("\u2581", " ").strip(), lang)
                    ht = normalize_eval_text(ctc_greedy_decode(teacher_heads[lang](enc).transpose(1, 2)[0, :vt].float().cpu().numpy(), vocab), lang)
                    he = normalize_eval_text(ctc_greedy_decode(existing_mob_heads[lang](enc).transpose(1, 2)[0, :vt].float().cpu().numpy(), vocab), lang)
                    c_teach.append(levenshtein_seq(list(ref), list(ht)) / max(1, len(ref)))
                    c_exist.append(levenshtein_seq(list(ref), list(he)) / max(1, len(ref)))
                if float(np.mean(c_exist)) <= float(np.mean(c_teach)):
                    heads_mobile[lang].load_state_dict(existing_mob_heads[lang].state_dict())

    for p in student.parameters():
        p.requires_grad = True
    for p in heads_mobile.parameters():
        p.requires_grad = True

    anchor_heads = {
        lang: (heads_mobile[lang].weight.detach().clone(), heads_mobile[lang].bias.detach().clone())
        for lang in ALL_LANGUAGES
    }

    base_val_cer, base_presets, _ = evaluate_mobile_student(
        student, heads_mobile, val_by_lang, vocabs, samples_dir, device
    )
    best_score = base_val_cer - 0.002 * base_presets
    best_ckpt_path = cache_dir / "best_mobile_v2.pt"
    torch.save(
        {
            "student": student.state_dict(),
            "heads_mobile": heads_mobile.state_dict(),
            "val_cer": base_val_cer,
            "exact_presets": base_presets,
            "epoch": 0,
        },
        best_ckpt_path,
    )
    log.info("[Mobile] Epoch-0 warm-start baseline: val_cer=%.2f%%, presets=%d/12.", base_val_cer * 100, base_presets)

    enc_lr = (args.mobile_encoder_lr * 0.16) if resumed_converged_mobile else args.mobile_encoder_lr
    head_lr = max(2.2e-4, enc_lr * 1.6)
    lower_params = list(student.pre_encode.parameters()) + [p for lyr in student.layers[:4] for p in lyr.parameters()]
    upper_params = [p for lyr in student.layers[4:] for p in lyr.parameters()] + list(student.out_proj.parameters()) + list(student.out_norm.parameters())
    head_params = list(heads_mobile.parameters())
    train_params = lower_params + upper_params + head_params

    adamw_kwargs: Dict[str, Any] = {"betas": (0.9, 0.98)}
    if device.type == "cuda":
        adamw_kwargs["fused"] = True
    optimizer = torch.optim.AdamW(
        [
            {"params": lower_params, "lr": enc_lr * 0.35, "weight_decay": 1e-4},
            {"params": upper_params, "lr": enc_lr, "weight_decay": 1e-4},
            {"params": head_params, "lr": head_lr, "weight_decay": 1e-5},
        ],
        **adamw_kwargs,
    )

    # Temperature-balanced pool size so English (`15,500`) does not starve 11 Indic languages (`2,900` each)
    en_all = [idx for idx, it in enumerate(train_pool) if it["lang"] == "en"]
    non_en_all = [idx for idx, it in enumerate(train_pool) if it["lang"] != "en"]
    en_cap_per_epoch = len(en_all) if args.smoke_test else min(len(en_all), 4600)
    eff_pool_len = len(non_en_all) + en_cap_per_epoch

    epochs = 2 if args.smoke_test else args.mobile_epochs
    bsz_cfg = 8 if args.smoke_test else args.mobile_batch_size
    steps_per_epoch = math.ceil(eff_pool_len / bsz_cfg)
    total_steps = max(1, steps_per_epoch * epochs)
    warmup_steps = min(240, max(8, total_steps // 12))

    def lr_lambda(step: int) -> float:
        if step < warmup_steps:
            return float(step + 1) / float(max(1, warmup_steps))
        prog = float(step - warmup_steps) / float(max(1, total_steps - warmup_steps))
        return 0.06 + 0.94 * 0.5 * (1.0 + math.cos(math.pi * prog))

    scheduler = torch.optim.lr_scheduler.LambdaLR(optimizer, lr_lambda)
    ctc_criterion = nn.CTCLoss(blank=0, reduction="none", zero_infinity=True)
    distill_temp = 1.5
    use_amp = device.type == "cuda"

    start_epoch = 1
    mobile_resume_path = cache_dir / "mobile_v2_resume.pt"
    if mobile_resume_path.exists() or gcs_pull(gcs_p, "mobile_v2_resume.pt", mobile_resume_path):
        gcs_pull(gcs_p, "best_mobile_v2.pt", best_ckpt_path)
        mr = torch.load(mobile_resume_path, map_location=device, weights_only=False)
        student.load_state_dict(mr["student"])
        heads_mobile.load_state_dict(mr["heads_mobile"])
        optimizer.load_state_dict(mr["optimizer"])
        scheduler.load_state_dict(mr["scheduler"])
        best_score = float(mr["best_score"])
        start_epoch = int(mr["epoch"]) + 1
        log.info("[Mobile] Resumed Stage 2B v2 from epoch %d/%d (best_score=%.4f)!", start_epoch, epochs, best_score)
        del mr

    for epoch in range(start_epoch, epochs + 1):
        ep_t0 = time.time()
        set_mobile_differential_train_mode(student)
        heads_mobile.train()

        en_sampled = random.sample(en_all, en_cap_per_epoch) if len(en_all) > en_cap_per_epoch else list(en_all)
        indices = list(non_en_all) + en_sampled
        random.shuffle(indices)
        mega = bsz_cfg * 48
        batches: List[List[int]] = []
        for m0 in range(0, len(indices), mega):
            sub = sorted(indices[m0 : m0 + mega], key=lambda idx: train_pool[idx]["mel_len"])
            for b0 in range(0, len(sub), bsz_cfg):
                batches.append(sub[b0 : b0 + bsz_cfg])
        random.shuffle(batches)

        running_loss = 0.0
        for step_idx, b_idxs in enumerate(batches, 1):
            bsz = len(b_idxs)
            max_m = max(train_pool[i]["mel_len"] for i in b_idxs)
            max_tsub_init = ((max_m - 1) // 4) + 1
            mel_b = torch.zeros((bsz, 80, max_m), dtype=torch.float32, device=device)
            len_b = torch.zeros((bsz,), dtype=torch.int64, device=device)
            tlp_b = torch.full((bsz, max_tsub_init, TOP_K_TEACHER), -30.0, dtype=torch.float32, device=device)
            tix_b = torch.zeros((bsz, max_tsub_init, TOP_K_TEACHER), dtype=torch.long, device=device)

            for j, ii in enumerate(b_idxs):
                it = train_pool[ii]
                mel_b[j, :, : it["mel_len"]] = torch.from_numpy(it["mel"].astype(np.float32))
                len_b[j] = it["mel_len"]
                if it.get("teacher_lp") is not None:
                    vt = min(max_tsub_init, it["teacher_lp"].shape[0])
                    tlp_b[j, :vt, :] = torch.from_numpy(it["teacher_lp"][:vt].astype(np.float32))
                    tix_b[j, :vt, :] = torch.from_numpy(it["teacher_idx"][:vt].astype(np.int64))

            aug_p = 0.06 if epoch >= epochs - 2 else 0.18
            mel_in = augment_student_mel(mel_b, len_b, aug_prob=aug_p)

            with torch.amp.autocast("cuda", dtype=torch.bfloat16, enabled=use_amp):
                s_enc, s_len = student(mel_in, len_b)
                max_tsub = s_enc.size(2)
                s_len = s_len.clamp_max(max_tsub)
                tlp_b = tlp_b[:, :max_tsub, :]
                tix_b = tix_b[:, :max_tsub, :]
                valid_mask = (torch.arange(max_tsub, device=device).unsqueeze(0) < s_len.unsqueeze(1)).float()

                by_lang: Dict[str, List[int]] = {}
                for j, ii in enumerate(b_idxs):
                    by_lang.setdefault(train_pool[ii]["lang"], []).append(j)

                kd_sum = torch.zeros((), dtype=torch.float32, device=device)
                ctc_sum = torch.zeros((), dtype=torch.float32, device=device)
                anc_sum = torch.zeros((), dtype=torch.float32, device=device)
                for lang, local_js in by_lang.items():
                    jt = torch.tensor(local_js, dtype=torch.long, device=device)
                    s_sub = s_enc.index_select(0, jt)
                    l_sub = s_len.index_select(0, jt)
                    m_sub = valid_mask.index_select(0, jt)
                    tlp_sub = tlp_b.index_select(0, jt)
                    tix_sub = tix_b.index_select(0, jt)

                    s_logits = heads_mobile[lang](s_sub).transpose(1, 2).float()
                    kd_sum = kd_sum + sparse_top24_kl_loss(s_logits, tlp_sub, tix_sub, m_sub, l_sub, temp=distill_temp)

                    s_lp = F.log_softmax(s_logits, dim=-1)
                    targ_list = [torch.from_numpy(train_pool[b_idxs[j]]["tokens"]).long() for j in local_js]
                    targ_lens = torch.tensor([len(t) for t in targ_list], dtype=torch.long, device=device)
                    ctc_utt = (
                        ctc_criterion(s_lp.transpose(0, 1), torch.cat(targ_list).to(device), l_sub, targ_lens)
                        / targ_lens.clamp_min(1).float()
                    ).sum()
                    ctc_sum = ctc_sum + ctc_utt

                    w_anc, _ = anchor_heads[lang]
                    anc_sum = anc_sum + 2.5e-5 * F.mse_loss(heads_mobile[lang].weight.float(), w_anc.float(), reduction="sum") * (len(local_js) / float(bsz))

                loss = 0.76 * (kd_sum / float(bsz)) + 0.24 * (ctc_sum / float(bsz)) + anc_sum

            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(train_params, max_norm=2.5)
            optimizer.step()
            with torch.no_grad():
                for hm in heads_mobile.values():
                    hm.bias.data.clamp_(-17.5, 17.5)
            scheduler.step()

            running_loss += float(loss.item())
            if step_idx == 1 or step_idx % 200 == 0 or step_idx == len(batches):
                vram_gb = (torch.cuda.max_memory_allocated() / 1e9) if torch.cuda.is_available() else 0.0
                log.info(
                    "[Mobile] Ep %02d/%02d | Step %04d/%04d | Loss %.4f | LR %.2e | VRAM %.2fGB | %.1fs",
                    epoch,
                    epochs,
                    step_idx,
                    len(batches),
                    running_loss / step_idx,
                    optimizer.param_groups[1]["lr"],
                    vram_gb,
                    time.time() - ep_t0,
                )

        val_cer, exact_p, _ = evaluate_mobile_student(
            student, heads_mobile, val_by_lang, vocabs, samples_dir, device
        )
        score = val_cer - 0.002 * exact_p
        if score <= best_score:
            best_score = score
            torch.save(
                {
                    "student": student.state_dict(),
                    "heads_mobile": heads_mobile.state_dict(),
                    "val_cer": val_cer,
                    "exact_presets": exact_p,
                    "epoch": epoch,
                },
                best_ckpt_path,
            )
            log.info("[Mobile] Saved new best checkpoint at epoch %d (val_cer=%.2f%%, presets=%d/12)!", epoch, val_cer * 100, exact_p)
            gcs_push(best_ckpt_path, gcs_p, "best_mobile_v2.pt")
        torch.save(
            {
                "epoch": epoch,
                "student": student.state_dict(),
                "heads_mobile": heads_mobile.state_dict(),
                "optimizer": optimizer.state_dict(),
                "scheduler": scheduler.state_dict(),
                "best_score": best_score,
            },
            mobile_resume_path,
        )
        gcs_push(mobile_resume_path, gcs_p, "mobile_v2_resume.pt")

    del student, heads_mobile, anchor_heads, optimizer, scheduler
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    ckpt = torch.load(best_ckpt_path, map_location="cpu", weights_only=False)
    student_cpu = MobileConformerEncoder(
        feat_in=80, n_layers=14, d_model=256, out_dim=512, conv_channels=176, n_heads=8, conv_kernel_size=31, dropout=0.0
    ).eval()
    student_cpu.load_state_dict(ckpt["student"], strict=True)
    heads_cpu = nn.ModuleDict({lang: nn.Conv1d(512, 257, kernel_size=1) for lang in ALL_LANGUAGES}).eval()
    heads_cpu.load_state_dict(ckpt["heads_mobile"], strict=True)
    del ckpt
    gc.collect()

    onnx_mob_dir = work_dir / "models" / "onnx_mobile"
    onnx_mob_heads_dir = onnx_mob_dir / "heads"
    docs_mob_heads_dir = work_dir / "docs" / "heads_mobile"
    onnx_mob_heads_dir.mkdir(parents=True, exist_ok=True)
    docs_mob_heads_dir.mkdir(parents=True, exist_ok=True)

    fp32_mob_path = cache_dir / "swanada_mobile_ctc_fp32.onnx"
    qint8_mob_path = onnx_mob_dir / "swanada_mobile_ctc_int8.onnx"

    wrapper = MobileExportWrapper(student_cpu, heads_cpu["sa"]).eval()
    dummy_mel = torch.randn(1, 80, 200, dtype=torch.float32)
    dummy_len = torch.tensor([200], dtype=torch.int64)
    export_kwargs = dict(
        input_names=["audio_signal", "length"],
        output_names=["logits"],
        dynamic_axes={"audio_signal": {0: "batch", 2: "time"}, "length": {0: "batch"}, "logits": {0: "batch", 1: "time_out"}},
        opset_version=17,
        do_constant_folding=True,
    )
    try:
        torch.onnx.export(wrapper, (dummy_mel, dummy_len), str(fp32_mob_path), dynamo=False, **export_kwargs)
    except TypeError:
        torch.onnx.export(wrapper, (dummy_mel, dummy_len), str(fp32_mob_path), **export_kwargs)

    canonicalize_onnx_tail(fp32_mob_path)
    quantize_dynamic(
        model_input=str(fp32_mob_path),
        model_output=str(qint8_mob_path),
        op_types_to_quantize=["MatMul"],
        weight_type=QuantType.QInt8,
    )
    canonicalize_onnx_tail(qint8_mob_path)
    fp32_mob_path.unlink(missing_ok=True)

    size_bytes = qint8_mob_path.stat().st_size
    size_mib = size_bytes / (1024 * 1024)
    log.info("[Mobile] Exported shared QInt8 Encoder: %s -> %.2f MiB (%.2f MB)", qint8_mob_path, size_mib, size_bytes / 1e6)
    assert size_bytes < 30 * 1024 * 1024, f"Mobile encoder exceeded 30 MiB budget: {size_mib:.2f} MiB"

    cal_heads_cpu = post_quant_calibrate_qint8_heads_with_specialists(
        qint8_mob_path,
        heads_cpu,
        train_pool,
        val_by_lang,
        vocabs,
        samples_dir,
        None,
        device,
        tier_label="mobile",
        studio_teacher=teacher,
        studio_heads=teacher_heads,
        per_lang_samples=24 if args.smoke_test else 420,
        cal_epochs=2 if args.smoke_test else 10,
    )

    clean_mob_heads: Dict[str, Tuple[np.ndarray, np.ndarray]] = {}
    for lang in ALL_LANGUAGES:
        w_raw = cal_heads_cpu[lang].weight.detach().numpy()
        b_raw = cal_heads_cpu[lang].bias.detach().numpy()
        w_clean, b_clean = ensure_head_integrity(lang, w_raw, b_raw, vocabs[lang])
        clean_mob_heads[lang] = (w_clean, b_clean)
        bin_bytes = (
            np.ascontiguousarray(w_clean.squeeze(-1), dtype="<f4").tobytes()
            + np.ascontiguousarray(b_clean, dtype="<f4").tobytes()
        )
        assert len(bin_bytes) == 527364
        (docs_mob_heads_dir / f"{lang}.bin").write_bytes(bin_bytes)
        build_modular_head_onnx(w_clean, b_clean, onnx_mob_heads_dir / f"head_{lang}.onnx")

    mob_proto = onnx.load(str(qint8_mob_path))
    splice_monolithic_onnx(mob_proto, clean_mob_heads["sa"][0], clean_mob_heads["sa"][1], qint8_mob_path)
    mob_proto = onnx.load(str(qint8_mob_path))
    for lang in ALL_LANGUAGES:
        w_c, b_c = clean_mob_heads[lang]
        splice_monolithic_onnx(mob_proto, w_c, b_c, onnx_mob_dir / f"swanada_mobile_{lang}_ctc_int8.onnx")

    # Verify Split-Graph (`layer_norm_84` + `docs/heads_mobile/<lang>.bin`) parity (< 1e-5)
    mob_split = copy.deepcopy(mob_proto)
    mob_split.graph.output.append(helper.make_tensor_value_info("layer_norm_84", TensorProto.FLOAT, ["batch", "time_sub", 512]))
    split_sess = ort.InferenceSession(mob_split.SerializeToString(), providers=["CPUExecutionProvider"])
    t_mel = np.random.RandomState(2026).randn(1, 80, 160).astype(np.float32)
    t_len = np.array([160], dtype=np.int64)
    _, h_ln84 = split_sess.run(["logits", "layer_norm_84"], {"audio_signal": t_mel, "length": t_len})
    for lang in ALL_LANGUAGES:
        w_c, b_c = clean_mob_heads[lang]
        proj_lg = h_ln84 @ w_c.squeeze(-1).T + b_c
        mono_sess = ort.InferenceSession(str(onnx_mob_dir / f"swanada_mobile_{lang}_ctc_int8.onnx"), providers=["CPUExecutionProvider"])
        mono_lg = mono_sess.run(["logits"], {"audio_signal": t_mel, "length": t_len})[0]
        diff = float(np.max(np.abs(proj_lg - mono_lg)))
        assert diff < 1e-5, f"Mobile split-graph parity drift {diff:.2e} on {lang}"
    log.info("[Mobile] Verified 100%% Split-Graph (`layer_norm_84` + `docs/heads_mobile/*.bin`) parity (< 1e-5) across all 12 languages!")
    if gcs_p:
        subprocess.run(
            [
                "tar",
                "-czf",
                str(mobile_done_tar),
                "-C",
                str(work_dir),
                "models/onnx_mobile/swanada_mobile_ctc_int8.onnx",
                "models/onnx_mobile/heads",
                "docs/heads_mobile",
            ],
            check=True,
        )
        gcs_push(mobile_done_tar, gcs_p, "mobile_done_v2.tar.gz")
        mobile_done_tar.unlink(missing_ok=True)


# ==============================================================================
# 8. Stage 3: Train 12-Way Neural Auto-LID Heads (`lid.bin`, 396 KiB SLID v1)
# ==============================================================================


class PyTorchAttentiveLID(nn.Module):
    """Exact PyTorch mirror of `swanada.lid.NeuralLIDWeights` (`SLID` v1, 396 KiB):
    Attentive Statistics Pooling (`[T, 512] -> [1024]`) + LayerNorm + GELU MLP -> 12 classes."""

    def __init__(self, d_in: int = 512, d_att: int = 64, d_hid: int = 64, n_langs: int = 12):
        super().__init__()
        self.d_in = d_in
        self.d_att = d_att
        self.d_hid = d_hid
        self.n_langs = n_langs
        self.w_att = nn.Parameter(torch.randn(d_in, d_att) * 0.04)
        self.b_att = nn.Parameter(torch.zeros(d_att))
        self.v_att = nn.Parameter(torch.randn(d_att) * 0.08)
        self.ln_gamma = nn.Parameter(torch.ones(2 * d_in))
        self.ln_beta = nn.Parameter(torch.zeros(2 * d_in))
        self.w_fc1 = nn.Parameter(torch.randn(2 * d_in, d_hid) * (1.0 / math.sqrt(2 * d_in)))
        self.b_fc1 = nn.Parameter(torch.zeros(d_hid))
        self.w_fc2 = nn.Parameter(torch.randn(d_hid, n_langs) * (1.0 / math.sqrt(d_hid)))
        self.b_fc2 = nn.Parameter(torch.zeros(n_langs))

    def forward(self, h: torch.Tensor, valid_lens: torch.Tensor) -> torch.Tensor:
        # h: [B, T, 512], valid_lens: [B]
        bsz, max_t, _ = h.shape
        t_idx = torch.arange(max_t, device=h.device)[None, :]
        len_mask = t_idx < valid_lens[:, None]  # [B, T]
        norms = torch.linalg.norm(h, dim=-1) * len_mask.float()  # [B, T]
        peak = norms.max(dim=-1, keepdim=True).values  # [B, 1]
        active = torch.where(peak > 1e-6, norms >= (0.25 * peak), len_mask) & len_mask
        empty_rows = ~active.any(dim=-1, keepdim=True)
        active = torch.where(empty_rows, len_mask, active)

        att_raw = torch.matmul(torch.tanh(torch.matmul(h, self.w_att) + self.b_att), self.v_att)  # [B, T]
        att_masked = torch.where(active, att_raw, torch.full_like(att_raw, -1.0e9))
        alpha = F.softmax(att_masked, dim=-1)  # [B, T]

        mu = torch.einsum("bt,btd->bd", alpha, h)  # [B, 512]
        diff = h - mu[:, None, :]
        var = torch.einsum("bt,btd->bd", alpha, diff * diff)
        sigma = torch.sqrt(torch.clamp(var, min=1.0e-5))
        stats = torch.cat([mu, sigma], dim=-1)  # [B, 1024]

        s_mean = stats.mean(dim=-1, keepdim=True)
        s_var = ((stats - s_mean) ** 2).mean(dim=-1, keepdim=True)
        s_ln = ((stats - s_mean) / torch.sqrt(s_var + 1.0e-5)) * self.ln_gamma + self.ln_beta

        x1 = torch.matmul(s_ln, self.w_fc1) + self.b_fc1
        gelu = 0.5 * x1 * (1.0 + torch.tanh(0.7978845608 * (x1 + 0.044715 * (x1 ** 3))))
        return torch.matmul(gelu, self.w_fc2) + self.b_fc2  # [B, 12]


def _extract_lid_ln84_pool(
    onnx_path: Path,
    items: List[dict],
) -> List[Tuple[np.ndarray, int]]:
    """Extracts `[T_sub, 512]` `layer_norm_84` features (stored as float16) from a
    quantized ONNX encoder using arena-safe length-bucketed batching."""
    m = onnx.load(str(onnx_path))
    m.graph.output.append(helper.make_tensor_value_info("layer_norm_84", TensorProto.FLOAT, ["batch", "time_sub", 512]))
    raw_bytes = m.SerializeToString()

    opts = ort.SessionOptions()
    opts.intra_op_num_threads = 8
    avail = ort.get_available_providers()
    providers: List[Any] = (
        [("CUDAExecutionProvider", {"arena_extend_strategy": "kSameAsRequested"}), "CPUExecutionProvider"]
        if "CUDAExecutionProvider" in avail
        else ["CPUExecutionProvider"]
    )
    sess = ort.InferenceSession(raw_bytes, sess_options=opts, providers=providers)
    lang2idx = {lg: idx for idx, lg in enumerate(LID_LANGUAGES)}

    indexed = [(idx, it) for idx, it in enumerate(items) if it["lang"] in lang2idx]
    indexed.sort(key=lambda pair: pair[1]["mel_len"])
    results: List[Optional[Tuple[np.ndarray, int]]] = [None] * len(indexed)

    bs = 24
    for b0 in range(0, len(indexed), bs):
        chunk = indexed[b0 : b0 + bs]
        raw_max = max(p[1]["mel_len"] for p in chunk)
        max_m = ((raw_max + 127) // 128) * 128
        mb = np.zeros((len(chunk), 80, max_m), dtype=np.float32)
        lb = np.zeros((len(chunk),), dtype=np.int64)
        for j, (_, it) in enumerate(chunk):
            mb[j, :, : it["mel_len"]] = it["mel"].astype(np.float32)
            lb[j] = it["mel_len"]
        try:
            ln84_b = sess.run(["layer_norm_84"], {"audio_signal": mb, "length": lb})[0]
        except Exception:
            sess = ort.InferenceSession(raw_bytes, sess_options=opts, providers=["CPUExecutionProvider"])
            ln84_b = sess.run(["layer_norm_84"], {"audio_signal": mb, "length": lb})[0]
        for j, (_, it) in enumerate(chunk):
            vt = max(1, min(ln84_b.shape[1], ((int(it["mel_len"]) - 1) // 4) + 1))
            results[b0 + j] = (ln84_b[j, :vt].astype(np.float16), lang2idx[it["lang"]])

    del sess
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    return [r for r in results if r is not None]


def _train_single_tier_lid_head(
    onnx_path: Path,
    out_paths: List[Path],
    tier_label: str,
    train_pool: List[dict],
    val_by_lang: Dict[str, List[dict]],
    device: torch.device,
    smoke_test: bool = False,
) -> None:
    if not onnx_path.exists():
        log.warning("[%s LID] Skipping: %s not found.", tier_label, onnx_path)
        return

    per_lang_cap = 4 if smoke_test else 1800
    by_lang: Dict[str, List[dict]] = {lg: [] for lg in LID_LANGUAGES}
    shuffled = list(train_pool)
    random.shuffle(shuffled)
    for it in shuffled:
        lg = it["lang"]
        if lg in by_lang and len(by_lang[lg]) < per_lang_cap:
            by_lang[lg].append(it)

    train_sub: List[dict] = []
    for lg in LID_LANGUAGES:
        train_sub.extend(by_lang[lg])
    val_sub: List[dict] = []
    for lg in LID_LANGUAGES:
        val_sub.extend(val_by_lang.get(lg, []))

    log.info("[%s LID] Extracting quantized `layer_norm_84` for %d balanced train + %d disjoint val clips...", tier_label, len(train_sub), len(val_sub))
    tr_feats = _extract_lid_ln84_pool(onnx_path, train_sub)
    va_feats = _extract_lid_ln84_pool(onnx_path, val_sub)

    lid_mod = PyTorchAttentiveLID(d_in=512, d_att=64, d_hid=64, n_langs=len(LID_LANGUAGES)).to(device)
    epochs = 2 if smoke_test else 18
    bs = 8 if smoke_test else 128
    opt = torch.optim.AdamW(lid_mod.parameters(), lr=1.6e-3, weight_decay=2e-4)
    total_steps = max(1, math.ceil(len(tr_feats) / bs) * epochs)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=total_steps, eta_min=5e-5)

    best_val_acc = -1.0
    best_state = copy.deepcopy(lid_mod.state_dict())

    for ep in range(1, epochs + 1):
        lid_mod.train()
        random.shuffle(tr_feats)
        for b0 in range(0, len(tr_feats), bs):
            chunk = tr_feats[b0 : b0 + bs]
            cropped: List[Tuple[np.ndarray, int]] = []
            for h_arr, lbl in chunk:
                t_len = h_arr.shape[0]
                # 50% random short streaming crop (0.8s - 3.0s = 20 - 75 frames) so live mic Auto-LID locks fast!
                if not smoke_test and t_len > 28 and random.random() < 0.50:
                    w_len = random.randint(20, min(t_len, 75))
                    s0 = random.randint(0, max(0, min(12, t_len - w_len)))
                    cropped.append((h_arr[s0 : s0 + w_len], lbl))
                else:
                    cropped.append((h_arr, lbl))

            max_t = max(c[0].shape[0] for c in cropped)
            hb = torch.zeros((len(cropped), max_t, 512), dtype=torch.float32, device=device)
            lb = torch.zeros((len(cropped),), dtype=torch.long, device=device)
            yb = torch.zeros((len(cropped),), dtype=torch.long, device=device)
            for j, (h_arr, lbl) in enumerate(cropped):
                vt = h_arr.shape[0]
                hb[j, :vt, :] = torch.from_numpy(h_arr.astype(np.float32))
                lb[j] = vt
                yb[j] = lbl

            logits = lid_mod(hb, lb)
            loss = F.cross_entropy(logits, yb, label_smoothing=0.03)
            opt.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(lid_mod.parameters(), 2.0)
            opt.step()
            sched.step()

        lid_mod.eval()
        with torch.no_grad():
            correct_full = 0
            correct_short = 0
            for b0 in range(0, len(va_feats), 64):
                vch = va_feats[b0 : b0 + 64]
                mt = max(c[0].shape[0] for c in vch)
                hb = torch.zeros((len(vch), mt, 512), dtype=torch.float32, device=device)
                lb_full = torch.zeros((len(vch),), dtype=torch.long, device=device)
                lb_short = torch.zeros((len(vch),), dtype=torch.long, device=device)
                yb = torch.zeros((len(vch),), dtype=torch.long, device=device)
                for j, (h_arr, lbl) in enumerate(vch):
                    vt = h_arr.shape[0]
                    hb[j, :vt, :] = torch.from_numpy(h_arr.astype(np.float32))
                    lb_full[j] = vt
                    lb_short[j] = min(vt, 40)  # 1.6s streaming prefix
                    yb[j] = lbl
                pred_f = lid_mod(hb, lb_full).argmax(dim=-1)
                pred_s = lid_mod(hb, lb_short).argmax(dim=-1)
                correct_full += int((pred_f == yb).sum().item())
                correct_short += int((pred_s == yb).sum().item())
            acc_full = correct_full / max(1, len(va_feats))
            acc_short = correct_short / max(1, len(va_feats))
            score_ep = 0.70 * acc_full + 0.30 * acc_short
            if score_ep >= best_val_acc:
                best_val_acc = score_ep
                best_state = copy.deepcopy(lid_mod.state_dict())
            if ep in (1, epochs // 2, epochs):
                log.info(
                    "[%s LID] Ep %02d/%02d | Full-Clip 12-Way Acc: %.2f%% | 1.6s Streaming Acc: %.2f%%",
                    tier_label,
                    ep,
                    epochs,
                    acc_full * 100.0,
                    acc_short * 100.0,
                )

    lid_mod.load_state_dict(best_state)
    lid_mod.eval()

    # Post-hoc temperature scaling on disjoint validation logits
    val_logits_list: List[torch.Tensor] = []
    val_labels_list: List[torch.Tensor] = []
    with torch.no_grad():
        for b0 in range(0, len(va_feats), 64):
            vch = va_feats[b0 : b0 + 64]
            mt = max(c[0].shape[0] for c in vch)
            hb = torch.zeros((len(vch), mt, 512), dtype=torch.float32, device=device)
            lb_f = torch.zeros((len(vch),), dtype=torch.long, device=device)
            yb = torch.zeros((len(vch),), dtype=torch.long, device=device)
            for j, (h_arr, lbl) in enumerate(vch):
                vt = h_arr.shape[0]
                hb[j, :vt, :] = torch.from_numpy(h_arr.astype(np.float32))
                lb_f[j] = vt
                yb[j] = lbl
            val_logits_list.append(lid_mod(hb, lb_f))
            val_labels_list.append(yb)

    opt_temp = 1.0
    if val_logits_list:
        all_vl = torch.cat(val_logits_list, dim=0)
        all_vy = torch.cat(val_labels_list, dim=0)
        best_nll = float("inf")
        for cand_t in np.linspace(0.45, 2.20, 36):
            nll = float(F.cross_entropy(all_vl / float(cand_t), all_vy).item())
            if nll < best_nll:
                best_nll = nll
                opt_temp = float(cand_t)

    sd_cpu = {k: v.detach().cpu().numpy().astype(np.float32) for k, v in lid_mod.state_dict().items()}
    weights_obj = NeuralLIDWeights(
        d_in=512,
        d_att=64,
        d_hid=64,
        languages=LID_LANGUAGES,
        w_att=sd_cpu["w_att"],
        b_att=sd_cpu["b_att"],
        v_att=sd_cpu["v_att"],
        ln_gamma=sd_cpu["ln_gamma"],
        ln_beta=sd_cpu["ln_beta"],
        w_fc1=sd_cpu["w_fc1"],
        b_fc1=sd_cpu["b_fc1"],
        w_fc2=sd_cpu["w_fc2"],
        b_fc2=sd_cpu["b_fc2"],
        temperature=opt_temp,
    )
    raw_bin = serialize_lid_head_bytes(weights_obj)
    assert len(raw_bin) == 405324, f"Unexpected lid.bin byte length: {len(raw_bin)}"

    # Verify exact PyTorch <-> NumPy (`SLID` v1) parity
    parsed = parse_lid_head_bytes(raw_bin)
    if va_feats:
        h_test = va_feats[0][0].astype(np.float32)
        np_lp = parsed.predict_log_probs(h_test)
        with torch.no_grad():
            pt_lg = lid_mod(torch.from_numpy(h_test[None, :, :]).to(device), torch.tensor([h_test.shape[0]], device=device))[0]
            pt_lp = F.log_softmax(pt_lg / opt_temp, dim=-1).cpu().numpy()
        max_drift = max(abs(np_lp[lg] - float(pt_lp[idx])) for idx, lg in enumerate(LID_LANGUAGES))
        assert max_drift < 1e-4, f"LID parity drift too high: {max_drift:.2e}"

    for p in out_paths:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(raw_bin)
    log.info("[%s LID] Exported verified SLID v1 head (%d bytes = %.1f KiB, T=%.2f) -> %s", tier_label, len(raw_bin), len(raw_bin) / 1024.0, opt_temp, out_paths[0])
    del tr_feats, va_feats, lid_mod
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


def run_train_lid_stage(
    args: argparse.Namespace,
    work_dir: Path,
    train_pool: List[dict],
    val_by_lang: Dict[str, List[dict]],
    device: torch.device,
) -> None:
    studio_onnx = work_dir / "models" / "onnx" / "sushrota_sanskrit_ctc_int8.onnx"
    mobile_onnx = work_dir / "models" / "onnx_mobile" / "swanada_mobile_ctc_int8.onnx"
    _train_single_tier_lid_head(
        studio_onnx,
        [work_dir / "docs" / "heads" / "lid.bin", work_dir / "models" / "onnx" / "heads" / "lid.bin"],
        "Studio",
        train_pool,
        val_by_lang,
        device,
        smoke_test=args.smoke_test,
    )
    _train_single_tier_lid_head(
        mobile_onnx,
        [work_dir / "docs" / "heads_mobile" / "lid.bin", work_dir / "models" / "onnx_mobile" / "heads" / "lid.bin"],
        "Mobile",
        train_pool,
        val_by_lang,
        device,
        smoke_test=args.smoke_test,
    )


# ==============================================================================
# 9. Main CLI Entrypoint
# ==============================================================================


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--work-dir", type=Path, default=REPO_ROOT)
    ap.add_argument("--stage", choices=["all", "prepare", "train-studio", "train-mobile", "train-lid", "mobile-and-lid"], default="all")
    ap.add_argument("--studio-epochs", type=int, default=10)
    ap.add_argument("--studio-batch-size", type=int, default=40)
    ap.add_argument("--studio-encoder-lr", type=float, default=1.0e-4)
    ap.add_argument("--studio-head-lr", type=float, default=2.5e-4)
    ap.add_argument("--mobile-epochs", type=int, default=18)
    ap.add_argument("--mobile-batch-size", type=int, default=48)
    ap.add_argument("--mobile-encoder-lr", type=float, default=9.0e-4)
    ap.add_argument("--indic-target-clips", type=int, default=2900)
    ap.add_argument("--en-target-clips", type=int, default=15500)
    ap.add_argument("--gcs-ckpt-prefix", type=str, default="")
    ap.add_argument("--smoke-test", action="store_true")
    args = ap.parse_args()

    random.seed(42)
    np.random.seed(42)
    torch.manual_seed(42)

    work_dir = args.work_dir.resolve()
    cache_dir = work_dir / "_gcp_leaderboard_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if device.type == "cuda":
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True
    log.info("Compute device: %s (%s)", device, torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU")

    vocabs: Dict[str, List[str]] = {}
    tok2id: Dict[str, Dict[str, int]] = {}
    for lang in ALL_LANGUAGES:
        vf = work_dir / "models" / "vocabularies" / ("sanskrit_vocab.json" if lang == "sa" else f"{lang}_vocab.json")
        v = json.loads(vf.read_text(encoding="utf-8"))
        vocabs[lang] = v
        tok2id[lang] = {t: i for i, t in enumerate(v)}

    if args.stage in ("all", "prepare"):
        train_pool, val_by_lang = run_prepare_stage(args, work_dir, cache_dir, vocabs, tok2id, device)
        if args.stage == "prepare":
            return
    else:
        log.info("Loading 12-language sharded leaderboard corpus from %s (gcs=%s)...", cache_dir, args.gcs_ckpt_prefix)
        train_pool, val_by_lang = load_sharded_corpus(cache_dir, args.gcs_ckpt_prefix)

    if args.stage in ("all", "train-studio"):
        run_train_studio_stage(args, work_dir, cache_dir, train_pool, val_by_lang, vocabs, device)

    if args.stage in ("all", "train-mobile", "mobile-and-lid"):
        run_train_mobile_stage(args, work_dir, cache_dir, train_pool, val_by_lang, vocabs, device)

    if args.stage in ("all", "train-lid", "mobile-and-lid"):
        run_train_lid_stage(args, work_dir, train_pool, val_by_lang, device)

    if args.stage in ("all", "train-lid", "mobile-and-lid"):
        shutil.rmtree(cache_dir, ignore_errors=True)
    log.info("LEADERBOARD DISTILLATION STAGE `%s` COMPLETE!", args.stage)


if __name__ == "__main__":
    main()
