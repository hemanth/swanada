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
    const currentSampleRate = typeof sampleRate !== 'undefined' ? sampleRate : 48000;
    this.ratio = currentSampleRate / this.targetRate;

    // 2nd-order Butterworth Anti-Aliasing Low-Pass Filter (fc = 7500 Hz, Q = 1/sqrt(2))
    if (currentSampleRate > this.targetRate) {
      const fc = 7500.0;
      const omega = (2.0 * Math.PI * fc) / currentSampleRate;
      const sinOmega = Math.sin(omega);
      const cosOmega = Math.cos(omega);
      const alpha = sinOmega / (2.0 * 0.7071067811865476); // Q = 1/sqrt(2)

      const b0 = (1.0 - cosOmega) * 0.5;
      const b1 = 1.0 - cosOmega;
      const b2 = (1.0 - cosOmega) * 0.5;
      const a0 = 1.0 + alpha;
      const a1 = -2.0 * cosOmega;
      const a2 = 1.0 - alpha;

      this.b0 = b0 / a0;
      this.b1 = b1 / a0;
      this.b2 = b2 / a0;
      this.a1 = a1 / a0;
      this.a2 = a2 / a0;

      this.x1 = 0.0;
      this.x2 = 0.0;
      this.y1 = 0.0;
      this.y2 = 0.0;
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
        }
      } else if (type === 'config') {
        if (typeof msg.vadThreshold === 'number') this.vadThreshold = msg.vadThreshold;
        if (typeof msg.silenceGateEnabled === 'boolean') this.silenceGateEnabled = msg.silenceGateEnabled;
        if (typeof msg.vadHangoverFrames === 'number') this.vadHangoverFrames = msg.vadHangoverFrames;
        if (typeof msg.vadEnabled === 'boolean') this.vadEnabled = msg.vadEnabled;
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

    // 1. Mono Downmixing into pre-allocated buffer
    if (inputChannels.length > 1) {
      const ch1 = inputChannels[1];
      for (let i = 0; i < nFrames; i++) {
        this.monoInput[i] = (ch0[i] + ch1[i]) * 0.5;
      }
    } else {
      this.monoInput.set(ch0);
    }

    // 2. Anti-Aliasing Low-Pass Filtering
    if (this.filterEnabled) {
      for (let i = 0; i < nFrames; i++) {
        const x = this.monoInput[i];
        const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
        this.x2 = this.x1;
        this.x1 = x;
        this.y2 = this.y1;
        this.y1 = y;
        this.monoInput[i] = y;
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
    // Clamping to standard PCM range [-1.0, 1.0]
    let s = sample;
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
