/**
 * Multilingual Indic and Latin text normalizer for ASR outputs.
 * Implements NFD -> Combining Mark Deduplication -> NFC -> Whitespace collapse.
 */

/**
 * Deduplicate consecutive identical combining marks (Unicode category M: Mn, Mc, Me).
 * Prevents the CTC greedy artifact where prolonged vowels produce duplicated
 * matras (e.g. [matra, blank, matra] -> 'सुु' -> 'सु').
 * Consonants and letters (e.g. double 'l' in "hello", or geminates in Indic scripts) are preserved.
 */
export function dedupMarks(text: string): string {
  // \p{M} matches any Unicode mark (Mn = Nonspacing Mark, Mc = Spacing Mark, Me = Enclosing Mark)
  return text.replace(/(\p{M})\1+/gu, '$1');
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
  // Replace legacy space markers if present
  text = text.replace(/[\u2581\u2582\u2583▁]/g, ' ');

  // 2. Deduplicate combining marks
  // Two-pass deduplication: NFC handles composite two-part vowel signs (e.g. Bengali \u09cb, Tamil \u0bca),
  // followed by NFD to handle decomposed combining sequences, before final recomposition.
  if (shouldDedup) {
    text = text.normalize('NFC');
    text = dedupMarks(text);
    text = text.normalize('NFD');
    text = dedupMarks(text);
  }

  // 3. Recompose to canonical NFC
  if (shouldNFC) {
    text = text.normalize('NFC');
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
