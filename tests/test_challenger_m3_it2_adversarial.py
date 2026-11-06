"""Adversarial Stress Test Suite for Milestone 3 Iteration 2 (Streaming & Alignment).

Authored by challenger_m3_it2_1.
Empirically verifies:
1. Continuous Speech Streaming Stress past 3.84s (9.60s, 18.98s):
   - Monotonic committed advancement (strictly 0.00% character churn).
   - Non-empty volatile tokens during active continuous speech chunks.
   - RTF < 1.0.
2. Initial 100 ms chunk emission threshold (1600 samples).
3. AudioWorklet Buffer Recycle Case Insensitivity ('RECYCLE' vs 'recycle') with zero leaks.
4. Empirical reproduction of Critical Defects:
   - Python premature auto-finish on 100ms chunks due to consecutive_silent_chunks >= 2.
   - Python inter-sentence pause wiping Sentence 1.
   - JS left-context token duplication on pause/slide boundary.
"""

from pathlib import Path
import subprocess
import numpy as np
import pytest

from swanada import Swanada, load_audio

REPO_ROOT = Path(__file__).resolve().parents[1]
SA_WAV_9S = Path("/Users/lika/labs/ninada/data/wavs/sa_sushrota_recit_c9ccc1b657ec.wav")
SA_WAV_9S_2 = Path("/Users/lika/labs/ninada/data/wavs/sa_sushrota_recit_cdf2c1350d87.wav")
SA_WAV_4S = Path("/Users/lika/labs/ninada/data/wavs/sa_rasa_male_01445fb1731b.wav")
GROUND_TRUTH_4S = "अहं तत्रत्यानां कतिपयसौकर्याणां विषये ज्ञातुमिच्छामि"


def trim_silence(pcm: np.ndarray, threshold: float = 0.01) -> np.ndarray:
    mask = np.abs(pcm) > threshold
    if not np.any(mask):
        return pcm
    indices = np.where(mask)[0]
    return pcm[indices[0] : indices[-1] + 1]


def test_continuous_speech_streaming_9s_monotonicity_and_zero_churn() -> None:
    """Evaluates 9.60s continuous Sanskrit speech streaming past 3.84s buffer cap."""
    if not SA_WAV_9S.exists():
        pytest.skip(f"Test wav not found: {SA_WAV_9S}")

    pcm = load_audio(SA_WAV_9S, target_sr=16000)
    dur = len(pcm) / 16000.0
    assert dur >= 9.0, f"Expected audio >= 9.0s, got {dur:.2f}s"

    stt = Swanada.create(language="sa")
    stream = stt.stream(chunk_size_samples=5120)  # 320ms @ 16kHz

    committed_history = []
    chunk_size = 5120
    chunks_emitted = 0

    for i in range(0, len(pcm), chunk_size):
        chunk = pcm[i : min(len(pcm), i + chunk_size)]
        st = stream.push(chunk)
        if st is not None:
            chunks_emitted += 1
            if committed_history:
                prev = committed_history[-1]
                curr = st.committed
                if prev and curr:
                    assert curr.startswith(prev), (
                        f"Flicker violation at chunk {i//chunk_size}: '{curr}' does not start with '{prev}'"
                    )
            committed_history.append(st.committed)

            # In continuous speech chunks, volatile must never be empty
            assert st.volatile != "", f"Empty volatile detected at chunk {i//chunk_size}"

    final_res = stream.finish()
    assert chunks_emitted >= 28
    assert final_res.rtf < 1.0, f"RTF {final_res.rtf:.4f} exceeded 1.0"
    assert "स्वातन्त्र्येणास्य विज्ञानं" in final_res.text


def test_continuous_speech_streaming_18s_monotonicity_and_zero_churn() -> None:
    """Evaluates 18.98s continuous Sanskrit speech streaming spanning 4+ window slides."""
    if not SA_WAV_9S.exists() or not SA_WAV_9S_2.exists():
        pytest.skip("Test wavs not found")

    p1 = trim_silence(load_audio(SA_WAV_9S, target_sr=16000))
    p2 = trim_silence(load_audio(SA_WAV_9S_2, target_sr=16000))
    total_pcm = np.concatenate([p1, p2])
    dur = len(total_pcm) / 16000.0
    assert dur >= 18.0, f"Expected audio >= 18.0s, got {dur:.2f}s"

    stt = Swanada.create(language="sa")
    stream = stt.stream(chunk_size_samples=5120)

    committed_history = []
    chunk_size = 5120

    for i in range(0, len(total_pcm), chunk_size):
        chunk = total_pcm[i : min(len(total_pcm), i + chunk_size)]
        st = stream.push(chunk)
        if st is not None:
            if committed_history:
                prev = committed_history[-1]
                curr = st.committed
                if prev and curr:
                    assert curr.startswith(prev), (
                        f"Flicker violation at chunk {i//chunk_size}: '{curr}' does not start with '{prev}'"
                    )
            committed_history.append(st.committed)
            assert st.volatile != "", f"Empty volatile detected at chunk {i//chunk_size}"

    final_res = stream.finish()
    assert len(final_res.text) > 50


def test_initial_100ms_chunk_emission_threshold() -> None:
    """Verifies that streaming emits partial results on first 1600-sample (100 ms) chunk."""
    stt = Swanada.create(language="sa")

    # 1. 1600-sample chunk emits immediately
    stream1 = stt.stream(chunk_size_samples=1600)
    audio_1600 = np.random.RandomState(42).randn(1600).astype(np.float32) * 0.05
    res1 = stream1.push(audio_1600)
    assert res1 is not None, "Expected immediate emission on 1600 samples"
    assert res1.duration_ms == 100.0

    # 2. 1599-sample chunk holds back
    stream2 = stt.stream(chunk_size_samples=1600)
    audio_1599 = np.random.RandomState(42).randn(1599).astype(np.float32) * 0.05
    res2 = stream2.push(audio_1599)
    assert res2 is None, "Expected holdback on 1599 samples"

    # 3. Crossing threshold emits
    res3 = stream2.push(np.array([0.05], dtype=np.float32))
    assert res3 is not None, "Expected emission once 1600 reached"
    assert res3.duration_ms == 100.0


