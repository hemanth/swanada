/**
 * StreamingAcousticEngine & SwanadaStreamSession:
 * Manages streaming audio chunk accumulation, sliding context windows (1280ms left context,
 * 2560ms maximum buffer cap), prefix-locked CTC decoding, and event dispatching.
 */

import { AcousticEngine } from './engine.ts';
import { StreamingCTCDecoder } from '../decoder/streaming.ts';
import type { StreamingTranscript } from '../decoder/streaming.ts';
import type { TranscriptionResult } from './types.ts';
import { normalizeIndicText } from '../decoder/normalizer.ts';

export interface StreamSessionOptions {
  chunkSizeSamples?: number;     // e.g. 5120 samples = 320ms @ 16kHz
  leftContextSamples?: number;   // e.g. 20480 samples = 1280ms
  maxBufferSamples?: number;     // e.g. 40960 samples = 2560ms
  vadSilenceThreshold?: number;  // e.g. 0.005
}

export class StreamingAcousticEngine {
  private engine: AcousticEngine;
  private decoder: StreamingCTCDecoder;
  private audioBuffer: Float32Array = new Float32Array(0);
  private allChunks: Float32Array[] = [];
  private leftContextSamples: number;
  private maxBufferSamples: number;
  private vadSilenceThreshold: number;
  private totalAudioSamples: number = 0;
  private consecutiveSilentSamples: number = 0;
  private pauseThresholdSamples: number = 8000; // 500 ms @ 16 kHz
  private baseCommittedTokens: string[] = [];
  private isFinished: boolean = false;
  private isWindowSliding: boolean = false;

  private listeners: {
    partial: ((res: StreamingTranscript) => void)[];
    final: ((res: TranscriptionResult) => void)[];
    token: ((tok: string) => void)[];
    error: ((err: Error) => void)[];
  } = { partial: [], final: [], token: [], error: [] };

  constructor(
    engine: AcousticEngine,
    vocab: string[] | Record<number, string>,
    options?: StreamSessionOptions
  ) {
    this.engine = engine;
    this.decoder = new StreamingCTCDecoder(vocab);
    this.leftContextSamples = options?.leftContextSamples ?? 20480; // 1,280 ms
    this.maxBufferSamples = options?.maxBufferSamples ?? 40960; // 2,560 ms
    this.vadSilenceThreshold = options?.vadSilenceThreshold ?? 0.005;
  }

  on(event: 'partial', cb: (res: StreamingTranscript) => void): this;
  on(event: 'final', cb: (res: TranscriptionResult) => void): this;
  on(event: 'token', cb: (tok: string) => void): this;
  on(event: 'error', cb: (err: Error) => void): this;
  on(event: 'partial' | 'final' | 'token' | 'error', cb: any): this {
    if (this.listeners[event]) {
      this.listeners[event].push(cb);
    }
    return this;
  }

  off(event: 'partial' | 'final' | 'token' | 'error', cb: any): this {
    if (this.listeners[event]) {
      const idx = this.listeners[event].indexOf(cb);
      if (idx !== -1) {
        this.listeners[event].splice(idx, 1);
      }
    }
    return this;
  }

