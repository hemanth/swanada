import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  repairBrahmicOrthography,
  normalizeIndicText,
  joinSubwords,
} from '../src/decoder/normalizer.ts';

describe('Adversarial Brahmic Orthography and Cross-Runtime Hardening Suite', () => {
  describe('Category 1: Retroflex lateral ligatures in Kannada, Telugu, and Odia', () => {
    const lateralCases = [
      // Kannada
      ['ಸ್ಥಗಿತಗೊಳಳ್ಸಿದೆ', 'ಸ್ಥಗಿತಗೊಳ್ಸಿದೆ', 'kn'],
      ['ಗೊಳಳ್', 'ಗೊಳ್', 'kn'],
      ['ಗೊಳಳಳ್', 'ಗೊಳ್', 'kn'],
      ['ಬೆಳ್ಳಿ', 'ಬೆಳ್ಳಿ', 'kn'], // Genuine geminate preserved
      ['ಎಳ್ಳು', 'ಎಳ್ಳು', 'kn'],   // Genuine geminate preserved
      ['ಕಳ್ಳ', 'ಕಳ್ಳ', 'kn'],     // Genuine geminate preserved
      ['ಬೆಳಕು', 'ಬೆಳಕು', 'kn'],   // Single lateral preserved
      // Telugu
      ['కోళళ్సింది', 'కోళ్సింది', 'te'],
      ['కోళళ్', 'కోళ్', 'te'],
      ['కో\u0C33\u0C33\u0C33\u0C4D', 'కోళ్', 'te'],
      ['పెళ్ళి', 'పెళ్ళి', 'te'], // Genuine geminate preserved
      ['నీళ్ళు', 'నీళ్ళు', 'te'], // Genuine geminate preserved
      ['కాలము', 'కాలము', 'te'],   // Single lateral preserved
      // Odia
      ['କଳଳ୍ସିଦେ', 'କଳ୍ସିଦେ', 'or'],
      ['କଳଳ୍', 'କଳ୍', 'or'],
      ['କଳଳଳ୍', 'କଳ୍', 'or'],
      ['ବିଳ୍ଳ', 'ବିଳ୍ଳ', 'or'],   // Genuine geminate preserved
      ['ବେଳ', 'ବେଳ', 'or'],       // Single lateral preserved
    ];

    for (const [raw, expected, lang] of lateralCases) {
      it(`normalizes ${raw} -> ${expected} (${lang})`, () => {
        const out = repairBrahmicOrthography(raw, lang);
        assert.equal(out, expected);
      });
    }
  });

  describe('Category 2: Malayalam nasal geminates and candrakkala handling', () => {
    const malayalamCases = [
      ['ഉംമാ', 'ഉമ്മാ', 'ml'],
      ['ഒംന', 'ഒന്ന', 'ml'],
      ['കംണ', 'കണ്ണ', 'ml'],
      ['മംഞ', 'മഞ്ഞ', 'ml'],
      ['തംങ', 'തങ്ങ', 'ml'],
      ['ഉംമാ ഒംന കംണ തംങ മംഞ', 'ഉമ്മാ ഒന്ന കണ്ണ തങ്ങ മഞ്ഞ', 'ml'],
      ['അംബരം', 'അംബരം', 'ml'],
      ['സമ്പത്ത്', 'സമ്പത്ത്', 'ml'],
      ['ഹംസം', 'ഹംസം', 'ml'],
      ['സിംഹം', 'സിംഹം', 'ml'],
      ['വിശ്വ', 'വിശ്വ', 'ml'],
      ['വിശ്വാസം', 'വിശ്വാസം', 'ml'],
    ];

    for (const [raw, expected, lang] of malayalamCases) {
      it(`normalizes ${raw} -> ${expected} (${lang})`, () => {
        const out = repairBrahmicOrthography(raw, lang);
        assert.equal(out, expected);
      });
    }
  });

  describe('Category 3: Gujarati sibilants and ablative postposition થી', () => {
    const gujaratiCases = [
      ['હું જઈષ', 'હું જઈશ', 'gu'],
      ['હું જઈષ અને', 'હું જઈશ અને', 'gu'],
      ['તેઓ જઈષ.', 'તેઓ જઈશ.', 'gu'],
      ['હું જઈષ અને તું જઈષ', 'હું જઈશ અને તું જઈશ', 'gu'],
      ['વિષ', 'વિષ', 'gu'],
      ['વિશેષ', 'વિશેષ', 'gu'],
      ['ઋષિ', 'ઋષિ', 'gu'],
      ['દોષ', 'દોષ', 'gu'],
      ['કર્ષણ', 'કર્ષણ', 'gu'],
      ['ભાષા', 'ભાષા', 'gu'],
      ['હર્ષ', 'હર્ષ', 'gu'],
      ['બસથી', 'બસથી', 'gu'],
      ['સ્થિતિ', 'સ્થિતિ', 'gu'],
      ['અસ્થિ', 'અસ્થિ', 'gu'],
      ['પ્રસ્થાન', 'પ્રસ્થાન', 'gu'],
      ['ઉપસ્થિત', 'ઉપસ્થિત', 'gu'],
      ['સ્થળ', 'સ્થળ', 'gu'],
      ['સંસ્થા', 'સંસ્થા', 'gu'],
    ];

    for (const [raw, expected, lang] of gujaratiCases) {
      it(`normalizes ${raw} -> ${expected} (${lang})`, () => {
        const out = repairBrahmicOrthography(raw, lang);
        assert.equal(out, expected);
      });
    }
  });

  describe('Category 4: Odia detached anusvara and dative suffix ଙ୍କୁ', () => {
    const odiaCases = [
      ['ସଧ୍ୟାଂଙ୍କୁ', 'ସଧ୍ୟାଙ୍କୁ', 'or'],
      ['ଂଙ୍କ', 'ଙ୍କ', 'or'],
      ['ଂଙ୍ଖ', 'ଙ୍ଖ', 'or'],
      ['ଂଙ୍ଗ', 'ଙ୍ଗ', 'or'],
      ['ଂଙ୍ଘ', 'ଙ୍ଘ', 'or'],
      ['ସଧ୍ୟଂକୁ', 'ସଧ୍ୟଙ୍କୁ', 'or'],
      ['ତାହାଂକୁ', 'ତାହାଙ୍କୁ', 'or'],
      ['ପିଲାଂକୁ', 'ପିଲାଙ୍କୁ', 'or'],
      ['ରାମଂକୁ', 'ରାମଙ୍କୁ', 'or'],
      ['ରାମଂକୁ ଦିଅ', 'ରାମଙ୍କୁ ଦିଅ', 'or'],
      ['ସଂସାର', 'ସଂସାର', 'or'],
      ['ଅଂଶ', 'ଅଂଶ', 'or'],
      ['ସିଂହ', 'ସିଂହ', 'or'],
      ['ସଂଗୀତ', 'ସଂଗୀତ', 'or'],
      ['ସନ୍ଧ୍ୟାଙ୍କୁ', 'ସନ୍ଧ୍ୟାଙ୍କୁ', 'or'],
    ];

    for (const [raw, expected, lang] of odiaCases) {
      it(`normalizes ${raw} -> ${expected} (${lang})`, () => {
        const out = repairBrahmicOrthography(raw, lang);
        assert.equal(out, expected);
      });
    }
  });

  describe('Category 5: Conditional subword joining behavior', () => {
    const joinCases = [
      { committed: 'ಆಗ', volatile: 'ಾಗಿ', vToks: ['ಾಗಿ'], expected: 'ಆಗಾಗಿ' },
      { committed: 'the', volatile: 'king', vToks: [' king'], expected: 'the king' },
      { committed: 'ಆಗ', volatile: '\u0CCD', vToks: ['\u0CCD'], expected: 'ಆಗ್' },
      { committed: 'sub-', volatile: 'word', vToks: ['word'], expected: 'sub-word' },
      { committed: 'done', volatile: '.', vToks: ['.'], expected: 'done.' },
      { committed: '', volatile: 'stream', vToks: ['stream'], expected: 'stream' },
      { committed: 'stream', volatile: '', vToks: [], expected: 'stream' },
    ];

    for (const { committed, volatile, vToks, expected } of joinCases) {
      it(`joins "${committed}" + "${volatile}" -> "${expected}"`, () => {
        const out = joinSubwords(committed, volatile, vToks);
        assert.equal(out, expected);
      });
    }
  });
});
