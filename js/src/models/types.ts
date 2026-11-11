/**
 * Types and interfaces for Swanada ONNX Inference Engine.
 */

import type { CodeSwitchSpan } from '../decoder/lid.ts';

export type SupportedLanguage =
  | 'sa' | 'en' | 'hi' | 'kn' | 'mr' | 'bn'
  | 'ta' | 'te' | 'ml' | 'gu' | 'pa' | 'or';

export type LanguageSelection = SupportedLanguage | 'auto';

export type ExecutionProvider = 'wasm' | 'webgpu';

export type ModelTier = 'auto' | 'mobile' | 'studio';

export interface SwanadaEngineConfig {
  language?: LanguageSelection; // Default: 'sa' (or 'auto' for 12-way Auto-LID)
  /** Capability-routed model tier: 'studio' (177 MiB Conformer-Large), 'mobile' (25 MiB Conformer-Small), or 'auto' */
  modelTier?: ModelTier;
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
  /** Preserve genuine English code-mixed words in Latin script during Indic transcription */
  codeSwitchEn?: boolean;
  /** Optional custom path/URL to compact `lid.bin` (`SLID` v1) neural Auto-LID head */
  lidHeadPath?: string;
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
  iast?: string;
  snrDb?: number;
  languageConfidence?: number;
  languageProbabilities?: Record<string, number>;
  englishSpans?: CodeSwitchSpan[];
}
