/**
 * Deterministic Log-Mel Spectrogram Frontend.
 * Bit-for-bit analytical equivalent to preprocessor.onnx (PyTorch FilterbankFeatures).
 *
 * Signal processing pipeline:
 * 1. Pre-emphasis filter: y[t] = x[t] - 0.97 * x[t-1]
 * 2. Centered constant zero-padding of 256 samples (N_fft // 2) on both ends
 * 3. 400-point periodic=False Hann window padded to 512-point buffer
 * 4. 512-point Radix-2 Cooley-Tukey STFT with 160-sample (10 ms) hop
 * 5. Power spectrum (|X|^2 = Re^2 + Im^2)
 * 6. Slaney area-normalized 80-channel triangular mel filterbank (0 - 8000 Hz)
 * 7. Regularized natural logarithm ln(P_mel + 5.960464477539063e-08)
 * 8. Utterance-level CMVN with T-1 sample variance and 10^-5 floor
 * 9. Zero-masking for trailing padding frames (t >= T)
 */

import type { MelSpectrogramResult } from './types.ts';

export const N_FFT = 512;
export const WIN_LENGTH = 400;
export const HOP_LENGTH = 160;
export const N_MELS = 80;
export const SAMPLE_RATE = 16000;
export const PREEMPH_COEFF = 0.97;
export const LOG_EPSILON = 5.960464477539063e-08; // 2^-24
export const CMVN_FLOOR = 1e-05;

/**
 * Converts frequency in Hertz to Slaney mel scale.
 */
export function hzToMel(f: number): number {
  const fSp = 200.0 / 3;
  if (f < 1000.0) return f / fSp;
  const minLogMel = 15.0; // 1000.0 / fSp
  const logstep = Math.log(6.4) / 27.0;
  return minLogMel + Math.log(f / 1000.0) / logstep;
}

/**
 * Converts Slaney mel scale to frequency in Hertz.
 */
export function melToHz(m: number): number {
  const fSp = 200.0 / 3;
  if (m < 15.0) return m * fSp;
  const minLogMel = 15.0;
  const logstep = Math.log(6.4) / 27.0;
  return 1000.0 * Math.exp(logstep * (m - minLogMel));
}

/**
 * Constructs the 80x257 Slaney area-normalized Mel filterbank matrix.
 */
export function createMelFilterbank(
  sr: number = SAMPLE_RATE,
  nFft: number = N_FFT,
  nMels: number = N_MELS,
  fmin: number = 0.0,
  fmax: number = 8000.0
): Float32Array {
  const numFreqs = Math.floor(nFft / 2) + 1; // 257
  const minMel = hzToMel(fmin);
  const maxMel = hzToMel(fmax);
  const melPoints = new Float64Array(nMels + 2);
  for (let i = 0; i < nMels + 2; i++) {
    const mel = minMel + (i / (nMels + 1)) * (maxMel - minMel);
    melPoints[i] = melToHz(mel);
  }

  const fftFreqs = new Float64Array(numFreqs);
  for (let i = 0; i < numFreqs; i++) {
    fftFreqs[i] = (i * sr) / nFft;
  }

  const weights = new Float32Array(nMels * numFreqs);

  for (let i = 0; i < nMels; i++) {
    const fPrev = melPoints[i];
    const fCenter = melPoints[i + 1];
    const fNext = melPoints[i + 2];
    const enorm = 2.0 / (fNext - fPrev); // Slaney area normalization

    for (let j = 0; j < numFreqs; j++) {
      const freq = fftFreqs[j];
      let w = 0.0;
      if (freq >= fPrev && freq <= fCenter) {
        w = (freq - fPrev) / (fCenter - fPrev);
      } else if (freq > fCenter && freq <= fNext) {
        w = (fNext - freq) / (fNext - fCenter);
      }
      weights[i * numFreqs + j] = Math.max(0.0, w) * enorm;
    }
  }
  return weights;
}

/**
 * Constructs a 400-point periodic=False Hann window padded symmetrically
 * into a 512-point buffer with 56 leading and 56 trailing zeros.
 */
export function createPaddedHannWindow(
  winLength: number = WIN_LENGTH,
  nFft: number = N_FFT
): Float32Array {
  const window = new Float32Array(nFft);
  const padLeft = Math.floor((nFft - winLength) / 2); // 56
  for (let i = 0; i < winLength; i++) {
    // torch.hann_window(400, periodic=False)
    window[padLeft + i] = 0.5 * (1.0 - Math.cos((2.0 * Math.PI * i) / (winLength - 1)));
  }
  return window;
}

/**
 * In-place Radix-2 Cooley-Tukey 512-point complex FFT.
 */
