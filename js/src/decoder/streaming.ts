/**
 * StreamingCTCDecoder: Stabilized Prefix-Locking Streaming CTC Decoder.
 * Decouples committed prefix from volatile suffix to guarantee 0.00% character churn
 * on confirmed text and prevent boundary token flicker in real-time UI display.
 */

import { normalizeIndicText, joinSubwords } from './normalizer.ts';
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
  requireStabilityOnWordBoundary?: boolean; // Default: false
  highStabilityThreshold?: number; // Consecutive chunk matches to lock without boundary (Default: 4)
}

function isEnVocab(vocab: string[] | Record<number, string>): boolean {
  if (!Array.isArray(vocab) || vocab.length < 200) return false;
  const end = Math.min(vocab.length, 12);
  for (let idx = 2; idx < end; idx++) {
    const tok = vocab[idx] || '';
    for (let k = 0; k < tok.length; k++) {
      const code = tok.charCodeAt(k);
      if (code >= 97 && code <= 122) return true;
    }
  }
  return false;
}

function formatEnDisplay(text: string): string {
  if (!text) return text;
  let out = text.replace(/^[a-z]/, (ch) => ch.toUpperCase());
  out = out.replace(/([.?!]\s+)([a-z])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase());
  out = out.replace(/\bi(?=(?:['’](?:m|ve|ll|d))?\b)/g, 'I');
  return out;
}

export class StreamingCTCDecoder {
  private vocab: string[] | Record<number, string>;
  private options: StreamingDecoderOptions;
  private blankId: number;
  private stabilityThreshold: number;
  private trailTokens: number;
  private requireStabilityOnWordBoundary: boolean;
  private highStabilityThreshold: number;
  private isEnglish: boolean;

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
    this.highStabilityThreshold = this.options.highStabilityThreshold ?? 4;
    this.isEnglish = isEnVocab(vocab);
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
      const normText = normalizeIndicText(allTokens.join(''), this.options);
      const fullText = this.isEnglish ? formatEnDisplay(normText) : normText;
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

    // 1. Compute contiguous stable run from alreadyCommitted
    let stableLimit = alreadyCommitted;
    while (
      stableLimit < lockableLimit &&
      (this.tokenStabilityCounts[stableLimit] || 0) >= this.stabilityThreshold
    ) {
      stableLimit++;
    }

    // 2. Strict word-boundary-gated commitment
    let commitIdx = alreadyCommitted;
    if (stableLimit > alreadyCommitted) {
      let closedWordEnd = alreadyCommitted;
      let hasBoundaryAhead = false;

      for (let j = alreadyCommitted + 1; j < rawTokens.length; j++) {
        const tok = rawTokens[j];
        const isBoundary =
          tok &&
          (tok.startsWith('\u2581') ||
            tok.startsWith('\u2582') ||
            tok.startsWith('\u2583') ||
            tok.startsWith('▁') ||
            tok.startsWith(' ') ||
            tok.startsWith('\t'));

        if (isBoundary) {
          hasBoundaryAhead = true;
          const jStable = this.requireStabilityOnWordBoundary
            ? (this.tokenStabilityCounts[j] || 0) >= this.stabilityThreshold
            : true;
          if (j <= stableLimit && jStable) {
            closedWordEnd = j;
          } else {
            break;
          }
        }
      }

      if (hasBoundaryAhead) {
        commitIdx = closedWordEnd;
      } else {
        // Fallback for continuous compound words without word boundaries
        for (let i = alreadyCommitted; i < stableLimit; i++) {
          if ((this.tokenStabilityCounts[i] || 0) >= this.highStabilityThreshold) {
            commitIdx = i + 1;
          } else {
            break;
          }
        }
      }
    }

    // Guard: never advance commitIdx to leave only whitespace in volatileTokens,
    // violate strict prefix monotonicity on committedText, or split mid-sandhi.
    const prevRawComm = alreadyCommitted > 0
      ? normalizeIndicText(this.committedTokens.join(''), this.options)
      : '';
    const fullNormCheck = normalizeIndicText(rawTokens.join(''), this.options);
    while (commitIdx > alreadyCommitted) {
      const candPrefix = normalizeIndicText(rawTokens.slice(0, commitIdx).join(''), this.options);
      if (
        normalizeIndicText(rawTokens.slice(commitIdx).join(''), this.options) === '' ||
        !fullNormCheck.startsWith(candPrefix) ||
        (prevRawComm && !candPrefix.startsWith(prevRawComm)) ||
        (candPrefix.endsWith('\u0c21\u0c02') && rawTokens.length - commitIdx < 7)
      ) {
        commitIdx--;
      } else {
        break;
      }
    }

    // 3. Commit confirmed tokens
    for (let i = alreadyCommitted; i < commitIdx; i++) {
      this.committedTokens.push(rawTokens[i]);
    }

    this.lastHypTokens = [...rawTokens];

    const rawCommittedStr = normalizeIndicText(this.committedTokens.join(''), this.options);
    const committedStr = this.isEnglish ? formatEnDisplay(rawCommittedStr) : rawCommittedStr;
    this.committedText = committedStr;

    const volatileTokens = rawTokens.slice(this.committedTokens.length);
    let volatileStr = normalizeIndicText(volatileTokens.join(''), this.options);
    if (this.isEnglish && volatileStr) {
      if (!committedStr) {
        volatileStr = formatEnDisplay(volatileStr);
      } else {
        volatileStr = volatileStr.replace(/\bi(?=(?:['’](?:m|ve|ll|d))?\b)/g, 'I');
        if (/[.?!]\s*$/.test(committedStr)) {
          volatileStr = volatileStr.replace(/^[a-z]/, (ch) => ch.toUpperCase());
        }
      }
    }

    const rawFullText = joinSubwords(committedStr, volatileStr, volatileTokens, this.options);
    const fullText = this.isEnglish ? formatEnDisplay(rawFullText) : rawFullText;

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
