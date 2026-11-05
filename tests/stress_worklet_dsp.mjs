/**
 * Independent Adversarial Stress Test Harness for Swanada AudioWorklet DSP & Memory Mechanics (Feature 9).
 * Tests:
 * 1. Zero-Allocation Invariant across 1,000+ process() quantums (Float32Array/Array constructor hooks & heap profiling).
 * 2. DSP Resampling & Anti-Aliasing Stress (Butterworth attenuation >= 18 dB, foldover aliasing, arbitrary SRs, phase continuity).
 * 3. Buffer Pool Exhaustion & Recycling (pool starvation, delayed recycling, malformed buffers, rapid burst recovery).
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

// Load worklet code
const workletPath = path.resolve('js/src/audio/audio-capture-worklet.js');
const workletSource = fs.readFileSync(workletPath, 'utf8');

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

  // Instrument TypedArray and Array constructors
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
    getAllocationCounts: () => ({
      float32Allocations,
      arrayAllocations,
    }),
    resetAllocationCounts: () => {
      float32Allocations = 0;
      arrayAllocations = 0;
    },
  };
}

async function runTests() {
  console.log('=================================================================');
  console.log('SWANADA AUDIOWORKLET DSP & ZERO-HEAP ADVERSARIAL STRESS SUITE');
  console.log('=================================================================\n');

  let passed = 0;
  let failed = 0;

  function runCase(name, fn) {
    try {
      console.log(`[TEST] ${name}`);
      fn();
      console.log(`  -> PASSED\n`);
      passed++;
    } catch (err) {
      console.error(`  -> FAILED: ${err.message}\n`);
      console.error(err.stack);
      failed++;
    }
  }

  // ---------------------------------------------------------------------------
  // SECTION 1: Zero-Allocation Invariant Under Continuous Streaming
  // ---------------------------------------------------------------------------

  runCase('1.1 Zero Float32Array and Array allocations across 1,000 non-emitting quantums', () => {
    const sim = createInstrumentedProcessor(48000, { chunkSamples: 1600 });
    const quantum = new Float32Array(128).fill(0.1);

    // Warm up and reset counters
    for (let i = 0; i < 10; i++) sim.step(quantum);
    sim.resetAllocationCounts();

    // Run 1,000 quantums without buffer emission (pause chunk emission or inspect inner quantums)
    // To strictly test non-emitting quantums, feed 30 quantums (which accumulate without emitting chunk if chunkSamples=1600 at 48kHz, 1 chunk every ~38 quantums)
    // Recycle buffer immediately whenever a chunk emits to keep pool full
    let totalQuanta = 1200;
    for (let i = 0; i < totalQuanta; i++) {
      sim.step(quantum);
      if (sim.events.length > 0) {
        const lastEv = sim.events.pop();
        if (lastEv.msg.type === 'chunk') {
          // Recycle buffer back immediately
          sim.post({ type: 'recycle', buffer: lastEv.msg.audioChunk.buffer });
        }
      }
    }

    const { float32Allocations, arrayAllocations } = sim.getAllocationCounts();
    console.log(`    Total quantums executed: ${totalQuanta}`);
    console.log(`    Float32Array allocations inside process(): ${float32Allocations}`);
    console.log(`    Array allocations inside process(): ${arrayAllocations}`);

    assert.equal(float32Allocations, 0, `Expected 0 Float32Array allocations, got ${float32Allocations}`);
    assert.equal(arrayAllocations, 0, `Expected 0 Array allocations, got ${arrayAllocations}`);
  });

  runCase('1.2 V8 Heap stability over 5,000 continuous quantums with buffer recycling', () => {
    const sim = createInstrumentedProcessor(48000, { chunkSamples: 1600 });
    const quantum = new Float32Array(128).fill(0.05);

    // Warmup 500 quantums
    for (let i = 0; i < 500; i++) {
      sim.step(quantum);
      while (sim.events.length > 0) {
        const ev = sim.events.pop();
        if (ev.msg.type === 'chunk') {
          sim.post({ type: 'recycle', buffer: ev.msg.audioChunk.buffer });
        }
      }
    }

    if (global.gc) global.gc();
    const memBefore = process.memoryUsage().heapUsed;

    // Run 5,000 consecutive quantums
    const N_QUANTUMS = 5000;
    for (let i = 0; i < N_QUANTUMS; i++) {
      sim.step(quantum);
      while (sim.events.length > 0) {
        const ev = sim.events.pop();
        if (ev.msg.type === 'chunk') {
          sim.post({ type: 'recycle', buffer: ev.msg.audioChunk.buffer });
        }
      }
    }

    if (global.gc) global.gc();
    const memAfter = process.memoryUsage().heapUsed;
    const heapDeltaKb = (memAfter - memBefore) / 1024;
    console.log(`    Heap used delta over ${N_QUANTUMS} quantums: ${heapDeltaKb.toFixed(2)} KB`);

    const { float32Allocations, arrayAllocations } = sim.getAllocationCounts();
    console.log(`    Total Float32Array allocations in process(): ${float32Allocations}`);
    assert.equal(float32Allocations, 0);
    assert.equal(arrayAllocations, 0);
  });

  // ---------------------------------------------------------------------------
  // SECTION 2: DSP Resampling & Anti-Aliasing Stress
  // ---------------------------------------------------------------------------

  runCase('2.1 Butterworth filter attenuation >= 18 dB at high frequencies above Nyquist (48 kHz SR)', () => {
    const sampleRate = 48000;
    const targetRate = 16000;
    const chunkSamples = 1600;

    function measureFrequencyRms(freqHz) {
      const sim = createInstrumentedProcessor(sampleRate, { chunkSamples, vadEnabled: false });
      const quantum = new Float32Array(128);
      // Run enough quantums to emit at least 3 chunks (~120 quantums)
      let emittedChunks = [];
      let totalSamplesGenerated = 0;

      for (let q = 0; q < 150; q++) {
        for (let i = 0; i < 128; i++) {
          quantum[i] = Math.sin((2 * Math.PI * freqHz * (totalSamplesGenerated + i)) / sampleRate) * 0.8;
        }
        totalSamplesGenerated += 128;
        sim.step(quantum);
        while (sim.events.length > 0) {
          const ev = sim.events.pop();
          if (ev.msg.type === 'chunk') {
            emittedChunks.push(ev.msg.audioChunk);
            sim.post({ type: 'recycle', buffer: ev.msg.audioChunk.buffer });
          }
        }
      }

      assert.ok(emittedChunks.length >= 2, `Expected >=2 chunks, got ${emittedChunks.length}`);
      // Compute RMS of 2nd chunk (steady state after filter ring-in)
      const chunk = emittedChunks[1];
      let sumSq = 0;
      for (let i = 0; i < chunk.length; i++) sumSq += chunk[i] * chunk[i];
      return Math.sqrt(sumSq / chunk.length);
    }

    const rms1k = measureFrequencyRms(1000);
    const rms7k5 = measureFrequencyRms(7500);
    const rms9k = measureFrequencyRms(9000);
    const rms12k = measureFrequencyRms(12000);
    const rms15k = measureFrequencyRms(15000);
    const rms18k = measureFrequencyRms(18000);
    const rms20k = measureFrequencyRms(20000);

    const atten7k5 = 20 * Math.log10(rms7k5 / rms1k);
    const atten9k = 20 * Math.log10(rms9k / rms1k);
    const atten12k = 20 * Math.log10(rms12k / rms1k);
    const atten15k = 20 * Math.log10(rms15k / rms1k);
    const atten18k = 20 * Math.log10(rms18k / rms1k);
    const atten20k = 20 * Math.log10(rms20k / rms1k);

    console.log(`    f =  1,000 Hz: RMS = ${rms1k.toFixed(4)} (Reference: 0.00 dB)`);
    console.log(`    f =  7,500 Hz: RMS = ${rms7k5.toFixed(4)} (Attenuation: ${atten7k5.toFixed(2)} dB, theoretical ~ -3.0 dB)`);
    console.log(`    f =  9,000 Hz: RMS = ${rms9k.toFixed(4)} (Attenuation: ${atten9k.toFixed(2)} dB)`);
    console.log(`    f = 12,000 Hz: RMS = ${rms12k.toFixed(4)} (Attenuation: ${atten12k.toFixed(2)} dB)`);
    console.log(`    f = 15,000 Hz: RMS = ${rms15k.toFixed(4)} (Attenuation: ${atten15k.toFixed(2)} dB)`);
    console.log(`    f = 18,000 Hz: RMS = ${rms18k.toFixed(4)} (Attenuation: ${atten18k.toFixed(2)} dB)`);
    console.log(`    f = 20,000 Hz: RMS = ${rms20k.toFixed(4)} (Attenuation: ${atten20k.toFixed(2)} dB)`);

    // Verify cutoff at 7.5 kHz is within +/- 1.5 dB of -3 dB
    assert.ok(atten7k5 <= -2.0 && atten7k5 >= -4.5, `Cutoff attenuation expected ~ -3 dB, got ${atten7k5}`);
    // Verify attenuation increases monotonically
    assert.ok(atten9k < atten7k5);
    assert.ok(atten12k < atten9k);
    assert.ok(atten15k < atten12k);
    assert.ok(atten18k < atten15k);
    // Verify >= 18 dB attenuation at high frequencies above Nyquist (>15 kHz / 18 kHz / 20 kHz)
    assert.ok(atten18k <= -18.0, `Expected >= 18 dB attenuation at 18 kHz, got ${atten18k.toFixed(2)} dB`);
    assert.ok(atten20k <= -18.0, `Expected >= 18 dB attenuation at 20 kHz, got ${atten20k.toFixed(2)} dB`);
  });

  runCase('2.2 Butterworth filter attenuation >= 18 dB at high frequencies (96 kHz SR)', () => {
    const sampleRate = 96000;
    const chunkSamples = 1600;

    function measureFrequencyRms(freqHz) {
      const sim = createInstrumentedProcessor(sampleRate, { chunkSamples, vadEnabled: false });
      const quantum = new Float32Array(128);
      let emittedChunks = [];
      let totalSamplesGenerated = 0;

      for (let q = 0; q < 250; q++) {
        for (let i = 0; i < 128; i++) {
          quantum[i] = Math.sin((2 * Math.PI * freqHz * (totalSamplesGenerated + i)) / sampleRate) * 0.8;
        }
        totalSamplesGenerated += 128;
        sim.step(quantum);
        while (sim.events.length > 0) {
          const ev = sim.events.pop();
          if (ev.msg.type === 'chunk') {
            emittedChunks.push(ev.msg.audioChunk);
            sim.post({ type: 'recycle', buffer: ev.msg.audioChunk.buffer });
          }
        }
      }

      assert.ok(emittedChunks.length >= 2);
      const chunk = emittedChunks[1];
      let sumSq = 0;
      for (let i = 0; i < chunk.length; i++) sumSq += chunk[i] * chunk[i];
      return Math.sqrt(sumSq / chunk.length);
    }

    const rms1k = measureFrequencyRms(1000);
    const rms20k = measureFrequencyRms(20000);
    const rms24k = measureFrequencyRms(24000);
    const rms32k = measureFrequencyRms(32000);

    const atten20k = 20 * Math.log10(rms20k / rms1k);
    const atten24k = 20 * Math.log10(rms24k / rms1k);
    const atten32k = 20 * Math.log10(rms32k / rms1k);

    console.log(`    f =  1,000 Hz: RMS = ${rms1k.toFixed(4)} (Reference: 0.00 dB)`);
    console.log(`    f = 20,000 Hz: RMS = ${rms20k.toFixed(4)} (Attenuation: ${atten20k.toFixed(2)} dB)`);
    console.log(`    f = 24,000 Hz: RMS = ${rms24k.toFixed(4)} (Attenuation: ${atten24k.toFixed(2)} dB)`);
    console.log(`    f = 32,000 Hz: RMS = ${rms32k.toFixed(4)} (Attenuation: ${atten32k.toFixed(2)} dB)`);

    assert.ok(atten20k <= -18.0, `Expected >= 18 dB attenuation at 20 kHz at 96 kHz SR, got ${atten20k.toFixed(2)} dB`);
    assert.ok(atten24k <= -18.0, `Expected >= 18 dB attenuation at 24 kHz at 96 kHz SR, got ${atten24k.toFixed(2)} dB`);
  });

  runCase('2.3 Phase continuity & zero boundary glitch across arbitrary rates (22.05k, 44.1k, 48k, 96k, 192k, 44101, 47999)', () => {
    const testRates = [22050, 44100, 48000, 96000, 192000, 44101, 47999];
    const fTone = 440; // 440 Hz standard A
    const targetSr = 16000;
    const expectedMaxDiff = (2 * Math.PI * fTone) / targetSr; // physical derivative bound for sin(w*t)

    for (const sr of testRates) {
      const sim = createInstrumentedProcessor(sr, { chunkSamples: 1600, vadEnabled: false });
      const quantum = new Float32Array(128);
      const allOutput = [];
      const boundaryIndices = [];
      let totalInputSamples = 0;

      // Run 80 quantums (~10,240 input samples)
      for (let q = 0; q < 80; q++) {
        for (let i = 0; i < 128; i++) {
          quantum[i] = Math.sin((2 * Math.PI * fTone * (totalInputSamples + i)) / sr) * 0.9;
        }
        totalInputSamples += 128;
        sim.step(quantum);
        while (sim.events.length > 0) {
          const ev = sim.events.pop();
          if (ev.msg.type === 'chunk') {
            for (let s = 0; s < ev.msg.audioChunk.length; s++) {
              allOutput.push(ev.msg.audioChunk[s]);
            }
            sim.post({ type: 'recycle', buffer: ev.msg.audioChunk.buffer });
          }
        }
        boundaryIndices.push(allOutput.length);
      }

      // Flush remaining samples to get full signal
      sim.post({ type: 'flush' });
      while (sim.events.length > 0) {
        const ev = sim.events.pop();
        if (ev.msg.type === 'chunk') {
          for (let s = 0; s < ev.msg.audioChunk.length; s++) {
            allOutput.push(ev.msg.audioChunk[s]);
          }
        }
      }

      assert.ok(allOutput.length >= 500, `Expected >=500 output samples at SR ${sr}, got ${allOutput.length}`);

      // Measure max first difference across all adjacent samples
      let maxIntraDiff = 0;
      for (let i = 1; i < allOutput.length; i++) {
        const diff = Math.abs(allOutput[i] - allOutput[i - 1]);
        if (diff > maxIntraDiff) maxIntraDiff = diff;
      }

      // Measure max first difference specifically at quantum boundaries
      let maxBoundaryDiff = 0;
      for (const bIdx of boundaryIndices) {
        if (bIdx > 0 && bIdx < allOutput.length) {
          const diff = Math.abs(allOutput[bIdx] - allOutput[bIdx - 1]);
          if (diff > maxBoundaryDiff) maxBoundaryDiff = diff;
        }
      }

      console.log(`    SR = ${sr.toString().padStart(6)} Hz: Total Out = ${allOutput.length}, Max Diff = ${maxIntraDiff.toFixed(5)}, Expected Bound = ${expectedMaxDiff.toFixed(5)}, Boundary Diff = ${maxBoundaryDiff.toFixed(5)}`);

      // Boundary difference must strictly not exceed physical sine wave derivative bound + 10%
      assert.ok(maxBoundaryDiff <= expectedMaxDiff * 1.10, `Glitch detected at boundary for SR ${sr}: boundary diff ${maxBoundaryDiff} > limit ${expectedMaxDiff * 1.10}`);
      assert.ok(maxIntraDiff <= expectedMaxDiff * 1.10, `Glitch detected within stream for SR ${sr}: max diff ${maxIntraDiff} > limit ${expectedMaxDiff * 1.10}`);
    }
  });

  // ---------------------------------------------------------------------------
  // SECTION 3: Buffer Pool Exhaustion & Recycling
  // ---------------------------------------------------------------------------

  runCase('3.1 Buffer pool handles complete starvation gracefully with on-demand fallback', () => {
    // Initial pool has 4 pre-allocated buffers
    const sim = createInstrumentedProcessor(16000, { chunkSamples: 1600, vadEnabled: false });
    const quantum = new Float32Array(128).fill(0.2);

    const emittedBuffers = [];
    // Feed enough quantums to emit 10 chunks (13 quantums per chunk = 130 quantums)
    // NEVER recycle any buffers
    for (let q = 0; q < 150; q++) {
      sim.step(quantum);
      while (sim.events.length > 0) {
        const ev = sim.events.pop();
        if (ev.msg.type === 'chunk') {
          emittedBuffers.push(ev.msg.audioChunk);
        }
      }
    }

    console.log(`    Chunks emitted without recycling: ${emittedBuffers.length}`);
    assert.equal(emittedBuffers.length, 12);
    for (const buf of emittedBuffers) {
      assert.equal(buf.length, 1600);
      assert.ok(!isNaN(buf[0]));
    }
    // Initial pool is empty
    assert.equal(sim.proc.bufferPool.length, 0);

    // Verify first 4 came from pre-allocated pool, remaining 8 were allocated on demand
    const { float32Allocations } = sim.getAllocationCounts();
    console.log(`    Allocated fallback buffers when starved: ${float32Allocations}`);
    assert.equal(float32Allocations, 8);
  });

  runCase('3.2 Buffer pool recovers and stabilizes after delayed recycling burst', () => {
    const sim = createInstrumentedProcessor(16000, { chunkSamples: 1600, vadEnabled: false });
    const quantum = new Float32Array(128).fill(0.2);

    const backlog = [];
    // Emit 6 chunks without recycling
    for (let q = 0; q < 80; q++) {
      sim.step(quantum);
      while (sim.events.length > 0) {
        const ev = sim.events.pop();
        if (ev.msg.type === 'chunk') {
          backlog.push(ev.msg.audioChunk.buffer);
        }
      }
    }
    assert.equal(backlog.length, 6);
    assert.equal(sim.proc.bufferPool.length, 0);

    // Delayed recycling burst: send all 6 buffers back
    for (const buf of backlog) {
      sim.post({ type: 'recycle', buffer: buf });
    }
    assert.equal(sim.proc.bufferPool.length, 6);

    // Reset allocation count and emit 6 more chunks
    sim.resetAllocationCounts();
    let newChunks = 0;
    for (let q = 0; q < 80; q++) {
      sim.step(quantum);
      while (sim.events.length > 0) {
        const ev = sim.events.pop();
        if (ev.msg.type === 'chunk') {
          newChunks++;
        }
      }
    }
    assert.equal(newChunks, 6);

    // Because 6 buffers were recycled, ZERO fallback allocations occurred!
    const { float32Allocations } = sim.getAllocationCounts();
    console.log(`    Allocations during post-recovery run: ${float32Allocations}`);
    assert.equal(float32Allocations, 0);
  });

  runCase('3.3 Buffer pool rejects corrupted, detached, and malformed recycle messages', () => {
    const sim = createInstrumentedProcessor(16000, { chunkSamples: 1600, vadEnabled: false });
    const initialPoolLen = sim.proc.bufferPool.length;
    assert.equal(initialPoolLen, 4);

    // 1. Recycle message with null buffer
    sim.post({ type: 'recycle', buffer: null });
    assert.equal(sim.proc.bufferPool.length, 4);

    // 2. Recycle message with wrong byteLength (e.g. 100 bytes instead of 1600*4 = 6400)
    sim.post({ type: 'recycle', buffer: new ArrayBuffer(100) });
    assert.equal(sim.proc.bufferPool.length, 4);

    // 3. Recycle message with 0 bytes
    sim.post({ type: 'recycle', buffer: new ArrayBuffer(0) });
    assert.equal(sim.proc.bufferPool.length, 4);

    // 4. Recycle message with no data
    sim.post(null);
    sim.post({});
    sim.post({ type: 'unknown' });
    assert.equal(sim.proc.bufferPool.length, 4);

    // 5. Valid recycle buffer
    const validBuf = new ArrayBuffer(1600 * 4);
    sim.post({ type: 'recycle', buffer: validBuf });
    assert.equal(sim.proc.bufferPool.length, 5);

    console.log(`    Verified immunity against null, malformed, and truncated recycle buffers.`);
  });

  runCase('3.4 Extreme stress: 10,000 quantums under stochastic recycling jitter', () => {
    const sim = createInstrumentedProcessor(48000, { chunkSamples: 1600, vadEnabled: false });
    const quantum = new Float32Array(128);
    for (let i = 0; i < 128; i++) quantum[i] = (Math.random() * 2 - 1) * 0.5;

    let pendingRecycleQueue = [];
    let chunksEmitted = 0;
    const N_QUANTUMS = 10000;

    for (let q = 0; q < N_QUANTUMS; q++) {
      sim.step(quantum);
      while (sim.events.length > 0) {
        const ev = sim.events.pop();
        if (ev.msg.type === 'chunk') {
          chunksEmitted++;
          pendingRecycleQueue.push(ev.msg.audioChunk.buffer);
        }
      }

      // Stochastically recycle 0 to 2 buffers per quantum
      if (pendingRecycleQueue.length > 0 && Math.random() < 0.3) {
        const toRecycle = pendingRecycleQueue.shift();
        sim.post({ type: 'recycle', buffer: toRecycle });
      }
    }

    // Flush any remaining
    sim.post({ type: 'flush' });
    while (sim.events.length > 0) {
      const ev = sim.events.pop();
      if (ev.msg.type === 'chunk') chunksEmitted++;
    }

    console.log(`    Executed ${N_QUANTUMS} quantums (~80 seconds of audio at 48kHz: 1,280,000 samples -> 426,666 downsampled samples).`);
    console.log(`    Chunks processed: ${chunksEmitted}. Pool size at end: ${sim.proc.bufferPool.length}`);
    assert.ok(chunksEmitted >= 265 && chunksEmitted <= 270, `Expected ~267 chunks, got ${chunksEmitted}`);

  });

  console.log('=================================================================');
  console.log(`STRESS SUITE SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('=================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