  async push(chunk: Float32Array): Promise<StreamingTranscript | void> {
    if (this.isFinished || chunk.length === 0) return;
    this.totalAudioSamples += chunk.length;
    this.allChunks.push(new Float32Array(chunk));

    // Non-destructive silence check & pause utterance segmentation
    let sumSq = 0;
    for (let i = 0; i < chunk.length; i++) sumSq += chunk[i] * chunk[i];
    const rms = Math.sqrt(sumSq / chunk.length);

    if (rms < this.vadSilenceThreshold) {
      this.consecutiveSilentSamples += chunk.length;
      if (this.consecutiveSilentSamples >= this.pauseThresholdSamples) {
        if (this.audioBuffer.length > 0) {
          // Flush unconfirmed tokens on natural speech pause (turn completion)
          const lastHyp = (this.decoder as any).lastHypTokens || [];
          const comm = this.decoder.getCommittedTokens();
          if (lastHyp.length > comm.length) {
            (this.decoder as any).committedTokens = [...lastHyp];
          }
          this.baseCommittedTokens = this.decoder.getCommittedTokens();
          this.audioBuffer = new Float32Array(0);
          this.isWindowSliding = false;
        }
        return;
      }
    } else {
      this.consecutiveSilentSamples = 0;
    }

    // Concatenate into audioBuffer
    const nextBuf = new Float32Array(this.audioBuffer.length + chunk.length);
    nextBuf.set(this.audioBuffer, 0);
    nextBuf.set(chunk, this.audioBuffer.length);
    this.audioBuffer = nextBuf;

    // Allow initial chunk emission starting at 100ms (1600 samples)
    if (this.audioBuffer.length < 1600) {
      return;
    }

    try {
      const startInference = performance.now();
      // Acoustic model inference over active buffer window
      const res = await this.engine.transcribe(this.audioBuffer);
      const inferenceMs = performance.now() - startInference;
      const durationMs = (this.totalAudioSamples / 16000) * 1000;

      // Track window offset with base committed tokens across segmented pauses
      let globalTokens: string[];
      if (!this.isWindowSliding) {
        globalTokens = [...this.baseCommittedTokens, ...res.tokens];
      } else {
        const committed = this.decoder.getCommittedTokens();
        const [bestOffset, bestRawStart] = this.findWindowAlignment(committed, res.tokens);
        globalTokens = [...committed.slice(0, bestOffset), ...res.tokens.slice(bestRawStart)];
      }

      // Update streaming decoder with aligned global tokens
      const st = this.decoder.update(globalTokens, false, durationMs, inferenceMs);

      // Emit new tokens if any
      if (this.listeners.token.length > 0 && res.tokens.length > 0) {
        const lastTok = res.tokens[res.tokens.length - 1];
        for (const tcb of this.listeners.token) {
          try { tcb(lastTok); } catch (e) {
            this.emitError(e);
          }
        }
      }

      for (const cb of this.listeners.partial) {
        try { cb(st); } catch (e) {
          this.emitError(e);
        }
      }

      // Bound buffer to maxBufferSamples with leftContext
      if (this.audioBuffer.length > this.maxBufferSamples) {
        this.audioBuffer = this.audioBuffer.slice(-this.leftContextSamples);
        this.isWindowSliding = true;
      }

      return st;
    } catch (err: any) {
      this.emitError(err);
    }
  }

  async finish(): Promise<TranscriptionResult> {
    this.isFinished = true;
    const durationMs = (this.totalAudioSamples / 16000) * 1000;
    const startInference = performance.now();

    // Reconstruct full audio if available
    let fullAudio: Float32Array;
    if (this.allChunks.length > 0) {
      fullAudio = new Float32Array(this.totalAudioSamples);
      let offset = 0;
      for (const c of this.allChunks) {
        fullAudio.set(c, offset);
        offset += c.length;
      }
    } else {
      fullAudio = this.audioBuffer;
    }

    // Transcribe tail if pending (< 1600 samples)
    if (this.audioBuffer.length >= 400 && (this.audioBuffer.length < 1600 || !(this.decoder as any).lastHypTokens?.length)) {
      const tailRes = await this.engine.transcribe(this.audioBuffer);
      let globalTokens: string[];
      if (!this.isWindowSliding) {
        globalTokens = [...this.baseCommittedTokens, ...tailRes.tokens];
      } else {
        const committed = this.decoder.getCommittedTokens();
        const [bestOffset, bestRawStart] = this.findWindowAlignment(committed, tailRes.tokens);
        globalTokens = [...committed.slice(0, bestOffset), ...tailRes.tokens.slice(bestRawStart)];
      }
      this.decoder.update(globalTokens, false, durationMs, 0);
    }

    const streamingTokens = (this.decoder as any).lastHypTokens?.length
      ? [...(this.decoder as any).lastHypTokens]
      : this.decoder.getCommittedTokens();

    let batchRes: TranscriptionResult | null = null;
    if (fullAudio.length >= 400) {
      batchRes = await this.engine.transcribe(fullAudio);
    }

    let finalTokens: string[];
    let finalText: string;
    if (batchRes && batchRes.tokens.length >= streamingTokens.length - 2) {
      finalTokens = batchRes.tokens;
      finalText = batchRes.text;
    } else {
      finalTokens = streamingTokens;
      finalText = normalizeIndicText(finalTokens.join(''));
    }

    const inferenceMs = performance.now() - startInference;
    const finalSt = this.decoder.update(finalTokens, true, durationMs, inferenceMs);

    this.audioBuffer = new Float32Array(0);
    this.allChunks = [];
    this.totalAudioSamples = 0;
    this.consecutiveSilentSamples = 0;
    this.baseCommittedTokens = [];
    this.isWindowSliding = false;

    const result: TranscriptionResult = {
      text: finalText,
      language: batchRes ? batchRes.language : '',
      durationMs,
      inferenceMs,
      rtf: durationMs > 0 ? inferenceMs / durationMs : 0,
      tokens: finalTokens,
    };

    for (const cb of this.listeners.final) {
      try { cb(result); } catch (e) {
        this.emitError(e);
      }
    }

    return result;
  }

