"""Unit tests for Swanada Audio Ingestion, Resampling, and Deterministic Log-Mel Frontend."""

import math
from pathlib import Path
import numpy as np
import pytest

from swanada.audio import load_audio, parse_wav, resample_audio, save_wav
from swanada.frontend import (
    CMVN_FLOOR,
    HOP_LENGTH,
    N_FFT,
    N_MELS,
    PREEMPH_COEFF,
    SAMPLE_RATE,
    STATIC_MEL_FB,
    STATIC_WINDOW,
    WIN_LENGTH,
    create_mel_filterbank,
    create_padded_hann_window,
    extract_log_mel_features,
    extract_log_mel_onnx,
    hz_to_mel,
    mel_to_hz,
)

REPO_ROOT = Path(__file__).resolve().parents[1]
REFERENCE_PREPROCESSOR = REPO_ROOT / "models" / "preprocessor.onnx"
TEST_WAV = Path("/Users/lika/labs/ninada/data/wavs/sa_rasa_male_01445fb1731b.wav")


def test_hz_to_mel_and_inverse() -> None:
    """Verify Slaney mel scale conversion and invertibility across acoustic range."""
    freqs = [0.0, 100.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0]
    for f in freqs:
        m = hz_to_mel(f)
        f_rec = mel_to_hz(m)
        assert abs(f - f_rec) < 1e-4, f"Mel inversion failed for {f} Hz: got {f_rec}"


def test_mel_filterbank_matrix_contract() -> None:
    """Verify filterbank dimensions, non-negativity, and Slaney area normalization."""
    fb = create_mel_filterbank(sr=16000, n_fft=512, n_mels=80)
    assert fb.shape == (80, 257)
    assert np.all(fb >= 0.0)

    # All 80 channels must have non-zero energy
    channel_sums = np.sum(fb, axis=1)
    assert np.all(channel_sums > 0.0)

    # Static filterbank must match dynamic creation
    assert np.allclose(fb, STATIC_MEL_FB, atol=1e-7)


def test_mel_filterbank_onnx_initializer_parity() -> None:
    """Assert analytical Mel filterbank matches ONNX featurizer.fb within float32 tolerance."""
    if not REFERENCE_PREPROCESSOR.exists():
        pytest.skip("preprocessor.onnx not found")

    import onnx
    from onnx import numpy_helper

    model = onnx.load(str(REFERENCE_PREPROCESSOR))
    init_map = {init.name: numpy_helper.to_array(init) for init in model.graph.initializer}
    onnx_fb = init_map["featurizer.fb"][0]  # [80, 257]

    max_diff = np.max(np.abs(STATIC_MEL_FB - onnx_fb))
    assert max_diff < 1e-7, f"Filterbank difference vs ONNX featurizer.fb: {max_diff}"


def test_padded_hann_window_contract() -> None:
    """Verify 400-point periodic=False Hann window padded into 512."""
    win = create_padded_hann_window(400, 512)
    assert len(win) == 512
    # First 56 and last 56 samples must be strictly 0.0
    assert np.all(win[:56] == 0.0)
    assert np.all(win[456:] == 0.0)
    # Center 400 samples must be symmetric Hann window with peak at center
    active = win[56:456]
    assert abs(active[0] - 0.0) < 1e-6
    assert abs(active[-1] - 0.0) < 1e-6
    assert abs(np.max(active) - 1.0) < 1e-4


def test_padded_hann_window_onnx_parity() -> None:
    """Assert analytical Hann window matches ONNX val_78 initializer."""
    if not REFERENCE_PREPROCESSOR.exists():
        pytest.skip("preprocessor.onnx not found")

    import onnx
    from onnx import numpy_helper

    model = onnx.load(str(REFERENCE_PREPROCESSOR))
    init_map = {init.name: numpy_helper.to_array(init) for init in model.graph.initializer}
    onnx_win = init_map["val_78"]

    max_diff = np.max(np.abs(STATIC_WINDOW - onnx_win))
    assert max_diff < 1e-6, f"Window difference vs ONNX val_78: {max_diff}"


def test_wav_ingestion_and_roundtrip(tmp_path: Path) -> None:
    """Verify saving and parsing 16-bit PCM WAV audio."""
    dur = 0.5
    t = np.linspace(0, dur, int(16000 * dur), endpoint=False, dtype=np.float32)
    pcm_orig = 0.7 * np.sin(2 * np.pi * 440.0 * t)

    wav_file = tmp_path / "test_tone.wav"
    save_wav(wav_file, pcm_orig, sample_rate=16000)

    pcm_loaded = load_audio(wav_file, target_sr=16000)
    assert len(pcm_loaded) == len(pcm_orig)
    # 16-bit quantization error bound: 1 / 32768 ~ 3.05e-5
    max_err = np.max(np.abs(pcm_orig - pcm_loaded))
    assert max_err < 1e-4


