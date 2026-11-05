"""Challenger M4 Iteration 6: Comprehensive Multi-Runtime CLI Adversarial Stress Suite.
Adversarially validates:
1. Multi-language transcription across all 12 supported languages.
2. Roman IAST transliteration on Classical Sanskrit.
3. Positional and implicit standard input streaming pipes.
4. Chunked streaming mode (--stream).
5. Custom model directory loading (relative, absolute, isolated).
6. Resiliency against corrupt audio, empty streams, and invalid arguments.
Strictly zero first-person pronouns.
"""

import json
from pathlib import Path
import subprocess
import tempfile
import pytest

SWANADA_ROOT = Path("/Users/lika/labs/swanada")
NODE_CLI = SWANADA_ROOT / "js/bin/swanada.mjs"
REF_WAV = Path("/Users/lika/labs/ninada/data/wavs/sa_rasa_male_01445fb1731b.wav")
EXPECTED_SA_DEVANAGARI = "अहं तत्रत्यानां कतिपयसौकर्याणां विषये ज्ञातुमिच्छामि"
EXPECTED_SA_IAST = "ahaṃ tatratyānāṃ katipayasaukaryāṇāṃ viṣaye jñātumicchāmi"
LANGUAGES = ["sa", "en", "hi", "kn", "mr", "bn", "ta", "te", "ml", "gu", "pa", "or"]


def exec_cmd(cmd_list, input_bytes=None):
    """Execute command in SWANADA_ROOT and return returncode, stdout, stderr."""
    proc = subprocess.run(
        cmd_list,
        cwd=str(SWANADA_ROOT),
        input=input_bytes,
        capture_output=True,
    )
    return proc.returncode, proc.stdout.decode("utf-8", errors="replace"), proc.stderr.decode("utf-8", errors="replace")


@pytest.fixture(scope="session")
def env_prerequisites():
    assert REF_WAV.exists(), f"Reference WAV missing: {REF_WAV}"
    assert NODE_CLI.exists(), f"Node CLI missing: {NODE_CLI}"


# ==============================================================================
# 1. Multi-Language Transcription & IAST Parity
# ==============================================================================

def test_sanskrit_devanagari_and_iast_parity_across_runtimes(env_prerequisites):
    """Verify Sanskrit Devanagari and Roman IAST match exactly across Node and Python CLIs."""
    # Devanagari
    code_node, out_node, err_node = exec_cmd(["node", str(NODE_CLI), "-l", "sa", str(REF_WAV)])
    code_py, out_py, err_py = exec_cmd(["uv", "run", "swanada", "-l", "sa", str(REF_WAV)])
    code_pymod, out_pymod, err_pymod = exec_cmd(["uv", "run", "python", "-m", "swanada.cli", "-l", "sa", str(REF_WAV)])

    assert code_node == 0, f"Node CLI failed: {err_node}"
    assert code_py == 0, f"Python CLI failed: {err_py}"
    assert code_pymod == 0, f"Python module CLI failed: {err_pymod}"

    assert out_node.strip() == EXPECTED_SA_DEVANAGARI
    assert out_py.strip() == EXPECTED_SA_DEVANAGARI
    assert out_pymod.strip() == EXPECTED_SA_DEVANAGARI

    # Roman IAST
    code_node_iast, out_node_iast, _ = exec_cmd(["node", str(NODE_CLI), "-l", "sa", "--iast", str(REF_WAV)])
    code_py_iast, out_py_iast, _ = exec_cmd(["uv", "run", "swanada", "-l", "sa", "--iast", str(REF_WAV)])
    code_pymod_iast, out_pymod_iast, _ = exec_cmd(["uv", "run", "python", "-m", "swanada.cli", "-l", "sa", "--iast", str(REF_WAV)])

    assert code_node_iast == 0
    assert code_py_iast == 0
    assert code_pymod_iast == 0

    assert out_node_iast.strip() == EXPECTED_SA_IAST
    assert out_py_iast.strip() == EXPECTED_SA_IAST
    assert out_pymod_iast.strip() == EXPECTED_SA_IAST


@pytest.mark.parametrize("lang", LANGUAGES)
def test_all_12_languages_json_execution(lang, env_prerequisites):
    """Verify every supported language executes through CLI in --json mode without crash."""
    sample_wav = SWANADA_ROOT / "docs" / "samples" / f"{lang}.wav"
    target_audio = str(sample_wav if sample_wav.exists() else REF_WAV)

    code_node, out_node, err_node = exec_cmd(["node", str(NODE_CLI), "-l", lang, "--json", target_audio])
    code_py, out_py, err_py = exec_cmd(["uv", "run", "swanada", "-l", lang, "--json", target_audio])

    assert code_node == 0, f"Node failed on lang {lang}: {err_node}"
    assert code_py == 0, f"Python failed on lang {lang}: {err_py}"

    parsed_node = json.loads(out_node)
    parsed_py = json.loads(out_py)

    for key in ["text", "language", "durationMs", "inferenceMs", "rtf", "tokens", "mode"]:
        assert key in parsed_node, f"Node JSON missing key: {key} for lang {lang}"
        assert key in parsed_py, f"Python JSON missing key: {key} for lang {lang}"

    assert parsed_node["language"] == lang
    assert parsed_py["language"] == lang
    assert parsed_node["durationMs"] > 0
    assert parsed_py["durationMs"] > 0


