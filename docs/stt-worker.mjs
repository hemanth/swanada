/**
 * swanada: Dedicated STT Background Web Worker (docs/stt-worker.mjs).
 * Runs ONNX Runtime Web WASM SIMD completely off the main thread.
 * Guarantees 60 FPS UI rendering, zero audio capture glitching,
 * and 0 external network requests during active transcription.
 */

let swanadaMod = null;
try {
  swanadaMod = await import('./swanada.mjs');
} catch {
  try {
    swanadaMod = await import('../js/dist/index.mjs');
  } catch {
    swanadaMod = globalThis;
  }
}

const extractLogMelFeatures = swanadaMod.extractLogMelFeatures;
const decodeCTC = swanadaMod.decodeCTC;
const CTCGreedyDecoder = swanadaMod.CTCGreedyDecoder;
const devanagariToIast = swanadaMod.devanagariToIast || ((t) => t);
const loadModelAsset = swanadaMod.loadModelAsset;
const CACHE_STORAGE_NAME = swanadaMod.CACHE_STORAGE_NAME || 'swanada-onnx-v1.0.0';

let workerState = 'UNINITIALIZED';
let ort = null;
let currentLanguage = 'sa';
let activeSession = null;
let activeVocab = [];
let ctcDecoder = null;
let executionProvider = 'wasm';
let cacheStorageName = CACHE_STORAGE_NAME;

const sessionCache = new Map();
let accumulatedAudio = [];
let totalAccumulatedSamples = 0;
let lastPartialTimeMs = 0;
const PARTIAL_THROTTLE_MS = 250;

export function getWorkerState() {
  return workerState;
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
  // 1. Try bundled local relative ESM
  try {
    const mod = await import('./ort/ort.wasm.min.mjs');
    ort = mod?.default?.InferenceSession ? mod.default : (mod.default || mod);
    return ort;
  } catch {}
  // 2. Try bare specifier (Node or bundler context)
  try {
    const mod = await import('onnxruntime-web');
    ort = mod?.default?.InferenceSession ? mod.default : (mod.default || mod);
    return ort;
  } catch (err) {
    throw new Error(`Failed to load onnxruntime-web in worker: ${err.message}`);
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
      ortInstance.env.wasm.wasmPaths = new URL('./ort/', import.meta.url).href;
    } catch {}
  }

  const isIsolated = typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : false;
  let threads = 1;
  if (numThreads && numThreads >= 1) {
    threads = isIsolated ? Math.min(4, numThreads) : 1;
  } else if (isIsolated) {
    const cores = typeof navigator !== 'undefined' ? navigator?.hardwareConcurrency || 4 : 4;
    threads = Math.min(4, Math.max(1, cores - 1));
  }
  ortInstance.env.wasm.numThreads = threads;
  return threads;
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

  if (!vocabUrlOrPath.startsWith('http://') && !vocabUrlOrPath.startsWith('https://') && typeof window === 'undefined') {
    throw new Error(`Vocabulary not found at path: ${vocabUrlOrPath}`);
  }

  const res = await fetch(vocabUrlOrPath);
  if (!res.ok) {
    throw new Error(`Failed to fetch vocabulary from ${vocabUrlOrPath}: HTTP ${res.status}`);
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

function postWorkerMessage(message, transfer) {
  if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
    if (transfer && transfer.length > 0) {
      self.postMessage(message, transfer);
    } else {
      self.postMessage(message);
    }
  }
}

