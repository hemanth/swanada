/**
 * TypeScript Declarations for Swanada.
 * Zero-dependency, client-side multilingual speech-to-text.
 */

export type SupportedLanguage =
  | 'sa' | 'en' | 'hi' | 'kn' | 'mr' | 'bn'
  | 'ta' | 'te' | 'ml' | 'gu' | 'pa' | 'or';

export type LanguageSelection = SupportedLanguage | 'auto';

export type ExecutionProvider = 'wasm' | 'webgpu';

export type ModelTier = 'auto' | 'mobile' | 'studio';

export interface CodeSwitchSpan {
  word: string;
  startChar: number;
  endChar: number;
}

export interface LanguageDetectionResult {
  language: string;
  confidence: number;
  probabilities: Record<string, number>;
  usedNeuralLid: boolean;
}

export interface CodeSwitchDecodeResult {
  text: string;
  tokens: string[];
  englishSpans: CodeSwitchSpan[];
}

export interface SwanadaConfig {
  language?: LanguageSelection;
  modelTier?: ModelTier;
  modelPath?: string;
  modelDir?: string;
  preprocessorPath?: string;
  preprocessorMode?: 'analytical' | 'onnx';
  executionProvider?: ExecutionProvider;
  numThreads?: number;
  wasmPaths?: string;
  cacheStorageName?: string;
  vocabPath?: string;
  headPath?: string;
  /** Enable multi-stage background noise cancellation & speech enhancement (default: true) */
  denoise?: boolean;
  /** Preserve genuine English code-mixed words in Latin script during Indic transcription */
  codeSwitchEn?: boolean;
  /** Optional custom path/URL to compact `lid.bin` (`SLID` v1) neural Auto-LID head */
  lidHeadPath?: string;
}

export interface SwanadaEngineConfig extends SwanadaConfig {}

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

export interface DecodedAudio {
  pcm: Float32Array;
  sampleRate: number;
  numChannels: number;
  durationSec: number;
}

export interface AudioInputOptions {
  targetSampleRate?: number;
}

export interface MelSpectrogramResult {
  features: Float32Array;
  shape: [number, number, number];
  featureLength: number;
  numFrames: number;
}

export interface CTCDecodeOptions {
  blankId?: number;
  collapseRepeats?: boolean;
  skipSpecialTokens?: boolean;
  dedupMarks?: boolean;
  normalizeNFC?: boolean;
  spaceMarker?: string;
}

export interface CTCDecodeResult {
  text: string;
  tokens: string[];
  tokenIds: number[];
}

export interface StreamSessionOptions {
  chunkSizeSamples?: number;
  leftContextSamples?: number;
  maxBufferSamples?: number;
  vadSilenceThreshold?: number;
}

export interface AcousticInferenceResult {
  logits: Float32Array;
  timeSteps: number;
  numClasses: number;
  inferenceMs: number;
}

export declare function resolveEffectiveModelTier(tier?: ModelTier): 'mobile' | 'studio';

export declare class AcousticEngine {
  static create(config?: SwanadaConfig): Promise<AcousticEngine>;
  getModelTier(): 'mobile' | 'studio';
  detectLanguage(audio: Float32Array): Promise<LanguageDetectionResult>;
  transcribe(
    audio: Float32Array,
    options?: { isPartial?: boolean; codeSwitchEn?: boolean; forcedLanguage?: string }
  ): Promise<TranscriptionResult>;
  warmup(): Promise<void>;
  release(): Promise<void>;
  getVocab(): string[];
  getVocabForLanguage(lang: string): string[];
  loadVocabulary(modelDirOrVocabPath?: string): Promise<void>;
  loadAcousticModel(modelPathOrUrl: string): Promise<void>;
  loadPreprocessorModel(prepPathOrUrl: string): Promise<void>;
  runAcousticInference(features: Float32Array, numFrames: number): Promise<AcousticInferenceResult>;
}

export interface SwanadaStream {
  push(chunk: Float32Array): Promise<StreamingTranscript | void>;
  finish(): Promise<TranscriptionResult>;
  on(event: 'token' | 'partial' | 'error' | 'final', callback: Function): void;
  readonly audioBuffer?: Float32Array;
  getBufferLength?(): number;
  warmup?(): Promise<void>;
}

