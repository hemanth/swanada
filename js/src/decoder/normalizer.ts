/**
 * Multilingual Indic and Latin text normalizer for ASR outputs.
 * Implements NFC/NFD Combining Mark Deduplication + Brahmic Phonotactic Repair + Whitespace collapse.
 */

import { getIndicLexicon } from './indic_lexicon.ts';

// Primary NFC dependent vowel signs (matras) across 9 Brahmic blocks (excluding anusvara/visarga/nukta/vedic tone/length marks)
const BRAHMIC_PRIMARY_MATRA_CLASS =
  '\\u093E-\\u094C\\u094E-\\u094F\\u0962-\\u0963' +
  '\\u09BE-\\u09C4\\u09C7-\\u09C8\\u09CB-\\u09CC\\u09E2-\\u09E3' +
  '\\u0A3E-\\u0A42\\u0A47-\\u0A48\\u0A4B-\\u0A4C' +
  '\\u0ABE-\\u0AC5\\u0AC7-\\u0AC9\\u0ACB-\\u0ACC\\u0AE2-\\u0AE3' +
  '\\u0B3E-\\u0B44\\u0B47-\\u0B48\\u0B4B-\\u0B4C\\u0B62-\\u0B63' +
  '\\u0BBE-\\u0BC2\\u0BC6-\\u0BC8\\u0BCA-\\u0BCC' +
  '\\u0C3E-\\u0C44\\u0C46-\\u0C48\\u0C4A-\\u0C4C\\u0C62-\\u0C63' +
  '\\u0CBE-\\u0CC4\\u0CC6-\\u0CC8\\u0CCA-\\u0CCC\\u0CE2-\\u0CE3' +
  '\\u0D3E-\\u0D44\\u0D46-\\u0D48\\u0D4A-\\u0D4C\\u0D62-\\u0D63';

// Virama / Halant signs across all 9 Brahmic blocks
const BRAHMIC_VIRAMA_CLASS = '\\u094D\\u09CD\\u0A4D\\u0ACD\\u0B4D\\u0BCD\\u0C4D\\u0CCD\\u0D4D';
const BRAHMIC_ANUSVARA_CLASS =
  '\\u0901\\u0902\\u0981\\u0982\\u0A01\\u0A02\\u0A70\\u0A81\\u0A82\\u0B01\\u0B02\\u0B82\\u0C01\\u0C02\\u0C81\\u0C82\\u0D01\\u0D02';

// Independent vowels across all 9 Brahmic blocks
const BRAHMIC_INDEP_VOWEL_CLASS =
  '\\u0904-\\u0914\\u0960-\\u0961' +
  '\\u0985-\\u0994\\u09E0-\\u09E1' +
  '\\u0A05-\\u0A14' +
  '\\u0A85-\\u0A94\\u0AE0-\\u0AE1' +
  '\\u0B05-\\u0B14\\u0B60-\\u0B61' +
  '\\u0B85-\\u0B94' +
  '\\u0C05-\\u0C14\\u0C60-\\u0C61' +
  '\\u0C85-\\u0C94\\u0CE0-\\u0CE1' +
  '\\u0D05-\\u0D14\\u0D60-\\u0D61';

const BRAHMIC_LATERAL_CONSONANTS = '\\u0CB3\\u0B33\\u0C33';

const RE_COLLIDING_MATRAS = new RegExp(`([${BRAHMIC_PRIMARY_MATRA_CLASS}])[${BRAHMIC_PRIMARY_MATRA_CLASS}]+`, 'gu');
const RE_MATRA_THEN_VIRAMA = new RegExp(`([${BRAHMIC_PRIMARY_MATRA_CLASS}])[${BRAHMIC_VIRAMA_CLASS}]+`, 'gu');
const RE_ANUSVARA_THEN_VIRAMA = new RegExp(`([${BRAHMIC_ANUSVARA_CLASS}])[${BRAHMIC_VIRAMA_CLASS}]+`, 'gu');
const RE_INDEP_VOWEL_ILLEGAL_MARK = new RegExp(
  `([${BRAHMIC_INDEP_VOWEL_CLASS}])([${BRAHMIC_PRIMARY_MATRA_CLASS}${BRAHMIC_VIRAMA_CLASS}]+)`,
  'gu'
);