async function setupLanguage(lang, modelUrl, vocabUrl, userThreads, wasmPaths) {
  workerState = 'INITIALIZING';
  currentLanguage = lang;

  if (sessionCache.has(lang)) {
    const cached = sessionCache.get(lang);
    activeSession = cached.session;
    activeVocab = cached.vocab;
    ctcDecoder = new CTCGreedyDecoder(activeVocab);
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
  const activeThreads = configureWasm(ortInstance, userThreads, wasmPaths);

  const effectiveModelUrl = modelUrl || `./models/onnx/swanada_${lang}_ctc_int8.onnx`;
  const effectiveVocabUrl = vocabUrl || `./models/vocabularies/${lang}_vocab.json`;

  activeVocab = await loadVocab(effectiveVocabUrl);
  ctcDecoder = new CTCGreedyDecoder(activeVocab);

  postWorkerMessage({
    type: 'PROGRESS',
    stage: 'downloading',
    progress: 0.1,
    fromCache: false,
  });

  const modelBytes = await loadModelAsset(effectiveModelUrl, cacheStorageName, (p) => {
    postWorkerMessage({
      type: 'PROGRESS',
      stage: p.phase === 'cache' ? 'downloading' : 'downloading',
      progress: p.pct / 100,
      loadedBytes: p.loadedBytes,
      totalBytes: p.totalBytes,
      fromCache: p.fromCache,
    });
  });

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

  try {
    activeSession = await ortInstance.InferenceSession.create(modelBytes, sessionOptions);
  } catch (err) {
    if (executionProvider === 'webgpu') {
      executionProvider = 'wasm';
      sessionOptions.executionProviders = ['wasm'];
      activeSession = await ortInstance.InferenceSession.create(modelBytes, sessionOptions);
    } else {
      throw err;
    }
  }

  postWorkerMessage({
    type: 'PROGRESS',
    stage: 'warmup',
    progress: 0.99,
    fromCache: false,
  });

  const warmupPcm = new Float32Array(1600);
  const warmupMel = extractLogMelFeatures(warmupPcm);
  let warmFeats = null;
  let warmLen = null;
  let warmOut = null;
  try {
    warmFeats = new ortInstance.Tensor('float32', warmupMel.features, [1, 80, warmupMel.numFrames]);
    warmLen = new ortInstance.Tensor('int64', BigInt64Array.from([BigInt(warmupMel.numFrames)]), [1]);
    warmOut = await activeSession.run({ audio_signal: warmFeats, length: warmLen });
  } finally {
    warmFeats?.dispose?.();
    warmLen?.dispose?.();
    if (warmOut) {
      for (const t of Object.values(warmOut)) t?.dispose?.();
    }
  }

  sessionCache.set(lang, { session: activeSession, vocab: activeVocab });
  workerState = 'READY';

  postWorkerMessage({
    type: 'READY',
    language: lang,
    executionProvider,
    numThreads: activeThreads,
    fromCache: false,
  });
}

async function processAudio(pcm, isFinal, chunkIndex) {
  if (!activeSession || !ctcDecoder) {
    throw new Error('Inference session is not ready.');
  }

  workerState = isFinal ? 'READY' : 'STREAMING';
  const startMs = performance.now();
  const durationMs = (pcm.length / 16000) * 1000;

  let sumSq = 0;
  for (let i = 0; i < pcm.length; i++) sumSq += pcm[i] * pcm[i];
  const rms = pcm.length > 0 ? Math.sqrt(sumSq / pcm.length) : 0;

  if (rms < 1e-4) {
    const elapsed = performance.now() - startMs;
    const rtf = durationMs > 0 ? elapsed / durationMs : 0;
    if (isFinal) {
      postWorkerMessage({
        type: 'FINAL',
        text: '',
        iast: currentLanguage === 'sa' ? '' : undefined,
        language: currentLanguage,
        durationMs,
        inferenceMs: elapsed,
        rtf,
        tokens: [],
      });
      accumulatedAudio = [];
      totalAccumulatedSamples = 0;
      ctcDecoder.reset();
      workerState = 'READY';
    }
    return;
  }

  const mel = extractLogMelFeatures(pcm);

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

    const logitsTensor = outputs.logits || Object.values(outputs)[0];
    const dims = logitsTensor.dims;
    timeSteps = dims.length === 3 ? dims[1] : dims[0];
    numClasses = dims.length === 3 ? dims[2] : dims[1];
    logits = new Float32Array(logitsTensor.data);
  } finally {
    featsTensor?.dispose?.();
    lenTensor?.dispose?.();
    if (outputs) {
      for (const t of Object.values(outputs)) t?.dispose?.();
    }
  }

  const decoded = isFinal
    ? decodeCTC(logits, [timeSteps, numClasses], activeVocab)
    : ctcDecoder.decodeChunk(logits, [timeSteps, numClasses]);

  const elapsedMs = performance.now() - startMs;
  const rtf = durationMs > 0 ? elapsedMs / durationMs : 0;
  const iastText = currentLanguage === 'sa' ? devanagariToIast(decoded.text) : undefined;

  if (isFinal) {
    postWorkerMessage({
      type: 'FINAL',
      text: decoded.text,
      iast: iastText,
      language: currentLanguage,
      durationMs,
      inferenceMs: elapsedMs,
      rtf,
      tokens: decoded.tokens,
    });
    accumulatedAudio = [];
    totalAccumulatedSamples = 0;
    ctcDecoder.reset();
    workerState = 'READY';
  } else {
    postWorkerMessage({
      type: 'PARTIAL',
      text: decoded.text,
      iast: iastText,
      rtf,
      tokens: decoded.tokens,
      chunkIndex,
    });
  }
}

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
        await setupLanguage(
          lang,
          msg.modelUrl || config.modelUrl,
          msg.vocabUrl || config.vocabUrl,
          msg.numThreads || config.numThreads,
          msg.wasmPaths || config.wasmPaths
        );
        break;
      }

      case 'AUDIO_CHUNK':
      case 'PROCESS_CHUNK': {
        if (workerState !== 'READY' && workerState !== 'STREAMING') {
          postWorkerMessage({
            type: 'ERROR',
            message: 'Worker is not ready for audio chunks.',
            fatal: false,
          });
          return;
        }

        const rawAudio = msg.audio || msg.chunk;
        if (!rawAudio) {
          postWorkerMessage({
            type: 'ERROR',
            message: 'Missing chunk payload',
            fatal: false,
          });
          return;
        }

        const chunk = rawAudio instanceof Float32Array ? rawAudio : new Float32Array(rawAudio);
        if (chunk.length > 0) {
          accumulatedAudio.push(chunk);
          totalAccumulatedSamples += chunk.length;
        }

        const isFinal = Boolean(msg.isFinal);
        const now = performance.now();
        const shouldEmitPartial = !isFinal && (now - lastPartialTimeMs >= PARTIAL_THROTTLE_MS);

        if (isFinal || shouldEmitPartial) {
          const merged = new Float32Array(totalAccumulatedSamples);
          let offset = 0;
          for (const c of accumulatedAudio) {
            merged.set(c, offset);
            offset += c.length;
          }
          lastPartialTimeMs = now;
          await processAudio(merged, isFinal, msg.chunkIndex);
        }
        break;
      }

      case 'FINISH': {
        if (workerState !== 'READY' && workerState !== 'STREAMING') {
          postWorkerMessage({
            type: 'ERROR',
            message: 'Worker is not ready.',
            fatal: false,
          });
          return;
        }

        const merged = new Float32Array(totalAccumulatedSamples);
        let offset = 0;
        for (const c of accumulatedAudio) {
          merged.set(c, offset);
          offset += c.length;
        }
        await processAudio(merged, true);
        break;
      }

      case 'RESET': {
        accumulatedAudio = [];
        totalAccumulatedSamples = 0;
        ctcDecoder?.reset();
        workerState = 'READY';
        break;
      }

      case 'SET_LANGUAGE': {
        await setupLanguage(msg.language, msg.modelUrl, msg.vocabUrl);
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

if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
  self.addEventListener('message', (event) => {
    handleIncomingMessage(event.data);
  });
}
