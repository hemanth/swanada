"""Adversarial Empirical Stress Harness for Milestone 3 Iteration 4.

Authored by challenger_m3_it4_1.
Empirically tests and verifies:
1. Fine-Grained Chunk Stress across 20ms (320), 50ms (800), 100ms (1600), 200ms (3200), and 320ms (5120) samples in both Python and JS.
2. Boundary Token Locking: Proves that `trail_tokens = 3` preserves plosive stop syllable closures
   (e.g., Sanskrit 'त' in 'ज्ञातुमिच्छामि') and commits correctly without premature locking or duplication.
3. Long Continuous Audio: Verifies streaming speech >28s across multiple 3.84s -> 1.28s window slides
   with 0.00% prefix churn, 0 duplicated phrases, and mean chunk RTF < 0.20.
4. Multi-pause retention (300ms, 600ms, 1000ms, 2500ms) with trailing syllable preservation.
5. AudioWorklet buffer pool backpressure and mixed-case recycling.
"""

from pathlib import Path
import subprocess
import json
import numpy as np
import pytest

from swanada import Swanada, load_audio

REPO_ROOT = Path(__file__).resolve().parents[1]
SA_WAV_4S = Path("/Users/lika/labs/ninada/data/wavs/sa_rasa_male_01445fb1731b.wav")
SA_WAV_9S_1 = Path("/Users/lika/labs/ninada/data/wavs/sa_sushrota_recit_c9ccc1b657ec.wav")
SA_WAV_9S_2 = Path("/Users/lika/labs/ninada/data/wavs/sa_sushrota_recit_cdf2c1350d87.wav")
SA_WAV_9S_3 = Path("/Users/lika/labs/ninada/data/wavs/sa_sushrota_recit_d2771a468dcd.wav")

GROUND_TRUTH_4S = "अहं तत्रत्यानां कतिपयसौकर्याणां विषये ज्ञातुमिच्छामि"


def compute_char_churn(history: list[str]) -> tuple[float, list[tuple[int, str, str]]]:
    """Computes exact character churn rate and returns any violation pairs."""
    violations = []
    total_transitions = 0
    churn_count = 0

    for i in range(1, len(history)):
        prev = history[i - 1]
        curr = history[i]
        if prev and curr:
            total_transitions += 1
            if not curr.startswith(prev):
                churn_count += 1
                violations.append((i, prev, curr))

    churn_rate = (churn_count / total_transitions) * 100.0 if total_transitions > 0 else 0.0
    return churn_rate, violations


# =====================================================================
# 1. Fine-Grained Chunk Stress (20ms, 50ms, 100ms, 200ms, 320ms)
# =====================================================================

@pytest.mark.parametrize("chunk_samples", [320, 800, 1600, 3200, 5120])
def test_fine_grained_chunks_all_sizes_python(chunk_samples: int) -> None:
    """Verifies that Python streaming processes chunk sizes from 20ms to 320ms with 0.00% churn."""
    if not SA_WAV_4S.exists():
        pytest.skip(f"Test wav not found: {SA_WAV_4S}")

    pcm = load_audio(SA_WAV_4S, target_sr=16000)
    stt = Swanada.create(language="sa")
    stream = stt.stream(chunk_size_samples=chunk_samples)

    committed_history = []
    emitted_count = 0

    for i in range(0, len(pcm), chunk_samples):
        chunk = pcm[i : min(len(pcm), i + chunk_samples)]
        st = stream.push(chunk)
        if st is not None:
            emitted_count += 1
            committed_history.append(st.committed)

    final_res = stream.finish()

    churn_rate, violations = compute_char_churn(committed_history)
    assert churn_rate == 0.0, f"Committed churn detected ({churn_rate}%): {violations}"
    assert final_res.text == GROUND_TRUTH_4S, (
        f"Speech truncation detected for chunk_samples={chunk_samples}! "
        f"Expected '{GROUND_TRUTH_4S}', got '{final_res.text}'"
    )
    assert emitted_count > 0, f"No chunks emitted for chunk_samples={chunk_samples}"


