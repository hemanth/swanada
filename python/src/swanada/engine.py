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
from .en_adapter import EnglishAdapterWeights, SENH_MAGIC, parse_en_adapter_bytes
from .frontend import extract_log_mel_features, extract_log_mel_onnx
from .lid import (
    CodeSwitchSpan,
    LID_LANGUAGES,
    LanguageDetectionResult,
    NeuralLIDWeights,
    decode_bilingual_codeswitch,
    detect_language_from_hidden,
    load_lid_head,
    split_pcm_at_pauses,
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
        self._en_adapter: Optional[EnglishAdapterWeights] = None
        self._en_adapter_vocab: List[str] = []
        self._lang_adapters: Dict[str, Tuple[EnglishAdapterWeights, List[str]]] = {}
        self._multi_heads: Dict[str, Tuple[np.ndarray, np.ndarray]] = {}
        self._multi_vocabs: Dict[str, List[str]] = {}
        self._lid_weights: Optional[NeuralLIDWeights] = None
        self._has_hidden_output: bool = False
        self._model_file_path: Optional[Path] = None
        self.vocab: List[str] = []
        self._fallback_vocab: List[str] = []

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
            search_dirs = [repo_root / "models" / "vocabularies", repo_root / "docs" / "vocabularies"]
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

        def _resolve_lang_adapter_pair(lg: str) -> Tuple[Optional[EnglishAdapterWeights], List[str]]:
            if lg == "sa":
                return None, []
            a_cands: List[Path] = []
            v_cands: List[Path] = []
            v_names = ["en_bpe_vocab.json", "en_vocab.json"] if lg == "en" else [f"{lg}_vocab.json"]
            if model_path:
                mp = Path(model_path).resolve()
                md = mp if mp.is_dir() else mp.parent
                a_cands.extend([
                    md / heads_subdir / f"{lg}_adapter.bin",
                    md.parent / heads_subdir / f"{lg}_adapter.bin",
                    md.parent / "docs" / heads_subdir / f"{lg}_adapter.bin",
                ])
                for vn in v_names:
                    v_cands.extend([
                        md / "vocabularies" / vn,
                        md.parent / "vocabularies" / vn,
                        md / vn,
                    ])
            a_cands.extend([
                repo_root / "docs" / heads_subdir / f"{lg}_adapter.bin",
                repo_root / "models" / onnx_subdir / "heads" / f"{lg}_adapter.bin",
            ])
            for vn in v_names:
                v_cands.extend([
                    repo_root / "models" / "vocabularies" / vn,
                    repo_root / "docs" / "vocabularies" / vn,
                ])
            adapter_p = next((p for p in a_cands if p.exists() and p.stat().st_size > 4096), None)
            if adapter_p is None:
                return None, []
            try:
                ad_w = parse_en_adapter_bytes(adapter_p.read_bytes())
                for vp in v_cands:
                    if vp.exists() and vp.stat().st_size > 256:
                        ad_v = json.loads(vp.read_text(encoding="utf-8"))
                        if isinstance(ad_v, list) and len(ad_v) == ad_w.num_classes:
                            return ad_w, ad_v
            except Exception:
                pass
            return None, []

        def _resolve_en_adapter_pair() -> Tuple[Optional[EnglishAdapterWeights], List[str]]:
            return _resolve_lang_adapter_pair("en")

        self._resolve_vocab_file = _resolve_vocab_file
        self._resolve_head_bin = _resolve_head_bin
        self._resolve_lang_adapter_pair = _resolve_lang_adapter_pair
        self._resolve_en_adapter_pair = _resolve_en_adapter_pair
        self._repo_root = repo_root
        self._heads_subdir = heads_subdir
        self._onnx_subdir = onnx_subdir

        is_auto = self.language == "auto"
        seed_lang = "sa" if is_auto else self.language
        explicit_vocab_arg = Path(vocab_path) if vocab_path is not None else None
        explicit_head_arg = Path(head_path) if head_path is not None else None
        explicit_model_arg = Path(model_path) if model_path is not None else None

        # Load primary vocabulary (or 'sa' default seed when language='auto')
        if vocab_path is None:
            vocab_path = _resolve_vocab_file(seed_lang)
        if vocab_path and Path(vocab_path).exists():
            with open(vocab_path, "r", encoding="utf-8") as f:
                self.vocab = json.load(f)
                self._fallback_vocab = list(self.vocab)

        # Check explicit SENH v2 head_path or auto-discover SENH v2 language adapters
        allow_auto_seed_adapter = True
        if explicit_vocab_arg is not None:
            expected_vnames = (
                ("en_vocab.json", "en_bpe_vocab.json")
                if seed_lang == "en"
                else (f"{seed_lang}_vocab.json",)
            )
            if explicit_vocab_arg.name not in expected_vnames:
                allow_auto_seed_adapter = False
        if explicit_model_arg is not None and explicit_model_arg.is_file():
            mname = explicit_model_arg.name
            if (
                seed_lang != "sa"
                and mname.startswith(("swanada_",))
                and mname not in ("swanada_mobile_ctc_int8.onnx",)
                and explicit_head_arg is None
            ):
                # Explicit monolithic per-language ONNX path passed: keep monolithic unless head_path set
                allow_auto_seed_adapter = False

        if explicit_head_arg is not None and explicit_head_arg.exists():
            raw_eh = explicit_head_arg.read_bytes()
            if raw_eh[:4] == SENH_MAGIC:
                parsed_eh = parse_en_adapter_bytes(raw_eh)
                _, auto_v = _resolve_lang_adapter_pair(seed_lang)
                if len(self.vocab) == parsed_eh.num_classes:
                    use_v = list(self.vocab)
                elif auto_v and len(auto_v) == parsed_eh.num_classes:
                    use_v = list(auto_v)
                    self.vocab = list(auto_v)
                else:
                    use_v = list(self.vocab)
                self._lang_adapters[seed_lang] = (parsed_eh, use_v)
                if seed_lang == "en":
                    self._en_adapter = parsed_eh
                    self._en_adapter_vocab = use_v
            else:
                allow_auto_seed_adapter = False

        if not is_auto and seed_lang != "sa" and seed_lang not in self._lang_adapters and allow_auto_seed_adapter:
            ad_w, ad_v = _resolve_lang_adapter_pair(seed_lang)
            if ad_w is not None and ad_v:
                self._lang_adapters[seed_lang] = (ad_w, ad_v)
                self.vocab = list(ad_v)
                if seed_lang == "en":
                    self._en_adapter = ad_w
                    self._en_adapter_vocab = ad_v

        if is_auto or self.code_switch_en:
            preload_adapter_langs = LID_LANGUAGES if is_auto else ("en",)
            for alg in preload_adapter_langs:
                if alg != "sa" and alg not in self._lang_adapters:
                    ad_w, ad_v = _resolve_lang_adapter_pair(alg)
                    if ad_w is not None and ad_v:
                        self._lang_adapters[alg] = (ad_w, ad_v)
                        if alg == "en":
                            self._en_adapter = ad_w
                            self._en_adapter_vocab = ad_v

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

        # Load acoustic model (monolithic OR shared encoder + 515 KB `.bin` head / SENH v2 adapter)
        seed_has_adapter = not is_auto and seed_lang in self._lang_adapters
        resolved_head: Optional[Path] = explicit_head_arg if (explicit_head_arg and not seed_has_adapter) else None
        if model_path is None:
            if self.tier == "mobile":
                repo_mob = repo_root / "models" / "onnx_mobile"
                mono = repo_mob / f"swanada_mobile_{seed_lang}_ctc_int8.onnx"
                shared = repo_mob / "swanada_mobile_ctc_int8.onnx"
                h_bin = repo_root / "docs" / "heads_mobile" / f"{seed_lang}.bin"
                if seed_has_adapter and shared.exists():
                    model_path = shared
                elif not is_auto and not self.code_switch_en and mono.exists():
                    model_path = mono
                elif shared.exists():
                    model_path = shared
                    if not is_auto and seed_lang != "sa" and not seed_has_adapter and h_bin.exists():
                        resolved_head = h_bin
                elif mono.exists():
                    model_path = mono
            else:
                repo_onnx = repo_root / "models" / "onnx"
                candidate = repo_onnx / f"swanada_{seed_lang}_ctc_int8.onnx"
                shared = repo_onnx / "sushrota_sanskrit_ctc_int8.onnx"
                h_bin = repo_root / "docs" / "heads" / f"{seed_lang}.bin"
                if seed_has_adapter and shared.exists():
                    model_path = shared
                elif not is_auto and not self.code_switch_en and candidate.exists():
                    model_path = candidate
                elif shared.exists():
                    model_path = shared
                    if not is_auto and seed_lang != "sa" and not seed_has_adapter and h_bin.exists():
                        resolved_head = h_bin
                elif candidate.exists():
                    model_path = candidate

        if resolved_head and resolved_head.exists():
            raw_rh = resolved_head.read_bytes()
            if raw_rh[:4] == SENH_MAGIC:
                parsed_rh = parse_en_adapter_bytes(raw_rh)
                self._lang_adapters[seed_lang] = (parsed_rh, list(self.vocab))
                if seed_lang == "en":
                    self._en_adapter = parsed_rh
                    self._en_adapter_vocab = list(self.vocab)
            else:
                self._linear_head = _parse_linear_head_bin(raw_rh)
        elif not is_auto and seed_lang not in self._lang_adapters and self.language in self._multi_heads:
            self._linear_head = self._multi_heads[self.language]

        need_hidden_out = (
            self._linear_head is not None
            or bool(self._lang_adapters)
            or self._en_adapter is not None
            or is_auto
            or (self.code_switch_en and self.language != "en" and ("en" in self._multi_heads or "en" in self._lang_adapters))
        )

        if model_path and Path(model_path).exists():
            self._model_file_path = Path(model_path)
            raw_model_bytes = self._model_file_path.read_bytes()
            if need_hidden_out and b"layer_norm_84" in raw_model_bytes:
                patched = _expose_encoder_hidden_output(raw_model_bytes)
                self.acoustic_session = ort.InferenceSession(
                    patched, sess_options=self.sess_opts, providers=["CPUExecutionProvider"]
                )
                out_names = {o.name for o in self.acoustic_session.get_outputs()}
                self._has_hidden_output = "layer_norm_84" in out_names
            else:
                self.acoustic_session = ort.InferenceSession(
                    raw_model_bytes, sess_options=self.sess_opts, providers=["CPUExecutionProvider"]
                )
                if not is_auto and seed_lang in self._lang_adapters and self._fallback_vocab:
                    self.vocab = list(self._fallback_vocab)
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

    def get_vocab_for_language(self, lg: str) -> List[str]:
        if lg in self._lang_adapters:
            return self._lang_adapters[lg][1]
        if lg == "en" and self._en_adapter is not None and self._en_adapter_vocab:
            return self._en_adapter_vocab
        return self._multi_vocabs.get(lg, self.vocab)

    def _has_lang_decode_head(self, lg: str) -> bool:
        if lg in self._lang_adapters:
            return True
        if lg == "en" and self._en_adapter is not None and bool(self._en_adapter_vocab):
            return True
        return lg in self._multi_heads and lg in self._multi_vocabs

    def _has_en_decode_head(self) -> bool:
        return self._has_lang_decode_head("en")

    def _compute_lang_decode_logits_and_vocab(
        self,
        lg: str,
        hidden_2d: np.ndarray,
        cached_logits: Optional[Dict[str, np.ndarray]] = None,
    ) -> Tuple[np.ndarray, List[str]]:
        if lg in self._lang_adapters:
            ad_w, ad_v = self._lang_adapters[lg]
            return ad_w.forward(hidden_2d), ad_v
        if lg == "en" and self._en_adapter is not None and self._en_adapter_vocab:
            return self._en_adapter.forward(hidden_2d), self._en_adapter_vocab
        if cached_logits is not None and lg in cached_logits:
            return cached_logits[lg], self._multi_vocabs.get(lg, self.vocab)
        w_h, b_h = self._multi_heads[lg]
        return hidden_2d @ w_h.T + b_h, self._multi_vocabs.get(lg, self.vocab)

    def _compute_en_decode_logits_and_vocab(
        self,
        hidden_2d: np.ndarray,
        cached_logits: Optional[Dict[str, np.ndarray]] = None,
    ) -> Tuple[np.ndarray, List[str]]:
        return self._compute_lang_decode_logits_and_vocab("en", hidden_2d, cached_logits)

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
            if lg != "sa" and lg not in self._lang_adapters:
                ad_w, ad_v = self._resolve_lang_adapter_pair(lg)
                if ad_w is not None and ad_v:
                    self._lang_adapters[lg] = (ad_w, ad_v)
                    if lg == "en":
                        self._en_adapter = ad_w
                        self._en_adapter_vocab = ad_v
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

        # 0b. Pause-aware multi-language segment Auto-LID & native-script decoding
        active_lang = forced_language or self.language
        if (
            active_lang == "auto"
            and not is_partial
            and self.acoustic_session is not None
            and self._has_hidden_output
            and self._multi_heads
            and len(pcm) >= int(3.1 * sample_rate)
        ):
            multi_res = self._try_transcribe_multilang_segments(
                pcm=pcm,
                sample_rate=sample_rate,
                use_cs=use_cs,
                snr_db=snr_db,
                start_time=start_time,
                duration_ms=duration_ms,
            )
            if multi_res is not None:
                return multi_res

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
            if self._has_lang_decode_head(active_lang):
                logits_2d, active_vocab = self._compute_lang_decode_logits_and_vocab(active_lang, hidden[0], cached_logits)
            else:
                active_vocab = self._multi_vocabs.get(active_lang, self.vocab)
                if active_lang in cached_logits:
                    logits_2d = cached_logits[active_lang]
                else:
                    w_h, b_h = self._multi_heads[active_lang]
                    logits_2d = hidden[0] @ w_h.T + b_h

            if use_cs and active_lang != "en" and self._has_en_decode_head():
                lg_en, en_vocab = self._compute_en_decode_logits_and_vocab(hidden[0], cached_logits)
                cs_res = decode_bilingual_codeswitch(
                    logits_2d, active_vocab, active_lang, lg_en, en_vocab, is_partial=is_partial
                )
                decode_text, decode_tokens, en_spans = cs_res.text, cs_res.tokens, cs_res.english_spans
            else:
                dec = decode_ctc(logits_2d[None, :, :], vocab=active_vocab, is_partial=is_partial)
                decode_text, decode_tokens = dec.text, dec.tokens
        elif (
            forced_language
            and self._has_hidden_output
            and self._has_lang_decode_head(forced_language)
        ):
            hidden = self.acoustic_session.run(
                ["layer_norm_84"],
                {"audio_signal": feats_input, "length": lens_input},
            )[0]
            logits_2d, active_vocab = self._compute_lang_decode_logits_and_vocab(forced_language, hidden[0])
            if use_cs and forced_language != "en" and self._has_en_decode_head():
                lg_en, en_vocab = self._compute_en_decode_logits_and_vocab(hidden[0])
                cs_res = decode_bilingual_codeswitch(
                    logits_2d, active_vocab, forced_language, lg_en, en_vocab, is_partial=is_partial
                )
                decode_text, decode_tokens, en_spans = cs_res.text, cs_res.tokens, cs_res.english_spans
            else:
                dec = decode_ctc(logits_2d[None, :, :], vocab=active_vocab, is_partial=is_partial)
                decode_text, decode_tokens = dec.text, dec.tokens
        elif self._has_hidden_output and (
            active_lang in self._lang_adapters
            or self._en_adapter is not None
            or self._linear_head is not None
            or use_cs
        ):
            hidden = self.acoustic_session.run(
                ["layer_norm_84"],
                {"audio_signal": feats_input, "length": lens_input},
            )[0]
            if active_lang in self._lang_adapters:
                ad_w, ad_v = self._lang_adapters[active_lang]
                logits = ad_w.forward(hidden)
                active_vocab = ad_v
            elif active_lang == "en" and self._en_adapter is not None and self._en_adapter_vocab:
                logits = self._en_adapter.forward(hidden)
                active_vocab = self._en_adapter_vocab
            elif self._linear_head is not None:
                w_h, b_h = self._linear_head
                logits = hidden @ w_h.T + b_h
            else:
                logits = self.acoustic_session.run(
                    ["logits"],
                    {"audio_signal": feats_input, "length": lens_input},
                )[0]
            if use_cs and active_lang != "en" and self._has_en_decode_head():
                lg_en, en_vocab = self._compute_en_decode_logits_and_vocab(hidden[0])
                cs_res = decode_bilingual_codeswitch(
                    logits[0], active_vocab, active_lang, lg_en, en_vocab, is_partial=is_partial
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

    def _encode_hidden_segment(self, seg_pcm: np.ndarray, sample_rate: int) -> np.ndarray:
        if self.denoise:
            enh = enhance_speech_with_telemetry(seg_pcm, sr=sample_rate)
            proc_pcm = enh.pcm if enh.is_speech_likely else seg_pcm
        else:
            proc_pcm = seg_pcm
        if self.preprocessor_mode == "onnx" and self.preprocessor_session is not None:
            audio_sig = np.ascontiguousarray(proc_pcm.reshape(1, -1), dtype=np.float32)
            length = np.array([len(proc_pcm)], dtype=np.int64)
            outputs = self.preprocessor_session.run(None, {"audio_signal": audio_sig, "length": length})
            feats = outputs[0]
        else:
            feats, _ = extract_log_mel_features(proc_pcm, sr=sample_rate)
        feats_in = np.ascontiguousarray(feats, dtype=np.float32)
        lens_in = np.array([feats.shape[2]], dtype=np.int64)
        return self.acoustic_session.run(  # type: ignore[union-attr]
            ["layer_norm_84"],
            {"audio_signal": feats_in, "length": lens_in},
        )[0]

    def _try_transcribe_multilang_segments(
        self,
        pcm: np.ndarray,
        sample_rate: int,
        use_cs: bool,
        snr_db: Optional[float],
        start_time: float,
        duration_ms: float,
    ) -> Optional[TranscriptionResult]:
        segs = split_pcm_at_pauses(pcm, sr=sample_rate)
        if len(segs) < 2:
            return None

        seg_infos: List[List[object]] = []
        for s0, s1 in segs:
            h = self._encode_hidden_segment(pcm[s0:s1], sample_rate)
            lr, cl = detect_language_from_hidden(
                h, self._multi_heads, self._multi_vocabs, self._lid_weights
            )
            seg_infos.append([s0, s1, h, lr, cl, lr.language])

        for k in range(len(seg_infos)):
            lr_k: LanguageDetectionResult = seg_infos[k][3]  # type: ignore[assignment]
            if lr_k.confidence < 0.65:
                nbr_lg: Optional[str] = (
                    str(seg_infos[k - 1][5])
                    if k > 0
                    else (str(seg_infos[k + 1][5]) if (k + 1) < len(seg_infos) else None)
                )
                if (
                    nbr_lg
                    and lr_k.probabilities.get(nbr_lg, 0.0) >= 0.18
                    and lr_k.confidence < 2.2 * lr_k.probabilities.get(nbr_lg, 0.0)
                ):
                    seg_infos[k][5] = nbr_lg

        agg: Dict[str, float] = {lg: 0.0 for lg in LID_LANGUAGES}
        total_dur = 0.0
        for item in seg_infos:
            s0_i, s1_i, _, lr_i, _, _ = item  # type: ignore[misc]
            dur = float(int(s1_i) - int(s0_i))
            total_dur += dur
            for lg, p in lr_i.probabilities.items():  # type: ignore[attr-defined]
                agg[lg] = agg.get(lg, 0.0) + dur * p

        dom_lg = max(agg.items(), key=lambda kv: kv[1])[0]
        dom_max_conf = max(
            (
                float(item[3].confidence)  # type: ignore[attr-defined]
                for item in seg_infos
                if item[5] == dom_lg
            ),
            default=0.0,
        )

        distinct_langs: set[str] = set()
        for item in seg_infos:
            _, _, _, lr_i, _, eff_lg = item  # type: ignore[misc]
            eff_str = str(eff_lg)
            if eff_str == dom_lg:
                distinct_langs.add(dom_lg)
                continue
            min_req = 0.72 if {eff_str, dom_lg} <= {"sa", "hi", "mr"} else 0.34
            dom_p = float(lr_i.probabilities.get(dom_lg, 0.0))  # type: ignore[attr-defined]
            if float(lr_i.confidence) >= min_req and dom_p < 0.28 and float(lr_i.confidence) >= 2.0 * dom_p:  # type: ignore[attr-defined]
                distinct_langs.add(eff_str)

        if dom_max_conf < 0.34 or len(distinct_langs) < 2:
            return None

        merged_runs: List[List[object]] = []
        for item in seg_infos:
            s0_i, s1_i, h_i, lr_i_m, cl_i, eff_lg = item  # type: ignore[misc]
            if str(eff_lg) in distinct_langs:
                resolved_lg = str(eff_lg)
            else:
                resolved_lg = max(
                    distinct_langs,
                    key=lambda lg: float(lr_i_m.probabilities.get(lg, 0.0)),  # type: ignore[attr-defined]
                )
            if merged_runs and merged_runs[-1][2] == resolved_lg:
                merged_runs[-1][1] = s1_i
                merged_runs[-1][3] = None
            else:
                merged_runs.append([s0_i, s1_i, resolved_lg, (h_i, cl_i)])

        text_parts: List[str] = []
        all_tokens: List[str] = []
        all_en_spans: List[CodeSwitchSpan] = []
        char_cursor = 0

        for m_s0, m_s1, m_lg_obj, cached_pair in merged_runs:
            m_lg = str(m_lg_obj)
            if cached_pair is not None:
                m_h, m_cl = cached_pair  # type: ignore[misc]
            else:
                m_h = self._encode_hidden_segment(pcm[int(m_s0) : int(m_s1)], sample_rate)
                m_cl = {}
            if self._has_lang_decode_head(m_lg):
                lg_2d, seg_vocab = self._compute_lang_decode_logits_and_vocab(m_lg, m_h[0], m_cl)
            else:
                lg_2d = m_cl.get(m_lg)
                if lg_2d is None:
                    w_h, b_h = self._multi_heads[m_lg]
                    lg_2d = m_h[0] @ w_h.T + b_h
                seg_vocab = self._multi_vocabs.get(m_lg, self.vocab)

            seg_text = ""
            seg_tokens: List[str] = []
            seg_spans: List[CodeSwitchSpan] = []
            if use_cs and m_lg != "en" and self._has_en_decode_head():
                lg_en, en_vocab = self._compute_en_decode_logits_and_vocab(m_h[0], m_cl)
                cs = decode_bilingual_codeswitch(
                    lg_2d, seg_vocab, m_lg, lg_en, en_vocab, is_partial=False
                )
                seg_text, seg_tokens, seg_spans = cs.text, cs.tokens, cs.english_spans
            else:
                dec = decode_ctc(lg_2d[None, :, :], vocab=seg_vocab, is_partial=False)
                seg_text, seg_tokens = dec.text, dec.tokens
                if m_lg == "en" and len(distinct_langs) >= 2 and seg_text:
                    w_cur = 0
                    for w_en in seg_text.split():
                        if w_cur > 0:
                            w_cur += 1
                        seg_spans.append(CodeSwitchSpan(word=w_en, start_char=w_cur, end_char=w_cur + len(w_en)))
                        w_cur += len(w_en)

            if not seg_text:
                continue
            if text_parts:
                char_cursor += 1  # space separator
            for sp in seg_spans:
                all_en_spans.append(
                    CodeSwitchSpan(
                        word=sp.word,
                        start_char=char_cursor + sp.start_char,
                        end_char=char_cursor + sp.end_char,
                    )
                )
            text_parts.append(seg_text)
            all_tokens.extend(seg_tokens)
            char_cursor += len(seg_text)

        norm_probs = {lg: (agg[lg] / total_dur if total_dur > 0 else 0.0) for lg in agg}
        elapsed_ms = (time.perf_counter() - start_time) * 1000.0
        return TranscriptionResult(
            text=" ".join(text_parts),
            language=dom_lg,
            duration_ms=duration_ms,
            inference_ms=elapsed_ms,
            rtf=elapsed_ms / duration_ms if duration_ms > 0 else 0.0,
            tokens=all_tokens,
            snr_db=snr_db,
            language_confidence=float(norm_probs.get(dom_lg, dom_max_conf)),
            language_probabilities=norm_probs,
            english_spans=all_en_spans if (use_cs or all_en_spans) else None,
        )
