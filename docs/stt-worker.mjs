/**
 * swanada: Dedicated STT Background Web Worker (docs/stt-worker.mjs).
 * Runs a single shared 187 MB INT8 Conformer encoder session in WASM SIMD with
 * hot-swappable 515 KB per-language linear CTC heads across all 12 languages,
 * strict FIFO async message serialization, and epoch-guarded language switching.
 */

let workerReadyToDispatch = false;
const startupMessageQueue = [];
if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
  self.__swanadaWorkerListenerAttached = true;
  self.addEventListener('message', (event) => {
    if (!workerReadyToDispatch) {
      startupMessageQueue.push(event.data);
    } else {
      dispatchIncomingMessage(event.data);
    }
  });
}

let swanadaMod = null;
try {
  const isHttp = typeof location !== 'undefined' && /^https?:/.test(location.protocol || '');
  swanadaMod = await import(isHttp ? './swanada.mjs?v=1.2.2' : './swanada.mjs');
} catch {
  try {
    swanadaMod = await import('../js/dist/index.mjs');
  } catch {
    swanadaMod = globalThis;
  }
}

const extractLogMelFeatures = swanadaMod.extractLogMelFeatures;
const enhanceSpeechWithTelemetry = swanadaMod.enhanceSpeechWithTelemetry;
const decodeCTC = swanadaMod.decodeCTC;
const CTCGreedyDecoder = swanadaMod.CTCGreedyDecoder;
const devanagariToIast = swanadaMod.devanagariToIast || ((t) => t);
const loadModelAsset = swanadaMod.loadModelAsset;
const StreamingAcousticEngine = swanadaMod.StreamingAcousticEngine;
const CACHE_STORAGE_NAME = swanadaMod.CACHE_STORAGE_NAME || 'swanada-onnx-v1.0.0';

let workerState = 'UNINITIALIZED';
let denoiseEnabled = true;
let lastEstimatedSnrDb = 0;
let ort = null;
let currentLanguage = 'sa';
let activeSession = null;
let activeHead = null; // { weight: Float32Array(257*512), bias: Float32Array(257) } | null
let activeVocab = [];
let ctcDecoder = null;
let executionProvider = 'wasm';
let cacheStorageName = CACHE_STORAGE_NAME;

// Shared 187 MB Conformer encoder singleton (compiled ONCE across all 12 languages)
let sharedEncoderSession = null;
let sharedEncoderPromise = null;
let sharedEncoderThreads = 1;

// Per-language head & monolithic fallback caches
const headCache = new Map();
const sessionCache = new Map();
let streamingSession = null;

// Concurrency & race-condition guards
let latestSetupEpoch = 0;
let activeSetupPromise = null;
let inferenceQueue = Promise.resolve();

export function getWorkerState() {
  return workerState;
}

// Protobuf ValueInfoProto for exposing `layer_norm_84` ([batch, time_sub, 512] float32)
const LAYER_NORM_84_VALUE_INFO = new Uint8Array([
  0x0a, 0x0d, 0x6c, 0x61, 0x79, 0x65, 0x72, 0x5f, 0x6e, 0x6f, 0x72, 0x6d, 0x5f, 0x38, 0x34,
  0x12, 0x20, 0x0a, 0x1e, 0x08, 0x01, 0x12, 0x1a, 0x0a, 0x07, 0x12, 0x05, 0x62, 0x61, 0x74,
  0x63, 0x68, 0x0a, 0x0a, 0x12, 0x08, 0x74, 0x69, 0x6d, 0x65, 0x5f, 0x73, 0x75, 0x62, 0x0a,
  0x03, 0x08, 0x80, 0x04,
]);

function readPbVarint(buf, pos) {
  let val = 0;
  let shift = 0;
  while (pos < buf.length) {
    const b = buf[pos++];
    val += (b & 0x7f) * Math.pow(2, shift);
    if ((b & 0x80) === 0) return [val, pos];
    shift += 7;
  }
  throw new Error('Truncated ONNX protobuf varint');
}

function encodePbVarint(n) {
  const out = [];
  let rem = n;
  while (rem >= 128) {
    out.push((rem % 128) | 0x80);
    rem = Math.floor(rem / 128);
  }
  out.push(rem);
  return Uint8Array.from(out);
}

/**
 * Zero-dependency in-memory ONNX Protobuf graph splitter: exposes final encoder
 * LayerNorm tensor `layer_norm_84` ([1, T, 512]) so one shared encoder session
 * drives all 12 language CTC projection heads with 0.00e+00 numerical drift.
 */
