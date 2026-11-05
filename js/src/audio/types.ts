/**
 * Audio types and interfaces for Swanada audio pipeline.
 */

export interface DecodedAudio {
  pcm: Float32Array;
  sampleRate: number;
  numChannels: number;
  durationSec: number;
}

export interface AudioInputOptions {
  targetSampleRate?: number; // default: 16000
}

export interface MelSpectrogramResult {
  features: Float32Array; // Flattened [1, 80, numFrames] in row-major order
  shape: [number, number, number]; // [1, 80, numFrames]
  featureLength: number; // T = valid frames (Math.floor(numSamples / 160))
  numFrames: number; // numFrames = Math.floor(numSamples / 160) + 1
}

export interface AudioFrontend {
  extractFeatures(pcm: Float32Array, sr?: number): MelSpectrogramResult;
}
