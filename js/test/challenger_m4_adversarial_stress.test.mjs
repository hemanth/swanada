/**
 * Adversarial stress harness for Milestone 4 Challenger 2 verification (JS Runtime).
 *
 * Empirical verification of 5 edge and failure boundary dimensions:
 * 1. Corrupt WAV byte headers, zero sample rates, zero channels.
 * 2. Arrays with NaN, +Inf, -Inf PCM audio samples.
 * 3. Extreme negative SNR noise floors and Dirac impulse trains.
 * 4. Suffix window freezing under long streaming sequences with zero word boundaries.
 * 5. Illegal Unicode combining mark sequences at string start and cross-script collisions.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseWav,
  encodeWav,
  resamplePcm,
  enhanceSpeechWithTelemetry,
  extractLogMelFeatures,
  StreamingCTCDecoder,
  dedupMarks,
  repairBrahmicOrthography,
  normalizeIndicText,
  joinSubwords,
} from '../dist/index.mjs';

describe('Adversarial Stress Verification (Milestone 4 Challenger 2)', () => {
  // ============================================================================
  // Dimension 1: Corrupt WAV byte headers, zero sample rates, zero channels
  // ============================================================================
  describe('Dimension 1: Corrupt WAV headers', () => {
    test('rejects truncated WAV headers (< 44 bytes)', () => {
      for (const len of [0, 1, 4, 12, 36, 43]) {
        const buf = new Uint8Array(len);
        assert.throws(() => parseWav(buf), /smaller than minimum WAV header|invalid/i);
      }
    });

    test('rejects corrupt magic bytes in header', () => {
      const badMagic = new Uint8Array(44);
      badMagic.set([0x4e, 0x4f, 0x50, 0x45]); // 'NOPE'
      assert.throws(() => parseWav(badMagic), /expected RIFF\/WAVE header/i);
    });

    test('handles zero sample rate and zero channels safely', () => {
      const buf = new ArrayBuffer(44);
      const view = new DataView(buf);
      view.setUint8(0, 0x52); view.setUint8(1, 0x49); view.setUint8(2, 0x46); view.setUint8(3, 0x46);
      view.setUint32(4, 36, true);
      view.setUint8(8, 0x57); view.setUint8(9, 0x41); view.setUint8(10, 0x56); view.setUint8(11, 0x45);
      view.setUint8(12, 0x66); view.setUint8(13, 0x6d); view.setUint8(14, 0x74); view.setUint8(15, 0x20);
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 0, true); // 0 channels
      view.setUint32(24, 0, true); // 0 sample rate
      view.setUint32(28, 0, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      view.setUint8(36, 0x64); view.setUint8(37, 0x61); view.setUint8(38, 0x74); view.setUint8(39, 0x61);
      view.setUint32(40, 0, true);

      const parsed = parseWav(buf);
      assert.equal(parsed.numChannels, 0);
      assert.throws(() => resamplePcm(parsed.pcm, parsed.sampleRate, 16000), /Invalid sample rate/);
    });
  });

  // ============================================================================
  // Dimension 2: Arrays with NaN, +Inf, -Inf PCM audio samples
  // ============================================================================
  describe('Dimension 2: Non-finite PCM arrays', () => {
    test('denoise and frontend handle NaN, +Inf, -Inf arrays stably', () => {
      const testCases = [
        ['all-nan', NaN],
        ['all-pos-inf', Infinity],
        ['all-neg-inf', -Infinity],
      ];

      for (const [name, val] of testCases) {
        const arr = new Float32Array(16000).fill(val);
        const telem = enhanceSpeechWithTelemetry(arr);
        assert.equal(typeof telem.isSpeechLikely, 'boolean');
        assert.equal(telem.pcm.length, 16000);

        const feats = extractLogMelFeatures(arr);
        assert.equal(feats.featureLength, 100);
      }

      // Interleaved non-finite array
      const interleaved = new Float32Array(16000);
      for (let i = 0; i < 16000; i += 4) {
        interleaved[i] = NaN;
        interleaved[i + 1] = Infinity;
        interleaved[i + 2] = -Infinity;
        interleaved[i + 3] = 0.0;
      }
      const telem2 = enhanceSpeechWithTelemetry(interleaved);
      assert.equal(typeof telem2.isSpeechLikely, 'boolean');
      const feats2 = extractLogMelFeatures(interleaved);
      assert.equal(feats2.featureLength, 100);
    });
  });

  // ============================================================================
  // Dimension 3: Extreme negative SNR noise floors and Dirac impulse trains
  // ============================================================================
  describe('Dimension 3: Negative SNR noise and Dirac impulse trains', () => {
    test('negative SNR noise (-30 dB) is attenuated with valid telemetry', () => {
      const sr = 16000;
      const n = sr * 2;
      const noise = new Float32Array(n);
      for (let i = 0; i < n; i++) noise[i] = (Math.random() * 2 - 1) * 0.4;
      const toneAmp = 0.4 * Math.pow(10, -30 / 20);
      for (let i = 0; i < n; i++) {
        noise[i] = Math.max(-1, Math.min(1, noise[i] + toneAmp * Math.sin(2 * Math.PI * 1000 * i / sr)));
      }

      const telem = enhanceSpeechWithTelemetry(noise);
      assert.equal(telem.pcm.every(v => Number.isFinite(v)), true);
      assert.ok(telem.suppressionDb >= 10.0);
    });

    test('Dirac impulse trains remain bounded', () => {
      const sr = 16000;
      const n = sr * 2;

      // Alternating spikes
      const diracAlt = new Float32Array(n);
      for (let i = 0; i < n; i += 80) diracAlt[i] = 1.0;
      for (let i = 40; i < n; i += 80) diracAlt[i] = -1.0;
      const telemAlt = enhanceSpeechWithTelemetry(diracAlt);
      assert.equal(telemAlt.pcm.every(v => Number.isFinite(v)), true);

      // Dense spikes (every 10 samples)
      const diracDense = new Float32Array(n);
      for (let i = 0; i < n; i += 10) diracDense[i] = 1.0;
      const telemDense = enhanceSpeechWithTelemetry(diracDense);
      assert.equal(telemDense.pcm.every(v => Number.isFinite(v)), true);
    });
  });

  // ============================================================================
  // Dimension 4: Suffix window freezing under zero word boundaries
  // ============================================================================
  describe('Dimension 4: Suffix window freezing under zero word boundaries', () => {
    test('streaming decoder commits monotonically without space injection in compound words', () => {
      const decoder = new StreamingCTCDecoder({
        stabilityThreshold: 2,
        trailTokens: 3,
        highStabilityThreshold: 4,
      });

      const base = ['वि', 'द्या', 'ल', 'य', 'स्य', 'म', 'हा', 'रा', 'ज'];
      const syllables = [];
      for (let k = 0; k < 30; k++) syllables.push(...base); // 270 tokens

      const committedLens = [];
      for (let step = 0; step < syllables.length; step++) {
        const tokens = syllables.slice(0, step + 1);
        for (let f = 0; f < 5; f++) {
          decoder.update(tokens, false);
        }
        committedLens.push(decoder.getCommittedTokens().length);
      }

      const isMonotonic = committedLens.every((len, i) => i === 0 || len >= committedLens[i - 1]);
      assert.equal(isMonotonic, true);
      assert.ok(decoder.getCommittedTokens().length >= 250);

      // Verify that no spaces were injected into unbroken compound word
      assert.equal(decoder.getCommittedText().includes(' '), false);

      const finalRes = decoder.update(syllables, true);
      assert.equal(finalRes.isFinal, true);
      assert.ok(finalRes.text.length > 0);
    });
  });

  // ============================================================================
  // Dimension 5: Illegal Unicode combining mark sequences and cross-script collisions
  // ============================================================================
  describe('Dimension 5: Unicode combining mark sequences and cross-script collisions', () => {
    test('handles initial combining marks and cross-script collisions cleanly', () => {
      // Combining matra at pos 0
      const sMatra0 = '\u093E\u0915\u093E';
      assert.equal(normalizeIndicText(sMatra0), 'ाका');

      // Subword join with matra at pos 0 of volatile
      assert.equal(joinSubwords('राम', '\u093E'), 'रामा');

      // Cross-script matra collision: Devanagari base + Devanagari AA + Bengali AA + Gujarati virama
      const sCross = '\u0915\u093E\u09BE\u0ACD';
      assert.equal(normalizeIndicText(sCross), 'का');

      // Consecutive viramas across scripts
      const sViramas = '\u0915\u094D\u0C4D\u0BCD';
      assert.ok(normalizeIndicText(sViramas).startsWith('क्'));

      // Independent vowel with illegal dependent vowel sign
      const sIndep = '\u0905\u093E\u094D\u0B3E';
      assert.equal(normalizeIndicText(sIndep), 'अ');

      // Idempotency check: normalize(normalize(x)) == normalize(x)
      const corpus = [
        sMatra0,
        sCross,
        sViramas,
        sIndep,
        'संस्कृृतम्',
        'ಸ್ಥಗಿತಗೊಳಳ್ಸಿದೆ',
        'ಉಂമാ',
        'હું જઈષ',
        'ସଧ୍ୟାଂଙ୍କୁ',
        'ਉਹ ਇੱਥੇ',
      ];
      for (const s of corpus) {
        const n1 = normalizeIndicText(s);
        const n2 = normalizeIndicText(n1);
        assert.equal(n1, n2);
      }
    });
  });
});
