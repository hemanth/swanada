/**
 * Multi-Stage Real-Time ASR Background Noise Cancellation & Speech Enhancement Layer.
 *
 * Zero-dependency 16 kHz DSP pipeline:
 * 1. DC Offset Removal + 80 Hz 2nd-Order Butterworth High-Pass Filter (wind, desk thump, HVAC rumble)
 * 2. 50 Hz & 60 Hz High-Q Biquad Notch Cascade (India 50 Hz & Americas 60 Hz mains hum rejection)
 * 3. SNR-Adaptive Ephraim-Malah Decision-Directed Spectral Wiener Filter (512-pt sqrt-Hann exact NOLA OLA)
 * 4. Formant-Band Speech Presence Ratio + Stationary Noise Gate & Peak Safety Limiter
 */

import { fft512, SAMPLE_RATE } from './frontend.ts';

export interface DenoiseOptions {
  /** Sample rate in Hz (default: 16000) */
  sampleRate?: number;
  /** High-pass cutoff frequency in Hz (default: 80) */
  highPassHz?: number;
  /** Reject 50 Hz and 60 Hz mains hum via narrow biquad notches (default: true) */
  humNotch?: boolean;
  /** Enable spectral Ephraim-Malah Wiener noise suppression (default: true) */
  spectralDenoise?: boolean;
  /** Clean-speech fidelity bypass threshold in dB SNR (default: 26) */
  cleanBypassSnrDb?: number;
  /** Minimum Wiener spectral gain floor in linear amplitude (default: 0.14 = -17.1 dB) */
  spectralFloor?: number;
  /** Suppress pure stationary non-speech noise floors to prevent CTC hallucinations (default: true) */
  nonSpeechGate?: boolean;
  /** Enable gentle soft-knee AGC (default: false since Log-Mel CMVN is scale-invariant) */
  adaptiveGain?: boolean;
}

export interface DenoiseTelemetry {
  pcm: Float32Array;
  estimatedSnrDb: number;
  noiseFloorDbfs: number;
  suppressionDb: number;
  isSpeechLikely: boolean;
}

const STFT_N = 512;
const STFT_HOP = 256;
const NUM_BINS = 257;

// Precomputed sqrt(periodic Hann) window so w[n]^2 + w[n + 256]^2 === 1.0 (Exact NOLA reconstruction)
const SQRT_HANN_512 = (() => {
  const w = new Float32Array(STFT_N);
  for (let n = 0; n < STFT_N; n++) {
    const hann = 0.5 * (1.0 - Math.cos((2.0 * Math.PI * n) / STFT_N));
    w[n] = Math.sqrt(Math.max(0.0, hann));
  }
  return w;
})();

interface BiquadCoeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

function designHighPassBiquad(fc: number, sr: number, q: number = Math.SQRT1_2): BiquadCoeffs {
  const omega = (2.0 * Math.PI * fc) / sr;
  const sinW = Math.sin(omega);
  const cosW = Math.cos(omega);
  const alpha = sinW / (2.0 * q);
  const b0 = (1.0 + cosW) * 0.5;
  const b1 = -(1.0 + cosW);
  const b2 = (1.0 + cosW) * 0.5;
  const a0 = 1.0 + alpha;
  const a1 = -2.0 * cosW;
  const a2 = 1.0 - alpha;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function designNotchBiquad(f0: number, sr: number, q: number = 22.0): BiquadCoeffs {
  const omega = (2.0 * Math.PI * f0) / sr;
  const sinW = Math.sin(omega);
  const cosW = Math.cos(omega);
  const alpha = sinW / (2.0 * q);
  const b0 = 1.0;
  const b1 = -2.0 * cosW;
  const b2 = 1.0;
  const a0 = 1.0 + alpha;
  const a1 = -2.0 * cosW;
  const a2 = 1.0 - alpha;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function applyBiquadInPlace(buf: Float32Array, c: BiquadCoeffs): void {
  let x1 = 0.0;
  let x2 = 0.0;
  let y1 = 0.0;
  let y2 = 0.0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i];
    const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    buf[i] = y;
  }
}

