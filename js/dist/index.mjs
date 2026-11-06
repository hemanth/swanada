// Auto-generated ESM bundle for swanada v1.0.0
/**
 * Zero-dependency RIFF/WAVE parser and encoder for Node.js and Browser runtimes.
 */

                                               

/**
 * Parses binary WAV data into mono Float32Array PCM and audio metadata.
 * Supports 16-bit signed PCM and 32-bit IEEE float, mono and multi-channel.
 */
function parseWav(buffer                          )               {
  const byteOffset = 'byteOffset' in buffer ? buffer.byteOffset : 0;
  const byteLength = buffer.byteLength;
  const arrayBuffer = 'buffer' in buffer ? buffer.buffer : buffer;
  const view = new DataView(arrayBuffer, byteOffset, byteLength);

  if (view.byteLength < 44) {
    throw new Error('Invalid WAV file: buffer is smaller than minimum WAV header (44 bytes)');
  }

  // Verify RIFF and WAVE magic headers
  const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
  if (riff !== 'RIFF' || wave !== 'WAVE') {
    throw new Error(`Invalid WAV file: expected RIFF/WAVE header, got ${riff}/${wave}`);
  }

  let offset = 12;
  let audioFormat = 1; // 1 = PCM, 3 = IEEE Float
  let numChannels = 1;
  let sampleRate = 16000;
  let bitsPerSample = 16;
  let dataOffset = 0;
  let dataLength = 0;

  while (offset + 8 <= view.byteLength) {
    const chunkId = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    );
    const chunkSize = view.getUint32(offset + 4, true);

    if (chunkId === 'fmt ') {
      if (offset + 8 + 16 > view.byteLength) {
        throw new Error('Corrupt WAV file: truncated fmt chunk');
      }
      audioFormat = view.getUint16(offset + 8, true);
      numChannels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bitsPerSample = view.getUint16(offset + 22, true);
    } else if (chunkId === 'data') {
      dataOffset = offset + 8;
      dataLength = Math.min(chunkSize, view.byteLength - dataOffset);
      break;
    }
    // Chunks are word-aligned (2-byte padding if odd length)
    offset += 8 + chunkSize + (chunkSize % 2);
  }

  if (dataOffset === 0) {
    throw new Error('Corrupt WAV file: data chunk not found');
  }

  let pcm              ;

  if (audioFormat === 1 && bitsPerSample === 16) {
    const bytesPerFrame = 2 * numChannels;
    const numSamples = Math.floor(dataLength / bytesPerFrame);
    pcm = new Float32Array(numSamples);

    for (let i = 0; i < numSamples; i++) {
      let sum = 0;
      for (let c = 0; c < numChannels; c++) {
        const idx = dataOffset + (i * numChannels + c) * 2;
        sum += view.getInt16(idx, true) / 32768.0;
      }
      pcm[i] = sum / numChannels;
    }
  } else if (audioFormat === 3 && bitsPerSample === 32) {
    const bytesPerFrame = 4 * numChannels;
    const numSamples = Math.floor(dataLength / bytesPerFrame);
    pcm = new Float32Array(numSamples);

    for (let i = 0; i < numSamples; i++) {
      let sum = 0;
      for (let c = 0; c < numChannels; c++) {
        const idx = dataOffset + (i * numChannels + c) * 4;
        sum += view.getFloat32(idx, true);
      }
      pcm[i] = sum / numChannels;
    }
  } else if (audioFormat === 1 && bitsPerSample === 8) {
    const bytesPerFrame = 1 * numChannels;
    const numSamples = Math.floor(dataLength / bytesPerFrame);
    pcm = new Float32Array(numSamples);

    for (let i = 0; i < numSamples; i++) {
      let sum = 0;
      for (let c = 0; c < numChannels; c++) {
        const idx = dataOffset + i * numChannels + c;
        // 8-bit PCM is unsigned [0, 255] centered at 128
        sum += (view.getUint8(idx) - 128) / 128.0;
      }
      pcm[i] = sum / numChannels;
    }
  } else {
    throw new Error(`Unsupported WAV encoding: format=${audioFormat}, bitsPerSample=${bitsPerSample}`);
  }

  const durationSec = pcm.length / sampleRate;
  return { pcm, sampleRate, numChannels, durationSec };
}

/**
 * Encodes a mono Float32Array PCM buffer into a standard 16-bit PCM RIFF WAV buffer.
 */
