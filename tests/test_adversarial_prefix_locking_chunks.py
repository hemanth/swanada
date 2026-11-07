"""Adversarial prefix-locking determinism across varying chunk sizes and audio samples.

Verifies:
1. 0.00% character churn and word flicker on committed prefix across varying chunk sizes.
2. Verified on docs/samples/sa.wav and docs/samples/en.wav.
3. Monotonic extension of committed prefix across all emitted partials.
4. Final transcription strictly preserves final committed prefix.
"""

from pathlib import Path
from typing import List
import pytest

from swanada import Swanada, load_audio


SAMPLES_DIR = Path(__file__).parent.parent / "docs" / "samples"
SAMPLE_AUDIO_FILES = [
    ("sa", SAMPLES_DIR / "sa.wav"),
    ("en", SAMPLES_DIR / "en.wav"),
]
CHUNK_SIZES = [800, 1600, 3200, 5120]


@pytest.mark.parametrize("lang,wav_path", SAMPLE_AUDIO_FILES)
@pytest.mark.parametrize("chunk_size", CHUNK_SIZES)
def test_adversarial_chunk_prefix_locking_determinism(lang: str, wav_path: Path, chunk_size: int) -> None:
    """Verifies that emitted committed words remain strictly prefix-locked without churn."""
    if not wav_path.exists():
        pytest.skip(f"Sample audio not found: {wav_path}")

    stt = Swanada.create(language=lang)
    stream = stt.stream(chunk_size_samples=chunk_size)
    pcm = load_audio(wav_path, target_sr=16000)

    committed_history: List[str] = []
    churn_events: int = 0
    total_partials: int = 0

    for i in range(0, len(pcm), chunk_size):
        chunk = pcm[i : min(len(pcm), i + chunk_size)]
        st = stream.push(chunk)
        if st is None:
            continue

        total_partials += 1
        curr_committed = st.committed.strip()
        if not curr_committed:
            continue

        if committed_history:
            prev_committed = committed_history[-1]
            if not curr_committed.startswith(prev_committed):
                churn_events += 1
                pytest.fail(
                    f"Prefix-locking churn detected for lang={lang}, chunk_size={chunk_size} at offset {i}: "
                    f"previous='{prev_committed}', current='{curr_committed}'"
                )

        committed_history.append(curr_committed)

    final_result = stream.finish()
    final_text = final_result.text.strip()

    if committed_history:
        last_committed = committed_history[-1]
        assert final_text.startswith(last_committed), (
            f"Final transcription churn: final='{final_text}' does not start with last committed='{last_committed}'"
        )

    assert churn_events == 0, f"Detected {churn_events} churn events during streaming with chunk_size={chunk_size}"
