"""Command-line interface for Swanada (Multilingual Speech-to-Text)."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from typing import Any, Dict, List, Optional

from .audio import load_audio
from .core import Swanada
from .engine import TranscriptionResult
from .vocab import SUPPORTED_LANGUAGES


def parse_cli_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="swanada",
        description="Swanada (स्वनद) — 16 kHz Multilingual Indic Speech-to-Text CLI",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  swanada audio.wav -l sa\n"
            "  swanada speech.wav -l hi --json -o output.json\n"
            "  cat stream.wav | swanada -l kn --stream\n"
        ),
    )
    parser.add_argument(
        "input",
        nargs="?",
        default=None,
        help="Input WAV audio file path or '-' for stdin pipe (default: stdin if piped)",
    )
    parser.add_argument(
        "-l",
        "--language",
        "--lang",
        dest="language",
        default="sa",
        help="Target language code: sa | en | hi | kn | mr | bn | ta | te | ml | gu | pa | or (default: sa)",
    )
    parser.add_argument(
        "-m",
        "--model-dir",
        "--model",
        dest="model_dir",
        default=None,
        help="Path to custom model directory containing ONNX weights and vocabularies",
    )
    parser.add_argument(
        "-o",
        "--output",
        "--out",
        dest="output",
        type=Path,
        default=None,
        help="Output file path (default: stdout)",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        dest="json_output",
        help="Emit structured JSON with text, durationMs, inferenceMs, rtf, and tokens",
    )
    parser.add_argument(
        "--stream",
        action="store_true",
        dest="stream_mode",
        help="Simulate real-time chunked streaming transcription (320ms / 5120 sample quanta)",
    )
    parser.add_argument(
        "--threads",
        type=int,
        default=4,
        dest="threads",
        help="Number of inference execution threads (default: 4)",
    )
    parser.add_argument(
        "--iast",
        action="store_true",
        dest="iast_mode",
        help="Transliterate Classical Sanskrit output to Roman IAST with Vedic accents",
    )
    parser.add_argument(
        "-v",
        "--version",
        action="version",
        version="swanada 1.0.0",
        help="Display version information and exit",
    )
    return parser.parse_args(argv)


def result_to_dict(result: TranscriptionResult, mode: str = "batch", text_override: Optional[str] = None) -> Dict[str, Any]:
    transcript_text = text_override if text_override is not None else result.text
    return {
        "text": transcript_text,
        "language": result.language,
        "durationMs": float(result.duration_ms),
        "duration_ms": float(result.duration_ms),
        "inferenceMs": float(result.inference_ms),
        "inference_ms": float(result.inference_ms),
        "rtf": round(float(result.rtf), 4),
        "tokens": list(result.tokens),
        "mode": mode,
    }


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_cli_args(argv)

    lang = args.language.lower().strip()
    if lang not in SUPPORTED_LANGUAGES:
        sys.stderr.write(
            f"Error: Unsupported language '{lang}'. Supported languages: {', '.join(sorted(SUPPORTED_LANGUAGES))}\n"
        )
        return 1

    # Resolve audio source
    input_arg = args.input
    raw_audio_bytes: Optional[bytes] = None
    input_file_path: Optional[Path] = None

    if input_arg == "-" or (input_arg is None and not sys.stdin.isatty()):
        try:
            raw_audio_bytes = sys.stdin.buffer.read()
            if not raw_audio_bytes:
                sys.stderr.write("Error: Empty standard input received.\n")
                return 1
        except Exception as e:
            sys.stderr.write(f"Error reading from stdin: {e}\n")
            return 1
    elif input_arg:
        input_file_path = Path(input_arg)
        if not input_file_path.exists():
            sys.stderr.write(f"Error: Input file not found: {input_file_path}\n")
            return 1
    else:
        sys.stderr.write("Error: Missing input audio. Provide <input.wav> or pipe via stdin.\n")
        sys.stderr.write("Usage: swanada -l <lang> [-m <model_dir>] [-o <output.txt>] [--json] [--stream] <input.wav>\n")
        return 1

    # Initialize Engine
    try:
        model_dir = Path(args.model_dir) if args.model_dir else None
        stt = Swanada.create(language=lang, model_dir=model_dir, num_threads=args.threads)
    except Exception as e:
        sys.stderr.write(f"Error initializing Swanada engine: {e}\n")
        return 2

    # Process Audio
    try:
        if raw_audio_bytes is not None:
            pcm = load_audio(raw_audio_bytes, target_sr=16000)
        else:
            assert input_file_path is not None
            pcm = load_audio(input_file_path, target_sr=16000)

        if args.stream_mode:
            stream_session = stt.stream(chunk_size_samples=5120)
            chunk_size = 5120
            total_samples = len(pcm)
            for offset in range(0, total_samples, chunk_size):
                chunk = pcm[offset : offset + chunk_size]
                stream_session.push(chunk)
            result = stream_session.finish()
            mode = "streaming"
        else:
            result = stt.transcribe(pcm)
            mode = "batch"

        final_text = result.text
        if args.iast_mode and lang == "sa" and final_text:
            final_text = Swanada.transliterate_iast(final_text)

    except Exception as e:
        sys.stderr.write(f"Error during transcription: {e}\n")
        return 2

    # Format Output
    if args.json_output:
        res_dict = result_to_dict(result, mode=mode, text_override=final_text)
        output_payload = json.dumps(res_dict, ensure_ascii=False, indent=2) + "\n"
    else:
        output_payload = final_text + "\n"

    # Route Output
    if args.output:
        try:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(output_payload, encoding="utf-8")
        except Exception as e:
            sys.stderr.write(f"Error writing to output file {args.output}: {e}\n")
            return 1
    else:
        sys.stdout.write(output_payload)
        sys.stdout.flush()

    return 0


if __name__ == "__main__":
    sys.exit(main())
