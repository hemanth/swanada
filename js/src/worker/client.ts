/**
 * swanada: TypeScript Client Wrapper for STT Web Worker (SwanadaWorkerClient).
 * Provides event subscription, Promise-based lifecycle methods,
 * and zero-copy Transferable ArrayBuffer dispatching.
 */

import type { SupportedLanguage, ExecutionProvider, TranscriptionResult } from '../models/types.ts';

export interface SwanadaWorkerConfig {
  workerUrl?: string | URL;
  language?: SupportedLanguage;
  modelUrl?: string;
  vocabUrl?: string;
  executionProvider?: ExecutionProvider;
  numThreads?: number;
  wasmPaths?: string;
  cacheName?: string;
}

export interface WorkerProgressEvent {
  stage: 'downloading' | 'compiling' | 'warmup';
  progress: number;
  loadedBytes?: number;
  totalBytes?: number;
  fromCache: boolean;
}

export interface WorkerPartialEvent {
  text: string;
  iast?: string;
  rtf: number;
  tokens: string[];
  chunkIndex?: number;
}

export interface WorkerReadyEvent {
  language: SupportedLanguage;
  executionProvider: ExecutionProvider;
  numThreads: number;
  fromCache: boolean;
}

export type WorkerEventListenerMap = {
  ready: (event: WorkerReadyEvent) => void;
  progress: (event: WorkerProgressEvent) => void;
  partial: (event: WorkerPartialEvent) => void;
  final: (event: TranscriptionResult & { iast?: string }) => void;
  error: (event: { message: string; fatal: boolean }) => void;
};

export class SwanadaWorkerClient {
  private worker: Worker;
  private listeners: { [K in keyof WorkerEventListenerMap]?: Set<WorkerEventListenerMap[K]> } = {};
  private readyPromise: Promise<WorkerReadyEvent>;
  private readyResolve!: (value: WorkerReadyEvent) => void;
  private readyReject!: (reason?: any) => void;
  private finalResolve: ((result: TranscriptionResult & { iast?: string }) => void) | null = null;
  private finalReject: ((reason?: any) => void) | null = null;
  private isTerminated = false;

