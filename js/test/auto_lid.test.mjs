import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  Swanada,
  LID_LANGUAGES,
  parseLidHeadBytes,
  serializeLidHeadBytes,
  predictLidLogProbs,
  decodeBilingualCodeswitch,
  parseWav,
} from '../dist/index.mjs';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const SAMPLES_DIR = path.join(REPO_ROOT, 'docs', 'samples');

test('SLID v1 binary roundtrip and validation in JS', () => {
  const dIn = 512;
  const dAtt = 64;
  const dHid = 64;
  const nLangs = LID_LANGUAGES.length;

  const mk = (n, scale = 0.02) => {
    const a = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = Math.sin(i * 0.17) * scale;
    return a;
  };

  const weights = {
    dIn,
    dAtt,
    dHid,
    languages: LID_LANGUAGES,
    wAtt: mk(dIn * dAtt),
    bAtt: mk(dAtt),
    vAtt: mk(dAtt),
    lnGamma: new Float32Array(2 * dIn).fill(1),
    lnBeta: new Float32Array(2 * dIn).fill(0),
    wFc1: mk(2 * dIn * dHid),
    bFc1: mk(dHid),
    wFc2: mk(dHid * nLangs),
    bFc2: mk(nLangs),
    temperature: 1.1,
  };

  const bytes = serializeLidHeadBytes(weights);
  assert.equal(bytes.byteLength, 405324);

  const parsed = parseLidHeadBytes(bytes);
  assert.equal(parsed.dIn, 512);
  assert.equal(parsed.dAtt, 64);
  assert.equal(parsed.dHid, 64);
  assert.ok(Math.abs(parsed.temperature - 1.1) < 1e-6);

  const hidden = mk(20 * 512, 0.5);
  const lp1 = predictLidLogProbs(weights, hidden, 20);
  const lp2 = predictLidLogProbs(parsed, hidden, 20);
  let probSum = 0;
  for (const lg of LID_LANGUAGES) {
    assert.ok(Math.abs(lp1[lg] - lp2[lg]) < 1e-6);
    probSum += Math.exp(lp2[lg]);
  }
  assert.ok(Math.abs(probSum - 1.0) < 1e-5);

  assert.throws(() => parseLidHeadBytes(new Uint8Array([1, 2, 3, 4])));
  assert.throws(() => parseLidHeadBytes(bytes.subarray(0, 64)));
});

test('Bilingual Indic+English code-switching splices confident English words', () => {
  const hiVocab = new Array(257).fill('');
  const enVocab = new Array(257).fill('');
  hiVocab[10] = '▁मेरा';
  hiVocab[11] = '▁अकाउण्ट';
  hiVocab[13] = '▁करो';

  enVocab[20] = '▁';
  enVocab[21] = 'a';
  enVocab[22] = 'c';
  enVocab[23] = 'o';
  enVocab[24] = 'u';
  enVocab[25] = 'n';
  enVocab[26] = 't';

  const T = 26;
  const indicLogits = new Float32Array(T * 257).fill(-12);
  const enLogits = new Float32Array(T * 257).fill(-12);
  for (let t = 0; t < T; t++) {
    indicLogits[t * 257] = 6;
    enLogits[t * 257] = 6;
  }

  indicLogits[2 * 257] = -5;
  indicLogits[2 * 257 + 10] = 8.5;

  indicLogits[10 * 257] = -1;
  indicLogits[10 * 257 + 11] = 0.1;
  const seqEn = [20, 21, 22, 0, 22, 23, 24, 25, 26];
  for (let i = 0; i < seqEn.length; i++) {
    const f = 8 + i;
    enLogits.fill(-12, f * 257, (f + 1) * 257);
    enLogits[f * 257 + seqEn[i]] = 9.5;
  }

  indicLogits[22 * 257] = -5;
  indicLogits[22 * 257 + 13] = 8.5;

  const res = decodeBilingualCodeswitch(indicLogits, T, hiVocab, 'hi', enLogits, enVocab, false);
  assert.ok(res.text.includes('मेरा'));
  assert.ok(res.text.includes('account'));
  assert.ok(res.text.includes('करो'));
  assert.equal(res.englishSpans.length, 1);
  assert.equal(res.englishSpans[0].word, 'account');
  assert.equal(
    res.text.slice(res.englishSpans[0].startChar, res.englishSpans[0].endChar),
    'account'
  );
});

test('Node SDK Auto-LID end-to-end, silence zero-hallucination, streaming & CLI', async () => {
  const stt = await Swanada.create({ language: 'auto', codeSwitchEn: true, numThreads: 2 });

  // 1. Silence must produce 0 invented words
  const silence = new Float32Array(32000);
  const silRes = await stt.transcribe(silence);
  assert.equal(silRes.text, '');

  // 2. Auto-LID across distinct languages
  for (const expectedLang of ['hi', 'kn', 'sa']) {
    const wavPath = path.join(SAMPLES_DIR, `${expectedLang}.wav`);
    const res = await stt.transcribe(wavPath);
    assert.equal(res.language, expectedLang);
    assert.ok(typeof res.languageConfidence === 'number' && res.languageConfidence > 0);
    assert.ok(res.text.trim().length > 0);
    if (expectedLang === 'sa') {
      assert.ok(typeof res.iast === 'string' && res.iast.length > 0);
    }
  }

  // 3. Streaming Auto-LID
  const saWav = parseWav(fs.readFileSync(path.join(SAMPLES_DIR, 'sa.wav')));
  const stream = stt.createStream();
  let sawDetected = false;
  stream.on('partial', (p) => {
    if (p.detectedLanguage) sawDetected = true;
  });
  for (let i = 0; i < saWav.pcm.length; i += 4800) {
    await stream.push(saWav.pcm.subarray(i, i + 4800));
  }
  const finalRes = await stream.finish();
  assert.ok(sawDetected || finalRes.language === 'sa');
  assert.equal(finalRes.language, 'sa');
  assert.ok(finalRes.text.trim().length > 0);

  await stt.dispose();

  // 4. Node CLI `-l auto --code-switch-en --json`
  const cliOut = execFileSync(
    process.execPath,
    [
      path.join(REPO_ROOT, 'js', 'bin', 'swanada.mjs'),
      path.join(SAMPLES_DIR, 'hi.wav'),
      '-l',
      'auto',
      '--code-switch-en',
      '--json',
      '--threads',
      '2',
    ],
    { encoding: 'utf8' }
  );
  const parsedCli = JSON.parse(cliOut.trim());
  assert.equal(parsedCli.language, 'hi');
  assert.ok(parsedCli.text.trim().length > 0);
});
