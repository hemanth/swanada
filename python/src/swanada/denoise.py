"""Multi-Stage Real-Time ASR Background Noise Cancellation & Speech Enhancement Layer (Python).

Matches the TypeScript/Browser DSP pipeline (js/src/audio/denoise.ts):
1. DC Offset Removal + 80 Hz 2nd-Order Butterworth High-Pass Filter
2. 50 Hz & 60 Hz High-Q Power-Line Hum Notch Biquads
3. SNR-Adaptive Ephraim-Malah Decision-Directed Spectral Wiener Filter (512-pt sqrt-Hann exact NOLA)
4. Formant-Band Stationary Non-Speech Gate & Peak Safety Limiter
"""

from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Tuple
import numpy as np

STFT_N = 512
STFT_HOP = 256
NUM_BINS = 257
SAMPLE_RATE = 16000

_SQRT_HANN_512 = np.sqrt(
    np.maximum(0.0, 0.5 * (1.0 - np.cos(2.0 * np.pi * np.arange(STFT_N, dtype=np.float64) / STFT_N)))
).astype(np.float32)


@dataclass
class DenoiseTelemetry:
    pcm: np.ndarray
    estimated_snr_db: float
    noise_floor_dbfs: float
    suppression_db: float
    is_speech_likely: bool


def _design_highpass_biquad(fc: float, sr: int, q: float = math.sqrt(0.5)) -> Tuple[float, float, float, float, float]:
    omega = 2.0 * math.pi * fc / sr
    sin_w = math.sin(omega)
    cos_w = math.cos(omega)
    alpha = sin_w / (2.0 * q)
    b0 = (1.0 + cos_w) * 0.5
    b1 = -(1.0 + cos_w)
    b2 = (1.0 + cos_w) * 0.5
    a0 = 1.0 + alpha
    a1 = -2.0 * cos_w
    a2 = 1.0 - alpha
    return (b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)


def _design_notch_biquad(f0: float, sr: int, q: float = 22.0) -> Tuple[float, float, float, float, float]:
    omega = 2.0 * math.pi * f0 / sr
    sin_w = math.sin(omega)
    cos_w = math.cos(omega)
    alpha = sin_w / (2.0 * q)
    b0 = 1.0
    b1 = -2.0 * cos_w
    b2 = 1.0
    a0 = 1.0 + alpha
    a1 = -2.0 * cos_w
    a2 = 1.0 - alpha
    return (b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)


def _apply_biquad(x: np.ndarray, coeffs: Tuple[float, float, float, float, float]) -> np.ndarray:
    b0, b1, b2, a1, a2 = coeffs
    y = np.empty_like(x, dtype=np.float32)
    x1 = 0.0
    x2 = 0.0
    y1 = 0.0
    y2 = 0.0
    for i in range(len(x)):
        xi = float(x[i])
        yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2 = x1
        x1 = xi
        y2 = y1
        y1 = yi
        y[i] = yi
    return y


def _compute_stft(signal: np.ndarray) -> Tuple[np.ndarray, np.ndarray, int, int]:
    n_samples = len(signal)
    pad = STFT_HOP
    padded_len = n_samples + 2 * pad + STFT_N
    num_frames = (n_samples + 2 * pad - STFT_N) // STFT_HOP + 1
    padded = np.zeros(padded_len, dtype=np.float32)
    padded[pad:pad + n_samples] = signal
    frame_starts = np.arange(num_frames) * STFT_HOP
    frames = padded[frame_starts[:, None] + np.arange(STFT_N)[None, :]] * _SQRT_HANN_512[None, :]
    spec = np.fft.rfft(frames, n=STFT_N, axis=1)
    power = (spec.real ** 2 + spec.imag ** 2).astype(np.float32)
    return spec, power, num_frames, padded_len


