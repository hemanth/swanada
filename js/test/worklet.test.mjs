import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { SwanadaAudioCapture } from '../dist/index.mjs';

function createProcessorSim(hardwareSr = 48000, opts = {}) {
  const events = [];
  let onmessageHandler = null;

  class FakeAudioWorkletProcessor {
    constructor() {
      this.port = {
        postMessage: (msg, transferList) => {
          events.push({ msg, transferList });
        },
        set onmessage(fn) { onmessageHandler = fn; },
        get onmessage() { return onmessageHandler; },
      };
    }
  }

  let ProcessorClass = null;
  const sandbox = {
    AudioWorkletProcessor: FakeAudioWorkletProcessor,
    registerProcessor: (name, ctor) => { ProcessorClass = ctor; },
    sampleRate: hardwareSr,
    Float32Array,
    Math,
    Number,
    console,
  };

  const workletPath = fs.existsSync('docs/audio-capture-worklet.js')
    ? 'docs/audio-capture-worklet.js'
    : (fs.existsSync('../docs/audio-capture-worklet.js')
      ? '../docs/audio-capture-worklet.js'
      : 'src/audio/audio-capture-worklet.js');
  const workletSource = fs.readFileSync(workletPath, 'utf8');
  vm.createContext(sandbox);
  vm.runInContext(workletSource, sandbox);

  const proc = new ProcessorClass({ processorOptions: opts });
  return {
    proc,
    events,
    post: (m) => onmessageHandler && onmessageHandler({ data: m }),
    step: (inputQuantum) => {
      proc.process([[inputQuantum]], [], {});
    },
  };
}

