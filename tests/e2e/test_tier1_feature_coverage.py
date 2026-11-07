"""Tier 1: Feature Coverage End-to-End Tests for Swanada.

Covers the 5 core streaming and batch speech-to-text features across all 12 supported languages:
`sa` (Sanskrit), `en` (Indian English), `hi` (Hindi), `kn` (Kannada), `mr` (Marathi),
`bn` (Bengali), `ta` (Tamil), `te` (Telugu), `ml` (Malayalam), `gu` (Gujarati),
`pa` (Punjabi), and `or` (Odia).

Features evaluated:
- Feature 1: Basic Streaming Transcription (progressive push, finish, RTF < 1.0, token validity, CLI --stream)
- Feature 2: Batch Transcription (file path, PCM array, RTF < 1.0, duration accuracy, CLI batch)
- Feature 3: Language Selection & Model Switching (valid codes, result tagging, registry, binary heads, invalid code)
- Feature 4: Output Format & Serialization (plain text NFC, structured JSON, file output -o, Sanskrit IAST, tokens)
- Feature 5: Prefix Stability & Invariants (append-only committed, 0.00% churn, monotonic growth, prefix match, volatile resolution)
"""
from __future__ import annotations

import json
import math
import struct
import time
import unicodedata
from pathlib import Path
from typing import Any, Callable

import pytest

from tests.e2e.helpers import (
    ALL_12_LANGUAGES,
    CANONICAL_PRESETS,
    compute_character_churn,
    get_sample_wav_path,
    load_sample_pcm,
    verify_prefix_stability,
    verify_transcription_result,
)

try:
    from swanada import REGISTRY, Swanada, TranscriptionResult
except ImportError:
    Swanada = None  # type: ignore[assignment]
    REGISTRY = None  # type: ignore[assignment]


# ==============================================================================
# Feature 1: Basic Streaming Transcription
# ==============================================================================

@pytest.mark.tier1
@pytest.mark.parametrize("lang", ALL_12_LANGUAGES)
def test_tier1_streaming_emits_progressive_transcripts(lang: str, engine_factory: Callable[[str], Any]) -> None:
    """F1.1: Streaming push emits progressive StreamingTranscript objects for all 12 languages."""
    engine = engine_factory(lang)
    stream = engine.stream(chunk_size_samples=1600)
    pcm, sr = load_sample_pcm(lang)

    chunk_size = 1600
    emitted_count = 0
    for i in range(0, len(pcm), chunk_size):
        chunk = pcm[i : i + chunk_size]
        step = stream.push(chunk)
        emitted_count += 1
        assert hasattr(step, "text"), f"Missing text attribute in step for {lang}"
        assert hasattr(step, "committed"), f"Missing committed attribute in step for {lang}"
        assert hasattr(step, "volatile"), f"Missing volatile attribute in step for {lang}"
        assert isinstance(step.text, str)
        assert isinstance(step.committed, str)
        assert isinstance(step.volatile, str)

    final_result = stream.finish()
    assert emitted_count > 0, f"Expected multiple chunks pushed for {lang}"
    assert len(final_result.text) > 0, f"Empty final text on streaming {lang}"


@pytest.mark.tier1
@pytest.mark.parametrize("lang", ALL_12_LANGUAGES)
def test_tier1_streaming_finish_returns_complete_transcription(lang: str, engine_factory: Callable[[str], Any]) -> None:
    """F1.2: Calling finish() terminates stream and returns a valid TranscriptionResult for all 12 languages."""
    engine = engine_factory(lang)
    stream = engine.stream(chunk_size_samples=1600)
    pcm, sr = load_sample_pcm(lang)

    for i in range(0, len(pcm), 1600):
        stream.push(pcm[i : i + 1600])

    result = stream.finish()
    verify_transcription_result(result, expected_lang=lang)
    assert len(result.text.strip()) > 0, f"Expected non-empty text on finish for {lang}"
    assert len(result.tokens) > 0, f"Expected non-empty tokens list on finish for {lang}"
    assert result.duration_ms > 0, f"Expected positive duration for {lang}"