function exposeEncoderHiddenOutput(modelBytes) {
  const src = modelBytes instanceof Uint8Array ? modelBytes : new Uint8Array(modelBytes);
  const graphAppend = new Uint8Array(2 + LAYER_NORM_84_VALUE_INFO.length);
  graphAppend[0] = 0x62; // GraphProto.output (field 12, wire type 2)
  graphAppend[1] = LAYER_NORM_84_VALUE_INFO.length;
  graphAppend.set(LAYER_NORM_84_VALUE_INFO, 2);

  let pos = 0;
  while (pos < src.length) {
    const tagStart = pos;
    const [tag, afterTag] = readPbVarint(src, pos);
    const fieldNo = Math.floor(tag / 8);
    const wireType = tag & 7;
    if (wireType === 0) {
      [, pos] = readPbVarint(src, afterTag);
    } else if (wireType === 2) {
      const [len, dataStart] = readPbVarint(src, afterTag);
      const dataEnd = dataStart + len;
      if (fieldNo === 7) {
        const tagBytes = src.subarray(tagStart, afterTag);
        const newLenBytes = encodePbVarint(len + graphAppend.length);
        const out = new Uint8Array(
          tagStart + tagBytes.length + newLenBytes.length + len + graphAppend.length + (src.length - dataEnd)
        );
        let w = 0;
        out.set(src.subarray(0, tagStart), w); w += tagStart;
        out.set(tagBytes, w); w += tagBytes.length;
        out.set(newLenBytes, w); w += newLenBytes.length;
        out.set(src.subarray(dataStart, dataEnd), w); w += len;
        out.set(graphAppend, w); w += graphAppend.length;
        out.set(src.subarray(dataEnd), w);
        return out;
      }
      pos = dataEnd;
    } else if (wireType === 5) {
      pos = afterTag + 4;
    } else if (wireType === 1) {
      pos = afterTag + 8;
    } else {
      return src;
    }
  }
  return src;
}

/**
 * Exact 1x1 CTC head projection: hidden [T, 512] x weight^T [512, 257] + bias [257] -> logits [T, 257].
 */
function projectLinearHead(hidden, timeSteps, weight, bias) {
  const numClasses = 257;
  const dim = 512;
  const out = new Float32Array(timeSteps * numClasses);
  for (let t = 0; t < timeSteps; t++) {
    const hOff = t * dim;
    const oOff = t * numClasses;
    for (let c = 0; c < numClasses; c++) {
      const wOff = c * dim;
      let acc = bias[c];
      for (let d = 0; d < dim; d += 4) {
        acc +=
          hidden[hOff + d] * weight[wOff + d] +
          hidden[hOff + d + 1] * weight[wOff + d + 1] +
          hidden[hOff + d + 2] * weight[wOff + d + 2] +
          hidden[hOff + d + 3] * weight[wOff + d + 3];
      }
      out[oOff + c] = acc;
    }
  }
  return out;
}

async function resolveOrt() {
  if (ort) return ort;
  if (typeof self !== 'undefined' && typeof self.ort !== 'undefined') {
    ort = self.ort;
    return ort;
  }
  if (typeof globalThis !== 'undefined' && typeof globalThis.ort !== 'undefined') {
    ort = globalThis.ort;
    return ort;
  }

  const isNode = typeof process !== 'undefined' && Boolean(process.versions?.node);
  if (!isNode) {
    const baseHref =
      (typeof self !== 'undefined' && self.location?.href) ||
      (typeof window !== 'undefined' && window.location?.href) ||
      (typeof import.meta !== 'undefined' && import.meta.url) ||
      '';
    try {
      const url = new URL('./ort/ort.wasm.bundle.min.mjs', baseHref).href;
      const mod = await import(/* @vite-ignore */ url);
      ort = mod?.default?.InferenceSession ? mod.default : (mod.default || mod);
      return ort;
    } catch {}
    try {
      const url = new URL('./ort/ort.wasm.min.mjs', baseHref).href;
      const mod = await import(/* @vite-ignore */ url);
      ort = mod?.default?.InferenceSession ? mod.default : (mod.default || mod);
      return ort;
    } catch {}
  }

  try {
    const mod = await import('onnxruntime-web');
    ort = mod?.default?.InferenceSession ? mod.default : (mod.default || mod);
    return ort;
  } catch {
    try {
      const mod = await import('onnxruntime-node');
      ort = mod?.default?.InferenceSession ? mod.default : (mod.default || mod);
      return ort;
    } catch (err) {
      throw new Error(`Failed to load onnxruntime-web in worker: ${err.message}`);
    }
  }
}

