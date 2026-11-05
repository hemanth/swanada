"""Adversarial CLI stress test suite for Swanada Milestone 4.
Tests cross-platform parity between Node.js CLI (js/bin/swanada.mjs) and Python CLI (swanada).
"""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import pytest

SWANADA_ROOT = Path("/Users/lika/labs/swanada")
NODE_CLI = SWANADA_ROOT / "js/bin/swanada.mjs"
WAV_PATH = Path("/Users/lika/labs/ninada/data/wavs/sa_rasa_male_01445fb1731b.wav")
EXPECTED_DEVANAGARI = "अहं तत्रत्यानां कतिपयसौकर्याणां विषये ज्ञातुमिच्छामि"
EXPECTED_IAST = "ahaṃ tatratyānāṃ katipayasaukaryāṇāṃ viṣaye jñātumicchāmi"


def run_cmd(args, input_bytes=None):
    """Run a command in SWANADA_ROOT and capture stdout, stderr, and exit code."""
    proc = subprocess.run(
        args,
        cwd=str(SWANADA_ROOT),
        input=input_bytes,
        capture_output=True,
    )
    return proc.returncode, proc.stdout.decode("utf-8", errors="replace"), proc.stderr.decode("utf-8", errors="replace")


@pytest.fixture(scope="session")
def check_prerequisites():
    assert WAV_PATH.exists(), f"Reference audio not found: {WAV_PATH}"
    assert NODE_CLI.exists(), f"Node CLI not found: {NODE_CLI}"


# -------------------------------------------------------------
# 1. Version and Help
# -------------------------------------------------------------
def test_cli_version(check_prerequisites):
    code_node, out_node, _ = run_cmd(["node", str(NODE_CLI), "--version"])
    code_py, out_py, _ = run_cmd(["uv", "run", "swanada", "--version"])

    assert code_node == 0, f"Node --version failed: {out_node}"
    assert code_py == 0, f"Python --version failed: {out_py}"
    assert out_node.strip() == "swanada 1.0.0"
    assert out_py.strip() == "swanada 1.0.0"


def test_cli_help(check_prerequisites):
    code_node, out_node, _ = run_cmd(["node", str(NODE_CLI), "--help"])
    code_py, out_py, _ = run_cmd(["uv", "run", "swanada", "--help"])

    assert code_node == 0
    assert code_py == 0
    for flag in ["-l", "--language", "-m", "--model-dir", "-o", "--output", "--json", "--stream", "--iast", "--threads"]:
        assert flag in out_node, f"Node CLI help missing flag: {flag}"
        assert flag in out_py, f"Python CLI help missing flag: {flag}"


# -------------------------------------------------------------
# 2. Basic File Transcription & Devanagari Parity
# -------------------------------------------------------------
def test_cli_basic_file_transcription(check_prerequisites):
    code_node, out_node, err_node = run_cmd(["node", str(NODE_CLI), str(WAV_PATH), "-l", "sa"])
    code_py, out_py, err_py = run_cmd(["uv", "run", "swanada", str(WAV_PATH), "-l", "sa"])

    assert code_node == 0, f"Node CLI failed: {err_node}"
    assert code_py == 0, f"Python CLI failed: {err_py}"
    assert out_node.strip() == EXPECTED_DEVANAGARI
    assert out_py.strip() == EXPECTED_DEVANAGARI


# -------------------------------------------------------------
# 3. Roman IAST Parity (--iast)
# -------------------------------------------------------------
def test_cli_iast_transcription_parity(check_prerequisites):
    code_node, out_node, err_node = run_cmd(["node", str(NODE_CLI), str(WAV_PATH), "-l", "sa", "--iast"])
    code_py, out_py, err_py = run_cmd(["uv", "run", "swanada", str(WAV_PATH), "-l", "sa", "--iast"])

    assert code_node == 0, f"Node CLI failed: {err_node}"
    assert code_py == 0, f"Python CLI failed: {err_py}"
    assert out_node.strip() == EXPECTED_IAST
    assert out_py.strip() == EXPECTED_IAST
    assert out_node.strip() == out_py.strip(), "Node and Python IAST outputs do not match exactly"


# -------------------------------------------------------------
# 4. Standard Input Piping
# -------------------------------------------------------------
def test_cli_stdin_pipe_explicit_dash(check_prerequisites):
    wav_bytes = WAV_PATH.read_bytes()
    code_node, out_node, err_node = run_cmd(["node", str(NODE_CLI), "-", "-l", "sa"], input_bytes=wav_bytes)
    code_py, out_py, err_py = run_cmd(["uv", "run", "swanada", "-", "-l", "sa"], input_bytes=wav_bytes)

    assert code_node == 0, f"Node CLI stdin failed: {err_node}"
    assert code_py == 0, f"Python CLI stdin failed: {err_py}"
    assert out_node.strip() == EXPECTED_DEVANAGARI
    assert out_py.strip() == EXPECTED_DEVANAGARI