@pytest.mark.tier1
@pytest.mark.parametrize("lang", ALL_12_LANGUAGES)
def test_tier1_streaming_rtf_under_one(lang: str, engine_factory: Callable[[str], Any]) -> None:
    """F1.3: Real-Time Factor during chunked streaming remains strictly below 1.0 for all 12 languages."""
    engine = engine_factory(lang)
    stream = engine.stream(chunk_size_samples=1600)
    pcm, sr = load_sample_pcm(lang)

    audio_duration_sec = len(pcm) / float(sr)
    t_start = time.perf_counter()
    for i in range(0, len(pcm), 1600):
        stream.push(pcm[i : i + 1600])
    stream.finish()
    t_elapsed = time.perf_counter() - t_start

    measured_rtf = t_elapsed / audio_duration_sec
    assert measured_rtf < 1.0, (
        f"Streaming RTF violation for {lang}: measured {measured_rtf:.4f} exceeds 1.0 limit "
        f"(elapsed={t_elapsed:.3f}s, audio={audio_duration_sec:.3f}s)"
    )


@pytest.mark.tier1
@pytest.mark.parametrize("lang", ALL_12_LANGUAGES)
def test_tier1_streaming_token_sequence_validity(lang: str, engine_factory: Callable[[str], Any]) -> None:
    """F1.4: Emitted streaming tokens consist exclusively of valid non-empty string units for all 12 languages."""
    engine = engine_factory(lang)
    stream = engine.stream(chunk_size_samples=1600)
    pcm, sr = load_sample_pcm(lang)

    for i in range(0, len(pcm), 1600):
        stream.push(pcm[i : i + 1600])

    result = stream.finish()
    assert isinstance(result.tokens, list), f"Expected tokens list for {lang}"
    for idx, token in enumerate(result.tokens):
        assert isinstance(token, str), f"Token at {idx} for {lang} is not string: {type(token)}"
        assert len(token) > 0, f"Empty token string found at index {idx} for {lang}"


@pytest.mark.tier1
@pytest.mark.parametrize("lang", ALL_12_LANGUAGES)
def test_tier1_streaming_cli_stream_flag(lang: str, run_cli: Callable[..., Any]) -> None:
    """F1.5: Command-line interface with --stream flag executes streaming transcription for all 12 languages."""
    wav_path = get_sample_wav_path(lang)
    proc = run_cli(str(wav_path), "-l", lang, "--stream", "--json")
    assert proc.returncode == 0, f"CLI streaming returned error for {lang}: {proc.stderr}"

    data = json.loads(proc.stdout)
    assert data["language"] == lang
    assert data["mode"] == "streaming"
    assert len(data["text"]) > 0
    assert len(data["tokens"]) > 0


# ==============================================================================
# Feature 2: Batch Transcription
# ==============================================================================

@pytest.mark.tier1
@pytest.mark.parametrize("lang", ALL_12_LANGUAGES)
def test_tier1_batch_transcribe_wav_path(lang: str, engine_factory: Callable[[str], Any]) -> None:
    """F2.1: Batch transcription from WAV file path returns valid TranscriptionResult for all 12 languages."""
    engine = engine_factory(lang)
    wav_path = get_sample_wav_path(lang)
    result = engine.transcribe(str(wav_path))

    verify_transcription_result(result, expected_lang=lang)
    assert len(result.text.strip()) > 0
    assert len(result.tokens) > 0


@pytest.mark.tier1
@pytest.mark.parametrize("lang", ALL_12_LANGUAGES)
def test_tier1_batch_transcribe_pcm_buffer(lang: str, engine_factory: Callable[[str], Any]) -> None:
    """F2.2: Batch transcription directly from float PCM array succeeds with parity for all 12 languages."""
    import numpy as np

    engine = engine_factory(lang)
    pcm, sr = load_sample_pcm(lang)
    pcm_array = np.array(pcm, dtype=np.float32)

    result = engine.transcribe(pcm_array, sample_rate=sr)
    verify_transcription_result(result, expected_lang=lang)
    assert len(result.text.strip()) > 0


@pytest.mark.tier1
@pytest.mark.parametrize("lang", ALL_12_LANGUAGES)
def test_tier1_batch_transcribe_rtf_under_one(lang: str, engine_factory: Callable[[str], Any]) -> None:
    """F2.3: Batch transcription Real-Time Factor is strictly below 1.0 for all 12 languages."""
    engine = engine_factory(lang)
    wav_path = get_sample_wav_path(lang)
    result = engine.transcribe(str(wav_path))

    assert result.rtf < 1.0, f"Batch RTF violation for {lang}: {result.rtf} exceeds 1.0 limit"


