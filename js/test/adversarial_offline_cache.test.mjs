import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  handleIncomingMessage,
  getWorkerState,
  loadModelAsset,
  isValidOnnxBuffer,
  CACHE_STORAGE_NAME,
} from '../dist/index.mjs';

function resolvePath(rel) {
  const p1 = path.resolve(rel);
  if (fs.existsSync(p1)) return p1;
  const p2 = path.resolve('..', rel);
  if (fs.existsSync(p2)) return p2;
  return rel;
}

describe('Adversarial Offline Zero-Network & Dual-Tier Cache Persistence (Feature 10 & 12)', () => {
  it('validates ONNX ModelProto protobuf magic header (0x08) and size bounds', () => {
    // Valid protobuf: byte 0 is 0x08, length >= 50,000
    const validBuf = new Uint8Array(60000);
    validBuf[0] = 0x08;
    assert.equal(isValidOnnxBuffer(validBuf), true);

    // Invalid protobuf: bad magic header
    const badHeader = new Uint8Array(60000);
    badHeader[0] = 0x00;
    assert.equal(isValidOnnxBuffer(badHeader), false);

    // Invalid protobuf: truncated / undersized (< 50,000 bytes)
    const truncated = new Uint8Array(100);
    truncated[0] = 0x08;
    assert.equal(isValidOnnxBuffer(truncated), false);
  });

  it('loadModelAsset retrieves from CacheStorage with strictly 0 network calls', async () => {
    const fakeStore = new Map();
    const testUrl = 'https://swanada.internal/models/test_model.onnx';

    // Create valid 60KB mock ONNX model buffer
    const mockModelBytes = new Uint8Array(65536);
    mockModelBytes[0] = 0x08;

    // Mock CacheStorage API
    const mockCache = {
      match: async (url) => {
        if (fakeStore.has(url)) {
          const data = fakeStore.get(url);
          return {
            ok: true,
            arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
          };
        }
        return null;
      },
      put: async (url, response) => {
        const buf = await response.arrayBuffer();
        fakeStore.set(url, new Uint8Array(buf));
      },
    };

    globalThis.caches = {
      open: async (name) => {
        assert.equal(name, CACHE_STORAGE_NAME);
        return mockCache;
      },
    };

    // Prime CacheStorage
    fakeStore.set(testUrl, mockModelBytes);

    // Guard: fetch must NEVER be invoked
    let networkCalls = 0;
    globalThis.fetch = () => {
      networkCalls++;
      throw new Error('NETWORK_VIOLATION: fetch() invoked when model exists in CacheStorage');
    };

    const progressReports = [];
    const loaded = await loadModelAsset(testUrl, CACHE_STORAGE_NAME, (p) => {
      progressReports.push(p);
    });

    assert.equal(networkCalls, 0, 'Zero network calls must be made on CacheStorage hit');
    assert.equal(loaded.byteLength, mockModelBytes.byteLength);
    assert.equal(loaded[0], 0x08);

    // Verify progress reported cache retrieval
    const cacheProgress = progressReports.find((p) => p.phase === 'cache');
    assert.ok(cacheProgress, 'Expected progress report for cache phase');
    assert.equal(cacheProgress.fromCache, true);
  });

  it('loadModelAsset falls back to IndexedDB and populates CacheStorage with 0 network calls', async () => {
    const idbStore = new Map();
    const cacheStore = new Map();
    const testUrl = 'https://swanada.internal/models/idb_model.onnx';

    const mockBytes = new Uint8Array(70000);
    mockBytes[0] = 0x08;
    idbStore.set(testUrl, mockBytes);

    // Mock empty CacheStorage
    globalThis.caches = {
      open: async () => ({
        match: async (url) => {
          if (cacheStore.has(url)) {
            const data = cacheStore.get(url);
            return {
              ok: true,
              arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
            };
          }
          return null;
        },
        put: async (url, response) => {
          const buf = await response.arrayBuffer();
          cacheStore.set(url, new Uint8Array(buf));
        },
      }),
    };

    // Mock IndexedDB
    globalThis.indexedDB = {
      open: () => {
        const req = {
          result: {
            transaction: () => ({
              objectStore: () => ({
                get: (url) => {
                  const getReq = { result: idbStore.get(url) };
                  setTimeout(() => getReq.onsuccess?.(), 1);
                  return getReq;
                },
                put: (val, url) => {
                  idbStore.set(url, val);
                },
              }),
            }),
          },
        };
        setTimeout(() => req.onsuccess?.(), 1);
        return req;
      },
    };

    let networkCalls = 0;
    globalThis.fetch = () => {
      networkCalls++;
      throw new Error('NETWORK_VIOLATION: fetch() invoked on IndexedDB hit');
    };

    const loaded = await loadModelAsset(testUrl);
    assert.equal(networkCalls, 0);
    assert.equal(loaded.byteLength, mockBytes.byteLength);

    // Verify CacheStorage was backfilled from IndexedDB
    assert.ok(cacheStore.has(testUrl), 'IndexedDB hit should populate CacheStorage for subsequent visits');
  });

  it('loadModelAsset fails cleanly with offline error when caches are empty and client is offline', async () => {
    globalThis.caches = {
      open: async () => ({
        match: async () => null,
      }),
    };
    globalThis.indexedDB = {
      open: () => {
        const req = {
          result: {
            transaction: () => ({
              objectStore: () => ({
                get: () => {
                  const getReq = { result: null };
                  setTimeout(() => getReq.onsuccess?.(), 1);
                  return getReq;
                },
              }),
            }),
          },
        };
        setTimeout(() => req.onsuccess?.(), 1);
        return req;
      },
    };

    const originalOnLine = globalThis.navigator?.onLine;
    Object.defineProperty(globalThis.navigator, 'onLine', {
      value: false,
      configurable: true,
      writable: true,
    });

    let networkAttempts = 0;
    globalThis.fetch = () => {
      networkAttempts++;
      throw new Error('NETWORK_VIOLATION: fetch() invoked while navigator.onLine is false');
    };

    try {
      await assert.rejects(
        async () => {
          await loadModelAsset('https://swanada.internal/missing.onnx');
        },
        {
          message: /offline/i,
        }
      );
    } finally {
      if (typeof originalOnLine !== 'undefined') {
        Object.defineProperty(globalThis.navigator, 'onLine', {
          value: originalOnLine,
          configurable: true,
          writable: true,
        });
      }
    }

    assert.equal(networkAttempts, 0, 'Zero network requests allowed when offline');
  });

  it('guarantees strictly 0 network requests during active Web Worker audio chunk streaming', async () => {
    const postedEvents = [];
    globalThis.self = {
      postMessage: (m) => postedEvents.push(m),
      ort: {
        InferenceSession: {
          create: async () => ({
            run: async () => ({
              logits: { dims: [1, 16, 257], data: new Float32Array(16 * 257) },
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
        env: { wasm: { simd: true, proxy: false, numThreads: 2 } },
      },
    };

    const vocabPath = resolvePath('models/vocabularies/sanskrit_vocab.json');
    const modelPath = resolvePath('models/onnx/sushrota_sanskrit_ctc_int8.onnx');

    // Initialize worker
    await handleIncomingMessage({
      type: 'INIT',
      language: 'sa',
      vocabUrl: vocabPath,
      modelUrl: modelPath,
      executionProvider: 'wasm',
    });

    assert.equal(getWorkerState(), 'READY');

    // Strict network firewall during active transcription
    let illegalNetworkCalls = 0;
    globalThis.fetch = () => {
      illegalNetworkCalls++;
      throw new Error('CRITICAL_VIOLATION: Network fetch attempted during active audio streaming!');
    };

    // Feed 30 streaming audio chunks into the worker
    const chunkPcm = new Float32Array(3200).fill(0.02); // 200ms of non-silent audio
    for (let i = 1; i <= 30; i++) {
      await handleIncomingMessage({
        type: 'AUDIO_CHUNK',
        audio: chunkPcm,
        isFinal: false,
        chunkIndex: i,
      });
    }

    // Finish audio stream
    await handleIncomingMessage({
      type: 'FINISH',
    });

    assert.equal(illegalNetworkCalls, 0, 'Strictly 0 network requests during active streaming');

    const finalEvent = postedEvents.find((e) => e.type === 'FINAL');
    assert.ok(finalEvent, 'Emitted FINAL event');
    assert.equal(finalEvent.language, 'sa');
    assert.equal(typeof finalEvent.iast, 'string', 'Classical Sanskrit includes IAST transliteration');
    assert.equal(getWorkerState(), 'READY');
  });
});