def enhance_speech_with_telemetry(
    pcm: np.ndarray,
    sr: int = SAMPLE_RATE,
    high_pass_hz: float = 80.0,
    hum_notch: bool = True,
    spectral_denoise: bool = True,
    clean_bypass_snr_db: float = 26.0,
    spectral_floor: float = 0.14,
    non_speech_gate: bool = True,
    adaptive_gain: bool = False,
) -> DenoiseTelemetry:
    arr = np.asarray(pcm, dtype=np.float32).reshape(-1)
    n_samples = len(arr)
    if n_samples == 0:
        return DenoiseTelemetry(arr.copy(), 0.0, -100.0, 0.0, False)

    dc_mean = float(np.mean(arr))
    raw_rms = float(np.sqrt(np.mean(arr * arr)))
    if raw_rms < 1e-4:
        return DenoiseTelemetry(np.zeros_like(arr), 0.0, -100.0, 0.0, False)

    zero_mean = (arr - dc_mean).astype(np.float32)
    ac_rms = float(np.sqrt(np.mean(zero_mean * zero_mean)))
    has_dc_offset = abs(dc_mean) > 0.015

    if n_samples < STFT_N:
        if has_dc_offset:
            work = _apply_biquad(zero_mean, _design_highpass_biquad(high_pass_hz, sr))
            if hum_notch and sr >= 4000:
                work = _apply_biquad(work, _design_notch_biquad(50.0, sr, 22.0))
                work = _apply_biquad(work, _design_notch_biquad(60.0, sr, 22.0))
            return DenoiseTelemetry(work, 20.0, 20.0 * math.log10(max(ac_rms * 0.1, 1e-5)), 6.0, True)
        return DenoiseTelemetry(arr.copy(), 35.0, -70.0, 0.0, True)

    # Pre-scan interior STFT frames to detect stationary mains hum/rumble vs clean studio audio
    raw_spec, raw_power, num_frames, padded_len = _compute_stft(zero_mean)
    norm_scale = 1.0 / (STFT_HOP * STFT_N)  # Parseval RMS^2 normalization for sqrt-Hann N=512, hop=256
    i_start = 1 if num_frames > 4 else 0
    i_end = num_frames - 1 if num_frames > 4 else num_frames
    int_power = raw_power[i_start:i_end] * norm_scale

    # Sub-85 Hz bins (0..2 at 16 kHz / 512) detect 50/60 Hz mains hum and HVAC/wind rumble
    k_lf_max = max(2, round(85 * STFT_N / sr))
    lf_frame_rms = np.sqrt(np.sum(int_power[:, :k_lf_max + 1], axis=1))
    lf_p30 = float(np.percentile(lf_frame_rms, 30))
    lf_mean = float(np.mean(lf_frame_rms))
    has_hum_or_rumble = has_dc_offset or (lf_p30 > 0.0075 and (lf_mean / (ac_rms + 1e-9)) > 0.16)

    if has_hum_or_rumble:
        work = _apply_biquad(zero_mean, _design_highpass_biquad(high_pass_hz, sr))
        if hum_notch and sr >= 4000:
            work = _apply_biquad(work, _design_notch_biquad(50.0, sr, 22.0))
            work = _apply_biquad(work, _design_notch_biquad(60.0, sr, 22.0))
        if not spectral_denoise:
            post_lf_rms = float(np.sqrt(np.mean(work * work))) + 1e-9
            supp = max(0.0, 20.0 * math.log10(max(raw_rms, 1e-9) / post_lf_rms))
            return DenoiseTelemetry(work, 22.0, -50.0, supp, True)
        spec, power, num_frames, padded_len = _compute_stft(work)
        int_power = power[i_start:i_end] * norm_scale
    else:
        work = arr
        if not spectral_denoise:
            return DenoiseTelemetry(arr.copy(), 35.0, -70.0, 0.0, True)
        spec, power = raw_spec, raw_power

    k_min = max(3, round(250 * STFT_N / sr))
    k_max = min(NUM_BINS - 1, round(3800 * STFT_N / sr))
    k_hf_min = min(NUM_BINS - 8, max(k_min + 8, round(3500 * STFT_N / sr)))
    k_hf_max = min(NUM_BINS - 2, round(7800 * STFT_N / sr))

    speech_energy = np.sum(power[:, k_min:k_max + 1], axis=1)
    total_energy = np.sum(power, axis=1)

    interior_idx = np.arange(i_start, i_end)
    order = interior_idx[np.argsort(total_energy[interior_idx])]
    interior_count = len(order)

    n_quiet = max(1, int(interior_count * 0.2))
    idx90 = order[min(interior_count - 1, int(interior_count * 0.9))]
    idx15 = order[min(interior_count - 1, int(interior_count * 0.15))]

    e_speech_90 = float(speech_energy[idx90])
    e_noise_15 = max(1e-12, float(speech_energy[idx15]))
    mod_snr_db = max(0.0, min(60.0, 10.0 * math.log10((e_speech_90 + 1e-12) / e_noise_15)))

    # Spectral Flatness Measure (Wiener entropy) + High-Frequency Floor distinguish broadband noise from harmonic speech
    hf_rms = np.sqrt(np.sum(int_power[:, k_hf_min:k_hf_max + 1], axis=1))
    hf_p25 = float(np.percentile(hf_rms, 25))
    sub_bins = int_power[:, max(8, k_min):k_hf_max + 1] + 1e-18
    frame_sfm = np.exp(np.mean(np.log(sub_bins), axis=1)) / np.mean(sub_bins, axis=1)
    sfm_p30 = float(np.percentile(frame_sfm, 30))

    upper_half = order[interior_count // 2:]
    avg_formant_ratio = float(np.mean(speech_energy[upper_half] / (total_energy[upper_half] + 1e-12)))

    # Stationary Non-Speech Gate: pure unmodulated background hiss/buzz
    if (
        non_speech_gate
        and num_frames >= 10
        and mod_snr_db < 2.2
        and ac_rms < 0.025
        and avg_formant_ratio < 0.52
    ):
        return DenoiseTelemetry(
            np.zeros_like(arr),
            mod_snr_db,
            20.0 * math.log10(max(ac_rms, 1e-5)),
            40.0,
            False,
        )

    # Determine whether genuine broadband/colored background noise is present.
    # Require >= 300ms (4800 samples) so a single clean syllable is never mistaken for stationary noise.
    quiet_rms_p15 = float(np.sqrt(np.sum(int_power[np.argsort(np.sum(int_power[:, 3:], axis=1))[int(interior_count * 0.15)], 3:])))
    has_broadband_noise = (
        n_samples >= 4800
        and mod_snr_db < clean_bypass_snr_db
        and (
            (hf_p25 > 0.0024 and sfm_p30 > 0.032)
            or (n_samples >= 12000 and mod_snr_db < 22.0 and quiet_rms_p15 > 0.0045 and sfm_p30 > 0.022)
        )
    )

    if not has_broadband_noise:
        effective_snr = max(mod_snr_db, 32.0) if not has_hum_or_rumble else max(mod_snr_db, 20.0)
        supp_db = 0.0
        if has_hum_or_rumble:
            post_rms_h = float(np.sqrt(np.mean(work * work))) + 1e-9
            supp_db = max(0.0, 20.0 * math.log10(max(raw_rms, 1e-9) / post_rms_h))
        return DenoiseTelemetry(
            work.copy() if work is arr else work,
            effective_snr,
            20.0 * math.log10(max(ac_rms * (10.0 ** (-effective_snr / 20.0)), 1e-5)),
            supp_db,
            True,
        )

    # Hybrid quiet-frame + unbiased Rayleigh 25th-percentile minimum-statistics noise PSD (-1/ln(0.75) = 3.476)
    quiet_mean_psd = np.mean(power[order[:n_quiet]], axis=0)
    per_bin_min_stat_psd = np.percentile(power[i_start:i_end], 25, axis=0) * 3.48
    noise_psd = np.maximum(1e-12, np.minimum(quiet_mean_psd * 1.25, per_bin_min_stat_psd))

    est_snr_db = mod_snr_db
    strength = max(0.0, min(1.0, (clean_bypass_snr_db - est_snr_db) / 8.0))
    oversub = 1.0 + 0.85 * strength
    g_min = 1.0 - (1.0 - max(0.05, min(1.0, spectral_floor))) * strength
    dd_beta = 0.92

    prev_gain = np.ones(NUM_BINS, dtype=np.float32)
    prev_gamma = np.ones(NUM_BINS, dtype=np.float32)
    gains = np.empty((num_frames, NUM_BINS), dtype=np.float32)

    for t in range(num_frames):
        gamma = power[t] / noise_psd
        inst_xi = np.maximum(gamma - 1.0, 0.0)
        xi = dd_beta * (prev_gain * prev_gain) * prev_gamma + (1.0 - dd_beta) * inst_xi
        raw_g = np.maximum(g_min, xi / (xi + oversub))

        smooth_g = np.empty_like(raw_g)
        smooth_g[0] = 0.75 * raw_g[0] + 0.25 * raw_g[1]
        smooth_g[1:-1] = 0.2 * raw_g[:-2] + 0.6 * raw_g[1:-1] + 0.2 * raw_g[2:]
        smooth_g[-1] = 0.25 * raw_g[-2] + 0.75 * raw_g[-1]

        gains[t] = smooth_g
        prev_gain = smooth_g
        prev_gamma = gamma

    pad = STFT_HOP
    enhanced_frames = np.fft.irfft(spec * gains, n=STFT_N, axis=1).astype(np.float32) * _SQRT_HANN_512[None, :]
    out_overlap = np.zeros(padded_len, dtype=np.float32)
    for t in range(num_frames):
        s = t * STFT_HOP
        out_overlap[s:s + STFT_N] += enhanced_frames[t]

    enhanced = out_overlap[pad:pad + n_samples].copy()
    post_rms = float(np.sqrt(np.mean(enhanced * enhanced)))
    if adaptive_gain and 0.002 < post_rms < 0.035 and est_snr_db >= 5.0:
        gain = min(2.4, 0.045 / post_rms)
        scaled = enhanced * gain
        enhanced = np.where(np.abs(scaled) > 0.9, np.tanh(scaled), scaled).astype(np.float32)
    else:
        enhanced = np.clip(enhanced, -1.0, 1.0)

    noise_floor_rms = ac_rms * (10.0 ** (-est_snr_db / 20.0))
    suppression_db = abs(20.0 * math.log10(max(g_min, 1e-3)))
    return DenoiseTelemetry(
        enhanced,
        est_snr_db,
        20.0 * math.log10(max(noise_floor_rms, 1e-5)),
        suppression_db,
        True,
    )


def denoise_pcm_16k(pcm: np.ndarray, **kwargs) -> np.ndarray:
    return enhance_speech_with_telemetry(pcm, **kwargs).pcm
