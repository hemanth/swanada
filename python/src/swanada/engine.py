"""ONNX Runtime Inference Engine in Python for Swanada."""

import json
from dataclasses import dataclass
from pathlib import Path
import time
from typing import List, Optional, Tuple, Union
import numpy as np
import onnxruntime as ort

from .audio import load_audio
from .decoder import CTCDecodeResult, decode_ctc
from .denoise import enhance_speech_with_telemetry
from .frontend import extract_log_mel_features, extract_log_mel_onnx

_LAYER_NORM_84_VALUE_INFO = bytes(
    [
        0x0A, 0x0D, 0x6C, 0x61, 0x79, 0x65, 0x72, 0x5F, 0x6E, 0x6F, 0x72, 0x6D, 0x5F, 0x38, 0x34,
        0x12, 0x20, 0x0A, 0x1E, 0x08, 0x01, 0x12, 0x1A, 0x0A, 0x07, 0x12, 0x05, 0x62, 0x61, 0x74,
        0x63, 0x68, 0x0A, 0x0A, 0x12, 0x08, 0x74, 0x69, 0x6D, 0x65, 0x5F, 0x73, 0x75, 0x62, 0x0A,
        0x03, 0x08, 0x80, 0x04,
    ]
)


def _read_pb_varint(buf: bytes, pos: int) -> Tuple[int, int]:
    val = 0
    shift = 0
    n = len(buf)
    while pos < n:
        b = buf[pos]
        pos += 1
        val |= (b & 0x7F) << shift
        if (b & 0x80) == 0:
            return val, pos
        shift += 7
    raise ValueError("Truncated ONNX protobuf varint")


def _encode_pb_varint(n: int) -> bytes:
    out = bytearray()
    rem = n
    while rem >= 128:
        out.append((rem & 0x7F) | 0x80)
        rem >>= 7
    out.append(rem)
    return bytes(out)


def _expose_encoder_hidden_output(src: bytes) -> bytes:
    """Zero-dependency ONNX ModelProto splitter exposing `layer_norm_84` ([batch, time_sub, 512])."""
    graph_append = bytes([0x62, len(_LAYER_NORM_84_VALUE_INFO)]) + _LAYER_NORM_84_VALUE_INFO
    pos = 0
    n = len(src)
    while pos < n:
        tag_start = pos
        tag, after_tag = _read_pb_varint(src, pos)
        field_no = tag >> 3
        wire_type = tag & 7
        if wire_type == 0:
            _, pos = _read_pb_varint(src, after_tag)
        elif wire_type == 2:
            length, data_start = _read_pb_varint(src, after_tag)
            data_end = data_start + length
            if field_no == 7:
                return (
                    src[:after_tag]
                    + _encode_pb_varint(length + len(graph_append))
                    + src[data_start:data_end]
                    + graph_append
                    + src[data_end:]
                )
            pos = data_end
        elif wire_type == 5:
            pos = after_tag + 4
        elif wire_type == 1:
            pos = after_tag + 8
        else:
            return src
    return src


@dataclass
class TranscriptionResult:
    text: str
    language: str
    duration_ms: float
    inference_ms: float
    rtf: float
    tokens: List[str]
    snr_db: Optional[float] = None


