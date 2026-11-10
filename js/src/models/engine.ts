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
  ModelTier,
  AcousticInferenceResult,
  TranscriptionResult,
} from './types.ts';

export interface SwanadaEngineConfig extends BaseSwanadaEngineConfig {
  vocabPath?: string;
  headPath?: string;
}

const LAYER_NORM_84_VALUE_INFO = new Uint8Array([
  0x0a, 0x0d, 0x6c, 0x61, 0x79, 0x65, 0x72, 0x5f, 0x6e, 0x6f, 0x72, 0x6d, 0x5f, 0x38, 0x34,
  0x12, 0x20, 0x0a, 0x1e, 0x08, 0x01, 0x12, 0x1a, 0x0a, 0x07, 0x12, 0x05, 0x62, 0x61, 0x74,
  0x63, 0x68, 0x0a, 0x0a, 0x12, 0x08, 0x74, 0x69, 0x6d, 0x65, 0x5f, 0x73, 0x75, 0x62, 0x0a,
  0x03, 0x08, 0x80, 0x04,
]);

function readPbVarint(buf: Uint8Array, pos: number): [number, number] {
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

function encodePbVarint(n: number): Uint8Array {
  const out: number[] = [];
  let rem = n;
  while (rem >= 128) {
    out.push((rem % 128) | 0x80);
    rem = Math.floor(rem / 128);
  }
  out.push(rem);
  return Uint8Array.from(out);
}

function exposeEncoderHiddenOutput(src: Uint8Array): Uint8Array {
  const graphAppend = new Uint8Array(2 + LAYER_NORM_84_VALUE_INFO.length);
  graphAppend[0] = 0x62;
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

function projectLinearHead(hidden: Float32Array, timeSteps: number, weight: Float32Array, bias: Float32Array): Float32Array {
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

/**
 * Resolves effective model tier ('mobile' vs 'studio') from user config & device capabilities.
 * - Explicit 'mobile' or 'studio' always wins.
 * - 'auto' (or omitted): selects 'mobile' (<30 MB Conformer-Small) on mobile/constrained browsers
 *   (Android, iOS, or deviceMemory <= 4 GB) and 'studio' (177 MiB Conformer-Large) on desktop & Node.js.
 */
export function resolveEffectiveModelTier(tier?: ModelTier): 'mobile' | 'studio' {
  if (tier === 'mobile' || tier === 'studio') {
    return tier;
  }
  const isNode = typeof process !== 'undefined' && Boolean(process.versions?.node);
  if (isNode) {
    return 'studio';
  }
  const ua = typeof navigator !== 'undefined' ? navigator?.userAgent || '' : '';
  const platform = typeof navigator !== 'undefined' ? (navigator as any)?.platform || '' : '';
  const maxTouch = typeof navigator !== 'undefined' ? navigator?.maxTouchPoints || 0 : 0;
  const devMem = typeof navigator !== 'undefined' ? (navigator as any)?.deviceMemory || 8 : 8;
  const isMobile =
    /Android|iPhone|iPad|iPod|CriOS|FxiOS|EdgiOS|Mobile/i.test(ua) ||
    (platform === 'MacIntel' && maxTouch > 1) ||
    devMem <= 4;
  return isMobile ? 'mobile' : 'studio';
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
  private linearHead: { weight: Float32Array; bias: Float32Array } | null = null;
  private vocab: string[] = [];
  private executionProvider: ExecutionProvider = 'wasm';
  private modelTier: 'mobile' | 'studio' = 'studio';
  private allocatedThreads: number = 1;
  private decoder: CTCGreedyDecoder;
  private isWarmed: boolean = false;

  private constructor(ort: any, config: SwanadaEngineConfig) {
    this.ort = ort;
    this.config = config;
    this.decoder = new CTCGreedyDecoder([]);
  }

  getModelTier(): 'mobile' | 'studio' {
    return this.modelTier;
  }

  static async create(config: SwanadaEngineConfig = {}): Promise<AcousticEngine> {
    const ort = await getOrt();
    const threads = configureWasmEnvironment(ort, config.numThreads, config.wasmPaths);

    const engine = new AcousticEngine(ort, config);
    engine.allocatedThreads = threads;
    engine.modelTier = resolveEffectiveModelTier(config.modelTier);

    // Load vocabulary for requested language
    const baseModelRef = config.modelPath || config.modelDir;
    await engine.loadVocabulary(config.vocabPath || baseModelRef);

    // Determine execution provider
    engine.executionProvider = config.executionProvider || 'wasm';
    if (engine.executionProvider === 'webgpu') {
      const hasGpu = typeof navigator !== 'undefined' && (navigator as any).gpu;
      if (!hasGpu) {
        engine.executionProvider = 'wasm';
      }
    }

    const lang = config.language || 'sa';
    const isMobileTier = engine.modelTier === 'mobile';
    const onnxSubfolder = isMobileTier ? 'onnx_mobile' : 'onnx';
    const modelNames = isMobileTier
      ? [
          `swanada_mobile_${lang}_ctc_int8.onnx`,
          ...(lang === 'sa' ? ['swanada_mobile_ctc_int8.onnx'] : []),
        ]
      : [
          `swanada_${lang}_ctc_int8.onnx`,
          ...(lang === 'sa' ? ['sushrota_sanskrit_ctc_int8.onnx'] : []),
        ];

    // Initialize session if model path provided or discover local default
    let effectiveModelPath = baseModelRef;
    if (effectiveModelPath && typeof process !== 'undefined' && process.versions?.node) {
      try {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const resolved = path.resolve(effectiveModelPath);
        if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
          let foundInDir = false;
          for (const mn of modelNames) {
            const c1 = path.join(resolved, onnxSubfolder, mn);
            const c2 = path.join(resolved, mn);
            if (fs.existsSync(c1)) { effectiveModelPath = c1; foundInDir = true; break; }
            if (fs.existsSync(c2)) { effectiveModelPath = c2; foundInDir = true; break; }
          }
          if (!foundInDir) {
            const sharedName = isMobileTier ? 'swanada_mobile_ctc_int8.onnx' : 'sushrota_sanskrit_ctc_int8.onnx';
            const headsFolder = isMobileTier ? 'heads_mobile' : 'heads';
            const scEnc = fs.existsSync(path.join(resolved, onnxSubfolder, sharedName))
              ? path.join(resolved, onnxSubfolder, sharedName)
              : path.join(resolved, sharedName);
            if (fs.existsSync(scEnc)) {
              effectiveModelPath = scEnc;
              if (lang !== 'sa') {
                const headCands = [
                  path.join(resolved, headsFolder, `${lang}.bin`),
                  path.join(resolved, '..', 'docs', headsFolder, `${lang}.bin`),
                ];
                for (const hc of headCands) {
                  if (fs.existsSync(hc)) {
                    const buf = fs.readFileSync(hc);
                    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
                    const floats = new Float32Array(ab);
                    const wc = 257 * 512;
                    engine.linearHead = {
                      weight: floats.subarray(0, wc),
                      bias: floats.subarray(wc, wc + 257),
                    };
                    break;
                  }
                }
              }
            }
          }
        }
      } catch {}
    }
    if (!effectiveModelPath && typeof process !== 'undefined' && process.versions?.node) {
      try {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const { fileURLToPath } = await import('node:url');

        const candidates: string[] = [];

        // 1. Resolve relative to import.meta.url
        if (typeof import.meta !== 'undefined' && import.meta.url) {
          try {
            for (const mn of modelNames) {
              candidates.push(fileURLToPath(new URL(`../../../models/${onnxSubfolder}/${mn}`, import.meta.url)));
              candidates.push(fileURLToPath(new URL(`../../models/${onnxSubfolder}/${mn}`, import.meta.url)));
            }
          } catch {}
        }

        // 2. Resolve relative to process.cwd()
        for (const mn of modelNames) {
          candidates.push(path.resolve(process.cwd(), `models/${onnxSubfolder}`, mn));
        }

        for (const cand of candidates) {
          if (fs.existsSync(cand)) {
            effectiveModelPath = cand;
            break;
          }
        }

        // Shared-encoder + 515 KB `.bin` head fallback when monolithic per-language ONNX isn't materialized
        if (!effectiveModelPath) {
          const sharedName = isMobileTier ? 'swanada_mobile_ctc_int8.onnx' : 'sushrota_sanskrit_ctc_int8.onnx';
          const headsFolder = isMobileTier ? 'heads_mobile' : 'heads';
          const sharedCandidates: Array<{ enc: string; head: string }> = [];
          if (typeof import.meta !== 'undefined' && import.meta.url) {
            try {
              sharedCandidates.push({
                enc: fileURLToPath(new URL(`../../../models/${onnxSubfolder}/${sharedName}`, import.meta.url)),
                head: fileURLToPath(new URL(`../../../docs/${headsFolder}/${lang}.bin`, import.meta.url)),
              });
              sharedCandidates.push({
                enc: fileURLToPath(new URL(`../../models/${onnxSubfolder}/${sharedName}`, import.meta.url)),
                head: fileURLToPath(new URL(`../../docs/${headsFolder}/${lang}.bin`, import.meta.url)),
              });
            } catch {}
          }
          sharedCandidates.push(
            {
              enc: path.resolve(process.cwd(), `models/${onnxSubfolder}`, sharedName),
              head: path.resolve(process.cwd(), `docs/${headsFolder}`, `${lang}.bin`),
            },
            {
              enc: path.resolve(process.cwd(), `models/${onnxSubfolder}`, sharedName),
              head: path.resolve(process.cwd(), `models/${headsFolder}`, `${lang}.bin`),
            }
          );
          for (const sc of sharedCandidates) {
            if (fs.existsSync(sc.enc)) {
              effectiveModelPath = sc.enc;
              if (lang !== 'sa' && fs.existsSync(sc.head)) {
                const buf = fs.readFileSync(sc.head);
                const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
                const floats = new Float32Array(ab);
                const wc = 257 * 512;
                engine.linearHead = {
                  weight: floats.subarray(0, wc),
                  bias: floats.subarray(wc, wc + 257),
                };
              }
              break;
            }
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
    let modelBytes = await loadModelAsset(modelPathOrUrl, this.config.cacheStorageName);
    if (this.linearHead) {
      modelBytes = exposeEncoderHiddenOutput(modelBytes);
    }
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

      if (this.linearHead && outputs.layer_norm_84) {
        const hidTensor = outputs.layer_norm_84;
        const hDims = hidTensor.dims; // [1, timeSteps, 512]
        const timeSteps = hDims.length === 3 ? hDims[1] : hDims[0];
        const logits = projectLinearHead(
          hidTensor.data as Float32Array,
          timeSteps,
          this.linearHead.weight,
          this.linearHead.bias
        );
        const inferenceMs = performance.now() - startMs;
        return {
          logits,
          timeSteps,
          numClasses: 257,
          inferenceMs,
        };
      }

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
  async transcribe(pcm: Float32Array, options?: { isPartial?: boolean }): Promise<TranscriptionResult> {
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

    // 3. CTC decode
    const decodeRes = decodeCTC(
      acousticRes.logits,
      [acousticRes.timeSteps, acousticRes.numClasses],
      this.vocab,
      options?.isPartial ? { isPartial: true } : undefined
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
