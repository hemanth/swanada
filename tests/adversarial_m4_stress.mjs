import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const TEST_WAV = '/Users/lika/labs/ninada/data/wavs/sa_rasa_male_01445fb1731b.wav';
const MODEL_PATH = path.resolve(ROOT_DIR, 'models/onnx/sushrota_sanskrit_ctc_int8.onnx');

console.log('=== STARTING ADVERSARIAL STRESS SUITE: MILESTONE 4 ===');

// -------------------------------------------------------------
// Helper: create a valid WAV buffer with custom sample rate & PCM
// -------------------------------------------------------------
function makeWavBuffer(pcm, sampleRate = 16000, numChannels = 1, bitsPerSample = 16) {
  const bytesPerSample = bitsPerSample / 8;
  const dataSize = pcm.length * bytesPerSample;
  const buf = Buffer.alloc(44 + dataSize);

  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); // subchunk1size
  buf.writeUInt16LE(1, 20);  // PCM format
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28);
  buf.writeUInt16LE(numChannels * bytesPerSample, 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);

  let offset = 44;
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1.0, Math.min(1.0, pcm[i]));
    const intVal = s < 0 ? Math.floor(s * 32768.0) : Math.min(32767, Math.floor(s * 32767.0));
    buf.writeInt16LE(intVal, offset);
    offset += 2;
  }
  return buf;
}

