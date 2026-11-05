/**
 * Bandlimited anti-aliasing audio resampler and browser Web Audio ingestion helpers.
 */

import { parseWav } from './ingest.ts';

/**
 * Resamples a mono Float32Array PCM buffer to the target sample rate (default: 16000 Hz).
 * When downsampling (e.g. 44.1k or 48k to 16k), applies a 25-tap Hamming-windowed
 * sinc low-pass anti-aliasing filter to prevent Nyquist foldover distortion.
 */
export function resamplePcm(
  input: Float32Array,
  srcSr: number,
  targetSr: number = 16000
): Float32Array {
  if (srcSr <= 0 || targetSr <= 0) {
    throw new Error(`Invalid sample rate: srcSr=${srcSr}, targetSr=${targetSr}`);
  }
  if (srcSr === targetSr) {
    return new Float32Array(input);
  }
  if (input.length === 0) {
    return new Float32Array(0);
  }

  const ratio = srcSr / targetSr;
  const outLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outLength);

  if (ratio > 1.0) {
    // Downsampling: apply 25-tap anti-aliasing FIR filter (12 left, center, 12 right)
    const cutoff = 0.45 / ratio; // Normalized cutoff frequency [0, 0.5]
    const halfFilter = 12;
    const fir = new Float32Array(2 * halfFilter + 1);
    let sum = 0;

    for (let i = -halfFilter; i <= halfFilter; i++) {
      const w = 0.54 + 0.46 * Math.cos((Math.PI * i) / halfFilter);
      const h = i === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * i) / (Math.PI * i);
      const val = h * w;
      fir[i + halfFilter] = val;
      sum += val;
    }
    // Normalize filter gain to 1.0 at DC
    if (sum !== 0) {
      for (let i = 0; i < fir.length; i++) {
        fir[i] /= sum;
      }
    }

    // Convolve with FIR filter
    const filtered = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      let acc = 0;
      for (let j = -halfFilter; j <= halfFilter; j++) {
        const idx = i + j;
        if (idx >= 0 && idx < input.length) {
          acc += input[idx] * fir[j + halfFilter];
        }
      }
      filtered[i] = acc;
    }

    // Linear interpolation from filtered buffer
    for (let i = 0; i < outLength; i++) {
      const pos = i * ratio;
      const idx = Math.floor(pos);
      const frac = pos - idx;
      const s0 = filtered[idx] ?? 0;
      const s1 = (idx + 1 < filtered.length) ? filtered[idx + 1] : s0;
      output[i] = (1 - frac) * s0 + frac * s1;
    }
  } else {
    // Upsampling: direct linear interpolation
    for (let i = 0; i < outLength; i++) {
      const pos = i * ratio;
      const idx = Math.floor(pos);
      const frac = pos - idx;
      const s0 = input[idx] ?? 0;
      const s1 = (idx + 1 < input.length) ? input[idx + 1] : s0;
      output[i] = (1 - frac) * s0 + frac * s1;
    }
  }

  return output;
}

/**
 * Universal browser audio decoder and resampler.
 * Decodes compressed or uncompressed audio formats (WAV, MP3, OGG, AAC) via Web Audio API,
 * and resamples to 16 kHz mono Float32Array using OfflineAudioContext.
 * If Web Audio API is unavailable (e.g. isolated Web Worker), falls back to pure JS WAV parsing.
 */
export async function decodeAndResampleBrowser(
  arrayBuffer: ArrayBuffer,
  targetSr: number = 16000
): Promise<Float32Array> {
  const hasAudioContext = typeof window !== 'undefined' &&
    (typeof (window as any).AudioContext !== 'undefined' || typeof (window as any).webkitAudioContext !== 'undefined');
  const hasOfflineAudioContext = typeof window !== 'undefined' &&
    (typeof (window as any).OfflineAudioContext !== 'undefined' || typeof (window as any).webkitOfflineAudioContext !== 'undefined');

  if (hasAudioContext && hasOfflineAudioContext) {
    const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
    const OfflineAudioContextClass = (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext;

    const audioCtx = new AudioContextClass();
    try {
      // decodeAudioData consumes the ArrayBuffer; slice a copy to keep original intact
      const copy = arrayBuffer.slice(0);
      const decodedBuffer = await audioCtx.decodeAudioData(copy);

      // Fast path: already 16 kHz mono
      if (decodedBuffer.sampleRate === targetSr && decodedBuffer.numberOfChannels === 1) {
        return decodedBuffer.getChannelData(0);
      }

      const targetSamples = Math.max(1, Math.ceil(decodedBuffer.duration * targetSr));
      const offlineCtx = new OfflineAudioContextClass(1, targetSamples, targetSr);

      const source = offlineCtx.createBufferSource();
      source.buffer = decodedBuffer;
      source.connect(offlineCtx.destination);
      source.start(0);

      const renderedBuffer = await offlineCtx.startRendering();
      return renderedBuffer.getChannelData(0);
    } finally {
      if (typeof audioCtx.close === 'function') {
        await audioCtx.close();
      }
    }
  }

  // Fallback for Node.js or Workers: parse as WAV directly
  const { pcm, sampleRate } = parseWav(arrayBuffer);
  return resamplePcm(pcm, sampleRate, targetSr);
}