const HPF_80_16K = designHighPassBiquad(80.0, SAMPLE_RATE);
const NOTCH_50_16K = designNotchBiquad(50.0, SAMPLE_RATE, 22.0);
const NOTCH_60_16K = designNotchBiquad(60.0, SAMPLE_RATE, 22.0);

interface StftResult {
  allReal: Float32Array;
  allImag: Float32Array;
  allPower: Float32Array;
  numFrames: number;
  paddedLen: number;
}

function computeStft(signal: Float32Array): StftResult {
  const N = signal.length;
  const pad = STFT_HOP;
  const paddedLen = N + 2 * pad + STFT_N;
  const numFrames = Math.floor((N + 2 * pad - STFT_N) / STFT_HOP) + 1;
  const padded = new Float32Array(paddedLen);
  padded.set(signal, pad);

  const allReal = new Float32Array(numFrames * NUM_BINS);
  const allImag = new Float32Array(numFrames * NUM_BINS);
  const allPower = new Float32Array(numFrames * NUM_BINS);
  const fftRe = new Float32Array(STFT_N);
  const fftIm = new Float32Array(STFT_N);

  for (let t = 0; t < numFrames; t++) {
    const start = t * STFT_HOP;
    for (let n = 0; n < STFT_N; n++) {
      fftRe[n] = padded[start + n] * SQRT_HANN_512[n];
      fftIm[n] = 0.0;
    }
    fft512(fftRe, fftIm);
    const base = t * NUM_BINS;
    for (let k = 0; k < NUM_BINS; k++) {
      const re = fftRe[k];
      const im = fftIm[k];
      allReal[base + k] = re;
      allImag[base + k] = im;
      allPower[base + k] = re * re + im * im;
    }
  }
  return { allReal, allImag, allPower, numFrames, paddedLen };
}

function percentileFloat(arr: Float32Array, q: number): number {
  if (arr.length === 0) return 0.0;
  const sorted = Float32Array.from(arr).sort();
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.min(sorted.length - 1, lo + 1);
  const frac = pos - lo;
  return sorted[lo] * (1.0 - frac) + sorted[hi] * frac;
}

/**
 * Enhances 16 kHz mono speech PCM by cancelling rumble, 50/60 Hz mains hum,
 * and broadband background noise via SNR-adaptive Ephraim-Malah Wiener filtering,
 * while preserving clean studio speech bit-for-bit.
 */
