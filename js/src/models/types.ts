/**
 * Types and interfaces for Swanada ONNX Inference Engine.
 */

export type SupportedLanguage =
  | 'sa' | 'en' | 'hi' | 'kn' | 'mr' | 'bn'
  | 'ta' | 'te' | 'ml' | 'gu' | 'pa' | 'or';

export type ExecutionProvider = 'wasm' | 'webgpu';

export interface SwanadaEngineConfig {
  language?: SupportedLanguage; // Default: 'sa'
  modelPath?: string;
  modelDir?: string;
  preprocessorPath?: string;
  preprocessorMode?: 'analytical' | 'onnx'; // Default: 'analytical'
  executionProvider?: ExecutionProvider;    // Default: 'wasm'
  numThreads?: number;                     // Default: auto (up to 4)
  wasmPaths?: string;
  cacheStorageName?: string;
  /** Enable multi-stage background noise cancellation & speech enhancement (default: true) */
  denoise?: boolean;
}

export interface ModelAssetProgress {
  phase: 'download' | 'cache' | 'compile' | 'warmup' | 'ready';
  loadedBytes: number;
  totalBytes: number;
  pct: number;
  fromCache: boolean;
}

export interface AcousticInferenceResult {
  logits: Float32Array; // Flattened [timeSteps * numClasses]
  timeSteps: number;
  numClasses: number;
  inferenceMs: number;
}

export interface TranscriptionResult {
  text: string;
  language: string;
  durationMs: number;
  inferenceMs: number;
  rtf: number;
  tokens: string[];
  snrDb?: number;
}