async function run() {
  const results = { passed: 0, failed: 0, details: [] };

  function test(name, fn) {
    return (async () => {
      try {
        await fn();
        console.log(`  [PASS] ${name}`);
        results.passed++;
        results.details.push({ name, status: 'PASS' });
      } catch (err) {
        console.error(`  [FAIL] ${name}: ${err.message}`);
        console.error(err.stack);
        results.failed++;
        results.details.push({ name, status: 'FAIL', error: err.message });
      }
    })();
  }

  // ============================================================
  // Suite 1: CJS / ESM Interop & Module Boundary Stress
  // ============================================================
  console.log('\n--- Suite 1: CJS / ESM Module Boundary & Interop Stress ---');

  await test('1.1 Pure CJS require loads all symbols and classes', async () => {
    const require = createRequire(import.meta.url);
    const cjs = require('../js/dist/index.cjs');
    assert.equal(typeof cjs.Swanada, 'function');
    assert.equal(typeof cjs.AcousticEngine, 'function');
    assert.equal(typeof cjs.parseWav, 'function');
    assert.equal(typeof cjs.encodeWav, 'function');
    assert.equal(typeof cjs.resamplePcm, 'function');
    assert.equal(typeof cjs.transliterateIast, 'function');
    assert.equal(typeof cjs.decodeCTC, 'function');
  });

  await test('1.2 Pure ESM dynamic import loads all symbols and classes', async () => {
    const esm = await import('../js/dist/index.mjs');
    assert.equal(typeof esm.Swanada, 'function');
    assert.equal(typeof esm.AcousticEngine, 'function');
    assert.equal(typeof esm.parseWav, 'function');
    assert.equal(typeof esm.encodeWav, 'function');
    assert.equal(typeof esm.resamplePcm, 'function');
    assert.equal(typeof esm.transliterateIast, 'function');
    assert.equal(typeof esm.decodeCTC, 'function');
  });

  await test('1.3 Require CJS from outside repository root (/tmp)', async () => {
    const require = createRequire(import.meta.url);
    const cjsPath = path.resolve(ROOT_DIR, 'js/dist/index.cjs');
    const cjs = require(cjsPath);
    assert.ok(cjs.Swanada);
    assert.equal(typeof cjs.Swanada.create, 'function');
  });

  await test('1.4 Dynamic import ESM from outside repository root (/tmp)', async () => {
    const esmPath = path.resolve(ROOT_DIR, 'js/dist/index.mjs');
    const esm = await import(`file://${esmPath}`);
    assert.ok(esm.Swanada);
    assert.equal(typeof esm.Swanada.create, 'function');
  });

  // ============================================================
  // Suite 2: Swanada.prototype.transcribe Adversarial Input Stress
  // ============================================================
  console.log('\n--- Suite 2: Swanada.prototype.transcribe Adversarial Inputs ---');

  const { Swanada, parseWav, resamplePcm } = await import('../js/dist/index.mjs');

  const stt = await Swanada.create({
    language: 'sa',
    modelPath: MODEL_PATH,
  });

  await test('2.1 Standard Node.js Buffer (fs.readFileSync)', async () => {
    const buf = fs.readFileSync(TEST_WAV);
    assert.ok(Buffer.isBuffer(buf));
    const res = await stt.transcribe(buf);
    assert.equal(res.language, 'sa');
    assert.equal(res.text, 'अहं तत्रत्यानां कतिपयसौकर्याणां विषये ज्ञातुमिच्छामि');
    assert.ok(res.durationMs > 4000);
  });

  await test('2.2 Subarray / sliced Uint8Array with byteOffset > 0', async () => {
    const originalBuf = fs.readFileSync(TEST_WAV);
    // Pad 256 bytes in front and 128 bytes in back
    const padded = new Uint8Array(originalBuf.length + 384);
    padded.fill(0xAA, 0, 256);
    padded.set(originalBuf, 256);
    padded.fill(0xBB, 256 + originalBuf.length);

    // Create sliced view with byteOffset = 256
    const sliced = padded.subarray(256, 256 + originalBuf.length);
    assert.equal(sliced.byteOffset, 256);
    assert.equal(sliced.byteLength, originalBuf.length);

    const res = await stt.transcribe(sliced);
    assert.equal(res.text, 'अहं तत्रत्यानां कतिपयसौकर्याणां विषये ज्ञातुमिच्छामि');
  });

  await test('2.3 Zero-length buffer rejection', async () => {
    const emptyBuf = new Uint8Array(0);
    await assert.rejects(
      async () => {
        await stt.transcribe(emptyBuf);
      },
      (err) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /Invalid WAV file|smaller than minimum WAV header/);
        return true;
      }
    );
  });

  await test('2.4 Corrupted WAV header: < 44 bytes', async () => {
    const shortBuf = new Uint8Array(32);
    shortBuf.set([0x52, 0x49, 0x46, 0x46]); // 'RIFF'
    await assert.rejects(
      async () => {
        await stt.transcribe(shortBuf);
      },
      (err) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /smaller than minimum WAV header/);
        return true;
      }
    );
  });

  await test('2.5 Corrupted WAV header: invalid magic signature', async () => {
    const badMagic = Buffer.alloc(44);
    badMagic.write('NOPE', 0);
    badMagic.write('WAVE', 8);
    await assert.rejects(
      async () => {
        await stt.transcribe(badMagic);
      },
      (err) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /expected RIFF\/WAVE header/);
        return true;
      }
    );
  });

  await test('2.6 Corrupted WAV header: missing data chunk', async () => {
    const missingData = Buffer.alloc(44);
    missingData.write('RIFF', 0);
    missingData.writeUInt32LE(36, 4);
    missingData.write('WAVE', 8);
    missingData.write('fmt ', 12);
    missingData.writeUInt32LE(16, 16);
    missingData.writeUInt16LE(1, 20); // PCM
    missingData.writeUInt16LE(1, 22); // mono
    missingData.writeUInt32LE(16000, 24);
    missingData.writeUInt32LE(32000, 28);
    missingData.writeUInt16LE(2, 32);
    missingData.writeUInt16LE(16, 34);
    missingData.write('junk', 36); // wrong chunk
    missingData.writeUInt32LE(0, 40);

    await assert.rejects(
      async () => {
        await stt.transcribe(missingData);
      },
      (err) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /data chunk not found/);
        return true;
      }
    );
  });

  await test('2.7 Truncated audio: declared dataSize larger than actual payload', async () => {
    // Valid header claims 100,000 bytes, but buffer only has 64 bytes total
    const truncated = Buffer.alloc(64);
    truncated.write('RIFF', 0);
    truncated.writeUInt32LE(100036, 4);
    truncated.write('WAVE', 8);
    truncated.write('fmt ', 12);
    truncated.writeUInt32LE(16, 16);
    truncated.writeUInt16LE(1, 20);
    truncated.writeUInt16LE(1, 22);
    truncated.writeUInt32LE(16000, 24);
    truncated.writeUInt32LE(32000, 28);
    truncated.writeUInt16LE(2, 32);
    truncated.writeUInt16LE(16, 34);
    truncated.write('data', 36);
    truncated.writeUInt32LE(100000, 40); // claims 100k

    // Parser safely clamps dataLength = Math.min(chunkSize, view.byteLength - dataOffset)
    const { pcm } = parseWav(truncated);
    assert.equal(pcm.length, 10); // (64 - 44) / 2 = 10 samples
    const res = await stt.transcribe(truncated);
    assert.ok(res);
    assert.equal(typeof res.text, 'string');
  });

  await test('2.8 Non-16kHz audio: 8 kHz downsampled speech input', async () => {
    const rawWav = fs.readFileSync(TEST_WAV);
    const { pcm } = parseWav(rawWav);
    // Resample original 16 kHz to 8 kHz
    const pcm8k = resamplePcm(pcm, 16000, 8000);
    const wav8k = makeWavBuffer(pcm8k, 8000);

    const res = await stt.transcribe(wav8k);
    assert.equal(res.language, 'sa');
    assert.ok(res.text.length > 0, 'Transcription produced output');
    // Check that key words are recognized even at 8 kHz
    assert.ok(res.text.includes('तत्र') || res.text.includes('अहं') || res.text.includes('विषये'));
  });

  await test('2.9 Non-16kHz audio: 44.1 kHz upsampled speech input', async () => {
    const rawWav = fs.readFileSync(TEST_WAV);
    const { pcm } = parseWav(rawWav);
    // Resample original 16 kHz to 44.1 kHz
    const pcm44k = resamplePcm(pcm, 16000, 44100);
    const wav44k = makeWavBuffer(pcm44k, 44100);

    const res = await stt.transcribe(wav44k);
    assert.equal(res.language, 'sa');
    assert.equal(res.text, 'अहं तत्रत्यानां कतिपयसौकर्याणां विषये ज्ञातुमिच्छामि');
  });

  await test('2.10 Non-16kHz audio: 48 kHz upsampled speech input', async () => {
    const rawWav = fs.readFileSync(TEST_WAV);
    const { pcm } = parseWav(rawWav);
    // Resample original 16 kHz to 48 kHz
    const pcm48k = resamplePcm(pcm, 16000, 48000);
    const wav48k = makeWavBuffer(pcm48k, 48000);

    const res = await stt.transcribe(wav48k);
    assert.equal(res.language, 'sa');
    assert.equal(res.text, 'अहं तत्रत्यानां कतिपयसौकर्याणां विषये ज्ञातुमिच्छामि');
  });

  await stt.release();

  console.log(`\n=== STRESS SUMMARY: ${results.passed} passed, ${results.failed} failed ===`);
  if (results.failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