# ==============================================================================
# 2. Stdin Pipe Streaming Parity
# ==============================================================================

def test_stdin_pipe_streaming_dash_positions(env_prerequisites):
    """Verify stdin piping with dash preceding and following options."""
    audio_bytes = REF_WAV.read_bytes()

    # Dash as first positional argument
    c1, o1, e1 = exec_cmd(["node", str(NODE_CLI), "-", "-l", "sa"], input_bytes=audio_bytes)
    c2, o2, e2 = exec_cmd(["uv", "run", "swanada", "-", "-l", "sa"], input_bytes=audio_bytes)
    c3, o3, e3 = exec_cmd(["uv", "run", "python", "-m", "swanada.cli", "-", "-l", "sa"], input_bytes=audio_bytes)

    assert c1 == 0, f"Node pipe dash failed: {e1}"
    assert c2 == 0, f"Python pipe dash failed: {e2}"
    assert c3 == 0, f"Python module pipe dash failed: {e3}"
    assert o1.strip() == EXPECTED_SA_DEVANAGARI
    assert o2.strip() == EXPECTED_SA_DEVANAGARI
    assert o3.strip() == EXPECTED_SA_DEVANAGARI

    # Dash as last positional argument
    c4, o4, e4 = exec_cmd(["node", str(NODE_CLI), "-l", "sa", "-"], input_bytes=audio_bytes)
    c5, o5, e5 = exec_cmd(["uv", "run", "swanada", "-l", "sa", "-"], input_bytes=audio_bytes)
    assert c4 == 0, f"Node pipe trailing dash failed: {e4}"
    assert c5 == 0, f"Python pipe trailing dash failed: {e5}"
    assert o4.strip() == EXPECTED_SA_DEVANAGARI
    assert o5.strip() == EXPECTED_SA_DEVANAGARI

    # Implicit stdin without positional dash
    c6, o6, e6 = exec_cmd(["node", str(NODE_CLI), "-l", "sa"], input_bytes=audio_bytes)
    c7, o7, e7 = exec_cmd(["uv", "run", "swanada", "-l", "sa"], input_bytes=audio_bytes)
    assert c6 == 0, f"Node implicit pipe failed: {e6}"
    assert c7 == 0, f"Python implicit pipe failed: {e7}"
    assert o6.strip() == EXPECTED_SA_DEVANAGARI
    assert o7.strip() == EXPECTED_SA_DEVANAGARI


def test_stdin_chunked_streaming_mode(env_prerequisites):
    """Verify stdin pipe combined with --stream flag."""
    audio_bytes = REF_WAV.read_bytes()

    c1, o1, e1 = exec_cmd(["node", str(NODE_CLI), "-", "-l", "sa", "--stream"], input_bytes=audio_bytes)
    c2, o2, e2 = exec_cmd(["uv", "run", "swanada", "-", "-l", "sa", "--stream"], input_bytes=audio_bytes)
    c3, o3, e3 = exec_cmd(["uv", "run", "python", "-m", "swanada.cli", "-", "-l", "sa", "--stream"], input_bytes=audio_bytes)

    assert c1 == 0, f"Node stream pipe failed: {e1}"
    assert c2 == 0, f"Python stream pipe failed: {e2}"
    assert c3 == 0, f"Python module stream pipe failed: {e3}"

    assert o1.strip() == EXPECTED_SA_DEVANAGARI
    assert o2.strip() == EXPECTED_SA_DEVANAGARI
    assert o3.strip() == EXPECTED_SA_DEVANAGARI


# ==============================================================================
# 3. Directory Model Loading
# ==============================================================================