function configureWasm(ortInstance, numThreads, wasmPaths) {
  if (!ortInstance?.env?.wasm) return 1;
  ortInstance.env.wasm.simd = true;
  ortInstance.env.wasm.proxy = false;

  if (wasmPaths) {
    ortInstance.env.wasm.wasmPaths = wasmPaths;
  } else if (!ortInstance.env.wasm.wasmPaths) {
    try {
      const baseHref =
        (typeof self !== 'undefined' && self.location?.href) ||
        (typeof window !== 'undefined' && window.location?.href) ||
        (typeof import.meta !== 'undefined' && import.meta.url) ||
        '';
      if (baseHref) {
        ortInstance.env.wasm.wasmPaths = new URL('./ort/', baseHref).href;
      }
    } catch {}
  }

  const isIsolated = typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : false;
  const ua = typeof navigator !== 'undefined' ? navigator?.userAgent || '' : '';
  const devMem = typeof navigator !== 'undefined' ? navigator?.deviceMemory || 8 : 8;
  const isMobileRuntime = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || devMem <= 4;
  const maxThreads = isMobileRuntime ? 2 : 4;
  let threads = 1;
  if (numThreads && numThreads >= 1) {
    threads = isIsolated ? Math.min(maxThreads, numThreads) : 1;
  } else if (isIsolated) {
    const cores = typeof navigator !== 'undefined' ? navigator?.hardwareConcurrency || 4 : 4;
    threads = Math.min(maxThreads, Math.max(1, cores - 1));
  }
  ortInstance.env.wasm.numThreads = threads;
  return threads;
}

function resolveRelativeWorkerUrl(urlOrPath) {
  const isNode = typeof process !== 'undefined' && Boolean(process.versions?.node);
  if (!isNode && !urlOrPath.startsWith('http://') && !urlOrPath.startsWith('https://')) {
    try {
      const baseHref =
        (typeof self !== 'undefined' && self.location?.href) ||
        (typeof window !== 'undefined' && window.location?.href) ||
        '';
      if (baseHref) {
        return new URL(urlOrPath, baseHref).href;
      }
    } catch {}
  }
  return urlOrPath;
}

