/**
 * Swanada Real-Time Audio Capture & Anti-Aliased Resampling AudioWorkletProcessor.
 * Zero-allocation real-time loop, 2nd-order Butterworth anti-aliasing filter,
 * fractional phase-accumulator downsampling to 16 kHz, and transferable ArrayBuffer pool.
 */

class SwanadaAudioCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    const opts = options?.processorOptions || {};
    this.targetRate = 16000;
    this.chunkSamples = Number(opts.chunkSamples) || 1600; // default 100ms @ 16kHz
    this.vadThreshold = typeof opts.vadThreshold === 'number' ? opts.vadThreshold : 0.005;
    this.vadEnabled = opts.vadEnabled !== false;
    this.silenceGateEnabled = Boolean(opts.silenceGateEnabled);
    this.vadHangoverFrames = Number(opts.vadHangoverFrames) || 2;
    this.noiseSuppressionEnabled = Boolean(opts.noiseSuppressionEnabled);
    this.alcEnabled = Boolean(opts.alcEnabled);

    // Causal Automatic Level Control (ALC) state for quiet / distant microphones
    this.alcEnv = 0.0;
    this.alcGain = 1.0;

    // 16 kHz post-decimation biquad states for 80 Hz HPF + 50 Hz / 60 Hz hum notch + online noise floor
    // 80 Hz 2nd-order Butterworth HPF @ 16000 Hz
    const hpOmega = (2.0 * Math.PI * 80.0) / 16000.0;
    const hpSin = Math.sin(hpOmega);
    const hpCos = Math.cos(hpOmega);
    const hpAlpha = hpSin / (2.0 * 0.7071067811865476);
    const hpA0 = 1.0 + hpAlpha;
    this.hpB0 = ((1.0 + hpCos) * 0.5) / hpA0;
    this.hpB1 = -(1.0 + hpCos) / hpA0;
    this.hpB2 = ((1.0 + hpCos) * 0.5) / hpA0;
    this.hpA1 = (-2.0 * hpCos) / hpA0;
    this.hpA2 = (1.0 - hpAlpha) / hpA0;
    this.hpX1 = 0.0; this.hpX2 = 0.0; this.hpY1 = 0.0; this.hpY2 = 0.0;

    // 50 Hz & 60 Hz Q=22 hum notch biquads @ 16000 Hz
    const n50W = (2.0 * Math.PI * 50.0) / 16000.0;
    const n50Cos = Math.cos(n50W);
    const n50Alpha = Math.sin(n50W) / 44.0;
    const n50A0 = 1.0 + n50Alpha;
    this.n50B0 = 1.0 / n50A0;
    this.n50B1 = (-2.0 * n50Cos) / n50A0;
    this.n50A1 = this.n50B1;
    this.n50A2 = (1.0 - n50Alpha) / n50A0;
    this.n50X1 = 0.0; this.n50X2 = 0.0; this.n50Y1 = 0.0; this.n50Y2 = 0.0;

    const n60W = (2.0 * Math.PI * 60.0) / 16000.0;
    const n60Cos = Math.cos(n60W);
    const n60Alpha = Math.sin(n60W) / 44.0;
    const n60A0 = 1.0 + n60Alpha;
    this.n60B0 = 1.0 / n60A0;
    this.n60B1 = (-2.0 * n60Cos) / n60A0;
    this.n60A1 = this.n60B1;
    this.n60A2 = (1.0 - n60Alpha) / n60A0;
    this.n60X1 = 0.0; this.n60X2 = 0.0; this.n60Y1 = 0.0; this.n60Y2 = 0.0;

    // Online causal noise-floor envelope tracker & expander gain
    this.noiseFloorRms = 0.002;
    this.smoothEnv = 0.0;
    this.expanderGain = 1.0;

    this.isActive = true;
    this.hangoverRemaining = 0;
    this.totalProcessedSamples = 0;
    this.emittedChunks = 0;

    // Pre-allocated scratch buffers (Zero allocations in process())
    this.monoInput = new Float32Array(128);
    this.accumBuffer = new Float32Array(this.chunkSamples);
    this.accumOffset = 0;
    this.sumSquares = 0.0;

    // Resampling state
    this.lastInputSample = 0.0;
    this.phase = 0.0;
    const currentSampleRate =
      Number(opts.sampleRate) || (typeof sampleRate !== 'undefined' ? sampleRate : 48000);
    this.ratio = currentSampleRate / this.targetRate;

    // 4th-order cascaded Butterworth Anti-Aliasing Low-Pass Filter (fc = 7400 Hz, -24 dB/oct)
    if (currentSampleRate > this.targetRate) {
      const fc = 7400.0;
      const omega = (2.0 * Math.PI * fc) / currentSampleRate;
      const sinOmega = Math.sin(omega);
      const cosOmega = Math.cos(omega);

      // Section 1: Q1 = 0.541196100146197
      const alpha1 = sinOmega / (2.0 * 0.541196100146197);
      const a0_1 = 1.0 + alpha1;
      this.b0 = ((1.0 - cosOmega) * 0.5) / a0_1;
      this.b1 = (1.0 - cosOmega) / a0_1;
      this.b2 = ((1.0 - cosOmega) * 0.5) / a0_1;
      this.a1 = (-2.0 * cosOmega) / a0_1;
      this.a2 = (1.0 - alpha1) / a0_1;

      // Section 2: Q2 = 1.3065629648763766
      const alpha2 = sinOmega / (2.0 * 1.3065629648763766);
      const a0_2 = 1.0 + alpha2;
      this.s2B0 = ((1.0 - cosOmega) * 0.5) / a0_2;
      this.s2B1 = (1.0 - cosOmega) / a0_2;
      this.s2B2 = ((1.0 - cosOmega) * 0.5) / a0_2;
      this.s2A1 = (-2.0 * cosOmega) / a0_2;
      this.s2A2 = (1.0 - alpha2) / a0_2;

      this.x1 = 0.0;
      this.x2 = 0.0;
      this.y1 = 0.0;
      this.y2 = 0.0;
      this.s2X1 = 0.0;
      this.s2X2 = 0.0;
      this.s2Y1 = 0.0;
      this.s2Y2 = 0.0;
      this.filterEnabled = true;
    } else {
      this.filterEnabled = false;
    }

    // Pre-allocated ArrayBuffer pool for zero-copy transferable IPC
    this.bufferPool = [
      new Float32Array(this.chunkSamples),
      new Float32Array(this.chunkSamples),
      new Float32Array(this.chunkSamples),
      new Float32Array(this.chunkSamples),
    ];

    // MessagePort Inbound Event Handling
    this.port.onmessage = (event) => {
      const msg = event.data || {};
      const type = msg.type;

      if (typeof type === 'string' && type.toLowerCase() === 'recycle') {
        if (msg.buffer && msg.buffer.byteLength === this.chunkSamples * 4) {
          this.bufferPool.push(new Float32Array(msg.buffer));
        }
      } else if (type === 'flush') {
        this._flushTail();
      } else if (type === 'reset') {
        this.accumOffset = 0;
        this.sumSquares = 0.0;
        this.phase = 0.0;
        this.lastInputSample = 0.0;
        this.hangoverRemaining = 0;
        if (this.filterEnabled) {
          this.x1 = 0.0;
          this.x2 = 0.0;
          this.y1 = 0.0;
          this.y2 = 0.0;
          this.s2X1 = 0.0;
          this.s2X2 = 0.0;
          this.s2Y1 = 0.0;
          this.s2Y2 = 0.0;
        }
        this.hpX1 = 0.0; this.hpX2 = 0.0; this.hpY1 = 0.0; this.hpY2 = 0.0;
        this.n50X1 = 0.0; this.n50X2 = 0.0; this.n50Y1 = 0.0; this.n50Y2 = 0.0;
        this.n60X1 = 0.0; this.n60X2 = 0.0; this.n60Y1 = 0.0; this.n60Y2 = 0.0;
        this.noiseFloorRms = 0.002;
        this.smoothEnv = 0.0;
        this.expanderGain = 1.0;
        this.alcEnv = 0.0;
        this.alcGain = 1.0;
      } else if (type === 'config') {
        if (typeof msg.vadThreshold === 'number') this.vadThreshold = msg.vadThreshold;
        if (typeof msg.silenceGateEnabled === 'boolean') this.silenceGateEnabled = msg.silenceGateEnabled;
        if (typeof msg.vadHangoverFrames === 'number') this.vadHangoverFrames = msg.vadHangoverFrames;
        if (typeof msg.vadEnabled === 'boolean') this.vadEnabled = msg.vadEnabled;
        if (typeof msg.noiseSuppressionEnabled === 'boolean') {
          this.noiseSuppressionEnabled = msg.noiseSuppressionEnabled;
        }
        if (typeof msg.alcEnabled === 'boolean') {
          this.alcEnabled = msg.alcEnabled;
        }
      } else if (type === 'pause') {
        this.isActive = false;
      } else if (type === 'resume') {
        this.isActive = true;
      }
    };
  }

  _flushTail() {
    if (this.accumOffset > 0) {
      const tailSamples = this.accumOffset;
      const tailPcm = new Float32Array(tailSamples);
      tailPcm.set(this.accumBuffer.subarray(0, tailSamples));

      const rms = Math.sqrt(this.sumSquares / tailSamples);
      const isSpeech = this.vadEnabled ? rms >= this.vadThreshold : true;

      this.port.postMessage(
        {
          type: 'chunk',
          audioChunk: tailPcm,
          data: tailPcm,
          rms,
          isSpeech,
          isTail: true,
          sampleRate: this.targetRate,
          timestampMs: (this.totalProcessedSamples / this.targetRate) * 1000.0,
        },
        [tailPcm.buffer]
      );

      this.accumOffset = 0;
      this.sumSquares = 0.0;
    }
    this.port.postMessage({ type: 'flushed', totalSamples: this.totalProcessedSamples });
  }

  process(inputs, _outputs, _parameters) {
    if (!this.isActive) return true;

    const inputChannels = inputs[0];
    if (!inputChannels || inputChannels.length === 0) return true;

    const ch0 = inputChannels[0];
    if (!ch0 || ch0.length === 0) return true;
    const nFrames = ch0.length;
    if (this.monoInput.length < nFrames) {
      this.monoInput = new Float32Array(nFrames);
    }

    // 1. Mono Downmixing into pre-allocated buffer
    if (inputChannels.length > 1) {
      const ch1 = inputChannels[1];
      for (let i = 0; i < nFrames; i++) {
        this.monoInput[i] = (ch0[i] + ch1[i]) * 0.5;
      }
    } else {
      this.monoInput.set(ch0);
    }

    // 2. 4th-Order Cascaded Anti-Aliasing Low-Pass Filtering
    if (this.filterEnabled) {
      for (let i = 0; i < nFrames; i++) {
        const x = this.monoInput[i];
        const y1 = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
        this.x2 = this.x1;
        this.x1 = x;
        this.y2 = this.y1;
        this.y1 = y1;

        const y2 = this.s2B0 * y1 + this.s2B1 * this.s2X1 + this.s2B2 * this.s2X2 - this.s2A1 * this.s2Y1 - this.s2A2 * this.s2Y2;
        this.s2X2 = this.s2X1;
        this.s2X1 = y1;
        this.s2Y2 = this.s2Y1;
        this.s2Y1 = y2;
        this.monoInput[i] = y2;
      }
    }

    // 3. Resampling to 16,000 Hz
    if (this.ratio === 1.0) {
      // Direct pass-through
      for (let i = 0; i < nFrames; i++) {
        this._pushSample(this.monoInput[i]);
      }
    } else {
      // Fractional phase-accumulator linear interpolation across quantum boundaries
      while (this.phase < nFrames) {
        let sample = 0.0;
        if (this.phase < 1.0) {
          sample = (1.0 - this.phase) * this.lastInputSample + this.phase * this.monoInput[0];
        } else {
          const idx = Math.floor(this.phase) - 1;
          const frac = this.phase - Math.floor(this.phase);
          const s0 = this.monoInput[idx];
          const s1 = idx + 1 < nFrames ? this.monoInput[idx + 1] : s0;
          sample = (1.0 - frac) * s0 + frac * s1;
        }

        this._pushSample(sample);
        this.phase += this.ratio;
      }

      this.phase -= nFrames;
      this.lastInputSample = this.monoInput[nFrames - 1];
    }

    return true;
  }

  _pushSample(sample) {
    let s = sample;

    if (this.noiseSuppressionEnabled) {
      // 1. 80 Hz 2nd-order Butterworth HPF (wind, breath thump, HVAC rumble, DC offset)
      const hpY = this.hpB0 * s + this.hpB1 * this.hpX1 + this.hpB2 * this.hpX2 - this.hpA1 * this.hpY1 - this.hpA2 * this.hpY2;
      this.hpX2 = this.hpX1; this.hpX1 = s;
      this.hpY2 = this.hpY1; this.hpY1 = hpY;

      // 2. 50 Hz & 60 Hz mains hum notch biquads
      const n50Y = this.n50B0 * hpY + this.n50B1 * this.n50X1 + this.n50B0 * this.n50X2 - this.n50A1 * this.n50Y1 - this.n50A2 * this.n50Y2;
      this.n50X2 = this.n50X1; this.n50X1 = hpY;
      this.n50Y2 = this.n50Y1; this.n50Y1 = n50Y;

      const n60Y = this.n60B0 * n50Y + this.n60B1 * this.n60X1 + this.n60B0 * this.n60X2 - this.n60A1 * this.n60Y1 - this.n60A2 * this.n60Y2;
      this.n60X2 = this.n60X1; this.n60X1 = n50Y;
      this.n60Y2 = this.n60Y1; this.n60Y1 = n60Y;

      // 3. Online causal noise-floor envelope & soft downward expander between syllables
      const absVal = n60Y >= 0.0 ? n60Y : -n60Y;
      this.smoothEnv = 0.992 * this.smoothEnv + 0.008 * absVal;
      if (this.smoothEnv < this.noiseFloorRms) {
        this.noiseFloorRms = 0.96 * this.noiseFloorRms + 0.04 * this.smoothEnv;
      } else {
        this.noiseFloorRms = 0.99985 * this.noiseFloorRms + 0.00015 * this.smoothEnv;
      }
      if (this.noiseFloorRms < 0.0003) this.noiseFloorRms = 0.0003;
      if (this.noiseFloorRms > 0.008) this.noiseFloorRms = 0.008;

      const gateThresh = this.noiseFloorRms * 1.6;
      const targetG = this.smoothEnv >= gateThresh
        ? 1.0
        : Math.max(0.45, this.smoothEnv / (gateThresh + 1e-8));
      this.expanderGain = 0.985 * this.expanderGain + 0.015 * targetG;
      s = n60Y * this.expanderGain;
    }

    if (this.alcEnabled) {
      const absIn = s >= 0.0 ? s : -s;
      this.alcEnv = absIn > this.alcEnv
        ? (0.985 * this.alcEnv + 0.015 * absIn)
        : (0.9992 * this.alcEnv + 0.0008 * absIn);
      let targetAlc = 1.0;
      if (this.alcEnv >= 0.0025 && this.alcEnv < 0.075) {
        targetAlc = Math.min(5.0, 0.075 / (this.alcEnv + 1e-6));
      } else if (this.alcEnv > 0.14) {
        targetAlc = Math.max(0.6, 0.14 / this.alcEnv);
      }
      this.alcGain = 0.996 * this.alcGain + 0.004 * targetAlc;
      s *= this.alcGain;
    }

    // Clamping to standard PCM range [-1.0, 1.0]
    if (s > 1.0) s = 1.0;
    else if (s < -1.0) s = -1.0;

    this.accumBuffer[this.accumOffset++] = s;
    this.sumSquares += s * s;
    this.totalProcessedSamples++;

    if (this.accumOffset >= this.chunkSamples) {
      this._emitChunk();
    }
  }

  _emitChunk() {
    const rms = Math.sqrt(this.sumSquares / this.chunkSamples);
    const snrDb = 20.0 * Math.log10((rms + 1e-6) / (this.noiseFloorRms + 1e-6));
    let isSpeech = true;

    if (this.vadEnabled) {
      const active = rms >= this.vadThreshold;
      if (active) {
        this.hangoverRemaining = this.vadHangoverFrames;
      } else if (this.hangoverRemaining > 0) {
        this.hangoverRemaining--;
      }
      isSpeech = active || this.hangoverRemaining > 0;
    }

    if (this.silenceGateEnabled && !isSpeech) {
      // Dispatch lightweight silence event without transferable audio chunk
      this.port.postMessage({
        type: 'silence',
        rms,
        isSpeech: false,
        sampleRate: this.targetRate,
        timestampMs: (this.totalProcessedSamples / this.targetRate) * 1000.0,
      });
    } else {
      // Zero-allocation buffer pool check
      let outChunk = this.bufferPool.pop();
      if (!outChunk || outChunk.length !== this.chunkSamples) {
        outChunk = new Float32Array(this.chunkSamples);
      }
      outChunk.set(this.accumBuffer);

      this.port.postMessage(
        {
          type: 'chunk',
          audioChunk: outChunk,
          data: outChunk,
          rms,
          snrDb,
          noiseFloorRms: this.noiseFloorRms,
          isSpeech,
          sampleRate: this.targetRate,
          timestampMs: (this.totalProcessedSamples / this.targetRate) * 1000.0,
        },
        [outChunk.buffer]
      );
    }

    this.accumOffset = 0;
    this.sumSquares = 0.0;
    this.emittedChunks++;
  }
}

if (typeof registerProcessor === 'function') {
  registerProcessor('swanada-audio-capture-processor', SwanadaAudioCaptureProcessor);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SwanadaAudioCaptureProcessor };
}
