"""Unit, Parity, Streaming, and Silence-Gate Tests for 12-Way Auto-LID & Bilingual Code-Switching."""

from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys

import numpy as np
import pytest

from swanada import (
    LID_LANGUAGES,
    NeuralLIDWeights,
    Swanada,
    decode_bilingual_codeswitch,
    parse_lid_head_bytes,
    serialize_lid_head_bytes,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
SAMPLES_DIR = REPO_ROOT / "docs" / "samples"


def _make_deterministic_lid_weights(seed: int = 1234) -> NeuralLIDWeights:
    rng = np.random.default_rng(seed)
    d_in, d_att, d_hid = 512, 64, 64
    n_langs = len(LID_LANGUAGES)
    return NeuralLIDWeights(
        d_in=d_in,
        d_att=d_att,
        d_hid=d_hid,
        languages=LID_LANGUAGES,
        w_att=rng.normal(0, 0.05, size=(d_in, d_att)).astype(np.float32),
        b_att=rng.normal(0, 0.02, size=(d_att,)).astype(np.float32),
        v_att=rng.normal(0, 0.05, size=(d_att,)).astype(np.float32),
        ln_gamma=np.ones((2 * d_in,), dtype=np.float32),
        ln_beta=np.zeros((2 * d_in,), dtype=np.float32),
        w_fc1=rng.normal(0, 0.05, size=(2 * d_in, d_hid)).astype(np.float32),
        b_fc1=rng.normal(0, 0.02, size=(d_hid,)).astype(np.float32),
        w_fc2=rng.normal(0, 0.05, size=(d_hid, n_langs)).astype(np.float32),
        b_fc2=rng.normal(0, 0.02, size=(n_langs,)).astype(np.float32),
        temperature=1.15,
    )


def test_slid_binary_roundtrip_and_validation() -> None:
    weights = _make_deterministic_lid_weights()
    raw = serialize_lid_head_bytes(weights)
    # 24 header + (512*64 + 64 + 64 + 1024 + 1024 + 1024*64 + 64 + 64*12 + 12 + 1) * 4 = 405,324 bytes
    assert len(raw) == 405_324
    parsed = parse_lid_head_bytes(raw)
    assert parsed.d_in == 512
    assert parsed.d_att == 64
    assert parsed.d_hid == 64
    assert parsed.languages == LID_LANGUAGES
    assert abs(parsed.temperature - 1.15) < 1e-6

    rng = np.random.default_rng(77)
    hidden = rng.normal(0, 1.0, size=(35, 512)).astype(np.float32)
    lp1 = weights.predict_log_probs(hidden)
    lp2 = parsed.predict_log_probs(hidden)
    probs_sum = sum(np.exp(v) for v in lp2.values())
    assert abs(probs_sum - 1.0) < 1e-5
    for lg in LID_LANGUAGES:
        assert abs(lp1[lg] - lp2[lg]) < 1e-6

    with pytest.raises(ValueError):
        parse_lid_head_bytes(b"BAD!" + raw[4:])
    with pytest.raises(ValueError):
        parse_lid_head_bytes(raw[:100])


def test_python_js_lid_neural_head_numerical_parity(tmp_path: Path) -> None:
    weights = _make_deterministic_lid_weights(seed=999)
    lid_file = tmp_path / "lid.bin"
    lid_file.write_bytes(serialize_lid_head_bytes(weights))

    rng = np.random.default_rng(2026)
    hidden = rng.normal(0, 0.8, size=(24, 512)).astype(np.float32)
    hidden_file = tmp_path / "hidden.bin"
    hidden_file.write_bytes(hidden.astype("<f4").tobytes())

    py_lp = weights.predict_log_probs(hidden)

    js_index = REPO_ROOT / "js" / "dist" / "index.mjs"
    script = (
        f"import fs from 'node:fs';\n"
        f"import {{ parseLidHeadBytes, predictLidLogProbs }} from {json.dumps(js_index.as_uri())};\n"
        f"const w = parseLidHeadBytes(new Uint8Array(fs.readFileSync({json.dumps(str(lid_file))})).slice());\n"
        f"const rawH = new Uint8Array(fs.readFileSync({json.dumps(str(hidden_file))})).slice();\n"
        f"const h = new Float32Array(rawH.buffer);\n"
        f"const lp = predictLidLogProbs(w, h, 24);\n"
        f"console.log(JSON.stringify(lp));\n"
    )
    proc = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        check=True,
        capture_output=True,
        text=True,
    )
    js_lp = json.loads(proc.stdout.strip())
    for lg in LID_LANGUAGES:
        assert abs(py_lp[lg] - js_lp[lg]) < 1e-5, f"Parity drift on {lg}: py={py_lp[lg]} js={js_lp[lg]}"


