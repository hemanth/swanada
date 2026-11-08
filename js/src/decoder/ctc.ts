/**
 * CTC Acoustic Decoders: Exact Marginal Prefix Beam Search,
 * Trie-Guided English Lexical Beam Search, and Stateful Greedy Streaming.
 * Zero external dependencies. Browser & Node.js compatible.
 */

import { getEnLexicon, isEnPrefix, isEnWord } from './en_lexicon.ts';
import { detectIndicVocabLang, getIndicLexicon, scoreIndicWord } from './indic_lexicon.ts';
import { normalizeIndicText } from './normalizer.ts';
import type { NormalizeOptions } from './normalizer.ts';

const NEG_INF = -1.0e30;

const BRAHMIC_VIRAMAS = new Set<string>([
  '\u094d', '\u09cd', '\u0a4d', '\u0acd', '\u0b4d', '\u0bcd', '\u0c4d', '\u0ccd', '\u0d4d',
]);

const CTC_SHORT_A_VOWELS = new Set<string>([
  '\u0905', '\u0985', '\u0a05', '\u0a85', '\u0b05', '\u0b85', '\u0c05', '\u0c85', '\u0d05',
]);

const CTC_COMBINING_MARK_RE = /^\p{M}/u;

const CTC_PRIMARY_MATRA_RANGES: Array<[number, number]> = [
  [0x093e, 0x094c], [0x094e, 0x094f], [0x0962, 0x0963],
  [0x09be, 0x09c4], [0x09c7, 0x09c8], [0x09cb, 0x09cc], [0x09e2, 0x09e3],
  [0x0a3e, 0x0a42], [0x0a47, 0x0a48], [0x0a4b, 0x0a4c],
  [0x0abe, 0x0ac5], [0x0ac7, 0x0ac9], [0x0acb, 0x0acc], [0x0ae2, 0x0ae3],
  [0x0b3e, 0x0b44], [0x0b47, 0x0b48], [0x0b4b, 0x0b4c], [0x0b62, 0x0b63],
  [0x0bbe, 0x0bc2], [0x0bc6, 0x0bc8], [0x0bca, 0x0bcc],
  [0x0c3e, 0x0c44], [0x0c46, 0x0c48], [0x0c4a, 0x0c4c], [0x0c62, 0x0c63],
  [0x0cbe, 0x0cc4], [0x0cc6, 0x0cc8], [0x0cca, 0x0ccc], [0x0ce2, 0x0ce3],
  [0x0d3e, 0x0d44], [0x0d46, 0x0d48], [0x0d4a, 0x0d4c], [0x0d62, 0x0d63],
];

function ctcIsPrimaryMatra(ch: string): boolean {
  const cp = ch.charCodeAt(0);
  for (let i = 0; i < CTC_PRIMARY_MATRA_RANGES.length; i++) {
    const r = CTC_PRIMARY_MATRA_RANGES[i];
    if (cp >= r[0] && cp <= r[1]) return true;
  }
  return false;
}

function ctcIsBrahmicConsonant(ch: string): boolean {
  const cp = ch.charCodeAt(0);
  if (cp < 0x0900 || cp > 0x0d7f) return false;
  const off = cp & 0x7f;
  return (
    (off >= 0x15 && off <= 0x39) ||
    (off >= 0x58 && off <= 0x5f) ||
    off === 0x79 ||
    (off >= 0x7a && off <= 0x7f && (cp & ~0x7f) === 0x0d00)
  );
}

function ctcMatraToIndepVowel(mCh: string): string {
  const mCp = mCh.charCodeAt(0);
  const base = mCp & ~0x7f;
  const off = mCp & 0x7f;
  if (off === 0x44) return String.fromCharCode(base + 0x60);
  if (off === 0x62) return String.fromCharCode(base + 0x0c);
  if (off === 0x63) return String.fromCharCode(base + 0x61);
  return String.fromCharCode(mCp - 0x38);
}

