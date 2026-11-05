"""Audio loading, resampling, and WAV serialization for Swanada."""

import io
import math
from pathlib import Path
from typing import Tuple, Union
import numpy as np


def resample_audio(
    wav: np.ndarray,
    src_sr: int,
    target_sr: int = 16000,
) -> np.ndarray:
    """Resample audio signal to target sample rate.

    Uses polyphase FIR resampling (scipy.signal.resample_poly) with GCD reduction,
    falling back to linear interpolation if scipy is unavailable.
    """
    if src_sr == target_sr:
        return wav.astype(np.float32)

    if len(wav) == 0:
        return np.zeros(0, dtype=np.float32)

    try:
        import scipy.signal
        g = math.gcd(target_sr, src_sr)
        up = target_sr // g
        down = src_sr // g
        resampled = scipy.signal.resample_poly(wav, up, down)
        return resampled.astype(np.float32)
    except Exception:
        num_samples = max(1, int(round(len(wav) * target_sr / src_sr)))
        t_in = np.arange(len(wav))
        t_out = np.linspace(0, len(wav) - 1, num_samples)
        return np.interp(t_out, t_in, wav).astype(np.float32)


def load_audio(
    source: Union[str, Path, bytes, np.ndarray],
    target_sr: int = 16000,
) -> np.ndarray:
    """Load audio from file path, bytes, or ndarray, converting to 16 kHz mono Float32."""
    sr = target_sr

    if isinstance(source, (str, Path)):
        import soundfile as sf
        wav, sr = sf.read(str(source), dtype="float32")
    elif isinstance(source, (bytes, bytearray)):
        import soundfile as sf
        wav, sr = sf.read(io.BytesIO(source), dtype="float32")
    elif isinstance(source, np.ndarray):
        wav = source.astype(np.float32)
    else:
        raise TypeError(f"Unsupported audio input type: {type(source)}")

    # Downmix multi-channel to mono
    if wav.ndim > 1:
        wav = np.mean(wav, axis=1 if wav.shape[1] < wav.shape[0] else 0)

    # Scale integer PCM if unnormalized
    if np.issubdtype(wav.dtype, np.integer):
        wav = wav.astype(np.float32) / 32768.0

    # Resample if sample rate differs
    if sr != target_sr:
        wav = resample_audio(wav, sr, target_sr)

    return wav.astype(np.float32)


def parse_wav(data: bytes) -> Tuple[np.ndarray, int]:
    """Parse raw WAV byte stream into mono Float32 array and sample rate."""
    import soundfile as sf
    wav, sr = sf.read(io.BytesIO(data), dtype="float32")
    if wav.ndim > 1:
        wav = np.mean(wav, axis=1)
    return wav.astype(np.float32), sr


def save_wav(
    path: Union[str, Path],
    pcm: np.ndarray,
    sample_rate: int = 16000,
) -> None:
    """Save Float32 audio as 16-bit PCM WAV."""
    import soundfile as sf
    sf.write(str(path), pcm.astype(np.float32), sample_rate, subtype="PCM_16")