@pytest.mark.parametrize("chunk_samples", [320, 800, 1600, 3200, 5120])
def test_fine_grained_chunks_all_sizes_js(chunk_samples: int) -> None:
    """Verifies that JavaScript streaming processes chunk sizes from 20ms to 320ms with 0.00% churn."""
    node_script = """
    import fs from "node:fs";
    import assert from "node:assert/strict";
    import { Swanada, parseWav } from "./js/dist/index.mjs";

    const wavBuf = fs.readFileSync("%s");
    const { pcm } = parseWav(wavBuf);
    const expected = "%s";

    const stt = await Swanada.create({
      language: "sa",
      modelPath: "models/onnx/sushrota_sanskrit_ctc_int8.onnx",
    });

    const stream = stt.createStream();
    const commHistory = [];
    const chunkSize = %d;

    for (let i = 0; i < pcm.length; i += chunkSize) {
      const chunk = pcm.subarray(i, Math.min(pcm.length, i + chunkSize));
      const res = await stream.push(chunk);
      if (res) commHistory.push(res.committed);
    }
    const finalRes = await stream.finish();

    for (let i = 1; i < commHistory.length; i++) {
      const prev = commHistory[i - 1];
      const curr = commHistory[i];
      if (prev && curr && !curr.startsWith(prev)) {
        assert.fail(`JS Churn detected at chunk ${chunkSize} step ${i}: prev='${prev}' curr='${curr}'`);
      }
    }

    assert.equal(finalRes.text, expected, `Mismatch: got '${finalRes.text}', expected '${expected}'`);
    await stt.release();
    console.log(JSON.stringify({ status: "PASS", chunkSamples: chunkSize, text: finalRes.text }));
    """ % (str(SA_WAV_4S), GROUND_TRUTH_4S, chunk_samples)

    res = subprocess.run(["node", "-e", node_script], cwd=str(REPO_ROOT), capture_output=True, text=True)
    assert res.returncode == 0, f"JS fine-grained chunk test failed for {chunk_samples}: {res.stderr}\nStdout: {res.stdout}"
    data = json.loads(res.stdout.strip())
    assert data["status"] == "PASS"
    assert data["text"] == GROUND_TRUTH_4S


# =====================================================================
# 2. Boundary Token Locking Verification (trail_tokens = 3)
# =====================================================================

def test_boundary_token_locking_preserves_plosive_stops() -> None:
    """Empirically proves that trail_tokens = 3 prevents premature locking of Sanskrit plosives.
    Under 50ms chunks, stop consonant 'त' in 'ज्ञातुमिच्छामि' must remain in volatile
    guard zone until vowel 'ु' enters acoustic window, preventing 'ज्ञातमिच्छामि' corruption.
    """
    if not SA_WAV_4S.exists():
        pytest.skip("Test wav not found")

    pcm = load_audio(SA_WAV_4S, target_sr=16000)
    stt = Swanada.create(language="sa")

    # With trail_tokens = 3 (production setting)
    stream3 = stt.stream(chunk_size_samples=800)  # 50ms chunks
    assert stream3.decoder.trail_tokens == 3

    premature_lock = False
    for i in range(0, len(pcm), 800):
        chunk = pcm[i : min(len(pcm), i + 800)]
        st = stream3.push(chunk)
        if st is not None:
            # If 'ज्ञात' is committed without 'ु', 'त' was prematurely locked
            if "ज्ञात" in st.committed and "ज्ञातु" not in st.committed:
                premature_lock = True

    final_res3 = stream3.finish()
    assert not premature_lock, "trail_tokens=3 prematurely locked stop consonant closure 'त'!"
    assert final_res3.text == GROUND_TRUTH_4S, f"Final transcript incorrect: '{final_res3.text}'"


# =====================================================================
# 3. Long Continuous Audio (>28s) across Window Slides
# =====================================================================

