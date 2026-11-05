/**
 * Linear-time O(T * V) Greedy CTC Decoder.
 * Zero external dependencies. Browser & Node.js compatible.
 */

import { normalizeIndicText } from './normalizer.ts';
import type { NormalizeOptions } from './normalizer.ts';

export interface CTCDecodeOptions extends NormalizeOptions {
  blankId?: number;            // Default: 0
  collapseRepeats?: boolean;   // Default: true
  skipSpecialTokens?: boolean; // Default: true (skips <unk>, <blank>, etc.)
}

export interface CTCDecodeResult {
  text: string;
  tokens: string[];
  tokenIds: number[];
}

export function isSpecialToken(token: string): boolean {
  if (!token) return false;
  return (token.startsWith('<') && token.endsWith('>')) ||
         (token.startsWith('[') && token.endsWith(']'));
}

/**
 * Linear-time greedy CTC decoding over logits or log-probabilities.
 *
 * @param logits 1D Float32Array or number[] of shape [timeSteps * numClasses]
 * @param dims [timeSteps, numClasses] or [batch, timeSteps, numClasses]
 * @param vocab Array or map of token strings
 * @param options Decoding configuration
 */
export function decodeCTC(
  logits: Float32Array | number[],
  dims: number[],
  vocab: string[] | Record<number, string>,
  options?: CTCDecodeOptions
): CTCDecodeResult {
  const timeSteps = dims.length === 3 ? dims[1] : (dims.length === 2 ? dims[0] : 0);
  const numClasses = dims.length === 3 ? dims[2] : (dims.length === 2 ? dims[1] : 0);

  if (timeSteps === 0 || numClasses === 0) {
    return { text: '', tokens: [], tokenIds: [] };
  }

  const blankId = options?.blankId ?? 0;
  const collapseRepeats = options?.collapseRepeats !== false;
  const skipSpecial = options?.skipSpecialTokens !== false;

  let lastTokenId = blankId;
  const tokenIds: number[] = [];
  const tokens: string[] = [];

  for (let t = 0; t < timeSteps; t++) {
    const offset = t * numClasses;
    let maxVal = -Infinity;
    let argmax = 0;

    for (let c = 0; c < numClasses; c++) {
      const val = logits[offset + c];
      if (val > maxVal) {
        maxVal = val;
        argmax = c;
      }
    }

    if (argmax === blankId) {
      lastTokenId = blankId;
      continue;
    }

    if (collapseRepeats && argmax === lastTokenId) {
      continue;
    }

    lastTokenId = argmax;
    tokenIds.push(argmax);

    const tok = Array.isArray(vocab) ? vocab[argmax] : (vocab as Record<number, string>)[argmax];
    if (tok !== undefined) {
      if (skipSpecial && isSpecialToken(tok)) {
        continue;
      }
      tokens.push(tok);
    }
  }

  const text = normalizeIndicText(tokens.join(''), options);
  return { text, tokens, tokenIds };
}

/**
 * Decode from pre-computed argmax token IDs.
 */
export function decodeCTCTokens(
  tokenIds: number[],
  vocab: string[] | Record<number, string>,
  options?: CTCDecodeOptions
): CTCDecodeResult {
  const blankId = options?.blankId ?? 0;
  const collapseRepeats = options?.collapseRepeats !== false;
  const skipSpecial = options?.skipSpecialTokens !== false;

  let lastTokenId = blankId;
  const emittedIds: number[] = [];
  const tokens: string[] = [];

  for (const id of tokenIds) {
    if (id === blankId) {
      lastTokenId = blankId;
      continue;
    }

    if (collapseRepeats && id === lastTokenId) {
      continue;
    }

    lastTokenId = id;
    emittedIds.push(id);

    const tok = Array.isArray(vocab) ? vocab[id] : (vocab as Record<number, string>)[id];
    if (tok !== undefined) {
      if (skipSpecial && isSpecialToken(tok)) {
        continue;
      }
      tokens.push(tok);
    }
  }

  const text = normalizeIndicText(tokens.join(''), options);
  return { text, tokens, tokenIds: emittedIds };
}

/**
 * Stateful CTC Greedy Decoder for Streaming ASR across chunk boundaries.
 * Preserves lastTokenId across chunks to prevent duplicate character emissions at boundaries.
 */
export class CTCGreedyDecoder {
  private vocab: string[] | Record<number, string>;
  private options: CTCDecodeOptions;
  private blankId: number;
  private lastTokenId: number;

  constructor(
    vocab: string[] | Record<number, string>,
    options?: CTCDecodeOptions
  ) {
    this.vocab = vocab;
    this.options = options ?? {};
    this.blankId = this.options.blankId ?? 0;
    this.lastTokenId = this.blankId;
  }

  reset(): void {
    this.lastTokenId = this.blankId;
  }

  decodeChunk(logits: Float32Array | number[], dims: number[]): CTCDecodeResult {
    const timeSteps = dims.length === 3 ? dims[1] : (dims.length === 2 ? dims[0] : 0);
    const numClasses = dims.length === 3 ? dims[2] : (dims.length === 2 ? dims[1] : 0);

    if (timeSteps === 0 || numClasses === 0) {
      return { text: '', tokens: [], tokenIds: [] };
    }

    const collapseRepeats = this.options.collapseRepeats !== false;
    const skipSpecial = this.options.skipSpecialTokens !== false;

    const tokenIds: number[] = [];
    const tokens: string[] = [];

    for (let t = 0; t < timeSteps; t++) {
      const offset = t * numClasses;
      let maxVal = -Infinity;
      let argmax = 0;

      for (let c = 0; c < numClasses; c++) {
        const val = logits[offset + c];
        if (val > maxVal) {
          maxVal = val;
          argmax = c;
        }
      }

      if (argmax === this.blankId) {
        this.lastTokenId = this.blankId;
        continue;
      }

      if (collapseRepeats && argmax === this.lastTokenId) {
        continue;
      }

      this.lastTokenId = argmax;
      tokenIds.push(argmax);

      const tok = Array.isArray(this.vocab) ? this.vocab[argmax] : (this.vocab as Record<number, string>)[argmax];
      if (tok !== undefined) {
        if (skipSpecial && isSpecialToken(tok)) {
          continue;
        }
        tokens.push(tok);
      }
    }

    const text = normalizeIndicText(tokens.join(''), this.options);
    return { text, tokens, tokenIds };
  }

  decode(logits: Float32Array | number[], dims: number[]): CTCDecodeResult {
    this.reset();
    return this.decodeChunk(logits, dims);
  }
}
