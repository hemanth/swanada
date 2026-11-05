"""ONNX Runtime Inference Engine in Python for Swanada."""

import json
from dataclasses import dataclass
from pathlib import Path
import time
from typing import List, Optional, Union
import numpy as np
import onnxruntime as ort

from .audio import load_audio
from .decoder import CTCDecodeResult, decode_ctc
from .frontend import extract_log_mel_features, extract_log_mel_onnx


@dataclass
class TranscriptionResult:
    text: str
    language: str
    duration_ms: float
    inference_ms: float
    rtf: float
    tokens: List[str]


class AcousticEngine:
    """Core ONNX Runtime acoustic engine for multi-runtime execution."""

    def __init__(
        self,
        model_path: Optional[Union[str, Path]] = None,
        vocab_path: Optional[Union[str, Path]] = None,
        preprocessor_path: Optional[Union[str, Path]] = None,
        language: str = "sa",
        num_threads: int = 4,
        preprocessor_mode: str = "analytical",
    ):
        self.language = language
        self.num_threads = num_threads
        self.preprocessor_mode = preprocessor_mode
        self.acoustic_session: Optional[ort.InferenceSession] = None
        self.preprocessor_session: Optional[ort.InferenceSession] = None
        self.vocab: List[str] = []

        # Configure session options
        self.sess_opts = ort.SessionOptions()
        self.sess_opts.intra_op_num_threads = num_threads
        self.sess_opts.inter_op_num_threads = 1
        self.sess_opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL

        # Load vocabulary
        if vocab_path is None:
            # Try language-specific vocab first, then fallback
            repo_models = Path(__file__).resolve().parents[3] / "models" / "vocabularies"
            candidate = repo_models / f"{language}_vocab.json"
            if not candidate.exists() and language == "sa":
                candidate = repo_models / "sanskrit_vocab.json"
            if candidate.exists():
                vocab_path = candidate
        if vocab_path and Path(vocab_path).exists():
            with open(vocab_path, "r", encoding="utf-8") as f:
                self.vocab = json.load(f)

        # Load acoustic model if provided
        if model_path is None:
            repo_onnx = Path(__file__).resolve().parents[3] / "models" / "onnx"
            candidate = repo_onnx / f"swanada_{language}_ctc_int8.onnx"
            if not candidate.exists() and language == "sa":
                candidate = repo_onnx / "sushrota_sanskrit_ctc_int8.onnx"
            if candidate.exists():
                model_path = candidate
        if model_path and Path(model_path).exists():
            self.acoustic_session = ort.InferenceSession(
                str(model_path), sess_options=self.sess_opts, providers=["CPUExecutionProvider"]
            )

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

        # 1. Feature extraction
        if self.preprocessor_mode == "onnx" and self.preprocessor_session is not None:
            audio_sig = np.ascontiguousarray(pcm.reshape(1, -1), dtype=np.float32)
            length = np.array([len(pcm)], dtype=np.int64)
            outputs = self.preprocessor_session.run(None, {"audio_signal": audio_sig, "length": length})
            features = outputs[0]
            feature_length = int(outputs[1][0])
        else:
            features, feature_length = extract_log_mel_features(pcm, sr=sample_rate)

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

        ctc_out = self.acoustic_session.run(
            None,
            {"audio_signal": feats_input, "length": lens_input},
        )
        logits = ctc_out[0]  # [1, time_steps, num_classes]

        # 3. CTC greedy decode
        decode_res: CTCDecodeResult = decode_ctc(logits, vocab=self.vocab)

        total_elapsed_ms = (time.perf_counter() - start_time) * 1000.0
        rtf = total_elapsed_ms / duration_ms if duration_ms > 0 else 0.0

        return TranscriptionResult(
            text=decode_res.text,
            language=self.language,
            duration_ms=duration_ms,
            inference_ms=total_elapsed_ms,
            rtf=rtf,
            tokens=decode_res.tokens,
        )