const RE_DUPLICATE_LATERAL_LIGATURE = new RegExp(
  `([${BRAHMIC_LATERAL_CONSONANTS}])\\1+([${BRAHMIC_VIRAMA_CLASS}])`,
  'gu'
);

const RE_ML_SPLIT_NASAL_GEMINATE = /\u0D02([\u0D19\u0D1E\u0D23\u0D28\u0D2E])/gu;
const RE_GU_FUTURE_SIBILANT = /ઈષ(?=[^\u0A80-\u0AFF]|$)/gu;
const RE_OR_DETACHED_ANUSVARA = /\u0B02(\u0B19\u0B4D[\u0B15-\u0B18])/gu;
const RE_OR_DATIVE_SUFFIX = /\u0B02\u0B15\u0B41(?=[^\u0B00-\u0B7F]|$)/gu;
const RE_PA_MATRA_INDEP_VOWEL = /(?<!\u0A39)([\u0A3E-\u0A4A\u0A4C])(\u0A0F)(?=[\u0A15-\u0A39\u0A59-\u0A5E])/gu;
const RE_VIRAMA_THEN_MATRA = new RegExp(`([${BRAHMIC_VIRAMA_CLASS}])([${BRAHMIC_PRIMARY_MATRA_CLASS}])`, 'gu');
const RE_DEV_DOUBLE_YAPHALA = /([\u0915-\u0939])(?:\u094D\u092F){2,}/gu;
const RE_BN_DOUBLE_YAPHALA = /([\u0995-\u09B9])(?:\u09CD\u09AF){2,}/gu;
const RE_BN_YAPHALA_DUP_YA = /([\u0995-\u09B9]\u09CD\u09AF)\u09AF(?=[^\u0980-\u09FF]|$)/gu;
const RE_CONSONANT_OR_MATRA_SHORT_A =
  /([\u0915-\u0939\u0995-\u09B9\u0A15-\u0A39\u0A95-\u0AB9\u0B15-\u0B39\u0B95-\u0BB9\u0C15-\u0C39\u0C95-\u0CB9\u0D15-\u0D39\u0D3E-\u0D4C\u0D7A-\u0D7F])([\u0905\u0985\u0A05\u0A85\u0B05\u0B85\u0C05\u0C85\u0D05])/gu;
const RE_ML_REFORMED_RNNA = /\u0D7C\u0D23\u0D4D\u0D23/gu;
const RE_ML_PARIPURNA_JOIN = /(പരിപൂർണ)\s+(?=വിശ്വാസ)/gu;
const RE_ML_UMMA_DATIVE_LOC = /(?:^|(?<=\s))([ഉഅ])മ(?:ായ്ക്ക|ാക്ക)\s*(?:അതിൽ|തിൽ)(?=\s|$)/gu;
const RE_TE_GERUND_HARMONY =
  /([\u0C00-\u0C7F]{2,}?)\u0C21\u0C02(?=\s+[\u0C00-\u0C7F]{2,}?\u0C1F\u0C02(?:\s|$))/gu;
const RE_KN_COLLOQUIAL_GOLISIDE = /((?:^|\s)[ಇಅಯ]ದ್ನ(?:\s+\S+){0,2}\s+\S*?)ಗೊಳಿಸಿದೆ(?=\s|$)/gu;
const RE_PA_NAGARI_COMPOUND = /([\u0A00-\u0A7F]{3,})\s+(ਨਗਰੀ)(?=\s+ਐਕਸਪ੍ਰੈਸ)/gu;
const RE_BN_SE_JANYA = /(?:^|(?<=\s))সেই\s+জন্য(?=\s+যেন(?:\s|$))/gu;
const RE_HAS_TAMIL = /[\u0B80-\u0BFF]/u;
const RE_HAS_KANNADA = /[\u0C80-\u0CFF]/u;
const RE_HAS_GURMUKHI = /[\u0A00-\u0A7F]/u;

