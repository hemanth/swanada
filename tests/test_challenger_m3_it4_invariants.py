"""Adversarial Empirical Invariants & Multi-Pause Stress Suite for Milestone 3 Iteration 4.

Authored by challenger_m3_it4_2.
Adversarial focus areas:
1. AudioWorklet 50,000 Quanta Backpressure, Mixed-Casing & Buffer Pool Invariants:
   - 50,000 processing quanta (6,400,000 samples = 400.0s @ 16kHz).
   - Mixed-case & title-case recycling ('recycle', 'Recycle', 'RECYCLE', 'rEcYcLe', 'REcycle', 'reCYcLe').
   - Invariant: bufferPool.length strictly within [0, 4] at all times.
   - Invariant: 0 dropped frames (totalProcessedSamples == 50,000 * 128).
   - Invariant: 0 memory leaks (final pool size strictly 4 upon queue drain).
   - Invariant: Malformed and boundary recycle messages rejected without pool corruption.
2. Multi-Pause Audio Stream Segmentation:
   - Evaluates silence durations: 100ms, 300ms, 500ms, 1000ms, 2500ms.
   - Verifies that sub-threshold pauses (100ms, 300ms) do NOT cause premature utterance resets.
   - Verifies that threshold (500ms) and super-threshold (1s, 2.5s) pauses preserve all utterances.
   - Strict 0.00% character churn across partials and final result.
3. Stream Termination Volatile Syllable Retention & 0.00% Prefix Churn:
   - Verifies finish() retains trailing volatile syllables ('ाम', 'ि') in Sanskrit phrases.
   - Verifies full retention across both Python and JavaScript implementations.
"""

from pathlib import Path
import subprocess
import json
import numpy as np
import pytest

from swanada import Swanada, load_audio
from swanada.normalizer import normalize_indic_text

REPO_ROOT = Path(__file__).resolve().parents[1]
SA_WAV_9S = Path("/Users/lika/labs/ninada/data/wavs/sa_sushrota_recit_c9ccc1b657ec.wav")
SA_WAV_9S_2 = Path("/Users/lika/labs/ninada/data/wavs/sa_sushrota_recit_cdf2c1350d87.wav")
SA_WAV_4S = Path("/Users/lika/labs/ninada/data/wavs/sa_rasa_male_01445fb1731b.wav")
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
# FOCUS 1: AudioWorklet 50,000 Quanta Backpressure, Mixed-Casing & Pool
# =====================================================================

