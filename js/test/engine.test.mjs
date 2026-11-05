import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  AcousticEngine,
  Swanada,
  isValidOnnxBuffer,
  parseWav,
  getOrt,
  configureWasmEnvironment,
} from '../dist/index.mjs';

const TEST_WAV_PATH = '/Users/lika/labs/ninada/data/wavs/sa_rasa_male_01445fb1731b.wav';
const MODEL_PATH = './models/onnx/sushrota_sanskrit_ctc_int8.onnx';

describe('ONNX/WASM Session Engine & High-Level API Suite', () => {
  it('validates ONNX ModelProto binary header (0x08)', () => {
    // Valid ONNX buffer begins with 0x08 (ir_version)
    const validHeader = new Uint8Array(60000);
    validHeader[0] = 0x08;
    assert.equal(isValidOnnxBuffer(validHeader), true);

    // Corrupt buffer
    const badHeader = new Uint8Array(60000);
    badHeader[0] = 0x00;
    assert.equal(isValidOnnxBuffer(badHeader), false);

    // Too small buffer
    const shortBuffer = new Uint8Array(100);
    shortBuffer[0] = 0x08;
    assert.equal(isValidOnnxBuffer(shortBuffer), false);
  });

  it('configures WASM SIMD and multi-threading negotiation', async () => {
    const ort = await getOrt();
    assert.ok(ort, 'onnxruntime resolved');

    const threads = configureWasmEnvironment(ort, 4);
    assert.ok(threads >= 1 && threads <= 8);
    assert.equal(ort.env.wasm.simd, true);
    assert.equal(ort.env.wasm.proxy, false);
  });

  it('initializes AcousticEngine and executes real speech transcription', async () => {
    if (!fs.existsSync(MODEL_PATH) || !fs.existsSync(TEST_WAV_PATH)) {
      return;
    }

    const engine = await AcousticEngine.create({
      language: 'sa',
      modelPath: MODEL_PATH,
    });

    const wavBuf = fs.readFileSync(TEST_WAV_PATH);
    const { pcm } = parseWav(wavBuf);

    const res = await engine.transcribe(pcm);
    assert.equal(res.language, 'sa');
    assert.ok(res.durationMs > 4000);
    assert.ok(res.rtf < 0.50, `RTF ${res.rtf} exceeded 0.50`);
    assert.equal(res.text, 'अहं तत्रत्यानां कतिपयसौकर्याणां विषये ज्ञातुमिच्छामि');
    assert.equal(res.tokens.length, 30);

    await engine.release();
  });

  it('Swanada high-level API supports transcription and streaming', async () => {
    if (!fs.existsSync(MODEL_PATH) || !fs.existsSync(TEST_WAV_PATH)) {
      return;
    }

    const stt = await Swanada.create({
      language: 'sa',
      modelPath: MODEL_PATH,
    });

    // File path transcription
    const res = await stt.transcribe(TEST_WAV_PATH);
    assert.equal(res.text, 'अहं तत्रत्यानां कतिपयसौकर्याणां विषये ज्ञातुमिच्छामि');

    // Streaming transcription
    const stream = stt.createStream();
    const wavBuf = fs.readFileSync(TEST_WAV_PATH);
    const { pcm } = parseWav(wavBuf);

    const chunkSize = 3200; // 200ms chunks
    for (let i = 0; i < pcm.length; i += chunkSize) {
      const chunk = pcm.subarray(i, Math.min(pcm.length, i + chunkSize));
      await stream.push(chunk);
    }

    const streamRes = await stream.finish();
    assert.equal(streamRes.text, 'अहं तत्रत्यानां कतिपयसौकर्याणां विषये ज्ञातुमिच्छामि');

    await stt.release();
  });

  it('supports explicit vocabPath configuration in AcousticEngine', async () => {
    const vocabPath = path.resolve('models/vocabularies/sanskrit_vocab.json');
    if (!fs.existsSync(vocabPath)) return;

    const engine = await AcousticEngine.create({
      language: 'sa',
      vocabPath,
    });
    assert.ok(engine);
    await engine.release();
  });

  it('throws descriptive Error when vocabulary cannot be located', async () => {
    await assert.rejects(
      async () => {
        const engine = await AcousticEngine.create({
          language: 'sa',
          vocabPath: '/non/existent/path/vocab.json',
          modelPath: '/non/existent/model.onnx',
        });
      },
      (err) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /Failed to locate vocabulary for language "sa"/);
        return true;
      }
    );
  });

  it('Swanada high-level API accepts Node.js Buffer / Uint8Array WAV input', async () => {
    if (!fs.existsSync(MODEL_PATH) || !fs.existsSync(TEST_WAV_PATH)) {
      return;
    }

    const stt = await Swanada.create({
      language: 'sa',
      modelPath: MODEL_PATH,
    });

    const buf = fs.readFileSync(TEST_WAV_PATH);
    assert.ok(buf instanceof Uint8Array);

    const res = await stt.transcribe(buf);
    assert.equal(res.text, 'अहं तत्रत्यानां कतिपयसौकर्याणां विषये ज्ञातुमिच्छामि');
    assert.equal(res.language, 'sa');

    await stt.release();
  });

  it('CommonJS bundle index.cjs can be required without syntax or runtime errors', async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const cjsModule = require('../dist/index.cjs');
    assert.ok(cjsModule);
    assert.equal(typeof cjsModule.Swanada, 'function');
    assert.equal(typeof cjsModule.parseWav, 'function');
    assert.equal(typeof cjsModule.resamplePcm, 'function');
    assert.equal(typeof cjsModule.transliterateIast, 'function');
  });
});
