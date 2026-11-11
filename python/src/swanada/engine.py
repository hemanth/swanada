"""ONNX Runtime Inference Engine in Python for Swanada."""

import json
from dataclasses import dataclass
from pathlib import Path
import time
from typing import Dict, List, Optional, Tuple, Union
import numpy as np
import onnxruntime as ort

from .audio import load_audio
from .decoder import CTCDecodeResult, decode_ctc
from .denoise import enhance_speech_with_telemetry
from .frontend import extract_log_mel_features, extract_log_mel_onnx
from .lid import (
    CodeSwitchSpan,
    LID_LANGUAGES,
    LanguageDetectionResult,
    NeuralLIDWeights,
    decode_bilingual_codeswitch,
    detect_language_from_hidden,
    load_lid_head,
)

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
    language_confidence: Optional[float] = None
    language_probabilities: Optional[Dict[str, float]] = None
    english_spans: Optional[List[CodeSwitchSpan]] = None

    @property
    def iast(self) -> Optional[str]:
        if self.language == "sa" and self.text:
            from .vocab import devanagari_to_iast
            return devanagari_to_iast(self.text)
        return None


def _parse_linear_head_bin(raw: bytes) -> Tuple[np.ndarray, np.ndarray]:
    w = np.frombuffer(raw[: 257 * 512 * 4], dtype="<f4").reshape(257, 512).copy()
    b = np.frombuffer(raw[257 * 512 * 4 : (257 * 512 + 257) * 4], dtype="<f4").copy()
    return w, b


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
        code_switch_en: bool = False,
        lid_head_path: Optional[Union[str, Path]] = None,
    ):
        self.language = (language or "sa").lower().strip()
        self.num_threads = num_threads
        self.preprocessor_mode = preprocessor_mode
        self.denoise = denoise
        self.code_switch_en = bool(code_switch_en)
        norm_tier = (tier or "studio").lower().strip()
        self.tier = "mobile" if norm_tier == "mobile" else "studio"
        self.acoustic_session: Optional[ort.InferenceSession] = None
        self.preprocessor_session: Optional[ort.InferenceSession] = None
        self._linear_head: Optional[Tuple[np.ndarray, np.ndarray]] = None
        self._multi_heads: Dict[str, Tuple[np.ndarray, np.ndarray]] = {}
        self._multi_vocabs: Dict[str, List[str]] = {}
        self._lid_weights: Optional[NeuralLIDWeights] = None
        self._has_hidden_output: bool = False
        self._model_file_path: Optional[Path] = None
        self.vocab: List[str] = []

        # Configure session options
        self.sess_opts = ort.SessionOptions()
        self.sess_opts.intra_op_num_threads = max(1, num_threads)
        self.sess_opts.inter_op_num_threads = 1
        self.sess_opts.enable_cpu_mem_arena = True
        self.sess_opts.enable_mem_pattern = True
        self.sess_opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL

        repo_root = Path(__file__).resolve().parents[3]
        heads_subdir = "heads_mobile" if self.tier == "mobile" else "heads"
        onnx_subdir = "onnx_mobile" if self.tier == "mobile" else "onnx"

        def _resolve_vocab_file(lg: str) -> Optional[Path]:
            search_dirs = [repo_root / "models" / "vocabularies"]
            if model_path:
                mp = Path(model_path).resolve()
                md = mp if mp.is_dir() else mp.parent
                search_dirs = [md / "vocabularies", md.parent / "vocabularies", md] + search_dirs
            for d in search_dirs:
                c1 = d / f"{lg}_vocab.json"
                if c1.exists():
                    return c1
                if lg == "sa":
                    c2 = d / "sanskrit_vocab.json"
                    if c2.exists():
                        return c2
            return None

        def _resolve_head_bin(lg: str) -> Optional[Path]:
            cands: List[Path] = []
            if model_path:
                mp = Path(model_path).resolve()
                md = mp if mp.is_dir() else mp.parent
                cands.extend([
                    md / heads_subdir / f"{lg}.bin",
                    md.parent / heads_subdir / f"{lg}.bin",
                    md.parent / "docs" / heads_subdir / f"{lg}.bin",
                ])
            cands.extend([
                repo_root / "docs" / heads_subdir / f"{lg}.bin",
                repo_root / "models" / onnx_subdir / "heads" / f"{lg}.bin",
            ])
            for c in cands:
                if c.exists() and c.stat().st_size == (257 * 512 + 257) * 4:
                    return c
            return None

        self._resolve_vocab_file = _resolve_vocab_file
        self._resolve_head_bin = _resolve_head_bin
        self._repo_root = repo_root
        self._heads_subdir = heads_subdir
        self._onnx_subdir = onnx_subdir

        is_auto = self.language == "auto"
        seed_lang = "sa" if is_auto else self.language

        # Load primary vocabulary (or 'sa' default seed when language='auto')
        if vocab_path is None:
            vocab_path = _resolve_vocab_file(seed_lang)
        if vocab_path and Path(vocab_path).exists():
            with open(vocab_path, "r", encoding="utf-8") as f:
                self.vocab = json.load(f)

        # When Auto-LID or Code-Switching is enabled, preload multi-language heads & vocabs
        if is_auto or (self.code_switch_en and self.language != "en"):
            target_langs = LID_LANGUAGES if is_auto else (self.language, "en")
            for lg in target_langs:
                vf = _resolve_vocab_file(lg)
                if vf is not None:
                    with open(vf, "r", encoding="utf-8") as f:
                        self._multi_vocabs[lg] = json.load(f)
                hb = _resolve_head_bin(lg)
                if hb is not None:
                    self._multi_heads[lg] = _parse_linear_head_bin(hb.read_bytes())

            lid_cands: List[Path] = []
            if lid_head_path:
                lid_cands.append(Path(lid_head_path))
            if model_path:
                mp = Path(model_path).resolve()
                md = mp if mp.is_dir() else mp.parent
                lid_cands.extend([
                    md / heads_subdir / "lid.bin",
                    md.parent / heads_subdir / "lid.bin",
                    md.parent / "docs" / heads_subdir / "lid.bin",
                ])
            lid_cands.extend([
                repo_root / "docs" / heads_subdir / "lid.bin",
                repo_root / "models" / onnx_subdir / "heads" / "lid.bin",
            ])
            for lc in lid_cands:
                if lc.exists():
                    try:
                        self._lid_weights = load_lid_head(lc)
                        break
                    except Exception:
                        pass

        # Load acoustic model (monolithic OR shared encoder + 515 KB `.bin` head)
        resolved_head: Optional[Path] = Path(head_path) if head_path else None
        if model_path is None:
            if self.tier == "mobile":
                repo_mob = repo_root / "models" / "onnx_mobile"
                mono = repo_mob / f"swanada_mobile_{seed_lang}_ctc_int8.onnx"
                shared = repo_mob / "swanada_mobile_ctc_int8.onnx"
                h_bin = repo_root / "docs" / "heads_mobile" / f"{seed_lang}.bin"
                if not is_auto and not self.code_switch_en and mono.exists():
                    model_path = mono
                elif shared.exists():
                    model_path = shared
                    if not is_auto and seed_lang != "sa" and h_bin.exists():
                        resolved_head = h_bin
                elif mono.exists():
                    model_path = mono
            else:
                repo_onnx = repo_root / "models" / "onnx"
                candidate = repo_onnx / f"swanada_{seed_lang}_ctc_int8.onnx"
                shared = repo_onnx / "sushrota_sanskrit_ctc_int8.onnx"
                h_bin = repo_root / "docs" / "heads" / f"{seed_lang}.bin"
                if not is_auto and not self.code_switch_en and candidate.exists():
                    model_path = candidate
                elif shared.exists():
                    model_path = shared
                    if not is_auto and seed_lang != "sa" and h_bin.exists():
                        resolved_head = h_bin
                elif candidate.exists():
                    model_path = candidate

        if resolved_head and resolved_head.exists():
            self._linear_head = _parse_linear_head_bin(resolved_head.read_bytes())
        elif not is_auto and self.language in self._multi_heads:
            self._linear_head = self._multi_heads[self.language]

        need_hidden_out = (
            self._linear_head is not None
            or is_auto
            or (self.code_switch_en and self.language != "en" and "en" in self._multi_heads)
        )

        if model_path and Path(model_path).exists():
            self._model_file_path = Path(model_path)
            if need_hidden_out:
                patched = _expose_encoder_hidden_output(self._model_file_path.read_bytes())
                self.acoustic_session = ort.InferenceSession(
                    patched, sess_options=self.sess_opts, providers=["CPUExecutionProvider"]
                )
                out_names = {o.name for o in self.acoustic_session.get_outputs()}
                self._has_hidden_output = "layer_norm_84" in out_names
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

    def _ensure_hidden_and_heads(self, langs: Tuple[str, ...]) -> None:
        for lg in langs:
            if lg not in self._multi_vocabs:
                vf = self._resolve_vocab_file(lg)
                if vf is not None:
                    with open(vf, "r", encoding="utf-8") as f:
                        self._multi_vocabs[lg] = json.load(f)
            if lg not in self._multi_heads:
                hb = self._resolve_head_bin(lg)
                if hb is not None:
                    self._multi_heads[lg] = _parse_linear_head_bin(hb.read_bytes())
        if self._lid_weights is None and len(langs) > 2:
            for lc in (
                self._repo_root / "docs" / self._heads_subdir / "lid.bin",
                self._repo_root / "models" / self._onnx_subdir / "heads" / "lid.bin",
            ):
                if lc.exists():
                    try:
                        self._lid_weights = load_lid_head(lc)
                        break
                    except Exception:
                        pass
        if not self._has_hidden_output and self._model_file_path and self._model_file_path.exists():
            raw = self._model_file_path.read_bytes()
            if b"layer_norm_84" in raw:
                patched = _expose_encoder_hidden_output(raw)
                self.acoustic_session = ort.InferenceSession(
                    patched, sess_options=self.sess_opts, providers=["CPUExecutionProvider"]
                )
                out_names = {o.name for o in self.acoustic_session.get_outputs()}
                self._has_hidden_output = "layer_norm_84" in out_names

    def detect_language(
        self,
        audio: Union[str, Path, bytes, np.ndarray],
        sample_rate: int = 16000,
    ) -> LanguageDetectionResult:
        """Detects spoken language across all 12 supported languages using shared `layer_norm_84`."""
        pcm = load_audio(audio, target_sr=sample_rate)
        if len(pcm) == 0 or float(np.sqrt(np.mean(pcm ** 2))) < 1e-4 or self.acoustic_session is None:
            fallback = "sa" if self.language == "auto" else self.language
            return LanguageDetectionResult(language=fallback, confidence=0.0, probabilities={}, used_neural_lid=False)
        clean_pcm = pcm
        if self.denoise:
            enhanced = enhance_speech_with_telemetry(pcm, sr=sample_rate)
            if not enhanced.is_speech_likely:
                fallback = "sa" if self.language == "auto" else self.language
                return LanguageDetectionResult(language=fallback, confidence=0.0, probabilities={}, used_neural_lid=False)
            clean_pcm = enhanced.pcm
        self._ensure_hidden_and_heads(LID_LANGUAGES)
        features, _ = extract_log_mel_features(clean_pcm, sr=sample_rate)
        feats_input = np.ascontiguousarray(features, dtype=np.float32)
        lens_input = np.array([features.shape[2]], dtype=np.int64)
        if not self._has_hidden_output or not self._multi_heads:
            fallback = "sa" if self.language == "auto" else self.language
            return LanguageDetectionResult(language=fallback, confidence=1.0, probabilities={fallback: 1.0}, used_neural_lid=False)
        hidden = self.acoustic_session.run(["layer_norm_84"], {"audio_signal": feats_input, "length": lens_input})[0]
        lid_res, _ = detect_language_from_hidden(hidden, self._multi_heads, self._multi_vocabs, self._lid_weights)
        return lid_res

    def transcribe(
        self,
        audio: Union[str, Path, bytes, np.ndarray],
        sample_rate: int = 16000,
        is_partial: bool = False,
        code_switch_en: Optional[bool] = None,
        forced_language: Optional[str] = None,
    ) -> TranscriptionResult:
        pcm = load_audio(audio, target_sr=sample_rate)
        duration_ms = (len(pcm) / sample_rate) * 1000.0
        start_time = time.perf_counter()
        use_cs = self.code_switch_en if code_switch_en is None else bool(code_switch_en)

        if len(pcm) == 0:
            return TranscriptionResult(
                text="",
                language=forced_language or self.language,
                duration_ms=0.0,
                inference_ms=0.0,
                rtf=0.0,
                tokens=[],
                language_confidence=0.0 if self.language == "auto" else None,
            )

        # VAD / Silence Energy Gate: RMS < 1e-4 (-80 dBFS) bypasses acoustic inference
        rms = float(np.sqrt(np.mean(pcm ** 2)))
        if rms < 1e-4:
            elapsed_ms = (time.perf_counter() - start_time) * 1000.0
            return TranscriptionResult(
                text="",
                language=forced_language or self.language,
                duration_ms=duration_ms,
                inference_ms=elapsed_ms,
                rtf=elapsed_ms / duration_ms if duration_ms > 0 else 0.0,
                tokens=[],
                language_confidence=0.0 if self.language == "auto" else None,
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
                    language=forced_language or self.language,
                    duration_ms=duration_ms,
                    inference_ms=elapsed_ms,
                    rtf=elapsed_ms / duration_ms if duration_ms > 0 else 0.0,
                    tokens=[],
                    snr_db=snr_db,
                    language_confidence=0.0 if self.language == "auto" else None,
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
                language=forced_language or self.language,
                duration_ms=duration_ms,
                inference_ms=elapsed_ms,
                rtf=rtf,
                tokens=[],
            )

        # 2. Acoustic model inference (+ optional 12-way Auto-LID & Bilingual Code-Switch)
        feats_input = np.ascontiguousarray(features, dtype=np.float32)
        lens_input = np.array([features.shape[2]], dtype=np.int64)

        active_lang = forced_language or self.language
        if use_cs and active_lang not in ("en", "auto"):
            self._ensure_hidden_and_heads((active_lang, "en"))
        active_vocab = self.vocab
        lang_conf: Optional[float] = None
        lang_probs: Optional[Dict[str, float]] = None
        en_spans: Optional[List[CodeSwitchSpan]] = None

        if active_lang == "auto" and self._has_hidden_output and self._multi_heads:
            hidden = self.acoustic_session.run(
                ["layer_norm_84"],
                {"audio_signal": feats_input, "length": lens_input},
            )[0]  # [1, time_steps, 512]
            lid_res, cached_logits = detect_language_from_hidden(
                hidden, self._multi_heads, self._multi_vocabs, self._lid_weights
            )
            active_lang = lid_res.language
            lang_conf = lid_res.confidence
            lang_probs = lid_res.probabilities
            active_vocab = self._multi_vocabs.get(active_lang, self.vocab)
            if active_lang in cached_logits:
                logits_2d = cached_logits[active_lang]
            else:
                w_h, b_h = self._multi_heads[active_lang]
                logits_2d = hidden[0] @ w_h.T + b_h

            if use_cs and active_lang != "en" and "en" in self._multi_heads and "en" in self._multi_vocabs:
                lg_en = cached_logits.get("en")
                if lg_en is None:
                    w_en, b_en = self._multi_heads["en"]
                    lg_en = hidden[0] @ w_en.T + b_en
                cs_res = decode_bilingual_codeswitch(
                    logits_2d, active_vocab, active_lang, lg_en, self._multi_vocabs["en"], is_partial=is_partial
                )
                decode_text, decode_tokens, en_spans = cs_res.text, cs_res.tokens, cs_res.english_spans
            else:
                dec = decode_ctc(logits_2d[None, :, :], vocab=active_vocab, is_partial=is_partial)
                decode_text, decode_tokens = dec.text, dec.tokens
        elif forced_language and forced_language in self._multi_heads and self._has_hidden_output:
            hidden = self.acoustic_session.run(
                ["layer_norm_84"],
                {"audio_signal": feats_input, "length": lens_input},
            )[0]
            w_h, b_h = self._multi_heads[forced_language]
            logits_2d = hidden[0] @ w_h.T + b_h
            active_vocab = self._multi_vocabs.get(forced_language, self.vocab)
            if use_cs and forced_language != "en" and "en" in self._multi_heads and "en" in self._multi_vocabs:
                w_en, b_en = self._multi_heads["en"]
                lg_en = hidden[0] @ w_en.T + b_en
                cs_res = decode_bilingual_codeswitch(
                    logits_2d, active_vocab, forced_language, lg_en, self._multi_vocabs["en"], is_partial=is_partial
                )
                decode_text, decode_tokens, en_spans = cs_res.text, cs_res.tokens, cs_res.english_spans
            else:
                dec = decode_ctc(logits_2d[None, :, :], vocab=active_vocab, is_partial=is_partial)
                decode_text, decode_tokens = dec.text, dec.tokens
        elif self._has_hidden_output and (self._linear_head is not None or use_cs):
            hidden = self.acoustic_session.run(
                ["layer_norm_84"],
                {"audio_signal": feats_input, "length": lens_input},
            )[0]
            if self._linear_head is not None:
                w_h, b_h = self._linear_head
                logits = hidden @ w_h.T + b_h
            else:
                logits = self.acoustic_session.run(
                    ["logits"],
                    {"audio_signal": feats_input, "length": lens_input},
                )[0]
            if use_cs and active_lang != "en" and "en" in self._multi_heads and "en" in self._multi_vocabs:
                w_en, b_en = self._multi_heads["en"]
                lg_en = hidden[0] @ w_en.T + b_en
                cs_res = decode_bilingual_codeswitch(
                    logits[0], active_vocab, active_lang, lg_en, self._multi_vocabs["en"], is_partial=is_partial
                )
                decode_text, decode_tokens, en_spans = cs_res.text, cs_res.tokens, cs_res.english_spans
            else:
                dec = decode_ctc(logits, vocab=active_vocab, is_partial=is_partial)
                decode_text, decode_tokens = dec.text, dec.tokens
        else:
            ctc_out = self.acoustic_session.run(
                None,
                {"audio_signal": feats_input, "length": lens_input},
            )
            logits = ctc_out[0]  # [1, time_steps, num_classes]
            dec = decode_ctc(logits, vocab=active_vocab, is_partial=is_partial)
            decode_text, decode_tokens = dec.text, dec.tokens

        total_elapsed_ms = (time.perf_counter() - start_time) * 1000.0
        rtf = total_elapsed_ms / duration_ms if duration_ms > 0 else 0.0

        return TranscriptionResult(
            text=decode_text,
            language=active_lang,
            duration_ms=duration_ms,
            inference_ms=total_elapsed_ms,
            rtf=rtf,
            tokens=decode_tokens,
            snr_db=snr_db,
            language_confidence=lang_conf,
            language_probabilities=lang_probs,
            english_spans=en_spans,
        )
