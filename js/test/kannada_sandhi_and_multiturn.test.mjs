import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {
  getIndicLexicon,
  classifyIndicWord,
  StreamingAcousticEngine,
  Swanada,
  parseWav,
} from '../dist/index.mjs';

function resolveRepoPath(rel) {
  const p1 = path.resolve(rel);
  if (fs.existsSync(p1)) return p1;
  const p2 = path.resolve('..', rel);
  if (fs.existsSync(p2)) return p2;
  return rel;
}

function createWorkletSim(hardwareSr = 48000, opts = {}) {
  const events = [];
  class FakeAudioWorkletProcessor {
    constructor() {
      this.port = {
        postMessage: (msg, transferList) => events.push({ msg, transferList }),
        set onmessage(_fn) {},
        get onmessage() { return null; },
      };
    }
  }
  let ProcessorClass = null;
  const sandbox = {
    AudioWorkletProcessor: FakeAudioWorkletProcessor,
    registerProcessor: (_name, ctor) => { ProcessorClass = ctor; },
    sampleRate: hardwareSr,
    Float32Array,
    Math,
    Number,
    console,
  };
  const workletPath = resolveRepoPath('docs/audio-capture-worklet.js');
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(workletPath, 'utf8'), sandbox);
  const proc = new ProcessorClass({ processorOptions: opts });
  return {
    events,
    step: (quantum) => proc.process([[quantum]], [], {}),
  };
}