def test_audioworklet_50k_quanta_mixed_casing_and_backpressure_invariants() -> None:
    """Stress tests AudioWorklet buffer recycling across 50,000 quanta (400 seconds)
    under varying backpressure queues (0 to 4 buffers held) and rotating mixed casing:
    'recycle', 'Recycle', 'RECYCLE', 'rEcYcLe', 'REcycle', 'reCYcLe'.

    Verifies:
    1. Pool size strictly within [0, 4] at all times.
    2. Zero dropped frames: totalProcessedSamples == 50,000 * 128.
    3. Zero memory leaks: final pool size returns to exactly 4.
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
    const quantum = new Float32Array(128).fill(0.15);
    const holdQueue = [];
    const casingVariants = ['recycle', 'Recycle', 'RECYCLE', 'rEcYcLe', 'REcycle', 'reCYcLe'];

    let minPoolObserved = 4;
    let maxPoolObserved = 4;

    // Run 50,000 quanta (6,400,000 samples = 400.0 seconds of audio)
    for (let q = 0; q < 50000; q++) {
      proc.process([[quantum]], [[]], {});

      while (events.length > 0) {
        const ev = events.shift();
        if (ev.msg.type === "chunk") {
          holdQueue.push(ev.msg.audioChunk.buffer);
        }
      }

      // Check pool bounds invariant at every quantum
      const poolLen = proc.bufferPool.length;
      if (poolLen < minPoolObserved) minPoolObserved = poolLen;
      if (poolLen > maxPoolObserved) maxPoolObserved = poolLen;
      assert.ok(poolLen >= 0 && poolLen <= 4, `Pool length invariant violated: ${poolLen} not in [0, 4] at quantum ${q}`);

      // Variable backpressure: simulate downstream consumer queue depth varying between 1 and 4
      const targetHold = (q % 5); // 0, 1, 2, 3, or 4
      if (holdQueue.length > targetHold) {
        const bufToReturn = holdQueue.shift();
        const rType = casingVariants[q % casingVariants.length];
        proc.port.onmessage({ data: { type: rType, buffer: bufToReturn } });
      }
    }

    // Drain all remaining buffers in holdQueue
    let drainIndex = 0;
    while (holdQueue.length > 0) {
      const buf = holdQueue.shift();
      const rType = casingVariants[drainIndex % casingVariants.length];
      proc.port.onmessage({ data: { type: rType, buffer: buf } });
      drainIndex++;
    }

    // Invariant assertions
    assert.equal(proc.totalProcessedSamples, 50000 * 128, "Total processed samples mismatch");
    assert.equal(proc.emittedChunks, (50000 * 128) / 1600, "Emitted chunk count mismatch");
    assert.equal(proc.accumOffset, 0, "Accumulator must have zero pending samples");
    assert.equal(proc.bufferPool.length, 4, `Buffer pool leaked! Final pool size: ${proc.bufferPool.length}`);
    assert.ok(minPoolObserved >= 0, `Pool dipped below 0: ${minPoolObserved}`);
    assert.ok(maxPoolObserved <= 4, `Pool exceeded 4: ${maxPoolObserved}`);

    console.log(JSON.stringify({
      status: "PASS",
      quanta: 50000,
      emittedChunks: proc.emittedChunks,
      minPool: minPoolObserved,
      maxPool: maxPoolObserved,
      finalPool: proc.bufferPool.length,
    }));
    """
    res = subprocess.run(["node", "-e", node_script], cwd=str(REPO_ROOT), capture_output=True, text=True)
    assert res.returncode == 0, f"AudioWorklet 50k stress failed: {res.stderr}\nStdout: {res.stdout}"
    data = json.loads(res.stdout.strip())
    assert data["status"] == "PASS"
    assert data["quanta"] == 50000
    assert data["emittedChunks"] == 4000
    assert data["finalPool"] == 4
    assert 0 <= data["minPool"] <= 4
    assert 0 <= data["maxPool"] <= 4


def test_audioworklet_malformed_and_boundary_casing_resilience() -> None:
    """Tests AudioWorklet resilience against malformed recycle messages,
    invalid buffer byte lengths, detached buffers, null types, and non-string types.
    Ensures zero corruption of pool size or unhandled exceptions.
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

    // Emit 1 chunk so pool length is 3
    const quantum = new Float32Array(128).fill(0.1);
    for (let i = 0; i < (1600 / 128); i++) {
      proc.process([[quantum]], [[]], {});
    }
    assert.equal(events.length, 1, "Must emit 1 chunk");
    const validChunkBuffer = events.shift().msg.audioChunk.buffer;
    assert.equal(proc.bufferPool.length, 3, "Pool must be 3 after 1 chunk emission");

    // Malformed recycle messages: NONE of these should alter the pool length
    const malformedMessages = [
      { type: 'rEcYcLe', buffer: null },
      { type: 'RECYCLE', buffer: new ArrayBuffer(100) },          // wrong byteLength (100 != 6400)
      { type: 'Recycle', buffer: new ArrayBuffer(0) },            // 0 bytes
      { type: 'recycle' },                                        // missing buffer
      { type: 'RECYCLE', buffer: undefined },
      { type: 12345, buffer: validChunkBuffer },                  // non-string type
      { type: null, buffer: validChunkBuffer },                   // null type
      { type: undefined },
      {},
      { type: 'not_recycle', buffer: validChunkBuffer },
    ];

    for (const msg of malformedMessages) {
      assert.doesNotThrow(() => {
        proc.port.onmessage({ data: msg });
      }, `Malformed message threw exception: ${JSON.stringify(msg)}`);
      assert.equal(proc.bufferPool.length, 3, `Pool length corrupted by malformed msg: ${JSON.stringify(msg)}`);
    }

    // Now send the valid buffer with mixed-case 'rEcYcLe'
    proc.port.onmessage({ data: { type: 'rEcYcLe', buffer: validChunkBuffer } });
    assert.equal(proc.bufferPool.length, 4, "Valid buffer must be successfully reclaimed");

    console.log(JSON.stringify({ status: "PASS", finalPool: proc.bufferPool.length }));
    """
    res = subprocess.run(["node", "-e", node_script], cwd=str(REPO_ROOT), capture_output=True, text=True)
    assert res.returncode == 0, f"Malformed message resilience test failed: {res.stderr}\nStdout: {res.stdout}"
    data = json.loads(res.stdout.strip())
    assert data["status"] == "PASS"
    assert data["finalPool"] == 4


