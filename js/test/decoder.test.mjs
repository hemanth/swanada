import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeCTC,
  decodeCTCTokens,
  CTCGreedyDecoder,
  dedupMarks,
  normalizeIndicText,
  assembleText,
  isSpecialToken,
} from '../dist/index.mjs';

const DUMMY_VOCAB = [
  '<blank>',  // 0
  '<unk>',    // 1
  '\u2581स',   // 2
  'त्य',      // 3
  'म्',       // 4
  '\u2581व',   // 5
  'द',        // 6
  '\u2581b',   // 7
  'o',        // 8
  'k',        // 9
];

describe('Linear-Time CTC Decoder & Normalizer Suite', () => {
  it('eliminates blank tokens (index 0) from decoded output', () => {
    const tokens = [0, 2, 0, 3, 0];
    const res = decodeCTCTokens(tokens, DUMMY_VOCAB);
    assert.deepEqual(res.tokenIds, [2, 3]);
    assert.deepEqual(res.tokens, ['\u2581स', 'त्य']);
    assert.equal(res.text, 'सत्य');

    // All-blank sequence produces empty string
    const allBlanks = decodeCTCTokens([0, 0, 0], DUMMY_VOCAB);
    assert.equal(allBlanks.text, '');
    assert.equal(allBlanks.tokenIds.length, 0);
  });

  it('collapses consecutive identical non-blank tokens', () => {
    // [2, 2, 2, 3, 3, 4] -> [2, 3, 4]
    const tokens = [2, 2, 2, 3, 3, 4];
    const res = decodeCTCTokens(tokens, DUMMY_VOCAB);
    assert.deepEqual(res.tokenIds, [2, 3, 4]);
    assert.equal(res.text, 'सत्यम्');
  });

  it('preserves legitimate repeated tokens separated by blanks', () => {
    // English "book": [7, 8, 8, 0, 8, 8, 9] -> 'b', 'o', [blank], 'o', 'k'
    const tokens = [7, 8, 8, 0, 8, 8, 9];
    const res = decodeCTCTokens(tokens, DUMMY_VOCAB);
    assert.deepEqual(res.tokenIds, [7, 8, 8, 9]);
    assert.equal(res.text, 'book');
  });

  it('restores whitespace from SentencePiece \\u2581 and legacy ▁ markers', () => {
    const tokens = ['\u2581सत्यम्', '\u2581वद', '▁धर्मम्'];
    const text = assembleText(tokens);
    assert.equal(text, 'सत्यम् वद धर्मम्');
  });

  it('deduplicates illegal doubled combining marks while keeping double consonants', () => {
    // Double u-matra artifact: 'स' + ' ु' + ' ु' -> 'सु'
    const doubleMatra = 'सु\u0941';
    assert.equal(dedupMarks(doubleMatra), 'सु');

    // Double virama: 'त' + '्' + '्' -> 'त्'
    const doubleVirama = 'त\u094D\u094D';
    assert.equal(dedupMarks(doubleVirama), 'त्');

    // English double letters preserved
    assert.equal(dedupMarks('hello book'), 'hello book');

    // Indic double consonants preserved
    assert.equal(dedupMarks('सल्लल्लाहु'), 'सल्लल्लाहु');
  });

  it('normalizes to Unicode NFC canonical composition across scripts', () => {
    // Decomposed Bengali O-kar
    const decomposedBn = '\u09C7\u09BE';
    assert.equal(normalizeIndicText(decomposedBn), '\u09CB');

    // Decomposed Tamil O-kar
    const decomposedTa = '\u0BC6\u0BBE';
    assert.equal(normalizeIndicText(decomposedTa), '\u0BCA');

    // Roman IAST diacritics
    const iastDecomposed = 'r\u0323\u0304 a\u0304 i\u0304 u\u0304 s\u0301 s\u0323';
    assert.equal(normalizeIndicText(iastDecomposed), 'ṝ ā ī ū ś ṣ');
  });

  it('skips special non-speech tokens in output text', () => {
    assert.equal(isSpecialToken('<unk>'), true);
    assert.equal(isSpecialToken('<blank>'), true);
    assert.equal(isSpecialToken('[PAD]'), true);
    assert.equal(isSpecialToken('\u2581स'), false);

    const tokens = [0, 1, 2, 3];
    const res = decodeCTCTokens(tokens, DUMMY_VOCAB, { skipSpecialTokens: true });
    assert.equal(res.text, 'सत्य');
    assert.ok(!res.tokens.includes('<unk>'));
  });

  it('maintains streaming continuity across consecutive audio chunks', () => {
    const decoder = new CTCGreedyDecoder(DUMMY_VOCAB);

    // Chunk 1 ends with token 2 (स)
    const c1Logits = new Float32Array(3 * DUMMY_VOCAB.length);
    for (let t = 0; t < 3; t++) c1Logits[t * DUMMY_VOCAB.length + 2] = 5.0;
    const res1 = decoder.decodeChunk(c1Logits, [3, DUMMY_VOCAB.length]);
    assert.deepEqual(res1.tokenIds, [2]);

    // Chunk 2 continues on token 2 (boundary continuity)
    const c2Logits = new Float32Array(3 * DUMMY_VOCAB.length);
    for (let t = 0; t < 3; t++) c2Logits[t * DUMMY_VOCAB.length + 2] = 5.0;
    const res2 = decoder.decodeChunk(c2Logits, [3, DUMMY_VOCAB.length]);
    assert.deepEqual(res2.tokenIds, []); // Duplication suppressed!

    // Chunk 3 transitions to token 3 (त्य)
    const c3Logits = new Float32Array(2 * DUMMY_VOCAB.length);
    for (let t = 0; t < 2; t++) c3Logits[t * DUMMY_VOCAB.length + 3] = 5.0;
    const res3 = decoder.decodeChunk(c3Logits, [2, DUMMY_VOCAB.length]);
    assert.deepEqual(res3.tokenIds, [3]);
  });

  it('deduplicates complex two-part Brahmic vowel signs across scripts', () => {
    const cases = [
      ['bengali_o', 'ক\u09cb\u09cb', 'কো'],
      ['bengali_au', 'ক\u09cc\u09cc', 'কৌ'],
      ['odia_ai', 'କ\u0b48\u0b48', 'କୈ'],
      ['odia_o', 'କ\u0b4b\u0b4b', 'କୋ'],
      ['odia_au', 'କ\u0b4c\u0b4c', 'କୌ'],
      ['tamil_o', 'க\u0bca\u0bca', 'கொ'],
      ['tamil_oo', 'க\u0bcb\u0bcb', 'கோ'],
      ['tamil_au', 'க\u0bcc\u0bcc', 'கௌ'],
      ['telugu_ai', 'క\u0c48\u0c48', 'కై'],
      ['kannada_ii', 'ಕ\u0cc0\u0cc0', 'ಕೀ'],
      ['kannada_ee', 'ಕ\u0cc7\u0cc7', 'ಕೇ'],
      ['kannada_ai', 'ಕ\u0cc8\u0cc8', 'ಕೈ'],
      ['kannada_o', 'ಕ\u0cca\u0cca', 'ಕೊ'],
      ['kannada_oo', 'ಕ\u0ccb\u0ccb', 'ಕೋ'],
      ['malayalam_o', 'ക\u0d4a\u0d4a', 'കൊ'],
      ['malayalam_oo', 'ക\u0d4b\u0d4b', 'കോ'],
      ['malayalam_au', 'ക\u0d4c\u0d4c', 'കൌ'],
    ];

    for (const [name, raw, expected] of cases) {
      assert.equal(normalizeIndicText(raw), expected, `Failed for ${name}: ${raw} -> ${expected}`);
    }
  });

  it('safely decodes empty tensors and empty dimensions without errors', () => {
    const rEmpty0 = decodeCTC(new Float32Array([]), [0, 257], DUMMY_VOCAB);
    assert.equal(rEmpty0.text, '');
    assert.equal(rEmpty0.tokens.length, 0);

    const rEmptyClasses = decodeCTC(new Float32Array([]), [1, 0], DUMMY_VOCAB);
    assert.equal(rEmptyClasses.text, '');
    assert.equal(rEmptyClasses.tokens.length, 0);

    const rEmptyDims = decodeCTC(new Float32Array([]), [], DUMMY_VOCAB);
    assert.equal(rEmptyDims.text, '');
    assert.equal(rEmptyDims.tokens.length, 0);
  });
});
