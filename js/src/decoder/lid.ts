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

const EN_PHRASE_FUNC_WORDS = new Set<string>([
  'the', 'was', 'were', 'are', 'is', 'am', 'be', 'been', 'to', 'of', 'in',
  'on', 'at', 'for', 'with', 'from', 'by', 'and', 'or', 'but', 'not', 'this',
  'that', 'these', 'those', 'my', 'our', 'your', 'his', 'her', 'their', 'its',
  'us', 'we', 'you', 'they', 'he', 'she', 'it', 'can', 'will', 'just', 'now',
  'new', 'all', 'out', 'up', 'let',
]);

const EN_SAFE_SHORT_WORDS = new Set<string>([
  'app', 'api', 'web', 'net', 'cpu', 'gpu', 'ram', 'sql', 'cli', 'git', 'sdk',
  'url', 'pdf', 'csv', 'xml', 'css', 'aws', 'gcp', 'llm', 'ios', 'mac', 'pro',
  'fix', 'bug', 'log', 'run', 'try', 'add', 'set', 'get', 'put', 'job',
  'bus', 'car', 'cab', 'gym', 'tax', 'fee', 'pay', 'buy', 'win',
]);

const INDIAN_EN_LOANWORD_FIXES: Record<string, string> = {
  mobil: 'mobile',
  mobal: 'mobile',
  vidio: 'video',
  vidyo: 'video',
  vait: 'wait',
  ofis: 'office',
  afis: 'office',
  afie: 'office',
  afice: 'office',
  ofice: 'office',
  meething: 'meeting',
  miting: 'meeting',
  diployment: 'deployment',
  prodakt: 'product',
  onlain: 'online',
};

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

function countIndicSyllablesAndVirama(phrase: string): { syllables: number; endsVirama: boolean } {
  const w = phrase.trim();
  if (!w) return { syllables: 0, endsVirama: false };
  const cps: number[] = [];
  for (let i = 0; i < w.length; i++) {
    const ch = w[i];
    if (ch !== ' ' && ch !== '\t' && ch !== '\n') {
      cps.push(w.charCodeAt(i));
    }
  }
  if (cps.length === 0) return { syllables: 0, endsVirama: false };
  const lastCp = cps[cps.length - 1];
  const endsVirama = lastCp >= 0x0900 && lastCp <= 0x0d7f && (lastCp & 0x7f) === 0x4d;
  let syl = 0;
  for (let i = 0; i < cps.length; i++) {
    const cp = cps[i];
    if (cp < 0x0900 || cp > 0x0d7f) continue;
    const off = cp & 0x7f;
    if (off >= 0x05 && off <= 0x14) {
      syl += 1;
    } else if (off >= 0x15 && off <= 0x39) {
      const nxtCp = i + 1 < cps.length ? cps[i + 1] : 0;
      const nxtOff = nxtCp >= 0x0900 && nxtCp <= 0x0d7f ? nxtCp & 0x7f : -1;
      if (nxtOff !== 0x4d) syl += 1;
    }
  }
  return { syllables: Math.max(1, syl), endsVirama };
}

function countEnSyllablesAndCoda(phrase: string): { syllables: number; endsConsonant: boolean } {
  const words = phrase.toLowerCase().split(/\s+/).filter(Boolean);
  let tot = 0;
  for (const w of words) {
    const dropSilentE =
      w.length > 3 && w.endsWith('e') && !w.endsWith('le') && !w.endsWith('ee') && !w.endsWith('ie');
    const core = dropSilentE ? w.slice(0, -1) : w;
    const groups = core.match(/[aeiouy]+/g);
    tot += Math.max(1, groups ? groups.length : 1);
  }
  const lastW = words.length > 0 ? words[words.length - 1] : '';
  const lastCh = lastW ? lastW[lastW.length - 1] : '';
  let endsConsonant = Boolean(lastW) && !/[aeiouy]/.test(lastCh);
  if (lastW.endsWith('e') && lastW.length > 3 && !/[aeiouy]/.test(lastW[lastW.length - 2])) {
    endsConsonant = true;
  }
  return { syllables: Math.max(1, tot), endsConsonant };
}