export declare class Swanada {
  readonly engine: AcousticEngine;
  static create(config?: SwanadaConfig): Promise<Swanada>;
  static transliterateIast(text: string): string;
  detectLanguage(audio: Float32Array | ArrayBuffer | Uint8Array | string): Promise<LanguageDetectionResult>;
  transcribe(
    audio: Float32Array | ArrayBuffer | Uint8Array | string,
    options?: { codeSwitchEn?: boolean }
  ): Promise<TranscriptionResult>;
  warmup(): Promise<void>;
  createStream(options?: StreamSessionOptions): SwanadaStream;
  stream(options?: StreamSessionOptions): SwanadaStream;
  release(): Promise<void>;
  dispose(): Promise<void>;
}

export interface LanguageMeta {
  code: SupportedLanguage;
  name: string;
  nativeName: string;
  script: string;
  unicodeRange: [number, number];
  vocabFilename: string;
  modelFilename: string;
}

export declare const LANGUAGE_REGISTRY: Record<SupportedLanguage, LanguageMeta>;

export declare class TokenRegistry {
  constructor(tokens: string[]);
  getToken(id: number): string;
  getId(token: string): number;
  readonly size: number;
  readonly tokens: string[];
}

export declare function detectScript(text: string): SupportedLanguage | null;
export declare function devanagariToIast(text: string): string;
export declare function transliterateIast(text: string): string;

export declare function parseWav(buffer: ArrayBuffer | Uint8Array): DecodedAudio;
export declare function encodeWav(pcm: Float32Array, sampleRate?: number): Uint8Array;
export declare function resamplePcm(input: Float32Array, srcSr: number, targetSr?: number): Float32Array;
export declare function decodeAndResampleBrowser(arrayBuffer: ArrayBuffer, targetSr?: number): Promise<Float32Array>;

export declare const N_FFT: number;
export declare const WIN_LENGTH: number;
export declare const HOP_LENGTH: number;
export declare const N_MELS: number;
export declare const SAMPLE_RATE: number;
export declare const PREEMPH_COEFF: number;
export declare const LOG_EPSILON: number;
export declare const CMVN_FLOOR: number;
export declare const STATIC_WINDOW: Float32Array;
export declare const STATIC_MEL_FB: Float32Array;

export declare function hzToMel(hz: number): number;
export declare function melToHz(mel: number): number;
export declare function extractLogMelFeatures(pcm: Float32Array, sr?: number): MelSpectrogramResult;
export declare function createMelFilterbank(sr?: number, nFft?: number, nMels?: number, fmin?: number, fmax?: number): Float32Array;
export declare function createPaddedHannWindow(winLength?: number, nFft?: number): Float32Array;
export declare function fft512(real: Float32Array, imag: Float32Array): void;

export interface DenoiseOptions {
  sampleRate?: number;
  highPassHz?: number;
  humNotch?: boolean;
  spectralDenoise?: boolean;
  cleanBypassSnrDb?: number;
  spectralFloor?: number;
  nonSpeechGate?: boolean;
  adaptiveGain?: boolean;
}

export interface DenoiseTelemetry {
  pcm: Float32Array;
  estimatedSnrDb: number;
  noiseFloorDbfs: number;
  suppressionDb: number;
  isSpeechLikely: boolean;
}

export declare function enhanceSpeechWithTelemetry(pcm: Float32Array, options?: DenoiseOptions): DenoiseTelemetry;
export declare function denoisePcm16k(pcm: Float32Array, options?: DenoiseOptions): Float32Array;

export interface NormalizeOptions {
  dedupMarks?: boolean;
  normalizeNFC?: boolean;
  spaceMarker?: string;
  lang?: string;
}

export declare function dedupMarks(text: string): string;
export declare function repairBrahmicOrthography(nfcText: string, lang?: string): string;
export declare function normalizeIndicText(rawText: string, options?: NormalizeOptions): string;
export declare function assembleText(tokens: string[], options?: NormalizeOptions): string;
export declare function joinSubwords(
  committed: string | string[],
  volatile: string | string[],
  volatileTokens?: string[],
  options?: NormalizeOptions
): string;

export declare function isSpecialToken(token: string): boolean;

