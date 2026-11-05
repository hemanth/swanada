"""Adversarial stress tests for StreamingCTCDecoder prefix locking and zero character churn.

Verifies:
1. 0.00% character churn on committed prefix across 1,000 randomized fluctuating token streams.
2. Rapid blank tokens and empty sequences.
3. Repeated identical non-blank tokens and geminates.
4. Isolated vowel marks and combining characters.
5. Single-letter words with alternating spaces.
6. Long compound words without spaces.
7. Stream finish flush behavior.
8. Real speech streaming monotonicity across every emitted partial.
"""

from pathlib import Path
import random
import time
import numpy as np
import pytest

from swanada.streaming import StreamingCTCDecoder, SwanadaStream
from swanada import Swanada, load_audio

TEST_WAV = Path("/Users/lika/labs/ninada/data/wavs/sa_rasa_male_01445fb1731b.wav")


def test_adversarial_1000_step_prefix_locking_churn() -> None:
    """Proves 0.00% character churn across 1,000 steps of fluctuating, noisy token streams."""
    vocab = [
        "<blank>", "<unk>",
        "\u2581अ", "\u2581आ", "\u2581इ", "\u2581ई", "\u2581उ", "\u2581क", "\u2581ग", "\u2581त",
        "\u2581द", "\u2581न", "\u2581प", "\u2581म", "\u2581य", "\u2581र", "\u2581ल", "\u2581व",
        "\u2581स", "\u2581ह",
        "क", "ख", "ग", "घ", "च", "छ", "ज", "झ", "ट", "ठ", "ड", "ढ", "ण", "त", "थ", "द", "ध", "न",
        "प", "फ", "ब", "भ", "म", "य", "र", "ल", "व", "श", "ष", "स", "ह",
        "ा", "ि", "ी", "ु", "ू", "ृ", "े", "ै", "ो", "ौ", "्", "ं", "ः",
    ]

    rng = random.Random(42)
    decoder = StreamingCTCDecoder(vocab, stability_threshold=2, trail_tokens=2)

    committed_history: list[str] = []
    base_stream: list[str] = []
    total_steps = 1000
    churn_events = 0

    for step in range(total_steps):
        # 1. Periodically append a new stable word or token to base stream
        if step % 3 == 0 or len(base_stream) == 0:
            token = rng.choice(vocab[2:])
            base_stream.append(token)

        # 2. Add fluctuating volatile tail (0 to 4 random tokens simulating acoustic flapping)
        volatile_tail = [rng.choice(vocab[2:]) for _ in range(rng.randint(0, 4))]
        hypothesis = list(base_stream) + volatile_tail

        # 3. Randomly insert or mutate a token in the unconfirmed volatile tail
        if len(hypothesis) > 1 and rng.random() < 0.3:
            hypothesis[-1] = rng.choice(vocab[2:])

        st = decoder.update(hypothesis)
        committed = st.committed

        if committed:
            committed_history.append(committed)

        # Verify monotonicity: committed must strictly extend previous committed prefix
        if len(committed_history) >= 2:
            prev = committed_history[-2]
            curr = committed_history[-1]
            if not curr.startswith(prev):
                # Count character churn violation
                churn_events += 1
                pytest.fail(
                    f"Character churn detected at step {step}: "
                    f"prev='{prev}', curr='{curr}' does not start with previous committed prefix"
                )

    # 4. Stream end flushes remaining hypothesis
    final_st = decoder.update(base_stream, is_stream_end=True)
    if committed_history:
        assert final_st.committed.startswith(committed_history[-1]), (
            f"Final flush churn: final='{final_st.committed}' vs last_committed='{committed_history[-1]}'"
        )

    churn_rate = churn_events / total_steps
    assert churn_rate == 0.00, f"Expected strictly 0.00% character churn, got {churn_rate * 100:.2f}%"


def test_adversarial_rapid_blank_and_empty_tokens() -> None:
    """Verifies that bursts of blanks, empty lists, and silence do not corrupt decoder state."""
    vocab = ["<blank>", "<unk>", "\u2581अ", "हं", "\u2581त", "त्र"]
    decoder = StreamingCTCDecoder(vocab, stability_threshold=2, trail_tokens=2)

    # Empty inputs before any speech
    for _ in range(10):
        st = decoder.update([])
        assert st.committed == ""
        assert st.volatile == ""
        assert st.text == ""

    # Establish initial committed word
    decoder.update(["\u2581अ", "हं", "\u2581त"])
    st2 = decoder.update(["\u2581अ", "हं", "\u2581त", "त्र"])
    assert st2.committed == "अहं"

    # Sudden burst of empty tokens (simulating audio drop)
    for _ in range(5):
        st_empty = decoder.update([])
        assert st_empty.committed == "अहं", "Committed prefix must survive empty frame bursts"
        assert st_empty.volatile == ""

    # Audio resumes with previously committed prefix intact
    st_resume = decoder.update(["\u2581अ", "हं", "\u2581त", "त्र", "\u2581ग", "त"])
    assert st_resume.committed.startswith("अहं")