function canonicalConsonantSkeletonIndic(phrase: string): string {
  const out: string[] = [];
  let firstAlpha = true;
  for (let i = 0; i < phrase.length; i++) {
    const ch = phrase[i];
    const cp = phrase.charCodeAt(i);
    if (cp >= 0x0900 && cp <= 0x0d7f) {
      const off = cp & 0x7f;
      let c = '';
      if (off === 0x01 || off === 0x02) c = 'n';
      else if ((off >= 0x15 && off <= 0x18) || (off >= 0x58 && off <= 0x5a)) c = 'k';
      else if (off === 0x19 || off === 0x1e || off === 0x23 || off === 0x28 || off === 0x29) c = 'n';
      else if (off >= 0x1a && off <= 0x1d) c = 'c';
      else if (off === 0x5b || (off >= 0x36 && off <= 0x38)) c = 's';
      else if ((off >= 0x1f && off <= 0x22) || (off >= 0x24 && off <= 0x27) || off === 0x5c || off === 0x5d) c = 't';
      else if ((off >= 0x2a && off <= 0x2d) || off === 0x5e) c = 'p';
      else if (off === 0x2e) c = 'm';
      else if (off === 0x2f || off === 0x5f) c = firstAlpha ? 'y' : '';
      else if (off === 0x30 || off === 0x31 || off === 0x0b) c = 'r';
      else if (off >= 0x32 && off <= 0x34) c = 'l';
      else if (off === 0x35) c = 'w';
      else if (off === 0x39) c = 'h';

      if (off >= 0x05 && off <= 0x39) firstAlpha = false;
      if (c && (out.length === 0 || out[out.length - 1] !== c)) {
        out.push(c);
      }
    } else if (ch === ' ') {
      firstAlpha = true;
    }
  }
  return out.join('');
}

function canonicalConsonantSkeletonEn(phrase: string): string {
  const w = phrase
    .toLowerCase()
    .replace(/tch/g, 'c')
    .replace(/ch/g, 'c')
    .replace(/dg/g, 'c')
    .replace(/ph/g, 'p')
    .replace(/gh/g, '')
    .replace(/ck/g, 'k')
    .replace(/sh/g, 's')
    .replace(/th/g, 't');
  const out: string[] = [];
  let firstAlpha = true;
  for (let i = 0; i < w.length; i++) {
    const ch = w[i];
    if (ch === ' ') {
      firstAlpha = true;
      continue;
    }
    let c = '';
    if (ch === 'k' || ch === 'g' || ch === 'q' || ch === 'x') c = 'k';
    else if (ch === 'c' || ch === 'j') c = 'c';
    else if (ch === 's' || ch === 'z') c = 's';
    else if (ch === 't' || ch === 'd') c = 't';
    else if (ch === 'n') c = 'n';
    else if (ch === 'p' || ch === 'b' || ch === 'f') c = 'p';
    else if (ch === 'm') c = 'm';
    else if (ch === 'y' && firstAlpha) c = 'y';
    else if (ch === 'r') c = 'r';
    else if (ch === 'l') c = 'l';
    else if (ch === 'v' || ch === 'w') c = 'w';
    else if (ch === 'h') c = 'h';

    if (ch >= 'a' && ch <= 'z') firstAlpha = false;
    if (c && (out.length === 0 || out[out.length - 1] !== c)) {
      out.push(c);
    }
  }
  return out.join('');
}

function skelEditDist(a: string, b: string): number {
  const n = a.length;
  const m = b.length;
  const dp: number[] = new Array(m + 1);
  for (let j = 0; j <= m; j++) dp[j] = j;
  for (let i = 1; i <= n; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= m; j++) {
      const tmp = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(prev + cost, dp[j] + 1, dp[j - 1] + 1);
      prev = tmp;
    }
  }
  return dp[m];
}

function isPhoneticLoanwordMatch(indPhrase: string, enPhrase: string): boolean {
  const enClean = enPhrase.trim().toLowerCase();
  const si = canonicalConsonantSkeletonIndic(indPhrase);
  if (!si) return false;
  if (si.length === 1 && enClean !== 'app') return false;
  const wHard = enClean.replace(/c(?=[aoukrlt]|$)/g, 'k').replace(/c(?=[eiy])/g, 's');
  const variants = [canonicalConsonantSkeletonEn(wHard), canonicalConsonantSkeletonEn(enClean)].filter(Boolean);
  if (variants.length === 0) return false;

  let bestD = 99;
  let bestLenOk = false;
  let minVarLen = 99;
  for (const se of variants) {
    if (se.length < minVarLen) minVarLen = se.length;
    if (Math.abs(si.length - se.length) <= 1) {
      bestLenOk = true;
      const d = skelEditDist(si, se);
      if (d < bestD) bestD = d;
    }
  }
  if (!bestLenOk) return false;
  if (Math.min(si.length, minVarLen) <= 2) {
    if (bestD !== 0) return false;
  } else if (bestD > 1) {
    return false;
  }

  let firstIndCp = 0;
  for (let i = 0; i < indPhrase.length; i++) {
    const cp = indPhrase.charCodeAt(i);
    if (cp >= 0x0900 && cp <= 0x0d7f) {
      firstIndCp = cp;
      break;
    }
  }
  const isSouthIndic = firstIndCp >= 0x0b80 && firstIndCp <= 0x0d7f;
  const { syllables: indSyl, endsVirama } = countIndicSyllablesAndVirama(indPhrase);
  const { syllables: enSyl, endsConsonant } = countEnSyllablesAndCoda(enClean);
  const maxSylDiff = isSouthIndic ? 1 : 2;
  if (indSyl - enSyl > maxSylDiff || enSyl - indSyl > 1) return false;
  if (isSouthIndic && endsConsonant && !endsVirama && indSyl > enSyl) return false;
  return true;
}

