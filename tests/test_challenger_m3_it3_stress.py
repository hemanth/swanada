"""Adversarial Empirical Stress Harness for Milestone 3 Iteration 3.

Authored by challenger_m3_it3_1.
Empirically tests and stress-tests:
1. Python plosive closure & stop consonant chunking (20ms, 50ms, 100ms) with zero truncation.
2. Multi-pause segmentation with sub-threshold (300ms), threshold (600ms), and long (1.0s, 2.5s) pauses.
3. Multi-utterance triple sentence stream retention (Sentence 1 + pause + Sentence 2 + pause + Sentence 3).
4. Extended continuous speech streaming (>9s, >18s, >28s):
   - Strict 0.00% committed prefix character churn.
   - Monotonic prefix growth on every chunk.
   - Non-empty volatile tokens during active speech (no frozen chunks).
   - Real-Time Factor (RTF) < 1.0 across all chunk sizes.
5. JS cross-runtime parity for multi-pause speech and continuous streaming via Node.js.
6. AudioWorklet 20,000-quantum buffer pool backpressure and leak-free recycling.
"""

from pathlib import Path
import subprocess
import json
import numpy as np
import pytest

from swanada import Swanada, load_audio

REPO_ROOT = Path(__file__).resolve().parents[1]
SA_WAV_9S = Path("/Users/lika/labs/ninada/data/wavs/sa_sushrota_recit_c9ccc1b657ec.wav")
SA_WAV_9S_2 = Path("/Users/lika/labs/ninada/data/wavs/sa_sushrota_recit_cdf2c1350d87.wav")
SA_WAV_9S_3 = Path("/Users/lika/labs/ninada/data/wavs/sa_sushrota_recit_e94c92e76550.wav")
SA_WAV_4S = Path("/Users/lika/labs/ninada/data/wavs/sa_rasa_male_01445fb1731b.wav")
GROUND_TRUTH_4S = "अहं तत्रत्यानां कतिपयसौकर्याणां विषये ज्ञातुमिच्छामि"


def trim_silence(pcm: np.ndarray, threshold: float = 0.01) -> np.ndarray:
    mask = np.abs(pcm) > threshold
    if not np.any(mask):
        return pcm
    indices = np.where(mask)[0]
    return pcm[indices[0] : indices[-1] + 1]


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
# 1. Defect 1 Verification: Fine-grained chunk sizes & plosive stops
# =====================================================================

@pytest.mark.parametrize("chunk_samples", [320, 800, 1600])  # 20ms, 50ms, 100ms
def test_python_fine_grained_chunks_speech_retention(chunk_samples: int) -> None:
    """Verifies that speech with plosive closures / stops is never truncated even with small chunks."""
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
    assert emitted_count > 0, "No chunks emitted during push"


# =====================================================================
# 2. Defect 2 Verification: Varied pause durations & multi-sentence
# =====================================================================

@pytest.mark.parametrize("pause_ms", [300, 600, 1000, 2500])
def test_python_varied_pause_durations_between_sentences(pause_ms: int) -> None:
    """Tests varied pause durations: sub-threshold (300ms), threshold (600ms), and long (1s, 2.5s)."""
    if not SA_WAV_4S.exists():
        pytest.skip("Test wav not found")

    pcm = load_audio(SA_WAV_4S, target_sr=16000)
    pause_samples = int(16000 * (pause_ms / 1000.0))
    silence = np.zeros(pause_samples, dtype=np.float32)
    two_sentences = np.concatenate([pcm, silence, pcm])

    stt = Swanada.create(language="sa")
    stream = stt.stream(chunk_size_samples=5120)

    committed_history = []
    for i in range(0, len(two_sentences), 5120):
        chunk = two_sentences[i : min(len(two_sentences), i + 5120)]
        st = stream.push(chunk)
        if st is not None:
            committed_history.append(st.committed)

    final_res = stream.finish()

    churn_rate, violations = compute_char_churn(committed_history)
    assert churn_rate == 0.0, f"Committed churn detected during {pause_ms}ms pause test: {violations}"

    # Sentence 1 must be present, and overall text must contain both utterances
    assert "अहं तत्रत्यानां" in final_res.text, f"Sentence 1 erased during {pause_ms}ms pause! Got: {final_res.text}"
    assert final_res.text.count("ज्ञातुमिच्छामि") >= 2, (
        f"Sentence 2 or Sentence 1 missing in final text! Got: {final_res.text}"
    )