def test_bilingual_codeswitch_decoder_splices_english_and_protects_indic() -> None:
    hi_vocab = [""] + [""] * 256
    en_vocab = [""] + [""] * 256
    # Populate small deterministic subword slots
    hi_vocab[10] = "▁मेरा"
    hi_vocab[11] = "▁अकाउण्ट"
    hi_vocab[12] = "▁चेक"
    hi_vocab[13] = "▁करो"

    en_vocab[20] = "▁"
    en_vocab[21] = "a"
    en_vocab[22] = "c"
    en_vocab[23] = "o"
    en_vocab[24] = "u"
    en_vocab[25] = "n"
    en_vocab[26] = "t"
    en_vocab[27] = "k"
    en_vocab[28] = "a"  # ambiguous 'ka' must NOT override Indic

    t_steps = 28
    indic_logits = np.full((t_steps, 257), -12.0, dtype=np.float32)
    en_logits = np.full((t_steps, 257), -12.0, dtype=np.float32)
    indic_logits[:, 0] = 6.0
    en_logits[:, 0] = 6.0

    # Word 1 (frames 1..4): Hindi "मेरा" confident; English has ambiguous "ka" -> must stay Hindi!
    indic_logits[2, 0] = -5.0
    indic_logits[2, 10] = 8.0
    en_logits[2, 0] = -5.0
    en_logits[2, 20] = 7.0
    en_logits[3, 0] = -5.0
    en_logits[3, 27] = 7.0
    en_logits[4, 0] = -5.0
    en_logits[4, 28] = 7.0

    # Word 2 (frames 8..18): Code-mixed English word "account" has high acoustic certainty vs weak translit
    indic_logits[10, 0] = -1.0
    indic_logits[10, 11] = 0.2  # low confidence Indic guess
    seq_en = [20, 21, 22, 0, 22, 23, 24, 25, 26]  # "▁account"
    for offset, tok_id in enumerate(seq_en):
        f = 8 + offset
        en_logits[f, :] = -12.0
        en_logits[f, tok_id] = 9.5

    # Word 3 (frames 22..25): Hindi "करो"
    indic_logits[23, 0] = -5.0
    indic_logits[23, 13] = 8.5

    res = decode_bilingual_codeswitch(indic_logits, hi_vocab, "hi", en_logits, en_vocab)
    assert "मेरा" in res.text
    assert "account" in res.text
    assert "करो" in res.text
    assert len(res.english_spans) == 1
    sp = res.english_spans[0]
    assert sp.word == "account"
    assert res.text[sp.start_char : sp.end_char] == "account"


def test_auto_lid_end_to_end_silence_and_streaming() -> None:
    stt = Swanada.create(language="auto", code_switch_en=True, num_threads=2)

    # 1. Silence & room-hum must invent 0 words
    silence = np.zeros(32000, dtype=np.float32)
    res_sil = stt.transcribe(silence, sample_rate=16000)
    assert res_sil.text == ""

    t = np.arange(32000, dtype=np.float32) / 16000.0
    hum = (0.001 * np.sin(2.0 * np.pi * 50.0 * t)).astype(np.float32)
    assert stt.transcribe(hum, sample_rate=16000).text == ""

    # 2. Real WAV samples across distinct script families
    for expected_lang in ("hi", "kn", "sa"):
        wav_path = SAMPLES_DIR / f"{expected_lang}.wav"
        res = stt.transcribe(wav_path)
        assert res.language == expected_lang, f"Expected {expected_lang}, got {res.language} ({res.text})"
        assert res.language_confidence is not None and 0.0 < res.language_confidence <= 1.0
        assert res.language_probabilities is not None
        assert abs(sum(res.language_probabilities.values()) - 1.0) < 1e-3
        assert len(res.text.strip()) > 0
        if expected_lang == "sa":
            assert res.iast is not None and len(res.iast) > 0

    # 3. Streaming Auto-LID + final full-utterance pass
    import soundfile as sf

    pcm_sa, sr = sf.read(SAMPLES_DIR / "sa.wav", dtype="float32")
    assert sr == 16000
    stream = stt.create_stream()
    saw_detected = False
    step = 4800
    for idx in range(0, len(pcm_sa), step):
        part = stream.push(pcm_sa[idx : idx + step])
        if part.detected_language:
            saw_detected = True
    final_res = stream.finish()
    assert saw_detected or final_res.language == "sa"
    assert final_res.language == "sa"
    assert len(final_res.text.strip()) > 0


def test_cli_auto_language_and_codeswitch_json() -> None:
    proc = subprocess.run(
        [
            sys.executable,
            "-m",
            "swanada.cli",
            str(SAMPLES_DIR / "hi.wav"),
            "-l",
            "auto",
            "--code-switch-en",
            "--json",
            "--threads",
            "2",
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    payload = json.loads(proc.stdout.strip())
    assert payload["language"] == "hi"
    assert isinstance(payload.get("language_confidence"), float)
    assert len(payload["text"].strip()) > 0
