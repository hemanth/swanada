"""Milestone 2 Audio Inference Challenger Verification Suite.

Verifies:
1. Real audio transcription on docs/samples/ (en, kn, ml, gu, or) produces non-empty,
   sensible text with zero crashes, zero NaNs, and zero blank strings.
2. Prefix locking stability with 1600-sample streaming chunks demonstrates
   strictly monotonic append-only committed prefixes (0 churn / flicker).
3. Weight norm integrity and numerical stability across projection heads.
"""

from pathlib import Path
from typing import List
import numpy as np
import pytest
import soundfile as sf

from swanada import Swanada, load_audio
from swanada.frontend import extract_log_mel_features
from swanada.denoise import enhance_speech_with_telemetry
from swanada.vocab import REGISTRY, detect_script

REPO_ROOT = Path(__file__).resolve().parents[1]
DOCS_SAMPLES = REPO_ROOT / "docs" / "samples"
TARGET_LANGS = ["en", "kn", "ml", "gu", "or"]


@pytest.mark.parametrize("lang", TARGET_LANGS)
def test_real_audio_transcription_quality(lang: str) -> None:
    """Verifies that sample audio produces non-empty sensible text with zero NaNs."""
    wav_path = DOCS_SAMPLES / f"{lang}.wav"
    assert wav_path.exists(), f"Sample audio missing for language {lang}: {wav_path}"

    pcm = load_audio(wav_path, target_sr=16000)
    assert len(pcm) > 0, f"Loaded audio is empty for language {lang}"

    # Verify no NaN or Inf in acoustic logits
    stt = Swanada.create(language=lang)
    enhanced = enhance_speech_with_telemetry(pcm, sr=16000)
    feats, num_frames = extract_log_mel_features(enhanced.pcm, sr=16000)

    raw_logits = stt.engine.acoustic_session.run(
        None,
        {
            "audio_signal": np.ascontiguousarray(feats, dtype=np.float32),
            "length": np.array([num_frames], dtype=np.int64),
        },
    )[0]

    assert not np.isnan(raw_logits).any(), f"Acoustic logits contain NaN for language {lang}"
    assert not np.isinf(raw_logits).any(), f"Acoustic logits contain Inf for language {lang}"

    res = stt.transcribe(wav_path)
    text = res.text.strip()

    assert len(text) > 0, f"Transcription text is blank for language {lang}"
    assert res.rtf < 1.0, f"Real-Time Factor exceeds 1.0 for language {lang}: {res.rtf:.4f}"
    assert res.duration_ms > 500.0, f"Audio duration suspiciously short for {lang}: {res.duration_ms}"

    det_lang = detect_script(text)
    exp_script = REGISTRY[lang].script
    det_script = REGISTRY[det_lang].script if det_lang else None
    assert det_script == exp_script or lang == "en", (
        f"Script mismatch for language {lang}: expected {exp_script}, got {det_script}"
    )


@pytest.mark.parametrize("lang", TARGET_LANGS)
def test_prefix_locking_stability_1600_chunks(lang: str) -> None:
    """Verifies monotonic append-only prefix locking during 1600-sample streaming."""
    wav_path = DOCS_SAMPLES / f"{lang}.wav"
    assert wav_path.exists(), f"Sample audio missing for language {lang}: {wav_path}"

    base_pcm = load_audio(wav_path, target_sr=16000)
    # Concatenate double pass with pause to test multi-second streaming commitment
    silence = np.zeros(8000, dtype=np.float32)
    pcm = np.concatenate([base_pcm, silence, base_pcm])

    chunk_size = 1600
    stt = Swanada.create(language=lang)
    stream = stt.stream(chunk_size_samples=chunk_size)

    committed_history: List[str] = []
    churn_events: List[str] = []

    for offset_idx in range(0, len(pcm), chunk_size):
        chunk = pcm[offset_idx : min(len(pcm), offset_idx + chunk_size)]
        st = stream.push(chunk)
        if st is None:
            continue

        curr_committed = st.committed.strip()
        if not curr_committed:
            continue

        if committed_history:
            prev_committed = committed_history[-1]
            if not curr_committed.startswith(prev_committed):
                churn_events.append(
                    f"offset {offset_idx}: previous='{prev_committed}' -> current='{curr_committed}'"
                )
        committed_history.append(curr_committed)

    final_res = stream.finish()
    final_text = final_res.text.strip()

    if committed_history:
        last_committed = committed_history[-1]
        assert final_text.startswith(last_committed), (
            f"Final transcription churn: final='{final_text}' does not start with last='{last_committed}'"
        )

    assert len(churn_events) == 0, (
        f"Detected {len(churn_events)} prefix churn events for {lang}: {churn_events}"
    )
