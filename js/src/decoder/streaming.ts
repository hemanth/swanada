/**
 * StreamingCTCDecoder: Stabilized Prefix-Locking Streaming CTC Decoder.
 * Decouples committed prefix from volatile suffix to guarantee 0.00% character churn
 * on confirmed text and prevent boundary token flicker in real-time UI display.
 */

import { normalizeIndicText } from './normalizer.ts';
import type { NormalizeOptions } from './normalizer.ts';

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

export interface StreamingDecoderOptions extends NormalizeOptions {
  blankId?: number;             // Default: 0
  stabilityThreshold?: number;  // Consecutive chunk matches to lock (Default: 2)
  trailTokens?: number;         // Minimum uncommitted trailing tokens (Default: 3)
  spaceMarker?: string;         // Default: '\u2581'
  requireStabilityOnWordBoundary?: boolean; // Require >=2 matches even when space ahead
}

export class StreamingCTCDecoder {
  private vocab: string[] | Record<number, string>;
  private options: StreamingDecoderOptions;
  private blankId: number;
  private stabilityThreshold: number;
  private trailTokens: number;
  private requireStabilityOnWordBoundary: boolean;

  private committedTokens: string[] = [];
  private committedText: string = '';
  private lastHypTokens: string[] = [];
  private tokenStabilityCounts: number[] = [];

  constructor(
    vocab: string[] | Record<number, string>,
    options?: StreamingDecoderOptions
  ) {
    this.vocab = vocab;
    this.options = options ?? {};
    this.blankId = this.options.blankId ?? 0;
    this.stabilityThreshold = this.options.stabilityThreshold ?? 2;
    this.trailTokens = this.options.trailTokens ?? 3;
    this.requireStabilityOnWordBoundary = this.options.requireStabilityOnWordBoundary ?? false;
  }

  reset(): void {
    this.committedTokens = [];
    this.committedText = '';
    this.lastHypTokens = [];
    this.tokenStabilityCounts = [];
  }

  getCommittedText(): string {
    return this.committedText;
  }

  getCommittedTokens(): string[] {
    return [...this.committedTokens];
  }

  /**
   * Decodes a frame argmax token sequence and applies prefix locking.
   *
   * @param rawTokens Array of decoded subword/character tokens
   * @param isStreamEnd True if audio stream has ended (flushes all tokens to committed)
   * @param durationMs Processed audio duration in milliseconds
   * @param inferenceMs Cumulative or chunk inference duration in milliseconds
   */
  update(
    rawTokens: string[],
    isStreamEnd: boolean = false,
    durationMs: number = 0,
    inferenceMs: number = 0,
    allowCommit: boolean = true
  ): StreamingTranscript {
    if (isStreamEnd) {
      let allTokens: string[];
      if (rawTokens.length > this.committedTokens.length) {
        allTokens = [...this.committedTokens, ...rawTokens.slice(this.committedTokens.length)];
      } else {
        allTokens = this.committedTokens.length > 0 ? [...this.committedTokens] : [...rawTokens];
      }
      const fullText = normalizeIndicText(allTokens.join(''), this.options);
      this.reset();
      const rtf = durationMs > 0 ? inferenceMs / durationMs : 0;
      return {
        text: fullText,
        committed: fullText,
        volatile: '',
        isFinal: true,
        tokens: allTokens,
        durationMs,
        inferenceMs,
        rtf,
      };
    }

    // Determine common prefix length between last hypothesis and current rawTokens
    let commonPrefixLen = 0;
    const minLen = Math.min(this.lastHypTokens.length, rawTokens.length);
    while (
      commonPrefixLen < minLen &&
      this.lastHypTokens[commonPrefixLen] === rawTokens[commonPrefixLen]
    ) {
      commonPrefixLen++;
    }

    // Update stability counts for each token in current hypothesis
    const newStability: number[] = [];
    for (let i = 0; i < rawTokens.length; i++) {
      if (i < commonPrefixLen) {
        newStability[i] = (this.tokenStabilityCounts[i] || 0) + 1;
      } else {
        newStability[i] = 1;
      }
    }
    this.tokenStabilityCounts = newStability;

    // Tokens beyond already committed and before the trailing guard zone are lockable
    const lockableLimit = allowCommit ? Math.max(0, rawTokens.length - this.trailTokens) : 0;
    const alreadyCommitted = this.committedTokens.length;

    for (let i = alreadyCommitted; i < lockableLimit; i++) {
      // Check if a space / word boundary appears ahead in the rawTokens
      const isWordBoundaryAhead = rawTokens.slice(i + 1).some(
        (tok) => tok.startsWith('\u2581') || tok.startsWith('▁')
      );
      const count = this.tokenStabilityCounts[i] || 0;
      const isStable = count >= this.stabilityThreshold;
      const boundaryAllowed = isWordBoundaryAhead && (!this.requireStabilityOnWordBoundary || count >= 2);

      if (boundaryAllowed || isStable) {
        this.committedTokens.push(rawTokens[i]);
      } else {
        break;
      }
    }

    this.lastHypTokens = [...rawTokens];

    const committedStr = normalizeIndicText(this.committedTokens.join(''), this.options);
    this.committedText = committedStr;

    const volatileTokens = rawTokens.slice(this.committedTokens.length);
    const volatileStr = normalizeIndicText(volatileTokens.join(''), this.options);

    const fullText = committedStr && volatileStr
      ? `${committedStr} ${volatileStr}`.trim()
      : (committedStr || volatileStr);

    const rtf = durationMs > 0 ? inferenceMs / durationMs : 0;

    return {
      text: fullText,
      committed: committedStr,
      volatile: volatileStr,
      isFinal: false,
      tokens: rawTokens,
      durationMs,
      inferenceMs,
      rtf,
    };
  }
}