def test_directory_model_loading_relative_and_absolute(env_prerequisites):
    """Verify -m model directory loading with relative and absolute paths."""
    # Relative path
    c1, o1, e1 = exec_cmd(["node", str(NODE_CLI), "-l", "sa", "-m", "models", str(REF_WAV)])
    c2, o2, e2 = exec_cmd(["uv", "run", "swanada", "-l", "sa", "-m", "models", str(REF_WAV)])
    assert c1 == 0, f"Node relative -m failed: {e1}"
    assert c2 == 0, f"Python relative -m failed: {e2}"
    assert o1.strip() == EXPECTED_SA_DEVANAGARI
    assert o2.strip() == EXPECTED_SA_DEVANAGARI

    # Absolute path
    abs_models = str(SWANADA_ROOT / "models")
    c3, o3, e3 = exec_cmd(["node", str(NODE_CLI), "-l", "sa", "-m", abs_models, str(REF_WAV)])
    c4, o4, e4 = exec_cmd(["uv", "run", "swanada", "-l", "sa", "-m", abs_models, str(REF_WAV)])
    assert c3 == 0, f"Node absolute -m failed: {e3}"
    assert c4 == 0, f"Python absolute -m failed: {e4}"
    assert o3.strip() == EXPECTED_SA_DEVANAGARI
    assert o4.strip() == EXPECTED_SA_DEVANAGARI

    # Subdirectory models/onnx
    c5, o5, e5 = exec_cmd(["node", str(NODE_CLI), "-l", "sa", "-m", "models/onnx", str(REF_WAV)])
    c6, o6, e6 = exec_cmd(["uv", "run", "swanada", "-l", "sa", "-m", "models/onnx", str(REF_WAV)])
    assert c5 == 0, f"Node subfolder -m failed: {e5}"
    assert c6 == 0, f"Python subfolder -m failed: {e6}"
    assert o5.strip() == EXPECTED_SA_DEVANAGARI
    assert o6.strip() == EXPECTED_SA_DEVANAGARI


def test_isolated_custom_model_directory(env_prerequisites):
    """Verify transcription against a populated custom model directory in temporary storage."""
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        (temp_path / "onnx").mkdir()
        (temp_path / "vocabularies").mkdir()

        # Copy model weights and vocabulary
        src_model = SWANADA_ROOT / "models" / "onnx" / "sushrota_sanskrit_ctc_int8.onnx"
        src_vocab = SWANADA_ROOT / "models" / "vocabularies" / "sanskrit_vocab.json"
        (temp_path / "onnx" / "sushrota_sanskrit_ctc_int8.onnx").write_bytes(src_model.read_bytes())
        (temp_path / "vocabularies" / "sanskrit_vocab.json").write_bytes(src_vocab.read_bytes())

        c1, o1, e1 = exec_cmd(["node", str(NODE_CLI), "-l", "sa", "-m", str(temp_path), str(REF_WAV)])
        c2, o2, e2 = exec_cmd(["uv", "run", "swanada", "-l", "sa", "-m", str(temp_path), str(REF_WAV)])

        assert c1 == 0, f"Node custom dir failed: {e1}"
        assert c2 == 0, f"Python custom dir failed: {e2}"
        assert o1.strip() == EXPECTED_SA_DEVANAGARI
        assert o2.strip() == EXPECTED_SA_DEVANAGARI


# ==============================================================================
# 4. Adversarial Error Paths
# ==============================================================================

def test_empty_stdin_error_exit(env_prerequisites):
    """Verify empty standard input triggers exit code 1 with diagnostic message."""
    c1, _, e1 = exec_cmd(["node", str(NODE_CLI), "-"], input_bytes=b"")
    c2, _, e2 = exec_cmd(["uv", "run", "swanada", "-"], input_bytes=b"")

    assert c1 == 1
    assert c2 == 1
    assert "Empty standard input received" in e1
    assert "Empty standard input received" in e2


def test_missing_input_audio_error_exit(env_prerequisites):
    """Verify omitting input audio file triggers exit code 1 with appropriate diagnostic message."""
    import pty, os

    # Non-TTY pipe with empty stdin
    c1, _, e1 = exec_cmd(["node", str(NODE_CLI), "-l", "sa"])
    c2, _, e2 = exec_cmd(["uv", "run", "swanada", "-l", "sa"])
    assert c1 == 1
    assert c2 == 1
    assert "Empty standard input received" in e1
    assert "Empty standard input received" in e2

    # Interactive TTY without input argument
    master, slave = pty.openpty()
    try:
        p_node = subprocess.run(["node", str(NODE_CLI), "-l", "sa"], stdin=slave, capture_output=True, text=True)
        p_py = subprocess.run(["uv", "run", "swanada", "-l", "sa"], stdin=slave, capture_output=True, text=True)
        assert p_node.returncode == 1
        assert p_py.returncode == 1
        assert "Missing input audio" in p_node.stderr
        assert "Missing input audio" in p_py.stderr
    finally:
        os.close(slave)
        os.close(master)


def test_corrupt_audio_input_error_exit(env_prerequisites):
    """Verify corrupted audio payload triggers clean non-zero exit code."""
    corrupt_bytes = b"RIFF\x00\x00\x00\x00WAVEfmt \x10\x00\x00\x00INVALID_DATA_CHUNKS"
    c1, _, e1 = exec_cmd(["node", str(NODE_CLI), "-", "-l", "sa"], input_bytes=corrupt_bytes)
    c2, _, e2 = exec_cmd(["uv", "run", "swanada", "-", "-l", "sa"], input_bytes=corrupt_bytes)

    assert c1 != 0
    assert c2 != 0
    assert "Error" in e1
    assert "Error" in e2