# =====================================================================
# FOCUS 2: Multi-Pause Audio Streams with Varied Silence Durations
# =====================================================================

@pytest.mark.parametrize("pause_ms", [100, 300, 500, 1000, 2500])
def test_python_multi_pause_stream_sub_and_super_thresholds(pause_ms: int) -> None:
    """Stress tests multi-sentence streams separated by varied silence durations:
    - 100ms: sub-threshold short inter-word stop (must NOT trigger utterance reset).
    - 300ms: sub-threshold breathing pause (must NOT trigger utterance reset).
    - 500ms: exact turn-segmentation threshold (8000 samples @ 16kHz).
    - 1000ms: super-threshold conversational pause.
    - 2500ms: extended silence gap.

    Verifies:
    1. Both utterances are fully recognized in the final transcript.
    2. Sentence 1 prefix is strictly retained with 0.00% churn.
    3. Trailing syllables of Sentence 2 are fully preserved.
    """
    if not SA_WAV_4S.exists():
        pytest.skip(f"Test wav not found: {SA_WAV_4S}")

    pcm = load_audio(SA_WAV_4S, target_sr=16000)
    pause_samples = int(16000 * (pause_ms / 1000.0))
    silence = np.zeros(pause_samples, dtype=np.float32)
    stream_audio = np.concatenate([pcm, silence, pcm])

    stt = Swanada.create(language="sa")
    stream = stt.stream(chunk_size_samples=3200)  # 200ms chunks

    committed_history = []
    chunk_count = 0

    for i in range(0, len(stream_audio), 3200):
        chunk = stream_audio[i : min(len(stream_audio), i + 3200)]
        st = stream.push(chunk)
        if st is not None:
            chunk_count += 1
            committed_history.append(st.committed)

    final_res = stream.finish()

    # Prefix stability: 0.00% churn
    churn_rate, violations = compute_char_churn(committed_history)
    assert churn_rate == 0.0, f"Committed churn detected during {pause_ms}ms pause test: {violations}"

    # Sentence 1 presence verification
    assert "अहं तत्रत्यानां" in final_res.text, (
        f"Sentence 1 erased during {pause_ms}ms pause! Final text: '{final_res.text}'"
    )

    # Both occurrences of the key Sanskrit phrase must be present
    assert final_res.text.count("ज्ञातुमिच्छामि") >= 2, (
        f"Missing sentence in final text for pause={pause_ms}ms! "
        f"Expected >= 2 occurrences of 'ज्ञातुमिच्छामि', got {final_res.text.count('ज्ञातुमिच्छामि')} "
        f"in: '{final_res.text}'"
    )

    # Monotonicity check against final result
    if committed_history:
        last_committed = committed_history[-1]
        assert final_res.text.startswith(last_committed), (
            f"Final text '{final_res.text}' does not start with last committed partial '{last_committed}'"
        )


