/**
 * swanada: Dedicated STT Background Web Worker (docs/stt-worker.mjs).
 * Runs ONNX Runtime Web WASM SIMD completely off the main thread.
 * Guarantees 60 FPS UI rendering, zero audio capture glitching,
 * and 0 external network requests during active transcription.
 */

let workerReadyToDispatch = false;
const startupMessageQueue = [];
if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
  self.__swanadaWorkerListenerAttached = true;
  self.addEventListener('message', (event) => {
    if (!workerReadyToDispatch) {
      startupMessageQueue.push(event.data);
    } else {
      handleIncomingMessage(event.data);
    }
  });
}

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
const StreamingAcousticEngine = swanadaMod.StreamingAcousticEngine;
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
let streamingSession = null;

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

  const isNode = typeof process !== 'undefined' && Boolean(process.versions?.node);
  if (!vocabUrlOrPath.startsWith('http://') && !vocabUrlOrPath.startsWith('https://') && isNode) {
    throw new Error(`Vocabulary not found at path: ${vocabUrlOrPath}`);
  }

  let fetchUrl = vocabUrlOrPath;
  if (!isNode && !vocabUrlOrPath.startsWith('http://') && !vocabUrlOrPath.startsWith('https://')) {
    try {
      const baseHref =
        (typeof self !== 'undefined' && self.location?.href) ||
        (typeof window !== 'undefined' && window.location?.href) ||
        '';
      if (baseHref) {
        fetchUrl = new URL(vocabUrlOrPath, baseHref).href;
      }
    } catch {}
  }

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
  console.log('[Worker] setupLanguage called:', { lang, modelUrl, vocabUrl, wasmPaths });
  workerState = 'INITIALIZING';
  currentLanguage = lang;

  if (sessionCache.has(lang)) {
    console.log('[Worker] hit sessionCache for:', lang);
    const cached = sessionCache.get(lang);
    activeSession = cached.session;
    activeVocab = cached.vocab;
    ctcDecoder = new CTCGreedyDecoder(activeVocab);
    const engineAdapter = {
      config: { language: lang },
      getVocab: () => activeVocab,
      transcribe: async (pcm) => {
        return runAcousticInference(pcm);
      },
    };
    streamingSession = new StreamingAcousticEngine(engineAdapter, activeVocab, {
      leftContextSamples: 16000,
      maxBufferSamples: 32000,
      vadSilenceThreshold: 0.005,
    });
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

  console.log('[Worker] resolving ORT...');
  const ortInstance = await resolveOrt();
  console.log('[Worker] ORT resolved:', Boolean(ortInstance));
  if (typeof self !== 'undefined') self.ort = ortInstance;
  const activeThreads = configureWasm(ortInstance, userThreads, wasmPaths);
  console.log('[Worker] WASM configured with threads:', activeThreads);

  const effectiveModelUrl = modelUrl || `./models/onnx/swanada_${lang}_ctc_int8.onnx`;
  const effectiveVocabUrl = vocabUrl || `./models/vocabularies/${lang}_vocab.json`;

  console.log('[Worker] loading vocab from:', effectiveVocabUrl);
  activeVocab = await loadVocab(effectiveVocabUrl);
  console.log('[Worker] vocab loaded, count:', activeVocab.length);
  ctcDecoder = new CTCGreedyDecoder(activeVocab);

  postWorkerMessage({
    type: 'PROGRESS',
    stage: 'downloading',
    progress: 0.1,
    fromCache: false,
  });

  console.log('[Worker] loading model asset from:', effectiveModelUrl);
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

  // Save to LRU cache
  sessionCache.set(lang, { session: activeSession, vocab: activeVocab });

  const engineAdapter = {
    config: { language: lang },
    getVocab: () => activeVocab,
    transcribe: async (pcm) => {
      return runAcousticInference(pcm);
    },
  };
  streamingSession = new StreamingAcousticEngine(engineAdapter, activeVocab, {
    leftContextSamples: 16000,
    maxBufferSamples: 32000,
    vadSilenceThreshold: 0.005,
  });

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

  // 1. Analytical Log-Mel Spectrogram Extraction
  const mel = extractLogMelFeatures(pcm);

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
 * Message dispatcher invoked by incoming postMessage events.
 */
export async function handleIncomingMessage(msg) {
  console.log('[Worker] handleIncomingMessage:', msg?.type);
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
          tokens: finalRes.tokens,
        });
        streamingSession.reset();
        break;
      }

      case 'RESET': {
        streamingSession?.reset();
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

workerReadyToDispatch = true;
for (const m of startupMessageQueue.splice(0)) {
  handleIncomingMessage(m);
}