export function fft512(real: Float32Array, imag: Float32Array): void {
  const N = 512;

  // 1. Bit-reversal permutation
  let j = 0;
  for (let i = 0; i < N - 1; i++) {
    if (i < j) {
      const tr = real[i]; real[i] = real[j]; real[j] = tr;
      const ti = imag[i]; imag[i] = imag[j]; imag[j] = ti;
    }
    let k = N >> 1;
    while (k <= j) {
      j -= k;
      k >>= 1;
    }
    j += k;
  }

  // 2. Butterfly updates
  for (let len = 2; len <= N; len <<= 1) {
    const halfLen = len >> 1;
    const angle = -2 * Math.PI / len;
    const wstepR = Math.cos(angle);
    const wstepI = Math.sin(angle);
    for (let i = 0; i < N; i += len) {
      let wR = 1.0;
      let wI = 0.0;
      for (let k = 0; k < halfLen; k++) {
        const uR = real[i + k];
        const uI = imag[i + k];
        const vR = real[i + k + halfLen] * wR - imag[i + k + halfLen] * wI;
        const vI = real[i + k + halfLen] * wI + imag[i + k + halfLen] * wR;
        real[i + k] = uR + vR;
        imag[i + k] = uI + vI;
        real[i + k + halfLen] = uR - vR;
        imag[i + k + halfLen] = uI - vI;
        const nextWR = wR * wstepR - wI * wstepI;
        wI = wR * wstepI + wI * wstepR;
        wR = nextWR;
      }
    }
  }
}

// Precomputed static lookup assets
export const STATIC_WINDOW = createPaddedHannWindow(WIN_LENGTH, N_FFT);
export const STATIC_MEL_FB = createMelFilterbank(SAMPLE_RATE, N_FFT, N_MELS);

/**
 * Extracts 80-channel log-mel filterbank features with utterance-level CMVN.
 * Output tensor shape: [1, 80, numFrames], matching NeMo FilterbankFeatures / preprocessor.onnx.
 *
 * @param pcm Float32Array mono audio at 16,000 Hz normalized to [-1.0, 1.0]
 * @param sr Sample rate (must be 16000)
 */
export function extractLogMelFeatures(
  pcm: Float32Array,
  sr: number = SAMPLE_RATE
): MelSpectrogramResult {
  if (sr !== SAMPLE_RATE) {
    throw new Error(`extractLogMelFeatures expects 16000 Hz, got ${sr} Hz`);
  }

  const N = pcm.length;
  if (N === 0) {
    return {
      features: new Float32Array(0),
      shape: [1, N_MELS, 0],
      featureLength: 0,
      numFrames: 0,
    };
  }

  const numFreqs = Math.floor(N_FFT / 2) + 1; // 257
  const numFrames = Math.floor(N / HOP_LENGTH) + 1;
  const T = Math.floor(N / HOP_LENGTH); // Valid frames count

  // 1. Pre-emphasis filter: y[t] = x[t] - 0.97 * x[t-1]
  const emphasized = new Float32Array(N);
  emphasized[0] = pcm[0];
  for (let i = 1; i < N; i++) {
    emphasized[i] = pcm[i] - PREEMPH_COEFF * pcm[i - 1];
  }

  // 2. Centered padding (N_fft // 2 = 256 zeros on both ends)
  const padAmount = N_FFT / 2; // 256
  const padded = new Float32Array(N + N_FFT);
  padded.set(emphasized, padAmount);

  // Buffer for log-mel filterbank energies [80, numFrames]
  const logMel = new Float32Array(N_MELS * numFrames);

  const real = new Float32Array(N_FFT);
  const imag = new Float32Array(N_FFT);
  const power = new Float32Array(numFreqs);

  // 3. Framing, Windowing, STFT, and Mel Projection
  for (let t = 0; t < numFrames; t++) {
    const start = t * HOP_LENGTH;
    for (let i = 0; i < N_FFT; i++) {
      real[i] = padded[start + i] * STATIC_WINDOW[i];
      imag[i] = 0.0;
    }

    fft512(real, imag);

    for (let k = 0; k < numFreqs; k++) {
      power[k] = real[k] * real[k] + imag[k] * imag[k];
    }

    for (let m = 0; m < N_MELS; m++) {
      let sum = 0.0;
      const fbOffset = m * numFreqs;
      for (let k = 0; k < numFreqs; k++) {
        sum += STATIC_MEL_FB[fbOffset + k] * power[k];
      }
      logMel[m * numFrames + t] = Math.log(sum + LOG_EPSILON);
    }
  }

  // 4. Utterance-level CMVN
  const normalized = new Float32Array(N_MELS * numFrames);

  if (T <= 1) {
    // Edge case: audio is too short to estimate sample variance
    return {
      features: normalized,
      shape: [1, N_MELS, numFrames],
      featureLength: T,
      numFrames,
    };
  }

  for (let m = 0; m < N_MELS; m++) {
    const rowOffset = m * numFrames;

    // Mean over valid frames [0, T-1]
    let mean = 0.0;
    for (let t = 0; t < T; t++) {
      mean += logMel[rowOffset + t];
    }
    mean /= T;

    // Sample variance (T - 1 degrees of freedom)
    let varSum = 0.0;
    for (let t = 0; t < T; t++) {
      const diff = logMel[rowOffset + t] - mean;
      varSum += diff * diff;
    }
    const variance = varSum / (T - 1);
    let std = Math.sqrt(variance);
    if (isNaN(std)) std = 0.0;

    // Standardize
    for (let t = 0; t < T; t++) {
      normalized[rowOffset + t] = (logMel[rowOffset + t] - mean) / (std + CMVN_FLOOR);
    }

    // Zero out padding frames (t >= T)
    for (let t = T; t < numFrames; t++) {
      normalized[rowOffset + t] = 0.0;
    }
  }

  return {
    features: normalized,
    shape: [1, N_MELS, numFrames],
    featureLength: T,
    numFrames,
  };
}
