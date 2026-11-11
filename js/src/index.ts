/**
 * Swanada: In-Browser & Multi-Runtime Multilingual Speech-to-Text.
 * Zero server dependencies. 100% client-side execution via ONNX/WASM.
 */

import { parseWav } from './audio/ingest.ts';
import { resamplePcm, decodeAndResampleBrowser } from './audio/resample.ts';
import { extractLogMelFeatures } from './audio/frontend.ts';
import { AcousticEngine } from './models/engine.ts';
import { StreamingAcousticEngine } from './models/streaming.ts';
import type { StreamSessionOptions } from './models/streaming.ts';
import { decodeCTC, CTCGreedyDecoder } from './decoder/ctc.ts';
import { StreamingCTCDecoder } from './decoder/streaming.ts';
import type { StreamingTranscript } from './decoder/streaming.ts';
import { normalizeIndicText, dedupMarks, assembleText, repairBrahmicOrthography, joinSubwords } from './decoder/normalizer.ts';
import { transliterateIast } from './tokenizers/iast.ts';
import { SwanadaAudioCapture } from './audio/audio-capture.ts';
import { SwanadaWorkerClient } from './worker/client.ts';
import type {
  SupportedLanguage,
  LanguageSelection,
  ExecutionProvider,
  SwanadaEngineConfig,
  TranscriptionResult,
} from './models/types.ts';
import type { LanguageDetectionResult } from './decoder/lid.ts';

export type SwanadaConfig = SwanadaEngineConfig;
export type { StreamSessionOptions };

export interface SwanadaStream {
  push(chunk: Float32Array): Promise<StreamingTranscript | void>;
  finish(): Promise<TranscriptionResult>;
  on(event: 'token' | 'partial' | 'error' | 'final', callback: Function): void;
  readonly audioBuffer?: Float32Array;
  getBufferLength?(): number;
  warmup?(): Promise<void>;
}

export class Swanada {
  public readonly engine: AcousticEngine;
  private config: SwanadaConfig;

  private constructor(engine: AcousticEngine, config: SwanadaConfig) {
    this.engine = engine;
    this.config = config;
  }

  static async create(config: SwanadaConfig = {}): Promise<Swanada> {
    const engine = await AcousticEngine.create(config);
    await engine.warmup();
    return new Swanada(engine, config);
  }

  /**
   * Deterministically transliterates Classical Sanskrit Devanagari text to Roman IAST.
   */
  static transliterateIast(text: string): string {
    return transliterateIast(text);
  }

  private async resolvePcm16k(audio: Float32Array | ArrayBuffer | Uint8Array | string): Promise<Float32Array> {
    if (audio instanceof Float32Array) {
      return audio;
    }
    if (audio instanceof ArrayBuffer) {
      return decodeAndResampleBrowser(audio, 16000);
    }
    if (typeof Uint8Array !== 'undefined' && audio instanceof Uint8Array) {
      const parsed = parseWav(audio);
      return resamplePcm(parsed.pcm, parsed.sampleRate, 16000);
    }
    if (typeof audio === 'string') {
      if (typeof process !== 'undefined' && process.versions?.node) {
        const fs = await import('node:fs');
        const buf = fs.readFileSync(audio);
        const parsed = parseWav(buf);
        return resamplePcm(parsed.pcm, parsed.sampleRate, 16000);
      }
      const res = await fetch(audio);
      const arrayBuf = await res.arrayBuffer();
      return decodeAndResampleBrowser(arrayBuf, 16000);
    }
    throw new TypeError(`Unsupported audio input type: ${typeof audio}`);
  }

  /**
   * Detects spoken language across all 12 supported languages.
   */
  async detectLanguage(audio: Float32Array | ArrayBuffer | Uint8Array | string): Promise<LanguageDetectionResult> {
    const pcm = await this.resolvePcm16k(audio);
    return this.engine.detectLanguage(pcm);
  }

  /**
   * Transcribes audio from Float32Array PCM, ArrayBuffer (WAV), Uint8Array / Buffer (WAV), or string (URL / File path in Node).
   */
  async transcribe(
    audio: Float32Array | ArrayBuffer | Uint8Array | string,
    options?: { codeSwitchEn?: boolean }
  ): Promise<TranscriptionResult> {
    const pcm = await this.resolvePcm16k(audio);
    return this.engine.transcribe(pcm, options);
  }

  /**
   * Warms up the underlying acoustic engine kernels.
   */
  async warmup(): Promise<void> {
    await this.engine.warmup();
  }

  /**
   * Creates a streaming audio transcription session (alias for createStream).
   */
  stream(options?: StreamSessionOptions): SwanadaStream {
    return this.createStream(options);
  }

  /**
   * Creates a streaming audio transcription session.
   */
  createStream(options?: StreamSessionOptions): SwanadaStream {
    const streamSession = new StreamingAcousticEngine(this.engine, this.engine.getVocab(), options);
    return {
      get audioBuffer(): Float32Array {
        return streamSession.audioBuffer;
      },
      getBufferLength(): number {
        return streamSession.audioBuffer.length;
      },
      async warmup(): Promise<void> {
        return streamSession.warmup();
      },
      async push(chunk: Float32Array): Promise<StreamingTranscript | void> {
        return streamSession.push(chunk);
      },
      async finish(): Promise<TranscriptionResult> {
        return streamSession.finish();
      },
      on(event: 'token' | 'partial' | 'error' | 'final', callback: Function): void {
        streamSession.on(event as any, callback as any);
      },
    };
  }

  async release(): Promise<void> {
    await this.engine.release();
  }

  async dispose(): Promise<void> {
    await this.engine.release();
  }
}

// Re-export all submodules
export * from './audio/index.ts';
export * from './models/index.ts';
export * from './decoder/index.ts';
export * from './tokenizers/index.ts';
export * from './worker/index.ts';