function repairIndianEnSpelling(rawW: string, enLexWords: Set<string>): string {
  const cw = rawW.toLowerCase().replace(EN_CLEAN_RE, '').replace(/^'+|'+$/g, '');
  if (!cw) return cw;
  const mapped = INDIAN_EN_LOANWORD_FIXES[cw];
  if (mapped && isEnWord(mapped, enLexWords)) return mapped;
  if (isEnWord(cw, enLexWords) || cw.length < 3) return cw;
  const cands = [
    cw + 'e',
    cw.replace(/io/g, 'eo'),
    cw.startsWith('v') ? 'w' + cw.slice(1) : '',
    cw.replace(/th/g, 't'),
    cw.replace(/f/g, 'ff'),
    cw.startsWith('af') ? 'o' + cw.replace(/f/g, 'ff') : '',
    cw.replace(/k/g, 'c'),
  ];
  for (const c of cands) {
    if (c && c.length >= 3 && isEnWord(c, enLexWords)) return c;
  }
  return cw;
}

function extractCtcWordSpans(
  logits: Float32Array,
  timeSteps: number,
  vocab: string[]
): Array<{ text: string; startFrame: number; endFrame: number }> {
  const numClasses = timeSteps > 0 ? Math.floor(logits.length / timeSteps) : vocab.length;
  const vlen = vocab.length;
  const rawSpans: Array<{ text: string; startFrame: number; endFrame: number }> = [];
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
          rawSpans.push({ text: wTxt, startFrame: curStart, endFrame: Math.max(curEnd, curStart + 1) });
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
      rawSpans.push({ text: wTxt, startFrame: curStart, endFrame: Math.max(curEnd, curStart + 1) });
    }
  }

  const words: Array<{ text: string; startFrame: number; endFrame: number }> = [];
  for (const sp of rawSpans) {
    const parts = sp.text.split(/\s+/).filter(Boolean);
    if (parts.length <= 1) {
      words.push(sp);
    } else {
      let totC = 0;
      for (const p of parts) totC += p.length;
      totC = Math.max(1, totC);
      const spanLen = Math.max(parts.length, sp.endFrame - sp.startFrame);
      let curF = sp.startFrame;
      for (let i = 0; i < parts.length; i++) {
        const wF = Math.max(1, Math.round((spanLen * parts[i].length) / totC));
        const nxtF = i === parts.length - 1 ? sp.endFrame : Math.min(sp.endFrame, curF + wF);
        words.push({ text: parts[i], startFrame: curF, endFrame: Math.max(curF + 1, nxtF) });
        curF = nxtF;
      }
    }
  }
  return words;
}

