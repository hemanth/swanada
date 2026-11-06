/**
 * swanada: Dedicated STT Background Web Worker (stt-worker.ts).
 * Runs ONNX Runtime Web WASM SIMD completely off the main thread.
 * Guarantees 60 FPS UI rendering, zero audio capture glitching,
 * and 0 external network requests during active transcription.
 */

import { extractLogMelFeatures } from '../audio/frontend.ts';
import { enhanceSpeechWithTelemetry } from '../audio/denoise.ts';
import { decodeCTC, CTCGreedyDecoder } from '../decoder/ctc.ts';
import { devanagariToIast } from '../tokenizers/iast.ts';
import { loadModelAsset, CACHE_STORAGE_NAME } from '../models/cache.ts';
import { StreamingAcousticEngine } from '../models/streaming.ts';
import type { SupportedLanguage, ExecutionProvider, AcousticInferenceResult } from '../models/types.ts';

// Worker global scope declaration
declare const self: any;

let workerReadyToDispatch = false;
const startupMessageQueue: any[] = [];
if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
  if (!(self as any).__swanadaWorkerListenerAttached) {
    (self as any).__swanadaWorkerListenerAttached = true;
    self.addEventListener('message', (event: any) => {
      if (!workerReadyToDispatch) {
        startupMessageQueue.push(event.data);
      } else {
        dispatchIncomingMessage(event.data);
      }
    });
  }
}

export type WorkerState = 'UNINITIALIZED' | 'INITIALIZING' | 'READY' | 'STREAMING' | 'ERROR';

export interface InitMessage {
  type: 'INIT';
  language?: SupportedLanguage;
  modelUrl?: string;
  vocabUrl?: string;
  executionProvider?: ExecutionProvider;
  numThreads?: number;
  wasmPaths?: string;
  cacheName?: string;
  config?: {
    language?: SupportedLanguage;
    modelUrl?: string;
    vocabUrl?: string;
    executionProvider?: ExecutionProvider;
    numThreads?: number;
    wasmPaths?: string;
    cacheName?: string;
  };
}

export interface AudioChunkMessage {
  type: 'AUDIO_CHUNK' | 'PROCESS_CHUNK';
  audio?: Float32Array;
  chunk?: Float32Array | number[];
  isFinal?: boolean;
  chunkIndex?: number;
}

export interface FinishMessage {
  type: 'FINISH';
}

export interface ResetMessage {
  type: 'RESET';
}

export interface SetLanguageMessage {
  type: 'SET_LANGUAGE';
  language: SupportedLanguage;
  modelUrl?: string;
  vocabUrl?: string;
}

export interface SetDenoiseMessage {
  type: 'SET_DENOISE';
  enabled: boolean;
}

export type IngoingMessage =
  | InitMessage
  | AudioChunkMessage
  | FinishMessage
  | ResetMessage
  | SetLanguageMessage
  | SetDenoiseMessage;

// State management
let workerState: WorkerState = 'UNINITIALIZED';
let ort: any = null;
let currentLanguage: SupportedLanguage = 'sa';
let activeSession: any = null;
let activeVocab: string[] = [];
let ctcDecoder: CTCGreedyDecoder | null = null;
let executionProvider: ExecutionProvider = 'wasm';
let cacheStorageName: string = CACHE_STORAGE_NAME;
let denoiseEnabled: boolean = true;
let lastEstimatedSnrDb: number = 0;

// Session cache (LRU) for instant language switching without redownloading
const sessionCache = new Map<string, { session: any; vocab: string[] }>();

// Streaming session for bounded O(1) real-time transcription
let streamingSession: StreamingAcousticEngine | null = null;
let latestSetupEpoch = 0;
let activeSetupPromise: Promise<void> | null = null;
let inferenceQueue: Promise<void> = Promise.resolve();

export function getWorkerState(): WorkerState {
  return workerState;
}

/**
 * Resolves onnxruntime-web in worker context.
 */
async function resolveOrt(): Promise<any> {
  if (ort) return ort;
  if (typeof self !== 'undefined' && typeof self.ort !== 'undefined') {
    ort = self.ort;
    return ort;
  }
  if (typeof globalThis !== 'undefined' && typeof (globalThis as any).ort !== 'undefined') {
    ort = (globalThis as any).ort;
    return ort;
  }

  const isNode = typeof process !== 'undefined' && Boolean(process.versions?.node);
  if (!isNode) {
    const baseHref =
      (typeof self !== 'undefined' && self.location?.href) ||
      (typeof window !== 'undefined' && (window as any).location?.href) ||
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
    ort = mod.default || mod;
    return ort;
  } catch {
    try {
      const mod = await import('onnxruntime-node');
      ort = mod.default || mod;
      return ort;
    } catch (err) {
      throw new Error(`Failed to load onnxruntime-web in worker: ${(err as Error).message}`);
    }
  }
}

