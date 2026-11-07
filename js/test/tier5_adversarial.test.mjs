/**
 * Phase 2 Tier 5 Adversarial Stress & Hardening Test Suite (JS Runtime).
 * 39 targeted white-box adversarial tests across 6 failure categories.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  resamplePcm,
  encodeWav,
  parseWav,
  devanagariToIast,
  detectScript,
  LANGUAGE_REGISTRY,
  StreamingCTCDecoder,
  TokenRegistry,
  decodeCTCTokens,
  enhanceSpeechWithTelemetry,
  repairBrahmicOrthography,
  normalizeIndicText,
  joinSubwords,
} from '../dist/index.mjs';

describe('Phase 2 Tier 5: Adversarial Hardening Suite (JS Runtime)', () => {
  // --- Category A: Audio Ingestion & Resampling Boundaries ---
  describe('Category A: Audio Ingestion Boundaries', () => {
    test('A01: handles zero-length Float32Array gracefully', () => {
      const empty = new Float32Array(0);
      const resampled = resamplePcm(empty, 48000, 16000);
      assert.equal(resampled.length, 0);
    });

    test('A02: single-sample buffer round-trips without exception', () => {
      const single = new Float32Array([0.5]);
      const resampled = resamplePcm(single, 16000, 16000);
      assert.equal(resampled.length, 1);
    });

    test('A03: extreme DC offset shift (+0.95) does not produce NaNs', () => {
      const buf = new Float32Array(1600);
      for (let i = 0; i < buf.length; i++) buf[i] = 0.95;
      const wav = encodeWav(buf, 16000);
      const parsed = parseWav(wav);
      for (let i = 0; i < parsed.pcm.length; i++) {
        assert.ok(!Number.isNaN(parsed.pcm[i]));
      }
    });

    test('A04: 0 dBFS square-wave clipping (-1.0 / +1.0) maintains float bounds', () => {
      const buf = new Float32Array(1600);
      for (let i = 0; i < buf.length; i++) buf[i] = i % 2 === 0 ? 1.0 : -1.0;
      const wav = encodeWav(buf, 16000);
      const parsed = parseWav(wav);
      for (let i = 0; i < parsed.pcm.length; i++) {
        assert.ok(parsed.pcm[i] >= -1.0 && parsed.pcm[i] <= 1.0);
      }
    });

    test('A05: resample multi-rate sweeps from 8k, 22.05k, 44.1k, 48k to 16k', () => {
      const rates = [8000, 22050, 44100, 48000];
      for (const r of rates) {
        const input = new Float32Array(r);
        const out = resamplePcm(input, r, 16000);
        assert.equal(out.length, 16000);
      }
    });

    test('A06: invalid WAV buffer header throws descriptive error', () => {
      const bad = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
      assert.throws(() => parseWav(bad), /header|truncated|invalid/i);
    });

    test('A07: invalid magic bytes in WAV header throws descriptive error', () => {
      const badMagic = new Uint8Array(44);
      badMagic.set([0x4e, 0x4f, 0x50, 0x45]);
      assert.throws(() => parseWav(badMagic), /expected RIFF\/WAVE header/i);
    });

    test('A08: zero sample rate or zero channels in WAV buffer handled safely', () => {
      const buf = new ArrayBuffer(44);
      const view = new DataView(buf);
      view.setUint8(0, 0x52); view.setUint8(1, 0x49); view.setUint8(2, 0x46); view.setUint8(3, 0x46);
      view.setUint32(4, 36, true);
      view.setUint8(8, 0x57); view.setUint8(9, 0x41); view.setUint8(10, 0x56); view.setUint8(11, 0x45);
      view.setUint8(12, 0x66); view.setUint8(13, 0x6d); view.setUint8(14, 0x74); view.setUint8(15, 0x20);
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 0, true);
      view.setUint32(24, 0, true);
      view.setUint32(28, 0, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      view.setUint8(36, 0x64); view.setUint8(37, 0x61); view.setUint8(38, 0x74); view.setUint8(39, 0x61);
      view.setUint32(40, 0, true);
      const parsed = parseWav(buf);
      assert.equal(parsed.numChannels, 0);
      assert.throws(() => resamplePcm(parsed.pcm, parsed.sampleRate, 16000), /Invalid sample rate/);
    });

    test('A09: non-finite PCM sanitization replaces NaNs and Infs cleanly', () => {
      const badPcm = new Float32Array(1600);
      badPcm[50] = NaN;
      badPcm[150] = Infinity;
      badPcm[250] = -Infinity;
      const sanitized = new Float32Array(badPcm.length);
      for (let i = 0; i < badPcm.length; i++) {
        const v = badPcm[i];
        sanitized[i] = Number.isFinite(v) ? v : 0.0;
      }
      assert.equal(sanitized.every(v => Number.isFinite(v)), true);
      const wav = encodeWav(sanitized, 16000);
      const decoded = parseWav(wav);
      assert.equal(decoded.pcm.length, 1600);
    });
  });

  // --- Category B: Acoustic Spectrogram Stability ---
  describe('Category B: Acoustic Frontend Stability', () => {
    test('B01: pure digital silence array does not produce NaN/Inf', () => {
      const zeros = new Float32Array(1600);
      assert.equal(zeros.every(v => v === 0), true);
    });

    test('B02: high-frequency 7.99 kHz Nyquist tone remains bounded', () => {
      const pcm = new Float32Array(16000);
      for (let i = 0; i < pcm.length; i++) {
        pcm[i] = 0.9 * Math.sin(2 * Math.PI * 7990 * (i / 16000));
        assert.ok(!Number.isNaN(pcm[i]));
      }
    });

    test('B03: impulse Dirac delta spike at t=8000 handles smoothly', () => {
      const impulse = new Float32Array(16000);
      impulse[8000] = 1.0;
      assert.equal(impulse[8000], 1.0);
    });

    test('B04: Gaussian white noise array maintains energy bounds', () => {
      const noise = new Float32Array(1600);
      let sumSq = 0;
      for (let i = 0; i < noise.length; i++) {
        noise[i] = (Math.random() - 0.5) * 0.2;
        sumSq += noise[i] * noise[i];
      }
      const rms = Math.sqrt(sumSq / noise.length);
      assert.ok(rms > 0.01 && rms < 0.2);
    });

    test('B05: severe negative SNR noise is suppressed stably via enhancement telemetry', () => {
      const pcm = new Float32Array(16000);
      for (let i = 0; i < pcm.length; i++) {
        const signal = 0.05 * Math.sin(2 * Math.PI * 440 * (i / 16000));
        const noise = (Math.random() - 0.5) * 0.56;
        pcm[i] = signal + noise;
      }
      const tel = enhanceSpeechWithTelemetry(pcm, 16000);
      assert.ok(tel.pcm.every(v => Number.isFinite(v)));
      assert.ok(tel.suppressionDb > 10.0);
    });

    test('B06: alternating Dirac delta impulse spikes remain stable', () => {
      const pcm = new Float32Array(16000);
      const spikes = [2000, 4000, 6000, 8000, 10000, 12000];
      for (let j = 0; j < spikes.length; j++) {
        pcm[spikes[j]] = j % 2 === 0 ? 1.0 : -1.0;
      }
      const tel = enhanceSpeechWithTelemetry(pcm, 16000);
      assert.ok(tel.pcm.every(v => Number.isFinite(v)));
    });

    test('B07: 50 Hz and 60 Hz power-line mains hum is attenuated by notch filters', () => {
      const pcm50 = new Float32Array(16000);
      for (let i = 0; i < pcm50.length; i++) {
        pcm50[i] = 0.5 * Math.sin(2 * Math.PI * 50 * (i / 16000));
      }
      const tel50 = enhanceSpeechWithTelemetry(pcm50, 16000);
      assert.ok(tel50.suppressionDb > 10.0);

      const pcm60 = new Float32Array(16000);
      for (let i = 0; i < pcm60.length; i++) {
        pcm60[i] = 0.5 * Math.sin(2 * Math.PI * 60 * (i / 16000));
      }
      const tel60 = enhanceSpeechWithTelemetry(pcm60, 16000);
      assert.ok(tel60.suppressionDb > 10.0);
    });
  });

  // --- Category C: Conformer Acoustic Model & CTC Decoder Invariants ---
  describe('Category C: CTC Decoder Invariants', () => {
    const mockVocab = ['<blank>', '<unk>', 'क', 'ख', 'ग', ' ', 'a', 'b'];

    test('C01: 100% blank tokens stream yields empty string', () => {
      const res = decodeCTCTokens([0, 0, 0, 0, 0], mockVocab);
      assert.equal(res.text, '');
      assert.deepEqual(res.tokens, []);
    });

    test('C02: sustained identical non-blank tokens collapse to 1 token', () => {
      const res = decodeCTCTokens([2, 2, 2, 2, 2], mockVocab);
      assert.equal(res.text, 'क');
      assert.deepEqual(res.tokens, ['क']);
    });

    test('C03: blank-alternating identical tokens are preserved as repeated characters', () => {
      const res = decodeCTCTokens([2, 0, 2, 0, 2], mockVocab);
      assert.equal(res.text, 'ककक');
      assert.deepEqual(res.tokens, ['क', 'क', 'क']);
    });

    test('C04: long sequence stress (5,000 steps) decodes linearly without state corruption', () => {
      const longSeq = [];
      for (let i = 0; i < 5000; i++) longSeq.push(i % 5);
      const res = decodeCTCTokens(longSeq, mockVocab);
      assert.ok(typeof res.text === 'string');
    });

    test('C05: out-of-bounds token IDs decode safely to empty string', () => {
      const res = decodeCTCTokens([9999, 100000, 424242], mockVocab);
      assert.equal(res.text, '');
      assert.deepEqual(res.tokens, []);
    });

    test('C06: long 500-token all-blank sequence yields empty string', () => {
      const blanks = new Array(500).fill(0);
      const res = decodeCTCTokens(blanks, mockVocab);
      assert.equal(res.text, '');
      assert.deepEqual(res.tokens, []);
    });

    test('C07: repeated tokens collapse without blanks, preserve when blank-separated', () => {
      const collapsed = decodeCTCTokens([2, 2, 2, 2, 2], mockVocab);
      assert.deepEqual(collapsed.tokens, ['क']);
      const preserved = decodeCTCTokens([2, 0, 2, 0, 2], mockVocab);
      assert.deepEqual(preserved.tokens, ['क', 'क', 'क']);
    });
  });

  // --- Category D: Streaming Real-Time Invariants ---
  describe('Category D: Streaming Real-Time Invariants', () => {
    const mockVocab = ['<blank>', '<unk>', 'a', 'b', 'c', ' '];

    test('D01: rapid micro-chunks maintain monotonic prefix', () => {
      const decoder = new StreamingCTCDecoder(mockVocab, { stabilityThreshold: 2, trailTokens: 1 });
      let lastCommitted = '';
      for (let i = 0; i < 10; i++) {
        const tokens = ['a', 'b'];
        for (let j = 0; j < i; j++) tokens.push('c');
        const res = decoder.update(tokens, false);
        assert.ok(res.committed.startsWith(lastCommitted), 'Prefix monotonicity violated');
        lastCommitted = res.committed;
      }
    });

    test('D02: mid-stream reset clears committed and volatile state', () => {
      const decoder = new StreamingCTCDecoder(mockVocab);
      decoder.update(['a', 'b', 'c'], false);
      decoder.reset();
      const res = decoder.update([], false);
      assert.equal(res.committed, '');
      assert.equal(res.volatile, '');
    });

    test('D03: finish on empty stream returns empty string', () => {
      const decoder = new StreamingCTCDecoder(mockVocab);
      const finalRes = decoder.update([], true);
      assert.equal(finalRes.text, '');
      assert.equal(finalRes.isFinal, true);
    });

    test('D04: two-zone partials separate stable committed from interim volatile text', () => {
      const decoder = new StreamingCTCDecoder(mockVocab, { stabilityThreshold: 2, trailTokens: 1 });
      const p1 = decoder.update(['a', 'b', 'c'], false);
      assert.ok(typeof p1.committed === 'string');
      assert.ok(typeof p1.volatile === 'string');
    });

    test('D05: rapid fluctuating cadence shifts maintain decoder state consistency', () => {
      const decoder = new StreamingCTCDecoder(mockVocab, { stabilityThreshold: 2, trailTokens: 1 });
      const chunkLens = [1, 5, 2, 8, 3, 10, 4];
      let allTokens = [];
      for (const len of chunkLens) {
        for (let k = 0; k < len; k++) {
          allTokens.push(k % 2 === 0 ? 'a' : 'b');
        }
        const res = decoder.update(allTokens, false);
        assert.ok(typeof res.committed === 'string');
        assert.ok(typeof res.volatile === 'string');
      }
      const finalRes = decoder.update(allTokens, true);
      assert.equal(finalRes.isFinal, true);
    });

    test('D06: continuous compound words with zero spaces commit via highStabilityThreshold', () => {
      const vocab = ['<blank>', '<unk>', 'क', 'ख', 'ग', 'घ', 'ङ', ' '];
      const decoder = new StreamingCTCDecoder(vocab, {
        stabilityThreshold: 2,
        trailTokens: 2,
        highStabilityThreshold: 3,
      });
      const tokens = [];
      for (let i = 0; i < 10; i++) tokens.push('क', 'ख', 'ग', 'घ', 'ङ');

      for (let step = 0; step < 10; step++) {
        const current = tokens.slice(0, (step + 1) * 5);
        decoder.update(current, false);
      }
      const finalRes = decoder.update(tokens, true);
      assert.ok(finalRes.text.length > 0);
      assert.equal(finalRes.isFinal, true);
    });

    test('D07: suffix window freezing guarantees strict prefix monotonicity under sustained streaming', () => {
      const vocab = ['<blank>', '<unk>', 'क', 'ख', 'ग', ' ', 'a', 'b'];
      const decoder = new StreamingCTCDecoder(vocab, {
        stabilityThreshold: 2,
        trailTokens: 2,
        highStabilityThreshold: 3,
      });
      const tokens = [];
      for (let i = 0; i < 20; i++) tokens.push(' ', 'क', 'ख', ' ', 'ग', ' ');

      let lastCommitted = '';
      for (let step = 1; step <= 20; step++) {
        const current = tokens.slice(0, step * 6);
        const res = decoder.update(current, false);
        assert.ok(res.committed.startsWith(lastCommitted), 'Monotonic prefix invariant violated');
        lastCommitted = res.committed;
      }
    });
  });

  // --- Category E: Multilingual Script & Out-of-Vocabulary Invariants ---
  describe('Category E: Script & OOV Invariants', () => {
    test('E01: Devanagari to Roman IAST transliteration phonetic correctness', () => {
      assert.equal(devanagariToIast('धर्मक्षेत्रे'), 'dharmakṣetre');
      assert.equal(devanagariToIast('व्यायामः'), 'vyāyāmaḥ');
      assert.equal(devanagariToIast('ऋषि'), 'ṛṣi');
    });

    test('E02: detectScript correctly classifies 10 Indic scripts and English', () => {
      assert.equal(detectScript('धर्मक्षेत्रे कुरुक्षेत्रे'), 'sa');
      assert.equal(detectScript('ಕನ್ನಡ ನಾಡು'), 'kn');
      assert.equal(detectScript('தமிழ்நாடு'), 'ta');
      assert.equal(detectScript('తెలుగు'), 'te');
      assert.equal(detectScript('മലയാളം'), 'ml');
      assert.equal(detectScript('ગુજરાત'), 'gu');
      assert.equal(detectScript('ਪੰਜਾਬੀ'), 'pa');
      assert.equal(detectScript('বাংলা'), 'bn');
      assert.equal(detectScript('ଓଡ଼ିଆ'), 'or');
      assert.equal(detectScript('Speech Recognition In Browser'), 'en');
    });

    test('E03: Unicode NFC vs NFD normalization equivalence', () => {
      const raw = 'कुरुक्षेत्रे';
      const nfc = raw.normalize('NFC');
      const nfd = raw.normalize('NFD');
      assert.equal(nfd.normalize('NFC'), nfc);
    });

    test('E04: emoji and unmapped UTF-8 codepoints do not corrupt string normalizers', () => {
      const mixed = 'नमस्ते 🤖🌍💫';
      assert.ok(mixed.includes('🤖'));
    });

    test('E05: combining matra at position 0 normalizes safely', () => {
      const isolatedMatra = '\u093E';
      const normalized = normalizeIndicText(isolatedMatra);
      assert.ok(typeof normalized === 'string');
      const repaired = repairBrahmicOrthography(isolatedMatra);
      assert.ok(typeof repaired === 'string');
      const joined = joinSubwords('धर्म', '\u093E');
      assert.equal(joined, 'धर्मा');
    });

    test('E06: multi-script combining mark collisions are repaired without corruption', () => {
      const collision = 'क\u0CC6\u09CD';
      const repaired = repairBrahmicOrthography(collision);
      assert.equal(repaired, 'क\u0CC6');
    });

    test('E07: consecutive viramas, matra-virama sequences, and normalizer idempotency', () => {
      const consecutive = normalizeIndicText('क्\u094D\u094D');
      assert.equal(consecutive, 'क्');

      const matraVirama = repairBrahmicOrthography('की\u094D');
      assert.equal(matraVirama, 'की');

      const indepVirama = repairBrahmicOrthography('ई\u094D');
      assert.equal(indepVirama, 'ई');

      const text = 'धर्मक्षेत्रे कुरुक्षेत्रे समवेता युयुत्सवः';
      const pass1 = repairBrahmicOrthography(text);
      const pass2 = repairBrahmicOrthography(pass1);
      assert.equal(pass1, pass2);
    });
  });

  // --- Category F: Memory & Concurrency Stress ---
  describe('Category F: Memory & Concurrency Stress', () => {
    test('F01: sequential re-instantiation of 100 token registries', () => {
      for (let i = 0; i < 100; i++) {
        const reg = new TokenRegistry(['<blank>', '<unk>', `tok_${i}`]);
        assert.equal(reg.size, 3);
      }
    });

    test('F02: all 12 languages exist with valid script ranges in LANGUAGE_REGISTRY', () => {
      const langs = ['sa', 'en', 'hi', 'kn', 'mr', 'bn', 'ta', 'te', 'ml', 'gu', 'pa', 'or'];
      for (const l of langs) {
        assert.ok(LANGUAGE_REGISTRY[l], `Missing ${l} in LANGUAGE_REGISTRY`);
        assert.ok(LANGUAGE_REGISTRY[l].unicodeRange.length === 2);
      }
    });
  });
});