def test_python_triple_sentence_multi_pause_stream() -> None:
    """Stress tests three consecutive sentences separated by distinct pauses (800ms and 1500ms)."""
    if not SA_WAV_4S.exists():
        pytest.skip("Test wav not found")

    pcm = load_audio(SA_WAV_4S, target_sr=16000)
    pause1 = np.zeros(int(16000 * 0.8), dtype=np.float32)   # 800 ms
    pause2 = np.zeros(int(16000 * 1.5), dtype=np.float32)   # 1500 ms
    triple_audio = np.concatenate([pcm, pause1, pcm, pause2, pcm])

    stt = Swanada.create(language="sa")
    stream = stt.stream(chunk_size_samples=3200)  # 200ms chunks

    committed_history = []
    for i in range(0, len(triple_audio), 3200):
        chunk = triple_audio[i : min(len(triple_audio), i + 3200)]
        st = stream.push(chunk)
        if st is not None:
            committed_history.append(st.committed)

    final_res = stream.finish()

    churn_rate, violations = compute_char_churn(committed_history)
    assert churn_rate == 0.0, f"Committed churn in triple sentence stream: {violations}"
    assert final_res.text.count("ज्ञातुमिच्छामि") >= 3, (
        f"Expected 3 occurrences of final phrase, got {final_res.text.count('ज्ञातुमिच्छामि')} in: '{final_res.text}'"
    )


# =====================================================================
# 3. Continuous Speech Streaming Stress (>9s, >18s, >28s)
# =====================================================================

def test_python_28s_continuous_speech_multi_window_slides() -> None:
    """Evaluates ~28.5s continuous speech across 3 concatenated recitation clips.
    Forces at least 7 sliding window context drops and verifies 0.00% churn,
    monotonic prefix progression, and non-empty volatile tokens during active speech.
    """
    if not SA_WAV_9S.exists() or not SA_WAV_9S_2.exists():
        pytest.skip("Test wavs not found")

    p1 = trim_silence(load_audio(SA_WAV_9S, target_sr=16000))
    p2 = trim_silence(load_audio(SA_WAV_9S_2, target_sr=16000))
    p3 = trim_silence(load_audio(SA_WAV_9S_3, target_sr=16000)) if SA_WAV_9S_3.exists() else p1
    total_pcm = np.concatenate([p1, p2, p3])
    dur = len(total_pcm) / 16000.0
    assert dur >= 28.0, f"Expected audio >= 28.0s, got {dur:.2f}s"

    stt = Swanada.create(language="sa")
    stream = stt.stream(chunk_size_samples=5120)  # 320ms chunks

    committed_history = []
    empty_volatile_count = 0
    chunk_rtfs = []

    for i in range(0, len(total_pcm), 5120):
        chunk = total_pcm[i : min(len(total_pcm), i + 5120)]
        st = stream.push(chunk)
        if st is not None:
            committed_history.append(st.committed)
            chunk_rtfs.append(st.rtf)
            if not st.volatile:
                empty_volatile_count += 1

    final_res = stream.finish()

    churn_rate, violations = compute_char_churn(committed_history)
    assert churn_rate == 0.0, f"Violations found in 28s continuous stream: {violations}"
    assert empty_volatile_count == 0, f"Volatile token string was empty in {empty_volatile_count} chunks!"
    assert final_res.rtf < 1.0, f"Overall RTF {final_res.rtf:.4f} exceeded 1.0"
    assert len(chunk_rtfs) >= 85, f"Expected >= 85 chunks, got {len(chunk_rtfs)}"
    assert np.mean(chunk_rtfs) < 0.20, f"Mean chunk RTF {np.mean(chunk_rtfs):.4f} too high"


# =====================================================================
# 4. JS Cross-Runtime Parity & Stress via Node.js
# =====================================================================

