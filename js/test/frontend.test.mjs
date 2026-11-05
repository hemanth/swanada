import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  N_FFT,
  WIN_LENGTH,
  HOP_LENGTH,
  N_MELS,
  SAMPLE_RATE,
  createMelFilterbank,
  createPaddedHannWindow,
  fft512,
  extractLogMelFeatures,
  hzToMel,
  melToHz,
} from '../dist/index.mjs';

describe('Deterministic Log-Mel Frontend Suite', () => {
  it('converts between Hz and Slaney mel scale invertibly', () => {
    const freqs = [0, 200, 500, 1000, 2500, 5000, 8000];
    for (const f of freqs) {
      const m = hzToMel(f);
      const fRec = melToHz(m);
      assert.ok(Math.abs(f - fRec) < 1e-4, `Mel inversion failed for ${f}: ${fRec}`);
    }
  });

  it('constructs 80-channel Mel filterbank with non-zero energy', () => {
    const fb = createMelFilterbank(16000, 512, 80);
    assert.equal(fb.length, 80 * 257);

    // Each channel must have positive area
    for (let m = 0; m < 80; m++) {
      let sum = 0;
      for (let k = 0; k < 257; k++) {
        sum += fb[m * 257 + k];
      }
      assert.ok(sum > 0, `Mel channel ${m} has zero energy`);
    }
  });

  it('constructs 400-point Hann window symmetrically padded in 512-point buffer', () => {
    const win = createPaddedHannWindow(400, 512);
    assert.equal(win.length, 512);

    // First and last 56 samples must be strictly 0
    for (let i = 0; i < 56; i++) {
      assert.equal(win[i], 0);
      assert.equal(win[456 + i], 0);
    }

    // Symmetry check: win[56 + i] === win[455 - i]
    for (let i = 0; i < 200; i++) {
      const left = win[56 + i];
      const right = win[455 - i];
      assert.ok(Math.abs(left - right) < 1e-6, `Asymmetric at index ${i}`);
    }
  });

  it('computes 512-point FFT on impulse response with flat spectrum', () => {
    const real = new Float32Array(512);
    const imag = new Float32Array(512);
    real[0] = 1.0; // Unit impulse delta[0]

    fft512(real, imag);

    for (let k = 0; k < 257; k++) {
      const mag2 = real[k] * real[k] + imag[k] * imag[k];
      assert.ok(Math.abs(mag2 - 1.0) < 1e-5, `Impulse response magnitude not 1.0 at ${k}`);
    }
  });

  it('extracts log-mel spectrogram with exact shape and CMVN normalization', () => {
    const N = 16000; // 1.0s @ 16kHz
    const pcm = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pcm[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / 16000) + 0.3 * Math.sin(2 * Math.PI * 1200 * i / 16000);
    }

    const res = extractLogMelFeatures(pcm, 16000);
    assert.deepEqual(res.shape, [1, 80, 101]);
    assert.equal(res.featureLength, 100);
    assert.equal(res.numFrames, 101);

    const T = res.featureLength;
    const numFrames = res.numFrames;

    // Check zero mean over valid frames for each channel
    for (let m = 0; m < 80; m++) {
      let sum = 0;
      for (let t = 0; t < T; t++) {
        sum += res.features[m * numFrames + t];
      }
      const mean = sum / T;
      assert.ok(Math.abs(mean) < 1e-4, `Channel ${m} mean ${mean} exceeds 1e-4`);

      // Check trailing padding frame is strictly 0.0
      for (let t = T; t < numFrames; t++) {
        assert.equal(res.features[m * numFrames + t], 0.0);
      }
    }
  });

  it('handles empty and short audio edge cases gracefully', () => {
    const emptyRes = extractLogMelFeatures(new Float32Array(0));
    assert.equal(emptyRes.featureLength, 0);
    assert.equal(emptyRes.features.length, 0);

    const shortRes = extractLogMelFeatures(new Float32Array(80));
    assert.equal(shortRes.featureLength, 0);
    assert.equal(shortRes.numFrames, 1);
  });
});
