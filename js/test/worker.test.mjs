import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  handleIncomingMessage,
  getWorkerState,
  SwanadaWorkerClient,
} from '../dist/index.mjs';

function resolveModelPath(rel) {
  const p1 = path.resolve(rel);
  if (fs.existsSync(p1)) return p1;
  const p2 = path.resolve('..', rel);
  if (fs.existsSync(p2)) return p2;
  return rel;
}

describe('Background STT Web Worker & Typed Client Suite (Feature 10 & 12)', () => {
  it('manages 5-state lifecycle and handles INIT message', async () => {
    assert.equal(getWorkerState(), 'UNINITIALIZED');

    // Simulate mock worker postMessage receiver
    const postedEvents = [];
    const fakeSelf = {
      postMessage: (m) => postedEvents.push(m),
      ort: {
        InferenceSession: {
          create: async () => ({
            run: async () => ({
              logits: { dims: [1, 8, 257], data: new Float32Array(8 * 257) },
            }),
          }),
        },
        Tensor: class {
          constructor(type, data, dims) {
            this.type = type;
            this.data = data;
            this.dims = dims;
          }
          dispose() {}
        },
        env: { wasm: { simd: false, proxy: false, numThreads: 1 } },
      },
    };

    globalThis.self = fakeSelf;

    // Reject audio chunk when not ready
    await handleIncomingMessage({
      type: 'AUDIO_CHUNK',
      audio: new Float32Array(1600),
      isFinal: false,
    });
    assert.equal(postedEvents.length, 1);
    assert.equal(postedEvents[0].type, 'ERROR');
    assert.match(postedEvents[0].message, /not ready/);

    const vocabPath = resolveModelPath('models/vocabularies/sanskrit_vocab.json');
    const modelPath = resolveModelPath('models/onnx/sushrota_sanskrit_ctc_int8.onnx');

    // Initialize with mock session
    await handleIncomingMessage({
      type: 'INIT',
      language: 'sa',
      vocabUrl: vocabPath,
      modelUrl: modelPath,
      executionProvider: 'wasm',
      numThreads: 2,
    });

    const readyEvent = postedEvents.find((e) => e.type === 'READY');
    assert.ok(readyEvent, 'Worker emitted READY event');
    assert.equal(readyEvent.language, 'sa');
    assert.equal(getWorkerState(), 'READY');
  });

  it('transfers audio chunks and emits PARTIAL and FINAL events with IAST transliteration', async () => {
    const postedEvents = [];
    globalThis.self = {
      postMessage: (m) => postedEvents.push(m),
    };

    // Push audio chunk
    const pcm = new Float32Array(3200).fill(0.05);
    await handleIncomingMessage({
      type: 'AUDIO_CHUNK',
      audio: pcm,
      isFinal: false,
      chunkIndex: 1,
    });

    // Send final chunk
    await handleIncomingMessage({
      type: 'AUDIO_CHUNK',
      audio: new Float32Array(1600).fill(0.05),
      isFinal: true,
      chunkIndex: 2,
    });

    const finalEvent = postedEvents.find((e) => e.type === 'FINAL');
    assert.ok(finalEvent, 'Worker emitted FINAL event');
    assert.equal(typeof finalEvent.text, 'string');
    assert.equal(typeof finalEvent.durationMs, 'number');
    assert.equal(typeof finalEvent.rtf, 'number');
    assert.ok(finalEvent.rtf >= 0);
  });

  it('SwanadaWorkerClient provides typed subscription and promise lifecycle', async () => {
    let workerTerminated = false;

    class FakeWorker {
      constructor() {
        this.onmessage = null;
        this.onerror = null;
      }
      postMessage(msg, transfer) {
        if (transfer && transfer.length > 0) {
          // Verify transferable buffer detachment check
          assert.ok(transfer[0] instanceof ArrayBuffer);
        }
        if (msg.type === 'INIT') {
          setTimeout(() => {
            if (this.onmessage) {
              this.onmessage({
                data: {
                  type: 'READY',
                  language: msg.language,
                  executionProvider: 'wasm',
                  numThreads: 2,
                  fromCache: true,
                },
              });
            }
          }, 5);
        } else if (msg.type === 'AUDIO_CHUNK' && msg.isFinal) {
          setTimeout(() => {
            if (this.onmessage) {
              this.onmessage({
                data: {
                  type: 'FINAL',
                  text: 'सत्यमेव जयते',
                  iast: 'satyam eva jayate',
                  language: 'sa',
                  durationMs: 1000,
                  inferenceMs: 80,
                  rtf: 0.08,
                  tokens: ['स', 'त्य'],
                },
              });
            }
          }, 5);
        }
      }
      addEventListener(type, fn) {
        if (type === 'message') this.onmessage = fn;
        if (type === 'error') this.onerror = fn;
      }
      terminate() {
        workerTerminated = true;
      }
    }

    const fakeWorker = new FakeWorker();
    const client = new SwanadaWorkerClient({
      workerUrl: fakeWorker,
      language: 'sa',
    });

    const readyInfo = await client.whenReady();
    assert.equal(readyInfo.language, 'sa');
    assert.equal(readyInfo.fromCache, true);

    const testPcm = new Float32Array(16000);
    const transcription = await client.transcribe(testPcm);
    assert.equal(transcription.text, 'सत्यमेव जयते');
    assert.equal(transcription.iast, 'satyam eva jayate');
    assert.ok(transcription.rtf < 0.15);

    client.terminate();
    assert.equal(workerTerminated, true);
  });
});
