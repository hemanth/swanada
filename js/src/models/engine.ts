/**
 * Core ONNX Runtime Engine for In-Browser and Node.js execution.
 * Manages WASM SIMD, multi-threading negotiation, WebGPU probing,
 * RAII tensor disposal, and model session lifecycles.
 */

import { extractLogMelFeatures } from '../audio/frontend.ts';
import { enhanceSpeechWithTelemetry } from '../audio/denoise.ts';
import { decodeCTC, CTCGreedyDecoder } from '../decoder/ctc.ts';
import { loadModelAsset } from './cache.ts';
import type {
  SwanadaEngineConfig as BaseSwanadaEngineConfig,
  SupportedLanguage,
  ExecutionProvider,
  AcousticInferenceResult,
  TranscriptionResult,
} from './types.ts';

export interface SwanadaEngineConfig extends BaseSwanadaEngineConfig {
  vocabPath?: string;
}

/**
 * Dynamically resolves onnxruntime-web or onnxruntime-node.
 */
export async function getOrt(): Promise<any> {
  if (typeof (globalThis as any).ort !== 'undefined') {
    return (globalThis as any).ort;
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
      return mod.default || mod;
    } catch {}
    try {
      const url = new URL('./ort/ort.wasm.min.mjs', baseHref).href;
      const mod = await import(/* @vite-ignore */ url);
      return mod.default || mod;
    } catch {}
  }
  try {
    const mod = await import('onnxruntime-web');
    return mod.default || mod;
  } catch {
    try {
      const mod = await import('onnxruntime-node');
      return mod.default || mod;
    } catch {
      throw new Error('Neither onnxruntime-web nor onnxruntime-node could be resolved in current runtime.');
    }
  }
}

/**
 * Negotiates optimal WASM SIMD and thread pool settings based on environment capabilities.
 */
export function configureWasmEnvironment(ort: any, userThreads?: number, wasmPaths?: string): number {
  if (!ort || !ort.env || !ort.env.wasm) return 1;

  ort.env.wasm.simd = true;
  ort.env.wasm.proxy = false;

  if (wasmPaths) {
    ort.env.wasm.wasmPaths = wasmPaths;
  }

  // Determine thread count
  const isIsolated = typeof (globalThis as any).crossOriginIsolated !== 'undefined'
    ? (globalThis as any).crossOriginIsolated
    : true; // In Node.js, threading is always supported

  const ua = typeof navigator !== 'undefined' ? navigator?.userAgent || '' : '';
  const platform = typeof navigator !== 'undefined' ? (navigator as any)?.platform || '' : '';
  const maxTouch = typeof navigator !== 'undefined' ? navigator?.maxTouchPoints || 0 : 0;
  const devMem = typeof navigator !== 'undefined' ? (navigator as any)?.deviceMemory || 8 : 8;
  const isMobile =
    /Android|iPhone|iPad|iPod|CriOS|FxiOS|EdgiOS|Mobile/i.test(ua) ||
    (platform === 'MacIntel' && maxTouch > 1) ||
    devMem <= 4;

  let threads = 1;
  if (userThreads && userThreads >= 1) {
    threads = isIsolated ? Math.min(isMobile ? 2 : 8, userThreads) : 1;
  } else if (isIsolated && !isMobile) {
    const hardwareConcurrency = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
    threads = Math.min(4, Math.max(1, hardwareConcurrency - 1));
  } else {
    threads = 1;
  }

  ort.env.wasm.numThreads = threads;
  return threads;
}

export class AcousticEngine {
  private ort: any;
  private config: SwanadaEngineConfig;
  private acousticSession: any = null;
  private preprocessorSession: any = null;
  private vocab: string[] = [];
  private executionProvider: ExecutionProvider = 'wasm';
  private allocatedThreads: number = 1;
  private decoder: CTCGreedyDecoder;
  private isWarmed: boolean = false;

  private constructor(ort: any, config: SwanadaEngineConfig) {
    this.ort = ort;
    this.config = config;
    this.decoder = new CTCGreedyDecoder([]);
  }