def test_python_complex_mixed_pause_triple_sentence_stream() -> None:
    """Stress tests a complex speech stream combining sub-threshold inter-word stops (100ms, 300ms)
    and super-threshold pauses (500ms, 2500ms):
    [Speech Part A] + 100ms pause + [Speech Part B] + 1000ms pause + [Speech Part A] + 300ms pause + [Speech Part B] + 2500ms pause + [Speech Full].
    """
    if not SA_WAV_4S.exists():
        pytest.skip(f"Test wav not found: {SA_WAV_4S}")

    pcm = load_audio(SA_WAV_4S, target_sr=16000)
    mid_point = len(pcm) // 2

    part_a = pcm[:mid_point]
    part_b = pcm[mid_point:]
    pause_100ms = np.zeros(int(16000 * 0.1), dtype=np.float32)
    pause_300ms = np.zeros(int(16000 * 0.3), dtype=np.float32)
    pause_1000ms = np.zeros(int(16000 * 1.0), dtype=np.float32)
    pause_2500ms = np.zeros(int(16000 * 2.5), dtype=np.float32)

    # Composite audio: Sentence 1 (split by 100ms) + 1.0s pause + Sentence 2 (split by 300ms) + 2.5s pause + Sentence 3
    composite = np.concatenate([
        part_a, pause_100ms, part_b,
        pause_1000ms,
        part_a, pause_300ms, part_b,
        pause_2500ms,
        pcm
    ])

    stt = Swanada.create(language="sa")
    stream = stt.stream(chunk_size_samples=3200)

    committed_history = []
    for i in range(0, len(composite), 3200):
        chunk = composite[i : min(len(composite), i + 3200)]
        st = stream.push(chunk)
        if st is not None:
            committed_history.append(st.committed)

    final_res = stream.finish()

    churn_rate, violations = compute_char_churn(committed_history)
    assert churn_rate == 0.0, f"Committed churn detected in mixed-pause stream: {violations}"
    assert final_res.text.count("ज्ञातुमिच्छामि") >= 3, (
        f"Expected >= 3 occurrences of 'ज्ञातुमिच्छामि', got {final_res.text.count('ज्ञातुमिच्छामि')} in: '{final_res.text}'"
    )


# =====================================================================
# FOCUS 3: Stream Termination finish() Trailing Volatile Syllable Retention
# =====================================================================

def test_python_finish_trailing_volatile_syllable_retention() -> None:
    """Verifies that when an audio stream terminates abruptly right at the end of speech
    (with 0ms trailing silence, 50ms silence, or 500ms silence), finish() cleanly promotes
    and flushes all volatile syllables ('ाम', 'ि') into the final transcript with 0.00% churn.
    """
    if not SA_WAV_4S.exists():
        pytest.skip("Test wav not found")

    pcm = load_audio(SA_WAV_4S, target_sr=16000)

    for trailing_silence_ms in [0, 50, 200, 600]:
        silence_samples = int(16000 * (trailing_silence_ms / 1000.0))
        audio = np.concatenate([pcm, np.zeros(silence_samples, dtype=np.float32)]) if silence_samples > 0 else pcm

        stt = Swanada.create(language="sa")
        stream = stt.stream(chunk_size_samples=1600)  # 100ms chunks

        committed_history = []
        last_st = None
        for i in range(0, len(audio), 1600):
            chunk = audio[i : min(len(audio), i + 1600)]
            st = stream.push(chunk)
            if st is not None:
                last_st = st
                committed_history.append(st.committed)

        final_res = stream.finish()

        # Trailing volatile syllables verification
        assert final_res.text.endswith("ज्ञातुमिच्छामि"), (
            f"Trailing syllables ('ाम', 'ि') truncated on finish() for trailing_silence={trailing_silence_ms}ms! "
            f"Expected text ending with 'ज्ञातुमिच्छामि', got '{final_res.text}'"
        )

        # Monotonicity with last committed partial
        churn_rate, violations = compute_char_churn(committed_history + [final_res.text])
        assert churn_rate == 0.0, f"Prefix churn detected between partials and finish(): {violations}"


