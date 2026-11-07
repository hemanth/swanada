"""Shared fixtures, environment configuration, and runners for Swanada E2E Test Suite."""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Callable, Generator

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
PYTHON_SRC = REPO_ROOT / "python" / "src"
if str(PYTHON_SRC) not in sys.path:
    sys.path.insert(0, str(PYTHON_SRC))
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from tests.e2e.helpers import (
    BLANK_TOKEN_ID,
    FRAME_HOP_SAMPLES,
    FRAME_WINDOW_SAMPLES,
    N_MELS,
    SAMPLE_RATE,
    create_noise_pcm,
    create_silence_pcm,
    create_sine_pcm,
    encode_wav_bytes,
    verify_pcm_samples,
    verify_transcription_result,
    verify_wav_header,
)

# Attempt dynamic import of swanada package if implemented
try:
    import swanada
    from swanada import Swanada, TranscriptionResult
except ImportError:
    swanada = None
    Swanada = None
    TranscriptionResult = None


# Reference and fallback paths
NINADA_DIR = Path("/Users/lika/labs/ninada")
HELD_OUT_AUDIO_DIR = NINADA_DIR / "artifacts" / "ninada_v3" / "test_gt_wavs"


def pytest_configure(config: Any) -> None:
    """Register custom markers to avoid PytestUnknownMarkWarning."""
    for tier in ["tier1", "tier2", "tier3", "tier4"]:
        config.addinivalue_line("markers", f"{tier}: marker for {tier} tests")
    for m in range(1, 6):
        config.addinivalue_line("markers", f"m{m}: marker for milestone M{m}")
    for f in range(1, 23):
        config.addinivalue_line("markers", f"f{f:02d}: marker for feature {f}")


@pytest.fixture(scope="session")
def is_swanada_available() -> bool:
    """Check if the python swanada package is importable."""
    return Swanada is not None


_ENGINE_CACHE: dict[str, Any] = {}


def get_engine_or_skip(lang: str) -> Any:
    """Instantiate or retrieve a cached Swanada engine for the given language."""
    if Swanada is None:
        pytest.skip(f"swanada Python package not yet implemented (milestone pending for lang: {lang})")
    if lang in _ENGINE_CACHE:
        return _ENGINE_CACHE[lang]
    try:
        engine = Swanada(language=lang)
        _ENGINE_CACHE[lang] = engine
        return engine
    except Exception as e:
        pytest.skip(f"Swanada engine for '{lang}' not yet ready: {e}")


@pytest.fixture(scope="session")
def engine_factory() -> Callable[[str], Any]:
    """Factory fixture returning cached Swanada engines across all 12 languages."""
    return get_engine_or_skip



@pytest.fixture(scope="session")
def engine_sa() -> Any:
    """Classical Sanskrit engine instance."""
    return get_engine_or_skip("sa")


@pytest.fixture(scope="session")
def engine_hi() -> Any:
    """Hindi engine instance."""
    return get_engine_or_skip("hi")


@pytest.fixture(scope="session")
def engine_en() -> Any:
    """Indian English engine instance."""
    return get_engine_or_skip("en")


@pytest.fixture(scope="session")
def engine_kn() -> Any:
    """Kannada engine instance."""
    return get_engine_or_skip("kn")


@pytest.fixture(scope="session")
def engine_ta() -> Any:
    """Tamil engine instance."""
    return get_engine_or_skip("ta")


@pytest.fixture(scope="session")
def engine_te() -> Any:
    """Telugu engine instance."""
    return get_engine_or_skip("te")


@pytest.fixture(scope="session")
def engine_ml() -> Any:
    """Malayalam engine instance."""
    return get_engine_or_skip("ml")


@pytest.fixture(scope="session")
def engine_mr() -> Any:
    """Marathi engine instance."""
    return get_engine_or_skip("mr")


@pytest.fixture(scope="session")
def engine_bn() -> Any:
    """Bengali engine instance."""
    return get_engine_or_skip("bn")


@pytest.fixture(scope="session")
def engine_gu() -> Any:
    """Gujarati engine instance."""
    return get_engine_or_skip("gu")


@pytest.fixture(scope="session")
def engine_pa() -> Any:
    """Punjabi engine instance."""
    return get_engine_or_skip("pa")


@pytest.fixture(scope="session")
def engine_or() -> Any:
    """Odia engine instance."""
    return get_engine_or_skip("or")


@pytest.fixture(scope="session")
def run_cli() -> Callable[..., subprocess.CompletedProcess[str]]:
    """Helper fixture to execute swanada CLI via Python or Node subprocess."""

    def _runner(*args: str, input_stdin: str | bytes | None = None, runtime: str = "python") -> subprocess.CompletedProcess[str]:
        env = os.environ.copy()
        env["PYTHONPATH"] = f"{PYTHON_SRC}:{env.get('PYTHONPATH', '')}"

        if runtime == "python":
            cli_module = REPO_ROOT / "python" / "src" / "swanada" / "cli.py"
            if not cli_module.exists():
                pytest.skip("Python CLI module (swanada/cli.py) not yet implemented")
            cmd = [sys.executable, "-m", "swanada.cli", *args]
        elif runtime == "node":
            node_cli = REPO_ROOT / "js" / "bin" / "swanada.mjs"
            if not node_cli.exists():
                pytest.skip("Node CLI binary (js/bin/swanada.mjs) not yet implemented")
            cmd = ["node", str(node_cli), *args]
        else:
            raise ValueError(f"Unsupported runtime: {runtime}")

        return subprocess.run(
            cmd,
            input=input_stdin if isinstance(input_stdin, str) else None,
            text=True,
            capture_output=True,
            cwd=str(REPO_ROOT),
            env=env,
        )

    return _runner


@pytest.fixture
def temp_wav_factory() -> Generator[Callable[..., Path], None, None]:
    """Factory fixture generating temporary WAV files on disk."""
    temp_dir = tempfile.mkdtemp(prefix="swanada_test_wav_")

    def _create(
        duration_sec: float = 1.0,
        freq: float = 440.0,
        sample_rate: int = SAMPLE_RATE,
        silence: bool = False,
    ) -> Path:
        p = Path(temp_dir) / f"clip_{os.urandom(4).hex()}.wav"
        if silence:
            samples = create_silence_pcm(duration_sec, sample_rate=sample_rate)
        else:
            samples = create_sine_pcm(duration_sec, freq=freq, sample_rate=sample_rate)
        wav_bytes = encode_wav_bytes(samples, sample_rate=sample_rate)
        p.write_bytes(wav_bytes)
        return p

    yield _create
    shutil.rmtree(temp_dir, ignore_errors=True)
