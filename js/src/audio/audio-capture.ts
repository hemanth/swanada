/**
 * SwanadaAudioCapture: Browser Microphone Ingestion Controller with AudioWorklet & ScriptProcessorNode fallback.
 */

export interface AudioCaptureConfig {
  sampleRate?: number;             // Target sample rate (default 16000)
  chunkDurationMs?: number;        // Target chunk duration (default 100 ms)
  chunkSamples?: number;           // Explicit chunk sample count (e.g. 1600, takes precedence)
  vadThreshold?: number;           // RMS threshold (default 0.005)
  vadEnabled?: boolean;            // Enable VAD energy classification (default true)
  silenceGateEnabled?: boolean;    // Suppress audio transmission during silence (default false)
  vadHangoverFrames?: number;      // Hangover frames to retain unvoiced ends (default 2)
  workletUrl?: string;             // Custom path to audio-capture-worklet.js
  preferScriptProcessor?: boolean; // Force legacy ScriptProcessorNode for testing
  deviceId?: string;               // Optional specific microphone device ID
}

export interface AudioChunkPayload {
  audioChunk: Float32Array;
  data: Float32Array;
  rms: number;
  isSpeech: boolean;
  isTail?: boolean;
  sampleRate: number;
  timestampMs: number;
}

export interface SilencePayload {
  rms: number;
  isSpeech: false;
  sampleRate: number;
  timestampMs: number;
}

export type AudioCaptureEvent = 'chunk' | 'silence' | 'error' | 'statechange';

export class SwanadaAudioCapture {
  private config: Required<AudioCaptureConfig>;
  private audioCtx: any = null;
  private mediaStream: any = null;
  private sourceNode: any = null;
  private workletNode: any = null;
  private scriptProcessorNode: any = null;
  private dummyDestination: any = null;
  private state: 'inactive' | 'starting' | 'recording' | 'paused' | 'stopped' = 'inactive';
  private listeners: Map<AudioCaptureEvent, Set<Function>> = new Map();
  private inlineBlobUrl: string | null = null;

  constructor(config: AudioCaptureConfig = {}) {
    const chunkDur = config.chunkDurationMs || 100;
    const targetSr = config.sampleRate || 16000;
    const calculatedSamples = Math.round((chunkDur / 1000.0) * targetSr);

    this.config = {
      sampleRate: targetSr,
      chunkDurationMs: chunkDur,
      chunkSamples: config.chunkSamples || calculatedSamples,
      vadThreshold: typeof config.vadThreshold === 'number' ? config.vadThreshold : 0.005,
      vadEnabled: config.vadEnabled !== false,
      silenceGateEnabled: Boolean(config.silenceGateEnabled),
      vadHangoverFrames: Number(config.vadHangoverFrames) || 2,
      workletUrl: config.workletUrl || './audio-capture-worklet.js',
      preferScriptProcessor: Boolean(config.preferScriptProcessor),
      deviceId: config.deviceId || '',
    };
  }

  static isSupported(): boolean {
    return typeof window !== 'undefined' &&
      Boolean(navigator?.mediaDevices?.getUserMedia) &&
      Boolean((window as any).AudioContext || (window as any).webkitAudioContext);
  }

  static isWorkletSupported(): boolean {
    return typeof window !== 'undefined' &&
      Boolean((window as any).AudioContext && 'audioWorklet' in (window as any).AudioContext.prototype);
  }

