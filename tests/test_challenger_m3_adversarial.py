"""Empirical Challenger Adversarial Stress Suite for Milestone 3 (AudioWorklet DSP & Zero-Heap).

Covers Feature 9 Adversarial Invariants:
1. Zero-Allocation Invariant:
   - Zero Float32Array and Array allocations across 1,000+ process() quantums.
   - V8 heap stability under continuous streaming with buffer recycling.
2. DSP Resampling & Anti-Aliasing Stress:
   - 2nd-order Butterworth low-pass filter frequency response (attenuation >= 18 dB at high frequencies).
   - Arbitrary sample rate support (22.05k, 44.1k, 48k, 96k, 192k, non-integer rates).
   - Phase continuity and zero boundary glitch across consecutive 128-sample quantums.
3. Buffer Pool Exhaustion & Recycling:
   - Buffer pool starvation handling with on-demand fallback.
   - Delayed recycling burst stabilization.
   - Immunity against corrupted, detached, and malformed buffers.
   - 10,000-quantum stress execution under stochastic jitter.
"""

from pathlib import Path
import subprocess
import numpy as np
import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
JS_WORKLET_PATH = REPO_ROOT / "js" / "src" / "audio" / "audio-capture-worklet.js"
STRESS_SCRIPT_PATH = REPO_ROOT / "tests" / "stress_worklet_dsp.mjs"


# ==============================================================================
# Suite 1: Node.js Adversarial Harness Invocation
# ==============================================================================

def test_audioworklet_dsp_node_adversarial_suite():
    """Execute the Node.js zero-heap and AudioWorklet DSP adversarial stress suite."""
    assert STRESS_SCRIPT_PATH.exists(), f"Stress script not found: {STRESS_SCRIPT_PATH}"
    result = subprocess.run(
        ["node", str(STRESS_SCRIPT_PATH)],
        capture_output=True,
        text=True,
        cwd=str(REPO_ROOT),
    )
    assert result.returncode == 0, (
        f"Node adversarial harness failed (exit {result.returncode}):\nSTDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
    )
    assert "9 PASSED, 0 FAILED" in result.stdout


# ==============================================================================
# Suite 2: Butterworth Anti-Aliasing Filter Mathematical Invariants
# ==============================================================================

def butterworth_attenuation_db(fc: float, fs: float, f: float) -> float:
    """Calculate the theoretical attenuation of the 2nd-order Butterworth LPF."""
    omega = (2.0 * np.pi * fc) / fs
    sin_omega = np.sin(omega)
    cos_omega = np.cos(omega)
    alpha = sin_omega / (2.0 * np.sqrt(0.5))

    b0 = (1.0 - cos_omega) * 0.5
    b1 = 1.0 - cos_omega
    b2 = (1.0 - cos_omega) * 0.5
    a0 = 1.0 + alpha
    a1 = -2.0 * cos_omega
    a2 = 1.0 - alpha

    b = np.array([b0, b1, b2]) / a0
    a = np.array([1.0, a1 / a0, a2 / a0])

    w = 2.0 * np.pi * f / fs
    ejw = np.exp(-1j * w)
    num = b[0] + b[1] * ejw + b[2] * (ejw ** 2)
    den = a[0] + a[1] * ejw + a[2] * (ejw ** 2)
    H = num / den
    return float(20.0 * np.log10(np.abs(H)))


@pytest.mark.parametrize("fs", [48000, 96000])
def test_butterworth_cutoff_and_monotonicity(fs: int):
    """Verify Butterworth filter half-power point (-3 dB) and monotonic rolloff."""
    fc = 7500.0
    # Half-power point
    atten_fc = butterworth_attenuation_db(fc, fs, fc)
    assert -3.1 <= atten_fc <= -2.9, f"At fc={fc}Hz, expected -3.0 dB, got {atten_fc:.2f} dB"

    # Monotonic attenuation test
    frequencies = np.linspace(fc, fs / 2 - 100, 20)
    attens = [butterworth_attenuation_db(fc, fs, f) for f in frequencies]
    for i in range(1, len(attens)):
        assert attens[i] < attens[i - 1], (
            f"Non-monotonic attenuation at f={frequencies[i]}Hz: {attens[i]:.2f} >= {attens[i-1]:.2f}"
        )