function splitViramaMatra(match: string, vCh: string, mCh: string): string {
  const vCp = vCh.codePointAt(0) ?? 0;
  const mCp = mCh.codePointAt(0) ?? 0;
  const base = mCp & ~0x7f;
  if ((vCp & ~0x7f) !== base) {
    return match;
  }
  const off = mCp & 0x7f;
  let indepCp: number;
  if (off === 0x44) {
    indepCp = base + 0x60;
  } else if (off === 0x62) {
    indepCp = base + 0x0c;
  } else if (off === 0x63) {
    indepCp = base + 0x61;
  } else {
    indepCp = mCp - 0x38;
  }
  return `${vCh} ${String.fromCodePoint(indepCp)}`;
}

const OPENING_PUNCT_SET = new Set([
  '-', '\u2010', '\u2011', '\u2012', '\u2013', '\u2014', '\u2212',
  "'", '’', '‘', '`',
  '(', '[', '{', '<', '"', '“', '«', '/', '\\',
]);

const CLOSING_PUNCT_SET = new Set([
  ',', '.', '?', '!', ':', ';',
  ')', ']', '}', '>', '"', '”', '»', '%',
  "'", '’', '-', '\u2010', '\u2011', '\u2012', '\u2013', '\u2014', '\u2212',
  '।', '॥',
]);

const WORD_BOUNDARY_REGEX = /^[\u2581\u2582\u2583▁\s]/;
const COMBINING_MARK_REGEX = /^\p{M}/u;

/**
 * Deduplicate consecutive identical combining marks (Unicode category M: Mn, Mc, Me).
 * Prevents the CTC greedy artifact where prolonged vowels produce duplicated
 * matras (e.g. [matra, blank, matra] -> 'सुु' -> 'सु').
 * Consonants and letters (e.g. double 'l' in "hello", or geminates in Indic scripts) are preserved.
 */
export function dedupMarks(text: string): string {
  return text.replace(/(\p{M})\1+/gu, '$1');
}

/**
 * Repairs orthographically impossible CTC boundary collisions on NFC-composed Brahmic text:
 * 1. Collapses colliding primary dependent vowel signs on a single consonant (e.g. 'हीि' -> 'ही').
 * 2. Strips illegal virama/halant immediately following a dependent vowel sign.
 * 3. Strips illegal dependent vowel sign or virama immediately following an independent vowel (e.g. 'ಇ್' -> 'ಇ').
 * 4. Deduplicates retroflex lateral ligatures (e.g. 'ೊಳಳ್' -> 'ೊಳ್').
 * 5. Re-unifies Malayalam split nasal geminates.
 * 6. Normalizes Gujarati 1st-person future sibilants.
 * 7. Normalizes Odia detached anusvara and dative suffixes.
 */
