import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseWav, encodeWav, resamplePcm } from '../dist/index.mjs';

describe('Audio Ingestion & Resampling Suite', () => {
  it('encodes and parses 16-bit PCM WAV with round-trip fidelity', () => {
    const N = 8000; // 0.5s @ 16kHz
    const orig = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      orig[i] = 0.6 * Math.sin(2 * Math.PI * 440 * i / 16000);
    }

    const wavBytes = encodeWav(orig, 16000);
    assert.ok(wavBytes.byteLength >= 44 + N * 2);

    const decoded = parseWav(wavBytes);
    assert.equal(decoded.sampleRate, 16000);
    assert.equal(decoded.numChannels, 1);
    assert.equal(decoded.pcm.length, N);
    assert.ok(Math.abs(decoded.durationSec - 0.5) < 0.001);

    // 16-bit quantization error tolerance
    let maxDiff = 0;
    for (let i = 0; i < N; i++) {
      const diff = Math.abs(orig[i] - decoded.pcm[i]);
      if (diff > maxDiff) maxDiff = diff;
    }
    assert.ok(maxDiff < 1e-4, `Max roundtrip diff ${maxDiff} exceeded 1e-4`);
  });

  it('downsamples 44.1 kHz audio to 16 kHz with duration conservation', () => {
    const srcSr = 44100;
    const dur = 0.25;
    const N = Math.floor(srcSr * dur);
    const input = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      input[i] = Math.sin(2 * Math.PI * 300 * i / srcSr);
    }

    const output = resamplePcm(input, srcSr, 16000);
    const expectedLen = Math.round(dur * 16000);
    assert.ok(Math.abs(output.length - expectedLen) <= 1);
  });

  it('downsamples 48 kHz audio to 16 kHz with 3:1 integer decimation', () => {
    const srcSr = 48000;
    const N = 14400; // 0.30s
    const input = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      input[i] = Math.sin(2 * Math.PI * 1000 * i / srcSr);
    }

    const output = resamplePcm(input, srcSr, 16000);
    assert.equal(output.length, 4800); // 4800 samples @ 16 kHz = 0.30s
  });

  it('upsamples 8 kHz audio to 16 kHz with doubled sample count', () => {
    const srcSr = 8000;
    const N = 1600; // 0.20s
    const input = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      input[i] = Math.sin(2 * Math.PI * 250 * i / srcSr);
    }

    const output = resamplePcm(input, srcSr, 16000);
    assert.equal(output.length, 3200);
  });

  it('passes through 16 kHz audio without distortion', () => {
    const input = new Float32Array([0.1, -0.2, 0.5, -0.8]);
    const output = resamplePcm(input, 16000, 16000);
    assert.equal(output.length, input.length);
    for (let i = 0; i < input.length; i++) {
      assert.equal(output[i], input[i]);
    }
  });

  it('throws descriptive error on invalid or truncated WAV headers', () => {
    assert.throws(() => parseWav(new Uint8Array(20)), /smaller than minimum WAV header/);
    const badMagic = new Uint8Array(44);
    assert.throws(() => parseWav(badMagic), /expected RIFF\/WAVE header/);
  });
});