describe('Kannada Sandhi Lexicon, ALC Noise Guard & Explicit-Language Multi-Turn Streaming', () => {
  it('scores Dravidian Lopasandhi compounds and conversational Kannada suffixes above OOV', () => {
    const { core, ext } = getIndicLexicon('kn');
    // Lopasandhi: ನಮ್ಮ + ಅಮ್ಮ -> ನಮ್ಮಮ್ಮ (short inherent 'a' elision before 'ಅಮ್ಮ')
    assert.ok(classifyIndicWord('ನಮ್ಮಮ್ಮ', 'kn', core, ext) >= 1, 'Expected ನಮ್ಮಮ್ಮ to be recognized via Dravidian Lopasandhi');
    // Emphatic clitic & Agama sandhi suffixes
    assert.ok(classifyIndicWord('ಕನ್ನಡವೇ', 'kn', core, ext) >= 1, 'Expected ಕನ್ನಡವೇ (-ವೇ emphatic clitic) to score >= 1');
    assert.ok(classifyIndicWord('ಮುಗಿಯಮ್ಮ', 'kn', core, ext) >= 1, 'Expected ಮುಗಿಯಮ್ಮ (-ಯಮ್ಮ vocative suffix) to score >= 1');
    assert.ok(classifyIndicWord('ಹೇಳಿದ್ರೆ', 'kn', core, ext) >= 1, 'Expected ಹೇಳಿದ್ರೆ (-ಇದ್ರೆ colloquial conditional) to score >= 1');
  });

  it('AudioWorklet ALC does NOT boost steady ambient room silence (-50 dBFS) while boosting quiet speech', () => {
    const sim = createWorkletSim(16000, { chunkSamples: 1600, alcEnabled: true });

    // Feed 1.5s of steady -50 dBFS (amplitude ~0.003) room tone
    const quietRoom = new Float32Array(128);
    for (let q = 0; q < 190; q++) {
      for (let i = 0; i < 128; i++) {
        quietRoom[i] = Math.sin((2 * Math.PI * 300 * (q * 128 + i)) / 16000) * 0.003;
      }
      sim.step(quietRoom);
    }

    assert.ok(sim.events.length >= 10);
    const lastSilenceChunk = sim.events[sim.events.length - 1].msg;
    assert.ok(
      lastSilenceChunk.rms < 0.005,
      `ALC must NOT boost steady 0.0021 RMS room hiss by 5x; got RMS=${lastSilenceChunk.rms}`
    );

    // Now feed quiet speech at ~0.025 amplitude (~0.0177 RMS) and confirm ALC boosts it toward target
    const prevCount = sim.events.length;
    const quietSpeech = new Float32Array(128);
    for (let q = 0; q < 80; q++) {
      for (let i = 0; i < 128; i++) {
        quietSpeech[i] = Math.sin((2 * Math.PI * 440 * (q * 128 + i)) / 16000) * 0.025;
      }
      sim.step(quietSpeech);
    }
    const boostedChunks = sim.events.slice(prevCount).map((e) => e.msg);
    const maxSpeechRms = Math.max(...boostedChunks.map((c) => c.rms));
    assert.ok(
      maxSpeechRms > 0.025,
      `ALC should boost confirmed speech above raw 0.0177 RMS; got max RMS=${maxSpeechRms}`
    );
  });

  it('preserves earlier spoken sentences across >500ms pauses in explicit Kannada streaming mode', async () => {
    const modelPath = resolveRepoPath('models/onnx/sushrota_sanskrit_ctc_int8.onnx');
    const headPath = resolveRepoPath('models/heads/kn.bin');
    const adapterPath = resolveRepoPath('models/heads/kn_adapter.bin');
    const vocabPath = resolveRepoPath('models/vocabularies/kn_vocab.json');
    const sampleWav = resolveRepoPath('docs/samples/kn.wav');

    if (!fs.existsSync(modelPath) || !fs.existsSync(headPath) || !fs.existsSync(sampleWav)) {
      return;
    }

    const stt = await Swanada.create({
      language: 'kn',
      modelPath,
      headPath,
      adapterPath: fs.existsSync(adapterPath) ? adapterPath : undefined,
      vocabPath,
    });

    try {
      const { pcm } = parseWav(fs.readFileSync(sampleWav));
      // Use first 1.8s of kn.wav as Turn 1, 0.7s silence pause, then repeat Turn 1 as Turn 2
      const turnPcm = pcm.subarray(0, Math.min(pcm.length, 28800));
      const singleRes = await stt.transcribe(turnPcm);
      const firstWord = singleRes.text.trim().split(/\s+/)[0];
      assert.ok(firstWord.length >= 2, `Expected non-empty single-turn Kannada text, got "${singleRes.text}"`);

      const stream = new StreamingAcousticEngine(stt.engine, stt.engine.getVocab());
      const chunkSize = 3200; // 200ms
      for (let i = 0; i < turnPcm.length; i += chunkSize) {
        await stream.push(turnPcm.subarray(i, Math.min(turnPcm.length, i + chunkSize)));
      }

      // 700ms pause (4 x 200ms zero chunks) triggers segmentTurnOnPause()
      const silence200ms = new Float32Array(chunkSize);
      for (let s = 0; s < 4; s++) {
        await stream.push(silence200ms);
      }
      assert.equal(stream.hasPriorTurns(), true, 'Explicit kn stream must bank prior turn on >500ms pause');

      // Second spoken turn
      for (let i = 0; i < turnPcm.length; i += chunkSize) {
        await stream.push(turnPcm.subarray(i, Math.min(turnPcm.length, i + chunkSize)));
      }

      const expectedTotalSamples = turnPcm.length * 2 + silence200ms.length * 4;
      assert.equal(
        stream.getTotalAudioSamples(),
        expectedTotalSamples,
        'Total cumulative audio sample count must track full multi-turn stream before finish()'
      );

      const finalRes = await stream.finish();
      const occurrences = finalRes.text.split(firstWord).length - 1;
      assert.ok(
        occurrences >= 2,
        `Expected Turn 1 and Turn 2 both preserved across pause ("${firstWord}" >= 2x), got: "${finalRes.text}"`
      );
      assert.equal(
        finalRes.durationMs,
        Math.round((expectedTotalSamples / 16000) * 1000),
        'finish() durationMs must reflect cumulative multi-turn audio duration'
      );
    } finally {
      await stt.release();
    }
  });
});