  private findWindowAlignment(committedTokens: string[], rawTokens: string[]): [number, number] {
    if (committedTokens.length === 0 || rawTokens.length === 0) {
      return [committedTokens.length, 0];
    }

    const searchLimit = Math.max(0, committedTokens.length - 30);
    let bestOffset = committedTokens.length;
    let bestRawStart = 0;
    let bestMatchLen = 0;

    for (let rStart = 0; rStart < rawTokens.length; rStart++) {
      for (let j = committedTokens.length - 1; j >= searchLimit; j--) {
        let matchLen = 0;
        while (
          j + matchLen < committedTokens.length &&
          rStart + matchLen < rawTokens.length &&
          committedTokens[j + matchLen] === rawTokens[rStart + matchLen]
        ) {
          matchLen++;
        }
        if (j + matchLen === committedTokens.length && matchLen > bestMatchLen) {
          bestMatchLen = matchLen;
          bestOffset = j;
          bestRawStart = rStart;
          if (matchLen >= 2) break;
        }
      }
      if (bestMatchLen >= 2) break;
    }

    if (bestMatchLen > 0) {
      return [bestOffset, bestRawStart];
    }

    // Near-suffix match (within 1 token of end)
    for (let rStart = 0; rStart < rawTokens.length; rStart++) {
      for (let j = committedTokens.length - 1; j >= searchLimit; j--) {
        let matchLen = 0;
        while (
          j + matchLen < committedTokens.length &&
          rStart + matchLen < rawTokens.length &&
          committedTokens[j + matchLen] === rawTokens[rStart + matchLen]
        ) {
          matchLen++;
        }
        if (j + matchLen >= committedTokens.length - 1 && matchLen > bestMatchLen) {
          bestMatchLen = matchLen;
          bestOffset = j;
          bestRawStart = rStart;
          if (matchLen >= 2) break;
        }
      }
      if (bestMatchLen >= 2) break;
    }

    if (bestMatchLen >= 2) {
      return [bestOffset, bestRawStart];
    }

    return [committedTokens.length, 0];
  }

  private emitError(err: any): void {
    const errorObj = err instanceof Error ? err : new Error(String(err));
    for (const errCb of this.listeners.error) {
      try { errCb(errorObj); } catch {}
    }
  }

  reset(): void {
    this.audioBuffer = new Float32Array(0);
    this.allChunks = [];
    this.totalAudioSamples = 0;
    this.consecutiveSilentSamples = 0;
    this.baseCommittedTokens = [];
    this.isFinished = false;
    this.isWindowSliding = false;
    this.decoder.reset();
  }
}

// Alias for compatibility
export const SwanadaStreamSession = StreamingAcousticEngine;