def test_audioworklet_recycle_case_insensitivity_and_leak_free() -> None:
    """Executes Node.js harness testing RECYCLE and recycle buffer reclamation."""
    node_script = """
    import assert from "node:assert/strict";
    import fs from "node:fs";
    import vm from "node:vm";

    const code = fs.readFileSync("js/src/audio/audio-capture-worklet.js", "utf-8").replace(/registerProcessor\\([^)]+\\);?/g, "");
    const events = [];
    const mockContext = {
      sampleRate: 16000,
      registerProcessor: () => {},
      AudioWorkletProcessor: class {
        constructor() {
          this.port = {
            onmessage: null,
            postMessage: (msg, transferList) => { events.push({ msg, transferList }); },
          };
        }
      },
      Float32Array,
      ArrayBuffer,
      Math,
      console,
    };
    vm.runInNewContext(`${code}\\nthis.ProcClass = SwanadaAudioCaptureProcessor;`, mockContext);
    const proc = new mockContext.ProcClass({ processorOptions: { chunkSamples: 1600, vadEnabled: false } });

    assert.equal(proc.bufferPool.length, 4);
    const quantum = new Float32Array(128).fill(0.15);

    for (let q = 0; q < 1000; q++) {
      proc.process([[quantum]], [[]], {});
      while (events.length > 0) {
        const ev = events.shift();
        if (ev.msg.type === "chunk") {
          const rType = (q % 2 === 0) ? "RECYCLE" : "recycle";
          proc.port.onmessage({ data: { type: rType, buffer: ev.msg.audioChunk.buffer } });
        }
      }
    }
    assert.equal(proc.bufferPool.length, 4, "Buffer pool leaked!");
    """
    res = subprocess.run(["node", "--input-type=module", "-e", node_script], cwd=str(REPO_ROOT), capture_output=True, text=True)
    assert res.returncode == 0, f"Worklet recycle test failed: {res.stderr}"


def test_python_100ms_chunks_natural_speech_truncation_defect() -> None:
    """Empirically verifies speech retention in Python when feeding 100ms chunks."""
    if not SA_WAV_4S.exists():
        pytest.skip("Test wav not found")

    pcm = load_audio(SA_WAV_4S, target_sr=16000)
    stt = Swanada.create(language="sa")
    stream = stt.stream(chunk_size_samples=1600)

    for i in range(0, len(pcm), 1600):
        chunk = pcm[i : min(len(pcm), i + 1600)]
        stream.push(chunk)

    final_res = stream.finish()
    assert final_res.text == GROUND_TRUTH_4S, f"Truncation observed! Got: '{final_res.text}'"


def test_python_inter_sentence_pause_wipes_previous_speech_defect() -> None:
    """Empirically verifies retention of Sentence 1 after 1.0s pause in Python."""
    if not SA_WAV_4S.exists():
        pytest.skip("Test wav not found")

    pcm = load_audio(SA_WAV_4S, target_sr=16000)
    silence_1s = np.zeros(16000, dtype=np.float32)
    two_sentences = np.concatenate([pcm, silence_1s, pcm])

    stt = Swanada.create(language="sa")
    stream = stt.stream(chunk_size_samples=5120)

    for i in range(0, len(two_sentences), 5120):
        chunk = two_sentences[i : min(len(two_sentences), i + 5120)]
        stream.push(chunk)

    final_res = stream.finish()
    assert len(final_res.text) > len(GROUND_TRUTH_4S) + 10, f"Sentence 1 erased! Got: '{final_res.text}'"


def test_js_inter_sentence_pause_left_context_hallucination_defect() -> None:
    """Empirically verifies absence of left-context duplication in JS when 1.0s pause occurs."""
    node_script = """
    import fs from "node:fs";
    import assert from "node:assert/strict";
    import { Swanada, parseWav } from "./js/dist/index.mjs";

    const wavPath = "/Users/lika/labs/ninada/data/wavs/sa_rasa_male_01445fb1731b.wav";
    const { pcm } = parseWav(fs.readFileSync(wavPath));

    const silence1s = new Float32Array(16000);
    const totalPcm = new Float32Array(pcm.length * 2 + silence1s.length);
    totalPcm.set(pcm, 0);
    totalPcm.set(silence1s, pcm.length);
    totalPcm.set(pcm, pcm.length + silence1s.length);

    const stt = await Swanada.create({
      language: "sa",
      modelPath: "models/onnx/sushrota_sanskrit_ctc_int8.onnx",
    });

    const stream = stt.createStream();
    const chunkSize = 5120;
    for (let i = 0; i < totalPcm.length; i += chunkSize) {
      const chunk = totalPcm.subarray(i, Math.min(totalPcm.length, i + chunkSize));
      await stream.push(chunk);
    }
    const finalRes = await stream.finish();
    await stt.release();

    // Check for hallucinated duplication in the middle
    assert.ok(!finalRes.text.includes("अानविषये"), `Hallucinated duplicate found: ${finalRes.text}`);
    """
    res = subprocess.run(["node", "-e", node_script], cwd=str(REPO_ROOT), capture_output=True, text=True)
    assert res.returncode == 0, f"JS left-context duplication confirmed: {res.stderr}"