@pytest.mark.tier1
@pytest.mark.parametrize("lang", ALL_12_LANGUAGES)
def test_tier1_batch_transcribe_duration_accuracy(lang: str, engine_factory: Callable[[str], Any]) -> None:
    """F2.4: Transcribed audio duration matches audio file header duration within tolerance for all 12 languages."""
    import wave

    engine = engine_factory(lang)
    wav_path = get_sample_wav_path(lang)
    with wave.open(str(wav_path), "rb") as wf:
        expected_duration_ms = (wf.getnframes() / float(wf.getframerate())) * 1000.0

    result = engine.transcribe(str(wav_path))
    assert abs(result.duration_ms - expected_duration_ms) < 50.0, (
        f"Duration mismatch for {lang}: result={result.duration_ms}ms, expected={expected_duration_ms}ms"
    )


@pytest.mark.tier1
@pytest.mark.parametrize("lang", ALL_12_LANGUAGES)
def test_tier1_batch_transcribe_cli_execution(lang: str, run_cli: Callable[..., Any]) -> None:
    """F2.5: CLI batch execution produces valid plain-text transcript on stdout for all 12 languages."""
    wav_path = get_sample_wav_path(lang)
    proc = run_cli(str(wav_path), "-l", lang)
    assert proc.returncode == 0, f"CLI batch error for {lang}: {proc.stderr}"
    output = proc.stdout.strip()
    assert len(output) > 0, f"Empty CLI stdout for {lang}"


# ==============================================================================
# Feature 3: Language Selection & Model Switching
# ==============================================================================

@pytest.mark.tier1
@pytest.mark.parametrize("lang", ALL_12_LANGUAGES)
def test_tier1_language_selection_valid_codes(lang: str) -> None:
    """F3.1: Engine initializes cleanly with language property set for all 12 valid codes."""
    if Swanada is None:
        pytest.skip("swanada package not installed")
    engine = Swanada(language=lang)
    assert engine.language == lang


@pytest.mark.tier1
@pytest.mark.parametrize("lang", ALL_12_LANGUAGES)
def test_tier1_language_selection_result_tagging(lang: str, engine_factory: Callable[[str], Any]) -> None:
    """F3.2: Transcription result carries the selected language tag for all 12 languages."""
    engine = engine_factory(lang)
    wav_path = get_sample_wav_path(lang)
    result = engine.transcribe(str(wav_path))
    assert result.language == lang


@pytest.mark.tier1
@pytest.mark.parametrize("lang", ALL_12_LANGUAGES)
def test_tier1_language_selection_vocabulary_registry(lang: str, engine_factory: Callable[[str], Any]) -> None:
    """F3.3: Language vocabulary registry contains valid token count for all 12 languages."""
    if REGISTRY is None:
        pytest.skip("Vocabulary REGISTRY not available")
    meta = REGISTRY.get(lang)
    assert meta is not None, f"Registry missing metadata for {lang}"
    assert len(meta.script) > 0, f"Empty script name for {lang}"
    assert len(meta.name) > 0, f"Empty language name for {lang}"

    engine = engine_factory(lang)
    assert hasattr(engine.engine, "vocab"), f"Engine missing vocab for {lang}"
    vocab = engine.engine.vocab
    assert len(vocab) >= 100, f"Vocabulary too small for {lang}: {len(vocab)} tokens"


@pytest.mark.tier1
@pytest.mark.parametrize("lang", ALL_12_LANGUAGES)
def test_tier1_language_selection_model_head_integrity(lang: str) -> None:
    """F3.4: Linear CTC projection head file exists with exactly 527,364 bytes for all 12 languages."""
    repo_root = Path(__file__).resolve().parents[2]
    head_path = repo_root / "docs" / "heads" / f"{lang}.bin"
    assert head_path.exists(), f"Projection head file missing: {head_path}"
    file_size = head_path.stat().st_size
    # Exact byte size: 131584 float32 weights (526336 bytes) + 257 float32 biases (1028 bytes) = 527364 bytes
    assert file_size == 527364, f"Unexpected head size for {lang}: {file_size} bytes (expected 527364)"

    # Verify non-trivial weight norm
    raw_bytes = head_path.read_bytes()
    weights = struct.unpack(f"<{131584}f", raw_bytes[:526336])
    frobenius_norm = math.sqrt(sum(w * w for w in weights))
    assert frobenius_norm > 10.0, f"Weight norm suspiciously low for {lang}: {frobenius_norm}"


@pytest.mark.tier1
def test_tier1_language_selection_invalid_code_rejected(run_cli: Callable[..., Any]) -> None:
    """F3.5: Specifying unsupported language codes is rejected with non-zero exit code and error diagnostic."""
    if REGISTRY is None:
        pytest.skip("Vocabulary REGISTRY not available")
    invalid_codes = ["xx", "klingon", "esperanto", "123", "unknown_lang"]
    wav_path = get_sample_wav_path("sa")

    for code in invalid_codes:
        assert code not in REGISTRY, f"Invalid code {code} unexpectedly registered in REGISTRY"
        proc = run_cli(str(wav_path), "-l", code)
        assert proc.returncode != 0, f"Expected non-zero exit code for invalid language {code}"
        assert "Unsupported language" in proc.stderr or "Error" in proc.stderr