  static async create(config: SwanadaEngineConfig = {}): Promise<AcousticEngine> {
    const ort = await getOrt();
    const threads = configureWasmEnvironment(ort, config.numThreads, config.wasmPaths);

    const engine = new AcousticEngine(ort, config);
    engine.allocatedThreads = threads;

    // Load vocabulary for requested language
    await engine.loadVocabulary(config.vocabPath || config.modelPath);

    // Determine execution provider
    engine.executionProvider = config.executionProvider || 'wasm';
    if (engine.executionProvider === 'webgpu') {
      const hasGpu = typeof navigator !== 'undefined' && (navigator as any).gpu;
      if (!hasGpu) {
        engine.executionProvider = 'wasm';
      }
    }

    // Initialize session if model path provided or discover local default
    let effectiveModelPath = config.modelPath;
    if (effectiveModelPath && typeof process !== 'undefined' && process.versions?.node) {
      try {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const resolved = path.resolve(effectiveModelPath);
        if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
          const lang = config.language || 'sa';
          const modelNames = [`swanada_${lang}_ctc_int8.onnx`];
          if (lang === 'sa') modelNames.push('sushrota_sanskrit_ctc_int8.onnx');
          for (const mn of modelNames) {
            const c1 = path.join(resolved, 'onnx', mn);
            const c2 = path.join(resolved, mn);
            if (fs.existsSync(c1)) { effectiveModelPath = c1; break; }
            if (fs.existsSync(c2)) { effectiveModelPath = c2; break; }
          }
        }
      } catch {}
    }
    if (!effectiveModelPath && typeof process !== 'undefined' && process.versions?.node) {
      try {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const { fileURLToPath } = await import('node:url');
        const lang = config.language || 'sa';
        const modelNames = [`swanada_${lang}_ctc_int8.onnx`];
        if (lang === 'sa') modelNames.push('sushrota_sanskrit_ctc_int8.onnx');

        const candidates: string[] = [];

        // 1. Resolve relative to import.meta.url
        if (typeof import.meta !== 'undefined' && import.meta.url) {
          try {
            for (const mn of modelNames) {
              candidates.push(fileURLToPath(new URL(`../../../models/onnx/${mn}`, import.meta.url)));
              candidates.push(fileURLToPath(new URL(`../../models/onnx/${mn}`, import.meta.url)));
            }
          } catch {}
        }

        // 2. Resolve relative to process.cwd()
        for (const mn of modelNames) {
          candidates.push(path.resolve(process.cwd(), 'models/onnx', mn));
        }

        for (const cand of candidates) {
          if (fs.existsSync(cand)) {
            effectiveModelPath = cand;
            break;
          }
        }
      } catch {}
    }

    if (effectiveModelPath) {
      await engine.loadAcousticModel(effectiveModelPath);
    }

    if (config.preprocessorMode === 'onnx' && config.preprocessorPath) {
      await engine.loadPreprocessorModel(config.preprocessorPath);
    }

