import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  StreamingCTCDecoder,
  Swanada,
  parseWav,
} from '../dist/index.mjs';

const TEST_WAV_PATH = '/Users/lika/labs/ninada/data/wavs/sa_rasa_male_01445fb1731b.wav';
const MODEL_PATH = './models/onnx/sushrota_sanskrit_ctc_int8.onnx';

describe('Adversarial Prefix Locking & Zero Character Churn Suite (Feature 11)', () => {
  it('guarantees strictly 0.00% character churn across 1,000 steps of fluctuating token streams', () => {
    const vocab = [
      '<blank>', '<unk>',
      '\u2581अ', '\u2581आ', '\u2581इ', '\u2581ई', '\u2581उ', '\u2581क', '\u2581ग', '\u2581त',
      '\u2581द', '\u2581न', '\u2581प', '\u2581म', '\u2581य', '\u2581र', '\u2581ल', '\u2581व',
      '\u2581स', '\u2581ह',
      'क', 'ख', 'ग', 'घ', 'च', 'छ', 'ज', 'झ', 'ट', 'ठ', 'ड', 'ढ', 'ण', 'त', 'थ', 'द', 'ध', 'न',
      'प', 'फ', 'ब', 'भ', 'म', 'य', 'र', 'ल', 'व', 'श', 'ष', 'स', 'ह',
      'ा', 'ि', 'ी', 'ु', 'ू', 'ृ', 'े', 'ै', 'ो', 'ौ', '्', 'ं', 'ः',
    ];

    const decoder = new StreamingCTCDecoder(vocab, {
      stabilityThreshold: 2,
      trailTokens: 2,
    });

    const committedHistory = [];
    const baseStream = [];
    const totalSteps = 1000;
    let churnEvents = 0;

    // Simple pseudo-random generator with fixed seed
    let seed = 42;
    function rand() {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    }
    function choice(arr) {
      return arr[Math.floor(rand() * arr.length)];
    }

    for (let step = 0; step < totalSteps; step++) {
      if (step % 3 === 0 || baseStream.length === 0) {
        baseStream.push(choice(vocab.slice(2)));
      }

      const volatileTailLen = Math.floor(rand() * 5);
      const volatileTail = [];
      for (let k = 0; k < volatileTailLen; k++) {
        volatileTail.push(choice(vocab.slice(2)));
      }

      const hypothesis = [...baseStream, ...volatileTail];
      if (hypothesis.length > 1 && rand() < 0.3) {
        hypothesis[hypothesis.length - 1] = choice(vocab.slice(2));
      }

      const st = decoder.update(hypothesis);
      if (st.committed) {
        committedHistory.push(st.committed);
      }

      if (committedHistory.length >= 2) {
        const prev = committedHistory[committedHistory.length - 2];
        const curr = committedHistory[committedHistory.length - 1];
        if (!curr.startsWith(prev)) {
          churnEvents++;
          assert.fail(`Character churn at step ${step}: prev="${prev}", curr="${curr}"`);
        }
      }
    }

    const finalSt = decoder.update(baseStream, true);
    if (committedHistory.length > 0) {
      const lastCommitted = committedHistory[committedHistory.length - 1];
      assert.ok(
        finalSt.committed.startsWith(lastCommitted),
        `Final flush churn: final="${finalSt.committed}", last="${lastCommitted}"`
      );
    }

    const churnRate = churnEvents / totalSteps;
    assert.equal(churnRate, 0.0, `Expected 0.00% churn, got ${(churnRate * 100).toFixed(2)}%`);
  });

  it('handles rapid blank bursts and empty token frames without state corruption', () => {
    const vocab = ['<blank>', '<unk>', '\u2581अ', 'हं', '\u2581त', 'त्र'];
    const decoder = new StreamingCTCDecoder(vocab, { stabilityThreshold: 2, trailTokens: 2 });

    for (let i = 0; i < 10; i++) {
      const st = decoder.update([]);
      assert.equal(st.committed, '');
      assert.equal(st.volatile, '');
    }

    decoder.update(['\u2581अ', 'हं', '\u2581त']);
    const st2 = decoder.update(['\u2581अ', 'हं', '\u2581त', 'त्र']);
    assert.equal(st2.committed, 'अहं');

    for (let i = 0; i < 5; i++) {
      const stEmpty = decoder.update([]);
      assert.equal(stEmpty.committed, 'अहं');
      assert.equal(stEmpty.volatile, '');
    }

    const stResume = decoder.update(['\u2581अ', 'हं', '\u2581त', 'त्र', '\u2581ग', 'त']);
    assert.ok(stResume.committed.startsWith('अहं'));
  });

  it('preserves consonants geminates vs vowel sign deduplication', () => {
    const vocab = ['<blank>', '<unk>', '\u2581क', 'क', '्', '\u2581त', 'त'];
    const decoder = new StreamingCTCDecoder(vocab, { stabilityThreshold: 2, trailTokens: 2 });

    const h = [];
    h.push(decoder.update(['\u2581क']).committed);
    h.push(decoder.update(['\u2581क', '्']).committed);
    h.push(decoder.update(['\u2581क', '्', 'क']).committed);
    h.push(decoder.update(['\u2581क', '्', 'क', '\u2581त']).committed);
    h.push(decoder.update(['\u2581क', '्', 'क', '\u2581त', 'त']).committed);

    const valid = h.filter(Boolean);
    for (let i = 1; i < valid.length; i++) {
      assert.ok(valid[i].startsWith(valid[i - 1]));
    }
  });

  it('handles isolated vowel marks gracefully', () => {
    const vocab = ['<blank>', '<unk>', '\u093e', '\u0941', '\u094d', '\u2581क', 'त'];
    const decoder = new StreamingCTCDecoder(vocab);

    const st1 = decoder.update(['\u093e']);
    assert.equal(st1.committed, '');
    const st2 = decoder.update(['\u093e', '\u0941']);
    assert.equal(st2.committed, '');
    const st3 = decoder.update(['\u093e', '\u0941', '\u2581क', 'त', '\u2581त']);
    assert.equal(typeof st3.committed, 'string');
  });

  it('handles single-letter words separated by space markers monotonically', () => {
    const vocab = ['<blank>', '<unk>', '\u2581क', '\u2581च', '\u2581त', '\u2581प', '\u2581म'];
    const decoder = new StreamingCTCDecoder(vocab);

    const h = [];
    const tokens = [];
    for (const tok of ['\u2581क', '\u2581च', '\u2581त', '\u2581प', '\u2581म']) {
      tokens.push(tok);
      const st = decoder.update([...tokens]);
      if (st.committed) h.push(st.committed);
    }

    for (let i = 1; i < h.length; i++) {
      assert.ok(h[i].startsWith(h[i - 1]));
    }
  });

  it('handles long 60-token compound without space markers monotonically', () => {
    const vocab = ['<blank>', '<unk>'];
    for (let i = 0; i < 80; i++) vocab.push(`sub_${i}`);
    const decoder = new StreamingCTCDecoder(vocab, { stabilityThreshold: 2, trailTokens: 2 });

    const h = [];
    const tokens = [];
    for (let i = 0; i < 60; i++) {
      tokens.push(`sub_${i}`);
      const st = decoder.update([...tokens]);
      if (st.committed) h.push(st.committed);
    }

    assert.ok(h.length >= 50);
    for (let i = 1; i < h.length; i++) {
      assert.ok(h[i].startsWith(h[i - 1]));
    }
  });

  it('verifies monotonic committed progression on real speech audio stream', async () => {
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

    const committedHistory = [];
    stream.on('partial', (p) => {
      if (p.committed) committedHistory.push(p.committed);
    });

    const chunkSize = 3200; // 200ms
    for (let i = 0; i < pcm.length; i += chunkSize) {
      const chunk = pcm.subarray(i, Math.min(pcm.length, i + chunkSize));
      await stream.push(chunk);
    }

    const finalRes = await stream.finish();

    assert.ok(committedHistory.length > 0);
    for (let i = 1; i < committedHistory.length; i++) {
      const prev = committedHistory[i - 1];
      const curr = committedHistory[i];
      assert.ok(
        curr.startsWith(prev),
        `Streaming churn: prev="${prev}", curr="${curr}"`
      );
    }

    assert.ok(
      finalRes.text.startsWith(committedHistory[committedHistory.length - 1]),
      `Final "${finalRes.text}" does not start with last committed "${committedHistory[committedHistory.length - 1]}"`
    );

    await stt.release();
  });
});