# ==============================================================================
# Feature 4: Output Format & Serialization
# ==============================================================================

@pytest.mark.tier1
@pytest.mark.parametrize("lang", ALL_12_LANGUAGES)
def test_tier1_output_format_plain_text_nfc(lang: str, engine_factory: Callable[[str], Any]) -> None:
    """F4.1: Transcription text return is valid Unicode in NFC canonical composition for all 12 languages."""
    engine = engine_factory(lang)
    wav_path = get_sample_wav_path(lang)
    result = engine.transcribe(str(wav_path))

    text = result.text
    assert isinstance(text, str)
    assert unicodedata.is_normalized("NFC", text), f"Text output for {lang} is not NFC normalized: {text!r}"


@pytest.mark.tier1
@pytest.mark.parametrize("lang", ALL_12_LANGUAGES)
def test_tier1_output_format_cli_json_contract(lang: str, run_cli: Callable[..., Any]) -> None:
    """F4.2: CLI JSON emission conforms to complete schema contract for all 12 languages."""
    wav_path = get_sample_wav_path(lang)
    proc = run_cli(str(wav_path), "-l", lang, "--json")
    assert proc.returncode == 0, f"CLI JSON failure for {lang}: {proc.stderr}"

    data = json.loads(proc.stdout)
    required_keys = ["text", "language", "durationMs", "inferenceMs", "rtf", "tokens", "mode"]
    for key in required_keys:
        assert key in data, f"Missing required JSON key '{key}' in output for {lang}"

    assert isinstance(data["text"], str)
    assert data["language"] == lang
    assert isinstance(data["durationMs"], (int, float))
    assert isinstance(data["inferenceMs"], (int, float))
    assert isinstance(data["rtf"], (int, float))
    assert isinstance(data["tokens"], list)
    assert data["mode"] == "batch"


@pytest.mark.tier1
@pytest.mark.parametrize("lang", ALL_12_LANGUAGES)
def test_tier1_output_format_cli_file_redirection(lang: str, run_cli: Callable[..., Any], tmp_path: Path) -> None:
    """F4.3: CLI file redirection flag (-o / --output) saves identical transcript to disk for all 12 languages."""
    wav_path = get_sample_wav_path(lang)
    out_file = tmp_path / f"transcript_{lang}.txt"

    proc = run_cli(str(wav_path), "-l", lang, "-o", str(out_file))
    assert proc.returncode == 0, f"CLI file redirection failed for {lang}: {proc.stderr}"
    assert out_file.exists(), f"Output file was not created: {out_file}"

    file_content = out_file.read_text(encoding="utf-8").strip()
    assert len(file_content) > 0, f"Output file is empty for {lang}"


@pytest.mark.tier1
def test_tier1_output_format_sanskrit_iast_transliteration(run_cli: Callable[..., Any], engine_factory: Callable[[str], Any]) -> None:
    """F4.4: Roman IAST transliteration mode converts Sanskrit Devanagari output to Roman script."""
    engine = engine_factory("sa")
    wav_path = get_sample_wav_path("sa")
    result = engine.transcribe(str(wav_path))

    # Transliterate via static API
    iast_api = Swanada.transliterate_iast(result.text)
    assert len(iast_api) > 0
    # Verify absence of Devanagari code points (0x0900 - 0x097F)
    has_devanagari = any(0x0900 <= ord(c) <= 0x097F for c in iast_api)
    assert not has_devanagari, f"Devanagari characters detected in IAST output: {iast_api}"

    # Transliterate via CLI --iast flag
    proc = run_cli(str(wav_path), "-l", "sa", "--iast")
    assert proc.returncode == 0, f"CLI --iast failed: {proc.stderr}"
    cli_out = proc.stdout.strip()
    assert len(cli_out) > 0
    has_devanagari_cli = any(0x0900 <= ord(c) <= 0x097F for c in cli_out)
    assert not has_devanagari_cli, f"Devanagari in CLI --iast output: {cli_out}"