def test_js_finish_trailing_volatile_and_multi_pause_parity() -> None:
    """Tests JavaScript implementation via Node.js runner to verify:
    1. Multi-pause streams (100ms, 300ms, 500ms, 1000ms, 2500ms) in JS retain all sentences.
    2. finish() preserves trailing volatile syllables ('ाम', 'ि') without suffix truncation.
    3. Strict 0.00% prefix churn in JS partial transcripts.
    """
    node_script = """
    import fs from "node:fs";
    import assert from "node:assert/strict";
    import { Swanada, parseWav } from "./js/dist/index.mjs";

    const wav4s = "/Users/lika/labs/ninada/data/wavs/sa_rasa_male_01445fb1731b.wav";
    const { pcm } = parseWav(fs.readFileSync(wav4s));

    const stt = await Swanada.create({
      language: "sa",
      modelPath: "models/onnx/sushrota_sanskrit_ctc_int8.onnx",
    });

    // 1. Test trailing volatile retention on abrupt finish (0ms trailing silence)
    const stream0 = stt.createStream();
    const commHistory0 = [];
    const chunkSize = 1600; // 100ms
    for (let i = 0; i < pcm.length; i += chunkSize) {
      const chunk = pcm.subarray(i, Math.min(pcm.length, i + chunkSize));
      const res = await stream0.push(chunk);
      if (res) commHistory0.push(res.committed);
    }
    const final0 = await stream0.finish();

    // Verify trailing syllables 'ाम', 'ि' retained in final0.text
    assert.ok(final0.text.endsWith("ज्ञातुमिच्छामि"),
      `JS finish() truncated trailing syllables! Expected to end with 'ज्ञातुमिच्छामि', got '${final0.text}'`
    );

    // Verify 0 churn in JS
    for (let i = 1; i < commHistory0.length; i++) {
      const prev = commHistory0[i - 1];
      const curr = commHistory0[i];
      if (prev && curr) {
        assert.ok(curr.startsWith(prev), `JS Churn detected at chunk ${i}: '${curr}' vs '${prev}'`);
      }
    }
    if (commHistory0.length > 0) {
      assert.ok(final0.text.startsWith(commHistory0[commHistory0.length - 1]),
        `JS final text does not start with last committed partial`
      );
    }

    // 2. Test multi-pause durations [100ms, 300ms, 500ms, 1000ms, 2500ms] in JS
    const pausesMs = [100, 300, 500, 1000, 2500];
    for (const pauseMs of pausesMs) {
      const pauseSamples = Math.floor(16000 * (pauseMs / 1000));
      const silence = new Float32Array(pauseSamples);
      const multiAudio = new Float32Array(pcm.length * 2 + silence.length);
      multiAudio.set(pcm, 0);
      multiAudio.set(silence, pcm.length);
      multiAudio.set(pcm, pcm.length + silence.length);

      const streamP = stt.createStream();
      const commHistoryP = [];
      for (let i = 0; i < multiAudio.length; i += 3200) {
        const chunk = multiAudio.subarray(i, Math.min(multiAudio.length, i + 3200));
        const res = await streamP.push(chunk);
        if (res) commHistoryP.push(res.committed);
      }
      const finalP = await streamP.finish();

      // Invariant checks
      assert.ok(finalP.text.includes("अहं तत्रत्यानां"), `Sentence 1 missing in JS for pause ${pauseMs}ms: ${finalP.text}`);
      const count = (finalP.text.match(/ज्ञातुमिच्छामि/g) || []).length;
      assert.ok(count >= 2, `JS missing second sentence for pause ${pauseMs}ms! Count: ${count}, text: ${finalP.text}`);

      for (let i = 1; i < commHistoryP.length; i++) {
        const prev = commHistoryP[i - 1];
        const curr = commHistoryP[i];
        if (prev && curr) {
          assert.ok(curr.startsWith(prev), `JS Churn in ${pauseMs}ms pause test at chunk ${i}`);
        }
      }
    }

    await stt.release();
    console.log(JSON.stringify({ status: "PASS", volatileRetained: true, pausesTested: pausesMs }));
    """
    res = subprocess.run(["node", "-e", node_script], cwd=str(REPO_ROOT), capture_output=True, text=True)
    assert res.returncode == 0, f"JS trailing volatile and multi-pause parity test failed: {res.stderr}\nStdout: {res.stdout}"
    data = json.loads(res.stdout.strip())
    assert data["status"] == "PASS"
    assert data["volatileRetained"] is True
    assert len(data["pausesTested"]) == 5
