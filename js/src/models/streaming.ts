/**
 * StreamingAcousticEngine & SwanadaStreamSession:
 * Manages streaming audio chunk accumulation, sliding context windows (1000ms left context,
 * 2000ms maximum buffer cap), prefix-locked CTC decoding, and event dispatching.
 */

import { AcousticEngine } from './engine.ts';
import { StreamingCTCDecoder } from '../decoder/streaming.ts';
import type { StreamingTranscript } from '../decoder/streaming.ts';
import type { TranscriptionResult } from './types.ts';
import { normalizeIndicText } from '../decoder/normalizer.ts';

export interface StreamSessionOptions {
  chunkSizeSamples?: number;     // e.g. 5120 samples = 320ms @ 16kHz
  leftContextSamples?: number;   // e.g. 16000 samples = 1000ms
  maxBufferSamples?: number;     // e.g. 32000 samples = 2000ms
  vadSilenceThreshold?: number;  // e.g. 0.005
}

export class StreamingAcousticEngine {
  private engine: AcousticEngine;
  private decoder: StreamingCTCDecoder;
  private audioBuffer: Float32Array = new Float32Array(0);
  private leftContextSamples: number;
  private maxBufferSamples: number;
  private vadSilenceThreshold: number;
  private totalAudioSamples: number = 0;
  private consecutiveSilentSamples: number = 0;
  private pauseThresholdSamples: number = 8000; // 500 ms @ 16 kHz
  private baseCommittedTokens: string[] = [];
  private isFinished: boolean = false;
  private isWindowSliding: boolean = false;
  private slidingChunkCount: number = 0;
  private stride: number = 2;
  private lastPartialTranscript: StreamingTranscript | null = null;

  get audioBuffer(): Float32Array {
    return this.audioBuffer;
  }

  get bufferLength(): number {
    return this.audioBuffer.length;
  }

  getAudioBuffer(): Float32Array {
    return this.audioBuffer;
  }

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
    this.decoder = new StreamingCTCDecoder(vocab, {
      requireStabilityOnWordBoundary: true,
    });
    this.leftContextSamples = options?.leftContextSamples ?? 20480; // 1,280 ms
    this.maxBufferSamples = options?.maxBufferSamples ?? 61440; // 3,840 ms
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
          if (
            lastHyp.length > comm.length &&
            comm.every((tok: string, idx: number) => tok === lastHyp[idx])
          ) {
            (this.decoder as any).committedTokens = [...lastHyp];
            (this.decoder as any).committedText = normalizeIndicText(
              lastHyp.join(''),
              (this.decoder as any).options
            );
          }
          this.baseCommittedTokens = this.decoder.getCommittedTokens();
          this.audioBuffer = new Float32Array(0);
          this.isWindowSliding = false;
          this.slidingChunkCount = 0;
          this.lastPartialTranscript = null;
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

    const durationMs = (this.totalAudioSamples / 16000) * 1000;

    // Stride-2 inference scheduling during continuous window sliding
    if (this.isWindowSliding) {
      this.slidingChunkCount++;
      if (this.slidingChunkCount % this.stride !== 0) {
        if (this.lastPartialTranscript) {
          const st: StreamingTranscript = {
            ...this.lastPartialTranscript,
            durationMs,
            inferenceMs: 0,
            rtf: durationMs > 0 ? (this.lastPartialTranscript.inferenceMs / durationMs) : 0,
          };
          for (const cb of this.listeners.partial) {
            try { cb(st); } catch (e) {
              this.emitError(e);
            }
          }
          return st;
        }
        return;
      }
    }

    try {
      const evalBuffer = (this.isWindowSliding && this.audioBuffer.length > this.maxBufferSamples)
        ? this.audioBuffer.slice(-this.maxBufferSamples)
        : this.audioBuffer;

      const startInference = performance.now();
      // Acoustic model inference over active buffer window
      const res = await this.engine.transcribe(evalBuffer);
      const inferenceMs = performance.now() - startInference;

      // Track window offset with base committed tokens across segmented pauses
      const committed = this.decoder.getCommittedTokens();
      let globalTokens: string[];
      if (!this.isWindowSliding) {
        const windowTokens = [...this.baseCommittedTokens, ...res.tokens];
        globalTokens = this.alignGrowingWindow(committed, windowTokens, this.baseCommittedTokens.length);
      } else {
        const [bestOffset, bestRawStart] = this.findWindowAlignment(committed, res.tokens);
        globalTokens = [...committed.slice(0, bestOffset), ...res.tokens.slice(bestRawStart)];
      }

      // Hold irreversible prefix commits during the first <600ms of an utterance segment
      // while still emitting live volatile partial transcripts from 100ms onward.
      const allowCommit = this.isWindowSliding || this.audioBuffer.length >= 9600;

      // Update streaming decoder with aligned global tokens
      const st = this.decoder.update(globalTokens, false, durationMs, inferenceMs, allowCommit);
      this.lastPartialTranscript = st;

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

    // Process pending audio tail if needed (< 1600 samples or odd stride skip)
    const hasUnEvaluatedSamples =
      (this.isWindowSliding && this.slidingChunkCount % this.stride !== 0) ||
      (this.audioBuffer.length >= 400 && (this.audioBuffer.length < 1600 || !(this.decoder as any).lastHypTokens?.length));

    if (this.audioBuffer.length >= 400 && hasUnEvaluatedSamples) {
      const evalBuffer = (this.isWindowSliding && this.audioBuffer.length > this.maxBufferSamples)
        ? this.audioBuffer.slice(-this.maxBufferSamples)
        : this.audioBuffer;
      const tailRes = await this.engine.transcribe(evalBuffer);
      const committed = this.decoder.getCommittedTokens();
      let globalTokens: string[];
      if (!this.isWindowSliding) {
        const windowTokens = [...this.baseCommittedTokens, ...tailRes.tokens];
        globalTokens = this.alignGrowingWindow(committed, windowTokens, this.baseCommittedTokens.length);
      } else {
        const [bestOffset, bestRawStart] = this.findWindowAlignment(committed, tailRes.tokens);
        globalTokens = [...committed.slice(0, bestOffset), ...tailRes.tokens.slice(bestRawStart)];
      }
      this.decoder.update(globalTokens, false, durationMs, 0, true);
    }

    const streamingTokens = (this.decoder as any).lastHypTokens?.length
      ? [...(this.decoder as any).lastHypTokens]
      : this.decoder.getCommittedTokens();

    const inferenceMs = performance.now() - startInference;
    const finalSt = this.decoder.update(streamingTokens, true, durationMs, inferenceMs);

    this.audioBuffer = new Float32Array(0);
    this.totalAudioSamples = 0;
    this.consecutiveSilentSamples = 0;
    this.baseCommittedTokens = [];
    this.isWindowSliding = false;
    this.slidingChunkCount = 0;
    this.lastPartialTranscript = null;

    const result: TranscriptionResult = {
      text: finalSt.text,
      language: (this.engine as any).config?.language || 'sa',
      durationMs,
      inferenceMs,
      rtf: durationMs > 0 ? inferenceMs / durationMs : 0,
      tokens: finalSt.tokens,
    };

    for (const cb of this.listeners.final) {
      try { cb(result); } catch (e) {
        this.emitError(e);
      }
    }

    return result;
  }

