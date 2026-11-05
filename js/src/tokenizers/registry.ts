/**
 * Multilingual Vocabulary Registry and Script Metadata for Swanada Web & Node.
 */

export type SupportedLanguage =
  | 'sa' | 'en' | 'hi' | 'kn' | 'mr' | 'bn'
  | 'ta' | 'te' | 'ml' | 'gu' | 'pa' | 'or';

export interface LanguageMeta {
  code: SupportedLanguage;
  name: string;
  nativeName: string;
  script: string;
  unicodeRange: [number, number];
  vocabFilename: string;
  modelFilename: string;
}

export const LANGUAGE_REGISTRY: Record<SupportedLanguage, LanguageMeta> = {
  sa: { code: 'sa', name: 'Sanskrit', nativeName: 'संस्कृतम्', script: 'Devanagari', unicodeRange: [0x0900, 0x097f], vocabFilename: 'sa_vocab.json', modelFilename: 'swanada_sa_ctc_int8.onnx' },
  hi: { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', script: 'Devanagari', unicodeRange: [0x0900, 0x097f], vocabFilename: 'hi_vocab.json', modelFilename: 'swanada_hi_ctc_int8.onnx' },
  kn: { code: 'kn', name: 'Kannada', nativeName: 'ಕನ್ನಡ', script: 'Kannada', unicodeRange: [0x0c80, 0x0cff], vocabFilename: 'kn_vocab.json', modelFilename: 'swanada_kn_ctc_int8.onnx' },
  mr: { code: 'mr', name: 'Marathi', nativeName: 'मराठी', script: 'Devanagari', unicodeRange: [0x0900, 0x097f], vocabFilename: 'mr_vocab.json', modelFilename: 'swanada_mr_ctc_int8.onnx' },
  bn: { code: 'bn', name: 'Bengali', nativeName: 'বাংলা', script: 'Bengali', unicodeRange: [0x0980, 0x09ff], vocabFilename: 'bn_vocab.json', modelFilename: 'swanada_bn_ctc_int8.onnx' },
  ta: { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்', script: 'Tamil', unicodeRange: [0x0b80, 0x0bff], vocabFilename: 'ta_vocab.json', modelFilename: 'swanada_ta_ctc_int8.onnx' },
  te: { code: 'te', name: 'Telugu', nativeName: 'తెలుగు', script: 'Telugu', unicodeRange: [0x0c00, 0x0c7f], vocabFilename: 'te_vocab.json', modelFilename: 'swanada_te_ctc_int8.onnx' },
  ml: { code: 'ml', name: 'Malayalam', nativeName: 'മലയാളം', script: 'Malayalam', unicodeRange: [0x0d00, 0x0d7f], vocabFilename: 'ml_vocab.json', modelFilename: 'swanada_ml_ctc_int8.onnx' },
  gu: { code: 'gu', name: 'Gujarati', nativeName: 'ગુજરાતી', script: 'Gujarati', unicodeRange: [0x0a80, 0x0aff], vocabFilename: 'gu_vocab.json', modelFilename: 'swanada_gu_ctc_int8.onnx' },
  pa: { code: 'pa', name: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ', script: 'Gurmukhi', unicodeRange: [0x0a00, 0x0a7f], vocabFilename: 'pa_vocab.json', modelFilename: 'swanada_pa_ctc_int8.onnx' },
  or: { code: 'or', name: 'Odia', nativeName: 'ଓଡ଼ିଆ', script: 'Odia', unicodeRange: [0x0b00, 0x0b7f], vocabFilename: 'or_vocab.json', modelFilename: 'swanada_or_ctc_int8.onnx' },
  en: { code: 'en', name: 'Indian English', nativeName: 'English', script: 'Latin', unicodeRange: [0x0020, 0x007e], vocabFilename: 'en_vocab.json', modelFilename: 'swanada_en_ctc_int8.onnx' },
};

export class TokenRegistry {
  private idToToken: string[];
  private tokenToId: Map<string, number>;

  constructor(tokens: string[]) {
    this.idToToken = [...tokens];
    this.tokenToId = new Map();
    for (let i = 0; i < tokens.length; i++) {
      this.tokenToId.set(tokens[i], i);
    }
    if (this.idToToken[0] !== '<blank>') {
      throw new Error('Class index 0 must be reserved for <blank>');
    }
  }

  getToken(id: number): string {
    return this.idToToken[id] ?? '<unk>';
  }

  getId(token: string): number {
    return this.tokenToId.get(token) ?? 1; // 1 = <unk>
  }

  get size(): number {
    return this.idToToken.length;
  }

  get tokens(): string[] {
    return [...this.idToToken];
  }
}

/**
 * Detect language/script code from Unicode codepoint frequencies.
 */
export function detectScript(text: string): SupportedLanguage | null {
  const counts: Partial<Record<SupportedLanguage, number>> = {};
  for (let i = 0; i < text.length; i++) {
    const cp = text.charCodeAt(i);
    for (const [lang, meta] of Object.entries(LANGUAGE_REGISTRY)) {
      if (lang === 'en') {
        // Restrict English strictly to Latin alphabetic letters (A-Z, a-z)
        // to prevent ASCII spaces and punctuation from leaking into English.
        if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) {
          counts['en'] = (counts['en'] || 0) + 1;
          break;
        }
      } else {
        const [start, end] = meta.unicodeRange;
        if (cp >= start && cp <= end) {
          const key = lang as SupportedLanguage;
          counts[key] = (counts[key] || 0) + 1;
          break;
        }
      }
    }
  }

  let bestLang: SupportedLanguage | null = null;
  let maxCount = 0;
  for (const [lang, cnt] of Object.entries(counts)) {
    if (cnt && cnt > maxCount) {
      maxCount = cnt;
      bestLang = lang as SupportedLanguage;
    }
  }
  return bestLang;
}