export declare function decodeCTC(
  logits: Float32Array | number[],
  dims: number[],
  vocab: string[] | Record<number, string>,
  options?: CTCDecodeOptions
): CTCDecodeResult;

export declare function decodeCTCTokens(
  tokenIds: number[],
  vocab: string[] | Record<number, string>,
  options?: CTCDecodeOptions
): CTCDecodeResult;

export declare class CTCGreedyDecoder {
  constructor(vocab: string[] | Record<number, string>, options?: CTCDecodeOptions);
  reset(): void;
  decodeChunk(logits: Float32Array | number[], dims: number[]): CTCDecodeResult;
  decode(logits: Float32Array | number[], dims: number[]): CTCDecodeResult;
}

export interface StreamingTranscript {
  text: string;
  committed: string;
  volatile: string;
  isFinal: boolean;
  tokens: string[];
  durationMs: number;
  inferenceMs: number;
  rtf: number;
  detectedLanguage?: string;
  languageConfidence?: number;
}

export interface StreamingDecoderOptions extends CTCDecodeOptions {
  stabilityThreshold?: number;
  trailTokens?: number;
}

export declare class StreamingCTCDecoder {
  constructor(vocab: string[] | Record<number, string>, options?: StreamingDecoderOptions);
  reset(): void;
  getCommittedText(): string;
  update(rawTokens: string[], isStreamEnd?: boolean, durationMs?: number, inferenceMs?: number): StreamingTranscript;
}

export declare class StreamingAcousticEngine {
  constructor(
    engine: AcousticEngine,
    vocab: string[] | Record<number, string>,
    options?: StreamSessionOptions
  );
  readonly audioBuffer: Float32Array;
  readonly bufferLength: number;
  push(chunk: Float32Array): Promise<StreamingTranscript | void>;
  finish(): Promise<TranscriptionResult>;
  on(event: 'partial' | 'final' | 'token' | 'error', callback: Function): this;
  off(event: 'partial' | 'final' | 'token' | 'error', callback: Function): this;
  reset(): void;
}

export declare class SwanadaStreamSession extends StreamingAcousticEngine {}

export interface AudioCaptureConfig {
  sampleRate?: number;
  chunkDurationMs?: number;
  chunkSamples?: number;
  vadThreshold?: number;
  vadEnabled?: boolean;
  silenceGateEnabled?: boolean;
  vadHangoverFrames?: number;
  workletUrl?: string;
  preferScriptProcessor?: boolean;
  deviceId?: string;
}

export interface AudioChunkPayload {
  audioChunk: Float32Array;
  data: Float32Array;
  rms: number;
  isSpeech: boolean;
  isTail?: boolean;
  sampleRate: number;
  timestampMs: number;
}

export interface SilencePayload {
  rms: number;
  isSpeech: false;
  sampleRate: number;
  timestampMs: number;
}

export declare class SwanadaAudioCapture {
  constructor(config?: AudioCaptureConfig);
  static isSupported(): boolean;
  static isWorkletSupported(): boolean;
  on(event: string, callback: Function): this;
  off(event: string, callback: Function): this;
  getState(): string;
  start(): Promise<void>;
  pause(): void;
  resume(): void;
  flush(): Promise<void>;
  stop(): Promise<void>;
  recycleBuffer(buffer: ArrayBuffer): void;
}

export declare const CACHE_STORAGE_NAME: string;
export declare const IDB_DATABASE_NAME: string;
export declare const IDB_STORE_NAME: string;

export declare function isValidOnnxBuffer(buffer: ArrayBuffer | Uint8Array): boolean;
export declare function loadModelAsset(modelPathOrUrl: string, cacheStorageName?: string): Promise<ArrayBuffer>;

export declare function getOrt(): Promise<any>;
export declare function configureWasmEnvironment(ort: any, userThreads?: number, wasmPaths?: string): number;

export interface SwanadaWorkerConfig {
  workerUrl?: string | URL;
  language?: LanguageSelection;
  modelTier?: ModelTier;
  modelUrl?: string;
  headUrl?: string;
  lidUrl?: string;
  vocabUrl?: string;
  executionProvider?: ExecutionProvider;
  numThreads?: number;
  wasmPaths?: string;
  cacheName?: string;
  denoise?: boolean;
  codeSwitchEn?: boolean;
}