  /**
   * Aligns committed prefix tokens against a full re-decoded growing window
   * (`baseCommittedTokens + res.tokens`) so subword insertions/merges earlier in the
   * window never shift uncommitted indices or duplicate syllables while strictly
   * preserving `committedTokens` (0.00% churn).
   */
  private alignGrowingWindow(
    committedTokens: string[],
    windowTokens: string[],
    baseLen: number
  ): string[] {
    const cLen = committedTokens.length;
    if (cLen <= baseLen || windowTokens.length === 0) {
      return windowTokens;
    }

    const searchFrom = Math.max(baseLen, cLen - 8);
    const minEnd = Math.max(baseLen + 1, cLen - 4);
    const maxEnd = Math.min(windowTokens.length, cLen + 5);

    let bestEnd = -1;
    let bestMatchLen = 0;
    let bestDist = 999;

    // 1. Exact suffix match of committedTokens[j..cLen] ending near expected position cLen
    for (let rEnd = minEnd; rEnd <= maxEnd; rEnd++) {
      let matchLen = 0;
      while (
        cLen - 1 - matchLen >= searchFrom &&
        rEnd - 1 - matchLen >= baseLen &&
        committedTokens[cLen - 1 - matchLen] === windowTokens[rEnd - 1 - matchLen]
      ) {
        matchLen++;
      }
      if (matchLen > 0) {
        const dist = Math.abs(rEnd - cLen);
        if (matchLen > bestMatchLen || (matchLen === bestMatchLen && dist < bestDist)) {
          bestMatchLen = matchLen;
          bestEnd = rEnd;
          bestDist = dist;
        }
      }
    }

    if (bestMatchLen > 0 && bestEnd >= 0) {
      return [...committedTokens, ...windowTokens.slice(bestEnd)];
    }

    // 2. 1-token boundary revision near-suffix match (committedTokens[j..cLen-1])
    if (cLen - 1 > baseLen) {
      for (let rMid = Math.max(baseLen + 1, cLen - 5); rMid <= Math.min(windowTokens.length, cLen + 4); rMid++) {
        let matchLen = 0;
        while (
          cLen - 2 - matchLen >= searchFrom &&
          rMid - 1 - matchLen >= baseLen &&
          committedTokens[cLen - 2 - matchLen] === windowTokens[rMid - 1 - matchLen]
        ) {
          matchLen++;
        }
        if (matchLen > 0) {
          const rEnd = Math.min(windowTokens.length, rMid + 1);
          const dist = Math.abs(rEnd - cLen);
          if (matchLen > bestMatchLen || (matchLen === bestMatchLen && dist < bestDist)) {
            bestMatchLen = matchLen;
            bestEnd = rEnd;
            bestDist = dist;
          }
        }
      }
      if (bestMatchLen > 0 && bestEnd >= 0) {
        return [...committedTokens, ...windowTokens.slice(bestEnd)];
      }
    }

    return [...committedTokens, ...windowTokens.slice(Math.min(windowTokens.length, cLen))];
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

  async warmup(): Promise<void> {
    if ((this.engine as any).warmup) {
      await (this.engine as any).warmup();
    }
  }

  reset(): void {
    this.audioBuffer = new Float32Array(0);
    this.totalAudioSamples = 0;
    this.consecutiveSilentSamples = 0;
    this.baseCommittedTokens = [];
    this.isFinished = false;
    this.isWindowSliding = false;
    this.slidingChunkCount = 0;
    this.lastPartialTranscript = null;
    this.decoder.reset();
  }
}

// Alias for compatibility
export const SwanadaStreamSession = StreamingAcousticEngine;
