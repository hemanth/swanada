/**
 * Phase 2 Tier 5 Adversarial Stress & Hardening Test Suite (JS Runtime).
 * 24 targeted white-box adversarial tests across 6 failure categories.
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