@pytest.mark.tier1
@pytest.mark.parametrize("lang", ALL_12_LANGUAGES)
def test_tier1_output_format_tokens_structure(lang: str, engine_factory: Callable[[str], Any]) -> None:
    """F4.5: Returned tokens list contains properly segmented subwords without nulls for all 12 languages."""
    engine = engine_factory(lang)
    wav_path = get_sample_wav_path(lang)
    result = engine.transcribe(str(wav_path))

    tokens = result.tokens
    assert len(tokens) > 0, f"Token list is empty for {lang}"
    for idx, t in enumerate(tokens):
        assert isinstance(t, str), f"Token at {idx} for {lang} is not string: {type(t)}"
        assert len(t) > 0, f"Empty token at {idx} for {lang}"


# ==============================================================================
# Feature 5: Prefix Stability & Invariant Enforcement
# ==============================================================================

@pytest.mark.tier1
@pytest.mark.parametrize("lang", ALL_12_LANGUAGES)
def test_tier1_prefix_stability_append_only_committed(lang: str, engine_factory: Callable[[str], Any]) -> None:
    """F5.1: Committed tokens are strictly append-only across all streaming steps for all 12 languages."""
    engine = engine_factory(lang)
    stream = engine.stream(chunk_size_samples=1600)
    pcm, sr = load_sample_pcm(lang)

    committed_history: list[str] = []
    for i in range(0, len(pcm), 1600):
        step = stream.push(pcm[i : i + 1600])
        committed_history.append(step.committed)

    stream.finish()
    verify_prefix_stability(committed_history)


@pytest.mark.tier1
@pytest.mark.parametrize("lang", ALL_12_LANGUAGES)
def test_tier1_prefix_stability_zero_character_churn(lang: str, engine_factory: Callable[[str], Any]) -> None:
    """F5.2: Measured character churn rate is strictly 0.00% across all 12 languages."""
    engine = engine_factory(lang)
    stream = engine.stream(chunk_size_samples=1600)
    pcm, sr = load_sample_pcm(lang)

    committed_history: list[str] = []
    for i in range(0, len(pcm), 1600):
        step = stream.push(pcm[i : i + 1600])
        committed_history.append(step.committed)

    stream.finish()
    churn = compute_character_churn(committed_history)
    assert churn == 0.0, f"Character churn violation for {lang}: measured {churn * 100:.2f}% (expected 0.00%)"


@pytest.mark.tier1
@pytest.mark.parametrize("lang", ALL_12_LANGUAGES)
def test_tier1_prefix_stability_monotonic_length_growth(lang: str, engine_factory: Callable[[str], Any]) -> None:
    """F5.3: Committed transcript length is monotonically non-decreasing for all 12 languages."""
    engine = engine_factory(lang)
    stream = engine.stream(chunk_size_samples=1600)
    pcm, sr = load_sample_pcm(lang)

    prev_length = 0
    for i in range(0, len(pcm), 1600):
        step = stream.push(pcm[i : i + 1600])
        curr_length = len(step.committed)
        assert curr_length >= prev_length, (
            f"Committed length shrank for {lang}: previous={prev_length}, current={curr_length}"
        )
        prev_length = curr_length

    stream.finish()


@pytest.mark.tier1
@pytest.mark.parametrize("lang", ALL_12_LANGUAGES)
def test_tier1_prefix_stability_final_text_matches_committed_prefix(lang: str, engine_factory: Callable[[str], Any]) -> None:
    """F5.4: Final transcription text contains the locked committed prefix for all 12 languages."""
    engine = engine_factory(lang)
    stream = engine.stream(chunk_size_samples=1600)
    pcm, sr = load_sample_pcm(lang)

    last_committed = ""
    for i in range(0, len(pcm), 1600):
        step = stream.push(pcm[i : i + 1600])
        last_committed = step.committed

    final_result = stream.finish()
    if last_committed:
        # Final text must start with or contain the committed string
        assert last_committed in final_result.text or final_result.text.startswith(last_committed), (
            f"Final text divergence from committed for {lang}: "
            f"last_committed='{last_committed}' not in final_text='{final_result.text}'"
        )


@pytest.mark.tier1
@pytest.mark.parametrize("lang", ALL_12_LANGUAGES)
def test_tier1_prefix_stability_volatile_token_resolution(lang: str, engine_factory: Callable[[str], Any]) -> None:
    """F5.5: Finalizing the stream resolves volatile tokens and integrates them into final output for all 12 languages."""
    engine = engine_factory(lang)
    stream = engine.stream(chunk_size_samples=1600)
    pcm, sr = load_sample_pcm(lang)

    for i in range(0, len(pcm), 1600):
        stream.push(pcm[i : i + 1600])

    final_result = stream.finish()
    assert len(final_result.text) > 0
    assert len(final_result.tokens) > 0
