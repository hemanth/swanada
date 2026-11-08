"""High-level Swanada Speech-to-Text Interface."""

from pathlib import Path
from typing import Optional, Union
import numpy as np

from .audio import load_audio
from .engine import AcousticEngine, TranscriptionResult
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
    ):
        self.language = language

        meta = REGISTRY.get(language)
        model_name = meta.model_filename if meta else f"swanada_{language}_ctc_int8.onnx"
        vocab_name = meta.vocab_filename if meta else f"{language}_vocab.json"

        model_path = _find_model_asset(model_name, model_dir, "onnx")
        if model_path is None and language == "sa":
            model_path = _find_model_asset("sushrota_sanskrit_ctc_int8.onnx", model_dir, "onnx")

        vocab_path = _find_model_asset(vocab_name, model_dir, "vocabularies")
        if vocab_path is None and language == "sa":
            vocab_path = _find_model_asset("sanskrit_vocab.json", model_dir, "vocabularies")

        preprocessor_path = _find_model_asset("preprocessor.onnx", model_dir)

        self.engine = AcousticEngine(
            model_path=model_path,
            vocab_path=vocab_path,
            preprocessor_path=preprocessor_path,
            language=language,
            num_threads=num_threads,
            preprocessor_mode=preprocessor_mode,
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
    ) -> "Swanada":
        """Factory constructor matching TypeScript API."""
        return cls(
            language=language,
            model_dir=model_dir,
            num_threads=num_threads,
            preprocessor_mode=preprocessor_mode,
        )

    def transcribe(
        self,
        audio: Union[str, Path, bytes, np.ndarray],
        sample_rate: int = 16000,
    ) -> TranscriptionResult:
        """Transcribe audio input to normalized text."""
        return self.engine.transcribe(audio, sample_rate=sample_rate)

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