export function enhanceSpeechWithTelemetry(
  pcm: Float32Array,
  options: DenoiseOptions = {}
): DenoiseTelemetry {
  const N = pcm.length;
  if (N === 0) {
    return {
      pcm: new Float32Array(0),
      estimatedSnrDb: 0,
      noiseFloorDbfs: -100,
      suppressionDb: 0,
      isSpeechLikely: false,
    };
  }

  const sr = options.sampleRate ?? SAMPLE_RATE;
  const highPassHz = options.highPassHz ?? 80;
  const humNotch = options.humNotch !== false;
  const spectralDenoise = options.spectralDenoise !== false;
  const cleanBypassSnrDb = options.cleanBypassSnrDb ?? 26.0;
  const spectralFloor = Math.max(0.05, Math.min(1.0, options.spectralFloor ?? 0.14));
  const nonSpeechGate = options.nonSpeechGate !== false;
  const adaptiveGain = options.adaptiveGain === true;

  let cleanPcm = pcm;
  for (let i = 0; i < N; i++) {
    if (!Number.isFinite(pcm[i])) {
      cleanPcm = new Float32Array(N);
      for (let j = 0; j < N; j++) {
        const x = pcm[j];
        cleanPcm[j] = Number.isNaN(x) ? 0.0 : x > 0 ? 1.0 : x < 0 ? -1.0 : x;
      }
      break;
    }
  }
  pcm = cleanPcm;

  let rawSumSq = 0.0;
  let dcSum = 0.0;
  for (let i = 0; i < N; i++) {
    const v = pcm[i];
    dcSum += v;
    rawSumSq += v * v;
  }
  const rawRms = Math.sqrt(rawSumSq / N);
  if (rawRms < 1e-4) {
    return {
      pcm: new Float32Array(N),
      estimatedSnrDb: 0,
      noiseFloorDbfs: -100,
      suppressionDb: 0,
      isSpeechLikely: false,
    };
  }

  const dcMean = dcSum / N;
  const zeroMean = new Float32Array(N);
  let acSumSq = 0.0;
  for (let i = 0; i < N; i++) {
    const z = pcm[i] - dcMean;
    zeroMean[i] = z;
    acSumSq += z * z;
  }
  const acRms = Math.sqrt(acSumSq / N);
  const hasDcOffset = Math.abs(dcMean) > 0.015;

  if (N < STFT_N) {
    if (hasDcOffset) {
      const work = new Float32Array(zeroMean);
      const hpf = sr === SAMPLE_RATE && highPassHz === 80 ? HPF_80_16K : designHighPassBiquad(highPassHz, sr);
      applyBiquadInPlace(work, hpf);
      if (humNotch && sr >= 4000) {
        applyBiquadInPlace(work, sr === SAMPLE_RATE ? NOTCH_50_16K : designNotchBiquad(50.0, sr, 22.0));
        applyBiquadInPlace(work, sr === SAMPLE_RATE ? NOTCH_60_16K : designNotchBiquad(60.0, sr, 22.0));
      }
      return {
        pcm: work,
        estimatedSnrDb: 20,
        noiseFloorDbfs: 20 * Math.log10(Math.max(acRms * 0.1, 1e-5)),
        suppressionDb: 6,
        isSpeechLikely: true,
      };
    }
    return {
      pcm: new Float32Array(pcm),
      estimatedSnrDb: 35,
      noiseFloorDbfs: -70,
      suppressionDb: 0,
      isSpeechLikely: true,
    };
  }

  // Pre-scan interior STFT frames to detect stationary mains hum/rumble vs clean studio audio
  let stft = computeStft(zeroMean);
  const normScale = 1.0 / (STFT_HOP * STFT_N);
  const interiorStart = stft.numFrames > 4 ? 1 : 0;
  const interiorEnd = stft.numFrames > 4 ? stft.numFrames - 1 : stft.numFrames;
  const interiorCount = Math.max(1, interiorEnd - interiorStart);

  const kLfMax = Math.max(2, Math.round((85 * STFT_N) / sr));
  const lfFrameRms = new Float32Array(interiorCount);
  let lfMeanSum = 0.0;
  for (let idx = 0; idx < interiorCount; idx++) {
    const base = (interiorStart + idx) * NUM_BINS;
    let lfSum = 0.0;
    for (let k = 0; k <= kLfMax; k++) {
      lfSum += stft.allPower[base + k] * normScale;
    }
    const r = Math.sqrt(lfSum);
    lfFrameRms[idx] = r;
    lfMeanSum += r;
  }
  const lfP15 = percentileFloat(lfFrameRms, 0.15);
  const lfMean = lfMeanSum / interiorCount;
  const hasHumOrRumble = hasDcOffset || (lfP15 > 0.0085 && lfMean / (acRms + 1e-9) > 0.16);

  let work: Float32Array;
  if (hasHumOrRumble) {
    work = new Float32Array(zeroMean);
    const hpf = sr === SAMPLE_RATE && highPassHz === 80 ? HPF_80_16K : designHighPassBiquad(highPassHz, sr);
    applyBiquadInPlace(work, hpf);
    if (humNotch && sr >= 4000) {
      applyBiquadInPlace(work, sr === SAMPLE_RATE ? NOTCH_50_16K : designNotchBiquad(50.0, sr, 22.0));
      applyBiquadInPlace(work, sr === SAMPLE_RATE ? NOTCH_60_16K : designNotchBiquad(60.0, sr, 22.0));
    }
    if (!spectralDenoise) {
      let postSq = 0.0;
      for (let i = 0; i < N; i++) postSq += work[i] * work[i];
      const postRms = Math.sqrt(postSq / N) + 1e-9;
      const supp = Math.max(0.0, 20.0 * Math.log10(Math.max(rawRms, 1e-9) / postRms));
      return {
        pcm: work,
        estimatedSnrDb: 22,
        noiseFloorDbfs: -50,
        suppressionDb: supp,
        isSpeechLikely: true,
      };
    }
    stft = computeStft(work);
  } else {
    work = pcm;
    if (!spectralDenoise) {
      return {
        pcm: new Float32Array(pcm),
        estimatedSnrDb: 35,
        noiseFloorDbfs: -70,
        suppressionDb: 0,
        isSpeechLikely: true,
      };
    }
  }

  const { allReal, allImag, allPower, numFrames, paddedLen } = stft;
  const kSpeechMin = Math.max(3, Math.round((250 * STFT_N) / sr));
  const kSpeechMax = Math.min(NUM_BINS - 1, Math.round((3800 * STFT_N) / sr));
  const kHfMin = Math.min(NUM_BINS - 8, Math.max(kSpeechMin + 8, Math.round((3500 * STFT_N) / sr)));
  const kHfMax = Math.min(NUM_BINS - 2, Math.round((7800 * STFT_N) / sr));
  const sfmBinStart = Math.max(8, kSpeechMin);
  const sfmBinCount = Math.max(1, kHfMax - sfmBinStart + 1);

  const speechBandEnergy = new Float32Array(numFrames);
  const totalBandEnergy = new Float32Array(numFrames);
  const hfFrameRms = new Float32Array(interiorCount);
  const frameSfm = new Float32Array(interiorCount);
  const midHighRms = new Float32Array(interiorCount);

  for (let t = 0; t < numFrames; t++) {
    const base = t * NUM_BINS;
    let sbSum = 0.0;
    let totSum = 0.0;
    for (let k = 0; k < NUM_BINS; k++) {
      const p = allPower[base + k];
      totSum += p;
      if (k >= kSpeechMin && k <= kSpeechMax) sbSum += p;
    }
    speechBandEnergy[t] = sbSum;
    totalBandEnergy[t] = totSum;

    if (t >= interiorStart && t < interiorEnd) {
      const ii = t - interiorStart;
      let hfSum = 0.0;
      let mhSum = 0.0;
      let logSum = 0.0;
      let linSum = 0.0;
      for (let k = 3; k < NUM_BINS; k++) {
        const pn = allPower[base + k] * normScale;
        mhSum += pn;
        if (k >= kHfMin && k <= kHfMax) hfSum += pn;
        if (k >= sfmBinStart && k <= kHfMax) {
          const pv = pn + 1e-18;
          logSum += Math.log(pv);
          linSum += pv;
        }
      }
      hfFrameRms[ii] = Math.sqrt(hfSum);
      midHighRms[ii] = Math.sqrt(mhSum);
      frameSfm[ii] = Math.exp(logSum / sfmBinCount) / (linSum / sfmBinCount);
    }
  }

  const frameIndices = new Int32Array(interiorCount);
  for (let i = 0; i < interiorCount; i++) frameIndices[i] = interiorStart + i;
  const sortedIndices = Array.from(frameIndices).sort((a, b) => totalBandEnergy[a] - totalBandEnergy[b]);

  const nQuiet = Math.max(1, Math.floor(interiorCount * 0.2));
  const idx90 = sortedIndices[Math.min(interiorCount - 1, Math.floor(interiorCount * 0.9))];
  const idx15 = sortedIndices[Math.min(interiorCount - 1, Math.floor(interiorCount * 0.15))];

  const eSpeech90 = speechBandEnergy[idx90];
  const eNoise15 = Math.max(1e-12, speechBandEnergy[idx15]);
  const modSnrDb = Math.max(0.0, Math.min(60.0, 10.0 * Math.log10((eSpeech90 + 1e-12) / eNoise15)));

  const hfP25 = percentileFloat(hfFrameRms, 0.25);
  let quietSfmSum = 0.0;
  let quietRmsSum = 0.0;
  for (let qi = 0; qi < nQuiet; qi++) {
    const ri = sortedIndices[qi] - interiorStart;
    quietSfmSum += frameSfm[ri];
    quietRmsSum += midHighRms[ri];
  }
  const quietSfm = quietSfmSum / nQuiet;
  const quietRms = quietRmsSum / nQuiet;

  let totalSpeechRatio = 0.0;
  let upperSfmSum = 0.0;
  const halfIdx = Math.floor(interiorCount * 0.5);
  for (let i = halfIdx; i < interiorCount; i++) {
    const ti = sortedIndices[i];
    totalSpeechRatio += speechBandEnergy[ti] / (totalBandEnergy[ti] + 1e-12);
    upperSfmSum += frameSfm[ti - interiorStart];
  }
  const upperCount = Math.max(1, interiorCount - halfIdx);
  const avgFormantRatio = totalSpeechRatio / upperCount;
  const upperSfm = upperSfmSum / upperCount;
  const speechRms90 = Math.sqrt(eSpeech90 * normScale);

  // Stationary & Sub-Formant Non-Speech Gate: pure unmodulated background hiss, mains hum, HVAC rumble, or thermal floor
  if (
    nonSpeechGate &&
    numFrames >= 10 &&
    acRms < 0.025 &&
    (
      (modSnrDb < 2.2 && avgFormantRatio < 0.52) ||
      (speechRms90 < 0.0018 && (modSnrDb < 4.5 || upperSfm > 0.3)) ||
      avgFormantRatio < 0.08
    )
  ) {
    return {
      pcm: new Float32Array(N),
      estimatedSnrDb: modSnrDb,
      noiseFloorDbfs: 20.0 * Math.log10(Math.max(acRms, 1e-5)),
      suppressionDb: 40.0,
      isSpeechLikely: false,
    };
  }

  // Genuine broadband/colored background noise check in quietest 20% frames (requires >= 300ms = 4800 samples)
  const hasBroadbandNoise =
    N >= 4800 &&
    modSnrDb < cleanBypassSnrDb &&
    quietSfm > 0.24 &&
    quietRms > 0.0065 &&
    (hfP25 > 0.0024 || (N >= 12000 && modSnrDb < 22.0));

  if (!hasBroadbandNoise) {
    const effectiveSnr = !hasHumOrRumble ? Math.max(modSnrDb, 32.0) : Math.max(modSnrDb, 20.0);
    let suppDb = 0.0;
    if (hasHumOrRumble) {
      let postSq = 0.0;
      for (let i = 0; i < N; i++) postSq += work[i] * work[i];
      const postRmsH = Math.sqrt(postSq / N) + 1e-9;
      suppDb = Math.max(0.0, 20.0 * Math.log10(Math.max(rawRms, 1e-9) / postRmsH));
    }
    return {
      pcm: work === pcm ? new Float32Array(pcm) : work,
      estimatedSnrDb: effectiveSnr,
      noiseFloorDbfs: 20.0 * Math.log10(Math.max(acRms * Math.pow(10, -effectiveSnr / 20), 1e-5)),
      suppressionDb: suppDb,
      isSpeechLikely: true,
    };
  }

  // Hybrid quiet-frame + unbiased Rayleigh 25th-percentile minimum-statistics noise PSD (-1/ln(0.75) = 3.476)
  const noisePsd = new Float32Array(NUM_BINS);
  const binScratch = new Float32Array(interiorCount);
  const invQuiet = 1.0 / nQuiet;
  for (let k = 0; k < NUM_BINS; k++) {
    let qSum = 0.0;
    for (let qi = 0; qi < nQuiet; qi++) {
      qSum += allPower[sortedIndices[qi] * NUM_BINS + k];
    }
    const quietMean = qSum * invQuiet;
    for (let ii = 0; ii < interiorCount; ii++) {
      binScratch[ii] = allPower[(interiorStart + ii) * NUM_BINS + k];
    }
    const minStatBin = percentileFloat(binScratch, 0.25) * 3.48;
    noisePsd[k] = Math.max(1e-12, Math.min(quietMean * 1.25, minStatBin));
  }

  const estimatedSnrDb = modSnrDb;
  const strength = Math.max(0.0, Math.min(1.0, (cleanBypassSnrDb - estimatedSnrDb) / 8.0));
  const oversub = 1.0 + 0.85 * strength;
  const gMin = 1.0 - (1.0 - spectralFloor) * strength;
  const ddBeta = 0.92;

  const prevGain = new Float32Array(NUM_BINS).fill(1.0);
  const prevGamma = new Float32Array(NUM_BINS).fill(1.0);
  const rawGain = new Float32Array(NUM_BINS);
  const smoothGain = new Float32Array(NUM_BINS);

  const outOverlap = new Float32Array(paddedLen);
  const invFftScale = 1.0 / STFT_N;
  const fftRe = new Float32Array(STFT_N);
  const fftIm = new Float32Array(STFT_N);

  for (let t = 0; t < numFrames; t++) {
    const base = t * NUM_BINS;
    for (let k = 0; k < NUM_BINS; k++) {
      const gamma = allPower[base + k] / noisePsd[k];
      const instXi = Math.max(gamma - 1.0, 0.0);
      const xi = ddBeta * prevGain[k] * prevGain[k] * prevGamma[k] + (1.0 - ddBeta) * instXi;
      rawGain[k] = Math.max(gMin, xi / (xi + oversub));
      prevGamma[k] = gamma;
    }

    smoothGain[0] = 0.75 * rawGain[0] + 0.25 * rawGain[1];
    for (let k = 1; k < NUM_BINS - 1; k++) {
      smoothGain[k] = 0.2 * rawGain[k - 1] + 0.6 * rawGain[k] + 0.2 * rawGain[k + 1];
    }
    smoothGain[NUM_BINS - 1] = 0.25 * rawGain[NUM_BINS - 2] + 0.75 * rawGain[NUM_BINS - 1];
    prevGain.set(smoothGain);

    fftRe[0] = allReal[base] * smoothGain[0];
    fftIm[0] = 0.0;
    fftRe[256] = allReal[base + 256] * smoothGain[256];
    fftIm[256] = 0.0;

    for (let k = 1; k < 256; k++) {
      const g = smoothGain[k];
      const r = allReal[base + k] * g;
      const im = allImag[base + k] * g;
      fftRe[k] = r;
      fftIm[k] = -im;
      fftRe[STFT_N - k] = r;
      fftIm[STFT_N - k] = im;
    }

    fft512(fftRe, fftIm);

    const outStart = t * STFT_HOP;
    for (let n = 0; n < STFT_N; n++) {
      outOverlap[outStart + n] += fftRe[n] * invFftScale * SQRT_HANN_512[n];
    }
  }

  const pad = STFT_HOP;
  const enhanced = outOverlap.slice(pad, pad + N);

  let postSumSq = 0.0;
  for (let i = 0; i < N; i++) postSumSq += enhanced[i] * enhanced[i];
  const postRms = Math.sqrt(postSumSq / N);

  if (adaptiveGain && postRms > 0.002 && postRms < 0.035 && estimatedSnrDb >= 5.0) {
    const targetGain = Math.min(2.4, 0.045 / postRms);
    for (let i = 0; i < N; i++) {
      const scaled = enhanced[i] * targetGain;
      enhanced[i] = Math.abs(scaled) > 0.9 ? Math.tanh(scaled) : scaled;
    }
  } else {
    for (let i = 0; i < N; i++) {
      const v = enhanced[i];
      if (v > 1.0) enhanced[i] = 1.0;
      else if (v < -1.0) enhanced[i] = -1.0;
    }
  }

  const noiseFloorRms = acRms * Math.pow(10, -estimatedSnrDb / 20);
  const suppressionDb = Math.abs(20.0 * Math.log10(Math.max(gMin, 1e-3)));

  return {
    pcm: enhanced,
    estimatedSnrDb,
    noiseFloorDbfs: 20.0 * Math.log10(Math.max(noiseFloorRms, 1e-5)),
    suppressionDb,
    isSpeechLikely: true,
  };
}

/**
 * Convenience wrapper returning enhanced 16 kHz mono Float32Array PCM.
 */
export function denoisePcm16k(pcm: Float32Array, options: DenoiseOptions = {}): Float32Array {
  return enhanceSpeechWithTelemetry(pcm, options).pcm;
}