export declare class SwanadaWorkerClient {
  constructor(config?: SwanadaWorkerConfig);
  init(config: SwanadaWorkerConfig): Promise<any>;
  whenReady(): Promise<any>;
  setLanguage(language: LanguageSelection, options?: any): Promise<void>;
  setDenoise(enabled: boolean): void;
  setCodeSwitchEn(enabled: boolean): void;
  pushAudio(chunk: Float32Array, isFinal?: boolean): void;
  startStream(): void;
  finishStream(): Promise<TranscriptionResult & { iast?: string }>;
  transcribe(pcm: Float32Array): Promise<TranscriptionResult & { iast?: string }>;
  reset(): void;
  on(event: string, handler: Function): () => void;
  terminate(): void;
}

export declare function handleIncomingMessage(data: any, postMessage: (msg: any) => void): Promise<void>;
export declare function getWorkerState(): any;

export declare const LID_LANGUAGES: readonly SupportedLanguage[];
export declare function parseLidHeadBytes(buffer: ArrayBuffer | Uint8Array): any;
export declare function serializeLidHeadBytes(weights: any): Uint8Array;
export declare function predictNeuralLidLogProbs(weights: any, hidden: Float32Array, timeSteps: number): Record<string, number>;
export declare function detectLanguageFromHidden(
  hidden: Float32Array,
  timeSteps: number,
  heads: Record<string, { weight: Float32Array; bias: Float32Array }>,
  vocabs: Record<string, string[]>,
  lidWeights?: any
): { result: LanguageDetectionResult; cachedLogits: Record<string, Float32Array> };
export declare function decodeBilingualCodeswitch(
  logitsIndic: Float32Array,
  timeSteps: number,
  vocabIndic: string[],
  langIndic: string,
  logitsEn: Float32Array,
  vocabEn: string[],
  isPartial?: boolean
): CodeSwitchDecodeResult;
export declare function splitPcmAtPauses(
  pcm: Float32Array,
  sr?: number,
  minPauseMs?: number,
  minSegmentSec?: number
): Array<[number, number]>;
export declare function transcribeMultilangSegments(
  pcm: Float32Array,
  encodeSegment: (segPcm: Float32Array) => Promise<{ hidden: Float32Array; timeSteps: number }>,
  projectHead: (hidden: Float32Array, timeSteps: number, weight: Float32Array, bias: Float32Array) => Float32Array,
  multiHeads: Record<string, { weight: Float32Array; bias: Float32Array }>,
  multiVocabs: Record<string, string[]>,
  lidWeights: any,
  fallbackVocab: string[],
  useCodeSwitch: boolean,
  sampleRate?: number,
  projectEnDecode?: (
    hidden: Float32Array,
    timeSteps: number
  ) => { logits: Float32Array; vocab: string[] } | null
): Promise<{
  text: string;
  language: string;
  tokens: string[];
  languageConfidence: number;
  languageProbabilities: Record<string, number>;
  englishSpans?: CodeSwitchSpan[];
} | null>;

export declare const SENH_VERSION: number;
export interface AdapterBlockWeights {
  dilation: number;
  ln1Gamma: Float32Array;
  ln1Beta: Float32Array;
  wIn: Float32Array;
  bIn: Float32Array;
  dwWeight: Float32Array;
  dwBias: Float32Array;
  ln2Gamma: Float32Array;
  ln2Beta: Float32Array;
  wOut: Float32Array;
  bOut: Float32Array;
}
export interface EnglishAdapterWeights {
  dModel: number;
  dInner: number;
  kernelSize: number;
  numClasses: number;
  blocks: AdapterBlockWeights[];
  lnOutGamma: Float32Array;
  lnOutBeta: Float32Array;
  wCtc: Float32Array;
  bCtc: Float32Array;
}
export declare function isEnAdapterBytes(raw: ArrayBuffer | Uint8Array): boolean;
export declare function parseEnAdapterBytes(raw: ArrayBuffer | Uint8Array): EnglishAdapterWeights;
export declare function forwardEnAdapter(
  weights: EnglishAdapterWeights,
  hidden: Float32Array,
  timeSteps: number
): Float32Array;

export default Swanada;