/**
 * Configures WASM environment for worker threads.
 */
function configureWasm(ortInstance: any, numThreads?: number, wasmPaths?: string): number {
  if (!ortInstance?.env?.wasm) return 1;
  ortInstance.env.wasm.simd = true;
  ortInstance.env.wasm.proxy = false;

  if (wasmPaths) {
    ortInstance.env.wasm.wasmPaths = wasmPaths;
  } else if (!ortInstance.env.wasm.wasmPaths) {
    try {
      const baseHref =
        (typeof self !== 'undefined' && self.location?.href) ||
        (typeof window !== 'undefined' && (window as any).location?.href) ||
        (typeof import.meta !== 'undefined' && import.meta.url) ||
        '';
      if (baseHref) {
        ortInstance.env.wasm.wasmPaths = new URL('./ort/', baseHref).href;
      }
    } catch {}
  }

  const isIsolated = typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : false;
  const ua = typeof navigator !== 'undefined' ? navigator?.userAgent || '' : '';
  const devMem = typeof navigator !== 'undefined' ? (navigator as any)?.deviceMemory || 8 : 8;
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

/**
 * Loads vocabulary JSON via CacheStorage or network.
 */
async function loadVocab(vocabUrlOrPath: string): Promise<string[]> {
  // Check CacheStorage first
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

  // Node filesystem check
  const isNode = typeof process !== 'undefined' && Boolean(process.versions?.node);
  if (isNode) {
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

  // Offline check
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error(`Model not found in CacheStorage and client is offline: ${vocabUrlOrPath}`);
  }

  // Network fetch fallback (only if http/https or browser environment)
  if (!vocabUrlOrPath.startsWith('http://') && !vocabUrlOrPath.startsWith('https://') && isNode) {
    throw new Error(`Vocabulary not found at path: ${vocabUrlOrPath}`);
  }

  let fetchUrl = vocabUrlOrPath;
  if (!isNode && !vocabUrlOrPath.startsWith('http://') && !vocabUrlOrPath.startsWith('https://')) {
    try {
      const baseHref =
        (typeof self !== 'undefined' && self.location?.href) ||
        (typeof window !== 'undefined' && (window as any).location?.href) ||
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

  // Clone response and store in CacheStorage
  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(cacheStorageName);
      cache.put(vocabUrlOrPath, res.clone()).catch(() => {});
    } catch {}
  }

  const json = await res.json();
  return Array.isArray(json) ? json : Object.values(json);
}

/**
 * Dispatches an outgoing message via self.postMessage if available.
 */
function postWorkerMessage(message: any, transfer?: Transferable[]): void {
  if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
    if (transfer && transfer.length > 0) {
      self.postMessage(message, transfer);
    } else {
      self.postMessage(message);
    }
  }
}

/**
 * Initializes or switches models and sessions.
 */