async function loadVocab(vocabUrlOrPath) {
  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(cacheStorageName);
      const matched = await cache.match(vocabUrlOrPath);
      if (matched && matched.ok) {
        const json = await matched.json();
        return Array.isArray(json) ? json : Object.values(json);
      }
    } catch {}
  }

  if (typeof process !== 'undefined' && process.versions?.node) {
    try {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const candidates = [
        vocabUrlOrPath,
        path.resolve(process.cwd(), vocabUrlOrPath),
        path.resolve(process.cwd(), '..', vocabUrlOrPath),
      ];
      for (const cand of candidates) {
        if (fs.existsSync(cand)) {
          const raw = fs.readFileSync(cand, 'utf8');
          const json = JSON.parse(raw);
          return Array.isArray(json) ? json : Object.values(json);
        }
      }
    } catch {}
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error(`Model not found in CacheStorage and client is offline: ${vocabUrlOrPath}`);
  }

  const isNode = typeof process !== 'undefined' && Boolean(process.versions?.node);
  if (!vocabUrlOrPath.startsWith('http://') && !vocabUrlOrPath.startsWith('https://') && isNode) {
    throw new Error(`Vocabulary not found at path: ${vocabUrlOrPath}`);
  }

  const fetchUrl = resolveRelativeWorkerUrl(vocabUrlOrPath);
  const res = await fetch(fetchUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch vocabulary from ${fetchUrl}: HTTP ${res.status}`);
  }

  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(cacheStorageName);
      cache.put(vocabUrlOrPath, res.clone()).catch(() => {});
    } catch {}
  }

  const json = await res.json();
  return Array.isArray(json) ? json : Object.values(json);
}

async function loadLinearHead(lang, headUrlOrPath) {
  if (headCache.has(lang)) {
    return headCache.get(lang);
  }

  let arrayBuf = null;

  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(cacheStorageName);
      const matched = await cache.match(headUrlOrPath);
      if (matched && matched.ok) {
        arrayBuf = await matched.arrayBuffer();
      }
    } catch {}
  }

  if (!arrayBuf && typeof process !== 'undefined' && process.versions?.node) {
    try {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const candidates = [
        headUrlOrPath,
        path.resolve(process.cwd(), headUrlOrPath),
        path.resolve(process.cwd(), 'docs', headUrlOrPath.replace(/^\.\//, '')),
        path.resolve(process.cwd(), '..', 'docs', headUrlOrPath.replace(/^\.\//, '')),
      ];
      for (const cand of candidates) {
        if (fs.existsSync(cand)) {
          const buf = fs.readFileSync(cand);
          arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
          break;
        }
      }
    } catch {}
  }

  if (!arrayBuf) {
    const fetchUrl = resolveRelativeWorkerUrl(headUrlOrPath);
    const res = await fetch(fetchUrl);
    if (!res.ok) {
      throw new Error(`Failed to fetch language head from ${fetchUrl}: HTTP ${res.status}`);
    }
    if (typeof caches !== 'undefined') {
      try {
        const cache = await caches.open(cacheStorageName);
        cache.put(headUrlOrPath, res.clone()).catch(() => {});
      } catch {}
    }
    arrayBuf = await res.arrayBuffer();
  }

  const floats = new Float32Array(arrayBuf);
  const weightCount = 257 * 512;
  if (floats.length < weightCount + 257) {
    throw new Error(`Corrupt CTC head binary for ${lang}: got ${floats.byteLength} bytes`);
  }
  const head = {
    weight: floats.subarray(0, weightCount),
    bias: floats.subarray(weightCount, weightCount + 257),
  };
  headCache.set(lang, head);
  return head;
}

function postWorkerMessage(message, transfer) {
  if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
    if (transfer && transfer.length > 0) {
      self.postMessage(message, transfer);
    } else {
      self.postMessage(message);
    }
  }
}

async function ensureSharedEncoderSession(encoderUrl, userThreads, wasmPaths) {
  if (sharedEncoderSession) {
    return { session: sharedEncoderSession, threads: sharedEncoderThreads, fromCache: true };
  }
  if (sharedEncoderPromise) {
    return sharedEncoderPromise;
  }

  sharedEncoderPromise = (async () => {
    try {
      const ortInstance = await resolveOrt();
      if (typeof self !== 'undefined') self.ort = ortInstance;
      const activeThreads = configureWasm(ortInstance, userThreads, wasmPaths);
      sharedEncoderThreads = activeThreads;

      postWorkerMessage({
        type: 'PROGRESS',
        stage: 'downloading',
        progress: 0.1,
        fromCache: false,
      });

      let wasCacheHit = false;
      const progressHandler = (p) => {
        if (p.fromCache) wasCacheHit = true;
        postWorkerMessage({
          type: 'PROGRESS',
          stage: 'downloading',
          progress: p.pct / 100,
          loadedBytes: p.loadedBytes,
          totalBytes: p.totalBytes,
          fromCache: p.fromCache,
        });
      };

      const isNodeEnv = typeof process !== 'undefined' && Boolean(process.versions?.node);
      let rawBytes;
      try {
        rawBytes = await loadModelAsset(encoderUrl, cacheStorageName, progressHandler);
      } catch (err) {
        const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
        if (!isNodeEnv && !isOffline && !encoderUrl.startsWith('https://huggingface.co/')) {
          const hfFallbackUrl = 'https://huggingface.co/gnumanth/swanada/resolve/main/onnx/sushrota_sanskrit_ctc_int8.onnx';
          rawBytes = await loadModelAsset(hfFallbackUrl, cacheStorageName, progressHandler);
        } else {
          throw err;
        }
      }

      const patchedBytes = exposeEncoderHiddenOutput(rawBytes);

      postWorkerMessage({
        type: 'PROGRESS',
        stage: 'compiling',
        progress: 0.95,
        fromCache: wasCacheHit,
      });

      const sessionOptions = {
        executionProviders: [executionProvider],
        graphOptimizationLevel: 'all',
      };

      let sess;
      try {
        sess = await ortInstance.InferenceSession.create(patchedBytes, sessionOptions);
      } catch (err) {
        if (executionProvider === 'webgpu') {
          executionProvider = 'wasm';
          sessionOptions.executionProviders = ['wasm'];
          sess = await ortInstance.InferenceSession.create(patchedBytes, sessionOptions);
        } else {
          throw err;
        }
      }

      postWorkerMessage({
        type: 'PROGRESS',
        stage: 'warmup',
        progress: 0.99,
        fromCache: wasCacheHit,
      });

      const warmupPcm = new Float32Array(1600);
      const warmupMel = extractLogMelFeatures(warmupPcm);
      let warmFeats = null;
      let warmLen = null;
      let warmOut = null;
      try {
        warmFeats = new ortInstance.Tensor('float32', warmupMel.features, [1, 80, warmupMel.numFrames]);
        warmLen = new ortInstance.Tensor('int64', BigInt64Array.from([BigInt(warmupMel.numFrames)]), [1]);
        warmOut = await sess.run({ audio_signal: warmFeats, length: warmLen });
      } finally {
        warmFeats?.dispose?.();
        warmLen?.dispose?.();
        if (warmOut) {
          for (const t of Object.values(warmOut)) t?.dispose?.();
        }
      }

      sharedEncoderSession = sess;
      return { session: sess, threads: activeThreads, fromCache: wasCacheHit };
    } catch (err) {
      sharedEncoderPromise = null;
      throw err;
    }
  })();

  return sharedEncoderPromise;
}

function buildStreamingEngineForActiveLanguage(lang, vocab) {
  const engineAdapter = {
    config: { language: lang },
    getVocab: () => vocab,
    transcribe: async (pcm) => runAcousticInference(pcm),
  };
  return new StreamingAcousticEngine(engineAdapter, vocab, {
    leftContextSamples: 30720,
    maxBufferSamples: 61440,
    vadSilenceThreshold: 0.005,
  });
}

async function setupLanguage(lang, modelUrl, vocabUrl, userThreads, wasmPaths, headUrl) {
  const myEpoch = ++latestSetupEpoch;
  workerState = 'INITIALIZING';

  const effectiveVocabUrl = vocabUrl || `./models/vocabularies/${lang === 'sa' ? 'sanskrit_vocab.json' : `${lang}_vocab.json`}`;

  // Fast path: Shared Encoder + 515 KB per-language linear CTC head (all 12 languages in Studio)
  if (headUrl) {
    const effectiveEncoderUrl = modelUrl || './models/onnx/sushrota_sanskrit_ctc_int8.onnx';
    const [encInfo, vocab, head] = await Promise.all([
      ensureSharedEncoderSession(effectiveEncoderUrl, userThreads, wasmPaths),
      loadVocab(effectiveVocabUrl),
      loadLinearHead(lang, headUrl),
    ]);

    // Abort cleanly if user clicked another language tab while loading
    if (myEpoch !== latestSetupEpoch) {
      return;
    }

    currentLanguage = lang;
    activeSession = encInfo.session;
    activeHead = head;
    activeVocab = vocab;
    ctcDecoder = new CTCGreedyDecoder(activeVocab);
    streamingSession = buildStreamingEngineForActiveLanguage(lang, activeVocab);
    workerState = 'READY';

    postWorkerMessage({
      type: 'READY',
      language: lang,
      executionProvider,
      numThreads: encInfo.threads,
      fromCache: encInfo.fromCache,
    });
    return;
  }

  // Fallback path: Monolithic per-language ONNX model (used by standalone SDK / custom modelUrl tests)
  if (sessionCache.has(lang)) {
    if (myEpoch !== latestSetupEpoch) return;
    const cached = sessionCache.get(lang);
    currentLanguage = lang;
    activeSession = cached.session;
    activeHead = null;
    activeVocab = cached.vocab;
    ctcDecoder = new CTCGreedyDecoder(activeVocab);
    streamingSession = buildStreamingEngineForActiveLanguage(lang, activeVocab);
    workerState = 'READY';
    postWorkerMessage({
      type: 'READY',
      language: lang,
      executionProvider,
      numThreads: ort?.env?.wasm?.numThreads || 1,
      fromCache: true,
    });
    return;
  }

  const ortInstance = await resolveOrt();
  if (typeof self !== 'undefined') self.ort = ortInstance;
  const activeThreads = configureWasm(ortInstance, userThreads, wasmPaths);

  const effectiveModelUrl = modelUrl || `./models/onnx/${lang === 'sa' ? 'sushrota_sanskrit_ctc_int8.onnx' : `swanada_${lang}_ctc_int8.onnx`}`;
  const vocab = await loadVocab(effectiveVocabUrl);

  postWorkerMessage({
    type: 'PROGRESS',
    stage: 'downloading',
    progress: 0.1,
    fromCache: false,
  });

  const progressHandler = (p) => {
    if (myEpoch !== latestSetupEpoch) return;
    postWorkerMessage({
      type: 'PROGRESS',
      stage: 'downloading',
      progress: p.pct / 100,
      loadedBytes: p.loadedBytes,
      totalBytes: p.totalBytes,
      fromCache: p.fromCache,
    });
  };

  const isNodeEnv = typeof process !== 'undefined' && Boolean(process.versions?.node);
  let modelBytes;
  try {
    modelBytes = await loadModelAsset(effectiveModelUrl, cacheStorageName, progressHandler);
  } catch (err) {
    const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (!isNodeEnv && !isOffline && !effectiveModelUrl.startsWith('https://huggingface.co/')) {
      const hfFile = lang === 'sa' ? 'sushrota_sanskrit_ctc_int8.onnx' : `swanada_${lang}_ctc_int8.onnx`;
      const hfFallbackUrl = `https://huggingface.co/gnumanth/swanada/resolve/main/onnx/${hfFile}`;
      modelBytes = await loadModelAsset(hfFallbackUrl, cacheStorageName, progressHandler);
    } else {
      throw err;
    }
  }

  if (myEpoch !== latestSetupEpoch) return;

  const ua = typeof navigator !== 'undefined' ? navigator?.userAgent || '' : '';
  const devMem = typeof navigator !== 'undefined' ? navigator?.deviceMemory || 8 : 8;
  const maxCachedSessions = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || devMem <= 4 ? 1 : 2;
  while (sessionCache.size >= maxCachedSessions) {
    const oldestKey = sessionCache.keys().next().value;
    if (oldestKey === undefined) break;
    const oldEntry = sessionCache.get(oldestKey);
    sessionCache.delete(oldestKey);
    try {
      await oldEntry?.session?.release?.();
    } catch {}
  }

  postWorkerMessage({
    type: 'PROGRESS',
    stage: 'compiling',
    progress: 0.95,
    fromCache: false,
  });

  const sessionOptions = {
    executionProviders: [executionProvider],
    graphOptimizationLevel: 'all',
  };

  let sess;
  try {
    sess = await ortInstance.InferenceSession.create(modelBytes, sessionOptions);
  } catch (err) {
    if (executionProvider === 'webgpu') {
      executionProvider = 'wasm';
      sessionOptions.executionProviders = ['wasm'];
      sess = await ortInstance.InferenceSession.create(modelBytes, sessionOptions);
    } else {
      throw err;
    }
  }

  if (myEpoch !== latestSetupEpoch) {
    try { await sess?.release?.(); } catch {}
    return;
  }

  const warmupPcm = new Float32Array(1600);
  const warmupMel = extractLogMelFeatures(warmupPcm);
  let warmFeats = null;
  let warmLen = null;
  let warmOut = null;
  try {
    warmFeats = new ortInstance.Tensor('float32', warmupMel.features, [1, 80, warmupMel.numFrames]);
    warmLen = new ortInstance.Tensor('int64', BigInt64Array.from([BigInt(warmupMel.numFrames)]), [1]);
    warmOut = await sess.run({ audio_signal: warmFeats, length: warmLen });
  } finally {
    warmFeats?.dispose?.();
    warmLen?.dispose?.();
    if (warmOut) {
      for (const t of Object.values(warmOut)) t?.dispose?.();
    }
  }

  if (myEpoch !== latestSetupEpoch) {
    try { await sess?.release?.(); } catch {}
    return;
  }

  sessionCache.set(lang, { session: sess, vocab });
  currentLanguage = lang;
  activeSession = sess;
  activeHead = null;
  activeVocab = vocab;
  ctcDecoder = new CTCGreedyDecoder(activeVocab);
  streamingSession = buildStreamingEngineForActiveLanguage(lang, activeVocab);
  workerState = 'READY';

  postWorkerMessage({
    type: 'READY',
    language: lang,
    executionProvider,
    numThreads: activeThreads,
    fromCache: false,
  });
}

