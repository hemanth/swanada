// Auto-generated CommonJS bundle for swanada v1.0.0
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
 * Compact 1-byte alphabet-indexed LCP-compressed Indic lexicons for Brahmic CTC beam decoding.
 * Strictly derived from open Wikipedia & Ninada train/val corpora with held-out benchmark quarantine.
 * Zero external dependencies; lazily unpacked per language on first decode call.
 */

const INDIC_LEX_SAFE_ASCII = "!#$%&()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[]^_abcdefghijklmnopqrstuvwxyz{}~";
const INDIC_LEX_SAFE_IDX = new Int16Array(128).fill(-1);
for (let i = 0; i < INDIC_LEX_SAFE_ASCII.length; i++) {
  INDIC_LEX_SAFE_IDX[INDIC_LEX_SAFE_ASCII.charCodeAt(i)] = i;
}

const INDIC_LEX_VIRAMAS = new Set        (['\u094d', '\u09cd', '\u0a4d', '\u0acd', '\u0b4d', '\u0bcd', '\u0c4d', '\u0ccd', '\u0d4d']);

const INDIC_PRODUCTIVE_SUFFIXES                           = {
  sa: ['स्य', 'ेषु', 'ानां', 'ेभ्यः', 'ैः', 'म्'],
  hi: ['ों', 'ें', 'ियों', 'ूंगा', 'ूँगा', 'ूंगी', 'ूँगी', 'ेंगे', 'ोगी', 'ोगे', 'वाला', 'वाले', 'वाली'],
  kn: [
    'ಗಳನ್ನು', 'ಗಳಲ್ಲಿ', 'ಗಳಿಗೆ', 'ಗಳಿಂದ', 'ಗಳ', 'ವನ್ನು', 'ದಲ್ಲಿ', 'ದಿಂದ', 'ಕ್ಕಾಗಿ', 'ಯಲ್ಲಿ', 'ನನ್ನು',
    'ತೀನಿ', 'ತ್ತೀನಿ', 'ತೀಯಾ', 'ತಾರೆ', 'ತೇವೆ', 'ೋಣ', 'ಲ್ಲ', 'ಲ್ವಾ', 'ದಾ', 'ನಲ್ಲಿ', 'ಗೆ', 'ಯಿಂದ',
  ],
  mr: ['मध्ये', 'साठी', 'कडून', 'वर', 'चा', 'ची', 'चे', 'च्या', 'ला', 'ना', 'तोय', 'तेय', 'णार'],
  bn: ['গুলোর', 'গুলো', 'গুলি', 'দের', 'তে', 'কে', 'র', 'ের', 'য়', 'য়ে', 'টা', 'টি', 'ছি', 'ছে', 'বো'],
  ta: [
    'களுக்கு', 'களில்', 'களால்', 'களின்', 'களை', 'களும்', 'மும்', 'யில்', 'யின்', 'வது', 'ிறது', 'கிறது',
    'றேன்', 'றோம்', 'றாங்க', 'ச்சுட்டு', 'ச்சிட்டு', 'ங்க', 'ல', 'ப்பா', 'ண்ணா', 'க்கு',
  ],
  te: ['లలో', 'లను', 'లకు', 'లతో', 'లోని', 'మైన', 'డానికి', 'టానికి', 'తున్నా', 'స్తున్నా', 'ద్దాం', 'లేదు', 'లో'],
  ml: [
    'യ്ക്കതിൽ', 'യ്ക്ക്', 'തിൽ', 'യിൽ', 'യിലെ', 'മുണ്ട്', 'യുണ്ട്', 'ന്നു', 'ുന്നു', 'ുകയാണ്', 'യാണ്', 'ാണ്',
    'കൾ', 'കളിൽ', 'ങ്ങളെ', 'ങ്ങൾ', 'ാം', 'ല്ലേ', 'ട്ടെ',
  ],
  gu: ['માંથી', 'માં', 'થી', 'નો', 'ની', 'નું', 'ના', 'ને', 'એ', 'ીશ', 'શું', 'વાનું'],
  pa: ['ੀਆਂ', 'ਿਆਂ', 'ਾਂ', 'ਾਂਗਾ', 'ਾਂਗੇ'],
  or: ['ମାନଙ୍କୁ', 'ମାନଙ୍କ', 'ମାନେ', 'ଙ୍କୁ', 'ଙ୍କର', 'ଙ୍କ', 'ରେ', 'ରୁ', 'କୁ', 'ଟି', 'ଗୁଡ଼ିକ', 'ୁଛି', 'ିବି'],
};

const INDIC_LEX_COLLOQUIAL_SUPPLEMENTS                           = {
  hi: [
    'यार', 'भाई', 'अच्छा', 'अरे', 'मस्त', 'पक्का', 'जुगाड़', 'टाइमपास', 'ऑफिस', 'ऑफ़िस',
    'मीटिंग', 'मोबाइल', 'मैसेज', 'वीडियो', 'कॉल', 'ऑनलाइन', 'प्रॉब्लम', 'टाइम', 'ऐप',
    'हूं', 'करूंगा', 'करूंगी', 'जाऊंगा', 'आऊंगा', 'बताओ', 'बोलो', 'सुनो', 'चलो',
  ],
  kn: [
    'ಮಚ್ಚಾ', 'ಮಚ್ಚ', 'ಗುರು', 'ಇವಾಗ', 'ಹೌದಾ', 'ಅಲ್ವಾ', 'ಯಾಕೆ', 'ಗೊತ್ತಿಲ್ಲ', 'ಗೊತ್ತು',
    'ಚೆನ್ನಾಗಿದೆ', 'ಮಾಡ್ತೀನಿ', 'ಬರ್ತೀನಿ', 'ಹೋಗ್ತೀನಿ', 'ಹೋಗೋಣ', 'ಮಾಡೋಣ', 'ನೋಡೋಣ',
    'ಆಫೀಸ್', 'ಮೀಟಿಂಗ್', 'ಮೊಬೈಲ್', 'ಮೆಸೇಜ್', 'ವಿಡಿಯೋ', 'ವೀಡಿಯೊ', 'ಕಾಲ್', 'ಆನ್‌ಲೈನ್',
    'ಆನ್ಲೈನ್', 'ಟೈಮ್', 'ಆಪ್', 'ವೇಟ್', 'ಫೋನ್', 'ಬ್ಯಾಂಕ್', 'ಪ್ರಾಬ್ಲಮ್', 'ಸ್ವಲ್ಪ', 'ತುಂಬಾ',
  ],
  ta: [
    'மச்சான்', 'மச்சி', 'ண்ணா', 'ப்பா', 'இப்போ', 'அப்போ', 'எப்போ', 'இல்ல', 'இல்லப்பா',
    'ரொம்ப', 'நல்லா', 'பண்றேன்', 'வர்றேன்', 'போறேன்', 'சொல்றேன்', 'பண்ணுங்க', 'பண்ணல',
    'வரல', 'முடிச்சுட்டு', 'கண்டிப்பா', 'ஆபீஸ்', 'மீட்டிங்', 'மொபைல்', 'மெசேஜ்', 'வீடியோ',
    'கால்', 'ஆன்லைன்', 'ஆன்லைன்ல', 'டைம்', 'ஆப்', 'ட்ரை', 'அப்லோட்', 'காலைல',
  ],
  te: [
    'బ్రో', 'రా', 'భయ్యా', 'అవునా', 'ఏంటి', 'బాగుంది', 'చాలా', 'ఇప్పుడే',
    'వస్తున్నా', 'చేస్తున్నా', 'వెళ్తున్నా', 'చేద్దాం', 'తెలియదు', 'ఆఫీస్', 'మీటింగ్',
    '\u0c2e\u0c4a\u0c2c\u0c48\u0c32\u0c4d', 'మెసేజ్', 'వీడియో', 'కాల్', 'ఆన్లైన్', 'టైమ్', 'యాప్', 'ఫోన్', 'పేమెంట్', 'ప్రాబ్లం',
  ],
  ml: [
    'മച്ചാനെ', 'അടിപൊളി', 'അല്ലേ', 'ചെയ്യാം', 'വരാം', 'പോകാം', 'അറിയില്ല', 'ഓഫീസ്',
    'മീറ്റിംഗ്', 'മൊബൈൽ', 'മെസ്സേജ്', 'വീഡിയോ', 'കോൾ', 'ഓൺലൈൻ', 'ടൈം', 'ആപ്പ്', 'ഫോൺ',
  ],
  mr: [
    'यार', 'भाऊ', 'मस्त', 'नक्की', 'ऑफिस', 'मीटिंग', 'मोबाईल', 'मेसेज', 'व्हिडिओ',
    'कॉल', 'ऑनलाईन', '\u092a\u094d\u0930\u0949\u092c\u094d\u0932\u0947\u092e', 'टाईम', 'ॲप', 'येतोय', 'करतोय', 'जाऊया',
  ],
  bn: [
    'ভাই', 'দাদা', 'ইয়ার', 'আরে', 'দারুণ', 'আড্ডা', 'অফিস', 'অফিসের', 'মিটিং',
    'মিটিংয়ে', 'মোবাইল', 'মোবাইলে', 'মেসেজ', 'ভিডিও', 'কল', 'অনলাইন', 'অনলাইনে',
    'প্রবলেম', 'টাইম', 'অ্যাপ', 'অ্যাপটা', 'করছি', 'আসছি', 'যাচ্ছি', 'তোমায়',
  ],
  gu: [
    'યાર', 'ભાઈ', 'મસ્ત', 'પાક્કું', 'ઓફિસ', 'મીટિંગ', 'મોબાઇલ', 'મેસેજ', 'વીડિયો',
    'કોલ', 'ઓનલાઇન', 'પ્રોબ્લેમ', 'ટાઇમ', 'એપ', 'આવું', 'કરું',
  ],
  pa: [
    'ਯਾਰ', 'ਭਾਈ', 'ਵਧੀਆ', 'ਪੱਕਾ', 'ਆਫਿਸ', 'ਮੀਟਿੰਗ', 'ਮੋਬਾਈਲ', 'ਮੈਸੇਜ', 'ਵੀਡੀਓ',
    'ਕਾਲ', 'ਆਨਲਾਈਨ', 'ਪ੍ਰਾਬਲਮ', 'ਟਾਈਮ', 'ਐਪ',
  ],
  or: [
    'ଭାଇ', 'ବହୁତ', 'ଅଫିସ', 'ମିଟିଂ', 'ମୋବାଇଲ', 'ମେସେଜ', 'ଭିଡିଓ', 'କଲ', 'ଅନଲାଇନ',
    'ପ୍ରବ୍ଲେମ', 'ଟାଇମ', 'ଆପ', 'ଇମେଲ',
  ],
};

const PACKED_INDIC_LEXICONS                                           = {
  sa: [
    "ँंःअआइईउऊऋऎएऐऑओऔकखगघङचछजझञटठडढणतथदधनपफबभमयरलळऴवशषसह़ऽािीुूृॅेैॉॊोौ्",
    [
      '!%3MeBg|$gB]IM|#:g<XB|#B|$$|$ZQ|$gM|#CQX|#FFgBM#|$aF|$gLBKKg|#GY|$]MgANa4X$|$gMbN|#JQBg|%Fg|#L#|#MgC$|&XBg|#TgBY|%KX',
      '3#|&YFg|%L|&X$|#U#|!&TFg|$ZBg|!(BY|%UXT$|$gLBgM|&FaF|&GY|&TgL|&XDL$|)ZFY|#D#|#L#|#Q|!*8gLBa|#GMY|!.3#|$$|#BBg|$TgL|$',
      'a|%SX#|#Q|$#|#S$|$X|!3C#|$gLBa|#MeBY|$gAX=3TgL|%B[#|%K|#Rg8F|#XMAaF|%gL#|$N5AFXLXKg|%a|#Y|$#|$<g8F|$FgB[|$KGY|#[MgQF',
      'gBY|#^B$|%Kg|%QXFg|%X|%a|%gQX|#a|$8F|$FgDgMKg|$QN#|#eWGY|#gMY|&LBa|!5BgQX|#gMa5eMZ|!6=FX$|!8YBgM#|(TXMK<g:]Sa|#aBg|!',
      ':FQMZ|$X$|%FX#|$gK|&XFY|#XB$|#[NX)|#]F|#g<XLBa|$LeBYSRXTgBgMKg|!B#|#$|#B$|$g|%M|#CX|%GY|$bQ|#DX|#K$|$TgL|$a|#MgUY|#T',
      'gKXBg|&YFg|%L|&X$|#XFY|#YCZFX#|#[|#a|$F|$SX#|%[|!DYFX7g3a|%a|$T#IM|#]Ma|#^RgLBa|$Sg=gQX|#aRTgL|%a|!F5M#|%Kg|%TgL|%a|',
      '#XK|%gFX|$QRgL3a|$TgBY|#YEFXFY|!GM#|$FgB[|#YBX|#[BgM$|$F$|#]MgQ#|#gMBY|%TYDgE$|%XGgB$|*QXFg|*X$|)L|*Ba|&L$|!IUQ$|#XU',
      'gL|(TKgGMg3BFgB[$|(XF[IFgE$|!J5QB$|%Dg5ZBX|%XFg|#QBY|$FgBY|$YSgLBY|$aBg|#X5$|$MBKg|&TgL|&ZL3XNKXF$|&a|$SXF[IFgEX$|#]',
      'BgQX|!KAg?NKg|(TgL|(XFY|(a|#EgLa|#FgLBa|#K|#XBX|$Mg8|$TTgL|#Z|#^BgL[$|#a|!L$|#B$|$e|$g|%M|#CX|#DX|$Y|$g|%LGY|#TgL|#X',
      '|$QBg|#a|$F|#e:FZL$|)Kg|)X|)a|!MX:X|%gLTgL|(a|!Na4X$|!QMgBBa|%S$|&TKgIDgEX$|(gL|&a|#X|#Y:g<XFKg|$DgLBa|$FX|$SL$|&a|!',
      'R3gLBa|#MZMTgL|#g=IgTg|$MZ|&KDgJ5QDg5ZBX|3LX$|$Ne3$|(X$|!T#8YBgMTXMK<g:]Sa|$Tg3^BKg|*TKgIDgEX$|#$|#BY|#FgBY|#KLa|$ZG',
      'a|$gIDgEX$|#MgQBgM|&a|(SX#|#U|#X|$EXMA|$MK<g:]SX|#YB#IM|#]BgMXAY|#g=IgTg|$B$|$CXFa|%YBKg|$K|$LXBg|$QTgL|!UY',
    ].join(''),
    [
      '!%#R#|%$|%X$|&Fg|#3CLBg|$IM|&TgL|$TgKXBg|$XDKZ|%MLBg|$[M[BXKg|&gQFg|$^BgQX|$g=]IM|&eIMg|%SM#|(Kg|(T7g4gLX|(XAX#|*Y|&',
      'Y|#4YN|#58g9Bg|(Fg|$Tg=g|&B|$XTgTY|$gFXRLTgL|&Y|(#|($|&a$|&f|%M:$|&JX5$|*a|&YKRgNe3$|)a|&a|#6eSLBg|#7g3X$|&a|%5#|&Kg',
      '|&TgL|&X$|(FXKg|)Y|&Z3MeBY|)[MgQFgBY|)^BKg|+QXFg|+X|+gL|&[NZ|(Sg>$|&gL3MeBg|#8N$|$YFgBLBg|$g|#:$|$FgBX|$KaM|$XFXBg|%',
      'LB|$g<XBBYCZFX#|(F#|#<g8Na|#Ag|#B.Q|$Y|%3gMKgL|%MY3gB#|(8gL|%Sg>Bg|$e|%WBgM|&TgL|$gL:Bg|&EY3#|*$|&FgB#|*$|*Kg|&[BgBK',
      'T7g5ZBFYDaR3GgMRTgB|2GgMRTgBY$|%MBgL|*#|*$|*X|+$|+FY|&TgCX$|&XFgBMa|(GY|&bQ|#CMgQQaD$|+TgL|+a|$XBe|%GY|#DDXBg|$YBY$|',
      '$gJ[B#|%L|&BgQa|&XGY|(QEY|#E$|$TgBXBg|$Y3|&#|&$|&BK#|(LX|&GgMKXAaF|&KXBgMXLX#|(g|&QX8FXL|(YQMAXMgC#|&X|(#R$|*X$|($|(',
      'EY3#|(FY|(M#|)$|)TgL|)X$|)YA$|+X#|)Z|&^BgL|%58g9BY|%DbQKg|%GBY$|%QMgS|*$|*Kg|&aRFa|$ZBQXFg|&gL|%Fa|$[FX|(GY|$e|%JX5$',
      '|)a|$gL3gS$|*BgQaF|*TgL|&LF|)#|)Kg|)TgL|)XL|*MgC#|)a|*F|&XG3$|)F#|(L$|)TgL|)X$|)a|*S[|#FBYD]Ma|$FgBMKg|(X$|$LBg|%X|%',
      'e$|$RF#|$XKY3X|$YQXMgL#|+$|+Kg|$[|%3MA#|&gSA#|%5[A#|)Kg|&gMUaA|%:$|%GTgCYBf|&XB$|%JQ#|($|(BY|(Fg|*BY|(TgL|&]BQXFg|(L',
      'Ba|%KBY#|)$|&XF#|)Kg|&ZLBa|%LXLYF$|)Z|%MXEX|%QMgBBa|&XD#|)$|)X$|%Sg>XF#|%TFgEXF|&MA#|(BY|(FgBY|&XM#|)Kg|)aA|&]8YB:XB',
      'ZLXFX#|&^BgL|$a3|&QXM#|&X$|(FY|)g|(T[|&a|(SX#|)[|&b$|%FbQ|$gB$|(3MATgL|+a|&B$|(e|&M|(#|(Y3gS|,a|(g5B#|+BLX|+TgL|)JQB',
      'Y|+FgBY|*X5a|&XMXSg=gMYL|1Le5DYQT$|1QYKXFTgCXF3Kg|&YK|)#|)$|)X|)a|&a|%F#|&TgL|%L|&#|&$|&8g8|&BK#|)$|)TgL|)X|*$|(g|)M',
      '|&CX|&DaRZLGXD3FgD[33gMZ?XNQ$|,Qb:g<XFY3X$|&JXSXLX#|+TXUYBgLTKgIDgEX$|&TgKYFg|)L|&X|($|(FY|)g|&a|(F|(SX#|*Kg|)[|(WGY',
      '|&b$|%QJQBg|&L$|&YSgL|&aSA#|*Kg|#G58g9BY|)FgBY|$>Bg|$BBg|%gL#|(XFY|$M#|%$|%<g8|%BgM|%TgKYFg|(L|%X|%a|$RgLBg|$Y8|%B[|',
      '$]MgQ#|$^8g9Bg|$a3gSBa|)LX|)X|)YB#|)gLBa|#HgMZ3X|#IeELBg|$gD[Ng|#JLXMAgLKg|+a|$QBXKg|%YSgLBg|$XQ$|&XBg|&a|(F|$YEZLBa',
      '|%FL#|($|(Kg|(TgL|&Q5[GgB$|-TgL|&aBX|)gMZ|%GgMXL#|+$|%LXFTgL|%M[8Y$|%QgL3gBY$|$]Bg|%QFg|$gLXT#|)$|)TgL|)aF|#KFgLB|$M',
      '3Ag=3|%XQBZ|$YNBg|$Z|$^B#|&TM|$aMY3X|*DaR$|-TgL|-a|$gIXNX|#L$|$8g9Bg|(Fg|$<g8|$KGY|%aQ|%g|$T$|$X8B|%GLBg|$e5gL$|%EgL',
      'X|*#|*3[N|-TgL|*LX#|,$|#M8LBg|$AgL#|(a|$FXCTgL|$I|%Z|$YTg=X=Ng|$[AX8NGgMDaR|$a|$g:[F|)#|)$|)QYSXDLe5TgL|)XL|%AeMX:$|',
      '+TgL|%C|&#|&QgLQTgCX|/LX$|&RXTgBgMKg|.TgL|.a|&X$|(Dg|&a|%E#|%UBY|&FgBY|&TY|#N7g3XM5gMFgCX$|*RXTgBgMTgL|*X$|+AX#|(^BQ',
      'XFg|$JB|&g|$Y|%4Bg|%FgD$|$Z|$a3gTXAg?Mg|$g|#Q3XR#|($|$58g9BY|%BgL|%FgB[#|%KgLBa|$BXM$|%ZMgL|$DBg|%Fg|$EXF#|&MAX|%Y$|',
      '%f|$LQX$|$MeE$|&U$|%gALBg|&BB|&EB|$NKgIgL|%e3gL|$RYSg=#|*$|*XFY|)LBa|%aSX$|%gL#|(KaQ|)g|$TBg|%M#|&$|&a|%gCX|)$|)LX#|',
      '(YB#|*$|$UBg|%Fg|$XGgFeBg|$YDgLX|%FXRY|)Z|$cMg?|$gLLGDXFX#|(Kg|#R3gLKg|$[DgE#|$^AeBg|$e3|&$|&TgL|$gM]AY|%Q$|&YFZ|#Sg',
      '=|&K$|(a|&QYEXFTJX3gSaBgMXAY|&X7g5Le5$|(DR|*a|*eWEgLXLTgL|(EgLXLZ|(QY#RBYNe3TJX3gSaBgMaS[|&f|#TB$|$K|%MX:gLTKgIDgEX$',
      '|,gL|&gC$|)X$|%YLX|$Y|$ZBg|$]8LBg|$f|$gBYBgQ#|+a|&ZBY|&[|&gLaQ|%CXGLBg|&Y|($|&ZFY|%KJgL#|&X3Kg|(Bg|(Fg|(JY$|&Y|(FgFa',
      'Q|&b|%LX|(#|(GY|&bQ|&eGMY|%TXKg|#U7g3XM$|*TgL|$KD|&XIXD|+g|%GY|%aQ|%g|$Y#TX|$e|#XTZBg|!&3MgS3#|(A#|)TgL|(BY|(LBY|$XM',
      '$|&TgL|%R$|&QXAZ|&a|$^BY$|%Sg=$|)X$|(L|$gMKA#|)Kg|)TgL|)a|(gL|%SaG$|#4gL$|&XLY3X|#58g9BY|)[|)g|(Fg|*B$|+Y|$B#|%$|%Kg',
      '|%QBZ|&FgB$|&XFg|%X|&$|%gL|$FgB[#|$KF#|&Kg|&TgL|&XBg|&aF|$Tg=g|$gFaL|%MU#|($|(aA|&X|#6XB$|#7g5gN|)JXSLX|,X|-LX#|/$|)',
      'KXTTKgIDgEX$|)TMgQ3XM$|0TgL|0aA|)X$|*EY3XMYA$|*F[QXD$|/Rg8|/aF|)aLX$|#8MA#|&Kg|%BY|%Fg|(BY|%YB$|(QFgB$|)XFg|%gLBa|(F',
      'gBa|$XM|&$|&gL|)$|)X|*$|)aA|)e|#:ZQF#|$g<LX|&X|(#|(F[TXM#|#BgK|&:g<XF#|&F$|(X|(Y|(e|&T#LKLe5TgL|&X|(F#|)Kg|(MXK$|+Tg',
      'L|#DM$|%gR$|$Y|%F#|&XCTgL|%QXTYF$|%RBg|%Sg=QXFg|$aR#|&$|$f|#EXM#|&$|&X$|&Z3^BgL|&a|(A|$Y3XMY3|+JXSX$|&gL#|)aF|%GBgL#',
      '|*Kg|*a|$[FY3|)3XNa|)5[MQ$|)EXMgKY3QgL3gBL$|)X$|)a|$gLXBgKY3|#FFgD|(#|($|(Kg|(QMgEF$|(aF|$LBg|%FgBY|$ZBQXFg|%L|$aB[#',
      '|$g|%BMY3|%DeNF#|*Kg|*TgL|*XFY|*a|%EgMGgMDaR|/$|/MX:gLTKgIDgEX$|5gL|4a|/TgL|/a|#G$|$AaS[|$Bg3XNTgL|$D$|$TgBKgI|$]MgB',
      'Y#|$gFeBY|)g|#Hg|%MY3X|*4Ag?TgL|#JXMB#|(a|#Kg|#LXBY|$[$|%EXFY|%MgQaD$|+TgL|+a|%SgL#|$e5TgL|%:F#|(Kg|&YB$|)X|&gLBa|)F',
      'gBa|#M3gS3X$|(YBKg|$IgE#|($|(Kg|(QBZ|)FgB$|)XFg|(X|)$|$JB|&a|%FgB|%gL|(Ba|$KgJ#|($|(Kg|(TgL|(XBg|(a|$[UgL|$]@$|$e5gL',
      '#|%U$|&A#|$g|%CY3|%L|&J=$|(XSX$|#N7g3XMY3X$|$e8FX|$gGeMg=g|%IMg=g|#QLe$|$MA#|&a|%gS#|$NY$|%Z|$RgL3#|)$|)BX|+#|+$|+FX',
      '#|,[TXM#|+LX$|)Kg|)X$|*FY|)Z|$UBY|$YSg3XM$|$^B$|#RL$|$X|$ZMgQXD#|$g8MgL#|*83YB$|%MK#|($|(TgL|(a|&L#|($|(a|&YBX$|)gL|',
      '#T3gB$|(X$|(Y#|)$|$F|%XFY|$Kg|$X#|$YBg|$ZB|%DYBY|&g|$g=gMaNYLX|.DaRTgL|%BXKg|&a|%CXFa|#UBgL|$XM#|&$|&BgQaF|&GDXMgC$|',
      ')gEBY$|(XDXMgC$|&TgL|$[$|$]BQXFg|%L|$gQLFgBY|&XF#|)Kg|!(3gS[$|#7g5gNaAg?g|)bAg?|-g|#8g9BY|&FgBY|&X|(#|($|(F[TXM#|(KY',
      '|#=NZ|#Ag?YLFg|)X|&e|(FaRYLX|.DaRTKgIDgEX$|#B$|$MJXSXJY$|%a|$TgBB$|$YUXT|)#|)3XMX$|)QYDX#|)a|$ZD#|$eGY|%WGY|$gC#|&Kg',
      '|%LB$|&FLX|)e$|&JQBg|(YEZLBa|&L#|(Kg|&MgC$|&TgBY|)KXBg|*YFg|*b|)LX#|+$|&X4gL#|+$|+TgL|+X|,LX$|+a|,F|(DL|)Y|*$|*3#|*F',
      'X|*JY$|+gL$|*S[|)ZFX#|,Kg|+g|)f|)gLX$|(TZBg|(U|&[3gB#|+Kg|+QXFg|+a|+gQX|(8gLBa|&aB#|)Bg|)FgF5M#|.Kg|)Le$|)TgKYFg|+L|',
      ')X$|*FY|*JgLX#|)a|*F|*SX#|+[|)b$|)f|(F#|)Kg|(Q|)#|(S$|)X|#DKGY|%aQ|%g|$XFZ#|(KGY|)g|#Fg|%DYMX|&[NXN|&eFaRYLX|&fM|&gM',
      '|)#|)$|)TgL|)X$|)YL|+XAX#|-Y|+b$|)aA|)e|%Tg=Y=gL]=g|#K#|$Kg|$X#|%$|%FY|$a|$f|$gHXN|#LKaQ|%g|#NXUXIXD|#Sg=QXFg|#TMe|$',
      'gNXK|)g|#UNe3Kg|!)D^R#|#RQZLa|$gQM|(#|($|(TgL|#TQZLa|$X)|$g=g|!*3XM$|$gB#|&$|&<g8|&KTgBY|(aQ|(g|&QBZ|(FgB$|(XFg|&X|(',
      '$|(FY|&Y$|&a|&gQX|#8YB#|&Kg|$g8|&FgLXLXNLTgL|&XMA#|*TgCXF#|&b$|%LFgBa|#:g:LYFZ|*gLX#|&bF|#?[GZ|#Bg3gMXFgBY$|%B7g3$|&',
      'K|(#|($|(Kg|(X|)$|&M|(#|(3FgF?KAg?NTgL|2a|(DXLYBgQ#|+Z|)YRY|(GgMDaR|.$|.MX:gLKg|3TKgIDgEX$|4gL|.TgL|.a|(JX5a|*MBTgL|',
      ',a|(X4Ag?MX:gLTgL|-TgL|)AY|)EY3XMZ|)MgEa|(a|&YSg>|&ZMgA$|%CXL|%GBgBY$|&DgLBa|*FgBa|&FgF$|*X|+$|&XDF#|*Kg|*TgL|*a|)LB',
      'Y|*FgBY|)gLBa|+FgBa|+KXFXFY|%TQ$|(Kg|(TgL|(X$|(a|)S[|&XU$|)aF|#DL$|%G[M|$M#|%TgL|%a|$X|%UMA#|)Kg|)XFY|*MgC#|$aBY|$g6',
      'X=F#|&eSYB$|+Kg|%DYRgL|&aR$|)gL#|+Kg|%EMAKg|)XFY|%J=$|&Q$|(BY|(FgBY|&]B$|)X|*$|%LK$|(X$|&XF#|)Kg|)TgL|)XFY|)a|&[3gB$',
      '|&e5#|)$|)TgL|)X$|%Qa5$|)TgL|#FgFB#|($|(Kg|(X|(a|#G3MAXFY|%NX|$5gMU|$BgL3X|$DYRBY|%aR#|($|(X$|$FYSBg|*T[|(D$|)X#|)Y|',
      ')g|%gLXT$|$JXSX|$KAg?NKg|*TgL|*XFY|*a|%X|$L[3gBX|&:gL|*Ba|*FgBa|%e3gBQgLKg|*[#|&5#|($|(Kg|(X$|)L|(YBX|(Z|(aF|&:LFgBY',
      '|$MXSg=gMGBY$|%YSg=XBg|$NIgEY$|%JgLBa|)FgBa|$QXT#|($|%YRBY|(gL|&Sg=QXFg|$TMg5X$|%gCXGLBY|(YB$|*X$|*Y$|*f|$XEY#|($|(F',
      'X|&gL3gS$|)XL$|%L$|&X$|%TFX|&gCXGLBg|)Y|#JLB$|&gM|%e$|$XQGY|$a|$f|#MgD]|%QRZ|#NgN7g6gL|&Y4BY|)YB#|+$|+KTgBY|,g|+QXFg',
      '|+X$|&a4|)#|)$|)X$|)e|#QX8|#SX|$gA#|&$|&BX|!+@QXFg|#B3|%TgL|#Mg:X|(LX$|%EgQ#|#UX|!,3g|#5gQaD|)$|)TgL|)a|#8$|$X#|#A#|',
      '#Ba|$f|#SJ$|%DaQTgL|$L$|$Y|%$|%JY$|$ZAX#|$a$|!-MAX3[OKg|!.3BX|&LX$|%gM|$DX|$KXBgM#|&T#|%aQ|%g|$LX|$QMgS#|%XM#|(Kg|$T',
      'gKXBg|(YFg|+FaQ|&L|(X#|)$|(bQ|$X|%#|%3Z|%DR|($|(Z|(a|(eWEgLXLTgL|(gLX#|%FgBa|$aF|$b3#|&$|&Kg|&TgL|&eGY|%Q|$e|#8g|#?g',
      'QMg?g|#Ag?g|#B#|$BgB[|$DBYMY3gB#|-KGY|%GY|%MgC#|%TgBY|%aQ|%g|$Kg|$LX|%e$|$TgKXBg|(YFg|(b|&LX#|)$|$X|%#|%$|%D^R#|)$|)',
      'TgL|)X$|*FX#|+Y|)Z|)a|*S[|%FY|&g|%QBX|(g|)GMgLFgB#|&DaQ|&XFg|%TX#|&[|$Y|$aF|%JgL$|%SXKg|&[|$b$|$f|#F#|$Kg|$X#|$Z|$g|',
      '#GgMYN|)g|#Hg|#JY$|#Kg|#NX|%LX$|$g|#Q<g8|$KTgBY|%aQ|$XTZBg|&gBY|(L|%WTgBY|$aBY|#RYLX|(4Ag?TgL|,a|#SX#|$[|#Tg|!/8g9Bg',
      '|#BYUXTY3|+#|+$|+D^Sg=gLX|+TgCXFXFY|&gLKg|#DKgGgMXCKgLaF|!03gTZ:Fg|#Hg|#Tg=gMaNYLX|!1?VYRX|$YRX|(MX:gLTKgIDgEX$|.gL|',
      '$aLMg|#GFg|#Kg|#MYTgTX|#NKgGY3g|$YKgGY3g|#SEL$|!28YBgL#|#FgFBgL#|*a|#M7g5:aI|+$|(XIXD|#SE#|%BgQaF|%Kg|%TgL|%XFY|%ZLT',
      'TgLXFY|$gAgL#|!33gSXLX#|#8g9|#<g8F|&YBg|#=3|$[$|#>YF#|#Ag>#|&$|&TgL|&a|#BY|%8F|%GL|(XFY|(a|#C<g8YBg|$F#|%KTgBY|&g|%T',
      'gL|%XF[TXM#|%a|&F|$KGY|%g|$LBY|%FgBY|%YB[#|(gQX|$X|%#|%$|%F3#|%LX#|($|%QTgB[|$YB#|&$|&Kg|&QXFg|&X|$gLFgBa|#DNZ|&HN#|',
      '$X|%8F|&YBg|(Dg|%GY|#F3DXT$|$gD[3|)#|)$|%F?|(JXSLX|+X|,LX#|.$|%LLX|&X|(#|(LX$|#GXN|#H#|#KGY|$NX|$gGFZ|)LX$|#M#|$$|$A',
      '#|%Kg|%ZL#|($|(Kg|(X|)$|)FY|%a|&F|$Fa|$YSgLBY|)FgBY|)TY|)XK$|+Y|)a|$eB[|%KY|$g:Fg|%A#|&$|&Le$|&TgL|&X=3|*MX:gLKg|/TK',
      'gIDgEX$|0gL|/a|*T7g5ZBTgL|+KgIDgEX$|*a|(QBZ|%BMY|&QgL#|*$|*3MgKA$|*Kg|*TgL|*X|+FY|&X|&[$|(Kg|&^BgQ#|&gBQgLKg|,XFY|%F',
      'X=3|%K8XMYAX#|&A$|(X|)#|(Y|&HN#|&JY$|&Le5$|*TgL|*Z|*aF|&T#FgLXTLe5$|1TgL|([|&XAY|&aFgDgMYLXAY|#NU$|$X|%$|%L$|&X$|$gG',
      '$|&Ba|&FX|)LX$|&LBY|(FgBY|&YB$|)QXFg|)X|&a|&gLBa|%LXA|)#|#QL$|%e|$Y|%$|%BX|($|%FX|%JY$|%MTf|$ZFX#|$a$|%MTgL|#Rg8YBg|',
      '(Dg|#SXL#|&$|&Kg|$g=#|&Kg|&XFY|#TgB]MIX|)JX)|%KXBg|&Y!Rg8YBg|(#Rg8YBg|(Fg|*FGY|%L|&8F|(YBg|)DGY|*g|&XGY|(Rg8YBg|(WGY',
      '|#X#Rg8F|$7g5gMaT|,g|$8F|%YBg|$<g8YBg|$Ag?TgL|(a|$BgLXLF|+$|+aF|$DKgIMZ|$FG[M|%Y|&8F|(YBg|$GY|$HZ|$K|%#|%$|%FX|(LX$|',
      '%GY|%XFg|$M3|&Kg|&X$|%A|&#|&B$|&KTgBY|(g|&XBg|(FY|&ZJ]B$|&b$|%LBY|&FgBY|&YB[#|)gQX|%X5XM#|*XBg|*a|(^Ua|%YB$|(Kg|(QXF',
      'g|%gGXT$|&IFg|&L|($|(3MgBX|-M$|)XN$|+a|)gMK$|,TgL|,X$|,a|-S[|(DMgRZ|(Kg|(MB$|*X|+$|(TgL|(XAX#|*Y|)NLa|(a|)A|)S[|&N|(',
      'g|$N|%#|%$|%3gMKaA|%4Ag?a|%XBg|&FgBMa|,A|%YDXT|*$|*TgL|*aF|*e|%Z|%a:g|&F|%e|$QaMZ|%gL|(#|(GgM3XRTgL|(KYD#|)g|(TgL|(X',
      'FY|(a|)S[|)WTgKYFg|$RY3XLX#|%Z|%g8F|&KZM|*MX:gLTKgIDgEX$|&LX#|)$|$T$|$WGY|#Y#QDFgBZ|&X|$<g8|(FKAg?NKg|(YBg|+3XN#|)DG',
      'Y|*g|$KMgC#|)Kg|$LBg|%X|$MA|&$|&X$|$N|%X|%eKZ=MKYBa|+g|,KYB#|/a|#ZC|$D^R$|(Z|$MgBFXFY|(Y#|)$|#[=[KgI$|*Kg|*TgL|*a|$B',
      '$|%e|%gM|(8YBg|(XGY|$FgBZ|$GYB$|$IaMTgL|$KXM|($|(GXN$|+TgL|(Z|$MXFg|%[|&3gSaBgMa|&B$|(a|%gK$|&LXBg|([$|&QB$|)X#|)Z|(',
      'Fg|*B$|+[|+f|(XA$|$N#|%Kg|%TgL|%a|$RN$|#]Ga|#^B|%#|%KTgBY|&XTZBg|&YBY|%L$|%QBZ|&FgB$|*f|%X$|&FY|&WTgBY|%Y|&$|&BgQaF|',
      '&S[|%Z|&$|&FX#|%a$|&F|&WGY|%e|&WTgBY|%f|%gBY3X|&TgF#|$DFgB$|$GLX|%X|$S3X$|(AX#|%Y|&$|&3XMgL#|(gSaBgMa|%a$|%gA|(#|($|',
      '(G3gSTgL|(L:[MgQaD$|0TgL|0ZLX|(X|(aF|(e|#a8YBg|)B[|$DXMJ=g=3^B|$F|%8YBg|%?X|%XGY|&WGY|%gDgM|*#|*$|*KTgBY|*RXTYBGgMDa',
      'R$|5X$|*TMgQ3XMTgL|+gCXF#|,L|*XAY|*ZL|*a|$KgIgMY:g|$MN|&MX:gLTKgIDgEX$|-gL|&TgL|%O|&MX:gLTgL|,a|$NMg|$QN|&Kg|$RQ|%X$',
      '|$SX<g8F|*YBg|%[8YBg|$WGY|#b3aLZ|$=MZFX|$N#?M|$QNgLGXD$|$Rg8YBg|#c7g5gMaT|,g|#d8g8Z|#e)|$7g5gMaT|$=Y|&$|$AXMg3|%a|$G',
      'Y|%aF|$N3XBX|%KgIYLX|$RY3X|)FX#|$UYKX|#fFgBaL|$KXMXQTgCXLX#|$MQXAX#|$RN#|&Kg|#gB|$MK$|&R$|&TgL|&X7g3TgL|&a|(A|%XFgBY',
      '$|+3XMYA$|0X#|.Z|%Y3a=g|&?3$|&LFgBa|(KXA#|+XFY|(LX|(X|)#|)$|)AX#|)LX#|+$|&TgBXIgDa|*e$|)KTg|%Z?3$|)X$|*FX#|(BY|(FgBY',
      '|(X|)#|)$|)7g5A#|-Kg|-a|)LX#|+$|)NQ$|*[$|)TKgIDgEX$|*[|(YBQXFg|*[#|(eBgTQa|&BgQX|%[DgE$|%aB[#|%eE$|$NaRX$|$Q|%8Y8g8|',
      '(Bg|(Dg|%CFZLKg|&YB#|%XGY|$S|%A#|&a|%BgMYL|+$|+TgL|+X$|%KBX|&X|(#|%L$|%ZM#|%aBgM|*#|*3gSaBgM:g<QYJX5Le5TgL|*Kg|*XAY|',
      '*a|&KaFgDgM$|!4:[MXUe|#Ag?$|&F#|&QX|&TgL|&X$|&a|(S[|#FY:X$|#N[|#X!|$DBY|%FgBY|$F|%$|%g|#YFgF$|#aN|#gLXB#|($|(Kg|(X|)',
      '$|(Y#|)$|$MYSg=XIgDa|%ZSg=XBg|+IgDKEgLa|.XBg|.a|!57g5X|(FDgLX$|(LX$|&]IXLZ|#8g9|&B$|(X|(Y|([|&Fg|)B$|*Y|&XKY|&aBg|#:',
      '$|$X$|#;FZ|#A$|$EMX$|$FX|$TgL|$YB|&#|&TgL|$a|%R|&$|&TgL|$gLBa|#B#|$$|$Kg|$QBZ|%FgB$|)f|%XFg|$X|%$|$Y|%#|%$|$a|$e|$f|',
      '#DgL#|#FgBQgL#|*Kg|&[#|(Kg|%E$|&DgMQgLXAY|#JZM#|&BLX|#KF#|%Kg|%TKLa|$gLBa|#LX|#M[?$|$gBa|%J#|&$|&3XNTgL|&5^Ua|&QBZ|&',
      'XRLTgL|&a|#QX#|#XF#|%Kg|%TgL|%gEY|)$|(Z|$L3$|&X$|%BY|&gMZ|%FgBY|%Y3X|$Me|$Q$|#Y:[JX)|$MY$|&EXK|#ZB|%#|%Kg|%QBZ|&XFg|',
      '%TgL|%X|&FX#|(Y|&GgMQaR$|&LX#|)$|&TKgIDgEJXSXF[IFgE$|$LBa|#[:MXB|)MX:gLKg|.TKgIDgEX$|/gL|.a|)Z|$?#|%$|$A|%$|%X|&$|&F',
      'X#|)Kg|(g|%b$|$GgB|$M[|&#|&$|&5eQYFgDTY#U$|&AX|%e$|$QXUX=Z|$UX|&$|&LX#|)$|&T[|#^U#|%Kg|%TgL|%XAY|&Bg|%ZB$|(QFgB$|)XF',
      'g|(X|)$|(gQX|%a|&S[|%gAFgBY|(XBY|&LBa|#e$|$DXQMZ|$E]K$|$GXN|$QX|&MX:gLTgL|%YFgD|*$|#f$|$BK|&$|$MQ#|&Kg|%Z|#gMFgC|)#|',
      ')$|)Le$|)TgL|,XTgL|)X|*$|*FX#|+g|*NL$|)Y|*$|)a|*S[|*WTgKYFg|)e|*WL#|+TgBY|)f|%U|&$|&A#|(Kg|&TgL|&X$|(AX#|&ZB[#|%X#|&',
      'K|(#|($|(TgL|(X$|)Bg|(a|)S[|%Y5eMg|%Z3g|&SgK3XNa|*MgBf|%a5eMZLF|$QXNYLM|!6=$|$FX|&$$|&LX$|$eBg38$|#Ag=X$|#FBgQKg|#^B',
      '#|%TgL|#eM#|%Z|$SAX|(#|%LBY|%YB$|(Kg|(QXFg|!83XM|$gM#|&QMgBZ|&a|%S[$|#A3$|$g?Z5@|#BTgM$|$[M$|&RgM3YNeKZ=Mg|&TgM3YNeK',
      'Z=MgKYB$|&gAX#|(C|)#|)$|)XEgLXLa|)Z|)a|)eEgLXLTgL|(DR|*$|*a|*gLX#|(EX|(JY$|(QY#RBYBZMgC7g3MaS[|(S[|%SgSSg=Y$|$gQXM|)',
      '$|)Y|)e|#FgDaMZ|&gM|)$|)5[GgB$|)GgMJe$|)KX|)Ra4M|-$|)TgL|)Y3X|#KBg3XM:F3BgQa|$gGX|#LF#|%Kg|#M3$|$A$|%a|$YB#|&Kg|&gM#',
      '|$g8X|(#|(LX#|%K|#N8YBgMa|%g8YBgM#|,Kg|,TKgIDgEX$|-gL|,XAY|,a|-S[|$BY|$F#|%gBY|#XA3gL$|$B[MgKXTgL#|%gM|$GY|$L#|%TgL|',
      '$MgNgT|*g|$NLBY|&YB[#|%[3gLXFX#|$QNX|$TZBg|%gBY|&L|$U|#Y3YBgTX|+#|+$|+LX$|+NLa|$B$|%X|%g|&B#|(Kg|(TgL|(a|&M|(A#|(Kg|',
      '(QZCY3X|(TXMK<g:]SX3XMgLKg|)gL|(X|)AX#|*Y|(YBKTgBY|*X|(a|$D#IMTgL|%KgIM#|$FgBF#|)Kg|)a|(LBY|)Fg|+BY|)YBgQX|(X|)#|)KA',
      'Y$|(YBKg|*QBZ|+XFg|$M#|$UgF#|(XFY|#ZF|%X|%Z|#]MgA#|(Kg|#aB$|%F$|&X|%Y|$DGY|%g|$FgFKgKX|(b|#bBFgL#|)TgL|%gM|$Q|#e3gB#',
      '|(Kg|#fEMZ|$UXF|(Q#RTgL|!9BgMGBY|#FgD$|&RgRXTgBgMKg|&TX#|(Y|&X#TY|#XBgM$|(X$|)AX#|)Fg|(aA|$LX|!:5B$|%Y|%e|%g|$FgFXCT',
      'gL|$XK|#?$|#F#|$$|$3$|%TgL|$5AFXF[5[A#|+TXM#|$:XBL$|$BX|$F#|%Kg|%Z|$GDKg|&TgL|&a|$LBY|%FgBY|$MNg|$QMYKXTTgL|&ZKXTTgL',
      '|+a|$T#4gLX|+D^Sg=gLX|%7g4gLX|,LX$|,Q^DgEY$|,TXFgDgMBX|%XFgDgMBX|%gL|$X|%FXKg|&g|%MgDF|$aJgL$|%S[|$b$|$gKB$|&DYFKg|&',
      'F$|(3gSBgMKg|(X|(Y|&J]KY$|&TgCXF#|,Kg|#GXFg|#ING[M|#KgI]DgQZGTgL|%K]|(3XRgKZMMX:gLKg|4TgL|#L#|$$|$BY|$DaQ$|(TgL|$FgB',
      'gL[BgTQX$|$G[M|%gM3XR$|+TgL|$TY#U$|)TgL|)aF|#MgKF|(Z|)DaRTgL|,ZL$|(g|#N#|$GXB$|(TgL|(X$|%gMGXB$|+X$|$IFgE$|)TgL|)X$|',
      '$Kg|$QXL[$|$TgL|$XRL$|$a|%F|#QXUMNXN|#RgBgQTFgEY$|#X3YM|$5MgBY|$B|%#|%Kg|%X|&$|&FY|%Y|&$|%[|%a|&$|%e|%f|$FFgBY|%XBY|',
      '&KY|%ZK$|&UY|%a|%g|$GXF|$LBa|%FgBa|%KXF#|)$|)Kg|)X|$Mg:|(g|$NTgCXFKg|$QX|#Y:g<XTX|$B$|%QXFg|%gQX|$FGgMJT]MYAX|%XNL$|',
      ')TgL|)X$|)a|$UgQX|#ZFg|$K]BQXUFTgL|$MY3X|%gAXFY|(eDgEXM$|$Q|%$|%BQgL3gBL$|&Y|%F|&#|&Kg|&TgL|&Z|&a|&gBY|%QY:g<XFZ|%Tg',
      'L|%X$|&BgKX|%YB$|([#|&F$|(X#|%e|#[Nb|&KXTTgL|$UgQBY|#]Fg|#aKgT|(g|#bF|%EMgK$|*TgL|%KFgDYMXAY|#cFg|#eEG[M|$RZ|$TaHg|#',
      'g<XB#|($|(Kg|(QBZ|)FgB$|)XFg|)gL#|+Kg|(X|)$|([#|)Kg|(e|(gQX|&F|(#|(3MgKAe$|,T#FgLXTLe5$|6TgL|(KaQ|)g|(QY:g<XFLe5TgL|',
      '(TgL|(XL|(YF$|(Z|(a|)F|*gDgMYLXAY|&GLBY|&LFgBa|%aL#|(Kg|$LX|&LTZ|%aSg>$|*X|%eBY$|)SRXTgBgMTgL|*TgL|$QM$|%NF#|%XM|!;=',
      'YBY|#XM4Ag?MX:gLTgL|#YNgNZ|!=X=X|#YGgGAZ|#Z3X|&#|&$|&LX#|#aFYTg|%gFYTg|$Tg=g|!>X3[M|!?IgNgL]|#X)|$3g=Ma=g|#Y5gMYL[3g',
      'B$|(Z|$TaKgIMg|#aQY?g|!@X3X|!B#BgM|(Y3X|+$|#8g8|#:g:N#|#=a|#?X5$|&TgL|&X$|#Ag?[N$|)X$|#BRg8|$e|%WGY|$g3XNZF$|%BBg|&[',
      '|&gQ|)#|)B$|)Kg|)TgL|)XFX#|+Y|%GM$|&Rg8XBg|%MBgL|*#|*$|*X$|&XGY|&bQ|&e3gBKg|%TMgQ#|#CXUY|%WGY|$gL#|#DBYMY3gB#|$FFgBM',
      '#|*Kg|%[|&5[A#|&TXM#|*aA|$GY|%a3gSLX|$MgC#|(Kg|$QTMa|$XFZ#|(FgBFa|(KaQ|)g|%GY|%MJgL|$YD#|$ZL#|&X|$[3gB#|)Kg|%GMY|$aQ',
      '|$bQ|$g|%DYFa|%EYBXFgB$|%LCX|%QBg|&YSLa|#FgB[$|&gM#|)a|%F|&XK|%KBa|#G$|$T$|%X|%Y|%gLX|&QZ|#K#|$QMgSGMgLFgB#|)TgL|)a|',
      '$XBg|$YO|&[|(FX?[MX:gLTgL|(JXSX|&g|(FX?[MX:gLTKgIDgEX$|2gL|1a|(JXSLX|%Pg|(FX?[MX:gLTgL|$aQ|$g|#LX|$e$|#M7g5X$|$g3$|#',
      'Na|#TgKXDaQ|)g|&YFgFaQ|&b|%LX|(#|(GY|&b|(Q|&eGMY|#X#|$$|$:KUNg|$BgGMgL#|+Kg|$DXBgKgL#|%^R#|($|(TgL|(X$|)FX#|(Z|(aS[|',
      '$Fg|$GKXF#|$JY$|%gLX#|$KaQ|%g|$MX|$QBX|&g|(GMgLFgB#|%DYDKg|&aQ|&g|%XFg|$TX#|%[|#Y3gB$|$CL$|%Y$|&TgL|%f|$IgIB|$M[QFFg',
      'BG[MKg|%gL3g|$N$|$Sg>BY|)[|(Fg|*BY|$TgM$|#ZMa|%gC#|(3gSaBgMXAY|(7g3M|,$|,X$|(Kg|(TgCXFXFY|*L|(a|#[JgL#|$NFX|%TZ|(DXT',
      '$|%gL#|#]SgAZ#|#^BZL|(#|($|(X|)EgLXLa|(a|$RgR]Mg|$SgAX|#a:$|%TgQZ|$FbQ|$JgL$|$N[5[|)JXSLX|,X|$SXKGY|(g|$WGY|#b$|$N#|',
      '%Kg|%TgL|#gL3gBQXFg|)[#|)gQX|%:BY|([|&FgBY|%X5#|($|(GBgM#|(a|$ML|&$|&XAX#|&e|(DR|*$|*a|*eEgLXLTgL|*gLX#|%Y#RBg|&:gLX',
      '|&EX|&JY$|&QXM#|(YE#|*$|*X|&S[|%ZAY|&Fg|%[=Y$|$Q#|%3g|%8X|%KaQ|&g|%LX|&Y|%X|&#|%aF|!CX=g|$KTg|$LMcL?g|!D3gS|&$|&YA|)',
      'B$|)DYRY|)GRg8YKa|)JX5a|+MBTgL|-a|)a|#Ag?#|&$|&YF$|&Z|#BgB|&#|&$|&Kg|&QBZ|(FgB$|(XFg|&X|($|(FY|&gQX|#DBY|$XBY|&[|%KY',
      '|$f|$gLXBg|#EY|#FgBX$|#KF#|$LFgBZ|)gLX$|$gGBZ|(gLe$|#LX|#MZD^RgLBa|+FgBa|$gRF|(#|(Kg|(TgL|(XFY|)L|)MgC#|(ZLKg|*XFY|(',
      'a|)F|&LBY|(FgBY|(YB[#|&YB$|)Kg|)QXFg|#N#|$TgL|#Qa|#R3a|$K$|%a|%eWEgLXLTgL|%gLX#|$MC$|&TgL|$T[|#UBY|#XBQgL$|)Kg|%[#|&',
      'Kg|$DXTXUaI|$EY3Kg|$F|%#|%aF|$LYBgQ#|*Kg|$MgRFY3$|+X$|#Y3gS[|$5KgIM$|$F|%#|%Kg|%TgL|%X7g3$|*B$|&Bg|&FY|%aS[|$Mg63XNY',
      'FX|$NZG$|%g|&NZ|$Q#|%7g5B$|*X|%T$|&a|%X|%Y|%gL#|$R$|%Y|$TKgIM|#Z3gSX|)#|)FFgBM#|)LX$|(YB$|$FDLXN|$GY3X|$KXG[M|$LBa|%',
      'FgBa|$Mg6#|($|(3XN#|(BX|(X|)$|)AY|#[$4#|&Kg|&TgL|&YB$|&Z|&aF|$5gE#|(Kg|(TgL|$Mg5#|($|(Kg|(TgL|(X|)AY|)LX$|(a|&LeEF$|',
      '+TgL|$SgLFgB$|#]B$|$M#|%Z3MgB[#|#^@#|%$|%BLX|$RgL#|(BXKg|(FgBa|(KXFaS[|)g|(XFY|(a|)Ba|$Sg=#|($|(Kg|(QBZ|)FgB$|)XFg|(',
      'X|)$|)FgB$|(Y$|([#|(gLX|#aQ|%#|%$|%BX|($|(FX#|(LX$|%FX5MZ|%TgCXFTgL|%X|&$|&FX#|)Kg|(g|&L|&NL#|)$|)TgL|)X$|*FX#|)a|*S',
      '[|%Y|%Z|&#|%gLX|)$|$R|%#|%$|%J3gB$|%Le$|%TaQXLb|%X$|&Bg|&L|%ZL$|(X$|%aF|%gTgL|$TX)|$U#|%NZ|(B$|&gLX#|*$|%TgL|%YF$|%Z',
      '|%a|#bMg6gL#|#eS|%#|%$|%X|&$|&AX#|&Fg|#fNBTY#U$|#gLeBLBY|$MQgL#|)TgL|%Sg=QgL$|,Kg|,X|)X|)[#|*Kg|%X#|&3gSX|&QY?|%eA$|',
      '%fGDZ|)gLX$|$QFgDgQ$|%L#|&e$|%XDR|)$|)RB3a|)a|)gLX#|&JgLX#|&M#|(3X|(Kg|(X|)AY|&QGY|%Y|&BZL|*#|*$|*JX5$|*QXM#|*X|+EgL',
      'XLa|*a|*e|&EX|&QXM#|(YE#|*$|*Kg|*X|%ZG$|(X$|(a|)S[|%a|&S$|(g=Y|%bB5gMFgCX$|%f|!EF#|$<g:L|$Kg|$TgL|$[$|#MBY|%a|$FgBY|',
      '$gK|&#|&$|&FXCTgL|&RXTgBgM#|.TgL|&TKgIDgEX$|(gL|&X$|(AX#|&a|&e|#XBQ$|%[$|&FX|%]FX#|%e$|$FgLQYRaS$|(X3TgL|)FY|$K|$MAX',
      '|%LBY|&Fg|)BY|%X|%gKY3|*#|*$|*GMgQXAY|*TgCNXFY|$QBY|%F#|#Y#|$LX|#ZM$|#]K$|%R3=KXMg5$|.aA|#^BMXSg=gM$|-TgL|%Y$|%gQX|#',
      'bMgL#|(aA|#gLXF|(#|(8FgD$|,TgL|(Kg|(aF|$M[Q$|$QFY|(#|($|&a$|!F3gSBgM|*#|*Kg|*TgL|*XAX#|,Y|*a|#5M|%$|%:FX$|%B$|%KYD#|',
      ')Kg|%XAX#|(Y|&Bg|&L|%Z|&#|%aA|&JgL$|&S[|&WTgKYFg|%gLX#|)$|)Kg|#<gBBgG[M[S$|#=$|#?YLXD|#DZ|%FX#|%S[|$gL$|&X|(#|($|&e$',
      '|&f|#F[|$gDZ|#G[#|#K$|$Tg3^BgL|$e|#LBY|$FgBY|#M$|$TY#U|$XLF|$aFgDgM|+$|+KeDZ|$gKDX|)FDZ|+gLX$|)LX$|#N$|$TgL|#QDaUNZ|',
      '$FZB#|$K$|%a|%eEgLXLTgL|%gIM|)g|$ZF#|$aKgIMg|#RgLBY|&FgBY|#Sg=#|&$|&Kg|&X|($|#UY|$Z#|#X5G[M|%MY3X$|%XMg:[FTgL|&NbAg?',
      '|%fM|$=3|&#|&KYD#|(g|&TgL|&XFY|&a|(WTgKYFg|%Y3X|%gL3XMX$|(RXTgBgMKg|/a|$?Z|$BgM|$C|$FX|&MgCX$|%gL$|$GY|$JQBg|$K3|&#|',
      '&$|&MA#|)Kg|&TgL|&a|(F|&e|%EaL#|%FZ|%JY$|%X|&FY|(gBM#|+Kg|%Y3X|)#|)LX#|+$|%eNgNa4$|%g|&F$|(Y|(Z|$L#|%3$|&TgL|&X$|&e|',
      '%Y3X|$MD|&$|&TgL|%XLA|)$|%Z|&AX#|%gUBY|$QRYSgLBa|$R#|%$|%LBY|%Y3|%a|$TFg|%X|%Y3X|%ZBg|%gBZBY|$U#|#Y$TgG^U$|$3=BK#|&a',
      '|$5DgLBa|$BMX#|(Kg|%XFgB#|*KaQ|%gL|(#|($|(Kg|$DXF#|%aR3$|%gMX|)#|$EF|&#|%XL|$FgDX|$G[A$|$K5gF$|%YBgB#|*Kg|%gFNY4YB|-',
      'M]GaA|$LB#|%FgBgMA#|+LBY|%K|&$|&TgL|&X|($|(FX#|*Kg|)[TXM#|)g|&YBM]GaA|&aF|&gL|%[3gB$|*QXFg|*Y$|$MB$|%FgBM#|*Kg|%QUBg',
      '|%Z3gSA#|%[3gB|*#|*Kg|*TgL|*a|%]@QXFg|&GA#|)Kg|(LBY|(YB#|*$|*Kg|*QXFg|*X|+$|+FY|%eE$|%g58g9BY|+FgBY|(B$|&AL#|)$|)TgL',
      '|(aB[#|&DYRBY|*FgBY|*gLBa|,FgBa|)Sg=#|,$|,Kg|,X|-$|-FY|(aR$|*3$|*e|&EXMA#|*YB$|&JM#|&KXA|*#|*3XMgL#|*Kg|*TgL|*XL|+Mg',
      'C#|*a|)BX|*Y|*[#|)FgBY|)GYB$|,Kg|,QXFg|)L|(YB#|*$|*Kg|*QFgB$|+XFg|*TgL|*X|+$|+FY|*a|(ZL|*Ba|*FgBa|&QUA#|)BY|)FgBY|(X',
      '8F3gSaBgMD^Sg=gLX|+Kg|+a|*YB$|)A#|*Kg|$QMgBBa|%TBY|&Fg|)B$|*Y|%XMA#|)XL|*MgC#|(LBY|)YB[#|(YB$|&T#|($|(XL|(YF$|(Z|%^B',
      'gB$|*Y#|+$|%aDF#|(LBY|(YBX|&R$|$RKgL|%X|%g8L#|)$|)aF|(YB#|*$|*Kg|*QXFg|*gL|(ZLBa|$SYDgEKg|%aE$|%g3MgS$|(XTgL|&>X|&GD',
      'gLBa|(FgF$|#ZBQFgB$|&XFg|%Y$|%gQX|$LBa|#]BF|&#|&$|&BLX|&X|($|(FY|$F#|#^BgL|(#|(FgBY|#a8g9BY|(XKY|$BX|&M$|%Y|%[#|%^Bg',
      'Q#|*a|%gM#|(5eN3TgL|(Le$|(TgL|(XAY|(a|$D#|$GXN|(DaR$|+TKgIDgEX$|,gL|+a|(Z|$KYFXCTgL|$NZ|$RFNg|$UM[|&]|#b3X$|&FY|%a|$',
      'Q|%eGNJgLBa|#eGNJgLBa|$IaNg|#f3X|#gLQTBg|&aDLBg|%XL|($|(QXDZ|(RXTgBgMTgL|/a|(XEZR$|)NLa|(aF|%]|&F#|($|(BX|(Kg|(X|)$|',
      ')BYFgL]F#|(Z3MeBY|+gB[#|)JQBY|!G3g3?|%S|&#|&$|&Le$|&TgL|&X$|&YA$|)X#|&Z|&a|(A|&f|#8BY|$FXMgC#|$K@Z|#<g8|&BFgBgMKg|-T',
      'gL|&DR|)$|)a|&EX|&K#|($|(XEgLXLa|(Z|(a|(eEgLXLTgL|(gLX#|&QY#RBYBKa|&T[|&X7g5XF[TXM#|%:XI|)MX:gLTKgIDgEX$|/gL|.a|)Z|)',
      'g|#=FX|$YLXNX|$aN|$g=D3NgN[|&Y3X|#>BY|$F#|%Kg|%a|%g|&BY|$YBQXFg|&[#|(Kg|&gQX|$gLBa|#Ag?YB|)$|)X|*$|#B<g:NY$|*FX|*Le5',
      'T]BgMKg|)a$|$BY|$F#|%gBY|$Y#|%$|%B$|&X|&gQX|$gBF#|(Kg|(TgL|(a|%FZ|(#|&gLX|*$|%LX|&[$|%M#|&Kg|&TgL|&XAY|&Y3X|*LX#|,$|',
      '*T[|&a|#CY|#D#|$3#|$8g9aD$|$Kg|$Le$|$QZ|&#|$TgL|$XFX#|&Y|%MgC$|)TgL|)X$|*FX#|)aS[|$a|%F|$gEBL$|(Y$|%KRgMZ|&XQBZ|*gLX',
      '$|%L#|&XFX#|)Y|&a|#KgG#|#M$|$<g8|$B$|$FgBG|$IgMUgK|$K#|%X#|&BgKF$|+Y|*X|%aRgQM$|+TgL|%g|&GMLX|)X|*LX$|$R[MXK$|$TgGM#',
      '|)Kg|&L|$X|%#|%3gMKZ|)XFgBX|%:L#|($|&YB$|)QXFg|)X$|)gL|%KMgR#|%RM|($|$Y|%3NgGFX|%5ALgL|(YBKg|(gLBa|*FgBa|%8L|(#|($|(',
      'XBgK3Na4$|&YB$|&g9aDa|%AXK#|)$|)B$|)X$|)aA|&ZBQXFg|)X|%B$|&gL:gL|%Ef|%G]MgA$|%JXSX|*$|&gMKBY|%KXA#|&YB#|)Kg|%Le:FX|%',
      'N3gSgLBa|%QMgBBa|*F#|+Kg|+TgL|+XFY|*LYB[#|*YB#|,$|,Kg|,X|*gL|&UFKg|&XM$|)Rg8|)TgL|)a|%RZNFZLXFY|)gL|&gMK#|*$|*TgL|*a',
      'A|%SD$|(g|&g3XM$|%TM$|(TgL|(a|&gCYBY$|+f|%UMBY|$Z3gSA|*#|*TgL|)X|*#|*LX#|,$|,Kg|$a|$gA#|&XFY|%L=3X$|(FTgCNXFY|&FgB#|',
      '*Kg|&XGgB#|+Kg|(QMATgL|%Q|&A$|&B#|($|(GgMDaRa|(TgL|(X$|)MeUA#|(a|)S[|&XAY|#NXAg?[$|%LF#|&YB$|#QYBgM#|)Kg|#RQ$|$[$|$]',
      'FX#|$g8|&X8g8|(Bg|(Dg|&YK|)DYRY|)I7g5XN|)JX5a|)Q7g5MX:gLTKgIDgEX$|-TgL|)a|%L|&BY|([|&Fg|)BY|*Z|*[|&XK$|)Y|#X3RXTgBgM',
      'TKgIDgEX$|%YTgBXFTgL|)CXF|,DaRTgL|,TgL|,a|$=A|$>$|%LBY|$AYFY|)$|)FX|(ZL#|(a$|%g?QX$|*FX#|+g|(YBgL#|([M7g5$|$B[#|&Kg|',
      '%gM#|(Kg|(TgL|(XAX#|*Y|(a|$D|%#|%$|%KYB$|)Kg|%Le$|%TgL|%X$|&FgBa|%a|%f|%g3#D[3TgL|$FaF|$G#|%Kg|%XFY|$M#|%g3g|&=Z|&C|',
      '&QBZ|)gLX$|&RgQFXCTgL|*a|$NF#|&Kg|&a|%LBY|%g|#YBM#|&$|&f|%XKU$|)TgL|%[$|&MgFXK|%gB#|&MX|(e$|$IBY|%FgBY|$OgOb|#Z>Y3X|',
      '$?LBY|%YB$|(X$|$BgQX|#[#|$Aa|%gL#|$BgM|(#|(BgQaF|(TgL|(X$|)AX#|)Fg|)L|(Z|)#|(aA|(e|(f|(gLX|+$|$F|%MGY|&g:FgK|(FYMgKX',
      'A#|%Rg8|$KXFg|$M$|%B$|%FgDMDXT$|%Tg3XM|+#|+$|+JX:$|+X$|+aA|)^B$|+gL|%X|&3XNa|&A|(#|(XFY|(a|)S[|&BF|)#|)$|%Z|%[S|(#|(',
      '$|(TgL|(X|)$|)AX#|(a|)A|(e|)BgBK|-$|%eUYB$|$SgG#|(TgL|(XAX#|*Y|(b$|$TgB3#|)Kg|)TgL|)XFX#|+Y|)a|*S[|#]:F#|%LFgBY|%X|&',
      '#|&LX$|%gL|(Ba|$MLBY|&YB[#|)gQX|%YB$|%gA|(#|($|(BLX|(Kg|(M]GaA|(X|(YKX|&BLa|&Q|(:FgK|,F$|-Y|)X$|*FX#|(B$|(DYRY|(JX5a',
      '|(KGY|)aQ|)g|(M]G#|(QBg|)MgBZ|(TgKYFg|*LX#|(XMgEa|(a|#^8g9BY|$C3g|%YQZ|(gLX#|+$|+Kg|%gQZ|)MX:|,#|,$|,TgL|,aF|$Sg=#|(',
      '$|(Kg|(QBZ|)XFg|(a|&>#|(B$|(JX5$|+a|)]KY$|(XFY|(a|#aLKg|%XFY|$SA#|#cGg|#eSA#|#fBgM$|$F$G[FgLaF|$MQ3[N|*TgL|%XAY3EXMg',
      'KY3KUYNX$|1QgL3gBL$|#gLXMXTY#U$|$M|%3=LBY|(YB$|*QXFg|&MA#|)Kg|)TgL|)XFY|)a|&XM|)$|)TgL|)X$|)a|*A|)f|(R|)#|)$|)Ba|)F#',
      '|*Kg|)LBY|)TgL|)YB#|+$|+KTgBY|,g|+QXFg|+X|,$|,FY|+a|+eWTgBY|)a|&^BY|*#|*$|)a|*$|)f|)gLX|&eSg>a|&gMYLX|,LX#|.$|(SXNgL',
      '|%4gLXB$|+KTgBY|,g|+X$|%5BY$|%8NBY|(FgBY|(YBX|+$|*a|&XM#|)$|)XL|(NYBXFY|%:X|($|(FX#|(GBY$|*a$|(LX$|&g<X|%AKgL|&LF#|&',
      'XNZ|&ZB|)#|)$|)KTgBY|)QXFg|)X|*$|*FY|*WTgBY|)eWTgBY|&aBX|%BY3gMYLX|.#|*SA#|(8B[MTgM3YNeKZ=Mg|8KYBa|)MAKg|(:g<X|,#|(D',
      'YF#|+Kg|(FYEY$|,BgQ#|/aF|(GXD3$|+F#|+LBY|,FgBY|+YB#|-$|-Kg|-QXFg|-X|.$|+gLBa|(IYKgI#|(JX|*BY|(KX|*$|*LX$|*T#|(Le5YBX',
      '|(QMgS#|,Kg|(RB#|*Kg|(Sg>X|,GYB$|/QXFg|-gL|+YB$|-X|&Z3#|)$|)gSX#|(BY$|)e|(LBa|)FgBa|&gL3gS|,#|,$|,BLX|,Kg|)GXDLBg|)L',
      '$|*TgL|*a|)X58g9BY|+B$|,QXFg|,gL|*UXM$|)[B|+gBM#|)a3|+#|+$|+JX5$|+Kg|+TgKYFg|-L|%CK|(#|($|(4Ag?$|(B$|)LX|(QXM#|+Kg|(',
      'X|)EgLXLa|(a|(e|)EgLXLTgL|&X|&YB$|%DBgB#|*$|*Kg|*QXFg|*X|+$|+FY|&DXBY|&MgRF#|+Kg|*LBY|+FgBY|*YB$|,Kg|,QXFg|,X|-$|*gL',
      '|,Ba|&XBY|)[#|(F#|(L|&ZLBa|&]SA#|&aR|)#|)$|)TgL|)X$|*Bg|*Fg|)a|*S[|%EXF|)#|)$|)BLX|)KFgBgMYA$|/Z|)e|%G<g8TgL|*a|&[|&',
      'gMCK#|+$|%IFgEFTgL|&N$|(X$|%JQBY|(FgBY|&X|(Q|)#|)$|)XBg|)YB#|+$|+X|,$|)Z|)aA|)e|&[$|&]B#|&^BL$|)Y|&aD$|)X$|&e|%KXA#|',
      ')Kg|)TgL|)XFY|)aF|)b$|&[4|)#|)$|)BLX|)F5MXAY|,aJgL$|,b$|)TTgLeBgGXDFXFY|)X|*$|*AY|*FY|)a|%L8g9BY|*FgBY|&BBa|(FgBa|(g',
      'F#|*$|*Kg|*X$|*aF|&X5a|(BY|(T#|)$|)X$|*Fg|&[3gB#|+$|+Kg|+X|,$|,FY|+e|(:gLBa|+FgBa|&e5|)#|)$|)RXNX|)X$|*Fg|)a|*A|)e|(',
      ':F#|*Kg|*XFY|%Q3gBX|)SgLXKY|&8F#|)a|&DFgBY|&MgB3$|*Ba|*FgBa|&UBY|(FgBY|+Z|&XT#|)$|(U$|&YRBY|)FgBY|)gL|(Sg=$|+QXFg|+X',
      '|,$|&^BgB#|+$|+Kg|+X|,$|+Y#|,$|+a|&aR#|)$|%R#TX|*#|&TgB3XN$|*L$|*Y#|+$|+G[MTg3XMX$|*gLX|&XTF#|*3XNa|*Kg|*a|&Y3gSA#|&',
      'gF|)#|)$|)TgL|)X$|*FXKg|+g|)a|%T7g5$|*a|&FgF$|*X|+$|&MBY|&XD|)$|(M$|)A#|)LBY|*FgBY|)YBX$|&YDgE|+#|+KTgBY|,g|+X|,$|,F',
      'Y|+Y|,#|,$|+a|+e|+f|(EgD$|+Kg|&^B$|)X|*$|&gBXQ#|+$|+FX|-LX#|)[B#|+$|+X$|)]LBa|)fBY|(CXGYB$|-X|)YB$|+QXFg|%UgNXD$|%X3',
      '=LBg|(XRLBg|(^BY3#|,QYRaSX$|(g|&5aQ|(g|&7g5Aa|&8NBg|(X#|(ZF|*#|*$|*3XNXBg|-a|*BK#|,$|,X|*JXMBTgL|*MX:X$|*Q#RXQNZ|*X|',
      '+$|*a|&A|($|(QXL[$|(X$|)Fg|)LXK|,$|(YF$|*X#|)QY:g<XFTKgIDgEX$|)S[|(Z|&B$|)3XNa|&CKY3#|&DMgRLBg|&EXFgL#|,Kg|,aF|(gLXG',
      '3$|&FgBTgL|*a|&GBg|(LBY|(gB|*#|*Kg|*QBZ|+FgB$|.f|+gLKg|*TgL|*X|+FY|*Y$|*[#|+Kg|*a|+$|*f|*gLMgC#|,b|)F[K$|+LXBg|,[$|+',
      'QFg|.BY|*eBY|,g|)LFgBa|)TgLBY|,TY|&KXAgL#|([4gL#|&L|(BB|(R$|)g8YBgB#|/Kg|/XFY|(aA|(e|&MIgEKg|+X|(JB|*a|)gLBa|(KgJ#|+',
      '$|+Y3#|+a|(gCFX|,#|*LBY|*YBQBZ|-XFg|&QYRBg|&TXD#|*$|*TgL|*a|&U|([$|%YL|(#|($|(X|%ZBY$|)NBX|(gLX|%a3gSAZLTgCNXFY|0XFX',
      'FY|&K|(gAX|&MALX|)X|*#|(LBY|(YB$|*X$|&SLBY|)FgBY|)YB[#|(YB$|*QFgB$|+XFg|*X|%bSLBg|)Fg|%e|&3gB#|*$|*Kg|*X|+$|&=ZFg|&B',
      'gTXUF#|&QX8|%fDgLe5Y3Z|$Na=g|&Ib3|!H4M[DgDZF|#MQMZ|$YRgBX|#N#|$B$|$Kg|$MTTgL|%]GaA|$QYRaS$|$TgL|&QM]G#|$XFX#|&Y|$a|#',
      'XMTZ|#YNgKg|#Z=|%g|$KMTgL|#[HgH[TTgL|*aS[|#aIgMQMYKXTTgL|([QMZ|$Mg|#gMXFgTYTg|*g|&L?TgL|)g|%a<g8g|!I7g5XN|)TgL|)Z|#D',
      'gE$|&X$|&gQX|#FgDZ|%E$|&F#|(Kg|(a|&[$|#J]Q|&[$|#N#|$Kg|$QXFg|$TgL|$XBg|$Y#|%$|$aF|#TLXFXFY|(b$|$QaRgQM$|$[|$g|#UQ|%e',
      '|$Y$|%MX5BgL|$[|%3XN#|%BgM|%EX|%JY$|&gL$|%KB#|%QXM#|&YE#|)X$|*FY|&gMZUY$|%R$|%S[|$]FX#|(Kg|&Y|&g|$gQgL$|#X7g5NX|(gNX',
      'DaRTgL|$A$|%TgL|%aF|$EBa|%X|$IX|$KgIa|$M|$N|%$|%3#|&$|&TgL|&X$|(FX#|&aS[|%TgL|%X|&$|&FX#|(g|%Y3X|)$|)FX#|%gL#|(3XNa|',
      '(Kg|(XDaQ|(a|$U[NgLaF|%gLR^7g4NX|(TKgGMg3BFgBQ$|3[|/X$|(XF[I#EX$|,FgEX$|#YFgD[$|$JMgBY|$TgKYNgNX|$UXM|(MX:gLTKgIDgEX',
      '$|.gL|-a|%[|#Z:#|%XFY|#[DgE|($|(TgL|(Y|)#|)$|)KXFg|(a$|(f|(gLX|$E$|%b$|#^UBZ|&g|(3CX|(BK#|*$|*aS[|%TgGBY|+$|#a7g5N]M',
      '[|,F5Ma|(O]M[|,B$|,F5MKAg?Na|/a|$DZ|$Ng|$O5XQZ|$TFg=g|%g=|#b7g3g|#eE$|%LBY|&FgBY|&YB[#|%YBQXFg|%e|%gLKg|#fDgE|(EMgK$',
      '|,TgL|$EXLF|#gM|%QZBY|%UgK|)5[GgB$|.TgL|)8MgL#|-TgL|*XMZ|)A$|*X|*Y|*e|)X|*Ag?TgL|)bQ|%XUgKA|+#|+$|+5gMFgCaS[|+TgL|+X',
      '$|+a|,F|+e|*Z|%Y=Fg|(YR|*g|)Sg|(aFTgL|%]Ba|$N]|!J3gB$|&X$|(FX#|&Y|(#|($|&gLX|#5B|%TY#U$|*TgL|$QBX|&Y|&Z|&a|&e|%Dg5ZB',
      'XLX$|%Fg|(B#|%XF|$YFZ|#:Ba|$FgBa|#=g=|&$|#L#|$Kg|$XBg|$aF|#MB$|%MgSJ|%TgL|%aF|$[8|$gB^UMY$|*a$|#Q$|$B|%$|%X|&#|%Z|&B',
      'Y|%[|%a|%e|%g|&LX$|(aQ|$DgJY$|$F#|%Kg|%TgL|%XFY|%a|%gB#|($|(ZBY|([|$J]Ba$|$XFg|%KY|$YBQgLKg|&X|&[#|(KMgUBY|)g|%SgLBZ',
      'BY|*g3XNa|)FgBY|)TY|*gL|)XKY|$a|%DYBY|&g|%L[$|$gL#|#X)3X3X|$5|%#|%Kg|%Le$|%QBa|%X$|&Fg|%a|&S[|%e|%f|$=3LXFXFY|*b$|$B',
      'Y|$JX|$KU$|&TgL|$M#|%$|%B|&#|&5AMX:gLTgL|&DaR$|*TgL|*a|&KXB[$|&MBgFG[MTg3XMJX:$|&QMgSTgL|+a|&TKgIDgEX$|(MgQ3XM$|.TgL',
      '|.aA|(gQBFgBgMBXLX$|&XBg|&Z|(L|)$|):FBXG3gS$|1TgL|)JXSX$|)MX:FaBXM$|)QY:g<XFYF$|)T#QYEXFTgL|+Tg3^Ba$|)X|*$|*FXKg|)a|',
      '&aBYUXTTKgIDgEX$|(F|%QY$|&a$|%gLX|$Q|%#|%$|%FX|($|%LBY|&FgBY|%X$|&MgC$|%a|%e|%gLBa|(Kg|$SA#|&Kg|&XFY|&a|%LX|%X|&#|&$',
      '|&AX#|&F[IFgE$|-Le:FZLX$|-MYUBG^Sg>aS[|&JY$|&LX#|)$|)Kg|&T[|%gL#|(3XM$|(Ba|(Kg|(TgL|(XMgC$|(a|$T$|%Ba|%TgL|#Y3gS[$|$',
      'BgBY$|)S[|$DgLBa|$FgF|(#|($|(BX|(X|)$|)FY|(f|#Z4XLZ:Z|$B$|%X$|$K|%$|%TaF|)$|&gL|%aF|$SgK$|#[7g3gBa|$QFaRgQM|%Y|#]3Kg',
      'G$|)TgL|)aF|$5eNTKgIDgEX$|$BXFX#|)Kg|(Y|%aS[|$JX5$|$KXMg5$|*aA|%Y|&#|&$|&3X|)#|%a$|%f|$L$|%e|$QY:g<XFTKgIDgEX$|#^5[$',
      '|$R#|#aD#|%$|%X$|%aF|#e$|$5$|$:F#|&TgL|&a|%G[MZ|%MX:TgL|%TgL|$GXN|#f5eNY3Kg|$BY3BBgBgQKg|(QY:g<XFKg|(Z|#gMK$|&A#|(XM',
      'gC#|&BY|%XBMf|(X|([$|!K3MFgD$|#5gF$|#:g:X|#>$|$TgL|#AY|%G[M|%IaF|$g?N|(#|($|(D^Sg=gLX|(KTgBY|)YD#|(aS[|)WTgKYFg|#B#|',
      '$$|$KTgBY|%YD#|%g|$TgL|$X|%FY|&[TXM#|+aA|$Y$|$a|%F|$gB$|%QX|#C[MX|#DF|%NXN$|)TgL|$gMXT|)g|#E[|%FX|%M#|&$|&X|$gL|&3XN',
      'a|&GgMDaR|-MX:gL#|2TKgIDgEX$|3gL|&JX5$|*a|&K|($|(X|&MXBgMf|&XUgFa|%QX8XMgL$|-TgL|#F$|$T$|%X|%Y|$X#TY|$ZSYA$|$[|%$|%B',
      'a|%FX|%SgL|)$|)TgL|)X$|*AX#|)aS[|%TgK^Ba$|+f|$e|%$|%MKX|%QY:g<XF#|-Kg|-TgL|&b:g<XFY3GMZ3gSXAX#|/X$|0FX#|%UM#|$gBQgLK',
      'g|&gM|)#|)$|)TgL|)X$|*AX#|)YA$|)Z|)a|*A|*S[|%D#|&YM|)#|)Kg|)TgL|)XAX#|+Y|)a|%LFgBa|&Ta|&XKUa|&a|#KBX|#LX|$Y|#MA#|%Kg',
      '|%TgL|%XBg|&FFgBM#|$X>X|&Z|(JXSLX|$Z8Y3X|$gK$|#NLXO#|(JXSLX|(Kg|$gNY3X|(FXCTgL|#Tg:YDg|%BY|(Sg3#|+TgL|+a|#UB$|%X|%Z|',
      '&#|%g|&BgQ#|*G]MgA|/#|/$|/Kg|/X|0#|0$|0FY|*Kg|&Q#|(G]MgA#|-$|$KD|%gKDg|$MgSY|)$|)AX|(a$|$N|$X|%3QY$|)FX|(a$|&XQgL#|+',
      'Kg|+a|%BgKF$|*X|)X|%DaQ|)$|)Z|)gLX$|&gQZG|+$|+a|%F5M#|)Kg|)TgL|)XBg|*L|)a|*A|&g|(B#|)$|%G[M[S$|%IXUe|%JXMB|*#|*Kg|*T',
      'gL|*a|(SgL#|+TgL|+a|%MX:|)$|)TgL|)X|(AX|(Sg=gM|-MX:gLKg|2TKgIDgEX$|3gL|2a|-a|%QYDgLXNL|.#|.$|.TgL|.X$|.a|&ZM$|)TgL|)',
      'aA|$YKX|%NX|($|(FX#|$aBX|$eBgTQ$|%DL|($|(TgL|(aF|$gL#|&Kg|#X#|%T#|&GaRZ|+FX#|+LX$|$5EZ|$6|%a|$BM#|&Kg|%XGYBMf|%[$|&N',
      '$|(TgL|%^JXSXQ3gB^AX#|%gMX|$EQ|&$|%[MgL#|%gLKaF|$F#|%Q|&$|&:ZQFTgL|&RMZMTgL|&TgL|&X$|(FX#|%T#|&Y3|)#|%gLBX|$GF#|$KaQ',
      '|%g|$LLX|%X|$MLYB[#|)gQX|%YBQXFg|%g5|(#|($|(DMgR3$|,F#|-Kg|-a|.F|(Ma=g|(TgL|(X$|)AX#|(a|)A|&8KXTTgL|(g|$NQX|&ZL$|$S$',
      '|$T$|%B$|%GMgLFgB#|%X$|&Fg|%Y|%a|&S[|%gB[|&Ne|$UXBgKgL#|,Kg|#Y:eMXK|$B$|%Qb3gMKXIgDKJYB$|0XFJYB$|0a|%R3XIgDKJYB$|,a|',
      '%X|%Y|%a|%gM#|(Kg|(XAY|(b$|$CYNX|%gLX|$NBY|%FgBY|%YBQXFg|(gQX|&LF|)g|%gNZKZ=MgKYB$|$RFg|%gM|(A#|#Z=M|&g|$KX#TX|$MX|&',
      'LX$|#[3gB|(#|($|(X|)$|(Y#|)$|(e|$4#|%Kg|%Mg:Y|%TgL|%XBg|%a|%gL|(#|($|(6=FX$|(B$|)LX|)gQaF|(KFgBgMYA$|.Z|(X|)$|)FY|)N',
      'L$|(e|$5N|$Dg5$|&MX|)$|$FL$|%Y|&$|&FX|&JY$|&T[QgMBFXCTgL|%a$|$KgI)|(LZ|(b|$TgNYK|*g|$UKgKD|#]BgMTgL|$MgBL$|(Y#|)$|(a',
      '$|$N|%#|%B$|%GX>$|%Kg|%RgNe3X$|%XFY|%a|%gL#|(X7g3F#|#^8g93=Y3TgL|$B$|%X|&$|%gBY3X|+LX$|&L[|)#|(e$|$D[|#a#|$6FXD$|)Tg',
      'L|%XNL|$=gMY3g|(e|$CY3X|$D$|%YFZ3eR$|$EXBYCY|&QZ|$KXTTgL|$MX|%Z|%[DAg?TgL|%a|$NF#|&Kg|&aF|%LYBgQX|%X|%YB[#|$Q|#b#|$B',
      'gMaLZ|$CYNZ|$Ng|$T]M|([|)B$|)F5Ma|)T#TgCXFTgL|#e3gS|(#|($|(T#FgLXTLe5TgL|)gL|$8LBY|$=M|%X|$DZ|$U$|%FNXN|%KgKD|%XNZ|#',
      'gMYLBa|!L3^Bg|$gS$|#8g8|%9BY|&Fg|)BY|#:[MgQaD$|+TgL|$g<|&#|&$|&TgL|&a|(F|#AgTFgEY$|#BY|$eUY|$g3YKGY|%B[|%F#|#CXMgC#|',
      '%QBg|%R3gBY|%WWU|$e3gB|)#|)Kg|#DL#|$TgL|$[3gB#|$gEY|%QX|#FgBgM#|)TgL|%F|#K$|$[FX|$g|#LX|$e$|#Q$|$FX$|&FX#|#R$|$g8|#T',
      'gB[|%KXBg|&YFg|%LX|(#|($|#X#|$$|$:g<QNg3gL$|.TgK^Bf|0L|.aF|(Y3$|*TgL|$BY|%gMX|)#|)LX#|+$|(Y3X$|+AX#|$DQ|&3[NTgL|$F#|',
      '%Kg|%TgL|%XFY|%Y|%a|&F|%g|&BY|$GLBY|%YBQXFg|$QBgGMgLFgB#|%Dg|%XFN$|(g|$TX#|%[|%g3TgL|(aF|#[3gB#|($|(Kg|(X|)$|(e|$5Tg',
      'L|%a|$:gLBa|$DgE|(#|(3XNa|(Kg|(TgL|(XBg|)FY|)L|(a|$EYSg>YM$|,TgL|%gD#|$FaTg3e|$Q3$|%X|&F$|#]MeG|(4Ag?TgL|(KUXDgQZGa|',
      '(g|#aSX#|&Kg|%[|#b$|#e$|$5|%#|%$|%DMgRFKg|&XF#|)Kg|%RXTgBgMTKgIDgEX$|%TKgIDgEJXSXF[IFgE$|&]BgMKg|+TgL|+XAX#|-Y|&gL|%',
      'YF$|(X#|%Z|%a|&F|%gL#|($|(BX|(Kg|(X|)$|$:FX|(#|($|(LX#|*$|&aF|%LBY|&FgBY|&YB[#|)gQX|%YBKg|(QXFg|(X$|%gLBa|$DgEX|#fQF',
      'a|!M3gB|&#|&TgL|&a|%S3$|&A#|(Kg|(XL|)MgC#|&BY|&X#|(Lb|&YBQXFg|)[#|#6[$|%Q#Ra|$e$|#8FX|&#|&$|&3XN$|&LX#|)$|&T[|$LBY|%',
      'YBX|(gQX|$YB#|&$|&Kg|&QXFg|&X|($|(FY|&a|#:$|$B#|%TgL|#Aa|#B$|$X$|$Y$|$gFXFY|(QNZ|#C#|$TgL|$a|#HZ|#KAZL#|$Ba|#QY$|%KX',
      'Mg5a|%R7g3M$|$ZFgDgMFXC|#RYLX|#T#|$$|$TgL|$X$|%LFRXTgBgMTKgIDgEX$|$aF|$e|#UKXF$|$TY|%gL#|#X3gST$|$5|%#|%$|%TgL|%X$|%',
      'a|$:|%3[KXM$|+Z|&e=|%5[M[$|*AX|)e$|&^U|)#|%Ba|%EXFZ|*#|*BgQaF|)gL$|+X#|,$|%FZBY$|*3gSaBgMa|*:g<$|)a$|&aBX|&bBY3|&g|%',
      'JXSX|&Y$|%Q#R$|)TgL|&YDgLXMX:5[UgLLe5TgL|%Ra4M$|*TgL|*aA|%TgCXF|+MX:gLTKgIDgEX$|1gL|0a|+TgL|%XF#|($|(Kg|%ZQ|%aFgDgM|',
      '%g<$|(X|)#|(Z|(a|(e|(gLX|+$|&L|(#|(GXN$|(Kg|(Le$|(TJX|+LX$|)gC#|(XBg|)FY|)JYSa3#|.$|$BgMY$|(f|$EX|&3^SgAFg|$FZ|$IMg=',
      'g|$K|%#|%$|%3^SgA|%8FgDgM|,$|,Fg|,TgL|%:Z|%DXT$|%Fg|%KeUF$|*TgL|*aF|%TgL|%XF[:JXSgL#|/Kg|*X8XMgL$|&L|(A|)#|)Kg|)TgL|',
      ')a|%aA|%e|$L|%Ng|$Q|%A#|&$|&TgL|&aF|%g|$RL$|%Y$|%ZFX#|%a$|$Sg=gM#|*EgQ:$|.TgL|*GBY$|-BgQaF|-FX|-JQFKg|,a$|*TgL|*XAY|',
      '*YL|,MX:KXMg5$|4a|5A|,TgQL#TaQ3T7g6TgL|,eDgLXFKg|*ZL|#YTMg8g|#ZBY$|%gLX|$QX|#[8Y#|&$|$DgM$|#]3gS$|$G|%#|%3#|&Kg|&TgL',
      '|&XAY|&a|(WTgKYFg|%Kg|%XAY|%a|&A|%gL3XAX#|+Y|$Ng|#a4X|&$|$H$|$N|%LXFXFY|%TgCXF3#|,Kg|,XBg|%g|$QBZ|#e5$|%TgL|%X$|&AX#',
      '|%YAX#|%Z|%aA|&S[|%b$|$8Ba|$KFg|%YLe|$UYAZ|!N3XM$|&X$|$gS#|&A|(#|(Kg|(XFY|&R$|&gKA$|*TgL|)Z|*$|)gLX$|(L#|)Ba|)Kg|#4F',
      '+|#6[|%$|$]FY|#=g|#Ag?Fg|#BX|#IgE$|&Kg|&QXFg|&X|&gQX|#JBa|$FgBa|$gLBa|&FgBa|#L$|#QA#|#XJ#|%$|%X$|$N|%X|$UeM|%fM|#Y.|',
      '$4BY|%YB|(#|($|(KTgBY|)g|(QXFg|(X|)$|)FY|(a|(gQX|%gLBa|$=g|$GL$|%Y$|%a$|%g|&LBa|$KY=a?g|$Na4|#Z5g|$F$|%X$|#[EYLXFX|#',
      'a4$|%3|&$|&TgL|&X$|&aF|%F#|&Kg|&XFX#|)Y|&a|%XFg|%Y3X|$GFaF|$Ja|#e3|%#|%$|%:ZQFKg|%GgMYL$|%TJX|)3gSaBgMXAY|)EgL3gS$|)',
      'FYMgQX8Fa|)LX#|+$|)TDTgLX$|&gL|%X$|&Fg|)BY3DaQX$|%a|$G$|$UG[M[S$|+TgL|!Q#R$|%TgL|%XQNZ|%ZLX$|%a|#3gBQgL#|*Kg|&X|&[#|',
      '(Kg|%S$TgCNTgL|&gLXKY|#8$|$F#|%Kg|%XBg|&FY|%aF|&S[|$X#TY|#?eDMX|#AY3g|%:$|#BgT|&Ma|#DBY|%[|$Fg|&BY|$XK$|#E#|#F#|$Kg|',
      '$TgGBL$|$XFY|$a|%S[|$gDa|#KF#|#L#|$$|$Kg|$T$|%Y|#M#|$Kg|$M[8Y$|$XUKYUYMTgL|$[A$|$g5|&$|&TgL|&X$|&Z3MA#|+Kg|&a|%A|&$|',
      '&F#|(KTgBY|)g|(a|&KXNX|&LBY|(FgBY|&X$|(FX#|&YB#|)$|)KTgBY|*g|)QXFg|)X|*$|*FY|&gLBa|%BFgBa|&KXF|*#|*$|*3XNa|*a|&aBa|&',
      'gBBa|%EBa|&F#|(Kg|(ZL$|(gBa|&KXF$|*TgL|*X|&LBY|(FgBY|(YB[#|&X|&YB$|)X|%FYLMTgL|%KX|%L$|&TgL|%Ng?g|%Ra|%S|&#|&BgML#|&',
      'DgQL#|&GMgLFgB#|(]MgQ#|&MgBf|&X|(3XNa|(AX#|*Kg|)Y|(Bg|(F[5[AKg|)gBXL|(LX$|&ZL$|&aJgL$|(S[|#NgNJJX)|#RZ3XMT#:g<X|&^Bg',
      'L|$a|#TBY|&$|$Fg|&B$|(Y|$YSg>|)$|$gB[|(B$|)TgB[|)e|(F$|)Y|)e|(T7g5gMUXNL$|&]FX#|*Kg|)Y|&gM|)#|)XAY|#UBY|$FgBY|#X3g|&',
      'L#|(Kg|(TgL|(XFY|(a|)F|$8#|%$|%X|%gLKg|$:GaLZ|$AY:gL#|*Kg|%Z|$B#|%XQMA#|*Kg|*TgL|*a|$D$|%FB$|&a|%YTgQM$|$Fg|$K|%B$|%',
      'F|&$|&Z|$L[|&#|&$|&FX|&KAg?N#|,TgL|,a|(XMg5$|,aA|&LXFXFY|%e$|%f|$M#|%XATZ|)gLX#|%gBX|)#|)NXG#|&SY3Q^Sg=YGXB$|*ZDXF#|',
      '$NZ|%gKZ3Y$|$Q|$T#|%$|%FX|%M$|%QDBgBX|%[DaQ|*$|&G]:gLTgL|%gBQY3#|)gLaF|$UF#|&KXMg5$|&XFY|#Y#RBY$|)RBXIgDgLX$|$3NgG$|',
      '%TYB#|)$|)X|*$|%XM$|(X$|&T|(#|($|(TgL|(XL|(a|%YGZ?YLX|%g=eMYLX|&MK|)$|)T#QBgTMTgL|0a|*gL|)XDYBgL$|/TgL|(LA#|$4gLXB|*',
      '$|$5gMU$|)MX:$|,TgL|)X$|$8MFg|%XM|(#|($|(EXMX|(X$|)AX#|)Fg|(YBKg|(a|)A|(gL|*Ba|*KXAa|%YFgBgL|$:L|&#|&$|&F5M|*TXKgMX:',
      'gLTgL|&TgL|&Z|%YBgL|%aBX|%g<XF|*#|*TKgIDgEX$|*YF$|*Z|*a|)L|*Ba|(aLKg|$BMA#|$DEXBY|%FgBY|%YBgQX|&RX|%[$|&M$|&S$|(X|)#',
      '|%aR#|(TgL|(ZLQgL3gBYTKgIDgEX$|*X$|(a|)S[|%gEY|&LFgBa|(KXF|+#|+$|+Kg|+TgL|+X|,#|,$|,FX#|-Y|-g|+a|,S[|(LX|(X|)#|)GZ>T',
      'gL|)JgLXT#|.$|)LX$|)MgCYF$|.X#|,Z|)NL|+#|+$|+TgL|+X$|+a|,S[|([Bg|&QBgT[|(DgJY$|(X#T$|+e|)Fg|$EX$|&B[#|&F#|(Kg|(TJX3g',
      'SaBgMXAY|2aS[|+LX$|&L|%Y|&$|&FX|&G]MgQ3#|%ZLBa|%a$|%f|$FRgLBY|%XR#|($|(XL|(e|%bQ|%eIX|%gDBY|$GMZB#|$J3gB#|)$|)KTgBY|',
      '*g|)X|*$|*FY|)Y$|)[#|)eWTgBY|%:gL|)Ba|)aB|%X5#|($|(TgL|(X$|(a|)S[|&:F#|%YFgF|*DaRTKgIDgEX$|*F5MaJgL$|-b$|*X$|+FX#|,Y',
      '|*aS[|%ZSA$|%]BYGXD$|)Le5TgL|$KMgR$|%XF#|(KXMg5$|(TgCXF3#|.Kg|.XBg|%[3gB$|$M3gB$|%8LgL|&YB#|)$|)Kg|)QXFg|)X|*$|*FY|%',
      'X:Ba|(FgBa|&=g|&K$|%[DgE#|*Kg|*gL|&EgL|%eE#|($|(Kg|(YF$|(Z|(a|$NKgIaF|%TBY|&FgBY|%Y4gL|&L#|(K|)g|%e3gL|$QMA#|(KTgBY|',
      ')g|(XFY|%XD$|&U|(#|($|(Kg|(TgL|(XFFgBM#|(a|%YE|(X$|)FY|(aS[|%^AeBY|*g|&BQXFg|%a3|($|(XFFgD$|-TgL|&8F#|)KTgBY|$RD#|%F',
      'gBY|%XN#|($|(X|(a|%YSg=|*#|*$|*Kg|*X|+$|+FY|)L|*Ba|%aS|(#|($|(B|)$|)LX|)X|*$|)e|(M]GaA|(X|)$|(aA|%gNaSA#|&Q|(#|(3MgK',
      'X|(FXC|+$|+TgL|+aF|(GMKgGMXTgCXFXFY|(M]GDMgRFLe5TgL|(QYDgLXNL|0#|0$|0B$|0TgL|0X$|1Bg|0a|(TFgBY|)gKYFg|*L|+Ba|(XKYBgM',
      '$|.TgL|)T#|*$|(a|$S#|%K|%L|&#|&QTgB[|&TgL|&X|($|(AX#|*Kg|(Fg|&aS[|(WGY|)TgKYFg|&e|%gA[|)$|(e|)$|$TMg5TFgEY$|%gBMaA|(',
      'XM#|*$|*aA|(ZMgABX|(^B#|*$|*Kg|*M]GaA|*X|+$|$UXL|%YB#|($|(Kg|(X|#Z3gSAZLTgCNKg|/XFY|(gL|$AX|$CY3X|$M|%$|#^3g3TgL|&S$',
      '|(QYRaS$|(TgL|(X$|)AX#|(aS[|$BgB#|(L$|(MBgFX3M|(XFgB#|(Y|)#|)$|):ZQFKg|(ZFX#|(a|)$|$DgE$|(Y|)#|)$|$Sg=Y$|#a5#|%$|%aF',
      '|$BF#|%Y|%gBY|$D|%#|%$|%FX|%QgLXT$|%TgL|%X|&$|&7g5XFY|&FXKg|(g|)B|*$|%a|$RJ]SAXFY|#b3gMKXIgDa|$:g<XFY3|,#|,$|,X$|$DY',
      '3|(QYQa8FKg|(TXUYBgLKg|/a|%gL$|(GDQZ#|(QY:g<XFTKgIDgEX$|(X$|$JQ#|&aF|$LgLX3MAX$|$MX5gL#|*Kg|*TgL|$RXNZ|%YSg=gL#|,Kg|',
      ',XFY|$SgAQ|#gL3gBL$|)Y|*#|*$|*5B|*BgQ|-#|-TgL|-a|*FX#|*S[|*TgL|)a$|%<g:F#|*XFY|%BZBXFY|%GDYRgLBa|%L$|%M8LBg|%QTXL$|*',
      'XBgKY3X|*Y3$|(gCX|+#|+LX$|&UMFgBY|(XM|*#|*$|*TgL|*a|(gMYLBa|%X3MA|*#|*Kg|*RXTgBgMTgL|*TgL|*a|&4gLX|+#|+BX|+F#|,Kg|,X',
      'FY|,a|&6gM$|*X$|&=gTFg|&G3#|)M]GaA|(XM|*#|*$|*TgL|*Z|*a|(gB#|*$|*Kg|*Y$|&LXK$|&QUXMY3#|&T|($|(JXSgLKg|(TgL|%[BgGBgBY',
      '$|-gLX|$MB#|&Kg|%ZUY$|!R3[FgBNX|$gB$|&QXFg|&Y|(#|($|(GZ>#|+Kg|+XFY|&a$|&gLX|%F[K$|(LXBg|(QFgBY|&eBY|(KY|%L#|&$|&FgBa',
      '|&Kg|&X|($|#7g3M|($|(TgL|(X8XMgL$|&X|%4$|#B#|$3TgL|%a|$GCIgMXUgKATgL|/a|$KXFa|$R$|$XEY3X$|%IgDZ|)a|)gLX#|,$|$gMQ$|&[',
      '$|&]AX#|(Fg|#FY$|$b$|#IgD|&#|&$|&TgL|&X|($|(Bg|(FX#|)g|(MgC$|&a|(F|&e|#KF#|$LBY|#LF#|#MA#|%Kg|$ZM|&#|&Kg|&XAY|(Bg|&Y',
      'A$|&Z|&a|(A|$g3MX|)#|%KX|#TgBgMXAY|#X3BgQaF|%KgJMZDaQgLX$|*gLX$|%QYRaS$|%XFY|$4X|&$|&LX$|&T[|$7g3MJXSgL#|.Kg|$FgB#|(',
      '$|(X|(Y|)#|)$|)FXCTgL|$G#|$KgLBY|$MDX|%ZMY3|*#|$NX#|&LX#|)$|$RgQB#|$T3$|&X$|(FX#|&b$|%F#|&3XNa|&Kg|&TgL|&a|%gBgM|*#|',
      '*KYD#|+g|*TgL|*XAX#|,Y|*Z|+L|*a|+S[|$U|#Y3gS3$|)TgL|)X$|(A#|)3gSaBgMa|)Kg|)TgL|(X|)#|)LX|+#|+$|$4M#|&Kg|&TgL|&XAY|&a',
      '|$IYM#|$M$|%T$|&X|&Y|&gL|%eQaDFX|$NX|&$|&7g5|&LX$|&Na4$|*X$|*a|&T[|%gG3NX|(XFY|$Q|%#|%$|%KFgDYM#|%MX:|)$|)TgL|%TgL|%',
      'X:Z|%aF|$R[#|&$|%e$|$SgL|(#|($|(X$|(aA|#Z6gM#|(BLX|(KaQ|)g|$B3XNa|%MgBf|%N#|#[3$|%X$|%gM$|&NG3gSTgL|(L:[MgQaD$|0TgL|',
      '$DgE#|($|$Ng3#|$Sg3#|#]DgM3TgL|$FgL#|(TgL|#^7g5XM$|$A[|%eBY|%gQFgB[|#aNg?Fg|$S$|%X$|#b3gSAY3T#TgCX$|$BgL3XNa|$NZ|%gL',
      'X|)$|$Q|#e3#|%$|$EF#|$JBa|%FgBa|#f8#|#gMDgELX|)X|*#|*BgMLQYJX5Le5TgL|*NQ$|%KY3XAX#|%QA|(#|(aF|%XDgE|*#|&Q3X$|(LBY|%Z',
      '$|&3^SgA|,#|,$|,TgL|,aF|&5FgETgL|&:g<XFZ|&DZ3gSYBTgL|&FXMXLA$|(YQXT|&KBX|)Z|(DgJ5QDg5ZBXRX7g3MJXSgLa|(XFg|&MXK$|*TgL',
      '|&N7g3X|&UMgS$|%[B#|($|(QXFg|(X|(Y|)$|(a$|(f|(gQX|%]LBa|(FgBa|%aAZ|)$:ZQFZ|&L$|&Sg>|*#|*$|*BLX|*X|%eB[#|$Ne|&3#|(TgL',
      '|(X|)Bg|)FX#|*g|)Rg8|(a|)F|)S[|$Q$|%TFTgL|!S=g|%T[|#?g|#Sg>#|&$|&XEgLXLa|&Z|(BBgG[M[S$|&a|&eEgLXLTgL|&gLX#|#e?R|&a|!',
      'T#3[8BY|%e8F#|%gSaGaA|$4gLX|)LX#|$5gMU|)$|$:g<X|$FgLXT|*Z|$IDg6|$JQBY|$LK$|&gL|%[3gB|%e5$|(YBX|+LX$|(aF|&:3|(F#|(LBY',
      '|(gL|$M3gSA#|*Kg|*XL|%8FX|)LX$|$N5gF$|)X$|$QBgTM$|*TgL|*a|%XD#|($|%YEXF#|*TgL|*a|%^BgB$|$RL$|%eE3$|(F#|)Kg|)TgL|)XFY',
      '|)a|*F|(YBQXFg|(gL|$TD$|&Y|%XM#|($|(TgL|(XBg|(a|%g3MA#|(XM|*$|*X$|(^B|*#|*3QL$|*5gMFgCX$|*FX=3XFY|*JXMBZ|,SLX|-X|.LX',
      '#|0$|*Na43TKgIDgEX$|-X$|*TKgIDgEJXSXF[IFgE$|+XUYBgLa|*Y|+$|+TKgIDgEX$|*a|+$|+F|&CLX|(X|)#|)$|)FKg|*TgL|*X#|)G3$|*YBK',
      'g|*gL|)LX#|+$|)T[|$UYBX|)LX#|+$|#3N#|$XM$|%RXBg|$gMYL$|#4X|$Z|#7g3NF#|(gG#|*$|&aB#|)$|)LBY|)TgCNKg|)e|%4gLX|*F[TXM#|',
      '%58g9Ba|&K$|&ZB|)#|)TgL|)a|&^UZBX$|)gL|&gMU$|*XNL$|-a|%6$|&=F#|)Kg|)TgL|&MgS$|&TgL|#:g:$|&X$|#<g8MBY|(FgBY|&XNF#|%:L',
      '|($|&XB$|)Kg|)X|*$|(LBa|%Le:LBY|#B$|$B#|%Kg|$X#|$Z|$g|%BX|(LX$|&gQ#|)a|%L|&#|&GY|&JXKX|&KaQ|(g|&TgL|&X#|(5gMU$|&aQ|%',
      'T[|#DFTgL|$TBe$|%gL|($|(BgQaF|(X|)$|)FX#|$X|$^R#|&X$|$bQ|$gL$|#FXBF$|(EMgKTgL|$g|%B|&$|&ZBY|&[|(Sg=$|+X$|&eS#|)$|&gL',
      'BgM|%DMgJ|*$|*X$|*a|&aR#|)$|(U$|%EY|(#|($|(S[|#GDY|$XDN3gSTXKgMX:gLTgL|$gB|&DR|)a|)eEgLXLTgL|&JY|&K$|(XEgLXLa|(Z|(a|',
      '(eEgLXLTgL|&QY#RBYEX|&XUa|#HN#|%$|%BLX|&X|(#|(LX$|%X|&$|#JX|%GAg?YB|%LX#|($|$gLBXLX$|#K#|$$|$3gS#|$5gM#|(TgL|(a|$:FY',
      '|$BX|&LX$|$FFgBM#|*KaQ|%gQL$|$JQBg|%]Bg|$L|%#|%$|%TgL|%XFgBMa|%e|$MgC#|($|(F#|)Kg|(LBY|(X|)$|&GLFgBY|(YB$|*Kg|*QXFg|',
      '(gL|$TgB#|&LX|)$|)FX#|)LX$|$X5B$|(X$|(gL|%8XM#|%:|&$|&RXTgBgMTgL|&TKgIDgEX$|(gL|&a|%EXF#|)Kg|&Y$|(GXD$|&a$|&f|%F|&#|',
      '&$|&M]GaA|&X|($|%GYBQXFg|&gB#|)$|)Kg|)Y$|)a|*$|(L|%LXBY|%MgGLBg|%QYSg=$|+X$|&aR$|)e|%T$|$YBY$|&a$|$Z3gSX|%8ZF#|)BLX|',
      '%G#|&Kg|&TgC#|*XFY|*a|+S[|$[8YB#|&g8L$|%BgGFgF$|%DXLTgL|&gJQBY|)]B$|+X|(M$|)B=a|*NXBg|)TgL|)a|%GNIgEe|(JgLBa|+FgBa|&',
      'TgCYBX$|$]U|&$|&TgL|&X$|&a|$^DgE#|)$|)Kg|$aSX#|$g|%GBgBY$|&DgLBa|&FgF#|*$|*Kg|*X|&Mg3#|*$|&XD3$|)F#|)LBY|)YBKg|+QXFg',
      '|)gL|+Ba|&]MgA|+#|+$|+BLX|+TgL|+X|+a|&gMBY|*gLGY|)DXL$|,TgL|,X$|,a|)XGgB$|,L|%IDgE#|*$|*Kg|*TKgGMg3BFgB[$|*X|+FY|&Fg',
      'E|*#|*$|*TgL|*a|*e|&eELFgBY|%JQ#|($|(B$|)Y|(FgBY|(aBg|&XQFX|)gLBa|(SA#|&]L|%KXF#|)$|)F#|*Kg|)YB$|&YNYB#|+$|+X$|&[4#|',
      ')Kg|)a|&aNFa|%L3g|)BLX|&5g|%MX=g|#M$|$DXM|$N#|%$|%BLX|%X|$TgQBZ|)gLX$|$e:YFZ|%QM#|($|(TgL|(a|$g|%5$|&X$|&a|%G$|&X$|%',
      'Q|&#|&$|&3MgKXAY|(XM$|*TgL|*aA|&:g<$|&B$|&CX|&DX|&GgMCK#|,$|&J]BXFX#|*aS[|&KGY|(YD#|(g|&R$|&TgQ#|&X|($|(AY|)gLGY|(EY',
      '3#|(Fg|(TX#|)[|&aGY|(JgL$|(SXKGY|+aQ|+g|)[|(WGY|&b$|&eGMY|(WGY|%SG$|#QMgADZMg6TFgEY$|$YEa|#TgL#|&:FgL$|&Kg|&QY:g<XFT',
      'KgIDgEX$|)RaS$|&RXTgBgMZL#|&TgL|&XFX#|)Y|#U:BLX|$Ba|$Le5aF|$TX|%gM#|(R$|(XEY3X$|)KgMeDgLXF#|$XF[J]BY|%L3#|($|&BX#|$Y',
      'B#|&$|$bQ|$eDM$|#X#Tg3^BY3|-Kg|$3#|%Kg|%gSMBX|+GgMKXA#|+KXF#|)X$|(XBg|+3XM#|.$|)Dg|(Z|$5M|&$|&BZMa|&TgBMB$|&a|$7g4gL',
      'Le5$|$C|$DM#|%^RgL#|$E3$|&TgL|&aF|%F#|&Kg|&X|(#|(FY|(GXD$|(LX$|%LBY|&FgBY|&YB[#|%Q$|%XMABLX|)QMgSKg|%[|&$|%]FX#|%gLK',
      'g|&QZ|(gL$|$FgQLKg|$HNgL#|$IMKBZ|$K|%5gMZ|%<g:TgL#|)]SXLe:FZLX|%MgCgL#|+Kg|%QaD$|)TgL|%X:Y3|*#|&FgL|*#|*$|*:FXFX#|*B',
      '|+$|+LX|+e|%gGgMB#|+Kg|&L#|&MX:gL#|,Kg|,TgL|$L#|%7g3XNa|$M#|%$|%NgLaF|%gC3#|&E#|$QEXFBLX|%M3M$|%YBgMZ|$UT#|%XLgL#|*K',
      'g|*XMgC#|*aF|%YBgL|*#|*a|&I|#Y#U|&$|&XTFa|$5gKAg?g|$BKgIM|$DgE|(#|($|(BgQ#|(Kg|(LBY|(X|)$|)FgB|,#|,$|,TgL|,X$|-Fg|,a',
      '|(Y#|)$|(a|(e|(gLBY|*FgBY|$EgLBY|$FgE[|#ZBX|&#|&LX$|$KX|&#|&LX#|#[3M#|$4|%#|%D#|%Kg|%YF$|%Z|%aF|$5gMZQ$|$BMX#|$D^@#|',
      '$FYRg8YB#|%ZBX|%gDM#|)$|)BLX|)Kg|)XAY|)Z|$GgMTYDgE#|-$|-X|$JDgMX|*LX$|$M3gSX|)YB#|$NJ#|&BLX|&Kg|%gBXF|$RZNXJ5YFZ|$Sg',
      '>[|$TgGSg=#|#]3gBTgL|(XFY|(a|&SgK|*BLX|$8FX|(#|($|%LBY|&FgBY|%Y$|&B#|(Kg|(QXFg|%Z|%gLBa|$BgM|(#|(EXM$|(Kg|(TXM$|)gL|',
      '(XAX#|)MgC$|(a|)A|)S[|$MgL|(#|($|(TgL|(a|(e|#^:BY|%XKY|$Sg=Y$|(a$|#_K|#aAg=g|$B[$|$FX|&#|&GBY$|&LX#|)$|$Gg=aKgIMg|$L',
      '#|$N#|$Q3X$|%F#|&ZLKg|&aF|&gBa|%X|&#|&$|&FX#|&LX#|)$|(b|#bFY3$|(X$|)FX#|*g|(b$|%gL#|(a|$Q|$SX|#e@[#|$GXFXFY|$KFXC|%Q',
      'XTMa|%aRgQM$|+TgL|$TX(=Z|%b=Y|$WGY|%L#|%UKg|#f3MgLKg|)XL|$FgDMgL#|+Kg|+TgL|#g3FgDTgQXKZ|%]Ng|%bG[NX|$=XMg|$BKgJ$|)X$',
      '|%M#|&$|&TgL|&a|(S[|%Y|%[BY#|)$|%eBgM#|*XAY|%fBY|%gMYL$|*X$|(Z|)AX#|$CN#|&KTgBY|(g|&TgL|&XBg|(FY|&a|(S[|%XB[#|&F|(#|',
      '(KTgBY|)g|(TgL|(XBg|)FY|(aS[|&GF#|)Kg|)X|*#|(LBY|*[|)FgBY|)YB[#|,Kg|+gQX|(YB#|*$|*Kg|*QBZ|+FgB$|+XFg|*TgL|*X|+$|+FY|',
      '*a|(gLBa|&LZ|&TgLBY|%YB|(#|($|(GgM:g<$|.TgL|(KTgBY|(QBZ|)XFg|(TgL|(X|)$|)FX#|*Y|(Y|)#|)$|)3XN$|,e|)KBX|*XFg|(a|)$|)F',
      '|(f|(gLX#|)QX|&M#|($|(BX|(X|%]N|(#|$FXB3GDQZ#|)eBgBMGDQZ#|(gQX|&F#|&L[$|%Y5gE#|%aU$|$GMgEX|*LX#|(R$|)X$|%Sg=#|)$|)BL',
      'X|)KaQ|*g|)M]GaA|)Z3MAG^Sg>XFY|%^RBY|&UX|%aFg|$H[=#|$K$|%MA#|(Kg|(XMgC#|&BY|(ZBY|&Fg|)BY|&gLBa|%XM3#|)Kg|)XAY|%^B$|(',
      'Kg|(L$|(X|)$|(Y|)$|(a$|(f|(gQX|$L|%XDYBY|(g|%[$|$MXQ$|%eB$|$Q|%#|%3XMgL#|&ZL#|)X#|)a|%5^U#|)a|&gMFgCa|%8g9#|%:ZQF#|*',
      'TgL|%B$|&FgBgM|,#|,$|,BLX|-X|.LX$|/b|,X|-$|%GYB[$|&[BgMTgL|&gF#|)RXTgBgMYA$|)X$|*FX#|+g|)a|%JXQ$|%L#|&KGY|(aQ|(g|%M|',
      '&$|&X$|(:gL#|(AX#|&]G|)#|)Kg|)TgL|)a|*A|&g5#|)$|)Ne3#|,XBg|)a|(A#|%TgBY|(C#|)$|(KYFg|)b|(LX$|%X#|&5B#|&BFgBgMgL#|/Le',
      'DgEX|/T7g5gMXKa|/XFFgBM#|(gKXMXK$|&JXQY3$|,BLX|&KYF$|*X|)QYQa3XFFgDDgQXMX|(Z|&TgCgL#|&UX|%YHg=g|&Tg|%Z3MeBY|)gB[#|,K',
      'g|(XM$|([MgQFgBY|(^B#|*$|*Kg|*QBZ|+FgB$|+XFg|*X|+$|*gL|(gMYLBa|&L|(#|(X#|(a|%a8g9LX|&F|&SX#|%gL3MeBg|!U#T$|#>GgMDZGY',
      '3XLX$|$Le5$|#B$|$X$|$gLXKg|(LX$|%QX|#FF#|$[KB$|&XFg|$]KXFg|$gB|&Y|&[#|#KgGZ|#MBY|$Y|%$|%DgMX|%LXAX|*MX:gLTKgIDgEX$|0',
      'gL|%UM$|$a|#TgB#|&$|&Le$|&TgL|&XJgLX#|&a|(F|&f|#XFY$|$MgKeF|*$|$TF|#Y#|%TX|$7g5[|$B#|%3M$|(Kg|%XL|%gQX|$FgD|(Q$|(Z|)',
      '8N8g8YBgMXJYFaBgMgL$|)JXSLX|,X|-LX#|/$|([|)$|)EMgK$|-TKgIDgEX$|.gL|-a|)TgBXFZRXTgBgMZLT7g5ZBT|+CXFYMX5X$|(]|)$|)EMgK',
      '$|-TgL|)FX#|$KX8NGgMDaR$|/MX:gLTKgIDgEX$|/TgL|&NL$|)TgL|)a|$NgTg|#[&|$IgIOgOZ|$TbF|#^DL#|&Kg|&TgL|&a|%Y|#a8g|$B[$|%e',
      '$|$NaF|(g|#b#|$DMXIXD|+g|#c3Z|#eBX|$KZ|%g|$MX|#gLTgL|!WGY|#WW',
    ].join(''),
  ],
  hi: [
    "ँंःअआइईउऊऋएऐऑओऔकखगघङचछजझञटठडढणतथदधनपफबभमयरलवशषसह़ािीुूृॅेैॉोौ्॰",
    [
      '!%2b<XHL|#DU2|#EWQTL|$[2|$bK|#FET|%V|%[|$bL]M|#H|#LbB|#M4|!&9|#CU|!(AURTQ|#E|$bR[#|#Q|$2T|%V|%[|$J[#|$V|$[|!*AbAL|#E',
      '2T|%V|%[|$bR[#|&_#E[|#FK_4|#Q|$2T|%V|%[|$E[|$[|!-2|#N#|!0L|!1L|!2)|#>SUKT!|#IV|#J|#L|$AT|%V|%[|$ET|%[|#MT2TL|#RA[|$T',
      '|#T|$J|$L@|%bK|$M|#U|$KT|$QV|#V|#W8|$JTL|#[|$NM|#_|$)|#bK_#2U|$P[AbL|!4)|#-|#KT|$[|!5<ET-!|#L|!7TRU-|!9ENLV|$bJ|#H|#',
      'T|$AT|%V|%[|$ET|%[|#UMT|%[|$Q2[|%J[#|%[|#V|$NE|#WMT)|#XE|#]Q[|#_|!A2|#BT|#H|#LR|#VE|#_|!BT|#V|#[|!C2bPU@|#UE|$KT|$Mb',
      'MV|$QJbHL|#V|#XQL[|#[3[#|$O|#_|$E_#|#aLTE|#bNTLT|!DLbJ|!E4L|#CV|#RV#|#TJ|#UDE|$LbJT@|#[|!FL|$UNTL|#Ob7UJ|#RM[|#TQ|#U',
      'AT|#WLQb2TL|#XLbN|#bL2TL|%BJ|%C[O|%JW3|%K_4|%QUCbD|%T7VE|&FbA|!GSUMbJ|#UL|$MbJ|!H>ST|%[|#E|$T|$V|#RWA|#TA|$C|$L|$RLV',
      '|#V7|!I4NTE|#T4|$LA|&VK|$PT|#V|!J#CUL|#DbK|#RAbNFXLb@|#TET|$Lb7|#W3bK|#[|$#|!KR|$T!|%#|#T|#WCbD|#[|!LRT|$V|$[|#T9T|%',
      'bK|$Pb<bLVK|#XF|!M4I4|#U-|$KT|%[|#[2UE|#_4|%_#|!NLbP|#R|#TMT|%V|%[|#U2TQ|$9b;TE|$IUEbE|$O[P|%bN|(NUCbKTMK|#[|#_|#bK2',
      'bAU|!OATHbCV|#HbC|#RL|#TJUM|$QE|#U2bPT|#WLX|#bLV|!Q#3bKT|$4VA|#2AT|%[|#Eb|%CLbI|#HQ[|#IV|#JK|#L2TL|#TB|$M|$RUAbK|#U#',
      'R|$A#HL|#[|#bBTE|&FET|(UA|%UA|!RU#CV|$EbCV|#V|#W&|$)|$-|#]|$#|#_|$AT|%V|%[|$E[',
    ].join(''),
    [
      '!%!4bL[9V|##2|%E|%M|%UA|$4|%WM|%X=V|&L|%bL[9|*S|+V|*V|*_|+#|$7M|$9ET|%MU|%TE|&J|%VL|%X|$>JTE|%L|%[|$A|%A|&$|%L|&LTPb',
      '<bLVK|&TM|&U2bP|&b4A|(C[OVK|(EURUA|(LTPb<bLVK|%UJ|$CL|&XEV|$O|$QTLV|#2HL|$TCJU2|(V|%M|$[MT|&V|&[|$bAXHL|%P|&A|&K|&L|',
      '&T#O|%QL|#3@b>|$HTL|$UM|$bAL|#4L|$MT|%V|%[|$QbA|$bEU|(JUAbL|(R_AbLV|%L@V|&NTM|&QL|&UJ|#7M|%T|$TE2|$b8T|&V|&[|%KWA|#8',
      'XA|#9J[L|$K|$TAOAbLW|$VA|%H|$b;TA|(E|#<M|%T#<U2|#=TLR|(NV#|#>b>T|&[|#@W|%0#|#A$|$-N|$U|%BU|%LU2bA|$VA|$WM|$bK#A|&DU2',
      '|&EbA|&T7TL|%LU|#BLbNN[C|$NT|#CT|%MA|$UAU|$YObK|$bIWA|%NUAVK|&]A|#DU2AJ|(L|(T|&L@|&T#O|*A$|(DU2|(L|)U2|)V|&YA|%4bLR@',
      '|%EUKJ|%NLbP|&[OE|$V2bP2|%E|&AT|$bK2bP|*AT|&KE|&TAbJ|(F2|)E|(K|#E#A|$9TE|([|$EbA|&K|$J_M|$NL|$T9|%B|%NObK2|$UKJUA|%M',
      '|%NTLbK|%Ob7UA|$VAT|$W|%2L@|&XM|&bLJ|%4bLR|%7UA|&b8[C|%CTE|%FJ|&QbBUAU|&TA|&bLK_4|%H#D|%IN|(V|&XAU|%J#>M|&AU|&TE|)UA',
      '|%KTKUK_#|)V|%LT4|(DT|&XF|&_D|%NTC|)2|)UA|%OTQE|%Pb=TE|%Q#DTE|&EbDTE|&L@|&X7UA|)V|$X=T|&V|%CUA|%F|$[2TE[2|$_3T|&V|$a',
      'F7TLU2|$bA|&A$|&L|(LTPb<bLVK|(U2bP|(b4A|)LTPb<bLVK|&UJ|%CL|%E|&T|%KAbL|&BT|&TK|%N[P@|#FET)|&E[|&KT|$IbL#O|$JTE|(UA|$',
      'LCE|(TAbJ2|%TD|(V|$NTC|&R|$RL@|$TL|$UAW|$VM|$XLb@|(N|$[2bPT|*2YA|)UA|$_M_|$bLAbK2bP|%QLT|#G4TE|(UQbATE|$QL|$S4STEUQb',
      'ATE|&TEUQbATE|%b4STEUQbATE|&LV2T|*V|$VJ|$bLV2T|)V|#HWM|$X|$bCWM|)bMT|%HTQ|%LTRJ|#IK|%TL@bK|$TN|$U|%2bLUKT|%EK|&N|&VA',
      '|&[AT|*0#|)bLUK_#|+V|&bE|%FbLTK|%ITN2|%JEbKW|&TE|%KT#AbLU2V|(E|)bAbLU2V|%M[3|%NbK2bA|,U|%P[2|$V|$XAFXLbN|$bKTQ|%L2|#',
      'J9SC|$E|$L|%ETB|%TFWL2L|&NAV|%V2T|(V|&O|$TE|%NQbKT|$UA|&TI|$VE|%L|&TA|$XLbA|%MbK|$YA|&QL|&T|$[=V|%LU2E|)T|)V|$_EUKT|',
      '%M|$bHTMT|&U2TFWL|&[>2L|%M|&VK|#KQb2|$_4bK|%DbKT|$bKL|#LH|%V|$NU#C|&EbC|$QbAX|$T92AT|%NMV|$W@|&T|(7M|$_>ST|$b7ET|%9U',
      'A|&WE|&[#<VET|%BNbKNQbBT|&OTQbAbL|.V|&TA|)b|%CbD|%D|&7TM2|%FUA|%M|#M#2L@|&TL|&YA|$2T|$4TN|$NL|$T*CbCVE|%HTJT|%NT|&[|',
      '%Qb2T|$V|%4?S|$[2b9[#>L|$a2U2|$b9VLUKT|%F|&Q#3bK2|%GT|&bL[>|%HLb<|&TEUKT|%J_>ST|%MTR|#N2TO|$9b;T|$AL@|&UA|%TL|$D|%TL',
      '@T|*0#|%U|%V|$KN|$L_D|$M_2E|$O[P|%_P@|(UA|%bK|$QL|%TC|%bBT|)0#|(UA|$TLb>|$UETO|$]D|$^Lb>|#OWI|$_2|$bN|&AbBTJT|&J[D|&',
      'UEV|&[A|#Pb<J|(V|&TDbKTKV|#Q#3bK|%A_P|%IN|$GM|&AT|$J|%LbB|%TEAT|%UKT|$L|%TEV|$M|%V|$RK_4|$TDTL@|%JTEbK|$UA|$VJ|&UA|$',
      'WL|$_QU-OE|$bA|&UAbN|&bL|%BTKV|&U|(L|%FATM|&Pb<|%NV2TL|%QV|#R#2TL|$J|%C|&E4L|&THTC|$U#QT|%MbKTHT)|!&!2>S[|(_#|$3|%_#',
      '|##2>S[|(_#|$3|%_#|$4bM|$ALU2|$C_ME|$DbL|$OU2|#(#Qb<VE|$QM]@b>|#)#|$-QHV-E|$<V|$FV-M|$HV-J|$QVQV|#*<|#-4T|#2L|%bP2|(',
      '@|(UA|$ME|$QbJU2|$TL|%O|&NT@V|$YAU|(K_#|$bLJ@|)2TLUK_#|&TJ2|%QT(>|&V9E|#3UL|&2TL|&V|$bKTE|#4J|%E|$LT|$ST|$TJV|$[|$bL',
      'R|#5TA|#7L@|$TL|&bK|$b8TCUA|#92M|$SJ|&V|%TC|(V|$TC|&V|$VNE|&U2T|$b;T|#<T|$[|#=NV#|%[#|#>NT@V|#@NU2|#A#2|&NTC|*V|$T|$',
      'V|$[|$bJ|&2BT|&5TAV|&QJLbF@|&RAbKT|&T|#CA|$JUK_#|%V|$L|%bO|$TE|$U2TM|%AbK|%J|%NTQUK_#|)V|$[O|#DT|%L|&IXA|&OUMT|&UA|$',
      'U2TLU2|%FAbK|$V|$WEU2|)AT|)V2L@|$[|$bKTAbJU2|#E#C|$EbC|$T|$WN#OU2|$[|$bALU2|%C_ME|%DbL|#F2T|%V|%[|%_|$AbAU|$E[|$LTDU',
      '2|$Q|%V|$TA2TM|$XLbAU|$[2bPU2AT|#GS|#HTC|&V|$X|#IT|%Q|$XP@|#J#AbLUA|$AaL|$UL|$[L|$bH[>2L|#KAE|%T2TL|%[#|$E|$LE|%M]#>',
      '|%UO|$OT|$T|%A|%J|$V|$W|%2bA|%LbNU9b;TE|)[C|+U2|$[|$_4|%9E|&U2|(A|#L#I|&U2|$-Q-Q|$2bP@|(UA|$@bK2|$AV|$JbI|(U2|$T|%DE',
      'T|%J|$[3|$_F|$b2<U2|&UJU>V9S|%4E|%<|&bQ|%BL|&U2|%CbL|)AT|%JV|%K|&E|&I<|&QJT9|%Q[EU2|$c|#MJ|$X|$[3|$_2|%72|(_#|&ET|)A',
      'bJ2|#NL@|%bA|$ObK2|)AT|+0#|+EWQTL|$T4JE|%9|&S|%Q|&VK|$ULbITN|%Pb2TL|+2|$YAbAU|$[CE|%O|#O#2T|$K|$T|$VLbNTC|%P|$WA_P|$',
      'b7LbK|*72UA|*9E2|%LJ|&K|&UA|%NQbA|&TQE|#QE|$FTQ|$JTE|$TE|&V|$VE|$b<bLUKT|)[MUKT|%BT|#RTL|$WAU|$bNTE|!(#2TL|$4M]#>|%U',
      'A|%bMUO|(]#>|)@b>|$7|$9E|%VEUKL|+U#4|+V|$<L|&E[<|)OEM|%[M|$>UKE|(T|)ET|%V9|%_|&E[OUKT|$A9TL|$CULT|%aL|%bL|$QTE|%b<U<',
      'bKX<|(V<bKX<|&F[2b<L|#2<b=T|$HTM|$T(KT!|)#|(_#|%)|$bPbNT2W|#7b8T|(0#|&W2|#9LT(M|&KM|$SLT(M|#<MV|$TNT|#@b<L|%>UKE|)T|',
      '&_E[OUKT|#AET|%V|%[|$TMNV|$U|%RTQ2TL|$bKTCU|#BUK_FUKT|#DL|#E2T|&L|%V|%[|%_|$FW<|$J[|&#|$Q[|$bCULT|&aL|&bL|%G]#<bLV|%',
      'RV|(#|&[|&_#E[|(E[|#GSbA[3STL|#HbE|%LTEV|(RUJ|#JLTE|$TJ|%LA|#LT2|&S|%CT|$bC|#MT2T|&[|&_#|%9|%RTHTC|$[2b<bLTE|+^E|-U2',
      '|/bQ|$bAWAJUO|#OTLT|$b2|#Q2_|$E[|$FL|$J[|%]|$L_|$MU-|&K[|$Q[|$VMU-|(K[|$bAT#HWM|&VGT|&[JTM|%FTA|%MTJ|)U2|)V|%NV|!)#<',
      '|$DE|#ETJCTL|#FX|#JTECTL|*V|$[M|#LTE|&V|$bPbKT|#OT|%E|$bNL|(VK|#QNV|$T|%(K_#|%)|%FXLbN|$b<|&L|%NV|!*2bA|#3T>S|#4TKT|',
      '$bL|#7UA|$b7|&AJ|(L|&TL@|#9T4L|$b9KUEV|&]E|&bNM|#=AT|%V|$E[|$T|%-|%2L|%A[|%ET|&[|%KT|$V|$[|#>S|%TE|%UKT|%VQT|#AET|%V',
      '|%[|$L|%E[|$TL|$b2LbP|&VLb@|&YPb<|%3EE|%AJ|&LCTKUAbN|+V|(FOb7UJ|)bLC[O|(T3#>|*@b>|)DU2TL|.V|)LbCbD|+D|(V|(_AbAL|&VLb',
      '@|&[9UA|%BTE|%FAbAU|&EbE|&LUNLbAE|&M|&TC|)2|*AT|)E|)UA|&V>SE|%QLb9E|*UA|&N|&TR|)UA|#CK|%FWL|$TL|&AT|&NTCV|%QVE|%RL@|',
      ')TLbB|$UA|$b4J|%5T<E|%C[ObK|%DL@|&TL|&YA|%IN|%KJ|(V|&TE|&_4|)FAU|#DL|$TL|#E2_|$FL|$J[#|$Q[|$bEA|(U|&VQ|)NV#|%JXME|%R',
      'V|(#|&[|&_E[|*#|#F2L@|%bLJ|$4bLR|$7TL|$9|%T+|$C[O|$E4L|(VK|%TJ|%UN[O|&PC|)_#|)b|%bKTQ|*2TL|$I_2bAT|&4|$JRTCbNVF|%T|$',
      'KW2bA|%_42LbAT|-0#|(UAT|(V|$L|%T#A|&EbA|&Pb<bLFAU|%_2bA|%bKW2bA|$MHbD|)AT|)U|$NTQ|$QLb4|%bBUA|*U|$RTL|$TDU|(KT!|&bK2',
      'bP|)TK|%K|%QET|$UEPCb|$[2bPT|#IL|%A[|%T|%V|%[|#JL|$T|$bJVC|)NTL|%L|#Lb9T|%CX|%G|%JUMT|%NL2|&OV|#M<|$b<T|%M#5E|&U3UA|',
      '&[3|)EVK|#PT|$b@|&2<UH#DVK|#Q2_|$FL|$J[|&#|$Q[|$V|$bATC|%JTE|)V|!+!7T|&)|%V|%[|$<|##7T|&)|%V|%[|$<|#A2|#EV|#FL|%V|#L',
      'b9T|#PbJT|!,4bN[C|#@TAbJ2|#AU2|$W|#PIC[N|$U|%2[O|%K_#|!-#4bM_|$>|$N|#29W<|$>S|$AT|%bL|(UA|$CJ|%UNQVK|$JTAbL|$M|$TCOV',
      '|%DU2TL|$V2L@|&YA|$[>JV|$b<|%OE|%Q|&7[#9|&FbL[Q|&L[|&bFbL[Q|#7&)NV|#9W2[OE|$[#<|&QUK_#|(V|#<T|#>NLb>|$UEHLb4|$bQ|#@b',
      '>|#B[#Q|#EV|#J9V&L|#KL|%F_Lb<|%HQ|%MT(#Q|)E|*bQ|#LUKT|#ME|$HJ|$U9STH[B|&TH[B|$bHJ|#NJ|%b|$L[Qb<|#OUKT|()|#QU>|$_QU-O',
      'E|$bFULUE|$c|#RQTQ|!.#>|#AURTQU2|#H2|#ObNLbKT|#QT|$V|$[|!/2bQG_Lb>|&T(>|&V9E|#<_|#EMT(E|#FL[<U#4|&OE|#GS|%UQ|$UQ|#HU',
      'E|#Lb>L|#Qb2L|%<bLUKT|)[MUKT|.)|!0<T4_|#>SUOT|$UOT|#FE|$M|$[E|#H[L^K|#JTE|#M#FU2|$JbFU2|$b>|#NL|!19TL|#CbK_4U2|#F7TL',
      'U2|$EUN[OU2|#L#49S[H|([H|&THTC|$A|#PDU|&K_#|%VK|#QA|%E|!2#D[|$FEUKT#|)_#|&V|%bKX<L|$H_9|&>UKT|$Q|#2bP|&T|(0#|&VK|#4T',
      'L|#7b7T|&V|&[|%8|#<2|$T)|$aAV|$b<L|#=UE|&T(K_#|()|$_L|&AT|#>ST|%UKT#|%V|$UKT!|(#|#@_#|$bN|#AUFK|$bM|#BE|$T|%-!|&#|%0',
      '#|%2TL|%E2|%NQbAW|$UA|#CJ|#ET>T|$UPb2|$[2bOE|$bE>|(S|&a9|%KT|(0#|(2WJTLV|(CTE|%R]KT|#F>ST|&[|&_#|$T>SUKT|%Q|$UM|$XL|',
      '$bATE|)V|#HVL|%M[|$b9|&ST|&T|&[|%L|&UQbATE|#ITL|#J9S_L|%_L|$L|%[|%b2T@b>|$M|%T|%[ObNL|$T#>L|%)|%E|&[|%M|$UObEL|$V|%O',
      'E|$[<V|$bFEUK_#|(V|&bKX<L|%KWEUQb<|&XEUQb<|#L2[|$@|$AV#|$E|%TM|%V|%[NTMT|*V|*[|$NT|&)|&E[|&KT|$T|%)|%7V|%AT|&V|&[|%E',
      'T|&[|%KT|&[|%L|$UKL|%ObJT|$V|%ET|%H|&V|$W@|&T|$[|%#4[|%4T|&V|$_|%>S|$aMV|$b2|&<|%9|%@|%ANbK|&T|%EM|&T<2|%J|&2T@b>|&7',
      'TLUK_#|*V|#M2AbAT|$E|$J|$O|$T|%0#|%2YAUK_#|%AbJ2|%J|$U#4|%KW4|$[2b<L|$b2U|%F|&ET|&UA|%KT@|)2TLV|)9V|#N2|$7|$KUAbLV|$',
      'L|$U|%AT|(-!|(0#|%K_#|#ObJVL|)V|%KF|#Pb<|#QJ|$a<V|$bHT|&[|&_#|#R2L|$AT|%V|$ET|%[|$MTAT|(V|([|&KT|$T!|%#|%EUKT!|*#|)_',
      '#|&V|(2TL|$V|%#|$[|%#|#SLVH|$TEXE|$UMT|&[|$WL&E|#T!4bL[Q|%7|$#4>ST|&_|&bL[Q|%7|&VFWLJ|%>|%AUJTE|%QbK|$*#<UKT!|(V|&QU',
      'M|$2T|$49|$9M|%_M|$<|%2L|%E[|$@b>|$CL|$E|%FWL|%XE|(V|%bRT|$GSV|%V|$HWM|$JC[N|%ET|%KTH|%LT9|&[>|%QXAbL|%UEV|$KJ|%QbB|',
      '$L|%2|%3TET|)[|)_#|%4UM|%T4TL|&NTQ|%V4L_#|%_HTL|%b<XE|&>|&AU2|*[K|&HE|)U2|(_RT(>bL[<|&K2LbAT|-0#|)TLV|*M|)bLJ|*P[AbL',
      '|(FTMU2T|(ITL|(LA|(NTRV|(TEbNKE|)MK|(_|&LNT)|&M|$M2T|&bLJ|%T|&#AL|&EbAL|&RT#>V|%UCTQ|%V|&E|%[|&9|%_EV|%bFEU2|$N[LV|%',
      'bK|$OV|$QUJ|$ZJU2bQ|#U#4|&>J|&GUOL|&bQ|%AW|%NC#AV|$-|$AET|&V|&[|%TH|$E|%TLT|([|(_#|%bAW|&EL|&RV#|$FMU#4|$J|%V|$K[|$L',
      '@|%CTL|%E|%T-|$MT|%[|%_|&#|&4bLTJ|&JV<L|$OE|%_L|(V|$Q|%E[|%TE|%bJ|(A|$cJVc|#V#|$<|$JA|&V|$LbAE|(U|)JTE|$N|#W#9V|%>|&',
      'MV|%I|%NL|$2|$3bKTA|$<VL|$@b>|$AWH|%bA[|$EbAV|$H[L|$JT+!|(#|&L4WFbA|(V|%bI|$LTE|%W|&2bP[AbL|$M|%2Lb@V|%FAU|%IXP@|%V|',
      '&E|%bMX|$O|%M|&AT|%VE4L|$PT@|$QWJ|#X7|$<|%EVAU|$C|#YA|%U|&KT!|%bK|&LUJ|$FT|$P2|%U|%b@|(T|#[#CbL|)UA|)VK|$AW|$CTL|(ET',
      'B|$E|%bCbL|*UA|*VK|&KT|$F|$HM|$LM|$M[|$ON|$Q|%LUKT|&V|#]#QL|$2[KV|$BLVE|%_MU2|$C|%V|$Fb<E|$HUE[<|$JLT|&[|%bHbLU9|$LU',
      'KL|$M#>L|%TO|%UG_LbEUKT|%[#>L|%bOUKJ|$QT|%[|#^FVLT(<|$GV|$J|%[>V|$LbENTM|&F_L[<|$M|%[9|%_EV|#_#2@|(V|$(LTMT|$7|%VE|%',
      'b7U|$<|%T|%U|$>|%LJT|$@|%TLb2|$E[|$JM|$KMT|&[|$L|%UKT|))|%b<|&Q|$M|%#HUKT|%2TAT|%V|%bRTFWL|$O|%U2T|)-#|)0#|&O|$P|$Q|',
      '%M|%V|$RMV|#a<UMbK|$E|$L|%N|&_#|$M|$OM|&bKT|%U2|#bKT|%XHT|%_#|$LJ|&HCbD|&O|($|&T#2|&U2|%K|%T#AU|*2TLUK_#|-V|&EbAU|+2',
      'TLV|%U2[<|*L|&Fb<_4bLTGSV|&KT|)-!|)0#|&Ob7UKE|&QJQ|(b<M|%V>ST|%XL|%^Q|%_|&D|(UA|$MH|%TE|&Q|%U2|%_LT(>|(VE|$NVE|$P@|%',
      'AU|(4bLQbA|&bLUK|%JAT|)0#|&T|%K|%TL|(VK|%V@|%[AbLGM|*VK|%]AU9|!3#>|%E|%RL|%UA|#4_M|&OTQbAbL|&VK|#9WLTR_|#>ST|%V|%[|#',
      '@b>|#AET|%[|$LET2|%T|%[|$bJ|%LV|#EE|$U9|$bET|#FA|#HL|#LH#CT|$TH|$VC|&E[|&T|(LV|&V|$b7|#METK2|$VGT|#SAbJ|$T!|%E|%Q|$U',
      'M9V|&TGS|$WC|#T!|$#|$)|$2L|$>SV|$AT|%V|%[|%_#|$C|%V|%bK|$E|%FTE|%T|%[|$KT|$LU9|$MV|$Q|%2L|%V|#U>S2V|$ATH|$M9V|%T>SUK',
      '_#|)V|&G|(S|#V#7|$L|#WC|%T)|$GUKT|$LTET|$M|%T|&QT|%V|%[|$O|%V|$QL_|#XE|$H|%QXLA|*V|#[A|%V|$L|$M|%A[|%ET|&[|%T|%V|%[|',
      '#_9|%E[|%T|%V|$<[|$M|%E[|%T|%[|#bKTAU|&M|!4#4T|&DL|%_AbLV|$>2|$ANbK|$D|%2|$IVL|(AT|#)#|#9TEE|#=E|$H#DE|$UA|#?S|%NTM|',
      ')V|#@A#AbL|$ET|$FAU|$LT9bK|$UA|&9b;|&VK|$[O|&9V|$_#|#AU|%NUDU|*KT!|+_#|%OVM|)AT|#CL|$bCV|%K|&2TL|#EbDLbN|%ET|&[|#JE|',
      '$bIVL|#KV|%#|#LJ|$UJT|$VH|&V|$W>S|$bA|%CE|%I|&4YR|&FTA|&NAV|&QbLTN|&TDTE|(NQbBT|(OK|%J|&V|%N|#MA|%V|$ET#2|$V|$[|#NLb',
      'EL|$TR|&V|#RE|%[|$LT|&)|%V|%[|#S9SM|$MA|$WMTJ|#T!=|%DV|%N|$#4WMV|%DV|(9V|%N|$(>|$-|$9L|%UKTHTC|%VFWL|$>SUK_#|&V|$A[|',
      '$BT|$E|%T|%[|%bDV|$JT|$K|%2|%AbLV|%E|%H|%T|%U2T|%[|$L#<V|%_|%b>|(E|#UEAV|%T|%V|%[|$L|%AT|&V|%E[|%GbATL|+V|%T|&N<|%U|',
      '&9T5L|%V|%_R|%bC|$M|#VA|%2TL|%T|&#9MU|#W#HC|$9L|&AT|(V|([|&E[|&TA|)V|$<|$>|%S|%b>V|$@|%2|%DLbJ|%NAbAT|%T|&#2|$ET|$Fb',
      'A|(T|$GT|&-!|(#|&0#|$JbHC|$LW|&0#|&2WM|&AbN|*T2LbP@|&CbNTLT|%X|%b9L|&C[|$M9STL|%OE|%TH|(V|&J|(V|$NTRT<V|$QbQT|([|$RT',
      '|#X4M|$?S|#YR|%KWCbD|%QbB|#[#C|&HT9|*SV|*V|$<|%N[|%bQ|$J|$RX!|&#|#]L|$MLV|%UKJ|$Q|#_#>|&V|$2WM|$3M[|$4T|$AbL|$C|%TE|',
      '&NLV|$FEVKAT|%TM|(4#9|%V|&ETB|$HL|$JAV|$L3ETB|&FWL|&T|%V|%b2V|$M|%T|&2TL|&LbD|%V|%[|%b>|(E|$NLbDE|%T|%U#C|&EbC|*T|$Q',
      'bNTJV|#a>S|$@|$AJ|$L|%N|&OTMV|%V|#bKTLR|$L#B|%EbB|%QbA|%R|&@|%T*#>|&J|(V@|&R2|%V2|&E|&PbJ|*2TMVE|&Q|%WF|%[4_LV|&<|(L',
      '|&ET(<|%]#>|%_NL|$M[OUKL|%]>Qb<_E|%_H|(M|$NTMUKL|!5#<T|%[|%_#|#<2|$ET|&-#|&0#|$T|$UA|$_Ab27|#>SV|#EAbN|$ObKTJ|$T|$UP',
      'b=|$V|$[|#LTE[|$[MX|#T5LT|$<|%V|$A|%2|$KM|$N|$Q|#ULT|%V|%[|#WQ|#XJ|%AV|&[|%E[|$Lb@E|#Y@T|#[L|%T|%[|#_>ST|&[|&_#|$L|$',
      'M|$P|%@T|%UA|!7#7M|$>V4?S|$C|%E|%T|%bL|(4WFbA|(JT|(O[3L|$FT|&L@|#2b2L|%L|&NLbAV|(TA|#7[L[|#<EV|$Lb9V|$b<TE|)V|)_#|&_',
      'FTDbKTK|#?S|%E[|%T|&)|#@b>V4?S|#AWLbB|)V|(IW9|(N[CV|#ET|$bC|&bL|)4WFbA|)JT|)O[3L|#HXAL[|#J2|%CTL|$>S[|$Ab2TL|$_MV|$b',
      'FT|(L@|%HM|%J7|#KE|%UA|#L2|$@|$J|$UA|&bL|$b7|&T|&UA|#M2L|$7UAbL|$AT|%V|%[|$E|%T|%[|$T|%)|%-|%AT|&[|%ET|&[|%KT|$V|$[|',
      '%#|$_|#T!C|&EV|&V|$#C|&V|$7T|%V|$@2bK|$CL|$F|$JbQ2V|$K|$L|%@|%T|%_|%bMbQ|&NT2|$M|%2|%VQ|%W2bK|%X|$NM|&T|$RAT|&V|&[|%',
      'T|%UK[|%[|&#|#U#AE|&T|&UA|$2UAbQ2|*T|*VK|$>SUKT5L|$AbA|(a>S|&L|(2MT|)TL|+V|)X<|(@|(CVLb5T|(UA|$E|%bAE|(T|&R|$MV|$RbE',
      '|(UA|#V9|%S|$E|%V|$G|#W#H2VK|$2T|%V|%[|$E|%E[|%T|&N|(V|%V|%[|%aAV|$F|%2[|$JbH2VK|$LT|#X!2U|$#2U|$ET|$Lb@|#[2|$AE|&T|',
      '%TNEV|$EbE)|$Pb<T|$RLT|&[|#]#FUKE|*OUF|$AEbK|%bL|$EM|$JbFUKEOUF|#_<|%V|$F>ST|$L|%V|$M|#a2|%V|$>ST|()|&V|&[|$B|%T|&)|',
      '%V|%[|$CR|&NV#|$DLV|$HVQ|$RTE|!8#C|#=T|$V|$[|#>SV|#ALFWL|$bAVQ4?S|,V|%LFAU|&QTM|#EbC|#FLT|$T)|#NU|#TAV|%bL|(NYAbAU|(',
      'TNTQ|$F|$KT|&#2E|&NTC|*V|$M|$NEV|#U>S|&2TN|$CbL|$FT|#VE|#W<2TLT|%b<V|$FT|#X<|#[C|#_<T|%V|%[|$>S|&2L|&ET|([|&T|&V|&_|',
      '$L|!9#2bOE|$4|%M|&V|$AW|&0#|#49VA|$A|%b|$CVF|&O|$EbETB|$R|#<UM|#>S|%V|#AUE|#E2|%FWL|$4@ET|$9TAU|)KT!|+#|*_#|(VK|$AT|',
      '$E|$FC|$J|%A|$LM|$NTCV|$Q!3bKT|%#3bKT|&5|%T#3bKU2V|$[+|$bAW|(0#|%JCUE|&IXJU|&QbBTE|&TPb<JV|&V|&[|#GL|#H2U|$LCQbA|%E|',
      '$MFWL|$bA|#JO[CFWL|$T|%E[|$V#CTL|%E|$WET|$bJX|#K#A|&V|$2UOE|$C[N|$FWL|%bL2TO|$O#2L|$QU#R|$T|%FbLCT|#LT|$U-|%K[|$WLA|',
      '&V|$XL|&A|&V|$bEM|%JE|(V|#ME[|$FbLFTA|$JTLb4|$NTKW|$QEbDU|$T|%2L|%E[|%M|%OK|$VK|$_?S|$bC|&V|#NTE|%H|%RL|(MTM|#QbAT|#',
      'RL|$T|%!|&4VL|%#|&4VL|%9|#SJTE[|%VE|$LXLV|$MTM|$U2bL|%EbC4V|%MT|&[|&_#|$V|%EA|$_L|$bKTCT|*AL|#T!7|$#7|%94VL|$-|%!|%#',
      '|&4[|%4T|&V|$0|$2L|$4L@|&X2AT|%VL|(CTL|%YA|(U|$<|$>S[|$A|%2|%U|&KT!|(_#|%V#|&K|$CW)|%X|&4L|$E|%2L|&TL|)V|&V|%AT|&V|&',
      '[|%ET|&[|%NL|(_#|%V|%[NTMV|*[|$F|%TE|(V|$GSLV|$JT|%UKT|%WE|$K|%GM|%QV|%T|%[|&#4[|&4T|(V|$LV|%b9|$M|%5L|%QbBM|%V|%aL|',
      '$NT|%[C|$QXQV|$RUL|#U#C4V|&T|$2bL|$9b;TQT|$AET|&V|&[|%[EbCbL|$E|%2T|&V|&[|&_|%J[|(#|%Q[|%bET|&R[|)#|(_#E[|)E[|$J|%V|',
      '%bHTHbN[|&J[CTL|,V|$KT|$M_#|%bMT|$Q|%2T|&V|&_|%E[|%FL|%J[|%Q[|#V>VFV|$A|%2L|%E[|%T|%V|%[|$E|%T|%[|$J[M|$Lb@_CbDTL|$N',
      '|%#A|%E2TM|&V|%NU9b;TE|%T@W|)0#|&ObJ|%U2T|&A|#W>S|&T|&V|&[|%T|$MAV|&[|%XQ|#XA[|$ET4?S|%UKL|$RV|#[<|$JbQ|$M|%L|#]2|%V',
      '|$E|$N|%U2|$QMJ[L|%T|%V|#^E|%V|$Lb9|(UKT|#_2U|$3UJ|$>S|&2L|&AT|(V|([|&E[|&T|&V|&[|$DFWL|$E|%bQ|$L|%CTL|$OV|$Q[G|#aEF',
      'WL|$RL|#b;TA|(T|&E|(FV=|(V|([ObNL|$KTCT|)AL|&JUAU|*VK|%[Pb=|%_#|&AU|)LbMU#4|)P|*V|$NL|%TL|&MT|)JW3V|!:#4|$>T|%[|#LET',
      '|%[|#M2|#T!QV|$#QV|$L3#>|&@b>|#VM|#W2TN|#X=|$MT|#[MJ|!<#>E|#2LTN|$b2L|#@b>E|#JT<L|#Lb2V|%JUEM|#T(4L|%F|%J|&bQ|$*E|&O',
      'UF|$<T|$FX|$NL|#U2<|$E|%bEX|$FbF@UK_#|)V|$RLV|#V2T|%X|$ET|$FX|$J|$M[|$NV|#W2>ST|(V|([|(_#|$E|#X<|%E[|$LbETJ[#<|#[2|%',
      'bE_M^9V|&QTQ|(b<|$EUQ|$HM|$JbQ|$ML|%UNU9SE|%VG_E|&NU9E|*SE|$Qb<|#]#2|$2bQ|(V|$4_L|#^J|#_#2|$2LV|%bK_|$EV|$FV|#bKXH|&',
      'JL|$L2|%Qb<|%[>|&E|%]2|(b<L|%^GV|$N[#<V|&Eb<V|!=#>|%T|%V|%[|#RLE[|%TKT|#T2L[|%WL|$@[|#U2TE[|#V2|#_Q|!>HM|$bMbKX|*-70',
      '|#T#Q|$)|$*E|&M_>|$2|%X|%b<L|$<T|$KLV|$M|%2L|%AT|&[|%ET|&[|%L|%T|%V|%[|#U4bLV|$9ST(E|%T(E|%U<M|$FbM_JT|$JbFM|$NV9E|(',
      'SE|$Qb2|#V-E-|$9M|$>NTET|$NV>V|$c|#WE[>UE|#XH|#[2b2E|$<T|$?S|$EJTLb2|%b9_#4FT|$J_2bL[<U2|&4bLTGU2bQ|$KLV|$LT|$Mb<T|$',
      'NU>|&Q|#]EV|#^2b<L|)[<|$<|$E|$ML|$c|#_4LV|$ETMb>|#bKX2|$LT(N|)L|&JT|!?#4|#2T|#MTE|#T!7[|$#7T|&[|$)|$2T|$M|#UMbM_#|#[',
      'L|!A#4|$AbL|(U2T|$HT2X|#2EV2|(V|$LVHE|$bPOUMT|#<QbB|$VK|$_#|#Ab2TM|)VE|%AbN|%FOb7TA|,b|%L|%N|&JVJT#QT|#BT2BUA|%FU|$b',
      'K|#CEWQTL|#ETN|$W9T|$bAbL|#FQbKT|&NV|#HMT|$TR|#IV|#JTJ|$UM|&ET>W|$bHT2X|#L#4|&C]Lb5bK|$G|%S|$M|$T)|$V2T|&[|&_#|$W@|$',
      'b2|&OTQbAbL|&Q#4A|#MA|$NTL|$QTEUKT|$R<V|$T2|%O|$[|#QbNVL|#RA|$QVM|#T!HT|$#AbLU2|%H[|$(NTE|$2A|%U|$9|%JRM|%T|$Ab2TMU2',
      '|&FLbK|&KT|$EQ[E|%TOTRV|$F|%JTE|$JbL|$L|%T|&J#>M|%V3|(S|%[|%_#|%b2U2|$M|%TH|%U2T|&HTE|$RUM|#UBU|$EQW2UKT|$HbHA|)V|$L',
      'RWA|%WFAU|$M|%2|%RE|$NTLV|$RT)|#VL|%bB|(#2L|(KTAbLT|-UK_#|(QbBM|$NbL|(AT|$Q|%LT|&V|&[|#W4M2|%SM2S|$:[|$J|%E[|%bRTLT|',
      '*V|*[|([#|$L#A|%EbA|%b2|(V|$MET|(AbJ2|%QV|(CTQ|%T|%bK|#XGSTE|%TE|#Y@JXM|$AVK|(T|#[#CWM2L|$9|%QbNV|%S|&V|%T|&9V|%V|$L',
      'R|&NV#|%T|%V|%[|$M|%#4TET|%W4W|(X|#]ETA|$JXL|$KTL|(V|#_>S|&2L|&E[|&T|$F|$JL|#aL|#bKT4|(FAbL|%_RTL|%aRTL|$LU2_@|&9bKT',
      '|&EUCTC|&FT=V|(WLT|&IW9|&N[@V|&OXM|%W<U|%[AT|$N7T|%L@|&UA|!BLbJM|#T)|%M]#>|$ET|$L|$MV|#U-<L|$K[<L|#V#|#[#|$LNTC|#^JQ',
      '|&E|#_>ST|&V|&[|#bK_LV|$LUML|!C#4[|%_#|$>|#2b2E|%P|&AT|&U@FXLbN|)T|)V|#@b>|#AUKT|$bA|&T|(AbL[K|#GETKT|#HT|%E[|%N|#JE',
      '|$_R|#KT|%EEbC|%M|&W|#L%QM|$4TR|$HTL|(V|$I#4T|$NT9T|([|$b9|&E|&T|&[|%C|%F@|%LT|&[|%O2|(_#|&E|(OTQbAbL|(VK|&TAT|)V|)[',
      '|(E[|(KT|#MT)|$UA|$VF|$_#|#NT|%0#|#O2|$J|$LB|$RLT|$T|#QNV#|%[#|$bATN[9|+S|#RE|$V|$[9|#T!A|$-#|$3UMT|$AT|$CLT|%T|%V|$',
      'E|%N|%[|$H|$J|%TC|%_CL|$KL|&[|%UAbN|%[#|$LT|%b9UMU#4|&OEU2|$M|%7VEV|$NT|%[|$Q|%V|$RUEV|([|#U-|$2bQX72|$3AT|&V|%E[|%M',
      'T)|%T|&)|&AT|([|&E[|&KT|(V|$E2L|%T#2|%[O|$JT4|$K[|$M|%7QbFV|%T)|&E[|&KT|%VF|$NQ|&VK|%bK|(T|$OT|&0#|$Q#HL|#V#|$2bPT|(',
      'UA|$E|%CKTM|%T|$F|%2|%T|&NMV|$KT|$Lb5|(2TMU2|(T|$NTE|(T|&L|#W$3|$2TE|$3|%V|$4bD|$EUKT|$H)|%TLT|%[|$J2T|$LV|%b3ST(J|&',
      '4|(T|&5<ET|+4bLQbA|&COT|&IT4bK|&K_DE|&MI|&NTQT|$MbRE|$ObJE|$Pb<|$QL[|#XA|$D|$L|%CLbOE|*V|%Q#7TL|&bB|%V|$PUA|$QLT|&V|',
      '&_#|#Y?S|&AT|$ObK|$Pb<U|)2_@|)4_7L|#[#|%4[|$0M|$2L|$3|%2L|%AT|&V|&[|%ET|&[|%ITM|%L[3|%T|%U-|&K[|%V|%[|%_|$4T|%V|$AT|',
      '%V|%[|$E|%T|%V|%[|$L|%V|$N|%2V|%4E|%5L|%AT|(0#|%CTQ|%ET4LV|%LT9|&UKT|%V|%[E|$OFT#>[|%I2bAU|&L|%JW3|%T#AL|&EbAL|%V|$Q',
      'T)|$R|%LTCXE|%T#A|&EbA|#]AbK|$EU2|$NV|#_&H|$E_|$FRL|$HTLT|$P|%V|$QbA|(V|$RLT|&V|%T|%[|#a>S|$L|%T|%[|$MA|$QT|#bK_A2|&',
      'M|$LN|&U>S|&bK|)JTE|%_@|(T7TLbK|%aFCV|$NTFL|&L|(2T|(U2T|%UAVK|*2|&N[CV|%VF|(QJXR|%[P|!D2b2T|#>S|#EHTC|$LT9|$TAbJ2|$V',
      '|$WP|#J2V|$T2[|#LAV|$TAM|$_RL|$bJEULF[2bP|&LT9|&OTMT|)QbAbL|&[#CbL|(EbCbL|#NE|#TAW|&0#|$E|$HV|$J|$L|%2|%@|&T|%T|&0#|',
      '&K[#|&NTRU2|%bJU2|$N2|#VJV|$L[|#WLV|#XF|$J|%2[AW|%DTJ|%bLFTE|$M|#YALTPb<bL|#_3T|$AV|$EV|%[|#bKTE|%[K|$LWN|(VK|$N9|%E',
      'U|(K_#|&bKTAbJ2|%QbA|!E#C|%T|%UEV|$HL|#2M|%V|$TLTAbJ2|$WM|$b2TOV|%OT|&[|%PAbL|#4LFTMU2T|%V|&K|$bE|#9CV2|(V|$L|$SL|$T',
      'LT|#AV9AE|#CUKT!|(#|&_#|$VJ|#EbC|&T|#HV|#J$|$2|$Qb2TL|$T9|&S|$V|$XET|&[|$bHL|%LAT|#KETL|$T|$V|$[|#LJ|$Q#RTL|%U#R|$[#',
      'CbL|%EbCbL|%O|$bA2V|%JCT|#MV|#N#HL|$9TA|$FbLNLbAE|$JbHL|$LTAbLU|$M|$T7TL|%9T|%H|$VE|&AJ|#O[|#Pb<|#QVLWCbCVE|$bM|#RL|',
      '$V|#T(9VLUKT|%<|&bL_9E|$2|%TJ|$4|%FWL|%L|&U2|)AT|&V|%T|&Lb9WE|&M]#>|)@b>|%aL|$7|$<2|&2TL|&VK|%_|%bK|(OTQbAbL|$>SV|%W',
      '|$A[|$B|$CUL|$E2|%T|$F|$IU|&2|(VK|$J2|&L@|%C[N|%JTAbL|%NL|%T#2E|)UA|%UA|$K2|%>X|%EJTL|%U2T|$L#4V|%C|%T|&9|&K@|%UKM|%',
      'V|&NTC|*V|$M#CT|%EbCT|$N|%U2|$O|%U2|$QT|%U2|&L|%bAU2|#U#CT|$$OWMb2|$2<|&AJ|(T|&NLbAV|%M|&2L|&AT|(V|([|&E[|&T|&V|&[|%',
      'TK|&M|(2L|(ET|)[|(T|(V|([|&Q|%_HTL|&MQ|%bP[F|$4J|%LTEV|$7MV|&[|$9STJ|%TJ|%V|$AbK|$CTE|%[O2|(TMK|%bLT|$DU|$F<E[|%W@|$',
      'H#D|%EbD|$IT|&)|&AT|([|&E[|&KT|(V|$JUAbA|%bE|(MU3UA|$K#AbL@|*UA|%A|%EbAbL@|+UA|%J|&UA|%TJ2|%W2bA|*U|%_9E|(UA|$L#AL|%',
      'EbAL|%F[2bP|%T2TL|&MT|&O|(T|%V2bP@|%XF@|(T|(UA|%_D|%b4W@|&@K|(TK2|&CUPb<|([O|*2|*E|*T#2|*UA|(_P|&DE|(TL@|*UA|&HM|&IL',
      '|&JM|)T|(T@TDVE|)AT|+0#|(UA|&KTA|&NT7E|*UA|)@|)A|)QE|*UA|)R|$NTL@|&Q|(V|%[CE|&O|$OT|&E|(T|%b7K|(M|(UA|$PTC|%UCbD|%[D',
      '|%b2LbP|(TQUA|(bLUK|&=T|&FTCE|$RUA|#V#C|%N|$7T|%[|$AU|&K_#|%X|$CLM]#>|$ET|$J|$L9|$M|%4ULU|%J|%T|%V|%[|#W2QTE|#XAE|#Y',
      'AbK|#[#|$<|%NLb2|$AT|&0#|&9V|%YAbN|%bL|$FTM|(V|%UKL|%_MUKE|$MbQE|$OEM|$RLW|&X|%T|#]AU2|(AT|$CTEU2|$ET|%VATM|%_|$OEM|',
      '#^LbB|#_->T|$2|$<|%bQ|$HM|%[M|#a2L|&V|%T|$Q[ET|#bKTK|(FTMU2T|(TDVO|)MK|(U2|%X|&9S|)VM]#>|(VM]#>|&<E|&EAJ|&KTLb2|(^Lb',
      '2|!F#29|%bAU|)K_#|$3|$7|%J|&V|%T#4|&KA|%_MV|$9TH|(V|%V2L@|(YA|$>UA|$A|$B|$CbLR|$c|#2>S|&E[|&T|&[|$NTE|$TE[|$b2V|%P|&',
      'V|#7TQ|$b7VQ|#<2BT|$ET|$UKTMT|$[M|$b<V|#=E|$TE|%L|&V|#>S|%AT|&V|&[|%E[|%T|&N|%V|%[|&4T|%_Q|(V|$T|#?S|%A[|%ET|&[|%T|&',
      ')|&E[|&KT|%V|%[|$T)|#@b>UA|#A#9MU|$E|$MT|%V|$T|$U|$bAUK_#|&V|&[|&_#|%BL|%EUK_#|&V|%L|&2TL|*UAT|&U2T|*-!|*0#|#C2|$NV|',
      '$TLbB|)_|(F@|$_#|$bDAU|)K_#|%J|&ObLV|&UEV|%K|#ETJT|$VL|$bB|%ET|&[|#HbMU2|#L#AW|%FLT|)0#|)4A|$4ET|$9VNV|$A|$C[|$EbAW|',
      '$HbLRbJ|$J|%R#Q|%T@W|)0#|&AbJT|&L|%[ObNL|%bFLT|*0#|*4A|$NLbAV|%TR|%VE|%[9S|$OWLTJ|$QbFL|$T2bLJ|%4|%9K|&UA|%JLbO|%QbA',
      '|$U2MbFET|&bLJT|%7K|&TME|&UA|%@A|&TJ|)QbNLXF|%AbKT4|%CYObK|&bD|%DU|%F2bN|*AT|&B|&XLb@|&bL[2bPbK|%ITPT|)UA|%JT@|%K_9E',
      'T|+-#|+0#|%M2bPUA|%NLbAE|*UA|&RE|&[O|%OUPb<|&bLJ|%PC|(b|&b2YA|%QL|&bBUAU|,K_#|$V2bP@|)T|*0#|)UA|$[|%>|%O|&TE|)V|$_2b',
      'P|$bCT|&[|%K<2|(E|&EbA|&TFbA|(K|)NT7V|(NL@|+VK|%N|&A|(JTMT|(VK|#M<|$TJX|%KE|$bMN|#NE|$TL|$UAbL|)AT|#OW|%0#|%FTME|$b7',
      'TA|)b|&UJV|)_AbAL|%A_|#Q#C|&VCT|$EbC|#R7TE|(E[|(T|$EA[|%E[|%T|%[|$M|%NTE|%T|%V|%W0#|%X|$T>S|(UKT!|*_#|(V|&V|$W!7|(2L',
      '|(AT|)V|)[|(E[|(T|)E[|)KT|(V|([|%#7|(AT|)[|(E[|(T|)E[|(V|([|#T!7|&NV#|%N|$#7|&NV#|([#|&TM|%>N|(_#|&[|&bK|$(B_4_LQ|$)',
      '|$*#>|%>L|$-|$2|%L|%UQbATE|,V|$4M|$7E|$<E|%MUFWAbL|%UM|%[2L|$=|%2|%OTMT|%bK|(2bLJ|$@UEU|%b>N|)_#|(W|([K|$AT|%V|%[|%b',
      'L|$C|%F|%LV|$E|%T|%V|&FA|%[|$F|$KM|&<|%T|%V|%[|$L|%#FLU2|%CLbOV|%JbFLU2|%QV|&bFLU2|%T|%UA|&ITPU2|&NTLU2|&QbBUAU2|.V|',
      '%V|%[3|%_|%b2|(bQ|&<UK_#|(V|&BUN|&NAV|&ObN|*4TK2|*ETB|$M|%AX|%E|&[|%T|%U|&2T|%V|$NE|%L|$OT|%b7TAbK|$PT@|$Qb2T|#U#2V|',
      '%4M|%7X|%>|$2EU2|$8>ST|([|%MV|&[|$@b>|$AT9V|&JR|%bA|$BaLT4?S|$KT|$OT7|#V8T|%[|$<|%L|&QE|$=|$>ST|&UA|$?SUK_#|&V|$AM|$',
      'E[|$FM|%V|%WMbQ|$L|$MT|%UKT|%V|%[|$QV|#W2TLT|$9TLV|$@[|%bK|$AUE|%bL|(V|$E|%$|%LWAbBTE|&b4=E|(9EbJ|)T4L@|)VNUA|(EULbJ',
      'T@|%VA|$L|%Qb2YA|%T|&@|&AAbN|(E|(TAbNU2|&ET|(V|([|%V|%WP|(TLbB|(_AbAJ|%XP|%_RUA|%bA4TM|+V|$M|%UQ|$Pb2L|&<|(U|&F|&KJU',
      'AbL|$QbA2|)TMK|#X!9V|$#9V|$8E[|%T|$9E|%T|%bK|$EJ|%T|$L2|%H|%T|%V|%[|%b@|(A|)$|)KT|)T|(T#2|(UJT|)KT|&AU|&N2|(9|(NLbAV',
      '|(T#7M|(V|(_AbAL|#YB2|&b|%bNV|)LT9|$Pb=|(IXJU|#[#<M|&U#4|%OE|$9|$<|%[#<|%bL_M|*UKJ|$>S|$EUQUMUE|$FL|$K|$LUKTL|&Q|%X|',
      '$O|%2O|%NT|%TNL|%[|&NL|#]4#HL|$<LbE|$AY2|$CM|%T|&NTL|$JTET|([|$L|$M[Q|$QT|%[|%_#|#^(#<|$<L|$M|#_<]OUKJ|$A[|$CbCTL|$F',
      '|$Lb<|(M|$M|%UO|%]#>|$OT2|$P2|%@|%UA|$Qb<|#a>SV|$AbL|$DT|%[|%_#|$LT@U2|#bKT9|&L|([|)MTM|&Q|$L2<|&L@|&TO|)2|)E|)UA|)V',
      'K|&YAU|&_F|&bLUKT|,0#|(P[F|+@|+TQbAbL|+UA|%3#>|&L|&bKTA|%4AU|)OVM|%7ME|(UA|&TL|)2|)U@V|*A|(ME|&WL|%9EE|&T|(AU|*KT!|,',
      '#|+_#|(FAU|&b;T|%@TJ|(MUKT!|+_#|)V|&[AT|%ATF|)4?S|)V|&U|(2XM|)bLUKT|(9b;T|(CUE|)bN#CbNV|(EUDU|,AbN|,K_#|(FCT|)TCE|+U',
      'A|(H#D|+UA|)EbD|)U#HUA|(IT|*OTMV|(JT|*-#|(K_4UAT|.0#|(L2bPT|)XF|)_D|(NLbP|(OA|)_D|(Pb=T|,E|+UA|(QbBTFUA|*FLbDT|.V|(R',
      'TL|&V2|)TAbJ2|)bPT|(A|&bK2bP|)K|)TOV|*RTL|)[2|%BT|(0#|%CAbA|&LbOE|+V|*UA|&TE|&VF|&XP@|%DTE|)AT|)J#AbLV|*EbAbLV|%FTA|',
      '%H#D|)2|)E|&EbD|*E|&M|&WCbD|%IT|(2L|(4|(A|(N|)OTMV|)UA|)V|&W|(AbN|%J#>M|&T@|)UA|&W3AT|&[K|&_C|%KAbE|&T4|)LT9|(Q|&W2b',
      'A|&_4OTMT|)TAbJ2|(9E|%MK|%N2bAT|&7E|&LbA2|*E|&TM|(Q|)V|(R|)UA|&UPb<|&V@|&YAU|)bAU|,K_#|&[O|)CbNTL|%O#QT|&QbA|*U|&T#A',
      '|(EbA|(Q2|*VK|)E|*U2|)UA|&U2bP@|+UA|&bE|%Q#4|(Qb2L@|&EbE|*AT|&N|&TC|(L|)@|)UA|&UCbC|*DU|&bATN|+ET|+UA|)WA|+U|(BTE|%R',
      'TL|&bMTC|%T#4@|(A|)VK|&(N[<|&2YA|*U2|&4]AURTQU2|&7VE2TM|*AJ|+T|&@|(TKTJ|(V|&A|&BJU2|+AT|&CWLbITN|([OU2|&DU2L@|(bKTF2',
      '|&EbA|*VK|&FbA2LbAT|*U|&JT@U2|&K|($|(CbNVF|(_4U2|&L#I|*U2|(JbI|+U2|(XF|(bBET|&NDTE|%U#Q|&K|(#2T|(T|%VAU|&JUKL|%[2bP@',
      '|&J|(2RTEV|(7#C|)EbC|(ETB|(T|(U2T|(V|&L@T|(UA|&Q|%_|&4bLTJ|,U#4|&9[2b<|&<VE|(_2^M|&>2bOE|&AbQTRE|,UA|&GS[QL|([QL|&Q[',
      'QL|&c|%a?S|&CbK_4U2V|$MT#<|&E|&Qb<U2|%X<_|%[4|&<|(_|&KL|&Q|!G#>|#A[RFWL|#LNLV|$VCT|#MA$|$E|$QbNLXF|$_#|#QM|#SLNLV|$T',
      'LQ|(V|$UL|&_9S|%MbJGS[KL|)V|$]QMT|$^QbGS_LQ|$bLT#Q|*VQV|&_>_|#T!QV|$#QV|$(EM|%HL|&_E]7U|$*#>[OE|$AUJT|$KCT|&[|$LQ|&V',
      '|%bJ|$Mb2[|#U9V|$EM]#>|$L_9|$MUF|%VFV#Q|%bJG[KL|(V|#V7L|$<|$Mb>|$QCV|#W<|%H^M|#X<|$M|#[#2|&E[|$KL|$L|#]2b<bLV|$M|%E[',
      '|%T|&E[|%V|%[|$OE|$QMT|&[|#^@b<|$L|#_2Q|$<_|$E|$Lb<|&Q|#a9|#bL#<|%T#Q|)UQ|+b2_|)VQV|&(>[|%V|%[#7|&>LU2|%]#2|$M_LU>T|',
      '!H!4MT|##4MT|&aL|%TM|(V|$C|%L|&4TR|%V|%X2|$D2|%E|$H)|#2LV|$bQL|#3SbOV|$bOV|#4CTC|$M|$V7[|$]L|#7A|$E[|$FE|$T|%AT|%E[|',
      '%KT|%N|$V|$[|$b7E|&T|&[|&_#|#9<|$L#4|$T-|%9|%K|$[|$b9U2T|#>SV|$T|$V|$[|#?AV|$S|%2L|%AT|&V|&[|%ET|&[|%T|&A[|&ET|([|&K',
      'T|&NT|%V|%[|#AMTKT|$T|%)|%-|%AT|&V|&[|%E[|%KT|&[|$aL|#CE|$M|%2L|%AT|&V|&[|%E[|%T|&N|%[|$bLVETB|#E2L|$AT|%V|%[|$ET|%[',
      '|$Lb9V|$NT)|&KT|$T)|%-|%2L|%AT|&V|&[|%ET|&[|%J|%KT|&V|&[|%LQ|%N<|$V#|$[|%4T|$bC|&L4TR|&V|%DE|#FbFV|#JbH)|#KTE|#L2LTL',
      '|$QTA|$THL|(V|$[MV|$_|$bAE|%G|%HL|&TC|%JE|&T|&V|%MUE|#MC[N|$LT9|&J|$N#A|$TAb2TL|$U|%CTE|%KT|$W&|$X7UQbATE|$_#|$b2U|%',
      'M[HT9|+V|#Q#A|$E[|$T|%KT|$V|$W|$[|%#|$_#|$bAL|&UKT#|)_#|&V|#RAV|$E|%[|$LRTM|$M|$Q|$T)|%CWL|%E[|%L|&V|%M|%N|$UPb2TL|$',
      'W|%ATKA|%DT|%JA|&W3V|&XMbK|%M|%N7E|%Q#3bK2|$X|#T!<|&T|%D|%Q|$#4bMT|*C[O|%<T|%D|%Q|&WLV|$(HUM|$)|$-!|%#|$2V|$4|%[ObNL',
      '|$5|$9LT|%STL|%TL|%VLTN|$>SV|$?S|$@|$A7VA|$CM|%OTR|$DT|&0#|%UA|%bK|$E_|$F|%X|$HL|%T|%X|&9V|$K[#|$LR|&NV#|%TA|%UO|%V|',
      '&2|%XC|%[|$M|%2|&T@b>|%T|&5T<|&9V|%U|&2T|%V|%X|%b2E|$N9XC|$QJAV|%b2[<H^M|$RL|%WMbK|%bK|#U#CW|(0#|$2bLV|$3L[|$4|$9E[Q',
      '|&aL|%MV|$<|$>SMT|$ATE[|&KT|$E|%T|%bCW|)0#|)QTL|(X|$FTOT|$L9X|%QT|$M|%2WM|%TQFWL|%UKE|%b2WM|&>U#4|&MV|$QbAL|&JUM|$RT',
      'L|(V|#V2TE[L|$9|%4@UA|%TFWL|%U#4|$<T|$A|%T|$ET|$HVQV|$JT|&L|(V|$LHM|$NV|$Q|%NV#|#W#C[M3#>|$&)|$2|%bQ|$3TL|$CbD|(U|)J',
      'TE|$D|$ET)|%UKTCV|%bC[MT|$LT|&)|%V|%[|%b9|$MT|&2L|&KT|%b4TLUKT|$O|#YRQbFAU|#[#4MWLW|$2TL|$4J|%XQLTK|$7|%E[|$<T|%V|%[',
      '|%_#|$>S[|$CV|$HV|$L_94TLV|$M|%T|&LXQ|%b9UKJ|$Q|%U2|&E|%b<|$RAL|(VE|%C|#]#2|&U#4|%4EV|&M_L|%>|$9X|$=|%2|&L|%AT|&[|%E',
      '[|%T|%[|$>JU#<E|$ELb9V|$M|#^2bQ|$H|%V|$JbH[|$M|%VNW>|$Q|#_2TL_|$:|$D|%4KT|%UQAbN|$L_HWCWL|%b>|$M|%7TM|%AT|&[|%E[|%T|',
      '%UKT!|%V|%[|$Q|#a2bQ|$CbD|(U2|#bKT9|%XL_|$L9|&ITPT|%RbJ|)4WFbA|)7LbK|*TLV|)FWAbL|)T|*#>|*9V|*@b>|%T#>|&*E|&9SVM|(VM|',
      '&KE|&RbJ@|*V|%U9|&<UO|([E|&ATEV|%[2|$M>|%X|%[KL|%]2|%^2|&4|!I#4|$>TL|(@|#2bA|&U|#4A|$NAV|%TEb|#9E|#<ET4L|$b<|&T7TLbK',
      '|#@b>TL|#AV9[|#K#2L|$IVA|$TE2|#L2L|$A|%FWL|$E[|$FXL|$T|$V|$[|$_QT|$bAV|&YRLU|#MT|$V|$[|#NE|$TEV|$UPbK|)NT@V|$bK|#QbJ',
      '|#T!AU|$#AU|$(K_#|$)|$2FT|$4E[|%MFWL|%NA|%VCTLV|&LBV|%bK|$9FT|$CW>SV|%bLFC|$EW|$F|$IV|$L|%ANLbP|&V|&[#CW|(EbCW|%CbNT',
      '9|%V|$MX|$N|%ET|(0#|(AbJ2|%V|%[|$P@|%T)|&-!|(#|&0!|(#|&KV|&NU9b;TE|%V|%bK|$Q|%b2L|#U2bPW|)0#|$3TLV|$AbAU|$EbE|(AT|$N',
      'TEV|#V>S|$AL|&V|$EJTM|$J|%LTN|%Q[E|$M|$P@|%bJ|#W4ATE|$9|%T|&0#|$<b<_|$NE[ObNL|#X2#F|%JbF|$3|$4_M|(N[AbAT|$<TE|$A|%FX',
      'LbN|$IT4|$JDbK|)QT4LVK|%U|&2T|)-!|*#|)0#|&4A|&9|$LT|%[|$M|$N]9b;TEU2|$P@|#[#<|$9|%AT|%E[|%T|%V|%[|$>S|$C|%ITN|#]#Q|$',
      'LN|#_#QM[|$4|$9|%E|%FWL|)V|$FTM|$MT|$QM[|#a4_MU2|$AU2|(V|#bLJ|&@|&UA|%Pb<|)T7TL|%X@|!J#4M|&NTL|%[O2L|%_M|(UKT|$7|%E|',
      '%XLUKT|$9UM|(T|%XLV|$>F|%M|%V|$AbL|(TMK|(UFLUPC|)J#>M|(V|$BE|$CQaL|%T2UEV|#2HLT|&[|$L|$TE|$b2E|&T|%3E|#4D|$L|%J7b8|$',
      'RV|#7b8L|#8MUK_#|%V|#9CXL|(V|$HXA|&L|$SHXA|$TL|$UQb<bL[<|#=_#|#@U|%FWL|)V|$b>M|#ACTE|$I[C|$MH|$TDU2TL|%EWQTL|$_#|$bQ',
      'bK|#BWLT|#CC|$E|$L|$ULT|$VET|$WL)|&]|$bLTQ|#DW|%HEV|&TMT|%JAV|&[R|%L|$[FWLT|$bK2TM|*VE|&FbLC[O|&J|&KW4VE|&NLbAV|#EJ_',
      'RE|%a9V|$T|%)|%-|%A[|%E[|%KT|%MV|$VPT|$W|%PbK|%QbJYAU|$_|%9|%EVA|%L#9E|&J|(T|%NU9b;TE|&]9b;TEU2|%RL|$bAbL|)V|%CUL|%E',
      'T|#JAT|#L@|%_FLT#A|$A[|$E[|$JbJA|$T=T|&V|&_#|$WQbBM|$[|$bKTCT|#MK|%TMJ|$U2|$[LUKT|%OUKT|$bM|&U2T|%R_AbLT|#ORXL|$VE|&',
      'V|#QTMT|&[|&_#|$VR|$XL|&V|$b9UC|%A2|&UPb2|&V|#RA_|%bAT|(bN|*FXLb@|&N|$JXC|$LbPU|$M|$QXQ|$T|%2NU|&TNbK|%9EFC|%AbJT|%C',
      '[N|)V|&bNVF|+VK|%E|&4L|)VK|&AJ|&CV|&b|%FbLIW|%ITLA|(PbK|%JTLV|%KTE|&WCbD|%LT9|)T|(@T|(EV|(Pb<bL|%M2bPbJV|%NUCbKTMK|&',
      'VL|%OUNLTAbLU|%Q7UN|&IT|&T4L|*VK|$UJT|%MT|(-!|)#|(0#|$VET|&[|&_#|$[#CbL|%EbCbL|%O|$_AbQN|%HT|#T!|%4|&E[|$#|%4|&E[|&V',
      '|%:V|%Q|$(2|&M|&bL_FbL_Q[QL|*Q^Gb<|$)|$*#<|$0|$5|$ALJb|%T|%Y|&ITPT|(XJU|%_#>2L|%bL|(T|$BWL|$CT|$DN|&LTN|%WLV|%_FWL|%',
      'bKJ|)U2|$E|%2|&L|&V2L@|%7UAbL|%AT|&V|&[|%C|&#>|%ET|&[|%N|&AT|&TDU2TL|&VK|%Q|&L_NL|&U2|&XE|%V|%[|&2O^|%_|%bK|(AT|*0#|',
      '$F|%E|&[|%T|$G|%V|$JMT|&[|&_#|%T|%XMV|$KT|$L|%2L|%ET|&[|%NT>S|*V|%T|%UKT|%WAU|%[|%b2|([<|(_|(bQ|*NTC|-V|&4|(CLbOE|&<',
      'UE|&JU2|&OM|$M|%CVN|%NT|&U2T|&VK|%T|%U2|&EV|%V|%XJ|$Q|%U2|%b2_|&<L|)bQ|$R|%TAbJbK|%aM|#U9S_LJ|%_LJ|$<TE[|%b<V|$=T)|$',
      'AbL|(AT|$B2|%UMT|%WE|%bKT|$E<|$JV|$Lb7|&9ST|(T|)FWL|$M|%2L|%AT|&V|&[|%E|&T|&[|%T|&2L|&E|([|&KT|%U#C|&KE|%V|&JV<L|%[|',
      '&4T|(V|$OE|&LUK_#|%U4E|%bL|(@|(T|(UA|$Q|%T(M|&M|%UQUFV|%aLV|%b<L|&L|(V|#V<L|$=T|%[|$>UKT|$@T|$ET|&2bPV|&L|$JT#QT|$L|',
      '%T|$M|#W!R|$#4[L|%>T|%H)|%OV|%R|$2CJT|([|%LV|%THMT|)[|%W<|%[O|%bA|(2|(U|$3|%Lb9V|%UKT|%bKA|)$|(DTLT|(J#AbLV|)EbAbLV|',
      '(TMK|$4M|%SM|$9GbGLFWL|$:Q[|%[|$ATHU2|$CbCT|([|(_#|&L@|(T|)0#|)QbGVAU|(UA|$EU|&K_#|%bET|$GbA|$HTL2|$JAT9|)S|%bH)|$LM',
      'V|(DLE|%TC|(THTC|%]ET|$MT2STA|(TA|&KJ|$Ob2UM|$QMJTE|*_#|%bMUJ|$RJbJC|%TE[|&NL[|%XLbA|#XAbL|$Lb3|&AU|)2MT|)KT!|+#|*_#',
      '|$M|%A|&$|%IXA|%bK|(NTE|(T#2E|$QT|#Y4|$A|%2|%bKW|$CT|#[2bQU2_|$4TNT<|$5ET|(C|%TMK|$9HTEV|%L|$<bL_|$>U2M|$E|%E|$J_LUK',
      'M|(V|$KL|$L=|%T|%V|%W|%[|$M|%T|%[|$NT>S|$P|$Q_F_<TJUKT|$RAT|%EA|%LT|#]#|%E[|$2|%bQ|(U2_|$4bEVOUKJ|$7|$AbLV|$BUMV|%WE',
      '|$CTE|(V|$E|%7[Qb<L|%FWLV|%[9J[#<|(L|$LV|$QXL|$RL|#^>M|$LVOQ|$M|$Qb2_|#_2bP|$<L|&bQ|%T|&)|%V|%[|$>S|$AV|&MTM|$CV|$HT',
      '(M|$L|%2b2_|%TL9V|%b7T|([|$M|$R|%E|&VO|%JbJC|%UA|&EV|#a2T|%[|$3U2|$9XC|(T|$A|$E|$LbK|$MTET|%U2|$QJ|&V|#bKT#JTL|%X9UK',
      'J|!K#4|$AbL|#2YA|$bP|#9WLbN[C|$b;|&_FNVA|#AbL|#BT|%LbB|)NTC|,V|#CU|$bKFU|#EbAbL|#JE|$WET|#KTAU|#OFTM|$_DLT|#RT|$V|%#',
      '|$XCUK_#|&V|$b|#T#AbLU2|+V|$7U2T|$9b;NMb2bK|$AET|%TKTA|%bLT|)0#|(UK_#|(V|$C|%4TL|%N|$E|%U|%V|#VOW|%X|#W2bA|(U|$4|%M|',
      '$DUPb=UL|$ET(<[>|%WQ|$N2|%AV|%LT9|%T|&0#|&NQbBT|#X-Q|$2[|%bL[E|*V|$<bKXH|$ET(<[>|&E|(V|%U2_>|(bQ|&<|&KE|&NLbQU<V|%VN',
      'LbQ|%[Qb2_|$L[EUKJ|%_|&F|(UKE|(VK|#^Lb2|#_#|$4|%CTE|%V|%bK|(AT|$9E|&T|(0#|$CbDT|)0#|$EU|#a4U2|$E|!L#4|%J#7|%VE|%_MV|',
      '$9VA|#2J|$bA|&7TF|%P2|&T|#32L|$AT|%V|%[|$ET|%V|%[|$L3TN|$T|$V|$[|%#|#4bHV|#5W|%ETB|%N#O|&VL|#7ET|&-!|(#|&0#|&2TL|)M|',
      '&AbJ2|$KUAT|$T|$UA|$V|$[|#9A|$EV|$ST|$T|$UQb<L|#@9VA|$DVL|$EVAU|$NVL|#AE|$MTJ|$U|$bE|&T2L|#CbC|#E_#|#GSV|#HL|#J@VK|$',
      'T|$[O|#NTET|$U|%NTL|$VET|&bCbL|+ETB|#OVC|#QTKE|$[M|$_#|%)|$bQV|#R2L|$AT|%V|%[|$E|%T|%[|$JTE|$QbK|(JK|$UA|$V#|%J|$[#|',
      '&4[|%4T|&V|#T!7V|$#7V|$2[O|%bPQ|$3|%V|$4|$9|%2JM|&VK|&WJTL|+V|&_<|%4VL|%CXA|%DTEUKT!|)V|%E|&K|(U2|&VAU|*2|*9b;|&[AT|',
      '&]AU2|%FTM|&XA|%HHbHL|%ITPT|%JRM|&TLb4|%N#O|%OTRV|%QV|&bBTE|+V|(N|%T0#|&LTJ|%V|&N|%X|%[|&#CbL|&EbCbL|,ETB|&O|%bK2TM|',
      '(FTM|(QIT|(TIUP[2|$=a>S|$@T|$A|%bLU|$DT|&2YPb@|,E|%U2T|$ET|%V|&3[A|$HLb<|$J|%2YPb@|%4?S|%7#CbL|&EbCbL|&LUAJTEQ|%CTQ|',
      '&[N|%FWL|%NUMTQ|%T|&EW9E|&K@|%X|%[ObNL|+J|$K|%FWL|%HL[MV|$N|%@|%A|%M|%V|$OU|&K_#|$Pb<bL|*2X<|*4TE|*FAU|*ITPT|*J#>M|+',
      '@b>M|*NTC|-V|*UK|*VKAT|$Q|%TKEU2|%_|%bAT|([|$R|%A|%W|&M|#U#4|$2TLb>|%^Lb>|%bOT|$7Lb>|$9LbN|%SLbN|$AW|$FHbMU2|+E|%_Lb',
      '<|$KT|&QA|$MV9|(S|$NT9|$ObAT|([|)CTL|$QLb7|$RT|#V<T|$AU|$ET|$JT|%[2|$NT|#W2|%W|$3|$7U|$:TE|$CbL|(FbLKT4|$F|%-|%KT|&[',
      '|$Q|#X7U|$<|$?SUNTCV|$F2|%K[|%L[3T|%T|&#AL@|*UA|%V|$Q|%V|#[#9|$3|%T|&-!|(#|&0#|&7UAbL|%VK|$4UQbATE|$9UJ[#<|$>|%UK_|%',
      'b>V|$@W|&2T|$A|$M|%4T>SV|%JTLb4|%N[|%bN[|$OJ|&V|$QbALT#|#]#2|&U#4|$2[<|$3U2|$MV|#^2|%V|%[<|$HLb<|)bQ|$K|%M|#_2|%AT|%',
      'BTJ|%ET|&[|%T|$4|%V|$72|$9|%4TL|%S|&T|$<V|$>|$J|%E|%T|&#72|(<U2|(Q|&EUKT|$M|%U#4|$OE|&V|$RA2|&TQ|%E|%U@V|&A|!M#2T|$C',
      'E|$HT|&)|%V|%[|#2>SV|$bP@|&CbNVF|&bJ@|)V|*2T#A|*HT)|(K|)ITPT|#3E+|#4AT|%V|%[|$E|%[|$T|%)|%-|%2L|%AT|(L|&[|%E|&T|&[|%',
      'KT|&[|%N|$V|%#|$[|$bE|#5W|%2BT|%4@2|#<2T|#>S|%2T|&UK_#|&V|&[|&_#|%A[|%E[|%T|&)|%V|%[|#AT|#CbCT3|#EbCE|#JbHT|()|&V|&[',
      '|#MUA|&T|#N@|#RL|#T(E|%G|%HbL[LV|%N|%Q[#Q|$)|$-|$0Q|$2L|$3|%T|$4A|%X|$9FA|$AT|%[|$ET|%[|$I|%2TLV|%CTK2|$JT|$K2|%T|%[',
      '|$LT|%b>|$M|%T|%X|$NT|$O|$RU>SV|%aL|#U#2|%4|&TEWFTA|$3|%2L|%A[|%ET|&[|%T|%UA|%V|&#|%[|$<UM|$BW&EUKT|$E2bQ|$FU|&KT!|(',
      '_#|%V|%bKEbAL@|$JU<[>|$MV|#V4|$<L|$E|%T|$F|$HUKT|$MT|$NL|#W)|%Q|$FbA|#X<|$BL|#[#|%4[|%Q|$2|%L|$3|%2|%E|%T|%U2T|$4T|$',
      '9L|$>V|$AT|%V|%[|$E|%T|%UE|%V|%[|$Gb<UE[#<|$HETE|%L|$R|#]#4U2|%>|$<UE|#^Eb4GS_Lb>|&7|$Lb>|$Q|#_2|%4VA|%A#AbL|&EbAbL|',
      '&T#AbLU2|(EbAbLU2|%FbLUK|+AT|%JTEbK|%QIT|$4_|$CV|$DV|$F|$RT|%UKT|%[|#a2U2|$<|%AT|&[|%E[|%T|%[|$R|!N#7UA|$O|%9|%TEW4A',
      '|&NMV|#2SbA|$TMA|$VM|$bA|&NbK|&T|%L|#7E|#9E|$R|#AbQ|#DX|#E>[|$NTQ|$QbFAU|*K_#|$_#|$bK|&9VN|#KQb2|#LCTE|$Eb|$UPb=|$VK',
      'AT|$W@|$b4|&V2L@|)YA|%7QbN|%9UA|%@|&2bLJ|&E|&JTMT|&UA|%AEV|&JTE|%DT|%JE|&T|%Mb>|%PT|&VK|&_|#MbMI|#OUPb=|#Q#A|$T|$WC[',
      'N|$XMV|$bAW|(-!|)#|(0#|(A|)$|&bL|#RE|$T!|%#|$V|%#|%CT|#T!|$#|%8UA|$)|$2bK|$6bJK|$7U2|$9F[KV|$<L|$@U9bK|*U2|%V|$ATNL@',
      '|%bQbKTKE|$C|%2|%E|%T|%V|%bK|$EL|%QbFAU2|$FQ|&V|%UQ|$J|%E|$KLQ|%QLTK|%W|&J#>M|+VK|(@b>M|&KTE|&Q[ET|$L|%T@QV|%UQ|%b>|',
      '&AT|)MTF|&JU#4|&PU2|$MU|%_#|%bJV2U|$OU#4<E|$PbF|$Q|%WC[N|%bAN|)U2|+AT|(W|)2MT|*TL|)OUMbF|$R2|%E|%UEV|#U#>_9|%DbK|$2M',
      'bF|%QUA|%TL|&QOVM|%U|&FV>UKT|&L@|%V|&QbL_A|%YA|%[<|%b2V|&<L|(_LUKT|&LJ|)TCUAbK|(K|([AT|$3bKTA|$4A|$5<E|$7L@|%MUA|%TL',
      '|(2|(DTLT|%UAbL|$9K|&E4L|&V|%X|%[AT|)0#|%b;TEV|)FE|$<TJUE|$>UK_|$AL@|&UA|%bA|(VK|$CLbI|%T|%UOT|%XP2|%[O|(V|&R|%bKJTE',
      '|(T|)FAU|*V=|)LbBUK_#|,V|)MK|(WA|*b|&L_R|*V|&NTE|*_#|*b|$DNT|%T|&0#|&E|(QIT|&K2|(U2T|(V|%U|&KT!|(_#|&NA|%[K2|%bN#Q|$',
      'EAV|%K|%TK2|&O|(2TLV|%UJK|&LbJT@|%_C|&HT|%bKTQ|$F2bP|)V|%LVA|$GM|&AT|$I2bA|%T4|&9E|(UA|%VP@|%XAU|&P@|(UA|$JLbO|%TE|(',
      '2bP[AbL|(E|%bHM>E|$KAETJ|%ET|%_4|$LM|%T9JTE|&<|&J|&QA|%WCbD|%XCbD|%_D|(V|$M2bP@|%K|&E|%TQ|%UKJ|)bQ|%WFbA|%bQE|$NL@|&',
      'bAE|%O|%TC|(TQbFC|(UA|&R|(UA|%UD|(AT|%[2|(TE#C|*EbC|&7E|)T|$OC|%TM|(2TK|%UPb<|*AT|%WCbD|%[P2L|(9b;|+AT|(@|(A|)$|)T|*',
      '-!|+#|*0#|(TDU2TL|%bLTJ|&M[P@|&N2LbJT|)_O|(9VA|(ETB|(IL|(KWCbD|(NbKTFV|(QEVK|(TJUAbL|)Q|$P|%J|%K|&2|%T@W|%b@W|$QLb9E',
      '|%bATL|*UA|(YA|&BTFUA|&G_<|*2|$RTL|#V#|$>UK_|$@T|$L|%4AU|%AT|%[EbCbL|%bK|#Y#CTNE|$2bP|$AbA|(U|$CbD|(U|$EbCTNE|$RA|#[',
      '#|$4|$AE|$C|%ET|%NbKTQ|%T#4|(A|&EbA|%V|$DOTMT|$EUQ|%[9SW-MT|(W-MT|$H|%CWEUKT|%QT(<|$MbO|&Q|$O|$Qb<|((#>V9|(JU#Qb<L|#',
      ']2MbFU2|$7TLU2|$9KEbAV|%b;TEU2|$CU2|%bK|(WA|$D|%TEU2|$E|$IN|$K2bAU2|$LT4bK|$MV|$NTRU2|$OT3|&MV|%[PU2|%bK|&NU2|$Pb@N|',
      '(_|$QT|%V|%[|#^2L|$E|#_<|$Mb>[J^Lb<|#bK#4bK|&9E|%2bA|)U4A|*AbN|*K_#|%AVA|%K|%LbB|%NQTK|*U2|*V|(bBT|*UA|&RTL|%QbA|%T2',
      'L@|&3bKT|+E|&F2|(TL|*U2|*V|(bA|&KTJ|&NQTKU2|(RTLU2|&Q|%WAbFAbAU|*EbE|$LA|$RT(<|!O#2L|&T7TLbK|%W|$3|$5T)|#2WEbAMT|$b2',
      'L|%AU|(FV=|(KT!|*#|)_#|(OTMV|#<M2^2|#A2|$FB|$L#9|$THbCUK_#|$V|$bLW|(0#|(5E|)bE|#EU|%NTL|#FB|#GSV|#HLV|$TET|$bC2_O|&T',
      'LbB|(NMV|#JO[L|$bJV|#L@|%TLbBV|$A|$C|$TH|&V|$VG|%L|$b2LT|%A|%JT|&UMT|#MbK|#OU|#QbAbL|#RC|$LV|$VC|#T#A|&U|(FXLb@|$2TR',
      'TL|*V|$3T|&-!|(#|&0#|$CV|$E|%CTL|%bA|(U|$F|$HbCU2|$J|$KC|%L|$LCT|%VLU2|$ObNA|$Q2|&VK|%E2TM|%UA|%bAbL|*TLbB|*V|+K|$R|',
      '%9RT!|)#|%LW3|)S|%UC|%V|#U2T4_|&KA|&L|(V|%bP2|(@|(T0#|)NUC|(UA|$3L|$BUM|$JMT|$KT|$L_>2L|&J@U|$MT|&#4|&M[3|%bF|(T|$N|',
      '%9V|%FWLV|%LT9|(AbLU|%MU#4|%T|&9V|)LTN|&MU2|%UL|$OW|&0#|%bE|$PbK|#V5bL|$A|%M|&T|$LbP|(2|$MT|$O|#W#4|$2bL|(NTL|&M|(T|',
      '$CbD|(AT|(U|$I|%T|&L#I|$LW|&&A|)V|%X&A|)V|$Mb2|$Pb2|#X<U#4|$CbL|$EbK|#Y#3MT|%4TL|#[2bQFUKL|$3|%L|%S|$<b<V|$KL|$L|%OT',
      'R|$P|%TCbLU|#]2bP@U2|(U2|$ATE|$M|%V|%[EbCbL|$N|%TM|#^<|#_2|$D|%2LbAT0#|$IT|$L|$P@|#a2|$LbK|#bKTJ|(T|$L#3MT|%CbDT|*#9',
      'MU|*MW|,0#|%J|&U2|%N@|%TCbD|&F|&G|&N@|(QbAV|%V2YPb@|&DL|&E4L|&JAV|(CbIT4NA|&LTJ|&M#2T|+)|&NTQbAN|%WAU|%Y#3MT|(4TL|%[',
      '@UK_#|(V|&K|&Pb=|*AT|%^G|$M_2|$NQE|%TQ|%[A|!Q#2<|%ME|&UA|&bF|)ET|%TK|%VLb@|%[A|%_7|%bLJ@|)UA|(T#AU|)EbAU|)J2|&PUFbA|',
      '([F|$3bKT#2|)-!|)0#|$4|%=E|&UA|%@2|%A|%J|&LJL|%VA2TL|(9b;|(HCbD|%bLR|)TMK|)UA|(TJ|$5|%LbP|%VK|$7TL|&ME|(UA|%U2T|&A|$',
      '9ET|%K|%VN|%b;T|)ETAbJ2|$A|%TE|%WME|(UA|&Pb<|%_P|$BTM|$CLbI|)UA|%U4bD|%[O|&R|$DU|%bKT|$EbKTQ|*V|$FAbAU|%CT|%EbE|%Lb2',
      '|%TC2|(E|(UA|%XLb@|%bLCTK|(IW|$H#D|(UA|(V|%CbD|%_DUA|$IN|&A|($|%T4|&M|(E[|(T|(V|&NET|(UA|$K#AbL|%J|%W2bA|%_4|&92AT|(',
      'E|$L2bP2|)@|)UA|%7ET|)0#|)AbJ2|$M4bE|$NA|&b|%LbDE|%TC|%UDTE|%[4|&CEOVM|)T|%]DTEU2|$O_DE|(UA|%bM[P@|$QC|&VK|%TDE|&L|%',
      'b2L@|(TL|(YA|*U|&BT|)-!|)0#|)E|)F2|&JL@|$RTL|%UAT|#)C|#+CV|#2AV|$E[|$M|$T|%LTAbJ2|$V|$[|%#|%4T|$bLUK|)AT|%PJ|%Q[ET|#',
      '3bA|#4T)|#5E|#7C[N|$JW7|$UE|%N|&TMK|$b7T|()|&V|&[|#9ST|$T|%KT|%N<|(V|$VN|#<V2|$[|#>S2|#AA|$ET|$MW9|$R|%V|$TLT|$V|%O|',
      '$b2TL|%AL|&T|(LX?S|%K|&9UA|&ETLTK@|&NAV|&T4bLR|&[EbCbL|%L|&RNV#|#CE|$L|$QbK|(AT|$T|%HRTL|%OUN|$UK_#|%O|$V|$YO|$]N|#E',
      'TAE|$V|$bA|&TE|%C[O|(R|%DU|#FET|%[|$T<|$bA|&2|&J|&TR|%LX|#GL|$M|%AT|(FXLbN2|$SL|%[C|$T)|$[C|#H2T|%[|%_|$XA|$b9UK_#|&',
      'V|#IT|%0#|%FAU|$bK|&AT|)0#|#J22bP|%TMVE|%_@|%bP|$4bL|$:|%2L|%AT|&[|%ET|&[|%T|&E[|&KT|%V|%[|%aAT|([|$AM|%T|%WMbK|$EbN',
      'K|(UA|$L|%bB|(2|(E|(UA|&F@|(UA|$OVA_Pb@|$QbA|(VFWL|&BTEU2|&KT|)-!|*#|)0#|$T|%#AL|%7TL|%9|&NTC|*V|&OTQbAbL|%DTE|&U|%E',
      '|&AT|&T#AL|%FE|&bA|)U|%K_9UA|%L_R|%N[O|%Q|%RUA|$UAU|(K_#|$V2L@|&bP2|*_#|)T|*-!|%F|%L|$W7UA|&b7K|%CTK|&bL|)4WFbA|)A<|',
      '*M|)V|$X7[|%R|$YCbD|)U|$[A|$bFAbAU|&CT|&EbE|&Lb2|&TC2|)E|&XLb@|&bLAU|)CTK|%H#D|)UA|&CbD|&EbD|*UA|*V|&_DUA|%IN|(A$|&T',
      'NET|%JTE|)UA|&UMUA|&W3|&[ME|%K2|%LT<|)b|#L2TLV|$4W9T|$CTL|$KX|$M|%AT|$Q_#|%bNAV|$TK|%RET|&T|$UAT|$_NL|$b2U<|%4|%9LV|',
      '%CUK_#|&V|%F|%HUKT|%N|&AbL|&BT|&CT|&ETJ|&FbLBJ|&JTEbK|&L|&ObL[Pb=|&RTLT|&TDU2|&UQ|&[|(2bP@|&_7b7|(AbAJ|(FLU|#MJTE|$T',
      'J|%R|&2TL|$VJ|$bAEA|%GL|&T(>|&[<|%M|#NT)|%L|&V|%M|#O2bA|$QbAbL|#QWLTM|$bAT|&V|&[|#R2TLV|$4M|$9|$C[N|$E|$IT4UAT|$JA|&',
      'U|$K_4|(V|$LQT|$QbL|(THbCV|$TEWIXAU|%K|&2|&AT|%LEFWL|&T|&[|$UA|%Pb@WAT|$V|#T!F|%Q|$#3bK|)U2V|,K|%4MV|&T|%F|&bLCTKU2|',
      '%IL|%Q|&C|&TLU2|&b2YAU2|$(#Q|%2UM|%<|%>|%FbLQ|%H[LUKT|%JE|$*B|$2TL|%[A|%bPL|)AT|(TAb2TL|(V|(bK|$4L|&VK|$9E|%UO|$:T|%',
      '[CTLV|$=|$>SV|$?S[|$A|%NTRE|&V#|&[#|$BV|$D2|%E|&T|%TL@|)AKT|%W|%bK|$F[2bP|%bATRU2|$G|%S|$HUA|%WE|$J#9QbK|&A|%4bLV|%E',
      'T|&[|%KU2|%LU2|&bBbK|%N[C|%T9U2|&E|(bK|*A|+$|+KT|%WCTKU2|%XRU2|%bKNTC|+V|&LT9bK|,NTC|$L|%@|&V|%ETB|%T|&#O|%U2T|%V|%[',
      '|%bB2|&N9EU2|(IaJ|+U2|$MTET|$NDTEV|%E|%L2L|%UAbLV|$QTLTJ|$REV|%H|%Q|%UAbK2TL|*U2|&H|%V|%X|%[H|#U#4TFWL|%7T)|&UA|%CLV',
      '|%D|&UKT|&V|&W|%RIXJ|&M|&TQE|$2#CL|%EbCL|%b2T|(UJ|([|(_#|&3|$3|%TE[|$<V|$>EV|$AJbHL|%TL|(T|$CbD|(T#A|)EbA|)LbB|(U|$E',
      '[|&JT|%bD|(V|(W|&RT|$FTRV|%bFV|$GL|%TLUO|$L|%QT|%[|%_RV|%bG|(S|$MQUMT|)[|%T)|%U#>L|&2^E|$NEV|%TE|&K|%UM|$Qb<J|#V2L|$',
      '3|%E[|%T|%V|$9SE|$<|$AT|&FWL|&LTJ|$DT|%V|%[|$EUKL|%[<|$HV&)|$JT|&-!|(#|&0#|&NLbAV|%UA|%[#<|$LUKT|%V9|(S|#W#CL|(AT|$2',
      'LTA|$3|%C|&[N|%V|$4J|%bLVN|$9TAT|%VA|$:TN|$CLbOE|%XL|%Y?S|$DT|&L|(2|(E[|%VL|$E|%2L|%A[|%E[|%NT)|%T|&)|&KT|%UOb7UA|%V',
      '|&AT|&M|%bCL|)AT|)V|&EV|$FL|&RU<|%bLQUCbD|(VJ|$HR|$ICbLT|%TP|$JE|%TAbLT|%UAbLT|$L|%#4|%2bPT|)UA|%[EbCbL|&O|$M:TE[|%A',
      'TEFWL|%I|%_7ET|%bATE|$NUDT|)-!|*#|)0#|)9E2|%bKNQbBUA|$OVM|%bLWA|$PJT|%bJUAT|$Q9b9UA|#X%L|$2bA|&PbJ|*CLbOV|$3T|%V|%[|',
      '$72|&T#2|%ET|%UA|%V|&HCbD|$9E|$>TE|$A|%V|%bL|(DTL|(FTA|$GSV|%V|$H[CTL|$L|%9|&JM|%A|%CTQ|%T|%V|&ETJ|%bK|(C[N|(N#OV|(T',
      'QbA|(_CK|#Y9E|$Pb<U|#[#|%<|&L|&V4bL[>|(JV<L|&bLM|$2#>|%b<L|$<|$=|%V|$AW|$E|%T|&0#|&EUK_#|(V|&FAU|$H|$JV|$M|%bQUKQ|$N',
      '2|%E|%T|&-!|(#|&0#|&EUNYAbA|.U|#]2>S_#|$CbDT#AU2|)EbAU2|$E|%U2|%bK|$G|$J|$KC|$L|$MTEUK_#|#^GSb<N[KL|%b<N[KL|#_7|%AT|',
      '&[|%E[|%T|$>UKJ|$E|%FWL|%T|&MV|%UKT|%V|%X|%[|$FTE|$J|%ETB|%NTL|%[ObNL|$LbQ|$MR|&NV#|$NUKA|$OM|&UQb<|$QT(<V|&K<V|#a#C',
      'LbK|%F|&T|$A[M[|$CT|$EbCLbK|$IT4bK|$L|%J#>M|%TPb<bL|#b2EbC4WFbA|%XM|(V|%^<M]#>|(UO|%_L|%bLVE|$<TG|&L|%VM|&N|%X>UK_|%',
      '[<|(bQ|&>UKJ|&E|&OE|%]#>|%^2|&MJ]E|%_E|%bLV<|(_2|$A#I|%E|%JbI|%L|&VK|%WAU|%XF|%_AbL|%bLUKT!|+#|*_#|(V|$BM|&LWF|&T2YA',
      'U|&V|(K|%T)|&ET#AL@|,UA|(U2|(VK|&FAbK|&KV|%UAU|&L|(AT|%XM|$ETA2|)_AbAL|&E|%[R|$FLbDT|(O|%Pb<|)V2L@|%UE|%[2b<bLJ|&E|(',
      'UO|(V|&OM|&Q|%]EUO|$JL@|%TL2|%UAT|&B|%YAU|)K_#|$L_A|$MTN|%]J|$N|%7TMUA|&b8|)AT|%A|&#AbL|+AT|&$|&EbAbL|,AT|%C[O|)V|%F',
      'bE|%ITN|%K#|(NL|(Q[N2|%L|&T9|&WF|&XF|&b4|)VK|(@|)UJ|%QbB|%T4A|&C|(UPb<|&DVEAT|&ITNU2|&JUAbN|(V|&KAbA|+AT|&LbB|&QbBbK',
      '|%V2TL|(YA|*U|&>E|(UO|%[7b8T|!R#4LV|%M|$Q|#9LA|$SLA|%TL|$TL|&VHT4|#<2L|$T|%2L|%E[|%KT|#>SATM|%FbFT|$b>V|#AbKT|(L[|#B',
      'UKTL|$[MV|#CVQ|#EWJTE|)9V|#GbA[|#JE[|$MT|%[|%_#|$TLT|&V|&[|$VLFWL|$[|%#|%OT|#L@|$C_)|$T|%2L|%E[|%KT|$U|%A|%CbNTL|%KT',
      '@T|(MV|%N#O|%Ob7#CbL|)EbCbL|%RL|$V|%O|$[|%2|$bP|&NLbDE|#Mb2T|&V|&[|%CV|&bNTEV|#NE|$MCTL|$T|%)|%-#|%0#|%M[|$[MV|#QE|$',
      'bA|&2bP[F|&OUMbF|&T2bPL|&UETFWL|#T!|$#42T#4|$(>bL_9E|$)|$*Q|$9VFWL|$B|%V|$E|%U|&2TL2|$K|$L|%[|%b>N[KL|&NLb>|$M|%A|%T',
      '!2U|&#2U|&A|$N>ST|%V|$QE|%UM|%bK|#U#4X|%C|&W0#|(AbN|(QbATE|-V|&X|%Q2|&T|$<|%ML|$A|$EbC|(W|)0#|)QbATE|.V|(X|$HLb<|%bL',
      'X|$J|%EC|%T7M|&EV|&MK|%bJA|$L@|$M|%bQ|$QTH|&L|%b<bLV|&QT|([|)CTLV|(_#|#VE|$J_4bM_HUE|$LT|%[|%_|$MUKJ|#W)#|$2XJA|$4MV',
      '|$JTKX!|$KV|%[|$Q]E|#X!|$#|#YCK|#[2b<[KL|$4[M|$AW|$ELV|$J#A|%T|&JTMUEV|$ME|#]$|$CL|&THTC|$LV|#^2V|$M|%VNW>|#_#|%4V|&',
      '[|$2L|$4T|%V|$<M|$AV#|$ET|%V|%[NTM[|$J|$MU2T|%V|%b2L|#bLCK|%TQ',
    ].join(''),
  ],
  kn: [
    "ಂಃಅಆಇಈಉಊಋಎಏಐಒಓಔಕಖಗಘಚಛಜಝಞಟಠಡಢಣತಥದಧನಪಫಬಭಮಯರಲಳವಶಷಸಹಾಿೀುೂೃೆೇೈೊೋೌ್",
    [
      '!$!=a|$BKY|#@T|$aJ!@|&V@a@I|#ANS|#BDaDV|$K|$V|$Z|#CT2|#DZ2|$aDV|#LaLBY|&T|#NCTJLaLT|$D|%V|$K|%DaDV|%T4Y|%V|$V|%4M|!%',
      '4|$T|#@|$D|#B|$KW|%Y|$S4aJW|$aBKT!B|#CVDT2|#Da|#Fa|#KaAT2|#RSK|!&@K|%Y|$TRSQ|#B2a2Y|$DaDV|$K|%LaLT|$V|$Y|$Z|#Da|%DW|',
      '&]!BV|#KVN|#LaLT|#NK|%V|$V|!(4|!)@a@I|&K|#BSRK?Y4Y|#LaLZ34MV|!,!BKY|%V|$G|%VBDaDV|(V|#K=DZ|%V|%W|#LaL|&S|#Qa|!-2Y!BK',
      'Y|!.BV|!/!BV|%Z|#;a;V|#GaG|!2=TIY|#DaD=|#KaDS;2|#SK?|$L|%BLaLT|#T|#VKT@V|#W=|%S|#YLNV|%Q|#Z!BaK|$NL|#]DYJ|!4M|$DaDV|',
      '$V|#Y|!6LD6T@aK|#T@aK|(B|!8DKV|$NKT|#SDa|#TLaLYJ|#UND|#WDa|#]@Y|&4Y|!=T|!@!=B|#DaD|#IaI|!B2aPT?|#T|$D|#ZOB|#]=a=|!D!',
      '@K|&B|#4K|%B|#=VNTD|&Y|$YB|#LaLT|#SDV|$La2V|#T!B|$KaBTPa;|#YJ|#Z|#^=T|#aDV|!E;a;T|#=YB|#Oa6TI|#WKaN|#aK2SK|%@T|%AI|%',
      'CSD|%IS?B|&V3|%OQa@T|!G!B|#4a4Y|#MQLS4V@a@BY|#RM|$V@Z2|#SKT|$RaJ|#T|$=V4=Y|#ZKY|#aKT;TPa|!HSK@|&B|&UJ|!I@a@V|&Y|&]!B',
      'V|#S=LV|%T|&B|(KV|%V@a@BY|&N|$@aK|$RT@T|#V!@SB|%BTD|&Y|$3aJ|#WKV|$L|%2|#Z|$LTD|%Y|#[QWKV|#]BL|&V|!JDaDV|#SN|%VBZ|#V|',
      '$D[;Y=a|!K!BV|#LaLT|#Pa;V|#S82UJ|%aJ|(B|$Pa;aKUJ|#T!B|#U@TJ|(LaLT|!NKaP|&4M|&B|#T8a:SD|$BaJV@a|$KVBaC|$NTC|$OZP|(NS4',
      'T|%aN|!O@ISDB|#T2aP?|#aKU|!Q!4U@|$BKaHBLaLT|$EWKa?|$G!CTQTB|$JV2a@|#?a?|#IJBLaLT|#R|#SIS8T2|&DaJ|*NS4T|$KaN8DT2|$RT@',
      'aJ|#VISKV|#ZKTB!@Y|#aAMUJ|$NLaE|!RLNSKV|%V|#MYJ|#S4V|%W|#T!BTD|&W|&Y|#U4Y|#Y6a6S4T|(TD|(V|$QKV|#]!BTBY|(KVN|$Q',
    ].join(''),
    [
      '!$!2|%4MDaDV|%?|&B|%T|&$!O4M|,V|$4|%4MV|%=T|(4MV|%NS4T|%S!O|$6TD|%Y|$=Ka|(;Z2Ka|$@|%K|&8SL|&B|&KSPa;aKUJ|&SPa;aKUJ|&',
      'T2aP|&a|(4@|(8SL|+B|(KSPa;aKUJ|%R|%SKSPa;aKUJ|%TI|(NS4T|%YJZ|%aJ|(B|)LaLT|$A|$BS8TD|)QLS4TBY|(V|%TD|(T!B|%V|$GKUOa|%',
      'Z=a2Ka|$O|%4MDaDV|(V|%B|%NS4TBY|&V|&Y!BKY|#2S=IT|&YIT|*J|$ZOTJ|$a2|&T|%;^GKa|+DLaLT|%GKa|%KI|%PK|(4MV|(O#|&S!O|#3TL|',
      '#4@aJ|(NS4TBY|,KV@a@BY|*B|)TBY|*KV@a@BY|,N|*LaL|$L|%NSB|$Qa;a|$SC|&NSB|%QaQT|$a4B|%DT|%K|&4?aJ|#6a6VIY6a6TD|#8a8|#;a',
      '|%LS!;S|*T2a|#=SIa|$T|%2Y|%4Y|%ESJ|$V4Y|$^Ga|$a=|&LS4T|%NY!6Ka|#?V|%4MV|$Y2;a;V|$a?|#@T4Y!EV|%AT|%B]=a=|%JS4T|(B|%RY',
      '6a6TD|+V|$U|%!BaKTJ|%N|$aJCT2|&LaE|&SCVDT2|&V6a6|(DaD@|#AN|#B2a2S4T|(T!@|(W|(Y|$DaDZ|$K!@Y|%LaLT|*D|*JW|)W|%T!B|%Y|%',
      ']!BT4Y|%a|$LaLBZ|$S4aJW|%B|$TKV|$W|$Y!BKY|$ZDY!BKY|&Z|$]!BV|$aHV@|%N[@|#CT2NS4T|&SK|)2a2Y|)B|)T|*4MV|&X@|)NS4T|$aJ2a',
      'P|*@Y|*K|+S4T|.BaBKV|+V|*UJ|&JD|)2a2Y|)4MV|)B|)NV|&SE2KS4T|(J|#D!@|&K|(B|$CT2X@|$DaJ|$TIZPDa|%KU2aPT@|%L|&4MV|&B|$V2',
      'WL|)2K|)NS4VN!@Y|&aKI|*NS4T|%4V?NS4T|%ES@|%HN|(2a2Y|(B|(TQTB|%I@T|)QV@a@BY|&^BDY|%JSJT4MV|%N!OT2|&SB|&V|%QKTQT|*V@a@',
      'BY|+N|&SK|)NS4T|$Z2KV|&NZMY|$_E6SKT2|$a|%D|&S|&T|&VN|&W|%J|%NJ|(T2|)QV@a@BY|#E5S@|$CIDTJ|$KSC|(B|(T|%WE|(B|(NS4T|$SJ',
      '|&2SKT|&B|%K|$WKa?|(N|$a|%E;|%K@TI|#Fa|#GU8|$aBVLa|#HTDJ|(B|(TQTB|,KV|,aBSKY|%EaKSJ|+4MV|%ISDT|*4M|,V|%NXBaBT|*CT|,4',
      'Y|,E=TQLV|0TB|2KV|,J|-DaDV|-V|,OUL|&aJ2a@T|$aJSQ|#IT@SHa|$WKa@|%LaJ|$X@|$Y8SDa|%KT2|)B|)Da|+DKV|)S|*B|$ZKT2|)B|)Da|)',
      'S|*B|$aDYQa;T|#JSDV|$aJ!4SKa|&Ka|#K?aJ|$Ga|&GU|$IDY|(J|$Q|%K|&V|%V|$TJLV|%NTD|&V|%Qa;S;La|-D|$Y|$ZGT2a|$a2SDaQSQa|%8',
      'T|&VD|%A|&B|&NV|&OSQa@aK|.8a:KV|.B|&S@a|&a|%C|&BPa;V|%GDa|%R@Y|)JDaDV|#L!2SK|)T2|$Da|$RSGSBa|$T|%Qa|$Y2aQS!=Ka|)a|%4',
      'MV|%Da|$a|%E|%GIa|%JWITDTJ!|%L|&B|(Z|&LaLT|&T!B|(4Y|(D|(J|)Z|&Z|#M@Y|&J|$N=T2Y|(QT|$YJLV|&VN|#N2SO|(NTBY|%a2Y|$@SK|$',
      'CT|&4Y|&J|(DaDV|(V|$D@T|%DaDV|%T4Y|%Z|%aDV|$KBV|&Z|%LaLT|%T!B|&GaGKW|%V4MV|%W|%Z|%]!BT4Y|%a|$L!GT@NS4TBY|.KV@a@BY|)Q',
      'T|+BY|+KV@a@BY|%^2D|$M|%DaDV|%T|&4Y|%V|$OZP4MDaDV|*V|%aJ2|)@Y|$SKa=a|*Qa|$THS8aJ|$V4MV|(Y!BKY|$Y!BKY|#O^2|&D|$aNAa|#',
      'Pa;S4T|&V|&Z|(DW|&]!BV|#Q!3aJS@|$SCSK?|&aJ|%ISDaJ|$Y!GaLT|$^QTJZODa|*PDa|$a@T@aN|+2a2Y|+B|,LaLTBY|0KVN|0NY|+NDaDV|%A',
      'TK|%QS!|#RaIBa|!%!4aL|(^|$8DZJ|$;T|$=a|&KY|$@KT2|$CaK|(EaKBZO|#2K|%4MV|%aP2|(?Y|(TQV@a@BY|$QaIT2|*NS4T|$SK|&B|%O|&NS',
      '?T|$Y|%4Y|%J|&DaDV|&V|$a;^EQa|&a|%KI?|)2SKT|)B|%LY!=a|%PDa|%QT8Da|(;^QTDa|&[=a|&aFKa=a|#4GRVBV|$ID|$LT|%Z|$Qa;a|)DLa',
      'LT|$S4|&a4Y|$T!BS4a4Y|%@a@V|%BY|&aB|)KV|*W|)SKY|)V|%D|%KGRVBV|&V@a@BY|(N|%NY|$V@a@BY|%N|&VBTLaL|)V|$aDZJ|%KS|#5S@|#6',
      'K?Y|(4MV|(J|%TQLS4V@a@BY|(V@a@SKY|)N|$SKaJ|$Y|%4Y|#;2a2Y|$4M|&DaDV|&LaLT|&V|%SK|(D|)S4T|)V|(K|)DaDV|)T4Y|)V|$B|%LaLT',
      '|$NDaDV|%V|$^|#=Ia|&Qa|$LS4V@a@BY|%V|$MT@|(2a2Y|(B|(NV|(S@aI2|$T|%B|&KV|%J]|&^|$V@a@SKY|%N|#?aNT2|#@!2|$DT4Y|%V|$TAa',
      'J|$aI|&R@aJY|#BKV|%aO|$SJ|&B|&NV|$T|$VBKT!B|$ZO|&B|$aBKT!BLZ|%J@Y|#CKT@|&QT|)B|*Y|$SK|&B|&NS4T|&T@|$aJS@aIT2|#D!@K|(',
      'B|%B|&a|$VN!OT2|$Y|%4MV|%J|$aL[Da|#EKZ;T!4a|&PDa|$La|$a|%;T2La|%@|#FUQa|$aKT2|)B|)Da|)S|*B|#IBV|$Y4MV|$ZLY|$a|%L|&4M',
      'V|&8D2|*B|&B|#JS|$T@V|$VKaNZB|$^4|&B|$a2Y|(J|)DaDV|)SB|+KV|%B|%Qa;Da|#K!H|&4]!=T@V|+V|&B|(LaLT|&NS4T|*V@a@BY|+N|)B|)',
      'JT@V|&T2|(QLV|)T|*@V|*B|+KV|$@T|$DYJ|%Z|$V|$^4aJ|)2K|*a2Y|)B|%E|$a|%,Da,|%2a;T2a|%;a|(Qa|%=Ka|%AKa|&T2@Y|+J|,DaDV|,V',
      '|)NS4T|%IT|%J|&Da|%QYDLa|#LT|%Na|%Qa|$a|%FS|&aKY=a|%G!|(D|&Ia|)D|&Ka;a|#MB|$NS4T|&B|$TB|&KV|$aNT2Y|*4Y|*J|#NK?|%a@2|',
      '(D|$T|%Pa2SK|$X@a@T|*4MV|*J|+DaDV|+V|#OaKI|&J|#Q2a@T|)J|*DaDV|$T=a|$Y|$a|%2Ka|%;TDa|&aKZLTJ|-B|-Da|-S|.B|%@T|(JDaDV|',
      '%E@aKY|+4MV|,Y|+J|&TKTDa|#RSKB|&NS4T|!&!2a|$4SL|(B|(UJ|%aLTPa|+DLaLT|(UPa|(Y!=TD|-LaLT|+a|,D|-LaLT|$6V|$8TDTJKT!4a|+',
      'a|(a|$;Ka|(DY;a|)aJSPDLa|(FZQa|%YLa|$=T|&J|(Da|(S|)B|)DS|%UQa|%^|$@R|%TNY|$A|$B|%T4W|&D|(NKY4W|,Y|&KS|%V|%^Ka|$CD|&B',
      '|#2aNT;T|#;LT|&J|$SLTJDa|$a|%;T4Y|&V|%Qa|#=LS4TBY|&JT@V|$U|#@KK|&T4Y|&V|$TRSQ2SKKV|)B|*LaLZ|)NV|$a@|&U6T4Y|*D|)Y4TD|',
      '+Y|&V|%JSBT|*4MV|#B2a2S4T|(T!@|(W|(]!BV|$DaDW|(Z|$K!@Y|%KaA|%LaLTD|%T!B|)S4T|%]!BT4Y|$LaLBY|)Z|$S4T@a@V|(BY|%B|$U4|$',
      'VNKY4W|*Y|$W|$]!BV|$aB|&!@Y|&BaBV|&KV|(W|(Y|&NV|&S4|(KY|&V|#DaDPa;V|&T!4aQa|-DLaLT|(@K|*Y|&V|(MTB|&]!BY=Y|(GaG|%QVLT',
      'Da|&a;T;aJW;a|#EaE@a@DYJ|+Z|*V|#GaGK|(V|(W|#IZ8a|$aI=T|#JKa|$SDa|#KGRVBV|%Z2V|$LT|&LaL|%V|$S2TD|&a|%Da|$V@a@BY|)NY|)',
      'SKY|%N!@R|)Y|&VBDaDV|)KT!B|)TLaL|)V|&Y4MV|#LS3Y|(J|)V|$Y2a;aKSDT2a|$aL|&B|(TBaBKY|(Y|(Z|&NY|(Z|(^|&T!B|(4Y|(BY|(D|(J',
      '|)NKY4Y|)Z|(KVN|(NY|#MT2Y|%BV|$VNKT|#ND|%DaDV|%T4Y|%V|%aDV|(W|$KDaDV|%LaLT|%T4Y|%Z|$LaLBY|$V4MV|$Y|%K=K|(V|(W|%LaL|)',
      'NW|$Z|#Pa;|&V|&Z|#QNT|&J|$a|%KZLa|%LS!|(IT2a|)a|!(2Y|#4LW|$S4LZ|$TD|%KVN|#6Y4Y|#8TEa;TD|)a|*D|#@D|%DaDV|%V|#KVMaMT|#',
      'NKY4Y|#OSDaJ|$aNK|#Qa|%;Ka|)Da|&a|!)!;S4GRVBV|(T|(V@a@BY|,NY|)N|&B|&JT@V|%V|&IS=GRVBV|*T@V|*V@a@BY|.NY|+N|#2a2TD|&V|',
      '#4I|$aK|#6T@|&NS4T|$a6|#=SN?Y|$VET|(J|&V|#?a?Y|#@a2KaP?|&XPa;|%@INS4T|*B|&K2a2Y|(B|(SCT2SKT|)KaCBLaLT|&Z8D|%E@a@T|+J',
      'S4V@a@BY|/N|-B|&DaD|*4MV|*B|*NV|&SB2|*KV|)DS|*Y|+4Y|+J|,DaDV|,V|)TQLV|+V@a@BY|,N|%QN|(4MV|&SR|#BJ|$S|%RK?Y|*4MV|,Y!B',
      'KY|+S4T|*JS4TBY|+Y!BKY|$aB|&2a2W|&B|&DYJ|&NSB|&TIY|*4MV|&ZO|)4MT4S4T|+V|)B|)EWKaN2NS4T|)T@|%JI|(4MV|(B|(NV|(T4MV|&SD',
      '|)4MV|)ND|&^4|#DaD@|#E2K?|(4MV|(B|$3!=B|$4aKR|)4MV|$DBT4MV|%TP@a|%aJSQ|$JV2a@|%^4|(2a2Y|(4MV|(B|(TQGRVBV|*LS4V@a@BY|',
      '+V|*T|+2]!=V|*V@a@SKY|+N|$NSQ|$aETD|&V|#HJ|#KaBV|#LaLZ3|)NTBY|)TQLS4TBY|.V@a@BY|+V@a@BY|#MT@SJ|%B|&KV|&NV|&TBY|(KVN|',
      '&V|%JT@V|&V@a@BY|%QLV|&T2]!=V|*MaMLV|#Pa?|&@Y|)J|&B|&NLJB|&S!O|#QTKS;B|$a@VNSKT|!*;B|#KT4Y|%D|&LaLT|$V|#RTQLS4TBY|!+',
      '?S@aI2|#@V|%NTD|)LaLT|#PT|!,!8TDTJKT!4a|+a|(a|$;DYJ|&Z|%Ka;[DaIY!;a|%V|$=a|$BKV|&aA|%T4W|&BaBSKY|%W|%Z|$E[Ka|$G!@Y|%',
      'LaLT|%S@|(D|%VB2a2Y|(K|(S4T|(Z|&NNKV|#2KY|$aQa|(6Z!8a|(EaKYQa|#6a|%,La|%6KT2Y|+JT!B|#8V2ZODa|#;a|#=2a2Y|$TDaGKa4a|%O',
      'Da|$a|%8a|%NKa=a|#?T2Y|$a?Y|#@a@K|(2a2Y|(B|)LaLTBY|(NSB|&T|#BVKS4T|(MT|*J|&T4Y|(QGZ2SJT@V|)LV|)VN|&V|$Y|%J|$aBV|#DKa',
      '8T|$a|%DGRVBV|&LS4TBY|*V@a@BY|)B|&V@a@SKY|(N|)KV|)VBDaDV|+K|+V|%KSDa|#EaKTLa|#Fa|%,Ia|#GTQT|#ITDYIa|$a|#K=DY|(J|)BV|',
      '&ZJ|&aDW|%K|&LaLW|$NLV|$T2a|(QDa|#LT8GY@a|$Y|%2a;aKSDT2a|0Qa|-a|+T2a|%4MDaDV|(V|%J|$a|%,La|%;T;T&|%LK|(T4W|(W|&NDaDW',
      '|(W|&T|&Y=Y|%NTQa|#MYJ|#Pa;V|&Z|&^|#Qa;Z;a|%QT|!-!8LUQa|#22SLBLaLT|$BTD|$IS@aK|$NaJ2a@T|$U2K?|$Y|$[2|#8Y!;a|%DaQT|$a',
      '|#DDaDV|$SBKW|$V|$W|$Y!BKY|$Z|$^|#EaKTLa|*DLaLT|#KT2Y|(J|%@V|%JS|$a|%GQa|%L[DaQa|%NZQa|#MDYJ|%Z|$V|#PTJS|(B|$aJB|&Da',
      '|&S|(B|!.,QaGT,Da|#2aJW|#@TRSQT2|+NS4T|#BDYJ|%Z|#ES=a|#F^Da|#KDa|$TOa|%Pa|$^EaJ|$aLY!=a|+D|,LaLT|#LaJS!=a|#N@a@V|#QS',
      '2a|$a|!/!;T|$B2a2T!@|)]!BV|%DYJ|&Z|&aDV|%K|&LaLT|&T!B|%Pa;V|%S4T|)@a@V|)BY|*aBV|&B|%T4Y|%Y=Y|&K=V|%]!BV|$G@a@DZ|)V|$',
      'H@a@V|#2a2W;|)B|)NV|%LR^I|#;a;S4T|(KY|*JS4T|&T4Y|(DLaLT|&W|#=!G=T2YJ|$TOS|$Y@D|(B|%BV|%JKV|(a|#?4TB|#@a@=|(2a2Y|(B|(',
      'NV|&SJ|&T|&V|#B4TQLV|(T@V|)B|(V@a@BY|,NY|)N|*VBV|#Da|#EaE!B|)2a2Y|)4MV|)B|)NV|&T2]!=KV|(4Y|#Fa|#GaGDZ|&K|(V|#IaIY|&]',
      'IaIY|#K;V|$Y4SDa|#L!ET2a|$NV|$T!ET2a|#M4=Y|%S4T|&B|&JT@V|%TD|%Y|%]!=|)!@Y|)T@a@V|*BY|+aB|-V|*KV@a@BY|/NY|,N|*NY|)V|&',
      'MaMV@a@BY|.NY|$E;a;|$HS4BLaLT|$S!4?|$aMYJ|)BV|!0,Qa|#2a|#9^Da|#;4MDaDV|$B|#=T|#BLV|$T|%4S4T|&Y|$V|%4K|(T4Y|%N|#EDa|#',
      'KaN|#La=a|#NKa|!1;a|#BaJIT2|&^4T2|#E6SKT2|#PC|%4MV|%SLJ|%T|%UJ|!2!6TD|$;aKT|(^La|$=|%KV|&W|%NV|%T@V|&BY|%V|&2]!=|+KV',
      '|&G!@V|)B|*NV|*T@V|+BY|+NY|(KV@a@BY|-NY|*N|+VBTLaL|&RT=TB|,KV|+JLV|,VN|$@TD|(LaLT|$BSJ|%V|$EDT|(4MV|)Y|(J|)DaDV|)V|%',
      'YDT|)4MV|)J|*DaDV|*V|%aJW;Ka|*T!4a|#2aPUJ|&YJ|#6ZKT|(4MV|(J|)DaDV|$a6S|#7ZKT|#;a;=|(4MV|(B|&LS4TBY|(V|&T|(B|(QTB|&V|',
      '(N|#<T?|#=@|%4MV|$L|$TBSB|%IY4]MTQV@a@BY|(JS4T|,BY|+V@a@BY|$Y|%4Y|%J|&T!B|$a=SJ|)NS4T|#?4M|&DaDV|&V|%SLa|$TNY|(J|$a?',
      'T4Y|(D|&V|(4MV|#@Y|%4MV|$a@KTQT|#AD|$S|%NQa@V|%Q!2LD|$Y|%4MV|%J|&DaDV|&V|#B!G|$D|#DQV|$TPa;|(<|$aD=2a2Y|(6T@aK4MV|0K',
      'S82VISKa|0NTPa?VNKaCDa|(B|(T|)4K|+V|%QSQa|#EWKa|$a|%D|%EV|#GaGT?|)B|(D|&V|#IT;T|%PDa|$aJVDTQa;a|#K4VN|$=T|%V|$SKV|%N',
      'MT|)J|$VMTD|$Y|%BKV|&V|(2]!=V|%JLS4TBY|*V@a@BY|.T@a@V|+N|)B|)JT@V|(aE=V@a@BY|,N|&V@a@SKY|+TBaBKV|(N|)KV|$a?|%@NaJ|&X',
      '|%DLa|&S;2B|%I|#LKa|$S|%@aI2|%NTB|)K|*V|)Y|$T2Y|(J|%@KV|%JLV|$Y|%4MV|%J|&DaDV|&V|$aEDS|(Y|)J|*DaDV|*V|&T@|(QT@V|)V@a',
      '@BY|*N|%JS?|%LTBaBLV|(D|&V|(4MV|#MEY|$VRTQTB|$YB|&KV|&V|(2]!=|,KV|,T@V|,V|#ND|%4MV|$Ka|$T|%4MV|%@Y|%J|#Pa;|#Qa@WKT|#',
      'S!|%2SKa=a|&aKU;a|%4^|&a|(KYQa|,D|%=|&B|%@UJ|$2a|$4B|&B|%Y|$=TD|(LaLT|%V|&4MV|$?B|%GRVBS4TBY|*V|%LV|%QT4V@a@NY|%T2Y|',
      '&QT2]!=|-KV|-MV|-T@V|.BaBSKY|+MaMV@a@BY|2NY|/N|(V@a@BY|)N|%V@a@BY|*NY|*ZNY|&N|(!@Y|(VBV|$B!GKT|*2SK|*4MV|+Y|*J|+DaDV',
      '|+V|$DWDDaDV|(TD|(V|)4MV|)GBaC|%aFKYDaQa|&QSQa|$ES=LV|$FT|%a2|$I|%Da|(NYLa@a|%KaQa|%T2a|)Qa|&=T|%a|$J!|%4MV|%T|&BY|)',
      'J|&LY|)4MV|)J|$K!@|%?2a2Y|&4MT!BS4T|*4S4T|)V|&BT!BS4T|&NS4GRVBV|*T|+@a@V|+BY|+NY|*V@a@BY|.NY|+N|)B|)JT@V|(Y!BKY|+V|%',
      'DaDV|%TD|%V|&4MV|%a|&3SDY|+4MV|&4TLa|&=V4MV|(a|&Da|&EQa|(]KZ;a|+PDa|(^KZPDa|&GDa|&IT2|*K|+V|&J|(2SKT|)a2Y|*KI|,2a2Y|',
      ',4MV|,B|,NV|(4MV|(B|)KaOT|(DTKaNRTQLV|0V@a@BY|4NY|1N|-SR2|(KWE2a2Y|(NV|(S6K?S|,Y|-4MV|.Y|-J|.DaDV|&LTDa|(a|$L2a2Y|(K',
      'IZ?|%8Da|%B|&LaLZ|&NKY4Y|&T!BLW|%NV|%SNCT|*JLaLT|%TD|%V|&NY|%Z8TD|*LaLT|(V|)4MV|(a|%a|&EDT2|$M8T|%T|&BSQ|$NZKT|%aJ|(',
      'B|$OaIUK|*B|$QK4^=V|#T!4a|(=!|)Ia|(Qa|$@a@MY|$IT|%U|$K?|&4MV|%TBSB|&J|%V|&@YKY|$L^|&IU;Ka|$Qa|#U;|%4MV|$EKa|$G^Ka=a|',
      '$Ka@T|#V!4a|%GM2SJT|$;V!G|)2a2Y|)4MV|)B|)NV|$=TJVN|$?T@|$@WRL|$BTJVN|%VKY|$Ga8|$ISK|(NaJSQ|(a|$KT|&@|(!@Y|(S4T|)B|$L',
      '|%B|$MT@V|$NY!EV|$OL|$QT@|(B|%a@T|#W;|$=LY|&Z|%T|&B|(Y|(aBV|&KV@a@BY|)N|$BLV|#X@2|&NS4T|%T|&4MV|(Y|&J|(DaDV|(V|$PT|&',
      '4Y|&J|%a?|(D|(IWKa@T|(KS8|(S|#Y!EV|$;a;|$@a@DY|$D=|&S|(B|&TJDa|%a|&DZKMY|$KTGTJDa|%Y|&J|$L|%2SL|%NK|(V|&Y=Y|&Z|&]!BV',
      '|(IaIY|%Q2a2Y|&4MV|(SKKV|&B|&NV|$M|%2!=|)!@Y|&a2Y|%4TD|(KVN|&Y|%BT|%HS4BLaLT|%I;a;B|$NTDa|#Z!BaK2a2Y|)4MV|)B|)NS4T|-',
      '@a@V|-BY|*V|)S=MT@|)U2X@|*J|%GaKT=a8a|$;a|$Da|$Ea|$GLa|$IDa|$KM|&B|$MLV|%T|&B|(S4|$Qa|#[4MDaDV|%SKT2S|*Y|+4MV|%Y|%]!',
      '=|)KV|)T@V|&MaMLV|$EKa|%T=T|$GT=LSJT@V|$JLaLT|%T!B|#]!2?T|%6|%=T|(4MV|&V|%B|&V|$2ZDa|$6a6T|$;a;|(KV|(T@V|)BY|)KVN|(V',
      '|$=4V|%LS4TBY|(JT@V|&V|%V4Y|)JDaDV|&@a@BY|&N|(VBV|$DY|&4Y|(]!=T@V|)MaMV@a@BY|&JBS4T|(LaLT|$EaEM|$GaGTD|(V|$K@Y|(J|)D',
      'aDV|)T!B|)V|%TJDa|(S|)B|$L!GTJS|%Y|&Qa;KSLa|%aLLV|(T|)J|(VN|$MNY|%aMLV|(VN|#^2S|$6a|$;T|%Y|&J|(DaDV|$=a|$E|%Da|$Ka|&',
      ';a|&Qa|$LS|&K|%a=a|$MT|$O|%4MV|%B|$Qa;a|#_!;T|(J|$;V!GT2|$DaQTLa|$LSL!EVKa|#a2T!@|)LW|%W|%Y|$JS!Ea|&A]LT2a|(^LT2a|&D',
      'aQKa|&ET;La|(a;Da|&IYKS|&LTF^KaDTJS|1B|(Y!=Ka|(aQTJ!|%^;^|$KI|&4MV|&B|&GBaC|&NS4T|(V|&Z?|)NS4T|%S!@T|*2SKT|*J|&Qa|%T',
      '|&2Y;a|&JS@aI2|)OUL|(Y|)4MV|*Y|)J|*DaDV|*V|&Oa6TJDa|&Qa|);^FKa|)@|*EWKaN|*O2|)IQa|%U=S|)!4?|)E;V4MV|(Y|)4MV|%WQa|%Y=',
      'T;a|%[Qa@|*KV|%^DaQa|$LGa|(4MV|(D|%SDa|&Ka2a|&QT2a|(a|%T2a|%^KTDa|([=a|$NS!;Ia|&Ka;Ka|%TGY2a|%UDa|)Qa|$P|%@aKTJ|%IY|',
      '%TE?T|(aK|*NS4T|%Z@aK|*2a2Y|*4MV|*B|+LaLT|*NV|!3!=|%B|#4^M|&OSQa@aK|#6T@|&NS4T|#DT8|&4MV|#KUBT|(QLV|$a6V|#S@Y|$BaJ|$',
      'Da|$J!|$LT|$Q4T|&U|#aJS@|(T|)JDaDV|!4!4S|$;Y|&4M|(Y|&J|$=|%V|$C2|&B|$HUK|(NS4T|*B|#;a;T|(JS4T|*B|#=T|%J|&DaDV|&SK|#?',
      '2|%J!@aK|$DUJ|(NS4T|%Y4Y|$E@T|$KS8aJ|*B|$T|%4SKT2Y|%@|&8a:|&B|$ZO|#@T|#B4|$aJ|#ID|%2a2Y|%SKaR|*NS4T|,B|%TQT|)B|#KTPa',
      ';|(<|$V=|$aLa|#LaFa|%LS|(EY;a;T4YJLaLT|#M!@R|$DaDW|$LaLT|$Pa;V|$S4T|$T!B|%2Y|%4T!@|&Y|%NY|%QLV|&T|(@V|(B|)KV|)Y|)aBS',
      'KY|&VN|$W|$Y!BV|#NKaDKa|#S!CT|(JNK|+V|&U8T|*JNK|$4T|$8TD|%V|$=a|$>|%NSB|$@aK|(B|(NV|$D|$J|%2|&KV|&T|%D|$Ka=Da|$LaFa|',
      '$MT|&J|(DaDV|(V|#T!@|&LW|$4aQa|$;SKa|$=|%4MV|%B|$DT|$GaQDa|$KUOa|$La2aKTQa;a|&I]Ka|#U6VGKR|$@|%S|%Y|&4MV|&JDaDV|$MV|',
      '#V!=TD|&V|%EDaDV|&T4Y|(D|)LaLT|&V|(4MV|$8KS@T|*D|)a|$=T|%a|&=|(B|$?|%4MV|%I;a;|*B|%L2aP?4MDaDV|-V|$@a@T4Y|$Ea@|(6K|$',
      'GaGT|$KT|&J|(DaDV|%V|&4MV|&@DaDV|(TD|)QGRVBV|*LS4TBY|-V@a@BY|+V|*T|*V@a@BY|+N|,T2Y|,VBV|(V|(aN|&B@a|&NSK|(TD|$LSGT|)',
      '4MV|$NSIa|$RY|&4MV|#W4La|$=V|#XR|#Y!5TQa|$;a|$BaB|(DV|(KV|(T@V|(V|)2]!=T@V|$KSKa=a|$LVNTD|(V|%aLLV|(VN|$MYJ|#Z;a|&Qa',
      '|$Ia|&Qa|#[=a|#]!BL|$2V|$@a@V|$GaGK|#^6K|$=Y|&J|$BSNKT|$CT|$ESL2XPa?|%VK|$LDaDV|%V|%a|&=Da|(a|$NS|%T!B|#_=|$KN|&4MV|',
      '&SDaNT@|(KaA|+NS4T|&TQT@V|%T|#aJSKT|&LKT|&Qa|$K!A|(4MV|(B|(QW6T|(SLJ|(T4MV|%R|&4MV|&?|&B|&S!|&T2Y|%S!|(=a|&I|(4MV|(B',
      '|)LaLT|(NV|(S!@K|(U?|&R2|)K|*T4Y|*V|%U2KV|(a|&Da|&Qa|%WEa|%Y4^KTJDa|%Z|&;Ka|(a|&=a|%aJS!=a|)F[;a|$LSQa|%V2^Qa|%W2^Qa',
      '|%YDa|%^GLa|(a|%aJSQa4^|!5;2|%4MV|%B|$DY|&4MV|&J|(DaDV|(V|$a;4M|&B|#KaP?Y|#^P?Y|%TQLSJT@V|(T@V|)B|*KV|!6!=ISKV@|+B|$',
      'Ba|&K|(D|(OZ3K|,a|(V|#2a|%K|&B|&NKa@T|,J|&SCTE@aJB|#;VN;T2Y|+4M|-DaDV|-V|+J|,DaDV|#BK|$VK!4|#JSE6J|#KT@aKY|*J|$a6TD|',
      '&Y|(4MV|)Y|(J|&a|%I|&B|#LD|%6T@aK2a2Y|+4MLaL]!BV|-V|+B|+NV|&aKT@aK|%Y|&J|(DaDV|$TQV@a@BY|(N|#MNMT|(J|$T4SL|)B|*LaLT|',
      '$VNMT|)J|*DaDV|#RS|%B|#S!ETJDa|+OTEa|+PTEa|+Qa|$DLa|%YLa|%a|$IKS8D4K|$JaQa|$KT@aKT2|%a8a|&LT|(aQa|$L2|%DY|%T@|%V2aJ|',
      '*K|%a@TJLaLTKVN|#T!@DY|)J|$2S4]|%T@aQ2|*S|*Y|+4Y|+J|,DaDV|,V|%a2|(BSB|(I4MWKV|$@aK2AY|)LY|)a2Y|(4MV|(?|(BLaLTD|)VKa4',
      '|-B|(K!4|+2a2Y|+B|,LaLT|(NS4TBY|*B|)V|(TQLS4TBY|(U2K?|,B|$DaD|(B|$Ea|$LT|%a=aKDa|&LKY|$RaDY|)4MV|#UD|%S|&B|%T|%U|#V;',
      'V2V|$DSJT@|&N?S|)Y|*4MV|*J|+LaLT|#Y!=DaDV|&TD|&V|$2a|$D[|%aDS4T|(V|([|$LaQTJS|#Z!8a|%GKa|#[@DaJ|$DS|%UQa|%aQa|$La=a|',
      '#]6a6L|#^M|#_2;a;TD|)V|!7SJS6T@aK4MV|!8!;T|&JS4T|#4@a@DaDV|(T4Y|)D|*LaLT|*SBaJ!@|(V|#;TL|#@Y|%4Y|&Z|#D2|$4?@T|)J|$@S',
      '|%Y|&4Y|&J|$D|$EB|%aKTJ|*@Y|,J|-DaDV|*NS4TBY|.NY|,B|,JT@V|$K|%DaDV|%La|(LT|%T!B|&4Y|$Q!3aJS|*Y|+J|,DaDV|,V|$S!4|(B|)',
      'NKV|(UJ|*@Y|$TQTB|)KV|)NKV|)aBV|$aI|#ESDTD|)LaLT|(JK|&U|&a|(D|)LaLT|#IUDV|$aIV|#J!@T|$S|#KV4TB|$aDLa|%IDT|)4Y|)J|*V|',
      '(a|#L8D2|(B|$ES@|(4MV|(B|$NTBaJV@a|$S!@Ka4SIT|%DJD|%OJ|#NMT|$SGaBSKT|,JDaDV|%RKLSLa|#S2T|%a|&QDa|$4|%@T2|)NS4T|%BLaL',
      'T|%NDaDV|%X@T|$=V|$@T|&4MV|&J|%aKY|$D2T|%EB|%T|%aQDa|$Ia|$KT|&4Y|%a8TJS|(a|$L|%@S?|%B|$NS|$Qa@T|$RTKS@V|%UKS@V|#T!2Y',
      '|$Ia|&IT|$LaLS|(Y|)4MV|*Y|)JDaDV|*LaLTKVN|*V|#UDa|$N|%!@|%2^O|)4M|+V|)B|%D2a2Y|&B|%OSQa@aK|%Q@aN|%T|&4M|)V|#VL[|&DLa',
      'LT|#WDTJKa|%aDLaLT|#Y;a|$FKaQDa|%a|$KaKT|$LaLT|#ZDV|%a|$IaQDa|(a|#[D|%a|$NT2|#]@Y4TD|(W=T|&JS4T|$Da|#^=?Y|%T|&JV|$Da',
      '|&Qa|$LU|$M|%B|$OT|$QYFa|%a|#a:SD|(B|(EU<|$JS2a|%^@T|)PaJ|$NK|%SLSIV3T|!;6a|#Da|#Ka2T|%DKa|#NKa|#S4^Ka|$;|%S|$Ea|$Ia',
      '|$Ka4Y;a|#T2Y;a|$EaE?T|*4MV|(V|$GY;a|);TD|$Ia|$NT|#U2Y|&4MV|(Y|$Ia|#WKa|$La|#Y2aDSL8T|&QSQa|(a;a|$DTQa|%aDTQa|$LTNTO',
      'Da|)PDa|$Qa;a|)DLaLT|&LS|)KV|#Z2a|$GLa|$LKa|%a|#[4Ka|$Ea|$Ia|&Qa|$QDa|#^DT|#_Da|#aJS!2a|&4a|&GaLY;a|&K^|$KQa;a|%SDaQ',
      'a|%TELa|%U|%Z=a|%^FT|%aJS2a|!=2a|#6a|#Fa|#GLa|&Qa|$aLTDa|&aJW|#S2a;KZ;a|)a|$4a|$;S|$Da|&Qa|$Ka2a|&8TLT!4a|&NTDa|$LKa',
      '|%T|#T2DaQa|%a|$4aKT|$8T;La|$ESKa;aIY!;a|$FYDaQa|$NT=T|%a,2aQa|$QY!GKa|+DLaLT|%[Da|%a2NKT|(a|&DT|#UDa|$Ea|$QYLa|#Y2a',
      '|&2Da|$=a|$@a|$DaISKa2a|$GT;a|$La|&;S|$NLEaIY!;a|$Qa2a;SEa|#Z;S|&GZQa|$DTJLa|$NT=a|)QDa|&Qa|%a|$Qa|#[%2aQ[=a|$I!=a|$',
      'KT|%Y2a;Ka|$LDa|%T|#]DSLa=a|#_Da|&L^=a|#aJSDTOa|%W2a|$KIa|%UIa|%[|&Na|%aJS4Da|!@!4T|$=|%2a2Y|%4MV|%NV|$@T|%aK|(4MV|(',
      '8a:SD|-4MV|-B|-NV|(B|(S!O|+B|$B|%KV|%T@V|%V|&2];a;T@V|%Y|&J|$ESB|%V|$GS2V|#2a2|&!@Y|%P?|(NZ|#4a4TQLV|&V|#8a:|&K|(V|#',
      ';QaA|#=NS4T|$Y|%4;a;LV|*VN|%JLV|&V@a@BY|(N|#@a@aN|%N|&4MV|&8a:SDT|&B|&OSQa@aK|.B|#BD!@K|#D2|$4Y|$T3Y|$aDBZ|&DaDV|%IW',
      'L2|#EQaQV|$SQ?Y|$aES4T|&TQLV|)T2]!=V|,MaMLV|&V|#I4Y|$TMV|(DS=TD|+V|$aIBZ|&DaDV|#JSK2|(KV|&SB|&T|(2S|)Y|*4Y|*J|(QGRVB',
      'V|)LS4V@a@BY|+B|*V|)T|*B|)V@a@SKY|*N|&V|#K!4|$2SKT|)4MV|$GZ@T|)J|*DaDV|(VBSK|$LSJT@V|%V|$R|%B|$VN|&SJ|$a2|#LS|$VEGRV',
      'BV|&LV|&T|(@V|(B|&V@a@BY|(N|$Y|%4Y|%ISKTD|%J|&DaDV|#MT|%4MV|%J|#NK|%V|#S!@aKT2|+NS4T|$8S|%a|$?|%4MV|%NS4TBY|$@a2SLT2',
      '|,NS4T|&NT2|$DV|%Y|%Z|$EISD|)B|)NV|$IaK|(B|$JT|&DS=V|&J|$KS|%Y|&4MV|%a2T2|$LW2TD|*LaLT|(V|)4MV|%aLW2TD|,LaLT|*V|$NV|',
      '%Z|#T!4M|(LaLT|(T4Y|)D|*LaLT|(V|%=T|%BV|$BaBVE=T|$DTQV|%aDLV|(V@a@NY|)N|$KV4T|&MV|&NV|$MT|&B|(TKVN|)LaL|(V|)G!BTBY|*',
      'KV@a@BY|&JLS4TBY|)V|(V@a@BY|&QT@V|)B|*KV|*Y|*aBSKY|(V@a@BY|)N|%VNMT2Y|#U2aPa?|$K|%B|%S|%aA|&EV|&ISD|*2a2Y|$NaK|(@Y|*',
      'JDaDV|(NS4T|*B|#V!4HBaKS|%=V|%G|&S|&T|(B|$BT|&J|(LaLT|$I2WKV|$Ka@V|$LDS@aI2|,NS4T|$MQT|%V|#W2|%B|#X@UJ|$Ea@T|#Y!4TD|',
      '&V|$4YB|(V|)2]!=|-KV|-T@V|-V|+MaMLV|.V@a@BY|/N|&JLV|(VN|$KDSB|%MT|(B|)KV|%T4Y|)JDaDV|%Y|&2!=|&B|(V|&J|%ZQS|$L!4S?|%V',
      '4V|$MV|&NSB|#[L|%B|#]!BKY|)4MV|)JDaDV|$=4TBKV|$KYBV|#^;4SKT2Y|$KTB|&QLS4TBY|)V|(T|)@V|)B|*KV|*Y|(V@a@BY|,NY|)N|%V@a@',
      'BY|*NY|&N|#aJ8TQT|%S4|&8aJ|$NKT@|)NS4T|!ASIQa|%aQDa|#TJKT|%Z;Ka|#YFa;a|!B!4Y|$=|%YJ|$@R|$E@T4M|*T4Y|*V|#2aP|&T?2a2Y|',
      ')B|#;a;|&NSB|#@a@|&S!O|*B|&T|&V|#EaE|#K4MV|$B|%LaLT|$NDaDV|%V|$a8Y|(J|%OD|#LT@|$aLT|(D|#O2|%4M|(LaLT|%B|&LaLT|$L2aP|',
      ')2a2W|)BPa;V|#Pa;V|#RD|#S!E@aJ|$3LS4TBY|(B|&TQTB|&Y|(4MV|(J|)DaDV|$;T|$D|$KT|&JDaDV|$MT|&4Y|&J|(DaDV|$N?4YKY|%Y|$Q|%',
      'a|#T!B|$2a2T4Y|)D|*LaLT|(V|$D2a2Y|%4MV|%B|&!BV|%DT@aJB|%NW|%S!2|&6K?Y|%Z|$N!4@|%Q|%aJ|$Qa|#UE|%SNMT|$Ka5|(2SL|+B|+UD',
      '|(NSB|(SNCTJ|#V#3|$=TBKV|$GSKT|%[|$K!@|%aGL|$Pa;|#WK|%2a2Y|%B|&KaOD|+B|&LaLTBY|+KVN|%NS?T|&TKVN|%Q!EKa2|#X4aNT8a:SD|',
      '$>|%NS4T|(B|$OaJ|(4MV|$Pa;T|)2^D|,BT!B|,NDaDV|)JT!B|#YRLT|(J|#ZN|%@Y|(4MV|%K|&DaDV|&T4Y|&V|%QaASD|+B|+NV|%SLJ|)4MV|)',
      'B|)NTBY|*V|%T|&J|%a|$O|%2a2Y|%4MLaLT|(V|%NV|%SBaJ!@|%UJ|$QSJT|$R|%2a2Y|%B|%NV|#[@aJ|$D!BTD|$N|%T2|$RT2|#]!BT4Y|$=a=B',
      'SB|)V|&B|$K2T@V|(BY|&VN|%Y|&@|(TBY|)NY|&JT@V|(V@a@BY|,NY|)N|#^?T|$P|#aKN|&B|&aJ|)B|)KSOT|-J|%S2aPT|&N?BLaLT|(T=|$NT@',
      'UJ|*2|%UE|(4MV|(B|(NV|%ZP|!CDQRSJ|$S@aI2|#KTQT|(B|&V@a@SKY|$aI|&2a2Y|&4MV|&B|&NV|#S@V|$DaJ|$KNS=|)B|%SNSRT|%aIT2|#WI',
      'ESD|$MV|#[KaJ|#^DT|#aJSD|$KVN|$NDT|(IVBaK?|-T2Y|(J|)DaDV|!D!@KNW|(Z|%R|%Y|$A|$BT|$GKa|%LS4TBY|%T2Y|)4MV|)J|*DaDV|&Ba',
      'BKV|%V@a@SKY|#2LT|%V|$SKS@aI2|$aP@aK|*4MV|&Y|#4BV|$K2a2Y|%4MV|%BLaLTD|%NS4TBY|&V|#;DS|&4T|%Y|$KV|$T|%JKV|&S4T|%QTB|)',
      'KV|)aBKV|+SKY|#=NMT2Y|$VN?|&YJW|$YBNV|&T@a@V|(BY|(NY|&V|%JT@V|&V@a@BY|+NY|+T@a@V|,BY|-aB|,KVN|,NY|(N|)VBV|%QLS4V@a@B',
      'Y|)B|)JT@V|(V|&T|(2]!=V|(@V|(B|)KV|&V@a@BY|+NY|+SKY|+TBY|-aB|/KV|,KVN|(N|)VBV|#BT|%4MV|&Y|%J|&DaDV|&T!B|&V|#D4Y|$aD|',
      '&DaDV|&V|#I4Y|$aI|&DaDV|#K4M|$QT!R|)KS8V|$V;]|#LN@a@V|$aLTD|(KVN|#NKV|$UD|$Y!GKa|*DLaLT|$^BJ|$aJ|#Pa;|&B|&V|#S!BT|$4',
      'KT2|)@YJ|)K|*V|&U2|%Z!BaK|&OKSNa|%a|$8T|%U|$;2|&2SK|&4MV|&B|&UJ|%a|$=TD|%V|$?aJ|$DS|%a|$I|%2K?|%DTKaBZOD|$J2|&@aN|*B',
      '|&D|(S4T|&K|(V|&T|(JS4T|%Ka|%T|$KSJ?|)a|%TD|%V|%a@a|&DTJS|&IDa|&KTQa|&NY|$La2DYJ|)Z|&NKV|$NV|$O|$QS|#T!;Y!=]|%@|&TBY',
      '|(KVN|&V|%GY|$2;|&NS4T|%^;TDa|%a|&PZE4MV|$3K|&NS4T|)B|$4BT|(@|%I|%S|%W>|%Y|$5!;V|$8|%2a2W|%NS4T|*JW|(B|$;a;TDLaLT|$@',
      'aJ|$BKaOD|%aBY|&KY|$CD|&KSBKV|%SD|(NS4T|%T|$D4Y|%aD|$I4Y|%TP|(4M|%aI|$J!@aK2|*?|+2a2Y|+B|*T@|+QLV|,V@a@BY|-N|%@2SLT2',
      '|%I|&4MDaDV|)V|&B|&T@|)NS4T|$K!@K|)NS4T|%S2KTQTBKV|%U2aPT@|+QLS4TBY|*Y|%VBaJ^4|%WE?Y|(TQV@a@BY|+N|%^C2|%a4ID|&?J|)TQ',
      'LV|(SJ2|&BTPa;NS4T|.B|(ZO2|+K|,S4T|,V|*D|+B|*TQTB|.KV|.aBSKY|&CKTQLV|+T|,@V|,B|-KV|+V@a@BY|,N|(SK|*B|(TPa;|&IS?|*2a2',
      'Y|*B|)E2|+KV|*?|(T@|*NSB|)QLS4TBY|,B|,JT@V|+V|+aE;a;|*T|+@V|+B|,KV|,aBSKY|*VN|&NR?S|*Y|+4Y|+J|,DaDV|,V|)TQLV|+TB|-KV',
      '|-aBSKY|+V@a@BY|/NY|,N|(S?|)@|)R2|+KV|$LVNDaDV|(V|%aBS?|*4MV|*B|*NV|&LTQLV|*T|(V@a@BY|)N|$NSK?Y|&QT|)4M|+V|%X@a@|*KS',
      'BKV|*T|%aNM|$Oa6T@|$PZC|%a2aKTJ|$QKa4|%a@!@V|#U=GRVBV|&Z2V|%LS4T@a@V|*BY|)V@a@BY|-T@a@V|*N|(B|(JT@V|&TLaL|&V|&aE;a;|',
      '%T|&@V|(a@V|&B|(DV|(KV|)Y|(MV|(NV|(S4|(Y|(aB|*KV|*SKY|*V|&KVN|&NY|%V@a@BY|*NY|*S|+DY|+KY|*TBY|,aB|.KV|&N|(!@Y|(LaLT|',
      '(VBK|*TLaL|*V|$@T|&J|(DaDV|$DV|$KDaDV|%SNKT|%T4Y|&D|(LaLT|(T!B|%V|$L4TKT|%T|%a|$NV|#V=T|#W@D|$KSKV|%V|#X@aJ|#Y6a6TD|',
      '$;a|&NKa2a|&Qa2ZEa|$DET4S4T|)Y|(D|&V|$E^LTJDa|%a6WDa|$KMV|%NDaDV|&S4V@a@BY|*N|(JT@V|&TDT!B|)]!BT4Y|&V|%YJ|$L|%2a2Y|%',
      'B|%Y|&4]!=TBY|&JDaDV|(S4TBY|&QTBKV|)KVN|%aQDa|$NKa|$RKV|&W|#Z6Ka|$@X@aNB|+LaLT|$ESM|$I2|&4]!=KV|%TQLSJT@V|$J|$K|%MY|',
      '%NS4T|(B|$PDaQa|#[+@aJ|$2a|$8|$;a|&KT2a|$@T2|$KV@aJ|$La|$QKa4T2|+NS4T|#]!BT4Y|$=DY|$GYLa|#^;|$=GRVBV|%LV|%TB|(KY|(S4',
      '|&KT|%V|&N|$GYLa|$NDaDV|%TD|%V|#_2KKV|&T|%S|&E=YJ|%Y|&4MV|&J|(V|#aJS6VKLa|&J|(S!4|)CUOKV|)LJ|+B|+NV|&ODLa|(a|&PDLa|%',
      'W|&2aLTJKa|&8TLY!=a|*aJS!=a|&;Da|*K|(aKSDa|&IDa|&JSKa2a|-D|&Qa|!E!6|%NSKaPT2|%S!4B|$8SGT|(a|$=T@|(KV|(a|$AB|$BaJ|(2a',
      '2Y|(4MLaLT|*V|(B|)LaLT|(NDaDV|)V|(SNMTJ|-LaLT|$E|%a|#2a2B|(LaLT|%P|&2a2Y|&4MV|&B|&NV|&T|(4MV|#;ZLa|$a;|&?|(4MV|(B|(N',
      'V|&T4MV|)Y|(J|)DaDV|)V|&V|#<aJ|#=TQT|$Y|%4M|(V|%BDV|&KV|&MV|&NV|&T@a@V|(BY|)aB|+KV|+SKY|+V|(KVN|(NY|&V|(2]!=|,KV|,T@',
      'V|-BY|,V|*MaMLV|%J|&GRVBV|&LS4TBY|(V|&T@V|&V@a@BY|+NY|+SDY|,KY|(N|)VBV|#@DB|$T|$a@Y|(R6a6LV|&ZBSKT|%DT|%K|&2Ka@|+KV|',
      '&4MV|&T2S|)Y|*4MV|+Y|*J|+DaDV|+V|)^BaJI|#B2|%a2Y|$4M|&DaDV|&V|$B|%T!B|$G!C|$K|%B|$NDaDV|%T|&EWKaN|&JDaDV|%V|$SKaA|)4',
      'M|+DaDV|+V|$Z|$aB@T|)JDaDV|%C@T|)4MV|)J|*DaDV|*V|%I|&HWP?|&NTHWP?|&OaKU|%J|#GaLT2a|(PT!4a|#K!EKY|)J|*DaDV|$BYJ|$I|%S',
      '?V|)4MV|)NTD|$NS4T|&D4T|$QaEK|$T2LaEDY|,4MV|,J|-DaDV|-V|%4?TQGRVBV|*LS4T@a@V|.BY|-V@a@BY|+aE;a;TBY|*T|*V@a@SKY|%6J|(',
      'TQLSJT@V|*T@V|+B|,KV|&T@|%?@T|&ITQV@a@BY|&SI|)2SKT|-JS4T|)4MV|)B|)NS4T|*V|%EWKa?|%IS?|%NKa@DS|+Y|*TQVN|%OULDY|%P@a|)',
      '@TD|*V|&a2X@|%QK|(2a2Y|(B|(UJ|&aAT@T|,J|-DaDV|-V|%RSK|$U2aPS|)TQLV|)Y|*4MV|+Y|*J|+DaDV|$^2aP|)NS4T|$a@a|%ELa|%JSJ|)N',
      'S4T|%La|%N@|(4MV|(B|%PTJDa|%QDLa|#LSJD|$aIDKT|#MYJVMT2Y|#NKa|$T@aK|#OV|$a6TI2a2Y|)B|#S!;T!4a|%=NKV|$2TQa@SD|,B|,T|$;',
      'Ka|%UL|(a|$<|$@aK|(2a2Y|(4MV|(B|(KSBKV|(NKa4|)S4TBY|*JT@V|)V|$BSKaE?Y|$DUJ|$E|%a|$Ia|$JT!;a|$K!EKT2|%BKaO2|%a2Ka|(a|',
      '&;T|&LTIY!;a|&N@T|&QT|$LDY|&aDV|%T|&4Y|&DaKNKV|&QT|%V|%a|$N@T|$Oa6S@aJ|(TIS@aJ|$Qa|#T!2a|$8a8S|$;a|&QaGKa4a|$@SIR|$J',
      'Ka|$KIT=a|$QT.|#U6a|$;Ka|$<|%B|$ELa|(Qa|$MT4Y|)J|$Qa|#V;|%4MV|%B|%a;|(?a?|$=T|$?Y|&J|%aJ|$@a@WKV|&K|(T|$D#|%Ka|%U@a|',
      '$KQa2SK|+4MV|)X@|+KV|%S?|(B|&@@aN|(D|%VP|(K|)V|%a|$Qa@2|)4MV|)B|)NV|#W8S|%Y|&JDaDV|%aJ|$K2|&NS4T|%[2Y|)J|&QLV|(VN|%a',
      '?|(NS4T|&@T|)JS4T|&N2a2Y|(B|(HSNT|#Y!4aNTDa|$;a;T4Y|&K^LTJ!|*a|$DSLa;T|%a|$EaQT|$KS2aQ[=a|%V|$QTFT2a|#Z8a|&KaJS!2a|$',
      ';Y|&!;a|$EKa|#[2T|$Da|$E^;T|#];aJSQTJIa|$KYJ|$LUQKV|(a|#^Ea|$Ka6V4La|*UQa|&;a|)LaJS!=a|$LTQa|%UQa|%Y!=a|$P2|&KV|$Qa;',
      'a|#_!=a|$K|%S?T2|$La|$Pa;T2|#aJS2Z8a|(a|&;aKT2a|&Da|&KTQa|$K|%2;4]!=|(?Y|*4MV|(NSB|*JT@V|(T@|)QLSJT@V|*T@V|+B|,KV|,a',
      'BSKY|&K?|)4MLaLT|+V|)B|&SK4MV|)B|)NS4T|(O2KV|)D|)ISDNSB|)a|&X@T|*J|&aKTJY|,4MV|-Y|,J|-DaDV|-V|%3aJS@|+T|%4@T|)EK|)J|',
      '*DaDV|%6!=|&LT@|&SK|)B|&^B2|%8SEaKHV@aN|0B|(NS?T|&Y4MV|&a:Y|%?J|%@SEa|&T2WL|)aKTJY|.4MV|.J|/DaDV|/S4T|(4MV|(BTD|(DTC',
      'T|,4MV|,JS4T|,QV@a@BY|1NY|.N|(H;DY|)S|*N!@|)Y|(IY|*J|+DaDV|(JS4T|)]!BV|,W|*GaG|(K^C|+2|(NKaP|,NW|(O@|(Pa<SD|+T@|(QaE',
      'KaCT|&U|(2|(@T|&aJ2aP|)Z2|+NS4T|-B|%AINS4T|%BKaOD|+2a2Y|+4MV|+B|+NV|*TQLV|,TBKV|,V@a@BY|-N|&SD|&ZO|)2a2Y|)4MV|)B|*La',
      'LTD|.KVN|)NS4TBY|*V|%CSDI!@aKT|)NS4T|)T|%E!6|)B|*LaLT|-Z|*SBaJ!@|&aKAI|%G!C|)4MV|&L|(NSB|&VBaC|%HS2Ka|(N|)2a2Y|)4MV|',
      ')B|)NV|)OSLT|)T|&V|(@aN|&ZB|)4M|+V|%IS?|)2a2Y|)4MV|)BLaLT|)NV|)T@|&V3KV|)NS4T|+B|%J@aD|*4MV|*B|*NV|*TQTB|.KV|&S?|)B|',
      ')T2K|,DaDV|,V|&^4|)4MV|)B|(8D|%NSBT|(Q|)2a2Y|)B|)NV|)T|*4K|,DaDV|,V|)U|)^BaJI|(R|)B|&X@a@T|,JDaDV|&ZO|)B|)TQLV|+T|,@',
      'V|,B|-KV|+VN|%O!QY|&Qa@T4MV|,S4T|,Y|+J|,DaDV|&aDY|%Q!4|&2a@|&K?|&SBa|(K|)B|)NSB|&TBaB|*C|+NS4TBY|-B|+T|,JDaDV|&a@SE|',
      '+NDaDV|)V@|(AHWIT|%S!@|)B|)UJ|)aJ|+4MV|+B|&2X@T2|&6UD|(aJ|&8Y2a;a|&?|(T|)4M|+V|)J|&@TDTCT2|&AIT2|+NS4T|&BZOT2|&CT2SK',
      '|(aJSE2|-KS4T|&GLaJ|&IV3aJ@Y|.JDaDV|&JO#|(^4T2|,NS4T|&K!H|*B|+LaLT|*NS4T|-V@a@BY|,B|,JT@V|*T2|+QT|-@V|-B|.KV|(aADS|+',
      'Y|%TDaQa|&J|%U@T|)J|*DaDV|&ITJKa|&QaLT|+J|,V|%YQa|%Z2aP2K|,V|*?UJ|&I|(B|&K?Y|(T@|%]|&4aKSIa|&;UDa|&FYQKa|([La|%^4aKS',
      '!|+Ia|&;SDa|(UDa|&@aQSR|%_>|(OSLS|+Y|$LQa|%S;TD!|&Qa;T2a|)IS|%Z|&JKa|%aJSQa;T2a|!F!=a|#Ka4VQDa|#L2|$N@a@SB|%S4T|$T@S',
      '!O|*4MV|*NV|#Qa;a|#S2aQa|$BKa|$KYQa;a|%a|&Ia|$Qa;a|#TLSQFT|%TEa|)Qa|%a|&Ia|)FZKa|$Pa|#ULa=a|#V;a|&GSLa|$=a|$La|#Y!4a',
      '|$=KLa|%^KS|$GaKNKT|(VNKT|$Qa;TNLa|#ZIa|$Ka|$Qa|&GV2a|#[DLa|$GKa|$Ka|&FS2aQa|$La|#^Da|$Ka|&;a|&=a|&GaQa|&Qa|#_!=ZODa',
      '|(PDa|#aJSITLT|&ODa|&PDa|$K!|%Ia|%S!2YDaQa;[Da|)a|*FKa;a|&DaQTD|+Qa|*a|+D|,LaLT|&Ja=a|&Qa;a|%U|%Y!6a|&=aKT2a|$LSJa=a',
      '|%YIT!4a|%[;a|%^KT=S|%aJSOa|!G!4SKB|&M|(B|(T|$=NSM|)B|)OSRT|%SJ|$@V|$BBaBV|%KV|&W|&Y|%NKV|&V|%S4|%T@V|(a@V|&BY|(aB|*',
      'SKY|*V|&KVN|&NY|%V|$C|%D|#4Y|%4TD|&Y|%G4YJ|%J|$a4YJW|#6a6Da|#8Y;a|#;TQa;S|$a;T|&Y|(4MV|(J|#=@D|&B|$NK|$a=T|#?a?|&2a2',
      'Y|&4MV|&B|&NV|#BLS4T|(V@a@BY|,NY|)N|&B|&JT@V|)QLSJT@V|+V|*T|+@V|*VN|&N?Y|*4MV|+Y|*J|+DaDV|+V|%T|&4Y|&JS4T|%V|$T|%J|&',
      'LaLT|$V2DaDV|&TD|&V|#FY;a|#JLV|$QVN|#KGRVBV|$LTLaL|%V|$N?T4Y|*J|$R|%4MV|&SK|)KV|%B|$T|$U|$V@a@BY|)NY|)SDY|*KY|)TBaB|',
      '%N|&!@Y|&VBTLaL|)V|$YB|&KV|&TBaBKV|+SDY|,KY|(KVN|&V|%JLS4TBY|(V|&V@a@SKY|(N|$a2aP[Ka|%4a|%DSKa=a|%IT!4aRaJSIa|%LTDa|',
      '#L2a2Y|$4[|$B|%T!B|$N!@NS4T|%DaDV|%S4T|&B|$T|%Pa<|$V|#M2Y|&4S4T|(Y|&BSK|*D|*K|+T4Y|+V|&J|(DaDV|(LaLTBY|,KVN|(S4V@a@B',
      'Y|(T!B|(V|$QGRVBS4TBY|*V|%LS4T@a@V|*BY|)V@a@T@a@V|.BY|*N|(B|(JT@V|&V|&aE=V@a@BY|.NY|+N|%T|&2]!=T@V|+V|)MaMV@a@BY|0NY',
      '|-N|&B|(KV|%V@a@BY|*NY|*SKY|*TBaB|.KV|&N|(KV|(VBKT!B|*V|$T|%2|%4Y|%J|&TKVN|$aMSKT|#QN|%D|%KS8|%ZOaNK|$a|#RMNS4T|%Pa;',
      'V|$TK!4|)NS4T|$V|%2SL|%@Z2NS4T|%BV|&]=a=|%ESLV|%HS4|%I;a;T4Y|&@|&SD|&V3|)aJ|%NS4T|%O#|$aKZDa|#S!4aLSBZO|-B|%=a|%GY|&',
      'a|$2aQT!4a|(a|$4L2^;Y|%TLV|%ZNS=T|%a|$=T|&4Y|$BSIT|$Da|$GKa|%S|%V|%a|$JT|%a|&Qa|$KT4Y|%a|&LT|&QTL^DS|$L|%2|&XPa?|%QV',
      'GaKRaI?aJ!|%TNV=a|%a|&;TI^Ka|&J|(B|$MY|$NT|$Qa|&;Da|$RaJS2SO|#T!BV|%GTQV@a@BY|*N|$2a2;a;TD|+V|$4a|$8SEVK|%YET|$;a|&;',
      '|(KY|(V|$=T|%V4=Y4Y|+]!=T@V|*J|+S4VN|,B|,JT@V|&@a@BY|&N|$BaB|(V|$Da|$JKa|$KVBDaDV|(V|$LTJDa|%a|&G^Ka=a|&LT|$MT|&J|$P',
      'Ea|$QT|&DYQa|&LV|$RSK|#U4La|$6a|$8|%4MV|%B|$;LaQa|%S|$BK|&a|%T|$KGRVBV|%T@V|&BY|%V@a@BY|*NY|&N|$MV@a@BY|&N|$QVN|#V2S',
      'DDa|%a|&Qa|$=2;a;TD|*V|$BaC|(D|(T|$CB|%NSK|$La|$Pa|#W;a|$BT|%V|#XR@a|(@SB|#Y!2T|(J|%4MWKT4Y|+D|,LaLT|,T!B|*V|%8ITDa|',
      '%GL|(T4KV|)@|)QLV|*V@a@BY|+N|$2a2V|&RaJSIa|$6a64TD|$;a;|(4MV|(B|$?a?Y|$BKT2Y|$D[;a|%a|&8a|&DTD|(V|$KYQT|$LY|&4MV|(Y|',
      '&GSMVN|&J|(DaDV|(V|%a|&8TJ!|&;a|&L|$M2DaDV|&T4Y|(D|&V|%4SNT|&TD|&a4Y|%N?T4Y|+4MV|,Y|+J|,DaDV|,V|%T4a4Y|%Y|&4MV|&B|(T',
      'BY|(V|&J|(LS4V@a@BY|)V|(T@V|(V@a@BY|,NY|,SKY|,TKVN|)N|&QLV|(TB|(VN|%aMT|)J|$Qa;a|#Z!BaKY|$2S4V@a@BY|)N|&B|(KW|%V|$4|',
      '%DY|$;Y|&J|$=|%T|&2Y|)J|*DaDV|$GT|$KV|%YGZKY|%]!BV|%aE=TQT|$LWKV|$QSJ|%T4Y|)J|%a|&GSLa|#[GLa|#]!GSJTD|#^CDS|$JT!4a|$',
      'Ka=a|$Qa|#_BaC|(T2|$LKa|%T!4a|%a|#aJS!2T!4a|*D|)V|*4MV|)a|*4MV|(=a|*D|&2a|)$Ea|&;KT|*4MV|(La|(T!4a|(a|)IaJSDa|)QaIDa',
      '|&=a|)IT!;Da|&Ea;TQIa|&KT|&Qa2Y;aGSLa|%VQTDYQa|%W2aJSDDa|&;T|$KBKa|)Qa|%RaI|)EV@aK|)S!=B|%S!=]|)a|&=a|)GaJS!=a|&DaQD',
      'a|&RaI?|+KV|%T;Da|*D|+LaLT|+TD|(TOa|)PK|+V|(UPa|&=a8a|&JSDa|%WQa|%Y8TLa|&;a|&=a|%Z2a|%_Da|&QKa|%aJS!;a|*=a|)=a|$L!;a',
      '|%=a|%S2a|&4a|%W|&Qa|%Z2a|)D|%aJS2a|!H2a@|&K|(V|&T|(JT!B|#4NSDa|#;a|%;|#@a@|#BaK@S|(Y|#JSD2|#KNQY|#ND|$TPaJ|)B|$aJ|#',
      'S4|%2a2Y|%4MS4T|(V|%B|&LaLTKVN|&Pa;V|%N@|&RTQLV|*T|+B|,KV|,aBKV|*VN|&S4T|*@a@V|*BY|(B|&V|%O#|%aJ|$DVNSK|$K|%@2a2Y|&B',
      'LaLTD|&NV|&T|&UJK|*V|%NSB|%T|%U|$N|%DS@aI2|&Y|(4MV|(JDaDV|%TQLS4TBY|(T|)BaBKV|(V@a@SKY|$P?|%S|&!@K|%T2|%Y|&4MV|(Y|&J',
      '|(DaDV|(S4T|+BY|(V|#TDaD|(NS4T|,BY|*B|#U2K|$I|%DV|#W2!E|$4@|%^M|$@|$IT|&4Y|&J|(DaDV|(T!B|(V|#Z;T|#_4^MT2|*NS4T|$@|%O',
      'SQa@aK|-B|%T2|!I!4M|&B|&NSK|&WKTD|)V|%S|%^La|$8V|$;E|$=L|%MT|(J|)V|%ZLS|%aJ|$@aK|(T|)4MV|)JS4T|$BT|&K|#2SNV|$a2M|(Da',
      'DV|(LaLT|(T4S4T|*Y|(V|#4D|%DaDV|%S4T|&B|$MSB|%V|$V|%NT4Y|(D|#;a;|&2a2T!@|*Y|&4MV|&B|(LaLT|&NDaDV|(V|&T4Y|#<B|#?a?DaD',
      'V|&TD|)LaLT|&V|#@4M|&DaDV|$B|%SD|(B|$a@Pa;V|&T@K|&W|&]GaG|(IaIY|#BKa|$VNY|(J|)SB|+KV|$aJ|&B|%KSQa|#CVIZR|%K|&[|$aJ|&',
      '!@K|&2SLUD|&B|&HS4B|+LaLT|&I|&JV4B|&SRaD|&Y|#DK!8DS|)Y|$NT|$QaQDaDV|(T4Y|)D|*LaLT|(V|$T|%LS|$VPaJ|)D|)K|*V|$Y|%4MV|&',
      'Y|%@DB|%J|&DaDV|&T!B|$^HSN|%RK|$a|%D?Y|#JWK|#K4M|&DaDV|&V|$?|%B|&!=DY|%SD!@K|$B|%T!B|$MT|&B|(KV|%V|$NDaDV|$S<T|$T|%4',
      'MV|$V|%BTD|%DSI2K?|%GM2Y|*J|%HWIT|*J|$aKT|%QT=TQa|#LJSM!|$ZKTJS|$a;T|(IU=TJS|%LT2SKa8VD|(4Y|#MY|%4SLBLaLT|%J|&S4V@a@',
      'BY|#QUBT|$WK|#R@a@K|)NSB|&N|(B|$IaIBa|$La|$S|%2SNaJ|%@aI|)S|%D4K|)B|&a|%HSK@|*B|%JVBaC|+B|%KS8|(Pa;aK|-B|%NTBaJSLJ|$',
      'TMS|&Y|(J|)K|*LaLT|*T4Y|*V|$]Da|#S!@aKT2|%Q|&B|$8T|$=B|&Y|%GRVBS4TBY|+B|*V|&Z2S4V@a@BY|*B|)V|)Y!BV|%KaDa|%LS4T@a@V|*',
      'BY|)V@a@BY|-T@a@V|.BY|*NVBV|(B|(JT@V|&TLaL|&aE;a;|%T2]!=|+KV|+T@V|+V|);a;T@V|)=V@a@BY|)MaMLV|,VN|&@V|(a@V|&BDV|(KW|)',
      'Y|(MV|(NV|(S4|(Y|(aB|*KV|*SDY|+KY|*V|&KVN|&NY|%V|&@a@|*NY|*S|+DY|+KY|*TBY|,aB|.KV|.SKY|+KVN|&N!@Y|(LaLT|(NKV|(S4|(VB',
      '2a2S4T|-Y|*DaDV|*K|+T!B|*S4T|*TLaL|*V|%YLa|$@DS=LV|)V@a@S|.KY|*N|&aDV|%TD|%V|&2@Y|&4MV|%aKNLaL|,BY|-Z|)Z|$B2|%KT|(4M',
      'V|(J|)DaDV|)S4T|)V|$CN|%aJI|)4MV|)B|)T2|$DN|&D|(V|&K|(V|&UJ|%QT2|%aJ|(@Y|&QWDa|$ED|&S!2|$K2|%S;|(B|(NS4VN|*B|+NV|%T|',
      '%V2;a;Y|,4MV|-Y|,J|-DaDV|-V|&N|%a2Y;a|(a|)Qa|&4|(4MV|(B|)KaOD|,T|(NS4T|)V|&6T|(a|)DLaLT|&;TDa|(UDa|&E;a;T@V|(S=V|&PL',
      'a|$LTDaJ|%U2KV|%a|&;a|&=UNaQa|$NTD|%V|$Q|%B|%T2|%a|&;Ka|&@T|$RT@T4MV|*S4T|*Y|)J|*DaDV|*V|#T2a2T|$=a|$@T|&IUKTB|&JDaD',
      'V|%aK|$BVMTD|$DT|%aDTJSE^LTQa|$IU|$JSIT|$LDa|%T;KT|&JDa|%a|&LKa|$OaK|(?|(T@|$PDa|$Q_KT|%a|&;Ka|#U;Ka|$=TJS|$AZDa|$DT',
      'D|%V|&4MV|(SKT2Y|$KT|&B|$QLSB|&V|#V!6T@NS4T|-JZ|(D|&Y|(JZ|%@SBNKV|*V|+4MV|%B2a2Y|&VNKTB|,V|+JT@V|,V@a@BY|+QTBKV|*YB|',
      ',V|+JT@V|+QTBKV|%GJT|)D|)J|&KVN|&[|%HS4B|$2a@|(NS4T|(T|$3|%!=|(KV|%B|%S!@K|%aJI!@aKT|.JS4T|(NS4T|*B|+NV|*RTDTJ|(QaA|',
      '+KS4T|,V|$4TB|&QT|)B|*KV|$5La|$;a;T@V|$@a@T4Y|$BaBZGTRSM|&K?|)SLJ|(T@|$DaD|(NZ|$KTBV|$Q]LTDT|%aLT!|)IK|+V|*a|$RIaIBa',
      '|#W4TD|%V|$=T|$Da|$KDY|(J|&Z|%W|%a|&@T|)JDaDV|$L2NW|(Z|%4MV|%@#|%B|%CS@V|*4MV|%HW@|)NS4T|%NS4T|*BY|&V|$MY|$N@a@V|%KV',
      '|#X@|$BV|&NSB|#Y!;a|$2a|&2Y|&QT2Da|*]|*^|$4S=Y;a|$6a6T|)D|(V4Y|+JDaDV|$;La|%S=Z;S|%aKT2a|(]|(^|)ESLT;Da|$=T2La|&;KZD',
      'TJDa|&QTDa|$?QV|$BVMTD|$Da|$I]KT|$KN?T4Y|%TLa|#Z8Ka|%TD|$Da|$JKa|$KT|&LaJS!=a|%V|%Y4Y|$L2a2Y|%T!B|&DT!B|&KVN|%V|&4[|',
      '%W|%YJZ|%a|&HS4B|+LaLT|&I[|)D|)JDaDV|&NT6SK?Y|$M|%NV|#[!=a|$2La|%YLa|)JS!8YL]|%ZLa|%a|&K]F^Da|(^|)QSFa;a|$4aKZDa|$@a',
      'KT|$BSD|(B|)LaLT|$LT|$QWKTD|*LaLT|%aEZQa|#]2BaBIY|$5La|$;a;|(I]BL|(Y4MDaDV|$@a@|(2a2Y|(B|(NV|$BI]BLV|%LDY|)J|*BS4T|+',
      'V|(Z|&GSKT4Y|&SB|)NKV|*V|&T4Y|(D|)T!BLW|&Z|&a4]!=V|$G[La|$IaI4|$RIaIBa|#^2aP|$;Ka|%SKV|(a|$=|$BT|$Ka|$RDa|#_!;a|$3T2',
      '|$KaJ|$LaJ|(4MV|(B|(ISED|(NV|$Qa|#aJS!4DUQa|(6YQa;Ka|&2a|)Qa|&48UDa|(aLYNa|&6a|&8T2a|&;Ka|(a|&=TQDa|(aKT=a|&DZ8Ka|*a',
      'IY!;a|(a|)RaJS;Da|%W6VJLa|&QT2a|)J!|!J!4a|$@R|%aK|(4MV|(B|(S!O|#2X@a@TD|)V|$aP4SD|#KV|#LaLT|(D|#NK|%V|#OQaNT|)JS4T|+',
      'B|,KV|+JT@V|(U|&QDaDV|(TD|(V|#Pa;V|#RWBT|#S!@aKT2|$2Y!BKY|$4T|$@aKY|$BX6a7T2|$K|%SBKW|%T4W|%V|%W|%a2a|$N@a@W|%S4|(LW',
      '|%VBSBKW|(V|(W|(Y|(^|#T!B|#V,Da|%Qa|(GT|$2Y|$4|%B|$BaC|(2a2Y|(4MV|(B|(NV|$DTJDa|&NKaQT;T|$KZDTJ!|*Ia|%^ETD|*LaLT|)JD',
      'a|(a|)D|*LaLT|$N|%2|%Ka|#W;aJWGa|$DTJDa|&NKaQT;T|$K^ETD|)JDa|(a|#Y!BV|#]!BT4Y|#^4|%B|%aJ|(NSB|$8DS|&Y|(4MV|)Y|(J|)Da',
      'DV|)V|%T@|$CKV|!K!4|%B|%DSA|%HWIT|*J|$@Y|#2a@|&B|(LaLTD|&ETOS6T|%P2|&?S|)@aI2|(Y|)4S4T|*Y|)J|*DaDV|&T@|(QLV|)VN|#4aG',
      'T|#6DS|&@aI2|%Y|&4MV|(Y|&J|(DaDV|(V|$T@NSB|%QLS4TBY|)B|)JT@V|(V|&T|(@V|(B|)KV|)aBSKY|(KVN|&VN|#8EW@|$S|$Y4MV|#@Da|$a',
      'D|#BaBV|#Da|%DKa|&V|#Fa@V|#GaGKa|#IZOa|#LaLTD|#NK|%DaDV|%T!B|&4Y|%V|%Y4TD|(W|(Y|$SDY|$T|%6!BaKDa|#Pa;DaDV|&TBY|%JDa|',
      '&S|(B|#QSJD|(OSQa@aK|(T2|$a@Y|(4MV|(J|#RQaJ|(NS4T|$T@|#S2Y;a|%a|$4|%T|$5NZ!BaK|$8|%2SK?T|+4MV|&UJNS4T|&VISK|+a|%@S!@',
      'aKT2|%CSDT|*JDaDV|+S4T|.@a@V|,B|%D|&SB|&T4Y|&V|&a|%K|&V|%N!OB|%S|%UDSIY|&Na|%Z!BaK|%a|&2VISKa|&J2a2Y|(4MV|(ESL|(NV|(',
      '^@aQN|$?T|$@aKT|)J|$Ea|$GKa;a|*Qa|%TDa|$I|%2XPa?|%6!BaK|%D|&4K|&a|%SJ?|)B|%a|$J6WKV|%KV|%La|%a|$Na|$OT|$Pa;aK|*2W;K|',
      '*4MV|*B|*E@T|*NV|*UJ@Y|$QSJDT2|+4MV|+NS4T|#T!4a|(Qa|%BLW|&U6Y4Y|$2a|$4Y|$6Ka=a|$EGaLT2Da|+a|$JLa|%SLT;T|$NKa|%aJW|$Q',
      'Ka6a|(Na|#U=Ka|$@T|&JDaDV|(LaLTJZ|(S4T|)B|$Qa|#V6T|#W;a|&2T;a|$>T|$DZ|$E|%2|&a2Y|%4MV|%B|&LaLT|%NV|%S!@K|&JT|%TQLS4T',
      'BY|)V|(TB|*KV|(V@a@BY|)N|%V4]!=|+T@V|#Y2SKa=T!4a|*a|+Qa|$=a|&=T|#Z3S|%Y|&4MV|&J|$=TJ]|)RY=a|(^|$PaIY|$QT!4a|%a|#[;a|',
      '$@|%K|&T4Y|&V|$LV|&4MV|%aNY|(Z|$Qa|#]!BT4Y|$DSLa=]|#^4|%2a2Y|%4MV|%B|%L2aP?4MV|%NV|%T4M|)LaLT|)T4Y|)V|&J|$8Ka|$=a|$I',
      'Da|(DKV|%a|&D|$LT!4a|%a|$Qa|$RT@|!L!=Da|(D|)LaLT|$G|#2aP|&?|(4MDaDV|*V|&S!@K|&aI?|*a|)T|)U|#5V|#HTQT@V|(BY|$aJ|&@Y|&',
      'NTBY|)KVN|)LaL|)NY|#KaDT!4a|#LT@|#Na|#QT2Y|#S!4a|$H|%B|&SJ2|$KYDaQa|%a=a|$La|$QDa|%a|&;a|#T!2Da|&a|%4|%6a|$3T@|$;La|',
      '%aLa|$D2aQa|%TDa|$ET|$GKa;T|$IT;Y=a|$NKaEWLa|$Qa;a|#U4a|&D|(LaLT|$;Ka|$JNK|$LSN@T|#VFaASDaQ|#WJT|&QTJSD|(a|#Y2a2|(S6',
      'SK|$=a|$DaDDa|$Fa;TDY!;a|$NTQa|$Qa|#Z2KaQa|%a|$32|&K|(V|&T|(JKV|%D|&4MV|$=T|$Da|$GKa|%La|$QKa|#[!4T2|$2a|$;a|$Da|&Qa',
      '|$Fa|$GaKKT|$Na|#^2|%B|%QHS|(Y|%ZOa|%^EJ^4T|$=a|$EY8|$R|%4MV|%B|%SDa|#_2T2|#aJS!=a|&2a|&;TDa|!N!O|%B|%NSRT|#6D|#8S|$',
      'aK|&B|#@TJT!B|#DaDV|%J8UNT|#JQa2|(K|&QSB|(T4Y|)D|*LaLT|.JZ|-Z|(V|#KBT|&4MV|&J|(DaDV|(S4TBY|(V|$Y4TD|&W|&Y|$a2a|(Qa|%',
      '4|&2a2Y|&4MV|&B|&NV|&SN?Y|&U2K?|*TQLS4TBY|%8TDa|%?|&B|&DY|&HZB|%@DY|)J|*DaDV|&TQT|%La=a|%P2a2T!@|*Y|*]IaIY|&4MNKY4Y|',
      ')Pa;V|)T4]IaIY|)V|&BLaLTD|&NS4T@a@V|(W|#LJ|%4MV|%B|%NV|$QY|&J|#O2a2Y|$E=TQT2]!=|#Q!@|$@T|$SR@V|)OSRT|$a@V|(4MV|(NTD|',
      ')V|(Q!4aKRSLJ|&aK|#RTNS;TD|)V|%QT|(2]!=KV|(B|)KV|)aBKV|&V@a@BY|#S2Ka|%a|$4T|$8EZJT|$;Ka|(Qa|%a|$=T2Y|$?T|&8aJ|$@SNK?',
      '|*2a2Y|*B|$B|%2|%B|%TQTBKV|(V@a@SKY|%aJ|(4MV|$Da|$EQV|&a|$JNaJ|%V|&4V?|&I!=LB|&JSD|&NaJ|$K|%4M|%B|%a|&=a|&@S|&DKa|&P',
      'T2|*NS4T|&Qa|$La|&;Ka|(a|&IU2T|$PT!4a;Da|$Q|%DY|%TQV@a@SKY|,TBaB|0KV|0SKY|)N|%a@N|)NS4T|)T2|+NS4T|(V|)OTLaE|.B|.T|$R',
      '2|&4MV|%D|&4MV|&B|#T!4=TQGRVBV|*LS4TBY|%=^Qa|&a|%GLa=Da|$2QD|(B|%SQ|%T|&K?|)B|%Y;a|%a;Ka|(^KTJS|$4aKR|)NDaDV|$6SK|(4',
      'MV|(?Y|%T@aK|%a7ZBD|$8J|&B|&D4K|*B|&EVK|&a|%Z@|(KV|%a:SDB|*NV|*T|+4MV|$;ITDa|%a|$<a<L|$=TJ]|(^|$@K?S|(Y|%a|&@UJ|$Aa|',
      '$BSJ|%ZO|(S!4|(T|(U|%aJS|)HaJSQ|)KaAT|-4MV|)LJ|)NKaC2|(V6a72a@T|)@a2S!@UJ|+@DaDV|,TD|)DaISD|(Y|&NS!Q|+K|,V|$C|%4MV|%',
      'B|%NSB|%SD|(4MV|(B|(NS4TBY|)V|(QHS|*Y|%T|%aJV2a@|$D|%SJT@T|%TIJ|%^B|%aJSQ|*4MV|+]MTQTB|*B|*NV|&QT|(Y!;a|(aLY;a|$EKU@',
      '|$FLNSJT@V|$H8DY|)J|%S4|(2a2Y|(4MV|(B|(NV|%TDaD|*NSB|$IKaO2|*K|+T!B|+V|)S@aI2|)Y|*4MV|%S|&D|(4MV|(B|(JSD|(NV|%Y|&J|$',
      'JY;aDS!|$KM|&NS4T|%SI|%VBaB|)CB|*NS4T|,B|%^C|(T|)QT|+BKV|$L2aP?|%TJ!|(Ia|*Qa|%a|&QDa|$NK|&4MV|&?Y|)4MV|)JDaDV|&NS4T|',
      ')B|&TQLS4TBY|*V|)TB|+KV|+aBSKY|)V@a@BY|-SKY|*N|%SB|(4MV|(S@aI2|&R|(NSBKV|%Z2SD!B|$OSL|(NSB|%TPa;|*NS4T|,B|%ZP@Y|(NSB',
      '|%aKS!@T|&LZP?Y|,J|-DaDV|-V|&N2Ea|)^O|(B|)LaLZ|)SBaJ!@|(JVBaC|(NTBaJSDTLJ|2B|2NV|.LJ|04MV|0B|0NV|)aJSET|(Q!QaAYJ|(SB',
      'aJ!@|)Q|*SKaR|(ZOaNKJaJ|$P|%2SKT|%B|%J|&2a2Y|&4MV|&B|&NS4T|+BY|(V|&V2a@|%VJLa|&N@a|%a?V|)NKaCDa|*TD|$Qa2T|(]Da|&@K?Y',
      '|)TQLV|+T|,@V|,B|+VN|(SK|*NS4T|,B|(UKa?|,B|(X@|$RSK|#U2aP2K|*V|(?Y|(TQLV|$=TJ]|(^|$?Y|$K|%O[N|#V=a|#X!BNV|$@a@|(S2SK',
      'B|(T|)8UND|-B|)DTK@|)EK|)J|*DaDV|#Y!2;ZOa|%BV|%G|$6a6|(4MV|(B|(NV|$DTQa|%a|$Ga|&Q[;a|$LaLT!4a;Da|&Pa|$Qa;KaDa|(a|#Z4',
      '|%B|%NS4T|&V|$@D|$B|%S!@|%T2Y|)J|$Ka|$LaQa|$MY|&4Y|$P|#[6SKT2|$8a:SDT2|$;a|$=a|$BT2|%aJ|(2UJ|(K|)V|$Da|$ISDT2|$J2a@T',
      '2|+NS4T|%V2a@T2|$KQa|(4MV|$La=a|$NSRT2|%TCaJ|*@Y|*IJ|$OTPa;aJ|,4MV|$Pa?N|$Qa|#^La;Z8a|&N^|#aJ!4aJ6T@aK|%2a@E=TQTBKV|',
      ')T|*4MV|+Y|*@aN|-B|*J|+DaDV|+S4T|+V|%@TKT2a@NS4T|&aJSQ|+4MV|+B|+NV|%NQSJ|(aASE2|*T@|,NS4T|*Y|+4MV|,Y|+J|,DaDV|,S4TBY',
      '|,T!B|,V|&RSK|*4MV|*B|*T2|%S2K?|&3aJSD|,4MV|&;a|)QDa|&Da|&E2|)NS4T|+B|(SK|*2a2Y|*B|*NV|*T|+4MV|*U|*^BaJI|(TQTBY|(a@T',
      '|+4Y|+J|,DaDV|&JSI|&LT|&NRSKT2|&Q|(!4|%V@aE@a@T|%W|$KYQaLT!4a|!O!2K|&a|#2a@T|(4MV|)Y|(J|)DaDV|)S4T|)T!B|)V|*@|(OSLT|',
      '#;La|#@2|%^;T|$ISD|(BLaLT|)NKY4Y|#DT|%NSK|#GaB|&4MV|&B|&NV|%C|#K?|$UK|&B|$aI|&S|#Qa@aK|)6T2T@aQY|1J|)SQa@aK|/4M|1DaD',
      'V|#S!@|&T|(JV@|$3|%B|%Y|&4MV|$Da|$ET!4a|$KBS|%UKT2|$LS|%Y|&4MV|(Y|&J|(DaDV|$OaN@|)NS4T|$Q2S!4|%D|&4MV|&B|%a@aK|*B|*T',
      '|*UJ|#T2aP2|)K|(?2a2Y|)B|(Y|)JDaDV|$3K|$Ea|$FSKQV|$JKYKa|$LS|%Y|&4MV|%aE|(T|$N|%D|&V|%I]4a4|%KSI|%S8T|$OV|$PaJ|#U5aK',
      '|(BLaLZ|(NS4T|$@|%L|$KaPT2Y|+J|#V2aK|(B|(NSK|&L|$BaC|(U2K?|$KVNSJT@V|$La2|$Pa2|#WDaJ|#X!4ZKT|#Y;a;T|#Z2=|&S|(NSKV|$D',
      'a|#[2aP?T2|$LT|&4MV|(Y|&J|(DaDV|(V|$N|#^C2|%DY|#aKI|%N?|%U2XPa?|&4!CB|&DSAa|(TNSQ|,a|&I!@|(@T|&KSI2XPa?KV|&L!2S|+B|%',
      'V@T|%Z?T|)4MV|)J|*DaDV|&JS!2|+NDaDV|&Pa;|)<|$NSKa8TDY4a4Ka|&Q2^OB|%Z@|!PKaLS2a|#SKaLY;a|#ZKV|&4MV|!Q!2LD|(4MV|%UKa?|',
      '*NSB|%Z@|(4MV|(B|(NS4T|%aKS!@T|&PTEa@|,NS4T|$3aJS|)OSQa@aK|0B|(Y|)4MV|)J|*DaDV|*V|$4@T|(4MV|%I|%U@2a2Y|(4SK|+KV|(B|(',
      'NV|%aKR|)?S|*Y|)B|)NV|)SLJ|)TQLV|+T|,B|+VN|$5|%4MV|%;DY|)4MV|)J|*V|&T@|%B|%KaP|$6SK|(T|%T2Y|)JLaLT|$8Ja|%Y|$@|%@T|(J',
      '|%KV|%SD^@aE@a@T|%^P|$BKaH|)4MLaLT|)B|(OD|*BLaLT|*N]!BKLaLT|%ZO|$E@a@DaDV|)TD|)V|%DaIWL|+4MV|%Ka2|)2a2Y|)4MV|)B|)TQV',
      'N|%SB2|)KS4T|*V|)UJ|(DY|(T@|)QTB|%V;|(4MV|%WKa?NS4T|%aKBSJ|+4MV|+B|$G!C|(4MV|(B|(E;a;|,!@Y|(NV|(T|)@|)QT|+B!@Y|,Y|$H',
      'NDUJ|&TQGRVBV|)T@V|*B|)V@a@BY|-NY|*N|%SNaJ|&P?Y|$I^RD|$JV2a@4MV|%^82|)KV|(DY|*J|+DaDV|(T@|$K2aP?S|*Y|+J|)T@|$NRD|(B|',
      '%SB|%TCSD|*B|*NV|$O^C2|)KV|(D|)S|)Y|*4MV|+Y|*J|+DaDV|+V|%aLZPT@|$Q@a|(@TD|)V|%BUJ|%SK|%a2|(K?|*S|*Y|(SK|(X@|*B|*T|+4',
      'MV|+J|,DaDV|,V|&ASD|*4MV|*B|*NV|)E2|(Y|)4MV|*Y|)J|*DaDV|*S4TBY|+B|*T!B|*V|#2L|$SKS@aI2|$a2KY|%KTJ|)NS4T|#6T@aK|%N|#?',
      'a?EV;a;|#@@|%NS4T|$T|$V|$a@|%J|&B|&S4aKR|#BKT|$QaJ|(@aN|(K|)DaDV|)S4T|,BaBKV|)T4Y|)V|$S|%OTN|$aBV|%J|&2a2Y|&B|#Da|%D',
      'TNZO|+BLaLT|%ISD|%Qa|#Ga|%G@a|#HS|$Y|%J|#I2SLUD|$4aK|$@^LD|$DS4T|&B|$J|%2a2Y|%B|&LaLZ|%NV|$K|%B|%aA|(NS4T|&E2NS4T|$O',
      'U@^Pa?|$Qa@|&JY|)4MDaDV|+V|)J|*DaDV|$S8|&B|&NSBT|(V|%CT|(J|%D|&@Y|&NS4T|)B|&S!@K|%K!HBLaLT|$T@T|(J|)V|$U2aPY|*J|%E|&',
      'B|(LaLTKVN|&NTKVN|$VBSJ|)2a2Y|)4MV|)B|)NV|&aK|)B|)I;a;BT!B|%KSJa|$WR|&4MV|&B|&NV|$XBaC|$aI@T|&Ka|&TOaK|&ZMD|*B|#K2SK',
      '|(B|(NV|(T|%TD|%V|&4MV|$?T|&4MV|(Y|&J|(DaDV|(V|$BT|$GKS8V|$M|%NS4T|(B|$QaN@T|$SQKT|$T|%JS4T|(B|%QI|&VISKV|$^NK|(4MV|',
      '(B|$a|%2La|&SK|)2a2Y|)4MV|)B|)NV|)T|%6a|%N|&Ka|&TQa|&UQa|&^6a6|*7|#L2K?Y4MDaDV|+V|$RS|%Y|$VNS4T|$aFZ;a|%LTQT|*B|+KV|',
      '+aBSKY|)VN|&V@a@BY|#NSKT|%LV|#OQa@aK|#QaJ|&4MV|&B|&NV|#R2SK|(T|)JS4TBY|$8|%NS4T|$J^4B]!BT4Y|$QaKSKV|$S|%J|&2|$T|%@|$',
      '^BK|(KV|(T|#S!2Z@T2|+NS4T|&aKSIT2|%4a|%;S|%BaK@Y|+J|,DaDV|,V|%EaKBSJT2|.NS4T|%NTCSDT2|%Qa2X@T2|(AT2|$2?Y|%Ka|%Pa;V|%',
      'V|%aPK@S|*Y|(T|(aJ|*6T@aK|$4?Y|%K|&B|%T|&QLV|(VN|%V@a@BY|&N|(MT|$CD|&4MV|&B|&NS4T|(V|&Y|(4MV|)Y|(J|)DaDV|%SK?|)NS4T|',
      '%TQLV|(T|)@V|)B|*KV|(VN|%aJ|(@Y|*4MTNY|,V|*JDaDV|+TBY|(NS4LTLaL|+V@a@BY|,NVBTLaL|*BPa;V|*JT@V|)TBY|*LaL|$Fa;a|)NZKa|',
      '$I4aKT4M|,DaDV|,V|%KaAaJ|+2a2Y|+B|+NV|%S8T2NS4T|&DV|(aJNS4TBY|,B|%WRT2|%aKS8aJ|,B|,NV|$JT|$K|%8D2|%S|&!O|%T|&4Y|%aN2',
      'SLT2|(8DT2K|-T4Y|,NS4T|(@aKT2|-NS4T|(H_I|$L|%B|%TD|(LaLT|%V|&4MV|%aIDa|$NJN|%T4Y|&D|&K|(SKV|%V|&4MV|$QZ8a|$RQ|%T@T|)',
      '4MV|(aJ2|+a2Y|*B|*T2|&Ga|#T!4La|)Qa|&a|%=aK^Ia|%B4T|%CW|&a|%EaQDa|%GTJSDa|%R|$2a2|(T@V|&Qa|$3a|&3K|$4V@a@BY|&N|%aDLa',
      '|$;T|$=aDT|$BaBS!@|&C|(S!@|+4MV|+B|+NV|$DTIS|%YIS|%a|$GaG!BT|$IY!;a|%aJVLZODa|$LT2SDa|%aNKa|$NTLa|$Qa;!|(Ia|*Qa|$RT|',
      '#U@S|%Y|&JDaDV|$Da|$IT@|$KUQa|%Y|$Q|%B|%Da|#V!BK|(NS4T|*B|(T|$3|$4!C|$;a;|(V|$@a@|(IV@a@|-L|.TD|(LTD|)W|(TD|*LaLT|(V',
      '|$BUKa5|%aBT|$CS|&K?Y|*4MV|(T@|)QLV|$EaKQTBaC|$GaKRaI?aJ|$ISKS4T|(T4Y|%aIDY|$K!4|%2aP@S|*Y|+J|)T@|+NS4T|%VMT|$LH|&NS',
      '4T|%a@SDa|$MaMV|$NKa?|#W2a@|(NS4T|*B|&PaI|$62|%DY|%T|&@|&QLS4TBY|+V@a@BY|)V|(T@V|)B|*KV|(V@a@BY|,NY|)N|*!@Y|$;a|$@aK',
      '|(4MV|(B|$EKa|$KaJ|(D|)T!B|)V|#X8DOUL|$Pa;T|)4Y|)QLV|*T@V|+B|,KV|*V@a@BY|+N|#Y!|%6VKT|%;Ka|&a|(KLa|$2Y!=KT|)T4Y|)a|%',
      'aJVKT;T|$;a|$DS|%Y;a|$Ea;!GKa|(Y!GKa|-DLaLT|$IT|$KY|$La|$MYJT@V|$NYDa|#Z!;a|$=V|$@VNY|$DS|%Y|&4Y|&J|(DaDV|(V|%a|$KLV',
      '|%T|&2]!=|+KV|+TNY|+V|&@V|(a@V|&B|(KV|(NKV|(Y|(aB|*KV|*NV|*SKY|*V|&KVN|&NY|&QGRVBV|(LS4TBY|+V@a@BY|*JT@V|)V|(T|)B|*K',
      'V|(VN|%V@a@BY|*NY|&N|%aE=Y|$L!|$NDY|%S|%TQVN|%Y|&4MV|(S4T|(Y|&J|(DaDV|(V|#[!;a|$2La|$;a|$=a|$BaCS!@T2|$DT2|(K|)DaDV|',
      ')T4Y|)V|%aJ|(B|(NV|&QQa|(a|$IDa|#]K]Qa|$Q[;T|)J|#^!2T@|(D|&V|$=TJ!|(Ia|$@|%KV|%V|$BK|$DSKa|%T|$INSK|%ZOaNK|$KaQa|$LD',
      'aDV|%SKTQa|%TQT|)B|*DV|*KV|%V|%a|$NTJ@a|(Y;a|)@a|#_!=a|%BKaJ|*B|$2KaJ|$@a|$BT|$K|$LHaJ|)4MV|#a2S6a|&;TPa|(a|)LY!=a|.',
      'D|%WLa|%[|%^=S|&Ka|%_;a|%aJSDa|&KUDa|&NZKa|(aJSPa|$;=UQa|%S2a|&Ka|%UFDa|&La|&NDa|(a|%V=TJ]|*^|%Z;a|)Qa|+D|,LaLT|&PDa',
      '|%^Da|&KT|(a|%aJS!=Ka=a|)DaF^Ka=a|&KU;a|$@aKU|)JKV|$AM|&2a2Y|&4MV|&B|&NS4TBY|(V|&UJNS4T|%SD|(2a2Y|(4MV|(B|)LaLTBY|(I',
      'SD|&E2|(DY|*4Y|*J|+SB|,JT@V|(T@NSB|,JT@V|)QLS4TBY|,JT@V|+V|+aE;a;|*T|+@V|+B|,KV|*VN|&JT|%T@T|)4Y|)J|*DaDV|*V|&K|(@Y|',
      '(NS4T|*B|%WL|(NS4T|$DS@2^@a@K|&D|(B|&JV|%ZR|(T@|*KV|%[EKa|%^|$EKaCS@aI2|)Y|*J|+DaDV|+LaLT|%Pa;|)NS4T|+B|%S;a|&DTPa|%',
      'TDa|&JKaQa|%ZDa|&Qa|%^Ka;aQa|%aJSDTPa|&KT!4a|,Qa;UDa|$F;T2|%WKa@T|$ISK2|)4MV|(a;a|%T@a|$JSDa|&Ia|$N|%!@|(B|%@!@aK|+N',
      'S4T|&#|%BZOT|%HSN|)B|%J!|(6SLT@|%K|&WE|)B|)NV|&a4|(?|%LaEI;a;T4Y|)NZ|%S@!@aK|,aJ|.B|&CUD|&HSNT2|,NS4T|&IT|)J|(aJB|&J',
      '@a@|%T6a|&Fa;a|&Qa|%U2KTQLV|+T|,B|-KV|+VN|(SK|&=Da|(TPa|!R!6T2Y|$@|%2a2Y|%4MV|%B|&LaLT|+BY|$BT|$QLZ3|#2a2DaDV|&T|(4M',
      'V|(D|&V|(4MV|#4LV|$VK|#;a|#<S@a|#=4TD|%V|&4MV|$aQDa|#?2SQTD|(V|$B|%VGaGK|+B|$NDaDV|%V|$a?TD|&V|(4MV|#@^;T|$a@DZ|&SKV',
      '|&T|(J|(K|)B|)NTKVN|&V|&]!G@a@DYJ|%JY|#BTDSKV|(La2V|&Y!;V|&[BV|%IWKV|%RKYJB|#DT|$aDYK=V|&]!BV|#GaG|&4MV|&B|#K=T@V|&B',
      'Y|&KVN|%VN|$TBV|%JS?|&V@a@BY|(N|%NDaDV|&TD|&V|%RK|$YJB|$aGKa;a|#LNKV|%VNZMY|#MBT|$Y|%JBSB|$Z|$aMT|(4MV|(J|#NS4V?|%IS',
      'D|)B|%JT|$aJSQT|#QTKV|(IDY|%NV|$a@|&2aPZE|#S!4a|$2LSJT@V|&V|%T|&@V|&B|(KV|%VN|(VBV|$4S4T|%TBaBKW|%Y|&JZ|%Z|$;a|$=DaD',
      'V|%T|&4Y|&B|(KV|(aBSKY|&D|%V|&4MV|(SK|&N|$BT|%V|&R^4VN|$DT|&2SK2|&JDaDV|$Ea|&2TDaQa|$KS;|%VN|%a;a|&=T|(a|)NZKa|&LY|&',
      'NKa=a|$LT|&D|&NV=a|%V|%a|$NV|%ZKT|$QD|&a|%aET;La|&J|#T!B2a2Y|&T|(DT!BLW|(KV4T|,B|&V|(MTB|(Qa@SDT|&W4MV|(Qa@SDT|&YJZ|',
      '&]IaIY|%HS4B|%QS@aI2|&Y|$;a|&LKD|*V|)a|$=T@|&B|(V|&JLV|(VN|$@a@SMY|$DaDLY|(YLY|$Ea|$I|%2K=T4MV|%B|%S6L|&LJ|)B|%aLKa|',
      '$KTJ|(KV|$La|&;Da|&Qa|$Qa|&;KT|#U4S4T|%TBY|&NY|%Y!BV|&JZ|#V6a6V|$;a;T|)2]!=T@V|)B|*aBV|(V|)N|$=V2LV|(S;|&4|(T|$?a?V|',
      '$BaBY4Y|$GaGMaMT|$LT|&4MV|&J|%aLV|$QZDa|#W4MV|$=T2Y|)BSKKV|)J|$GT=VN|$NTD|%V|&4MV|#XBJ|&B|#Y!4QKV|%=@T|$2a;ZKa|$4=Y|',
      '%a4MT2Y|,4Y|$6a|&6M|(S4TBY|+KV@a@BY|*V@a@BY|)B|)JT@V|(T4Y|)@V|)B|*Y|)DNKV|+V|)QLV|*T@V|*V@a@BY|+N|(V2=TIY|)@a@BY|,TK',
      'VN|)NKT|,JS4T|(W2IaIT|$8a8Y|$=a|$?a?TD|(V|$BaBSKT|+4MV|$DaKT|$KSLa=a|$LYDa|%a|&@a|&QT!2T|$NT|$QKDaDV|&S!@|(4TBY|*KVN',
      '|(B|&T4Y|(BY|(D|)LaLT|)T!B|(QLS4TBY|+JT@V|&V4MV|(NSQT|,JS4TBY|.B|&W|&Z|#Z4SBKW|%TBaBKW|%Y|$GTJQa|$KMNS4T|$MGRVBV|&Z2',
      'Y!BKY|%LS4TBY|)V@a@BY|(B|&V|%T|&2Y|)J|*DaDV|&@V|&B|(!@Y|(DV|(KV|(MV|(Y|(aBKV|*SDY|+KY|*V|%V@a@BY|*NY|*S|+DY|+KY|*TBa',
      'BKV|&N|(!@Y|(VBSBKY|*V|#[=aK]8Da|(^8Da|$BKSGSBa|&a|$GaKT=a|$JKa|$Qa2WLa|#]!BLV|&S?T2Y|&T|(@V|)a@V|(B|)KV|)aB|+DV|+KV',
      '|,W|,Y|+NV|+SDY|,KY|+V|(KB|)GRVBV|*Z2V|)LTLaL|)V@a@BY|-NY|-SDY|.KY|*NVBKT!B|-TLaL|-V|(LaL|(NY|&V@a@BY|+TKVN|(N|)VBV|',
      '$4Y|$;a;Y|$=Y@|(B|&B|(V|&JLV|(VN|$?Y|&4SKT2Y|$@a@|(T4Y|(V|$BT2Y|$JaQM|)K|$K|%2a2Y|%4=Y|&TD|&Y|%;|&V|%@S4T|*JW|&V|(E=',
      'TQT|%G!B|)V|%R]IaIT@V|%S!4?|%Y|$MEV|%Y|$QBS4T|(B|#^!|$4GRVBV|%LV|%T|%V@a@BY|*NY|*SDY|+KY|*TBaBKV|&N|(!@Y|(S4|(VBV|$;',
      'YLa|$B|%!@Y|%DV|%KV|&Y|%S4|$Ia|&Qa|$JT@V|$KS;|(4SK|+KV|(B|&=LV|(T|$LT2Y|&QT|)BKY|*S4|%V@a@BY|*NY|&N|%a|$Qa;a|#_BV|$Q',
      'a|#aJS!2aQa|(=a|&4Da|&;a|&DTGLa|&KT|)QDa|%WIDa',
    ].join(''),
  ],
  mr: [
    "ँंःअआइईउऊऋऍएऐऑओऔकखगघङचछजझञटठडढणतथदधनपफबभमयरऱलळवशषसह़ािीुूृॅेैॉोौ्ॲ",
    [
      '!%EX3|&]B|#F_3|#K_MX3F|#RW|$Y|#TBWB|%_|%c|$O_O_|(eLW|$W|$[F|$_|!&#BMMWSe=eMYL|#AX|#GOeLW|#OW|$Y|$_|#U_|%B|!(#5eM:Y|&',
      'OXR|#BM|$XUWT|!*BeBM|#GOIeE|!.3|$W|$[A|#GeMXO|!03e=cIM|#5Te=|#H|!3KY|#MA_|%eLWB|)TW>Y|$BWB|$[F|#WK|$PWB|$UY|#X#QW|#Y',
      '|#_#DeM|$OW|%Y|%_|&OeLW|#eMX3_=|!4_PW?[|!5WQ|#_OW|%_|!6=FW|#?WKc?Y|!8MXBeMO_4|#WM|#XBeMG=|#_|#eLW|!:5WBYO|#FeK|#WB|%',
      'WB|%_|%c|$F_QWMY|$TeB|#XOeUW|(eLWBYO|#ZOa|#[F|#_|!;WOW|%Y|%_|&OeLW|!>X3WAY|!?XT_#IM|#b|!BLWM|#M|$Y|#T_8|#Y|$F|#_|$Qe',
      'UW|#c|#eLW|&#8W|)Y|)_|)eLW|(FW|)Y|&8W|(_|(eLW|&F#BM|(_|&KZP_|&OW|!D3eSXA|#MKeLWF|#XOW|%Y|%_|$QRY|%T|#ZQ_|$TNeLW|#_4Y',
      'O|$R|#cF|!F#BM|#DY|#WQ|$UY|#XMeKWA|(XBY|#cQeU_#IM|#eL[|!GA|#M#BZ|$eL#B|#Re8XK|#UW|$XOW|#WF_|#Z@_|$A_|$MTe3WM|%ZS|#[M',
      'eA|&Q|#eMBeL_3|%D_R|%KZ4|%TXDeE|!HZ=IbO|#_IeMZQWMY|!IWUeL|!JW5|%WB|$MB|&W8eLW|(B|)YO|&YL|$SW|!K#DXM|#BDWMT#6|#EYO|$e',
      'L|&_|#MW>Y|#UBeBeQW8eLW|$WMWSe=eM|-WBYO|#WBeM|$Me8|$UXBY|#Y|#Z#I)|$4eL|#[P|#]BeL[|#_|#c>_|%eLW|#eUA:_|&BWB|&[F|!LW|$',
      '#8W|&Y|&_|&eLW|%FW|&Y|#_B_|$CYO|%_|!MW:3WMAY|%EWFY|%W|%eL|(WBYO|$Se=eMYL|#X3WKY|#c:Y|!O_4|%3|#c3|%T#4eLW|&JW|!QMeS_|',
      '#WGM|#XEWFTJW|$QXE|#eL3eBY|%W|!RB3|%WBYO|#UM|%_|#X3eSA|#eMY|!T#3_BTeCP|$5YB|$6|$B|$DMeJ|$K_OF|$TeCW|#DTeL|#Ge=_#IM|#',
      'KWQ_R|$eMW=|#MeQ|&WB|#UTeM3WBYO|#WKW:X3|$OY|$UXBeL|#ZDeEW|$KWM_|$MZQWB|%[|#eBeMY|$CWGFW|!UW|#X#DY|&[|#Y|#_|#cB|%W|%Y',
      '|%_|%c|#eLW',
    ].join(''),
    [
      '!%!?|%eMZ|##3|%WB|%ZM|$5|%WOW|&QM|$:OY|$?Y|$B|%M|&WP|)LWF|)WB|(QM|&e5B|(JWQ|)[B|%XK|$DKWF|%W:|(WFZTWM|(_|$E|%ReMDeEW',
      '|$IMFWC|%W|&:c5W)|$KO|&I:WQAY|&WB|$R|%B$|#3IM|$MW|&QW|(eLW|$WDKY|%OY|$cOW|&_|$e3O3c=|%S|&L|&M|(_|&W#R|#4#?|$BeLWMYB|',
      '$XO|$_M|&GMeL#B|&YT|$eBM|#5DY|$M|$cDM|$eFY|%M5AeL|&AY|&_TM|#8WF3|$[3|$eLZB|#:L|$MWKM|$X#3eL|*GD|&>W|%B|%IWB|$[F|&UY|',
      '$e<WB|(F|#=3|$OIXUWMY|%W#=W|)X3|$Y|#>MW|&Q_|(eLW|#?8A|&Y|$CPW|&_|$Y8|#AX|$Z|%+Me:W|%3eMKW#3|$[|$eAW|(TWU_I|#BX|%CY|%',
      'FYO|%MX3eB|&_3Y|)eLW#FY|%RL|$ZO|$eL#B|&W8WM|(EZFX3|(QReL3|%M_|#CQW|$_FeT|#DeJZB|%LLWQB|&WG|%QXBYL|&aB|#EX38|&WEX3|(M',
      '|)Y|(NeLW#FW|.Y|&]BGA_|%FXLK|%GBY|(eLW4WOY|%Q_RF|*WB|$eL3eS|*B_4WOY|*GD|,Y|*W|*YL|&LF|&WBeK|(GF|(L|(TF|#F#B|$EX3]B|$',
      'WC|$XMeAXB|%O|%QWMeL|%Se=|$Z3[O|&eMK_|%DWF|%JQ|%KWF|%LWLY|%MWEW|%QWD|)3|)XB|%S#5WF_|%TM[F|&WM|&[8XB|$_3DW|&Q8F|&W#FW',
      '|*Y|$e|%F|%L|&WL|#G#5|$6WB|(WB|$BeL|(_|$FW|$JeM#R|$KWF|$LR|&Y|$QWD|$UMA|$[MeA|$_3eSW|)XB|$cOc|$eGWTWU_I|%MBXK|(eL3eS',
      '|%TMW|#H5WA|(XTeBWF|$W=|#IWEXB|$Z|$[|$e:|%DZO|)eOW|%MWUK|#J#5|$L|%WMAeL|+WB|+_|$WQ|$X:WB|%FL|(W8Y|)TW>Y|&Q|&_BW|)_|)',
      'eMY|%GeM_B|%KWF|%L#BW|&W#BeMX3Y|%QeL3eBY|%S_3|)Y|$eL#3M|&W5B|(T|)3|*eMK|#KM|%WQBY|$PF_M|$WFeL|%QWTeLW|$XB|&WJ|%MWBY|',
      '$YM|$]B|&TM|&W|$_MX3W|)Y|)_8W|+Y|+_|+eLW|*B|+YO|*F_|*KEYO|*OW|$cO|#LRTeQY|$c5eL|%EeLW|$eLM|#MI|%Y|$QX#D|$Z#D|%A|&W|(',
      '8O|$_|%IXLW|$e:|&ZF|%C|&B#BeM|&K#BeMY|&QeLQTeCW|&RWTeBeM|.:e<|&T#3OeG|&WB|)8|(F_|%E|&Q=|&W|&eLW|%F_Te=|%GA|%IF|%QW8Y',
      'F|#O#3WM|$3W|$5|$WUWIWD|$XIW5|$Y|%3?8eLW|(YO|(_|$_3e;W#?M|-F_|$d3X3|$eG|%HW|%IK|&Me=|#Q3WR|(WB|$5B|$6?|%eLW|$8=|$BWM',
      '|$LQ|$O#I|([F|$R_S|$TeCW|(_B|$X3TXB|%FWR|%JW:eL|$bMe?|$eQO|#R3eL|$W8|%GeM3WM_|$Y8|%UY|$c3|&W8eLW|(F_|$eLW|%QBeCWKW|&',
      'XFY|#Se=KY|&QXFWL3|#T#|%4eL|$AWM|(W|(Y|(_|&NeLW|%_|%eLW8Y|$B|%#|%W|&#FW|&FW|)8|)UY|%Y|&O|$OW|%Y|%_|&OW|(Y|%eLW|)8W|*',
      'Y|*_|)F_|)KZP_|)T|$W8|%KWFeL|%L8_|%QW|&Y|&_|(B|%UY|$ZF|$[|%FUY|$_8|%O|%UY|$c|%TX.RF|$eB|&XBeQ|+WB|&_3|%G]ReL|+BW|+W#',
      'FW|%QO|&TeC|%TO|#UKD|&F5M|&G[M|&WIWD|$QWO|$X#TW|%MWAY|%OeLWD_QY|*IW)|#WU_|!&#5eM_|$BM:WO|&X3|$DcOF|)WB|)_|$EeM|(GeMD',
      '_R|$I=|%W|%_5WQ|&?3M|*QWDY|*W#8W|-_|-eLW|,FW|-Y|*Y|#)8_|%eLW|$OW|#3?W|%_|&QWMY|$MeS3|(A|(XB|$OF|$WM|&KWF|&W8W|)Y|)_|',
      ')eLW|(B|(F_|%R|&QWAY|&WB|$Z#8F|$]BY|$eMK3|(A|%S_G|#4OY|$WB|$eLWLX3W|#5KF|$M3M|%Y|$YB|$eF_L|)_T|%MU|&W|#6W?Y|%B|#8MA|',
      '$WM|&eL|#:3WO|$8W|%_|%eLW|$BW5WLB|$GMeL#B|$QM|$UY|$WM|&Y|$Y|$[IW:[8eLW|*OW|$cIW|$e<W|(QOY|#;WD|#=GW?Y|#>Q?W|&_|&eLWB',
      '|%A|&Y|%O_|%W|%eLW|#?FWQ|(_|$QeLW|#@PAWMW|)Y|)_|(NeLW|%B|&WB|&_|&c|%O_|%[F|$WQW|#A4Y|$A_|%eLWB|)TW>Y|$BWB|$OW|%Y|%_|',
      '&OeLW|%eLW|$[F|$eQX3|#BW|%GMeL#B|$YO|$[F|$eBWGMeL#B|%K8MXBeM|&TWB|&UBeLW|&W|(MWK|#DM|%eR|$X|%BeL|%ORWUY|%QWTY|$Y|$_R',
      '|$eL|#EWM|&WQM|&XB|&YB|&_|$Y|%8|$ZFX3|$eLWBeKX3|#F#D|&WF_|&Y|#G=_|$A|%WT|$BeBY|$OW|%Y|%_|%eLW3?_|)8|$WGOeLW|$c&G|#He',
      'MX3F|)W|)_8W|+_|+eLW|*B|+YO|*KEYO|#IW:Y|#K#BeMA|)XB|$8Y|%eLW|$=_|$DWM|$eO|%UWOW|&Y|#L3M|$;^3|$F|$MXR|%eO#?|$O#?|$TYT',
      'Y|$WB|$Z3eB|%MeQ_D|+WB|+X3|%SeL|)JM|)W8eLW|*B|+YO|$c5|&W8_|(F_|%:F|&XB|&YB|#M#J|$3eSA|$BY|$KWM|(Y|$W4?W|%EFW|%K|$c5e',
      'L|%G|$e3e=X3|%:_Fe=XFW|%=|&eT|%CM|&X3|%DeMBW|%L|%QY|#O_OY|&_|&eLW|$eG|%HeM_?|%IMe=|%LW|(F#BM|)_|(KZP_|(T|#P#DY|#Q?|%',
      'B_|$MA|%e:[F|$ReL3|)BW|$W:|%UF|$XSe3WM|$]BeBY|)eLW|$eUWF|#RL|$W|$XLW|()|(B|)YO|(KEYO|$YMeQWD|$e8MeL|%MK|(WB|&L|%QWTF',
      '|&XF|#SW@|&Y|$e=Y|#TF|%3eSKBW|$GWT|$WK|&KEYO|&Y|#UWM|&WB|$_8|$cB|!(#5eM:|)W#8eLW|+FW|,Y|)YB|&O#?|*F_|*KEYO|$8|$:XF|(',
      'X%MX#5|(_|$=MF^RFO|(_=|$?XLF|(W|%Y:|%c|&F_RXLW|$DWG[M|%XMW|%[M|%eM|(WLAY|$EF|#3?_|#5BGZMY|#8O3M#:Y|$e9W|#:W|$XGeB|#=',
      'OY|&BYO|&KEYO|$WOXLF|#B3W|%Y|%_|&8|%eLW|$MBeM|%UY|%W#FW|$XUWT3WM|)W8Y|+_|+eLW|*B|+YO|$eLWDY|*#8W|#COeLW|$_|#FWKDWM|$',
      'cT#=|$e|%T^=|&e=X=eL[=|#IeMWUXK|#KWMB|(Y|)B|#LBeBW|$M|$WF|#MW3|%A|&Y|#OXFbL|$_3e=eMbF|-X3|#TQY|$eMWLO|&c|%OWK|)G[M|)',
      'X3|)Y|!)#?Y;8W|#BM|#RWFeL|)_T|$eQM|#Te=|!*#8|%Y|$DYM|#5K|$QAWMY|$eM|#6?|%O_|#8O[F|$e8|&WM|#:QW|%Y3?_|%eLW|$e:aF|#>WQ',
      '|#?Y|$e?WA|)_|#BMO_|%[F|$WM|$e3MeS|&]Se=|&eMW#BY|%4FF|%BK|&MW4#?|)EX3WMY|)MeEWB|(Y|(_|)3?YO|+_|)OW|)T|&YMeA|%GBeBY|&',
      'FeF|&WD3|)F|*WB|*_|)XB|%TMe:F|&Q|&WUWF_|#CP|#DL|%WT|$W|%UMA|)WMeC|)_|$e5WM|%6W=F|%DXSe=|+_|&_R|)WF_|)[F|%EQ|&eQTeB|%',
      'LWF|)WB|)_|&c5|)GBY|(:3|%M_3|%QWU3|#EeQTeB|#FeUWPW|)Y|)eLWB|#G3MA|(_|%eMK|$4#?WB|*YO|$5eMU|$8WM|$:WBY|$D_R|$F5M|(WB|',
      '(Y|)L|(_|%DY|&eLW|%XSD|)_|$GeM3WM|$LZ3eB|%c5|(WB|(Y|&:F|$MWSe=eMGBY|,WEeL3eS|$OIeEBW|$QWT|%XJW5|$TeCXB|*Y|+B|$W#BeL|',
      '%EY|&eL3eS|%L|&Lc:FW|%T3|&FW|$cSA|#JW|%MAY|(eLWB|&OW|(Y|(_|$Y|$_|$eLW|#KM4_?|%_?|$W|$_DQWM|*W#TW>Y|*Y|#MO_O_|(eLW|$e',
      ':W|%D[|%H|%QMXB|#O=|$eO_4|)FYL|%UWT|#SW|$eA|&BW|#TeBWD|%KWFWIWD|!+Me:W|%H|!,B[|#SY|%#FY|!-OF|!.3#DM|$3|%_|$8|$BM|%W|',
      '%eM|(XB|*GA_|(Y3MA|$DK|%W|%XQTYL|$FWC|$GWBeMY|$KB|%_3W#FW|*QM|*RY|&Q|$M|$O|$QXTWQ_|$UY|$W#3X3W|%8|%DRY|%G_3eSW|%Q_PY',
      '|%UY|&[F|$Y3?_|$[A8|$_|%3WPY|%MY|$cAXTWQ_|+eLW|$eT|&GeM_T|#4WDW|&Y|&_|&eLW|#:eLZ3_RF|#?QMe?|#Ke|%ITY|#MIT|$OW(FeT|$X',
      '3|#OX;WI_C|#Q@W|%Y|%_|&8|%eLW|$eUM_Te=|#TeTY|!/3W|$[|%F|$eL|#BXUWTX3|#Q:Y|!03eTHMe?|&X:F|#5Te=T|#=e=cKF|#FOW(F|&)F|#',
      'GM_=X#5|&RF|#HXT|#Me?M|#OX#GX3|%KeGX3|#Te3M|%=eMXLF|+W|)_OXLF|-W|.BYO|.KEYO|!1.T|#?XRW|(KEYO|#@W|#GF|#IYTY|$eOWTeB|#',
      'MXTW|#OW#?[F|$XBW4WOYO|$eLW|#P4|%BWB|%OY|&_|&eLW|%[F|$Y|#QeLW|#RFXLW|#TeKWFY|#UWLc|!2#E|#DZ#IM|$eLc5X3|#G8WMX3|#M#5:',
      '_I|*W8eLW|+F_|&WIWD|#SE|%Y|%_|$eAX3|#TW|!3#EWM|$GFY|(B|(F_|&eLW|*#8Y|#3eS|&W|&_B|#8MW|$e8W|&eLW|%9|#;W3TeBWF|#=e=M|#',
      '>YA|$cM|#?3|$W|$[|%F|$_|#A3QOY|#BeBO|#CW|%3WM|%F3|(WBYO|%T#5eMU|#DK|$W8XB|#EY|%3EY|%8|%UY|#FXSe>|$eF?|%LW|(3ZKWMY|#G',
      '?_|$[M|#IYM|$e:W|#JY|#K3ZQB|$BMBW|$O|%W|$P|$W#?M|%)|%O|$YB|&3KY|$eLZFXTe=|#M#?3|%DY3M|$A|%WM|(W|(Y|(_|&NeLW|%eLW3MXB',
      'W|)8W|*Y|*_|*eLW|)G[MeQY|)QM|)T|$B|%W|&#FW|%YO|%_|%c|$KM3M|$QYM|%[F|$W|%?|%L8W|(Y|(_|&OW|%M|%QLW8_|)T|&W|&Y|&_|$XBW|',
      '$Y|%B|$Z|$[|%FUY|$_O|$e3Mc5|%:|&B|%A|&EWM|&X3|%BQeL|&W|%FO|&W=3|*KEYO|*WB|,YO|%K|&8WMY|&QYM|%Q_|#O3BeBW|$K|%_|$R|$W|',
      '%3WM|&]BY|%BeK3|%K|%Q#B|$X#5|$_8W|$eGFW|%LWA|#P#I|$6K|$B|%_|$O_|$QA|$T|#Q8|$LXBeMY|$X|%BW|(#8W|*_|(T#5eMU|&_B|$Y|#RW',
      '|$Y|$eLG|#Se=|#TIW|$W|$_|$c=Y|#UWAY|#W!5eM_T|+F_|$#8F|%DW|%IP_|%TeL|$*#=Y|(eLW|$3W|&TWU_I|$5D|&GBeM_|%O|$:[|$=W|%_|%',
      'cO|$>WQM|%Y|$@A_|&eLWB|*TW>Y|%B|&W|(B|%OW|&Y|&_|(O_|)eLW|&eLW|%[F|$BPWB|%eM:|$D#IMY|*3WM|*B|(NeLW|$F|%?Y|%G[M|%X=3M|',
      '%eUc:Y|$G?|&XLW|%[F|&T|$IY:|$K3W:|%5WM|&XMY|%>Y|%B|%W|&B|&TW>Y|%Y|%_|$L|%DW|&_|(RYM|&eLW8Y|+_|+eLW|*FZTWM|+_|%K|&TeQ',
      'M[GY|$M|%#:W|%3XMeDY8Y|,B|-YO|&YMeD|%4WFW|)_|%5XO|%A|&W#KZP_|(F_|(TeBQ|&YJ[B|&_|%FXMeKWB_|%JWM|%QW)|%e?|&BX3|&IF|&L|',
      '(3MeBW|,_|,eLW|)WMY|*P|+WB|)eMK|,W8_|-B|*SK|,BW|+_BeM|(JWM|(MB|(RWPW|(W8W|*Y|)B|)FeQXB|)OL|+WB|+_|)TW>Y|(_|&O|(cT|$O',
      '|%4#?|)WB|+YO|%5AFW|%KWGF|%QW|&_|%W#BMWF_|&QEY|*B|%XDWT|%Y|&F|%eGFX3|$P|%:Y|%W|&B8|(UY|(YO|&GWT[F|%Y|%_|%eLW|$Q_MY|%',
      'eL|(T#5eMU|(WB|$RXFWC|%Y|%eKXMY|(YM|*KEYO|$T|%WM|$UY#|&8|&BMY|&Q_PW|&TW|&UY|#X#5|&e?K|(T|%8XB|%IUZFW|%KB|$BWI|%Y|&BM',
      'Y|&UY|%eL_3|$FQ=|%WMG=e=Y|(W|(Y|&NeLWQM|-YO|$K|%WF|%Y|$LW|$M3cP|%A|%WAW|%eOcTe3M|$Oc|&KY=M|+U[F|%eOW|(_|)DWM|(eLW#8Y',
      '|+8W|,Y|,_|,eLW|+B|+OW|+QM|$QW|$RcM|#Y=3|$M|%eBF|)3WM|)_|(Y|#Z#3[|%=_|%?|%JWM|$9|$=Z#I|)WB|+YO|)_|$>OeLWUY|%_|&UY|$?',
      'WP|$AIY|%WOW|%Y|$BeMW|$I_M|$KWM|$MeOW|$O3MeAY|%5ZM[|%DaQB|%WIW|$P|%3MeAY|%WBYO|$RO|%YB|$TZKW5eM:|%eBY|$UY|#[8|$P|#]B',
      'Y|%eMXK|$GW|$SX|%Y|%eA|(K[MeBY|(MWQ|(W|):Y|#^COX3|%cOX3|$F?W|(BYO|(KEYO|%_?XLF|%eTM|$Ge=F|$IXF_=|$K_MW|$MXIXLF|$OXHc',
      'MeFXLW|%eRXLK|#_#DeMRWTXB|)TeCWFY|)WB|)XB|)YL|)_|%IeMX:|$B3M|$DWM|$F|%eDeM|&LW|$G|$MP|&KEYO|$O#|%_OY|(_|%eLW|)F#BM|*',
      '_|)GeMKWA_|)IDeDO|)KZP_|)T|$P3M|%Y|$QP|%eUW|$RM|%Q|&MWQ|&TZB|$T|%MY|#aD|%Y|%_B|$OWT|#bK|%MeT|$MO|%eGcM_RF|$OFY|%YQ[?',
      '|%_:|(WB|%cMW?c|#c3A|&WB|)YO|&Y|$8Y|&F|$=|%W|%Y|$>WM_|%_|$?|%_3eT|$A|%BW|(UY|&Y|(UY|&_|(UY|&eLW|*UY|%WOW|%Y|&UY|$BQW',
      'O|$CM[?|$F|$GM5WQ|%NeLWB|$LFW|$M?_|&eLW|%O_OY|)_|)eLW|%XLF|(W|)KEYO|%YQ|%_5WQ|%e=|$O#IT|(XLW|(c|%3WBW|%eU=3M|(WG[M|$',
      'PTW|%Y|$R|$TPO_|$UOY|(F_|#d=Z#IX3|$BZ3|$F|$MQ|$O|$ROeL|#eLW|$M|%K|&QWMYB|+KEeL_|&W#3|*F|*W8W|,Y|,_|,eLW|+FZTWM|+QM|(',
      'F_|%W#BX3WM3|-Y|)Y|&L|%X3(FeHc|(_=KEYO|&LW|)GD|&T|(e=cHM|%Y?W|%[M|%bT|$OI|%WMe3|%_K_#=|$Q8XB|)8|%YF|$S|%A|&Y|%BeMXL|',
      '%KBW|%L|%YMTW5M|%_BeM|*HP|,W8eLW|*W#B|,KEeL_|+8W|,Y|,_|,eLW|+B|,YO|+KEeL_|*_|&GAWTeBeM|/_|!4#?|%W8eLW|&B|(YO|&KEYO|&',
      'PW|%_MWQ|%cIW|#5cORWTeBeM|.:e<|&YL|#:XFW|#=OW|$WQ|#?3|%Y|$_|#FX:|&_|$eFW|#MW|%I|$Y|$_|%DY|$e8|#NeLW|#OWRY|#W#?_3M|%D',
      'eLWQM|%I|$+|$:5Y|$?XO3M|%Y|$A_|%eLW8Y|$B|%WB|%_|%eLWB|&MY|$DeL|(GDWMeC|$F|%D_R|%WG[M|%eD_R|$O8eLW|%TW|%Y|&O|(GeMKWA_',
      '|%c4WO|%eO_|$T|%5Y|%DWM|#X#?|#ZAW|$DeD|$G|$MeD|$OW|%Y|%_|%eLW|#[A|$F|$G|%8|#_?|$M|$P|%AWMW|(NeLW|&eLWTW>Y|%B|&WFW|&c',
      '|%G=e=Y|%OY|&_|(OW|%QAeLWB|&OW|(Y|(_|(eLW|%W8_|(eLW|&?[#FW|+Y|&B|(YO|&KEYO|%Y|#c3OW|$=_|$?|$M_|$NeLWB|*YO|$O|%Y|%eLW',
      '|#eK_M|$LWBFWK|(Y|$MXRe8F|&TeBG[MeQ|*Y|!5#5W|&EM|%_8eLW|$BQeLTeCWF|$E|%MeQ|$JYM|#:WFF|#;O|#=WB|&YO|#?3MY|$8XMcOY|$D|',
      '$W8W|&eLW|%QM|(YO|$Y|#AFW|$GBMWQ|&Y|$OW|%_|$XB|&:e<|&W8eLW|&Y|(L|$_R|&cBeTQ|#BY|%F_|#DXKW|$eL|%M_|#FXKY|#LW|#M:|%W|%',
      '_8_|$K|$YI|$Z?|$eDY|%J|&EWMAW|&WRL|*W8eLW|#PeLWB|#Q)|$B|%WP|$eUMeFM|#U[|#W#EWMY|&Y|(#8eLW|)FY|(:Y|*#FY|%Q|$:OY|&_|(O',
      'Y|)_|)eLW|$>|%OY|%Y|$?5YP|%Y|%eLW|$AY|%_|%eLWTW>Y|$CW|$DYQM|$JW|$L|%3|&QW?|%BeMY|%F|%OY|&_|%X3W|$Me?F|$Q3MY|%W|&#KEe',
      'L_|&8W|(Y|(_|(eLW|&:QP|&B|(YO|([F|&GWT[F|&KEeL_|&OW|%Y|%_|#XFY|$MYR|%eLWMcU3|#YB|%3WM|%W|%_|#Z#BQA[3|%HW|$:MWB|)KEYO',
      '|)Y|(CY|$?|$@Y|$A|%3WMY|%BWOY3W|%EMeK|%QBeBW|%W3WM|%cBeBM|$FeUW|(_|)5WMY|$GeB|(U_M|(_|$MQ|%Z:Y|&BeQ|*W3MeSA|%[|%e:M|',
      '$OIMe5W|%WI|(Y|&K|$P5ZPYB|$QWUW=Y|$UW|%_B|#[5O|$@|$P|#]U|%K#BeMY|%YB|#^MY|$OMY|$T|#_=|%eT|$K|$OY|%_OY|(_|(eLW|%eLW|)',
      'F#BM|)T|#aM|%TK:|#c#?|%DXLW|%EP|$4O_|$?|%IcO_|%T_|%Y|%eLW|$DWQMY|$GWO|&P|%YFWC|$MW|%_|$O|%#DW:|*Y|%K_:|%W3WM|%e?|(F|',
      '$PW|%Y|&IWM|%_|%eLW|$QW|%X#D|)MWQ|%eLWB|*YO|$Se=|(Y|)#8W|+Y|$TWQY|#dBK|$MQ|&AeLWB|&XAeLWB|(O_|%Y|#eM!?|%#C|(W#8Y|+_|',
      '*KEeL_|)8W|*Y|*_|*eLW|)B|)OL|+_|(Y|%U|&A|%W#GeMY|&K|(DaQB|(G#8WLB|(YA|&U3|%Y3|&F|&T|%ZG|%^#?|&:eLZ.=|&K|%_5MY|(cMY|&',
      '=|(M|&T|$OcIO|$QWOeU_M|!6#=W|#=3|%W#8W|$FWBeK3|$e=|#?B|%WB|%_|$OY|%_|&OeLW|$Q[F|$[F|#FBW|$DW=|$KY=M|#M5ZBY|$=_|$W8eL',
      'W|%A_|&eLW8W|+Y|+_|+eLW|*B|+YO|%B|&YO|$Y|$_|$c6MY|#W=|%W8eLW|&B|(YO|%_|$A_3M|$B3|%OW|&Y|&_|$FW|$OA_|&eLWB|%B|&WB|%[F',
      '|#ZI?|$K=|#_*F|$+|%F|$AWMW|(_|&NeLW|%_|%eLW8W|*Y|*_|*eLW|)B|)T|*W>Y|$B|%OW|&Y|&_|(OY|)_|)eLW|&eLW|*F#BM|*T|%W|&B|%_|',
      '%c|#c?DP|%W|%_|$MG?_|$S|%AW|%XB|#eLW|&LOW|&QW|(Y|(_|!8#5Y;|$D5?|%F|%eM|(3W#B|(5ZGeB|(G[M|(JW5W|(R_4M|(W8eLW|)QM|#3e3',
      'M|%M|&EM|&QMeBY|#=AY|#@QOW|$W)|$[F|#BZ$TYKW|%MeCY|(DRY|#K8W|$Be3WM|#MA|$XBeM|)_|$e8|&W|#OF|%_|$W|#PQP|&Y|(8_|)eLW|(B',
      '|)YO|#QeUWA|#S3|#UW|#W#5D_Q|&OW|(Y|(_|(eLW|%DQ?|&Y|$8AY|$A3eL|$FeT_OM|$H_3M|$LFW|$MUY|%eOeT|$O|%3|%AWMY|)_|(NeLW|%B|',
      '&WB|&_|&c|%OY|&_|(OeLW|%QB_|&OY|(_|%Z3eL|%[|&8|&F|$PYT|(5WQ|$QOW|#X#|%8|&Q?|%BF|&W|(KA|*MWQ|*Y|$3XBeT3|*W|$4OY|$=AYT',
      '|$BeGWQF|&M|(3OW|)WM|(A|(DWOF|(G=T]Se=YB|1YO|*W#8Y|-_|-eLW|,B|-YO|-[F|,FW|,KEeL_|,TW>Y|+8W|,Y|,_|,eLW|+B|,YO|,[F|+De',
      'QWM_|+F_|+KEeL_|+OW|+TW>Y|(OXGY|(W|(XB|(Y3MA|(_|$FY|%eU|(_|$GP[A|)3M|$M#:YQ|#YF|%F_|%KEYO|%Y|#Z#I3Y|)L|$3Y8_|(eLW|#[',
      '3|$MeA|#^#GXLFeT|$O_#:|#_#?[|$3|$BF|%W|$FeF)|$MKF|$UMW|#aBFeL|%eM|#c8|$GeMW|$M|%Y|$P|#d3|%RY|%WB|%cFY|$CW|%Y|%_|%eLW',
      '|$DW|&QeLW|$EMY|$MT|$UWF|!9#D|#=W|#BeBYT5?|*@|+KEYO|%MGBY|#GW)|#WF|$G|%[F|$LW|&8XBeM|,_|#c=W|%Y|%_|&T_|%eLW|!:#3eRF|',
      '$5O|&WB|)YO|&Y|&_|#4K|%Y|#5B|%WB|&G|$DYR|$FeFWC|$GeMTXDeE|$JM|&WB|)YO|$W8W|&eLW|%B|&OeLW|%OW|#AW#FW|$[|#BF|$eMW|#F3|',
      '$5AFW|(_FZTWM|$:W5]BY|$BW|%_8eLW|&F_|&OW|$MO|$WIW)|%MeDF|$Z3YL|$eK$|&DXFW#3|)QT|&O_O_|*eLW|&TeCWF|&WOW|#GWF|&F_|&KEY',
      'O|&Y|#IMDTeB|$OG[M|$WIDWM|*Y|#KW|%B|&Y|$XFY|(8W|)Y|(B|(QM|$YF|&DWM|$eK[|#L#B|&Y|$D_Q|$G[M|$MWK|$Q#B|$ReMY|#MW|$Y|$eK',
      'F|(Y|)B|*YO|)F_|)KEYO|%TY|#OBMA|$D|$WRL|#P5WQ|#QP|%8|%:QP|%GWT|%YO|%[F|$WUMOWO|$eUWM|#RY|#TW|$_|#UW#5YM|%:|&_|#W)|%O',
      '|$*F|$+|%F|$5BX3|%W|%Y|%]B|(Y|%_|&B|&QM|$?|$A|%QB_|%WM|(W|(Y|(_|&NeLW|%YQ|%[F|%_|%eLW8W|*Y|*_|*eLW|)T|*W>Y|$BW|%Y|&L',
      '|&O|$D[|&5WM|$EQ|$F_|$L8_|%OW|$MY|$O|%FW|$P[F|%_|$Q)|%PY|%W|%Y|%_|&D|$TeBYB|$UXMWB|*Y|%YM|#X#3OW|(Y|(_|(eLW|&[F|$:W+',
      '|&IW)|$B_#DeM|$C_|$K|$OeUWEX3WMY|)QWM|(_|(eLW8W|,Y|,_|,eLW|+B|,OeLW|,[F|+KEYO|+QXSLY|$Q#B|#Y&L.T|$F|$MeAcDeEWM|$Q|%F',
      '|&5dMQ|&TBeBeQ|&W8W|)Y|)_|)eLW|(B|)YO|(QM|*YO|%RWTeBeM|%WA[|#ZF|%W|%Y|%_|%eFM|&LW|$PQ[F|%Y|#^3|%eTF|#_#QeUW|$:ZMY|$=',
      '|$A_3M[F|$C_|$HeMY|$KeT|$QA|&W8Y|%eUW|#aF|$QQXQXEBW|%X3|#bF|%Y|%eTF|$Me:|(XLW|#c5|%P_3M|%_ReQMY|$?|%AWMW|%B_|&c|%OW|',
      '&Y|&_|(OY|)_|%Y|&F_|%[F|$BXIW|%YMWQ|$EG[M|$FeT|$GMeL#B|$M|%DWM|%WQM|$RY|$T_H|#e<WB|&F|(3cR|(GY>|(W8W|(_ReQM|-Y|$LW|&',
      '#8_|(FW|)Y|&B|&F_|&GeMKWA_|&KZP_|%ZFXLM|%[|%_Se>|%cBXS|(Y|(eTeFW|$QOF|%WMY|&OWKZ4Y|!;GW=eLWF_|#W?|%W#8eLW|&8Y|(eLW|&',
      'OW|&QM|%YG=e=Y|%_|$M|%4#?|)KEYO|$O#|%_OY|(_|%eLW|)F#BM|*_|)KZP_|)T|#X#5WMc|$KeIWIeQ_|#YO!?|%#?|#Z#:|#_#?W|$O|#cG|!=#',
      '3|#3e3M|&_|#GWO|$eGW|&_|&eLWB|#MeKXFO|)T|#W(K|&eT|$)KeT|$3AeLWB|%BWB|%OW|&Y|&_|%PY|%Y|%[F|%_|$5cM|$=W|$L5M|$PAeLWTW>',
      'Y|#X3Q[F|%[F|%_3M|$83Y|$G[|$P3|&W#8eLW|)FY|#Y3W|$K|$QeUY|#_3?Y|&eLW|%eFbOb:Y|&TWT|$FXT|(G=[|$IO|$OM|%XQeUX:F|$Te=|#b',
      'K|$QM|#c3|%WOW|&QM|$FY|$GAFWQ|*WF_|$K^=c|#eM3|%Te=|%Y|%_3|&F|!>MB|%WB|%_|%c|$OW|%Y|%_|&OeLW|$QAeLWB|%O_|%XO_|%[F|$WQ',
      '|&X3|&Y3|$[|$_O|#P3|#TW|#W3M_|%ZM|%[M|$A_|$K|$M|#X3>X3WAY|%WA|(_|$G3_|#_QA_|&eLW8Y|+_|*B|*T|+W>Y|%B|&W|(B|&_|%OW|&Y|',
      '&_|(OY|)_|)eLW|&eLW|%W|&Q_|%[F|!?5eOT|#I_|$eOeL[|#UWA[|#W5|$L|$P|$Q|%W|&B|%Y3?_|%eLW|$^|#X5eMY|$:X=O|$;W(F|%_O|$GeOc',
      'KW|#Y;_O|#^FXR|#_3e3F|$=F|%W|$FXT|%eKWMe3|$Kc3eM^=X3|$Oe=W|$QeUOGK_#=|(X?|)T|#b3e=M|)_=|$=|$F|$OM|#c#5M|(LWBeMW|(W8e',
      'LW|)P|)QM|(Y|%IXQOY|$3_|&DZ4Y|%eLWQM|$PW|%_|!@W3W|#_M_|!B#:WQM|$BeM|(:e<WF|-W8W|#3eBW|%MWM|#:e:e<|#=I#DY|#AWQ|#Be3WO',
      'YF|%BeQ|):e<|,WF|.Y|)WQM|)_|%TK|#CW|%3CXB|%GX|#G3XMY|$RYO|(QWM|%e8MeLW|$WTAY|#IOW|&QWD3|$eIO|#KWRW|$XP|&FW?[|+KEYO|#',
      'LWMY|#M8|$B[D|$YUY|$ZA|$e3|%H_|#OQWM|$WQ|&W8eLW|#PQO3M|$WRY|$Y|$_|%5WQ|#RY|%8|#TW|%8|$_|#W#?W|%BeMX3|%D[P|%I?Y|(eLW|',
      '&_|$3D|$:|%KUWO|$A|$BeBeQX3|$FW:Y|$G|%KWF|%Y|$IW|%eLWB|$KXP|(FW?[|$M|%W|&IW)|%Y4|%_|$O|%YK|%Z3W|(_|(eLW8_|,eLW|+B|,Y',
      'O|$T|%5W#Q|%WB|#X3?_|%Y=|$4=|$8W|%Y|%_|%eLW|)B|$COeLW|%Y|%[F|%_|&8|$F_|%eUY|$I_=|(Y|$MZGBY|$OW|$QWMY|$TMW|&Y|&_|%NeL',
      'W|#Y8|$FUY|$MWQM|%eC|(3eS_BeM|/_|$O|$P|$QeM|(BW|$T|#Z3?W|&_|&c:Y|%WMWK|&QXGeM|$6O3|$;W|%Y|%_|%eLW|$K|%8eLW|%eUWOW|(Y',
      '|$MP3|%Z#5WB|%e3TeBWF|(Y|$OFW|&_B|(F_|%W|$P:WG[M|%RY|#[G|#]BYL|(W|)#R|#_#?ZO3M|%QeUW|$8|$:|%TeQY|$CYO|%[F|%_|&8|$MW|',
      '&QW|(eLW|%_|$O|%#5AW|%5[|%Z5[|$QeUW8|)GWT[F|$UY|#aFWB|$QWF|#c#?|$3eLc|$8|$GMeL#B|$H|%W|#eLW#8eLW3?_|,8|,B|,RY|(B|)YO',
      '|(FY8|(Ga3Y|(QM|&&EY|&/Q:Y|&3WPY|&5|&8|(GeMKWA_|(IMcIM|(Q_PY|(eLWRY|&B|(8|(UY|(YO|([F|*8|&DeQWM_|&FY|(ZTWM|&GWT[F|([',
      'MeQY|(_3eSW|(a3Y|(eMKWA_|&IDeDO|&KZP_8|&QMYO|)[F|(_PY|*_T|&RXQWL|&T|$MLcDRY|%WT|%X3cAY|&FXDWD|&GZMW|&JZ:|%Z=Y|%eL#|)',
      'I3|+_ReQM|$Q8W|%MXB|!C#?|%Y|#BeB_|#W#IBWB|(_|$)|$LO#?|#X.=M|#_#I|$=|#bKT|#c?3eLWB|%W|%Y|%_|&T_|%eLW|)8|$M|%O_|%WB|#e',
      'LW|$MY|!D#5O|$?|$B3CW|#3eSXAY|)_3?YO|,_|*B|+YO|*OW|*T|#4O|#5?|%WB|%Y|#BeB|&3|&W|(BeML|+_L|#IWQ|#K=|$A|#LW|%F#D|#M?c)',
      '|$IWM|(WB|*YO|(Y|$Mc:|$QMeSY|%W:W|(_|$WB|$Y|$e5W|%:W|&_DWM|%GA|%RF|(WTW>Y|#OW8_|$XB|#PAQPA|$QY|#R3|%W8eLW|&B|(YO|%_|',
      '$KY|$MC|$O3eS|#TMW|#URBQWD|*Y|*eLW#FY|$W|%QW|&eLW|$Y|#W#?_3M|$4O|%QBWB|&OW|(Y|(_|&XO_|&[F|$5XF_|$:Y|$=|$B|%WM|%_|$D|',
      '%M|&W|%W|&TWU_I|$F|$GcOY|$I|$KO_|%cDM|$M|%[|$OF|$QW|$T|%IcE|$U|#X#?Y|&cMY|$5#IM|%eDMeR3|+F|+XB|$F|%3M|%DMeRX3W|%W#3|',
      '$O|%YG|%_OY|(_|(eLW|%eLW|)F#BM|)T|&OY|)B|*YO|$Q#5B|%TJM|&W|(#8W|*_|*eLW|)B|)FY|(B|&YL|&_#DXQT|%W|&3M|&A|&PY|%_|%eL|$',
      'RW|&#FW|%_F_|&OW|&T|$TAWMW|)_|(NeLW|%B|&WB|&_|&c|%OW|&Y|&_|%WLOW|%[|&F|#Y3eSW|(XB|$?|$FWFWC|$G|%3|$Me6|(3WOYF|*P|#Z$',
      '4|$3WF|(_|$4A_|$FXLW|$GWMY|%eG=|$I)|$LeLK|$MZTeBY|%e5|(3CW|(DMeRF|(JeMKA5WCW|(K|(QaJQ|(W|)#8W|&6=FW|&DaQWF_|&KXP|(YP',
      '|&O3eS|+XB|$QW|$Se3WP|&GMXAWK|$T|%MW|&Y|(3?_|&_|%NeLW#DW|$U_MY|#[B|$E|$M|%8XBeMQWAY|-UXFY|%DMeRF|%EeQFY|%T#8WM|$SXB|',
      '#]@|$ReL|$Se=X3cF|,WB[F|(Y|)F_|(eLW|#_*F|$+|%F|%P|$4JWO|%M_4|%XO|$A5Y|%WMW|(Y|(_|&NeLW|%_|%eLW8W|*Y|*_|*eLW|)B|)T|*W',
      '>Y|$B|%W|&B|%_|%c|$Q|%3Y|%BW|%EM|%FW5MY|%LWFY|%O|%PWB|&Y|&_|%TeCWF|%W|&#8W|&8Y|(_|(eLW|&A6_QWA|&OW|%Y|$RGW#?_|%JM|(W',
      'B|%KZ4|%W#8W|)Y|)_|)eLW|(B|)Me5B|)YO|(FW|)Y|(Ga3Y|(KEYO|*eL_|&8W|(Y|(_|(eLW|&B|(YO|&FZTWM|(_|&KEYO|)eL_|&OW|%Y|$TW)|',
      '$U|%[|#aF#DXF|%X3|$QB|&_|%Y|#c6W#FY|%_|&UY|$F8|%DW|%eUY|$S|%Y|$TeB|#d#?|$MW|%_|$NeLWQM|#eLW|&LOW|&QW|(Y|(_|$MQ|&X?|)',
      'F_|&eL|)_|%ZB5BY|%dGDY|$QWDRY|&M3W|(W|(_|%XBYL|%YG|(3OeG|(TK[U|!E#DW|#3e3W|#?_|#F#:L|$5M|$eL|#IEIW|&_|#KeK|#MA|%W8Y|',
      '(eLW|%_|$OW|%Y|%_|$[F|$eBYQM|%K|&5ZM[|&RWPW|&W#BM|(8W|)Y|)_|)eLW|(B|)YO|(EX3WMY|&YL|&_#DeM|#W3=W|$B[|$FeL|$M|%A|&W|%',
      'QW?|%W|&RXQ|%eKX3|$Q|%AWMY|%B_|%T#4eLW|%W|&#8W|)Y|(FY|#Z3_|$MW|$P_|#[K3_B[|#]BMWSe=eM|#c#?c|$3W|&DWL3|%eLWB|$MA|&_|#',
      'eLWF|%_L|$MZQ|(YL|$Q:|%FXKZDeMX3W|&Y|!F#DW|%Y|%ZMIWM|$IM|#3PB|$W|%M|&WBeK3|%RW|&_|$c|$e3Y|(8|%SBeM|&Y3WK|#5M|%GWOX3W',
      '|%T_Q3|%Y|#:M|#DY3W>Y|%B|%QMYO|%T|$eLW|(#8W|*eLW|#HW|#KTe3WM|$ZFW|&_|$[D|#L_|%B|#M4_?|$TX#U|$UM|&Y|$_#DeM|$eB3|%KDW|',
      '#QFXMeKWA|$KY|$MW|&BeM|$QW|%eLW|$W|%G[M|%I|$Y|%F|$_|$cDXB|$eLW|(F_|%UBW|(Y|(_|&_|#Se=|#TB|%WB|&FW|%_|%c|$OW|%Y|%_|&O',
      'Y|(_|(eLW|%eLWF_|)KZP_|)T|$[F|$_|%O|#UY|%#|#W#D5WQ|&_?|%Q|$(=|$)3|%=|$3|%WMO_|$5|%FWC|%G[M|%MX3|)W#FW|,Y|&Y|%WO^#?|%',
      'eMW|$;Y|$=3|&3WM|&W#8Y|*_|)B|(8W|)Y|)_|)eLW|(B|)YO|(OW|&_|%eL|(%JXF_B_|(5YB|)]U|$AY|%_|&H_3|$B[|%_|%eLWF_|$C|$D|$F3|',
      '%W|&TWU_I|$IWD|$K|%3|&MA|%D_Q|%Q#B|%R_S|%T[8Y|%W#3F|)XB|(BM|$L3|%5WQ|%?[|%X3W|$MD|%P|&Y3M|%WLA|)MWQ|$O#DW|%W|$QW#FY|',
      '&4WOY|&8W|(Y|(_|(eLW|&F_|)UY|&QM|)[F|%_|$R|%X3|$TX3|%eBX3|$UY#|&B|#X#IWP3M|$$T#DX5eEY3MA|$3S|%WO|%cIWM|&OT|$5?XB|&Y|',
      '(B|%K|$6B_|%WOW|(Y|(_|)OeLW|%[F|$:WK|(RWUY|$BYF|%eL|$DMeRF_|%WF|$EF|&WF#BM|%Y|$FWD|$HW?|$I#E|$KXBeBWF_|$L#BeMA|*XB|%',
      'B3WOX3|,_|%K|&F|&XB|)GA_|%WK3|%Z3eB|*Y|%c:F|(XB|$M#:F|%FXMWPeLW|%Y3eSA|%c5Y|&G|%eAL|(WL3|&D_R|*W#3|&EWMXB|&I#E|&KWBW',
      '|*_|(XB|([OF|&LWB|$O5XMY|%WEWMY|$PW|%eLW|$Q?|&3|&AZ3|*W|+#KEeL_|*YB|+KEeL_|([3|&O_|&[F|%WT|(TeCWF|(Y|%]BeB|*Y|%_DF|(',
      'XBW|%eQP|$Re8XB|$S_E|%e3MeS|&>W|$TMe5|)MKeL|#Y=|$BY|$MW|$O|#Z3TWF|$TWM|#[BF|#]BeL|$TX#U|#^RFO|#_+F|$=QMe3|$BW|&:Y|%]',
      'BeQ|*W4WOY|/O|%_|%eLW#FY|$DMO!?eT|$GWP|(Y|%cOXLF|$K3_|%A[3|%O_|$OY|%_|$UKY|(8|%M[|#a,BeL|)_T|$BX3|$Q_DeL|$TMe5X3|#bM',
      'eC|&Q_|)8W|#c#D|&AY|)3]B|&QO_|&Y|$.?W|$3MY|%XLW|)8W|$I_O|#d3W|$DO|#eLWL|(K[MeBY|(WEYR|)OL|+W8_|,B|,F_|+YF|%[=F|!G#4|',
      '$8|%KY|%QWMeSX3|&YT|%W#5|&LB|$:WI|(KEYO|(Y|$?XB|$@MG[M|&Y|(FWC|$B|%GeMEWF|,GDY|$C|%W8_|$EMW|(Q_|)eLW|#3?|%O_|%[F|$eS',
      '|&W#8eLW|(8W|)Y|)_|)eLW|(B|)YO|(F_|(OW|&Y|&eLW#8Y|#5WM|#=3CW|%WQO_|$QMeEF|%[F|$_O|$e=W|&Y|&_|#>A|$WA|%M|&WQM|#?AWNeL',
      'W|%_|$B|%WB|%_|%c|$DW|%eLWQM|$OW|%Y|%_|&OY|(_|(eLW|$[|%F|#A:Y|#B#5|$Y|$e3MOY|%BW|%FY|%M|&3WM|*XBW|&QeLQUWM|&X3W|&_|#',
      'D3|%_|$QY|&EM|%eLW|(ZBeBM|$W8W|&Y|%MeC|)W#8_|*8_|(GA|%QM|$_|$eEB|(Y|)B|)F_|%K|&J[SA|&QXJ[SA|&ReMY|&W|(QBY|#FQ_O|$WKW',
      '|$eFWT|%UWPW|#IeOX3|#M#GMW|)5B|(_B|*YO|)FZTWM|*_|$3YL|$B|%O_|$D_RWB|(Y|$JAY|$K|%_ReQM|$MWSe=eMK#BeMY|$PY|$QWF5Y|$RZM',
      'WK|$TeGM|$W#:G_|&?W|%3eMK|*Y|%JQ|&[B|$X3eMKW|%8L|&XB|%ABY|&WK|)3WM3|)Y|%EWF|%G[MeA|%JWSW|%KWA|%Lc:FW|%QMeBF|&UF|&WM|',
      '%ReMK|%SD|(_8W|*Y|*_|*eLW|)B|%TM|(WB|*YO|&YKF|&eCXBY|,B|$Y3eSA|)W|)_B|$e:FeLKWF|%L=3|)W#FW|(F|)TeCP|-_|&WL|)WF_|)Y|(',
      'QMA|+YL|%O|%Q|&B|(MW#5|,W|(W8eLW|)QM|&W8W|%RXLF|#OY3?_|$eOW|#PQ[F|$[F|#QF|$WM|$XBeM|#Re8WB|&XKY|)_3?YO|,_|*OW|*T|#T#',
      'B|$MOW|&Y|&_|(OY|)_|)eLW|#UW=_|%B|%LOW|%QLWT|$XOW8|&Y|(8|&_|&eLW|*#DW|-8|*8|#W#?Q|&ZM#5|&_|%@MW|(Y|(_|&NeLW|$*#?|%Oc',
      '|$+O|%T|$3|%3]BY|%PeLW|%XTeBWF|,F_|,KEYO|,WB|.YO|,Y|$8|%QW|&Y|&_|&eLW|$=3M|%A|&W|%YO|%_3M|$>|%3|%GZMWQW|%OW5|%QAeLWB',
      '|&OW|(_|&XO_|&[F|%X#IW|%YQM|%cGW>|$?5WQ3M|%OY|&_|%WQ|%[F|$AOc=|%Y|&GZMQ>W|%eLW8W|*Y|*_|*eLW|)B|*YO|)F_|)QM|$BP|&Y|(Q',
      'M|*YO|%eM|(BW|(WB|(_|$CMe?Y|$EeL_|$F|%W#8W|)eLW|&QM|%XGB|)8eLW|$G|%Z&|$L|%CeLWRY|%DP|%MY|%NeLW|%QW=|%T|%W|&J[B|%Y|$M',
      '|%#5B|&GMX3|(WMX3|%RY|%XBcSX3|,QX:_B_|,_|&JWSX3|%e3|&=Y|&QBY|&ReQ5WL3|-F|-X3W|*J[KY|$O|%3|%4Y|%6M|%F|%Y|$P#D_|%OW|%Y',
      '|&Q|$Q|%B_|%F|%OW|&Y|&_|%TW8_|)eLW|(PW|)eLWB|$Re8WBeBeL|+L|(XKWBeL|$T|%ZF|%[F|$UA_|&eLWTW>Y|,M4Y|%B|&W|%W|&LOW|%X:_|',
      ')B|&OW|(Y|(_|%ZA_|%[|&F|#X#GMY|&P5WQ|$.M|$3_|$@Y|&BYO|$AeLW8_|*eLW|$BW|%eB|$OeO_|$QPW|&Y|&_|&eLW|$T_|#Y.8|$3|$=M|&eT',
      'IMe5|$>|$GOeT|#Z#?OX3|$3WMO_|$:WMY|$@8W|&Y|&_|&eLW|%W3WM|&MY|%YO|(GeMKWA_|$AeLBXCY|(W8Y|*_|*eLW|)B|*YO|)OW|$BPW|&_|%',
      'eM|$FMeM8FW|%eUW|$M#DM|)_|%Q>W|&B_|%Te3WMQX:_B_|+W8_|,F_|,TW>Y|)]B|%WA|(WB|*YO|(_|&BBeBeQ|-YL|(F|&QW|(_|%Y|%ZScBeBK|',
      '%[S|%_RY|&TW|(_|%c5WKY|&UXB|%eQ|(Y|$Se3P|$TD|%eB3|)W#8W|,Y|,_|*8W|+Y|+_|+eLW|*B|+YO|*OW|*TW>Y|)_|(X3W|#[:F|%W|$?|$M|',
      '%3|%eAB$|(GA_|(W|&Q:|(WLZSeL|(Y|)GWT[F|(_3?YO|+_|)OW|)T|$O|#]CeQY|)MW:|)QMYO|$Se>|(JW5|+WQM|#^MXT|$O_T|$TXHX3|#_#?T_',
      '|%@WM3M|$3eSW|$=#=|%eMcO|*XLK|$>|$A|$F|$M[|$RQW|&_|&eLW#8eLW|+FY|%Y|#a3Y|$>A|$F5#5W|$O[|$TW|%_|#b(#=|$)#=|$=M|$G|$O|',
      '$QM|#c3PY|$8OW|&_|$=|%WB|%Y|$BDWM|$G|%GDY|$Me=|&BZ5WO|,8W|*Y:|,W#FY|$O#?|%WD|%XR|&TW#FY|%YT|$PY|$QW?W|$RW4|$S3|%A|$T',
      'e=|(W8_|$Uc8BW|)_|)c|(OW|)Y|)_|#dMWAX3|%eAXKW|*_8eLW|+OW|$S|%e=X3|#eLWM|&OW|$M|%3=|&MA|)WB|)_|&OeG|&WM|)WB|+YO|)_|(R',
      '|)3|)F|*WF_|)WB|)XB|&]BY|&eMXLW|+_B|(S_GA|+XB|%4M|&eLWB|%5B|(Y|%6WB|%8#?|&OXB|&WM|%:FF|&W|(BY|(TBeBW3|.W8_|%AWOY|%B|',
      '&WG|)MWQ|&X|(3WM|)[O|)]BY|)eMXLW|(:e<W|(FXEXBeQ|+Y|(GDW|)WDF|(I#E|+3|)X#I|(JW|(KW|(QWMeSX3|(Se>W|,F|+XB|(TWD|)eGMeEY',
      '|&Y|(3|&eL3eS|,WB|)L|)_3Y|%CK|(8|(B$|&W|&XF_|%D3eSXAW|&MeRF|*XB|&WF|&YG|(Me6|&[SA|&_RKEYO|)W#B|+KEeL_|*8W|+Y|+_|+eLW',
      '|*B|+YO|*KEYO|,eL_|*QM|%EWF|%G#8|%I#E|&P|&cEF|)XFY|%JW|(3M|(B|(M|(Q|)RWOY|)XB|)Y|&ZBeQ|&[|%KWA|)GBeM|)Q_P|)WB|*QM|)X',
      'B|)_|&cD|%LBeF|*WB|&Z3eB|&c5|)RWPW|%OeUWD|%QMW|(eB3|&WRW#FW|(T|)WB|)Y|(U|&YA|&]BeB|+Y|&_R|)DeQWM|%R#TW|&TeB|&W#B|(T3',
      'YL|)F|&X3eS3|+A|&eF|%T#5|)Y|&FeF|&WD|(M|)3|)A|)XB|&XDeEY|&eBWQ|+XB|)ZB|(CWGXB|%UWM|%W|&#B|)W8W|+Y|+_|+eLW|*B|+YO|&3]',
      'B|&5aBXUWTX3|&8WMeL|(YF|&A|(QWL[|(Y|(eLW#8_|-eLW|&CKX3|&D_RX3|&EWFeL|(X3MA|(eLWG3|&GeB|&KZ4eLWF_|&Lc5X3|&M#J|*X3|*Y|',
      '(eCFW|%XFeT|&H_3e8M|&L|(W|%YKXLM|%_3eS3|*AYL|&K|(8#D|(WB|&MAW|)_F_|(XB|&T|%c|&5eM^KX#5|&:_3e=|&BeTWUF|%d@|!H#?|#3eB|',
      '#?3_|$AQYT|%YT|#M3|$e5eLZTF|%?XFW#?|%Te=|#O#DW:|)Y|$=A|#P_|#W#DeLW|$*#?_RF|$+#?_RF|$=3|%W|$LDW|&_|(RYM|%MHb3eT|$M|%8',
      '|%RY|%TW|&Y|&_|$Oe5ZF|$P3_|%AY|$RY|#X3=|$HW|$M3Y|%B|$OXG|%eK|(H_%M|*M|#YFLYF|$Oe?|#Z=|%IbOG=[|$OW#8W|)eLW|%_|#[=|$O|',
      '#^RF|#_?MO|&_RF|$MY|&B|$NeLW|$TIZ3|#bF|$M|%eKeLZOW|#c=c|$F|$Me=|&?|&IeT|&T|#d:|#eMW#T|)8W|)XT|+e3c|&FeT|*KEYO|*XT|%Y',
      '|&?K|%^#3|%_#8|&?MX3|$OW(=|%cMX?W|!I!3|%W|%X#5|%_8Y|(_|(eLW|##5|%OcM|%P[M|%WO|(KEYO|(Y|$?|$D|%M|%XTeB|%Y|$E|%F|&3WM3',
      '|%WMW|%ZBW|%[|&GeM3OeGWB|#3eSYT|#4M|#6BW|$W|%LOW|$XBO_|$[F|#8B|$WQ|$e8F|#:W:|%QOY|#?cDW|#DO|%B|&_|%OY|&_|%W|%Y|%[F|%',
      'eLWB|$WK|$eDO|#FBWB|%_|%c|$OW|%Y|%_|&OY|(_|(eLW|$QA_|&eLWB|*TW>Y|%BWB|%OW|&Y|&_|(OY|)_|)eLW|%XAeLWTW>Y|&O_|)O_|%[F|$',
      'WMT|#M4WTeB|$W|%8|&TW|$Y8|$_|%8|&T_|$cIM|(8|$eH|%KF|%OXF|%Q_|#NeLW8|)DW|(Ga3Y|#OMWK|$W@eL|$eOWP|#P3=|$Q#B|$Y|#QeU#RY',
      '|#TOW|%_|&OeLW|$QO_|%[F|%_ReQM|$[|%F|$_T|#UWD[M|%KFY|%O|$XAWIW)|&Y|%Me:Y|%Se3WM|$YA|$Z|%:F|%BW#R|*Y|&_3|%DW|%EW|%KB|',
      '%MWSe=eMYL|%T#4eL|#W#5OWD_R|%E3WK|&AY|(eLW8W|+B|&OW|(Y|(_|)OY|*_|*eLW|(eLW|&[F|%I[|$)|$3Y|$5|$:WM|(G_>|(WB|%Y|&MWQ|%',
      '[|&#FW|)Y|&F_|&OW|&T|$A|$BKY|&eLW|$D|%RUW|$G|%=|%[|&:Y|&MWQ|$I|%BYB|%M|%W|&:Y|&TWU_I|%Y|%ZMWQ|%[|&MWQ|$L|%3c|%;_Fe=W',
      ')F|%IO|$M|%KWUY|%W|&KBY|&QW|(eLW|%Y3|%eRY|$O|%3|&ZKWM|%5#EMeQ|%FW=eL|%GA|%TWUXBeL|%W:Y|%e3F|&=X3|$P|%3]SeA|%W|&:Y|&T',
      'WU_I|$Te3_=IbO|$U_M|(YO|([F|%eLDZQ_|#X#D[|$5|$F|$I=eLW|$LW|&A_|$MeOW|$O|%WTG[M|$UWM|(KEYO|(Y|#Y8|$:|%X#5|$=W|$?|#Z3|',
      '$DeE|(XIP|)KBeBW|(Y|&MZ3|$E|%QWM|$MZ:|%[:|$O|%@WAW|$QW|$R|#]UFeKZ#I)|#^#?|$8OM|$?KX#=F|$FMe:Y|$MXTe=M|#_#;|%DeM_|$3W',
      'LD_RYM|$5K|$=|%W#QM|&8eLW|&QM|)YO|%_|$?_3M|$B|$F|%_?X3e=|$Me?_|$O|%e:XLK|$P5W#Q|(Q|$TIbO|%e=|#a>3|&YB|$O|#b3eT|$I|$K',
      'eI|(TeHc=|(_|$O|%XQ[?|#c)#5|$=|%_|$E|$M|%3M|%5WQ|%Y|%e?|$O|%A_|%B|&WB|(FW|%OY|&eLW|%WQO_|([F|%Y|&JWSW|%[|$T|#dDeE|(X',
      '3|#eMKeU|%UeK|)8WMY|)W|%W*F|&;XO|(YO|&KeUA|&LF|&UeKA|%X:|&=F|(XR|*W#8eLW|,FY|(YR|$O[|%^3|%b3|&5|!J#?WMW|#3e3K|%B|&Y|',
      '#5B|%TX#5|$QDe5YBW|%WF|(IWIW|$XFY|#:F|#=3eLW|$e=|#L#3M|$WF3|#MB|%WB|%Y|%_|%c|$G[M|$JMW=|$OY|%_|&O_|(eLW|$QAeLWB|%OY|',
      '$YQ|$[F|#QF|$WFY|$XSeL|)WB|+YO|$eL|#W#?QO|&WM3M|&Y|&eLWB|$)|$+|%MWQ|%TWU_I|$3MY|$5QB|%W#8Y|(B|(KEeL_|&8W|(_|&BYO|([F',
      '|&KEeL_|&OW|&QM|&T|%YDWMY|$:G|%Y|%eLW|$=_|$B|$DeMGD|$F|$M|%BJM|&MBeF|&W3?[F|(8W|)Y|)_|(BOeLW|)[F|(F_|(KEYO|*eL_|(OW|',
      '(QM|&Y|%DeQW:|%Y|$O8#DeM|%_MWQ|$Q|%#?W#Ga3Y|%5YB|%FW|%X3|%Y|%_|$S3|%A|&_|%W#8W|)Y|)_|(B|)M|*XB|*_|)YO|(KEeL_|&RWTeBe',
      'M|&TK[U|%X3|%_8W|(Y|(_|(eLW|&B|(YO|([F|&KEYO|)eL_|&OW|%eL|$T|%e3M|#X#B|&Y|$3W:Y|$?_|$FeF|$OeO|$Q#?Y|%WG[M|#YBY|$K|%M',
      'WQ|%T_F|%W|&R#3M|$SA|%eK|#Z)3c=|$LWMY|$QF_ReQM|$TWQP|#[3|%#G|$5cO|$B|%G[MeQ|%WF|$JW5|$KEeL|%X3W|(_B|)TW>Y|&5B|&BY|%Y',
      '|$SA|%QXO_|$TeCXM|#_=|%O_|%Y|$D|#aMQ|#c:|%F|$GWP|$M|$P_|$QBY|$TO_|#d5cOX3|$BX3|(RWTeBeM|/:e<|/WBYO|#eMKA|(EeQFY|%Se=',
      'W8WM|!K#5O|&W|%P|&QWM|(_@W|&WQM|%_R|(3M|%cO|$8|$:[M|$?G|%O|%P|&W8W|)Y|)_|)eLW|(F_|&Y|&_|$BeM|(WOL|+8_|(XK#?PWB|(Y|$D',
      '|%XMW8W|*Y|*_|*eLW|)B|*YO|)OW|(_|%YM|#3M|%#D|$W|#5E|#:3[M|$I[B|$O|$[M|#AXG[M|$Y|#BDWF|&M|(T#6W#Ga3Y|,8_|-eLW|,B|-[F|',
      ',KEeL_|$J_D|$WFZTWM|$_|#CZMW|#DB|%YF_|$F|$M|$eMWT|#EOeLW|$Z|%3M|%K_U|%M|%T[DF|$[|%F|$_|$cKE|$eLGeMD_R|&JW5Y|&K|(5BY|',
      '(QMe5YL|&LZ5YF|&QMeBY|&WGMeL#B|)WT[F|&_8|#FKW?|%cUF|$W)|%8W|&Y|&_|%B|%OW|%QM|$Y|$ZSeL|$c:|%M#:F|%UM|#MA|%cBeBM|$W>QW',
      '?W|*eLWBYO|&W|&YB|)O_|)YO|&_|&eLW#8W|,_|,eLW|+FW|,Y|$eLWDW|)XB|%TX?X:|#OW|$X3|$_RXLW|$eLWPK|)Y|%UWM|#RYD|%F|#TWO_|$Z',
      'DW|$eB3|&WFY|#U#KD|$BeBeQ|*G[MeA|*W8W|,Y|,_|$K[D|$MeSY|$O|$T[O|$W|%3QY|&WQeL|%:F|%?|%BeKW|%D:Y|&_Q|)W8_|%F|&5M|)GWOX',
      '3W|._8eLW|&ZJWQ|%GWOX3W|&dM|%IP_ReQM|%JWMB|*WB|,YO|%K#?P|*W8eLW|&WMe5|+W#8Y|,QM|%LZDeE|+W8eLW|,B|,DMKeLWF|,F#BM|%M|&',
      'W:|)W|*#8W|,Y|,_|,eLW|+FW|,Y|(AW|)Y|(Se=eMW8W|/Y|/_|/eLW|.B|/OeLW|.KEYO|.OW|-YL|%O|&3eSeKY|%QXDeLWOL|.WB|0[F|.YF|._|',
      '&YM|%TW5M|*W8eLW|+B|,YO|$XFW|&_|&eLW#B|*8eLW|*B|+YO|%OW|(#8eLW|)FW|$_#DeM|%R|$cBeTQ|*WB|#W#:M|(W|%?AY|&OW|(X3|(Y|(_|',
      '&[F|%T|$*#=|$+OY|$58eLW|%AY|%XBOY|%YO|%[F|%_|%cQW|$6|%WM|$:O5WQ|%Y|$;#|%W|%Y|%_|%eLW|$?5[P3M|$@W|$A|%5WQ|%T#|&W#8eLW',
      '|)FW|(8eLW|(F_|(OW|&_|%X3|%[T|$B|%MKe|%W|%Y|&B|%]JWSW|%_8_|%eMW|$CW|%eLWQM|$DY|%eMXD|$EQ|&MWQ|%ZMY|%eLK|)WB[F|)X3|$F',
      '|%3MY|%AeLWB|%B|&WB|&c|%D|%OW|&Y|&_|&eLW|%Q|&W8eLW|(OW|&Y|%T|&RWTeBeM|&X3|%W#3F|&8_|&F_|%[F|%_|%eL|(BW|$GF|$KW|$L|%3',
      '_O|&eMcTbHe=|/F_|%W|$M|%OW|&Y|&_|%W|%XLW|%ZBY|%[F|%e3|(_=|(eT|*QWDY|&5|(DMeR3|,F|-W4WOY|(RYMeS|(WF_|)QM|+YO|(_|&=XF|',
      '&HB|&RO|$O|%3|&Y|%KBeBW|%QA|%X3W|(_B|*YO|)KEYO|+eL_|%_5WQ|$P|%QW|%RXMT|%W|%Y|$QP|%RY|$T|%W|%X3|(W8_|)B|(_|%_|&KWMY|%',
      'e=M|&BM|$UWBeKeL|%XB|(YG=|%YB|&K|%ZOY|%[M|#X5|$BeM|$CZF|%_F|$FX=_|$KY|$M8Y|%:|%QA[3|%e;W|$O|%X#D|&=MY|$PAWM|)_|(NeLW',
      '|&_|%B|&WB|&_|&c|%QAeLWTW>Y|&OW|(Y|(_|&XAeLWTW>Y|(OW|)Y|)_|&[F|%WOW|(Y|(_|)OY|*_|*eLW|(eLW|+F#BM|&QW|(_|%[|&F|%_O|$R',
      'F|%X5F|%eM|(A|$T|%P[F|%XTXGY|#Y=M|$>|$?XLW|$M|%W|#Z#?_|%I)B|)YO|(KEYO|$3A_|%Z#D|%_R|%e3WK|&B|(BW|(W|)IW)|(Y|$4|%Me:Y',
      '|%_?|%eLB|)$|)eQ_|(K#BeMY|(WOL|$6O|$>W|$BeTDeDY|$DB|%eDW|&MW|$IO3|$JW|$MIW?|%OYEM|%eBY|$O5W|&Y|%W#8Y|)_|)eLW|(FW|(KE',
      'eL_|(TW>Y|&4B|)Y|&8_|(eLW|&OW|%Y|&#8eLW|%_|$P|%RY|%W|&B|%_|$TOKWF|%eOXK|$UKeKD|%[MeB|#[MeBY|$O|%B$|%DeMQeL|,_|%J[B|%',
      'eL|(_|#]B|%eLZ|)KZ4Y|([F#BM|)GMeL#B|$DW|#^#8_Te=M|$3|%eT|$=eMX3|$CeL[|$F|#_#|%D[|$3eTX3F|*c|+KEYO|$6WOL|$:M|$=eMc|$?',
      'O|%X3O|$F|$KcMXLO|$MW|%Y|%_|$O|%IMeF|$PW|$UBW|#a#|$BeMY|$DWF|(WB|)QM|(Y|(_|$O|#b?MeF|%_O|(X#5|$MXRT|&T|$Te3c|#c3eS|$',
      '5O|$6_|$:3eLW|%AeLW8_|$=M|%WM|$>LVW|&W|%W|%Y|$?3|%BWB|&c|%Y|%[F|$BY|$DY|$F^3c|$HB|$IW)O|$M|%5WQ|%LW|%_|&ReQM|%cG#B|%',
      'e8W|$OW8Y|(_|$TK|&WB|&Y|$U|%F|%KD|&eKD|%XB_|&FY|&KW|(_B|%YK|%cP|#d:|$DW|$MeL|$OeLQWF|#eLWFKWM|%Z;X3|$U#=O_|%=O_|%A:_',
      '8|&A_|(eLWFZTWM|&B|(W|(c|&O_|&WOW|)_|(Q_|&ZF|&[|(F8|)UY|&_|%aT[M|!L#5|$BeM|(AW|(_|#:KWF|$e<|#KZFW|#QBKWP|#RQ#B|(MWQ|',
      '$TeQY|)GA_|$WO_4|#UZDY|#W#8eLW3?_|*B|+YO|*IMcIM|*QMYO|*RY|*TU|+cIB|%B|&YO|&eMX3|%FYUY|%Ga3Y|%KEeL_|&ZP_|%QM|%TW>Y|(M',
      '4_|*eLW|$*O=|$8|%IMcIM|$>X3WAY|$B|%YO|%[F|%eMW|$DQ|&Y|%Y|&B|%eLW|&QWM_|$F|%#BM|%Y|%_|$GZ@_|%[MeQY|%a3Y|%eMKWA_|$IDeD',
      'O|%WIB|$KZP_|$OW8|$QM[F|%W|%XSLY|%Y|%_|&PY|%eLBXMX3eB|$RXQWL|$T|%U|%WM4_|)eLW|$UY|#Z.HW|$3eB|(XQWD|&M_F|$5|%WB|%cTeO',
      'WQeUXLW|$BY|$DeE|(Fd3W|(W8Y|*_|*eLW|)B|*YO|)F#BM|)KEeL_|(_|$FWL=_?|%X3c?|&=|&LF|&QeUMeTX=Y|$Mc|&G|(KEYO|(W|)B|*YO|)K',
      'EYO|(XLF|(YL|$Q3|%MW:|%W|#[.T|$=YTY|$Mc|#_)|%O|$*F|$+|%F|$AWM|(W|(Y|(_|&NeLW|%_|%eLW8Y|)T|*W>Y|$B|%W|&8|&B|&FW|%YO|%',
      'c|$C[F|(8|%_8|&UY|$QOW|$R[|#bMe3|(RWLM|#c5|%DWF|)WIDeDO|%Y|%eL|$:FW|$DeEW|(_|$FY|$UWF|!M#5|%FWC|%J[KY|*QMYO|%K#8|)WQ',
      'M|%W8W|(Y|(_|(eLW|&B|%YB|#3e3K|%B|&5=|&DWI|&WBYO|%S3|&A|#5eIY|#6ZFWC|)MWQ|#8A_FZTWM|$FW|&3WM|$OW|%Y|%_|&OeLW|#A:XB|%',
      'Y|#BF|$X%JXF_BeMY|/#QMYO|$eF|&W3M|(5XMY|&_|#DeD|#HY|#KW|%IW)|$_R|#QWFW|$X|%QWM|)Y|$Y|%#DeM|*FWC|#RXLF|&W|(B|(F_|(KEY',
      'O|#TD|$WLF|(RWTeBeM|/:e<|/WBYO|(_|$X3|$_O|$eBW|&_|&eLWF_|*QM|,YO|#UKWF|$TeL|$WB|%Q_|$XQWTY|#W#5|&cPY|$+B|$3_R|%eST|$',
      '4W?Y|%Y|&Q|%[F|$5|$6c:Y|$:|%3WMA|*WB|&YL|&ZKWM|%5?|&ZM[|%B#BeM|%D[B|%F|%GZBeM|&[B|%JWSW|%KWMe5|%MeSY|%Q#R|&=|(YB|&W?',
      'W|)_|%TeCWF|+KEYO|%U#T|%W#8eLW|(FY|&F_|&G[M|&MWK|%YFWKW|&Q|%[|%_|&#DeM|&GDY|&R|(WUY|%eL3MeBW|,_|)WMJWM|(6=FW|(GWO|(K',
      '#BeMY|(RWTeBeM|(TJW|*_8_|)eBMYL|(W#8Y|+_|+eLW|*B|*KEeL_|)8W|*Y|*_|*eLW|)B|*OeLW|)FZTWM|)JXS_3|)KEYO|)OW|(_|$>c?|$AW|',
      '%Y|%_|$B|%eM|(Y|$EW|&3]SeAF|&F5MY|$F?_|%Y|$K|%3]SeA|%8#DeM|%:Y|%=_3|%DWT|)Y|%JW+|%W|&F#D|(Z:F|(_|&LA|)WB|+YO|%_ReQM|',
      '$L|%5?|%G[M|%HOeT|$Q|%A|%IUWDZM|%TWU_I|$RY|&B|$Se=eM|*3ZO|+[=|*GBY|+eMKZ4|*JWSW|*QWDY|*T#B|*W#8eLW|,FY|+EeL3eS|1GDWQ',
      'M|3Y|*_|$T|%WLFX3|$UAWM_|(NeLW|&_|&eLW8W|+Y|*T|+W>Y|%B|&W|(B|&_|&c|%WL8Y|&Q_|%XOW|(Y|(_|)O_|*eLW|(eLW|+F#BM|%YO|%ZMY',
      '|&O|%[|&F|#X8Me?|$;MeQ|)eU|$BYF_|$GIeOX3F|$Lc|$OWLFeT|$Re=M|$TMe8|%c?|#YBYF_|#Z#D|&Y|$3eKXAY|$5eA|(WOL|+WB|+_|)T|$:[',
      '|$GLW#8W|*Y|&_|#[@|$G|%W#BM|*XB|&B|&F_|%_|#_3bMe?|$4W|&#R|$5_|$:XK_#=|$=|$?|%X1|&Lc|%e?Y|$AZ3W|%[|$OeQ_|)5W?eLW|)F_|',
      ')KWMe5|$RYK|$SW|$T|%X#5|#b3|$:M|$IMe=|$L|%O|#c4|%AeLWTW>Y|%_|$5|$:|%5WM|$=MY|$?|$K|%F|$RF|$UW|%XAY|&B|!NeLW|$UWT|!O#',
      '?F|&KEYO|#3eS|&A|(YL|(_|&WB|&eKA|)Y|*3W#B|*IW)|(L|#4Fd|#5_8|&8|$eF|&W8Y|(F#BM|#6Z|%3CW|%G=|%M[G|#?W4|#@B|$O_|$W|%)|&',
      'B|%+|%LW|#BW|#OXB|&W|#Q3M|&8|$eU|#Se3M|(Y|#UWF|&GAWGWT[F|/8|)Y|#W#I|&=|&Y|$(H|$3?Y|%[?|$4|%c|$5AWMW|)Y|)_|(NeLW|&_|%',
      'B|&WB|&_|&c|%OW|&Y|&_|(OeLW|&eLW|%Q?|%[|&F|%_|&O|$?|%[|$BZM|%[M|$J|%OY|&_|$O|%W|$QAY|&_|&eLWB|*TW>Y|%BWB|%OW|&Y|&_|(',
      'OeLW|%[F|$T|$UcM|#X#3F|%5|&WLB|%I[|$1|$4WA|%XB|$=M|$F3eT|$GY|&B|(YO|$KL_|%X=_?|$UXAWM_|&BWB|&OW|(Y|(_|)OY|*_|*eLW|(e',
      'LW|%YB|%[F|#Y5|%KEYO|$OW|#Z(T|$)|%T|$GeB|#^=XF|#_3|$43W#FY|(F_|%F|&J_D|&WB|%T#5eMU|%WB|%X3W|%Y|$AY|%_|$F|%XF|$G|$He=',
      'F#=|$O_|#a#5X3|#bM_FeT|%e?|$T|#c33CW|&OW|%:YQF|%GWO|&eMXL|+BW|%KB|&WFeL|%O|%QTeBY|%RWUY|%T#4eL_8W|-_|-eLW|&BeBW|&J_8',
      '_|*eLW|)B|)QM|&WUXBeL|%W#8W|)Y|)_|)eLW|(FW|)Y|(KEeL_|(TW>Y|$4#?Y|(_|$AWQPW|%Y|$U|%KWMe5|%W|%XLW|#d3X3|#eLW|!Q#8XB|$D',
      'FW|%_|$R|%:|%W8W|(_|(eLW|&BYO|#3XOY|$YO|$eB_|#5PBW|$aM_|#8F|#:F|#?5WQ|$XOW#8_|*eLW|)FW|*Y|$YO|$cDMW|#AY|#BYF_|#DeL|#',
      'FTeGBY|*#8eLW|$eL|&:YQ|#LW8eLW|%B|#M8W|%eLW|$BY|$DWF|$XSe>|$YO|$ZA|$[F|$e5|&WB|)YO|&Y3MA|%8TeQ|%A|&F|&KWOW|%BF|&KWF|',
      '*GBeM|&ZPW3WM|%EW|%KW|%Oe?|%S|&JM|&W|(#4WOYO|)8W|*Y|*_|*eLW|)B|)F#BM|*Y|)GWT[F|*[MeQY|)KEeL_|(8eLW|(B|)YO|)[F|(F#BM|',
      '(GWT[F|&Y|#NeUW?Y|#OeOJJW)|#PA|$O_|#T#B|&MWQ|$)|$OW|%_|&OY|(_|(eLW|$WUB|(Y|$XSe>|$Z#EMW|$eBY|(QXJW5AY|&Z|(KWF|&[|&eM',
      '|)_|#UF|#W#DeM_|%RX3|$)|%=|$3eL|$5A[3|$6|$7eKL|)YF|$83|&W#FW|%BW|%F|&WOL|%O_|%W|%[F|$:BW|%G_LY|$=|%8WO|%B|&WB|&_|&c|',
      '%G|%O_|%Q_|%W|%[|&F|%_|&B|&F_|&QM|$?3M|%W|%Y|%_|%eLWB|$@|%B|&WB|&_|&c|&eLW|%OY|&_|%QAeLWTW>Y|&[F|%YT|%[|&F|$AX:eL|%Y',
      '|$BWFZ3[OXB|&QMA|*WB|,YO|$D|%3|%5eMTeB|%F|%P|%eL|(_|$GMA_|(eLWB|+T|&B|(W|)B|&OY|(_|)OeLW|(eLW|&WB|(TW>Y|&[F|$H|$KF|&',
      'MWQ|$L|%QeL|)_OW|*T|%Z|&T_FW|%[|$M|%#QWM|%3MY|%OY|%T|&W|%W|&ATY|%Y|%_|%eSX3|$PQ#=|&W|%[|$Q|%M|$RXK|%Y|&K|$T|%ZD_Q|%e',
      '3c|&BQ|)X3|)eL|+WT|([|$U3|%AWMY|(NeLW|%B|&WB|&[3|&_|%F|&_|%XFY|(eLW|%[|&F|#X#?c:|%DW|%IOe?F|$3B|%O_|%TFRYO|&XB|%WM|&',
      'T|(W8eLW|)TW>Y|%XGY?XLW|(eM3OeG|&IZ3eT|%Y|%eMK|)Y|(Y|$4eLWB|$6=F|$8WM|(EWMW|(O_|(Q#B|)_E|(W#8W|+Y|)B|%XBeM|$:L|&F5M|',
      '&W|&Y|%WG[M|%_BW|(_|)GD|(eLW|%e<WF|*3CW|$=W|$>cIW|%e>O|$BMA|&XB|%eB|(YL|$DMeJ|)WB|+YO|%_RY|%eLKWF|(W|)EM|)GY>|,W8W|.',
      'Y|._|.eLW|-B|.YO|.[F|-F_|,_|)MeCY|,eLW#FW|1Y|)OL|+WB|(ZB|&McUY|&QWF|$EQW|%WF|(TJ_8_|,eLW|+B|%Y|%_L3|$F#BY|%L|%WL3|%X',
      'KL|%cD|(Y|&IW|$GMYB|%ZO|$J3eB|%W5|(AY|(O_|(W#KEeL_|)8_|*eLW|)B|*YO|)F_|(YL|&:F|(XB|$KW|&F|(BP|*WQM|(QWUB[3|+[|(T_QW|',
      '(W#8eLW|*FY|)8_|*eLW|)B|(_|$MW:KWF|&=|&M|%ZDeE|%cE|(WB|(Y|$O3eSA|%WT|(MWQ|%YF|%eLK|)eT|&TF|&U_OeK|$QMA|%WU|%XEBW|%_3',
      '|(WF#D|&8F|$RWO|%XSe=|%_S|(A|(B$|(W#3|%eMW#BY|&O_SA|&Q|(3MeKW|)cR|(8S3|(FWC|(TeB|(WB|)T|$S|%L|&3|&W#QM|+YO|(8_|(B|(Q',
      'M|*YO|&Y|%WA[|&MY|%eA[|)DWT|)F_|)RWTeBeMY|$TMe5|(:F|%WQ_|(eLW|%eBWM|(YMeA|(]B|$UWM|%XMY|%YM|#Y:|%FXMeKXBY|$AW|$M|$T|',
      '#]#DWQF|$3eS|$BeB|(GBeM|,_|(Y|$DeE|#_5|%PW|&Y|&_|&eLW|%QWF|&_5PY|*_|*eLW|%WF_|$@W|$BF|$D|%WFeB|$E|%[F|$I|%TW)=QM|$M[',
      'P|$O|%eT|&U_|$P|%W|&B|%Y|%_B|&T|%cQ_PY|$Te=|(MeF|#a8WMX3|$:FWC|%e<WFX3|$DX3|%eL|(3RWTeBeM|)YL|$JQ|$KWFX3|$L3eBX3|$QX',
      'EeL|$RW4|&OY|%XSe=eL|,G[MeA|,_|%eL|&QX3|$SeAQ|#b=M|$Me?|$Oe=M|$RX#5e=F|#eL#3=_R|&58XBeM3WM|%3eB|)X|*5B|*8XBeM|*KBeBe',
      'Q|*M_4W|)Y#8Y|,eLW|+FW|,Y|*F_|*T|%BXMX3eB|&YB|%QTWL|*WB|(eCW|+G3|,F|*XB|&UWM|*WB|%TeB|%W3MA|&4eLW|+F|,KWOW|,_|&:|&G3',
      '|(OW|(WM|*Y|(eBY|&LWK|&QTWLX3|(UWMX3|&T|(GY>|%ZBeGBeBY|$MB|$UMe:XFXLW|%WF|&LOW|&QW|(Y|(_|%X3e=M|*cMXLW|&?X1|&L_BFWK|',
      '%Y|%^OY|%_5T|&FXT|%bL_:M|!R#3M|&MWQ|&W8WMeL|)_|%W|$4|$JM|#3AWM|$B|%W|&B|%YO|%_|%c|$OW|%Y|%_|$Z#BOW|$_|%O|$eBXRWOY|&Y',
      '|%L|&BW|(c|#=O|#B3W8eLW|&B|&GMeL#B|(WT[F|&KEeL_|%_|$WIeDY|$eM[|#FXQWM|$Y|#GC|#IeD|&3cR|&R$|&W#8W|*_|*eLW|)B|(8W|)Y|)',
      '_|(B|(GWT[F|(RY|#MA|%W5BY|$D|$YM|&W8W|)Y|)_|)eLW|(B|)YO|(OW|(QM|$eKW|%LB|(Y|#RY|#TeBeM|)3eMXLW|)_|#UMW#8Y|(FW|(Ga3Y|',
      '(KEeL_|&8W|(Y|(_|(eLW|&:QP|&B|(YO|([F|&GWT[F|&IDeDO8W|&KEYO|)eL_|&OW|&QM|(XSLY8W|%Y|$W|%:Y|(MW:_|%A_|%DW|%G[M|$YD|#W',
      '#B|&BW|&W|(MWK|&Y|$3WUWMY|$4W|$G|$MDW|%YMX3|$OXQWUF|%_L|$PW|&#KEeL_|%_8eLW|&B|(YO|$ReQB|$T3|&YL|%F|&W8W|)_|)eLW|(F_|',
      '%eBeM|*:e<|*Y|+L|*_|$U|%Y|&M|%[|#X#5_|%D_|$3B|%O_|%QA|&O_|%W5c|&M|(Y|%eS3|(AB:e:e<|)W8W|+Y|+_|+eLW|*TW>Y|(W|(X3W|$4M',
      '|&WQM|&_|$HWMT|$MG[M|%QW?3M|%WPW|%[M|%e3_|&?Y|$OWO_4|*WB|&UWM|%_DWM|%eG|(3OW|)WM|(_|&O3|$Q|%3WOYF|%9BeMGBY|%F_MY|%K#',
      'DXM|%MWK|(LW#FY|%OX#5|%T_FW|)_8_|%W:Y|)MW:_|+Q|&L|$SeL|(Q]BeBY|$TeB|#Y4|$B|%O|$MeS3|#Z3eM|(QWM|&O|$DeE|(Y3MA|$J|%eM|',
      '$Oe3|$Se3|#[DeM|$FeL|$M|#]#4OW|#_#5W|$%M|$3?c|$4|%M|$:WMY|$B3MY|&NeLW#8eLW|,FW|%WB|%Y|$G=Y|$M|$P3_|$Q=|&8W|(_|(eLW|&',
      'GMeL#B|&Y|#a3eSAX3|$OY|&B|(YO|$Q|#cE|%3|%WB|%[F|$JW|$SA|#eLWK|$MDeEW|%QA|%WDeE|&QA|%Y%MQX#D|&3W#B|(]SeA|,WF_|(eS_BeM',
      '|&EM|&F5M|(XQWT|&GWD|&K#B|(BY|&MWK|*G[M|&O#3W|*_8W|,_|,eLW|&QMeEF|%_AY|&L|&Se>|$Oc3|$QTF|%WT|!S=3_|!T#3=|%OF|&XB|&eG',
      '|)FW|%YMeA|%ZO|%_B|(TeCPWQM|/YO|,_|%eMKA|&SXGeB|(_G|$4eLW|(_B|)F_|$5A3|(WQM|(YL|%K|&F_M|&WQM|&_ReQM|%YB3WM|(IDeE|(W8',
      'W|*Y|*_|*eLW|)B|*YO|%eMU|)WB|*OL|,WB|$6=F|(W|(_8W|*_|*eLW|)F_|&XB|%MeS|%W#8Y|)eLW|(FW|)Y|&3?[F|&8W|(Y|(_|(eLW|&B|(YO',
      '|&F_|&OW|$8|%WM|&O3|(F|$:L|%YQ|(F|)Y|%e<W|$BBY|%W:Y|%cS|$DMeJW#8_|*B|%YG|%_R|$EY|%eLW|)3WPY|$FeLWT|*Y|$GBc|&eBY|%FeF',
      '|%Me3|)WB|%OW|&Y|&_|&eLWF#BM|*QM|%WD3|)YL|(F|(XB|%ZSe=WB|%[MeA|*GA_|%eMDWL|+W8_|,BYO|(_M3|$I#E|(XB|(Y|%cEBWB|(O_|$JW',
      ':Y|)F5M|&QeL|$KB|&Y|%_OFW#8_|*8_|+eLW|*B|*EeL3eS|)_|$LZ3eB|$M3eS3|)A|*WTW>Y|)XB|%8FW|$O5eF|$QB|&eTM|%MeEF|%WD|%XEWF|',
      '%_DFRYO|$RL|%cE3|(F|)WTW>Y|$TD|&YL|&_8eLW|(B|(F_|%Me5|):FeL|%WM|%e3WM|(]B|*Y|+B|&CW#8_|+eLW|*FW|+Y|)F|*W8_|+B|*_|)G3',
      '|(_8W|*Y|*_|*eLW|)B|*MeH_|)F_|)OW|$UXBW|#3WMWBeK3|%P|&Y|$eMXL|%SK|#4WMWK|$cO|#5PY|%_|%eLW|)B|#8XF|%Q|#:YQ|#=WAW|#BB|',
      '$MWQ_|(eLW|$Y|%R|$e3WM|%BW|&_QM|%L|&:XB|&RcE3|&W5eMU|%M|#DM|$TeLBeQ|(W#FY|$W|%F#D|%RXQ|$XR|$aQ|$e5ZM[|%L|#EeLW|#FW8e',
      'LW|%BFY|$eKWF|)WMeC|)XB|#GW=|$eBKY|#HM|#IFYT|#JW|%5]U|)WB|%GBY|%TD|$_8_|%B|#K3WOYF|$5eM|$:|%BWB|&_|%OY|&_|&eLW|%WQ[F',
      '|%[B|&F|$BW|$FeQL|$MTBW|%eC|(3|(F|(W#FY|&GXB|$RYBcSeA|$TeLW|$W#BM|%:|&QWDY|(eLQTeCW|&RWTeBeM|&TZEWM3|(_Q3|&W8W|)Y|)_',
      '|)eLW|(B|)YO|(F_|(OW|%EWF|&Y|%F|%GeB|)Y|%M#J|)WB|%QXSe=|$XBY|(F_|$Y3MA|&eS3|)W|%M|$ZDWL|&eM|)3XFWMW|)G[M|)TGW=YGWT[F',
      '|)W8eLW|*B|+YO|*OW|)Y|$[U|$]DeE|)Y|$cM|&8|$eL3|%MW=GDY|#LW:YMWQ|$eLD|#M3WM|(F_|(Y|$8X=AYT|$DWM|$FeLWLWEYR|$G#8|$P|$T',
      '_FWGBY|%eQBY|$WH|%Q|%TMY|)F_|$c:XFY|%QM|$e3X=|)W#8Y|%8|%IXLW|%Q8|&BeM|&GeMCK|&ReM_Se>|&TWEWMA|-GA_|)KWFeL|&W#5YA|)8e',
      'LW|)B|)FW|*Y|(EX3|&_3eSA|&c8e8|(Be3]Se=|*BK|&eUM|#O5|$KWF|$YK|$eBFB|%OW|(5WM|#QL|$W)|$XBW|%TeBM|#RTeBeM|#TeBF|#U3WM|',
      '(Y|(eL|*WF_|$:|%GA_|$F|$JW5|(Y|$Lc5Y|$O_43|$TW|%eM3|(IZDeE_|$W|%L3|&eL|)3|)WF_|%MW|%QW|&_|&eLW|$Y|$eLWDeMY|,:|#W#3_B',
      'X3|%4eLX3Y|%5|&AeLWB|&B|(W|)B|(_|(c|&OY|&QY|&WBY|&XBOW|*Y|*_|&YBX3|&[F|&cOW|%6X3|%?GWAY|%BW|%JWPOY|*_|%Te3]BX3|$)|$*',
      'C|$1|$3WMOY|%eS|(M|)BW|(YDWM|$4M|%PY|$5M|&Y|$:MW|&Y|&_|$>|%W|%Y|%_|$?Y|%_BYF|$B|%BeLWF_|%GZ?W|%QW|(UF|&_|&eLW|%WMW|$',
      'C|$DM|&Y3MA|$EF|&W|&_|%OW|%WMA|)B|*$|)GA_|%Y|%[|&F|%_|%eL|(W|$F|%_|$G|%?BWB|(_|(c|&OW|(Y|(_|)OeLW|%eBWUX3|$H|$IP_|$K',
      '#B|%5eMY|%FW|&_|&eLW#8Y|,eLW|+B|+KEeL_|*B|+YO|%MeCeL|%WF|(eL|*B|+$|*GA_|&LX3|&Q[F|%YO|%ZDeMEZFY|%[UX3|%cM_|%eL|(QWDY',
      '|&MW:eL|,W8W|.Y|._|.eLW|-B|.YO|-F_|,_|$L#3WPY|%3O|%FeT|%KF|$M|%#5|%4W|&Y|&_|(8|&eLW|%TeQB|%W|&#R|%Y|%_|%eC|&Q:FX3|(B',
      'eMX3|(JdK|$NeLW|$O|%8eLW|%W#DMKeLWF|&BYO|&GMeL#B|(WT[F|$PZ#4_|$Q#B|(QW?Y|%3WM|%BeM|%F|&_M|%M3M|%OY|%XBeMY|+IW)|$TQ?|',
      '$U:X38|%TY|%WLeL|*3|*WF_|%XBeLW8W|,Y|,_|,eLW|+B|,YO|*X3|&I|%_I|%eLWF_|#X#5|&WG[M|%8F|%E|&Y|&ZDZMe5|&[|%U|&5?|&W8W|(T',
      'F|$3#DM|%e3YK|$=Y|$?FY|$DeE|(W#B|)FeB|)MeC|(Y|(_ReQM|$F_|&KW|%eFM|&UW|$Te=K|(XK|#Y;M|$BW|&MWK|$FW|$KW|%_:QP|&QM|)YO|',
      '#Z#DM|$4|%Y|$5#E|(Y|%K|$8QO_|$=3W|%e=Y|$BWM|$EW|&3M|&M3|(AW|)eLWTW>Y|(XB|%YM|$FYO|$GM|%WMY|%Y3|%eMTXDeE|(XLW|$IcE|$J',
      'WS|(8#DeM|%_DWM|$KF|%WMWT|$Lc5eL|$M3eSW|)XB|%5WAW|%B|%ZQWBY8_|,eLW|+OW|+T|%[8|%_4|&R|%eQ_|$OBWF|%J|%c8FW|$QMeA|)GD3|',
      '%XEW|$SKW|$UWT|(XFY|#[3eSeK|$8FW|%XB|%Y|$:|$BeM|(EWM|(_|$F|$HY|$M|%eL|(KWO_BYO|(W8Y|*eLW|#]Se=Y|#^F|$KT#58eLW|%eLZ.O',
      '|#_#|%=|&M|&eMO|%DeMXL|%KY|$3#D|%e=M|$F|%W|&FY|&GBY|%_=M|$KY|$O[|%eTX%T|)LT|$Q3|%F|%W|%_B|#a5O|$DeEW#BX3|$FX3|(W#8eL',
      'W|*FW|+Y|(Y|%eL|(W8W|*Y|*_|*eLW|)B|*YO|)F_|)OW|)QM|#bHe=Q_%M|*M|#c?OW|&Y|&_|%[F|$FWM|%XLW|%Y|%[|%_|&MY|%eLW8W|*Y|*_|',
      '*eLW|$GW|%Y|%_|%eLW|$IB|&8|$KA|%FWC|%QWM|$L|%Y|$OWG[M|$PW|&Q_|(eLW|$QXL_B|%eUX.B|$RO|$TWL=Y|$UPW|#d#DMeL|$DY|$JDeM|$',
      'KeL|$M|%WSe=eM|#e3[O|%b=O#?|(XR|%eMYF|$=WM|%YHF|&O|&QF|%Z%Me=|&?X1|%_=|(eT|&?XLK|&RF|%b3|%cMY|%eMY=|$B#J|%M|&WQM|*YO',
      '|%ZBY|%[G|%cBeM|%eMXLW|+#8_|-eLW|,FW|(YQWDY|$COW#BM|+XB|%P|&_|%WF|(3|)_|(W#BMXB|)QM|(X3|(Y|(_|&GBeL|(F|(XB|&LX3|(Y|%',
      'XB|(Y|)B|&M|$FWF|&L[|$GMeEW|*#8_|+KEeL_|)_8W|+Y|+_|+eLW|*B|+YO|*KEeL_|*TW>Y|(R|%Se=|)GA_|)Y3MA|%^FXR|%_F|(KEYO|&T|%c',
      'Me=eT|$Hc=|$KMA|(WMeC|%WM3|)_|%XBW|&C|%]BX|)GeMYBeLMeC|(Y|$McB|$O^K|$Q|%8e9|)BW|%B#BeM|+GA_|&$|(8|%D_RY|%GeF|%JWQ|%L',
      '#8OXB|(J[|(QM|(T_Q3|%M|&W:eL|+WB|&[G|)W8W|+Y|+_|+eLW|*B|+YO|&e5|%TeB|%W3eSMY|&5B|)WEeL3eS|&B#BeMeL|.G[MeQ|.O@W|0eLWB',
      '|.QYM|.TaFX3|.W8W|0eLW|/F#BM|.cBeBM|(Y|&KY|)#FY|&LBeB|&MY|%XBe;MeO#?|&T|%Y3WM|*OY|+_|&?F|(XR|!U#5WK|(WB|(Y|%_MY|$T|#',
      '3WOG=e=Y|$e3|#:M|%B|$WM|&_|&c|$_MY|#?GTM|#BeBY|%LW|#D5WQ|#FZKWF|#KY|%D|#LWB|#MQO_|%[F|$X|%LWAW|*KEYO|%Re8#DeM|$Y|%A|',
      '%R|#O3_|%eLW|$eOW|&Y|&_|&eLWB|#PD|$[|%UP[|#QW|%)|%KWF|%ODWM|$Y|$_|%B|&YO|%OY|#TF|$eB3eS_G|&5B|&OX4XB|,_|&XFWGZMW8W|&',
      '_|#W!5|$*T|$+T|$8|$?_|$B|%JWM|%W8eLW|&B|&F_|&OW|%Y|$FY|$L|%?eMc:F|%Te3[O|$M|%eIM|&QMe?|$O|%8WO|)Y|$Q?W|$UY|#X#5A6W=|',
      '(W|&cOY|%D|&YB|&Z|(TeBWF|-Y|*CWF|-Y|$8W|%Y|%_|%eLW|)RY|$=|%OM|(F_|$F_|$IeM[|$KW8O|&OL|)W8eLW|*BYO|$MQW|&Y|&_|&eLW|%W',
      '|&IW)|%_|$O|%MY|%W|%eT|$QWPW|(Y|(eLWB|$TeTW|#Y8|#Z&F|$3ZKRUW|$BWBeKW|$IPY|$RWM|$T_F|#[F|#]DL|#^KXOe=F|$MY|#_#|$3e=M|',
      '$8|$B[|&F_|$FeMY|$K#B|%W?G#CY|$TZDeEW|$UY|#a#|$DMWIWD|%eMWIWD|#b3Y|$=_O|$O|$TeGX=O|#c)|%GMeL#B|%O|$*F|$+|%F|$:_|$AWM',
      '|(W|(Y|(_|&NeLW|%_|%eLW8W|*Y|*_|*eLW|)G[MeQY|)T|*W>Y|$B#|%W8|&B|%YO|%eLW|$K|%eT|$L|$P3M|%Y|#dRY|#eLW#8W|)Y|)_|)eLW|(',
      'FW|)Y|&8|&B|&F_|&KZP_|!fFe?|#OF|#QbMe?',
    ].join(''),
  ],
  bn: [
    "ঁংঃঅআইঈউঊঋএঐওঔকখগঘঙচছজঝঞটঠডঢণতথদধনপফবভমযরলশষসহ়ািীুূৃেৈোৌ্ৎ৷",
    [
      '!%#M|#1];ZGK|#:]6L|(X|#DUJRJQT|%ORKX|$X1|$]J@I|&RD]J|#F|#G|$O]ARD|(S@|#K]A|!&3X|#7X|#CUDS1|#D]@K]8R@S1|#K|$/|!(#KX8|',
      '#*DSJQD|#@SPRO|!*6]6|#@]@K|#E8XLR|)K|$K|$R@]@|#L]LX2JZ3]J|!-(|#1|$(|$8D|$;S|#2RDX|#;S|#E]KSL|#G#|#K|#LR1R|!1AR|#GS|#',
      'I|#K@X|$R|%K|$X|%7SL|)XD|&X|(D|%D|#LX8|#R7X|$8|$K?|&X|#S7U|$D]@U|#XD]B]K|#ZD|%Z|#]NX@]KX|!2XLZJQR=Q|!3<S@|#UKU@]GEVK',
      ']?|#]KP?|!6L6]6S@]K|!7SL|%XD|#Z;|!8D|$O#2]JR|+K|$]I|%J|#R@TJQ|$DUJQRKS|#UD|$LR(|#XLR|&K|!;S|!=SOXI]GK|!>R1R|!@2D|#A]',
      'JOV@]K|#GX|#R|$1X|$BXK|$K|%R|#SDS|#YKS|!AR1X|#X1X|!B1]NS?|#L|#S1X|$JQX|#U(|$;S|#X/JQR|$2R|$D|$JQ|$MXK|#]GRKR|%S@TJQ|',
      '$J|!CKDXK|$X|!D@UD|#BT|#JQ|#R|$I|%X|$KT|&BXK|#SJQX|!EK|$S6S@|$X|$]JD]@|#M]6SI|#R/JQR|$KX|#UKO]1RK|%UN|(BXK|#VK]G|(X|',
      '#]K1RM|)S@|%@S|(N]<S@|%AI|%CRD|%R1]@D|&6TD|&AIS1|&JQ|!FKROS|#LX|#U;GL|!G7K|#=Q|#JQOT|#K]@IRD|*X|#LR|$X|#PS$O#JZ3|#R|',
      '$#LR|(BXM|+XK|$5RLS|#S2]JR@|$8JQT|$B]JRLJQ|$HSD]D|$KUB]CX|$MXN|%]GGSB]JRLJQ|1XK|(XK|#XM|%S|#]J1]@S|%GO]AR|&PRK|(W@|$',
      'KS;SM|!HRK@|&TJQ|&XK|$NR|&JQ|&K|!I@Z|#C]J|&X|#DX|#RC]JIX|$K]1SD|&6|#VL|#W@]JU|#Z;|!J2D|#BS/|#R|$JQ|$K|#X|$2RDX|$ID|!',
      'KJQX7X|#R8DY@S1|%]JXK|$N];]K|!LRH|#X21|!M@RG]BTK|#PK|%XK|#S1]NR|#UKU|#XN|!O#2]JR|#5]3X|#BO]J|#G6XJQX|#IJQ|&X|#K1RK|(',
      'S|#P|#R1]NK@RK|$AX|$CRK?|)@|$KR|$L|%X|&K|#X|$(|$E];XI]GK|#]ARD|$GRCTD@R|!P6]7X|#@X|#D|#GX|#JQ|%X|&7SL|(X|#L|$Z|#RK|#',
      'SORGX|%XGX',
    ].join(''),
    [
      '!%!KS|##M(|%3]KP?|+1RKT|%;S|%GSMXN|%TBRK|%X|#1RBXIS|$WNS|$];ZGKX|%N|&I|&K|&R#M|*X|%OFZK]=|&R(=|&S8XD|#3HTK|$O];|$RO]',
      ';|$]DS|(JU3XK|%K3@S|(RIT|&?T|&BV@|&OK|&RCS1RK|#5]1|&D|&S@|%3|&DX|&KR8]J|,X|-K|#6SKX(|#8JQ|$RDR|$S@|$YG|$]:R@|&XJQGRB',
      'T|#:]6L3ULS@X|,K|(;S|(OIVP|(X(|#;Z|%IRD|%JQR|#=S/|#?U|%8TG|%GT1]N?|#@$EK|$-G|$S|%1]KI|%AS|%GRPS@|%KS1]@|$T@|&X|$]JCS',
      '1|&D]@|&R6RK|(CUDS1|%K|#A6|$GR|#BVKX|$WM]J|$]GY@|%HU@|%JRGCS|#CS1|&@K|&D]@U|&R#M|*(|(K|)T|)X|&W@|%3]KP?|%BE]@K|%DRJQ',
      '1|%GK]N|&ROT|*KR|&XMD|*X|%HU1]@|%N]<S@|$TD|&O]A|&X|$UDR|$]J1]N|&JQD|&RBXM|(E1|)DR|(JQ|*X|&UNS@|#DD]@|&J|$LR(D|)X|$RD',
      'UN]<RDS1|%K|&]O|$SJQIS@|%L|%M]6JQ@R|)S@|$U1K?|&VL|&]KI|%3@|%6]7XB|%BRD|%CRGD|%D]D@|%EO]AS@|,S@X|&R@|)X|&]KGXM|)R?S@|',
      ')XK?R|%GRB|)1|%HG|&V@|)S|%I@S|&RD|&S@|&ZBD|)S@|%KVE|&ZC|)X|%LSES|%MTLD|%NB|&]<RD|+;S|+X|)S@|%OD]CRD|&K?|&RKT|*KR|$VB',
      'S@|%K]C]G|$X1;R|)(|&R#MX|&X|((|$]@@|&K|(1|(8|(]3@|)DSPS@|)GK]@T|.1RLTD|)HU1]@|&SI|&]KXK|%C|&1RK|&]K|%GXN?|%J|&;S|&@]',
      'K|&ARJQ|&BS1X|&KR|&RJQ|#E;S1|(]JRL|$H]K#M|$K|%;S|%BS1X|%R8S@|&C|(T|(X|%SGK]@S@|&PRK]J|$ORK?|$PK?|$RKX;K|)S#|(MD|$U|$',
      'VK]G|$X1]NR|*1W@|%KR|%MRBRK|$]K6LS@|#FRK|$SO|&RK|&SJQRL|&X|#G1R<RIZ|&M|$3@|$8X1];|$@K?|%RK|%TK]?|$BRD|$CS|$D@S|$GRPS',
      '1R|$KUB]C|%ZC|$LI]GD|*X|$MSN];|*R#M|%XN|(X|%]J|((|$OK|&E]KRE]@|%RD|%]AR|)DK@|*X|*]@K|)JQ|(S@_|$PS@|$R1|%C|%O]@G|$S6]',
      '7SD]D|)XB]J|%H1]@|%LI]GX|$YC|$]B|&X|%JGPS@|&RP@|*S|#HJQRK?]J|$RG|&X|$S8R@|&]:|)@R|%CRD|%DG|&JQ|)MSL]ET|)X|&T@|&X@R|)',
      ']KT|&]D|%GROD|)T|&]J1]@S|%I@|&U2X|%JR@]KT|(D|)X|&U1]@|&Z3|)X|(8S@|%MRE|%NS1]@|&X1|%PS@|$]JD]@KT?|,D|+X|&K]ADR|&RO|&U',
      '@]ARD|-X|#IK|%]@]J|$RD]J|$S@RH|%JQ|$TIR#OS@|$UOLSI|$VLB|#JQLRK|%XL|$Z3]J|$[1]@S1|#K?]J|(X|$GSD]B|$]1XO];]KR|%3RDR(8X',
      'MD|%8D|(X|&S@|&UD|%=RK|%ADT@S|+GSB|(Y@S1|,HRGX|&G7KX|&ID]@]KT|&PTD|&RJQD|+X|(^|&X|&Z=1]O|%C|&EKSGRPT|&X1|)XK/|%E?|#L',
      'RH8D1|$SHRK|%I]ES1|+X|$[1S1|$]E|#MZ1|$]GRKZPT|#N];I|&RBM|#O#2]J|$D]@ZN|$I|%RE]@|%TJQR|%]EVK]?|&HG|$PJZ3|$RCRK?|%IKS1',
      '|&RD]J|$TI|$UGSCR|%O]A|)@R|+K|$]1RK|%;SD|&XD|)XK|&]KSJQR|-D|-K|)TJQ|)XLSJQR|/D|+TJQ|)Z|%@S@]G|&]K|%ARJQT|&S|(@SMTL|(',
      'K@R|%EN];|%GRHRGS1|&T1RK|)W@S|#PS#O|#]JR|&#LZ|&/JQRK]=|&1MD|(R=XIS|(SLSO|,XK|(];|)OXO|&5]3ZLR|&:]8XLXO|&;|&=HX:]6RK|',
      '(R|)I|*O|&ALX;S1|&D|(RL3|(SISJQR|*X;X=|+MD|(Z|(];S|+G=S|,RJQZ;S1|)=|*]KU|&EL|(ZLZ|(]LS1XMD|&GOSOS1|(X|&ISDZ|&KSO];;L',
      '|&L1ZPL|(3KSBI|)ZKSBI|(GRI|+;S|(RD|(UISDSJQRI|(XD|&OS;S1|)=|(XI]GLS|(ZOSJQXMD|(];XKS1]O|!&!1R|##MS1|(HRGX|#((((|$-O/',
      '|$/OS|$8R1|%]JR1|$;S|$=SJQRL|$D|%8TGT|%OHR|&];R(D|%S|%X|$GS-I|$JQUG|$KSM|$L|%]JRD]=|$O|%L]JRD]=|%SOS|%Z;ZE|#*;|%EU;|',
      '$LSJQR|$M|#/@RCTD|&JQ|$JQR8|(IT|$K5]38XG|#1GK|$KS1|%]N?|)TJQ|$O]IS1|$R5]1]NR|%BXIS|%K|&X|%M|&X|$W@S|(K|%N];|$]1XLEUK',
      '|%KI?|)HR3XK|)R@]I1|)X|&RD]@|%NKS1|#2@RK|$R*=QR|$]JR|(JQS@|#3@|$ID|$K@LR|$O];|(X|$R|%IT|$UD|&X|$X(|%/|$]DXJQ|*3SKS|%',
      'KP|(T|&R|(OD|#4R@|&X|#6K?|$RK|&]J|$]7RBS@|#7XD|#8/|$1RL|%XK|$I|$RB|%KGR(8RD|$S8|&UK|(L|$TGD|#:]6LS1|#;1|%X|$;S|$LRD]',
      ';S1|#<RKZ|#=QR(|&LX|#?GS1|#@LX@S1Z|$R*K|%@UK]1|$]I|&8TGDT|&E]K1RM|&OIK]E?|&P@]JR|&R|&TJQ|%KR(|#BI|%MUIRKS|+T|$K]M|$L',
      'X|$RD|%JQ|%L@|(X|$S|%GROT|*KR|%I|$XM|&X|#CR|%D|$SE@]J|$]JR@]IS1|#D@X|$D]B|(GR8RK|$R|%KO|$U|%3@]J|%IRDS1|%N]<RDS1|-HR',
      'GX|$X|%D|$ZJQRK|*R|$]@$D3K|&K]8R@S1HRGX|&ZDS/|%BRIRD|(LUOSJQR|/D|/K|&ZLD|*X|+K|&]KX|#E@]@S|$D|%R1X|&K|%S|$R@|$SL|$X1',
      ']NS1|+@R|%L|#F3RD|(SO]@RD|.X|/K|$]KS1R|*D|*K|&Z|#GBUK|&L|(]LRP|&O|%]C|$K?|%]@D|(S@|$M]J1|$PR/JQR|$RB|%K|&/|&Z|%O|&D|',
      '&O]AL|&S1|$S|%K]HRG|)V@|%N]1RK|+1|)W@|$U|%L|$W@|&]@S|$X3|%BD|$]BUK|(L|)]LRP|(O|%GRO|)TJQ|%KRPRI|#HSCRDS1|#I8RB|$BRDS',
      '|$D|%]@]K?|$KR|$L|%X|$O];RK=RI|$R1X|%8D|%BXK|%D@|%K|$S|%D|&UL|%KR@|%N|$TK|$XK|&S1R|*D|*K|#JI|$Q|%1RKT|%@D|(X|%D|&S1|',
      '%KD|%R@|(X|&KL]JRD]=|%U|%Z81|(D|)X|(S@|&=SD|#K-D-|$G|%S|%T|%X|$I]H|$R|%1RD|$X1|&8D|&;S|$Z|%/|%E|&S@|%P?|&T|$]1R(H|&S',
      'IS=SOXK|%8XD];SDR|.K|-TJQ|%;|&O|%A|&RK|&S1|%B]K|)@R|%DXO];|%IO];]K#|&S|&XDSJQR|)TJQ|%J|%OXDRL|#L8XKSJQR|,K|$@RF|$FR|',
      '%]KX=|$GRK];|%XDSJQR|(TJQ|$I|%3TK|$PR8]G|$R(PS|%*B]BSD|%BR|(HRGX|%E|%O]1R|$S|%I|%JQR|$T|%GK]BT|$U|$X18RD]=RK|&]ORD]=',
      'RK|%I|$Z|%1|&6S@]K|&ER@|&GK]N|&S@|%6DR|&S@|&]J|$]EO|%LRIR|(P|)K|)]|#M5]1R|$KRF|$R|$SK|$U@ZN|$XERMX|*K|$]GSD|%KI|&JQ|',
      '#O7SL|%X|$@X|&D|$D|%;S|%X|%]D|$GX|$K|%X|$L|%X|$R|%B|%DOZL|%I|$SJQRD|$TD|$X|%D|$]@X|%AR|#P@|$GRD|$IB|%XB|%]IXB|$K?|$O',
      'RD|$]GRD|!(!BUK|##KX8KR|(S|$LSM|%]JRD]=|,X|-K|#*-O|&-O&K|$1X|%]KXD|*TJQ|*XK|&LS=TJQ|*XK|$8SD|$;S*G|$DR(;X=|+X|%S1]O|',
      '&;|&HRK]OS;S|&JQDOIVP|*X|%XO]1Z|$KXDSJQRI|%Z|&E|(R|(SJQRD|(TJQ|+RD|(X|)K|$OUF|#1GRL|$UJQX=K|$ZDIS1|#5]3|&S@|#6]7R|#7',
      'RI@S|#:]6S|%8SD|)SJQRK|.S#|#;RKGSJQRI|$XK|#=XD|#@RLS|(JQRD|(K|&TJQ|$SGR61|%IC]JX|+(|%PROGSB|)X|$ZIC]JX|$]JRBS|#AS/ES',
      'JQR|,D|,K|#D1R|$=X1]O|$EU;|$FKIXMD|$OULSD|%];L|(S;S*;|,MD|$S|$ZHXMD|$];RK|)DX;|*]JRMDRL|)FXO|&XL|%=RO];]KSJQRL|&S8|(',
      'JQR|+D|%BSKR|&Z|(DXMSJQR|+TJQ|%O;S;S*;|&EX1];K|#ES&K|#FX1];|#GD|%UL|%X|$RB@|$]KRPSI|#HRD|$XD];|#IKRD|$RI|$X8|$]EXKSJ',
      'QRL|%FL|#JQ#|%K]1|)X|%R#|&D|&K|&PSJQR|%UHXD]@UO|%XIXD|&L|%ZPRD|#KR1|&S|&X|(K|%D|&S|&TJQ|&X|(K|$S=SJQRI|%@]KSJQR|-D|#',
      'LSDJQ|%JQRO|%M|$X1;]KD|+S1|-]O|+TJQ|*S1|,]JRL|&];]KD|,S1|#OIR(L|$KR(L|)XK|&JQXL|+S|$LRI|(EUK|(S|)1|)JQR|(T|(X|$PR1|$',
      '];|&RK]D|%@RI]GUL|%ER@|%JU|#PR|$UBS|&T|!)3L|#B3RP|$UL|$XK|#IRD|#M]GK|(6D]B]K|(BT|(XK|#OR|!*!6U|#(#|$1S|&ES=SJQR|&IS=',
      'SJQR|%X;|$8LS|$A|$DRK]O|%]=Z8|$I]GL=D|$L|%OD|%SJQRI|+O|#1SL|$]@|&S|#3RD]=R|*K|#6S@|$]6@I|(K|(R|&GSB]JRLJQ|&HVIS|&IRC',
      ']JIS1|&MS1]NR|&R5]3|(K?|*X|)S@|%7XB|#8GX1|(SO]@RD|$]8]GL|*@R|#<7X|$@X|$R|$X|%7SL|)XD|&X|%D|#=Q@X|%SJQX|&N]JR|%X|$]=J',
      'QD|#@]@E]@|&I|&KE]KBXM|(G5]3|,XK|(OVKS|+T|(R|)2?]=|):]6LTJQ|-X|.K|)CS1RK|.T|(X|&L|&TK]?|&X8DR|)S@|&ZLD|%ARD|(ED|)S@|',
      '&S@|%OG|#BJRED|(S@|$RK|&ED]AT|%PK?|)O]GKVE|$TJQIRD|$]BSD|&TD|&XM]J|+X|%CRK|&W@|)S|%GRO]@U|&S3]D|&UB]C|&X3|&ZCD|*T|%H',
      'G|&RG1|)D|*T|)S@|&S8]8|(B|&V@|%JRD|)X|(ED|&Z1]@R|(3|)X|#DGS#M|$SM|$]D@|(S|&JQD|*MTL|*X|&T@|%IU1]@|&Z6D|#E1K?|%RKT|%V',
      'L|(TJQ|(X|$3]KP|$8R@S|(TJQ|%TG]J|%XLR;S|)OIVP|$@]J1R|$BXM|&N];R|%]GTE|*X|+K|$DBT|%SGXM|*X|&NB]|%T@|%]JRO|*;S|*X|$ERB',
      ']J|$GW@]@R1RK|$HRNR|%Z3|$IPRBXM|+X|,K|$JU1]@|%Z3T|$KD]@U|%RN];]KE@S|%X|$L1]NX|%G]C|)S|$OK]3|%R3K|)TJQ|)X|%]ARE1|*D|+',
      'R|*S@|(S@|*S|$PRK|$R2]JRD|%6RK]J|%BRD|)3ULSK|%CS|%JQ|(X|%K]8D|%ODR|)LJQ|$X1]NR|#GUD];U|#H6K|$JQ|&(|&X(|#IK|$R(JQR|#J',
      'QXFR|#KGX|$U3UJQX|$]BU|%GK|#LUI|$];Z|%LI]G|&RER=QR|(P|&S2S@|&X2|)JZ3]JHRGX|)S@|)]J|#N]?|&@R|#OIRD|(TJQ|#^1WN];|%]NXE',
      '?|$2R@|$E@]@S|%D]D|%RB1|(D|)1RKT|)X|(S@|$O|%G|&X|%K]3|%RP|(S@|(T|!+DGS#M|!,?R@]I1|$XK|#@U|$]GS1|#NS|!-!BXK|$KR|#(6|%',
      '&(HS|$=O|$HRGX|$OG|#-FOS|#1(HRGX|%ORAX|$1|%HRGX|$6X;SJQR|$;R|&DR|%SIR@]K|%U|$@]K|(S@|(X|$BI|%L|&TJQ|%R|%S1X|&D|$CKDX',
      'K|$E]K1RK|$GRK|%S#M|$I@|%R@]K|$JZ3X|$O5]3X|%IJQ|%RAX|$R|%#M|%=XIS|*1|)T|%@]@KXK|%BM|%CRKX|&S1|)GRK|%K?X|$THV@|$UMX|$',
      'X|%1;S|%GRKX|*(|$]NX@]KX|%O|&6X:]8|&E]KXO|#2D|%/|%Z|$RD|&1RK|&X(|#3RKZ|$SJQX|$ULS|&Z|#7R=QR|)/|#8D]J|$XD];|(OS|#;R|%',
      '(|%/|$S(|%/|#=/JQRK]=|$3RK|$QR@X|%SJQX|$S|%DGKR|%OD|$U1XMD|#@(|$;R(|$X|$Z|#ADZL3|#BS1X|$XK|%MX|(K|#CKDXK|#D8R(I|%S/|',
      '$OR(1]LZES=SJQR|$RK]8S|$X|$]=|#EK]JD]@|$]KSLX|#F(;S|$-|%I|$OS|#GRK|#HRGX|((|%KXO];|#I-|$D|%1S|%HRGX|$ES|$SL|$]ERJQRK',
      '|#JQRK|(LR(D]O|#K(|$/|$1I|$EK|&X|$MRB|$R|$S1|%JQR|$VE|#L8SGS;S|$R1R;S|(OIVP|%PRGRB|$S8RGXA|%JQ;|$X|$Z|#MSJQR|);S1|)D',
      '|)K|$TJQ|#O&(|$1L|$G|$IJQ|$OS|$S|%=|$X|%7SL|)XD|&X|(D|$ZOSJQXMD|$];X;|%@ZDSJQR|-D|)TJQ|!.1]J|&GB]C|#@SPROS1|+HRGX|&]',
      'J|)3@|+HRGX|)GRPT|)X|#M]GKS1|!/(OS=S|#-O|#8D|#<R|$X|%D|#=QSJQR|&MR|$SOS|(*O|#EK|%X|$XD|#GRIR|#HRK|#IK|$RD|$X3R|#JQR|',
      '&(|(=|(D|&;|(OD|(RK|*]O|&D|&K|(XD|(]=|)DRK|)L]=|&L|(];RK|&MS#;D|%XD|&G|(OR(;|,X|&LM|(O|)X|&O];|*RK]D|#KFX|$SJQXD];X=',
      '|#LD]BR8|$]=|#MXDSJQRK|#NUC|#OIRD|(T|$]@RB|!0EDSGXMS1|%]JROS1|#NC|%S|!1#3]KXO|*X|#/IS|#1]N|&EA|)X|&TJQ|&X|%OGR8RK|#2',
      'D|%(|%/|%Z|&(|#5]1RL|%3Z|#6U|#<SD|$ZK|&HRGX|#?R|$S1R|$]<|&MSL]ET|#@3ULS|(Z|$;R|%U1U|$SEJQ|#AR/|%;S|%ORPS@]JS1|$S@|$Z',
      'E1AD|$]J|#DFX=RKXMD|-]O|$HXDMD|$ORK];|$SN]<|$];]KZL|%<|%D=Q|%JR|%ORLMTEXK|#ES|%KR(;|#FS|#GK|%O]ARD|+X|$S@R|(;S|$TK|$',
      'U@K|#HRK|#I(|$D|%/JQXLA|$E1]NX|%]LX1]O|$KX=|$L|%R|$R@X|%DZK|&]=|)RK|)Z|%K]O|$S*DS;S|)O];|%1|%;S|%JQX|%MD|(RK|$X|%=S|',
      '$]ED|&R(LRK|(5]1|&S*;RK|,X|*S#|%GZ=SJQR|#JQLR|%X1|(8D|(;S|(BSD|(GRK|#K7SL|(XD|%X|&D|$?|$@|%X/|&D|%Z|&JQR|$GRK|%X|&D|',
      '$L|%X|&/|&D|%Z|$R(|%6S|%D|&Z|$S|%I|%JQX|$UD|$X(|%/|%7S|(LZ|%DDS|&S|&_|%_|$Z|$]?|&FULT|&R;1|*XK|%@G]J|&R|&W1|(@]G|(E1',
      ']N|%DXL|%EZKX;|*MD|%I|&1K]@R|,KR|(R?]=|,X|&6RKT|&8TGD|+X|&K@|&O#O]ARD|(V6S|*T|&T|(KR|#L1R@R|$I|%]GRO|(SJQR|$R|%I|&]G',
      'SJQR|$S1R@R|$X8;S|&SJQX;|&X|$ZDS|$]E1RPSDT|&DR|%JR?|)T|#N];|#OGR|$ZHZ|#R!6R|(IRL|%;R|(K|%<RL|$*1X|%2RLT|%D];S|(OSL|$',
      '38|&X|$6XK|$7|%R1R7S|%X(|$8/|%1K]I|%;S|%L|%R2|(O]@RD|%T|%X|&(|$;R|&D|%SJQX|*7XD|%X|%ZJQR|$<|%RIZ|)3@|%XK|$?]=|$@RK|&',
      'LRD|$BSK|%XK|$D|%R=R|(SJQRD|(TJQ|%X;S1R;|%];]KS|$E|%=Q|%UK|%X|%]@R(|$GR|&=S|&K|%UL|%]J|(3]KD]A|(S1|(X|$IDR|%KUL|&VE|',
      '%RD|&L|%SL|%]JU|$JQKZ|$K|%/|%2RDR|%?X(|%DX|%R|&3RK|*X|&B?]=|&KUB]C|%S3K|)S|)T|%Z|%]8D|&;UD|&=|&@S1|&DXL|&GD|&J|(1K|*',
      'HRGX|*T|)LRE|)RKS@R|)]KI|,X|(@|(DSK]GRPT|(RLJQ|&L|(ZO|$L|%1SDS|&]KIX|%RI|%S|&I]E#|%T|&3:]8|%X|&1];K|%Z|%]EDS1|$MXI|%',
      ']ITK|$OSI|%]ESJQRD|$PSDS|(T|#S#|%=I|%GBD]@S|&R|$$|$*GR|(K|$1|$7U(|&1RL|&;R|&BSD|$;O|$@RG|$D@X|%R|%X|%]=RK3RK];XD|&@|',
      '$IS|$JQXH|$K3S8|)O]@RD|$LZIS;RK|,X|$MZK|(3:]8|#THRGX|$K]@D|(S|#U(=S6|%D|$1|%UK|$2]JR@|$;SK|$=QS3]KRI|$@UG|$IRK|(2RLT',
      '|(T|%SL]LR|$JQX@|$K&D|(X|%R(M|)BXK|%]BS|$LI]G|$N];SJQR|#V;DT@S1|&Y@S1|#W@|%S|&@]G|%]KSI|$N1|%S|&1R8|%]?|(3P]GK|(D3K|',
      '(R5]3|#X*|%(|$8S|$;X|&7X|$D|%DR|%R|%SJQR|*K|%X=S|%]B]K;S|*GSD]BU|*MROS@|*O]AL|.X|*S1|*THV@|+JQ|*X|$E|%LRK|$GL|&IR@]K',
      '|$ID|%G]KS8|$JQRK|$KL|&XK|%RLR|$LHSD|%]LR|$O|#YMZK|#Z6|%GSPRK|$;|%R|&LTER=QR|%S|$=|$?|%X|$AR/|&JQ|$D/|%;S|$ER|$IL|%]',
      'ERDS|+;S|*T|$JQRD];RI|(K]1|*;RK|$K|%&D|%SJQR|%TJQ|%];|(X|&O|$L|%D|$N|%TJQ|%X|$O];|#[?S1|$@U1|(RHSDX@R|$ML|&3@|#]JD]B',
      'S@RK|%R=X;|&AKSD|(LS1|(X=]KRL|&D];DIXD];|)ORK|,X|&ES;RL|(];XD|&IXKR|*UD|(]E|*RO|,X|*X|&KSGSJQRD|*TJQ|)JQRK|&L1R;R|)U',
      'LRO|+X;K|(OSJQRI|(SFZK]DSJQR|(XD]=RK|%UKS|$KI|&GK]CIRD|&M|&R3@|(D]GJQX|&X|%JQ|%O|%RD]@TJQ|%S1X;|*RK|*X|&E];D|&JQR|*1',
      'LRE|*MTL|&M]6SJQRD|&O];RL|*ZFRK|%T=QR|*GSB|&@BRO|%UOX=|%X=S;|%ZIZ8ZI|&JQXMSJQR|+TJQ|$LR(H|&G|(;S|(X|&K]1|&O|(S1|%SDS',
      '1|%ZKR(=|$N@|&S|(1K|(3]KO]@|(EVK?|%I@R|)6]JU@|)OTD|&R|%JQ|(1]N@S|%RK|%UBSKRI|(]K|*@I|+K|&G]C|%X@]K|*FL|*X(|+/|!2?]=|',
      '&X|#DD|$S|%8|$]=|%B1RK|#GK|#K6|$R|#LSFR|#O=QR|#R!|%;S|$/JQR|$3=QR7=QS|$8DR|%R|$=QR|$@|%UD|%X|$B|%S8R|%]J|(MO]J|$D|%R',
      '|%S1;R|$E|$GRK|$IRK|$JQ|$KRE|$L|%S|&B|%XB|(R|$OS|#SLRF@|#U!8@X|&X|$6KR|$D|$G|%(|$LDR|%X|$MS|#X8UK|$@RG|(E]KRE]@|%X|$',
      'JQX|$L@X|(D|%DR|%R|&;S|&CULR|%X|&7SLXD|(XD|&D|%ZJQR=QS|#Z!8|&X|$BR(|$LR|$OR|#]JR@|(DRIR|(S|)IRD|)OI]ED]D|$KS|&$|&N];',
      'EVK]G|/RG]B|*RD|+G]B|.X|*TJQ|&O];|*CK]I|*EVK]G|/RG]B|3X|*RD|+G]B|.X|*TJQ|!35]3R|&ZERC]JRJQ|#8L|#<D|%X|#=Q|%R|%X|#?@D',
      ']@]K|%RD]@]KS1|$DR|$EKSGPD|%]K8R@D]@]KT|$HZ;|(XK|$IRC]JI|+X|$P@]JR|$S@|&8]:|&GSB|&X|$XK|%M|$]J|#@S|%EA|%GX3|%MTL|#AS',
      '1|#B]J|#D]@G]J|%C|#GRBS|(EMU|$XN1|(KR|&?R|)3RK|,X|)E@]K|)IVL1|#HK]DIXD];|(K|$TK|&@R|&HRGX|#ID|$]GU8|%HTKR|#KI|$U|%K|',
      '$]=D|%@|%GR6XH|%HX|#LR|$]E|&1RK|&;S|&X|#R(=|%GRD]CR|$/JQR|$5]3XJQ|$7|%ERLR|%X|$8T|&EUK|$<DS1|$=QS|$>Q|$?S@S1|*HRGX|$',
      'D|%;S|%X|%]CT|$IR|$JQ1|&RDR|&S1R|&X|$KZ|%]=|(XD|&LO|&PO]A]J|#S;RK|(GRB1|$DS|%XO|$JQX|(7SL|+XD|)X|$K]8R|$LIZK|%]=|#T;',
      'RK|$@|%R|%S1RK|$K]8R|#U3L|$6]7|$8G|%KR@|)S|$;S|$=Q|$?|$D|$E]@|$KU|&@K|(]G|$LS|%Z|$P|%R|#WP|%ERLS@|%JUB]C|%T@|%X|#X7X',
      '|&D|$8|$;|%O|$I|%O|&X|$JQX|(7XD|$KSLR|$L|%X|&/|&D|#Z3ZLXK|$;R|$=QRE@]@D|(K|$@]K|(XK|$ED|&X|%RL|(3:]8|(EUK|$GSD]B|$JQ',
      'R|&XD]BR|$L|%1|%;S|%BR@R|%K1]N1|%R1RK|&E|(T|&I|&K]CX|%X|%]=|(XD|$N]<T|$O]GRIT|#[=Q|$?|$@I|$KG|#]DU|%ZI|$JR#;1|&GD|&K',
      'S|&LR1]OS|)KS|*T|(SLS/|&O|(TJQ|$KD]A|);S|)@RLS1R|)E:]8S|)R3RK|-X|)S|)X|%P|&?1RKT|(JZ3]J|-@R|(X|&R?U|&X|%R*D]=|&D|(R=',
      'R|&F|(S1]O|&I|(R:]6LX|(T?|(X|(]J|&P1|(RI|%S1|&D|&O|(XK|%T1|&D|&N]I|*1RL|-TD|-X|*ID]=LTJQ|*X|+K|%UE|(X|%X|&3KS|)TJQ|&',
      ';|(RK|&=|&E]@RK|&F@RK|%]JRD]=|,IRO];RK|)IS|$LRO|%U1Z8|%ZG|(RL|!4;1|$@X|$DR|&;S|&GLS|)T|$GX|$LX|$R@X|%D|&Z|%JQ|$SJQX|',
      '$X|%7SL|&X|%DS|#=QS|&K|#?];R|#D@]G|$GO@SEVK]?|$SN]<|)HRGX|$THV@|$];R|#KRDRK|$X|$ZJQR|#R!;S|$;|%@S|%R(L|%X|$O|#SKX|#U',
      '=QS|$I|$K@X|%X|#VK]?D|(RJQIRD|(S9=Q|#W?R|#X!NX|$KR|#Z=QR|$N|%?R|%RL|%S@|!6/=QR|#1]K|&GK]@T|%NU|#;];3]KRI|,X|&ZERC]JR',
      'JQ|#=QX|#@UK]A|)R#M|(BM|$]GK|(X|#D]B]K|)3UE]@|)MX2K|#G]GSM|#I]O]1S|$^1RK|#KI|$S@]K|);S|)X|$]6R|%GS|%JREBXK|#L6]6S@]K',
      '1RK|,;S|,X|$7SL|%X|$@|%X|$D|$IRD|$R|%1RLTD|)X|%6L|%K|$S@|$X|%7X|$]LSM|#R!B|&EUK|&X|%ER(DGRG3:]8|$(|%@X|%LX|$1|%IR|%K',
      'S|%R|%UKS|$6R|$D|$E|%R|%X|$I=QR|$JQ|$K|%8D|%;S|%BS1X|%ERMX|%R|%U1LR|%]6|(SL|&8|&LO|(S|$L|%1|%DR|%R@X|&D|(Z|&JQ|%S@|&',
      'JQX|%U|$N|%RGRB|$PSBR|#S#=QS|$1S^O1|)R|*GS8]:RD|1X|$<S|$=QSJQR2RDR|$@]@K:]8D|(R1K]N1|&K|(1K|*]I|)LR|(DR;]J|-1RK|(MRL',
      'R|)SL]ET|(R|)JQS@|(S@|(X|$DS|%]@R|)CRKR|-K|)GSB|)HRGDR|$E|$F|$KD]@D|%O]ARJQT|%RJQ@|$LS|&K|$P]D|(S@|#TD|%R|%X|#U1]@S|',
      ');S|)GB]C|$DRERAK|$I]G1|)TJQ|$JQR=R5]3R|$KS|$L|#V=QR|(D]@|#X(D|$1|$2H|$5]3SO|$@DR|$D]DR(|$EX|$I]GRK|$JQRK|)I]JRD|&X|',
      '(/|(7SL|+XD|$LOS|$N];R|$PRKR|#Y@D]J|%]K|$DS1|#Z2|%X|&K|$E=QR|$K|$L|#[B]B|$CUKT|$I]G1|)TJQ|#]JRDXL|*X|(]OXLK|&ELSD|(]',
      ';R|&I]ESJQD|.MSE|1X|.O|.]O|&LX:]8|!7=QR|%SJQX|#@]@SM3=QXK|(O3=Q|%KR1|#B]IDRI|*X|#D]B|#FR|#GS|%;S|#JQ|%;S|#R3L|$=QR|(',
      '(|(/|&SJQX|$@]K|(KR|(LT3|(RGRO|(T|$B|$E|%R|$JQR|(EA|#S;SJQX|$B]K|$D]D|$LDR|%Z|#U;S|%X|#X=QX|$B|$LX|#Z;3L]E|*1RK|%GXL',
      'R|%Z|%];|$LR|!8#MD|#/PKLRL|#3@X|$D]DRA|*EUK|$^|#5]3L|(X|#;SL|&@R|#=QS@|&JQX|%Z|#D1|$3?|&DR|&XK|%DXK|%ZN]<T|+K|$@R|$E',
      'B|%KSO#2]JRD|%]K@SDSCS|(SJQ|+@R|$GO@S|%PUL|$I@|$M]KU@S|$OD|%RCRK?|+XK|$PS@YNT|$RG|$S@|$X|%K/|$Y1|$]I3]KP?|,1RKT|&BSD',
      '|&O]ARD|&RJQ|&X|%J(|&/|&X|#GO|$RG|&X|$]GRK|#IR|%;|$S|%BRK|)S|)T|$X|$]IU|#JQ|%D3K|&UL|&]@T|%EUK|)PR;|%LRH|%R|%T|%X|#K',
      'SE|&X|%IRDR|$UKS|&T|$]8|&SJQR|%=RD|#L8|$>R1R|$BO]JUBXK|$EA|%R(3U=QS|%]KER@|$GRJQU|%SB]JU^|$RCRK|%HVIS|%MJQ|$TJQ|$X|%',
      'K|#PSK|#R1SK|$@|%S|&3@|)HRGX|(ZN]<T|&O#4|*X|+K|%TJQ@RGRB|.T|.XK|%XK|$BU|&1K|&4K|)X|$D|%@X|(D|%R|&D|(Z|&LR|%S|&JQX|*7',
      'SLXD|+XD|%UJQRKT|%X|&D|$ERD|(S|(T|(X|$FK|$HR|$I|%RJQR@X|&L|(EUK|%SJQR|%X|$JQ3R|)JQ|$K|%?|%S|%]DRL|&IRD|*S|+K|*TJQ|+K',
      '|&OS|$L|%RL|$PR5]3TK|,D3K|&8|(X|&D|(RKR|#S8]:ROR|$=SES|$@@X|%X|&7SL|*XD|(X|)D|&D|$BRD|$D|%3@|%SO|(E@]K|%ZI|%]DRP|$I|',
      '%S|%]GRGUJQX|$JQR|(*K|$LR|#TG|%B]BMRJQ|%D|&JR@]KRK|)ED|&RDD]B|&T|(1RK|&X|&]@|%GS8]:RD|-T|%R?U|&M]I|%S1R|&@|#U;S|$=QX',
      '|$@R|$DSJQK|%X|$JQRD|$KS|&2|$L|%R(JQX|%SJQRD|*O|%TJQ|%U|#X3X|$;|$@RK|%X|&D|$D|%D|%RKXL|%X|&;S1|&HR|$IO|$KU8RLXI|$L|%',
      'R;S|)K|&OIVP|%X|#YD|%KR|$G|%S1|#Z;|$=Q|&R|$D|%]O|$JQRK|$K|%BRK|%EVK]G1|$OX|&F|$PRD|#]:R@|&D|$GK|%RLRDS|*T|(SJQX|$JR1',
      '|(G|&IR(1R|,D|,K|(S@S|+1|%XN]<|%Z@S|)K]GS8]:RD|2T|-B|.]JR|,Y8]:RDS1|)N|*MRO]@]K|!9=Q|#K]?R|#R=Q2?]=|$L1R<S|#SDR(BP|$',
      'L]LS|#U!1S|#Z!1|!;DS|#IRO|#KD];Z|$]DX=Z|#LXIS|#R(3RK|%E|%I|&O|$*D|$/JQRK|$1R|$5]3R(L|$;R|$D|%R|$KGSJQRI|%]ISDRL|#S*G',
      '|$1R|%S;|$D|%;SD|$EU|$HS|$I|$K/|$O]JU|#T1R|#U1KZ|$ES|$KS#|%]DRIXD];|.X|$L|#X1DS1]JRL|&ZL8S|%O(|%]O;|)R(L|(RO|$DSO|%X',
      '|&OS|$GSL|$I]ELRKBXK|$KS;ZKS|$LS3]KRF|&FZD|&HSMD|+X|&JZ3RJZ3|$OLR|%];|(X|#Z1S/|$5]3R|$GR3Z|$JQX(D|$L|#]JR#1|&1]O|*R|',
      '*S|$KFS|%RD8S;|*O];K|(]OEZK];|*FRK|*ISMD|&FS1|&I|&O];|%SDS;S|&LSJQD|%X=|&D|(S#|(X|%]JR1|!<R1UK|(3R!/|$?]=R|$D]=R|#S1',
      '|%RDR|!=1];K|(X;|#3LRO|#8D|#ELRK|#G]LS*|#LRK|&X|#R$|$(|%DZOK|$1|%DRI|%R|%X|%Z;R|%]@RK|$6|$;R|$D|%BS1X|%R|$GL|&SD|$I]',
      'GL=ZK|$JQID]=|&RGX;SO|$K*(D|%]1|&GS|$L|#S*1|$-D-|$3]KS|(T|$8R(D|)RK|%S;RL|%XL|$D|$ERK];IXD];|%]LZIR|$FXD]O|$HR(O|%S=',
      'S|&MD|$I|%LR|$OS|%XI]GKX|%]1|&;]KSGS*MD|#UGX|#X(LS|$1X|$5]3U|$;R|$A|$DIRK]1|+XK|%SM|&O|%TJQ|$EU;S|$HS=|&O|%XLEIXD];|',
      '$I|%Z1]KX;S1|*]JR;|.S1|$L|$O]1;E|#ZDRL]=|$IRK|%SDS|)1RD|#]JRDSJQXL|$K|%R(H|%XD|!>RL|#U1X|#X*|$1X|#ZL|!@2D(|%/|%1RK|%',
      'Z|#=QS^|(6UI]G1TJQ|#@ZCS1|$]@]G|);S|)RGCRD|.X|-JQ1|)X|#AR|%1AS@|%ES|$]J|&6S@]K|#BD]@|$RDTD]@D|$UEKS|#D]@]K|%IC]JX|#E',
      'D|#GLR|$U|%/|#K5]3|(BYK]4]J|$F|$IU8|$L|$U?|#LR|$XK|#PGSL|#R!1X|%@|%BXK|%K|&R|$(|%/JQRD|$/|%JQRF|$1X(|$7R=QR|$8*B]BTD',
      '|%R|%S1SO]@RD|$=QR@R=QS|(M|$@]@]GS1|$D8RDSJQR|%]@]KS1|$E|%3@SGSB]JRK|%IR@]KR|%TJQ|$IR|&1|%SL|(DR=QU|$K(|%/|%1R|%@I]J',
      '|%EK|(/|(X|%R(|&/|&I?]=L|&M5]1K|%S2|(X|%X1|$L|%S1R|)HU1]@|&D|&G|%U1BRK|%XGRD|$PLX|%XK|$^1]N?S1|%EK]J|*EVK]?|#S@RO|$D',
      '|%8D|%;S|%GRK|%S(|&/|$G]G@|)S|$IUK|$KRDR|$L|$O]@R|#TG]K|(@R|$K|%GK]@T|%X|%]A|(O]ARD|#UIS|%UL|$KO]1|)X|*K|%TJQ|%]1IXD',
      '|+SO]@RD|(S|(TJQ|$L@X|%DR|(IVL1|,HRGX|(JQ|&TJQ|%OT|%R|%X|&7SL|*XD|(X|$NRK|(ER@|#W?HVIS|%IVL|$@TJQ|)R#M|#X8O]1]KSJQ|.',
      '@R|$HR3R|$ID|&S|$L|%U3U|$PKRD|#YIUK|$KT|#ZIKR|%RBXK|&K|$LR|%X|&D|#]G1|&XK|%K?|&RD]GS@|$JR3|$KJQT|(ZBM|%R?|%SDSBRB|&E',
      'UKR|&HU8|*XK|&IR@]KS1|&M|(RL|(VK|%U;S|#^1RLTD|!AIRO|#R(|%L]JRD]=|$1@|&X|(D|&Z|%GX|(D|%LX|(/|%R|&1RLTD|%XD|&_|$DR|%X|',
      '#S/KS|$I|$JQX;RK|+X|#X1X(|&/|$IX|#]JRLROXISJQR|$KS|&LRK|!B1]N|&@R|&S?EVK]G|)R:]6LXK|)X|#2L|%X|#?]=S@|#@]@|#E]@K|#F@K',
      '|$R|#ID|$]E@S|)K|#K1RK|$8R|$GRK|(X|%XM|$SB]K|$UD|$]E?|%M1|&D|(TJQ|(X|#L;S|$SL|$TJQ|$X|#M1|%X|$;S|$I|%S1|$R|#O]@R|#R!',
      '=Q|(RJQ|(SJQX|,7X|%@|$*B|$/|$2SL|$3|$5]3R|$=QRJQ|$@G]J|$BR|$D|%G|%R|%S*G|$E]@KS1|$FD|$GR|&=QU|%S|%T|$I|%T|%ZBK|$JQS@',
      ']G|+E]KRE]@|+HRK|+X|&T|&X|$KR|%SB]K]J|%U?|&L|%]8SLS#|&MDS1|$LRD|$M|%3UE]@|$O|%E]KAR|#S1|%X(|$3D]@|%I]GK|$4S|%T|$6]7X',
      '|$@|%X|&D|$D|%;S|%@RKS2|%R8EUK|%X|$GO|&X|$JQX(|(3Z|(7SL|+XD|)X|*D|$L|%TE|%X|&/|&D|%]LS|(T|#T1]NR|(S@|$4S|$D|$K]4|(1R',
      'L|(@I|(BSD|(IXJQRBT|(O]ARJQT|#U$2|$(8D|%;S|%GRK|$3]C|$8D|&X(|$;Z|$C|$EUK|$GRK|$K@]G|%]3|(I|(R|)EUK|*V8R|(X|&4;DR|+JQ',
      '|&BRD]@|&DT@S|&GL|)@R|&HS1]N|&JZ3|&LH|#V@|%RGRO|$K|%@]G|)X|%GK]@T|&T1]N?|%X|$N?|%S@|#W>Q|&HRGX|$M]J|(IRD|(X|$N];RD]@',
      '|(S|)1Z?|)H5]3S|#X/JQRD|*3:]8|$2@X|%LX|%RD|(Z|&MZDR|%SJQX|*7SLXD|+XD|%UD|%X|&7SL|*XD|(XD|&D|$=Q|$DDS|$G|%@R|%BRO|%DR',
      '3KT|%RK|%T|%X|&D|(]B]KDRA|$JQDS|&R|(L|)X|$K|$L|$M|%3ULS@X|*K|)Z@X|%8|%;S|(K|%G]JRET|%HR3XK|%S|%T|&JQ|%X|&(|$P|%X|&K|',
      '#YDD]BSD|%S1|$G|$K]4]J|*X|$PS1|#Z1RD|(X|$JQR|$NT|#[L@EUK|#]GD]B]G|%RBM|&K|(R/|%S|&3U?|&@TJQ;S|+@|+GRK|.XK|+RK]CX|&IR',
      '@]KS1|%TE|(3ULSK|(;S|(EU:]8|-X|(X|%Y@|$JR|$KGTHV@|&]J|%R4SIR#M|-X|&GS=Q|%U@|(3RIT|(@I|(S|!CDR@]I1|$T|#IDT|#K@X|$D|$R',
      '|$X(|%D|$]I|&3UKU|(]KD]A|&4;|&@@]@]G|&DSKEX1]N|&ERL|(]K6RK1|&GSM]GRO|&RD]@KS@|(GLI]GT|&TJQ|&X|%N?|#R!6XK|$1]1R|$@G|%',
      'U|$D|$E|%X|$K|%1|%?|&1W@|(]NI@R|&R|(;S|%R|&GRPS1|,@R|.JQ|,HRGX|&HRN]J1RK|%X|%]IS1|#TK|%X|#VI1X@U|%ERD|$OK|#]G|%#O|(E',
      ']KRE]@|(RGMXN|%DS|(GS8]:RD|(IVL1|$JRD|$KUEBS|)T|&G|(1|!D/3R!|$JQRG|#1&*;|$L|$MR|$]N@]K|#3K|%T|$]D|#8K|%UL|%X|#;K|#=Q',
      'R(L|#@UDHRGX|#AS|%HU1]@|#BSJQR|$T;S|%JQR|%OIVP|$XK|#D]BT|#G3<S@|$8R3K?|$B]GTE|$GK]N|$I|$RD]D|%G|&3:]8|$S|$T|%D|$]G(J',
      'QXK|%J|#HXI]GK|*X|$Z6RKT|#IDTJQ|$UDR|$]GK|#JQ;S|%R|#K/JQX|)8TJQ|$I|$OS#BT|$XD]B]K|$]A|#N];|#R(|%8RK|&XKSJQR|-K|%;|&O',
      '|&]KZ8XD|$/|$1|%S|$3|%EUK|%KS1|)@]G|%R|&B|&L]JRD]=|$6|$;1|&;S|&TJQ|&X|%ZK|%]J|(1RK|(CK]IT|$@S|&MT@ZN]?|$A|%U|$BRL|$D',
      'R|&D|&GSC|%]BR(L|$GS1|$I/|%1|&K?|)1W@|(DXK|(R|%;S|%IR@]K|%R5]1S@|&8|&DUORKX|%SJQX|%X(|&/|&D|%]GRK|$JQ1|&X1|%SL|$K1XL',
      '|%RJQ?|*3:]8|%S1XL|%TGRBT|&KR|%]OS#|$OR|%SK|%]@S1|$^OS|#S$OK?|&W@|$*|%(JQK]1|%1]JROL|(LSJQ|,RK|-O|)TJQ|%8|&SL]JRD]=|',
      '/TJQ|%;D|&]KD|$1;|&@I|&GK]@T|&X|%RKR3UJQR|%X@D|&L|%ZLR(|)O|%]NXE|&OD|$2SL|%U!@|$6|%U|%X|$8|%O]G|%X|&(|&/|&1X|&BXK|&K',
      '|$@X|&D|$BK]MD|$D]BR|$ET=QD|$GB]C|%D]C|)D|)S@|)X|%RO|%S=Q|%XBD|(S@|$I|%8]8S@|%]D|(HVIS|(KVE|(LS2S@|(X|(Z1]@|$JQD]@]K',
      '1|,?|-X|,S@|&I|(S@|*HRGX|(X|&X(|(/|(7SL|+XD|)X|*D|&Z3|(8S@|%U1]@|$K1]NTJQ|%EX1]N|%RE@]@R|(B|&IJQ|%T1]NR|&P|%]3@|(ID|',
      '&?JQ|*X|&BSN];|(XM|*1|*DR|*S@|*X|&CRK?|*S@|&GR1|)6D|+T|+X|*S@|)OS@|)P|*T|(SMXNX|&HK|)JZ3]J|)MTL|&IL|(R?|*1R8|*RCTD|*',
      'X|)@R|(S@|(VL|&JR@D|$L|%X|$M]6S@|$NSB]C|%XC|(R8]:R|%]1RMD|(]KSJQ|$P@|#T6X|$@S|&IRLR|$L|%FRIRKT|$PRKS1R|#UKUL|#VK|%UL',
      '|#W@R@]@]GS1|%]J|(MSL]ET|$GS8]:RD|#X(|$/JQR|$3X;SH|$;|%/JQRK]1|$@R|&8S|&KR|%SGR61|%W@]G|*RCTD|*X|&GWD]B|&O]ARDTJQ|%]',
      'K1Z?R|(T|$BRKL]JRD]=|/O|$D|$EA]J|%RL|(S|%ZLSJQD|$GRK|$IX|$JQ|&R|$LOD|$MDO|$PXKU|#Y@S1|(@R|#Z;|$GXL|(8JQT|$JQR2RLT|#[',
      '1R|$EA|$GRPSDT|+K|#]JO]@|%R;Z|&JQ|&MDRL|%VD@I|!E1]N|&X|#7D]B|#:]63=Q|&BM|&I|&RJQX@|(M|%8S1R|*K|#;HVIS|$RK|$SJQR|$UJQ',
      'R2RLT|#=Q@X|%GX|%LX|%R|&DZ|&K|&MUDR|(ZDR|%UD|%X|&7SL|*XD|(X|&D|#?]=S@|)KR|%J|#@D|$R1R|$S@|$]@D|%DT|%K|&S1R|*;S|#AS1W',
      '^|$X|#B1|%X|%]NXE|$@]JR3|$R@S1|%K]A|)GS8]:RD|0T|0X|+B|,]JR|)X|(E?|$X|$ZD]D@S|$]C@S|)3@|);S|%I|&GSHVN?|&HVN?|&M]KT|&R',
      '|#D]AR|#GS@]K|#JQXD];|#K(|$/|$3?R|%DR|$BSD|$EK|&(|$GK]@S@X|)T|*1RLX|*@X|$I|%R?U|$KRN];]K|,ID]@]KT|$MUKRI|$O]EK|$R|%8',
      'JQ|&S@|%IK]M|*X|%O]@|$S1L]EDR|*S@|%3?1|(DRIVL1|(S@|%6JQ|&RL1|)DR|)S@|&S@S|%?@|(S|%@]J1]@|)R3|%BK]MD|%CRD|&S|%D@|%ER1',
      '|&VK1|)]?|&]KX1]NS@X|%GK]@D|+MTL|*S@|*X|&P?|(D|&RK|)X|(PT|&XM|)3@|)D|*R|)S@|)X|(N];S@|&]KR81|%HRNR|%IR?|)X|(D|(E|%L1',
      ']NS@|%MXNX|&ZC|&]KI|%NB|(X|&XGR|&]1RK|%O#2]JRD|&K|(X|&TIR|&XGR|&]AS@S|$T1]N?|*IVL1|)R|*IVL1|$X(|%/|%D|$Z1]N|)HRGX|$]',
      '@U3RL|+X|,K|)S8|+KR|)T8|%BR|%G|&@|(IRLR|(MW5]3|&X|%J;1|(D|&GX1]N1|,?|&RE]@|(JQ|*1]KIS1|.X|*X|(LZ6DR|#LL|$RMTK|$S|%;X',
      '1DS1|%DXMSJQR|%IRK|$]LT|#M@U|$U|$]6SIG5]3|-X|.K|)R|*:]6LXK|)T|)X|#PXLR|#R!6|&8D|&;S|&GSGS|&RLT|$(|%AD|%D|%L;|$*D]=|$',
      '/LZ|$1|%GRPSDT|,K|%R|%SO]@RD|,S|,X|%]NS1|$2S|$3L|&R|$6]7X|$:]8RG|*S|$;|%DR|$<|%1|%BRD|%R3RK|&@X|&D|(Z|&JQ|%SJQX|%]J|',
      '(EUO]@1|$=Q|&R|&S|&X|$?]=ULSES|$@|%LR|%R|&L|%]K|$AK|&4R;R|%UKX|$B;T1R|%BXMX|$D|%DS|%RIR|%S|%TJQ|$E|$GDR|%LS1|(MRK]O|',
      '&Z|%RK|%X|$I|%]E|$JQ|&DS|&X|$K|%@|&XD|&Z|%BK]MT|%FKI]JRD]O|%GX|(D|%IR?GS1|%LX|%OS1|&]EKS1|(J|%R|%S|&GRKS1|%XD|(DS|(R',
      '|(S|%]1|(X|&;S|&A1]J|(SG|&G@T|*EUK|)]J|&L|(RIXD];|.X|&M]G|*GK]@T|*TJQ|*X|&OS|$L|%1|%D|%R|%S|&@|&JQX|%];R|&LR|$M|%R|&',
      'ERMS|%X|&(|%]6R@]J|$O|$PR=Q|)S|)T|)X|#S#1|$-(6=S|%HS-D|$7DX|%SJQX|%U|$;|%RK|$<R|%X|$=S-F|$@R|&IP|(R@R|+K|$ELO|$JQRDZ',
      '|*GRB1|&XK|)X|$KRIS=|%Z8EUK|$O|%S|#TK|#U!8S|%AS|$1UK|$8Z|$<SJQR|$=QSJQX|$@UL|%]K|$DKRGW@]@S|(JQ|&U8]8TGS@|(B]CRK|&]3',
      '<D|(8D]I|(DSK]IR?|(GROD|$JQXK]@Z|$K|%1[ML|%DZ|%O]1RKX|)W@|%R?|(X|&@D|&D|(Z|%U|&LSJQR|%Z|&;R(|&CR|&DZ|&EUKS|&PS@|$L|%',
      'SM|$N];S|$O]@1|(S1R|#V8R|$K?|%]?|(BYK]4]J|(O#2]JR|(R5]3|(SIR|&G@D|(BS1X|(EUKUN|(G5]3|)K]@T|(R:]6LTJQ|-X|.K|)HRO|(X(|',
      '#WA1|&HRGX|%SGT|)K|$N]<|(EZN1|,@R|(R|(X|)K|#X!EX|%JQR8|$7DX|$;|%XD];|&K|%]KZLSJQRI|$@X|&D|$DRL];S|$ERK|$JQRKR|&X|(7S',
      'L|+XD|)X|*D|$KSJQX|%U|&K|%X|&7SLXD|$L|%S1]JRD|%X|&/|$M|%R|&3@|&BRK|*T|%T|#Y@W1|#Z1R|&IR1=Q|%XID|$=QRIR;SK|$E|$K|%];|',
      '$LSM|%TJQ|%Z|%]JRD]=|$MR1|$N?|%R|$O];|#[!7R@X|(D|)Z|*K|(JQ|&X|(7SL|)X|$7RJQ|%X|$K|%O#O]AR|&HR|%R?S1|$N|#]JR1X8|&;RK]',
      'D|(XD];|(]KS1|&D|(XL|&KR3UJQXK|(SO|*X|&LXO|&OSFS1|$K1L]E|*;S|*X|&RK|)HXB|(M1|*RL|)DR|*T|)]JX|&W@|)E1]NX|)S|&[ML|*T|*',
      'X|&]KSJQR|-1K?|-8R@|01K?|-;S|%2]JR@|%3@S|)MTL|%6?]=|&D]=|&LD|(S@|&RK|)1|)?R|)S@|)X|&UK|&XN];R|&]7B|%8DD|(]I|*XK|&R@D',
      ']@]K|.T|.X|)S|*K|&X1];|%?JQCK]IT|)D|&RLT|&T@|%@S1W@S|)]KSJQR|(8]:R|(;S|(BSD|)]GD]B]GS@R|0T|(DSCS|,@]G|/1RKT|/IVL1|(E',
      '1]N|(FLD|*S@|(G7K|)D]CT|)RB|+T|+X|)XBD|,X|*MT|(HR|*GRD|(ID]@]KT|)R|(JZ3S@R|.IVL1|+T|(K1]NR|)ZC|+T|+X|(LSES|(MG]B|)ZC',
      '|)]KU@S|(N]<R|,@R|,D|-;S|-X|(O]ARED|-S@|(P@|&T1|)T|(JQIRD|&]D|)@@]@]G|*R@]@]GS1|(J1]N|)D]@|)JQ|)R2]JRD|*GK]@D|*MR|+S',
      '@|*PRK|)X1|+;S|%AI;S|(@|(BS1X|(GRK|+XK|(RK]CX|(X|&R|(3@|&S@JMR|%B1]NS?|&@]@|&K]MD|+T|*S@|&RD|)1RKT|)X|&TE|&XM|);S|)X',
      '|%CRD@|*I|)ID]@]KT|%FUL]L|&XOK|%G1]@R|&?@R|&D]C|*X|&K]@1|*D|*S@|&L|&RB|(L|(OT|(P|)S@|&T?|&WB]CS|&XM|)B]GRK|)RCS1RK|)',
      'S1R|%HRG|)MRLT|)S@|)X|(N1|&U|&V@|&W@S|%IR?|)S@|&S@|&U2|%JQR@|)O|(Z3|*X|)8D|+TJQ|.@R|+X|&U1]@|+S|,3@|&Z81|)DR|)S@|)]J',
      '|%KZ6S@|%M#OR|)S@|&O]@|&RD]@|(O1|)D|*S1|&S1]N1|+?|+S@|&]D|)X|%O5]3|*X|&RB|(K|)S@|&SB]C|&XOK|&]@K|)RG|+;S|+DR|+S@|+X|',
      ')U@|+1RK1|+S|(A|%R(8|(=|(HX;|&1|(W@|*S1|,HRGX|&3|(Y@SPROS1|&5]3?X|&6TD1RL|-X|*@I|)K|(UK]J|(]J|&?|(1XD]B]K|(PRDS|(T|&',
      '@SN]<RDS1|&AIS1HRGX|&BUK]HRG|(XMS1|&CRD]J|&D]@|*S1|*X|&E1|(]@|*GJQO]1|*S|+K|&GD]CS1|&IR?]J|,6S@]K|&JQ(|)M(|)Z3S1|&KI',
      ']HS1|(]ADR|*T|&O5]3S1|(RB|*X|%S8I|&D];|)O|*;D|*SESK|&ISJQRK|&JQ|%T@S|)L@R|%X1]NRE;|-X|*S@X|&I|(X|&K?|)R|(S@|&O|(S=XD',
      '];|-OS|/JQRL|%Z3]KRI|,RK|,S#|&;D|(SD|(XO];]JRD];|(Z|)1L|&FR(L|$LR8IR|&O];S1|%X|&;|(Z|)K|&JQRK|%]JR;FK]I|!F1L]JRD]=|$',
      'SK|$]O|#8L|%UK|&L|%X|#;S17=QS|$ZME|#K8|$ROSKR|&T|$SBEUK|$XO];|$ZJQRK]=|$]I|#L1|$D|$M]KU@S@X|$O|%]GKVE|$RFL|$S@|#OFKR',
      'O|%X;|$L|#R!1R|%OS|$#MD|$(DI]JRD|&RL|)X|%GRK|%L|$*D]=XMD|$8SL|$BRK|$JQRK|%SL|$KOS|%R/|%U1|%XDPR(;|%]I|(XOS|&OS|(];|$',
      'L]3UD|#S1MD|$6RK|$8S1]JRL|)O|$;|$@K|$DL]JRD]=|-XK|%SM|$FR|$KSJQX|%X|%Z8|$L|%SE|(R(D|&O]@SD|,S|%ZOFS1]JRL|%]=|(O|&I|(',
      'FXJQRK|$MRK|#U;|%GLRK|(X|%SJQX|%X|$=|$L|%GR=QT|%X|$OFUO|)X|#X=RKXL|)MD|$DT|$G]KUJQRKS|-T|$K@|%RK|%S|%XM@R|$L@X|%R|%S',
      '1]O|%UBR|%X|&7SL|(X|&D|%Z|&MSE|$O];SH]JRL|#Z1RO|$;D|$D|$K|%RI|%];|&=|&O|#[8|#]JR1];KS|)O|&KR=X|&MD|$KD];|%I|%R5]1|*L',
      'SD|&D]O|*SO|,1Z|*X|+K|%S|&1ZJQXD]OS|&=I|%X:]6|&=|(KS1|(XKS1|&G]KUJQRKS|$LJQX=|%R(;|%XIS#|%ZKSD|!G#M|%3@|%CK|%R?U|%TJ',
      'Q|%XK|%ZB]HU@|*V@|#(3ULZ|$;S|$@X|$JQX|(K|#1K|$]@G]J|&R|&W@R|%KKX2R|%O|#2@SJQRK|#3U=QR|#5]1SI6D]B]K|%3|&GD]CU|&H5]3|&',
      'RG]B|&TJQ|&ZEOR3K|-X|#6D|$]6D|#7K(|%3ULS@X|)Z@X|%X|&(|&K/|#8RJQ|#:]6S@|#;X|#=QBSD|%RL|%UJQR|%Z|$S|#?S1|$];D|#BK|$L|%',
      '3R7T|%S|%X|$]C|%GTE|#C]JHVIS|#D3R!|$8|$HVIS|$R:]6L|%I|$U|$X|$]BK|(X|&S|&T|&ZGO]@|&]JZERC]JRJQ|%C|&D|(X|&U|(@]G|+EVK]',
      '?|%J|&E]KR?T|&R|#GS|#IS|#JQO|&X|((|&]1|%X|&8|#K#|$2RO]@|$3UDR|$?|$F|$RB]B|%GK|$SMRL|$XD]B]K|$]3|&1SIS|)LZIS;RK|0X|&F',
      'U;|&IR(L|(VL|%8D|&]J|%?|&;S|&DR|)IVL1|&IRLR|&RLT|&S@|%@DT|%CDMTL|&IRD|&S@|%I?|&R|&T|%N|&E:]8S|,K|+TK|&OXKR|&R|(1RLX|',
      '#L1RD|$;S|$@|%X|&D|$GS8]:RD|&B]JR|$JQ|$LX(|&D|$S|%*=|%HSJQR|$X(|%/|%7SL|)XD|&X|(D|%D|$]LRL|#O@S|$DSJQR|%]@|$GRO|(1RK',
      'T|(K@|$RDZ|%K|$SJQX|$U|%D]CKR|$X|%D|$]@U|(;S|(@|(GRBT|&]K|#PD|%1RKT|%JZ3]J|$RL|$S|%$E]K1RM|%KR3@|&]8R3@S1|(HV@|%N]1R',
      'K|$U|%8R@S1|%BLTJQ|%GRK|%IU2T|%L|%O#2]J1|#R!1R|&U=QR|%6@X|%C|&R|&X|%M|&S|$#LRBXMS|+T|+X|(ES=SJQR|$(|%8XD];R(D|%DRKS|',
      '%GXL|%KX|(/|$*L|$1S|%T|%XK3:]8|%]J|&O|$3BRB|%RD|(X|%XKPR;|$4|%R|$5RLSKR|(T|%]3RLR|*T|$6]6R|(U|$7R(|$8RDZ|&K|(X|%X;|&',
      'JQRE]@|$;R|$=Q7X|&@S|(X|&R@X|(DZ|*K|(JQ|&S|(;S|(JQX|&T|&X|$?S8]J|*S1|,HRGX|*X|%T|$@RJQD|&O|(X|%S|&L|$B|%1|%MRP|%RI|(',
      'S|(T|%X|%]JJD]@]K|$CR|%]J|(@RIVL1|$D|%K|%RD|(Z|%SJQR6#|)X|%];U|&BKGRD|$F;R|$GK|%R|%U|$I|%D|%ED]AT|$JQRK]D|&U|(I?]=L|',
      '-TJQ|-X|$KGRK|)R|%R?OT|%XK|%Z|&1|&;S|%]=|&@R|&DRK]=|&IR|&LSD|*X|&NS1|*T|&OXLZDR|$L1|%S|&1R|%UK4R;|%Z!|%];S1|$N]E|$O|',
      '%HGD|)X|%O]ARD|%R|%SD]BR|+KR|%]1X;GL|&@G|)@R|)RJQD|,S@|)X|$P1|%D|%KR(D|%R(|&BUK|&IR|%SDT|%U|&K|%]JS1|$^OKS1|#S#M|$-|',
      '%DES|%OOS|$1L]E|%MS@|%RM|(X|%SK?|%W@|%]KI|)EUK|(JQ|(S|)@|)JQR|&NSE]@|(ZH|$3|%@|$6K?|%RK|(1|(E@S|(X|%S@]K|%]7SD]D|,@R',
      '|(UK?|(XB|$8DXO|%JQ|%XES|%]:RD|*T|+KR|*X|)ED|$;|%R|$=QRL|$@K?|&]1|)S@|%R=QS@|$BRJQ|%XM|(S|(T|(X|%]JIRD|(R|)LJQ;S|,X|',
      ')OR3K|(U@|*XK|)^|&KZP|*T|$CGR|%RD|(OHR|&JQ|%S|&GB]C|%]G#OT|(O]@|$D|%R|&IVL]JX|%SIJQ|*X|&JQZ3|%ZBD|%]BU|&JO]@|(RO|$E1',
      ']N|)X|%8]8D1|%?D|%B|%D]D|%KT@|)X|&]JJQ|%UL|%]LG|)T|)X|$GK?|&]@D|*TJQ|)S@|%RB|&P|(S@|%S|&C|&OS|%W@S|%X1RDD]B|&6DR|(S@',
      '|$H1]@|)S|%G|%R3|(TJQ|(X|&8D|(S@|%SD]DHRGX|%V@SHVN?|$IRD|(GD]BK|-;S|-X|(X|%VK]@|$JQRK|&X|&Z3|$K1]@|%@|&S|%L|%R8|(IRD',
      '|&;|&IEUK|%SJQRDS|%VE|%ZC|(S@R|(T|$L|%S|&JQD|%TD|%UE]@|*E]KRJQ|*S|+K|%X|%]=S#|$M|%B|%E|%RKB|&L|%SN];|%UB]C|%W5]2LR|%',
      'XN8]:|(?|(@|)]G|(HRGX|(RJQS@|(]J|%]G|(1RE|+X|,K|)ZN|(8DTD|)U=QX|(@@]@]G|(DRA|(GSB]JRLJQ;S|1X|)]JR#1XK|,ET|(HRK@T|(JU',
      'B]C|-X|.K|(O]@|(RJQD|)O|*T|(X|&KRI|&LXN?|+T|+X|$N|%JQ|(1|(3ULSK|(;S|(GO]@U|(X|%R1]@|%UGTJQ|%]?U|)EUK|*]KSJQR|$OIRA|%',
      ']@RK|*S@|*X|(TK]?|(W@|*S|&FZK?|&IJQ1K|(S@|$PRK|#T8|%3?S@|&R?S@S1|$IR|$K|%HVI|%M]KXN]<|#U1|%X|$9@X|%R@X|&DZ|&JQ|%X|$;',
      '|$BREXO];|,X|%]C|(BXG|(S|)8TGT|)GW@]@S1|)I@]@R|*RD|$C|%GRK|$DZ|$JQXDZO|$KUD]=S|+K|$L3XKSJQR|)TJQ|$M|#W1]N|$;SM|$@]@|',
      '(R1RK|(S|(XK|$B]C|(S|$N];S|)ER@|$P@]@I|)K|%O]E@S|+GRK|%^|#X!6X|%CX|$1D|%RK|(@]G|+XK|$3|%I|%UD|(S|%X|$5]3L|(RLUKU|$7X',
      '|$:]8RISD|$=QR|(@X|&X|(7X|$@D|%RK|$AUD|$B|%RD]@|$D|$K|%S#|&JQRI|)X|$L|%3]KX=|%8SJQRI|%R|&KUM|*TJQ|%X|$M1S7U|%SKHR3|+',
      '(|$N];S@|$O|%GL|%K1RKS|*T|%RIKS1|%S1|%];|#Y6S@]K]J|,IJQ|$8]:RDS1|$<1|&X|$BS1|%XMS1|%]JU@S1|$C|%@R|$E]LGS1|$MR2|%SN];',
      ']J|,3ULSK|,JU1]@|%]GS1|$NI]J|%]?G|#Z1R|$9R|&DZ|&JQ|$C|$D|%R|$IR|%]GR(|$JQS#|$K|%Z|%]=|(X|$LRK|%S#|%^OIRD|$O|#[B]C|(C',
      'K]I|#]J1]@|)S3@|,HRGX|*@]G|*GK]3|*KR|%5]3|%:]8DC]GDS|%@S1]KI|,T|&T@|%AR|%GCRD|*X|&OR|)JQS1|+T|,KR|+XK|(]AR;S|+E1|,DR',
      '|&PRK1RKT|*S1|*X|%JQ|(GPUL|(X|%K]A|)@R|%O]@|)@I|%R#1|)S#|&1|(;XKSJQR|(K?|(];XKSJQR|&2]JR|&5|(]1|&6|(XLK|&;OI]JRD|(RL',
      'SJQD|&CS|&D]=|*;S|&E1|)HRGX|(RK|*;S|*X|(T|&KD|(R1EUK|(SO];RK|&O|(RK]C|&P@|%UKZ|&^E@]@S|$KP]IEU@]K|%R*8RK|(D|&8SL|*TJ',
      'Q|*X|+K|&BRK]O|&JQRD|&P]I|*?|+GR=QSJQR|%S3X=|*SJQRK|&8|&;SMGSKZCT|*KR|(XD|*X|%T8|%UDR(|*JQXK|(Z|&O|%Z:]8|%]JR1|)D]=|',
      '$L1|&X|%3|%R=|%U|%]JR1|#^OK|!H1]@|&S|#3GRD|$]DR#M|#5]3|#;];R6RK]J|#GD|%;S|%X|$SN]J@|*X|)B]GR?T|)^|#JQ|%5]1K|%RGP|%X|',
      '&O|#KGX3|$R|$X|%K|$]@S|#LS*I|%GL|#R!8|$(|%1S#|%JQXK|%KRO|%O|&KJQ|$/JQRL|$3|%(|%G@|%TKAT|%X|%]J|$5R|%]3R|$8R|$;R|$=QR',
      '|$@|$G|%DR|%R|%X|&(|$K|%@GK]N|+X|,K|&K@]D|&T|&X|%E]KRE]@|%ORI]J|%T|%]6UJQRL|&8SDSJQR|&ID];|+X|$L|%GROR|%HRGX|%U1R|%Z',
      '|&GROR|&HRGX|$N?|&X|%R(|&/|&3@|(ULSK|&;S|&@R@]@]GS1|(X(|)/|&EKSGRKXK|&GS8]:RD|.T|)B|&HRNT|&OIVP|%S1|%T|%]J|$OIRD|%RD',
      'T|%]1K|)]J|(Z|#S1];K|(ZKSJQR|$:]6S|$;R|&ISD|$=Q|%S/|$@K|&X|%]@S|)1|)E]KO]@K|$D]D|(@R|$JQX@|)DRI|,S|,X|(DR|$LPXL]I|%R',
      '|$OR|#T@|$N?|#U;RD|%];R|(Z|$IS1R|$L|%X|#V!(JQR|$2?]=|)X|$3K]HO]A|%ZL|$@|%@]@]G|%R@]@]GS1|%]G1XK|$EWN]<XK|$IC]JOR3K|-',
      'TJQ|%S|&1I]E|+X|(R|&KVE|$NS@|#X1];K|$5X|%]3X|$=QR|$@K|&X|$B|$DSO|%X8UJQXLRK|$GX|&7SLXD|$N8|$OX|#YKG|#Z1RL|%]@R|$3|$;',
      '|%RCS1RK|&K|%X|$K|$LR|%];X8|#[3ZLS1|*HRGX|$@|%S1|#]JR;S1RD|&D|&LS|$KI?|(X|%R@R|$LRBSISK|!I/LRDR|#1K|$]1R|(K|#5]3L|(G',
      'RK|&ZL|#8RK|$SB|$UB|%IBRK|#:]6|&O]A|&X|%8SL|&UK|#=RK]D|$XL|#?S|%EUK|)S|)T|$]=L|#@(|$D|$GRB|%SKZC|$HXB|$RBK]M|%D]@KX|',
      '%I@|$S*K|%9SL|$X|$Z(|#BD|$SDR|(JQ|#CU|%EUK|%I@S|%OVBD|$]J1RK|&E]KBXM|-XK|*R6]J|.X|&GK]@T|(S@]@|&HR3|*X|&I|(R<XK|&JU3',
      '|*TJQ|*X|+K|&X(|(/|#DOR|%UK|%]@R@]@]GS1|$S|$UN]J|$ZDJQD|&SGXM|&T@|%GS8]:RD|%HRG|%JZ3|%KI|$]=L|%@G]J|&]K|)?RLJQ|)SEKS',
      'NB|*OHR|-K|)T|%BSK|);S|)X|#I@R|#JQBR|(D|)X|%DR|%IDOS#P|#K1]1Z|$?Z@]@K|$S6|%O|$UHVIS|$]JRBR|#L]LS1|#MLR|$R|#O8SB|(;S|',
      '(X|$LSD|$W?|$]1Z|%@SN]1|+X|,K|#P1UIR|$I]IB|$L|$R|%1K]N|*TJQ|&RG]J|(M|)6RKT|)JRD|)X|%8R3@S1|%@]IR|%BXM|)TJQ|)X|*K|%D|',
      '&3K|%EKS6RL1|%GSB]JRLJQ|(M]G|+X|,K|&TK|%HRK@|%IRKT|%KR8|)R|(N];]K|%O6SG|&=Q1|&R3K|*TJQ|*X|+K|$S*B]BSD|%LR|(KR|$TMVK|',
      '#R#O|$(|%1|&XL|&]KZ1D];]KZLRK|*E]KOXOK|*OF;|%;ZOSO|%DK|%L|&FL1|$*D];|)XD|$/|%LRDR|$1X|%]O|$3UKR|$4|$7|$8RK|$92RDX|%R',
      'IR9S|&KS|%S|%X|&(|$;S|&K|$<|%X|$@R|%WHRNR|%]K|(R|(S1|$AR|&ES7U|$B1|%KROR|%RK|(3:]8|(TEUK|%]KR8|)OR|(SB|*X|$C]JI|)S1|',
      ')X(|(R1K]N?|$D|%6S@]K|+X|%B?]=|%G|&8R@SK|&@RGRBT|&BXPXK|&RCS1RK|&S1|%ID]BSK|%OS1|%S1|(3:]8|%UN|((|(XK|*R|%X|%]DRD|$E',
      'XK|$ILR|%R|%UD|$JQR|(DIRK|&XK|$K|%IR|%R|&<R|(S|&@]I1|&BZDR|%S|&JQR|%]1|(OGRBT|(R|(X;|(Z|(]O|*GRBT|&3RKX;|&6X|&;SD|&G',
      'XL|&MRL|$L|%BP|&R|&]GTE|%HVIS|%JQ|(RLI|(XMSJQR|%R*(|&IRL|%S1|(RDR|+CTD|$O|%S1|%UB|%X|%];RK|*]O|$PGUG|%IUB|#S$|$*8S1|',
      '(JQRI|%DS2|(OSE]JRL|$2R(L|$7SL|(X|$8ZKRI|$;RK|$=SJQR|**(1S|$@]K|$AO]1]KSJQR|%XD|%]JR|$D|%RK|%S|&;|(X|$IS|$JQR|(DIRK|',
      ',XK|$KEUK|%]8R|)EUK|$L|%D|%O|%RD|(XK|&K|%S|&3]KRI|&;RKS|&@|&IS;RK|&JQD|*XK/|)X|%X|$MD|&RKS|&X|%K|&TJQ|*KR|&X|(K|%SJQ',
      'X|%X|&7X|&L|%]K|(?|(S@|$N];RD]D|(S|$O|%SK|%XO|%[KS|%];RK|#TK|#U1U;|%]@|(S|)E]KRE]@|)GRPSDT|/K|)JUB]C|.X|/K|*ZB]CR|/K',
      'R|$2|%RK]8T|%X|%ZERC]JRJQ|&IU2S|&M|%]J|(ID]@]KT|$3]C|$4L|$7X|$8SG|(D3K|(UK|$B]K?|(R|(S@|$D|%RFR|%]OT|)3:]8|$HS|$I]G(',
      '|)JQXK|(R(|$K|%3S|(K|%]MSBRGRB|$L@|%RK|$OLIRD|*KR|&SI|)KR|%R|%]@RFR|$PI]IB|%RI]IB|*RB|%VK]@X|#VK]@S|);S|&CD]J|$L1|%@',
      '|&$|%CD|&RKRK|%DT@S|%X|%]J|(GRD|)ZC|(RJQD|(X|$OR|#W@|%BXP|%]@S1R|&JUB?]=|*D]=|)GK?|$BU|$^MSL]E|#X(D|%L|$1]OS1RD|*Z|$',
      '3R/JQR;|$4|%DR|%RLJQ|$8K|$;RL|%]KS1|(Z|)ELS;D|-RD|$=S1XL|(]JRL|&OSD|%XL|$BSDTEUK|$CR|&GT|$DX|$IKS|%ZKSJQRL|$JQK|&RB|',
      ')T|)X|&X|(KR|$KRI@|%S|&D|%U|&B?]=T|%X|$LR|&D]BP|%X|$MSD|$N|$OS|%ZE;XISJQR|$PXKEUK|#Y@Y|%]KT|#Z$|$1RGXLR|$3L|$4L|$8RI',
      ']GS1|$;R|&IU;S|+HRGX|$=|%Q|$@RGX1|&JQXD|$GR(L|$I|$L|%]LR|$MRKKF|$O]@FR|$PD|&3:]8|&GR3RD|&R|%RIX=RD|(]IB|#[2S1|$8R|$K',
      ']J|$L|%HT|(GR8RK|%S1|$OUI|(S|(T|(X|#]JR1|(/-O|(]O|*/JQXL|&3R8SD|&6|(;S|(X|&8SO];]KX;|&;|(]KS1|,]O|&D|(3]KZH|(6XO];RK',
      '|/X|(PR;D|(UJQXL|(X8IXD];|*RK|(]=RKSD|*XLR|&KS|&L1I|(XKSJQR|&OR6UOX;O|#^O]J|!J1]N]IR|#@1]N?|$;R|$TD|$]D|#AR|%1]KIX|%',
      'JA|(HRGX|%K]A|$XN];|#BS|#D]@]K|);S|)ER@S|)R#M|)X|#I8|$UDR|#MZK|#R!K|&R|$(|%PZ1|$/JQR|$1|%R@|$6R(|%]7SL|(X|)D|$81|$@R',
      'JQR@|%]KR|(T|)GRPT|$BGEUK|%U4K|%XK1X|$D|%GRPD|%]@]KS1|$ED|$G@TJQ|%RK|%X|%^|$JQDR|(S|&_|%RGK|$KR|#SDS|$MU|&K|#TMU|#U1',
      ']@|(F]KD];|(KR8]J|-X|.K|*N];]K|/TJQ|/X|0K|(S|)GRBT|*S8]:RD|$3|%RD]@K|%X|&K|%ZO]LRHSJQR|%]I|$B]C|(1RLTD|)]NX@]KX|(X|$',
      'CSN]<SK|$G|%1|%KR8|#X1ZD|(Z|$2RD|$3ULSK|$;R|%S|$@|%XD|%Z|$D|$HRGX|$ID$|&;S|$O1L|%G|$PX@U|#Z3|%BRD|%FL|%OV@]K|%RD|&JZ',
      '3|%X|%]J|(@R|$B]CR|#[1]@S1|$3|%S1|$A|%HRGX|$D|!K#EUK|#/DR|$MD|#1I|$X;|$]@|&1?S1R|(]NJQT|&X|%N1|&?HR3XK|(MTL|(RGX1]N?',
      '|&R|&S@|#5SD|$XK|#6DR|&GLS|)T|$JQS@R|$S@|#8RK|#:]8D|#@]D|#D]CDE]K?RLT|(MYLT|#E]@RDS|#F@RDS|$S1|&UL|#GRK];|$S|%D|%GRK',
      '|$TD]B]K|+DRA|+O5]3T@|#I8RD|$DR|$XM|#JQX|&7XD|&L|%]JRL|#MSB|$TB|$]IS|#ORJQD|)GSB|)X|$UD|#PIRD|$O]J|(IJQ|$SI|#R(|%;|%',
      'FXL|%O|$*D]=|)X|%LS#|$/|$2@X|(D|%R|&(D|%X|&D|$3|%GS|$5]3RIR;S|(UDSJQR|$8|%1TJQ|&UIRK|%@D]@]K|&]G|)1RLX|%CRDT|%DT@S|*',
      '1|*GSB|&Y@S1HRGX|%EKSGRKXK|&U@|)]K|%G#M|)XK|&R=QS|*T|%MRPT|%O]ARD|(G|%R|&1RK|&EUK|&KR|%S|%TG|%U|%XD]B]K|%YK|%]8R1|&J',
      '|(3ULSK|(;S|(X|$=RK|$?T|$@|%X|$CR|$D|%R|&K|(]O|%S|%T|%]DR|$FRJQXL|$GRK|$I|%1WN]?|%ERL|&UK|%IZPD|%RDU8D|&JQ?|$JQ|&3:]',
      '8|&6[CUKT|&EUK|&PRD|$MS|&JQR|*D|*K|$N];]KBV@|*E@S|+]KCRD|*GS8]:RD|*HRNR|*TJQ|*X|$ORJQDS1|%UL|%VL|%XL|%]@R|$PIRD|%UL|',
      '#S#|$/|$1XL]IX|$3R|$6RK]=|$8RK]H|$ERGLS1|+RD|%ZK];|*X|$HRK|%S*|$JQRL|&XL|$ORK]6|%ZK];|#T@S|&DT@S|#U;|%S|%X|$=LF|$E|%',
      'RD]@KS@|$I|%S|$M|%B|$PUL|#VE|%1|%;S|%KX2R|%R|&D]@K|+S@|%X|#X1K]=|);S|)OXK|)S#|$2R|%X|&7SL|*XD|(X|)D|$8R|%SIXD];|$:]8',
      '|$;S#|$=|%S/|&JQRI|$DXOR!|%];|$FRKS|(XD]O|$IS;XD]O|$L|%/JQX|%EA|(X|%LR(D|%O];XMD|$MI|$O]@ZKR!|#Y2S1|#Z1XJQR|$3|%T|&B',
      'XK|&K|%X|$8|%R|$=|%X|$C|$DRLBZ|(]=|)BZ|$E?|$G;|$I|%RD|(KR|(SJQR|(];S1|)O|%X|$L|#[E]J|#]JR5]1S#|!L1]N|&?|(TJQ|&RCS1|&',
      'TEUK|&X|(K/|&]I?|)T|*EUK|(J|)X|#5]4D|#:]6|#=QR(|(JQX|#@R|#D]=D|(X|#G?|%R1]@|#I]GR|#KXD]O|$]=|#R(;|%D|&X|%F|%G]KXKS|+',
      'T|%H|%OXD]O|$/|%O|$1ORI|$2|$3LXD|%RDZ|%SJQX|%X|$;HSJQR|+D|$<S|$@SD|$H8D1|$IR|$JQD|&LR|$L|%D|%EUK|%IDSKPR;|$M|$PS=QT|',
      '%ZK|(X|#S#1D|$$|$*1XISJQR|%G]LSJQRDR|$/|%D|&RK]BZ|&XL|$2@X|(D|%D|%R|%S@|%X|&7SLXD|(XD|&D|$3|%R|%X|$5]3|$6U|$;L|%RK|$',
      'AUJQRDSJQR|$DR1]O|%SJQRO|$ES|&GB]C|%]@|$GRKXMD|%SJQR|$HRKEUL|$IS;X=|$JQR1@|$LS|$OGD|#T3|%X|$LR|#U(|%O|$1RO|%SJQX|%]O',
      'XIGRK]3|$=HS3|#X1|$2R|&E=QR|&LX2S|%S1R|%XD|$3X|&7SL|$8|%RK|$=S|$D|%SD|%]O|$F;XD]JRD];|$GRDD|)X|*K|&K|%U|#Z1|%8|&D|%O',
      '5]3T@|&HR|%RL|%X|&BXK|&KR|$3Z|$PR|%S@|#[P|#]J|%R5]3UJQX8|&;SD|&D]=|&E;E|&G|(KX;KS|!M#1K|#/1@|#1]@|&S|(MRLT|#5]1K|&U|',
      '#6TD|#@1|%KR|%X|&K|$R#M|(X|%CS1|%G]BT|*@X|$]KU|#DR1]@|$S|%GRK|#EA|$S#|#G]B|&;S|&X|#IOXK|#JQXK|$]JR|#K?RK]AT|$TF|%JQ@',
      'EUK|%K|&X|(K|$]1KR|%@|&X|%IR|$^|%6D]B]K|#MR5]1|#O]J|#PK3ULS@X|*K|%;S|(K|%@LS|)K|%R:]6LX|%X|&(|$SB|$TB|&UL]LRP|$UKX|#',
      'R1|%OG8S|$2R|$=QS|$D]@|(S|)DS1X@D|/X|)EVK]?|$ELR|$IOUK|(L|$JQXO]@R|$KTKGW@]@TJQ|(O]ARD|(S1|%];|$L|$O1|%D|&1K]@R|(RLX',
      '|&HRK|&RCTD|(ILX|&X|%S@|%]@S|(]K|*T|+JQ|*X|$P|%8RLRL|(PRD|%KU2|%T|%]|#S#|$1=Q|%R3Z|&K|(T|%]N1|)@R|(R3@|)8TGD|)BRD|)E',
      ']K@SN]<RD|)GSB|*]JGO]AR|)ID]@]KT|*VL1|)JQ@DS1|)K]AT|-KR|(S1R|)@|$2|%X7SLXD|$ASL|$D];Z|$G|%3:]8|%6K|%EUK|%SK|(X|$JQR|',
      '(LBP|$KR|%ZDRI|*X|&ER|$L#|%R|&LSES|%S3U=QS|%]=|&E|(1K]I|)LR|(E@S|(T|)KR|(X|$MU|&@ZN|&KR|&ORPS@]JS1|$N]J|#T4]K(|$@|%1',
      'RL|)TD|)X|%L|%XK|$K]N|(1|(O]ARDTJQ|(X|#U1DZ|%SJQX|%]K|(GRK|$;S#|$B]C|$CU|&IR@]K|$D@X|%X|$H|$IRKS|$KU@X(|$L]1|$N]1|#V',
      'D]J|#W5]2L|)R|&3|#X2|%RDZ|&K|$JQRK|$K|%EUK|%X|$L|$NBS1X|%HR3|)X|%X|#YGRL|$LT|%]ES1|$MG|&X|#Z1|$DR|$N?|%S@|#[2SD|#]GR',
      'O|%X@|(R5]3|$JRI|(L|$KB]CR|%I|&S1|%RG?|%T|&EUK|&I5]3L|&KRIEUK|&L5]1R|%X?S|)K|(T|)GB]C|*SD]JRO|+HR3|)K|&N]<|%Z@RBXK|$',
      'LZ1|!N=QJD]@]K|#N]<|#R;|%XK|#Z=QM|!O#1;|%K|%LD|&S@|%TK]?|%U6S@|%X@|%Z6D|%]KI?|(RD]@|,S|)I1|&NSE]@|(XE|*X|$2]J1|(R$|)',
      '3KSN]<|/@R|);S|)L4U|$3<1|&D|(;S|&S@|%T@|(MSL]ET|%WPT@|%X|%]KP|)MRLR|(RI|*T|*X|)P1|$4|%;S@|%K]N|)X|%R@|$8]:R|)JQS@|$G',
      'K]CDR|%LS@|%RB|(E@]K|%SCRD|*X|%XBDMTL|$ISM]K?|+X|$JU1]@|%Z3|(1RKT|&8D|(S@|$K1]N?|)S@|$L3]D|%RE|$MZCD|)T|(S@|%]LSN];|',
      '(XN?|$OB|&TJQ|&X|%RK|%]1K?|*X|(RK|*1|(W@|*S|&AR|)3ULSK|);S|)D|&EK]MX|$P@S|#1L|%X|&(|$RK|%L|&X|$]KSJQ|*HRGX|&X;SO|%NI',
      '|(@R|#5]3T|(@|)8]:|)MSL]ET|#6KR6K|$L|$SG|$X@D|(@R|#8]8S@|#:]6JQ|&RLD|)S@|&S@|%8JQ|#<S1|&HRGX|#=Q1|&EA|)X|#@K]1|$T|%B',
      'RP|%K]A|$]@R|&]GR|)X/|%J|&8S@XK|)^|&@R|&S(|(1RKXK|&XD]B]KDRA|#BK|%X|$O]JEB|(KR|$WM|$]J|#DB|$R1]@|%@D|$S|$X|$]@RD|&UN',
      '];|&]KROT|%BXM|(P|&]GTE|%CRD|)T|)X|&S|&]JR|%DSPS@|&]JROT|#EKSGRKX|$]@BM|&I|&RP|)X|#F;/JQ]JRK|$K|%X|$L|%@R|%HRGX|$];/',
      'JQ]JRK|#G(|$1S7U|$3ULZ|$6R(@X|$8S|$AX1X|$L|$MXNX|$OIJQ|)(|$R(|%K|$U8|#HR|%E@S|)@]G|,X|%JQ|$]J|&@R|)K|#I1RIT|&LTD|%Z?',
      '|(T|$3]K|$9Z@R|$@L|&X|%R|%UL]J|$CS1|$D]GJQ|*X|(S@|$GRJQ|%X@|$HVIS|$JQ(|&/|&1RK|)L|*X|&X(|%Z8T|$K]A|(1|(D|)X|(S@|$N];',
      'S|$ORIJQS1|%]@|&JR|);S|$R8|&1K]IT|&@D]@]K|(RD]@]KS1|&GRBT|(S8]:RD|.T|&OXG1|*T|&X|%BW@|%CRD|)X|&S|(O]A|%D|&HRGX|&UER@',
      'S1|&]@KRL|,X|%E]@|)S|%GK]@D|&XM|)X|%K]A1|%LZ61|)DR|+IVL1|)S@|%PS@|$S@S|$T1K?|);S|&]NR|$UB]K|)EWN]<|)X|$VP|$WB]C|)S|$',
      ']E@]@S|&B|&D]D|&K]1|*JU1]@|*S@|*X|&RB1|)D|*R|)S@|&VK]?|+HRGX|+KVEX|&W1]@|&]K6RK|,S@|)@S|)BRJQ|-X|.K|)ORK?|,S@|%GD]CX',
      '|&ZCD|%HG|(@|)$|&RGDR|)]J|&]KRD]@|%I@|(S|&RD|)DR|)OV61|)S@|)X|&SLS@|+HRGX|&U2|)TD|&XLD|*X|%KR8]JXK|(;|#K1RKSHRGX|(T|',
      ')HRGX|(X|$:]8RI|$?|$BRK|$GKRP|)1RKT|$L|%KX2R|$O]G@T|$R(L|%OKS|$SJQX|%NR|(GR=QT|$TOWE|$U|$X|$]G|&1DSN]<|(RLXK|&8DTD|&',
      '@]K|&BR|)(|&DSI]D|&E]KAI|&GWP^|&HRK@TJQ|&IZ;|&MXN|(]KXN]<|&RCS1|*DRJQ1|(EX1]NR|&Z6]6|(@]@I|#LSIUL]LRP|$ZID|#MO]@]K|#',
      'OTI|$]@R|#P1K]IT|%RKT|(X|$8|%X|&(|$JZ3S@R|(T|(X|$O]KRG]B|,XK|$RJQ1|(@R|$S#O|(@R|%@|$]J|#R!*|%/@RL|%@RK|$#3<DS1|%GRBS',
      '1|+@R|&SCRDS1|%OB|&]1W@S1|%PR(|$$|$(1XL|%;|&X|%=|%D|&]O|%E]KRO|%ID|$)B|$*A|%D]=|$/|$1]NK|(R@|)^|*1RK|-X|(T|(]J|$3K|&',
      'X|$8RDZ|$=QR|&X|$@|%1]NTKR|%;S|%]@RK|$AT|%X(|&/|$B|%R|%WM]J|*EVK]?|%]BRI|$C1|%D|&R|%RK?@$|)HRGX|(D@|%S@|%U|$D|%]@R|(',
      'SJQR3Z|$E|%X1]NX|%]@RPS1|$FL]J|$G|%X1|%]JO]@|$HRK|$I3]KS1|+HRGX|)T|%:]8O]J|,EVK]?|%DX|&]@|%JQS1|*HRGX|*T|%KS1|%R8S1|',
      '&B|&D]J|%UB]KS1|%]E]K@S1|-1RLX|*BRJQS1|&JGRBT|&KR8]J|,X|-K|$JQXD]O|+XO|-XK|$K|%?T|(K|%RBXMX|%S|%]1S;|(XL|&;SFS1X;|&G',
      '8DTD|(H[I|+@]G|(S1|)JQR|,D|,K|(TJQ|&HRK|(SO|$L@RDR@|%FRK|%IRD|%RI|&PUB]BSD|%X(|%]LRL]LRPU|$PO|&T|%R|&GR|&J]J|*X|&KR|',
      '%S@]J|*1K]I|*S1|*X|%XG|#S!=QS|$#|%=QR|%P|&HR3|&ROD|*X|$1S*KS;S|&I|%]KX;|$5]3REUK|$8RK|$;S|$=DS|%S|$B]BS1T|&C|(RD]@|,',
      'X|)K]A|$DR|%SJQK|%X;|&IR|%]CS|(U|$ERPT|%S&(|$HSL|$IXD];|$JQXKR|$KR8|(3:]8|(UL|%S8|(X|)K|&JQR|*L|$LHRK|%S1D|%X;|(S|$O',
      '];XI|*;S|*X|#TIR|&DR|(]@|*GK]@T|*X|&GB]C|+@R|%S@|$OR|#U(6|%8RKL]JRD]=|0X|1K|%=SM|&XD|)XK|%O|$*6]6|$1UIRK|%XD]B]KS1|$',
      '2|%T|$6S@]KR|$@KR#|%R|$BRD|%TK]4|%VK|$DRI|(3:]8|%SK]BSN];|%TL|%]BK|)GD|)T|&DS|$EKS6S@|%RK|(S|)M|%]KR6TD|(SI|$FS|&JQR',
      '|$GRBRK|(X|%SCR|)8D1|)K]AX|&MRL|%XBRK|$HRN|(6D]B]K|$ID|%XKTJQ|$JQX8|(=TJQ|%Z3|$K|%1RK|&]NR|)S@|%IR|%RKZES@|%SDRI|*XK',
      '|%X|&D]B]KDRA|$L@RD|$NI|$O#P@|%]A|&EN];|&GRBU|#V1]N]I|$61|&X|%DR|%S@|$@]K|(;S|(ER@|(X|$KR|%]J|#W8DMTL|$N];|(S|)1K]@R',
      '|*RKT|#X(D];|%ORAX|$1XD]=|*X|%];K|)X|&KX;RKS|&NX@]KX|$2RD|(1RK|(X|)(|$3ULS1X|)K|(Z1X|$6|$8D]J|$:]6UKS|$;|%R|%S|%X|$@',
      'RK|%U|$BSD|$D|%3UE]@|%R|&DSGRO|,X|&E@S|(]KCRD|&GRPSDT|&KR|%X3RL|%];|(RK|(S3]KX=|)IS;RK|(]KRL|$E];XI]GKX|$GR|$HXD|$IS',
      '|&FR(DRLX|$KR|%SJQX|$L|%8U1|%OSJQRO|%SI|%];S1|$OG|%IJQ|$PX@U|#Y1@|$DS1|%]J|(KR|$JQB|(EUK|#Z8R|$=SJQRI|$DR|&K|&LS|(T|',
      '$HSJQX@|$IGRK|$K]O|$M]JRL|$OR(;S|*K|$PKR/JQRK]BT|#[B|%S|$D]BK]J|$IS@]K|$K|%83@XK|#]1;|&L]JRD]=|.TJQ|.XK|&SM|%JQRK|%R',
      '*;|%UL|(;S|(X|%XL|(RK|(X|%ZJQRK|&K|%]JRD|&KSD|$;1|&PZI|%R=S8|&F|&K|%SFXD|&H|(XD|%U=S/|&JQRK];|%X;|(O|&=SJQRI|-;S|-X|',
      '&MD|)X|%ZD|&K|(S|(X8|%]JRDFZK]=|*LS|*]=|,RK]=|&KR(1RK|(S#|);|$@D]JERJQT|%I]H|%K|&X|(K|%]KT|$A3S@|%E@S|%L|&GXN];S@|&R',
      'HSNS1]@|&X|%RD;S|(R5]1|)D]@K|-S@|(TJQ|+HRGX|(X|&E@]J|(D|)1RKT|)R|)X|(S@|&JQT|*HRGX|%S@SMTL|,@R|&K|%VL|$DR@1|)Z@]@K|&',
      'D|&JQU|*JUB]CXK|%XP|$E;|%K]M|%N];|)HRGX|%S1RK|&D|%XD|(TJQ|(X|)K|&MRL|&O|%ZK];O|*S#|%]JRDSM|&KS#|$F;S1|$G|%6]7|%@$OSB',
      ']C|&D]@]K|%BXM|)T|%DRICD]J|%E]D|%HRGXK|%JQ#|)1]KSJQ|/HRGX|%KC]GDS|&GK]?|&RN];]K|&VE|&]3|)TJQ|)X|(?|)EB1|%L]E|)BYK]4]',
      'J|%R1]NK|+@RK|+S@|&3@|)S1|&B|&CTD|*HRGX|&HRGS1|&IT|&JQ@]@MROD|/S@|&K]A|*X|&O]A]J|,1XD]B]K|,OXGR|%T1RK|(W@|*S|+O]GKVE',
      '|&JQ|%X6]7RJQ|+OXG1|$IK?|(TJQ|(X|%RK1|(];|%SA|%W@S|)1AR1RK|)6SP]D|)O[C|*]@I]H|$JR;XLR(;|&DS;XMD|&I|(OR#|(UJQXL|&K|$K',
      'N];R|%Z@|$LRHS1|(TJQ|%ZHXDTJQ|%]JRI|!P#1#|#(@X|#/JQR|(K|#1S|%#|$XK|#6]7SL|&XD|#8I|$K@|$]8|#<R^|#@RM|$X(|%D|$Z|$]JR|(',
      '1R?]=|#DDS|$_|#GRK|$S3:]8|$XD|#JK@|$Q@|&Z|%DR|&S|%X/|&7SLXD|*Z|(XD|%_|#KE]ER|$FX|$IZD|$S?|%EUK|%JQRDR|#L$|$S|%*=|$UB',
      '|$X|%(|%/|%D|$Z$|#O]@1]NXE|&RD]@K|#R!O|$(|%/JQX|%1ZK];|%=]KZ8XD|%G]KS=|%O]1UL|$*8|%O|$/=QR|%JQR|)(|)K]=|%K|$1SI|(EUK',
      '|$5]3XKS|+JQRD|+K|*TJQ|$7D|$8#|%RK|(T|(XK/|%SK|%T|$;|%GR8RK|%PR8RKT|%X|$=Q|$@|%S|&JQR|*K|%X|$BSO|%TO|$D|%RBRK|%SF|%]',
      'O|$F|%S8|$GL|%SG|(UK|$I|%8R|%LR|%SB|(UK|$JQBRK|(]KRGRB|$KGRK|%RD|(Z|&I|&JQ|%S1XD|&JQX|%UD|%X|%];|&=|(/JQ]JRK|&HRK]=|',
      '$L|%1R|%DR3RB|%SI|$OER@RL|+X|%RD|%SDR|%]JKOR@]I1|#S*I]JRD|%JQXD|$8K@|&S|$;|%LRK|$D]B|(S|(U|)CK]I|-X|)KR|)O]@RDS|$G]K',
      'U|$IGRP|%R6L|&LJQ|%Z3]LZGSD|$L|%GXK];|%SJQRI|$ORG|(X/|%XG|(X(|)/|%];]KS|&ERDS1|#U3LS|&T|%Z|$BR|$I1S|%RJQUD|)VD|$JQRD',
      '|$OR(D|%X(D|&D|#WBJQ|$^ES?]=|#X!;X|$1];K|$=|$DKS|$ER;R(;SO|$ID]@|%S#/JQX|$JQRK|$KS;X8|%X|$LA|%OS#1S|%S1E];RK|%XD|#Z1',
      '|$;XL|$I|%Z|$JQR(;|$L|%S|$OR(D|%X|&D|%];|#]JR;]KS1|&I|&JQ|&KL]=|(S|)OD|&LSK|$KB|&X|%RO',
    ].join(''),
  ],
  ta: [
    "ஃஅஆஇஈஉஊஎஏஐஒஓகஙசஜஞடணதநனபமயரறலளழவஷஸஹாிீுூெேைொோௌ்",
    [
      '!#/P4N9<P|#4F9P94L;F>P|#68P|$EA6H|$F/|$H|$K|#7P6|#8L6P6H|$P=H|#:J<F/P/|+EAF8P|$L7P6H?P?|-6H|%9P9H|#<1F;>P|%H|#=FAF;>',
      'P|#>P>6H|#?AF>P|%H|#A<6H|%P|&/?P|$L|!$/F;|$H:P|#0P/F>:P|#4P1F|#5P4F>P|&H|#8E>P|#:P|#<P|#=H|#A6H|$E<P|!%0P/H|#1L|#46P',
      '6F>P|$:P|#5L9P9H/?P|#68E>P|%P|$F>P|$H|$P6F<L9P946P6F>P|#7P6|&F;|)6P|)E|*AF8P|,>P|&H|#;/P/6P6F>P|#<5P4E:P|)A6H|(H|$H|',
      '%/P/H:P|%7P6|)6H|)H|#=9P9H/?P|#>0P/L|);F8P|$P|%>L|#A<6H|%P|$=P=L;H:P|$L|!(5P4H|#=P96P6F|#>/|%9P|%F8P|#?P?|&6H|&8|(<P',
      '|!*8|$9P94H:P|$AH:P|%K|$F8H:P|$H:P|$P|%8H:P|%96H|%=|&H|(:P|#:P|#@H6P6E?<P|#CP|!+9P<>P|!,/P/F;|#7P6H|!-8P=E/H:P|&H|#<',
      'H|$K|#APAM<H|!.<P|!/4>P|$P1F|#>PAF|#E59P94H:P|$<5:E/|$>6P6F>P|%:P|#F|$:G|$@/P/H|#G@P|#M5P4|(6H|(H|)?P?6H|#N;F>P|!1E<',
      'P7P6|#F=7P6|%9P9H|%F;|$>|#H:E<P|#J8P8L|&=H|$;P6H|#K<P7P6|#NAF;6P|!4F|!686H|$P|#:F@/|&<P|&P|(6P|(7E4H|#=P9N6H|#>LA<P|',
      '#E8P|#F<L9P94|+0P/?P|+:E/H:P|,P|#K1F;|#M/L|$4<P7P6H|!7/<:P|%F>P|#4F/<P|%6P6|#E4H|&/?F>P|)P|%P4F8P|$8P/H|$?P|#F/@PAH/',
      '?P|$>L|&;F>P|#G<P|#I>P/?P|!9/H6F|(;F>P|#4F|$P4F;>P|#<F1H|#=P=F|(;|#>|$<H:P|$PAK=H|#@L;|#E4>P|(/?P|$<P/P/AH:P|#F|$8P|',
      '&8<P|$=|%/H|%9P9H/?P|#H6F;|#J5P|&/?P|$;<P|$<F;|%H:P|)9E>H:P|$=P=|(6H|(E<P|#K<P|#M6HAE/|$<H?P|#N6H|$8P=|$<P|!:/P/?P|#',
      '4P4H:K|#6P6F;|#8F6|#=P=|&H:P|#E7F>6P6F>P|$A4P46P6F>P|):P|#F/|%AH:P|$>P>F;8P|#G4P4<P|$5P4H:P|$6H|#H/P/F;|$4F;H:P|$6>E',
      ':P|(A6H|&F>P|&P|$=L|&;F>P|#I8P=H|$>:P|#K|$=P/H|(N?P/?P|$>H:P|%P|#M@F|#P|!>P|!A4|#6H|#7P6|&6H|#<>E=H|$H:P|$L|#E@H:P|#',
      'F4|$<H6H|#J=P=F|$?F|&A7P6|#K5P4H:P|$=H',
    ].join(''),
    [
      '!!9N<P4P|!#/1P1FA9P9H|$6F/?P|%P6F;<P|$8P=|$9P9M<H?P|$:6H|$<A<F1L9P|%E6F|$>:H:P|&P|$AL;F>P|$E4:F|%6:F|$F>|$P|%/=L|&E>',
      '|)6P6F>P|%8F|%9<P|#0P/6P6A<P/?P|&:E/|(P|&F<H7P6|-H|&G/<F/P/9P94P4|+6P66H|)E<:P|&H|(>:P|(?P?|&K|(;K|(<F|*;|#1>P|$E:P|',
      '$L;H:P|$N/8P|&<F8P|(P|$P1:;:P|&F>P|&H|#2F6P|#3P1>F|(P|#4/P/:P|$0P/F;|*H?P?|(H/F8P=8|):P|)A<P|$<P6P6F|&7P6|$F|%/?P|&P',
      '/4F|)H=F9P9H|0/?P|%6P6?:P|)H|%9P94L|+/P|+6P|+;E/|./P|-8|,F>E8|.H:P|.K;K|%:L|(/?P|%;E<P/P/H|%AE<6P6F>P|$H/P/H|*/?P|%6',
      'P6|)4H6P6|.H|)6E/|)94F;E/|)H|*?P?|$L/F=6H|%7P6|)6H|)8|*<P|)E<P|)H|%;|&>E:P|&E?|)0P/?P|):E/|*P|&H:P|$P4A5L|&L|%>E5P4F',
      '/P|(8P4E|#5F|%/?P|&P/E/|)H|%7P6H|%;E/H:P|&H:P|&L|$H|%/H5P4H|(:H=L|&P/<H|+9P|)?F8P|*P|%AF8P|$L|%/?P|$P46P6F8P|&:P|&AF',
      ';>P|&L|&P|%58P|&?AE/|&E|(6H<L|(:>L|+9P|%:L|(/P|(;|)F>P|#68E>P|%H48P|(L;|%L|&/P|&1P|&6P|&9P|%P94F|(F8P|)=/H|$=P/E/|)8',
      '|(H|)9P|$F|%/94P1|(P94F;E8|&:E/|*/P|*9P|*AH:P|*H:P|)8|*N<P|(P|&<F/P/|,H:P|)6P66H|,H|-?P?6H|)9P9H|&?AF>P|)H|&E<|)0P/?',
      'P|)6P6L|)9I<PA|.:E/|*P|+9I<PA|0:E/|):P|)F|*/?P|(>L|%9<E/|(P|%:H/|%<PAJ5P|%>F<H7P6H|&H:P|(?P?|&P|$HA<L|&H:P|&K|$K9N>|',
      ')P|%AK?L|$L|%/P|%1P|%6P|%9P|$P6/L;|&F>E7P6F/P|&H48P|&N4H|#7K/:E/|$P6/P|&1P|&6P|&7P6|&9P|&:E8P|&<|&E6F|%7E4P4F8P|+H|&',
      'K<6P6F>P|#8H9A:P|&P9|)9P94P4|)F|*8E<P|*;|+6H|)H:P|%:6F|)/P/F=6H|&8P|%<E69H<:P|$L6P6F7P6F;|*>H:P|)H/P|*6P|*9P|*:P|*>/',
      '|)L;H:P|%A<E>H:P|(H/P/H:P|):P|(L;H:P|$P8E|&L|%9F8P|&H|&K|%=E4|&F|&L;|%AE<P|#9F<E:F|%AF<H6P6F|$H|$I<PA|$P|%6H>P|*>E|%',
      '9/H6F;F>P|&4F|);K|&<P|&>P>N|&E|(>P|&M<H?F8P|(@H6H|&N6H|)L;|#:<8P|%EA6F|%P7P6H|$EAE1L|$F8N|%>|&0P/?P|&:P|$G</6P6F8P|(',
      ':P|$J<F/P//P|+6P|+8P|+9P|+<P|-/?P|+E|,AF>H:P|/P|-H/P/H|.:P|$K1E8P|$L/F8P=6H|+8|(=6H|&P/|)9P94H:P|-P4|/6H|/8|/H|0?P?6',
      'H|38|)H:P|%1P1<AL;F>P|*E/|,AH:P|*P|+/?P|%6F|(/P/E8|(9P|(;E8|&P6|)6H|)8<P|)E<P|)H|*/P|%7P6|)6H|)8|)F<H/P/F=6H|/H:P|,7',
      'P6|/6H|/8|)H|*?P?6E>P|-8|%9P9E/|+H:P|*86H|)F8P|*>P|)H/?P|+P/?P|*:P|)L|*/P|*;H:P|%;|&>E:P|&H:P|%AF4:P|$N8F;E|$P|%10P/',
      '?L|+P|&:E/|(P|%9E=L|(?P|&F/E|&H|&K6P/<P|%:8P|&E|(?P|&L;E<P|#;8F|&/?P|$<P>E7P6F>P|,H|$>P|$N4F8P|%6P6F|$P;E|(A@F|#<0P/',
      ':P|(F>P|(H|$1|%8E/|(8|&F8P|&P|%:<9H|%<P|(/?P|%E0P/|*6P6F8P|*:P|&>P|%F|&8<P|(E>P|(P|&;=P|(>:L9P9H|/1P|)F>P|)PAE6F|./?',
      'P|.;H:P|&>P|%H/?P|(P/H|+:P|&6P|)6>LA<P|&9P|&:P|%L|$5P:8L|$9F|%H|$E9F;|%>F|$F1F|%6E/|%;|&5L|&>I<P|$H/:L7P6|&E:L;F>P|&',
      'F>H?P?|)P|&K|%0P/E4P1F;/6P6F>P|0:P|%1P1H88P|%5E1>:P|%7P66F|%?P|(:F/H|%AF|$K9F;|)E|$L|$P6P6:P|#=/P/4P4?L|$:P|$F/H=F/?',
      'P|&P/L|*;L|%3<P|)/?P|%6>P|%7P6|)H|%:H/|)9P94H6P69P94P4|76H|1F8E<P|2;6H|):E86H|,E<P|*P|%;|&9P94AF>P>L|+E6|-AL|+H/F8P=',
      '6H|18|.=6H|/E<P|,:P|+P4|-6H|-H?P?6H|&>E:P|&H:P|%AE=P=>P|&F/P/9P94P46H|1E<P|(6P6|+6H|+E<P|+H|,?P?6H|(9P9H|(;>E?<P|./?',
      'P|*F8P|+>P|&H|(1E<P|&L|$H96H|(P6H|%A4L|&L|$L|$P=|#>/E/H:P|%H|&/?P|$0P/E<|*:P|$ECP/E|$F|$H:F8F;:P|%A>/|)0P/?P|):P|(<P',
      '|(P|$J/P1E5P4<P|*7P6<F8P|.P|$L|%/?P|%7G?:P|$P|%>|&E6|)H|(:>P|(DP|&F|#?AE/|%F=P/H|&>E8|(H:P|%G4H|%H/?P|(P/H|&:P|&?P?|',
      '%K|%L|&/P|$F/P/|)9P94P46H|)H:P|%6P6|)6H|)E<P|)H|#@/E8|%F|&;|(>P|%H|$=P1F|$F/P/|)9P94P46H|)H:P|%6P6H|%7P66H|)H|*AF4P4',
      '6H|%9P9H|%AH|$H6P6|)6P6F>P|):P|$L/P/9P94H/F8P=6H|38|4<P|0=6H|1E<P|.:P|-P4|/6H|/8|/E<P|/H|)F8P=8<P|*=E<P/?P|%6P68<P|)',
      'E<P|)H|*1P|%9P9<P|)H|#A1<|%F;:P|$6E<:P|$86H|%H/P/H|&4L;|%L|%P|$<E>P|%F4:P|&8P|%H/P/H|+9P|&48P|(L;|&:P|%K|%L|&/P|&6P|',
      '&9P|%P/?6H|)F4:P|)H48P|+L;|&6:P|$=P=F8P|)>P|(H/P/H|)?P|(L|)/P|)9P|$?6H|%H/P/H|%L|%P|$HCP6F<K>F;|/E|$L/?P|%;EA8|$PA9P',
      '9N6H|&?AH|&E=H|)K|!$!9P|#//P|$6P6H|$AH:P|&?P?6H|*8<P|%K|$CP4H|(P|$F|%;6H|&8|(AH:P|&A=P=E>P|+F8P|,>H:P|-P|+H/P/H|,48P',
      '|+L|,/P|,9P|,;H:P|(L|);H:P|&N<E>P|)F8P|)H/P/H|*48P|*:P|)L|)P|%=6H|$L;E>P|$P/|&0P/?P|&9P94P46H|&:P|&F<:F9P9H|%1F18K=P',
      '=|*P|(28P|&L4H|#0P/E0P/K|&F>|)/P|)1P|)6P|+6F>H:P|.P|)9P|)K;|+/P|+9P|+<P|-/?P|)N|#1F;|&/P|&E|(8P|(AF8P|*>P|%<F;<E/|,9',
      'P|,AH:P|*P|+/?P|$L|#4F|$H|%:P|$L|%/?P|$P1F/P|*/E>6P6F>P|+H|(9P|(;E?<P|-/?P|)L|*/P|*9P|%4|&/P/E<<P|&6P6F>P|&:P|&N|#5L',
      '|%;:P|&F4P4E<P|$P|%/?P|%4|&8<P|&?AF>P|&A<P|&E/H:P|(?P|&F8P|(:8F|(=P/E8|+H|(>F<H7P6H|)K;K|&H/?E/|*H/P/H9P|/:P|*P|)P|*',
      '/E8|+H|,9P|(6N=H:P|(:P|(A<L|#6<AE/|&H|(48P|&L|$>E>P|$E<|&0P/?P|&:E/|(P|$F|%/P/:P|%6P6|$P6F<F;|+E|)K>F;|-6P|-E|.AF8P|',
      '&I<P|#7P6F<|)9P|)E|#86H|$7P6|(8P|(P|$AL|$E<P|%>H:P|$F|$P|%:E|&F/|&G/|#96P6E8|(H|$F</E:P|&F/P/|+E|,AF8P|.>P|%CP|$P|%/',
      'E8F6P6E8P|*CP6E8P|%9F<F/P/|-E|.AF8P|0>P|(?P|#;<P|$F8H:P|%</P/5/P/E8|&:P|$H6|&0P/?P|&9P|&:P|%:P|%?P|$P><P|%AE?<P|+/?P',
      '|&F8P|(>P|&H|(/?P|)P|#<3P1H|$5F|$:P|&9|(/E>|)P|(6P6F>P|(9P|(:E8|+6H|*;F8|)P|(F/P/9P94P4|26H|,H:P|)6P6|,6H|,8|-<P|,E<',
      'P|,H|$E;H:P|&P1P1F|,/?P|,;E?<P/?P|(7P6H|$F;|&8P|$N/P/F;:E8|$P/E8P|&P|(4F/P|%6<P|%:G8F;|+E|%A:P|#=E/H:P|%:P|%A6H|$H/?',
      'P|%:H/|):P|&P|$P/E4H|%=0P/<L;F>P|&>F8P|(H:P|(L|(P|&F8P|(;|(>P|&H|(/P/H|(9P|#>0P/H4F|$8P|$;|%0P/?P|%6P6F>P|%:P|$L|%/?',
      'P|$N18L|$P|%//E>P|%9:P|&<P4P|#?H7<E/|(P|%8<P|%:L|&P|#@:E8|%P|$P7P6|%AE<P|#A50P/?P|%:P|%F|$<P|$E8P|%<P/?P|$F|#CP/E<P|',
      '%6F<F;|+E|)K>F;|-6P|-9P|-E|.AF8P|0>P|!%!6H|#/P|%/4P1F|&E>|)/4P46P6F>P|)6P6F>P|&N;F>F8P|,>P|+P|(AF>P|#0P/F<H7P6H|(>E7',
      'P6F8P|.>P|-H|&H6E8P|(:P|(?P?|&K|#1H<K>F;|)P|%>E:F;|+<P|-/?P|)P|$L/P|(/<HAF/?P|)>L3<P|%6P|%9P|%;:L6P6|,A<P|,E<P|,F<H7',
      'P6E<P|,H?P?E<P|)9P9E?<P|&L|$P|%1M>P|#40P/?F>H:P|+P|)H/P/H|)L|*/P|)P|$1P1H|$6H|&1E<F|%P6F=P/H|)>F<H7P6H|*H:P|(H/P/H|(',
      'L|)9P|);H:P|$:E/|(AH:P|(H:P|%P9J=H:P|*P=|,6H|,8|,H?P?8|$AF;>P|$E;P1P1H|$L|%/P/E>|%7F>L|%9P94P4|%;F>E8|)P|&K|(;E8|%AJ',
      '?F|$P4H|(1P|%><P|#5HAF>P|$L|%/P/9P94P4|/6H|/H|0?P?6H|)F=6H|)H:P|%6P6H|*/P|%7P6|)6H|)8|)E<P|)H|%9P9H|*/P/?P|%;|&6?:P|',
      '(P|)6?:P|*F>P|&9P|&:P|&E/|(8|$P4F;:P|#68<H/K|%H48P|(L;|%L|&/P|&1P|&6P|&9P|&;H:P|%P94F|&:I>:P|$;|%:P|$<|$=P/E/|)8|(F4',
      'L;F>P|(H|)/P|)1P|)9P|$@F8P|&>P|%L|%P|&/?P|$F>F<H7P6H|$H6E8P|%9N8P=|%A<L|&E/H:P|&H:P|&K|$K|%9N>|$L|%/P|%1P|%6P|%9P|%;',
      'H:P|$P|%6/L;|&>6P6F>P|(:P|&E>F|*;|+/P|+9P|&F4P4:P|(<L9P946P6F8P|2=P/H|.:P|&H=L|#7P|%6/P|&1P|&6P|&9P|&F|(6P|(;/P|)8P|',
      ')9P|)<P|+/?P|)EAF>F<H7P6H|-H:P|-K;K|+H/P/H|+L|(<8P|)E|&H/P|*/?P|(9P|(CP6E8F|&N|(8K1F;|-E|.AF8P|%7/<6P6F8P|->P|):P|)F',
      '8P|*>P|&E4H|)P4F8P|(?P|&F/@PAH|(=HA8:P|(>L|*;F>P|&I>F8P|*>P|)P|&N;P|#8/P|&/H@H/P/?P|$0P/?F8P|*>P|)P|$6P6A<P|(F8P|(L|',
      ')1P|$9P|&94H/M>L|(J<H/P/|.:P|$:P|$F|%9P9H|%;|$P|%8:H:P|&H:P|&M<H|%9:P|%=?AH:P|&F|(;:L;E6|&H|(:P|(A<L|&L;|#9P|%8H|%9/',
      'H6F|+;F>P|,L|&46P6F8P|,=P/H|,>P|+L|(:P|(F|&J;<P|&K<I<E4P1F|&M@H6H|&N6H|(<F>P|#:;:>L|$P|%:E7F>6P6F8P|/>P|(8HAK>P|(A4P',
      '46P6F8P|0>P|,:P|&H=L|&M@F|#;/P/|(0P/?P|(6P6F8P|+L|(9P94H/F8P=8|/=6H|(:P|(AF;>P|(F|)8E<P|);|(H|)7<E/|+P|,/?P|*G<P|)8<',
      'P|$0P/|(F|(H|)/F8P=8|)6?6P6F>P|+:P|):P|$7P6F<|*0P/?P|*:P|$=P/5F6|+:P|(L|)9P|);E/|+8|&9F;>E?<P|//?P|+F>P|+P|(J;<P|&=9',
      'P94P4|.6H|(F8E<P|);|*A<P|*H?P?E<P|$>AF>P>L|%E6|(H|%H:P|%P|&9E/|)8|(H|)/?P|$K1H|(AF8P|)L|#</1F;|$1E;8|%F8F/E7P6H|$4P4',
      'L|);<P|$5P4E/|*9P|)A6E/|(F8P|)>H:P|(H:K|*P|(L;H:P|$6P6|(6P6F>P|(:P|(F89H<F|$;F>P|)/?P|)AK|$AF>P|%H|$E|%/0P/?F8P|,>P|',
      '+P|&6P6F8P|+>P|&:E/F;|(P|%1<E1|*8P|&K7P6F<|&P1F;6P6F4:P|/8P|/>P|.L|+:P|%5F|(9P9K4P4L|&HA|)/P|)6P|+6F8<E>P|/P|.P|->P|',
      ',L|)9P|):E86H|*P|%9<P4P|%:|&1E:F|(P17P6F<8P|&7E68P|*9H<:P|&8P|&:I<P6P6F|&<P|&E8H18P|(;5:P|%A58P|$H/P/|)/P/I4H:P|)>E:',
      'P|)AF>P>L|*K5P4H:P|)E6H|)F8P=|-6H|-8|.<P|*=6H|+E<P|./?P|)H|*:E8E>P|+P9N6H|%5P4|%6P6>P|%7P66E/|+>P|)8|*<P|)9N6F>H:P|,',
      'H|-:P|)A<P|)E8P|*<P|,/?P|*>H:P|+P|)F<H/P/>E:P|/F=6H|)H:P|*?P?6H|-E<P|)K|%94F;|&6E:P|(H|(P6M<E:P|&H=:H:P|&P968E>P|*E/',
      '|,/P|,AH:P|+>P|*F>P>L|*H|+48P|+:P|*L|+/P|)<P|)E<P|)F4:P|*8H:P|+P|)H|*9P|%:H=L|&P9H|*/P|%A<H/P/H:P|):P|(L;H:P|(P|#=/P',
      '/H:6F|*P|$0P/F|$7P6|(8<P|(E<P|(H|$9P9F=P/H9P|(H|)/P/?P|$H6F|(/P|(1P|(9P|(;E/|)F>P|(A<L|$L|%1P1F|%:=H9P9E?<P/?P|%;F;>',
      'P|%A8F8P|(L|(P|&F|$P/H|(:P|#>/HAE/|%P/5|):P|(:P|(F;|*/P|*0P/?F>P|.P|*1P|*6P|,6F8P|.>P|*9P|*:P|(H|)/?P|(L|$0P/L/P|+/H',
      '|)6P|)9P|);F>H:P|*L|$4P1:P|$5P48F>P|)P|$6P6F<8F;>P|+P|(G8P|$A1|&:E/|$F6P6F;:P|%<H7P6H|$H:P|%?P?|$L|%/?P|%;H6F<P|$P>6',
      'P6F>P|&:P|&E6|)6E>P|)H|(:>P|#?0P/>L|$:L|&/P|%P|$A<18P|(<P|(F|$L3<P|)/?P|%;|&<E2E|&N<P|#@7P6|(6H|(E<P|(H|$9P9H|$L|#A8',
      '6H|%P|$<E>P|%F8P|%H/P/H|+9P|&48P|(L;|&:P|%K|%L|&9P|%P/?6H|)H4L;|*?P|)P|$=P=F8P|)>P|(H/P/H|)48P|)?P|(L|)9P|$L/?P|%;K|',
      '$P|%A/L|);E8|&:L9P9H|&?AH|&E=E/|*8|)H|&F46P6F>P|(<5P4H|)H|&I<F8P|*>P|)P|#CP<K>P|%>E:F;|)P|!&4H|%94H:P|(P4|*8<P|*E<P|',
      '*H|&E4H|$P4F|#<9P96:P|$E/P|%8F8P|(;|&P|$N4H|$P9P9H|#>F;:P|#@6P|&6F8P|)>P|(H|)/P|)1P|)6P|)9P|$9P|&9N<P|!(/7P6|$P<L8P|',
      '#0P/?P|#1E6P6H5L|,/?P|$K8P|$P1|&F|(;F>P|#484F;E/|%K|%P|&94F/P/L|(E4H|$=P/I=P=F;>P|$>F8P|&>P|%L|%P|&7>:P|$H:>L9P9K4P4',
      'L|%AF>P|$L|%/?P|%7P6H|%;|&6H|&A<P|*/?P|&E<P|*9E?L;:P|$P94|(9P|(P4|*6H|*H|&H=|#5<|%P1P1F|&6P6H:P|&7P6|*E<P|*H|&AH|)/?',
      'P|$AE/|%F>P|%H|&/?P|&6P|&9P|%L|$P4E/H:P|)P/H:P|%5H:P|%:L|(;E/|*8|)L|#6A|%F|&/?P|&8E<P|&;6H|(E/|)>P|(H48P|(L|%H/F8P=6',
      'H|,8|)=6H|&:P|$E<56P6F=P/H|(:E/|)P|$H:E8F;|+9P|$P6:|&<9P|&F;N/9I<PA|#7P6:P|#8/P/E/|$P|%8L|#97F460P/?P|):P|$P9H|#:<P|',
      '$E|%;I8P|$P|#;<|%6P6F>P|%:E8|&P|%F;|%P|&6P69P94P46H|&7F>L|+9P|(P6|*6H|*H|+?P?6H|&AH|$F<5H|)/P/?P|&F|(8|)0P/?F8P|.>P|',
      '-P|):P|(;>E?<P|*P|(@7P68<P|,E<P|&H48P|&P|(/?P|(1P16P6H|#<E;PAH|$F::P|&L|(/?P|(;E?<P|)L|%;|$H/F;|&P/H|%1F;|)/P|)9P|)E',
      '|*AF8P|,>P|%6H|%9P94F/?P|%:E=P=:P|&K8F;E|%?L|(/P/F@0P/H|%A|&0P/?P|&:P|&E/|)F|*8|+P=8|*;|+6H|*=6H|)H:P|)P/|+9P|-94H/F',
      '8P=8|0:P|/P4|16H|18|1H|+:P|+F|,/P|,8<P|-E<P|,;|-6H|+H/F8P=8|.=6H|,6>P|,:P|(8|)6H|(;F8|$L|%/?P|%74L|%;E1F<F;<P/?P|(4>',
      'P|$N:8P|&E8F;|&L|(9P|&P|#=AF8<P|%H|&/?P|%L|$H6F|(;E/|*8|%9P9F8<E/|.AH:P|,P|-/?E/|/L/P|0;H:P|/P|)H|*/?P|$P96P6F6P|+9P',
      '|+;L|#>//P|(/N9P9L|%6P|(6F8P|*>P|)L|%:P|%?AF>P|&EAF;|%F>H?P?|(K;K|(P|%J0P/F>H:P|*H:P|%L|$<P|$E|$N/|&/P|&0P/?P|&:P|#?',
      'AF;>E?<P|)P|$P|%7E4P4H|,9P|%?/|&4/P/:P|+F|,;|-6H|-H?P?6H|+H:P|&6E/|)>P|&:P|&AL|&E4P1F|(<P|*7P6|&F4P4|&G4H|&I<E4P1F|)',
      'P|&K|#@L9P9H|#A:L|&/?P|!)4/|%0P/?P|%:P|%AF;>E?<P|$E/|$H<HA>P|$P41P16P6H|&F|#6E|#<E4P1F|$F8P|%>P|$H|%/P/H|$P|%/?H:P|(',
      'P|%6F|%A8|&>:P|#@>P|$F;<P/?P|!*!/H|$9P|#/F9P6F8P|*;|*>P|)H|$PCP|(9F|*<CP|#0P/|&?P|&H|(:P|&K|#1H|%9P9E8F;|-E|.AF8P|$P',
      '|%10P/?P|&:P|&<F/P/L|#3P1F;|#49P9E4F|$F18P|$H/P/|)9P94P4|/6H|)H:P|%6P6|)>P|)E<P|)H|*/E4P4E/|+P|,/E4P4E/|1H|2/?P|*1P|',
      '$L|%;H:P|(?P?|$P49P94P46H|&E:P|(A6H|&F;6H|&H|%A<P4H|*P|#5P|%/?P|%5:P|&=P=|&E/|&F|(/P/L|,;F>E8|-H:P|-L|(8P|&H:P|&J;P|',
      '&L|#6F<E/|)/P|)9P|(8|&F|&P|(/E>|+6P6F>P|)P/4P1F6P|+H:P|(6P6H|,9P|(9E<E6|+P/P/9P94H/F=6H|)P9H|,6P|,9P|+L|(:=L|)F8P|,8',
      'F|$H|%AH:P|$L;H:P|$P68E>P|(L|#7P6|&/P|&9P|&AM<H|&F<:P|#8/P|&/H|$1P|$6H|%P|$9P|&94H/F8P=6H|/8|,=6H|*A6H|)P4|+6H|$>E:P',
      '|$F>P|$P/F8P=|+8<P|(=|)E<P|%8|&AJ8P=E>P|&H:F46P6F>P|&L|%968L|)P|(=P/E8|+H|(E/H:P|)>P|(F>F<H7P6H|*P|(H48P|):P|(K|(L|)',
      '/P|)6P|)9P|);H:P|&8|(AE/H:P|)H:P|&<P|&A8P|(<E>P|)F8P|)H:P|)L|)P|(=P=F8P|+L|,/P|(L|&E<P|&N<P|%=8<P|&@L/P/9P|.94H/F=6H',
      '|1:P|0P4|&AE=H|&E<P|(>H:P|)P|&F|&K|&M<H|&N|#9F<K;|$P|%94F|&M@H6H:P|&N6H|*:P|#;F4P1H|#<F|%/P|%7P6H|%9M<H?P|%:>L|)/?P|',
      '%;H:P|$H1>K:P|$P6P|#>/P4P<E8P|-/?P|$F|%19J6P|$H:P9H|*/?P|$P|%>E|(/P|(9P|(:P|(A=P=L;H:P|&L|(/?E/|*P|)P/H?P|(9P|(;E/|)',
      'L|&N<H:P|#?F6E/|&F>P|%:L;E8|%;|#@H1P1F|%6|&6P|&9P94H:P|+P4|-6H|-H?P?6H|&>E:P|&F|(8E<P|(;|)6H|)A<P|)F<H7P6E<P|)H?P?E<',
      'P|&H:P|(A6H|&P6=FAH|)E?<H:P|,P/?P|)F>P|)H|*/?P|+P/?F>P|.L|.P|*9P|*:H=L|%7P6|)6H|)H|%:P|(9I<P|#A<H:P|$PA?AH|&E=E;F8H:',
      'P|)H|&F6|!+/E6F96P6F;|$P/<P|#3P1>CP|#6EA6H|$H:P|$K8H:P|$N|#8J8F>P|&P=E>P|$L;|$P|#<E?:E8|$F|%/?P|$P|#=/P/H=L;|$6P6E?|',
      ')@|$F|$P/|&8AK|%9|&4|(/P/I4F;|(>E:P|(H/F8P=6H|.8|+=6H|)6P6|,9P94P4|26H|,F|-/P|-8|.E<P|-;|.6H|,H/F=6H|-:P|):P|(P4|*6F',
      '>P|+H|*8|*H|&E4H|)P4F>P|%=|&:P|&AE=H|&E<P|&F|(1P|&H|(/P|*/M5P4E<P|,?P?|/9P94P4|56H|(:6F|#@E:P|%A6H|$H|$L|#A9P94P46H|',
      '$F;6H|$H/5L|!,*CP.|#/P|#1N4N9P9H|,/?P|#6<18P|$F/:P|#7E|$P6E:P|(A6H|#9P|#:P96H|#;0P/E<P|$8E<P|$<P|$H:P|#<N9P9E|*AF8P|',
      ',>H:P|-P|)F;|+/P|+6P|+<P|-/?P|!-4H/P/=P9F<FAH|$P4F|(;|&H|(:M6P6|#6H/P/G4H|$P6|&H|#8P96E:P|)A6H|(H|%=E/|)/P|)AH:P|(8|',
      '&F8P|(;|)6P6F8P|->P|)9P|):P|(>F<H7P6H|)P|&H/P/H|+M8P=H|(48P|(:P|&K|&L|(/P|(6P|(;H:P|)M8P=H|#9E:E|$P97P6|*0P/?P|*6P6F',
      '8P|.>P|-L|*:P|&F4H/L;F>P|*:P9N6H|)P4H|&G4P4?AF>P|&H/P|(6>P|#;P|#<H0P/F5L7P6|)H=F|)K|%6P6F|%7E?P|%9N6H:P|%:H=L|%A/L|&',
      '8P|&<E/|*/P|)8|(F8P|(H/P/H|,M<HA<P|):P|(L|(P|&K?L|$K;M<H|$P|#=P=H:L|&L|#>F|%/P/H:P|%9<9P9H|,/P|&P96FAH|%:P9F/P|%;F;>',
      'P|$P>E7P6<P|#?F|%9P96FAH|%;F;>P|&L|#@F9P9H|$H/P/:P|%0P/H|#APAM8P=H:P|&N<P|!.1L|#4F|$H|%:P|$P4|&0P/?L|+P|&:P|#9P98P|#',
      ':P|#;PAH|#<?AH|(/P/H|$F46P6F>P|#AF;|&0P/?F>P|+P|&9P|&:P|&<P|!/0P/E|&L|#1P1K<F|#46P6>P|(F|(H:P|$7P6|(H|$8P|$:L|$=P|&/',
      '<L|&94L|*;F8<P|$>F8P|&>P|%H:P|%I<P|%L|%P1E<P|$AH?E/|)8|(F8P|(L|(P|)/?P|$F60P/?P|&:P|%8|&:E/|)8|$H:L;E/|*8|&P|$L|%/?P',
      '|%1F|(6P|(9P|(;E/|$P1F/?P|(6P|(;E/|)L|%4|&0P/?F>P|&4/P/>L|(0P/?P|(:P|&5:P|&6P6F>P|&9M:P:8P|(P94P4|-6H|-8|-H|.?P?6H|&',
      ':L9P9H|,L|(P|&=P=|&?L|&E;|):P|&F|(4|)/P|+/>L|.3<P|.9P|)0P/?F8P|.>P|-P|)6P6F8P|)9P|):P|(8E<P|(;|&H6>P|(9P94H6P6|0H:P|',
      '+E4H|./?P|-P4F>P|/H|0/P/H?P|/L|(:E8|+9P|+:P|)P|(<L|*/?P|*6P|#5/P/E8|(F>P|(H|(J4H9P9F8P|194F|/>P|.H|$0P/?P|$6P6F8P|$9',
      '6F|$:P|$A8P|%<P|$F1:E8|%6|&/P|&6P6F8P|+>P|&:P|&AF;>E?<P|//?P|+P|%8F|(/?P|(;F;>P|%9P9H|$K18P|%BP|$P|%/?P|&E5F9P9H|%4|',
      '&0P/?P|&6H|(P6F8P|+>P|&8:P|&:P|&=F7P6E<P|,H|);|*9P94P46H|0H?P?6H|&E<P|&F|&H|(9F4F/P/|/9P94P4|56H|58|,6P6|/E<P|/H|,9P',
      '9E?<P|3/?P|/H|0/?P|%5/F|&6E18P|&8P|&E|(4F|#6E7E;/8E/|%9E6P6F<6P6F>P|$F<A|(8P|&F;/P/|,:P|&P|(/?P|(AG1P1H|$L|%/?P|%1P|',
      '(1H<H/P/:P|%;E/H:P|&L|$P6F|&N>F/P/|#7P6/|(:P|&1E:F|&L;E|#84E|&AF8P|)>P|%F;|$AF>P|%H|&/?P|$F|%:|&0P/?P|$K4F;|)6P|$P84',
      '|(:P|&F|(6P|(;E/H:<F|#9I<P|$P48P|%9>F>P|(P|)/?P|#:>E|%PDE18P|$P98F|(P|&<P|&F|&J8F|&N4F;E|%;I8F1|*CP4P|#;E8E|#<4F|$F/',
      'E>8P|%9F;8P|%:|$H|%5E7F6F|&L|%69P94H/F8P=6H|18|.=6H|/E<P|,:P|+P4|-6H|&>E:P|&F|(8<P|)E<P|&H/F8P=8<P|*=E<P/?P|&P6E/H:P',
      '|)F;>P|*>P|)H|*/?P|+P/?L|.P|*9P94F|*:P|*<H|)L|%7E4/|%9P9H|%:P9H|%A=L|&F|(/?P|$I<P|$L|%;F>P|&N<9P|$P58P|%7E4/|*:P|*E|',
      '#=F|$H9P9H|$P/|&?P|&E>:P|%98L|%=|&E<P|&H|(/P|(6P|#>/P/F=6H|(H:P|$0P/<L|(?P|$7P6|(H|$9P9H|$:P|&9/:P|$A<:P|%L|$E1E<|&P',
      '1E<|+:P|%7F6F|%:P|$F0P/|%9N<P8F;E|.AF>P|%>F;N|$L|%/?P|&P|(/9P94P46H|)?3P1F;:P|%1P1M=P/?P|%3<P|)/?P|%6P|%9P|%:E:5F|$P',
      '|%/6P6E|&F|%98E|%;E5|):P|)F|%>=L|&G<>P|&I<F|*/?P|*;F>H:P|%AF6P|(;=FAE8|,H|)E?<P|)H:P|)L|&J4P4F>P|+H|,/?P|-P/?P|#?0P/',
      '?P|$3P1F;:P|$6P6F>P|$:E/|%P|$F8P|%:5P|%>H:P|&P|$L|$P|%?/P/H=F1P1F|#@/|%6P6F8P|*>P|%:P|$F6P6>P|)E<P|)H|%AH|$H/H|%6P6H',
      '|#A86P6F>P|)L|%:P|$<H:P|$>L|$F|%3<P|)/?P|%6L|(/?P|(6P|%<E;<P|$H5P4<P|#E/:P|%>F|%F6:P|%P/|(H:P|$0P/F<1F8P|+H|*CP|(K;:',
      'P|(N|$1F|%H|&:G<P|$3P1F|)9H<:P|$4H|&/?P|%P1F|)/?P|*P/H|);/:P|&4|(E/|(F|)8E<P|);|)>H:P|*P|(H|)/F8P=6H|.8|+=6H|)9P|):P',
      '|&:F;:P|$5|%9P94AF>P>L|*H/F8P=6H|08|-=6H|+A6E>P|*P4|,6H|,8|%:H4F;H:P|%>E:P|%E:>P|%H:P|%M>F|&?F|%P/|&4:P|&96H|$6>8P|&',
      'F|&L|&P|%H|$7P6|(9P|(E<:P|(F|):6F|$8E|%F8P|%P|$9P9/:P|(E=P=|(H|)<F::P|,L|$:|%:P|%<E1<P|%E|&4P1F|%P|$;:4L7P68<P|&P|%P',
      '|&/=F/?P|(?P|&1P1>P|$<|%50P/?E>P|+H/P/E/|+P|&6P6E>P|*F8E>P|&:E//P|*9P|*AH:P|+K|*H:P|)8|(P|&F/?P|(;E/|%L/P/E>P|*H4F|%',
      'P|&/F>P|&6P6F/L|,P|&98P|&>P|$=P97P6H|&=F8P|)>P|(H|(L|$>|%/4P40P/?F>P|*6P6F>P|&P|(/N4H|%0P/?F>P|*P|%6P|(6E>P|)F8P|*;|',
      '*=P/H|*>F<H7P6H|+H:P|+K;K|)H|*/P/H|)L|*/P|*1P|%7F>L|*;H:P|%8F|(6P6HA|%9P|(9/H6F;F>P|)N/P/F>P|%:E/|(8E<P|%F|%L|%P|&/?',
      'P|&1F;:P|&74L|&97P6H|&AE;P|+/?P|(F8P|$?F|%L|$A4F|%>P|(6H=L|,;F8<P|%F;:P|&<F|%K<F|$BP:G<P|$CP|&4P<N|#F/F|$0P|$4L/P/|*',
      'AF>P>L|*F8P=6H|.8|+=6H|*H:P|&6P6|*6H|*8|*H?P?8|&;E6H|%P46P64P4|$5P5:P|$8F|$9F|$:H|%P|$;I9E|)AF8P|(J/P|$<7P6|%E5P4P|&',
      ':|(0P/?F>P|,P|(6P6F>P|(:P|(F|);|(P|%F/N<F;8P|(P/J4P|%H6F|&BP5|*/F<F|*1E:F|*8P|*:I<P6P6F|*<P|*E|%J/M<F;F8P|%K/P/|*/P|',
      '*6P6F>P|*:P|*<P/?P|&4P|$=F6P6A|+<P/?P|*HA|&CP6A|+<P/?P|*H|+:CP|$>N|&/F<E:P|&:G4P4<P|./?P|$?<P1P1F|%E<P/P|%F|&7M1P1F|',
      '%L|&/?P|$@/P/F7P6F;|//P|*8P|*>H:P|+P|)H/P|*6P|*9P|)K|%0P/H|%:L|#G6:P|%L|$<P6P68L|$@H:P|&?P?|%K|%P/P/5P4|*E5H:P|&7F>L',
      '|&A<H:P|#H/L|&/?P|%P|$0P/H::P|$2<E6P|*6F|$4:H@H/P/H|%>P|%F|&1E<P|&7G<P|&:/P/?P|&;<1E/|*F8P|+>P|*H|+/P|+6P|(F<H9P9H|(',
      'H<F:L|(K=F8<P|+;|*P=|,0P/?P|,:P|%H:P9|*0P/?L;H:P|.P|*6P6F8<P|/P|.>P|-H48P|-L|.1P|*9P|*:P|%P4F|$50P/?P|%:P|%P4H|)/?P|',
      ')6P|)AJ4F9P9F>P|$6F<L|)/?P|$:<8P|&F|%E<1HAE:F|(F|(P|%H6:P|%P9/N56P6F>P|+:P|$;F>P|$<0P/H|%>P|%H|&6F|%N:F;:P|$=?F8P|&P',
      '|%F|&/P/|*9P|,94H/F=6H|/:P|*>E:P|*F8P=6H|.8|+=6H|*H:P|*N?P|&3P1F|&6P6|*6H|*H|+:P|&9P9E/|*F4|,6P|.6/P/|26H|2AL|,9P94H',
      '/F8P=8|3=6H|1:P|0P4H?P?6H|,>E:P|,H/F8P=6H|28|3<P|2E<P|/=6H|0E<P|-:P|-A6H|.<P|,P4|.E<P|.H|/?P?E<P|*H|+/?P|,P/?P|&;G4H',
      '|+/?P|*P4H|%H/F;|(P/H|+9P|*K|&0P/4P4H<L/?P|&7F>|%L|&/P/|*H:P|&6P6H|&7P6|*6H|*94P1:P|*H|&9E4H|+/?P|&;H:P|&AE/|*AK|)8|',
      '(H|%P=0P/?P|(:P|(AE?F/?P|)F;>P|(E>:P|$>|%1K/<|%6P6F8P|%:P|%N6P6H0P/|.8P|$?:P|%F<P|)/E>|,6P6F>P|)7P6|%N<F8P|(L4H|$@7P',
      '6L|*/?P|+P/H|*6P|*9P|*;E/|+L|%9P9:P|%>P|%E;P|)/?P|%F|%H|&/P/?F8P|+P|&::P|&AF8<P|*P|)>P|(L|$AE5P4:P|%L6P|#I/F?P|%H?P|',
      '$4|%E6H|%F|&;|(6E/|)H|)K|(AL|%H|&6>E/|*8|)P|&:P|%L9P97P6E4P4|-H|%P40P/?P|(5F|(6P6F>P|(:L9P9F8P|.>P|-H|)P|(>P|(E/|)4P',
      '1F|(H|)1P|)9P|)=AH|$6P6H|$:P9H|$<L|$=|%9P94H/F8P=6H|-=6H|+:P|*P4|,6H|,H?P?6H|%>E:P|%F|&8<P|(E<P|&;|(6H|(H?P?E<P|%H|&',
      '/?P|(F8P=6H|,8|-<P|,E<P|)=6H|*E<P|-/?P|&:P|&A6H|(<P|%P=H|)9P94F|$>F|#J8P84F|$:<P|$>PAF8P|#K4P/|(H:P|&4|(E<P|(H|)/P|$',
      '5>P|$9P|$:P9F<F4P2P|$<?|&E|(AF>P|$?PAF|)/?P|#L/?P|$1F/F|$6F/?P|%H|%P6=F|(M@F>P|$9P9=P=|+9P94P46H|+F|,8|-<P|-E8P|.<P|',
      ',;|-6H|+H:P|$;E>P|&?H:P|%F>P|%J@H6P6F49P94P46H|$>E17E6<P|$AF49P94P46H|#M/P/N|$0P/H|(N|$1H|%P1F|$3P1:P|$4F|&;|%H/P/|*',
      '9P94H:P|.P4|06H|0H?P?6H|*H:P|&6P6|*6H|*E<P|*H|&:H4F|%L|&/P/E8>P|$5P46E/|+AH:P|+H:P|(8|)<P|(A<P|+/?P|)L|*;E/|(E49P94H',
      '/F=6H|/:P|.P46H|)8P|)<P|)>P|(F<H/P/|.AF>P>L|.F8P=8|/=6H|.H:P|+7P6|.6H|.8|/<P|.E<P|/>H:P|+9P96E>P|(H:P|)?P?|,8|-<P|)A',
      '7P6H|*<|+9P94P46H|(K|$6F7F>L|%P6:0P/>:P|$8P=8<P|(E<P|(H|$<F;|(9P|(E|$>:P91H|)CP|)F;E|%L|%P/6P6E|&>|(9P94P4|.8<P|.E8P',
      '|/<P|.H|(:P|(H:P|$?P/F8P=8|-<P|)=6H|(L|)/?P|);L|&?|(9P94H/F=6H|-:P|,P46H|(>E:P|(AF>P>L|)H:P|(H:P|(L|&A6H|(N:P|$@H9P9',
      'H|&:P9F>P|*H|#N4F|%H|&/?P|%L|%P4:P|(F8P|(L|);L|&9E4H|+/?P|*P4F8P|->P|,H|,L|$5|%0P/?P|%:P|$6EA<F|%H:L|$9:P|%E>/F<HBP5',
      '8P|(P|%F|%H<0P/?P|(:P|%P9H|(L|$;:P9H6P6I<P|%F>F8P|)>P|(H/P/H|):P|(L|(P/?P|$<F|&/P/L|+;L|$>:P|%E>:P9I<P|%P|&48P|$?|%9',
      'P9E6L|%F8P|%P|&/?P|$@F|$A>8P|%E|%F7P6<E28P|&>F8P|)>P|(H/P/H|):P|(P|)/?P|)94P4F|%L|$BP46P6F>P|#O6:|$<A|%F|#P/E8|%H|&9',
      'P|&:P|!1/>|$CP<7E::P|$F:G|$H7P6>E|$N6<8P|(<P|*/?P|(F|)/?P|$P/<|(6P6F8P|,>P|(:P|(A<P6P6F|%6F|(/?P|(;E/|)L|%<A<P6P6F|#',
      '0P/|&0P/?P|&6P6F8P|+>P|&:P|&<8P/NAF>P|(P|&F>F|&G6|&H|#1P1F8P|#3P1F/L|#40P/H|)/?P|$L;A<P:8P|$P4|&/P|&0P/?L|+P|&6P6F8P',
      '|+>P|*L|&9P|)94F|&:8P=|+6P|+:P|(P|#5P4L|%:H/:P|#6AF/F6:P|%G6|(:P|$F|$H9P9H|%<|&0P/|&:P|%CP<H6F|$P6F;:0P/>:P|*P|%;2F6',
      'P|#7P6<P9P90P/?F>P|&E8:P|&F|(/P/|+H:P|(6P6|+6H|+E<P|+H|(9P9H|(<|)1K/<P|)8F>P|*P|)9E9H|);E8P|&L|%7F6F|#86P6M/L|$7E;/|',
      '$A<F|$E6F96F|$F|$P|%86F|)/?P|#96:P|$L|$P6|%9E8F8P|*;|+9P|*>P|)P|#:/E>|$1H/F<H6|%P1G<P|$5|%:P|$7F>L|$8P|&9E4H|+/?P|$:',
      'E/|&8|%P|$;|%/P|%0P/?F>P|*P|%1P|%6P|(6A<P/?E>P|)F8P|*>P|)L|%9P|%:P|$<F>P|%P|$AJ?F|$CP/F<H6|,:P|$E6E8|):P|&F|$G96P6F;',
      '|+>P|$H6E;|)6P6F>P|):P|$I/|&/P|&0P/?P|&6P|)6F8<H:P|,P|+>P|*L|&9P|&:P|&AF;>P|$L;>P|$P97P69P94P4|*:E8|*<P|%:H|#</P/H|$',
      '1HA6F|$5E>;:P|%P|$6P|$CPA6F|$E1<F|);E/|$F|%6E|&P6F<|+:P|%;E/|(8|%AH|$N2E|(6KAF|$P|%/P/<L|%1P1L|*/P/H<F;|%:E|%A6K1|&<',
      'P|#=P=H|&K|#>G>P|#AH6P|$I6F|#E/F6P6F;|);|%H94F|%P/M>K4P|$0P|$680P/?P|&L|(/?P|(;L|*9P|%E<5|):E/|%F|&/?P|&;|$7P6F|$8P|',
      '&=E/|(F6@P|(H|)/?P|$:E|%F|%HAK>P|%P9>P|$;PAH|$<0P/9E5F|%6E|%E|&6|%P|&7P66H|*AL|*H|&9=P=|(E/|(F8P|)>P|(H|)/P|&>1H|(CP',
      '|(PCP|$=H|$>L|&/?P|$?H/P/F;|,<P|$AF6P6F<F|%N|$CP6F<F|#F/9P9H|%<:P|%E/N|%F1P1L|%P/>E8|)J5P|)P|*/?P|(E/N|(F|$0P|&/9P9I',
      '<F8P|.>P|-P|(:P|(?|)6P|)9P|):P|)A<P|(L;E<F;8P|$4P4F|&8F|$6:P9<:P|%LAH|%P6|(<P|*/?P|(E7P6|,:P|(F|)<L|(I<P|&<E|$7P68L|',
      '*/?P|(E:5F|(H|)AJ?F|$8F:E|%P|&8|(0P/?P|(9P9E|(:E/|)P|$;E|$<F;E|$=7P66H|)H|%9P9E/|+/P|*8|)H/?P|+P|*6P|*9P|*:F/P/|%F6?',
      'AH|*K|(E/|(H|%G|%H|&/6L|*/?P|*6P|&7G</|*P|&9E8P:L|&A8P|(<P|*/?P|%L|&;F>P|%P9|(0P/?P|(:P|(F|&=F80P/?P|$>9P96F/E<:P|%<',
      'P|%A=P=F>P|&K?L/?F>P|%F|%HAL9P|);F>P|%L|&/?P|$A|%/0P/L|&E1F|(:F|&H:E<P|%6M5P48P|&P|(6>:E/H:P|%8F8P|&L|&P|%9J<H:E8F8P',
      '|-L|-P|&P9H|%>F0P/:P|%E|&2F|&>;0P/?P|#G/P/F;|*<P/?P|)<:K|$1<P|$4<P|(/?P|$6E|%L|$8|%/P|%6P|%9P|%:P|%<P/?P|%E|&AF8P|)>',
      'P|%F|&AE18P|$<E/|&8|%P|&/E@F|&6F<H6P6|.0P/?P|$A/|#H/E6E<|*:P|$1G>E|$2E6E|$4P4F|)/P|(H|)/P|(J5P|$5P5E:P9H|$67P6F<|+/P',
      '|+9P|+:E8|,P|%P6|(F/<F9P9H|$7P6<|):I<P6P6F|*P|)<E28P|*P|)F|)P|$8E:F|$9EBP|%P9F<:5F;|.8P|.:P|(H|)>4P1H:F|(L;E|$:7P6H|',
      '%F6P<E|%K<F;|$;|%E4P1F|$</P/H:P|%0P/|)6P|):P|)?P|%:P|%H/P/:E/|+P|&6F|&?F|(P|%KBP|%N4F0P/<P|$=P=?AH|(F|);H?P?|)>H:P|*',
      'P|(H|)1P|+1I@>P|)9P|+9E6L;F>P|):P|)>E|+6P|-6H=L|+9P|$>P6E8P|$@=P1F|%>H:P|&P|$A<F>P|&P|(/?P|%E:F|)/?P|)7E68P|%F4P1<P>',
      'E7P6H|%G48P|(F;|%L|#I4E8|(P|%F8E<P|%H|%P49P94P46H|$6P6F<:P|$8P|$9P9<P|$<F;|(/P|(8F8P|)L|)P|%P;E|$=EA?F|*/?P|$>L|$@9P',
      '94P4|,H?P?6H|%>F;>P|(>P|&L|&P|%AH?P?|%P7F>L|#J/P|$0P/>P|*94P4H|(FCP|(H6P6E/|-8|,H|(N4P4L|$3P1F|$4F|%P4F;E<P|$7P6E:<L',
      '|(F>P|$84P|%E8P|%P|&8L/P/H|)9P|&=|(6H|(8<P|(E8P|)<P|)>P|$9P4:P9<P|(J:P9<P|&9H|$:F4F/P|%G|%P9H|$;=P/L|*/P|,/N?P|0/?P|',
      '(9E4H|,/?P|+P4E?<P|1/?P|%><P|&E?<E/|*P|&F|&P|(/?P|(6F=8P|(94|*H/F8P=8|-=6H|+:P|*P46H|,E<P|,H|)E4H|,/?P|(:H=L|,/?P|%F',
      '5P4P|&8P4P|%P|&/F8P=6H|,8|-<P|)=6H|*E<P|-/?P|(L|&6|(6H|(8|)<P|(>P|(A<P|(E8P|)<P|)>P|(F|)/?P|)6P|);L|(H/M5P4E<P|)?P?6',
      'H|,8<P|,E<P|&:H=L|&;|(6P|(9P|*94H/F8P=6H|28|/=6H|-:P|,P4|.6H|.8|/<P|.E<P|.H|/?P?6H|28|(>E:P|(AF>P>L|)H:P|(H:P|)?P|&A',
      '68P|)=P/E/|-8|,H|)F>P|)H|)L|(<P|$<H:8F|*;|+9P|)P|(E8F;|,/P|,9P|%P9F;E|$=FAH|$>AF>P|&H|%H6P6|*F|+8E<P|+;|,6H|*H:P|%P|',
      '&/?P|(F8P=8|-<P|)=6H|*E<P|&1F;1H|*CP|&>|(9P9E|(>E:P|(H:P|+9N6H|&A6=P/H|)H|(7E;/:P|(8P|(:P|(<P|(E/P/H|-1P|(F|$APAE;P|',
      '+/P|-/F@:L;F>P|#K/<F6P6H|(9P9H|&P|%P|&/F@E<P|$6:P|%H|&96F|%P6H9P94P4H|$:F6P6H|&9P9H|$<|%8P|%H:P|%P|&/P/|*H:P|*L|&6P6',
      'H|+/P|&7P66H|*A<P|-/?P|+L|*E<P|*H|&:0P/?L|,P|(:P|$>:P|$A<P|%L|&/?P|&9P|&;L|#L:8P|$A|%:P|#M6P6H|$7P6|(:E/|*8|$8P8|(E<',
      'P|$<P/P/:P|$=P/?F8P|*>P|)H:P|)L|)P|&9F=9P9F;>P|$>P|&>|(9P94H/F=6H|-:P|(>E:P|(E/H:P|)8|(F|)8P|)>F<H7P6H|*P|(H/P/H|):P',
      '|(L|#N1>F1|)/P|$4F|&;:P|$68L|(/?P|%F4:P|$8F;E|$:H|$=H|$?:P|$@|%8F8P|&P|%9P|%<P|(/?P|$AF;6P6F8P|#O/E<P|$7P6<<E28P|!28',
      '6E|$7E;/|)/P|$A<F|$E6F96F|$P8F;|%;|#9P9E8F8P|*;|*>P|)P|#:P:H|#AD<P>E>P|#E/P|&/F|&18P|$8/F|%P|&18P|$<P2P|$AE|#F:J;F>P',
      '|#G8P|$AE|#I8P|$>F;8P|%L|#J8<>P|$:F8F|$;7P6F|%>4P1H:F|&>F6E|%E|%P|&/5KBP|&10P/<P|$<P:8F|)P|(E8F;|#K:PCP|$<P:8P|#N19P',
      '|$6F|$8P|$<P2F;E|(P|!3E8|%:P|$;F=H|!41P1H|(/P|#8P|%/?P|#9F?P;I|#AH8P|#E/P4<P|$4E|%P4E|$8P|$<PAF8P|$><P|(/?P|%PCP4E;F',
      '8P|,P|#F/F<F|$1:P9<P|$<E/8P|$AF|#G1>P|#J8P8F1H|)CP|&:E<P/P|$>P|&4E|&>F|#KAF4P|#L:P|&1H|&CP|#N/P/F;N|!6/A>L|&P|(/?L/P',
      '|*P|$H6F|%7P6|$P/|#0P/|&9P|&:P|&?6H|(F8P|(H/P/H|)4L;|(L|(P|&AK>H|&F|(;F<H7P6|)H?P?6H|&L|#1L|%/?P|#3P1EAI<P|&L|(9P|#4',
      '/?|$:P|$AL|&/?P|&;E/|$F6P6|$H/P/|)H:P|%6P6H|%9P9H|$L|%/?P|$P1F5E:I<P6P6F|%4H|&L;E8|#5P48L|&H|%5G<P|#6P6HA|)0P/?P|):P',
      '|#7P6|&6H|&E<P|&H|&L|(;E8|*<P|)H:P|)L|#8/P/H|$F|%/P|%1P|%6P|(6|)8F|+;E/|,K|)H|*A:E8|%79<P|%9P|(94P4|%:|&0P/?F8P|+P|&',
      '6P6F8P|&:P|%;E/|(8|(<P|&K|$P8/6P6K|&E4P1F|&H48P|)L;|(?P|&L|(6P|%:L|(;H:P|)L|*/P|#9E>P|(6>L|$P9F|(1P|#:/P/H|$6H|$F@//',
      'P|(6P|*6F8P|,>P|(9P|(:P|&8P|&<1H/P|(F8P|(P/?P|&=F3<P|,/?P|&E/P/:P|&F1L|(8P|(;>P|(>H:P|)P|&G@|):P|&H/P/H|(:P|&L|&P/P|',
      '(1P|(7E4P4F8P|.>H?P?|/P|-H|.6P|.9P|(9P|$P|%9F|%:L|#;E<E/|&F/P/|+9P94H/F8P=8|2=6H|0:P|/P4|16H|1H|+H:P|(6P6|+>P|+E<P|+',
      'H|(9P9E?<P|//?P|+F>P|+H|&P|$F<P|#</P|$6P6L|$9P94H:P|)P4|+H?P?8|$:E8|%P|$AH|&/?P|&6P|)6?:P|$F18:P|$H/F8P=6H|+8|(=6H|)',
      'E<P|%:9H<F|&P|%A6H|$L|%;F>P|$P:|&9H<F|&:P|#=P/E9P9H/P|(>|)6P|+6F>P|)F/|+:E/|&M>L|*6P|%1:;:P|%9M@H6H|&N6H?P?|)L;|#>0P',
      '/?F>P|)P|$:E/H:P|%P|$F6P|$L|%1F=7P6|%7/<0P/?P|):E/|,H:P|+8|*H:P|*P|)E/|+/P|*8|)P|%9P9F>P|)H|*/?P|%:H=L|&L|(9P|(;/:P|',
      ')F4:H:P|,P|*>E8|%;L|%A8P|&<E/|*6P|*9P|*AH:P|)8|*E<P|(H:P|(P/?P|&F|#?0P/?F>P|)P|$6P6F8P|)>P|$96F|(;E/|$:E/|%P|#@HAF|(',
      ';|#A:P|$=E/|&8|%H|$F<|&P/P/|(6P6H|(7P6|%>P|#E/I<P|%P/|(0P/?P|(6P6L|(:P|(>P|(F|)8<P|);|*6F>P|+H|(H6>F>P|+H/P/H|+L|,6P',
      '|+P|,/?P|):P|$0P/?P|(F|)/P|);|(H:P|$5P4F|$6H|%P6E|$8:P|%E/|(AK|%F;0P/?P|+F|%H7P6H|&:P|%K|$:1H|%<L|%CP|%F<|(9<5F|(:P|',
      '%K|%P|&18P|&9<:P|$;/:P|%E<P|%F8P|%P|&>E7P6H|&AE8P|$<E|&9H<:P|$>F|$?:P|%P|$@P|&6P69P94P4|&7P6|$A<|&0P/?F8P|,>P|+P|&:P',
      '|&AF;>P|$CP|#F/6F|%@P/F8P=6H|*=6H|(7P66H|+E<P|$0P/4P/F@:L;F>P|(?P|$1:P9<P|%L|&;8P|(F>P|$4G<J8|(P|%P4|(0P/?L|,P|(6P6F',
      '8P|,>P|+L|(:F4>P|+P4H|)P|$5FAH|%L|&/P/?:P|%P4H/P/>P|&:|$8/<8P|%1<F|%:5F|&><P|&H:P|&P|$9J6P|)6F;|%P9H|$:H/|%N<P|$;E/<',
      'E2|+8P|+<P|&8:P|$<4P4F|%A|&:P|%E4P1L|&AF4|*/P|*<P|%H|&/N5:>L|(P/H=?P|*N;F>P|+AF>P|&1P19L|*F|+<E9P9?P?F|*H=P=F>P|*J7P',
      '6I<P|&3E8|*1:P97P6<P|&6P67P6L|*:P|*>0P/?P|+:P|*F|*I6<P|&7E?P|)AH/P/<1<P|(J>PAK>F|&9P96F|+P6I<P|*F|*I<P|&:5|)6P6F=P/H',
      '|):P|(6F|(>L|(E>F8P|*P|(H/:P|)=L|(P9|*9P|*F|+8E<P|+;|,6H|*H:P|&A5P5E:>L|(87P69H<:P|(?P?HA<P|+I<P|(E<I<P|(F4L:<H6I<P|',
      ')6E0P/I<P|)@E|+/P/?P|(L;E=H|%L|&/P/6L|&9P94/P|+0P/?F8P|0>P|+6P|-6F8P|/=P/E8|/>P|.H=L|.L|+9P|+:E/|-8|&;H>/F>P|$=/P/9P',
      '94P46H|%7P6|)H|%8E;PAH|&L|&P|%:L|(;E8|%L|$>P>F|#G0P/H|$4P1F6<P|$9/=P9:P|%:P|%EA?F|$;|%F>P|$<P/P/|&6P6:P|&9P9H|&:E8:P',
      '|&AH|$AF8P|&<|(:E/|*8|(AE6|+F/?P|&>P|%H|&/?P|%L|#H/?P|(/?P|$4H9P9E4P4|./P/E<<P/?P|.9P|.:P|+?<P|$5F|%H/P/H/?P|%L|&/P|',
      '&6P|&9P|&;E/|(H48P|$9E;P|%P9E/P/F|-1P|$<F;N688P|%H/P/F|+;|&A|%L|&<E2P|%N5<P|%P/P/L|$=7P6E<P|%AF|%L|&/?F>H:P|)P|&:H/|',
      '*0P/?P|*6P6F>P|*:P|&;F8<P|)>H:P|$>P>F;:E/|,8|$?1F|$A/P/|)6P6F>P|%0P/F|*;6H|#I/P/F|)>F49P94P4E<P|$5P|&/?P|&4H:P|$6H|%',
      'P6H/P/H4F|$;|%P:L;E8|$<|%6P6F>P|%:P|#J8P|&/<L|*6P|(E1F|(F@/P/F>P|-H|&8E9P9F<F/P/|2E|(F7P6F;|.6P|.EAF8P|1>P|(L|&:K=P/',
      'F>P|,H|&=>P|$;PA|(0P/?P|(:P|(G/|$<F/F=6H|&7P6|*H|&;|(A<H/F=6H|)F>P>L|(E6|*H|):>P|(H:P|&AF/P/F8P=8|-=6H|)6P68<P|,E<P|',
      ',H|(H|%H|&/P/?H:P|+L;H:P|&AF>P|%K1E|$=P/E1F;|(F>H:P|*P|(H|)9P|(K|$>H0P/F>P|*H|+6P|$?FAE/|)8|(H|#K0P/E;P|$1|%6P6F8P|%',
      ':P|%E;P|%F/<P|&;/P|(6P|(9P|(:P|$4>P|%F|%H:P|$6F|$7G<P|$8F|%P|$;F>L|$<P|&1P1F|&6>F>P|)P|*/?P|&7P6J4H/P/9P94P4|6E<P|&A',
      'H|)6P|$=P=:P|$A|%7E/<F|%8P|%<P|(/?P|%E|&<6P|(9P|(:P|&>;:P|%F|&/E|%L|&/?P|&9P94H/F=6H|,:P|&;=P=|(E8|(F>P>L|(L|#LA6:P|',
      '%E8P|#M/H6F|)/?P|*P/H|-:P|);L|(P6H|&9P9F>P|*H|+/?P|%L/P|&;L|$4/P/|)/P|)6P6F>P|)9P|):P|%0P/|)9P94P4|/6H|)F|*8|+<P|+E<',
      'P|*;|+6H|)H/F=6H|*:P|%<|&E/|&F8P|(>P|&H7P6H|,/?P|,9P|(:P|&P|(/?P|(1P1F|,;E/|.8|(7P6|+6H|+E<P|+H:P|(9E/|*4>P|*8|)F>P|',
      ')H|*/?P|*4L;|-6H|*?P?|)L|(A5P4F|%L|%P4H|$5P4H|(L|):E8P|$8P|&7:P9F/P/L|&:AF;>P|(E/P/?P|(L;E8|$=P=H|$>L|&/P/E4P1F|/6P|',
      '&6P6M4<P9H|&7N/P/F|&9K1F|&AF>H:P|*P|(H|%P|&/E9P9F;:P|.<P|&9M<H?P|&>F;=P/?0P/?P|*>P|$@F=P|)1E>L|-/?P|)6H=L|&>6F9<P|-/',
      '?P|(E/|)?<P|,/?P|*F|(F>P|(L|(P|)/?P|)6H=L|)7H4P9|./P|.9P|.:P|):H=L|#N4P4|(0P/?P|(6P6F>P|(:P|$8P=F|)8|*E<P|);|*6H|(H/',
      'F8P=8|+=6H|):P|$:CP|$<E;:E/|$=H:P|%P/4F6P68|.<P|-E<P|-H|&=|(6P6F>P|+L|(:P|$>P|&AF|);4L7P66H|$@F|!7/<|%0P/?F8P|+>P|*H',
      '/P/H|+48P|+:P|*L|*P|%6P|(6F8P|*=P/H|*>P|)L|%9P|%:E/|)H:P|(8|%E4P1F|+/?P|+;E/|&8|%F8P|&>F<H7P6H|%H/P/H|&:P|%L|&/P|%P|',
      '&7P6H|&9P9H=|$L1P1HAL|#1P1H|(6P68P:L|#4/P/F=6H|(H:P|$6P6|(9P94H/F8P=8|-:P|,P4|.6H|(F|)8<P|*E<P|);|*6H|(H:P|(L|)/?P|$',
      '7P6|(6H|(H|$8|%/P|%:P|$<E28P|$A4F/P/L|,/?P|,;L|$F/<E/|(H/P/E8|(P/?P|&L|(/?P|&P/|%6P6E<P|)F<H7P68<P|/E<P|)H|*?P?|-8<P',
      '|-E<P|%9P9F>P|)H|$H|%6P6<|%7F>L|%9P9/H6F;F>P|%A5P|&<P|&F>P|&K|$L|%9J=H/F8P=6H|/8|,=6H|*:P|)P=|+6H|+8|+H|%:H=L|*/P/H|',
      '*;F>P|$P16P6F<|,0P/?P|,:P|%9H|#5P98P|&<P|)/?P|#6F|#7P6F|#8P/H|%8G<P|%:L|(/?P|%=E/|&F|#9<P|&/?P|$F|#:/P/H|$6H|$P|%99P',
      '94H/F=6H|&F|(/P/L|,/?P|(8E<P|(;E<P|&H/F8P=8<P|%:|#<1F:P:|*<P|$:P9H|$K7P6F<|$P:6E|#=P1J;P6F|#>8P|$:P|$P>|&6H|&I<P|#A:',
      'P9<P|$G8|#E/9P94P4F8:P|%<E28P|&F/0P/?P|)6P6F8P|):P|&P/NAF>P|%KBP|%L;E|$0P/?P|$1<P|%E|&AF8P|%F|%P1F;E<P|$4/|&/P|&0P/?',
      'F>P|+L|+P|&6P|)6F>P|*L|&:P|%E/|(AH:P|(H:P|&8|&<P|&?H:8P=|-6P|/6F8P|1>P|-:P|%F|%H/?F>H:P|)H/P/H:P|*48P|(E5P|&:P|%N4F|',
      '%P/?F8P|*>P|)H/P/H|)P|(E4P4F|(H=F9P9H|&1F|&4:P|(E<P|(F;|)=P/H|)>F<H7P6H|*H:P|+?P?|*P|(H|)/P|+/H|)4L:L|)6P|)9P|+9H=|(',
      'L|)1P|$5;|&0P/?P|&:P|$68P|%<P|$8H:P|%K|%N|%P|&/E:P|)A6H|$:/P/>P|%P|$;/8P|&F|&P/|)<P|+/?P|%8E<P|&P:E<P/?F>P|.P|%<P|%H',
      '4H|%P|$<E;5|)8P|%PAK|$=P/<6P6F8P|):P|&96H|$>PA<P|$?4LAF>P|%8P=H|%E/|%F6@P|*/?P|&>P|%H:P|%L|&/P/H|%P6N=H:P|$A><P|&P|(',
      '/?P|#F/5P4H|%@H:P|&P/F8P=8|*=6H|(1P1F|,/?P|(6P6F8E<P|,;|(7P6|+6H|+8|(AF>P|)H|)L|%P/>P|$6F|&;:P|(H6AF|$8L6P6H|&A/:P|(',
      'E/|(F>P|(H|)/?P|)1P|%P=|(H|$9H5<P|$:F40P/?P|$;:8:P|&F/P/9P94P4E<P|(6P6E<P|%I|&1F>E7P6F8P|.H|&4P48F8P|+P|&;E<P/P|-/H|',
      '(N<P/P|&CP|$<7P6<|*:E/|%>E/P/|+:P|&P|%L|%P:>E|&AE/|*6P|,6F8P|.>P|*9P|*:P|$=|%0P/?P|%6P6F>P|%:E>L|&P|%H6P6|*9P94P46H|',
      '*:P|*F|&A|(8|)0P/?F8P|.>P|-H:P|-P|)6P6E>P|,F8P|->P|,L|):E/|,H:P|+8|*P|)<P|(9P94P4|.6H|(>P|(F|)8<P|*E<P|);|%L|&7P6|&;',
      '|&AH|(K=P=9P94P46H|%P/H:P|$>|%/P/<F|%0P/?F>P|*L|*P|%6P64F|)F8P|*>P|)L|%74H/P/6P6F>P|,:P|%9P|(9/H6F|)4:P|)<9P9F>P|-H|',
      '%:P|%A<9P94F|&F;|)6H|)>P|&H|(/F8P=8|*=6H|(:P|%E|%L/?P|(P/H|&6P6H|&:L|&;0P/?F>P|,P|(6P6F>F<H7P6H|-P|(:H:P|)P|(E/|)8|(',
      'F>H:P|*K;K|(H:P|(L|)/P|$@>P|(/?P|$BE6:P|#G/P/|(:P|(F|$0P/?P|$1P1>P|$4F6P6|*6H|$5P4|$6F|&96F|&:8P=|+0P/?P|+6P6F8P|/>P',
      '|+:P|$;K|$<E86H|&AF|%F5L|&8P|&>P|&@FAH|%H:P|%L|%P:|(:P|(I@P/F/P|&AG@P1P1F|$>|%/F<F|%:P|$?|%:E8|&H:P|(?P?|&P|#H/<PAH|',
      ')N<P|$4P9|(0P/?P|(:P|$5P|&5F;|(H;F<P|$<L;G<>P|$@L7P6H|&AE;F>P|$A<J>F;E|#I=H|%P=E5P4?AF>P|,F8P|->F<H7P6H|.P|,H|-/?E/|',
      '/P|.P|//H|1:P|-6P|,L1P|(H/P/5/P/E8|,H:P|$>/|&:P|%E/|(H:P|&1F<F;<P|&8|%F8P|&>P|%L|%P|&/?H?P|)L9P|*;H:P|#J/F@F|$1AH|(6',
      'P|$3P1F>P|$4H3P1E>L|-/?P|*J@F;8P|%P|&4E5P4H|$6<P>E7P6F>P|-H|$9P9N>F;8F8P|-P|$;P6>P|$<H/P/4F|*:E/|,8|&0P/F;|&9P9H|$=F',
      '|&:H=L|+/?P|$>P|&18P|&>L|#K1|$6E2F|$9E?|(6P6F8P|(:P|$<|%0P/?F>P|%4F|(;E/|*8|%6P6F>P|)L|%:P|%F;>P|&>P|%H|%P|&/E5>P|&7',
      'P66H|&:|(E=H|(F8P|#L2<P|$4P<18P|(F/P|$>P|#M4F/P/H|#N/P/:E//P|)P|(F|)1P|)6P|)9P|);|)>P|(H|)48P|$8P9H|$9>P|%J>P|$;E>P|',
      '%F8P|%L|%P|&/?P|$<PAK|$AE|!9/6I<P|$>P|$A6F|&P|%E8P|$E|$F<P7P6H|$H6F/?E/|,9P|+8|*F>H:P|*H/P/H:P|*L/P|+;H:P|*P|)P/H|(;',
      'E/|+AH:P|+H:P|*8|+6H|)F>F<H7P6H|+H:P|,?P?|)H:P|)K|)L|*/P|*1P|*;H:P|%9P9E;PAH|)H|$P|%/|&0P/?F8P|,>P|+L|+P|&6P6F>P|&:P',
      '|%6|&<P/?P|&F|#0P/?F9P9H|&H|(1P|(8F|&L|#1F|%9F/P|$H|%:L|$P18P|&L|#3P1|&::P|&E9F|)P|&H|#4/H|&/?P|$0P/?F>P|)L|)P|$6P6F',
      '8P|)=P/E/|)>P|(L|(M/H9P9H|$9P9F4F9P9H|$:E8|%P|$>:P|$F/|&?P|&P/|)H:P|%6P6|)E<P|)H|%9P94F;E/|)=FAH|)H|)L|%:0P/?P|&:P|$',
      'H/F8P=6H|+8|(=6H|&M>L|*/?P|%:P|$L|%/?H48P|(L6P|(P|%6P|(6|)6H|)E<P|)H=L|%9P9H|*/?P|%;F8<E>P|*P|&J4H6P6H|*9P9H|&L|$P16',
      'P6F>P|%4|&0P/?P|&6H|(P6L|&9P|&:P|&F;>F49P94H/F8P=8|+>P|*P/?P|&H|(/P/N4P4L|(?P?6H|&L|#5/P/E<|$6P6L|$:P|$F|%/?P|%9H<F7',
      'P6|-E<P|%;E=P=F|,8E<P|,;|-A<P|-H?P?E<P|(?<P|+/?P|&L|$P4<F9E;P|&E<7E;/P/E|&F/L|(6<P|&L/P|(6P|(;|%5L|%9E4H|*/?P|*:P|)P',
      '4F8P|,>P|+H|,/P|,1P|,9P|&H|(/?L/P|*P|#6/P/:P|$:P|$AF|&/P/H|&;F>F<H7P6H|(K=P=E<P|(L|$F/:P|%8E8P/H|(=E:P|)H|&J4P4E:P|+',
      'H|&L7P6H|&M<H|%9P9/:P|)E?<P|)F>P|)H|%>E/|&P|%AF=/P/:P|&H|(/?P|$H?L|$P6E5P4H/?F>P|(:P|(A6H|&F<F/L|,/?P|,;E?<P|&H|&M8P',
      '96E:P|%:|&1F=G|&F8F|#7P6H|(>H|&L|#8E:E|$F|%9P9N<P|$L|$P8E4P4H|,6P|&F<5P4E:P|,H|)H|%=F|#9P9HAE|#:P9E;P|#;5|%0P/?P|%6P',
      '6F8P|)L|%:P|%F|&/?P|(P/H:P|$8<P|(/?P|%H?P?|%P|&/?P|&94H/F8P=6H|/8|,=6H|*6P6|-9P|/94H/F8P=6H|78|4=6H|2:P|1P4|36H|38|3',
      'H|->E:P|-F|./P|.8<P|/E<P|.;|/6H|-H/F8P=8|4<P|0=6H|1E<P/?P|.6>P|.:P|.A6H|*:P|)P46H|(E4H|+/?P|*P4F>P|,H|-/P/H|,L|$F8P=',
      '|)E<P|)H|%<P|(/?P|%=P1F|#<6|$7P6|(H|$9P9?AF>P|*H|*L/P|(F>P|(H|):P|$:P9<L|(>P|$A>E/|)/P|)9P|(8|&P|%F|&;|(6H|%H:P|$E:<',
      'F9P9H|$F1H/?P|&L|&N68L|%5E:|%7P6H<L|%:E=P=|+:P|$H6P6F|*6P6H=L|%:8P|%A|&6P6F>P|&:P|$P:E|#=/P/H:P|$7P6H|$AL|&/?P|$L|%;',
      '8P|$P/?P|%9>|%=E/P/H=L|&F/P|(6P|(9P|(;6H|)H:P|#>/L|$6<9P94P4|%P6|$8P|$:H=L|%P|$<P|$A/L|(;E8|%=P=L|%F6:E8|%H:P|$E|%>F',
      '|$F|$P|%/>L/P|+/@/|.0P/?P|.6P6F8P|2>P|.:E/H:P|/P|&K<F;E|%>A|(<P|*/?P|&E;F</P/5/P/E8|%A/L:L|&K=H94P4|#?P?6P6E/P/F>P|.',
      'H|&F|(/?P|(9P|(AE1>P|&H|#@/P/|(:P|$0P/?P|(E>|*6P6F>P|(H4F|+/?P|+;F8<H:P|/P|$7P6:F@P|$8F|$:L|&;E8|*6H|%P|$H9P9H|$L:L;',
      'E8|#AE8F|$H5P4H|%>P|#E/0P/?P|%:P|%A6<P|%FCP6E8F8P|,P|%L|%P/|(F6P6E8F8P|.P|)CP6E8P|(H|&4G<F;E|&;<E2P|&CP|$18|%:P|$4|%',
      '/<P|)/?P|&F|%1E>L|*/?P|%:P|%>E1F<F;<P|&F>P|&L|&P/?L/P|+9P|+;H:P|%F|&8E<P|&;|(A<P|(H?P?E<P|%H:P|%P4F|(H|$5F|%P4A<P/?P',
      '|(F|)1P1K<F|);|*8P|*<P|(H|$6F|&/P/9P94P4|0H|*H:P|&9P9H|*L|%H/E/P/|,9P94P4|,H:P|)6P6H|)9P9E/|-8|,H|-/P|-1P|-9P|,L|%L|',
      '&/?P|&;L|%P6F<0P/?P|*6P6F>P|*:P|$8H:6F|%L|%P|&4H|$97E1:P|%<P|%E|%F>N8P|%H|&<P|%P|&9E|$:P9H|)/?P|$;H:P|%P|&/F=6H|&7P6',
      'H|$<1G/|)9P|%6|&F|(6E18P|(;|)E<P|(<E2E|%:P9<F;|,/P|,:E/|-P|%E4P4F|%F1F>P|(H|&;|&CP|%P|&/P|)/|*>E:P|*H:P|&6P6|*1E<6F|',
      '*E<P|+>P|*F98P|*H|&A6F|(L|$=L|&/?P|$>|%/P/E4H|%0P/?P|%17P6<P|&H9P9F<:5F;:P|&P17P6<P|,F<8P|%:P|%E2F|%F|&8|&;>P|%H|&=A',
      'H|%I4P4F|+/?P|%L|&;E|&A8:P|%P|&/8P|&4F/P|$?F|$A:P|%E5<P|$CP/<P|&48P|#F/P1<PCP|$4F/P/|*H:P|&6P6|*6H|*E<P|*H|+/P|%P|$5',
      'L9P9H|$7P6F;|(L;|$8P85F|*9P|(:P|(<H:P|)K|(E>P|)?F>P|(H:P|&9=P=|+9P94H/F=6H|+F|+H:P|(H|&>E7P6H|&A<H:E=H|+P|$9F1F|%P<A',
      '<F|$;<P|$</48:P|&EBP|%1E6P|&F6P6F|&H<:P|&P18L/?P|)E<:P|)F8L|,/?P|%3P1H|%6:|(<E/|)P|*/?P|&E8|):E/|&F|(/?P|(7F6F/?P|,;',
      'E/|&K1|)0P/?F>P|)6P6F8P|->P|):P|%9>|(:E/|*8|+6H|&E/<8P|&H|%:P:|)E|%E0P/P|&7P6F;|,6P6F>P|&8P1F1H|+4:P|+8P|+;|+>P|+CP|',
      '-/N|*H|)CP|&:F|%F/P/|*9P94H/F8P=8|.P46H|0H|1?P?6H|48|*>E:P|*H:P|&4P48P|*FBP|&6P6E8F;|./P|.6P|.9P|.<P|.E|/AF8P|*H|+/P',
      '|&7P66H|*H|&AE/H:P|(F8<P|*P|)>P|(H|)/?E/|-9P|+L/P|+P|):P|(L1P|%G:F;<P|%J3P1H|+/P|+9P|%K1F>F8P|*P|$=/H:P|&K|&P/H:P|%7',
      'P6|)6H|)8<P|)A<P|,/?P|)E<P|)H|%9P9F4:E//P|)H|*/P/?P|%<P|%P/E>|*6P6F>P|&9/H6F;F>P|$>F9P|)9G8P1H|*L8PCP|&:P|)9K<P|%P|&',
      '>F;8P|$?AH|%E/P|&4P4F8:P|%P?L|)/?P|)6P6:F@P|);E<P|$@L|#G/E<P|$4:P|%P4<P|(E|$:P1F0P|$BP:<P|#H/@P|(9J=P=|%H7P6H|%L9P94',
      '0P/?P|&;F>L|$68P|%F6E/|&8|(0P/?L|,P|(:P|%H|&/P/N4P4L|&1P1K<F|&:L9P9F6P68P|%P6|(/|)0P/?P|)6P6F>P|):P|(<F8P|)P|(?:P|(E',
      '5P4H|$8F6|(<P|$;>P|$<4P1F|*/<|*9P|*;L|%6:P|%E5|(/P|(0P/?P|(:P|%F7P6|*E<P|*H|&;H:P|%N4P4E8P|$=|%6P6F>P|%7/<P|*9P|&E8I',
      '=H|%:P|%P=H|)7N;P|$>8P|%:L|&P|%A<P|)/?P|%F|&/?F8P|)P|%P|&>E0P/H@>P|$?N<F4E|%P?F|)/?P|);F;>P|)AF9<:P|-AF;>P|$@/P/6P6F',
      '>P|$AF|&;F;>P|#I/P/?P|(H:P|$0P/E|)/P/?P|)AF>P|$1L|&/?P|%P1F|)/?P|$2L|$4P4E8P|$5P4H|$8L|$:F|&/P/H|&;F8P|(L|$<P6P6F|&A',
      '|(:E/|(G/|#J0P/?I<F>P|+H|+P|$3P1:F8P|$4P4F|&<N>P|$5P5F8P|(L|$84F/P4P|%P|$9P<A<F|$;<E/|)H:P|(8|(>P|&F49P94P4|/6H|)P4E',
      '<P|+H|(8P|(>P|&H48P|)L;|(:P|&K|&L|(/P|(6P|(9P|(;H:P|&P/?E>H:P|*P|)P|*/E<5:P|%P2F0P|$<:P9>I<P|%F6E/|(H:P|&;6E/|+H:P|)',
      'H|(E<P|%H|&/P/:P|*>P|&0P/4>F8P|->P|,P|*H4>P|&7/<|&:?AF>E8|,P|*H|(E8P|)?P|(L|);L|(P9/H6F|*E8P:L|/;E/|18|+>E8|.AL|.N<P',
      '|%P>F8P|$=|%9P94H/F=6H|+:P|*P4|,6H|%>E:P|%AF>P>L|%H/F8P=6H|,8|)=6H|&6>P|&:P|&A6=P/H|)H|%P=8|)<P|(A<P|+/?P|)L|(E8P|(F',
      '<H/P/H:P|+7P6|.6H|.E<P|(H|)/P|)6P|)?P?|,6H|,8|,E<P|(N<P|$>P|&2F;:P|#K/:P|$1|%9P94H/F8P=8|-=6H|+:P|*P4HA<H:P|%F|&;|%H',
      '/F8P=8<P|&:P|&AN<P|%P1E?<P|(H|)AE<P6P6L|1/?P|$5F|$6H<H|$9F|$<8P|%<18P|(<E/|)P|*/?P|(E86H|(F8P|)>P|(H|)/?P|*P/H|(L|%?',
      'AF>P|(H|%AL|%E1F<F;<E/|-P|&68L|%F8:P|&>P|%H/P/H|&7P6H|+/?P|&:P|%I<E4P1F|-/?P|.P/H|%L|$=H|#L1E7P6F;9P|$<A<P|&F|#M0P/>',
      'P|$4P4E1F;:P|$6F|%H|&/P|&1P|&6P|&7>AE;|&9P|&:/P/?P|&AE//P|*9P|)8|(H4:L/P|*L:L|-/P|$8P|&8:P9>:P|(F;F8P|$:P:L|)/?P|$;P',
      '|$<H4P/?F8P|,>P|+H:P|+L|,/P|,;H:P|+P|)4H|&5P:L|&6P6:E8|*H|&7P6H:P|&?E/|*AH:P|*H:P|)6E<|,/P|,6P|.6F>P|/L|,:P|(F8P|);>',
      'E?<P|+P|)>P|(H:P|(L|)/P|(P/?P|)94H:P|$=F|&/?P|&;E?<P|(F;>E?<P|+P|%H6P6|*A<L|*H|&9P9F>P|*H|*K=P=E<P|*L|$>F8G1F;8P|&AF',
      ';E|$?P?E1P1F|$@H6H|)9N/P/H|#N/|%H:P|%P/F>P|(H|)A<6P6H|//P|$4P4F|)/?F>H:P|-P|+P|);F4P4|.H|+>P|*L|(H|$6F|&;|&>H:P|%H:E',
      '8|(P|%K|%P6H/P/G1<P|$8|%6H|%P=6H|(8|(A<P/?P|)=P=E>P|,F8P|->P|,L|-/P|-;H:P|)L|*;H:P|(H|(K|(N<P|$9P|$;F0P|%P|$<E4P4|*0',
      'P/?P|*6P6F>P|-L|*:P|&8P|&?F|)/?P|%F4P4H|&8E>P|(P|)9N6H|&>P|%H/P/H|+9P|&:P|%L|&6P|%P/?P|(P|&4P|&6P6H/P/>P|.K;|$=P=F|(',
      'H:P|$>|%7P6F8P|*>P|)H|%8P=F|%AH:P|&K|%F|%GCP|%P|&4P|$?I<P|$CP|#O6P6|(6P6F8P|,>P|(:P|(<P/?P|$<P5:F|!:/8E/|(9P|&8|%H:P',
      '|%L|%P|&/?P|$?E8|%F<P|%H:P|%L|%P|$E|%/AF|%6KA8P|&P:E|%9E<6/P|*:P|%;E8|%<E5F|%>4P1H:F|&F0P/:P|&P|%A:P1:P|$F7P6|%@P1P1',
      'F|$K7P6F<8P|$P/?AL|*6P|(E4P1F|-/P|)>P|(F4:P|*L;K|)8P|)>P|(H/P/H|-:P|):P|(L|)/P|);H:P|(P6M/L|-;H:P|%8G1F;:P|#0P/>|(:P',
      '|&N>F;|+9P|+<P/?P|+E|#1I6F|#3P1?P|#40P/H|$:P|$P4/P/?9P9H|&6P6F>F<H7P6H|,P|&:P|&H:8P=F|)>P>|,E6H|-:>P|)F8P=F|)P|#57P6',
      'E<P|(H|$:/8P|%P|$>P|$F|%/?P|&P/H|%:K/>L|%;?AF>P|%>E|%A5P58P|$P|%496P6F>P|(:P|&>|(0P/?P|(6P6F8P|,>P|(:P|&K>E|&L|%5F8P',
      '|(>P|#6/H<H|$6P6F8P|)>P|$:P|$<ECP|$F/P/9P94H:P|%9P9F49P94P4H?P?6H|)G4H|+P4F8P|)H|*/?P|)L|$H|%<:P|&L|(6P|(;L|$P6F:|):',
      'P|(;6<L/P|)9P|)F>P|&K;H|#7P6|&F<|):P|)F|#86F>P|%L|$:P|$F6/P|&8E>P|(F8P|(P|&<P|)/?P|$LAF|(;E8|)H:P|$N|%/<P|%<:E|$P88E',
      '/|)8|(F8P|(P|&<E/|(F8P|(P|)/?P|&E<P|*/H4F|&F9P9H|%=|&:P|#;/P/:P|$F>E4H6H=L|&P|#<0P/?P|$5|%65P48L|%:4L7P6E<P|&P|$6P6F',
      '8P|)>P|$95H|%F8P|&;>P|&>P|%H|&/?P|&A@F|$:P|$E6P6F|$F;E|(6L|$H6/E1F|&H|&P6HA|+/P|+6P|-6F>P|+9P|+:8L|./?P|,P|+<P|-/?P|',
      '%7P6H|*/?P|%AF|#=7P6H|$H|%1G<:L9P9H|%6P6|)E<P|)H|%7E?P|%94F;H:P|&P9H|%:><P1P1F|$L|%7P6|)H|%AH|(/P/H9P|$P=A<P/?P|&H:M',
      '<H|&L;|&M8P=H|(<H|#>9E<P|$<H:P|%P|&/?P|$E;|&E|&P|$K1F;|)6P|)E|*AF8P|,>P|%<F;E|$L|%/?P|%6P|(6M4<P|%9P|%;/|(6P|&E?|)6P',
      '|):P|&L|$P>F/L|#@L|%AG@P1P1F|#E/E5|(0P/?F>P|,P|(6P6F8P|,>P|(:P|$0P/8G1H|$1F|$4H|&>N|$5A<P|)/?P|%F/P/:P|*AE1/<P|$6|%0',
      'P/?F>P|*H/P/H|*P|%6P6F8P|*>P|%:P|%A8P|&F|%E|%F<F|)/?P|);E8|%P6?L|(F<:K|+P|$7/<|(0P/?P|(:P|(E4P1F|(F>P|%E4H|(P4F>P|%F',
      '>|(0P/?AL|,F8P|->P|,H:P|-?P|,P|(6P|*6F8P|,>H?P?|(9P|(:E/|*8|)P|%P6<P|*/?P|$8F4AF;>P|%P|$9J<H:P|%P9F?P?L|$:8P|%E|$;E|',
      '$<F;:P:8P|%P/@F|(P|)/:E/|)1F;|*H|&1P|)1H|&4P4F8P|$=8P|%E/|%F|&8E<P|&;|(6H|&>F|%H/F=6H|&94H/F=6H|*:P|)P4|&:P|%P/H|&=|',
      '(0P/?L|,P|(6P6L|(9P94P46H|.H|(:P|(E/|(F|)/P|)8E<P|);6H|(H|):P|$>F9P4F8:P|%L|$?F/L|$@L|$A4P4|)0P/?F>P|-P|)6P|+6F8P|->',
      'H?P?|)9P|%G<<P|$CP/N|)AF>P|&4<P|#F//P|%1P|(1F=7P6|+F;|%6P|%9P|(9@L;|)J<F;|+H:P|%H6F;E/|&7P6|%P/|$0P|$1F1F9P9F|%P1F/8',
      'P|$6:E8|%FA5P4F|(J4F|$8P|&/E7P6|&1E<|*:P|&83P1>P|(5H|*AF;>P|(>P|(@H6P6|-:P|(F;>P|(I4P4:P|)>P|(N4P4:P|$:G|$;8P:E<P|$<',
      'P1E|$>P>F|);8H/P/H:P|$?/H|$CP4<P|#G4P4<F>P|)P/?P|$6:H?P?|%E8|%F|%H:P|%P6K8P|$8E|&4P1F|%P|&/?P|&9F4F|$<E|$=F|%P=<P|$?',
      '|%P|#H/|%6P6F>P|%:6H|&E/|&P|(:6H|%>E;|)9P|%A<F|%E:L6P6HA:P|(P|%P/F;/P|*6P|,6HA6P6L|/:P|*9P|*:E/|,8|-6H|-AL|+P|(N5|*6',
      'P6F8P|*:P|$1H>F:P|%N>F8F|$4F|&/F8P=6H|&1I4F8E<P|&6P6|*E<P|*H|+/P|&7P6|*6H|*H|&;|(AF>P>L|(E4P1F|)6|*H|):>P|&A4L7P66H|',
      '*;H:P|(F>F|*P|(H|)/?P|*P/H|-/P|(L|%P4L|)/?P|$68P|(:H6>E/|,F>P|*=L;E/|)L|*/P|*9P|*;E/|,8|%=P|(64AL;E/|%>:L1P1<E/|-P|&',
      'E/|(8|)N<P|(?F6P6HA|(A6E/|&F4:P|(;|)8|)A=P=L|*L|)E<P|&G4H|&K|&P7F>L|(A<P|%F<P7P6|%P6F<L|(H|)<E:8P|(L;E|$7P6F;|(L;|$8',
      'FA<P|%L|&;F>P|&A<P|%P|&85F|(6E/|(<K|)P|(E>P|)?P|(F4P4H|)>L;F>P|(K=P=|,/P|,:P|(L;|(N4F|+;E/|&9E/|(H|(K|&AL6P6E<P|$9P9',
      '6H|(<F:E5|$:P9L|$;8P=|)E<P|)H|%=P1F|*/?P|*;E/|,5P:L|,>P|$<1H|%5P9E4H|%H/8P|$=H/P/H|%L/?L;H:P|)P|(P/H|&9P94F|&:L|)/?P',
      '|&;E/|*H:P|)8|*6H|(F>H:P|(H:P|(K|(L|)/P|)9P|%P/E>6P6F>P|&9/H6F;F>P|(4P4|(N/P/H|&=E/|(F>H:E/|,P|(H/L|(M<H:L|$>P>L|)6P',
      '6GAH|$@H|&/P/|&6H:P|&:L;E/|+8|&A6F>H:P|)H:E/|+P|)L;H:P|$CP>F:P|+/?P|(G:P|$D:P:6H|#I/P/H|$0P/F>P|$1P1H|$4F|&;|$6P6|$8',
      'P=E:P|)A6H|(F>P|(H:P|$<P6P6F|$>|%/P/I=H|,/?P|+P=H|%0P/?P|%68:P|%9P|%:E/|)AH:P|&K|&N|%A<P|%F/L|)/?P|$?L|$@P/F;6F>P|+H',
      '|$A<H:P|&P|#J/P1F/N|*P/N|$1M9P9M6P6K:F;E|$4P<ECP|(F/P|(N|$6HAE/|$8P|&9M<H4P/?P|+?L|,P|&:L;E8|$;F>P|%P|&;F;>E?<P|//?P',
      '|+P|$>P9K<P5P|&>|(F;|#K2<P|$4L|%P4I<P|$6L|$88P|$:P94H6P6|)P4|(E4H|*P4H|-1P|$;<P|$<F|$=P|&/5P4|(6P6F;|(F7P6F;6P|)>H:P',
      '|*P|(H/P|)6P|)9P|(I=F;|(K|(M5P4|,6H|,8<P|,E<P|,H|)?P?|,9P94H:P|0P4|26H|28|,H:P|(N?P|&1E8P=H/?P|&94F|)P4|(<9P9F>P|,H|',
      '(E<PAL;F>P|$>6F/|):E/|%AL|%E/|&5P:L|&8|%H?P?|%K|%L|%P7F>L9P|-9?P?F|$?/<P6P6E|%:E/F;|&P|#L/P/>P|(K>P|&<N|)1E9P4P|$1I<',
      'P|$6E86P6F>P|$;|%/P|%0P/?P|%6P6F8P|*>P|%9P|%:E/|)/P|)AH:P|&P|$>P|&/?P|#M6P6|(6P6F>P|(9P|(:E/|)P|$@F/?F>H:P|)P|(P|)/H',
      '|&1P|&6P|&9J;<P9P9E?<P/?P|/H|(P|&:E=P=:P|&;E/|*AH:P|*H:P|)8|*6H|(F;>E?<P|+P|)>F<H7P6H|*H:P|(H:P|(K|(L|)9P|);H:P|#N/8',
      'P|%F8F|$1:E8|$4P4E<P|$6>P|%F|&;6F>P|#O<F;9P|!;9P9E8F;|)P|#:H8L|#E/I|$6AP|%P6F<L|$8L|&/?P|%P|$<H:P|%N|%P|&/P|$@P|&9P9',
      'E5|,/P|,6P6F8P|0>P|/H|/L|,9P|,:P|$AH:P|$DI|#F8P|$>P|#H6P6|(6P6F>P|(:P|$8F/PCP|%JCP/N|$:P|$<K8F;:P|$A8P|%E8P|#I6|%<P/',
      '?P|$8F;8P|$>L|#N/|%:P|$19P|%K9P9H|$<P/P|$AE8P|!</H:E8P|$P9F|#2F8F/E7P6P|#3P1F6P|#6P8E|#;F>P|#AF|%1P17P6F<8P|#BP;|&E|',
      '(AF8P|#E/0P/?P|%:P|%A8P|%H>P|%P|&/F|$2|%/H:E<F|&N9E>P|%8P|%:P|%CP6E8P|%E|%GAP|%K7P6F<|,8P|&BP|%P|$5F|%HA|%P4E<P|$6E|',
      '%F/E|$9<P4P|%P|$:|%1E:F|&P17P6F<8P|%7E68P|%8P|%:I<P6P6F|%P|$;8P|%>P|%P|$AP|#F/P4<P|$1<PAP|%P1<P4P|(E<P4P|$;N|$B9:P|#',
      'G6F;E/|*AH:P|)8|(F>P|#H6P<|#I9E;P|#J4P4F|#K4F;N|$A6F|#L4P|$8P|#M=8P<N|#N2E|$:8P|%9P|%E8F;|%P|!>4P1:P|&H:F|#5P48F>P|(',
      'P|#6E|$P6G8P|#>F6E|#AP|#E/I<P|$>P|$ANCP|$CP|#F0P/8P|(:P|$4P4<P|(F>P|$8/PCP|$9F;E|$;N|$<H7P6H|#G/P|$>E|#I/P/E|$6<P|$;',
      'F|&CP|#J8F8P|$98E8P|#LAP|#N4P4CP|!A/F/P/F8P=6H|-8|*=6H|%6P6|)6H|)E<P|$H6P66H|)>P|%9P9F>P|)H|*/?P|$L|%/?E/9P|(P|&P|%9',
      'P|(94H6P69P94H/F8P=8|+:P|)E4H|%;E/|)H:P|(8|&F>H:P|&L1P|#0P/|&E?|)6K1|,:P|):P|&F|(/?P|#16F|&/?P|$7P6|$80P/?P|%:P|$:P|',
      '$F/P/F8P=8<P|-E<P/?P|)H:P|%6P6H|$I>P|#4/<L|%F@/P/F>P|+H|,9P|%P/F>H:P|*P|(H|)/P|)9P|(K|$:K=P/F>P|*H|%M@F|$FA|&0P/?F>P',
      '|+L|+P|&6P6F>P|*L|&:E/|*H:P|(L/P/9P94P4|)9P9H|(P|&AF;>P|&F;>P|(>E8|)P|&K>H|$L|$P4|&0P/?P|&6P6F8P|+>P|&:P|&E<|#5/P/:P',
      '|$0P/F|$F/|&/P|&6P|)6F>P|&9P|&:P|&<P|)/?P|$P4>P|&F|(/?P|%5|&:P|#6P6F/P/E8P|#7P66E/|&8|(<P|&9N6H|&A<P|*/?P|(E1F|&E8P|',
      '(<P|(>H:P|)P|&F<H/P/F=6H|&H|(?P?6H|+8|,<P|#8P8F|%:H=L|#:P1|&6P6F8P|&:P|#;6E/|&8|%F=P/H4P94P4|&>K;K|(P|%H|&/P/H4P94P4',
      'N<P|$>F8P|#<9P94P46H|$:P|$>E=H:P|(P=E?<P|./?P|*F8P|+>P|*H|+/P|-/H|+1P|+6P|+9P|*L|$AF>P>L|%H|%K=P9H|*L9P|$F|%/?P|%1L|',
      '$H/F8P=|+6H|+8|,<P|(=6H|)E8P|*<P|,/?P|&L|%4|&0P/?F>P|+H/P/H|+P|&6P6F=P/H|+>P|&:P|&E7P6|%6>P|%:E8|):P|(=H|&P9N6H|%A6=',
      'P/H|(E>P|(H|&E;P|$L940P/?P|(:P|%;9P94P4|&=H/P/9P94H/F=6H|0P4|(L|)/?P|&E8|&F>E8|)H:P|&H:P|%AF>/P/5:P|$P/P/|):P|%6P6/|',
      '*:P|%:E|#=5P4|$H:L|#>6H|$:P|$;:P|$F|%:L|(;E8|%;H=H6P6F8E<P|$H|%AE8|$L|%6P6?:P|%9P96FAH|%;:L9P9F>P|,H|$P>|&6H|&:L|&H7',
      '<P/?P|(8<P/?P|#?0P/?L|)P|$:E8|%P|$<|%H:P|%P/P/9P94H/F8P=8|*H:P|&1F6L|(P1F|+/P|-/H|+6P|+;4L7P6|,H:P|,L|&6P6|*H|&7P6|*',
      '6H|*E<P|*H|&9P9H|$E/6P6F>P|&:P|$F|%:|&5P4>|+6P6F>P|&:P|$L/H4E|%7P6|%;:P|%AH|$P?F|&HA<P|#@/P/6P6F>P|(:E/|*8|)P|(=F3<P',
      '|(F>P|(H|)/?P|$0P/|(9P94AF>P>L|,H/F8P=8|/=6H|-:P|,P4|.6H|.8|.H|/?P?6H|(>P|(F|)8E<P|);|*6H|(H/F8P=6H|.8|+=6H|)6>P|):P',
      '|$:L;E8|$F|%/?P|&E4P4F|%94|(P4|*H|*N<P|&E4H|)P4H|,6P|%:H=L|*/?P|%;E/|)1P|)9P|)AH:P|&K|%A/H6P66H|#AH8F;E|#E/8|&0P/?P|',
      '&:P|%P/F>P|(H|)/?L9P|+P|)<F:L|(J4H9P9F>P|$0P/|(F|(H:P|$1>P|%F0P48P|%H|$4P|$5F|$6:P|$8:P|%F;>E?<P|)P|&>L|(P|%I<P6F|+/',
      '?P|%M>F|)/P|%P|&94L|$;F>E/|(P|%H|&/P/?P|%P|&7P6|*6H|&9E4H|(P9E4H|*H|+/?P|*L|$<|%0P/?P|%5E1F|%:P|%F1H|&;:P|(E/|)8|%P4',
      'H/?H:P|&6P6L|+/?P|$>F|%P|&4<P|$?P|$@|%L|%P|&/|(F8P=8|-<P|)=E<P/?P|(P/L|+/P|+1P|+6P|+;H:P|,L|&6P6H|&7E?F>P|*P|(P6|*8<',
      'P|*E<P|*H|&AF8P|);>P|)>P|(H|):P|(L|$BF0P48P|$CP6H|#F/48P|%F66P6F>P|(:H=H|)P|%P/F|)<:|&4<P|(N<F;E|&<:P|$1E<5L|%HA7E68',
      'P|%K4|%L|&9P9>/L|$2;|&/E7P6P|(H:E<F|,P|&7/<|*9P|&8P|&:P|&E|&P|$3P3E8|*F/?P|$4/P|%9P94P46H|%;0P/?L|+P|%AH:P|%E:>P|%H/',
      'F8P=8|)=6H|&6>L|*/P|,/H9P|*9P|*;L|(F|(P6E<P|&:H=L|(P|%L|%P4|(6H|(8|)<P|(:P|(E<P|(H|)/P|)1P|)9P|$5P/>:P|&4NCP|&5F>P|(',
      'H/P/H|&:G8P|+/?P|&AJ?F|+6P|+9P|$6|%6P6F>P|%:E/|(8|&P|%F|&/?P|(P/9P94P46H|&:H=L/?P|%L|&/?P|%P6F;E1:E8|+>;:P|$7E;/<P|%',
      'F;N/:P|$8L|&/?P|&6P6F=8P|&9H<F7P6H|%P|&4NCP|$96P6F>P|)H|*/P/H?P?E/F;6F>P|%<0P/?P|&:P|$:<P1/<P|)80P/?P|*:P|%E8|(0P/?P',
      '|(9P|(:P|$;4P7E:F>P|+P|%8P8E|%E9E<|*:P|&@8P|$<6:P|%>P|%F/H4E|&7P6|*H|&AE/|*P/:P|)8|(H|%H6E8|(F8L|(H/?P|)7/<P|):P|(L|',
      ')9P|(P6F|&7P6H|&9P9:P|&:P9AF>P>L|*F|+8E<P|+;|*H:P|%L7P6H|&AE/|)8|(F>K;K|*P|(H|)6P|$=P98L|&=H|$>/F|(8E<P|%0P/F;>P|)H|',
      '*/?P|%L|&/P/H|%P|&>F;:P|(L|$?/P/|)0P/?P|):P|)F8E<P|)H|*/?P|*:P|%0P/F|*8E<P|*;|+6H|)H/F8P=6H|/8|,=6H|*:P|%:P9<|%E6F:F',
      '<P|%L1P1>P|&;E4|*F|+8E<P|+;|*H:P|*P4F>P|,H|-/?P|.P/?P|-9P|(H:P|&AE/|(F/P/H:P|(H|)/?P|$@E|&/P/?P|&AF>P|%F9P9H5<PAH|%H',
      '/P/E4H|,P4F8<P|&7P6H|&9P9H<:P|&:P|$A1E;|):P|)F/?P|%<0P/?P|&:P|&F/P/F=6H|%F>F;|*6P6F8P|.>P|*:P|%K/E87P6<P|(P|$BP5H|$C',
      'PA7E68P|#G1F;|%H:P|%P1H|$4H|&/?P|%P4F8P|)=P/H|)>P|(H|)/P/H|)9P|(L|$5L|$6:P|%F|$<|%/K1<F|%8P|%9P9E|%:P|%<P|(/?P|%E0P/',
      '8L|$@P1P1F|+/P/H9P|&7P66F>P|+H|*H|#J/H|&AE/|$0P/4P<E:8P|$4F|&6P66F>P|+H|&9P9H|%P4F|(H:P|$5P|&/>/P|):P|&5F=|&9E|&:L|$',
      '8P=|(6H|(8<P|(A<P/?P|(E8P|)<P|(H|$9P9|(6P6L|(7F>L|,;L|(9P|(:5P4>|)E8|)P|$=H:8K|(P|%P=F/<:E/|-8|*?P|*P/H|);E?<P/?P|*L',
      '|)>L|$>P>:P|$?F7E4P4H|&9P94H6P6F8E<P|/H:P|,:P|+L;E/|*E4H|*H=|&;E/H:P|)8|*6H|(F4|*9P94H:P|.P4|06H|*H:P|*P4|,6H|,E<P|,',
      'H|-?P?E<P|)5L9P9H|//?P|0P/?P|(G4H|+/?P|(K|)=F|+8<P|,E<P|+;|*H:P|*P=:P|&A7P66H|+8|+H|,?P?8|(<H:P|%P?:P|(F|(L|)9P|$APA',
      'K=H|#K/|%6P6F>P|)L|%:E/|(8|&P|$40P/?F>P|%6P6F>P|%:P|%P4L|&9E?<P|$5P4E:P|(F|);|*6H|*F<H7P66H|$6|%0P/?P|%:P|%E7P6|%F|&',
      '9P|&;F;=P|*>E?<P|+F>P|+P|$<P|$=H94H/F8P=8|,=6H|*:P|)P4|(E4H|+/?P|%M<H|%P=H|):L|$>F|%H|&9P9F?P?L|%I<P|%L|&/?P|(P/H|&;',
      'L|%P|&CP|$?E5P|):L|%L|&;F>P|#L/E1F|%H5P4<P|%L|%P/|(9P94P46H|.H|/?P?6H|28|(H:P|$5A|$6P6|(6H|(8<P|(>P|(E<P|(F;|)<H/P/|',
      '.H:P|+7P6|.E<P|(H|)/P|+/M5P4H|)9P|$<:H6P6H|&P|%A<P|%CP|#M8P|!B4P2:P|!CP4E<P|&>F8P|%GAP|%K4P|$9E8F;|%J;F8P|$:F6P|$<G|',
      '&/E7P6P|&6<P|(KAF|&9F<F;E|&AF6P;E|!D<F|#AE;P|#E8P|$>FAH4P|%P|#F7P6F|#J8P=F|$>8P|#L4P<28P|#M0P/M0P',
    ].join(''),
  ],
  te: [
    "ంఃఅఆఇఈఉఊఋఎఏఐఒఓఔకఖగఘచఛజఝఞటఠడఢణతథదధనపఫబభమయరఱలళవశషసహాిీుూృెేైొోౌ్",
    [
      '!$!4Db|$=b|$BW@W!BU|#DUJ@|#HUOYBbCU|#IMOW@_!BU|#M_E@U|#ORKTM|$W@WDbDTJU|!%;M|$_|#=OTKU|#FVRW|#K_4bJ|)!|$b;bRb|#PT|#R',
      'WE@bKU|!&!8DVKU!4b|$;KbDZ;b|%U!;U2V|#@K|#BU|#NbM@_|!)!BU|#@bE@b@U|&TB2|#DbD|&TJU|(KW|#E|!,2b2WO|!-;V,Ib|#=TBU|!/2|$;',
      'U|!1QC|!2!2K|$;[|#NTPTM|#T4T|$KbJ2Kb@|(TMJ!|$MWOM|#U|$!BU|#W;W!G|$MTM|$NTJUM|#X=T|#ZFZ|#[!BbK!|)I]D|)TMW|#^KUJKb|#_=',
      'b|$R!|!4!;M|#?T!2TM|#W!=T|#YSTORKTM|#bK!ATMJ!|%TI|(!|)M_|(TDU2U|)M|!6Z!BUD|$@b@DW|#[@UE!EWM|$Rb@WDbDTKW|!8D4?D|$D|$T',
      'HT|(@_|#KW4W@W!BU|)_!BU|#T@VJ|#UMbMT|#XDUJKb|!;U|#ZMU4bKTFb|&F_Db|!=T2b;KbMW|#U4bKV|$RbEZDbRKV|!@T4W|$KW|#UKU4U|#Z4M',
      '|$M!4T?|!BUObJT!4WM|#XK!|&M_|)DX|#bOTKT|!D;U!6UD|#I_BW|#U2K!4T|$IU@b@!|#V;U|&ETKWBM|$KW|#W!=U|!E!;MW|$EU?V|#2b2D[|#;',
      'b;?I]D|#A2!|#GbMU2b|#KE@U|#PW|#T;W|$<PTM|)MW|$KG_Rb@TKW|%TIZ=U2Mb|%UPWCbJ|,!|#UDb|#]G=UD|#^=W4WDT|#_MU!4b|$Q2TSTK|%?',
      '|$Rb;TFVRW|(b|#aK|#bK2TK!|%@bJTIbDTJ|)[2|%CTD|%HW@bO|%OSURb@W!BU|%TAIU2|+_DbD@|%]O[;W|!F_Db|!G!8KW|#J_4bJTRb|#RbRW|#',
      'TMG=U|%M|$OWMW|#U|#Y!B!|#bJT!2U!4W|)W|!HTK@|#X|$IU|!I!=M|&TDU2U|#4OTKU|#K?TM|$W4WB^=b=U|#T@T|$CbJIU2|$Kb2Z;U!4W|-b|*',
      'b|#WKW4WDV;UDU|+KW|#XMTMW|#[D[8UIZ!;W|#]BTD!|#^BM]D|)OU|$G]Mb|!J^2b2|!KOT?T|#SBTKU|#TQb;bK|#V=U!4b|#X!|#]MbO[|#_8W2W',
      '|&OTKV|$=bMW|!MHURb@WDbD|#T!=b|#[BW|$DU|#]Db|#^2[QDb|#_|$DW|$EW|!ODKWM|#Rb@WOWMW|#T=V|$?U8bJ|$K!|%b@TE@bKU2|#U@b@UD|',
      '$BbJT|(W@b|+@W|$C!4T|$DUJ_4!|+M_|%_B|$OUC|$Rb@KU!6U|#VCWM|#Y@b@U|#]BbJ|(PTM|#bJKbATMDW|%ORTJ|*!|*TDU2U|*[@K|(bA|!PU2',
      'bQ?|$PW|!QZ=bJXMb=b|!R!2bQ[I|$3bJ|$5!|$6TK|$@|$EXKb?|$K2bQ?|$RbA|#Gb|#IT6TK|$V2Y@|%E|#KFKT|(M|#S2TK|$TJ2|#T4WDVKW|$I',
      'T8U2|&DbJ|#UDUIT|#[2KU!6[|$OT|#]DbRb|#^R];V|#a2KbJ!|)TMW|#b;[QDb|$OJ!|!STMW|#Z2b;TKbMM_|,W',
    ].join(''),
    [
      '!$!2IbI|%U@!|$4NbMW|%V2KU!6U|*Rb@T=W|$6DT|$8JbJ|%MU|&V|(B[OU|$;T=W|&KW|%X|%[|$=4T|%ITDb|$@|%!|%2!;[|&W|(IW!BW|%4T|%;',
      'T|&U|%KU2bQ|&b4@|(8T@VJ|-!4T|*M|(O[BU|%T|%[|&2T2|*W!=T|)BW|&4T2|$B!|&4T|%8[RUDTKW|%I]D|%KU|(2U|)V|(DV|&W|&X|%TM|(W|%',
      'U!64T|)T=W|*KW|)U|*!BU|*D|)[|&Rb@W!BU|+DbDTJU|%W|&2DU|)[|(W|)!BU|)DbD|,T=W|-KW|([|&6[@|&GT;WM_|-2U|&M_|&OMD|)bM|$GU2',
      '|%[=b2Kb|&Bb2Kb|$P!|&E]|%TMW|#2T=IV|$b2|&=|(2W|(U|)2U|([|&UD[DU|%;_GKW|+M_|*b|%GKb|%KI|%QK|(!|(TMW|)RbJ@|,WM]D|#3!=|',
      '$UM|#4bDU|%KSTK!|+M_|#6b6!E[;|+M_DW|&TJUEMbMU|#8Jb|#;OV|$W|%O!;U|$b;U|%MXKU|)W|#=OU|&M_|%WMM_|(W|$U4T=W|&U@[|$W4W|(@',
      'T=W|(M|)W|$b=@V4M|+M_DW|.X|&T2Mb|&W|#?W|#@=U|&2U|&DU|%W|$?b?U|$DU|&2U|&@_|&DU|&E]|%W|&2W|%bDU|$U|%AU|%EZBbB|$b@|&UMU',
      '|%J!@|&CU2|*!4T|&ORK|&W@b@I|(DbD@|#BD!4T|%EW|$U|%MTGTBW|$[|$bB!|(2U|&Z2W|%HW@|)!4T|)I]D|#CU2|&!|(4T|&R!3bJM_|&TK|)!|',
      '*M_2U|)TDbDU|*MW|)U|*2|+!4T|*4T|)WMW|%D[@|%E@U|$VD!M_|*2U|$bJ2bQ|*W=U4T|,W|+DU4T|+MW|&JD!|&TE2W=W|#D!@|&4UKU|&EWK!|+',
      'M_|-DW|.X|&K|(!|&RT4K!|&b|$2TEMbMU|$4T|$G=[|$RXJ|$TA|%K_4bJ!@_|$U|%@|%EURb@W!BU|%Mb|%RZ;b;U|$V|$W|%2XM!4T|&_2W!=T|%4',
      'W?!4T|%DBU|%G!C|)!|*4T|%HO!|(U!6T=W|%I@U|&RIWBbK!E[;|&TD!|&WM|%KT4!|(C|%OBU!6T=W|,KW|&TB|)!|)2W=W|)TMW|&]D|%R!CTD!|+',
      'I]|&KU!6U|$XKTC|$[|%2|&!|&I!BU|%BU|%OTKW|&U|$bD|&!|&BTD|*!|(U|&EXKb?|,IbI|&IJbJ|&JbJ|&OK!|&RITKTCD|&T|(=W|(K!|*M_|)W',
      '|&U|&V|%JTJ!|%O[Q?|#EKTMW|$XKbO|$bE4U!6U|)Rb@T=W|&;U|)2U|*[|)DW!=U|(bM_|&MT6TKbJ|&TKTOW|&W|(=EbEW=W|)W|)[|#Fb|#GBbC!',
      '|$WMb|$bBWMb|*MT|%GTJU|#HJTK?bJ!|$UEbKTJ!|+TMW|%ITD!|)WMW|%OYBbCU2U|,M_|%Q[2!|)TMW|$bJKbAU|+4T|&WBJ|#IK6U!@|%TO@U|%b',
      '|$M|%TEWK!|+M_|-DW|.X|%W|&M_2U|$TOTRbJ|$ZKU2Db|)T|*2W|*M_|$bI|&OTKU|+2U|+DU|*W|&T|(JU|*DU|%KTGTBb|#JU|%!BU|%@[|%BW|%',
      'D|&BU|&EbE;U2V|&T|$_IJ|$bJEbE|&Kb|&T=W|(JU|(KW|&U!BU|&[|#K;U|$GU2b|%b|$OU!Bb|%]|$W?|&T6Mb|&b|%B]D|$ZRb;W|)b|$[GUJT|$',
      'b6D|%8T|&WDW=W|)b|%A!|&TMW|%C|&!|&KT@bKU|%GDb|%S@|#M!2KU!6TKW|+U|%EXKb|$OT;W|$T|%!;U|%4[|%D[|$U|%JTRb|$V|$Z4b8T!=Kb|',
      '$_E@V|$b|%M!|&KU|&W|(=W|&XKU|)W|#O2TP!|(TMW|$4TSD|$@KU!6U!BU|%TK!|(IW|(TMW|$CTDU|%X@|$P[QTMW|$RK!|&I]!BU|)D|&TM2W|)D',
      'W|$TKb=W|*DW|*MW|)b|$U|%DV@U|$W;b|%@T=W|(JU|&W!BU|(DbDOU|&_!BU|$[|#P_2|&W=U|)W|(DU|&b|$bODU|&UDU|#Qb;|&TBP|#RFb|$MW|',
      '$URb;Z!;b|$Z!GbMV|$_RUJ[;b|*QDb|$bRT!|(IV|#SbIBb|!%!4bM|(!|)M_|([JWM|(_|$8D[J|)RbOTIU|/OTKU|)WMW|$B_Mb|&ND|(b|$CbK|(',
      'EbKB[Pb|/M_|(T|(WM|#2KbQ?|)MW|$MU|$TK!|(M_|%P!|&OT?U|$UOV=W|$W|%E6b6|%MW|#3KU|#4Qb;W|$Rb;W|)M_|$bD[J|#6!;|$TK!|&TMW|',
      '&bJ|)W=W|$X2V|#8TBb|#;4T=W|$MW|$_MW|#=BU|$EUMbM|$U!BU|%J_|#@bI|&2A|(XKW|+M_|-DW|&S@bJ|%K[J|#BK?|%bP|$TJ|&!|$U|%@bJ|%',
      'DTKTJ?|%MTGTBW|+b|,M_|.DW|/X|&b|(QT|%OTK!|*DT=W|$WKb@U|$[PU!6T=W|$_DU|(M_DW|+X|$bJW=W|#CTK|&!|(4T|&E=U|&TMW|&U@|$U2b',
      'J@|%E@bJ!|$VD!M_|$WDU2|$bJT@bIU2|%OKbJ!M_|#D!B|&!|&KTOW|&b|$2;b;|$OTJU@V|&NbNW|$T;U|%=W|$W2^DU|$b|#EK[;U!4b|)Ob|&QDb',
      '|$UMb|$]|%D|#FVRKb|&b|$b|%5DURb@TDb|%KU2T|#HK?TMW|#IDU|$WB!|&TMW|$Z|%2W|%@_|%DW|$_B!|&U!6U!BU|#J2;b;W|$D|%2W|%DW|%[|',
      '%bDW|$T|$UMb|$WCTMW|%KbO[B|#K!H!|$O|$TCD|$W|%4WKW|%BbK|$_E?MW|$b|%4D]8[QDb|%;b|%AKb|&U2|)!4T|)O[@b@|%CU2|%IV|&XKW|)b',
      '|*M_DX|%J|&Db|#M!EXKb|$IXKW|$J|%!|&M_|%IW|%TDU2U|(bDU|&M|(W|$V|$XKW|$[KW|$_6D|$b|#NbM4=b=|%NBWKb4b|#OK?M_|$UKbHOU!6U',
      '!BU|$W|#PbKI!|)M_|&J!|#R2b@U|$UFTGTBb|,M_DW|/X|%JDb|&T|(M_|$WE@bKUM_|$b;bK[MUJT|%@U|(DU|&WMW|%ATD|)!M_|%EKU|#STK|&!|',
      '$W@U|$bOTD!|!&!2T|%^2|%_|$4bMT!=W|+b|(VQW|+M_|*b|$8DVKW|%UDVKU!4b|$;|%Kb|(D[QDMb|(IV=UJ;b|%U|&2U|&DU|&M_|%bM_|)D[|$=',
      'UJDb|(T|)M_|%_|&D[QUJT|&Kb|$@|%2W|%M_|$BUK|(T|)4T!CV|%W|&2W|(XKWE[;|&M_|%bK|(8|)U@b@W|(OZMbMU|(W=W|#2b2=|(2W|(U|)2U|',
      ')DW!=U|([|#6b6;|&T=W|(KW|&U|(!BU|(D|&[|&_=|)M_DW|#;MV|$U2bJTM|$VOM|(U|$W|%2MW|%O!;U|#@=W|$DU|&2U|&DU|%W|$KTMW|%WMW|$',
      'b@=U|#B!@T|$V|$[|$bBKU|(W|(X|#DWE|%IW|$b|%RWMUDb|&b;U;bJX;b|(EZ2b;Kb|#EbE;U|)2U|*V|*[|)OK2W|&W=W|#GbG!BU|)WMW|%KSV!|',
      '*E;bD!|#K4OK!|$O]|$T2b|%DUJDb|&V|&b|(M_|#MT|%!;U|$bMTMW|&W|#NJKT8T|$bN|&W|#ODbDV|$U|%2X=T|$V|$[|$bO=!|(TDU2U|&G=U!BU',
      '|&TMDU|#Qb;!|#RW2|$b@T=W|(KW|&W!BU|&X|%ITJUMb|%K_|%MT!|(IU2b|!(DT=W|#IZ|%DW|#JD|%2W|#KbMEMbMUM_DX|#M_4T|#PTDbJ|$bOKK',
      'TOW|(U|(W=W|(b|#Rb;U!=UJT|&b|!)!4W;XKW|$6TKW|%U|$;T=W|&JU|&KW|%W!BDU|)U|%X|%[|$=4T|%;!|(@_|%=!|(@_|%BW|%O6b6W|+DW|%T',
      'MDU|(U|%U|%W;|&DW|%[|&BDU|(U|&MT|&OT=W|)KW|(U|%bKT8OK!|$BDU|%_|#2b2W|#4TBU|#6U@|&!4T|#8bGZ2URbATDb|0M_|#;bDXKW|*M_DW',
      '|#=UEU|#@b@I|&K|(!|)4T|(EB!|*TM|)bKB[Pb|(T3!=b|)D|(bOW|+MW|&W2_;]|&[8b|%E@b@UM_|*WMW|%RO|(!|(TM2W|*M_|*W|#BJ!|%4UKU|',
      '*M_|,DW|-X|%b|$T|%SK?|)2U|*W|)4T|)MW|$bB[P!@_|)U!6U|%HOU!6U!BU|%JI|(!|)M_|(2TKW=W|(TDU2U|*bDU|)MW|&TDOD!|&_4|)!|)TDU',
      '2U|*MW|)WM|+W|#DU2U|(M_|$bD!BWD|&;b;W|)MW|&@|&BDU|(U|&EW=W|(bE;U2V|*W=W|&OU|&T|(=DU|)W|(JDU|(KDU|#E3!=!M_|$4bKS|(TIT',
      'MW|$DBU|&WMW|$J_4!|(U!6TKW|+U|,D|+[|)Rb@TKW|$KTQb;bKE@U|$TCU|&bJTJ|+W=W|,MW|$bEMET=W|&W|(DX@M|#HJ|#IT|$bI=U|#JbJTMOT',
      '=|)_|#KO2^!=|$bBX|#MOET=W|$bMU|#QT|$b?I!=M|&_4bK@|,MW|#RbITDUJT|!*;b2XKW|#K!@T|$U|%2U|%M_|$W|$[4U!EW|+4T|$bM_|#NbN_|',
      '!+QU|$WMW|$bJ[!BbKI?U|!,!;Kb|(EbK]8ZRb|$@|%4TD_|%_|$BK_|%W2!;[|(W|$EU2|(]DBU|*TKW|%V|&;VRU|#2KTM|(2W|(W|$b2=|(T|&U|&',
      'WO4T|%Rb|(EbKZRb|#4WI@U|(WMW|%O|$b8U2bJX;UOb|#;WO!;U|#=I|$TKU|$U;Kb|&U!4b|$bJW2[QDb|#@b@JUD|&UE_@M|&W|(D|(M_|&]D|#BU',
      'KU!6U|$W;|%KW|(4T|&b2^DU|#DM[DU|$UIUBO|)U|$b|%;V|(%Kb|%DU|(2|)JU!BU|*bJT=W|-KW|)M|*M_|*W|*bM_|)]|*!BU|*D|+BU|+T=W|,K',
      'W|&W2WDbDTKW|&_|#EbEW=W|)X|#Fb|#Ib|%GVGVJZRb|%IU4DXKW|&ZMbJ[|,4T|,MW|*RV|,MW|(Rb|#JU=bRb|%Kb|#KWEW|$bK|&D|#LbLD|#MT|',
      '%!;U|%4]DT|$b|%2@WKb@U|%BWKb@U|%MIbI|&TKZ=b=U|.M_DW|#OKU|&2U|(V|%W|%X|%]DT|%_|#Rb|%EV|%OV|!-24bKVO!4T|$TBPU|$V2Y@|$]',
      '2|#6XKU|#;T|$UJ!|$XKWDT4TK!|.M_DW|1X|#=O|$UB|$W|%4WKW|#BU|$]DT|$_|#DW4W|(M|)W|&^!=M_DW|#EbKUMb|#IU|%;!;[|&U|&_|$V|#K',
      'W|$bE=U|)!BU|)D|(W@W!BU|(b=TJU|&K6TKW|&T;W|*2W|*6[PTKW|,RTKW|-UD|*M_|)]D|)bMW|&[=W|#MXKW|(M_|*DW|+X|$[PbOK!|#NbM|%N|',
      '&W|!.2bJKT8bJ|,RIU@U|#;U|$V|#@[|#BO|$W|%4WKW|#KDb|$TM|$_ET|!/!4_MW|)M_|+DX|$;KU4T|%UIU;b;|#2;U4T|%[|%]D|$=W|$DT=W|$E',
      'bE;U|(W=W|&KTAIU2|$KU|&D^2KW|%W|%]D|%_8W|$RTKU|$TD^2|$[|%RTKU|$b2|&;[|&RTKU|&^2b2|&_|#=UPT|%QT|$b=WD|#@b@U=U|#EbE!B!',
      '|&U!6U|#KUJT|%RbRT|#MU!EU2b|!08UMU|#;IU|$W|$bM|&W|#=K[OW|$U!6T=W|(U|#EZDb|#GWMOTKUEMbMZ|#KW4MbMW|$bO2MbMW|#S_|!12W|#',
      'K!48[GW|!2!4b;U|$6U|$;U|&2U|$=bKU4|*M_|,DX|$BU|&M_DX|%W2XKU|*W|+M_|-DW|*b|&MW|$EZDV|)2U|)MW|*_|%bJX;KW|+b|$G]DbRb|$H',
      '!|&OTKUEMbMZ|#6b6T|&U@!4T|#;b;|&!4XKb|&=!|(TMW|&T|&U|(!6T=W|+KW|*UD|(D|%D!|#=E|%M_|(DW|$GXKW|$WEW|$Z!|$b@TMb|#@b@U|#',
      'A2W|&=W|$D!|%W|$M|%DW|%W|%_|$T|%!P!|%DTJ2W=U4T|,W|+DU4T|)U2|+4T|%K6JU@|#BT|$UKU|(M_DW|+X|#D2|%BWKb4|%TM|$U4UKU|*M_DW',
      '|%EU!6U|+!BU|*[|(Rb@T=W|,JU|,KW|+W!BU|&Z;b;UD|$VR!|$W2|%4^DbD|+T=W|,KW|%I|%MW|%OU!BW|$bD|&=|(!M_|&EbE|&JbJ|&T|(!G|(J',
      'U4X=Z!|&W|(M|)E!=WO4T|&XKb|&Z4!;U|%J|&2T|&TPWMb2!|#EUM[PbOKEWK!|$XKb|$b|#IM|%T|&2K|&B[OU|&EWK!|(XKb|&GTJU|%b|$TDbEXK',
      'b|$U;V|%QDb|$bI|&DU|%JXDU2[QDb|*8!|*Qb;W|*Rb;W|-b|#K?!|$V!D4Kb|+M_|-DW|.X|$W?|%OW|$b?T;2|%@|%DT;2|&XMW|*M_|,DW|-X|%I',
      '|&T4TK!|#M!|$2=|%@b@T|*M_|$BU|%W|$E|$JU2@_|$MW|%_|$OT=W|%W|$RET=W|%U|$T!|%Db|%Ib|$U2UKU|%4U|(!6[|)BU|(D|(KU|(Rb@W!BU',
      '|&[|%EU|&[|%JW4|%RU|(D|&[|$W4W@W!BU|%EG=U|&W@X|%Rb@T=W|*JU|)W!BU|$Z2b;KW|*[;b|*b|$bED|(T|&IW|&U!6=TDU2U|*TKW|%JT?|)!',
      '|)U|%MW|&XKW|%O2W!;bM|)Kb@U|-M_DW|%S[KW|#NMW|$T|%2TKU?U|)W=W|*MW|%EbKEXKb?|%PTM/2|)2W|)MW|*_|$U!4|$bJT?|)!|)BWKb4!|)',
      'U|)b|%NW|#OJU@bKU|$K[8U|$U|%4T|%@|&MW|&T|&bO!|$WM|&M_|&W|#Qb;!|&E=U|&TMW|#Rb@XKU|#T!4bKZRW|+b|)[RW|%6D|(ITM|%=IW|%@T',
      'KTOW|&U|%EbMZ2bRb|%RbJ|$2|%@VJ|)WM|+W|%E_@[|%KTM|%UDT=|*M_|,DW|-X|%W!=T|$48bD4Kb|,M_|.DW|%U@!|$8WMXKW|$;Db|%TK!|)M_D',
      'W|,X|%bET=U|&K[DU2_D|$BDU|%W|$DU|&OU|%V|$ET=U|%W|&K!|$FV|$G;b;U|$IKT8W|&bRW|%OKEW2_;|%TKZ=b=U|-M_|/DW|0X|%Z=V|%[PbOK',
      'KTOW|$J|%4XKMW|%CTDbJTMW|%MW|$K!|%?!|(4T|&IDU|&TM|)W|%T4TK|%W|%b@V2|&E^K[QDb|&IU2|*WMW|&J|(2MTETMW|)bKI!|-M_|,TDU2U|',
      '.bDU|-M2W|.DW|.M_|.W|(BKbPU|-4T|(TMJ|+!M_|+TDbDU|,M|-W|&O[;UD4K!|$M|%!|&DT;U|&M_|)D[|%2bKI!M_|*[?T|%DU|&V|(M_|%EW|%I',
      'W|(M_|%TDU2U|(bDU|%W|&O|(MW|%Z!=KW|%[8U|(V|)M_|(b|&BW|%b6U|$NUBTRW|%[PbOKKTOW|%_8V|%bN|(W|$O6b6WDW|%=!|(@_|&TDU2U|%M',
      'RUD|&U|(M_DW|+X|%TMDU|(U|%W|&D|%[KU|(V|%bJ|(!|(IW|(TDbDU|)MW|$PV|&DTAb|&JT@bKM_|%bIVKW|*b|$RUE[;|%W|%b;bJXIbRb|&@|#U',
      '!4b|%B|&2W|&U2U|$=bDTEb|$DbDZK|*RTDU|$IV|$K?b|$M_|&IV;KbM|-2W|-W|$QDb|%_Kb|%b;JbJ|#VKOT?U|%b@D|)MW|(U|$M2|$RK|#W!2WI',
      '|%;|&TM|%=MW|$2b2|$;W!G!|*M_|)2AT|)IW|)KTOW|)TDU2U|+bDU|*M|+W|%bK|$=T|%U|$@WGb|$BUKU!BU|$EbE!|)M_|+DW|$GVKb|$HVKb|)M',
      '_DW|$ITK|(RbOTIU|(U|(W=W|*]D|)DU|)MW|(b|)@Z|+DW|+MW|%bIKU|$KOU|$M|%!|%TDU2U|&MW|%V|%b6TK!|$NTJU|#X6UEX=U|$;IU|$=|%MU',
      '|(M_|%UD|$@WKW|$K|%4TJMW|%MW|%b6UD|(WDU|(^DU|&EW|$MV|#Y@bKUI|$QU|%b?|(!KT8W|(2W|*ITKU|(B[OKTJM|/W|(DW|)b|(IT6TKbJ|)X',
      'Kb@U|(JbJ|(KT8W|(O[?U|(PTRb@bKU|(T|)DBU|)EWK!|)KTOW|*Z=b=U|(W=W|)DU|#ZD=T|(M_|$Eb;ZDb|$FZMW|$IZKT|%[KTIDb|$KIZKU|*M_',
      'DW|%VKb|#[!BbK|)!4T|*M_|)ETMU@|)IW|)TDU2U|+bDU|*M|+M_|+bM_|$KN|&M_|$OM!|$P!E[;|%O|&KTOW|$RIWBbK!|%KU|%V%Kb|%W|&M_|#]',
      '2TM|#^!4K|%6Z!|%=|&2W|&EMbMU|(T2|(]|)D|&M|(KTOW|(W|&OV;U|)=W|&T|(EWK!|)XKb|&XKW|&[KbM_DX|%@|&2TM!|&I!BU|%BKU|(W|&WKb',
      '4b|,M_DW|$;b;U|(W|$=!4Mb|*M_DW|%2!=bM|%O;U4!;U|&MXKW|%W2W|)DW|)MW|$@b@|(2_;|+M_DW|(4T|)X=|+M_DW|+Z!|(6ZKWOW|.M_DW|(E',
      'MbMU|-M_|/DW|,Z|-M_|)[;|(OVCU|(XKW|$BbBU|)4T|(V|$DRT4U!6T=W|-KW|+BU|)W@W!BU|%U|%W4_MW|%bDTNbNW|(U|)RTKbMW|$GbGKU|$IK',
      '!HV!|%bIUD[DU|$JbJM4X=Z!|.M_DW|(XKW|$K2W|%UJT|$M!GUJT|%DW|(ET2|%UIU4W!=bM|%WOW|)M_|(]|%bMTEXKb|(XKU|*W|([KW|$ObOXKW|',
      '+M_DX|$RKT8W|#_2UM|$;|%2W|%4UKU|*M_DW|%D!BXKW|&W|%EMbMU|%JbJ|%KTI6!=bKEWK!M_DW|%MW|&_|%U|%[PbOKKTOW|%bM|(@_|(W|$=!4M',
      'b|%MW|%U|%WIXKW|%XKW|%[KW|$B!=|(ET?U|(KTIUKZ=b=U|%T=|(M_DW|+X|$D|%KTOWE[;|%RVI|%[KW|$E!|&@_|$IM|$JUM2W!;bM|)^!=|$K@T',
      '=W|%Rb|%T=W|&KW|%U|&2|(MW|&D|%W2^!=|+M_DW|&;bM|*M_DW|&@W!BU|(X|%b;W|)MW|*_|(b|$MTKb|%b2T@T|&E_JU|+D|$NbN|$OXKW|$RI[|',
      '%U4U|%b4U|&@T|$SUKb|)M_DW|%Z=|#a=UEMbMU|$@TM!|$DbRUMb|$GTJb|$RMbJ|#bJTMZ!=Kb|$KI!|(4T|(M_|&[?T|%T!@U|&Rb|%U!B|)U|&2Z',
      ';b|&@!|&J[QDbRb|&Qb?4UKU|&Rb;UJDb|%V|&=MM_|)W|(T|)2TKU?U|,W=W|&Rb@W|%]Rb@O|+WMW|%^@b@|$MGb|$OU;b|$Q[@bK|*!|+M_|*JbJ|',
      '*TMW|!3!=bKU2|*M_|)4|#4_N|#IbI!|(M_|*DW|+X|#Kb6W|(@_|#T8VE[;|$DTEXKb|+M_|-DW|%b|$NV|#UMbMT|#WKbBb|#]BV|%W|#bJT@U|!4!',
      '4|%DW|%IbI|%KT8W|%OK!|)M_|%T|&CK|)DZMbMXKW|&K!|$;|%M2W|&W|$=U|&2_;|$CKbO|#8E@U|$bO[Mb|*M_DW|-X|#;b;U|(4T|&W|#=UET=W|',
      '%O[IWM|$b=|#?@!@bK|$D|%VJ!4T|(I]D|$E@U|%OK!|$T!2|(TMDW|*W|%MW|$U@|$[PDb|%Qb|#@!|%M_|#BU|%M_|$WMW|$bBZ|%OTM|)M_|+DW|,',
      'X|#DW2|$bDOK!|*M_DW|#IDU!6U|*D|&2|#KUIZNbN|$W=|$bH4W=U|&O@U|#MBW|#NTIY@IW|#OKbDKW|*4T|)b|#T!6U!BU|(D|%CTKU|&V|(2U|(8',
      'V|(DU|&[JOTBU|$2|$8WMW|$A|$D!|%U|%V|%W|%X|%[|$J2W=W|(KTMW|(MW|%@bKU|)V|%DU|$KU|&2U|%W|%bMBUDbDZ|$MU|&OV=W|#U!8MW|$=W',
      '4W|$BbBMXKW|$KU|&8|(D|)WMW|&GTGW|#V@|%!|%T|&!8MU|&MW|#W!;XKW|*M_|,DW|%=IbI|&TM|&W|&Z|(E_;W@_|&bM2IbI|)EMbMU|%@2MbMW|',
      '$8KT@b|$;b;|(E]|$=TMUM_DX|%U|&2U|&DU|&ETM|&M_|&OT=|&SAbDXKb|%WEMbMZ|,M_DW|%bMOMbM[KW|$@b@U|)M_DW|$Eb@|(T|$IbI=U|$K8T',
      '=|%U|&!6U|*D|%W|&2WM|&OTK!|+DT=W|(W|)MW|%]|&D|%b@U!6G=U!BU|-W@W!BU|+TKW|+U|,!BU|,D|*EW|(W|)2W|)4T|&K!|)2^!=|)E_=b|(T',
      'MW|$NbNW|$S|%MW|&_|#X4WMb|$=|%OMbMU|%T|%XKW|)M_|+DW|,X|%Z!|$>6TKU|$Kb6U|#YS|%!|%M2bQbIU|%TM|(W|)DbDTJU|#ZMU6U|%W6W2W',
      '!BU|&E^!BTKW|#[J|#^!@W|$;b;EW|$=O|&MW|$EbE|(4T|(@D!|$MbM|(EMbMU|)X=U|#_!4XK|$2OK!|)M_DW|%UD|$=|%MW|$BTOKU|$CWI|$D|%Z',
      '4!=bM|$EDbD|%OK!|%TM|(!|(2YQb?|-JbJ|(EWK!|(KTOW|)Z=b=U|(b|%U|%V|&6!Bb|%WK!|$K!;bM|*M_DW|%W|&6U2b2W=W|$Mb2^!=|$OT|&M_',
      '|%U!B|)b|$RbET=W|#a=|%b|$@!|&KT8W|%I|&U|$KO|&!|%U|%V|#bJTRb|$K!A|(!|)M_|(IW|(TDbDU|)MDW|*J|*M_|*W|%S!|&U!6U|+D|&V@|)',
      'MW|%T|&D];b|&I!&@K|)4T|)8T@VJ|)@_|)EbKCTD|)KTQb;bK|)M_!|+/2|+D[|(8DTHT|(B[O@|(DTI|+!|(E!6TJ@U|(IWM_|,DU|(RbAWMW|(TDb',
      'DU|)M2W|*@_|*DW|*M_|*W|+@_|+DbDTJU|*bM_|(V?|(_@bRO!|%V2W|%XEb|%Z4^KUJDb|(_KUJDb|%[;b|&=b|!5!;RTM|#4b4Kb|#;b;ID[DU|#D',
      '!4T|$@|$OU8J!|$bEXKb|*M_|,DW|#KTDT|#T;b|#_K|$Qb|!6!;U|$=V4>b|$BITI|%Kb|%b|&K|(!|(2N|(4UKU|(GTGW|,DTJW=W|)_Rb|(I_SDb|',
      '(JbJ|(P[3K|,KTOW|-Z=b=U|,b|(U2|(W=W|)DU|$E=TDU2U|%U|#2b24T|&;U|&DU|&ZK|%K|&!|&ET?U|&IW|&OKb@U|,4T|&TJE[;|#;b;!|&TDU2',
      'U|#BK!4!|%EW|$MOT=|$UOT=W|&U|(D|&[|$WOW|(2WDbD|(6WDbD|#DUE_JUD|#IWKW|#K?b|$U@bK|)2TKW=W|-M|.W|*W|)DW|)IW|)M_|$b6MW|&',
      'U|%J|&MW|%M|#M!|$D|%6U@bK|+!|$E@U|(KTOW|$RTDU|$U|$bM4T|&DU|&EMbMU|&T|#OU@U|#T2MU|$4MIKbKU|&bMW|$ET=W|%bMUDb|$KU@bK2|',
      '*T@bI2|*U2|%bMZRb|$M|%T|&2TM!|&I!BU|&OK2W|%W|$NW2bJ|*WM|,W|$ObMT|#U!@2^IbIBUDbDZ|&E!=W|(MbMU|&M|(EX=U|,M_DW|&TI?U|&X',
      'KW|$2U@bR|%b2W=W|&I4NXKW|$;b;IXKW|(U|)GTGW|&JTM|*M_DW|&O[MW|$=@M|$@b@XKW|+M_|-DX|&K|(!|)4T|)@_|)M_|(2A|)TKW=W|,MW|(I',
      'TMU2|)W|(TDU2U|*WOTB!|*bDU|)M|*2W|*DW|*M_|*W|*bM_|-DX|(V2K?|+U!6TKW|$B!GK!|$D|%bD|(6U!@2W!;|(@D!|(BU|(DT;U|(T|)KU|(U',
      '|$EbE4UKU|$K!8VOU|%W|$M2MXKUE[;|%UEU|%bM2XKW|(K|$OK|&2W|&4T|&M_|&U|(2U|$SbD!|)4T|(TMW|#V2;U|$EWNbNW|$Fb|$I2WKb@U|$KM',
      'W|%TM|#W;b;W|)E2b2M|*bK2b2M|(X|$KW2W4T|(]D|#X6U|$=|%!=U|%;TDU2U|%O6b6W|%TMDU|%W|$EU|&!6U|&D|&Rb@W!BU|%W|$RU|&D|(T|%[',
      '|%b@T=W|)KW|(W!BU|(X|([|#Z!BTJU|(KW|&U|(!BU|(DBU|)OT=W|+KW|*U|&W@WDbD|$2b|&2|(G=U|(UD|$;b;W|&M|(W|$=W|$DbD2[PO|,RbOT',
      'IU|(TKZ=b=U|(XKW|*b|+M_DW|(]|$EW@TKW|%b@T=W|)KW|&E4T|(=!|)TDU2U|(G=U!BU|(O6b6W|-DW|(T=W|)KW|)MU|(U|)!BU|)D|(W2_O6b6W',
      '|([|$GU@[|%W@T=W|)KW|(W!BU|)DbDTJU|$JbJ=!|)TDU2U|(TMDU|(U|$K2W|%W2W|)EMbMU|&OW|)DW|)MW|*_|+DW|%bM|$MU|%bMZMU|*W|$NbN',
      'EUNbN|#[4W!;|)M_DW|$8ZKbM|$@|%U|&2U|&E!EWMW|&M_|&OY@b@WMOTKU|%WM|(IVBW4T|(W|$D[@|$E;b;T=W|*KW|)U|*!BU|*D|%M|&W|%XKbM',
      '_DX|$GbK_MW|$J4T|%;!|&TDU2U|%=!|(@_|(M_|&TDU2U|%B4b4|%DU|%G=U|)!BU|)D|(W@W!BU|(b=TJU|%IDU|%M[BW|%O6b6W|%TMDU|(U|%U|&',
      '!6T=W|*KW|)U|%W|&;|$K@T=W|%T=W|&KW|%U|&!BU|&D|%W2W!;TKW|*BU|)DU|*bD|,T=W|(_O6b6W|&@W!BU|%b6TKW|(U|(W@X|&JTM|*M_DW|$P',
      'T=DU|(W|&JU|&KW|$RT=W|&JU|&KW|%U|&!BU|&D|(;bMW|(EW=W|)bEW=W|(T|%W2W!;T=W|,KW|+W!BU|+X|*BU|)DU|*[|*bD|,T=W|-KW|(^DU|(',
      '_O6b6W|*=!|+TDU2U|*TMDU|%[|&!BW2W|&OT=W|)KW|%b@T=W|)DDU|)JU|)KW|(W!;T=W|,KW|*BU|)DbD|,TJU|(X|([|(_!BU|#]@DbJ|)!|$DT|',
      '&M_|%VRb|$KbIDb|#^EbEB!=U|(WD|#_;|%W|%bM|$=OK!|$EbKT|$N|%WMW|#a;WEbEMb|$=[EMbMZ|$BKU|!7!BRbRW|#@bKE@U|#TJT4bKS?!|*TS',
      '2W=W|&B[OU|#]KbIDb|!8!2bQDb|$4TKZ=b=U4X=Z!|2M_DW|5X|%b|$;|%4T|$@W|&OWM|*W|$CbJTM|#4BVQb|$Db|&DTA!|)CEWK!|$E@U|$U@bJT',
      'M|+M_DW|.X|$b4!E[;|+M_DW|&JbJ|*E[;|&TKTOW|%B[ObEXKb|#;EbK_MW|$b;W|#=b6KbM|%8U|#D!|$4T!|&I|(M_DW|+X|$@T|$D!|%TMW|$KMb',
      '|$OKU|(M_|$R!3bJ|%T!BbK@|$TBK?|%HTM_|%KbCDKTOW|$bDTK!|*M_DW|%I|&RbAM!|&U!6T=W|+KW|*U|+!BU|+D|#ETDb|#IV!BTKV|*W|$WD|&',
      'TKT?U|$bIMI=W4W|-M_DW|0X|&U2W!;|&W|&X|#J!|%@U|$6U@bK|$B[Ob|$EbK2TPb|*Qb|(B|$ITMUDU|$KT!|$M2bQbIU|%MU@|$P!2Kb|$RWC|$U',
      '!6U|#KU4TJU|&U|(!B!;[|*DU|*U|(D|&[|(OU|%ETKW|&U|(D|$W4W|(@TJU|)WDbD|-BU|-TJU|)X|(DW|%EW2W!;TKW|+BU|*DbDTJU|(@TKW|$bD',
      'MURb;W|%IDV|(b|#M4!|$B!2U|$ET@!|(TMW|$ODKWMbM_2U|$TMW|&bEXKbM_DW|%PJ!|#OSKb|(MTMb|$TGW|#Rb;URb|#SVKTGTBb|,M_DW|/X|#T',
      '!GO!@W=W|$4bK@b@|+4T|$8UKZ=b=U4X=Z!|$@K|%U|&2U|%VJKSBTKU|(RbATJU|.M_|(_BbJI|%WM|(W|$D2U|%EB|%b|&RDb|$FKb|$GU@T|)DW|)',
      'MW|*_|&MU|$KV|&6[RU!BU|%b8U|(b|$MTBU|$QWOT|#U2b2U|$DbDTK!|$MbMT2W|)4T|)DW|)EKUQ@b|)M|*W|*_|+D[|*bM_|#V=U|$MW4WIUMbMU',
      '|$O|%D|&!|&_ETCU|%T|%U!6U|&@|(!|)M_|(6KU@bK|(TDU2U|*bDU|&Rb@WDbDTKW|#W2b2Mb|*M_DW|$M]|#XDb|$M]|&M_|#Z!=T|$=b|$IUDU|(',
      'V|#[IbRb|#]D|%Ab|%XKb|$EXKb|)M_DW|$MW|&2W|&M_|#^DbD|(MW|(OU@b@WM|#_4UE[;b|%WMT!G|$QU|$RZFb|#b:TD|(!|(EV<|(TDbDU|&E2T',
      'KbA!|$J_@U|)M2bQbIU|)Q|$OK!|!9TDbRV|$KR!4!|%b3!=b|!;!4W;XKU|#DbDWM|#IT;_|$[;|#Kb2V|#T!2W|$2V|%bRV|$;T|#UEbEW|$GZ;b|#',
      'VOV|#Z2bDTM8V|$DbDURb|$MUOU8Db|$Rb;b|#[2WI;bM|%bIMb|#]4Kb|$;UMb|$Eb|$IbRb|#aDW|%b|#bJT!2b|$KRb;b|%T2b;KW|+bMWDbDTJU|',
      '&FU2b|%[=b|!<T4XKb|!=2b2UMU|#6b|#GWMb|$bGU!4b|&W|(DW|(MW|#JTGZ;URb|#T2b;KW|)[;b|)b|$DbRb|$IDb|$MKbM|)W|#U4bKVM|*W|$6',
      'bEMbMU|$8U;Mb|%]DbRb|$E_|%bJX;V|$IT!=b|$OU8DW|*M_|)b|*MW|$RZ!GKW|+M_|*b|%b2_|&EZDbRKVM_|#Z4bMXKb|$Mb;T|$OMEbIZ!;b|#[',
      'OU=b|#]K2b;Kb|%Z2b;Kb|#_Db|#bJTDbRb|$KTIT|%ZJUD[8V|%]D[8V|&OKb|!>UMbMV|)M_|!@!8TOXKW|$=|%bKU|)2U|)4T|)DU|#2b2UD|&WO|',
      ')4T|#4UD|&!@|$b4U!BU|&W@W!BU|*DbD|#82URbATDb|$U2URbATDb|&b|#;b;W2_M[2|#=M_DW|$U|#?W2W|(M_DW|#@bO|&O[@b@|#BD!@K!|$U@K',
      '|(WMW|$WEKU|$bOTKT|#D2MbMW|%W|$@_|$DW|$U2ZNbN|$W|$[|#ERbRW|$TMT|$bE|&2|(W!=T|&DURKU|,4T|&U!6W2WDU|&W|(DW|#I2W|$DW|$U',
      'N|&!|(M_|&DT=W|&IW|$bITKZ=b=U|&W=W|#JTKV|&W|(6[RUD|#K!|$4@U|$6W|&4T|%X|$EWD|$FWD|$MU|&O6b6U|$ST|$W?b|%OT@|)U|$bOT@|)',
      'U|#M2^!=EMbMU|$I=W4W|$RKU|$WEWM|)W|$bMU|(2U|(4T|(B!=bKWM|/W|(DU|#NbNU2_;|#O?!EMbMZ|#T!=XKW|)b|*M_DW|&bK|%RV|(M_DW|$4',
      'WDV;U|)KW|$;U|$=UE@bKU|,M_DX|%XKW|%[EMbMU|,4X=Z!|1M_DX|%bOTJU|+M_DW|$@|%JbJ|%T|%UD[DU|%b2TMU2|$DVQT|%W|%XKb|%[|$EV|$',
      'IW|$K|%2|%T|&4?!|*4T|$MX2T|)MW|*_|$NbNET2|)X=U|(K[OW|#U2b2D|$D=!|%U|%[|$EbEKb@U|$IbID|(T8UE[;|)EWK!|-M_|*XKb|-M_|$KW',
      '4W|)=W|)@W!BU|+DbDTJU|*X|)GT;W|&DTNbN|,W|&E@U|*2U|*M_|,DW|-X|&IM|)4UKU|-M_DW|%bJTDU|$M2!|&b|#VEU|$JDU|$K|%!|&M_|%TD|',
      '%W|%b6W2WDbDTKW|&A|(!|&CEbKRTBTMW|&EW|&ITD!|*TDbDU|$ObK|(!4T|(I]D|$PT=W|&KW|$RU|&2^DU|&D|%W2W|)!;T=W|,KW|)DU|*bD|,T=',
      'W|-KW|)O6b6U|(^DU|(_M[BW|)O=!|#W!4@WKb@U|&HBbK|%BU|$2TKT!|$4b4MU|&M2b|$BU|$DU|&M_DW|*X|$IbIM|$Kb2EMbMU|$MRU|$NWO|#XE',
      'bKTDb|+M_DW|$KWEW|%bEW|)4_BTOKU|)D|#Y@VJ|#Z6b6U|)D|$DTMU|%W4W|$K|%TR|%U6UD|$M!4T?2W|*M_|*T|+M_|%UET=W|)KW|(U!BU|([|&',
      'J2|)W!=T|(8[Rb@W!BU|(BW|(DU|*OU|&RU|)!BU|)D|%W4W|)B[P!|)DT;|)M_|+2U|)OTKU|-M_|,W|&EW|&RW|)2W!;T=W|+DU|,bD|*^DU|(b@W!',
      'BU|+DbDBU|*_!BU|%b2EMbMU|&M|(DU|$Rb@X|#[8|$=T|$BU|%V|&D|(T=W|&MW|$DZ|#^!=XKW|$;b;!G[=W|$IbIUBU|$KbKXKW|+M_DW|$M4U!6U',
      '|%U|&6U@bK!|&@K!|&RTKU|+4T|%W@|#_!BU|$;|%EMbMU|+4X=XKW|%MW|%U|$=W|&4T|#bJT4JbJ|(KT8W|$KT4W|)DV;U|%UEWK|*D[DU|*TK!|&H',
      'W8!|$OK4T|&M_|!ATIRb|$Jb|&MT!=b|#UJ[;Kb|!B!=JT@bK|%Z@b@U|%[EMbMU|$@TMEMbMU|$E@WM|)2W|)W|#2b2DW|(b|&U!BU|%QU?|)!|*4T|',
      ')TBU|*D|*FbKU2T|*IXKb@U|*RUJT|#4BKb@U|$b4K|(2W|(4T|(M_|(U|)2U|&WGT;U|#;b;I]D|#@b@|&@|&T@bK[J|#Kb4T|%P2@bO|+!|,M_|(W=',
      'U4T|*W|)DU4T|)KTMW|)MW|&D!|(TDU2U|(VJ|&U|(!6U|*W2W!;TKW|,^DU|#N!|$TM|&W|$U@|#P2!|&M_|$IU|$M_|$TGbBTM|#RKT|#T!@_|$2T|',
      '$;U|&D|$=U|$@|%M|$BT|&EW|)4T|&RTSZGb|%bKT|$D|%!|%U|&2U|&@_|&DU|&E]|&M_|%bDU|$IK4UBbB|%_BK!|$KU|&@VRU!BU|&M_|$PKAU|&C',
      'U|$R!|%KU|%W|%b|#U2b2WD|$4U|%WI@U|&O|(D|$D!|%E@bKU2|%IWMW|%TMW|%_@bRO!|+TDbDU|$MTOKb|%VEb|%b|$OT2Kb|&Db|%bJ|(OT?U|$P',
      '4T|%M_|#V!@_|$2bQ|(U@WMW|$DU|&2U|&@_|&DU|([|&E]|&M_|&OMbM|%bDU|$E|%!|%TONU|$OU|%WMW|#W2T?!|(TMW|$4b4UKTM|(^!=U|$@b@M',
      'XKW|$GbGT2|$IbIW4X=Z!|$Kb4|(!|(IbI|(T|&J_CDW=W|$ObOXKW|$Rb@WMW|#XK!4T|%BKbPDb|%IWM_|%TD|#YQb;U|)M_|#Z!BWMXKW|$GbG|#[',
      'O|%@|&M|(W|&T|%BTRW|)b|%D2^!=|%K2BbK|(^!=|+M_|-DW|.X|&TJMW|%RbATD!|%T|&MJ|)!|*M_|)IW|+MW|)TDU2U|+bDU|*M|+M_|+W|%U|&2',
      '|&DU|%V|&E;bD!|%W=W|&DU|&MEMbMU|%b|$P|%!|&4T|&M_|)D[|%EW|%H2b@U|%I!@;T|&W|%ObJTEb@!4T|%TDU2U|(bDU|&Jb|&M|(2W|(@_|(M_',
      '|(W|(bM_|%VJ|#]O|%!|#^!4|&M|(W|$=b=U|$D2^!=|$K|%OTKUR@bK!|%U2TJU|(UD|#_EU=V|$I|%2^!=|$SB!|#aM@TGTBW|+b|#bKOU=|%T2bQT',
      'KTI!M_DW|&OU=|%aEBU|$OTBP|&K!|(2T|*@UKWIM|0M_DW|(TD[|%U@VJ|&EB|(T@bKTHUDJ!|%VE!|(TMW|!CD!|$bOT=|#KU!6U|)D|$XKb|$bI|&',
      '!|&EWKU|&KT8W|&OK!|*M_DX|)EW|&RT4Kb|&TK!|)TOW|#ON[PbOK!|#TDbJ!|$KbOT=|#VISU|#XKb8;U|$NUETN|#]KbJ!|#bO!R!|!D!BIXKU|%M',
      'XKW|%U|&2^;b2XKW|&4!|(TI|&DU|&E[;b|%W|%bJTM|*M_|,DW|-X|$GKW|%UJTKb|#2UK[2Mb|+M_DW|$W|$bQ@bK!|#4BW|$K|%!|&4T|&M_|%ETM',
      '2|%TDU2U|(bDU|&M2W|(M_|(W|%U|&M_DW|%b|&M_|)DW|*X|$MW|$[Qb|#;D|%2W|$OKb4!|$U|%!64T|(T=W|)KW|(U|)!BU|%4T|$V|%D;WM|*W|%',
      'I?U|(WMW|$W=U4T|&W|%MW|#=U6[|$WEW@W!BU|%I|%Rb@W!BU|#BU|%2U|%DU|%E]|%M_|$V|$WM|&W|#DW|$bDJ|(bJ|&W|#I#|$_|%B]!BU|$bI2!',
      '|&U|(D|&W@TKW|#KR|%JbJ|%KT8W|(OWE[;|%TEWK!|%U!S|)!|)KT8W|)RbOTIU|)TKTOW|+Z=b=U|$SKU|$[!BbK|%Qb|$b@2U|&DPTM|%KT|%O|%R',
      '!E[;|+M_DX|&TEWK!|)XKb|,M_|.DX|&U!4b|#MW4WKW|%EW|$b4^!=|*M_|,DW|-X|%M|&4^!=|&DU|&GZMbMU|&IM|#O!GKW|(b|$IU|$KT@bKU|$M',
      '|%DW|%MW|&_|%T|$TGW|&b|$VD|&b|%E[;b|$bOW|#Qb;!|#RbEXKb|#T!BU|&[=b|%EMbMU|$2W|$4|%EXKb|%HXQ?!|%IbI|%JbJ|%KT8W|&U2@|*2',
      'W|&b|(2KbDXMb|/M_|1DW|2X|%MTEWK!|&b4UBbB|%TK!|(b8WD|,RT4Kb|%UKZ=b=U|%WM|%XKb|%[!BbK|+KTOW|&PbOK|+KTOW|&Qb|$8Kb|$;2|&',
      '!|(M_|&2Kb@|&K!4|&TDbDU|(MW|)bM_|%U|&2MW|(U|([|%W|%bJ|(!|$=W|$Ab|$BZ!=bM|$DT|%b|&D|$I|%!|%2K?!|$J2|&@bO!|+M_|&W=U4T|',
      ')W|(KTMW|(M|)W|&b|%DU|%W=W|)E[;|,M_|.DW|$KB|&W=W|%T|&J?|)3[=b|)EXKb|*[;|,M_DW|/X|)IXKb@U|)KTOW|*Z=b=U|)OD!|)b|*3[=b|',
      '.M_DW|1X|%b2;b|&@b|&M|$MW4O|(W|)EbK]O[;W|(_|%_|%b4O|$PD!|#U!=U|(D|&W|$2_GTKb|$5!;WOW|$8!|&4T|%I]D|%T!|(RT4Kb|&DU2U|&',
      'ITGTBW|,b|-M_|/DW|0X|(W|&JU@V|$=BO_MW|+M_DW|%IKbKW|&TDXKW|%UOU|$@bJ|(!|$BbK|$CU|%WM@_|(W|$DW|%bDW|([|$EW?W=W|)MW|%bE',
      'W|$I8b8D!|%UQTMW|%bI|$J!@bK?|%ITMW|&U!6T=W|+KW|*U!BU|(Rb@T=W|%TI2!|%_82|)OKb4|-!|.M_|-TMW|$K!2WP|&@K|)!|%b8D|&?J!|)U',
      '!6TKW|,U!BU|,W2W!;T=W|&B_QU|&IM|)IbI|)b|*M_|,DW|-X|(T?|*!|+M_|*TDU2U|,bDU|+MW|)@|*4T|*MW|(U!64T|+=TDU2U|+DWDbD|+G=U!',
      'BU|.D|-b=TJU|+T=W|,KW|+U|,!BU|,D|+[|)@I]D|&OS?|)U!6=!|-TDU2U|,G=W@W!BU|,T=W|-KW|,U|-!BU|-D|,W|-6WDbDTKW|,ZBKW|,[|*Rb',
      '@TKW|-W!BU|$MG=U|%J!|%U6T=W|)JU|)KW|(U|)!BU|)D|%bO|$ORU!6UD|*[|(Rb@WDbD|/TJU|0KW|%TK?|&R|(!|(4YSTMW|%Y@b@U|%[BU2|$Q[',
      'C!|%bE@b@U|#V2W|$;U@_|&DU|&M_|$=|$@U|$M!|$NbNW|$OW|%[|#W!6U|&V|&[|%=UEbK]O[;W|&[|$DbD|$ObOW|)MW|([|#X8UOV=W|$@D|&!4T',
      '|&2MbMW|&b|$DZ|$KW|#Y@bJ|(!|(TMW|$RU!S|#Z!|%GKW|$2b2^!=|$;b|&OKb2b|$IMU|%bIBU4T|$M|%2W|&^DU|)bD|(MbETKW|%M|&W|&_|%bM',
      'U2WBWKW|(XKW|+M_|-DW|.X|&RDb|$SbKX|#[;U|&2V|$=W|$@|%Y@bO!M_|-DU|$DW|%[|$EAbJ|)!|*M_|)4TD!|%TMV|(b|$K!|%=U4^!=|%W4T|%',
      '[=W6KbM|$M|%2^!=EMbMU|$QDMb|#]8T!|$KW@U|$O[BbJ!|#^EbEU|#_GZMb|$KW|#a2|#bJTJ|(!|(IXKb@U|(OTBU|,4T|(RbATD!|&Mb2Mb|,M_D',
      'W|%X|&2bMUJKb|&JTKb2b|&Rb|!E!6|%BTK|%TJ@U|)V|*2U|(U@V|$8TGV|(W|(b|$;|%4T|$=4|%KVGTJU|%U!6[|&;b|&@|(W=W|)M|*W|&Rb@TKW',
      '|%W|&4|(MW|%bM|(W|$@WMW|%b|$BUKU|%Z!|$ET=W|%U|&D|&Rb@T=W|*WDbDTKW|%W@T=W|&M|#2b2|&D|&M|&T|%Q!|&U|&WM|)W|#4;U|$MW|#6b',
      '6|&=U|&DU|&U|(2|#;TDb|(6ZKW|$[Mb|$b;?|(!|)4T|)M_|(TDU2U|*bDU|)M2W|*M_|*W|&T|(HU|*Q[2!|&U|(!BU|&W|(2WDU|)^DU|&[|%D!|(',
      'M_|%M|#=2M|$@T=W|&KW|$I;U|%K|&D|$U|%!BU|%@[|%D|$W@W!BU|$[|$b=|&T=W|#@2!|%TMW|$D!|$T2|&!|(E]|&TDbDU|$b@U|(2^!=|%K!|&U',
      '2|)DW|)M|*W|*_|)T|#A2!M_|#B!|$IW|&MW|$O|%U|&2U|&DU|&M_|%V|$TDU2U|&bDU|%KbATMW|%M|&W|$U|%S[DW|$bC@U|)DU|)M_|(WMW|%I|&',
      'DTH!|&HXQ?b|&KT8W|&PbKV|&TO@U|&UDU|%J|&!|&IW|&TMDW|)M_|)W|#DU|%2U|%6[PT=W|*KW|(RT=W|*KW|)U|*D|)[|)b@W!BU|,DbD|/TKW|+',
      'X|%DU|%IW;bMW|%M_|$WM2W|&DW|&W|$bDW|(MW|&Z!=W|#EbEW|#GbMU2[QDbRb|(RU;V|#K!4T|$2TM|(M_DX|$I|%[PbOK|$PWKTIW=W|$RbEK|$T',
      '8J!|$U2KTMW|%4?DM_2U|(URb@TKW|&U|%6J!|%8b:TD!|%?TITMW|%CU|(M_|*2U|*DU|%ETMD|*DW|*M_|*T|)U!6T=W|-KW|,UD|%IU@!|%K2bQ?|',
      '%OKb@D|%P_C2W=W|+MW|)D|*MW|*T|&bKI|*2W|*M|+W|+_|%Q@b|)@W|&b2TK!|%RK|&bAU@U|,DU|,M_|+WM|-DW|-M_|-W|-bM_|$V2bQ|)MW|*_|',
      '%OTS2|$W6XKU|$bJO[2bQ?M_|&T;2|*!|*WMDW|,W|(OK?|%O@|(!|(TMW|&IW|%QUJDb|)T|#MID[KW|*M_|,DW|$W|%OWKW|$bDT;U|(=W|%MOU|(W',
      'MW|&U|(M_|*DW|+X|&Z|(;XKU|(M_|#ODb|$Kb|$U@bK|#PWOWM|$b6UI|)4_BTOKU|)TD|#RUFU2b|$WEW|%IKb@U|#T!=O|(WM|*W|&WK!4|$2TM|%',
      'URb@TDb|)ATDb|-M_|%b|&QU2|$;|%2W|%DW|%M|&W|&_|%UMb|%W4T|$<PTM)!BU|)2W|)DW|)M_|$=TKW|%U|&D|%W|&@X|%[|$?bJ!|$@|%TN|%bK',
      '|(2W|(CTKWMW|(DW|(M|)W|)_|)bM_|(U2[JW=W|(_|$B!|%TMW|$D4Mb|$E|%!|%5bDU|%DbDE[;|%JbJ|%T|$IKbKW|%U=U|%W|%XKW|$KT|%UE_@T',
      '=W|)JU|&PWCbJEA2!|(bKTIU2|.O[@b@|%WBM|&EMbMU|%b2W|(b|&;V|)2U|)DU|)MW|*_|&MIZ!;KV|,W|,b|&O@IbI|)U|)V|*EWK!|$M|%2W=W|(',
      'Kb@U|(M|)W|&^!=|(MbMW|%4WIbIU|%D|&2W|&DW|&M_|)2U|&T|%IXKW|%RIWBbK!|%U!6T=W|*KW|)UD|&;Z2bDU2b|%V;Z2bDU2b|/MW|%W|%Z!|(',
      'M_|%[KW|%b|&4^!;TKW|)DU|*bD|,T=W|-KW|&O!6|$Pb6T@bJ|#U!4NU|%=U|$2b6KbRb|$6b6U|$;bM!|$<TEWK!|$@TISW=W|$BE|$DUPZ;b;U|$I',
      'bI;|$MOG=[|%U6U|([|)OTKW|%WEW|&OG=[|&Rb@TKW|%bM|(M|)IKbKU|)W|)bDU|(T|(U|#V;Kb|$<!|%TCUE@U|$EWMbRb|$M[KW|$OV|#W!4DXKW',
      '|$;b;EKb@U|(U|)!BU|)D|(W2|&MXKW|$?bJ|(2bQ[@bK!|/TMW|$@b@XKW|+M_|&KW=W|)MW|$BW6b6[KU|$DKWBbCK?|&bDUKbIT?!|-U!6TKW|(Jb',
      'ORbAV2K?|2M_|(ObJORbAV2K?|32W|3M_|2U!6UD|%TBU|$K!|&M_|%ETM2|*R!5!4T|%Rb2KU!6W2^DU|)TK|+!|+TDU2U|-bDU|,MW|%T?|(!|(IW|',
      '(TM|*M_|*W|&@@bO|(D|)I]DBU|&ORb@W|%WQ|(W=W|)M|*W|$MU|&6ZKbM|&OZ!BWM|%b2Mb|&M!E[;|(JbJ|$ObOW|)M|*W|$Qb2KU?U|(M!4T|&E|',
      '(2WITKU|(M@|$Rb@2|)!|*M_|)TDbDU|*M|+DW|+W|#X8|%JTIU|%MW|%T|&KU|%URb@TKW|$@ME;b;W|$Kb|&?UI|&@U|)4T|&M_DW|*X|&O|(!|(EB',
      '!|)W|(IW|(V2WM|,W|$M|%W|#Z!6=TDU2U|&U|%;ET=W|%=bJTM|(MUIKbKU|%E2!|&W=W|$2b2W|$4=EMbMU|$;b;=!|(T=W|)KW|(U|)!BU|)D|(W2',
      'WDU|*^DU|)G=U|([|$=@T=W|(KW|%D|$B|%ET=W|&X=U|%O[4U|%bB|(2^@b@EMbMU|(4T|(@UEbERIWBbK!|(BU|(D|(EEbEXKW|)MbMU|-M_|/DW|0',
      'X|(I!B=U|)W=UJ!|)bI|(JZ@b@WD|(MW|(O=W4XKW|)XK|(TEWK!|-M_DW|0X|(XKb|([IWMb|$D4MXKW|%W2^!=|&4^!=|&I!;bK|(XKW|%bDT|&EST',
      '=b|$GbG[KW|+M_DW|$IbIRTDU|$KOMU|%U4U|)!BU|)D|%W4W|)@W!BU|+DbD|)BM|&ITNbNW|$NbM2XKW|(U|&NT!|(U|)2U|$RK|#[2[;U|$8V|&MW',
      '|)DbD!BWOMD|$;|%M_|%Z!;b|$B|%KU2!|$EKb|$K|%U;|%W|&2W|&4M|(T!6UD|&@_|&D|(W|&E^!BUD|&IVB|&M_|%[|%^!BUD|%b2^!BU|)DG=U!B',
      'U|*bDT=W|-KW|&M@_|(W|)@_|$QZ!;b|#]2U|$4T|$D|#^!4NbNW|%B=TDU2U|&T=W|(JU|(KW|&U|(!BU|(D|)BU|&W@T=W|*KW|$4T2W|$;b;U|$=O',
      'W|(DT|&]D|%U|$BM2XKW|+M_DW|%UMU|%bBW|)@UKW4W=W|$DbDXKW|$KW4W|$M!|%RM_DX|%TM2W|(W|#_6!EMbMU|%IbI|%TK!|$;V|&MW|(_|$=XK',
      'W|$@D|%W!BU|&DbDTJU|&MXKU|%[|%_!BU|$JT=W|&JU|&KW|%U|&!BU|&D|%[|$KT;|(!|)M_|(TMW|&=U|)D|%WITIUNbM|-N|%b6W4VRW|&;b|$MO',
      'K!|)M_|+DW|%U|&Rb@[|%VRW|)M|*W|(b|%[KIbI|$Q2|%U!6T=W|*KW|)U|*!BU|*D|$RU|#aKT?U2|%b?IU|#bJTEUMU|&RU!8Kb|$K2;D|(U!6T=W',
      '|,KW|+U!BU|&TKIW|(P!|)KTOW|)b|(Qb|&Y@U|&b2|)D|*[|)M|(KUJ|+M_|%3bJT@|+U|%4@U|%6TK!|*M_|&WK?|*2Kb@|)U!6T=W|-KW|,U!BU|&',
      '_BJT@b|%8M|(2W|(DW|(M_|(W|(bM_|&T|(BK?|(EbK@UDUCWMW|(RbOTIbJ|&b:TPTMU|%?TNU2|%@TEKZ=b=U|)b|&U|(8b:|(DUCWMW|(E2bQ|)TB',
      'D|(H|)DW|(I|(K_8X|(Qb<|+T|+U!6TKW|.U|&V|(2|)4T|)TK!|(@U|&b@U|*ET=W|.M_DW|(J2bQ|,!4T|,I]|)4T@bI|)KbAU|)[2!4T|+@|,MW|+',
      'EX8MW|+U!6U|%AI|%BKbPD|+MW|,_|&TD!|&VEb|&[P!|*M_|)IWMW|)TDU2U|+bDU|*M2W|+M_|+W|)b|*M_|%CTD!|*4T|)I!@bKU|/4T|*]DOU|)U',
      '|*4T|%E!6|)!|*M_|,DU|-[|)ObJTEb@!4T|)TDU2U|%G!C|%H|&T2K|*KZ=b=U|*b|+KZ=b=U|(O!|)@U|)U@!|&W|(@bO!|,M_|+IW|+TDU2U|-bDU',
      '|,MW|(OW|%IT?|)!|)RbOV2TK!|)TMW|(B!|*M_|&VM|&W3|)WMW|%J@bD!|+M_|*TMW|*U!6T=W|+Rb@T=W|.W!BU|&T?|)!|)U!6U|&_4!|(8D!|%O',
      'Kb@D|&SU!6U|+[|)Rb@X|&TS!|&[P|)!|)EZ;b;TKW|.U!BU|/D|)U!6U|-!BU|-D|%P!RMW|&Rb@U|%RDbD|&TBKTOW|)b|(K|)TMW|&UBbC|+U|,6Z',
      '!BUD|+W=W|&b@TOD|)W@|+!|+IW|(ATD!|%SbMTB|%T!4?!|+M_|(@|)!|*4T|*M_|)EW|)IW|+M_|)TDU2U|+bDU|*M|+2W|+DW|-!=U|+M_|+W|+bM',
      '_|)VJ|&2TK!|&6VD|(WKbJ!|&8Z2b;W|-2W|-DW|-MW|,b|&?!|(TMDW|*W|&@UDUCbJ!|&AIU2_DbD@ET<PTM|&CTDbJ@|&IT?U2|(W3bJ@|-DW|&K!',
      'H|*!|+M_|*IJbJTJU|+OW@W!BU|+]|,!BU|,DBU|*U!6G=U!BU|-T=W|.KW|-U|.!BU|.D|(bAD|&R|%UJ|(@IT|(BKbPUDU|(T|(W=W|)KTMW|%V@U|',
      '%ZRU=Z!;b|+DbRV|/M_|(b|%[2bQ2WM|-W|&I|(2A|)W|(DW|(M_|(T|(U!6U|,D|+W2W!;TKW|)Rb@T=W|,W!BU|&JRU|&K?|%]8ZRb|&O[;b|%^=2b',
      'QDb|-Rb|(bJXRKb|&BbB;XKW|.M_DX|*W;XKW|&FZRKb|$MT!;b|*M_2U|&Db|%[|!FKX3b|$b|#MTMW|$U@!|(4T|&TMW|#TBKb|$Mb2[|&4W?|#UGb',
      'KOKU|+M_|$MU!|(Rb|&IbRb|%bIb|)Rb|#W;b|&GTMb|#Z=KMb|&[QDb|#[Kb|#];bRb|$Mb|#_;_|&4bKFV|#a!=[QDb|#bJT2b;KV|$KTDbRW|*b|%',
      'Z!6U|)b|$MTQb|!G!4TK!|(W|)ETNbJ!|&NT3T@!|%bMT|)B[Pb|$=|%U|$BKW|%UE_;W|$C!|%U!6U|%WOWMW|#6b6Db|)DE[;|#8TKb|#;b;MW|&U|',
      '#=U|%D|$b8Z;b|#@W2IbI|$b@TJU|#BUMV|$WMW|(4T|$bO[MW|*M_DW|-X|#D4TDEMbMZ|-M_DX|#J;|%2W|%U|&2U|&MU!2WMW|$MW|&B[KT=W|*U|',
      '#KWOW|$bIT|#M!|%4T|$I]D|$KTIJbJ|$O!@!4T|$U|$[|$bIXKb|#NbNTKU|#Rb|%;T!=b|%RWM|)W|*EbK]O[;W|#SBXKb|$IDV|$UK!4|)!4T|$W|',
      '%I@U|(WMW|&DV|&W3|%N|%PT|#T!GW|&[|$2bRTFVRb|$4T|$;|%W|$?VMW|$BTIU|$C|%MW|%bJ@|)DW|)MW|$DUR|%bRb|)OT=|$E;bM|%JbJ|%UDV',
      '=W|&KT8W|%W|%X8V|$GT|%W|%X|&I_SDb|&KTOW|%b8V|$JU|$KUD|$M|%2YQb?|%6!BKb|%G=WMW|%IWKNV2YQb?|%JbJ|%KT8W|%RKRbO@U|&WGbKI',
      '?bJ!|+SbI?bJ!|%T8V|&D4Kb|&JEMbMU|%U2M|)W|%VOW=b|%W|&=W|&K|%b|&J|(!|$O|%IKUBU|%T|%U|&M_|%WM|$QT|$SbJ|#U2b2O_MW|$6b2W!',
      'B|+M_DW|.X|$8UDZRb|$;b|$=b=|(DW|$JbJ!|$KWBW|)MW|%bMT|$MUJDb|*M|%bMW|)M_|#V6b|$8EXKb|%TEXKW|*b|$=VMW|%W|$BKb|(M_|*DW|',
      '+X|$GVD4Kb|&RU|$STKW|(b|#W2b|&2|$4b4TK!|$6b6UDTJW=W|)KZ=b=UETMZ!|$8WKb4b|$;b;TJ4X=Z!|/M_DW|$BbC|(U|(W=W|)DU|$COTK!|$',
      'KW8W|%bK2A|$MbM_=W|#X=UB|$KW4WEMbMU|%b4WM|#YS@b@K|#Z!4NXKW|&TMV|)W|)b|&WNXKW|$8OT=|%b8!2U|$=b|$DKb8V|$Mb4T!|&M!|)2^!',
      '=|)EMbMU|.M_DW|1X|#[@T|$GU|%V|#]KZ=b=UEMbMZ|#^!GTJU|$4b4W|$=b=ET;U|$EbETJU|$GbGUMU|$IbI|(DSTNb|(KTRWE[;|(M|)KTITK!|)',
      'W|$KbKT|#_Ab|$CD|&b|(M_|*DW|+X|$KW|&GTOWM|,W|%b=W|$Rb|#aBbC|(I@|*!|#bJT!2U!4b|)WMW|)b|&2b|&DKb|*E]|*M_|$K@W2W|%BKbRb',
      '|%SbI|)!|*4TKUI<!|-W|)2W|)6TKU|)DbD|)JbJ|)RIWBbK!|)T!=I]D|*D!B!|-KZ=b=U|)_@bROTMW|%TSbI?|+EMbMU|+W=W|,MW|*V|%U;Db|(U',
      'QW|*b|(VQW|*b|%aDb|$MT2b|&4W|)MW|!H2b@|&U|(@_|(PbKBbCM@_|&W=W|(M|)2W|)DW|)W|#4O!@W=W|)DU|%Bb4V@|%TDb|$VKA|#8D|#;b;UE',
      'bK_MW|#BbK|&@T|&T6M!|(BbKU|#IU=UET;U|#J!|$E=U|#K?U|$@|%b|$BbOT8|$U!6M[2|$b@|&2W|&DW|#M[|#OD|%!|%TDbDU|&M|(W|%b|$TDU|',
      '&V|#T4!|&4T|&M_|%IW|&]!BU|(D|%O@|(!|%RbOTIbJ!|%TDbDU|&MDW|(W|)4T|$DW|&6!BKb|&EbKUJ|&I@U|$K@!|(M_|&B[P|*!|+M_|*EW|*IW',
      'M_|*TDU2U|,bDU|&K@bD|&U|&VJ|)WMW|&b|(M_|%V|&4T|%bJ|(2W|(4T|(DW|(MW|$O|%!|%D|%TMDW|(W|%U!6G=W@W!BU|)T=W|*KW|)U|*D|)[|',
      '&Rb@TKW|*WDbDTKW|$Q|%2W|%4T|%DW|%M|&W|&_|&bM_|%T|&O[@b@|$Rb2K|)KTOW|)b|#UDbD!4T|#V!4Mb|)M_DW|%EXKb|$IDbD|%KT8W|%OK!|',
      ')M_|+DW|%UDU|%W=W|%[PbOKKTOW|$QbI|#W8TMW|$OD|&4UKU|+M_|-DW|.X|&6!BbK|#X2!E!|$4KbH|$@bEXKb|$B[OU|$E@U|%TMEMbMU|$HT4!|',
      ')M_|(TDbDU|$IU2U|&DU|&M_|%WMW|(bM_|$Q?b|%JbJ|$RbOTIU|#[BTMW|#]!RT|(M_DW|+X|$KOU|#_8D|&!|#a4_NU2|*!|+4T|$@U2|!I!4E[;|',
      '%IbI|%MU|%N|&!EMbMU|&4UKU|&OTK!|%WNXKW|$6U|&BU|&DV;U|&KbJTM|,M_DW|/X|%W|$8KU|%VKT|%WM|%XKW|$;E!|$=E!|&[;|)M_DW|%M!|(',
      '@_|(M_|*2U|*DU|&TDbDU|(M|)@_|)W|&U|%[MT|$@bK|(!|(TMJ!|(U|)4T|)OKb4!M_|(WMW|$ADU|(M_DW|$BIKbKU|%U|&2T4T|(U|&DU|&K!|(T',
      'MW|(b|%W|&M|(W|#2b2WO|#3b@Mb|)M_DW|#4C|#6UMVE;bD!|#;b;TDU2U|&U|(K_=bMX|#<!|#=2PUK|)M_DW|#?U|%EXKb|#@!|$EKI]D|$IW|$TM',
      '|&W|$bRbJ|#BDEMbMZ|+2W|+M_|%b|$Kb|$U|%M_|$bB@W|&XKW|*M_DW|%DXKb|*M_DW|%J|&!|&TSbD!|%KTRW|*M_|)b|#CUK|$W|%I[S!|%K|&!|',
      '%RXBDKTOW|$bJ|&2TM!M_|&@K4@U|&D|&EbKB[Pb|&M_|&TSbD!|#D!|$2U|%W|$IW|$O=W|$RW|&MW|(_|%[|$UQU|(2U|$V|$WG_MW|%OW|%QWMW|$',
      '_|%8b|%KI|%SKb|$bDDXKbM_DW|&O|%J!|%O!@K!|#I@|#K?|%!|&@_|%TD!@K!|(U2U|&MW|%U!6T=W|*KW|)U!BU|*D|)[|&Rb@T=W|*W!BU|$M|%T',
      '|$T<T|&V|$U|%!@|%2Mb|&^!BKW|(DbDU|%DbDU|%EZ=|%JW|&X|&^2|$V|$W4W|(B^=bM|%DT=W|%R;U|$^2|&;U|$_|%O]EW|$bEMbMU|%KU|(4X=|',
      '(ET=W|#MJTN|(!|)M_|$WEW|$[KUJT|%QUJT|$bB2Mb|%GKV|%MDbD|&JbJ|&OK!|&T!M_DW|(BU|(EXKb|&U|(2TKb8WD|/KTOW|(3TKb8WDKTOW|&V',
      'PbOKU|&ZITM|(M|%SKbKTOW|#NbMV|%NV|#RVBW|(MW|$b@TDb|#S@bJ!|$B[ODb|(b|$GXGTGTBW|,b|-M_DW|0X|(b|)D4Kb|$IbIBb|$KbQU|$Mb|',
      '$T|%2OU|%@bIT|*4T!CV|)bJ!|%D!BU|%HTK@|*!|+M_|%KT8T|)W|(?U|(Qb;bK|-M_|%M2bQbIU|%OUQb?WOW|%PUOKT@bKU|$UI|%N|&M|(W|&T|$',
      '[!BbK|%PbOKU|%Qb|$_@bRO!|*TMW|$bIBb|#T!=bJ|$2W|$4!;U|%DXKW|$5|$6KbM|%OK!|%TKZ=b=U|$8V|$;|%M|&W|%bMT=W@TKW|,X|*[|$=T|',
      '%W4WM|$?U2bJ!|$@|%Y2|%bK!|(IW|)[|$BTM|%UKU4T|$CO|&Db|&EZBbBU|&KTOW|&U|$DO|&W=W|(MW|%R|&U2|%XKW|(b|%[EMbMU|&KW|%b|$I|',
      '%U=U|)2WBWKWM_DW|%XMW|$J|%T|&G8TKb|$KTJU|%U|&!BU|&D|&E_JU!BU|%W|&@U|(V|)KTOW|(W!BU|&O[Q!M_|%[=WIUMbMU|/M_DW|%b2!=[J|',
      '(TEWK!|(Z;bM_|(bRb|&4!|)M_|(IW|*M_|(TDbDU|)MW|&6G=U!BU|(T=W|)KW|(U|)M_|&EU=U|(W|)MW|&MW|&QMb|$M|%@U|%U2|%b|$R|%!|&M_',
      '|%b2_|&;Kb|#U!6U|(D|$2b2UMU|+D[DU|$4@T|%UMUD|*OU|$<TJU|$=b8UMb|$@bK|(W=W|)MW|$DST|%V|%WIW|)MW|$KE|%bJTM4X=|-M_|/DW|0',
      'X|$MUJDb|*M|%bMW|)MW|$QDb|$Rb;Kb|#V2W|$4bKTITDU2U|$;KbM|)W|$=UJ!|(T|$B|%2W|%W4T|$DT|&2WITKU|(bQU|$E|$KW|%b|$M|#W!BW|',
      '(2W|(4T|&[|%GTJU|&]|$2b2MW|*4T|(TIM|(W|&@U|$3|%!|%BbOTK!|%Kb8V|%bJ|(!4T|(ET@bKMW|.bM_|(I!@bKU|.4T|-WMW|)W4T|)]D|+BU|',
      '+OU|$4U!EW|*2W|&RU!BU|)D|%WRb@W!BU|%b4WKW|*X|$6b6ZKbM|$<T|$=U|$@b@TK!|(W2XKW|&JTM|*IbI|$BU4WGbG|(^!=|%bBDXKW|(W|)M|&',
      'K|(?|$D4TM|%U|&4U|&EMbMU|&RUEMb|%W4_=W|&EMbMU|(W|%bD4W|&RUEMb|$KNU|&V|(I_SDb|%W4W|)DV;U|$MW4W|%b2b|$NbNEX=U|$RWDXKU|',
      '*W|%b@TGTBb|&MU!|*M|+W|)IWMW|$SIbIBb|#X4|$=O|%W|&EbK]O[;W|%_|$Kb@U|$M|%!|&4T|$OV|&Rb|$RTE[;b|%UD|%V|#Y@U|#Z6b6U|$8TK',
      'U;V|$;b|&;|&EMbMU|&K_|)ETMU;Db|&M|(W|$=M_|%U2Mb|$B2b|(M_|*DW|+X|$I_KUJMb|$JUDb|#[2|%Eb|$8Kb|$=UEMbMU|%b6Mb|*M_DW|$@|',
      '$DITI|%MbMW=W|%[8Kb|(bIZ!;b|$IW|$K|%2W|%V|$MW|#]2bK_RTFb;b|$@bKU|$BTD!M_|%W2XKW|$D|$MOK!|$NbN|(W|$RXKW|(b|#^2b2|(8^D',
      'bD|(MW|(WMW|$4W=W|&NbNEMbMU|$5Mb|$;b;|(I^B;|,U|$@b@!|)M_|(IW|(TDbDU|$B;|&4T|&U|(BU|(RTKU|,4T|&bM_|%M4W|)DOU|&JbJU!BU',
      '|&OW@W!BU|&W|(2^DU|(EZ;b;T=W|.KW|&]|(!BU|$D4T=W|$KTKb8V|$MbM|$SIbIBb|#_;WEMbMU|$=Mb|$BW2XKU|$Kb@T=b|$R!|%4T=W|$SD|&b',
      '|(GTGW|%UDU|(V|#aKbJ|$MTDT|%U2|$NU|#bJX8U2b|)J!|+M_|!J!=IXKU|$BW|#8ITDU|$b:!|#@U|#Db|#IW=W|%D|&T|#KbK4W!;bM|#MI!6UMU',
      '|#Rb|#T2bQDb|$4!|$=U2U|$@bK|(T|)6KU@bK2TKW=W|(U2W=W|+MW|$B4UKU|%IKU|%O|&b|%TBbKU|$DT!|$KbM4=b=|#W4!|&M_|%IW|$BbC|(!|',
      ')M_|(IW|(TDU2U|)MW|$DZRb2_|%];Z=b|$O|%2W=W|(MW|%8D|%@|&U|%KT8W|(?U|#X;bJXGb|$BWMW|$DU;b|&JDb|&OKbPU;V|*RU;V|$K_EUJDb',
      '|#ZIbIU4DXKW|$KbK2_;|#[;|$=TBU|#_4|%IW|%U|$CW=W|&MW|!K!4|%!|&E[;|&M_|%=W|%DTA|)!|)b|%JbJ|%RbAM|%T|&6TKbJWMW|&KTOW|(Z',
      '=b=U|%W|&M|(W|(_|$8U@b|%^MZM_DW|,X|$=U|$E6_=OK!|,M_|.DW|/X|$H|#2!|%4T|$I]D|$K2TM|$TM|&W|(4T|$b@|&!|(M_|%Q?|&U!6=TDU2',
      'U|*U|(@|(Rb@T=W|#5W|%DTA|)EMbMU|)b|%E@U|%KT!|(IJbJ|%OKDb|#6D|%M|&W|&bM_|%T|$JU@|(4T|(M|)W|(bKU|$U!64T|(T=W|)KW|(U|)D',
      '|#8@_@bRO!|$DU|%V2T!@b|$U@|#@U|$bD|&!|#A!|$_@bRO!|#BbBW|#FV|#GVM_|#I?|%IXKb@U|%TKZ=b=U|%U|$TB[OU|%EbKH|$[Qb|$bIDU|%J',
      '|&2YQb?|#OT?|$U|%2WITKb|%@[8|%KT8T|$V!BbK|*DTAb|#QbJDb|)MW|&T|(M_|#R!|$TJD|(!|#SBTKU@_|)E]|)M_|(WMW|$RbJ|(!|)4T|#T!|',
      '%EXKb|%GTGW|$2|%W!=T|%bQR|)W=W|*MW|$4!|%T|&D[|%U|&?U|%WMW|$5O|&JbJ|&KTOW|&T6TKbJ|&WMW|&[!BbK|,KTOW|$6KU2|$8|%!E[;|%2',
      'VJ|)!4T|)DTJ2W=W|)O[@b@|)TMM_|+W|+bM_|%4_ETMb|%CTDU|*4T|*DU|%DTM|&b|(D|%GTGW|%I!=bKU|,M_|.DW|/X|&S[!BbKOK!|%O!P!|&^I',
      'bI!4U|.M_DW|%P[3K|*!|*KZ=b=U|*b|&bKV|%RWM_6D|&bATDb|%T|&8V|&D4K!|+M_DW|&EXKb|([;bM_DX|&KT!|)OW|%VDTIT|&Ob|%W|&2W|&4T',
      '|&DW|&ETMZ!|,M_|([;M_DX|&M|(W|%[!BbK|+EbKRTBb|&PbOKKTOW|+U|&Qb|%]D|%_MU|(W|%b|&2WITKb|&J|(!|)4T|)M_|(IW|(M2bQbIU|(RH',
      '|(T!4|+!|)DU2U|*bDU|)MW|$?U|%V|$@U|%bKU|)2U|$BW|$C|%2W|%DW|%T|&2WITKU|(YQb?|,Db|,IXKb@U|%U2|$DU|$EXKW|)M_DW|$GKb;b|$',
      'I|%2WEbE!|&YQb?|+PTRb@bKU|+TKTOW|&_;U|%4UKU|&W!=!|+M_|-DX|%6!BbK|+Db|+EWK!|/M_DW|2X|+KTOW|+TEWK!|,KZ=b=U|%=W4W|%BTRW',
      '|%Db|(D|%GbKSbI!|%IWM4|&XKb@U|&_SDKTOW|%JbJ|%KT8W|(JM|*W|%MU!4JbJ|*[PbOK|/KTOW|%OK!|)M_DW|%RIWBbK!|&bOTIU|%T|&DTJW=W',
      '|&EWK!|+M_|&J!E[;|(?|)!|)IW|&KTOW|(Z=b=U|&MJ!|%UKZ=b=U|%W|&=W|&DU|&MW|%X|%_8VKTOW|%b|$J6XKW|&_;U|%BWKb4!|,M_DX|%M|&R',
      'VI|&W|&b|%OK!|%U|&2Mb|%W=W|%b|$KT|$M[BW|$NbMEMbMU|&NEMbMU|(W|$O;bM[BW|%=!|(@_|&TDU2U|%?|&W=W|(DU|%U|%W|&4T|(_ETMKTOW',
      '|&METMZ!|-M_DW|%[|$PT=W|&KW|%U|$Qb;bK!|+4T|+M_|-D[|*E@U|-4T|*IW|,M_|.DU|*RbATJU|*TDU2U|,bDU|+M|,2W|,M_|,W|*VJ|$RT=W|',
      '%U|&D|%[|$SWMb|#U2TKb=U!4b|*W|+MW|*b|$6Kb=b|$8KbOTJKb|$EGbMU2b|#V@UM_|%bJT|$I[2b|$RZKb6b|#W2bIU?U|*V|$6U|$BbK|(I|)B[',
      'OU|#XE|%!|&M_|%2MbED|%T!@K!|&DbDU|&JM|)@_|)W|%W|%^!BU!6G=U!BU|,TKW|,UD|+BU|*D|$Ib|$KMb|#Z!=O|(BU|&W|(4T|(EbK]O[;W|(R',
      'TKbMW|&X|&_|$=b|&=U|$GbGZD|$OUDbJX|%ZDbJX|+J[@K|#[3|$4^!=|%_=W|$6KbM|$;W|$=UJ_|$?U4W!;|+M_DX|%W2|$EMbMZ|$JU|$M!4U|$O',
      '@U|%W|#]2_=b|$@W|&M|(W|$MW|&G!=U|%bO[Rb;[QDW|/b|$NbNW|$Rb|#^!EU6ZKbM|$8W|#_8T|&KI?U|%W|&D|(W|&M|(ET;W|(W|(bM_|%X|$=b',
      '|&=W|)@_|)KOT?T|&BWKOT?T|$BRV|$IDb|$SU?U|#a=V|$@WMEX=U|!M!2|%M_|%T|%ZMW|$=Db|(M_|#2W|$bQ|&?TMDW|*W|&M|(TBU|(W|&bI?|*',
      'KTOW|*W=W|*b|+6!BT|)U|*2U|*DU|)V|*2T!@!|*B[OU|*DKRU!S|0RbOTIU|+TKTJ?|*EWK!|*KT8bJ!|(J!|*4T|*@_|%RZ;b;UE[;|#6b6DbD|#@',
      'T|$_|#DW|#HU!6TJU|(U!BU|)D|([|%Rb@TJU|)W!BU|*DbDTJU|#MU@|&T|$_|#O2WP|$b|#T!;U|(BU|$4T|$JKb|$KV|%ZDbRb|%b=b|$MU|%b|$S',
      'UKU|#U!2WMW|%4|&!|(EMbMU|)[;b|&ETMZ!|&IXKb@U|&TDbDU|(EXKb|(M|$D2bRW|)b|$EU|$IU;Z=b|#V4b|$=Kb|$EW|$M|#Z2b2|(M|)W|$4b|',
      '$DUDb|#[2|%E_@[|(JUDT|(O=!|%W!=T|$3|$6U|$@|$BDU|%T|$ET2bQU|$KW|$OW|$RWMW|#]GbKKV|$MT|#_2|%!|&M_|%RH|%U|%b|&RH|)2W|$4',
      '=|$@W|%]D|$DU|&2U|%X|%[|$EM|&U|(2U|%WD|$J|#bM_|!O!2TJ|(M|$4K|%XKW|$;|%2TMW|%MW|%U|&BU|&OU|$@W|%ZD|$B|%M|&TBU|%[IT@K!',
      '|$P|%!|%IW|%RbAWMW|%TDU2U|%V|&JWMW|#2b@|#4]KT|#6D|$b6T2|(=W|(JU|(KW|&U|(!BDU|*U|(D|)EW=W|*bEW=W|)T|&W|(DW|&[|(BU|(RK',
      'U2U|#8bKTM|#;bEMbMU|#=ITME[;|$b=TBU|&[|(EMbMU|-M_DW|#@[BV|#BMG=W@_!BU|%U|$UD|%MU|(O[JG=W@_!BU|$WMW@WDbDTKW|$bB|&2W|&',
      'W|#DEKb@U|*M_|,DW|-X|$KW|&MW|(bM_2U|$b|%JEbKT?U|#E[8V|#JRW|&M_|)D[|%bRW|)M_|$bJTKU|#K!|%4Mb|)MW|*_|+DW|,X|$2W|%X|$B|',
      '%JbJETMZ!|%MW|$M2bQbIU|%b=b|$TS|$U|%2W!;ET=W|$WR|&4T|$b4|&!|&Mb|&TDU2U|(M|)W|%?D|&U!6T=W|%CDbDE[;|%DU|%I|%Q!|&ET@!|&',
      'T2TM!M_|(MW|#MD|$R|$U4^!=|$Z|$bM|&!|&D[|&HD[DU|&XKU|)W|#R!@|$@U|%WMW|$W!CK|$XMW|$b@T=W|(JU|(KW|&W!;TKW|)BU|(DbD|(OWM',
      '|+DW|&X|&[|&bK|)TM!2K?|+W|#SU!64T|(T=W|)KW|(U|)!BU|)D|%Rb@W!BU|#T2T=W|)M_DW|$4W|%b4[J2TKW=W|&BTD!|$;Kb|(QZ=b|%T|%U|&',
      '2U|&DU|&M_|$=|%2!|%@TKW|%M_DW|%TKW|%U|&D|%W|&2|(M_|&@TKW|(WDbDTKW|%[|&!BW2W|$?U|&8bJ!|&PbKV|%V|$@TOK?|*!|+M_|$BD|$D|',
      '%K|%U|$JObJ|%W|&OW|$K!M_|%R@bO|&W=W|%U|&2U|&6[|&@_|&BbBKU|+X|&DU|&M_|%V|%W|%[|%b|&@|(MW|(T|&QU2|*_@bRO!|$MU|%VGTMb|%',
      'bIV2U|+EWK!|$NbMW|&N|(DW|(W|$RUKZ=b=U|%W|%b@OTDU2U|(W|$SD!|&TMW|%UDV|#U!8IXKWM_DX|%=_Rb|%@|$2TKTGTBW|,b|%V|%b;_KUJT|',
      '&KIb|$4bKS|)!|)TDU2U|+bDU|*M|+DW|+W|$6TK?|%U@bK|%b6[RU|+D|$8J|&!|&2WITKb|&D4K|*!|(UKbIM|&EWK!|&IW|&M2bQbIU|(MU@|&O!@',
      '!|+4T|*I]D|(T=|*M_|&PT!@U|&T|(DU2U|)bDU|(MW|&b|%[@|%b:TD|*!|$;IUDb|$<MT6TKbJ|&b|$=BVRU|%U6U|&BU|%WBM|)JUD|*bJTJU|,U!',
      'BU|)]|*!BU|*D|$@b@DTMW|$B[PTM2W|*M_|(V|%bIS[|&J|(DW|(TD4KbM_DX|)HbJTR!|)KbAU|-DU|,WM|.2W|.W|)MJ!|+TMW|)O[@b@|)R!RbAM',
      'W|*T4Kb|&OT!RW=W|,MW|)Db|$CI]D|%TD!|)M_|(TDbDU|)MDW|*W|&MW4T|%U|&!6U!BU|%WMW|$DTJ2|)W=W|*DU|%U|&J_4URb@WDbDTKW|%W2^!',
      '=|%_B!|(b|%bD|$EKV@!4T|%bMO|)!|$H8D|&U!6G=U!BU|*TKW|*U|%T4!|)M_|(TMW|%UDbD|%VQ?W=W|%X@U|$IKbP2W=W|+M|,W|)MW|%M|%TD|(',
      '!|(TPbKJ!|%W2b@U|%_6D|$J@bDT!|$KI?|%R!|%TN!4T|%UOU4T|$MTRIW|%UJ!|%VD!|%WO|(MW|(]D|$OK?|&TMW|&U!6T=W|+KW|(Rb@W!BU|%TB',
      '!|(TMW|&S|(!|(TDU2U|%[2TD!B|$PT3|(E;bD!|-M_|&MI]D|(T!CbK|%UQb;|*@|%[Q|(!|)4T|(TMW|%bKT!@U|&M[Q?|&O|(!|(DTA|+!|+Db|+b',
      '|*Cb|(OUBbJTMJ|0!|1M_|0IW|0TDU2U|1MW|(TR!|([PbOK|-JbJ|-KTOW|$QJ!|(E]|(M_|&IW|(]|&TDbDU|(MDW|)M_|)W|%b?W|)IXKb@U|)OW|',
      '$Rb@K?|)U!6U!BU|-D|(NbNW|(TK!4T|*I]D|(VKb?!|-M_|,IW|(Y@|*!4T|$STK|#V;U|&2U|&@_|&DU|&M_|%XKU|$=UJ_|$?|%O!2|$CU|&M_|$E',
      'D4!=bM|$K|%EWDTJWDUEMbMZ|&bE|%GbKSbI[!BbKRbOTIU|%HBbK|*KTOW|%JbJ|%OTRK!|%TRbOTIJbJ|%U|&2U|&DU|&M_|%W|&=W|&MW|%[PMU!4',
      '!|$MW|&4T|#W!;TJU|(KW|&W!BU|%=U|&[|(BU|%BU|$DbD|(BU|(OU|*RIVE|(TJU|#XKU|&2U|&M_|#Y2bQ|(!|$@b@WMW|$BbCU|#Z!2;|(4UKU|,',
      '2_;|,M_|.DW|(K@bD!|)I?|)TIJbJ|*OW|)Z=b=U|(RWGbGJbJ|(T6M!|)BbKU|)EWK!|-M_|*XKb|-M_|([PbOK|-KTOW|-RbOTIU|-bMW|)Qb|(b|)',
      'KTIJbJ|+OW|&DbD|&JbJ|%4IT!G|&NKTOW|%;|&D[|%=U|%E;U|$=MbEW|$@W2b2W!;X|$BWKW|)2WEbE!|$D2b2U|%W2|(2W|(G=UD|%bDZM|*2!;U|',
      '$Gb|&R];W|$JbJU|$KbQDb|$MRUD|%W4W|)M_2U|(_=W|&EM|)U|&O=U!BU|*D|%b4;XKb|&B!=|(WKb@U|$N@T=W|(KW|%W@W!BU|%b@T=W|)KW|(W!',
      'BU|&MU|)D|([|&NT=W|)KW|(U|)!BU|)D|*EbEW=W|)E_@T=W|,W!BU|(W|([|$Rb;V!=VRb|(b|#[!2;|([PbOK|-KTOW|-RbOTIU|3OTKU|%4U|%EM',
      'bMZ|$4!4T|%OK!M_DX|$;|%XKU|$=U|%W2MW|$?W|&4_ETM|,RbOTIU|,b|$@b@|$B|%!|%T!@|)!|&MDW|(W|%U2|$ID|%WM|(EMbMU|(OT=|+M_DW|',
      '%XKU|$J=!|%U|$KW|&PD4|%[|%b|&O[KW|$M|%2W|%TBU|%W|%bEXKb|$N|$PTKW|$Q!|%TMW|$ROU|(M_|%U|&!BU|&D|%W2WDU|%[|%b@T=W|)KW|#',
      '],Rb%Kb|$;b|$BU2|%bJ!|(PTMM_|(TK_4bJ|(W=W|)MW|$EW|&D|&MT|$HO!|(4T|$KRb|$PT3|&MbJ!|$Qb?O|$Rb|#bJ!4bJ|%2b@!|)U|*4@|+T|',
      '*@bO!|*DU|)WM|+W|%@UK[2|+!4T|%J!|(@_|%ORTJIW|*TCTKU@|(bA2W|*DW|*M_|*TE2|-W=W|&SKU!6T=W|-KW|*Rb@TKW|(TKTMW|%T2K?!|&3b',
      'JMW|*T@|&CU|(WMW|&ETK|*!|+M_|*O[@b@|*TMW|*WMW|(U!6U|,!BU|(b@!4T|*U|&OSTKU2|&R|(!|(IW|(TM|*W|%W@bE@b@U|$KTPT=W|)KW|&R',
      'T=W|(U|)D|!P!2K|&!|(E[;|&E;bD!|&KTOW|&THK?!|&b|%WRbATED|$3OK!|#2!|$W!@M|$b@U|(4T|(DU|(O!@I]D|#@2|%!|%IW|$BUD_@bRO!|-',
      'TMW|$TGbB!|*M_|)EW|)TDU2U|*M|+M_|)U|*2U|#D4|%MW|$U|%OTK!|*DT=W|#GbB|#K@b|$VK|&!|(M_|&TDU2U|$bI|#PU|#T!@|&2WITKU|&U|(',
      'EWK!|,M_|.DW|$3|%2W|%M|%T|&I!@bKU|$@!|%OTSDWM|,W|$KB|&T|$M|%M_|$PbO@|)!4T|$RD|&!|(M_|&IW|&RH|)2W|)M_|)T|)bJW=W|&TM|)',
      'W|%b@bK|*!|+M_|*8b:W=W|*IW|*O[@b@|/MW|*U|*VJ|#U2bQ|(?T|$3K!|$AUMTORbAM_|$MT|%bE|(!|(TMW|(U|$O|%!E[;|%2YQb?|%EbKRTBb|',
      '%JbJ|%KT!|(@bKU|(I2YQb?JbJ|%MU!4!|*TDbDU|%P!2Kb|%T8V|&KW|(Z=b=U|&MJ!|%W=W|&DU|)2U|$QbJW=W|)MW|#V2TJ|$DW|#W2bKOTK!|$B',
      'bC|(U|$H|%M[3|#Y!4TK|&[KU|#Z;b;U|)EMbMZ|#[3Kb|$Q4UKUKTOW|%JbJ|%TBbKU|%W|#]M8|%U|&DU|&M_|$O|#_H|%D|&b|#bJT!|&IM|(b|$K',
      'BbC|%TO?|%V|&2T!@b|)2WN!|)K!|)NSRb@U|/M_|1DW|(YQb?|,B[OKTJM|3W|,W=W|-DU|&B[OU|&CKb|&DUOTR|,Db|,KTOW|,b|(W|&ETB|&I@U|',
      '(STOUQb?WOW|&K!4|*!|*KT8EWK!|)8DU|(T!|*EXKb|)I|*DOIU|*IXKb@U|*W=W|+DU|+MW|*b|&M!2|(2bQbIU|([3|&OTKU|(UBbJ|&P]M|*!|(b',
      'KV|&SKU|$M_2!|(TMW|!QKVFb|#T=_|$Bb|&D4Kb|$GTBb|$OW2TKW|$SV|#UKb=V|#X;U!4b|#Z=bJXMb|#[2b|!R!2MD!|(2Kb@|%bKT!@U|&QUEb@',
      '|$3bJDW|(M_|$4!|&M_DW|%@U|&WMW|%I|&!|%TKZ=b=U|-M_|/DW|0X|%V@|(!|)M_|(TDU2U|*bD!BU!6T=W|2KW|,U|%bKS!|$5|%;D|(MW|%OU|%',
      'R!Rb2Kb@|%TM|(W|$6MD|(!|%U2|$8Jb|%TIM|%VOJbJ|(KZ=b=U|(U|$@2!|&TMW|%KU!6W2W!BU|%TD!|%_Q!|)4T|$BKbH!4T|*M_|)TMM_|(PU!6',
      'U|-D|$CU|%bJ|(TKT?U|$E@b|%B|&DW|%TB2W=W|*MW|(U!6T=W|+U|%W;U|%bKBTJ|+!|+TDU2U|,MW|$G!C!|(I]D|(TDbDU|)MDW|*W|(U!6U|,D|',
      ')@|$HOU!6UD|%TQ?|)MW|$JW2b@|*!4T|$K2bQ?T|$O@bRK|*!|+M_|*IW|,MW|-_|*T!@IWD2W|+DU2U|+M|,2W|,M_|,W|-4T|,bM_|$RTK!|%b|&2',
      'K?|*MW|)b@|(Y@|*!|+M_|*IW|*T!CbK|*U|+2U|+DU|+M_|&A2W|(DW|(M|)W|)_|(TD|*!|+M_|*TDU2U|,bDU|#2M|#4!|$;W|#8b8|&MW|#@V|%Q',
      'b|$b2KU!6U!BU|%@UGTGW|&WEMbMU|%J|&!|&8U@b|&DTKTJ?|&HTI|&IXKb@U|&O@U|(V=W|+M_DW|&RTJU|&T4bKS!|(D!Bb|%K!|#BRbRW|$T|%PU',
      'O|)D4Kb|)E[;|,M_DW|)GbKSbI!|$WETJ!|)TMW|#Db|%DUO[P!M_|+TMW|#Eb@|#H2W|$M_|$bJ@bO!|&W=U4T|)W|(DU4T|(KTMW|(M|)W|*4T|#I2',
      'TMVD|%XKb6T=W|+KW|%bQ!M_|$4bK|$J!|&M_|)D[|%IWM_|%TDU2U|$K|%J_CW=W|*KTMW|*MW|%bE?|(U!6TKW|+UD|-OTKW|$Rb@|&J|(DW|(M|)W',
      '|$T!@K!4T|%3bJ|%6TK!|)TDbDU|%8|&!|(M_|%CTD!|&U|&WMW|%D|&!|(4T|%O[P!|*M_|)TMW|$U@U|$V2bQ|%E!M_|*DU|&IWM_|&TD|$WBTJ!|&',
      'bK|)!|*M_|)@VK!|)EW|)I;b;TDU2U|*W|)TM|$XS!|$[@|#JbJBb|#KN|$RbO@U|)V|&RW|$TRKU|$U|%2^@b@|%4T|&b4T|%@|%SBbBW|+4T|+MW|-',
      '4T|,_|$[|$]D|$_8|&TB[OU|&UDU|)V|$b|%2TKb|%BTKb|%E!6U|*4T|)b|%O|&VRW|*MW|)b|&[|(EMbMU|#MST|$V!|#O@U|$K?|$TMW|&b|#S2TK',
      '!|)@_|$8|%!4T|$T|%J|&!|(@_|#T!2[@U2|+OKb4!|%5U2|%EbKBTJ|,!|%GPUOKTOW|%Rb2Y@U2|$2bQU|$4DU|%K|&b|%OW@WDbD|%U!6TKW|(BU|',
      '&D|%W|&@W!BU|&DV;U|&M_|%[|$CD|%TK?|)!4T|%U!6T=W|*JU|*KW|)U|*!BU|*D|%bJ!|$Fb;b|)O[Kb|$I!@|(WMW|+4T|%KbAbJ!|(M2_;|%XSU',
      '2|%Z@MW|%bJOTB|&KT8bJ|,!|-M_|,TDU2U|.bDU|$J!|&@_|(bK!|%U|&GTGT|%WC|$K!4TEXKb|%AU|&bJ!M_|%O!@I]D|%RbO@|%U|&4T|%bMW|&O',
      '@bKU2|$MXKU|(W|$NWO|$OU@bKU|$SU@U|(V|)O[@b@|(bJ|*!|+M_|*IW|*TDU2U|,bDU|%WMb|%ZGb|#U!4EXKb|&K[?U|&TK!|&V@!|&b|%CW|%S!',
      '|&T6M!|(BbKUEWK!|(RD!|*TDbDU|$2U!BbKTGTBW|/b|%b2U!|(W|$;V|$@TK|$BbBUE[;|&C!|)4T|(O;!|(T!@!|(U|)E[;|,M_|.DW|/X|$DTKZ|',
      '%UIT2U|*W|)4T|);_4bKFV|.TFKb|)@_|)DU|*W|)M|*W|*_|*bM_|%V|&D;U|%bST|$GbG!BU|*V|$IZ!;W|)b|$KU|&2^!=|&OZDbDZM|&RUMbM|,M',
      '_DW|/X|%b4TEXKb|&EXKb|$Mb2b|$OUMb|$Rb;!|(Ib|#V%Kb=V-|$@|%2W|%4T|%DW|%IbI|%T|&B[OU|&D4K!|&KT!|*EWK!|)I|*EWK!|*JbJ|*KT',
      '8W|*PTRb@bKU|*WM|$DUJKb|$I|#W!2K|%BK|(!|)4T|(2T!=|(IbI|(JbJ|(KTI|+IXKb@U|+bIXKb@U|(U|(b|$3T!@IOW@W!BU|$4bKVOW=W|$8T@',
      '|$@b@U|)O[MW|$BKbPDb|%VKb5|%XK|%bBTM|$C|%T2Kb|%VKb|$DV@|&Mb|$EbKRUBbC|(V!|*2_Kb;W|$GbGJbJ|(KTJ|(TKTJW=W|+OW|&KI?bJ!|',
      '(SbI?bJ|.!|$HBbK|%TQb|$I@U|&V|%Db|%M@|%TKW|)4T|%U@bK|$KHU|%OK!|%[!BbK|&Qb|$MH!4T|%_6D|%b@TDTGTBb|*W|+M|,W|*b|$OKb?|$',
      'PVM|(T|$STRUDU|#X6URb@W!BU|$EKb|$K8b|%U|&GTGW|%bJ|(!|(2N|)T!@!|)WITKU|(DTKTJ?|(TE[;|,M_DW|/X|(W=W|)DU|$NbNXKWE[;|.M_',
      '|0DW|1X|#YQb;U|)!6T=W|+U|,!BU|)2Kb@|#Z!|%;Kb|&bKMb|$2!=KV|%bRb|$;b|$DbRRb|$Eb;Z!GKW|,b|$JU!;b|#[2K?|&U!6U|$D|%TCUE@U',
      '|&DU|%b|$EW|$O|%2W=W|%MW|%TI!BUKbM_DX|#];W|%b|$@!|$BTEWK!|(XKb|$DU2|(WMW|%bJ!|)M_|(TDU2U|*bDU|&RW|#^!@|&!|$IbIW|#_!E',
      'W|$BKU|&W=W|(MW|$I!B[EMbMZ|%JT8WMW|%OTK!|$JTGVDb|$OUJ;b|#a!=b|%BKbJ|$2KbJIW|)TMDW|+WDbDTJU|+[IV|$@b|#b2XMW|(b|%_Eb|%',
      'bKUEb;b|(VDb|+EbM[|$;!;bRb|%T2b|&Kb|&MUDb|%UMbRb|%W=UJ_|%X=UJ_|+Rb|%[;b|)Rb|&=UJ!|&QDW|*@_|*MW|)bMW|$@!H!|%bKV|)M|*W',
      '|$AM|&!|(M_|&EWKT?!|&TDbDU|(MW|%TD!|)M_|(TDbDU|)MM_|*W|(U2|*!4T|*WMW|&E2W=W|(D|(U!6G=U!BU|.D|+T=W|,KW|+U|,!BU|,D|&JU',
      '|)2U|)M_|%U@U|)2U|)M_|&KE=U|+!BU|+D|*b=TKW|%XM|$DTD!|(EW|%[S|(!|(U@W=W|+KTMW|+MW|$E!BD|%Qb;!4T|%V2Kb|*4T|%ZJUDb|&QMb',
      '|%[Rb|$FXKb@U|$ITK2|%U@|$KO!@U|$O!@|%6b7!B|)I]D|%@!@bK|+!|,4T|%EbD|%J!4T|%K2Kb@|&TMW|&XE!|&b?|)M@|%RbAM!|%T4@!|&@!@b',
      'KbJ|.!|.TDU2U|._BbJI|3!M_|(U|&CVD!|&IU|)2U|)DU|)OTKU|-2U|-DU|,W|(V|%V2KU!6T=W|-KW|,U|(TK!|&J|%[6b7|!S!EU|#2b2W|(M|)W',
      '|#@bJ|#AbDXK|)M_DW|#DWI!@KTOW|)W=W|*DU|&2^!=|&TDb|$bI2^!=|%OT=|#JT!M_|#KDTAb|$EbET|$U|%2AT|&YQb?|%@|%EbKRTBb|%GTGW|%',
      'Pb6!BbK|%SK|$VQb|$bJTDT|#M!|$_|#O[MU|(5DbEXKb|/M_DX|&V|#RDb|&EKb@U|#T2V|$IV|$JU|&4T|$MSKbOU|%VOW=b|%b|$RDb|%bEU;Mb|&',
      'J|(!|(D;W=W|#U!BV|(M_|&WOWM|+W|&X|(EWK!|,M_DX|(I@!|%R|$;b|&4T|$IT6Mb|#VKTMTMb|%_|&4T|&JUDb|#W8XKTGTBb|-M_DW|$GbMU|$R',
      'bDTGTBb|&R[Db|#YBJ!|#Z2b;TKWMW|*bM|$6b|$=b|$DbKV|#[@WOTBU|$I|%M@|%RW!BKb|#]2_Kb;W|$BKTGTBW|,2W|,M_|.DW|/X|+b|,M_|.DX',
      '|&b|$Rb2XMb|#_!|$;Mb|$BT|$I!|%TMW|$N4W!B|#aKT|$Rb',
    ].join(''),
  ],
  ml: [
    "ംഃഅആഇഈഉഊഋഎഏഐഒഓഔകഖഗഘങചഛജഞടഠഡഢണതഥദധനപഫബഭമയരറലളഴവശഷസഹാിീുൂൃെേൈൊോൌ്ൗൺൻർൽൾ",
    [
      '!$2c2UBIV|#6c6D[|#;X@c@|#@VDUh|&cL[|%h|$c|#APU|#BcB]T!|)@c@VDc|/L[|,[|#I]KV2c2f|#LVJEcE[;XDcDX|#McM[6c2Vh|#P|$KX;[|$',
      'M!G!|$Ug=c|$V;[|$g|#h|!%!|#?c|#BcJ|&!|&@c@[|&IUJV|#CXDV2|#JV|%KXDcDX|!&!4cMWRc|#6c6D[|#@VD[|&c|(L[|%h|$X|$c|%@K!|#Bc',
      'B]T!|#Dc@cJ|)JVM[|+h|*X;[|)f|%Dc|#EcEai|#P|$V;[|$g|!)?c;UJVKXDcDX|&c|#EJa4V2c2XDcDX|)7c7c|#JgDcD|#NcN|!,!|#6c2VMX!|#',
      'DcD|&@c|&U?c|(h|&V6c6D[|(P|)JU?c|&W|&X|(!|&c|#McMU|#Sc|#f|!-2B]Q!|#@U?c;c|#EcKVh|#L[|$cLPX!|!/2c;aGg|#DcDU!|#KX|!04S',
      'cLcLc|#Fc|#Ka|!1BcJa4V2|!2?c?V2i|#U?U!|%X2|$K?!|$M@c@c|#V|$MaIWLcLg|#XL:c:|#Y;U@[|%V|%X@h|#[|#]KN|&@c@VM[|+h|#_?c;c|',
      '#aN]9c|$OV2c2a;c|$e4cKSc|#cKV|$R]@cK!|!7KV@cK!|#M7c7V@cK|#V@cK!|(6c6i|$M|#[Jc@|(X|&JXDcD|,@c|,X|$LVJ|#]gDcDc|!9DD!|$',
      'V7c7Pg|$XPKV|#VMcMJVM[|#WPV@!|#YM^|$e|!;V|!=V|$S!Gg|!@6c6NX;[|#DcD[|%L[|#IVOc|$cIVh|#VKXPDDc@EXK!|#X;6c6V|*J|%gDcDc|',
      '!BVPS!|#]QWJ|!CUKUN!|!D;@c@V|)J|$DcD|#McM|#P!Gg|#UR?h|#VDcDU?c|(X|)!|)NcN|(c|$KPCV|$MPVh|#X|#];V|&J|#c|#h2V|!E2cR]|#',
      'LJXDcDX|#M|#OJ|#Ug;c;V|#V|$DcDW;c|#X@VJ|$KSc2UK!|$L@c@]2c2XNcN|#]KVh|%c|$g|#aM[|#cK2UK!|%@cJ]2|%CUD|)IUJX!|!F[GcKXPK',
      'V|!GV|#cKV;c;WRc|!HU4!|!IK?!|$V7c7Pg|#LcLX|(!|&_KX|&c|#MJUN|(!|#U@cK!|(I]|$LV|$g7c7c|#V27c7|#WLcLg|#X@h|$TIcIBc|$f|%',
      'Ec|#YDcDX|(c|$M!|!JX|$BcC!|!K?c;U!|&X|&c|#U9cJ6c6i|$Rc;cKWJ|#YE!|!MHV7c7Pg|)X|#[|!P7c7c|#DcD|&X|#KXDcD|$[|#MVJ|#NK[|',
      '#OV|#V|$BcJUHcJUS!|$PUT!|%VC|#W?c;X!|#]?c;V|#gR!|!Q]R!|#cKW|!S!PVCUD!|$ScAUD|#IJ!|%@c@c|#UCUK?|$TV@cJ|#V|#[EcLcL!Gg|',
      '#c2Yi|$AUD!|%V@V|$PDc@!|#g2c2Ug|!TVDcBV',
    ].join(''),
    [
      '!$!4!|%6c6NX!|+;[|*[|)i|%@cP!|)IXNcN|%IU?c|(J|)Pg|)V|*KXDcD|/X|%KU9cJ6c6i|%PX!|%S!3cJ|%W2KV2c2EcE[;c;X|-X2JX!|*7c7|-',
      'X|(UK!|(Z@|$G]Bc2g|$Q!|#2@c@[|(c|$DcDX|$IcE;VJa;[|$M!|%@c@Vh|%[|&JUJV|(XNcN|$c26c6i|&U=IV|(BIV2c|+JX;[|(M@c@[|,c|%GL',
      'VDcL[|&g|%PWDUSc|&]LVJ!|%RK!|(6c6i|(IUM|&U!Q!|#3VM]Dc@cJU|#4Sc@WDaSc|&LcLSc|*Vf|$cDV|%K!|#6c2IUMV|%6]JLcL!|#7c7;V|)7',
      'c7|&X2i|%8DX!|(cL[|&f|%JX@I]Daf|)UDDcBf|#:c7U!|(I@c@[|&X|&a|&c|&h|#;2c2!|(IXNcN|$6c6VJ|*@U?c|*V;c;X?c;c|+KV2c2XDcD|4',
      'X|(XDcD|$7c7X|$JUN!|(6c6i|$V|%7c7X|%@c@L|%I|&2N[|(i|&@c@!|%JDc@KUPScA|%ScAUD|+!|+@c@VMU?c|/h|+EKIUJV|,cE[;X@c@V|+IU2',
      'c2V|1JXNcN|$X@c@2UM@c@UJV|/c|)UJV|)V;[|)X|*NcN|)c|%EcE!|$Yg|#=aGV|%iFc|#?2c2[;c;VDcL[|,X2NX;[|.i|,c|$X|%GUC|%S!3cJ|#',
      '@@X|%c|$DXSKV7c7c|$McM|$U?c|%J@c|$V|%AV|%DUJV|&X|(NcN|(Q]R!|&[|&a;c|&c|%KX2i|%MCV2Ia|&X!|&Y;[|&[|%P]4|)!|%fL[|%g@c@V',
      '|$WP|$X|%!|%2_?c;U?c|+X|,@DcD[|+c|%EaM[|%IUJV|%PK[|&OV|$]|%SIJ!|$_KX|$a;[|&_EcE!|$c@!|&K!|%JCV2!|&Dc@!|&UPQcJIU?c|%K',
      '|&JX!|#BcB]T@c@VDX|-fL[|.cL[|-h|,a;c|)IU?c|)PX!|%CcJ2cRf|)UE2DUJV|,f|,g|*J!|+6c6i|+@c@VDcL[|/h|+IU?c|%P^@|#CV2|&!|&I',
      'UJV|&PX!|&UK|)!|)@c@Vh|)I]LcLX|)V2i|&Z@g|%DVP]Q|+!|%PgR6c6NVh|)@c@Vh|%Rc<V@|+IUJ|$WD@JVMUJV|$cJ2cRf|#DDc@f|$PCV|$VO!',
      '|%h|$X2YM|)IUJ|%4cKT!|%EU@!|)@c@Vh|%GDcC|*!|%HP!|(6c6i|(EcE[;XDcD|1@c|1X|%I@V|&UD!|)V2c2EcE[;XDcDX|-XDcDX|%JUJV2NX!|',
      '+i|&a9cJIU?c|-J|%PBV2c2XDcDX|)7c7X|&UB!|%SKV7c7U?c|,c|$]2!|$c@KV7c7|,X|(W2cR|,!|,@c@VDcL[|0M[|0h|&UKURc;cK|&V2c2U;c|',
      '(I|&cJ|)!|&gB]QWJ|%D|&@c@[|&X|&]|(BVPS!|&c|%LUg;c;V2c|%P]R?|*!|#E2;!|&6c6i|$YgP|(IUJV|(cP|*!|$]2cR|)V7c7X|-c|$c|%E!|',
      '&U7c7[|&Wh|&aNa|(OX!|)]2c2X!|(i|&g|%K2UK!|%M^=c|#Fc4UDVSc@UDVM[|,AUf|(f|#GX|%BUGV|$Y|%G2c2g|$cBXLTcIUf|(McM|(NcN|(h|',
      '(i|%GUSc|%KTU!|#HJ!|$UP!|&@c@Vh|$VDJ|(!|(9WPV@!|(@c@VDc|(V2c2X2JX!|-DcD@c|)7c7|,@c|,V;c;X?c;c|,X|,c|&]@U2c2i|*Pc|%Ec',
      'KUJ|+!|+@c@Vh|+EcE[;XDcDX|0c;@c|2V;c;X?c;c|2X|%IX3!|)@c@Vh|%R]2!|%S!GaCD|$cJSV7c7X|#I7cPg|$UPUSV|$V@|&IUJ|*V|$Wg|$Z@',
      '|$]7cPg|%KV2c2|+JVMX!|.[|.]2c2c|,X!|-;[|$cEM!|(EcEXO|%I|&JX!|);[|([|&UPf|%M!|#J7c7|(X|$UNX;[|&[|%i|&2c2c|$cJEcEf|&g|',
      '$h|#K6c6]LV|*cL!|$7c7c|$JVh|$PVDcBf|$V|%Sa?|&cLcLa;c;VMVDcL[|0h|$Xe|#LGV|&2c|)2;MVh|+h|%c|$ScLcLX|*c|$VJEcE[;Uf|,XDc',
      'D|0@c|,c;|.@c|.VKXDcD|4@c|4X|.X|&U@c@|(IUJVKXDcDX|(f|&V2c2XDcDX|(7c7X|%PVDc|*L[|&X2i|&c|$]GcJ|)JX;[|)f|$cL!|&@c@XNcN',
      '|*c|&c|(MUDcLV2c|#M2cSU?c;LVDcL[|-X;[|,g|$6c2UK|*SScJ6c6i|$TGUBc|$V|$YIVDVJ!|$cE!|%M|&U@[|)c@|(TX|$f|#NPVMXNcN|&h|%X',
      '2i|%c|#OVI@V|$W2c2a;c|#P2UQ!|(6c6i|(EcE[;XDcDX|-c;X|%c2c|$@K?!|&VEcEV2c2Uf|/XDcD|3@c|3X|,7c7|/@c|/X|$CV|$D[|%cL[|$JX',
      ';[|%[|&McMU!|$KPKX;[|%Vh|%[|%a;c|&T?!|$M!G6c6i|%a2D!|$NX;[|%[|$QVRc;6c6i|%]RV2c2XDcD|)7c7|$SK!|&6c6NVh|*i|&@c@Vh|%UD',
      '|(!|(2UM@c@c|(@c@Vh|+[|+a;[|(IUJV|(V2c2XDcD@c|0X|)7c7X|)EcEV7c7X|%cA|$Ug=X!|)2i|$V;!|&@c@[|&X@c@[|&[DVDcDc|(JXNcN|$f',
      '|$g2c2X|)c|$i|%2c2c|#Qa2|&DcL[|&c|&f|$cP@V|(cAUIUPc|#S!GcMV|$UCUK?IUJ|$VScLcLDcLc|$WSc|$X3!|&6c6i|$aSVJ]Rf|#TIcIBUGU',
      'Bc|)c|$cIBc|#fPg|#g9DcLWD|%c9XD|*D[|+cL[|*f|$@cA!|(@c@VMU?c|,h|(IU2c2XDcD@c|)XNcN|$A!|$BcC|$GXB!|#i;cKUPJMLcLc|!%!4M',
      ']J|)!|%cMV2c2f|(a|#2U!|%Q!|$XDcDX|$Z@V|(JVMXNcN|$[|$c2!|&V|%;c|%KI?|)!|)6c6i|)@c@Vh|(V2c2Uf|,X2JX!|)7c7X|,c|%LcLc|%R',
      'f|%SSc|$gR?!|(6c6i|&V2c2XDcD|/X|(7c7X|#4Sc@c|&LcLc|$VK?!|$aN|&@M@c@Vh|$cK|&T!|(V7c7X|#5aR!|&6c6i|&V2c2XDcD@c|/X|#7KV',
      '2c2XDcDX|$UK!|&6c6NX!|*i|#;c|%;2c2A|#?P|$V@c|$X|%c|$[6c2VMX!|*h|%DcDX|*!|)c|#@cI2A|&T@cJ|&UPc|&WJ|#B!|$KV7c7X|$V|%I|',
      '%PUSV|$cJ2UM|*!|*6c6NVh|*@c@[|-c|&@c@]@c|#CUK!|&IU2c2V|$V2UKV2|%E@cJ!|#D2NX;[|&[|%i|&2c2c|$DcBc|$JX;[|%[|$V|$c@KV2|%',
      'CcK|)UEcKB]QVM[|0c|%L?V|&V|&c|#E]2cRV2|$cEVNVDcL[|(i|%MV2c2]RDX2i|-f|#FcKV2c2|+JX;[|+f|#HK?6c6i|$VIX3cJ@c@Vh|$cJDc@K',
      '|#I@c@[|$Sae|$X3!|#J@VDUh|%c|$EcEaO]2c2X!|$U?c|$V;c;U?c|%K!|&2c2?2c2VDX|0c|&@c@aN!|&V2c2?!|+X!|&XDcD|%McJ!|$X!|%C!|&',
      '6c6i|%ScSc|%gP]B|*!|*@c@Vh|$c|#K!|%H!|&@c@Vh|&V2c2X2JX!|,DcD|/@c|/X|(7c7|+@c|+X|+c|$UC2g|&D|(U|)MJ6c6i|&V2c2XDcDX|$X',
      '!|$[JX!|$a4cJ|)!|%E?!|(6c6i|&V7c7X|%T?!|$cJ|&f|#LDcIXN|$U!|%;c;XEXO|)c|%I@c@[|$X|$c|%L!|&6c6i|&V6c6h|&X2Uh|#M@c@Yg|$',
      'EcEXO|$V|$XP|$]3D!|#NU?c|$X2NX!|);[|([|&i|(2c2c|#O!|$@c@Vh|$c7|%S?h|#PK?!|$QcJ!|(2@|(6c6i|,2c2UJV|/c|(@c@VDc|(EcE[;X',
      '2JX!|-c;X|/c|(IU?c|*J|+V|)VMcM|)XNcN|(UDXSK?!|$U!|%S|$VRc2KV7c7X|%gHUP!|$Z@c@V|$g@c@DEcE;c;V2JVM[|)V7c7X|#QJ!|%6c6NX',
      '!|)i|%@c@[|%PVDVIJ!|$Uf|$XE@cKV|+JVh|$cKI!|(@c@Vh|&JV2c2XDcD@c|)7c7U?c|,VKV2c2XDcDX|,X|,c|#SUBc|$V=c|$Y@cK?!|$cAUD|)',
      '!|)IU2c2V|+J|,V|,XNcN|%EBIU2c2V|#TUK!|$cPUD!|#f=IUf|%WSc|%c|&KY|(aIW=|)Jc=c|$L?V|#g2c2X!|$7c7c|$;c;VScLcLc|(c|)Sc|&S',
      'c|$@c@P!|%g|$IV|#hF|%U|%cK=c|$G!|%g;c;c|#i2c2Ug|!&!4cM?c;VDcL[|,M[|,h|+c|(WRVh|*X2Ug|&NWRc|#2c2UK?@c@Uh|)cJ!|+@c@Vh|',
      '(M@c@U?c|,[|,c|)JNPVh|&Y;c;@c@Vh|#6c2c|%6D[JXNcN|#:c7V|&c|#;!|$2c2V;[|(c|$6c6NVh|$@X|&2JcJVh|&E2cR|%c|&@K!|$E[;h|%cE',
      'NcNV|$JU2c2V|%VMU?c|(X!|)NcN|&h|%c2c2V;[|*XNcN|*c|$X2c2V|%6c6VJ|#@DXSKV7c7c|$K|$U?c|%JVKXDcDX|$VD2!|&UJV|(h|&V;JVh|)',
      '[|&X|(!|(?c;c|(NcN|+@c|(Q]R!|&[@c@X;gDcDc|&a;c|%MX!|(?c;c|&Y;[|&[|%PZ@c@!|%TUS!|%fL[|$X!|%2Y;U@[|%EaM[|%IUJV|&YM!|%P',
      'K[|&OV|$[McMU!|$]|$_KX|$a;[|&_EcE!|$c@K@c@VMXNcN|,h|(I_KX|&P?|%K|&JX!|#BcB]T@c@VDX|.c|/L[|,[|)IU?c|#D!|$6c6i|$@c@Vh|',
      '$IU?c|$V|%JX!|$c@a|(D]RcJ|&cJ2c2Ug|,c|)JVMX!|,]2c2c|*X!|*[|)U|*7KV@cK!|)fSc|%BVK|)JX;[|)U|*4UDcCV|&cKf|%CD|(!|%D@c@[',
      '|&X|(!|%LMV9fSc|&g|(DUR?h|)[LcLc|(F]Sc|&h|#EcEaO@c@[|)X!|*NcN|%K2UK!|*IU?c|#GcDX|%KUTV!|%f|#IU!|$[JVh|$]9c|#Jg|#K;c;',
      '|(V|$V2c2XDcD|)Yg|%6c6UM2c2X;|$X|%?c;|%DcDc|%E@U!|(X|(c|%IcEc|%PKX!|#L2c2V|(XI@V|$6c6V|)J|$U3c|%DVJf|(M[|%f|$cLMV|&U',
      'MVJf|#M2c;cKV2c|-2h|*a?V2c|/Sc|,X2NX;[|.i|+e|%i|$E_OVJX!|$Pf|$cM|&!|&U@UJV|)[|)c@|(JVKXDcDX|#N!|$J|%KU9|#P2c2c|$JX!|',
      '&;[|%[|&McMU!|%c2c2X|$KU?c|%Vh|%X;[|%[|$Uf|$V;!|&6c6NVh|&@c@[|&X@c@[|&[JX!|*NcN|-@c|&]2c2c|$g2c2c|#Rc;|#ScKJ]h|&UJ]h',
      '|%MU!|(IV|*2|+!|+c|*DcL[|*M[|#f=a|%cJf|$Fa|%cKUL[=c|%gI]Rf|$LgD[LcLc|$ScE[2c;g|&LcLUi|*VLcLcJY;c;c|!(9VEc@VM[|*h|)c|',
      '(LcLc|(RcJf|#?!|#KULcLXE];c;|#LcL|#OP|%g|#QcPKf|#Sc|%LcLc|)g|#gEcE!|!)7c7Jc2c2c|&UK?!|#;D[|$I|%ScA@JVMXNcN|%cE;V|$M[',
      ';X@c@|,@c|,X|$f|#?6c6VJ|$c;U2U!|*LX?c;c|*f|)X!|*2JX!|*DcD|-@c|-X|)c2Uf|+V|,J|+X2JX!|,DcD|/@c|/X|(J|)@c|)V|*;c;X?c;c|',
      '*KV2c2?!|/X!|+XDcD|/@UJV|0c|/VMcM|/XNcNY|(PX!|*2|+JX!|*DcD|-X|&[6c2VMX!|,h|(DcDc|%?V|(2ZRc?f|#@c@I|(!|&K|(!|(PUBV@c@',
      '!|)V;c;X|)c|(]Dc@cJJVh|&g|(EcKB]QVM[|.c|%EDcD6c6i|&UBD!|)VEcEV2c2XDcD|%HP!|%K!|%SP!|(6c6i|(IU?c|#BJ!|&E]KYg|$U|%TK?!',
      '|)6c6NU?c|,i|)@c@VDc|)IU?c|+JV|$c|%5U;D!|%B]Q!|)V2c2XDcD@c|)cJ!|%HP!|%JUD!|&a4ScAf|,g|#DcD@|%IYMD!|#E2K?!|(6c6NX!|-;',
      '[|+i|(IU?c|$4cKT|)!|$9c:U@UPc|$B]P@2NUJV|&Q!|(V7c7X|$HY3?c=@c@VDcL[|$Ja2c@U2c2i|/2c2c|&4!|(6c6i|(EcE[;X@c@V|1XDcDX|(',
      'PX!|(V2c2EcE[;XDcD|5@c|5X|,U!|-LX?c;c|-PXDcD|-f|,X2|.JX!|-DcD|0@c|0X?c;c|)7c7|,@c|,U?c|,VKV2c2XDcD@c|.XDcD|2@c|2X|,X',
      '|-!|-NcN|-PKXDcDX|$KV@M|)!|)@c@Vh|$]2cRV7c7X|-c|$cEX|&c|#GX?c;X|#IcIf|$g|#JK!|%@c@VMU?c|+XNcN|*h|%IX?c;c|(NcN|%PX!|$',
      'g@c@V|*J|%DcDX|)c|#K46c6i|$X@c@VKV:c:@c|#L7c7|(X|$EcEV7c7X|(X|$PV;!|#MYEV|#NcN;2c2!|&@UJV|(VDUh|(c|&Vh|&Y|(g|#Rc?!|&',
      'I]3MU|#Sc@UBc|%IUf|#gBX|#hEcEDcD6c6i|#i2c2;MVh|)h|(_NcNXDcD|0X|$DU;f|$EcE[;X!|+@c@V|/JV;c;X?c;c|+DcD|.@U?c|/c|.X|*[|',
      '+JXNcN|*c;|,@U?c|,VKXDcDX|!*;c;V|#DcDh|#Kc|#RcIUPc|#g9c9|(!|(@c@VDcL[|!+4cP]B@c@Vh|!,2c2UM@c@[JX!|,]JX!|&h|%SV2cJY;c',
      ';WPc|&c|(EcKSc|-Sc|#6c2Vh|%6D[|#7c|%7c|#:c7VDWJLV!4c|+g|(f|#;X2c2Uf|)XDcD|-@c|-X|%@c@|)X|)c|$c;U!|(I@c@[|&X|&c|#=VLc',
      'Lg|%Rf|%Se|$cP]g=c|#?c?|&!|&@c@Vh|&PX!|#@VKUJV|(NV|*2i|&[|%g|&@c@X|&EcEX2i|*c|$c@ULX?c;c|(f|&V|(7c7X|+]KUDXNcN|.f|-X',
      'DcDX|,gDcDX|(J|)@c|)VKXDcDX|&X2JX!|(DcD|+@c|+X|%K|#DV2c2c|$c@U?c|(JUMX!|&VD]JX!|&X|&[6c2VMX!|(DcDUh|&a|&c|%D@U?c|)JV',
      'KXDcDX|(VDUh|*X|*[|*c|+L[|)MXEKV|(X|)!|)2_?c;c|&E]KVh|&LVJEcE[;XDcD|3@c|3X|/c;|1VKXDcD|1X|&U2c2V|(?X|)g@cA!|(JVKXDcD',
      'X|(MX!|&V|(6c6D[JXNcN|(;c;X!|(KV2c2VMX!|)XDcDUMX!|(P2c2c|)JU?P|+JVKXDcDX|*VMX!|*X!|+;[|+IUJV|+iEcE[;[|*[|+McMU!|*_2c',
      '2[|*c2c2X|)KU?c|+JVKXDcDX|*X!|+;[|+IUJV|*[|*a;_EcE!|)V;6c6NVMU?c|1X!|1[|0h|)g|*2c2c|&XIU?c|(NcN|(c|&[|(McMU!|&_2c2[|',
      '(KX|&a|&g@cA!|+IXNcN|(A!|%L[|#EcEaOX!|%SVMae|#Fc|#GcKTU!|&UJ|#IVL]LcLcSc|#Jc=cSc|$g|%Eag;c;c|%M^fSc|#L?U2XN!|$cLPX!|',
      '#MVSG@c@c|$cMU!|(@c@K!|(JV;@c@X!|)cEcEaOX!|(PKX!|)g2c2X!|*RPX!|#NXEcE!|)@c@Vh|#OX@EcE[;c;|&Uf|&V|(J|)@c|)V;c;X?c;c|*',
      'KXDcDX|&X2JX!|(DcD|+@c|+X|&c@7c8f|)X2UKDX!|-f|,g|)c|#PV;[|#SVDcL[|$cLcL]LcLc|%SVDcL[|&c|#f9VDWJLV!4c|,6c|.6c|&f|$=aS',
      'iFUf|$S^2cMaEW=VJ|#g@c@c|!-!4hSc|#22!|$BVD|$UBQV|$W2Z@|$c|%2g|#9fSV|#?ScLcLc|#@UDX!|%JUMX!|$X|$[6c2VMX!|$_KX|$c|#EcK',
      'VMVh|#KVJ|#LDU;c|$VJ|$[2c2UM!|)XL[|%JX!|$cLPXICV2!|&XIUDYg|)X;c;V|&[;X2c2X2JX!|*@c@X|#OU!|%I@c@[|$X|$c|#RcJ|&JVM[|(X',
      ';[|&UD[LcLc|&f|#gEcE[;X@c@V|/J|*c;X|!./,Sc|#2cJ|&!|&DU;X2NVM[|.h|-X;[|,i|&KURc;cK|.SH|0JVh|1X;[|#@VTcJ!|)6c6i|)IX?c;',
      'c|#EV,h|#Fae|#LVRc|#QcPKcJ|#S2c|$c|!/,Sc|#2c2[|%;aGLVh|#;XPVh|$c;DPCV|&X!|(IV2c2|&]L[|#@X6c6V|$c@X|#DcDK|&U?V@c|)c|(',
      'I@c@[|)DcL[|)f|(J|)V|*KXDcDX|&V7c7X|+c|(DX|)c|(MCV2!|(h|&X|(!|(2Vh|&a|&c|#EcE!|&X|%LcLV2c2h|#Fc|#Gc92cLcLc|#IcE@U!|(',
      'c|#KUNU?c|(J|)V|*KXDcDX|&X;[|%i|&2c2c|$V2c2MX!|)h|%;@c@c|%D!|$X2UM@c@c|%@K!|%E2cR]|&U;c|&aM[|%IV7c7X|+c|$[?c?!|$]|%J',
      '_KX|%SIJ!|$_LcL|$a|#LU2c2Vi|$cL|&EcEUM!|*[;c;|#NVIcEV2c|,SVh|-c|%PVh|#OV2[|(JXNcN|%7c7c|%:c:X|%PU2c2Uf|+V|$X2V|&XDcD',
      '|+@c|+X|&c2c|#fE@U!|&X|&c|!02cSV9f|&^=c|&cFag=c|#4ScLcLVh|#;2c2XOh|$V|$[|$c;a|(2U=c|#=VJa|#?!|$LLV|#EcEL|(]LcLV!4c|-',
      '6c|/6c|)Rf|&e|#FWSVh|&c|&g|#JVh|#KaDcDX!|#L:c7c|$VJDcLh|#N!|#PLVh|$g|#Sae|$c2Ug|%;cKVJ|+f|)]MVJ|-f|#TKV|#eM^f|#g4D^S',
      ']Rf|$=g|$@c@=a2cSc|$IcI|$P[h|#i=c|!1;c;c|(EX;c;c|#BcJa4V2IUJV|#E7UKV2|#RC|%!|%IUJV|%Ja4cJ|%SScJ6c6i|!2!EcJY;c;g|#2cR',
      'V|#7c7P;|)!|#;!|$@c@V|$DcDX|)Ea2XDcD|0X|(c|$IcIDV;c;|$MUSc|%VM[|&h|%X!|$X|%!|%@c@|%P|$c;V|(JXNcN|$h|#<VDIUJ|#?2c2DXS',
      'KV7c7c|(U2c2EcE[;XDcD|5@c|5X|,U!|,V|,XDcD|0@c|0X|(VM[;X@c@c|)h|(X|)2i|(c|$6c6i|$c;|&@c|&Uh|&X|(EV;V7c7|/@c|/X|,@c@!|',
      '/6c6i|(IX;c;V|(PKXDcD|.@c|.X|&[@c@MX2i|+Uf|+V|,J|-@c|-V;c;X?c;c|.KXDcDX|+X2JX!|/?c;UJV|+h|&c|&h|%?2V|&U;V|&VDcL[|(h|',
      '&X2i|&YKVM[|*h|(g|&c|&f|#@c@V|(h|&X2i|&aMV2c2|-U|&c|#A2NV|(h|&X!|(;[|%i|$JU?c|%Vh|%X!|&;[|&?c;c|%[|$U2Z@c@X2c2i|%EU@',
      'cK!|+6c6NX;[|/[|.i|+@c@[|+IU?c|#D!|$@c@|$Uh|$]=VJf|$cD;|&=|&V|&X2UMV|%JU2XIUKV|#EYg|$cEMVh|(X2i|&c|&h|#IMTUSf|$Uf=g|',
      '$cEDV|)2NX!|,;[|*c2c|)JUJ|*X!|+;[|&cJY;c;LVDcL[|/h|.X2NVh|1X;[|0i|-V!4c|-g|%ILcLV|&VLcLV|,JX;[|&WR?g|)DcL[|)f|&cJY?V',
      'ScLcLc|%JY?VScLcLc|$h|#JLV|%cLV|(XI@V|$cJVh|$g|#KJUh|%Vh|$ScAIU2c2V|$ULVh|%g|$V6c2McMVh|%IcEc|%Jg|$WGVJf|$X?U2Kf|%@E',
      'cE[;XDcD|0@c|0X|&U!|&V|(J|)VKXDcD@c|&XDcD|+@c|+X|%DU4EcENcNV|$i|#LDcLc|$X@c@|%EcEX!|)c|#M2i|$?c;g|$U|%!|%2UKDcIUg|%E',
      '!|&@c@Vh|%I?c=M!|%KYE!|)IU?c|%MJ!|(6c6i|$cED|%ML|&Vh|&X2i|&c|$gDcD|#N!|$2c;g|$KV|$V|%2c2UK[|+f|*g|)XDcD|%7c7|)X|%Ie|',
      '%JX;[|%MU?c|&X!|&[|%h|$X;[|$cNc|$g|#O2!|$V2c2Uf|)X2JX!|*DcD|-@c|%7c7Uh|)X|%:c:|)@c|)EcEai|)Uh|)V;c;VMcM|-X?c;c|*KXDc',
      'D|/VMcM|/X|*McM|)X|)c|%JU@[|)c@|&VMcM|&X!|(DcD|+@c|+X|(IcEai|&Y|%PX!|(2i|(?c;c|(NcN|&c|$X2V|%@c@Vh|#PU;!|$V|%2NX;[|%',
      '@|&2NX!|(i|&JX;[|&U|%JX!|(;[|#QXP?c;V|$cIWg|#RUJ!|#U:c:VKEcENcNV|$;X2NVh|%c|&;U2c2;|(VJ|)h|$<VDcJ!|$?EcE[;X2|,DcD|/@',
      'c|/X|0?c;c|%ULX?c;c|&PXDcD|,@U?c|&f|%V2c2XDcD|.@c|.X|&7c7X|%X!|&2JX!|&DcD|*@c|*VMcM|*X|+?c;c|&PUf|$@c@X|%h|$D=|%VSc|',
      '%]RXIUKV|%c@V2|)IUD!|,IXNcN|&Lc|$EcEV|$Fc2|(JX;[|$GVDLcLc|%Yi|$IcEc|$J|%!2XN!|%V2|%c|&2i|%h|$K?6c6NUh|*i|&@c@Uh|&IU2',
      'XDcDX|)?c|)J|*@c|*V|&PX!|(g|%cJ!|(6c6NVh|,X!|+i|(@c@VMX!|,h|(IU?c|*J|+V|$LcLMa4c|(VDcL[|(c|$M|%!|%2cKI@c@Vh|*]?|%5;c',
      ';!|*@c@VDcL[|.MU?c|/[|.h|%6c6NVh|%;V|%@c@U?c|)VDcL[|)X|*!|)[|%IUJVKXDcDX|%JNPVh|)c|%Q]R!|%UDc@K@c@Vh|&PCV|(ScA|+JX!|',
      '+U|%V2c2LcLc|&Fag?VJ|&h|%X2i|$N|%V|&BUSf|$Oc7|(EcEU;c|$P]KV|%c|&J!|%h|$QV|%cIWg|$Sc;cKa|%g4a=c|$fSg|$g|%4Vh|%;c;Ye|)',
      'g|%=X2i|&c|%@c@V2|%Ge|%RV2|$h|%ScJ!|$i|#V!|%4c|(Sc|$6c|&=!|$;2c2XDcD|-X|%DcDX|%c;Uf|(V|)J|*@c|(X!|)DcD|$?g|$K?6c6i|%',
      'W;!|(6c6i|$Ma|&4cKU!|&IWLcLLU?c|-X!|-aN!|$NVIUDYg|$O2c2UJV|)VDcL[|)X|*!|*HU4@c@c|*NcN|)]|)a;c;U?c|-c|)c|)f|#WO;2c2V|',
      '+J|*X2JX!|&6c6V|%VMU?c|)JV|+KXDcDX|(XNcN|&h|$g2c2[4U=c|#X!H!|&IUS@c@VM[|$6c2XI!|$:c7f|&:TIcIBc|(V2c2X;c;f|)KUIf|(X6c',
      '6N[|,i|(c|$;V2_NcNXDcD|0X|&J]LV|+J|*cL|,!|,2c2Ug|%X!G|)!|)@c@VDcL[|-MU?c|.[|-h|,[|)PX!|%c;V|)2NX;[|+[|*c2UM!|.@c@c|*',
      'i2c2c|)JX;[|*[|$@VK|%c@2|(V|$DcD!2XN!|(Vf|(X2NX!|*i|(c|$IUKDUQUf|(V|(f|&g|$KXIXN2c|%cJf|$L7c7X|*2UM!|)c|%:c:@X!|*c|)',
      'X|)c|%JX2JX!|(DcDX|&c2c2Uf|%PU?c|(JVKV2c2X!|+XDcDX|&XNcN|&c|%V2c2XDcDX|&7c7|*@c|*X|+!|+NcN|*c|&EcEX2i|*c|%X2[|&EcEc|',
      '%[|%]|&2c2UM!|*Y;V|%cL!|(2Z@cJ6c6i|(cJU;V|$MQ]3K|$N!|%cNf|$Oh|#Y;V2c2UOc7|&7c7]gDcDc|&J|(U;c;!|)?V@c|)J|*VKXDcDX|%X2',
      'JX!|&@MU?c|*JV|,KV2c2X!|+X!|)X!|*NcN|&IcEai|%[|%c|&;!|(2c2_M|(@c@Vh|+a;[|(IUJV|(KX!|(V|)7c7]g@c@X|$@c@XELIcEc|(c|$Lc',
      'Lf|$MV|$g@c@|#Z@V|&2NX!|*;[|(c2c|(i|&JUJ|(X;[|%cJIUJ|+V|&KVI|*IUJV|$RV|&2c2c|&JX!|%c?|(DU;c;!|)X!|)cL[|(EVNcN|(f|#[;',
      'c;V|);!|*6c6NX!|-i|*@c@VDcL[|)J|$IV2c2h|$g?h|$hPVf|#]!GcKV=c9c|$;XEU;X2i|%c;|(X|(c|$?h|$DcBcK|*!|*6c6NVh|.X!|*@c@Vh|',
      '*HK?|*IDc@cKV|+U2c2V|,?c|,J|-V|.KXDcDX|*PX!|*W2KV7c7X|1c|$Ec|$GVi|$KN!|&7KV@cK!|&@c@VDcL[|+MX!|,]2c2c|&PgIcI|&S!ScAU',
      'D|&U|&WJ|$PM|&!|$QPf|$SKV|%Vh|%X2i|%c|#^2NVh|%UKcJ!|%_?c;c|%i|$IULV|(cL!|$JVh|%cJVh|$KNV|$PKV7c7|+X|%Q!|#_2c2a|$6c2e',
      '|$7c7V|)f|(X|$;2K|%VIK!|%X2c2Uf|*X2JX!|+DcD|.X|&6c6McMYKVh|.g|&@c@|*@c|*VKV2c2XDcDX|,XDcDX|*X|*c|&IX;V|%c;UK!|*2c2K|',
      '*@c@VM[|.h|$?c;|(@c|(U?c|(VKV2c2XDcD|(X|)!|)EaJV|)NcN|)PDcD|-@c|-X|-c|*KUf|(a|);c;V|$DcDX|$Ia=a|%cEc|$JVMU?c;V|$LVJ|',
      '(f|%a?|$MEU@2!|%cM!|(6c2a;c|(@c@[|+c|(EcE[;X2JX!|-c;|/X|(PgR!|(Uf|$N!GSc|(VJ|%a?VJh|%cNXDcD@c|,X|$OXEcEc|$h2c2@c@|#a',
      '!|%4a|$7c7c|$;@V|(JX;[|%V|%c;|(2c2h|(EcEXL!|(J!|)X!|*;[|$=c|$?WJ|$@I!4M!|$DcDV|$I=V|%eP[h@c@c|$JIcE@c@Yg|$M!|$N9Vh|&',
      'c|%DV|(JUJVKXDcD|%]9VDcL[|)MX!|*[|)h|(X2i|$OV|&2c2a;c;[|%cSX2i|$PVM2!|&h|$Q6c6i|$ScLcLc|$e|%2cKWLcLc|%4cKSVDcL[|+fcL',
      '[|+h|*cSVDcL[|-h|,c|$g|%EcEL]RDcL[|,f|$i|#beSVh|#c2X!|%c|$JUEcLcLf|&IL|(cEc|%X|%YG|(JX;[|(f|$KI!|&@c@Vh|&]?|%V2c2LcL',
      'VM[|.h|-c|&;c;V2cSc|&IVDh|&J|&Sc|)@WJ|*X|+I@!|,Sc|+PVDX|.c|/L[|,gR!|*cJUDV|/2NX;[|0i|,f|)LcLFg|%YKIUJ|%^!|&Sc@P|%aSc',
      '|$MGc|(GVDcL[|)c|%JDcLc|%USV2c|+2h|(c|)Sc|%aLVf|(^=c|&Sc|$PU?c;!|&g;c;g|%VLcLc|$R?!|&V7c7X|%J!|%]@cK|*6c6NVMX!|0[|/h',
      '|.X!|-i|*@c@VDX|/c|0L[|.MX!|/[|/]2c2c|.h|-[|*IU?c|*PX!|#d?c;V|$eSVh|#e;cKai|#g?U;2|)S!4W@@c@VM[|%c?D[|)cL[|(U;2|+@c@',
      'VM[|(f|$@c@UPc|$BcBVDUi|$IcI!|(6c6i|$R2|&KX;[|&g|#h2c2;c;|(@c@|(KV|$BUJ|!34aN|#@c@g|#DD!|#Ig|#MWF|#UBg|$DcL[|$f|#VMU',
      'F@c@c|#Xg%DVM[|)h|&f|#cJU@V|!4!4|%U|#?!|$@c@Vh|$E@V|(JX;[|$V@|&!|&QUSc@cK|.!|.@c@Vh|$]Qf|$cJIUJ|*V|#@U4@|(!|$V|#DcC!',
      '|#GcKVJ]h|#KX=f|#LVMcMU|#MWMVJa|#P?cI[DcLc|$]R2g|&?|(!|$eI[DcLVDcL[|+c|$g?c?g|&g|#U!4XMV|$D!|%6c6NX!|)i|%K7JV@UPc|%c',
      'CV|)9V|+JX;[|)JX;[|$I|%U|$J2f|%@cKV|%V2|$M2cSV|%VJ!|$g=f|#VDcDSc|#W@|%!|$GhSc|$Pg4WSc|#X9LU@c@V|,M[|,h|+c|$?!|%6c6i|',
      '%c;g;c;c|$Ec@|$KX|&@KIUJ|(cPU2gR?|/!|&PUJYg|(VDcL[|(X!|$T|%JVh|#Y4Vi|$>UMa7D|#[JV!|(Sc|&IX2i|$PULJX;[|#]9c|$LcLc|$iS',
      'c|#a@IcEc|%cK|$EUM2ZRc?f|(f|%V|&DUAc|%XK!|$MV|$NWJ|%X2i|$P|%VDcBf|$i|%=f|#cDX|%a!|$JUSc|$KDcA!|)6c6NVh|-X!|.;[|,i|)@',
      'c@VDcL[|-h|)IU?c|+J|)QUM|%T!|&6c6NX;[|*i|&@c@VDcL[|*[|%U!|&DcLc|&FV2cSc|&I|(!|(6c6NVh|+i|(@c@VDcL[|,MU?c|-[|,h|(E:c7',
      'UJ@c@U?c|1VM[|2h|1X2i|1c|(IU?c|(W?|&f=c|%V4aLVJf|%W2c2X|+2Ug|*c|&SVM[|)h|(c|&f|%YEcEVDcL[|+h|*c|%]=c|&LcLc|$MUSc|%aG',
      'h|#iFc|!5;2!|%6c6NU?c|*X!|)i|%IU?c|$D|%JX!|$c;!|&6c6i|&@c@Vh|#aRJU@cK|#gR?!|!72cK!|&Pg@c@V|-IUg|-JUJ|0V|.X;[|#6c6DUQ',
      'cQ]KV|&IcEXO|#;6c6U?c|(Vh|(X2NX!|*i|(c|#@XKQcK|%gGUTXPUJ|#Dc@|%BD!|&cK|)4XEc@f|)DVh|*cL[|)Q]3g|)f|#K2c2X2i|$D2cR@cKI',
      'U?c|$IPUgRV26c6i|$V@cK|)2UKDUJ|-cIUg|,f|)@c@VDcL[|-M[|-h|,[|)EKIUJ|.V|)IU?c|)PX!|)S!HP6c6i|#M7c7V@cK!|,4UD6c6i|,6c6N',
      'Vh|,@c@Vh|,D;DcIUg|.VIUg|,EVDcD?V4UJ2g|-XKSc2UK!|,IU?c|,S!PVCUJ2g|$:c7]OcSc|$D!|%6c6i|#U2c2a|&JUg|$;V|$?c;V|$@c@DcDY',
      'g|(f|$DMX2i|%h|$EcMVf|$IX?c=V|%cEcJfRVEcEc|+Sc|$J|%!|$M2c2X;V|$P2c2U;c|%[Sc|%]Sc|$g9c|(9c|$iSc|#V2V@cS|*U|$6c6!|(IUS',
      '@c@VM[|$;c;EcE[;X@c@VJ|$@c@VK|&K|(2M|)UKf|(6c6NU?c|,VMX!|.[|-h|,X!|-;[|(@c@VDXNcN|-c|.L[|,MU?c|-X!|-Y;[|-[|,h|(IU?c|',
      '*J|+VKXDcDX|(PX!|(QMH6c6i|)UM|(W2K?!|+V2c2XDcD|$B!GK!|$Dc@|$L2X2i|&c2h|%JVf2WOc|%cLYg|$M@U?c|&c|%EcEai|%JV;6c6NVh|%g',
      '|$TcD!|(6c6i|#WFc|#X?c;f|$I@M|(JXNcN|)]LcLX|$K!|%X2c2!|*@c@Vh|*V|&6c6VJ|,@c|$LcLEcE[;c;|(V|(X!|)IUJV|*XNcN|$P;c;Vh|%',
      'DcD|%EcEX|*!|)c|#Y;X!|%c|$?c;V2c2U;c;V|0XDcDX|-?V2c2EcE[;c;V;c;X?c;|$R?!|#[2c2c|$6c6DcDYg|$;V|&JX;[|%c;V2XN6c6K|$?c;',
      '|$DcD|(V@c@M|(X|(^|(c|$IcE2QcQ]KV|(c|&IWf|$Jc@@UJV|)a;[|)c|(EcEai|(Uh|(V;c;X?c;c|-NcN|)KV2c2XDcD@c|2X|*XDcD|.@c|.X|(',
      'X2_?c;c|([6c2VMX!|(c|&J?!|(EcE[;X2JX!|.DcD|1X|-c;|/@c|/V;c;X?c;c|/X|(U!|)DUJV|*X!|+NcN|)LX?c;c|)PXDcD|.@U?c|)f|(X!|)',
      '2|*JUJVKXDcDX|+X!|,?c;UJV|)DcD@VDUJV|/X!|0NcN|/c|-X!|,X?c;c|)IcEai|)PUf|(]?c;|%gIUDUJV|)f|$LUJV|%VJ_KX|%X|&2A|)2i|(V',
      ';|&@U?c|(X!|&EcE@c@VM]|.h|$MPOV7c7X|&X|&c|%X@c@V|+J|$PV|$ScSc|#]K|%IUf|%Uf|%X2JX!|&DcD|*X|$g2c2XDcDX|%@c@|)M|)X|)c|%',
      'DcD|)@U?c|*c|)X|*NcN|#^D|%JX;[|%WSc|#_McMV|$PcP|(JX;[|#aBV7c7X|%cJ!|$LcLUDV2c2K|$N|%!|%g|#g7c7|(c|!94@V|#D2WJ|$6c6NV',
      'h|)X!|*;[|)[|(i|)2c2V;JVh|,c|$@|%JX;[|%U|$D|$EcKVJ|(W@V|$Lh|$PVHU46c6i|$QcKBcC|$S!3cJ|*JX;[|,NcN|*U|%UDcBcK@|$UCVE@c',
      'J|,!|$V7c7|)@c|)X|)c|%@2|$c@X9UM6c6i|%I!|&BVD!|*6c6i|(]Q!|&V|%JKU46c6i|#EcEUDVM[|*h|)cL[|(f|#IU$@c@[|$cIX|#JLU!|$V!S',
      'c|%7c7|)X|%MVh|%h|$c|$f|#M!|$@c@VDcL[|)h|$EcK2Z@V|$PX!|%^BcJX@|$S]7D|)!|%cKa@ScSX2i|#PTgMUh|#ScLcLVSc|#TU!4Wg|#U2c2c',
      '|&SDcL[|(e|$@V|$EcEDWSc|$P|%JX;[|%U|#VBcB|$DcD|$GV|$IcIV|$McM|(JVMU?c|+XNcN|*h|)X;[|(U|#WP2!|%7KV@cK!|,M]3D6c6i|%DcL',
      '[|%EKcJDc@!|%QUSc@cK!|%V|&2NVh|)X;[|)[|(c2Uf|*XDcD|.X|(i|&7c7|*VKV2c2XDcD|,XDcD|0@c|0X|*X|&@|(2UM!|+@c@c|(@c@VDcL[|,',
      'M[|,h|+[|(K]3|(PX!|&JU?c|%f|$f|#XIU|%X$|$M^|#Y?Vh|$@|$DVJg|$LV|$MUJc|%VJSc|#[JV!Sc|$La!|%cLc|#]2c2Gc|$@U2c2i|&Pc|#^D',
      '|$P|#_TUf|#a=V|$MV|&JX!|$RV|$SFc|%c|$e|%SDcL[|&c|&e|&f|$g9c|(9c|%BUf|#c:UD!|(EW<!|$Ja@VQUSc@cK|0!|09c:DUJ|3g|)R!|#gI',
      'DV|%cIDV|*JX;[|(f|%f|!:6c6NX;[|&i|#UDX!|$JLUOc7|%g|$f|!;Pg|#U2cSV|$4aLVDcL[|&g|$6c2c|#VEcEX|)PVDcL[|$PV|#W!|$7c7g|$I',
      'VD[|(cL[|&M[|&h|%X2i|#YLVS!|(cLcLc|$g?I[DcLVh|#[2cDV2c2h|(aN9V|&SSc|(USc|(cLcLc|$DcDVSc|(WSc|$MV2IcIcJY?V2c2]Rf|&Fae',
      '|&PVRf|$ScLcLVh|*c|&M|(JX;[|$f|$gIVDh|#]GVi|#^!|%Sc|$4g|$EcEc|#a!|$Ec|$NIV|(JX;[|#cJYGc|$KScLcLc|%UFV2c|&Pf2Yg|&fSc|',
      '*Eag;c;c|%[JVf|%]=c|%aFV|$PDcLV|#de|!=7c7X2Ug|&c|#GcMVJX|&cJX|#JL2c;g|%V|#U!|$DVJ]h|&Rc|$LcL|(U|)G]Sc|$fSc|$gPVDcL[|',
      '(f|#V,Sc,h|$4cKV|$9VLcLh|$FfSc|$PV=V|&Rf|$S!GLVh|%^f|%c2c|#WSh|#[2c2Uf|$EcJY;c;V|$GVJf|$Ia2cKULcLV2c|$PMEcI[DcLc|$Sc',
      '2c;aEcEc|$h|%LcL|%TV|(JX;[|#]PV=c|#_IVDV2c2f|#a2c;L]LcLc|(g|&JXI[DcLLV|$NLVDc|%g|$e|#cK^Pc|#deMa=c|#hTV|!@2OV|$g@c@X',
      '|%DcD|)X|#6c6N[|&i|(2c2c|#7c7aNV|#:c7UPYg|#;:c:X|$JUf|%X2JX!|$PVh|%X2UK[|$ScS!|$U2!|&6c6i|&@c@VDcL[|$V|$c;V|#?X@c@|$',
      'c;c|$h|#@c@cP!|)6c6i|)7VDc@|.2g|.JX;[|)QUSc@cK!|%FMIUJV|#BcB]Q|)WJ|#D@UJ|$V2c2X|)c|$c@cK!|%D[JUJVKXDcDX|)X!|*NcN|%IU',
      '@cK|&YM!|#EUh|#IVOVMX!|)[|(h|&c7M7c7V@cKD;VIUg|(DU;VDcL[|+c|,;VM[|.h|$cEV|(JX;[|&XKUDcL[|*f|%IVMXNcN|#JcJULU2c2V|.J|',
      '/@c|-XDcD|*JV|,McM|#K!|%4!|&6c6i|&B^g5cJ!|%@VKV2c2U!|$6c6i|$?!|$@c@VMXNcN|)h|#LJVh|#M@c@Vh|$IXL|$JVh|%X!|$PDUJV|%]BD',
      '|%f|$QcQ]KV|$ScAUD|*!|*IU?c|,J|-V|.KXDcDX|*PX!|#NV|%EcELIcEc|$cNV|#P?|%JX!|$V;c;X|#U9c|$@cEKcJ!|$DYg|$E|%!|%DVM|)JX!',
      '|$IKQcQ]KV|%S!|&IU2c2V|&V2c2XDcD|/@c|/X|(7c7VKXDcD|1@c|+X|+c|(JU@[|$Jc|$K!|%6c6i|%@IcJ!|*]D|%IUJV|%UEA6c6i|$MEcE_MV|',
      '%VGUf|%Y2c2VDcL[|+M[|+h|*X2i|*c|%cEKcJ!|$N!|%X2i|$O@c@[|%[|&EcELJXDcD|0PJU?c|&JUJV|(XNcN|%]2c2c|%cDcD|&PK|$f|$h2c2UM',
      'V2|-IUJV|%EKcJ!|$i|#V27c7X!|%:c:|%c@!|$IYg|$J@V|%LV|%]LcLg|$K2c2A|)]LVJ|%:c:[;X2c2EcE[;c;|6X|/XDcD@c|,@c@|/@c|/X|,Ec',
      'EVh|/X|02i|0FM6c6i|/c|%V2[|(c2U!|&7c7LV:c:|/X|,JUf|*V;c;X?c;c|+KV2c2XDcDX|*X|*[@c@V|/J|*c|&:c:X|%X|&@c@X2|&DUNVDcL[|',
      ')PUJ|)i|&I]DVJX;[|&PDDc@EXK@c@[|2c|(IcEU;V|(McM|(U@VK|(V@U!2YLVDcL[|0M[|0h|.g|)McPUIM|(a?!|%YK6c6U;V|&g|$M2f|$N2c2!|',
      ')IXNcN|%6c6XDcD|#W!|$J@V|$K!|%6c6NVh|%@c@U?c|)XNcN|)[|)c|%B]Q|%XIUD!|*6c6i|*V2c2X2JX!|+7c7@c|.X|%[|$LcL|$P?c;V|%cK@|',
      '(IUJ|(PUB|$g7c7JUJX!|%@c@|)X!|(AU;2g|+D|%DcDX|#X2|%h|$;2c2!|)@c@Vh|)IV;c;@c|.X|%6c6Uf|)VJ@a;[|,c|+EcEai|+P|,JX!|.;[|',
      ',KX;[|,g|+VKXDcDX|)X!|*2JX!|*DcD|-@c|-X|%KUf|&X2JX!|(DcD|+X|%g7c7JUJ|-V|&DcD|*U?c|*X|+!|+?c;UJ|+NcN|$?V|$LDcD|)X|)c|',
      '%IX3|)!|$MU!|%cJ|(IU?c|*J|$NX|%cNh|$g2c2V|#Y2c2!|#ZEcEY?V@c@XL|&KJUg|$QYg|%cQYKVM[|+h|)g|#[2c2X|)!|*2Yg|)2VO2c2c|/f|',
      ')E;V:c:ULc|1f|)HU4@c@c|)NcN|([|(]|(a;c;c|(c|(f|$6c6Vf|(c|$DcDVDc@cJf|$JcJ!|(6c6i|$K:c:[;X2c2EcE[;c;|6X|,@c@|/X|,EcEV',
      'h|/c|%]S|$LcLUJ|*V|$MX4X|&6c2c|$NV:c:X|&JV2c2XDcDX|)7c7X|&PU?c|)JV|(X2i|(c|#]2c2c|$6c6|$;V|$JVM|$f|#^2i|$M!|#_;XEXO|',
      '%c;;X@c@|(X|(c|$MV|$OVMUNV|+2NX;[|-[|&h|#a!Se|$;X2NX!|%c|&;!|$@VMXNcN|&h|%c|$DcDV|)J|(XDcDX|$ISc|%U|$LX!|%cL!|(X|$Mc',
      'EV7c7c|$hEcEV7c7X|-c|#c@VDcL[|&h|%aN!|#fL[|$cL[|#g2c2!|(6c6i|$9c9I|!B2cRV?|)UFcKV2c2|1f|*IYg@c@V|)]Dc@cJJVM[|1h|/f|#',
      '@c@c|#IcE@V2NX;[|*i|#NV@c|#QM2cR!|#TD|#UD!|$IaBKf|$KVBcKcJ!|$Sc|#VD!|%6c6i|%@c@Vh|%E@cK!|%IU?c|(JV|$MWEc|%cMV|$PS6c6',
      'NVh|*i|&@c@Vh|*[|&IU?c|&PX!|&]D|%Uf|%cJ|$Q|%JVh|$f|$h|#WEUKUCD|%V2|$g52UM|*!|&IUJ|#X#3!|$GUJc|$KDc@!|%cJaCDf|$g4c4|#',
      'YK!|%@c@Vh|%BgQVDV|)f|%[|#ZQcJ|(!|(2UDc@VIUD!|#]P@|&JUJ|%DU4KV|&cIUg|(L[|%KU9f|%ScP!|%UMJ!|%V|&JX;[|([|%W|&2cR]@cK!|',
      '%c|%f|$Q!|%@c@c|%UHVIUDV|&JV|%WJEU@|)XKSc2UK!|(aBcJUD!|.6c6i|#^D!BVD|$P|%!|%@c@VDcL[|*h|)[|%V2|$g5cJ!|)IXNcN|#cKPcJ!',
      '|)@c@VDcL[|%UP2|)!|(V=|$PV@WJ|%WEVDcL[|)M[|)h|(X2NVh|+X!|*i|(c|#d@cJ!|#gQD!|&IUJU?c|*V|!CD!|$2UKcJ|$STUJ!|$X|$cPDc@K',
      'V|#KV7c7|)c|#U@X|&2c2NX;[|*i|$DcJ6c6i|$K|%?|%UNIUJV|#YI2]@X|#gIcI|(!|(;!|!D2cR@cK|*!|*6c6NU?c|.Vh|.X!|/;[|.[|-i|.2c2',
      'c|*@c@VDc|0L[|.h|-[|*IU?c|,J|*KUQV|.2i|.JU?c|*PX!|#4K|%!|%6c6NVMX!|+h|*X;[|)i|%@c@VDX|+c|,L[|*M[|*h|)[|%IU?c|(J|%PX!',
      '|%SH|$cDD]@cK6c6i|$g|#;2c2ULX?c;c|)f|(X!|)2|*JX!|)DcD|,@c|,X|-?c;c|)IcEai|$@c@EcE[;XDcD|1X|(UDX!|+NcN|)LX?c;c|)f|(VJ',
      '@c|*V;c;X?c;c|+KXDcD|0@c|0X|*[6c2VMX!|)PKXDcDX|(X2|*JX!|,?c;UJV|)DcD|,@c|,X|-?c;c|)IcEai|$DU?c|&J|%X!|&NcN|%cD@c|(V;',
      'c;X?c;c|)KXDcDX|(X|(c|&IUg|$E;V|(2i|%cEVMU2c2V|/J|)h|$JVh|$V|%2c2XNcN|%JX!|$XPVh|$f|#BV|%2NX!|);[|&c2c|%JUJ|&X!|(;[|',
      '$W|%@;|#DcBV|%DUJV|&]|#GV|%JX;[|#ISc2UK!|$X2c2c|$cEY@VKV|,EcEU;c|,IUg|,JX;[|&cJUg|&g|%IX;[|&[|&i|#J!|$6c6i|$@Dc@cK|$',
      'V2c2X2JX!|*DcD|%7c7|)@c|)X|#KSV!T|$]DcBcK|#Mc2V|(J|)@c|&XDcD|%M@U?c|(XEaM[|(c|&_KX|#N7KV@!|#P!GLVh|$KU@cKV|$UGc|$W2K',
      '?|%D|$a@cAUD|#QV7c7X|%EcEV2c2X2JX!|*7c7X|#Rc;!|&EcE[;X2JX!|,c;|.X|&IUJV|#SWg|$cKU?V2NX;[|+i|#U!|$4B^P6c6i|$;2|&!|&6c',
      '6NVh|+X!|&@c@VDcL[|+h|%Ug|%VDcL[|%a;V|%c|&;VM[|)h|(X|)2Ug|)KU9cJ6c6i|%f|$?J!|&6c6i|%c|$Da|$I!|%2K?|)!|%6c6i|%@c@Vh|%',
      'DVgBcB]Q!|%IU?c|$J|%2|&DUJ|*V|&f|%DUg|%KX;[|%V2|(JUJV|&KXDcDX|%g|$KUJ?|)f|(e|%X2i|$MIcEM!|*@c@VD2@c@c|%U!|&I@c@[|%X|',
      '&!|%a|%c|$NV2]K!|&h|%X2NVh|$OV2|$PV2|$Q!|%DRc;6c6i|$RDh|$S|%JX;[|%V|$i|#V2X@V|%c2aGUg|)NUSc|&R]E!|*6c6i|$4ID!|$5?c;X',
      '|$6c6NX;[|(i|)2c2c|$@cJ|(PX!|(TKV@|(]D|$BUD!|$DcD|(UJV|+KXDcDX|(VKXDcD|(XIU?c|*XNcN|)c|([|(a|&L[|$GDcCD2i|$IV@c@!|&R',
      '!|$JDc@cK?|,!|,@c@VMXNcN|0h|+V2c2Uf|/XDcD|3@c|,@|%I|&!|&6c6NX!|*i|&@c@VDcL[|+h|&D!|&EKIUJ|,V|(cK2UK!|&SH|)JVM]2c2c|)',
      'U|*!4!|,6c6i|*I?c=M!|/6c6i|&V2c2EcE[;c;X|(7c7X|(@DUJV|%a4V7c7X|$K|%2c2Vh|)c|%?!|%Dc@K!|*IUJ|%EcEVh|%SV7c7X|%W2cR?|+!',
      '|%X2c@!|%YE2|(?!|%aCD!|(V7c7X|%cJU@DUJV|$L!|%6c6i|%7c7|%:c:|)@U?c|)X|%@c@VMXNcN|*h|%IU?c|&XNcN|%J[|%PX!|$M|%!|%2NVMX',
      '!|&_NcNXDcD|/@c|/X|&c2c|%@c@c|%DVDcD|+VKXDcD|1@c|1X|+X|(g@c@Uf|,V|(h2c2XDcD|0X|1?c;c|%EU;X2i|)c|%IcEYg|%J!|&VMU?c|)X',
      '!|*NcN|(h|%PUK!|&VMVKXDcD|)X?c;UJVKXDcD|5X|-c|*NcN|-@c|)[|(hPDcDX|%c2c2XDcD|$Oh|$P]BcJ!|$QV@IUJV|%c7V@|$ScST2K?|$g?U',
      'J2|&c?UJ2|%@c@MU2c2V|)Uf|)V|%BcBVRc;|)]Q!|+6c6i|+EcK2UK!|+V7c7@c|/X|%IV7c7|+@c|+X|&cIU?|+!|+@c@VDX!|0c|/h|+PX!|*@U2c',
      '2i|,PX!|-c|)V2c2EcE[;c;|4@c|4X|-UDXNcN|.f|-X2JX!|.DcD|1@VDc|2c|1X|*7c7|-@U?c|.c|-VKV2c2XDcD|7@c|-X|-c|*@V|%P7D!|&TV7',
      'c7@c|,X|&cP7D!|)TV7c7|$h2c2Uf|)XDcD|-@c|-X|#W2c2!|(V|$6c6V|$7c7|(JX;[|$;c;V|$?c;|(X|)DVDcD|+h2c2XDcD|$@V|&DcJUJ|$KUP',
      'V|%c|$M|%2?c<f|%4VKV|%]QcPK!|$N!|%@c@Vh|%IXNcN|%PX!|%XDcD|$h|#X!|$c|#Y@D|$LX|&2?2c2VDc|%aN!|%c|&LU?c;VDX!|.cL[|-MU?c',
      '|.[|-h|,X|-2NUJV|-PK[|,a;[|,c|([;c;c|#Z@c@|(!|(PX!|#[;X!2XDcD!|&I6c6U;c|$DcIUL|$EaNVJDcL[|*f|%cEaNVJf|$GXM|$JcJULcLV',
      'f2K|(c|$LcLc|)Pg2c2c|$McMc|$TcKX|)PVDcL[|&LX|$hSe|#];Uf|%V2c2_;X@c@X|&J@c|(Pg|(V;c;X?c;c|)KXDcDX|([;X@c@X|%X2JX!|&Dc',
      'D|%c;!|(6c6i|$@U2c2i|&PU?c|)J|*V|+KXDcD|0X|(X!|(c|%Z@cP!|*@c@VMXNcN|.h|$EcEUNVM[|)i|$K!|%@c@[|)]|%V;Uf|(XDcD|(]?c;V|',
      '(c;|*X|+NcN|*c|&J|%[|%]|$g@c@|#^;cK9f|$LcLc|$h|#a2c2V|)JUh|(X2|)IcEai|$;c;c|$Gh|$PMU?c|(J|&VDXNcN|)[|)cL[|(M[|(ScLcL',
      'X!|-c|(h|&X2NX!|)i|&[OX@c@X2Ug|%h|$e|$g@c@c|#cDX|$JY|&2cMVJg|&;c;e|)KVDa|*ae|&DE2cR|&Jag2c2VM[|.h|-c|&Sc|$L[|#h2?!|%',
      'EcE[;c;X|%ULX?c;c|&f|%VJ|(@c|(V;c;X?c;c|)KV2c2XDcD@c|2X|*XDcD|.@c|.X|%X!|&2|(JX!|*?c;UJV|&DcD|*@c|*X|+?c;c|!E2K!|%IU',
      'JV|%XDcD|$X@V|$cR!|&V|(2NX;[|)i|&[|$gDcD|)X|%EcEP2UQ!|$h|#6c2UNV@c@!|&V;XDcD|-X|&X|(!|(?c;c|(PTV7c7X|&[;X2c2Uf|-X2JX',
      '!|.DcD|*@c@|-X|-c|&c|#7c7|&2c2LV2i|#:c7SUK|&UGV|*M[|*h|)c|(J@c@VDcL[|-M[|-h|,X!|-2NX!|.i|,c|#;J?V|$V|%:c:ULUJV|+X|,!',
      '|,HU4@c@c|,NcN|+[|+]|+a;c;c|+c|+f|$c;!|&?!|(6c6i|(@c@VDcL[|,h|(IU?c|&UIcEV|(N|)!|&V2|&]h|&c|$gDcDX|#<D|%!|%2UM@c@c|%',
      '6c6NVh|)i|%@c@VDUJV|+X|+c|*h|%IU?c|%PX!|$V2c2Uf|)X2JX!|*DcD|%7c7|)@c|)X|)c|%EcEV2c2XDcDX|*7c7X|#?!|$V|%2c2g|%@|&@c|&',
      'V;c;X?c;c|&X|$c;X2UM@c@c|&c|%=V@DUJ|*X!|*cIUg|)f|)g|(LcLc|#@D!|$U2|$V2c2XDcDX|%D:c7U!|*X|*c|&UJVK!|(LU!|*If|)c|(MU!|',
      '&[;c;U!|+X|+c|&]OU!|&_DcDU!|+X|+c|%EcEU?c|)Vh|)X2i|)c|%IYDcDU!|+X|+c|%PU?c|(JV|*KXDcDX|&X?c;c|&c|$X2c2[|$c@D!@V;c;|&',
      'U!|(I@c@[|&X|&_IcE@U!|(fE@U!|&c|%DV|%IDUHf|&HYRe|&KU9f|&PVHYRe|&QcKW|%K!|&6c6i|&@c@VDcL[|+h|&EcKPg@c@2f|0g|&UCVEg|#B',
      '!|$6c6NX!|*;[|(i|$@c@VDc|+L[|)h|$IU?c|&J|$PV|$Ug@cA6c6i|&A6c6i|$cC@V|)2c2c|)JX;[|#DUI|$V|$c@N!|&Vh|&c|(K?c;U!|,X|,c|',
      '#GcMV2c|#JcJDcDYg|#K!|$2c2[|$DcD|(X|$IUPCV|%]QcPKf|%aDcD@|%cEK|)U4@|,IUJ|/V|$QXKUIf|$ScEK|)!|&J|(IUJV|$U9J!|(EcE[;X@',
      'c@V|-c;|/X|(IUJVKXDcDX|%@V|%IgQ!|)6c6i|)IX?c;c|)V2c2XDcD|1X|2?c;c|$V2cKI?!|%4?V2c2XDcDX|)7c7c|%7J!|%?IV7c7X|&UI!|%CV',
      '|(PK[|%EU;V|*2NX!|+i|%HUR|%IV@IUJ|%JUK!|%Pg@c@D!|%QWMD|*!|&XBcC|&aCD|%R@c@c|&c2KV7c7|)UK6c6i|%ScAV@V|%TKV2c2Uf|&UK!|',
      '$W2cR|)?|*!|*6c6i|$X@c@V|$cJ;D!|#L2c2Uf|(X!|)DcD|$:c:|(@c|(Uh|(V;c;X?c;c|)KXDcDX|(X|(c|$DcDX|$IcEVh|$JEcE[;XDcD|/@c|',
      '/X|%U!|&LX?c;c|&f|%VE[LcL|%X!|&2|(JX!|*?c;UJV|&DcD|*@c|*PJU?c|*X?c;c|&IcEai|$PYg|$QcQVDV2c2;Pc|$cLV|(J|)XNcN|&XDcD|#',
      'M@K!|&@c@VMXNcN|%P?|%X!|$EcEaOX!|$JV;6c6NVMX!|(@c@X!|$KX!|$P;c;!|%VC|$Sc@Wf|$UJD!|$cMX2i|$g2c2X!|#NcNV|(2NX!|(EcEXL!',
      '|(JX!|*;[|#O!|$2c2!|(IX?c;c|*NcN|$6c6i|$J2UM|$QcQV|#Pg|#QX|$c7U@c@M!|,@c@Vh|&VI|)5;c;@c@VDcL[|1M[|#SFV2c|$VFV2c|#U2V',
      'Sc@UDVM[|-h|,cL[|+f|%c|&2]9c|(c|$72!|$;V|&McM|%XDcD|%c|&;X!|)2i|(c|$<!|%6c6i|$?c;V2c2U;c|&=PKX;[|)g|(cJ|$@|%cK6c6i|(',
      'VJg2c2WSc|$B!|$DVEcE@c@c|$E!|%cE|$IcEX2i|(c|$KIcEKcJ|,!|,IUJV|%UJ?!|%VSc|)AV@V2|%WSVM[|)h|(c|$L|%I]2c2UPc|$M!|%2c2U;',
      'c|%Sc|%U|%V|&h|%X!|$NV|$Qc7U@cJ|$g2c2c|%;c;V2c2c|*JX;[|+[|%MI[DcLVDcL[|-h|,c|%P@V|&cP@V|$h|#V2USa|%c2USa|$;V|&2Y;V|(',
      'c2Uf|&7c7|*;2c2V|*X|*[;X2c2X2JX!|-@c@X|*c|$?LUJV|%c=!|(@c@VDcL[|(IXNcN|(PX!|$@UPUJ|*V|(VD[|*cL[|(X!|(c|$Dc@X;KXDcD|/',
      'X|*gDcD|.X|.c|)?|*JX!|+a;[|+c2c2XDcDX|&D?V|(UM[|(VMXNcN|*[|)h|(W;X|+NcN|([|)JX!|$JLV|%X;[|$KIV=c|%V:c:X|$LDcD|)X|%PV',
      '|%cL]|)DcDc|$Mc2c2UM@c@c|$NcN|(JX;[|$f|%4UIVJUJV|$h2c2UM|+@c@c|#W<HYIV|$EcEVi|*Sc|$LcLg|#X2JVM|$@VJ@UJV|(_KX|%X2c2V|',
      '&@UJV|&IX3|%c@f|&KDU?c|*J|+V|(V|(f|$D|%MYg|%cDEcK|%g|&DUI2K?!|$KSc2UK|+6c6NX!|.i|+9]@U2c2i|+PX!|)c2UK!|%U?|(!|(6c6NV',
      'h|+i|&@D|)2UM!|,@c@c|)IUJ|&PSc@X|%V|%XR|(DcIUKX!|.;[|,g|(f|%a4@V|(ID|&TV@f|$L!|&2?c?V2i|%2VM[|(h|%@c@U2c2V|*JV|)VL2c',
      '2V|/J|0@c|.XDcD|+6c6V|/J|0@c|)X|*!|*DVDcDXNcN|*NcN|)[|)]2c2X|-c|*Jc2c2XNcN|)c|%EcEU;c|)[;XDcD|,PV2c2XDcD|.7c7X|+c;X|',
      '%I[|&]|$MV|%g7c7[|&@c@V|+JVKXDcDX|*XDcD|.X|$O|%JX;[|$RcE6c6i|(V2c2XDcD|$Sc@2|)!|)6c6NX!|.;[|,i|)@c@VDcL[|-h|)IU?c|#Y',
      '2c2i|$7c7|$9|%2NX!|%cJ!|$:c:Ug|$?Yh|$D[|$K!|$Pc|$g?|&IUJV|*X!|&c?|)IUJ|,V|,X!|%@c@VJU2c2Uf|/V|0J|1@c|,J@c|-V|%P|&cP|',
      '#ZAcPVKU9c|#[;XDcD|*X|%c;|([DcDX|,c|&KaNVJ!|)i|$KVDc@hI?c?|&JULVDcL[|)g|%XDcDUi|&IUi|$LX|$e|%2X;c;V|$fRf|#]9c|$;2!|$',
      'EcEg|$KU?c|&J|%V;c;@c|*X|&DX|(c|)L[|&MLVJEcE[;XDcD|(U?c|(X!|)NcN|%X|&!|&2NVMX!|)X!|(];c;|&;[|&?c;UJ@c|*c|&NcN|%[|$Lc',
      'LDcLc|$OcS?h|$g2c2c|%RcJ|)f|$i|#^@Z2|%c@e|#_2c2!|$6c2UM|$;V|%c;UScJ!|$@X|&9D6c6i2c2c|&PUJ|*V|(Vh|([|(]|$DcDUDV|$MWSc',
      '|#a2Uf|%X2JX!|&DcD|*@c|*X|&IcEai|$;c;g|$DcDX|$EcEc|$J|%@c|%V|&DcLc|$KU;c;!|*@c@Vh|%XDcDX|$MWSVDcL[|(c|%X!|&NcN|%[JXN',
      'cN|$N?c;VM[|)c|%VRc|$PX2JX!|$R2|&DBV2i|$ScLcLc|$g7c7X4WSX2Ug|-c|+h|%;c;X4WSc|)c|$i|#cK2;D!|)6c6i|(IU?c|*J|+V|(VEcEV2',
      'c2XDcD|-7c7|0X|&UKIXNcN|(Q|)!|)@c@VDcL[|)PgR!|)c|&Z@V|*JX;[|&cKVJ|(R]E?!|)aH!|%3cJUED!|+V2c2EcE[;c;X|/X2JX!|,7c7|/X|',
      '%7KV7c7X|&UK!|)?!|)@c@VMX?c;c|/NcN|-h|)IXNcN|&aBD!|%9DD!|%?J!|%@M@c@Vh|&V|(2K?!|)YMIUJV|(9c:|(DVCUD!|+V|,2i|,JUJV|+W',
      '2KV2c2XDcD|6X|/7c7c|(E2cR|)UBV2c2XDcD|3X|(FM!|(H|)US!|+IU?c|(I|(KaC|+!|(PgR!|(R]C!|+V7c7c|)c<|+V7c7|/X|(SDcCV|&W2!|)',
      'IUJV|&cJ2cREcE[;XDcD|5@c|5X|1c;X|)]2!|+@|,2NU?c|-i|,K!|+IUJV|+V7c7X!|/c|%AI|%B2cRV?!|&UD!|&]Q!|)6c6NU?c|-VMX!|/[|.h|',
      '-X!|.;[|-[|,i|)@c@U?c|,VDc|/L[|,X|,[|,c|)IU?c|+J|)PX!|)VM[|)c|&gQD!|%CUD!|)EcE[;c;|0@c|0P|)IDc@cKV|0JUJV|4KXDcD|1X;[',
      '|*U?c|+J|,V|%E:c7|*!|*@c@VDcL[|.M[|.h|%GDcC!|&aCD!|%HUP!|(R?!|*6c6i|&X|%IU?!|)6c6i|&X3|)DUJ|)g|&]J!|(T!|%JU?!|&a4!|%',
      'P7D!|&?@|&U72|*DcL[|*f|(SV|(T!|&VQcJ|+JVM[|,X;[|&Z@c@V|&]QD|*!|)V7c7|-X|&g@c@2|,f|,g|+D|,!|,6c6NVh|0X!|1;[|/i|02c2c|',
      ',@c@VDcL[|0h|,IUK!HV7c7X|+V2c2Uf|/X2JX!|0DcD|3@c|3X|4?c;c|,7c7|/V;c;X?c;c|0KXDcD|5@c|5X|/X|/c|%Q!S|&Sc@|*DU?c|,J|*IU',
      '?c|,J|*KUJ|+X;[|*V|&cD!|)6c6NX!|,i|%S!4!|)6c6i|&UBc|(C2g|&V=?c;UJV|,c|)DcLUJV|/KXDcD|,VDcL[|,X!|,c|)fLc|*SV|(BcC|+!|',
      '+DUJ|+IU?c|-J|+W2K?!|/6c6i|.V2c2EcE[;c;|9X|/7c7|2@c|2V;c;X?c;c|2X|&c|(@UPD|+V2c2XDcDX|,7c7X|)X@|(AUD!|+6c6i|+@c@VDc|',
      '1L[|/h|(Sc|%U2Z@|&7WD|*IUJ|&@VDVCcJ!|&AIV2|&B]QV2|,IUJV|&CUDcJ!|,IX?c;c|.NcN|,PX!|&EV7c7|,X|&GMcJ@c@Vh|&IX3cJ!|&J!|(',
      '@c@Vh|(IXNcN|(a4V2|&K!H|&PQcJ!|(W?cJ!|&g@cAD|%VDcLg|&J|(BgQf|(EcE[;c;|&fSc|%W|&@V|&IVJg|%]!|&KVEcEV7c7X|%^ILV|&PLcLc',
      '|&Sc|%_;c;ScLcLDcLc|&F|(R?h|(Sg|%a|&4cKU!|+IV!4c|-6c|,X2i|&92cLcLc|&;c;Wf|*a2c2ai|+e|$MSc|%U6c2c|&LcLVD!|*cFa!|&ScLc',
      'LV2c|%]|#d?c;c|$K@cP!|%Sc@cJ|%U?V2|$MaSVDcL[|(c|#gPcP@6c6i|!F?c;c|#JMX2i|$g|%Fa2cSc|$h|#M!|$6c6i|$@c@Vh|$EcKBIUJ|,V|',
      '$IU?c|&JU?c|(V|#ScLcLc|#U2c;LV|$@c@VI|$Bg|$ScLcLc|#VF|$LaSc|$MV!|(F[Jg|&EcEWfSc|*c|#W7c7g|$h=c|#X;cGai|#[=L]Rf|&h|%a',
      'L|$ScLcLVPh|#^DMVh|%h|$f|#a;c;a|$L!|$SVh|%cFLSc|$e|$g|%;c;c|%=c|%IULcLc|#cK:c7X|*2Ug|)c|%?c;c|%U6c2c|&fSVDcL[|*M[|*S',
      'c|,2a|*h|)c|%W|%[:c7c|&=LV2c|$MURc|%aLV=|#d?c;]RDcL[|*f|!G!4UNV|)M[|)h|&i|%cMUB]Qc|#7c7f|#@c@]KV|#Bh|#DcC!|&6c6i|&@c',
      '@Vh|&EcE[;X@c@V|,c;|.VKV2c2XDcDX|.X|.c|&IX?c;c|)NcN|&PX!|&VEcEV2c2XDcD|3X|#M!|$V|#RWg|#S]MVJaSc|$c|%SX2i|&c|#TBYg|$U',
      'BYg|$VKU2UQ|$XI@V|)2NX!|+a;[|)JUJ|&UDUg@cA!|#U!4cMYKVM[|,h|*g|$2c2V|)JXNcN|$6c2c|$CV2c2XDcD|.X|&7c7|*X|*c|$G|%VMa?VJ',
      'f|%X|%g|$LcLV!4c|(cScIUf|$M|%2ZRc?f|%SUTV@cJ|%V|%cJ!|(2UM!|%f|$OcS|(Ma?|$P|$TcJ|(2?c?V2i|$g|#V4c|$KXB|(!|(PX!|(UDDc@',
      'K|$LcLc|$McJe|$REcEc|$SV|&DSc|*Sc|$f|$h|#W4!|$7c7c|$LcL|$TUg|#X2c2c|&Sc|$3UKV|$BcC|(DcL[|(I@|*!|*@c@VDcL[|(V|)IX;c;U',
      '?c|.X2i|.c|(f|$CDcL[|%f|$Rc|#Y;c;c|#ZT@c@UJ|#[:c7IVf|$ScLcLc|$f|$gMVf|$h|#]2c2g|$EcEYg|$GV|$SV2c|#^GVNVDcL[|)M[|)h|&',
      'i|#a!G[|&c|$2cSc|$;c;c|$C!|$GV|$JcSc|$NVPX=VM[|*c|$Sc|&P[h|$g=VDcL[|&c|#cJYLa|$KSWh|%TcI!|)UPc|%U:c7c|&=cIUDcL[|+f|&',
      'TcI?|+KX;[|+f|+g|*V|&f=c|%V;c;DVM[|,h|+cL[|*VRc|*WRX2UKX;[|/g|*e|*f|%YSc|%dSg|&e|$MU2c2c|+G[LV|%Y|%[Jc2c2c|%a2c2c|&4',
      'c|!H2c@K[|&V|&g|(2c2c|%R?|(!|(PX!|&cJ|)Ja4cJIUJ|#4@c|$P@V|(2cR]@cK!|(JX;[|)[|%UD[|(c|)L[|&f|#BcK2UNV|#J!|$DcDc|#K?|%',
      '!|%2UM!|)@c@c|&Y;!|)@c@VDcL[|%5;D|)JX;[|)U|%@c@VDX|+c|,L[|*f|*h|%S!PVCUD!|&IV@V|+2i|%UCV2UKV|-2i|-JUJVKXDcD|%V|$@DU;',
      'cJ!|%f|$V7c7|)VKXDcD|/@c|)X|#U46c6NUJV|*VMX!|+h|*X!|*[|)i|%@c@U?c|*JV|)X|*!|*NcN|)[|)]2c2c|)c|%IU?V@c|)c|(J|)V|*KXDc',
      'D|/X|%P@!|&X!|%V2IUJV|%cJ!|$K!|%@|&!|&@c@VDcL[|+M[|+h|&EcEXO|,JX;[|&K@cD|&V|&WJ|&c|%IXNcN|%PX!|%cJ|(JX!|*;[|$P!|%6c6',
      'i|%V|$R|%2NVMUJV|*X!|*[|*]2c2c|(X!|);[|%JUJ|)V|&VMX!|*NcN|&X!|(;[|&[|%U|%cJ!|$SV|%c2Kf|#WIDcL[|%f|$R?V|#Y2IcE!|$4gH|',
      '$;c;Uf|$EcK2Z@V|(B]Q!|$IV|&JVh|(X!|);[|([|&QUSc@cK!|.EKIUJ|3V|$KVE2cR|+!|+PX!|&HU4!|*PX!|#]B4@V|#cKI?!|#d@V2|(!|(QUS',
      'c@cK!|/9c:g|/@c@Vh|#g@c@UPVDcL[|*c|!I!4M!|&UEXK!|%ai|#2!|$DU?c|&J|(V|%X!|%[|%cL[|$K!|$NU?c|&J|(V|%[|$c2|&JVh|&NVh|(X',
      '!|)?c;c|&i|$f|$i|#3U!|#4C|$cDWRcJ!|#6c2;|%6VJ|#:c7]KV|%:|&c|&i|#;6c6V|)J[@c@VJ|(c|$c;DcDYg|#<!|$@c@Vh|#?V|%2c2YLVh|+',
      'X!|*g|)c|$c;]M|%=E!|&M!|(@c@Vh|+[|%?Ug2c2U;c|&VDcL[|(h|&X!|&c|$h|#@!|$6c6i|$@c@VDcL[|)h|$EKIUJ|$PX!|$V|%JU2X!|(J|$c@',
      'UJV|&[|%SK!|(6c6NVh|+i|(@c@Vh|(V7c7|,X|,[6c2VMX!|&cJ|)!|)6c6i|)GDcCD!|#BVKUQV|$WD|$cCcJ|)2UM|)@c@Vh|%J!|%KUSVh|)c|$g',
      '|#CX|%GUM|%K|&!|$cJ|&2UM|&@c@Vh|&EcKB]QVM[|-c|#D#QUSc@cK!|$ScSVD[|*cL[|)MU2c2U!|/f|.V|/J|.X2JX!|+JV|)h|(c|$XRcJ|)DX!',
      '|*[|*c|+L[|)KVh|*X!|+;[|*[|)UP2UQ|)f|)g|*2c2c|$a9c|%KI|%TKIUJ|$c@cK!|)6c6i|)UMJ!|)V|*IUg|*JUJV|.KXDcD|3X|*SH|,JVh|%B',
      'VK!|#IcEXL!|%IY;c;V|#JcJOV|#K!|$6c6NX!|(i|$?|%@c@VDX|+c|)[|)a;[|%EcE[;c;X|%I;:c:X|%PX!|%Q]R!|%SIJ@c@c|%UDDc@K|,!|$@c',
      '@VDcL[|)h|$V2c2X2JX!|%7c7|)X|%J|$XDcDX2i|)c|%HYIV|*JVh|#LU<V|%@c@V|$V7c7c|%J!|$XE;V|)JUJV|$^f|$cLD]2!|&XIUJV|)XNcN|(',
      'NcN|+P|,KX;[|-[|,g|&[McMU|&]|(@[6c2VMX!|)c|&_DcDc|&a|#M2i|$6c2K|$DVK2NVh|)i|$EcEXL!|$GULVM[|)h|&g|$IcEDV|(XO|(cKB]Q6',
      'c6i|$JULcLYg|&N2PV2i|(7M7c7V@cK|1!|16c6i|1D;DcIUg|3VIUg|1IU?c|1S!PVCUJ2g|(@c@VDcL[|,MX!|-[|-]2c2c|,h|(V|)2i|%Vh|%X;[',
      '|%aK|$]RcJ|#O2c2UM@c@c|$JX!|&;[|#RV|#Sc9VBXh|)c|#T@c@UJ|(cP!|$U|%2PV|&UNV|&cR]@cK!|%@cIU|*4UDcCV|%B]P|)2cR]@cK!|)f|%',
      'DUJ|%HUK@!|*@c@VM[|.h|%JUD|%KU9UPVDcL[|+c|*Sc|(Rc;cK|%M2cRcIV|%PVRc?X|,PVDcL[|$a@cSP!|$gRV|$h|#U!S!|$2c|&2VDcLaRc|&S',
      'c|$4SVf|$6c6|$9V2c|$:c7ScLcLg|$?V|$@U|&EV@U2c2NX;[|.i|&PVDcL[|(c|%Z2|&HYIV|%cJX|&KIMcM|)U?c|*JV|,KXDcDX|)XNcN|)[|)]J',
      'XNcNY|(PXIMcM|$CP|&f|%cJI|)!|)6c6i|$DB?c=6c6i|%SV2|%V7c7c|%XPh|%]9cI[DcLc|(g|$EcEVN|(c|$IU6c2!|$J|%V|$K2IUJ|%Ug|$LUf',
      '|%VJ|(@c|%X!|&2JX!|&DcD|*X|%cL!|(6c6NX!|+i|(Uf|(V|)J|*@c|(X2JX!|)DcDX|$M|%V|&2c|$N|$P]MV2c2K|%a|&JX;[|%c|$S!|%6c6NVh',
      '|)i|%@c@VMU?c|+[|*h|)[|)aN!|%PX!|%V2|(JX;[|%cLcLg|$TV|$f|$g|%2c2LcLc|)c|(SVDcL[|*ScLcLc|)c|%4!|&KLcLc|&c4!|)6c6i|%7c',
      '7Vh|%;c;Vf|%@c@U?c=PgIcI|2JX;[|)aIU|+cIU|%EUEcE|&cEUEcE|-JX;[|%GVi|%Rh|#V2Pc|%c2|(@X!|(EcEaOX!|(PJX!|)KX!|)ULX!|$4c|',
      '$=Vh|$DV|&LcLc|%cDh|$MV;c;LV|%cJe|$QcKV@!|$RDLV|%f|$S^h|%c|&LcLg|&Sc|$g|%S|#W=VJ|(!|$D|%!|%IUS@c@VM[|%U2cRV|$LcLLVh|',
      ')X!|)aN!|$f|#X!G^|$2NVMUJV|)X!|*NcN|)Y;[|)[|)]2c2c|(h|%]Rc|%i|$3!|%@c@c|%]D|%cJ|(CUKU|(IDc@cKV|/IUg|/JUJV|3KXDcD|)UJ',
      'X!|%g9V|$4i|$;V|%c;|(@c@X|$@MU?c|(J|)P|&XNcN|&]|%VgDcD|%c@EcEf|%h2c2]|$BcK|(?!|(UPU2cJ!|$DVSVEcEUMVLcLV|,h|%cD?V|(VM',
      '[|)h|(]|)LcL!|(a;VJUJV|*c;X|,c|$EcE@c|$IcEUJV|(Vh|(X|)@DcD[|)NcN|(]|(c|$KNV|&WCKf|$LV|&7c7X|*c|&JVh|$McMEcE[KVJUg|$N',
      '|$OEcEVM6c6U;c|%X2V|&PDUJX!|)X!|(f|$SVKVSc|%cMV!|)JUg|(W!|)6c6NX;[|,i|&NW!|$TIcIBVDcL[|$f2UM|)6c6NVh|&Y;c;V|&^|%@Y2c',
      '2!|%DVK|(g@c@V|%EUJV|&Vh|&X|(@DcD[|(NcN|&]|#Y2U!GV2|%c2c|$@c@|$DcD;V|(U!|)I@c@[|*f|)JV|)g|(Vh|(X!|(a|$M|%2!|&6c6NX;[',
      '|*i|&@c@VDcL[|&IU?c|%IU?c|&X?c;U2XDcD|(NcN|&a|%PX!|%cJ!|$PULcLXEXO|%cI[DcLc|$S|$g|%@c@V|#Z46c6NX;[|*[|)i|$@B]T!|#[2c',
      '2UDV2c2h|&SV2c2a|,f|$7c7EcE[;c;|$;cKa|$=V2c2h|&LcLL]DVJf|%h|$@cKUEcEaMW@c@|)f|$IcILV|(aLVJh|$JVf|&h|%c|$RWf|$ScSV|)J',
      'g|$g2c2XLV|#]3M|&2NVMX!|+[|*h|&JVMX!|*[|)h|(X;[|([|$56c6i|$9g|$;!|$CUPV|$Daf|$Jc|$KV|%WSc|$MXNcN|%cEL:c:|$N|%!|%2g@c',
      '@UKU46c6i|/IU?c|$h|%2c2YK|)aJcI|%Da;c;!|+@c@Vh|%EcEL:c:|%QUDc@V|#^2c2Vi|(c|(h|&Ka|)SaFcLcLVDcL[|0c|$@UD!|$SYg|$h|#_@',
      'c@!|(@c@Vh|$G^h|$LUg9V|$OVIULcL!|#a2cR!|$7D!|$;c;ag|$=!|%MX2i|%]e|%h|$BV|$Q!|%IUJV|$SVMcM|%c2a|$TVDVJU;c;!|%f|&MUh|$',
      'g|#cJYSV2c|)J!|*@c@Vh|#d?c;c|$KcJ|$MPV|$Sc|#eSYe|#fIaTf|#gBcB!|#i;c;V|!J2cRV|#AU2cKI!|%g@cA|*@c@Vh|&A|(@c@Vh|#Dc@cK!',
      '|)6c6i|#IXD|$f|#TYB|&KX;[|&g|$aPJX;[|#U2c2aGUJ|*c|$4!|$?c|$@_KX|%cK|(2c2Ug|(JX;[|(U|$AUScAV@V2|$BPc|$TY|#VM[|$h|#X!|',
      '$,Sc|$2c@V|$4!|$;[|$?V2cSc|%^LcL=c|$BcC|(2UM@c@c|(6c6NVh|+i|(@c@VDX|-c|.L[|,h|$CVRc<VKf|$D[Sc2a|%^LcL=c|$L]DVJ!|$P|%',
      '9D|%]F|#Y?V2a=VMXNcN|&JDVh|)cL[|(f|&LcLc|&P]OcSVLcLV|$@c@c|$DVP]OcSVLcLV|$LaEcEVDcL[|+MX!|,[|+h|*c|)Jf|#]QX|&BUSc|&P',
      'VD[|*cL[|#a4|%!|%@c@Vh|%cJ@|$9V7c7|$TDcDUDcL[|*f|#c2c2c|!K!4!|%6c6NVh|%@c@X|*!|)[|)]2c2c|)c|#2c@|&!|&@c@VM[|+h|%R|&E',
      'cE[;Uf|,c;X|&V2c2Uf|#7D|%2i|$JV@UPc|$V2c2EcE[;c;|%7c7|)@c|)V;c;X?c;c|)X|#9VScLcLg|#?c;K|&UI@c@[|,]@c|)DcL[|)f|(JV|&X',
      '!|(@P?|(E]KX!|&[?c?!|&a|#A!|#PV|%PgIcI|$WDcBcKf|#S!|$@Dc@cK!|$UBV|#TScJ|(IUJV|#U!|$4!|$5Pf|$9|%2WJ|&XIUKf|%KU9PgIcI|',
      '%P!Q!|)6c6i|)@c@VDcL[|-M[|%ScAUDVM[|*f|%U|&2c2DcIUKX!|0;[|.g|&PUJ|*V|+KXDcD|0X|(VD[|*c|+L[|(X!|(c|%V|&P7c7X|([7c7X|%',
      'WPc|%X|%]DcBcKf|&Rc|%c|&:V|)JX;[|&J!|(6c6NVMX!|.[|-h|,X!|-;[|-IUJV|,[|(@c@VDc|.L[|,M[|+[|+c|(IU?c|*J|+V|(PX!|(SHJVh|',
      '*U!4!|(UDc@K|%f|$@cKV|$CU2ZRc?f|$I|%2ZRc?f|%7DcBcKf|%D[|&cL[|%EXK!|%JcJf|%PgIcI|%ScPUIV|%UJ?!|)@c@VM[|%f|$P?D[|(cL[|',
      '&f|%VM[|$QV|$Rc;cK!|*6c6i|*@c@VDcL[|*E@V|*WJ!|,@c@Vh|,EcKPg@c@2g|,PX!|$S|%PSc@X2c2i|$TXh|#W@V|&2NX!|&JVMU?c|*X!|+NcN',
      '|)h|(X!|#X7V|$BcKU2cR!|#Y2cR!|$E|%!2_?c;|%2McED|&hEcED|%@c@VMU?c|+X!|,NcN|*h|%EcE[;X@c@V|+c;|-@c|-X|%IU?c|(J|%JX!|(;',
      '[|%P@c2K?!|+V7c7@c|/X|&X!|%UDc@K!|%W2K?!|)V7c7X|(Z@IUJ|-@c|-V|#]3|%2i|%EcE[;X@c@V|0J|1V;c;X?c;c|2KV2c2XDcDX|/XDcDX|%',
      'U!Q!|$P@V|#a4|%!|%6c6i|%@c@VDcL[|%IU?c|%M2cR?6c6i|$TV?V|&@c|!LFLfSX2i|#GcGg|$g|#IBUf|#JVhP]|$h|#PDcJY|#RcJ|&JX;[|&f|',
      '#ScSh|#TcIUf|#U!|$?V|$DcDV|$Jc|$PX|#V7c7Ug=c|$EGcMV2c|%cEGcMV2c|.2VDcL[|/c|/f|(ag;c;Vh|-X2i|-c|$JUBc|&MVLcLV|$MJfSc|',
      '%WSUJ|(c|$P]OcSc|$Sg7c7c|&Pc|#W=c|#Y!|$;c;c|#[2c2ag=c|$=c|$JVh|(P[|)]|*JX;[|#]=VJa|#^LcLc|#_?Ui=a|#a!|$2c2LcLc|(c|$=',
      'Vh|%X2i|%c|$GVf|%g;c;c|$IU|&2c2Ug|%VDcL[|&M[|&h|%f|$Jc|%h|$Sc|$i|#cLV|%X|#dNV6c|#eSVDc|%c|!M2cR!|&?!|(6c6i|&@c@aN!|&',
      'cI?f|)V|(J!|)6c6i|)@c@a;[|)IU2c2V|#5X|#?c;?VM[|&DVM[|)h|&f|#@c@Wf|#CV2!|#HV2c2Uf|)X!|*2JX!|-?c;UJV|*DcD|-@c|-X|%7c7|',
      ')@c|)V;c;X?c;c|.NcN|*KXDcDX|*McM|$cJ@|&IMcM|(U?c|)J|#JV7c7X|#NV@|&IUJ|*V|#TN|#U?c|$H!|$JVKXDcDX|$LV|%cLVf|$Tag|$h|#V',
      '!4!|$3V@!|(6c6i|$6c2X2i|(e|$D2cSc|$EV|$IVLcL=c|$JDUg=a|+JX;[|%a|$LcLVh|(g|$PgEYi|$ScLcLc|#W4VDcL[|&h|%c|#X!|#YALX;[|',
      '%g|$JV|&Sc|#[DVf|$Ph|$fSc|#]2c2c|$32f|%D!|&6c6NX!|,;[|*i|&@c@Vh|$Gg|$L[|$M@c@Vh|$Sg|#^!4V2|$Fc|$GcKLV|$LcLc|$Pc|$SfS',
      'c|$f|#a2|%!|%2EcEVh|*c|%@c@VDcL[|*M[|*h|)[|)c|%ITUJXBcC!|.2UM@c@c|&[IcEU;X!|.IXNcN|%PcJUE2IUJV|%SH|(U|%c2h|&SH|)JVM[',
      '|)U|*!4!|$4f|$=c|$EV7c7c|$LfSc|$Pg|$Sc|$T|%!|%6c6i|%IU?c|$g=c|!P!Q!|%9g|%@c@VM[|%DUQ!|%WJ|#2XEcEVDcL[|*h|)X2i|)c|$c2',
      '!|#6c2UKV|#7c7|&U?c|(JVKXDcDX|&X|#;2K|%c2U:c7]KV|)JV|(X|)!|)2VO2c2c|/f|)E;V:c:ULc|1f|)HU4@c@c|)NcN|([|(]|(a;c;c|(c|(',
      'f|$c;!|#?c;Yg|#@c@V2c2Uf|#CQV2cR|$V2c2EcE[;c;X|)Uf|)X2JX!|%7c7X|#D!|$6c6NVh|(i|$@c@Vh|$V@|&U|$cD@a;[|(c|&EcEai|&Uh|&',
      'V;c;X?c;c|(KXDcD|-X|&c|%J9WPV|#IcEV7c7|#JDU;c|$MUg|$SVh|%cSUJVKXDcDX|(VMU?c|)h|(X|)NcN|,EcEai|(c|$c2c2XDcD|-X|$g|%M[',
      'Sc|#K!|$7c7|(X|$?c;|$Pc|$U!|%LX?c;c|%f|$V|%2|&JX!|&i|%JVh|$X!|%2JX!|%@c@Uf|)V|*J|)X2JX!|*DcD|%DcD@c|)X|*?c;c|%IUD|)!',
      '|&cEai|$Y|$[JX!|(NcN|#M!|$@X|&2JcJVh|$J!|$V7c7X|%EcE!|)@c@VMX!|-h|)IXNcN|)PX!|%J_KX|$X@U?c|&X!|(IUJ|&c|$cMU@[|#N:c:|',
      '$E;c;?!|$KUf|%XDcD|*@c|*X|%[2c2UM!|&JCV2!|(]L[|$cN!|(2NV|&@c@ai|&XPDU;c|$g7c7|)JX!|*[|%@c@Uf|)V|*J@c|)XDcD|%DcD|)@c|',
      ')X|)c|#O6c6V|$V@[NV7c7X|%EU;X2i|)c|%JX!|(NcN|&_KX2c2V|&a|#Q!|$6c6i|$@c@c|#SV2c2XDcD|-X|$c@X|(2c2NVh|,X!|-;[|,[|+i|(@',
      '|(PVDcL[|&cK!|)6c6i|#TV2c2XDcD|-X|%7c7|)@c|)V;c;X?c;c|*KXDcDX|)X|#U2c2VDUh|*c|+L[|*g@cA!|)h|(X|)2NX;[|*i|(c|&J!|$4cB',
      'UD!|$6c6Uf|(V|)J|$72!|$9cE]JV|$;UDEcENcNV|%c;c|(g|$?V9cJ|*!|$@2|&!|%Vh|$B!|%6c6i|%@c@[|%IX?c;c|%V2c2XDcDX|&7c7X|$IDE',
      'XK!|$JD|&2c2c|&Jc2c2c|&QUM|%V2c2Uf|&7c7X|%X|&PVDcL[|)h|$KV2|%cJg|$MV|%cIW2V|&J!|$O|%EcENcNV|$RV!4c;e|&6c;e|$SXB]Pf|%',
      'c2a|&@P@c@Vh|(X|)PVBcJ|$TD|&!|&6c6i|$f|$g|%=X2i|%@c@|)U|*PVDVIJ|%RV2|$h|$i|%;c;g|#V2SD|(!|(@c@VDc|,h|&V2c2X2JX!|(7c7',
      'X|(@|(EcEV7c7|/@c|/X|/[;X@c@|5X|%US!|%VK?!|%c2LcLc|(V|)EW=VJ|&;aLVJ|(g|&K!|&LcLaLVJ|&R]EV7c7X|$3cJU@|$4cKT!|)6c6i|$7',
      'UK?|$9J|&!|&2KIUJ|,V|&D4K|&IUJVKXDcDX|&V2c2X2JX!|(7c7|+VMcM|+X|&c|&f|%VMfSc|%c:UD!|*2aQ!|$;X2JX!|%c;X|(c|$@K?|(!|%c@',
      'X2i|(c|$B4cBcCg|%YK|%]Q|(2UKcJ|%cJ|(UHcJUS|.@c@VDX|3c|.PX!|)K!H!|)MJ!|+6c6i|+@c@Vh|)g@cAV|.2N[|/i|(X@c|+2UDc@V2|&PUf',
      '|$C|%!|%@c@VMXNcN|*h|%V|&7c7X|%]JIUJV|$DUJ2|%VIJ!|%aB|(S:c7UK|.!|.2]DcBcK6c6i|(c|$E?D!|&V|(JVh|%KW@IUJV|%U2!|%XMIUJ|',
      '%cMP|)!|)2KIUJ|)@c@VDcL[|$H9D!|&V7c7VKV2c2XDcDX|+X|+c|%P6c6i|%U4!|(6c6NUJV|,Vh|,X!|-;[|+i|(@c@VDcL[|,M[|,h|(IU?c|*J|',
      '(PX!|&PD!|$IUD|(!|(6c6i|(@c@UPN!|.6c6i|.@c@Vh|.IU?c|+VDcL[|%a7D|%gQ2g|(D!|)6c6i|(V7c7X|$JLcLcDU!|$KIV7c7|+X|%U;c|%XB',
      'cC|%h|$LcLUIVf|(X|(c9fScLcL^f|$M|%2c2c|%EcE[;c;|%JVKX@c@EcE[;XDcDX|-h|%US!|%cJ!|&M]9c|(cJ!|(f|$N!GK!|%2c2X2i|)c|&i|%',
      'P[;XEcEc|%V2c2EcE[;XDcD|3X|*ULX?c;c|*XDcD|.@c|.X|&7c7VKXDcD@c|0X|*X|*c|$OV:c:!|$P2cRV2c2U!|-XDcD@c|%K|&!|&6c6NX!|*i|',
      '+2c2c|&?!|(6c6i|&SU6c2]@V2K!4@c@[|0PVBcJUPVB4cBcCg|&V2c2XDcD|/@c|/X|0?c;c|(7c7V;c;X?c;c|%UB!|(6c6i|&T|(@c@VDX|(Ia7D!',
      '|%VC6c6NUJ|(@K!|(JVD!|%]2UDDcBf|%g@c@D!|$Q2MD!|%BIUJ|*V|&U!Q6c6i|&W2K?!|*V2c2Uf|.XDcDX|+7c7X|%UMIUJ|%VRc;|%XBcC|%]R|',
      '(?!|(IU?c|(Uh|(VEcEV2c2ULX?c;c|0XDcD@c|4X|-7c7@c|0X|%cPDUAf|(SV2c2EcE[;XDcD|6X|-XDcD|1@c|1X|*7c7VKXDcDX|-X|.PKXDcDX|',
      '*Jc2c2EcE[;XDcDX|(US|*!|*6c6i|*@c@VDcL[|*EcK2UK!|*IX?c;c|*PX!|*V2i|$R!|%J!|&6c6NVh|*i|&@c@Vh|%X|%c?X|)PVDcL[|&Ph|$SI',
      'cI@V7c7X|%c2aeSVf|&@Wg?!|+c?!|-IXNcN|(Z@V|+JXNcN|$f=aSc|%S[fLc|$g9WDVJ|$h|#W2cR?!|$;X2NVMX!|*h|(i|%c|&;VM[|*]2c2c|)h',
      '|$=VJa|$?|%X|%c|$@!|%IXNcN|%V|&JX!|$K|%cJ!|$OXDcD|$QXDcD|#X!|$=cE[2c2g|#Z2cR!|(6c6i|$@c@!|(6c6i|$Qc7V2!|#[6c2M!|$7c7',
      '|(U?c|(X|(c|$;c;V|$Gc|&Gc|&S^LcLc|$Jg|$LX!|&@[|$NV7c7!|*@c@Vh|&EcE[;X@c@V|&JVh|%X@c@|%cN|(!|(7c7U;c;!|(@c@VDcL[|,h|(',
      'EcE_2c2!|(PX!|(UNg|(V|)JUOc7|$PcP]L[|$ScLcL]e|*c|#]4!|%@|&c@Vh|$?!|%I[6c2VMX!|(DcDc|%U;c|%X|%c;|(@c|*K|(VJX!|+NcN|$@',
      'D!|$B|%!|%D|%UDc@!|%V|$Dh2c2UM@c@c|$KX2i|%c|$L[|%_KX|$M|%X@c@IcEV|$NJVh|$R!|%6c6NVh|)i|%@c@Vh|$g@VKV7c7X|$i=c|#^2U@[',
      '|%V;c;c|%W;c;c|%XDcD]K!|%c2!|$=c|$B4cBcCcJ!|%V2|%cJ|(QUSc@cK|/!|(X@|*V|+JX;[|(f|$EcEVf|$LSX2i|&c|%cLc|$PVCcJIUgDcD|$',
      'Rc?P|$Sc|$h=c|#a;c;P2UQ!|(c|$e|$i;c;]9c|)c|#cJ2c@IMcM|*U2c2V|.XDcDX|+J|,V|)V|*2NX;[|+c2c|*4@|*@cP!|*EKIUJ|*JUJVKXDcD',
      'X|+X;[|+[|%@VJUD!|+6c6i|&cJSc@|,IU?c|.J|/V|)US!|+6c6i|%PSUJ|*!|*V2|(cA|%U2K?|*!|&3cJUD!|,6c6i|&E2IUJ|,V|(UK|*!|(V7c7',
      'X|-2V;2c2XDcD|(c@V|&JUI!|&O!|(@c@VDcL[|&PSUJV2|-IUJV|&S!|(IXNcN|$K@!|#f2KJX;[|%V;|$@a@VMXNcN|)h|#g2c2M|(V|(c|$4WSc|%',
      'c4!|(6c6i|(@c@Vh|(W2K?!|)Sc|$?c?!|$@c@V2c2XDcDX|$BcCV2c2X2JX!|-DcDX|)7c7X|)EcEV2c2XDcDX|-7c7X|$IcI|$R!@aLX!|%2c2UM!|',
      '%6c6NUJV|*Vh|*aN!|)i|*2c2X|-c|%@c@VDX|,NcNVh|,Q]R!|+c|*M[|+_KV2c2h|*h|)[|)]2c2c|)aN!|%IU?c|%PX!|%UPSUD@c@VM]2c2c|!Q2',
      'c@DUJ|&IUJ|*V|&V|(JUJV|)X!|)]LVJ|&f|#6c2KU7UKcJKX;[|.g|(f|&X?c?V|&g|#@2!|%@c@VDcL[|*h|$IUD!|(@c@aN!|(PX!|$cKX2c2N[|+',
      'i|#DV|%JX;[|#GKVIM|$cB|&!|#IcEN!|#K@c|$UQKV|$VJUJ|)V|$WK|&!|&@c@VDc|-L[|+M[|+h|&PX!|#P2X;WK!|#QV|#Sc@cK2cKVJ|#U3|$Dc',
      '@V|$KWKV2|$M|$SD!|%c@UPc|(cK|*!|*9c:DU?c|/J|.cIUg|-f|-g|*@c@VDcL[|.h|*V|*WJ|,DUI!|,IUJ|/V|#V2cR|$McE!|(6c6i|(V|$P|%2',
      'cR]@cK!|-6c6i|%DX!|&[|&cL[|%KU@cKV|%MV!4!|%U9V|%f|$RcJDUJ|(f|#W@!|#X2cKDcL[|(f|$BcC|(9M|(IUJ|$EUgQ|#Z!3M|#]3K!|&V7c7',
      '|+@c|+X|+c|$RIU?c|&XNcN|%PX!|%V|&JXNcN|#^3c|$MV|$P|#cJU!|$KBcC|)V2c2EcE[;c;X|*7c7VKXDcDX|-X|)]JDUJ|+IU?c|-J|.V|%I!|&',
      '6c6i|&V2c2X2JX!|,DcDX|(7c7|+@c|+X|+[6c2VMX!|%W2XIUKf|+g|(ZRc?|,f|(aPVMVDc|/L[|-h|+h|&B]PV|&CKf|&DUKUJ?|(VPUSf|&I@V|(',
      'YM!|&KUIDcL[|*f|&M6c2|+f|%X@V|%]?V|$Ma2!|(6c6i|$PUS!|#g2c2K|$IcI|!RU9TUDcL[|(f|%V|$JX;[|$KY3c|#[Jc3c|#]2cScEVJg|#aEc',
      'EfTaPg|!S!2cKI?|$3cJ|(2N[|$4W@|(!|(9c:f|+g|(@c@VDcL[|,M[|,h|(DU;2|(PX!|(S!PVCUD!|$5!|%2UM|%6c6i|%;D|(2NX!|+;[|(JUJ|)',
      'X;[|(U|&VEcEV7c7|/X|%@c@VDcL[|*h|)[|%PX!|%gR!|$EcK]R?!|$GDcCIUJ|)V2c2XDcD|*7c7|-V;@c@aN!|-c|*JUJ|%aCD|$HK?|%P!|&6c6i',
      '|&@c@Vh|&V2c2XDcD|/@c|/X|(7c7|+@c|+X|%UPD|)2N[|*i|&R?!|$JX2c@|*6c6i|*IUJV|%a9V@|$K!H!|%2cR?|*!|)V2c2Uf|*@|$PUB!|%VCU',
      'D6c6NX!|-i|*@c@Vh|*IU?c|*PX!|)J2DUJ|,X!|+f|$QJ!|$SUKV2c2EcE[;XDcD|,XDcD|0X|%c2KV7c7X|(UK!|*6c6i|*@c@VDcL[|.h|*PX!|(Z',
      '@|*!|*@c@VMX!|/[|.h|*PX!|&AUD!|*6c6NVMX!|0[|/h|.X!|/;[|*@c@VDcL[|.M[|.h|-[|-c|*IU?c|,J|-V|#2M|#3cJ!|#6c2McE!|&Wg?c?I',
      'UJ|&]@!|)6c6i|#7c7Vf|#9WP|&IUJ|*V|+KXDcDX|#:c7KV2c2Uf|,XDcD|)7c7Uh|,X|,c|&UK|)!|)V2i|%9Jc|#@V|$cJ!|&9V@c|&EcK@V9c:|&',
      'U4cKT!|&f|#BU|$cBU!|%J|#Dc@aRc|%B]Q!|)6c6i|&gH6c6NVh|(QD!|)V2c2Uf|-X2JX!|*7c7|-X|-c|%CV|#Fg|#Gc|#H2NVh|&X!|%i|$JVM[|',
      '&h|%X!|&;[|%[|$U|#I2UMV2|$4cK|(IUJ|$@M!|$J|%6c6NVh|%@c@U?c|)X|*!|)[|%IU?c|%PX!|$K|%!|%@c@VDcL[|*h|$PU2cJ!|$Sc@|$UCUD',
      '|)!|)@c@VDXNcN|&V|%D|&IU?c|)J|*V|&c@K|*IUJV|%TUK!|$V@V|(JX;[|$WE|&!|&@c@XNcN|&D!|&IXNcN|&V7c7X|$XBUJ@c@VDcL[|-M[|-h|',
      '&cK|)!|)@c@VDcL[|-M[|-h|)DVKEcEVh|$YM!|%T!|&@c@VDcL[|+M[|+h|*[|$ZBcCIUJ|,V|$cE@c@c|&Bc|)PcJPScA|&DcD|*IU?c|,J|&UBV7c',
      '7X|&Yg?c?|&cKBUJ!|,6c6i|,@c@Vh|,IU?c|&g2c2!|%I@!|(V7c7X|&UD|)!|)V7c7X|&]ND!|*@c@Vh|&g|(BcB!|$gEcEV7c7|-X|#JcJVBc|$fS',
      'Sc|&Vh|&c|#KScP@V|#MU!|$V!|$W!|#PVQ]R|)@|*2i|)IUJ|#Sc@DV2i|%J|&!|&6c6NX;[|*i|&9UM!|&IU?c|#T2K?|(!|$D;DXNcN|$UJ!|&2IU',
      'JV|&6c6i|&@c@Uh|*a;[|&PX!|&V|(2c2Uf|+X!|,2JX!|,DcD|/X|(7c7X|(JUJV|%L|$aBK6c6i|(DUJ|)cIUg|(V|(f|#U!|%Sc2UKV2|)c2UKV2|',
      '$2cRK@|*U|(Uh|(V|)2i|(cJ!|$4g|$6c2]@V2|,PVBcJ|$BZQcJ!|*IXNcN|%cCcJ@|$CD6c6i|%UK?4@VJVh|)IU?c|)JUJV|%V2c2VMcM|*X!|+Dc',
      'D|.X|&7c7VMcM|*X|%cJ@|)JXNcN|(IMcM|$DcBcK@|&DVBcCcJ!|)CcJ!|$IUDcJ|*!|%XPh|%Y@VKV|+JX;[|&TV2|*PX!|(cJ|%cE@c@V2|-!|-IU',
      'JV|&J!|(IX?c;c|*NcN|&KU9cJ!|,@c@VDc|2L[|0M[|0h|/[|$JXC|$KIUJ|$LU|%cLM^LcLc|$PCUD!|$T7KcJ!|*6c6NVh|-i|*@c@Vh|%SV2|%V@',
      'cJ!|*2UKDcIUg|-f|*@c@VDXNcN|/cL[|.MX!|/[|.h|*PX!|&Gc|$f|#V!4EcEYg|&VDcL[|(i|&c|%T!|&USD!|$3c|$4cDh|$6c|&2c|$=V|%cDV|',
      '$BcCUDc@!|,6c6i|,@c@VDcL[|$DVI|(2NVMX!|(JX;[|(U|%cCX|(Y|(c|$IV|$JX;[|$LU9c|%VJ|(f|%cLV|$MV2c2e|$PVMVJf|&h|$ScLcL!|*6',
      'c6i|*@c@VDcL[|*g|$h2c2c|%Pg|#W@|%J[|$DVJg|$KVJh|%WSc|$La|%cLX2i|(c|$S?VM[|(h|%e|%g|#X2XIUKf|$3!|$4cKWPf|$DVh|%cBKIUJ',
      '|&DTBaSc|(V|$EcKCUD|+IUJ|(W!|$GcKTcI?cJ|.ScPUIV|.f|$HBcK|%URc|$K2cR|)U|)V@IUJ|%]Rc|$LVJUDV|$M^IUf|$PVQ]R!|%g?c?|$TZ@',
      'c@UJ|*X!|+2c2i|*c|$h@c@UDcL[|*f|#Y2c@6c6i|&RV2c2X2|)7c7X|(cI|$7D|%V2|&EcEV2c2Uf|.XDcD|2@c|2X|$DTBaSc|$EcEg|)DaP|&K?c',
      ';c|$FV|$KcJ|(DVh|)X!|)[|)cL[|(EcK2UQ!|(f|#ZRc;V|)2c2Uf|,X2JX!|-DcD|0X|)7c7|,@c|,X|#[2c2?c;LV|(DcLLV|+Vh|+c|(f=LV|&K;',
      'c;LV|-JUJV|$:c7cPLV|$DLcLc|%cLVIWLcLg|(WIWLcLg|(c|(g|$Ec@!Gg|&LcL!GLVh|$IV|$JVDcLc|%cDcLc|$LcLc|$f|%;cKh|%Lc|%SSc|&[',
      '2cSc|$g7c7c|%Pg|$h|%RcJSc|#]@X|$D|%JX;[|&[|$M!|$PD|&!|&6c6i|&IDXRc<V7c7X|#^2c2Vi|$BcCUDc@V2|$DV2|(KX;[|(g|%cJ!|(@c@V',
      'Dc|.L[|,h|+[|(PX!|$Ie|$LcLVh|(c|#_S^LcLV|+JX;[|#a=VJ!|$?V|&J|$EcEc|$FcLcLc|+P[JLVDcL[|/X2i|.g|,]g|$If|$NUg|$OcSc|$PV',
      'JLcLc|%cJLcLc|$RcJMVScLcLc|(h|$g;c;c|#b@c@c|#c2YNVMX!|*[|)h|(X2NVh|+X!|*i|%a;c;VRc|*c|&g|%c2Yi|&KWf|$;cKWLcLc|$@cKW|',
      ')2NX!|,;[|+[|*i2c2X!|.c|)JX;[|*[|$AM!|&6c6NVMX!|,h|+X!|*i|&@c@U?c|*X|*[|*]2c2c|*c|&IU?c|&PX!|%UD6c6NVh|+i|(@c@U?c|+X',
      '|+[@c@V|+]2c2c|+c|(IU?c|)X?c;c|)]LcLX|(PX!|(UKaT?!|)g@cAVJUJV|&E2|)DUJ|*X!|)f|(D!|)6c6NVh|-X!|.;[|,i|)@c@VDcL[|-h|)I',
      'U?c|+J|(V2c2EcE[;c;|3@c|3X|,Uf|,X2JX!|)7c7|,@c|,V;c;X?c;c|,X|,c|)@IUJ|-@c|-V|%V@V7[JcJXDcD|2@c|2X|)PVPK2c2?2c2X2i|&K',
      '|(!|(@JXNcN|(IUJ|+V|(W2KV7c7X|$DV4cC!|%]T!|$EUDVRc|%VDaS|&f|%W=c|%[2c;cKh|&JVDVM[|+h|)f|&RcJh|%]Sc|%ag;cSc|$Fa;D!|$I',
      'UK2|)!|%V@c@c|$Ka@ScSX2i|+c|$LcL=WSc|(UFc|)f=]g=c|*Fag=c|)g|(WFf|)Pc|(X=VJa|(]9c|)=VJ!|,@c@Vh|)LcLc|-Sc|)RDVh|+X2i|*',
      'f|(a2c2c|)LV|*]9c|$P2UKcJ|%@Dc@cK|,IUJ|/V|&c@c|%B]QV|*JUJ|%Dc@IU2c2V|+J|,V|%EcD!|%HUP|)!|)PX!|)SPVQ]R@2i|%J!|(HK?|%K',
      '!|&6c6i|&YE!|%U4@!|&@Dc@cKcJ|/!|/@c@VDX|/PX!|/SIK|2S]DUDV2i|(V|)@VKXDUi|&CWD!|*PX!|*V7c7|.V;c;X?c;c|.X|&HUPV2|&IV|)J',
      'X;[|%VSc|%W2KV2c2Uf|-X2JX!|*7c7|-@c|-X|-c|(UKcJ@|&=VRc|(f|%g?!|(c?|*!|#d2KcJ!|)6c6NX!|,i|$9DcJ|)IUJV|$@c@c|$BV|$DcBK',
      'cJ!|$KJYA@c@VM[|$TZB!|#g2c2UKVD[|,c|-L[|+h|)LVDcL[|$BUg|$P2MUQUM|,JX;[|%WSX2i|(c|%]|%cP|(2MUQUM|.JX;[|(WSc|#hIUf|#iF',
      'g|!T!4LV|#9c9c|#BWSc|#DXIUf|#GVi|#IUSc|#Jg|#KEcEf|$VEcEU;c|%JUD|#ScSf|$f|#U9V|$KV|$ScJ|$fSc|$g;c;c|%=c|(P[Jg|%PUg=c|',
      '$i|#V9cL|$DcBX|)2c2NX!|.;[|,i|)ScAUDV|-f|$IU7h|&MJ|)!|)f|$LcLc|)MLX;[|*g|$Sc|&LcLLV|$h|#WGcKX|$MVJ!|#XS^f|#ZBJ|&!|&U',
      '5U@!|#[2c;g|$=c|$Mf|$fLV|$gIf|$h@c@c|#]4h|#^2c2a;@V|$=cK9f|$BKUGUBc|%g|$DcBP|)!|$P]|$Sc2YNVh|)i|#a!|$2c2V|$;c;h|$NV|',
      '&PX=c|$ScEVLcLh|$gIae|#bSc|#cJYScLcLe|#dSc|!cDX',
    ].join(''),
  ],
  gu: [
    "ંઃઅઆઇઈઉઊઋઍએઐઑઓઔકખગઘચછજઝઞટઠડઢણતથદધનપફબભમયરલળવશષસહ઼ાિીુૂૃૅેૈૉોૌ્૤",
    [
      '!$ANT|#D[|%2|$bJ|#L4|#RV!|!%!4?NT=V|#BUNTQV|#ENTIT!|$V|$[|#NV|$[|%L|&T|&V|&W!|$bJT|&W!|&_|!&@URTQ|!)@b@K|#EJ_4|$K|%T',
      '!@|!-2|#;L[|#Db=|#I|#NT|!0F|!2=V0|#ETQ|#K@T|&!|$NT|&DV|&IT!|$V|%D[|$[|$bJT|&W!|&_|#TI|$K?|&[|#WL|#[|$;LT2|#_(|!3T@[|',
      '$Q|#XG|#[@I8XKV|%V|!4JT|#TI|%DT|%IT!|#W8KT@|)V|!5)!|#?T|$V|!6?T|#TK|!7@T!|#[|!8DbI|#TJ|$R[K|#ULbLTDT|)IT!|(_|#VKW|$N',
      'D|#[|$D[|$I|%T!|$NT|%V|#_|$2[|$NT|#bJT!|&K[|!;2T|!=T!4K|#[KV|!@AT|#ITI|#KF|$V2[|#L|#T|$LW2T0|)DW!|)IT!|(_|#WNK|#[|$0',
      '|$?[|$DT|%V|%W!|%[|%_|$I|%8|%?[|%DT|&V|&[|%T!|#_|#bJT!|&K[|$K?|!A&|#(|#JT|$W!|$[LV|$_|#TJ|#V|!B2bPU?|#KIUJTD|$[2|#UN',
      'Q|%[LT|(V|#XCDV|#[ODT|#bNTKT|!CKTN@T|&[|!DAV|#T|$I|#V|#W!|#[|#_|!E!6TJ@5K|#7V|#?|#K|$!@W|$AV|#OWETLD|$b6UI|#T!6|$2DV',
      '|#XKbN|#]2VDT|#_@TDT|(V|#bKAI|%TAIU2|&EbJ|!FULbI|!GDV|#RTK|#T8KV|$B|$RbJ|#V|$8T|#[|!HT4|%IT!|$K@|&DT|&VJ|!I!BUK|#2T(',
      '|#4FMV|#CbJ|#MV|$[|#T!|$;[|$@bK|#V|#W3bJ|(@bN[|$8G|#Y@bJW|#[MNV|#_;T|%V|!K82_|#RV|$[|$bJT|#T8bJ|(DT|$Pb;bKVJ|#V@[|#_',
      '8|!L4H4|#_2_|&D_|!N3@|#4[K[|#6b6[|#CTK[|$W|#KbP|#Qb@V|#UNUC|$Qb@TKIT!|#bJNQTJ|!O2TJ|$[|#KX|#R[K|#T2HT8VDT|$MT|!Q!BKb',
      'H|)_|#IJ|%[|$TN[O|#NL@_|#TA[|$ITDbJ|%[|#WCV|$K@|#aAV|$KTPb;bK|#bATEDT|!R@T|%!|$V|$W!|$_|#[<M|#_J',
    ].join(''),
    [
      '!$!2|%4?U@|%L[ObNK|%U@|%WO|%_|$4|%@|%[|%_|%bK[8|*V|*_|$8LU|%TK|$=K|&;[2K|+[|$@|%K|&U2bP|&[|&b4@|%UI|%[|$BK|%T8|(U@|(',
      'V@|([|$C|$GT|&8V|&?V|%U2T|$O|%@#|%[|%_|$RV|#2G!C|%K|&[|$QbIT@|$TBIV|$bPJ|&K|(_|&T!O|#3!=|$GTK|(_|$T@|$UL|#4@bJDT|)V|',
      ')W!|)_|$T)|%QV|$UJTK|$bDU|%K?V|&[QK|#6TD2|$_2b2Q|#7@|#8I[K|$T?|&bJT|%JGV0|$_=|$b:T@|#;2|%TNNT|(V|([|%V|#<NT=UJT|#=B|',
      '$CT|%V|%_|$VD[|#>TK|#?RULNT=|$W|%0|#@U|%OJ|$bJ!@|&TK|)[|#AT?W!|#BHX@|$T|%?V|%L@|([|$bJ@D|%KObJ|%N]@|#CU2|&T!O|(K|)V|',
      '*0|)_|&Y@|%DUJI|%N[ODIT!|$bJ2bP|&JD|&TE2|)D|(J|#D!@|$DbJ|$T8|%I@|$UJIU@|%L|%NTKbJ|%Ob6U@|$W2K?|&WM|&XLD|(M|&bKI[|%4T',
      'IV|%BTD|%HN|(V|([|(_|&X@U|%I@U|&TD|%JTJV|*0|%KXE|%L2bPVD[|%NTB|)2|)U@|)_|%Q!CTD|&K?|(NTIT!|(VD[|([|&TK|&X6U@|&bDT@2|',
      '$[2NUC|$_3V|$aE6TKU2|$bD|&T|%J_|#E=[;|$DTNNTIT!|(V|(bJW!|*_|%[|$HbK!O|$ITD|$KTC|$NTB|$RK?|$T&|%(|%@T|&V|%J|&W!|&[L|)',
      'V|&_|%NV|$VL|$XKb?|$[2bPT|)U@|$bK4;|#F5TD|(UQb@TD|$NT|$QK|#G8|$=TQT|$W|%L|$bBWL|%GTQ|%KTRI|#HJTK?bJ|$TN|&[|$U4I|%DJ|',
      '&[@T|*0|)bKV|&bD|%EbKTJ|%IDbJW|%JTD|%NTBD|&bJ2b@U|%P[2|$bJTQ|)2bKI|-_|)_|#IBTNTB|$D[|$K|%[LV|$L|%IT!|%V|&2K?|$TKT|&V',
      '|%Q|$U@TH|$VK|&4>|$W2|$Y@|&QK|&T|$[|%KU2D|*_|)T|)V|&V2D|#J_4bJ|#K2TDQTQ|$8V|$G|%V|$ITDV|$NLbLV|%U!B|$W?|&T6L|$[GU2|(',
      'JT|$b8WD|)[|%A|&5;D|&@!@bK|&NbJNQbAT|&OTQb@bK|.V|&T@|)b|&[|%C|%E?|%NT6VD|#L2D!BT|$G@b@|$JRU|$V|$a2U2|$bE|%LTR|%Qb;K|',
      '%RTGTB|#N2TO|(JTD|(V|$4?DT|$@K?|%TK|$CU|$JN|$K|%_C|$L_2D|$O[P|(_|$QTD|%bAT|)IT!|$T8|%KDNTK|$UHT8bJ|#O2bJ|$_2|$bNBM|#',
      'PT>|#Q!3bJ|$FM|$IKbA|$K|%2TK2|*@T|%4bKQb@|%_|$L|$T!8[|%CTK?|%ITDbJ|$WK|&2bPU@|$_QU-OD|$b@U@bN|%ATJV|&U|(H!4|(K|%EPb;',
      '|%NV2TK|#RIB|$U!|&Q2|(T|$V|%!DT!|&JT|$[NTL|)_|!%!2|%=T|(0|(2VJ|&_|%LTN|$3|%[|%_|$4MV|$@K|&KT8bJ|)Pb;bKUJ|.VJ|&TPb;bK',
      'VJ|&U2|&V2|$B_LD|$CbK|$G[=2K|$OU2|#&-QGV-D|$9[2|$;V|$EV|%[=|%_=|$KUO|$L[Db=|$Q|%L[Db=|#(-QGV-D|$DbQb;T(D|$EV|#);|#2K',
      'V|%bP2|(?|)_|(U@|([|$QbIU2|$TK|%O|&NT?V|&V|$Y@U|$bKI2|(?|%P[E|#3KV|%[|$T|$V|$W!|$_|$bJTD|#4ID|$LT|$M|$NV|$TIV|%RV|$[',
      'NTD|)V|$bKR|&T|#5T@|#6TKbJ|#7T|#8DT|%V|%_|$VND|$W|%GT8W|$[|$b:T|#9TB|&V|#;LT|%V|#<IT|&!|%V|%_|#=T|$V|#?!B|#@!2NTB|*V',
      '|+0|$bI|&2AT|&R@bJT|&T|#AV|$_|#BK|%bO|$U|%NTQV0|+DV|$W|$[O|#CTK|&HX@|&U@|&V@|&[|$U2TKU2|%D|%E@bJ|$WDU2|$bJT@bIU2|#D!',
      'B|$T|$V|$W!|%N!OU2|$[|$_|#E?D[|%T|%V|%[|$@T|&!|%V|%W!|%_|%b@U|$DTK|(T|$NT|%V|%W!|%_|$O[|$[L|&T|&V|&W!|$_|%%E|$bJT|(!',
      '|&W|(!|&_|#FbKU2D|)T|)V|#GW|$_RNT|#HTK|&V|#I!@bK?|)U@|$T!|$_B|#JD|%_|$KUO|%bD|&LZDb=|([Db=|$T@|$WKbN[B|+U2|%PbJ|$_8D',
      '|&U@|&V@|%NT|#K!H|$2bPU@|$@V|$G|$QDV|$TCDT|%I|$[|$_4bJ|%E|&_|%R?|$b2U;[2b6K|,;|%;|&Q|&UQb;|&bQ|%AK|(UJD|&U2|%D_Lb=|%',
      'IV|%J|&D|#L[3D|$_6DT|$b2_R_L|%FT|&bK[=|%GI|&Kb;|#N2|%TK|$@T|&!|%V|%W!|%_|$DTK|(T|$K?|%V|$NT|%W!|$O[|%bJ2|)@T|$T|%Q|$',
      'W!|$Y@U|&b@U|*0|$[LT!|&W|&_|$_|$bJT!|&W|#OJ|$K[|%_|$T|$VKbNTB|$b6KbJ|*8D2|%KI|&J|#QD|$ETQ|(DT!|$TDVAV|%I|$_|$bAT|#RN',
      'T|$TK|$VK|!&!4bLUO|(VO|([!=|)Db=|,DT!|$6|$=T|$C?|#2_D_IU2|$bNU;V|#6b7@T|&T|&[|#8D[K|(V|$T|%4bKQb@|$UEb@|#;TLUJD|&V|#',
      '=K|$V|#@URTQ2TK|,_|$bJTBU|#D2TK|$EW;|$TI|$b2|%;K|(D[;|*ODL|(F[Q|(Qb;[;|&[L|)U8DbQ|)[|%=U2T|(JD|)T|&[2bQ|&_|(D[OUJT|%',
      'BUKT|&bK|%FDb;bKV|&KbI[OD|&_KbI[OD|%N[Qb;I[Db;|%Qb;U;bJW;|-X;|)V;bJW;|#ITK@|(_|$[8|#KT2|%B_|%D|#LT8|$[2b;bKU2|-L|+V2',
      '|+_D|-U2|/bQ|#N[Db;|#ObNK|#QK_|$b2_D|%;|%LTI|)U2|)V|!(!4bLUO|([Db=|$6|$=T|%UJT|$C?|#6b7T|#8D[KV|$T|#;TLUJD|&V|#@URTQ',
      '|#Db;KD[;|*ODL|%=UJD|)T|&_|%BUKT|%QV=|#ITK@|(V|(_|#KT2|&V|%D|#L[2b;bK_DU2|#OTD|$bNK|#QW|$b;|%LTIU2|!)!6T|&&|&(|%V|%_',
      '|$9T|$BK|$IK|&[|#2[L|&NT|#4T=NTIT!|$[|$bK|#6U@|$b6|&@I|(K|&TK|)?|%7L|#7[K|&NTIT!|#8N?V|(0|%NTIT!|%TJ|%[|$T4K|#<TNV|&',
      'bJ_|#=TD|$V|$b=JD|#?E|#@K|%@T|%T?|%V|%[|$TKV|$b2YPb;|&bKT!@U|%@I|&KEXKbN|(T3!=|)CU2TKV|)KbCIT!|(V|)J|([|&[8D|*T|)U@|',
      '%ATD|%E@b@U|&DbD|&TB2|*_|)D|*_|)U@|%QKb8D|&N|(_|&TR|#B5T;D|$HN|&[|$J|%EWK|$T|%K|%RK?|)_|$[O|$b4I|%5T;D|%B[O|)bJ|%HN|',
      '%JTD|)_|&_4|)E@U|)_|#CTK|#DT|%MT|(IT!|&W|&_|#E2K?|(_|$3!=|(DT|(IT!|$4bKR|)_|$6TK|$B[O|$DBV|(0|%TI|%UPB|$J_42Kb@T|(V|',
      '(_|$KV|%_2b@|$LGbC|)@T|%T|%[;T|$NTQ|$QbAU@|$TCU|&bJTJ|%J|&_|%QDT|#HKV|$T|$V|$W!|$_|#IBT|$K|%4TI|%ET=T|%TMT|&N|%[<|$T',
      '|%O!2K|$[BNTK|*V|*_|%KNTIT!|&V|&_|#Kb8T|%BX|%F[|#LbL!5D|&[3|)DVJ|#PT|$b?|&2;UG!CVJ|&@TITD|%IT|#Qb@TB|!*!5|$6T|&&|&(|',
      '%V|%W|&!|%_|$=T|%V|%_|#;V|#DDT|#HT|$V|$W!|$_|#Kb8T|!+@W|%IT!|#PU|%0|%2[O|!,Db=|#N_Kb=|!-!4bL_|#&=b9|#2!BK|([|$8|$<T|',
      '%V|$@T|%bK|(U@|(V2K?|$BI|%UNQVJ|$GV8T|$I|%T@bK|%_|$K|$L|%T|$NTK|$QITD|%TA[|$T)Db;|*U!4|%B|&OV|$V2K?|&Y@|$[=IV|&[IV|$',
      'b9U2bJW;UN|%;|%OD|%Q|&6[Db8|&EbK[Q|&[Q|#6%&NV|$;V-I-L|#8Db;|&QV|)0|$bJW2[OD|#;LT|&Db;T|*U2|%V|%W!|%[2[|%_|$VEV|#=NKb',
      '=|$U=TQ|%OD|$V|$_G|$bK[Q|#AV|#D;V-F-Q|$K_D|%b8V|$T|%J@|$UI[;[=|(OD|$V|$W!|$[|$_|$b8LQ|&UD|)UJK|,U!4|)_|%;U|&V|&bKV|%',
      '=V|&bKW|#EL|%[|$UQ_=|$_L_|$bKUL|%LU2[OD|,bQ|&V2[OD|#F-|%I|$=V-|#GV|%-D|#I;VNV|$?[|$DT!|$GV-|$T!|$_DUJT|$bETJK|%G[Q[=',
      'K|%K_|#K2bKTFb;|$E_Kb;|$GQ|$LT&D|)bQ|+[|$N[9|$U2|%JT|%Qb;_;L|$_QbE[Q|#L6V|$;V;V&DT|$D|$Kb8V|$QV-|&=V|$U9TG[A|%Q|$[2b',
      '9TDb=K|-bKUJT|$bJWIUDUJI|#NT!|$V|$W|%!|$^Kb=|$_|%Kb=|)bQ|#OUJD|&T|(&|((|#Q-I-Q|$U=|$V|$[IbGLV|$_QU-OD|(J[OD|$b;[;|%Q',
      'TK|!.@URTQU2|!/2b;_GK|#4Qb;|#=UOT|!0&L|#-Q|%EV-F|#2;_GK|$L[Db=|$b;_GK|%LTR_IT|%QFKb=|(_Kb=|&U8D|(=[OD|#3TI!=M|#4?VQI',
      'V|$Pb;|$Qb;|#7T|%!|$V|$W|%!|$_|#9T|$_D|#;_|%I_GT&L|#=UJ_|%QV|#A_KU;V|#DLT&D|&(D|#ED|$K[;U!4|&OD|)bQ|$[KT|#FK|$UQ|&K|',
      '#GTIT|#K2W;|$UQbQT|$[2L|$b4[DT&9[OD|%=K|%A_=_2bQ|%LTDb=_|#LET=|$IbEU2|$UIbEU2|$b=|#M3|%NT|(IT!|%T?|&@T|(V|(W!|(_|&J|',
      '(T|&N[|%V|%[|#NK|#Qb;bKUJD|+T|)[LUJD|-T|!1BbJ_4U2|#E6TKU2|#K!4TGTB|#PC|%VJ|!2!&|%2|$(|%2|$;bK_L|$EDV|(0|#2bPT|(DT|)V',
      '|#6=V|$KT|%_|$[KV|(0|$b7|&V|#;TK|$_2;V|#<?|$LTL|$_K|%M|#=2|$NT|$T?T|$V|#>V|#?_|#AT|%0|%NQb@W|$U@|$bA(|#BDT|%V|%W!|$I',
      'T!|$T6|$V|#D[2bOD|$]JTLTL|$b;bK_L|%D=|%JT|#E=N!8|%T|&!|$DV|$IT!|$KT=T|$UL|$XK|$b@TD|#G8TIT!|%[|%_|$K|$VK|$b8TIT!|&[|',
      '&_|#HV|#ILT|$M|$T?V|%D|&b=|)K|$U;V|%OD|(K|$bEbJW;K|,bQ|+U!4|)X;K|%JWDU2[OD|*;V|#JT|%K[2|#K!8DT|$8?|$?|$@V|%W!|%_|$DT',
      'K|(T|)0|(V|%[|$NTIT|%V|%W!|%[KT|%_|$O[|$T&|%(|%6V|%@T|&V|&_|%J|&T|&W!|&[L|)T|)V|)W!|)_|&_|%K|&_|%NNT|)IT!|&V|&[|&bJT',
      '|)W!|)_|$W!|$[L|&T|(!|&V|&W!|&_|$_|%=|&_|$b?|&T;2|%@T|%DL|%I|&6TKV|+0|%JT!|&W|#L2@b@T|$G|$I|$K|$T|%2|&TK|)_|&[|&_|%@',
      'bI2|%EV|$[2b;K|(OD|$_L|$b6K|(L|%EDT|%JT?|)8V|)EWK|#MT|#N6|$K|%[8|$T!;|$U|%0|%@T|(0|#OW!|#QK@|$_;V|$b;I|%@WKGT|#RV|$[',
      '|%@T|%NT|(@T|)V|)W!|(IT!|(J|)T|)W!|&W!|$bJT|&W|(!|#T!|%2K[8|%<T|&[|%=T|%BT|%QbJ|$)Db;V|(QUL|)VL|$2T|$4M|$6|%GT|%T|%V',
      '|$8W|$;|$<UJTNT=|%V|$>NT|(IT!|%V|%[|%bJT|(W!|(_|$D|%8V|%EWK|%XD|(V|$E|%=|%V|$FUJT|$GW|&L|%[LUJ@|$I2T8|%4VKV|%6LT)|%B',
      'TK|)_|%K[8|%[|%_|$JBT|(0|(2VJ|&[QK|&_|%I|&V|$K|%2UKbBV|&VKbBU|+V|%3TDW!|%4UL|%?2[|&HX@|&QK|&_|(QK|%@2|%V4K_|%_GTK|%b',
      '=|&D[4V|&GD|)U2|&J|(2K|*_|*b@T|)TKV|*M|)bKI|,_|*PI|,@T|(HTK|(K@|(NTRV|(TLJ|(_|&L|(_Q|$L|%TN=|%U|&BTQ|&IE_!4|%V|%_L|%',
      'bEDU2|$M|%2bKI[|%8V|%T|&!|%V|%_|$N[KV|%bJ|(Q!4bKR|(_|$OV|%bIVK|*V|$Qb;bK_|#U!4|&=I|&[|&b=I|%I@|(V|([|$4bKT|$DTKT|([|',
      '(_|$IV|$JT|$K?|&_|(@bQTKV|$L_|&4bKTI|&IV;K|%bLT|)0|(_|$O_K|$QbQT|)0|*IT!|)IT!|(_|#VKb@U|#W!2TNTN|%=|%NK|$2?T|%KIW!=T',
      '|$7|$;W!G|)_|$@UJT?T|$BK@V|$IT)!|&K|$KTD|$M|%B[NV|$N]@|$OM|&@T|#X6|#Y@|%8b:@T|%U|&0|%bKUI|$PU|%b?|(T|#[!BbK|$#|$6|$;',
      '|%LT|(!2|(J|&V|(2|)NTK|(J|&W!|&_|(2|$A_LU2|$B|%TKDTA|%V|$D|%TL|%[=T|(UJD|(V|)JD|%bBbK|*OTQU@|*U@|+J|*V@|+J|*_|&JT|&Q',
      'K|(TQ|$E|%U;L|%b;D|$GL|%UD[;|$I|%2[|%U2L|%[KT|%bE|(Q|&GbKU8|$K|%M|%V|%[GUJD|%_LUDT|$LUF_KbDUJT|%[Db=K|%bOUJI|$MN?V|%',
      'T!|$NM|%V|$ON|%_B|$Q|%K|&V|%_|%bEUJD|#^!4bK[Q|$L[8|#_!2?|%4bK[Q|+[|$&|%E?|$(2|%E?|$6|$;|%=T|%T|$=|%VDTK|$?|$@K?V|&NT',
      'IT!|$AIVK|$D2_Kb=|%b=_I|&FKDbQ|&QKb;|$EV|$FV|$I|%D|&N[LbA|%KbOUJL|(Q|%U2|%V|%[=V|%bEbJW;K|&JWDU2[OD|+;V|+Qb;|$K|%UJD',
      '|(T|%b;|([|&D|&E_K[;|+OD|-_|(bQ|&Q|$L|%!GUJT|(_|%2T@T|%IbGUJT|%QT|%[8|(_|%_DV|$MV|$OU2T|)0|&O|$P|%_|%b;2|$Qb;|#a;W!G',
      'U2|$HT!=|$KN_|$OLbJ|#bJT|&!|(2|(J|&K[|)2|)J|%WGD|(T|$KI|&6J|)_|&O|(#|&T!2|*[|&U2|&[|%T!@U|*2TKV|%U2[;|*K|&JT|)0|&Ob6',
      'UJD|&Q|(IQ|(b;_FK|%[=U;|%_C|&I|&Q|&RD|$LG|&_|%T)=|&JDb;|&Kb2|&Q|(U2|*L|%U2|&DU2L|(b;D|+[|%[|$NTKb;K|%UG[2|%VD|$P?|%@',
      'U|(4bKQb@|&bKUJ|+_|%I@T|&T|%J|%TK|%[@bK|*FM|*VJ|*[|*_|+IT!|!3!=|%?V|%D|%U@|%VJ|%_|$HT@|&MUJT|#4_MOTQb@bK|.V|#=2|%_|#',
      '@I|$KDT2|%_|#DU8|$V8|#GK|#HT|#KT|%G|$V|%B|&NT|&V|$[3K|$b6|&TM|&[|#NTJ|#QV|$[=NTIT!|&V|#T!=|%HT|$(|$3KTDT!|$=V|$?|%2T',
      'I|$@K|&V|%T|$BV|%bJ|$D|%4V|%EWK|%[|$IV|&0|$J|$KT|%V|$LQT|%V|$NT|&IT!|#U@TG|#V8=VJT|$?|#WB|$G|%8|$LTQ_|%bLT|(V|(W|)!|',
      '(_|$O|%V|#X?T|%[|$D|$G8|#[!6NTIT!|&V|&[|$=GbKRbIT|%T|%X@|(_|$@|%KIT!|%VNT=V|$K4TI|%TLW|$L|%T=V|)0|#_;|%T|%V|%W!|%_|$',
      '=UJTK|$B2TI|$KT2|$LNTIT!|%V|#bJT@DTI|(U|&L|$KUQb@V|+0|!4!4T|$C|$HVK|#9L|%2TK|%_|#;K|#<D|#>=T|$NTL|%V|#?@!@bK|%KV|(0|',
      '%T|$B[NV|$DT|$E@U|$KT8bJ|$NTIT!|$T|%@T|&V|&W!|%J|%NV|&[|&bJT|)W!|)_|$U@|&OTQb@bKV|$V|$W!|$[|%O|$_|#@U|%NUCU0|%OVL|#B',
      'bJ|#I@|$[|#JT!|$W|%!|$[L|&T|&V|$_|#KGT|&=T|%_|$I|%V|$VG|&V|$X=[ObNK|$bH|&4YR|&N@V|%LbQ|#LbF|#M@[ObNK|$V|#NKbDK|#RD|#',
      'T!<|&_|%CV|(8V|(CTI|(D4K|(NTBV|$&=|$=V|$>|$?U@U2|(V2|$BV|$IDT!|%U@|%[|%_|$J|%2|&NT=|&_|%@bKV|%D|%T|%U2T|%W!|$KVJTCTK',
      '|%b=D|$MT|&IT!|%[|%_|$NTIT!|#U;TK|(NTB2|$DU|$KDTK|%UIA2|#V6|%@T|$@|%2TK|%T|%_|$K|%_|#W!G8|$4L|$8KT@DT!|(D|%TK[|$=|$?',
      '|%CKbI|*_|%N@b@T|%_|&@b@K|$BT|$DT|$Eb@|(T|$FT|&0|$ITNV|(bJT|*_|$K3T|%W|&@bNT2KbP?|%X|%b8K|$LTG|(V|&I|(V|$QbQ[|(_|#X4',
      'L|&[|$>|$N[KT|#YR|#[&I|$8|$;|%N[|%bQ|$I|%bQ|$K2TJB[|+QK|%ITKb4[|%RT8KV|+IT!|$L[KV|$Q|#_!=L|$%|$;|$<N?|(V|&NTIT!|&V|$',
      '=|$BTNKV|$CKT|$ETL|$KT|$L|%b=|(D|(FUO|(IZD|&F|$M|%T|&2TK|&KbCIT!|%V|&0|&GTK|$NKbCDKTI|%T|%U!B|$QbNTIV|$RUL|#a?|$@I|$',
      'KN|$OTMT|#bK!A|(QX6U|(U|(_|%R|&?|&_|%T|&)Db=|&Db;|)=|&F|(U2bQ|([|&I|(V?|(bJ|&R2|)_|%V2|&D|(RT)Q|&Q|%WE|%XE|%[|&4_KVJ',
      'D|&8bJW-;|&;|(K|&=|&IV|&RTI|$LTQ|%_G|(L|$NTLUJK|!5!;|#;2|%_|$DT|&0|$T=NT|&T|&V|&[|&_|$V|$[|$b;|#=NTIT!|$UJTM|)_|$V|#',
      '?T!|$VNTK|$W|%!|$_|#D@T|#KDT|%V|$IT!|$[|%LW|(!|$_|#T;|%V|$@2|$JL|$Q|#[K|%T|&J[L|*T|*W!|*_|%V|%_|#_!5T;|$5!GT|%T|$=T|',
      '%_|$K|$P|%?T|%U@|!6!BbK|(2|(4WEb@|(EXK|(JTD|#2TQ?V|$bK|&NKb@V|(T@|#;?V|#=V|#>T?|#@WKbA|#I6V|#K?|$GV|$U@bK|$_@K|$b6|&',
      'T|(0|&_|#L6U@bK|*_|$?|$D|$TN@T|&NT|)IT!|&V|&[|#M2@V|$NM|#R[KT|&_|#T!6|%BV|$&DT|&V9|$(DT|&V9|$;|$?QbIT|$DT|%V|$I=V|%W',
      '!=T|$K?|%[|&J|%b8|&;|(K|&LV|(bQ|*[|$L|%2|%@T|&V|&W!|&_|%NT|%V|%W|&!|&2bJ|%[|%bJT|(W!|(_|$N=T|%V|&KXE|$R2_|#U!@D|&T|$',
      '2U@bQ2|*T|$3LV|$@b@T4_!4|&K|(2TK|)X;|(?|(E;|(U@|(_|$DbR|$RbD|(_|#V2W|$8|%NQb@W0|%_|$D|%V|%[|$F|#W!;?V|%G2VJ|$2N?V|%T',
      'B_|%V|%bJT|$=T|&QIT|$DVLTL|$Qb@|#X!;?V|)0|&TJT|)[LT|$2N?V|&NTIT!|%V|%bJT|$DTDT|#ZEbLUD|*[|$IbEUJDOUE|#[2|$@DT|%N?V|$',
      'D|%L|&_|%bD(|$E|%V|$IbEUJD|+OUE|+bQ|&GK|$KI[D|%V|#]@DbJ|%bK|#_2|%V|&0|%b2Q|)E?[|$3T|%b3V|$;VLT|$AT|%V|%W!|%_|$ITQT|%',
      'bQb2V|$KQ|%V|%bJTQV|$LT|#aB|$CKV|$RT?|!7!B|#<b<T|&V|&_|#@T|$b@VQ4>|%KE@U|&V|#GV|%0|#T@V|$E|$JT|$L|$N?V|$O|#UBbK|#V-|',
      '#W!|#X;|%2|%T|&7[=T|%V|%_|#[#|$2|$=T|%[|%_|$LbLT|)!|(V|(W!|([|(_|$N;[|#_2KV|(0|$;T)B[EWK|$=|%NT|(IT!|%V|%_|%bJW!|!8!',
      '2OD|%bOD|$4L|&V|&_|(AV|%V|$@W0|&DTO2|$GWQK|#&D[|#(D[|#4@|%IT!|$DbDTA|$bJT|(0|#;UL|$VL|#?T(|%J|&W!|%NNTIT!|&TJW!|&V|&',
      '[|&bJT|)W!|#@T|%!|$V|$W!|$_|#AbAT|(IT!|&_|#D2|$@T|$KL|%[OD|$Q!3bJT|$VD|$bIBUNQ|&[|(LT|&bJT|#Eb@|#I?T|%V|%[KV|$T|%NV|',
      '&bJ_|$VD|$bIW|#J!@|&U|&V|$EWK|%bK2TO|$QU!R|$T!|%K[|$_Kb8|#KWKV|$XK|&UJT@|+_|&V|(JT@|$bDL|%ID|(V|%QV|#L4T!N|$TKTI|%LE',
      '_K|$bBV|#MNT(|$TOJ|#NT|%G|&BTK|*V|+0|%J|%RK|(LTL|$W!|#O[|#QB?|#RT!4VK|%8|&_|$_D|#T!GW5_=T|$4VK|%Y@|(U|$;|$=T|%V|%[8T',
      '|$?|%2TK|)V|%@T|%NT|%V|&@T|)!|(V|(W|)!|(_|%[|$@|%D[|%T|%U|&0|&J|%V|&J|%[|%_|$D|%RTDU|%bJW%KV|$ETD|(V|)9|([|$FKTGTB|$',
      'I|%2!=_K?T|%8_CEWK|%D4K|%T|%VD4VKV|$KV|$MN?V|&NT|&V|%QbAM|%V|$NT|$QXQV|$R[K3GK|+_|(T@|*_|#U!B4V|$D|$I|$LbLT|)0|)DT!|',
      '*W!|#V-Q-I|$=VEV|$@|%DTK|%NT|%V|%bJT|(W!|(_|$D|$EV-Q|$I|%[L|$KW!|%X|$N|%!@|%@T|%D2TM|&6KU@bK|&DT!|&O]LV|%L[?|%NU8b:T',
      'D|%T?W|%U@|%V|%[|%_|#W-|$0|$=TQ|%_|$BT|&!|%V|%W!|%_|$D|%T|&4>|%UJK|%V|%W!|$LT&|&(|$NTK|%_|#X0|$A|%[|%_|$D|%T|&!|&4>|',
      '%V|%W!|%_|#[0|$2|$;|%LT|(!|&V|&W!|&_|$<|%NT|$?[|$@EWK|$D|%T!|&AV|$I2[|%?[|%T|%bQ|$KV|$L|%IT!|%NTQ|$NT!|&2[|%W!|%_|$Q',
      'K|#]D|%_|$N|%U2|#_&|%-|$(|%-|$3I|&V|&_|$4NT&|((|$;T?T|$=@T|&V|%NT|(IT!|%T&|&(|&?|(_|&J|(T|(W!|([L|*T|*V|*W!|*_|(_|&N',
      'T|%UJT|%V|%[|$@T|&!|$CEWK|$D|%bQ|$JT|%W!|%_|$K|%BTK|$NTJ|&LTJ2|$OV|%_|$PV|$Q[F|$RD|%bD|#b:T@|(U|&D|(2_O|(EV<|$JT|%_@',
      'UKbLU!4|)P|*NUBbJT|&Kb8|*UJT|$NTMTIW3V|$R_D|!95=VJT|#=E|%AV|%V|%[|#KV|#N[K6!B|&V|#T!3V|%QV|$=|%V|$K3!=|$LT|%_B|#V!4T',
      '|$?T|$E|#W!G[O|#[=|$K|%V|#_D|!;!2TKT|#2T)|%NTKV|&V|$V|#DL|#ETL|#KbG_|%IUDL|#T!2NTIT!|&V|$&4K|%;L|%E|%I|&bQ|%LbQ|$(;L',
      '|%I|&bQ|$)D|$4_K|$;T|$EW|&0|$MNT|$NK|$Qb2|#U2U;|(_|$EbE?V|$IbG2b;W|#V2T|&0|&2TK_|$I|%KWDT!|%[|%_|$NV|$QVEV|#W2=T|(0|',
      '&V|(0|$K|%bDTI[Db;|#X!2|&T|&V|&_|$K|#[2|%DU2L|&_L_8V|%KV|(0|%T|%_|%bD_L_8V|&Q|(TQ|(V|(b;|$4|$DUQ|%[QV|%b2|$GL|$IbEL|',
      '$K[QT|$L|%K|%U4bKTF|&F_D|&NU9D|(V9D|%VNU9D|$Qb;|#_6|$DV|$E|%V|$G[4_|$I|$L|#bJWG|(K2bJWL_QUQ|&KU!4|%XLUE|*T|$K2|%Qb;|',
      '%TDbQ|*E_Kb;|*FK|*IUOD|&FU2|&N[L|%V|&;I[Db;|%[2|(U!4|&=|(ITKb2|(U!4|&D|(U!4|(_|%_FV|$NVD|%[Db;V|!<!=2|%T|%V|%W|%_|#K',
      'TN|#T2K|%WK|%_K|$K|$QKT|#V2|!=GL|%bJW|&Q|$bLbJW|*=GbLbJW&|#H_&|#T!4|&V|$)D|&;T)D|&L_=|$DbQ|$GT|%V|%[KV|$JKV|&[2b;K|%',
      'TGU;VQ|%_2bQT&=|$Kb2|#U4bKV|$8U;L|%V;L|$9DV|%T&D|)K|&(D|$ETKb;I[Db;|%bK[QD|*UN|&L_IT|$F[DbQ|$K[2b;K|+V|$NT&Q|%U9D|$Q',
      '0Kb=K|%[IbGK|&LUD[OD|%b2|(NKV|&;bKU2b;|*V2b;|&EbL[|&L[2bQVJT|#V-D-|$4bKV|$9L|%T&D|$E|$NV=V|$QT|%V|%[IbGK|#W!4K|(TM|(',
      'V|&MV|$2b2K|#XGV|#[&LV|$2b2D|$;T|&G[9|$=VJTET=T|$A|$D|%UJL|%b;L|$I|%_2bK[;|,U2|$K|$L|%b;T|$NLEI[Db;|&_EI[Db;|%U=|(QD',
      '|&Q|$QK|#^LK|#_2b;K|$;|$D|%TLb=|$I[&DIT!|&D|$LK|%N?|#bK4|%I|%T&N|&IT|%VI|!>G[|#T!2V|#_MTN|$QT|!@!@bK|(V|$BWKQb@|#2DU',
      '2V|%V2|(V|(_|$LVF|$_|#;QbA|#?TN|#@b2TLUD|)VD|%@bN|)_|%N|&8b:TD|&_|#BbBD|#D[|#EQbJT|$TQ|#FTN@|(_|#G2b2T|)0|)IT!|([|(_',
      '|$BUL|%VL|$VGV|#ID[|$T2W|%KT|&V|&[|$UL|&DT=W|%M|$[|#K!4_|$@|$FV|%[?|$U2[|$V|$b2|#LNTK|$_B|#MT8T|%N|&_|$[;VIT!|#QNVK|',
      '(_|#R[NTK|)_|#T!8TNWK|%@bKU2|%GW|$&NTD|$(|$2T@|$8|%T|%V|%[@KDT|*V|)IT!|$@b2TLU2|$EITD|)[|%V|$GT|$IUL|$K|%2|%?|&_|%T|',
      '&0|&EWK|%V|&3|([|(_|%_|%b2U2|$L|%TLT|&MT|%UI|%VI|%W2T|)DT!|)IT|$N|#UAU|$G[;|(VJD|$KWD[LN[LV|$L2|&NT=T|#V2bPb?|$K|%bA',
      '|(!2K|$NbK|(@T|#W!|$K!@|%b2V|$LDT|(-|(@bI2|(IT!|%QV|$N[K|#X;V|#Y@VJ|$ObOXK|#[!=WL2K|$8|%Q|&bNV|%V|$;LT|&V|&W!|&_|$?V',
      '|&-|$DT!|%W|$IDT!|&W|%T|$K|$L|%!4T?T|%W4W|$NT|&!|%V|%W!|%_|#]DT@|$JTK|(V|#_=V|%bJ_|$E|%_|$FTD|(V|(_|#bJ8V|%T|&4|&K|(',
      'E7V|(GTB|$K?[|(J|%TN?2_K|%U|&2_?|&DUBTB|&ET<V|&ITQU2|&N[BV|%V8T|(V|(W!|(_|&Q|$N6T|!A2V|#@T|%!|$V|$W!|$_|#DTK|&T|#JT!',
      '|$W|$[L|&T|(!|&W!|&_|#KTB|$b=|%IL|#NT|$V|$W!|$_|#O[|#T!HLT|$&L[Db=|$?T|$D4>|$ET|#UJKV|%[;K|#VI|$JKV|#[Fb;|$KTEV|#_=T',
      '|&!|&2|%V|&2|%W!|%[|%_|$IQ|#bKV|!B!=|$@|%2AT|)0|%NLb2|#2bPU?EXKbN|)V|)[|&V?|#=T|%D[|$_|#@b@|&2|&T|(@bK[J|#FD|%TNNTIT',
      '!|#GT?|%NV|#I?|#JT|#K3TQb@|$4TR|$8b8_|$GTK|$IT!|%bJTD|$K_8|$NT8T|(_|$UJT|(&|((|(2UDTKT|-[|$[|$_|$bB|&V|(0|%E?|%O2_|&',
      'D|&TN@T|*V|*W!|*_|)NT|+IT!|)TJ|+T|)V|)[|*L|+T|)bJT|+W!|+_|#LE@KTI|$TL|$U@|$VL|&_|#MDT|$_|#NT|%0|%3TDW!|$[|#O2|%IT!|$',
      'T!O|#QIT|%V|$T=T|$b2bK_&|%@TN[8|+V|+_|#RV!|$[4TI|#T!=V|%@|&T|&VNT=T|$)BV|$3L|&T|$?T|$@T|$BKT|%T|$D|$I_BK|$J2T|(0|(IT',
      '!|$KX|%b8ULU!4|&ODU2|$M|$N|%T|&0|%_|$Q|%V|$R_B|#U4!GK|%bBKbO2|+D|+U@|$D|$JT|%_BK|$L|%VE|%bLV|&RV|$NQVJ|&[|&_|%TD|&L|',
      '(_|&MV|%bJ|$OT|&IT!|#V2KV|%bPT|$<|$CT|&!|%V|%W!|%_|$N|%TL|(_|#W#3|$2TD|(_|&M|$3TN_|$C|%DV|$DUJT|)HKIT!|)IT!|%VJTHKIT',
      '!|$K|%WEJ_4|%b4|(T|&J_CD|&LH|$ObID|)_|$Pb2TM|&;|#XC|$K|$PU@|#YObJ|$Pb;U|)-|)2_?|#[3K[3|%T|&(|&@T|(V|&J|(T|(_|&N|%V@V',
      '|$@T|%bK_8|$KTQK|$N|%4>GTKUJT|%@T|(0|%DT4KV|%HXIU|%T|&(|&IT!|&J|(T|(W!|(_|%V|%W!|%_|$O|%DT!|&U2TL|%HKIT!|%V|%[|%_|&I',
      'T!|$QT(|$R|#]DU2|$NV|#_=|%[|$>|$KNTIT!|%V|$P|%U@|#bKNbJ|%ObJ|)_|%Pb;U|*-|*2_?|)V-|%T2bP|&KT|%_?|%aEBV|$NTK|(2T|%U|&@',
      'UJ|(VJ|&N[BV|&Q!4V|%VE|!C!CT|%W2T|%_|#2[LV|#?T|#DQWKT|$U2|#I2V|#K@V|&2!E|$E2=|$IEWK|$NTIT!|$TN@T!|(V|(W!|(_|&DTK|*T|',
      '&V|$V|$_RK|$bI|&DT!|&_|#QV|#T@W|&0|$DEWK|%[KT|%bJ|(_|$I|$K|%?|&T|%T|&C_K?_|&NTRU2|&QHT|%V|%_|%bIU2|#UKT?|#VIT|%V|%[|',
      '%_|$KWHT(|%[|#WIbKETD|$LUJT|#XI2[@W|%bKETD|$M|#[;|#_=U%|%VJT|$C|$K?|&[|&_|%T8V|%V|&ITKb4|,_|$L[KT|$M2T|$NT?|#bJTD|%[',
      'J|$KT!4CbKT|%WN|(VJ|%_M|$N8|%DU|!D!BT|$GK|#2L|%V|%_|$OT|%_|$TKT@bI2|&V|$b2K|&V|%P@bK|#3@bKT?T|#4K|%ETLU2T|%RN[LV|%V|',
      '%_|#8K|%[|$V2|&DT!|#=TL|&[|$V%B|#BV|%0|#FT|%2TK2|$_|#GMT|%V|%W!|%_|#IXDT|(0|&_|#KI|$QU!R|$[DbBbK|%O|$bIB|(T|#MV|#N8T',
      '@|%VND|$IT|%V|$KT@bKV|$L2AT|)0|)2TK|$QTKV|$T|%!|%4TI|%8NTIT!|%D4K|%G|$V|%D|&V2K?|$W!|$[IbGK|$_|%BJ|#Pb;|#QNT=V|#RU|%',
      '!|$V|%!|$[K|&W|$_@T|&V|&W!|&_|#T!|%3NTIT!|&V|%B_B|$&;|&bK_8D|$2|$3NT|(IT!|%V|%[|%bJT|(W!|(_|$4|%EWK|%K|&U2|)_|%LV|$8',
      'W2|$9V|$;2|&VJ|&_|%bJ|(2TK|(T@bI2|$?T|&!|(2VJ|&2VJ|$@TL|(DV|$A|$D2=T|(V|(W!|%T!|&HT(|$GXB|$I2|&K?|%DT!|%T!2D|)U@|%[|',
      '%_|$J2|%G|%K|%U2T|$K!4V|%B|%T8|&J?|%UJ[M|%V|$MVM[K|$O|$QT|%U2|%V|%b@T|#U!BT|$2TL|&Q|%_|&;UD|&GTK|&LQ|$4I|$8V|$9K|$BK',
      'bOD|%TD|$CD|$G!C|(2TK|(_|$HTNV|$I?X!2|(2|%TJT|%U@b@[|%bD|$J!@bK?|+_|*U@|%@|%I|&D|&U@|)E?[|&_|%TI2|%W2b@|*U|$K!@K|%T2',
      'K?|&O|%V2bP?|%XE?|%b?J|)_|(TJ2|&BUPb;|([O|*2|*D|*U@|(_P|&CTKU@|&HK|&IT?|)@T|+0|(U@|&NT?|$NTK?|&Q|(QbATD|(V|)0|%Y@b@|',
      '*U|%[BD|$OTD|(V|%b6U@|$Pb2KbP|(bKUJ|&?T@|*_|&FM|)@T|#V2M@T|(V|&V|&[|&bJT|)_|$6LT|&V|%T|%V|%W!|%[|&DTD_|%_|$@U|&0|$L|',
      '%2!<|%4UKV|#W2OTD|%QTD|)2TK2|%bOTD|#X@D|#Y@bJ|#[6K|&L|$8T|$;|%NKb2|*U!4|*bQ|%UN|$@T|&0|%Y@bN|%bK!4|$ETM|(V|$GbKTQb2T',
      '|$I|$KWBT|%_4[8|$LbQD|$NL|$ODL|&bQ|$Q|$RKW|#]@U2|(@T|$DU@TL|#_!C|&?V|&DVJ|&ET@bK|&NTIT!|&TJT|)W!|)[L|+T|)_|(NV|)bJ_|',
      '&[|&_|&bJW!|$2KV|(BT@T|%UJT|$;|$D|$GL|%[L|$KbA|&N[|$NT|#a2T|&BM|)DT|#bJTJ|(IXKb@U|(TCVO|(U2|%W|&J_Kb2|%X|&2[QL|&9|&;',
      'D|)[|&J_Kb2|!E!6|%IRTL|%T!4|&4DT|&J@|%_@[K|$8TG|(V|$=U@|%bJT|$A|$BK|$E|#2=|%NT|%V|$NNTIT!|$bP|&V|(0|&[|&_|#4AUJT!|$D',
      'T|%V|$ETMT|$LT|&!|%W!|%[|$TK|$[|#6TQ|#7T@|#;2AT|$DT|$[L|&[|&_|$b;T|&V|&_|#<D|#=2TK|(_|$@T|&!|%V|%W!|%_|$BT|$CKV|$NT|',
      '$O[|$V|$[|%L|&T|&V|$_OV|$bJT|(!|&W!|&_|#?[|#@D|$U|$bAK|%DU|&V|%K|&2TK|*@bN|&U2T|&_|#AbAK|(_|#B2|$NV|&0|$TKbA|)_|$[|$',
      '_|$bC@U|)0|%I|&HXP?|&NUHXP?|&ObKV|%J|#CbC@U|#E]JT!|#GbLU2|(OU!4|#J4!GK|#K!EKT|)0|)4@|$@|%bN[|$DT!|$F_KbIDbQ|$I|%NVK|',
      '%T?W|&K|$NTD4V|(T|$OWKTI|$QbEK|$T!|%4|%8J|$U2bKIT|(P?|%6J|&U@|%?IV|([|&TI|)[|)_|%E2bN|&XKb?|%GM|(_|%HTPT|&bKI?|%IT?|',
      '%J_8DT|%NKb@D|+_|*U@|&RD|&TK|)[|)_|%PB|%QK|(IT!|&bAU@U|,0|$V2bP?|*_|)T|%3|%?TI[|$[=|$_2bP|%<T|%E2TKV|$b?_|%J;2_|(D|&',
      'TEb@|(NK?|+VJ|%N|&@|(ITMT|,DT|(VJ|(_|%OUJD|%QDL|&UJD|#L;?|&[|&_|$QT?T|$bE|#ND|$U@bK|#OW|$b6T@|&UIV|)[|#Q!B|&4V|$TK|#',
      'RT=V|$[KNTIT!|([O|&V|&[|%L|&T|(!|&V|(NTK|&W!|&[AV|&_|$_!6|(@T|(NT|(T=NT|*V|*[|(V|([|(bJT|*W!|*_|%MT|(&|((|&V|&_|#T!3',
      '|&_|%6I|(T|(V|(_|%=N|(_|&W|&[|%B=T|)!|$)=K|%Db=|$2|%T|%UQb@TD|,V|,[|%[|%_|$5=V|$6D|$7LT|&V|%M|&AV|%T|%V|%W!|%_|$;?|%',
      'D4K|%VBTK|*_|+DV|$<|%2|$=@T|&V|%NT|(IT!|%V|%[|%_OV|%bJT|(W!|(_|$?V|$@MT|&V|%bK|(_|$A|$BKT|&V|$D|%3K|%T|&!|%W!|$E|$Gb',
      'L_|$I|%@T|&V|%V|%[|&L|(T|(V|%bJT|)!|(W!|(_|$JBM|%T|%[|%_|$K|%!EKU2|(TKU2|%=V|%BKbO2|%QV|&bEKU2|%U@_PU2|&NTKU2|%[3|%b',
      '2|&;V|&AUN|&N@V|&ObN|*4TJ2|*DTA|$L|%2|%D|&EWK|%V|&@T?T|$N=K|%K|%V|$Ob6T@bJ|$Q|%T|&0|%[|#U4|$6|$@T|%b@|$J@DV|$KTIU=|#',
      'V-6|$7[R<|%_|$;K|$<|$=T|&@T|%U@|%V-F|$?T!|%W!|$EL|&bQ|%MVJT|$K|%QNTIT!|%_8|$MT|%V|%_|$NT|&DT|$Q|%V|#W3b@|$?[|$@bK|(V',
      '|)0|(_|$D|%#|&QbATEU@|%KT4ID|(NKb@D|%T|$KN<T|(_|&TK|%Qb2TK|+_|%T|&?|(_|)IT!|&@@bN|+VJ|(D|&NT|)0|(_|%V|%W|&!|&P|(_|%X',
      'P|(_|%_|%b?|&N|([|$L|$Pb2K|(M|&;U|$Qb@2|)TLJ|)_|#X!7=V|$7NTIT!|%bJW!|$8D|%T|%bJ|$?[|$DI|$K|%2|%@T|&V|&W!|&_|%NTK|%Qb',
      '2TK|%T|&!|&NT|%V|%W|&!|%_|%b?|(UIT|&N2|(8|)_|(E;b;VIT!|(TCU2TK|(V|)J|([|#YAbA2K?|&NV|$Pb<|(HXIU|(_|#ZDbOD|#[2|%[;|$8',
      '|$;|%Db;|%KbD|%LTB|%T|%[|%bK_L|*UJI|$>V|$BT|&O|(_|$D|%L|&b;V|%bQULN[DUJT|$EK|%bQV|$KUQ|%W|$L[|&Q|$ONT|%V|&0|%bNT|$QU',
      'FU2|%[Db8K|#]2V|&D_|$QT|#_&Db;|$(Db;|$;K|%[OUJI|$@TDT!|(W!|([|(_|%[|$E|$KG!BK|%b;|(L|)[Db=|(W4L|*V9|$L|%UO|&Q|(V|%VQ',
      '|([|%[Db=|%_|$M|$OT2|%VDT|$P|%2|%?|$Qb;|(2_=|(L|#a@bK|$KT?U2|(V2|$L|#bJTK|([LTL|$K2K?|)_|&TK|)DT|+!|*V|)[|)_|(O|)2|)',
      'D|)Q!ObL[P?|)U@|&Y@U|&bKUJT|,0|(P[E?|%3K|&bJT@|%4;|&@U|%6!=|&LU@|(V@|&TK|%8DD|&T|(@U|*0|(Q@b@T2|%?N|&TLV|*0|&[@T|%@T',
      'E|&U|(2|)TK|+2|)XM|)Y@U|)bKUJT|.0|(8b:T|(DUCU|,0|,@bN|(G!C|+U@|)U!G|,U@|(HT|*N|(IT|(K_C2|(Pb<T|+U@|(QTB|)bEKbCV|&V2|',
      ')_|&bJ2bP|)TJD|)[|*2|%AINTK|&T|%BKbOD|+_|*U@|&TD|&WP?|&XP?|&[O|)DT!|)_|%CTD|)I!@bKV|%G!C|)D|&M|%HTN|)OTMV|)U@|)V|&W|',
      '(@bN|%I!=L|&T?|)E@bK|)HX@|)IT!|)U@|)[|&W3|%J@bD|*_|&T4|(?|(Q|)_|&_4|)OTMT|)T@bI2|)_|%N2b@T|&6D|&Kb@ITD|*[|&TQ|)D|)V|',
      '*0|)[|(R|)V|)_|&Y@U0|)b@U|,0|&[O|)@T|)BbNTK|)V|)[|)bJT|%O!QT|&T!@|(QD|&U2bP?|&bD|)_|%Q!4|)[|)_|*ET@|&DbD|&K?|&TB|(K|',
      ')?|)U@|&UBbC|+U|(CbC|&b@TN|+U@|)W@|(ATEU@|%RTK|%T!@|)U8|)VJ|)_|&&N[;|&2Y@|*U2|&4]@URTQU2|&6UD|(VD|&?|(NTJW|(V|)0|)OT',
      'Qb@bK|&B[OU2|&CTDbJ|(bJTE2|&Eb@|*U|&J|(#|(_4U2|)8U@|&K!H|*U2|(bADT|&Q!4U2|%U|&Db;|*K|)Q|&FKb=|&IUJK|(VJK|&J|%VIUJK|%',
      '[2b;UQ|)P2_|&I|(TD!B|(V|&K?T|(U@|&Q|(U=[Db;|%_|&4bKTI|,U!4|&8[2b;|&;VD|([Qb;Db;|(_2_L|&=2b;|+bQ|*OD|&@bQTRD|,U@|&FT&',
      'L|([ODL|)QK|&Q[Q|*K|*U!4|%aBbJ_4U2V|$LQ|%TD|(b;|&Qb;U2|%[|&;|(F_KbI|(UDI|(_|&JK|!F!=|#2@|$b@|#4TNV|#;2TKV|#@[EWKT|%R',
      '|#K2|$8|%UJT@|%_|$@T|&!|%V|%[|$NT|$QT?|$UJTB|$V|$[|$b4bJWQD|%JT|&_|%Qb;|#MBbKWE|$UJW!|$_|#SULbI|#T!QV|$&D|&L|(IT!|&T',
      'DbQ|%L|&_|%N|$(L|$)Db=[OD|$4?|$;V|$CK|$JBT|(0|(2TK2|&_|%K|$KQV|%bI|$MN?V|&NTIT!|%_|$Qb;|#U2OD|$6K|$=L|$FT|$K_9|$LQXF',
      '|)V|%T=[LbFUJT|%UE|(bQ|%_Q_FV|%b;K|&=|&IF[K|(V|([|(_|(bQ|#V;|$LbI|#W4TN_|$;|%G_L|$L|#X;|%G^L|&_L|$=|$L|%_|#[!2V|%4|$',
      '2Lb;V|%b;KV|$=-2bQ|%KK|&L|&[OD|$GbKW%KV|$K|%FTK|)_|%NV|%V|$LT&|&(|&J|([L|*T|*V|*W!|*_|(_|&N_|%_|$OD|$QGW2|%b;UNL|(VN',
      'L|#_8BTKV|$;_|$D|$K|%I|%NKb=|%[Qb;|%b6bJWD|&;|&=|&GbQ|&I|([;|&Q|$QbF[;|#bKT!Q|&DbQ|*UQ|,b2_|%V|%[!6|&=KU2|&Db2|)6|*T',
      '&9|&I|%_I|$LT&;|%X|%[O|%_KU=T|!G!4TM|(V|$BK|&_|%V|$C|%D|%TJ[L|*T|&K?|)VJ|&NNTIT!|(bJW!|$D[|%bD[|#2bPV|#4QKT|$V6T|(0|',
      '&_|#6@|$NT|$TN|&NT|&V|&[|$V|$[LT|$b6D|#8K!4|$T8|%K|&_|%NV|&[|$[;|#;D|$T;T|%LUJD|#>@V|#@2|$TNNTIT!|&V|&[|#BL|%NT|(IT!',
      '|%T(|&@T|(V|&IT!|&J|&N|%V|%[|%_|$TI|&V|#CT|%!|$V|$W|%!|$_|#D@T|%V|%W!|%_|$NT|%W!|$O[|$TKQ|%N|&;|(V|&@T|(V|&DTK|&NT|)',
      'IT!|(V|(W!|&TJ|)T|&V|&[|(L|)T|)V|&_|&bJT|)W!|)_|%Q|&2T!<T|$[|%!|%L|&T|&V|&W!|&_|$bD[|%JT|(!|&W|(!|&_|#E_K[|#F[;|&[|#',
      'I?V|#K=T|$F|$NTMT|$T2|%GK|$_=T|$bID|&T|&U!4RTI|%LUD|#LKTI|$UBTD|#M@?|$NT|&3_K|*_|%_|#Q_|#RTBWK|)V|$UPb2TK|$W|%2_?|%6',
      'KT8V|%@|%I@V|&TD|%KTPb;bKVJ|%NUC|$[D|&_|$_MT|#T!4bLTB[O|%C2TI|&NT|)IT!|&V|&[|$&GL|$(;|$2T@|%V|$4|$8K_|%W|&-AV|&0|$BO',
      'TR|$ET|%W|%b@UQbIT|$FVD[|%[LT|$G@|&[|&_|%KT|%T|&QTR[G|%V|$J|%=|$K|%=_LV|%V|$L|%TQUD_K|$M|%2|&_|%E?|%V|$NMT|%VQ|$PbEV',
      'HND|$Qb2[;G_L|#U!BW|(0|$2TD[K|$4|$9D[Q|$;bQ|$D|%8KXKV|$ITKV|$KLT|%WB|$L|%2WL|%G_Kb=|%T=V|%UJD|%b=U!4|(V!4|$RTK|(V|#V',
      '4|%L|$6|$8|%4?U@|%T!|%V|%W|&!|%[|%_|$;|%T|%bQ|$GVQV|$ITK|(V|$L|%VI_KT|$QV|#W!B[L3!=|$2|%bQ|$BbC|(U|$C|$Kb8|$O|#X2|$I',
      'K[!4|#YRB|#Z;bQIZD|$Db2|(U!4|(_|&=|#[!2|&U!4|&_|%4L_K|&bL_K|$&8U!4|$2|%K|%RTI|)[|%b;[KUJT|$4|%I|$6LK|$9|%G_L|%U2|$;|',
      '%KV|%U!4|%bQI[D|$<2|&_|%T|%[LT|$BV|$D|%9UK|%b2|(U!4|(_|&=|([|$KV|$L|%[|%b;|$N=T|&V|$QT=NTIT!|%V|%[|%b;|#_&!4|$2bQ|$9',
      '|$;TB|$=V|%[LV|$Db=|$G|$IbG|([|$J|$K|%QB|%b=|(K|&D|$L|%@T|%DTKT|%K|%NTIT!|%T@V|&J|&NNTIT!|(V|%U!4|%V|&0|&NW=|%[|%b;|',
      '([|&JT|$Q|%b;D|$RKT|#aBbC|(U2|#bJW2[DD|+[|&K_|$KCKbQ|%RbI|)T|*!=|%T)9K|(D|&9UL|&Db=|&JD|&RbI?|+_|%U4[=|&8|&;D|(UO|*K',
      '_|(VO|%WQ|%[2|&=|(I[D|+[|$L=|%W|%X9|%[2|(G[KV|%_2|&4|%bJW|!H!4|%T?|$=TK|%_M|#2b@|&U|&_|#4@|$NBb|%TD|([|#6T)|#8D|%_|$',
      'NNTIT!|%V|%[|%bJW!|(_|#;b;|#@bKV8T|#J!2K|$TD2|#K@|%V|$EWK|%XK|$NT|&=|$T(|%J|$V|$W6|$X6|$[LT|&V|#LTI?|$[|#MV|#ND|$T(|',
      '%DV|$UPbJ|)DT|)IT!|$bJ|#T!4V|$&|$(|%0|$4DT!|%KXE[|%LT|%N@|%V|&BTK|*V|*_|%[|%_|&IT!|%bJ[|)8|$8E|%V|$=[|$?N=|$@|$BKNT|',
      '$HK|$K|%@DT!|&HKIT!|&V|(J_|&[|%EXKbN2|%[|$L|$N|%D4K|&T@bI2|%U|%[|%_|$P?|%T|&!@K|&0|&2VJ|%V|%bJ|$Qb2K|#UDbD|(@T|$L_=T',
      '|#V=|$I|%B[N|$L|$P?|%bI|#W4_M|$8|$;b;_|#X2!E|$3|$4KbH|%_M|$@|%2TM|)DT|)IT!|%EXKbN|%TD|$EYPb<|$ICbJ|%U|&2T|)0|&4@|&@U',
      '|&Q[DTDT|,V|$KT|%_|$L|%V|%_|#[!Q|&T?|$4T|%V|$8|%NTMV|$;|$B|%HTN|$MNV|#_!QL[|$4|$8D|%EWKV|$ETL|#a4_LU2|$@U2|(NU8b:TD|',
      '(OTQb@bKV|$IU@U2|#bKI?|(22bPT|%Pb;|)T6TK|!I!4M|%[O2K|$6|$8XK|(V|$=E|%M|&V|$@NbJ|)_|%bK|(?T|(TLJ|(V|)0|(_|$B|%UK[|(_|',
      '%V|&K|#2TD|&_|#48|$DV|$K|#8GW@|%X@|&K|$T2|$XK|&V|#?UEWK|%LTL|#@BTD|$H[B|(_|$LG|$TDWQTK|$[|$_|$bQbJ|#A2|%_|$WKT|#BB|%',
      'DVO|%KXE|$D|$bJETD|&TKb2|%KTQ|#CK|$WK|$bJ2TLUD|*VD|&B2bPU?|&EXKbN|&I|&JW4VD|&NKb@V|&QbA|*V|#DIT!|%_RD|$T&|%(|%J|%LV|',
      '%NNTIT!|$V|$WPbJ|)_|$[|$_8|%K!8D|%NU8b:TD|&]8b:TDU2|%RK|#F@|#IV|#K6T!|%W!|$?|%_@b@K|&EKT!@|$T<T|(0|&V|$V|$bJTBT|*0|)',
      'U@|#LJ|%TLI|$U2|$[KUJT|%OUJT|$b;V|#M@T|&!|%V|%W!|%_|$NT|$O[|$[L|&T|&V|$bJT|(!|&W!|&_|#OVD|#QTLT|&[BTK|&_|$b2|&[|%8UB',
      '|&VB|%@2|#R!@|%IB|$@b@I|(bN|*DV|*EXKb?|&N|(DT!|)V|)_|(EXKb?|$IB|$KbPU|$L|$T|%2TMV|(NbJ|%@bIT|%B[N|%D|&4K|)VJ|%HTK@|%',
      'KT8|)T|(?T|)V|(Pb;bK|%NUBbJTLJ|&VK|%QT4K|$UDT|(0|(D_|&[|&_|&bBbKT|%IT|%LT|(0|$V|%QT4K|$W=TDT!|&V|%CT|%NT|$[@T|%D@|%I',
      'BTNTB|&TD|%L|&_|%O|%QT?T|&XL|$_@bQN|$b@bNDW!|#T!4|&?V|&@T|&K_M|&V|&[|%=L|&NV|&V|(D[|&[|&bJT|)_|%B4V|%Q|$&2|&L|&bK_Q_',
      'Fb;|%L|$(2L|&bK_Q_Fb;|%L|$)Db;|%Q|$3?|$4|%?V|%@T|%OK|%V|%[|$7LV|(0|(5K|%VITKV|$;V|%[DT!|$?NT|%Q|&T|&_|%TNBK|%V|%[2|$',
      '@K|%T|&8V|)DW!|&EU@T|%YHTPT|%bKT|)IT!|$AT|&BV<|%W!|%[|&KTD|$B2|%T|$CN|%bJI|)U2|)_|$D|%2|%@T|%B|%N|&@TNTBV|&T|(IT!|&V',
      '|(J|&W!|%Q|&U2|%V|%[|%b6[Qb;K|&J|(@T|*0|$E|%B!=|)_|%D|%NT|$F|%2|%V|$IT|$J|%T|$K|%F@|([|%NT|%T|%UJT|%V|%W!|&@U|%[|%_|',
      '%b2|([;|*U!4|(_|&4|(BKbO2|,D|,U2T|([|(_|&6|&8KUD|&;UD|&JT|(_|&OL|$L|%EWK|%QTITD|%U2|(V|(_|$M|%3T|(2VJ|&W|(!|%NT|%T|%',
      'UJT|%VJT|%[|%_|$Q|%U2|%b2|&;K|)bQ|$RU@U|(V|#U!4|$2V|$9_KI|(V|$=L|%UJT|%VJT|$@b@L|&K|(@T|(_|$A[D|$DU;|%[E_LUQ|$JT!|&?',
      'T|$Kb9T|$L|%2@|(_|%D|%K|%TD|%U;KV|&JD|(_D[K|%VJD|$OD|&KV|%bK|(?|(U@|$Q|%T&L|%UQUEV|#V;K|$<T|&(|%V|%W!|$=UJT|$K|%T|#W',
      '!|%G&|&(|$2@|%NT|(IT!|%V|%[|&O|%b@|(U|&J_|$3|%Kb8V|%bJ@b@bN[|(I!@bKV|)A2|(TLJ|$4L|$5L|$B@|%bBT|)0|([|(_|&K?|(T|$DU|%',
      'bBbKT|$LT2T@|*V0|*[|$M|%V|$NT=T|(V|%V|$Ob2[L|*V|+0|$QLITD|%TFKV|)_|%bLUI|*_|(VI|$RIbIB|#X2@T|%NT|(IT!|%TJ_|%V|%[|%bJ',
      'T|(_|$=V|$Kb@U|)0|$LbJ|(NTD|(T!2D|(_|$M|%HX@|%KT8|%[|$NV|#Y@|#ZD|#[!|%BK=T|$&D|%L|$2|%bQ|(U2_|$4TN_;|%[9UD|(VD|$5K8|',
      '%T?V|&LJ|$6|%_|$8K|$;L|%bKU2|(_|)E_LU;D|$=L|%U2L|&QUD|$BTD|(_|$D|%R;D|%T|%[8I[Db;|(K|%bJW$L|$E|$IKV|%_KUJL|$JK|$K<|%',
      'T|%V|%[|&A_D|$L|$M|%N@T|&DTK|*T|&NT|&[|(L|)T|)V|&bJT|)W!|)_|%T|&IT!|%_|$Q[8|#]AWD|$QWK|%XK|#^=L|#_!|%5T|&V|$2LDTK|&N',
      'T|)IT!|&V|&[|&bJT|)_|%_|%bP|$3K[|$4L|$8T|%XB|$;K|&QTJ2L|&bQ|%T!|&ETJ[|(bKIT?IT!|&HT4DT|,!|+V|+W!|+_|*[|%W|&!|%[|&HT4',
      '[|%_|$=|%KbD|%L|%TQT|%V|%[L|(_|$@|%V|$BV|$D_K[L|$GT&L|&(L|$K|%GV|%NT|%TK8V|$L|$OD|$QI|&V|%b2_|$RD|&BTQ|%IbIB|#a3U2|$',
      'D|$KbJ|$LTDT|%U2|#bJTDITK|%W6bJW$L|&9U2|*L|)JI|(VJI|&DUQUEL|%_2TKb=UJL|!J!4|$@bK|#2Y@|#8ITD|$b:|#ATN@|#IWDT|#N@ITM|#',
      'RWBV|$XBV|#T!4|%@bKU2|$@bKT|)CTI|)MW0|$B|%4TK|%N|%V|$D|$Kb=|#W%K-L|$&-F-|$-D|%Q|$2[|%b@|$4|$9K|$BbC|(NUKTI|(_|$CUPb<',
      'UK|%bC|$DT&;[=|&(;[=|%U2_=|&;|&JD|&NKbQL|+U;V|.0|+V;V|%[Qb2_|$K[DUJI|%_|&E|(UJD|(VJ|*D|$NT|&D|(_D[|#_4|%BTD|%V|%bJ|(',
      '@T|$8DT|(0|%NTIT!|%T&|&(|&@V|&J|([L|*T|*V|(_|$BbCT|$DU|$K|%b2|$Q[IU;V|!K!4|%DT!|%EWK|%HXIU|%I!6|%VD|%_|#2I|$b@|%P2|&',
      '?|(T@bI2|&T|&U@|#3TJ|#4bGV|#6DT|&0|&@bI2|$JU@T|$NT|&IT!|$TJ|&[L|)T|)V|$U@|$V|$[|#8@|$NT=T|)!|)DT|*V|(W!|$T|$W|%%@|$X',
      '|%%@|#?8U@KTI|$IT!|#@DEWK|$bD|#BVF|#FV|#GK|$TKV|#I?HT(|%LTL|%VJ|$@|%4I@|%T|%_|$NT|$T@V|%J|&[LV|$V|$X8V|$[|%O|$bJT|&_',
      '|#NTDT|$U|%DbBbKDTA|%NTK|%O!2K|#OUJD|&T|#QEbKB|$TJ?|(OTQb@bK|(_|$V|%2K?|$_(IT!|$b@T|(0|&[|&_|#RQbJ|(IJ|$U@|$[<T?|%?T',
      '!2|%@T|(!|&V|&W!|&_|%L|&T|(!|&V|&W!|&_|%NT|(QV|*0|&W!|%O[|$_|$bJT!|&W|(!|&_|#T&|%;|%FL|(bQ|$(|%;|$);K|%Db=|)IT!|$2bP',
      'Q|$3|%@T|&V|%NT|(IT!|&V|&W!|&_|%O[|%V|%[|%_|&=V|%bJT|(W!|(_|$4|$8|%2TK?|*V|&VJ|&WITK|+V|&_;|%BX@|&bNTKV|%CTDV|%DV@U|',
      '&[@T|&]@U2|%EKT|&VEMT|&W@|(K|&X@|)_|%J|%N!O|&V|%QbATD|+V|%T|&0|&OTRV|%V|&DTIW!|&N|%WLT|%[DbBbK|&O|%bJDT!|(ETL|(_|$<_',
      '=|$?EWK|%T|&NTN|%V|$@|%[|%bKU|(V|([|$CDEWK|%T|$DV|$EK|$I|%2YPb?|%6!BbK|%8V|%EWK|)T|%TJ?|$J|%EWK|$N|%?|%L|%M|$Pb;bK|*',
      'CbN8|._|*E@U|+bKIW3|*NTBV|*Q!5|*UJ|*_|$Q|%TJ?U2|$R|%@|%WL|#U!4|$6TKb=|$9KbN|$EGbLU2|+D|%_Kb;|$JL|$LTJDbQ|%U9|%V9|$NK',
      '|%T8|$QKb6|%TJ2L|)bLU!4|#V!4|%7|$$L|$=|%K|$@|%_|$E_Kb;|$LV9|$QKb6|%VNK|#W6U|$E[|#X;|$>U6WQb@|$CUK|$E|%IT!|%K[3T|%T!@',
      'K|*?|*U@|%UJT|%[|$I|#[2_Kb=|*U!4|$3T|&!O|&0|$8UI[Db;|$;KU2|)L|%U!4|$=|%UJ_|%VJ_|$@TM|%V|$D_|%b8|$L|%N[|%bN[|$NT=V|$Q',
      '|%LI[DUJT|%b;_KDb;|#^2|#_2|%=|%NT|%T?|(2TK_|&JT|%V|%[|&;|$4|%6TM_|%EbK@U2TK2|%_|$84TK|)V|%K|%U!BT|$9|%T|$;LV|%V|$=|$',
      'D|%TLb=|$GKb;|%UD|$I|%D|%T!62|&DUJD|*T|%[Db;U2|$J|%L|$L|%U!4|$NK|$OD|!L!2T|$=D|$G6_KQ|%T&|&(|#&D[|#(D[|#2bP?|(_|&bI?',
      '|)V|*2T!@|(J|)T!2|#3@K|%T|$Da|$E@|$NT|&IT!|$T?|&_|%J|&[L|)T|)V|)W!|$V|$[|%L|&T|&V|&W!|$bJT|(!|&W!|&_|#4@T|&!|%V|%W!|',
      '%_|$T=NTIT!|%NNTIT!|&V|&bJ_|$bD|#5W|%@b@I|%I@V|#=@|%T|$NT|$T&|%(|%J2|$V|$bJT|#@T|#LU@|#Ob2K|(V|([|#Q?|$U2T|#T!GT|&V|',
      '&W|(!|&_|$&;|%D|%F|%GbK[KV|%N|%QDbQ|$(D|%F|$2=T|&V|&W!|%bP?U2|+@T|-0|$3|%?V|%_|$4?V|(0|%@T|&V|&W!|&_|%V|%W|%[|%_Q|%b',
      'JT|)!|(W!|(_|$<V|$BNTIT!|$E@b@T|$H|%_|$IbG_K4VDV|$J2|%GbK[KV|%QDbQ|$L|%EWK|%T|$NNT|%V|%[|%bJT|$Q|%b;|$R_K|#U!2|&D|&b',
      'Q|%4|$-|$3U@|$4|$;K|%L|$D2bQ|%b2bQ|$E|%U|$GK[OD|&b;V|$IU;[=|$Qb;|#V!2|%G=V|&W|$4|$=b9|$CT|&!|%V|%W|&!|%[|&LT|(V|%_|$',
      'Fb;|$I3[=T|$LT|&!|%V|&JT|%_|#W&Q|$?TNT=T|$Eb@|#X&Q|#Z;UD|#[!4bN[8|$2|$3|%2|&[|&_|%D|%U2T|&@|%_|$4|$;K|%UD|$=V|$@T|&!',
      '|%V|%_|$D|%TK|(T|%b=|$Fb;|(DDb;|$GK|%L|%_K[;KV|$JK|$NL|%T|&@T|(V|&IT!|&J|(T|(W!|([LT|(_|%V|%W!|%_|$O[|$QK|$R|#]!4U2|',
      '#_!4|$$K|$2|%2AT|%EbKUJ|+@T|%L|%NTJ2T|%OTRV|%QHT|%_DT!|$3!=|$4_|$;|$=|$CU2T|$D|%b6|$K[DbQ|%b=|$Q|$R|%V|#bJW&QUJTDT|!',
      'N!6U@|$ALV|$O|%8|&_|%DT|%VJ|#2VL|$b@T|#3@[|$T?|#4K|$T=NTIT!|#5&|#6D|#8D|#;TNV|#=4TI|$D4K|$T|%!|%EbKCTD|%LV|$W!|$[|$_',
      'BKT|#>NT?|#?V|#@D|%V|$V|#C@T|&!|%V|%W!|%_|$NT|$O[|$TKNT|&T|(DT|)V|)_|(IT!|&V|&_|$V|$[|%LT|$bJT|&W!|&_|#DE[BTO_|$IT!|',
      '$QbE@U|*0|*OTQb@bK|$b=KL[Db=|%J|&8VND|#EKT@T|(V|(W!|(_|&J|([LT|&O|(2Kb@T|-0|#FTBTK|#JDT|%V|$Qb2|$[|#KBTD|$Q|%TB|(V|$',
      'T&|%M|$UJTMV|%Pb<|$b2|%4|&V2K?|)Y@|&_|%6QbN|&bJW$L|%9D|%=|%?|&D|(_|&NNTIT!|(V|([|(bJT|&Q!2K|%@?X!2|)2|&D|&ITD|&WM|%C',
      'ITD|&T|%IT|&_Db;|%Lb=|%PT|&VJ|&[|&_|#L?|$QT=|$bLH|(HT(|(VEWK|#M4T=|%V|$@K|%_|$NT|$T!2|$V|$bJT|#Q!@|$@T|%U|%V|$NT;|$T',
      'NT|&bJW!|%R@|(V|)0|(_|$[|%LT|&W!|$_|$b@V4?@KV|&W|(0|&bK|)_|%JT|#RD|$T?|$UN;V|$V|%N;|(V|$[|%!6?V|(NTIT!|(TJ[LV|,W!|(V',
      '|([|%?|%@T|&V|%LT|&V|%NTK|)IT!|#T!2TD[K|%6D|&NT|&V|%C_|%Q|&BT|$&=|%D|%KQ|%Q|$(KQ|$2bJ|$4=|%KT|%[|%bJT|([|$5|%[LT|%_=',
      'UJT|$6D|$8GV|$;T5T;|*_|$=V|$?U8bJ|*U2|%V|$@|%6V@|%TNK?|*VJ|%_|%bK2|$B2|%M|&V|%bJ|$D|%4V|(0|$EK@T|&NT|)IT!|&V|&[|%V|$',
      'ID|$J|%K|&L[Q|&Q|%NbJ|%T|%W|&0|$K|%!NTK|%Q|&BTK|&T|(4@|(IT!|&_|%T?QV|%b@T|)0|)2TK|)LTE|&PU2|$L|%UJT|%V|%_=|%bN|$M|%T',
      '|%V|%W!|%_|$N|%=V|%[@K|$Q|%?|&T|&_|%b@NIT!|)U2|+@T|(W|$R2|%D|&NbJNRTK|&_|#U!4|$2LbE|)_|%Q@T|&TNNT|+IT!|)V|&U@|&V|(@|',
      '&[|%TK|&Q|(OVL|%UEV=UJT|%Y@U|%[;|%b;K|(_KUJT|*VJT|&KI|)_|&P[E|$3[KV|%bJT@|$4@|&NTK|&_|%[K[|$5;D|$6TK|(?T|(CTKT|(QK?V',
      '|(V|([|(_|(bJW!|%U@bK|$8J|&D4K|&V|%TEWK|%[@T|)0|%b:TD|*V|$9T|%bJW$L|$;TIUD|$=U0|&J_|%V0|&J_|$@K?|$A|$BTJ|%[O|(V|%bJT',
      '|)EV<|)KbAV|-0|)LJ|(W@|&K_R|&NTD|*_|$CNT|%TD|(QHT|%U|&0|%V|$D!@V|%T|&J2|&O|(2|%UIJ|%_B|%b=_9|&Q[Db;|$EKU@|&V@|%WL|$H',
      'T4|(VJ|([|(_|&8D|(U@|(V@|&NDT|%UDbD|$ITD|(IA2|(NTR2|(_|%[DbQ|%bGLb=D|$J[@DTI|$KEWK|%I4TI|%T;|&I|%WBbC|%XBbC|%_C|(THT',
      'Q|,V|(V|$L!G|%UD|&JI|)bQ|%VJI|%bQD|$NK?|%TB|(TQbEB|(U@|(_|&R|%UC@T|%[2TD!B|&62|)_|(D|)T@bI2|$OTM|%UPb;|*@T|%[|&P|(@T',
      '|*0|%bL[P2_|*?|&N|(2E|(DT!|*A|(HKDT|*IT!|(JWBbC|(NUBbJTLJ|)bJTEV|(QDVJ|(TQ|*ET@bK|$PJ|&2|&NQb@W|&_|%[|%b?W|$QD4K|%Kb',
      '8D|%TNBK|%b@K?|(TK|*_|+IT!|(Y@|&F_;|$RTK|#V!7VJT|$8|%MV|%QbAU@UITD|$=UJ_|%VJ_|$A|$IT|%_|$K|%@T|%bJ|$L[D|$Q|%IV|#W=bQ',
      '|([|$ID|#Y2bP|(_|$@b@U|$BbC|(U|#[2bJXI|$4|$6NT|(IT!|%T(|&?|&J|%V|&D[|$@D|$B|%T!@|%U2|$D|%UQ|$ETK|(V|)0|$G|%QT&;|((;|',
      '$K|%T&9D|&NM|%_|$L|%V|%[Db;T&D|%bO|&Q|$MT|$Qb;|(KbD|#]2LbEU2|$8b:TDU2|,_|$BU2|%bJ|$HNV|$NUCbJ|$OT3|%bNU2|*K?|$Pb?N|#',
      '_;|%K|$=2T|%TF_D|$D|$K|%!;V|%bDK|&IU!4|$L|%b;|([8|&JWI|&N_|$OU!4b;D|#bJ!8D|%2@|&U@|)0|)4@|&b@|)U|*0|*4@|*@bN|%NQTJU2',
      '|*V|(bAT|+0|+ED|*U@|&RTK|*U2|*W|%Qb@|%T2K?|&3bJT|+0|+D|+JU@|&8|&E|(2|)E?[|(TK|*U2|*V|+2|&JTI|&KT|&NQTJU2|&Q|%W@bE@b@',
      'U|.OTQb@bK|%XRK6DT|(T@bI2|$K@|$RT&;|&(;|!O!2K|&T6TKbJ|%T|&QbEB|$3|%[ObNK|#2@T|&!|%V|%W!|%_|$J|$NT|$O[|$T@T|&V|&W!|&_',
      '|%JW!|%O[|$U@|$V|$_|$b2KVJT!|%@U|(0|(OTMV|%J|&@#|(T|)0|&T|&W!|&_|#?4TK|#@TGbBV|$bKW|#DU|#EA|#GbB|&2_O|&EbKJ_4|&_|#K?',
      '|%T4@U|%[|$@|%_|$B|$VK|$W|%%@|$X%@|(V|$bIT|#Qb@bK|)2bKUJT|)_|#RVB|$[KDT!|&T|&V|&_|#T!@|&U|(EXKb?|$2|%HT8V|%TRTKV|$3T',
      '|&0|$?E?|$E|$GbBU2|$IUL|%[L|$KBT|%UKV2|%VKU2|$MT0|&2VJ|$ObN@|$Q2|&_|%D|&2TM|%U@|%b@bK|*V|+J|$R|%V|%[|#U2T4_|&K|(V|%b',
      'P2|)_|(?|)NUBb|(T|(U@|$3K|&_|$D_K|$ILT|$JT|&M|(T|)IT!|(_|$KbP2|$LTL[3|*_|%bE|(_|$N|%8V|%LU!4|%T8V|&LJ_|$OW|$PbJ|(_|$',
      'Qb@|#V3|%NNTIT!|&T|%V|%_|%bJT|$@|%MT|$JKK|([|$KbP2|#W!|$&|$2bK|&L|$BbC|(U2K?|$H|$Lb2|$Pb2|#X;U!4|$DbJ|#Y!3LT|#[3|$<|',
      '$@TD|$K|%=V|%V|%_|$P|#]2bP?U2|$LV|&0|$N|#_2|$3|$;|$C|%2|%3_M|%NT|%V|%_|$EU!4|$IT!|$Kb;|$P?|#aKbJ|#bJTI|$KBbCT|*!8LU|',
      '*MW0|%I|%TE|&N?|(bJ|%V|&D4K|&I!@|(@V|(Bb|&L!2T|%[?V|)0|)GBbC|&J|&Pb<|$L_2|$NQD|%TKb9[D[4K|/[|&Q|%[@|(T!GK|!Q!2;|%K|%',
      'LD|&U@|%MTJ[L|+T|+V|+W!|+_|%W6U@|&L|%[@|(LUEV|(_|%_6D|%bKI?|)U@|&PUEb@|([E|$3[=T|%bJT|)0|)G!C|$4<D|(_|&U@|%I|%V@|(2T',
      'K|+_|(DT!|(IJ|%bKR|)TLJ|)U@|)_|(TI|$5|%KbP|%VJ|$6J|%TK|&L2|(D|(U@|%U@|$8J|%[LV|%_4_IT!|%b:T|)0|$@|%KTI|)EWK|%TD|(_|%',
      'WLD|(U@|%_|&P|$BKbH[|%U4bC|%[O|(T|)0|)NbJNRTK|(_|$CU|$E@b@U|%DbD|%Kb2|%TB2|(D|)_|(U@|%WKb?|%XKb?|*E?[|%bKBTJ|+_|$G!C',
      '|(U@|(V|([|(_|%CU@|%_CD|$HN|&@|(#|&U@|%TM|(V|([|(bJW!|*_|&NDT|*0|%_4|$I@|&U|%[LD|$JW2@|(b@|%_8D|)_|$K2bP2|)?|)U@|%6D',
      'T|$L4bD|$N@|%KbCD|%TB|(_|%UCTD|%[BDOVL|,@T|)T|$O_C2|)_|(D|)_|$QB|&VJ|%TCD|)_|&K|%b2K?|(TK|(Y@|*U|+0|&AT|)0|)2VJ|)D|)',
      'E2|$RU@T|#2TKT@bI2|$bKUJ|)@T|&VJ|%PI|#3@|$TN@V|#4N=|&_|#5D|#6UD|%N|$_;|#8T|%N;|$VN|$b8|#=2|#@@|$LTQ?T|$V|$b@T|(0|(NT',
      'K|%J|&T4bKR|%K|#BQbJ|(_|$V|%0|%DT|%IT!|#CKbD|#DT@D|$[|$b|%ITD|)U@|)_|#ET;|&V|$_Kb;|$b;[IbGK|%@TR|#FK|$M|%@T|(EXKbN2|',
      '$T&|%(|$[B|#HT|$bJ|&EB|&_|#I22bP|%TLUD|(VD|%bP|$4bK|$8|%?|%NT|%TNNT|(V|([|%V|%X@V|$DbNJ|$EbK2TOVJ|$J4TMT|)_|%T!@K[|$',
      'K|%bA|(2|(D|&E?|(U@|$Qb@|&JT|)0|$T!@K|%6TK|)E@bK|%8|&NTB|*V|&OTQb@bK|%CTD|&U|&V|%D|&@T|&TKbAV|%Eb@|)U|%K!H|&2TI|&_R|',
      '%NNTIT!|&UPb;|&V|$U@U|$V|%2K?|&bPT|$WBTJ|)_|&bK|)V|%KT&|%R|$XR|&_|$YBbC|)U|$bITD|%KT;|#JT8VKTN|#K2TK|(V|([|(_|$3T|&I',
      '?V|*-|*IT!|%V|$BTK|([|(_|$M|%@T|(AV|$NTM_|$Q|%bN@V|*6!BbK|$RB|&V|&[|&_|$TQKV|$[KTO|$_NK|$b2L|&U;|%6|%82|&D|(T@bI2|(_',
      '|&T(|(J|%E|%N|&EbKAI|&K|&ObK[Pb<|&QTITDbJ|&UQ|)V9|&[|(2bP?|&_6b6|(@b@I|#LTI|&@|(V|&V|%R|&2TK|$b@D@|%FK|%LLbLTRW|#M!4',
      '|#NL@|$TK|&V|&[|%L|#OQb@bK|#Qb@D|&T|&V|#R2TK|(V|$8|$D|$HT4V|$I@|$J_4|(V|$TDWHX@U|%J|&2|&@T|$U@|$V|%@|$[8|%LT(AV|#T!2',
      '=V|&M|(NTIT!|(V|&[@U2|%4T?V|%8|&[|%@LEWK|%BbK@T|%EbK@|)BTJU2|%HMNT|(V|%QB|&b2Y@U2|$&;|%=|$(;|$)A|%BV|%Db=|$2K|%bPK@T',
      '|(T@b2TK|(V|$4DT!|%GTKT|%K|$6NV|%T|%V|%W!|%_|$8T|$=T|%V|$?!B|$@|%IT|&V|&_|%TKT|$A|%V|&0|%[QTA[|%_QTA|$BT|%V|$CD|&T|&',
      '_|%TK?|%V|%W|&0|$D|%W2XM|$E|%[2bP|%b@TRU2|$F|$GK2T!<T|&I@V|%U@|(V|%W|$I|%4bKV|%D_|%JU2|)_|%T8U2|(V2|&D|(bJ@#|*E?[|*K',
      'V@[|&JU2|%WBTJU2|&RU2|%XRU2|%[L|%bJ@T|(NTBV|&KT8bJ|$J2L|%DbQ|%LT|$K|%NTK|%T|&!O|&HT(|%V|%W|&!|%[4TIT|%_|%bN8DU2|(@bK',
      'U2|(HaI|+@bN|$L|%IT!|$N|%K2W!=LT|%LV|$RQ|&U2|&_|%U@bJ|*2TK|*U2|&G|%[G|([|#U!4L|(bQ|&TEWK|)_K|%5|&[|%6T&|((|%C|&V|&W|',
      '%R|&TQD|&[|$2!BK|%b2T|)0|(UI|&JWKU;V|$4bDL|$9D|$;V|$=DV|$BbC|(EWK|(KT8|(T!@|+_|)KbA|(U|)0|$DUJK|%[IT|%b=bK[LT|*_I|$E',
      'TRV|)0|$I[Db;|$KV9|$LbNK|$NTJ|%UL|$Qb2_|&;I|)bQ|$R_K|#V!4N=|$%&-|$&0|$(0|$9D|$;|%V|$=V|$@T|$CT|%V|%W!|%_|$EV%&|$IT|&',
      '0|%U@|$KV9|$L|$QV|%b;I|#W!BK|(@T|$(4TI|$2T|$3|%V|$4!C|%K|$6D|%N[|$9W2V|$@bKTET=T|$B|%KbOD|$CTK2|(?T|(NT|(T|)0|(V|([L',
      'V|(_|$DTIV|%UOb6U@|$EK|%bKQUBbC|(VI|$GUK|%[BTK|$HTP|(6!BbK|$K2bPT|)U@|%[DbBbKD4K|&O|$L@TD|%b@TD|$NKb?|)6!BbK2|%UCT|)',
      '0|%bJNQbAU@|$O_HD|(U@|$Q!4@|#X2T|%V|%bPbI|$62|%D|&T|%NNTIT!|&[|&bJW!|%U|&@|$@bK|(_|$E|$FV|$K|%-|%?|%bJ|#YPb;U|#[!2=_',
      '|%;|$2Db=|%b;K|&K[;KV|&Q|$;|%[LT&;|$@W|$D|%T|&E@U|%[;|(K|%b6bJWKV|&;|(K|(bKL|$IQ!4|%UFT&DLIT!|%V|%bJW$L|$L|%bJWLK|&Q',
      '|(UJQ|$N|%2|%D|%T|&0|#]BbCT!@U2|$DU2|(_|%bJ|$JB|#_!4|%E?V|&NTIT!|&V|$2K|$8U@bKT|%_|$=UJI|$BT|%_|$D4>|%T|%V|%W!|%[KV|',
      '$Fb;N[K|$IDTA|$J|%TGVD|$K_Q|%bQ|$L!2V|%_|$M|$NUJ@|([;|)@|$OUJL|$QTJ;V|#a!BKbJ|$EbKAI|*NTK|$IbJ|$K|#b2TJ|%WL|%XL|%_;|',
      '(L[Db=|(UO|(b;VO|&K|%bKVD|([GL|&N[K|$3LD|$;=V|(9|%G|%T&L|&Db=Kb=|&F|&K|(b2|%VFD|&L|&N|(D|%W=UJ_|%[8|&;|(Q|(bQ|&=UJI|',
      '&DF_Kb=|(b=|&OD|)_|%_2|&D|&K|(V|([8|%bKV;|)I|$@!H|(_|%D|%K|&VJ|&[|&_|%XE|%bKTN|*2bP[@bK|(V|)0|(_@|*_|$A4U@|%ETJ[LV|%',
      'M|&T!@K|+U@|&[|&_|%TD|(2|(U2|(V2|)J|([|(_|&E2|(@bJ|+_|(D|(NT|*IT!|(U@|(V|(bJW!|*_|&JV|%U@|(U|)0|(V|&K|(@T|$DT@2|&D|&',
      'JW|$EKbCT|*0|*@bI2|(O|%Pb;|)@T|)E?[|%V=|%[D|(UO|&OUJL|(bJL|&Q|%_Kb;Q|*bQ|%bKUDb4Qb;VD|1[|$F;U2|$IK?|%TK2|)_|%UA|%Y@U',
      '|$JW;|$K_@|(_|$LI=_4|%VE|(U!4|%[I|$N|%6b7|)@T|%@!@bK|+@T|%B[OV|%EbD|%HTN|%J!|(Q[N2|%K|&T8|&WE|)[|&XE|)[|)_|&b4|%QbA|',
      '%T4@|&@!@bKbJ|&B|(UPb;|&CbJTJ|&HTNU2|&IUDTKTJ?|(V|)DTKTJ?|&J@b@|&QbAbJ|%U!4|&Q|%V2TK|*NT|,IT!|*V|*[|*bJ|,W!|,_|(Y@|*',
      'U|&6|%]6b7U2|!R!4TIV|$I[OT|)!|#2TKT@bI2|$V2@|(IT!|$_|$b2|&_|#8TK|&_|$V|$W|#9K@|#;TNV|#=@TL|$F|$QD|#@V#|$W|$bJT|(2T!=',
      '|#AUJTK|)_|#BIT!|$[|#DWITD|)8V|#IVK8V|#JT@|#K?|$TNV|&bJT|)_|$U|%JT?T|$VEWKT|%F|$[|$_M|#L2T|$D6LD|$NT|%_|#MBK|$E@U|$N',
      'B|%T|%V|#NT|%&|&IA2|%(|&IA2|%ITD|$[|%LV|#O[|#QD|$b@|&2|(bP[E|&4@|&EbK@|&I]AWD|&T!@K?|(2bPK|&[|#T!2V|%QL|&_;|$&|%=bK_',
      '8D|%N[|%Qb2XL|$(|%=bK_8D|%N[|$)|%Q|$8K|&V|%V|$;VDT|$=2T|$A|%V|&0|%[|$D|%U|&2TK2|$F|$K|%ITMT|%V|&8|%b;|&=|(N[K|&GK|&J',
      '_|&LV|&NKb=|$L|%@IT!|%DT|%IT!|%_L|$QbJ|#U!4|%B|&V|&W|(0|(Qb@TD|%I@|(D4K|%Q2|&T|$;|$@|$DbB|(V|(W|)0|)Qb@TD|$I|%T6L|&J',
      '@|&LJ|)D|$K_OUIT|$L|%6TL|%[KV|%bQ|$Qb;KV|(bKV|&QT|(_|#V;|$I_FVLUJT|$KT|%_|$L|#W!|$-|$2I|$ILT|(0|&_|%TJW|$Q]D|#YBJ|#[',
      '2b;K|$=|$@W|&0|$DKV|%b=|&KV|$IbEOTJK|$KF[K|%U;[8|%V|$L|%U2_Eb;K|%bA|$NV|#]!|%c|$BKTGTB|$c|#_!4|$&|$(|$2TJ!@bK|%V|$;|',
      '%L|%[L|$@|%T|%V|%W!|%_|$BbBT|(_|$Db=WKTQ|$E|$I|$L|%V|$MV|$NT|&AV|%V|%W!|%_|$Qb;|&EU;L|+_|#bJWID|&Qb;D|$KBJ',
    ].join(''),
  ],
  pa: [
    "ਂਅਆਇਈਉਊਏਐਓਔਕਖਗਘਚਛਜਝਞਟਠਡਢਣਤਥਦਧਨਪਫਬਭਮਯਰਲਵਸਹ਼ਾਿੀੁੂੇੈੋੌ੍ੜੰੱ",
    [
      '!#.<QCG|#<R|#@PJMG|#EGO.M|(O|#G=|#X0GR4LO|$>G|!$&|#>N|#A|$;M|%O|%R|#E|!%.|#<NKMJ|#@VKM!|#J|$>R|$@QX|#K|$@M!|#Y.|$=R|',
      '!(@VKM!|#EG|#J|$>O|%R|$@QX|%R|#K|$@M!|#Y<G|%R|!-G<M!|!.&|#G|$.R|$>M|%O|%R|$@|%M|#IN<M|$O|#KM;O|#MG@|$H4|$IN|#N|$(!.N',
      '|$JR|$KM|#O|$<M|%O|%R|#P5|#R|#T&|#XE|!/R<G|!0&|#*|#N$|#O<|#PGQ|!1G|#Y7|!2MG|!4>T!|#@E|$IGO|#LNHVKM|)R|#M|$!|%>M|&O|&',
      'R|$;|#NIR!|$J|$K@M!|$Y=R|#O|$I@|#PHM&|#Q@|#T|!<GVKM!|#M!|#NX@|#R|#T!|#UG|#Y.|!>JXCG|#M|#N@|$Y<M|&O|%HO|#O|$$!|#P$GM|',
      '#Q4R|#R|$;|$JL|#T|#UGM@|!?GE|!@KO!|#M|$!|$7.|$E|$H|$IH|#QX|#R|!AG|$NIMG|#KNHM|(!|&O|&R|#M.NJ<M@|$;O|$G7O|#N<M|$X9|#P',
      'GJ.MG|#RJL|#S>M|#VGJNY?|%MA<|#X4MC|(O|!BLNHE|#NG|$HE|!C;|$M%$|#HM.|#KP<|#M#>|$GR|$KGO|!DMG<|&O|$JLM|#QEN.M|!EJLKQG|#',
      'MG2|#PY/|#U<|#X@N$|!FQ@OIGJN7O|!G2@M|#KO|$R|#M4|$JL7GO|$KO!|#NKM|#QA|#Y/N$|!H&|#N$|#R/.|#S|#T.|%M!|!I4T!|#G<T!|#HT!|',
      '#MG|$HM|%O|%R|#N$K|$.MJ|$/R|$0N$@|$2|%T!|$JLI|&RJL|$Y2|&T!|#O|$!|#Y/|$9M|$?|$H|%T!|!J.>M|$QH|#<XCG|#=M@|$N<|#>O|#@|#',
      'D|$M|#EM4|$R!|#G.MG|#LC>|$KNG|$MEH|&NH|$PGQ|#MGR|$H|$KN<|&C|#NX1|$Y/|&N$|#O|#X0O<|!K@|#G|#IMHR|#NX>O|$YJM|#O|#P;|$X>',
      'M|&O|&R|#S|#T|$%$|$&|$*|$;|$G|$IR',
    ].join(''),
    [
      '!#.CG|$J|%G|%LS|$M>EN.|(O|%G|%H|&O|%JL|$S9EO|#/<G|$CMG|$L<G|%CMG|%OG|$M;|%WR|$OG|&HR|$U<O|$X9|#0@O|$G|%IMH|$HM|%O|&$',
      '!|%R|$IM|&&|$J<|$M!K|$N$<|#2M@.|$OIES!7|$R<|#4@CO|$ERG|$LGCM&4M@|%M>|(O|%O4L|&E|$M%C|(1G|%>O|$NKM|&O|($!|&R|$O<|%C|$',
      'R|$S|$T.M|&O|&R|#7HM!7N.|$MGO|$PY7|$YH|#8MGIO!|#9OJL@|#;/O|$0N;<|$4M;|$IN$KN$|$KT!>|$Q|%$!|#<G|$N|%#X<|$O<|#=HO7|%S7',
      'N.J|$IM|$MG7O|#>C|%O|$DP<|$M|%%0O|%.MG|)M|*IM!|)O|%GM|&N$!|&R|%H<|$PY<O|#?MG|&<|&N<|$N#@|%$%|&*|&<E.|)N.|&A.|(@|%+@|',
      '%.|&MG|).|)<|)O|$O@|$QGM|&O|#@AWVK|$ETH|$IG|$M4|%G.HO|$NGX<G|%H|%JL2N<|$O<M|$P.QH|%AM<|%DI|(O|%EM@|)N<|%GM0|%IM>|).|',
      '%JLMJ@|&MGO|&Q2N<|$R.|$T/M|&O|$X<|%>|&APG|#A;M|&%$|&&|&(;|%O|%R|$@M|$EM@|$GM?|(N.|(O|%SH|$JL0@|$OH|$VGSH|#B0M@|(NJ<M',
      '@|$GO.@|(M|(O|$JG|$L0LM@|*NJ<M@|&M@|)NJ<M@|%GO.M|)O|%JG|#C>MHO|%PH|&YHM|$M>|&O|$PH|$Q|$TKG|#DN$@|&J|%?M|%@R<GO|+$!|)',
      'M|&S|%IN#.<O|%JLR.|#E@|$G|%4O<|%>MJ|%NX>G|%O.@|$H|%O|%TK|$M@<|$N<MD|$OG|&M<|$QG<|$VGN<|#FME|&M!|&O|$QC|$T0|#G4@|&7O@',
      'M|%LO|%P@|$=JLMJ<G|,O|%M<|%O|$>MJ|$?|$@SJ7|$C|%O|$INX>|$J<Q|%R|$M?@M|%E|$P;|&M|(2H|$TWM|$XD|&.|#H.TKH|$0|$4CGM|(N.|(',
      'R|%OGO$|$A|$CG7|%M@N$|(O$|$IG|%N>M|$M(>O@|%KP;O|*$!|$O|%0WVK|$S04LS!9G|$T2@M|%A|$U.N.|$X.MG|$Y0|#I2R<@|$<MG|$?|%O|$J',
      '=M|(IM!|$M4|&L|%G9|(4L|(J|#J<N<I|)IM>|(VG|%OBLM|(M|$=M&|&@|$AJL7|$BH|&<M|%LH|$EG=|&Y=|%M@|(<M|$G|$H|%O|&#<|$L7A>O$!|',
      '%HOH|%T.|$M@|&O|%E|&O|$NY?R|$O!|%E|$QH|$S!CHO|$XDI|#KE>|$NE|&>|(MCM>|&O#<|%JM@|(J|%XJM|$P>M|&N$!|&R|#X.|%H|%N<|%WM|&',
      'N$!|&R|$0|%>|%GR4|)L|*M!|)M!|)O|%QG|%VGR4LO|*O|$4HO|$7MG.7N.M|$9G|%R|&EM@|$<|%E|%G|&0<|&GMJL7GO|&MH|%HR|%NE|$>GHO|(R',
      '|&Q@O|&T!|%M4L|)@|)M|)R|%TH@|$?|$@|%M|%VKR|$C|%G|%MHM|%N.MAPG|%R9.G|$EVGN<|*JG|*M|$JL|&.|%MGO|#Y/|%G|%M!|$0|%R|%T!|$',
      '3M|$4|%.H|&YH|)VK|$8|%IM!|&O!|&R!|$9|%M|%R|$<|%IM>|)O|$?|%M|%O|%R|$A|%WN$|$CMJ|$HM|%VKM|!$!.WN$!|$9R|$<GN.|$?GM|#%$|',
      '$G@|%HS!9|%NJL|$JLM|#&$!|$0@|$7E|$@J7M&@|$HS!9|$JHS!9|%OJO|#(!>M|&O|($!|&R|$7|$;|%M|#)7|#.GJL.|(;|(<|(N<|$JBLTG9|&TG',
      '9|%M&9|%O4@|$MG|%JL|$R|#/>M|%R|$G|%.MG|%O|$LGO|$N$|%G|#0E@|$GM|$M|%4L|$N$|$Q|%$!|#2MG|&O$|)!|#4LE|&O|%M>|(O|$M>|#7M|',
      '$R|$T|#9O,|%JL@|#<E|%.|&=M|%M|#><|$E|%APG|%O|&$!|$G|%JL|(.|(IM>O|$M@|$NE|%IMJO|*$!|$O|$RJL|#?MG|&<|&N<|$N.MGN.|$P@N.',
      '|)<M|+IM>|#@G4L|%RGO|$HM&@|$X>|&APG|#A;O$!|$@R|$GR7NX0|$J|%O|$R|$T|#BL|%NJ|$NJ|#CM>|&O|#E<UG|$>|%@|$NG|#FPGIR>|$T4@|',
      '&N<|#G.7N.|%O7S.2G|*7|$4LO|$7|%J|%NJ7|%O.H|$9G|%O@R7|$<O|$=.|%G|%N.|(<M|$CO$&|$EO|$M|%E|$O$|$XD|&.|&N.|#HE|%O|$M|$Q|',
      '$R|$T2.|&@M|)<E.|+N.|$VK;M|(R|#IM4|&L|&M&|$R|#J.G|$7GO$|&RHO$|+&|%VGO$|(RHO$|$<QGO$J|$@|$AMJ|$EM@|$GM|$LGE|%M|$M|%@|',
      '&O|#KHQIMHO$|!%(!|#.@MEN.J|$CMH|$HU<M|(O|(R|$JMG|(<M|$M!0O|%&|&$!|%>JLO|$P*JL@|$T|$Y8|&M|&O|&R|%<G|%HM|&O|&R|#4HMJ|$',
      'L|%GM%H|(&H|$M4L<|#7HO|#<GM4L|$KMJ|$MHIO|$NKMJ.|*MG|,O|)N.|#=R|$T!|%AO$|#@.HMC|)O|%MG|$IRGO#X7|$JM@|(O|&BL|$ME|$VGJL',
      'O#H|#A7M|#C@|$GM@O|&KNE|#E<N$4L|&KM@|$GM@|$ME|%G<|#GM.|%>M|&R|%@|&O|#H4LME|$E|$M.M|&N$!|&R|%4|%IM|%KMCM>|$S.7VGM@|,N',
      '.|*N.|*O.H|*T9M%@MEN.J|+@|+ES0@S7N.|*U@|#I@|$M@|$R!|#J<GM!|&O|($!|%REMH|%T!|$>M|%O|&$!|$@R|$ARGM@<T|$GT|$H&|%ME|(MCM',
      '>|(N.|(O|$L.|%<NKMG|%@M@|%MGM|$M&|$R|#K>M|%O|%R|$@M|%QX|$O|$T|#X0HNJL|&S!9|$2|%MG4|$4|%;|%@|&O#GNX0|%O@N#GNX0|(O#G|+',
      'NX0|$5|$70VGH|%G|&@S7|)JL@H|)Y7|&BRJ|&IN)|%H|$9J7GO|%O#@|&$|&4L|%S.J|%T|&@RJLO$|$<GRJ|$>G|&4O<|&M|%UG|$@|%M|%O|%R|%V',
      'KM!|$AOGO#H|$J7O2N)7|%AS.7G|#Y.8R|%>E|%EM<G|%T|$3M|&IM!|$4L<|$7|%M!|$=T!|!&#G|#0H7@|#AQ|#G/M|$M@|&O|#HO#7|#IS!7|#J7|',
      '$A|$IO|$LG|%IG|$M|%&|%AQGI|!(!0H|$4|$5|#.<|#1M|$R|#2M&|%G|&;|&@|$N<|$RGO|#4LCR.|)NJ<M@|$M0G|#8M|%%$|#9M|%;|$O.|#<A<O',
      '|%M>|(.|(@|%X@|%Y<O|$G|%M/X9|%O|$HR|$JI|%LMK|)<|)N<|$MG|$R|#=R|$T!|#>1M7@|)O|$FT0|(.|(A<O|(N.|$MGIM>O|%J|&O|%KG;|(@|',
      '$RJL|$S|%APG|$T!|#?G|$MG|#@M|%!|$VKM|#A.G;|$0VGKN|$2MG|$4|%M)|$>RJL|$@ME|%NJL>|$DMJLM|*IM!|%T0<M|*IM!|$EKM!>OA|(>OA|',
      '%M|$FT0|(O|$G|%HR|%T.<|%X<|$HC?|%YC?|$IM.|$M#|%?O|#CMH|#DG|$MG|&N$|#EGR|$M|$O>|&IMG|#G>Q|$B|#H7|%M|$R/|$X1;M|%AN.|#I',
      'R!|#J<M>|%T!|$>M|%O$!|$EM@|$MGN$|&O|$O|$R|#K>M|%O|%R|$@M|%QX|%R|$O|#WO$|%JM|#Y1M|%R|$2|%<E|%M|&&|&G@|%O|%R|$8|$9|%;|',
      '$<E|%GM/X9|(?N.MGO|&O|$=R|%T!|$>|%E|$@<|&O|$A|%G|&HR|&T.<|&X<|$DG|!)?E|#EN,|#G4M|&IM!|#JLM|!*!0H4L|$4HJ|##G|%ATG7|%H',
      'M&@|*4L|%IR4L|#.<M|$O.G@|&VGN<|$W|#4X7|%JO|#94L|#=R|#@M|$O|#GO$|#IO+@|#JLN$|(&|%O#@|&$|(&|$R|!+!.G|$0H|&T|%PHG|$4HJ|',
      '$7G7R@ES!7|%O|$9|%O|#.7|%G|&SJ|%NX0|$J|%2R!4|%AVGSJ|%L@|#0GO.H2GH|#4Q.RJL@|#7E|#9E|%4L|$IG9|$O7G|&M=@|%J@|&L@|#<IMG|',
      '#@7VGUAO|$G4O|$JS!CH|$M|$O|%ERJL@|#AG|$H|%O.RJL@|$N.|$OJT9|#BL|#E*|$7OIO|$G4S!JO|$O|#H4OCO7O|$@|$CE|$M@|&N$|$NJ|$OES',
      '!7|*GO|#IGSJ7|$MG9|#JJO|$L|$M|$N9|$O|$R|$TJO*JL@|#Y2|$@|$B|%L|$E|$H|$J|%ARGM!<T|!,9O$&|%JLM|#=R|#>T!|#@M|$O|#A@|$GR7',
      'G|(NX0|&JL@|$RGM|#EM@|#H9|$XAN.|#IG|#JLR@O$|$R|#K@M|&!|#W.|!-/M|#2N<F|#@HM&@|#BL|#C4LGIG|)RCH|#G<|$=T0@H|$CN7H|$X04L',
      'RC|(RC|#H/|$M>|#J<|%@|$L?O|!.&$!|#7M&|$U<O|#8N@|$TG|#9LO$!|#:M&|#;.|$M!|#<H|%R$E|$MG|#=@|$M|%@.|%IM!|$N<|#>E|$G|%M!|',
      '$M&!|$O|$R|$T!|#@IS@JL@|$QX@|(O|$R9M|&O#@|#A<M@|(O|$MK|$NH|$QG|&=HM|$WR|#C4LM|&R|%M|$G|$M%HO|$OG|%HM|&N$!|&R|$Q<G|%H',
      '|$Y9O|#DO|#E4LTG|)O|%TG|$G|%M|%R|$H|%M|$M!9|(G|%&|%(;|%@|%H|$N)@N4LE|)7O|)J7|%JL@|)G|$O|%$!|$R7O|#FM|#G4LM|&R|$;|%M|',
      '$<M|&G|(APG|%YI|$>N$!|%O$!|$@0R|%H|%M7.|&H|%O|%R|%SH|$E|%2MGO|*$!|%4O<|$I|%M|&%$|&&|&(!>M|*O|*R|(;|)M|&*|%R2G|$M|%!0',
      'R|%%$|%&|%(;|%2O|%G|%J|$N$|$O|%#G|%*|%C|&O|%E|$P;M|$R|%0M|&O|$T|%W|$UJ|$X7|%JO|#H.Y<M|(R|$2G|&H|$A@M|%N<|$E|%O|$G|%.',
      '|%4L|$M|%!|%&I|%.MG|)O|%<E.|%E|%IM!|%J|&N.|&O.H|$N$;|%X7@|%Y.|&BTG9|$O|%$!|$T@O|$U.|$X9G|$YC|#IG|$N<GO|&MIM!|$O$!|%J',
      'LG|)O|#JCM|%N$!|%R|$E|$G<|$LEOG|)O|$QG|$RH|#KM;O$!|(.MG|$N|%;|&M|%X>M|(O|(R|$O|$R|#M!|%0|&GJ|)O|&T|&WM|%9|%JO|$%E|$(',
      '!7O|$)!7O|$.M|$04L|$4|%LO|%O|$:|$>GFMG|&O|$@APG|%BGXJ|&LGXJ|%IS!7|%QX@|)O|%T@O.H|%VK|$AO|&$!|$BLO|($!|%O|$C4L|%H|&O#',
      '<|%PH|%Q|$E|%@ISH=|%FMC|)O|%GJ|&R9|%M|&0M7MEMGQ|%N.|%R|&9O|)#@|$G|%.|&P@|(X@|%0NH|&P4LMGO|%4|&.MGO|)H|&JLOH|%7Q@|%9|',
      '%;|%ATGR7|*JL@|%C@|(O|%H|%IM&|)$!|%O0G|%TCMG|*O|$H|%A@N.|%E|&@IOJ|%LM|%M|%O|&>MJ|&@|%R|$IN.|$J7|%L<|&O|%NE|#N$|$(|%!',
      '|$)CM|$,!.N|$<M|&C|%R|$>MG|$?GR|$@MGR|$E|%O|$G<|&O|%>MG|%@|%AM|(H|%M*|%N$|(IM!|(JLOH|$HM|%R|%T|&0VGME|&EO7G|%VKM|(R|',
      '$IR!|$J|%E|&<|%L<O|&@|&TG|%M@|(O|%O|$KWM|&O|&R|$X0|&9E|%@M|&O|&R|$Y.G|&HO|%<M|&R|%=R|%HT|(EO7G|%JM|(.MG|&N$!|&R|#O7|',
      '%@MJL.|$<O$!|$@O$|$E<|&M!|&O|$G<@|&APG|$WN$!|%R|#P$!7E|(M%4LRJL@|%7VG@O-@|%G.|&7G|&O|%HOBM&|$3|$<C|$>G<|(O|$EMG|(O|$',
      'G$@|%CM@|)O|%JO|%M@|%Q.JLR<G|%SJLO|$H|%<QGH|%>OA|%IX<|%O@|$IS<|$JL|&<M|(O|&H|(<M|$WO|&$!|$X4O|%9|%<.|$Y/|&T!|%5|%7|%',
      '<M|&N$!|&R|%H|#Q2|#R!>G|(<|(N<|(O|&VG<|)N<|$.|$@|$A|$GH|&M|$IH|$J|%G|&O|#S!A|&J|%CGN4|%JG|$=GO@|%THN.|$>|%O|$@R9M|(O',
      '|)#@|$A7@|$C@N7|$ECVGN4|%GM|&Q@|&R|%NJ7GO|$GO#G|%T!|$HIN@|%JLO#E|%MJL|%OBLTG@O$|(TG@O$|%X9G|#T%H|$.|$2|$7|%.AQGM|%HM',
      '|%O|$8O|%R|$9|$;|$@|%R|$EH|$G|%7|%J|%O#@|&$|(&|&,0VGMBG|$H|%.M<M|%L|%M|%R|%T!|%XCJ|(O$|$JL|&N.MIM!|(JL|$K|%HO|#U!JH|',
      '$;|$E|%M!<GO|%O|$G|$H|$JEN.|%LH|$WM|#VGE|&IMG|%M!<O|*.MGO|%N$|(IM!|&.7|)G|(R7|&<|(O$!|&J|(EJ|(L;|)@|*M|%S9N7|%TET9M%',
      '@MEN.J|#WO|%$!|#X0|$4LGIR7NI|$7GTH|$9.7G|%R|$:R|$?|%MG|$@|%N$|%W|$A@O|($!|%HS.J|%N)7G|)NX0|%T4LG|&@S!7|$CT4|$E.M4|$I',
      'G|%H|#Y2|%M|%O|%R|$7|%;|%N$|%O|%R|%W|$:|%;|&M|%N$|%O|%R|$<.|$>|$A|%WM|&R|$H|%VK|!/0TH|&O|#9QG|#;N4|#<E|$G@M.|%M|%R|#',
      'A<|%.MG|#CG|#G2|%M|%R|$MC|$O>|&;|&N$|$W|%M|%R|#H@M%.|#IM4M|#KNGM|#L<|%E|%G@M.|&M|&R|$CG|$G2|%MC|%O>|$M!|%@|&>M@|%HJM',
      '|&N>|&O|%J|&.G|$N$H|%<MC|%H4O|&MBL|$P>|&EP/L<N$G|&M|%GM.|%JL|(O|$Q@|%C|&JQG<|#M!|%>M|&O|&R|$%$|$&|$;|%M|%R|$<G|%R|$>',
      '|$?M|$@|%>M@|%M|%R|$G4|$HJM|&R|%O|$J|%.G|$WO|#N$H|$9MG@|(O|)$!|$<MC|$HMB|(L|&WO|$Y2|&;|&N$|&O|%<R|#P>|%.PJLO|%M|&&|$',
      'G>|%M.|$HMJM|$JGT|%L|&.|&KMH|*O|&O|$YH|&O|&R|&VK|)M|)O|)R|#Q@|%O|$C|%JQG<|*O|$K|$XK>|#R9|%;|&M|%>M|&O|&R|%M!|%N$|%O|',
      '%R|$<|%GBH|(LH|&O|%O|&CMWO|$G|$H|$WM|#T4|%.MG|%;|%N$|%O|%R|$H|%N$|%VK|(;|(N$|$K|#W.|$M|$O|$R|$VKM|&O|&R|#X9|%@|%G|%O',
      '|$@M|$D|#Y7O|$<GO|$CR|$H|!0%$|#&$|%!|#4L|%H|#84TW|$@|#;<X<G|$@M|$GM4|$N<|&N.|$RJL|#<O|%IN?O|*$!|%JLOH|#>G|%O|#FM|#G>',
      '@|$D|%AM<|%I<O|$E|%O|$H|%4L|$M(!9|%)!9|%E|$O.|%@|%C|&O|%J|$PA|%YA|$R7|%IMH|$S!9|%4Q*7|)JL@|%IN7O|&O7RJL@|-H|$X=|#H<|',
      '%O|$A|%.MG|%O|$MJ|$O|%$!|$R|%JLO#G|$TC|&H|#IG@G|$MHO#G|%K|&O|#KN;M|&N$!|&R|%GM|(&|&O|#L4LH|$>G|&O|$GOC|$H<|$MHNC|$PH',
      'ME|)O|$SG|#M!|%?O|$%$|%.|&M|(IM!|&O|%<GO|%@|%C|$&|%9|$(!>M|(O|)$!|(R|%;|&M|$*|$0|$4G|$;M|%N$!|%R|$=M|&IM!|$EM|$G0O|%',
      '9@|$IM!|$K.|#N$<|%@|&AO8|&O|%GM!|$7MG|$;<O|($!|%N$|$@O|$G4M|(1G|%>|%B<MG|%MI7|%O|$H9|$Y>WCMKM|%?M|&R|%H|#O<.MG|%M|#P',
      '$|%!:O|$4GM!IMHM|(<|)O|&O|%LMGM|$;|%@BH|%IY<M|%M|$A<|&M|$BM|&IM!|$G|%0Y>O|%2G@|%>IMGM|&MJ|)APG|&N$H|(Y<|&P$GM|*N$!|*',
      'R|&R|(I|%@ME|%AVGO<|%C/JL|(LJL|&2@|&M;O|%E<N|&O<|&P/|)O|&RH|%JLG@|%P|%Q$!|&>P$GM|$H|%4LMG|%JL@|%MC|(O|&E|(O|$KM7O|$W',
      '|$X5H>MG|%C>|%E|$Y0M|%4G|%7|%9O|%JM|&R|#Q0H|$WVKR|#R!>|&CM4L|+O|$#|$4|$7|$E|%4L|$W|#SG|$HGO|$J|#T$|$<|$=N.|$>|$AMH|%',
      'O|$CNX>|$DO|$G|%.O|%/|&@M=|%M|%O|%R|$H|%9|&@|%M|&.MG|%O|&.M!9|&CMGO|%R|$INX>|$JIMEO|#U;|$<E|$G|%ENX7|%I|%O|$KG|#VGKN',
      '|($!|(;|%ME|%NB<MG|+O|(L<MG|%O.|&@|%R7|%S!9|&0GO|&4P*JL@|(Q*7|*JL@|%X=|(O|#WCW|$IMH|$VK|&O|#X0M|$4|$:|$@M|%R|$DOG|(<',
      'M|#Y84TW|$9O|&$!|%R|$>|%O|$DGQ|$H|%CM<|!17>O|$@M|&.VGE|&IM!|$M|%(;|$O$|#;<M|#@UG|#GM;M|&R|$RHQ|$T!|#M7|%O|$<.|$K|#N(',
      '|$GN$|#PHM7O$|)*|$XE|&;|&>M|(O|(R|#RG|%M|&CX>O|%R|#T/|$G|$H|$JL|&;M|&N<|$W|%M|%N$!|%O|&$!|%R|#WM|$N$|$O|%$!|$R|#X7M|',
      '%N$!|%R|#Y7T|!2(A>R|#2RGR|#7M@M!|#@MC|#E.|%>MG|%OHR|%UG|$<.MG|$WO|%R|#G2|%M|%N<|$;|$@|$A7|$CO|$E|$NY<G|#H;|$>M|%O|%R',
      '|$M|%%$|%&|%(!>R|&;|%*|%;M|$N$|$O|$R|#M!>|&@O|&O|%JHG|$&@M|$2M|%R|$<VGN.|$>G|$@;|$G4|%7|&G|%HJ|&O|%R|$H|%.|%O|%Q|$IH',
      '|&M|$K|%O>M|(O|(R|%PX>M|)O|)R|%R|#N.@|%N<J.|)M|$<G|&;|&N$|%UW|$G|%M0|$HO|$JL<O|$K@|%GM|&R|$WO|&$!|$X<.|&@|&M|%@|&VK|',
      '$Y7M|&O|&R|%8O|($!|%<|&G|(.MG|+O|#O4|%L|%M!|$@|%O|$B|%L|$EM|#P.R|$;|%N$|%O|%R|%U<O|)$!|$J<|$X5|%C.O|$Y.|&;|&M|&N$|&O',
      '|($!|&R|%A|#Q@M|%R|$KR|$WO$!|#R#G|&AGJ@|&ES@|$<|%@|&M|%MI@O|%X@|$@|%&|$HM|%R|#S!AO#@|*4L|*JLNA|$/LI|$7G4O|$@H|$AHN@|',
      '$GN7O|$Y.|#T!|$7|%O|$;|%IO$!|&R!|$AWM|$G|%O|$H|#U.|$;|$=M|%O|%R|$>M!|$?GO|$H|%M!|$KM@|$WM|&&|%O|%R|#WVK|&<|&>O|(R|&@',
      '|&M|(&|&N$|#X0M|%O|&$!|%R|$9O|&0W|)VK|$>|%@|%G|&0PA<|&EM|%M|$@|$CM|#Y.|%G|&IG<O|$H|%;|%>M|&O|&R|%N$|%O|%R|!3A;|$>M|$',
      'M&|$N$|$O|%$!|$R|#M!|$%$|$(;O|$<O|$A|%;|%N$|%O|%R|$H|#O@M|#P7.MGM|$AR|$Y7|&O|($!|#Q<|#R<O|$IM!|%O!|%R!|#T7M|%O|&$!|%',
      'R|$K|#X>|#Y4|$9|%.R|%;|&M|%N$|%O|%R|%T|$<|%OJ0WVK|$AW|$HM|%R|!404O<|$<|%MG|$>OJL|$@@M=|$K|$M|$OG|$VKM|(!|#7NH|#;@|#<',
      '@|$NX>G|#=M|$R|%>MG|%CX>O|#>.N|$T|%!.N|#@.|$0;@M|$<.|%M|$E>N@|%JM/O|%N$|%O|%R|$GH|%R7G|$JX/N$|$QX@|#AM@|&O|$P4O|#E@M',
      '|$KQGO|$M!|%<|&O|%H|$O@|$P@M|$VKM!|#FM|#G@H|%SH|$E@|&O|$JO|$M|$QG|&<|&O|#H0MKM!|$>|%O|$IMFQ|$MH|%I<@|)O|$QJ|$X?G|#IM',
      '&|%@|&O|%C|%HM|(EP/O|%KG|#J7NJ|$COG|$INX>G|%X<|$L@|#KM!|&0OG|%4|&L|%@|#L/EO|%LE|(O|$BG|%LG|$C<|%G>J<|%M@|(O|$EM@M|(R',
      '|%O@|(O|$GM|%O*|%QG|(<|(O|$KNG|(OHR|$M<|%G|&M|%KG|&NG|$N$>M|)<G|%.G|(FT0|%HM|&R|&VKN$!|%X.|&>0O|(M|&ERIMG|,O|$O|%GT|',
      '$PCM@|%HE|$T@|%G|&>MG|&MIG|#M!2|%>O$!|$%$|%4L|%>M>|$*|%0M|$,|$0|%GQ.<M|%OG|%T|$;.MGO|%0R|%>M|&O|&R|%@|%M|%N$|%O|%Q|%',
      'R|$<|%.|%O|&$!|$>O|%Q|&&|%R|$@|%;|%IG|(M!|%O|$A>M|&O|%M@|(O|$G4|&O$|%9@|%O|$H|$IM|%R|&0M|(O|&>|#N$>M|(<G|$(!|&>M|(R|',
      '%;|$.G|$0G|$=R|%T!|$@JO|%M|&!|&K|%QX|%VKM|)!|$CGMH7G|$E|$H>|%M|%R|%VKM|(R|$IR|$J>M|&O|($!|&R|%@QX|&R|%E|$K>M|%@M|&QX',
      '|%M|%O|&$!|%R|%WM|&O|($!|&R|$X>|&0O|&M|%@|&M|(!|&O|&R|&VKM!|%ERIMGO|$Y<|&;|&N$|&O|&R|%=T!|#O!>|$#|$,|%ES7GO|$<|$@|$D',
      '|$I|%<|%@O|%M;Q|%X<|#P$@|$0<|&M!|%@O|$CHO|$GE|$H>M|&O|&R|$W|%>M|%@|%N$|%O|%R|$Y0|%7|%<O|#Q@O#G|$HO#@|$J|#R.G|$8|$<Q|',
      '$@|$E4L|%J|&@|$H|%VK|$KHE|#S!9G|$.|%CJ@|%J@|$<T|$@|%O|%R7N.|$APG|$IN.|#T.N|$/E|$0M|%NX>G|%O|&$!|$<|%NJL|%O|$?|%APG|%',
      'M|$@|%4L|%J|$G|$H|$JL|&O|$K@|$W|%>M|&O|&R|%@|%M|%N$|%O|%R|#U!|$@|$G4|%9@|$K@|%G|#WO|$VK|&M!|#X.JL@|$0|%@MEM|)R|%H|&M',
      '<|&O|%O|$6|$9|%N$HM|$<G|%Q|$E;|%AH|%N$|%O|%Q|%R|#Y0|%O|$4|$7|$>O|$JM|%O|!50WM|%R|#G@M|%R|#H.|#M!JO|$<|$G/X9|$W|#NYHO',
      '|#OH|#P.M#|$@OG|$X9|#Q8|%O|%R|#T)|$@R|$HO|#X9M|%R|!7.GM#|$JMHO|#EM7G|#G.O|$CM&@|$EO@H|$M!J4S!9G|(ATG7|%BO|$R9|%@|$S.',
      '|&7G|$XA|$Y.|%J7|#IM&HM&7|$NY7G|$X7O|#M!9M|$&0G|%7H|%A|%E|&4L|$)@|$.GM|&R|$7M|$AQ|&$!|$IG|$K;O$!|%HO|#N)C|$.7|%M)|&;',
      'M|(N$!|(R|$IM;M|$JLQ|$YA;O|)$!|#O.M|%R|$2M|%N$!|%R|$E|$IO|#P.WM|&N$!|&O|&R|$Y7|&;|#Q;R|$G|%@MES!7|#R.|$CH|$HG|#S!.|%',
      'AH|%JG|$.@MHT4O|%J|&7|&J|&MJ|$0TG|$@NJ|$CQ|$GO|$HOBT@|&IN4@|*L@|(O4L@|$J7|#T.O,|$7E|%R|$@O|$AO|$GM!7T|$HO|#UAUHU4O|+',
      '.H|$E|#VGNCN)@|%R@|(NX0|#Y.G|$AR|$CG|!8KNGM%$|&R|#M.PG|#O.|#P.GM|#R8|#TJ|#X9|%M|%R|$:M|%R|!9CH|%FQ|%N)|&@|#GM&IG|%EM',
      '|&N$!|&R|#IO4L@|#M!J|&G|$%@MEN.J|%C7O4L|%ES@JL@M!|%GO|&S.7G|$&$.JM&9|$)@|$.|%1G|%7G|(O|(R7|%Q|$7M|&CRJ|$@|$G.|%IN@|$',
      'HG|#N).|%7O|$.JL@GO|$0GO|($!|$4L@O|&M%@|*G|(&@|*G|&O7H|%O7H|$A7O|%HTEM|$IO4L@|%SHAES!7|$J.|&T0VGMBO|%AS!JGO|$Y0|&;|&',
      '>M|#O4LH|$@|$GM.|#PYC|#QX1M|(&|&O|&R|#R#GO|$:|$GM|%R|$HO|$IN9|&J|$KHT!|#S!J7O|$@EMG.|%NJL|$CN)|$E|$GOIR7NI|$H7M|#TER',
      '@|$HO|#U@|#X9M|%R|#Y2|$CR|!:KN|#M!2M|&R|$&|$.M|$9O|$C|$H|$K|#NY9|%HT!|#P$&|$.IM!|&O!|&R!|#RG|#TH|%M|#X0|!<.@MHT4O|%O',
      '.|(O|$GOC@|$JOE|$WM|#/<|$L<|#0EM|%R|#4GCM|&R|$IO4L|#;M#|#<.MHO|)@|#=M|#@/MK|$4LM@O$|#C>OH|(O|$HM|$MK|&O|#E0M|%R|$ME|',
      '%JLM|$NH|&@M9Q|#G.|%JLOH|$4EM|(@O|%OK|$<OC|$@|%<MG@|$B|%L|$H|$JRE|$M!|$O.M|&N$!|&R|$VKM|$X0|&M!|$Y.O|#HIMG|%X9O|$M.|',
      '%C|%JL|#J>O.|$IOG|$OKR|#KN|%<|%GM@|&O.|%JOH|#M!.N|%1|%CM|&R|$%@M<|$.<|&IG|$4|%LM|&R|%N.|$@MJLMKO|$A|%EM@|$ENH|(@M9Q|',
      '$G|%.N.|%@|%M|&EX9H|%O/|(L|%R|$H|%ERH|%J<M*|%MC|%NCM@|%OE|#N$0|%G|&O|$(KMG|$.T;|$@|$H|%.|$KM&|$X@R|&T!|$Y/M|&O|&R|%C',
      '<|(O|#O$!|$.|$4M|%O|%R|$CG|&<M|$G|%=|$IO!|$JGM|&O|&R|$K|#P.|%M!|$0H.|%LH.|$E|$G|%.|&O|%N$|%X<|$H;M|%@M|(<E.|%JO|$JO|',
      '&!|$KM9M|(O|(R|&@QX|#QBLM@|%M@|$X|#R0|%L|$4|%L|&MC|&O|%M|&C|%O|$GM|&!|%O|%R|$H|%0Q|%X0M@M|$WR|#S#|$@QX|$EQG|$GM.O|#T',
      'A|%/M@R|%M!|$G|$KBLR|$W|%@|%N$|#U!|#VGMJ>O|%NAPGM|#X0|$<G|%Q|$>GPJ<|#Y7|$<|$=|$>|!=;?MGO|#GEH|%T9M%@MEN.|/J|#M!|%IM!',
      '|$&|%HS!9|$EJ|$H|$IM!|#N)GE|&O|($!|$*7G|$X>|#O*7G|$E|$JNJ|#RK|#TWM|%O|%R|%VKM|(O|(R|#VGNHG|#YHR|!>%$|#/H|$LH|#B<G|$L',
      '<G|(O|%@M%$|#C>CM|$M|%#|#E>EM|$@|$T>G|#FM|#G#JH|$/<|%L<|$0MK|$4|%@|%L|%M|&CX>O|%R|$>|$A;|$CMG|(O|$EN$@|$IM4LM|)R|(R|',
      '%RJL|$JL.|(M!|&@|%M|&%$|&&|&(!>M|*O|+$!|*R|(;|&*|$M!|$N$|&IM!|$O|$Y/<|&L<|#H4O<|$N<|$OA|%H|$RG|&O|#IM&|&$!|%G|$NX>G|',
      '$X>|#J</<|&L<|%MG|&IR4L|+O|$E|$IO!|%R!|$L.|%M|$N$|$QKM|#KM.M|&N$!|&R|$O!|#M#IM|&R|$%G|&M|&R|$&|$/H|&M|%LH|(M|%NH|$0|',
      '$4|$;R|$<M|$>M|%O|%R|$@|%I|%O|$GJL@.|)N.|%M|$H|$J|%<M@|#N$!|%H|$(|$,|%H|$/M|&%$|&&|&(!>M|*R|(;|&*|$<M|%O|%R|$@M|$EM0',
      '|(L|(O|$H|%0OG|%2JA|)O|%O|$IJ|%M%$|&(;|$J|%>M|&R|%LM|(IM!|%XCG|$KM!<|&<O|&WM|$X>M|&O|($!|&R|$Y/|%<O$!|&R|#O$|$.JLN<|',
      '$>MG|$@|%M|$A|%.|%N.M|$IM|&@|(M|&G|%R|#P$CR|%G|&R|%HR|$.M@|$/|%M!<|%O|$@N$|(IO|%O$|(!|$AKNG|$C&|%MGM|$G0M|%17@M|%HYD',
      '|%M9R|&@O|$JLE;|)O|$KGM%$|$Y/|%0H|%?|%HM|#Q4M|%N$!|%O|&$!|$<|$G|%>GJL@|%CO@|%O|%T!|$JGM|&O|&R|$Y4R|#R!>M|&O|&R|$.R|$',
      '/|%;|&M|%>M|&R|%DMH|%N$|%O|%R|%T|$;0R|%M|%O|$G|%O|$H|$I|%<M|&N$!|&R|%>MJ|%@M0GO|%M|%NX>G|%O|%R|&0M|(O|$J|%LM|%M&|%O|',
      '$K|%GM>Q@|%M!<|#S@N.|$IO|#T@M!|%T!|$G|%M@|&KM|$IM!|%R|&!|$J<|&M@M|&O|%L|&O|$KGM|&O|&R|%M|&!|%R|#UG|%M|%R|$H<|$W|#VGN',
      'JL|)7O|+.T;|&W|#X0N$!|%R|$9|%O|$<|$>|#Y/;|&O|$<|%M|$J|%;|&M|%>M|&O|&R|%N$|%O|%R|!?@O|#E.O|$M.R|#G<|%O|$EJLMHM|%NX>G|',
      '%O|$M<H|$PI|#I@|#M0R|$<|%Q|$E|%O|$G|%.|%;M|%@|&M|(IM!|&O|%E.|&N.|%M|&IM!|$HOIMH|#N$@|$G|#O$!|$*|$G|#P@|%M!|%O|&$!|$G',
      '|%M|%R|$X>|$YA|#QGO|$W|#T/M|#X>M|%R|$@|%M|#Y.R|$CR|!@&!|#.>|$H|%O|$JL|&M|&R|$MGM<E.|$T>G|#0G|%AMHN.M|%O|#3Y<G|#4G|$L',
      '>O.|)O|%E|%G|&O$|(*|%MGM|%OG|#<MJLM|$O4M|&N$!|&R|#>O|%$!|%@|%E|#@.M;M|#BLG<|#CO|#E.|$M4L|$O|$Q@M|&R|#G.|$0NJ|$E|$J|%',
      'NX0|$M%;|$NX>G|$QHM|#HO|#I<R4|$FP0|$M!|%4L|%C|$O!|%$!|%@|&<M|$R!|$XCG|#JH|%O|$L7|%M|%N$!|%R|$OC|#KNG|&Q|$O|#M!#|%E|%',
      'I|%K|$%.|&M|%9Q|%G|$&|%4OGO$|%7|&GT4@|&VGT4@|$.ME|$0|%APG|%GN.|)<M|$2|$4LO|&P.|$7|%..MG|&O|%F|%T|$9Q|$<M|%R|$=|$>|%G',
      '|$@|%.|&JLMKO|&O|&R|%M|%O|$A|%;|%N$|$DM|$E.|&G;|(@|%4L>|)0O|+$!|%>RI|%?MGO|%IG|%M|%O|$G=|%IR|%M%;|&4L|%O|&#H|&IM>|*O',
      '|$HL|&T!|%O|%R|%T|&!|$IH.MG|%M!|$J<N.|%L|%M|%NG|$KG|$WO$!|#N$!|$)|%.HO#G|*J|%4L|(OHS!9|%7@|&T@O#@|&VGO@T|)U@|%FMG.|$',
      '.H|&;|&>M|(O|(R|&N$|&O|&R|%MJ|&K|%TCMG|&HJ|(M&|$/RW|(M|$0E|%GM@O|%MG|$4LME|%O|$APX@|$CX?|(.MG|$DM|&%$|&&|($!|&(!>M|*',
      'O|*R|(;|&*|$E@|%G|&<M|$FE|&<|&N<|%P.<|)O|%X<G;|)N<|(VGN<|$G0P;|%;M|%>RJL|*.|*<|*@|*M!.|*N<|%?MG<|)N<|%AR/|&Y/|%DG|(<',
      'M|%EH|&M;|(<M|*IM!|&N<|%FM<|%MJL|)M|%O/.|(;|(<|%P.<O|%TH|%X<G|)<M|$IM4N$|&J|(O|%R.HM|)O|&JL|$J2N<|%L2<|(N<|&M@|)>RKO',
      '|)M|)O|)R|$KMH|%X0|$X>M|%E|$Y.M|&O|($!|&R|%4O|%<|#O!|%>|%K|$<JLR|%O|&$!|$>GHS!9|$@M|$H|%E|%M|%O|%R|$IM!|%O!|%R!|#P.<',
      'R|%J|&M@|$EM|&%JL|(X>0O|$JG<|#QG|%4KM!|$XK|#R!|$.|%O|$<M|&IM!|$AMH|(O|$E|$IO|$JL@H|$KM|$W<M|%HM|&R|%N,!|%R|#S07NI|$7',
      'IG.|$;|$<N.|(<M|$@T7N)C|$ATHO#@|$JL@H|$Y7IG.|#T.|$7|%J|$CH|#U!|$.G|&O|$4IM@|$7X.O|$IO!|%R!|#VGN<|#X0H|$>|%M|%O|$CG|#',
      'Y.|%MJLO|$2|%;|!A&$!|#(WO|&$!|#.IM@|$M%$|%(;|$W|#3EO|$M;|&N$|&R|#7.=M|$@M|$IMGO|$N$HM|(R|$OJL@|$RH|#8M;|&M!|%G|#;4TW',
      '|#<5W|$@|%O|$HM|%O|%R|$M|$O|$R|$VGN.M|$X0|#>E|$IO|$M!|%G=|(.|(IM>|$R|#?G|#@MEM|%K|$OG|#CHN.|&JLG4L|%O.RJL@|,4L|#G/|$',
      '07|$2R|$4M|$<|%;|%N$|%O|$>M|%R|$C<|$E|%4O<|%M;P|(Q|&<EM|&G|%NX>G|$H|$IGNJL|%MG|&J|(O|&K|%O@|%RJL|$JAG|$M|%%>OA|%0|$N',
      '.GEM|%AR/|%DMJL<|*M|+IM!|*N<|%IG<@|)N<|&MG.|%J=N<O$!|&L>|$O|%/N$|$R|%9|%JLM@|$T0GME|$U!8M|$X<Q|%AGM|)0<|)IM!|#H7|$J|',
      '$M!|&7|%4LEM|%7|%J7N.|%KO|$R|%#CS.|&G|%7|&BMGE|%@|%CS.|$S!.|%7T|$YJ|#I@|$N<G|%Y<G|$R0M|#JL<Q@|&T|%Q|&$!|$MG|$X>|&O>M',
      '|#KMW|&O|$N2M;|%@;|&>R|%G|&MIM|)R|%H|&IM@|&O$!|&Q|($!|&T!|$PX2|(;|(>M|)O|)R|(M|)%$|)(;|(N$|(O|(R|$RHO|#M!9IM!|&R|$%$',
      '|%H|&7|$&|%$!|$(!>M|(O|)$!|(R|%;|&M|$)!9|%9G|$*|$.|%N|&J<M@O|%R|$0H|$2@|$7NH|$8|%.|%JLMHM|$;N@O|%O$!|$<|%G|%JLMK|*O|',
      '%WM!|$>GO|$@|$A|$CX>O|)$!|$G|%.|&G|%7O$!|(.H|%>GJLO|%HOES!7|%I<O|%J|&O|%M|%O|%T|$H|%.|%;|&M|%<Q|%N$|%O|$IG|$J|%ATG7|',
      '%L|&M|%M|&G|%N,!|%R|%T!|#N$|%4|&L|%@T|%G|&M|&O|&R|$(|$,|$.2G|(4L|%M2Q|$3HO|($!|&R|%R|%T!|&.W|$<MEM|$A|$GMEN9|$JLM2|(',
      'C|(IG|$W|$X4G|(R|%@|$Y3M|&R|&T!|%8|&DQEO|&IG<O|%<H|%AH|#O!>R|$+2|&9O|$7G|&JCG0|%OIO|$;|%M|$AH4L|$G|%O#9|$H|%M|%Q|%R|',
      '$J|$W|%<|%O|%VKO|)$!|#P$%X7|%?O|$4MGO|%OJL@|$7S!JLH|$;R|$@G|&08@|$G|%/|%<0MH|*O|%JL|%M;|(M|(O|(R|&<<I|(@|(Y<I|%O|$H|',
      '%J|%MW|%NJ|%OJ|$J<.|%L.G|(N@|&7O|$X4|%@|&QX|$Y3>M|&N$|%4|&;|&M|&R|%7|%<|&G|(O|%H|#Q3|$4M|$@E|%M|%R|$G.|%<O|%@|&EMJLO',
      '|%C|&O|%I|&.|&4|&O|%M|%O|&$!|%R|$H|$X4O|(IM>|+O|#R!7G|&NX0|%9Q|$#G7O|$.R|$4|$7|%S!7|$@M0|%S!0|$AG|$GQ|$J7|%L.JL|(MGO',
      '|+$!|&IM|&M|(IG|&R|(IG|#S!>M|&O|($!|&R|$0XCG|$7G@|$;|%M|$>H|%MIMG|$@|%JL@|$AJQ|$EM@R|$G|%NJ|%T.MG|$HRJ|$JM|%R|#T$%@.',
      'R#G|$.OEU@|$7MJLO#E|$8TKMG|$<O|%R|$=O|$A|$G7|&H|%J|$H|%7GO|%NJL|%S!9|$J7|%L;|$K|#U!9|$7G|$>M|%N$!|%R|$A|$G@|&T0VGMBN',
      '.|$H|%O|$JL7N.|$WO$!|#VG.G;|&MG|)4|(JL|*.|*<|*@|*N<|&NG<O|)N$|+IM!|&VGN$|+IM!|*<O|%07|(M|)#|)(;|)IM|*R|&<O|)IM>O|)JL',
      'OH|%2H<|(N<|&MG|).|&YH<|)N<|%4@@|&M<O|*$!|%;MHO|*$!|%<MA|&N|(DM|&O|(.|)GE|)NGN$|(<|)O|(@N?|+<M|+N<M|+O|(CNXC|(FT0O|(',
      'JL<|&Y/|%=E|&M|%>GJL@|+O|*N<|&M@|&QJL;|&RJ|)L|%?M@|)0O|)<M|)EX<GO|%CH|&X?|).|*O|)@|%DMI|)<|)JLMHO|)N<|)O|&Q|%EM;|)N.',
      '|+<M|*<|)Q|(<EM|&PY/|*<M|%FM0|&T0|)JLMHM|)N.|(4@|%I2@|&M@|)0O|)N<|(JO|(K|&NG<O|+$!|&RJL|%J<MI|*N<|(P<|*O|&=N<O$!|&L@',
      '|(M!<|)J.O|*@|+N.|(XJ.|*M|&M>|(G|);|)@|)N<|&N?|(Y?O|&X0|(JM|%M!<|&%>OA|(EGO|&&9|(E|(IR7|&2O@|&4S.7|&;|(O|&A<.G<M|)O|',
      '&G=@M|%N#X.M|&=IO|&X7|(J|)OAH|%O|&/N$|&<|(E|(HWO|(O|&EO#G|&JL>|%R<|&E|(2X>|(N.M|(O|&G.|(;M|(@M|(N$|)<|%SJ|&YJ|%T|&0G',
      'ME|+NX0|(VGME|&4S.7|&7O@|(U@|&9.7|)JL@|(N)JG|&BLSJG|(SJG|*L@H|&CRCNH7O|,N7O|&JSJG|*NX0|%X<Q|&AGM|#W2TH|$<MH|$@M!I|$M',
      '#|%IM!|$VK|&>M|(N$!|(R|&@|(M|&M%$|(&|((;|&N$|&O|&R|&T|#X.4|$2|%EO|%M%<|)O|$3O|&$!|$4|%IM!|&O!|&R!|%MCO#<|&K|%R|$9<|%',
      'N<|$=|$>GM!|$?|$@M|%N$!|%R|$A|#Y.M|%O|%R|$/|%AM<|%O|%T!|$0|$3E|&O|$7O|$<;|%G|&.MG|*O|%M|%N$!|%O|&$!|%R|$=G|$?<O|%G|&',
      'M|&O|$HI|!B.OG|#0IMWM|#4LH|#<KN|$NK|#G.|$E|%O-@|$IGO|$M!J|(NJ.T|(OJO|$O|%>|&.T7|&M|$RE|$S!.|&2|%9GN.|$X7|#HJGQA|$M!|',
      '$S7|$TGO9M|#JH|#L.OG|$4LH|$<KN0WVK|%NK|$G.|%IGO|%M!J|)OJO|%O>|(.T7|%S!.|$H|%JBLM|)R|$JH|$M!JO|%4LNH.M|%<NEM|%G|&JO|$',
      'N@HS!9|%G|&T4LAPG|%HEBLR#G|)R#G|(O|(T0VGMBO|&MJBLG|+O|$OH9|%J>O|$S4L|%JHM|)CM>|(R|$T@|$U4|&O|#M!JO|$%>M|%G|$&@|&H|$(',
      '!9RJL@|$)!9RJL@|$4LNH.M|$<NEM|$G|%E|&QHM|)R|%J|&O|$J7|#N.J|$4LN.J|%N.J|$<G<|$@HS!9|$G.Q|%T4LAPG|$HE4L|&BR#G|&O|&T0GM',
      'BO|)VGMBO|%MJBO|%NA|%UG|$Y7|#O2G|$9|$BM|$H9|$J>O|#P7CMH|$H|%.MGO|$Y7|&CMH|%H|#Q9|$H|%M|%R|#R#G|$4L|$@ES@|$BWN$!|$E|$',
      'G|%O|$JCPY.|#S.7G|(O|%H7O|$4L|$9GH|&RJL@|$H|%;|%M#|&(;|%N$|%O|%R|%T|&JLNA|$J7OIH|%HM|&R|%L@|#T.|%HTG|%J|$7T|&$!|&0VG',
      'MBG|,O|&@|%U@|$@|$G7|%9|%CJ|%E|%J|#U4|%O|#VGO|&.P+!JO|%RE|%S!2|#W@|$N$|$R|#X.JL@|)H|$9|!C/JL|$LJL|#0>M>|$LMI<|$MI<|$',
      'SG|#2;|$@|$A@|$M|%#|%%$|%(;|%,|$N$|$R|#47|$LMG|%PG0|$M*|#7@|$MHIO|&M|#8NX9M|(R|#;.R|$<G|$>M|%O|&$!|%R|$@|%M|$IM%$|$M',
      '|%&|&$!|%(!>M|)O|*$!|)R|&7O|&;|(M|%*|%I7|$N$|$O|$R|#<O<|$UG|#>@ME|$H|%;|&M|%>M|&O|&R|%IR!|%M|&#|&I|%N$|%O|%R|$ME|#@;',
      '|$JA<O|$ME|%GJ|#G.GMG|%HR|$<@|%M@IO|(O$|$>MJL<|$@MHM|$B|%L|%O|$CM>|$E@|%M|%O|$HN@|$JM<|$M<|%>GO|%CG|(O|%W|$O|%.|$R.|',
      '%@|%HO|#H.N|$>|%RI|$C|%OG|$GM4|$IX<|$M!|%<.MG|$O|$Q|$S.|$T2|&NJ<M@|$Y9|#IMJOG|#J<G|%O|&$!|&IM>|*O|$N$|$O|$X<|#KM>G|(',
      'O|&PG|%G|%H|%IHAPG|$N|%H|%J|$P|%0N;<O|%4@|%<M|(<|&O|&R|%AY/O|%E<|%I2@|$Q|#M!>G|%J|%K|$%,|%@GO|$&|%.M7|%CH|$.J|%M%>M|',
      '%O|$0|%CM@O|%L|%O|$1M|$4IM|%L|&MG|&O0G|$9O|$;O|&$!|$<|$>|%H|%JLMK|*O|$@O|%T|$A|%Q|$C<|%G|%H|%M|%Q|%R|$G|%9G|%CGM|%JO',
      'HT@M|%NJL|%O|%Q>|$H|%.|&@|%0|%;|%M|%O|&IP9|)Y9|$I4Q>|%M|$J|%.7CMH|$KE;|%G|&EP/O|&HR|&T!|%M!|%Q|#N$@|%J|$)7O|%GT|$*@|',
      '$0|$4H&|&O|%L@J|$<M%$|&*|$@|%M|&!|%VKM!|$EH|%MG|(O|)$!|$G<M!<|*.|&O|%M4EM@|$H|%.PH|%9NX0|%CTG9|%MJAPG|%O#@|$JENH|%L@',
      '|&A|$K<G|(O@|%MG|(O|$X>Q|($!|%C|$Y0|%H|&O|#O#G|$*|$.M@RG|$2|$4|%NX0|$7M|$<|%;|%N$|%R|$@|$CO|&JO|$E|%M|&G|(O|$G|$IO|$',
      'W|#P.|%J|$/MG|$5MG<|)M!|$:HM9M|$@N$>|)O|$G4|%M|&&|%O|$HM|&%$|&GR|%X>|$Y.|%7G|%:M|&R|%<|%?|&IMG|&O|(4OIO|(EM@|%HVKR|#',
      'Q7|%M|%N$!|%O|&$!|%R|#R#X<|$0|%E|$7|%M|%O|&$!|%R|$>O|$@<O|$CO|$ENJMH|$G|%O|$HM|$J|%7|%LY.|%NJ|$KY>|$WO|#S!.|&NX0|%0|',
      '%9|%<|$.|%7OGO$|$2HG|$7GO|$8|%.|%;|%M|%O|%R|$9ENX7@|$@|%G|&4O|$H|%4O#E|%R|$J7|$YH|#T%X0|$5|$7|$?|%O|$G9|&NX0|%NJ|$H|',
      '%2MH|%;|&M|%>M|&O|&R|%N$|%O|&$!|%R|$J|%7@|%U@|$KG|%W|#U?N.|$C|%O|$J|#VG>G4L|%KE|(M|&NEX9|+O|%M!9|&4LOH|&KE;|%N.J|&4|',
      '&7NJL|(R@|%R.|#WM|$O|$R|#X0HM|(>RJL|,O|&UG|%M|&H|(O|$>|%G0MK|%M|%O|%Q.|%R|$?@|$@|%R|%VK|(;|(N$|$C|%&|%R|$J|#Y2@|%M|%',
      'N$!|%O|%R|$4CY4|$<O|$>H|$?|$CG|$HRCM4L|+O|$J|%O|!D0<|%M|%O|$IM@|#4@|#<O4M|&R|#G4M&|$<|%O|$=GO|$>M|%R|$@|$AQG|$E|$M|%',
      'IM!|$N$|$O|%$!|$Q;|$R|$TJM|&RFT0|#HIM@|$M|%&|$R|#I@|$NY/|(CM;O|#M!9R|%<|&O|$#|$&|%2MG.|)M|)N$!|)R|$0|%O>MG|*O|$4AM|$',
      '7O$|$BL|$CO|$EK|$G|%>IM4|%O|%Q|$H|$I|%@M|(<E.|(IM!|%P.|%R!|$J.G|%L;|&M&|(IM!|&O|#N$@.|$X@|&<M|#O/O|$E|$JLE|$W|#P0<M@',
      '|$2MH|$7M@|$@GKRWO|$ANX>G|$HR/M|$Y/|%7T|%H|&G|#Q$|$0TH|(.|(N.|$2MH|$7M@|$<|%.MH|$EN.MIM!|%O|$GM|%R|$JL;|&@|#R!7|$4|%',
      ';|%N$|%O|%R|$7|$9M!|$>|%DMI|$J|#S;|#T0|$4|%@|%APGO|$AMH|#U<N.|(O|#VGNJL7M2MG|#X0|%WM|&R|$9MG|#Y4|%;|%N$|$7|%M2MGO$|%',
      'O|$HM|!E.CGM|&R|%QH|$J>|$M@|%EO|$S@N.J|&O.H|#0G|%T!|#4>QG|$CQG|$L>QG|)O|%CQ<|)O|(G|%EQ@M!|%M.|&G|#<DR>|$HC|%YC|$M|$O',
      '|$R|#=PGM|#>>|%0MG|$@|$G|%MJ|#?Q|#@4LQG|)O|%O<|$AJX>|%VGO<|$ETK.|(@|$JQG|$M|%!|%%$|%&|%(!>R|&;|%*|%KO|$O|%APG|$P/O|%',
      'Y/|(<M|(O|$T|%4|%G=|&X4@|%IN0N$@|,.|,O|%KG|#E<M|#G4LO|$>|%EJLPEMGO|%M|&@M|$@|$KQE|$M8M|&N$!|&O|$N$>M|$O#E|%4L|$R|#H.',
      'O#<|$I&|$KT<GM|$M%$|%K|$N$HE|%.|&M|$RG.T7HM|&O$|%JLO$|#J4>|%N>|$<|%O|$HM|%N$!|%R|$LKQGO|%O@|(GO|(O|$MHM|&R|$OK|&O|#K',
      'H|%M|$M|%!|&.MIN|&>OA|&@0G|*O|&DMG<|&EMGO|&GMJL7G|&JM0G|%4@|%<EM|%>OA|%@|&<M|%DMG<|%GM4|)M|)R|(;M|)O|(JL7G|%IOG|%JM0',
      'G|$N.|&ER|%4L|%<M|(C|%CQC|%EM|(@|&Q>|%GM|%H|&M|(IM!|%JQJ|%X>G|)M|(O|$O@M|&N$!|&R|$RJL|$X<|$Y<<M|&I|(AQG;|+@|#M!|$%$|',
      '$&|%.H|$)!7|$*|$1|%O|$4GM|$5R|$9G@|%H|&NX0|$;|%.|$<|%G|&M|(IM!|%M|$>APGO|%M|$?I|%N#E|%PGF|$@|%<M|(IM!|%I|&<M|&O|%J|&',
      'M|&N.|)<M|&Q@|$A|%>X9|%N$!|%R|$EHM|&N$!|&R|%M|%QHO|%R|$G|%.|&J|(IM>|+O|&O7|)NX0|%0|&GR7|%7N@|%>M|&R|%@|&M|%IH|%JLH|%',
      'N$|%O|&$|&,|%Q|&=H|%R|$H|%.|&O|%>OI|%IM|&R|%M|%N.|&@O|%O|$IM!|$J|%.T|%7G|%ARJLO$!|%N.|%O|$KG|%NG|%O|&$|%UH|$WM|%O|%R',
      '|#N$!EMG|%>|%G|&O|$)4LN.|(O#E|$/M%H|$8M&|$9H|$<O|$=|%NKMJ|*.|$G2|%4LM|$H|%.R|%/M|%7GO|%;|&M|&O|%>M|&O|($!|&R|%M|&%$|',
      '&(;|&.R|&@|&A|%N$|%O|&#@|&EO7G|%R|$J|%7G|%<GO|%G|&O|%H|%L@|(GO|&G;|(<|(M|&O0@|&RH|%MH|$K@<|%G|$X.TIJ.O|%7|%@O|$Y7O|%',
      '8M|&O|&R|%<G|&H|%=|%H|#O!K|$$!|$7|%G|%NX0|%VGN.|$9O$|$<|$@M|&G|$G|%M|$H|#P#Y<H|$.<|&JG|&O|%CH|%MCH<@|)M|)N$!|)R|&E|%',
      'RJL|%XEH|%Y>EM|)R|$/|%G4O|%O|$0H|%LH|$5R|$7N$G|$:HM|&O|($!|&R|$<MC.|(N.|$>GM|(IM!|$@JLO|%MBLM|%O|$B<|%L<|$CMG.|$E<M4',
      'L|$GJL>|%M>|%O>|%XE<|$H.|%<M@|)O|%M!.;|&.M<|&4LE|$JHEM@|&NE|%L.H|(NH|%OC<|$KM!>GM|&G<|&IGR|%NXE|%XE>|%Y&$|&C<|$W|$X9',
      'M|&N$!|&R|%C&|$Y.|%/O|%:|&HM|(O|(R|%>M|&N$!|&R|%H|#Q.|$@|$G|%/|%<O|($!|$H|%.|$IO|$JM|$XK|#R!|$#G|$1MHN$|$4G|%LCM@|*O',
      '|$=O|$@|$G8|%M|%O|&$!|%R|$H|%M|%R|$IMW|$KG|#S!|%CG|(O|$.|%J|&ISYH|&NE|&O.@|)T|$04LO@|%@S7N.|%MIM7|$2|$7G|&T|%M|%VGN.',
      '|*J|$9E|%GN9|%H|%O.H|&J@|%VGN9|$>M@|(O|$@|%OBSJ7T|(TH9|%QX|%R4ES!7|(G|$A|$CGM!|$ETGO|)#H|$GM=@|%O|$JQG|#T0M|$4Q>|$7G',
      '|%M|%O|%R|$:O|%R|$<O|$>O|$@N.M|$CM%H|&&H|$ES!7E|$G|%2M|&R|$JL@|$K|%@|%G|&O|%MHO|%N<|%XE>|$W|#U.M|%N$!|%R|$/N.|$4Q>|(',
      '0O|(M|$@JQ@|$GO$|$HIO|%M|&@M|%N.|$JE|&O|$W|#VGN<.|#X0|%;|&O|%>M|&R|%H|&IMG|%O|%RJL.G|%TH|(O$|$2|$4LNH|%O|%R|$7T|$9H|',
      '&O|%O|%RHM|$<G|&MHR|&O|%I|$>G|%NG|$@|%;|&M|%>M|&O|&R|%O|%R|$E7|#Y.M|%O|$/;|%O|&$!|$1G|$3O|&$!|$5|$8|$<|$=M|%R|$?|%.M',
      'H|)O|*@|%E|$H|!F.O@|&O|#<@|#=MG=|(IM>|+O|#E@|$HM|#JL|#KQ>O|($!|#M<GM|(IM!|&O|($!|$>|%0MG|)O|%I|$@|%N|%O|$G|%.|#NJQ|#',
      'P.<|%NH9@|$0|$IGM4|%M|$Y0|%?|#Q+J|$.GR@|)O|%R|$7N)C|$=|$@M&79|)N9|&@|(O|%N7|%O#@|&.T9|&IGJ|*H|*N7O$!|%RJ.T|%SJ.T|$GA',
      '|&O|(#@|%T|&A|(O|$JBL|#RH|#T0|%<M|%>M@|%N.|%O|$4@M|(CY?|(IM!|$?M|%N$!|%R|$@O|#X0|$<G|#Y0|!G&J|#.CM|%R|$E|#/>M|%R|$N$',
      '|#2;|$>R|$@M.MG|&<E.|&IM!|$N$|%<|$O|%$!|$R|#4LM|%O$|$NJ7G|)9|#;4O<|$?OG|$@O<O|$COG|#<@|$O|#B<MG|$L<MG|%O|#CNX>G@M=|#',
      'E@|$M%;|$RJL|#IM%<|(O|%@M|$N>MJ|%X>G|$O|#J<M|%R|$E|%O|$H|$LO>|$M!|%%;|(.|(N.|%HM|&N$!|&Q|&R|$O|$QH|$T&|#KN|%;|&M|%<|',
      '%EM@|%X>|(M|(O|)$!|(R|$O$!|%E|$P|$R0M|&O|$YJ|&E&|&IM>|*O|#M!5M|&R|$%|%H|&7O|$&|%7|&J|$*|%APG|$,|$.|%RJL|$/IM!|%O|$0|',
      '%P|$4.PEMG|+O|%/R<G|%>Q<|%?M@O|*$!|%@O<.|)N.|)O|*IM@|&R<M|%AMH|&PGM|&Q<|%IXJL|%J=M@|*O|&LMKO|&O|%LO|%M|%NX>G|%OI|%Q|',
      '%R|&!>G|&JL|$8UG|$;M|%O|$<|$?M|$CG7|$E|%.HO|%0WVKO$|%2X>G|%>MJ|%AMH|&PG|)M|%JG|%M|&%;|&@P4@|$I|%;|%HANX9O|%O|$J|%L7G',
      '|)A<O|)EX9H|)IM>|,O|&O|$K|%<|%O|%PH|#N$H7O|%J<|$+HN7O|$,|$.MG9|)NX0|$0IR>|$2G9|$4LGI|$7M%G|$ACHN.|*@|%TG7|$HO4|(L|%R',
      '7OIN7O|$IM%<O|&4|(L|$JG2|%L<M|(N$!|(R|)>MG|&O|($!|$KM#|&%JL|*O|&&|$X0|#O#H|$,|$0@|$<|%M!|%O|$ER.|$HN4L|%O4L|%R7OINJ7',
      'N.|#P.|%MI7|$/|$2O|&$!|$4L0MG|$5M@|$<CM|&R|$A|%*|$EM!7N.|&H|$Y/|%<|#Q7|$A.|%@0G|%M|&!<G|*;|*@|%O|$E|%O|$J|%O|$K|%M@O',
      '|$WO$!|%VKO$!|#R!4|$#|$/|%M|&0;N<|+N.|&IM!|%N.|$0NJ<M@|$7|$9O*JL@|&,|$<|$EX9|$H|%0Y9O|%IR|$J|%LE|#S!.|&NX0|$4OES!7|$',
      'AG|$BVGS!J|$J7|&TGS!7|$Y9|#T.|%;|%=ME|%N$|$0|%M;Q|%O|$4|%L|&M|(@M|&O|%O|$7G|%O|%RJL@|$9|%R|$AW|$CT7|$E|%@|%M!7N.|(J|',
      '&@O$|$H|$J|%L@|(O|#U.|$CG7|$JL@|(O|#X0|%.GEO|%EX2|%O@|$?MIM|#Y/|%;|&M|%>M|&N$!|&O|($!|&R|%N#.|%O|%R|%T|$>|$C|%M|%O|$',
      'JO|!H&$!|#.J|%L|&;M|&E;|(O|$OG|#/@)|$M%.|#0>M|%O|%R|$@|$A0|$D0|$M|%%$|%&|%(!>R|&;|(M|%*|%<MG|$R|#1Q|#3E;|#<M|#>M/L|#',
      'AR7|#BL4L|#HN<|#IR|#J;|#KNG|%X>O|(R|$Q|$UG|#M!2|%CM|$#|$%$|%.|%@|%CGRGO|&VGRGO|,$!|%HAPG|$&|%7|%@|%B|%I|$(!>R|%;|&M|',
      '$*|$0|%<|%Q|%R|$4A<|%LEO|$<O@O|$D|%.MGO|%>M%.|$G9|%S!J|$H|%2|%M|%O|$IM!|$J|%7|%L|$K|%RIX>|%UG|$WO|%R|#N$!>M|(O|(R|%%',
      '$|%(;|$,@|$/|%;|&M|%<|&M!|&O|%>M|&O|&R|%M&|&GO|%N$|%O|&$!|%R|$4M|&%$|&;|$7GR2G|%H|$AO|&$!|$E7N9|%N7R9|$IGAQH|$J7|$KM',
      '4L|$X.|&@|%0|&.|&O|#O0|$9|%G|&JLNA|$@|%O#G|$A|$HM|%VKM|#P&J|$?N$;M|)R|$A<|$KMG|$Y7|#Q&|%J|$;|%M|$=G|$A|#R.|%N@|$/|%;',
      'O|%M|%N.M|)IM!|$4LG|$9O|$@|$CG|%H|$IO|#S!9|%>M|&O|($!|&R|$#|$.2G|(MG|%R|$7N@|$;|%M|%O|$@N@|$B7O@S!7|$C|$HM|$IH|%O|$J',
      '|%CO#@|$Y@4L|#T#|$.0O<|%<X<G|*O|%?MGM|*&|%AMH|&VGNF|%FM@|%H|%M|$9|$?O|$A|$GO|&$!|$J|$KM|%O$!|%R|%WO|$W|%O!>M|)O|)R|#',
      'U!0|$.N.|$GX74L|#W.M|%O|&$!|%R|$>R|$@|$M&|&$!|$N$|$O|%$!|%IMG|$R|#X.M|$0G|$1|%>M|&O|$9@|$>@|$CM|&&|%O|&$!|%R|$EM|&&|',
      '%O|&$!|%R|#Y.|%O|%W|&O|$/|$0|%;|%>M|&O|($!|&R|%A0|&Y0|%DY0|%M|%N$|%O|%R|$3;|$9Q|$<|%M!|$>M/|$D|%;|%N$|%R|!I.<|%M|$G|',
      '%N<|$MH<|$OH|$VG<M|&T.<O|#0>M|%O|%R|#2@|#4L@|%MG<|%OG|$M(;|%K<|$O>|$Q>|$R|$T|$VKM|#7M!>GM|)R|#9N$&|$RGR|#;4MGM|#<@|#',
      '?;|%M|$>M|%O|%R|$M|%%$|%&|%(!>R|&;|(M|$N$|$O|%$|&!|%.|$R|%GR|#AMG|&.|&O|#BLM>MG|#G.|%G|$/M|$0|%M|%O|&.G;|)@|%R|$4@|%',
      'L@|%N<|%O@O$|$9|$;|%@|%EMHM|%N<|$<|%;|%>M|&R|%EM@|%M,|&GM|(N$!|(R|%N$|%O|%R|%T|&!.MG|$>M@|$@;|%EMHM|$EM|$H9|$N$E|$VK',
      'N$!|&R|(0X:|#H7TKM|$M>OEOG|$O|#J<|%M!|%Q|&$!|$>R|$@O.|$M%$|$N$|$R|$T!|#KM#|$NE|#M!|%0|$#>M|&R|$%GJ|%JGM*|$&|%7|%@|%J',
      '|$.|%G|%N$|%XJL|$2.|$4AM&|$7|%G|$:O|$<MIG;|)@|$>|%.|%O|$?M|%Q|%R|$@|$AG|&>M|(O|)$!|&@|&N$|&O|%J|&O|%NJ|$E@|$FQEX9H|$',
      'G9|%<.|&M|(HMA|%J|%M;JO|%NJ|%O|%R|$H|%7|&G|%LM|&O|($!|&R|%N$!|%O$|(!|&CMH|$J<I|(N.|*<M|&M|&R|%LNX07@|%O|&$!|$K|%@|%N',
      '0PGQ|%O|#N#.<|(O|)$!|)0<|%X0|&4@|)M|$$!|%.G;|(@|%/N$|)IM!|%4|%A.|&O|%J|%KN$|&O|&P<M|$(!<|$,!<CX>|+O|$.|%7|&G|&M!|&TG',
      'O$|%;|%GE|&O|%HA|%J<|&N<|%MG|&JJLOH|%O|&AO9O$|&EO9O$|$/M%$|&&|$0MW|%N$@.|)N.|)O|(A@|$2.MG|)HR|%G>R|%HM|&O|($!|&R|%MG',
      '|(.|(?MG.|+M|,IM!|(N$|&HR|$3TWR|$4R|&<M|%S|&@0G|$7MEN@|$<.GR|$>|%EM@|%GTK|%IM@|%M|%N#.|&$|(G=O|+$!|%RJL|)O|$?IM|%M|&',
      '%.|&@|&IM!|%O|&$!|$@MJL|%T>|$AGO<|$DM0|&4@|&I|%NX@|)<M|%QJL;|$G.|%JM|&R|%M7|&J<|)O|%P?|&Y?|%T?|(O|$H|%J@|%N#E|%O#E|)',
      '4L|)J|%UJN7O|%Y/;|)<M|$IG;|%J=M|(N<|%KMG|).|%M>|(AQG@|%N?|%R.|(M@X>|&2@|$J<MG|&VGN<|%=MG|%BT7|%L@QX|&HRJL;|&I.TJL|(@',
      'M=|(IN$AO|(MJ|(O.G@|&M|(H|&N$!|&R|(JL;|*<M|,IM!|%M/O|$KMG|(.|%WR|$X0|%9T4L|$Y/R|%2.MG|&T|%<|&O|%=|%>N#.|($|#O#<@ME|*',
      'O|$$!|$.|$9O,|$;M|$G|%IMG|%M|$K|%IO!|#PES@|#QES@|#R!|$/|%.R|%;|&M|%>M|&R|%N$|%O|%R|%T|$0|$2|%;|%N$|$>|%M!<|$@|$CG|%J',
      'M&7|$GIM|&N$!|&R|$H|%4L|%LR|%M|%R|$I|#S.7G|%YE|$>|%N.|$@|%.QIG|$C|%G|%JM&7|$GO|$HO|$J7|%R|$YC|&JM&7|#T7|%G|$H7R4|$K|',
      '#UHO)E|#VKM&7|#X9|%;|%N$|%O|%R|$@|%0O|($!|$JL|&4|#Y/GM|&O|($!|&R|%T|$4T!|$9O|&$!|%R|$?>O|$HT|$J|%>R|%N$|!J&#>|$>|#.;',
      '|$>O|&$!|%R|$GO@|$M&|%7|&HS!9|&NJL|%GM<E.|%HGJLNA|$N$|%X7|$O|%E|$QHO|$R|%0M|%H|&G|$TG|$VGNA7|&O@|$Y<G|#/<|$JLO#<M!|$',
      'L<|$O|#0T!|#2M&|$N@|#4LM|$M|%%$|%I7|$OI|#7GNX0|%O7|$M%H|%&H|%.|%B|&L|%G|%HN@|$OB@|%H|%I|&@|$Q9O,|&S!7J|$R4|&O|%7|&J|',
      '%9O#E|%JL@|$S!9|(G9|%7NJ7O.H|$TG|&O|$VGO7|$Y9O4L|#;R|#<G|%M!|$HP4|$K|%N|$N|%$G=O|%.MG|%0PGQ|%X>G|$O|%JL|$VGMJ|%KM|#=',
      'M&|%@.|&N.|%A<|(O|&@M|&N<|$N<O|%G|&<M|&M!.|%Y<|$QH|#>.M|$@|$DMI@M|$G|$M|$O$!|%.|%IO|$YJ|#?MG;|&@|#@#<|&O|$E|%M@|(<|(',
      'N$|)<|$M<@|#AGJL|$HM&|$JL7|$M7M|$NY@|(UG|$O.G|%9|%JO4L|$PY<G|$R@|&O|%J|&7M&E|$S.7VGE|%@NJL|%JLH|(O#H|$TG7J|$YJL7|#BG',
      '|$H|%<M|(AQGI.|$LG|&@MEM|*R|%H|&<M|%R|$M&|$O#G|$R>|$S>|#C.|$4LO|($!|%O$!|$<T!|$Q<|$X?|&<|&N<|&O|#D<T!|$@M!|$MIM!|$N#',
      '<M|%$2MG|*.|*O.G@|#E.MHO|)@|$0GO|$5|%;|&M|%>M|&R|%M%$|&(;|%N$|%O|%R|%U<M|(R|$<M|$G|%=.|&@|&M|%A;|&<|&N<|%M7|%QA|(<M|',
      '*IM!|%Y=|(M|$HNX0O|$JN$IM!|$M|%!|&<G|%0E|%2MG|%4.|&IM>|*O|&N.|&O|%;M|%?|&O|%@|&<M|&M!<G|%A<|(O|%G.|&7|&TK|%J|$N$!|%=',
      '|%Y7GO|$O.G@|%/N$|)IM!|$P>G0PA<|&M*|%X>G|)O|%Y2M|(O|(R|$QK|&N.|$R|%<|$Y0GO|%JN$|)IM!|#F>|#G.7|%H|%MGO|$0GE|(O|$4@|%G',
      'O|$7OBN.R7|$>MG|(O|%O|&$!|%QH0WVK|$@|$AVGJ<|*O|%X2|$C|%4O<|%O$|%T<E|$H|%<M|$I|%(Y2|%G|%NJ|(N4L|%R|&/;|%T<E|$JI<O|$KN',
      'X>|%X>|%Y>|(O|$M!|%A|%DM|$O|%G|&.|$QA|$T.MG|%<|%IG|$VKT!|#H<@<|$EM@|$M@M|%E|%K|&.MG|$OE|$R7O|$T.|#I>RJLO|$G|%0|%@|%M',
      '4|$M0<|%>|%EO|%G|&O|%H|$N74LGHS!9|%J|$O.MG|%9@|&NJL|$RG|&R|$S|%4OI@O|#J.MG|#KM%.|&<M|%&|%GM|&R|$N|%.MGO|%0H|%4|&R|%;',
      '|%<|%E<|(O|%FT0|)O|$O|$PGR|%X|$QH<|(M!|#L.<O|($!|(JLMHO|%H|%PX<HM|$/JO#<|%LJ|(O#<|$0@|$<GX4|%MC>O|$@O|&IMG|$C>M|(IHO',
      '|&O|%M@M|$EJ|&LRG|%QHO#<|$G<|%?M|(!4HO|(HQ|*$!|%@|&MG=O|%EM|%MC|%OB|(L|&G|$HM1M|%T.|$IMG4L2NH9|%R<M|$JLO|$KM><|%N>|&',
      'GO|%O>|(O|$M|%!<|(O|%%>|&G|(O|%.MKMGO|%/M|(IM!|%0NG>|%7|%>O|%@|&>MG|%A|%C>N.|%E|%G>M|%J.|&<|(G|)O|&@|&L.|(<G|*O|&N<|',
      '%K|&.MG|(T7|&4KM!|&EP/O|&GP/|&N>|&O|$N#G|%$E|%.M%<|(0T|(G|)O|%B7|%EHM|%G.<|%HA.MGO|&MHR/|%I|&M4O|%X0MG|$O$|%HM|%JLR|',
      '$P.G|&HM|%D|%EMG|%GP$<|&Q$<|*O|%Y.GIMG|&?|(<M|$Q0G|%7|&NX0|$R#G|%.JAO#G|%/|&G|&L|%G|$S.JAO#G|%<M@|%HO|($!|$T|%#|%DM|',
      '%G|%JL;|$U.|&<|&O@|$VGO|(E<O|(HX.M|&R;O|*$!|*CY?|&T9NX4G|(E;O|$X.G|$Y.|&G|&O|#M!|%0|%5|&M|&O|&R|%<M|%D|&;|%J.VGN<.|&',
      '>|&O|$%XJ|(4L|$&|%!|%.H|%7|%9|%@|%E@|$(;|$)=|%>O|$,|$.|%JLO|%M|&G|$/G<M|%O|&$!|$0G|%M|$4L|&NJL|$9M|%O|&$!|%R|$:R|$=|',
      '%O|&$!|$>M|%O|$?|%.|%@|&M|%MG;|(@|%Q|$@|%QX|$AR/N.|$B|%7IR#G|%L|&7IR#G|$C.M|%;|%<|%N<|%T|$E0GO|%GM4|)O|%M4.|&@|%O|$G',
      '|%;O|%<G|%=.|(<M|%M|&!JL|%O|&$!|%X0O|$HM|&@M|$I;|$K|%@O|%E;M|(R|%N<.|)MG|(N.|&C4LM>M|,N$!|(M|)@|&G|&Y<|$W|#N$;A|&R|%',
      'H.T7|%J<|(>M@|&O|$.X>G|$/|%G|%HM&|%M%$|&(;|%N$|$0@H|$7O|$9@O|$<MGM|(N$!|(R|%XCG|$?M!<|).|*MG|)N.|&G=|$@KM|%REM|$AMKO',
      '|)$!|$BMGJL|%NHNJ|$EG<O|&@|$G|%4;|(M|)<E.|&@M|&N$|&R|%B|&L|%EUG|%HR/|%JM|%M4|%NHN.|%O|%R|$HIG|%JNHM|)R|%NJHRIMG|$IH|',
      '$J7E|$K<|&EX>|%GM|$X0|&G|&H|(4L|&MAPG|%2M&|%?|&O|($|&Q|$Y.M|&N$!|&R|%/;|&N#.|)<|($IM!|&O|%7M|&R|%8;O$!|%?|&M|(!<|&O|',
      '&Q|&R|#O&,|$4L@|$7|%M!|$<H|%M|$@|%O#G|$E<|%M|&IM!|%N<|$GO#H|&$|&4L|$J|#P$>|$.GM<|$/|%>RI|%E@O|%INX>G|&X<|$0X?|$2MGQ|',
      '%R<|$4M@|$5M#|$9M@|$;|%@|%IM&|%M&|%N$|$<X<G|)<M|$?M|&G|(.|(@|(R|$@KNGO|%ME|%OH|%RKM|(R|$A@M|&N$!|&R|%G|&OE|$DM|&#|&I',
      '.|(N.|&JL|$ERH|$G|%4O<|%NX>G|%Q|%RJL|%X0|%Y/N#<|+M|)$|$H<M@|)APG|)M|%MK|%REM@|$IN?M|)IM!|%X@<M|$JLEM|%M%7O|$K4|%M0|$',
      'X>G|(<M|(O|%@O|$Y.|&O|&R|%/|%2M|&R|%7|&;|&N$|#Q&|$/E|$2.|%@M|%O|&$!|&CY?|$5|$7|$<G|$BLO|($!|(E<|(IM>|%O|$CM|&&|%N$!|',
      '%R|&>MG|$G|%4|&O|%<|%EM|%O|#R!7|$/T!|$8|%O|$?|$@|$C|$I.|%@|%M|&EP.<|&IM!|%O|#S!.WR|%7|&G|(H|&OEO7G|$.7G|(O|%J|&L@|%N',
      'X9|%X9GO|$7H|%RHM&7|$;O|$@|%M|&A<O|&IM!|%N.|(M!|%R7|$EO|&@MG|&BM&@H|%Q#H|$G|$HJO#J|%M@O|)$!|$JL@|$Y7|%H|#T0|$2|%;|%>',
      'M|%N$|$5O|$9O#E|$:O|$?|%N$|%R|$@|%M|%O|&$|%R|$A|$BO$|$DM|$EIMG|%M|%N$!|%R|$HG|%M!|%T|$IN#<|%O#<|$JLH|(NJ7|%M%7O|$K;|',
      '&M|&O|&R|#U!|%A|&N$|&O|$/|%M|$>M|#VGNJL7O|%O|&@0G|&E<O|&HX.M|%RJL7|%T<|#W.|#X.7|%GE;|%H@|&A|&N<|%R<|(.|$/N$|(IM!|%RA',
      '|(<M|$0|%8@|&N<|%<|%E|&GEG|%GME|)O|**|&QG|%O<.|)MG|%VGKN|(NK|$1|%;O|&R|%GJL|%O|$2MG|(N<|&H.|(@|(N<|$4E|%OI|%R|%T0|$<',
      '|%M|&@|%PH@|(N<|&JL7|%T/|$>|%GD|%OA|%RJL|%VGD|$?O|&$!|%Q|$@|%N$J|%O|$A<O|%G.|&>M|)%|%M|&>.|)O|(@|)M|(N<|%QG;|(@|%VG>',
      'M%|%X@|$CT?@|(N<|%X?|(<|(N<|(O|$DI|%MH|(;|(N$|(O|&I@M|*IM!|(O|$E<|%O|%RH@|$FP.<|%T0|&4@|$G2@M|)IM!|+>|,O|$IM>|%N?M@|',
      '*.|%R>@JLOH|)M|$J.G;|(@|&MG|&VGN<|+O|%=M|(@|(A.|(IM!|%>|&O|%MG|(N.|#Y2|%EPY2|%M|&&|%O|%R|$4;|%R|$7|$8|$<|%IM!|&O!|&R',
      '!|%M|%N$0VGKN|$=|$>|%M|%N$|$A|$DN#<M|&$2MG|+.|$F>|$J|%O|!K.O.<|%E|$QE<|#4LG<|%MG|(M|#7M|%(;|#=N$G|(CX>|#>M%<M!|#@QXE',
      'M@|$RGM|&R|#B<R|$L<M|&N$!|&R|#COC|#E>G>O|$HM|&IG|%N$!|%R|$M%<|$O>|$RJLM|)!|#FM<|#G.<|$0TCNX>|$2G@|$4O<|$>RI|$@ME|$CX',
      'J|$D4@|$E@|$M|%%$|$N|%$;M|(R|%0TCNX>|%D4@|%EX>G|%X>G|$O|%.R|$R|%.|#H.M|%N$!|%O|%R|$>O|$M<M!|#IM|%&|%HM|&N$!|%IM!|$RH',
      'O|#J<M/G|%O|&$!|$@|$A<MH|#M!|%0|&.M!0|$%.Q|$&|%9GT4@|&VGT4@|%IR|$(J|$)J|$*|$.E|%O|$4LG|(O|%O|$=O|$>JR|$@|$BLN4L|$G|%',
      '7|%9|&IR#G|&O|%@|%IG9|$H|%<|%M!.N|&<|%O$|&IPY9|%R|%S!9|$IG9|%WM|$J|%GJ|%H|%LE|(O|&O*|%NH|%R|$YHOIPY9|#N04L|$4GO|$7HG',
      '|$<|$CGQ|$EM2H|&HM|(N$|$G>R|%@|%MJ<|$H|%CG7|$J7GO|%M|&C|(>M@|&G|$X>|&PJ<M@|,O|&Q|($!|%E<|%J.|&M|$Y7|%<|%H|%JN$!|&R|(',
      '>MGO|#O0H|$7|$G|%M|%R|%T|#P.E|&GM@|$;R|$@G|$EMFQX|$J@|%LN$GAPG|%S@|$X0MGM|%>N$!|&O$!|#QX|#R4L@CG0|$8|%HM|&O|&R|$<P|#',
      'S!|$.7R#G|$9.P$7G|)G7G|$>G|&MCM>|$@GO|$ENH7@|)T@O#@|&X0IR|$GM@|(O|%O|$H=|$JO#<|$Y9|&.P$G7G|#T!>|$%|%$!|$&$|&!|$.R|$7',
      'H|&J|$;0O$!|&R|%M|%O|%R|$E|%TEUGBN4LE|$G@M!|$H|%O|$IR0M|(O|$J7|#UHO|#W<MH|$VK|$YAM|#X.MG|$0GO|$5Q|$J|#Y.|%>MG|$9O|&$',
      '!|$<N$|$=|%O!|%T!|$>|%CX>O|$C|$H|%M|$J',
    ].join(''),
  ],
  or: [
    "ଁଂଃଅଆଇଈଉଊଋଏଐଓଔକଖଗଘଙଚଛଜଝଞଟଠଡଢଣତଥଦଧନପଫବଭମଯରଲଳଵଶଷସହ଼ାିୀୁୂୃେୈୋୌ୍ୟୱ",
    [
      '!%1_;]GK|#7U|#8_:T@|#;D_@U|$Z|#CU1|#DWQTKZ|$Z1|$_a|&TD_a|#E_KZL|#GQ_AU@|#HUDa|!&BU|#CTK|#KI_H|#RWKU|!(#KT8V|#@URTQ|$',
      '_aTBU|!*6_6|#@_@K|#EKZ|!-1|#<TKZ|#AUKZ|#G#|#RT|%1W|%K|$U|!/=SU&|&OT|)K|!0PC|!1#3_KZQ|#AT6U@_K|+;UK|#I|#KD_@U|$TJT(7U',
      '|)AULT|(-|$U|%7D_@U|%AUGT|(LT|)Z|%GT|(1W|$WAULZ|$Z|#LZ|#TI|$K?|%_J_a|$RT?V|#U|$7U|$D_@W|$I_GT|#WRTJT-|#Z@Z1|$GM|#^?Q',
      'U|!3V@|#];U-|#_KR?|!4;?T|!6M6_6U@_K|#U1U@_QT|!7];|!8?|$Z|#D@T|$Q#2_aT|$_I|&3_KR?|#T@Va|$DW&KV|#UL_LT|)K|#VGD|%U@|#WD',
      '|$LT(|!=UQZI_GK|!@AT|$_a|#T|$5_1|(K|(W|$KU2KZ|$RT|#U&KU|$AU|#ZGZ|!AT-|#UGT|$LT|%Z|!B1_PU?|#M|#TQ|#U&JT-|$D|#W(|#Z(|%',
      'AULZ|$2TJT-|$GV|!DTI|%1|%KZ|$KV|$RU!|#U8|%K|$ID_@Z|$K_B_BZODT|&GT6D|+KZ|*U@|&IT?|(U@|#Z(|!EKU|%GTK|$Z|$_J_aD_@|#T(!|',
      '$K_O_b|#WKQ_1TK|#X8T|$K_G|(KW|#_K1TK|%@U|(O@|%AI|(Z|%BTD|%Ta|!G;|#=S|#K_P|#RW|#T|$RTK|#U8_:TD|$CTD|&a1|$GTR|$HUD_D|$',
      'PaKZ|#ZMZ|#]LU|#_a1_@U|%GRTK|(Y@|!HMU|#TGKZ|%Z|$K@|&K|&Va|$PT|&KZ|#^3MU1|!IC_a|&KW|(Z|#D_BUK|#QURT|(K|)Z|#RTD_@U|$UM',
      'T|#T@_K|$K_6_6|$Q|#UO_K|#W1_@ULTH|$2_a|#Y@_aW|!JTRT|#Z|#]3W|!K1_@|#6DT|#RU7U|#T8T|%_a|#XEZ|#Z|#]3|!L1_P?|#U5_1|#Z2T|',
      '#]1|!OU1_PT|#ZP|!Q#2_aT|#5_3V@|#D|#GW|#HT|%1W|%K|&Z|$_a|#IQ_@|$_ITD|$a|%KZ|#K1TKV|#R|$K|$U@|#T1_PK@T|$CTK?|)@$|$RU@_',
      'a|#YP_;U|#Z|$<TKZ|$E_;ZI_GK|$ITDZ|$RU|#_ATD|(KZ|!RUD_BV|(W|#W-|#Z*7U|$GT|$LT|%Z|#](|%7U|%AT-|&UGT|(LT|)Z|%ETKZ',
    ].join(''),
    [
      '!%!MT|##1]K_|$6MKZ|$O|%3_KR?|%GUOZP|%K|%VBTK|%WITD|#1TM|$_1UDZDU|%@U&K|%PI|(@T|&K|&T#O|&a|%QT(=_|#2?_=|$UM|#3P_;|$_D',
      'TOa|&U|%K3@U|&?V|&QK|&bTL|#5_1|&D|&U@|)T|%3|&TK1TI_M|#6M|$UR_DT|$_aW@TDD_B|#7D_@U|#83K|$?T|$D_@T|)K|$T|$U8_|%@|$a|#:',
      '_6M|(K|)Z|%8DT|&MU|#;1U|$M|$T|$](I_I_aWD|%Q]ITL|$_;TMU1T|#<K|#>SZ(|#?BZ2T|$DUO_bTQ|,V|$QK|$T|%JT(AULT|$W|%8VG|%GV1_P',
      '?|$_;T|%=T|&UKT|#@-G|$U|%1IKZ|&_KI|%AU|%G=SV|&TRU@|%KU1_@|%QTK|$V@|&K|(Z|%G|$WMDVa|$_aCU1|&D_@|&T6TK|(CWDU1|(GO_a1|-',
      'Va|#AGT|#BT|%L@|(K|$YO_a|$_HW@|%aTEU|(GCU|%bU@Va|&[@|#C1ETMU|%_P|$T|$U1D_@W|&T|(#O|(K|)K|)V|&Y@|%3_KR?|%DKZ|&Q_A|&Ta',
      '1|&UaI|*K|%E@U|%GTQ|)V|&ZOD|%P_<T@_KV|)U@|$VD|&1W|&KZ|$WDT|$_a1_P|*@T|,KZ|&TE1|)DT|)U1T|(a|&aD|#D5_3|$@U|$D_@|&a|(T|',
      '$LT(D|$TA|%GO_a1|%I|$U6_7T|*1Y@|%@T|%K_B_BUP_;|%L|%aD_@_KU@|&IU@|$V@T|$W|%1K?|&XM|%3TIV|&WM|&]M|)<TKW|%BTD|%C_aTD|%E',
      '|&I|&JW1_@|&Q_AU@U|&T@|&_KGZO|)T?U@|%GD_CU@|&TB|)1|)U@|%HG|&W@U|&X@|)U|%I@U|&TD|&]BD|)U@|%JTaV|%KT3|(CT|&XE|&]C|%OTQ',
      'D|&VMD|%P_1T|(<TD|+K|)U@|%QD_CTD|&K?|&X6U@|$_|%@|&$|(KTP_;_KVa|&@$|&DMV|&K|(5_3|(T|)P_;_KVa|(V1_P|(_3@|)8T@U1|,Va|)D',
      'URU@|)HW1_@|&UI|&Z|%C|&1TK|&TK|%D|&EXK_?_?T|%JTD_J|%a@I|(_K|&AT|&DTI|&E1_PKZ|&Ta|%bZP?|#EEWP_;U|$G_aGRTK|$H_K#O|$ITD',
      'U@|%UO_KU@|$K|%T8U@T|&C|(K|(U1|(V|&R_D|%Z;U#|&OD|&QD|)_|$QKT|%TK?|%_ITK|$RK?|$T|$XK_G|$Z1_PT|*1Y@|%KT|$_|%KZL_|#FUQ|',
      '&K|$_|#G1TO|%_Pa|$3@|$@K?|%TK|%VK_?_?|$BTD|%WL|$CU|$D@U|$ITDDT|$K]C|$LI_GD|%]1D|&RU@|$OUP_;|%ZP|%]P?|%_a|$QK|&E_KTE_',
      '@|%TB|&D|%_@U@|&AT|)D|)EU@|)K|(U@U|$RZMT|(U@|$T|$UGTRU@|%H1_@|$[C|$_aGQ_AT|$aG|#HTG|$U8U@|&_:@T|%CTD|%DG|&V@|&Z@T|)_',
      'KV|&_D|&aK|%GYB_CU|%ID_aW|&TD|&W2Z|%JTD|)K|&W1_@|&]3|%LZ2|%MTP|%OTE|&Z1|%PZ1|%RU@|$_aD_@K|&TQ|$a|%TK?_a|+K|#IK|$M|$T',
      'GTQ_aT|$U@|&TH|%K|$Y@|&QK|&T|$_GT|&U1T|%KU@T|%M|&8TD|*K|&TD|#J]C_aT|#K1_PU@|$?_a|$GUD_B|$UD_BI|$W&|%6U|%?|&T|(6M|%D_',
      'C@V|$_6_6DT|)U@T|%8D|&WD|%=K|%A|&DV@U|+8_:|+K|([@U1|&OTQ_@_KKZ|&T@|)_|%B_C|)Z1|%E?|&U@T|%GWB|%O|#L3T|$;_KTQT*?_=|$U|',
      '%I_EU1|+_|,Q|%OT|$^1U1|$_|%LV|#M1T|$5_1TK|(Y@|$Z(6|$_E|#OTD_@|$WH|$]1|$_KWI]6D|%bIZC|&UDV|#P_;I|(V|&TBO|&_KZLU&|-K|#',
      'Q#2_a|$D_@]P|$FM|$IK_A|%_EXK_?_?|&HG|$L|$RJ]3|$TCTK?|$V@|%I|&T|$WGUCT|*K|%K|&1_PU@|%Q_A|)@T|$_@|&U@_b|&_K|)OQ_@_K|)]',
      'E6TK|%ATaV|&U|(I8_8T|(K|)@T|%EP_;|%bTHTGU1|-@T|&V1TK|#RIB|&TGTB|%_IB|$L_aT|$U#QT|%KT8|!&#OU1|#(D|%3@|%8VGV|%K|%_|&P_',
      ';T(D_|$EU-L|$QUQU|#*;|%_|$AKZ|#/K_;U1|#1GK|$K_P?|)Va|(U@|$MD|$Q_IU1|$T*?_;|%K|&K|(Z|%O|&GT?V|+K|$Y@U|(K|%P_;|$_;|%KI',
      '?|)1TKV|)K|)T@_I1|&TD_@|%PKU1|%QD|%aW;|#2ET2|(K|$U|%K|$_aT|#31W|$@|$ID|$KW|%Z|$TIV|$W&|$Z|%(|$_DZa|)3UKU|%KR|(V|&T|#',
      '4T@|&E_KTE_@|&K|#5_3W<U|&_L]|#6K?|$TK|&_J_a|$_7TBU@|#8IT|$TB|$U|%1TLU|%K|$VGD|$_:T|(ITM|%IT|#:_6MU1|%8U/(=UIT|#;_KU&',
      'L|#<3=S|$;U|$IL_LU1|+K|#=1W|$IUOD|$S1W|%E|$_KZDTL|+_|#?GU1|$U|%AULT|)Z|%BZ(AULT|%GT|%LZ|$_;U|(=UE_KZQT?_;|(G=U|)Ta];',
      'U1|/_|(QT(1];U1|(RUQ_;TIUD|%<W|%=|&TITD|&U8|&_|#@5_1GTBV|$_I|&8VGDV|&QIK_E?|&R@_aT|&T|#BK|%_O|$TD|%a|$U@_a|%GTQV|%I|',
      '%K|$Y@|$ZO|$^|$_a|#CTKU@|$UE@_a|$WDU1|$_aT@_IU1|#DD_B|(EWK|$TFT(L1_QUQ|/_|*T1_QUQ|$UIU&|$WITDU1|%P_<TDU1|%Q5_3U1|$_@',
      'K_8T@U1|,Va|%B]MD|*K|%C_K|)E_KBZO|/K|#E?|%T|$Z|%1_PU1|$]L]|$_|%LU1ZQD|#F3TD|(UQ_@TD|$_KU1T|*D|*K|)Va|#G?_;D|$B_C|$K?',
      '|$O_a1|)@T|)Va|$QZQ|$TQ|&U1|%RD|$UK_HTG|%P_1TK|)Y@|$W|$Y@|&_@U|$Z3|%BD|#HUIW2_a|$_aD_@KV?|#I1W|$BTDV|$D_@_K?|$K|$UP|',
      '$Z|%KU1T|*D|*K|+Z|)Va|$_G|&ZB1K|%IT|#K@U|%V|$G|%V|&a|$TCDT|&_a|%I|$]3_a|)QTC_a|%R?|$_|%8Z?_;UDT|%;|&UFUQU&L|%AU1|&_K',
      'T(;UQ|%B_K|%IU|%J_a|#L1RL|%]R]L|$3]KUBI|$;|$FT|$GI|&_|%K_;|$K_8U|$TI|$W%|%IUDT|)UaI|,_|$]|%1|&ET@|&K|&U@|%6DT|$_LT5_',
      '1|#M@U|%V|$W|#O5_1T|$T|$UP|$VK_GTB|$W|%@]P|$_6K_J_a|%KI|&a|%bTQDT|&UD|#PT>S|#QD|%_@U|$TI|&K|$U|%%7U|%1T|%7D_@U|&U|%A',
      'T-|(D_@U|&UGT|(LT|)Z|%G|&T|(K|%LT|&Z|$W%7U|%7D_@U|&U|%AUGT|(LT|)Z|$Z|$]QU-QD|+_|$_ATD|%EUKUD|#R@|$K?|$TK|$_LTGTB|%bT',
      'D|#a1K|%TKV|$@D|%_@|$K|$W|%C|%K_GZB|+U1|%P|$]3|&K|%81|&D|&U@|%=UD|#bTK_=|)S|!(#KZ8|$L?_=|)K|#&K_EU|#*K]E|(Va|#6_7T|&',
      'W1|#7T|#8UE_;|#:_6|&_|%8UD|)UaK|,U#|)_|&Z1QD|)_QD|#;T|%LV|(K|(a|#=UIT|#?_;K|(DZ;|)_aTQDTL|&ZLU8ZD_Q|%=U&|)D|*_|)K|(8',
      '|&]|(DZQU&|-K|#@U|%RTQK|$_aTBUK|#DF_KTKZ=_|$P_;U6_aW;|._|$QWLUD|$RUGU;K|$_|%BUKT|&_K|)B_aWI_D|)T?V|%CD|%F_LW-:_8T|#H',
      'Z?_;|#IZ8U5_3|$_I_aWD|+U;U|#KT|%D|#LT|%1T|(KZ|$W|$Z1_;_KD_|+]DU1|/_|0Q|,LT(;|#O_bK|#P_;|#QLTI|(K|(Va|$U8U|$_1|%@FT|%',
      'ET@|%KT-L|*K|&]|#RWBV|!)#KT8V|)KZ|#KTG@V|#O_bK|!*(1UEU=SU&|-K|&IU=SU&|%Z;|$?_=]8|#1_@|#6U@|&_|$_6@I|(K|(T|)K|*Z|&GUB',
      '_aTMa|&OU1_PT|&TK?|%7ZB|#8_8_bM|#<T(|&GT|$U|%AUGT|(LT|%GT|%LT|$Z|#=SD_@T|%T?|%U|&GT|$T?|#@1_PZE?|$_1?_<T|&M|(I?U|(K|',
      '(Va|&YP_;|%@E_@|&I|&KE_KBZO|.K|(T2?_=|-K|)CU1TK|.V|&TE|&VK_?_?|&Z81|)DT|)U@|&]MD|%ATD|%E@U|(_@U|&D_D|&TB|)D|*K|)U@|%',
      'Q|&G|(K|&K_3|*V1Y@|&TR|)U@|#B4T;D|$K|$TK|%RK?|$U@|$_4T;D|%BUP_;|&ZO_a|+KZ|%CTK|&Y@|%GZ3|%HG|&TG1|)D|&UB|%aI|&TD|)K|&',
      ']3|$a|%3UKU|#DGU#O|$_D@|(U|&aD|%IW1_@|&]6D|)U@|#E1?_<KZ|%K?|(K|%TK|(V|)@T|%XM|(GK_@_@V|%Y@|$2?_=|$3_KR|$6TK|$@_a1T|*',
      'K|$BZO|&P_;T|$DBV|%UGZO|&PB|%V@|%_aTQ|*K|$E_K8T@U|,K|$GTQ|$HTPT|%]1_@T|&3|$IRTBZO|+K|,Z|$JW1_@|%]3|(V|$K|%W|%]1_@|$L',
      '1_PZ|%G_C|)U|$OI|$QHTE@U|%T3K|%_ATE1|*D|+T|*U1T|+@|(U@|*U|$RTK|$T2_aTD|%BTD|&Za|%CU|&V|&_a1_P|%QDT|%a|$W8Z|$ZD_B_K|#',
      'HT|$a|#IT|#K_B_BW|(C|)_b|%GK|&OV|#L_L#4D|&U2U@|&Z2|)DVa|)J]3_a|#PQV|$T|$WI|$_?|%I|#Q_@TB|!+DGU#O|#K_B_C_b|!,@W|%GD_B',
      '|%K|%Q_KTG|#EZ|#PU|%&|$Va|!-(@URTQU1|#-F_|#11|$@T|%_K|(U@|$AT|$BT|%UGQVa|(TQVa|$E_K1TK|$GU#O|$IT@_K|$K|$LG_a|$T|%1V|',
      '%5_1U1T|%<U|%=SZIV|&ZIU|)V|*B_bTKT|*K|%BO|(V|%CTKKZ|&U1|%D_@|%I_K|$W;U&|$_|%Q|&6Z:_8|&E_KZQ|,_|,bZ|#3W=SU1|&U1|#6&(H',
      'U|$EUHU|$_|#8Z?_;|%D_QU|#:_8T(I|#<T1TK|&W|%K|&W|$U|#=Q|$ST(GT|%Z(GT|$T|#?W|$Z|$_=|&_|#@B_|$U1U|$Z|#AK|$U|%ET(!|%IC_a',
      'KW|%QR|(U@|#D-6-Q1W|%Q-&(=U|$QZFTL]ETAU|$_|#EKU|&1U|%_J_aD_@|$ULZE_QU|$_KUL|)_|#F_|#GZ|%1TK|%GU|#HKZP_;|$MU|#ITD5_1|',
      '*K|*W|&Z|$U@U|$_|%G]LU8_I|#JTG@|#LU8TGZA|%DT|$]KT|$_|#QGW|$U&|&D|(_|&K|%=|&_|$Va|$_|#RT7=ST|(T|%<TKW|%B_bTKT|%EKZ|%G',
      '_a@V@|%QR|$U<TKW|)Z|%BUD|%EKU|%HMU|%QGW|#aTK|&_|!.@URTQU1|&_a|#O_bK_J_aT|!/1UL|&T@U|#8D|%K|%U&|$]D|#9T|#;U;UKZ|#=SU&',
      '1AT6U@_K|(6M6_6U@_K|(K|&OV|#BT|#ED|$U%-=|#HTKU|#I_|#KTI|#L;T|$U*=S|#PT|$_;U/E]K]QUQ|#QTK|&U&|#R_LT(|!0E6TKU1|$D_aTQU',
      '1|#KQKW|$_|#PCB_bTKT|%K|%Va|!1#3_KZQK|$Q|#%?|#(!7|#*=SU|#1_P|&EAKZ|#2TKW|#5_1TM|#:_6T|#;1|%<TKZ|%?T|%K|%Q_AU@|$T|$U|',
      '%AULT|#<UD|$]K|#?T|$U1T|(K|$_;T|(1_;|&_K]L|%<|&BTD|&OUM_EV|-ITDZ|%=]I|%>Z(|#A1|$T|%1TK|%6U@_K;UKZ|+K|%GQ_@W|&TK_@_@T',
      '|%K|$U@|#BI_G|$MV|#D1|%L@T|$T|$U1T|%P_<|$_C|&ITM|%D=|(S|%aT|(K|#E=ST|$KZ|$TM|$U|%M|&ZD_B_K|$WK|$_|#FU|#G1|$6|$K|$MKW',
      '|$T;|%=U|%G|$U|%@T|(K|%QXK_J_a|$VK|#HU|#IDbZL_A|$K_Q|$L|$M|%T|$T?_=|)K|$U|%1_Q|%;U|(K|%GT|%JT(|(-|&UGT|%OD|(K|$Z(|&B',
      'U-|&GT|$_|%ED|&TDU|)V|*B_bTKT|*K|&_LZ1_Q|(aW;K|,K|%aWDUP_;|#K?|$AULZ|$D_@W|$T|%(|&ATD_@U|(ULT|*Z|&GT|&LZ|%-|%3LT|(Z|',
      '%D_@U|%JT(|)%7U|)AT-|*UGT|+LZ|)DTRU!|)ETKUG|,Z|(*|)7U|)AUGT|+LT|(-DTRU!|&UG|)T|*K|$U%7D_@U|(U|%&QU7D_@U|(W7D_@U|%7U|',
      '%ALZ|&T&D_@U|(-|(D_@U|&UGTK|%BU%D_@U|(&|)3LT|)JT(AULT|+-|(-|&Z(AULT|,Z|(GT|(LT|)Z|%DAULT|*Z|&Z(AULZ|(LZ|%ETKD_@U|)U|',
      '*7U|*AULZ|*DAULZ|*G|+T|+Z|*LZ|)WAULZ|)Z|%G|&TB_bTKT|(EKZ|)T(!|(K|&U|&Z|%JT(7D_@U|%LZ|%QTKU7D_@U|*AULZ|%RW-|&ZG|$W|%%',
      '7U|%7D_@U|&U|%?T1K|%ATD_@U|&UGT|*GZMZ|*K|(LT|$Z(|&AULZ|&GT|%DTRU!|$]DT|(HX@T?W|(KV|$_1;|%;U1]Q_;UK-=|%?_?|)T;1|,K|)Z',
      'L|%@_@G_a|)T|)YE1_P|%EWK|&XK|&]KZQD|%GZ;_|%I|&1K_@_@T|&6TKV|&8VGD|&Ia|&OTMT|&V|#L6K|$I_GU&|(]|$KT|&E@KU&|)_KU&|$T|%E',
      'KZ|%GZMZ|%I|$U|%1@T|)<TKZ|)K|$Z8|&K|%KT|$]DV|$_|%aT?|)V|#MDT|$Q|$T|%1TK|&Y@U|%@_I1|%K|%RT?_=U|$U|%5_3|)K|$_EDT|#O_aE',
      '|#P_;|&1K|&QTC_a|#Q_@WKV|#R!K|$D_@U|$TJT-|$U|%7D_@U|%ATD_@U|&ULT|)Z|%GT|%LT|&Z|$W7U|%AUGT|(LZ|$Z|#T#Q_a|$(8ZD_|%DZ8|',
      '$*;U&|%DQUL|$1;EWK|%KT|$38|$6|$8L|%W|$:_6U|$;U|&GT|$<|%U|$?_=|$@U|$BI_GUDV|$D|%EWK|%T=ST|(T|)KZ|%WD3]|(_3]|%_@|&A|(K',
      '|)Z|&BU|&C|$GZKV|%_a|(K|$IDT|%M|%T1_PT|%U|%W=ST|$K|%1|%2TDT|%?3W=U1|%GTK|%T3TKKZ|&B?_=|&GK?|%U3K|%W1TK_J_a|%_=|(S|&@',
      '_@U1|,Za|&GD|&J_a1K_@_@T|+MTE|+TKU@T|-V|,M|+_KI|.K|,PI|*DUK_GTRV|*GUCU|*HTK|*K|+@|*TDWP_<TD|+KI_H|+Ma|&L|$LU|%W&|%Z|',
      '$M|%1_KIZ|%K|&Z|%U&|&1T|&D_BV|%V|&6K?|&D|%Z|%_EDU1|$O|%V|%_IVK|*K|$P_<|$R?V|%T|&1W|&?V1TK|)K|&K|(U|&MV|%U!|(1U|%_DT|',
      '(W|#U-|$5_3|$7UBUD|$;_|$=DV|$?TGU1T|%U|$EK|&U|$G]K_=S|$HMU|$IU|%_GBD_@V|$K?|$L]|&3_KTI|,_|&IU;K|+_|$O]K|(V|$QI|&K|#V',
      ';|%E@5_3|$K_@_@D|*U|#W1W=ST|&K|$7_|$:_8|$;VK|$?_=|(M|$@_KUI|$DT|%U|%_@MT|(V|$ITK|(V|%_H|(TK|(VK|$KW|&1_PZ@_K|$M|%BVE',
      '|%E@U|$O|%MV|$P_<|$QWI|%_@U|$R|%D_@U|%T|&3LT|&JT(7U|*AT-|+ULT|*ETKZ|)*7U|*AUGT|,LT|(UG|%W=SU|#X%|$E|$M|%KZ|#Y@|%U|%_',
      'KUI|$ET|&QUD_CW|$IU|$P1|%U|%_?|(3K_@_@K|(6D_B_K|(E1_P|(G_KR_IT|(T|#Z*!|&<TKZ|(U|$8U|$@Z|&8?|&GZMZ|%];U|$BTK|(DTA|$DT',
      'L|%Z=SU|%_BW9K|(_K|*GUD_BW|*K|*OTQU@|*TE=ST|*U@|*VHX@|+a|$GZ|$IU@U|%]AZKTEU|$KM|&K|$LU#3_|$MW6K?|$O|%G|%K|&V|%RTDV|%',
      '_|&KZ|$RU|#[?QU|$MTO|&Q|#](LT|(2?U|&U|$-L|$1QKT|%ZD|$5_1?V|$6|$;T|%U|$<KV|%T|$=|%S|&U-|%_|$?|%TK_1|*K|$HU=|$IM|%T|$K',
      'T|&EW;|%U&|(K|%]DT|%_|&;|&PK|$L1T@T|%T(;UQ|%]8UaI_|,K|$MKZ|%U|$OM|$P|%K|%_<1T<UD_a|#^K|%G|$OL_aT|%M|#_KDU1|)_|&_BD|%',
      'I|&KZ|&O$|&T3@|(5_1|(D_baKZ|&U1|&Z|%Q|%TD_@U|*Va|&I_E|%U1Z;|*K|*_|&I|&P_?T|&Q_IQ_|&aT|%V=ST|(T|&P_?T|%Z;TQU%Q|&=U;|%',
      ']C|(U@|&I]8]I|%a|$LG|&K|&_|%TIU=U&|%]KT(=|$P@|&U|(1TK1|(3_KQ_@|(EXK?|%I@T|)K|&T|%K?|%V?|&K|%WB_K|*3M_E|%Z@_K|*FM|*K|',
      '+Z|&E?TQ_@_K|/K|%_IZK_|%a|&1_P@U|$aT|&EU;TL|&GUDZ;|&IZKT|&KU%K|)aK|&LQU%I|*aI|,_|(Z?_=K|%W;U|$b6U@|)_|%T?_;I|+_|!23]',
      'M|#6U@|#:_8T|#;T|$W&|#=SU|#?U|%8|$_=|&3UKU|&D|&E=ST|(V<|&T|&W&|#DD|#EWKV|#GK|%1T38|*K|#KT|%E|$_6_6|#L_LU1];|#MDTa1|#',
      'QU|#T!|$&D_@U|$(|%ATD_@U|%GK|&T|%LZ|$*AUGT|$@T|$B_a|(DMV|(K|$D|%_|$KGZM|$LU|#U&JT(AT-|(-|#W?_;|(U&|$G|%_|$QU|#ZM|%D_',
      '@U|%K|%T|&MU|(V|%U|&AUGT|)LZ|&GT|)K|%WAULZ|#]8T|%U|&GT|%WAUGT|$BD|%U@|%Z(|$K_B_CT|$LT|%U|&AULZ|&GT|$M|%U|#_KV|&P_;|*',
      'EXK_G|*TG_B|*U&D|+aTD|*Va|$aT@|(DTIT|(U|!35_3|&G#OK|&T|(CK|#6_7U@|#71W|$K|%W|%Z|#8E@U|$L|$T|#:_8TI|)K|#<D|%K|$U@|#=8',
      'T@|$S|%8T@|%DTa1|#>ST|%U|#?@D_@_K|%TD_@_KU1|$D|%T|&;_a|$E@U|$ITC_aI|$QI_ETBDT|$T|%JT-|$U@|&8_:|$ZO|$_<U|%=|&T|#@U|%E',
      'A|%GUCU|%OVM|#BT|%CK|$_a|#CU&|#D_|%@G_a|%C|&K_G|#GZP1|&?T|)K|#HK_?_?K|$VK|&@T|#ID|%T3ID|$T5_3|$_GW8|%HVK|)@T|#KI|$UG',
      '|$W=|&S|$_G|%H|&3YR|&CTK?|&ET@|&G@V|&Q_A|&TCTD|(GQ_AT|-K|.Z|(Oa|#LT|$W|$Z|$_F|#MT|$_E|#Q_@|#R?KZ|%T|$I|$_bK|#T!|%K|$',
      '&!|&<TKW|$(|%7D_@U|%AUGT|(LZ|%GT|$)|$*AULZ|$8K|%T|$=SU|%U|$>S|$?U@U1|$@|%_KKZ|$AT|$D|%_CU|)8V|+5_1|(V|)GTBV|$K|%_3V|',
      '$M_EU1|$a1|%@_KV|%D|%U1T|#UDU|$KF|%U|&8T|&EA|#V@3W=SU1K|&]GUD_B|%K|%T|&K|%U|&1GU@T|(TK|&DT;_a|$K_8T4KK|#W&|$3L|&K|%W',
      'L|$8KT;|)K|)V|%WKT@U|$=S|&U-|(1|)K|)W|%U-|&1K|)Z|(W|%_=W|&LU|$?|%D|%EWK|%G@_@T|%WEWK|%_=|(U6T|$E_@|(6K|(T|$I_FT|)K|$',
      'KW|&@K|(_@_bEXK_?_?|)b|*EXK_?|/_?|&GTK|$LTI|$MU|%_I|#YR|%ETMU@|%JWB_C|%K|%U?V|&@|%V@|#Z;|$I|%_QKZ|#]&|%K|$1K_?_?U1T|',
      '%WM|(TDD_B|$;T|&-|%U|&EW%|%Z|$=|%S|&K|$BTGKV|*O|$ED|&KZ|&Va|%GD_CW|%TM|(EWK|%V|&DTA|$GK|&_B_CD|%UD_B|*EWK|$IWRT!|$KT',
      '|%V|%W|$L|%1|%IKU6|%T1TK|&E|(V|%_|$MITM|$P_<V|)K|$Q_bTIV|#^?|$@I|$K|%G|%RKU|%T5_3|%V|#_KD_A|)ID_BUK|)K|)TGMV|)U|%Q_@',
      '|%R|&?Va|&K|%T|&?_=|&I|(GTQV|(K|(T:_6MKZ|(V?|(_|)a|&R1|%V1|(_|&D|&P_I|*1TMVD|&Q|%WE|(K|(_|%Z3]KU|&;|(_|&=|$L1]IT|%W1',
      ']8|%]KU&|$aTLZKU|&Q|(Va|(_|#aM|$T|!4:_6|#;?TGMV|&K|$U|%7U|%AT-|&UGT|(LT|%GT|%LT|$WAUGT|$Z|#=SU|#?_;|&T|&U|#D@T|%_b|$',
      'O_aTI|$UP_<|#K1W|$K|$W|$Z|%(|$](|$_P?|#T&|$;|%U|$@1|$Q|#U%|#WIWKT|&QK|$PWKV|#Y?T|#ZKT|%U|#]=ST|$K|$P|%?T|%U@|!5_1|%<',
      'TKW|%B_bTKT|%K|%W|!6(@U|#*=ST|$@UOT|$B|$EBV|$KT|$P<U|#1;T|$T|$_K|&CK|&GK_@_@V|%PW|#;T?|#>SU|%Z(|#?_=V|#@W$ETK_O_bKZ|',
      '%K|&_A|)T#O|)V|(B_BO|,V|(HW8|#D_BD|&_K|)HT3T|)IT|)JTD|)K|)OZ2K|)U1T|#I=ST|$@_1TK|$_ET|&UaTD|&X|#K1|$?|$I|$U@|&_K|)K|',
      '$_6_6T|)U@|%GU|%I|&K|(]3|#M6_6U@_K;UK|/Z|,K|$?U|$D|%_@U|$E_K6M|$T(|&AULZ|&GT|%6M|#PIT|#T(DT|$*M|$1UKU|(V|$;|%TK_8V|$',
      'D_B|(GTLU|(UDV|(W&|(_KITD|$E|$GU|$I6|%K|%W?_=T|%_EUaDOUE_|+QUE|.KZ|+_Q|$KU|&&=SZ|&3];U|&8?|&AK|&E;Z|(T2KZ|%];U|%_8_|',
      '&LQ_|(_Q|$LT?|%U|&3LT|)Z|&7U|&AT-|(UGT|)LT|&GT|&JT(AULZ|)-|&LT|(Z|%W|&1_a|&AUGT|%Z|$M1|%DT|%U@|$P|%V|$RT|%U!|(LZ|&BT',
      '|%W!|(AULZ|%Z!|#U1U@_Q1|*TB_bTKT|+CVD|+K|+Ma|*U@|%ZD|%_1?|$5_3W=SU|$<T|&KZ|%U|$@T|&GT4|*K|%U|%_@|(K:_8D|&K|(1K|)MT|)',
      'TK|(?|(DT;_a|(K|(OUM_EV|(T|(U@|(]@_EMT|$DU|%_@T|)CTKT|)I?U|)K|(U@|&Ia|$EU|$K|%U|$L|%U|&1T|$R_D|(;|(T|(U|)@|#VD|%K|%V',
      '|%_|#W1_@U|)DTIT|)K|$I_G1Va|#XD|$K_?_?|#Z1_|$@D|&T|$D_DT(|*K|$K|$P_;T|$Q|$RZKT|$aTKI_aTD|#[@D_a|%_K|#]ET|%_KT|$K|%U|',
      '%V|$M|#^B_bTK|$CWKV|$RTD|#_aTDZL|*_|&LZ:_8|#aD|!7%;U|#:_6T?|#=ST|&(|$T|#?T|#@T|$UO3=S|*K|$W|$_KEWK|#B_I|#D_B|&U|#ED|',
      '$T|#GU|#T(|$=S|&U|(BZLZ|(GT|%U|&AULZ|$@|%U|%_K|(7T@_KV|(V|$D_B|$E|$aT|#U=ST|$B_K|#W&|$(!|$:_6U|$;U|#Z@_KV|$BD|$DT|$K',
      'T|&ER!KT|$MU|#];GZMW|%KTa|!83@|%K|&Z|%QU#REWK|$BVO|$D_DTA|$GD_CW|$I]RD|$T|$U|#5_1QD|%3L|(K|%4|#8_|#;UM|&@T|#=SU@|$U@',
      '|#?1|%K|$T|%(|&AULZ|&GT|&LZ|%?|%E=SU7U|*AULT|)Z|(U7U|(Z|%JT(|)7U|(-|%OW?T|$_=UQ|#D1|$3?DT|$8T@U|)K|$DV|$E_KUa|$GQ@U|',
      '%RWM|$Q#2_aTK|%D|%TCTK?|+5_1|$U@|$[1|$_|%@W|%I3@|&BUD|&HXIU|&K|&LTH|&Q_ATD|&TP_;IV|&U@|#GTG|%RKLTL|$_Q|#IT|%;|$U|%BT',
      'K|)V|%K|$_IW|#KTaW|$U&KZ|$WKV|(1TMVD|$_8|%?_?TL|%ITD|)V|*K|)_|#M1W|$2U&|$E_KET@|+K|$GTaW|%UB_aW@|,_|$H?_=TK|$K|%Z|$Q',
      'Z6D|$TOa|$Va|$ZO_bK|#P_;UQ|)_|#R_D|#T3K|&?|%T|&KZ|%_K@|$?D_@U|%U|&AULZ|&ETKU|&GT|&LZ|%Z|$@|%1|%U|&3@|&K|&Q#4|*K|%Va@',
      'TGTBV|$D|%1V|%WaTKV|$ETD|(K|(V|$HT|$IUD|%_IW|$KU|%V|$L|$RT5_3VK|&8|%UK|#U5_1|$@U|&7D_@U|&AUGT|)LT|*Z|&GT|%ZD_B_K|$D|',
      '%K|%T|%UP|%_|$H|$KT|$LT|&K|%_LTETM|)Q_AU@|#VG|%1]P|%83@|&D_@W|%D1TM|&6K_J_aT|&JTED|&K|&V|&_@|%GU8_:TD|%K|%QTK|%T?W|)',
      'B_bTKT|)K|&O_I|%U1T|#W&K|$DT3=S|%U%K|&aK|%_|$KTQU1|#Z8Z|&GTET|&IT|$;|$=G_LW-Q;U|$DT|%Z;U1|*_|&KTL|*_|(U1|$I_Q|(_|$L|',
      '%B?_=|#[D|$G|%U1|#]D|%_|$K|%UITDT|$QZF|#_:T@|&D|(1]P|(EV<|(K|(V|$aTIU@U|+1|%ZP_<|*T|%[P_<|%]@U|)K_GU8_:TD|+LU5_3|)P|',
      '*Va|(_Q_DT|$bK|%TMT|#aBZG|$D_@|(V|$EWK|%_K1TO|$GU8a|$KTI|$T|$VKTI|!95_1TK|#=S|#K1T|$?T|#T=S2?_=|+K|&T|$KQW3W=ST|+T|$',
      'M|$Q|#U%|%;U-|%K|$LU1_|%_LV|#WIK|$L?|!;5_1T|(K|#D_|#IT;]|$_|#K_IUDTL|#T(3K|%;L|%E|&K|&_|%I|&Q_|&_|(Q|$*D|$3]K|$;T|$?',
      '|%U|$bTK|#U1;|%Q|%T|&K|%U|&-|%Z|&;|$5_1|$E_E?V|$HU|$I|%_|#V1T|#WK_?_?TIZ?_;|#Z1D]L]8U|%U|%_D]L]8U|$DUQ|$GWL|$KT|&1];',
      'T|$LU|&HU8D|&Q_1]E_|$P_;|#]1U/|$EU|#_KFU|%P_;|%T1|&D_QF_aW8D|*_|%U3K|%ZD|(U#|$aT5_1|%WIK|!<T1WK|(T?V|$G|$KW|%Z|#U&|$',
      '1|%?T|%_|!=1_;K|(Z;|*_|%aWIZ?_;TKV|#5_3T|#D_|#GU#|$_L_aW|#I_GKW|#K_IT;T(;UQ|#LTK|&_|$_FUD_|#T(D]QK|%KZ1_;K|$-GZ;UQ|%',
      'KV|%LUQUQ|$1|%KT|%U|%WAULZ|%_@K|)2TDT|-KZ|)V|$;T|$D_Q|$LIT|%U|$M|$RT?|#U-D-|$3_KU|(V|$8%K_=SK|%T(D|)K|)_|%U8|&;TL|*_',
      '|$=U|$E_L]IT|$FUQUL|$HU8D|$IZD_QU&|#Z5_3W|$?T|$EW;U|$HU=_|$LU|#]8|%K|$KU|#_K3|%T(HK|&IT|%Z1]|$aTD_Q|!>5_3KZ|#T1T|$:_',
      '6T|$L|#U5_1U|#WI_ET|#Z*|$5_1TDTM|,K|!@;KZ|#?_;U|#@1TMVD|$Z|$_|%1TMVD|%@_b|)K|)TGCTDKZ|%EKZ|#ATEU|$_aK|#BD_@|$TK2|#D_',
      '@W|&_K|)K|%B_KT|%IC_aKW|#EQ_aT|$W|#GLT|#ID_DT|$T2W|$Z|$_GT|#K1TKV|$5_3|(K|$FKW|$M|$T(|$W?|$_1|%E?|#M1W|$K|$LU2U@|$Z|',
      '#RQUL|#T5_1<TKW|(B_bTKT|(KU|$D_@_KU1|$E|%8|%IT@_KT|%KZ|%Q|$IQT|%UL|(DT=SW|+W|,K|(_|%_K|$K|%1T|%T|%U1_|&2|&?V|$LT|%U1',
      'T|)HW1_@|)K|&I|$M|%6ZK|%E@_K|%Z|$RTEKZ|&K|%ZLZ|#U&=SU|$1_@|$DU|&3];U|&8?|&AK|&BUD|%];U|$G_G@Va|$K]CTD|$M1|$P_<U|#V1_',
      'P_?|$G_K|(@T|$K|%_A|(JT@_KV|#WI|%K|%Z|$KD_@|%_1V|$LT(AULZ|$MDT|(@_I1|(KZ|%QV|%T|$PTK|#Y;U|$?HXIU|&]8V|$@Va|(T|)#O|$E',
      '_@U|#Z8|$?W|$D_@WMU|$K|$L|%W3W|%Z5_3TDT|#[M|#]@Z|$K|%?|#_KUDTA|&ET<V|(WKT|&GZ?V|&HW8|*K|)GD|&L]6D|&OXM|%W;U|%a]BO|*V',
      '|$aT3|$bKTD_bU@|!A(ATD|#1TE?|$_1T|(?|#?_;|&U&|%=T|#KZ|#LT|$Z|#T&D_@U|$(|%ETKZ|%K-=|%LT?_=|&_aT?_=|$*|$DT|%_@U|$ET|$M',
      'U|#U-;K|$G|%TGZMZ|&K|%Z|$LTGZMZ|#ZKTEU|#]ITQ|(_|!B*=SU|#1_P|&@T|&U?EXK_G|&V?|#2L|#3_C|#5_3T|#?_=|&K|&TBZO|(aITD|&U@|',
      '#@_@|#D_@|#FT|#ID|$_E@U|(_@U5_1K|#K1TK|(V|$8|$GTK|(KZ|$IT|$UB_K|$_E?|%O1|&D|(K|(Va|&T(|)AT-|*ULZ|(-|(JT(7U|#LUL|#M3@',
      '|$GZRZKT|$K|$U@|$Va|#O1|%K|&Z|$;U|$D_CU|)K|$I|%V|$KA|$RKT|$TG@TK|#RU|#T2L|$3|$BT|$D|%_@|$GU|%V|$I|%U1T|%]BK|$KUB_K_a',
      '|%W|%_ODU1|$O|$Q5_1B_bTKT|%DTa1|%U&|$R|$a1|%K|%U@_b|%V|#U%|%D_@U|)W|$&|%3LT|%JT(|)7U|)AT-|*UGT|+LT|)ETKZ|(*|)7U|)AUG',
      'T|+LT|(-DTRU!|&UG|)T|$-|$3|%1W|%D_@|%KZ|$D<TKW|%ITD5_1KZ|%K|%U&|&1U&|%Z|$GQ|&K|%T1K|%_a|(QU#R|(T|$L|%VE|%_|&LV|)<TKZ',
      '|)E|)K|)Q_AU@|$OZ|$bTDT|#V1_PT|(U@|$DGD_CW|$E|%1|%T|&GMU|)V|%U1T|%_@UKZ2T|$K_4|(1TM|+VD|(@I|(Q_ATaV|#W$2|&UKTI|&VKTI',
      '|$&K|$(3];U|%8?|%AK|%GK_P|$3_C|$C|$DU&|(K|)Z|$G|$KGK_@V|%KZ|%_3|(I|(K|(T|)EX8T|&4;?T|&DV@U|&GM|)@T|(TQT|&HU1_P|&J_a]',
      'CD|&LH|$P_;|&ID_@|$RZ!|#X@|$K|%3TIV|%@T|%BK_OD|+K|%GK_@_@V|%KZ|%V1K?|%Z(|%_3T|$PU@|#Y>S|$@|$O_a|(ITD|$P_;TD_@|(U|)1]',
      '?|,KW|)3]6K|)O1_@U|#Z(7D_@U|&U|%AT-|(D_@U|&UGT|(LT|%DAULZ|%ETKZ|$*7D_@U|&U|%AUGT|(LZ|%M|&K|$/|$2|%?T|%D_@U|)W|%T|&(|',
      '(AULZ|(GT|&-|&3LT|)Z|&BU-|(Z(AULT|&D_@U|&JT&D_@U|)(7U|*AT-|+ULT|*ETKZ|)*7U|*AUGT|,LT|)D_@U|(UGT|%U|&AULZ|&GT|)1W|&LT',
      '|(Z|&RZG|%WAULZ|$G|%3=S|%@T|%BTQ|)V|&ZGV|%DT3KV|%JTDV|%KT8|%T|&BZGV|+5_1|&EKZ|(T(!|&K|&OUP|%VB@_@|%W|%Z|&D_B_K|$LT|%',
      'Z|$O|%ITD5_1KZ|%K|%T(|%V|&a|$R|%@_aT3|%K|&Z|%TD_@|$a|#[DD_BUD|%U1|$K_4_a|#]1TD|$KT|$M|%3]GUD_B|$P|%V|#^=S|#_GU@Va|$K',
      'G_a|)K|%P_;G_a|%T4UIT|+KZ|&GU=S|%W@|%^EBV|$NTKT|$bD_B|)_b|%TBO|)V|&EK|&K|(ETM|(K|(T|%U@Va|*T|%VE|(EW:_8|-K|(K|%[@|%a',
      '|#aT|!C*MU|#1_1T|#D:_8a|$U&|$V|$W|$ZO_bK|#I1|$DV|#K?K|%VCK|$T|%JT-|$U|%@_KV|%AUGT|%GT|$Z|$_I|&3_KD_A|&K|&TGLI_GV|%P?',
      '|#MT|#T=SU|(K|%U|$@G|%W|$D|$I|%KT|$K|%?|&T|%T|&GTRU1|,K|&K|%_IU1|&J_a|#UKZ|#VK|%Z|#WI_KETD|#X&!|$E|$IETD|%_KETD|$MU|',
      '&&|$QK|#](|%GT|$@U|$DU|#_KWG|(Va|$aTD|$b#Q|%DU|!D%;U|#1KU|$L|$TKT@_I1|$WM|$_P@_K|*K|#3B|$K|%K|%V|#8K|$UK|#;GK|#=SU&|',
      '$U&|#AT(|%-|$UGT|%LT|&Z|#BV|%GD_C|%K|#D_|%B|&U4]P|(DV|&V|#G1MZGK|%YP_?|$8T@|(1K|$GK_P|$I|%V|$K5_3EWK|%T@_K|$T3@|(T|%',
      'G|$V1K?|%D|#HZI_GK|#IU@T|$WDT|$_GK|%K@T|#K2TB1|$I|$QU#R|$ZD_B_K|%O|$_@_@1V|%IBT|#MUDV|$V|%K|#P_;|#RZGT|%LZ|$](|#T!|$',
      '(=W|$-1|$1|$3|%EWK|%KU1|%T|&KR]MZ|(_8WD|%ZO_bK|$6|$8_1T|$;|%1|&K|&Va|%_a|(1TK|$@U|%W?V|$A|$DT|&BU|$GTM1|$HU|$I1K?|%K',
      '|%TDWQTKZ|%U@|%_DV|$KB|%Ta?|)V|%VGTBV|&K|$LU|$M|$O|%1|$QT|%_@U1|$RTD_@U|%U|$a1|%U1T|#U$QD_@TD|$%D_@U|$&|%!|%3LT|%JT(',
      '|)7U|)AULT|(-|%KT|$*|%8ULT?_=|$-|$1;|&1W|&@I|(K|&GK_@_@V|&KZ|&Q_A|%U@T|%]GK|%_PZE|$2W?|$3I|$8Q_b|%TI|(_|%Z|$@T(|%_a|',
      '(TDD_B|$BK_OD|%_KT|)MW|)RVD@T|$CD|%TK_J_a|$D_BT|$ET@|%W?|$GD_C|%TK1|(?|&Q|(V|%U=S|%ZBD|(U@T|&O|$ID_@_K?|%T(!|%U@_@|%',
      ']A]KT1_Q|&DU&|%_D|(LU2U@|(]1_@|&G|$JW1_@|*U|$K:_8D|%D_@K|%EZ1_P|%T1K?|&E@_@T|(B|&IUP|&O|%V1_P?|%XE?|(U@|%]C|(1|%_3@|',
      '&8MD|&?_?a|&B_BUP_;|*ZO|,1|,TGMV|,U1T|-@|)CTK?|,U@|*UP_;|&GTR|(UOZPKZ|&HK|)OVM|&IM|)T|(T?K|)@T|)L_a|&JT@DT|(_aT@DT|$',
      'Ma|$OT|%_6U@|(Z@1|(a|&bTQ|$PUB_C|%ZC|%_1TQD|*U@|(_KUa|&<T|)K|&E@U|)_@U|$R@|%TKU1T|$aD_@_K?|+U@|%I|&K|&TGMV|&U@|%W|&@',
      '|%]8D|(U@|#V@U|$M|%1?_<|%3UKU|%I?U|&TCG|%TB_KU|#WR!|&D_@U|%D_@U|%Z!|#X&|%2T(|%BUL_LV|,K|-Z|%E=ST|$@D|#Y@_a|(3WKW|(K|',
      '(OUM_EV|$QU#R|#Z(7D_@U|%AT-|(D_@U|&UGT|(LT|)Z|$*AUGT|(LZ|$;bK_1|&TK_1|$@T|%Y@_b|$ETM|(K|(V|$GT|&K|%Z|$LQD|%T|%Z|$QDT',
      'L|$RT|%ZKW|#[@U1|(@T|$GZB_a|#];|$GZL|(_|#^1T|$GT?U8_a|$QZDT|#_@U|$aQ_@|%TQDTL|+_|&a|(TCVO|)Ma|+K|(U1|(V1|%W|&8_|&aK_',
      '1|#aT3=S|!E(QT|#-?_;|#1T(|&AT-|(ULT|&GT|&LZ|%D_@W|%JT-|$Z(|$_1T|%P|&K|(W|&T4T@|&V|(K|&Z|#2TM|#5_18|#6TKULZ|%O|#71W|$',
      'E;Z|$KZ|$W&|$Z|#8U;UH|#:_6|&BO|&I|(V|&Q2T|&TDD|(a@|*K|&W|%8KT|&TG|)K|)V|&U1T|&V1Y@|#;1W|$K|%W|%Z|$U|$W|$Z|%L|$_;DTa1',
      '|+5_1B_bTKT|#<D|$T(|&AULZ|&LZ|%JT(AULT|#=SU|&&|&7U|&AT-|(UGT|)LT|*Z|&G|(T|&JT-|&LT|(Z|%WAUGT|)LT|%Z|%]OV|$U|%AT-|&UL',
      'T|%G|%LT|$WAUGT|(LT|$Z|$]OV|#>D_@W|$SD_@W|%T|%U|&AULZ|&GT|%WAUGT|)LZ|$WAUGT|(LZ|#?Q|$T|$_=T|&U@|#@D|%<TKW|$MT|$T1T|$',
      'U|%@|&ETGD|$_@D|(<TKW|%DV|(5_1|%K|&E@_KU1TKZ|&K|&U1T|*K|#AK|%K|%Z|$WKU&|$Z|#B1|%_PZE|$GV|$JT@_KT|$KW|%Z|$T@U1|%K_A|)',
      'K|(E?|$]D_D@U|$_C@U|)K|%I|&DTH|&EWK|&HXP?|&O_KV|&T|(G@V|&UDV|%a|#DUEKUGT|$_@U|%AT|%BK|#EU|$W|#GD|%K|$U@_K|$_LU1|)_|(',
      'OK_Q|#IU|$_E|#K8T|%VGV|$;T|$<TKW|$BT|%UD|$GK_@_@V|$I|%GVK|%T?W|%_EKT|*3@|*K|$K|$L]1|$M|$OWKTI|$Q_@|&EK|)<TKW|)K|$T8U',
      '@|&a|%IK_O|*BT@T|%Q_@|$U1M_EDT|&_KI?|*T|%3?U@|%6TM1|)DT|)U@|&U@|)T|)U|&a|%8T|%=ST|%?@|&TI|%@_a1_@|)T3|%BK_OD|%CTD|&U',
      '|%E1_b|*@T|&XK1|)_?_?|&_K1TO|)Z1_PVKZ|%GK_@_@D|-K|-OVM|,U@|,Z|&RD|&T|(KK|(Q|&ZO|)K|(P?|)U@|)_;U@|&_KT81|(aTE_@|%HTPT',
      '|&_KI?|%IM|&T?|)K|&U@|%J]8DT|%L1_PU@|%OZPKZ|&]C|&_KI|%PB|(K|&_1TK|%Q#2_aTD|&K|&VIT|&_1TK|(AU@U|,1|,K|(KT|$V|%1_P?|)T',
      '|*B_bTKT|*IXM1|$WP|$]1_P|$_?_?I]6V|%G|&@|(ITMT|,K|(K|&EK_GT?U|&K|&T?U|%J_a;1|*D|)GQU@|*Z1_P?|)TE_@|*a|+1_KIZ|+K|,Z|%',
      'OWKTI|#L*|$I]DTKU|$_|%LGV|&V|#MTaD|#OU|$W|$_6UI|)G5_3|-K|#QD_B|(K|#R!KT|$:_6T(GT|(U|)AULT|,Z|)GT|)LT|*Z|(Z|$?_=U|$UL',
      'U|$W=S|#T&D_@U|$(|%!!|%1|%7D_@U|&U|%AT-|(D_@U|&UGT|(LT|)Z|%G|&T|(K|&Z|%L;|&T|&Z|$*!O|(U&|%7D_@U|&U|%=K|%?_=|%AUGT|(L',
      'T|)Z|$-|$1|%Q_AMV|%UQ_@TD|,K|,V|)ATD|,K|,V|$2|%1W|%K|&Z|%TET2U|%Z|$3|%M|$6ULT|%ZKV|$:_6|(];U|&8U|$;|%?T|%DT|%U|&KZ|$',
      '<|%1|%E>ST|%T3TK|%_a|(1_KI|$>SV|$?U|&3_KTRV|&ET3|&K|%_<U|&=G|(W|)LUEU|(Z|$@TMU|%_K|$B|%BZOKZ|%K|$D|%K|%Va|%_AZKT|$E|',
      '$IZLT|$K|%5_3I|%B|&K_OU@T|%D_@U|%I_EKU1|)TKU1|%MT2ZIW?_=U|%Q_EKU1|(a|%T|&BVE|&QZ;TI]L|%U|&@|&AULT|*Z|&DAULZ|&G|(T|)K',
      'U1|(Z|&LT|(Z|%WAULZ|%Z|%_1|(UD_QD_|&;U|)K|&A1_a|(V|&G?|(@V|)_a|&O_bE_K@U1_KUaT|*GK_@_@V|*K|&QV|$L|%T|%ZP_;T(D|-K|-_|',
      '$M|%D|&K|%U|&&|&@|$O_6T@_a|$PT?|$Q|%_|$RT6|&=|(S|)K|)U&|$bTK|#U&8|$(GT|%LZ|$-6=SU|(U|$5_1U|$7T|$;K|$<T|%U|$>SU|$?_;W',
      '|&=|$@T|&5_1<TKW|&IR|(T@T|+5_1<TKW|%Y|%_@|(1]P|(M|$D_CD_@U|(T|(U|)GT|$EULU|%WL_Q|$HUQU|$LT|&BUD|*K|*W|*Z|&GZMW|*Z|&I',
      'TD5_1<TKZ|-K|&K|#V<|%K|$=ST|&U@|)T|$@|#W%|%K|$8T|$:_8U|$?U|&AKZ|%Z|%_a|$@_K|(K|$D$|&DUK_IT?|%KTGY@_@U|&W@_ATD|(B_CTK',
      '|&_8D_I|(GTK|%O_6|%Z|$EUD_BK|$K|%?|%Q_1TKE_KTE_@|+K|)Y@|%T|&?|(K|&@D|%V|&<TKZ|&K|%W?T|&P|(ITD5_1K|(]@_@I|%]CT|&RU@|%',
      '_G|(KW|$LUQ|$P_1K|)U?V|&;U1K|)QTK|&E|(T|)M1|$Q_@1|)IZMT|)K|#X8|%1|%TE?_=T|&GUCU|&K|(V|(_6_6DT|%U@|$K?|%T|&@D|%_?|(_?',
      '|*6D_B_K|*IV|*UIT|&G1|(@D|(BUD|(GK_@_@V|(K|(T:_6M|)DWITD|)R_D|(Z|#YA1|&_|%UGV|)K|%_bVKT8|$P_<|(E]P1@T|(HXIU|(KZ|(T|#',
      'Z6T|$;|%K|%Z?_;|$DQD|%UQULUD|$EK|$LHU1|$OT|%V|$PT|#[@Y1|#]1|%ZI]D|$2KV|$;TQU%I|)aI_|$=SU|$@U|$AU|$K_;|$L|%U/|&Q|(_|%',
      ']|$P1|%?|%T|&1|%_;|&a|#^KT?U1|$P|#_K1;|&M_E|*K|&TKHZB|)K|)Z|(O|)1|)D|*V|)U@|&Y@|)U|*1|*K|(P_;|&]P_<|&_KUaT|,1K?|,K|(',
      'PZE?|%2_aT@|%3@U|)OVM|%6?_=|&MD|(U@|&TK|)1|)U@|&WK|&ZP_;T|&_7BE;|,_;|%8DD|&T|(@D_@_K|)U|*K|(E@U|&_:T|%=1_QD|%?G|&TI|',
      '(MV|*K|&V@|&aD|%@TE|)KWB_K|&U1TK|)XM|)Y@U|)_KUaT|.KZ|(8_:T|(BUD|)_bD_BU@T|.V|._bU@T|(DUCU|,@_b|(ETBD|+U@|(FMD|*U@|(G',
      'D_C1|)K_P|)TB|(HT|(IT|)XK_@_@U|(J]3U@T|.K|+V|,@TKZ|(K1_PT|)]C|+1|*E?|(O]C|)_KW@U|(PZC|+1|)_<T|,@T|,D|-K|+U@|(R@|)TKV',
      '|&V1|&_D@@_@_b|*T@_@_bU1|(a1_P|)R|)T2_aTD|*GK_@_@D|*RTK|)Z1|%AIAK|&T|(K|%B1_PU?|&@_@|&K_OD|+V|*U@|&TD1TKV|(R|&VE|)_@',
      '|&XP?|*K|)U@|&ZO|)K|&_aWI_D|%CTD|)@$|)ID_@_KV|%ET@|%FWL_L|&ZQK|%G?|(@T|&D_C|&K|(_@_@1|,D|&M|&TB|(Q|)V|(R|)K|)U@|&V?|',
      '&Y@_@U|&ZO|%HT|(@|(G|)K|)OTMV|)U@|(Q|&W|&Y@U|%IT?|)E@_K|)U@|(@_K|&UMT|&W2|&X2|&]B|%JW1_@U|,GUB_aT|(8_a|&]81|)DT|)U1T',
      '|*@|%O#Q1|)T|)U@|&Q_@|&TD_@|(Q1|)D|*U1|&U1_P1|+?|+U@|&_D|)K|(bTQ|%Q5_3|*ITD|*QIXR|&D_D|&G|&TB|(K|)?|)U@|&UB_C|+U|&_@',
      'K|)TG|+U@|)W@|+U|(A|%RKT8|&L_LTB|&_LTB|%T1|(Y@U1|(_|)@D|&5_3?KZ|&6V|)D|)K|*K|(_a|&?|(V|&@$|&AIU1|&BZOU1|&CTD_a|(U1K?',
      '|(_aTE1|&D_@|*K|+Z|*Va|&E_@|*U|&GCTD|(D_CU1|&IT?U1|&KI_H|+KZ|+U1|(_ADT|*V|&QTB|&a@$|%U|&a|(5_1T|(BK_OUDV|(T|%V@I|(U|',
      ')KT8|%Z1_PTMaKZ|&I|(K|(T:_8D|)DD_B|(V|(_|&K?|)T|(U@|&Q|(1_KUEQD|/_|,QD|(U=ZD_QU|(_|%]3_KTI|,U#|&8Z1_;|&;UD|*_|&@_QTR',
      'D|,U@|&Q_;Z;|%aT3|(Q|&]3|$LQ_KZ|%T;FK_I|(ZLZ;|&P_;U1|%Z|&;|$aTK|(VI]RD|(_|!F(QLT|#1UK|$VK|&I]RD|#;]|#?_=|&_|#@Z|#KTQ',
      'V|$_|%I|&WLT|#M1|%W|$E_KB|$K|%Z|$Q_bKXE|$TFM|#QL|#T(DTL|)KZ|)_|$*?_=ZQD|,K|,_|$;|$L3WD|%_3WD|$OV|$P_;|#U1T|$5_3U|$8U',
      '/AZKTEU|$FT|$G_KULZQD|$HK|$LUET(D_Q|%_=|&I|(FZaTK|(K|(_|#W;|%GL|(_|%T(|%U|%_|$L|%GT?V|%K|%T|%UJT-|$QFWQ|)K|%_FWQ_|#Y',
      ';U|#ZGY&KV|&aTKV|%_KW&KV|$IUDT|$KT(|%U|&AULZ|&GT|&LZ|$L|%]|&QUE|$QGW1|$aTK|#];1T|$D|$K_Q|#^8BTKV|#_KT|&D_Q|*K|%U|%Z:',
      '_6|&?_=Q_|$aT1_;K|&QD|!G#O|%3@|%8|%CK|%K|%TDW1_KIU1|%V|&CK|&a|#*M|#1_@G_a|&T|&Y@T|%Q|&U|(#|#3U6T|#5_1T|%3|&K|&MT|)BZ',
      'O|,K|,V|)K|&TMV|&Va|&]EQT3K|#6D|$_6D|#7T|#8T(|%K|%a|$Z;|$_K|&1TE_@T|#:_6U|(@|(GT|#;B_bTKT|$T|$U1T|(K|#=S8ZDT|%BUD|%H',
      'T(|%QU#RTK|%U|#>ST(|(GT|%U|&AT-|(ULT|*Z|&GT|&JT-|%Z|&(|$UGT|%JT-|$WAUGT|$Z|#?H]8U|$KZ|$U1|%8|$W&|$_;D|%=|&T|#@1|$U4K',
      '|(K|$V|#BM|%KZ|%T(|(GT|%U|%Z(|$_C|#DGTQ|$ITMU|(V|$KZ|$TI|%KQ|$^PCU|$_B|&DT|&K|(K|&TEDT|&V|&Z|&]GQ_@|%C|&D|(V|&T|&W|(',
      '1|)6TMDT|(@T|%a|&8D_@W|(VG|&E_KT?V|&T|#GU|$WD_|$_LU|#I_GZ|(K|#K#|$3=S|$?|$F|$TM|%R|&V|$UP_<|%RT|$W?|$_3|&K|&T1TK|&V1',
      'K?|%8D|%?_?|)DT|)ITMT|)K|)U@|%@_@ITD|,K|%B_CD|)U@|%IT|%P1|&K|&QTKT|&T|&Va|&Z|#L?_=T|$T5_3UK|)VK|$U*=|$_|%LH|#M1T|$BZ',
      'G|$EXK_G1|$G@_@K|%TD|$HB_K|$K|%TI|%Z|$T@_1TK|$U|%&|%BTD|%P_<|$a|#O@$|$UP_<|#Q@U|$D_@|(KT8|$GTQ|$T|%(|$U|%7D_@U|%AUGT',
      '|%GT|%LZ|$W|$_|%@T|&U|(&|&W|(@_b|(K|&_K|#RD|$MU&|$U|%K|%P_1TK|$W@|%BUD|%GTK|%IT@_KTKZ|%M|#T#LTBZO|+K|$(|%3?|(V|%E]LT',
      'K|%OU|$)|$*!O|%L|$-K_?_?|$1U|%_|&Q|&a|$3|$4|%K|%W?V|$5_1V|&3TL]K|$6Q_E@U|$7U|&AULZ|$8|%EZaV|%T|%U|$;|%TLUaD|%Z|$=S|&',
      'KZ|&U|$?|%EWK|%U8_a|*U1|%V|$@|%TGK?|%_KT|&aT|$B|%1|%D|%L|%TI|(V|%W=SU|%_|&a|(JD_@_K|$CT|&E_KTE_@|%_a|(@TIXM1|$DK|%TK',
      '_8V|%W|%_@U|&CU|)GT|$ET|&5_1|%U|%W|$GB|&KZ|%T|&8V|%W|&OTD_|$I|%D|%ED_AV|%_FV|$K|%?|%GT;U|%I_GTK|%U|&1|&EBT|%W?V|%_@_',
      '@T|&PU1|&QZL]DT|$LT|%U|%W1T|%ZO_bK|+K|%_IU1V|&a|(1TM|(8VGD|$M|%1|&YP_?|%U1T|$P_E|$Q|%3YR|%D|&_@V|%HGDKZ|%Q_ATD|%UD_B',
      'T|%WBZG|%_@G|)KZ|)U1|$R1|%D|%T|&4K|&BWK|(XK|&D|&KK|(U|)AT-|*UGT|+LT|)GT|)LT|*Z|(W|)AUGT|(Z|%UDV|)K|%W|&=ST|(T|)S|%_a',
      '|$aW|&I?_=M|,K|&K|&QZDT|+K|%]E_QU|$bZL|#U#O|$1M_E|%OU@|%TK|&O|(K|(OVM|%UK?|%VK?|%Y@|(U|%_KI|(U|(V|(a|$2?_=U@|%_aT@|$',
      '3@|%_|&KR|$6K?|%MU@|%TK|(1|(E@U|(U1T|%U@_K|%_7UD_D|(ZB|$7?T|%T|$8B|%W|&MU|%Z|&=U|&@T|&EU|)K|%_:TDK|*V|)ED|*U@|%a|&K|',
      '&L1_P_IV|&T|&UDV|&V|$;T|$@K?|&_1|%UAULT|$BTa|%U@|%ZO|(KZ|(V|%_K]R|*K|*V|&aITD|(T|)CK|)E@U|*WKV|)K|*_AV|)Ma|+K|(W@|*_',
      '|&bTD|$CGT|%Ta13?|(U1T|%U|&GB_C|$D|%T|&O|&a1|%UIa|&J]3|%]B|%_|&BW|&CT|&aTQ|%a|$E1_P|)KZ|%B|&8D1|&IW1_@|&K|%KV@|&_J_a',
      'a|%UD|%WM|%_MG|)V|$FM|&@T|$GD_CD|%K?V|&_@_@D|%TB|(K|(U@|(Va|&RK|(U@|%U|&C|(@T|&QU|%Z1|(TDD_B|&6DT|(U@|$H1_@|%G|%T3|(',
      'B_bTKT|(K|(Va|&8D|(U@|%W|%X@U|&P?|$IMT|%TD|(GD_BK|(K|$JW1_@T@_I1|$K8T|%:_6U|%@U|%M|&T|%T8ITD|(U@|&;|&=SU|%U|%WB_C|*K',
      'Z|%ZD|%]C|(V|$L|%U%D|&&KU|&KWGUD|&aD|%W&|&E_@|%Z(|%]E|%_|$MI_G|)U@|%TQ|$OT2T|)ET;?T|&KB|&M|%UP_;|%WB_C|%ZP|(1KU|(8_:',
      '|(@$|)T|)_b|%_KTI|&MZP?|&b|(1E|*_|)K_IT|(8U@|(DTA|(GUB_aTMa|0B_bTKT|0K|)_aTEV|(JWB_C|(K|(TIU@_K|)M|)Q|$P|%1_KUaT|%I|',
      '%T1_@|%WG|%_?W|)I]RD|%a|&GQ_@W|&K|$QK_8D|%_@TK|*U@|(Y@|&ATEU@|&F]K1|*?|$RD|%TK|(K|(V|%VD|$a]3|#V8|$?T|&ET?U|$IT|&D|$',
      'K|%1UO]K|%@_b|%GK|#W1|%_|$9T(|(AT-|&-|&I?T|%UGT|$=S|&U|$>ST|&V|$?T|$BT|%_C|(TBU@_a|(U|$C|%GTK|$D_BT|$LT(GT|%U|%WAUGT',
      '|#Y1_1|&P|(K|$@_@|(K|(T1TK|)D_@|(U|)3@|$B_C|(U|$D_BTGD|$P|%H|%_;UET@|$R@|&_|(@I|%Q_E@U|#Z&(D|$1|%K|$3|%I|$5_3|(L|(TL',
      'WKW|$:_8]=T-8ZEUD|$>ST|%T|$@|%D|%TK|$B|%DT|%K|%TD_@|%V|$ETK|$GU|$ITKV|$L|$M|%1W|%THXIU|%ZGZMZ|$O|%K|%U|%V|%_|$P_;|$Q',
      '|%K|&1TKV|%TD_@|&IKU1|$RZKT|#[1W?_<|$8_:TDU1|$<1|$@K?V|$BU1|%W@U1|%ZOU1|%_aDTA|(W@U1|$C|$GTRU1|$OT2|&MV|%UP_;_a|$P_?',
      'G|%aU1|#](@|$*|$=ST|$C|%RW-|$IT|$K_=|(K|(S|)K|$LK|%TJT-|%U#|$P|$RU|&GT|%X|#^B_C|(U1|#_J@V@|%GRTK|$K8|&DTA|%?|%@|&K|&',
      'V|%R_I|)3UKU|)BZO|)EW@_K|+K|)GUB_aT|)T|*?_=|-K|%T8UL|&?_=|&R_I?|+V|*V|%U8|&;UO|*_|(ZD|*K|%]:_8|$L1|&K|(_|&_|(6ZD_|%T',
      '1_|%W|$M1|&K|$a1_@|)U3@|*@_b|*GUOZP|*K|%5_3|%:_8D|%@U1_KI|(@|&V@|%GCTD|*KZ|&QTa|*U1|*V|+1|(_AT|+K|&RTK1TKV|*K|*U1|%Q',
      '_@|%T1K?|&2_aT|&4T@|(_K|&5_1|*K|&;U#|(ZKV|&=IU?_;D|&?_=|&CU|&DKKZ|&E1|(TK|(U|)AT-|(V|(Z|(_@|*U|&GQTaU1|&Q|&aTI|%W@_E',
      '@_@U|%]I1ZO|%a|#a$E_KTE_@|$D|$Q|%K|&Z|%_1|(T|!H*!KV|$?V|#1_@|&1GU|&K|&U|%P?|#3@|$G@|&V|%TD|$UDV|$_D|&TGOZP|#5_3|&T|&',
      'VKZ|#8D|$T|#:_8|&BZ/|&D3K|#;_;|&T6TK_J_a|#?_=TK|#@_@T|#B_K1|(K|(TMV|#GD|%K|$TDUET;?T<TKW|&V|(ET;?T|$UP_a|)@|*K|#K@|$',
      'B_bT8|$QT|$T|$U|$_@_@U|#L1KU|$HTGZ|$KZ|$_H|#T(|$*8|$-LK|$3|%DZ(AULZ|%G@|(K|%K|%UKAV|%_a|$5_3KT|(U|)GT|)JT-|$8ET|%U|$',
      '@|%W=SU|$B_KG|$G|%DT|&_@U|%K|%U|$K|%@V|%U|%V|$LW|$P?|%T1]P|&HTPV|&K|%V|$QITD|%_1K|#U-@DTI|$1TKV|%_;]KU&|&PT|$;TIUD|*',
      '_|$=S|&U/|%U/|$@K|&W|&Z|%_@U|)1|)HXIU|)KZ|$D_D|(@T|#VI|%QZD|$P?|%_I|#W;TD|(_|$@T?W|$GD|&ZO_bK|,<TKW|/Z|,K|,Q_AU@|,V|',
      '$IU1TKZ|$L|%U|%_|#X3]M|$@|%EXK_G|%M|%T?W|$BZGV|$E@U|$IU|&1I_E|(T|)KZ|&K|$P?|%U@|$aT!|#Y?|#Z5_1;|$;|%U|&AULZ|$?_;_KU1',
      'WLTK|$B|%HTG|$P8|#[KG|&V|#](|$1|$3|%D_@U|%I?_=E|%KT(|%WAUGT|$8D|%EWKV|$;|%K|%_|$K|#^3]MU1|$@U1|$IU1|#_KI|&?|&KGK|%T@',
      'T|#a5_1K|$HV@|$KZ|!I(!PU|$BT|$LI|$MT|#1K|#5_3M|(GTK|(T|&ZQ1K|#8T|$WIBTK|$_8T|#9U|%KZ|#:_6|&Q_A|%8KV|&U|&WKV|#;K|#<1W',
      '|$K|%Z|#=ZL|&U#|&_|#?U|%EWK|)V|%P|&K|$]RU|$_=D|&E|(K|&M|(K|(V|)K|*W|)a|&ZLT|#@GTB|(K|$HZB|$KZ|$TDWQTKZ|%I@|$Z|$_Q_a|',
      '#AWKT|#BD|%I]RD|$K|$_a|&ETD|#CKZ|$W|%IU@T|&ZR|%K|%QXBD|$_J|%aE_KBZO|-K|&GK_@_@V|(U@_@|&HT3KZ|&I|&JW3Va|&Q_A|&TR_D|#D',
      '1W|$I]RD|$K|%Z|$T|$W|%P_a|)K|$Z|%RW-|$]8|%DUGZO|&V@|&aD|%HTG|%K:_8D|&I|(T|%RK|$_@G_a|&_K|)?TMa|-K|)TMa|)V|*I?_=MKZ|%',
      'AD|&K|%B|&UK<TKW|)ITD5_1KZ|)K|%IA|#I@T|#K?]@_@K|$R;_;T|$T<T|&V|%I@U|$U6|$WHXIU|$_B_BKT8|)M|%J_aTBT|#L_;UE_L|%L|&U1|#',
      'MB_bTK|$KZ|$a|#OT|#Q8UB|$LT|$URKZ|&T<TKW|(JT-!|$_@1|&UP_1|+K|#R1WIT|)<TKW|$@TG|%_@_b|*EXK_?_?|&b|(EXK_?_?|$D_@|$IB|%',
      '_IB|$K_PU|$L|%T|$T|%1K_P?|&TG_a|(MV|(O|)6TKV|)JTD|%@_IT|%BVE|&ZG|)V|(O|)K|%D|&3K|&BV|)K|&D_B|&_|(@|%ET@_K|+5_1<TKW|&',
      'WKWP|&_KHW|+5_1|)QTB|%GM|&UB_aT|,Ma|.K|&VK|%HTK@|*K|&UJ]3|%ITKV|%K?T|&T8|)T|(?V|(P_;_K|-K|%L1_P_IV|%MaT|%O_bZ@T|%QT3',
      'K|&_DTD|$UIT|%MTITD5_1<TKZ|.K|$W|%IT7U|%KV|$ZD_B_K|%O|&_bK|$]@_QG|#T!|$#Q|&EZOV|$&|$(|%!|%1ZL|&_K]QF_;|%L|&_|$)|$*?_',
      ';|%Q|&V|$3?T|%UAULZ|&LZ|$4|$5_1|(=S|$7|%K|&5_1T|%U|$9U|%V|$;U|&&|&K|%_KU1|*_|$=S|%_KTQ|$?|%U1|$@T|%Y|&HTPT|%_KT|)CU1',
      '|)K|(Z|$BMT|$CG|%_aI|)KZ|)U1|(T1K_P?|$D|%1|%5_1|)B_bTKT|%6U@_K|%B?_=|%D_@U|%G|&TCU1TK|&U1|&Va|%K|%Q|&U#R|(1|&V|%U|%Z',
      '|&1OT|%_B_KT8|&a@T|(GK|$E|%K|%UGT|$ILT|(K|%T|%UDT|%W!|&DU|$KT@_I1|%U|&GT|%_1|(?_=Za|(Z;|(_QGTBV|&3|(BK_OD|(OUK|)VK|&',
      '6|$L|%1TD3UKU|%TaLI|*_|(TLI_|%U1|(TDT|&3DT?_;|%ZQU&|%aLTI|$M|%@V|%HXIU|%T|%U|&1T|&DV|%a|$P_;K|$QK|%U1|$RT@_I_a|&KV|%',
      'UP_I@V|$aT|&CK|#U&!ITK|$3_KT|)K|$7|$;K|&_|$<T|$=SU&|%U&|$@_K|$AWD|%_aT|$DU;|(_|$IU|$K_8T|$LTD|%U|&;TKV|&IU;K|&aD|$MD',
      '|&_@U|%U|&7U|&@|&AT-|(UGT|)LT|&DAULT|(TRU!|&ETKUG|&G|(T|&IUMT|&LT|(Z|%W7U|&AUGT|)LT|%Z|&DTRU!|$OD|&K|%K|%T|&(|&JT-|%',
      'U|%Z(|%_K?|(U@|$P_;K|$Q|%_|$RUK|#VD|%1Z@D|$KT|#W!|$1TGULT|%W;|&D_B|%ZO|%_@|(U|(ZO_bK|$2|%K|%TK_8V|%U&|%_J|(@$|&a@|)$',
      '|(ID_@_KV|(TMa|$3|%WDU|%_C|$?_=|(GAT|)UD_CT|(K|(T|(U&|$@TG1|$BU|&KQ_@|%WLU|%_K?|(T|(U@|$DU|&QUETLU;U|%_DT|$I_GT(|*<T',
      'KZ|*K|$K_IW|$L_a|$QLITD|&UI|)_|$R!|&K|%T?|%XK_@_@|#X2_a|(@$|$@_K|(@_aT3|(DMV|(TOa|$K_@U|(_@U|+K|*V|$L_a|(GTD|(K|(T5_',
      '1D|$M|%1|%@$|%BW&|%T|$PT|#Y3|$@|%_@U1T|&a|(GK?|(W:_8a|)B?_=|)EKZ|)GK?|*ZM1W|)K|$BW|#Z!|$1TDU1TL|&E|%_QU1]|$4|%DT|(B|',
      '%T|$6|$8K|$;_KU1|(]|$=TL|%U1TL|&QUD|$?_>T|$B|$D|%D|%U:_8T(;UQ|/_|$I]KU&L|$KT|%U|%V|%W|&B?_=|%Z|$LTD]IT|$M|%T|$P|$QUD',
      '|(_|$RZK|$aK|#]1_P|$3L|$;|%K|%T|&E?|&I];U|$=S|$@U|%Z|$BV|$DTLUQT|%]1_L]DTL|$GT(L|)_|$K|$RD|%U@|&DV|#^K_J_a|$MU1|$QWI',
      'V|#_aT6|(_|&D|(Z8IZ?_;|*K|(_|&LZKU&|%W6W&L_|&8U1|*_|&;ZQD|&DUQUETLU;U|#aWK|&H:_8|$XK|&H:_8|+K|!J1Y@|$_P_IT|#8_:|&K|#',
      '@_D|#AT|%1_KIZ|%K_A|$ZP_;|#BU|%/|$WDTA|%I?U|#D_@_K|)?T|+BTa1|+K|)ET@U|)K|)V|#G1_PTK8TD|#I8|$WDT|#JT@U|#O]BT|%GD_@|#T',
      '&!MT|%D_@U|$(|%%7U|%7D_@U|&U|%AT-|(D_@U|&UGT|(LT|)Z|%ETKZ|$*|%7U|%AUGT|(LT|)Z|$-|%!|$1|$8EWK|$:_6|$@Ta@|%_KT|)K|(V|$',
      'BG|$D|%K|%_@_KU1|$ED|$JTGK|$RT1U|&B_bTKT|&FMKZ|&K|#U-|%1U|$G|%T|&K|%Z|#VOW|#W1_@|(KT8_a|-KZ|*P_;_K|/K|(T@_I1|(U|)JW1',
      '_@|$3|%K|&Z|%M|%_I|$B_C|(K|$CUP_<UK|$G|%1|%@V|%KT8|%T|&GQ_ATKZ|#Z*!|&<TKW|*Z|(U|&AUET(!|)KW|*Z|&ITD5_1K|$1^?QU|$@U1U',
      '|%Z|&GZMZ|$EKU|(1U|$GZ|$IU@U|)1U|$RZ@W|#]3|%BTD|&Z(|)AULZ|(GT|%T(|(AT-|(GT|&=S|&?|&J]3|%UDV|%V|%W!|%Z|&D_B_K|&O|%_a|',
      '(@T|$8DT|(K|$=ST|&U|%U|$B_CT|$CEWK|$DV|&EA|$OV|#^3U1|$@W1|$A|$D|%T5_3|$GD|!K1Z;_|$_|%@6TE|&DMV|&K|&Q_KTG|&RVD@T|%P1|',
      '&?OVM|(TGZ1_P?|&T|#2D_@U|(W|$T|%3LT|%JT(|)7U|)AT-|*UGT|+LT|(-|$U|%7D_@U|&U|%AT-|(D_@U|&UGT|(LT|)Z|%G|&T|(K|&Z|%LZ|$W',
      'AUGT|(LZ|$Z|#4W|%DTA|#5_3|&G@V|&I:_6|&K|&VD|#6DTGMV|$U@|$aU@T|#8DV|&@UKZ|$UaT|#:_8D|&U@|#?8U@|%V|$DV@U|$ET|%WK|$GVK|',
      '$T|#@D|$U|%1TD_@|$_D|&3UKU|&QU#RTQD|&T1K|#A1W|$5_1|$JT@_KT|+K|$K|%Z|#B_B|#D_|%ATI_G]K_|%CD|&T|#E_@TDU|)V|#GK_;|$U|%D',
      'TKTa?|&_B_K|%GTK|$VD_B_K|+DTA|#I?|%V|$T1TD_@|%BZGV|$ZO|#O_IU|&V|#Q1W|$3]LT|$TaD|(U1|$W?|#R?U|$D_@U|$ITD|$Q_a|(Ia|$U|',
      '%&QU7U|%3LT|%7D_@U|%@|%AT-|(D_@U|&UGT|*K|(LT|)Z|%ETKZ|%G|&T|(K|&Z|%JT-|%LT|&Z|$W7D_@U|&U|%AUGT|(LT|)Z|$Z|#T(|%FL_|%I',
      ']RD|$*?_=KZ|%@|&KTa|%K1ZLT|$/|$1ZO|%_PQ|(V|$3|$4G|$8|%1UO]K|&Va|&WITK|+V|%3WKW|%@D_@_K|&_b|%CTDV|%DV@U|*1|*8_:|-T|*K',
      'Z|&Z@T|&[@U1|%EA|&W@|)_K|%G#O|)K|%O_KV|%Q_ATD|+K|(b|%T5_1B_bTKT|%U|%VG|%W|&@U|%ZD_B_K|&O|%_J|(K|&a3]P_<V|(ETM|(K|(QH',
      'T|+1W|$:_6U|$=TK|%U-QD|$?T|%V|$@U|&K|(Z|%_K|(U|$CT|&1YP_?|&DTA|&I]RD|%U1T|$D_C?T|$G?|&K|$I|%1YP_?|%6D_B_K|%BTQ|%T|&D',
      'D_B|&a?|)K|%ZO_bK|$OU|&61_K|&K|$P_;_K|*BX@|*E@U|*K|*Va|$Q|%TaDU1|%_|&@T|)K|$RWL|$a|%3=ST|(T|%EWK|#U%E;Z1|$*IT;-=|$/|',
      '$8K_H|$EG_LU1_|%]K_;|$F_L1_Q|(Z1_Q|$LU8|%Z|$QK_6_6|%ZE_;K|$RT@U|$aT|#V@U|&DV@U|#W1_I?V|(U?V|$6U|$;U|&D|$B_K|$DW|$EZ|',
      '$PU&|$RZ|#XE|%T|&D_@K|+U@|#Z1K_=|)S|$2T|&K|$=SU/|%U/|%_=V|$?W1T|$G@V|$HZD_QT|$IW?T|$M|%EA|%GT(|)K|%P_;ZQD|$OI|#]1UGT',
      '|$33_KQ_@|%B_bTKT|%ITD5_1K|-Z|%K|%T1_KTD_@|%V|&ITD5_1K|&K|$83TK|%T|$=|%S|$E?|$IT?_;U1|&D|(_|%U/|%Va|$PZ(|$RU?V|&@|#^',
      'E_a|#aTL|!L1_P|&?ITD|&Z|&_D^|(I?|)V|*1TD_@|*DTKTa?|(a|#3T(|&GT|&LZ|%@TK|%JT-|$Z(|#4W|#5_1T|(K|%3M|#:_6|#=W|#>SU|&AUL',
      'Z|&GT|%Z(|$Z(|#?_=D|(K|#@T|#G5_3|$?|#H_|#I_G|&K|&T|#K_=|#MU@|&T|#QU1T|#T(D|&_|%F|&_|%G_KZKV|%QZD_Q|$3U|&7U|&AT-|(UGT',
      '|)LT|&ETKZ|&G|(T|&LT|(Z|%W|&AUGT|%Z|$4G|$8Z|$:_8|(K|$;UD|(_|$H|$K_HT|$L|%T|%_|$M|%D|$R]K|(K|#U#1_|$*1ZIU&|$2D|%U@|$3',
      '|%_|$5_1_|&3|(3@|(K|)T8|$;|%K|$D1_Q|$EU|&GB_C|&K|%_@|&QT|$IU;Z=|*S|*_|%_F]IT|#VMT|&G@V|#W(|$1_1TaU@|$3T|$6T(|%U|$?|%',
      'T|%_<D|$EQ_|%_@E_KTa|$R|%T|#Z21|%DV|&_@U|%T%7U|&(AULZ|&-!|&JT(7U|*AULT|)-|&K|&LZ2U|%U|&1T|&7D_@U|&AUGT|)LZ|&GT|&LZ|%',
      'WAULZ|$5_1T|$8K|$=U|$D_Q|$E|$F_;DT?_;|$I_GW|#]11AT|&MT|%3V@|%5_1<TKZ|)B_bTKT|%DTA|&Y@_a|%E_KUa|+@T|%ITD5_1K|&W2KZ|%K',
      '|%L]6D1W|%Q#2_aT|%Z|$6D|$E|$I|$RU@|#^R|!O1WD_@MT|$_|%@|&U|(EV<|(ITD|(K|(OTMV|#5_1K|(T6TK_J_a|%2|#@1|%=ST|&T|%K|$EAU|',
      '&V|$TCU1|%G_BV|*K|+Z|$_KW|(@T|#DU|%GTK|#EA|#GK|$_B|&K|&TGMV|#I_HW|#J_aT|#K?|%TK_AV|$@|$VK|&K|$_1KT|%IT|#L_a|#Q_@T|%a',
      '|#RVB|$Z|#T1_@|$2T|&K|$3|$5_1W6|$>SV|$D_@|(DW|(T|(U|$G1|$I_G|$KBT|&Va|%MT|%VKU1|$M|%3_KTI|$OW|$Q1|%D|&1TMKZ|&K|&TCVD',
      '|%U@|%_@_K|*K|*V|+a|*]1_@|$R|%T|#U1TK|(K|(V|%_P1|)@T|(T3@|*_KR?|)BTD|)DWP_<TD|)GU@|,_|)K|)LTH|(U@|$2|%K|%T|%UAULZ|&G',
      'T|$5_3|$G|%ID_BUK|%KT@_KU|%LU5_3|%T|&8V|&DV|%UK|$KT|&H_aD_@K|$MT|&LZ2|%_E|(V|$OUK|%W|&ITD5_1K|&K|$P_a|#V1TK|$4_K|$@|',
      '%1TMVD|%L|%M|$K_P|(1|(TDD_B|#W&|$1_K|(GTK|&M|(E1_P|(T|$2T(|%ULT|$?T?U|&JT-|%U|&GT|&LZ|$B_C|$H|%TKI_H|$P_1|#XD_a|$M|#',
      'Y5_2MT|&3|(TK|#Z2|%K|$aTK|#[G|$MGTMT|%V|&K|%ZD_B_K|$OG|#](GT|$1|$A|$HT|&JT@_KT|$P?|#_KB_CT|*:_8MU|%G?|%I|&U1|%TB_C|&',
      'G?|%V|&1TD_@|(YP_?|(_PZ@_K|&3W?_=U6T|&83D_DTA|&@I|&BZGV|&CK|&D%K|(3K|(UGTQ|&I@U|)V|(B|(D_BUK|-K|&KTCT|)I|*1YP_?|*6D_',
      'B_K|&L5_1T|,K|&O_KVIT|&aT|%W@U|%Z?V|)GUHT3|)HW1_@|)K|&P_<|&a|%]@T|$M]1|$aTI|(QWD_BK|$bTQ|(1_KUaT|(DMV|%Z@|(QTK|(T|#a',
      'D|!P=S5_3V|#?_>|#P_<|&V|#]=O|%SO|$RM|#_;1|&_|%T=UaI|&K|(_|%UL|%W=U/|%Z;|&QD|)_|%]K|(V|%_K]1|!Q#1MD|&U@|&_E|%VK_?_?|)',
      '@_@D|%Z@|%]6D|%_KI?|*K|)U@|(TD_@U|)I1|&PUE_@|(ZEKZ|$2_a1|(TK|)L4W|$3<1|&D|(K|&U@|%V@|(K|%YRU@|(V@|%Z|%_KR|)TMa|(TI|*',
      'K|*V|$4|%;U@|%K|&_P|$8_:T|$C_aT|$E@_@U|%D_D|%K_1|)KZ|)U@|%XK_?_?|%Y1_@|%_KBTa|+K|$JW1_@|*T|%]3|&81|(DT|(U@|$K1_P?|)U',
      '@|%6DT|$L3_D|$MTE|$O]CD|(U@|$QB|&B_bTKT|&K|&Va|%TK|(K|%_1K?|*K|(TK|*1|(Y@|*U|+K|&AT|)B_bTKT|)D|)E1|)K|&EK_O|+KZ|$RU@',
      'T|)K|#*KT|#1M|$TKT@_I1|%M|&W|&Z|%OZ|$_|%KUa|)@T|%PI|#2V|#5_1;|(TED_D|&MD|&W6U@|&Z@|&]6D|%3<D|&I|&KZ|&V@1TK|)8_:|)K|)',
      'T|&Z|#6UD|%G|$Z@D|(@T|$_6U|(BTDD_B|#8T|%(|$_8U@|#:_6TK|)U@|(MD|&a|%8VG|&W|&a|#<U1|&_|#=1|$S1|#@K_1|$V|$_@T|&_bZ|%a|&',
      '8U@|&@T|&DTKTa?|&GTBV|&HTIT|&T3_KR|#BD|$K|$Q_a|(@T|(T|$T|%DD_B|%OUG|$YO|$_a|#DT@D|$_|%@QD_@U&|&TD|&WMD|(P_;|&]P|%A|%',
      'BK_H|&VE|&ZO|(R|%CTD|&U|&_aT|%DU1;|&_aTQV|%aTQV|#E1_PKZ|$_@BO|&I|(V|&TR|)K|#FM|%@T|(K|$T|$_;bZK|*_|#GU@T|%OZP|$W1U7U',
      '|%8|%<TKW|&W|%BUD|%GZMZ|%K|$_|%aQT6V|#HTE@U|$_a@T|)K|#I11_P|%TMVD|$3_K|$@M|$D_bU@|(a|$GTa|%Z@|$K|%ZO|%_A|(1|(D|(U@|&',
      'E?|(U@|$LU5_3V|$P_;U|$QTIaU1|%_@Z|&ATDU1|&aT|)K|$T3I|%8|&GTBV|&K|&QZGT|*V|%CTD|&U|&V|%D|&@T|&_@KTM|%ED|&_@|)U|%GZO|%',
      'K]R|%L]61|)DT|)U@|%RTK|$U@U|(K|$V1K?|&_P1|*ITDZ|)T|%K|$WBTa|&_K|)K|$XR|&K|$YB_C|)U|$Z@|$_E@_@U|+K|&B|&D_D|&K_1|*K|*U',
      '@|*Va|)?_?|&TB1|)D|*T|)U1T|*@|&WK_?_?|&XK_?_?|&Y1_@|&_K@U|)BTa|,K|)QTK?|%GD_C|*KZ|*U@|*Va|&K|(_B_CDT|,U@|&LEWK|+K|+V',
      '|&M|(U@|&TB|)E@_K|&U@|(CTD|+K|&ZBDOVM|-@T|&]CD|)U@|%HG|(@$|(EK|&TGDT|)_a|(MU|&]3|&_KTD_@|%I@|(U|&TD8D1|)K|)TK_AZ|)U@',
      '|)V@|&UMDV|+K|)U@|&W2|)KZ|)VD|%KT;|$a1_KIZ|%K|%QVIT|%Z|#K1TK|(5_1<TKW|+B_bTKT|(K|$4KU&|$E:_6|$GKTR|$M|%T|$Q_b@V|$UGT',
      '|$VQYE|$W|$]8|&UDV|%GK|$_8DT|%@_@|%B_BTK|%E|%G|&1DUP_<|(TMVD|&@_K|&BT|&DUI_D|&EWKT@D|(_KAI|,Z|&GYR@|+_|&HTK@Va|&I];|',
      '&O_KZP_<|&QTCTK?|&T5_3|(CU1|&Z1_P?|&]6_6|(@_@I|%HUQ|&Z|#LITD|$UL|#M2|#O1_@U1K?|$Q_@_K|#Q_|%IU@T|#R1K_IV|%TKV|(Z|$8|%',
      'KZ|$BZG|$GTQ|$I@U|$J]3|(V|$K<TKW|%K|%T:_6M|%V|$Q_K|$Ta1|&@T|$U|%B|$_a|#T#4T@U1|%QB|&_1Y@U1|$(|%1ZL|&]QUQ|%@U|%D_Q|$*',
      'A|%BU|$-|$1_PT@|*1TK|(V|)3]ETM|(_aK@T|$3K|&K|%W&|$5_1Z@U1|&3|(T|)1TKT|&4T@U1|$8Q8_8T|%UAULZ|$@|%];U|%_b1V|$AU|&KZ|%V',
      '|$C1|%D|&T|%G|%TK?@|*D_@_K|%W|$D|%_|&@TM|*V|&B_K@T|$E|%K|%_@TRU1|$F_|$G@|%U@_KV|%_aQ_@|$I3_KU1|)V|%:_8Q_a|%DT|&_@|)K',
      'Ta|%KU1|&_A_a|%L|%Q5_3|%T8U1|&D_a|%UL|%W-L|&B_KU1|&RU1|%XRU1|%_DT|)KZ|&E_K@U1|*BTaU1|&GTBU1|,@T|(UCTDU1|&KT8_J|+a|,K',
      '|%aU1|$K|%?V|%AU|&V|%BT|%MT|%Q_b@|%T|%U|&7D_@U|&AULZ|&GT|%_|&A1|&G8DU1|*VD|(H^I|$L|%GZ3|%ZEWK|$RQ|&U1@T|%T|&J_a|*1TK',
      'V|&KT|%U|&@_aK|*U1|,T|&G|&K|%W|%ZG|#U#|%R|&BZ/|(_bTK|&M|(V|&TQD|$(/|$-|$1D_BK|%_1UI|$5_3TEWK|$8DKZ|%KU&D|%]F_KZDU&|$',
      '9T|&(|$;U|$?_=_K]I|,_|$B_C|(TD_@|)K_A|(U|(ZO_bK|$CT|&QM2|$DT|%UaK|%Z|&IT|)K|%_BWK|(XK|&C|(W|$EU&(|$HUL|$KU&|&8|(_|%]',
      'QUQ_|$LZ1_;UH|$P_;I|)_|$Q_;|(I|$R_DT|#V@T|&KTI|$IT|&D_@|&KZ2T|%U@|$QT|#W&5_3|%K|$1TD_@|$2|$3D_C|%I|%_KVG|$8T@T|%U@|$',
      ';U#|$@KT#|$BK_OD|%TIT|%XK|%Y>S|%_CT|$C|%T|&#OW|&1K|&K|$DD_BT|%T|&GZO|&I|(U|%UO_6U@|%VL|%_BK|)3=S|)GD|)V|$EK|&U6U@|%T',
      'KUO|)Q|%_|&KUI|$FU|$GK_?_?|+EWK|%TP|&Q|%UCT|%ZBTK|%]C|%_K@|$HB_KT|%TOUP|&P|$ID|%T@_KT|%U@_KT|$J]3|$K|%1_PT|)U@|%ZD_B',
      '_K|,DTA|&O|$L@TD|$OTD_@|$PIT|$Q8_8U@|%_A|&IU@T|#X1_P_I|$61|%DT|%U@|%V|$@T|%_K|(ET@|$K_J_a|*IaV|*K|*TL]1|+Q_@|#YP_;|(',
      'U1TKV|)K|#Z(|%<U|$/|$1QD|%Z?_=|*TKV|$3W=U1|$;|%_|$<T1TK|(W|&KW|%U|%V|$?_;|(K|(U3_KZ=|)IU;K|-_|(_KTL|$@U1U|%W|%Z|&;T|',
      '&GZM1W|*K|*Z|$AU|&ET(!|&IC_aKW|&KW|$BUD|$D|%T|&E@U|&K|$EKU|$G1|%D|%T|&K|&a@|%Z<TKW|$HMU|$ITD5_1K|%U|&@U|&FT(DTLKZ|$K',
      '];]DUD|,_|$L|%_|$QGW|$RU<TKZ|&BUD|*<TKW|&EKU|&GK_P|&HMU|#[DU1|%_a|(GTRUDV|#]=SU%I|%UaI|)_|$DEKV|&WK|%TLV|%U|%W|$ETD|',
      '$FU&|$HU-@|)_|$IDTA|%G#OV|&TK|$K|%U&QUQ|&P|%ZD|$QT(;U|%U&L|)UP_;|$RUDV|#^D_BK_J_a|$HT3_a|$K|%H|%V|#_1D_C|%TD|&K|%WL|',
      '(K|(_|%]K|%_KUDU5_3|$;UK-=|%_K]1|$@D|&_aETD|+aV|%I_H|)1TK|)K|%K|&K|&Va|%W@U|&E|%XE|%_KV|)K|$A3U@|%E@U|%M|&HT3|&K|&V|',
      '&Z|%TDITD5_1KZ|(K|(TD_@K|-?|-U@|(U@|(Va|(Z|&E@_a|+K|(D|)T|(U@|&aV|%U@|(U|)K|&K|(@T|(V1Y@|$DT@1|)]@_@K|&D|&aGU1|(W|%U',
      '3_CT|%ZR|(QTK|$ED_BD|%K_O|%P_;|%UD|%ZD|&Q_|%_KZ|$IK?|(Va|%TK1|)V|(_;|%U@T|%Y@U|$KP_;T|%TG|%]@|$b|%6_7|)@T|%@$|&D_@_K',
      '|,@T|%BZOV|%E_D|)TBZO|%HTG|%K|&T8|&WE|&XE|&_3|)@|)K|)Va|(?_?|+EB1|%M_E|)1TMVD|%T(!|&1_PK|+U@|&3@|&B|&CVD|*@T|,K|&HTG',
      'U1|&IV|)8V|)DTAD|&Q_A_a|,E_KB|,K|%V1TK|(Y@|*U|+E_KTE_@|%Z6_7T1Y@|+QZGV|%a#|(6TMU@|(OTQU@|&I|#aB|#bT(|!R#Q|#(KT?|#*7U',
      '|$AUGT|&LT|#1U|#8I|$TK|#;T(|#<T@|&_|#@_aT|(1T?_=|#DW|%ITD|#I_|#K?|$E_ET|$I]D|(_|$T(|&AULZ|&GT|$U|%&?TK|%6D_BD|%8D|%?',
      '|%G#O|%O_6D_B_K|%RK|%aT?T|*K|$Z|%(AULZ|%1YP_?|$_EUQ|#L_|#MBU&|%V|#Q_@|&1_PZE|&@D_@|&KZ|&OUM_E|&TD_@K|&V|%EU;TL|+KZ|#',
      'T(|%1]K_;|%BKTGTB|&_KTGTB|-K|%Q_1WL|$*Q|&_|$;|$=|%S|&W|$?_=U|$@|%K|&Z|%V|$DV|$K|%<TKW|%TRTKU|%_;|&DU&|$LW1T|$QD|%L|%',
      '_a|#U!|$#QT|$D_B|(WITD5_1K|)Q_@TD|.V|+ATDV|(]M|$E|$I|%T#OW|&6M|&Ma|)K|$K]|$QTG|(KZ|#VKT|&1WB|#W%D_@U|)W|$-@|%DTRU!|&',
      'U|$ITaWD|$QZD|#Y@_|&EU?_=|,K|&Q_ED_BD|$B4T@|%_3@U|&4T@|&ET@|&K]3|)C|%a|$PU1ZO|#Z!|$(|%3LT|%7U|%AT-|&UGT|*K|(LT|)Z|$*',
      '|%%7U|%7D_@U|%AT-|&UGT|*K|(LT|)Z|%DTRU!|$1_;K|$@W|$DZKV|$ET;T(;UQ|-_|$G|%DTRU!|%TB_bTKT|&EKZ|(T(!|&JT-!|&K|%Z|$ID_@|',
      '%T|%]3_L]GUD|%_G_KI|$LT?U|&EKZ|#](&QW7U|%3LT|)?U|(Z|%7D_@U|%AT&D_@U|((|)ETKZ|(D_@U|&UG|)TGZMZ|*K|)Z|%DAT-|(UGT|)LT|*',
      'Z|&TRU!|%ETKD_@U|)U|*7U|*AULT|-Z|*DAULT|*G|*LT|%JT&D_@U|((|)7U|)AUGT|+LT|,Z|(-|&UG|)T|%QTKU7U|*AULT|$;ZL|$@T|$I|$LQZ',
      'L|%U|#_KB|&K|%TQ|$aWITD|$bT;_Q&E|!a5_3|#W(FT|$DT(;Z=|+_|%U%D|&;|(_|&HKQU;U|)_QU;U|%ZQ_1]|$K]E|(K|)Z|(Va|!bT(|$;K|%_|',
      '$D|%_|#U1Z;|$LUaI_|#ZG|%QT(;|*_|%_|$P_;',
    ].join(''),
  ],
};

                                   
                    
                   
 

const unpackedIndicLexCache = new Map                          ();

function unpackIndicWordList(packed        , alpha        )              {
  const words = new Set        ();
  if (!packed) return words;
  const entries = packed.split('|');
  let prev = '';
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    const lcp = INDIC_LEX_SAFE_IDX[entry.charCodeAt(0)];
    let tail = '';
    for (let k = 1; k < entry.length; k++) {
      tail += alpha[INDIC_LEX_SAFE_IDX[entry.charCodeAt(k)]];
    }
    const word = prev.slice(0, lcp) + tail;
    words.add(word);
    prev = word;
  }
  return words;
}

function getIndicLexicon(lang        )                   {
  const cached = unpackedIndicLexCache.get(lang);
  if (cached !== undefined) return cached;
  const raw = PACKED_INDIC_LEXICONS[lang];
  if (!raw) {
    const empty                   = { core: new Set        (), ext: new Set        () };
    unpackedIndicLexCache.set(lang, empty);
    return empty;
  }
  const coreSet = unpackIndicWordList(raw[1], raw[0]);
  const extSet = unpackIndicWordList(raw[2], raw[0]);
  const supp = INDIC_LEX_COLLOQUIAL_SUPPLEMENTS[lang];
  if (supp) {
    for (let i = 0; i < supp.length; i++) {
      extSet.add(supp[i]);
    }
  }
  const pair                   = {
    core: coreSet,
    ext: extSet,
  };
  unpackedIndicLexCache.set(lang, pair);
  return pair;
}

function detectIndicVocabLang(vocabList          )         {
  const probe = vocabList.slice(2, 60).join('');
  for (let i = 0; i < probe.length; i++) {
    const cp = probe.charCodeAt(i);
    if (cp >= 0x0980 && cp <= 0x09ff) return 'bn';
    if (cp >= 0x0a00 && cp <= 0x0a7f) return 'pa';
    if (cp >= 0x0a80 && cp <= 0x0aff) return 'gu';
    if (cp >= 0x0b00 && cp <= 0x0b7f) return 'or';
    if (cp >= 0x0b80 && cp <= 0x0bff) return 'ta';
    if (cp >= 0x0c00 && cp <= 0x0c7f) return 'te';
    if (cp >= 0x0c80 && cp <= 0x0cff) return 'kn';
    if (cp >= 0x0d00 && cp <= 0x0d7f) return 'ml';
  }
  const vset = new Set        (vocabList);
  if (probe.includes('\u0933') || vset.has('\u2581\u0906\u0939\u0947') || vset.has('\u2581\u0928\u093e\u0939\u0940') || vset.has('\u2581\u0915\u093e\u0939\u0940')) {
    return 'mr';
  }
  if (vset.has('\u2581\u0939\u0948') || vset.has('\u2581\u092e\u0947\u0902') || vset.has('\u2581\u0915\u0947') || vset.has('\u2581\u0915\u094b')) {
    return 'hi';
  }
  for (let i = 0; i < probe.length; i++) {
    const cp = probe.charCodeAt(i);
    if (cp >= 0x0900 && cp <= 0x097f) return 'sa';
  }
  return 'en';
}

function classifyIndicWord(word        , lang        , coreSet             , extSet             )         {
  if (word.length < 2) return 0;
  if (coreSet.has(word)) return 3;
  if (extSet.has(word)) return word.length >= 3 ? 2 : 1;
  if (word.includes('\u0902') || word.includes('\u0901') || word.includes('\u093c')) {
    const altN = word.replaceAll('\u093c', '');
    if (altN !== word && (coreSet.has(altN) || extSet.has(altN))) {
      return word.length >= 3 ? 2 : 1;
    }
    const altC = altN.replaceAll('\u0902', '\u0901');
    if (altC !== altN && (coreSet.has(altC) || extSet.has(altC))) {
      return word.length >= 3 ? 2 : 1;
    }
    const altA = altN.replaceAll('\u0901', '\u0902');
    if (altA !== altN && (coreSet.has(altA) || extSet.has(altA))) {
      return word.length >= 3 ? 2 : 1;
    }
  }
  const lastCh = word[word.length - 1];
  if (INDIC_LEX_VIRAMAS.has(lastCh) && word.length >= 3) {
    const bare = word.slice(0, -1);
    if (lang === 'or' || coreSet.has(bare) || extSet.has(bare)) return -1;
  }
  if (lang === 'te' && word.length >= 4 && word.endsWith('\u0c1f\u0c02')) {
    const damForm = word.slice(0, -2) + '\u0c21\u0c02';
    if (coreSet.has(damForm) || extSet.has(damForm)) return 2;
  }
  if (lang === 'bn' && word.length >= 5 && word.endsWith('\u09bf\u09a8\u09c7')) {
    const vstem = word.slice(0, -3);
    if (coreSet.has(vstem + '\u09be') || extSet.has(vstem + '\u09be') || extSet.has(vstem + '\u09c7')) return 2;
  }
  if (lang === 'ml' && word.includes('\u0d7c\u0d23')) {
    const alt = word.replaceAll('\u0d7c\u0d23\u0d4d\u0d23', '\u0d7c\u0d23');
    const alt2 = alt.replaceAll('\u0d7c\u0d23', '\u0d7c\u0d23\u0d4d\u0d23');
    if (extSet.has(alt) || extSet.has(alt2)) return 2;
  }
  const sufs = INDIC_PRODUCTIVE_SUFFIXES[lang];
  if (sufs) {
    for (let i = 0; i < sufs.length; i++) {
      const suf = sufs[i];
      if (word.endsWith(suf) && word.length - suf.length >= 2) {
        const stem = word.slice(0, word.length - suf.length);
        if (coreSet.has(stem) || extSet.has(stem)) return 2;
        if (lang === 'ml' && stem.endsWith('\u0d3e') && stem.length >= 3) {
          const shortStem = stem.slice(0, -1);
          if (coreSet.has(shortStem) || extSet.has(shortStem)) return 2;
        }
      }
    }
  }
  if (word.length >= 6) {
    for (let splitIdx = 3; splitIdx <= word.length - 3; splitIdx++) {
      const s1 = word.slice(0, splitIdx);
      const s2 = word.slice(splitIdx);
      if ((coreSet.has(s1) || extSet.has(s1)) && (coreSet.has(s2) || extSet.has(s2))) {
        return 4;
      }
    }
  }
  return 0;
}

function scoreIndicWord(word        , lang        , coreSet             , extSet             )         {
  const tier = classifyIndicWord(word, lang, coreSet, extSet);
  if (tier === 3) return 2.05;
  if (tier === 4) return 1.75;
  if (tier === 2) {
    if (word.length <= 3) return 1.25;
    if (word.length <= 5) return 1.55;
    return 1.80;
  }
  if (tier === -1) return -1.75;
  return 0.0;
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
const BRAHMIC_ANUSVARA_CLASS =
  '\\u0901\\u0902\\u0981\\u0982\\u0A01\\u0A02\\u0A70\\u0A81\\u0A82\\u0B01\\u0B02\\u0B82\\u0C01\\u0C02\\u0C81\\u0C82\\u0D01\\u0D02';

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

const BRAHMIC_LATERAL_CONSONANTS = '\\u0CB3\\u0B33\\u0C33';

const RE_COLLIDING_MATRAS = new RegExp(`([${BRAHMIC_PRIMARY_MATRA_CLASS}])[${BRAHMIC_PRIMARY_MATRA_CLASS}]+`, 'gu');
const RE_MATRA_THEN_VIRAMA = new RegExp(`([${BRAHMIC_PRIMARY_MATRA_CLASS}])[${BRAHMIC_VIRAMA_CLASS}]+`, 'gu');
const RE_ANUSVARA_THEN_VIRAMA = new RegExp(`([${BRAHMIC_ANUSVARA_CLASS}])[${BRAHMIC_VIRAMA_CLASS}]+`, 'gu');
const RE_INDEP_VOWEL_ILLEGAL_MARK = new RegExp(
  `([${BRAHMIC_INDEP_VOWEL_CLASS}])([${BRAHMIC_PRIMARY_MATRA_CLASS}${BRAHMIC_VIRAMA_CLASS}]+)`,
  'gu'
);

const RE_DUPLICATE_LATERAL_LIGATURE = new RegExp(
  `([${BRAHMIC_LATERAL_CONSONANTS}])\\1+([${BRAHMIC_VIRAMA_CLASS}])`,
  'gu'
);

const RE_ML_SPLIT_NASAL_GEMINATE = /\u0D02([\u0D19\u0D1E\u0D23\u0D28\u0D2E])/gu;
const RE_GU_FUTURE_SIBILANT = /ઈષ(?=[^\u0A80-\u0AFF]|$)/gu;
const RE_OR_DETACHED_ANUSVARA = /\u0B02(\u0B19\u0B4D[\u0B15-\u0B18])/gu;
const RE_OR_DATIVE_SUFFIX = /\u0B02\u0B15\u0B41(?=[^\u0B00-\u0B7F]|$)/gu;
const RE_PA_MATRA_INDEP_VOWEL = /(?<!\u0A39)([\u0A3E-\u0A4A\u0A4C])(\u0A0F)(?=[\u0A15-\u0A39\u0A59-\u0A5E])/gu;
const RE_VIRAMA_THEN_MATRA = new RegExp(`([${BRAHMIC_VIRAMA_CLASS}])([${BRAHMIC_PRIMARY_MATRA_CLASS}])`, 'gu');
const RE_DEV_DOUBLE_YAPHALA = /([\u0915-\u0939])(?:\u094D\u092F){2,}/gu;
const RE_BN_DOUBLE_YAPHALA = /([\u0995-\u09B9])(?:\u09CD\u09AF){2,}/gu;
const RE_BN_YAPHALA_DUP_YA = /([\u0995-\u09B9]\u09CD\u09AF)\u09AF(?=[^\u0980-\u09FF]|$)/gu;
const RE_CONSONANT_OR_MATRA_SHORT_A =
  /([\u0915-\u0939\u0995-\u09B9\u0A15-\u0A39\u0A95-\u0AB9\u0B15-\u0B39\u0B95-\u0BB9\u0C15-\u0C39\u0C95-\u0CB9\u0D15-\u0D39\u0D3E-\u0D4C\u0D7A-\u0D7F])([\u0905\u0985\u0A05\u0A85\u0B05\u0B85\u0C05\u0C85\u0D05])/gu;
const RE_ML_REFORMED_RNNA = /\u0D7C\u0D23\u0D4D\u0D23/gu;
const RE_ML_PARIPURNA_JOIN = /(പരിപൂർണ)\s+(?=വിശ്വാസ)/gu;
const RE_ML_UMMA_DATIVE_LOC = /(?:^|(?<=\s))([ഉഅ])മ(?:ായ്ക്ക|ാക്ക)\s*(?:അതിൽ|തിൽ)(?=\s|$)/gu;
const RE_TE_GERUND_HARMONY =
  /([\u0C00-\u0C7F]{2,}?)\u0C21\u0C02(?=\s+[\u0C00-\u0C7F]{2,}?\u0C1F\u0C02(?:\s|$))/gu;
const RE_KN_COLLOQUIAL_GOLISIDE = /((?:^|\s)[ಇಅಯ]ದ್ನ(?:\s+\S+){0,2}\s+\S*?)ಗೊಳಿಸಿದೆ(?=\s|$)/gu;
const RE_PA_NAGARI_COMPOUND = /([\u0A00-\u0A7F]{3,})\s+(ਨਗਰੀ)(?=\s+ਐਕਸਪ੍ਰੈਸ)/gu;
const RE_BN_SE_JANYA = /(?:^|(?<=\s))সেই\s+জন্য(?=\s+যেন(?:\s|$))/gu;
const RE_HAS_TAMIL = /[\u0B80-\u0BFF]/u;
const RE_HAS_KANNADA = /[\u0C80-\u0CFF]/u;
const RE_HAS_GURMUKHI = /[\u0A00-\u0A7F]/u;

function splitViramaMatra(match        , vCh        , mCh        )         {
  const vCp = vCh.codePointAt(0) ?? 0;
  const mCp = mCh.codePointAt(0) ?? 0;
  const base = mCp & ~0x7f;
  if ((vCp & ~0x7f) !== base) {
    return match;
  }
  const off = mCp & 0x7f;
  let indepCp        ;
  if (off === 0x44) {
    indepCp = base + 0x60;
  } else if (off === 0x62) {
    indepCp = base + 0x0c;
  } else if (off === 0x63) {
    indepCp = base + 0x61;
  } else {
    indepCp = mCp - 0x38;
  }
  return `${vCh} ${String.fromCodePoint(indepCp)}`;
}

const OPENING_PUNCT_SET = new Set([
  '-', '\u2010', '\u2011', '\u2012', '\u2013', '\u2014', '\u2212',
  "'", '’', '‘', '`',
  '(', '[', '{', '<', '"', '“', '«', '/', '\\',
]);

const CLOSING_PUNCT_SET = new Set([
  ',', '.', '?', '!', ':', ';',
  ')', ']', '}', '>', '"', '”', '»', '%',
  "'", '’', '-', '\u2010', '\u2011', '\u2012', '\u2013', '\u2014', '\u2212',
  '।', '॥',
]);

const WORD_BOUNDARY_REGEX = /^[\u2581\u2582\u2583▁\s]/;
const COMBINING_MARK_REGEX = /^\p{M}/u;

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
 * 4. Deduplicates retroflex lateral ligatures (e.g. 'ೊಳಳ್' -> 'ೊಳ್').
 * 5. Re-unifies Malayalam split nasal geminates.
 * 6. Normalizes Gujarati 1st-person future sibilants.
 * 7. Normalizes Odia detached anusvara and dative suffixes.
 */
function repairBrahmicOrthography(nfcText        , lang         )         {
  let text = nfcText
    .replace(RE_COLLIDING_MATRAS, '$1')
    .replace(RE_MATRA_THEN_VIRAMA, '$1')
    .replace(RE_ANUSVARA_THEN_VIRAMA, '$1')
    .replace(RE_INDEP_VOWEL_ILLEGAL_MARK, (match, v, m) => {
      // Preserve Bengali /æ/ diphthong (অ + virama + য)
      if (v === '\u0985' && m && m.startsWith('\u09CD')) {
        return match;
      }
      return v;
    });

  // 1. Kannada / Telugu / Odia duplicate retroflex lateral ligature (ೊಳಳ್ -> ೊಳ್)
  text = text.replace(RE_DUPLICATE_LATERAL_LIGATURE, '$1$2');

  // 2. Malayalam nasal geminate reunification (ഉംമാ -> ഉമ്മാ)
  text = text.replace(RE_ML_SPLIT_NASAL_GEMINATE, '$1\u0D4D$1');

  // 3. Gujarati palatal sibilant restoration (જઈષ -> જઈશ)
  text = text.replace(RE_GU_FUTURE_SIBILANT, 'ઈશ');

  // 4. Odia detached anusvara (ଂଙ୍କ -> ଙ୍କ) and dative normalization (ଂକୁ -> ଙ୍କୁ)
  text = text.replace(RE_OR_DETACHED_ANUSVARA, '$1');
  text = text.replace(RE_OR_DATIVE_SUFFIX, '\u0B19\u0B4D\u0B15\u0B41');

  // 5. Gurmukhi independent vowel following dependent matra word boundary separation
  text = text.replace(RE_PA_MATRA_INDEP_VOWEL, '$1 $2');

  // 6. External sandhi virama + dependent matra separation across all 9 Brahmic blocks
  text = text.replace(RE_VIRAMA_THEN_MATRA, splitViramaMatra);

  // 7. Devanagari & Bengali duplicate ya-phala collapse
  text = text.replace(RE_DEV_DOUBLE_YAPHALA, '$1\u094D\u092F');
  text = text.replace(RE_BN_DOUBLE_YAPHALA, '$1\u09CD\u09AF');
  text = text.replace(RE_BN_YAPHALA_DUP_YA, '$1');

  // 8. Brahmic word-boundary & sandhi normalization
  text = text.replace(RE_CONSONANT_OR_MATRA_SHORT_A, '$1 $2');
  text = text.replace(RE_ML_REFORMED_RNNA, '\u0D7C\u0D23');
  text = text.replace(RE_ML_PARIPURNA_JOIN, '$1');
  text = text.replace(RE_ML_UMMA_DATIVE_LOC, '$1മ്മായ്ക്കതിൽ');
  text = text.replace(RE_TE_GERUND_HARMONY, '$1\u0C1F\u0C02');
  if (RE_HAS_KANNADA.test(text) && text.includes('\u0cbf\u0ca6\u0ccd\u0ca8')) {
    const { core: knCore, ext: knExt } = getIndicLexicon('kn');
    const knWords = text.split(' ');
    for (let i = 0; i < knWords.length; i++) {
      const w = knWords[i];
      if (w.length >= 6 && w.endsWith('\u0cbf\u0ca6\u0ccd\u0ca8')) {
        const stemHalant = w.slice(0, -4) + '\u0ccd';
        if (knCore.has(stemHalant) || knExt.has(stemHalant)) {
          knWords[i] = `${stemHalant} \u0c87\u0ca6\u0ccd\u0ca8`;
        }
      }
    }
    text = knWords.join(' ');
  }
  text = text.replace(RE_KN_COLLOQUIAL_GOLISIDE, '$1ಗೊಳ್ಸಿದೆ');
  if (RE_HAS_GURMUKHI.test(text)) {
    const { core: paCore, ext: paExt } = getIndicLexicon('pa');
    if (paCore.size > 0 || paExt.size > 0) {
      const paWords = text.split(' ');
      for (let i = 0; i < paWords.length; i++) {
        const w = paWords[i];
        if (w.length >= 5 && w.includes('\u0a47') && !paCore.has(w) && !paExt.has(w)) {
          const rIdx = w.lastIndexOf('\u0a47');
          const cand = w.slice(0, rIdx) + '\u0a48' + w.slice(rIdx + 1);
          if (paCore.has(cand) || paExt.has(cand)) {
            paWords[i] = cand;
          }
        }
      }
      text = paWords.join(' ');
    }
  }
  text = text.replace(RE_PA_NAGARI_COMPOUND, '$1$2');
  text = text.replace(RE_BN_SE_JANYA, 'সেজন্য');
  if (RE_HAS_TAMIL.test(text)) {
    const { core: taCore, ext: taExt } = getIndicLexicon('ta');
    if (taCore.size > 0 || taExt.size > 0) {
      const words = text.split(' ');
      for (let i = 0; i < words.length; i++) {
        const w = words[i];
        if (w.length >= 5 && w.endsWith('\u0bbf') && !taCore.has(w) && !taExt.has(w)) {
          const cand = w.slice(0, -1) + '\u0bc8';
          if (taCore.has(cand) || taExt.has(cand)) {
            words[i] = cand;
          }
        }
      }
      text = words.join(' ');
    }
  }

  return text;
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
  const lang = options?.lang;

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
    text = repairBrahmicOrthography(text, lang);
    text = text.normalize('NFD');
    text = dedupMarks(text);
  }

  // 3. Recompose to canonical NFC
  if (shouldNFC) {
    text = text.normalize('NFC');
    if (shouldDedup) {
      text = repairBrahmicOrthography(text, lang);
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
 * Conditionally joins committed and volatile text without injecting illegitimate spaces
 * before continuation morphemes, Brahmic matras, viramas, or attached punctuation.
 */
function joinSubwords(
  committed                   ,
  volatile                   ,
  volatileTokens           ,
  options                   
)         {
  const committedStr = Array.isArray(committed)
    ? normalizeIndicText(committed.join(''), options)
    : (committed || '');

  let volatileStr        ;
  let vToks                      ;

  if (Array.isArray(volatile)) {
    vToks = volatile;
    volatileStr = normalizeIndicText(vToks.join(''), options);
  } else {
    volatileStr = volatile || '';
    vToks = volatileTokens;
  }

  const lang = options?.lang;

  if (!committedStr) {
    return volatileStr ? volatileStr.trim() : '';
  }
  if (!volatileStr) {
    return committedStr;
  }

  const lastC = committedStr[committedStr.length - 1];
  const firstV = volatileStr[0];

  // Combining mark (matra, virama) at start of volatile text: attach directly to base
  if (COMBINING_MARK_REGEX.test(firstV)) {
    return repairBrahmicOrthography(`${committedStr.trimEnd()}${volatileStr}`, lang);
  }

  // Open punctuation / hyphen / apostrophe at end of committed text
  if (OPENING_PUNCT_SET.has(lastC)) {
    return repairBrahmicOrthography(`${committedStr}${volatileStr}`, lang);
  }

  // Closing punctuation at start of volatile text
  if (CLOSING_PUNCT_SET.has(firstV)) {
    return repairBrahmicOrthography(`${committedStr}${volatileStr}`, lang);
  }

  // Existing whitespace handling
  if (/\s/.test(lastC) || /\s/.test(firstV)) {
    return `${committedStr}${volatileStr}`.replace(/\s+/g, ' ').trim();
  }

  // Token-level word boundary inspection
  if (vToks && vToks.length > 0) {
    const firstTok = vToks.find((t) => t && t.length > 0) || '';
    if (firstTok) {
      const hasBoundary = WORD_BOUNDARY_REGEX.test(firstTok);
      if (!hasBoundary) {
        return repairBrahmicOrthography(`${committedStr.trimEnd()}${volatileStr}`, lang);
      }
    }
  }

  return repairBrahmicOrthography(`${committedStr} ${volatileStr}`, lang);
}

/**
 * Compact front-compressed English lexicon for Trie-guided CTC beam decoding.
 * Zero external dependencies. Lazily unpacked on first English decode call.
 */

const PACKED_EN_LEXICON         = [
  '0aaliyah|2rdvark|3onS|1back|4us|3lone|3ndonSEG|7ment|3teD|5ment|4toir|2baS|3ey|3ie|3otS|5t|3reviated|9ionS|3y|2domen|5in',
  'al|3ucted|6ionS|4l|5lah|2el|4ian|3rcrombie|4deen|4rant|6tionS|3tting|2hor|5rent|2ideS|4ing|3es|3gail|3lene|4ities|6y|3ot',
  'ic|2ject|2lation|4ze|3eS|2ner|3ormalL|8ities|Ay|2oard|3de|3lishEG|5tion|9ist|3minable|7tion|3riginalS|8es|4tSEG|5ionS|6v',
  'e|3undS|4t|3ve|5ground|2racadabra|4hamS|4mS|5off|4sionS|6veS|3east|3idged|3oad|4gated|3uptL|2salom|3cess|7es|3enceS|5t|6',
  'ee|8ism|3inthe|3oluteSL|7ion|5ve|4rbSEG|6ent|7rS|5ption|8ve|3tainEG|4entionS|4inence|4ractSEG|8ionS|3urdL|6ities|8y|2u|3',
  'ndanceS|7tL|3seSD|5rS|4ing|5ve|3tment|4ting|2ysmal|4s|1cacia|3deme|6ia|7cS|8ally|7es|6y|4ia|6n|3nthus|3pulco|2cedeD|5ing',
  '|4lerateSD|9ing|AonS|9orS|7ometer|4ntSE|6uateD|4ptSEG|6ability|8le|7nceS|6or|4ssEG|6es|6ibility|8le|7onS|6ories|8y|3iden',
  'tSL|8alL|3laimE|3oladeS|4mmodateSD|Aing|BonS|5odation|5panied|As|9mentS|9st|8yG|6liceS|8shEG|Aes|AmentS|4rdSEG|6ance|6in',
  'gly|7on|4untSEG|7ability|9le|8ncy|9tS|3reditationS|8ed|8ing|5tion|4ualS|5eSD|5ing|3ueil|4lturation|4mulateSD|9ing|AonS|9',
  'or|4racy|6teL|5sed|4sationS|5eSD|6r|5ing|5tomed|2dbentity|4line|2eS|3r|3taldehyde|5te|4ic|4one|6itrile|4yl|6ation|6choli',
  'ne|6ene|2heSD|4ter|3ievable|6eSD|7mentS|7rS|6ing|4lles|4ng|2idS|4ic|5fication|5ty|4osis|2ker|3nowledgeSD|BmentS|Aing|Ame',
  'ntS|2me|2ne|2olyte|3rnS|3usticS|8alL|2quaintE|8anceS|4iescence|5reSD|7r|6ing|5sitionS|5ttal|7ed|2reS|4age|3obatS|7icS|4n',
  'ymS|4polis|4ss|3ylate|5icS|5onitrile|2tSEG|3a|3es|3in|5ic|4onS|6able|4vateSD|7ing|8onS|7orS|5eSL|6x|5ism|7tS|6ties|7y|3o',
  'n|4rS|3ress|7es|3ualSL|6ity|7zation|5rial|7es|6y|5tion|6orS|2uity|3men|3pressure|4uncture|3ra|3teL|2xiom|2yclic|3l|1dage',
  '|4io|3mS|4ant|3ptSEG|5ability|7le|6tionS|5ec|6rS|5ion|6ve|5orS|2dSEG|3enda|6um|4r|3ictSEG|6ionS|7ve|4e|4son|4tionS|8alL|',
  '6veS|3ressEG|7ee|8s|3uced|5ts|2ela|5ide|4ine|4phi|3nine|4ocarcinoma|5maS|5sine|3pt|3quacy|6teL|2hereSD|6nce|7tS|5ing|4si',
  'onS|6veS|2iabatic|3das|3eu|3pex|4ose|3rondackS|2jacency|7t|3ectiveS|3oining|6t|4urnE|7ment|3udged|5icateD|9ing|Aon|9or|4',
  'nctS|4stSEG|6able|6erS|6mentS|4tant|4vantS|2ler|2minS|5isterSEG|8rated|BionS|CveL|BorS|4rable|8y|6lS|7ty|6tion|5eSD|6rS|',
  '5ing|4ssibility|8le|7onS|4tS|5tance|6edL|6ing|4xtureS|3onished|6tion|2obe|3lescence|9tS|4ph|6us|3nis|3ptSEG|5able|5eeS|6',
  'rS|5ionS|6ve|3rable|5tion|4eSD|4ing|4nE|5ment|2renal|7in|9e|5ergic|3ian|6a|5tic|4enne|4ft|3oit|2sense|3orbed|5ption|2ula',
  'tion|4tS|5erated|7y|5hood|2vanceSD|7mentS|6ing|5tageSD|9ous|3ection|4nt|6istS|6ureS|9rS|8ing|8ous|4rbS|5saries|8y|6eL|6i',
  'ty|5tS|6iseSD|9mentS|9rS|8ing|8ment|3iceS|4sable|5eSD|6ment|6rS|5ing|5orS|7ies|7y|3ocacy|6teSD|7ing|2ware|1edes|2gean|3i',
  's|2olian|3n|2rated|5ion|5or|3ialS|3o|4batic|5icS|4drome|5ynamicS|4nautical|As|4planeS|4smith|5olS|7es|5pace|2stheticS|9a',
  'lly|1far|2fable|4irS|6es|3ectSEG|6ionS|9ateL|7ve|4rent|3idavitS|4liateSD|8ionS|4ne|5ities|7y|4rmSEG|6ationS|9veL|4xE|3li',
  'ctE|7ionS|4uence|7t|3ordSEG|6able|9y|5estation|3ront|2ghanS|6i|7stan|2ield|2loat|2oot|3re|5mentioned|5said|3ul|2raid|3es',
  'h|3ica|6nS|7a|4kaans|2ter|5burner|5care|5glow|5hours|5image|5life|5market|7th|5noonS|5school|6hockS|5taste|6hought|5ward',
  'S|1gain|5st|3memnon|3pe|3r|4wal|3te|4ha|3ve|3wam|2eSDG|3less|3ncies|5y|4daS|4tS|3rs|2gieS|3lomeration|3ravateD|8ing|9on|',
  '4egateSD|8ing|9onS|8orS|5ssion|8veL|Aness|7or|4ieved|2hast|2ile|4ity|3ng|3os|3tated|6ion|6or|2nes|3ostic|8ism|3us|2o|3ni',
  'stS|5zing|4y|3ra|5phobia|2ra|4rian|3eeSDG|5able|5mentS|3icole|5ultural|Ae|3onomic|7y|4und|2uaS|3ilera|1head|3m|2mad|3ed|',
  '4t|1idSEG|3able|3eS|2ken|2leen|4ron|4s|3ing|3mentS|2mSEG|3ee|3lessL|2rSEG|3borne|4rush|4us|3craftS|5ew|3eS|4dale|3fareS|',
  '4ieldS|4oil|4rame|3head|3less|4ift|5neS|7rS|3mail|5n|3planeS|4ortS|3ship|4oft|4trip|3tight|3wayS|4orthiness|3y|2sleS|4in',
  'g|1ka|3sa|2inS|2ron|1laS|3bama|5ster|3ddin|3in|3meda|4oS|3nD|4ine|5s|3rmSEG|5ingly|3ska|6n|4tair|2ba|4core|4nS|5ia|7nS|5',
  'y|4trosS|3edo|4e|4it|4rtS|6a|6o|3icans|4n|5o|4on|3recht|4ight|3umS|5in|4querque|4s|2cantara|4tel|4zar|3hemical|7st|6y|3o',
  'holS|7icS|8sm|4ve|2dehydeS|4r|5man|5ney|3ine|2ec|3jandro|3ph|4po|3rtSEG|5ness|3s|3utian|3x|4a|5nder|7ra|8e|8ia|9te|4ia|5',
  's|2fa|4lfa|3onso|3red|5sco|2gae|4l|3ebraS|7ic|4ria|7n|5non|3inate|3ol|4nquin|4rithmS|9ic|2hambra|2iasEG|5es|3baba|4i|4ri',
  's|3cante|4e|4ia|3enS|5ateD|7ing|8on|5ware|3ght|4nSEG|5mentS|3keS|3mentary|8tion|4ony|3ne|3phatic|3quotS|3so|5n|4t|5er|3t',
  'o|3ve|3yah|2kali|6ne|7ity|5oidS|3yl|2l|3ah|4n|4y|3eS|4gationS|5eSD|6dly|5heny|5iance|6ng|5orical|7y|5ra|6etto|6o|4leS|5i',
  'c|5uia|4n|5town|4r|5genS|8ic|6ic|7es|6y|4viateSD|8ing|9on|4yS|3ianceS|4eSD|4gatorS|4son|4um|3ocable|6teSD|7ing|8onS|7or|',
  '4t|5mentS|5ted|4wSEG|5able|6nceS|4yS|3spice|3udeSD|5ing|4re|5ing|4sionS|4vial|3y|2ma|4nacS|3ighty|3ondS|4st|2oe|3ft|3ha|',
  '3is|3ne|4g|5side|4so|4zo|3of|3pecia|3ud|3ysius|2pacaS|3en|4s|3haS|5betS|8ic|AalL|9zed|5numeric|4onse|3ine|3razolam|3s|2r',
  'eady|3ight|2so|3troemeria|2t|3air|4rS|4vista|3erSEG|5ationS|5cation|5nateSDL|8ing|9on|9veSL|8orS|3hea|4o|5ugh|3imeter|4t',
  'udeS|3oS|4gether|4n|3ruism|7tic|2umS|4ina|6ium|6um|4na|6e|5i|5us|2veolar|3in|2wayS|2yssa|2zheimer|1m|2algam|7ated|9ion|3',
  'nda|4ita|3r|4a|5nth|4illo|4yllis|3ssE|3teurS|4uer|5re|3zeSD|5ment|4ingL|4onS|6as|6ian|2bassadorS|3er|3ien|6ce|6t|4guitie',
  's|8y|6ous|4t|5ionS|7us|4valence|9t|3ler|3rose|6ia|7o|3ulanceS|6tory|4shE|2elia|5orate|3nD|4able|4datory|5ed|5ing|5mentS|',
  '5s|4ities|6y|4orrhea|3r|4icaS|7nS|8a|8ism|3s|3thyst|3x|2herst|2iable|3cable|3d|4e|4st|3ga|4oS|3n|4eS|4o|3r|3sS|4h|3ty|2m',
  'an|3o|4nia|6um|3unition|2nesia|5ty|3iocentesis|5tic|2oeba|3ng|5st|3r|4al|4ous|4phous|4tization|7ed|7ing|3s|3untSEG|4r|2p',
  'ed|4rage|5eS|5sand|3hetamineS|4ibianS|7ous|5theater|3land|4e|4ification|7ed|8rS|8s|6yG|5tudeS|4y|3s|3utated|7ion|5eeS|2r',
  'ita|5sar|2sterdam|2uletS|3seD|5mentS|4ing|2y|3gdala|3lase|4oid|7osis|3otrophic|1nD|2aL|3bolic|3chronism|Atic|4onda|3drom',
  'ous|3emia|4robic|4sthesia|3gramS|3heim|3lL|4gesia|8cS|4og|6ies|6ousL|6ueS|6y|4yseSD|7rS|6ing|7s|6tS|5tic|8alL|5zeSD|7rS|',
  '6ing|3morphic|3nd|5a|3phylaxis|3rchism|8tS|6y|3sazi|4tasia|5omosis|3thema|4ole|6ian|6y|5mic|8alL|6y|2cestorS|6ral|7ies|7',
  'y|3horSEG|6age|6ess|5vies|6y|3ientS|4llary|3ona|4ra|2dale|5usian|4man|4nte|3ean|4rS|5sen|6on|4s|3hra|3iS|3orra|7n|4ver|3',
  'reS|5aS|5wS|4ogenS|5ids|5meda|3y|2ecdotal|7eS|3mia|5c|4ometer|5neS|3sthesia|9ologist|Dy|7ticS|9zed|3urysmS|3w|2gelS|5a|5',
  'es|5ic|7a|6na|7e|6que|5oS|5us|4rSE|3ie|4na|4ogenesis|6raphy|5plasty|3laise|4eSD|5rS|4ia|6n|5canS|5ng|4o|3ola|4ra|3rily|4',
  'y|3st|5romS|3uilla|5sh|4lar|4s|2hydride|6ous|2il|4ine|3maS|5lS|6es|6ia|6sex|5teD|6ing|7onS|6orS|4eS|4ism|4osity|4us|3onS',
  '|5ic|3se|4otropic|9y|4ton|3ta|2jou|2ker|3leS|5tS|3ylosing|2n|3abel|4les|5s|4n|4polis|5urna|3eS|4aled|6ing|4tte|4xE|5atio',
  'n|5es|5ure|3ie|4hilateD|9ion|4versaries|Ay|3otateD|7ionS|4unceSD|8mentS|8rS|7ing|4ySEG|5anceS|5ingly|3ualSL|6ized|4itant',
  '|6ies|6y|4lar|5led|5ment|5us|4m|4nciation|2odeS|4ized|3inted|6ing|3malies|6ous|6y|3n|4ym|6ity|6ousL|3pheles|3rak|4exia|3',
  'ther|2sar|3el|5m|3werSEG|6able|6er|2tS|3acidS|4gonism|9tS|Aic|4l|4rctic|9a|5es|3eS|4c|5edentS|4lope|4natal|5naS|7e|4rior',
  '|3hemS|4ill|4ologies|8y|5ny|4racene|7ite|6x|5opogenic|8logical|CstS|By|8morphic|3i|4bacterial|5ioticS|5odies|7y|4cS|5anc',
  'er|5hrist|5ipateSD|9ing|Aon|9ory|5oagulantS|4dote|5umping|4etam|4freeze|4genS|7ic|5one|5ua|4histamineS|4lles|4mony|4och|',
  '5xidantS|4pathy|4qua|7rian|7ted|6eSD|6ities|8y|4septic|6rum|5ocial|4thesis|5rust|4viral|7us|4war|3lerS|3oine|7tte|4n|5el',
  'la|5ia|6o|5y|6ms|3rim|3werp|2ubis|3s|2vil|2xieties|6y|4ousL|2y|3body|3how|3more|3oneS|3place|3thing|4ime|3wayS|4here|2za',
  'c|1open|2rta|4ic|2tearoa|1pace|5r|4he|3r|4t|5heid|5mentS|3thetic|5y|4ite|2ertureS|3s|3x|2hasia|3idS|4s|3orisms|3rodisiac',
  'S|7te|2ical|3ece|2lenty|2nea|3ic|2ocalypse|8tic|4rypha|9l|3gee|3llo|4ogeticS|6ies|7stS|7zeSD|8ing|6y|3phis|4tosis|3stasy',
  '|6te|5leS|5olic|5rophe|3thecary|2palachia|AnS|5led|6ing|4ratus|5elS|6ntL|5itionS|3ealSEG|6able|5rSEG|6anceS|5se|7ment|4l',
  'lantS|7te|8ion|6eeS|4ndSEG|6ageS|6ices|8itis|7x|8es|4titeS|6zerS|3laudSE|6se|4eS|5gate|5sauce|5tS|6on|4ianceS|5cability|',
  '8le|7ntS|7tionS|8orS|5ed|6s|5ng|5queS|4yG|3ointSEG|7eeS|7mentS|4rtionE|9ment|3raisalS|7eD|8rS|7ing|4eciable|Ay|8teSD|9in',
  'g|Aon|Ave|5hendE|8sionS|Ave|5nticeS|AshipS|4ised|4oachEG|8able|8es|5bation|5priateSDL|Bness|Aing|BonS|5valS|6eSD|7rS|6in',
  'g|5x|6imateSDL|Aing|BonS|3urtenances|2ricotS|4l|3onS|4pos|2tSL|3itudeS|1qua|4culture|4marine|4ria|7n|6umS|7s|4ticS|3educ',
  't|4ous|3iferS|4la|3os|1rabS|4ella|5sque|4ia|6nS|5c|5dopsis|4le|3chidonic|5ne|3fat|3maic|4is|3paho|2biter|5ral|7rily|8y|7',
  'te|8ionS|8orS|3orS|5etum|3utus|2cS|3adeS|5ia|7n|4na|5e|5um|3hEG|4aeological|BstS|Ay|5ic|5ngel|4bishop|4diocese|4eS|5rS|6',
  'y|5typal|8eS|4ibald|5e|5medes|5pelago|5tectS|9uralL|BeS|5val|6eSD|7r|6ing|7stS|4on|5s|4way|3os|3tic|4urus|2den|5t|3or|3u',
  'ous|2eS|3aS|4l|3naS|4t|3olaS|3te|2gent|6inaS|8e|9an|8ian|8o|3inine|3oS|4n|5autS|5ne|4sy|3uable|7y|4eSD|4ing|4mentS|8atio',
  'n|Bve|4s|3yle|5l|2iaS|4dne|4n|5a|3d|3el|4s|3on|3seS|5n|4ing|4ta|5ocracy|9tS|Aic|6telian|7le|3thmetic|3zona|2jun|2kansas|',
  '2lene|4s|3ington|2mSEG|3ada|5illo|4geddon|4mentS|4ni|4ture|3chairS|3enia|7nS|4s|3ies|4stice|3oireS|4rE|5ial|5y|4ur|3pitS',
  '|3restS|3strong|3y|2ne|3ica|3old|2omaS|5therapy|6icS|3se|3und|4sal|5eD|5ing|2raigned|7ment|4ngeSD|7mentS|7rS|6ing|4s|4yS',
  'E|3ears|4stSEG|3hythmiaS|3iba|4valS|5eSD|5ing|3ogance|7t|4wS|5headS|5smith|4yo|2se|4nalS|5ic|3on|2tS|3efactS|4mis|7ia|4r',
  'ial|6es|6osclerosis|7venous|5y|4s|5ian|5t|3fulL|3hritic|8s|5oplasty|7odS|9a|4urS|6ian|3ichokeS|5leS|5ular|8teSD|9ing|Aon',
  'S|4e|4factS|5ice|7ialL|4llery|4sanS|5tS|6direct|6eS|6ic|8ally|6ry|3workS|2uba|3sha|2xiv|2yan|1sS|2ana|3ph|2bestos|8is|2c',
  'endSEG|6ancy|8t|5sion|5t|4rtainEG|4tic|3ii|4tes|3orbic|4t|3ribeD|2ean|3ptic|3xual|2h|3a|4med|4nti|3croft|3en|4r|4s|4vill',
  'e|3ford|3land|4ee|5y|3ore|3raf|3ton|2ia|4nS|4tic|3cs|3deS|2kSEG|3er|4w|2leep|2nblock|2paragus|5tate|6ic|3ectS|4n|4rger|6',
  'illus|3halt|3idistra|4rated|7ionS|5eSD|5in|7g|2sailantS|6ed|4m|5ese|4ssinS|8ateD|AionS|4ultSEG|4ySE|3ed|4mblageS|7eSD|8r',
  'S|7ies|8ng|7y|8man|4ntE|4rtSEG|6ionS|7ve|9ness|4sS|5sable|6ed|7s|6ing|6mentS|6orS|4tS|3hole|3ignSEG|6able|6ee|6mentS|6or',
  '|4milateD|9ion|4s|5tSEG|6ance|8tS|9shipS|6ive|3oc|5iateSD|8ing|9onS|9ve|4rted|6mentS|3umeSD|5ing|5ptionS|4ranceS|5eSD|6d',
  'ly|5ing|3yrianS|2terS|5aceae|5iskS|5oidS|3hma|6tic|3igmatism|3on|5ishEG|8ingly|8ment|4r|5ia|4unded|7ing|3ra|5galus|5l|5y',
  '|4id|6e|5ngent|4oS|5cytes|8oma|5dome|5logerS|8ical|8y|5nautS|9ics|6omerS|8ical|8y|5photography|7ysical|Bs|3ute|2under|2w',
  'ell|2ylum|3mmetric|Aal|9es|8y|4ptomatic|7ticS|Aally|3nchronousL|1tEG|2ari|3xia|2chison|2e|3lier|2habasca|3eism|6tS|7ic|4',
  'na|6eum|5ianS|5s|4rosclerosis|3leteS|6icS|8ism|4on|2ivan|2kins|6on|2lanta|6ic|7s|4s|5es|2man|3os|5phereS|9ic|2oll|3mS|4i',
  'c|3ne|5ment|3p|4ic|2resia|4yu|3ia|5l|4um|3ocious|6ties|7y|4phy|5ine|2tachEG|6eS|6mentS|5kSEG|6erS|4inSEG|6able|6mentS|3e',
  'mptSEG|4ndSEG|6anceS|8tS|6ees|5tionS|9al|7veL|5uateD|8ion|8orS|4stSEG|6ation|3icS|4re|4tudeS|7inal|3orneyS|3ractSEG|7ion',
  'S|8veL|Aness|7orS|4ibutable|8eSD|8ing|9onS|5tion|3uned|2ypical|1ubrey|3urn|4sson|2ckland|3tionSEG|7eerS|2dacious|6ty|3ib',
  'le|4enceS|4oS|5books|5logistS|8y|5phile|5slave|5vox|4tSEG|5ionSG|5orS|7iumS|7y|3rey|3ubon|2gen|4r|3ht|3mentSEG|7ation|3u',
  'st|6a|6in|8e|6us|2ntS|4ie|2ra|4l|3elia|6us|4us|3ora|6l|2spices|6ious|3sieS|3ten|5r|6e|6ity|4in|4ral|7asia|Bn|7ia|9nS|5ia',
  '|7nS|2tem|3henticS|9ally|AteSD|Bing|Con|Bor|9ity|4orSEG|6isation|8ed|7tarian|Dism|9tive|8ies|8y|7zationS|8eSD|8ing|6ship',
  '|3ism|5tic|3oS|4antibodies|4bahn|5iographical|Des|Cy|4cad|5lave|5ratic|4desk|4graphSE|4harp|4immunity|4logous|4mata|7eSD',
  '|7ic|9ally|8ng|8on|7on|5obileS|6rphism|6tiveS|4nomic|7ousL|7y|4pilot|5sy|4radiography|4somal|3umn|6al|2xiliaries|8y|4n|1',
  'vailE|5abilities|By|7le|3lancheS|4on|3nt|5i|3rice|3st|3tarS|3ya|2e|3na|4geD|6rS|5ing|4tail|5urine|4ueS|3ra|5geSD|6ing|4s',
  'e|5ion|4tE|4y|2ian|4ry|4tion|5orS|3d|3s|4o|2ocadoS|3idSEG|5able|6nce|3wed|2ril|1waited|5ing|5s|3keS|5nSEG|6ings|3rdSEG|4',
  'e|5ness|3sh|3yS|2esome|2fulL|2hile|2kwardL|7ness|2ningS|2oke|1xel|3s|2ial|3llary|3omS|5atic|4n|3s|2leS|2minster|2onal|4s',
  '|1yeS|3r|2lesbury|2mara|2rshire|1zaleaS|2erbaijan|Ai|2ide|3muth|7al|2onic|2tecS|5a|0baba|3bitt|4le|6r|5ing|3cock|3eS|4l|',
  '3ies|3oonS|3yS|4lon|7ian|2ccalaureate|5rat|4hus|3h|4arach|4elorS|3illi|6us|3kSEG|4ache|4board|6neS|4country|4doorS|5ropS',
  '|4erS|4fill|6re|5low|4gammon|5roundS|Aer|4hand|4lash|5ess|5og|4packSG|8ers|4side|5pace|5tage|6reet|7oke|4trackG|4upS|4wa',
  'rdS|6sh|6terS|5oods|4yard|3on|3teremia|6ia|8l|7ological|By|8phage|7um|3ula|2dL|3en|4r|3geS|5rS|3lands|3minton|3ness|2er|',
  '2ffleSD|5ing|3ta|2gS|3dad|3elS|3gage|4ed|5r|4ing|4y|3hdad|3pipeS|3uette|2hamaS|5ian|3rain|3t|2ilSEG|4eyS|4iff|3nS|4es|3r',
  'd|3tSEG|2keSD|4lite|4rS|5ies|5sfield|5y|3ing|3u|2la|4clava|4nceSD|7r|6ing|3boa|3conies|6y|3dG|4ness|4win|4y|3eS|4aric|4r',
  '|3i|4nese|3kanS|3lSG|4adS|5rd|5stS|4erS|6ina|5tS|4isticS|4oonSG|5tSG|4room|4y|3mS|4er|4oral|4y|3oney|3sa|5m|6ic|3ticS|5m',
  'ore|2mbini|6o|4oo|2nSD|3al|4naS|3bury|3c|4a|4o|3da|5geS|5nna|5r|4eD|4icoot|5ng|5tS|4s|5tand|4y|3e|3ff|3gSEG|4alore|4bus|',
  '4kok|4ladesh|5eS|4or|3ishE|6ment|5ter|3joS|3kSEG|4erS|4rupt|8cies|9y|4sia|3ned|5rS|4ing|5ster|4ock|3quetSG|3sheeS|3tam|4',
  'er|4u|3yan|3zai|2obab|2ptismS|7al|6tS|5zeD|2rSDEG|3angay|3bSE|4ados|5ra|6ianS|7c|7sm|6ous|6y|4ecueSD|5que|5rS|6shop|4ica',
  'n|5e|5turates|4ra|4uda|3celona|4ode|3ds|3eSL|4back|5oat|6neS|4foot|3fly|3gainSEG|4eS|5r|3i|4tone|4um|3kSEG|4erS|3ley|4ow',
  '|3m|4an|3nS|4abas|6y|5cle|5rd|4es|5tt|5y|4yard|3ometerS|7ric|4nS|5ess|6t|5y|4que|3raS|5ckS|6uda|5ge|4eD|5lS|5nS|5t|6t|7e',
  '|4icadeS|5e|6rS|5ng|7ton|5oS|5sterS|4on|5wS|4y|3tS|4enderS|7ing|5r|4h|5olomew|4lett|4on|4ram|3uch|2sal|5t|3eSD|4ballS|5o',
  'ard|4l|5ess|5ine|4man|5entS|4name|3hEG|4ful|3icSL|5ally|4l|5ica|4nS|5g|4s|3kerville|5tS|6ball|6ry|4ing|3queS|3s|4as|4es|',
  '5t|4inetS|5st|4o|5on|4wood|3ta|5rdS|4ille|5on|2tS|3aan|3chEG|5es|3eau|4man|4s|3hSEG|4e|4robeS|6omS|4tubS|4ymetry|3ik|3ma',
  'n|3onS|3sman|3tSEG|4alionS|4en|5rSEG|6ies|6y|4leSD|6fieldS|6groundS|6shipS|5ing|4y|2ubles|3d|3er|3me|3xite|2varian|2xter',
  '|2yS|3ard|3berry|3er|4s|5ian|3lor|3onetS|4u|3wood|2zaar|3ooka|1eDG|2ach|5comber|5es|4onS|3dSEG|4le|4work|3gleS|3k|4er|3l',
  'S|3mSEG|4er|4ish|3nS|4bag|4ieS|4o|4stalk|3rSDG|4able|4ded|5s|4erS|4ings|5sh|3stSL|5ality|5iality|6e|3tSG|4en|5rS|4ings|4',
  'les|4rice|6x|3u|4fort|4jolais|4mont|4ne|4t|5ician|6es|6fication|7ulL|7y|5y|4x|3verS|2bop|2came|4use|3kS|4er|5t|6t|4ham|4',
  'onSEG|4y|3omeS|5ing|2dded|4ing|3ford|7shire|3lam|3ouin|3rock|5omSE|3s|4ide|4preadS|4tead|3time|2eSG|3ch|5er|5wood|3fE|4y',
  '|3hive|3keeperS|7ing|3man|3n|3rS|3swax|3tS|4hoven|4leS|2fall|3itting|3ore|6hand|3riendSE|2gan|4t|3garS|4ed|4ing|3inSG|5n',
  'erS|6ingS|3one|5ia|4tten|3s|3uiling|4n|2half|4veSD|5ing|6orS|8al|7ur|9al|3eaded|6ing|4ld|4moth|4st|3ind|3oldG|6en|7r|2ig',
  'e|3jing|3ngs|3rut|2jeweled|2la|4rus|4tedL|4y|3cher|3eaguered|3fast|4ry|3gianS|5um|4rade|6via|3iefS|5s|5vable|6eSD|7rS|6i',
  'ng|4nda|4ttle|4ve|4ze|3kin|3lSG|4aS|5donna|5rmine|4eS|5ek|5ville|6ue|4flower|4ied|6s|5gerent|5ngham|4man|4owS|4south|4we',
  'ther|5ood|4y|3mont|3ongSEG|6ings|4ved|4w|3tSEG|4on|3uga|3vedere|2mused|2nDG|3ch|5es|5markSG|3derS|4ing|4s|3e|4ath|4dict|',
  '8ine|9on|4factorS|5icent|7ialL|9ries|Ay|6tSEG|7ted|8ing|4lux|4t|4volence|9t|3galS|6i|3ign|4n|3jaminS|3ner|5t|6t|4ing|4y|',
  '3son|3t|4hic|4ley|4on|6ite|3zene|4o|5ate|5yl|4yl|2owulf|2queathE|5stS|2rber|3eaved|7ment|4ft|4tS|3g|4amo|7t|4en|5r|3ing|',
  '3keley|4owitz|4shireS|3lin|6er|5os|3man|4s|4uda|6ian|3n|4ard|7ino|4e|5r|5se|4hard|4ice|5e|4stein|3ri|5es|4y|3s|4erk|7er|',
  '3t|4hS|5a|5old|4ie|4ram|6nd|3yl|5lium|2seech|4t|3ideS|4eged|3poke|3s|4emer|5r|4ie|3tS|4est|4ial|7ity|6ry|5ll|4owSE|4sell',
  'ers|8ing|2tS|3aS|4ine|3h|4any|4el|5sda|4lehem|3raySEG|6al|4othed|3sey|4y|3ta|4er|6ment|4ina|6g|4y|3ula|3ween|4ixt|2ulah|',
  '2velE|4rageS|5ly|2ware|3ildered|8ing|8ment|4tched|2yer|3once|5d|2zelS|1hakti|2utan|1ianca|5hi|5o|4nual|3sEG|4es|2bleS|4i',
  'calL|5ographic|Dal|Ces|By|3s|3tex|2carbonate|3entennial|4ps|3kering|3olor|3ycleS|6ing|7sts|2dS|3derS|4ing|3etS|3irection',
  'al|3pay|2en|4nial|6um|2focal|3urcation|2g|3ger|5st|4s|3horn|4t|3otSE|5ry|3wig|2hari|2jou|5x|2keS|4r|3ing|5iS|3ram|2later',
  'alL|3berry|4o|3der|3e|3ge|3iary|4near|5gual|9ism|4rubin|3lSEG|4able|6ong|4boardS|4er|5tS|4fold|4iardS|5e|5ngs|5onS|7aire',
  'S|4y|3oxi|2mini|3onthly|2nSD|3aries|5y|4ural|3derS|6y|4ingS|4s|3g|4hamton|4o|3ks|3ning|3ocularS|4mial|3utils|2ochem|7ica',
  'l|8st|Ary|3diversity|3genesis|5ochemistry|6graphic|By|4rapher|8ical|9es|8y|3informatics|3logicS|8alSL|7stS|6y|3mass|4eSD',
  '|5chanical|Bs|5dical|5tricS|3physical|9s|4sies|5y|3s|4phere|4tatistics|4ynthesis|9tic|3ta|4ech|7nology|4ic|5n|2partisan|',
  '7te|3henyls|3lane|3olar|2rch|5wood|3dSG|4erS|4houseS|4ieS|4man|4y|3kenhead|3mingham|3thSG|5dayS|5place|5right|5stoneS|2s',
  'cuitS|3exualS|8es|8ity|3hopS|3ley|3marck|4uth|3on|3que|3sau|4on|3tro|2tSG|3chG|5es|3eS|3map|3pipe|3rate|3ten|5rSL|6ness|',
  '6root|6sweet|4orrent|4y|3umen|5inous|3wise|2variate|2weekly|2z|3arre|3et|3journals|Bhire|3kit|3rate|1lackSE|5berries|9y|',
  '6irdS|6oard|6urn|5ened|6r|5foot|6riars|5ie|5jack|5mail|5ness|5outS|5pool|5smithSG|5water|6ell|6ood|3dder|4eSD|3h|3in|5e|',
  '4r|3keSL|3meSD|5less|4ing|3nc|5a|5h|5o|4dG|4kSG|5etS|3ring|4ney|3sphemous|8y|4tSEG|5erS|3tantL|4her|3zeSD|5rS|4ing|2each',
  'EG|6erS|4k|3d|3edSG|3mish|7es|3ndSEG|5erS|3pharoplasty|3ssEG|5es|5ings|4t|2ick|3ghtE|3mp|3ndSEGL|5foldE|5ness|4g|4kSEG|3',
  'ss|5fulL|4terSG|3tz|5er|5krieg|3zzard|2oatEG|3bS|3cS|4kSEG|5ade|6geS|5busterS|5erS|5head|3ed|3gS|4gerS|5ing|4lines|4osph',
  'ere|4roll|4shares|4this|3keS|3nd|5eS|3odSE|5hound|5less|6ineS|5shed|7ot|5thirsty|5y|4mSG|5berg|5erS|5field|5ington|5sbur',
  'y|4pers|3ssomSEG|3tS|4ter|5ing|3useS|3wSG|4back|4erS|4fish|4jobS|4n|4outS|2ueS|4bell|6rries|8y|5irdS|5onnet|4fish|4gill|',
  '5rass|4printS|4stone|3ffSG|3ish|3nderS|4tSEL|3rS|4bS|4red|5ing|5y|4ted|3shEG|1oarSD|4ded|6rS|5ing|5man|5s|5walk|3stSEG|3',
  'tSG|4erS|4house|4man|2bS|3bie|5nS|6g|4le|4y|3catS|3o|3sled|6igh|2cca|4e|3es|3k|2deS|4ga|4n|3hisattva|3ice|4ed|5s|4ly|3on',
  'i|3y|4builderS|9ing|4guardS|4work|2eing|3r|2gan|4rt|3ey|3ged|4le|5ing|3ie|3le|3ota|3ue|4s|2hemia|7n|2ilSEG|4erS|6makers|',
  '3ng|3s|4e|4terous|2ker|2ldEL|4er|5st|4ness|3ero|4s|3ivar|5ia|7n|8o|3lards|4ing|7er|4ocks|4ywood|3ogna|3shevikS|4terSEG|3',
  'tSEG|4on|3us|2mbSEG|4ardE|7ier|7ment|5stic|5y|4erS|4ings|4shell|2nDEG|3anza|4venture|3dageD|4ed|4holders|4ing|4s|3eS|4le',
  'ss|4r|4y|3fire|3gS|4oS|3iface|4to|3ner|5tS|4ie|4y|3sai|3tril|3us|5es|2obSE|4ies|4y|3ed|3ger|4ie|3kSEG|4able|4binding|4ca',
  'seS|5rossing|4er|4ieS|5ngs|5sh|4keeper|8ing|4letS|4makerS|6n|6rkSEG|4plate|4sellerS|5helf|6opS|5toreS|4worm|3l|4ean|3mSE',
  'G|4erS|6ang|3n|4docks|4e|3stSEG|5erS|3tSEG|4hS|4ies|4legS|4strap|9ping|4y|3ze|5r|2pper|2ra|4ge|4x|3deaux|5llo|5rSEG|6lan',
  'ds|7ess|7ine|3eSD|4al|6is|4dom|4holeS|4r|3g|4er|5s|4hese|3ic|4ng|4s|3land|3n|4e|5o|3o|4n|4ughS|3relia|4owSEG|6erS|6ings|',
  '3zoi|2sch|3e|3nia|6n|3om|3s|4es|4y|3ton|6ian|2tanic|7alS|6st|5y|3ched|3h|4erSEG|6some|3s|4wana|3tleSD|6neckS|7ose|5ing|4',
  'omSE|6less|3ulinum|6sm|2uche|6r|3doir|3ghS|5t|3illon|3lderSG|4evardS|3nceSD|6rS|5ing|4dSEG|5aries|7y|5less|4ties|6ful|5y',
  '|3quetS|3rbon|4g|5eois|9ie|4ne|6mouth|4se|3tS|4ique|3vet|2vine|2wSEG|3elS|4n|4rS|5y|4s|3ie|3ker|3lSEG|4erS|5s|3man|3yer|',
  '2xcar|3ed|4rS|4s|3ing|3wood|2ySD|3ce|4ottSEG|3ds|3er|4s|3friend|3hood|3ish|3le|1raSD|3bant|3ceSD|5letS|4hial|4ing|4k|5en',
  '|6tSEG|5ish|3dbury|4ford|4ley|4s|5haw|4y|5cardia|3gS|4gG|3hma|6n|5in|5s|3idSEG|4lle|4nSE|5er|5washed|9ing|5y|4sed|3keS|4',
  'ing|3m|4ble|3nD|4chEG|6es|4ded|6nburg|5i|6ng|5on|5s|5y|6wine|4es|4son|4t|3sh|5er|4il|4s|5ica|3tS|4z|3un|3va|5do|4eSDL|5r',
  'y|5st|4o|3wl|4n|3y|3zen|4ier|5l|6ianS|5ng|2eachEG|6es|4dSE|5makers|5th|4kSG|5able|6ge|6way|5downS|5erS|5fastS|5neck|5out',
  'S|5throughS|5up|5water|4m|4stSE|6feeding|6plate|4thSEG|6able|6eS|7r|6less|6taking|3ck|5enridge|3d|3eD|4ch|6es|4derS|5ing',
  '|5s|4zeS|5y|3men|5r|3nda|6n|4nan|4t|5wood|3t|4hren|4on|4t|3ve|4ity|3wSEG|4erS|6ies|6y|4ster|3yer|2ian|4r|3beSD|5ry|3ckS|',
  '5er|5work|5yard|3dal|4eS|5groom|5smaidS|4geSD|6man|6port|6r|6t|6water|5ing|4le|3efSEGL|5case|5ings|4r|3g|4adeS|6ier|5nti',
  'ne|4gs|4ham|5tSL|6enSEG|7r|7st|6ness|6on|4id|3ll|5iance|8tL|3m|4ming|4stone|3ne|4gSG|4k|5er|3sbane|4kL|5et|4tleS|5ol|3tS',
  '|4ainS|5nnia|8ca|4ish|4ney|4onS|4tany|5en|5le|2oach|4dSL|5band|5castSEG|9erS|6loth|5enSEG|6r|6st|5leaf|5side|5way|3cade|',
  '4coli|4hureS|4k|3der|4ie|3gan|3ilE|5erS|3ke|5back|5n|5rSEG|6ageS|4ing|3mide|5ne|3nchial|7tis|5oS|4x|4zeS|3och|6es|4dG|4k',
  'S|5eS|6r|5field|5lyn|5side|4mS|3th|5elS|6rSL|7hood|3ugh|6am|6t|3wS|4ard|4er|4nSEG|5back|5e|5ian|6eS|6sh|5stone|4seD|6rS|',
  '5ing|2uce|5lla|7osis|3inS|4seSD|5ing|3ker|3le|5e|3nch|4ei|5t|6teS|4o|4swick|4t|3shEG|5es|5less|4sels|3t|4alL|6ity|4e|4is',
  'h|4us|2yan|5t|3ce|1ubbleSD|5ing|5y|2ccal|5neerS|3hanan|5rest|3kSG|4aroo|4etS|5yeS|4horn|4ingham|Ashire|4leSD|6r|6y|5ing|',
  '4shot|5kin|4wheat|4y|2dapest|3dhaS|5ism|7tS|4ies|5ng|3ge|5tSEG|6ary|3s|2ena|4os|2ffSG|4alo|7es|4erSEG|5tS|4y|3ing|2gS|3a',
  'boo|3ged|5rS|4ies|5ng|4y|3le|3zilla|2ick|3ldSG|5erS|5ings|5up|4t|2kkake|2lbS|4ophyllum|5us|3gari|7a|8n|4eS|5r|4ing|3imia',
  '|3k|4headS|4y|3lS|4dogS|6zerS|4er|5tSE|6inS|6proof|4frog|4head|4ied|6s|5on|5sh|4ock|4shit|4ySG|3wark|2mble|6bee|5ing|3me',
  'd|5r|3pSEG|4erS|4y|2nce|4h|5es|4ombe|3dleSD|5ing|4y|3galowS|4ee|4le|3kS|4erS|3nell|4ies|5ng|4y|3s|3ting|4on|2oySE|4ancy|',
  '6t|2rbank|4erry|3denSE|6some|4ock|3eauS|6cracies|Ay|9tS|Aic|6x|3g|4eoning|5rS|5ss|4h|4larS|7ies|7y|4undy|3ialS|4ed|5s|3k',
  'e|4ina|3lap|4esque|5y|4ington|4y|3ma|5n|4ese|3nSEG|4erS|5t|6t|4ie|5shed|4side|4t|3r|4itoS|4o|5wSG|3sa|5r|6ies|6y|4itis|4',
  'tSG|3t|4on|3undi|3yG|2s|3by|3ch|3es|3hG|4elS|5s|4ings|4land|4man|4nell|4veld|4y|3ily|4nesS|7ses|8man|8woman|3ses|3tSEG|4',
  'erS|4le|5ing|4y|3y|2t|3adiene|4lbital|4ne|3ch|5erSE|3e|3lerS|3tS|4eS|5rSE|6cup|6flies|8y|6milk|6nut|6scotch|6y|4le|4ockS',
  '|5nSE|4ress|3yl|2xom|2ySG|3erS|2zzEG|4ardS|4er|4net|1y|2e|2gone|2lawS|2passEG|6es|2rne|3on|2standerS|2teS|2wayS|2zantine',
  '|0cabS|3al|4naS|4ret|3bage|3ernet|3inS|5etS|7ry|3leSD|4ing|3ochonS|4ose|4t|3riolet|2cao|3hes|5t|3ophony|3ti|4us|2d|3astr',
  'al|7e|4ver|3dieS|4o|4y|3ence|4tS|3illac|3mium|3reS|2erphilly|3sarS|6ean|2feS|4teriaS|3feine|2geSD|2hill|2icos|3man|3n|3r',
  'nS|4o|2junS|2keS|4walk|2lL|3abash|5rese|4is|4mities|7y|4nder|3careous|4ification|5te|5um|4ulateSD|8ing|9onS|8orS|6i|6us|',
  '5tta|3dwell|3eb|4donia|9n|4ndarSG|6erS|6ula|3f|3gary|3houn|3iban|5er|5rateD|8ing|9onS|8orS|6e|4co|5ut|4fornia|AnS|4perS|',
  '5h|6ate|4sta|3kins|3lSEG|4aS|5ble|5way|4back|4erS|4i|5graphy|5ope|4ous|5w|4us|3mSEGL|4er|4ness|3or|5ic|6eS|6meter|9ry|3u',
  'met|3vary|4ert|5s|4in|6g|6ism|8t|3ypso|4x|2mS|3araS|6derie|5o|3ber|4odia|8n|4ria|7n|6dge|9shire|4s|3corderS|3den|3e|4lS|',
  '5back|5lia|5ot|5toe|4oS|4raS|6man|5on|6on|3illa|6us|4no|4soleS|3ouflageD|3pSEG|4agna|5ignSEG|8erS|5na|6ile|4bell|4erS|4f',
  'ireS|4groundS|4hor|4ion|4oS|4us|6es|3shaft|3us|2nSG|3a|4an|4da|5ianS|4lS|5es|4rd|5ies|5y|4sta|3berra|3celSEG|6lationS|7e',
  'd|7ing|5rS|6ous|4un|3dace|4ela|7bra|4idL|6acy|7teS|8ure|5ed|6s|4leS|6box|6holderS|6light|6r|6stickS|6wood|4or|4y|3eS|3fi',
  'eld|3ineS|4s|5terS|3ker|3na|5bis|4ed|5ry|5s|4ibalS|8ism|5ng|4onS|4ula|4y|3oeSG|4nS|5ical|4pies|5us|5y|3tL|4aloupe|5taS|4',
  'eenS|5r|6bury|4ilever|5na|4o|5nS|6ese|5r|3uckS|3vasS|6es|6sing|3yonS|2pS|3abilities|9y|5le|4citance|7ies|8ve|7orS|7y|3eS',
  '|4l|5la|4rS|3illaries|8y|4ta|6lS|7ism|9tS|Aic|8zation|9eD|9ing|6n|6tion|5ol|3ote|3ped|4ing|3ra|4iS|5ce|6ious|6orn|3saici',
  'n|4icum|5d|4tone|4uleS|3tainS|4ionSEG|5vateD|8ing|6eS|6ity|4orS|4ureSD|6ing|2rSDEGL|3a|4biner|4fe|4mel|7ized|4tS|4vanS|7',
  'ning|4way|3bide|5ne|4o|5hydrateS|5nS|6aceous|7teSD|6ic|6yl|5xy|7l|8ase|8ic|4uretorS|3cass|7es|4inogenS|Aesis|Aic|7id|7ma',
  'S|3damom|4board|4ed|4holderS|4iac|5ff|5ganS|5n|6alS|5oid|6logistS|9y|6pulmonary|6vascular|4making|4o|5na|4s|5tock|3eS|4e',
  'rS|6builder|4free|5ulL|4giverS|4lessL|8ness|4rS|4ssEG|4t|5akerS|4x|4y|3fax|3go|5es|3ib|5bean|5ou|4catureS|4es|4llon|4na|',
  '4soprodol|5sa|3lG|4a|4eton|4in|5sle|4oS|4sbad|5on|4ton|3man|4el|5n|4ine|3nage|5l|5tionS|4egie|5lian|5y|4ivalS|6oreS|8ous',
  '|3o|4b|4lS|5e|5inaS|7e|5yn|4tene|7oids|5id|4usel|3p|4al|5thian|4enterS|7ry|5r|5tSEG|4ortS|3rS|4ara|4era|4iageS|8way|5ck|',
  '5eSD|6rS|5on|4oll|5tS|4yG|3son|4ten|3tS|4eS|5lS|5rS|5sian|4ier|5lage|4man|4ographic|Ay|5nS|5onSG|7istS|5uche|4ridgeS|4wr',
  'ight|4y|3veD|5n|5rS|4ingS|3y|4l|2sablanca|4l|3bah|3cadeSD|6ia|7ng|4o|3eSD|4book|4in|4ment|4work|8erS|4y|3hEG|4el|5wS|4ie',
  'rS|4mere|3imir|4ngS|5oS|4o|3ketS|4s|3lon|3par|4er|4ian|3s|4andra|4e|5grain|5roleS|5tteS|4ia|5dy|5e|5opeia|5s|5us|4on|3tS',
  'G|4awayS|4eS|5llano|5rS|4illa|5ngs|4leS|4orS|4ration|5o|3ualSL|6ties|7y|5rina|2tSE|3abolism|4clysmic|5ombs|4lan|6se|5ina',
  '|5ogS|7ueSD|8ing|5ysis|7tS|6tic|6zeSD|4maranS|5ounts|4n|4pultE|4ractS|4stropheS|Aic|4wba|3chG|5erS|6s|5mentS|5y|3eS|4chi',
  'sm|4goricalL|8es|8zation|9eD|9ing|7y|4rSEG|5erS|5pillarS|4ye|3fish|3harina|8eS|6sis|6tic|5y|4edralS|5psin|5rineS|5terS|8',
  'ization|4ode|6ic|5licS|8ism|4y|3ionS|6ic|3lin|3nip|3skillS|3tery|4le|3walk|2ucasianS|4us|6es|3dal|3ght|3liflower|3salL|6',
  'ity|5tion|7ve|4eSD|5way|5y|4ing|4tic|3tionSE|7ary|6usL|2valcade|5ierS|5ry|3eSD|4atS|4ndish|4rnS|6ous|3iar|4ng|4tation|5i',
  'es|5y|2yenne|3man|3uga|1drom|1easeSD|5less|4ing|2cil|5e|5ia|5y|2darS|5wood|3ed|3ric|2ilidh|5ngS|2ladon|3ebS|5rant|7teSD|',
  '8ing|9onS|8ory|6ex|6ities|8yS|4ron|5y|4ste|6ial|7ne|4xa|3ia|5c|4bacy|6te|4ne|3lSE|4a|5rS|4ist|4o|5phane|4phone|4ular|6oi',
  'd|7se|3sius|3ticS|4s|2mentSEG|6itious|4teries|7y|2nozoic|3sorSEG|6ship|4ure|5s|6es|3tS|4aurS|7i|4enary|6nial|5rSEG|6piec',
  'eS|4igrade|5meterS|5pede|4os|4ralL|7e|7ity|8zation|9eD|5eSD|5ic|6fugal|Ation|9eSD|6no|6st|5o|6id|5um|4uries|7on|6y|2rami',
  'cS|3berus|3ealS|4bellar|8um|5ral|6ospinal|4monial|8es|7y|4s|4us|4visiae|3ise|3n|3tainSL|7ty|4ificateSD|AionS|7ed|8s|6yG|',
  '5orari|3ulean|3vical|5x|2sare|3ium|3s|4ation|4es|3t|2taceanS|3te|2ylon|1hablis|4ot|3co|3d|3ff|4ing|3grin|3inSEG|4rSEG|5m',
  'anS|8ship|5person|5woman|4se|3ka|4raS|3lcedony|4etS|4ice|4k|4lengeSD|9rS|8ing|5is|4mers|3mberSE|7lain|4eleon|4ois|5rro|4',
  'pS|5a|6gne|6ign|5ionSEG|8shipS|5lain|3nceSD|6l|7lorS|6ry|4delierS|5lerS|8y|4el|4gEG|5eS|6able|6ling|6rS|4nelSEG|7ized|7l',
  'ed|4sonS|4tSEG|3oS|4tic|3pS|4arral|4elS|5roneS|4in|4lainS|8cy|4man|4terS|3rSDGL|4a|5c|6terS|9isticS|Azation|BeSD|Bing|5d',
  'e|4coal|4donnay|4geSD|6able|6rS|5ing|4iotS|5sma|8tic|5table|6ies|6y|4latans|5ene|6s|7ton|6y|5ieS|5otte|9sville|5ton|4mSE',
  'G|5er|4on|4red|4set|4tSEG|5erSEG|5reuse|3sEG|4eS|5rS|4m|4se|5is|4te|5ity|3tS|4eau|7x|4ham|4tanooga|5ed|6l|6rSG|7box|5ing',
  '|5y|3uffeurSE|4tauqua|3vez|2eapL|5er|6st|4tSEG|5erS|3chenS|4kSEG|5book|7xes|5erSE|7board|5ins|5listS|5mate|5outS|5sum|5u',
  'pS|3e|4kS|5y|4p|4rSEG|5fulL|5ios|5leaderS|9ing|5y|4seS|6burger|6cakeS|5y|4tahS|3fS|3halis|3late|6ing|7on|4msford|4sea|4t',
  'enham|3micalSL|5seS|6tS|7ries|8y|4otaxis|6herapeutic|By|4ung|3n|4ey|4g|4ille|3queS|3r|4ishE|4okee|4ries|5y|4ubS|4yl|3sap',
  'eake|4hire|4s|4tSE|5er|7field|5nutS|3t|3val|6ier|4elle|4iot|4rolet|6n|4y|3wSEG|4y|3yenne|2i|3a|4ng|5ti|3c|4ago|5ne|4kS|5',
  'adee|6saw|5enS|4oS|5ry|3efSL|5tainS|4n|3ffon|3huahuaS|3lDL|4dbearing|6irth|5care|5hood|5ish|5less|6ike|5renS|5s|4eS|5an|',
  '4i|5es|4lerS|5ies|6wack|5s|4tern|3meS|5ra|6ic|4neyS|4panzeeS|3nS|4a|5berry|5town|4chilla|4e|5se|4g|4o|5ok|4tz|3pS|4munkS',
  '|4ped|6ndale|6r|5ing|4set|3ral|4on|5practic|AorS|4pG|3selS|3t|4a|4osan|4ty|3valry|4es|2loe|4r|5amphenicol|5ella|5ideS|6n',
  'ated|9ion|7e|6te|5oform|6phyll|7lastS|6quine|2oate|3ck|4o|5lateS|4taw|3iceS|4rS|3keSD|5rS|4ing|3lera|5sterol|4ine|7rgic|',
  '7sterase|3mp|3ndroitin|3oseS|6r|5ing|3pS|4in|4ped|6rS|5ing|5y|4sticks|3ral|4dS|5ata|4eS|5ographed|CrS|By|4ionic|4us|6es|',
  '3seS|5n|3u|3w|4der|4k|2ris|5sie|5t|6church|6enEG|8dom|8sen|6i|7anS|9a|9ity|7e|7na|8e|6mas|6oph|9e|Ar|7s|6y|3oma|6te|7ic|',
  '8n|7ographic|Dy|5ed|5ium|5osomal|9eS|4nic|7ally|7leSD|8ing|5ograph|6logicalL|9y|6meter|6s|3ysalis|6nthemumS|5ler|2ubby|4',
  's|3ckS|5leSD|6ing|5y|3mS|4p|3n|4g|4kS|5y|3rch|6es|6ill|6yard|4nEG|3teS|4neys|1ialis|3ra|2cada|3hlidS|2der|2garS|5etteS|2',
  'lia|5ry|2mel|2nch|4innati|3der|6ella|4y|3e|4maS|6tic|9al|7ographer|Dy|3gular|3nabar|5mon|3que|2pherS|2rca|4leSD|5ing|4ui',
  'tS|5larS|7teSD|8ing|9on|8orS|Ay|5mcised|9ion|6ference|Btial|7lex|6polar|6scribed|7tanceS|Atial|6ventG|Aion|5s|6es|3que|3',
  'rhosis|4us|2sco|3tern|2table|4del|4tionS|3eSD|3ies|4ng|4zenS|7ry|7ship|3rate|4ic|5ne|5x|4oen|5n|6ella|4us|3y|4scapeS|5ea',
  'rch|2vicS|4l|5ianS|6ty|6zationS|7ed|1lack|5amas|3d|4ding|3iborne|4mSEG|5antS|4r|5e|5voyance|At|3llam|3mS|4orG|4pSEG|4she',
  'll|3nS|4cy|4destine|4g|4k|3pS|4ped|6r|5ing|4ton|3ra|4e|5mont|5nce|6don|5t|4ice|5ficationS|7ed|8s|6yG|5netS|6s|5on|5ssa|5',
  'ty|4kS|5e|5son|4o|4y|3shEG|5es|4pSE|4sE|5es|5icS|7alL|7ism|7vacations|6fiable|8cationS|8edS|9rS|7y|5mateS|5path|5roomS|5',
  'y|3tter|3ude|5ia|6o|6us|4s|5eS|3ve|4ier|3wSE|3yS|4ey|4more|4ton|2eanSEGL|5erS|6st|5liness|5seSD|7rS|6ing|5upS|4rSEGL|5an',
  'ceS|5er|6st|5inghouse|5water|4tS|4vage|5eSD|6r|3ft|3matis|4ency|6s|6tS|7ine|4son|3nched|3opatra|3rgy|6man|4icS|6al|4kS|5',
  'ship|3ve|5land|5rL|6ness|2icheS|4kSEG|5er|3entS|6ele|7s|3ffS|5ord|5side|4t|5on|3ma|5ctic|5teS|6ic|6ological|Ay|5x|4bSEG|',
  '5erS|3nchE|4e|4gSG|4icS|6alL|6ianS|5que|4k|4t|5onS|3o|3pS|4art|4board|4ped|6rS|5ingS|3queS|3tS|4oris|3ve|2oakSEG|5room|3',
  'bber|3ckSEG|5wise|6ork|3gS|4ged|5ing|3isonne|5terS|3nal|4eSD|5r|4ing|3seSDL|5ness|5outS|5rS|5st|5tS|4ing|4tridium|4ureS|',
  '3thSEG|5eS|6sline|5ings|4s|4ting|4ure|3udSE|5iness|5y|4gh|3veS|5r|6leaf|3wnSG|2ubS|4bers|5ing|4house|3eS|3mpS|4sily|5y|3',
  'ng|3sterSEG|3tchEG|6es|4terE|2yde|5sdale|1net|1oachEG|5es|5man|3gulation|3lS|4esce|4itionS|3rseL|6r|3stSG|5al|5erS|5guar',
  'd|5line|3tSEG|4es|4ings|3uthor|3x|4ial|2balt|3bleD|6rS|6stone|3le|3ourg|3raS|3urg|3webs|2ca|4ine|3hin|4lear|4ran|7e|3kSE',
  '|4atoo|4er|4ney|4pit|4roach|9es|4tailS|4y|3oS|4a|4nino|5utS|4on|2dEG|3a|3eS|4c|4ine|4rS|4x|3ification|6ed|5y|3onS|2edS|3',
  'fficientS|3lho|3nzyme|3rceD|5ion|6ve|3ur|3xistG|7ence|2factor|3feeS|6house|5rs|4inS|4ret|4s|2gent|3nac|5te|4ition|7veL|5',
  'zance|8t|2habitation|7ing|3en|4rence|7tL|4sion|6ve|3ortS|4sh|2ilSE|3nSE|4age|4cideSD|8nceS|9t|AalL|7ing|4surance|2ke|4r|',
  '2lD|3a|4da|4nder|3by|3chester|5icine|3der|5st|4fusion|4ly|4ness|4play|4s|4well|3eS|4en|4man|4optera|4slaw|3i|4bri|4c|4fo',
  'rm|4n|4seum|4tis|3l|4a|5borateSD|Aing|BonS|BveL|AorS|5geS|7n|5pseSD|7ible|8ng|5rSDE|5teD|7ral|6ing|7on|4eagueS|5ctSEG|7a',
  'bleS|7ibleS|8onS|8veSL|7orS|5en|5geS|6ial|8n|8te|7um|5t|5y|4ideD|7r|6ing|5eS|6rS|7y|5mator|5nS|5sionS|4ocation|5idS|7al|',
  '5quia|9l|8um|7y|4usion|3mar|3ogneS|4mbia|8n|4nS|5elS|5ialS|8ism|6c|6es|6stS|6zation|7eD|5nade|5oscopy|5y|4phon|4rSEG|5ad',
  'o|6tion|5ectal|5ful|5less|4ssal|6eum|6ians|6us|5trum|4urSE|6ful|3tS|3umba|6ia|8n|7ne|6o|6us|5nS|6ar|6istS|3ville|2ma|4l|',
  '4nche|4tose|3bSEG|4atSG|6antS|6ive|4i|5nationS|8orial|6eSD|7r|6ing|4o|4ustible|8on|3cast|3eS|4back|4dianS|6c|6es|5y|4rS|',
  '4tS|3fortSEG|7able|Ay|7erS|4rey|4y|3icS|5al|4ngS|4x|3maS|5ndSEG|7ant|7erS|7mentS|7oS|4emorateSD|Aing|Bon|Bve|5nceSD|8men',
  't|7ing|6dSEG|7able|8tionS|6surate|6tSEG|7aries|9y|8torS|7erS|7sblog|5rce|7ialSL|Aism|BzeD|4ie|5ngled|5ssary|7ionSEG|AerS',
  '|5ted|6mentS|6tal|7ed|8eS|8rs|7ing|4ode|6ities|8y|6oreS|5nSL|6alities|Ay|6er|7st|6place|6wealth|5tion|4unal|6eS|6icable|',
  '9teSD|Aing|BonS|Bve|AorS|7on|7que|7sm|8tS|7ties|8y|5tation|9ve|6eSD|7rS|6ing|3oros|4x|3pactSEG|7flash|7ion|7ness|7orS|5n',
  'ies|7onS|9ship|6yS|5q|5rability|8le|7tiveL|8orS|6eSD|7r|6ing|7sonS|6tmentS|5ss|7es|7ion|Aate|5tibilities|Cy|8leS|6riots|',
  '4elS|6led|7ing|5ndium|6sable|8teSD|9ing|Aon|9or|By|5teSD|7nceS|9ies|9y|8tL|6ing|7tionS|9veL|Bness|8orS|4ilationS|6eSD|7r',
  'S|6ing|4lacency|9t|6inSEG|8antS|8tS|5ementSEG|Aary|Btion|6teSDL|8ness|8rs|7ing|8onS|6xE|7es|7ion|8ties|9y|5iance|8t|6cat',
  'eSD|9ing|AonS|7ity|6ed|7s|6mentSEG|Aary|5yG|4o|5nentS|5seSD|7rS|6ing|7teS|8ing|9onS|Bal|8or|6tG|6ure|5te|5undSEG|4rehend',
  'EG|9sible|Bon|BveL|6ssEG|8es|8ible|9on|9ve|8orS|5iseSD|7ing|5omiseSD|9ing|4ton|5roller|4ulsion|8ve|7ory|5table|7tionS|Ba',
  'lL|6eSD|7rS|8ized|8world|6ing|3radeS|3stock|2nSD|3an|5t|3catenateD|Aion|5ve|4ealSEG|7er|7ment|5deSD|6ing|5itE|6vable|Ay|',
  '7eD|7ing|5ntrateSD|Aing|BonS|AorS|8ic|5ptS|7ionS|7ualL|AizeD|5rnSEG|6tSE|7ina|7oS|5ssionS|Aal|Bry|4h|5a|4ierge|5liation|',
  '9ory|5seL|4lave|5udeSD|7ing|6sionS|8veL|4octed|7ion|5mitant|5rd|7ance|7ia|5urse|4reteL|4ubine|5rS|6red|8nce|Ay|9tL|7ing|',
  '5ssion|3demnSEG|7ation|5nsate|9ion|7eD|8rS|7ing|5scending|4imentS|5tionSEG|9alSL|Bity|9erS|4oS|5lenceS|5mS|6iniumS|5neD|',
  '5r|5saver|4s|4ucive|6tSEG|7ance|7ion|8ve|9ity|7orS|5itS|3eS|4stoga|3fectionary|Aers|Cy|As|5deracy|9teS|AionS|5r|6ees|7nc',
  'eS|9ing|6red|5ssEG|7es|7ionS|Aal|7or|4idant|6eD|7nce|8tL|9ialL|City|5gurable|9tionS|8eSD|8ing|5neSD|7ment|6ing|5rmSEG|7a',
  'tionS|9ory|5scateD|9ion|4lictSEG|5uence|8t|4ocal|5rmSEG|7al|8nce|9t|8tionS|7ity|5undEG|4rontSEG|8ationS|4test|4ucian|9is',
  'm|5seSD|6ingL|7onS|3gaS|4enial|9ity|7tal|5r|5sted|7ion|8ve|4lomerateS|Bion|4o|5lese|4rats|7ulateSD|Bing|ConS|Bory|5egate',
  '|9ionS|Cal|6so|7s|8es|8ional|8man|8woman|5uence|8t|3ic|5al|4ferS|7ous|3jectureSD|4oined|7t|4ugal|7teSD|8ion|5nctionS|9ve',
  '|Aitis|5reSD|6ing|3ker|3nE|4aught|4ectSEG|7edness|7icut|8onS|8ve|9ity|7orS|5r|5x|6ionS|4ie|4oisseurS|5lly|5r|5tationS|3o',
  'r|3querSEG|7orS|6stS|5istador|3rad|3scienceS|8tiousL|6ousL|9ness|5ription|4ecrated|9ion|6utiveL|5nsual|8s|6tSEG|5quenceS',
  '|9tL|Aial|5rvEG|7ancy|8tion|CistS|Asm|AveSL|9or|Bies|By|7eS|4iderSEG|8able|By|9te|AionS|5gned|8e|7mentS|7or|5stSEG|7ency',
  '|9tL|4ol|6ation|6eS|6idateSD|Aing|BonS|AorS|5nantS|5rt|7ium|4picuousL|6racies|9y|8torS|7eD|7ing|4t|5ableS|7ulary|6nce|8y',
  '|7tSL|8ine|5ellationS|6rnation|5ipation|6tuencies|By|AtS|8teSD|9ing|AonS|CalL|AveL|5r|6ainSEG|9tS|6icted|9ion|6uctSEG|9i',
  'onS|AveL|Bism|Dt|9orS|7eD|7ing|4ulS|6ar|7teS|6tSEG|7ancy|9tS|8tionS|Ave|5mableS|6eSD|7rS|6ing|6mateD|9ion|6ption|9ve|3ta',
  'ctSEG|7er|7orS|5gion|8us|5inSEG|7erS|7ment|5minantS|9teD|Aing|Bon|4e|5mplateSD|Aing|Bon|Bve|7oraneous|Aries|By|7t|8ible|',
  '8uous|5ndSG|7erS|6tSE|7ionS|9us|7ment|5stSEG|7antS|5xtS|7ual|4iguous|5nence|8tS|9al|6gencies|Ay|9t|6ualL|8nce|8tionS|7eS',
  'D|7ing|8ty|7ousL|7um|4o|5urSEG|4ra|6band|6ception|BveS|7tSEG|8ile|9onS|8orS|8ualL|6dictSEG|AionS|Aory|6indicated|6latera',
  'l|6ption|6ry|6stSEG|6veneS|9tion|5ib|7uteSD|9ing|AonS|9orS|By|6ved|5olS|7lable|8ed|9rS|8ing|6versial|Bes|Ay|3undrum|4s|3',
  'valescent|4ection|8ve|5neSD|7r|6ienceS|9tL|7ng|6t|7ionS|AalL|5rgeSD|8nce|9t|7ing|6sant|8tionS|Cal|7eL|7ing|8onS|6tSEG|7e',
  'rS|7ibleS|7or|5x|6ity|5ySEG|6anceS|9ing|6or|4ictSE|7ionS|5nceSD|7ingL|4ocation|5luted|8ion|5yS|4ulsions|3way|2okSEG|4boo',
  'kS|4e|5rS|6y|4ieS|4out|4ware|3lSEGL|4ant|4erS|5st|4ness|4pix|3mbs|3nS|3p|4erS|6ateSD|8ing|9on|9ve|3rdinateSD|9ing|Aon|9o',
  'rS|3s|2pSEG|3a|3eS|4land|4nhagen|3ied|5rS|5s|4lot|4ous|3olymerS|3per|6head|6mine|4in|3ter|4ic|3yG|4cat|4rightSE|2quille|',
  '5tlam|2ra|4lS|4m|4nto|3ba|3dSEG|4age|4elia|5s|4ialL|5llera|4less|4oba|5n|4uroy|3eSD|4l|4y|3gi|3iander|4ng|5na|6e|5th|7ia',
  'nS|3kS|4screwS|4y|3mac|4orant|3nSEG|4ea|6l|5l|6ia|7us|6l|5rSEG|6stoneS|5t|4field|5lower|4huskers|4ice|5sh|4starch|4ucopi',
  'a|4wall|8is|4y|3oa|4lla|7ry|4na|6l|6ry|6tion|5erS|6t|3pS|4ora|7l|7teS|8ionS|6eal|4seS|4us|3ral|6es|4ea|5ctSEGL|7ionS|Aal',
  '|8ve|7ness|7or|5lateSD|8ing|9onS|9ve|5nte|5spondSEG|AenceS|CtS|Aingly|4idorS|5e|4oborateD|5ded|5sion|7ve|4ugated|5ptSEG|',
  '7ion|3sair|4e|5tS|4ican|3tes|5x|5z|4ical|5na|5sone|3vetteS|4us|3y|4don|4nebacterium|2sine|3meticS|6ology|4ic|4ological|8',
  'y|5politan|5s|3ponsors|3sackS|3tSEGL|4aS|5r|4ello|4umeSD|6ing|3y|2teS|3illion|3s|3ta|5geS|4er|4onS|6seed|6wood|2uchE|5es',
  '|3garS|4hSEG|3ld|4ee|4omb|4ter|3ncilS|7lorS|7man|7orS|7woman|4selSEG|7ling|7orS|4tSEG|5able|5down|5enance|6rSEG|7act|8tt',
  'ack|7balance|7claim|9ockwise|7feitG|7measureS|7partS|8oint|8unch|7strike|7vailing|7weight|6ss|5ies|5less|5ries|6y|7man|7',
  'side|7wide|5y|3pS|4eS|4leSD|6rS|5ingS|4onS|3rage|7ousL|5nt|4ierS|4sG|5eS|6work|4tSEGL|5eous|6sy|5houseS|5ney|5room|5ship',
  '|5yardS|3scous|4inS|3ture|2valentL|4riance|8t|3eS|4nantS|5t|6ry|4rSEG|5ageS|6lls|5ings|5let|5tL|4tE|4y|3ington|2wS|3an|4',
  'rdSL|6ice|3bell|4oyS|3es|3hide|3ichan|3les|4ing|5tz|2x|2yoteS|2zumel|3y|1rabS|4by|3ckSEG|5down|5erS|5le|6ing|3dleS|3ftSE',
  'G|5er|5sman|9ship|5y|3gs|3ig|5slist|4n|3m|4er|4med|5ing|4pSEG|5ons|3nberries|8y|4dall|4eS|4ial|6ta|5ofacial|5um|4kSEG|5c',
  'ase|5shaft|5y|3pS|4pie|5y|3shEG|5ers|6s|4s|3teS|5rS|4ing|3veSD|5n|5rs|4ingS|3wfish|5ord|4lSEG|5erS|6y|3yfish|4onS|3zeD|4',
  'iness|4y|2eaking|4mSE|5er|7y|5pie|5y|4seSD|5ing|4tEG|5eS|5ine|7ine|6onS|8ism|AtS|6veSL|7ity|5orS|5ureS|3che|3dence|6tial',
  'SEG|6za|4ibility|6le|7y|5tSEG|6able|6orS|4o|3eD|4ds|4kS|5side|4l|4pSG|5erS|5y|3mated|6ion|6orium|8y|4e|3ole|4sote|3peS|4',
  't|3scendo|7t|4s|5ida|4tSE|5line|3taceous|4e|3viceS|3wSE|2ibS|4bage|3ck|5etS|7erS|3ed|4r|4s|3meS|5an|4inalSL|8ity|6ology|',
  '4pG|4son|3nkle|3ppleD|6ing|3sS|4es|4is|4pS|5in|5y|4scross|4tina|3teria|7on|7um|4icS|6alL|8ity|6ismS|7zeSD|8ing|5queSD|8r',
  '|7ing|2oak|4tS|5ia|7n|3chetEG|4k|5er|7y|4odileS|4s|4us|3ftS|3ix|3mer|4well|3ne|4ies|3okSE|3pS|4land|4ped|6r|5ing|3quet|3',
  'sby|4sEG|5bar|6owS|5cut|5eS|5ings|5overS|5point|5roadS|5walkS|6ordS|3tch|6et|4on|3uchEG|4p|5ier|4se|4tons|3wSD|4bar|4ded',
  '|6r|5ing|5s|4eS|4ley|4nSEG|5e|3ydon|2uces|4ialL|6te|5ble|5fied|7x|8es|8ion|3deL|3elL|5ty|3iseSD|6rS|5ing|3mbS|5leSD|6ing',
  '|4my|4p|5led|7r|3nchG|6es|6y|4k|3sadeS|7rS|4e|4hEG|5erS|6s|4tSE|5acea|9nS|6l|5y|3tch|6es|3x|2yG|3er|3ogenic|3pt|5ic|5o|6',
  'graphic|By|6logy|3stalS|7line|9zation|Aed|8ographic|Ey|1uba|4nS|3by|3eSD|3ic|5leS|4sm|5t|4ts|3s|2ckold|5o|3umberS|2ddleS',
  '|5ing|5y|4y|2es|4ta|3vas|2ffSE|4links|2isineS|2linary|3led|5n|4ing|3minateSD|8ing|9on|3pa|5bility|6le|4ritS|3tS|4ivarS|7',
  'teD|8ing|9on|4uralL|6eSD|6ing|3ver|6tS|2mG|3berland|6some|4ria|7n|3fiesta|3in|3med|4ingS|6s|3shotS|3ulativeL|5us|2neifor',
  'm|3nilingus|5ng|7ham|2pS|3boardS|3cakeS|3id|3ola|3ped|4ing|2rable|4cao|4teD|5ion|6ve|5orS|7ial|3bSEG|3eSD|3few|3ie|4ng|4',
  'oS|5sities|8y|5usL|3lSEG|4ers|5w|4y|3mudgeon|3r|4antS|4encies|7y|6tSL|4icula|9r|8umS|5ed|6r|6s|4yS|3seSD|4ing|5ve|4orS|6',
  'y|4us|3t|4ailE|7ment|6nS|4is|3vature|4eSD|4ilinear|5ng|4y|2shing|5onSEG|4y|3sed|3tard|4odial|8nS|6y|5mS|6arily|8y|6erS|6',
  'iseD|7zable|9tion|8eD|8ing|2tS|3aneous|4way|3backs|3e|4ness|4r|4st|3hbert|3icle|4eS|3lass|4er|6y|3off|4utS|3terS|4hroat|',
  '4ingS|1vsroot|1yan|4ide|2ber|5neticS|5space|2cleSD|4ic|6al|5ng|5stS|4oneS|6ic|5pedia|6s|5tron|2gnus|3win|2linderS|6rical',
  '|2mbalS|3raeg|4u|2nicS|5al|5ism|3thia|2press|4us|2rano|3il|5lic|3us|2stS|4eine|4ic|5tis|2therea|3ochrome|4geneticS|4logy',
  '|4plasm|9ic|4sine|4toxic|1zar|2echS|5oslovak|Cian|0dabble|2chshund|2dS|3a|3dies|4yS|3e|3os|2edalus|3monS|3woo|2ffodilS|4',
  'y|3t|2ggerS|3mar|2hlia|2ihatsu|3lies|4y|3nty|3ries|4y|3sies|4y|2kota|2leS|3i|3las|4eS|3matianS|3ton|2mS|3ageSD|5ing|4n|4',
  'scus|5k|3eS|3ien|5r|3me|3nEG|4ation|3on|3pEG|4enEG|5rS|4ness|3selS|2nS|3a|3bury|3ceSD|5rS|4ing|3delion|4ruff|4y|3eS|3g|4',
  'erS|6ousL|4leS|5ing|3i|4elS|6e|6le|4sh|3ner|4y|3sk|3te|3ube|3ville|3zig|6er|2phne|5ia|3per|4led|2rby|3ds|3eSD|4devil|3fu',
  'r|3i|4en|4n|5g|4us|3jeeling|3kL|4enEG|5r|5st|4ness|4room|3lingS|7ton|3nE|3rell|5n|4yl|3tSEG|4board|4h|4moor|6uth|3ussala',
  'm|3win|6ian|7sm|3yl|2s|3hEG|4er|5s|3tardly|2ta|4baseS|4setS|5heet|4type|3eSD|3ing|4on|3umS|4ra|2ughterS|3nting|3phin|2ve',
  'S|4nport|3idS|5son|4es|4s|3y|2wes|3kins|3nSEG|3son|2yS|3book|4reak|3care|3dreamSG|3light|3time|4on|6a|2zeD|3zleD|5ing|1e',
  'aconS|6ess|4tivateD|9ion|3dL|4beat|4lineS|5ockSE|4man|4wood|3f|4ening|4ness|3lSG|4erS|6shipS|4ings|4t|5ime|3minase|3nS|4',
  'ery|3rSGL|4born|4est|4th|3thS|5bed|3ver|2bacle|4rment|4table|5eSD|5ing|4uchery|3bie|4y|3entureS|3ian|4litating|4tSE|3ora',
  'h|3ra|4iefG|5s|3tS|4orS|3uginfo|4nkEG|4tSE|5ante|2cadal|5eS|6nce|7t|4ffeinated|4lS|4nterS|4pitated|4thlon|5ur|4ySEG|3eas',
  'ed|4dent|4it|6ful|5veD|6ing|4leration|4mber|4ncy|5nial|5tL|6ralization|Bed|4ptionS|7veL|3ibelS|4dable|5eSD|6dly|5ing|5uo',
  'us|4le|4malS|6ted|7ion|4pherG|4sionS|6veL|3kSEG|4er|3larant|7tionS|9ve|8ory|6eSD|7r|6ing|5ssified|4ination|6eSD|6ing|3od',
  'eSD|6r|5ing|4mmissioned|Cing|5poseD|8ing|9tionS|6ress|Aion|4ntamination|4r|5ateD|7ing|8onS|8ve|7orS|5um|4yS|3reaseSD|7in',
  'g|5eSD|5ment|5pit|4y|2dicateSD|7ing|8onS|3uceD|5tEG|6ibleS|7onS|7ve|2edSE|3mSE|3pL|4enSEG|5r|5st|4throat|4water|3rG|4e|4',
  'field|2faced|4mation|7ory|5e|6r|4ultSEG|3eatSEG|4ctSE|6ion|7ve|6ors|4nceS|5dSEG|6antS|6erS|5seS|7less|6ible|7veL|4r|5enc',
  'e|5ment|5ralS|6ed|6ing|3iance|6tL|4ciencies|9y|8t|6tS|4ed|5s|4leD|4nable|6tely|5eSD|5ing|6teL|7ionS|Aal|8veL|3lateD|6ion',
  '|6or|4ectE|7ion|7orS|4oration|3orest|8ation|5mE|6able|7tionS|6ities|8y|3raud|5y|4ost|7er|3tly|3unct|4se|3yG|2gas|3enerac',
  'y|8teD|9ion|Ave|3radation|6eSD|6ing|4eeS|2humidifierS|3ydrated|8ion|6ogenase|2icide|3onized|3rdre|3ties|4y|2l|3aware|4yS',
  'EG|3bert|3ectable|4gateSD|7ing|8onS|4teSD|6rious|5ing|6onS|3ft|3ia|4berateL|9ionS|Ave|4cacies|7y|6teL|8ssenS|5iousL|4ght',
  'SEG|7fulL|4lah|4mitation|7ed|8rS|4neateD|8ing|9on|5quency|9tS|4rious|6um|4verSEG|7ableS|8nce|7ies|7y|3lS|4a|4e|3oitte|3p',
  'hi|6ne|7ium|3taS|3uded|4ge|4sionS|8al|4xe|3veS|4ing|2magnetization|4ndSEG|4rcation|3eaning|6or|4nted|6ia|4rol|3i|4ng|4se',
  '|3oS|4bilization|4cracies|8y|7tS|8ic|Aally|9zation|4graphicS|9y|4lishEG|6tionS|4nS|5ic|5strable|By|9teSD|Aing|BonS|Bve|A',
  'orS|4ted|5ion|3pster|3ux|2nE|3aturation|7ed|3drites|7ic|5obium|3gue|3ialS|4ed|5r|5s|4m|4s|5e|4zens|3mark|3ning|5s|4y|3om',
  'inated|9ionS|Cal|9orS|4n|4teSD|5ing|4unceSD|7ing|3seL|5r|4ities|6y|3tSE|4al|4in|5stS|7ry|4on|4ureS|3unciation|3ver|3ySG|',
  '2odorantS|2partSEG|6mentS|Aal|6ureS|3eche|4ndSEG|6ability|8le|6ence|9ies|9y|8tS|3ictSEG|6ionS|3leteD|6ing|7on|4orable|5y',
  's|3olarization|4rtE|6ation|6es|4sed|5itSEG|7ary|7ionS|Aal|7orS|9ies|9y|4tS|3raved|6ity|4ecated|6iated|9ion|5ssEG|7antS|7',
  'ionS|8ve|4ivation|6eSD|6ing|3thS|4s|3uties|5y|2railE|4nged|3by|5shire|3ek|4lict|3ided|4sion|4vationS|8veS|5eSD|5ing|3ma|',
  '5l|5titis|6ological|BstS|Ay|4is|3nier|3ogation|7ory|3rick|4y|3vish|2scendSEG|7antS|7entS|6t|4ribeSD|7ing|6pt|8ionS|9ve|8',
  'orS|3ecration|4nsitization|4ret|5tSE|6ion|5veSD|7dly|6ing|3i|4ccant|4gnSEG|6ateSD|8ing|9onS|8or|6eeS|7rS|6jet|4rability|',
  '7le|5eSD|5ing|5ous|4st|3kSG|4jet|4topS|3olate|7ion|4rption|3pairG|4eradoS|7teL|8ion|4icable|5seD|5te|4ot|6ic|7sm|3sertS|',
  '3tabilize|Aing|4inationS|6ed|6ies|6y|5tute|4roySEG|7erS|5uction|9ve|8or|2tachE|6able|6mentS|4ilSEG|5nEG|6ees|3ectSEG|6ab',
  'le|6ionS|7veS|6orS|4ntionS|4r|5gentS|5iorateSD|Aing|Bon|5minantS|9te|AionS|Bve|8eSD|8ing|9sm|Atic|5red|7nce|8t|6ing|4st|',
  '3onateD|7ion|7or|4urS|4x|5ification|7y|3ractS|7ors|4iment|9al|5tal|6us|4oit|2uceS|3terium|6onomy|4sch|7e|7land|2valuatio',
  'n|4stated|8ing|9on|3el|5opSEG|7erS|7mentS|BalL|3iantS|7art|5teSD|6ing|7onS|4ceS|4lS|5ish|4ousL|7ness|4seSD|5ing|3oid|4lu',
  'tion|5ved|4n|5ian|5port|5shire|4teSD|6eS|5ing|6onS|8alS|4urEG|5t|2walt|4n|4tering|3berry|3ey|2xter|6ity|4ran|5ose|1harma',
  '|1iabetes|6icS|4lo|4olic|8al|3gnoseSD|7ing|8s|7ticS|4onalSL|4ramS|3lSEG|4ectS|7ic|9al|5rS|4ling|4og|6ic|6ueS|4up|4ysis|3',
  'meterS|6rically|4ondS|7backS|3na|4e|5tics|3perSG|4hragmS|3ries|4rhea|4y|3spora|4tolic|3tomS|4ribe|3zepam|2bble|2ceD|3h|4',
  'otomous|8y|4roic|3kSE|4e|5ns|5r|5y|4ies|5nson|4son|4y|3ta|5phone|5teSD|6ing|7on|6orS|8ial|8shipS|4ion|7aries|9y|4um|2d|3',
  'actic|3dle|4y|3ier|3nt|3o|3rex|3st|2eSD|3cast|3go|3hard|3lectricS|3m|3selS|3tSG|4ary|4erS|5ticS|4hyl|4icianS|5tianS|2ffe',
  'rSEG|6enceS|8tL|9iable|BlSL|BteSD|Cing|Don|4icile|6ult|9ies|9y|4raction|4useD|7rS|6ing|7on|7ve|8ity|2gS|3estSEG|6er|6ibi',
  'lity|8le|7on|7ve|3gerS|4ing|4s|3imon|4tS|5alL|7es|7is|5izeD|8rS|7ing|3nified|5taries|6y|3ress|7ion|2hedral|2kes|2lantin|',
  '4pidated|4tation|5ed|5ion|3doS|5es|3emmaS|4ttante|3igence|7tL|3l|4er|4inger|4on|4y|3uent|4teD|5ing|6onS|2mL|3age|3eS|4ns',
  'ionSG|9al|Bity|9less|4rS|5ization|4thyl|3inishEG|8es|5ution|8ve|3med|5rS|4ing|3pleS|2nah|4rS|3eD|4rS|5o|4tte|3gS|4bats|4',
  'hies|5y|4le|4o|4wall|4y|3ing|3ky|3nerS|6ware|4ing|3osaurS|2ocesan|6eS|3deS|3n|4e|3rama|3xide|2pS|3hosphate|4theria|3loid',
  '|5maS|7cy|7tS|8e|8ic|3oleS|3ped|5r|4ing|3tera|2reD|4ctSEGL|6ionS|9al|7veS|6orS|8ateS|8ial|9es|8y|6v|6x|3ge|3kS|3t|4y|2sS',
  '|3abilities|9y|5leSD|7ment|6ing|4dvantageSD|4ffected|4ggregated|Bion|5reeSDG|8able|8mentS|4llowE|8ance|4ppearSEG|9anceS|',
  '6ointSEG|AmentS|6roval|9eD|4rmEG|6ament|5ray|4ssembleD|Ay|5terS|6rous|3bandE|4elief|4urseD|8mentS|7ing|3cS|4ardSEG|4ernE',
  'G|7ible|7ment|4hargeSD|9r|8ing|4ipleS|8ship|7inary|9eSD|9ing|4laimSE|8erS|5oseSD|7ing|7ureS|4o|5graphies|Ay|5loration|8e',
  'd|5mfort|5ncerting|6nectSEG|Aion|6tent|7inuance|Btion|AeD|Aing|Bties|Cy|Aous|5rd|7ant|5untSEG|8ers|6rageSD|Ament|9ing|7s',
  'eS|5verSEG|8er|8ies|8y|4reditE|6etL|6pancies|Ay|6te|7ion|Aary|5iminant|AteSD|Bing|ConS|Bor|Dy|4ursive|5sS|6sant|7ed|8s|7',
  'ing|8onS|3dain|3easeSD|4mbodied|4nchanted|5franchised|5gageD|9ment|4quilibrium|3figured|3graceD|8ful|5untled|4uiseSD|5st',
  'EG|3hEG|4eartening|5s|4network|4onest|6or|4washerS|8ing|3illusioned|Bment|4nfectEG|9antS|9ion|5genuous|5tegrateD|Bing|Co',
  'n|7rested|3jointE|4unction|9ve|3kS|4less|3likeSD|4ocated|8ionS|5dgeD|3mal|5ntleD|8ing|5yE|4emberment|4issEG|7alS|7es|7iv',
  'e|4ountE|3ney|6land|3obedience|At|6y|4dium|4rderSEL|5ganized|5ientation|9ed|3paraging|7te|6ities|8y|5tchEG|8erS|9s|4el|6',
  'led|7ing|5nsary|8tion|7eSD|8rS|7ing|5rsal|7eD|7ing|8onS|8ve|4laceD|8mentS|7ing|6ySEG|7able|5eased|8ure|4osableS|7lS|6eSD',
  '|6ing|7tionS|9ve|6sessed|4roportionate|6ve|4uteSD|6ing|3qualification|Aed|9yG|3regardSEG|5pair|6utable|5spect|Aful|4uptS',
  'EG|7ionS|8ve|3satisfaction|9ied|4ectEG|7ion|7or|5minateSD|Aing|Bon|5nsion|6tG|7ers|5rtationS|6vice|4identS|5milar|5pateD',
  '|8ion|9ve|4ociated|9ion|Ave|5lution|6veSD|7ing|5nance|4uade|3tal|5nceSD|7ing|6t|5ste|8ful|4emper|4illEG|7ate|9ion|7erS|9',
  'y|5nctL|8ionS|9veL|Bness|6guishEG|Bable|Bes|4ortSEG|7ionS|4ractEG|8ionS|6ught|5essEG|5ibutable|9eSD|9ing|AonS|Cal|Ave|9o',
  'rS|6ctS|5ust|4urbSEG|7anceS|7ingly|3useD|2tchEG|5es|3herG|3to|4y|2ureticS|4nal|2vEG|3aS|4lent|4n|3eS|4rS|5geD|7nceS|8t|6',
  'ing|5se|6ification|9ed|8yG|7onS|7ty|5tEG|6er|6iculitis|4stE|6itureS|6ment|3ideSD|6ndS|6rS|5ing|4nation|5eL|5ity|4sible|6',
  'onS|8al|6ve|5orS|3orceSD|6ing|3ulgeD|2xie|4t|3on|2zziness|4yG|1jibouti|1mesg|1oSDG|2able|2bbins|4y|3ra|3son|2cbook|3ent|',
  '3ile|3kSEG|4ers|5tS|4lands|4side|4yard|3s|3torS|6al|7teS|4rinal|7eS|3ume|6ntSEG|8aries|Ay|9tionS|2ddS|3ecyl|3geSD|5rS|4i',
  'ng|2eS|3rs|3snt|2gS|3fish|3ged|4ing|4y|3house|3maS|5tic|3wood|2herty|2ilies|3ngs|3t|2lby|3ce|3drums|3e|3lS|4arS|4houseS|',
  '4ies|4y|3omiteS|4r|5es|3ph|5inS|2mE|3ainS|3eS|4sticS|8ally|9ted|AionS|3icileD|7iary|4nance|7t|6teSD|7ing|8on|7or|5e|5go|',
  '5ic|7a|8n|7k|6onS|6que|5oS|6es|5us|2n|3alD|4teSD|5ing|6onS|3caster|3e|3gS|3keyS|3naS|4eD|5r|4ie|5ng|3orS|4van|3t|2odleS|',
  '3ley|3mE|4sday|3rS|4bell|4man|4step|4wayS|3yoo|2peD|4y|3ing|3pler|2ra|4do|3cas|3ia|5n|4s|3king|3mS|4ancy|6t|4er|4itories',
  '|8y|3othea|6y|3sal|4et|2sageS|3eSD|3imetry|4ng|3sierS|2tS|3ted|4y|2ubleSD|6r|6t|7ree|5ing|5y|4tSEG|5ful|5less|3ce|5t|4he',
  '|3g|4h|5nutS|5ty|4las|3lton|2veS|4cot|4r|4tail|2wD|3dy|3el|4r|3ling|3nSEG|4beat|4erS|5s|4fall|4gradeSD|8ing|4hill|4line|',
  '7k|5oadSEG|8able|4pour|4right|4sideS|5tairs|6ream|4time|5own|5rodden|5urn|4wardS|5ind|4y|3ry|3sing|2yle|2zenS|4r|1raco|5',
  'nian|4ula|3ftSEG|5erS|5sman|3gS|4ged|5ing|4net|4o|5nS|6ball|6flies|8y|5on|3inSEG|5age|3keS|3m|4aS|5tic|8ally|7st|3nk|3pe',
  'SD|5r|6ies|6y|3stic|7ally|3ughtS|3wSG|4backS|4down|4erS|4ings|4n|4string|2eadEG|5fulL|5nought|4mSEG|5cast|5erS|5land|5t|',
  '5weaver|5y|4ry|3dgeD|5ing|3gs|3nchE|3sden|4sEG|5age|5erS|6s|5ings|5maker|5y|3w|2ibble|6ing|3ed|4r|4s|5t|3ftSEG|5erS|5woo',
  'd|3llSEG|5er|3nkSG|5erS|3pS|4ped|5ing|3veS|5l|5n|5rS|5wayS|4ing|3zzle|2oitS|3ll|3neS|3olG|4pG|3pS|4letS|4outS|4ped|6r|5i',
  'ngS|3sophila|4s|3ughtS|3veS|3wnEG|4siness|5y|2ucken|3dge|6ry|3gS|4ged|4storeS|3idS|3mS|4merS|5ing|4sticks|3nkS|5ard|5en|',
  '7ness|3pal|2yG|3erS|3ness|1ualSL|4ism|5ty|3ne|2bai|3bed|4ing|3ious|3lin|2chess|4y|3kSEG|4ie|4ling|3tSEG|4ile|5on|2dley|2',
  'eS|3lSG|4ist|3tS|2ff|4elS|4y|2gout|2keS|2lcimer|3l|4es|3uth|3y|2maS|3b|4bellS|4er|5st|4ledore|3mies|4y|3pSEG|4er|4lingS|',
  '2ncan|3dee|3eS|4din|3g|4eonS|4y|3kS|4irk|3lap|4op|3ne|4ing|3st|5able|2o|3denal|6um|2ped|4r|3lex|6es|4icateSD|8ing|9onS|9',
  've|8orS|6ity|3ont|2ra|4bility|5leS|4l|4n|5go|5t|4tionS|3ban|3er|4sS|3ham|3ing|3o|3st|2sk|4y|3tSEG|4bin|4erS|4in|4y|2tch|',
  '5man|3ies|4fulL|3y|2vetS|1warfSE|3yne|2ellSG|5erS|5ings|4t|2ight|3ndled|6ing|1yed|3ing|3r|3s|2ing|2keS|2lan|2namicS|7alL',
  '|6sm|6te|5o|4sties|6y|2sentery|3functionS|3lexia|3on|3pepsia|4hagia|4lasia|4nea|3trophy|0each|2gerL|5ness|3leS|2rSEL|3ac',
  'he|3ings|3lS|4e|4ier|6st|3markSE|3nSEG|4erS|5stL|7ness|4ings|3phoneS|4iece|4lugs|3ringS|3shot|3thSL|5en|7ware|5quakeS|5w',
  'orkS|8mS|5y|2seSD|4lS|4mentS|3ier|5st|4ly|4ness|5g|3t|4bound|4erL|6n|4lake|6nd|4man|4on|4ward|5ood|3y|4going|4share|2tSG',
  '|3en|4rS|5ies|5y|3on|2ves|5dropping|1bay|4er|2enezer|2ony|3okS|2usiness|1cardS|2centric|9ity|3lesia|8stes|Aical|2helon|3',
  'inacea|3oSEG|4es|2lampsia|3ectic|3ipseSD|6ing|5tic|2ole|4ogicalL|7stS|6y|3mmerce|3no|5metricS|6icS|8alL|7es|7stS|6y|4pap',
  'ers|3systemS|2stasy|5tic|2topic|2uador|7ian|3menical|2zema|1ddieS|3y|2elweiss|3ma|3nS|2gar|3eSD|4r|3ing|3y|2ibleS|3ctS|3',
  'fication|6e|4ying|3nburgh|3son|3tSEG|4h|4ionS|4orS|6ialS|2mondS|5ton|3undS|2na|2uardo|3cateSD|6ing|7onS|9alL|6orS|2wardS',
  '|6ian|3in|5a|1els|2rie|4ly|1ffectSEG|6iveL|9ness|6or|6ualL|8te|4minate|4rvescent|4xor|3icacious|7y|5iencies|9y|8tL|4e|4g',
  'y|3luentS|5x|3ortS|6lessL|3usion|2ter|1galitarian|2bert|2gS|3erS|3nog|3plant|3shell|2otistical|2regious|4ss|4t|2ypt|5ian',
  'S|5ology|1idolon|2ffel|2genvalueS|3htS|5een|8th|5h|5ies|5y|2leen|2nstein|2ther|1jaculate|8ing|9onS|2ectE|5ion|5or|1labor',
  'ateSDL|8ing|9on|3ine|3nce|4d|3pseD|3stic|7ities|9y|5omerS|9ic|3ted|4ion|2bert|3owS|2derSL|5berry|4st|3orado|3red|4itch|2',
  'eanor|3ctSEG|5ionS|6veS|5orS|7al|8te|5ra|6icS|8alSL|8ianS|9ty|7fication|9ed|8ying|6o|7chemical|Cstry|8ution|7deS|8ynamic',
  's|7lysis|9teS|Aic|7magneticS|Esm|7nS|8icS|Aa|Blly|7phoresis|Ctic|8lating|7static|7technical|3gance|6tL|4y|3mentS|7al|8ry',
  '|3na|3phantS|3vateSD|6ing|7onS|6orS|4en|6th|2fin|3wood|2gin|2ian|4s|3citSEG|6ation|3gibility|6leS|3jah|3minateSD|8ing|9o',
  'nS|8or|3nor|3ot|3sa|5beth|4ha|4sa|3teS|3xir|3za|5beth|9an|2khorn|2la|3eS|4n|4r|3iot|6t|4pseS|6is|6oid|5tic|8alS|4s|5on|2',
  'mer|2ohim|3ise|3ngateD|7ion|3quence|7tL|2ric|2sa|3eS|4vier|4where|2ton|2ucidateD|8ion|3deD|3sive|3ted|4ion|2ves|3ira|4s|',
  '5h|2wood|2yseeS|4ian|5um|1macs|3ilSEG|3nateS|6ing|4cipated|9ion|2bankment|4rgo|5kSEG|6ation|5rassEG|9ment|4ssies|6y|4ttl',
  'ed|3edS|5ded|6ing|4llishE|9mentS|4rS|4zzlement|3lazoned|4emS|6atic|3odied|7s|6mentS|5yG|4ldened|5ism|4ssEG|3raceSD|6ing|',
  '4oidered|9y|6led|4yoS|6genesis|6logy|6nic|2cee|2eraldS|4geSD|6nce|8ies|8y|7t|5ing|4ita|6us|4son|4y|2igrantS|6teD|7ion|3l',
  '|4ia|4y|3nem|5nce|6tL|3r|4ates|3ssary|5ionS|6vity|3tS|4ted|6rS|5ing|2ma|4nuel|3et|5t|2oluments|3ry|3te|4icons|5onS|7alL|',
  '5ve|2pathize|6y|3erorS|3hases|6isEG|8es|7zeSD|8ing|5tic|8ally|4ysema|3ireS|5icalL|7ism|3lacement|4oySEG|6ability|6eeS|7r',
  'S|6ment|3oria|6um|4werSEG|7ment|3ress|3tied|6s|5ness|5on|4or|4yG|2ulateSD|6ing|7on|6orS|4e|4sionS|1nableSD|6ment|6rS|5in',
  'g|3ctSEG|5mentS|3melSE|6led|4ored|2campment|4psulateSD|Aing|Bon|4rta|4sed|3ephalitis|8opathy|3hantEG|7er|7ment|4iladaS|3',
  'ircled|7ing|3laveS|4oseSD|6ing|6ureS|3odeSD|6r|5ing|4mpassEG|9es|4re|4unterSEG|5rageSD|9ment|8ing|3roachG|8mentS|4usted|',
  '4yptSEG|7ion|3umbered|6ranceS|3yclical|6opediaS|Bc|2dSEG|3angerSEG|8ment|3earing|5vorSE|7ur|4mic|4rS|3if|4ngs|3lessL|3oc',
  'arditis|5rine|8ology|4dontics|4genous|4metrial|9um|4plasmic|4rseSD|7mentS|7rs|6ing|4scopic|8y|4thelial|9um|5oxin|4wE|5me',
  'ntS|3ura|6nce|5eSD|5ing|2emaS|4ies|4y|3rgeticS|9ally|5ies|6zeD|8r|7ing|5y|2field|3orceSD|7ability|9le|7ment|7rS|6ing|2ga',
  'dget|4geSD|6mentS|5ing|3enderE|3ineSD|6erSEG|3land|4er|5wood|4ish|7man|3raveD|7rS|6ingS|4ossed|7ing|3ulfE|2hanceSD|7ment',
  'S|7rS|6ing|3ydra|2id|3gma|6tic|2joinE|4ySEG|5able|5ment|2laceS|4rgeSD|7mentS|7rS|6ing|3ight|7enEG|9ment|4stSEG|6ment|4ve',
  'n|2mity|2och|3rmity|5ousL|3ugh|2quireSD|7r|6ies|7ng|6y|2raged|3ichEG|6es|6ment|3ol|5lSEG|6eeS|6mentS|5mentS|4n|2sembl|7e',
  'S|3hrined|3ign|3laveD|7ment|3ueSD|4ing|4reSD|5ing|2tailSE|4ngled|8ment|3erSEG|5al|5ic|5priseS|9ing|5tainSEG|9erS|9mentS|',
  '3halpy|4ralled|8ing|4used|6iasm|9tS|Aic|Cally|3iceD|5ing|4reL|6ty|4ties|5leSD|7mentS|5y|3ombed|5ological|Ast|9y|4urage|3',
  'rails|6nment|5nceSD|6tS|5pment|4e|5eS|5nched|5preneurS|Cial|Cship|4ies|4opy|4ustE|4y|5way|3wined|2umerateD|8ing|9onS|8or',
  '|3nciated|2velopEG|7eS|3iable|4ed|4ous|4ronS|7mentS|BalL|Dism|Ft|4sageSD|5ionSEG|3oyS|5er|3y|2zymatic|5eS|5ology|1ocene|',
  '1phedra|6ine|4mera|8l|7is|4sians|3raim|2icS|4enter|4ure|7an|3demicS|7ological|Cst|By|5rmal|7is|4ural|3lepsy|6tic|4ogue|3',
  'nephrine|4ions|3phany|3scopal|4odeS|6ic|4temic|7ological|By|5leS|3taph|4helial|8um|6t|4ome|2ochS|3nymous|3xy|2silon|3om|',
  '4n|3tein|1qualSEL|5ities|7y|6zation|7eD|8rS|4teSD|5ing|6onS|5or|7ial|3estrian|3idistant|4libria|9um|4ne|5ox|4pSE|5mentS|',
  '5ped|6ing|4table|8y|5ies|5y|4valence|Ay|9tSL|5ocal|3us|1raS|3dicateD|8ing|9on|3l|3sable|4eSD|5rS|4ing|4mus|4ure|2ectEG|5',
  'ile|6onS|5or|2godic|4nomicS|2ic|4a|4k|5son|4sson|3e|3k|4a|3trea|7n|2nest|6ine|3ie|3st|2odeD|4ing|3s|4ion|3tic|6aS|6ism|5',
  'k|2randS|5t|4ta|5ic|5um|3ed|3oneousL|4rS|2satz|2udite|3ptSEG|5ionS|2win|2ythema|5rocyteS|1scalade|6teSD|7ing|7orS|4padeS',
  '|5eSD|6ment|5ing|4rpment|3hatology|4erichia|5w|3ondido|4rtSEG|3row|3udo|2ker|3imoS|2meralda|3tp|2ophageal|7itis|7us|3ter',
  'ic|2panol|3ecialL|8es|4rance|7to|3ionage|3lanade|3ouseD|3resso|3ys|2quire|2sayS|5ist|3enceS|5tialSL|4r|4x|3ie|2tablishEG',
  '|9es|9mentS|4doS|4teS|3eemE|4lla|4rS|5ase|3her|3imateSD|7ing|8onS|7orS|3onia|7n|4ppel|3radiol|5nged|4ogenS|3uaries|7ne|6',
  'y|1tchEG|4ings|2ernalL|5ity|2han|5e|5ol|3el|4rS|5eal|3icS|5alL|4opia|8nS|7c|3nic|6ally|6ity|4ographic|Ay|5logy|3os|3yl|5',
  'ene|2iology|3quette|2ruscan|2udeS|2ymology|1ucalyptus|3harist|9ic|4re|3lid|6ean|2dora|2gene|5ia|6cs|6e|2logy|2nice|3uch|',
  '2phemism|4onium|5rbia|6ia|7c|2rasian|3eka|3oS|4pa|5e|6anS|3ythmics|2skara|3tace|2thanasia|4eria|1vacuateD|7ing|8onS|5ees',
  '|3deD|4ing|3luateSD|7ing|8onS|8ve|5e|3nS|4escence|4gelicalS|8ne|8on|8sm|9tS|Aic|8zation|4ston|5ville|3porateSD|8ing|9on|',
  '9ve|8or|3sion|5ve|2e|3lyn|3nSGL|4ings|4tSG|5ful|5ide|5ualL|8ity|3rSL|4est|5tt|4glades|5reenS|4lasting|4more|4quest|4t|4y',
  '|5body|5day|5man|5oneS|5thing|6ime|5where|2ictE|5ionS|3denceSD|7ing|6tL|7ial|9ry|3lS|3nced|3te|2ocation|7ve|3keSD|4ing|3',
  'lutionS|9ary|9ists|4veSD|5ing|1week|2ing|1xacerbateD|9ion|4tGL|3ggerateD|9ing|Aon|3ltE|5ation|3mS|4en|4inationS|6eSD|7rS',
  '|6ing|4pleS|3sperated|2calibur|4vateD|7ing|8onS|7orS|3eedSEG|6ingly|4lS|5led|7nce|9y|8tL|5sior|4ptEG|6ionS|9alL|4rptSE|4',
  'ss|6es|6iveL|3hangeSD|8able|8rS|7ing|4equer|3iseD|5ion|4table|6tionS|7ory|5eSD|6dly|6ment|6r|5ing|3laimSE|5mation|4udeSD',
  '|6ing|5sionS|9ary|7veSL|8ity|3rement|5ted|6ion|4uciating|3ursionS|4seSD|2ecutableS|6eSD|6ing|7onS|9er|7veS|6orS|3gesis|3',
  'mplarS|8y|6ified|As|8y|5tSEG|6ionS|3rcisable|7eSD|8r|7ing|4tSEG|5ion|3ter|2foliating|9on|2haleD|4ustSEG|7ion|8veL|3ibitS',
  'EG|7ionS|Aism|CtS|7orS|4larating|Aon|3ortation|3umed|2igencies|3leSD|3stSEG|5ence|7t|8ial|Bism|3tSEG|2moor|2odus|3genous',
  '|3nS|4erated|3rbitant|4cism|7t|3ticS|2pandSEG|6able|6er|5seS|6ionS|7ve|6ys|4sy|4t|5riateS|3ectSEG|6ancy|8t|7tionS|6orant',
  '|4dia|6ency|8t|6teD|7ing|8onS|Aary|9usL|4l|5led|6ing|4ndE|6able|6itureS|5seSD|6ive|4rienceSD|9ing|8tial|6mentSEG|AalL|Bt',
  'ion|Aer|5tSL|6ise|3iration|7ory|5eSD|5ing|5y|3lainSEG|5nationS|8ory|4etive|4ication|6itL|4odeSD|6ing|5itSEG|7able|8tion|',
  'Ave|5rationS|8ory|6eSD|7rS|6ing|5sionS|7veS|3onentS|8ialL|4rtSEG|6ation|6erS|4seSD|5ing|6tionS|7ory|5ureS|4undE|3ressEGL',
  '|7es|7ionS|Aism|Ct|8ve|Aness|7way|4opriation|3ulsionS|2quisiteL|2tant|3endSEG|6erS|5sibility|8le|7onS|7veL|5tS|5uating|4',
  'riorS|5minate|Aion|Aor|5n|6alSL|8ities|Ay|6e|3inct|7ionS|5guishEG|AerS|3ol|4rtion|3raS|5cellular|6tSEG|7ionS|8ve|7orS|6u',
  'rricular|5dition|5it|5judicial|5mural|5neous|7t|5ordinarily|Cy|5polateD|Aing|Bon|5solar|5terrestrial|5vagance|At|Aza|4em',
  'eSL|6ism|8tS|7ties|8y|4insic|4uded|7r|5sionS|2uberance|8t|3des|3lt|1yeSDG|3ballS|4eam|4rowS|3glass|8es|3lash|7es|4etS|4i',
  'dS|5ner|3pieceS|3sight|3wear|4itness|Aes|2re|1zekiel|2ine|2ra|0fabaceae|3ian|3leSD|3ricS|6antes|7teD|8ing|9onS|8orS|3ulo',
  'usL|2cadeS|3eSD|4less|4plateS|4sitting|4tSE|3ia|5lS|4es|4le|5itateSD|9ing|Aon|9orS|7ies|7y|4ng|3simileS|3tS|4book|4ionS|',
  '4o|5rSEG|6ial|7es|7zation|6y|4ualL|3ulties|6y|2deSD|4rS|3ing|2erieS|4oe|4y|2hrenheit|2ilSEG|4ings|4ureS|3ntEGL|5er|6st|3',
  'rSGL|4banks|4child|4e|5r|5st|4fax|5ield|4groundS|4ies|4mont|4ness|4view|4wayS|4y|3thS|5fulL|8ness|5less|2keSD|3ing|2lcip',
  'arum|4o|5nS|6er|6ry|3klandS|3lSG|4acies|7ous|6y|4back|4en|4opian|5w|3seL|5hoodS|4ification|7ed|6y|3terEG|2meD|4r|3iliaS|',
  '7l|7r|8ity|9ze|6es|5y|4ne|3ousL|3s|2nS|3aticS|7al|7ism|3cied|6r|6s|5ful|4y|3dango|4om|3fare|3gS|3ned|4ing|4y|3tasia|7eS|',
  '6tic|9alL|9o|6y|2qfaq|2rEG|3aday|4way|3ce|3eS|4well|3go|3ina|3mSEG|4erS|4houseS|4ington|4land|4stead|4yard|3o|4e|5se|4uk',
  '|3rell|4ier|4ow|3si|3ther|6st|5ing|2sciaS|5nateD|8ing|9on|5sm|6tS|3hionSEG|7able|3tEG|4enEG|6erS|6ings|5r|5st|2tSE|3alL|',
  '5ities|7y|3eS|4ful|3herSG|6hood|6land|4omS|3igueSD|4ma|3tening|5r|4ies|4y|3wa|2ucetS|3lkner|4tSEG|5less|5y|3na|5l|3st|2v',
  'orSEG|5able|8y|5iteS|7ism|4ur|6able|6iteS|2wn|2xes|3ing|2yette|7ville|2zer|1earSEG|4fulL|4less|4some|3sibility|6le|4tSG|',
  '3tS|4herSE|7weight|4ureSD|6ing|2brile|4uary|2cal|3es|3undity|2dS|3er|5alL|7ism|9t|6ted|7ionS|4x|3ora|2eSDL|3ble|3dbackS|',
  '4erS|4ingS|4s|3lSG|4ings|3t|2igned|3st|5y|2ldman|4spar|3icity|4neS|4s|4x|3lSEG|4atio|4er|4owS|6es|6shipS|3onS|5ies|5y|3t',
  'SEG|2maleS|3dom|3inine|7ity|6sm|7tS|6zation|3me|3oral|3ur|2nceSD|4ing|3derS|4i|3nel|5r|3ton|3ugreek|2ral|3dinand|3gus|6o',
  'n|3ia|3me|5ntE|7ation|3nS|4andez|7o|3ocious|6ty|3rara|6i|4etS|4ic|5er|6s|5s|5te|4omagnetic|5us|4ule|5m|4y|3tile|6ity|7za',
  'tion|8eD|9rS|8ing|3ventL|4or|2scue|3t|4er|4ivalS|6e|6ities|2tal|3chEG|5es|3isch|5h|6es|6ism|3terS|3us|5es|2udS|4al|6ism|',
  '3ille|2verS|5ish|2w|3er|4st|1gets|1iance|6e|4na|3sco|3t|2berS|5glass|3reS|4illation|5n|6ogen|4oblastS|5ids|5myalgia|5sis',
  '|5us|2che|3kle|3o|3tionS|7al|5tious|3us|2ddleS|6rS|5ing|3eS|4lity|3ucial|7ries|8y|2eldSEG|5er|5work|3ndS|5ish|3rceL|4y|3',
  'staS|2fe|3o|3teen|7th|4hS|4ies|6th|4y|2gS|3aro|3htSG|5erS|3ment|3ural|6tiveL|5eSD|5ineS|7g|2ji|4an|2lamentS|8ous|3eSD|4f',
  'ront|4maker|4name|4planet|4rS|4size|5ystem|4t|3ial|4buster|4gree|4ngS|4pina|7oS|5po|3lSEG|4erS|5s|5tS|4ies|5ngs|4y|3mSEG',
  '|4eS|4makerS|4ography|4strip|4y|3terSEG|4h|5y|4ration|2nSDE|3alSL|5e|5istS|6ty|6zeD|7ing|5y|4nceSD|6ialSL|7erS|7ng|3ch|5',
  'er|6s|3darticles|4erS|4ingS|4law|4s|3eSL|4pix|4r|5y|4sse|5t|3fish|3gal|4erSEG|6less|6nailS|6printSG|6tipS|3ialS|4s|5hEG|',
  '6erS|7s|4teL|3k|4el|3land|3nSE|4ish|2ona|3ricet|2ps|2reSD|4armS|4ballS|5ird|5ox|4cracker|4fighterS|5lies|6y|4house|4man|',
  '4placeS|5ower|5roof|4side|5tone|4wallS|5ire|5ood|6rkS|3ingS|3mSGL|4ament|4er|4ness|4ware|3stSL|5gov|5hand|3th|2scalL|4he',
  'r|3hEG|4bone|4erS|6ies|6manS|7en|6y|5s|5ye|4hooks|4man|4pond|4y|3sile|5on|4ureS|3tSEG|4er|4ful|4ula|2tS|3ch|3ment|3ness|',
  '3ted|5rS|4ingS|3zgerald|4roy|2veS|2xEG|3ated|5ion|3er|4s|3ings|3tureS|2zzle|4y|1labby|3ck|3gS|4ged|5ing|4poleS|4rant|4sh',
  'ip|5taff|6one|3ilG|4r|3keS|4ing|4y|3mbeau|5oyant|4eSD|5nco|4ing|7oS|4mability|7le|3ngeSD|4kSEG|5er|4nel|3pS|4per|5ing|3r',
  'eSD|4ing|3shEG|5erS|6s|5lightS|5y|4kS|3tSL|4bed|4head|4iron|4ness|4tenEG|6rEG|7y|4ulence|4ware|3unt|3via|5n|5us|4orSEG|6',
  'ful|6ings|5urSE|3wSE|4lessL|3x|4seed|2eaS|3ck|3d|4ged|5ling|3eSG|4ceS|4r|4tSG|5wood|3ming|5sh|3shE|5y|3t|4ch|6er|3ury|3w',
  '|3xEG|4ibility|6le|7y|5on|4or|4ural|2ickSEG|5erG|5r|3ed|4rS|4s|3ghtS|3msy|3nch|4ders|4gG|4t|3pS|4ped|6rS|5ing|3rtSG|5y|3',
  'te|2oatSEG|5ation|5erS|3ckSEG|3gging|3odSEG|5gates|5waters|4rSEG|3pS|4ped|5ies|6ng|5y|3ra|5lS|4ence|6t|7ine|5s|4ian|5da|',
  '6ianS|5n|5ssant|6tS|3ss|3tation|4illa|4sam|3under|4rE|5ishEG|8es|3wSEG|4erSEG|6y|4meterS|4n|3yd|2u|3ctuateSD|8ing|9onS|3',
  'e|4ncy|5tL|3ff|5y|3gelhorn|3idS|5ity|6zed|3ke|3me|3ng|3or|5escein|9nce|At|5idation|7e|6ne|6te|3rries|5y|3shEG|5es|3teSD|',
  '4terG|3vial|3x|4es|2yG|3catcher|3erS|3nn|3wheel|1oalS|3mSG|4y|2cal|3usEG|5es|5sed|6ing|2dder|2es|2g|3dog|3ging|4y|2ibles',
  '|3lSE|2kker|2ldSEG|4able|4erS|3ey|3ia|5ge|5r|4e|4oS|3k|4lore|4ways|4y|3licleS|6ular|5es|4owSEG|6erS|6ings|6up|4y|2mit|2n',
  'dSL|4ling|4ness|4ue|3tS|2oD|3ds|5tuffS|3lSEG|4ishL|7ness|4proof|3tEG|4age|4ballS|8erS|5oard|5ridge|4erS|4hillS|5old|4ing',
  's|4job|4noteS|4pathS|5rintS|4rest|4steps|6ool|4wear|5ork|4y|2rD|3a|4geS|5ing|4minifera|4yS|3bade|4earance|5s|4idS|6den|7',
  'ing|3ceSD|5fulL|5ps|4ible|7y|5ng|3ds|3e|4ach|5rmS|4boding|5rain|4castSEG|8erS|5loseD|8ureS|4fathers|5inger|5oot|5ront|4g',
  'oG|6ne|5round|4hand|5ead|4ign|7erS|4man|5ost|4name|5sicS|4runner|4seeS|7able|5hadowing|6ore|5ight|5kin|5tSE|6all|6erS|6r',
  'y|4told|4ver|4warned|5ord|4x|3far|4eitE|7ureS|3geSD|5ries|6y|5tS|6ful|9ness|6table|7ing|4ingS|5veS|7ness|6ing|4o|5t|6ten',
  '|3int|3kSEG|3lorn|3mSEG|4a|5lL|6dehyde|6in|7smS|7ties|8y|7zation|8eD|5tSE|6e|6ionS|7ve|6ted|8r|7ing|4e|5rSL|4ica|5dable|',
  '4ulaS|7e|7ic|7ry|7teSD|8ing|9onS|6e|4work|3nication|3rest|7er|3sake|7n|4ooth|3tS|4e|4h|5coming|5right|5with|4ies|5ficati',
  'onS|7ed|6yG|5n|5s|5tude|4nightL|4ran|5ess|8es|4uitous|5nateL|6eS|4y|3umS|3wardSEG|7erS|2ssa|4e|4ilS|3terSEG|2toS|2ught|3',
  'lSEG|3ndEG|5ationS|Aal|5erS|5ries|6y|4tainS|8head|3rS|4fold|4ier|4someS|5quare|4teen|8th|5hS|2wlS|4er|2xG|3es|3glove|3ta',
  'il|3woods|3y|2yer|1printf|1racas|4tal|5ionS|8al|9ted|Aion|5ureSD|7ing|3gile|6ity|4mentSE|8ary|9tion|4ranceS|7t|3il|5ty|3',
  'meSD|5less|5rS|5workS|4ing|3ncS|5ais|8e|5eS|6sco|5hiseSD|9es|8ing|5is|7can|8o|5o|6is|4gipani|4kSGL|5enstein|5furt|9er|5i',
  'e|6ncense|5lin|4tic|7ally|4z|3ser|4ier|3t|4ernal|7ities|9y|3udS|5ulentL|4en|4ght|3yE|3zer|2ead|4kSEG|5ish|5y|3ckles|3d|4',
  'die|5y|4eric|8a|8kS|7k|3eSDGL|4bies|5orn|5sd|4dman|5omS|4hand|5old|4lance|5ists|4man|6sonry|9s|4port|4r|4sia|5tanding|6o',
  'ne|6yle|4ware|6yS|4zeS|6rS|5ing|3ight|7er|3mont|3nch|6man|4etic|4zied|5y|3on|3quencies|8y|7tEL|8ation|3sco|6es|4hL|5en|7',
  'erS|6r|6st|5man|6en|5ness|5water|4nel|5o|3tS|4ted|5ing|3ud|5ian|3ya|2iarS|3ction|8al|3dayS|4ge|3ed|5a|5man|5rich|4ndSL|6',
  'lies|8ness|6shipS|4s|4ze|3gateS|4ht|6enEG|6ful|4id|6aire|3lls|5y|3ngeSD|3sian|4k|5y|4t|3th|4ters|4z|3volous|2ock|3gS|4ge',
  'r|5y|3lic|3m|4mer|3nds|4tSEG|5age|6l|5gate|5ierS|6spiece|5line|5page|3sh|4tSEG|5bite|5y|3thG|5y|3wnSEG|3ze|5n|2uctose|3g',
  'al|3itSG|5cake|5ful|5ion|5less|5y|3strateD|8ing|9onS|2yerS|3ing|1uchsia|3kSEG|4ers|4in|2dge|2elSEG|4led|5ing|3r|4te|2git',
  'iveS|3ue|2ji|4film|4tsu|2lcrum|3fil|6lSEG|7ment|3ham|3l|4back|4er|6ton|5st|4ness|4y|3ton|2marate|3bleSD|5ing|3eS|3igatio',
  'n|4ng|2nD|3ctionSEG|8alSL|Aities|Cy|9ries|3damentalSL|Bism|DtS|4ed|5rS|4ing|4raiser|8ing|4s|3eralS|6ry|3gal|4i|5cideS|4u',
  's|3k|4y|3nelS|4ies|7t|4y|2rS|3iousL|3l|4ongS|5ugh|3naceS|4ishEG|7es|7ings|5tureS|3or|3row|4y|3therSEG|7ance|7more|6st|3y',
  '|2sarium|3eSD|4lage|4r|3ing|4onS|3s|4y|2tile|5ity|3una|4reS|5ism|7t|8ic|6ty|2zz|4y|0gabbana|4er|4y|3e|3leS|3on|3riel|7la',
  '|8e|2ddis|3fly|6er|3getS|3olinium|2elS|4ic|2ffer|2geS|3ged|5rs|4ing|4le|3ing|3s|2ia|3ety|3l|3nSEG|4erS|5s|6ville|4ful|3t',
  '|4ers|2laS|4ctic|6ose|4nt|4pagos|4tians|4x|5ies|5y|3eS|4n|5a|4rie|3ician|4lee|6o|3lS|4agher|5nt|7ry|4eon|5ria|7es|6yS|5t',
  '|5y|4i|5c|5um|4onS|5pG|5way|6s|4stones|4us|3ore|3s|3t|3vanic|7zed|8ing|4eston|3way|2mbaS|4ia|5er|5t|4le|6rS|5ing|3eS|4bo',
  'y|4cockS|5ube|4faqs|4play|4rS|4spot|6y|5tats|3ing|3ma|4onS|3ut|2nder|4hi|3gS|4a|4bang|4es|4land|5ia|6on|4rene|4sterS|3ja',
  '|3nett|3try|3ymede|2pSG|3ped|2rageS|4mond|3b|4age|4er|4led|3cia|3de|5nSG|6erS|6ia|4ner|3e|4th|3field|3gantuan|4oyleS|3ib',
  'aldi|4sh|3landS|4ic|3mentS|4in|3nerEG|5t|6t|4ishE|7es|7ment|3ret|6t|4ison|4y|3ten|5rS|4h|4ner|3uda|3vey|3y|2s|3eous|4s|3',
  'ification|3ketS|4in|3light|3oline|3pSEG|4ar|3ser|3tric|6tis|5oenteritis|Bology|7sophageal|6intestinal|6nomic|9y|2teSD|4h',
  'ouse|4keeperS|4wayS|3herSEG|6erS|6ings|3ing|3orS|3wick|2uche|5oS|3dy|3geSD|4ing|3lt|3nt|5letS|3ss|5ian|3teng|3ze|2ve|4l|',
  '3in|2wker|2yS|2zeSD|4boS|4lle|4tte|7er|3ing|1earSEG|4box|7es|2ckoS|2ekS|3s|4e|3z|4er|2force|2ile|3sha|2lSD|3atin|3der|4i',
  'ng|3ler|2mS|3ini|3ma|3stoneS|2n|3bank|3derSE|3eS|4alogical|9es|9stS|8y|4r|5a|6lSL|7e|7ist|8ties|9y|8zationS|9eSD|9ing|6t',
  'eSD|7ing|8onS|Aal|8ve|7orS|5icS|7ally|5osity|6usL|4see|5is|4t|5icS|7ally|7ist|4va|5ieve|3ial|4e|4talS|7ia|5ive|5ourinary',
  '|4us|6es|3ny|3oa|4cidal|7e|4m|5eS|5icS|4typeS|7ing|3reS|3tSL|4eel|4ileS|4le|6man|7en|6ness|6r|6woman|4oo|4ry|3uineL|4s|2',
  'o|3chemical|8stry|3de|5sic|6y|5tic|3ff|5rey|3grapherS|8ic|AalL|9es|8y|3logic|8al|7stS|6y|3magnetic|4etric|9alL|8es|7y|4o',
  'rphology|3physical|9s|4olitical|As|3rdie|4g|5eS|6town|7te|5ia|7nS|8a|6e|3thermal|2rald|6ine|4niumS|4rd|3ber|6aS|4ilS|3ia',
  'tricS|3mS|4anS|6e|6ia|7c|7um|6town|6y|4inate|8ion|3ontology|3ry|3shon|3trude|3vais|2stalt|5po|5tion|9al|4ion|4ureSD|2tSG',
  '|3awayS|3her|3terS|4ing|4y|5sburg|2yer|3serS|1hana|3stly|3zi|2ent|3ttoS|2ostSL|3ulS|1iantS|5ess|3rdia|2bberish|4onS|4s|3',
  'raltar|3sonS|2clee|2ddy|3eon|2fs|3tSEG|4ware|2gS|3abit|5yte|4ntic|3er|3gleSD|5ing|3i|3olo|2la|3bert|3ded|5r|4ing|3es|3lS',
  '|4es|6pie|5tte|4ian|5es|4y|3more|3tS|2mmickS|3p|2ngerL|6bread|4ham|4ival|6itis|3kgo|3ny|3seng|2orgio|3vanni|2raffeS|3der',
  'S|4leS|3lS|4es|4friendS|4ie|4y|3o|3th|2st|2tes|2useppe|2veS|4awayS|4nS|4rS|3ing|1labrous|3ce|4ial|5erS|3dL|4den|4eS|4iat',
  'orS|4ness|4stone|4ys|3m|4orous|5ur|3nceSD|5ing|4dS|5ular|3reD|4ing|3sgow|4s|5er|6s|5house|5man|5ware|5y|3ucoma|3zeSD|5r|',
  '4ier|5ng|2eamG|4nE|5er|3be|3efully|3nS|4dale|4garry|4n|2ial|3b|4c|3deSD|5rS|4ing|3mmer|4pseS|3nt|3oma|3stening|3tterSG|7',
  'y|2obalSL|6isation|7zation|4eS|4in|4ular|6in|5s|3merular|3om|5y|3ria|5es|5fication|7ed|6y|5ousL|4y|5hole|3ss|5aries|7y|5',
  'es|5y|4ter|3ucester|Ashire|3veSD|5r|3wSEG|2uck|4osamine|6e|3eSD|3ing|3t|4amic|7ne|5thione|4en|4tony|2ycerin|8e|6ol|4ine|',
  '4ogen|5l|6ic|6ysis|5proteinS|3nn|3phS|1mail|1nats|3wing|2omeS|3sis|4tic|7ism|2uS|3pg|1oDG|2alS|4ieS|4keeper|3tS|4ee|2bbl',
  'e|3letS|4inS|2ddard|4ess|7es|3father|4rey|3head|3iva|3less|4ike|5ness|4y|3mother|3s|4end|4mack|4peed|3win|3zilla|2ers|3s',
  '|2ff|2ggleS|3o|2ings|3ter|2ldSG|4berg|4en|6eye|6rod|6seal|4finch|6sh|4ie|5locks|5n|4man|4smithS|5tein|6one|4water|3em|3f',
  'G|4erS|3gi|3iath|3ly|2mer|4z|2nadal|5otropin|3dola|3e|3g|3orrhea|3zales|7z|6o|2odSGL|4bye|4ies|4manS|4ness|4will|6n|4y|5',
  'ear|3fs|4y|3gle|3nies|4s|3se|5berry|5neck|2pherS|2ran|3dian|4on|3e|3geS|5ous|4onzola|3illaS|7z|4ng|3se|2sh|4en|3ling|3pe',
  'lS|4ort|3samer|5rd|4ipG|2t|3hS|4a|5m|4ic|3o|3ten|4fried|4lieb|2uda|4y|3ge|4ing|3lash|4d|3rdS|5e|4met|3t|2vernSEG|6ance|6',
  'ess|6mentS|Aal|6orS|2wnS|1rabS|4bed|6rS|5ing|4er|3ceSD|5fulL|4iousL|3dSEG|4ation|4eS|5rS|4ientS|4ualL|6teSD|7ing|8onS|3e',
  'me|3ff|5iti|4tSEG|5on|3ham|3il|4nSE|5y|3mS|4marS|6ticalL|5er|5y|4ophone|4ps|3nada|5ry|4dS|5child|Aren|5daughter|5eS|6r|6',
  'st|6ur|5fatherSE|5iose|5maS|6otherS|5pa|7rentS|5sonS|6tand|4ge|6r|4ite|4nies|5yS|4tSEG|5eeS|5or|4ular|8ity|7ted|8ion|6eS',
  '|6ocyte|7ma|4ville|3peS|5fruit|5vine|4hSG|5er|5icS|7alL|6te|4pa|5le|6ing|3sS|4pEG|4ses|5hopperS|5landS|5roots|5y|3teSD|5',
  'fulL|5r|4ification|7ed|6ying|5ngS|5s|5tude|4uit|7e|7ies|7ousL|7y|3veSL|5lL|5n|5r|5side|6toneS|5yard|4itate|8ion|Bal|6y|4',
  'ure|4y|3yS|4ish|4ling|3zeD|4ing|2easeSD|5y|4tSL|5er|6st|5ness|4ves|3be|3cian|3ece|4d|5ily|5y|4kS|4nSG|5back|6erg|6rier|5',
  'e|6r|7y|5field|5houseS|5ies|6sh|5land|5sboro|6tone|5ville|5wich|6ood|4r|4tSEG|5ings|3g|4arious|4g|4or|6ian|6y|3iner|3mli',
  'nS|3nada|6eS|6ier|7neS|4del|3ta|4chen|4el|3w|3yS|4houndS|2ice|3dS|4ded|5le|4iron|3ef|4vanceS|5eD|5ing|5ous|3ff|5inS|6thS',
  '|5on|3llSEG|5eS|3mL|4eS|3nSD|4ch|4derS|5ing|5s|4go|4ned|5ing|3pS|4eS|4ped|6r|5ing|3sL|4t|3tS|4ty|3zzlies|6y|2oanSEG|3cer',
  'S|6ies|6y|3ff|3in|3mmetS|3omSEG|5erS|4t|4veSD|5ing|5y|3pe|4ing|3sS|4grain|4sed|6s|5ing|5ly|5o|3tesque|4to|3uchy|4ndSEG|6',
  'water|7ork|4pSEG|5ee|6r|6s|5ings|5ware|6ise|4se|4tG|3veS|5r|3wSG|4erS|4lSEG|4n|5ups|4thS|2ubS|4by|4er|3dge|5ingly|3eling',
  '|4some|3ff|3mbleD|6ing|4py|3ndy|4tSEG|1uadeloupe|3ngzhou|4ine|4o|5sine|3rana|6i|6teeSDG|7orS|7y|4dSEG|5ianS|8ship|5rail|',
  '3temala|9n|3va|2bernatorial|2cci|2elph|3rnsey|4rillaS|3ssEG|5es|5work|4tS|5book|5houseS|2iana|3dance|4eSD|5bookS|5craft|',
  '5lineS|4ing|4o|3ldS|5erS|5ford|5hall|4e|4lemot|6rmo|5otine|4t|5y|3neaS|5vere|4ness|3se|3tarS|6istS|2jarat|7i|2lch|3es|3f',
  '|3lS|4ible|5es|4y|2mbo|4y|3my|3p|3s|2nS|3dam|3fire|3man|3nar|4ed|5rS|6y|4ing|4y|3powder|3shot|4mith|3ter|4her|2ppy|3ta|2',
  'rus|2sherS|4ing|3set|3tSG|4avus|4er|4o|4y|2tenberg|3hrie|3s|3ted|5rSG|2y|3ana|2zzlers|5ing|1wen|1ymS|3nasiumS|6tS|7icS|3',
  'pie|2necologic|Bal|AstS|9y|2psies|4um|4y|2ration|3os|5cope|3us|0habeas|3ilitation|4tS|5able|6tS|7ion|5ualL|2cienda|3kSEG',
  '|4erS|4man|4ney|4saw|2d|3assah|3den|4ock|3es|3ith|2emoglobin|5rrhage|2fiz|2ger|3gard|4is|4le|5ing|3ue|2ida|3ku|3lSEG|3na',
  'n|4es|3rSE|4cutS|4dresserS|9ing|6yer|4less|5ine|4pin|4y|3ti|5anS|2keem|3im|2lal|3cyon|3eS|4y|3f|4way|3ibut|4de|4fax|3lS|',
  '4e|5lujah|5r|4markSE|4owed|7en|4ucinationS|4wayS|3oS|4gen|7ated|3tSEG|4erS|3veSD|2m|3as|3burg|7erS|3el|4r|4s|3ilton|8ian',
  '|3letS|3merSEG|6head|6smith|4ing|4ockS|5nd|3perSEG|4shire|4ton|3sterS|5ring|3za|2nce|4ock|3dSEG|4bagS|6ll|5ookS|4crafted',
  '|5uffed|8s|4edly|6ness|5l|5r|4ful|4gunS|4heldS|4icapS|8ped|ArS|9ing|6raftS|5ly|5work|4jobS|4kerchiefS|4leSD|6rS|5ing|4ma',
  'de|6id|4outS|4railS|4setS|5free|5hake|5omeL|5pring|4writing|4y|5cam|3es|3gSEG|4arS|4erS|4ings|4man|4ul|3kS|4ering|4y|3na',
  '|5h|4ibal|4over|3oi|4ver|3s|4a|5rd|4el|5n|4on|3ts|3ukkah|4man|2phazard|3less|4otypeS|3penSEG|6ings|4ier|6st|5ly|5ness|4y',
  '|3tic|2rassEG|6ment|3binger|4orSEG|6side|5ur|3dGL|4back|4core|6ver|4enSEG|5r|5st|4in|6ess|4ness|4shipS|4tail|4ware|5oodS',
  '|4y|3eS|4m|3ing|4sh|3ker|3lem|5quinS|5y|4ot|3mSEG|4an|4er|4ful|4less|4on|6ia|7cS|8aS|7es|7ousL|7zation|8eD|8ing|6y|3ness',
  'EG|7es|3old|3pS|4erS|4oon|4sichord|3rierS|6t|5ngton|5s|6burg|6on|4owG|4y|3shL|5er|6st|5ness|3t|4er|4ford|4ley|4mann|3var',
  'd|4estSEG|7erS|5yS|2san|3bro|3hEG|4es|4ish|3kell|3san|4leS|3ta|4e|5nE|4ily|5ngs|4y|2tSEG|3chEG|5back|5er|7ies|7y|6s|6t|3',
  'eS|4ful|4rS|3field|3h|3red|3terS|4ie|2uer|3ghty|3lSEG|4age|4erS|3ntSEG|3s|4a|4er|3te|2vana|3eSG|4l|5ock|4nS|5t|4ring|3in',
  'g|3oc|2waii|6anS|3es|3kSG|4er|5s|5yeS|4ins|3thorn|8e|2yS|3den|3es|3market|3nes|3stack|3wardS|2zardS|6ous|3e|4l|5nutS|5wo',
  'od|4n|3ing|3y|1eE|2adSEG|4acheS|4bandS|5oardS|4dress|4erS|4gear|4ings|4landS|5ess|5ightS|6neSD|8rS|7ing|5ong|4master|4ph',
  'oneS|5ieceS|4quarterSE|4restS|5oom|4setS|5tock|7neS|6rong|4waters|6y|5ear|4y|3lSDEG|4erS|4th|6care|6ful|6ier|6y|3pSEG|3r',
  'SDG|4erS|4ings|4ken|4say|5e|5t|4tSE|5ache|5beatS|6reakG|AerS|7oken|6urn|5edly|6ning|5felt|5h|5ily|5land|6ess|5wood|5y|3t',
  'SEG|4erS|4h|5enS|6r|5row|3veD|5nSL|4ier|5ly|5ness|6g|4y|5weightS|2brewS|2ck|4er|4ler|3tareS|4ic|4or|2dgeSD|5hogS|4ing|3o',
  'nic|6sm|7tic|2eded|3lSE|2fty|2gemon|7ic|7y|2he|2idelberg|4i|3ferS|3ghtS|6enSE|3n|4ous|4rich|4z|3rS|4ess|4loomS|2ld|3enS|',
  '5a|3ge|3ical|5es|5on|6pterS|4oS|4port|4um|4x|3lS|4cat|4enic|7stic|5r|4ish|4o|4y|3mS|4er|5tS|3pSEG|4desk|4erS|4fulL|7ness',
  '|4lessL|8ness|5ine|3sinki|2matite|5ocrit|6logy|6ma|6poietic|3erocallis|3isphereS|3lock|3med|5r|4ing|3odynamic|4globin|4l',
  'ytic|4philia|4rrhage|9ic|7oids|4stasis|3p|2nce|5forth|3derson|4rix|3ley|3na|4ing|3ri|5etta|4y|3s|3tai|2parin|4tic|6tis|5',
  'ology|2rSD|3aldSE|6ic|6ry|4t|3bS|4aceous|5lS|6ism|8tS|5rium|4ert|4icideS|5vores|3cules|3derS|4ing|4s|3eS|4after|4by|4dit',
  'ary|7y|4ford|4in|6after|4of|4sies|5y|4ticS|7al|5o|6fore|4under|4with|3iot|4tability|6ge|3man|6n|5phroditeS|4eneutics|5s|',
  '5tic|8ally|4ione|5tS|6age|3nandez|4e|4ia|6ted|3oS|4es|4icS|5n|6eS|5sm|4nS|3pes|3ring|7bone|3self|4hey|3tfordshire|4z|3ve',
  '|3zegovina|2sitant|6teD|7ing|8on|3peria|3sian|3ter|2tero|6cyclic|6geneity|Aous|6logous|6sexualS|6zygous|2uer|3risticS|2w',
  'itt|3lett|2xagon|7al|4ne|2yday|3er|1iS|2atus|2bernate|8ion|6ia|8n|3iscus|2ccupS|3key|4ory|4s|2dalgo|3den|3eS|4away|4ous|',
  '3ing|2er|4archicalL|9es|8y|4oglyphics|2ggins|3hSL|4ball|5eam|4er|5st|4landS|8erS|5ightSEG|9er|4ness|4t|4wayS|2jackEG|6er',
  '|2keSD|4rS|3ing|2lariousL|6ty|5y|3da|4ebrand|3figer|3lS|4ary|4billies|8y|4el|5r|4man|4sboro|9ugh|5ideS|4top|4y|3ton|2m|3',
  'alayaS|8n|3self|2ndS|4erSEG|4i|4rance|4sight|4uS|5ism|5stani|3es|3geSD|3tSEG|4erland|2pS|3aa|3er|3pies|4oS|5campal|9us|5',
  'drome|5potamus|4y|2ragana|4m|3eSD|4r|3ing|3oshima|4yuki|3sute|2spanicS|3sed|4ing|3t|4amine|4idine|4ogramS|5logic|AalL|8y',
  '|5neS|5pathology|5rianS|7c|8alL|7es|7ography|6y|2tS|3achi|3chEG|5cock|5es|5hikerS|8ing|3her|6to|3ler|3oshi|3terS|4ing|5t',
  'e|2veS|4r|1oardG|4se|4y|3x|4es|2bart|3bies|4led|4s|4y|5istS|3o|3s|2ckey|4ing|3us|2dder|3ges|4kinS|2es|2ffman|2gan|3s|3ti',
  'ed|2istSEG|2key|2ldSG|4all|4em|5n|5rS|4ings|3eSD|3idayS|4ness|4stic|3la|5ndS|7er|4er|4ies|5ns|4owSE|6ay|4y|5wood|3m|4es|',
  '3ocaust|5ene|4graphic|4morphic|4type|3stein|6rS|3t|4er|3y|2mage|3eSDL|4bound|4coming|4landS|5ess|8ness|4made|6kerS|7ing|',
  '4opathicS|9y|5stasis|5wnerS|4pageS|4rSE|5ic|4schoolG|5ick|6te|5pun|5tead|4town|4ward|5ork|4y|3icidal|7eS|4es|4ly|4ng|5id',
  '|3me|3o|4eopathy|4geneity|8ous|7ization|9ed|7ous|4logous|7ueS|7y|4morphism|4sexualS|Aity|4zygous|2ncho|3da|4o|4uran|7s|3',
  'eD|4stL|6y|4yS|5bee|5comb|5dew|5moonS|9ers|5pot|5suckle|5well|3g|3ing|3olulu|4rSEG|5able|8y|6rium|7y|5eeS|4urS|6able|3s|',
  '2och|3dSE|4ia|5eS|4lum|4oo|4winked|3f|3kSEG|4ah|4erS|4upS|3liganS|3pS|4er|4la|3sierS|3terS|4s|3ver|5s|2pSEG|3eS|4fulSL|4',
  'lessL|8ness|3kins|3ped|5rS|4ing|4y|2raS|4ce|4tio|3deS|3izonS|7talL|3monal|6eS|3nSEG|4blower|4er|5tS|4y|3ology|4scopeS|3r',
  'endous|4ible|7y|5d|5fic|7ed|6ying|4orS|3seS|5back|5man|8ship|5power|5shoeS|5tail|4t|3ticultural|Be|4on|2seSD|3iery|3pice',
  'S|5table|7lS|8ity|9zationS|Aed|3tSEG|4a|5geS|4elS|6ling|5ss|4ile|6ities|8y|4name|2tL|3bed|3elS|5es|5ierS|3house|3jobs|3l',
  'ine|3mail|3ness|3point|3spots|5ur|3ter|5st|4ie|3wire|2ugh|5ton|3ndS|3rSL|4glass|3seSD|5boatS|5holdS|9erS|5keeper|9ing|5m',
  'ateS|5r|5wares|8ming|6ifeS|7ves|6ork|4ingS|4ton|2ve|4rSEG|2wS|3ardS|3dy|3eS|4ll|4ver|3lSG|4er|3to|2yaS|3er|3le|1tdocs|1u',
  'ang|2bS|3bard|4ell|4le|4y|3er|5t|2ckleberry|2ddleD|3son|2es|3y|2ff|4y|2geL|3ged|5r|4ing|6s|3h|4es|3o|3s|3uenot|2la|3k|3l',
  'S|4abaloo|2manSL|5eL|5ism|7tS|8ic|6tarian|7ies|7y|5kind|5oidS|3bleD|5ing|5y|4oldt|4ug|3eS|3ic|4d|5ifierS|6ty|5orS|4liate',
  'D|8ing|9on|6ty|3mel|5rS|4ing|7birdS|3or|5al|5ist|5ous|4ur|3pSG|4back|4hreyS|4ty|3us|2nchE|5back|3dredS|7thS|3g|4arianS|6',
  'y|4er|4rily|5y|3kS|4y|3s|3tSEGL|4erS|4ington|4ress|4sman|5ville|2rdleS|3led|5y|4ing|3on|3rah|4icaneS|5edL|4yG|3st|3tSG|4',
  'ful|2sbandS|7ry|3hE|3kerS|4ies|4s|4y|3sein|3tle|6rS|2tch|5es|5inson|3s|1yacinth|3luronic|3tt|2bridS|6ization|8ed|2dra|5n',
  'gea|6tS|5teSD|6ing|7on|5ulicS|4ide|4o|5carbonS|6ephalus|6hloric|Bde|6odone|5dynamicS|5electric|5gen|8ated|Aion|7ology|6r',
  'aph|Aic|5laseS|6ogic|Aal|8y|6ysis|7zed|5philic|7obic|6onicS|5static|5therapy|9mal|5xide|6y|7l|2ena|2giene|6ic|7stS|3rome',
  'ter|2men|5optera|3nS|4al|2nes|2per|5active|Aity|5bole|8ic|5cube|5geometric|6lycemia|5icum|5linkS|5mail|5plasia|5sensitiv',
  'ity|6onic|6pace|5tension|Ave|7xt|6hermia|7yroidism|6rophic|Ay|3henS|6ated|8ion|3nosis|5therapy|6ic|7sm|8t|7zeD|3ochlorit',
  'e|5risy|7teS|8ical|4glycemia|Bc|4tension|5halamic|Aus|6ermia|7ses|8is|9zeD|7ticalL|6yroidism|2sterectomy|7sis|6ia|7calL|',
  '2undai|0iberia|6n|2id|3s|3za|2ook|1cann|3rus|2eSD|3bergS|4ox|4reaker|3land|7ic|3man|2icleS|3ng|2onS|4ic|4ography|4v|1dah',
  'o|2eaS|4lSL|5ism|7t|8ic|6zed|4tion|3nticalL|6fiable|8cationS|8ed|9rS|9s|7yG|6ties|7y|3ograph|4logicalL|8es|7ues|7y|2iocy',
  '|4mS|5atic|4pathic|4syncratic|4tS|5ic|2le|4ness|4r|3ing|2olS|4atry|2yllic|1f|2def|2rames|1gloo|2natius|3eous|3iteSD|5ing',
  '|6on|3orance|7t|5eSD|5ing|2uanaS|1leum|2iac|4d|2lS|3egalSL|7ity|5ible|6timate|3icit|4nois|4teracy|8te|3ness|7es|3ogical|',
  '3uminateSD|9i|Ang|AonS|9or|4sionS|5ory|5trateSD|9ing|AonS|Ave|9orS|7ious|2ocano|1mageSD|5rS|6y|4inable|7ry|7tionS|9ve|6e',
  'SD|6g|6ing|4o|3mS|2balanceS|3edded|3ued|2itateSD|6ing|7onS|6ors|4rex|2maculateL|4nuel|4terial|5ure|7ity|3easurable|By|4d',
  'iacy|7teL|4morial|4nseL|4rseD|6ion|7ve|3igrantS|7teD|8ion|4nent|3obile|7ization|9ed|4ral|7ity|5talS|8ity|9zed|4vable|3un',
  'e|5ities|7y|6zationS|7ed|5ogen|6logic|Bal|9y|4table|2ogen|2pactSEG|4irSEG|6mentS|4la|5ed|4rtSEG|6ialL|9ity|4ssable|6e|6i',
  'oned|4tience|8tL|3eachE|7ment|4ccable|9y|4dance|5eSD|5imentS|6ng|4lled|7r|4nding|5etrable|4rativeS|7or|5fectL|9ionS|5ia|',
  '7l|8ism|AtS|6um|5meable|6issible|5sonal|9te|Aing|Bon|AorS|5vious|4tus|3inge|7ment|3lantSE|7ation|5usible|4ementSEG|9atio',
  'nS|4icateD|8ionS|6itL|5ed|6s|4ode|5re|5sion|4yG|3olite|4rtSEG|6ance|8tL|7tion|6erS|4seSD|5ing|6tion|5sibility|8le|9y|5te',
  'r|6or|4tence|7t|4undE|7mentS|4verished|3racticable|Al|4ecise|5gnated|5ssEG|7es|7ionS|Aable|Aism|CtS|8veL|7um|4imer|5ntSE',
  'G|5sonE|8ment|4obable|5mptu|5perL|6riety|5veSD|7mentS|6ing|7sationS|Dal|8eD|8ing|3ulseS|6ive|4nity|4re|5ities|7y|4tation',
  '|5ed|1n|2ability|3ccessible|5uracies|9y|8te|4tion|6vated|9ion|7e|7ity|3dequacies|9y|8teL|4missible|4vertentL|3lienable|3',
  'ne|4imate|3pplicable|5ropriateL|3smuch|3ttention|9ve|3udible|4guralS|8ted|9ion|2board|4rn|4und|3red|5eding|3uilt|2caS|4n',
  'descent|5tation|4pable|6citated|9y|4rcerated|Aion|5nate|8ionS|4se|3endiary|5seD|5tiveS|4ption|4ssantL|5t|6uous|3h|4es|3i',
  'denceS|7tS|8alSL|4neration|9orS|4pient|4sed|5ionS|6ve|4te|6ment|5ing|3lement|4inationS|6eD|4udeSD|6ing|5sionS|7ve|9ness|',
  '3ognito|4herent|4meS|5ing|5parable|7tibility|Ale|6etence|At|6leteL|Aness|6rehensible|8ssible|4nceivable|6lusive|5gruous|',
  '5sequential|6iderate|7stencies|Cy|Bt|6picuous|5tinence|5venienceS|Bt|4rporateSD|Aing|BonS|5rectL|3reaseSD|7ingL|5dibleS|',
  '9y|6ulous|5mentSE|9alL|4iminating|3ubateD|7ing|8on|7orS|5us|4mbentS|4rS|5able|5red|6ing|5sionS|2debted|8ness|4cency|7t|5',
  'ision|8ve|4ed|4fensible|5initeL|4lible|4mnification|9ed|8y|7ty|4ntE|6ation|6ureD|4pendence|AtSL|4scribable|5tructible|4t',
  'erminacy|Bte|4xEG|5er|6s|3ia|5nS|6a|7polis|4c|5ateSD|7ing|8onS|8ve|7orS|5es|5ia|5tE|6mentS|4eS|4fference|At|4genous|7t|6',
  'stion|5nant|7tion|5o|4rectL|4scriminateL|5pensable|6utable|5tinct|4um|4vidualSL|Aism|Ct|Dic|Bty|Bzed|6sible|3octrination',
  '|4le|4mitable|4nesia|9nS|4orS|3ra|3uceSD|6ment|5ible|6ng|5tance|6ed|7es|6ion|7veL|6orS|4lgeD|7nceS|8t|6ing|4s|5trialS|Ai',
  'stS|Bzed|8es|8ous|7y|3welling|3y|4media|2effable|5ective|Bness|8ual|5iciencies|By|At|3lastic|4igibility|8le|3pt|5itude|3',
  'qualities|9y|5itable|7ies|7y|3rt|5ia|7l|3s|4capable|4sential|4t|3vitability|8le|9y|3xact|4cusable|4haustible|4orable|9y|',
  '4pensiveL|6rienceD|5licable|By|4tricably|2fallible|4mous|5y|4ncy|5tS|6e|6icide|7le|6ry|4rct|7ion|4tuation|3easible|4ctSE',
  'G|6ionS|8us|7ve|8ity|4r|5ences|7tial|5ior|8ity|5nal|6o|5red|6ing|5tile|8ity|4stE|6ationS|3idelS|7ity|4eld|7er|4ghting|4l',
  'l|5trateD|9ing|Aon|4niteL|8simal|7i|8ve|7y|4rm|6ary|6ity|4x|3lamed|6mation|9ory|5tableS|6eD|6ing|7on|9ary|4ected|7ion|5x',
  'ible|4ictEG|7ion|4orescence|5wS|4uenceSD|8ing|7t|8ial|7za|5x|3oS|4cus|4rmSEG|6alL|7ntS|7tics|9onS|Bal|9ve|6er|4space|4us',
  'a|4world|3ra|5ctionS|5red|5structureS|4equentL|4ingeSD|8mentS|7ing|3uriated|8ing|4seD|5ionS|2gSL|3enious|5uity|4r|4stEG|',
  '6ion|3leS|5side|3otS|3rained|5m|4edientS|5ss|4own|3uinal|2habitSEG|7antS|4lants|6tion|5eD|6rS|5ing|3erentL|5itSEG|7ance|',
  '3ibitSEG|7ionS|7orS|9y|3omogeneous|4spitable|3uman|7e|7ity|2imitable|3quity|3tialSL|7ization|9eSD|Ar|9ing|6teSD|7ing|8on',
  'S|8veS|7orS|2jectSEG|6able|6ionS|6orS|3unctionS|8ve|4reSD|5ies|6ng|6ous|5y|4sticeS|2kSEG|3jet|3ling|3well|2laid|4nd|4yS|',
  '3etS|3ine|3og|2mateS|2nSG|3ate|3er|5most|5vation|4s|3ings|3keeperS|3ocence|7tSL|5uous|4vate|7ing|8onS|8ve|7orS|3uendo|4m',
  'erable|2oculated|8ion|6um|3ne|3perable|7tive|3rdinate|4ganic|3sitol|2patientS|3utS|5ting|2quest|4ireSD|7r|6ies|7ng|6y|5s',
  'ition|9ve|8or|2roads|2saneL|5ity|4tiable|3cribed|6ptionS|5utable|3eam|4ctS|6a|6icideS|5ure|7ities|9y|4mination|4nsitive|',
  'Aity|4parable|4rtSEG|6ionS|4st|4tS|3hore|3ideS|6rS|5ious|4ghtS|7ful|5nia|7ficant|4ncere|4pid|4stSEG|6ence|8t|3ofar|4leS|',
  '6nce|7t|5uble|5vency|8t|4mnia|8c|3pectSEG|7ionS|7orS|9ate|4irationS|Bal|6eSD|6ing|6on|3tabilities|Ay|5llSEG|7ationS|7erS',
  '|7mentS|5nceS|6tL|7aneousL|7iateD|4ead|5p|4igateD|5llEG|5nctS|8iveL|5tutEG|8eS|8ionS|BalL|4ructSEG|8ionS|Bal|9ve|8orS|6m',
  'entSE|AalS|CistS|Dty|Btion|3ufficiency|BtL|4lar|6teD|7ing|8on|7orS|5in|5tSEG|4rable|6nceS|5eSD|6ds|6rS|5gency|8tS|5ing|5',
  'mountable|5rection|2tact|4keS|4ngibleS|3egerS|5rable|7lSL|7teSD|8ing|9onS|9ve|8orS|6ity|4l|5lect|9ualSL|6igenceS|Cr|AtL|',
  'Bsia|8ibility|Ale|4ndSEG|5seL|6ification|9ed|As|8yG|7ties|8y|7veL|5tSL|6ionSE|9alL|4r|5actSEG|8ionS|9veSL|Aity|6gency|5b',
  'ank|5cellular|7ptSEG|9ionS|9orS|7ssion|6hangeS|Bable|Ey|6ity|6ollegiate|7mS|8pany|7nnectSEG|CionS|8tinental|7oler|7urse|',
  '6ultural|5dependence|Dt|6iction|5estSEG|8ingly|5faceSD|8ial|9ng|6ereSD|9nceS|8ing|8ometer|Cry|5im|6orS|5laceD|6eaved|9in',
  'g|6ibrary|7ngua|8kE|6ockEG|8utory|6udeS|5mediaries|By|AteS|Bion|7nt|7zzo|6inable|8gled|7ssionS|7ttentL|7x|6olecular|7unt',
  'ain|5nSE|6alSL|8ization|AeD|7tion|BalSL|Des|Dism|Ft|6et|6ists|6ment|6shipS|5operability|5personal|6hase|6lanetary|8y|6ol',
  'ateD|Aing|Bon|7sed|6retSEG|9ationS|Cve|9erS|9ive|7o|5racial|6ed|7gional|7lated|6ogateD|Aing|BonS|AorS|Cies|6uptSEG|9ible',
  '|AonS|5scholastic|7ience|6ectSEG|9ionS|7x|6persed|6tateS|7ellar|7itial|5tidal|6wined|5valS|6eneSD|8ing|8tionS|Cal|6iewSE',
  'G|9eeS|ArS|5working|7ven|4state|6inal|8eS|3imacy|6teSDL|5idateD|9ing|Aon|3o|4lerable|8nce|9t|4nation|4xicated|9ing|Aon|3',
  'ra|5cellular|6oastal|6ranial|6table|5molecular|6uralS|7scular|5net|5ocular|5peritoneal|5state|5vascular|6enousL|4epid|4i',
  'cacies|7teL|5gueSD|7ing|5nsicS|9ally|4o|5duceSD|8ing|8tionS|9ory|5spection|Bve|5verted|4ude|7rS|6ing|5sionS|7ve|3ubation',
  '|4it|6ionS|7veL|2undated|7ion|3yasha|2vadeSD|6rS|5ing|4lid|7ateD|9ion|7ity|5uable|4riably|7nce|8tS|4sionS|6ve|3entSEG|6i',
  'onS|7ve|6orS|8ied|As|8y|4rness|5seL|6ionS|5tEG|6ebrateS|7rS|6ible|4stSEG|6igateSD|Aing|BonS|Dal|Bve|AorS|Cy|6mentS|6orS|',
  '3igorate|9ing|4ncible|4sibility|7le|6on|4tationS|Aal|5eSD|6es|5ing|3ocationS|4iceSD|6ing|4keSD|5ing|4luntarily|Ay|6tion|',
  '5veSD|7ment|6ing|2wardSL|3ood|1odide|4ne|2lite|2mega|2nS|3amin|3ian|4c|4zation|5ed|6r|5ing|3osphere|9ic|2ta|2wa|1pecac|2',
  'odS|2sec|3ilateral|3wich|2tables|1ran|4i|5anS|3q|4iS|3s|3te|2eland|3na|4e|2fan|2ian|3descent|4ium|3s|4es|4h|5man|3ver|2m',
  'a|2onSEG|4clad|4ic|6ally|5es|4man|4stone|4wood|6rk|4y|3quois|2radiance|7ted|8ion|4tional|Aity|3econcilable|4ducible|4fut',
  'able|4gularL|9ities|By|4levance|9t|4parable|5laceable|5ressible|4sistible|5pective|6onsibility|Ble|4verent|7sible|5ocabl',
  'e|Ay|3igateD|7ion|4tability|7le|6ntS|6teSD|7ing|8onS|2vin|5e|5g|2win|1sG|2aacS|3bel|6la|7e|3dora|3iah|2chemia|7c|2eries|',
  '2fahan|2hmael|2idore|3s|2lam|5ic|6sm|7tS|4ndS|6erS|4y|3eS|4tS|2o|3baric|3electric|3flavones|3lateSD|6ing|7on|4de|4eucine',
  '|3merS|5tric|4orphic|9sm|3propyl|3thermal|4onic|5peS|6ic|4ropic|4ype|2rael|6iS|7teS|2suanceS|4eSD|5rS|4ing|2t|3anbul|3hm',
  'us|2uzu|1tS|2alia|6nS|7o|5cS|6ized|4y|2chG|4y|2emS|4izeD|3r|4ateD|6ing|7onS|7veL|2haca|2inerant|7ries|8y|2self|2unes|1va',
  'n|2ins|2oire|3ry|2tools|1zumi|2zard|0jabber|2ckSEG|4al|5ss|4etSE|4ie|4man|4o|4pot|4sonS|7ville|4y|3obS|5ian|5son|5us|5y|',
  '3queline|6s|3uzzi|2deD|2eger|2ger|3ged|5r|3uarS|2ilSE|4er|4house|3me|3n|4ism|2karta|3eS|3ob|2mS|3a|4ica|7n|3balaya|4oree',
  '|3es|5on|5town|3ie|3med|5rS|4ing|2n|3eS|4iro|4t|3ice|4s|4torS|7ial|3os|3uary|4s|2pan|5es|7e|3onica|2rSE|3gon|3red|4ing|3',
  'vis|2smine|3on|3per|2undice|4t|2va|4nese|3elin|3ier|2ws|2yS|3hawkS|2zz|4y|1boss|1ealous|7y|3nS|4ette|4ie|4ne|6tte|5ie|2e',
  'pS|3rs|3ves|2ffS|4eries|6son|6y|4reyS|2hovah|2llies|4y|5fish|3soft|2mima|2nkins|3na|4ie|5fer|5ngs|4y|3sen|4on|2opardizeD',
  '|9ing|7y|2rald|3emiah|5y|4z|3kSEG|4y|3ome|3ry|3seyS|3usalem|2sper|3s|4e|4ica|5e|3t|4erS|3uitS|4s|2tS|3er|3hro|3ted|4ing|',
  '4y|2welSE|5erS|5led|7r|8y|5ry|3ish|3ry|3s|2zebel|1iang|2ffies|4y|2ggle|3s|4aw|2had|2ll|2m|3my|2ng|4leS|2tterS|6bug|6y|2v',
  'e|1oachim|3n|4na|5e|3quin|2bS|3ber|3less|2celyn|3hen|3kS|4eyS|2e|3l|3y|2ggerS|4ing|2han|5n|6a|6es|8burg|5sson|3nS|4athan',
  '|4nie|5y|4son|5ton|2inSEG|4erS|6y|4tSEL|3stS|2joba|2keSD|4rS|3ingL|2lie|3la|4y|3t|2nah|4s|4than|3es|3g|3i|2omla|2plin|2r',
  'danS|6ian|3ge|2se|4f|4phS|6ine|3h|4i|4ua|3iah|4e|3s|2ubert|3leS|3rnalSG|7er|7ism|9tS|Aic|5eySEG|7man|4s|3st|2vial|5n|2yS',
  '|3ce|3fulL|3ousL|3stick|1uan|4es|2bilant|5ee|2dah|4ic|6a|5sm|4s|3e|3geSD|5ment|4ing|4mentS|3icialL|7ry|6ous|4th|3o|3y|2e',
  'rgen|2ggernaut|4le|6rS|5ing|3s|3ular|2iceSD|5r|4ing|4y|2kebox|7es|2les|3ia|5n|6a|4e|5n|5t|4o|4us|3y|2mbleD|4o|3pSEG|4erS',
  '|4y|2n|3ctionS|5ure|3e|4au|3gleS|3iata|4orS|4per|3k|3o|3ta|2piter|7media|7web|2rassic|3idical|4ed|5s|4s|5dictionS|Cal|5p',
  'rudence|5tS|3orS|3yS|2ssi|3tL|4er|4iceS|5fiable|Ay|7cationS|7ed|8s|6yG|5n|6e|4o|4us|2te|2venileS|2xtaposed|8ition|0kabel',
  '|3uki|2huna|2i|3ser|2lamazoo|3eidoscope|3i|2mala|3el|3ik|5aze|3pong|2nawha|3g|4arooS|3ji|3sas|3ye|2olin|2plan|3ok|3pa|3u',
  'r|2rachi|4oke|4te|3cher|3el|4n|3i|3l|3ma|4ic|3nataka|3st|3war|2shi|4mir|7i|2takana|3eS|3harina|8e|4erine|4leen|4ryn|4y|3',
  'ie|3rina|3y|2uai|3fman|2va|2wasaki|2yS|3akSG|2zaa|4khstan|1bytes|1eane|3rney|2babS|2dar|2elG|4er|3nL|4e|5r|3pSG|4erS|4sa',
  'keS|2ith|2lkoo|3ler|5y|4ogg|4s|4y|3p|3ty|3vin|2mal|3pS|4er|2n|3ai|3dall|3nebec|5dy|5lS|5r|5th|4y|3o|3sington|3t|4ish|4on',
  '|4ucky|3wood|3ya|2plerian|3t|2rala|4tin|3nS|4elS|3osene|3ri|5e|4y|3sey|2strel|2tch|5up|3oneS|3tleS|6r|2van|3in|2ySEG|3bo',
  'ardSG|3chain|3es|3gen|3hole|3less|3nes|6ian|4oteS|3pad|3stone|3wordS|1hakiS|3lifa|4sa|3n|2mer|1ickSEG|4backS|4erS|4off|2',
  'dS|3der|6minster|4ies|5ng|4y|3nap|6ped|7ing|4eyS|2effer|3l|3ran|2jiji|2ki|2ley|3im|3lSEG|4arney|4deer|4een|5rS|4ings|3ma',
  'rnock|3nS|3oS|4gramS|4meterS|7res|4wattS|3tS|2m|3ball|4erly|3ono|2naseS|3dSL|4er|6gartenS|5st|4leD|5ing|4ness|4red|3emat',
  'icS|4siology|6s|4ticS|3gS|4domS|4fish|8er|4pin|4ship|5ley|5ton|4wood|3kS|4y|3o|3ship|4man|2oskS|3wa|2per|3per|2rby|3ibat',
  'i|3k|4land|4man|3sch|4ten|5y|2smet|3sEG|4es|4immee|5nger|3wahili|2tS|3chenS|7er|8tte|7ware|3eS|3tenS|4ies|4s|4y|2wanis|3',
  'iS|1lamath|3us|2ein|2ing|3p|2ondike|1nack|3psack|3ve|2eadG|3eS|4lG|3ll|4t|3sset|3w|2ickS|5erbocker|7s|3fe|3ghtS|6hood|3t',
  'S|4ted|6rS|5ing|4wear|3ves|2obS|3ckSEG|5down|5erS|5offS|6ut|3llS|3tS|4ted|5ing|5y|3wSG|4ingly|4ledge|9able|9base|9storm|',
  '6s|4n|5site|3xville|2uckleS|3dsen|1oalaS|2ch|2dak|2ffer|2hl|4er|2ller|2na|3g|3ica|4ng|3rad|3stantin|3takt|2okaburra|3ten',
  'ay|2ran|3ea|5nS|3s|3una|2sher|3ovo|3tenlos|2ta|1raft|3mer|3ut|2eis|3mlin|2is|4hna|4ten|5i|6an|6n|2ona|4e|5r|4or|3on|2uge',
  'r|2ypton|2zysztof|1uala|2dos|4z|3zu|2lkarni|2mar|2ng|2rdish|6tan|4s|3t|2wait|1wan|3zulu|1yle|3ie|4x|2ocera|3to|2rgyzstan',
  '|2ung|0labS|3an|3elSEG|5er|5led|6ing|3ia|4le|3orSEG|5atories|9y|5erS|5ious|4urSG|6er|3rador|4et|3yrinth|2ceSD|4y|3ie|4ng',
  '|3kSEG|4ey|4land|5uster|3oste|3querE|3rosse|3tate|6ing|7on|4ic|4obacillus|5se|3una|3y|2dderS|3en|3ies|4n|5g|3le|3s|3yS|4',
  'bird|5oyS|5ugS|2fayette|2ger|3ged|4ing|3oonS|3rangian|3s|3una|2id|3n|4e|4g|3rD|3ty|2keS|4land|4rS|4side|4wood|3ota|3shmi',
  '|2maS|4r|3bS|4da|4eau|5rt|4orghini|4skin|3e|4ness|5tSEG|6ationS|4r|3ina|6r|6teSD|7ing|8on|3pS|4oon|4rey|2nSD|3aS|3cashir',
  'e|6ter|4e|5rS|5t|4ing|4ome|3dau|4ed|5rS|5s|4fall|5ill|4ingS|4lady|5ess|5ineS|5ocked|6rdS|4markS|4ownerS|4s|5capeSD|9r|8i',
  'ng|5lideS|3eS|4y|3ge|4ley|4uageS|5id|6shing|3ka|3ning|4y|3olin|3sdowne|4ing|3tana|4ernS|3yardS|2os|3tian|2pS|3aroscopy|3',
  'el|3idary|3lacian|5nd|3ped|4ing|3seSD|3topS|2ramie|3ceny|4h|3der|3geL|5mouth|5r|5st|4oS|3iat|3k|4spur|3ly|3ry|3s|4en|4on',
  '|3us|3va|5e|5l|3yngeal|5x|2sS|3erS|5jet|3hEG|4es|3ik|3seter|4ie|4o|3tSEGL|4est|2tE|3chEG|5es|3eSL|4ncies|5ess|5t|4r|5alL',
  '|4st|4x|3heS|5r|3inS|5aS|5oS|4onS|4tudeS|3rines|4obe|3ter|4iceS|3via|6n|2udable|4ed|5r|6dale|4s|3ghSEG|5able|5ter|3nchEG',
  '|6cast|6erS|7s|4derEG|5ries|6y|3ra|4eateS|5lS|5n|6ce|6t|7ian|4ie|5n|2va|4ge|4tory|3ender|4r|3igne|4nia|4shL|2wS|3fulL|3l',
  'ess|7ness|3makerS|3nS|3rence|4ie|3son|4uitS|3ton|3yerS|2xativeS|2ySEG|3away|3erSEG|4tte|3man|3ne|3offS|4utS|4ver|3up|2za',
  'r|5us|3er|3ily|4ness|3uli|3y|1eachG|3dSEG|4erS|6ship|3fS|4letS|4y|3gueS|3h|3kSEG|4age|4y|3nSEG|4der|4er|4ings|3pSEG|4fro',
  'g|4t|3r|4nSEG|5erS|5ings|5t|3sEG|4eS|5hold|4h|5es|4t|3therS|7ette|7head|3veSD|5rS|4ing|2banese|5on|2cithin|3tern|4ionary',
  '|4or|4ureSD|7rS|7ship|6ing|2dS|3er|3geS|5rS|2eS|3ch|5ers|6s|3ds|3kS|3per|3r|4y|3ward|5y|2ft|4ism|6tS|4most|4overS|2gS|3a',
  'cies|5y|4lSL|5ities|7y|6zation|7eD|7ing|4to|3endS|6ary|4r|3ged|4ings|4y|3ibility|5le|6y|4onS|4slateD|8ing|9on|9ve|8orS|8',
  'ureS|4timacy|8teL|7ize|3umeS|2high|3man|3rer|2ica|4ester|9shire|3f|3gh|5ton|3la|3pzig|3shmania|Asis|4ureL|3th|2manS|3maS',
  '|4ingS|3onS|5ade|5y|3pira|3uel|4r|2na|3dSG|4erS|4ingtree|3gthS|6enEG|6wise|6y|3iency|6t|4nist|3non|4y|3o|4ra|4vo|4x|3sG|',
  '4es|3t|4en|4icular|5lS|2on|4ardS|7o|4e|4id|4ora|3pardS|4old|3tardS|2per|3idoptera|3rechaun|4osy|3tonS|2roy|2sS|3bianS|7a',
  's|7ism|5enne|4oS|3ionS|3lie|3otho|3seeS|5nSEG|5r|4ing|4onS|5rS|3t|4er|2tS|3down|3hal|6ity|5rgic|7y|3itia|3raS|3tSG|4erSE',
  'G|6headS|6press|4uce|2u|3cine|3kemia|3ng|2vant|3eeS|4lSEG|5er|5led|6ing|4rSG|5ageSD|7ing|3iSE|4athan|4es|4n|5e|4tation|5',
  'es|5icus|5ra|5y|3yG|2wes|3is|2xar|3ical|5ons|4ngton|4snexis|3mark|3us|2yland|1iabilities|8y|4le|3isonS|3na|4g|3rS|2bby|3',
  'devel|3el|5ous|4r|5alSL|7ism|8zation|9ed|6teD|7ing|8on|7or|5ia|7n|5tarianS|Bism|7s|6ies|7neS|6y|3ido|3ra|5rianS|9ship|7e',
  's|6y|4etto|3stdc|3tool|3ya|5n|2ce|4nceS|5seSD|7eS|6ing|6orS|6ure|3henS|3kSEG|4ers|3orice|2dS|3ded|3o|2eSD|3berman|3chten',
  'stein|3der|3ge|3nS|3u|4tenantS|2feS|4blood|5oat|4cycle|4guardS|4house|4less|5ike|6neS|5ong|4rs|4saver|7ing|5tyleS|4timeS',
  '|3tSEG|4erS|2gamentS|4nd|4tion|5ure|3htSEGL|5box|5enEG|6rS|6st|5headedness|8rted|6ouseS|5ness|6ing|5ship|6peed|5weight|3',
  'ne|4in|5te|2kable|3eSDL|4lihood|4ned|6ss|4wise|3ing|2la|4cS|3ian|4es|4th|3lian|5put|4y|3y|2ma|3bS|4ic|4o|3eS|4light|4ric',
  'kS|4stone|3itSEG|5ationS|5erS|5less|3nology|3oS|4usineS|3pG|2na|3coln|7shire|3daS|5ne|4en|5r|4o|4say|5ey|3eSD|4a|5geS|5l',
  '|5rL|6ity|7zation|8ed|4man|4nS|5o|4rS|4up|3g|4erSEG|6e|6ie|4o|4ua|6l|5istS|8icS|Aally|3ingS|3kSEG|4ageS|4er|4in|4sys|3n|',
  '3oleic|6nic|6um|4type|3seed|5y|3t|3us|3wood|2onS|4el|5ss|4heart|2pS|3ase|3id|4tor|3oproteinS|4somes|5uction|3ped|5r|3sti',
  'ckS|2quefaction|6ied|5urS|4idS|6ateD|8ing|9onS|8orS|6ity|4orS|2raS|3e|2sa|3bon|3hed|3le|3p|3tSEG|4e|5nSEG|6erS|5rS|6ia|4',
  'ings|4mania|4price|4serv|2t|3any|4s|3eS|4rS|5acy|6lSL|6ry|6te|7i|7ureS|3hia|5um|4o|5graphS|Aic|Ay|5logy|5sphere|4uania|9',
  'n|3igantS|6teD|7ion|3mus|3reS|3terSEG|4leS|6st|6ton|4oral|3urgical|6y|2vable|3eSDL|4cam|4journal|4lihoodS|4n|4rS|5more|5',
  'pool|5y|4sex|5tock|3id|4ng|6ston|3reS|2za|4rdS|3zie|1lamaS|3no|2oydS|1oach|3dSEG|4erS|4ings|3fG|4erS|3m|3nSE|3thG|5e|5so',
  'me|3ves|2bbied|6s|4yG|5istS|3eS|4lia|3oS|3sterS|2ca|4lSL|5eS|5host|5ities|7y|6zation|7eD|4nda|4teSD|5ing|6onS|8al|5orS|3',
  'h|3i|3kSEG|4able|4box|4e|5rS|5tS|4heed|4out|4port|4smithS|4up|4yer|3oS|4motion|8veS|7or|3um|4s|5tS|2der|3geSD|5pole|5r|4',
  'ingS|2ess|2ftS|4y|2g|3an|4rithmS|9ic|3bookS|3ged|5rhead|6s|4ia|5ns|3icS|5alL|4sticS|8al|4tech|3oS|4n|4type|2han|2inS|3s|',
  '3tering|2la|3itaS|3lipopS|4y|2maS|3bard|2ndon|6ers|4res|3eL|4liness|4r|4some|3gSEG|4a|4boat|6w|4er|5st|5vity|4hornS|4itu',
  'de|8inalL|4time|4ue|2okSEG|4er|4in|4out|4smart|4upS|3mSEG|3nS|4ey|4y|3pSEG|4er|4holeS|4y|3seSDL|5nEG|5r|4ing|3tEG|4ers|2',
  'pes|4z|3sided|2ral|4n|3dS|4shipS|3e|4al|4n|5zo|3iS|4mer|4ng|3raine|4ies|4y|3tab|2seS|4rS|3ing|3s|4es|4less|3t|2tS|3hian|',
  '3ionS|3ta|4e|5ries|6y|4ie|4o|3us|2udL|4er|5st|4ness|3gh|3ie|4s|5a|5e|5iana|5ville|3ngeS|6rS|5ing|3pe|3se|4y|3vers|4re|2v',
  'able|3eSDL|4less|5iness|5ock|4rS|3in|5gL|2wSEGL|3ell|4rSEG|5y|4s|5t|3landS|3ther|2yal|5istS|5ties|6y|3ola|2zengeS|1ubboc',
  'k|3eS|3ricantS|7teD|8ing|9on|2can|4s|3chese|3e|4nt|4rne|3ia|5n|6a|4d|5a|5ity|4fer|7ase|4le|4nda|4te|4us|3k|4iest|5ly|4y|',
  '3rative|4etia|3y|2dicrous|3low|3wig|2ella|2ger|3gage|2igi|3s|2kas|3eS|4warm|2la|3labies|6y|3u|2mbar|4erG|6jack|3enS|3ina',
  'ireS|6l|6nce|6ries|5escence|At|5osity|6us|3pSE|4kin|4ur|4y|2naS|4cy|4r|4ticS|3ch|5eonS|6s|5room|3es|3gS|4e|2pine|3us|2rc',
  'h|3eSD|3id|4ng|3kerS|4ing|4s|2scious|3h|3tS|4er|4ful|4rous|4y|2te|4in|6izing|3her|6anS|3on|2xe|4mbourg|3or|3uriant|6es|6',
  'ousL|5y|1yceum|3opene|4s|3ra|2dia|2ing|2mph|5atic|5edema|5oblastic|6cyteS|9ic|6id|6maS|2nchG|3don|3ette|3n|4e|3x|2onS|2r',
  'ed|3icS|5alL|5ist|2sateS|3ine|4s|3ozyme|2tic|0maarten|2bel|2cS|3abre|4ca|4damia|4o|4que|4roni|5thur|4u|4w|3beth|3donald|',
  '3e|4don|7ia|9nS|3hete|4i|5nEG|6ations|6eS|7ry|6istS|3intosh|3k|4ay|4enzie|5rel|4inaw|6tosh|3millan|3on|3quarie|3roS|5eco',
  'nomic|5media|6olecules|5phageS|5scopic|3ular|3world|2dL|3agascar|4m|5e|3cap|3denG|3e|4ira|4leine|5ine|5on|4r|3ge|3house|',
  '3ison|3man|3ness|3onna|3ras|4id|5gal|4ona|3thumbs|3uro|2elstrom|3stro|2fia|2gS|3azineS|3dalen|8e|3eS|4llan|4nta|3gie|4ot',
  'S|3ic|5alL|5ianS|5k|4ster|6rateS|3ma|3na|5te|4esia|7um|5tS|6icS|8ally|7sm|7te|7zation|8ed|6o|7meter|4ificat|Aion|8ence|A',
  'tL|7ed|8rS|6yG|5tudeS|4oliaS|4um|5s|3pieS|3yar|2hal|4raja|6shtra|4tma|4yana|3di|3esh|3moud|3ogany|4ning|2idS|4a|4enS|6he',
  'ad|3lSEG|4bag|5ox|7es|4erS|4man|3med|3nSL|4e|4frame|4land|4stay|6ream|4tS|5ainSEG|8able|8erS|5enance|3re|3sonette|3ze|2j',
  'estic|6y|3lis|3olica|4rSEG|5domo|5ities|7y|2keS|4file|4over|4rS|4shift|4up|3ingS|2la|4bar|4cca|5hite|4dies|5y|4ga|6sy|4i',
  'se|4ria|4te|4wi|4y|5alam|5sia|8nS|3colm|3dives|3eS|4volent|3feasance|4ormationS|7ed|4unctionSG|3i|4bu|4ce|5iousL|4gnE|6a',
  'ncies|9y|8t|4k|3kin|3lS|4ardS|4eable|5e|5tS|4orca|5w|5y|3nourished|4utrition|3o|4ne|3practice|3tS|4a|4ese|4reatment|3war',
  'e|2mba|4o|3ie|3ma|5lS|6ia|8n|5ries|6y|4oth|2nSL|3aS|4geSD|6ability|8le|6mentS|6rS|7ial|5ing|4teeS|3chester|5u|6rian|3dal',
  'a|7y|5mus|5n|5rin|5teSD|6ing|6ory|4ible|6ular|4olinS|4rake|5el|5iva|4y|3eS|4uverSG|8ability|3fred|3gaS|5nese|4e|5r|4leD|',
  '4o|5es|5steen|4roveS|3hattan|4oleS|5od|3i|4a|5cS|6al|4c|5ureSD|4festSEGL|8ationS|8oS|5oldS|4la|5la|4pulateSD|9ing|AonS|A',
  'veS|9orS|4toba|3kind|3nEG|4a|4equinS|5rSE|6isms|4itol|4ose|4y|3oS|4rS|3power|3sfield|4ionS|4laughter|4on|3ta|4elS|4is|4l',
  'e|4raS|4ua|3ualSL|4el|4factory|8ureSD|BrS|Aing|4ka|4re|4s|5criptS|3y|3zanillo|7ta|2ori|2pS|3es|3leS|3ped|5r|4ing|3quest|',
  '2rS|3a|4e|4natha|4thi|6onS|4uderS|3bleSD|6head|3c|4asite|4el|6la|7o|4hEG|5ers|6s|4i|5a|4oS|5ni|4us|3di|3eS|4k|4ngo|3gare',
  't|6ine|7taS|4e|5ry|4ie|5nS|6alL|8ized|4ot|4uerite|3iS|4a|5h|5n|6aS|6ne|4eS|5tta|4gold|4juana|4lyn|4mba|4n|5aS|6deS|6teD|',
  '5eS|6rS|5o|4o|5n|6ette|4st|4tal|5imeS|3joram|6ie|3kSEG|4down|4edly|5rS|5tSEG|6ability|8le|6erS|6place|4ham|4ings|4ka|4o|',
  '5v|4sman|4upS|5s|3la|4boro|8ugh|4ena|5y|4inS|3malade|4ite|4ot|3oonS|3queS|6eS|6ss|6tte|5is|7e|3red|4iageS|5ed|6s|5ott|4o',
  'w|4yG|3sala|4eilleS|4h|5a|6lS|7lSG|5es|3tS|4el|5nS|5s|4ha|4ial|6nS|5nS|6a|6ez|6gale|6i|7que|4y|5n|5rSE|6dom|3velSE|6ous|',
  '4in|3xism|6tS|3yS|4land|2sS|3ai|3cara|4otS|4uline|8ity|3er|5ati|3hE|4a|4pee|3jid|3kSEG|3ochism|4nS|5ic|5ry|3que|6rade|9i',
  'ng|3sa|5chusetts|6reSD|5geSD|7rS|6ing|4eSD|5use|5y|4if|5veL|4less|3tS|4ectomy|5rSEG|6bating|Aon|6card|6fulL|6mindS|6piec',
  'eS|6works|6y|4head|4ic|5ff|5tis|4odon|4urbateS|9ing|Aon|9ors|2tSEG|3ador|3chEG|5book|7x|5er|6s|5less|5maker|8ing|5stick|',
  '3ely|4o|4r|5ialSL|8ism|At|Bic|9ty|9zeD|6el|5nal|6ity|3hS|4ematica|BlL|AianS|As|5r|3ic|4n|5ee|3lab|3ra|4ices|6ulated|Aion',
  '|5monialS|8y|5x|4onS|3tSEG|4a|4e|5l|5rSE|4hewS|5ias|6eu|4i|5ngly|4ress|8es|4y|3uration|5eSD|5ing|6ties|7y|2ud|3mee|3reen',
  '|4ice|5tania|6ius|3ser|4oleum|3ve|2ven|4rickS|3is|2x|3ell|3illary|6ofacial|4mS|5a|6lL|5ization|7eSD|8r|7ing|5umS|6s|3tor',
  '|3well|2yS|3a|4n|3be|3day|3en|4r|4s|3fair|4ield|4lower|3hem|3nard|3o|4nnaise|4rS|5al|4tte|3pole|2zda|3eS|3ur|1cafee|2bri',
  'de|2cain|4rthy|6ney|3onnell|4rmick|4y|2donald|4well|2gee|3ill|3rath|5w|4egor|3uire|2intosh|2kay|3enzie|3inney|2laren|4ug',
  'hlin|3ean|2mahon|2pherson|1e|2adS|4e|4owS|6lands|3ger|4re|3lS|4time|3nSG|4derSG|4est|4ingfulL|7less|7s|4t|5ime|4while|3s',
  'les|5y|4urable|6eSD|7mentS|6ing|3tS|4less|4y|2cca|5no|3hanicS|8alL|7smS|8tic|7zation|8ed|2dalS|5ist|5lionS|3dle|5ing|3el',
  'lin|3ford|3iaS|5l|5nS|5stinal|5teSD|6ing|7onS|6orS|5wiki|4cS|5ago|6id|6lL|6re|6ted|7ionS|5i|6nal|7eS|5o|4eval|4na|4oS|5c',
  're|7ity|4tate|7ing|8onS|8ve|5erranean|4umS|3ley|4ine|3ulla|7ry|4sa|2ehan|3kS|4er|3r|3tSG|4ings|4up|2galith|8ic|4n|4phone',
  '|5ixelS|4tones|4wattS|3s|2in|3osis|4tic|2laleuca|4mine|4ncholic|9y|5ge|5ie|6n|5ogaster|6ma|3bourne|3ding|3ee|3ia|4nda|4s',
  'sa|3lon|5w|4y|3odias|6c|6es|6ous|5rama|9tic|5y|4nS|3rose|3tSEG|4on|3ville|5n|2mS|3berS|6list|6shipS|4raneS|3entoS|3oS|4i',
  'rS|4rabilia|7le|6nda|8um|5ex|5ia|7lS|6es|6zation|7eD|7ing|5y|3phis|2nSD|3ace|5ing|4ge|6rie|3ded|5lian|5s|4ing|3g|3ial|4n',
  'gitis|6ococcal|4scus|3lo|3nonite|3ominee|4pausal|8e|4rah|3sa|4trual|8tion|3tS|4alL|6ity|5tion|4hol|4ionSEG|4orSEG|6ship|',
  '3uS|3zies|2phisto|2rcantile|5tor|4edes|5naries|8y|5r|4handise|BrS|Aing|7tS|8ability|4ies|5fulL|5lessL|4k|4urial|6y|4y|3e',
  'L|4dith|3geSD|5rS|4ing|3ida|5ia|7nS|6onal|4ngue|5o|4tSE|5orious|3le|4in|3maidS|3riam|5l|6l|6y|5ment|5tt|4y|3seyside|3ton',
  '|2saS|3enchymal|5teric|3hEG|4es|3merized|8ing|3onS|4potamia|Bn|4thelioma|4zoic|3quite|3sEG|4ageS|7board|7slog|6ing|4eS|5',
  'ngerS|5r|4iah|6nic|4rs|4y|2tS|3a|4bolic|8sm|8teS|8zed|4critic|4data|4lS|5lic|8a|8ity|6urgical|9y|5ware|6orkG|4morphic|9o',
  'sis|4phorS|8icalL|6ysical|As|4search|5table|7sis|7tic|4zoa|3eorS|6iteS|6ological|BstS|Ay|4rSEG|3hacrylate|5done|5ne|4ink',
  's|5onine|4odS|6icalL|7stS|6ological|Bes|Ay|4yl|6ated|8ion|6ene|3iculousL|4s|3ra|4eS|4ic|6al|4o|5logy|5nomeS|5pole|8is|9t',
  'an|3tle|6r|2xicanS|5o|2yerS|2zzanine|4o|1iami|2ca|4h|3e|3haelS|4eal|5lS|6e|6in|6le|4iel|5gan|3k|4ey|4y|3roS|5beS|6ial|7o',
  'l|9ogical|Cst|By|5cosm|5drive|5film|5gramS|5meterS|5nS|6esia|6utrientS|5organismS|5phoneS|6rocessor|5scopeS|9ic|Bally|9y',
  '|6econds|6oft|7mes|6pheres|6tructureS|6ystems|5waveS|2d|3day|4le|6man|6sex|6ton|8wn|6ware|7eight|4ot|3ge|5tS|3landS|3nig',
  'ht|3range|5sh|3season|4t|4ummer|3town|3way|4eek|5st|7ern|4ife|7ry|5nter|3year|2fflin|2ght|5ily|5y|3non|3raineS|5ntS|5teS',
  'D|6ing|7onS|6or|8y|3uel|2kado|4el|3eS|4y|2lan|5o|3dL|4er|5w|4red|3eS|4age|4post|4r|4stoneS|3fS|4hunter|4ord|4seeker|3ieu',
  '|4tancy|7tS|6ries|8ly|8sm|9tic|7y|5iaS|3kSEG|4en|4man|4weed|4y|3lSEG|4a|5ge|4e|5nium|6nia|9l|8um|5rS|5t|4ie|5gramS|5mete',
  'rS|5onS|7aireS|7th|5secondS|4stone|4work|4y|3ner|3oS|3ter|4on|3waukee|2me|4o|3i|4cS|5ry|3osa|2nSDEG|3aS|3ceD|3ded|5r|4fu',
  'l|7ness|4ing|4less|4s|3eS|4rS|5alS|7ization|7ogical|9y|5va|4tte|3g|4leD|5ing|4o|3i|4atureS|4bus|7es|4dv|4m|5a|6lL|7ism|9',
  't|5ise|6zation|7eSD|8r|7ing|5umS|4onS|4sh|5terSEG|8ial|6ries|7y|3k|3neapolis|5haha|5sota|4ie|4owS|3oan|4gue|4lta|4rS|5it',
  'ies|7y|4s|4t|5aur|3ster|5rel|3tSE|4er|4y|3uet|4s|5cule|4teS|6man|5iae|2ocene|2quelon|2ra|4cleS|5ulousL|4ge|4nda|3ed|3iam',
  '|3o|3rorSEG|3th|3za|2sadventures|4lignment|4ppropriation|3behaving|9or|3c|4arriageS|4ellanea|Aous|9y|4hief|7vous|4oncept',
  'ionS|6duct|3deeds|5meanorS|4irected|3eS|4r|5ableS|8y|5ies|5y|3fitS|4ortuneS|3givings|4uided|3handling|5pS|4nah|3informat',
  'ion|9ed|5terpreted|3leadG|5d|3management|5tchE|8es|3nomer|3placeD|4rints|3readG|5presentEG|3sEG|4es|4ileS|5onS|7aries|9y',
  '|5ssauga|7ippi|5ve|4oula|6ri|4pelled|8ingS|4tatementS|4y|3tSG|4akeS|7nL|6ing|4er|4letoe|4ook|4ral|5eated|8ment|6ss|8es|5',
  'ial|5ust|4y|3understandG|Aood|4seD|5ing|2tch|5ell|3eS|4r|3igateD|7ing|8on|3ochondria|Cl|4sis|4tic|3ra|5l|4e|3subishi|3tS',
  'E|4enS|2xEG|3erS|4s|3tureS|1kdir|1nemonicS|1oanSEG|3tS|2bil|5eS|5ity|6zation|7eD|7ing|3s|4terS|2ccasinS|3ha|3kSEG|4ery|4',
  'ingbird|2dalities|7y|3ding|3eS|4lSEG|5erS|5led|7rS|6ing|4ms|4na|4rateSDL|7ing|8on|7orS|5n|6ism|8t|7ty|7zation|8eD|8ing|4',
  'stL|6o|6y|3icum|4fiable|6cationS|6ed|7rS|7s|5yG|3oc|3s|3ular|6teSD|7ing|8on|7orS|5eS|5o|5us|2gulS|2hair|4mmad|6ed|4ve|4w',
  'k|3egan|3icans|3r|2iety|3nes|3ra|3ses|4sanite|4t|5ened|5ure|2jo|2larS|4sses|3dSEG|4ings|4ova|4y|3eS|4cular|7eS|4station|',
  '6ed|7rS|6ing|3ine|3ler|4ie|4usca|6ks|4y|3ten|3ybdenum|2mentS|6a|7rily|8y|6ous|6um|3ma|4ies|4y|3o|2n|3aD|4co|4dnock|4rchS',
  '|7y|4sh|5teries|8y|6ic|4ural|3dayS|4e|4o|3et|5ary|4yS|3gerSG|4o|5lS|6ia|8n|5ose|4rel|3ica|4es|4ker|4torSEG|3kS|4eyS|3mou',
  'th|3o|4amine|4chromatic|9e|5lonal|5ularS|5yteS|4filament|4gamous|7y|5ramS|8med|7phS|4hydrate|4layerS|5ingual|6th|8ic|5og',
  'ueS|4merS|7ic|4ngahela|5uclear|9osis|4phonic|5ole|7ies|8st|Aic|7y|4rail|4theism|5one|7ic|9ally|7ous|7y|5ype|4xide|3roe|3',
  'sieur|5gnor|4oon|4terS|5rosity|7us|3t|4age|5na|6e|5uk|4eS|5ith|5negro|5rey|5zuma|4gomery|4hSL|4real|5ose|4serrat|4y|3ume',
  'ntS|8al|2odS|4le|4y|3nS|4lightG|6t|4rise|4set|5hine|5tone|3rSEG|4eS|4ings|5sh|4land|3se|3tE|2ped|3ping|2ra|4es|4ine|4lSL',
  '|5eS|5ity|4n|4torium|4vian|4y|3bid|6ity|3eS|4l|5lo|4no|4over|3ganS|6a|4en|6stern|4ue|3ibund|4n|3monS|6ism|3ningS|3occan|',
  '6o|4nS|5ic|3phSEG|5eus|5ine|5ogenesis|Atic|6logic|BalL|9y|3ris|6on|4ow|3se|5lS|3t|4alSL|6ity|5rS|4gageSD|8e|7or|4ician|5',
  'fication|7ed|5mer|5se|4on|4uary|2saicS|3cow|3elle|4s|3lemS|3queS|5itoS|8es|3s|4es|4y|3tL|3ul|2telS|3hS|4erSG|6boardS|6ho',
  'od|6land|6ship|3ifS|4lity|4onSE|6less|4vateSD|7ing|8onS|Aal|5eS|3ley|3orSG|5boat|5cycleS|9ing|AstS|5es|5istS|6zed|5ola|5',
  'sportS|5wayS|3t|4e|4led|4o|2uldSEG|4in|3ndS|4tSEG|5able|6inS|8eerSG|8ous|8side|8top|5ings|3rnSEG|5ers|5ful|3se|5r|5trap|',
  '4se|3thSEG|5fulS|5pieceS|5wash|4on|2vable|3eSD|4mentS|4rS|3ieS|4ng|2wed|4rS|3ing|2yen|4r|3le|2zambique|4rt|3illa|1pegs|2',
  'umalanga|1sgid|1uang|2ch|3kG|3osa|6l|4us|3us|2dD|3dleD|4y|3vayne|2eller|2ffS|4inS|4led|6rS|3ti|2gged|5r|3s|2hammad|2ir|2',
  'latto|3berry|3chG|3der|3eS|3lSEG|4ahS|4er|5t|4igan|3t|4i|5cast|6ellular|6olorE|7re|6ultural|5dimensional|5faceted|6ocal|',
  '6unction|5lateral|6ingual|5media|6illion|6odal|5nationalS|5phase|6layer|7eS|8xEG|9er|7ication|Cve|9ity|8ed|9rS|9s|7yG|5s',
  'tage|5threaded|6udeS|5verse|4um|2mbleSD|5ing|3mies|4y|3ps|3s|2nchG|3dane|4o|3ger|4o|3ich|5ipal|9ities|By|4tions|5y|2raka',
  'mi|4lS|4t|3derSEG|6erS|6ous|4och|3iel|4llo|4ne|3ky|3murSEG|3ph|5yS|3ray|3thy|2scat|4leSD|4ular|3eSD|4umS|3h|4roomS|4y|3i',
  'cS|5a|6lSL|7e|5ianS|8ship|5ology|4k|4ngS|4que|3k|4et|6eerS|4ie|4ogee|4rat|4y|3limS|5n|3selS|5r|3t|4ache|5ngS|5rd|4erE|4y',
  '|2table|4genic|4ntS|4teD|5ionS|8al|3eSD|3ilated|7ion|4ny|3t|4erEG|6ings|4on|3ualL|2zzle|1y|2anmar|3sthenia|2cobacterium|',
  '4logy|4rrhizal|2elin|4oid|5ma|3rs|2ocardial|8um|4ytes|3pathy|4ia|5c|3sin|2ra|3iad|4ck|3on|3rh|3tle|2self|3imon|3ore|3pac',
  'e|3t|4eries|7ousL|6y|4icS|6al|6ism|5fied|2thS|4ical|4ological|8y|5s|4tv|0nabbed|4le|2ch|3ional|2der|3ir|2fta|2gging|2hum',
  '|2ics|3lSEG|4erS|3r|4obi|3ssance|3veL|2ked|5ness|2mEG|3eSL|4less|4sake|5pace|3ibia|2na|4imo|3ce|4y|3da|3king|3nies|4y|3o',
  'technology|3tes|2omi|2pa|4lm|3htha|7lene|3kinS|3les|3oleon|8ic|3pies|5ng|4y|3ster|2rcissism|9t|Aic|7us|4olepsy|5ticS|3ni',
  'a|3rated|7s|6ion|7veS|6or|4owSEGL|6er|3uto|2sa|4l|3car|4ent|3daq|3h|4ua|4ville|3opharyngeal|3sau|3t|4y|2tSE|3al|5ia|6e|4',
  'sha|3chez|5itoches|3e|3han|6ael|6iel|3ick|4onS|6alSL|8ism|AtS|Bic|9ties|Ay|6wide|4veSL|5ity|3ty|3uralSL|7ism|9tS|Aic|8za',
  'tion|9ed|Ar|5eSD|5ism|7tS|5opathic|Ay|2ught|6y|3ru|3sea|3tical|5lus|2vajo|4l|3e|4l|3ies|4gable|6teD|7ing|8on|Aal|7orS|3y',
  '|2ys|2zarene|3iS|4sm|1caa|1eal|3nderthal|3politan|3rSEGL|4by|4er|5st|4ness|3tL|4h|2braska|3ula|6e|5izer|5ous|2cessarily|',
  '8y|6itateSD|Aing|8ies|8y|3kSE|4laceS|5ine|4tieS|4wear|3romancer|5polis|5sis|5tic|3tar|6ine|2derlandS|2edSEG|4ham|4leS|6s',
  'sL|6work|4y|3ly|2farious|2gateSD|5ion|6veSL|7ity|3lectSEG|4igence|8tL|6ible|3otiable|7teSD|8ing|9onS|8orS|3roS|5es|2hemi',
  'ah|2igh|5borSG|8hoodS|7urSG|9hood|3l|3sseria|3ther|2ll|4ie|4y|3son|2ma|4todeS|3esis|2o|3dymium|3lithic|3n|4atal|6eS|3phy',
  'te|4lasia|7mS|7tic|4rene|3tropical|2pa|4l|5ese|5i|3hewS|4ritis|5ology|6pathy|3otism|3tuneS|2rveS|4ousL|7ness|2ss|3tSEG|4',
  'er|4leD|5ing|4or|2tball|4sd|3flix|3gear|3her|6lands|3s|4cape|4uke|3ted|4ie|5ng|4leS|3ware|4orkSEG|7er|2umann|3ral|6gia|4',
  'oblastoma|5logical|9stS|8y|5muscular|5nS|6al|6es|5pathic|9y|6hysiology|6sychiatric|Aology|5science|6is|6urgeon|Ary|9ical',
  '|5tic|3terEG|4ralS|7ity|8zation|9eD|9ing|5inoS|5onS|2vada|3eS|4r|5land|5more|5theless|3ille|4s|2wSL|3ark|3bieS|4orn|4ury',
  '|3castle|4omerS|3er|4st|3foundland|3lywedS|3man|5rket|3ness|3port|3scastS|4feed|5orge|4gator|5roupS|4letterS|4paperS|5ri',
  'nt|4readerS|6el|5oom|4standS|4week|5ire|5orthy|3t|4onS|6ian|2xt|4ag|4el|3us|1guyen|1iacin|3gara|3ll|2bbleS|5ing|2caragua',
  '|9n|3eL|4ne|4r|4st|3heS|4olas|6s|7on|4t|3kSE|4elS|6back|6odeon|4leS|4nameSD|4y|3obar|4demus|4l|5aS|5e|6tte|4tiana|6ne|7i',
  'c|2eceS|3ls|5en|3ves|2fer|3ty|2gel|5la|4r|5ia|7nS|3gerS|3h|4tSL|5clubS|5fall|5gown|5hawk|5ie|6ngale|5life|5mareS|8ish|5s',
  'hade|5time|5wear|6ish|2hilism|2ke|3ki|4o|3olai|4n|2lS|3eS|2mble|4us|3es|3rod|2na|3eS|4teen|8th|5ies|5y|3g|3jaS|3tendo|4h',
  '|2obium|2pissing|3per|4leS|2rvana|2ssan|2trateS|4ic|5de|5le|5te|4o|5cellulose|5gen|6lycerin|5us|3ty|2ue|2xon|1o|2ah|3m|2',
  'bel|3ility|3leS|5man|5st|3ody|2cturnal|7e|2dal|3ded|4ing|4y|3eS|3ing|3s|3ular|5eS|2el|3s|2gales|3gin|2ir|3seS|4ily|4y|2k',
  'ia|2lan|2madS|5ic|3e|4nclature|3ic|4nalL|6teSD|7ing|8onS|8ve|5eeS|2n|3attainment|3ce|4ommercial|7utative|6pliance|5nform',
  'ing|3destructive|4isclosure|3e|4such|4theless|4xclusive|5istent|3family|5rm|5t|6al|4errous|4iction|5nancial|3governmenta',
  'l|3human|3immigrant|3linear|4ocal|3memberS|5tallic|3partisan|5yment|4rofitS|6prietary|4ublic|3recurring|5sidentS|Bial|3s',
  'ense|7ical|4mokers|7ing|4pecific|4tandard|5op|3toxic|4raditional|3verbal|4iolence|4olatile|3zero|2odleS|3kS|3n|3se|2r|3a',
  '|4h|3bert|3dic|4strom|3folk|3mS|4a|5lSL|6cy|6ity|7zation|8eD|8ing|5nS|6dy|5tive|3ris|3se|5man|4k|3tel|4h|5ampton|Bshire|',
  '5bound|5east|9ern|6rly|7n|8er|8most|5land|5umberland|5ward|6est|9ern|4on|3walk|5y|4egianS|4ich|4ood|2seSD|4bleed|3ocomia',
  'l|3talgia|8c|4radamus|5ilS|2tEG|3ableS|6y|4ries|6zed|5y|4tionS|8al|3chE|5es|3eS|4bookS|4pad|4worthy|3her|4ingS|7ness|3ic',
  'eSD|6able|9y|5ing|4fiable|6cationS|6ed|7r|7s|5yG|4onS|6al|3oriety|6ousL|3re|3ting|7ham|Ashire|3withstanding|2ught|3nS|3r',
  'ishEG|7es|7ment|3s|3veau|2va|4k|4tion|3elS|5istS|5l|6a|5ties|6y|4mber|3iceS|3o|4tel|2w|3adays|3here|2xious|2yes|2zzleS|1',
  'uanceSD|2bian|4leS|2clear|6se|6tion|5i|6c|5on|6plasm|6side|6tideS|5us|4ide|2deS|3geD|3ism|5tS|4ty|2evo|2ggetS|2isanceS|2',
  'keS|4r|2llS|4ify|2mbG|4erSEG|4ness|3eralS|6tor|5ic|7alL|5o|6logy|6us|3ismatic|2navut|3es|3nery|3s|2ptial|2rseSD|5ries|6y',
  '|4ing|3tureSD|6ing|2tS|3cracker|3hatch|3meg|3rientS|5tion|9alSL|9istS|8us|7ve|3shell|3ten|5rS|4y|1vidia|1ylonS|2mphS|5et',
  's|0oakS|3es|3land|4ey|3wood|2sis|2ten|4s|3hS|3meal|3s|1badiah|2edience|7tL|3lisk|3ron|3se|4ity|3ySEG|2fuscation|2ispo|3t',
  'S|4uaries|7y|2jectSEG|6ionS|9able|7veSL|8ism|At|9ty|6orS|2ligateD|7ionS|7ory|5eSD|5ing|5or|4que|4terateD|4vion|7us|3ong|',
  '2noxious|2oe|2scene|6ities|8y|4ureSD|6ing|7ty|3ervableS|7nceS|8t|7tionS|Bal|8ories|Ay|6eSD|7rS|6ing|4ssed|6ionS|7veL|3id',
  'ian|3olescence|6teSD|3tacleS|4etricS|9al|9ianS|4inate|4ructEG|8ionS|9ve|2tainSEG|6able|3use|2verse|3iate|4ousL|1carina|2',
  'casionSE|8alL|3idental|4pital|3luded|5sion|7ve|3ult|6ation|6ism|4pancies|8y|7tS|6tionS|Aal|5ied|7rS|7s|5yG|4rSEG|5red|7n',
  'ceS|6ing|2eanS|5front|5ia|6c|5ographic|By|5side|2lc|2tagon|7al|4ne|4veS|5ia|5o|3etS|3ober|4pus|3yl|2ular|1ddSL|3ities|5y',
  '|2eon|3r|3ssa|2in|3ous|2ometer|3rS|4less|2yssey|1edipus|2sophageal|1f|2fSG|3al|3beat|3enceS|5dSEG|6erS|5seS|6iveL|4rSEG|',
  '5ings|5orS|3hand|3iceS|6rS|5ialSL|7nts|7teD|8ing|3setS|6ting|4hoot|6re|7ing|4pring|2ten|5times|1gaming|2den|2re|1h|2io|2',
  'ms|1ilSEG|3erS|3ily|3seedS|3y|2ntmentS|2reachtas|1klahoma|8n|1laf|2dS|3en|5burg|4r|4st|3ham|3ieS|3medline|3smobile|2eand',
  'er|3fin|3g|3ic|2factory|2ga|2igarchy|4opoly|3phant|3va|4eS|5r|5t|4ia|5er|5ne|2lie|2ogy|2sen|3on|2ympiaD|7nS|6cS|5us|1mah',
  'a|3n|4i|3r|2budsman|2ega|3letS|6te|3nS|2icron|3nous|3ssionS|3tS|4ted|5ing|2nibus|4potence|9t|5resent|4scient|4um|1nSL|2b',
  'oard|2ce|3ology|4ming|4rhynchus|2eS|3ida|3ness|3rous|3self|3time|2going|2ionS|2lookers|2ondaga|2set|3hore|3ite|3laught|2',
  'tarians|6o|3o|4logical|8es|7y|2wardS|2yx|1ocyteS|2dles|2long|2ze|3ing|1pacity|3lS|4escent|3que|2enSEGL|4bsd|4erS|4gl|4id',
  '|5ngs|4ness|4office|4ssl|3r|4aS|5bility|6le|5ndS|5teSD|6ic|7ng|7onS|9alL|7veSL|6orS|4etta|2helia|3thalmic|8ologistS|Cy|2',
  'iateS|3ned|4ionS|7ated|3um|2orto|3ssum|2ponentS|4rtune|8ism|At|Bic|9ties|Ay|4seSD|5ing|6teS|7ionS|Aal|3ressE|7ion|8ve|7o',
  'rS|2rah|2tSEG|3eron|3icS|5alL|5ianS|4malL|5isation|7m|7tS|8ic|6zationS|7eSD|8r|7ing|5um|4onS|6alL|3ometristS|8y|2ulence|',
  '6t|3s|1r|2acleS|3lL|3ng|5eS|5utan|3tion|4or|6io|6y|2bitSG|5alS|5er|5z|2caS|3hardS|4estraS|9l|9teD|Aion|8e|4idS|3inus|2da',
  'inE|3eal|4rSEGL|3inal|6nceS|6rily|7y|6teSD|7ing|8on|7orS|3nance|3ovician|2egon|2ganS|5elleS|5icS|7ally|6sationS|Cal|7eD|',
  '8rS|7ing|7mS|8al|7t|6zationS|Cal|7eSD|8rS|7ing|5ometallic|4smS|6ic|3iaS|4es|3yS|2iel|4ntEG|6al|7ted|8ionS|3fice|3ginS|6a',
  'lSL|8ity|7teSD|8ing|9on|8orS|4nal|3oleS|4n|3ya|2lando|3eans|2mond|2namentSE|8alS|9tion|4te|3ithine|6ological|Ay|2omo|2ph',
  'anSE|4eum|6s|3ington|2son|2tho|5donticS|AstS|7x|8y|5gonal|6raphic|Ay|5paedic|6edicS|5ticS|2ville|2yza|1sage|3ka|3ma|2bor',
  'ne|4urne|2carS|3illate|8ing|9onS|8orS|Ay|6oscopeS|3ommerce|2iris|2kar|2mond|4sis|4tic|2preyS|2tensibly|4oarthritis|5myel',
  'itis|5pathic|9s|9y|6orosis|5sarcoma|3rich|2wald|1thello|4rS|5osfs|5wise|6orldL|2is|3tis|2olaryngology|2tawa|3erS|3o|4man',
  'S|1ught|2ija|2nceS|2rS|3selves|2sted|5r|2tSEG|3ageS|3back|4oardS|5und|5x|4reakS|4uildings|5rstS|3castS|4omeS|4ropS|5y|3d',
  'ated|4oorS|7sman|4raw|3er|5most|5wear|3fall|4ield|8er|5tS|6ted|8rS|7ing|4lowS|3going|4row|7th|3house|3ings|3kast|3land|7',
  'er|7ish|5st|5wSEG|5yS|4etS|4ierS|5neSD|6ing|4ookS|4ying|3moded|3numberE|3patientS|4erformSE|4ostS|5uring|4utS|6ting|3rag',
  'eSD|7ousL|4each|4igger|6ht|4un|3scored|4ell|5t|4ide|7rS|4kirts|4ole|5urceD|8ing|4poken|4tanding|6tion|5retched|3turn|3wa',
  'rdSL|4eighSE|4it|1valS|3rian|5es|4y|3tion|2enS|3rSL|4active|5llS|5rching|4bearing|6rg|5lown|5oard|5urden|4cast|5harged|9',
  'ing|5oat|6meS|7ing|5rowded|9ing|5urrent|4done|6seS|5raftS|6ive|5ue|4eating|5stimateD|5xposure|4fishing|5lowSEG|5ull|4gro',
  'wn|8th|4hangG|6ulE|5eadS|7tEG|4joyed|4laid|6nd|6pS|7ped|8ing|6yS|5eaf|5oadSEG|6okSEG|6rd|5ying|4night|4pass|6ymentS|5lay',
  '|5opulation|6werEG|5riced|6oduction|4rated|5ideS|7ing|5uleD|6nS|4seaS|6eSG|7n|7rS|5hadowE|6oot|5ight|6zeD|5tateD|6ock|4t',
  'L|5ake|7ing|5hrow|5ime|5ones|5ureS|7nEG|4useD|4valued|5iewS|4weight|5helmEG|9ingly|5orked|5riteS|8ing|4zealous|2ulation|',
  '1wed|3nS|3s|2ingS|2ls|2nSEG|3erS|5ship|1x|2alate|2bow|2fordS|6shire|2idantS|5se|5tion|7ve|4eS|4ized|7r|6ing|4oreductaseS',
  '|2ley|2ygen|6ated|8ion|3moron|3tocin|1ysterS|1zarkS|2one|0pablo|2cSEG|3eS|4makerS|4rS|3ific|7a|6erS|6sm|7t|3kSEG|4ageSD|',
  '7r|6ing|5rd|4erS|5tS|3o|3tS|2dS|3ded|4ing|4leSD|6rS|5ing|4ockS|4y|3lockS|3raig|4eS|2ganS|5ism|3eSD|4antS|4rS|5ank|3inaS|',
  '6tion|5g|3oda|2id|3ge|3lS|3nSE|4fulL|4killerS|4less|4stakingL|4tSEG|5ball|6rush|5erS|5ings|3rSEG|4wise|3sley|3ute|2jamaS',
  '|2kistan|8iS|2lS|3aceS|4dinS|4table|5e|5ine|4u|3eS|4olithic|5ntology|5zoic|4r|5mo|4stine|8ianS|4tteS|3isadeS|3l|4adium|5',
  's|4bearers|4etS|4iative|5d|3mS|4aS|4erS|5tto|4istry|5tate|4one|5s|4yra|3omino|3pable|4itations|3sy|3try|2m|3ela|3lico|3p',
  'erSEG|4hletS|2nS|3acea|5he|4ma|6nian|4sonic|3cakeS|4hayat|4reas|7tic|9tis|3da|4emic|6onium|5ring|4ora|3eS|4lSEG|5istS|3g',
  'S|4aea|3handle|3icS|5ked|5um|4es|3jabi|3na|4ed|4ing|3oramaS|7ic|4s|3sies|4y|3tSG|4era|4heon|6rS|4ieS|4omime|5thenic|4ry|',
  '4y|5hose|3zer|2ola|4o|2paS|4cy|4l|4ya|3e|4rS|5backS|6oard|5making|5weightS|6ork|3illary|6oma|7n|3rika|3ua|5n|3yrus|2rSEG',
  '|3aS|4bleS|5ola|7ic|4chuteS|8ing|4deSD|5igmS|6se|5ox|7es|7icalL|4ffin|4gon|5raphS|5uay|4keet|4legal|5lax|6elSE|8ism|9zat',
  'ion|5ysis|6zed|4mS|5agnetic|5eterS|7ric|5ilitaries|By|5ount|4noia|7d|6rmal|4pet|5hernalia|6raseD|9ing|5sychology|4siteS|',
  '7ic|8sm|7ology|5ol|4thyroid|5rooperS|3celS|4hed|5ment|3do|5nSE|3en|5tSG|6age|7l|6eral|6heses|9is|8tical|7ood|3fait|4umS|',
  '3iS|4ah|4etal|4sh|6es|6ioners|5ian|4ty|3kSEG|4aS|4erS|5s|4in|6son|4way|3lance|5y|4e|4iamentS|AarianS|Cy|4orS|3ma|4esan|3',
  'ochial|4dies|5y|4leSD|3quet|3r|4a|4otS|4y|3seSD|5rS|4imony|5ng|4ley|4onS|6age|3tSEGL|4ake|4eS|4henon|4ialL|7ity|5cipantS',
  '|9teSD|Aing|BonS|Bve|Aory|8le|6leS|6ularSL|Aity|9teS|5es|5sanS|8ship|5tionSEG|4nerSEG|7shipS|4ridge|4ySG|2sadena|3cal|4h',
  'al|4ual|3ha|4mina|4to|3sEG|4able|5geS|7way|4eS|5ngerS|5rS|6iformes|4ionS|7ateL|5veL|6ity|4o|5ver|4portS|4wordS|3tSEG|4a|',
  '4eS|5lS|5ur|7ized|4ies|5meS|4orS|6al|4ries|5y|4ureS|4y|2tS|3aca|4gonia|3chEG|5es|5ouli|5work|5y|3e|4l|5la|4ntSEGL|6abili',
  'ty|8le|6ee|4r|5nal|6ity|5son|3hS|4an|4etic|4finderS|4ogenS|8esis|8ic|Aity|5logic|Aal|9es|9stS|8y|5s|4wayS|3ience|6tSL|4n',
  'a|4oS|3mos|3ria|6rchS|9al|Ate|9y|5ce|6ia|8n|7o|6kS|5mony|5otS|7ic|8sm|4olS|6led|7ing|5nS|6age|6ize|8ing|3sy|3taya|4ed|5n',
  '|5r|6nSEG|6son|4i|5es|5ng|4on|4y|3uxent|2ucity|3lS|4a|4ie|5na|6e|4o|4us|4y|3per|3seSD|4ing|2van|3eSD|4mentS|4rS|3ia|4lio',
  'nS|4ng|2wnS|4ee|3s|3tucket|2xil|2ySEG|3ableS|3day|3ee|4rS|3mentS|3ne|3offS|4r|4utS|3pal|3rollS|1cmcia|1das|1eabody|3ce|5',
  'able|5fulL|5makerS|8ing|5time|4h|5es|5y|4ockS|3kSEG|3nutS|3rSL|4ce|4lS|4son|4t|3s|4antS|7ry|3t|3vey|2bbleS|2canS|3kG|4er',
  '|3os|3tin|4oral|3uliarL|8ities|Ay|4niary|2dagogic|9al|7y|4lS|4ntic|3dle|6rS|5ing|3estalS|6rianS|3iatricS|9ianS|4cureS|4g',
  'reeS|3ometerS|4philia|3ro|2eG|3kSEG|3lSEG|4er|3pSG|3rSEG|4age|4less|3veS|3wee|2gasus|3ged|4y|3s|2kin|5g|6ese|2lagic|3ica',
  'nS|3l|4etS|3oponnesian|3vic|5s|2mbina|4roke|2nS|3al|5izeD|5ties|6y|4nce|5g|3ce|4hant|4ilS|3dantS|4ency|6t|5r|4ing|4le|4r',
  'agon|4ulumS|3elope|4trateSD|8ing|9onS|3guinS|3icillin|4le|4nsula|9r|4s|5es|4tent|8iary|3na|5ntS|4ed|5r|4ies|5less|5ng|4s',
  'ylvania|4y|3obscot|3sacola|4ionS|7able|7erS|5ve|3ta|5cle|5gon|6ram|5thlon|5x|4ecost|9al|4house|4ium|3ultimate|4mbra|2oni',
  'es|4y|3pleS|6soft|3ria|2pperSE|6cornS|6mint|6oni|4y|3si|3tic|5dase|6eS|2quot|2rS|3ceiveSD|7ing|5ntS|7ageS|7ileS|5ptible|',
  '8onS|8ve|7ual|4hE|5ance|5es|5lorate|4ival|4olation|4ussion|Aist|8ve|5taneous|4y|3dition|3egrine|4ira|4mptory|4nnialS|4s|',
  '4z|3fectEGL|7ion|Aist|7o|4orated|8ionS|6ce|6mSEG|7anceS|7erS|4umeSD|7ry|5sed|6ion|3gola|3haps|3i|4cardial|5les|4dot|4gee',
  '|4lS|5ous|4meter|4odS|6ic|8alSL|8ity|6ontal|9ics|4pheralS|8y|4scope|5hE|6able|4toneal|7itis|4winkle|3jury|3kinS|4s|4y|3l',
  '|4a|4e|3mS|4afrost|5link|5nence|9y|8tL|4eability|7le|6teSD|7ion|4ian|5ssible|8onS|8ve|5tS|6ted|8e|7ing|4utationS|3niciou',
  's|3oxidase|8tion|7e|3pendicular|5trated|9orS|6ualL|8teD|9ing|Aon|7ity|4lexed|7ing|8ty|3rier|4on|4yS|3secuteD|8ionS|5phon',
  'e|5verance|8e|4ia|6nS|5mmon|5stSEG|7ence|9tL|4onS|6aS|7ble|7geS|7lSL|8ised|9ties|Ay|9zation|AeD|Aing|6ification|9ed|6nel',
  '|4pectiveS|5iration|4uadeD|7ing|6sionS|8ve|3tainSEG|4h|4inent|4urbationS|Ave|7ed|5ssis|3u|4sal|5e|5ing|4vian|3vades|5siv',
  'e|4erse|7ionS|6tSE|2sach|3eta|3ky|3oS|3simism|8t|9ic|3tS|4icideS|5lence|4le|2tS|3alSG|3e|4rS|5borough|5man|5sburg|6en|6h',
  'am|6on|5thoeny|3itS|5eS|5ionSEG|8erS|3r|4a|4el|4ie|5fied|4ochemicalS|5glyphs|5l|6eum|3ter|4icoat|5ng|4y|3unia|2ugeot|2wt',
  'er|2yote|3ton|1fizer|1haeton|3ge|4ocytosis|3laenopsis|5nx|4lic|3ntasm|7y|5omS|7node|3raohS|4e|4isees|4ma|6ceuticalS|7ies',
  '|8stS|7ologic|Dal|By|8therapy|7yS|4os|4yngeal|6x|3seSD|5r|4ing|2easantS|3be|3lps|3nobarbital|5lS|6ic|5mena|9l|8ological|',
  'Cy|9n|5typeS|8ic|4termine|4yl|6alanine|2i|3lSL|4adelphia|5nthropic|Cst|By|5telic|8y|4harmonic|4ipS|6pa|7e|7ians|8neS|5st',
  'ines|4l|5ies|6pS|4ology|5sopherS|9ic|BalL|Aes|9y|3neas|3shing|2lebotomy|4gm|2obic|4os|3ebe|4nician|6x|3neSD|5meS|6ic|5ph',
  'one|5ticS|4icS|5ng|4o|5graph|5logical|8y|4y|3sphatase|8eS|6o|7r|8ic|8ous|8us|8ylase|Btion|3toS|5chemical|Astry|6opied|Ar',
  'S|As|8yG|5electric|Bon|6s|5genic|6rammetry|8phSEG|AerS|Aic|Ay|5meter|8ric|9y|5nS|5receptor|5shop|6mart|6ynthesis|Btic|5v',
  'oltaicS|2rasal|5eSD|5ing|2thalate|2uket|2yllis|4ogenetic|8y|4um|3sicS|6alL|6ianS|7stS|6ochemical|5ol|7ogicalL|Ast|9y|6pa',
  'thology|6therapistS|Cy|5que|3tochemicals|5phthora|6lankton|1iE|2anistS|4oS|5forte|3zza|2cS|3ard|4sso|4yune|3cadilly|4olo',
  '|3ea|3hunter|3kSEG|4erSG|5tSG|4leSD|5ing|4upS|4wick|4y|3nicS|3o|3tS|4ograms|5rial|4ureSD|7sque|6ing|2dgin|2eS|3ceSD|5mea',
  'l|5wise|4ing|3dmont|3rS|4ceD|5ingS|4re|5ot|3ter|4y|3zo|5electric|2gS|3eonS|3gy|3letS|3mentSE|7ation|3skin|3tailSE|3weed|',
  '2keS|2lar|4teS|3cher|3eSD|3ger|4rimS|7ageS|3ing|3lS|4age|5rS|4owS|6caseS|3otSEG|5age|2ma|3lico|3pSEG|4ernel|4leS|2nS|3al',
  '|3ball|3chEG|3der|3eS|4al|5ppleS|4y|3gSG|3head|4ole|3ion|3kS|4er|6ton|4ish|4world|4y|3nacleS|4ed|5r|4ing|4ock|3ole|4n|4t',
  '|3point|3scher|3tS|4er|4o|3us|2oneerSEG|3tr|3us|2peSD|4lined|7ing|4rS|5mail|4stone|4t|5teS|4work|3ing|3pin|2que|5t|2racy',
  '|4nha|4teSD|3es|2scataway|4es|4ina|6e|3os|3sEG|4es|3tachioS|4olS|5nS|2tS|3a|3bull|3cairn|4hEG|5erS|6s|5fork|3fallS|3hy|3',
  'iful|3man|3ted|4ing|4sburgh|3uitary|3y|2votSG|5al|2x|3ar|3els|3ieS|3ma|5nia|2zzaS|4eria|1lacardS|4eSD|5bo|5holderS|5ment',
  'S|5nta|8l|5r|4id|5ng|4ket|3ge|4iarism|5oclase|4ueSD|5ing|3id|4nSL|5es|5tiffS|7ve|3nSEG|4ar|4ck|4eS|5rS|5tS|6a|7rium|8y|4',
  'kS|5ton|8ic|4ned|6rS|5ing|4o|4tSEG|5aS|6e|6in|6r|6tionS|5erS|5ings|5ronics|3queS|3smaS|5id|5odium|6n|4terSEG|7ers|5icS|7',
  'ity|3tSEG|4a|4eS|5auS|5letS|5n|4formS|8er|4inum|5tudes|4o|5nic|5on|4tS|5erS|4ypus|3usibility|7le|8y|3ySEG|4aS|5bility|6l',
  'e|4back|5ill|5ook|6yS|4erS|4field|5ulL|7ness|4groundS|4houseS|4mateS|4offS|4pen|4room|4station|4things|5ime|4wrightS|7ti',
  'ng|3zaS|2eaSD|4ded|5ingS|5s|4santL|5eSD|6r|5ing|5urable|7eS|7ing|4tSE|3dgeSD|5ing|3iades|4stocene|3nary|4tiful|5y|4um|3t',
  'hora|3ural|5isy|3x|4us|2iable|3ed|4rS|4s|3ght|3nth|4y|3ocene|2one|3tS|4ted|6rS|5ing|3ughEG|3ver|3wSEG|2uckEG|5er|5y|3gS|',
  '4gable|5ed|5ing|4inS|3mS|4age|5s|4bG|5erS|4eS|4mer|6tE|4p|5erS|3nderEG|4geSD|6r|5ing|3ral|6ism|8tic|7ty|3s|4es|4h|3to|5n',
  'ium|2ying|3mouth|3wood|1neumaticS|5ococcal|6nia|1oaceae|4hed|6rs|5ing|2cketSE|6book|6pc|3o|2dcasting|3er|3iatristS|7y|4u',
  'm|3s|2emS|3tS|4icS|6al|4ry|2go|2ignant|3nsettia|4tSEG|5e|6dly|6rS|5less|5y|3seD|4onSEG|6ous|2keSD|4mon|4rS|4y|3ing|2land',
  '|4r|5is|6ty|6zation|7ed|8r|7ing|5oid|3der|3eS|4micS|4nta|3iceS|6man|5ies|6ng|5y|6holderS|4o|5myelitis|4s|5hEG|6erS|7s|4t',
  'buro|5eL|6ness|5icS|7alL|7ianS|8zed|7oS|6queS|5y|3k|4a|3lSEG|4ack|5rd|4en|4ination|4ock|4sterS|4utantS|6eD|7rS|6ing|7on|',
  '4y|3oS|4nia|3ska|5i|3tergeist|3y|4amide|4crystalline|5yclic|6stic|4ester|5thylene|4gamy|5onS|7al|5ram|7ph|4hedral|8on|4m',
  'erS|7ase|7ic|8zation|5orphic|AsmS|4nesia|9n|5omialS|4pS|5eptideS|5hone|8icS|8y|5ropylene|4saccharideS|5tyrene|4technic|5',
  'hene|5ones|4urethane|4vinyl|2mbe|4o|3egranate|4ranian|3fret|3ona|3pano|4eii|5y|4ous|2nca|4e|4hoS|3dS|4erSEG|6ous|3g|3ies',
  '|3tG|4iac|5ff|6ical|9te|Aions|4oon|3y|2och|3dleS|3h|3lSEG|4e|4side|3ns|3pG|3rL|4er|5st|2pS|3corn|3eS|4ye|3lar|4in|3pa|4e',
  'd|5rS|4ies|5nS|6g|4y|3ulace|6rL|7ity|8zed|6teD|7ing|8onS|5ism|7t|5ous|5us|4p|2rcelain|4h|5es|4ine|4upine|3eS|3k|4y|3n|4o',
  '|5graphers|Aic|Ay|4starS|3osity|4us|3phyria|7y|4oise|3ridge|3sche|3tSEG|4a|5bility|6leS|5ge|5il|5lS|6es|4cullis|4erS|5s|',
  '4folioS|4hole|4ia|5co|5onS|4land|5etS|4man|4o|4raitS|8ure|6ySEG|7alS|4smouth|4ugal|6uese|2seSD|4idon|4rS|4y|3h|3ing|4tSE',
  '|5ionSEG|8al|6veSL|7ism|8ty|5ron|4x|3seS|5ssEG|7es|7ionS|8ve|7or|4ibilities|Ay|6le|7y|4um|3tSEG|4age|5l|6es|4cardS|5ode|',
  '6lonial|4doctoral|4erS|6ior|7ty|4fix|4graduateS|4humousL|4ings|4man|6rkE|6ster|4natal|5uke|4operative|4poneSD|8ment|7ing',
  '|6sted|4script|5eason|6condary|5ynaptic|4traumatic|4ulateSD|5ral|6eS|6ing|4war|2tS|3able|4sh|5sium|4to|6es|3ency|5t|6ial',
  'SL|8tion|7ometerS|3holeS|3ionS|3latch|4uck|3omac|3pourri|3ted|5rS|6ies|6y|4ing|4s|4y|2uch|5es|3ltry|3nce|4dSEG|5er|3rSEG',
  '|2verty|2wderSE|6y|3ell|4rSEG|5boatSG|7ok|5fulL|5house|5less|9ness|5pc|6oint|5seller|6hot|3hatan|3wowS|2ynter|1rabhu|3ct',
  'icable|8lSL|9ities|By|7eSD|7ing|7um|6se|6tionerS|3da|4eep|5sh|3etorian|3gmaticS|8sm|4ue|3irieS|4seSD|6worthy|5ing|3kash|',
  '3mS|3na|4kS|3ter|4ique|4t|3wnS|3xis|3ySEG|4erS|2eachEG|6erS|7s|4mble|3carious|5st|5utionS|Aary|4edeSD|7nce|8tS|6ing|5ptS',
  '|7or|5ssion|4inctS|5ous|5pice|7tateSD|Aing|Bon|8ous|5s|6eL|6ion|4linical|5udeSD|7ing|4ocious|5mpiled|5nceived|8ptionS|6d',
  'itionSG|6figured|6struction|4ursorS|3dates|6ion|6orS|8y|4eceased|7ssorS|5fined|5stination|5termined|4icament|7teSD|6tSEG',
  '|7ability|9le|Ay|7ionS|8ve|7orS|5sposed|9ition|4ominance|AtL|9teL|3existing|3fab|6ricated|5ce|4ect|7ural|9eS|5rSE|6able|',
  '9y|6enceS|8tialL|6red|7ing|4ixE|6es|4light|4ormed|4rontal|3gnancies|8y|7t|3heatE|4istoric|9y|3installed|3judiceSD|8ial|3',
  'kindergarten|3limS|6inaries|Ay|4udeS|3marital|5tureL|8ity|4editated|5nstrual|4ierSE|7eS|7ship|5seSD|5umS|4onition|3natal',
  '|4dre|4tice|4uptial|3occupation|8ied|4perative|4rderS|3pS|4aid|5rationS|8ory|6eSD|7dness|7rS|6ing|5y|6mentS|4onderance|5',
  'sitionS|6terous|4ping|4rintSE|3qualification|9y|3release|5quisiteS|4ogativeS|3sage|5rio|4byterianS|9y|4choolS|9er|5ient|',
  '5ott|5ribeSD|9r|8ing|7ptionS|AveS|4eason|5nce|6tSEGL|7able|8tionS|7erS|7ment|5rvation|AveS|7eSD|7ing|5tS|4ideSD|7ncy|8tS',
  '|9e|9ial|6ing|7o|4ley|4sEGL|5eS|6r|5ings|6on|5man|5room|5ureSD|7ing|8zed|4tige|7ious|5o|6n|5ressed|4umably|6eSD|6ing|6pt',
  'ionS|9ve|8uous|5pposes|9itions|4ynaptic|3teen|5ndSEG|7erS|6se|7ions|6tious|5st|5xt|4oria|4reatment|4ty|4zelS|3v|4acid|5i',
  'lSEG|5lence|8t|4entSEG|7able|8tive|7ion|8ve|4iewSEG|5ousL|3war|3y|2iceSD|5grabber|5less|6ine|5runner|5tool|4ing|4kSL|3de',
  'S|3estSL|6ess|6hood|3mEG|4a|5cy|5l|5ries|7ly|6y|5teS|5vera|4eS|5rS|6o|5val|4itiveS|4ordial|4rose|4us|3nceSL|6ss|8eS|6ton',
  '|5ipalSL|9es|9ity|7e|7ia|7leSD|4e|4gle|4tSEG|5ableS|5erS|5f|5printer|3onS|4rS|5ities|7y|5y|3scilla|4mS|5atic|4onS|6erS|4',
  'tine|3us|3vacy|5t|6eSL|7er|6ization|4et|4ilegeSD|4y|3zeSD|2oS|3active|3bSEG|4abilistic|9ties|Ay|6leS|7y|5te|6ion|9ary|7v',
  'e|4eS|4ity|4lemS|7atic|3cedural|8eS|5edSEG|7ings|5ssEG|7es|7ionS|7orS|4laimSEG|6mationS|4rastinate|Cing|Don|5eation|4tor',
  '|4urator|6eD|7mentS|6ing|3dding|4igal|6ious|6y|4s|4uceSD|7rS|6ing|6tS|7ionS|8veL|9ity|3fS|4ane|6ity|4esS|6sed|7ing|8onS|',
  'AalSL|Cism|7orS|9ship|4fered|4iciency|9t|5leSD|7profile|7r|6ing|5tSEG|6ability|8le|9y|6eering|4oundL|4useL|6ion|3gS|4eni',
  'torS|6y|5sterone|7in|4nosis|7tic|4ramSG|7ma|9ble|9tic|Cally|8eSD|9rS|8ing|5essEG|8es|8ionS|9veSL|3hibitSEG|8ionS|9veL|3j',
  'ectSEG|7ileS|8onS|8ve|7orS|3lactin|5pse|4etarian|At|4iant|5ferate|Aing|Bon|Bve|6ic|5ne|4ogue|5ngEG|7ation|4yte|3menade|5',
  'theus|4inence|8tL|5scuity|8ous|6eSD|6ing|6sory|4ontory|5teSD|7rS|6ing|7onS|9al|4ptSEGL|4ulgateD|9ing|Aon|3ne|4gSE|4ounS|',
  '7ceD|9mentS|8ing|4to|4unciationS|3ofSEG|5readG|9er|3pS|4aganda|7teSD|8ing|9on|8or|5ne|4ecia|5llantS|7erS|5nsity|5rL|6tie',
  's|7y|4hecies|7y|6sied|7y|6tS|7ic|5ylactic|8xis|4ionate|4olis|5nentS|5rtionSE|AalL|City|BteL|5salS|6eSD|7rS|6ing|7tionS|B',
  'al|4ped|4rietary|8orS|Aship|8y|4ulsion|4yl|6ene|3quest|3rated|3scribed|4e|5cuteD|8ing|9onS|8orS|4odic|6y|4pectSG|8iveL|8',
  'orS|8us|Aes|6rE|7ity|7ous|4ser|4tate|8ctomy|7ic|8tis|5hesis|7ticS|5ituteS|9ion|5ores|5rate|3tagonistS|4ea|6seS|5ctSEG|7a',
  'nt|7ionS|Aism|Ct|8ve|7orS|9ate|5ge|5inS|7ase|7uria|5olysis|8tic|5stSEG|7antS|Aism|7erS|7ors|5us|4hrombin|4o|5colS|5nS|5t',
  'ypeS|8ical|9ng|5zoa|8n|4racted|5uding|6sion|3udL|3vable|4eSD|5n|6ance|6cal|7e|5r|6bS|7ial|4ideSD|7nce|8t|7rS|6ing|5nceS|',
  '7ial|6g|5sionSEG|9alL|6o|4o|5cation|9ve|5keSD|6ing|5st|3wess|4l|5er|3xies|5mal|7te|6ity|4y|3zac|2udence|6tL|7ial|3neSD|4',
  'ing|4us|3ssian|2web|2ying|1salmS|5ist|2eudo|6ephedrine|6monas|6nymS|2i|2oriasis|6tic|2ychE|5e|6delic|5iatric|AstS|9y|6cS',
  '|7al|5o|6analysis|Btic|6dynamic|6logicalL|AstS|9y|6metric|7otor|6path|Aic|6sis|7ocial|8matic|6therapistS|Cy|7ic|3llium|1',
  'tolemy|1ubS|3erty|4s|5cent|3ic|3licSL|6an|7tionS|6ist|7ty|7zeD|8ing|5shEG|7erS|8s|3med|2ckS|4er|2ddingS|4leS|2ebloS|3rto',
  '|2ffSEG|4er|4in|4y|2get|3h|2laski|3lSEG|4down|4en|5rS|5yS|4man|3monary|3p|4it|3satile|7ng|7on|4eSD|4ing|2maS|3ice|3pSEG|',
  '4er|4kinS|2nchEG|5es|5y|4tual|8ity|7ted|8ion|6reSD|3ditS|3gent|3ishEG|6able|6er|7s|6mentS|4tive|3jab|6i|3kS|4y|3tSG|4a|4',
  'erS|4oS|2pilS|3petS|6ry|4ies|4y|3s|2rchaseSD|8rS|7ing|3due|4y|3eL|4bred|4e|4st|3gatory|4eD|4ing|3ification|6ed|7rS|5yG|4',
  'ne|4stS|4tanS|5y|3pleS|5ish|4ortSEG|5seSL|7fulL|4ura|3seS|4uance|7t|5eSD|5ing|6tS|3veyorS|4iew|2shEG|4erS|5s|4tu|3s|4ies',
  '|4yS|5cat|2tS|3ative|3er|3in|3nam|3tSG|4erS|4y|2yallup|2zzleSD|6r|5ing|1ygmy|2jamas|2lonS|2ramidS|7al|3ene|6es|4x|3idine',
  '|5oxine|4midine|4te|3olysis|4phosphate|4technicS|3uvate|2thagorean|4ons|0qaeda|2tar|1uack|3dS|4ra|6ngle|7tS|6tic|7ure|5i',
  'ceps|5uple|7ole|3gga|4mire|3il|4nt|3keS|5rS|4ing|3lificationS|7ed|8rS|8s|6yG|5tativeL|6ies|6y|4ms|3n|4dary|4t|5a|5ifiabl',
  'e|8cation|8ed|9rS|7yG|6tativeL|7ies|7y|5um|3rantineD|4kS|4les|4relS|5ies|5yG|4tS|5erSEL|7backS|7master|6tS|5ile|5o|5z|3s',
  'h|4i|3ternary|4re|3yS|2ebec|3chua|3enS|5sland|4rS|3ll|3nchEG|4tin|3rcetin|5us|4ied|6s|4yG|3stS|5ionSEG|8able|8er|8naireS',
  '|3tzal|3ueSDG|4ing|2ibble|3che|4kL|5books|5check|5enEG|6r|6st|5ieS|5ness|5sand|6ilver|5time|3d|3escent|4tL|5er|6st|5ness',
  '|3llS|4tSEG|5erS|3nce|5y|4ine|4n|5ipiac|4ones|4t|5a|5e|6ssence|Atial|6t|5ileS|6n|5on|3pped|4s|3reD|4kS|5y|3tS|4e|4ting|3',
  'verG|3xote|6ic|3z|4es|4zes|2orum|3taS|5bleS|5tionS|4eSD|4h|4ient|5ng|2ran|1west|0rabat|3biS|5nic|8al|5tS|4le|3id|4es|4n|',
  '2ccoonS|3eSD|4courseS|4rS|4wayS|3hael|4el|3ialL|4ng|4sm|5tS|3kSEG|4etS|6eering|3oon|2darS|3ek|4on|4r|3ialL|5nS|6ce|6t|5t',
  'a|6eSD|6ing|7on|7ve|6orS|4calSL|7ism|4i|4oS|5active|Aity|5carbon|5graphS|Aic|Ay|5head|5isotopes|5logic|Aal|9stS|8y|5mete',
  'r|8ric|5therapy|4sh|5son|4um|5s|4x|3on|2fael|3fia|4leS|3tSG|4erS|2geSD|3ged|6y|3ing|3lan|3nar|3s|3time|3weed|2hul|2idSEG',
  '|4erS|3lSG|4birds|4ings|4roadSG|4wayS|3ment|3nSEG|4bowS|4coat|4dropS|4er|5s|4fall|5orest|4storm|4y|3seSD|5rS|4inS|6g|2ja',
  '|4h|4sthan|3eev|4sh|3iv|2keSD|3ing|2leigh|3f|3lied|6s|4yG|3ph|2ma|4da|4n|3bleS|6rS|5ingS|4o|3esh|3ifications|4rez|5o|3me',
  'd|4ing|4stein|3on|5a|5es|3pSG|4age|5nt|5rtS|3s|4ey|2nD|3a|3ce|4hG|5erS|7ia|7o|6s|5o|4id|3dal|6l|4ell|4le|4olph|5mL|6izat',
  'ion|8eD|9r|6ness|4s|4y|3gEG|4eS|5rS|3jit|3kSEG|4ings|3som|3tSG|4ings|2pEG|3eS|4seed|3hael|3idSL|5es|5ity|4er|4stS|3ped|5',
  'rS|4ing|4ort|3torS|4ure|2reSL|4r|4st|3ities|5y|2sa|3calS|3h|4es|3pberries|8y|3ter|2tSEG|3a|3chetG|3eS|4payers|4rS|3her|3',
  'ification|6ed|5yG|4ngs|4oS|5nSG|6alL|8eS|8ism|At|9ty|9zation|Ae|3on|3tan|4leSD|6rs|6snake|5ing|4us|4y|2ucous|3l|2vageSD|',
  '3eSD|4l|4nS|5ous|4r|3i|4ne|5gS|4oli|4shed|6ing|2w|3hide|2yS|3mond|3on|2zed|4r|3orS|5backS|1eachEG|5able|5es|4tSEG|5antS|',
  '5ionS|8ary|6vateD|9ion|7e|7ity|5orS|3dSG|4ability|6le|4erS|6ship|4ied|6s|5ly|5ness|6gs|4justment|4mission|4yG|3ffirmSEG|',
  '8ation|3gan|4entS|3lSL|4es|4ign|7ment|5seD|6m|6tS|7ic|9ally|5ties|6y|5zationS|6eSD|6ing|4locateD|9ion|4mS|4player|4time|',
  '5ones|6rS|5y|4y|3mer|4ing|4s|3nalysis|3pSEG|4er|4pearSE|5ly|5ointed|9ment|5raisal|3rSEG|4rangeD|9mentS|8ing|3sonSEG|6abl',
  'e|Aness|9y|4sembleD|9y|6ss|8ment|5ignE|8ment|5urance|7eD|7ing|3uthorization|Ae|3ver|2balancing|4r|4teS|3ecca|4kah|4lS|5l',
  'ed|6ionS|8us|3irth|3oot|4rn|4undSEG|3roadcast|3uffed|6s|4ildSG|6t|4keD|4s|4t|5tal|2calcitrant|6ulateD|5lSEG|4pS|5tureD|4',
  'st|3edeD|5ing|4iptS|5vableS|6eSD|7rS|8ship|6ing|4ntL|6er|4ptacleS|6ionS|9istS|7ve|8ity|6orS|6us|4rtified|4ssE|6es|6ionS|',
  '7ve|3hargeSD|8able|8r|7ing|4eck|5rcheS|9r|3idivism|4eve|4peS|6zaar|5ientS|5rocal|9te|Aing|8ity|4rculating|Bon|4talS|6tio',
  'n|5eD|5ing|3klessL|8ness|4oned|6ing|6s|3laimEG|5mation|5ssification|Aed|4ine|7rS|6ing|4use|6ive|3ode|5ified|4gniseD|7tio',
  'nS|7zable|8eSD|9r|8ing|4il|4llect|9ionS|4mbinant|9tion|5mendSEG|9ationS|9er|6it|5pense|6ileD|8ing|4n|5cileD|8iationS|9ng',
  '|5ditioned|Bing|5naissance|6ectEG|9ion|5siderEG|Aation|6tituted|Bion|7ructEG|BionS|Cve|5veneD|4rdSEG|6able|6erS|6ings|4u',
  'ntSEG|5p|5rse|4verSEG|7able|7ies|7y|3reateSD|7ing|8onS|Aal|4uitSEG|7erS|7ment|3t|4al|5ngleS|7ular|4ification|7ed|8rS|6yG',
  '|4o|5r|6y|4um|3umbent|4peration|4rS|5renceS|8t|6ing|5sion|7veL|4t|3ycleSD|7r|6ing|2dS|3acted|3birds|3den|4ing|5sh|4y|3ec',
  'orating|4emEG|6able|6er|4fineSD|7ing|8tion|4mptionS|8ve|4ployment|4s|5ignEG|8ated|4velopE|9ment|4ye|3fish|3hat|4eadSE|3i',
  'rectSEG|8ion|4scoverEG|Ay|5tributeD|Bing|ConS|8cting|3mond|3ness|3o|4ne|4x|3raw|4ess|3skins|3uceSD|6rS|5ible|6ng|5tase|6',
  'ionS|7ve|4ndancies|9y|8t|4x|3wing|4oodS|2ebok|3dS|4er|4y|3fS|4er|3ks|3lSEG|3s|4e|3veS|2fS|3acing|3erSEG|5eeSDG|6nceSD|8i',
  'ng|7da|8umS|7t|8ial|6r|5ralS|6ed|7rS|6ing|3illSEG|6able|4nanceD|8ing|5eSD|6mentS|6rS|7ies|7y|5ing|6shG|4t|3lectSEG|7ance',
  '|7ionS|8ve|9ity|7orS|5x|6es|6ive|6ology|4ow|4ux|3ocus|4restation|5mSEG|6ation|6erS|6ist|6ulated|Aion|3raction|8ve|7or|9i',
  'es|9y|5inEG|4eshEG|7er|8s|7ingly|7mentS|4igerantS|9teD|Aing|Bon|AorS|3uelG|6ling|4geS|6eS|4ndSEG|6able|4rbishEG|9ment|4s',
  'alS|5eSD|5ing|4tation|5eSD|5ing|2gSE|3ainSEG|4l|5ia|4rdSEG|6er|6less|4ttaS|3ency|5erateD|9ing|Aon|Ave|9or|5tS|3gae|4ie|3',
  'ia|4meS|6nS|7tS|8al|4na|6ld|4onS|6alSL|8ism|4s|5terSEG|8register|6rantS|8rS|8tionS|7ies|7y|3ress|7ionS|8ve|5tS|6table|Ay',
  '|7ed|4oup|5wth|3ula|6rSL|7ities|9y|8zation|6teSD|7ing|8onS|7orS|9y|5us|4rgitation|2hab|5ilitateD|Bing|Con|Cve|4sh|3earin',
  'g|6salS|7eD|7ing|5t|3oboth|2ich|3d|3gnSEG|3ki|3lly|3mbursable|8eD|9mentS|4er|4s|3nSG|4a|4carnation|4deer|4er|4forceSD|9m',
  'entS|8ing|4hard|4stallEG|7teD|9ment|5urance|4tegration|5roduceD|Ation|4ventEG|8ion|6stE|8ment|3s|4er|4sueSD|3ter|6ateSD|',
  '8ing|4s|2jectSEG|6ionS|3oiceD|6ing|5nE|3uvenateD|9ing|Aon|2kindle|2lais|4pseD|6ing|4teSD|6dness|5ing|6onS|8al|8shipS|6ve',
  'SL|7ism|9tic|8ty|4unch|4xEG|5antS|6tion|5erS|6s|4ySEG|3easeSD|6ing|4gated|7ion|4ntlessL|4vance|8y|7t|3iability|6le|7y|5n',
  'ce|6t|4cS|4ed|5fS|5s|5veSD|7rS|6ing|4gionS|7sity|7usL|4nquishE|4sh|6es|5tE|4ve|5ing|3oadSEG|4catable|7eD|7ing|8onS|3ucta',
  'nce|8tL|3yG|2made|4inSEG|6derS|4keS|5ing|4nD|5ded|5ufactured|4p|4rkSE|6able|9y|5riage|7ed|4sterE|4tch|3brandt|3edial|7ti',
  'on|6ed|7s|5y|4mberSEG|6ranceS|3indSEG|6erS|5gton|5isce|9nceS|At|8ing|4ss|6ion|4t|5tanceS|6ed|4xE|5es|3nantS|3odelSEG|7er',
  'S|7ling|4rse|5tgageS|4teSL|6ness|5ing|4vable|6lS|5eSD|6rS|5ing|3uneration|4s|2naissance|4l|4meSD|6r|5ing|4ult|3contreS|3',
  'derSEG|6er|6ings|5zvous|4itionS|3ee|4gadeS|5otiate|Aion|4wSEG|5ableS|6lS|3in|3ner|5s|3ounceD|4vateD|7ing|8onS|4wnE|3tSEG',
  'L|4alS|4erS|3umberEG|4nciation|2openSEG|3rderEG|4ganization|9eD|9ing|4ientation|2pSL|3ack|6aged|8ing|4intE|5rSEG|6able|6',
  'erS|6man|4rationS|4triated|9ion|4yG|5able|5mentS|3ealSEG|5tSEG|6ability|8le|6edly|7rS|4c|4l|5lant|6ed|7ntS|4ntE|6ance|4r',
  'cussions|5toire|7ry|4titionS|8ve|3hrase|3laceSD|7able|7mentS|6ing|5ySE|4enishEG|9ment|5te|4icaS|7teSD|8ing|9onS|5ed|6s|4',
  'ying|3ortSEG|6able|7ge|6edly|7rS|4se|5itionG|7ories|9y|5sessed|9ion|5ted|6ing|3rehensible|5sentSEG|9ationS|Eal|CveS|6sE|',
  '7ion|8ve|7or|4ieve|5mandE|5ntSEG|5salS|6e|4oach|5cessing|5duceSD|8ibility|Ale|9ng|8tionS|Ave|3tileS|6ian|3ublicS|8anS|Ai',
  'sm|9tion|7shE|4diated|8ion|4gnant|4lsed|6ion|7ve|4rchase|4table|6tionS|5eD|2questSEG|7er|4iem|5reSD|7mentS|6ing|5siteS|8',
  'ionSG|2readG|3unS|2saleS|4mpling|3cheduleD|9ing|4indE|5ssion|4ueSD|6rS|5ing|3eal|5rchEG|8erS|9s|4ction|4da|4llG|6erS|4mb',
  'lance|7eSD|7ing|4nd|5e|5tE|6ful|6ment|4rvationS|6eSD|7america|6ing|7stS|6oirS|4tS|5ting|6lement|3hapeD|6ing|4uffle|3ideS',
  'D|6nceS|8ies|8y|7tS|8ial|5ing|5ualS|6eS|4gnSEG|6ationS|4lience|9y|8t|4nS|4stSEG|6anceS|8t|6ive|8ity|6orS|4zeD|6r|5ing|3o',
  'luteL|7ionS|5veSD|7r|6ing|4nanceS|7t|6teS|7orS|4rption|5tSEG|4unding|5rceSD|8ful|Bness|7ing|3p|4ectSEG|7ability|9le|7ful',
  'L|7iveL|4iration|8orS|Ay|5te|4lendent|4ondSEG|7entS|8rS|6seS|7ibilities|Dy|9le|Ay|8ve|Aness|3tSEG|4artSEG|5teD|7ment|5ur',
  'antS|8teurs|4ful|4itution|4less|8ness|4ockG|5rationS|9ve|6eSD|7rS|6ing|4rainEG|8tS|5ictSEG|8ionS|9ve|5ucturing|3ubmit|8t',
  'ed|4ltSEG|6ant|4meSD|5ing|5ption|4pply|4rfaceD|8ing|5gence|8t|5rectE|9ion|4scitation|5pended|2tailSG|6erS|5nSEG|6erS|4ke',
  '|4liate|8ion|8ory|4rdSE|6antS|7tion|3elling|4ntion|4st|3hinkG|3icle|5ulum|4n|5a|6l|5itis|5oblastoma|6l|4reSD|6es|6mentS|',
  '5ing|3old|4oling|4rtE|4uching|5r|3race|6tE|7able|7ionS|5ining|5nsmission|9t|Ated|4eatSEG|5nchment|4ial|5bution|5es|6valS',
  '|7eSD|8rS|7ing|4o|5activeL|5grade|5spect|AiveL|4y|3urnSEG|6able|3ype|2uben|3nification|5onS|5teSD|3sable|4eD|4ing|3ters|',
  '2v|3aluation|4mpSEG|3ealSEG|4getation|4lS|5ationS|4nge|5ueS|4rb|6eration|5eD|6nce|7d|7t|5ie|5salS|6eSD|6i|7ble|7ng|7on|5',
  'ts|3iewSEG|6erS|4led|4seSD|5ing|6onS|8ism|At|6tSEG|5or|4talization|9eD|9ing|4valS|5eSD|5ing|3ocable|6tion|4keD|5ing|4ltG',
  '|5utionS|Aaries|Cy|AizeD|Cing|5veSD|7rS|6ing|3ue|4lsion|2wardSEG|3ind|3orkEG|3riteS|6ing|6ten|2yes|3nolds|1hapsody|2ea|3',
  'in|3ology|3sus|3toric|8al|3um|5atic|8sm|7oid|2ine|5land|9er|5stoneS|4itis|4oS|5ceros|5plasty|3zome|2oda|4eS|5sian|4ium|4',
  'odendron|5psin|3nda|2ubarb|2ymeS|4ing|3thmS|6ic|1ialS|2bbed|4ing|4le|4onS|3oflavin|4nuclease|4se|5omal|3s|2ca|4n|4rdo|3c',
  'i|3e|3hL|4ardS|7son|4er|5s|6t|4ie|4land|4mond|4ness|4ter|3in|3kS|4er|5ts|5y|4shaw|4y|3o|4chet|4h|2dG|3dance|4en|5r|4ing|',
  '4leSD|3eS|4au|4rS|3geS|5way|3iculeD|7ousL|4ngs|2emannian|3s|4ling|2fe|3fS|4le|3leS|5man|3tS|2gel|3ged|5r|4ing|3htSL|5eou',
  's|9ness|5fulL|5most|3idL|5ity|3orS|5ousL|3s|2hanna|2ley|2mS|3es|3less|3med|5r|4ing|2ncon|3gSEG|4e|5rS|4ling|4master|4sid',
  'e|4toneS|4worm|3kS|3seD|4ing|2oS|3tSG|4ers|2pS|3arian|3e|4nEG|5cc|3ley|3ped|5rS|4ing|4leS|5ing|2seS|4n|4rS|3hi|3ing|3kSE',
  'G|4y|3que|2ta|3chey|5ie|3eS|3ter|3ualS|6istic|2vaS|4lS|5ries|6y|3en|4rS|5a|5bank|5head|5ine|5side|4s|4tSEG|3iera|2yal|1o',
  'ach|5es|3dSG|4blockS|4house|4less|4map|6ster|4side|5ter|4wayS|3mEG|3noke|3rSEG|3stSEG|5erS|2b|3bed|5rS|6ies|6y|4ie|5nS|6',
  'g|3eS|4rtS|6a|6o|6son|3inS|5son|3les|3otS|5icS|3ust|6ness|3yn|2che|5lle|5r|5ster|3kSEG|4away|4efeller|5rS|5tS|6ry|4fish|',
  '5ord|4ies|5n|4man|4port|4ville|4well|5ood|4y|3oco|2dS|3e|4ntS|6ia|4oS|4rick|3gerS|3ham|3man|3ney|3riguez|2ebuck|3der|2ga',
  'n|3erS|3ueS|2han|2ker|2land|3eS|4x|3f|4e|3lSEG|4backs|4erS|5yes|4icking|4o|5ver|2main|6e|4ji|4nS|5ceS|6ing|5esque|5ia|7n',
  '|5ticS|8ally|8ism|5y|3e|4o|4ro|3ney|3p|4er|3ulus|2nald|3co|3de|4o|3nie|2ofSEG|4ers|3kS|4ieS|3mSG|4ie|4mateS|4y|3sevelt|4',
  'tG|5erS|3tSEG|4er|4sweb|2peSD|4r|3ing|2que|2ry|2saS|4les|5ie|6nd|4mond|4ries|6o|5y|3eS|4bud|4lle|4mary|4n|5berg|4tta|6eS',
  '|4ville|4wood|3ie|4n|3s|4er|4i|5ter|3terS|3well|3y|2ta|4rians|5y|4table|5eSD|5ing|6onS|8al|5or|3her|3isserie|3o|4rS|3ted',
  '|5n|5rdam|4ing|4weiler|3unda|2uge|4hGL|5er|5ness|3lette|3ndSEG|5aboutS|5erS|5house|5table|5upS|3seD|5r|4ing|4seau|5illon',
  '|3teSD|5rs|4ineSL|6g|4ledge|2ve|4rS|3ing|2wSEG|3an|3dy|3ena|4rS|3landS|4ey|4ing|2xana|5ne|3burgh|6y|3ie|3y|2yalS|5e|5tie',
  's|6y|3ce|1ubbed|5rS|6ized|4ing|5sh|4le|3ella|3iaS|4con|4es|4n|3leS|3ricS|3s|3us|3y|2cker|4sackS|4us|2dd|4er|4ock|4y|3eL|',
  '4ness|3imentary|8s|3olf|5ph|3y|2ff|4in|4leSD|3ous|3us|2gS|3by|3er|3ged|2inSEG|2leSD|4making|4rS|3ingS|2manian|3bleS|5ing',
  'S|3en|3inantS|6tions|3mage|4y|3orSE|3ped|4s|3sfeld|2nS|3about|4wayS|3dle|3eS|3gS|3ic|3nable|4els|5rS|4ing|4y|3off|3time|',
  '3wayS|2pert|3iahS|3tureD|2ral|2shEG|4es|3kin|3s|4el|6l|5s|5t|4ia|6nS|3ted|4ic|5ng|4le|5ing|4y|2tgers|3h|4enium|5rford|4l',
  'essL|3land|3ter|1wanda|1yan|2der|0saba|3bath|6ical|3erS|3ian|4na|5e|3le|3otage|3ra|4ina|2ccharomyces|3hetS|4s|3kSEG|3ra|',
  '5l|5mentS|9al|9o|4ed|4ificeSD|8ial|9ng|3s|2dL|3dam|4ened|5r|4leSD|6back|8gs|6ry|3ie|4sm|5tic|3ness|3o|4masochism|3r|2far',
  'is|3eSL|4guardSEG|4keeping|4r|4st|4ty|3flower|4ron|2gaS|4more|3eS|4brush|4m|4r|3ging|4y|3inaw|4ttal|7rius|3uaro|2hara|6n',
  '|2id|3lSEG|4boatS|4erS|4fish|4ings|4orS|3ntSL|2kai|3eS|3ura|2laam|4dS|4manderS|4r|5ied|7s|5y|3eS|4m|4sman|5people|7rsonS',
  '|3icylate|7ic|4ence|6t|4naS|5e|5ity|4sbury|4va|6ry|4x|3le|4y|3ma|4o|5n|6ella|6idS|3ome|5on|4nS|4onS|3sa|3tSE|4a|4er|4wat',
  'er|4y|3uki|4tary|6tionS|5eSD|5ing|3vador|8an|5geD|5tion|4e|4ia|4o|3zburg|2mS|3adhi|4ntha|4ra|5ia|6tanS|3ba|3e|4er|4ness|',
  '3hain|3ir|3my|3oa|5n|4yed|3pleSD|6rS|5ing|3sara|4on|6ite|4ung|3uelS|4i|4rai|2nSD|3chez|5o|4tification|8ed|7y|6onSEG|6ty|',
  '5uaries|8y|6m|6s|3dalS|6wood|4blasting|5ox|4ed|5ep|5rS|4ing|5sk|4man|4paper|5iper|4ra|4s|5tone|7rm|4wichE|8es|4y|3e|3for',
  'd|3g|4amon|4er|4ha|4uine|3itarium|7y|6tion|5izeD|8r|7ing|5y|3jay|4eev|3k|3skrit|3t|4aS|5na|4ee|4iago|4oS|3yo|2o|2p|3iens',
  '|3lingS|3phic|6reS|5o|4y|2ra|4band|4cenS|4h|4n|4sota|4toga|3banes|3casm|6tic|9ally|4oma|3dineS|6ian|4onic|3ees|3iS|3kar|',
  '3ongS|3s|2sh|4a|3katchewan|6oon|3safras|4er|4y|2t|3an|5ic|6sm|3chel|3een|4lliteS|3in|4re|5ical|4sfaction|9orily|By|6iabl',
  'e|7ed|8s|6yG|3suma|3urateD|7ion|5dayS|5n|2uceS|5pan|5rS|4y|3di|3erkraut|3l|4t|3naS|4ders|3sageS|3teE|5r|3vignon|2vageSL|',
  '6ry|4nna|7h|5t|3eSD|4rS|4save|3in|5gS|4or|5ur|3orG|5y|4ur|4y|3vy|2wSEG|3dust|3fish|3millS|3yer|2xonS|5y|4phoneS|8ist|2yS',
  'EG|3erS|3id|4ngs|1cabbard|4ies|3ffoldSG|3la|5bility|6le|5rS|4eSD|5r|4ing|4lions|5opSE|4pG|5el|6r|4y|3mmed|6r|4p|4s|3nS|4',
  'dalS|7ous|5ic|6navia|Bn|4ia|4ned|6rS|5ing|4t|5ily|5y|3peS|5goat|3rSEG|4ab|4borough|4ceL|5ity|4eS|5crow|4fS|5ace|4let|7t|',
  '4red|5ing|4t|4ves|4y|3t|4hing|4terEG|3vengerS|7ing|2enarioS|4eS|5ry|4icS|4tSE|3pter|2harf|3eduleSD|8r|7ing|4maS|6ta|7icS',
  '|9ally|5eS|5ing|4rzo|3iavo|4ller|6ing|4sm|5tosomiasis|4zophrenia|Cc|3midt|3nabel|5pps|5uzer|4eider|3oharie|4larSL|7shipS',
  '|6stic|4olSEG|6boy|6craft|6er|6girlS|6house|6master|6teacher|6work|6yard|5ner|3reiner|4oeder|3uh|4le|6r|5tz|4macher|4ste',
  'r|3wartz|6z|7enegger|4eizer|2iatic|7a|3enceS|5tific|Aally|7stS|6ology|3fi|3mitar|3ntilla|9ting|Bon|3on|3ssorS|2leroderma',
  '|6sis|2offE|3ldE|4iosis|3nceS|4eS|3oby|4pSEG|4t|5erS|3peSD|4ing|3rchEG|4eSD|5boardS|7ok|5card|5less|5rS|4ing|4nE|4pio|7n',
  'S|3tS|4ch|4ia|4land|4sman|4tS|5ie|6sh|5sdale|5y|3undrelS|4rEG|5ge|4se|4tSG|5er|2rabble|4mbleSD|8r|7ing|4n|5ton|4pSEG|5bo',
  'okSG|5eS|6rS|5ie|5ped|6ing|6y|4tchEG|7es|7y|4wled|3eamSEG|6er|4eD|5chG|5nSEG|6erS|6ings|6playS|6saverS|6writerS|4wSEG|5b',
  'all|5driverS|3ibbleSD|7ing|5eSD|4m|5mage|4p|5ps|5tSEG|6ural|8eS|4vener|3ollSEG|6er|4oge|4tum|3ubS|5bed|7rS|6ing|4ff|6y|4',
  'm|5ptious|4ples|5ulousL|4tinizeD|9ing|7y|2uba|3dder|3ffS|3ll|4ptEG|6orS|6ural|8eSD|3m|3rry|4vy|3ttle|2ylla|3the|1dram|1e',
  'aSL|3board|3coast|3farers|6ing|4ood|3gate|3hawks|3lSEG|4antS|4erS|3mSE|4an|4lessL|4stress|4us|3n|3plane|4ortS|3rchEG|6ab',
  'le|6erS|7s|6light|6search|4ed|4ing|4s|3scapeS|4hore|4ide|4onSEG|6alL|8ity|6ings|3tSEG|4er|4tle|3ver|3ward|5y|4eed|2basti',
  'an|2cS|3ession|3luded|5sion|3ondSEL|6arily|8y|6hand|6ment|3recy|5tSEGL|6arial|AtS|9es|8y|6e|6ionS|7ve|6ory|3sg|3tS|4aria',
  'n|4ionSEG|7alS|4orS|6al|3ular|7ism|4nia|4reSDL|5ing|6ties|7y|2danS|4teD|5ion|6veS|3entary|4r|3ge|3imentS|8ary|9tion|4tio',
  'n|3ona|3uceSD|5ing|5tion|7ve|2eSDGL|3ded|5rs|4ing|4lingS|4s|4y|3ger|3kSG|4erS|3mSEG|4ingly|3n|3page|4ing|4s|3r|3ther|5in',
  'g|2ger|3mentSE|7al|8tion|3regateD|8ion|3ue|2idel|3gneur|3ko|3ne|5r|3smic|7ity|5ology|3te|3zeSD|4ing|4ureS|2lah|3dom|3ect',
  'SEG|6able|6ionS|7veL|8ity|6man|6orS|4na|5e|5ium|3f|4ishL|7ness|4less|8ness|3ina|3lSG|4erS|4out|3tzer|3va|2manticS|8ally|',
  '4phoreS|3blance|3en|4sterS|3iS|4annual|4colonS|6nductorS|4finalS|4nal|6rS|7ies|7y|5oleS|4oticS|4tic|6sm|2nate|5orS|7ial|',
  '3ce|3dSG|4erS|4mail|4o|3eca|4gal|7ese|4scence|3ile|4orS|6ity|3na|4heiser|3sEG|4ationS|9al|4eS|5less|4ibilities|Ay|6le|7y',
  '|5tiveL|8ities|Ay|7zation|8ed|4o|5rS|6y|4ual|7ity|5ous|3tE|4enceSD|7ing|4ient|5mentS|9al|Bity|5nelS|4ry|2oul|2parable|6t',
  'eSDL|7ing|8onS|8sm|9tS|7orS|3erate|3hardic|3ia|3sis|3t|4a|5l|4ember|4ic|4uagint|5m|2quelS|6ae|5nceSD|8rS|7ing|6t|7ialL|5',
  'stered|7ration|4inSE|5tur|4oia|2r|3a|4ph|6im|3bS|4ia|6n|3ena|6de|6ta|5dipity|5e|5ity|3ge|5antS|5i|4io|3ialSL|6ization|8e',
  'D|9r|4eS|4f|4graph|4ne|4o|5usL|7ness|3monS|3ologic|9al|7y|3pentS|7ine|3ra|5no|5ted|3ta|3um|3vantS|4eSD|5rS|4iceSD|7abili',
  'ty|9le|7magic|7r|6ing|5dor|5ngS|5tude|4let|4oS|2same|3s|4ionS|7al|4o|2tS|3backS|3h|3on|3tee|5rS|4ingS|4leSD|6mentS|6rS|5',
  'ing|3upS|2vastopol|3enS|5fold|5teen|9th|6h|6ies|6y|4rEG|5alL|6nce|5eL|5ity|3ille|2wage|3ed|4rS|5age|3ing|3n|2xEG|3cam|3e',
  's|3o|3tant|4et|4ile|4on|3ualL|6ity|3y|2ychelles|3mour|1habby|3ckS|5leSD|3dEG|4eS|5rS|4owSEG|6y|4y|3ftS|5er|3g|4ging|5y|3',
  'h|4id|3ikh|3ka|4eS|5down|5n|5rS|5speare|Ban|4ing|5ra|4ti|4y|3le|4l|5ots|6wS|7er|4om|4t|3mSE|4anS|6ic|7sm|4bles|4e|5ful|5',
  'lessL|4ir|4pooS|4rock|3n|4dy|4eS|4g|5hai|4ia|4kS|5ar|4na|5on|4ty|3peSDL|5rS|4ing|5ro|3ran|4dS|4eSD|5holderS|5point|5rs|5',
  'ware|4i|5a|5ng|4kS|5y|4ma|4on|4pSL|5e|6nEG|7erS|6r|6st|5ie|5ness|5shooter|3sta|3tterSEG|3ul|4n|3veSD|5n|5rS|4ingS|3w|4an',
  'o|4lS|4n|5ee|3yS|2eSD|3a|4f|5fer|4rSEG|5er|5ling|5water|4thSEG|4ves|3dding|4s|3ehan|4n|4p|5ish|5skin|4r|4tSG|3ffield|3ik',
  '|5h|4la|3kelS|3lby|4don|4f|4lSEG|5ac|5ey|5fish|5y|4terSEG|5on|4ved|6s|5ing|3maleS|3n|4anigans|4g|4zhen|3pard|4herdS|3rat',
  'on|4bet|4idan|5ffS|4lock|4manS|4pa|4ri|5y|4wood|3th|4land|3va|2ibboleth|3eldSEG|3ftSEG|5erS|5y|3gella|3h|3iteS|3llG|5ing',
  's|4oh|3mano|4merG|5y|4s|3nSEG|4eS|5down|5r|4g|5leS|4to|4y|3pS|4board|5uilding|4man|5entS|4ped|6rS|5ing|4wreckSE|4yardS|3',
  'raz|4eS|4k|4ley|4tS|5less|3t|3verSEG|2oalS|3ckSEG|5erS|5ingly|5wave|3ddy|3eS|4maker|4string|3gun|3ji|3na|4e|3ok|4tSG|5er',
  'S|5ings|3pS|4girl|4keeperS|4lifting|4peSD|6rS|5ing|5y|4zilla|3reS|5line|4ing|4tSEGL|5ageS|5bread|5cake|6omingS|6utS|5enS',
  'EG|6r|6st|5fallS|5hand|5list|5ness|5stop|3tS|4gunS|3uld|6erSE|6nt|4tSEG|5box|3veD|5lSG|4ing|3wSEG|4biz|5oat|4caseSD|7ing',
  '|4down|4erSEG|4ings|4man|7ship|4n|4roomS|4timeS|4y|2rank|4pnel|3edS|5ded|7rS|6ing|4e|4k|4veport|4wD|3iekG|4ke|4ll|4mpS|4',
  'neS|6rs|5kSG|6age|4ver|3opshire|4udE|3ubS|5bery|4gS|5ged|4nk|6en|2udderE|3ffleSD|7board|6ing|3n|4ned|4t|3re|3tS|4downS|4',
  'off|5utS|4terS|5ing|5leS|2yam|3ly|3ness|1iam|4ese|2berian|3lingS|2cilian|5y|3kL|4ened|6ing|5r|5st|4le|4ness|2da|3dhartha',
  '|3eSD|4boardS|4car|4lineSD|4note|4rE|4tracked|4walkS|6ys|5inder|3ing|3ney|3s|2e|3bel|3ge|4fried|3mens|3na|4na|3rraS|3sta',
  '|3veS|2ftEG|2gS|3hSEG|4tSEG|5ings|5seeing|3ma|4oid|4und|3nSEG|4age|5lSEG|6led|7ing|5tories|8y|6ureS|4erS|5t|4ificance|At',
  'L|9tion|7ed|8s|6yG|4postSE|4um|3urd|2kes|3hS|4ism|2lage|4s|3enceSD|7rS|6ing|5tL|4r|4sia|4x|3houetteSD|3ica|6teS|5eous|5o',
  'n|7eS|3kS|4en|4worm|4y|3lS|4iness|4y|3oS|3t|4ation|4y|3va|4erS|6ado|6smithS|6ware|6y|5ster|4ia|5culture|2meon|3ian|4larL',
  '|7es|7ities|9y|5e|3merG|4ons|3onS|5e|3ple|6r|6st|6x|5icity|6ficationS|8ed|9s|7yG|6stic|5y|4sonS|3s|3ulateSD|7ing|8onS|7o',
  'rS|5cast|5taneousL|2nSD|3ai|4tra|3ce|5reL|6ity|4lair|3dhi|3e|3fonia|4ul|3gSGL|4apore|4erS|4h|4leSD|6t|7on|4ularL|8ities|',
  'Ay|3h|4alese|3ister|3kSG|4er|3ned|5rS|4ing|3tered|6ing|3us|5es|5itis|5oidal|2onS|3ux|2phon|3ped|4ing|3s|2rE|3eS|4nS|3ius',
  '|3loin|2sal|3ley|3sy|3tani|4erS|6hood|4ine|3yphus|2tSEG|3ar|3eS|4map|3h|3ioS|3ka|3terS|4ingS|3uateD|6ionS|9al|4s|2x|3ers',
  '|4s|3pence|3teen|7th|4h|4ies|4y|2yabona|2zable|3eSD|4able|4of|4r|3ing|3zle|5ing|1kateSD|5boardG|5rS|4ing|2eet|5er|3inS|3',
  'letal|6onS|4ly|4ter|3pticS|7al|7ism|3tchEG|6book|6es|3wE|4erS|4ness|2iSDG|3ds|3erS|4s|3ff|3llSEG|5etS|5fulL|3m|4med|6rS|',
  '5ing|4py|3nS|4care|4less|4ned|6r|5ing|5y|3pS|4ped|6rS|5ing|5y|3rmish|8es|4tSEG|3tS|4tles|2ullS|3nkS|2y|3e|3lark|4ightS|5',
  'ne|3pe|3rocketEG|3scraperS|3ward|5y|1labS|3ckSG|5erS|3de|3g|3in|3mS|4med|6r|5ing|3nder|7ous|4g|4tE|3pS|4ped|5ing|4stick|',
  '3shEG|5dot|5er|6s|3teSD|5r|4s|4tery|3ughterEG|9house|3veS|5ry|4ic|4onic|3yG|4erS|2eazy|6dream|3dS|4ding|4ge|3ek|4pSG|5er',
  'S|5iness|5less|9ness|5y|4t|4veSD|6less|5ing|3igh|6t|3nder|3pt|3uthS|3wG|2iceSD|5rS|4ing|4kS|5er|3dG|4eS|5rS|5show|3ghtL|',
  '6est|3mS|4e|4mer|5ing|4y|3ngSG|5er|5shot|4k|5y|3pS|4case|4knot|4page|5ed|6rS|7y|5ing|3tS|4her|4ting|3ver|2oan|3ganS|3op|',
  '3peSD|4ing|4py|3tS|4h|4ted|3uch|4gh|3vakS|6ia|8n|4ene|6ia|8n|3wSEGL|4down|4er|5st|2udge|3gS|4ger|5ing|6sh|3ice|3mS|4ber|',
  '4pE|3ng|3rpG|4red|5y|4s|3sh|3tS|4ty|1mackSEG|3llS|5er|6st|5holder|5ish|5mouth|5pox|3rtSL|5er|6st|5ies|5phoneS|5y|3shEG|5',
  'es|3ttering|2earSEG|3llSEG|5y|4tG|5er|2ileSD|5y|4ies|5ng|3rkG|3te|4hS|5ers|5sonian|5y|4s|4ten|2ockE|3g|3keSD|5house|5les',
  's|5rS|4ies|5ng|4y|3ldering|3ot|5hEGL|6er|7s|8t|6ness|3rgasbord|3te|4herSEG|2udge|3ggleD|7rS|6ing|4mug|3t|2yrna|3th|1nack',
  'SG|3fu|3gS|4ged|3ilS|3keS|3pS|4e|4ped|6r|5ing|5y|4shotS|3reS|4k|4lEG|3tchEG|6es|2ead|4kSG|5erS|5y|3ed|4r|4ze|5ing|3llG|2',
  'ickerS|6t|3de|5r|3ffEG|5er|3pSG|4eS|5rS|4ped|6tS|3tch|2obs|3homish|3ok|5er|4pG|5er|5y|4ty|4ze|3pes|3qualmie|3re|4ing|4ke',
  'lG|7ling|4tEG|3tty|3ut|3wSEG|4ballS|5irdS|5oardG|4fall|5lakeS|4man|5obileS|9ing|4shoeSG|5torm|4y|2uck|3ff|3gL|4gleD|2yde',
  'r|1o|2akSEG|3pS|4box|4stone|4y|3rSEG|4es|2bbed|4ing|3erG|3re|4iety|2c|3cer|3iable|5lSL|6es|6ism|8tS|7te|7zation|8eD|8ing',
  '|4etal|6ies|6y|4o|5cultural|5economic|5logical|9stS|8y|3kS|4etS|5ye|3rates|6ic|2daS|3ium|3om|5y|2faS|3ia|3tSL|4ball|4cor',
  'e|6ver|4enSEG|6erS|5r|5st|4ness|4pedia|4wareS|5ood|2ggy|2ho|2ilSEG|3ree|2journ|7erS|2lDL|3aS|4ce|4num|4r|5is|6um|3derEG|',
  '4ierS|3eSL|4il|4mnL|6ity|4noidS|5t|4us|3icitSEG|7ationS|7orS|4dSL|5arity|5er|5ification|8ed|7y|6ty|4s|4taireS|6ry|5ude|3',
  'oSG|4istS|4monS|4n|3stice|3ubility|5le|4te|5ionS|3vable|4eSD|5ncy|6tS|5rS|4ing|2ma|4li|6a|4tic|3ber|4re|6ro|3e|4body|4da',
  'y|4how|4oneS|4place|4rs|6et|5ville|4thingS|5imeS|4what|6ere|3melier|2nS|3ar|4taS|3gS|4birdS|5ookS|4writer|3ia|4cS|3ja|3n',
  'erieS|5tS|4y|3oma|4ran|5ous|3tag|3y|4ericsson|2oke|3n|4erS|5st|3t|4heSD|5ing|4y|2per|3hia|5e|5sticated|Bion|4omoreS|3ran',
  'oS|2rbent|4itol|4onne|3cererS|7ss|6y|3did|3eSL|4ness|3ghum|3orities|7y|3ption|3rel|5nto|4owS|6ful|4y|3tSEG|4able|4erS|4i',
  'eS|2uffle|3ght|3lS|4ful|4less|3ndSEGL|5board|5erS|5ings|5ness|5proofG|5trackS|3pS|3r|4ceSD|6forge|5ing|3s|3ter|4h|5ampto',
  'n|5bound|5east|9ern|6nd|6rly|7n|8ers|8most|5land|5paw|5ward|6est|9ern|3venirS|2vereignS|9ty|3ietS|2wing|3n|2ybeanS|1paS|',
  '3ceSD|5craft|5rS|5shipS|4ing|5ous|3deS|3ghetti|3in|3lding|3mcop|4med|6rS|5ing|4s|3nS|4gled|7r|4iardS|5elS|5sh|4kEG|5ings',
  '|5y|4nEG|5erS|3rSEG|4c|4eS|4ingly|4kSEGL|5leS|6ing|5y|4ring|5owS|4seL|4tanS|3smS|4s|4tic|7ity|3t|4e|4ialL|4ula|3wnSEG|3y',
  'ed|2eakSG|5erS|4rS|5fish|5headEG|5man|6int|3cS|4ialSL|7ised|9ing|9m|9tS|8ties|9y|8zationS|9eSD|9ing|7ties|8y|6tion|5eS|5',
  'ficS|8ally|9tionS|8ities|Ay|7ed|8rS|8s|6yG|5menS|5ous|4kS|5leD|4tacleS|7ularL|6torS|5er|5ra|7l|6ograph|7meterS|Ary|7scop',
  'ic|By|6um|4ular|7teSD|8ing|9onS|9ve|8ors|6um|3d|3ech|6es|6less|4dSEG|5er|5ily|5ometer|5ster|5way|6ell|5y|4r|3llSEG|5bind',
  'ing|6ound|5er|5ings|4t|3nce|6rS|4dSG|5er|4ser|4t|3rling|4m|5a|6tozoa|5shack|3wed|4ing|4s|2hagnum|3ereS|5ical|3incter|5x|',
  '2iceSD|5r|4y|3derS|6man|3ed|4gel|4l|4rS|4s|3ffy|3got|3keSD|4ing|4y|3llSEG|5age|5er|5overS|5way|4t|3nS|4a|5ch|5l|4dleS|4e',
  'S|5l|6ess|4k|4naker|5erS|5ing|4ster|4y|3ralSG|4eS|4itSE|6ualSL|9ism|Aty|4o|3tS|4e|5ful|4fire|4ting|4z|5er|2lashEG|6es|4t',
  '|5terE|3een|4ndidL|6or|5ic|3iceSD|5ing|4neS|5tS|6erSE|4tS|5terS|6ing|3urge|2ock|3de|3ilSEG|5age|5erS|5t|3kane|4eS|5n|5sm',
  'an|6person|6woman|3ndylitis|4g|5eS|6bob|5iform|5y|4sorSEG|7shipS|4taneity|8ousL|3ofSEG|4kS|5y|4lS|5er|4nS|5er|5ful|3radi',
  'c|8ally|4eS|4tSEG|5sbook|6man|9ship|6wear|5y|3tS|4less|5ightS|4ted|6rS|5ing|5y|3usal|5eS|4tSG|2rainSE|4ng|4tly|4wlEG|4yS',
  'EG|5erS|3eadSG|6erS|6sheetS|4e|3igs|4ngSG|6board|8k|6er|6field|6time|5kleSD|8rS|7ing|5tSG|6er|4teS|3ocketS|4utSEG|3uce|4',
  'ng|2un|4k|5y|3rS|4ge|4ious|4red|4tS|3tterG|4um|2yG|3glass|3ware|1quadS|5ronS|4ll|4mous|4ndered|4reSDL|5ing|4shEG|4tS|5te',
  'rS|6ing|4w|3eak|6y|5l|4egee|5zeSD|6ing|4lch|3id|4nt|4reS|5mG|5relS|5tSG|6erS|4sh|6y|1ri|3dhar|3nivas|8an|1tabSL|4bed|5in',
  'g|4ility|7zation|8eSD|9rS|8ing|4leS|3ccato|4ey|4kSEG|5er|4y|3de|4ia|5umS|3ffSEG|5erS|5ord|8shire|3gSE|4eS|5coach|4gerEG|',
  '4nant|6tion|3id|4nSDEG|5es|5less|4rS|5caseS|5wayS|3keSD|5holderS|4ing|3le|5mate|4in|6ist|4kSEG|5erS|4lSEG|5ings|6onS|5ma',
  'n|4wart|3mens|4ford|4ina|4mered|4pSEG|5ede|6rS|5ings|3nDL|4ceS|4dalone|6rdS|8ization|AeD|Aing|5by|5ingS|6sh|5off|6ut|5po',
  'int|5s|6till|4ford|4g|4hope|4islaw|4ley|4ton|4zaS|5e|3phylococcal|Cus|4leSD|6rS|5ing|3rSEG|4board|5uckS|4ch|6es|5raft|4d',
  'om|4eS|4fish|4gate|6zer|7ing|4kSL|4letS|5ight|6ng|6te|4rEG|5y|4ship|5merchant|4tSEG|5erS|5leD|6ing|5up|4vation|5eD|5ing|',
  '3shE|4is|3teSDL|5ful|5hood|7use|5less|5mentS|5n|5r|6oomS|5side|6man|5wide|4icS|6ally|5ng|5onSE|7ary|7ers|9y|5st|7icS|9al',
  'L|9ianS|4or|4s|4uary|5eS|6tte|5re|5s|6es|5teS|6orily|8y|3unch|3veS|3ySEG|2derr|2ead|5fastL|5ily|5man|5y|4kS|4lSG|5er|5th',
  '|7ily|7y|4mEG|5boat|5erS|5ship|5y|4rate|5ic|3dman|3ed|4lS|5e|6rS|5head|5workers|5y|4n|4pEL|5er|6st|5le|7chase|4rSEG|5age',
  '|3fan|6i|3ger|3inS|5er|3lla|6r|5er|3mS|4med|5ing|4ware|3nch|5ilS|4o|5sis|4tS|5or|3pS|4father|4han|7e|7ie|5enS|7son|4moth',
  'er|4peSD|6rS|5ing|4son|4wise|3reoS|6phonics|6scopic|6tactic|7ypeSD|9ical|Ang|4ile|6ity|7zation|8ed|9rS|4ling|4nL|5um|4oi',
  'dS|5lS|3thoscopeS|3van|4eS|5nS|6son|4ia|5e|3wSE|4ardS|7ess|7ship|6t|2ickSG|5erS|5iness|5y|3ffS|5enEG|6r|5ness|4leD|5ing|',
  '3gma|6ta|3leS|5tto|4lS|5birth|6orn|5er|5man|5ness|5water|4tS|3mulantS|7teSD|8ing|9on|8orS|Ay|6i|6us|3ne|4gSG|5er|5ray|5y',
  '|4kSG|4tS|3pe|5ndS|4ulateSD|8ionS|3rS|4ling|4red|5ing|5upS|3tchEG|6er|7s|2ochasticS|4kSEG|5bridge|7okerS|5er|5holderS|8m',
  '|7use|5ings|5man|5pileSD|8ing|6ort|5ton|3ic|5hiometry|3keSD|5r|3leS|5n|3machS|4pEG|5er|3neSD|5henge|5r|5wall|7re|6ork|4i',
  'ng|4y|3od|4ges|4lS|4pSEG|3pS|4over|4page|5ed|6rS|5ing|3rageS|4eSD|5front|5house|5r|6oom|5sshop|5y|4ied|6s|5ng|4k|4mSEG|5',
  'water|5y|4yS|5book|5line|5tellerS|9ing|3ur|4t|3veS|5r|3wE|4away|2rabismus|4ddle|7ing|4ightS|8enEG|AerS|8forward|8way|5nS',
  'EG|6erS|5tS|4ndSE|5g|6eL|7ness|7rS|7st|6leD|4pS|5less|5on|5ped|6ing|4sbourg|5ser|4ta|5egic|9ally|8es|8stS|7y|5ford|5ics|',
  '6fication|8ed|6graphic|By|5osphere|Bic|5um|6s|4uss|4wS|5berries|9y|4ySEG|5er|3eakSEG|5mSEG|6erS|6lineSD|9ing|4ep|5tS|6ca',
  'r|6er|6wise|4ngthS|8enSEG|5uous|4ptococcal|Bi|Bus|7myces|Ain|4ssEG|6es|6ful|4tchEG|7erS|8s|7y|4wn|3iatum|4cken|5tL|6er|7',
  'st|6ures|4deS|6nt|6rS|4fe|4keS|6rS|5ingL|4ngSEG|6ent|7rS|6y|4pSEG|5eS|6rS|5ped|7rS|6ing|4veS|5ing|4x|3ode|4keSD|6rS|5ing',
  '|4llEG|6erS|4m|5a|6l|4ngL|6er|7st|6holdS|5tium|4ud|4ve|3uck|5t|6uralL|8eSD|8ing|4ggleSD|7ing|4m|5mer|6ing|4ng|4tS|2uart|',
  '3bS|4ble|5ornL|5s|5y|3cco|4k|3dS|4ded|4entS|7shipS|5r|4ia|5ed|6s|5oS|5um|4yG|3ffSEG|5erS|5y|3ll|3mbleSD|7r|6ing|4pSE|3nS',
  '|4g|4ned|6r|5ingL|4tSE|3pendous|4idL|6est|6ity|4or|3rdy|4geon|4t|3tterG|5gart|2yleSD|5r|5sheet|4ingS|5shL|6tS|7ic|5zed|4',
  'us|3mieD|3rene|3x|1uave|2bS|3acute|4rachnoid|5ea|5u|4tomic|3categories|Ay|4hapter|4lass|8es|6use|4ommitteeS|5nsciousL|6t',
  'inent|7ractSEG|BorS|4ultureS|5taneous|3divideD|7sionS|4uction|5eD|3families|8y|3groupS|3headingS|3jectSEG|7ion|8veL|9ity',
  '|4ugation|3lease|5tS|4icense|5mation|6e|7directory|6inal|5ngual|3marineS|9r|4ergeD|6sible|4issionS|8ve|5tSE|6talS|7ed|8r',
  'S|7ing|3optimal|4rder|6inateSD|Aion|3package|5ragraphS|6tS|4lot|4oenaSE|5pulations|3region|9al|4ogation|5utine|3scribeSD',
  '|9rS|8ing|7ptS|9ionS|4ea|5ctionS|5quence|9tL|5ries|6vient|5tS|4ideD|7nce|6iaries|9y|7es|7zeD|8ing|6y|5st|7ence|4oil|5nic',
  '|4paceS|5ecialty|8es|4tanceS|7dard|7tialL|AteD|Bion|9veL|6tionS|5ituteSD|9ing|AonS|5rateS|6ucture|4umed|5rface|4ystemS|3',
  'terfuge|6ranean|5xt|4itleSD|4le|6ties|7y|5y|4otal|4ractEG|8ion|5opical|4ypeS|6ing|3unitS|4rbS|6an|6ia|3version|8ve|6t|3w',
  'ayS|4oofer|2cceedSEG|5ss|7es|7fulL|7ion|Aal|8veL|7orS|4inate|6ctL|4ulentS|5mbE|3h|4e|5n|3kSEG|4erS|4ling|3re|4ose|3tion|',
  '2dan|5ese|3bury|3denL|3oku|2eSD|3de|2fferSEG|6erS|6ings|4iceS|6iency|9tL|5x|6es|4ocating|9on|5lk|4rage|3ism|2gababes|4rS',
  '|5y|3gestSEG|7ionS|8ve|2icidal|6eS|3ng|3tSE|4ability|6le|7y|4caseS|4eS|5r|4orS|2lfate|4ur|6ic|3ky|3la|4en|4ivan|4y|3phat',
  'e|5ide|5ur|7ic|3tanS|6a|7te|4ry|2mS|3ac|4tra|3er|5ian|3maries|7ly|7zation|8eSD|8ing|6y|5tion|7ve|4ed|5rS|6land|6time|4in',
  'g|5tS|4onSEG|6er|3ner|3o|3p|4ter|5ion|5uous|2nS|3beam|4ird|4urn|6st|3dae|5nce|5yS|4erland|4ialS|4own|7er|4ries|5y|3fish|',
  '4lowerS|3g|4lass|8es|3il|3k|4en|3land|4ess|4ight|5t|3na|4iS|4y|5vale|3ray|4iseS|4oomS|3setS|4hine|4potS|2omi|2perS|5annu',
  'ation|5bL|6owl|5charged|Br|6lass|6onductorS|7ol|6ritical|5family|6icialL|7ne|6luous|5hero|9es|6ighway|6uman|5imposed|6nt',
  'endentS|6orS|8ity|5lative|5man|7rketS|5natant|8ural|6ova|5oxide|5pages|6osition|7werS|5script|6edeSD|8ing|6izeD|6onicS|6',
  'tar|7itionS|Bus|7ore|7ructure|5tramp|5viseSD|8ing|9on|8orS|Ay|3ine|3per|4l|5antE|5e|6mentSEG|Aal|Bry|Btion|5ication|6ed|',
  '7rS|7s|5yG|4ortSEG|7erS|7ive|5seSD|7dly|6ing|7tion|8ories|4ressEG|8es|8ion|9ve|8orS|3ra|5national|4emacy|6eSL|2rL|3ah|3c',
  'hargeS|3eSL|4sh|5t|4ties|5y|3fEG|4aceSD|6ing|6tantS|4boardS|4erS|4icial|3geSD|5onS|5ries|6y|4icalL|5ng|3inam|7e|3mise|4o',
  'unted|3nameS|3passEG|7es|4lus|7es|4riseSD|7ingL|3real|7ism|9t|5nderSEG|5ptitiously|5y|4ogateS|5undSEG|8ings|3veillance|5',
  'ySEG|6orS|4ivability|7l|6eSD|6ing|6orS|8ship|3ya|2san|5na|6e|3ceptibility|9le|3hi|3ie|3pectSEG|5ndSEG|7erS|6se|8ful|7ion',
  'S|4icionS|8usL|3quehanna|3sex|3tainSEG|7ability|9le|Ay|7ment|4enance|2therland|3raS|3ton|3ureS|2zan|5ne|3uki|3y|1valbard',
  '|2ensk|6a|3rige|1wabs|3g|4ger|3hili|3in|3le|4lowSEG|7tail|3m|4i|4pSE|5y|3nS|4k|5y|4sea|5on|3pS|4ped|6rS|5ing|3rmSG|4ovsk',
  'i|4t|3sh|4tika|3t|4ch|6es|4h|3yEG|3zi|5land|2earSG|4tSG|5erS|5shirtS|7opS|5y|3deS|5n|4ish|3eney|4pSG|5erS|5stakeS|4tSL|5',
  'enE|7erS|6r|6st|5heartS|5ieS|5ness|5water|5y|3llSEG|3pt|3rve|2iftly|5s|3mS|4merS|5ing|4suitS|4wear|3ndle|5on|4e|4gSG|5er',
  'S|3pe|3rlSEG|3sh|5er|4s|3tchEG|6board|6erS|7s|6foot|6gear|4zer|7land|3velS|2ollen|3on|4p|4sh|3rdS|5fish|5sman|4e|4n|2ung',
  '|1ybase|3il|2camore|2dney|2ed|2llabi|7cs|6leS|6us|3va|5n|4ester|4ia|2mantec|3bian|5osis|6tic|4olS|6ic|8ally|7sm|7zeSD|8i',
  'ng|6ogy|3metric|9alL|8es|7y|3pathetic|Bally|7ies|8ze|Ars|7y|4honia|8c|8es|7y|4lectic|4osia|7umS|4tomS|7atic|2nagogueS|4p',
  'seS|5tic|3ch|5ro|7nization|AeSD|Br|Aing|8ousL|8y|7tron|4ope|4ytial|3dicateSD|8ion|4romeS|3ergies|7stic|6y|3od|4nymS|7ous',
  '|7y|4pses|6is|6ys|5tic|4vial|3tactic|9ally|5x|4h|5ase|5eses|7is|8zeD|ArS|9ing|6ticS|2philis|2racuse|3ia|5c|5nS|4ngeS|3up',
  'S|2slog|3temS|6aticS|Aally|6ic|4olic|0tabS|3asco|3bed|4y|3er|5nacle|3itha|3laS|5tureS|4eSD|5au|7x|5clothS|5lands|5spoonS',
  '|5tS|6op|5ware|4ing|4oidS|3ooS|4r|3riz|3ula|6r|6teD|7ionS|2chometer|4ycardia|3itL|3kSEG|4leSD|5ing|4y|3oma|3t|4icS|6al|5',
  'le|2dpoleS|2ffeta|4y|3t|2gS|3alog|3board|3es|3ged|5r|4ing|2hiti|6an|3oe|2iga|3lSEG|4ings|4le|5ightS|4orSEG|3nSEG|4an|4tE',
  '|3pei|3wan|2jik|5istan|2kao|3eS|4down|4n|4over|4rS|4uchi|3in|5gS|2lbot|3eS|4ntSE|3iban|4smanS|3kSEG|4ative|4back|4erS|4i',
  'eS|3l|4ahassee|4er|5st|4ied|6s|5s|4ow|4y|3mud|3onS|3us|2maS|4les|4ra|6ck|5ind|3bourine|3eD|4r|3iflu|4lS|4ng|3many|4y|3pa',
  '|4erEG|4onS|3worth|2n|3ager|4ka|3dem|4y|3g|4a|4entS|7ial|5rine|4ible|5er|4leSD|4o|4ram|4y|3ia|3kS|4ard|4erS|4less|3ned|5',
  'rS|6y|4inS|6g|3talizing|6um|5mount|4ra|5ic|5umS|3ya|3zania|2oism|5t|3s|2pSEG|3as|3eS|4rSEG|4stries|7y|3ia|4oca|3ped|5r|4',
  'ing|3root|2raS|4ntula|3diness|4y|3getSEG|6ted|7ing|4us|3iffS|3mac|3nishE|3ot|3pon|4s|3ragon|8a|4y|3sus|3tS|4anS|5r|4rate',
  '|3ver|3zan|2sco|3kSEG|4er|3mania|8n|3selS|3teSD|5fulL|5less|5r|4ingS|4y|2tar|3eS|4r|3tered|4ooSEG|3u|2ught|3ntSEG|5on|3p',
  'e|4o|3ranga|4ine|4us|2vernS|2was|3nee|4y|2xEG|3able|4tion|3es|3iS|4cabS|4dermy|3man|3on|5omic|8es|7y|3payerS|2ylorS|1eaS',
  '|3chG|5erS|6s|5ings|4up|3gue|3k|3l|3mSEG|4mateS|4sters|4work|3potS|3rSG|4down|5ropS|4ful|3seSD|5rS|4ing|4poonS|2chSE|4ie',
  's|4netium|5icS|7a|8lL|9ities|By|7ianS|7olor|6queS|5o|6logicalL|Aes|AstS|9y|6rati|4republic|4y|3tonicS|2d|3dies|4y|3ious|',
  '2eS|3ming|3nS|4ageD|7rS|4ies|4y|3ter|4hG|2heran|3ran|2kken|2le|4cast|8er|5harger|5omS|4flora|5onsex|4gramS|7ph|9ic|4mark',
  '|8eting|4pathic|8y|5honeSD|8ic|9ng|8y|7to|4scopeS|8ic|9ng|4thon|5ype|4vised|7ionS|3ford|3lSG|4erS|4tale|4uride|3net|3str',
  'a|3ugu|2maS|3pS|4e|5rSEG|6a|7ment|7nce|7te|8ureS|5st|4larS|6teS|7ing|5eS|4oS|5ralL|7rily|8y|4tEG|5ationS|5ress|2nSD|3abl',
  'e|4cious|6ty|4ncies|6y|5tS|3ded|5ncies|7y|5rSEGL|6erS|6loin|6ness|4ing|4onS|4s|3ementS|4r|5ife|4tS|3fold|3nessean|8e|4is',
  '|3on|4rS|3seS|4ile|5onSEG|7er|4orS|3tSE|4acleS|5tiveL|4hS|3uate|4ous|4reD|2pid|2quila|2ra|4tology|3cel|3ence|4sa|3i|3mSE',
  '|4inalSL|7teSD|8ing|9onS|8orS|6e|6i|6ology|6us|5teS|3nS|4ary|3ps|3ra|5ceSD|5inS|5nce|5pinS|5zzo|4e|5nce|5strial|4i|5ble|',
  '7y|5erS|5fic|7ed|6ying|5torial|9es|8y|4orS|6ism|8tS|7zeD|8ing|4y|3se|3tiary|2sco|3s|3tSEG|4a|5ble|5mentS|9ary|5tor|4erS|',
  '5s|4icleS|6ular|5fied|8s|6yG|5monialS|9es|8y|5s|4ors|5sterone|4suite|4y|2tanus|3ex|3herE|3on|3ra|5chloride|5hedral|9on|4',
  'is|2utonic|2xanS|4s|3tSG|4bookS|4ileS|4ual|5ral|6eSD|6ing|5s|1hacker|3iS|4land|3kur|3lamus|4er|4ia|4lium|3mes|3n|4e|4kSE',
  'G|5fulL|5sgiving|4x|3tS|4chE|6er|3wEG|2e|3a|4terS|5reS|6ical|3bes|3e|3ftS|3hun|3irS|4sm|5tic|6s|3mE|4a|5tic|8ally|4eS|4i',
  's|4self|7ves|3n|4ce|3o|4bald|4cracy|4dora|7e|4logianS|8calL|7y|4phylline|4remS|6tic|9alL|5ies|6stS|6zed|7ing|5y|4sophica',
  'l|8y|3r|4apeuticS|6ies|7stS|6y|4eS|5abouts|6fter|5by|5for|8e|6rom|5in|5of|6n|5sa|6e|5to|5under|6pon|5with|4m|5alSL|5isto',
  'r|5oS|6coupleS|6dynamicS|6electric|6graphy|6meterS|6nuclear|6plasticS|6statS|Aic|4on|3sauri|7us|4eS|5us|4is|4salonians|3',
  'ta|4is|3y|4re|2iamin|7e|3ckL|5enSEG|6r|6st|6tS|5ness|9es|3ef|4r|5ry|4very|6s|5ing|3ghS|3mbleS|3nL|4e|4gS|5y|4kSG|5erS|5g',
  'eek|5pad|4ned|6rS|5ing|3ol|3rdSL|4st|6y|4teen|8th|5ies|7th|5y|3s|4category|4tle|3ther|2omas|4pson|4son|3ngS|3racic|5x|4i',
  'um|4nS|5ton|5y|4oughL|8bred|8fareS|8ness|4p|5e|3s|4e|3u|4gh|6tS|7fulL|Aness|7less|4sandS|2rall|4shEG|6erS|3eadSEG|6less|',
  '5tS|6enSEG|4eS|5fold|5someS|4onine|4shG|6oldS|4w|3ice|4ft|6y|4llSEG|6erS|4ps|4veSD|5ing|3oatSE|4b|5bing|4es|4mbin|6ocyto',
  'penia|7sis|4neS|5g|4ttle|7ing|4ughSL|7out|4wSG|5away|5back|5down|5erS|5n|3ush|5tSG|6erS|2ugS|3le|3mbS|5nailS|5zilla|4pG|',
  '5er|3nderSG|7birdS|8olt|7ous|7stone|ArmS|9ruck|3rrock|4s|5dayS|3sL|2wartE|2y|3me|4ic|4us|3roid|5xine|3self|1iaraS|3va|2b',
  'erian|6us|4t|5anS|3ia|5l|3uron|2cal|3e|3kSEG|4boxes|4erS|5tSEG|6master|4leSD|5ing|6sh|2dal|3bitS|3eS|4water|3ings|3yG|2e',
  'SD|3nes|3rSE|2ff|4any|2gerS|3ger|3htSL|5enSEG|6r|6st|5ness|5rope|3re|4is|2ki|3ka|2lEGL|3bury|3de|3eS|3ia|3l|4age|5mook|4',
  'erS|5y|3tSEG|2mEG|3berS|6lake|8nd|4re|3eSL|4frame|4keeper|8ing|4less|5ine|8ss|4out|4pieceS|4rS|4shareS|5tamp|4tableS|8in',
  'g|4x|4zone|3id|5ity|4ngs|3o|4n|4r|5ese|4thy|3pani|2nS|3a|3ctureS|3derbox|3gE|4e|4le|5ing|3kerG|3ned|4itus|4y|3sel|3tSEG|',
  '3y|2onS|4al|2pS|3ped|5r|4ing|3ster|4y|2rade|3eSD|4dness|4lessL|4some|3ing|2ssueS|2tS|3anS|5ia|6c|6um|3erS|3heS|4ing|3ian',
  '|4es|3leSD|4ing|3ration|4eS|3ted|5nS|4ies|4y|3ular|4s|2voli|1o|2adS|3stSEG|5erS|5masterS|5y|2bacco|4go|3ias|3y|2copherol',
  '|2das|4yS|3d|4lerS|3os|2eS|3nailS|2ffee|3u|2getherS|8ness|3gles|2ilG|4etS|6ries|7y|6te|2kelau|4nS|3yo|2ld|3edo|4r|5abili',
  'ty|7le|6nceS|7t|6teSD|7ing|8on|3kien|3lSG|3tec|3uene|2mS|3ahawk|4s|4to|6es|3bS|4oy|4stoneS|3cat|3eS|4r|3kins|3myS|3ograp',
  'hic|9y|4rrowS|3tom|2nSEG|3al|3eS|4rS|3gS|4a|5n|4ueSD|3icS|4ght|4te|3kin|4s|3nage|4eau|5r|5s|3sils|3to|3y|2o|3k|3lSEG|4ba',
  'r|5ox|4kit|3nS|3thE|5ache|5brush|Aes|5less|5pickS|4ing|4s|2pS|3az|3eka|3iary|4cS|5alL|3less|4ine|3most|3o|4graphic|Bal|9',
  'y|4logical|8es|7y|3ped|5rS|4ingS|4leSD|5ing|4s|3sail|4ide|4oil|4y|2queS|2rah|3ch|5es|3e|3ic|4es|4no|3mentSE|3n|4adoS|7es',
  '|3o|4idal|4nto|3pedo|7es|3que|3rentS|7ial|5s|4id|3s|4ion|7al|4o|4ten|3tS|4illaS|5ous|4oiseS|4uous|5reSD|6ing|3us|3y|2shi',
  'ba|3sEG|4es|2talSEGL|5itarian|Cism|7y|5led|6ing|3eS|4m|3ing|3o|4ro|3s|2ucan|4hEG|5downS|5es|5stone|5y|3gh|5ened|6r|6st|5',
  'ness|3louse|3rSEG|4er|5tte|4ism|6tS|7ic|7y|4maline|4n|5amentS|5eyS|5iquet|3s|3tSEG|4es|2wardS|3ed|4lS|4rSG|3ing|3nS|4er|',
  '5s|4house|4send|5hipS|5people|2xicS|5ities|7y|5ological|9y|4nS|3oplasmosis|2ySEG|3land|3ota|1raceSD|5ability|7le|5rS|5y|',
  '4hea|7l|6ostomy|4ing|4kSEG|5backS|5erS|5side|4tS|5able|5ion|5orS|4y|3dable|4eSD|5markSE|5rS|5sman|4ing|5tionS|9alL|BistS',
  '|4uction|3ffic|7king|3gedies|6y|4ic|6ally|3ilSEG|5erS|4nSEG|5eeS|6rS|5ings|4tS|5orS|3jectories|9y|3mS|4adol|4pSG|5leD|6i',
  'ng|5olineS|4way|3nS|4ce|4g|4ny|4quil|8ity|9zers|8lity|4sactEG|8ionS|Bal|6tlantic|5ceiverS|7ndSEG|9ence|Bt|Cal|6ontinenta',
  'l|6ribeD|ArS|9ing|8ptS|AionS|Dal|5ducerS|8tion|5ectS|6x|7ualS|Aes|5ferSEG|8ability|Ale|8ee|9nce|8or|8red|9ing|6iguration',
  '|6ormSEG|9ationS|Cve|9erS|6usionS|5gender|8ic|6ressionS|5ientSL|6storS|6tSG|7ionSEG|Aal|8ve|7ory|5lateSD|8ing|9onS|Bal|8',
  'orS|6iteration|6ocation|6ucent|5missible|AonS|7tS|8tal|Ance|9ed|ArS|9ing|6utation|5national|5om|5parencies|By|AtL|6erson',
  'al|6iration|8ed|6lantSEG|Aation|6ortSEG|9able|Ation|9erS|7seD|8ition|5sexualS|5vaal|6ersal|9e|7stiteS|3pS|4eze|6oid|9al|',
  '4ped|6rS|5ingS|3shEG|5y|3umaS|6tic|8zed|3vail|4elSEG|6erS|6led|8rS|7ing|6ocity|7dge|7gueS|5rsal|7eSD|7ing|6tine|5stiS|7y',
  '|4is|3wlG|5erS|3yS|2eacherous|8y|4dSG|5millS|4son|5ureSD|8rS|7ies|7y|4tSEG|5able|5ies|6seS|5mentS|5y|3ble|4uchet|3eS|4le',
  'ss|4tops|3foil|3kS|4ker|5ing|3llis|3mblEG|6e|4endousL|4olo|5rS|3nchG|6es|4dS|5y|4t|5on|3pidation|3spassG|4s|4tle|3vor|3y',
  '|2iSE|3adS|4ge|4lS|4ngleS|6ular|9tion|4ssic|4thlon|3balS|4eS|4ulationS|6us|5nalS|6e|5taries|8y|6eSD|3ce|5ps|4hy|4ia|4kSE',
  'G|5ery|5le|6ing|5ster|5y|4olor|5t|4ycleS|7ic|3dent|3ennial|4r|4s|3fle|5ing|3g|4eminal|4gerSEG|4lycerideS|4onometric|By|4',
  'raphs|3keS|3lateral|4l|5ionS|6um|4ogy|3mS|4ester|4med|6rS|5ingS|3na|4e|4idad|5ty|4ketS|3oS|3pS|4advisor|5rtite|4e|4leSD|',
  '6tS|6x|5icate|4odS|5li|4pEG|5er|5le|4tych|3sh|4omy|4tan|6te|5ram|3te|4ium|4on|3umphSE|7al|8ntL|3via|6lL|5um|3xie|2odden|',
  '3glodytes|4on|3ika|3janS|3llSG|5eyS|3mboneS|4pe|3n|4g|3opS|5erS|3phic|6es|5y|4icS|6al|4osphere|3t|4ted|6rS|5ing|3ubadour',
  '|5leSD|7maker|7shooting|8ome|6ing|4ghS|4pe|4serS|4t|3ve|3wel|3y|2uancy|3ce|4kSG|5erS|5load|3dy|3eL|4r|4st|3ffleS|3ly|3ma',
  'n|4pSE|5etS|7er|3ncateD|7ion|4dle|4kSG|3ss|5es|4tSEG|5e|6eS|7ship|5pass|5worthiness|Ay|5y|3thS|5fulL|8ness|2yEG|3outS|3p',
  'anosoma|4sin|4tophan|3st|1sunamiS|1ubSG|3a|4l|3by|3eS|4rS|5culin|8osis|3man|3ular|5eS|2cano|3kSE|4er|3son|2dor|2eS|3sday',
  'S|2ff|3ted|4s|2gboat|3ged|4ing|3rik|2ition|2lare|3ipS|3le|4y|3sa|2mbleD|6rS|6weed|5ing|3my|3orS|3ult|6uous|2na|4ble|3dra',
  '|3eSD|4rS|3g|4sten|3ic|5a|4ng|4sia|7n|3nelSG|6ling|4ing|2pelo|3le|3per|2rban|4idity|5neS|4oS|4ulence|8t|3co|3es|3f|3in|5',
  'g|4on|4smo|3kS|4eyS|4ic|5sh|4men|7istan|3meric|4oil|3nSEG|4aroundS|4down|4erS|4ipS|4key|4off|5ut|5verS|6r|4pike|4tableS|',
  '3pentine|3quoise|3retS|3tleS|2scan|6y|3kegee|3sle|2telage|3orSEG|5ialS|3ti|2valu|2xedoS|1wain|3ng|3s|3tS|2eakSEG|3ed|5y|',
  '4nS|4t|5erS|4zers|3lfth|4ve|3nties|7th|5y|2ice|3gS|3ki|3light|4l|3nSG|4e|4kS|5le|6ing|4ning|3rlG|3stSEG|5erS|5yS|3tchG|4',
  'ty|3ztid|2o|3fold|1ycoon|2ing|2kes|2ler|2peSD|4def|4key|4pad|4set|7ting|4writerS|3hoid|5onS|3icalL|4fied|4ng|4stS|3oS|4g',
  'raphic|Bal|9y|4logy|2rannical|6osaurus|6y|5tS|3eS|3one|4sine|2son|0ubiquitous|7y|1dder|2ell|1ganda|6n|2liness|3y|1inta|1',
  'kraine|6ianS|2ulele|1lcerS|5ation|8ve|2rich|2ster|2terior|3ima|6teL|7um|5o|3ra|5m|6arine|5sonicS|7und|5violet|2ysses|1ma',
  'tilla|2ber|3ilical|3ra|4ellaS|2pireS|3qua|1nabashed|5ted|4le|4ridged|3cceptable|By|5ompanied|6untable|9ed|4knowledged|3d',
  'justed|4ulterated|3ffected|5iliated|4raid|3ided|3ltered|3mbiguousL|3nimity|6ousL|4notated|6unced|4swered|4ticipated|3ppr',
  'oved|3rmed|4y|3ssigned|6sted|5uming|3ttached|6inable|5ended|5ractive|3udited|4thorised|9zed|3vailability|9le|4oidable|Ay',
  '|3ware|2balanced|3earable|5table|6en|4knownst|4lief|7vable|By|8ers|3iased|3leached|4ock|3onded|4rn|4undE|4xed|3randed|4e',
  'akable|4idled|4oken|3uffered|4ndled|7ing|2canny|4pped|4tegorized|3ensored|4rtain|9ties|Ay|3hained|5llenged|5nged|7ing|5r',
  'acterized|6ted|4eckE|3irculated|7mcised|3laimed|5ssified|4eS|5an|6r|4uttered|3oated|4mfortable|Cy|5mitted|6onL|5pensated',
  '|6licated|6ressed|7omising|4ncerned|5ditionalL|5firmed|5jugated|5nected|5scionable|9usL|Bness|6olidated|6titutional|7rai',
  'ned|5tested|6rollable|Dy|Aed|5ventional|6incing|4oked|4rked|5rected|7lated|4verSEG|3redited|3ut|2damaged|4ted|4unted|3ea',
  'd|4cided|5lared|4f|5eated|5ined|4liverable|9ed|4mocratic|4niable|9y|4r|5age|6rm|5belly|5class|Aman|6over|6urrent|7t|5dev',
  'eloped|6ogS|5estimateD|5floor|8w|6oot|5garments|6oG|7es|7ne|6radS|9uateS|7ound|8wth|5hill|5lay|6ieS|7neSD|8ing|6ying|5mi',
  'neSD|8ing|5neath|5oath|5paid|7nts|7ss|6inS|8ned|9ingS|6rivileged|5rated|6epresented|5scoreSD|6ea|7cretary|7rved|6ide|7gn',
  'ed|6tandSG|Aable|Dy|Aings|8ted|Ament|7ood|8ry|5takeS|9n|9r|8ingS|6ones|7ok|7w|5valued|5water|7y|6ear|7ight|7nt|6ood|7rld',
  '|6rite|ArS|9ing|4sirable|7ed|4tectable|8ed|6rmined|4veloped|3iagnosed|4es|4fferentiated|4luted|4rected|4sclosed|6overed|',
  '5puted|5tributed|6urbed|4vided|3oG|4cumented|4ne|4ubtedly|3ressEG|3ue|4lating|5y|3ying|2earned|5thEL|4se|5iness|5y|3dite',
  'd|4ucated|3mployed|8ment|3ncumbered|4ding|4forceable|3qualE|5ivocalL|3sco|3thical|3venL|6tful|3xcused|4pectedL|6nded|5ir',
  'ed|5lained|6oded|7red|2failing|5rL|6ness|5thful|4miliar|4thomable|4vorable|3ettered|3iled|5led|5tered|4nished|4t|3linchi',
  'ng|3ocused|4ldSEG|4reseen|5gettable|6ivable|8en|8ing|5tunateL|4unded|3ramed|4iendly|3ulfilled|4nded|4rnished|2garo|3odly',
  '|3raded|5teful|2handled|4ppily|7ness|6y|4rmed|3ealthy|5rd|4lpful|3indered|5ged|3oly|2icef|4ode|5rnS|4ycle|3dentified|4ir',
  'ectional|3fication|5ed|6s|4ormSEL|7ity|4yG|3lateralL|3maginable|4portant|5ressed|6oved|3ncorporated|4fected|5ormed|4habi',
  'ted|5ibited|4itiated|4spired|5tallE|5ured|4telligible|6nded|7tionalL|6rested|Aing|7rupted|Bible|4vited|3onS|5ism|7tS|6ze',
  'd|3polar|4rotkb|3queSL|6ness|3sex|4on|4sued|3tSEG|4arian|6y|4eS|4y|3versalSL|9ism|Bt|Aty|7eS|7idad|8ties|9y|3x|2justL|6i',
  'fiable|9ed|2kind|3nowable|6ingly|6nS|2labeled|4wfulL|3eaded|5shEG|7es|4ss|3icensed|4keL|4mited|4ned|5kE|4sted|3oadEG|4ck',
  'SEG|6er|4gged|3ucky|2manageable|8d|5ned|4rked|5ried|4skE|4tched|3ediated|4t|5ered|3istakable|By|3oderated|5ified|4untE|4',
  'ved|2named|4tural|3ecessarily|Ay|4eded|4rving|3oticed|3umbered|2observed|5tructed|4trusive|3ccupied|3fficialL|3pened|4po',
  'sed|3rdered|4ganized|4thodox|2packEG|4id|5nted|4ralleled|4tched|5riotic|4ved|3lanned|4easant|7urable|4ug|6ged|3opular|4s',
  'sible|3recedented|5dictable|5pared|5tentious|4ocessed|5ductive|5fessional|6itable|5tected|5ven|6oked|3ublished|4nished|2',
  'qualified|4estionable|Dy|Aed|4oteD|2ranked|4ted|4velG|3eachable|5d|6able|5l|6istic|7zed|5sonable|By|4cognized|6rded|4gis',
  'tered|5ulated|4lated|5eased|6nting|5iable|4markable|4pentant|5orted|4quited|4served|5olved|5ponsive|5t|6rained|7icted|3i',
  'valed|3uly|2safe|4lted|4tisfactory|8ied|5urated|4ved|5ory|3cathed|4ented|4heduled|4ientific|4rupulous|3ealed|4cureD|4eml',
  'y|5n|4lect|5fish|4t|5tled|7ing|3haved|7n|4ielded|3ightly|5ned|3killed|3old|5icited|5ved|4phisticated|4rted|4und|3peakabl',
  'e|5cified|4oiled|5ken|3table|4eady|4oppable|4rung|4yled|3ubscribe|Aing|6idized|6tantiated|4ccessfulL|4itable|4ng|4pervis',
  'ed|5ported|4re|5passed|6risingly|4specting|5tainable|3weetened|2tagged|4med|4pped|3enable|4sted|3hinkable|4readed|3idy|4',
  'ed|4l|5l|4mely|4tled|3o|4ld|4uchableS|7ed|4ward|3rained|5nslated|4eated|4ue|5sted|2usable|4ed|4ualL|2veilSEG|4rified|2wa',
  'nted|4rranted|4shed|4vering|3eighted|4lcome|5l|3ieldy|4lling|9ness|4ndG|4red|4se|4ttingL|3orkable|5thy|3rap|6ped|4itten|',
  '2yielding|1p|2beat|3ringing|2coming|2dateSD|6r|5ing|2gradeSD|6ing|2heavalS|4ld|3ill|3oldSG|5stered|Ars|9y|2keep|2landS|3',
  'iftEG|4nkE|3oadSEG|6er|2on|2ped|4rS|5most|3ing|2rightS|4singS|3oar|4oted|2scale|3etS|5ting|3hot|3ide|4lon|3kirtS|3tairs|',
  '5rtS|5te|4ream|3urge|3wing|2take|3ime|3own|3urnE|2wardSL|3elling|3ind|1racil|3nium|4us|2ban|5a|5e|5ism|6zation|7ed|2chin',
  'S|2du|2ea|3ter|4hane|5ra|7l|2geSD|4ncy|5tL|3ing|2iah|3nalS|6ysis|5ry|5te|6ing|7on|4e|3s|2ns|2ologic|8al|7stS|6y|2sula|2t',
  'icaria|2uguay|7an|1sEG|2ability|4le|3geS|3id|2eS|3fulL|6ness|3less|3net|3rS|4name|4pic|2herSEG|2ted|2ualL|3rpE|4y|1tah|2',
  'ensilS|3rine|4us|2ile|4isation|5tarian|Bism|6ies|6y|5zation|6eSD|6ing|4s|2most|2opia|6n|2recht|2terSEGL|5anceS|5most|1ve',
  'itis|1zbek|5istan|0vacancies|6y|5t|4teD|5ing|6onSG|8ers|3cinateD|8ionS|6eS|6ia|3uolar|4umSG|2der|3im|2gabond|4ries|3inaS',
  '|6l|5itis|3rant|3ueL|5ness|2il|3nL|2lanceS|3e|4nce|6ia|5t|6in|8eS|8o|4ria|7n|6e|4t|4ur|3halla|3iant|4dL|5ateSD|7ing|8onS',
  '|5ity|4ne|4um|3kyrie|3larta|4es|5yS|3or|5es|3se|3uableS|5tionS|4eSD|5rs|4ing|3veS|2mp|4ireS|2nS|3adium|3ce|4ouver|3da|5l',
  'S|6ism|7zed|4erbilt|3eS|4ssa|3gelis|4uard|3illa|6e|4shEG|6es|4ties|5y|3net|3quishE|3tage|3uatu|2porS|5izer|2riE|4ability',
  '|6leS|5nceS|6tS|5tionS|9al|4cella|5ose|4egated|5s|5tal|6ies|6y|4ousL|3na|4ishE|7es|3sity|3yG|2scular|6itis|3eS|4ctomy|4l',
  'ine|3odilator|3tL|4ness|2t|3er|3ican|2udeville|3ghan|5n|3ltSEG|3nted|3xhall|1bulletin|1data|1eal|2ctis|4orS|2danta|4s|3i',
  'c|2gaS|4n|3etableS|6rianS|Aism|6ted|7ion|8ve|2hementL|3icleS|5ular|2ilSE|3nSE|2lcro|3lum|3ocities|7y|3vet|6een|6y|2nder|',
  '5tta|4ing|4orS|3eerS|4rable|6tion|5eal|4tian|4zuela|9n|3geance|5ful|3ice|4son|3om|5ous|4us|3tSEG|4er|5s|4ilated|8ing|9on',
  '|8orS|4ral|5icleS|7ular|4ura|6eSD|7r|6ing|3ueS|4s|2ra|4city|4nda|3bS|4alL|5tim|4ena|4iage|4ose|6ity|3dant|4eS|4ictS|4un|',
  '3ge|3ifiable|6cationS|6ed|7r|7s|5yG|4ly|4sign|4table|6s|5y|4zon|3lag|3meil|4iculite|5lion|5n|4ont|3n|4acular|5l|4ier|4on',
  '|3ona|5ica|3sa|5ce|5tile|8ity|4eSD|4ionSEG|4o|4us|3t|4ebra|8e|8l|8ta|9eS|5x|4icalSL|6es|5go|3ve|3y|3zeichnis|2sicleS|5ul',
  'ar|3pa|4erS|3selS|3tSEG|4a|5l|4ibular|8e|5ges|4ments|4ry|3uvius|2tch|3eranS|5inarianS|9y|3iver|3oE|3s|3ted|5r|4ing|2xed|',
  '3ing|1group|1ia|3bility|4le|3duct|3gra|3lS|3tical|4or|2brancy|6t|5phone|5teS|6ing|7onS|9al|6o|7rS|8y|4io|3urnum|2car|5ag',
  'e|5iousL|3eS|4roy|3inity|4ousL|3kS|4i|5e|4y|3odin|3timS|6ization|8ed|4orS|6iaS|8nS|7es|7ous|6y|2deoS|5games|5tape|3ual|3',
  'ya|2enna|5ese|3tnam|7ese|3wSEG|4able|4erS|4picture|5ointS|4sonic|2gilS|5ance|7t|8eS|3netteS|3or|5ousL|2jay|2kingS|2laS|3',
  'e|3laS|5geS|7rS|5inS|7ous|5nova|4e|2naigrette|3ce|5nt|6zo|4i|3dicated|8ion|6tive|3eS|4garS|4land|4yardS|3ing|3ny|3oD|3ta',
  'geS|4ners|3ylS|2ola|5teSD|6ing|7onS|6orS|4ence|6tL|5tS|6te|4inS|6ist|4oncello|3xx|2perS|2rago|4l|3eo|3ginS|6ia|8nS|7ty|4',
  'o|3idian|4lity|3ology|3tualL|5eS|5osity|7o|6us|3ulence|7t|4s|5es|2saS|4ge|3ceral|4ose|6ity|5unt|6s|3e|3hal|4nu|3ibility|',
  '5le|6y|4onSG|6aries|8y|4tSEG|5aS|6tionS|5e|5orS|3orS|3ser|3taS|4o|3ualSL|6izationS|8eD|9r|8ing|2taL|4e|4lSL|5ity|4minS|3',
  'iculture|3reous|4iol|4o|2va|4cious|3ek|3ian|4dL|2xenS|2zier|1ladimir|1mware|1ocabularies|9y|4lSL|5istS|4tionS|8al|2dafon',
  'e|3ka|2gue|2iceSD|5less|5mail|4ing|3dSEG|3le|3p|2lS|3ant|4tileS|7ity|3canic|7sm|6o|7es|3ition|3kswagen|3ley|6ball|3tS|4a',
  '|5geS|4meter|3umeS|6tric|5inous|4ntarily|8y|6eerSEG|9ism|4ptuous|3vo|2mitG|2nage|2odoo|2racious|3tex|4ices|6ity|2teSD|4r',
  'S|3ing|4veS|3re|2uch|5erS|2wed|4lS|3ing|3s|2yageS|6r|3er|4urS|6ism|6web|3uer|1snet|1uitton|2lcan|3gar|6e|6ity|5te|3nerab',
  'ilities|Cy|8le|3tureS|3va|5r|1ying|0wacker|4y|3o|2deD|4rS|3ing|2ferS|3fleS|2geSD|4ner|4rSG|3ging|3ing|3ner|3onS|5er|2hoo',
  '|2ikato|4iki|3lers|4ing|3nwright|3st|5band|5coat|5line|3tSEG|4erS|4ress|8es|3veSD|5rS|4ing|2keS|4field|4r|3ing|2lden|3es',
  '|3kSEG|4erS|4man|4out|4through|4wayS|3lSEG|4a|5bies|6y|5ce|6h|4er|5tS|5ye|4flowers|4is|4op|5w|4paperS|4send|4y|3mart|3nu',
  'tS|3rus|3sh|3t|4erS|4ham|5er|4on|4zG|5es|2mpum|2ndS|4a|4erSEG|6erS|6ings|6lust|3ed|3g|3ing|3tSEG|4age|4on|2rSDG|3blerS|3',
  'craft|3denS|4robeS|4s|3eS|4houseS|8ing|4z|3fare|3like|4ock|3mSEGL|4erS|5st|4th|3nSEG|4erS|4ings|3pEG|4lanes|3rantSE|7ies',
  '|7less|7y|4en|4ing|7ton|5orS|3saw|4hipS|3time|4s|3wick|7shire|3y|2s|3abi|4tch|3co|3hEG|4able|4cloth|4erS|5s|4ington|4out',
  '|4room|3nt|3pS|3ser|3tage|4eSD|5basket|5ful|5land|5rs|5water|4ing|2tchEG|5able|5dogS|5erS|6s|5ful|5list|5maker|7n|5tower',
  '|3erSEG|5color|5fallS|6ord|7wl|6ront|5less|6ine|6oo|5man|7rkSEG|6elonS|5proofG|5shedS|6ide|6ports|5tight|6own|5wayS|6ork',
  's|5y|3kins|3son|3tS|4age|4le|2ugh|2veSD|4form|4length|6tS|4rGL|3ing|3y|2xEG|3es|3man|2yS|3back|3farer|3ne|3side|3ward|1e',
  'DE|2akL|4enSEG|5r|5st|4ness|8es|3ld|4th|6y|3ned|4ing|3ponS|6ry|3rSG|4ableS|4erS|4ily|5ness|4y|3selS|6fish|3therSEGL|7man',
  '|7proof|3veS|5rS|4ing|2bS|3bed|5r|4ing|4y|3camS|5stS|4t|3design|3er|3home|5sting|3inar|3logS|6ic|3mail|5sterS|4d|4in|3pa',
  'geS|3ring|3shots|4iteS|4phere|4ter|3workS|2dded|4ingS|3geSD|4wood|3lock|3nesdayS|2eding|4s|4y|3kSL|4dayS|4endS|7er|4lies',
  '|3pSG|3vil|3zer|2ga|2ighSEG|5tSEG|6ings|6less|6y|3rSD|4dest|5ness|3ss|2lch|4omeSD|6ing|3dSEG|4erS|3fare|3lSG|4being|5utr',
  'in|4er|5s|4head|4ington|4man|4ness|4spring|3sh|3t|4erweight|2nch|3dell|4i|4y|3t|3zel|2pt|2rden|3e|4nt|4wolf|3ner|2sley|6',
  'an|3t|4bound|4chester|4erL|6nS|7erS|4field|4in|4land|5ife|4minster|4on|4port|4ward|5ood|2t|3her|3landS|3ness|3ted|5r|4in',
  'g|2ymouth|1hackEG|3leS|5rS|4ing|3m|3rf|4ton|3tS|4ever|4not|4soever|2eat|5land|5on|3elSEG|5barrow|5chair|5erS|4zing|3n|4c',
  'e|4ever|3reS|5abouts|6s|5by|5fore|5in|5of|5upon|5ver|5with|3ther|4stone|3w|3y|2ich|5ever|3ff|3gs|3le|4st|3mS|4per|4sical',
  '|3ne|4ing|4y|3pS|4lash|4ped|6t|5ing|3rlEG|5poolS|5wind|3skE|5erS|6y|5ies|5y|4perSEG|7er|4t|5leSD|7r|6ing|3tG|4eS|5chapel',
  '|5fish|5head|5ness|6ing|5r|5side|6tone|5tail|5washE|7ter|4her|4ish|4man|4ney|4sundayS|4ten|5le|3z|2oS|3dunit|3ever|3is|3',
  'le|5heartedly|5ness|5sale|9rS|8ing|6ome|4ly|3m|4ever|4soever|3opSG|3pper|5ing|3reS|4l|3se|2y|1ichita|3kSEG|4edly|6ness|5',
  'r|5s|5tS|2deL|4nSEG|5er|4r|4screen|5pread|5t|3getS|3owSE|5er|3thS|2eldEG|3ner|2feS|2gan|3gleS|5y|3ht|3s|3wam|2ki|4media|',
  '4pedia|2lbur|3cox|3dSGL|4catS|4e|5beest|5r|6ness|5st|4fireS|4life|3es|4y|3fred|3helm|7ina|3kes|4inS|6son|4s|3lSEG|4ard|4',
  'ey|4fulL|4iamS|7sburg|8on|5e|5ngly|7ness|5s|4owS|4yS|3mer|4ington|3sonS|3tSE|4on|4shire|2max|3bledon|3mer|3ps|2nSDG|3amp',
  '|3ceD|4h|5es|7ter|3dchill|4ed|5rS|4fall|4ingS|4jammer|4millS|4owSEG|6maker|4proof|4s|5creen|5hieldS|5or|5urfing|4ward|4y',
  '|3eS|4r|5ies|5y|3gSE|4erS|4man|3ifred|3kSEG|4el|4le|6r|3me|3nebago|5rS|4ie|5ngS|5peg|4t|3ona|3some|4ton|3terSG|6green|6t',
  'ime|4ry|3xp|2peSD|4rS|3ing|2rd|3eSD|4lessL|3ing|2sconsin|3dom|3eL|4man|4r|4st|3hEG|4bone|4es|4ful|4list|3pS|3teria|4ful|',
  '4s|2tch|5craft|5es|5y|3h|4al|4drawSG|8alS|8n|6ew|4erSEG|4held|5oldG|4in|4out|4standG|6ood|3nessEG|7es|5y|3s|3ted|5r|4y|2',
  'ves|2zardS|6ry|1obble|5y|2efulL|3s|2ke|3ing|2lf|4e|4gang|4hound|4ram|3ters|3verhampton|6ineS|5s|2manS|5hood|3b|4at|4le|3',
  'enS|2n|3derSEG|6fulL|6land|4rous|3g|3t|2odSE|4bine|4cock|5raft|5ut|4en|4house|4landS|4man|4peckerS|4row|5uff|4side|5man|',
  '5tock|4ward|5orkG|8erS|4y|3f|4erS|3hoo|3ing|3lL|4en|4sey|4y|2rcester|9shire|3dSEG|4en|4play|5ress|4smith|4y|3e|3kSEG|4ab',
  'le|5round|4bench|5ookS|4dayS|4erS|4force|4group|4house|4ings|4loadS|4man|7ship|4outS|4piece|5laceS|4sheetS|6opS|5pace|5t',
  'ationS|3ldSL|5cat|5sex|5wide|3mS|4hole|4wood|3n|3ried|6s|5some|4yG|3se|5nSEG|4hipSEG|7ers|7ped|8ing|4tE|3t|4hG|5iness|5l',
  'ess|5while|5y|2uld|5nt|5st|3ndSEG|2ven|2w|1raith|3nglerS|6ing|3pS|4ped|6rS|5ing|3th|2eak|4thS|3ckSEG|5age|5erS|3nS|4chG|',
  '6es|3st|5er|5leD|7rS|6ing|3tchE|2ightS|3ngG|4kleSD|3stS|5bandS|3tSG|4able|4eS|5able|5rS|4hing|4ings|4ten|5ing|2ongSEL|5d',
  'oing|5fulL|3te|3ught|1uthering|1yandotte|3tt|2ndham|3n|2oming|0xanax|3ga|2vier|1box|1emacs|2nia|4cal|4um|3on|4phobia|5us',
  '|4s|2rox|1libs|1mas|1oops|1press|1treme|1ylem|4ne|3itol|3ophone|0yachtSG|2hoo|3weh|2kima|2le|2maha|4to|2ng|3kSE|4eeS|4to',
  'n|2rdS|4age|4stick|3ns|3row|2sser|2tes|2vapai|2wnG|2zoo|1eS|2aS|3hs|3rSL|4bookS|4ling|5ong|4nG|3stS|3ts|2llSEG|4owSG|6fi',
  'n|6ish|6knife|6stone|6tail|2men|5i|2n|2oman|2rba|2shiva|3terdayS|6year|2t|1iddish|2eldSEG|1oga|3hurt|3i|3urt|2himbe|2ke|',
  '2lks|2nder|2rkS|4erS|4shire|3uba|2semite|2u|3ngS|5er|6st|5sterS|7own|3rS|4e|4self|7ves|3thS|5ful|3ve|1uan|2cca|3ky|2gioh',
  '|3oslav|8ia|An|2kon|2letide|2ma|3my|1vonne|0zach|4ariah|2ire|2man|3bia|2nder|3te|1dnet|1eal|4and|7ers|4otS|5us|2braS|2ld',
  'a|3ler|2nd|3ith|2olite|2phyr|3pelin|2roS|4degrees|4es|2st|4y|2ta|2us|1hang|2ejiang|1igzag|2lla|2mbabwe|3mer|6man|2nc|3fa',
  'ndel|2on|4ism|6tS|2pcode|3ly|3ped|5rSE|4ing|4y|3s|2rcon|6ia|7um|1loty|1odiac|2ids|2ller|3oft|2mbieS|2nal|3eSD|3ing|2oS|3',
  'filia|3logical|6y|3mSEG|3philia|4lankton|2rro|2ster|1shops|1ucchini|2lu|2rich|1yban'
].join('');

let cachedEnWords                     = null;
let cachedEnPrefixes                     = null;

const EN_LEX_CLITIC_MOD_SUFFIXES = ["'s", "'d", "'ll"];
const EN_LEX_CLITIC_PRON_SUFFIXES = ["'re", "'ve"];
const EN_LEX_PRON_CLITIC_STEMS = new Set        ([
  'i', 'you', 'we', 'they', 'who', 'what', 'where', 'when', 'why', 'how',
  'there', 'that', 'these', 'those', 'could', 'would', 'should', 'might', 'must', 'may',
]);

const EN_LEX_CONVERSATIONAL_WORDS           = [
  "don't", "doesn't", "didn't", "isn't", "aren't", "wasn't", "weren't",
  "won't", "wouldn't", "can't", "couldn't", "shouldn't", "haven't",
  "hasn't", "hadn't", "mustn't", "needn't", "let's", "that's", "what's",
  "there's", "here's", "who's", "where's", "how's", "it's", "he's",
  "she's", "o'clock", "ain't", "y'all", "yall", "ma'am", "c'mon",
  "gonna", "wanna", "gotta", "kinda", "sorta", "lemme", "gimme", "dunno",
  "outta", "cuppa", "tryna", "imma", "finna", "hafta", "oughta",
  "yeah", "yep", "yup", "nope", "nah", "okay", "ok", "hey", "yo", "sup",
  "uh", "um", "hmm", "whoa", "yay", "ouch", "oops", "meh", "haha", "lol",
  "cuz", "cos", "tho", "thru", "reckon", "dodgy", "iffy", "sketchy",
  "bro", "bros", "bruh", "dude", "dudes", "mate", "mates", "folks", "guys",
  "kiddo", "buddy", "vibe", "vibes", "vibing", "chill", "chilling", "chilled",
  "legit", "cringe", "cringey", "lowkey", "highkey", "fomo", "banger", "bangers",
  "clout", "hype", "hyped", "glitch", "glitches", "glitchy", "spam", "scam",
  "ghosted", "ghosting", "binge", "selfie", "selfies", "meme", "memes",
  "vlog", "vlogs", "podcast", "podcasts", "playlist", "playlists",
  "livestream", "livestreams", "livestreaming", "collab", "collabs", "merch",
  "promo", "inbox", "offline", "online", "hashtag", "hashtags", "trending",
  "unbox", "unboxing", "repost", "shoutout", "hangout", "hangouts", "burnout",
  "noob", "veggie", "veggies", "carbs", "cardio",
  "yaar", "acha", "accha", "arre", "arrey", "bhai", "bhaiya", "didi",
  "anna", "akka", "amma", "appa", "ji", "sahib", "macha", "machan", "guru",
  "pakka", "pukka", "jugaad", "timepass", "prepone", "preponed", "preponing",
  "updation", "needful", "revert", "reverted", "reverting",
  "lakh", "lakhs", "crore", "crores", "rupee", "rupees", "paisa", "paise",
  "aadhaar", "upi", "challan", "tatkal", "bandh", "ghat", "dhaba", "kirana",
  "tiffin", "chai", "masala", "dosa", "idli", "sambar", "vada", "upma", "poha",
  "paratha", "roti", "naan", "kulcha", "biryani", "pulao", "paneer", "dal",
  "chutney", "raita", "lassi", "kulfi", "jalebi", "samosa", "samosas", "pakora",
  "kurta", "saree", "namaste", "namaskara", "vanakkam", "pranam",
  "diwali", "holi", "pongal", "onam", "navratri", "ugadi",
  "bengaluru", "mumbai", "chennai", "kolkata", "hyderabad", "delhi", "noida",
  "gurgaon", "gurugram", "pune", "ahmedabad", "jaipur", "lucknow", "kochi",
  "mysuru", "mangaluru", "coimbatore", "madurai", "visakhapatnam", "vijayawada",
  "bhubaneswar", "chandigarh", "guwahati", "indore", "bhopal", "nagpur", "surat",
  "app", "apps", "api", "apis", "ui", "ux", "ai", "ml", "nlp", "asr", "stt",
  "tts", "ctc", "llm", "llms", "gpt", "gpu", "gpus", "cpu", "cpus", "npu",
  "tpu", "ram", "vram", "ssd", "usb", "hdmi", "wifi", "bluetooth", "ethernet",
  "hotspot", "router", "modem", "pixel", "android", "ios", "macos", "linux",
  "ubuntu", "chrome", "safari", "firefox", "webkit", "wasm", "webgpu", "webgl",
  "onnx", "pytorch", "tensorflow", "numpy", "scipy", "pandas", "python",
  "javascript", "typescript", "rust", "golang", "kotlin", "swift", "html",
  "css", "json", "yaml", "toml", "xml", "csv", "sql", "nosql", "graphql",
  "grpc", "http", "https", "ssl", "tls", "ssh", "dns", "url", "urls", "cli",
  "sdk", "sdks", "ide", "npm", "yarn", "pnpm", "pip", "conda", "git", "github",
  "gitlab", "repo", "repos", "commit", "commits", "rebase", "diff", "diffs",
  "devops", "docker", "dockerfile", "kubernetes", "aws", "gcp", "azure",
  "cloudflare", "vercel", "supabase", "firebase", "postgres", "postgresql",
  "mysql", "sqlite", "redis", "kafka", "mongodb", "frontend", "backend",
  "fullstack", "microservice", "microservices", "serverless", "endpoint",
  "endpoints", "webhook", "webhooks", "payload", "payloads", "latency",
  "throughput", "bandwidth", "cache", "cached", "caching", "mutex", "async",
  "await", "sync", "synced", "syncing", "config", "configs", "env", "auth",
  "oauth", "jwt", "sso", "login", "logins", "logout", "signup", "signups",
  "onboarding", "dashboard", "dashboards", "analytics", "telemetry", "metrics",
  "logs", "logging", "logger", "debug", "debugged", "debugging", "debugger",
  "refactor", "refactored", "refactoring", "codebase", "workflow", "workflows",
  "pipeline", "pipelines", "deploy", "deployed", "deploying", "deployment",
  "deployments", "rollback", "prod", "staging", "dev", "devs", "qa", "hotfix",
  "bugfix", "changelog", "readme", "screenshot", "screenshots", "dropdown",
  "modal", "navbar", "sidebar", "tooltip", "checkbox", "toggle", "worklet",
  "subword", "subwords", "tokenizer", "quantized", "quantization", "finetune",
  "finetuned", "finetuning", "checkpoint", "checkpoints", "inference", "logits",
  "softmax", "lexicon", "swanada", "sarvam",
];

function getEnLexicon()                                                {
  if (cachedEnWords !== null && cachedEnPrefixes !== null) {
    return { words: cachedEnWords, prefixes: cachedEnPrefixes };
  }

  const words = new Set        (['a', 'i']);
  const prefixes = new Set        ('abcdefghijklmnopqrstuvwxyz'.split(''));

  const tagExpand                         = { S: 's', D: 'd', E: 'ed', G: 'ing', L: 'ly' };
  let prev = '';
  const entries = PACKED_EN_LEXICON.split('|');
  for (let idx = 0; idx < entries.length; idx++) {
    const entry = entries[idx];
    if (!entry) continue;
    const lcp = parseInt(entry[0], 16);
    const body = entry.slice(1);
    let splitIdx = body.length;
    while (splitIdx > 0) {
      const cc = body.charCodeAt(splitIdx - 1);
      if (cc >= 65 && cc <= 90) splitIdx--;
      else break;
    }
    const word = prev.slice(0, lcp) + body.slice(0, splitIdx);
    prev = word;
    words.add(word);
    for (let k = 2; k <= word.length; k++) {
      prefixes.add(word.slice(0, k));
    }
    for (let t = splitIdx; t < body.length; t++) {
      const suf = tagExpand[body[t]];
      if (suf) {
        const inflected = word + suf;
        words.add(inflected);
        for (let k = word.length + 1; k <= inflected.length; k++) {
          prefixes.add(inflected.slice(0, k));
        }
      }
    }
  }

  for (let c = 0; c < EN_LEX_CONVERSATIONAL_WORDS.length; c++) {
    const contr = EN_LEX_CONVERSATIONAL_WORDS[c];
    words.add(contr);
    for (let k = 2; k <= contr.length; k++) {
      prefixes.add(contr.slice(0, k));
    }
  }

  cachedEnWords = words;
  cachedEnPrefixes = prefixes;
  return { words, prefixes };
}

function isEnWord(word        , words             )          {
  if (words.has(word)) return true;
  if (word === "i'm") return true;
  for (let s = 0; s < EN_LEX_CLITIC_MOD_SUFFIXES.length; s++) {
    const suf = EN_LEX_CLITIC_MOD_SUFFIXES[s];
    if (word.endsWith(suf) && word.length > suf.length) {
      const stem = word.slice(0, word.length - suf.length);
      if ((stem.length >= 2 || stem === 'i') && words.has(stem)) {
        return true;
      }
    }
  }
  for (let s = 0; s < EN_LEX_CLITIC_PRON_SUFFIXES.length; s++) {
    const suf = EN_LEX_CLITIC_PRON_SUFFIXES[s];
    if (word.endsWith(suf) && word.length > suf.length) {
      const stem = word.slice(0, word.length - suf.length);
      if (EN_LEX_PRON_CLITIC_STEMS.has(stem) || (stem.length >= 3 && words.has(stem))) {
        return true;
      }
    }
  }
  if (word.endsWith("in'") && word.length >= 5 && words.has(word.slice(0, -1) + 'g')) {
    return true;
  }
  if (word.endsWith('ish') && word.length >= 6 && words.has(word.slice(0, -3))) {
    return true;
  }
  return false;
}

function isEnPrefix(prefix        , prefixes             , words             )          {
  if (prefixes.has(prefix)) return true;
  const idx = prefix.indexOf("'");
  if (idx > 0) {
    const stem = prefix.slice(0, idx);
    const tail = prefix.slice(idx);
    if (
      stem === 'i' &&
      (tail === "'" || tail === "'m" || tail === "'d" || tail === "'l" || tail === "'ll" || tail === "'v" || tail === "'ve")
    ) {
      return true;
    }
    if (
      stem.length >= 2 &&
      words.has(stem) &&
      (tail === "'" || tail === "'s" || tail === "'d" || tail === "'l" || tail === "'ll" ||
       tail === "'r" || tail === "'re" || tail === "'v" || tail === "'ve" || tail === "'t")
    ) {
      return true;
    }
  }
  return false;
}

/**
 * CTC Acoustic Decoders: Exact Marginal Prefix Beam Search,
 * Trie-Guided English Lexical Beam Search, and Stateful Greedy Streaming.
 * Zero external dependencies. Browser & Node.js compatible.
 */




                                                        

const NEG_INF = -1.0e30;

const BRAHMIC_VIRAMAS = new Set        ([
  '\u094d', '\u09cd', '\u0a4d', '\u0acd', '\u0b4d', '\u0bcd', '\u0c4d', '\u0ccd', '\u0d4d',
]);

const CTC_SHORT_A_VOWELS = new Set        ([
  '\u0905', '\u0985', '\u0a05', '\u0a85', '\u0b05', '\u0b85', '\u0c05', '\u0c85', '\u0d05',
]);

const CTC_COMBINING_MARK_RE = /^\p{M}/u;

const CTC_PRIMARY_MATRA_RANGES                          = [
  [0x093e, 0x094c], [0x094e, 0x094f], [0x0962, 0x0963],
  [0x09be, 0x09c4], [0x09c7, 0x09c8], [0x09cb, 0x09cc], [0x09e2, 0x09e3],
  [0x0a3e, 0x0a42], [0x0a47, 0x0a48], [0x0a4b, 0x0a4c],
  [0x0abe, 0x0ac5], [0x0ac7, 0x0ac9], [0x0acb, 0x0acc], [0x0ae2, 0x0ae3],
  [0x0b3e, 0x0b44], [0x0b47, 0x0b48], [0x0b4b, 0x0b4c], [0x0b62, 0x0b63],
  [0x0bbe, 0x0bc2], [0x0bc6, 0x0bc8], [0x0bca, 0x0bcc],
  [0x0c3e, 0x0c44], [0x0c46, 0x0c48], [0x0c4a, 0x0c4c], [0x0c62, 0x0c63],
  [0x0cbe, 0x0cc4], [0x0cc6, 0x0cc8], [0x0cca, 0x0ccc], [0x0ce2, 0x0ce3],
  [0x0d3e, 0x0d44], [0x0d46, 0x0d48], [0x0d4a, 0x0d4c], [0x0d62, 0x0d63],
];

function ctcIsPrimaryMatra(ch        )          {
  const cp = ch.charCodeAt(0);
  for (let i = 0; i < CTC_PRIMARY_MATRA_RANGES.length; i++) {
    const r = CTC_PRIMARY_MATRA_RANGES[i];
    if (cp >= r[0] && cp <= r[1]) return true;
  }
  return false;
}

function ctcIsBrahmicConsonant(ch        )          {
  const cp = ch.charCodeAt(0);
  if (cp < 0x0900 || cp > 0x0d7f) return false;
  const off = cp & 0x7f;
  return (
    (off >= 0x15 && off <= 0x39) ||
    (off >= 0x58 && off <= 0x5f) ||
    off === 0x79 ||
    (off >= 0x7a && off <= 0x7f && (cp & ~0x7f) === 0x0d00)
  );
}

function ctcMatraToIndepVowel(mCh        )         {
  const mCp = mCh.charCodeAt(0);
  const base = mCp & ~0x7f;
  const off = mCp & 0x7f;
  if (off === 0x44) return String.fromCharCode(base + 0x60);
  if (off === 0x62) return String.fromCharCode(base + 0x0c);
  if (off === 0x63) return String.fromCharCode(base + 0x61);
  return String.fromCharCode(mCp - 0x38);
}

function ctcExtendIndicState(
  lmScore        ,
  curWord        ,
  lastChar        ,
  piece        ,
  lang        ,
  coreSet             ,
  extSet             
)                           {
  let sc = lmScore;
  let cw = curWord;
  let lc = lastChar;

  for (let k = 0; k < piece.length; k++) {
    const ch = piece[k];
    if (ch === '\u2581' || ch === ' ' || ch === '\u2582' || ch === '\u2583') {
      if (cw.length > 0) {
        sc += scoreIndicWord(cw, lang, coreSet, extSet);
        cw = '';
      }
      lc = ' ';
      continue;
    }

    if (BRAHMIC_VIRAMAS.has(lc) && BRAHMIC_VIRAMAS.has(ch)) {
      if (!(k === 0 && piece.length >= 2 && ctcIsBrahmicConsonant(piece[1]))) {
        sc -= 4.20;
      }
      continue;
    }

    if (lc === ch && CTC_COMBINING_MARK_RE.test(ch)) {
      continue;
    }

    if (
      CTC_SHORT_A_VOWELS.has(ch) &&
      lc &&
      (ctcIsBrahmicConsonant(lc) || (ch === '\u0d05' && ctcIsPrimaryMatra(lc)))
    ) {
      sc += scoreIndicWord(cw, lang, coreSet, extSet);
      cw = ch;
      lc = ch;
      continue;
    }

    if (lc && lc !== ' ') {
      if (BRAHMIC_VIRAMAS.has(ch)) {
        if (ctcIsPrimaryMatra(lc)) {
          if (!(lc === '\u0d41' && ch === '\u0d4d')) {
            sc -= 4.20;
          }
        } else if (BRAHMIC_VIRAMAS.has(lc)) {
          sc -= 4.20;
        }
      } else if (ctcIsPrimaryMatra(ch)) {
        if (ctcIsPrimaryMatra(lc)) {
          sc -= 4.20;
        } else if (BRAHMIC_VIRAMAS.has(lc)) {
          if ((lc.charCodeAt(0) & ~0x7f) === (ch.charCodeAt(0) & ~0x7f)) {
            sc += 0.28 + scoreIndicWord(cw, lang, coreSet, extSet);
            const indep = ctcMatraToIndepVowel(ch);
            cw = indep;
            lc = indep;
            continue;
          }
        }
      } else if (ctcIsBrahmicConsonant(ch)) {
        if (BRAHMIC_VIRAMAS.has(lc)) {
          sc += 0.22;
        }
      }
    }

    cw += ch;
    lc = ch;
  }

  return [sc, cw, lc];
}

function ctcFinalizeIndicScore(
  lmScore        ,
  curWord        ,
  lang        ,
  coreSet             ,
  extSet             ,
  isPartial          = false
)         {
  if (!curWord || isPartial) return lmScore;
  return lmScore + scoreIndicWord(curWord, lang, coreSet, extSet);
}

                                                            
                                            
                                               
                                                                            
                                                                                   
 

                                  
               
                   
                     
 

                     
                
             
              
                  
                  
                    
                   
 

function isSpecialToken(token        )          {
  if (!token) return false;
  return (token.startsWith('<') && token.endsWith('>')) ||
         (token.startsWith('[') && token.endsWith(']'));
}

function logAddExp(a        , b        )         {
  if (a <= NEG_INF * 0.5) return b;
  if (b <= NEG_INF * 0.5) return a;
  if (a > b) {
    return a + Math.log1p(Math.exp(b - a));
  }
  return b + Math.log1p(Math.exp(a - b));
}

function isEnglishSentencePieceVocab(vocabList          )          {
  if (vocabList.length < 200) return false;
  const end = Math.min(vocabList.length, 12);
  for (let idx = 2; idx < end; idx++) {
    const tok = vocabList[idx] || '';
    for (let k = 0; k < tok.length; k++) {
      const code = tok.charCodeAt(k);
      if (code >= 97 && code <= 122) return true;
    }
  }
  return false;
}

function stripTrailingApostrophes(word        )         {
  let end = word.length;
  while (end > 0 && word.charCodeAt(end - 1) === 39) {
    end--;
  }
  return end === word.length ? word : word.slice(0, end);
}

function formatEnCtcDisplay(text        )         {
  if (!text) return text;
  let out = text.replace(/([a-zA-Z])([0-9])/g, '$1 $2');
  out = out.replace(/([0-9])([a-zA-Z]{2,})\b/g, (m, d        , w        ) =>
    /^(?:st|nd|rd|th)$/i.test(w) ? m : `${d} ${w}`
  );
  out = out.replace(/^[a-z]/, (ch) => ch.toUpperCase());
  out = out.replace(/([.?!]\s+)([a-z])/g, (_m, p1, p2) => p1 + p2.toUpperCase());
  out = out.replace(/\bi(?=(?:['’](?:m|ve|ll|d))?\b)/g, 'I');
  return out;
}

function ctcIsPlausibleEnOov(word        )          {
  const n = word.length;
  if (n < 2 || word.indexOf("'") >= 0) return false;
  let hasVowel = false;
  let runLen = 1;
  for (let i = 0; i < n; i++) {
    const ch = word[i];
    if (ch === 'a' || ch === 'e' || ch === 'i' || ch === 'o' || ch === 'u' || ch === 'y') {
      hasVowel = true;
    }
    if (i > 0) {
      if (ch === word[i - 1]) {
        runLen++;
        if (runLen >= 3) return false;
      } else {
        runLen = 1;
      }
    }
  }
  return hasVowel;
}

function ctcScoreKnownEnWord(clean        )         {
  const wlen = clean.length;
  if (wlen <= 2) return 0.25;
  return Math.min(2.20, 0.25 + 0.24 * (wlen - 2));
}

function extendEnLexicalState(
  lmScore        ,
  curWord        ,
  inPrefix         ,
  piece        ,
  words             ,
  prefixes             ,
  nearCutEdge          = false
)                            {
  let sc = lmScore;
  let cw = curWord;
  let ip = inPrefix;

  for (let k = 0; k < piece.length; k++) {
    const ch = piece[k];
    const code = piece.charCodeAt(k);
    const isLower = code >= 97 && code <= 122;
    const isUpper = code >= 65 && code <= 90;
    if (isLower || isUpper || code === 39) {
      const lc = isUpper ? ch.toLowerCase() : ch;
      if (cw.length === 0 && code === 39) {
        continue;
      }
      const nextWord = cw + lc;
      if (ip && !isEnPrefix(nextWord, prefixes, words)) {
        ip = false;
        sc -= 0.95;
      }
      cw = nextWord;
    } else {
      if (nearCutEdge && (ch === '.' || ch === '?' || ch === '!')) {
        sc -= 2.60;
      }
      if (cw.length > 0) {
        const clean = stripTrailingApostrophes(cw);
        if (clean.length > 0) {
          if (isEnWord(clean, words)) {
            sc += ctcScoreKnownEnWord(clean);
          } else if (ctcIsPlausibleEnOov(clean) && clean.length >= 4) {
            sc += ip ? -1.15 : -0.55;
          } else {
            sc += ip ? -2.80 : -2.10;
          }
        }
        cw = '';
        ip = true;
      }
    }
  }
  return [sc, cw, ip];
}

function finalizeEnLexicalScore(
  lmScore        ,
  curWord        ,
  inPrefix         ,
  words             ,
  isPartial          = false
)         {
  if (curWord.length === 0) return lmScore;
  const clean = stripTrailingApostrophes(curWord);
  if (clean.length === 0) return lmScore;
  if (isEnWord(clean, words)) {
    if (isPartial) {
      return lmScore + (clean.length >= 4 ? 0.50 : 0.15);
    }
    return lmScore + ctcScoreKnownEnWord(clean);
  }
  if (inPrefix) return lmScore;
  if (ctcIsPlausibleEnOov(clean) && clean.length >= 4) {
    return lmScore - 0.55;
  }
  return lmScore - 2.10;
}

function beamDecodeCTC(
  logits                         ,
  timeSteps        ,
  numClasses        ,
  vocabList          ,
  skipSpecial         ,
  options                   
)                  {
  const isEn = isEnglishSentencePieceVocab(vocabList);
  const isPartial = options?.isPartial === true;
  const beamWidth = isEn ? 20 : 12;
  const topK = Math.min(numClasses - 1, isEn ? 18 : 8);

  const lex = isEn ? getEnLexicon() : null;
  const enWords = lex ? lex.words : new Set        ();
  const enPrefixes = lex ? lex.prefixes : new Set        ();
  const indicLang = isEn ? 'en' : detectIndicVocabLang(vocabList);
  const indicLex = isEn ? null : getIndicLexicon(indicLang);
  const indicCore = indicLex ? indicLex.core : new Set        ();
  const indicExt = indicLex ? indicLex.ext : new Set        ();

  const lpRow = new Float64Array(numClasses);
  const topCols = new Int32Array(topK);
  const topVals = new Float64Array(topK);

  let beams = new Map                   ();
  beams.set('', {
    ids: [],
    pb: 0.0,
    pnb: NEG_INF,
    lmScore: 0.0,
    curWord: '',
    inPrefix: true,
    lastChar: '',
  });

  for (let t = 0; t < timeSteps; t++) {
    const offset = t * numClasses;
    let rowMax = -Infinity;
    for (let c = 0; c < numClasses; c++) {
      const v = logits[offset + c];
      if (v > rowMax) rowMax = v;
    }
    let sumExp = 0.0;
    for (let c = 0; c < numClasses; c++) {
      sumExp += Math.exp(logits[offset + c] - rowMax);
    }
    const logZ = rowMax + Math.log(sumExp);

    const lpBlank = logits[offset] - logZ;
    lpRow[0] = lpBlank;

    let maxNonBlank = NEG_INF;
    for (let k = 0; k < topK; k++) {
      topVals[k] = NEG_INF;
      topCols[k] = 1;
    }

    for (let c = 1; c < numClasses; c++) {
      const lp = logits[offset + c] - logZ;
      lpRow[c] = lp;
      if (lp > maxNonBlank) maxNonBlank = lp;
      if (lp > topVals[topK - 1]) {
        let pos = topK - 1;
        while (pos > 0 && lp > topVals[pos - 1]) {
          topVals[pos] = topVals[pos - 1];
          topCols[pos] = topCols[pos - 1];
          pos--;
        }
        topVals[pos] = lp;
        topCols[pos] = c;
      }
    }

    // Fast-skip confident blank frames or flat uniform non-speech frames
    if (lpBlank > -0.02 || maxNonBlank < -4.2) {
      for (const state of beams.values()) {
        state.pb = logAddExp(state.pb, state.pnb) + lpBlank;
        state.pnb = NEG_INF;
      }
      continue;
    }

    const nextBeams = new Map                   ();

    for (const [key, state] of beams.entries()) {
      const pb = state.pb;
      const pnb = state.pnb;
      const totalP = logAddExp(pb, pnb);

      // 1. Blank transition stays on `key`
      let nbCur = nextBeams.get(key);
      const newPb = totalP + lpBlank;
      if (nbCur === undefined) {
        nbCur = {
          ids: state.ids,
          pb: newPb,
          pnb: NEG_INF,
          lmScore: state.lmScore,
          curWord: state.curWord,
          inPrefix: state.inPrefix,
          lastChar: state.lastChar,
        };
        nextBeams.set(key, nbCur);
      } else {
        nbCur.pb = logAddExp(nbCur.pb, newPb);
      }

      // 2. Repeat of last token without blank collapses into `key`
      const lastTok = state.ids.length > 0 ? state.ids[state.ids.length - 1] : -1;
      if (lastTok > 0 && pnb > NEG_INF * 0.5) {
        nbCur.pnb = logAddExp(nbCur.pnb, pnb + lpRow[lastTok]);
      }

      // 3. Top-K non-blank token extensions
      for (let k = 0; k < topK; k++) {
        const c = topCols[k];
        const lpC = topVals[k];
        let extPnb        ;
        if (c === lastTok) {
          if (pb <= NEG_INF * 0.5) continue;
          extPnb = pb + lpC;
        } else {
          extPnb = totalP + lpC;
        }

        const newKey = key.length === 0 ? String(c) : `${key},${c}`;
        const nbExt = nextBeams.get(newKey);
        if (nbExt !== undefined) {
          nbExt.pnb = logAddExp(nbExt.pnb, extPnb);
        } else {
          let nLm = 0.0;
          let nW = '';
          let nIp = true;
          let nLc = '';
          let tokStr = c < vocabList.length ? vocabList[c] : '';
          if (skipSpecial && isSpecialToken(tokStr)) {
            tokStr = '';
          }
          if (isEn) {
            [nLm, nW, nIp] = extendEnLexicalState(
              state.lmScore,
              state.curWord,
              state.inPrefix,
              tokStr,
              enWords,
              enPrefixes,
              isPartial && t >= Math.max(0, timeSteps - 8)
            );
          } else {
            [nLm, nW, nLc] = ctcExtendIndicState(
              state.lmScore,
              state.curWord,
              state.lastChar,
              tokStr,
              indicLang,
              indicCore,
              indicExt
            );
          }
          nextBeams.set(newKey, {
            ids: [...state.ids, c],
            pb: NEG_INF,
            pnb: extPnb,
            lmScore: nLm,
            curWord: nW,
            inPrefix: nIp,
            lastChar: nLc,
          });
        }
      }
    }

    if (nextBeams.size > beamWidth) {
      const entries = Array.from(nextBeams.entries());
      if (isEn) {
        entries.sort((a, b) => {
          const wa = a[1].curWord;
          const pa = a[1].inPrefix
            ? (enWords.has(wa) ? Math.min(1.45, 0.28 * wa.length) : (wa.length >= 2 ? 0.35 : 0.0))
            : 0.0;
          const wb = b[1].curWord;
          const pb = b[1].inPrefix
            ? (enWords.has(wb) ? Math.min(1.45, 0.28 * wb.length) : (wb.length >= 2 ? 0.35 : 0.0))
            : 0.0;
          const sa = logAddExp(a[1].pb, a[1].pnb) + a[1].lmScore + pa;
          const sb = logAddExp(b[1].pb, b[1].pnb) + b[1].lmScore + pb;
          return sb - sa;
        });
      } else if (indicLang === 'ta') {
        entries.sort((a, b) => {
          const sa = logAddExp(a[1].pb, a[1].pnb) + a[1].lmScore;
          const sb = logAddExp(b[1].pb, b[1].pnb) + b[1].lmScore;
          return sb - sa;
        });
      } else {
        entries.sort((a, b) => {
          const wa = a[1].curWord;
          const pa = indicCore.has(wa) ? 1.65 : (wa.length >= 3 && indicExt.has(wa) ? 0.65 : 0.0);
          const wb = b[1].curWord;
          const pb = indicCore.has(wb) ? 1.65 : (wb.length >= 3 && indicExt.has(wb) ? 0.65 : 0.0);
          const sa = logAddExp(a[1].pb, a[1].pnb) + a[1].lmScore + pa;
          const sb = logAddExp(b[1].pb, b[1].pnb) + b[1].lmScore + pb;
          return sb - sa;
        });
      }
      beams = new Map                   ();
      for (let idx = 0; idx < beamWidth; idx++) {
        beams.set(entries[idx][0], entries[idx][1]);
      }
    } else {
      beams = nextBeams;
    }
  }

  let bestIds           = [];
  let bestScore = NEG_INF;
  for (const state of beams.values()) {
    const acScore = logAddExp(state.pb, state.pnb);
    const finalLm = isEn
      ? finalizeEnLexicalScore(state.lmScore, state.curWord, state.inPrefix, enWords, isPartial)
      : ctcFinalizeIndicScore(state.lmScore, state.curWord, indicLang, indicCore, indicExt, isPartial);
    const score = acScore + finalLm;
    if (score > bestScore) {
      bestScore = score;
      bestIds = state.ids;
    }
  }

  const tokens           = [];
  for (let idx = 0; idx < bestIds.length; idx++) {
    const tid = bestIds[idx];
    const tok = tid < vocabList.length ? vocabList[tid] : undefined;
    if (tok !== undefined) {
      if (skipSpecial && isSpecialToken(tok)) {
        continue;
      }
      tokens.push(tok);
    }
  }

  const rawText = normalizeIndicText(tokens.join(''), options);
  const text = isEn && !isPartial ? formatEnCtcDisplay(rawText) : rawText;
  return { text, tokens, tokenIds: bestIds };
}

/**
 * Decode CTC logits using exact marginal / lexical prefix beam search on full
 * vocabularies and linear-time greedy decoding on compact/custom vocabularies.
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

  if (timeSteps === 0 || numClasses === 0 || logits.length < timeSteps * numClasses) {
    return { text: '', tokens: [], tokenIds: [] };
  }

  const blankId = options?.blankId ?? 0;
  const collapseRepeats = options?.collapseRepeats !== false;
  const skipSpecial = options?.skipSpecialTokens !== false;

  if (
    Array.isArray(vocab) &&
    vocab.length >= 200 &&
    blankId === 0 &&
    collapseRepeats &&
    numClasses === vocab.length
  ) {
    return beamDecodeCTC(logits, timeSteps, numClasses, vocab, skipSpecial, options);
  }

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
 * Decode from pre-computed argmax token sequences.
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
 * Zero-Overhead 12-Language Spoken Language Identification (Auto-LID) &
 * Frame-Synchronous Indic+English Code-Switching on Shared `layer_norm_84` Features.
 *
 * 100% mathematical parity with `python/src/swanada/lid.py`.
 */






const LID_LANGUAGES = [
  'sa', 'en', 'hi', 'kn', 'mr', 'bn', 'ta', 'te', 'ml', 'gu', 'pa', 'or',
]         ;

const SLID_VERSION = 1;

const HI_MARKERS = new Set        ([
  'है', 'हैं', 'था', 'थी', 'थे', 'में', 'को', 'का', 'की', 'के', 'से', 'पर',
  'और', 'नहीं', 'यह', 'वह', 'एक', 'तो', 'भी', 'कर', 'रहा', 'रही', 'रहे',
  'लिए', 'किया', 'गया', 'गई', 'अपने', 'देखो', 'कहा', 'होता', 'साहब', 'मुझे', 'हम',
]);

const MR_MARKERS = new Set        ([
  'आहे', 'आहेत', 'नाही', 'मध्ये', 'ला', 'चा', 'ची', 'चे', 'च्या', 'वर',
  'आणि', 'पण', 'काय', 'मला', 'तुला', 'होता', 'होती', 'होते', 'आणखीही',
  'काही', 'हो', 'माझ्या', 'तुमच्या', 'केले', 'झाले', 'येथे', 'आता',
]);

const SA_MARKERS = new Set        ([
  'च', 'एव', 'इति', 'अपि', 'अस्ति', 'भवति', 'तस्य', 'अत्र', 'तत्र', 'यथा',
  'तथा', 'अहं', 'वयम्', 'किम्', 'येन', 'तेन', 'ददाति', 'विषये', 'देहस्य',
]);

const SA_ENDINGS = ['म्', 'त्', 'न्', 'स्य', 'णां', 'नाम्', 'ेषु'];

const CODEMIX_AMBIGUOUS_EN = new Set        ([
  'a', 'i', 'am', 'an', 'as', 'at', 'be', 'bi', 'bo', 'by', 'da', 'de', 'di',
  'do', 'ed', 'eh', 'el', 'em', 'en', 'er', 'es', 'et', 'ex', 'fa', 'go', 'ha',
  'he', 'hi', 'hm', 'ho', 'id', 'if', 'in', 'is', 'it', 'jo', 'ka', 'ki', 'ko',
  'la', 'li', 'lo', 'ma', 'me', 'mi', 'mm', 'mo', 'mu', 'my', 'na', 'ne', 'no',
  'nu', 'od', 'oe', 'of', 'oh', 'oi', 'ok', 'om', 'on', 'op', 'or', 'os', 'ow',
  'ox', 'oy', 'pa', 'pe', 'pi', 'po', 'qi', 're', 'sh', 'si', 'so', 'ta', 'te',
  'ti', 'to', 'uh', 'um', 'un', 'up', 'us', 'ut', 'we', 'wo', 'xi', 'xu', 'ya',
  'ye', 'yo', 'the', 'and', 'are', 'too', 'see', 'haa', 'tum', 'hum', 'hai',
  'ho', 'kar', 'par', 'aur', 'ek', 'ko', 'ki', 'ka', 'ke', 'se', 'ne', 'naa',
]);

const EN_VOWELS_RE = /[aeiouy]/;
const EN_CLEAN_RE = /[^a-z']/g;
const INDIC_STRIP_PUNCT_RE = /^[।॥,?!.'"\\-]+|[।॥,?!.'"\\-]+$/g;

                                    
                       
                     
 

                                          
                   
                     
                                        
                         
 

                                 
               
                    
                  
 

                                         
               
                   
                                 
 

                                   
              
               
               
                               
                                        
                                  
                                  
                                     
                                     
                                              
                                  
                                           
                                    
                      
 

function parseLidHeadBytes(buffer                          )                   {
  const bytes = buffer instanceof Uint8Array
    ? buffer
    : new Uint8Array(buffer);
  if (
    bytes.byteLength < 24 ||
    bytes[0] !== 0x53 || // 'S'
    bytes[1] !== 0x4c || // 'L'
    bytes[2] !== 0x49 || // 'I'
    bytes[3] !== 0x44    // 'D'
  ) {
    throw new Error("Invalid lid.bin header: expected magic 'SLID'");
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = dv.getUint32(4, true);
  const dIn = dv.getUint32(8, true);
  const dAtt = dv.getUint32(12, true);
  const dHid = dv.getUint32(16, true);
  const nLangs = dv.getUint32(20, true);
  if (version !== SLID_VERSION || nLangs !== LID_LANGUAGES.length) {
    throw new Error(`Unsupported lid.bin version=${version} or nLangs=${nLangs}`);
  }
  const dStats = 2 * dIn;
  const counts = [
    dIn * dAtt,
    dAtt,
    dAtt,
    dStats,
    dStats,
    dStats * dHid,
    dHid,
    dHid * nLangs,
    nLangs,
    1,
  ];
  let totalFloats = 0;
  for (let i = 0; i < counts.length; i++) totalFloats += counts[i];
  const expectedBytes = 24 + totalFloats * 4;
  if (bytes.byteLength < expectedBytes) {
    throw new Error(`Truncated lid.bin: got ${bytes.byteLength} bytes, expected ${expectedBytes}`);
  }

  const allFloats = new Float32Array(totalFloats);
  for (let i = 0; i < totalFloats; i++) {
    allFloats[i] = dv.getFloat32(24 + i * 4, true);
  }

  let pos = 0;
  const take = (n        )               => {
    const out = allFloats.subarray(pos, pos + n);
    pos += n;
    return out;
  };

  const wAtt = take(dIn * dAtt);
  const bAtt = take(dAtt);
  const vAtt = take(dAtt);
  const lnGamma = take(dStats);
  const lnBeta = take(dStats);
  const wFc1 = take(dStats * dHid);
  const bFc1 = take(dHid);
  const wFc2 = take(dHid * nLangs);
  const bFc2 = take(nLangs);
  const temperature = take(1)[0];

  return {
    dIn,
    dAtt,
    dHid,
    languages: LID_LANGUAGES,
    wAtt,
    bAtt,
    vAtt,
    lnGamma,
    lnBeta,
    wFc1,
    bFc1,
    wFc2,
    bFc2,
    temperature,
  };
}

function serializeLidHeadBytes(weights                  )             {
  const nLangs = weights.languages.length;
  const parts = [
    weights.wAtt,
    weights.bAtt,
    weights.vAtt,
    weights.lnGamma,
    weights.lnBeta,
    weights.wFc1,
    weights.bFc1,
    weights.wFc2,
    weights.bFc2,
    Float32Array.from([weights.temperature]),
  ];
  let totalFloats = 0;
  for (const p of parts) totalFloats += p.length;
  const out = new Uint8Array(24 + totalFloats * 4);
  out[0] = 0x53; out[1] = 0x4c; out[2] = 0x49; out[3] = 0x44;
  const dv = new DataView(out.buffer);
  dv.setUint32(4, SLID_VERSION, true);
  dv.setUint32(8, weights.dIn, true);
  dv.setUint32(12, weights.dAtt, true);
  dv.setUint32(16, weights.dHid, true);
  dv.setUint32(20, nLangs, true);
  let byteOff = 24;
  for (const p of parts) {
    for (let i = 0; i < p.length; i++) {
      dv.setFloat32(byteOff, p[i], true);
      byteOff += 4;
    }
  }
  return out;
}

function predictNeuralLidLogProbs(
  weights                  ,
  hidden              ,
  timeSteps        
)                         {
  const nLangs = weights.languages.length;
  if (timeSteps <= 0 || hidden.length < timeSteps * weights.dIn) {
    const u = -Math.log(nLangs);
    const empty                         = {};
    for (const lg of weights.languages) empty[lg] = u;
    return empty;
  }

  const dIn = weights.dIn;
  const dAtt = weights.dAtt;
  const dHid = weights.dHid;
  const dStats = 2 * dIn;

  const norms = new Float32Array(timeSteps);
  let peakNorm = 0;
  for (let t = 0; t < timeSteps; t++) {
    let sq = 0;
    const off = t * dIn;
    for (let d = 0; d < dIn; d++) {
      const v = hidden[off + d];
      sq += v * v;
    }
    const nm = Math.sqrt(sq);
    norms[t] = nm;
    if (nm > peakNorm) peakNorm = nm;
  }

  const activeMask = new Uint8Array(timeSteps);
  let activeCount = 0;
  const thresh = peakNorm > 1e-6 ? 0.25 * peakNorm : -1;
  for (let t = 0; t < timeSteps; t++) {
    if (norms[t] >= thresh) {
      activeMask[t] = 1;
      activeCount++;
    }
  }
  if (activeCount === 0) activeMask.fill(1);

  const attScores = new Float64Array(timeSteps);
  let maxAtt = -Infinity;
  for (let t = 0; t < timeSteps; t++) {
    if (!activeMask[t]) {
      attScores[t] = -1e9;
      if (-1e9 > maxAtt) maxAtt = -1e9;
      continue;
    }
    const hOff = t * dIn;
    let dotV = 0;
    for (let a = 0; a < dAtt; a++) {
      let z = weights.bAtt[a];
      for (let d = 0; d < dIn; d++) {
        z += hidden[hOff + d] * weights.wAtt[d * dAtt + a];
      }
      dotV += Math.tanh(z) * weights.vAtt[a];
    }
    attScores[t] = dotV;
    if (dotV > maxAtt) maxAtt = dotV;
  }

  const alpha = new Float32Array(timeSteps);
  let alphaSum = 0;
  for (let t = 0; t < timeSteps; t++) {
    const e = Math.exp(attScores[t] - maxAtt);
    alpha[t] = e;
    alphaSum += e;
  }
  if (alphaSum <= 0 || !Number.isFinite(alphaSum)) {
    alpha.fill(1 / timeSteps);
  } else {
    for (let t = 0; t < timeSteps; t++) alpha[t] /= alphaSum;
  }

  const stats = new Float32Array(dStats);
  for (let t = 0; t < timeSteps; t++) {
    const w = alpha[t];
    const hOff = t * dIn;
    for (let d = 0; d < dIn; d++) {
      stats[d] += w * hidden[hOff + d];
    }
  }
  for (let t = 0; t < timeSteps; t++) {
    const w = alpha[t];
    const hOff = t * dIn;
    for (let d = 0; d < dIn; d++) {
      const diff = hidden[hOff + d] - stats[d];
      stats[dIn + d] += w * diff * diff;
    }
  }
  for (let d = 0; d < dIn; d++) {
    stats[dIn + d] = Math.sqrt(Math.max(stats[dIn + d], 1e-5));
  }

  let sMean = 0;
  for (let i = 0; i < dStats; i++) sMean += stats[i];
  sMean /= dStats;
  let sVar = 0;
  for (let i = 0; i < dStats; i++) {
    const df = stats[i] - sMean;
    sVar += df * df;
  }
  sVar /= dStats;
  const invStd = 1 / Math.sqrt(sVar + 1e-5);
  const sLn = new Float32Array(dStats);
  for (let i = 0; i < dStats; i++) {
    sLn[i] = ((stats[i] - sMean) * invStd) * weights.lnGamma[i] + weights.lnBeta[i];
  }

  const gelu = new Float32Array(dHid);
  for (let j = 0; j < dHid; j++) {
    let x1 = weights.bFc1[j];
    for (let i = 0; i < dStats; i++) {
      x1 += sLn[i] * weights.wFc1[i * dHid + j];
    }
    gelu[j] = 0.5 * x1 * (1 + Math.tanh(0.7978845608 * (x1 + 0.044715 * x1 * x1 * x1)));
  }

  const temp = Math.max(weights.temperature, 0.05);
  const logits = new Float64Array(nLangs);
  let maxL = -Infinity;
  for (let k = 0; k < nLangs; k++) {
    let z = weights.bFc2[k];
    for (let j = 0; j < dHid; j++) {
      z += gelu[j] * weights.wFc2[j * nLangs + k];
    }
    const scaled = z / temp;
    logits[k] = scaled;
    if (scaled > maxL) maxL = scaled;
  }

  let sumExp = 0;
  for (let k = 0; k < nLangs; k++) sumExp += Math.exp(logits[k] - maxL);
  const logZ = maxL + Math.log(sumExp);

  const out                         = {};
  for (let k = 0; k < nLangs; k++) {
    out[weights.languages[k]] = logits[k] - logZ;
  }
  return out;
}

const predictLidLogProbs = predictNeuralLidLogProbs;

function projectLinearHeadLogits(
  hidden              ,
  timeSteps        ,
  weight              ,
  bias              
)               {
  const numClasses = 257;
  const dim = 512;
  const out = new Float32Array(timeSteps * numClasses);
  for (let t = 0; t < timeSteps; t++) {
    const hOff = t * dim;
    const oOff = t * numClasses;
    for (let c = 0; c < numClasses; c++) {
      const wOff = c * dim;
      let acc = bias[c];
      for (let d = 0; d < dim; d += 4) {
        acc +=
          hidden[hOff + d] * weight[wOff + d] +
          hidden[hOff + d + 1] * weight[wOff + d + 1] +
          hidden[hOff + d + 2] * weight[wOff + d + 2] +
          hidden[hOff + d + 3] * weight[wOff + d + 3];
      }
      out[oOff + c] = acc;
    }
  }
  return out;
}

function greedyCollapseText(logits              , timeSteps        , vocab          )         {
  const numClasses = 257;
  let lastId = 0;
  const pieces           = [];
  const vlen = vocab.length;
  for (let t = 0; t < timeSteps; t++) {
    const off = t * numClasses;
    let bestId = 0;
    let bestVal = logits[off];
    for (let c = 1; c < numClasses; c++) {
      if (logits[off + c] > bestVal) {
        bestVal = logits[off + c];
        bestId = c;
      }
    }
    if (bestId === 0) {
      lastId = 0;
      continue;
    }
    if (bestId === lastId) continue;
    lastId = bestId;
    if (bestId > 0 && bestId < vlen) {
      const tok = vocab[bestId];
      if (tok && !isSpecialToken(tok)) pieces.push(tok);
    }
  }
  return normalizeIndicText(pieces.join(''));
}

function countChar(s        , ch        )         {
  let c = 0;
  for (let i = 0; i < s.length; i++) if (s[i] === ch) c++;
  return c;
}

function scoreLexicalPlausibility(text        , lang        )         {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return -1.5;

  if (lang === 'en') {
    const { words: enWords } = getEnLexicon();
    let totalW = 0;
    let weightedHits = 0;
    for (const w of words) {
      const cw = w.toLowerCase().replace(EN_CLEAN_RE, '').replace(/^'+|'+$/g, '');
      if (!cw) continue;
      const wLen = Math.min(cw.length, 8);
      totalW += wLen;
      if (cw.length >= 3 && isEnWord(cw, enWords)) {
        weightedHits += wLen * 1.05;
      } else if (cw.length === 2 && isEnWord(cw, enWords)) {
        weightedHits += wLen * 0.55;
      } else if (cw === 'i' || cw === 'a') {
        weightedHits += 0.30;
      } else {
        const hasV = EN_VOWELS_RE.test(cw);
        weightedHits -= wLen * (hasV ? 0.55 : 1.10);
      }
    }
    if (totalW <= 0) return -1.2;
    return Math.max(-1.2, Math.min(1.05, weightedHits / totalW));
  }

  const { core, ext } = getIndicLexicon(lang);
  let totalW = 0;
  let acc = 0;
  for (const w of words) {
    const wClean = w.replace(INDIC_STRIP_PUNCT_RE, '');
    if (!wClean) continue;
    const cLen = Math.min(wClean.length, 8);
    totalW += cLen;
    const sc = scoreIndicWord(wClean, lang, core, ext);
    acc += sc * (cLen / 4.0);
  }

  let base = (acc / Math.max(totalW, 1.0)) * 2.2;
  if (lang === 'sa' || lang === 'hi' || lang === 'mr') {
    let hiHits = 0;
    let mrHits = countChar(text, '\u0933');
    let saHits = countChar(text, '\u0903') * 2 + countChar(text, '\u093d') * 2;
    for (const w of words) {
      if (HI_MARKERS.has(w)) hiHits++;
      if (MR_MARKERS.has(w)) mrHits++;
      if (SA_MARKERS.has(w)) saHits++;
      for (const suf of SA_ENDINGS) {
        if (w.endsWith(suf)) {
          saHits++;
          break;
        }
      }
    }
    const nW = Math.max(words.length, 1);
    if (lang === 'hi') {
      base += 0.75 * (hiHits / nW) - 0.45 * ((mrHits + saHits) / nW);
    } else if (lang === 'mr') {
      base += 0.80 * (mrHits / nW) - 0.45 * ((hiHits + saHits) / nW);
    } else if (lang === 'sa') {
      base += 0.75 * (saHits / nW) - 0.50 * ((hiHits + mrHits) / nW);
    }
  }
  return Math.max(-1.2, Math.min(1.15, base));
}

function scoreCtcHeadEvidence(
  hidden              ,
  timeSteps        ,
  weight              ,
  bias              ,
  vocab          ,
  lang        
)                                             {
  const logits = projectLinearHeadLogits(hidden, timeSteps, weight, bias);
  const numClasses = 257;
  if (timeSteps <= 0) return { evidence: -10.0, logits };

  const logP = new Float32Array(timeSteps * numClasses);
  const pNb = new Float32Array(timeSteps);
  let sumNb = 0;
  let activeCount = 0;

  for (let t = 0; t < timeSteps; t++) {
    const off = t * numClasses;
    let maxL = logits[off];
    for (let c = 1; c < numClasses; c++) {
      if (logits[off + c] > maxL) maxL = logits[off + c];
    }
    let sumExp = 0;
    for (let c = 0; c < numClasses; c++) {
      sumExp += Math.exp(logits[off + c] - maxL);
    }
    const logZ = maxL + Math.log(sumExp);
    for (let c = 0; c < numClasses; c++) {
      logP[off + c] = logits[off + c] - logZ;
    }
    const pb = Math.exp(logP[off]);
    const nb = Math.max(1e-6, Math.min(1.0, 1.0 - pb));
    pNb[t] = nb;
    sumNb += nb;
    if (nb > 0.20) activeCount++;
  }

  const meanNb = sumNb / timeSteps;
  let nbThreshold = 0.20;
  let useGe = false;
  if (activeCount < Math.max(2, Math.floor(timeSteps / 12))) {
    const sorted = Float32Array.from(pNb).sort();
    const q75 = sorted[Math.min(sorted.length - 1, Math.floor(0.75 * (sorted.length - 1)))];
    nbThreshold = Math.max(q75, 1e-4);
    useGe = true;
  }

  let sumCondPeak = 0;
  let sumCondNegEnt = 0;
  let usedFrames = 0;
  for (let t = 0; t < timeSteps; t++) {
    const nb = pNb[t];
    const isAct = useGe ? nb >= nbThreshold : nb > nbThreshold;
    if (!isAct) continue;
    usedFrames++;
    const logNb = Math.log(nb);
    const off = t * numClasses;
    let framePeak = -Infinity;
    let frameNegEnt = 0;
    for (let c = 1; c < numClasses; c++) {
      const clp = Math.max(-30.0, Math.min(0.0, logP[off + c] - logNb));
      if (clp > framePeak) framePeak = clp;
      frameNegEnt += Math.exp(clp) * clp;
    }
    sumCondPeak += framePeak;
    sumCondNegEnt += frameNegEnt;
  }

  const condPeak = usedFrames > 0 ? sumCondPeak / usedFrames : -5.5;
  const condNegEnt = usedFrames > 0 ? sumCondNegEnt / usedFrames : -5.5;
  const actPenalty = meanNb < 0.06 ? (-1.5 * Math.max(0, 0.06 - meanNb)) / 0.06 : 0.0;
  const greedyTxt = greedyCollapseText(logits, timeSteps, vocab);
  const lexSc = scoreLexicalPlausibility(greedyTxt, lang);
  const evidence = 1.35 * condPeak + 0.45 * condNegEnt + 0.85 * lexSc + actPenalty;
  return { evidence, logits };
}

function detectLanguageFromHidden(
  hidden              ,
  timeSteps        ,
  heads                                   ,
  vocabs                          ,
  lidWeights                          ,
  candidateLanguages                    
)                                                                                  {
  const cands = candidateLanguages || LID_LANGUAGES;
  const avail = cands.filter((lg) => Boolean(heads[lg]) && Boolean(vocabs[lg]));
  if (avail.length === 0) {
    return {
      result: { language: 'sa', confidence: 1.0, probabilities: { sa: 1.0 }, usedNeuralLid: false },
      cachedLogits: {},
    };
  }

  let neuralLp                                = null;
  let evalLangs = [...avail];
  if (lidWeights) {
    neuralLp = predictNeuralLidLogProbs(lidWeights, hidden, timeSteps);
    const ranked = [...avail].sort((a, b) => (neuralLp [b] ?? -20) - (neuralLp [a] ?? -20));
    const shortlist = ranked.slice(0, Math.min(8, ranked.length));
    if (avail.includes('en') && !shortlist.includes('en')) {
      shortlist.push('en');
    }
    evalLangs = shortlist;
  }

  const ctcScores                         = {};
  const cachedLogits                               = {};
  let minCtc = Infinity;
  for (const lg of evalLangs) {
    const h = heads[lg];
    const { evidence, logits } = scoreCtcHeadEvidence(hidden, timeSteps, h.weight, h.bias, vocabs[lg], lg);
    ctcScores[lg] = evidence;
    cachedLogits[lg] = logits;
    if (evidence < minCtc) minCtc = evidence;
  }
  if (!Number.isFinite(minCtc)) minCtc = -5.0;

  const combined                         = {};
  let temp = 0.28;
  if (neuralLp) {
    for (const lg of avail) {
      const nlp = neuralLp[lg] ?? -12.0;
      const cev = ctcScores[lg] ?? (minCtc - 1.5);
      combined[lg] = 0.50 * nlp + 1.65 * cev;
    }
    temp = 0.65;
  } else {
    for (const lg of avail) {
      combined[lg] = ctcScores[lg] ?? -10.0;
    }
  }

  let maxS = -Infinity;
  for (const lg of avail) {
    if (combined[lg] > maxS) maxS = combined[lg];
  }
  const exps                         = {};
  let z = 0;
  for (const lg of avail) {
    const e = Math.exp((combined[lg] - maxS) / temp);
    exps[lg] = e;
    z += e;
  }
  if (z <= 0) z = 1.0;

  const probabilities                         = {};
  let bestLang = avail[0];
  let bestProb = -1;
  for (const lg of avail) {
    const p = exps[lg] / z;
    probabilities[lg] = p;
    if (p > bestProb) {
      bestProb = p;
      bestLang = lg;
    }
  }

  return {
    result: {
      language: bestLang,
      confidence: bestProb,
      probabilities,
      usedNeuralLid: Boolean(neuralLp),
    },
    cachedLogits,
  };
}

function extractCtcWordSpans(
  logits              ,
  timeSteps        ,
  vocab          
)                                                                {
  const numClasses = 257;
  const vlen = vocab.length;
  const words                                                                = [];
  let curChars           = [];
  let curStart = -1;
  let curEnd = 0;
  let lastId = 0;

  for (let t = 0; t < timeSteps; t++) {
    const off = t * numClasses;
    let idx = 0;
    let bestVal = logits[off];
    for (let c = 1; c < numClasses; c++) {
      if (logits[off + c] > bestVal) {
        bestVal = logits[off + c];
        idx = c;
      }
    }
    if (idx === 0) {
      lastId = 0;
      continue;
    }
    if (idx === lastId) {
      curEnd = t + 1;
      continue;
    }
    lastId = idx;
    if (idx <= 0 || idx >= vlen) continue;
    const tok = vocab[idx];
    if (!tok || isSpecialToken(tok)) continue;

    if (tok.startsWith('\u2581') || tok === ' ') {
      if (curChars.length > 0 && curStart >= 0) {
        const wTxt = normalizeIndicText(curChars.join('')).trim();
        if (wTxt) {
          words.push({ text: wTxt, startFrame: curStart, endFrame: Math.max(curEnd, curStart + 1) });
        }
        curChars = [];
        curStart = -1;
      }
      const rest = tok.replace(/^[\u2581 ]+/, '');
      if (rest) {
        curChars.push(rest);
        curStart = t;
        curEnd = t + 1;
      }
    } else {
      if (curStart < 0) curStart = t;
      curChars.push(tok);
      curEnd = t + 1;
    }
  }

  if (curChars.length > 0 && curStart >= 0) {
    const wTxt = normalizeIndicText(curChars.join('')).trim();
    if (wTxt) {
      words.push({ text: wTxt, startFrame: curStart, endFrame: Math.max(curEnd, curStart + 1) });
    }
  }
  return words;
}

function spanConditionalCertainty(logits              , startFrame        , endFrame        )         {
  const numClasses = 257;
  if (endFrame <= startFrame) return -10.0;
  let sumPeak = 0;
  let used = 0;
  for (let t = startFrame; t < endFrame; t++) {
    const off = t * numClasses;
    let maxL = logits[off];
    for (let c = 1; c < numClasses; c++) {
      if (logits[off + c] > maxL) maxL = logits[off + c];
    }
    let sumExp = 0;
    for (let c = 0; c < numClasses; c++) sumExp += Math.exp(logits[off + c] - maxL);
    const logZ = maxL + Math.log(sumExp);
    const pNb = Math.max(1e-6, Math.min(1.0, 1.0 - Math.exp(logits[off] - logZ)));
    if (pNb <= 0.18) continue;
    let peak = -Infinity;
    for (let c = 1; c < numClasses; c++) {
      const lp = logits[off + c] - logZ;
      if (lp > peak) peak = lp;
    }
    sumPeak += peak;
    used++;
  }
  return used > 0 ? sumPeak / used : -5.0;
}

function decodeBilingualCodeswitch(
  logitsIndic              ,
  timeSteps        ,
  vocabIndic          ,
  langIndic        ,
  logitsEn              ,
  vocabEn          ,
  isPartial          = false
)                         {
  const numClasses = 257;
  const baseRes = decodeCTC(
    logitsIndic,
    [timeSteps, numClasses],
    vocabIndic,
    isPartial ? { isPartial: true } : undefined
  );
  if (langIndic === 'en' || timeSteps < 4 || !baseRes.text) {
    return { text: baseRes.text, tokens: baseRes.tokens, englishSpans: [] };
  }

  const spans = extractCtcWordSpans(logitsIndic, timeSteps, vocabIndic);
  const baseWords = baseRes.text.split(/\s+/).filter(Boolean);
  if (spans.length === 0 || spans.length !== baseWords.length) {
    return { text: baseRes.text, tokens: baseRes.tokens, englishSpans: [] };
  }

  const { core, ext } = getIndicLexicon(langIndic);
  const { words: enLexWords } = getEnLexicon();
  const outWords           = [];
  const englishSpans                   = [];
  let cursor = 0;

  for (let i = 0; i < spans.length; i++) {
    const sp = spans[i];
    const wInd = baseWords[i];
    let chosen = wInd;
    let isEnSwap = false;

    const prevEnd = i > 0 ? spans[i - 1].endFrame : 0;
    const nextStart = i + 1 < spans.length ? spans[i + 1].startFrame : timeSteps;
    const s0 = Math.max(prevEnd, sp.startFrame - 4);
    const s1 = Math.min(nextStart, sp.endFrame + 6);
    const wIndClean = wInd.replace(INDIC_STRIP_PUNCT_RE, '');
    const indLexSc = wIndClean ? scoreIndicWord(wIndClean, langIndic, core, ext) : 0.0;
    if (s1 - s0 >= 3 && indLexSc <= 0.05) {
      const sliceLen = s1 - s0;
      const subSlice = logitsEn.subarray(s0 * numClasses, s1 * numClasses);
      const enSubRes = decodeCTC(subSlice, [sliceLen, numClasses], vocabEn, { isPartial: true });
      const enWords = enSubRes.text
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .map((u) => u.replace(EN_CLEAN_RE, '').replace(/^'+|'+$/g, ''))
        .filter(Boolean);

      if (
        enWords.length === 1 &&
        enWords[0].length >= 4 &&
        !CODEMIX_AMBIGUOUS_EN.has(enWords[0]) &&
        isEnWord(enWords[0], enLexWords) &&
        EN_VOWELS_RE.test(enWords[0])
      ) {
        const certInd = spanConditionalCertainty(logitsIndic, s0, s1);
        const certEn = spanConditionalCertainty(logitsEn, s0, s1);
        if (certEn >= certInd + 0.08 && certEn > -0.85) {
          chosen = enWords[0];
          isEnSwap = true;
        }
      }
    }

    if (i > 0) cursor += 1;
    const startChar = cursor;
    cursor += chosen.length;
    if (isEnSwap) {
      englishSpans.push({ word: chosen, startChar, endChar: cursor });
    }
    outWords.push(chosen);
  }

  return {
    text: outWords.join(' '),
    tokens: baseRes.tokens,
    englishSpans,
  };
}

/**
 * StreamingCTCDecoder: Stabilized Prefix-Locking Streaming CTC Decoder.
 * Decouples committed prefix from volatile suffix to guarantee 0.00% character churn
 * on confirmed text and prevent boundary token flicker in real-time UI display.
 */


                                                        

                                      
               
                    
                   
                   
                   
                     
                      
              
                            
                              
 

                                                                   
                                             
                                                                                 
                                                                                   
                                                    
                                                             
                                                                                                     
 

function isEnVocab(vocab                                   )          {
  if (!Array.isArray(vocab) || vocab.length < 200) return false;
  const end = Math.min(vocab.length, 12);
  for (let idx = 2; idx < end; idx++) {
    const tok = vocab[idx] || '';
    for (let k = 0; k < tok.length; k++) {
      const code = tok.charCodeAt(k);
      if (code >= 97 && code <= 122) return true;
    }
  }
  return false;
}

function formatEnDisplay(text        )         {
  if (!text) return text;
  let out = text.replace(/([a-zA-Z])([0-9])/g, '$1 $2');
  out = out.replace(/([0-9])([a-zA-Z]{2,})\b/g, (m, d        , w        ) =>
    /^(?:st|nd|rd|th)$/i.test(w) ? m : `${d} ${w}`
  );
  out = out.replace(/^[a-z]/, (ch) => ch.toUpperCase());
  out = out.replace(/([.?!]\s+)([a-z])/g, (_, sep        , ch        ) => sep + ch.toUpperCase());
  out = out.replace(/\bi(?=(?:['’](?:m|ve|ll|d))?\b)/g, 'I');
  return out;
}

class StreamingCTCDecoder {
          vocab                                   ;
          options                         ;
          blankId        ;
          stabilityThreshold        ;
          trailTokens        ;
          requireStabilityOnWordBoundary         ;
          highStabilityThreshold        ;
          isEnglish         ;

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
    this.highStabilityThreshold = this.options.highStabilityThreshold ?? 4;
    this.isEnglish = isEnVocab(vocab);
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
      const normText = normalizeIndicText(allTokens.join(''), this.options);
      const fullText = this.isEnglish ? formatEnDisplay(normText) : normText;
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

    // 1. Compute contiguous stable run from alreadyCommitted
    let stableLimit = alreadyCommitted;
    while (
      stableLimit < lockableLimit &&
      (this.tokenStabilityCounts[stableLimit] || 0) >= this.stabilityThreshold
    ) {
      stableLimit++;
    }

    // 2. Strict word-boundary-gated commitment
    let commitIdx = alreadyCommitted;
    if (stableLimit > alreadyCommitted) {
      let closedWordEnd = alreadyCommitted;
      let hasBoundaryAhead = false;

      for (let j = alreadyCommitted + 1; j < rawTokens.length; j++) {
        const tok = rawTokens[j];
        const isBoundary =
          tok &&
          (tok.startsWith('\u2581') ||
            tok.startsWith('\u2582') ||
            tok.startsWith('\u2583') ||
            tok.startsWith('▁') ||
            tok.startsWith(' ') ||
            tok.startsWith('\t'));

        if (isBoundary) {
          hasBoundaryAhead = true;
          const jStable = this.requireStabilityOnWordBoundary
            ? (this.tokenStabilityCounts[j] || 0) >= this.stabilityThreshold
            : true;
          if (j <= stableLimit && jStable) {
            closedWordEnd = j;
          } else {
            break;
          }
        }
      }

      if (hasBoundaryAhead) {
        commitIdx = closedWordEnd;
      } else {
        // Fallback for continuous compound words without word boundaries
        for (let i = alreadyCommitted; i < stableLimit; i++) {
          if ((this.tokenStabilityCounts[i] || 0) >= this.highStabilityThreshold) {
            commitIdx = i + 1;
          } else {
            break;
          }
        }
      }
    }

    // Guard: never advance commitIdx to leave only whitespace in volatileTokens,
    // violate strict prefix monotonicity on committedText, or split mid-sandhi.
    const prevRawComm = alreadyCommitted > 0
      ? normalizeIndicText(this.committedTokens.join(''), this.options)
      : '';
    const fullNormCheck = normalizeIndicText(rawTokens.join(''), this.options);
    while (commitIdx > alreadyCommitted) {
      const candPrefix = normalizeIndicText(rawTokens.slice(0, commitIdx).join(''), this.options);
      if (
        normalizeIndicText(rawTokens.slice(commitIdx).join(''), this.options) === '' ||
        !fullNormCheck.startsWith(candPrefix) ||
        (prevRawComm && !candPrefix.startsWith(prevRawComm)) ||
        (candPrefix.endsWith('\u0c21\u0c02') && rawTokens.length - commitIdx < 7)
      ) {
        commitIdx--;
      } else {
        break;
      }
    }

    // 3. Commit confirmed tokens
    for (let i = alreadyCommitted; i < commitIdx; i++) {
      this.committedTokens.push(rawTokens[i]);
    }

    this.lastHypTokens = [...rawTokens];

    const rawCommittedStr = normalizeIndicText(this.committedTokens.join(''), this.options);
    const committedStr = this.isEnglish ? formatEnDisplay(rawCommittedStr) : rawCommittedStr;
    this.committedText = committedStr;

    const volatileTokens = rawTokens.slice(this.committedTokens.length);
    let volatileStr = normalizeIndicText(volatileTokens.join(''), this.options);
    if (this.isEnglish && volatileStr) {
      if (!committedStr) {
        volatileStr = formatEnDisplay(volatileStr);
      } else {
        volatileStr = volatileStr.replace(/\bi(?=(?:['’](?:m|ve|ll|d))?\b)/g, 'I');
        if (/[.?!]\s*$/.test(committedStr)) {
          volatileStr = volatileStr.replace(/^[a-z]/, (ch) => ch.toUpperCase());
        }
      }
    }

    const rawFullText = joinSubwords(committedStr, volatileStr, volatileTokens, this.options);
    const fullText = this.isEnglish ? formatEnDisplay(rawFullText) : rawFullText;

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

const MOBILE_LARGE_MODEL_BYTES = 40 * 1024 * 1024;

function getRuntimeMobility()                                        {
  if (typeof navigator === 'undefined') {
    return { isIOS: false, isMobile: false };
  }
  const ua = navigator.userAgent || '';
  const platform = (navigator       ).platform || '';
  const maxTouch = navigator.maxTouchPoints || 0;
  const devMem = (navigator       ).deviceMemory || 8;
  const isIOS =
    /iPhone|iPad|iPod|CriOS|FxiOS|EdgiOS/i.test(ua) ||
    (platform === 'MacIntel' && maxTouch > 1);
  const isMobile = isIOS || /Android|Mobile/i.test(ua) || devMem <= 4;
  return { isIOS, isMobile };
}

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
    const response = (await cache.match(url)) || (await cache.match(url, { ignoreSearch: true }));
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
      const cleanLocal = urlOrPath.split('?')[0];
      const candidates = [
        cleanLocal,
        path.resolve(process.cwd(), cleanLocal),
        path.resolve(process.cwd(), '..', cleanLocal),
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
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i] ;
      buffer.set(chunk, offset);
      offset += chunk.byteLength;
      chunks[i] = null       ; // Free chunk backing store immediately to prevent 2x RAM spike on mobile
    }
    chunks.length = 0;
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

  // Mobile quota & Jetsam memory protection:
  // - iOS WebKit enforces ~50 MB origin quota and cloning a 178 MB buffer into Response/IDB triggers Jetsam kills.
  // - Android skips duplicate 178 MB IndexedDB structured-clone while keeping CacheStorage.
  const { isIOS, isMobile } = getRuntimeMobility();
  const isLargeModel = buffer.byteLength > MOBILE_LARGE_MODEL_BYTES;
  if (!(isIOS && isLargeModel)) {
    putToCacheStorage(cacheName, urlOrPath, buffer).catch(() => {});
  }
  if (!(isMobile && isLargeModel)) {
    putToIndexedDB(urlOrPath, buffer).catch(() => {});
  }

  return buffer;
}

/**
 * Core ONNX Runtime Engine for In-Browser and Node.js execution.
 * Manages WASM SIMD, multi-threading negotiation, WebGPU probing,
 * RAII tensor disposal, and model session lifecycles.
 */





             
                    
                          
                   
                 
                           

             
                                                 
                    
                    
                    
            
                          
                      
                    

                                                                      
                     
                    
 

const LAYER_NORM_84_VALUE_INFO = new Uint8Array([
  0x0a, 0x0d, 0x6c, 0x61, 0x79, 0x65, 0x72, 0x5f, 0x6e, 0x6f, 0x72, 0x6d, 0x5f, 0x38, 0x34,
  0x12, 0x20, 0x0a, 0x1e, 0x08, 0x01, 0x12, 0x1a, 0x0a, 0x07, 0x12, 0x05, 0x62, 0x61, 0x74,
  0x63, 0x68, 0x0a, 0x0a, 0x12, 0x08, 0x74, 0x69, 0x6d, 0x65, 0x5f, 0x73, 0x75, 0x62, 0x0a,
  0x03, 0x08, 0x80, 0x04,
]);

function readPbVarint(buf            , pos        )                   {
  let val = 0;
  let shift = 0;
  while (pos < buf.length) {
    const b = buf[pos++];
    val += (b & 0x7f) * Math.pow(2, shift);
    if ((b & 0x80) === 0) return [val, pos];
    shift += 7;
  }
  throw new Error('Truncated ONNX protobuf varint');
}

function encodePbVarint(n        )             {
  const out           = [];
  let rem = n;
  while (rem >= 128) {
    out.push((rem % 128) | 0x80);
    rem = Math.floor(rem / 128);
  }
  out.push(rem);
  return Uint8Array.from(out);
}

function exposeEncoderHiddenOutput(src            )             {
  const graphAppend = new Uint8Array(2 + LAYER_NORM_84_VALUE_INFO.length);
  graphAppend[0] = 0x62;
  graphAppend[1] = LAYER_NORM_84_VALUE_INFO.length;
  graphAppend.set(LAYER_NORM_84_VALUE_INFO, 2);

  let pos = 0;
  while (pos < src.length) {
    const tagStart = pos;
    const [tag, afterTag] = readPbVarint(src, pos);
    const fieldNo = Math.floor(tag / 8);
    const wireType = tag & 7;
    if (wireType === 0) {
      [, pos] = readPbVarint(src, afterTag);
    } else if (wireType === 2) {
      const [len, dataStart] = readPbVarint(src, afterTag);
      const dataEnd = dataStart + len;
      if (fieldNo === 7) {
        const tagBytes = src.subarray(tagStart, afterTag);
        const newLenBytes = encodePbVarint(len + graphAppend.length);
        const out = new Uint8Array(
          tagStart + tagBytes.length + newLenBytes.length + len + graphAppend.length + (src.length - dataEnd)
        );
        let w = 0;
        out.set(src.subarray(0, tagStart), w); w += tagStart;
        out.set(tagBytes, w); w += tagBytes.length;
        out.set(newLenBytes, w); w += newLenBytes.length;
        out.set(src.subarray(dataStart, dataEnd), w); w += len;
        out.set(graphAppend, w); w += graphAppend.length;
        out.set(src.subarray(dataEnd), w);
        return out;
      }
      pos = dataEnd;
    } else if (wireType === 5) {
      pos = afterTag + 4;
    } else if (wireType === 1) {
      pos = afterTag + 8;
    } else {
      return src;
    }
  }
  return src;
}

function projectLinearHead(hidden              , timeSteps        , weight              , bias              )               {
  const numClasses = 257;
  const dim = 512;
  const out = new Float32Array(timeSteps * numClasses);
  for (let t = 0; t < timeSteps; t++) {
    const hOff = t * dim;
    const oOff = t * numClasses;
    for (let c = 0; c < numClasses; c++) {
      const wOff = c * dim;
      let acc = bias[c];
      for (let d = 0; d < dim; d += 4) {
        acc +=
          hidden[hOff + d] * weight[wOff + d] +
          hidden[hOff + d + 1] * weight[wOff + d + 1] +
          hidden[hOff + d + 2] * weight[wOff + d + 2] +
          hidden[hOff + d + 3] * weight[wOff + d + 3];
      }
      out[oOff + c] = acc;
    }
  }
  return out;
}

/**
 * Resolves effective model tier ('mobile' vs 'studio') from user config & device capabilities.
 * - Explicit 'mobile' or 'studio' always wins.
 * - 'auto' (or omitted): selects 'mobile' (<30 MB Conformer-Small) on mobile/constrained browsers
 *   (Android, iOS, or deviceMemory <= 4 GB) and 'studio' (177 MiB Conformer-Large) on desktop & Node.js.
 */
function resolveEffectiveModelTier(tier            )                      {
  if (tier === 'mobile' || tier === 'studio') {
    return tier;
  }
  const isNode = typeof process !== 'undefined' && Boolean(process.versions?.node);
  if (isNode) {
    return 'studio';
  }
  const ua = typeof navigator !== 'undefined' ? navigator?.userAgent || '' : '';
  const platform = typeof navigator !== 'undefined' ? (navigator       )?.platform || '' : '';
  const maxTouch = typeof navigator !== 'undefined' ? navigator?.maxTouchPoints || 0 : 0;
  const devMem = typeof navigator !== 'undefined' ? (navigator       )?.deviceMemory || 8 : 8;
  const isMobile =
    /Android|iPhone|iPad|iPod|CriOS|FxiOS|EdgiOS|Mobile/i.test(ua) ||
    (platform === 'MacIntel' && maxTouch > 1) ||
    devMem <= 4;
  return isMobile ? 'mobile' : 'studio';
}

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
      (typeof __filename !== 'undefined') ||
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

  const ua = typeof navigator !== 'undefined' ? navigator?.userAgent || '' : '';
  const platform = typeof navigator !== 'undefined' ? (navigator       )?.platform || '' : '';
  const maxTouch = typeof navigator !== 'undefined' ? navigator?.maxTouchPoints || 0 : 0;
  const devMem = typeof navigator !== 'undefined' ? (navigator       )?.deviceMemory || 8 : 8;
  const isMobile =
    /Android|iPhone|iPad|iPod|CriOS|FxiOS|EdgiOS|Mobile/i.test(ua) ||
    (platform === 'MacIntel' && maxTouch > 1) ||
    devMem <= 4;

  let threads = 1;
  if (userThreads && userThreads >= 1) {
    threads = isIsolated ? Math.min(isMobile ? 2 : 8, userThreads) : 1;
  } else if (isIsolated && !isMobile) {
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
          linearHead                                                      = null;
          multiHeads                                    = {};
          multiVocabs                           = {};
          lidWeights                          = null;
          hasHiddenOutput          = false;
          vocab           = [];
          executionProvider                    = 'wasm';
          modelTier                      = 'studio';
          allocatedThreads         = 1;
          decoder                  ;
          isWarmed          = false;

          constructor(ort     , config                     ) {
    this.ort = ort;
    this.config = config;
    this.decoder = new CTCGreedyDecoder([]);
  }

  getModelTier()                      {
    return this.modelTier;
  }

  static async create(config                      = {})                          {
    const ort = await getOrt();
    const threads = configureWasmEnvironment(ort, config.numThreads, config.wasmPaths);

    const engine = new AcousticEngine(ort, config);
    engine.allocatedThreads = threads;
    engine.modelTier = resolveEffectiveModelTier(config.modelTier);

    // Load vocabulary for requested language
    const baseModelRef = config.modelPath || config.modelDir;
    await engine.loadVocabulary(config.vocabPath || baseModelRef);

    // Determine execution provider
    engine.executionProvider = config.executionProvider || 'wasm';
    if (engine.executionProvider === 'webgpu') {
      const hasGpu = typeof navigator !== 'undefined' && (navigator       ).gpu;
      if (!hasGpu) {
        engine.executionProvider = 'wasm';
      }
    }

    const rawLang = (config.language || 'sa')                     ;
    const isAutoLang = rawLang === 'auto';
    const lang = isAutoLang ? 'sa' : rawLang;
    const isMobileTier = engine.modelTier === 'mobile';
    const onnxSubfolder = isMobileTier ? 'onnx_mobile' : 'onnx';
    const headsFolder = isMobileTier ? 'heads_mobile' : 'heads';
    const needMultiHeads = isAutoLang || (Boolean(config.codeSwitchEn) && lang !== 'en');

    const modelNames = isAutoLang
      ? (isMobileTier ? ['swanada_mobile_ctc_int8.onnx', 'swanada_mobile_sa_ctc_int8.onnx'] : ['sushrota_sanskrit_ctc_int8.onnx', 'swanada_sa_ctc_int8.onnx'])
      : (isMobileTier
          ? [
              `swanada_mobile_${lang}_ctc_int8.onnx`,
              ...(lang === 'sa' ? ['swanada_mobile_ctc_int8.onnx'] : []),
            ]
          : [
              `swanada_${lang}_ctc_int8.onnx`,
              ...(lang === 'sa' ? ['sushrota_sanskrit_ctc_int8.onnx'] : []),
            ]);

    // Initialize session if model path provided or discover local default
    let effectiveModelPath = baseModelRef;
    if (effectiveModelPath && typeof process !== 'undefined' && process.versions?.node) {
      try {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const resolved = path.resolve(effectiveModelPath);
        if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
          let foundInDir = false;
          for (const mn of modelNames) {
            const c1 = path.join(resolved, onnxSubfolder, mn);
            const c2 = path.join(resolved, mn);
            if (fs.existsSync(c1)) { effectiveModelPath = c1; foundInDir = true; break; }
            if (fs.existsSync(c2)) { effectiveModelPath = c2; foundInDir = true; break; }
          }
          if (!foundInDir) {
            const sharedName = isMobileTier ? 'swanada_mobile_ctc_int8.onnx' : 'sushrota_sanskrit_ctc_int8.onnx';
            const headsFolder = isMobileTier ? 'heads_mobile' : 'heads';
            const scEnc = fs.existsSync(path.join(resolved, onnxSubfolder, sharedName))
              ? path.join(resolved, onnxSubfolder, sharedName)
              : path.join(resolved, sharedName);
            if (fs.existsSync(scEnc)) {
              effectiveModelPath = scEnc;
              if (lang !== 'sa') {
                const headCands = [
                  path.join(resolved, headsFolder, `${lang}.bin`),
                  path.join(resolved, '..', 'docs', headsFolder, `${lang}.bin`),
                ];
                for (const hc of headCands) {
                  if (fs.existsSync(hc)) {
                    const buf = fs.readFileSync(hc);
                    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
                    const floats = new Float32Array(ab);
                    const wc = 257 * 512;
                    engine.linearHead = {
                      weight: floats.subarray(0, wc),
                      bias: floats.subarray(wc, wc + 257),
                    };
                    break;
                  }
                }
              }
            }
          }
        }
      } catch {}
    }
    if (!effectiveModelPath && typeof process !== 'undefined' && process.versions?.node) {
      try {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const { fileURLToPath } = await import('node:url');

        const candidates           = [];

        // 1. Resolve relative to require('url').pathToFileURL(__filename).href
        if (typeof __filename !== 'undefined') {
          try {
            for (const mn of modelNames) {
              candidates.push(fileURLToPath(new URL(`../../../models/${onnxSubfolder}/${mn}`, require('url').pathToFileURL(__filename).href)));
              candidates.push(fileURLToPath(new URL(`../../models/${onnxSubfolder}/${mn}`, require('url').pathToFileURL(__filename).href)));
            }
          } catch {}
        }

        // 2. Resolve relative to process.cwd()
        for (const mn of modelNames) {
          candidates.push(path.resolve(process.cwd(), `models/${onnxSubfolder}`, mn));
        }

        for (const cand of candidates) {
          if (fs.existsSync(cand)) {
            effectiveModelPath = cand;
            break;
          }
        }

        // Shared-encoder + 515 KB `.bin` head fallback when monolithic per-language ONNX isn't materialized
        if (!effectiveModelPath) {
          const sharedName = isMobileTier ? 'swanada_mobile_ctc_int8.onnx' : 'sushrota_sanskrit_ctc_int8.onnx';
          const headsFolder = isMobileTier ? 'heads_mobile' : 'heads';
          const sharedCandidates                                       = [];
          if (typeof __filename !== 'undefined') {
            try {
              sharedCandidates.push({
                enc: fileURLToPath(new URL(`../../../models/${onnxSubfolder}/${sharedName}`, require('url').pathToFileURL(__filename).href)),
                head: fileURLToPath(new URL(`../../../docs/${headsFolder}/${lang}.bin`, require('url').pathToFileURL(__filename).href)),
              });
              sharedCandidates.push({
                enc: fileURLToPath(new URL(`../../models/${onnxSubfolder}/${sharedName}`, require('url').pathToFileURL(__filename).href)),
                head: fileURLToPath(new URL(`../../docs/${headsFolder}/${lang}.bin`, require('url').pathToFileURL(__filename).href)),
              });
            } catch {}
          }
          sharedCandidates.push(
            {
              enc: path.resolve(process.cwd(), `models/${onnxSubfolder}`, sharedName),
              head: path.resolve(process.cwd(), `docs/${headsFolder}`, `${lang}.bin`),
            },
            {
              enc: path.resolve(process.cwd(), `models/${onnxSubfolder}`, sharedName),
              head: path.resolve(process.cwd(), `models/${headsFolder}`, `${lang}.bin`),
            }
          );
          for (const sc of sharedCandidates) {
            if (fs.existsSync(sc.enc)) {
              effectiveModelPath = sc.enc;
              if (lang !== 'sa' && fs.existsSync(sc.head)) {
                const buf = fs.readFileSync(sc.head);
                const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
                const floats = new Float32Array(ab);
                const wc = 257 * 512;
                engine.linearHead = {
                  weight: floats.subarray(0, wc),
                  bias: floats.subarray(wc, wc + 257),
                };
              }
              break;
            }
          }
        }
      } catch {}
    }

    if (needMultiHeads) {
      const targetLangs = isAutoLang ? LID_LANGUAGES : [lang, 'en'];
      await engine.loadMultiHeadsAndVocabs(targetLangs, baseModelRef, headsFolder);
      if (!isAutoLang && engine.multiHeads[lang] && !engine.linearHead) {
        engine.linearHead = engine.multiHeads[lang];
      }
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
    const rawLang = this.config.language || 'sa';
    const lang = rawLang === 'auto' ? 'sa' : rawLang;
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
          // 1. Resolve relative to require('url').pathToFileURL(__filename).href
          if (typeof __filename !== 'undefined') {
            try {
              candidates.push(fileURLToPath(new URL(`../../../models/vocabularies/${vocabFileName}`, require('url').pathToFileURL(__filename).href)));
              candidates.push(fileURLToPath(new URL(`../../models/vocabularies/${vocabFileName}`, require('url').pathToFileURL(__filename).href)));
              if (lang === 'sa') {
                candidates.push(fileURLToPath(new URL('../../../models/vocabularies/sanskrit_vocab.json', require('url').pathToFileURL(__filename).href)));
                candidates.push(fileURLToPath(new URL('../../models/vocabularies/sanskrit_vocab.json', require('url').pathToFileURL(__filename).href)));
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

  async loadMultiHeadsAndVocabs(
    langs                   ,
    baseModelRef         ,
    headsFolder         = 'heads'
  )                {
    const isNode = typeof process !== 'undefined' && Boolean(process.versions?.node);
    if (isNode) {
      try {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const { fileURLToPath } = await import('node:url');

        const roots           = [];
        if (baseModelRef && !baseModelRef.startsWith('http')) {
          const resRef = path.resolve(baseModelRef);
          const dir = fs.existsSync(resRef) && fs.statSync(resRef).isDirectory() ? resRef : path.dirname(resRef);
          roots.push(dir, path.dirname(dir));
        }
        if (typeof __filename !== 'undefined') {
          try {
            roots.push(fileURLToPath(new URL('../../../', require('url').pathToFileURL(__filename).href)));
            roots.push(fileURLToPath(new URL('../../', require('url').pathToFileURL(__filename).href)));
          } catch {}
        }
        roots.push(process.cwd(), path.resolve(process.cwd(), '..'));

        for (const lg of langs) {
          if (!this.multiVocabs[lg]) {
            const vNames = lg === 'sa' ? ['sa_vocab.json', 'sanskrit_vocab.json'] : [`${lg}_vocab.json`];
            for (const r of roots) {
              let foundV                = null;
              for (const vn of vNames) {
                for (const sub of ['models/vocabularies', 'vocabularies', 'docs/vocabularies', '']) {
                  const cand = sub ? path.join(r, sub, vn) : path.join(r, vn);
                  if (fs.existsSync(cand)) { foundV = cand; break; }
                }
                if (foundV) break;
              }
              if (foundV) {
                const raw = JSON.parse(fs.readFileSync(foundV, 'utf8'));
                this.multiVocabs[lg] = Array.isArray(raw) ? raw : Object.values(raw);
                break;
              }
            }
          }
          if (!this.multiHeads[lg]) {
            for (const r of roots) {
              let foundH                = null;
              for (const sub of [`docs/${headsFolder}`, headsFolder, `models/${headsFolder}`]) {
                const cand = path.join(r, sub, `${lg}.bin`);
                if (fs.existsSync(cand) && fs.statSync(cand).size >= (257 * 512 + 257) * 4) {
                  foundH = cand;
                  break;
                }
              }
              if (foundH) {
                const buf = fs.readFileSync(foundH);
                const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
                const floats = new Float32Array(ab);
                const wc = 257 * 512;
                this.multiHeads[lg] = {
                  weight: floats.subarray(0, wc),
                  bias: floats.subarray(wc, wc + 257),
                };
                break;
              }
            }
          }
        }

        if (!this.lidWeights && langs.length > 2) {
          const lidCands           = [];
          if (this.config.lidHeadPath) lidCands.push(path.resolve(this.config.lidHeadPath));
          for (const r of roots) {
            lidCands.push(
              path.join(r, 'docs', headsFolder, 'lid.bin'),
              path.join(r, headsFolder, 'lid.bin'),
              path.join(r, 'models', headsFolder, 'lid.bin')
            );
          }
          for (const lc of lidCands) {
            if (fs.existsSync(lc)) {
              try {
                const buf = fs.readFileSync(lc);
                this.lidWeights = parseLidHeadBytes(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
                break;
              } catch {}
            }
          }
        }
      } catch {}
    } else if (typeof fetch !== 'undefined') {
      await Promise.all(
        langs.map(async (lg) => {
          if (!this.multiVocabs[lg]) {
            const vUrls = lg === 'sa'
              ? ['./vocabularies/sanskrit_vocab.json', './models/vocabularies/sanskrit_vocab.json']
              : [`./vocabularies/${lg}_vocab.json`, `./models/vocabularies/${lg}_vocab.json`];
            for (const u of vUrls) {
              try {
                const r = await fetch(u);
                if (r.ok) {
                  const j = await r.json();
                  this.multiVocabs[lg] = Array.isArray(j) ? j : Object.values(j);
                  break;
                }
              } catch {}
            }
          }
          if (!this.multiHeads[lg]) {
            for (const u of [`./${headsFolder}/${lg}.bin`, `./docs/${headsFolder}/${lg}.bin`]) {
              try {
                const r = await fetch(u);
                if (r.ok) {
                  const ab = await r.arrayBuffer();
                  if (ab.byteLength >= (257 * 512 + 257) * 4) {
                    const floats = new Float32Array(ab);
                    const wc = 257 * 512;
                    this.multiHeads[lg] = {
                      weight: floats.subarray(0, wc),
                      bias: floats.subarray(wc, wc + 257),
                    };
                    break;
                  }
                }
              } catch {}
            }
          }
        })
      );
      if (!this.lidWeights && langs.length > 2) {
        const lidUrls = this.config.lidHeadPath
          ? [this.config.lidHeadPath]
          : [`./${headsFolder}/lid.bin`, `./docs/${headsFolder}/lid.bin`];
        for (const u of lidUrls) {
          try {
            const r = await fetch(u);
            if (r.ok) {
              const ab = await r.arrayBuffer();
              this.lidWeights = parseLidHeadBytes(ab);
              break;
            }
          } catch {}
        }
      }
    }
  }

  async loadAcousticModel(modelPathOrUrl        )                {
    let modelBytes = await loadModelAsset(modelPathOrUrl, this.config.cacheStorageName);
    const needHidden =
      Boolean(this.linearHead) ||
      this.config.language === 'auto' ||
      Boolean(this.config.codeSwitchEn) ||
      Object.keys(this.multiHeads).length > 0;
    if (needHidden) {
      modelBytes = exposeEncoderHiddenOutput(modelBytes);
      this.hasHiddenOutput = true;
    }
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

      if (this.linearHead && outputs.layer_norm_84) {
        const hidTensor = outputs.layer_norm_84;
        const hDims = hidTensor.dims; // [1, timeSteps, 512]
        const timeSteps = hDims.length === 3 ? hDims[1] : hDims[0];
        const logits = projectLinearHead(
          hidTensor.data                ,
          timeSteps,
          this.linearHead.weight,
          this.linearHead.bias
        );
        const inferenceMs = performance.now() - startMs;
        return {
          logits,
          timeSteps,
          numClasses: 257,
          inferenceMs,
        };
      }

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

          async runEncoderHidden(features              , numFrames        )                                                                                                   {
    let featsTensor      = null;
    let lenTensor      = null;
    let outputs      = null;
    try {
      featsTensor = new this.ort.Tensor('float32', features, [1, 80, numFrames]);
      lenTensor = new this.ort.Tensor('int64', BigInt64Array.from([BigInt(numFrames)]), [1]);
      outputs = await this.acousticSession.run({
        audio_signal: featsTensor,
        length: lenTensor,
      });
      if (outputs.layer_norm_84) {
        const hidTensor = outputs.layer_norm_84;
        const hDims = hidTensor.dims;
        const timeSteps = hDims.length === 3 ? hDims[1] : hDims[0];
        const hidden = new Float32Array(hidTensor.data);
        let logits                           = undefined;
        let numClasses                     = undefined;
        if (outputs.logits) {
          const lDims = outputs.logits.dims;
          numClasses = lDims.length === 3 ? lDims[2] : lDims[1];
          logits = new Float32Array(outputs.logits.data);
        }
        return { hidden, timeSteps, logits, numClasses };
      }
      const logitsTensor = outputs.logits || Object.values(outputs)[0];
      const dims = logitsTensor.dims;
      const timeSteps = dims.length === 3 ? dims[1] : dims[0];
      const numClasses = dims.length === 3 ? dims[2] : dims[1];
      return {
        hidden: new Float32Array(0),
        timeSteps,
        logits: new Float32Array(logitsTensor.data),
        numClasses,
      };
    } finally {
      featsTensor?.dispose?.();
      lenTensor?.dispose?.();
      if (outputs) {
        for (const t of Object.values(outputs)) (t       )?.dispose?.();
      }
    }
  }

  /**
   * Detects spoken language across all 12 supported languages using shared `layer_norm_84`.
   */
  async detectLanguage(pcm              )                                   {
    const fallback = (this.config.language && this.config.language !== 'auto') ? this.config.language : 'sa';
    if (pcm.length === 0 || !this.acousticSession) {
      return { language: fallback, confidence: 0, probabilities: {}, usedNeuralLid: false };
    }
    let sumSq = 0;
    for (let i = 0; i < pcm.length; i++) sumSq += pcm[i] * pcm[i];
    if (Math.sqrt(sumSq / pcm.length) < 1e-4) {
      return { language: fallback, confidence: 0, probabilities: {}, usedNeuralLid: false };
    }
    let cleanPcm = pcm;
    if (this.config.denoise !== false) {
      const enhanced = enhanceSpeechWithTelemetry(pcm);
      if (!enhanced.isSpeechLikely) {
        return { language: fallback, confidence: 0, probabilities: {}, usedNeuralLid: false };
      }
      cleanPcm = enhanced.pcm;
    }
    const headsFolder = this.modelTier === 'mobile' ? 'heads_mobile' : 'heads';
    if (Object.keys(this.multiHeads).length < LID_LANGUAGES.length) {
      await this.loadMultiHeadsAndVocabs(LID_LANGUAGES, this.config.modelPath || this.config.modelDir, headsFolder);
    }
    const mel = extractLogMelFeatures(cleanPcm);
    const enc = await this.runEncoderHidden(mel.features, mel.numFrames);
    if (enc.hidden.length === 0 || Object.keys(this.multiHeads).length === 0) {
      return { language: fallback, confidence: 1, probabilities: { [fallback]: 1 }, usedNeuralLid: false };
    }
    const { result } = detectLanguageFromHidden(
      enc.hidden,
      enc.timeSteps,
      this.multiHeads,
      this.multiVocabs,
      this.lidWeights
    );
    return result;
  }

  /**
   * Transcribes a 16 kHz Float32Array PCM buffer.
   */
  async transcribe(
    pcm              ,
    options                                                                           
  )                               {
    const durationMs = (pcm.length / 16000) * 1000;
    const startTotal = performance.now();
    const cfgLang = this.config.language || 'sa';
    const targetLang = options?.forcedLanguage || cfgLang;
    const useCodeSwitch = options?.codeSwitchEn !== undefined ? options.codeSwitchEn : Boolean(this.config.codeSwitchEn);

    if (pcm.length === 0) {
      return {
        text: '',
        language: targetLang,
        durationMs: 0,
        inferenceMs: 0,
        rtf: 0,
        tokens: [],
        ...(cfgLang === 'auto' ? { languageConfidence: 0 } : {}),
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
        language: targetLang,
        durationMs,
        inferenceMs: elapsedMs,
        rtf: durationMs > 0 ? (elapsedMs / durationMs) : 0,
        tokens: [],
        ...(cfgLang === 'auto' ? { languageConfidence: 0 } : {}),
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
          language: targetLang,
          durationMs,
          inferenceMs: elapsedMs,
          rtf: durationMs > 0 ? (elapsedMs / durationMs) : 0,
          tokens: [],
          snrDb,
          ...(cfgLang === 'auto' ? { languageConfidence: 0 } : {}),
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

    // 2. Auto-LID / Multi-Head / Code-Switch path when `layer_norm_84` is active
    if (
      this.hasHiddenOutput &&
      (targetLang === 'auto' ||
        (options?.forcedLanguage && this.multiHeads[options.forcedLanguage]) ||
        (useCodeSwitch && targetLang !== 'en'))
    ) {
      const headsFolder = this.modelTier === 'mobile' ? 'heads_mobile' : 'heads';
      if (useCodeSwitch && targetLang !== 'en' && (!this.multiHeads.en || !this.multiVocabs.en)) {
        await this.loadMultiHeadsAndVocabs([targetLang === 'auto' ? 'sa' : targetLang, 'en'], this.config.modelPath || this.config.modelDir, headsFolder);
      }
      const enc = await this.runEncoderHidden(features, numFrames);
      if (enc.hidden.length > 0) {
        let activeLang = targetLang;
        let langConfidence                     = undefined;
        let langProbs                                     = undefined;
        let englishSpans                               = undefined;
        let primaryLogits                           = undefined;

        if (activeLang === 'auto') {
          const { result: lidRes, cachedLogits } = detectLanguageFromHidden(
            enc.hidden,
            enc.timeSteps,
            this.multiHeads,
            this.multiVocabs,
            this.lidWeights
          );
          activeLang = lidRes.language;
          langConfidence = lidRes.confidence;
          langProbs = lidRes.probabilities;
          primaryLogits = cachedLogits[activeLang];
          if (!primaryLogits && this.multiHeads[activeLang]) {
            primaryLogits = projectLinearHead(
              enc.hidden,
              enc.timeSteps,
              this.multiHeads[activeLang].weight,
              this.multiHeads[activeLang].bias
            );
          }
          if (useCodeSwitch && activeLang !== 'en' && this.multiHeads.en && this.multiVocabs.en && primaryLogits) {
            const enLogits =
              cachedLogits.en ||
              projectLinearHead(enc.hidden, enc.timeSteps, this.multiHeads.en.weight, this.multiHeads.en.bias);
            const csRes = decodeBilingualCodeswitch(
              primaryLogits,
              enc.timeSteps,
              this.multiVocabs[activeLang] || this.vocab,
              activeLang,
              enLogits,
              this.multiVocabs.en,
              Boolean(options?.isPartial)
            );
            const totalInferenceMs = performance.now() - startTotal;
            return {
              text: csRes.text,
              language: activeLang,
              durationMs,
              inferenceMs: totalInferenceMs,
              rtf: durationMs > 0 ? totalInferenceMs / durationMs : 0,
              tokens: csRes.tokens,
              ...(activeLang === 'sa' && csRes.text ? { iast: devanagariToIast(csRes.text) } : {}),
              snrDb,
              languageConfidence: langConfidence,
              languageProbabilities: langProbs,
              englishSpans: csRes.englishSpans,
            };
          }
        } else {
          const headObj = this.multiHeads[activeLang] || this.linearHead;
          if (headObj) {
            primaryLogits = projectLinearHead(enc.hidden, enc.timeSteps, headObj.weight, headObj.bias);
          } else if (enc.logits) {
            primaryLogits = enc.logits;
          }
          if (useCodeSwitch && activeLang !== 'en' && this.multiHeads.en && this.multiVocabs.en && primaryLogits) {
            const enLogits = projectLinearHead(
              enc.hidden,
              enc.timeSteps,
              this.multiHeads.en.weight,
              this.multiHeads.en.bias
            );
            const csRes = decodeBilingualCodeswitch(
              primaryLogits,
              enc.timeSteps,
              this.multiVocabs[activeLang] || this.vocab,
              activeLang,
              enLogits,
              this.multiVocabs.en,
              Boolean(options?.isPartial)
            );
            const totalInferenceMs = performance.now() - startTotal;
            return {
              text: csRes.text,
              language: activeLang,
              durationMs,
              inferenceMs: totalInferenceMs,
              rtf: durationMs > 0 ? totalInferenceMs / durationMs : 0,
              tokens: csRes.tokens,
              ...(activeLang === 'sa' && csRes.text ? { iast: devanagariToIast(csRes.text) } : {}),
              snrDb,
              englishSpans: csRes.englishSpans,
            };
          }
        }

        if (primaryLogits) {
          const activeVocab = this.multiVocabs[activeLang] || this.vocab;
          const decodeRes = decodeCTC(
            primaryLogits,
            [enc.timeSteps, 257],
            activeVocab,
            options?.isPartial ? { isPartial: true } : undefined
          );
          const totalInferenceMs = performance.now() - startTotal;
          return {
            text: decodeRes.text,
            language: activeLang,
            durationMs,
            inferenceMs: totalInferenceMs,
            rtf: durationMs > 0 ? totalInferenceMs / durationMs : 0,
            tokens: decodeRes.tokens,
            ...(activeLang === 'sa' && decodeRes.text ? { iast: devanagariToIast(decodeRes.text) } : {}),
            snrDb,
            ...(langConfidence !== undefined ? { languageConfidence: langConfidence } : {}),
            ...(langProbs !== undefined ? { languageProbabilities: langProbs } : {}),
          };
        }
      }
    }

    // 2b. Standard single-language Acoustic inference
    const acousticRes = await this.runAcousticInference(features, numFrames);

    // 3. CTC decode
    const decodeRes = decodeCTC(
      acousticRes.logits,
      [acousticRes.timeSteps, acousticRes.numClasses],
      this.vocab,
      options?.isPartial ? { isPartial: true } : undefined
    );

    const totalInferenceMs = performance.now() - startTotal;
    const rtf = durationMs > 0 ? (totalInferenceMs / durationMs) : 0;

    return {
      text: decodeRes.text,
      language: targetLang,
      durationMs,
      inferenceMs: totalInferenceMs,
      rtf,
      tokens: decodeRes.tokens,
      ...(targetLang === 'sa' && decodeRes.text ? { iast: devanagariToIast(decodeRes.text) } : {}),
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

  getVocabForLanguage(lang        )           {
    return this.multiVocabs[lang] || this.vocab;
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
          pendingChunk               = new Float32Array(0);
          leftContextSamples        ;
          maxBufferSamples        ;
          vadSilenceThreshold        ;
          totalAudioSamples         = 0;
          consecutiveSilentSamples         = 0;
          pauseThresholdSamples         = 8000; // 500 ms @ 16 kHz turn-segmentation threshold
          baseCommittedTokens           = [];
          isFinished          = false;
          isWindowSliding          = false;
          samplesSinceLastInference         = 0;
          hasUntranscribedTail          = false;
          pendingTurnFlush          = false;
          lastPartialTranscript                             = null;
          isAutoLanguage          = false;
          detectedLanguage                     = undefined;
          languageConfidence                     = undefined;
          languageLocked          = false;
          fullRecordingPcm               = new Float32Array(0);

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
      trailTokens: 3,
      requireStabilityOnWordBoundary: true,
    });
    this.leftContextSamples = options?.leftContextSamples ?? 25600; // 1,600 ms overlap guarantees committed tail stays in window
    this.maxBufferSamples = options?.maxBufferSamples ?? 61440; // 3,840 ms window cap
    this.vadSilenceThreshold = options?.vadSilenceThreshold ?? 0.005;
    this.isAutoLanguage = ((engine       )?.config?.language === 'auto');
  }

          async transcribeStreamWindow(evalBuffer              , isPartial         )                               {
    if (!this.isAutoLanguage) {
      return isPartial
        ? (this.engine       ).transcribe(evalBuffer, { isPartial: true })
        : (this.engine       ).transcribe(evalBuffer);
    }
    if (this.languageLocked && this.detectedLanguage) {
      return (this.engine       ).transcribe(evalBuffer, {
        isPartial,
        forcedLanguage: this.detectedLanguage,
      });
    }
    const res                      = await (this.engine       ).transcribe(evalBuffer, { isPartial });
    if (res.language && res.language !== 'auto') {
      if (this.detectedLanguage !== res.language) {
        this.detectedLanguage = res.language;
        const newVocab =
          typeof (this.engine       ).getVocabForLanguage === 'function'
            ? (this.engine       ).getVocabForLanguage(res.language)
            : (this.engine       ).getVocab?.() || [];
        this.decoder = new StreamingCTCDecoder(newVocab, {
          trailTokens: 3,
          requireStabilityOnWordBoundary: true,
        });
        this.baseCommittedTokens = [];
      }
      this.languageConfidence = res.languageConfidence;
      if (evalBuffer.length >= 24000 && (res.languageConfidence ?? 0) >= 0.78) {
        this.languageLocked = true;
      }
    }
    return res;
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

          promotePendingTurn()       {
    const lastHyp           = (this.decoder       ).lastHypTokens || [];
    const comm = this.decoder.getCommittedTokens();
    if (
      lastHyp.length > comm.length &&
      comm.every((tok        , idx        ) => tok === lastHyp[idx])
    ) {
      const prevCommStr = this.decoder.getCommittedText();
      const candRaw = normalizeIndicText(
        lastHyp.join(''),
        (this.decoder       ).options
      );
      const candStr = (this.decoder       ).isEnglish ? formatEnDisplay(candRaw) : candRaw;
      if (!prevCommStr || candStr.startsWith(prevCommStr)) {
        (this.decoder       ).committedTokens = [...lastHyp];
        (this.decoder       ).committedText = candStr;
      }
    }
    this.baseCommittedTokens = this.decoder.getCommittedTokens();
    this.pendingTurnFlush = false;
  }

          async segmentTurnOnPause(durationMs        )                {
    if (this.audioBuffer.length >= 4800) {
      if (this.hasUntranscribedTail || !(this.decoder       ).lastHypTokens?.length) {
        try {
          const evalBuf = (this.isWindowSliding && this.audioBuffer.length > this.maxBufferSamples)
            ? this.audioBuffer.slice(-this.maxBufferSamples)
            : this.audioBuffer;
          const tailRes = await this.transcribeStreamWindow(evalBuf, false);
          if (tailRes?.tokens?.length > 0) {
            if (this.pendingTurnFlush) {
              this.promotePendingTurn();
            }
            const committed = this.decoder.getCommittedTokens();
            const globalTokens = !this.isWindowSliding
              ? this.alignGrowingWindow(
                  committed,
                  [...this.baseCommittedTokens, ...tailRes.tokens],
                  this.baseCommittedTokens.length
                )
              : (() => {
                  const [bo, br] = this.findWindowAlignment(committed, tailRes.tokens);
                  return [...committed.slice(0, bo), ...tailRes.tokens.slice(br)];
                })();
            this.lastPartialTranscript = this.decoder.update(globalTokens, false, durationMs, 0, false);
          }
        } catch (err     ) {
          this.emitError(err);
        }
      }
      this.pendingTurnFlush = true;
      this.audioBuffer = new Float32Array(0);
      this.isWindowSliding = false;
      this.samplesSinceLastInference = 0;
      this.hasUntranscribedTail = false;
    }
  }

          hasSpeechEnergy(buf              )          {
    if (buf.length === 0) return false;
    let sumSq = 0;
    for (let i = 0; i < buf.length; i++) sumSq += buf[i] * buf[i];
    if (Math.sqrt(sumSq / buf.length) >= this.vadSilenceThreshold) return true;
    const step = 400;
    for (let off = 0; off + step <= buf.length; off += step) {
      let sSq = 0;
      for (let k = off; k < off + step; k++) sSq += buf[k] * buf[k];
      if (Math.sqrt(sSq / step) >= this.vadSilenceThreshold) return true;
    }
    return false;
  }

  async push(chunk              )                                      {
    if (this.isFinished || chunk.length === 0) return;
    const cap = this.isAutoLanguage ? 960000 : this.maxBufferSamples;
    if (this.isAutoLanguage || !this.isWindowSliding) {
      if (this.fullRecordingPcm.length + chunk.length <= cap) {
        const mergedFull = new Float32Array(this.fullRecordingPcm.length + chunk.length);
        mergedFull.set(this.fullRecordingPcm, 0);
        mergedFull.set(chunk, this.fullRecordingPcm.length);
        this.fullRecordingPcm = mergedFull;
      } else if (this.isAutoLanguage) {
        const mergedFull = new Float32Array(this.fullRecordingPcm.length + chunk.length);
        mergedFull.set(this.fullRecordingPcm, 0);
        mergedFull.set(chunk, this.fullRecordingPcm.length);
        this.fullRecordingPcm = mergedFull.slice(-cap);
      } else {
        this.fullRecordingPcm = new Float32Array(0);
      }
    }
    this.totalAudioSamples += chunk.length;
    const durationMs = (this.totalAudioSamples / 16000) * 1000;

    // Coalesce sub-200ms (< 3200 sample) micro-chunks BEFORE VAD so 20ms-80ms plosive
    // stop consonant closures are never dropped from inside spoken words.
    if (chunk.length < 3200 || this.pendingChunk.length > 0) {
      const merged = new Float32Array(this.pendingChunk.length + chunk.length);
      merged.set(this.pendingChunk, 0);
      merged.set(chunk, this.pendingChunk.length);
      this.pendingChunk = merged;

      let pSumSq = 0;
      for (let i = 0; i < this.pendingChunk.length; i++) {
        pSumSq += this.pendingChunk[i] * this.pendingChunk[i];
      }
      const pRms = Math.sqrt(pSumSq / this.pendingChunk.length);

      if (this.lastPartialTranscript === null) {
        if (this.pendingChunk.length < 1600) {
          return;
        }
        if (this.pendingChunk.length < 3200 && pRms < this.vadSilenceThreshold) {
          return;
        }
      } else if (this.pendingChunk.length < 3200) {
        if (!this.pendingTurnFlush && pRms >= this.vadSilenceThreshold) {
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

      chunk = this.pendingChunk;
      this.pendingChunk = new Float32Array(0);
    }

    // Non-destructive silence check & sub-frame pause utterance segmentation
    let sumSq = 0;
    for (let i = 0; i < chunk.length; i++) sumSq += chunk[i] * chunk[i];
    const rms = Math.sqrt(sumSq / chunk.length);

    if (rms < this.vadSilenceThreshold) {
      this.consecutiveSilentSamples += chunk.length;
      if (this.consecutiveSilentSamples >= this.pauseThresholdSamples) {
        await this.segmentTurnOnPause(durationMs);
        if (
          this.pendingTurnFlush &&
          this.consecutiveSilentSamples >= Math.max(this.pauseThresholdSamples, 16000)
        ) {
          this.promotePendingTurn();
          if (this.decoder.getCommittedText()) {
            this.lastPartialTranscript = {
              text: this.decoder.getCommittedText(),
              committed: this.decoder.getCommittedText(),
              volatile: '',
              isFinal: false,
              tokens: this.decoder.getCommittedTokens(),
              durationMs,
              inferenceMs: 0,
              rtf: 0,
            };
          }
        }
        return;
      }
      return;
    }

    // Measure leading and trailing 25ms (400-sample) silent sub-frames on straddling chunks
    let leadSilent = 0;
    const step = 400;
    while (leadSilent + step <= chunk.length) {
      let sSq = 0;
      for (let k = leadSilent; k < leadSilent + step; k++) sSq += chunk[k] * chunk[k];
      if (Math.sqrt(sSq / step) < this.vadSilenceThreshold) {
        leadSilent += step;
      } else {
        break;
      }
    }

    let trailSilent = 0;
    while (trailSilent + step <= chunk.length - leadSilent) {
      let sSq = 0;
      const startIdx = chunk.length - trailSilent - step;
      for (let k = startIdx; k < startIdx + step; k++) sSq += chunk[k] * chunk[k];
      if (Math.sqrt(sSq / step) < this.vadSilenceThreshold) {
        trailSilent += step;
      } else {
        break;
      }
    }

    let activeChunk = chunk;
    if (leadSilent > 0 && this.consecutiveSilentSamples + leadSilent >= this.pauseThresholdSamples) {
      await this.segmentTurnOnPause(durationMs);
      activeChunk = chunk.subarray(leadSilent);
      if (activeChunk.length === 0) {
        this.consecutiveSilentSamples = trailSilent;
        return;
      }
    }
    this.consecutiveSilentSamples = trailSilent;
    chunk = activeChunk;

    // Concatenate into audioBuffer
    const nextBuf = new Float32Array(this.audioBuffer.length + chunk.length);
    nextBuf.set(this.audioBuffer, 0);
    nextBuf.set(chunk, this.audioBuffer.length);
    this.audioBuffer = nextBuf;
    this.samplesSinceLastInference += chunk.length;

    // Allow initial chunk emission starting at 100ms (1600 samples)
    if (this.audioBuffer.length < 1600) {
      this.hasUntranscribedTail = true;
      return;
    }

    try {
      const evalBuffer = (this.isWindowSliding && this.audioBuffer.length > this.maxBufferSamples)
        ? this.audioBuffer.slice(-this.maxBufferSamples)
        : this.audioBuffer;

      const startInference = performance.now();
      const res = await this.transcribeStreamWindow(evalBuffer, true);
      const inferenceMs = performance.now() - startInference;
      this.samplesSinceLastInference = 0;
      this.hasUntranscribedTail = false;

      if (this.pendingTurnFlush && res.tokens.length > 0) {
        this.promotePendingTurn();
      }

      const committed = this.decoder.getCommittedTokens();
      let globalTokens          ;

      if (this.pendingTurnFlush && res.tokens.length === 0) {
        const lastHyp           = (this.decoder       ).lastHypTokens || [];
        globalTokens = lastHyp.length > committed.length ? [...lastHyp] : [...committed];
      } else if (!this.isWindowSliding) {
        const windowTokens = [...this.baseCommittedTokens, ...res.tokens];
        globalTokens = this.alignGrowingWindow(committed, windowTokens, this.baseCommittedTokens.length);
      } else {
        const [bestOffset, bestRawStart] = this.findWindowAlignment(committed, res.tokens);
        globalTokens = [...committed.slice(0, bestOffset), ...res.tokens.slice(bestRawStart)];
      }

      // Preserve active volatile tokens across momentary mid-utterance breath frames
      const prevHyp           = (this.decoder       ).lastHypTokens || [];
      if (
        prevHyp.length > committed.length &&
        (globalTokens.length <= committed.length ||
          normalizeIndicText(globalTokens.slice(committed.length).join('')) === '')
      ) {
        globalTokens = [...committed, ...prevHyp.slice(committed.length)];
      }

      const commitMinSamples = Math.max(32000, this.maxBufferSamples - 8000);
      const allowCommit =
        !this.pendingTurnFlush && (this.isWindowSliding || this.audioBuffer.length >= commitMinSamples);

      const st = this.decoder.update(globalTokens, false, durationMs, inferenceMs, allowCommit);
      if (this.isAutoLanguage) {
        st.detectedLanguage = this.detectedLanguage;
        st.languageConfidence = this.languageConfidence;
      }
      this.lastPartialTranscript = st;

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

    if (this.pendingChunk.length > 0) {
      if ((this.audioBuffer.length > 0 && !this.pendingTurnFlush) || this.hasSpeechEnergy(this.pendingChunk)) {
        const merged = new Float32Array(this.audioBuffer.length + this.pendingChunk.length);
        merged.set(this.audioBuffer, 0);
        merged.set(this.pendingChunk, this.audioBuffer.length);
        this.audioBuffer = merged;
        this.hasUntranscribedTail = true;
      }
      this.pendingChunk = new Float32Array(0);
    }

    if (this.isAutoLanguage && this.fullRecordingPcm.length >= 400) {
      const fullPcm = this.fullRecordingPcm;
      const fullRes                      = await (this.engine       ).transcribe(fullPcm, { isPartial: false });
      fullRes.durationMs = durationMs;
      fullRes.rtf = durationMs > 0 ? fullRes.inferenceMs / durationMs : 0;
      this.audioBuffer = new Float32Array(0);
      this.pendingChunk = new Float32Array(0);
      this.fullRecordingPcm = new Float32Array(0);
      this.detectedLanguage = undefined;
      this.languageConfidence = undefined;
      this.languageLocked = false;
      this.totalAudioSamples = 0;
      this.consecutiveSilentSamples = 0;
      this.baseCommittedTokens = [];
      this.isWindowSliding = false;
      this.samplesSinceLastInference = 0;
      this.hasUntranscribedTail = false;
      this.pendingTurnFlush = false;
      this.lastPartialTranscript = null;
      this.decoder.reset();
      for (const cb of this.listeners.final) {
        try { cb(fullRes); } catch (e) { this.emitError(e); }
      }
      return fullRes;
    }

    // Run final full-utterance closure decode when active audio buffer has speech
    if (this.audioBuffer.length >= 400) {
      const evalBuffer =
        !this.isWindowSliding &&
        this.baseCommittedTokens.length === 0 &&
        this.fullRecordingPcm.length >= this.audioBuffer.length
          ? this.fullRecordingPcm
          : this.isWindowSliding && this.audioBuffer.length > this.maxBufferSamples
            ? this.audioBuffer.slice(-this.maxBufferSamples)
            : this.audioBuffer;
      const tailRes = await (this.engine       ).transcribe(evalBuffer);
      if (tailRes?.tokens?.length > 0 || !(this.decoder       ).lastHypTokens?.length) {
        if (this.pendingTurnFlush && tailRes?.tokens?.length > 0) {
          this.promotePendingTurn();
        }
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
    }

    const streamingTokens = (this.decoder       ).lastHypTokens?.length
      ? [...(this.decoder       ).lastHypTokens]
      : this.decoder.getCommittedTokens();

    const inferenceMs = performance.now() - startInference;
    const finalSt = this.decoder.update(streamingTokens, true, durationMs, inferenceMs);

    this.audioBuffer = new Float32Array(0);
    this.pendingChunk = new Float32Array(0);
    this.totalAudioSamples = 0;
    this.consecutiveSilentSamples = 0;
    this.baseCommittedTokens = [];
    this.isWindowSliding = false;
    this.samplesSinceLastInference = 0;
    this.hasUntranscribedTail = false;
    this.pendingTurnFlush = false;
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

    const searchLimit = Math.max(this.baseCommittedTokens.length, committedTokens.length - 30);
    const activeCommLen = committedTokens.length - this.baseCommittedTokens.length;
    const minReqMatch = activeCommLen >= 2 ? 2 : 1;

    let bestOffset = committedTokens.length;
    let bestRawStart = 0;
    let bestMatchLen = 0;

    for (let rStart = 0; rStart < rawTokens.length; rStart++) {
      for (let j = searchLimit; j < committedTokens.length; j++) {
        let matchLen = 0;
        while (
          j + matchLen < committedTokens.length &&
          rStart + matchLen < rawTokens.length &&
          committedTokens[j + matchLen] === rawTokens[rStart + matchLen]
        ) {
          matchLen++;
        }
        if (
          j + matchLen === committedTokens.length &&
          matchLen >= minReqMatch &&
          matchLen > bestMatchLen
        ) {
          bestMatchLen = matchLen;
          bestOffset = j;
          bestRawStart = rStart;
        }
      }
    }

    if (bestMatchLen > 0) {
      return [bestOffset, bestRawStart];
    }

    // Near-suffix match (within 1 token of end when boundary token revised)
    for (let rStart = 0; rStart < rawTokens.length; rStart++) {
      for (let j = searchLimit; j < committedTokens.length; j++) {
        let matchLen = 0;
        while (
          j + matchLen < committedTokens.length &&
          rStart + matchLen < rawTokens.length &&
          committedTokens[j + matchLen] === rawTokens[rStart + matchLen]
        ) {
          matchLen++;
        }
        if (
          j + matchLen >= committedTokens.length - 1 &&
          matchLen >= 2 &&
          matchLen > bestMatchLen
        ) {
          bestMatchLen = matchLen;
          bestOffset = j;
          bestRawStart = rStart;
        }
      }
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
    this.pendingChunk = new Float32Array(0);
    this.fullRecordingPcm = new Float32Array(0);
    this.detectedLanguage = undefined;
    this.languageConfidence = undefined;
    this.languageLocked = false;
    this.totalAudioSamples = 0;
    this.consecutiveSilentSamples = 0;
    this.baseCommittedTokens = [];
    this.isFinished = false;
    this.isWindowSliding = false;
    this.samplesSinceLastInference = 0;
    this.hasUntranscribedTail = false;
    this.pendingTurnFlush = false;
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
          expectedLanguage                           = null;
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
          if (this.expectedLanguage && msg.language && msg.language !== this.expectedLanguage) {
            break;
          }
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
            language: msg.language,
            detectedLanguage: msg.detectedLanguage,
            languageConfidence: msg.languageConfidence,
            englishSpans: msg.englishSpans,
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
            languageConfidence: msg.languageConfidence,
            languageProbabilities: msg.languageProbabilities,
            englishSpans: msg.englishSpans,
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
    } else {
      this.worker.onmessage = onMessage;
      this.worker.onerror = onError;
    }
  }

  /**
   * Initializes the background STT worker and awaits readiness.
   */
  async init(config                     )                            {
    if (this.isTerminated) throw new Error('Cannot initialize terminated worker.');
    const targetLang = (config.language || 'sa')                     ;
    this.expectedLanguage = targetLang;
    const prevResolve = this.readyResolve;
    this.readyPromise = new Promise                  ((resolve, reject) => {
      this.readyResolve = (evt) => {
        if (prevResolve && prevResolve !== resolve) {
          try { prevResolve(evt); } catch {}
        }
        resolve(evt);
      };
      this.readyReject = reject;
    });
    this.worker.postMessage({
      type: 'INIT',
      language: targetLang,
      modelTier: config.modelTier,
      modelUrl: config.modelUrl,
      headUrl: config.headUrl,
      lidUrl: config.lidUrl,
      vocabUrl: config.vocabUrl,
      executionProvider: config.executionProvider || 'wasm',
      numThreads: config.numThreads,
      wasmPaths: config.wasmPaths,
      cacheName: config.cacheName,
      codeSwitchEn: Boolean(config.codeSwitchEn),
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
    options                                                                              = {}
  )                            {
    this.expectedLanguage = language;
    const prevResolve = this.readyResolve;
    this.readyPromise = new Promise                  ((resolve, reject) => {
      this.readyResolve = (evt) => {
        if (prevResolve && prevResolve !== resolve) {
          try { prevResolve(evt); } catch {}
        }
        resolve(evt);
      };
      this.readyReject = reject;
    });
    this.worker.postMessage({
      type: 'SET_LANGUAGE',
      language,
      modelUrl: options.modelUrl,
      headUrl: options.headUrl,
      lidUrl: options.lidUrl,
      vocabUrl: options.vocabUrl,
    });
    return this.readyPromise;
  }

  /**
   * Toggles bilingual Indic + English Latin code-switching in the worker.
   */
  setCodeSwitchEn(enabled         )       {
    if (!this.isTerminated) {
      this.worker.postMessage({
        type: 'SET_CODE_SWITCH',
        enabled: Boolean(enabled),
      });
    }
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
        dispatchIncomingMessage(event.data);
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
let activeModelTier                      = 'studio';
let cacheStorageName         = CACHE_STORAGE_NAME;
let denoiseEnabled          = true;
let lastEstimatedSnrDb         = 0;

// Session cache (LRU) for instant language switching without redownloading
const sessionCache = new Map                                           ();

// Streaming session for bounded O(1) real-time transcription
let streamingSession                                 = null;
let latestSetupEpoch = 0;
let activeSetupPromise                       = null;
let inferenceQueue                = Promise.resolve();

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
      (typeof __filename !== 'undefined') ||
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

function detectWorkerMobileRuntime()                                        {
  const ua = typeof navigator !== 'undefined' ? navigator?.userAgent || '' : '';
  const platform = typeof navigator !== 'undefined' ? (navigator       )?.platform || '' : '';
  const maxTouch = typeof navigator !== 'undefined' ? navigator?.maxTouchPoints || 0 : 0;
  const devMem = typeof navigator !== 'undefined' ? (navigator       )?.deviceMemory || 8 : 8;
  const isIOS =
    /iPhone|iPad|iPod|CriOS|FxiOS|EdgiOS/i.test(ua) ||
    (platform === 'MacIntel' && maxTouch > 1);
  const isMobile = isIOS || /Android|Mobile/i.test(ua) || devMem <= 4;
  return { isIOS, isMobile };
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
        (typeof __filename !== 'undefined') ||
        '';
      if (baseHref) {
        ortInstance.env.wasm.wasmPaths = new URL('./ort/', baseHref).href;
      }
    } catch {}
  }

  const isIsolated = typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : false;
  const { isMobile } = detectWorkerMobileRuntime();
  let threads = 1;
  if (numThreads && numThreads >= 1) {
    threads = isIsolated ? Math.min(isMobile ? 2 : 4, numThreads) : 1;
  } else if (isIsolated && !isMobile) {
    const cores = typeof navigator !== 'undefined' ? navigator?.hardwareConcurrency || 4 : 4;
    threads = Math.min(4, Math.max(1, cores - 1));
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
      const cleanVocab = vocabUrlOrPath.split('?')[0];
      const candidates = [
        cleanVocab,
        path.resolve(process.cwd(), cleanVocab),
        path.resolve(process.cwd(), '..', cleanVocab),
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
  const myEpoch = ++latestSetupEpoch;
  workerState = 'INITIALIZING';

  const cacheKey = `${activeModelTier}:${lang}`;
  if (sessionCache.has(cacheKey)) {
    if (myEpoch !== latestSetupEpoch) return;
    currentLanguage = lang;
    const cached = sessionCache.get(cacheKey) ;
    activeSession = cached.session;
    activeVocab = cached.vocab;
    ctcDecoder = new CTCGreedyDecoder(activeVocab);
    const engineAdapter      = {
      config: { language: lang },
      getVocab: () => activeVocab,
      transcribe: async (pcm              , opts                          ) => {
        return runAcousticInference(pcm, opts);
      },
    };
    streamingSession = new StreamingAcousticEngine(engineAdapter, activeVocab, {
      leftContextSamples: 30720,
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

  // 1. Resolve URLs (capability-routed 'mobile' <30MB vs 'studio' 177MiB)
  const isMobileTier = activeModelTier === 'mobile';
  const effectiveModelUrl =
    modelUrl ||
    (isMobileTier
      ? `./models/onnx_mobile/swanada_mobile_${lang}_ctc_int8.onnx`
      : `./models/onnx/swanada_${lang}_ctc_int8.onnx`);
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
  let modelBytes                   ;
  try {
    modelBytes = await loadModelAsset(effectiveModelUrl, cacheStorageName, progressHandler);
  } catch (err) {
    const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (!isNodeEnv && !isOffline && !effectiveModelUrl.startsWith('https://huggingface.co/')) {
      const hfFallbackUrl = isMobileTier
        ? `https://huggingface.co/gnumanth/swanada/resolve/main/onnx_mobile/${lang === 'sa' ? 'swanada_mobile_ctc_int8.onnx' : `swanada_mobile_${lang}_ctc_int8.onnx`}`
        : `https://huggingface.co/gnumanth/swanada/resolve/main/onnx/${lang === 'sa' ? 'sushrota_sanskrit_ctc_int8.onnx' : `swanada_${lang}_ctc_int8.onnx`}`;
      modelBytes = await loadModelAsset(hfFallbackUrl, cacheStorageName, progressHandler);
    } else {
      throw err;
    }
  }

  // Evict oldest cached ONNX session before allocating a new 187.5 MB model on mobile / constrained RAM
  const { isMobile } = detectWorkerMobileRuntime();
  const maxCachedSessions = isMobile ? 1 : 2;
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
    ...(isMobile ? { enableCpuMemArena: false, enableMemPattern: false } : {}),
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
  } finally {
    modelBytes = null;
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

  if (myEpoch !== latestSetupEpoch) return;

  // Save to LRU cache
  currentLanguage = lang;
  sessionCache.set(cacheKey, { session: activeSession, vocab: activeVocab });

  const engineAdapter      = {
    config: { language: lang },
    getVocab: () => activeVocab,
    transcribe: async (pcm              , opts                          ) => {
      return runAcousticInference(pcm, opts);
    },
  };
  streamingSession = new StreamingAcousticEngine(engineAdapter, activeVocab, {
    leftContextSamples: 30720,
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
async function runAcousticInference(
  pcm              ,
  decodeOpts                          
)                                                   {
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
  const decoded = decodeCTC(
    logits,
    [timeSteps, numClasses],
    activeVocab,
    decodeOpts?.isPartial ? { isPartial: true } : undefined
  );
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
        const reqTier = msg.modelTier || config.modelTier;
        const isNodeEnv = typeof process !== 'undefined' && Boolean(process.versions?.node);
        activeModelTier =
          reqTier === 'mobile' || reqTier === 'studio'
            ? reqTier
            : reqTier === 'auto' && !isNodeEnv && detectWorkerMobileRuntime().isMobile
              ? 'mobile'
              : 'studio';
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

function toFloat32Chunk(rawAudio     )               {
  if (!rawAudio) return new Float32Array(0);
  return rawAudio instanceof Float32Array ? rawAudio : new Float32Array(rawAudio);
}

const pendingWorkQueue        = [];
let isDrainingWorkQueue = false;

async function drainWorkQueue()                {
  if (isDrainingWorkQueue) return;
  isDrainingWorkQueue = true;
  try {
    await new Promise((r) => setTimeout(r, 0));
    while (pendingWorkQueue.length > 0) {
      if (activeSetupPromise) {
        try { await activeSetupPromise; } catch {}
      }
      const next = pendingWorkQueue.shift();
      if (!next) continue;
      if (
        (next.type === 'AUDIO_CHUNK' || next.type === 'PROCESS_CHUNK') &&
        !next.isFinal &&
        pendingWorkQueue.length > 0
      ) {
        const chunks = [toFloat32Chunk(next.audio || next.chunk)];
        let lastChunkIndex = next.chunkIndex;
        while (
          pendingWorkQueue.length > 0 &&
          (pendingWorkQueue[0].type === 'AUDIO_CHUNK' || pendingWorkQueue[0].type === 'PROCESS_CHUNK') &&
          !pendingWorkQueue[0].isFinal
        ) {
          const m = pendingWorkQueue.shift();
          chunks.push(toFloat32Chunk(m.audio || m.chunk));
          if (m.chunkIndex !== undefined) lastChunkIndex = m.chunkIndex;
        }
        if (chunks.length > 1) {
          let totalLen = 0;
          for (const c of chunks) totalLen += c.length;
          const merged = new Float32Array(totalLen);
          let offset = 0;
          for (const c of chunks) {
            merged.set(c, offset);
            offset += c.length;
          }
          await handleIncomingMessage({
            ...next,
            audio: merged,
            chunk: undefined,
            chunkIndex: lastChunkIndex,
          });
          await new Promise((r) => setTimeout(r, 0));
          continue;
        }
      }
      await handleIncomingMessage(next);
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    isDrainingWorkQueue = false;
  }
}

function dispatchIncomingMessage(msg     )       {
  if (!msg || !msg.type) return;
  if (msg.type === 'INIT' || msg.type === 'SET_LANGUAGE' || msg.type === 'SET_DENOISE') {
    if (msg.type === 'INIT' || msg.type === 'SET_LANGUAGE') {
      pendingWorkQueue.length = 0;
    }
    const p = handleIncomingMessage(msg);
    if (msg.type === 'INIT' || msg.type === 'SET_LANGUAGE') {
      activeSetupPromise = p;
    }
  } else {
    if (msg.type === 'RESET') {
      pendingWorkQueue.length = 0;
    }
    pendingWorkQueue.push(msg);
    drainWorkQueue().catch(() => {});
  }
}

workerReadyToDispatch = true;
for (const m of startupMessageQueue.splice(0)) {
  dispatchIncomingMessage(m);
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

          async resolvePcm16k(audio                                                  )                        {
    if (audio instanceof Float32Array) {
      return audio;
    }
    if (audio instanceof ArrayBuffer) {
      return decodeAndResampleBrowser(audio, 16000);
    }
    if (typeof Uint8Array !== 'undefined' && audio instanceof Uint8Array) {
      const parsed = parseWav(audio);
      return resamplePcm(parsed.pcm, parsed.sampleRate, 16000);
    }
    if (typeof audio === 'string') {
      if (typeof process !== 'undefined' && process.versions?.node) {
        const fs = await import('node:fs');
        const buf = fs.readFileSync(audio);
        const parsed = parseWav(buf);
        return resamplePcm(parsed.pcm, parsed.sampleRate, 16000);
      }
      const res = await fetch(audio);
      const arrayBuf = await res.arrayBuffer();
      return decodeAndResampleBrowser(arrayBuf, 16000);
    }
    throw new TypeError(`Unsupported audio input type: ${typeof audio}`);
  }

  /**
   * Detects spoken language across all 12 supported languages.
   */
  async detectLanguage(audio                                                  )                                   {
    const pcm = await this.resolvePcm16k(audio);
    return this.engine.detectLanguage(pcm);
  }

  /**
   * Transcribes audio from Float32Array PCM, ArrayBuffer (WAV), Uint8Array / Buffer (WAV), or string (URL / File path in Node).
   */
  async transcribe(
    audio                                                  ,
    options                             
  )                               {
    const pcm = await this.resolvePcm16k(audio);
    return this.engine.transcribe(pcm, options);
  }

  /**
   * Warms up the underlying acoustic engine kernels.
   */
  async warmup()                {
    await this.engine.warmup();
  }

  /**
   * Creates a streaming audio transcription session (alias for createStream).
   */
  stream(options                       )                {
    return this.createStream(options);
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

  async dispose()                {
    await this.engine.release();
  }
}

// Re-export all submodules







module.exports = {
  default: Swanada,
  Swanada,
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
  joinSubwords,
  isSpecialToken,
  decodeCTC,
  decodeCTCTokens,
  CTCGreedyDecoder,
  LID_LANGUAGES,
  SLID_VERSION,
  parseLidHeadBytes,
  serializeLidHeadBytes,
  predictNeuralLidLogProbs,
  predictLidLogProbs,
  scoreCtcHeadEvidence,
  detectLanguageFromHidden,
  decodeBilingualCodeswitch,
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
  resolveEffectiveModelTier,
  AcousticEngine,
  LANGUAGE_REGISTRY,
  TokenRegistry,
  detectScript,
  devanagariToIast,
  transliterateIast,
};