  constructor(config: SwanadaWorkerConfig = {}) {
    const workerScript = config.workerUrl || './stt-worker.mjs';
    if (typeof workerScript === 'object' && workerScript !== null && !(workerScript instanceof URL)) {
      this.worker = workerScript as unknown as Worker;
    } else if (typeof Worker !== 'undefined') {
      this.worker = typeof workerScript === 'string'
        ? new Worker(workerScript, { type: 'module' })
        : new Worker((workerScript as URL).href, { type: 'module' });
    } else {
      // Mock or node environment wrapper
      this.worker = {
        postMessage: () => {},
        terminate: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
      } as any;
    }

    this.readyPromise = new Promise<WorkerReadyEvent>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });

    this.setupWorkerListeners();

    // Auto-initiate if config provided
    this.init(config).catch((err) => {
      this.emit('error', { message: err.message, fatal: true });
    });
  }

  private setupWorkerListeners(): void {
    if (!this.worker) return;

    const onMessage = (event: MessageEvent) => {
      const msg = event.data;
      if (!msg || !msg.type) return;

      switch (msg.type) {
        case 'READY': {
          const readyEvent: WorkerReadyEvent = {
            language: msg.language,
            executionProvider: msg.executionProvider,
            numThreads: msg.numThreads,
            fromCache: Boolean(msg.fromCache),
          };
          this.readyResolve(readyEvent);
          this.emit('ready', readyEvent);
          break;
        }

        case 'PROGRESS': {
          this.emit('progress', {
            stage: msg.stage,
            progress: msg.progress,
            loadedBytes: msg.loadedBytes,
            totalBytes: msg.totalBytes,
            fromCache: Boolean(msg.fromCache),
          });
          break;
        }

        case 'PARTIAL': {
          this.emit('partial', {
            text: msg.text,
            iast: msg.iast,
            rtf: msg.rtf,
            tokens: msg.tokens,
            chunkIndex: msg.chunkIndex,
          });
          break;
        }

        case 'FINAL': {
          const result: TranscriptionResult & { iast?: string } = {
            text: msg.text,
            iast: msg.iast,
            language: msg.language || '',
            durationMs: msg.durationMs,
            inferenceMs: msg.inferenceMs,
            rtf: msg.rtf,
            tokens: msg.tokens,
          };
          this.emit('final', result);
          if (this.finalResolve) {
            this.finalResolve(result);
            this.finalResolve = null;
            this.finalReject = null;
          }
          break;
        }

        case 'ERROR': {
          const errPayload = { message: msg.message, fatal: Boolean(msg.fatal) };
          this.emit('error', errPayload);
          if (msg.fatal) {
            this.readyReject(new Error(msg.message));
          }
          if (this.finalReject) {
            this.finalReject(new Error(msg.message));
            this.finalResolve = null;
            this.finalReject = null;
          }
          break;
        }
      }
    };

    const onError = (err: any) => {
      const errorObj = { message: err?.message || 'Worker thread execution error', fatal: true };
      this.emit('error', errorObj);
      this.readyReject(new Error(errorObj.message));
      if (this.finalReject) {
        this.finalReject(new Error(errorObj.message));
      }
    };

    if (typeof this.worker.addEventListener === 'function') {
      this.worker.addEventListener('message', onMessage);
      this.worker.addEventListener('error', onError);
    }
    this.worker.onmessage = onMessage;
    this.worker.onerror = onError;
  }

  /**
   * Initializes the background STT worker and awaits readiness.
   */
  async init(config: SwanadaWorkerConfig): Promise<WorkerReadyEvent> {
    if (this.isTerminated) throw new Error('Cannot initialize terminated worker.');
    this.worker.postMessage({
      type: 'INIT',
      language: config.language || 'sa',
      modelUrl: config.modelUrl,
      vocabUrl: config.vocabUrl,
      executionProvider: config.executionProvider || 'wasm',
      numThreads: config.numThreads,
      wasmPaths: config.wasmPaths,
      cacheName: config.cacheName,
    });
    return this.readyPromise;
  }

  /**
   * Waits until the worker is fully compiled and ready.
   */
  async whenReady(): Promise<WorkerReadyEvent> {
    return this.readyPromise;
  }

  /**
   * Changes the active language model.
   */
  async setLanguage(
    language: SupportedLanguage,
    options: { modelUrl?: string; vocabUrl?: string } = {}
  ): Promise<void> {
    await this.whenReady();
    this.worker.postMessage({
      type: 'SET_LANGUAGE',
      language,
      modelUrl: options.modelUrl,
      vocabUrl: options.vocabUrl,
    });
  }

  /**
   * Pushes a 16 kHz Float32 PCM chunk using zero-copy Transferable ArrayBuffer.
   */
  pushAudio(chunk: Float32Array, isFinal: boolean = false): void {
    if (this.isTerminated) throw new Error('Cannot push audio to terminated worker.');

    // Ensure the buffer is transferred without copying
    // If the slice is a sub-array, copy once to obtain a dedicated buffer for transfer
    const isFullBuffer = chunk.byteOffset === 0 && chunk.byteLength === chunk.buffer.byteLength;
    const transferBuffer = isFullBuffer ? chunk : new Float32Array(chunk);

    this.worker.postMessage(
      {
        type: 'AUDIO_CHUNK',
        audio: transferBuffer,
        isFinal,
      },
      [transferBuffer.buffer]
    );
  }

  /**
   * Transcribes a complete audio buffer in one shot via the background worker.
   */
  async transcribe(pcm: Float32Array): Promise<TranscriptionResult & { iast?: string }> {
    await this.whenReady();
    return new Promise((resolve, reject) => {
      this.finalResolve = resolve;
      this.finalReject = reject;
      this.pushAudio(pcm, true);
    });
  }

  /**
   * Resets active audio accumulator and CTC decoder state.
   */
  reset(): void {
    if (!this.isTerminated) {
      this.worker.postMessage({ type: 'RESET' });
    }
  }

  /**
   * Subscribes to worker lifecycle and transcription events.
   * Returns an unsubscribe function.
   */
  on<K extends keyof WorkerEventListenerMap>(event: K, handler: WorkerEventListenerMap[K]): () => void {
    if (!this.listeners[event]) {
      this.listeners[event] = new Set() as any;
    }
    this.listeners[event]!.add(handler as any);
    return () => {
      this.listeners[event]?.delete(handler as any);
    };
  }

  private emit<K extends keyof WorkerEventListenerMap>(
    event: K,
    payload: Parameters<WorkerEventListenerMap[K]>[0]
  ): void {
    const handlers = this.listeners[event];
    if (handlers) {
      for (const h of handlers) {
        try {
          (h as Function)(payload);
        } catch (err) {
          console.error(`Error in SwanadaWorkerClient listener for "${event}":`, err);
        }
      }
    }
  }

  /**
   * Immediately terminates the background worker thread.
   */
  terminate(): void {
    this.isTerminated = true;
    if (typeof this.worker.terminate === 'function') {
      this.worker.terminate();
    }
    this.listeners = {};
    if (this.finalReject) {
      this.finalReject(new Error('SwanadaWorkerClient was terminated.'));
    }
  }
}
