/**
 * Multilingual Indic and Latin text normalizer for ASR outputs.
 * Implements NFC/NFD Combining Mark Deduplication + Brahmic Phonotactic Repair + Whitespace collapse.
 */

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

const RE_COLLIDING_MATRAS = new RegExp(`([${BRAHMIC_PRIMARY_MATRA_CLASS}])[${BRAHMIC_PRIMARY_MATRA_CLASS}]+`, 'gu');
const RE_MATRA_THEN_VIRAMA = new RegExp(`([${BRAHMIC_PRIMARY_MATRA_CLASS}])[${BRAHMIC_VIRAMA_CLASS}]+`, 'gu');
const RE_INDEP_VOWEL_ILLEGAL_MARK = new RegExp(
  `([${BRAHMIC_INDEP_VOWEL_CLASS}])[${BRAHMIC_PRIMARY_MATRA_CLASS}${BRAHMIC_VIRAMA_CLASS}]+`,
  'gu'
);

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
 * Preserves all valid conjuncts (C + virama + C), geminates, and vowel + anusvara/visarga/chandrabindu sequences.
 */
export function repairBrahmicOrthography(nfcText: string): string {
  return nfcText
    .replace(RE_COLLIDING_MATRAS, '$1')
    .replace(RE_MATRA_THEN_VIRAMA, '$1')
    .replace(RE_INDEP_VOWEL_ILLEGAL_MARK, '$1');
}

export interface NormalizeOptions {
  dedupMarks?: boolean;
  normalizeNFC?: boolean;
  spaceMarker?: string;
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
    text = repairBrahmicOrthography(text);
    text = text.normalize('NFD');
    text = dedupMarks(text);
  }

  // 3. Recompose to canonical NFC
  if (shouldNFC) {
    text = text.normalize('NFC');
    if (shouldDedup) {
      text = repairBrahmicOrthography(text);
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
