/**
 * Milestone 5 Iteration 3 Gate Verification: Adversarial Interspeech Pause & Acoustic Churn Suite.
 *
 * Evaluates:
 * 1. Interspeech pauses (500ms inserted digital silence) across all 12 supported Indic languages.
 * 2. Artificial stop consonant closure intervals (80ms silence bursts) across representative languages.
 * 3. Extended trailing silence (4.0s zero-padding) ensuring zero text erasure and strict monotonic prefix.
 * 4. Multi-pause stress across diverse durations (200ms, 600ms, 1200ms).
 *
 * Strictly verifies 0.00% character churn.
 * Zero first-person pronouns in comments, identifiers, logs, and strings.
 */

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Swanada, parseWav } from '../js/dist/index.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const SAMPLES_DIR = path.resolve(ROOT_DIR, 'docs', 'samples');

const ALL_LANGUAGES = ['sa', 'en', 'hi', 'kn', 'mr', 'bn', 'ta', 'te', 'ml', 'gu', 'pa', 'or'];

/**
 * Streams audio array chunk-by-chunk and validates prefix monotonicity.
 */
async function verifyStreamMonotonicity(audioPcm, sttEngine, chunkSize = 1600) {
  const stream = sttEngine.createStream();
  const history = [];

  for (let offset = 0; offset < audioPcm.length; offset += chunkSize) {
    const chunk = audioPcm.subarray(offset, Math.min(audioPcm.length, offset + chunkSize));
    const partial = await stream.push(chunk);

    if (partial && partial.committed) {
      if (history.length === 0 || partial.committed !== history[history.length - 1]) {
        if (history.length > 0) {
          const prev = history[history.length - 1];
          const curr = partial.committed;
          if (!curr.startsWith(prev)) {
            throw new Error(`Character churn detected: prev="${prev}" curr="${curr}"`);
          }
        }
        history.push(partial.committed);
      }
    }
  }

  const finalResult = await stream.finish();
  const finalText = finalResult ? finalResult.text : '';

  if (history.length > 0) {
    const lastCommitted = history[history.length - 1];
    if (!finalText.startsWith(lastCommitted)) {
      throw new Error(`Final result retracted from committed prefix: committed="${lastCommitted}" final="${finalText}"`);
    }
  }

  return { history, finalText };
}

/**
 * Test 1: Interspeech pause across all 12 supported languages.
 */
async function testAll12LanguagesPause500ms() {
  console.log('--- TEST 1: Interspeech Pause Stability (500ms) Across All 12 Languages ---');

  for (const lang of ALL_LANGUAGES) {
    const wavPath = path.join(SAMPLES_DIR, `${lang}.wav`);
    assert.ok(fs.existsSync(wavPath), `Sample audio file missing for ${lang}: ${wavPath}`);

    const buffer = fs.readFileSync(wavPath);
    const parsed = parseWav(buffer);
    const pcm = parsed.pcm;

    // Splice 500ms (8000 samples @ 16kHz) digital silence at midpoint
    const mid = Math.floor(pcm.length / 2);
    const pausedAudio = new Float32Array(pcm.length + 8000);
    pausedAudio.set(pcm.subarray(0, mid), 0);
    pausedAudio.set(pcm.subarray(mid), mid + 8000);

    const stt = await Swanada.create({ language: lang });
    try {
      const { history, finalText } = await verifyStreamMonotonicity(pausedAudio, stt, 1600);

      assert.ok(finalText.trim().length > 0, `[${lang}] Final transcribed text must not be empty`);
      console.log(`[${lang}] PASS: 0 churn | commits: ${history.length} | final: "${finalText.slice(0, 40)}"`);
    } finally {
      await stt.release();
    }
  }
}

/**
 * Test 2: Stop consonant artificial closures (80ms silence bursts at quarter points).
 */