class AcousticEngine:
    """Core ONNX Runtime acoustic engine for multi-runtime execution."""

    _supports_is_partial = True

    def __init__(
        self,
        model_path: Optional[Union[str, Path]] = None,
        vocab_path: Optional[Union[str, Path]] = None,
        preprocessor_path: Optional[Union[str, Path]] = None,
        language: str = "sa",
        num_threads: int = 4,
        preprocessor_mode: str = "analytical",
        denoise: bool = True,
        tier: str = "studio",
        head_path: Optional[Union[str, Path]] = None,
    ):
        self.language = language
        self.num_threads = num_threads
        self.preprocessor_mode = preprocessor_mode
        self.denoise = denoise
        norm_tier = (tier or "studio").lower().strip()
        self.tier = "mobile" if norm_tier == "mobile" else "studio"
        self.acoustic_session: Optional[ort.InferenceSession] = None
        self.preprocessor_session: Optional[ort.InferenceSession] = None
        self._linear_head: Optional[Tuple[np.ndarray, np.ndarray]] = None
        self.vocab: List[str] = []

        # Configure session options
        self.sess_opts = ort.SessionOptions()
        self.sess_opts.intra_op_num_threads = max(1, num_threads)
        self.sess_opts.inter_op_num_threads = 1
        self.sess_opts.enable_cpu_mem_arena = True
        self.sess_opts.enable_mem_pattern = True
        self.sess_opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL

        repo_root = Path(__file__).resolve().parents[3]

        # Load vocabulary
        if vocab_path is None:
            repo_models = repo_root / "models" / "vocabularies"
            candidate = repo_models / f"{language}_vocab.json"
            if not candidate.exists() and language == "sa":
                candidate = repo_models / "sanskrit_vocab.json"
            if candidate.exists():
                vocab_path = candidate
        if vocab_path and Path(vocab_path).exists():
            with open(vocab_path, "r", encoding="utf-8") as f:
                self.vocab = json.load(f)

        # Load acoustic model (monolithic OR shared encoder + 515 KB `.bin` head)
        resolved_head: Optional[Path] = Path(head_path) if head_path else None
        if model_path is None:
            if self.tier == "mobile":
                repo_mob = repo_root / "models" / "onnx_mobile"
                mono = repo_mob / f"swanada_mobile_{language}_ctc_int8.onnx"
                shared = repo_mob / "swanada_mobile_ctc_int8.onnx"
                h_bin = repo_root / "docs" / "heads_mobile" / f"{language}.bin"
                if mono.exists():
                    model_path = mono
                elif shared.exists():
                    model_path = shared
                    if language != "sa" and h_bin.exists():
                        resolved_head = h_bin
            else:
                repo_onnx = repo_root / "models" / "onnx"
                candidate = repo_onnx / f"swanada_{language}_ctc_int8.onnx"
                shared = repo_onnx / "sushrota_sanskrit_ctc_int8.onnx"
                h_bin = repo_root / "docs" / "heads" / f"{language}.bin"
                if candidate.exists():
                    model_path = candidate
                elif shared.exists():
                    model_path = shared
                    if language != "sa" and h_bin.exists():
                        resolved_head = h_bin

        if resolved_head and resolved_head.exists():
            raw = resolved_head.read_bytes()
            w = np.frombuffer(raw[: 257 * 512 * 4], dtype="<f4").reshape(257, 512).copy()
            b = np.frombuffer(raw[257 * 512 * 4 : (257 * 512 + 257) * 4], dtype="<f4").copy()
            self._linear_head = (w, b)

        if model_path and Path(model_path).exists():
            if self._linear_head is not None:
                patched = _expose_encoder_hidden_output(Path(model_path).read_bytes())
                self.acoustic_session = ort.InferenceSession(
                    patched, sess_options=self.sess_opts, providers=["CPUExecutionProvider"]
                )
            else:
                self.acoustic_session = ort.InferenceSession(
                    str(model_path), sess_options=self.sess_opts, providers=["CPUExecutionProvider"]
                )
            # Warm up session graph kernels and pattern memory allocations
            try:
                dummy_feats = np.zeros((1, 80, 16), dtype=np.float32)
                dummy_lens = np.array([16], dtype=np.int64)
                self.acoustic_session.run(None, {"audio_signal": dummy_feats, "length": dummy_lens})
            except Exception:
                pass

        # Load preprocessor if ONNX mode requested
        if preprocessor_mode == "onnx":
            if preprocessor_path is None:
                candidate = Path(__file__).resolve().parents[3] / "models" / "preprocessor.onnx"
                if candidate.exists():
                    preprocessor_path = candidate
            if preprocessor_path and Path(preprocessor_path).exists():
                self.preprocessor_session = ort.InferenceSession(
                    str(preprocessor_path), sess_options=self.sess_opts, providers=["CPUExecutionProvider"]
                )

    def transcribe(
        self,
        audio: Union[str, Path, bytes, np.ndarray],
        sample_rate: int = 16000,
        is_partial: bool = False,
    ) -> TranscriptionResult:
        pcm = load_audio(audio, target_sr=sample_rate)
        duration_ms = (len(pcm) / sample_rate) * 1000.0
        start_time = time.perf_counter()

        if len(pcm) == 0:
            return TranscriptionResult(
                text="",
                language=self.language,
                duration_ms=0.0,
                inference_ms=0.0,
                rtf=0.0,
                tokens=[],
            )

        # VAD / Silence Energy Gate: RMS < 1e-4 (-80 dBFS) bypasses acoustic inference
        rms = float(np.sqrt(np.mean(pcm ** 2)))
        if rms < 1e-4:
            elapsed_ms = (time.perf_counter() - start_time) * 1000.0
            return TranscriptionResult(
                text="",
                language=self.language,
                duration_ms=duration_ms,
                inference_ms=elapsed_ms,
                rtf=elapsed_ms / duration_ms if duration_ms > 0 else 0.0,
                tokens=[],
            )

        # 0. Multi-stage background noise cancellation & speech enhancement
        snr_db: Optional[float] = None
        clean_pcm = pcm
        if self.denoise:
            enhanced = enhance_speech_with_telemetry(pcm, sr=sample_rate)
            snr_db = enhanced.estimated_snr_db
            if not enhanced.is_speech_likely:
                elapsed_ms = (time.perf_counter() - start_time) * 1000.0
                return TranscriptionResult(
                    text="",
                    language=self.language,
                    duration_ms=duration_ms,
                    inference_ms=elapsed_ms,
                    rtf=elapsed_ms / duration_ms if duration_ms > 0 else 0.0,
                    tokens=[],
                    snr_db=snr_db,
                )
            clean_pcm = enhanced.pcm

        # 1. Feature extraction
        if self.preprocessor_mode == "onnx" and self.preprocessor_session is not None:
            audio_sig = np.ascontiguousarray(clean_pcm.reshape(1, -1), dtype=np.float32)
            length = np.array([len(clean_pcm)], dtype=np.int64)
            outputs = self.preprocessor_session.run(None, {"audio_signal": audio_sig, "length": length})
            features = outputs[0]
            feature_length = int(outputs[1][0])
        else:
            features, feature_length = extract_log_mel_features(clean_pcm, sr=sample_rate)

        if self.acoustic_session is None:
            elapsed_ms = (time.perf_counter() - start_time) * 1000.0
            rtf = elapsed_ms / duration_ms if duration_ms > 0 else 0.0
            return TranscriptionResult(
                text="",
                language=self.language,
                duration_ms=duration_ms,
                inference_ms=elapsed_ms,
                rtf=rtf,
                tokens=[],
            )

        # 2. Acoustic model inference
        feats_input = np.ascontiguousarray(features, dtype=np.float32)
        lens_input = np.array([features.shape[2]], dtype=np.int64)

        if self._linear_head is not None:
            hidden = self.acoustic_session.run(
                ["layer_norm_84"],
                {"audio_signal": feats_input, "length": lens_input},
            )[0]  # [1, time_steps, 512]
            w_h, b_h = self._linear_head
            logits = hidden @ w_h.T + b_h
        else:
            ctc_out = self.acoustic_session.run(
                None,
                {"audio_signal": feats_input, "length": lens_input},
            )
            logits = ctc_out[0]  # [1, time_steps, num_classes]

        # 3. CTC decode
        decode_res: CTCDecodeResult = decode_ctc(logits, vocab=self.vocab, is_partial=is_partial)

        total_elapsed_ms = (time.perf_counter() - start_time) * 1000.0
        rtf = total_elapsed_ms / duration_ms if duration_ms > 0 else 0.0

        return TranscriptionResult(
            text=decode_res.text,
            language=self.language,
            duration_ms=duration_ms,
            inference_ms=total_elapsed_ms,
            rtf=rtf,
            tokens=decode_res.tokens,
            snr_db=snr_db,
        )