def test_cli_stdin_pipe_implicit_no_positional(check_prerequisites):
    wav_bytes = WAV_PATH.read_bytes()
    code_node, out_node, err_node = run_cmd(["node", str(NODE_CLI), "-l", "sa"], input_bytes=wav_bytes)
    code_py, out_py, err_py = run_cmd(["uv", "run", "swanada", "-l", "sa"], input_bytes=wav_bytes)

    assert code_node == 0, f"Node CLI implicit stdin failed: {err_node}"
    assert code_py == 0, f"Python CLI implicit stdin failed: {err_py}"
    assert out_node.strip() == EXPECTED_DEVANAGARI
    assert out_py.strip() == EXPECTED_DEVANAGARI


# -------------------------------------------------------------
# 5. Output File Redirection (-o / --output)
# -------------------------------------------------------------
def test_cli_output_redirection(check_prerequisites):
    with tempfile.TemporaryDirectory() as tmpdir:
        out_node_file = Path(tmpdir) / "sub" / "node_out.txt"
        out_py_file = Path(tmpdir) / "sub" / "py_out.txt"

        code_node, stdout_node, err_node = run_cmd(["node", str(NODE_CLI), str(WAV_PATH), "-l", "sa", "-o", str(out_node_file)])
        code_py, stdout_py, err_py = run_cmd(["uv", "run", "swanada", str(WAV_PATH), "-l", "sa", "-o", str(out_py_file)])

        assert code_node == 0, f"Node CLI redirection failed: {err_node}"
        assert code_py == 0, f"Python CLI redirection failed: {err_py}"
        assert stdout_node == "", "Node CLI should write to file, not stdout"
        assert stdout_py == "", "Python CLI should write to file, not stdout"

        assert out_node_file.exists()
        assert out_py_file.exists()
        assert out_node_file.read_text(encoding="utf-8").strip() == EXPECTED_DEVANAGARI
        assert out_py_file.read_text(encoding="utf-8").strip() == EXPECTED_DEVANAGARI


# -------------------------------------------------------------
# 6. JSON Schema Validation & Metric Parity (--json)
# -------------------------------------------------------------
def test_cli_json_schema_validation(check_prerequisites):
    code_node, out_node, err_node = run_cmd(["node", str(NODE_CLI), str(WAV_PATH), "-l", "sa", "--json"])
    code_py, out_py, err_py = run_cmd(["uv", "run", "swanada", str(WAV_PATH), "-l", "sa", "--json"])

    assert code_node == 0, f"Node CLI --json failed: {err_node}"
    assert code_py == 0, f"Python CLI --json failed: {err_py}"

    json_node = json.loads(out_node)
    json_py = json.loads(out_py)

    required_fields = ["text", "language", "durationMs", "inferenceMs", "rtf", "tokens", "mode"]
    for field in required_fields:
        assert field in json_node, f"Node JSON missing field: {field}"
        assert field in json_py, f"Python JSON missing field: {field}"

    assert json_node["text"] == EXPECTED_DEVANAGARI
    assert json_py["text"] == EXPECTED_DEVANAGARI
    assert json_node["language"] == "sa"
    assert json_py["language"] == "sa"
    assert json_node["mode"] == "batch"
    assert json_py["mode"] == "batch"

    # Numeric constraints
    assert json_node["durationMs"] > 4000
    assert json_py["durationMs"] > 4000
    assert json_node["inferenceMs"] > 0
    assert json_py["inferenceMs"] > 0
    assert json_node["rtf"] > 0 and json_node["rtf"] < 1.0, f"Node RTF {json_node['rtf']} >= 1.0"
    assert json_py["rtf"] > 0 and json_py["rtf"] < 1.0, f"Python RTF {json_py['rtf']} >= 1.0"
    assert len(json_node["tokens"]) > 0
    assert len(json_py["tokens"]) > 0