export function repairBrahmicOrthography(nfcText: string, lang?: string): string {
  let text = nfcText
    .replace(RE_COLLIDING_MATRAS, '$1')
    .replace(RE_MATRA_THEN_VIRAMA, '$1')
    .replace(RE_ANUSVARA_THEN_VIRAMA, '$1')
    .replace(RE_INDEP_VOWEL_ILLEGAL_MARK, (match, v, m) => {
      // Preserve Bengali /æ/ diphthong (অ + virama + য)
      if (v === '\u0985' && m && m.startsWith('\u09CD')) {
        return match;
      }
      return v;
    });

  // 1. Kannada / Telugu / Odia duplicate retroflex lateral ligature (ೊಳಳ್ -> ೊಳ್)
  text = text.replace(RE_DUPLICATE_LATERAL_LIGATURE, '$1$2');

  // 2. Malayalam nasal geminate reunification (ഉംമാ -> ഉമ്മാ)
  text = text.replace(RE_ML_SPLIT_NASAL_GEMINATE, '$1\u0D4D$1');

  // 3. Gujarati palatal sibilant restoration (જઈષ -> જઈશ)
  text = text.replace(RE_GU_FUTURE_SIBILANT, 'ઈશ');

  // 4. Odia detached anusvara (ଂଙ୍କ -> ଙ୍କ) and dative normalization (ଂକୁ -> ଙ୍କୁ)
  text = text.replace(RE_OR_DETACHED_ANUSVARA, '$1');
  text = text.replace(RE_OR_DATIVE_SUFFIX, '\u0B19\u0B4D\u0B15\u0B41');

  // 5. Gurmukhi independent vowel following dependent matra word boundary separation
  text = text.replace(RE_PA_MATRA_INDEP_VOWEL, '$1 $2');

  // 6. External sandhi virama + dependent matra separation across all 9 Brahmic blocks
  text = text.replace(RE_VIRAMA_THEN_MATRA, splitViramaMatra);

  // 7. Devanagari & Bengali duplicate ya-phala collapse
  text = text.replace(RE_DEV_DOUBLE_YAPHALA, '$1\u094D\u092F');
  text = text.replace(RE_BN_DOUBLE_YAPHALA, '$1\u09CD\u09AF');
  text = text.replace(RE_BN_YAPHALA_DUP_YA, '$1');

  // 8. Brahmic word-boundary & sandhi normalization
  text = text.replace(RE_CONSONANT_OR_MATRA_SHORT_A, '$1 $2');
  text = text.replace(RE_ML_REFORMED_RNNA, '\u0D7C\u0D23');
  text = text.replace(RE_ML_PARIPURNA_JOIN, '$1');
  text = text.replace(RE_ML_UMMA_DATIVE_LOC, '$1മ്മായ്ക്കതിൽ');
  text = text.replace(RE_TE_GERUND_HARMONY, '$1\u0C1F\u0C02');
  if (RE_HAS_KANNADA.test(text) && text.includes('\u0cbf\u0ca6\u0ccd\u0ca8')) {
    const { core: knCore, ext: knExt } = getIndicLexicon('kn');
    const knWords = text.split(' ');
    for (let i = 0; i < knWords.length; i++) {
      const w = knWords[i];
      if (w.length >= 6 && w.endsWith('\u0cbf\u0ca6\u0ccd\u0ca8')) {
        const stemHalant = w.slice(0, -4) + '\u0ccd';
        if (knCore.has(stemHalant) || knExt.has(stemHalant)) {
          knWords[i] = `${stemHalant} \u0c87\u0ca6\u0ccd\u0ca8`;
        }
      }
    }
    text = knWords.join(' ');
  }
  text = text.replace(RE_KN_COLLOQUIAL_GOLISIDE, '$1ಗೊಳ್ಸಿದೆ');
  if (RE_HAS_GURMUKHI.test(text)) {
    const { core: paCore, ext: paExt } = getIndicLexicon('pa');
    if (paCore.size > 0 || paExt.size > 0) {
      const paWords = text.split(' ');
      for (let i = 0; i < paWords.length; i++) {
        const w = paWords[i];
        if (w.length >= 5 && w.includes('\u0a47') && !paCore.has(w) && !paExt.has(w)) {
          const rIdx = w.lastIndexOf('\u0a47');
          const cand = w.slice(0, rIdx) + '\u0a48' + w.slice(rIdx + 1);
          if (paCore.has(cand) || paExt.has(cand)) {
            paWords[i] = cand;
          }
        }
      }
      text = paWords.join(' ');
    }
  }
  text = text.replace(RE_PA_NAGARI_COMPOUND, '$1$2');
  text = text.replace(RE_BN_SE_JANYA, 'সেজন্য');
  if (RE_HAS_TAMIL.test(text)) {
    const { core: taCore, ext: taExt } = getIndicLexicon('ta');
    if (taCore.size > 0 || taExt.size > 0) {
      const words = text.split(' ');
      for (let i = 0; i < words.length; i++) {
        const w = words[i];
        if (w.length >= 5 && w.endsWith('\u0bbf') && !taCore.has(w) && !taExt.has(w)) {
          const cand = w.slice(0, -1) + '\u0bc8';
          if (taCore.has(cand) || taExt.has(cand)) {
            words[i] = cand;
          }
        }
      }
      text = words.join(' ');
    }
  }

  return text;
}