  on(event: 'chunk', callback: (payload: AudioChunkPayload) => void): this;
  on(event: 'silence', callback: (payload: SilencePayload) => void): this;
  on(event: 'error', callback: (error: Error) => void): this;
  on(event: 'statechange', callback: (state: string) => void): this;
  on(event: AudioCaptureEvent, callback: Function): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
    return this;
  }

  off(event: AudioCaptureEvent, callback: Function): this {
    this.listeners.get(event)?.delete(callback);
    return this;
  }

  private emit(event: AudioCaptureEvent, arg: any): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const cb of set) {
      try {
        cb(arg);
      } catch (err) {
        console.error(`Error in ${event} listener:`, err);
      }
    }
  }

  private setState(newState: 'inactive' | 'starting' | 'recording' | 'paused' | 'stopped'): void {
    this.state = newState;
    this.emit('statechange', newState);
  }

  getState(): string {
    return this.state;
  }

  async start(): Promise<void> {
    if (this.state === 'recording' || this.state === 'starting') return;
    this.setState('starting');

    try {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        throw new Error('navigator.mediaDevices.getUserMedia is not supported in this environment.');
      }

      // 1. Acquire Microphone MediaStream
      const audioConstraints: any = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      };
      if (this.config.deviceId) {
        audioConstraints.deviceId = { exact: this.config.deviceId };
      }

      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });

      // 2. Initialize AudioContext with interactive latency hint
      const AudioCtxClass = (window as any).AudioContext || (window as any).webkitAudioContext;
      this.audioCtx = new AudioCtxClass({ latencyHint: 'interactive' });

      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }

      this.sourceNode = this.audioCtx.createMediaStreamSource(this.mediaStream);

      // Keep-alive dummy gain node (pulls the audio graph without output to speakers)
      this.dummyDestination = this.audioCtx.createGain();
      this.dummyDestination.gain.value = 0.0;
      this.dummyDestination.connect(this.audioCtx.destination);

      // 3. Connect either AudioWorklet or ScriptProcessor fallback
      const useWorklet = !this.config.preferScriptProcessor && SwanadaAudioCapture.isWorkletSupported();

      if (useWorklet) {
        await this.initWorklet();
      } else {
        this.initScriptProcessor();
      }

      this.setState('recording');
    } catch (err: any) {
      this.setState('inactive');
      const errorObj = err instanceof Error ? err : new Error(String(err));
      this.emit('error', errorObj);
      await this.stop();
      throw errorObj;
    }
  }

  private async initWorklet(): Promise<void> {
    if (!this.audioCtx || !this.sourceNode || !this.dummyDestination) return;

    try {
      await this.audioCtx.audioWorklet.addModule(this.config.workletUrl);
    } catch (_loadErr) {
      // Fallback: load inline embedded blob
      this.inlineBlobUrl = this.createInlineWorkletBlobUrl();
      await this.audioCtx.audioWorklet.addModule(this.inlineBlobUrl);
    }

    const WorkletNodeClass = (window as any).AudioWorkletNode;
    this.workletNode = new WorkletNodeClass(this.audioCtx, 'swanada-audio-capture-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      processorOptions: {
        chunkSamples: this.config.chunkSamples,
        vadThreshold: this.config.vadThreshold,
        vadEnabled: this.config.vadEnabled,
        silenceGateEnabled: this.config.silenceGateEnabled,
        vadHangoverFrames: this.config.vadHangoverFrames,
      },
    });

    this.workletNode.port.onmessage = (ev: MessageEvent) => {
      const msg = ev.data;
      if (!msg) return;

      if (msg.type === 'chunk') {
        this.emit('chunk', msg);
      } else if (msg.type === 'silence') {
        this.emit('silence', msg);
      }
    };

    this.sourceNode.connect(this.workletNode);
    this.workletNode.connect(this.dummyDestination);
  }

  private initScriptProcessor(): void {
    if (!this.audioCtx || !this.sourceNode || !this.dummyDestination) return;

    const bufferSize = 4096;
    this.scriptProcessorNode = this.audioCtx.createScriptProcessor(bufferSize, 1, 1);

    const targetSr = this.config.sampleRate;
    const srcSr = this.audioCtx.sampleRate || 48000;
    const ratio = srcSr / targetSr;
    const chunkSamples = this.config.chunkSamples;
    const accumBuffer = new Float32Array(chunkSamples);
    let accumOffset = 0;
    let sumSquares = 0.0;
    let phase = 0.0;
    let lastSample = 0.0;
    let totalSamples = 0;
    let hangoverRemaining = 0;

    this.scriptProcessorNode.onaudioprocess = (e: any) => {
      if (this.state !== 'recording') return;

      const input = e.inputBuffer.getChannelData(0);
      const nFrames = input.length;

      while (phase < nFrames) {
        let s = 0.0;
        if (phase < 1.0) {
          s = (1.0 - phase) * lastSample + phase * input[0];
        } else {
          const idx = Math.floor(phase) - 1;
          const frac = phase - Math.floor(phase);
          const s0 = input[idx];
          const s1 = idx + 1 < nFrames ? input[idx + 1] : s0;
          s = (1.0 - frac) * s0 + frac * s1;
        }

        if (s > 1.0) s = 1.0;
        else if (s < -1.0) s = -1.0;

        accumBuffer[accumOffset++] = s;
        sumSquares += s * s;
        totalSamples++;

        if (accumOffset >= chunkSamples) {
          const rms = Math.sqrt(sumSquares / chunkSamples);
          let isSpeech = true;

          if (this.config.vadEnabled) {
            const active = rms >= this.config.vadThreshold;
            if (active) {
              hangoverRemaining = this.config.vadHangoverFrames;
            } else if (hangoverRemaining > 0) {
              hangoverRemaining--;
            }
            isSpeech = active || hangoverRemaining > 0;
          }

          if (this.config.silenceGateEnabled && !isSpeech) {
            this.emit('silence', {
              rms,
              isSpeech: false,
              sampleRate: targetSr,
              timestampMs: (totalSamples / targetSr) * 1000.0,
            });
          } else {
            const outChunk = new Float32Array(chunkSamples);
            outChunk.set(accumBuffer);
            this.emit('chunk', {
              audioChunk: outChunk,
              data: outChunk,
              rms,
              isSpeech,
              sampleRate: targetSr,
              timestampMs: (totalSamples / targetSr) * 1000.0,
            });
          }

          accumOffset = 0;
          sumSquares = 0.0;
        }

        phase += ratio;
      }

      phase -= nFrames;
      lastSample = input[nFrames - 1];
    };

    this.sourceNode.connect(this.scriptProcessorNode);
    this.scriptProcessorNode.connect(this.dummyDestination);
  }

  recycleBuffer(buffer: ArrayBuffer): void {
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'recycle', buffer }, [buffer]);
    }
  }

  pause(): void {
    if (this.state !== 'recording') return;
    this.setState('paused');
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'pause' });
    }
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.setState('recording');
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'resume' });
    }
  }

  async flush(): Promise<void> {
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'flush' });
    }
  }

  async stop(): Promise<void> {
    if (this.state === 'inactive' || this.state === 'stopped') return;
    this.setState('stopped');

    if (this.workletNode) {
      try {
        this.workletNode.port.postMessage({ type: 'flush' });
      } catch {}
    }

    if (this.mediaStream) {
      try {
        for (const track of this.mediaStream.getTracks()) {
          track.stop();
        }
      } catch {}
      this.mediaStream = null;
    }

    if (this.sourceNode) {
      try { this.sourceNode.disconnect(); } catch {}
      this.sourceNode = null;
    }

    if (this.workletNode) {
      try { this.workletNode.disconnect(); } catch {}
      this.workletNode = null;
    }

    if (this.scriptProcessorNode) {
      try { this.scriptProcessorNode.disconnect(); } catch {}
      this.scriptProcessorNode = null;
    }

    if (this.dummyDestination) {
      try { this.dummyDestination.disconnect(); } catch {}
      this.dummyDestination = null;
    }

    if (this.audioCtx) {
      try {
        if (this.audioCtx.state !== 'closed') {
          await this.audioCtx.close();
        }
      } catch {}
      this.audioCtx = null;
    }

    if (this.inlineBlobUrl && typeof URL !== 'undefined' && URL.revokeObjectURL) {
      URL.revokeObjectURL(this.inlineBlobUrl);
      this.inlineBlobUrl = null;
    }

    this.setState('inactive');
  }

  private createInlineWorkletBlobUrl(): string {
    const code = `
class SwanadaAudioCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = options?.processorOptions || {};
    this.targetRate = 16000;
    this.chunkSamples = Number(opts.chunkSamples) || 1600;
    this.vadThreshold = typeof opts.vadThreshold === 'number' ? opts.vadThreshold : 0.005;
    this.vadEnabled = opts.vadEnabled !== false;
    this.silenceGateEnabled = Boolean(opts.silenceGateEnabled);
    this.vadHangoverFrames = Number(opts.vadHangoverFrames) || 2;
    this.isActive = true;
    this.hangoverRemaining = 0;
    this.totalProcessedSamples = 0;
    this.monoInput = new Float32Array(128);
    this.accumBuffer = new Float32Array(this.chunkSamples);
    this.accumOffset = 0;
    this.sumSquares = 0.0;
    this.lastInputSample = 0.0;
    this.phase = 0.0;
    this.ratio = sampleRate / this.targetRate;
    if (sampleRate > this.targetRate) {
      const omega = (2.0 * Math.PI * 7500.0) / sampleRate;
      const sinOmega = Math.sin(omega);
      const cosOmega = Math.cos(omega);
      const alpha = sinOmega / (2.0 * 0.7071067811865476);
      const b0 = (1.0 - cosOmega) * 0.5;
      const b1 = 1.0 - cosOmega;
      const b2 = (1.0 - cosOmega) * 0.5;
      const a0 = 1.0 + alpha;
      const a1 = -2.0 * cosOmega;
      const a2 = 1.0 - alpha;
      this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0;
      this.a1 = a1 / a0; this.a2 = a2 / a0;
      this.x1 = 0.0; this.x2 = 0.0; this.y1 = 0.0; this.y2 = 0.0;
      this.filterEnabled = true;
    } else {
      this.filterEnabled = false;
    }
    this.bufferPool = [new Float32Array(this.chunkSamples), new Float32Array(this.chunkSamples)];
    this.port.onmessage = (event) => {
      const msg = event.data || {};
      if (msg.type === 'recycle' && msg.buffer) {
        this.bufferPool.push(new Float32Array(msg.buffer));
      } else if (msg.type === 'flush') {
        if (this.accumOffset > 0) {
          const tail = new Float32Array(this.accumOffset);
          tail.set(this.accumBuffer.subarray(0, this.accumOffset));
          const rms = Math.sqrt(this.sumSquares / this.accumOffset);
          this.port.postMessage({
            type: 'chunk', audioChunk: tail, data: tail, rms, isSpeech: true, isTail: true, sampleRate: this.targetRate
          }, [tail.buffer]);
          this.accumOffset = 0; this.sumSquares = 0.0;
        }
      } else if (msg.type === 'pause') {
        this.isActive = false;
      } else if (msg.type === 'resume') {
        this.isActive = true;
      }
    };
  }
  process(inputs) {
    if (!this.isActive) return true;
    const inChs = inputs[0];
    if (!inChs || inChs.length === 0) return true;
    const ch0 = inChs[0];
    if (!ch0) return true;
    const n = ch0.length;
    if (inChs.length > 1) {
      const ch1 = inChs[1];
      for (let i = 0; i < n; i++) this.monoInput[i] = (ch0[i] + ch1[i]) * 0.5;
    } else {
      this.monoInput.set(ch0);
    }
    if (this.filterEnabled) {
      for (let i = 0; i < n; i++) {
        const x = this.monoInput[i];
        const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
        this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
        this.monoInput[i] = y;
      }
    }
    if (this.ratio === 1.0) {
      for (let i = 0; i < n; i++) this._push(this.monoInput[i]);
    } else {
      while (this.phase < n) {
        let s = 0.0;
        if (this.phase < 1.0) {
          s = (1.0 - this.phase) * this.lastInputSample + this.phase * this.monoInput[0];
        } else {
          const idx = Math.floor(this.phase) - 1;
          const frac = this.phase - Math.floor(this.phase);
          const s0 = this.monoInput[idx];
          const s1 = idx + 1 < n ? this.monoInput[idx + 1] : s0;
          s = (1.0 - frac) * s0 + frac * s1;
        }
        this._push(s);
        this.phase += this.ratio;
      }
      this.phase -= n;
      this.lastInputSample = this.monoInput[n - 1];
    }
    return true;
  }
  _push(s) {
    let v = s > 1.0 ? 1.0 : (s < -1.0 ? -1.0 : s);
    this.accumBuffer[this.accumOffset++] = v;
    this.sumSquares += v * v;
    this.totalProcessedSamples++;
    if (this.accumOffset >= this.chunkSamples) {
      const rms = Math.sqrt(this.sumSquares / this.chunkSamples);
      let isSpeech = true;
      if (this.vadEnabled) {
        const active = rms >= this.vadThreshold;
        if (active) this.hangoverRemaining = this.vadHangoverFrames;
        else if (this.hangoverRemaining > 0) this.hangoverRemaining--;
        isSpeech = active || this.hangoverRemaining > 0;
      }
      if (this.silenceGateEnabled && !isSpeech) {
        this.port.postMessage({ type: 'silence', rms, isSpeech: false, sampleRate: this.targetRate });
      } else {
        let out = this.bufferPool.pop() || new Float32Array(this.chunkSamples);
        out.set(this.accumBuffer);
        this.port.postMessage({
          type: 'chunk', audioChunk: out, data: out, rms, isSpeech, sampleRate: this.targetRate
        }, [out.buffer]);
      }
      this.accumOffset = 0;
      this.sumSquares = 0.0;
    }
  }
}
registerProcessor('swanada-audio-capture-processor', SwanadaAudioCaptureProcessor);
`;
    if (typeof Blob !== 'undefined' && typeof URL !== 'undefined') {
      const blob = new Blob([code], { type: 'application/javascript' });
      return URL.createObjectURL(blob);
    }
    return '';
  }
}