/**
 * Runs feature extraction, acoustic inference, and CTC decoding on audio.
 */
async function runAcousticInference(pcm) {
  if (!activeSession) {
    throw new Error('Inference session is not ready.');
  }

  const startMs = performance.now();
  const durationMs = (pcm.length / 16000) * 1000;

  // Silence gate: RMS < 1e-4 (-80 dBFS) bypasses model
  let sumSq = 0;
  for (let i = 0; i < pcm.length; i++) sumSq += pcm[i] * pcm[i];
  const rms = pcm.length > 0 ? Math.sqrt(sumSq / pcm.length) : 0;

  if (rms < 1e-4) {
    const elapsed = performance.now() - startMs;
    const rtf = durationMs > 0 ? elapsed / durationMs : 0;
    return {
      text: '',
      iast: currentLanguage === 'sa' ? '' : undefined,
      language: currentLanguage,
      durationMs,
      inferenceMs: elapsed,
      rtf,
      tokens: [],
    };
  }

  // 0. Multi-Stage Background Noise Cancellation & Speech Enhancement Layer
  let cleanPcm = pcm;
  if (denoiseEnabled && typeof enhanceSpeechWithTelemetry === 'function') {
    const enhanced = enhanceSpeechWithTelemetry(pcm);
    lastEstimatedSnrDb = enhanced.estimatedSnrDb;
    if (!enhanced.isSpeechLikely) {
      const elapsed = performance.now() - startMs;
      const rtf = durationMs > 0 ? elapsed / durationMs : 0;
      return {
        text: '',
        iast: currentLanguage === 'sa' ? '' : undefined,
        language: currentLanguage,
        durationMs,
        inferenceMs: elapsed,
        rtf,
        tokens: [],
        snrDb: lastEstimatedSnrDb,
      };
    }
    cleanPcm = enhanced.pcm;
  }

  // 1. Analytical Log-Mel Spectrogram Extraction
  const mel = extractLogMelFeatures(cleanPcm);

  // 2. Acoustic Model Inference
  let featsTensor = null;
  let lenTensor = null;
  let outputs = null;

  let logits;
  let timeSteps;
  let numClasses;

  try {
    featsTensor = new ort.Tensor('float32', mel.features, [1, 80, mel.numFrames]);
    lenTensor = new ort.Tensor('int64', BigInt64Array.from([BigInt(mel.numFrames)]), [1]);

    outputs = await activeSession.run({
      audio_signal: featsTensor,
      length: lenTensor,
    });

    if (activeHead && outputs.layer_norm_84) {
      const hiddenTensor = outputs.layer_norm_84;
      const hDims = hiddenTensor.dims;
      timeSteps = hDims.length === 3 ? hDims[1] : hDims[0];
      numClasses = 257;
      logits = projectLinearHead(hiddenTensor.data, timeSteps, activeHead.weight, activeHead.bias);
    } else {
      const logitsTensor = outputs.logits || Object.values(outputs)[0];
      const dims = logitsTensor.dims;
      timeSteps = dims.length === 3 ? dims[1] : dims[0];
      numClasses = dims.length === 3 ? dims[2] : dims[1];
      logits = new Float32Array(logitsTensor.data);
    }
  } finally {
    featsTensor?.dispose?.();
    lenTensor?.dispose?.();
    if (outputs) {
      for (const t of Object.values(outputs)) t?.dispose?.();
    }
  }

  // 3. CTC Decoding
  const decoded = decodeCTC(logits, [timeSteps, numClasses], activeVocab);
  const elapsedMs = performance.now() - startMs;
  const rtf = durationMs > 0 ? elapsedMs / durationMs : 0;
  const iastText = currentLanguage === 'sa' ? devanagariToIast(decoded.text) : undefined;

  return {
    text: decoded.text,
    iast: iastText,
    language: currentLanguage,
    durationMs,
    inferenceMs: elapsedMs,
    rtf,
    tokens: decoded.tokens,
  };
}

