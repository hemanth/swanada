/**
 * TypeScript Declarations for Swanada.
 */

export type SupportedLanguage =
  | 'sa' | 'en' | 'hi' | 'kn' | 'mr' | 'bn'
  | 'ta' | 'te' | 'ml' | 'gu' | 'pa' | 'or';

export type ExecutionProvider = 'wasm' | 'webgpu';

export interface SwanadaConfig {
  language?: SupportedLanguage;
  modelPath?: string;
  preprocessorPath?: string;
  preprocessorMode?: 'analytical' | 'onnx';
  executionProvider?: ExecutionProvider;
  numThreads?: number;
  wasmPaths?: string;
  cacheStorageName?: string;
}

export interface TranscriptionResult {
  text: string;
  language: string;
  durationMs: number;
  inferenceMs: number;
  rtf: number;
  tokens: string[];
}

export interface DecodedAudio {
  pcm: Float32Array;
  sampleRate: number;
  numChannels: number;
  durationSec: number;
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

export interface SwanadaStream {
  push(chunk: Float32Array): Promise<StreamingTranscript | void>;
  finish(): Promise<TranscriptionResult>;
  on(event: 'token' | 'partial' | 'error' | 'final', callback: Function): void;
}

export declare class Swanada {
  static create(config?: SwanadaConfig): Promise<Swanada>;
  static transliterateIast(text: string): string;
  transcribe(audio: Float32Array | ArrayBuffer | Uint8Array | string): Promise<TranscriptionResult>;
  createStream(): SwanadaStream;
  release(): Promise<void>;
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

export declare function extractLogMelFeatures(pcm: Float32Array, sr?: number): MelSpectrogramResult;
export declare function createMelFilterbank(sr?: number, nFft?: number, nMels?: number, fmin?: number, fmax?: number): Float32Array;
export declare function createPaddedHannWindow(winLength?: number, nFft?: number): Float32Array;
export declare function fft512(real: Float32Array, imag: Float32Array): void;

export declare function dedupMarks(text: string): string;
export declare function normalizeIndicText(rawText: string, options?: CTCDecodeOptions): string;
export declare function assembleText(tokens: string[], options?: CTCDecodeOptions): string;

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
  constructor(engine: any, vocab: string[] | Record<number, string>, options?: any);
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

export interface SwanadaWorkerConfig {
  workerUrl?: string | URL;
  language?: SupportedLanguage;
  modelUrl?: string;
  vocabUrl?: string;
  executionProvider?: ExecutionProvider;
  numThreads?: number;
  wasmPaths?: string;
  cacheName?: string;
}

export declare class SwanadaWorkerClient {
  constructor(config?: SwanadaWorkerConfig);
  init(config: SwanadaWorkerConfig): Promise<any>;
  whenReady(): Promise<any>;
  setLanguage(language: SupportedLanguage, options?: any): Promise<void>;
  pushAudio(chunk: Float32Array, isFinal?: boolean): void;
  transcribe(pcm: Float32Array): Promise<TranscriptionResult & { iast?: string }>;
  reset(): void;
  on(event: string, handler: Function): () => void;
  terminate(): void;
}