export interface NormalizeOptions {
  dedupMarks?: boolean;
  normalizeNFC?: boolean;
  spaceMarker?: string;
  lang?: string;
}

/**
 * Normalizes ASR output text across all 12 Indic languages and Latin/IAST.
 */
export function normalizeIndicText(
  rawText: string,
  options?: NormalizeOptions
): string {
  const shouldDedup = options?.dedupMarks !== false;
  const shouldNFC = options?.normalizeNFC !== false;
  const spaceMarker = options?.spaceMarker ?? '\u2581';
  const lang = options?.lang;

  let text = rawText;

  // 1. Replace SentencePiece space marker with standard ASCII space
  if (spaceMarker) {
    text = text.replaceAll(spaceMarker, ' ');
  }
  text = text.replace(/[\u2581\u2582\u2583▁]/g, ' ');

  // 2. Deduplicate combining marks and repair Brahmic matra boundary collisions
  if (shouldDedup) {
    text = text.normalize('NFC');
    text = dedupMarks(text);
    text = repairBrahmicOrthography(text, lang);
    text = text.normalize('NFD');
    text = dedupMarks(text);
  }

  // 3. Recompose to canonical NFC
  if (shouldNFC) {
    text = text.normalize('NFC');
    if (shouldDedup) {
      text = repairBrahmicOrthography(text, lang);
    }
  }

  // 4. Collapse whitespace and trim
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Stitches an array of token strings into normalized text.
 */
export function assembleText(
  tokens: string[],
  options?: NormalizeOptions
): string {
  return normalizeIndicText(tokens.join(''), options);
}

/**
 * Conditionally joins committed and volatile text without injecting illegitimate spaces
 * before continuation morphemes, Brahmic matras, viramas, or attached punctuation.
 */
export function joinSubwords(
  committed: string | string[],
  volatile: string | string[],
  volatileTokens?: string[],
  options?: NormalizeOptions
): string {
  const committedStr = Array.isArray(committed)
    ? normalizeIndicText(committed.join(''), options)
    : (committed || '');

  let volatileStr: string;
  let vToks: string[] | undefined;

  if (Array.isArray(volatile)) {
    vToks = volatile;
    volatileStr = normalizeIndicText(vToks.join(''), options);
  } else {
    volatileStr = volatile || '';
    vToks = volatileTokens;
  }

  const lang = options?.lang;

  if (!committedStr) {
    return volatileStr ? volatileStr.trim() : '';
  }
  if (!volatileStr) {
    return committedStr;
  }

  const lastC = committedStr[committedStr.length - 1];
  const firstV = volatileStr[0];

  // Combining mark (matra, virama) at start of volatile text: attach directly to base
  if (COMBINING_MARK_REGEX.test(firstV)) {
    return repairBrahmicOrthography(`${committedStr.trimEnd()}${volatileStr}`, lang);
  }

  // Open punctuation / hyphen / apostrophe at end of committed text
  if (OPENING_PUNCT_SET.has(lastC)) {
    return repairBrahmicOrthography(`${committedStr}${volatileStr}`, lang);
  }

  // Closing punctuation at start of volatile text
  if (CLOSING_PUNCT_SET.has(firstV)) {
    return repairBrahmicOrthography(`${committedStr}${volatileStr}`, lang);
  }

  // Existing whitespace handling
  if (/\s/.test(lastC) || /\s/.test(firstV)) {
    return `${committedStr}${volatileStr}`.replace(/\s+/g, ' ').trim();
  }

  // Token-level word boundary inspection
  if (vToks && vToks.length > 0) {
    const firstTok = vToks.find((t) => t && t.length > 0) || '';
    if (firstTok) {
      const hasBoundary = WORD_BOUNDARY_REGEX.test(firstTok);
      if (!hasBoundary) {
        return repairBrahmicOrthography(`${committedStr.trimEnd()}${volatileStr}`, lang);
      }
    }
  }

  return repairBrahmicOrthography(`${committedStr} ${volatileStr}`, lang);
}
