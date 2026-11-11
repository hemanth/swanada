/**
 * Zero-Overhead 12-Language Spoken Language Identification (Auto-LID) &
 * Frame-Synchronous Indic+English Code-Switching on Shared `layer_norm_84` Features.
 *
 * 100% mathematical parity with `python/src/swanada/lid.py`.
 */

import { decodeCTC, isSpecialToken } from './ctc.ts';
import { getEnLexicon, isEnWord } from './en_lexicon.ts';
import { getIndicLexicon, scoreIndicWord } from './indic_lexicon.ts';
import { normalizeIndicText } from './normalizer.ts';

export const LID_LANGUAGES = [
  'sa', 'en', 'hi', 'kn', 'mr', 'bn', 'ta', 'te', 'ml', 'gu', 'pa', 'or',
] as const;

export const SLID_VERSION = 1;

const HI_MARKERS = new Set<string>([
  'है', 'हैं', 'था', 'थी', 'थे', 'में', 'को', 'का', 'की', 'के', 'से', 'पर',
  'और', 'नहीं', 'यह', 'वह', 'एक', 'तो', 'भी', 'कर', 'रहा', 'रही', 'रहे',
  'लिए', 'किया', 'गया', 'गई', 'अपने', 'देखो', 'कहा', 'होता', 'साहब', 'मुझे', 'हम',
]);

const MR_MARKERS = new Set<string>([
  'आहे', 'आहेत', 'नाही', 'मध्ये', 'ला', 'चा', 'ची', 'चे', 'च्या', 'वर',
  'आणि', 'पण', 'काय', 'मला', 'तुला', 'होता', 'होती', 'होते', 'आणखीही',
  'काही', 'हो', 'माझ्या', 'तुमच्या', 'केले', 'झाले', 'येथे', 'आता',
]);

const SA_MARKERS = new Set<string>([
  'च', 'एव', 'इति', 'अपि', 'अस्ति', 'भवति', 'तस्य', 'अत्र', 'तत्र', 'यथा',
  'तथा', 'अहं', 'वयम्', 'किम्', 'येन', 'तेन', 'ददाति', 'विषये', 'देहस्य',
]);

const SA_ENDINGS = ['म्', 'त्', 'न्', 'स्य', 'णां', 'नाम्', 'ेषु'];

const CODEMIX_AMBIGUOUS_EN = new Set<string>([
  'a', 'i', 'am', 'an', 'as', 'at', 'be', 'bi', 'bo', 'by', 'da', 'de', 'di',
  'do', 'ed', 'eh', 'el', 'em', 'en', 'er', 'es', 'et', 'ex', 'fa', 'go', 'ha',
  'he', 'hi', 'hm', 'ho', 'id', 'if', 'in', 'is', 'it', 'jo', 'ka', 'ki', 'ko',
  'la', 'li', 'lo', 'ma', 'me', 'mi', 'mm', 'mo', 'mu', 'my', 'na', 'ne', 'no',
  'nu', 'od', 'oe', 'of', 'oh', 'oi', 'ok', 'om', 'on', 'op', 'or', 'os', 'ow',
  'ox', 'oy', 'pa', 'pe', 'pi', 'po', 'qi', 're', 'sh', 'si', 'so', 'ta', 'te',
  'ti', 'to', 'uh', 'um', 'un', 'up', 'us', 'ut', 'we', 'wo', 'xi', 'xu', 'ya',
  'ye', 'yo', 'the', 'and', 'are', 'too', 'see', 'haa', 'tum', 'hum', 'hai',
  'ho', 'kar', 'par', 'aur', 'ek', 'ko', 'ki', 'ka', 'ke', 'se', 'ne', 'naa',
]);

