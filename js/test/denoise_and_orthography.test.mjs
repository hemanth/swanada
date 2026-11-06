import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {
  enhanceSpeechWithTelemetry,
  denoisePcm16k,
  normalizeIndicText,
  repairBrahmicOrthography,
} from '../dist/index.mjs';

describe('Multi-Stage ASR Background Noise Cancellation & Brahmic Orthography Suite', () => {
  it('suppresses 50 Hz / 60 Hz power-line hum and 30 Hz HVAC rumble by >= 20 dB while preserving 600 Hz formant', () => {
    const sr = 16000;
    const n = sr * 1;
    const humRumble = new Float32Array(n);
    const speechFormant = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      humRumble[i] =
        0.25 * Math.sin(2 * Math.PI * 30 * t) +
        0.25 * Math.sin(2 * Math.PI * 50 * t) +
        0.25 * Math.sin(2 * Math.PI * 60 * t);
      // Modulated speech-like formant envelope
      const env = i > 3000 && i < 13000 ? 0.4 : 0.0005;
      speechFormant[i] = env * Math.sin(2 * Math.PI * 600 * t);
    }

    const cleanedHum = denoisePcm16k(humRumble, { nonSpeechGate: false, spectralDenoise: false, adaptiveGain: false });
    let inSq = 0;
    let outSq = 0;
    // Measure steady-state after biquad transient (skip first 800 samples = 50ms)
    for (let i = 800; i < n; i++) {
      inSq += humRumble[i] * humRumble[i];
      outSq += cleanedHum[i] * cleanedHum[i];
    }
    const attenDb = 10 * Math.log10(inSq / (outSq + 1e-12));
    assert.ok(attenDb >= 18.0, `Expected >= 18 dB hum/rumble attenuation, got ${attenDb.toFixed(2)} dB`);

    const formantTelemetry = enhanceSpeechWithTelemetry(speechFormant);
    assert.equal(formantTelemetry.isSpeechLikely, true);
    assert.ok(formantTelemetry.estimatedSnrDb >= 26.0, 'Clean modulated speech formant should trigger clean-speech bypass');
  });

  it('reduces broadband noise power via Ephraim-Malah Spectral Wiener filter on noisy speech', () => {
    const sr = 16000;
    const n = sr * 2;
    const clean = new Float32Array(n);
    const noisy = new Float32Array(n);

    // Speech bursts in [0.4s..0.9s] and [1.2s..1.7s], background noise throughout
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const inBurst = (t >= 0.4 && t <= 0.9) || (t >= 1.2 && t <= 1.7);
      const s = inBurst
        ? 0.35 * Math.sin(2 * Math.PI * 420 * t) + 0.2 * Math.sin(2 * Math.PI * 1260 * t)
        : 0.0;
      const prng = (((i * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
      const noise = 0.08 * prng;
      clean[i] = s;
      noisy[i] = s + noise;
    }

    const res = enhanceSpeechWithTelemetry(noisy, { adaptiveGain: false });
    assert.equal(res.isSpeechLikely, true);

    // Measure residual noise energy in non-speech pause [0.05s..0.35s]
    let rawPauseSq = 0;
    let denPauseSq = 0;
    for (let i = 800; i < 5600; i++) {
      rawPauseSq += noisy[i] * noisy[i];
      denPauseSq += res.pcm[i] * res.pcm[i];
    }
    const pauseSuppressionDb = 10 * Math.log10(rawPauseSq / (denPauseSq + 1e-12));
    assert.ok(
      pauseSuppressionDb >= 8.0,
      `Expected >= 8 dB background noise suppression in speech pauses, got ${pauseSuppressionDb.toFixed(2)} dB`
    );
  });

  it('gates pure stationary non-speech background hiss to prevent CTC hallucinations', () => {
    const sr = 16000;
    const hiss = new Float32Array(sr);
    for (let i = 0; i < sr; i++) {
      const prng = (((i * 22695477 + 1) >>> 0) / 4294967296) * 2 - 1;
      hiss[i] = 0.008 * prng;
    }
    const res = enhanceSpeechWithTelemetry(hiss);
    assert.equal(res.isSpeechLikely, false, 'Pure stationary hiss must be flagged as non-speech');
    let maxAbs = 0;
    for (let i = 0; i < res.pcm.length; i++) {
      if (Math.abs(res.pcm[i]) > maxAbs) maxAbs = Math.abs(res.pcm[i]);
    }
    assert.equal(maxAbs, 0, 'Gated non-speech buffer should be zeroed');
  });

  it('maintains 0 heap allocations in AudioWorkletProcessor with noiseSuppressionEnabled: true', () => {
    let float32Allocations = 0;
    let inLoop = false;
    const events = [];

    class FakeAudioWorkletProcessor {
      constructor() {
        this.port = {
          postMessage: (msg) => events.push(msg),
          set onmessage(_fn) {},
        };
      }
    }
    const OrigF32 = Float32Array;
    class TrackedF32 extends OrigF32 {
      constructor(...args) {
        super(...args);
        if (inLoop) float32Allocations++;
      }
    }
    let Ctor = null;
    const sandbox = {
      AudioWorkletProcessor: FakeAudioWorkletProcessor,
      registerProcessor: (_name, c) => { Ctor = c; },
      sampleRate: 48000,
      Float32Array: TrackedF32,
      Math,
      Number,
      Boolean,
      console,
    };
    const src = fs.readFileSync(new URL('../../docs/audio-capture-worklet.js', import.meta.url), 'utf8');
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox);

    const proc = new Ctor({ processorOptions: { chunkSamples: 1600, noiseSuppressionEnabled: true } });
    const q = new OrigF32(128);
    for (let i = 0; i < 128; i++) q[i] = 0.25 * Math.sin((2 * Math.PI * 500 * i) / 48000);

    for (let step = 0; step < 200; step++) {
      inLoop = true;
      proc.process([[q]], [], {});
      inLoop = false;
      while (events.length > 0) {
        const ev = events.pop();
        if (ev.audioChunk) {
          proc.bufferPool.push(new OrigF32(ev.audioChunk.buffer));
        }
      }
    }
    assert.equal(float32Allocations, 0, 'Expected 0 Float32Array allocations in noise-suppressing AudioWorklet');
  });

  it('repairs colliding Brahmic dependent vowel matras and illegal viramas while preserving valid orthography', () => {
    // Marathi double-matra collision caught on live CTC boundary ('हीि' -> 'ही')
    assert.equal(normalizeIndicText('हो अणखिहीि कहीि अहे'), 'हो अणखिही कही अहे');
    // Tamil colliding matras ('துோ' -> 'து') while keeping valid two-part matra 'தோ' intact
    assert.equal(normalizeIndicText('அதோ'), 'அதோ');
    assert.equal(repairBrahmicOrthography('அதுோ'), 'அது');
    // Kannada illegal virama after independent vowel ('ಇ್ಞ' -> 'ಇಞ')
    assert.equal(normalizeIndicText('ಇ್ಞ'), 'ಇಞ');
    // Preserves Sanskrit anusvara, visarga, and conjuncts
    assert.equal(normalizeIndicText('व्यायामः देहस्य अङ्गेषु पुष्टिं ददाति'), 'व्यायामः देहस्य अङ्गेषु पुष्टिं ददाति');
    // Preserves Bengali & Kannada composite vowels
    assert.equal(normalizeIndicText('সেজন্য দাদার'), 'সেজন্য দাদার');
    assert.equal(normalizeIndicText('ಸ್ಥಗಿತಗೊಳ್ಸಿದೆ'), 'ಸ್ಥಗಿತಗೊಳ್ಸಿದೆ');
  });
});
