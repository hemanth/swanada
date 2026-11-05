import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

function createInstrumentedProcessor(hardwareSr = 48000, opts = {}) {
  let float32Allocations = 0;
  let arrayAllocations = 0;
  let inProcessLoop = false;

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

  const OriginalFloat32Array = Float32Array;
  class InstrumentedFloat32Array extends OriginalFloat32Array {
    constructor(...args) {
      super(...args);
      if (inProcessLoop) {
        float32Allocations++;
      }
    }
  }

  const OriginalArray = Array;
  class InstrumentedArray extends OriginalArray {
    constructor(...args) {
      super(...args);
      if (inProcessLoop) {
        arrayAllocations++;
      }
    }
  }

  let ProcessorClass = null;
  const sandbox = {
    AudioWorkletProcessor: FakeAudioWorkletProcessor,
    registerProcessor: (name, ctor) => { ProcessorClass = ctor; },
    sampleRate: hardwareSr,
    Float32Array: InstrumentedFloat32Array,
    Array: InstrumentedArray,
    Math,
    Number,
    console,
  };

  const workletPath = fs.existsSync('src/audio/audio-capture-worklet.js')
    ? 'src/audio/audio-capture-worklet.js'
    : (fs.existsSync('docs/audio-capture-worklet.js')
      ? 'docs/audio-capture-worklet.js'
      : '../docs/audio-capture-worklet.js');
  const workletSource = fs.readFileSync(workletPath, 'utf8');
  vm.createContext(sandbox);
  vm.runInContext(workletSource, sandbox);

  const proc = new ProcessorClass({ processorOptions: opts });

  return {
    proc,
    events,
    post: (m) => onmessageHandler && onmessageHandler({ data: m }),
    step: (inputQuantum) => {
      inProcessLoop = true;
      try {
        proc.process([[inputQuantum]], [], {});
      } finally {
        inProcessLoop = false;
      }
    },
    getAllocationCounts: () => ({ float32Allocations, arrayAllocations }),
    resetAllocationCounts: () => {
      float32Allocations = 0;
      arrayAllocations = 0;
    },
  };
}

describe('AudioWorklet Zero-Heap & DSP Adversarial Stress Suite (Feature 9)', () => {
  it('strictly guarantees 0 Float32Array/Array allocations across 1,000+ quantums', () => {
    const sim = createInstrumentedProcessor(48000, { chunkSamples: 1600 });
    const quantum = new Float32Array(128).fill(0.1);

    for (let i = 0; i < 10; i++) sim.step(quantum);
    sim.resetAllocationCounts();

    const TOTAL_QUANTA = 1200;
    for (let i = 0; i < TOTAL_QUANTA; i++) {
      sim.step(quantum);
      if (sim.events.length > 0) {
        const lastEv = sim.events.pop();
        if (lastEv.msg.type === 'chunk') {
          sim.post({ type: 'recycle', buffer: lastEv.msg.audioChunk.buffer });
        }
      }
    }

    const { float32Allocations, arrayAllocations } = sim.getAllocationCounts();
    assert.equal(float32Allocations, 0, `Expected 0 Float32Array allocations, got ${float32Allocations}`);
    assert.equal(arrayAllocations, 0, `Expected 0 Array allocations, got ${arrayAllocations}`);
  });

  it('verifies Butterworth filter attenuation >= 18 dB at high frequencies above Nyquist', () => {
    const sampleRate = 48000;
    function measureRms(freqHz) {
      const sim = createInstrumentedProcessor(sampleRate, { chunkSamples: 1600, vadEnabled: false });
      const quantum = new Float32Array(128);
      let chunks = [];
      let total = 0;
      for (let q = 0; q < 150; q++) {
        for (let i = 0; i < 128; i++) {
          quantum[i] = Math.sin((2 * Math.PI * freqHz * (total + i)) / sampleRate) * 0.8;
        }
        total += 128;
        sim.step(quantum);
        while (sim.events.length > 0) {
          const ev = sim.events.pop();
          if (ev.msg.type === 'chunk') {
            chunks.push(ev.msg.audioChunk);
            sim.post({ type: 'recycle', buffer: ev.msg.audioChunk.buffer });
          }
        }
      }
      const c = chunks[1];
      let sumSq = 0;
      for (let i = 0; i < c.length; i++) sumSq += c[i] * c[i];
      return Math.sqrt(sumSq / c.length);
    }

    const rms1k = measureRms(1000);
    const rms18k = measureRms(18000);
    const rms20k = measureRms(20000);

    const atten18k = 20 * Math.log10(rms18k / rms1k);
    const atten20k = 20 * Math.log10(rms20k / rms1k);

    assert.ok(atten18k <= -18.0, `Expected <= -18 dB at 18 kHz, got ${atten18k.toFixed(2)} dB`);
    assert.ok(atten20k <= -18.0, `Expected <= -18 dB at 20 kHz, got ${atten20k.toFixed(2)} dB`);
  });

  it('guarantees phase continuity and zero boundary glitch across arbitrary rates', () => {
    const rates = [22050, 44100, 48000, 96000, 192000, 44101, 47999];
    const fTone = 440;
    const targetSr = 16000;
    const expectedMaxDiff = (2 * Math.PI * fTone) / targetSr;

    for (const sr of rates) {
      const sim = createInstrumentedProcessor(sr, { chunkSamples: 1600, vadEnabled: false });
      const quantum = new Float32Array(128);
      const out = [];
      const boundaryIndices = [];
      let total = 0;

      for (let q = 0; q < 60; q++) {
        for (let i = 0; i < 128; i++) {
          quantum[i] = Math.sin((2 * Math.PI * fTone * (total + i)) / sr) * 0.9;
        }
        total += 128;
        sim.step(quantum);
        while (sim.events.length > 0) {
          const ev = sim.events.pop();
          if (ev.msg.type === 'chunk') {
            for (let s = 0; s < ev.msg.audioChunk.length; s++) out.push(ev.msg.audioChunk[s]);
            sim.post({ type: 'recycle', buffer: ev.msg.audioChunk.buffer });
          }
        }
        boundaryIndices.push(out.length);
      }

      for (const b of boundaryIndices) {
        if (b > 0 && b < out.length) {
          const diff = Math.abs(out[b] - out[b - 1]);
          assert.ok(diff <= expectedMaxDiff * 1.10, `Glitch at boundary for SR ${sr}: ${diff} > ${expectedMaxDiff * 1.10}`);
        }
      }
    }
  });

  it('handles buffer pool starvation, delayed recycling, and malformed messages gracefully', () => {
    const sim = createInstrumentedProcessor(16000, { chunkSamples: 1600, vadEnabled: false });
    const quantum = new Float32Array(128).fill(0.2);

    const emitted = [];
    for (let q = 0; q < 150; q++) {
      sim.step(quantum);
      while (sim.events.length > 0) {
        const ev = sim.events.pop();
        if (ev.msg.type === 'chunk') emitted.push(ev.msg.audioChunk.buffer);
      }
    }
    assert.equal(emitted.length, 12);
    assert.equal(sim.proc.bufferPool.length, 0);

    // Delayed recycling of 6 buffers
    for (let i = 0; i < 6; i++) {
      sim.post({ type: 'recycle', buffer: emitted[i] });
    }
    assert.equal(sim.proc.bufferPool.length, 6);

    // Reject malformed
    sim.post({ type: 'recycle', buffer: null });
    sim.post({ type: 'recycle', buffer: new ArrayBuffer(50) });
    assert.equal(sim.proc.bufferPool.length, 6);
  });
});
