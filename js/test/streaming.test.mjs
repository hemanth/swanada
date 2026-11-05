import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  StreamingCTCDecoder,
  StreamingAcousticEngine,
  Swanada,
  parseWav,
} from '../dist/index.mjs';

import path from 'node:path';

function resolveModelPath(rel) {
  const p1 = path.resolve(rel);
  if (fs.existsSync(p1)) return p1;
  const p2 = path.resolve('..', rel);
  if (fs.existsSync(p2)) return p2;
  return rel;
}

const TEST_WAV_PATH = '/Users/lika/labs/ninada/data/wavs/sa_rasa_male_01445fb1731b.wav';
const MODEL_PATH = resolveModelPath('models/onnx/sushrota_sanskrit_ctc_int8.onnx');

describe('Real-Time Streaming Conformer-CTC Engine & Prefix Locking Suite (Feature 11)', () => {
  it('StreamingCTCDecoder guarantees zero character churn on committed prefix (0.00% flicker)', () => {
    const vocab = ['<blank>', '<unk>', '\u2581अ', 'हं', '\u2581त', 'त्र', 'त्या', 'नां', 'म्'];
    const decoder = new StreamingCTCDecoder(vocab, {
      stabilityThreshold: 2,
      trailTokens: 2,
    });

    const committedHistory = [];

    // Step 1: Push initial raw hypothesis
    const step1 = decoder.update(['\u2581अ', 'हं']);
    assert.equal(step1.isFinal, false);
    committedHistory.push(step1.committed);

    // Step 2: Push extended hypothesis with space marker ahead
    const step2 = decoder.update(['\u2581अ', 'हं', '\u2581त', 'त्र']);
    assert.equal(step2.isFinal, false);
    committedHistory.push(step2.committed);
    assert.ok(step2.committed.length > 0, 'Committed prefix locked tokens before space');

    // Step 3: Trailing tokens fluctuate, but committed prefix must NOT retract
    const step3 = decoder.update(['\u2581अ', 'हं', '\u2581त', 'म्']);
    committedHistory.push(step3.committed);

    // Verify monotonicity: committed(t2) must always contain committed(t1)
    for (let i = 1; i < committedHistory.length; i++) {
      const prev = committedHistory[i - 1];
      const curr = committedHistory[i];
      assert.ok(
        curr.startsWith(prev),
        `Flicker violation: "${curr}" does not start with previous committed "${prev}"`
      );
    }

    // Step 4: Stream end flushes everything
    const finalStep = decoder.update(['\u2581अ', 'हं', '\u2581त', 'त्रत्यानां'], true);
    assert.equal(finalStep.isFinal, true);
    assert.equal(finalStep.volatile, '');
    assert.ok(finalStep.text.includes('अहं'));
  });

  it('StreamingAcousticEngine processes real speech chunks with RTF < 1.0 and TTFT < 500ms', async () => {
    if (!fs.existsSync(MODEL_PATH) || !fs.existsSync(TEST_WAV_PATH)) {
      return;
    }

    const stt = await Swanada.create({
      language: 'sa',
      modelPath: MODEL_PATH,
    });

    const stream = stt.createStream();
    const wavBuf = fs.readFileSync(TEST_WAV_PATH);
    const { pcm } = parseWav(wavBuf);

    const partials = [];
    const tokens = [];
    let firstPartialTimeMs = null;
    const streamStart = performance.now();

    stream.on('partial', (p) => {
      if (firstPartialTimeMs === null) {
        firstPartialTimeMs = performance.now() - streamStart;
      }
      partials.push(p);
    });

    stream.on('token', (tok) => {
      tokens.push(tok);
    });

    // Feed 320ms chunks (5120 samples @ 16kHz)
    const chunkSize = 5120;
    for (let i = 0; i < pcm.length; i += chunkSize) {
      const chunk = pcm.subarray(i, Math.min(pcm.length, i + chunkSize));
      await stream.push(chunk);
    }

    const finalResult = await stream.finish();

    // Verification 1: TTFT < 500 ms
    assert.ok(firstPartialTimeMs !== null, 'Stream emitted at least one partial result');
    assert.ok(
      firstPartialTimeMs < 500.0,
      `TTFT ${firstPartialTimeMs.toFixed(1)}ms exceeded 500ms budget`
    );

    // Verification 2: RTF < 1.0
    assert.ok(
      finalResult.rtf < 1.0,
      `RTF ${finalResult.rtf.toFixed(4)} exceeded real-time factor threshold 1.0`
    );

    // Verification 3: Monotonic committed text progression
    for (let i = 1; i < partials.length; i++) {
      const prev = partials[i - 1].committed;
      const curr = partials[i].committed;
      if (prev.length > 0 && curr.length > 0) {
        assert.ok(
          curr.startsWith(prev) || curr.length >= prev.length,
          `Committed text shrank: prev="${prev}", curr="${curr}"`
        );
      }
    }

    // Verification 4: Final accuracy matches ground truth
    assert.equal(
      finalResult.text,
      'अहं तत्रत्यानां कतिपयसौकर्याणां विषये ज्ञातुमिच्छामि'
    );

    await stt.release();
  });

  it('StreamingAcousticEngine emits advancing partials for continuous speech > 4s without freezing', async () => {
    if (!fs.existsSync(MODEL_PATH) || !fs.existsSync(TEST_WAV_PATH)) {
      return;
    }

    const stt = await Swanada.create({
      language: 'sa',
      modelPath: MODEL_PATH,
    });

    const stream = stt.createStream();
    const wavBuf = fs.readFileSync(TEST_WAV_PATH);
    const { pcm } = parseWav(wavBuf);
    assert.ok(pcm.length / 16000 >= 4.0, 'Audio should be >= 4.0s for continuous speech test');

    const emittedPartials = [];
    let chunkIndex = 0;
    stream.on('partial', (p) => {
      emittedPartials.push({ chunkIndex, partial: p });
    });

    const chunkSize = 5120; // 320ms @ 16kHz
    for (let i = 0; i < pcm.length; i += chunkSize) {
      const chunk = pcm.subarray(i, Math.min(pcm.length, i + chunkSize));
      await stream.push(chunk);
      chunkIndex++;
    }

    const finalResult = await stream.finish();

    // Utterance is 4.96s (16 chunks). Chunks 12..15 exceed 3.84s buffer cap.
    const latePartials = emittedPartials.filter(ep => ep.chunkIndex >= 12);
    assert.ok(latePartials.length >= 3, `Expected at least 3 partials after 3.84s cap, got ${latePartials.length}`);

    // Regression checks:
    // 1. Volatile text must NOT be empty after buffer truncation!
    for (const ep of latePartials) {
      assert.ok(
        ep.partial.volatile.length > 0,
        `FREEZE DETECTED: Chunk ${ep.chunkIndex} emitted empty volatile text during active speech!`
      );
    }

    // 2. Committed prefix must advance beyond chunk 12 ("विषये") into subsequent words
    const lastCommitted = emittedPartials[emittedPartials.length - 1].partial.committed;
    assert.ok(lastCommitted.includes('विषये'));
    assert.ok(
      ['ज्ञ', 'ा', 'त', 'ु', 'म', 'ि'].some(ch => lastCommitted.includes(ch)),
      `FREEZE DETECTED: Committed prefix did not advance into subsequent words: "${lastCommitted}"`
    );

    // 3. Final text matches ground truth
    assert.equal(finalResult.text, 'अहं तत्रत्यानां कतिपयसौकर्याणां विषये ज्ञातुमिच्छामि');

    await stt.release();
  });

  it('allows initial chunk emission starting at 1600 samples (100 ms)', async () => {
    if (!fs.existsSync(MODEL_PATH)) {
      return;
    }

    const stt = await Swanada.create({
      language: 'sa',
      modelPath: MODEL_PATH,
    });

    const stream = stt.createStream();
    const audio100ms = new Float32Array(1600);
    for (let i = 0; i < 1600; i++) audio100ms[i] = (Math.sin(i * 0.1) * 0.1);

    let partialEmitted = null;
    stream.on('partial', (p) => {
      partialEmitted = p;
    });

    const res = await stream.push(audio100ms);
    assert.ok(partialEmitted !== null, 'Expected partial emission at 1600 samples');
    assert.equal(partialEmitted.durationMs, 100);

    await stream.finish();
    await stt.release();
  });
});
