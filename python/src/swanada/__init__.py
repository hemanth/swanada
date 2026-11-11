"""Swanada: In-browser & multi-runtime 16 kHz Multilingual Speech-to-Text."""

__version__ = "1.1.0"

from .audio import (
    load_audio,
    resample_audio,
    parse_wav,
    save_wav,
)
from .frontend import (
    extract_log_mel_features,
    extract_log_mel_onnx,
    create_mel_filterbank,
    create_padded_hann_window,
    hz_to_mel,
    mel_to_hz,
)
from .normalizer import (
    dedup_marks,
    repair_brahmic_orthography,
    normalize_indic_text,
    assemble_text,
    join_subwords,
)
from .denoise import (
    DenoiseTelemetry,
    enhance_speech_with_telemetry,
    denoise_pcm_16k,
)
from .decoder import (
    decode_ctc,
    decode_ctc_tokens,
    is_special_token,
    CTCDecodeResult,
    CTCGreedyDecoder,
)
from .engine import (
    AcousticEngine,
    TranscriptionResult,
)
from .lid import (
    LID_LANGUAGES,
    LanguageDetectionResult,
    CodeSwitchSpan,
    CodeSwitchDecodeResult,
    NeuralLIDWeights,
    parse_lid_head_bytes,
    serialize_lid_head_bytes,
    detect_language_from_hidden,
    decode_bilingual_codeswitch,
)
from .core import (
    Swanada,
)
from .vocab import (
    REGISTRY,
    Vocabulary,
    LanguageMeta,
    detect_script,
    devanagari_to_iast,
    transliterate_iast,
    SUPPORTED_LANGUAGES,
    BLANK_TOKEN_ID,
    UNK_TOKEN_ID,
)
from .streaming import (
    StreamingCTCDecoder,
    StreamingTranscript,
    SwanadaStream,
)

__all__ = [
    "__version__",
    "Swanada",
    "SwanadaStream",
    "StreamingCTCDecoder",
    "StreamingTranscript",
    "TranscriptionResult",
    "AcousticEngine",
    "REGISTRY",
    "Vocabulary",
    "LanguageMeta",
    "detect_script",
    "devanagari_to_iast",
    "transliterate_iast",
    "SUPPORTED_LANGUAGES",
    "BLANK_TOKEN_ID",
    "UNK_TOKEN_ID",
    "load_audio",
    "resample_audio",
    "parse_wav",
    "save_wav",
    "extract_log_mel_features",
    "extract_log_mel_onnx",
    "create_mel_filterbank",
    "create_padded_hann_window",
    "hz_to_mel",
    "mel_to_hz",
    "dedup_marks",
    "repair_brahmic_orthography",
    "normalize_indic_text",
    "assemble_text",
    "join_subwords",
    "DenoiseTelemetry",
    "enhance_speech_with_telemetry",
    "denoise_pcm_16k",
    "decode_ctc",
    "decode_ctc_tokens",
    "is_special_token",
    "CTCDecodeResult",
    "CTCGreedyDecoder",
    "LID_LANGUAGES",
    "LanguageDetectionResult",
    "CodeSwitchSpan",
    "CodeSwitchDecodeResult",
    "NeuralLIDWeights",
    "parse_lid_head_bytes",
    "serialize_lid_head_bytes",
    "detect_language_from_hidden",
    "decode_bilingual_codeswitch",
]