const EN_VOWELS_RE = /[aeiouy]/;
const EN_CLEAN_RE = /[^a-z']/g;
const INDIC_STRIP_PUNCT_RE = /^[।॥,?!.'"\\-]+|[।॥,?!.'"\\-]+$/g;

export interface LinearHeadWeights {
  weight: Float32Array;
  bias: Float32Array;
}

export interface LanguageDetectionResult {
  language: string;
  confidence: number;
  probabilities: Record<string, number>;
  usedNeuralLid: boolean;
}

export interface CodeSwitchSpan {
  word: string;
  startChar: number;
  endChar: number;
}

export interface CodeSwitchDecodeResult {
  text: string;
  tokens: string[];
  englishSpans: CodeSwitchSpan[];
}

export interface NeuralLIDWeights {
  dIn: number;
  dAtt: number;
  dHid: number;
  languages: readonly string[];
  wAtt: Float32Array;    // [dIn * dAtt]
  bAtt: Float32Array;    // [dAtt]
  vAtt: Float32Array;    // [dAtt]
  lnGamma: Float32Array; // [2 * dIn]
  lnBeta: Float32Array;  // [2 * dIn]
  wFc1: Float32Array;    // [(2 * dIn) * dHid]
  bFc1: Float32Array;    // [dHid]
  wFc2: Float32Array;    // [dHid * nLangs]
  bFc2: Float32Array;    // [nLangs]
  temperature: number;
}

export function parseLidHeadBytes(buffer: ArrayBuffer | Uint8Array): NeuralLIDWeights {
  const bytes = buffer instanceof Uint8Array
    ? buffer
    : new Uint8Array(buffer);
  if (
    bytes.byteLength < 24 ||
    bytes[0] !== 0x53 || // 'S'
    bytes[1] !== 0x4c || // 'L'
    bytes[2] !== 0x49 || // 'I'
    bytes[3] !== 0x44    // 'D'
  ) {
    throw new Error("Invalid lid.bin header: expected magic 'SLID'");
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = dv.getUint32(4, true);
  const dIn = dv.getUint32(8, true);
  const dAtt = dv.getUint32(12, true);
  const dHid = dv.getUint32(16, true);
  const nLangs = dv.getUint32(20, true);
  if (version !== SLID_VERSION || nLangs !== LID_LANGUAGES.length) {
    throw new Error(`Unsupported lid.bin version=${version} or nLangs=${nLangs}`);
  }
  const dStats = 2 * dIn;
  const counts = [
    dIn * dAtt,
    dAtt,
    dAtt,
    dStats,
    dStats,
    dStats * dHid,
    dHid,
    dHid * nLangs,
    nLangs,
    1,
  ];
  let totalFloats = 0;
  for (let i = 0; i < counts.length; i++) totalFloats += counts[i];
  const expectedBytes = 24 + totalFloats * 4;
  if (bytes.byteLength < expectedBytes) {
    throw new Error(`Truncated lid.bin: got ${bytes.byteLength} bytes, expected ${expectedBytes}`);
  }

  const allFloats = new Float32Array(totalFloats);
  for (let i = 0; i < totalFloats; i++) {
    allFloats[i] = dv.getFloat32(24 + i * 4, true);
  }

  let pos = 0;
  const take = (n: number): Float32Array => {
    const out = allFloats.subarray(pos, pos + n);
    pos += n;
    return out;
  };

  const wAtt = take(dIn * dAtt);
  const bAtt = take(dAtt);
  const vAtt = take(dAtt);
  const lnGamma = take(dStats);
  const lnBeta = take(dStats);
  const wFc1 = take(dStats * dHid);
  const bFc1 = take(dHid);
  const wFc2 = take(dHid * nLangs);
  const bFc2 = take(nLangs);
  const temperature = take(1)[0];

  return {
    dIn,
    dAtt,
    dHid,
    languages: LID_LANGUAGES,
    wAtt,
    bAtt,
    vAtt,
    lnGamma,
    lnBeta,
    wFc1,
    bFc1,
    wFc2,
    bFc2,
    temperature,
  };
}

export function serializeLidHeadBytes(weights: NeuralLIDWeights): Uint8Array {
  const nLangs = weights.languages.length;
  const parts = [
    weights.wAtt,
    weights.bAtt,
    weights.vAtt,
    weights.lnGamma,
    weights.lnBeta,
    weights.wFc1,
    weights.bFc1,
    weights.wFc2,
    weights.bFc2,
    Float32Array.from([weights.temperature]),
  ];
  let totalFloats = 0;
  for (const p of parts) totalFloats += p.length;
  const out = new Uint8Array(24 + totalFloats * 4);
  out[0] = 0x53; out[1] = 0x4c; out[2] = 0x49; out[3] = 0x44;
  const dv = new DataView(out.buffer);
  dv.setUint32(4, SLID_VERSION, true);
  dv.setUint32(8, weights.dIn, true);
  dv.setUint32(12, weights.dAtt, true);
  dv.setUint32(16, weights.dHid, true);
  dv.setUint32(20, nLangs, true);
  let byteOff = 24;
  for (const p of parts) {
    for (let i = 0; i < p.length; i++) {
      dv.setFloat32(byteOff, p[i], true);
      byteOff += 4;
    }
  }
  return out;
}

export function predictNeuralLidLogProbs(
  weights: NeuralLIDWeights,
  hidden: Float32Array,
  timeSteps: number
): Record<string, number> {
  const nLangs = weights.languages.length;
  if (timeSteps <= 0 || hidden.length < timeSteps * weights.dIn) {
    const u = -Math.log(nLangs);
    const empty: Record<string, number> = {};
    for (const lg of weights.languages) empty[lg] = u;
    return empty;
  }

  const dIn = weights.dIn;
  const dAtt = weights.dAtt;
  const dHid = weights.dHid;
  const dStats = 2 * dIn;

  const norms = new Float32Array(timeSteps);
  let peakNorm = 0;
  for (let t = 0; t < timeSteps; t++) {
    let sq = 0;
    const off = t * dIn;
    for (let d = 0; d < dIn; d++) {
      const v = hidden[off + d];
      sq += v * v;
    }
    const nm = Math.sqrt(sq);
    norms[t] = nm;
    if (nm > peakNorm) peakNorm = nm;
  }

  const activeMask = new Uint8Array(timeSteps);
  let activeCount = 0;
  const thresh = peakNorm > 1e-6 ? 0.25 * peakNorm : -1;
  for (let t = 0; t < timeSteps; t++) {
    if (norms[t] >= thresh) {
      activeMask[t] = 1;
      activeCount++;
    }
  }
  if (activeCount === 0) activeMask.fill(1);

  const attScores = new Float64Array(timeSteps);
  let maxAtt = -Infinity;
  for (let t = 0; t < timeSteps; t++) {
    if (!activeMask[t]) {
      attScores[t] = -1e9;
      if (-1e9 > maxAtt) maxAtt = -1e9;
      continue;
    }
    const hOff = t * dIn;
    let dotV = 0;
    for (let a = 0; a < dAtt; a++) {
      let z = weights.bAtt[a];
      for (let d = 0; d < dIn; d++) {
        z += hidden[hOff + d] * weights.wAtt[d * dAtt + a];
      }
      dotV += Math.tanh(z) * weights.vAtt[a];
    }
    attScores[t] = dotV;
    if (dotV > maxAtt) maxAtt = dotV;
  }

  const alpha = new Float32Array(timeSteps);
  let alphaSum = 0;
  for (let t = 0; t < timeSteps; t++) {
    const e = Math.exp(attScores[t] - maxAtt);
    alpha[t] = e;
    alphaSum += e;
  }
  if (alphaSum <= 0 || !Number.isFinite(alphaSum)) {
    alpha.fill(1 / timeSteps);
  } else {
    for (let t = 0; t < timeSteps; t++) alpha[t] /= alphaSum;
  }

  const stats = new Float32Array(dStats);
  for (let t = 0; t < timeSteps; t++) {
    const w = alpha[t];
    const hOff = t * dIn;
    for (let d = 0; d < dIn; d++) {
      stats[d] += w * hidden[hOff + d];
    }
  }
  for (let t = 0; t < timeSteps; t++) {
    const w = alpha[t];
    const hOff = t * dIn;
    for (let d = 0; d < dIn; d++) {
      const diff = hidden[hOff + d] - stats[d];
      stats[dIn + d] += w * diff * diff;
    }
  }
  for (let d = 0; d < dIn; d++) {
    stats[dIn + d] = Math.sqrt(Math.max(stats[dIn + d], 1e-5));
  }

  let sMean = 0;
  for (let i = 0; i < dStats; i++) sMean += stats[i];
  sMean /= dStats;
  let sVar = 0;
  for (let i = 0; i < dStats; i++) {
    const df = stats[i] - sMean;
    sVar += df * df;
  }
  sVar /= dStats;
  const invStd = 1 / Math.sqrt(sVar + 1e-5);
  const sLn = new Float32Array(dStats);
  for (let i = 0; i < dStats; i++) {
    sLn[i] = ((stats[i] - sMean) * invStd) * weights.lnGamma[i] + weights.lnBeta[i];
  }

  const gelu = new Float32Array(dHid);
  for (let j = 0; j < dHid; j++) {
    let x1 = weights.bFc1[j];
    for (let i = 0; i < dStats; i++) {
      x1 += sLn[i] * weights.wFc1[i * dHid + j];
    }
    gelu[j] = 0.5 * x1 * (1 + Math.tanh(0.7978845608 * (x1 + 0.044715 * x1 * x1 * x1)));
  }

  const temp = Math.max(weights.temperature, 0.05);
  const logits = new Float64Array(nLangs);
  let maxL = -Infinity;
  for (let k = 0; k < nLangs; k++) {
    let z = weights.bFc2[k];
    for (let j = 0; j < dHid; j++) {
      z += gelu[j] * weights.wFc2[j * nLangs + k];
    }
    const scaled = z / temp;
    logits[k] = scaled;
    if (scaled > maxL) maxL = scaled;
  }

  let sumExp = 0;
  for (let k = 0; k < nLangs; k++) sumExp += Math.exp(logits[k] - maxL);
  const logZ = maxL + Math.log(sumExp);

  const out: Record<string, number> = {};
  for (let k = 0; k < nLangs; k++) {
    out[weights.languages[k]] = logits[k] - logZ;
  }
  return out;
}

export const predictLidLogProbs = predictNeuralLidLogProbs;

export function projectLinearHeadLogits(
  hidden: Float32Array,
  timeSteps: number,
  weight: Float32Array,
  bias: Float32Array
): Float32Array {
  const numClasses = 257;
  const dim = 512;
  const out = new Float32Array(timeSteps * numClasses);
  for (let t = 0; t < timeSteps; t++) {
    const hOff = t * dim;
    const oOff = t * numClasses;
    for (let c = 0; c < numClasses; c++) {
      const wOff = c * dim;
      let acc = bias[c];
      for (let d = 0; d < dim; d += 4) {
        acc +=
          hidden[hOff + d] * weight[wOff + d] +
          hidden[hOff + d + 1] * weight[wOff + d + 1] +
          hidden[hOff + d + 2] * weight[wOff + d + 2] +
          hidden[hOff + d + 3] * weight[wOff + d + 3];
      }
      out[oOff + c] = acc;
    }
  }
  return out;
}

function greedyCollapseText(logits: Float32Array, timeSteps: number, vocab: string[]): string {
  const numClasses = 257;
  let lastId = 0;
  const pieces: string[] = [];
  const vlen = vocab.length;
  for (let t = 0; t < timeSteps; t++) {
    const off = t * numClasses;
    let bestId = 0;
    let bestVal = logits[off];
    for (let c = 1; c < numClasses; c++) {
      if (logits[off + c] > bestVal) {
        bestVal = logits[off + c];
        bestId = c;
      }
    }
    if (bestId === 0) {
      lastId = 0;
      continue;
    }
    if (bestId === lastId) continue;
    lastId = bestId;
    if (bestId > 0 && bestId < vlen) {
      const tok = vocab[bestId];
      if (tok && !isSpecialToken(tok)) pieces.push(tok);
    }
  }
  return normalizeIndicText(pieces.join(''));
}

function countChar(s: string, ch: string): number {
  let c = 0;
  for (let i = 0; i < s.length; i++) if (s[i] === ch) c++;
  return c;
}

function scoreLexicalPlausibility(text: string, lang: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return -1.5;

  if (lang === 'en') {
    const { words: enWords } = getEnLexicon();
    let totalW = 0;
    let weightedHits = 0;
    for (const w of words) {
      const cw = w.toLowerCase().replace(EN_CLEAN_RE, '').replace(/^'+|'+$/g, '');
      if (!cw) continue;
      const wLen = Math.min(cw.length, 8);
      totalW += wLen;
      if (cw.length >= 3 && isEnWord(cw, enWords)) {
        weightedHits += wLen * 1.05;
      } else if (cw.length === 2 && isEnWord(cw, enWords)) {
        weightedHits += wLen * 0.55;
      } else if (cw === 'i' || cw === 'a') {
        weightedHits += 0.30;
      } else {
        const hasV = EN_VOWELS_RE.test(cw);
        weightedHits -= wLen * (hasV ? 0.55 : 1.10);
      }
    }
    if (totalW <= 0) return -1.2;
    return Math.max(-1.2, Math.min(1.05, weightedHits / totalW));
  }

  const { core, ext } = getIndicLexicon(lang);
  let totalW = 0;
  let acc = 0;
  for (const w of words) {
    const wClean = w.replace(INDIC_STRIP_PUNCT_RE, '');
    if (!wClean) continue;
    const cLen = Math.min(wClean.length, 8);
    totalW += cLen;
    const sc = scoreIndicWord(wClean, lang, core, ext);
    acc += sc * (cLen / 4.0);
  }

  let base = (acc / Math.max(totalW, 1.0)) * 2.2;
  if (lang === 'sa' || lang === 'hi' || lang === 'mr') {
    let hiHits = 0;
    let mrHits = countChar(text, '\u0933');
    let saHits = countChar(text, '\u0903') * 2 + countChar(text, '\u093d') * 2;
    for (const w of words) {
      if (HI_MARKERS.has(w)) hiHits++;
      if (MR_MARKERS.has(w)) mrHits++;
      if (SA_MARKERS.has(w)) saHits++;
      for (const suf of SA_ENDINGS) {
        if (w.endsWith(suf)) {
          saHits++;
          break;
        }
      }
    }
    const nW = Math.max(words.length, 1);
    if (lang === 'hi') {
      base += 0.75 * (hiHits / nW) - 0.45 * ((mrHits + saHits) / nW);
    } else if (lang === 'mr') {
      base += 0.80 * (mrHits / nW) - 0.45 * ((hiHits + saHits) / nW);
    } else if (lang === 'sa') {
      base += 0.75 * (saHits / nW) - 0.50 * ((hiHits + mrHits) / nW);
    }
  }
  return Math.max(-1.2, Math.min(1.15, base));
}

export function scoreCtcHeadEvidence(
  hidden: Float32Array,
  timeSteps: number,
  weight: Float32Array,
  bias: Float32Array,
  vocab: string[],
  lang: string
): { evidence: number; logits: Float32Array } {
  const logits = projectLinearHeadLogits(hidden, timeSteps, weight, bias);
  const numClasses = 257;
  if (timeSteps <= 0) return { evidence: -10.0, logits };

  const logP = new Float32Array(timeSteps * numClasses);
  const pNb = new Float32Array(timeSteps);
  let sumNb = 0;
  let activeCount = 0;

  for (let t = 0; t < timeSteps; t++) {
    const off = t * numClasses;
    let maxL = logits[off];
    for (let c = 1; c < numClasses; c++) {
      if (logits[off + c] > maxL) maxL = logits[off + c];
    }
    let sumExp = 0;
    for (let c = 0; c < numClasses; c++) {
      sumExp += Math.exp(logits[off + c] - maxL);
    }
    const logZ = maxL + Math.log(sumExp);
    for (let c = 0; c < numClasses; c++) {
      logP[off + c] = logits[off + c] - logZ;
    }
    const pb = Math.exp(logP[off]);
    const nb = Math.max(1e-6, Math.min(1.0, 1.0 - pb));
    pNb[t] = nb;
    sumNb += nb;
    if (nb > 0.20) activeCount++;
  }

  const meanNb = sumNb / timeSteps;
  let nbThreshold = 0.20;
  let useGe = false;
  if (activeCount < Math.max(2, Math.floor(timeSteps / 12))) {
    const sorted = Float32Array.from(pNb).sort();
    const q75 = sorted[Math.min(sorted.length - 1, Math.floor(0.75 * (sorted.length - 1)))];
    nbThreshold = Math.max(q75, 1e-4);
    useGe = true;
  }

  let sumCondPeak = 0;
  let sumCondNegEnt = 0;
  let usedFrames = 0;
  for (let t = 0; t < timeSteps; t++) {
    const nb = pNb[t];
    const isAct = useGe ? nb >= nbThreshold : nb > nbThreshold;
    if (!isAct) continue;
    usedFrames++;
    const logNb = Math.log(nb);
    const off = t * numClasses;
    let framePeak = -Infinity;
    let frameNegEnt = 0;
    for (let c = 1; c < numClasses; c++) {
      const clp = Math.max(-30.0, Math.min(0.0, logP[off + c] - logNb));
      if (clp > framePeak) framePeak = clp;
      frameNegEnt += Math.exp(clp) * clp;
    }
    sumCondPeak += framePeak;
    sumCondNegEnt += frameNegEnt;
  }

  const condPeak = usedFrames > 0 ? sumCondPeak / usedFrames : -5.5;
  const condNegEnt = usedFrames > 0 ? sumCondNegEnt / usedFrames : -5.5;
  const actPenalty = meanNb < 0.06 ? (-1.5 * Math.max(0, 0.06 - meanNb)) / 0.06 : 0.0;
  const greedyTxt = greedyCollapseText(logits, timeSteps, vocab);
  const lexSc = scoreLexicalPlausibility(greedyTxt, lang);
  const evidence = 1.35 * condPeak + 0.45 * condNegEnt + 0.85 * lexSc + actPenalty;
  return { evidence, logits };
}

export function detectLanguageFromHidden(
  hidden: Float32Array,
  timeSteps: number,
  heads: Record<string, LinearHeadWeights>,
  vocabs: Record<string, string[]>,
  lidWeights?: NeuralLIDWeights | null,
  candidateLanguages?: readonly string[]
): { result: LanguageDetectionResult; cachedLogits: Record<string, Float32Array> } {
  const cands = candidateLanguages || LID_LANGUAGES;
  const avail = cands.filter((lg) => Boolean(heads[lg]) && Boolean(vocabs[lg]));
  if (avail.length === 0) {
    return {
      result: { language: 'sa', confidence: 1.0, probabilities: { sa: 1.0 }, usedNeuralLid: false },
      cachedLogits: {},
    };
  }

  let neuralLp: Record<string, number> | null = null;
  let evalLangs = [...avail];
  if (lidWeights) {
    neuralLp = predictNeuralLidLogProbs(lidWeights, hidden, timeSteps);
    const ranked = [...avail].sort((a, b) => (neuralLp![b] ?? -20) - (neuralLp![a] ?? -20));
    const shortlist = ranked.slice(0, Math.min(8, ranked.length));
    if (avail.includes('en') && !shortlist.includes('en')) {
      shortlist.push('en');
    }
    evalLangs = shortlist;
  }

  const ctcScores: Record<string, number> = {};
  const cachedLogits: Record<string, Float32Array> = {};
  let minCtc = Infinity;
  for (const lg of evalLangs) {
    const h = heads[lg];
    const { evidence, logits } = scoreCtcHeadEvidence(hidden, timeSteps, h.weight, h.bias, vocabs[lg], lg);
    ctcScores[lg] = evidence;
    cachedLogits[lg] = logits;
    if (evidence < minCtc) minCtc = evidence;
  }
  if (!Number.isFinite(minCtc)) minCtc = -5.0;

  const combined: Record<string, number> = {};
  let temp = 0.28;
  if (neuralLp) {
    for (const lg of avail) {
      const nlp = neuralLp[lg] ?? -12.0;
      const cev = ctcScores[lg] ?? (minCtc - 1.5);
      combined[lg] = 0.50 * nlp + 1.65 * cev;
    }
    temp = 0.65;
  } else {
    for (const lg of avail) {
      combined[lg] = ctcScores[lg] ?? -10.0;
    }
  }

  let maxS = -Infinity;
  for (const lg of avail) {
    if (combined[lg] > maxS) maxS = combined[lg];
  }
  const exps: Record<string, number> = {};
  let z = 0;
  for (const lg of avail) {
    const e = Math.exp((combined[lg] - maxS) / temp);
    exps[lg] = e;
    z += e;
  }
  if (z <= 0) z = 1.0;

  const probabilities: Record<string, number> = {};
  let bestLang = avail[0];
  let bestProb = -1;
  for (const lg of avail) {
    const p = exps[lg] / z;
    probabilities[lg] = p;
    if (p > bestProb) {
      bestProb = p;
      bestLang = lg;
    }
  }

  return {
    result: {
      language: bestLang,
      confidence: bestProb,
      probabilities,
      usedNeuralLid: Boolean(neuralLp),
    },
    cachedLogits,
  };
}

function extractCtcWordSpans(
  logits: Float32Array,
  timeSteps: number,
  vocab: string[]
): Array<{ text: string; startFrame: number; endFrame: number }> {
  const numClasses = 257;
  const vlen = vocab.length;
  const words: Array<{ text: string; startFrame: number; endFrame: number }> = [];
  let curChars: string[] = [];
  let curStart = -1;
  let curEnd = 0;
  let lastId = 0;

  for (let t = 0; t < timeSteps; t++) {
    const off = t * numClasses;
    let idx = 0;
    let bestVal = logits[off];
    for (let c = 1; c < numClasses; c++) {
      if (logits[off + c] > bestVal) {
        bestVal = logits[off + c];
        idx = c;
      }
    }
    if (idx === 0) {
      lastId = 0;
      continue;
    }
    if (idx === lastId) {
      curEnd = t + 1;
      continue;
    }
    lastId = idx;
    if (idx <= 0 || idx >= vlen) continue;
    const tok = vocab[idx];
    if (!tok || isSpecialToken(tok)) continue;

    if (tok.startsWith('\u2581') || tok === ' ') {
      if (curChars.length > 0 && curStart >= 0) {
        const wTxt = normalizeIndicText(curChars.join('')).trim();
        if (wTxt) {
          words.push({ text: wTxt, startFrame: curStart, endFrame: Math.max(curEnd, curStart + 1) });
        }
        curChars = [];
        curStart = -1;
      }
      const rest = tok.replace(/^[\u2581 ]+/, '');
      if (rest) {
        curChars.push(rest);
        curStart = t;
        curEnd = t + 1;
      }
    } else {
      if (curStart < 0) curStart = t;
      curChars.push(tok);
      curEnd = t + 1;
    }
  }

  if (curChars.length > 0 && curStart >= 0) {
    const wTxt = normalizeIndicText(curChars.join('')).trim();
    if (wTxt) {
      words.push({ text: wTxt, startFrame: curStart, endFrame: Math.max(curEnd, curStart + 1) });
    }
  }
  return words;
}

function spanConditionalCertainty(logits: Float32Array, startFrame: number, endFrame: number): number {
  const numClasses = 257;
  if (endFrame <= startFrame) return -10.0;
  let sumPeak = 0;
  let used = 0;
  for (let t = startFrame; t < endFrame; t++) {
    const off = t * numClasses;
    let maxL = logits[off];
    for (let c = 1; c < numClasses; c++) {
      if (logits[off + c] > maxL) maxL = logits[off + c];
    }
    let sumExp = 0;
    for (let c = 0; c < numClasses; c++) sumExp += Math.exp(logits[off + c] - maxL);
    const logZ = maxL + Math.log(sumExp);
    const pNb = Math.max(1e-6, Math.min(1.0, 1.0 - Math.exp(logits[off] - logZ)));
    if (pNb <= 0.18) continue;
    let peak = -Infinity;
    for (let c = 1; c < numClasses; c++) {
      const lp = logits[off + c] - logZ;
      if (lp > peak) peak = lp;
    }
    sumPeak += peak;
    used++;
  }
  return used > 0 ? sumPeak / used : -5.0;
}

export function decodeBilingualCodeswitch(
  logitsIndic: Float32Array,
  timeSteps: number,
  vocabIndic: string[],
  langIndic: string,
  logitsEn: Float32Array,
  vocabEn: string[],
  isPartial: boolean = false
): CodeSwitchDecodeResult {
  const numClasses = 257;
  const baseRes = decodeCTC(
    logitsIndic,
    [timeSteps, numClasses],
    vocabIndic,
    isPartial ? { isPartial: true } : undefined
  );
  if (langIndic === 'en' || timeSteps < 4 || !baseRes.text) {
    return { text: baseRes.text, tokens: baseRes.tokens, englishSpans: [] };
  }

  const spans = extractCtcWordSpans(logitsIndic, timeSteps, vocabIndic);
  const baseWords = baseRes.text.split(/\s+/).filter(Boolean);
  if (spans.length === 0 || spans.length !== baseWords.length) {
    return { text: baseRes.text, tokens: baseRes.tokens, englishSpans: [] };
  }

  const { core, ext } = getIndicLexicon(langIndic);
  const { words: enLexWords } = getEnLexicon();
  const outWords: string[] = [];
  const englishSpans: CodeSwitchSpan[] = [];
  let cursor = 0;

  for (let i = 0; i < spans.length; i++) {
    const sp = spans[i];
    const wInd = baseWords[i];
    let chosen = wInd;
    let isEnSwap = false;

    const prevEnd = i > 0 ? spans[i - 1].endFrame : 0;
    const nextStart = i + 1 < spans.length ? spans[i + 1].startFrame : timeSteps;
    const s0 = Math.max(prevEnd, sp.startFrame - 4);
    const s1 = Math.min(nextStart, sp.endFrame + 6);
    const wIndClean = wInd.replace(INDIC_STRIP_PUNCT_RE, '');
    const indLexSc = wIndClean ? scoreIndicWord(wIndClean, langIndic, core, ext) : 0.0;
    if (s1 - s0 >= 3 && indLexSc <= 0.05) {
      const sliceLen = s1 - s0;
      const subSlice = logitsEn.subarray(s0 * numClasses, s1 * numClasses);
      const enSubRes = decodeCTC(subSlice, [sliceLen, numClasses], vocabEn, { isPartial: true });
      const enWords = enSubRes.text
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .map((u) => u.replace(EN_CLEAN_RE, '').replace(/^'+|'+$/g, ''))
        .filter(Boolean);

      if (
        enWords.length === 1 &&
        enWords[0].length >= 4 &&
        !CODEMIX_AMBIGUOUS_EN.has(enWords[0]) &&
        isEnWord(enWords[0], enLexWords) &&
        EN_VOWELS_RE.test(enWords[0])
      ) {
        const certInd = spanConditionalCertainty(logitsIndic, s0, s1);
        const certEn = spanConditionalCertainty(logitsEn, s0, s1);
        if (certEn >= certInd + 0.08 && certEn > -0.85) {
          chosen = enWords[0];
          isEnSwap = true;
        }
      }
    }

    if (i > 0) cursor += 1;
    const startChar = cursor;
    cursor += chosen.length;
    if (isEnSwap) {
      englishSpans.push({ word: chosen, startChar, endChar: cursor });
    }
    outWords.push(chosen);
  }

  return {
    text: outWords.join(' '),
    tokens: baseRes.tokens,
    englishSpans,
  };
}
