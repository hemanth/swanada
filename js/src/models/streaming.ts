/**
 * StreamingAcousticEngine & SwanadaStreamSession:
 * Manages streaming audio chunk accumulation, sliding context windows (1000ms left context,
 * 2000ms maximum buffer cap), prefix-locked CTC decoding, and event dispatching.
 */

import { AcousticEngine } from './engine.ts';
import { StreamingCTCDecoder, formatEnDisplay } from '../decoder/streaming.ts';
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
  private pendingChunk: Float32Array = new Float32Array(0);
  private leftContextSamples: number;
  private maxBufferSamples: number;
  private vadSilenceThreshold: number;
  private totalAudioSamples: number = 0;
  private consecutiveSilentSamples: number = 0;
  private pauseThresholdSamples: number = 8000; // 500 ms @ 16 kHz turn-segmentation threshold
  private baseCommittedTokens: string[] = [];
  private isFinished: boolean = false;
  private isWindowSliding: boolean = false;
  private samplesSinceLastInference: number = 0;
  private hasUntranscribedTail: boolean = false;
  private pendingTurnFlush: boolean = false;
  private lastPartialTranscript: StreamingTranscript | null = null;
  private isAutoLanguage: boolean = false;
  private detectedLanguage: string | undefined = undefined;
  private languageConfidence: number | undefined = undefined;
  private languageLocked: boolean = false;
  private priorTurnsText: string = '';
  private priorTurnsTokens: string[] = [];
  private fullRecordingPcm: Float32Array = new Float32Array(0);

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
      trailTokens: 3,
      requireStabilityOnWordBoundary: true,
    });
    this.leftContextSamples = options?.leftContextSamples ?? 25600; // 1,600 ms overlap guarantees committed tail stays in window
    this.maxBufferSamples = options?.maxBufferSamples ?? 61440; // 3,840 ms window cap
    this.vadSilenceThreshold = options?.vadSilenceThreshold ?? 0.005;
    this.isAutoLanguage = ((engine as any)?.config?.language === 'auto');
  }

  private async transcribeStreamWindow(evalBuffer: Float32Array, isPartial: boolean): Promise<TranscriptionResult> {
    if (!this.isAutoLanguage) {
      return isPartial
        ? (this.engine as any).transcribe(evalBuffer, { isPartial: true })
        : (this.engine as any).transcribe(evalBuffer);
    }
    if (this.languageLocked && this.detectedLanguage) {
      return (this.engine as any).transcribe(evalBuffer, {
        isPartial,
        forcedLanguage: this.detectedLanguage,
      });
    }
    const res: TranscriptionResult = await (this.engine as any).transcribe(evalBuffer, { isPartial });
    if (res.language && res.language !== 'auto') {
      if (this.detectedLanguage !== res.language) {
        this.detectedLanguage = res.language;
        const newVocab =
          typeof (this.engine as any).getVocabForLanguage === 'function'
            ? (this.engine as any).getVocabForLanguage(res.language)
            : (this.engine as any).getVocab?.() || [];
        this.decoder = new StreamingCTCDecoder(newVocab, {
          trailTokens: 3,
          requireStabilityOnWordBoundary: true,
        });
        this.baseCommittedTokens = [];
      }
      this.languageConfidence = res.languageConfidence;
      if (evalBuffer.length >= 24000 && (res.languageConfidence ?? 0) >= 0.78) {
        this.languageLocked = true;
      }
    }
    return res;
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

  private promotePendingTurn(): void {
    const lastHyp: string[] = (this.decoder as any).lastHypTokens || [];
    const comm = this.decoder.getCommittedTokens();
    if (
      lastHyp.length > comm.length &&
      comm.every((tok: string, idx: number) => tok === lastHyp[idx])
    ) {
      const prevCommStr = this.decoder.getCommittedText();
      const candRaw = normalizeIndicText(
        lastHyp.join(''),
        (this.decoder as any).options
      );
      const candStr = (this.decoder as any).isEnglish ? formatEnDisplay(candRaw) : candRaw;
      if (!prevCommStr || candStr.startsWith(prevCommStr)) {
        (this.decoder as any).committedTokens = [...lastHyp];
        (this.decoder as any).committedText = candStr;
      }
    }
    this.baseCommittedTokens = this.decoder.getCommittedTokens();
    this.pendingTurnFlush = false;
  }

  private withPriorTurns(st: StreamingTranscript): StreamingTranscript {
    if (!this.priorTurnsText) return st;
    const comm = st.committed ? `${this.priorTurnsText} ${st.committed}`.trim() : this.priorTurnsText;
    const fullTxt = st.text ? `${this.priorTurnsText} ${st.text}`.trim() : this.priorTurnsText;
    return {
      ...st,
      text: fullTxt,
      committed: comm,
      tokens: [...this.priorTurnsTokens, ...st.tokens],
    };
  }

  private async segmentTurnOnPause(durationMs: number): Promise<void> {
    if (this.audioBuffer.length >= 4800) {
      if (this.hasUntranscribedTail || !(this.decoder as any).lastHypTokens?.length) {
        try {
          const evalBuf = (this.isWindowSliding && this.audioBuffer.length > this.maxBufferSamples)
            ? this.audioBuffer.slice(-this.maxBufferSamples)
            : this.audioBuffer;
          const tailRes = await this.transcribeStreamWindow(evalBuf, true);
          if (tailRes?.tokens?.length > 0) {
            if (this.pendingTurnFlush) {
              this.promotePendingTurn();
            }
            const committed = this.decoder.getCommittedTokens();
            const globalTokens = !this.isWindowSliding
              ? this.alignGrowingWindow(
                  committed,
                  [...this.baseCommittedTokens, ...tailRes.tokens],
                  this.baseCommittedTokens.length
                )
              : (() => {
                  const [bo, br] = this.findWindowAlignment(committed, tailRes.tokens);
                  return [...committed.slice(0, bo), ...tailRes.tokens.slice(br)];
                })();
            const stTail = this.decoder.update(globalTokens, false, durationMs, 0, false);
            if (this.isAutoLanguage) {
              stTail.detectedLanguage = this.detectedLanguage;
              stTail.languageConfidence = this.languageConfidence;
            }
            this.lastPartialTranscript = this.isAutoLanguage ? this.withPriorTurns(stTail) : stTail;
          }
        } catch (err: any) {
          this.emitError(err);
        }
      }
      if (this.isAutoLanguage) {
        this.promotePendingTurn();
        const turnTxt = this.decoder.getCommittedText().trim();
        if (turnTxt) {
          this.priorTurnsText = this.priorTurnsText ? `${this.priorTurnsText} ${turnTxt}`.trim() : turnTxt;
          this.priorTurnsTokens.push(...this.decoder.getCommittedTokens());
        }
        this.decoder.reset();
        this.baseCommittedTokens = [];
        this.pendingTurnFlush = false;
        this.languageLocked = false;
        if (this.priorTurnsText) {
          this.lastPartialTranscript = {
            text: this.priorTurnsText,
            committed: this.priorTurnsText,
            volatile: '',
            isFinal: false,
            tokens: [...this.priorTurnsTokens],
            durationMs,
            inferenceMs: 0,
            rtf: 0,
            detectedLanguage: this.detectedLanguage,
            languageConfidence: this.languageConfidence,
          };
        }
      } else {
        this.pendingTurnFlush = true;
      }
      this.audioBuffer = new Float32Array(0);
      this.pendingChunk = new Float32Array(0);
      this.isWindowSliding = false;
      this.samplesSinceLastInference = 0;
      this.hasUntranscribedTail = false;
    }
  }

  private hasSpeechEnergy(buf: Float32Array): boolean {
    if (buf.length === 0) return false;
    let sumSq = 0;
    for (let i = 0; i < buf.length; i++) sumSq += buf[i] * buf[i];
    if (Math.sqrt(sumSq / buf.length) >= this.vadSilenceThreshold) return true;
    const step = 400;
    for (let off = 0; off + step <= buf.length; off += step) {
      let sSq = 0;
      for (let k = off; k < off + step; k++) sSq += buf[k] * buf[k];
      if (Math.sqrt(sSq / step) >= this.vadSilenceThreshold) return true;
    }
    return false;
  }

  async push(chunk: Float32Array): Promise<StreamingTranscript | void> {
    if (this.isFinished || chunk.length === 0) return;
    const cap = this.isAutoLanguage ? 960000 : this.maxBufferSamples;
    if (this.isAutoLanguage || !this.isWindowSliding) {
      if (this.fullRecordingPcm.length + chunk.length <= cap) {
        const mergedFull = new Float32Array(this.fullRecordingPcm.length + chunk.length);
        mergedFull.set(this.fullRecordingPcm, 0);
        mergedFull.set(chunk, this.fullRecordingPcm.length);
        this.fullRecordingPcm = mergedFull;
      } else if (this.isAutoLanguage) {
        const mergedFull = new Float32Array(this.fullRecordingPcm.length + chunk.length);
        mergedFull.set(this.fullRecordingPcm, 0);
        mergedFull.set(chunk, this.fullRecordingPcm.length);
        this.fullRecordingPcm = mergedFull.slice(-cap);
      } else {
        this.fullRecordingPcm = new Float32Array(0);
      }
    }
    this.totalAudioSamples += chunk.length;
    const durationMs = (this.totalAudioSamples / 16000) * 1000;

    // Coalesce sub-200ms (< 3200 sample) micro-chunks BEFORE VAD so 20ms-80ms plosive
    // stop consonant closures are never dropped from inside spoken words.
    if (chunk.length < 3200 || this.pendingChunk.length > 0) {
      const merged = new Float32Array(this.pendingChunk.length + chunk.length);
      merged.set(this.pendingChunk, 0);
      merged.set(chunk, this.pendingChunk.length);
      this.pendingChunk = merged;

      let pSumSq = 0;
      for (let i = 0; i < this.pendingChunk.length; i++) {
        pSumSq += this.pendingChunk[i] * this.pendingChunk[i];
      }
      const pRms = Math.sqrt(pSumSq / this.pendingChunk.length);

      if (this.lastPartialTranscript === null) {
        if (this.pendingChunk.length < 1600) {
          return;
        }
        if (this.pendingChunk.length < 3200 && pRms < this.vadSilenceThreshold) {
          return;
        }
      } else if (this.pendingChunk.length < 3200) {
        if (!this.pendingTurnFlush && pRms >= this.vadSilenceThreshold) {
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

      chunk = this.pendingChunk;
      this.pendingChunk = new Float32Array(0);
    }

    // Non-destructive silence check & sub-frame pause utterance segmentation
    let sumSq = 0;
    for (let i = 0; i < chunk.length; i++) sumSq += chunk[i] * chunk[i];
    const rms = Math.sqrt(sumSq / chunk.length);

    if (rms < this.vadSilenceThreshold) {
      this.consecutiveSilentSamples += chunk.length;
      if (this.consecutiveSilentSamples >= this.pauseThresholdSamples) {
        await this.segmentTurnOnPause(durationMs);
        if (
          this.pendingTurnFlush &&
          this.consecutiveSilentSamples >= Math.max(this.pauseThresholdSamples, 16000)
        ) {
          this.promotePendingTurn();
          if (this.decoder.getCommittedText()) {
            this.lastPartialTranscript = {
              text: this.decoder.getCommittedText(),
              committed: this.decoder.getCommittedText(),
              volatile: '',
              isFinal: false,
              tokens: this.decoder.getCommittedTokens(),
              durationMs,
              inferenceMs: 0,
              rtf: 0,
            };
          }
        }
        return;
      }
      return;
    }

    // Measure leading and trailing 25ms (400-sample) silent sub-frames on straddling chunks
    let leadSilent = 0;
    const step = 400;
    while (leadSilent + step <= chunk.length) {
      let sSq = 0;
      for (let k = leadSilent; k < leadSilent + step; k++) sSq += chunk[k] * chunk[k];
      if (Math.sqrt(sSq / step) < this.vadSilenceThreshold) {
        leadSilent += step;
      } else {
        break;
      }
    }

    let trailSilent = 0;
    while (trailSilent + step <= chunk.length - leadSilent) {
      let sSq = 0;
      const startIdx = chunk.length - trailSilent - step;
      for (let k = startIdx; k < startIdx + step; k++) sSq += chunk[k] * chunk[k];
      if (Math.sqrt(sSq / step) < this.vadSilenceThreshold) {
        trailSilent += step;
      } else {
        break;
      }
    }

    let activeChunk = chunk;
    if (leadSilent > 0 && this.consecutiveSilentSamples + leadSilent >= this.pauseThresholdSamples) {
      await this.segmentTurnOnPause(durationMs);
      activeChunk = chunk.subarray(leadSilent);
      if (activeChunk.length === 0) {
        this.consecutiveSilentSamples = trailSilent;
        return;
      }
    }
    this.consecutiveSilentSamples = trailSilent;
    chunk = activeChunk;

    // Concatenate into audioBuffer
    const nextBuf = new Float32Array(this.audioBuffer.length + chunk.length);
    nextBuf.set(this.audioBuffer, 0);
    nextBuf.set(chunk, this.audioBuffer.length);
    this.audioBuffer = nextBuf;
    this.samplesSinceLastInference += chunk.length;

    // Allow initial chunk emission starting at 100ms (1600 samples)
    if (this.audioBuffer.length < 1600) {
      this.hasUntranscribedTail = true;
      return;
    }

    try {
      const evalBuffer = (this.isWindowSliding && this.audioBuffer.length > this.maxBufferSamples)
        ? this.audioBuffer.slice(-this.maxBufferSamples)
        : this.audioBuffer;

      const startInference = performance.now();
      const res = await this.transcribeStreamWindow(evalBuffer, true);
      const inferenceMs = performance.now() - startInference;
      this.samplesSinceLastInference = 0;
      this.hasUntranscribedTail = false;

      if (this.pendingTurnFlush && res.tokens.length > 0) {
        this.promotePendingTurn();
      }

      const committed = this.decoder.getCommittedTokens();
      let globalTokens: string[];

      if (this.pendingTurnFlush && res.tokens.length === 0) {
        const lastHyp: string[] = (this.decoder as any).lastHypTokens || [];
        globalTokens = lastHyp.length > committed.length ? [...lastHyp] : [...committed];
      } else if (!this.isWindowSliding) {
        const windowTokens = [...this.baseCommittedTokens, ...res.tokens];
        globalTokens = this.alignGrowingWindow(committed, windowTokens, this.baseCommittedTokens.length);
      } else {
        const [bestOffset, bestRawStart] = this.findWindowAlignment(committed, res.tokens);
        globalTokens = [...committed.slice(0, bestOffset), ...res.tokens.slice(bestRawStart)];
      }

      // Preserve active volatile tokens across momentary mid-utterance breath frames
      const prevHyp: string[] = (this.decoder as any).lastHypTokens || [];
      if (
        prevHyp.length > committed.length &&
        (globalTokens.length <= committed.length ||
          normalizeIndicText(globalTokens.slice(committed.length).join('')) === '')
      ) {
        globalTokens = [...committed, ...prevHyp.slice(committed.length)];
      }

      const commitMinSamples = Math.max(32000, this.maxBufferSamples - 16384);
      const allowCommit =
        !this.pendingTurnFlush && (this.isWindowSliding || this.audioBuffer.length >= commitMinSamples);

      let st = this.decoder.update(globalTokens, false, durationMs, inferenceMs, allowCommit);
      if (this.isAutoLanguage) {
        st.detectedLanguage = this.detectedLanguage;
        st.languageConfidence = this.languageConfidence;
        st = this.withPriorTurns(st);
      }
      this.lastPartialTranscript = st;

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

      // Bound buffer to maxBufferSamples with leftContext (deferring initial slide briefly if 0 tokens committed yet)
      const slideCap =
        !this.isWindowSliding && this.decoder.getCommittedTokens().length <= this.baseCommittedTokens.length
          ? this.maxBufferSamples + 15360
          : this.maxBufferSamples;
      if (this.audioBuffer.length > slideCap) {
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

    if (this.pendingChunk.length > 0) {
      if ((this.audioBuffer.length > 0 && !this.pendingTurnFlush) || this.hasSpeechEnergy(this.pendingChunk)) {
        const merged = new Float32Array(this.audioBuffer.length + this.pendingChunk.length);
        merged.set(this.audioBuffer, 0);
        merged.set(this.pendingChunk, this.audioBuffer.length);
        this.audioBuffer = merged;
        this.hasUntranscribedTail = true;
      }
      this.pendingChunk = new Float32Array(0);
    }

    if (this.isAutoLanguage && this.fullRecordingPcm.length >= 400) {
      const fullPcm = this.fullRecordingPcm;
      const fullRes: TranscriptionResult = await (this.engine as any).transcribe(fullPcm, { isPartial: false });
      fullRes.durationMs = durationMs;
      fullRes.rtf = durationMs > 0 ? fullRes.inferenceMs / durationMs : 0;
      this.audioBuffer = new Float32Array(0);
      this.pendingChunk = new Float32Array(0);
      this.fullRecordingPcm = new Float32Array(0);
      this.detectedLanguage = undefined;
      this.languageConfidence = undefined;
      this.languageLocked = false;
      this.priorTurnsText = '';
      this.priorTurnsTokens = [];
      this.totalAudioSamples = 0;
      this.consecutiveSilentSamples = 0;
      this.baseCommittedTokens = [];
      this.isWindowSliding = false;
      this.samplesSinceLastInference = 0;
      this.hasUntranscribedTail = false;
      this.pendingTurnFlush = false;
      this.lastPartialTranscript = null;
      this.decoder.reset();
      for (const cb of this.listeners.final) {
        try { cb(fullRes); } catch (e) { this.emitError(e); }
      }
      return fullRes;
    }

    // Run final full-utterance closure decode when active audio buffer has speech
    if (this.audioBuffer.length >= 400) {
      const evalBuffer =
        !this.isWindowSliding &&
        this.baseCommittedTokens.length === 0 &&
        this.fullRecordingPcm.length >= this.audioBuffer.length
          ? this.fullRecordingPcm
          : this.isWindowSliding && this.audioBuffer.length > this.maxBufferSamples
            ? this.audioBuffer.slice(-this.maxBufferSamples)
            : this.audioBuffer;
      const tailRes = await (this.engine as any).transcribe(evalBuffer);
      if (tailRes?.tokens?.length > 0 || !(this.decoder as any).lastHypTokens?.length) {
        if (this.pendingTurnFlush && tailRes?.tokens?.length > 0) {
          this.promotePendingTurn();
        }
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
    }

    const streamingTokens = (this.decoder as any).lastHypTokens?.length
      ? [...(this.decoder as any).lastHypTokens]
      : this.decoder.getCommittedTokens();

    const inferenceMs = performance.now() - startInference;
    const finalSt = this.decoder.update(streamingTokens, true, durationMs, inferenceMs);

    this.audioBuffer = new Float32Array(0);
    this.pendingChunk = new Float32Array(0);
    this.fullRecordingPcm = new Float32Array(0);
    this.detectedLanguage = undefined;
    this.languageConfidence = undefined;
    this.languageLocked = false;
    this.priorTurnsText = '';
    this.priorTurnsTokens = [];
    this.totalAudioSamples = 0;
    this.consecutiveSilentSamples = 0;
    this.baseCommittedTokens = [];
    this.isWindowSliding = false;
    this.samplesSinceLastInference = 0;
    this.hasUntranscribedTail = false;
    this.pendingTurnFlush = false;
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

    const searchLimit = Math.max(this.baseCommittedTokens.length, committedTokens.length - 30);
    const activeCommLen = committedTokens.length - this.baseCommittedTokens.length;
    const minReqMatch = activeCommLen >= 2 ? 2 : 1;

    let bestOffset = committedTokens.length;
    let bestRawStart = 0;
    let bestMatchLen = 0;

    for (let rStart = 0; rStart < rawTokens.length; rStart++) {
      for (let j = searchLimit; j < committedTokens.length; j++) {
        let matchLen = 0;
        while (
          j + matchLen < committedTokens.length &&
          rStart + matchLen < rawTokens.length &&
          committedTokens[j + matchLen] === rawTokens[rStart + matchLen]
        ) {
          matchLen++;
        }
        if (
          j + matchLen === committedTokens.length &&
          matchLen >= minReqMatch &&
          matchLen > bestMatchLen
        ) {
          bestMatchLen = matchLen;
          bestOffset = j;
          bestRawStart = rStart;
        }
      }
    }

    if (bestMatchLen > 0) {
      return [bestOffset, bestRawStart];
    }

    // Near-suffix match (within 1 token of end when boundary token revised)
    for (let rStart = 0; rStart < rawTokens.length; rStart++) {
      for (let j = searchLimit; j < committedTokens.length; j++) {
        let matchLen = 0;
        while (
          j + matchLen < committedTokens.length &&
          rStart + matchLen < rawTokens.length &&
          committedTokens[j + matchLen] === rawTokens[rStart + matchLen]
        ) {
          matchLen++;
        }
        if (
          j + matchLen >= committedTokens.length - 1 &&
          matchLen >= 2 &&
          matchLen > bestMatchLen
        ) {
          bestMatchLen = matchLen;
          bestOffset = j;
          bestRawStart = rStart;
        }
      }
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
    this.pendingChunk = new Float32Array(0);
    this.fullRecordingPcm = new Float32Array(0);
    this.detectedLanguage = undefined;
    this.languageConfidence = undefined;
    this.languageLocked = false;
    this.priorTurnsText = '';
    this.priorTurnsTokens = [];
    this.totalAudioSamples = 0;
    this.consecutiveSilentSamples = 0;
    this.baseCommittedTokens = [];
    this.isFinished = false;
    this.isWindowSliding = false;
    this.samplesSinceLastInference = 0;
    this.hasUntranscribedTail = false;
    this.pendingTurnFlush = false;
    this.lastPartialTranscript = null;
    this.decoder.reset();
  }
}

// Alias for compatibility
export const SwanadaStreamSession = StreamingAcousticEngine;