/**
 * Core message handler (preserved export signature for direct unit testing).
 */
export async function handleIncomingMessage(msg) {
  if (!msg || !msg.type) return;

  try {
    switch (msg.type) {
      case 'INIT': {
        const config = msg.config || {};
        const lang = msg.language || config.language || 'sa';
        executionProvider = msg.executionProvider || config.executionProvider || 'wasm';
        if (msg.cacheName || config.cacheName) {
          cacheStorageName = msg.cacheName || config.cacheName || CACHE_STORAGE_NAME;
        }
        const p = setupLanguage(
          lang,
          msg.modelUrl || config.modelUrl,
          msg.vocabUrl || config.vocabUrl,
          msg.numThreads || config.numThreads,
          msg.wasmPaths || config.wasmPaths,
          msg.headUrl || config.headUrl
        );
        activeSetupPromise = p;
        await p;
        break;
      }

      case 'SET_LANGUAGE': {
        const p = setupLanguage(msg.language, msg.modelUrl, msg.vocabUrl, undefined, undefined, msg.headUrl);
        activeSetupPromise = p;
        await p;
        break;
      }

      case 'SET_DENOISE': {
        denoiseEnabled = Boolean(msg.enabled);
        break;
      }

      case 'AUDIO_CHUNK':
      case 'PROCESS_CHUNK': {
        if (activeSetupPromise) {
          try { await activeSetupPromise; } catch {}
        }
        if (workerState !== 'READY' && workerState !== 'STREAMING') {
          postWorkerMessage({
            type: 'ERROR',
            message: 'Worker is not ready for audio chunks.',
            fatal: false,
          });
          return;
        }

        if (!streamingSession) {
          postWorkerMessage({
            type: 'ERROR',
            message: 'Streaming session is not initialized.',
            fatal: false,
          });
          return;
        }

        const rawAudio = msg.audio || msg.chunk;
        const chunk = rawAudio
          ? (rawAudio instanceof Float32Array ? rawAudio : new Float32Array(rawAudio))
          : new Float32Array(0);

        workerState = 'STREAMING';

        if (msg.isFinal) {
          if (chunk.length > 0) {
            await streamingSession.push(chunk);
          }
          const finalRes = await streamingSession.finish();
          workerState = 'READY';
          postWorkerMessage({
            type: 'FINAL',
            text: finalRes.text,
            committed: finalRes.text,
            volatile: '',
            iast: currentLanguage === 'sa' ? (finalRes.iast ?? devanagariToIast(finalRes.text)) : undefined,
            language: currentLanguage,
            durationMs: finalRes.durationMs,
            inferenceMs: finalRes.inferenceMs,
            rtf: finalRes.rtf,
            snrDb: lastEstimatedSnrDb,
            tokens: finalRes.tokens,
          });
          streamingSession.reset();
        } else {
          const partial = await streamingSession.push(chunk);
          if (partial) {
            postWorkerMessage({
              type: 'PARTIAL',
              text: partial.text,
              committed: partial.committed,
              volatile: partial.volatile,
              iast: currentLanguage === 'sa' ? devanagariToIast(partial.text) : undefined,
              language: currentLanguage,
              rtf: partial.rtf,
              snrDb: lastEstimatedSnrDb,
              durationMs: partial.durationMs,
              inferenceMs: partial.inferenceMs,
              tokens: partial.tokens,
              chunkIndex: msg.chunkIndex,
            });
          }
        }
        break;
      }

      case 'FINISH': {
        if (activeSetupPromise) {
          try { await activeSetupPromise; } catch {}
        }
        if (workerState !== 'READY' && workerState !== 'STREAMING') {
          postWorkerMessage({
            type: 'ERROR',
            message: 'Worker is not ready.',
            fatal: false,
          });
          return;
        }

        if (!streamingSession) {
          return;
        }

        const finalRes = await streamingSession.finish();
        workerState = 'READY';
        postWorkerMessage({
          type: 'FINAL',
          text: finalRes.text,
          committed: finalRes.text,
          volatile: '',
          iast: currentLanguage === 'sa' ? (finalRes.iast ?? devanagariToIast(finalRes.text)) : undefined,
          language: currentLanguage,
          durationMs: finalRes.durationMs,
          inferenceMs: finalRes.inferenceMs,
          rtf: finalRes.rtf,
          snrDb: lastEstimatedSnrDb,
          tokens: finalRes.tokens,
        });
        streamingSession.reset();
        break;
      }

      case 'RESET': {
        streamingSession?.reset();
        if (activeSession) {
          workerState = 'READY';
        }
        break;
      }

      default: {
        postWorkerMessage({
          type: 'ERROR',
          message: `Unknown message type: ${msg.type}`,
          fatal: false,
        });
      }
    }
  } catch (err) {
    const isFatal = workerState === 'UNINITIALIZED' || workerState === 'INITIALIZING';
    if (isFatal) {
      workerState = 'ERROR';
    }
    postWorkerMessage({
      type: 'ERROR',
      message: err.message || String(err),
      fatal: isFatal,
    });
  }
}