function spanConditionalCertainty(
  logits: Float32Array,
  numClasses: number,
  startFrame: number,
  endFrame: number
): number {
  if (endFrame <= startFrame || numClasses <= 1) return -10.0;
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
  const numClassesIndic = timeSteps > 0 ? Math.floor(logitsIndic.length / timeSteps) : vocabIndic.length;
  const numClassesEn = timeSteps > 0 ? Math.floor(logitsEn.length / timeSteps) : vocabEn.length;
  const baseRes = decodeCTC(
    logitsIndic,
    [timeSteps, numClassesIndic],
    vocabIndic,
    isPartial ? { isPartial: true } : undefined
  );
  if (langIndic === 'en' || timeSteps < 4 || !baseRes.text) {
    return { text: baseRes.text, tokens: baseRes.tokens, englishSpans: [] };
  }

  let indSpans = extractCtcWordSpans(logitsIndic, timeSteps, vocabIndic);
  if (indSpans.length === 0) {
    return { text: baseRes.text, tokens: baseRes.tokens, englishSpans: [] };
  }
  const baseWords = baseRes.text.split(/\s+/).filter(Boolean);
  if (baseWords.length === indSpans.length) {
    indSpans = indSpans.map((sp, idx) => ({
      text: baseWords[idx],
      startFrame: sp.startFrame,
      endFrame: sp.endFrame,
    }));
  }

  const enRes = decodeCTC(
    logitsEn,
    [timeSteps, numClassesEn],
    vocabEn,
    isPartial ? { isPartial: true } : undefined
  );
  let enSpansRaw = extractCtcWordSpans(logitsEn, timeSteps, vocabEn);
  const enWordsDec = enRes.text.split(/\s+/).filter(Boolean);
  if (enWordsDec.length === enSpansRaw.length) {
    enSpansRaw = enSpansRaw.map((sp, idx) => ({
      text: enWordsDec[idx],
      startFrame: sp.startFrame,
      endFrame: sp.endFrame,
    }));
  }

  const { core, ext } = getIndicLexicon(langIndic);
  const { words: enLexWords } = getEnLexicon();

  interface ClassifiedEnSpan {
    cw: string;
    raw: string;
    e0: number;
    e1: number;
    isStrong: boolean;
    isPhraseOk: boolean;
  }

  const classifiedEn: ClassifiedEnSpan[] = enSpansRaw.map((sp) => {
    const cw = repairIndianEnSpelling(sp.text, enLexWords);
    const hasV = EN_VOWELS_RE.test(cw);
    const inLex = Boolean(cw) && isEnWord(cw, enLexWords);
    const isStrong =
      hasV &&
      inLex &&
      ((cw.length >= 4 && !CODEMIX_AMBIGUOUS_EN.has(cw)) || EN_SAFE_SHORT_WORDS.has(cw));
    const isPhraseOk = isStrong || EN_PHRASE_FUNC_WORDS.has(cw) || (cw.length >= 3 && hasV && inLex);
    return { cw, raw: sp.text, e0: sp.startFrame, e1: sp.endFrame, isStrong, isPhraseOk };
  });

  const candRegions: ClassifiedEnSpan[][] = [];
  let i = 0;
  while (i < classifiedEn.length) {
    if (!classifiedEn[i].isPhraseOk) {
      i++;
      continue;
    }
    let j = i;
    while (
      j + 1 < classifiedEn.length &&
      classifiedEn[j + 1].isPhraseOk &&
      classifiedEn[j + 1].e0 - classifiedEn[j].e1 <= 12
    ) {
      j++;
    }
    const sub = classifiedEn.slice(i, j + 1);
    if (sub.some((x) => x.isStrong) && (sub.length > 1 || sub[0].isStrong)) {
      candRegions.push(sub);
    }
    i = j + 1;
  }

  const replacements = new Map<number, { hi: number; enList: string[] }>();
  const usedInd = new Set<number>();

  const tryRegion = (subItems: ClassifiedEnSpan[]): boolean => {
    const rE0 = subItems[0].e0;
    const rE1 = subItems[subItems.length - 1].e1;
    const enCleanList = subItems.map((x) => x.cw).filter(Boolean);
    if (enCleanList.length === 0) return false;

    const overlapIdxs: number[] = [];
    for (let idx = 0; idx < indSpans.length; idx++) {
      const sp = indSpans[idx];
      const iMid = 0.5 * (sp.startFrame + sp.endFrame);
      const ov = Math.min(sp.endFrame, rE1) - Math.max(sp.startFrame, rE0);
      const iLen = Math.max(1, sp.endFrame - sp.startFrame);
      if ((iMid >= rE0 && iMid <= rE1) || ov >= 0.6 * iLen) {
        overlapIdxs.push(idx);
      }
    }
    if (overlapIdxs.length === 0) return false;
    let lo = overlapIdxs[0];
    let hi = overlapIdxs[overlapIdxs.length - 1] + 1;

    while (hi - lo > enCleanList.length) {
      const wLeft = indSpans[lo].text.replace(INDIC_STRIP_PUNCT_RE, '');
      if (
        wLeft &&
        scoreIndicWord(wLeft, langIndic, core, ext) > 0.5 &&
        !isPhoneticLoanwordMatch(wLeft, enCleanList[0])
      ) {
        lo++;
        continue;
      }
      const wRight = indSpans[hi - 1].text.replace(INDIC_STRIP_PUNCT_RE, '');
      if (
        wRight &&
        scoreIndicWord(wRight, langIndic, core, ext) > 0.5 &&
        !isPhoneticLoanwordMatch(wRight, enCleanList[enCleanList.length - 1])
      ) {
        hi--;
        continue;
      }
      break;
    }

    if (lo >= hi) return false;
    for (let k = lo; k < hi; k++) {
      if (usedInd.has(k)) return false;
    }

    const indWordsSlice: string[] = [];
    for (let k = lo; k < hi; k++) indWordsSlice.push(indSpans[k].text);
    const indPhrase = indWordsSlice.join(' ');
    const enPhrase = enCleanList.join(' ');
    const f0 = Math.max(0, Math.min(rE0, indSpans[lo].startFrame) - 2);
    const f1 = Math.min(timeSteps, Math.max(rE1, indSpans[hi - 1].endFrame) + 2);
    if (f1 - f0 < 3) return false;

    const certInd = spanConditionalCertainty(logitsIndic, numClassesIndic, f0, f1);
    const certEn = spanConditionalCertainty(logitsEn, numClassesEn, f0, f1);
    const anyCore = indWordsSlice.some((w) => {
      const wc = w.replace(INDIC_STRIP_PUNCT_RE, '');
      return wc ? core.has(wc) : false;
    });
    const phonMatch = isPhoneticLoanwordMatch(indPhrase, enPhrase);

    if (anyCore && !(enCleanList.length >= 3 && certEn >= certInd + 0.20)) {
      return false;
    }

    let accept = false;
    if (phonMatch) {
      let edgesOk = true;
      if (enCleanList.length >= 2 && indWordsSlice.length >= 2) {
        if (
          !isPhoneticLoanwordMatch(indWordsSlice[0], enCleanList[0]) ||
          !isPhoneticLoanwordMatch(indWordsSlice[indWordsSlice.length - 1], enCleanList[enCleanList.length - 1])
        ) {
          edgesOk = false;
        }
      }
      const { endsVirama } = countIndicSyllablesAndVirama(indPhrase);
      let margin = -0.45;
      if (!endsVirama && enCleanList.length === 1) {
        margin = -0.05;
      } else if (enCleanList.length === 1 && enCleanList[0].length <= 4) {
        margin = -0.32;
      }
      if (edgesOk && certEn >= -0.82 && certEn >= certInd + margin) {
        accept = true;
      }
    } else if (enCleanList.length >= 3 && subItems.some((x) => x.isStrong)) {
      if (certEn >= certInd + 0.04 && certEn >= -0.65) {
        accept = true;
      }
    } else {
      let maxIndLex = 0.0;
      for (const w of indWordsSlice) {
        const wc = w.replace(INDIC_STRIP_PUNCT_RE, '');
        if (wc) {
          const sc = scoreIndicWord(wc, langIndic, core, ext);
          if (sc > maxIndLex) maxIndLex = sc;
        }
      }
      if (maxIndLex <= 0.05 && certEn >= certInd + 0.28 && certEn > -0.32) {
        accept = true;
      }
    }

    if (accept) {
      replacements.set(lo, { hi, enList: enCleanList });
      for (let k = lo; k < hi; k++) usedInd.add(k);
      return true;
    }
    return false;
  };

  for (const reg of candRegions) {
    if (!tryRegion(reg) && reg.length > 1) {
      for (let len = Math.min(3, reg.length - 1); len >= 1; len--) {
        for (let startK = 0; startK <= reg.length - len; startK++) {
          const sub = reg.slice(startK, startK + len);
          if (sub.some((x) => x.isStrong) && (sub.length > 1 || sub[0].isStrong)) {
            tryRegion(sub);
          }
        }
      }
    }
  }

  for (let idx = 0; idx < indSpans.length; idx++) {
    if (usedInd.has(idx)) continue;
    const sp = indSpans[idx];
    const wClean = sp.text.replace(INDIC_STRIP_PUNCT_RE, '');
    if (!wClean || core.has(wClean)) continue;
    const prevEnd = idx > 0 ? indSpans[idx - 1].endFrame : 0;
    const nextStart = idx + 1 < indSpans.length ? indSpans[idx + 1].startFrame : timeSteps;
    const s0 = Math.max(prevEnd, sp.startFrame - 1);
    const s1 = Math.min(nextStart, sp.endFrame + 1);
    if (s1 - s0 < 3) continue;
    const subSlice = logitsEn.subarray(s0 * numClassesEn, s1 * numClassesEn);
    const enSubRes = decodeCTC(subSlice, [s1 - s0, numClassesEn], vocabEn, { isPartial: true });
    const subEnWords = enSubRes.text
      .trim()
      .split(/\s+/)
      .map((u) => repairIndianEnSpelling(u, enLexWords))
      .filter((u) => Boolean(u) && isEnWord(u, enLexWords) && EN_VOWELS_RE.test(u));

    if (subEnWords.length === 1) {
      const candW = subEnWords[0];
      if ((candW.length >= 4 && !CODEMIX_AMBIGUOUS_EN.has(candW)) || EN_SAFE_SHORT_WORDS.has(candW)) {
        if (isPhoneticLoanwordMatch(wClean, candW)) {
          const { endsVirama } = countIndicSyllablesAndVirama(wClean);
          const m2 = endsVirama ? -0.42 : -0.05;
          const certInd = spanConditionalCertainty(logitsIndic, numClassesIndic, s0, s1);
          const certEn = spanConditionalCertainty(logitsEn, numClassesEn, s0, s1);
          if (certEn >= -0.82 && certEn >= certInd + m2) {
            replacements.set(idx, { hi: idx + 1, enList: [candW] });
            usedInd.add(idx);
          }
        } else if (
          canonicalConsonantSkeletonEn(candW).length >= 2 &&
          scoreIndicWord(wClean, langIndic, core, ext) <= 0.05
        ) {
          const certInd = spanConditionalCertainty(logitsIndic, numClassesIndic, s0, s1);
          const certEn = spanConditionalCertainty(logitsEn, numClassesEn, s0, s1);
          if (certEn >= certInd + 0.28 && certEn > -0.35) {
            replacements.set(idx, { hi: idx + 1, enList: [candW] });
            usedInd.add(idx);
          }
        }
      }
    }
  }

  if (replacements.size === 0) {
    return { text: baseRes.text, tokens: baseRes.tokens, englishSpans: [] };
  }

  const outWords: string[] = [];
  const englishSpans: CodeSwitchSpan[] = [];
  let cursor = 0;
  let idx = 0;
  while (idx < indSpans.length) {
    const rep = replacements.get(idx);
    if (rep) {
      for (const ew of rep.enList) {
        if (outWords.length > 0) cursor += 1;
        const sc = cursor;
        cursor += ew.length;
        englishSpans.push({ word: ew, startChar: sc, endChar: cursor });
        outWords.push(ew);
      }
      idx = rep.hi;
    } else {
      const wI = indSpans[idx].text;
      if (outWords.length > 0) cursor += 1;
      cursor += wI.length;
      outWords.push(wI);
      idx++;
    }
  }

  return {
    text: outWords.join(' '),
    tokens: outWords.map((w) => `\u2581${w}`),
    englishSpans,
  };
}