def test_continuous_speech_28s_sliding_window_invariants() -> None:
    """Verifies >28.5s continuous Sanskrit speech across multiple concatenated recitations.
    Verifies:
    - 0.00% committed prefix churn
    - 0 duplicate phrases / hallucinated repetitions across window boundary slides
    - Mean chunk RTF < 0.20 and final RTF < 0.20
    """
    if not SA_WAV_9S_1.exists() or not SA_WAV_9S_2.exists() or not SA_WAV_9S_3.exists():
        pytest.skip("Continuous test wavs not found")

    p1 = load_audio(SA_WAV_9S_1)
    p2 = load_audio(SA_WAV_9S_2)
    p3 = load_audio(SA_WAV_9S_3)
    total_pcm = np.concatenate([p1, p2, p3])
    dur_s = len(total_pcm) / 16000.0
    assert dur_s >= 28.0, f"Expected audio >= 28.0s, got {dur_s:.2f}s"

    stt = Swanada.create(language="sa")
    stream = stt.stream(chunk_size_samples=5120)  # 320ms chunks

    committed_history = []
    chunk_rtfs = []

    for i in range(0, len(total_pcm), 5120):
        chunk = total_pcm[i : min(len(total_pcm), i + 5120)]
        st = stream.push(chunk)
        if st is not None:
            committed_history.append(st.committed)
            chunk_rtfs.append(st.rtf)

    final_res = stream.finish()

    # 1. Churn Rate Invariant (must be strictly 0.00%)
    churn_rate, violations = compute_char_churn(committed_history)
    assert churn_rate == 0.0, f"Violations found in 28s continuous stream: {violations}"

    # 2. Duplicate Phrase Invariant: No repeated 4-grams of length > 15 chars
    words = final_res.text.split()
    fourgrams = [" ".join(words[k : k + 4]) for k in range(len(words) - 3)]
    duplicates = [fg for fg in set(fourgrams) if fourgrams.count(fg) > 1 and len(fg) > 15]
    assert len(duplicates) == 0, f"Duplicate phrases detected across sliding window boundary: {duplicates}"

    # 3. Real-Time Factor Invariant: Mean chunk RTF < 0.20
    mean_chunk_rtf = float(np.mean(chunk_rtfs))
    assert mean_chunk_rtf < 0.20, f"Mean chunk RTF {mean_chunk_rtf:.4f} exceeded 0.20"
    assert final_res.rtf < 0.20, f"Final RTF {final_res.rtf:.4f} exceeded 0.20"


def test_js_28s_continuous_speech_and_window_slides() -> None:
    """Verifies >28.5s continuous speech streaming in JavaScript via Node.js."""
    node_script = """
    import fs from "node:fs";
    import assert from "node:assert/strict";
    import { Swanada, parseWav } from "./js/dist/index.mjs";

    const { pcm: p1 } = parseWav(fs.readFileSync("%s"));
    const { pcm: p2 } = parseWav(fs.readFileSync("%s"));
    const { pcm: p3 } = parseWav(fs.readFileSync("%s"));

    const totalAudio = new Float32Array(p1.length + p2.length + p3.length);
    totalAudio.set(p1, 0);
    totalAudio.set(p2, p1.length);
    totalAudio.set(p3, p1.length + p2.length);

    const stt = await Swanada.create({
      language: "sa",
      modelPath: "models/onnx/sushrota_sanskrit_ctc_int8.onnx",
    });

    const stream = stt.createStream();
    const commHistory = [];
    const chunkSize = 5120; // 320ms

    for (let i = 0; i < totalAudio.length; i += chunkSize) {
      const chunk = totalAudio.subarray(i, Math.min(totalAudio.length, i + chunkSize));
      const res = await stream.push(chunk);
      if (res) commHistory.push(res.committed);
    }
    const finalRes = await stream.finish();

    for (let i = 1; i < commHistory.length; i++) {
      const prev = commHistory[i - 1];
      const curr = commHistory[i];
      if (prev && curr && !curr.startsWith(prev)) {
        assert.fail(`JS Churn at step ${i}: prev='${prev}' curr='${curr}'`);
      }
    }

    // Check duplicate 4-grams in JS
    const words = finalRes.text.split(/\\s+/);
    const duplicates = [];
    for (let i = 0; i < words.length - 3; i++) {
      const fg = words.slice(i, i + 4).join(" ");
      if (fg.length > 15 && finalRes.text.indexOf(fg) !== finalRes.text.lastIndexOf(fg)) {
        if (!duplicates.includes(fg)) duplicates.push(fg);
      }
    }

    assert.equal(duplicates.length, 0, `JS Duplicate phrases detected: ${JSON.stringify(duplicates)}`);
    await stt.release();
    console.log(JSON.stringify({ status: "PASS", durationSec: totalAudio.length / 16000, finalRtf: finalRes.rtf }));
    """ % (str(SA_WAV_9S_1), str(SA_WAV_9S_2), str(SA_WAV_9S_3))

    res = subprocess.run(["node", "-e", node_script], cwd=str(REPO_ROOT), capture_output=True, text=True)
    assert res.returncode == 0, f"JS continuous speech stress failed: {res.stderr}\nStdout: {res.stdout}"
    data = json.loads(res.stdout.strip())
    assert data["status"] == "PASS"