describe('Streaming AudioWorklet Processor & Audio Capture Suite (Feature 9)', () => {
  it('accumulates 128-sample quanta into exact 1600-sample chunks at 16 kHz', () => {
    const sim = createProcessorSim(16000, { chunkSamples: 1600 });
    const quantum = new Float32Array(128).fill(0.1);

    // 12 quanta = 1536 samples (< 1600)
    for (let i = 0; i < 12; i++) {
      sim.step(quantum);
    }
    assert.equal(sim.events.length, 0);

    // 13th quantum: 1664 samples >= 1600 -> emits exactly 1 chunk of 1600 samples
    sim.step(quantum);
    assert.equal(sim.events.length, 1);
    const firstChunk = sim.events[0].msg;
    assert.equal(firstChunk.type, 'chunk');
    assert.equal(firstChunk.audioChunk.length, 1600);
    assert.equal(firstChunk.sampleRate, 16000);
    assert.ok(firstChunk.rms > 0.05);
  });

  it('performs 3:1 integer decimation at 48 kHz hardware rate', () => {
    const sim = createProcessorSim(48000, { chunkSamples: 1600 });
    const quantum = new Float32Array(128).fill(0.2);

    // 4800 input samples at 48kHz = 1600 output samples at 16kHz
    // 4800 / 128 = 37.5 quanta
    for (let i = 0; i < 37; i++) {
      sim.step(quantum);
    }
    assert.equal(sim.events.length, 0);

    // 38th quantum pushes total past 4800 samples -> emits 1 chunk
    sim.step(quantum);
    assert.equal(sim.events.length, 1);
    assert.equal(sim.events[0].msg.audioChunk.length, 1600);
  });

  it('performs continuous fractional phase interpolation at 44.1 kHz', () => {
    const sim = createProcessorSim(44100, { chunkSamples: 1600 });
    const quantum = new Float32Array(128);
    for (let i = 0; i < 128; i++) {
      quantum[i] = Math.sin((2 * Math.PI * 440 * i) / 44100) * 0.5;
    }

    // Push ~1 second of 44.1 kHz audio = 44100 samples (~345 quanta)
    for (let i = 0; i < 345; i++) {
      sim.step(quantum);
    }

    // 1 second of 16 kHz audio has 16000 samples = 10 chunks of 1600
    assert.ok(sim.events.length >= 9 && sim.events.length <= 10);
    for (const ev of sim.events) {
      assert.equal(ev.msg.audioChunk.length, 1600);
      assert.ok(ev.msg.rms > 0.1);
    }
  });

  it('attenuates high-frequency content above 7.5 kHz via Butterworth filter', () => {
    const sim = createProcessorSim(48000, { chunkSamples: 1600 });

    // Inject 12 kHz tone at 48 kHz (above 7.5 kHz cutoff)
    const hiFreqQuantum = new Float32Array(128);
    for (let i = 0; i < 128; i++) {
      hiFreqQuantum[i] = Math.sin((2 * Math.PI * 12000 * i) / 48000) * 0.8;
    }

    for (let i = 0; i < 40; i++) {
      sim.step(hiFreqQuantum);
    }
    assert.ok(sim.events.length >= 1);
    const filteredRms = sim.events[0].msg.rms;

    // Filter should attenuate the 12 kHz tone significantly (cutoff 7.5 kHz, 2nd order Butterworth)
    assert.ok(filteredRms < 0.25, `Expected high frequency attenuation, got RMS ${filteredRms}`);
  });

  it('suppresses audio transmission in silenceGateEnabled mode', () => {
    const sim = createProcessorSim(16000, {
      chunkSamples: 1600,
      vadThreshold: 0.01,
      silenceGateEnabled: true,
      vadHangoverFrames: 1,
    });
    const zeroQuantum = new Float32Array(128).fill(0.0);

    for (let i = 0; i < 26; i++) {
      sim.step(zeroQuantum);
    }

    assert.ok(sim.events.length >= 1);
    for (const ev of sim.events) {
      assert.equal(ev.msg.type, 'silence');
      assert.equal(ev.msg.isSpeech, false);
      assert.equal(ev.transferList, undefined);
    }
  });

  it('flushes partial sub-chunk tail on flush command', () => {
    const sim = createProcessorSim(16000, { chunkSamples: 1600 });
    const quantum = new Float32Array(128).fill(0.3);

    // Push only 3 quanta = 384 samples (< 1600)
    sim.step(quantum);
    sim.step(quantum);
    sim.step(quantum);
    assert.equal(sim.events.length, 0);

    // Send flush
    sim.post({ type: 'flush' });
    assert.equal(sim.events.length, 2); // 1 tail chunk + 1 'flushed' event
    const tailMsg = sim.events[0].msg;
    assert.equal(tailMsg.type, 'chunk');
    assert.equal(tailMsg.audioChunk.length, 384);
    assert.equal(tailMsg.isTail, true);

    const flushedMsg = sim.events[1].msg;
    assert.equal(flushedMsg.type, 'flushed');
    assert.equal(flushedMsg.totalSamples, 384);
  });

  it('reclaims recycled ArrayBuffer into buffer pool with both recycle and RECYCLE types', () => {
    const sim = createProcessorSim(16000, { chunkSamples: 1600 });
    const initialPoolLen = sim.proc.bufferPool.length;
    const recycledBuf1 = new Float32Array(1600).buffer;
    sim.post({ type: 'recycle', buffer: recycledBuf1 });
    assert.equal(sim.proc.bufferPool.length, initialPoolLen + 1);

    const recycledBuf2 = new Float32Array(1600).buffer;
    sim.post({ type: 'RECYCLE', buffer: recycledBuf2 });
    assert.equal(sim.proc.bufferPool.length, initialPoolLen + 2);
  });

  it('SwanadaAudioCapture exposes full configuration and lifecycle interfaces', () => {
    const capture = new SwanadaAudioCapture({
      sampleRate: 16000,
      chunkDurationMs: 100,
      vadThreshold: 0.005,
      silenceGateEnabled: false,
    });

    assert.equal(capture.getState(), 'inactive');
    assert.equal(typeof SwanadaAudioCapture.isSupported, 'function');
    assert.equal(typeof SwanadaAudioCapture.isWorkletSupported, 'function');
    assert.equal(typeof capture.start, 'function');
    assert.equal(typeof capture.stop, 'function');
    assert.equal(typeof capture.pause, 'function');
    assert.equal(typeof capture.resume, 'function');
    assert.equal(typeof capture.recycleBuffer, 'function');
  });
});
