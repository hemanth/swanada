"""Deterministic Log-Mel Spectrogram Frontend in Python.

Bit-for-bit analytical equivalent to NeMo FilterbankFeatures / preprocessor.onnx.
"""

from pathlib import Path
from typing import Optional, Tuple, Union
import numpy as np

N_FFT = 512
WIN_LENGTH = 400
HOP_LENGTH = 160
N_MELS = 80
SAMPLE_RATE = 16000
PREEMPH_COEFF = 0.97
LOG_EPSILON = 5.960464477539063e-08  # 2^-24
CMVN_FLOOR = 1e-05


def hz_to_mel(f: float) -> float:
    """Convert Hz to Slaney mel scale."""
    f_sp = 200.0 / 3.0
    if f < 1000.0:
        return f / f_sp
    min_log_mel = 15.0
    logstep = np.log(6.4) / 27.0
    return min_log_mel + np.log(f / 1000.0) / logstep


def mel_to_hz(m: float) -> float:
    """Convert Slaney mel scale to Hz."""
    f_sp = 200.0 / 3.0
    if m < 15.0:
        return m * f_sp
    min_log_mel = 15.0
    logstep = np.log(6.4) / 27.0
    return 1000.0 * np.exp(logstep * (m - min_log_mel))


def create_mel_filterbank(
    sr: int = SAMPLE_RATE,
    n_fft: int = N_FFT,
    n_mels: int = N_MELS,
    fmin: float = 0.0,
    fmax: float = 8000.0,
) -> np.ndarray:
    """Construct Slaney area-normalized mel filterbank matrix [80, 257]."""
    num_freqs = n_fft // 2 + 1  # 257
    min_mel = hz_to_mel(fmin)
    max_mel = hz_to_mel(fmax)
    mel_points = np.array(
        [mel_to_hz(min_mel + (i / (n_mels + 1)) * (max_mel - min_mel)) for i in range(n_mels + 2)],
        dtype=np.float64,
    )
    fft_freqs = np.linspace(0, sr // 2, num_freqs, dtype=np.float64)

    weights = np.zeros((n_mels, num_freqs), dtype=np.float32)
    for i in range(n_mels):
        f_prev = mel_points[i]
        f_center = mel_points[i + 1]
        f_next = mel_points[i + 2]
        enorm = 2.0 / (f_next - f_prev)

        for j in range(num_freqs):
            freq = fft_freqs[j]
            w = 0.0
            if f_prev <= freq <= f_center:
                w = (freq - f_prev) / (f_center - f_prev)
            elif f_center < freq <= f_next:
                w = (f_next - freq) / (f_next - f_center)
            weights[i, j] = max(0.0, w) * enorm

    return weights


def create_padded_hann_window(
    win_length: int = WIN_LENGTH,
    n_fft: int = N_FFT,
) -> np.ndarray:
    """Construct 400-point periodic=False Hann window padded symmetrically into 512."""
    n = np.arange(win_length, dtype=np.float64)
    w = 0.5 * (1.0 - np.cos(2.0 * np.pi * n / (win_length - 1)))
    pad_left = (n_fft - win_length) // 2
    pad_right = n_fft - win_length - pad_left
    return np.pad(w, (pad_left, pad_right)).astype(np.float32)


# Precomputed static filterbank and window
STATIC_WINDOW = create_padded_hann_window(WIN_LENGTH, N_FFT)
STATIC_MEL_FB = create_mel_filterbank(SAMPLE_RATE, N_FFT, N_MELS)


def extract_log_mel_features(
    pcm: np.ndarray,
    sr: int = SAMPLE_RATE,
) -> Tuple[np.ndarray, int]:
    """Analytical equivalent of preprocessor.onnx.

    Returns:
        features: ndarray of shape [1, 80, num_frames], float32
        feature_length: int, valid frame count T = len(pcm) // 160
    """
    if sr != SAMPLE_RATE:
        raise ValueError(f"extract_log_mel_features expects 16000 Hz, got {sr} Hz")

    pcm = pcm.astype(np.float32)
    N = len(pcm)
    if N == 0:
        return np.zeros((1, N_MELS, 0), dtype=np.float32), 0

    T = N // HOP_LENGTH
    num_frames = T + 1

    # 1. Pre-emphasis
    x = pcm.copy()
    x[1:] = x[1:] - PREEMPH_COEFF * x[:-1]

    # 2. Centered padding (256 samples on each side)
    x_padded = np.pad(x, (N_FFT // 2, N_FFT // 2), mode="constant")

    # 3. Framing & Windowing
    frames = np.empty((num_frames, N_FFT), dtype=np.float32)
    for t in range(num_frames):
        start = t * HOP_LENGTH
        frames[t] = x_padded[start : start + N_FFT] * STATIC_WINDOW

    # STFT & Power spectrum
    fft_spec = np.fft.rfft(frames, n=N_FFT, axis=-1)
    power_spec = (np.real(fft_spec) ** 2 + np.imag(fft_spec) ** 2).T  # [257, num_frames]

    # 4. Mel Filterbank Projection & Logarithm
    mel_power = np.matmul(STATIC_MEL_FB, power_spec)  # [80, num_frames]
    log_mel = np.log(mel_power + LOG_EPSILON)

    # 5. Utterance-level CMVN
    if T <= 1:
        normed = np.zeros_like(log_mel)
        return normed[np.newaxis, :, :].astype(np.float32), T

    valid_log = log_mel[:, :T]
    mean = np.mean(valid_log, axis=1, keepdims=True, dtype=np.float64)
    var = np.sum((valid_log.astype(np.float64) - mean) ** 2, axis=1, keepdims=True) / (T - 1)
    std = np.sqrt(var)
    std = np.where(np.isnan(std), 0.0, std)

    normed = (log_mel.astype(np.float64) - mean) / (std + CMVN_FLOOR)
    normed[:, T:] = 0.0

    return normed[np.newaxis, :, :].astype(np.float32), T


def extract_log_mel_onnx(
    pcm: np.ndarray,
    model_path: Optional[Union[str, Path]] = None,
) -> Tuple[np.ndarray, int]:
    """Extract log-mel spectrogram using reference preprocessor.onnx."""
    import onnxruntime as ort

    if model_path is None:
        candidate = Path(__file__).resolve().parents[3] / "models" / "preprocessor.onnx"
        if not candidate.exists():
            candidate = Path("/Users/lika/labs/sushrota-sanskrit-asr/models/preprocessor.onnx")
        model_path = str(candidate)

    sess = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
    audio_sig = np.ascontiguousarray(pcm.reshape(1, -1), dtype=np.float32)
    length = np.array([len(pcm)], dtype=np.int64)

    outputs = sess.run(None, {"audio_signal": audio_sig, "length": length})
    features = outputs[0]  # [1, 80, num_frames]
    feat_len = int(outputs[1][0])
    return features.astype(np.float32), feat_len