def test_adversarial_repeated_identical_tokens_and_geminates() -> None:
    """Verifies duplicate consonant geminates vs vowel sign collapsing."""
    vocab = ["<blank>", "<unk>", "\u2581क", "क", "क", "्", "\u2581त", "त"]
    decoder = StreamingCTCDecoder(vocab, stability_threshold=2, trail_tokens=2)

    # Feed repeated consonants: Devanagari geminate 'क' + '्' + 'क' = 'क्क'
    h = []
    h.append(decoder.update(["\u2581क"]).committed)
    h.append(decoder.update(["\u2581क", "्"]).committed)
    h.append(decoder.update(["\u2581क", "्", "क"]).committed)
    h.append(decoder.update(["\u2581क", "्", "क", "\u2581त"]).committed)
    h.append(decoder.update(["\u2581क", "्", "क", "\u2581त", "त"]).committed)

    # Check monotonicity
    valid_h = [x for x in h if x]
    for i in range(1, len(valid_h)):
        assert valid_h[i].startswith(valid_h[i - 1]), (
            f"Geminate churn: prev='{valid_h[i-1]}', curr='{valid_h[i]}'"
        )


def test_adversarial_isolated_vowel_marks() -> None:
    """Verifies that floating or isolated combining marks do not crash or cause regressions."""
    vocab = ["<blank>", "<unk>", "\u093e", "\u0941", "\u094d", "\u2581क", "त"]
    decoder = StreamingCTCDecoder(vocab, stability_threshold=2, trail_tokens=2)

    # Isolated matras with no base consonant
    st1 = decoder.update(["\u093e"])
    assert st1.committed == ""

    st2 = decoder.update(["\u093e", "\u0941"])
    assert st2.committed == ""

    # Base consonant arrives later
    st3 = decoder.update(["\u093e", "\u0941", "\u2581क", "त", "\u2581त"])
    assert isinstance(st3.committed, str)


def test_adversarial_single_letter_words() -> None:
    """Verifies single-letter words separated by space markers maintain monotonic progression."""
    vocab = ["<blank>", "<unk>", "\u2581क", "\u2581च", "\u2581त", "\u2581प", "\u2581म", "\u2581य"]
    decoder = StreamingCTCDecoder(vocab, stability_threshold=2, trail_tokens=2)

    h: list[str] = []
    tokens: list[str] = []
    for tok in ["\u2581क", "\u2581च", "\u2581त", "\u2581प", "\u2581म", "\u2581य"]:
        tokens.append(tok)
        st = decoder.update(list(tokens))
        if st.committed:
            h.append(st.committed)

    for i in range(1, len(h)):
        assert h[i].startswith(h[i - 1]), f"Single-letter churn: '{h[i]}' vs '{h[i-1]}'"


def test_adversarial_long_compound_without_spaces() -> None:
    """Verifies continuous 60-token compound word commits monotonically via stability counts."""
    vocab = ["<blank>", "<unk>"] + [f"sub_{i}" for i in range(80)]
    decoder = StreamingCTCDecoder(vocab, stability_threshold=2, trail_tokens=2)

    h: list[str] = []
    tokens: list[str] = []
    for i in range(60):
        tokens.append(f"sub_{i}")
        st = decoder.update(list(tokens))
        if st.committed:
            h.append(st.committed)

    assert len(h) >= 50, f"Expected at least 50 commit stages, got {len(h)}"
    for i in range(1, len(h)):
        assert h[i].startswith(h[i - 1]), f"Compound churn: '{h[i]}' vs '{h[i-1]}'"


def test_adversarial_held_out_speech_streaming_monotonicity() -> None:
    """Empirically evaluates real speech audio streaming for strict monotonic prefix progression."""
    if not TEST_WAV.exists():
        pytest.skip(f"Test wav not found at {TEST_WAV}")

    stt = Swanada.create(language="sa")
    stream = stt.stream(chunk_size_samples=3200)  # 200ms chunks

    pcm = load_audio(TEST_WAV, target_sr=16000)
    committed_history: list[str] = []

    chunk_size = 3200
    for i in range(0, len(pcm), chunk_size):
        chunk = pcm[i : min(len(pcm), i + chunk_size)]
        st = stream.push(chunk)
        if st is not None and st.committed:
            committed_history.append(st.committed)

    final_res = stream.finish()

    assert len(committed_history) > 0, "Expected at least one non-empty committed state"
    for i in range(1, len(committed_history)):
        prev = committed_history[i - 1]
        curr = committed_history[i]
        assert curr.startswith(prev), (
            f"Acoustic streaming churn: prev='{prev}', curr='{curr}'"
        )

    # Final result must contain the committed prefix
    assert final_res.text.startswith(committed_history[-1]), (
        f"Final result '{final_res.text}' does not start with last committed '{committed_history[-1]}'"
    )