async function testArtificialStopClosures() {
  console.log('--- TEST 2: Stop Consonant Artificial Closures (80ms Bursts) ---');
  const targetLanguages = ['sa', 'en', 'hi', 'ta'];

  for (const lang of targetLanguages) {
    const wavPath = path.join(SAMPLES_DIR, `${lang}.wav`);
    const buffer = fs.readFileSync(wavPath);
    const parsed = parseWav(buffer);
    const pcm = parsed.pcm;

    // Splice 80ms (1280 samples @ 16kHz) silence intervals at quarter points
    const segLen = Math.floor(pcm.length / 4);
    const splicedLength = pcm.length + 3 * 1280;
    const splicedAudio = new Float32Array(splicedLength);

    let writePos = 0;
    for (let segIdx = 0; segIdx < 4; segIdx++) {
      const start = segIdx * segLen;
      const end = segIdx < 3 ? (segIdx + 1) * segLen : pcm.length;
      const seg = pcm.subarray(start, end);
      splicedAudio.set(seg, writePos);
      writePos += seg.length;
      if (segIdx < 3) {
        writePos += 1280; // 80ms silence burst
      }
    }

    const stt = await Swanada.create({ language: lang });
    try {
      const { history, finalText } = await verifyStreamMonotonicity(splicedAudio, stt, 1600);

      assert.ok(finalText.trim().length > 0, `[${lang}] Final transcribed text must not be empty`);
      console.log(`[${lang}] STOP CLOSURES PASS: 0 churn | commits: ${history.length} | final: "${finalText.slice(0, 40)}"`);
    } finally {
      await stt.release();
    }
  }
}

/**
 * Test 3: Extended trailing silence (4.0s / 64,000 zero samples).
 */
async function testExtendedTrailingSilence() {
  console.log('--- TEST 3: Extended Trailing Silence (4.0s Zero Padding) ---');
  const targetLanguages = ['sa', 'en', 'hi', 'kn'];

  for (const lang of targetLanguages) {
    const wavPath = path.join(SAMPLES_DIR, `${lang}.wav`);
    const buffer = fs.readFileSync(wavPath);
    const parsed = parseWav(buffer);
    const pcm = parsed.pcm;

    // Append 4.0s (64,000 samples @ 16kHz) trailing zero padding
    const extendedAudio = new Float32Array(pcm.length + 64000);
    extendedAudio.set(pcm, 0);

    const stt = await Swanada.create({ language: lang });
    try {
      const { history, finalText } = await verifyStreamMonotonicity(extendedAudio, stt, 1600);

      assert.ok(finalText.trim().length > 0, `[${lang}] Final transcribed text must not be erased`);
      console.log(`[${lang}] TRAILING SILENCE PASS: 0 churn | commits: ${history.length} | final: "${finalText.slice(0, 40)}"`);
    } finally {
      await stt.release();
    }
  }
}

/**
 * Test 4: Variable pause durations (200ms, 600ms, 1200ms) within single stream.
 */
async function testMultiPauseStress() {
  console.log('--- TEST 4: Multi-Pause Stress (200ms, 600ms, 1200ms) ---');
  const targetLanguages = ['sa', 'hi', 'bn'];

  for (const lang of targetLanguages) {
    const wavPath = path.join(SAMPLES_DIR, `${lang}.wav`);
    const buffer = fs.readFileSync(wavPath);
    const parsed = parseWav(buffer);
    const pcm = parsed.pcm;

    // Segment into 4 quarters with 200ms (3200), 600ms (9600), 1200ms (19200) pauses
    const pauses = [3200, 9600, 19200];
    const totalLength = pcm.length + 3200 + 9600 + 19200;
    const multiPausedAudio = new Float32Array(totalLength);

    const segLen = Math.floor(pcm.length / 4);
    let writePos = 0;
    for (let segIdx = 0; segIdx < 4; segIdx++) {
      const start = segIdx * segLen;
      const end = segIdx < 3 ? (segIdx + 1) * segLen : pcm.length;
      const seg = pcm.subarray(start, end);
      multiPausedAudio.set(seg, writePos);
      writePos += seg.length;
      if (segIdx < 3) {
        writePos += pauses[segIdx];
      }
    }

    const stt = await Swanada.create({ language: lang });
    try {
      const { history, finalText } = await verifyStreamMonotonicity(multiPausedAudio, stt, 1600);

      assert.ok(finalText.trim().length > 0, `[${lang}] Final text must not be empty`);
      console.log(`[${lang}] MULTI-PAUSE PASS: 0 churn | commits: ${history.length} | final: "${finalText.slice(0, 40)}"`);
    } finally {
      await stt.release();
    }
  }
}

async function main() {
  console.log('=== STARTING ADVERSARIAL PAUSE CHURN & MONOTONICITY SUITE ===');
  await testAll12LanguagesPause500ms();
  await testArtificialStopClosures();
  await testExtendedTrailingSilence();
  await testMultiPauseStress();
  console.log('=== ALL ADVERSARIAL STABILITY TESTS PASSED WITH 0.00% CHURN ===');
}

main().catch((err) => {
  console.error('ADVERSARIAL TEST FAILED:', err);
  process.exit(1);
});