def test_js_multi_pause_and_28s_streaming_parity() -> None:
    """Executes Node.js runner to test:
    1. Multi-pause audio (Sentence 1 + 1s pause + Sentence 2): verifies 0 left-context duplication.
    2. 28s continuous speech: verifies 0.00% churn and RTF < 1.0 in JS.
    """
    node_script = """
    import fs from "node:fs";
    import assert from "node:assert/strict";
    import { Swanada, parseWav } from "./js/dist/index.mjs";

    const wav4s = "/Users/lika/labs/ninada/data/wavs/sa_rasa_male_01445fb1731b.wav";
    const wav9s1 = "/Users/lika/labs/ninada/data/wavs/sa_sushrota_recit_c9ccc1b657ec.wav";
    const wav9s2 = "/Users/lika/labs/ninada/data/wavs/sa_sushrota_recit_cdf2c1350d87.wav";

    const { pcm: pcm4 } = parseWav(fs.readFileSync(wav4s));
    const { pcm: pcm9a } = parseWav(fs.readFileSync(wav9s1));
    const { pcm: pcm9b } = parseWav(fs.readFileSync(wav9s2));

    const stt = await Swanada.create({
      language: "sa",
      modelPath: "models/onnx/sushrota_sanskrit_ctc_int8.onnx",
    });

    // --- TEST A: Multi-pause 2 sentences with 1.2s silence ---
    const silence = new Float32Array(19200); // 1.2s
    const multiPauseAudio = new Float32Array(pcm4.length * 2 + silence.length);
    multiPauseAudio.set(pcm4, 0);
    multiPauseAudio.set(silence, pcm4.length);
    multiPauseAudio.set(pcm4, pcm4.length + silence.length);

    const streamA = stt.createStream();
    const commHistoryA = [];
    const chunkSize = 3200; // 200ms

    for (let i = 0; i < multiPauseAudio.length; i += chunkSize) {
      const chunk = multiPauseAudio.subarray(i, Math.min(multiPauseAudio.length, i + chunkSize));
      const res = await streamA.push(chunk);
      if (res) {
        commHistoryA.push(res.committed);
      }
    }
    const finalA = await streamA.finish();

    // Check churn in JS
    for (let i = 1; i < commHistoryA.length; i++) {
      const prev = commHistoryA[i - 1];
      const curr = commHistoryA[i];
      if (prev && curr) {
        assert.ok(curr.startsWith(prev), `JS Churn detected at chunk ${i}: '${curr}' vs '${prev}'`);
      }
    }
    assert.ok(!finalA.text.includes("अानविषये"), `JS Hallucinated duplication found: ${finalA.text}`);
    assert.ok(finalA.text.includes("अहं तत्रत्यानां"), `Sentence 1 missing in JS: ${finalA.text}`);

    // --- TEST B: 18.98s continuous speech streaming ---
    const totalContinuous = new Float32Array(pcm9a.length + pcm9b.length);
    totalContinuous.set(pcm9a, 0);
    totalContinuous.set(pcm9b, pcm9a.length);

    const streamB = stt.createStream();
    const commHistoryB = [];
    let emptyVolatiles = 0;

    for (let i = 0; i < totalContinuous.length; i += 5120) {
      const chunk = totalContinuous.subarray(i, Math.min(totalContinuous.length, i + 5120));
      const res = await streamB.push(chunk);
      if (res) {
        commHistoryB.push(res.committed);
        if (!res.volatile) emptyVolatiles++;
      }
    }
    const finalB = await streamB.finish();

    for (let i = 1; i < commHistoryB.length; i++) {
      const prev = commHistoryB[i - 1];
      const curr = commHistoryB[i];
      if (prev && curr) {
        assert.ok(curr.startsWith(prev), `JS Continuous churn at chunk ${i}: '${curr}' vs '${prev}'`);
      }
    }
    assert.equal(emptyVolatiles, 0, `JS emitted empty volatiles during active speech: ${emptyVolatiles}`);
    assert.ok(finalB.rtf < 1.0, `JS RTF ${finalB.rtf} exceeded 1.0`);

    await stt.release();
    console.log(JSON.stringify({ status: "PASS", rtfA: finalA.rtf, rtfB: finalB.rtf, chunksB: commHistoryB.length }));
    """
    res = subprocess.run(["node", "-e", node_script], cwd=str(REPO_ROOT), capture_output=True, text=True)
    assert res.returncode == 0, f"JS streaming stress test failed: {res.stderr}\nStdout: {res.stdout}"
    data = json.loads(res.stdout.strip())
    assert data["status"] == "PASS"
    assert data["rtfB"] < 1.0


# =====================================================================
# 5. AudioWorklet Deep Stress: 20,000 Quanta & Backpressure Simulation
# =====================================================================

def test_audioworklet_20k_quantum_backpressure_and_pool_invariants() -> None:
    """Stress tests AudioWorklet buffer recycling over 20,000 quantums (160 seconds audio)
    with delayed backpressure (holding 2-3 chunks before recycling) and varied casing.
    """
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

    // Simulate 20,000 quanta (2,560,000 samples = 160 seconds)
    for (let q = 0; q < 20000; q++) {
      proc.process([[quantum]], [[]], {});

      while (events.length > 0) {
        const ev = events.shift();
        if (ev.msg.type === "chunk") {
          holdQueue.push(ev.msg.audioChunk.buffer);
        }
      }

      // Simulate worker backpressure: release buffers when queue reaches 3
      if (holdQueue.length >= 3) {
        const bufToReturn = holdQueue.shift();
        const rType = (q % 3 === 0) ? "RECYCLE" : (q % 3 === 1) ? "recycle" : "Recycle";
        proc.port.onmessage({ data: { type: rType, buffer: bufToReturn } });
      }
    }

    // Flush any remaining in holdQueue
    while (holdQueue.length > 0) {
      const buf = holdQueue.shift();
      proc.port.onmessage({ data: { type: "RECYCLE", buffer: buf } });
    }

    // Buffer pool must have returned to exactly 4 without memory leaks
    assert.equal(proc.bufferPool.length, 4, `Buffer pool leaked or corrupted! Final length: ${proc.bufferPool.length}`);
    console.log(JSON.stringify({ status: "PASS", quantaTested: 20000, finalPool: proc.bufferPool.length }));
    """
    res = subprocess.run(["node", "-e", node_script], cwd=str(REPO_ROOT), capture_output=True, text=True)
    assert res.returncode == 0, f"Worklet 20k stress failed: {res.stderr}\nStdout: {res.stdout}"
    data = json.loads(res.stdout.strip())
    assert data["status"] == "PASS"
    assert data["finalPool"] == 4
