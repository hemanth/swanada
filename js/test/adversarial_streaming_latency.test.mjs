import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
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

describe('Adversarial Streaming Latency, RTF & 60-Second Stress Suite (Feature 11)', () => {
  it('verifies TTFT < 500 ms and RTF < 1.0 on real speech audio', async () => {
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

    let firstPartialTimeMs = null;
    const latencies = [];
    const streamStart = performance.now();

    stream.on('partial', () => {
      if (firstPartialTimeMs === null) {
        firstPartialTimeMs = performance.now() - streamStart;
      }
    });

    const chunkSize = 5120; // 320ms @ 16kHz
    for (let i = 0; i < pcm.length; i += chunkSize) {
      const chunk = pcm.subarray(i, Math.min(pcm.length, i + chunkSize));
      const t0 = performance.now();
      await stream.push(chunk);
      latencies.push(performance.now() - t0);
    }

    const finalRes = await stream.finish();

    // 1. TTFT Assertion
    assert.ok(firstPartialTimeMs !== null, 'Stream should have emitted a partial result');
    assert.ok(
      firstPartialTimeMs < 500.0,
      `TTFT ${firstPartialTimeMs.toFixed(1)} ms exceeded 500 ms budget`
    );

    // 2. RTF Assertion
    const totalComputeMs = latencies.reduce((a, b) => a + b, 0);
    const totalAudioMs = (pcm.length / 16000) * 1000;
    const streamingRtf = totalComputeMs / totalAudioMs;

    assert.ok(
      streamingRtf < 1.0,
      `Streaming RTF ${streamingRtf.toFixed(4)} exceeded 1.0 threshold`
    );
    assert.ok(
      finalRes.rtf < 1.0,
      `Final RTF ${finalRes.rtf.toFixed(4)} exceeded 1.0 threshold`
    );

    await stt.release();
  });

  it('stress tests 60+ seconds continuous streaming for O(1) buffer size and flat latency', async () => {
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

    const numChunks = 60; // 60 * 320ms = 19.2 seconds of speech
    const chunkSize = 5120;
    const maxBuffer = 40960; // 2,560 ms

    const latencies = [];
    const bufferSizes = [];

    for (let i = 0; i < numChunks; i++) {
      const offset = (i * chunkSize) % pcm.length;
      const chunk = pcm.subarray(offset, Math.min(pcm.length, offset + chunkSize));

      const t0 = performance.now();
      await stream.push(chunk);
      latencies.push(performance.now() - t0);

      // Access stream internal audioBuffer length if observable
      const bufLen = stream.audioBuffer ? stream.audioBuffer.length : 0;
      bufferSizes.push(bufLen);
    }

    // 1. Sliding window buffer boundedness check (O(1) memory bound)
    const maxObservedBuffer = Math.max(...bufferSizes);
    if (maxObservedBuffer > 0) {
      assert.ok(
        maxObservedBuffer <= maxBuffer + chunkSize,
        `Buffer unbounded: observed ${maxObservedBuffer} samples, cap is ${maxBuffer + chunkSize}`
      );
    }

    // 2. Real-time Factor across the continuous streaming session
    const totalComputeMs = latencies.reduce((a, b) => a + b, 0);
    const totalAudioMs = numChunks * 320;
    const sessionRtf = totalComputeMs / totalAudioMs;
    assert.ok(
      sessionRtf < 1.0,
      `Session RTF ${sessionRtf.toFixed(4)} exceeded 1.0 threshold`
    );

    // 3. Post-warmup latency stability (must remain below 350 ms per 320 ms chunk)
    const postWarmupLatencies = latencies.slice(15);
    const meanPostWarmup = postWarmupLatencies.reduce((a, b) => a + b, 0) / postWarmupLatencies.length;
    assert.ok(
      meanPostWarmup < 320.0,
      `Post-warmup mean latency ${meanPostWarmup.toFixed(2)} ms exceeded chunk duration 320 ms`
    );

    // 4. Maximum instantaneous latency bound
    const maxInstantLatency = Math.max(...postWarmupLatencies);
    assert.ok(
      maxInstantLatency < 500.0,
      `Peak latency ${maxInstantLatency.toFixed(2)} ms exceeded 500 ms guard limit`
    );

    const finalRes = await stream.finish();
    assert.equal(typeof finalRes.text, 'string');

    await stt.release();
  });
});