# =====================================================================
# 4. Multi-Pause Trailing Suffix Retention
# =====================================================================

@pytest.mark.parametrize("pause_ms", [300, 600, 1000, 2500])
def test_multi_pause_trailing_suffix_retention(pause_ms: int) -> None:
    """Verifies that varied pause durations (300ms to 2.5s) preserve both utterances
    without dropping the trailing volatile syllables on stream finish.
    """
    if not SA_WAV_4S.exists():
        pytest.skip("Test wav not found")

    pcm = load_audio(SA_WAV_4S, target_sr=16000)
    pause_samples = int(16000 * (pause_ms / 1000.0))
    silence = np.zeros(pause_samples, dtype=np.float32)
    two_sentences = np.concatenate([pcm, silence, pcm])

    stt = Swanada.create(language="sa")
    stream = stt.stream(chunk_size_samples=3200)

    committed_history = []
    for i in range(0, len(two_sentences), 3200):
        chunk = two_sentences[i : min(len(two_sentences), i + 3200)]
        st = stream.push(chunk)
        if st is not None:
            committed_history.append(st.committed)

    final_res = stream.finish()

    churn_rate, violations = compute_char_churn(committed_history)
    assert churn_rate == 0.0, f"Churn detected during {pause_ms}ms pause: {violations}"
    assert "अहं तत्रत्यानां" in final_res.text, f"Sentence 1 dropped during {pause_ms}ms pause"
    assert final_res.text.count("ज्ञातुमिच्छामि") >= 2, (
        f"Trailing syllable dropped on Sentence 2! Expected 2 occurrences of 'ज्ञातुमिच्छामि', got: '{final_res.text}'"
    )


# =====================================================================
# 5. AudioWorklet Mixed-Case Backpressure Stress
# =====================================================================

def test_audioworklet_mixed_case_recycling_stress() -> None:
    """Stress tests AudioWorklet message case normalization across 20,000 quanta with delayed recycling."""
    node_script = """
    import assert from "node:assert/strict";
    import fs from "node:fs";
    import vm from "node:vm";

    const code = fs.readFileSync("js/src/audio/audio-capture-worklet.js", "utf-8")
                   .replace(/registerProcessor\\([^)]+\\);?/g, "");
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

    assert.equal(proc.bufferPool.length, 4, "Initial buffer pool must be 4");
    const quantum = new Float32Array(128).fill(0.20);
    const holdQueue = [];
    const caseVariants = ["recycle", "RECYCLE", "Recycle", "ReCyClE"];

    for (let q = 0; q < 20000; q++) {
      proc.process([[quantum]], [[]], {});

      while (events.length > 0) {
        const ev = events.shift();
        if (ev.msg.type === "chunk") {
          holdQueue.push(ev.msg.audioChunk.buffer);
        }
      }

      if (holdQueue.length >= 3) {
        const bufToReturn = holdQueue.shift();
        const rType = caseVariants[q % caseVariants.length];
        proc.port.onmessage({ data: { type: rType, buffer: bufToReturn } });
      }
    }

    while (holdQueue.length > 0) {
      const buf = holdQueue.shift();
      proc.port.onmessage({ data: { type: "Recycle", buffer: buf } });
    }

    assert.equal(proc.bufferPool.length, 4, `Pool leaked! Final length: ${proc.bufferPool.length}`);
    console.log(JSON.stringify({ status: "PASS", finalPool: proc.bufferPool.length }));
    """
    res = subprocess.run(["node", "-e", node_script], cwd=str(REPO_ROOT), capture_output=True, text=True)
    assert res.returncode == 0, f"Worklet mixed-case stress failed: {res.stderr}\nStdout: {res.stdout}"
    data = json.loads(res.stdout.strip())
    assert data["status"] == "PASS"
    assert data["finalPool"] == 4
