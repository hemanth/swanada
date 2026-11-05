import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  LANGUAGE_REGISTRY,
  TokenRegistry,
  detectScript,
  devanagariToIast,
  transliterateIast,
  Swanada,
  AcousticEngine,
} from '../dist/index.mjs';

describe('Multilingual Registry and Sanskrit IAST Suite', () => {
  it('covers all 12 supported languages in LANGUAGE_REGISTRY', () => {
    const expected = ['sa', 'en', 'hi', 'kn', 'mr', 'bn', 'ta', 'te', 'ml', 'gu', 'pa', 'or'];
    for (const code of expected) {
      assert.ok(LANGUAGE_REGISTRY[code], `Registry missing language ${code}`);
      assert.strictEqual(LANGUAGE_REGISTRY[code].code, code);
      assert.ok(LANGUAGE_REGISTRY[code].vocabFilename.endsWith('.json'));
      assert.ok(LANGUAGE_REGISTRY[code].modelFilename.endsWith('.onnx'));
    }
    assert.strictEqual(Object.keys(LANGUAGE_REGISTRY).length, 12);
  });

  it('TokenRegistry enforces blank token at class 0 and maintains bijective lookup', () => {
    assert.throws(() => {
      new TokenRegistry(['a', 'b', 'c']);
    }, /Class index 0 must be reserved for <blank>/);

    const tokens = ['<blank>', '<unk>', 'क', 'ख', 'ग'];
    const reg = new TokenRegistry(tokens);
    assert.strictEqual(reg.size, 5);
    assert.strictEqual(reg.getToken(0), '<blank>');
    assert.strictEqual(reg.getToken(2), 'क');
    assert.strictEqual(reg.getId('<blank>'), 0);
    assert.strictEqual(reg.getId('क'), 2);
    assert.strictEqual(reg.getId('unknown_token'), 1); // <unk>
  });

  it('detectScript correctly classifies text by script codepoints', () => {
    assert.strictEqual(detectScript('संस्कृतम्'), 'sa');
    assert.strictEqual(detectScript('ಕನ್ನಡ'), 'kn');
    assert.strictEqual(detectScript('தமிழ்'), 'ta');
    assert.strictEqual(detectScript('తెలుగు'), 'te');
    assert.strictEqual(detectScript('മലയാളം'), 'ml');
    assert.strictEqual(detectScript('বাংলা'), 'bn');
    assert.strictEqual(detectScript('ગુજરાતી'), 'gu');
    assert.strictEqual(detectScript('ਪੰਜਾਬੀ'), 'pa');
    assert.strictEqual(detectScript('ଓଡ଼ିଆ'), 'or');
    assert.strictEqual(detectScript('Hello Indian English'), 'en');
    // Defect SD-1 tests
    assert.strictEqual(detectScript('مرحبا بكم في عالم التعرف على الكلام'), null);
    assert.strictEqual(detectScript('Привет, это проверка распознавания речи'), null);
    assert.strictEqual(detectScript('Γειά σου κόσμε'), null);
    assert.strictEqual(detectScript('क! ख? ग.'), 'sa');
    assert.strictEqual(detectScript('   '), null);
  });

  it('devanagariToIast transcribes Classical Sanskrit with 100% exact phonetic parity', () => {
    const input = 'अहं तत्रत्यानां कतिपयसौकर्याणां विषये ज्ञातुमिच्छामि';
    const expected = 'ahaṃ tatratyānāṃ katipayasaukaryāṇāṃ viṣaye jñātumicchāmi';
    const actual = devanagariToIast(input);
    assert.strictEqual(actual, expected);
    assert.strictEqual(transliterateIast(input), expected);
    assert.strictEqual(Swanada.transliterateIast(input), expected);
  });

  it('devanagariToIast correctly handles vocalic liquids, ayogavāhas, avagraha, and Vedic accents', () => {
    // Vocalic liquids
    assert.strictEqual(devanagariToIast('ऋषि'), 'ṛṣi');
    assert.strictEqual(devanagariToIast('पितॄन्'), 'pitṝn');
    assert.strictEqual(devanagariToIast('कॢप्त'), 'kḷpta');

    // Ayogavāhas and Avagraha
    assert.strictEqual(devanagariToIast('नमः शिवाय'), 'namaḥ śivāya');
    assert.strictEqual(devanagariToIast('सोऽहम्'), "so'ham");
    assert.strictEqual(devanagariToIast('हँस'), 'ham̐sa');

    // Danda
    assert.strictEqual(devanagariToIast('शान्तिः । शान्तिः ॥'), 'śāntiḥ . śāntiḥ ..');

    // Vedic accents (Udatta U+0951, Anudatta U+0952)
    const vedic = 'अ॒ग्निमी॑ळे';
    const iastVedic = devanagariToIast(vedic);
    assert.ok(iastVedic.includes('gni'));
    assert.ok(iastVedic.includes('ḻe'));

    // Defect IAST-1: Accents following ayogavahas & orphan accents
    assert.strictEqual(devanagariToIast('भूर्भुवः॒'), 'bhūrbhuvaḥ̀');
    assert.strictEqual(devanagariToIast('स्वः॑'), 'svaḥ́');
    assert.strictEqual(devanagariToIast('मर्त्यं॑'), 'martyaṃ́');
    assert.strictEqual(devanagariToIast('वरेण्यं॒'), 'vareṇyaṃ̀');
  });

  it('VAD silence energy gate bypasses inference on digital silence (RMS < 1e-4)', async () => {
    const engine = await AcousticEngine.create({ language: 'sa' });
    const silence = new Float32Array(16000); // 1 second of zero silence

    const res = await engine.transcribe(silence);
    assert.strictEqual(res.text, '');
    assert.strictEqual(res.tokens.length, 0);
    assert.strictEqual(res.language, 'sa');
    assert.strictEqual(res.durationMs, 1000);
    assert.ok(res.inferenceMs < 2.0, `Inference should be under 2ms, was ${res.inferenceMs}`);
  });

  it('throws descriptive error if acousticSession is not initialized on non-silent audio', async () => {
    const engine = new AcousticEngine({}, { language: 'sa' });
    const nonSilent = new Float32Array(1600).fill(0.5); // non-silent PCM
    await assert.rejects(
      async () => {
        await engine.transcribe(nonSilent);
      },
      /Acoustic model session is not initialized\. Ensure models are available at modelPath\./
    );
  });
});