# -------------------------------------------------------------
# 7. Streaming Simulation (--stream)
# -------------------------------------------------------------
def test_cli_streaming_simulation(check_prerequisites):
    code_node, out_node, err_node = run_cmd(["node", str(NODE_CLI), str(WAV_PATH), "-l", "sa", "--stream", "--json"])
    code_py, out_py, err_py = run_cmd(["uv", "run", "swanada", str(WAV_PATH), "-l", "sa", "--stream", "--json"])

    assert code_node == 0, f"Node CLI stream failed: {err_node}"
    assert code_py == 0, f"Python CLI stream failed: {err_py}"

    json_node = json.loads(out_node)
    json_py = json.loads(out_py)

    assert json_node["mode"] == "streaming"
    assert json_py["mode"] == "streaming"
    assert json_node["text"] == EXPECTED_DEVANAGARI
    assert json_py["text"] == EXPECTED_DEVANAGARI


# -------------------------------------------------------------
# 8. All Flags Permutation Combined
# -------------------------------------------------------------
def test_cli_all_flags_combined(check_prerequisites):
    with tempfile.TemporaryDirectory() as tmpdir:
        out_node_file = Path(tmpdir) / "node_combo.json"
        out_py_file = Path(tmpdir) / "py_combo.json"
        wav_bytes = WAV_PATH.read_bytes()

        # Stdin + stream + iast + json + output file
        cmd_node = ["node", str(NODE_CLI), "-", "-l", "sa", "--stream", "--iast", "--json", "-o", str(out_node_file)]
        cmd_py = ["uv", "run", "swanada", "-", "-l", "sa", "--stream", "--iast", "--json", "-o", str(out_py_file)]

        code_node, _, err_node = run_cmd(cmd_node, input_bytes=wav_bytes)
        code_py, _, err_py = run_cmd(cmd_py, input_bytes=wav_bytes)

        assert code_node == 0, f"Node combo failed: {err_node}"
        assert code_py == 0, f"Python combo failed: {err_py}"

        node_data = json.loads(out_node_file.read_text(encoding="utf-8"))
        py_data = json.loads(out_py_file.read_text(encoding="utf-8"))

        assert node_data["text"] == EXPECTED_IAST
        assert py_data["text"] == EXPECTED_IAST
        assert node_data["mode"] == "streaming"
        assert py_data["mode"] == "streaming"


# -------------------------------------------------------------
# 9. Adversarial Error Handling & Exit Codes
# -------------------------------------------------------------
def test_cli_invalid_language_error(check_prerequisites):
    code_node, _, err_node = run_cmd(["node", str(NODE_CLI), str(WAV_PATH), "-l", "klingon"])
    code_py, _, err_py = run_cmd(["uv", "run", "swanada", str(WAV_PATH), "-l", "klingon"])

    assert code_node != 0, "Node CLI should fail on invalid language"
    assert code_py != 0, "Python CLI should fail on invalid language"
    assert "Unsupported language" in err_node
    assert "Unsupported language" in err_py


def test_cli_missing_input_file_error(check_prerequisites):
    nonexistent = SWANADA_ROOT / "nonexistent_audio_file.wav"
    code_node, _, err_node = run_cmd(["node", str(NODE_CLI), str(nonexistent), "-l", "sa"])
    code_py, _, err_py = run_cmd(["uv", "run", "swanada", str(nonexistent), "-l", "sa"])

    assert code_node != 0, "Node CLI should fail on nonexistent input"
    assert code_py != 0, "Python CLI should fail on nonexistent input"
    assert "Input file not found" in err_node
    assert "Input file not found" in err_py


def test_cli_empty_stdin_error(check_prerequisites):
    code_node, _, err_node = run_cmd(["node", str(NODE_CLI), "-"], input_bytes=b"")
    code_py, _, err_py = run_cmd(["uv", "run", "swanada", "-"], input_bytes=b"")

    assert code_node != 0, "Node CLI should fail on empty stdin"
    assert code_py != 0, "Python CLI should fail on empty stdin"
    assert "Empty standard input received" in err_node
    assert "Empty standard input received" in err_py


def test_cli_corrupted_audio_file_error(check_prerequisites):
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        f.write(b"NOT_A_VALID_WAV_HEADER_DATA_1234567890")
        f.flush()
        corrupt_path = f.name

    try:
        code_node, _, err_node = run_cmd(["node", str(NODE_CLI), corrupt_path, "-l", "sa"])
        code_py, _, err_py = run_cmd(["uv", "run", "swanada", corrupt_path, "-l", "sa"])

        assert code_node != 0, "Node CLI should fail on corrupt audio file"
        assert code_py != 0, "Python CLI should fail on corrupt audio file"
        assert "Error parsing WAV audio" in err_node or "Error" in err_node
        assert "Error" in err_py
    finally:
        Path(corrupt_path).unlink(missing_ok=True)