async function setupLanguage(
  lang: SupportedLanguage,
  modelUrl?: string,
  vocabUrl?: string,
  userThreads?: number,
  wasmPaths?: string
): Promise<void> {
  const myEpoch = ++latestSetupEpoch;
  workerState = 'INITIALIZING';

  if (sessionCache.has(lang)) {
    if (myEpoch !== latestSetupEpoch) return;
    currentLanguage = lang;
    const cached = sessionCache.get(lang)!;
    activeSession = cached.session;
    activeVocab = cached.vocab;
    ctcDecoder = new CTCGreedyDecoder(activeVocab);
    const engineAdapter: any = {
      config: { language: lang },
      getVocab: () => activeVocab,
      transcribe: async (pcm: Float32Array) => {
        return runAcousticInference(pcm);
      },
    };
    streamingSession = new StreamingAcousticEngine(engineAdapter, activeVocab, {
      leftContextSamples: 30720,
      maxBufferSamples: 61440,
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

  const ortInstance = await resolveOrt();
  const activeThreads = configureWasm(ortInstance, userThreads, wasmPaths);

  // 1. Resolve URLs
  const effectiveModelUrl = modelUrl || `./models/onnx/swanada_${lang}_ctc_int8.onnx`;
  const effectiveVocabUrl = vocabUrl || `./models/vocabularies/${lang}_vocab.json`;

  // 2. Load Vocabulary
  activeVocab = await loadVocab(effectiveVocabUrl);
  ctcDecoder = new CTCGreedyDecoder(activeVocab);

  // 3. Load Acoustic Model with Progress Reporting
  postWorkerMessage({
    type: 'PROGRESS',
    stage: 'downloading',
    progress: 0.1,
    fromCache: false,
  });

  const progressHandler = (p: any) => {
    postWorkerMessage({
      type: 'PROGRESS',
      stage: p.phase === 'cache' ? 'downloading' : 'downloading',
      progress: p.pct / 100,
      loadedBytes: p.loadedBytes,
      totalBytes: p.totalBytes,
      fromCache: p.fromCache,
    });
  };

  const isNodeEnv = typeof process !== 'undefined' && Boolean(process.versions?.node);
  let modelBytes: Uint8Array;
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

  // Evict oldest cached ONNX session before allocating a new 187.5 MB model on mobile / constrained RAM
  const ua = typeof navigator !== 'undefined' ? navigator?.userAgent || '' : '';
  const devMem = typeof navigator !== 'undefined' ? (navigator as any)?.deviceMemory || 8 : 8;
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

  // 4. Compile Session
  postWorkerMessage({
    type: 'PROGRESS',
    stage: 'compiling',
    progress: 0.95,
    fromCache: false,
  });

  const sessionOptions: any = {
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

  // 5. Warmup inference with 100ms synthetic silence
  postWorkerMessage({
    type: 'PROGRESS',
    stage: 'warmup',
    progress: 0.99,
    fromCache: false,
  });

  const warmupPcm = new Float32Array(1600); // 100ms @ 16kHz
  const warmupMel = extractLogMelFeatures(warmupPcm);
  let warmFeats: any = null;
  let warmLen: any = null;
  let warmOut: any = null;
  try {
    warmFeats = new ortInstance.Tensor('float32', warmupMel.features, [1, 80, warmupMel.numFrames]);
    warmLen = new ortInstance.Tensor('int64', BigInt64Array.from([BigInt(warmupMel.numFrames)]), [1]);
    warmOut = await activeSession.run({ audio_signal: warmFeats, length: warmLen });
  } finally {
    warmFeats?.dispose?.();
    warmLen?.dispose?.();
    if (warmOut) {
      for (const t of Object.values(warmOut)) (t as any)?.dispose?.();
    }
  }

  if (myEpoch !== latestSetupEpoch) return;

  // Save to LRU cache
  currentLanguage = lang;
  sessionCache.set(lang, { session: activeSession, vocab: activeVocab });

  const engineAdapter: any = {
    config: { language: lang },
    getVocab: () => activeVocab,
    transcribe: async (pcm: Float32Array) => {
      return runAcousticInference(pcm);
    },
  };
  streamingSession = new StreamingAcousticEngine(engineAdapter, activeVocab, {
    leftContextSamples: 30720,
    maxBufferSamples: 61440,
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
async function runAcousticInference(pcm: Float32Array): Promise<TranscriptionResult & { iast?: string }> {
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
  if (denoiseEnabled) {
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
  let featsTensor: any = null;
  let lenTensor: any = null;
  let outputs: any = null;

  let logits: Float32Array;
  let timeSteps: number;
  let numClasses: number;

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
      for (const t of Object.values(outputs)) (t as any)?.dispose?.();
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
export async function handleIncomingMessage(msg: IngoingMessage): Promise<void> {
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

      case 'SET_DENOISE': {
        denoiseEnabled = Boolean(msg.enabled);
        break;
      }

      default: {
        postWorkerMessage({
          type: 'ERROR',
          message: `Unknown message type: ${(msg as any).type}`,
          fatal: false,
        });
      }
    }
  } catch (err: any) {
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

function dispatchIncomingMessage(msg: any): void {
  if (!msg || !msg.type) return;
  if (msg.type === 'INIT' || msg.type === 'SET_LANGUAGE' || msg.type === 'SET_DENOISE') {
    const p = handleIncomingMessage(msg);
    if (msg.type === 'INIT' || msg.type === 'SET_LANGUAGE') {
      activeSetupPromise = p;
    }
  } else {
    inferenceQueue = inferenceQueue
      .then(async () => {
        if (activeSetupPromise) {
          try { await activeSetupPromise; } catch {}
        }
        await handleIncomingMessage(msg);
      })
      .catch(() => {});
  }
}

workerReadyToDispatch = true;
for (const m of startupMessageQueue.splice(0)) {
  dispatchIncomingMessage(m);
}