function toFloat32Chunk(rawAudio) {
  if (!rawAudio) return new Float32Array(0);
  return rawAudio instanceof Float32Array ? rawAudio : new Float32Array(rawAudio);
}

const pendingWorkQueue = [];
let isDrainingWorkQueue = false;

async function drainWorkQueue() {
  if (isDrainingWorkQueue) return;
  isDrainingWorkQueue = true;
  try {
    // Yield a macrotask turn so all queued postMessage IPC events land in pendingWorkQueue first
    await new Promise((r) => setTimeout(r, 0));
    while (pendingWorkQueue.length > 0) {
      const next = pendingWorkQueue.shift();
      if (!next) continue;
      if (
        (next.type === 'AUDIO_CHUNK' || next.type === 'PROCESS_CHUNK') &&
        !next.isFinal &&
        pendingWorkQueue.length > 0
      ) {
        // Coalesce queued non-final PCM chunks that arrived while WASM inference was busy
        const chunks = [toFloat32Chunk(next.audio || next.chunk)];
        let lastChunkIndex = next.chunkIndex;
        while (
          pendingWorkQueue.length > 0 &&
          (pendingWorkQueue[0].type === 'AUDIO_CHUNK' || pendingWorkQueue[0].type === 'PROCESS_CHUNK') &&
          !pendingWorkQueue[0].isFinal
        ) {
          const m = pendingWorkQueue.shift();
          chunks.push(toFloat32Chunk(m.audio || m.chunk));
          if (m.chunkIndex !== undefined) lastChunkIndex = m.chunkIndex;
        }
        if (chunks.length > 1) {
          let totalLen = 0;
          for (const c of chunks) totalLen += c.length;
          const merged = new Float32Array(totalLen);
          let offset = 0;
          for (const c of chunks) {
            merged.set(c, offset);
            offset += c.length;
          }
          await handleIncomingMessage({
            ...next,
            audio: merged,
            chunk: undefined,
            chunkIndex: lastChunkIndex,
          });
          await new Promise((r) => setTimeout(r, 0));
          continue;
        }
      }
      await handleIncomingMessage(next);
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    isDrainingWorkQueue = false;
  }
}

/**
 * Dispatches browser postMessage events:
 * - INIT / SET_LANGUAGE / SET_DENOISE run immediately so language clicks preempt stale loads.
 * - AUDIO_CHUNK / PROCESS_CHUNK / FINISH / RESET run strictly FIFO with lossless backpressure coalescing.
 */
function dispatchIncomingMessage(msg) {
  if (!msg || !msg.type) return;
  if (msg.type === 'INIT' || msg.type === 'SET_LANGUAGE') {
    pendingWorkQueue.length = 0;
    handleIncomingMessage(msg);
  } else if (msg.type === 'SET_DENOISE') {
    handleIncomingMessage(msg);
  } else {
    if (msg.type === 'RESET') {
      pendingWorkQueue.length = 0;
    }
    pendingWorkQueue.push(msg);
    drainWorkQueue().catch(() => {});
  }
}

workerReadyToDispatch = true;
for (const m of startupMessageQueue.splice(0)) {
  dispatchIncomingMessage(m);
}