function encodeWav(pcm              , sampleRate         = 16000)             {
  const numSamples = pcm.length;
  const bytesPerSample = 2;
  const dataByteLength = numSamples * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataByteLength);
  const view = new DataView(buffer);

  // 'RIFF' chunk descriptor
  view.setUint8(0, 0x52); // R
  view.setUint8(1, 0x49); // I
  view.setUint8(2, 0x46); // F
  view.setUint8(3, 0x46); // F
  view.setUint32(4, 36 + dataByteLength, true); // chunkSize
  view.setUint8(8, 0x57);  // W
  view.setUint8(9, 0x41);  // A
  view.setUint8(10, 0x56); // V
  view.setUint8(11, 0x45); // E

  // 'fmt ' sub-chunk
  view.setUint8(12, 0x66); // f
  view.setUint8(13, 0x6d); // m
  view.setUint8(14, 0x74); // t
  view.setUint8(15, 0x20); // ' '
  view.setUint32(16, 16, true); // subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true);  // audioFormat (1 = PCM)
  view.setUint16(22, 1, true);  // numChannels (1 = mono)
  view.setUint32(24, sampleRate, true); // sampleRate
  view.setUint32(28, sampleRate * bytesPerSample, true); // byteRate
  view.setUint16(32, bytesPerSample, true); // blockAlign
  view.setUint16(34, 16, true); // bitsPerSample

  // 'data' sub-chunk
  view.setUint8(36, 0x64); // d
  view.setUint8(37, 0x61); // a
  view.setUint8(38, 0x74); // t
  view.setUint8(39, 0x61); // a
  view.setUint32(40, dataByteLength, true);

  // Write 16-bit integer samples clamped to [-32768, 32767]
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1.0, Math.min(1.0, pcm[i]));
    const intVal = s < 0 ? Math.floor(s * 32768.0) : Math.min(32767, Math.floor(s * 32767.0));
    view.setInt16(offset, intVal, true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

/**
 * Bandlimited anti-aliasing audio resampler and browser Web Audio ingestion helpers.
 */



/**
 * Resamples a mono Float32Array PCM buffer to the target sample rate (default: 16000 Hz).
 * When downsampling (e.g. 44.1k or 48k to 16k), applies a 25-tap Hamming-windowed
 * sinc low-pass anti-aliasing filter to prevent Nyquist foldover distortion.
 */
function resamplePcm(
  input              ,
  srcSr        ,
  targetSr         = 16000
)               {
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
async function decodeAndResampleBrowser(
  arrayBuffer             ,
  targetSr         = 16000
)                        {
  const hasAudioContext = typeof window !== 'undefined' &&
    (typeof (window       ).AudioContext !== 'undefined' || typeof (window       ).webkitAudioContext !== 'undefined');
  const hasOfflineAudioContext = typeof window !== 'undefined' &&
    (typeof (window       ).OfflineAudioContext !== 'undefined' || typeof (window       ).webkitOfflineAudioContext !== 'undefined');

  if (hasAudioContext && hasOfflineAudioContext) {
    const AudioContextClass = (window       ).AudioContext || (window       ).webkitAudioContext;
    const OfflineAudioContextClass = (window       ).OfflineAudioContext || (window       ).webkitOfflineAudioContext;

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

                                                       

const N_FFT = 512;
const WIN_LENGTH = 400;
const HOP_LENGTH = 160;
const N_MELS = 80;
const SAMPLE_RATE = 16000;
const PREEMPH_COEFF = 0.97;
const LOG_EPSILON = 5.960464477539063e-08; // 2^-24
const CMVN_FLOOR = 1e-05;

/**
 * Converts frequency in Hertz to Slaney mel scale.
 */
function hzToMel(f        )         {
  const fSp = 200.0 / 3;
  if (f < 1000.0) return f / fSp;
  const minLogMel = 15.0; // 1000.0 / fSp
  const logstep = Math.log(6.4) / 27.0;
  return minLogMel + Math.log(f / 1000.0) / logstep;
}

/**
 * Converts Slaney mel scale to frequency in Hertz.
 */
function melToHz(m        )         {
  const fSp = 200.0 / 3;
  if (m < 15.0) return m * fSp;
  const minLogMel = 15.0;
  const logstep = Math.log(6.4) / 27.0;
  return 1000.0 * Math.exp(logstep * (m - minLogMel));
}

/**
 * Constructs the 80x257 Slaney area-normalized Mel filterbank matrix.
 */
function createMelFilterbank(
  sr         = SAMPLE_RATE,
  nFft         = N_FFT,
  nMels         = N_MELS,
  fmin         = 0.0,
  fmax         = 8000.0
)               {
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
function createPaddedHannWindow(
  winLength         = WIN_LENGTH,
  nFft         = N_FFT
)               {
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
function fft512(real              , imag              )       {
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
const STATIC_WINDOW = createPaddedHannWindow(WIN_LENGTH, N_FFT);
const STATIC_MEL_FB = createMelFilterbank(SAMPLE_RATE, N_FFT, N_MELS);

/**
 * Extracts 80-channel log-mel filterbank features with utterance-level CMVN.
 * Output tensor shape: [1, 80, numFrames], matching NeMo FilterbankFeatures / preprocessor.onnx.
 *
 * @param pcm Float32Array mono audio at 16,000 Hz normalized to [-1.0, 1.0]
 * @param sr Sample rate (must be 16000)
 */
function extractLogMelFeatures(
  pcm              ,
  sr         = SAMPLE_RATE
)                       {
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

/**
 * Multi-Stage Real-Time ASR Background Noise Cancellation & Speech Enhancement Layer.
 *
 * Zero-dependency 16 kHz DSP pipeline:
 * 1. DC Offset Removal + 80 Hz 2nd-Order Butterworth High-Pass Filter (wind, desk thump, HVAC rumble)
 * 2. 50 Hz & 60 Hz High-Q Biquad Notch Cascade (India 50 Hz & Americas 60 Hz mains hum rejection)
 * 3. SNR-Adaptive Ephraim-Malah Decision-Directed Spectral Wiener Filter (512-pt sqrt-Hann exact NOLA OLA)
 * 4. Formant-Band Speech Presence Ratio + Stationary Noise Gate & Peak Safety Limiter
 */



                                 
                                           
                      
                                                       
                      
                                                                                   
                     
                                                                               
                            
                                                                       
                            
                                                                                          
                         
                                                                                                       
                          
                                                                                           
                         
 

                                   
                    
                         
                         
                        
                          
 

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

                        
             
             
             
             
             
 

function designHighPassBiquad(fc        , sr        , q         = Math.SQRT1_2)               {
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

function designNotchBiquad(f0        , sr        , q         = 22.0)               {
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

function applyBiquadInPlace(buf              , c              )       {
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

                      
                        
                        
                         
                    
                    
 

function computeStft(signal              )             {
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

function percentileFloat(arr              , q        )         {
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
function enhanceSpeechWithTelemetry(
  pcm              ,
  options                 = {}
)                   {
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
  const lfP30 = percentileFloat(lfFrameRms, 0.3);
  const lfMean = lfMeanSum / interiorCount;
  const hasHumOrRumble = hasDcOffset || (lfP30 > 0.0075 && lfMean / (acRms + 1e-9) > 0.16);

  let work              ;
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
  const sfmP30 = percentileFloat(frameSfm, 0.3);
  const quietRmsP15 = percentileFloat(midHighRms, 0.15);

  let totalSpeechRatio = 0.0;
  const halfIdx = Math.floor(interiorCount * 0.5);
  for (let i = halfIdx; i < interiorCount; i++) {
    const ti = sortedIndices[i];
    totalSpeechRatio += speechBandEnergy[ti] / (totalBandEnergy[ti] + 1e-12);
  }
  const avgFormantRatio = totalSpeechRatio / Math.max(1, interiorCount - halfIdx);

  // Stationary Non-Speech Gate: pure unmodulated background hiss/buzz
  if (
    nonSpeechGate &&
    numFrames >= 10 &&
    modSnrDb < 2.2 &&
    acRms < 0.025 &&
    avgFormantRatio < 0.52
  ) {
    return {
      pcm: new Float32Array(N),
      estimatedSnrDb: modSnrDb,
      noiseFloorDbfs: 20.0 * Math.log10(Math.max(acRms, 1e-5)),
      suppressionDb: 40.0,
      isSpeechLikely: false,
    };
  }

  // Genuine broadband/colored background noise check (requires >= 300ms = 4800 samples)
  const hasBroadbandNoise =
    N >= 4800 &&
    modSnrDb < cleanBypassSnrDb &&
    ((hfP25 > 0.0024 && sfmP30 > 0.032) ||
      (N >= 12000 && modSnrDb < 22.0 && quietRmsP15 > 0.0045 && sfmP30 > 0.022));

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
function denoisePcm16k(pcm              , options                 = {})               {
  return enhanceSpeechWithTelemetry(pcm, options).pcm;
}

/**
 * SwanadaAudioCapture: Browser Microphone Ingestion Controller with AudioWorklet & ScriptProcessorNode fallback.
 */

                                     
                                                                        
                                                                            
                                                                                               
                                                                   
                                                                                     
                                                                                                
                                                                                         
                                                                             
                                                                                  
                                                                            
 

                                    
                           
                     
              
                    
                   
                     
                      
 

                                 
              
                  
                     
                      
 

                                                                              

class SwanadaAudioCapture {
          config                              ;
          audioCtx      = null;
          mediaStream      = null;
          sourceNode      = null;
          workletNode      = null;
          scriptProcessorNode      = null;
          dummyDestination      = null;
          state                                                               = 'inactive';
          listeners                                        = new Map();
          inlineBlobUrl                = null;

  constructor(config                     = {}) {
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

  static isSupported()          {
    return typeof window !== 'undefined' &&
      Boolean(navigator?.mediaDevices?.getUserMedia) &&
      Boolean((window       ).AudioContext || (window       ).webkitAudioContext);
  }

  static isWorkletSupported()          {
    return typeof window !== 'undefined' &&
      Boolean((window       ).AudioContext && 'audioWorklet' in (window       ).AudioContext.prototype);
  }

                                                                           
                                                                          
                                                             
                                                                    
  on(event                   , callback          )       {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event) .add(callback);
    return this;
  }

  off(event                   , callback          )       {
    this.listeners.get(event)?.delete(callback);
    return this;
  }

          emit(event                   , arg     )       {
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

          setState(newState                                                              )       {
    this.state = newState;
    this.emit('statechange', newState);
  }

  getState()         {
    return this.state;
  }

  async start()                {
    if (this.state === 'recording' || this.state === 'starting') return;
    this.setState('starting');

    try {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        throw new Error('navigator.mediaDevices.getUserMedia is not supported in this environment.');
      }

      // 1. Acquire Microphone MediaStream
      const audioConstraints      = {
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
      const AudioCtxClass = (window       ).AudioContext || (window       ).webkitAudioContext;
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
    } catch (err     ) {
      this.setState('inactive');
      const errorObj = err instanceof Error ? err : new Error(String(err));
      this.emit('error', errorObj);
      await this.stop();
      throw errorObj;
    }
  }

          async initWorklet()                {
    if (!this.audioCtx || !this.sourceNode || !this.dummyDestination) return;

    try {
      await this.audioCtx.audioWorklet.addModule(this.config.workletUrl);
    } catch (_loadErr) {
      // Fallback: load inline embedded blob
      this.inlineBlobUrl = this.createInlineWorkletBlobUrl();
      await this.audioCtx.audioWorklet.addModule(this.inlineBlobUrl);
    }

    const WorkletNodeClass = (window       ).AudioWorkletNode;
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

    this.workletNode.port.onmessage = (ev              ) => {
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

          initScriptProcessor()       {
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

    this.scriptProcessorNode.onaudioprocess = (e     ) => {
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

  recycleBuffer(buffer             )       {
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'recycle', buffer }, [buffer]);
    }
  }

  pause()       {
    if (this.state !== 'recording') return;
    this.setState('paused');
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'pause' });
    }
  }

  resume()       {
    if (this.state !== 'paused') return;
    this.setState('recording');
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'resume' });
    }
  }

  async flush()                {
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'flush' });
    }
  }

  async stop()                {
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

          createInlineWorkletBlobUrl()         {
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

/**
 * Multilingual Indic and Latin text normalizer for ASR outputs.
 * Implements NFC/NFD Combining Mark Deduplication + Brahmic Phonotactic Repair + Whitespace collapse.
 */

// Primary NFC dependent vowel signs (matras) across 9 Brahmic blocks (excluding anusvara/visarga/nukta/vedic tone/length marks)
const BRAHMIC_PRIMARY_MATRA_CLASS =
  '\\u093E-\\u094C\\u094E-\\u094F\\u0962-\\u0963' +
  '\\u09BE-\\u09C4\\u09C7-\\u09C8\\u09CB-\\u09CC\\u09E2-\\u09E3' +
  '\\u0A3E-\\u0A42\\u0A47-\\u0A48\\u0A4B-\\u0A4C' +
  '\\u0ABE-\\u0AC5\\u0AC7-\\u0AC9\\u0ACB-\\u0ACC\\u0AE2-\\u0AE3' +
  '\\u0B3E-\\u0B44\\u0B47-\\u0B48\\u0B4B-\\u0B4C\\u0B62-\\u0B63' +
  '\\u0BBE-\\u0BC2\\u0BC6-\\u0BC8\\u0BCA-\\u0BCC' +
  '\\u0C3E-\\u0C44\\u0C46-\\u0C48\\u0C4A-\\u0C4C\\u0C62-\\u0C63' +
  '\\u0CBE-\\u0CC4\\u0CC6-\\u0CC8\\u0CCA-\\u0CCC\\u0CE2-\\u0CE3' +
  '\\u0D3E-\\u0D44\\u0D46-\\u0D48\\u0D4A-\\u0D4C\\u0D62-\\u0D63';

// Virama / Halant signs across all 9 Brahmic blocks
const BRAHMIC_VIRAMA_CLASS = '\\u094D\\u09CD\\u0A4D\\u0ACD\\u0B4D\\u0BCD\\u0C4D\\u0CCD\\u0D4D';

// Independent vowels across all 9 Brahmic blocks
const BRAHMIC_INDEP_VOWEL_CLASS =
  '\\u0904-\\u0914\\u0960-\\u0961' +
  '\\u0985-\\u0994\\u09E0-\\u09E1' +
  '\\u0A05-\\u0A14' +
  '\\u0A85-\\u0A94\\u0AE0-\\u0AE1' +
  '\\u0B05-\\u0B14\\u0B60-\\u0B61' +
  '\\u0B85-\\u0B94' +
  '\\u0C05-\\u0C14\\u0C60-\\u0C61' +
  '\\u0C85-\\u0C94\\u0CE0-\\u0CE1' +
  '\\u0D05-\\u0D14\\u0D60-\\u0D61';

const RE_COLLIDING_MATRAS = new RegExp(`([${BRAHMIC_PRIMARY_MATRA_CLASS}])[${BRAHMIC_PRIMARY_MATRA_CLASS}]+`, 'gu');
const RE_MATRA_THEN_VIRAMA = new RegExp(`([${BRAHMIC_PRIMARY_MATRA_CLASS}])[${BRAHMIC_VIRAMA_CLASS}]+`, 'gu');
const RE_INDEP_VOWEL_ILLEGAL_MARK = new RegExp(
  `([${BRAHMIC_INDEP_VOWEL_CLASS}])[${BRAHMIC_PRIMARY_MATRA_CLASS}${BRAHMIC_VIRAMA_CLASS}]+`,
  'gu'
);

/**
 * Deduplicate consecutive identical combining marks (Unicode category M: Mn, Mc, Me).
 * Prevents the CTC greedy artifact where prolonged vowels produce duplicated
 * matras (e.g. [matra, blank, matra] -> 'सुु' -> 'सु').
 * Consonants and letters (e.g. double 'l' in "hello", or geminates in Indic scripts) are preserved.
 */
function dedupMarks(text        )         {
  return text.replace(/(\p{M})\1+/gu, '$1');
}

/**
 * Repairs orthographically impossible CTC boundary collisions on NFC-composed Brahmic text:
 * 1. Collapses colliding primary dependent vowel signs on a single consonant (e.g. 'हीि' -> 'ही').
 * 2. Strips illegal virama/halant immediately following a dependent vowel sign.
 * 3. Strips illegal dependent vowel sign or virama immediately following an independent vowel (e.g. 'ಇ್' -> 'ಇ').
 * Preserves all valid conjuncts (C + virama + C), geminates, and vowel + anusvara/visarga/chandrabindu sequences.
 */
function repairBrahmicOrthography(nfcText        )         {
  return nfcText
    .replace(RE_COLLIDING_MATRAS, '$1')
    .replace(RE_MATRA_THEN_VIRAMA, '$1')
    .replace(RE_INDEP_VOWEL_ILLEGAL_MARK, '$1');
}

                                   
                       
                         
                       
 

/**
 * Normalizes ASR output text across all 12 Indic languages and Latin/IAST.
 */
function normalizeIndicText(
  rawText        ,
  options                   
)         {
  const shouldDedup = options?.dedupMarks !== false;
  const shouldNFC = options?.normalizeNFC !== false;
  const spaceMarker = options?.spaceMarker ?? '\u2581';

  let text = rawText;

  // 1. Replace SentencePiece space marker with standard ASCII space
  if (spaceMarker) {
    text = text.replaceAll(spaceMarker, ' ');
  }
  text = text.replace(/[\u2581\u2582\u2583▁]/g, ' ');

  // 2. Deduplicate combining marks and repair Brahmic matra boundary collisions
  if (shouldDedup) {
    text = text.normalize('NFC');
    text = dedupMarks(text);
    text = repairBrahmicOrthography(text);
    text = text.normalize('NFD');
    text = dedupMarks(text);
  }

  // 3. Recompose to canonical NFC
  if (shouldNFC) {
    text = text.normalize('NFC');
    if (shouldDedup) {
      text = repairBrahmicOrthography(text);
    }
  }

  // 4. Collapse whitespace and trim
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Stitches an array of token strings into normalized text.
 */
function assembleText(
  tokens          ,
  options                   
)         {
  return normalizeIndicText(tokens.join(''), options);
}

/**
 * Linear-time O(T * V) Greedy CTC Decoder.
 * Zero external dependencies. Browser & Node.js compatible.
 */


                                                        

                                                            
                                            
                                               
                                                                            
 

                                  
               
                   
                     
 

function isSpecialToken(token        )          {
  if (!token) return false;
  return (token.startsWith('<') && token.endsWith('>')) ||
         (token.startsWith('[') && token.endsWith(']'));
}

/**
 * Linear-time greedy CTC decoding over logits or log-probabilities.
 *
 * @param logits 1D Float32Array or number[] of shape [timeSteps * numClasses]
 * @param dims [timeSteps, numClasses] or [batch, timeSteps, numClasses]
 * @param vocab Array or map of token strings
 * @param options Decoding configuration
 */
function decodeCTC(
  logits                         ,
  dims          ,
  vocab                                   ,
  options                   
)                  {
  const timeSteps = dims.length === 3 ? dims[1] : (dims.length === 2 ? dims[0] : 0);
  const numClasses = dims.length === 3 ? dims[2] : (dims.length === 2 ? dims[1] : 0);

  if (timeSteps === 0 || numClasses === 0) {
    return { text: '', tokens: [], tokenIds: [] };
  }

  const blankId = options?.blankId ?? 0;
  const collapseRepeats = options?.collapseRepeats !== false;
  const skipSpecial = options?.skipSpecialTokens !== false;

  let lastTokenId = blankId;
  const tokenIds           = [];
  const tokens           = [];

  for (let t = 0; t < timeSteps; t++) {
    const offset = t * numClasses;
    let maxVal = -Infinity;
    let argmax = 0;

    for (let c = 0; c < numClasses; c++) {
      const val = logits[offset + c];
      if (val > maxVal) {
        maxVal = val;
        argmax = c;
      }
    }

    if (argmax === blankId) {
      lastTokenId = blankId;
      continue;
    }

    if (collapseRepeats && argmax === lastTokenId) {
      continue;
    }

    lastTokenId = argmax;
    tokenIds.push(argmax);

    const tok = Array.isArray(vocab) ? vocab[argmax] : (vocab                          )[argmax];
    if (tok !== undefined) {
      if (skipSpecial && isSpecialToken(tok)) {
        continue;
      }
      tokens.push(tok);
    }
  }

  const text = normalizeIndicText(tokens.join(''), options);
  return { text, tokens, tokenIds };
}

/**
 * Decode from pre-computed argmax token IDs.
 */
function decodeCTCTokens(
  tokenIds          ,
  vocab                                   ,
  options                   
)                  {
  const blankId = options?.blankId ?? 0;
  const collapseRepeats = options?.collapseRepeats !== false;
  const skipSpecial = options?.skipSpecialTokens !== false;

  let lastTokenId = blankId;
  const emittedIds           = [];
  const tokens           = [];

  for (const id of tokenIds) {
    if (id === blankId) {
      lastTokenId = blankId;
      continue;
    }

    if (collapseRepeats && id === lastTokenId) {
      continue;
    }

    lastTokenId = id;
    emittedIds.push(id);

    const tok = Array.isArray(vocab) ? vocab[id] : (vocab                          )[id];
    if (tok !== undefined) {
      if (skipSpecial && isSpecialToken(tok)) {
        continue;
      }
      tokens.push(tok);
    }
  }

  const text = normalizeIndicText(tokens.join(''), options);
  return { text, tokens, tokenIds: emittedIds };
}

/**
 * Stateful CTC Greedy Decoder for Streaming ASR across chunk boundaries.
 * Preserves lastTokenId across chunks to prevent duplicate character emissions at boundaries.
 */
class CTCGreedyDecoder {
          vocab                                   ;
          options                  ;
          blankId        ;
          lastTokenId        ;

  constructor(
    vocab                                   ,
    options                   
  ) {
    this.vocab = vocab;
    this.options = options ?? {};
    this.blankId = this.options.blankId ?? 0;
    this.lastTokenId = this.blankId;
  }

  reset()       {
    this.lastTokenId = this.blankId;
  }

  decodeChunk(logits                         , dims          )                  {
    const timeSteps = dims.length === 3 ? dims[1] : (dims.length === 2 ? dims[0] : 0);
    const numClasses = dims.length === 3 ? dims[2] : (dims.length === 2 ? dims[1] : 0);

    if (timeSteps === 0 || numClasses === 0) {
      return { text: '', tokens: [], tokenIds: [] };
    }

    const collapseRepeats = this.options.collapseRepeats !== false;
    const skipSpecial = this.options.skipSpecialTokens !== false;

    const tokenIds           = [];
    const tokens           = [];

    for (let t = 0; t < timeSteps; t++) {
      const offset = t * numClasses;
      let maxVal = -Infinity;
      let argmax = 0;

      for (let c = 0; c < numClasses; c++) {
        const val = logits[offset + c];
        if (val > maxVal) {
          maxVal = val;
          argmax = c;
        }
      }

      if (argmax === this.blankId) {
        this.lastTokenId = this.blankId;
        continue;
      }

      if (collapseRepeats && argmax === this.lastTokenId) {
        continue;
      }

      this.lastTokenId = argmax;
      tokenIds.push(argmax);

      const tok = Array.isArray(this.vocab) ? this.vocab[argmax] : (this.vocab                          )[argmax];
      if (tok !== undefined) {
        if (skipSpecial && isSpecialToken(tok)) {
          continue;
        }
        tokens.push(tok);
      }
    }

    const text = normalizeIndicText(tokens.join(''), this.options);
    return { text, tokens, tokenIds };
  }

  decode(logits                         , dims          )                  {
    this.reset();
    return this.decodeChunk(logits, dims);
  }
}

/**
 * StreamingCTCDecoder: Stabilized Prefix-Locking Streaming CTC Decoder.
 * Decouples committed prefix from volatile suffix to guarantee 0.00% character churn
 * on confirmed text and prevent boundary token flicker in real-time UI display.
 */


                                                        

                                      
               
                    
                   
                   
                   
                     
                      
              
 

                                                                   
                                             
                                                                                 
                                                                                   
                                                    
                                                                                        
 

class StreamingCTCDecoder {
          vocab                                   ;
          options                         ;
          blankId        ;
          stabilityThreshold        ;
          trailTokens        ;
          requireStabilityOnWordBoundary         ;

          committedTokens           = [];
          committedText         = '';
          lastHypTokens           = [];
          tokenStabilityCounts           = [];

  constructor(
    vocab                                   ,
    options                          
  ) {
    this.vocab = vocab;
    this.options = options ?? {};
    this.blankId = this.options.blankId ?? 0;
    this.stabilityThreshold = this.options.stabilityThreshold ?? 2;
    this.trailTokens = this.options.trailTokens ?? 3;
    this.requireStabilityOnWordBoundary = this.options.requireStabilityOnWordBoundary ?? false;
  }

  reset()       {
    this.committedTokens = [];
    this.committedText = '';
    this.lastHypTokens = [];
    this.tokenStabilityCounts = [];
  }

  getCommittedText()         {
    return this.committedText;
  }

  getCommittedTokens()           {
    return [...this.committedTokens];
  }

  /**
   * Decodes a frame argmax token sequence and applies prefix locking.
   *
   * @param rawTokens Array of decoded subword/character tokens
   * @param isStreamEnd True if audio stream has ended (flushes all tokens to committed)
   * @param durationMs Processed audio duration in milliseconds
   * @param inferenceMs Cumulative or chunk inference duration in milliseconds
   */
  update(
    rawTokens          ,
    isStreamEnd          = false,
    durationMs         = 0,
    inferenceMs         = 0,
    allowCommit          = true
  )                      {
    if (isStreamEnd) {
      let allTokens          ;
      if (rawTokens.length > this.committedTokens.length) {
        allTokens = [...this.committedTokens, ...rawTokens.slice(this.committedTokens.length)];
      } else {
        allTokens = this.committedTokens.length > 0 ? [...this.committedTokens] : [...rawTokens];
      }
      const fullText = normalizeIndicText(allTokens.join(''), this.options);
      this.reset();
      const rtf = durationMs > 0 ? inferenceMs / durationMs : 0;
      return {
        text: fullText,
        committed: fullText,
        volatile: '',
        isFinal: true,
        tokens: allTokens,
        durationMs,
        inferenceMs,
        rtf,
      };
    }

    // Determine common prefix length between last hypothesis and current rawTokens
    let commonPrefixLen = 0;
    const minLen = Math.min(this.lastHypTokens.length, rawTokens.length);
    while (
      commonPrefixLen < minLen &&
      this.lastHypTokens[commonPrefixLen] === rawTokens[commonPrefixLen]
    ) {
      commonPrefixLen++;
    }

    // Update stability counts for each token in current hypothesis
    const newStability           = [];
    for (let i = 0; i < rawTokens.length; i++) {
      if (i < commonPrefixLen) {
        newStability[i] = (this.tokenStabilityCounts[i] || 0) + 1;
      } else {
        newStability[i] = 1;
      }
    }
    this.tokenStabilityCounts = newStability;

    // Tokens beyond already committed and before the trailing guard zone are lockable
    const lockableLimit = allowCommit ? Math.max(0, rawTokens.length - this.trailTokens) : 0;
    const alreadyCommitted = this.committedTokens.length;

    for (let i = alreadyCommitted; i < lockableLimit; i++) {
      // Check if a space / word boundary appears ahead in the rawTokens
      const isWordBoundaryAhead = rawTokens.slice(i + 1).some(
        (tok) => tok.startsWith('\u2581') || tok.startsWith('▁')
      );
      const count = this.tokenStabilityCounts[i] || 0;
      const isStable = count >= this.stabilityThreshold;
      const boundaryAllowed = isWordBoundaryAhead && (!this.requireStabilityOnWordBoundary || count >= 2);

      if (boundaryAllowed || isStable) {
        this.committedTokens.push(rawTokens[i]);
      } else {
        break;
      }
    }

    this.lastHypTokens = [...rawTokens];

    const committedStr = normalizeIndicText(this.committedTokens.join(''), this.options);
    this.committedText = committedStr;

    const volatileTokens = rawTokens.slice(this.committedTokens.length);
    const volatileStr = normalizeIndicText(volatileTokens.join(''), this.options);

    const fullText = committedStr && volatileStr
      ? `${committedStr} ${volatileStr}`.trim()
      : (committedStr || volatileStr);

    const rtf = durationMs > 0 ? inferenceMs / durationMs : 0;

    return {
      text: fullText,
      committed: committedStr,
      volatile: volatileStr,
      isFinal: false,
      tokens: rawTokens,
      durationMs,
      inferenceMs,
      rtf,
    };
  }
}

/**
 * Dual-tier model caching (CacheStorage + IndexedDB) with protobuf validation
 * and streaming download progress reporting.
 */

                                                     

const CACHE_STORAGE_NAME = 'swanada-onnx-v1.0.0';
const IDB_DATABASE_NAME = 'swanada-onnx-idb-v1';
const IDB_STORE_NAME = 'models';

/**
 * Validates that binary buffer is a valid serialized ONNX ModelProto.
 * Field 1 of ONNX ModelProto is ir_version (varint tag 0x08).
 */
function isValidOnnxBuffer(buf            , minBytes         = 50_000)          {
  if (!buf || buf.byteLength < minBytes) {
    return false;
  }
  return buf[0] === 0x08;
}

/**
 * Retrieves buffer from CacheStorage if available.
 */
async function getFromCacheStorage(cacheName        , url        )                             {
  if (typeof caches === 'undefined') return null;
  try {
    const cache = await caches.open(cacheName);
    const response = await cache.match(url);
    if (response && response.ok) {
      const buffer = await response.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      if (isValidOnnxBuffer(bytes)) {
        return bytes;
      }
    }
  } catch {
    // CacheStorage not accessible in current context
  }
  return null;
}

/**
 * Stores buffer into CacheStorage.
 */
async function putToCacheStorage(cacheName        , url        , data            )                {
  if (typeof caches === 'undefined') return;
  try {
    const cache = await caches.open(cacheName);
    const response = new Response(data, {
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    await cache.put(url, response);
  } catch {
    // Non-critical cache write failure
  }
}

/**
 * Retrieves buffer from IndexedDB fallback if available.
 */
async function getFromIndexedDB(url        )                             {
  if (typeof indexedDB === 'undefined') return null;
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_DATABASE_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(IDB_STORE_NAME);
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(IDB_STORE_NAME, 'readonly');
        const store = tx.objectStore(IDB_STORE_NAME);
        const getReq = store.get(url);
        getReq.onsuccess = () => {
          const res = getReq.result;
          if (res instanceof Uint8Array && isValidOnnxBuffer(res)) {
            resolve(res);
          } else {
            resolve(null);
          }
        };
        getReq.onerror = () => resolve(null);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Stores buffer into IndexedDB fallback.
 */
async function putToIndexedDB(url        , data            )                {
  if (typeof indexedDB === 'undefined') return;
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_DATABASE_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(IDB_STORE_NAME);
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
        const store = tx.objectStore(IDB_STORE_NAME);
        store.put(data, url);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      };
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Universal model asset loader.
 * Checks CacheStorage -> IndexedDB -> HTTP fetch (with streaming progress callback).
 */
async function loadModelAsset(
  urlOrPath        ,
  cacheName         = CACHE_STORAGE_NAME,
  onProgress                                  
)                      {
  // 1. Check CacheStorage
  const cached = await getFromCacheStorage(cacheName, urlOrPath);
  if (cached) {
    onProgress?.({
      phase: 'cache',
      loadedBytes: cached.byteLength,
      totalBytes: cached.byteLength,
      pct: 100,
      fromCache: true,
    });
    return cached;
  }

  // 2. Check IndexedDB
  const idbCached = await getFromIndexedDB(urlOrPath);
  if (idbCached) {
    onProgress?.({
      phase: 'cache',
      loadedBytes: idbCached.byteLength,
      totalBytes: idbCached.byteLength,
      pct: 100,
      fromCache: true,
    });
    // Populate CacheStorage for next time
    await putToCacheStorage(cacheName, urlOrPath, idbCached);
    return idbCached;
  }

  // 3. Node.js direct filesystem check
  if (typeof process !== 'undefined' && process.versions?.node) {
    try {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const candidates = [
        urlOrPath,
        path.resolve(process.cwd(), urlOrPath),
        path.resolve(process.cwd(), '..', urlOrPath),
      ];
      for (const cand of candidates) {
        if (fs.existsSync(cand)) {
          const buffer = fs.readFileSync(cand);
          const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
          if (isValidOnnxBuffer(bytes)) {
            onProgress?.({
              phase: 'ready',
              loadedBytes: bytes.byteLength,
              totalBytes: bytes.byteLength,
              pct: 100,
              fromCache: true,
            });
            return bytes;
          }
        }
      }
    } catch {
      // Not a local filesystem path, continue to fetch
    }
  }

  // 4. Offline Check
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error(`Model not found in CacheStorage and client is offline: ${urlOrPath}`);
  }

  // 5. Streaming HTTP Fetch (only if http/https or browser environment)
  const isNode = typeof process !== 'undefined' && Boolean(process.versions?.node);
  if (!urlOrPath.startsWith('http://') && !urlOrPath.startsWith('https://') && isNode) {
    throw new Error(`Model not found at path: ${urlOrPath}`);
  }

  let fetchUrl = urlOrPath;
  if (!isNode && !urlOrPath.startsWith('http://') && !urlOrPath.startsWith('https://')) {
    try {
      const baseHref =
        (typeof self !== 'undefined' && self.location?.href) ||
        (typeof window !== 'undefined' && window.location?.href) ||
        '';
      if (baseHref) {
        fetchUrl = new URL(urlOrPath, baseHref).href;
      }
    } catch {}
  }

  const response = await fetch(fetchUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch model from ${fetchUrl}: HTTP ${response.status} ${response.statusText}`);
  }

  const contentLength = Number(response.headers.get('content-length') || 0);
  let totalBytes = contentLength > 0 ? contentLength : 0;
  let loadedBytes = 0;

  let buffer            ;

  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks               = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        loadedBytes += value.byteLength;
        const pct = totalBytes > 0 ? Math.min(100, (loadedBytes / totalBytes) * 100) : 0;
        onProgress?.({
          phase: 'download',
          loadedBytes,
          totalBytes: totalBytes || loadedBytes,
          pct: Math.round(pct),
          fromCache: false,
        });
      }
    }

    buffer = new Uint8Array(loadedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.byteLength;
    }
  } else {
    const arrayBuffer = await response.arrayBuffer();
    buffer = new Uint8Array(arrayBuffer);
    onProgress?.({
      phase: 'download',
      loadedBytes: buffer.byteLength,
      totalBytes: buffer.byteLength,
      pct: 100,
      fromCache: false,
    });
  }

  if (!isValidOnnxBuffer(buffer)) {
    throw new Error(`Corrupted model file received from ${urlOrPath}: protobuf 0x08 header verification failed`);
  }

  // Save to persistent caches asynchronously
  putToCacheStorage(cacheName, urlOrPath, buffer).catch(() => {});
  putToIndexedDB(urlOrPath, buffer).catch(() => {});

  return buffer;
}

/**
 * Core ONNX Runtime Engine for In-Browser and Node.js execution.
 * Manages WASM SIMD, multi-threading negotiation, WebGPU probing,
 * RAII tensor disposal, and model session lifecycles.
 */





             
                                                 
                    
                    
                          
                      
                    

                                                                      
                     
 

/**
 * Dynamically resolves onnxruntime-web or onnxruntime-node.
 */
async function getOrt()               {
  if (typeof (globalThis       ).ort !== 'undefined') {
    return (globalThis       ).ort;
  }
  const isNode = typeof process !== 'undefined' && Boolean(process.versions?.node);
  if (!isNode) {
    const baseHref =
      (typeof self !== 'undefined' && self.location?.href) ||
      (typeof window !== 'undefined' && window.location?.href) ||
      (typeof import.meta !== 'undefined' && import.meta.url) ||
      '';
    try {
      const url = new URL('./ort/ort.wasm.bundle.min.mjs', baseHref).href;
      const mod = await import(/* @vite-ignore */ url);
      return mod.default || mod;
    } catch {}
    try {
      const url = new URL('./ort/ort.wasm.min.mjs', baseHref).href;
      const mod = await import(/* @vite-ignore */ url);
      return mod.default || mod;
    } catch {}
  }
  try {
    const mod = await import('onnxruntime-web');
    return mod.default || mod;
  } catch {
    try {
      const mod = await import('onnxruntime-node');
      return mod.default || mod;
    } catch {
      throw new Error('Neither onnxruntime-web nor onnxruntime-node could be resolved in current runtime.');
    }
  }
}

/**
 * Negotiates optimal WASM SIMD and thread pool settings based on environment capabilities.
 */
function configureWasmEnvironment(ort     , userThreads         , wasmPaths         )         {
  if (!ort || !ort.env || !ort.env.wasm) return 1;

  ort.env.wasm.simd = true;
  ort.env.wasm.proxy = false;

  if (wasmPaths) {
    ort.env.wasm.wasmPaths = wasmPaths;
  }

  // Determine thread count
  const isIsolated = typeof (globalThis       ).crossOriginIsolated !== 'undefined'
    ? (globalThis       ).crossOriginIsolated
    : true; // In Node.js, threading is always supported

  let threads = 1;
  if (userThreads && userThreads >= 1) {
    threads = isIsolated ? Math.min(8, userThreads) : 1;
  } else if (isIsolated) {
    const hardwareConcurrency = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
    threads = Math.min(4, Math.max(1, hardwareConcurrency - 1));
  } else {
    threads = 1;
  }

  ort.env.wasm.numThreads = threads;
  return threads;
}

class AcousticEngine {
          ort     ;
          config                     ;
          acousticSession      = null;
          preprocessorSession      = null;
          vocab           = [];
          executionProvider                    = 'wasm';
          allocatedThreads         = 1;
          decoder                  ;
          isWarmed          = false;

          constructor(ort     , config                     ) {
    this.ort = ort;
    this.config = config;
    this.decoder = new CTCGreedyDecoder([]);
  }

  static async create(config                      = {})                          {
    const ort = await getOrt();
    const threads = configureWasmEnvironment(ort, config.numThreads, config.wasmPaths);

    const engine = new AcousticEngine(ort, config);
    engine.allocatedThreads = threads;

    // Load vocabulary for requested language
    await engine.loadVocabulary(config.vocabPath || config.modelPath);

    // Determine execution provider
    engine.executionProvider = config.executionProvider || 'wasm';
    if (engine.executionProvider === 'webgpu') {
      const hasGpu = typeof navigator !== 'undefined' && (navigator       ).gpu;
      if (!hasGpu) {
        engine.executionProvider = 'wasm';
      }
    }

    // Initialize session if model path provided or discover local default
    let effectiveModelPath = config.modelPath;
    if (effectiveModelPath && typeof process !== 'undefined' && process.versions?.node) {
      try {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const resolved = path.resolve(effectiveModelPath);
        if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
          const lang = config.language || 'sa';
          const modelNames = [`swanada_${lang}_ctc_int8.onnx`];
          if (lang === 'sa') modelNames.push('sushrota_sanskrit_ctc_int8.onnx');
          for (const mn of modelNames) {
            const c1 = path.join(resolved, 'onnx', mn);
            const c2 = path.join(resolved, mn);
            if (fs.existsSync(c1)) { effectiveModelPath = c1; break; }
            if (fs.existsSync(c2)) { effectiveModelPath = c2; break; }
          }
        }
      } catch {}
    }
    if (!effectiveModelPath && typeof process !== 'undefined' && process.versions?.node) {
      try {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const { fileURLToPath } = await import('node:url');
        const lang = config.language || 'sa';
        const modelNames = [`swanada_${lang}_ctc_int8.onnx`];
        if (lang === 'sa') modelNames.push('sushrota_sanskrit_ctc_int8.onnx');

        const candidates           = [];

        // 1. Resolve relative to import.meta.url
        if (typeof import.meta !== 'undefined' && import.meta.url) {
          try {
            for (const mn of modelNames) {
              candidates.push(fileURLToPath(new URL(`../../../models/onnx/${mn}`, import.meta.url)));
              candidates.push(fileURLToPath(new URL(`../../models/onnx/${mn}`, import.meta.url)));
            }
          } catch {}
        }

        // 2. Resolve relative to process.cwd()
        for (const mn of modelNames) {
          candidates.push(path.resolve(process.cwd(), 'models/onnx', mn));
        }

        for (const cand of candidates) {
          if (fs.existsSync(cand)) {
            effectiveModelPath = cand;
            break;
          }
        }
      } catch {}
    }

    if (effectiveModelPath) {
      await engine.loadAcousticModel(effectiveModelPath);
    }

    if (config.preprocessorMode === 'onnx' && config.preprocessorPath) {
      await engine.loadPreprocessorModel(config.preprocessorPath);
    }

    return engine;
  }

  async loadVocabulary(modelDirOrVocabPath         )                {
    let vocabData      = null;
    const searchedPaths           = [];
    const explicitVocab = this.config.vocabPath ||
      (modelDirOrVocabPath && modelDirOrVocabPath.endsWith('.json') ? modelDirOrVocabPath : undefined);
    const lang = this.config.language || 'sa';
    const vocabFileName = `${lang}_vocab.json`;

    if (typeof process !== 'undefined' && process.versions?.node) {
      try {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const { fileURLToPath } = await import('node:url');

        const candidates           = [];

        if (explicitVocab) {
          // Explicitly configured or passed vocabulary path
          candidates.push(path.resolve(explicitVocab));
        } else {
          // 1. Resolve relative to import.meta.url
          if (typeof import.meta !== 'undefined' && import.meta.url) {
            try {
              candidates.push(fileURLToPath(new URL(`../../../models/vocabularies/${vocabFileName}`, import.meta.url)));
              candidates.push(fileURLToPath(new URL(`../../models/vocabularies/${vocabFileName}`, import.meta.url)));
              if (lang === 'sa') {
                candidates.push(fileURLToPath(new URL('../../../models/vocabularies/sanskrit_vocab.json', import.meta.url)));
                candidates.push(fileURLToPath(new URL('../../models/vocabularies/sanskrit_vocab.json', import.meta.url)));
              }
            } catch {}
          }

          // 2. When modelPath is provided, search sibling/parent directories
          const refPath = modelDirOrVocabPath || this.config.modelPath;
          if (refPath && !refPath.startsWith('http://') && !refPath.startsWith('https://')) {
            const modelDir = path.dirname(path.resolve(refPath));
            candidates.push(
              path.resolve(modelDir, `../vocabularies/${vocabFileName}`),
              path.resolve(modelDir, `vocabularies/${vocabFileName}`),
              path.resolve(modelDir, vocabFileName),
              path.resolve(modelDir, `../../vocabularies/${vocabFileName}`)
            );
            if (lang === 'sa') {
              candidates.push(
                path.resolve(modelDir, '../vocabularies/sanskrit_vocab.json'),
                path.resolve(modelDir, 'vocabularies/sanskrit_vocab.json'),
                path.resolve(modelDir, 'sanskrit_vocab.json'),
                path.resolve(modelDir, '../../vocabularies/sanskrit_vocab.json')
              );
            }
          }

          // 3. Fallback to process.cwd()
          candidates.push(path.resolve(process.cwd(), `models/vocabularies/${vocabFileName}`));
          if (lang === 'sa') {
            candidates.push(path.resolve(process.cwd(), 'models/vocabularies/sanskrit_vocab.json'));
          }
        }

        for (const cand of candidates) {
          searchedPaths.push(cand);
          if (fs.existsSync(cand)) {
            vocabData = JSON.parse(fs.readFileSync(cand, 'utf8'));
            break;
          }
        }
      } catch {
        // Fallback to fetch
      }
    }

    if (!vocabData && typeof fetch !== 'undefined') {
      const fetchUrls           = [];
      if (explicitVocab) {
        fetchUrls.push(explicitVocab);
      } else {
        fetchUrls.push(`./models/vocabularies/${vocabFileName}`);
        if (lang === 'sa') {
          fetchUrls.push('./models/vocabularies/sanskrit_vocab.json');
        }
      }
      for (const url of fetchUrls) {
        try {
          searchedPaths.push(url);
          const res = await fetch(url);
          if (res.ok) {
            vocabData = await res.json();
            break;
          }
        } catch {}
      }
    }

    if (!vocabData) {
      throw new Error(
        `Failed to locate vocabulary for language "${this.config.language || 'sa'}". Searched paths: ${searchedPaths.join(', ')}`
      );
    }

    if (Array.isArray(vocabData)) {
      this.vocab = vocabData;
    } else if (vocabData && typeof vocabData === 'object') {
      this.vocab = Object.values(vocabData);
    } else {
      throw new Error(`Invalid vocabulary format for language "${this.config.language || 'sa'}". Expected JSON array or map.`);
    }

    this.decoder = new CTCGreedyDecoder(this.vocab);
  }

  async loadAcousticModel(modelPathOrUrl        )                {
    const modelBytes = await loadModelAsset(modelPathOrUrl, this.config.cacheStorageName);
    const options      = {
      executionProviders: [this.executionProvider],
      graphOptimizationLevel: 'all',
    };

    try {
      this.acousticSession = await this.ort.InferenceSession.create(modelBytes, options);
    } catch (err) {
      if (this.executionProvider === 'webgpu') {
        // Graceful fallback to wasm
        this.executionProvider = 'wasm';
        options.executionProviders = ['wasm'];
        this.acousticSession = await this.ort.InferenceSession.create(modelBytes, options);
      } else {
        throw err;
      }
    }
  }

  async loadPreprocessorModel(prepPathOrUrl        )                {
    const modelBytes = await loadModelAsset(prepPathOrUrl, this.config.cacheStorageName);
    const options      = {
      executionProviders: ['wasm'], // Preprocessor is pinned to WASM/CPU due to STFT
      graphOptimizationLevel: 'all',
    };
    this.preprocessorSession = await this.ort.InferenceSession.create(modelBytes, options);
  }

  /**
   * Runs acoustic model inference with RAII tensor disposal.
   */
  async runAcousticInference(features              , numFrames        )                                   {
    if (!this.acousticSession) {
      throw new Error('Acoustic model session is not initialized. Provide modelPath to create().');
    }

    let featsTensor      = null;
    let lenTensor      = null;
    let outputs      = null;
    const startMs = performance.now();

    try {
      featsTensor = new this.ort.Tensor('float32', features, [1, 80, numFrames]);
      lenTensor = new this.ort.Tensor('int64', BigInt64Array.from([BigInt(numFrames)]), [1]);

      outputs = await this.acousticSession.run({
        audio_signal: featsTensor,
        length: lenTensor,
      });

      const logitsTensor = outputs.logits || Object.values(outputs)[0];
      const dims = logitsTensor.dims; // [1, timeSteps, numClasses] or [timeSteps, numClasses]
      const timeSteps = dims.length === 3 ? dims[1] : dims[0];
      const numClasses = dims.length === 3 ? dims[2] : dims[1];

      // Copy logits data to safe Float32Array before disposing underlying tensor
      const logits = new Float32Array(logitsTensor.data);
      const inferenceMs = performance.now() - startMs;

      return {
        logits,
        timeSteps,
        numClasses,
        inferenceMs,
      };
    } finally {
      featsTensor?.dispose?.();
      lenTensor?.dispose?.();
      if (outputs) {
        for (const t of Object.values(outputs)) {
          (t       )?.dispose?.();
        }
      }
    }
  }

  /**
   * Transcribes a 16 kHz Float32Array PCM buffer.
   */
  async transcribe(pcm              )                               {
    const durationMs = (pcm.length / 16000) * 1000;
    const startTotal = performance.now();

    if (pcm.length === 0) {
      return {
        text: '',
        language: this.config.language || 'sa',
        durationMs: 0,
        inferenceMs: 0,
        rtf: 0,
        tokens: [],
      };
    }

    // VAD / Silence Energy Gate: RMS < 1e-4 (-80 dBFS) bypasses acoustic inference
    let sumSq = 0;
    for (let i = 0; i < pcm.length; i++) {
      sumSq += pcm[i] * pcm[i];
    }
    const rms = Math.sqrt(sumSq / pcm.length);
    if (rms < 1e-4) {
      const elapsedMs = performance.now() - startTotal;
      return {
        text: '',
        language: this.config.language || 'sa',
        durationMs,
        inferenceMs: elapsedMs,
        rtf: durationMs > 0 ? (elapsedMs / durationMs) : 0,
        tokens: [],
      };
    }

    if (!this.acousticSession) {
      throw new Error('Acoustic model session is not initialized. Ensure models are available at modelPath.');
    }

    // Multi-stage background noise cancellation & speech enhancement layer (default: enabled)
    let cleanPcm = pcm;
    let snrDb                     = undefined;
    if (this.config.denoise !== false) {
      const enhanced = enhanceSpeechWithTelemetry(pcm);
      snrDb = enhanced.estimatedSnrDb;
      if (!enhanced.isSpeechLikely) {
        const elapsedMs = performance.now() - startTotal;
        return {
          text: '',
          language: this.config.language || 'sa',
          durationMs,
          inferenceMs: elapsedMs,
          rtf: durationMs > 0 ? (elapsedMs / durationMs) : 0,
          tokens: [],
          snrDb,
        };
      }
      cleanPcm = enhanced.pcm;
    }

    // 1. Feature extraction
    let features              ;
    let numFrames        ;

    if (this.config.preprocessorMode === 'onnx' && this.preprocessorSession) {
      let audioTensor      = null;
      let lenTensor      = null;
      let outputs      = null;
      try {
        audioTensor = new this.ort.Tensor('float32', cleanPcm, [1, cleanPcm.length]);
        lenTensor = new this.ort.Tensor('int64', BigInt64Array.from([BigInt(cleanPcm.length)]), [1]);
        outputs = await this.preprocessorSession.run({
          audio_signal: audioTensor,
          length: lenTensor,
        });
        const featsTensor = outputs.features || Object.values(outputs)[0];
        numFrames = featsTensor.dims[2];
        features = new Float32Array(featsTensor.data);
      } finally {
        audioTensor?.dispose?.();
        lenTensor?.dispose?.();
        if (outputs) {
          for (const t of Object.values(outputs)) (t       )?.dispose?.();
        }
      }
    } else {
      // Analytical frontend (default fast path)
      const melResult = extractLogMelFeatures(cleanPcm);
      features = melResult.features;
      numFrames = melResult.numFrames;
    }

    // 2. Acoustic inference
    const acousticRes = await this.runAcousticInference(features, numFrames);

    // 3. CTC greedy decode
    const decodeRes = decodeCTC(
      acousticRes.logits,
      [acousticRes.timeSteps, acousticRes.numClasses],
      this.vocab
    );

    const totalInferenceMs = performance.now() - startTotal;
    const rtf = durationMs > 0 ? (totalInferenceMs / durationMs) : 0;

    return {
      text: decodeRes.text,
      language: this.config.language || 'sa',
      durationMs,
      inferenceMs: totalInferenceMs,
      rtf,
      tokens: decodeRes.tokens,
      snrDb,
    };
  }

  /**
   * Warm-up the session with synthetic non-silent buffers covering sliding window and chunk shapes.
   */
  async warmup()                {
    if (this.isWarmed || !this.acousticSession) return;
    // Generate synthetic non-zero signals exceeding VAD silence gate (RMS >= 1e-4)
    // Pre-warm maximum sliding window buffer (32,000 samples) and chunk size (5,120 samples)
    const windowSignal = new Float32Array(32000);
    for (let i = 0; i < 32000; i++) {
      windowSignal[i] = Math.sin(i * 0.1) * 0.05;
    }
    await this.transcribe(windowSignal);

    const chunkSignal = new Float32Array(5120);
    for (let i = 0; i < 5120; i++) {
      chunkSignal[i] = Math.sin(i * 0.1) * 0.05;
    }
    await this.transcribe(chunkSignal);
    this.isWarmed = true;
  }

  getVocab()           {
    return this.vocab;
  }

  async release()                {
    this.isWarmed = false;
    if (this.acousticSession && typeof this.acousticSession.release === 'function') {
      await this.acousticSession.release();
      this.acousticSession = null;
    }
    if (this.preprocessorSession && typeof this.preprocessorSession.release === 'function') {
      await this.preprocessorSession.release();
      this.preprocessorSession = null;
    }
  }
}

/**
 * StreamingAcousticEngine & SwanadaStreamSession:
 * Manages streaming audio chunk accumulation, sliding context windows (1000ms left context,
 * 2000ms maximum buffer cap), prefix-locked CTC decoding, and event dispatching.
 */



                                                                   
                                                      


                                       
                                                                     
                                                               
                                                               
                                              
 

class StreamingAcousticEngine {
          engine                ;
          decoder                     ;
          audioBuffer               = new Float32Array(0);
          leftContextSamples        ;
          maxBufferSamples        ;
          vadSilenceThreshold        ;
          totalAudioSamples         = 0;
          consecutiveSilentSamples         = 0;
          pauseThresholdSamples         = 8000; // 500 ms @ 16 kHz
          baseCommittedTokens           = [];
          isFinished          = false;
          isWindowSliding          = false;
          slidingChunkCount         = 0;
          stride         = 2;
          lastPartialTranscript                             = null;

  get audioBuffer()               {
    return this.audioBuffer;
  }

  get bufferLength()         {
    return this.audioBuffer.length;
  }

  getAudioBuffer()               {
    return this.audioBuffer;
  }

          listeners   
                                                    
                                                  
                                     
                                    
    = { partial: [], final: [], token: [], error: [] };

  constructor(
    engine                ,
    vocab                                   ,
    options                       
  ) {
    this.engine = engine;
    this.decoder = new StreamingCTCDecoder(vocab, {
      requireStabilityOnWordBoundary: true,
    });
    this.leftContextSamples = options?.leftContextSamples ?? 20480; // 1,280 ms
    this.maxBufferSamples = options?.maxBufferSamples ?? 61440; // 3,840 ms
    this.vadSilenceThreshold = options?.vadSilenceThreshold ?? 0.005;
  }

                                                                     
                                                                   
                                                      
                                                     
  on(event                                         , cb     )       {
    if (this.listeners[event]) {
      this.listeners[event].push(cb);
    }
    return this;
  }

  off(event                                         , cb     )       {
    if (this.listeners[event]) {
      const idx = this.listeners[event].indexOf(cb);
      if (idx !== -1) {
        this.listeners[event].splice(idx, 1);
      }
    }
    return this;
  }

  async push(chunk              )                                      {
    if (this.isFinished || chunk.length === 0) return;
    this.totalAudioSamples += chunk.length;

    // Non-destructive silence check & pause utterance segmentation
    let sumSq = 0;
    for (let i = 0; i < chunk.length; i++) sumSq += chunk[i] * chunk[i];
    const rms = Math.sqrt(sumSq / chunk.length);

    if (rms < this.vadSilenceThreshold) {
      this.consecutiveSilentSamples += chunk.length;
      if (this.consecutiveSilentSamples >= this.pauseThresholdSamples) {
        if (this.audioBuffer.length > 0) {
          // Flush unconfirmed tokens on natural speech pause (turn completion)
          const lastHyp = (this.decoder       ).lastHypTokens || [];
          const comm = this.decoder.getCommittedTokens();
          if (
            lastHyp.length > comm.length &&
            comm.every((tok        , idx        ) => tok === lastHyp[idx])
          ) {
            (this.decoder       ).committedTokens = [...lastHyp];
            (this.decoder       ).committedText = normalizeIndicText(
              lastHyp.join(''),
              (this.decoder       ).options
            );
          }
          this.baseCommittedTokens = this.decoder.getCommittedTokens();
          this.audioBuffer = new Float32Array(0);
          this.isWindowSliding = false;
          this.slidingChunkCount = 0;
          this.lastPartialTranscript = null;
        }
        return;
      }
    } else {
      this.consecutiveSilentSamples = 0;
    }

    // Concatenate into audioBuffer
    const nextBuf = new Float32Array(this.audioBuffer.length + chunk.length);
    nextBuf.set(this.audioBuffer, 0);
    nextBuf.set(chunk, this.audioBuffer.length);
    this.audioBuffer = nextBuf;

    // Allow initial chunk emission starting at 100ms (1600 samples)
    if (this.audioBuffer.length < 1600) {
      return;
    }

    const durationMs = (this.totalAudioSamples / 16000) * 1000;

    // Stride-2 inference scheduling during continuous window sliding
    if (this.isWindowSliding) {
      this.slidingChunkCount++;
      if (this.slidingChunkCount % this.stride !== 0) {
        if (this.lastPartialTranscript) {
          const st                      = {
            ...this.lastPartialTranscript,
            durationMs,
            inferenceMs: 0,
            rtf: durationMs > 0 ? (this.lastPartialTranscript.inferenceMs / durationMs) : 0,
          };
          for (const cb of this.listeners.partial) {
            try { cb(st); } catch (e) {
              this.emitError(e);
            }
          }
          return st;
        }
        return;
      }
    }

    try {
      const evalBuffer = (this.isWindowSliding && this.audioBuffer.length > this.maxBufferSamples)
        ? this.audioBuffer.slice(-this.maxBufferSamples)
        : this.audioBuffer;

      const startInference = performance.now();
      // Acoustic model inference over active buffer window
      const res = await this.engine.transcribe(evalBuffer);
      const inferenceMs = performance.now() - startInference;

      // Track window offset with base committed tokens across segmented pauses
      const committed = this.decoder.getCommittedTokens();
      let globalTokens          ;
      if (!this.isWindowSliding) {
        const windowTokens = [...this.baseCommittedTokens, ...res.tokens];
        globalTokens = this.alignGrowingWindow(committed, windowTokens, this.baseCommittedTokens.length);
      } else {
        const [bestOffset, bestRawStart] = this.findWindowAlignment(committed, res.tokens);
        globalTokens = [...committed.slice(0, bestOffset), ...res.tokens.slice(bestRawStart)];
      }

      // Hold irreversible prefix commits during the first <600ms of an utterance segment
      // while still emitting live volatile partial transcripts from 100ms onward.
      const allowCommit = this.isWindowSliding || this.audioBuffer.length >= 9600;

      // Update streaming decoder with aligned global tokens
      const st = this.decoder.update(globalTokens, false, durationMs, inferenceMs, allowCommit);
      this.lastPartialTranscript = st;

      // Emit new tokens if any
      if (this.listeners.token.length > 0 && res.tokens.length > 0) {
        const lastTok = res.tokens[res.tokens.length - 1];
        for (const tcb of this.listeners.token) {
          try { tcb(lastTok); } catch (e) {
            this.emitError(e);
          }
        }
      }

      for (const cb of this.listeners.partial) {
        try { cb(st); } catch (e) {
          this.emitError(e);
        }
      }

      // Bound buffer to maxBufferSamples with leftContext
      if (this.audioBuffer.length > this.maxBufferSamples) {
        this.audioBuffer = this.audioBuffer.slice(-this.leftContextSamples);
        this.isWindowSliding = true;
      }

      return st;
    } catch (err     ) {
      this.emitError(err);
    }
  }

  async finish()                               {
    this.isFinished = true;
    const durationMs = (this.totalAudioSamples / 16000) * 1000;
    const startInference = performance.now();

    // Process pending audio tail if needed (< 1600 samples or odd stride skip)
    const hasUnEvaluatedSamples =
      (this.isWindowSliding && this.slidingChunkCount % this.stride !== 0) ||
      (this.audioBuffer.length >= 400 && (this.audioBuffer.length < 1600 || !(this.decoder       ).lastHypTokens?.length));

    if (this.audioBuffer.length >= 400 && hasUnEvaluatedSamples) {
      const evalBuffer = (this.isWindowSliding && this.audioBuffer.length > this.maxBufferSamples)
        ? this.audioBuffer.slice(-this.maxBufferSamples)
        : this.audioBuffer;
      const tailRes = await this.engine.transcribe(evalBuffer);
      const committed = this.decoder.getCommittedTokens();
      let globalTokens          ;
      if (!this.isWindowSliding) {
        const windowTokens = [...this.baseCommittedTokens, ...tailRes.tokens];
        globalTokens = this.alignGrowingWindow(committed, windowTokens, this.baseCommittedTokens.length);
      } else {
        const [bestOffset, bestRawStart] = this.findWindowAlignment(committed, tailRes.tokens);
        globalTokens = [...committed.slice(0, bestOffset), ...tailRes.tokens.slice(bestRawStart)];
      }
      this.decoder.update(globalTokens, false, durationMs, 0, true);
    }

    const streamingTokens = (this.decoder       ).lastHypTokens?.length
      ? [...(this.decoder       ).lastHypTokens]
      : this.decoder.getCommittedTokens();

    const inferenceMs = performance.now() - startInference;
    const finalSt = this.decoder.update(streamingTokens, true, durationMs, inferenceMs);

    this.audioBuffer = new Float32Array(0);
    this.totalAudioSamples = 0;
    this.consecutiveSilentSamples = 0;
    this.baseCommittedTokens = [];
    this.isWindowSliding = false;
    this.slidingChunkCount = 0;
    this.lastPartialTranscript = null;

    const result                      = {
      text: finalSt.text,
      language: (this.engine       ).config?.language || 'sa',
      durationMs,
      inferenceMs,
      rtf: durationMs > 0 ? inferenceMs / durationMs : 0,
      tokens: finalSt.tokens,
    };

    for (const cb of this.listeners.final) {
      try { cb(result); } catch (e) {
        this.emitError(e);
      }
    }

    return result;
  }

  /**
   * Aligns committed prefix tokens against a full re-decoded growing window
   * (`baseCommittedTokens + res.tokens`) so subword insertions/merges earlier in the
   * window never shift uncommitted indices or duplicate syllables while strictly
   * preserving `committedTokens` (0.00% churn).
   */
          alignGrowingWindow(
    committedTokens          ,
    windowTokens          ,
    baseLen        
  )           {
    const cLen = committedTokens.length;
    if (cLen <= baseLen || windowTokens.length === 0) {
      return windowTokens;
    }

    const searchFrom = Math.max(baseLen, cLen - 8);
    const minEnd = Math.max(baseLen + 1, cLen - 4);
    const maxEnd = Math.min(windowTokens.length, cLen + 5);

    let bestEnd = -1;
    let bestMatchLen = 0;
    let bestDist = 999;

    // 1. Exact suffix match of committedTokens[j..cLen] ending near expected position cLen
    for (let rEnd = minEnd; rEnd <= maxEnd; rEnd++) {
      let matchLen = 0;
      while (
        cLen - 1 - matchLen >= searchFrom &&
        rEnd - 1 - matchLen >= baseLen &&
        committedTokens[cLen - 1 - matchLen] === windowTokens[rEnd - 1 - matchLen]
      ) {
        matchLen++;
      }
      if (matchLen > 0) {
        const dist = Math.abs(rEnd - cLen);
        if (matchLen > bestMatchLen || (matchLen === bestMatchLen && dist < bestDist)) {
          bestMatchLen = matchLen;
          bestEnd = rEnd;
          bestDist = dist;
        }
      }
    }

    if (bestMatchLen > 0 && bestEnd >= 0) {
      return [...committedTokens, ...windowTokens.slice(bestEnd)];
    }

    // 2. 1-token boundary revision near-suffix match (committedTokens[j..cLen-1])
    if (cLen - 1 > baseLen) {
      for (let rMid = Math.max(baseLen + 1, cLen - 5); rMid <= Math.min(windowTokens.length, cLen + 4); rMid++) {
        let matchLen = 0;
        while (
          cLen - 2 - matchLen >= searchFrom &&
          rMid - 1 - matchLen >= baseLen &&
          committedTokens[cLen - 2 - matchLen] === windowTokens[rMid - 1 - matchLen]
        ) {
          matchLen++;
        }
        if (matchLen > 0) {
          const rEnd = Math.min(windowTokens.length, rMid + 1);
          const dist = Math.abs(rEnd - cLen);
          if (matchLen > bestMatchLen || (matchLen === bestMatchLen && dist < bestDist)) {
            bestMatchLen = matchLen;
            bestEnd = rEnd;
            bestDist = dist;
          }
        }
      }
      if (bestMatchLen > 0 && bestEnd >= 0) {
        return [...committedTokens, ...windowTokens.slice(bestEnd)];
      }
    }

    return [...committedTokens, ...windowTokens.slice(Math.min(windowTokens.length, cLen))];
  }

          findWindowAlignment(committedTokens          , rawTokens          )                   {
    if (committedTokens.length === 0 || rawTokens.length === 0) {
      return [committedTokens.length, 0];
    }

    const searchLimit = Math.max(0, committedTokens.length - 30);
    let bestOffset = committedTokens.length;
    let bestRawStart = 0;
    let bestMatchLen = 0;

    for (let rStart = 0; rStart < rawTokens.length; rStart++) {
      for (let j = committedTokens.length - 1; j >= searchLimit; j--) {
        let matchLen = 0;
        while (
          j + matchLen < committedTokens.length &&
          rStart + matchLen < rawTokens.length &&
          committedTokens[j + matchLen] === rawTokens[rStart + matchLen]
        ) {
          matchLen++;
        }
        if (j + matchLen === committedTokens.length && matchLen > bestMatchLen) {
          bestMatchLen = matchLen;
          bestOffset = j;
          bestRawStart = rStart;
          if (matchLen >= 2) break;
        }
      }
      if (bestMatchLen >= 2) break;
    }

    if (bestMatchLen > 0) {
      return [bestOffset, bestRawStart];
    }

    // Near-suffix match (within 1 token of end)
    for (let rStart = 0; rStart < rawTokens.length; rStart++) {
      for (let j = committedTokens.length - 1; j >= searchLimit; j--) {
        let matchLen = 0;
        while (
          j + matchLen < committedTokens.length &&
          rStart + matchLen < rawTokens.length &&
          committedTokens[j + matchLen] === rawTokens[rStart + matchLen]
        ) {
          matchLen++;
        }
        if (j + matchLen >= committedTokens.length - 1 && matchLen > bestMatchLen) {
          bestMatchLen = matchLen;
          bestOffset = j;
          bestRawStart = rStart;
          if (matchLen >= 2) break;
        }
      }
      if (bestMatchLen >= 2) break;
    }

    if (bestMatchLen >= 2) {
      return [bestOffset, bestRawStart];
    }

    return [committedTokens.length, 0];
  }

          emitError(err     )       {
    const errorObj = err instanceof Error ? err : new Error(String(err));
    for (const errCb of this.listeners.error) {
      try { errCb(errorObj); } catch {}
    }
  }

  async warmup()                {
    if ((this.engine       ).warmup) {
      await (this.engine       ).warmup();
    }
  }

  reset()       {
    this.audioBuffer = new Float32Array(0);
    this.totalAudioSamples = 0;
    this.consecutiveSilentSamples = 0;
    this.baseCommittedTokens = [];
    this.isFinished = false;
    this.isWindowSliding = false;
    this.slidingChunkCount = 0;
    this.lastPartialTranscript = null;
    this.decoder.reset();
  }
}

// Alias for compatibility
const SwanadaStreamSession = StreamingAcousticEngine;

/**
 * Multilingual Vocabulary Registry and Script Metadata for Swanada Web & Node.
 */

                               
                                           
                                            

                               
                          
               
                     
                 
                                 
                        
                        
 

const LANGUAGE_REGISTRY                                          = {
  sa: { code: 'sa', name: 'Sanskrit', nativeName: 'संस्कृतम्', script: 'Devanagari', unicodeRange: [0x0900, 0x097f], vocabFilename: 'sa_vocab.json', modelFilename: 'swanada_sa_ctc_int8.onnx' },
  hi: { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', script: 'Devanagari', unicodeRange: [0x0900, 0x097f], vocabFilename: 'hi_vocab.json', modelFilename: 'swanada_hi_ctc_int8.onnx' },
  kn: { code: 'kn', name: 'Kannada', nativeName: 'ಕನ್ನಡ', script: 'Kannada', unicodeRange: [0x0c80, 0x0cff], vocabFilename: 'kn_vocab.json', modelFilename: 'swanada_kn_ctc_int8.onnx' },
  mr: { code: 'mr', name: 'Marathi', nativeName: 'मराठी', script: 'Devanagari', unicodeRange: [0x0900, 0x097f], vocabFilename: 'mr_vocab.json', modelFilename: 'swanada_mr_ctc_int8.onnx' },
  bn: { code: 'bn', name: 'Bengali', nativeName: 'বাংলা', script: 'Bengali', unicodeRange: [0x0980, 0x09ff], vocabFilename: 'bn_vocab.json', modelFilename: 'swanada_bn_ctc_int8.onnx' },
  ta: { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்', script: 'Tamil', unicodeRange: [0x0b80, 0x0bff], vocabFilename: 'ta_vocab.json', modelFilename: 'swanada_ta_ctc_int8.onnx' },
  te: { code: 'te', name: 'Telugu', nativeName: 'తెలుగు', script: 'Telugu', unicodeRange: [0x0c00, 0x0c7f], vocabFilename: 'te_vocab.json', modelFilename: 'swanada_te_ctc_int8.onnx' },
  ml: { code: 'ml', name: 'Malayalam', nativeName: 'മലയാളം', script: 'Malayalam', unicodeRange: [0x0d00, 0x0d7f], vocabFilename: 'ml_vocab.json', modelFilename: 'swanada_ml_ctc_int8.onnx' },
  gu: { code: 'gu', name: 'Gujarati', nativeName: 'ગુજરાતી', script: 'Gujarati', unicodeRange: [0x0a80, 0x0aff], vocabFilename: 'gu_vocab.json', modelFilename: 'swanada_gu_ctc_int8.onnx' },
  pa: { code: 'pa', name: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ', script: 'Gurmukhi', unicodeRange: [0x0a00, 0x0a7f], vocabFilename: 'pa_vocab.json', modelFilename: 'swanada_pa_ctc_int8.onnx' },
  or: { code: 'or', name: 'Odia', nativeName: 'ଓଡ଼ିଆ', script: 'Odia', unicodeRange: [0x0b00, 0x0b7f], vocabFilename: 'or_vocab.json', modelFilename: 'swanada_or_ctc_int8.onnx' },
  en: { code: 'en', name: 'Indian English', nativeName: 'English', script: 'Latin', unicodeRange: [0x0020, 0x007e], vocabFilename: 'en_vocab.json', modelFilename: 'swanada_en_ctc_int8.onnx' },
};

class TokenRegistry {
          idToToken          ;
          tokenToId                     ;

  constructor(tokens          ) {
    this.idToToken = [...tokens];
    this.tokenToId = new Map();
    for (let i = 0; i < tokens.length; i++) {
      this.tokenToId.set(tokens[i], i);
    }
    if (this.idToToken[0] !== '<blank>') {
      throw new Error('Class index 0 must be reserved for <blank>');
    }
  }

  getToken(id        )         {
    return this.idToToken[id] ?? '<unk>';
  }

  getId(token        )         {
    return this.tokenToId.get(token) ?? 1; // 1 = <unk>
  }

  get size()         {
    return this.idToToken.length;
  }

  get tokens()           {
    return [...this.idToToken];
  }
}

/**
 * Detect language/script code from Unicode codepoint frequencies.
 */
function detectScript(text        )                           {
  const counts                                             = {};
  for (let i = 0; i < text.length; i++) {
    const cp = text.charCodeAt(i);
    for (const [lang, meta] of Object.entries(LANGUAGE_REGISTRY)) {
      if (lang === 'en') {
        // Restrict English strictly to Latin alphabetic letters (A-Z, a-z)
        // to prevent ASCII spaces and punctuation from leaking into English.
        if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) {
          counts['en'] = (counts['en'] || 0) + 1;
          break;
        }
      } else {
        const [start, end] = meta.unicodeRange;
        if (cp >= start && cp <= end) {
          const key = lang                     ;
          counts[key] = (counts[key] || 0) + 1;
          break;
        }
      }
    }
  }

  let bestLang                           = null;
  let maxCount = 0;
  for (const [lang, cnt] of Object.entries(counts)) {
    if (cnt && cnt > maxCount) {
      maxCount = cnt;
      bestLang = lang                     ;
    }
  }
  return bestLang;
}

/**
 * Deterministic Classical Sanskrit Devanagari to Roman IAST Transliteration.
 * Full support for vocalic liquids (ṛ, ṝ, ḷ, ḹ), ayogavāhas (ḥ, ṃ, m̐),
 * avagraha ('), and Vedic pitch accents (udātta, anudātta).
 */

const VOWEL_MAP                         = {
  'अ': 'a', 'आ': 'ā', 'इ': 'i', 'ई': 'ī', 'उ': 'u', 'ऊ': 'ū',
  'ऋ': 'ṛ', 'ॠ': 'ṝ', 'ऌ': 'ḷ', 'ॡ': 'ḹ',
  'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au',
};

const MATRA_MAP                         = {
  'ा': 'ā', 'ि': 'i', 'ी': 'ī', 'ु': 'u', 'ू': 'ū',
  'ृ': 'ṛ', 'ॄ': 'ṝ', 'ॢ': 'ḷ', 'ॣ': 'ḹ',
  'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au',
};

const CONSONANT_MAP                         = {
  'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'ṅ',
  'च': 'c', 'छ': 'ch', 'ज': 'j', 'झ': 'jh', 'ञ': 'ñ',
  'ट': 'ṭ', 'ठ': 'ṭh', 'ड': 'ḍ', 'ढ': 'ḍh', 'ण': 'ṇ',
  'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
  'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm',
  'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v',
  'श': 'ś', 'ष': 'ṣ', 'स': 's', 'ह': 'h',
  'ळ': 'ḻ', 'ऴ': 'ḻh',
};

const SPECIAL_MAP                         = {
  'ं': 'ṃ',   // Anusvara
  'ः': 'ḥ',   // Visarga
  'ँ': 'm̐',  // Anunasika / Candrabindu
  'ऽ': "'",   // Avagraha
  '।': '.',   // Danda
  '॥': '..',  // Double Danda
};

const ACCENT_MAP                         = {
  '\u0951': '\u0301', // Udatta (combining acute)
  '\u0952': '\u0300', // Anudatta (combining grave)
};

/**
 * Deterministically converts Classical Sanskrit Devanagari text to Roman IAST.
 */
function devanagariToIast(text        )         {
  const normalized = text.normalize('NFC');
  const result           = [];
  let i = 0;
  const n = normalized.length;

  while (i < n) {
    const ch = normalized[i];

    // 1. Standalone Vowels
    if (VOWEL_MAP[ch]) {
      result.push(VOWEL_MAP[ch]);
      i++;
      while (i < n && ACCENT_MAP[normalized[i]]) {
        result.push(ACCENT_MAP[normalized[i]]);
        i++;
      }
      continue;
    }

    // 2. Consonants with inherent schwa
    if (CONSONANT_MAP[ch]) {
      const baseC = CONSONANT_MAP[ch];
      i++;
      if (i < n && normalized[i] === '्') {
        // Virama suppresses inherent 'a'
        result.push(baseC);
        i++;
      } else if (i < n && MATRA_MAP[normalized[i]]) {
        // Matra replaces inherent 'a'
        result.push(baseC);
        result.push(MATRA_MAP[normalized[i]]);
        i++;
        while (i < n && ACCENT_MAP[normalized[i]]) {
          result.push(ACCENT_MAP[normalized[i]]);
          i++;
        }
      } else {
        // Inherent 'a'
        result.push(baseC);
        result.push('a');
        while (i < n && ACCENT_MAP[normalized[i]]) {
          result.push(ACCENT_MAP[normalized[i]]);
          i++;
        }
      }
      continue;
    }

    // 3. Special Characters and Diacritics
    if (SPECIAL_MAP[ch]) {
      result.push(SPECIAL_MAP[ch]);
      i++;
      while (i < n && ACCENT_MAP[normalized[i]]) {
        result.push(ACCENT_MAP[normalized[i]]);
        i++;
      }
      continue;
    }

    // 3b. Standalone / Orphan Vedic accents
    if (ACCENT_MAP[ch]) {
      result.push(ACCENT_MAP[ch]);
      i++;
      continue;
    }

    // 4. Numerals, spaces, and pass-through characters
    result.push(ch);
    i++;
  }

  return result.join('').normalize('NFC');
}

/**
 * Transliterate Classical Sanskrit Devanagari text to Roman IAST.
 */
function transliterateIast(text        )         {
  return devanagariToIast(text);
}

/**
 * swanada: TypeScript Client Wrapper for STT Web Worker (SwanadaWorkerClient).
 * Provides event subscription, Promise-based lifecycle methods,
 * and zero-copy Transferable ArrayBuffer dispatching.
 */

                                                                                                    

                                      
                           
                               
                    
                    
                                        
                      
                     
                     
                    
 

                                      
                                                
                   
                       
                      
                     
 

                                     
               
                     
                    
                
              
                 
                      
                       
                   
                      
 

                                   
                              
                                       
                     
                     
 

                                      
                                           
                                                 
                                               
                                                                  
                                                              
  

class SwanadaWorkerClient {
          worker        ;
          listeners                                                                           = {};
          readyPromise                           ;
          readyResolve                                    ;
          readyReject                         ;
          finalResolve                                                                     = null;
          finalReject                                  = null;
          isTerminated = false;

  constructor(config                      = {}) {
    const workerScript = config.workerUrl || './stt-worker.mjs';
    if (typeof workerScript === 'object' && workerScript !== null && !(workerScript instanceof URL)) {
      this.worker = workerScript                     ;
    } else if (typeof Worker !== 'undefined') {
      this.worker = typeof workerScript === 'string'
        ? new Worker(workerScript, { type: 'module' })
        : new Worker((workerScript       ).href, { type: 'module' });
    } else {
      // Mock or node environment wrapper
      this.worker = {
        postMessage: () => {},
        terminate: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
      }       ;
    }

    this.readyPromise = new Promise                  ((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });

    this.setupWorkerListeners();

    // Auto-initiate only if language or modelUrl is provided
    if (config.language || config.modelUrl) {
      this.init(config).catch((err) => {
        this.emit('error', { message: err.message, fatal: true });
      });
    }
  }

          setupWorkerListeners()       {
    if (!this.worker) return;

    const onMessage = (event              ) => {
      const msg = event.data;
      if (!msg || !msg.type) return;

      switch (msg.type) {
        case 'READY': {
          const readyEvent                   = {
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
            committed: msg.committed ?? '',
            volatile: msg.volatile ?? '',
            iast: msg.iast,
            rtf: msg.rtf,
            snrDb: msg.snrDb,
            durationMs: msg.durationMs,
            inferenceMs: msg.inferenceMs,
            tokens: msg.tokens,
            chunkIndex: msg.chunkIndex,
          });
          break;
        }

        case 'FINAL': {
          const result                                          = {
            text: msg.text,
            iast: msg.iast,
            language: msg.language || '',
            durationMs: msg.durationMs,
            inferenceMs: msg.inferenceMs,
            rtf: msg.rtf,
            snrDb: msg.snrDb,
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

    const onError = (err     ) => {
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
  async init(config                     )                            {
    if (this.isTerminated) throw new Error('Cannot initialize terminated worker.');
    this.readyPromise = new Promise                  ((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
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
  async whenReady()                            {
    return this.readyPromise;
  }

  /**
   * Changes the active language model.
   */
  async setLanguage(
    language                   ,
    options                                           = {}
  )                            {
    await this.whenReady();
    this.readyPromise = new Promise                  ((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.worker.postMessage({
      type: 'SET_LANGUAGE',
      language,
      modelUrl: options.modelUrl,
      vocabUrl: options.vocabUrl,
    });
    return this.readyPromise;
  }

  /**
   * Toggles multi-stage background noise cancellation & speech enhancement in the worker.
   */
  setDenoise(enabled         )       {
    if (!this.isTerminated) {
      this.worker.postMessage({
        type: 'SET_DENOISE',
        enabled: Boolean(enabled),
      });
    }
  }

  /**
   * Pushes a 16 kHz Float32 PCM chunk using zero-copy Transferable ArrayBuffer.
   */
  pushAudio(chunk              , isFinal          = false)       {
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
  async transcribe(pcm              )                                                   {
    await this.whenReady();
    return new Promise((resolve, reject) => {
      this.finalResolve = resolve;
      this.finalReject = reject;
      this.pushAudio(pcm, true);
    });
  }

  /**
   * Starts a new streaming transcription session.
   */
  startStream()       {
    this.reset();
  }

  /**
   * Completes active stream and awaits final transcription result.
   */
  async finishStream()                                                   {
    await this.whenReady();
    return new Promise((resolve, reject) => {
      this.finalResolve = resolve;
      this.finalReject = reject;
      this.pushAudio(new Float32Array(0), true);
    });
  }

  /**
   * Resets active audio accumulator and CTC decoder state.
   */
  reset()       {
    if (!this.isTerminated) {
      this.worker.postMessage({ type: 'RESET' });
    }
  }

  /**
   * Subscribes to worker lifecycle and transcription events.
   * Returns an unsubscribe function.
   */
  on                                        (event   , handler                           )             {
    if (!this.listeners[event]) {
      this.listeners[event] = new Set()       ;
    }
    this.listeners[event] .add(handler       );
    return () => {
      this.listeners[event]?.delete(handler       );
    };
  }

          emit                                        (
    event   ,
    payload                                          
  )       {
    const handlers = this.listeners[event];
    if (handlers) {
      for (const h of handlers) {
        try {
          (h            )(payload);
        } catch (err) {
          console.error(`Error in SwanadaWorkerClient listener for "${event}":`, err);
        }
      }
    }
  }

  /**
   * Immediately terminates the background worker thread.
   */
  terminate()       {
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

/**
 * swanada: Dedicated STT Background Web Worker (stt-worker.ts).
 * Runs ONNX Runtime Web WASM SIMD completely off the main thread.
 * Guarantees 60 FPS UI rendering, zero audio capture glitching,
 * and 0 external network requests during active transcription.
 */







                                                                                                        

// Worker global scope declaration
                        

let workerReadyToDispatch = false;
const startupMessageQueue        = [];
if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
  if (!(self       ).__swanadaWorkerListenerAttached) {
    (self       ).__swanadaWorkerListenerAttached = true;
    self.addEventListener('message', (event     ) => {
      if (!workerReadyToDispatch) {
        startupMessageQueue.push(event.data);
      } else {
        handleIncomingMessage(event.data);
      }
    });
  }
}

                                                                                             

                              
               
                               
                    
                    
                                        
                      
                     
                     
            
                                 
                      
                      
                                          
                        
                       
                       
    
 

                                    
                                        
                       
                                  
                    
                      
 

                                
                 
 

                               
                
 

                                     
                       
                              
                    
                    
 

                                    
                      
                   
 

                            
               
                     
                 
                
                      
                      

// State management
let workerState              = 'UNINITIALIZED';
let ort      = null;
let currentLanguage                    = 'sa';
let activeSession      = null;
let activeVocab           = [];
let ctcDecoder                          = null;
let executionProvider                    = 'wasm';
let cacheStorageName         = CACHE_STORAGE_NAME;
let denoiseEnabled          = true;
let lastEstimatedSnrDb         = 0;

// Session cache (LRU) for instant language switching without redownloading
const sessionCache = new Map                                           ();

// Streaming session for bounded O(1) real-time transcription
let streamingSession                                 = null;

function getWorkerState()              {
  return workerState;
}

/**
 * Resolves onnxruntime-web in worker context.
 */
async function resolveOrt()               {
  if (ort) return ort;
  if (typeof self !== 'undefined' && typeof self.ort !== 'undefined') {
    ort = self.ort;
    return ort;
  }
  if (typeof globalThis !== 'undefined' && typeof (globalThis       ).ort !== 'undefined') {
    ort = (globalThis       ).ort;
    return ort;
  }

  const isNode = typeof process !== 'undefined' && Boolean(process.versions?.node);
  if (!isNode) {
    const baseHref =
      (typeof self !== 'undefined' && self.location?.href) ||
      (typeof window !== 'undefined' && (window       ).location?.href) ||
      (typeof import.meta !== 'undefined' && import.meta.url) ||
      '';
    try {
      const url = new URL('./ort/ort.wasm.bundle.min.mjs', baseHref).href;
      const mod = await import(/* @vite-ignore */ url);
      ort = mod?.default?.InferenceSession ? mod.default : (mod.default || mod);
      return ort;
    } catch {}
    try {
      const url = new URL('./ort/ort.wasm.min.mjs', baseHref).href;
      const mod = await import(/* @vite-ignore */ url);
      ort = mod?.default?.InferenceSession ? mod.default : (mod.default || mod);
      return ort;
    } catch {}
  }

  try {
    const mod = await import('onnxruntime-web');
    ort = mod.default || mod;
    return ort;
  } catch {
    try {
      const mod = await import('onnxruntime-node');
      ort = mod.default || mod;
      return ort;
    } catch (err) {
      throw new Error(`Failed to load onnxruntime-web in worker: ${(err         ).message}`);
    }
  }
}

/**
 * Configures WASM environment for worker threads.
 */
function configureWasm(ortInstance     , numThreads         , wasmPaths         )         {
  if (!ortInstance?.env?.wasm) return 1;
  ortInstance.env.wasm.simd = true;
  ortInstance.env.wasm.proxy = false;

  if (wasmPaths) {
    ortInstance.env.wasm.wasmPaths = wasmPaths;
  } else if (!ortInstance.env.wasm.wasmPaths) {
    try {
      const baseHref =
        (typeof self !== 'undefined' && self.location?.href) ||
        (typeof window !== 'undefined' && (window       ).location?.href) ||
        (typeof import.meta !== 'undefined' && import.meta.url) ||
        '';
      if (baseHref) {
        ortInstance.env.wasm.wasmPaths = new URL('./ort/', baseHref).href;
      }
    } catch {}
  }

  const isIsolated = typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : false;
  const ua = typeof navigator !== 'undefined' ? navigator?.userAgent || '' : '';
  const devMem = typeof navigator !== 'undefined' ? (navigator       )?.deviceMemory || 8 : 8;
  const isMobileRuntime = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || devMem <= 4;
  const maxThreads = isMobileRuntime ? 2 : 4;
  let threads = 1;
  if (numThreads && numThreads >= 1) {
    threads = isIsolated ? Math.min(maxThreads, numThreads) : 1;
  } else if (isIsolated) {
    const cores = typeof navigator !== 'undefined' ? navigator?.hardwareConcurrency || 4 : 4;
    threads = Math.min(maxThreads, Math.max(1, cores - 1));
  }
  ortInstance.env.wasm.numThreads = threads;
  return threads;
}

/**
 * Loads vocabulary JSON via CacheStorage or network.
 */
async function loadVocab(vocabUrlOrPath        )                    {
  // Check CacheStorage first
  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(cacheStorageName);
      const matched = await cache.match(vocabUrlOrPath);
      if (matched && matched.ok) {
        const json = await matched.json();
        return Array.isArray(json) ? json : Object.values(json);
      }
    } catch {}
  }

  // Node filesystem check
  const isNode = typeof process !== 'undefined' && Boolean(process.versions?.node);
  if (isNode) {
    try {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const candidates = [
        vocabUrlOrPath,
        path.resolve(process.cwd(), vocabUrlOrPath),
        path.resolve(process.cwd(), '..', vocabUrlOrPath),
      ];
      for (const cand of candidates) {
        if (fs.existsSync(cand)) {
          const raw = fs.readFileSync(cand, 'utf8');
          const json = JSON.parse(raw);
          return Array.isArray(json) ? json : Object.values(json);
        }
      }
    } catch {}
  }

  // Offline check
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error(`Model not found in CacheStorage and client is offline: ${vocabUrlOrPath}`);
  }

  // Network fetch fallback (only if http/https or browser environment)
  if (!vocabUrlOrPath.startsWith('http://') && !vocabUrlOrPath.startsWith('https://') && isNode) {
    throw new Error(`Vocabulary not found at path: ${vocabUrlOrPath}`);
  }

  let fetchUrl = vocabUrlOrPath;
  if (!isNode && !vocabUrlOrPath.startsWith('http://') && !vocabUrlOrPath.startsWith('https://')) {
    try {
      const baseHref =
        (typeof self !== 'undefined' && self.location?.href) ||
        (typeof window !== 'undefined' && (window       ).location?.href) ||
        '';
      if (baseHref) {
        fetchUrl = new URL(vocabUrlOrPath, baseHref).href;
      }
    } catch {}
  }

  const res = await fetch(fetchUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch vocabulary from ${fetchUrl}: HTTP ${res.status}`);
  }

  // Clone response and store in CacheStorage
  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(cacheStorageName);
      cache.put(vocabUrlOrPath, res.clone()).catch(() => {});
    } catch {}
  }

  const json = await res.json();
  return Array.isArray(json) ? json : Object.values(json);
}

/**
 * Dispatches an outgoing message via self.postMessage if available.
 */
function postWorkerMessage(message     , transfer                 )       {
  if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
    if (transfer && transfer.length > 0) {
      self.postMessage(message, transfer);
    } else {
      self.postMessage(message);
    }
  }
}

/**
 * Initializes or switches models and sessions.
 */
async function setupLanguage(
  lang                   ,
  modelUrl         ,
  vocabUrl         ,
  userThreads         ,
  wasmPaths         
)                {
  workerState = 'INITIALIZING';
  currentLanguage = lang;

  if (sessionCache.has(lang)) {
    const cached = sessionCache.get(lang) ;
    activeSession = cached.session;
    activeVocab = cached.vocab;
    ctcDecoder = new CTCGreedyDecoder(activeVocab);
    const engineAdapter      = {
      config: { language: lang },
      getVocab: () => activeVocab,
      transcribe: async (pcm              ) => {
        return runAcousticInference(pcm);
      },
    };
    streamingSession = new StreamingAcousticEngine(engineAdapter, activeVocab, {
      leftContextSamples: 20480,
      maxBufferSamples: 61440,
      vadSilenceThreshold: 0.005,
    });
    workerState = 'READY';
    postWorkerMessage({
      type: 'READY',
      language: lang,
      executionProvider,
      numThreads: ort?.env?.wasm?.numThreads || 1,
      fromCache: true,
    });
    return;
  }

  const ortInstance = await resolveOrt();
  const activeThreads = configureWasm(ortInstance, userThreads, wasmPaths);

  // 1. Resolve URLs
  const effectiveModelUrl = modelUrl || `./models/onnx/swanada_${lang}_ctc_int8.onnx`;
  const effectiveVocabUrl = vocabUrl || `./models/vocabularies/${lang}_vocab.json`;

  // 2. Load Vocabulary
  activeVocab = await loadVocab(effectiveVocabUrl);
  ctcDecoder = new CTCGreedyDecoder(activeVocab);

  // 3. Load Acoustic Model with Progress Reporting
  postWorkerMessage({
    type: 'PROGRESS',
    stage: 'downloading',
    progress: 0.1,
    fromCache: false,
  });

  const progressHandler = (p     ) => {
    postWorkerMessage({
      type: 'PROGRESS',
      stage: p.phase === 'cache' ? 'downloading' : 'downloading',
      progress: p.pct / 100,
      loadedBytes: p.loadedBytes,
      totalBytes: p.totalBytes,
      fromCache: p.fromCache,
    });
  };

  const isNodeEnv = typeof process !== 'undefined' && Boolean(process.versions?.node);
  let modelBytes            ;
  try {
    modelBytes = await loadModelAsset(effectiveModelUrl, cacheStorageName, progressHandler);
  } catch (err) {
    const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (!isNodeEnv && !isOffline && !effectiveModelUrl.startsWith('https://huggingface.co/')) {
      const hfFile = lang === 'sa' ? 'sushrota_sanskrit_ctc_int8.onnx' : `swanada_${lang}_ctc_int8.onnx`;
      const hfFallbackUrl = `https://huggingface.co/gnumanth/swanada/resolve/main/onnx/${hfFile}`;
      modelBytes = await loadModelAsset(hfFallbackUrl, cacheStorageName, progressHandler);
    } else {
      throw err;
    }
  }

  // Evict oldest cached ONNX session before allocating a new 187.5 MB model on mobile / constrained RAM
  const ua = typeof navigator !== 'undefined' ? navigator?.userAgent || '' : '';
  const devMem = typeof navigator !== 'undefined' ? (navigator       )?.deviceMemory || 8 : 8;
  const maxCachedSessions = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || devMem <= 4 ? 1 : 2;
  while (sessionCache.size >= maxCachedSessions) {
    const oldestKey = sessionCache.keys().next().value;
    if (oldestKey === undefined) break;
    const oldEntry = sessionCache.get(oldestKey);
    sessionCache.delete(oldestKey);
    try {
      await oldEntry?.session?.release?.();
    } catch {}
  }

  // 4. Compile Session
  postWorkerMessage({
    type: 'PROGRESS',
    stage: 'compiling',
    progress: 0.95,
    fromCache: false,
  });

  const sessionOptions      = {
    executionProviders: [executionProvider],
    graphOptimizationLevel: 'all',
  };

  try {
    activeSession = await ortInstance.InferenceSession.create(modelBytes, sessionOptions);
  } catch (err) {
    if (executionProvider === 'webgpu') {
      executionProvider = 'wasm';
      sessionOptions.executionProviders = ['wasm'];
      activeSession = await ortInstance.InferenceSession.create(modelBytes, sessionOptions);
    } else {
      throw err;
    }
  }

  // 5. Warmup inference with 100ms synthetic silence
  postWorkerMessage({
    type: 'PROGRESS',
    stage: 'warmup',
    progress: 0.99,
    fromCache: false,
  });

  const warmupPcm = new Float32Array(1600); // 100ms @ 16kHz
  const warmupMel = extractLogMelFeatures(warmupPcm);
  let warmFeats      = null;
  let warmLen      = null;
  let warmOut      = null;
  try {
    warmFeats = new ortInstance.Tensor('float32', warmupMel.features, [1, 80, warmupMel.numFrames]);
    warmLen = new ortInstance.Tensor('int64', BigInt64Array.from([BigInt(warmupMel.numFrames)]), [1]);
    warmOut = await activeSession.run({ audio_signal: warmFeats, length: warmLen });
  } finally {
    warmFeats?.dispose?.();
    warmLen?.dispose?.();
    if (warmOut) {
      for (const t of Object.values(warmOut)) (t       )?.dispose?.();
    }
  }

  // Save to LRU cache
  sessionCache.set(lang, { session: activeSession, vocab: activeVocab });

  const engineAdapter      = {
    config: { language: lang },
    getVocab: () => activeVocab,
    transcribe: async (pcm              ) => {
      return runAcousticInference(pcm);
    },
  };
  streamingSession = new StreamingAcousticEngine(engineAdapter, activeVocab, {
    leftContextSamples: 20480,
    maxBufferSamples: 61440,
    vadSilenceThreshold: 0.005,
  });

  workerState = 'READY';

  postWorkerMessage({
    type: 'READY',
    language: lang,
    executionProvider,
    numThreads: activeThreads,
    fromCache: false,
  });
}

/**
 * Runs feature extraction, acoustic inference, and CTC decoding on audio.
 */
async function runAcousticInference(pcm              )                                                   {
  if (!activeSession) {
    throw new Error('Inference session is not ready.');
  }

  const startMs = performance.now();
  const durationMs = (pcm.length / 16000) * 1000;

  // Silence gate: RMS < 1e-4 (-80 dBFS) bypasses model
  let sumSq = 0;
  for (let i = 0; i < pcm.length; i++) sumSq += pcm[i] * pcm[i];
  const rms = pcm.length > 0 ? Math.sqrt(sumSq / pcm.length) : 0;

  if (rms < 1e-4) {
    const elapsed = performance.now() - startMs;
    const rtf = durationMs > 0 ? elapsed / durationMs : 0;
    return {
      text: '',
      iast: currentLanguage === 'sa' ? '' : undefined,
      language: currentLanguage,
      durationMs,
      inferenceMs: elapsed,
      rtf,
      tokens: [],
    };
  }

  // 0. Multi-Stage Background Noise Cancellation & Speech Enhancement Layer
  let cleanPcm = pcm;
  if (denoiseEnabled) {
    const enhanced = enhanceSpeechWithTelemetry(pcm);
    lastEstimatedSnrDb = enhanced.estimatedSnrDb;
    if (!enhanced.isSpeechLikely) {
      const elapsed = performance.now() - startMs;
      const rtf = durationMs > 0 ? elapsed / durationMs : 0;
      return {
        text: '',
        iast: currentLanguage === 'sa' ? '' : undefined,
        language: currentLanguage,
        durationMs,
        inferenceMs: elapsed,
        rtf,
        tokens: [],
        snrDb: lastEstimatedSnrDb,
      };
    }
    cleanPcm = enhanced.pcm;
  }

  // 1. Analytical Log-Mel Spectrogram Extraction
  const mel = extractLogMelFeatures(cleanPcm);

  // 2. Acoustic Model Inference
  let featsTensor      = null;
  let lenTensor      = null;
  let outputs      = null;

  let logits              ;
  let timeSteps        ;
  let numClasses        ;

  try {
    featsTensor = new ort.Tensor('float32', mel.features, [1, 80, mel.numFrames]);
    lenTensor = new ort.Tensor('int64', BigInt64Array.from([BigInt(mel.numFrames)]), [1]);

    outputs = await activeSession.run({
      audio_signal: featsTensor,
      length: lenTensor,
    });

    const logitsTensor = outputs.logits || Object.values(outputs)[0];
    const dims = logitsTensor.dims;
    timeSteps = dims.length === 3 ? dims[1] : dims[0];
    numClasses = dims.length === 3 ? dims[2] : dims[1];
    logits = new Float32Array(logitsTensor.data);
  } finally {
    featsTensor?.dispose?.();
    lenTensor?.dispose?.();
    if (outputs) {
      for (const t of Object.values(outputs)) (t       )?.dispose?.();
    }
  }

  // 3. CTC Decoding
  const decoded = decodeCTC(logits, [timeSteps, numClasses], activeVocab);
  const elapsedMs = performance.now() - startMs;
  const rtf = durationMs > 0 ? elapsedMs / durationMs : 0;
  const iastText = currentLanguage === 'sa' ? devanagariToIast(decoded.text) : undefined;

  return {
    text: decoded.text,
    iast: iastText,
    language: currentLanguage,
    durationMs,
    inferenceMs: elapsedMs,
    rtf,
    tokens: decoded.tokens,
  };
}

/**
 * Message dispatcher invoked by incoming postMessage events.
 */
async function handleIncomingMessage(msg                )                {
  if (!msg || !msg.type) return;

  try {
    switch (msg.type) {
      case 'INIT': {
        const config = msg.config || {};
        const lang = msg.language || config.language || 'sa';
        executionProvider = msg.executionProvider || config.executionProvider || 'wasm';
        if (msg.cacheName || config.cacheName) {
          cacheStorageName = msg.cacheName || config.cacheName || CACHE_STORAGE_NAME;
        }
        await setupLanguage(
          lang,
          msg.modelUrl || config.modelUrl,
          msg.vocabUrl || config.vocabUrl,
          msg.numThreads || config.numThreads,
          msg.wasmPaths || config.wasmPaths
        );
        break;
      }

      case 'AUDIO_CHUNK':
      case 'PROCESS_CHUNK': {
        if (workerState !== 'READY' && workerState !== 'STREAMING') {
          postWorkerMessage({
            type: 'ERROR',
            message: 'Worker is not ready for audio chunks.',
            fatal: false,
          });
          return;
        }

        if (!streamingSession) {
          postWorkerMessage({
            type: 'ERROR',
            message: 'Streaming session is not initialized.',
            fatal: false,
          });
          return;
        }

        const rawAudio = msg.audio || msg.chunk;
        const chunk = rawAudio
          ? (rawAudio instanceof Float32Array ? rawAudio : new Float32Array(rawAudio))
          : new Float32Array(0);

        workerState = 'STREAMING';

        if (msg.isFinal) {
          if (chunk.length > 0) {
            await streamingSession.push(chunk);
          }
          const finalRes = await streamingSession.finish();
          workerState = 'READY';
          postWorkerMessage({
            type: 'FINAL',
            text: finalRes.text,
            committed: finalRes.text,
            volatile: '',
            iast: currentLanguage === 'sa' ? (finalRes.iast ?? devanagariToIast(finalRes.text)) : undefined,
            language: currentLanguage,
            durationMs: finalRes.durationMs,
            inferenceMs: finalRes.inferenceMs,
            rtf: finalRes.rtf,
            snrDb: lastEstimatedSnrDb,
            tokens: finalRes.tokens,
          });
          streamingSession.reset();
        } else {
          const partial = await streamingSession.push(chunk);
          if (partial) {
            postWorkerMessage({
              type: 'PARTIAL',
              text: partial.text,
              committed: partial.committed,
              volatile: partial.volatile,
              iast: currentLanguage === 'sa' ? devanagariToIast(partial.text) : undefined,
              language: currentLanguage,
              rtf: partial.rtf,
              snrDb: lastEstimatedSnrDb,
              durationMs: partial.durationMs,
              inferenceMs: partial.inferenceMs,
              tokens: partial.tokens,
              chunkIndex: msg.chunkIndex,
            });
          }
        }
        break;
      }

      case 'FINISH': {
        if (workerState !== 'READY' && workerState !== 'STREAMING') {
          postWorkerMessage({
            type: 'ERROR',
            message: 'Worker is not ready.',
            fatal: false,
          });
          return;
        }

        if (!streamingSession) {
          return;
        }

        const finalRes = await streamingSession.finish();
        workerState = 'READY';
        postWorkerMessage({
          type: 'FINAL',
          text: finalRes.text,
          committed: finalRes.text,
          volatile: '',
          iast: currentLanguage === 'sa' ? (finalRes.iast ?? devanagariToIast(finalRes.text)) : undefined,
          language: currentLanguage,
          durationMs: finalRes.durationMs,
          inferenceMs: finalRes.inferenceMs,
          rtf: finalRes.rtf,
          tokens: finalRes.tokens,
        });
        streamingSession.reset();
        break;
      }

      case 'RESET': {
        streamingSession?.reset();
        workerState = 'READY';
        break;
      }

      case 'SET_LANGUAGE': {
        await setupLanguage(msg.language, msg.modelUrl, msg.vocabUrl);
        break;
      }

      case 'SET_DENOISE': {
        denoiseEnabled = Boolean(msg.enabled);
        break;
      }

      default: {
        postWorkerMessage({
          type: 'ERROR',
          message: `Unknown message type: ${(msg       ).type}`,
          fatal: false,
        });
      }
    }
  } catch (err     ) {
    const isFatal = workerState === 'UNINITIALIZED' || workerState === 'INITIALIZING';
    if (isFatal) {
      workerState = 'ERROR';
    }
    postWorkerMessage({
      type: 'ERROR',
      message: err.message || String(err),
      fatal: isFatal,
    });
  }
}

workerReadyToDispatch = true;
for (const m of startupMessageQueue.splice(0)) {
  handleIncomingMessage(m);
}

/**
 * Swanada: In-Browser & Multi-Runtime Multilingual Speech-to-Text.
 * Zero server dependencies. 100% client-side execution via ONNX/WASM.
 */






                                                                  


                                                                  




             
                    
                    
                      
                      
                           

                                                
                                     

                                
                                                                 
                                         
                                                                               
                                      
                             
                           
 

class Swanada {
                  engine                ;
          config               ;

          constructor(engine                , config               ) {
    this.engine = engine;
    this.config = config;
  }

  static async create(config                = {})                   {
    const engine = await AcousticEngine.create(config);
    await engine.warmup();
    return new Swanada(engine, config);
  }

  /**
   * Deterministically transliterates Classical Sanskrit Devanagari text to Roman IAST.
   */
  static transliterateIast(text        )         {
    return transliterateIast(text);
  }

  /**
   * Transcribes audio from Float32Array PCM, ArrayBuffer (WAV), Uint8Array / Buffer (WAV), or string (URL / File path in Node).
   */
  async transcribe(audio                                                  )                               {
    let pcm              ;

    if (audio instanceof Float32Array) {
      pcm = audio;
    } else if (audio instanceof ArrayBuffer) {
      const decoded = await decodeAndResampleBrowser(audio, 16000);
      pcm = decoded;
    } else if (typeof Uint8Array !== 'undefined' && audio instanceof Uint8Array) {
      const parsed = parseWav(audio);
      pcm = resamplePcm(parsed.pcm, parsed.sampleRate, 16000);
    } else if (typeof audio === 'string') {
      if (typeof process !== 'undefined' && process.versions?.node) {
        const fs = await import('node:fs');
        const buf = fs.readFileSync(audio);
        const parsed = parseWav(buf);
        pcm = resamplePcm(parsed.pcm, parsed.sampleRate, 16000);
      } else {
        const res = await fetch(audio);
        const arrayBuf = await res.arrayBuffer();
        pcm = await decodeAndResampleBrowser(arrayBuf, 16000);
      }
    } else {
      throw new TypeError(`Unsupported audio input type: ${typeof audio}`);
    }

    return this.engine.transcribe(pcm);
  }

  /**
   * Warms up the underlying acoustic engine kernels.
   */
  async warmup()                {
    await this.engine.warmup();
  }

  /**
   * Creates a streaming audio transcription session.
   */
  createStream(options                       )                {
    const streamSession = new StreamingAcousticEngine(this.engine, this.engine.getVocab(), options);
    return {
      get audioBuffer()               {
        return streamSession.audioBuffer;
      },
      getBufferLength()         {
        return streamSession.audioBuffer.length;
      },
      async warmup()                {
        return streamSession.warmup();
      },
      async push(chunk              )                                      {
        return streamSession.push(chunk);
      },
      async finish()                               {
        return streamSession.finish();
      },
      on(event                                         , callback          )       {
        streamSession.on(event       , callback       );
      },
    };
  }

  async release()                {
    await this.engine.release();
  }
}

// Re-export all submodules







export {
  parseWav,
  encodeWav,
  resamplePcm,
  decodeAndResampleBrowser,
  N_FFT,
  WIN_LENGTH,
  HOP_LENGTH,
  N_MELS,
  SAMPLE_RATE,
  PREEMPH_COEFF,
  LOG_EPSILON,
  CMVN_FLOOR,
  hzToMel,
  melToHz,
  createMelFilterbank,
  createPaddedHannWindow,
  fft512,
  STATIC_WINDOW,
  STATIC_MEL_FB,
  extractLogMelFeatures,
  enhanceSpeechWithTelemetry,
  denoisePcm16k,
  dedupMarks,
  repairBrahmicOrthography,
  normalizeIndicText,
  assembleText,
  isSpecialToken,
  decodeCTC,
  decodeCTCTokens,
  CTCGreedyDecoder,
  StreamingCTCDecoder,
  StreamingAcousticEngine,
  SwanadaStreamSession,
  SwanadaAudioCapture,
  SwanadaWorkerClient,
  handleIncomingMessage,
  getWorkerState,
  CACHE_STORAGE_NAME,
  IDB_DATABASE_NAME,
  IDB_STORE_NAME,
  isValidOnnxBuffer,
  loadModelAsset,
  getOrt,
  configureWasmEnvironment,
  AcousticEngine,
  LANGUAGE_REGISTRY,
  TokenRegistry,
  detectScript,
  devanagariToIast,
  transliterateIast,
  Swanada,
};
export default Swanada;

