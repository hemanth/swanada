/**
 * Deterministic Classical Sanskrit Devanagari to Roman IAST Transliteration.
 * Full support for vocalic liquids (ṛ, ṝ, ḷ, ḹ), ayogavāhas (ḥ, ṃ, m̐),
 * avagraha ('), and Vedic pitch accents (udātta, anudātta).
 */

const VOWEL_MAP: Record<string, string> = {
  'अ': 'a', 'आ': 'ā', 'इ': 'i', 'ई': 'ī', 'उ': 'u', 'ऊ': 'ū',
  'ऋ': 'ṛ', 'ॠ': 'ṝ', 'ऌ': 'ḷ', 'ॡ': 'ḹ',
  'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au',
};

const MATRA_MAP: Record<string, string> = {
  'ा': 'ā', 'ि': 'i', 'ी': 'ī', 'ु': 'u', 'ू': 'ū',
  'ृ': 'ṛ', 'ॄ': 'ṝ', 'ॢ': 'ḷ', 'ॣ': 'ḹ',
  'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au',
};

const CONSONANT_MAP: Record<string, string> = {
  'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'ṅ',
  'च': 'c', 'छ': 'ch', 'ज': 'j', 'झ': 'jh', 'ञ': 'ñ',
  'ट': 'ṭ', 'ठ': 'ṭh', 'ड': 'ḍ', 'ढ': 'ḍh', 'ण': 'ṇ',
  'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
  'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm',
  'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v',
  'श': 'ś', 'ष': 'ṣ', 'स': 's', 'ह': 'h',
  'ळ': 'ḻ', 'ऴ': 'ḻh',
};

const SPECIAL_MAP: Record<string, string> = {
  'ं': 'ṃ',   // Anusvara
  'ः': 'ḥ',   // Visarga
  'ँ': 'm̐',  // Anunasika / Candrabindu
  'ऽ': "'",   // Avagraha
  '।': '.',   // Danda
  '॥': '..',  // Double Danda
};

const ACCENT_MAP: Record<string, string> = {
  '\u0951': '\u0301', // Udatta (combining acute)
  '\u0952': '\u0300', // Anudatta (combining grave)
};

/**
 * Deterministically converts Classical Sanskrit Devanagari text to Roman IAST.
 */
export function devanagariToIast(text: string): string {
  const normalized = text.normalize('NFC');
  const result: string[] = [];
  let i = 0;
  const n = normalized.length;

  while (i < n) {
    const ch = normalized[i];

    // 1. Standalone Vowels
    if (VOWEL_MAP[ch]) {
      result.push(VOWEL_MAP[ch]);
      i++;
      while (i < n && ACCENT_MAP[normalized[i]]) {
        result.push(ACCENT_MAP[normalized[i]]);
        i++;
      }
      continue;
    }

    // 2. Consonants with inherent schwa
    if (CONSONANT_MAP[ch]) {
      const baseC = CONSONANT_MAP[ch];
      i++;
      if (i < n && normalized[i] === '्') {
        // Virama suppresses inherent 'a'
        result.push(baseC);
        i++;
      } else if (i < n && MATRA_MAP[normalized[i]]) {
        // Matra replaces inherent 'a'
        result.push(baseC);
        result.push(MATRA_MAP[normalized[i]]);
        i++;
        while (i < n && ACCENT_MAP[normalized[i]]) {
          result.push(ACCENT_MAP[normalized[i]]);
          i++;
        }
      } else {
        // Inherent 'a'
        result.push(baseC);
        result.push('a');
        while (i < n && ACCENT_MAP[normalized[i]]) {
          result.push(ACCENT_MAP[normalized[i]]);
          i++;
        }
      }
      continue;
    }

    // 3. Special Characters and Diacritics
    if (SPECIAL_MAP[ch]) {
      result.push(SPECIAL_MAP[ch]);
      i++;
      while (i < n && ACCENT_MAP[normalized[i]]) {
        result.push(ACCENT_MAP[normalized[i]]);
        i++;
      }
      continue;
    }

    // 3b. Standalone / Orphan Vedic accents
    if (ACCENT_MAP[ch]) {
      result.push(ACCENT_MAP[ch]);
      i++;
      continue;
    }

    // 4. Numerals, spaces, and pass-through characters
    result.push(ch);
    i++;
  }

  return result.join('').normalize('NFC');
}

/**
 * Transliterate Classical Sanskrit Devanagari text to Roman IAST.
 */
export function transliterateIast(text: string): string {
  return devanagariToIast(text);
}