function ctcExtendIndicState(
  lmScore: number,
  curWord: string,
  lastChar: string,
  piece: string,
  lang: string,
  coreSet: Set<string>,
  extSet: Set<string>
): [number, string, string] {
  let sc = lmScore;
  let cw = curWord;
  let lc = lastChar;

  for (let k = 0; k < piece.length; k++) {
    const ch = piece[k];
    if (ch === '\u2581' || ch === ' ' || ch === '\u2582' || ch === '\u2583') {
      if (cw.length > 0) {
        sc += scoreIndicWord(cw, lang, coreSet, extSet);
        cw = '';
      }
      lc = ' ';
      continue;
    }

    if (BRAHMIC_VIRAMAS.has(lc) && BRAHMIC_VIRAMAS.has(ch)) {
      if (!(k === 0 && piece.length >= 2 && ctcIsBrahmicConsonant(piece[1]))) {
        sc -= 4.20;
      }
      continue;
    }

    if (lc === ch && CTC_COMBINING_MARK_RE.test(ch)) {
      continue;
    }

    if (
      CTC_SHORT_A_VOWELS.has(ch) &&
      lc &&
      (ctcIsBrahmicConsonant(lc) || (ch === '\u0d05' && ctcIsPrimaryMatra(lc)))
    ) {
      sc += scoreIndicWord(cw, lang, coreSet, extSet);
      cw = ch;
      lc = ch;
      continue;
    }

    if (lc && lc !== ' ') {
      if (BRAHMIC_VIRAMAS.has(ch)) {
        if (ctcIsPrimaryMatra(lc)) {
          if (!(lc === '\u0d41' && ch === '\u0d4d')) {
            sc -= 4.20;
          }
        } else if (BRAHMIC_VIRAMAS.has(lc)) {
          sc -= 4.20;
        }
      } else if (ctcIsPrimaryMatra(ch)) {
        if (ctcIsPrimaryMatra(lc)) {
          sc -= 4.20;
        } else if (BRAHMIC_VIRAMAS.has(lc)) {
          if ((lc.charCodeAt(0) & ~0x7f) === (ch.charCodeAt(0) & ~0x7f)) {
            sc += 0.28 + scoreIndicWord(cw, lang, coreSet, extSet);
            const indep = ctcMatraToIndepVowel(ch);
            cw = indep;
            lc = indep;
            continue;
          }
        }
      } else if (ctcIsBrahmicConsonant(ch)) {
        if (BRAHMIC_VIRAMAS.has(lc)) {
          sc += 0.22;
        }
      }
    }

    cw += ch;
    lc = ch;
  }

  return [sc, cw, lc];
}

function ctcFinalizeIndicScore(
  lmScore: number,
  curWord: string,
  lang: string,
  coreSet: Set<string>,
  extSet: Set<string>,
  isPartial: boolean = false
): number {
  if (!curWord || isPartial) return lmScore;
  return lmScore + scoreIndicWord(curWord, lang, coreSet, extSet);
}

export interface CTCDecodeOptions extends NormalizeOptions {
  blankId?: number;            // Default: 0
  collapseRepeats?: boolean;   // Default: true
  skipSpecialTokens?: boolean; // Default: true (skips <unk>, <blank>, etc.)
  isPartial?: boolean;         // Default: false (active mid-stream chunk cut-edge)
}

export interface CTCDecodeResult {
  text: string;
  tokens: string[];
  tokenIds: number[];
}

interface BeamState {
  ids: number[];
  pb: number;
  pnb: number;
  lmScore: number;
  curWord: string;
  inPrefix: boolean;
  lastChar: string;
}

export function isSpecialToken(token: string): boolean {
  if (!token) return false;
  return (token.startsWith('<') && token.endsWith('>')) ||
         (token.startsWith('[') && token.endsWith(']'));
}

function logAddExp(a: number, b: number): number {
  if (a <= NEG_INF * 0.5) return b;
  if (b <= NEG_INF * 0.5) return a;
  if (a > b) {
    return a + Math.log1p(Math.exp(b - a));
  }
  return b + Math.log1p(Math.exp(a - b));
}

function isEnglishSentencePieceVocab(vocabList: string[]): boolean {
  if (vocabList.length < 200) return false;
  const end = Math.min(vocabList.length, 12);
  for (let idx = 2; idx < end; idx++) {
    const tok = vocabList[idx] || '';
    for (let k = 0; k < tok.length; k++) {
      const code = tok.charCodeAt(k);
      if (code >= 97 && code <= 122) return true;
    }
  }
  return false;
}