    return engine;
  }

  async loadVocabulary(modelDirOrVocabPath?: string): Promise<void> {
    let vocabData: any = null;
    const searchedPaths: string[] = [];
    const explicitVocab = this.config.vocabPath ||
      (modelDirOrVocabPath && modelDirOrVocabPath.endsWith('.json') ? modelDirOrVocabPath : undefined);
    const lang = this.config.language || 'sa';
    const vocabFileName = `${lang}_vocab.json`;

    if (typeof process !== 'undefined' && process.versions?.node) {
      try {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const { fileURLToPath } = await import('node:url');

        const candidates: string[] = [];

        if (explicitVocab) {
          // Explicitly configured or passed vocabulary path
          candidates.push(path.resolve(explicitVocab));
        } else {
          // 1. Resolve relative to import.meta.url
          if (typeof import.meta !== 'undefined' && import.meta.url) {
            try {
              candidates.push(fileURLToPath(new URL(`../../../models/vocabularies/${vocabFileName}`, import.meta.url)));
              candidates.push(fileURLToPath(new URL(`../../models/vocabularies/${vocabFileName}`, import.meta.url)));
              if (lang === 'sa') {
                candidates.push(fileURLToPath(new URL('../../../models/vocabularies/sanskrit_vocab.json', import.meta.url)));
                candidates.push(fileURLToPath(new URL('../../models/vocabularies/sanskrit_vocab.json', import.meta.url)));
              }
            } catch {}
          }

          // 2. When modelPath is provided, search sibling/parent directories
          const refPath = modelDirOrVocabPath || this.config.modelPath;
          if (refPath && !refPath.startsWith('http://') && !refPath.startsWith('https://')) {
            const modelDir = path.dirname(path.resolve(refPath));
            candidates.push(
              path.resolve(modelDir, `../vocabularies/${vocabFileName}`),
              path.resolve(modelDir, `vocabularies/${vocabFileName}`),
              path.resolve(modelDir, vocabFileName),
              path.resolve(modelDir, `../../vocabularies/${vocabFileName}`)
            );
            if (lang === 'sa') {
              candidates.push(
                path.resolve(modelDir, '../vocabularies/sanskrit_vocab.json'),
                path.resolve(modelDir, 'vocabularies/sanskrit_vocab.json'),
                path.resolve(modelDir, 'sanskrit_vocab.json'),
                path.resolve(modelDir, '../../vocabularies/sanskrit_vocab.json')
              );
            }
          }

          // 3. Fallback to process.cwd()
          candidates.push(path.resolve(process.cwd(), `models/vocabularies/${vocabFileName}`));
          if (lang === 'sa') {
            candidates.push(path.resolve(process.cwd(), 'models/vocabularies/sanskrit_vocab.json'));
          }
        }

        for (const cand of candidates) {
          searchedPaths.push(cand);
          if (fs.existsSync(cand)) {
            vocabData = JSON.parse(fs.readFileSync(cand, 'utf8'));
            break;
          }
        }
      } catch {
        // Fallback to fetch
      }
    }

    if (!vocabData && typeof fetch !== 'undefined') {
      const fetchUrls: string[] = [];
      if (explicitVocab) {
        fetchUrls.push(explicitVocab);
      } else {
        fetchUrls.push(`./models/vocabularies/${vocabFileName}`);
        if (lang === 'sa') {
          fetchUrls.push('./models/vocabularies/sanskrit_vocab.json');
        }
      }
      for (const url of fetchUrls) {
        try {
          searchedPaths.push(url);
          const res = await fetch(url);
          if (res.ok) {
            vocabData = await res.json();
            break;
          }
        } catch {}
      }
    }

    if (!vocabData) {
      throw new Error(
        `Failed to locate vocabulary for language "${this.config.language || 'sa'}". Searched paths: ${searchedPaths.join(', ')}`
      );
    }

    if (Array.isArray(vocabData)) {
      this.vocab = vocabData;
    } else if (vocabData && typeof vocabData === 'object') {
      this.vocab = Object.values(vocabData);
    } else {
      throw new Error(`Invalid vocabulary format for language "${this.config.language || 'sa'}". Expected JSON array or map.`);
    }

    this.decoder = new CTCGreedyDecoder(this.vocab);
  }

  async loadAcousticModel(modelPathOrUrl: string): Promise<void> {
    const modelBytes = await loadModelAsset(modelPathOrUrl, this.config.cacheStorageName);
    const options: any = {
      executionProviders: [this.executionProvider],
      graphOptimizationLevel: 'all',
    };

    try {
      this.acousticSession = await this.ort.InferenceSession.create(modelBytes, options);
    } catch (err) {
      if (this.executionProvider === 'webgpu') {
        // Graceful fallback to wasm
        this.executionProvider = 'wasm';
        options.executionProviders = ['wasm'];
        this.acousticSession = await this.ort.InferenceSession.create(modelBytes, options);
      } else {
        throw err;
      }
    }
  }

  async loadPreprocessorModel(prepPathOrUrl: string): Promise<void> {
    const modelBytes = await loadModelAsset(prepPathOrUrl, this.config.cacheStorageName);
    const options: any = {
      executionProviders: ['wasm'], // Preprocessor is pinned to WASM/CPU due to STFT
      graphOptimizationLevel: 'all',
    };
    this.preprocessorSession = await this.ort.InferenceSession.create(modelBytes, options);
  }

  /**
   * Runs acoustic model inference with RAII tensor disposal.
   */
  async runAcousticInference(features: Float32Array, numFrames: number): Promise<AcousticInferenceResult> {
    if (!this.acousticSession) {
      throw new Error('Acoustic model session is not initialized. Provide modelPath to create().');
    }

    let featsTensor: any = null;
    let lenTensor: any = null;
    let outputs: any = null;
    const startMs = performance.now();

    try {
      featsTensor = new this.ort.Tensor('float32', features, [1, 80, numFrames]);
      lenTensor = new this.ort.Tensor('int64', BigInt64Array.from([BigInt(numFrames)]), [1]);

      outputs = await this.acousticSession.run({
        audio_signal: featsTensor,
        length: lenTensor,
      });

      const logitsTensor = outputs.logits || Object.values(outputs)[0];
      const dims = logitsTensor.dims; // [1, timeSteps, numClasses] or [timeSteps, numClasses]
      const timeSteps = dims.length === 3 ? dims[1] : dims[0];
      const numClasses = dims.length === 3 ? dims[2] : dims[1];

      // Copy logits data to safe Float32Array before disposing underlying tensor
      const logits = new Float32Array(logitsTensor.data);
      const inferenceMs = performance.now() - startMs;

      return {
        logits,
        timeSteps,
        numClasses,
        inferenceMs,
      };
    } finally {
      featsTensor?.dispose?.();
      lenTensor?.dispose?.();
      if (outputs) {
        for (const t of Object.values(outputs)) {
          (t as any)?.dispose?.();
        }
      }
    }
  }

  /**
   * Transcribes a 16 kHz Float32Array PCM buffer.
   */
  async transcribe(pcm: Float32Array): Promise<TranscriptionResult> {
    const durationMs = (pcm.length / 16000) * 1000;
    const startTotal = performance.now();

    if (pcm.length === 0) {
      return {
        text: '',
        language: this.config.language || 'sa',
        durationMs: 0,
        inferenceMs: 0,
        rtf: 0,
        tokens: [],
      };
    }

    // VAD / Silence Energy Gate: RMS < 1e-4 (-80 dBFS) bypasses acoustic inference
    let sumSq = 0;
    for (let i = 0; i < pcm.length; i++) {
      sumSq += pcm[i] * pcm[i];
    }
    const rms = Math.sqrt(sumSq / pcm.length);
    if (rms < 1e-4) {
      const elapsedMs = performance.now() - startTotal;
      return {
        text: '',
        language: this.config.language || 'sa',
        durationMs,
        inferenceMs: elapsedMs,
        rtf: durationMs > 0 ? (elapsedMs / durationMs) : 0,
        tokens: [],
      };
    }

    if (!this.acousticSession) {
      throw new Error('Acoustic model session is not initialized. Ensure models are available at modelPath.');
    }

    // Multi-stage background noise cancellation & speech enhancement layer (default: enabled)
    let cleanPcm = pcm;
    let snrDb: number | undefined = undefined;
    if (this.config.denoise !== false) {
      const enhanced = enhanceSpeechWithTelemetry(pcm);
      snrDb = enhanced.estimatedSnrDb;
      if (!enhanced.isSpeechLikely) {
        const elapsedMs = performance.now() - startTotal;
        return {
          text: '',
          language: this.config.language || 'sa',
          durationMs,
          inferenceMs: elapsedMs,
          rtf: durationMs > 0 ? (elapsedMs / durationMs) : 0,
          tokens: [],
          snrDb,
        };
      }
      cleanPcm = enhanced.pcm;
    }

    // 1. Feature extraction
    let features: Float32Array;
    let numFrames: number;

    if (this.config.preprocessorMode === 'onnx' && this.preprocessorSession) {
      let audioTensor: any = null;
      let lenTensor: any = null;
      let outputs: any = null;
      try {
        audioTensor = new this.ort.Tensor('float32', cleanPcm, [1, cleanPcm.length]);
        lenTensor = new this.ort.Tensor('int64', BigInt64Array.from([BigInt(cleanPcm.length)]), [1]);
        outputs = await this.preprocessorSession.run({
          audio_signal: audioTensor,
          length: lenTensor,
        });
        const featsTensor = outputs.features || Object.values(outputs)[0];
        numFrames = featsTensor.dims[2];
        features = new Float32Array(featsTensor.data);
      } finally {
        audioTensor?.dispose?.();
        lenTensor?.dispose?.();
        if (outputs) {
          for (const t of Object.values(outputs)) (t as any)?.dispose?.();
        }
      }
    } else {
      // Analytical frontend (default fast path)
      const melResult = extractLogMelFeatures(cleanPcm);
      features = melResult.features;
      numFrames = melResult.numFrames;
    }

    // 2. Acoustic inference
    const acousticRes = await this.runAcousticInference(features, numFrames);

    // 3. CTC greedy decode
    const decodeRes = decodeCTC(
      acousticRes.logits,
      [acousticRes.timeSteps, acousticRes.numClasses],
      this.vocab
    );

    const totalInferenceMs = performance.now() - startTotal;
    const rtf = durationMs > 0 ? (totalInferenceMs / durationMs) : 0;

    return {
      text: decodeRes.text,
      language: this.config.language || 'sa',
      durationMs,
      inferenceMs: totalInferenceMs,
      rtf,
      tokens: decodeRes.tokens,
      snrDb,
    };
  }

  /**
   * Warm-up the session with synthetic non-silent buffers covering sliding window and chunk shapes.
   */
  async warmup(): Promise<void> {
    if (this.isWarmed || !this.acousticSession) return;
    // Generate synthetic non-zero signals exceeding VAD silence gate (RMS >= 1e-4)
    // Pre-warm maximum sliding window buffer (32,000 samples) and chunk size (5,120 samples)
    const windowSignal = new Float32Array(32000);
    for (let i = 0; i < 32000; i++) {
      windowSignal[i] = Math.sin(i * 0.1) * 0.05;
    }
    await this.transcribe(windowSignal);

    const chunkSignal = new Float32Array(5120);
    for (let i = 0; i < 5120; i++) {
      chunkSignal[i] = Math.sin(i * 0.1) * 0.05;
    }
    await this.transcribe(chunkSignal);
    this.isWarmed = true;
  }

  getVocab(): string[] {
    return this.vocab;
  }

  async release(): Promise<void> {
    this.isWarmed = false;
    if (this.acousticSession && typeof this.acousticSession.release === 'function') {
      await this.acousticSession.release();
      this.acousticSession = null;
    }
    if (this.preprocessorSession && typeof this.preprocessorSession.release === 'function') {
      await this.preprocessorSession.release();
      this.preprocessorSession = null;
    }
  }
}