def test_resampling_ratios() -> None:
    """Verify resampling across 44.1k, 48k, 8k, and 24k to 16 kHz."""
    dur = 0.25
    for src_sr in [44100, 48000, 8000, 24000]:
        t = np.linspace(0, dur, int(src_sr * dur), endpoint=False, dtype=np.float32)
        pcm_src = np.sin(2 * np.pi * 300.0 * t)

        pcm_16k = resample_audio(pcm_src, src_sr, target_sr=16000)
        expected_len = int(round(dur * 16000))
        assert abs(len(pcm_16k) - expected_len) <= 1, f"Length mismatch for src_sr={src_sr}"


def test_stereo_to_mono_downmixing() -> None:
    """Verify multi-channel stereo downmix performs arithmetic average."""
    stereo = np.array([
        [0.4, 0.2],
        [-0.6, 0.6],
        [0.8, -0.4],
    ], dtype=np.float32)

    mono = load_audio(stereo, target_sr=16000)
    assert mono.ndim == 1
    assert len(mono) == 3
    assert abs(mono[0] - 0.3) < 1e-6
    assert abs(mono[1] - 0.0) < 1e-6
    assert abs(mono[2] - 0.2) < 1e-6


def test_log_mel_frontend_shape_and_framing() -> None:
    """Verify output shape [1, 80, num_frames] and frame count T = len // 160."""
    pcm = np.zeros(32000, dtype=np.float32)
    feats, T = extract_log_mel_features(pcm)
    assert feats.shape == (1, 80, 201)
    assert T == 200
    assert feats.dtype == np.float32


def test_log_mel_frontend_cmvn_normalization() -> None:
    """Verify CMVN produces zero mean and unit variance over valid frames."""
    t = np.linspace(0, 1.0, 16000, endpoint=False, dtype=np.float32)
    pcm = 0.5 * np.sin(2 * np.pi * 440.0 * t) + 0.3 * np.sin(2 * np.pi * 1200.0 * t)

    feats, T = extract_log_mel_features(pcm)
    valid_feats = feats[0, :, :T]  # [80, T]

    # Means across time for each channel should be approximately 0.0
    means = np.mean(valid_feats, axis=1)
    assert np.all(np.abs(means) < 1e-4)

    # Standard deviations across time for active channels should be close to 1.0
    stds = np.std(valid_feats, axis=1, ddof=1)
    # Check channels with active signal energy
    active_channels = stds > 0.05
    assert np.all(np.abs(stds[active_channels] - 1.0) < 1e-3)

    # Trailing padding frames (t >= T) must be strictly 0.0
    assert np.all(feats[0, :, T:] == 0.0)


def test_log_mel_frontend_bit_level_parity_real_speech() -> None:
    """Verify bit-level mathematical parity against preprocessor.onnx (< 5e-5 max difference)."""
    if not REFERENCE_PREPROCESSOR.exists():
        pytest.skip("preprocessor.onnx not found")
    if not TEST_WAV.exists():
        pytest.skip("Test WAV file not found")

    import soundfile as sf
    pcm, sr = sf.read(str(TEST_WAV), dtype="float32")

    feats_py, T_py = extract_log_mel_features(pcm)
    feats_onnx, T_onnx = extract_log_mel_onnx(pcm, REFERENCE_PREPROCESSOR)

    assert T_py == T_onnx
    assert feats_py.shape == feats_onnx.shape

    abs_diff = np.abs(feats_py - feats_onnx)
    max_diff = float(np.max(abs_diff))
    mean_diff = float(np.mean(abs_diff))

    print(f"\nReal Speech Parity: max_diff={max_diff:.3e}, mean_diff={mean_diff:.3e}")
    assert max_diff < 5e-5, f"Log-mel parity exceeded 5e-5 tolerance: max_diff={max_diff}"
    assert mean_diff < 1e-6, f"Mean difference exceeded 1e-6 tolerance: mean_diff={mean_diff}"


def test_edge_case_empty_and_short_audio() -> None:
    """Verify graceful handling of empty and extremely short audio signals."""
    empty_pcm = np.zeros(0, dtype=np.float32)
    feats, T = extract_log_mel_features(empty_pcm)
    assert feats.shape == (1, 80, 0)
    assert T == 0

    short_pcm = np.zeros(80, dtype=np.float32)
    feats_short, T_short = extract_log_mel_features(short_pcm)
    assert feats_short.shape == (1, 80, 1)
    assert T_short == 0


def test_digital_silence_float64_cmvn_zero_features() -> None:
    """Verify Float64 accumulation in CMVN yields exactly 0.0 features on pure digital silence."""
    for n_samples in [16000, 48000]:  # 1s and 3s
        silence = np.zeros(n_samples, dtype=np.float32)
        feats, T = extract_log_mel_features(silence)
        assert feats.shape == (1, 80, (n_samples // 160) + 1)
        assert T == n_samples // 160
        assert not np.isnan(feats).any()
        assert not np.isinf(feats).any()
        assert np.max(np.abs(feats)) == 0.0
        assert np.all(feats == 0.0)