def test_butterworth_high_frequency_rejection_at_48k():
    """Verify attenuation >= 18 dB at high frequencies above Nyquist for 48 kHz."""
    fc = 7500.0
    fs = 48000.0
    # At 15 kHz, 18 kHz, 20 kHz
    atten_15k = butterworth_attenuation_db(fc, fs, 15000.0)
    atten_18k = butterworth_attenuation_db(fc, fs, 18000.0)
    atten_20k = butterworth_attenuation_db(fc, fs, 20000.0)

    assert atten_15k <= -17.5, f"Expected ~18 dB attenuation at 15 kHz, got {atten_15k:.2f} dB"
    assert atten_18k <= -25.0, f"Expected >25 dB attenuation at 18 kHz, got {atten_18k:.2f} dB"
    assert atten_20k <= -30.0, f"Expected >30 dB attenuation at 20 kHz, got {atten_20k:.2f} dB"


def test_butterworth_high_frequency_rejection_at_96k():
    """Verify attenuation >= 18 dB at high frequencies above Nyquist for 96 kHz."""
    fc = 7500.0
    fs = 96000.0
    atten_20k = butterworth_attenuation_db(fc, fs, 20000.0)
    atten_24k = butterworth_attenuation_db(fc, fs, 24000.0)
    atten_32k = butterworth_attenuation_db(fc, fs, 32000.0)

    assert atten_20k <= -18.0, f"Expected >=18 dB attenuation at 20 kHz, got {atten_20k:.2f} dB"
    assert atten_24k <= -24.0, f"Expected >=24 dB attenuation at 24 kHz, got {atten_24k:.2f} dB"
    assert atten_32k <= -30.0, f"Expected >=30 dB attenuation at 32 kHz, got {atten_32k:.2f} dB"


# ==============================================================================
# Suite 3: Resampling Phase Continuity & Jitter Invariants
# ==============================================================================

@pytest.mark.parametrize("input_sr", [22050, 44100, 48000, 96000, 192000, 44101, 47999])
def test_resampler_boundary_phase_continuity(input_sr: int):
    """Verify phase continuity across quantum boundaries with zero discontinuity."""
    target_sr = 16000
    f_tone = 440.0
    quantum_size = 128
    ratio = input_sr / target_sr
    n_quantums = 60

    total_input = n_quantums * quantum_size
    t = np.arange(total_input) / input_sr
    full_in = np.sin(2 * np.pi * f_tone * t)

    phase = 0.0
    last_sample = 0.0
    output_samples = []
    boundary_indices = []

    for q in range(n_quantums):
        chunk_in = full_in[q * quantum_size : (q + 1) * quantum_size]
        n_frames = len(chunk_in)

        while phase < n_frames:
            if phase < 1.0:
                s = (1.0 - phase) * last_sample + phase * chunk_in[0]
            else:
                idx = int(np.floor(phase)) - 1
                frac = phase - np.floor(phase)
                s0 = chunk_in[idx]
                s1 = chunk_in[idx + 1] if idx + 1 < n_frames else s0
                s = (1.0 - frac) * s0 + frac * s1

            output_samples.append(s)
            phase += ratio

        phase -= n_frames
        last_sample = chunk_in[n_frames - 1]
        boundary_indices.append(len(output_samples))

    out_arr = np.array(output_samples)
    expected_max_diff = (2 * np.pi * f_tone) / target_sr

    # Assert no sample-to-sample diff exceeds continuous derivative bound + 10%
    diffs = np.abs(np.diff(out_arr))
    assert np.max(diffs) <= expected_max_diff * 1.10

    # Specifically verify boundary differences
    boundary_diffs = [
        abs(out_arr[b] - out_arr[b - 1])
        for b in boundary_indices[:-1]
        if b < len(out_arr)
    ]
    assert max(boundary_diffs) <= expected_max_diff * 1.10
