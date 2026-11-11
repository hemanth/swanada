"""High-level Swanada Speech-to-Text Interface."""

from pathlib import Path
from typing import Optional, Union
import numpy as np

from .audio import load_audio
from .engine import AcousticEngine, TranscriptionResult
from .lid import LanguageDetectionResult
from .vocab import REGISTRY, transliterate_iast


def _find_model_asset(filename: str, model_dir: Optional[Union[str, Path]] = None, subfolder: str = "") -> Optional[Path]:
    candidates = []
    if model_dir:
        md = Path(model_dir)
        if subfolder:
            candidates.append(md / subfolder / filename)
        candidates.append(md / filename)
        # In case model_dir is e.g. models/onnx, check parent
        if subfolder:
            candidates.append(md.parent / subfolder / filename)
        candidates.append(md.parent / filename)

    # Standard repository locations
    repo_models = Path(__file__).resolve().parents[3] / "models"
    if subfolder:
        candidates.append(repo_models / subfolder / filename)
    candidates.append(repo_models / filename)

    for c in candidates:
        if c.exists():
            return c
    return None


class Swanada:
    """Swanada Speech-to-Text Transcriber.

    Zero server dependencies. Client-side inference via ONNX.
    """

    def __init__(
        self,
        language: str = "sa",
        model_dir: Optional[Union[str, Path]] = None,
        num_threads: int = 4,
        preprocessor_mode: str = "analytical",
        tier: str = "studio",
        code_switch_en: bool = False,
        lid_head_path: Optional[Union[str, Path]] = None,
    ):
        self.language = (language or "sa").lower().strip()
        self.code_switch_en = bool(code_switch_en)
        norm_tier = (tier or "studio").lower().strip()
        self.tier = "mobile" if norm_tier == "mobile" else "studio"

        is_auto = self.language == "auto"
        seed_lang = "sa" if is_auto else self.language
        meta = REGISTRY.get(seed_lang)
        vocab_name = meta.vocab_filename if meta else f"{seed_lang}_vocab.json"

        head_path: Optional[Path] = None
        if self.tier == "mobile":
            if is_auto:
                model_path = _find_model_asset("swanada_mobile_ctc_int8.onnx", model_dir, "onnx_mobile")
                if model_path is None:
                    model_path = _find_model_asset("swanada_mobile_sa_ctc_int8.onnx", model_dir, "onnx_mobile")
            else:
                mob_name = f"swanada_mobile_{self.language}_ctc_int8.onnx"
                model_path = _find_model_asset(mob_name, model_dir, "onnx_mobile")
                if model_path is None:
                    shared_mob = _find_model_asset("swanada_mobile_ctc_int8.onnx", model_dir, "onnx_mobile")
                    if shared_mob is not None:
                        model_path = shared_mob
                        if self.language != "sa":
                            head_cand = _find_model_asset(f"{self.language}.bin", model_dir, "heads_mobile")
                            repo_head = Path(__file__).resolve().parents[3] / "docs" / "heads_mobile" / f"{self.language}.bin"
                            if head_cand is not None:
                                head_path = head_cand
                            elif repo_head.exists():
                                head_path = repo_head
        else:
            if is_auto:
                model_path = _find_model_asset("sushrota_sanskrit_ctc_int8.onnx", model_dir, "onnx")
                if model_path is None:
                    model_path = _find_model_asset("swanada_sa_ctc_int8.onnx", model_dir, "onnx")
            else:
                model_name = meta.model_filename if meta else f"swanada_{self.language}_ctc_int8.onnx"
                model_path = _find_model_asset(model_name, model_dir, "onnx")
                if model_path is None:
                    shared_studio = _find_model_asset("sushrota_sanskrit_ctc_int8.onnx", model_dir, "onnx")
                    if shared_studio is not None:
                        model_path = shared_studio
                        if self.language != "sa":
                            head_cand = _find_model_asset(f"{self.language}.bin", model_dir, "heads")
                            repo_head = Path(__file__).resolve().parents[3] / "docs" / "heads" / f"{self.language}.bin"
                            if head_cand is not None:
                                head_path = head_cand
                            elif repo_head.exists():
                                head_path = repo_head

        vocab_path = _find_model_asset(vocab_name, model_dir, "vocabularies")
        if vocab_path is None and seed_lang == "sa":
            vocab_path = _find_model_asset("sanskrit_vocab.json", model_dir, "vocabularies")

        preprocessor_path = _find_model_asset("preprocessor.onnx", model_dir)

        self.engine = AcousticEngine(
            model_path=model_path,
            vocab_path=vocab_path,
            preprocessor_path=preprocessor_path,
            language=self.language,
            num_threads=num_threads,
            preprocessor_mode=preprocessor_mode,
            tier=self.tier,
            head_path=head_path,
            code_switch_en=self.code_switch_en,
            lid_head_path=lid_head_path,
        )

    @staticmethod
    def transliterate_iast(text: str) -> str:
        """Transliterate Classical Sanskrit Devanagari text to Roman IAST with Vedic pitch accents."""
        return transliterate_iast(text)

    @classmethod
    def create(
        cls,
        language: str = "sa",
        model_dir: Optional[Union[str, Path]] = None,
        num_threads: int = 4,
        preprocessor_mode: str = "analytical",
        tier: str = "studio",
        code_switch_en: bool = False,
        lid_head_path: Optional[Union[str, Path]] = None,
    ) -> "Swanada":
        """Factory constructor matching TypeScript API."""
        return cls(
            language=language,
            model_dir=model_dir,
            num_threads=num_threads,
            preprocessor_mode=preprocessor_mode,
            tier=tier,
            code_switch_en=code_switch_en,
            lid_head_path=lid_head_path,
        )

    def detect_language(
        self,
        audio: Union[str, Path, bytes, np.ndarray],
        sample_rate: int = 16000,
    ) -> LanguageDetectionResult:
        """Detect spoken language across all 12 supported languages from audio."""
        return self.engine.detect_language(audio, sample_rate=sample_rate)

    def transcribe(
        self,
        audio: Union[str, Path, bytes, np.ndarray],
        sample_rate: int = 16000,
        code_switch_en: Optional[bool] = None,
    ) -> TranscriptionResult:
        """Transcribe audio input to normalized text."""
        return self.engine.transcribe(
            audio,
            sample_rate=sample_rate,
            code_switch_en=code_switch_en,
        )

    def stream(
        self,
        chunk_size_samples: int = 5120,
        left_context_samples: int = 25600,
        max_buffer_samples: int = 61440,
    ) -> "SwanadaStream":
        """Creates a streaming audio transcription pipeline."""
        from .streaming import SwanadaStream
        return SwanadaStream(
            self.engine,
            chunk_size_samples=chunk_size_samples,
            left_context_samples=left_context_samples,
            max_buffer_samples=max_buffer_samples,
        )

    create_stream = stream

