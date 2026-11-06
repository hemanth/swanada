"""Unit & integration tests for Multi-Stage ASR Background Noise Cancellation and Brahmic Orthographic Normalizer."""

import math
import numpy as np

from swanada import (
    Swanada,
    denoise_pcm_16k,
    enhance_speech_with_telemetry,
    load_audio,
    normalize_indic_text,
    repair_brahmic_orthography,
)


def test_hum_and_rumble_suppression_preserves_formant() -> None:
    sr = 16000
    t = np.arange(sr, dtype=np.float64) / sr
    formant = 0.20 * np.sin(2.0 * math.pi * 600.0 * t)
    hum_50 = 0.08 * np.sin(2.0 * math.pi * 50.0 * t)
    hum_60 = 0.08 * np.sin(2.0 * math.pi * 60.0 * t)
    rumble_30 = 0.10 * np.sin(2.0 * math.pi * 30.0 * t)
    noisy = (formant + hum_50 + hum_60 + rumble_30 + 0.12).astype(np.float32)

    res = enhance_speech_with_telemetry(noisy, sr=sr, spectral_denoise=False)
    out = res.pcm[2000:]
    t_tail = t[2000:]

    def tone_power(sig: np.ndarray, freq: float) -> float:
        re = float(np.mean(sig * np.cos(2.0 * math.pi * freq * t_tail)))
        im = float(np.mean(sig * np.sin(2.0 * math.pi * freq * t_tail)))
        return 4.0 * (re * re + im * im)

    p50_before = tone_power(noisy[2000:], 50.0)
    p50_after = tone_power(out, 50.0)
    p30_before = tone_power(noisy[2000:], 30.0)
    p30_after = tone_power(out, 30.0)
    p600_before = tone_power(noisy[2000:], 600.0)
    p600_after = tone_power(out, 600.0)

    att50_db = 10.0 * math.log10(p50_before / max(p50_after, 1e-12))
    att30_db = 10.0 * math.log10(p30_before / max(p30_after, 1e-12))
    loss600_db = abs(10.0 * math.log10(p600_before / max(p600_after, 1e-12)))

    assert att50_db >= 20.0, f"Expected >= 20 dB 50 Hz mains hum rejection, got {att50_db:.2f} dB"
    assert att30_db >= 16.5, f"Expected >= 16.5 dB 30 Hz rumble rejection, got {att30_db:.2f} dB"
    assert loss600_db < 0.5, f"600 Hz vocal formant distorted by {loss600_db:.2f} dB"


def test_wiener_spectral_denoise_suppresses_broadband_hiss() -> None:
    sr = 16000
    n = sr * 2
    t = np.arange(n, dtype=np.float64) / sr
    rng = np.random.RandomState(42)
    env = np.where((t >= 0.4) & (t <= 1.5), 1.0, 0.0)
    clean = (env * (0.22 * np.sin(2 * math.pi * 440 * t) + 0.12 * np.sin(2 * math.pi * 1100 * t))).astype(np.float32)
    noise = (0.035 * rng.randn(n)).astype(np.float32)
    noisy = clean + noise

    res = enhance_speech_with_telemetry(noisy, sr=sr)
    assert res.is_speech_likely is True

    pause_idx = np.concatenate([np.arange(0, int(0.35 * sr)), np.arange(int(1.6 * sr), n)])
    noise_before = float(np.mean(noisy[pause_idx] ** 2))
    noise_after = float(np.mean(res.pcm[pause_idx] ** 2))
    supp_db = 10.0 * math.log10(noise_before / max(noise_after, 1e-12))
    assert supp_db >= 8.0, f"Expected >= 8 dB broadband hiss suppression in pauses, got {supp_db:.2f} dB"


def test_clean_studio_speech_bit_exact_bypass() -> None:
    pcm = load_audio("docs/samples/sa.wav", target_sr=16000)
    out = denoise_pcm_16k(pcm)
    assert np.allclose(pcm, out, atol=1e-7), "Clean studio speech must bypass spectral alteration"


def test_stationary_hiss_non_speech_gate() -> None:
    rng = np.random.RandomState(7)
    hiss = (0.006 * rng.randn(16000)).astype(np.float32)
    res = enhance_speech_with_telemetry(hiss, sr=16000)
    assert res.is_speech_likely is False
    assert float(np.max(np.abs(res.pcm))) == 0.0


def test_brahmic_orthographic_repair_across_scripts() -> None:
    assert normalize_indic_text("हीि") == "ही"
    assert normalize_indic_text("அதுோ") == "அது"
    assert normalize_indic_text("ಇ್ಞ") == "ಇಞ"
    assert normalize_indic_text("धर्मक्षेत्रे कुरुक्षेत्रे") == "धर्मक्षेत्रे कुरुक्षेत्रे"
    assert repair_brahmic_orthography("ಕನ್ನಡ") == "ಕನ್ನಡ"


def test_noisy_multilingual_asr_resilience() -> None:
    for lang in ("sa", "en", "hi", "kn"):
        pcm = load_audio(f"docs/samples/{lang}.wav", target_sr=16000)
        rng = np.random.RandomState(101)
        t = np.arange(len(pcm), dtype=np.float64) / 16000.0
        noisy = (pcm + 0.04 * np.sin(2 * math.pi * 50.0 * t) + 0.02 * rng.randn(len(pcm))).astype(np.float32)
        stt = Swanada.create(language=lang)
        res = stt.transcribe(noisy)
        assert len(res.text.strip()) >= 8, f"Expected non-empty noisy transcription for {lang}, got '{res.text}'"