export function splitPcmAtPauses(
  pcm: Float32Array,
  sr: number = 16000,
  minSegmentSec: number = 1.55,
  minPauseMs: number = 160
): Array<[number, number]> {
  const minSeg = Math.floor(minSegmentSec * sr);
  if (pcm.length < 2 * minSeg) {
    return [[0, pcm.length]];
  }
  const hop = Math.floor(0.02 * sr);
  const nFrames = Math.floor(pcm.length / hop);
  if (nFrames < 20) {
    return [[0, pcm.length]];
  }

  const rms = new Float32Array(nFrames);
  const sortedRms = new Float32Array(nFrames);
  for (let f = 0; f < nFrames; f++) {
    const base = f * hop;
    let sumSq = 0;
    for (let k = 0; k < hop; k++) {
      const v = pcm[base + k];
      sumSq += v * v;
    }
    const r = Math.sqrt(sumSq / hop);
    rms[f] = r;
    sortedRms[f] = r;
  }
  sortedRms.sort();
  const p80 = sortedRms[Math.min(nFrames - 1, Math.floor(0.8 * nFrames))];
  if (p80 < 1e-4) {
    return [[0, pcm.length]];
  }

  const valleyTh = Math.max(0.0035, Math.min(0.018, 0.12 * p80));
  const isSil = new Uint8Array(nFrames);
  for (let f = 0; f < nFrames; f++) {
    if (rms[f] < valleyTh) isSil[f] = 1;
  }

  const minSilFrames = Math.max(4, Math.round(minPauseMs / 20));
  const cuts: Array<{ sample: number; strength: number }> = [];
  let i = 0;
  while (i < nFrames) {
    if (!isSil[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < nFrames && isSil[j]) {
      j++;
    }
    if (j - i >= minSilFrames) {
      const valley = Array.from(rms.subarray(i, j)).sort((a, b) => a - b);
      const mid = valley.length >> 1;
      const medVRms =
        valley.length % 2 === 1 ? valley[mid] : 0.5 * (valley[mid - 1] + valley[mid]);
      const strength = Math.pow(j - i, 1.5) / (medVRms + 5e-4);
      cuts.push({ sample: Math.floor((i + j) / 2) * hop, strength });
    }
    i = j;
  }

  if (cuts.length === 0) {
    return [[0, pcm.length]];
  }

  const segs: Array<[number, number]> = [];
  const boundaryStrengths: number[] = [];
  let prev = 0;
  for (const c of cuts) {
    segs.push([prev, c.sample]);
    boundaryStrengths.push(c.strength);
    prev = c.sample;
  }
  segs.push([prev, pcm.length]);

  while (segs.length > 1) {
    let shortestIdx = 0;
    let shortestLen = segs[0][1] - segs[0][0];
    for (let k = 1; k < segs.length; k++) {
      const len = segs[k][1] - segs[k][0];
      if (len < shortestLen) {
        shortestLen = len;
        shortestIdx = k;
      }
    }
    if (shortestLen >= minSeg) break;

    if (shortestIdx === 0) {
      segs[1][0] = segs[0][0];
      segs.shift();
      boundaryStrengths.shift();
    } else if (shortestIdx === segs.length - 1) {
      segs[segs.length - 2][1] = segs[segs.length - 1][1];
      segs.pop();
      boundaryStrengths.pop();
    } else {
      if (boundaryStrengths[shortestIdx - 1] <= boundaryStrengths[shortestIdx]) {
        segs[shortestIdx - 1][1] = segs[shortestIdx][1];
        segs.splice(shortestIdx, 1);
        boundaryStrengths.splice(shortestIdx - 1, 1);
      } else {
        segs[shortestIdx + 1][0] = segs[shortestIdx][0];
        segs.splice(shortestIdx, 1);
        boundaryStrengths.splice(shortestIdx, 1);
      }
    }
  }

  if (segs.length <= 1) {
    return [[0, pcm.length]];
  }

  const trimmed: Array<[number, number]> = [];
  for (const [s0, s1] of segs) {
    let f0 = Math.floor(s0 / hop);
    let f1 = Math.min(nFrames, Math.floor(s1 / hop));
    while (f0 < f1 && isSil[f0]) f0++;
    while (f1 > f0 && isSil[f1 - 1]) f1--;
    const t0 = Math.max(s0, (f0 - 2) * hop);
    const t1 = Math.min(s1, (f1 + 2) * hop);
    if (t1 - t0 >= Math.floor(0.4 * sr)) {
      trimmed.push([t0, t1]);
    } else {
      trimmed.push([s0, s1]);
    }
  }
  return trimmed;
}

export interface MultilangSegmentEncodeOutput {
  hidden: Float32Array;
  timeSteps: number;
}

export async function transcribeMultilangSegments(
  pcm: Float32Array,
  encodeSegment: (segPcm: Float32Array) => Promise<MultilangSegmentEncodeOutput>,
  projectHead: (hidden: Float32Array, timeSteps: number, weight: Float32Array, bias: Float32Array) => Float32Array,
  multiHeads: Record<string, LinearHeadWeights>,
  multiVocabs: Record<string, string[]>,
  lidWeights: NeuralLIDWeights | null,
  fallbackVocab: string[],
  useCodeSwitch: boolean,
  sampleRate: number = 16000,
  projectEnDecode?: (hidden: Float32Array, timeSteps: number) => { logits: Float32Array; vocab: string[] } | null,
  projectLangDecode?: (lang: string, hidden: Float32Array, timeSteps: number) => Promise<{ logits: Float32Array; vocab: string[] } | null> | { logits: Float32Array; vocab: string[] } | null
): Promise<{
  text: string;
  language: string;
  tokens: string[];
  languageConfidence: number;
  languageProbabilities: Record<string, number>;
  englishSpans?: CodeSwitchSpan[];
} | null> {
  const segs = splitPcmAtPauses(pcm, sampleRate);
  if (segs.length < 2) return null;

  interface SegInfo {
    s0: number;
    s1: number;
    hidden: Float32Array;
    timeSteps: number;
    lidRes: LanguageDetectionResult;
    cachedLogits: Record<string, Float32Array>;
    effLang: string;
  }

  const segInfos: SegInfo[] = [];
  for (const [s0, s1] of segs) {
    const enc = await encodeSegment(pcm.subarray(s0, s1));
    if (enc.timeSteps <= 0 || enc.hidden.length === 0) continue;
    const { result: lidRes, cachedLogits } = detectLanguageFromHidden(
      enc.hidden,
      enc.timeSteps,
      multiHeads,
      multiVocabs,
      lidWeights
    );
    segInfos.push({
      s0,
      s1,
      hidden: enc.hidden,
      timeSteps: enc.timeSteps,
      lidRes,
      cachedLogits,
      effLang: lidRes.language,
    });
  }

  if (segInfos.length < 2) return null;

  for (let k = 0; k < segInfos.length; k++) {
    const lrK = segInfos[k].lidRes;
    if (lrK.confidence < 0.65) {
      const nbrLg = k > 0 ? segInfos[k - 1].effLang : k + 1 < segInfos.length ? segInfos[k + 1].effLang : '';
      const nbrP = nbrLg ? (lrK.probabilities[nbrLg] ?? 0) : 0;
      if (nbrLg && nbrP >= 0.18 && lrK.confidence < 2.2 * nbrP) {
        segInfos[k].effLang = nbrLg;
      }
    }
  }

  const agg: Record<string, number> = {};
  for (const lg of LID_LANGUAGES) agg[lg] = 0;
  let totalDur = 0;
  for (const item of segInfos) {
    const dur = item.s1 - item.s0;
    totalDur += dur;
    for (const [lg, p] of Object.entries(item.lidRes.probabilities)) {
      agg[lg] = (agg[lg] ?? 0) + dur * p;
    }
  }

  let domLg = segInfos[0].effLang;
  let bestAgg = -1;
  for (const [lg, v] of Object.entries(agg)) {
    if (v > bestAgg) {
      bestAgg = v;
      domLg = lg;
    }
  }

  let domMaxConf = 0;
  for (const item of segInfos) {
    if (item.effLang === domLg && item.lidRes.confidence > domMaxConf) {
      domMaxConf = item.lidRes.confidence;
    }
  }

  const devSiblings = new Set(['sa', 'hi', 'mr']);
  const distinctLangs = new Set<string>();
  for (const item of segInfos) {
    if (item.effLang === domLg) {
      distinctLangs.add(domLg);
      continue;
    }
    const bothDev = devSiblings.has(item.effLang) && devSiblings.has(domLg);
    const minReq = bothDev ? 0.72 : 0.34;
    const domP = item.lidRes.probabilities[domLg] ?? 0;
    if (item.lidRes.confidence >= minReq && domP < 0.28 && item.lidRes.confidence >= 2.0 * domP) {
      distinctLangs.add(item.effLang);
    }
  }

  if (domMaxConf < 0.34 || distinctLangs.size < 2) {
    return null;
  }

  interface MergedRun {
    s0: number;
    s1: number;
    lang: string;
    cached: { hidden: Float32Array; timeSteps: number; cachedLogits: Record<string, Float32Array> } | null;
  }

  const mergedRuns: MergedRun[] = [];
  for (const item of segInfos) {
    let resolvedLg = domLg;
    if (distinctLangs.has(item.effLang)) {
      resolvedLg = item.effLang;
    } else {
      let bestP = -1;
      for (const candLg of distinctLangs) {
        const cp = item.lidRes.probabilities[candLg] ?? 0;
        if (cp > bestP) {
          bestP = cp;
          resolvedLg = candLg;
        }
      }
    }
    if (mergedRuns.length > 0 && mergedRuns[mergedRuns.length - 1].lang === resolvedLg) {
      mergedRuns[mergedRuns.length - 1].s1 = item.s1;
      mergedRuns[mergedRuns.length - 1].cached = null;
    } else {
      mergedRuns.push({
        s0: item.s0,
        s1: item.s1,
        lang: resolvedLg,
        cached: { hidden: item.hidden, timeSteps: item.timeSteps, cachedLogits: item.cachedLogits },
      });
    }
  }

  const textParts: string[] = [];
  const allTokens: string[] = [];
  const allEnSpans: CodeSwitchSpan[] = [];
  let charCursor = 0;

  for (const run of mergedRuns) {
    let mHidden: Float32Array;
    let mSteps: number;
    let mCached: Record<string, Float32Array>;
    if (run.cached) {
      mHidden = run.cached.hidden;
      mSteps = run.cached.timeSteps;
      mCached = run.cached.cachedLogits;
    } else {
      const enc = await encodeSegment(pcm.subarray(run.s0, run.s1));
      mHidden = enc.hidden;
      mSteps = enc.timeSteps;
      mCached = {};
    }
    if (mSteps <= 0) continue;

    let lg2d: Float32Array | undefined;
    let segVocab = multiVocabs[run.lang] || fallbackVocab;
    if (projectLangDecode) {
      const langDec = await projectLangDecode(run.lang, mHidden, mSteps);
      if (langDec) {
        lg2d = langDec.logits;
        segVocab = langDec.vocab;
      }
    } else if (run.lang === 'en' && projectEnDecode) {
      const enDec = projectEnDecode(mHidden, mSteps);
      if (enDec) {
        lg2d = enDec.logits;
        segVocab = enDec.vocab;
      }
    }
    if (!lg2d) {
      lg2d = mCached[run.lang];
      if (!lg2d && multiHeads[run.lang]) {
        lg2d = projectHead(mHidden, mSteps, multiHeads[run.lang].weight, multiHeads[run.lang].bias);
      }
    }
    if (!lg2d) continue;

    let segText = '';
    let segTokens: string[] = [];
    const segSpans: CodeSwitchSpan[] = [];

    if (useCodeSwitch && run.lang !== 'en' && (projectEnDecode || (multiHeads.en && multiVocabs.en))) {
      const enDec = projectEnDecode ? projectEnDecode(mHidden, mSteps) : null;
      const enLogits = enDec
        ? enDec.logits
        : mCached.en || projectHead(mHidden, mSteps, multiHeads.en.weight, multiHeads.en.bias);
      const enVocab = enDec ? enDec.vocab : multiVocabs.en;
      const cs = decodeBilingualCodeswitch(lg2d, mSteps, segVocab, run.lang, enLogits, enVocab, false);
      segText = cs.text;
      segTokens = cs.tokens;
      segSpans.push(...cs.englishSpans);
    } else {
      const dec = decodeCTC(lg2d, [mSteps, Math.floor(lg2d.length / mSteps)], segVocab);
      segText = dec.text;
      segTokens = dec.tokens;
      if (run.lang === 'en' && distinctLangs.size >= 2 && segText) {
        let wCur = 0;
        for (const wEn of segText.split(/\s+/).filter(Boolean)) {
          if (wCur > 0) wCur += 1;
          segSpans.push({ word: wEn, startChar: wCur, endChar: wCur + wEn.length });
          wCur += wEn.length;
        }
      }
    }

    if (!segText) continue;
    if (textParts.length > 0) charCursor += 1;
    for (const sp of segSpans) {
      allEnSpans.push({
        word: sp.word,
        startChar: charCursor + sp.startChar,
        endChar: charCursor + sp.endChar,
      });
    }
    textParts.push(segText);
    allTokens.push(...segTokens);
    charCursor += segText.length;
  }

  const normProbs: Record<string, number> = {};
  for (const [lg, val] of Object.entries(agg)) {
    normProbs[lg] = totalDur > 0 ? val / totalDur : 0;
  }

  return {
    text: textParts.join(' '),
    language: domLg,
    tokens: allTokens,
    languageConfidence: normProbs[domLg] ?? domMaxConf,
    languageProbabilities: normProbs,
    ...(useCodeSwitch || allEnSpans.length > 0 ? { englishSpans: allEnSpans } : {}),
  };
}