function stripTrailingApostrophes(word: string): string {
  let end = word.length;
  while (end > 0 && word.charCodeAt(end - 1) === 39) {
    end--;
  }
  return end === word.length ? word : word.slice(0, end);
}

function formatEnCtcDisplay(text: string): string {
  if (!text) return text;
  let out = text.replace(/^[a-z]/, (ch) => ch.toUpperCase());
  out = out.replace(/([.?!]\s+)([a-z])/g, (_m, p1, p2) => p1 + p2.toUpperCase());
  out = out.replace(/\bi(?=(?:['’](?:m|ve|ll|d))?\b)/g, 'I');
  return out;
}

function extendEnLexicalState(
  lmScore: number,
  curWord: string,
  inPrefix: boolean,
  piece: string,
  words: Set<string>,
  prefixes: Set<string>,
  nearCutEdge: boolean = false
): [number, string, boolean] {
  let sc = lmScore;
  let cw = curWord;
  let ip = inPrefix;

  for (let k = 0; k < piece.length; k++) {
    const ch = piece[k];
    const code = piece.charCodeAt(k);
    const isLower = code >= 97 && code <= 122;
    const isUpper = code >= 65 && code <= 90;
    if (isLower || isUpper || code === 39) {
      const lc = isUpper ? ch.toLowerCase() : ch;
      if (cw.length === 0 && code === 39) {
        continue;
      }
      const nextWord = cw + lc;
      if (ip && !isEnPrefix(nextWord, prefixes, words)) {
        ip = false;
        sc -= 2.85;
      }
      cw = nextWord;
    } else {
      if (nearCutEdge && (ch === '.' || ch === '?' || ch === '!')) {
        sc -= 2.60;
      }
      if (cw.length > 0) {
        const clean = stripTrailingApostrophes(cw);
        if (clean.length > 0) {
          if (isEnWord(clean, words)) {
            if (nearCutEdge && (ch === '.' || ch === '?' || ch === '!')) {
              sc += 0.35;
            } else {
              sc += clean.length >= 3 ? 2.55 : 0.85;
            }
          } else {
            sc += ip ? -4.75 : -1.90;
          }
        }
        cw = '';
        ip = true;
      }
    }
  }
  return [sc, cw, ip];
}

function finalizeEnLexicalScore(
  lmScore: number,
  curWord: string,
  inPrefix: boolean,
  words: Set<string>,
  isPartial: boolean = false
): number {
  if (curWord.length === 0) return lmScore;
  const clean = stripTrailingApostrophes(curWord);
  if (clean.length === 0) return lmScore;
  if (isEnWord(clean, words)) {
    if (isPartial) {
      return lmScore + (clean.length >= 4 ? 0.55 : 0.20);
    }
    return lmScore + (clean.length >= 3 ? 2.55 : 0.85);
  }
  if (inPrefix) return lmScore;
  return lmScore - 1.90;
}

function beamDecodeCTC(
  logits: Float32Array | number[],
  timeSteps: number,
  numClasses: number,
  vocabList: string[],
  skipSpecial: boolean,
  options?: CTCDecodeOptions
): CTCDecodeResult {
  const isEn = isEnglishSentencePieceVocab(vocabList);
  const isPartial = options?.isPartial === true;
  const beamWidth = isEn ? 14 : 12;
  const topK = Math.min(numClasses - 1, isEn ? 10 : 8);

  const lex = isEn ? getEnLexicon() : null;
  const enWords = lex ? lex.words : new Set<string>();
  const enPrefixes = lex ? lex.prefixes : new Set<string>();
  const indicLang = isEn ? 'en' : detectIndicVocabLang(vocabList);
  const indicLex = isEn ? null : getIndicLexicon(indicLang);
  const indicCore = indicLex ? indicLex.core : new Set<string>();
  const indicExt = indicLex ? indicLex.ext : new Set<string>();

  const lpRow = new Float64Array(numClasses);
  const topCols = new Int32Array(topK);
  const topVals = new Float64Array(topK);

  let beams = new Map<string, BeamState>();
  beams.set('', {
    ids: [],
    pb: 0.0,
    pnb: NEG_INF,
    lmScore: 0.0,
    curWord: '',
    inPrefix: true,
    lastChar: '',
  });

  for (let t = 0; t < timeSteps; t++) {
    const offset = t * numClasses;
    let rowMax = -Infinity;
    for (let c = 0; c < numClasses; c++) {
      const v = logits[offset + c];
      if (v > rowMax) rowMax = v;
    }
    let sumExp = 0.0;
    for (let c = 0; c < numClasses; c++) {
      sumExp += Math.exp(logits[offset + c] - rowMax);
    }
    const logZ = rowMax + Math.log(sumExp);

    const lpBlank = logits[offset] - logZ;
    lpRow[0] = lpBlank;

    let maxNonBlank = NEG_INF;
    for (let k = 0; k < topK; k++) {
      topVals[k] = NEG_INF;
      topCols[k] = 1;
    }

    for (let c = 1; c < numClasses; c++) {
      const lp = logits[offset + c] - logZ;
      lpRow[c] = lp;
      if (lp > maxNonBlank) maxNonBlank = lp;
      if (lp > topVals[topK - 1]) {
        let pos = topK - 1;
        while (pos > 0 && lp > topVals[pos - 1]) {
          topVals[pos] = topVals[pos - 1];
          topCols[pos] = topCols[pos - 1];
          pos--;
        }
        topVals[pos] = lp;
        topCols[pos] = c;
      }
    }

    // Fast-skip confident blank frames or flat uniform non-speech frames
    if (lpBlank > -0.02 || maxNonBlank < -4.2) {
      for (const state of beams.values()) {
        state.pb = logAddExp(state.pb, state.pnb) + lpBlank;
        state.pnb = NEG_INF;
      }
      continue;
    }

    const nextBeams = new Map<string, BeamState>();

    for (const [key, state] of beams.entries()) {
      const pb = state.pb;
      const pnb = state.pnb;
      const totalP = logAddExp(pb, pnb);

      // 1. Blank transition stays on `key`
      let nbCur = nextBeams.get(key);
      const newPb = totalP + lpBlank;
      if (nbCur === undefined) {
        nbCur = {
          ids: state.ids,
          pb: newPb,
          pnb: NEG_INF,
          lmScore: state.lmScore,
          curWord: state.curWord,
          inPrefix: state.inPrefix,
          lastChar: state.lastChar,
        };
        nextBeams.set(key, nbCur);
      } else {
        nbCur.pb = logAddExp(nbCur.pb, newPb);
      }

      // 2. Repeat of last token without blank collapses into `key`
      const lastTok = state.ids.length > 0 ? state.ids[state.ids.length - 1] : -1;
      if (lastTok > 0 && pnb > NEG_INF * 0.5) {
        nbCur.pnb = logAddExp(nbCur.pnb, pnb + lpRow[lastTok]);
      }

      // 3. Top-K non-blank token extensions
      for (let k = 0; k < topK; k++) {
        const c = topCols[k];
        const lpC = topVals[k];
        let extPnb: number;
        if (c === lastTok) {
          if (pb <= NEG_INF * 0.5) continue;
          extPnb = pb + lpC;
        } else {
          extPnb = totalP + lpC;
        }

        const newKey = key.length === 0 ? String(c) : `${key},${c}`;
        const nbExt = nextBeams.get(newKey);
        if (nbExt !== undefined) {
          nbExt.pnb = logAddExp(nbExt.pnb, extPnb);
        } else {
          let nLm = 0.0;
          let nW = '';
          let nIp = true;
          let nLc = '';
          let tokStr = c < vocabList.length ? vocabList[c] : '';
          if (skipSpecial && isSpecialToken(tokStr)) {
            tokStr = '';
          }
          if (isEn) {
            [nLm, nW, nIp] = extendEnLexicalState(
              state.lmScore,
              state.curWord,
              state.inPrefix,
              tokStr,
              enWords,
              enPrefixes,
              isPartial && t >= Math.max(0, timeSteps - 8)
            );
          } else {
            [nLm, nW, nLc] = ctcExtendIndicState(
              state.lmScore,
              state.curWord,
              state.lastChar,
              tokStr,
              indicLang,
              indicCore,
              indicExt
            );
          }
          nextBeams.set(newKey, {
            ids: [...state.ids, c],
            pb: NEG_INF,
            pnb: extPnb,
            lmScore: nLm,
            curWord: nW,
            inPrefix: nIp,
            lastChar: nLc,
          });
        }
      }
    }

    if (nextBeams.size > beamWidth) {
      const entries = Array.from(nextBeams.entries());
      if (isEn) {
        entries.sort((a, b) => {
          const wa = a[1].curWord;
          const pa = a[1].inPrefix
            ? (enWords.has(wa) ? (wa.length >= 4 ? 1.55 : 0.45) : (wa.length >= 2 ? 0.35 : 0.0))
            : 0.0;
          const wb = b[1].curWord;
          const pb = b[1].inPrefix
            ? (enWords.has(wb) ? (wb.length >= 4 ? 1.55 : 0.45) : (wb.length >= 2 ? 0.35 : 0.0))
            : 0.0;
          const sa = logAddExp(a[1].pb, a[1].pnb) + a[1].lmScore + pa;
          const sb = logAddExp(b[1].pb, b[1].pnb) + b[1].lmScore + pb;
          return sb - sa;
        });
      } else if (indicLang === 'ta') {
        entries.sort((a, b) => {
          const sa = logAddExp(a[1].pb, a[1].pnb) + a[1].lmScore;
          const sb = logAddExp(b[1].pb, b[1].pnb) + b[1].lmScore;
          return sb - sa;
        });
      } else {
        entries.sort((a, b) => {
          const wa = a[1].curWord;
          const pa = indicCore.has(wa) ? 1.65 : (wa.length >= 3 && indicExt.has(wa) ? 0.65 : 0.0);
          const wb = b[1].curWord;
          const pb = indicCore.has(wb) ? 1.65 : (wb.length >= 3 && indicExt.has(wb) ? 0.65 : 0.0);
          const sa = logAddExp(a[1].pb, a[1].pnb) + a[1].lmScore + pa;
          const sb = logAddExp(b[1].pb, b[1].pnb) + b[1].lmScore + pb;
          return sb - sa;
        });
      }
      beams = new Map<string, BeamState>();
      for (let idx = 0; idx < beamWidth; idx++) {
        beams.set(entries[idx][0], entries[idx][1]);
      }
    } else {
      beams = nextBeams;
    }
  }

  let bestIds: number[] = [];
  let bestScore = NEG_INF;
  for (const state of beams.values()) {
    const acScore = logAddExp(state.pb, state.pnb);
    const finalLm = isEn
      ? finalizeEnLexicalScore(state.lmScore, state.curWord, state.inPrefix, enWords, isPartial)
      : ctcFinalizeIndicScore(state.lmScore, state.curWord, indicLang, indicCore, indicExt, isPartial);
    const score = acScore + finalLm;
    if (score > bestScore) {
      bestScore = score;
      bestIds = state.ids;
    }
  }

  const tokens: string[] = [];
  for (let idx = 0; idx < bestIds.length; idx++) {
    const tid = bestIds[idx];
    const tok = tid < vocabList.length ? vocabList[tid] : undefined;
    if (tok !== undefined) {
      if (skipSpecial && isSpecialToken(tok)) {
        continue;
      }
      tokens.push(tok);
    }
  }

  const rawText = normalizeIndicText(tokens.join(''), options);
  const text = isEn && !isPartial ? formatEnCtcDisplay(rawText) : rawText;
  return { text, tokens, tokenIds: bestIds };
}

/**
 * Decode CTC logits using exact marginal / lexical prefix beam search on full
 * vocabularies and linear-time greedy decoding on compact/custom vocabularies.
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

  if (timeSteps === 0 || numClasses === 0 || logits.length < timeSteps * numClasses) {
    return { text: '', tokens: [], tokenIds: [] };
  }

  const blankId = options?.blankId ?? 0;
  const collapseRepeats = options?.collapseRepeats !== false;
  const skipSpecial = options?.skipSpecialTokens !== false;

  if (
    Array.isArray(vocab) &&
    vocab.length >= 200 &&
    blankId === 0 &&
    collapseRepeats &&
    numClasses === vocab.length
  ) {
    return beamDecodeCTC(logits, timeSteps, numClasses, vocab, skipSpecial, options);
  }

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
 * Decode from pre-computed argmax token sequences.
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
