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

const BRAHMIC_LATERAL_CONSONANTS = '\\u0CB3\\u0B33\\u0C33';

const RE_COLLIDING_MATRAS = new RegExp(`([${BRAHMIC_PRIMARY_MATRA_CLASS}])[${BRAHMIC_PRIMARY_MATRA_CLASS}]+`, 'gu');
const RE_MATRA_THEN_VIRAMA = new RegExp(`([${BRAHMIC_PRIMARY_MATRA_CLASS}])[${BRAHMIC_VIRAMA_CLASS}]+`, 'gu');
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
const RE_BN_DOUBLE_YAPHALA = /([\u0995-\u09B9])(?:\u09CD\u09AF){2,}/gu;
const RE_BN_YAPHALA_DUP_YA = /([\u0995-\u09B9]\u09CD\u09AF)\u09AF(?=[^\u0980-\u09FF]|$)/gu;

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

  // 7. Bengali duplicate ya-phala collapse
  text = text.replace(RE_BN_DOUBLE_YAPHALA, '$1\u09CD\u09AF');
  text = text.replace(RE_BN_YAPHALA_DUP_YA, '$1');

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

  return `${committedStr} ${volatileStr}`;
}

/**
 * Compact front-compressed English lexicon for Trie-guided CTC beam decoding.
 * Zero external dependencies. Lazily unpacked on first English decode call.
 */

const PACKED_EN_LEXICON         = [
  '0aaron|5ed|5ing|5s|1ba|3ck|5ed|5ing|5s|3ndon|7ed|9ed|9ing|9s|7ing|7ment|Bed|Bing|Bs|7s|3s|2bas|5es|3ess|6es|4y|5s|3ied|5',
  's|3ot|5ed|5ing|5s|3reviated|9ion|Ced|Cing|Cs|3y|2domen|7ed|7ing|7s|5inal|9ed|9ing|9s|3ucted|6ion|9ed|9ing|9s|2e|3d|3l|4e',
  'd|4ing|4s|3rdeen|8ed|8ing|8s|3s|2igail|7ed|7ing|7s|3litied|8s|6y|2le|4d|4s|3ing|2normal|8ed|8ing|9ties|8s|2oard|6ed|6ing',
  '|6s|3lished|5tion|9ed|9ing|Ast|Ced|Cing|Cs|9s|3riginal|Aed|Aing|As|4t|5ed|5ing|6on|8ed|8ing|8s|5s|3ut|5ed|5ing|5s|3ve|5d',
  '|5s|4ing|2raham|7ed|7ing|7s|4ms|3oad|6ed|6ing|6s|3upt|6ed|6ing|6lied|9s|7y|6s|2sence|7d|7s|6ing|5t|6ed|6ing|6lied|9s|7y|',
  '6s|3olute|8d|8lied|Bs|9y|8s|7ing|4rb|6ed|8ed|8ing|8s|6ing|9ed|9ing|9s|6s|5ption|Aed|Aing|As|3tract|8ed|8ing|9on|Bed|Bing',
  '|Bs|8s|3urd|6ed|6ing|6s|2u|3ndance|9d|9s|8ing|7t|8ed|8ing|8s|3s|4e|5d|5s|4ing|5ve|7d|7s|6ing|2yss|5es|1cacia|6ed|6ing|6s',
  '|3demic|8ed|8ing|8s|7ed|8s|6y|2celerate|Ad|Bed|Bing|Bs|As|9ing|Aon|Ced|Cing|Cs|9or|Bed|Bing|Bs|4nt|6ed|6ing|6s|4pt|6able',
  '|Ad|As|9ing|7nce|Ad|As|9ing|6ed|8ed|8ing|8s|6ing|6s|4ss|6es|6ibilitied|Es|Cy|8le|Ad|As|9ing|7on|9ed|9ing|9s|6oried|As|8y',
  '|3ident|8al|Aed|Aing|Alied|Ds|By|As|8ed|8ing|8s|3laim|7ed|7ing|7s|3olades|4mmodate|Bd|Bs|Aing|Bon|Ded|Ding|Ds|5panied|As',
  '|9ment|Ded|Ding|Ds|8y|6lish|Aed|Ced|Cing|Cs|Bs|Aing|Ament|Eed|Eing|Es|4rd|6ance|Ad|As|9ing|6ed|6ing|9ed|9ing|9lied|Cs|Ay',
  '|9s|7on|9ed|9ing|9s|6s|4unt|7abilitied|Fs|Dy|9le|Bd|Bs|Aing|8nt|Aed|Aing|As|7ed|7ing|Aed|Aing|As|7s|3reditation|Ded|Ding',
  '|Ds|8ed|Aed|Aing|As|3umulate|Ad|As|9ing|Aon|Ced|Cing|Cs|4racied|9s|7y|6te|8d|8lied|Bs|9y|8s|7ing|4sation|Aed|Aing|As|5e|',
  '6d|7ed|7ing|7s|6s|5ing|5tomed|Aed|Aing|As|2e|3d|3s|2he|4d|4s|3ieve|7d|7ment|Bed|Bing|Bs|7s|6ing|4ng|6ed|6ing|6s|2id|4ed|',
  '4ic|6ed|6ing|6s|5ng|4s|2know|6ed|6ing|6ledge|Bd|Ced|Cing|Cs|Bs|Aing|6s|2oustic|8ed|8ing|8s|2quaintance|Cd|Cs|Bing|8ed|Ae',
  'd|Aing|As|4ire|7d|8ed|8ing|8s|7s|6ing|5sition|Bed|Bing|Bs|2re|4d|4s|3ing|3onym|7ed|7ing|7s|4ss|6es|2t|3ing|6ed|6ing|6s|4',
  'on|6ed|6ing|6s|4vate|8d|8s|7ing|8on|Aed|Aing|As|5e|6d|6lied|9s|7y|6s|5ing|6sm|8ed|8ing|8s|7t|8ed|8ing|8s|6tied|9s|7y|3on',
  '|5ed|5ing|5s|4r|5ed|5ing|5s|3ress|7es|3s|4es|3ual|6ed|6ing|6lied|9s|7y|6s|2ute|5d|5s|4ing|1da|3m|4ant|7ed|7ing|7s|4ed|4i',
  'ng|4s|3pt|5ation|Aed|Aing|As|5ed|6r|7ed|7ing|7s|5ing|6ve|8d|8s|7ing|5s|3s|2d|3ed|5ed|5ing|5s|3ict|6ed|8ed|8ing|8s|6ing|7',
  'on|9ed|9ing|9s|6s|4tion|8al|Aed|Aing|Alied|Ds|By|As|8ed|8ing|8s|6ve|8d|8s|7ing|3ress|7es|3s|2elaide|8d|8s|7ing|3pt|5ed|5',
  'ing|5s|3quate|8d|8lied|Bs|9y|8s|7ing|2here|6d|6nce|9d|9s|8ing|7ts|6s|5ing|2jacent|8ed|8ing|8s|3ective|9d|9s|8ing|3oining',
  '|9ed|9ing|9s|3unct|7ed|7ing|7s|4st|6able|Ad|As|9ing|6ed|6ing|6ment|Aed|Aing|As|6s|4tant|8ed|8ing|8s|2lai|5ed|5ing|5s|2mi',
  'n|5ed|5ing|6ster|Aed|Ced|Cing|Cs|Aing|As|8ration|Eed|Eing|Es|Cve|Ed|Elied|Fies|Fy|Es|Ding|Bor|Ded|Ding|Ds|5s|4ral|7ed|7i',
  'ng|7s|7tied|As|8y|6tion|Aed|Aing|As|5e|6d|7ed|7ing|7s|6s|5ing|8ed|8ing|8s|4ssion|9ed|9ing|9s|4t|5ed|5ing|5s|5ted|8ed|8in',
  'g|8s|2obe|5d|5s|4ing|3lescence|Bd|Bs|Aing|9t|Aed|Aing|As|4ph|6ed|6ing|6s|3pt|5ed|7ed|7ing|7s|5ing|6on|8ed|8ing|8s|6ve|8d',
  '|8s|7ing|5s|3rable|8d|8s|7ing|4ed|4ned|2renaline|Ad|As|9ing|3ian|6ed|6ing|6s|5tic|8ed|8ing|8s|2ult|5ed|6ried|9s|7y|5hood',
  '|9ed|9ing|9s|5ing|5s|2vance|7d|8ed|8ing|8s|7ment|Bed|Bing|Bs|7s|6ing|9ed|9ing|9s|5tage|9d|9s|8ing|3ent|6ed|6ing|7st|9ed|',
  '9ing|9s|6s|6ure|9d|9r|Aed|Aing|As|9s|8ing|8ous|Bes|4rsaried|As|8y|6e|7d|7s|6ing|5t|6ed|6ing|7sed|9ment|Ded|Ding|Ds|8ing|',
  'Bed|Bing|Bs|6s|3ice|6d|6s|5ing|4se|6d|7ed|7ing|7s|6r|7ed|7ing|7s|6s|5ing|5or|7ed|7ied|9s|8ng|7s|7y|3ocacied|9s|7y|6te|8d',
  '|8s|7ing|1egean|6ed|6ing|6s|2r|3ial|6ed|6ing|6s|3o|4drome|9d|9s|8ing|5ynamic|Bed|Bing|Bs|4ed|4ing|4nautical|Ced|Cing|Cs|',
  'As|Bes|4s|3s|2sthetic|9ed|9ing|9s|Aes|1far|4ed|4ing|4s|2fair|6ed|6ing|6s|3ect|6ed|8ed|8ing|8s|6ing|9ed|9ing|9s|7on|9atel',
  'ied|Fs|Dy|9ed|9ing|9s|6s|3iliate|9d|9s|8ing|9on|Bed|Bing|Bs|4nitied|9s|7y|4rm|6ative|Bd|Bs|Aing|6ed|6ing|6s|3luent|8ed|8',
  'ing|8s|3ord|6able|Ad|As|9ing|6ed|6ing|6s|2ghan|6ed|6ing|6s|2ore|5d|5s|4ing|2raid|6ed|6ing|6s|3ic|5an|7ed|7ing|7s|5ed|5in',
  'g|5s|4kaans|9es|2t|3er|5ed|5ing|5life|9d|9s|8ing|5math|9ed|9ing|9s|5noon|9ed|9ing|9s|Aes|5s|5ward|9ed|9ing|9s|Aes|3s|1ga',
  'in|5ed|5ing|5s|6t|7ed|7ing|7s|3tha|6ed|6ing|6s|2e|3d|4ed|4ing|4s|3ncied|7s|5y|4da|6ed|6ing|6s|4t|5ed|5ing|5s|3s|2gravate',
  'd|4egate|9d|9s|8ing|9on|Bed|Bing|Bs|8or|Aed|Aing|As|5ss|7es|7ion|Aed|Aing|As|8ve|Ad|Alied|Ds|By|As|9ing|2ile|5d|5s|4ing|',
  '3ng|5ed|5ing|5s|3tated|6ion|9ed|9ing|9s|2nes|5es|2o|3nied|6s|4y|3s|2ra|4ed|4ing|4rian|8ed|8ing|8s|4s|3e|4d|4e|5d|6ed|6in',
  'g|6s|5ed|5ing|8ed|8ing|8s|5ment|9ed|9ing|9s|5s|4s|3icultural|Ced|Cing|Cs|Ae|Bd|Bs|Aing|4ng|3ound|7ed|7ing|7s|1head|5ed|5',
  'ing|5s|2med|5abad|5ed|5ing|5s|4t|5ed|5ing|5s|1id|3e|4d|4s|5es|3ing|3s|2m|3ee|5ed|5ing|5s|3ing|6ed|6ing|6s|3s|2r|3craft|8',
  'ed|8ing|8s|3ed|4s|3field|8ed|8ing|8s|3ing|6ed|6ing|6s|3lift|7ed|7ing|7s|3plane|8d|8s|7ing|4ort|7ed|7ing|7s|3s|4hip|7ed|7',
  'ing|7s|3ways|2sle|5d|5s|4ing|2x|3es|1ka|3s|2in|4ed|4ing|4s|1la|3bama|7ed|7ing|7s|3in|5ed|5ing|5s|3n|4ed|4ing|4s|3rm|5ed|',
  '7ed|7ing|7s|5ing|5s|3s|4ka|6ed|6ing|6s|4tair|8ed|8ing|8s|2b|3a|4ed|4ing|4nia|7ed|7ing|7n|8ed|8ing|8s|7s|6ed|7s|5s|5y|4s|',
  '3eit|6ed|6ing|6s|4rt|6a|7ed|7ing|7s|6ed|6ing|6o|7ed|7ing|7s|6s|3ion|6ed|6ing|6s|3recht|8ed|8ing|8s|3s|3um|5ed|5ing|5s|2c',
  'ohol|7ed|7ic|9ed|9ing|9s|8ng|8sm|Aed|Aing|As|7s|2derman|8ed|8ing|8s|2e|3c|4ed|4ing|4s|3d|3jandro|9ed|9ing|9s|3ppo|6ed|6i',
  'ng|6s|3rt|5ed|5ing|5s|3s|3x|4ander|9ed|9ing|9s|7ra|9ed|9ing|9s|4es|4ia|6ed|6ing|6s|5s|6es|2f|3a|4ed|4ing|4s|3onso|7ed|7i',
  'ng|7s|3red|6ed|6ing|6s|3s|2gae|5d|5s|4ing|3ebra|7ed|7ic|9ed|9ing|9s|8ng|7s|4rian|8ed|8ing|8s|3orithm|9ed|9ing|9s|2ias|5e',
  's|3ce|5d|5s|4ia|6ed|6ing|6s|5ng|3en|5ed|5ing|5s|3gn|5ed|5ing|5ment|9ed|9ing|9s|5s|3ke|5d|5s|4ing|3son|6ed|6ing|6s|3ve|5d',
  '|5s|4ing|2l|3ah|5ed|5ing|5s|4n|5ed|5ing|5s|3egations|5ed|7lied|As|8y|5henied|As|8y|5iance|Ad|As|9ing|6ng|5ro|7ed|7ing|7s',
  '|4n|5ed|5ing|5s|4rgic|8ed|8ing|8s|4viate|9d|9s|8ing|4y|5s|3iance|8d|8s|7ing|4e|5d|6ed|6ing|6s|5s|6es|4gator|9ed|9ing|9s|',
  '4ing|3ocated|7ion|Aed|Aing|As|4w|5ance|9d|9s|8ing|5ed|5ing|5s|4y|5s|3s|3y|2ma|4ed|4ing|4s|3ightied|9s|7y|3ond|6ed|6ing|6',
  's|4st|6ed|6ing|6s|2one|5d|5s|4g|5ed|5ing|5s|6ide|9d|9s|8ing|4ing|4so|6ed|6ing|6s|3ud|5ed|5ing|5s|2pha|5bet|8ed|8ing|8s|5',
  'ed|5ing|5s|3ine|6d|6s|5ing|3s|2readied|8s|6y|3ight|7ed|7ing|7s|2so|4ed|4ing|4s|2t|3ar|5ed|5ing|5s|3er|5ation|Aed|Aing|As',
  '|5ed|5ing|5n|6ate|9d|9lied|Cs|Ay|9s|8ing|Bed|Bing|Bs|9ve|Bd|Blied|Es|Cy|Bs|Aing|6ed|6ing|6s|5s|3hough|8ed|8ing|8s|3itude',
  '|8d|8s|7ing|3o|4ed|4gether|Aed|Aing|As|4ing|4s|3s|2uminium|9ed|9ing|9s|6um|8ed|8ing|8s|4ni|6ed|6ing|6s|5us|7es|2vin|5ed|',
  '5ing|5s|2ways|6es|1m|2a|3lgamated|9ion|Ced|Cing|Cs|3nda|6ed|6ing|6s|3r|4a|5ed|5ing|5s|4ed|4ing|4s|4th|6ed|6ing|6s|3s|3te',
  'ur|7ed|7ing|7s|3zed|6ed|6ing|6s|5ment|9ed|9ing|9s|4ing|7ed|7ing|7lied|As|8y|7s|4on|6ed|6ing|6s|2bassador|Aed|Aing|As|3er',
  '|5ed|5ing|5s|3ient|7ed|7ing|7s|4guitied|As|8y|6ous|9es|4tion|8ed|8ing|8s|7us|9es|3rose|7d|7s|6ing|3ulance|9d|9s|8ing|4sh',
  '|6ed|7s|6ing|2edeo|6ed|6ing|6s|3lia|6ed|6ing|6s|3nd|5ed|5ing|5ment|9ed|9ing|9s|5s|4ities|3rica|7ed|7ing|7n|8a|9ed|9ing|9',
  's|8ed|8ing|8s|7s|3s|2i|3d|4ed|4ing|4s|5t|6ed|6ing|6s|3ed|4s|3go|5ed|5ing|5s|3n|4ed|4ing|4o|5ed|5ing|5s|4s|3r|4ed|4ing|4s',
  '|3s|2man|5ed|5ing|5s|3o|4ed|4ing|4nia|7ed|7ing|7s|4s|3unition|Aed|Aing|As|2nesia|7ed|7ing|7s|5tied|8s|6y|2ong|5ed|5ing|5',
  's|6t|7ed|7ing|7s|3r|4ed|4ing|4s|3s|4es|3unt|6ed|6ing|6s|4r|5ed|5ing|5s|2p|3hibious|Aes|3le|5d|5s|4ified|8r|9ed|9ing|9s|5',
  'ng|5tude|9d|9s|8ing|3s|2ulet|6ed|6ing|6s|3sed|6ed|6ing|6s|5ment|9ed|9ing|9s|4ing|7ed|7ing|7s|2y|1n|2a|3l|4ed|4ing|4ogied',
  '|8s|6ous|9es|6ue|8d|8s|7ing|6y|4s|4y|5se|7d|7s|8es|6ing|7s|8es|6t|7ed|7ing|7s|5tic|8al|Aed|Aing|As|8ed|8ing|8s|9es|5ze|7',
  'd|7s|6ing|3rch|6ed|7s|6ied|8s|7ng|7st|9ed|9ing|9s|6y|3s|4tasia|9ed|9ing|9s|3t|4ed|4ing|4ole|7d|7s|6ied|8s|7ng|6y|5mical|',
  'Aed|Aing|As|7ed|8s|6y|4s|2cestor|8ed|8ing|8s|6ral|9ed|9ing|9s|7ied|9s|7y|3hor|6age|9d|9s|8ing|6ed|8ed|8ing|8s|6ing|6s|3i',
  'ent|7ed|7ing|7s|2d|3ers|6on|8ed|8ing|8s|4s|3hra|6ed|6ing|6s|3ied|5s|3re|5a|6ed|6ing|6s|7es|5d|5s|5w|6ed|6ing|6s|4ies|7es',
  '|5ng|4oid|7ed|7ing|7s|3s|3y|2gel|5a|6ed|6ing|6s|5ed|5ica|8ed|8ing|8s|6na|8ed|8ing|8s|7g|5o|6ed|6ing|6s|5s|4r|5ed|5ing|5s',
  '|3ie|5d|5s|4ing|3le|5d|6ed|6ing|6s|5s|6es|4ican|8ed|8ing|8s|5ng|3ola|6ed|6ing|6s|3ried|6s|5lied|8s|6y|4y|3uish|7ed|8s|7i',
  'ng|4lar|7ed|7ing|7s|4s|5es|2ied|4s|3mal|6ed|6ing|6s|5ted|8ed|8ing|8s|6ion|9ed|9ing|9s|6or|8ed|8ing|8s|4e|5d|5s|4ing|3ta|',
  '5ed|5ing|5s|2kle|5d|5s|4ing|2n|3a|4ed|4ing|4ls|6es|4rd|6ed|6ing|6s|4s|3e|4d|4s|4tte|7d|7s|6ing|4x|5ation|Aed|Aing|As|5es',
  '|3ie|5d|5s|4ing|4ng|4versaried|Cs|Ay|3ounce|8d|8ment|Ced|Cing|Cs|8r|9ed|9ing|9s|8s|7ing|4y|5ance|9d|9s|8ing|5ing|8ed|8in',
  'g|8s|5s|3s|3ual|6ed|6ing|6lied|9s|7y|6s|2omalied|8s|6y|3nym|6ed|6ing|7tied|As|8y|6ous|9es|6s|3ther|7ed|7ing|7s|2swer|6ed',
  '|6ing|6s|2t|3agonist|Aed|Aing|As|4r|5ctic|9a|Aed|Aing|As|9ed|9ing|9s|5ed|5ing|5s|3enna|7e|8d|8s|7ing|7s|4rior|8ed|8ing|8',
  's|3hem|6ed|6ing|6s|4ologied|As|8y|5nied|8s|6y|4ropological|Fed|Fing|Fs|Ced|Ds|Cst|Eed|Eing|Es|By|3i|4biotics|5odied|9s|7',
  'y|4cipated|9ing|Aon|Ced|Cing|Cs|5s|4ed|4gen|7ed|7ing|7s|4ing|4que|7d|7s|6ing|7tied|As|8y|4s|3oinette|Ad|As|9ing|4n|5ed|6',
  'lla|9ed|9ing|9s|5ia|7ed|7ing|7s|6ed|7s|6ng|6o|7ed|7ing|7s|5s|5y|3s|3werp|7ed|7ing|7s|2xietied|8s|6y|4ous|7es|7lied|As|8y',
  '|2y|3bodied|8s|6y|3one|6d|6s|5ing|3thing|8ed|8ing|8s|3way|6s|4here|8d|8s|7ing|2zac|5ed|5ing|5s|1pache|6d|6s|5ing|3rt|5ed',
  '|5heid|9ed|9ing|9s|5ing|5ment|9ed|9ing|9s|5s|2e|3d|3rture|8d|8s|7ing|3s|3x|4es|2ical|6ed|6ing|6s|2ocalypse|Ad|As|9ing|8t',
  'ic|Bed|Bing|Bs|3llo|6ed|6ing|6s|4ogetic|Aed|Aing|As|6ied|8s|7ze|9d|9s|8ing|6y|3stle|7d|7s|6ing|5olic|9ed|9ing|9s|2palach',
  'ian|Bed|Bing|Bs|5led|4ratus|9es|5el|7ed|7ing|7s|6nt|8ed|8ing|8lied|Bs|9y|8s|3eal|6ed|6ing|9ed|9ing|9s|6s|5r|6ance|Ad|As|',
  '9ing|6ed|6ing|6s|4llate|9d|9s|8ing|4ndix|8es|4t|5ed|5ing|6te|8d|8s|7ing|5s|3lause|8d|8s|7ing|4e|5d|5s|4iances|5cable|Ad|',
  'As|9ing|7nt|9ed|9ing|9s|7tion|Bed|Bing|Bs|5ed|7ed|7ing|7s|6s|5ng|4y|3oint|7ed|7ing|7ment|Bed|Bing|Bs|7s|3reciate|Ad|As|9',
  'ing|Aon|Ced|Cing|Cs|5hension|Ced|Cing|Cs|5ntice|Ad|As|Bhip|Eed|Eing|Es|9ing|4oach|8ed|9s|8ing|Bed|Bing|Bs|5priate|Bd|Bli',
  'ed|Es|Cy|Bs|Aing|Bons|5val|8ed|8ing|8s|6e|7d|7s|6ing|5ximate|Bd|Blied|Es|Cy|Bs|Aing|Bon|Ded|Ding|Ds|2ril|5ed|5ing|5s|3on',
  '|5ed|5ing|5s|2t|3s|1qua|4ed|4ing|4rium|8ed|8ing|8s|4s|4tic|7ed|7ing|7s|3educt|8ed|8ing|8s|1ra|3b|4ed|4ian|7ed|7ing|7s|5c',
  '|6ed|6ing|6s|5ng|4s|3maic|7ed|7ing|7s|3s|2bitraried|As|8y|7tion|Bed|Bing|Bs|3or|5ed|6tum|9ed|9ing|9s|5ing|5s|2c|3ade|6d|',
  '6s|5ia|7ed|7ing|7s|6ng|3h|4ae|6d|6ological|Eed|Eing|Es|Bed|Cs|Bst|Ded|Ding|Ds|Ay|6s|5ic|7ed|7ing|7s|6ng|5ngel|9ed|9ing|9',
  's|4bishop|Aed|Aing|As|4deacon|Aed|Aing|As|5iocese|Bd|Bs|Aing|5uke|8d|8s|7ing|4e|5d|6ed|6ing|6s|5r|6ed|6ied|8s|7ng|6s|6y|',
  '5s|6es|4ibald|9ed|9ing|9s|5e|6d|6s|5ing|5ng|7ed|7ing|7s|5pelago|Bed|Bing|Bs|5tect|9ed|9ing|9s|9ural|Ded|Ding|Ds|Be|Cd|Cs',
  '|Bing|5val|8ed|8ing|8s|6e|7d|7s|6ing|4way|7s|3s|3tic|6ed|6ing|6s|2dent|6ed|6ing|6s|2e|3a|4ed|4ing|4s|3d|3na|5ed|5ing|5s|',
  '3s|2gent|6ed|6ina|9ed|9ing|9s|8e|9d|9s|8g|8ing|6s|3ue|5d|5s|4ing|4ment|8ed|8ing|8s|4s|5es|3yle|6d|6s|5ing|5l|6ed|6ing|6s',
  '|2ia|4ed|4ing|4s|3d|4ed|4ing|4s|3el|5ed|5ing|5s|3se|5d|5s|4ing|4tocracied|Cs|Ay|9tic|Ced|Cing|Cs|3thmetic|Aed|Aing|As|3z',
  'ona|7ed|7ing|7s|2jun|5ed|5ing|5s|2k|3ansas|8es|3s|2lene|6d|6s|5ing|2m|3ada|6ed|6ing|6s|4ment|8ed|8ing|8s|3chair|8ed|8ing',
  '|8s|3ed|5ed|5ing|5s|4nian|8ed|8ing|8s|3ied|5s|4stice|9d|9s|8ing|3or|5ed|7ed|7ing|7s|5ied|7s|6ng|5s|5y|3s|4es|3y|2n|3e|4d',
  '|4s|3ing|3old|6ed|6ing|6s|3s|2oma|5ed|5ing|5s|5tic|8ed|8ing|8s|3se|5d|5s|4ing|3und|6ed|6ing|6s|4sal|7ed|7ing|7s|5ed|2ran',
  'ge|7d|7ment|Bed|Bing|Bs|7r|8ed|8ing|8s|7s|6ing|4y|5s|3est|6ed|6ing|9ed|9ing|9s|6s|3ival|7ed|7ing|7s|5e|6d|6s|5ing|3oganc',
  'e|9d|9s|8ing|7t|8ed|8ing|8s|4w|5ed|5ing|5s|4yo|6ed|6ing|6s|2senal|7ed|7ing|7s|5ic|7ed|7ing|7s|3on|5ed|5ing|5s|2t|3efacts',
  '|4mis|7es|4rial|8ed|8ing|8s|6ed|7s|5y|3hritis|9es|4ur|6ed|6ing|6s|3icle|7d|7s|6ing|5ulated|Bed|Bing|Bs|4fact|8ed|8ing|8s',
  '|5icial|Aed|Aing|As|4lleried|As|8y|4sans|5t|6ed|6ic|8ed|8ing|8s|7ng|6s|3s|2ya|4ed|4ing|4n|5ed|5ing|5s|4s|1s|2a|3s|2besto',
  's|8es|2cended|6ing|9ed|9ing|9s|5sion|9ed|9ing|9s|5t|6ed|6ing|6s|3ot|5ed|5ing|5s|3ribed|2h|3a|4ed|4ing|4med|7ed|7ing|7s|4',
  's|3er|5ed|5ing|5s|4s|5es|3ore|6d|6s|5ing|3ram|2ian|5ed|5ing|5s|4tic|7ed|7ing|7s|3de|5d|5s|4ing|2k|3s|2leep|6ed|6ing|6s|2',
  'pect|6ed|6ing|6s|4n|5ed|5ing|5s|3halt|7ed|7ing|7s|3irations|5ing|8ed|8ing|8s|2s|3am|5ed|5ing|5s|4ssin|8ate|Bd|Bs|Aing|Bo',
  'n|Ded|Ding|Ds|8ed|8ing|8s|4ult|7ed|7ing|7s|3emble|8d|8s|7ied|9s|8ng|7y|4nt|6ed|6ing|6s|4rt|6ed|6ing|7on|9ed|9ing|9s|6s|4',
  's|5s|6ed|8ed|8ing|8s|7s|6ment|Aed|Aing|As|4t|5ed|5ing|5s|6es|3ign|6ed|8ed|8ing|8s|6ing|6ment|Aed|Aing|As|6s|4milation|Ce',
  'd|Cing|Cs|4st|6ance|Ad|As|9ing|8t|9ed|9ing|9s|6ed|6ing|6s|3ociate|9d|Aed|Aing|As|9s|8ing|9on|Bed|Bing|Bs|4rtment|Aed|Ain',
  'g|As|3ume|6d|7ed|7ing|7s|6s|5ing|8ed|8ing|8s|5ption|Aed|Aing|As|4rance|9d|9s|8ing|5e|6d|7ed|7ing|7s|6s|5ing|3yrian|8ed|8',
  'ing|8s|2t|3er|5ed|5ing|5oid|8ed|8ing|8s|5s|3hma|6ed|6ing|6s|3onished|8ing|Bed|Bing|Bs|8ment|Ced|Cing|Cs|4r|5ed|5ing|5s|3',
  'rid|6ed|6ing|6s|4onaut|9ed|9ing|9s|6omer|Aed|Aing|As|8ical|Ced|Cing|Cs|9ed|As|8y|3s|2ylum|6ed|6ing|6s|1t|2a|3s|2e|3d|3s|',
  '2heist|7ed|7ing|7s|4na|6ed|6ing|6s|5ian|8ed|8ing|8s|5s|6es|3lete|7d|7s|6ic|8ed|8ing|8s|9es|7ng|2lanta|7ed|7ing|7s|6ic|8e',
  'd|8ing|8s|4s|5es|2mosphere|Ad|As|9ic|Bed|Bing|Bs|Ang|2oll|5ed|5ing|5s|3m|4ed|4ic|6ed|6ing|6s|5ng|4s|3p|4ed|4ing|4s|2rium',
  '|6ed|6ing|6s|3ocities|2tach|6e|7d|8ed|8ing|8s|7s|6ing|6ment|Aed|Aing|As|5k|6ed|7r|8ed|8ing|8s|6ing|6s|4in|6ed|6ing|6s|3e',
  'mpt|7ed|7ing|7s|4nd|6ance|Ad|As|9ing|8t|9ed|9ing|9s|6ed|6ing|6s|5tion|9ed|9ing|9s|4sted|3ic|5ed|5ing|5s|4re|6d|6s|5ing|4',
  'tude|8d|8s|7ing|3orney|8s|3ract|7ed|7ing|8on|Aed|Aing|As|8ve|Ad|As|9ing|7s|4ibute|9d|9s|8ing|1ubrey|6s|3urn|6ed|6ing|6s|',
  '2ction|7ed|7ing|7s|2dible|7d|7s|6ing|4ence|8d|8s|7ing|4o|5ed|5ing|5s|4t|5ed|5ing|6on|8ed|8ing|8s|5or|7ed|7ied|9s|8ng|8um',
  '|Aed|Aing|As|7s|7y|5s|3rey|6s|2gmented|9ed|9ing|9s|3ust|6a|7ed|7ing|7s|6ed|6ing|6s|6us|8es|2nt|4ed|4ing|4s|2ra|4ed|4ing|',
  '4s|3ora|6ed|6ing|6s|2s|3es|3pices|8es|3tin|6ed|6ing|6s|4ral|7ed|7ia|9ed|9ing|9n|Aed|Aing|As|9s|8ng|7s|5ia|7ed|7ing|7n|8e',
  'd|8ing|8s|7s|2thentic|9ation|Eed|Eing|Es|9ed|9ing|Atied|Ds|By|9s|4or|6ed|6ing|7tarian|Ded|Ding|Ds|9tive|Dd|Ds|Cing|8ied|',
  'As|8y|7zation|Ded|Ding|Ds|8ed|Aed|Aing|As|6s|7hip|Aed|Aing|As|3ism|6ed|6ing|6s|3o|4biographical|Fled|Fling|Fls|Ded|Es|Cy',
  '|4ed|4ing|4mated|7ic|9allied|Es|Cy|9ed|9ing|9s|5obile|Ad|As|9ing|6tive|Ad|As|9ing|4nomied|9s|7ous|Aes|7y|4psied|8s|6y|4s',
  '|3umn|6ed|6ing|6s|2xiliaried|As|8y|1va|3il|5abilitied|Ds|By|7le|9d|9s|8ing|5ed|5ing|5s|3lanche|9d|9s|8ing|3s|2e|3d|3nge|',
  '6d|6rs|6s|5ing|4ue|6d|6s|5ing|3r|4age|7d|7s|6ing|4ed|4ied|6s|5ng|4s|4y|3s|2iation|8ed|8ing|8s|5or|7ed|7ing|7s|3d|4ed|4in',
  'g|4s|2oid|5ance|9d|9s|8ing|5ed|5ing|5s|1wa|3it|5ed|5ing|5s|3ke|5d|5ned|6ing|9ed|9ing|9s|5s|4ing|3rd|5ed|5ing|5s|4e|5d|5n',
  'ess|9es|5s|4ing|3s|3y|4s|2e|3d|3s|4ome|7d|7s|6ing|2ful|5ed|5ing|5s|2hile|6d|6s|5ing|2kward|7ed|7ing|7lied|As|8y|7s|2oke|',
  '5d|5s|4ing|1xe|3d|3l|4ed|4ing|4s|3s|4es|2ial|5ed|5ing|5s|3s|4es|2le|4d|4s|3ing|1ye|3s|1zerbaijani|Bed|Bing|Bs|2tec|5ed|5',
  'ing|5s|2ure|5d|5s|4ing|0bab|3a|4ed|4ing|4s|3e|4d|4s|3ied|5s|4ng|3s|3u|4ed|4ing|4s|3y|4lon|7ed|7ian|Aed|Aing|As|8ng|7s|2c',
  'calaureate|Dd|Ds|Cing|3h|4ed|5lor|8ed|8ing|8s|5s|4ing|3k|4bone|8d|8s|7ing|4drop|8ed|8ing|8s|4ed|6ed|6ing|6s|5rs|4ground|',
  'Aed|Aing|As|4ing|7ed|7ing|7s|4lash|8ed|9s|8ing|4s|5ide|8d|8s|7ing|5tage|9d|9s|8ing|6roke|Ad|As|9ing|4up|6ed|6ing|6s|4war',
  'd|8ed|8ing|8s|9es|3on|5ed|5ing|5s|3teria|8ed|8ing|8l|9ed|9ing|9s|8s|7um|9ed|9ing|9s|2d|3ge|5d|5r|6ed|6ing|6s|5s|4ing|3li',
  'ed|6s|4y|3minton|9ed|9ing|9s|3s|2e|3d|3s|2ffled|3ta|5ed|5ing|5s|2g|3gage|7d|7s|6ing|3s|2h|3amas|3s|2il|4ed|5y|6s|4ing|4s',
  '|3n|4ed|4ing|4s|3t|4ed|4ing|4s|2ked|5ed|5ing|5s|4r|5ed|5ied|7s|6ng|5s|5y|3ing|6ed|6ing|6s|3u|4ed|4ing|4s|2l|3a|4ed|4ing|',
  '4nce|7d|8ed|8ing|8s|7s|6ing|9ed|9ing|9s|4s|3conied|8s|6y|3d|4ed|4ing|4s|4win|7ed|7ing|7s|3i|4ed|4ing|4s|3kan|6ed|6ing|6s',
  '|3l|4ad|6ed|6ing|6s|5st|7ed|7ing|7s|4ed|5t|6ed|6ing|6s|4ing|5stic|9ed|9ing|9s|4oon|7ed|7ing|7s|5t|6ed|6ing|6s|4room|8ed|',
  '8ing|8s|4s|3s|3t|4ed|4ic|6ed|6ing|6s|5more|9d|9s|8ing|5ng|4s|2m|3boo|6ed|6ing|6s|3s|2n|3ana|6ed|6ing|6s|3co|5ed|5ing|5s|',
  '3d|4a|5ed|5ge|7d|7s|6ing|5ing|5s|4ed|6ed|6ing|6s|4ing|5t|6ed|6ing|6s|4s|3e|4d|4s|3g|4alore|4ed|4ing|7ed|7ing|7s|4kok|7ed',
  '|7ing|7s|4s|3ing|4shed|3jo|5ed|5ing|5s|3k|4ed|5r|6ed|6ing|6s|4ing|7ed|7ing|7s|4rupt|8cied|Bs|9y|8ed|8ing|8s|4s|3ner|6ed|',
  '6ing|6s|4ing|7ed|7ing|7s|3quet|7ed|7ing|7s|3s|2ptism|7ed|7ing|7s|6t|7ed|7ing|7s|5zed|2r|3angay|8s|3b|4ados|8es|5ra|7ed|7',
  'ing|7s|6ian|9ed|9ing|9s|4ecue|8d|8s|7ing|5d|6ed|6ing|6s|5r|6ed|6ing|6s|4ing|4ra|6ed|6ing|6s|4s|3celona|9ed|9ing|9s|3d|4e',
  'd|4ing|4s|3e|4d|4foot|8ed|8ing|8s|4lied|7s|5y|4s|3gain|7ed|7ing|7s|4e|5d|5s|4ing|3i|4ed|4ing|4ng|4s|4tone|8d|8s|7ing|3k|',
  '4ed|5r|6ed|6ing|6s|4ing|7ed|7ing|7s|4s|3ley|6s|4ow|6ed|6ing|6s|3n|4ard|7ed|7ing|7s|4ed|5y|6s|4ing|4s|3on|5ed|6ss|8es|6t|',
  '7cied|As|8y|7ed|7ing|7s|5ied|7s|6ng|5s|5y|4que|7d|7s|6ing|3racks|5ge|7d|7s|6ing|4ed|6ed|6ing|6s|5l|6ed|6ing|6s|5n|6ed|6i',
  'ng|6s|5tt|7ed|7ing|7s|4ied|6r|7ed|7ing|7s|6s|5ngton|Aed|Aing|As|5o|6ed|6ing|6s|5ster|9ed|9ing|9s|4ow|6ed|6ing|6s|4y|3s|4',
  'es|3t|4ed|5nder|9ed|9ing|9s|4holomew|Bed|Bing|Bs|4ing|4lett|8ed|8ing|8s|4on|6ed|6ing|6s|4s|2s|3al|5ed|5ing|5s|5t|6ed|6in',
  'g|6s|3e|4ball|8ed|8ing|8s|4d|5ed|5ing|5s|4man|7ed|7ing|7s|5ent|8ed|8ing|8s|4s|5es|3h|4ed|5s|4ing|3ic|5allied|As|8y|5ed|5',
  'ing|5s|4l|5ed|5ica|8ed|8ing|8s|6ng|5s|4n|5ed|5g|5ing|5s|4s|5es|3ket|6ball|Aed|Aing|As|6ed|6ing|6s|3que|6d|6s|5ing|3s|4es',
  '|4ist|7ed|7ing|7s|3t|4ard|7ed|7ing|7s|4ed|4ing|5on|7ed|7ing|7s|4s|2t|3ch|5ed|6s|5ing|3es|3h|4ed|4ing|7ed|7ing|7s|4room|8',
  'ed|8ing|8s|4s|3man|6ed|6ing|6s|3on|5ed|5ing|5s|3s|4es|4man|7ed|7ing|7s|3t|4alion|9ed|9ing|9s|4ed|5r|6ed|8ed|8ing|8s|6ied',
  '|8s|7ng|6s|6y|4ing|7ed|7ing|7s|4le|6d|7ed|7ing|7s|6field|Bed|Bing|Bs|6s|7hip|Aed|Aing|As|5ing|4s|2varian|8ed|8ing|8s|2xt',
  'er|6ed|6ing|6s|2y|3er|5s|3ou|5ed|5ing|5s|3s|2zaar|6ed|6ing|6s|1e|2a|3ch|5ed|6s|5ing|4on|6ed|6ing|6s|3ds|3k|4ed|4ing|4s|3',
  'm|4ed|6ed|6ing|6s|4ing|7ed|7ing|7s|4s|3n|4ed|4ing|4s|3r|4d|5ed|7ed|7ing|7s|5ing|5s|4ed|5r|6ed|6ing|6s|4ing|7ed|7ing|7s|4',
  's|3s|4t|5ed|5ing|5s|3t|4ed|5n|6ed|6ing|6s|4ing|7ed|7ing|7s|4rice|8d|8s|7ing|4s|3u|4ed|4fort|8ed|8ing|8s|4ing|4s|4t|5ed|5',
  'ied|7s|6ful|9ed|9ing|9lied|Cs|Ay|9s|6ng|5s|5y|4x|5es|3ver|6ed|6ing|6s|2cause|7d|7s|6ing|3k|4ed|5r|6ed|6ing|6s|4ie|6d|6s|',
  '5ing|5ng|4s|4y|3ome|6d|6s|7es|5ing|8ed|8ing|8s|2d|3ford|7ed|7ing|7s|3rock|7ed|7ing|7s|5om|7ed|7ing|7s|3s|4ide|7d|7s|6ing',
  '|2e|3ch|5ed|6s|5ing|3f|4ed|4ing|4s|3n|4ed|4ing|4s|3r|4ed|4ing|4s|3s|4es|3tle|6d|6s|5ing|2fore|6d|6hand|Aed|Aing|As|6s|5i',
  'ng|3riended|2g|3ging|7ed|7ing|7s|3in|5ed|5ing|5ning|9ed|9ing|9s|5s|3s|3un|5ed|5ing|5s|2half|6ed|6ing|6s|4ve|6d|6s|5ing|6',
  'or|8al|Aed|Aing|As|8ed|8ing|8s|7ur|3eaded|3ind|6ed|6ing|6s|3old|6ed|6ing|6s|2ige|5d|5s|4ing|3ng|5ed|5ing|5s|2l|3a|4ed|4i',
  'ng|4s|3gian|7ed|7ing|7s|4rade|8d|8s|7ing|3ie|5d|5f|6ed|6ing|6s|5s|5ve|7d|7r|8ed|8ing|8s|7s|6ing|9ed|9ing|9s|4ing|4nda|7e',
  'd|7ing|7s|3l|4a|5ed|5ing|5s|4e|5d|5s|4ied|6s|5ng|4owed|4s|4y|3ong|6ed|6ing|9ed|9ing|9s|6s|4ved|7ed|7ing|7s|4w|5ed|5ing|5',
  's|3s|3t|4ed|4ing|4s|2n|3ch|5ed|6s|5ing|3d|4ed|5r|6ed|6ing|6s|4ing|7ed|7ing|7s|4s|3e|4ath|7ed|7ing|7s|4d|5ict|8ed|8ine|Bd',
  '|Bs|Ag|Aing|8s|4factor|Aed|Aing|As|5icial|Aed|Aing|As|6t|7ed|7ing|7s|4s|4volent|Aed|Aing|As|3g|4al|6ed|6i|7ed|7ing|7ng|7',
  's|6s|6uru|4ed|4ing|4s|3ign|6ed|6ing|6s|4n|5ed|5g|5ing|5s|3jamin|8ed|8ing|8s|3n|4ed|4ied|6s|5ng|4s|4y|3s|4on|6ed|6ing|6s|',
  '3t|4ed|4ing|4on|6ed|6ing|6s|4s|2queathed|2r|3ber|6ed|6ing|6s|3g|4ed|5r|6ed|6ing|6s|4ing|4s|3kshire|9d|9s|8ing|3lin|6ed|6',
  'ing|6s|3muda|7ed|7ing|7s|3n|4ard|7ed|7ing|7s|4ed|4ie|6d|6s|5ing|5ng|4s|3ried|6s|4y|3s|3t|4ed|4h|5a|6ed|6ing|6s|5ed|5ing|',
  '5s|4ie|6d|6s|5ing|5ng|4ram|7ed|7ing|7s|6nd|8ed|8ing|8s|4s|2s|3es|3ide|6d|6s|7es|5ing|4eged|8ed|8ing|8s|3sie|6d|6s|5ing|3',
  't|4ed|4ing|4owed|4s|2t|3a|4ed|4ing|4s|3h|4ed|5l|6ed|6ing|6s|4ing|4lehem|9ed|9ing|9s|4s|3ray|6al|8ed|8ing|8s|6s|3s|4ied|6',
  's|4y|3ter|6ed|6ing|6s|4ied|6s|5ng|7ed|7ing|7s|4y|3ween|7ed|7ing|7s|2verage|8d|8s|7ing|5lied|8s|6y|2wildered|Aed|Aing|As|',
  '2y|3ond|6ed|6ing|6s|3s|1ianca|6ed|6ing|6s|3s|4es|2ble|5d|5s|4ical|8ed|8ing|8s|5ng|5ographied|Ds|By|2ceps|6es|3ycle|7d|7s',
  '|6ing|2d|3ding|7ed|7ing|7s|3s|2en|4ed|4ing|4nial|8ed|8ing|8s|4s|2g|3ger|6ed|6ing|6s|5st|7ed|7ing|7s|3s|2ke|4d|4r|5s|4s|3',
  'ing|5i|6ed|6ing|6s|2lateral|9ed|9ing|9s|3e|4d|4s|3ing|6ual|9ed|9ing|9s|3l|4board|9ed|9ing|9s|4ed|6ed|6ing|6s|4ie|6d|6s|5',
  'ing|5ng|7ed|7ing|7s|5on|7aire|Bd|Bs|Aing|7ed|7ing|7s|4s|4y|2n|3aried|7s|5y|3d|4ed|4ing|7ed|7ing|7s|4s|3g|4ed|4ing|4o|5ed',
  '|5ing|5s|4s|3oculars|3s|2ochemistried|Ds|By|3grapher|Aed|Aing|As|8ical|Ced|Cing|Cs|9ed|As|8y|3logical|Aed|Aing|As|7ed|8s',
  '|7st|9ed|9ing|9s|6y|2partisan|Aed|Aing|As|3lane|7d|7s|6ing|3olar|7ed|7ing|7s|2rch|5ed|6s|5ing|3d|4ed|4ing|4s|3mingham|Ae',
  'd|Aing|As|3th|5day|8s|5ed|5ing|5place|Ad|As|9ing|5s|2s|3cuits|3es|4xual|8ed|8ing|8s|3hop|6ed|6ing|6ric|9ed|9ing|9s|6s|3m',
  'arck|8ed|8ing|8s|3on|5ed|5ing|5s|2t|3ch|5ed|6s|5ing|3e|4d|4s|3ing|6ed|6ing|6s|3s|3ten|6ed|6ing|6s|5r|6ed|6ing|6lied|9s|7',
  'y|6ness|Aes|6s|2zarre|7d|7s|6ing|1jorne|6d|6s|5ing|1lack|5berried|Bs|9y|5ed|6ned|5ing|6sh|8ed|9s|8ing|5mail|9ed|9ing|9s|',
  '5ness|9es|5out|8ed|8ing|8s|5s|6mith|Aed|Aing|As|3dder|7ed|7ing|7s|4e|5d|6ed|6ing|6s|5s|4ing|3h|4ed|4ing|4s|3ine|6d|6s|5i',
  'ng|4r|5ed|5ing|5s|3ke|5d|5s|4ing|3me|5d|6ed|6ing|6s|5s|4ing|7ed|7ing|7s|3nc|5a|6ed|6ing|6s|5ed|5ing|5o|6ed|6ing|6s|5s|4d',
  '|5ed|5ing|5s|4k|5ed|6t|7ed|7ing|7s|5ing|5lied|8s|6y|5s|3st|5ed|7ed|7ing|7s|5ing|8ed|8ing|8s|5s|3t|4ed|4ing|4s|3yne|6d|6s',
  '|5ing|3ze|5d|5rs|5s|4ing|7ed|7ing|7s|2eak|5ed|5ing|5s|3d|4ed|4ing|4s|3ed|5ed|5ing|8ed|8ing|8s|5s|3nd|5ed|7ed|7ing|7s|5in',
  'g|8ed|8ing|8s|5s|3ss|5ed|7ed|7ing|7s|6s|5ing|8ed|8ing|8s|2ind|5ed|7ed|7ing|7s|5ing|8ed|8ing|8s|5lied|8s|6y|5ness|9es|5s|',
  '4k|5ed|7ed|7ing|7s|5ing|8ed|8ing|8s|5s|3ss|5es|3tz|5es|3zzard|8ed|8ing|8s|2oc|4ed|4ing|4k|5ade|8d|8s|7ing|5buster|Bed|Bi',
  'ng|Bs|5ed|7ed|7ing|7s|5ing|8ed|8ing|8s|5s|4s|3nde|6d|6s|5ing|3od|5ed|7ed|7ing|7s|5ied|7s|6ng|5s|5y|4m|5ed|5ing|5s|3ssom|',
  '7ed|7ing|7s|3use|6d|6s|5ing|3w|4ed|4ing|7ed|7ing|7s|4n|5ed|5ing|5s|4s|2ue|4d|4grass|9es|4s|5es|3ff|5ed|5ing|5s|3ing|3nt|',
  '5ed|5ing|5s|3r|4ed|4ing|4red|7ed|7ing|7s|4s|4ted|3sh|5ed|6s|5ing|8ed|8ing|8s|1oar|4d|5ed|5ing|8ed|8ing|8s|5s|5walk|9ed|9',
  'ing|9s|4ed|4ing|4s|3sted|5s|3t|4ed|4ing|7ed|7ing|7s|4s|2b|3bed|6ed|6ing|6s|4ie|6d|6s|5ing|4y|3o|4ed|4ing|4s|3s|2d|3ied|6',
  'ed|6ing|6s|5s|4lied|7s|5y|3o|4ed|4ing|4s|3s|3y|4guard|9ed|9ing|9s|2er|4ed|4ing|4s|2g|3ota|6ed|6ing|6s|3s|2hemia|7ed|7ing',
  '|7n|8ed|8ing|8s|7s|2il|4ed|6ed|6ing|6s|5r|6ed|6ing|6s|4ing|7ed|7ing|7s|4s|3s|4es|2ld|4ed|4ing|4s|3ivar|7ed|7ing|7s|5ia|7',
  'ed|7ing|7n|8ed|8ing|8s|7s|3ogna|7ed|7ing|7s|3shevik|9ed|9ing|9s|3t|4ed|4ing|4s|2m|3b|4ardier|Aed|Aing|As|7ment|Bed|Bing|',
  'Bs|5y|6s|4ed|6ed|6ing|6s|5r|6ed|6ing|6s|4ing|4s|3s|2n|3d|4ed|6ed|6ing|6s|4ing|7ed|7ing|7s|4s|3e|4d|4s|3fire|7d|7s|6ing|3',
  'ied|5s|4ng|3net|6ed|6ing|6s|4ie|6d|6s|5ing|3s|3us|5es|3y|2o|3k|4ed|6ed|6ing|6s|5r|6ed|6ing|6s|4ing|7ed|7ing|7s|4let|7ed|',
  '7ing|7s|4s|5tore|9d|9s|8ing|3l|4ed|4ing|4s|3m|4ed|4ing|7ed|7ing|7s|4s|3n|4e|5d|5s|4ing|4s|3s|4t|5ed|6r|7ed|7ing|7s|5ing|',
  '5s|3t|4ed|4h|5ed|5ing|5s|4ing|4s|5es|2p|3s|2r|3deaux|8es|5r|6ed|8ed|8ing|8s|6ing|9ed|9ing|9s|6s|3e|4d|5om|7ed|7ing|7s|4s',
  '|3g|4ed|4ing|4s|3ing|6ed|6ing|6s|4s|5es|3n|4e|5d|5o|6ed|6ing|6s|5s|4ing|4s|3ough|7ed|7ing|7s|3row|6ed|6ing|9ed|9ing|9s|6',
  's|3s|2s|3ch|5ed|6s|5ing|3e|4d|4s|3ing|3nian|7ed|7ing|7s|3s|4es|3ton|6ed|6ing|6s|2t|3anic|7al|9ed|9ing|9s|7ed|7ing|7s|6ed',
  '|7s|6st|8ed|8ing|8s|5y|3h|4ed|5r|6ed|6ing|6s|4ing|4s|3s|3t|4ed|4ing|4le|6d|7ed|7ing|7s|6s|5ing|4om|6ed|6ing|6s|4s|2ught|',
  '6ed|6ing|6s|3lder|7ed|7ing|7s|4evard|9ed|9ing|9s|3nce|6d|6s|5ing|8ed|8ing|8s|4d|5aried|9s|7y|5ed|7ed|7ing|7s|5ing|5s|4ti',
  'ed|7s|5y|3quet|7ed|7ing|7s|3rbon|7ed|7ing|7s|4geois|9es|3t|4ed|4ing|4s|2w|3ed|5ed|5ing|5s|3ie|5d|5s|4ing|4ng|6ed|6ing|6s',
  '|3l|4ed|5r|6ed|6ing|6s|4ing|7ed|7ing|7s|4s|5es|3man|6ed|6ing|6s|3s|2xer|5ed|5ing|5s|3ing|6ed|6ing|6s|2y|3ce|5d|5s|4ing|4',
  'ott|7ed|7ing|7s|3d|4ed|4ing|4s|3er|5ed|5ing|5s|3s|1ra|3ce|5d|6ed|6ing|6s|5let|8ed|8ing|8s|5s|4ing|7ed|7ing|7s|4ket|7ed|7',
  'ing|7s|3d|4ed|4ford|8ed|8ing|8s|4ing|4ley|7s|4s|5haw|8ed|8ing|8s|3hms|3id|5ed|5ing|5s|4n|5ed|5ing|5s|6es|3ke|5d|5s|4ing|',
  '3m|4ed|4ing|4s|3n|4ch|6ed|8ed|8ing|8s|7s|6ing|9ed|9ing|9s|4d|5ed|7ed|7ing|7s|6nburg|Bed|Bing|Bs|5i|6ed|7s|6ing|6ng|6s|5o',
  'n|7ed|7ing|7s|5s|5y|4ed|4ing|4s|4t|5ed|5ing|5s|3s|4s|5es|3t|4ed|4ing|4s|3ve|5d|5ried|8s|6y|5s|4ing|4o|5ed|5ing|5s|3wl|5e',
  'd|5ing|5s|3y|4s|3zil|6ed|6ian|9ed|9ing|9s|7ng|6s|2each|6ed|7s|6ing|4d|5ed|5ing|5s|5th|7ed|7ing|7s|4k|5away|9s|5down|9ed|',
  '9ing|9s|5ed|6r|7ed|7ing|7s|5fast|9ed|9ing|9s|5ing|8ed|8ing|8s|5out|8ed|8ing|8s|5s|5through|Ced|Cing|Cs|5up|7ed|7ing|7s|4',
  'st|6ed|6ing|6s|4th|6e|7d|8ed|8ing|8s|7s|6ing|9ed|9ing|9s|6less|Aes|6s|3d|4ed|4ing|4s|3e|4d|5ed|6rs|5ing|8ed|8ing|8s|5s|4',
  'ed|4ing|4s|4ze|6d|6s|5ing|3nda|6ed|6ing|6n|7ed|7ing|7s|6s|5er|7ed|7ing|7s|4t|5ed|5ing|5s|3t|4ed|4hren|8ed|8ing|8s|4ing|4',
  'on|6ed|6ing|6s|4s|4t|5ed|5ing|5s|3w|4ed|5r|6ed|6ied|8s|7ng|6s|6y|4ing|7ed|7ing|7s|4s|5ter|8ed|8ing|8s|2ian|5ed|5ing|5s|3',
  'be|5d|5ried|8s|6y|5s|4ing|3ck|5ed|5ing|5s|3de|5d|5s|4ge|6d|6s|6t|7ed|7ing|7s|5ing|4ing|3ef|5ed|5ing|8ed|8ing|8s|5lied|8s',
  '|6y|5s|6es|3g|4ade|7d|7s|6ier|9ed|9ing|9s|7ng|4ed|4gs|6es|4ht|6ed|7ned|7r|8s|7st|6ing|6lied|9s|7y|6ness|Aes|6s|4ing|4s|3',
  'll|5ed|5iance|Ad|As|9ing|8t|9ed|9ing|9s|6ng|5s|3ng|5ed|5ing|5s|4k|5ed|5ing|5s|3sk|5ed|5ing|5s|4tol|7ed|7ing|7s|3t|4ain|7',
  'ed|7ing|7s|5nnia|9ed|9ing|9s|4ed|4ing|5sh|7ed|8s|7ing|4s|4tanied|9s|7y|5en|7ed|7ing|7s|5le|7d|7s|6ing|2oad|5cast|9ed|Ar|',
  'Bed|Bing|Bs|9ing|9s|5ed|6r|7s|5ing|5lied|8s|6y|5s|5way|8s|3ck|5ed|5ing|5s|3die|6d|6s|5ing|3ke|5d|5n|6ed|6ing|6s|5r|6ed|6',
  'ing|6s|5s|4ing|3ncos|4x|5es|4ze|6d|6s|5ing|3od|5ed|5ing|8ed|8ing|8s|5s|4k|5e|6d|6s|5ing|5s|4m|5ed|5ing|5s|3thel|7ed|7ing',
  '|7s|6r|7ed|7hood|Bed|Bing|Bs|7ing|7s|3ught|7ed|7ing|7s|3w|4ed|4ing|4n|5ed|5ing|8ed|8ing|8s|6sh|8ed|9s|8ing|5s|4s|5er|7ed',
  '|7ing|7s|6s|2uce|5d|5s|4ing|3ins|4se|6d|6s|5ing|3nette|8d|8s|7ing|4o|5ed|5ing|5s|4swick|9ed|9ing|9s|3sh|5ed|7ed|7ing|7s|',
  '6s|7es|5ing|8ed|8ing|8s|4sels|8es|3t|4al|6ed|6ing|7tied|As|8y|6lied|9s|7y|6s|4e|5d|5s|4ing|4s|2yan|5ed|5ing|5s|3ce|5d|5s',
  '|4ing|1ub|3ble|6d|6s|5ing|8ed|8ing|8s|3s|2ccaneers|3hanan|8ed|8ing|8s|3k|4ed|5t|6ed|6ing|6s|4ied|6s|5ng|4le|6d|7ed|7ing|',
  '7s|6s|5ing|4s|4y|2d|3dh|5a|6ed|6ing|6s|5ed|5ing|6sm|8ed|8ing|8s|7t|8ed|8ing|8s|5s|4ied|6s|4y|3ge|5d|5s|5t|6ed|6ing|6s|4i',
  'ng|3s|2ff|4alo|7ed|7ing|7s|4ed|5r|6ed|6ing|6s|5t|6ed|6ing|6s|4ied|6s|5ng|4s|4y|2g|3s|2ild|5ed|6r|7ed|7ing|7s|5ing|8ed|8i',
  'ng|8s|5s|4t|5ed|5ing|5s|2lb|4ed|4ing|4s|3garian|9ed|9ing|9s|4e|5d|5s|4ing|3k|4ed|4ied|6s|5ng|4s|4y|3l|4dog|7ed|7ing|7s|4',
  'ed|5t|6ed|6in|8ed|8g|8ing|8s|6s|4ied|6s|5ng|4ock|7ed|7ing|7s|4s|4y|5ing|8ed|8ing|8s|2m|3p|4ed|5r|6ed|6ing|6s|4ing|4s|3s|',
  '2n|3ch|5ed|6s|5ing|3d|4ed|4ing|4le|6d|6s|5ing|4s|3galow|8ed|8ing|8s|3k|4ed|5r|6ed|6ing|6s|4ing|4s|3nied|6s|4y|3s|2r|3d|4',
  'ed|5n|6ed|6ing|6s|4ing|4s|3eau|6cracied|Cs|Ay|6ed|6ing|6s|3g|4ed|5r|6s|5ss|7es|4ing|4s|4undied|9s|7y|3ial|6ed|6ing|6s|4e',
  'd|6ed|6ing|6s|5s|3ke|5d|5s|4ing|3lington|Aed|Aing|As|3mese|7d|7s|6ing|3n|4ed|6ed|6ing|6s|4ing|7ed|7ing|7s|4s|4t|5ed|5ing',
  '|5s|3r|4ed|4ing|4ows|4s|3s|4t|5ed|5ing|5s|3t|4ed|4ing|4on|6ed|6ing|6s|4s|3y|4ing|7ed|7ing|7s|2s|3es|3h|4ed|5s|4ing|3ied|',
  '5s|6t|4ness|8es|8man|Bed|Bing|Bs|3t|4ed|6ed|6ing|6s|5r|6ed|6ing|6s|4ing|4s|3y|2t|3ch|5ed|6r|7ed|7ing|7s|6s|5ing|3ler|6ed',
  '|6ing|6s|3s|3t|4e|5d|5r|6ed|6flied|As|8y|6ing|6s|5s|4ing|4on|6ed|6ing|6s|7es|4s|2y|3er|5ed|5ing|5s|3s|2zz|4es|4ing|7ed|7',
  'ing|7s|1y|2e|3s|2pass|6es|2ron|5ed|5ing|5s|2zantine|9d|9s|8ing|0cab|3aret|7ed|7ing|7s|3bage|7d|7s|6ing|3in|5ed|6t|7ed|7i',
  'ng|7s|5ing|5s|3le|5d|5s|4ing|3s|2che|5d|5s|4ing|3tus|6es|2d|3e|4d|4nce|7d|7s|6ing|4s|4t|5ed|5ing|5s|3ing|3s|2esar|6ed|6i',
  'ng|6s|2feteria|9ed|9ing|9s|2ge|4d|4s|3ing|2in|4ed|4ing|4s|3rns|4o|5ed|5ing|5s|2ke|4d|4s|3ing|2l|3ais|6es|3cium|7ed|7ing|',
  '7s|4ulate|9d|Aed|Aing|As|9s|8ing|Bed|Bing|Bs|9on|Bed|Bing|Bs|6us|8es|3eb|5ed|5ing|5s|4donia|9ed|9ing|9n|Aed|Aing|As|9s|4',
  'ndar|8ed|8ing|8s|3f|4ed|4ing|4s|3iber|7ed|7ing|7s|4fornia|Aed|Aing|As|4ph|6ate|9d|9s|8ing|6ed|6ing|6s|3l|4ed|5r|6ed|6ing',
  '|6s|4ing|7ed|7ing|7s|4s|3m|4ed|4ing|4lied|7s|5y|4s|3ories|3s|3ves|6es|4in|6ed|6ing|6s|2m|3b|4ed|4ing|4odian|9ed|9ing|9s|',
  '4rian|8ed|8ing|8s|4s|3e|4d|4l|5ed|5ing|5s|4o|5ed|5ing|5s|4r|5a|6ed|6ing|6s|5s|4s|3illa|7ed|7ing|7s|4ng|3ouflage|Ad|As|9i',
  'ng|3p|4aign|8ed|8ing|8s|4ed|4ground|Aed|Aing|As|4ing|4o|5ed|5ing|5s|4s|4us|6es|3s|2n|3ada|6ed|6ing|6s|5ian|8ed|8ing|8s|4',
  'l|5ed|5ing|5s|4ried|7s|5y|3berra|8ed|8ing|8s|3cel|6ed|6ing|6lation|Ced|Cing|Cs|7ed|7ing|6s|5r|6ed|6ing|6s|3d|4ace|7d|7s|',
  '6ing|4ed|4id|6acied|As|8y|7te|9d|9s|8ing|6ed|6ing|6s|5ed|6s|5ng|4le|6d|6s|5ing|4s|4y|3e|4d|4s|3ine|6d|6s|5g|5ing|3nabis|',
  '8es|4ed|6ed|6ing|6s|4ing|7ed|7ing|7s|4on|6ed|6ing|6s|5t|6ed|6ing|6s|3oe|5ed|5ing|5s|4n|5ed|5ical|9ed|9ing|9s|6ng|5s|4pie',
  'd|7s|5y|3s|3t|4ata|7ed|7ing|7s|4ed|5en|7ed|7ing|7s|5rburied|Bs|9y|4ing|4on|6ed|7se|9d|9s|8ing|6ing|6s|5r|6ed|6ing|6s|4s|',
  '3ucks|3vas|6es|3yon|6ed|6ing|6s|2p|3abilitied|Bs|9y|5le|7d|7s|6ing|4citied|9s|7y|3e|4d|4s|3ing|4tal|7ed|7ing|8sm|Aed|Ain',
  'g|As|9t|Aed|Aing|As|7s|5ol|7ed|7ing|7s|3ped|6ed|6ing|6s|3s|4ule|7d|7s|6ing|3tain|7ed|7ing|7s|4ion|7ed|7ing|7s|5ve|7d|7s|',
  '6ing|7tied|As|8y|4ure|7d|7s|6ing|2r|3a|4ed|4ing|4s|4van|7ed|7ing|7s|3bon|6ate|9d|9s|8ing|6ed|6ing|6s|3d|4board|9ed|9ing|',
  '9s|4ed|4iac|7ed|7ing|7s|5nal|8ed|8ing|8s|6g|5ovascular|Eed|Eing|Es|4s|3e|4d|4er|6ed|6ing|6s|4ful|7ed|7ing|7lied|As|8y|7s',
  '|4less|8es|4s|5s|6es|6ing|9ed|9ing|9s|4taker|9ed|9ing|9s|3go|5ed|5ing|5s|3ib|5bean|9ed|9ing|9s|5ed|5ing|5s|4ed|5s|4ng|4s',
  'a|6ed|6ing|6s|3l|4ed|4ied|6s|5ng|5sle|8d|8s|7ing|4o|5ed|5ing|5s|6es|4s|4y|3mel|6ed|6ing|6s|5n|6ed|6ing|6s|4ine|7d|7s|6in',
  'g|3nage|7d|7s|6ing|4egie|8d|8s|7ing|4ival|8ed|8ing|8s|3ol|5e|6d|6s|5ina|8ed|8ing|8s|7e|8d|8s|7g|7ing|5s|5yn|7ed|7ing|7s|',
  '3p|4athian|Aed|Aing|As|4ed|5nter|9ed|9ing|9s|5t|6ed|6ing|6s|4ing|4s|3r|4ed|4iage|8d|8s|7ing|5e|6d|7ed|7ing|7s|6r|7ed|7in',
  'g|7s|6s|5ing|5ng|4ot|6ed|6ing|6s|4s|4y|5ing|8ed|8ing|8s|3s|4es|4ten|7ed|7ing|7s|3t|4ed|5l|6ed|6ing|6s|5r|6ed|6ing|6s|4in',
  'g|4oon|7ed|7ing|8st|Aed|Aing|As|7s|4ridge|9d|9s|8ing|4s|4wright|Aed|Aing|As|3ved|5r|6ed|6ing|6s|4ing|7ed|7ing|7s|3y|2sca',
  'de|7d|7s|6ing|3e|4d|4s|4y|5s|3h|4ed|5s|4ing|3imir|7ed|7ing|7s|4ng|5o|6ed|6ing|6s|3ket|6ed|6ing|6s|3per|6ed|6ing|6s|4ian|',
  '7ed|7ing|7s|3s|4andra|9ed|9ing|9s|4es|4ie|6d|6s|5ing|3t|4e|5d|5s|4ing|7ed|7ing|7s|4le|6d|6s|5ing|4s|3ual|6ed|6ing|6lied|',
  '9s|7y|6s|6tied|9s|7y|2t|3alan|7ed|7ing|7s|5ina|8ed|8ing|8s|5ogue|9d|9s|8ing|5yst|8ed|8ing|8s|6tic|9ed|9ing|9s|4strophe|B',
  'd|Bs|Aic|Ced|Cing|Cs|Bng|3ch|5ed|6r|7ed|7ing|7s|6s|5ing|8ed|8ing|8s|5ment|9ed|9ing|9s|3egoried|9s|8zed|7y|4r|5ed|5ing|5s',
  '|3fish|7ed|8s|7ing|3hedral|9ed|9ing|9s|5rine|9d|9s|8ing|4ied|6s|4olic|8ed|8ing|9sm|Bed|Bing|Bs|8s|4rin|7ed|7ing|7s|5yn|7',
  'ed|7ing|7s|4y|3s|3tle|6d|6s|5ing|2ucasian|9ed|9ing|9s|4us|6es|3ght|6ed|6ing|6s|3sal|6ed|6ing|6s|4e|5d|5s|5way|8s|4ing|7e',
  'd|7ing|7s|3tion|7ed|7ing|7s|6us|8es|8lied|Bs|9y|2val|5ed|5ier|8ed|8ing|8s|6ng|5ried|8s|6y|5s|3e|4d|4ndish|9ed|As|9ing|4r',
  'n|6ed|6ing|6s|4s|3ing|4tied|7s|5y|2yman|6ed|6ing|6s|1ease|5d|5s|4ing|2cil|5ed|5ia|7ed|7ing|7s|6ng|5s|2dar|5ed|5ing|5s|3e',
  'd|3ric|6ed|6ing|6s|2iling|7ed|7ing|7s|2l|3ebrate|9d|Aed|Aing|As|9s|8ing|9on|Bed|Bing|Bs|6itied|As|8y|4ste|7d|7s|6ial|9ed',
  '|9ing|9s|7ng|3ia|5ed|5ing|5s|3l|4ar|6ed|6ing|6s|4ed|4ing|4o|5ed|5ing|5s|4s|4ular|8ed|8ing|8s|3s|3t|4ed|4ic|6ed|6ing|6s|5',
  'ng|4s|2ment|6ed|6ing|6s|4teried|9s|7y|2nsorship|Aed|Aing|As|4us|6es|3t|4ed|5naried|As|8y|6nial|Aed|Aing|As|5r|6ed|8ed|8i',
  'ng|8s|6ing|6s|4imeters|8re|As|5ng|4ral|7ed|7ing|8zed|7lied|As|8y|7s|5e|6s|4s|4uried|8s|6y|2rambycidae|Cd|Cs|Bing|5ic|7ed',
  '|7ing|7s|8es|3e|4al|6ed|6ing|6s|4bral|8ed|8ing|8s|4d|4monial|Aed|Aing|As|8ed|9s|7y|4s|3ing|3tain|7ed|7ing|7lied|As|8y|7s',
  '|7tied|As|8y|4ificate|Bd|Bs|Aing|Bon|Ded|Ding|Ds|7ed|9ed|9ing|9s|3vical|8ed|8ing|8s|2sare|6d|6s|5ing|2ylon|6ed|6ing|6s|1',
  'ha|3d|4ed|4ing|4s|3i|4ed|4ing|4n|5ed|7ed|7ing|7s|5ing|5s|4r|5ed|5ing|5man|8ed|8ing|8s|5s|4s|3lk|5ed|5ing|5s|4lenge|9d|9r',
  '|Aed|Aing|As|9s|8ing|4mers|3mber|7ed|7ing|7lain|Bed|Bing|Bs|7s|4p|5agne|9d|9s|8ing|6ign|9ed|9ing|9s|5ed|5ing|6on|8ed|8in',
  'g|8s|9hip|Ced|Cing|Cs|5s|3nce|6d|6l|7ed|7ing|7lor|Aed|Aing|As|7s|6s|5ing|4dler|8ed|8ing|8s|4g|5e|6d|6s|5ing|5s|4nel|7ed|',
  '7ing|7s|4t|5ed|5ing|8ed|8ing|8s|5s|3o|4ed|4ing|4s|5es|4tic|7ed|7ing|7s|3p|4ed|5l|6ed|6ing|6s|4ing|4lain|8ed|8ing|8s|4man',
  '|7ed|7ing|7s|4s|4ter|7ed|7ing|7s|3r|4acter|9ed|9ing|Astic|Eed|Eing|Es|Azation|Fned|Fning|Fns|Bed|9s|4coal|8ed|8ing|8s|4e',
  'd|4ge|6d|6rs|6s|5ing|8ed|8ing|8s|4ing|5ot|7ed|7ing|7s|5smatic|Bed|Bing|Bs|5table|Ad|As|9ing|6ied|8s|6y|4leen|8ed|8ing|8s',
  '|6ne|8d|8s|7ing|6s|7es|7ton|Aed|Aing|As|6y|7s|5ie|7d|7s|6ing|5otte|9d|9s|8ing|4m|5ed|5ing|8ed|8ing|8s|5s|4red|4s|4t|5ed|',
  '6r|7ed|9ed|9ing|9s|7ing|7s|5ing|8ed|8ing|8s|5s|3s|4e|5d|5s|4ing|7ed|7ing|7s|4sis|7es|3t|4eau|7ed|7ing|7s|5d|4ing|4s|4tan',
  'ooga|Bed|Bing|Bs|5er|7ed|7ing|7s|5ing|8ed|8ing|8s|2e|3ap|5ed|6r|7s|5ing|5s|4t|5ed|5ing|8ed|8ing|8s|5s|3ck|5ed|7ed|7ing|7',
  's|5ing|5s|3d|3ek|5bones|5ed|5ing|5s|4r|5ed|7ed|7ing|7s|5ful|8ed|8ing|8lied|Bs|9y|8s|5ing|8ed|8ing|8s|5s|4se|6d|6s|5ing|3',
  'f|4ed|4ing|4s|3ltenham|Aed|Aing|As|3mical|8ed|8ing|8s|5st|7ed|7ing|7ried|As|8y|7s|4otherapied|Ds|By|3n|4ed|5y|6s|4g|5ed|',
  '5ing|5s|4ing|4nai|4s|3r|4okee|8ed|8ing|8s|4ried|7s|5y|4s|3s|4apeake|Ad|As|9ing|4hire|8d|8s|7ing|4s|5es|4t|5ed|6r|7ed|7fi',
  'eld|Ced|Cing|Cs|7ing|7s|5ing|5nut|8ed|8ing|8s|5s|3t|4ed|4ing|4s|3valier|9ed|9ing|9s|4ied|6s|4y|3w|4ed|4ing|4s|3yenne|8d|',
  '8s|7ing|2i|3ck|5ed|6n|7ed|7ing|7s|5ing|5s|4o|5ed|5ing|5s|3ef|5ed|5ing|5lied|8s|6y|5s|5tain|9ed|9ing|9s|3huahua|9ed|9ing|',
  '9s|3ld|5birth|Aed|Aing|As|5ed|5hood|9ed|9ing|9s|5ing|6sh|8ed|9s|8ing|5less|9es|5ren|8ed|8ing|8s|5s|4e|5an|7ed|7ing|7s|5d',
  '|5s|4i|5ed|5ing|5ng|5s|4l|5ed|7ed|7ing|7s|5ied|7s|6ng|8ed|8ing|8s|5s|5y|3med|4ney|7s|3n|4a|5ed|5ing|5s|5town|9ed|9ing|9s',
  '|4ed|5se|7d|7s|6ing|4g|5ed|5ing|5s|4ing|4s|3p|4ed|4ing|4s|5es|3s|2loe|5ed|5ing|5s|4r|5ed|5ide|8d|8s|7ing|6ng|5s|2o|3cola',
  'te|9d|9s|8ing|3ice|6d|6s|5ing|4r|5ed|5ing|5s|3ke|5d|5s|4ing|7ed|7ing|7s|3lera|7ed|7ing|7s|5sterol|Bed|Bing|Bs|3ose|6d|6s',
  '|5ing|8ed|8ing|8s|3p|4ed|4in|6ed|6g|6ing|6s|4ped|7ed|7ing|7s|6r|7ed|7ing|7s|4s|3ral|6ed|6ing|6s|4d|5ed|5ing|5s|4eographe',
  'd|Cr|Ded|Ding|Ds|Bied|Ds|By|5s|4us|6es|3s|4e|5d|5n|6ed|6ing|6s|5s|4ing|3w|4ed|4ing|4s|2ris|5es|5t|6ed|6ian|9ed|9ing|Atie',
  'd|Ds|By|9s|7e|8d|8s|7ing|7na|9ed|9ing|9s|8e|9d|9s|8g|8ing|6mas|9es|6ofer|Aed|Aing|As|7phe|Ad|Ar|Bed|Bing|Bs|As|9ing|6s|3',
  'ome|6d|6s|5ing|5osome|Ad|As|9ing|4nic|7ed|7ing|7le|9d|9s|8ing|7s|5ological|Ded|Ding|Ds|Aed|Bs|9y|2uck|5ed|5ing|5le|7d|7s',
  '|6ing|5s|3n|4ed|4ing|4k|5ed|5ing|5s|4s|3rch|6ed|7s|6ing|6yard|Aed|Aing|As|4ning|8ed|8ing|8s|1id|3s|2g|3ar|5ed|6tte|9d|9s',
  '|8ing|5ing|5s|3s|2ncinnati|Aed|Aing|As|3der|6ed|7lla|Aed|Aing|As|6ing|6s|4ie|6d|6s|5ing|4y|3ema|6ed|6ing|6s|6tic|9ed|9in',
  'g|9s|7ographer|Fed|Fing|Fs|Died|Fs|Dy|3namon|8ed|8ing|8s|2pher|6ed|6ing|6s|2rca|5ed|5ing|5s|4le|6d|7ed|7ing|7s|6s|5ing|8',
  'ed|8ing|8s|4uit|7ed|7ing|7s|5lar|8ed|8ing|8s|7ted|8ing|9on|Bed|Bing|Bs|5mstance|Cd|Cs|Bing|5s|6es|2sco|5ed|5ing|5s|2t|3a',
  'del|7ed|7ing|7s|4tion|8ed|8ing|8s|3e|4d|4s|3ied|5s|4ng|4zen|7ed|7ing|7s|8hip|Bed|Bing|Bs|3rus|6es|3s|3y|2vic|5ed|5ing|5s',
  '|4l|5ed|5ian|8ed|8ing|8s|6ng|6zation|Ced|Cing|Cs|7ed|9ed|9ing|9s|5s|1lad|4ed|4ing|4s|3im|5ed|5ing|5s|4re|6d|6s|5ing|3mpe',
  'd|3n|4destine|Bd|Bs|Aing|4ed|4ing|4s|3p|4ed|4ing|4ped|7ed|7ing|7s|5ing|8ed|8ing|8s|4s|3ra|5ed|5ing|5s|4e|5d|5nce|8d|8s|7',
  'ing|5s|4ied|6s|5fied|8s|6y|5net|8ed|8ing|8s|6g|5ssa|8ed|8ing|8s|5tied|8s|6y|4k|5ed|5ing|5s|4y|3sh|5ed|6s|5ing|4p|5ed|5in',
  'g|5s|4s|5ed|7ed|7ing|7s|6s|7es|5ic|7al|9ed|9ing|9s|7ed|7ing|7s|6fication|Eed|Eing|Es|8ed|Aed|Aing|As|5mate|9d|9s|8ing|5r',
  'oom|9ed|9ing|9s|3ude|6d|6s|5ia|7ed|7ing|7s|6ng|6o|7ed|7ing|7s|6us|8es|4se|6d|6s|5ing|3w|4ed|6ed|6ing|6s|4ing|4s|3y|4s|4t',
  'on|7ed|7ing|7s|2ean|5ed|6r|7ed|7ing|7s|5ing|8ed|8ing|8s|5s|6es|6ing|9ed|9ing|9s|5up|7ed|7ing|7s|4r|5ance|9d|9s|8ing|5ed|',
  '6r|7ed|7ing|7s|5ing|8ed|8ing|8s|5lied|8s|6y|5s|4vage|8d|8s|7ing|3m|4ed|5nt|7ed|7ing|7s|4ing|4s|3nch|6ed|7s|6ing|3opatra|',
  '9ed|9ing|9s|3rgied|7s|5y|6man|9ed|9ing|9s|4ic|6al|8ed|8ing|8s|6ed|6ing|6s|4k|5ed|5ing|5s|3ver|6ed|6ing|6s|2ick|5ed|5ing|',
  '5s|3ent|6ed|6ing|6s|3ff|5ed|5ing|5ord|8ed|8ing|8s|5s|3mate|7d|7s|6ic|8ed|8ing|8s|7ng|5x|6es|4b|5ed|5ing|8ed|8ing|8s|5s|3',
  'nch|6ed|7s|6ing|4ging|8ed|8ing|8s|4ic|6al|8ed|8ing|8s|6ed|6ing|6s|4t|5ed|5ing|5on|7ed|7ing|7s|5s|3p|4ed|4ing|4ped|7ed|7i',
  'ng|7s|4s|5es|3t|4ed|4ing|4s|3ve|5d|5s|4ing|2oak|5ed|5ing|5s|3ck|5ed|5ing|5s|5wise|9d|9s|8ing|3ne|5d|5s|4ing|3se|5d|6ed|6',
  'ing|6s|5lied|8s|6y|5ness|9es|5r|6ed|6ing|6s|5s|6t|5t|6ed|6ing|6s|4ing|4ure|7d|7s|6ing|3t|4ed|4h|5ed|6s|7es|5ing|8ed|8ing',
  '|8s|5s|4ing|4s|3ud|5ed|7ed|7ing|7s|5ied|7s|6ng|5s|5y|3ver|6ed|6ing|6s|3wn|5ed|5ing|5s|2ub|4ed|4house|9d|9s|8ing|4ing|4s|',
  '3e|4d|4s|3ing|3msied|7s|5y|3ng|5ed|5ing|5s|3ster|7ed|9ed|9ing|9s|7ing|7s|3tch|6ed|7s|6ing|2yde|5d|5s|4ing|1oach|5ed|6s|5',
  'ing|8ed|8ing|8s|3l|4ed|4ing|5tion|9ed|9ing|9s|4s|3rse|6d|6s|5ing|3st|5al|7ed|7ing|7s|5ed|6r|7ed|7ing|7s|5ing|5s|3t|4ed|6',
  'ed|6ing|6s|4ing|7ed|7ing|7s|4s|2b|3alt|6ed|6ing|6s|3ra|5ed|5ing|5s|3s|2ca|4ed|4ine|7d|7s|6g|6ing|4s|3hin|6ed|6ing|6s|3k|',
  '4ed|6ed|6ing|6s|4ied|6s|5ng|4pit|7ed|7ing|7s|4s|4tail|8ed|8ing|8s|4y|3o|4a|5ed|5ing|5s|4ed|4ing|4nut|7ed|7ing|7s|4s|2d|3',
  'e|4d|4s|4x|5es|3ing|3s|2e|3fficient|Bed|Bing|Bs|3s|2ff|4ed|5e|6ed|6ing|6s|4in|6ed|6g|6ing|6s|4s|2gnition|9ed|9ing|9s|7ve',
  '|9d|9s|8ing|2hen|5ed|5ing|5s|4rent|8ed|8ing|8s|3ort|6ed|6ing|6s|2il|4ed|6ed|6ing|6s|4ing|4s|3n|4age|7d|7s|6ing|4cide|8d|',
  '8nce|Bd|Bs|Aing|9tallied|Fs|Dy|8s|7ing|4ed|4ing|4s|2ke|4d|4s|3ing|2l|3a|4ed|4ing|4s|3d|4ed|5r|6ed|6ing|6s|4ing|4lied|7s|',
  '5y|4s|3e|4d|4en|6ed|6ing|6s|4s|3i|4ed|4ing|4n|5ed|5g|5ing|5s|4s|5eum|8ed|8ing|8s|3l|4aborate|Bd|Bs|Aing|Bon|Ded|Ding|Ds|',
  'Bve|Dd|Ds|Cing|Aor|Ced|Cing|Cs|5pse|8d|8s|7ing|5r|6bone|Ad|As|9ing|6ed|6ing|6s|5teral|Aed|Aing|As|4eague|9d|9s|8ing|5ct|',
  '7ed|9ed|9ing|9s|7ing|8on|Aed|Aing|As|8ve|Ad|Alied|Ds|By|As|9ing|7or|9ed|9ing|9s|7s|5d|5en|7ed|7ing|7s|5ge|7d|7s|6iate|Ad',
  '|As|9ing|7ng|4ided|5er|7ed|7ied|9s|8ng|7s|7y|5n|6ed|6g|6ing|6s|7es|5sion|9ed|9ing|9s|4oquiallied|Ds|By|4s|3ogne|7d|7s|6i',
  'ng|4mbian|9ed|9ing|9s|4n|5ed|6l|7ed|7ing|7s|5ial|8ed|8ing|8s|6ed|7s|6ng|6sts|6zation|Ced|Cing|Cs|5s|5y|4r|5ado|8ed|8ing|',
  '8s|6tion|Aed|Aing|As|5ed|7ed|7ing|7s|5ful|8ed|8ing|8s|5ing|8ed|8ing|8s|5s|6es|4ssal|8ed|8ing|8s|4ur|6ed|6s|3s|3t|4ed|4in',
  'g|4s|3umbia|8ed|8ing|8n|9ed|9ing|9s|8s|5n|6ed|6ing|7st|9ed|9ing|9s|6s|2ma|4ed|4ing|4s|3b|4at|6ants|6ed|6ing|6s|4ed|4inat',
  'ion|Bed|Bing|Bs|6e|7d|8ed|8ing|8s|7s|6g|6ing|9ed|9ing|9s|4s|4ustion|Aed|Aing|As|3e|4back|8ed|8ing|8s|4d|5ian|8ed|8ing|8s',
  '|6c|7ed|7ing|7s|6ed|7s|5y|4s|5es|4t|5ed|5ing|5s|3fort|7able|Bd|Bs|Aied|Cs|Bng|Ay|7ed|7ing|Aed|Aing|As|7s|3ic|5al|7ed|7in',
  'g|7s|5ed|5ing|5s|4ng|6ed|6ing|6s|3mand|7ant|Aed|Aing|As|7ed|8r|9ed|9ing|9s|7ing|Aed|Aing|As|7o|8ed|8ing|8s|7s|4emorate|B',
  'd|Bs|Aing|Bon|Ded|Ding|Ds|Bve|Dd|Ds|Cing|5nce|8d|8ment|Ced|Cing|Cs|8s|7ing|6dation|Ced|Cing|Cs|7ed|6t|7aried|Bs|9y|8tor|',
  'Bed|Bing|Bs|7ed|7ing|7s|5rce|8d|8s|7ial|Aed|Aing|Alied|Ds|By|As|8ng|4ission|Aed|Br|Ced|Cing|Cs|Aing|As|5t|6ed|6ing|6ment',
  '|Aed|Aing|As|6s|6tee|9ed|9ing|9s|4oditied|As|8y|6ore|9d|9s|8ing|5n|6ed|6ing|6lied|9s|7y|6place|Bd|Bs|Aing|6s|7es|6wealth',
  '|Ced|Cing|Cs|5tion|9ed|9ing|9s|4unal|8ed|8ing|8s|6e|7d|7s|6icate|Bd|Bs|Aing|Ded|Ding|Ds|Bon|Ded|Ding|Ds|7ng|7on|9ed|9ing',
  '|9s|7sm|9ed|9ing|9s|8t|9ed|9ing|9s|7tied|As|8y|5ted|7r|8ed|8ing|8s|3pact|7ed|7ing|7s|5nied|8s|7on|9ed|9ing|9s|6y|5rable|',
  'Ad|As|9ing|7tive|Bd|Blied|Es|Cy|Bs|Aing|6e|7d|7s|6ing|7son|Aed|Aing|As|6tment|Bed|Bing|Bs|5ss|7es|7ion|Aate|Dd|Ds|Cing|A',
  'ed|Aing|As|5tibilitied|Es|Cy|8le|Ad|As|9ing|4elling|Aed|Aing|As|5nsate|Ad|As|9ing|Aon|Ced|Cing|Cs|5te|7d|7nce|Ad|As|9ing',
  '|8t|9ed|9ing|9s|7s|6ing|7tion|Bed|Bing|Bs|9ve|Bd|Bs|Aing|8or|Aed|Aing|As|4ilation|Bed|Bing|Bs|6e|7d|7r|8ed|8ing|8s|7s|6i',
  'ng|4lain|8ed|8ing|8s|8t|9ed|9ing|9s|5ement|Aaried|Es|Cy|Aed|Aing|As|6te|8d|8lied|Bs|9y|8s|7ing|8on|Aed|Aing|As|6x|7es|7i',
  'on|Aed|Aing|As|8tied|Bs|9y|5iance|Ad|As|9ing|8t|9ed|9ing|9s|6cated|Bed|Bing|Bs|9ions|6ed|7s|6ment|Aed|Aing|As|5y|4onent|',
  '9ed|9ing|9s|5s|6e|7d|8ed|8ing|8s|7r|8ed|8ing|8s|7s|6ing|7te|9d|9s|8ing|9on|Bed|Bing|Bs|6ure|9d|9s|8ing|5und|8ed|8ing|8s|',
  '4rehend|Aed|Aing|As|9sion|Ded|Ding|Ds|Bve|Dd|Ds|Cing|6ssed|Aed|Aing|As|8ion|Bed|Bing|Bs|8or|Aed|Aing|As|5ise|8d|9ed|9ing',
  '|9s|8s|7ing|5omise|Ad|As|9ing|4ulsion|Aed|Aing|As|7oried|Bs|9y|5tation|Bal|Ded|Ding|Ds|Bed|Bing|Bs|6e|7d|7r|8ed|8ing|8s|',
  '7s|6ing|3rade|7d|7s|6ing|2n|3ceal|7ed|9ed|9ing|9s|7ing|7s|5ded|8ed|8ing|8s|5ived|5nt|7ed|7ing|7rate|Bd|Ced|Cing|Cs|Bs|Ai',
  'ng|Bon|Ded|Ding|Ds|7s|5pt|7ed|7ing|8on|Aed|Aing|As|7s|7ual|Aed|Aing|As|5rn|7ed|9ed|9ing|9s|7ing|Aed|Aing|As|7s|6t|7ed|7i',
  'ng|7o|8ed|8ing|8s|7s|5ssion|Aed|Aing|As|4lude|8d|8s|7ing|Aed|Aing|As|6sion|Aed|Aing|As|4ord|7ed|7ing|7s|5urse|9d|9s|8ing',
  '|4rete|8d|8s|7ing|4urrencied|Cs|Ay|9t|Aed|Aing|Alied|Ds|By|As|5ssion|Aed|Aing|As|3d|4ed|5mn|7ation|Ced|Cing|Cs|7ed|9ed|9',
  'ing|9s|7ing|Aed|Aing|As|7s|5nsed|9ed|9ing|9s|4ing|5tion|9al|Bed|Bing|Bs|9ed|Bed|Bing|Bs|9ing|9s|4or|6ed|6ing|6s|4s|4uct|',
  '7ed|7ing|7or|9ed|9ing|9s|7s|3e|4d|4s|5es|3feder|8acied|Cs|Ay|9te|Bd|Bs|Aing|Bon|Ded|Ding|Ds|8s|5rence|Ad|As|9ing|5ss|7es',
  '|7ion|Aed|Aing|As|4idence|Ad|As|9ing|8t|9ed|9ial|Ced|Cing|Cs|Ang|9lied|Cs|Ay|9s|5guration|Ded|Ding|Ds|8e|9d|9s|8ing|5ned',
  '|8ed|8ing|8s|7ment|Bed|Bing|Bs|7s|5rm|7ation|Ced|Cing|Cs|7ed|9ed|9ing|9s|7ing|Aed|Aing|As|7s|5scated|4lict|8ed|8ing|Bed|',
  'Bing|Bs|8s|5uence|Ad|As|9ing|4orm|7ed|8r|9ed|9ing|9s|7ing|7s|4ront|8ation|Ded|Ding|Ds|8ed|8ing|8s|4use|7d|8ed|8ing|8s|7s',
  '|6ing|7on|9ed|9ing|9s|3genital|Aed|Aing|As|5stion|Aed|Aing|As|4lomerate|Cd|Cs|Bing|4o|5ed|5ing|5s|4ratulations|5egation|',
  'Cal|Eed|Eing|Es|Ced|Cing|Cs|6ss|8es|8ional|Ded|Ding|Ds|8man|Bed|Bing|Bs|3ical|7ed|7ing|7s|4ng|3jecture|Ad|As|9ing|4uncti',
  'on|Bed|Bing|Bs|3n|4ect|7ed|9ed|9ing|9s|7ing|8on|Aed|Aing|As|8vitied|Ds|By|7or|9ed|9ing|9s|7s|5d|5r|6ed|6ing|6s|4ie|6d|6s',
  '|5ing|5ng|4s|3or|5ed|5ing|5s|3quer|7ed|7ing|7or|9ed|9ing|9s|7s|6st|8ed|8ing|8s|3rad|6ed|6ing|6s|3s|4cience|Ad|As|9ing|6o',
  'us|9es|9lied|Cs|Ay|9ness|Des|5ription|Ced|Cing|Cs|4ecrated|Bed|Bing|Bs|9ion|Ced|Cing|Cs|6utive|Bd|Bs|Aing|5nsus|9es|6t|7',
  'ed|7ing|7s|5quence|Bd|Bs|Aing|9tlied|Ds|By|5rvation|Ced|Cing|Cs|Ave|Cd|Cs|Bing|9oire|Dd|Ds|Cing|Aried|Ds|By|7e|8d|8s|7in',
  'g|4ider|8able|Cd|Cs|Bied|Ds|Cng|By|9tion|Ded|Ding|Ds|8ed|Aed|Aing|As|8ing|Bed|Bing|Bs|8s|5st|7ed|8ncied|Cs|Ay|9t|Aed|Ain',
  'g|Alied|Ds|By|As|7ing|7s|4olation|Bed|Bing|Bs|6e|7d|7s|6idate|Bd|Ced|Cing|Cs|Bs|Aing|Bon|Ded|Ding|Ds|7ng|5nant|9ed|9ing|',
  '9s|5rt|7ed|7ing|8um|Aed|Aing|As|7s|4picuous|Bes|6racied|Bs|9y|4table|9d|9s|8ing|7ularied|Ds|By|6nce|9d|9s|8ing|7t|8ed|8i',
  'ne|Bd|Bs|Ag|Aing|8lied|Bs|9y|8s|5ellation|Ded|Ding|Ds|5ituencied|Ds|By|At|Bed|Bing|Bs|8te|Ad|As|9ing|Aon|Cal|Eed|Eing|Es',
  '|Ced|Cing|Cs|5rained|Bed|Bing|Bs|9t|Aed|Aing|As|6uct|9ed|9ing|Aon|Ced|Cing|Cs|Ave|Cd|Cs|Bing|9s|4ul|6ar|8ed|8ing|8s|7te|',
  '9d|9s|8ing|6ed|6ing|6s|6t|7ant|Aed|Aing|As|8tion|Ced|Cing|Cs|Ave|Cd|Cs|Bing|7ed|7ing|Aed|Aing|As|7s|5me|7d|7r|8ed|8ing|8',
  's|7s|6ing|9ed|9ing|9s|6ption|Bed|Bing|Bs|3tact|7ed|7ing|7s|5in|7ed|8r|9ed|9ing|9s|7ing|7ment|Bed|Bing|Bs|7s|5minated|Aio',
  'n|Ded|Ding|Ds|4emplated|Aing|7oraried|Ds|By|7t|8ed|8ing|8s|5nder|9ed|9ing|9s|6t|7ed|7ing|8on|Aed|Aing|As|9us|Bes|7s|8es|',
  '5st|7ant|Aed|Aing|As|7ed|7ing|7s|5xt|7ed|7ing|7s|4iguous|Aes|5nent|9al|Bed|Bing|Bs|9ed|9ing|9s|6g|7ent|Aed|Aing|As|6ual|',
  '9ed|9ing|9lied|Cs|Ay|9s|8tion|Ced|Cing|Cs|7e|8d|9ed|9ing|9s|8s|7ing|8tied|Bs|9y|7ous|Aes|Alied|Ds|By|7um|9ed|9ing|9s|4ra',
  '|6ct|8ed|Aed|Aing|As|8ing|9on|Bed|Bing|Bs|8or|Aed|Aing|As|8s|8ual|Bed|Bing|Bs|6dict|Aed|Aing|Bon|Ded|Ding|Ds|Aoried|Es|C',
  'y|As|6ed|6ing|6ried|9s|7y|6s|7t|8ed|8ing|8s|5ibute|Ad|As|9ing|Aon|Ced|Cing|Cs|9or|Bed|Bing|Bs|5ol|7ed|7ing|7ler|Aed|Aing',
  '|As|7s|6versial|Ded|Ding|Ds|Bed|Cs|Ay|3vection|Aed|Aing|As|5ned|6ience|Bd|Bs|Aing|9t|Aed|Aing|As|6t|7ed|7ing|8on|Aal|Ced',
  '|Cing|Cs|Aed|Aing|As|7s|5rge|8d|8nce|Bd|Bs|Aing|8s|7ing|6sation|Ced|Cing|Cs|7e|8d|8lied|Bs|9y|8s|7ing|8on|Aed|Aing|As|6t',
  '|7ed|9ed|9ing|9s|7ible|Bd|Bs|Aing|8ng|Aed|Aing|As|7s|5x|6es|5y|6s|4ict|7ed|7ing|8on|Aed|Aing|As|7s|5nce|8d|9ed|9ing|9s|8',
  's|7ing|Aed|Aing|As|4oy|6s|2ok|4ed|4ies|5ng|7ed|7ing|7s|4s|3l|4ed|5r|6ed|6ing|6s|4ing|7ed|7ing|7s|4s|3p|4ed|5r|6ate|9d|9s',
  '|8ing|6ed|6ing|6s|4ing|4s|2p|3a|4ed|4ing|4s|3e|4d|4s|3ied|6ed|6ing|6s|5s|4ng|6ed|6ing|6s|3per|6ed|6ing|6s|3s|4es|3tic|6e',
  'd|6ing|6s|3y|4right|9ed|9ing|9s|2r|3a|4ed|4ing|4l|5ed|5ing|5s|4s|3d|4ed|4ing|4oba|7ed|7ing|7s|4s|3e|4d|4s|4y|5s|3ied|5s|',
  '4ng|5ne|7d|7s|6ing|3k|4ed|4ing|4s|3n|4ed|5lius|9es|5r|6ed|8ed|8ing|8s|6ing|6s|7tone|Bd|Bs|Aing|4ice|7d|7s|6ing|5ng|5sh|7',
  'ed|8s|7ing|4s|3ona|6ed|6ing|6s|6tion|Aed|Aing|As|5er|7ed|7ing|7s|3p|4ed|4ing|4oral|8ed|8ing|8s|7te|9d|9s|8ing|9on|Bed|Bi',
  'ng|Bs|4s|5e|6d|6s|5ing|4us|6es|3rect|7ed|9ed|9ing|9s|7ing|8on|Aal|Ced|Cing|Cs|Aed|Aing|As|7lied|As|8y|7s|5lated|Aed|Aing',
  '|As|8ion|Bed|Bing|Bs|5spond|Aed|Bnce|Ed|Es|Ding|Ct|Ded|Ding|Ds|Aing|Ded|Ding|Ds|As|4idor|8ed|8ing|8s|4osion|9ed|9ing|9s|',
  '4ugated|Aed|Aing|As|5pt|7ed|9ed|9ing|9s|7ing|8on|Aed|Aing|As|7s|3s|3tes|6es|5x|6es|3vette|8d|8s|7ing|3y|2s|3es|3metic|8e',
  'd|8ing|8s|4ic|6ed|6ing|6s|4opolitan|Ced|Cing|Cs|5s|6es|3t|4a|5ed|5ing|5s|4ed|4ing|7ed|7ing|7s|4lied|7s|5y|4s|4ume|7d|7s|',
  '6ing|2t|3e|4d|4s|3ing|3s|3tage|7d|7s|6ing|4on|6ed|6ing|6s|2uch|5ed|6s|5ing|3gars|4h|5ed|5ing|5s|3ld|5ed|5ing|5s|3ncil|7e',
  'd|7ing|7s|4sel|7ed|7ing|7or|9ed|9ing|9s|7s|4t|5ed|6r|7attack|Ded|Ding|Ds|7ed|7ing|7part|Bed|Bing|Bs|7s|6ss|8es|5ied|7s|6',
  'ng|8ed|8ing|8s|5less|9es|5ried|8s|6y|7side|Bd|Bs|Aing|5s|5y|3p|4e|5d|5s|4ing|4le|6d|7ed|7ing|7s|6s|5ing|8ed|8ing|8s|4s|3',
  'rage|7d|7ous|Aes|7s|6ing|4ier|7ed|7ing|7s|4se|6d|6s|5ing|4t|5ed|6sied|9s|7y|5house|Ad|As|9ing|5ing|5ney|8s|5room|9ed|9in',
  'g|9s|5s|6hip|9ed|9ing|9s|5yard|9ed|9ing|9s|3sin|6ed|6ing|6s|2ve|4d|4nant|8ed|8ing|8s|5t|6ed|6ing|6ried|9s|7y|6s|4r|5age|',
  '8d|8s|7ing|5ed|7ed|7ing|7s|5ing|8ed|8ing|8s|5s|5t|6ed|6ing|6s|4s|4ted|3ing|2w|3an|5ed|5ing|5s|4rd|6ed|6ing|6s|3boy|6s|3s',
  '|2x|3es|2yote|6d|6s|5ing|2zied|5s|3y|1rab|4ed|4ing|4s|3ck|5ed|7ed|7ing|7s|5ing|8ed|8ing|8s|5s|3dle|6d|6s|5ing|3ft|5ed|5i',
  'ng|5s|6man|9ed|9ing|9s|3ig|5ed|5ing|5s|3mbidae|9d|9s|8ing|4er|6s|4ped|7ed|7ing|7s|3ne|5d|5s|4ing|4k|5ed|5ing|5s|3p|4ed|4',
  'ing|4s|3sh|5ed|6s|5ing|3te|5d|5r|6ed|6ing|6s|5s|4ing|3ved|5n|6ed|6ing|6s|4ing|7ed|7ing|7s|3w|4ed|4ing|4l|5ed|6y|7s|5ing|',
  '8ed|8ing|8s|5s|4s|3zed|6ed|6ing|6s|4ied|6s|4y|2eaked|4m|5ed|5ied|7s|6ng|5s|5y|4t|5e|6d|6s|5ing|6on|8ed|8ing|8s|6ve|8d|8s',
  '|7ing|8tied|Bs|9y|5or|7ed|7ing|7s|5s|5ure|8d|8s|7ing|3dentials|4ibilitied|Cs|Ay|6le|8d|8s|7ing|5t|6ed|6ing|6ors|6s|3e|4d',
  '|5ed|5ing|5s|4ed|4ing|4k|5ed|5ing|5s|4p|5ed|5ied|7s|6ng|8ed|8ing|8s|5s|5y|4s|3mated|3ole|6d|6s|5ing|3pt|5ed|5ing|5s|3sce',
  'nt|8ed|8ing|8s|4t|5ed|7ed|7ing|7s|5ing|5s|3taceous|Aes|4e|5d|5s|4ing|3w|4ed|4ing|4s|2icket|7ed|8r|9ed|9ing|9s|7ing|7s|3e',
  'd|5ed|5ing|5s|4s|3me|5an|7ed|7ing|7s|5d|5s|4inal|8ed|8ing|8s|6g|4son|7ed|7ing|7s|3nged|3ppled|3s|4es|6es|4is|6es|4p|5ed|',
  '5ing|5s|4ti|6ed|6ing|6na|8ed|8ing|8s|6s|5opher|Aed|Aing|As|3teria|8ed|8ing|8s|7on|9ed|9ing|9s|4ic|6al|8ed|8ing|8lied|Bs|',
  '9y|8s|6ed|6ing|7sm|9ed|9ing|9s|7zed|8ing|6s|5que|8d|8s|7ing|2o|3atian|8ed|8ing|8s|5s|3codile|9d|9s|8ing|3ft|5ed|5ing|5s|',
  '3mwell|8ed|8ing|8s|3ok|5ed|7ed|7ing|7s|5ing|5s|3p|4ed|4ing|4s|3re|5d|5s|4ing|3s|4bied|7s|5y|4s|5bow|8ed|8ing|8s|5ed|7ed|',
  '7ing|7s|6s|5ing|8ed|8ing|8s|5over|9ed|9ing|9s|5roads|Aes|3tch|6ed|7s|6ing|3uch|6ed|8ed|8ing|8s|7s|6ing|3w|4d|5ed|7ed|7in',
  'g|7s|5ing|5s|4ed|4ing|4n|5ed|7ed|7ing|7s|5ing|5s|4s|3ydon|7ed|7ing|7s|2ucial|7ed|7ing|7s|3de|5d|5s|4ing|3el|5ed|5ing|5s|',
  '5tied|8s|6y|3ise|6d|6r|7ed|7ing|7s|6s|5ing|3mbling|9s|4pled|8ed|8ing|8s|3nch|6ed|7s|6ing|3s|4ade|7d|7r|8ed|8ing|8s|7s|6i',
  'ng|4es|4h|5ed|7ed|7ing|7s|6s|5ing|8ed|8ing|8s|4t|5ed|5ing|5s|2y|3ing|6ed|6ing|6s|3pt|5ed|5ic|7ed|7ing|7s|6ng|5s|3stal|7e',
  'd|7ing|7line|Bd|Bs|Aing|7s|1ub|3a|4ed|4ing|4n|5ed|5ing|5s|4s|3e|4d|4s|3ic|5ed|5ing|5s|4ng|3s|2ckoo|6ed|6ing|6s|2e|3d|3s|',
  '2ff|4ed|4ing|4s|2isine|7d|7s|6ing|2linaried|9s|7y|3len|6ed|6ing|6s|3minated|8ing|3t|4ed|4ing|5vated|Aed|Aing|As|8ion|Bed',
  '|Bing|Bs|4s|4ural|8ed|8ing|8lied|Bs|9y|8s|6e|7d|7s|6ing|2m|3s|3ulative|Ad|As|9ing|2nning|7ed|7ing|7s|2p|3board|8ed|8ing|',
  '8s|3ped|6ed|6ing|6s|4ing|7ed|7ing|7s|3s|2r|3ate|6d|6s|5ing|5or|7ed|7ing|7s|3b|4ed|4ing|4s|3e|4d|4s|3ing|4ositied|As|8y|5',
  'us|7es|7lied|As|8y|3l|4ed|6ed|6ing|6s|4ied|6s|5ng|7ed|7ing|7s|4s|4y|3rencied|9s|7y|6t|7ed|7ing|7lied|As|8y|7s|4iculum|Ae',
  'd|Aing|As|5ed|6s|4y|3s|4e|5d|6ed|6ing|6s|5s|4ing|3t|4ain|7ed|7ing|7s|4ed|4ing|5s|6es|4s|3vature|9d|9s|8ing|4e|5d|6ed|6in',
  'g|6s|5s|4ing|2shion|7ed|7ing|7s|3todied|8s|6y|5m|6aried|As|8y|6ed|7r|8ed|8ing|8s|6ing|6s|7es|2t|3e|4d|4s|3hbert|8ed|8ing',
  '|8s|3ing|3ler|6ed|6ing|6s|3s|3ter|6ed|6ing|6s|4ing|7ed|7ing|7s|1ycle|5d|5s|4ic|6ed|6ing|6s|5ng|7ed|7ing|7s|5st|7ed|7ing|',
  '7s|4one|7d|7s|6ing|2linder|8ed|8ing|8s|6rical|Bed|Bing|Bs|2nical|7ed|7ing|7s|3thia|7ed|7ing|7s|2press|7es|2ril|5ed|5ing|',
  '5lic|8ed|8ing|8s|5s|3us|5es|1zech|5ed|6s|5ing|5oslovak|Ced|Cing|Cs|0dad|3died|6s|4y|3e|4d|4s|3ing|3s|2emon|6ed|6ing|6s|2',
  'gger|6ed|6ing|6s|7es|2il|4ed|4ied|6s|5ng|4s|4y|3ried|6s|4y|3sied|6s|4y|2k|3ota|6ed|6ing|6s|3s|2l|3e|4d|4s|3i|4ed|4ing|4n',
  'g|4s|3s|3ton|6ed|6ing|6s|2m|3age|6d|6s|7es|5ing|4scus|8es|3e|4d|4s|3ing|3n|4ed|6ed|6ing|6s|4ing|4s|3on|5e|6d|6s|5ing|5s|',
  '3p|4ed|4ing|4s|3s|2n|3a|4ed|4ing|4s|3ce|5d|5r|6ed|6ing|6s|5s|4ing|7ed|7ing|7s|3e|4d|4s|3ger|6ed|6ing|6ous|9es|9lied|Cs|A',
  'y|6s|4ling|8ed|8ing|8s|3i|4ed|5l|6e|7d|7s|6ing|6le|8d|8s|7ing|6s|4ing|4ng|4s|5h|6ed|7s|6ing|3nie|6d|6s|5ing|4y|3s|3ube|6',
  'd|6s|5ing|3zig|6ed|6ing|6s|2phne|6d|6s|5ing|2r|3bied|6s|4y|3ci|5ed|5ing|5s|3e|4d|4n|5ed|5ing|5s|4s|3in|5ed|5g|6ed|6ing|6',
  's|5ing|5s|4us|6es|3k|4ed|5ned|6ing|9ed|9ing|9s|5r|6s|5st|4ing|4lied|7s|5y|4ness|8es|4s|3ling|7ed|7ing|7s|3rell|7ed|7ing|',
  '7s|5n|6ed|6ing|6s|4yl|6ed|6ing|6s|3s|3t|4ed|4ing|7ed|7ing|7s|4s|5es|3yl|5ed|5ing|5s|2s|3es|3h|4board|9ed|9ing|9s|4ed|6ed',
  '|6ing|6s|5s|4ing|2ta|4base|8s|4ed|4ing|4s|5et|7s|3e|4d|4s|3ing|6ed|6ing|6s|2ughter|8ed|8ing|8s|3phin|7ed|7ing|7s|2ve|4d|',
  '4nport|9ed|9ing|9s|4s|3id|5ed|5ing|5s|4ed|5s|4ng|3y|2w|3n|4ed|4ing|4s|3s|4on|6ed|6ing|6s|2y|3light|8ed|8ing|8s|3s|4es|3t',
  'ime|7d|7s|6ing|2ze|4d|5ed|5ing|5s|4s|3ing|3zling|1eacon|6ed|6ing|6s|3d|4ed|4ing|4lied|7s|6ne|8d|8s|7ing|5y|4s|3f|4ed|5ni',
  'ng|9ed|9ing|9s|4ing|4s|3l|4ed|5r|6ed|6ing|6s|4ing|7ed|7ing|7s|4s|4t|5ed|5ing|5s|3n|4ed|4ing|4s|3r|4ed|4ing|4s|3th|5ed|5i',
  'ng|5s|2b|3ate|6d|6s|5ing|8ed|8ing|8s|3bie|6d|6s|5ing|3i|4ed|4ing|4s|3orah|7ed|7ing|7s|3ris|6es|3s|3t|4ed|4ing|4s|3ut|5ed',
  '|5ing|5s|2cade|6d|6s|5ing|4y|5s|3eased|8ed|8ing|8s|4mber|8ed|8ing|8s|4nt|6ed|6ing|6s|4ption|9ed|9ing|9s|3ide|6d|7ed|7ing',
  '|7lied|As|8y|7s|6s|5ing|5uous|9es|4mal|7ed|7ing|7s|4sion|8ed|8ing|8s|6ve|8d|8s|7ing|3k|4ed|5r|6ed|6ing|6s|4ing|4s|3larat',
  'ion|Bed|Bing|Bs|6e|7d|8ed|8ing|8s|7s|6ing|4ine|7d|8ed|8ing|8s|7s|6ing|3ommissioned|5position|Ded|Ding|Ds|4rate|8d|9ed|9i',
  'ng|9s|8s|7ing|8on|Aed|Aing|As|8ve|Ad|As|9ing|3rease|8d|8s|7ing|Aed|Aing|As|5e|6ed|6ing|6s|2dicated|7ion|Aed|Aing|As|3uct',
  '|6ed|6ing|6s|2e|3d|4ed|4ing|4s|3med|3p|4ed|5ned|5r|6s|5st|4ing|4lied|7s|5y|4s|3r|4ed|4ing|4s|3s|2famation|Aed|Aing|As|4u',
  'lt|7ed|7ing|7s|3eat|6ed|6ing|6s|4ct|6ed|6ing|7ve|9d|9s|8ing|6s|4nce|7d|7s|6ing|5d|6ant|9ed|9ing|9s|6ed|7r|8ed|8ing|8s|6i',
  'ng|6s|5se|7d|7s|6ing|7ve|9d|9s|8ing|3iance|8d|8s|7ing|6t|7ed|7ing|7s|4ciencied|Bs|9y|6t|7ed|7ing|7s|4ne|6d|7ed|7ing|7s|6',
  's|5ing|6te|8d|8lied|Bs|9y|8s|7ing|8on|Aed|Aing|As|8ve|Ad|As|9ing|3ormation|Bed|Bing|Bs|3unct|7ed|7ing|7s|2g|3radation|Be',
  'd|Bing|Bs|6ed|8ed|8ing|8s|4ee|6ed|6ing|6s|3s|2irdre|7d|7s|6ing|3tied|6s|4y|2l|3aware|8d|8s|7ing|4y|5ing|8ed|8ing|8s|5s|3',
  'bert|7ed|7ing|7s|3e|4d|4gate|8d|8s|7ing|8on|Aed|Aing|As|4s|4te|6d|6s|5ing|3hi|5ed|5ing|5s|3iberate|Ad|Alied|Ds|By|As|9in',
  'g|4cate|8d|8lied|Bs|9y|8s|7ing|5ious|9es|4ght|7ed|9ed|9ing|9s|7ful|Aed|Aing|As|7ing|7s|4lah|7ed|7ing|7s|4ng|4ver|7ed|7ie',
  'd|9s|8ng|7s|7y|3l|4a|5ed|5ing|5s|4ed|4ing|4s|3s|3ta|5ed|5ing|5s|3uxe|6d|6s|5ing|2mand|6ed|6ing|9ed|9ing|9s|6s|3eanor|8ed',
  '|8ing|8s|4ntia|8ed|8ing|8s|3i|4ed|4ing|4s|5e|6d|6s|5ing|3ocracied|As|8y|7t|8ed|8ic|Aed|Aing|As|9ng|8s|4graphic|Bed|Bing|',
  'Bs|4lished|6tion|Aed|Aing|As|4n|5ed|5ic|7ed|7ing|7s|6ng|5s|6trate|Bd|Bs|Aing|Bon|Ded|Ding|Ds|Aors|4s|5es|4ted|2n|3ial|6e',
  'd|6ing|6s|4ed|5s|4m|5ed|5ing|5s|4s|5es|3mark|7ed|7ing|7s|3nis|6es|3omination|Ced|Cing|Cs|4te|6d|6s|5ing|4unced|3s|4e|5d|',
  '5lied|8s|6y|5s|4ing|5tied|8s|6y|3t|4al|6ed|6ing|6s|4ed|4ing|5st|7ed|7ing|7ried|As|8y|7s|4s|3y|2part|6ed|8ed|8ing|8s|6ing',
  '|6ment|Aal|Ced|Cing|Cs|Aed|Aing|As|6s|6ure|9d|9s|8ing|3end|6ed|7nce|Ad|As|9ied|Bs|Ang|9y|8t|9ed|9ing|9s|6ing|9ed|9ing|9s',
  '|6s|3ict|6ed|6ing|7on|9ed|9ing|9s|6s|3leted|4oy|6ment|Aed|Aing|As|6s|3ortation|Bed|Bing|Bs|6ed|4sed|5it|7ed|7ing|8on|Aed',
  '|Aing|As|7s|4t|5ed|5ing|5s|3ressed|9ed|9ing|9s|7ion|Aed|Aing|As|4ivation|Bed|Bing|Bs|6ed|3th|5ed|5ing|5s|3utied|7s|5y|2r',
  'bied|6s|4y|3ek|5ed|5ing|5s|4lict|8ed|8ing|8s|3ivation|Aed|Aing|As|8ve|Ad|As|9ing|5e|6d|7ed|7ing|7s|6s|5ing|3rick|7ed|7in',
  'g|7s|5ed|6s|4y|2scend|7ant|Aed|Aing|As|7ed|7ing|Aed|Aing|As|7s|6t|7ed|7ing|7s|4ribe|8d|8s|7ing|6pt|8ed|8ing|9on|Bed|Bing',
  '|Bs|9ve|Bd|Bs|Aing|8s|3ert|6ed|8ed|8ing|8s|6ing|6s|5ve|7d|8ed|8ing|8s|7s|6ing|3ign|6ate|9d|9s|8ing|9on|Bed|Bing|Bs|6ed|8',
  'ed|8ing|8s|7r|8ed|8ing|8s|6ing|9ed|9ing|9s|6s|4rable|9d|9s|8ing|5e|6d|7ed|7ing|7s|6s|5ing|3k|4ed|4ing|4s|3pair|7ed|7ing|',
  '7s|4erate|9d|9lied|Cs|Ay|9s|8ing|9on|Bed|Bing|Bs|4ised|5te|7d|7s|6ing|3sert|7ed|7ing|7s|3tination|Bed|Bing|Bs|6ed|6ied|8',
  's|6y|4roy|7er|9ed|9ing|9s|7s|5uction|Bed|Bing|Bs|9ve|Bd|Bs|Aing|2tached|8ed|8ing|8s|6ment|Aed|Aing|As|4il|6ed|8ed|8ing|8',
  's|6ing|6s|5n|6ed|6ing|6s|3ect|6ed|6ing|7on|9ed|9ing|9s|7ve|9d|9s|8ing|6or|8ed|8ing|8s|6s|4ntion|9ed|9ing|9s|4r|5ed|5ing|',
  '6orated|Aing|Bon|Ded|Ding|Ds|5mination|Ded|Ding|Ds|8e|9d|Aed|Aing|As|9s|8ing|5s|3onated|3rimental|Bed|Bing|Bs|2v|3ast|6a',
  'ted|8ing|Bed|Bing|Bs|9on|Bed|Bing|Bs|6ed|6ing|6s|3elop|7ed|8r|9ed|9ing|9s|7ing|7ment|Bal|Ded|Ding|Ds|Bed|Bing|Bs|7s|3iat',
  'ion|9ed|9ing|9s|4ce|6d|6s|5ing|4l|5ed|5ing|5s|4sed|3oid|6ed|6ing|6s|4n|5ed|5ing|5s|4te|6d|7ed|7ing|7s|6es|6s|5ing|6on|8e',
  'd|8ing|8s|4ut|6ed|6ing|6s|3s|2w|3ey|5s|3s|2xter|6ed|6ing|6s|1harma|6ed|6ing|6s|1iabetes|8es|3gnosed|7is|9es|7tic|Aed|Ain',
  'g|As|4onal|8ed|8ing|8s|4ram|7ed|7ing|7s|3l|4ect|7ed|7ing|7s|5d|4ing|4ogue|8d|8s|7ing|4s|3meter|8ed|8ing|8s|4ond|7ed|7ing',
  '|7s|3n|4a|5ed|5ing|5s|4e|5d|5s|4ing|4s|3ried|6s|4y|3spora|8ed|8ing|8s|2ce|4d|4s|3ing|3k|4ed|5ns|7es|4ing|4s|3tated|6or|8',
  'ed|8ing|8s|9hip|Ced|Cing|Cs|4ionaried|Bs|9y|2d|3s|2e|3d|3go|5ed|5ing|5s|3s|4el|6ed|6ing|6s|3t|4aried|8s|6y|4ed|5r|6ed|6i',
  'ng|6s|4ing|4s|2ffer|6ed|7nce|Ad|As|9ing|8t|9ed|9ial|Ced|Cing|Cs|Bte|Dd|Ds|Cing|Don|Fed|Fing|Fs|Ang|9lied|Cs|Ay|9s|6ing|6',
  's|4icult|9ed|9ied|Bs|Ang|9s|9y|4use|7d|7s|6ing|7on|9ed|9ing|9s|2g|3est|6ed|6ing|6s|3ger|6ed|6ing|6s|4ing|7ed|7ing|7s|3it',
  '|5al|7ed|7ing|7lied|As|8y|7s|5ed|5ing|5s|3nitaries|6ied|8s|6y|3s|2lapidated|Bed|Bing|Bs|3emma|7ed|7ing|7s|2m|3e|4d|4nsio',
  'n|9al|Bed|Bing|Bs|9ed|9ing|9s|4s|4tried|8s|6y|3ing|5ished|4tried|8s|6y|3lied|6s|4y|3s|2n|3ah|5ed|5ing|5s|3er|5ed|5ing|5s',
  '|3g|4ed|4ing|4s|3ing|6ed|6ing|6s|3ner|6ed|6ing|6s|3osaur|8ed|8ing|8s|3s|2ocesan|8ed|8ing|8s|6e|7d|7s|6ing|3n|4ed|4ing|4s',
  '|3xide|7d|7s|6ing|2p|3loma|7cied|As|8y|7ed|7ing|7s|7t|8ed|8ic|Aed|Aing|As|9ng|8s|3ped|6ed|6ing|6s|4ing|7ed|7ing|7s|3s|2r',
  'e|4ct|6ed|8ed|8ing|8s|6ing|7on|9al|Bed|Bing|Bs|9ed|9ing|9s|7ve|9d|9s|8ing|6lied|9s|7y|6or|8ate|Bd|Bs|Aing|8ed|8ial|Bed|B',
  'ing|Bs|9ed|As|9ng|8s|8y|6s|4d|4s|3ing|3k|4ed|4ing|4s|3t|4ed|4ied|6s|5ng|4s|4y|2s|3abilitied|Bs|9y|5le|7d|8ed|8ing|8s|7s|',
  '6ing|4dvantage|Cd|Cs|Bing|4gree|8d|9ed|9ing|9s|8ed|8ing|8ment|Ced|Cing|Cs|8s|4ppear|9ance|Dd|Ds|Cing|9ed|9ing|Ced|Cing|C',
  's|9s|6oint|Aed|Ced|Cing|Cs|Aing|Ded|Ding|Ds|Ament|Eed|Eing|Es|As|6roval|Bed|Bing|Bs|4ster|8ed|8ing|8s|6rous|Aes|3banded|',
  '4elief|9ed|9ing|9s|3c|4arded|4ed|4harge|9d|9s|8ing|4ing|5ple|8d|8s|7inaried|Ds|By|9e|Ad|As|9g|9ing|4lose|8d|9ed|9ing|9s|',
  '8s|7ing|7ure|Ad|As|9ing|4omfort|Aed|Aing|As|5nnected|Ced|Cing|Cs|6tent|Aed|Aing|As|7inued|5unt|8ed|8ing|8s|6rage|Ad|As|9',
  'ing|7se|9d|9s|8ing|5ver|8ed|Aed|Aing|As|8ied|As|9ng|8s|8y|4reet|8ed|8ing|8s|6te|8d|8s|7ing|8on|Aed|Aing|As|5imination|Ee',
  'd|Eing|Es|4s|4us|6es|6s|7es|7ion|Aed|Aing|As|3dain|7ed|7ing|7s|3ease|7d|7s|6ing|4s|3grace|8d|8s|7ing|4uise|8d|9ed|9ing|9',
  's|8s|7ing|5st|7ed|9ed|9ing|9s|7ing|Aed|Aing|As|7s|3h|4ed|5s|4ing|3k|4ed|4ing|4s|3like|7d|7s|6ing|3mantled|5y|6s|4iss|7al',
  '|9ed|9ing|9s|7es|4ounted|3order|8ed|8ing|8s|3patch|8ed|9s|8ing|4ersal|9ed|9ing|9s|7e|8d|9ed|9ing|9s|8s|7ing|4laced|8ment',
  '|Ced|Cing|Cs|6y|7ed|9ed|9ing|9s|7s|5easure|Bd|Bs|Aing|4osal|8ed|8ing|8s|6e|7d|8ed|8ing|8s|7s|6ing|7tion|Bed|Bing|Bs|4rop',
  'ortion|Ded|Ding|Ds|4ute|7d|7s|6ing|3qualification|Fned|Fning|Fns|Aed|3regard|9ed|9ing|9s|5pair|9ed|9ing|9s|4upt|7ed|7ing',
  '|8on|Aed|Aing|As|7s|3s|4atisfaction|Fed|Fing|Fs|9ied|Ced|Cing|Cs|4emination|Ded|Ding|Ds|5nt|7ed|7ing|7s|5rtation|Ced|Cin',
  'g|Cs|5s|4ipated|Aed|Aing|As|4olution|Bed|Bing|Bs|6ve|8d|8s|7ing|3tal|6ed|6ing|6s|5nce|8d|8s|7ing|6t|7ed|7ing|7s|4illerie',
  'd|Bs|9y|5nct|8ed|8ing|9on|Bed|Bing|Bs|9ve|Bd|Bs|Aing|8lied|Bs|9y|8s|6guish|Bed|Ded|Ding|Ds|Cs|Bing|Eed|Eing|Es|4orted|9e',
  'd|9ing|9s|7ion|Aed|Aing|As|4ract|8ed|Aed|Aing|As|8ing|9on|Bed|Bing|Bs|8s|6ught|Aed|Aing|As|5ess|8ed|Aed|Aing|As|9s|5ibut',
  'e|Ad|Bed|Bing|Bs|As|9ing|Aon|Ced|Cing|Cs|9or|Bed|Bing|Bs|6ct|8ed|8ing|8s|5ust|8ed|8ing|8s|4urb|7ance|Bd|Bs|Aing|7ed|9ed|',
  '9ing|9s|7ing|Aed|Aing|As|7s|3used|2tch|5ed|6s|5ing|2v|3a|4ed|4ing|4s|3e|4d|4r|5ed|5ing|5s|6e|7d|7s|6ified|Bed|Bing|Bs|7n',
  'g|7on|9ed|9ing|9s|7tied|As|8y|5t|6ed|6ing|6s|4s|3ide|6d|7ed|7ing|7s|6s|5ing|8ed|8ing|8s|4ne|6d|6s|5g|6ed|6ing|6s|5ing|6t',
  'ied|9s|7y|4sion|8al|Aed|Aing|As|8ed|8ing|8s|3orce|7d|7s|6ing|3s|2xie|5d|5s|4ing|2zzied|6s|4y|1o|2bson|6ed|6ing|6s|2c|3k|',
  '4ed|4ing|4s|4yard|8ed|8ing|8s|3s|3tor|6al|8ed|8ing|8s|7te|9d|9s|8ing|6ed|6ing|6s|4rine|8d|8s|7ing|3ument|8aried|Cs|Ay|9t',
  'ion|Ded|Ding|Ds|8ed|8ing|8s|2d|3d|4ed|4ing|4s|3ge|5d|5rs|5s|4ing|3s|2e|3s|4es|2g|3s|4es|2ing|5ed|5ing|5s|2ll|4ar|6ed|6in',
  'g|6s|4ed|4ied|6s|5ng|4s|4y|3ores|7es|3phin|7ed|7ing|7s|2m|3ain|6ed|6ing|6s|3e|4d|4s|5day|8s|5tic|8allied|Ds|By|8ed|8ing|',
  '8s|3inance|9d|9s|8ing|7t|8ed|8ing|8s|6te|8d|9ed|9ing|9s|8s|7ing|8on|Aed|Aing|As|5g|5ic|7an|9ed|9ing|9s|7ed|7ing|7k|8ed|8',
  'ing|8s|7s|6on|8ed|8ing|8s|6que|9d|9s|8ing|5o|6ed|6ing|6s|3s|2n|3al|5d|6ed|6ing|6s|5ed|5ing|5s|4te|6d|7ed|7ing|7s|6s|5ing',
  '|6on|8ed|8ing|8s|3e|4d|4s|3g|4ed|4ing|4s|3ing|3key|6s|3n|4a|5ed|5ing|5s|4e|5d|5s|4ie|6d|6s|5ing|5ng|4s|3or|5ed|5ing|5s|4',
  'van|7ed|7ing|7s|3s|3t|4ed|4ing|4s|2om|4ed|4ing|4s|3r|4bell|8ed|8ing|8s|4ed|4ing|4s|5tep|8ed|8ing|8s|4way|7s|2ping|2r|3a|',
  '4ed|4ing|4s|3i|4an|6ed|6ing|6s|4ed|5s|4ing|4s|5es|3m|4ant|7ed|7ing|7s|4ed|4ing|5toried|As|8y|4s|3othea|8ed|8ing|8s|6ied|',
  '8s|6y|3s|4al|6ed|6ing|6s|3y|2s|3e|4d|4s|3ing|2t|3s|3ted|6ed|6ing|6s|2uble|6d|7ed|7ing|7s|6s|5ing|8ed|8ing|8s|4t|5ed|5ful',
  '|8ed|8ing|8s|5ing|5s|3g|4ed|4h|5ed|5ing|5s|4ing|4las|7es|4s|2ve|4d|4r|5ed|5ing|5s|4s|3ing|2w|3ager|7ed|7ing|7s|3n|4ed|4f',
  'all|8ed|8ing|8s|4hill|8ed|8ing|8s|4ing|7ed|7ing|7s|4s|5tairs|Aes|6ream|Aed|Aing|As|4town|8ed|8ing|8s|4ward|8ed|8ing|8s|3',
  'ried|6s|4y|3s|2yle|5d|5s|4ing|2zen|5ed|5ing|5s|1raft|5ed|5ing|8ed|8ing|8s|5s|3g|4ed|4ged|7ed|7ing|7s|5ing|8ed|8ing|8s|4i',
  'ng|4on|6ed|6ing|6s|5ons|4s|3in|5age|8d|8s|7ing|5ed|7ed|7ing|7s|5ing|5s|3ke|5d|5s|4ing|3m|4a|5ed|5ing|5s|5tic|8allied|Ds|',
  'By|8ed|8ing|8s|4ed|4ing|4s|3nk|5ed|5ing|5s|3ped|5r|6ed|6ing|6s|3stic|7allied|Cs|Ay|7ed|7ing|7s|3ught|7ed|7ing|7s|3w|4ed|',
  '5r|6ed|6ing|6s|7es|4ing|7ed|7ing|7s|4n|5ed|5ing|5s|4s|2ead|5ed|5ful|8ed|8ing|8s|5ing|5s|4m|5ed|6r|7ed|7ing|7s|5ing|5s|3n',
  'ched|3ss|5ed|7ed|7ing|7s|6r|7ed|7ing|7s|6s|5ing|8ed|8ing|8s|3w|4ed|4ing|4s|2ied|5ed|5ing|5s|4s|3ft|5ed|5ing|8ed|8ing|8s|',
  '5s|3ll|5ed|5ing|8ed|8ing|8s|5s|3nk|5ed|5ing|8ed|8ing|8s|5s|3p|4ed|4ing|4ping|8ed|8ing|8s|4s|3ve|5d|5n|6ed|6ing|6s|5r|6ed',
  '|6ing|6s|5s|5way|8s|4ing|7ed|7ing|7s|2one|5d|5s|4ing|3p|4ed|4ing|4lets|4ping|8ed|8ing|8s|4s|3ught|7ed|7ing|7s|3ve|5d|5s|',
  '4ing|3wn|5ed|5ing|5s|2ug|4ed|4ing|4s|3m|4ed|4ing|4mer|7ed|7ing|7s|5ing|8ed|8ing|8s|4s|3nk|5ed|6n|7ed|7ing|7s|5ing|5s|2y|',
  '3ing|6ed|6ing|6s|3lied|6s|4y|1ual|4ed|4ing|4s|3ne|5d|5s|4ing|2b|3bed|3ious|7es|3s|2chess|7es|4ied|6s|4y|3k|4ed|4ing|4s|3',
  't|4ed|4ing|4s|2de|4d|4s|3ing|3ley|6s|2e|3d|3l|4ed|4ing|4s|3s|3t|4ed|4ing|4s|2ff|4ed|4ing|4s|2g|3s|2ke|4d|4s|3ing|2lied|5',
  's|3l|4ed|4ing|4s|3y|2mb|4ed|4ing|4s|3mied|6s|4y|3p|4ed|4ing|7ed|7ing|7s|4s|2n|3can|6ed|6ing|6s|3e|4d|4s|3g|4ed|5on|7ed|7',
  'ing|7s|4ing|4s|3ing|3kirk|7ed|7ing|7s|3lop|6ed|6ing|6s|3ne|5d|5s|4ing|3s|2o|3s|2plicate|9d|9s|8ing|2rable|7d|7s|6ing|4ti',
  'on|8ed|8ing|8s|3ban|6ed|6ing|6s|3ham|6ed|6ing|6s|3ing|6ed|6ing|6s|2sk|4ed|4ing|4s|3t|4ed|4ied|6s|5n|6ed|6g|6ing|6s|4s|4y',
  '|2tch|5ed|6s|5ing|3ied|5s|3y|1warf|5ed|5ing|5s|3yne|6d|6s|5ing|2ell|5ed|6rs|5ing|8ed|8ing|8s|5s|2ight|6ed|6ing|6s|1ye|3r',
  '|4ed|4ing|4s|3s|2ing|5ed|5ing|5s|2ke|4d|4s|3ing|2lan|5ed|5ing|5s|2namic|7ed|7ing|7s|8es|6te|8d|8s|7ing|5o|6ed|6ing|6s|4s',
  'tied|8s|6y|2sfunction|Bed|Bing|Bs|0each|4ed|5s|4ing|2ger|5ed|5ing|5lied|8s|6y|5s|3le|5d|5s|4ing|2r|3l|4e|5d|5s|4ied|6r|6',
  's|7t|5ng|4s|4y|3n|4ed|5st|7ed|7ing|7s|4ie|6d|6s|5ing|5ng|7ed|7ing|7s|8es|4s|3rings|3s|3th|5ed|5ing|5lied|8s|6y|5quake|Ad',
  '|As|9ing|5s|2se|4d|4s|3ied|5r|6ed|6ing|6s|5s|6t|7ed|7ing|7s|4lied|7s|5y|4ng|6ed|6ing|6s|3t|4bound|9ed|9ing|9s|4ed|5r|6ed',
  '|6ing|6n|7ed|7ing|7s|6s|4ing|4s|4ward|8ed|8ing|8s|3y|2t|3en|5ed|5ing|5s|4r|5ed|5ing|5s|3ing|6ed|6ing|6s|3s|4es|1bonied|6',
  's|4y|1ccentric|9ed|9ing|9s|3lesiastical|Eed|Eing|Es|2ho|4ed|4ing|4s|2lectic|8ed|8ing|8s|3ipse|7d|7s|6ing|2ole|5d|5s|4ing',
  '|4ogical|Aed|Aing|As|7ed|8s|6y|3nomic|8al|Aed|Aing|Alied|Ds|By|As|8ed|8ing|8s|9es|7ed|8s|7st|9ed|9ing|9s|6y|3system|9ed|',
  '9ing|9s|2stasied|8s|6y|2umenical|Aed|Aing|As|1ddie|5d|5s|4ing|3y|2en|4ed|4ing|4s|2gar|5ed|5ing|5s|3e|4d|5ed|5ing|5s|4s|3',
  'ing|2ible|6d|6s|5ing|3ct|5ed|5ing|5s|3t|4ed|4h|5ed|5ing|5s|4ing|5on|7ed|7ing|7s|4or|6ed|6ial|9ed|9ing|9s|7ng|6s|4s|2mond',
  '|6ed|6ing|6s|3und|6ed|6ing|6s|2na|4ed|4ing|4s|2o|3s|2uardo|7ed|7ing|7s|3cate|7d|8ed|8ing|8s|7s|6ing|7on|9al|Bed|Bing|Bs|',
  '9ed|9ing|9s|6or|8ed|8ing|8s|2ward|6ed|6ing|6s|3in|5ed|5ing|5s|1el|3s|2rie|5d|5s|4ing|1ffect|6ed|6ing|7ve|9d|9lied|Cs|Ay|',
  '9ness|Des|9s|8ing|6s|7es|3icacied|9s|7y|5iencied|Bs|9y|8t|9ed|9ing|9lied|Cs|Ay|9s|3ort|6ed|6ing|6lesslied|Ds|By|6s|1gg|3',
  's|2o|3s|2ypt|5ed|5ian|8ed|8ing|8s|6ng|5s|1ight|5ed|6en|8ed|8ing|8s|8th|Aed|Aing|As|5h|6ed|6ing|6s|5ied|7s|6ng|5s|5y|2lee',
  'n|6ed|6ing|6s|2ther|6ed|6ing|6s|1jected|1laborate|9d|9s|8ing|3ine|6d|6s|5ing|3stic|7ed|7ing|7s|2bow|5ed|5ing|5s|2d|3er|5',
  'ed|5ing|5lied|8s|6y|5s|4st|6ed|6ing|6s|3s|2eanor|7ed|7ing|7s|3ct|5ed|5ing|6on|8ed|8ing|8s|5or|7al|9ed|9ing|9s|8te|Ad|As|',
  '9ing|7ed|7ing|7s|5ric|8al|Aed|Aing|Alied|Ds|By|As|8ed|8ing|9tied|Cs|Ay|8s|7fication|Fed|Fing|Fs|9ed|6o|7de|9d|9s|8ing|7e',
  'd|7ing|7magnetic|Fed|Fing|Fs|7n|8ed|8ic|Aed|Aing|As|Bes|9ng|8s|7s|5s|3gance|8d|8s|7ing|6t|7ed|7ing|7s|3ment|7al|9ed|9ing',
  '|9s|8ried|Bs|9y|7ed|7ing|7s|3phant|8ed|8ing|8s|3vated|8ed|8ing|8s|6ion|9ed|9ing|9s|6or|8ed|8ing|8s|4en|6ed|6ing|6s|6th|8',
  'ed|8ing|8s|2f|3s|2i|3as|5es|3gibilitied|Cs|Ay|6le|8d|8s|7ing|3jah|6ed|6ing|6s|3minate|9d|9s|8ing|9on|Bed|Bing|Bs|3ot|5ed',
  '|5ing|5s|3s|4abeth|9ed|9ing|9s|3te|5d|5s|4ing|3za|5beth|9ed|9ing|9s|5ed|5ing|5s|2k|3s|2l|3a|4ed|4ing|4s|3e|4d|4n|5ed|5in',
  'g|5s|4s|3ing|4ot|6ed|6ing|6s|6t|7ed|7ing|7s|4ptic|8al|Aed|Aing|As|8ed|8ing|8s|3s|2m|3er|5ed|5ing|5s|3s|2ongated|9ed|9ing',
  '|9s|2ric|5ed|5ing|5s|2sa|4ed|4ing|4s|3e|4d|4s|4where|9d|9s|8ing|3ing|2usive|7d|7s|6ing|2ves|5es|3is|5es|2wood|6ed|6ing|6',
  's|1mail|5s|3ncipation|Ced|Cing|Cs|2bankment|Aed|Aing|As|4rk|6ed|6ing|6s|5rass|9ed|Bed|Bing|Bs|As|9ing|Ced|Cing|Cs|9ment|',
  'Ded|Ding|Ds|4ssied|8s|6y|3ed|5ed|5ing|5s|3lem|6ed|6ing|6s|3odied|3race|7d|7s|6ing|9ed|9ing|9s|4oidered|9ied|Bs|9y|4yo|6e',
  'd|6ing|6s|2er|4ald|7ed|7ing|7s|4ge|6d|6nce|9d|9s|8ied|As|9ng|8y|6s|5ing|4ied|6s|5tus|8es|4s|4y|2igrated|7ion|Aed|Aing|As',
  '|3l|4ed|4ia|6ed|6ing|6s|5ed|6s|5ng|4s|4y|3nent|7ed|7ing|7s|3r|4ates|4ed|4ing|4s|3ssion|8ed|8ing|8s|2ma|4ed|4ing|4nuel|8e',
  'd|8ing|8s|4s|3ett|6ed|6ing|6s|2otion|7al|9ed|9ing|9lied|Cs|Ay|9s|7ed|7ing|7s|2pathied|8s|6y|3eror|7ed|7ing|7s|3hasis|8es',
  '|7ze|9d|9s|8ing|3ire|6d|6s|5ical|9ed|9ing|9s|6ng|3loy|6ed|8ed|8ing|8s|7e|8ed|8ing|8s|7r|8ed|8ing|8s|6ment|Aed|Aing|As|6s',
  '|3ower|7ed|7ing|7ment|Bed|Bing|Bs|7s|3ress|7es|3tied|6s|5ness|9es|4y|1nable|6d|6s|5ing|3ct|5ed|5ing|5ment|9ed|9ing|9s|5s',
  '|3mel|6ed|6ing|6s|2chanted|3ircled|3lave|7d|7s|6ing|4osed|6ure|9d|9s|8ing|3oded|5ing|4mpass|9es|4re|6d|6s|5ing|4unter|9e',
  'd|9ing|9s|5rage|9d|9ment|Ded|Ding|Ds|9s|8ing|Bed|Bing|Bs|3rypted|7ion|Aed|Aing|As|3yclopedia|Ced|Cing|Cs|2d|3angered|3ea',
  'vor|8ed|8ing|8s|4d|5ed|5ing|5s|4mic|7ed|7ing|7s|3ing|6ed|6ing|6s|3less|7es|3orse|7d|8ed|8ing|8s|7ment|Bed|Bing|Bs|7s|6in',
  'g|4wed|5ment|9ed|9ing|9s|3s|3urance|9d|9s|8ing|5e|6d|6s|5ing|8ed|8ing|8s|2emied|6s|4y|3rgetic|9ed|9ing|9s|5ied|7s|5y|2fo',
  'rce|7d|8ed|8ing|8s|7ment|Bed|Bing|Bs|7s|6ing|2gage|6d|7ed|7ing|7s|6ment|Aed|Aing|As|6s|5ing|8ed|8ing|8s|3ine|6d|6er|8ed|',
  '8ing|Bed|Bing|Bs|8s|6s|5ing|3lish|7ed|8s|7ing|7man|Aed|Aing|As|3raved|8ed|8ing|8s|7r|8ed|8ing|8s|6ing|9ed|9ing|9s|3ulfed',
  '|2hance|7d|8ed|8ing|8s|7ment|Bed|Bing|Bs|7s|6ing|2igma|6ed|6ing|6s|2joy|5able|9d|9s|8ing|5ing|8ed|8ing|8s|5ment|9ed|9ing',
  '|9s|5s|2larged|8ed|8ing|8s|3ight|7ed|8nment|Ded|Ding|Ds|7ing|7s|4st|6ed|8ed|8ing|8s|6ing|6s|2och|5ed|6s|5ing|3rm|5ed|5in',
  'g|5ous|8es|5s|3ugh|6ed|6ing|6s|2raged|7ed|7ing|7s|3iched|6ment|Aed|Aing|As|3oll|6ed|8ed|8ing|8s|6ing|6ment|Aed|Aing|As|6',
  's|2s|3emble|8d|8s|7ing|4s|3ign|6ed|6ing|6s|3laved|3ued|4ing|4re|6d|6s|5ing|2ter|5ed|5ing|8ed|8ing|8s|5prise|Ad|As|9ing|5',
  's|5tain|9ed|Ar|Bed|Bing|Bs|9ing|Ced|Cing|Cs|9ment|Ded|Ding|Ds|9s|3husiasm|Aed|Aing|As|9t|Aed|Aic|Callied|Fies|Fy|Ced|Cin',
  'g|Cs|Bng|As|3ire|6d|6lied|9s|7y|6s|6tied|9s|7y|5ing|4tied|7s|5led|5y|3ourage|9d|9s|8ing|3rance|8d|8s|7ing|4epreneur|Ced|',
  'Cing|Cs|Dhip|Fped|Fping|Fps|4ied|6s|4opied|8s|6y|4usted|4y|2velop|7e|8d|8s|7ing|7s|3ied|5s|4ronment|Bal|Ded|Ding|Dlied|F',
  'es|Ey|Ds|Bed|Bing|Bs|4sion|8ed|8ing|8s|3oy|5s|3y|2zyme|6d|6s|5ing|1pic|4ed|4ing|4s|3demic|8ed|8ing|8s|3logue|8d|8s|7ing|',
  '3scopal|9ed|9ing|9s|4ode|7d|7s|6ing|3thet|7ed|7ing|7s|2och|5ed|6s|5ing|3nymous|9es|2silon|7ed|7ing|7s|1qual|5ed|5ing|6ti',
  'ed|9s|7y|5lied|8s|6y|5s|4tion|8ed|8ing|8s|5or|7ed|7ial|Aed|Aing|As|8ng|7s|3estrian|Aed|Aing|As|3ilibrium|Bed|Bing|Bs|4pm',
  'ent|9ed|9ing|9s|4tied|7s|5y|4valence|Bd|Bs|Aing|9t|Aed|Aing|As|1ra|3s|4e|5d|6ed|6ing|6s|5s|4ing|4mus|7es|2d|3s|2ect|5ed|',
  '5ing|6on|8ed|8ing|8s|5s|2ic|4a|5ed|5ing|5s|4ed|4ing|4k|5ed|5ing|5s|4s|3e|4d|4s|3ing|3k|4a|5ed|5ing|5s|4ed|4ing|4s|2nest|',
  '6ed|6ing|6s|3ie|5d|5s|4ing|3st|5ed|5ing|5s|2oded|6ed|6ing|6s|3sion|7ed|7ing|7s|3tic|6ed|6ing|6s|2r|3atic|7ed|7ing|7s|3on',
  'eouslied|Cs|Ay|4r|5ed|5ing|5s|3s|2upt|5ed|5ing|6on|8ed|8ing|8s|5s|2win|5ed|5ing|5s|1scalated|4pe|6d|6s|5ing|3ort|6ed|6in',
  'g|6s|2peciallied|Bs|9y|3ionage|9d|9s|8ing|2s|3ay|5s|3ence|7d|7s|6ing|5tial|9ed|9ing|9lied|Cs|Ay|9s|4s|4x|5es|2tablish|9e',
  'd|Bed|Bing|Bs|As|9ing|9ment|Ded|Ding|Ds|4dio|7ed|7ing|7s|4te|6d|6s|5ing|3eem|6ed|6ing|6s|3her|6ed|6ing|6s|3imate|8d|8s|7',
  'ing|8on|Aed|Aing|As|3onian|8ed|8ing|8s|3ranged|3uaried|8s|6y|1ta|3s|2ched|2ernal|7ed|7ing|7s|5itied|9s|7y|2han|5ed|5ing|',
  '5ol|7ed|7ing|7s|5s|3el|5ed|5ing|5s|4r|5ed|5ing|5s|3ical|7ed|7ing|7s|5s|6es|4opia|8ed|8ing|8n|9ed|9ing|9s|8s|3nic|6ed|6in',
  'g|6s|2udes|2ymologied|As|8y|1ucalyptus|Aes|3lidean|9ed|9ing|9s|2gene|6d|6s|5ing|2rasian|8ed|8ing|8s|3eka|6ed|6ing|6s|3op',
  'a|6ed|6ing|6s|5ean|8ed|8ing|8s|1va|3cuate|8d|8s|7ing|8on|Aed|Aing|As|3de|5d|5s|4ing|3luate|8d|8s|7ing|8on|Aed|Aing|As|3n',
  '|4ed|4gel|7ed|7ical|Bed|Bing|Bs|8ng|8st|Aed|Aing|As|7s|4ing|4s|3s|2e|3d|3lyn|6ed|6ing|6s|3n|4ed|4ing|7ed|7ing|7s|4lied|7',
  's|5y|4s|4t|5ed|5ing|5s|5ual|8ed|8ing|8lied|Bs|9y|8s|3r|4ed|5st|5tt|7ed|7ing|7s|4green|9ed|9ing|9s|4ied|6s|5ng|4s|4y|5bod',
  'ied|As|8y|5day|8s|5one|8d|8s|7ing|5thing|Aed|Aing|As|5where|Ad|As|9ing|3s|2icted|3dence|8d|8s|7ing|6t|7ed|7ing|7lied|As|',
  '8y|7s|3l|4ed|4ing|4s|2olution|9aried|Ds|By|9ed|9ing|9s|4ve|6d|6s|5ing|1xact|5ed|5ing|5lied|8s|6y|5s|3ggerated|Bed|Bing|B',
  's|3m|4ed|4ination|Bed|Bing|Bs|6e|7d|7r|8ed|8ing|8s|7s|6g|6ing|9ed|9ing|9s|4ple|7d|7s|6ing|4s|3sperated|Bed|Bing|Bs|2cava',
  'ted|7ion|Aed|Aing|As|3eed|6ed|6ing|9ed|9ing|9s|6s|4l|5ed|5ing|5lence|Ad|As|9ing|8t|9ed|9ing|9s|5s|4pt|6ed|6ing|7on|9al|B',
  'ed|Bing|Blied|Es|Cy|Bs|9ed|9ing|9s|6s|4rpt|7ed|7ing|7s|4ss|6es|6ive|9d|9s|8ing|3hange|8d|8s|7ing|4equer|9ed|9ing|9s|3ite',
  'd|7ed|7ing|7lied|As|8y|7s|6ment|Aed|Aing|As|5ing|8ed|8ing|8s|3laimed|4ude|7d|7s|6ing|9ed|9ing|9s|5sion|9ed|9ing|9s|7ve|9',
  'd|9lied|Cs|Ay|9s|8ing|3ursion|9ed|9ing|9s|4se|6d|6s|5ing|2ecute|7d|8ed|8ing|8s|7s|6ing|7on|9ed|9ing|9s|7ve|9d|9s|8ing|3m',
  'plaried|As|8y|6ified|5t|6ed|6ing|7on|9ed|9ing|9s|6s|3rcise|8d|8s|7ing|4t|5ed|5ing|5s|2haled|4ust|7ed|9ed|9ing|9s|7ing|8o',
  'n|Aed|Aing|As|7s|3ibit|7ed|7ing|8on|Aed|Aing|As|7s|2ile|5d|5s|4ing|3st|5ed|6nce|9d|9s|8ing|7t|8ed|8ing|8s|5ing|5s|3t|4ed',
  '|4ing|4s|2odus|6es|3tic|6ed|6ing|6s|2pand|6ed|8ed|8ing|8s|6ing|9ed|9ing|9s|6s|5se|7d|7s|6ing|7on|9ed|9ing|9s|7ve|9d|9s|8',
  'ing|3ect|6ation|Bed|Bing|Bs|6ed|6ing|6s|4dition|Aaried|Es|Cy|Aed|Aing|As|4nd|6ed|6ing|7ture|Bd|Bs|Aing|6s|5se|7d|7s|6ing',
  '|7ve|9d|9s|8ing|4rience|Ad|Bed|Bing|Bs|As|9ing|6ment|Aal|Ced|Cing|Cs|Btion|Fed|Fing|Fs|Aed|Ced|Cing|Cs|Aing|As|5t|6ed|6i',
  'ng|6s|3ired|3lain|7ed|7ing|Aed|Aing|As|7s|5nation|Bed|Bing|Bs|4icit|8ed|8ing|8lied|Bs|9y|8s|4ode|7d|8ed|8ing|8s|7s|6ing|',
  '5it|7ation|Ced|Cing|Cs|7ed|7ing|7s|5ration|Bed|Bing|Bs|6e|7d|7r|8ed|8ing|8s|7s|6ing|9ed|9ing|9s|5sion|9ed|9ing|9s|7ve|9d',
  '|9s|8ing|3onential|Bed|Bing|Bs|4rt|6ed|6ing|6s|4se|6d|7ed|7ing|7s|6s|5ing|6tion|Aed|Aing|As|5ure|8d|8s|7ing|3ress|7ed|9e',
  'd|9ing|9s|8s|7ion|Aed|Aing|As|8ve|Ad|As|9ing|7way|As|3ulsion|9ed|9ing|9s|2quisite|9d|9s|8ing|2tant|6ed|6ing|6s|3end|6ed|',
  '8ed|8ing|8s|6ing|9ed|9ing|9s|6s|5sion|9ed|9ing|9s|7ve|9d|9lied|Cs|Ay|9s|8ing|5t|6ed|6ing|6s|4rior|8ed|8ing|8s|5nal|8ed|8',
  'ing|8lied|Bs|9y|8s|3inct|7ed|7ing|8on|Aed|Aing|As|7s|5guished|Ced|Cing|Cs|3ra|5ct|7ed|9ed|9ing|9s|7ing|8on|Aed|Aing|As|7',
  's|5ed|5ing|5ordinaried|Es|Cy|5s|5vagant|Bed|Bing|Bs|4eme|7d|7lied|As|8y|7s|6ing|7st|9ed|9ing|9s|1ye|3brow|7ed|7ing|7s|3d',
  '|4ed|4ing|4s|3lashes|4ids|3s|2re|4d|4s|3ing|1zekiel|7ed|7ing|7s|2ra|4ed|4ing|4s|0fabian|6ed|6ing|6s|3le|5d|5s|4ing|3ric|',
  '6ated|8ion|Bed|Bing|Bs|6ed|6ing|6s|3ulous|8es|2cade|6d|6s|5ing|3e|4d|5ed|5ing|5s|4s|3ial|6ed|6ing|6s|4litate|Ad|As|9ing|',
  '7ied|9s|7y|4ng|6ed|6ing|6s|3t|4ed|4ing|5on|7ed|7ing|7s|4or|6ed|6ied|8s|7ng|6s|6y|4s|4ual|7ed|7ing|7s|3ultied|8s|6y|2de|4',
  'd|5ed|5ing|5s|4s|3ing|6ed|6ing|6s|2e|3d|3rie|6d|6s|5ing|3s|2il|4ed|4ing|7ed|7ing|7s|4s|4ure|7d|7s|6ing|3nt|5ed|5ing|5lie',
  'd|8s|6y|5s|3r|4ed|4ied|6s|5ng|4lied|7s|5y|4ness|8es|4s|4y|3th|5ed|5ful|8ed|8ing|8s|5ing|5s|2ke|4d|4s|3ing|2lcon|6ed|6ing',
  '|6s|3kland|8ed|8ing|8s|3l|4ed|5n|6ed|6ing|6s|4ing|7ed|7ing|7s|4s|3se|5d|5lied|8s|6y|5s|4ing|3tered|2m|3e|4d|4s|3iliar|8e',
  'd|8ing|9tied|Cs|Ay|8s|6ed|7s|5y|4ne|6d|6s|5g|5ing|3ous|6es|6lied|9s|7y|3s|2n|3cied|6s|4y|3g|4ed|4ing|4s|3nied|6s|4y|3s|3',
  't|4asia|8ed|8ing|8s|7ed|8s|6tic|9ed|9ing|9s|6y|4ed|4ing|4s|2r|3e|4d|4s|4well|8ed|8ing|8s|3ing|3m|4ed|5r|6ed|6ing|6s|4hou',
  'se|9d|9s|8ing|4ing|7ed|7ing|7s|4s|3ouk|6ed|6ing|6s|3s|3ther|7ed|7ing|7s|2scinated|Aed|Aing|As|8ing|Bed|Bing|Bs|9on|Bed|B',
  'ing|Bs|5sm|7ed|7ing|7s|6t|7ed|7ing|7s|3hion|7able|Bd|Bs|Aing|7ed|9ed|9ing|9s|7ing|7s|3t|4ed|5ned|5r|6ed|6ing|6s|5st|4ing',
  '|4s|2t|3al|5ed|5ing|6ties|5lied|8s|6y|5s|3e|4d|5ed|5ing|5s|4s|3her|6ed|6ing|6s|3igue|7d|7s|6ing|4ma|6ed|6ing|6s|4ng|3s|3',
  'tied|6s|4y|2ult|5ed|5ied|7s|6ng|5s|5y|3na|5ed|5ing|5s|3st|5ed|5ing|5s|2vor|5able|9d|9s|8ied|As|9ng|8y|5ed|7ed|7ing|7s|5i',
  'ng|6te|8d|8s|7ing|5s|4ur|6ite|9s|6s|2y|3s|1ear|4ed|6ed|6ing|6s|4ful|7ed|7ing|7s|4ing|4less|8es|4s|3sibilitied|Cs|Ay|6le|',
  '8d|8s|7ing|4t|5ed|5ing|5s|3t|4ed|4her|7ed|7ing|7s|7weight|Ded|Ding|Ds|4ing|4s|4ure|7d|8ed|8ing|8s|7s|6ing|2bruaried|9s|7',
  'y|2d|3eral|7ed|7ing|7lied|As|8y|7s|6tion|Aed|Aing|As|3s|2e|3d|4back|8ed|8ing|8s|4ed|5r|6ed|6ing|6s|4ing|7ed|7ing|7s|4s|3',
  'l|4ed|4ing|7ed|7ing|7s|4s|3s|2i|3s|2licitied|9s|7y|4x|5es|3l|4ed|4ing|4ow|6ed|6ing|6s|7hip|Aed|Aing|As|4s|3onied|7s|5y|3',
  't|4ed|4ing|4s|2male|6d|6s|5ing|3inine|8d|8s|7ing|6sm|8ed|8ing|8s|7t|8ed|8ing|8s|2n|3ce|5d|5s|4ing|7ed|7ing|7s|3der|6ed|6',
  'ing|6s|3s|2ral|5ed|5ing|5s|3gus|6es|6on|8ed|8ing|8s|3n|4ando|8ed|8ing|8s|4ed|4ing|4s|3ocious|9es|3rara|7ed|7ing|7s|4ied|',
  '6s|5s|4y|3til|6e|7d|7s|6ing|7tied|As|8y|6s|2st|4ed|4ing|5val|8ed|8ing|8s|6ities|4s|2t|3al|5ed|5ing|5s|3ch|5ed|6s|5ing|3s',
  '|2ud|4al|6ed|6ing|6s|4ed|4ing|4s|2ver|5ed|5ing|5s|2w|3er|5s|3s|2y|3s|1iance|6d|6e|7ed|7ing|7s|6s|5ing|3t|4ed|4ing|4s|2b|',
  '3er|5ed|5ing|5s|3s|2ction|7al|9ed|9ing|9s|7ed|7ing|7s|5tious|Aes|2ddle|6d|6s|5ing|3e|4d|4litied|9s|7y|4s|3ing|2eld|5ed|7',
  'ed|7ing|7s|6r|7ed|7ing|7s|5ing|5s|3rce|6d|6lied|9s|7y|6s|5ing|4ied|6s|4y|3sta|6ed|6ing|6s|2fe|4d|4s|3ing|3teen|7ed|7ing|',
  '7s|7th|9ed|9ing|9s|4h|5ed|5ing|5s|4ied|6s|4y|2g|3ht|5ed|6r|7ed|7ing|7s|5ing|8ed|8ing|8s|5s|3s|3urative|Ad|As|9ing|5e|6d|',
  '7ed|7ing|7s|6s|5ing|2ji|4ed|4ing|4s|2le|4d|4s|3ing|6ed|6ing|6s|4pino|8ed|8ing|8s|5po|7ed|7ing|7s|3l|4ed|6ed|6ing|6s|4ied',
  '|6s|5ng|7ed|7ing|7s|4s|4y|3m|4ed|4ing|4s|3ter|6ed|6ing|9ed|9ing|9s|6s|4hied|7s|5y|2n|3al|5e|6d|6s|5ing|6st|8ed|8ing|8s|6',
  'zed|5lied|8s|6y|5s|4nce|7d|7s|6ial|9ed|9ing|9lied|Cs|Ay|9s|7ng|3ch|5ed|6s|5ing|3d|4ed|4ing|7ed|7ing|7s|4s|3e|4d|4lied|7s',
  '|5y|4r|5ed|5ing|5s|4s|5t|3ger|6ed|8ed|8ing|8s|6ing|6nails|6prints|6s|6tips|3ing|4sh|6ed|8ed|8ing|8s|7s|6ing|9ed|9ing|9s|',
  '4te|6d|6s|5ing|3land|7ed|7ing|7s|3n|4ed|4ing|5sh|7ed|8s|7ing|4s|3s|2r|3e|4arm|7ed|7ing|7s|4d|5ed|5ing|5s|4place|9d|9s|8i',
  'ng|4s|4works|3ing|6ed|6ing|6s|3m|4ed|4ing|4lied|7s|5y|4s|3s|4t|5ed|5ing|5lied|8s|6y|5s|3th|5ed|5ing|5s|2scal|6ed|6ing|6s',
  '|3h|4ed|6ed|6ing|6s|5r|6ed|6ied|8s|7ng|6man|9ed|9ing|9s|6s|6y|5s|4ing|7ed|7ing|7s|3sion|7ed|7ing|7s|3t|4ed|6ed|6ing|6s|4',
  'ing|4s|2t|3ch|5ed|6s|5ing|3ness|7es|3s|3ted|6ed|6ing|6s|4ing|7ed|7ing|7s|3zroy|7s|2ve|4d|4s|3ing|2x|3ed|5ed|5ing|5s|4s|3',
  'ing|6ed|6ing|6s|3ture|7d|7s|6ing|1lag|4ed|4ing|4s|5hip|8ed|8ing|8s|3ir|5ed|5ing|5s|3me|5d|5s|4ing|7ed|7ing|7s|3nk|5ed|7e',
  'd|7ing|7s|5ing|8ed|8ing|8s|5s|3p|4ed|4ing|4s|3re|5d|5s|4ing|3sh|5ed|6s|5ing|8ed|8ing|8s|5light|Aed|Aing|As|3t|4ed|4ing|4',
  'lied|7s|5y|4s|4tened|3vor|6ed|6ing|6s|5ur|7ed|7ing|7s|3w|4ed|6ed|6ing|6s|4ing|4less|8es|4s|2ea|4ed|4ing|4s|3d|4ed|4ged|5',
  'ling|9ed|9ing|9s|4ing|4s|3e|4ed|4ing|4s|4t|5ed|5ing|8ed|8ing|8s|5s|3ming|7ed|7ing|7s|5sh|7ed|8s|7ing|3sh|5ed|6s|5ing|3tc',
  'her|8ed|8ing|8s|3w|4ed|4ing|4s|3x|4ed|6ed|6ing|6s|5s|4ibilitied|Cs|Ay|6le|8d|8s|7ing|2ick|5ed|6r|7ed|7ing|Aed|Aing|As|7s',
  '|5ing|5s|3ed|4s|3ght|6ed|6ing|6s|3nch|6ed|7s|6ing|4ders|4g|5ed|5ing|5s|4t|5ed|5ing|5s|3p|4ed|4ing|4s|3rt|5ed|5ing|8ed|8i',
  'ng|8s|5s|2o|3at|5ed|5ing|8ed|8ing|8s|5s|3ck|5ed|5ing|5s|3od|5ed|7ed|7ing|7s|5ing|8ed|8ing|8s|5s|4r|5ed|5ing|5s|3p|4ed|4i',
  'ng|4pied|7s|5y|4s|3ra|5ed|5ing|5l|6ed|6ing|6s|5s|4ence|8d|8s|7ing|5s|6es|4ia|6ed|6ing|6n|7ed|7ing|7s|6s|5da|7ed|7ing|7s|',
  '3s|3tilla|8ed|8ing|8s|3ur|5ed|5ing|6sh|8ed|9s|8ing|Bed|Bing|Bs|5s|3w|4ed|5r|6ed|6ing|9ed|9ing|9s|6s|4ing|7ed|7ing|7s|4n|',
  '5ed|5ing|5s|4s|3yd|5ed|5ing|5s|2u|3ctuations|3ent|6ed|6ing|6s|3ffied|7s|5y|3id|5ed|5ing|5s|3ng|5ed|5ing|5s|3orescent|Bed',
  '|Bing|Bs|3s|4h|5ed|6s|5ing|8ed|8ing|8s|3te|5d|5s|4ing|4ter|7ed|7ing|Aed|Aing|As|7s|3x|4es|2y|3er|5ed|5ing|5s|3ing|6ed|6i',
  'ng|6s|1oam|4ed|4ing|4s|2cal|5ed|5ing|5s|3us|5es|2e|3s|2g|3s|2il|4ed|4ing|4s|2ld|4ed|6ed|6ing|6s|5r|6ed|6ing|6s|4ing|7ed|',
  '7ing|7s|4s|3iage|7d|7s|6ing|3k|4ed|4ing|4lore|8d|8s|7ing|4s|3lied|6s|4ow|6ed|7r|8ed|8ing|8s|6ing|9ed|9ing|9s|6s|4y|2nd|4',
  'ed|4ing|4s|3t|4ed|4ing|4s|2o|3d|4ed|4ing|4s|3l|4ed|4ing|5sh|7ed|8s|7ing|4s|3s|3t|4age|7d|7s|6ing|4ball|8ed|9r|Aed|Aing|A',
  's|8ing|8s|4ed|6ed|6ing|6s|4hills|4ing|7ed|7ing|7s|4print|9ed|9ing|9s|4s|5teps|2r|3aging|3b|4ade|7d|7s|6ing|4ed|4id|6den|',
  '9ed|9ing|9s|6ed|6ing|6s|5ng|4s|3ce|5d|6ed|6ing|6s|5ful|8ed|8ing|8lied|Bs|9y|8s|5s|4iblied|9s|7y|5ng|7ed|7ing|7s|3d|4ed|4',
  'ing|4s|3e|4arm|7ed|7ing|7s|4cast|8ed|8ing|8s|4d|4front|9ed|9ing|9s|4head|8ed|8ing|8s|4ign|7ed|8r|9ed|9ing|9s|7ing|7s|4ma',
  'n|7ed|7ing|7s|5ost|8ed|8ing|8s|4nsic|8ed|8ing|8s|4runner|Aed|Aing|As|4s|5t|6ed|8ed|8ing|8s|6ing|6ried|9s|7y|6s|4ver|7ed|',
  '7ing|7s|4wings|5ord|8ed|8ing|8s|3ge|5d|6ed|6ing|6s|5s|5t|6ed|6ing|6s|6ting|Aed|Aing|As|4ing|5ve|7d|7ness|Bes|7s|6ing|4ot',
  '|6ed|6ing|6s|6ten|9ed|9ing|9s|3ing|3k|4ed|4ing|4s|3m|4al|6ed|6ing|6lied|9s|7y|6s|5t|6ed|6ing|7on|9ed|9ing|9s|6s|4ed|6ed|',
  '6ing|6s|5r|6ed|6ing|6lied|9s|7y|6s|4idable|Ad|As|9ing|5ng|7ed|7ing|7s|4s|4ula|7ed|7ing|7s|7ted|8ion|Bed|Bing|Bs|3s|4ter|',
  '7s|3t|4e|5d|5s|4h|5coming|Bed|Bing|Bs|5ed|5ing|5s|4ied|6s|5fication|Ded|Ding|Ds|7ed|5ng|4ress|8es|4s|4unate|9d|9lied|Cs|',
  'Ay|9s|8ing|6e|7d|7s|6ing|4y|3um|5ed|5ing|5s|3ward|7ed|7ing|7s|8es|2ssil|6ed|6ing|6s|3ter|6ed|6ing|6s|2ught|6ed|6ing|6s|3',
  'l|4ed|4ing|4s|3nd|5ation|Aed|Aing|As|5ed|6r|7ed|7ing|7s|5ing|8ed|8ing|8s|5ried|8s|6y|5s|4tain|8ed|8ing|8s|3r|4ed|4ing|4s',
  '|4teen|8ed|8ing|8s|8th|Aed|Aing|As|5h|6ed|6ing|6s|2wler|6ed|6ing|6s|2x|3es|2yer|5ed|5ing|5s|1ra|3ction|8ed|8ing|8s|5ure|',
  '8d|8s|7ing|3gile|7d|7s|6ing|4ment|8ation|Ded|Ding|Ds|8ed|Aed|Aing|As|8ing|8s|4rance|9d|9s|8ing|3il|5ed|5ing|5s|3m|4e|5d|',
  '6ed|6ing|6s|5s|5work|9ed|9ing|9s|4ing|7ed|7ing|7s|4s|3nc|5ed|6s|7es|5hise|9d|9s|8ing|5ing|6s|7can|Aed|Aing|As|8o|9ed|9in',
  'g|9s|7es|5o|6ed|6ing|7s|8es|6s|5s|4k|5ed|6nstein|Ced|Cing|Cs|5ing|6sh|8ed|9s|8ing|5lied|8s|7n|8ed|8ing|8s|6y|5s|4tic|7al',
  'lied|Cs|Ay|7ed|7ing|7s|3s|4er|6s|3ternitied|Bs|9y|3ud|5ed|5ing|5s|5ulent|Aed|Aing|As|3y|4s|2eak|5ed|5ing|5s|3d|4die|7d|7',
  's|6ing|5y|4ed|5r|6ic|8ed|8ing|8k|9ed|9ing|9s|8s|6s|4ing|4s|3e|4d|5ed|5ing|5om|7ed|7ing|7s|5s|4ed|4ing|7ed|7ing|7s|4lied|',
  '7s|5y|4man|7ed|7ing|7s|4s|4way|7s|4ze|6d|6s|5ing|8ed|8ing|8s|3ight|7ed|8r|9ed|9ing|9s|7ing|7s|3nch|6ed|7s|6ing|6man|9ed|',
  '9ing|9s|4zied|7s|5y|3quencied|As|8y|7t|8ed|8ing|8lied|Bs|9y|8s|3sco|6ed|6ing|6s|4h|5ed|6s|5ing|5lied|8s|6y|5man|8ed|8ing',
  '|8s|4no|6ed|6ing|6s|3yja|6ed|6ing|6s|2iar|5ed|5ing|5s|3ction|8ed|8ing|8s|3day|6s|3ed|5ed|5ing|5s|4nd|6ed|6ing|6lied|9s|7',
  'y|6s|7hip|Aed|Aing|As|4s|3gate|7d|7s|6ing|4ht|6ed|7ned|Aed|Aing|As|8ing|Bed|Bing|Bs|6ing|6s|3nge|6d|6s|5ing|3tz|5es|2o|3',
  'g|4ed|4ing|4s|3m|4ed|4ing|4s|3nt|5al|7ed|7ing|7s|5ed|7ed|7ing|7s|5ier|8ed|8ing|8s|6ng|5s|3s|4t|5ed|5ing|5s|3wn|5ed|5ing|',
  '8ed|8ing|8s|5s|3ze|5d|5n|6ed|6ing|6s|5s|4ing|2uit|5ed|5ing|5s|3strated|8ing|9on|Bed|Bing|Bs|2y|1uel|4ed|4ing|4s|2gitive|',
  '8d|8s|7ing|2ji|4ed|4ing|4s|2lfill|7ed|7ing|7ment|Bed|Bing|Bs|7s|3ham|6ed|6ing|6s|3l|4back|8ed|8ing|8s|4ed|5r|6ed|6ing|6s',
  '|4ied|6s|5ng|4s|4y|2mble|6d|6s|5ing|2n|3ction|8al|Aed|Aing|Btied|Es|Cy|As|8ed|8ing|8s|3d|4ament|9al|Bed|Bing|Blied|Es|Cy',
  '|Bs|9ed|9ing|9s|4ed|6ed|6ing|6s|4ing|4s|5es|3eral|7ed|7ing|7s|3gal|6ed|6ing|6s|4i|5ed|5ing|5s|4us|6es|3k|4ed|4ied|6s|5ng',
  '|4s|4y|3nel|6ed|6ing|6s|4ied|6s|4y|3s|2r|3ied|5s|4ous|7es|7lied|As|8y|3longs|3nace|7d|7s|6ing|4ished|9ed|9ing|9s|7ings|5',
  'ture|9d|9s|8ing|3ried|6s|4owed|4y|3s|3ther|7ed|7ing|7more|Bd|Bs|Aing|7s|3y|2scous|7es|3e|4d|5ed|5ing|5s|4lage|8d|8s|7ing',
  '|4s|3iliers|4ng|4on|6ed|6ing|6s|3s|4es|2t|3ile|6d|6s|5ing|3s|3ure|6d|6s|5ing|6stic|Aed|Aing|As|2zzied|6s|4y|0gab|3bied|6',
  's|4y|3e|4d|4s|3ing|3le|5d|5s|4ing|3riel|7ed|7ing|7s|3s|2d|3s|2el|4ed|4ic|6ed|6ing|6s|5ng|4s|2g|3e|4d|4s|3ing|3s|2il|4ed|',
  '4ing|4s|3n|4ed|5s|4ing|7ed|7ing|7s|4s|5es|2l|3a|4ctic|8ed|8ing|8s|4ed|4ing|4s|4xied|7s|5y|3e|4d|4n|5ed|5ing|5s|4s|3ician',
  '|8ed|8ing|8s|4lee|7ed|7ing|7s|4ng|3l|4ant|7ed|7ing|7ried|As|8y|7s|4ed|5ried|8s|6y|5y|6s|4ing|4on|6ed|6ing|6s|5way|8s|4s|',
  '3s|2m|3bia|6ed|6ing|6s|4le|6d|6s|5ing|8ed|8ing|8s|3e|4d|4r|5s|4s|3ing|6ed|6ing|6s|3ma|5ed|5ing|5s|3s|2n|3g|4a|5ed|5ing|5',
  's|4ed|4ing|4s|5ter|8ed|8ing|8s|3s|2p|3ed|3ing|6ed|6ing|6s|3s|2r|3age|6d|6s|5ing|3bage|7d|7s|6ing|3den|6ed|7r|8ed|8ing|8s',
  '|6ing|9ed|9ing|9s|6s|3ied|5s|3land|7ed|7ing|7s|4ic|6ed|6ing|6s|3ment|7ed|7ing|7s|3ner|6ed|6ing|6s|3rison|8ed|8ing|8s|3s|',
  '3th|5ed|5ing|5s|3y|2s|3es|3oline|8d|8s|7ing|3p|4ed|4ing|7ed|7ing|7s|4s|3t|4ed|4ing|4ropod|9ed|9ing|9s|4s|2te|4d|4s|4way|',
  '7s|3her|6ed|6ing|9ed|9ing|9s|6s|3ing|2u|3ge|5d|5s|4ing|3l|4ed|4ing|4s|3nt|5ed|5ing|5s|3s|2ve|4d|4s|3ing|2y|3s|2z|3e|4d|4',
  's|4tte|7d|7s|6ing|3ing|6ed|6ing|6s|1ear|4box|7es|4ed|6ed|6ing|6s|4ing|4s|2e|3k|4ed|4ing|4s|3s|4e|5d|5s|4ing|2l|3s|2m|3in',
  'i|6ed|6ing|6s|3ma|5ed|5ing|5s|3s|2n|3der|6ed|6ing|6s|3e|4alogical|Ced|Cing|Cs|9ed|As|8y|4d|4r|5a|6ed|6ing|6l|7ed|7ing|8z',
  'ed|Bed|Bing|Bs|7lied|As|8y|7s|6s|6te|8d|8s|7ing|Aed|Aing|As|8on|Aed|Aing|As|7or|9ed|9ing|9s|5ic|7ed|7ing|7s|5ositied|Bs|',
  '9y|6us|8es|5s|4s|5is|7es|4tic|7allied|Cs|Ay|7ed|7ing|7s|8es|4va|6ed|6ing|6s|5ieve|9d|9s|8ing|3ie|5d|5s|4ing|4ng|4us|6es|',
  '3oa|5ed|5ing|5s|4cide|8d|8s|7ing|4me|6d|6s|5ing|3re|5d|5s|4ing|3s|3tle|6d|6man|9ed|9ing|9s|6s|5ied|7s|6ng|5y|4ried|7s|5y',
  '|3uine|7d|7lied|As|8y|7s|6ing|4s|5es|2o|3ff|5ed|5ing|5rey|8s|5s|3graphic|Aal|Ced|Cing|Clied|Fs|Dy|Cs|Aed|Aing|As|9ed|As|',
  '8y|3logic|8al|Aed|Aing|As|8ed|8ing|8s|7ed|8s|7st|9ed|9ing|9s|6y|3metric|9ed|9ing|9s|8dae|Bd|Bs|Aing|8ed|9s|7y|3rge|6d|6s',
  '|5ia|7ed|7ing|7n|8ed|8ing|8s|7s|6e|7d|7s|6ing|6ng|3s|2r|3ald|6ed|6ine|9d|9s|8g|8ing|6s|4rd|6ed|6ing|6s|3m|4an|6ed|6ic|8e',
  'd|8ing|8s|7ng|6s|4ed|4ing|4s|3s|3trude|8d|8s|7ing|2st|4apo|7ed|7ing|7s|4ed|4ing|4s|4ure|7d|7s|6ing|2t|3s|3ting|7ed|7ing|',
  '7s|1hent|5ed|5ing|5s|3tto|6ed|6ing|6s|2ost|5ed|5ing|5lied|8s|6y|5s|1iant|5ed|5ing|5s|2b|3bons|3raltar|9ed|9ing|9s|3s|4on',
  '|6ed|6ing|6s|2deon|6ed|6ing|6s|2f|3s|3t|4ed|6ed|6ing|6s|4ing|4s|2g|3antic|8ed|8ing|8s|3gle|6d|6s|5ing|8ed|8ing|8s|3i|4ed',
  '|4ing|4s|3s|2l|3bert|7ed|7ing|7s|3ded|6ed|6ing|6s|3es|5es|3l|4ed|5s|6es|4ian|7ed|7ing|7s|5ng|4s|3s|2n|3ger|6ed|6ing|6lie',
  'd|9s|7y|6s|3nied|6s|4y|3s|2ovanni|8ed|8ing|8s|2rl|4ed|4ing|4s|3o|4ed|4ing|4s|2t|3s|2useppe|8d|8s|7ing|2ve|4d|4n|5ed|5ing',
  '|5s|4s|3ing|6ed|6ing|6s|1lacial|7ed|7ing|7s|5er|7ed|7ing|7s|3d|4ed|4ing|4lied|7s|5y|4s|5tone|9d|9s|8ing|4ys|6es|3mour|7e',
  'd|7ing|7s|3nce|6d|6s|5ing|8ed|8ing|8s|4d|5ed|5ing|5s|3re|5d|5s|4ing|7ed|7ing|7s|3ss|5es|7es|3zed|6ed|6ing|6s|2eam|5ed|5i',
  'ng|8ed|8ing|8s|5s|3e|4ed|4ing|4s|3n|4ed|4ing|4n|5ed|5ing|5s|4s|2ide|5d|5r|6ed|6ing|6s|5s|4ing|7ed|7ing|7s|3mpse|7d|7s|6i',
  'ng|3nt|5ed|5ing|5s|3stening|Aed|Aing|As|3tter|7ed|7ing|Aed|Aing|As|7s|2obal|6ed|6ing|6lied|9s|7y|6s|4e|5d|5s|4ing|3om|5e',
  'd|5ing|5s|3ria|6ed|6ing|6s|5ed|6s|5ous|8es|4y|3ss|5es|5ied|7s|5y|3ucester|Aed|Aing|As|3ve|5d|5r|6ed|6ing|6s|5s|4ing|3w|4',
  'ed|4ing|7ed|7ing|7s|4s|2ucose|7d|7s|6ing|3e|4d|5ed|5ing|5s|4s|3ing|3ten|6ed|6ing|6s|2ynn|5ed|5ing|5s|1nome|5d|5s|4ing|2u',
  '|3s|1o|2a|3l|4ed|4ing|4keeper|Aed|Aing|As|4s|3s|3t|4ed|4ing|4s|2b|3lin|6ed|6ing|6s|3s|2d|3dard|7ed|7ing|7s|4ess|7es|3fat',
  'her|9ed|9ing|9s|4rey|7s|3s|2es|4es|2ing|5ed|5ing|5s|2ld|4ed|5n|6ed|6ing|6s|4ing|4s|5mith|9ed|9ing|9s|3f|4ed|5r|6ed|6ing|',
  '6s|4ing|4s|2ne|4d|4s|3g|4ed|4ing|4s|3ing|2o|3d|4ed|4ing|4man|7ed|7ing|7s|4ness|8es|4s|5es|4will|8ed|8ing|8s|3fied|6s|4y|',
  '3s|4e|5d|5s|4ing|2r|3a|4ed|4ing|4n|5ed|5ing|5s|4s|3don|6ed|6ing|6s|3e|4d|4s|3ge|5d|5ous|8es|5s|4ing|3illa|7ed|7ing|7s|4n',
  'g|3s|2spel|6ed|6ing|6s|3sip|6ed|6ing|6s|2t|3h|4am|6ed|6ing|6s|4ed|4ic|6ed|6ing|6s|5ng|4s|3s|3ten|6ed|6ing|6s|4fried|9ed|',
  '9ing|9s|2vern|6ance|Ad|As|9ing|6ed|6ing|9ed|9ing|9s|6ment|Aal|Ced|Cing|Cs|Aed|Aing|As|6or|8ate|Bd|Bs|Aing|8ed|8ing|8s|6s',
  '|2wn|4ed|4ing|4s|1ra|3b|4ed|4ing|4s|3ce|5d|5ful|8ed|8ing|8lied|Bs|9y|8s|5s|4ing|3d|4e|5d|6ed|6ing|6s|5rs|5s|4ient|8ed|8i',
  'ng|8s|5ng|7ed|7ing|7s|4s|4ual|7ed|7ing|7lied|As|8y|7s|6te|8d|9ed|9ing|9s|8s|7ing|Aed|Aing|As|8on|Aed|Aing|As|3eme|6d|6s|',
  '5ing|3ham|6ed|6ing|6s|3in|5ed|5ing|5s|3m|4ed|4ing|4mar|7ed|7ing|7s|6tical|Bed|Bing|Bs|4s|3nada|7ed|7ing|7s|4d|5daughter|',
  'Ded|Ding|Ds|5ed|5father|Bed|Bing|Bs|5ing|5ma|7ed|7ing|7s|6other|Bed|Bing|Bs|5pa|7ed|7ing|7rents|7s|5s|6on|8ed|8ing|8s|4g',
  'e|6d|6s|5ing|4ite|7d|7s|6ing|4nied|7s|5y|4t|5ed|5ing|5s|4ville|9d|9s|8ing|3pe|5d|5s|4h|5ed|5ic|7al|9ed|9ing|9s|7ed|7ing|',
  '7s|8es|6ng|5s|4ing|3s|4p|5ed|5ing|8ed|8ing|8s|5s|4s|5es|5ied|7s|5land|9ed|9ing|9s|5y|3t|4ed|5ful|8ed|8ing|8s|4ing|5tude|',
  '9d|9s|8ing|4s|3ve|5d|5l|6ed|6ied|8s|7ng|6s|6y|5s|6es|5yard|9ed|9ing|9s|4ing|5tational|Ded|Ding|Ds|6ied|8s|6y|3y|4s|3zed|',
  '4ing|7ed|7ing|7s|2ease|6d|6s|5ied|7s|6ng|5y|4t|5ed|6r|7ed|7ing|7s|6st|5ing|5lied|8s|6y|5s|4ves|7es|3e|4d|5ed|5ied|7s|6ng',
  '|5s|5y|4ed|4ing|4k|5ed|5ing|5s|4n|5ed|5house|Ad|As|9ing|5ing|6sh|8ed|9s|8ing|5land|9ed|9ing|9s|5s|5wich|9ed|As|9ing|6ood',
  '|9ed|9ing|9s|4r|5s|4s|4t|5ed|5ing|8ed|8ing|8s|5s|3g|4ed|4g|5e|6d|6s|5ing|5s|4ing|4or|6ed|6ian|9ed|9ing|9s|7ed|8s|7ng|6s|',
  '6y|4s|3nade|7d|7s|6ing|3ta|5ed|5ing|5s|4chen|8ed|8ing|8s|3w|4ed|4ing|4s|3y|4hound|9ed|9ing|9s|4s|2id|4ed|4ing|4s|3ef|5ed',
  '|5ing|5s|3ff|5ed|5in|7ed|7g|7ing|7s|6th|8ed|8ing|8s|5s|3ll|5e|6d|6s|5ing|5s|3m|4ace|7d|7s|6ing|4ed|5s|4ing|4lied|7s|5y|4',
  's|3n|4d|5ed|5ing|8ed|8ing|8s|5s|4ed|4ing|4ning|8ed|8ing|8s|4s|3p|4ed|4ing|4ped|5ing|8ed|8ing|8s|4s|3t|4ed|4ing|4s|2oan|5',
  'ed|5ing|8ed|8ing|8s|5s|3ceried|8s|6y|3in|5ed|5ing|5s|3om|5ed|5ing|5s|4ve|6d|6s|5ing|3ss|5es|3tesque|9d|9s|8ing|3und|6ed|',
  '8ed|8ing|8s|6ing|6s|7es|4p|5ed|7ed|7ing|7s|5ing|8ed|8ing|8s|5s|3ve|5d|5r|6s|5s|4ing|3w|4ed|4ing|7ed|7ing|7s|4l|5ed|5ing|',
  '8ed|8ing|8s|5s|4n|5ed|5ing|5s|4s|5es|4th|6ed|6ing|6s|2uff|5ed|5ing|5s|3mbled|3nt|5ed|5ing|5s|1uarantee|9ed|9ing|9s|4d|5e',
  'd|7ed|7ing|7s|5ian|8ed|8ing|8s|6ng|8ed|8ing|8s|5s|2bernatorial|Ded|Ding|Ds|2ernsey|8s|4rilla|9ed|9ing|9s|3ss|5es|5ing|8e',
  'd|8ing|8s|4t|5ed|5ing|5s|2iana|6ed|6ing|6s|3dance|8d|8s|7ing|4e|5d|5lines|5s|4ing|4o|5ed|5ing|5s|3ld|5ed|5ing|5s|4lermo|',
  '9ed|9ing|9s|4t|5ed|5ied|7s|6ng|5s|5y|3nea|6ed|6ing|6s|3se|5d|5s|4ing|3tar|6ed|6ing|7st|9ed|9ing|9s|6s|2jarat|7i|8ed|8ing',
  '|8s|2lf|4ed|4ing|4s|3p|4ed|4ing|4s|2m|3s|2n|3fire|7d|7s|6ing|3nar|6ed|6ing|6s|4er|6ed|6ied|8s|7ng|6s|6y|3powder|9ed|9ing',
  '|9s|3s|4hot|7ed|7ing|7s|3ter|6ed|6ing|6s|4her|7ed|7ing|7s|2ru|4ed|4ing|4s|2s|3es|3t|4ed|4ing|4s|2t|3s|2y|3s|1wen|4ed|4in',
  'g|4s|1ym|3nasium|9ed|9ing|9s|6t|7ed|7ics|Aes|8ng|7s|3s|2psied|6s|4y|0habit|5at|7ed|7ing|7s|5ed|5ing|5s|2ck|4ed|6ed|6ing|',
  '6s|5r|6ed|6ing|6s|4ing|7ed|7ing|7s|4ney|7s|4s|2d|3es|5es|3s|2g|3gard|7ed|7ing|7s|3s|2il|4ed|4ing|4s|3r|4ed|6ed|6ing|6s|4',
  'ied|6s|5ng|4s|4y|3tian|7ed|7ing|7s|2l|3e|4d|4s|3f|4ed|4ing|4s|4way|7s|3ing|3l|4ed|4ing|4mark|8ed|8ing|8s|4ow|6ed|7en|9ed',
  '|9ing|9s|6ing|6s|4s|4way|7s|3o|4ed|4ing|4s|3s|3t|4ed|4ing|4s|3ves|6es|2m|3burger|9ed|9ing|9s|3ilton|8ed|8ing|8s|3let|6ed',
  '|6ing|6s|3mer|6ed|6ing|9ed|9ing|9s|6s|7mith|Bed|Bing|Bs|3pered|4shire|9d|9s|8ing|3s|2n|3d|4ball|8ed|8ing|8s|5ook|8ed|8in',
  'g|8s|4cuffs|4ed|6ed|6ing|6s|4ful|7ed|7ing|7s|4gun|7ed|7ing|7s|4icap|8ed|8ing|8ped|Bed|Bing|Bs|8s|5ed|6s|5ng|4kerchief|Ce',
  'd|Cing|Cs|4le|6d|7ed|7ing|7s|6r|7ed|7ing|7s|6s|5ing|8ed|8ing|8s|4s|5ome|8d|8s|7ing|4writing|Bed|Bing|Bs|4y|3gar|6ed|6ing',
  '|6s|4ed|4ing|7ed|7ing|7s|4ul|6ed|6ing|6s|3k|4ed|4ing|4s|3na|5ed|5ing|5s|4ibal|8ed|8ing|8s|3s|4es|2ppen|6ed|6ing|9ed|9ing',
  '|9s|6s|4ied|6r|7ed|7ing|7s|6s|5lied|8s|6y|5ness|9es|4y|2rass|6es|6ment|Aed|Aing|As|3bor|6ed|6ing|6s|3d|4ed|5n|6ed|6ing|6',
  's|5r|6ed|6ing|6s|5st|4ied|6s|5ng|4lied|7s|5y|4ness|8es|4s|5hip|8ed|8ing|8s|4ware|8d|8s|7ing|5ood|8ed|8ing|8s|4y|3e|4d|4s',
  '|3ing|3m|4ed|4ful|7ed|7ing|7s|4ing|4less|8es|4on|6ed|6ic|8a|9ed|9ing|9s|8ed|8ing|8s|7ed|8s|7ng|6s|6y|4s|3ness|7es|3old|6',
  'ed|6ing|6s|3p|4ed|5r|6ed|6ing|6s|4ing|4s|5ichord|Bed|Bing|Bs|3ried|6s|5s|6es|4ow|6ed|6ing|6s|4y|3sh|5ed|6s|5ing|5lied|8s',
  '|6y|3t|4ed|4ing|4mann|8ed|8ing|8s|4s|3v|4ard|7ed|7ing|7s|4ed|5st|7ed|7ing|7s|5y|6s|4ing|4s|2san|5ed|5ing|5s|3h|4ed|5s|4i',
  'ng|3te|5d|5s|4ied|6s|5lied|8s|6y|5ng|7s|8es|4y|2t|3ch|5ed|6s|5ing|3e|4d|4s|3ing|3red|6ed|6ing|6s|3s|2ul|4ed|4ing|4s|3nt|',
  '5ed|7ed|7ing|7s|5ing|5s|2vana|6ed|6ing|6s|3e|4d|4n|5ed|5ing|5s|4s|3ing|3oc|5ed|5ing|5s|2w|3aiian|8ed|8ing|8s|3k|4ed|5r|6',
  'ed|6ing|6s|4ing|4s|3s|3thorn|8ed|8ing|8s|2y|3s|3ward|7ed|7ing|7s|2zard|6ed|6ing|6ous|9es|6s|3e|4d|4l|5ed|5ing|5s|4s|3ied',
  '|5s|4ng|3y|1e|2ad|4ache|8d|8s|7ing|4ed|6ed|6ing|6s|5r|6ed|6ing|6s|4ing|7ed|7ing|7s|4lights|6ne|8d|8s|7ing|4master|Aed|Ai',
  'ng|As|4quartered|Bs|Ces|4s|4waters|3l|4ed|5r|6ed|6ing|6s|4ing|7ed|7ing|7s|4s|4th|6ed|6ied|8s|7ng|6s|6y|3p|4ed|4ing|4s|3r',
  '|4ed|4ing|7ed|7ing|7s|4s|5es|5t|6ed|6ing|6s|4t|5beat|9ed|9ing|9s|6reak|Aed|Aing|As|5ed|7ed|7ing|7s|5h|6ed|6ing|6s|5ing|5',
  'land|9ed|9ing|9s|5s|6es|3t|4ed|4h|5ed|6r|7ed|7ing|7s|5ing|5s|4ing|7ed|7ing|7s|4s|3ved|5n|6ed|6ing|6lied|9s|7y|6s|7es|4ie',
  'd|6r|6s|7t|5lied|8s|6y|5ng|7ed|7ing|7s|4y|5weight|Bed|Bing|Bs|2brew|6ed|6ing|6s|2ck|4ed|4ing|4s|3tare|7d|7s|6ing|4or|6ed',
  '|6ing|6s|2dge|5d|5s|4ing|2el|4ed|4ing|4s|2idi|5ed|5ing|5s|3ght|6ed|7ned|6ing|6s|3n|4ed|4ing|4rich|8ed|9s|8ing|4s|4z|5es|',
  '3r|4ed|5ss|7es|4ing|4s|2len|5a|6ed|6ing|6s|5ed|5ing|5s|3ge|5d|5s|4ing|3icopter|Aed|Aing|As|4um|6ed|6ing|6s|4x|5es|3l|4ed',
  '|5nic|8ed|8ing|8s|7stic|Bed|Bing|Bs|5r|6ed|6ing|6s|4ing|4o|5ed|5ing|5s|4s|3m|4ed|5t|6ed|6ing|6s|4ing|4s|3p|4ed|4ful|7ed|',
  '7ing|7s|4ing|7ed|7ing|7s|4less|8es|8lied|Bs|9y|4s|2m|3isphere|Ad|As|9ing|3s|2n|3ce|5d|5s|4ing|3d|4ed|4ing|4s|3ried|6s|6t',
  'ta|9ed|9ing|9s|4y|3s|2patitis|9es|2r|3ald|6ed|6ic|8ed|8ing|8s|7ng|6s|3b|4al|6ed|6ing|6s|4ed|5rt|7ed|7ing|7s|4ing|4s|3cul',
  'es|8es|3d|4ed|4ing|4s|3e|4d|5itaried|Bs|9y|4ford|8ed|8ing|8s|4s|5ied|7s|5y|3ing|4tage|8d|8s|7ing|3man|6ed|6ing|6s|4es|6e',
  's|4ione|8d|8s|7ing|5t|6age|9d|9s|8ing|6ed|6ing|6s|3o|4ed|4ic|6ed|6ing|6s|5n|6e|7d|7s|6g|6ing|6s|5sm|7ed|7ing|7s|4n|5ed|5',
  'ing|5s|4s|3ring|7ed|7ing|7s|3s|4elf|7ed|7ing|7s|5s|3ve|5d|5s|4ing|2sitant|8ed|8ing|8lied|Bs|9y|8s|6te|8d|8s|7ing|8on|Aed',
  '|Aing|As|2t|3er|5osexual|Ced|Cing|Cs|5s|3s|2x|3es|2y|3s|1i|2atus|6es|2ckoried|8s|6y|4s|2d|3algo|7ed|7ing|7s|3den|6ed|6in',
  'g|6s|3e|4d|4ous|7es|4s|3ing|3s|2enz|5es|3r|4archical|Ced|Cing|Cs|9ed|As|8y|4s|2gh|4ed|5r|6ed|6ing|6s|5st|7ed|7ing|7s|4in',
  'g|4land|8ed|9rs|8ing|8s|5ied|7s|6ght|9ed|9ing|9s|5y|4ness|8es|4s|4way|7s|2ke|4d|4s|3ing|2laried|7s|6ous|9es|5y|3da|5ed|5',
  'ing|5s|3l|4aried|8s|6y|4ed|5l|6ed|6ing|6s|4ied|6s|5ng|4s|5ide|8d|8s|7ing|4top|7ed|7ing|7s|4y|3t|4ed|4ing|4s|2m|3alaya|8e',
  'd|8ing|8n|9ed|9ing|9s|8s|4wan|7ed|7ing|7s|3s|4elf|7ed|7ing|7s|2nd|4ed|4i|5ed|5ing|5ng|5s|4s|4u|5ed|5ing|6sm|8ed|8ing|8s|',
  '5s|3ges|3t|4ed|4ing|4s|2p|3s|2ram|5ed|5ing|5s|3e|4d|5ed|5ing|5s|4s|3ing|3ofumi|8ed|8ing|8s|4toshi|9ed|9ing|9s|4yuki|8ed|',
  '8ing|8s|2s|3es|3panic|8ed|8ing|8s|3s|4es|4ing|7ed|7ing|7s|3t|4ed|4ing|4orian|9ed|9ing|9s|7c|8al|Aed|Aing|Alied|Ds|By|As|',
  '8ed|8ing|8s|7ed|8s|6y|4s|2t|3ch|5ed|6s|5ing|3oshi|7ed|7ing|7s|3s|3ter|6ed|6ing|6s|2ve|4d|4s|3ing|1oarse|6d|6s|5ing|3x|4e',
  's|2b|3bied|6s|4y|3s|2ckey|6s|2g|3an|5ed|5ing|5s|3s|2hn|4ed|4ing|4s|2isted|2ld|4ed|5n|6ed|6ing|6s|5r|6ed|6ing|6s|4ing|7ed',
  '|7ing|7s|4s|3e|4d|4s|3iday|7s|4ed|5s|4ness|8es|5g|3l|4and|7ed|7ing|7s|4ed|4ied|6s|5ng|4ow|6ed|6ing|6s|4s|4y|5wood|9ed|9i',
  'ng|9s|3m|4ed|4ing|4s|3ocaust|9ed|9ing|9s|3stein|8ed|8ing|8s|6r|7ed|7ing|7s|3t|4ed|4ing|4s|3y|2mage|6d|6s|5ing|3e|4d|4lan',
  'd|8ed|8ing|8s|5ess|8es|4made|8d|8s|7ing|4r|5ed|5ing|5s|4s|5tead|9ed|9ing|9s|4work|8ed|8ing|8s|3icide|8d|8s|7ing|4ng|3o|4',
  'ed|4geneous|Bes|4ing|4s|5exual|Aed|Aing|Btied|Es|Cy|As|2n|3da|5ed|5ing|5s|3est|6ed|6ied|8s|7ng|6lied|9s|7y|6s|6y|4y|5moo',
  'n|9ed|9ing|9s|5s|3g|4ed|4ing|4s|3or|5able|9d|9s|8ing|6ried|9s|7y|5ed|5ing|5s|4ur|6ed|6s|3s|3zo|5ed|5ing|5s|2od|4ed|6ed|6',
  'ing|6s|4ing|4s|3k|4ed|6ed|6ing|6s|5r|6ed|6ing|6s|4ing|4s|3p|4ed|5r|6ed|6ing|6s|4ing|4s|3ver|6s|5s|2p|3e|4d|5ed|5ing|5s|4',
  'ful|7ed|7ing|7lied|As|8y|7s|4less|8es|4s|3ing|3ped|6ed|6ing|6s|5r|6ed|6ing|6s|3s|2ratio|7ed|7ing|7s|3de|5d|5s|4ing|3izon',
  '|7ed|7ing|7s|7tal|Aed|Aing|Alied|Ds|By|As|3mone|7d|7s|6ing|3n|4ed|6ed|6ing|6s|5t|6ed|6ing|6s|4ing|4s|3rible|8d|8s|7ied|9',
  's|8ng|7y|5fic|8ed|8ing|8s|7ed|4or|6ed|6ing|6s|3se|5back|9ed|9ing|9s|5d|5power|Aed|Aing|As|5s|6hoe|9ed|9ing|9s|4ing|4t|5e',
  'd|5ing|5s|3ticultural|Ded|Ding|Ds|2se|4d|4s|3ing|3pice|7d|7s|6ing|5tal|8ed|8ing|9tied|Cs|Ay|9zed|8s|3t|4age|7d|7s|6ing|4',
  'ed|5l|6ed|6ing|6s|5ss|7es|4ile|7d|7s|6ing|7tied|As|8y|5ng|7ed|7ing|7s|4s|2t|3el|5ed|5ing|5s|3s|4pur|7ed|7ing|7s|3ta|5ed|',
  '5ing|5s|4er|6ed|6ing|6s|2ughton|8ed|8ing|8s|3nd|5ed|5ing|5s|3r|4ed|4ing|4lied|7s|5y|4s|3se|5d|5hold|9ed|Ar|Bed|Bing|Bs|9',
  'ing|9s|5keeper|Bed|Bing|Bs|5mates|5s|4ing|7ed|7ing|7s|2ve|4d|4r|5ed|5ing|8ed|8ing|8s|5s|4s|3ing|2w|3ard|6ed|6ing|6s|3e|4',
  'd|4s|4ver|7ed|7ing|7s|3ing|3l|4ed|4ing|7ed|7ing|7s|4s|3s|1si|3s|2uan|5ed|5ing|5s|1uashi|6ed|6ing|6s|2b|3ert|6ed|6ing|6s|',
  '3s|2d|3dled|3s|2e|3d|3s|3y|4s|2ff|4ed|4ing|4s|2g|3e|4d|4lied|7s|5y|4s|3ging|7ed|7ing|7s|3h|4ed|5s|6es|4ing|4s|3ing|3o|4e',
  'd|4ing|4s|3s|2h|3s|2i|3s|2lk|4ed|4ing|4s|3l|4ed|4ing|4s|2m|3an|5e|6d|6s|5ing|6st|8ed|8ing|8s|6tarian|Ced|Cing|Cs|7ied|9s',
  '|7y|5oid|8ed|8ing|8s|5s|3ble|6d|6s|5ing|3e|4d|4s|3id|5ed|5ing|6tied|9s|7y|5s|4liated|8ing|Bed|Bing|Bs|9on|Bed|Bing|Bs|4n',
  'g|3ming|7ed|7ing|7s|3or|5ed|5ing|5ous|8es|5s|3phrey|8s|3s|2n|3ched|3dred|7ed|7ing|7s|3g|4arian|9ed|9ing|9s|4ed|5r|6ed|6i',
  'ng|6s|4ing|4ried|7s|5y|4s|3s|3t|4ed|5r|6ed|6ing|6s|4ing|7ed|7ing|7s|4s|2rdle|6d|6s|5ing|3f|4ed|4ing|4s|3led|6ed|6ing|6s|',
  '5y|6s|4ing|7ed|7ing|7s|3on|5ed|5ing|5s|3ricane|9d|9s|8ing|5ed|7ed|7ing|7lied|As|8y|7s|6s|4y|3st|5ed|5ing|5s|3t|4ed|4ing|',
  '7ed|7ing|7s|4s|2sband|7ed|7ing|7s|3h|4ed|5s|4ing|3kied|6s|4y|2t|3s|1wa|3s|1ybrid|6ed|6ing|6s|2derabad|3ra|5ed|5ing|5s|5u',
  'lic|9ed|9ing|9s|4o|5ed|6lectric|Ded|Ding|Ds|5gen|8ed|8ing|8s|5ing|5s|2giene|7d|7s|6ing|2mn|4ed|4ing|4s|2p|3er|5ed|5ing|5',
  's|3notic|8ed|8ing|8s|3othesis|Aes|7tical|Ced|Cing|Cs|3s|2steria|8ed|8ing|8s|7cal|Aed|Aing|As|0ian|3s|1berian|7ed|7ing|7s',
  '|1ce|3d|4ed|4ing|4s|3land|7ed|7ic|9ed|9ing|9s|8ng|7s|3s|2h|3es|2ied|4s|2on|4ed|4ic|6ed|6ing|6s|5ng|4s|2y|1da|3ho|5ed|5in',
  'g|5s|3s|2e|3a|4ed|4ing|4l|5ed|5ing|5lied|8s|6y|5s|4s|3d|3ntical|9ed|9ing|9s|6fiable|Cd|Cs|Bing|8cation|Eed|Eing|Es|8ed|9',
  's|7y|6tied|9s|7y|3ological|Bed|Bing|Bs|8ed|9s|7y|3s|2iot|5ed|5ing|5s|2le|4d|4s|3ing|2ol|4ed|4ing|4s|1f|1gnatius|8es|3ite',
  'd|5ion|8ed|8ing|8s|3orance|9d|9s|8ing|7t|8ed|8ing|8s|5e|6d|6s|5ing|1ke|3d|3s|1ll|3egal|7ed|7ing|7lied|As|8y|7s|5itimate|',
  'Cd|Cs|Bing|3icit|7ed|7ing|7s|4nois|8es|3ness|7es|3s|3uminated|Bed|Bing|Bs|9ing|Ced|Cing|Cs|Aon|Ced|Cing|Cs|4sion|8ed|8in',
  'g|8s|5trate|Ad|As|9ing|Aon|Ced|Cing|Cs|9or|Bed|Bing|Bs|7ious|Bes|2ya|4ed|4ing|4s|1ma|3ge|5d|5ried|8s|6y|5s|4inaried|As|8',
  'y|7tion|Bed|Bing|Bs|9ve|Bd|Bs|Aing|6e|7d|7s|6g|6ing|3m|4ed|4ing|4s|3s|2itation|9ed|9ing|9s|2maculate|Ad|As|9ing|4ture|8d',
  '|8s|7ing|3ediate|9d|9lied|Cs|Ay|9s|8ing|4nse|7d|7lied|As|8y|7s|6ing|4rsed|6ion|9ed|9ing|9s|3igrant|9ed|9ing|9s|7ted|8ion',
  '|Bed|Bing|Bs|4nent|8ed|8ing|8s|3ortal|8ed|8ing|9tied|Cs|Ay|8s|3une|6d|6s|5ing|6tied|9s|7y|2p|3act|6ed|8ed|8ing|8s|6ing|6',
  's|4ir|6ed|6ing|6ment|Aed|Aing|As|6s|4tience|Ad|As|9ing|8t|9ed|9ing|9lied|Cs|Ay|9s|3ending|9ed|9ing|9s|4r|5ative|Ad|As|9i',
  'ng|5fect|9ed|9ing|9s|5ial|8ed|8ing|9sm|Bed|Bing|Bs|8s|5s|4tus|7es|3lant|7ed|7ing|7s|4ement|9ation|Eed|Eing|Es|9ed|9ing|9',
  's|4icated|8ion|Bed|Bing|Bs|6it|8ed|8ing|8s|5ed|6s|4y|3ort|6ance|Ad|As|9ing|8t|9ed|9ing|9lied|Cs|Ay|9s|6ed|6ing|6s|4se|6d',
  '|6s|5ing|8ed|8ing|8s|5sible|Ad|As|9ing|4verished|3ress|7es|7ion|Aed|Aing|As|8ve|Ad|As|9ing|4int|7ed|7ing|7s|5son|8ed|8in',
  'g|8ment|Ced|Cing|Cs|8s|4omptu|9ed|9ing|9s|5per|8ed|8ing|8s|5ve|7d|7ment|Bed|Bing|Bs|7s|6ing|9ed|9ing|9s|7sation|Ded|Ding',
  '|Ds|8ed|3s|3ulse|7d|7s|6ing|1n|2abilitied|As|8y|3ccessible|Cd|Cs|Bing|5urate|Ad|As|9ing|4tivated|7e|8d|8s|7ing|3dequate|',
  'Ad|As|9ing|4vertentlied|Es|Cy|3ppropriate|Dd|Ds|Cing|3ugural|9ed|9ing|9s|8ted|9ion|Ced|Cing|Cs|2ca|4ed|4ing|4pable|9d|9s',
  '|8ing|4rcerated|5nation|Bed|Bing|Bs|4s|3ense|7d|7s|6ing|5tive|9d|9s|8ing|4ption|9ed|9ing|9s|3h|4ed|6ed|6ing|6s|5s|4ing|3',
  'idence|9d|9s|8ing|7t|8ed|8ing|8s|3lination|Bed|Bing|Bs|6e|7d|7s|6ing|4ude|7d|8ed|8ing|8s|7s|6ing|5sion|9ed|9ing|9s|7ve|9',
  'd|9s|8ing|3ome|6d|6s|5ing|8ed|8ing|8s|5patible|Cd|Cs|Bing|6lete|Ad|As|9ing|4nsistent|Ced|Cing|Cs|4rporate|Bd|Ced|Cing|Cs',
  '|Bs|Aing|Bon|Ded|Ding|Ds|5rect|9ed|9ing|9lied|Cs|Ay|9s|3rease|8d|8s|7ing|Aed|Aing|Alied|Ds|By|As|5dible|Ad|As|9ied|Bs|An',
  'g|9y|5ment|9ed|9ing|9s|3umbent|9ed|9ing|9s|2d|3eed|6ed|6ing|6s|4finite|Ad|Alied|Ds|By|As|9ing|4pendence|Cd|Cs|Bing|At|Be',
  'd|Bing|Blied|Es|Cy|Bs|4x|5ed|7ed|7ing|7s|6s|3ia|5ed|5ing|5n|6a|7ed|7ing|7s|6ed|6ing|6s|5s|4c|5ate|8d|8s|7ing|8on|Aed|Ain',
  'g|As|8ve|Ad|As|9ing|7or|9ed|9ing|9s|5ed|6s|7es|5ing|5s|5t|6ed|6ing|6ment|Aed|Aing|As|6s|4ed|5s|6es|4fference|Cd|Cs|Bing|',
  'At|Bed|Bing|Bs|4genous|Aes|5o|6ed|6ing|6s|4rect|8ed|8ing|8lied|Bs|9y|8s|4vidual|Aed|Aing|Alied|Ds|By|As|3ones|7ian|Aed|A',
  'ing|As|4or|6ed|6ing|6s|7es|3ra|5ed|5ing|5s|3s|3uce|6d|7ed|7ing|7s|6s|5ing|5ted|6ion|9ed|9ing|9s|4s|5es|5trial|Aed|Aing|B',
  'st|Ded|Ding|Ds|As|8ed|9s|7y|3y|2effective|Bd|Bs|Aing|3ligible|Ad|As|9ing|3qualitied|Bs|9y|3vitable|Ad|As|9ied|Bs|Ang|9y|',
  '3xpensive|Bd|Bs|Aing|6rienced|Ded|Ding|Ds|2famous|8es|4ncied|8s|6y|5t|6ed|6ing|6ried|9s|7y|6s|3ect|6ed|8ed|8ing|8s|6ing|',
  '7on|9ed|9ing|9s|8us|Aes|6s|4r|5ed|6nce|9d|9s|8ing|5ing|6or|8ed|8ing|8s|5no|7ed|7ing|7s|5s|3iltrate|Ad|As|9ing|4nite|8d|8',
  'lied|Bs|9y|8s|7ied|9s|8ng|7y|4rmaried|As|8y|3lammation|Ced|Cing|Cs|9oried|Ds|By|5ted|8ed|8ing|8s|6ion|9ed|9ing|9s|4icted',
  '|4uence|9d|9s|8ing|7tial|Bed|Bing|Bs|7za|9ed|9ing|9s|5x|6es|3orm|6al|8ed|8ing|8lied|Bs|9y|8s|7nt|9ed|9ing|9s|7tion|Bal|D',
  'ed|Ding|Ds|Bed|Bing|Bs|6ed|8ed|8ing|8s|6ing|6s|3rared|8ed|8ing|8s|5structure|Ed|Es|Ding|4ingement|Ced|Cing|Cs|3used|2g|3',
  'ram|6ed|6ing|6s|4edient|Aed|Aing|As|3s|2habit|7ants|7ed|9ed|9ing|9s|7ing|7s|4led|3erent|8ed|8ing|8lied|Bs|9y|8s|5it|7anc',
  'e|Bd|Bs|Aing|7ed|7ing|7s|3ibit|7ed|7ing|8on|Aed|Aing|As|7or|9ed|9ing|9s|7s|3uman|7ed|7ing|7s|2itial|7ed|7ing|7lied|As|8y',
  '|7s|6te|8d|8s|7ing|8on|Aed|Aing|As|8ve|Ad|As|9ing|2ject|6ed|6ing|7on|9ed|9ing|9s|6s|3unction|Aed|Aing|As|4red|7ed|7ing|7',
  's|5ied|7s|6ng|5y|4stice|9d|9s|8ing|2k|3s|2land|6ed|6ing|6s|3et|5ed|5ing|5s|2mate|6d|6s|5ing|2n|3ate|6d|6s|5ing|3er|5ed|5',
  'ing|5s|3ing|6ed|6ing|6s|3ocence|9d|9s|8ing|7t|8ed|8ing|8s|4vation|Aed|Aing|As|8ve|Ad|As|9ing|3s|2organic|9ed|9ing|9s|2pu',
  't|5ed|5ing|5s|2quired|6ied|8s|6y|5sition|Bed|Bing|Bs|2sane|6d|6s|5ing|6tied|9s|7y|3cribed|6ption|Bed|Bing|Bs|3ect|6ed|6i',
  'ng|6s|4rt|6ed|8ed|8ing|8s|6ing|7on|9ed|9ing|9s|6s|3ide|6d|6r|7ed|7ing|7s|6s|5ing|4ght|7ed|7ing|7s|5nia|8ed|8ing|8s|7fica',
  'nt|Ded|Ding|Ds|4st|6ed|7nce|Ad|As|9ing|8t|9ed|9ing|9s|6ing|6s|3pect|7ed|7ing|8on|Aed|Aing|As|7or|9ed|9ing|9s|7s|4iration',
  '|Bal|Ded|Ding|Ds|Bed|Bing|Bs|6e|7d|8ed|8ing|8s|7s|6ing|9ed|9ing|9s|3tabilitied|Cs|Ay|5ll|7ation|Ced|Cing|Cs|7ed|7ing|7me',
  'nt|Bed|Bing|Bs|7s|5nce|8d|8s|7ing|6t|7ed|7ing|7lied|As|8y|7s|4ead|7ed|7ing|7s|4inct|8ed|8ing|9velied|Es|Cy|8s|5tute|9d|9',
  's|8ing|9on|Bal|Ded|Ding|Ds|Bed|Bing|Bs|4ruct|8ed|Aed|Aing|As|8ing|9on|Bal|Ded|Ding|Ds|Bed|Bing|Bs|8or|Aed|Aing|As|8s|6me',
  'nt|Aal|Ced|Cing|Dst|Fed|Fing|Fs|Cs|Btion|Fed|Fing|Fs|Aed|Aing|As|3ufficient|Ced|Cing|Cs|4lation|Aed|Aing|As|5in|7ed|7ing',
  '|7s|5t|6ed|6ing|9ed|9ing|9s|6s|4rance|9d|9s|8ing|5gencied|Bs|9y|8ts|5rection|Ced|Cing|Cs|2tact|6ed|6ing|6s|4ke|6d|6s|5in',
  'g|3eger|7ed|7ing|7s|5ral|8ed|8ing|8s|7te|9d|9s|8ing|9on|Bed|Bing|Bs|6itied|As|8y|4llect|9ed|9ing|9s|9ual|Ced|Cing|Cs|6ig',
  'ence|Cd|Cs|Bing|At|Bed|Bing|Bs|4nd|6ed|8ed|8ing|8s|6ing|9ed|9ing|9s|6s|5se|7d|7lied|As|8y|7s|6ified|7ng|7tied|As|8y|7ve|',
  '9d|9s|8ing|5t|6ed|6ing|7on|9al|Bed|Bing|Blied|Es|Cy|Bs|9ed|9ing|9s|6lied|9s|7y|6s|4r|5act|8ed|8ing|9on|Bed|Bing|Bs|9ve|B',
  'd|Bs|Aing|8s|5cept|9ed|9ing|Aon|Ced|Cing|Cs|9or|Bed|Bing|Bs|9s|6hange|Bd|Bs|Aing|6itied|As|8y|6ollegiate|Fd|Fs|Eing|7nti',
  'nental|Fled|Fling|Fls|7urse|Bd|Bs|Aing|5ed|6st|8ed|Aed|Aing|As|8ing|Bed|Bing|Bs|8s|5face|9d|9s|8ing|6ere|9d|9nce|Cd|Cs|B',
  'ing|9s|8ing|Bed|Bing|Bs|5im|7ed|7ing|7s|6ng|6or|8ed|8ing|8s|5lude|9d|9s|8ing|5mediate|Cd|Cs|Bing|6ittent|Ced|Cing|Cs|5n|',
  '6al|8ed|8ing|8lied|Bs|9y|8s|7tional|Ded|Ding|Dlied|Fes|Ey|Ds|6ed|7t|6ing|6ment|Aed|Aing|As|6s|7hip|Aed|Aing|As|5pret|9at',
  'ion|Eed|Eing|Es|9ed|Ar|Bed|Bing|Bs|9ing|9s|5rogation|Ded|Ding|Ds|6upt|9ed|Bed|Bing|Bs|9ing|Ced|Cing|Cs|Aon|Ced|Cing|Cs|9',
  's|5s|6ect|9ed|9ing|Aon|Ced|Cing|Cs|9s|6persed|6tate|Ad|As|9ing|5val|8ed|8ing|8s|6ene|9d|9s|8ing|8tion|Ced|Cing|Cs|6iew|9',
  'ed|9ing|9s|3imacied|9s|7y|6te|8d|8lied|Bs|9y|8s|7ing|5idated|9ing|Aon|Ced|Cing|Cs|3o|4ed|4ing|4s|3ricate|9d|9s|8ing|5gue',
  'd|7ing|Aed|Aing|As|5nsic|9ed|9ing|9s|4oduce|9d|9s|8ing|8tion|Ced|Cing|Cs|9oried|Ds|By|4uder|8ed|8ing|8s|5sion|9ed|9ing|9',
  's|3uition|9ed|9ing|9s|7ve|9d|9s|8ing|2vade|6d|6rs|6s|5ing|4lid|7ed|7ing|7s|4riablied|Bs|9y|7nt|9ed|9ing|9s|4sion|8ed|8in',
  'g|8s|6ve|8d|8s|7ing|3ent|6ed|6ing|7on|9ed|9ing|9s|6or|8ed|8ied|As|9ng|8s|8y|6s|4rness|9es|5se|7d|7s|6ing|7on|9ed|9ing|9s',
  '|5tebrates|7d|8ed|8ing|8s|4st|6ed|6igate|Bd|Bs|Aing|Ded|Ding|Ds|Bon|Ded|Ding|Ds|Bve|Dd|Ds|Cing|Aor|Ced|Cing|Cs|7ng|6ment',
  '|Aed|Aing|As|6or|8ed|8ing|8s|6s|3incible|Ad|As|9ing|4sible|9d|9s|8ing|4tation|Aal|Ced|Cing|Cs|Aed|Aing|As|5e|6d|6s|5ing|',
  '8ed|8ing|8s|3oked|4luntaried|Cs|Ay|5ve|7d|8ed|8ing|8s|7ment|Bed|Bing|Bs|7s|6ing|2ward|6ed|6ing|6lied|9s|7y|6s|1on|3ic|5e',
  'd|5ing|5s|3s|2wa|4ed|4ing|4s|1ra|3n|4ed|4ian|7ed|7ing|7s|5ng|4s|3q|4ed|4i|5ed|5ing|5ng|5s|4s|3s|2e|3d|3ne|5d|5s|4ing|3s|',
  '2fan|5ed|5ing|5s|2is|4es|4h|5ed|6s|5ing|2on|4ed|4icallied|Bs|9y|5ed|6s|5ng|4s|4y|3quois|8es|2rational|Aed|Aing|As|3egula',
  'r|9ed|9ing|Aties|9s|4levant|Aed|Aing|As|4sistible|Cd|Cs|Bing|3igation|Aed|Aing|As|4tated|7ing|Aed|Aing|As|8on|Aed|Aing|A',
  's|2vin|5ed|5g|6ed|6ing|6s|5ing|5s|2win|5ed|5ing|5s|1s|2aac|5ed|5ing|5s|3bel|6ed|6ing|6la|8ed|8ing|8s|7e|8d|8s|7ing|6s|3i',
  'ah|6ed|6ing|6s|2idore|7d|7s|6ing|3s|4es|2lam|5ed|5ic|7ed|7ing|7s|6ng|6st|8ed|8ing|8s|5s|4nd|6ed|7r|8ed|8ing|8s|6ing|6s|3',
  'e|4d|4s|3ing|2o|3late|7d|8ed|8ing|8s|7s|6ing|7on|9ed|9ing|9s|3s|3tope|7d|7s|6ing|2rael|6ed|6i|7ed|7ing|7ng|7s|6s|2sue|5d',
  '|5s|4ing|7ed|7ing|7s|2t|3s|1t|2alian|7ate|Ad|As|9ing|7ed|7ing|7s|5cs|7es|5ed|4y|2em|4ed|4ing|4s|3r|4ation|9ed|9ing|9s|4e',
  'd|4ing|4s|2haca|6ed|6ing|6s|2o|3s|2s|3elf|6ed|6ing|6s|4s|1van|4ed|4ing|4s|2ied|4s|2oried|6s|4y|2y|1zchak|6ed|6ing|6s|2um',
  'i|5ed|5ing|5s|2zied|5s|3y|0jack|4ed|5t|6ed|6ing|6s|4ing|4s|5on|7ed|7ing|7s|4ye|6ed|6ing|6s|3ob|5ed|5ing|6te|8d|8s|7ing|5',
  's|6on|8ed|8ing|8s|3ques|7es|2de|4d|4s|3ing|2gath|6ed|6ing|6s|3ged|6ed|6ing|6s|5r|6ed|6ing|6s|3uar|6ed|6ing|6s|2il|4ed|4i',
  'ng|4s|3me|5d|5s|4ing|3n|4ed|4ing|4s|2ke|4d|4s|3ing|3ob|5ed|5ing|5s|2m|3a|4ed|4ica|7ed|7ing|7n|8ed|8ing|8s|7s|5ng|4s|3es|',
  '5es|3ie|5d|5s|4ing|3s|2n|3e|4d|4s|4t|5ed|5ing|5s|3ice|6d|6s|5ing|4ng|3os|5es|3s|3uaried|8s|6y|2pan|5ed|6se|8d|8s|7ing|5i',
  'ng|5s|2r|3ed|5ed|5ing|5s|3l|4ed|4ing|4s|3mo|5ed|5ing|5s|3s|3vis|6es|2smine|7d|7s|6ing|3on|5ed|5ing|5s|3per|6ed|6ing|6s|2',
  'va|4ed|4ing|4nese|8d|8s|7ing|4s|3elin|7ed|7ing|7s|2w|3s|2y|3ant|6ed|6ing|6s|3esh|6ed|7s|6ing|3s|2zz|4es|1ealous|7es|7ied',
  '|9s|7y|3n|4ed|5tte|8d|8s|7ing|4ied|6s|5ng|4ne|6d|6s|6tte|9d|9s|8ing|5ie|7d|7s|6ing|6ng|4s|5es|4y|2d|3s|2ep|4ed|4ing|4s|2',
  'f|3f|4ed|5ried|8s|6y|4ie|6d|6s|5ing|5ng|4rey|7s|4s|3s|2llied|6s|4y|3ske|6d|6s|5ing|2m|3s|2nine|6d|6s|5ing|3kins|3na|5ed|',
  '5ing|5s|4ie|6d|6s|5fer|8ed|8ing|8s|5ing|4y|2opardied|9s|7y|2rald|6ed|6ing|6s|3emiah|8ed|8ing|8s|6ed|7s|5y|3k|4ed|4ing|4s',
  '|3ome|6d|6s|5ing|3rie|6d|6s|5ing|4y|3sey|6s|3usalem|9ed|9ing|9s|2sper|6ed|6ing|6s|3s|4e|5d|5s|4ica|7ed|7ing|7s|5e|6d|6s|',
  '5ing|5ng|3uit|6ed|6ing|6s|4s|5es|2t|3s|2w|3el|5ed|5ing|5ried|8s|6y|5s|3ish|6ed|7s|6ing|3s|1ianyun|7ed|7ing|7s|2had|5ed|5',
  'ing|5s|2ll|4ed|4ing|4s|2m|3mied|6s|4y|3s|2n|3chao|7ed|7ing|7s|3g|4bai|7ed|7ing|7s|4ed|4ing|4le|6d|6s|5ing|4s|3nied|6s|4y',
  '|3s|2ri|4ed|4ing|4s|2sheng|7ed|7ing|7s|2tendra|8ed|8ing|8s|1oachim|7ed|7ing|7s|3n|4ed|4ing|4na|6ed|6ing|6s|5e|6d|6s|5ing',
  '|4s|2b|3s|2celyn|7ed|7ing|7s|3hen|6ed|6ing|6s|3k|4ed|5y|6s|4ing|4s|2e|3l|4ed|4ing|4s|3s|3y|4s|2han|5ed|5ing|5n|6a|7ed|7i',
  'ng|7s|6ed|7s|8es|6ing|6s|5s|3n|4athan|9ed|9ing|9s|4ed|4ing|4nie|7d|7s|6ing|5y|4s|2in|4ed|4ing|7ed|7ing|7s|4s|4t|5ed|5ing',
  '|5lied|8s|6y|5s|2ke|4d|4r|5ed|5ing|5s|4s|3ing|2llied|6s|4y|3t|4ed|4ing|4s|2n|3ah|5ed|5ing|5s|4s|5es|4than|8ed|8ing|8s|3e',
  's|5es|3g|4ed|4ing|4s|3i|4ed|4ing|4s|3s|2on|4ed|4ing|4s|2rdan|6ed|6ian|9ed|9ing|9s|7ng|6s|3ge|5d|5s|4ing|2s|3e|4d|4ph|6ed',
  '|6ine|9d|9s|8g|8ing|6s|4s|3h|4ed|5s|4i|5ed|5ing|5ng|5s|4ua|6ed|6ing|6s|3iah|6ed|6ing|6s|4e|5d|5s|4ing|4ng|4p|5ed|5ing|5s',
  '|2ubert|7ed|7ing|7s|3rnal|7ed|7ing|8sm|Aed|Aing|As|9t|Aed|Aing|As|7s|5ey|7s|2y|3ce|5d|5s|4ing|3s|1uan|4ed|4ing|4s|2bilee',
  '|7ed|7ing|7s|2d|3ah|5ed|5ing|5s|4ism|7ed|7ing|7s|4s|5es|3e|4d|4s|3ge|5d|5ment|9s|5s|4ing|4ment|8ed|8ing|8s|3icial|8ed|8i',
  'ng|8s|7ried|As|8y|4ed|5s|4ng|4th|6ed|6ing|6s|3o|4ed|4ing|4s|3s|3y|2ergen|7ed|7ing|7s|2g|3s|2ha|4ed|4ing|4s|2ice|5d|5s|4i',
  'ed|6s|5ng|4y|2les|5es|3ia|5ed|5ing|5n|6a|7ed|7ing|7s|6e|7d|7s|6ing|6s|6to|8ed|8ing|8s|5s|4e|5d|5n|6ed|6ing|6s|5s|5t|6ed|',
  '6ing|6s|4ing|4o|5ed|5ing|5s|4us|6es|3y|2mp|4ed|5r|6ed|6ing|6s|4ing|4s|2n|3ction|8ed|8ing|8s|3e|4d|4s|3gle|6d|6s|5ing|3in',
  'g|4or|6ed|6ing|6s|4per|7ed|7ing|7s|3k|4ed|4ing|4s|3o|4ed|4ing|4s|3s|3ta|5ed|5ing|5s|2piter|7ed|7ing|7s|2r|3assic|8ed|8in',
  'g|8s|3evis|7es|3i|4ed|5s|4ing|4s|5diction|Ced|Cing|Cs|5prudence|Dd|Ds|Cing|5t|6ed|6ing|6s|3s|3y|2ssi|5ed|5ing|5s|3t|4ed|',
  '4ice|7d|7s|6ing|5fication|Ded|Ding|Ds|7ed|8s|6y|5n|6e|7d|7s|6g|6ing|6s|4s|2venile|8d|8s|7ing|1wahar|6ed|6ing|6s|0kai|3s|',
  '4er|6ed|6ing|6s|2j|3s|2la|4ed|4ing|4s|3i|4ed|4ing|4s|2mel|5ed|5ing|5s|3iya|6ed|6ing|6s|2n|3g|4aroo|8ed|8ing|8s|4ed|4ing|',
  '4s|3nada|3s|4as|3than|7ed|7ing|7s|2ppa|5ed|5ing|5s|2rate|6d|6s|5ing|3el|5ed|5ing|5s|4n|5ed|5ing|5s|3i|4ed|4ing|4s|3l|4ed',
  '|4ing|4s|3ma|5ed|5ing|5s|3nataka|2t|3e|4d|4s|3h|4arine|9d|9s|8ing|4ed|4ied|6s|5ng|4leen|8ed|8ing|8s|4ryn|7ed|7ing|7s|4s|',
  '4y|3ie|5d|5s|4ing|4ng|3s|3y|2y|3s|3van|6ed|6ing|6s|2zuhiro|8ed|8ing|8s|1ed|3s|2e|3l|4ed|4ing|4s|3n|4ed|4ing|4s|3p|4ed|5r',
  '|6ed|6ing|6s|4ing|7ed|7ing|7s|4s|3s|4es|2ith|5ed|5ing|5s|2ller|6s|4ied|6s|4y|3vin|6ed|6ing|6s|2mal|5ed|5ing|5s|3p|4ed|4i',
  'ng|4s|2n|3d|4ed|4ing|4s|3n|4ed|5th|7ed|7ing|7s|4ing|4s|3s|4ington|Aed|Aing|As|3t|4ed|4ing|4on|6ed|6ing|6s|4s|4uckied|9s|',
  '7y|2pt|4ed|4ing|4s|2r|3ala|3n|4ed|5l|6ed|6ing|6s|4ing|4s|3ri|5ed|6s|5ing|5s|4y|3s|2ttle|6d|6s|5ing|2van|5ed|5ing|5s|3in|',
  '5ed|5ing|5s|3yn|5ed|5ing|5s|2y|3board|8ed|8ing|8s|3note|7d|7s|6ing|3s|4tone|8d|8s|7ing|1halifa|7ed|7ing|7s|3n|4ed|4ing|4',
  's|2mer|5ed|5ing|5s|1ick|4ed|5r|6ed|6ing|6s|4ing|7ed|7ing|7s|4off|7ed|7ing|7s|4s|2d|3nap|6ed|6ing|6s|4ey|6s|3s|4es|2el|4e',
  'd|4ing|4s|3ran|6ed|6ing|6s|2ki|4ed|4ing|4s|3ki|5ed|5ing|5s|2l|3l|4ed|5r|6ed|6ing|6s|4ing|7ed|7ing|7s|4s|3ograms|4meter|9',
  'ed|9ing|9s|7re|9s|3s|2m|3berlied|9s|7y|3mo|5ed|5ing|5s|3s|2n|3ase|6d|6s|5ing|3ch|5ed|6s|5ing|3d|4ed|5rgarten|Ced|Cing|Cs',
  '|4ing|4lied|7s|5y|4ness|8es|4s|3etic|7ed|7ing|7s|3g|4dom|7ed|7ing|7s|4ed|4ing|4s|3s|4hip|7ed|7ing|7s|2rk|4ed|4ing|4s|3st',
  'en|7ed|7ing|7s|2ss|4es|4ing|7ed|7ing|7s|2t|3chen|7ed|8r|9ed|9ing|9s|7ing|7s|3e|4d|4s|3ing|3s|3ten|6ed|6ing|6s|4ied|6s|4y',
  '|1lan|4ed|4ing|4s|3udia|7ed|7ing|7s|4s|5es|1napper|7ed|7ing|7s|2ee|4ed|4ing|4ling|8ed|8ing|8s|4s|3lt|5ed|5ing|5s|3sset|7',
  'ed|7ing|7s|3w|4ed|4ing|4s|2icks|3fe|5d|5s|4ing|3ght|6ed|6ing|6s|3t|4ed|4ing|4s|4ting|8ed|8ing|8s|2ob|4ed|4ing|4s|3ck|5ed',
  '|5ing|8ed|8ing|8s|5out|8ed|8ing|8s|5s|3t|4ed|4ing|4s|4ted|7ed|7ing|7s|3w|4ed|4ing|7ed|7ing|7s|4ledge|9d|9s|8ing|4n|5ed|5',
  'ing|5s|4s|3xville|9d|9s|8ing|2uckles|3dsen|7ed|7ing|7s|3t|4e|5d|5s|4ing|4s|1och|4ed|5s|4ing|2lkata|4ka|6ed|6ing|6s|2n|3r',
  'ad|6ed|6ing|6s|3s|4tantin|Aed|Aing|Aos|Ces|As|2ppen|6ed|6ing|6s|2r|3e|4an|6ed|6ing|6s|4d|4s|3ied|5s|4ng|3s|3y|2s|3es|2ta',
  '|4ed|4ing|4s|1ra|3ft|5ed|5ing|5s|3s|2emlin|7ed|7ing|7s|2is|4es|4hna|7ed|7ing|7s|4ten|7ed|7ing|7s|5i|6an|8ed|8ing|8s|6ed|',
  '6ing|6n|7ed|7ing|7s|6s|3ton|6ed|6ing|6s|2zysztof|9ed|9ing|9s|1uldip|6ed|6ing|6s|2ng|4ed|4ing|4s|2rd|4ed|4ing|5sh|7ed|8s|',
  '7ing|6tan|9ed|9ing|9s|4s|3t|4ed|4ing|4s|2sum|5ed|5ing|5s|1wan|4ed|4ing|4s|1yle|4d|4s|3ing|3o|4ed|4ing|4s|2u|3ng|5ed|5ing',
  '|5s|3s|0lab|3el|5ed|5ing|5led|5s|3or|5atoried|Bs|9y|5ed|6rs|5ing|5s|4ur|6ed|7rs|6ing|6s|3rador|8ed|8ing|8s|3s|3yrinth|9e',
  'd|9ing|9s|2c|3e|4d|5ed|5ing|5s|4s|3ied|5s|4ng|3k|4ed|4ing|4s|3rosse|8d|8s|7ing|3s|3y|2d|3der|6ed|6ing|6s|3en|5ed|5ing|5s',
  '|3ied|5s|6es|3s|3y|2fayette|9d|9s|8ing|2g|3oon|6ed|6ing|6s|3s|2i|3d|4ed|4ing|4s|3r|4d|5ed|5ing|5s|4ed|4ing|4s|3s|2ke|4d|',
  '4rs|4s|5ide|8d|8s|7ing|3h|4s|3ing|3shmi|7ed|7ing|7s|2m|3a|4ed|4ing|4s|3b|4da|6ed|6ing|6s|4ed|5rt|7ed|7ing|7s|4ing|4s|3e|',
  '4d|4s|3ing|3p|4ed|4ing|4s|3s|2n|3a|4ed|4ing|4s|3caster|9ed|9ing|9s|4e|5d|5s|4ing|3d|4au|6ed|6ing|6s|4ed|6ed|6ing|6s|4fal',
  'l|8ed|8ing|8s|4ing|7ed|7ing|7s|4lord|8ed|8ing|8s|4mark|8ed|8ing|8s|4owner|9ed|9ing|9s|4s|5cape|9d|9s|8ing|5lide|9d|9s|8i',
  'ng|3e|4d|4s|3guage|8d|8s|7ing|3ing|3nied|6s|4y|3s|3tern|7ed|7ing|7s|2o|3s|2p|3s|4es|3top|6s|2r|3ge|5d|5lied|8s|6y|5r|6s|',
  '5s|6t|4ing|3k|4ed|4ing|4s|3ried|6s|4y|3s|4es|3vae|6d|6s|5ing|2s|3er|5ed|5ing|5s|4s|3h|4ed|5s|4ing|3s|4es|3t|4ed|4ing|7ed',
  '|7ing|7s|4lied|7s|5y|4s|2t|3ch|5ed|6s|5ing|3e|4d|4lied|7s|5y|4r|5al|7ed|7ing|7s|5ed|5ing|5s|4s|5t|6ed|6ing|6s|3in|5ed|5g',
  '|5ing|5s|4tude|8d|8s|7ing|3s|3ter|6ed|6ing|6s|4ice|7d|7s|6ing|3vian|7ed|7ing|7s|2uded|3gh|5ed|5ing|8ed|8ing|8s|5s|5ter|8',
  'ed|8ing|8s|3n|4ch|6ed|7r|8ed|8ing|8s|7s|6ing|4dering|5ried|8s|6y|4ed|4ing|4s|3r|4a|5ed|5ing|5s|4eate|8d|8s|7ing|5d|5l|6e',
  'd|6ing|6s|5nce|8d|8s|7ing|6t|7ed|7ing|7s|4ianne|9d|9s|8ing|5e|6d|6s|5ing|5ng|4s|2va|4ed|4ing|4s|3ender|8ed|8ing|8s|3ish|',
  '6ed|7s|6ing|2w|3ful|6ed|6ing|6s|3makers|3n|4ed|4ing|4s|3rence|8d|8s|7ing|3s|4on|6ed|6ing|6s|4uit|7ed|7ing|7s|3yer|6ed|6i',
  'ng|6s|2x|3es|2y|3er|5ed|7ed|7ing|7s|5ing|5s|3ing|6ed|6ing|6s|3ne|5d|5s|4ing|3out|6ed|6ing|6s|3s|2zarus|7es|3ied|5s|3y|1e',
  'a|3ch|5ed|6s|5ing|3d|4ed|5r|6ed|6ing|6s|7hip|Aed|Aing|As|4ing|7ed|7ing|7s|4s|5es|3f|4ed|4ing|4lets|4s|3gue|6d|6s|5ing|3h',
  '|4ed|4ing|4s|3k|4ed|4ing|4s|3n|4ed|4ing|7ed|7ing|7s|4s|3p|4ed|4ing|7ed|7ing|7s|4s|4t|5ed|5ing|5s|3r|4ed|4ing|4n|5ed|7ed|',
  '7ing|7s|6rs|5ing|8ed|8ing|8s|5s|5t|6ed|6ing|6s|4s|3s|4e|5d|5s|4h|5ed|6s|5ing|4ing|7ed|7ing|7s|4t|5ed|5ing|5s|3ther|7ed|7',
  'ing|7s|3ve|5d|5s|6es|4ing|7ed|7ing|7s|2ban|5ed|6se|8d|8s|7ing|5ing|5s|2cture|7d|7r|8ed|8ing|8s|7s|6ing|2d|3ge|5d|5r|6ed|',
  '6ing|6s|5s|4ing|3s|2e|3ds|3s|2ft|4ed|4ing|5st|7ed|7ing|7s|4s|2g|3acied|7s|5y|4l|5ed|5ing|5lied|8s|6y|5s|3end|6aried|As|8',
  'y|6ed|6ing|6s|4r|5ed|5ing|5s|3ged|6ed|6ing|6s|3ion|6ed|6ing|6s|4slation|Bed|Bing|Bs|9ve|Bd|Bs|Aing|8or|Aed|Aing|As|8ure|',
  'Bd|Bs|Aing|4t|5ed|5im|7acied|Bs|9y|8te|Ad|As|9ing|7ed|7ing|7s|6ng|5s|3s|2i|3cester|9ed|9ing|9s|3f|4ed|4ing|4s|3gh|5ed|5i',
  'ng|5s|5ton|8ed|8ing|8s|3la|5ed|5ing|5s|3s|4ure|7d|7s|6ing|3th|5ed|5ing|5s|2mon|5ed|5ing|5s|2n|3a|4ed|4ing|4s|3d|4ed|4ing',
  '|4s|3gth|6ed|6ied|8s|7ng|6s|6y|3nied|6s|4y|3ora|6ed|6ing|6s|3s|4es|3t|4ed|4ing|4s|2o|3n|4ard|7ed|7ing|7s|4ed|4id|6ed|6in',
  'g|6s|5ng|4s|3pard|7ed|7ing|7s|4old|7ed|7ing|7s|3ra|5ed|5ing|5s|3s|2s|3bian|7ed|7ing|7s|3es|3ions|3lie|6d|6s|5ing|3s|4er|',
  '6ed|6ing|6s|5s|4on|6ed|6ing|6s|3t|4ed|5r|6ed|6ing|6s|4ing|4s|2t|3hal|6ed|6ing|6s|3o|4ed|4ing|4s|3s|3ter|6ed|6ing|9ed|9in',
  'g|9s|6s|4ing|2ukemia|8ed|8ing|8s|3ng|5ed|5ing|5s|2v|3ant|6ed|6ing|6s|3el|5ed|5ing|5s|4r|5age|8d|8s|7ing|5ed|5ing|5s|3i|4',
  'ed|5s|4ing|4n|5ed|5ing|5s|4s|3s|3y|2w|3is|5es|3s|2x|3es|2y|3s|1iabilitied|As|8y|4le|6d|6s|5ing|3ison|7ed|7ing|7s|3ng|5ed',
  '|5ing|5s|3r|4ed|4ing|4s|2bbied|6s|4y|3el|5ed|5ing|5s|4r|5al|7ed|7ing|8sm|Aed|Aing|As|7s|6ted|7ion|Aed|Aing|As|5ed|5ia|7e',
  'd|7ing|7s|6ng|5s|5tarian|Bed|Bing|Bs|6ied|8s|6y|3rarian|9ed|9ing|9s|7ed|8s|6y|4etto|8ed|8ing|8s|3yan|6ed|6ing|6s|2cence|',
  '5se|7d|8ed|8ing|8s|7s|6ing|3k|4ed|4ing|7ed|7ing|7s|4s|2d|3s|2e|3d|4ed|4ing|4s|3ge|5d|5s|4ing|3s|3u|4ed|4ing|4s|4tenant|A',
  'ed|Aing|As|3vaart|8ed|8ing|8s|2f|3e|4boat|8ed|8ing|8s|4d|4less|8es|5ong|8ed|8ing|8s|4s|4time|8d|8s|7ing|3ing|3s|3t|4ed|4',
  'ing|7ed|7ing|7s|4s|2gament|8ed|8ing|8s|3ht|5ed|6r|7ed|7ing|7s|5house|Ad|As|9ing|5ing|8ed|8ing|8s|5lied|8s|6y|5ning|9ed|9',
  'ing|9s|5s|5weight|Bed|Bing|Bs|2ke|4d|4lied|7s|6hood|Aed|Aing|As|5y|4ned|6ss|8es|4s|4wise|8d|8s|7ing|3ing|6ed|6ing|6s|2la',
  '|4ed|4ing|4s|3ied|5s|4th|6ed|6ing|6s|3y|2m|3a|4ed|4ing|4s|3b|4ed|4ing|4s|3e|4d|4rick|8ed|8ing|8s|4s|5tone|9d|9s|8ing|3in',
  'g|4t|5ation|Aed|Aing|As|5ed|7ed|7ing|7s|5ing|8ed|8ing|8s|5s|3o|4ed|4ing|4s|4usine|9d|9s|8ing|3p|4ed|4ing|4s|3s|2n|3a|4ed',
  '|4ing|4s|3coln|7ed|7ing|7s|3da|5ed|5ing|5s|4en|6ed|6ing|6s|5r|6ed|6ing|6s|4say|7s|5ey|7s|3e|4age|7d|7s|6ing|5r|6ed|6ing|',
  '6s|4d|5ed|5ing|5s|4man|7ed|7ing|7s|4n|5ed|5ing|5s|4r|5ed|5ing|5s|4s|3g|4ed|5r|6ed|6ing|6s|4ing|4s|4uist|8ed|8ic|Aed|Aing',
  '|As|Bes|9ng|8s|3ing|6ed|6ing|6s|3k|4ed|6ed|6ing|6s|4ing|7ed|7ing|7s|4s|5es|3ley|6s|3s|2on|4ed|5l|6ed|6ing|6s|4ing|4s|2p|',
  '3s|4tick|8ed|8ing|8s|2quid|6ation|Bed|Bing|Bs|6ed|6ing|6s|4or|6ed|6ing|6s|2sa|4ed|4ing|4s|3bon|6ed|6ing|6s|3t|4ed|6ed|6i',
  'ng|6s|5n|6ed|7r|8ed|8ing|8s|6ing|9ed|9ing|9s|6s|5r|6ed|6ing|6s|4ing|7ed|7ing|7s|4s|2t|3er|5acied|9s|7y|6l|7ed|7ing|7lied',
  '|As|8y|7s|6ried|9s|7y|6ture|Ad|As|9ing|5ed|5ing|5s|3h|4ed|4ing|5um|7ed|7ing|7s|4s|4uanian|Aed|Aing|As|3igation|Aed|Aing|',
  'As|3re|5s|3s|3ter|6ed|6ing|6s|4le|6d|6s|5ing|3urgical|Aed|Aing|As|7ed|8s|6y|2v|3e|4d|5ed|5ing|5s|4lied|7s|6hood|Aed|Aing',
  '|As|5y|4r|5ed|5ied|7s|6ng|5s|5y|4s|5t|6ock|9ed|9ing|9s|3ing|6ed|6ing|6s|3s|2yuan|6ed|6ing|6s|2z|3a|4ed|4ing|4rd|6ed|6ing',
  '|6s|4s|3es|3zie|6d|6s|5ing|1loyd|5ed|5ing|5s|1oad|4ed|6ed|6ing|6s|4ing|7ed|7ing|7s|4s|3f|4ed|4ing|4s|3n|4ed|4ing|4s|2b|3',
  'bied|6s|4y|3e|4d|4s|3ing|3s|4ter|7ed|7ing|7s|2cal|5ed|5ing|6tied|9s|7y|6zed|5lied|8s|6y|5s|4te|6d|6s|5ing|6on|8ed|8ing|8',
  's|3h|4ed|5s|4ing|3k|4ed|6ed|6ing|6s|5r|6ed|6ing|6s|4ing|7ed|7ing|7s|4s|3o|4ed|4ing|4motive|Ad|As|9ing|4s|3us|5es|2d|3ge|',
  '5d|6ed|6ing|6s|5s|4ing|7ed|7ing|7s|3s|2ft|4ed|4ing|4s|2g|3ged|6ed|6ing|6s|4ing|7ed|7ing|7s|3ic|5al|7ed|7ing|7s|5ed|5ing|',
  '5s|4n|5ed|5ing|5s|4stical|Aed|Aing|As|8s|9es|3o|4ed|4ing|4s|5es|3s|2is|4es|2la|4ed|4ing|4s|2mbard|7ed|7ing|7s|2ne|4d|4li',
  'ed|7s|6ness|Aes|5y|4s|3g|4ed|5r|6ed|6ing|6s|5st|5vitied|As|8y|4ing|7ed|7ing|7s|5tude|9d|9s|8inal|Ced|Cing|Cs|Ag|4s|3hyn|',
  '6ed|6ing|6s|3ing|2ok|4ed|4ing|7ed|7ing|7s|4out|7ed|7ing|7s|4s|3med|4ing|7ed|7ing|7s|3p|4ed|4ing|4s|3se|5d|5lied|8s|6y|5n',
  '|6ed|6ing|6s|5s|4ing|3t|4ed|4ing|4s|2rd|4ed|4ing|4s|5hip|8ed|8ing|8s|3e|4d|4n|5ed|5ing|5s|5zo|7ed|7ing|7s|4s|3i|4ed|5n|6',
  'ed|6ing|6s|4ing|4ng|4s|3raine|8d|8s|7ing|2se|4d|4r|5ed|5ing|5s|4s|3ing|6ed|6ing|6s|3s|4es|3t|4ed|4ing|4s|2t|3s|4es|3teri',
  'ed|8s|6y|3us|5es|2u|3d|4ed|5r|6ing|6s|4ing|4lied|7s|5y|4s|3gh|5ed|5ing|5s|3ie|5d|5s|4ing|4qa|6ed|6ing|6s|4s|5a|6ed|6ing|',
  '6s|5e|6d|6s|5iana|9ed|9ing|9s|6ng|3kas|6es|3nge|6d|6s|5ing|3s|3vre|6d|6s|5ing|2ve|4d|4lied|7s|5y|4r|5ed|5ing|5s|4s|3ing|',
  '6ed|6ing|6s|2w|3ell|6ed|6ing|6s|4r|5ed|5ing|8ed|8ing|8s|5s|4st|3land|7ed|7ing|7s|3s|2yal|5ed|5ing|6st|8ed|8ing|8s|5s|5ti',
  'ed|8s|6y|3d|4ed|4ing|4s|1uc|3an|5ed|5ing|5s|3e|4d|4s|3ia|5ed|5ing|5n|6ed|6ing|6s|5s|4ed|5s|4fer|7ed|7ing|7s|4nda|7ed|7in',
  'g|7s|5g|4us|6es|3k|4ed|4ied|6s|5lied|8s|6y|5ng|4now|7ed|7ing|7s|4s|4y|3rative|9d|9s|8ing|3s|3y|2dwig|6ed|6ing|6s|2ggage|',
  '7d|7s|6ing|2i|3gi|5ed|5ing|5s|3s|4es|2kas|5es|3e|4d|4s|3ing|2llabied|8s|6y|3u|4ed|4ing|4s|2m|3ber|6ed|6ing|6s|3inous|8es',
  '|3p|4ed|4ing|4s|3s|2na|4ed|4ing|4r|5ed|5ing|5s|4s|4tic|7ed|7ing|7s|3ch|5ed|6s|5ing|3g|4ed|6ed|6ing|6s|4ing|4s|2r|3ched|3',
  'e|4d|4s|3ing|3king|3s|2sh|4ed|5s|4ing|3t|4ed|4ing|4s|2ther|6an|8ed|8ing|8s|6ed|6ing|6s|2x|3es|3uried|7s|6ous|9es|5y|1ydi',
  'a|5ed|5ing|5s|2ing|5ed|5ing|5s|2nch|5ed|6s|5ing|3don|6ed|6ing|6s|3n|4e|5d|5s|5tte|8d|8s|7ing|4ing|4s|3x|4es|2on|4ed|4ing',
  '|4s|2ric|5al|7ed|7ing|7s|5ed|5ing|6st|8ed|8ing|8s|5s|0maarten|7ed|7ing|7s|2b|3el|5ed|5ing|5s|3s|2c|3beth|7ed|7ing|7s|3e|',
  '4d|5onian|Aed|Aing|As|4s|3hine|7d|7ried|As|8y|7s|6ing|3ing|3k|4ed|4ing|4s|3on|5ed|5ing|5s|3ro|5ed|5ing|5s|3s|2d|3agascar',
  '|Aed|Aing|As|4m|5e|6d|6s|5ing|5s|3den|6ed|6ing|6s|3e|4d|4ira|7ed|7ing|7s|4line|8d|8s|7ing|4s|3ing|3lied|6s|4y|3man|6ed|6',
  'ing|6s|3ness|7es|3onna|7ed|7ing|7s|3ras|6es|4id|6ed|6ing|6s|3s|2e|3d|3s|4tro|7ed|7ing|7s|2g|3azine|8d|8s|7ing|3dalene|9d',
  '|9s|8ing|3e|4d|4s|3gie|6d|6s|5ing|3ic|5al|7ed|7ing|7s|5ed|5ian|8ed|8ing|8s|6ng|5s|4ng|4strate|Ad|As|9ing|3ma|5ed|5ing|5s',
  '|3nate|7d|7s|6ing|4esium|9ed|9ing|9s|5t|6ed|6ic|8ed|8ing|8s|7ng|6s|4ificent|Bed|Bing|Bs|5tude|9d|9s|8ing|4olia|8ed|8ing|',
  '8s|4um|6ed|6ing|6s|5s|6es|3s|2h|3a|4ed|4ing|4raja|8ed|8ing|8s|6shtra|4s|3esh|6ed|7s|6ing|3moud|7ed|7ing|7s|3oganied|9s|7',
  'y|3s|2ia|4ed|4ing|4s|3d|4ed|5n|6ed|6ing|6s|4ing|4s|3l|4ed|4ing|4s|3n|4e|5d|5s|4ing|4lied|7s|5y|4s|4tain|8ed|8ing|8s|5ena',
  'nce|Bd|Bs|Aing|3ze|5d|5s|4ing|2jestic|8ed|8ing|8s|7ed|8s|6y|3or|5ed|5ing|6tied|9s|7y|5s|2ke|4d|4r|5ed|5ing|5s|4s|5hift|9',
  'ed|9ing|9s|3ing|6ed|6ing|6s|2l|3a|4bar|7ed|7ing|7s|4cca|7ed|7ing|7s|5lypse|Ad|As|9ing|4ed|4ga|6ed|6ing|6s|4ing|4ria|7ed|',
  '7ing|7s|4s|4y|5alam|9ed|9ing|9s|5s|6ian|9ed|9ing|9s|3colm|7ed|7ing|7s|3e|4d|4s|3i|4ce|6d|6s|5ing|6ous|9es|4ed|4ing|4k|5e',
  'd|5ing|5s|4ng|4s|3l|4ed|4ing|4oy|6s|4s|3s|3tese|7d|7s|6ing|3us|5es|2mmal|6ed|6ian|9ed|9ing|9s|7ng|6s|4oth|7ed|7ing|7s|2n',
  '|3a|4ed|4ge|6d|6ment|Aed|Aing|As|6r|7ed|7ial|Aed|Aing|As|8ng|7s|6s|5ing|4ing|4s|4vendra|Aed|Aing|As|3chester|Aed|Aing|As',
  '|5u|6ed|6ing|6s|3d|4arin|8ed|8ing|8s|5te|7d|7s|6ing|6oried|As|8y|4ed|4ing|4olin|8ed|8ing|8s|4s|3e|4d|4s|4uver|8ed|8ing|8',
  's|3fred|7ed|7ing|7s|3ga|5ed|5ing|5s|4o|5ed|5ing|5s|4rove|8d|8s|7ing|3hattan|9ed|9ing|9s|3i|4a|5ed|5ing|5s|4ed|5s|4fest|8',
  'ation|Ded|Ding|Ds|8ed|Aed|Aing|As|8ing|8o|9ed|9ing|9s|8s|5old|8ed|8ing|8s|4ing|4la|6ed|6ing|6s|4ng|4pulate|Ad|As|9ing|Ao',
  'n|Ced|Cing|Cs|4s|3jeri|7ed|7ing|7s|3kind|7ed|7ing|7s|3lied|6s|4y|3n|4ed|5r|6ed|6ing|6s|7es|4ied|6s|5ng|7ed|7ing|7s|4s|4y',
  '|3olis|7es|4r|5ed|5ing|5s|3s|4es|4ion|7ed|7ing|7s|3tle|6d|6s|5ing|4ra|6ed|6ing|6s|3ual|6ed|6ing|6lied|9s|7y|6s|4el|6ed|6',
  'ing|6s|4facture|Bd|Br|Ced|Cing|Cs|Bs|Aing|4script|Aed|Aing|As|3y|2o|3ri|5ed|5ing|5s|3s|2p|3le|5d|5s|4ing|3s|2r|3a|4ed|4i',
  'ng|4s|4thi|7ed|7ing|7s|6on|8ed|8ing|8s|3ble|6d|6s|5ing|3c|4ed|5l|6ed|6ing|6s|4h|5ed|6s|5ing|4i|5a|6ed|6ing|6s|5ed|5ing|5',
  'ng|5s|4o|5ed|5ing|5s|6es|4s|3e|4d|4k|5ed|5ing|5s|4s|3garet|8ed|8ing|8s|6ita|9ed|9ing|9s|4e|5d|5s|4ie|6d|6s|5ing|5n|6al|8',
  'ed|8ing|8s|6ed|6g|6ing|6s|4ot|6ed|6ing|6s|4uerite|Ad|As|9ing|3i|4a|5ed|5ing|5n|6a|7ed|7ing|7s|6ed|6ing|6ne|8d|8s|7ing|6s',
  '|5s|4e|5d|5s|4ing|4juana|9ed|9ing|9s|4lyn|7ed|7ing|7s|4na|6ed|6ing|6s|5e|6d|6rs|6s|5g|5ing|4o|5ed|5ing|5n|6ed|6ing|6s|5s',
  '|5u|6ed|6ing|6s|4s|5es|4tal|7ed|7ing|7s|5ime|8d|8s|7ing|3jorie|8d|8s|7ing|3k|4ed|6ed|6ing|6lied|9s|7y|6s|5r|6ed|6ing|6s|',
  '5t|6able|Ad|As|9ing|6ed|6ing|9ed|9ing|9s|6s|4ing|7ed|7ing|7s|4o|5ed|5ing|5s|4s|4us|6es|3la|5ed|5ing|5s|4ena|7ed|7ing|7s|',
  '4ins|3nix|6es|3oon|6ed|6ing|6s|3quess|8es|5is|7es|3riage|8d|8s|7ing|5ed|7ed|7ing|7s|6s|4ow|6ed|6ing|6s|4y|5ing|8ed|8ing|',
  '8s|3s|4es|4h|5a|6ed|6ing|6l|7ed|7ing|7l|8ed|8ing|8s|7s|6s|5ed|6s|5ing|3t|4ed|4ha|6ed|6ing|6s|4ial|7ed|7ing|7s|6n|7ed|7in',
  'g|7s|5ed|6s|5n|6ed|7z|8es|6g|6ing|6s|4s|4y|5n|6ed|6ing|6s|5r|6ed|6ing|6s|3u|4ed|4ing|4s|3vel|6ed|6ing|6ous|9es|6s|4in|6e',
  'd|6ing|6s|3xism|7ed|7ing|7s|6t|7ed|7ing|7s|3y|4land|8ed|8ing|8s|2s|3anao|7ed|7ing|7s|5obu|8ed|8ing|8s|3cara|7ed|7ing|7s|',
  '4ot|6ed|6ing|6s|4uline|9d|9s|8ing|3es|3jid|6ed|6ing|6s|3k|4ed|6ed|6ing|6s|4ing|4s|3on|5ed|5ic|7ed|7ing|7s|6ng|5ried|8s|6',
  'y|5s|3s|4achusetts|Des|6re|8d|8s|7ing|5ge|7d|7s|6ing|4es|4if|6ed|6ing|6s|5ve|7d|7s|6ing|3t|4ed|5r|6ed|6ied|8s|7ng|6piece',
  '|Bd|Bs|Aing|6s|6y|4ing|4s|2t|3ch|5ed|6s|5ing|8ed|8ing|8s|3e|4d|4r|5ed|5ial|8ed|8ing|9zed|8s|6ng|5nal|8ed|8ing|8s|6itied|',
  'As|8y|5s|4s|3h|4ed|5matical|Ced|Cing|Cs|Aian|Ded|Ding|Ds|As|Bes|4ing|4s|3ing|6ed|6ing|6s|3rices|8es|5x|6es|3s|4es|3t|4ed',
  '|5r|6ed|6ing|6s|4hew|7ed|7ing|7s|5ias|8es|6eu|8ed|8ing|8s|4i|5ed|5ing|5ng|5s|4ress|8es|4s|3ure|6d|6s|5ing|6tied|9s|7y|2u',
  'd|4ed|4ing|4s|3reen|7ed|7ing|7s|4ice|7d|7s|6ing|3soleum|9ed|9ing|9s|2verick|8ed|8ing|8s|2x|3es|3im|5al|7ed|7ing|7s|5ed|5',
  'ing|6ze|8d|8s|7ing|5s|5um|7ed|7ing|7s|6s|7es|3well|7ed|7ing|7s|2y|3a|4ed|4ing|4s|3be|5d|5s|4ing|3er|5ed|5ing|5s|3fair|7e',
  'd|7ing|7s|3hem|6ed|6ing|6s|3o|4ed|4ing|4r|5al|7ed|7ing|7s|5ed|5ing|5s|4s|3s|2zda|5ed|5ing|5s|3e|4d|4s|3ing|1cintosh|8ed|',
  '9s|8ing|2kay|5s|1e|2ad|4ed|4ing|4ow|6ed|6ing|6s|4s|3l|4ed|4ing|4s|3n|4ed|4ing|7ed|7ful|Aed|Aing|As|7ing|7less|Bes|7s|4s|',
  '4t|5ed|5ing|5s|4while|9d|9s|8ing|3sure|7d|8ed|8ing|8s|7ment|Bed|Bing|Bs|7s|6ing|9ed|9ing|9s|3t|4ed|4ing|4s|2cca|5ed|5ing',
  '|5s|3hael|7ed|7ing|7s|5nic|8al|Aed|Aing|Alied|Ds|By|As|8ed|8ing|8s|9es|7sm|9ed|9ing|9s|7zed|2dal|5ed|5ing|6st|8ed|8ing|8',
  's|5lion|9ed|9ing|9s|5s|3ia|5ed|5ing|5l|6ed|6ing|6s|5n|6ed|6ing|6s|5s|5ted|6ion|9ed|9ing|9s|4c|5al|7ed|7ing|7s|6tion|Aed|',
  'Aing|As|5ed|5i|6ed|6ing|6nal|9ed|9ing|9s|7e|8d|8s|7g|7ing|6s|5s|4eval|8ed|8ing|8s|4na|6ed|6ing|6s|4tation|Aed|Aing|As|5e',
  'rranean|Ded|Ding|Ds|4um|6ed|6ing|6s|3ley|6s|2ehan|6ed|6ing|6s|3k|4ed|4ing|4s|5es|3t|4ed|4ing|7ed|7ing|7s|4s|2g|3s|2hrdad',
  '|7ed|7ing|7s|2in|4ed|4ing|4s|2l|3ancholied|Bs|9y|3ee|5ed|5ing|5s|3inda|7ed|7ing|7s|4ssa|7ed|7ing|7s|3lon|6ed|6ing|6s|3od',
  'ic|7ed|7ing|7s|6ed|7s|5y|3s|3t|4ed|6ed|6ing|6s|4ing|7ed|7ing|7s|4s|2m|3ber|6ed|6ing|6s|7hip|Aed|Aing|As|4rane|8d|8s|7ing',
  '|3o|4ed|4ing|5r|6ed|6ing|6s|4rabilia|Bed|Bing|Bs|7le|9d|9s|8ing|6ndum|Aed|Aing|As|5ial|8ed|8ing|8s|6ed|7s|5y|4s|3s|2n|3a',
  'ce|6d|6s|5ing|8ed|8ing|8s|3d|4ed|5s|4ing|4s|3g|4ed|4ing|4s|3s|3t|4al|6ed|6ing|7tied|As|8y|6lied|9s|7y|6s|4ed|4ing|5on|7e',
  'd|7ing|7s|4or|6ed|6ing|6s|4s|3u|4ed|4ing|4s|2r|3at|5ed|5ing|5s|3cantile|Ad|As|9ing|4edes|8es|5naried|As|8y|5r|6ed|6ing|6',
  's|4h|5andise|Bd|Bs|Aing|7t|8ed|8ing|8s|5ed|6s|5ing|4ied|6s|4uried|8s|6y|4y|3e|4d|4lied|7s|5y|4s|3ge|5d|5r|6ed|6ing|6s|5s',
  '|4ing|3idian|8ed|8ing|8s|4ng|4t|5ed|5ing|5orious|Bes|5s|3lin|6ed|6ing|6s|3maid|7ed|7ing|7s|3ried|6s|5l|6ed|6ing|6s|4y|3s',
  '|3ton|6ed|6ing|6s|2s|3a|4ed|4ing|4s|3es|3h|4ed|5s|4ing|3opotamia|Bed|Bing|Bs|3s|4age|7d|7s|6ing|4ed|5nger|9ed|9ing|9s|5s',
  '|4iah|7ed|7ing|7s|5ed|6s|5ng|7ed|7ing|7s|4y|2t|3a|4bolic|9ed|9ing|9s|8sm|Aed|Aing|As|4ed|4ing|4l|5ed|5ing|5lic|8ed|8ing|',
  '8s|5s|4phor|8ed|8ing|8s|6ysical|Ced|Cing|Cs|4s|3eor|6ed|6ing|6ological|Eed|Eing|Es|6s|4r|5ed|5ing|5s|3hane|7d|7s|6ing|4o',
  'd|6ed|6ing|7st|9ed|9ing|9s|6ologied|Cs|Ay|6s|4yl|6ed|6ing|6s|3in|5ed|5ing|5s|4s|5es|3re|5s|4ic|6ed|6ing|6s|7es|4opolis|A',
  'es|9tan|Ced|Cing|Cs|3s|2xican|7ed|7ing|7s|1iami|5ed|5ing|5s|2cah|5ed|5ing|5s|3e|4d|4s|3hael|7ed|7ing|7s|4eal|7ed|7ing|7s',
  '|5l|6ed|6ing|6le|8d|8s|7ing|6s|4iel|7ed|7ing|7s|5gan|8ed|8ing|8s|3ing|3k|4ed|5y|6s|4ied|6s|5ng|4s|4y|3ro|5ed|5ing|5phone',
  '|Ad|As|9ing|5s|6cope|Ad|As|9ic|Bed|Bing|Bs|Aed|Bs|Ang|9y|5wave|9d|9s|8ing|2d|3day|6s|4le|6d|6s|6weight|Ced|Cing|Cs|5ing|',
  '3land|7ed|7ing|7s|3night|8ed|8ing|8s|3s|4t|5ed|5ing|5s|4ummer|9ed|9ing|9s|3way|6s|4est|7ed|7ing|7s|2ek|4ed|4ing|4s|2g|3h',
  't|5ed|5ied|7s|6ng|5s|5y|3rant|7ed|7ing|7s|5te|7d|7s|6ing|7on|9ed|9ing|9s|6oried|As|8y|3s|3uel|6ed|6ing|6s|2kael|6ed|6ing',
  '|6s|3e|4d|4s|4y|5s|3i|4ed|4ing|4ng|4s|2l|3an|5ed|5ing|5s|3d|4ed|4ing|4lied|7s|5y|4red|7ed|7ing|7s|4s|3e|4d|4s|5es|5tone|',
  '9d|9s|8ing|3ing|4tant|8ed|8ing|8s|6ried|9s|7y|5ia|7ed|7ing|7s|3k|4ed|4ied|6s|5ng|4s|4y|3l|4ed|5nnia|9ed|9ing|9s|8um|Aed|',
  'Aing|As|5r|6ed|6ing|6s|4ie|6d|6s|5ing|5metre|As|5ng|7ed|7ing|7s|5on|7aire|Bd|Bs|Aing|7ed|7ing|7s|8es|4s|3ner|6ed|6ing|6s',
  '|3o|4ed|4ing|4s|3s|3tos|6es|2m|3i|4c|5ed|5ing|5s|4ed|4ing|4s|3s|2n|3a|4ed|4ing|4s|3d|4ed|6ed|6ing|6s|4ing|4s|3e|4d|4r|5a',
  'l|7ed|7ing|7s|5ed|5ing|5s|5va|7ed|7ing|7s|4s|5es|3g|4ed|4ing|4led|4s|3iature|9d|9s|8ing|4m|5al|7ed|7ing|7s|5ed|5ing|6ze|',
  '8d|8s|7ing|5s|5um|7ed|7ing|7s|4ng|6ed|6ing|6s|4ons|4ster|8ed|8ial|Bed|Bing|Bs|9ng|8s|6ried|9s|7y|3nie|6d|6s|5ing|3or|5ed',
  '|5ing|6tied|9s|7y|5s|3s|3t|4ed|4ing|4s|3us|5es|4te|6d|6s|5ing|2ocene|7d|7s|6ing|2r|3a|4cle|7d|7s|6ing|5ulous|Aes|4ed|4ge',
  '|6d|6s|5ing|4ing|4nda|7ed|7ing|7s|4s|3iam|6ed|6ing|6ne|8d|8s|7ing|6s|3ror|6ed|8ed|8ing|8s|6ing|6s|3s|3za|5ed|5ing|5s|2sc',
  'ellaneous|Des|4hief|8ed|8ing|8s|7vous|Bes|4onduct|Aed|Aing|As|3er|5able|9d|9s|8ing|5ed|5ied|7s|6ng|5s|5y|3leading|Aed|Ai',
  'ng|As|3s|4es|4ied|6s|5le|7d|7s|6ing|5ng|7ed|7ing|7s|5on|7aried|Bs|9y|7ed|7ing|7s|5ssippi|Bed|Bing|Bs|4ouri|8ed|8ing|8s|4',
  'y|3t|4ake|7d|7n|8ed|8ing|8lied|Bs|9y|8s|7s|6ing|4ed|5r|6ed|6ing|6s|4ied|6s|5ng|4ress|8es|4s|4y|3understanding|Fged|Fging',
  '|Fgs|Aood|Ded|Ding|Ds|2tch|5ed|6ll|8ed|8ing|8s|6s|5ing|3ochondrial|Ded|Ding|Ds|3t|4ed|4ing|4s|2x|3ed|5ed|5ing|5s|4r|5ed|',
  '5ing|5s|4s|3ing|3ture|7d|7s|6ing|1oan|4ed|4ing|7ed|7ing|7s|4s|3t|4ed|4ing|4s|2b|3ile|6d|6s|5ing|6tied|9s|7y|6zation|Ced|',
  'Cing|Cs|7ed|3s|2ck|4ed|4ing|4s|2d|3e|4d|4l|5ed|5ing|8ed|8ing|8s|5s|4r|5ate|8d|8lied|Bs|9y|8s|7ing|7or|9ed|9ing|9s|5n|6ed',
  '|6ing|7sm|9ed|9ing|9s|8t|9ed|9ing|9s|7zation|Ded|Ding|Ds|8ed|6s|5s|4s|5t|6ed|6ing|6s|3ification|Ced|Cing|Cs|6ed|7s|5y|4n',
  'g|3s|3ular|7ed|7ing|7s|6tion|Aed|Aing|As|5e|6d|6s|5ing|2e|3s|2hammad|8ed|8ing|8s|4wk|6ed|6ing|6s|2i|3s|4t|5ed|5ing|5s|5u',
  're|8d|8s|7ing|2jo|4ed|4ing|4s|2ld|4ed|4ing|4s|3e|4cular|9ed|9ing|9s|7e|8d|8s|7ing|4d|4s|3ing|3lied|6s|4usk|7ed|7ing|7s|4',
  'y|3ten|6ed|6ing|6s|2ment|6aried|As|9lied|Cs|Ay|8y|6ed|6ing|6s|6um|8ed|8ing|8s|3mied|6s|4y|2n|3a|4ed|4ing|4rch|7ed|8s|7ie',
  'd|9s|8ng|7y|4s|5teried|As|8y|6ic|8ed|8ing|8s|3day|6s|3etaried|9s|7y|4y|5s|3g|4ed|4ing|4o|5ed|5ing|5l|6ed|6ian|9ed|9ing|9',
  's|7ng|6s|5s|4s|3ica|6ed|6ing|6s|4ker|7ed|7ing|7s|4tor|7ed|7ing|7s|3k|4ed|5y|6s|4ing|4s|3mouth|8ed|8ing|8s|3o|4ed|4graph|',
  '9ed|9ing|9s|4ing|4polied|9s|7y|4s|3s|4ieur|8ed|8ing|8s|4oon|7ed|7ing|7s|4ter|7ed|7ing|7s|5rous|9es|3t|4ana|7ed|7ing|7s|6',
  'e|7d|7s|6ing|4e|5d|5negrin|Bed|Bing|Bs|5rey|8s|5s|4h|5ed|5ing|5lied|8s|6y|5s|4ied|6s|5ng|4s|4y|3ument|8al|Aed|Aing|As|8e',
  'd|8ing|8s|2od|4ed|4ied|6s|5ng|4s|4y|3n|4ed|4ing|4light|9ed|9ing|9s|4s|3r|4e|5d|5s|4ing|4s|5es|3se|5d|5s|4ing|2r|3a|4ed|4',
  'ing|4l|5e|6d|6s|5ing|6tied|9s|7y|5lied|8s|6y|5s|6es|4n|5ed|5ing|5s|4s|4vian|8ed|8ing|8s|3e|4d|4over|8ed|8ing|8s|4s|3gan|',
  '6ed|6ing|6s|3ing|3mon|6ed|6ing|6s|3ning|7ed|7ing|7s|8es|3occan|8ed|8ing|8s|6o|7ed|7ing|7s|3ph|5ed|5ing|5ological|Ded|Din',
  'g|Ds|Aed|Bs|9y|5s|3ris|6es|4ow|6ed|6ing|6s|3s|4e|5d|5s|4ing|3t|4al|6ed|6ing|7tied|As|8y|6lied|9s|7y|6s|5r|6ed|6ing|6s|4e',
  'd|4gage|8d|8s|7ing|4imer|8ed|8ing|8s|5ng|4on|6ed|6ing|6s|4s|2saic|6ed|6ing|6s|3cow|6ed|6ing|6s|3es|5es|3que|6d|6s|5ing|6',
  'to|8ed|8ing|8s|3s|4es|3t|4ed|4ing|4lied|7s|5y|4s|3ul|5ed|5ing|5s|4r|5ed|5ing|5s|2t|3el|5ed|5ing|5s|3h|4ed|5r|6ed|6ing|6s',
  '|4ing|4s|3if|5ed|5ing|5s|4on|6ed|6ing|6less|Aes|6s|4vated|7ion|Aed|Aing|As|5e|6d|6s|5ing|3or|5cycle|Ad|As|9ing|5ed|5ing|',
  '6zed|5s|5way|8s|3s|3t|4ed|4ing|4o|5ed|5ing|5s|4s|2und|5ed|5ing|5s|4t|5ain|8ed|8ing|8ous|Bes|8s|5ed|7ed|7ing|7s|5ing|8ed|',
  '8ing|8s|5s|3rning|8ed|8ing|8s|3se|5d|5s|4ing|3th|5ed|7ed|7ing|7s|5ful|8ed|8ing|8s|5ing|5s|2ve|4d|4ment|8ed|8ing|8s|4s|3i',
  'e|5d|5s|4ing|4ng|6ed|6ing|6s|2zambique|Ad|As|9ing|1r|2s|3es|1s|1uch|4ed|5s|4ing|2d|3died|6s|4y|3s|2ffled|7ed|7ing|7s|2g|',
  '3s|2ir|4ed|4ing|4s|2le|4d|4s|3ing|3l|4ed|5r|6ed|6ing|6s|4ing|4s|3t|4ed|4inational|Ded|Ding|Ds|6g|5ple|8d|8s|7ication|Eed',
  '|Eing|Es|8ed|8ng|5tude|9d|9s|8ing|4s|2m|3bai|4led|3mied|6s|4y|3s|2n|3dane|7d|7s|6ing|3ich|6ed|7s|6ing|5ipal|9ed|9ing|Ati',
  'ed|Ds|By|9s|4tions|9es|3s|2ral|5ed|5ing|5s|4t|5ed|5ing|5s|3der|6ed|7r|8ed|8ing|8s|6ing|9ed|9ing|9s|6ous|9es|6s|3iel|6ed|',
  '6ing|6s|3mur|6ed|6ing|6s|3ph|5ed|5ied|7s|6ng|5s|5y|3ray|6s|3thied|7s|5y|2s|3a|4ed|4ing|4s|3cle|6d|7ed|7ing|7s|6s|5ing|4u',
  'lar|8ed|8ing|8s|3e|4d|5ed|5ing|5s|4s|4um|6ed|6ing|6s|3h|4ed|5s|4ing|4room|8ed|8ing|8s|3ic|5al|7ed|7ing|7lied|As|8y|7s|5e',
  'd|5ian|8ed|8ing|8s|6ng|5s|4ng|3k|4ed|4ing|4s|3t|4ache|8d|8s|7ing|5ng|7ed|7ing|7s|5rd|7ed|7ing|7s|4ed|5r|6ed|6ing|6s|4ing',
  '|4s|2tant|6ed|6ing|6s|4tion|8ed|8ing|8s|3e|4d|4s|3ing|5ied|7s|5y|3ter|6ed|6ing|9ed|9ing|9s|6s|3ual|6ed|6ing|6lied|9s|7y|',
  '6s|2zzle|6d|6s|5ing|1wa|3s|1y|2ra|4ed|4ing|4s|3iad|6ed|6ing|6s|4ck|6ed|6ing|6s|3on|5ed|5ing|5s|3tle|6d|6s|5ing|2self|6ed',
  '|6ing|6s|3ore|6d|6s|5ing|3t|4ed|5r|6ied|8s|7ous|Aes|Alied|Ds|By|6s|6y|4ic|6al|8ed|8ing|8s|6ed|6ing|6s|5ng|4s|2th|4ed|4ic',
  'al|8ed|8ing|8s|5ng|4ological|Ced|Cing|Cs|9ed|As|8y|4s|0nadeem|6ed|6ing|6s|2g|3a|4ed|4ing|4s|3s|2il|4ed|4ing|4s|3m|4ed|4i',
  'ng|4s|3r|4ed|4ing|4s|3ve|5d|5s|4ing|2k|3ed|5ed|5ing|5s|3s|2m|3aste|3e|4d|4lied|7s|5y|4s|5ake|8d|8s|7ing|3ing|6ed|6ing|6s',
  '|3s|2n|3a|4ed|4ing|4s|3cied|6s|4y|3da|5ed|5ing|5s|3nied|6s|4y|3s|2omi|5ed|5ing|5s|3to|5ed|5ing|5s|2p|3e|4d|4s|3ing|3kin|',
  '6ed|6ing|6s|3oleon|8ed|8ic|Aed|Aing|As|9ng|8s|3s|2r|3cotics|3en|5dra|8ed|8ing|8s|5ed|5ing|5s|4sh|6ed|7s|6ing|3r|4ated|6i',
  'on|9ed|9ing|9s|7ve|9d|9s|8ing|6or|8ed|8ing|8s|4ed|4ing|4ow|6ed|7r|8ed|8ing|8s|6ing|6lied|9s|7y|6s|4s|3s|2sal|5ed|5ing|5s',
  '|3h|4ed|5s|4ing|3sau|6ed|6ing|6s|3tied|6s|4y|2t|3al|5ed|5ia|7ed|7ing|7s|6e|7d|7s|6ing|6ng|5s|3e|4d|4s|3han|6ed|6iel|9ed|',
  '9ing|9s|7ng|6s|3ing|4on|6al|8ed|8ing|9sm|Bed|Bing|Bs|At|Bed|Bing|Bs|9tied|Cs|Ay|8lied|Bs|9y|8s|6ed|6ing|6s|6wide|Ad|As|9',
  'ing|4ve|6d|6s|5ing|3raj|6ed|6ing|6s|3s|3ural|7ed|7ing|8st|Aed|Aing|As|8zed|7lied|As|8y|7s|5e|6d|6s|5ing|2ughtied|8s|6y|3',
  'sea|6ed|6ing|6s|3tical|8ed|8ing|8s|2vajo|6ed|6ing|6s|4l|5ed|5ing|5s|3e|4d|4s|3ied|5s|4gable|9d|9s|8ing|6te|8d|8s|7ing|8o',
  'n|Aed|Aing|As|7or|9ed|9ing|9s|4ng|3y|2wab|5ed|5ing|5s|2y|3s|2zi|4ed|4ing|4s|1eal|4ed|4ing|4s|3r|4bied|7s|5y|4ed|5r|6s|5s',
  't|7ed|7ing|7s|4ing|4lied|7s|5y|4s|3t|4ed|4ing|4lied|7s|5y|4s|2bula|6ed|6ing|6s|2cessaried|As|9lied|Cs|Ay|8y|6itated|8ied',
  '|As|8y|3k|4ed|4ing|4lace|8d|8s|7ing|4s|3tar|6ed|6ing|6s|2d|3s|2e|3d|4ed|4ied|6s|5ng|7ed|7ing|7s|4le|6d|6s|7es|5ing|4s|5e',
  's|4y|3s|2gative|8d|8lied|Bs|9y|8s|7ing|3lect|7ed|7ing|7s|4igence|Ad|As|9ing|3otiate|9d|9s|8ing|9on|Bed|Bing|Bs|3ro|5ed|5',
  'ing|5s|2igh|5bor|8ed|8hood|Ced|Cing|Cs|8ing|Bed|Bing|Bs|8s|7ur|9s|5ed|5ing|5s|3l|4ed|4ing|4s|3ther|7ed|7ing|7s|2lken|6ed',
  '|6ing|6s|3l|4ed|4ie|6d|6s|5ing|5ng|4s|4y|3son|6ed|6ing|6s|2mesis|7es|2o|3lithic|9ed|9ing|9s|3n|4ed|4ing|4s|3s|2p|3al|5ed',
  '|5i|6ed|6ing|6ng|6s|5s|3hew|6ed|6ing|6s|3s|3tune|7d|7s|6ing|2rve|5d|5s|4ing|4ous|7es|7lied|As|8y|2ss|4es|3t|4ed|4ing|4le',
  'd|4or|6ed|6ing|6s|4s|2t|3ball|7ed|7ing|7s|3her|6ed|6ing|6s|3s|3ting|7ed|7ing|7s|3work|7ed|7ing|7s|2ural|6ed|6ing|6s|4olo',
  'gical|Ced|Cing|Cs|5ns|3tral|7ed|7ing|8tied|Bs|9y|7s|5on|7ed|7ing|7s|2vada|6ed|6ing|6s|3er|5ed|5ing|5s|5theless|Ces|3ille',
  '|7d|7s|6ing|2w|3castle|9d|9s|8ing|4omer|8ed|8ing|8s|3er|5s|4st|3foundland|Ced|Cing|Cs|3lied|6s|4y|3market|9ed|9ing|9s|3p',
  'ort|7ed|7ing|7s|3s|4cast|8ed|8ing|8s|4es|4letter|Aed|Aing|As|4paper|9ed|9ing|9s|3t|4ed|4ing|4on|6ed|6ing|6s|4s|2xt|4ed|4',
  'ing|4s|3us|5es|1guyen|6ed|6ing|6s|1han|4ed|4ing|4s|1iagara|7ed|7ing|7s|3ll|5ed|5ing|5s|2caragua|9ed|9ing|9s|3e|4d|4lied|',
  '7s|5y|4s|3hael|7ed|7ing|7s|4e|5d|5s|4ing|4olas|8es|3i|4ed|4ing|4ng|4s|3k|4ed|5l|6ed|6ing|6odeon|Bed|Bing|Bs|6s|4ied|6s|5',
  'ng|4name|8d|8s|7ing|4s|4y|3olas|7es|5ette|9d|9s|8ing|5o|6ed|6ing|6s|4tine|8d|8s|7ing|2ece|5d|5s|4ing|3ls|5es|2g|3el|5ed|',
  '5ing|5s|4r|5ian|8ed|8ing|8s|5s|3ht|5ed|5fall|9ed|9ing|9s|5ing|8ale|Bd|Bs|Aing|5lied|8s|6y|5mare|9d|9s|8ing|5s|6es|5time|',
  '9d|9s|8ing|3s|2kolai|7ed|7ing|7s|2l|3e|4d|4s|3ing|3s|4es|2na|4ed|4ing|4s|3e|4d|4s|4teen|8ed|8ing|8s|8th|Aed|Aing|As|5ied',
  '|7s|5y|3g|4ed|4ing|4s|3ing|3ja|5ed|5ing|5s|3th|5ed|5ing|5s|2pple|6d|6s|5ing|2rvana|7ed|7ing|7s|2t|3rate|7d|7s|6ing|4ogen',
  '|8ed|8ing|8s|3s|2x|3es|1o|2ah|4ed|4ing|4s|3m|4ed|4ing|4s|2b|3ilitied|9s|7y|3le|5d|5man|8ed|8ing|8s|5s|4ing|3odied|7s|5y|',
  '3s|2ctuidae|9d|9s|8ing|5rnal|9ed|9ing|9s|2d|3ding|7ed|7ing|7s|3e|4d|4s|3ing|3s|2el|4ed|4ing|4s|3mi|5ed|5ing|5s|2ir|4ed|4',
  'ing|4s|3se|5d|5s|4ied|6s|5ng|4y|2madic|7ed|7ing|7s|3enclature|Cd|Cs|Bing|3inal|7ed|7ing|7lied|As|8y|7s|6te|8d|9ed|9ing|9',
  's|8s|7ing|8on|Aed|Aing|As|5ee|7ed|7ing|7s|2n|3e|4d|4s|4theless|Bes|3fiction|Aed|Aing|As|3ing|3linear|9ed|9ing|9s|3profit',
  '|9ed|9ing|9s|3s|4ense|8d|8s|7ing|4top|7ed|7ing|7s|2odles|3n|4ed|4ing|4s|2pe|4d|4s|3ing|2r|3a|4ed|4ing|4s|3bert|7ed|7ing|',
  '7s|3dic|6ed|6ing|6s|3folk|7ed|7ing|7s|3m|4a|5ed|5ing|5l|6ed|6ing|6lied|9s|7y|6s|5n|6ed|6ing|6s|5s|4ed|4ing|4s|3s|4e|5d|5',
  's|4ing|3th|5bound|Aed|Aing|As|5east|9ed|Arn|Ced|Cing|Cs|9ing|9s|6d|6rn|8ed|8ing|8most|Ced|Cing|Cs|8s|5ing|5s|5ward|9ed|9',
  'ing|9s|Aes|6est|9ed|Arn|Ced|Cing|Cs|9ing|9s|3way|6s|4egian|9ed|9ing|9s|2se|4d|5ed|5ing|5s|4s|3ing|3talgia|9ed|9ing|9s|4r',
  'ils|2t|3able|7d|7s|6ied|8s|7ng|6y|4tion|8ed|8ing|8s|3ch|5ed|6s|5ing|3e|4book|8ed|8ing|8s|4d|5ed|5ing|5s|4s|4worthied|Bs|',
  '9y|3hing|7ed|7ing|7s|3ice|6able|Ad|As|9ied|Bs|Ang|9y|6d|6s|5ing|4fication|Ced|Cing|Cs|6ed|8ed|8ing|8s|7s|5y|4ng|4on|6ed|',
  '6ing|6s|3orietied|As|8y|6ous|9es|3s|3withstanding|Fed|Fing|Fs|2u|3n|4ed|4ing|4s|3s|2va|4ed|4ing|4s|3el|5ed|5ing|6st|8ed|',
  '8ing|8s|5la|7ed|7ing|7s|5s|5tied|8s|6y|4mber|8ed|8ing|8s|3ice|6d|6s|5ing|3o|4ed|4ing|4rolskied|Bs|9y|4s|2w|3adays|8es|3h',
  'ere|7d|7s|6ing|3s|1uclear|7ed|7ing|7s|5i|6ed|6ing|6s|5us|7es|2de|4d|4s|3ged|3ing|2ll|4ed|4ing|4s|2mb|4ed|5r|6ed|6ing|6s|',
  '4ing|4s|3erical|9ed|9ing|9s|5ous|8es|2n|3s|2rse|5d|5ried|8s|6y|5s|4ing|7ed|7ing|7s|2t|3rient|8ed|8ing|8s|5tion|9al|Bed|B',
  'ing|Bs|9ed|9ing|9s|3s|1ylon|5ed|5ing|5s|0oak|3s|2sis|5es|2th|4ed|4ing|4s|1be|3d|4ience|9d|9s|8ing|3s|4e|5d|5s|4ing|5tied',
  '|8s|6y|3y|4s|2ituaried|9s|7y|2ject|6ed|6ing|7on|9ed|9ing|9s|7ve|9d|9s|8ing|6s|2ligation|Aed|Aing|As|7oried|Bs|9y|5ed|7ed',
  '|7ing|7s|4que|7d|7s|6ing|4vion|8ed|8ing|8s|7us|9es|2oe|4ed|4ing|4s|2scene|7d|7s|6ing|4ure|7d|7s|6ing|3ervation|Bed|Bing|',
  'Bs|8oried|Cs|Ay|6e|7d|7r|8ed|8ing|8s|7s|6ing|9ed|9ing|9s|4ssion|9ed|9ing|9s|3idian|8ed|8ing|8s|3olete|8d|8s|7ing|3tacle|',
  '8d|8s|7ing|4ruction|Bed|Bing|Bs|2tain|6ed|6ing|6s|2vious|7es|7lied|As|8y|1ccasion|8al|Aed|Aing|Alied|Ds|By|As|8ed|8ing|8',
  's|3ult|6ed|6ing|6s|4pants|6tion|Aal|Ced|Cing|Cs|Aed|Aing|As|5ied|7s|5y|4r|5ed|5ing|5rence|Ad|As|9ing|5s|2ean|5ed|5ic|7ed',
  '|7ing|7s|6ng|5s|2h|3es|3reous|8es|2tagonal|9ed|9ing|9s|4ve|6d|6s|5ing|3ober|7ed|7ing|7s|4pus|7es|1dd|3lied|6s|4y|3s|4es|',
  '2e|3d|3r|4s|3s|2ia|3n|4ed|4ing|4s|3sha|2or|4ed|4ing|4s|2yssey|7s|1f|2er|4ed|4ing|4s|2f|3ence|5ded|8ed|8ing|8s|7r|8ed|8in',
  'g|8s|5se|7d|7s|6ing|7ve|9d|9s|8ing|4r|5ed|5ing|8ed|8ing|8s|5s|3ice|6d|6r|7ed|7ing|7s|6s|5ial|8ed|8ing|8lied|Bs|9y|8s|6ng',
  '|3line|3s|4et|6ed|6ing|6s|4hore|8d|8s|7ing|4pring|9ed|9ing|9s|2ten|5ed|5ing|5s|1h|2io|4ed|4ing|4s|1il|3ers|3s|1k|2lahoma',
  '|8ed|8ing|8s|1laf|4ed|4ing|4s|2d|3er|5ed|5ing|5s|4st|3ies|3s|2e|3d|3g|4ed|4ing|4s|3s|2ga|4ed|4ing|4s|2ive|5d|5r|6ed|6ing',
  '|6s|5s|4ia|6ed|6ing|6s|5er|7ed|7ing|7s|5ng|2lie|5d|5s|4ing|2of|4ed|4ing|4s|2son|5ed|5ing|5s|2ympia|7d|8ed|8ing|8s|7ed|7i',
  'ng|7n|8ed|8ing|8s|7s|6c|7ed|7ing|7s|5us|7es|1maha|5ed|5ing|5s|3n|4ed|4ing|4s|3r|4ed|4ing|4s|2ega|5ed|5ing|5s|2inous|7es|',
  '2nibus|7es|1n|2ce|4d|4s|3ing|2e|3d|3s|4elf|7ed|7ing|7s|2going|7ed|7ing|7s|2ion|5ed|5ing|5s|2lied|5s|4ne|3y|2set|5ed|5ing',
  '|5s|3laught|9ed|9ing|9s|2to|4ed|4ing|4s|2ward|6ed|6ing|6s|7es|1paque|6d|6s|5ing|2en|4ed|5r|6ed|6ing|6s|4ing|7ed|7ing|7s|',
  '4lied|7s|5y|4s|3r|4a|5ed|5ing|5s|5te|7d|7s|6ic|8ed|8ing|8s|7ng|9ed|9ing|9s|7on|9al|Bed|Bing|Bs|9ed|9ing|9s|7ve|9d|9s|8in',
  'g|6or|8ed|8ing|8s|4s|2ined|4ion|7ed|7ing|7s|3um|5ed|5ing|5s|2ponent|8ed|8ing|8s|4rtunitied|Cs|Ay|4se|6d|7ed|7ing|7s|6s|5',
  'ing|8ed|8ing|8s|6te|8d|8s|7ing|8on|Aed|Aing|As|3ression|Aed|Aing|As|8ve|Ad|As|9ing|2t|3ic|5al|7ed|7ing|7s|5ed|5ing|5s|6e',
  's|4mal|7ed|7ing|7s|5ism|8ed|8ing|8s|7tic|Aed|Aing|As|6zation|Ced|Cing|Cs|4on|6al|8ed|8ing|8s|6ed|6ing|6s|3s|2us|4es|1r|2',
  'acle|6d|6s|5ing|3l|4ed|4ing|4s|3nge|6d|6s|5ing|2b|3it|5al|7ed|7ing|7s|5ed|5ing|5s|3s|2c|3hard|7ed|7ing|7s|4estra|9ed|9in',
  'g|9l|Aed|Aing|As|9s|9ted|4id|6ed|6ing|6s|3s|2dained|3eal|6ed|6ing|6s|4r|5ed|7ed|7ing|7s|5ing|5lied|8s|6y|5s|3inance|9d|9',
  's|8ing|6ried|9s|7y|6tion|Aed|Aing|As|3nance|8d|8s|7ing|2e|3d|3s|2gan|5ed|5ic|7ed|7ing|7s|6ng|6sed|7m|8ed|8ing|8s|7t|8ed|',
  '8ing|8s|6zation|Cal|Eed|Eing|Es|Ced|Cing|Cs|7e|8d|9ed|9ing|9s|8r|9ed|9ing|9s|8s|7ing|5s|4sm|6ed|6ing|6s|2ient|6al|8ed|8i',
  'ng|8s|7tion|Bed|Bing|Bs|6ed|6ing|6s|3gin|6al|8ed|8ing|8lied|Bs|9y|8s|7te|9d|9s|8ing|6ed|6ing|6s|3oles|4n|5ed|5ing|5s|2la',
  'ndo|7ed|7ing|7s|3eans|7es|2namental|Aed|Aing|As|8s|4te|6d|6s|5ing|2phan|6ed|6ing|6s|2son|5ed|5ing|5s|2thodox|8es|8ied|As',
  '|8y|5gonal|Aed|Aing|As|2ville|7d|7s|6ing|1scar|5ed|5ing|5s|2kar|5ed|5ing|5s|2tensiblied|Bs|9y|2wald|6ed|6ing|6s|1ther|5e',
  'd|5ing|5s|5wise|9d|9s|8ing|2is|4es|2tawa|6ed|6ing|6s|3er|5ed|5ing|5s|3o|4ed|4ing|4man|7ed|7ing|7s|4s|1ught|5ed|5ing|5s|2',
  'nce|5d|5s|4ing|2r|3s|4elves|9es|5s|2sted|2t|3break|8ed|8ing|8s|4urst|8ed|8ing|8s|3come|7d|7s|6ing|3dated|8ed|8ing|8s|4oo',
  'r|7ed|7ing|7s|8es|3er|5ed|5ing|5s|3fielder|Aed|Aing|As|5t|6ed|6ing|6s|3going|8ed|8ing|8s|3ing|6ed|6ing|6s|3law|6ed|6ing|',
  '6s|4et|6ed|6ing|6s|4ine|7d|8ed|8ing|8s|7s|6ing|4ook|7ed|7ing|7s|4ying|8ed|8ing|8s|3numbered|3post|7ed|7ing|7s|4ut|6ed|6i',
  'ng|6s|3rage|7d|7ous|Aes|7s|6ing|4each|8ed|9s|8ing|4ight|8ed|8ing|8s|3s|4et|6ed|6ing|6s|4ide|7d|7r|8ed|8ing|8s|7s|6ing|4k',
  'irts|4poken|9ed|9ing|9s|4tanding|Bed|Bing|Bs|5retched|3ward|7ed|7ing|7s|1val|4ed|4ing|4s|2en|4ed|4ing|4s|3r|4all|7ed|7in',
  'g|7s|4board|9ed|9ing|9s|4come|8d|8s|7ing|4dose|8d|8s|7ing|4ed|4grown|9ed|9ing|9s|4haul|8ed|8ing|8s|5ead|8ed|8ing|8s|4ing',
  '|4land|8ed|8ing|8s|6p|7ed|7ing|7s|5ied|7s|5ook|8ed|8ing|8s|5y|4night|9ed|9ing|9s|4ride|8d|8s|7ing|5un|7ed|7ing|7s|4s|5ea',
  's|8es|6e|7ed|7ing|7n|8ed|8ing|8s|7s|5hadowed|5ight|9ed|9ing|9s|6zed|9ed|9ing|9s|4t|5ed|5hrow|9ed|9ing|9s|5ime|8d|8s|7ing',
  '|6ng|5s|5ure|8d|8s|7ing|7n|8ed|8ing|8s|4view|8ed|8ing|8s|4whelmed|9ing|Ced|Cing|Clied|Fs|Dy|Cs|1we|3d|3n|4ed|4ing|4s|3s|',
  '2ing|5ed|5ing|5s|2l|3s|2n|3er|5ed|5ing|5s|6hip|9ed|9ing|9s|3s|1x|2ford|6ed|6ing|6s|2idation|9ed|9ing|9s|4e|5d|5s|4ing|3e',
  'd|4s|2y|3gen|6ed|6ing|6s|1yster|6ed|6ing|6s|1zan|4ed|4ing|4s|2one|5d|5s|4ing|0pablo|5ed|5ing|5s|2c|3e|4d|5ed|5ing|5s|4s|',
  '3ific|7ed|7ing|7s|4ng|3k|4age|7d|7s|6ing|4ed|5rs|5t|6ed|6ing|6s|4ing|4s|3s|3t|4ed|4ing|4s|2d|3died|6s|4le|6d|6s|5ing|4y|',
  '3re|5d|5s|4ing|3s|2gan|5ed|5ing|5s|3e|4ant|7ed|7ing|7s|4d|4s|3ing|3oda|6ed|6ing|6s|2in|4ed|6ed|6ing|6s|4ful|7ed|7ing|7li',
  'ed|As|8y|7s|4ing|4s|4t|5ed|7ed|7ing|7s|6r|7ed|7ing|7s|5ing|8ed|8ing|8s|5s|3r|4ed|6ed|6ing|6s|4ing|4s|3sley|7s|2jamas|2ki',
  'stani|9ed|9ing|9s|2l|3ace|6d|6s|5ing|4tinate|Ad|As|9ing|7e|8d|8s|7ing|3e|4d|4r|5ed|5ing|5mo|7ed|7ing|7s|5s|4s|5t|6inian|',
  'Bed|Bing|Bs|4tte|7d|7s|6ing|3i|4ed|4ing|4ng|4s|3m|4a|5ed|5ing|5s|4ed|5r|6ed|6ing|6s|4ing|4s|3s|2m|3ela|6ed|6ing|6s|3phle',
  't|8ed|8ing|8s|3s|2n|3acea|7ed|7ing|7s|4ma|6ed|6ing|6s|3cakes|4hayat|9ed|9ing|9s|3d|4a|5ed|5ing|5s|4ed|4ing|5t|4ora|7ed|7',
  'ing|7s|4s|3el|5ed|5ing|5s|3g|4ed|4ing|4s|3ic|5ed|5ing|5ked|8ed|8ing|8s|5s|3orama|8ed|8ing|8s|4s|5es|3s|3t|4ed|5lis|8es|4',
  'heon|8ed|8ing|8s|6r|7ed|7ing|7s|4ies|7es|5ng|7ed|7ing|7s|4ried|7s|5y|4s|5es|3zer|6ed|6ing|6s|2ola|5ed|5ing|5s|4o|5ed|5in',
  'g|5s|2p|3a|4cied|7s|5y|4ed|4ing|4l|5ed|5ing|5s|4s|3er|5back|9ed|9ing|9s|5ed|5ing|5s|3s|3yrus|7es|2r|3a|4chute|9d|9s|8ing',
  '|4de|6d|6s|5igm|8ed|8ing|8s|6ng|6se|8d|8s|7ing|5ox|7es|4ed|4graph|9ed|9ing|9s|5uay|8s|4ing|4llel|8ed|8ing|8s|5ysis|9es|6',
  'zed|4m|5ed|6ter|9ed|9ing|9s|5ilitaried|Ds|By|6ng|5ount|9ed|9ing|9s|5s|4noia|8ed|8ing|8s|7d|8ed|8ing|8s|6rmal|Aed|Aing|As',
  '|4pet|7ed|7ing|7s|4s|5ite|8d|8s|7ic|9ed|9ing|9s|8ng|3cel|6ed|6ing|6s|4hment|9ed|9ing|9s|3don|6ed|6ing|6s|3ent|6al|8ed|8i',
  'ng|8s|6ed|6heses|Bes|7ood|Aed|Aing|As|6ing|6s|3is|5es|5h|6ed|7s|6ing|5ian|8ed|8ing|8s|3k|4ed|5r|6ed|6ing|6s|4ing|7ed|7in',
  'g|7s|4s|4way|7s|3liament|Aaried|Es|Cy|Aed|Aing|As|4or|6ed|6ing|6s|3ma|5ed|5ing|5s|3ochial|9ed|9ing|9s|4died|7s|5y|4le|6d',
  '|6s|5ing|3ried|6s|4ot|6ed|6ing|6s|4y|3s|4e|5d|5s|4ing|4ons|3t|4ed|6ed|6ing|6s|4ial|7ed|7ing|7lied|As|8y|7s|5cipant|Bed|B',
  'ing|Bs|9te|Bd|Bs|Aing|Bon|Ded|Ding|Ds|6le|8d|8s|7ing|6ular|Aed|Aing|Alied|Ds|By|As|5ed|6s|5ng|5san|8ed|8ing|8s|5tion|9ed',
  '|9ing|9s|4lied|7s|5y|4ner|7ed|7ing|7s|8hip|Bed|Bing|Bs|4ridge|9d|9s|8ing|4s|4y|2scal|6ed|6ing|6s|3ha|5ed|5ing|5s|3s|4age',
  '|7d|7s|7way|As|6ing|4ed|5nger|9ed|9ing|9s|5s|4ing|7ed|7ing|7s|5on|7ate|Ad|As|9ing|7ed|7ing|7s|5ve|7d|7s|6ing|4port|8ed|8',
  'ing|8s|4word|8ed|8ing|8s|3t|4e|5d|5s|4ing|4or|6al|8ed|8ing|8s|6ed|6ing|6s|4ried|7s|5y|4s|4ure|7d|7s|6ing|2t|3ch|5ed|6s|5',
  'ing|3el|5ed|5ing|5s|4nt|6ed|6ing|6s|4rnal|8ed|8ing|8s|3h|4ed|5tic|8ed|8ing|8s|4ing|4ogen|8ed|8ing|8s|5logied|As|8y|4s|4w',
  'ay|7s|3ience|8d|8s|7ing|6t|7ed|7ing|7lied|As|8y|7s|4o|5ed|5ing|5s|3riarch|9ed|As|9ing|5ce|7d|7s|6ia|8ed|8ing|8s|7ng|7o|8',
  'ed|8ing|8s|6k|7ed|7ing|7s|5ot|7ed|7ic|9ed|9ing|9s|8ng|7s|4ol|6ed|6ing|6s|5n|6age|9d|9s|8ing|6ed|6ing|6s|3s|4ied|6s|4y|3t',
  'ed|5rn|7ed|9ed|9ing|9s|7ing|7s|4ied|6s|5ng|4y|2u|3l|4a|5ed|5ing|5s|4ed|4ine|7d|7s|6g|6ing|4s|3s|4e|5d|5s|4ing|2ved|4ment',
  '|8ed|8ing|8s|3ilion|8ed|8ing|8s|4ng|6ed|6ing|6s|2w|3n|4ed|4ing|4s|3s|2y|3ing|6ed|6ing|6s|3ment|7ed|7ing|7s|3roll|7ed|7in',
  'g|7s|3s|1ea|3ce|5d|5ful|8ed|8ing|8lied|Bs|9y|8s|5s|4h|5ed|6s|5ing|4ing|4ock|7ed|7ing|7s|3k|4ed|6ed|6ing|6s|4ing|7ed|7ing',
  '|7s|4s|3nut|6ed|6ing|6s|3r|4ed|4ing|4l|5ed|5ing|5s|4s|3s|4ant|7ed|7ing|7s|3t|4ed|4ing|4s|2bbles|2ck|4ed|4ing|4s|3uliar|8',
  'ed|8ing|8s|2d|3al|5ed|5ing|5s|3est|6al|8ed|8ing|8s|6rian|Aed|Aing|As|3iatric|9ed|9ing|9s|3ro|5ed|5ing|5s|3s|2e|3k|4ed|4i',
  'ng|4s|3l|4ed|6ed|6ing|6s|4ing|7ed|7ing|7s|4s|3r|4age|7d|7s|6ing|4ed|4ing|4s|3s|2g|3asus|7es|3gied|6s|4y|3s|2king|6ed|6in',
  'g|6s|2mbroke|8d|8s|7ing|2n|3al|5ed|5ing|5s|5tied|8s|6y|4ng|6ed|6ing|6s|3ce|5d|5s|4il|6ed|6ing|6s|5ng|3dant|7ed|7ing|7s|4',
  'ing|7ed|7ing|7s|4ulum|8ed|8ing|8s|3elope|8d|8s|7ing|4trate|9d|9s|8ing|Bed|Bing|Bs|9on|Bed|Bing|Bs|3guin|7ed|7ing|7s|3ins',
  'ula|9ed|9ing|9r|Aed|Aing|As|9s|4s|5es|4tentiaried|Ds|By|3nant|7ed|7ing|7s|4ied|6s|4sylvania|Ced|Cing|Cs|4y|3s|4acola|9ed',
  '|9ing|9s|4ion|7ed|7ing|7s|3t|4agon|8ed|8ing|8s|4ed|4house|9d|9s|8ing|4ing|4s|3ultimate|Bd|Bs|Aing|2ople|6d|6s|5ing|2p|3p',
  'er|6ed|6ing|6s|3s|3tide|7d|7s|6ing|2r|3ceive|8d|8s|7ing|5nt|7age|Ad|As|9ing|7ed|7ing|7s|5ption|Aed|Aing|As|4h|5ed|6s|5in',
  'g|4ied|6s|5val|8ed|8ing|8s|4ussion|Aed|Aing|As|4y|3eira|7ed|7ing|7s|4nnial|9ed|9ing|9s|3fect|7ed|7ing|8on|Aed|Aing|As|7l',
  'ied|As|8y|7s|4orm|7ance|Bd|Bs|Aing|7ed|8r|9ed|9ing|9s|7ing|7s|4ume|7d|7s|6ing|3haps|7es|3imeter|9ed|9ing|9s|4od|6ed|6ic|',
  '8al|Aed|Aing|Alied|Ds|By|As|8ed|8ing|8s|7ng|6s|4pheral|Aed|Aing|As|8ied|As|8y|4shed|8ed|8ing|8s|3kins|3m|4anent|9ed|9ing',
  '|9lied|Cs|Ay|9s|4ed|4ing|5ssion|Aed|Aing|As|5t|6ed|6ing|6s|6ted|9ed|9ing|9s|4s|3pendicular|Ded|Ding|Ds|5trators|6ual|9ed',
  '|9ing|9s|3ried|6s|4y|3s|4ecuted|8ion|Bed|Bing|Bs|5s|4ian|7ed|7ing|7s|5st|7ed|8nce|Bd|Bs|Aing|9t|Aed|Aing|As|7ing|7s|4on|',
  '6a|7ed|7ing|7l|8ed|8ing|9tied|Cs|Ay|8lied|Bs|9y|8s|7s|6ed|6ing|6nel|9ed|9ing|9s|6s|4pective|Bd|Bs|Aing|4uade|8d|9ed|9ing',
  '|9s|8s|7ing|6sion|Aed|Aing|As|3taining|Aed|Aing|As|3u|4ed|4ing|4s|4vian|8ed|8ing|8s|2st|4ed|4ing|4s|2t|3als|3e|4d|4r|5ed',
  '|5ing|5s|4s|3ing|4t|5e|6d|6s|5ing|6on|8ed|8ing|8s|5s|3r|4ed|4ing|4ol|6ed|7um|9ed|9ing|9s|6ing|6s|4s|3s|3tied|6s|4y|2w|3s',
  '|2yton|6ed|6ing|6s|1hantom|7ed|7ing|7s|3raoh|7ed|7ing|7s|4maceutical|Eed|Eing|Es|7ied|9s|7y|3se|5d|5s|6es|4ing|2enomena|',
  '9ed|9ing|9s|8on|Aed|Aing|As|2i|3l|4anthropic|Ded|Ding|Ds|Ced|Ds|Cst|Eed|Eing|Es|By|4ed|4harmonic|Ced|Cing|Cs|4ing|5p|6ed',
  '|6ing|6pe|8d|8s|7ine|Ad|As|Bes|9g|9ing|6s|4l|5ed|5ing|6p|7ed|7ing|7s|5s|4ologied|As|8y|5soph|9ed|Ar|Bed|Bing|Bs|9ical|De',
  'd|Ding|Ds|Aed|Bs|Ang|9s|9y|4s|3roze|7d|7s|6ing|3s|2oebe|6d|6s|5ing|4nix|7es|3ne|5d|5s|5tic|8ed|8ing|8s|4ing|3sphate|9d|9',
  's|8ing|6orus|Aes|3t|4ed|4ing|4o|5ed|5graph|Aed|Br|Ced|Cing|Cs|Aic|Ced|Cing|Cs|Bed|Cs|Bng|As|Ay|5ing|5n|6ed|6ing|6s|5s|4s',
  '|2rase|6d|6s|5ing|2yllis|7es|4ogenetic|Ced|Cing|Cs|3sical|8ed|8ing|8lied|Bs|9y|8s|6ian|9ed|9ing|9s|7st|9ed|9ing|9s|6s|7e',
  's|5ological|Ded|Ding|Ds|Aed|Bs|9y|1i|2a|3nist|7ed|7ing|7s|4o|5ed|5ing|5s|3s|3zza|6ed|6ing|6s|2c|3colo|7ed|7ing|7s|3k|4ed',
  '|6ed|6ing|6s|5ring|9ed|9ing|9s|5t|6ed|6ing|6s|4ing|7s|4s|4up|6ed|6ing|6s|3nic|6ed|6ing|6s|3s|3t|4ed|4ing|4orial|9ed|9ing',
  '|9s|4s|4ure|7d|8ed|8ing|8s|7s|8que|Bd|Bs|Aing|6ing|2e|3ce|5d|5s|4ing|3d|4mont|8ed|8ing|8s|3r|4carlo|9ed|9ing|9s|5e|6d|7e',
  'd|7ing|7s|6s|5ing|8ed|8ing|8s|4ed|5tte|8d|8s|7ing|4ing|4re|6d|6s|5ing|4s|3s|3t|4e|5d|5r|6ed|6ing|6s|5s|4ing|4s|2g|3eon|6',
  'ed|6ing|6s|3ment|7ed|7ing|7s|3s|2ke|4d|4s|3ing|2lar|5ed|5ing|5s|4sters|3e|4d|5ed|5ing|5s|4s|5es|3grim|7age|Ad|As|9ing|7e',
  'd|7ing|7s|3ing|3l|4ar|6ed|6ing|6s|4ed|4ing|4ow|6ed|6ing|6s|4s|3ot|5ed|5ing|5s|2m|3s|2n|3ch|5ed|7ed|7ing|7s|6s|5ing|3e|4d',
  '|4s|3g|4ed|4ing|4s|3ing|3k|4ed|4ing|4s|3nacle|8d|8s|7ing|4ed|6ed|6ing|6s|4ing|7ed|7ing|7s|3s|3to|5ed|5ing|5s|2oneer|7ed|',
  '7ing|7s|3tr|5ed|5ing|5s|3us|5es|2p|3e|4d|4line|8d|8s|7ing|4r|5ed|5ing|5s|4s|3ing|3s|2r|3acied|7s|5y|4te|6d|6s|5ing|3s|2s',
  's|4es|3t|4ed|4ing|4ol|6ed|6ing|6s|5n|6ed|6ing|6s|4s|2t|3awas|7es|3ch|5ed|6r|7ed|7ing|7s|6s|5fork|9ed|9ing|9s|5ing|8ed|8i',
  'ng|8s|3ied|5s|3s|3ted|6ed|6ing|6s|3y|2votal|7ed|7ing|7s|2x|3es|2zza|5ed|5ing|5s|1lace|5bo|7ed|7ing|7s|5d|5ment|9ed|9ing|',
  '9s|5s|4ing|3gue|6d|7ed|7ing|7s|6s|5ing|3id|5ed|5ing|5s|4n|5ed|5ing|5lied|8s|6y|5s|5t|6ed|6iff|9ed|9ing|9s|7ng|6s|3n|4e|5',
  'd|5s|5t|6aried|As|8y|6ed|6ing|6s|4ing|4k|5ed|5ing|5s|4ner|7ed|7ing|7s|4s|4t|5ation|Aed|Aing|As|5ed|5ing|8ed|8ing|8s|5s|3',
  'que|6d|6s|5ing|3sma|6ed|6ing|6s|4ter|7ed|7ing|7s|5ic|7ed|7ing|7s|8es|3te|5au|7ed|7ing|7s|5d|5s|4form|8ed|8ing|8s|4ing|6u',
  'm|8ed|8ing|8s|4oon|7ed|7ing|7s|4t|5ed|5ing|5s|3usible|9d|9s|8ing|3y|4able|8d|8s|7ing|4back|8ed|8ing|8s|5oy|7s|4er|6ed|6i',
  'ng|6s|4ful|7ed|7ing|7lied|As|8y|7s|4ground|Aed|Aing|As|4house|9d|9s|8ing|4s|4wright|Aed|Aing|As|3za|5ed|5ing|5s|2ea|4d|5',
  'ed|5ing|8ed|8ing|8s|5s|4ed|4ing|4s|5ant|8ed|8ing|8lied|Bs|9y|8s|5e|6d|6s|5ing|8ed|8ing|8s|5ure|8d|8s|7ing|3d|4ed|4ge|6d|',
  '6s|5ing|4ing|4s|3istocene|Bd|Bs|Aing|3ntied|7s|5y|2ight|6ed|6ing|6s|2ot|4ed|4ing|4s|4ted|7ed|7ing|7s|5ing|8ed|8ing|8s|2u',
  'cked|7ed|7ing|7s|3g|4ed|4ing|4s|3m|4age|7d|7s|6ing|4bing|8ed|8ing|8s|4e|5d|5s|4ing|4p|5ed|5ing|5s|4s|3nge|6d|6s|5ing|8ed',
  '|8ing|8s|3ral|6ed|6ing|7tied|As|8y|6s|3s|4es|4h|5ed|6s|5ing|3to|5ed|5ing|5s|2ymouth|8ed|8ing|8s|1neumonia|9ed|9ing|9s|1o',
  'cket|6ed|6ing|6s|2d|3cast|7s|3ium|6ed|6ing|6s|3s|2e|3m|4ed|4ing|4s|3s|3t|4ed|4ic|6ed|6ing|6s|5ng|4ried|7s|5y|4s|2int|5ed',
  '|7ed|7ing|7lied|As|8y|7s|6r|7ed|7ing|7s|5ing|8ed|8ing|8s|5less|9es|5s|3sed|6ed|6ing|6s|4on|6ed|6ing|9ed|9ing|9s|6ous|9es',
  '|6s|2ke|4d|5ed|5ing|5s|4r|5ed|5ing|5s|4s|3ing|6ed|6ing|6s|2l|3ar|5ed|5ing|5s|3e|4d|4s|3ice|6d|6man|9ed|9ing|9s|6s|5ied|7',
  's|6ng|5y|4ed|5s|4ng|4sh|6ed|8ed|8ing|8s|7s|6ing|4te|6d|6lied|9s|7y|6s|5ical|9ed|9ing|9lied|Cs|Ay|9s|7ian|Aed|Aing|As|7s|',
  '8es|6ng|3k|4a|5ed|5ing|5s|4ed|4ing|4s|3l|4ard|7ed|7ing|7s|4ed|6ed|6ing|6s|5n|6ed|6ing|6s|4ied|6s|5ng|7ed|7ing|7s|4ock|7e',
  'd|7ing|7s|4s|4ution|9ed|9ing|9s|4y|3o|4ed|4ing|4s|3s|3y|4mer|7ed|7ing|7s|4nomial|Aed|Aing|As|4technic|Bed|Bing|Bs|2meran',
  'ian|Aed|Aing|As|2nce|5d|5s|4ing|3d|4ed|5r|6ed|6ing|6s|4ing|4s|3ied|5s|3t|4ed|4ifical|Aed|Aing|As|5ng|4s|4us|6es|3y|2ol|4',
  'ed|4ing|4s|3r|4ed|5r|6s|4ing|4lied|7s|5y|4s|2p|3corn|7ed|7ing|7s|3e|4d|4s|3ing|3pied|6s|4y|3s|3ulace|8d|8s|7ing|6r|7ed|7',
  'ing|8tied|Bs|9y|8zed|7lied|As|8y|7s|6ted|7ion|Aed|Aing|As|5ous|8es|2rcelain|9ed|9ing|9s|4h|5ed|6s|5ing|3k|4ed|4ing|4s|3n',
  'ographic|Ced|Cing|Cs|Bed|Cs|Ay|3t|4able|8d|8s|7ing|5ge|7d|7s|6ing|5l|6ed|6ing|6s|4ed|6ed|6ing|6s|5r|6ed|6ing|6s|4folio|9',
  'ed|9ing|9s|4ico|7ed|7ing|7s|5ng|5on|7ed|7ing|7s|4o|5ed|5ing|5s|4rait|8ed|8ing|8s|6y|7al|9ed|9ing|9s|7s|4s|4ugal|8ed|8ing',
  '|8s|6uese|Ad|As|9ing|2se|4d|4s|3ing|6ed|6ing|6s|4tion|8ed|Aed|Aing|As|8ing|8s|6ve|8d|8lied|Bs|9y|8s|7ing|3s|4e|5d|5s|6s|',
  '7ed|9ed|9ing|9s|8s|7ing|Aed|Aing|As|8on|Aed|Aing|As|8ve|Ad|As|9ing|4ibilitied|Cs|Ay|6le|8d|8s|7ied|9s|8ng|7y|5ng|3t|4age',
  '|7d|7s|6ing|5l|6ed|6ing|6s|4doctoral|Ced|Cing|Cs|4ed|6ed|6ing|6s|5r|6ed|6ing|7or|9ed|9ing|9s|6s|4graduate|Cd|Cs|Bing|4hu',
  'mous|Aes|Alied|Ds|By|4ing|7ed|7ing|7s|4master|Aed|Aing|As|4poned|4s|5eason|Aed|Aing|As|4ure|7d|7s|6ing|4war|7ed|7ing|7s|',
  '2t|3assium|9ed|9ing|9s|4to|6ed|7s|8es|6ing|6s|3ent|6ed|6ial|9ed|9ing|9lied|Cs|Ay|9s|7ng|6s|3ion|6ed|6ing|6s|3s|3ter|6ed|',
  '6ied|8s|7ng|6s|6y|2uch|5ed|6s|5ing|3ltried|8s|6y|3nd|5ed|6r|7ed|7ing|7s|5ing|8ed|8ing|8s|5s|3r|4ed|4ing|7ed|7ing|7s|4s|2',
  'vertied|8s|6y|2w|3der|6ed|6ing|6s|3er|5ed|7ed|7ing|7s|5ful|8ed|8ing|8s|5house|Ad|As|9ing|5ing|5less|9es|5s|3s|1ractical|',
  '9ed|9ing|9lied|Cs|Ay|9s|7e|8d|9ed|9ing|9s|8s|7ing|6tioner|Ced|Cing|Cs|3deep|7ed|7ing|7s|3irie|7d|7s|6ing|4se|6d|6s|5ing|',
  '8ed|8ing|8s|3kash|7ed|8s|7ing|3nk|5ed|5ing|5s|3tap|6ed|6ing|6s|6want|Aed|Aing|As|4t|5ed|5ing|5s|3vin|6ed|6ing|6s|3y|4er|',
  '6ed|6ing|6s|4ing|7ed|7ing|7s|4s|2each|6ed|7r|8ed|8ing|8s|7s|6ing|9ed|9ing|9s|3cautions|4eded|7nce|Ad|As|9ing|8t|9ed|9ing',
  '|9s|6ing|9ed|9ing|9s|4inct|8ed|8ing|8s|5ous|8es|5pitation|Ded|Ding|Ds|5se|7d|7lied|As|8y|7s|6ing|7on|9ed|9ing|9s|4ursor|',
  '9ed|9ing|9s|3dator|8ed|8ied|As|9ng|8s|8y|4ecessor|Bed|Bing|Bs|4ict|7able|Bd|Bs|Aing|7ed|7ing|8on|Aed|Aing|As|7s|4ominant',
  '|Bed|Bing|Blied|Es|Cy|Bs|3face|7d|7s|6ing|4ect|7ed|7ing|7s|7ure|Ad|As|9ing|5r|6ed|7nce|Ad|As|9ing|6ing|6red|9ed|9ing|9s|',
  '6s|4ix|6es|3gnancied|As|8y|7t|8ed|8ing|8s|3historic|Bed|Bing|Bs|3judice|9d|9s|8ing|3late|7d|7s|6ing|4im|6ed|6inaried|Cs|',
  'Ay|8g|6s|4ude|7d|7s|6ing|3mature|9d|9lied|Cs|Ay|9s|8ing|4ier|7e|8d|8s|7ing|7s|8hip|Bed|Bing|Bs|5se|7d|7s|6ing|5um|7ed|7i',
  'ng|7s|3ntice|8d|8s|7ing|3occupied|Bed|Bing|Bs|3p|4aration|Bed|Bing|Bs|8oried|Cs|Ay|6e|7d|8ed|8ing|8s|7s|6ing|4ed|4ing|4s',
  '|3sbyterian|Ced|Cing|Cs|4chool|9ed|9ing|9s|5ribed|7ption|Ced|Cing|Cs|4eason|9ed|9ing|9s|5nce|8d|8s|7ing|6t|7ation|Ced|Ci',
  'ng|Cs|7ed|8r|9ed|9ing|9s|7ing|7lied|As|8y|7s|5rvation|Ced|Cing|Cs|7e|8d|8s|7ing|4ided|7ncied|Bs|9y|8t|9ed|9ial|Ced|Cing|',
  'Cs|Ang|9s|6ing|4ley|7s|4s|5es|5ing|8ed|8ing|8s|5ure|8d|8s|7ing|4t|5ed|5ige|8d|8s|7ing|8ous|Bes|6ng|5s|4umablied|Bs|9y|6e',
  'd|3tend|7ed|9ed|9ing|9s|7ing|7s|4tied|7s|5y|3vailed|7ing|5lence|Ad|As|9ing|8t|9ed|9ing|9s|4ent|7ed|7ing|8on|Aed|Aing|As|',
  '7s|4iew|7ed|7ing|7s|5ous|8es|8lied|Bs|9y|3y|4s|2ia|4ed|4ing|4s|3ce|5d|6ed|6ing|6s|5s|4ing|4k|5ed|5ing|5s|3de|5d|5s|4ing|',
  '3ed|4s|5t|6ed|7ss|9es|6hood|Aed|Aing|As|6ing|6s|3m|4a|5ed|5ing|5l|6ed|6ing|6s|5ried|8s|7lied|As|8y|6y|5s|5te|7d|7s|6ing|',
  '4e|5d|5s|4ing|5tive|9d|9s|8ing|4s|3nce|6d|6lied|9s|7y|6s|7s|8es|5ing|6pal|9ed|9ing|Atied|Ds|By|9lied|Cs|Ay|9s|7le|9d|9s|',
  '8ing|4t|5ed|7ed|7ing|7s|6r|7ed|7ing|7s|5ing|8ed|8ing|8s|5s|3or|5ed|5ied|7s|6ng|6tied|9s|7y|5s|5y|3scilla|9ed|9ing|9s|4m|',
  '5ed|5ing|5s|4on|6ed|7r|8ed|8ing|8s|6ing|6s|4tine|8d|8s|7ing|3vacied|8s|6y|5te|7d|7er|9ed|9ing|9s|7lied|As|8y|7s|6ing|4ie',
  'd|6s|5lege|9d|Aed|Aing|As|9s|8ing|4y|3ze|5d|5s|4ing|2o|3b|4abilitied|Cs|Ay|6le|8d|8s|7ied|9s|8ng|7y|5tion|9ed|9ing|9s|4e',
  '|5d|5s|4ing|4lem|7atic|Bed|Bing|Bs|7ed|7ing|7s|4s|3cedural|Aed|Aing|As|8e|9d|9s|8ing|5ed|7ed|7ing|Aed|Aing|As|7s|8es|5ss',
  '|7es|7ion|Aed|Aing|As|7or|9ed|9ing|9s|4laimed|6mation|Ced|Cing|Cs|4tor|7ed|7ing|7s|4urement|Bed|Bing|Bs|3digied|8s|6y|4u',
  'ce|7d|8ed|8ing|8s|7r|8ed|8ing|8s|7s|6ing|6t|7ed|7ing|8on|Aed|Aing|As|8ve|Ad|As|9ing|Atied|Ds|By|7s|3f|4ed|5ss|7es|7ion|A',
  'al|Ced|Cing|Clied|Fs|Dy|Cs|Aed|Aing|As|7or|9ed|9ing|9s|Ahip|Ded|Ding|Ds|4iciencied|Cs|Ay|9t|Aed|Aing|As|5le|7d|7s|6ing|5',
  'ng|5t|6able|Ad|As|9ing|6ed|6ing|6s|4ound|8ed|8ing|8lied|Bs|9y|8s|4s|3g|4ed|4ing|4ram|7ed|7ing|7me|9r|Aed|Aing|As|9s|7s|5',
  'ess|8es|8ion|Bed|Bing|Bs|9ve|Bd|Blied|Es|Cy|Bs|Aing|4s|3hibit|8ed|8ing|9on|Bed|Bing|Bs|8s|3ject|7ed|7ile|Ad|As|9ing|8ng|',
  'Aed|Aing|As|8on|Aed|Aing|As|8ve|Ad|As|9ing|7s|3liferation|Ded|Ding|Ds|6ic|8ed|8ing|8s|4ogue|8d|8s|7ing|5ng|7ed|7ing|7s|3',
  'menade|9d|9s|8ing|4inence|Ad|As|9ing|8t|9ed|9ing|9lied|Cs|Ay|9s|5se|7d|7s|6ing|9ed|9ing|9s|4ote|7d|7r|8ed|8ing|8s|7s|6in',
  'g|7on|9al|Bed|Bing|Bs|9ed|9ing|9s|4pt|6ed|6ing|6lied|9s|7y|6s|3ne|5d|5s|4ing|4ounced|Aed|Aing|As|7s|4unciation|Ded|Ding|',
  'Ds|3of|5ed|5ing|5s|3p|4aganda|Aed|Aing|As|7tion|Bed|Bing|Bs|4ed|5ller|9ed|9ing|9s|5r|6ed|6ing|6lied|9s|7y|6s|6tied|9s|7y',
  '|4hecied|9s|7y|6t|7ed|7ing|7s|4ing|4onent|9ed|9ing|9s|5rtion|Aal|Ced|Cing|Cs|Aed|Aing|As|5sal|8ed|8ing|8s|6e|7d|7s|6ing|',
  '7tion|Bed|Bing|Bs|4rietaried|Cs|Ay|8or|Aed|Aing|As|4s|5es|4ulsion|Aed|Aing|As|3s|4e|5cuted|8ion|Bed|Bing|Bs|8or|Aed|Aing',
  '|As|5d|5s|4ing|4pect|8ed|8ing|9ve|Bd|Bs|Aing|8s|6r|7ed|7ing|8tied|Bs|9y|7ous|Aes|7s|4tate|8d|8s|7ing|5itute|Ad|As|9ing|A',
  'on|Ced|Cing|Cs|3tagonist|Bed|Bing|Bs|4e|5ct|7ed|7ing|Aed|Aing|As|8on|Aed|Aing|As|8ve|Ad|As|9ing|7or|9ate|Cd|Cs|Bing|9ed|',
  '9ing|9s|7s|5d|5ge|7d|7s|6ing|5in|7ed|7ing|7s|5s|6t|7ant|Aed|Aing|As|7ed|8rs|7ing|7s|4ing|4o|5col|8ed|8ing|8s|5ed|5ing|5n',
  '|6ed|6ing|6s|5s|5type|9d|9s|8ing|4ruding|3udlied|8s|6y|3ve|5d|6ed|6ing|6s|5n|6ce|8d|8s|7ing|6ed|6ing|6s|5s|4ide|7d|8ed|8',
  'ing|8s|7nce|Ad|As|9ing|7r|8ed|8ing|8s|7s|6ing|9ed|9ing|9s|5nce|8d|8s|7ial|Aed|Aing|As|8ng|6g|7ed|7ing|7s|5sion|9al|Bed|B',
  'ing|Bs|9ed|9ing|9s|4ocative|Bd|Bs|Aing|5ke|7d|7s|6ing|5st|7ed|7ing|7s|3wess|7es|3xied|6s|5mitied|As|8y|4y|2ussian|8ed|8i',
  'ng|8s|2y|1salm|5ed|5ing|5s|2eudo|6ed|6ing|6nym|9ed|9ing|9s|6s|2i|3s|2ych|5e|6d|6s|5iatric|Bed|Bing|Bs|Aed|Bs|Ast|Ced|Cin',
  'g|Cs|9y|6c|7ed|7ing|7s|6ng|5ological|Ded|Ding|Ds|Aed|Bs|Ast|Ced|Cing|Cs|9y|6tic|9ed|9ing|9s|1tolemied|8s|6y|1ub|3lic|6at',
  'ion|Bed|Bing|Bs|6ed|6ing|7tied|As|8y|7zed|6lied|9s|7y|6s|5sh|7ed|8r|9ed|9ing|9s|8s|7ing|3s|2ck|4ed|4ing|4s|2dding|7ed|7i',
  'ng|7s|4le|6d|6s|5ing|2eblo|6ed|6ing|6s|2ff|4ed|4ing|4s|2l|3l|4ed|4ing|4s|3monaried|As|8y|3p|4ed|4ing|5t|6ed|6ing|6s|4s|3',
  's|4e|5d|5s|4ing|2mp|4ed|4ing|4kin|7ed|7ing|7s|4s|2n|3ch|5ed|6s|5ing|8ed|8ing|8s|4t|5ed|5ing|5s|3e|3ish|6ed|7s|6ing|6ment',
  '|Aed|Aing|As|3jab|6i|7ed|7ing|7s|3k|4ed|4ing|4s|3s|3t|4a|5ed|5ing|5s|4ed|4ing|4s|2p|3il|5ed|5ing|5s|3pet|6ed|6ing|6s|4ie',
  'd|6s|4y|3s|2r|3chase|8d|8s|7ing|3e|4d|4lied|7s|5y|4s|3ge|5d|5s|4ing|3ification|Ced|Cing|Cs|4ng|4tied|7s|5y|3ple|6d|6s|5i',
  'ng|4orted|5se|7d|7lied|As|8y|7s|6ing|3s|4e|5d|6ed|6ing|6s|5s|4ing|4uant|8ed|8ing|8s|5e|6d|6s|5ing|6t|7ed|7ing|7s|2s|3es|',
  '3h|4ed|5s|4ing|7ed|7ing|7s|3sied|6s|4y|2t|3s|3ting|2zzle|6d|7ed|7ing|7s|6s|5ing|1yramid|7ed|7ing|7s|2thon|6ed|6ing|6s|0q',
  'uad|4ed|4ing|4rant|8ed|8ing|8s|4s|3ke|5d|5r|6ed|6ing|6s|5s|4ing|3lification|Ded|Ding|Ds|7ed|9ed|9ing|9s|8r|9ed|9ing|9s|8',
  's|6y|5tied|8s|6y|3n|4ed|4ing|4s|4t|5ed|5ing|6tative|Cd|Cs|Bing|7ied|9s|7y|5s|5um|7ed|7ing|7s|3rrel|7ed|7ing|7s|5ied|7s|5',
  'y|4ter|7back|Bed|Bing|Bs|7ed|7ing|7lied|As|8y|7master|Ded|Ding|Ds|7s|8es|6t|7ed|7ing|7s|5z|6es|3si|5ed|5ing|5s|3y|4s|2ee',
  'n|5ed|5ing|5s|4r|5ed|5ing|5s|3ried|6s|4y|3st|5ed|5ing|6on|8able|Cd|Cs|Bing|8ed|8ing|8s|5s|3ue|5d|5s|4ing|2ick|5ed|6r|7s|',
  '5ing|5lied|8s|6y|5s|3et|5ed|6r|7ed|7ing|7s|5ing|5lied|8s|6y|5s|3lt|5ed|5ing|5s|3ntet|7ed|7ing|7s|3t|4e|5d|5s|4ing|4s|3ve',
  'r|6ed|6ing|9ed|9ing|9s|6s|3z|4es|2o|3s|3ta|5ed|5ing|5s|4e|5d|5s|4ing|0raanan|6ed|6ing|6s|2bbi|5ed|5ing|5s|5t|6ed|6ing|6s',
  '|3in|5ed|5ing|5s|2ce|4course|Ad|As|9ing|4d|4r|5ed|5ing|5s|4s|4way|7s|3hel|6ed|6ing|6s|3ial|6ed|6ing|6s|4ng|6ed|6ing|6s|4',
  'sm|6ed|6ing|6s|5t|6ed|6ing|6s|3k|4ed|4ing|4s|2d|3ar|5ed|5ing|5s|3ek|5ed|5ing|5s|3ial|6ed|6ing|6s|5nt|7ed|7ing|7s|5ted|8e',
  'd|8ing|8s|6ing|7on|9ed|9ing|9s|4cal|7ed|7ing|7lied|As|8y|7s|4o|5active|Bd|Bs|Aing|5ed|5ing|5s|4us|6es|3s|2fael|6ed|6ing|',
  '6s|3e|4d|4s|3ik|5ed|5ing|5s|4ng|3t|4ed|4ing|4s|2g|3e|4d|4s|3ged|6ed|6ing|6s|3hu|5ed|5ing|5s|3ing|6ed|6ing|6s|3nar|6ed|6i',
  'ng|6s|3s|2h|3s|3ul|5ed|5ing|5s|2id|4ed|5r|6ed|6ing|6s|4ing|4s|3f|4ed|4ing|4s|3l|4ed|4ing|7ed|7ing|7s|4road|8ed|8ing|8s|4',
  's|4way|7s|3n|4bow|7ed|7ing|7s|4ed|5r|6ed|6ing|6s|4fall|8ed|8ing|8s|4ied|6s|5ng|4s|4y|3se|5d|6ed|6ing|6s|5s|4ing|7ed|7ing',
  '|7s|2j|3a|4ed|4ing|4rshi|8ed|8ing|8s|4s|3eev|6ed|6ing|6s|4ndra|8ed|8ing|8s|4sh|6ed|7s|6ing|3iv|5ed|5ing|5s|3s|2ke|4d|4s|',
  '3hal|6ed|6ing|6s|3ing|2lf|4ed|4ing|4s|3lied|6s|4y|3ph|5ed|5ing|5s|2m|3a|4doss|8es|4ed|4ing|4n|5an|7ed|7ing|7s|5ed|5ing|5',
  's|4s|3esh|6ed|7s|6ing|3iro|6ed|6ing|6s|3neek|7ed|7ing|7s|3on|5ed|5ing|5s|3p|4age|7d|7s|6ing|5nt|7ed|7ing|7s|4ed|4ing|4s|',
  '3s|4ey|6s|2n|3a|4ed|4ing|4s|3ch|5ed|6s|5ing|5o|6ed|6ing|6s|3d|4al|6ed|6ing|6l|7ed|7ing|7s|6s|4ed|5ll|7ed|7ing|7s|4ied|6s',
  '|5ng|4olph|8ed|8ing|8s|5m|6ed|6ing|6lied|9s|7y|6s|4s|4y|3g|4e|5d|6ed|6ing|6s|5r|6ed|6ing|6s|5s|4ing|7ed|7ing|7s|4s|3i|4e',
  'd|4ing|4s|3jit|6ed|6ing|6s|3k|4ed|6ed|6ing|6s|4ing|4s|3n|4ed|4ing|4s|3s|4om|6ed|6ing|6s|2p|3e|4d|4s|3hael|7ed|7ing|7s|3i',
  'd|5ed|5ing|5lied|8s|6y|5s|4ng|3per|6ed|6ing|6s|3s|3t|4ed|4ing|4s|2re|4d|4lied|7s|5y|4s|3ing|4tied|7s|5y|2s|3es|3h|4ed|5s',
  '|4ing|3ped|6ed|6ing|6s|2t|3e|4d|5ed|5ing|5s|4s|3her|6ed|6ing|6s|4nakumar|Bed|Bing|Bs|3ification|Ced|Cing|Cs|6ed|4ng|6ed|',
  '6ing|6s|4o|5ed|5ing|5nal|8ed|8ing|8s|6s|5s|3s|3tle|6d|7ed|7ing|7s|6s|5ing|8ed|8ing|8s|2ul|4ed|4ing|4s|2vaged|3e|4d|4n|5e',
  'd|5ing|5s|6es|4s|3i|4ed|4ing|4ndran|9ath|Ced|Cing|Cs|9ed|9ing|9s|5e|6d|6s|5g|5ing|4s|2w|3s|2y|3an|5ed|5ing|5s|3mond|7ed|',
  '7ing|7s|3on|5ed|5ing|5s|3s|2zor|5ed|5ing|5s|1e|2ach|5ed|6r|7ed|7ing|7s|6s|5ing|8ed|8ing|8s|4t|5ed|5ing|6on|8ed|8ing|8s|6',
  'vated|7e|8d|8s|7ing|5or|7ed|7ing|7s|5s|3d|4ed|5r|6ed|6ing|6s|4ied|6s|5lied|8s|6y|5ness|9es|6g|7ed|7ing|7s|4s|4y|3l|4ed|4',
  'ing|5sed|6m|7ed|7ing|7s|6tic|9ed|9ing|9s|5tied|8s|6y|5zation|Bed|Bing|Bs|6e|7d|7s|6ing|9ed|9ing|9s|4lied|7s|5y|4m|5ed|5i',
  'ng|5s|4s|3per|6ed|6ing|6s|4peared|3r|4ed|4ing|4s|3son|6able|Ad|As|9ied|Bs|Ang|9y|6ed|8ed|8ing|8s|6ing|9ed|9ing|9s|6s|4si',
  'gned|5ure|8d|9ed|9ing|9s|8s|7ing|Aed|Aing|As|2b|3ecca|7ed|7ing|7s|4l|5ed|5ing|5lion|9ed|9ing|9s|8us|Aes|5s|3irth|7ed|7in',
  'g|7s|3orn|6ed|6ing|6s|4und|7ed|7ing|7s|3randed|3s|3uild|7ed|7ing|7s|6t|7ed|7ing|7s|2call|6ed|6ing|6s|4pture|9d|9s|8ing|3',
  'eipt|7ed|7ing|7s|8es|5ve|7d|8ed|8ing|8s|7r|8ed|8ing|8s|7s|6ing|4nt|6ed|6ing|6lied|9s|7y|6s|4pt|6ed|6ing|7on|9ed|9ing|Ast',
  '|Ced|Cing|Cs|9s|6or|8ed|8ing|8s|6s|4ss|6es|6ion|9ed|9ing|9s|3ipe|6d|6s|5ient|9ed|9ing|9s|6ng|5rocal|Aed|Aing|As|4tal|7ed',
  '|7ing|7s|5ed|3k|4ed|4ing|4less|8es|4on|6ed|6ing|6s|4s|3laim|7ed|7ing|7s|5mation|Bed|Bing|Bs|3ognised|7tion|Bed|Bing|Bs|7',
  'zable|Cd|Cs|Bing|8e|9d|9s|8ing|4il|6ed|6ing|6s|4mmend|9ation|Eed|Eing|Es|9ed|9ing|9s|4n|5cile|9d|9s|8iation|Eed|Eing|Es|',
  '9ng|5ed|5ing|5naissance|Ed|Es|Ding|5s|6tructed|Ded|Ding|Ds|Bion|Eed|Eing|Es|4rd|6ed|7r|8ed|8ing|8s|6ing|9ed|9ing|9s|6s|4',
  'unt|7ed|7ing|7s|4ver|7ed|7ied|9s|8ng|7s|7y|3reated|7ion|Aal|Ced|Cing|Cs|Aed|Aing|As|4uit|7ed|7ing|Aed|Aing|As|7ment|Bed|',
  'Bing|Bs|7s|3t|4angular|Bed|Bing|Bs|4ed|4ing|4or|6ed|6ied|8s|7ng|6s|6y|4s|3urring|9ed|9ing|9s|3ycled|6ing|2d|3d|4ed|4ied|',
  '6s|5ng|7ed|7ing|7s|5sh|7ed|8s|7ing|4s|4y|3e|4d|4mption|Aed|Aing|As|4s|5ign|8ated|8ed|8ing|8s|4veloped|9ment|Ded|Ding|Ds|',
  '3head|7ed|7ing|7s|3ing|4rect|8ed|8ing|8s|4scovered|5tribution|Eed|Eing|Es|3s|4kins|3uce|6d|7ed|7ing|7s|6s|5ing|8ed|8ing|',
  '8s|5tion|9ed|9ing|9s|4ndant|9ed|9ing|9s|3wood|7ed|7ing|7s|2ed|4ed|4ing|4s|3f|4ed|4ing|4s|3l|4ed|4ing|4s|3s|4e|5d|5s|4ing',
  '|3ve|5d|5s|4ing|2f|3er|5ed|6e|7ed|7ing|7s|6nce|9d|9s|8ing|7dum|Aed|Aing|As|5ing|5s|3ined|7ed|7ing|7s|6ried|9s|7y|5ing|8e',
  'd|8ing|8s|4t|5ed|5ing|5s|3lect|7ed|9ed|9ing|9s|7ing|Aed|Aing|As|8on|Aed|Aing|As|8ve|Ad|As|9ing|7s|5x|6es|3orm|6ation|Bed',
  '|Bing|Bs|6ed|8ed|8ing|8s|7r|8ed|8ing|8s|6ing|6s|3rain|7ed|7ing|7s|4esh|7ed|8s|7ing|Aed|Aing|As|4igerator|Ced|Cing|Cs|3s|',
  '3ueling|9ed|9ing|9s|4ge|6d|6e|7ed|7ing|7s|6s|5ing|4nd|6ed|6ing|6s|4rbished|9ment|Ded|Ding|Ds|4sal|7ed|7ing|7s|5e|6d|6s|5',
  'ing|8ed|8ing|8s|2g|3ain|6ed|6ing|6s|4l|5ed|5ing|5s|4rd|6ed|6ing|9ed|9ing|9s|6less|Aes|6s|4tta|7ed|7ing|7s|3encied|8s|6y|',
  '5eration|Ced|Cing|Cs|5t|6ed|6ing|6s|3gie|6d|6s|5ing|3ime|6d|6nt|8al|Aed|Aing|As|8ed|8ing|8s|6s|5ing|4nald|8ed|8ing|8s|4o',
  'n|6al|8ed|8ing|8s|6ed|6ing|6s|4ster|8ed|Aed|Aing|As|8ing|8s|6rar|9ed|9ing|9s|8tion|Ced|Cing|Cs|7ied|9s|7y|3ression|Aed|A',
  'ing|As|5t|6ed|6ing|6s|3s|3ular|7ed|7ing|7lied|As|8y|7s|6te|8d|9ed|9ing|9s|8s|7ing|8on|Aed|Aing|As|7or|9ed|9ied|Bs|Ang|9s',
  '|9y|2habilitation|Eed|Eing|Es|3earsal|9ed|9ing|9s|2id|4ed|4ing|4s|3gn|5ed|5ing|5s|3m|4ed|4ing|4s|3n|4carnated|4deer|8ed|',
  '8ing|8s|4ed|5r|6ed|6ing|6s|4force|9d|9ment|Ded|Ding|Ds|9s|8ing|4hard|8ed|8ing|8s|4ing|4s|5es|5tated|4troduced|3ssue|7d|7',
  's|6ing|3ter|6ated|Aed|Aing|As|6ed|6ing|6s|2ject|6ed|6ing|7on|9ed|9ing|9s|6s|3oin|6ed|6ing|6s|2l|3ate|6d|7ed|7ing|7s|6s|5',
  'ing|6on|8al|Aed|Aing|As|8ed|8ing|8s|9hip|Ced|Cing|Cs|6ve|8d|8lied|Bs|9y|8s|7ing|8tied|Bs|9y|4unched|4x|5ation|Aed|Aing|A',
  's|5ed|7ed|7ing|7s|6s|4y|5s|3ease|7d|7s|6ing|4gated|7ion|Aed|Aing|As|4nt|6ed|6ing|6less|Aes|6s|4vance|9d|9s|8ing|7t|8ed|8',
  'ing|8s|3iabilitied|Cs|Ay|6le|8d|8s|7ing|5nce|8d|8s|7ing|4c|5ed|5ing|5s|4ed|5f|6ed|6ing|6s|5s|5ve|7d|8ed|8ing|8s|7s|6ing|',
  '4gion|8ed|8ing|8s|7us|9es|4nquished|3oad|6ed|6ing|6s|4cate|8d|8s|7ing|8on|Aed|Aing|As|3s|3uct|6ance|Ad|As|9ing|8t|9ed|9i',
  'ng|9lied|Cs|Ay|9s|6ed|6ing|6s|3y|2made|6d|6s|5ing|4in|6der|9ed|9ing|9s|6ed|6ing|6s|7es|4ke|6d|6s|5ing|4rk|6able|Ad|As|9i',
  'ed|Bs|Ang|9y|6ed|6ing|6s|5ried|4tch|7ed|8s|7ing|3edied|7s|5y|4mber|8ed|8ing|8s|6rance|Bd|Bs|Aing|3ind|6ed|7r|8ed|8ing|8s',
  '|6ing|6s|5iscent|Bed|Bing|Bs|4x|5es|3nant|7ed|7ing|7s|3odeled|4rse|7d|7s|6ing|4te|6d|6lied|9s|7y|6s|5ing|4val|7ed|7ing|7',
  's|5e|6d|7ed|7ing|7s|6s|5ing|8ed|8ing|8s|2naissance|Bd|Bs|Aing|4l|5ed|5ing|5s|4med|5ing|3d|4ed|5r|6ed|6ing|9ed|9ing|9s|6s',
  '|5zvous|Aes|4ing|5tion|9ed|9ing|9s|4s|3egade|8d|8s|7ing|4w|5able|9d|9s|8ing|6l|7ed|7ing|7s|5ed|5ing|5s|3ovated|7ion|Aed|',
  'Aing|As|4wn|6ed|8ed|8ing|8s|6ing|6s|3t|4al|6ed|6ing|6s|4ed|6ed|6ing|6s|4ing|4s|3u|4ed|4ing|4mbered|4s|2opened|3rganizati',
  'on|Eed|Eing|Es|9ed|2p|3air|6ed|6ing|6s|4y|5s|3eal|6ed|6ing|6s|5t|6ed|8ed|8ing|8lied|Bs|9y|8s|6ing|6s|4rtoire|Ad|As|9ing|',
  '7ried|As|8y|4tition|Aed|Aing|As|8ve|Ad|As|9ing|3lace|7d|7ment|Bed|Bing|Bs|7s|6ing|5y|6s|4ica|7ed|7ing|7s|7te|9d|9s|8ing|',
  '9on|Bed|Bing|Bs|5ed|6s|4y|3ort|6ed|8lied|Bs|9y|7r|8ed|8ing|8s|6ing|6s|4sitoried|Bs|9y|3resent|9ation|Eed|Eing|Es|Cve|Ed|',
  'Es|Ding|9ed|9ing|9s|6sion|Aed|Aing|As|4int|7ed|7ing|7s|5se|7d|7s|6ing|4oduce|9d|9s|8ing|8tion|Ced|Cing|Cs|Ave|Cd|Cs|Bing',
  '|3s|4es|3tiles|3ublic|8an|Aed|Aing|As|8ed|8ing|8s|7shed|4lsed|4tation|Aed|Aing|As|5ed|7ed|7ing|7s|2quest|7ed|7ing|7s|4ie',
  'm|7ed|7ing|7s|5re|7d|7ment|Bed|Bing|Bs|7s|6ing|2scue|6d|6s|5ing|3earch|8ed|9r|Aed|Aing|As|9s|8ing|4mblance|Bd|Bs|Aing|7e',
  '|8d|8s|7ing|4nt|6ed|6ing|6ment|Aed|Aing|As|6s|4rvation|Bed|Bing|Bs|6e|7d|8ed|8ing|8s|7s|6ing|6oir|9ed|9ing|9s|4t|5ed|5in',
  'g|5s|3ide|6d|6nce|9d|9s|8ied|As|9ng|8y|7t|8ed|8ial|Bed|Bing|Bs|9ng|8s|6s|5ing|5ual|8ed|8ing|8s|6e|7d|7s|6ing|4gn|6ation|',
  'Bed|Bing|Bs|6ed|8ed|8ing|8s|6ing|6s|4n|5ed|5ing|5s|4st|6ance|Ad|As|9ing|8t|9ed|9ing|9s|6ed|6ing|9ed|9ing|9s|6s|3olution|',
  'Aed|Aing|As|5ve|7d|8ed|8ing|8s|7s|6ing|4nance|9d|9s|8ing|4rt|6ed|6ing|6s|4urce|8d|8s|7ing|3p|4ect|7able|Bd|Bs|Aing|7ed|7',
  'ful|Aed|Aing|As|7ing|Aed|Aing|As|8ve|Ad|Alied|Ds|By|As|9ing|7s|5d|4ing|5ratoried|Cs|Ay|4ond|7ed|8nts|7ing|7s|6se|8d|8s|7',
  'ibilitied|Fs|Dy|9le|Bd|Bs|Aing|8ng|8ve|Ad|As|9ing|4s|3t|4art|7ed|7ing|7s|5ur|7ant|Aed|Aing|As|7ed|7ing|7s|4ed|4ing|7ed|7',
  'ing|7s|4less|8es|4oration|Bed|Bing|Bs|6e|7d|7s|6ing|4rain|8ed|Aed|Aing|As|8ing|Bed|Bing|Bs|8s|8t|9ed|9ing|9s|5ict|8ed|Ae',
  'd|Aing|As|8ing|9on|Bed|Bing|Bs|9ve|Bd|Bs|Aing|8s|4s|3ult|6ant|9ed|9ing|9s|6ed|6ing|9ed|9ing|9s|6s|4me|6d|6s|5ing|4rgence',
  '|Ad|As|9ing|5rected|9ion|Ced|Cing|Cs|2t|3ail|6ed|7r|8ed|8ing|8s|6ing|6s|5n|6ed|6ing|9ed|9ing|9s|6s|4liation|Bed|Bing|Bs|',
  '3ention|9ed|9ing|9s|3ire|6d|7ed|7ing|7s|6ment|Aed|Aing|As|6s|5ing|8ed|8ing|8s|3orted|8ed|8ing|8s|3racted|9ed|9ing|9s|4ea',
  't|7ed|7ing|Aed|Aing|As|7s|4ibution|Bed|Bing|Bs|5eval|9ed|9ing|9s|7e|8d|8s|7ing|4ospective|Dd|Ds|Cing|3s|3urn|6ed|8ed|8in',
  'g|8s|6ing|6s|2uben|6ed|6ing|6s|3nification|Ded|Ding|Ds|5on|7ed|7ing|7s|5te|7d|7s|6ing|3sed|2v|3e|4al|6ed|8ed|8ing|8s|6in',
  'g|9ed|9ing|9s|6s|4d|4l|5ation|Aed|Aing|As|5ed|5ing|5s|4nge|7d|7s|6ing|5ue|7d|7s|6ing|4red|7ed|7ing|7s|6nd|8ed|8ing|8s|5s',
  '|6al|8ed|8ing|8s|6e|7d|8ed|8ing|8s|7s|6ing|5ted|4s|3iew|6ed|7r|8ed|8ing|8s|6ing|6s|4ng|4sed|7ed|7ing|7s|5ion|8ed|8ing|8s',
  '|6ted|4val|7ed|7ing|7s|5e|6d|6s|5ing|3oked|4lt|6ed|6ing|6s|5ution|Aaried|Es|Cy|Aed|Aing|As|5ver|8ed|8ing|8s|7s|6ing|9ed|',
  '9ing|9s|3s|3ue|5d|5s|4ing|2ward|6ed|6ing|6s|3orked|8ed|8ing|8s|2x|3es|2ynolds|1hapsodied|9s|7y|2ea|4ed|4ing|4s|3toric|8e',
  'd|8ing|8s|2ine|5d|5land|9ed|9ing|9s|5s|4ing|4o|5ed|5ing|5s|2odes|6es|3nda|6ed|6ing|6s|2yme|5d|5s|4ing|3thm|6ed|6ic|8ed|8',
  'ing|8s|7ng|6s|1ib|3bon|6ed|6ing|6s|3s|2c|3ardo|7ed|7ing|7s|3e|4d|4s|3h|4ard|7ed|7ing|7s|4ed|5r|6s|5s|6es|6t|4ing|4lied|7',
  's|5y|4mond|8ed|8ing|8s|4ter|7s|3ing|3k|4ed|4ied|6s|5ng|4s|4y|3s|2d|3den|6ed|6ing|6s|4le|6d|6s|5ing|3e|4d|4r|5ed|5ing|5s|',
  '4s|3ge|5d|5s|4ing|3iculous|Aes|4ng|6ed|6ing|6s|3s|2ff|4ed|4ing|4s|3le|5d|5s|4ing|3t|4ed|4ing|4s|2g|3ht|5ed|6ous|9es|5ful',
  '|8ed|8ing|8s|5ing|5s|3id|5ed|5ing|5s|3orous|8es|3s|2k|3s|2ley|5s|2m|3s|2ng|4ed|4ing|7ed|7ing|7s|4s|3k|4ed|4ing|4s|2o|3s|',
  '3t|4ed|4ing|4s|2p|3e|4d|4s|3ing|3ping|7ed|7ing|7s|4le|6d|6s|5ing|3s|2se|4d|4n|5ed|5ing|5s|4s|3ing|6ed|6ing|6s|3k|4ed|4ie',
  'd|6s|5ng|4s|4y|2ta|4ed|4ing|4lynne|9d|9s|8ing|4s|3chey|7s|3e|4d|4s|3ing|3ual|6ed|6ing|6s|2val|5ed|5ing|5ried|8s|6y|5s|3e',
  'r|5ed|5ing|5s|6ide|9d|9s|8ing|1oach|5ed|6s|5ing|3d|4ed|4ing|4s|5ide|8d|8s|7ing|4way|7s|3m|4ed|4ing|7ed|7ing|7s|4s|3noke|',
  '7d|7s|6ing|3r|4ed|4ing|7ed|7ing|7s|4s|3st|5ed|5ing|5s|2b|3ber|6ed|6ied|8s|7ng|6s|6y|4in|6ed|6ing|6s|3e|4d|4r|5ed|5ing|5s',
  '|5t|6a|7ed|7ing|7s|6ed|6ing|6o|7ed|7ing|7s|6s|4s|3in|5ed|5g|5ing|5s|3ot|5ed|5ing|5s|3s|3ust|6ed|6ing|6s|2c|3helle|8d|8s|',
  '7ing|3k|4ed|5r|6ed|6ing|6s|5t|6ed|6ing|6s|4ied|6s|7es|5ng|7ed|7ing|7s|4s|4y|3s|2d|3e|4d|4nt|6ed|6ing|6s|4o|5ed|5ing|5s|4',
  'rick|8ed|8ing|8s|4s|3ger|6ed|6ing|6s|3ing|3ney|6s|3s|2e|3s|2g|3er|5ed|5ing|5s|3s|3ue|5d|5s|4ing|2han|5ed|5ing|5s|2i|3s|2',
  'land|6ed|6ing|6s|3e|4d|4s|3f|4e|5d|5s|4ing|4s|3ing|3l|4ed|6ed|6ing|6s|5r|6ed|6ing|6s|4ing|7ed|7ing|7s|4s|2main|6ed|6ing|',
  '6s|4n|5ce|7d|7s|6ing|5ed|6sque|Ad|As|9ing|5ian|8ed|8ing|8s|6ng|6zed|5s|5tic|8ed|8ing|8s|3e|4d|4o|5ed|5ing|5s|4ro|6ed|6in',
  'g|6s|4s|3ing|3ney|6s|2n|3ald|6ed|6ing|6s|3ni|5ed|5ing|5s|3s|2of|4ed|4ing|4s|3k|4ed|4ie|6d|6s|5ing|5ng|4s|3m|4ed|4ing|4ma',
  'te|8d|8s|7ing|4s|3sevelt|9ed|9ing|9s|4ter|7ed|7ing|7s|3t|4ed|6ed|6ing|6s|4ing|4s|2pe|4d|4s|5es|3ing|2ried|5s|3y|2sa|4ed|',
  '4ing|4lie|7d|7s|6ing|4ried|7s|6o|7ed|7ing|7s|5y|4s|3e|4d|4maried|9s|7y|4s|4wood|8ed|8ing|8s|3ied|5s|4ng|3s|4es|3ter|6ed|',
  '6ing|6s|3y|2t|3aried|7s|5y|4te|6d|7ed|7ing|7s|6s|5ing|8ed|8ing|8s|6on|8al|Aed|Aing|As|8ed|8ing|8s|3or|5ed|5ing|5s|3s|3te',
  'n|6ed|6ing|6s|4ing|7ed|7ing|7s|2uge|5d|5s|4h|5ed|5ing|5lied|8s|6y|5s|4ing|3nd|5about|Aed|Aing|As|5ed|7ed|7ing|7s|5ing|8e',
  'd|8ing|8s|5s|3se|5d|5s|4ing|4seau|8ed|8ing|8s|3t|4e|5d|5r|6ed|6ing|6s|5s|4ine|7d|7lied|As|8y|7s|6g|7ed|7ing|7s|6ing|4s|2',
  'ver|5ed|5ing|5s|2w|3an|5ed|5ing|5s|3er|5ed|5ing|5s|3ing|6ed|6ing|6s|3land|7ed|7ing|7s|3s|2xana|6ed|6ing|6s|5e|6d|6s|5ing',
  '|5ne|7d|7s|6ing|3ie|5d|5s|4ing|3y|2y|3al|5e|6d|6s|5ing|6st|8ed|8ing|8s|5s|5tied|8s|6y|3s|1ub|3bed|6ed|6ing|6s|5r|6ed|6in',
  'g|6s|4ing|7ed|7ing|7s|5sh|7ed|8s|7ing|4le|6d|6s|5ing|3ied|5s|3s|3y|2d|3d|4ed|5r|6ed|6ing|6s|4ing|4s|3e|4d|4s|3ied|5s|4ng',
  '|3olf|6ed|6ing|6s|5ph|7ed|7ing|7s|3s|3y|2e|3d|3s|2fus|5es|2g|3bied|6s|4y|3ged|6ed|6ing|6s|3s|2in|4ed|6ed|6ing|6s|4ing|4s',
  '|2le|4d|4r|5ed|5ing|5s|4s|3ing|6ed|6ing|6s|2m|3ble|6d|6s|5ing|8ed|8ing|8s|3or|5ed|5ing|5s|3s|2n|3away|7s|3e|4d|4s|3ing|3',
  'ner|6ed|6ing|6s|4ing|7ed|7ing|7s|3off|6ed|6ing|6s|3s|3way|6s|2pee|5ed|5ing|5s|4rt|6ed|6ing|6s|2ral|5ed|5ing|5s|2s|3e|4d|',
  '4s|3h|4ed|6ed|6ing|6s|5s|4ing|7ed|7ing|7s|3ing|3s|4ell|7ed|7ing|7s|5s|4ia|6ed|6ing|6n|7ed|7ing|7s|6s|3t|4ed|4ic|6ed|6ing',
  '|6s|5ed|6s|5ng|4ling|8ed|8ing|8s|4s|4y|2t|3h|4ed|5rford|Aed|Aing|As|4ing|4less|8es|4s|3s|1yder|5ed|5ing|5s|2e|3s|0saad|4',
  'ed|4ing|4s|2b|3bath|7ed|7ing|7s|3er|5ed|5ing|5s|3ine|6d|6s|5ing|3le|5d|5s|4ing|3otage|8d|8s|7ing|3rina|7ed|7ing|7s|3s|2c',
  '|3k|4ed|6ed|6ing|6s|4ing|4s|3rament|9ed|9ing|9o|Aed|Aing|As|9s|4ed|6ed|6ing|6s|4ifice|9d|9s|8ing|3s|2d|3dle|6d|6s|5ing|3',
  'ie|5d|5s|4ing|3lied|6s|4y|3ness|7es|3s|2fari|6ed|6ing|6s|3e|4d|4guard|9ed|9ing|9s|4lied|7s|5y|4r|5s|4s|4tied|7s|5y|3ing|',
  '2ga|4ed|4ing|4s|3e|4d|4s|3ing|2hara|6ed|6ing|6n|7ed|7ing|7s|6s|3ib|5ed|5ing|5s|2i|3d|4ed|4ing|4s|3fied|6s|4y|3id|5ed|5in',
  'g|5s|3l|4ed|6ed|6ing|6s|4ing|7ed|7ing|7s|4or|6ed|6ing|6s|4s|3nt|5ed|5ing|5s|3s|2k|3e|4d|4s|3ing|3s|2l|3ad|5ed|5ing|5s|4r',
  'ied|7s|5y|3e|4d|4s|5man|8ed|8ing|8s|3ine|6d|6s|5g|5ing|4va|6ed|6ing|6s|3le|5d|5s|4ied|6s|5ng|4y|3mon|6ed|6ing|6s|3on|5ed',
  '|5ing|5s|4on|6ed|6ing|6s|3s|3t|4ed|4ied|6s|5ng|4s|4y|3ute|6d|6s|5ing|3vage|7d|7s|6ing|5tion|9ed|9ing|9s|2m|3antha|8ed|8i',
  'ng|8s|3ba|5ed|5ing|5s|3e|4d|4s|3ing|4r|5ed|5ing|5s|3mied|6s|4y|3ple|6d|6s|5ing|8ed|8ing|8s|3s|4on|6ed|6ing|6s|3uel|6ed|6',
  'ing|6s|4rai|7ed|7ing|7s|2n|3and|6ed|6ing|6s|3che|6d|6s|5ing|4tion|8ed|8ing|8s|5uaried|As|8y|3d|4als|4ed|5ep|7ed|7ing|7s|',
  '5rs|7es|4ied|6s|5ng|5p|6ed|6ing|6s|4ra|6ed|6ing|6s|4s|5tone|9d|9s|8ing|4wich|8ed|9s|8ing|4y|3e|4d|4s|3ford|7ed|7ing|7s|3',
  'g|4ed|4ho|6ed|6ing|6s|4ing|4s|3ing|4taried|9s|7y|6tion|Aed|Aing|As|5ied|7s|5y|3jay|6s|4eev|7ed|7ing|7s|4ib|6ed|6ing|6s|3',
  'k|4ed|4ing|4s|3s|4es|4krit|8ed|8ing|8s|3t|4a|5ed|5ing|5s|4ed|4iago|8ed|8ing|8s|5ng|4o|5ed|5ing|5s|6es|4s|2o|3s|2p|3phire',
  '|8d|8s|7ing|3s|2qib|5ed|5ing|5s|2r|3a|4ed|4h|5ed|5ing|5s|4ing|4s|4toga|8ed|8ing|8s|3casm|7ed|7ing|7s|6tic|9allied|Es|Cy|',
  '9ed|9ing|9s|3s|2sh|4ed|5s|4ing|3katoon|9ed|9ing|9s|3san|6ed|6ing|6s|2t|3an|5ed|5ing|5s|3ellite|9d|9s|8ing|3in|5ed|5ing|5',
  's|4re|6d|6s|5ical|9ed|9ing|9s|6ng|4sfaction|Ced|Cing|Cs|9oried|Ds|By|6ied|9ed|9ing|9s|8s|6y|7ing|Aed|Aing|As|3s|3urated|',
  '9ed|9ing|9s|5day|8s|5n|6ed|6ing|6s|2uce|5d|5s|4ing|3l|4ed|4ing|4s|3mya|6ed|6ing|6s|3nders|8es|3sage|7d|7s|6ing|2vage|6d|',
  '6s|5ing|4nna|7ed|7h|8ed|8ing|8s|7ing|7s|3e|4d|5ed|5ing|5s|4s|3ing|6ed|6ing|6s|4or|6ed|6ing|6s|3oy|5s|2w|3mill|7ed|7ing|7',
  's|3s|3yer|6ed|6ing|6s|2x|3e|4d|4s|3ing|3on|5ed|5ied|7s|6ng|5s|5y|4phone|9d|9s|8ing|9st|Bed|Bing|Bs|2y|3ing|6ed|6ing|6s|3',
  's|1cala|5ed|5ing|5s|4e|5d|6ed|6ing|6s|5s|6es|4ing|7ed|7ing|7s|4p|5ed|5ing|5s|3m|4ed|4ing|4s|3n|4dal|7ed|7ing|7s|5inavia|',
  'Bed|Bing|Bn|Ced|Cing|Cs|Bs|4ed|4ing|4ner|7ed|7ing|7s|5ing|8ed|8ing|8s|4s|3r|4ce|6d|6lied|9s|7y|6s|5ing|4e|5d|5s|4f|5ed|5',
  'ing|5s|4ied|6s|5ng|4let|7ed|7ing|7s|4red|7ed|7ing|7s|4s|4y|3ttered|9ed|9ing|9s|7ing|Aed|Aing|As|2enario|8ed|8ing|8s|4e|5',
  'd|5ried|8s|6y|5s|4ic|6ed|6ing|6s|5ng|4t|5ed|7ed|7ing|7s|5ing|5s|2hedule|8d|8s|7ing|4me|6d|6s|5ing|3izophrenia|Ded|Ding|D',
  's|3neider|9ed|9ing|9s|3olar|7ed|7ing|7lied|As|8y|7s|8hip|Bed|Bing|Bs|6stic|Aed|Aing|As|4ol|6ed|6house|Bd|Bs|Aing|6ing|9e',
  'd|9ing|9s|6s|5ner|8ed|8ing|8s|3warz|7es|2ience|7d|7s|6ing|5t|6ed|6ific|Aed|Aing|As|7ng|7st|9ed|9ing|9s|6s|3ssors|8es|2of',
  'fed|3op|5ed|7ed|7ing|7s|5ing|5s|4ted|3pe|5d|5s|4ing|3re|5d|6ed|6ing|6s|5r|6ed|6ing|6s|5s|4ing|7ed|7ing|7s|4pion|8ed|8ing',
  '|8s|3t|4ch|6ed|7s|6ing|4ed|4ia|6ed|6ing|6s|5ng|4s|5es|4t|5ed|5ing|6sh|8ed|9s|8ing|5s|3ut|5ed|5ing|8ed|8ing|8s|5s|3wl|5ed',
  '|5ing|5s|2ram|5ble|8d|8s|7ing|Aed|Aing|As|5ed|5ing|5s|4p|5e|6d|7ed|7ing|7s|6s|5ing|8ed|8ing|8s|5ped|8ed|8ing|8s|5s|4tch|',
  '7ed|8s|9es|7ing|Aed|Aing|As|3eam|6ed|6ing|9ed|9ing|9s|6s|4en|6ed|8ed|8ing|8s|6ing|9ed|9ing|9s|6play|As|6s|6writer|Ced|Ci',
  'ng|Cs|4w|5ed|7ed|7ing|7s|5ing|8ed|8ing|8s|5s|3ibe|6d|6s|5ing|4pt|6ed|6ing|6s|6ure|9d|9s|8ing|3oll|6ed|6ing|6s|3ub|5bed|8',
  'ed|8ing|8s|5ed|5ing|5s|4tinied|9s|7y|2ulpt|6ed|6ing|6or|8ed|8ing|8s|6s|6ure|9d|9s|8ing|1ea|3h|4ed|4ing|4s|3l|4ed|6ed|6in',
  'g|6s|4ing|7ed|7ing|7s|4s|3m|4an|6ed|6ing|6s|4ed|4ing|4s|4us|6es|3n|4ed|4ing|4s|3r|4ch|6ed|7s|6ing|9ed|9ing|9s|4ed|4ing|7',
  'ed|7ing|7s|4s|3s|4ide|7d|7s|6ing|4on|6al|8ed|8ing|8s|6ed|8ed|8ing|8s|6ing|6s|3t|4ed|6ed|6ing|6s|5r|6ed|6ing|6s|4ing|7ed|',
  '7ing|7s|4s|2bastian|9ed|9ing|9s|2c|3ession|9ed|9ing|9s|3luded|8ed|8ing|8s|3ond|6aried|As|8y|6ed|6ing|6lied|9s|7y|6s|3rec',
  'ied|8s|6y|5t|6ariat|Bed|Bing|Bs|9ed|As|8y|6ed|6ing|7ve|9d|9s|8ing|6lied|9s|7y|6s|3s|3t|4ed|4ing|5on|7al|9ed|9ing|9s|7ed|',
  '7ing|7s|4or|6ed|6ing|6s|4s|3ular|7ed|7ing|7s|4re|6d|6lied|9s|7y|6s|5ing|6tied|9s|7y|2dan|5ed|5ing|5s|4t|5ed|5ing|5s|3ime',
  'nt|8aried|Cs|Ay|8ed|8ing|8s|3ovic|7ed|7ing|7s|3uce|6d|6s|5ing|5tion|9ed|9ing|9s|7ve|9d|9s|8ing|2e|3d|4ed|6ed|6ing|6s|4in',
  'g|4s|3ing|6ed|6ing|6s|3k|4ed|5r|6ed|6ing|6s|4ing|7ed|7ing|7s|4s|3m|4ed|4ing|7ed|7ing|7lied|As|8y|7s|4s|3n|4ed|4ing|4s|4u',
  '|5ed|5ing|5s|3s|2gment|7ed|7ing|7s|3regated|8ion|Bed|Bing|Bs|2hyo|5ed|5ing|5s|2ine|5d|5s|4ing|3smic|7ed|7ing|7s|3ze|5d|5',
  's|4ing|7ed|7ing|7s|4ure|7d|7s|6ing|2kar|5ed|5ing|5s|2ldom|6ed|6ing|6s|3ect|6ed|8ed|8ing|8s|6ing|7on|9ed|9ing|9s|7ve|9d|9',
  's|8ing|6or|8ed|8ing|8s|6s|4na|6ed|6ing|6s|3f|4ed|4ing|5sh|7ed|8s|7ing|4s|3l|4ed|5r|6ed|6ing|6s|4ing|7ed|7ing|7s|4s|2mant',
  'ic|8ed|8ing|8s|9es|3ester|8ed|8ing|8s|3i|4conductor|Ded|Ding|Ds|4ed|4final|9ed|9ing|9s|4ing|4nal|7ed|7ing|7s|6r|7ed|7ied',
  '|9s|8ng|7s|7y|5ole|8d|8s|7ing|4s|4tic|7ed|7ing|7s|2n|3ate|6d|6s|5ing|5or|7ed|7ing|7s|3d|4ed|4ing|7ed|7ing|7s|4s|3eca|6ed',
  '|6ing|6s|4gal|7ed|7ing|7s|3ior|6ed|6ing|6s|3s|4ation|9ed|9ing|9s|4e|5d|6ed|6ing|6s|5s|4ible|8d|8s|7ing|5ng|5tive|9d|9s|8',
  'ing|9tied|Cs|Ay|4or|6ed|6ied|8s|7ng|6s|6y|4ual|7ed|7ing|7s|3t|4ed|5nce|8d|8s|7ing|4iment|9al|Bed|Bing|Bs|9ed|9ing|9s|5ne',
  'l|8ed|8ing|8s|6g|4s|2parate|8d|8lied|Bs|9y|8s|9es|7ing|Aed|Aing|As|8on|Aed|Aing|As|3t|4ed|5mber|9ed|9ing|9s|4ing|4s|2que',
  'l|6ed|6ing|6s|5nce|8d|8s|7ing|6tial|Aed|Aing|As|2r|3a|4ed|4ing|4s|3b|4ed|4ian|7ed|7ing|7s|5ng|4s|3dar|6ed|6ing|6s|3ena|6',
  'ed|6ing|6s|5e|6d|6s|5ing|3ge|5ant|8ed|8ing|8s|5d|5i|6ed|6ing|6s|5s|4ing|5o|6ed|6ing|6s|5u|6ed|6ing|6s|3ial|6ed|6ing|7zed',
  '|6s|4es|6es|4ous|7es|7lied|As|8y|7ness|Bes|3mon|6ed|6ing|6s|3pent|7ed|7ing|7s|3ra|5ed|5ing|5s|3s|3um|5ed|5ing|5s|3vant|7',
  'ed|7ing|7s|4e|5d|5r|6ed|6ing|6s|5s|4ice|7d|7s|6ing|5ng|7ed|7ing|7s|2same|6d|6s|5ing|3sion|7ed|7ing|7s|8es|2t|3h|4ed|4ing',
  '|4s|3on|5ed|5ing|5s|3s|3t|4ed|4ing|7ed|7ing|7s|4le|6d|7ed|7ing|7s|6ment|Aed|Aing|As|6r|7ed|7ing|7s|6s|5ing|8ed|8ing|8s|4',
  's|3up|5ed|5ing|5s|2ven|5ed|5ing|5s|5teen|9ed|9ing|9s|9th|Bed|Bing|Bs|6h|7ed|7ing|7s|6ied|8s|6y|4r|5al|7ed|7ing|7s|5e|6d|',
  '6lied|9s|7y|6s|5ing|6tied|9s|7y|5s|2wage|6d|6s|5ing|3er|5ed|5ing|5s|3ing|6ed|6ing|6s|2x|3es|3ied|5s|3ual|6ed|6ing|7tied|',
  'As|8y|6lied|9s|7y|6s|3y|2ymour|7ed|7ing|7s|1ha|3ck|5ed|5ing|5s|3de|5d|6ed|6ing|6s|5s|4ied|6s|5ng|4ow|6ed|8ed|8ing|8s|6ie',
  'd|8s|7ng|6s|6y|4y|3ft|5ed|5ing|5s|3ggied|7s|5y|3h|4ed|4id|6ed|6ing|6s|5ng|4s|3i|4ed|4ing|4s|3ke|5d|5n|6ed|6ing|6s|5s|4ie',
  'd|6s|5l|6ed|6ing|6s|5ng|7ed|7ing|7s|4y|3le|5d|5s|4ing|4l|5ed|5ing|5ow|7ed|7ing|7s|5s|3m|4an|6ed|6ing|6s|4e|5d|5s|4im|6ed',
  '|6ing|6s|5ng|4rock|8ed|8ing|8s|4s|3n|4e|5d|5s|4g|5ed|5hai|8ed|8ing|8s|5ing|5s|4ing|4kar|7ed|7ing|7s|4non|7ed|7ing|7s|4s|',
  '3pe|5d|6ed|6ing|6s|5s|4ing|7ed|7ing|7s|3rada|7ed|7ing|7s|5n|6ed|6ing|6s|4ds|4e|5d|5holder|Bed|Bing|Bs|5s|4i|5ed|5ing|5ng',
  '|5s|4k|5ed|5ing|5s|4on|6ed|6ing|6s|4p|5ed|6ned|5ing|5lied|8s|6y|5s|3s|3tter|7ed|7ing|Aed|Aing|As|7s|3ve|5d|6ed|6ing|6s|5',
  's|4ing|3w|4ed|4ing|4n|5ed|5ing|5s|4s|3y|4s|2e|3a|4ed|4ing|4n|5ed|5ing|5s|4r|5ed|5ing|5s|4s|4th|6ed|6ing|6s|3d|4ed|4ing|4',
  's|3en|5ed|5ing|5s|4p|5ed|5ing|5s|4r|5ed|5ing|5s|4t|5ed|5ing|5s|3ffield|9ed|9ing|9s|3ila|6ed|6ing|6s|3l|4ed|4f|5ed|5ing|5',
  's|4ing|4l|5ed|5ied|7s|6ng|5s|5y|4s|4ter|7ed|9ed|9ing|9s|7ing|7s|4ves|3n|4ed|4g|5ed|5ing|5s|4ing|4s|3pherd|8ed|8ing|8s|3r',
  '|4ed|4iff|7ed|7ing|7s|5ng|4lock|8ed|8ing|8s|4man|7ed|7ing|7s|4ri|6ed|7s|6ing|6s|5y|4s|3s|3tland|8ed|8ing|8s|2i|3ed|4ld|6',
  'ed|8ed|8ing|8s|6ing|9ed|9ing|9s|6s|4s|3ft|5ed|6r|7ed|7ing|7s|5ing|8ed|8ing|8s|5s|3llings|3mmering|Aed|Aing|As|3n|4e|5d|5',
  's|4ied|6s|5ng|7ed|7ing|7s|4s|4y|3p|4building|Ced|Cing|Cs|4ed|4ing|4ment|8ed|8ing|8s|4ped|7ed|7ing|7s|5ing|8ed|8ing|8s|4s',
  '|4yard|8ed|8ing|8s|3re|5d|5s|4ing|4ley|7s|4t|5ed|5ing|5s|3s|3ver|6ed|6ing|9ed|9ing|9s|6s|2o|3ck|5ed|5ing|8ed|8ing|8s|5s|',
  '3e|4ed|4ing|4s|3ne|5d|5s|4ing|3ok|5ed|5ing|5s|4t|5ed|6r|7ed|7ing|7s|5ing|8ed|8ing|8s|5s|3p|4ed|4ing|4ping|8ed|8ing|8s|4s',
  '|3re|5d|5s|4ing|4t|5age|8d|8s|7ing|5ed|6ned|6r|7ed|7ing|7s|6st|5ing|5lied|8s|6y|5s|6es|6top|9ed|9ing|9s|3s|3t|4ed|4gun|7',
  'ed|7ing|7s|4ing|4s|3uld|6ed|7r|8ed|Aed|Aing|As|8ing|8s|6ing|6s|4t|5ed|5ing|8ed|8ing|8s|5s|3ve|5d|5l|6ed|6ing|6s|5s|4ing|',
  '3w|4case|8d|8s|7ing|4down|8ed|8ing|8s|4ed|5r|6ed|6ing|6s|4ing|7ed|7ing|7s|4n|5ed|5ing|5s|4s|2red|5ed|5ing|5s|3iek|6ed|6i',
  'ng|6s|4ll|6ed|6ing|6s|4mp|6ed|6ing|6s|4ne|6d|6s|5ing|5k|6ed|6ing|9ed|9ing|9s|6s|3opshire|Ad|As|9ing|3ub|5ed|5ing|5s|4g|5',
  'ed|5ing|5s|2u|3dder|7ed|7ing|7s|3ffle|7d|7s|6ing|9ed|9ing|9s|3s|3t|4down|8ed|8ing|8s|4ed|4ing|4oku|7ed|7ing|7s|4s|4ter|7',
  'ed|7ing|7s|5ing|8ed|8ing|8s|5le|7d|7s|6ing|3vra|6ed|6ing|6s|2y|3am|5ed|5ing|5s|1iam|4ed|4ing|4s|2berian|8ed|8ing|8s|3lin',
  'g|7ed|7ing|7s|2c|3ilian|8ed|8ing|8s|3k|4ed|4ing|4ness|8es|4s|3s|2d|3e|4d|5ed|5ing|5s|4s|5es|4walk|8ed|8ing|8s|6ys|8es|3i',
  'ng|6ed|6ing|6s|3ney|6s|3s|2ege|5d|5s|4fried|9ed|9ing|9s|4ing|4urd|7ed|7ing|7s|3na|5ed|5ing|5s|4na|6ed|6ing|6s|3rra|6ed|6',
  'ing|6s|2g|3h|4ed|4ing|7ed|7ing|7s|4s|4t|5ed|7ed|7ing|7s|5ing|8ed|8ing|8s|5s|3ma|5ed|5ing|5s|3n|4al|6ed|6ing|6s|5ture|9d|',
  '9s|8ing|4ed|4ificance|Cd|Cs|Bing|At|Bed|Bing|Blied|Es|Cy|Bs|7es|5ng|4s|3s|3urd|6ed|6ing|6s|2kh|4ed|4ing|4s|2l|3as|5es|3e',
  'nce|7d|8ed|8ing|8s|7s|6ing|5t|6ed|6ing|6lied|9s|7y|6s|4sia|7ed|7ing|7n|8ed|8ing|8s|7s|3houette|Ad|As|9ing|3icon|7ed|7ing',
  '|7s|3k|4ed|4ied|6s|5ng|4s|4y|3lied|6s|4y|3s|3va|5ed|5ing|5s|4er|6ed|6ied|8s|7ng|6s|6y|4ia|6ed|6ing|6s|2m|3a|4ed|4ing|4s|',
  '3eon|6ed|6ing|6s|3ilar|7ed|7ing|8tied|Bs|9y|7lied|As|8y|7s|3mons|3on|5ed|5ing|5s|3ple|6d|6r|7ed|7ing|7s|6s|7t|5icitied|B',
  's|9y|6ed|7s|6fied|Aed|Aing|As|6ng|5y|3s|3ulate|8d|8s|7ing|8on|Aed|Aing|As|7or|9ed|9ing|9s|5cast|9ed|9ing|9s|5taneous|Ces',
  '|Clied|Fs|Dy|2n|3ce|5d|5re|7d|7lied|As|8y|7s|6ing|7tied|As|8y|5s|4ing|3g|4ed|5r|6ed|6ing|6s|4h|5ed|5ing|5s|4ing|7ed|7ing',
  '|7s|4le|6d|7ed|7ing|7s|6s|7es|6ton|9ed|9ing|9s|5ing|4s|4ular|8ed|8ing|8s|3ister|8ed|8ing|8s|3k|4ed|4ing|7ed|7ing|7s|4s|3',
  's|2oux|5es|2p|3ing|6ed|6ing|6s|3s|2r|3e|4d|4n|5ed|5ing|5s|4s|3ing|4us|6es|3s|2s|3es|3ter|6ed|6ing|6s|2t|3e|4d|4s|3ing|3s',
  '|3ting|7ed|7ing|7s|3uated|8ed|8ing|8s|6ion|9ed|9ing|9s|2x|3es|3teen|7ed|7ing|7s|7th|9ed|9ing|9s|4h|5ed|5ing|5s|4ied|6s|4',
  'y|2zable|7d|7s|6ing|3e|4d|5ed|5ing|5s|4s|5es|3ing|1jaak|5ed|5ing|5s|2ouke|6d|6s|5ing|1kate|5d|5r|6ed|6ing|6s|5s|4ing|7ed',
  '|7ing|7s|2eeter|7ed|7ing|7s|3f|4ed|4ing|4s|3letal|8ed|8ing|8s|6on|8ed|8ing|8s|3ptical|9ed|9ing|9s|7ism|Aed|Aing|As|3tch|',
  '6ed|7s|6ing|2i|3ed|4r|5ed|5ing|5s|4s|5es|3ing|6ed|6ing|6s|3ll|5ed|7ed|7ing|7s|5ing|5s|3mmed|7ed|7ing|7s|3n|4ed|4ing|4ned',
  '|7ed|7ing|7s|6r|7ed|7ing|7s|5ied|7s|5y|4s|3p|4ed|4ing|4per|7ed|7ing|7s|5ing|8ed|8ing|8s|4s|3rmish|8ed|9s|8ing|4t|5ed|5in',
  'g|5s|3s|2ull|5ed|5ing|5s|2y|3e|4ed|4ing|4s|3scraper|Aed|Aing|As|1lab|4ed|4ing|4s|3ck|5ed|5ing|5s|3de|5d|5s|4ing|3in|5ed|',
  '5ing|5s|3m|4ed|4ing|4s|3ng|5ed|5ing|5s|4t|5ed|5ing|5s|3p|4ed|4ing|4ping|8ed|8ing|8s|4s|3rtibartfast|Eed|Eing|Es|3sh|5ed|',
  '7ed|7ing|7s|6s|5ing|3te|5d|5r|6ed|6ing|6s|5s|4ing|3ughter|9ed|9ing|9s|3ve|5d|5ried|8s|6y|5s|4ic|6ed|6ing|6s|5ng|3yer|6ed',
  '|6ing|6s|2ee|4ed|4ing|4k|5ed|5ing|5s|4p|5ed|6r|7ed|7ing|7s|5ied|7s|6ng|8ed|8ing|8s|5s|5y|4s|4ve|6d|6s|5ing|3nder|7ed|7in',
  'g|7s|3pt|5ed|5ing|5s|2ice|5d|6ed|6ing|6s|5s|4ing|7ed|7ing|7s|4k|5ed|5ing|5s|3d|4e|5d|5s|4ing|7ed|7ing|7s|4s|3ed|4s|3ght|',
  '6ed|7st|6ing|6lied|9s|7y|6s|3m|4ed|4ing|4s|3ng|5ed|5ing|5s|3p|4ed|4ing|4ped|7ed|7ing|7s|6ried|9s|7y|5ing|8ed|8ing|8s|4s|',
  '3t|4ed|4ing|4s|2oan|5ed|5ing|5s|3gan|6ed|6ing|6s|3op|5ed|5ing|5s|3pe|5d|5s|4ing|7ed|7ing|7s|4pied|7s|5y|3t|4ed|4ing|4s|3',
  'vak|6ed|6ing|6s|4ene|7d|7s|6ian|9ed|9ing|9s|7ng|3w|4ed|5r|6s|4ing|4lied|7s|5y|4s|2ug|4ed|4ing|4s|3mp|5ed|5ing|5s|3ng|5ed',
  '|5ing|5s|2y|1mack|5ed|5ing|5s|3ll|5ed|6r|7ed|7ing|7s|6st|5ing|5pox|8es|5s|3rt|5ed|6r|7s|5ing|5phone|As|5s|3sh|5ed|6s|5in',
  'g|8ed|8ing|8s|2eared|7ed|7ing|7s|3ll|5ed|7ed|7ing|7s|5ing|8ed|8ing|8s|5s|2ile|5d|5s|4ing|7ed|7ing|7s|3rk|5ed|5ing|5s|3th',
  '|5ed|5ing|5s|6onian|Bed|Bing|Bs|2oke|5d|6ed|6ing|6s|5s|4ied|6s|5ng|7ed|7ing|7s|4y|3oth|6ed|6ing|9ed|9ing|9s|6lied|9s|7y|',
  '6s|2ug|4ed|4gling|9ed|9ing|9s|4ing|4s|2yth|5ed|5ing|5s|1nack|5ed|5ing|5s|3il|5ed|5ing|5s|6es|3ke|5d|5s|4ing|3p|4ed|4ing|',
  '4ped|7ed|7ing|7s|5ing|8ed|8ing|8s|4s|5es|3rl|5ed|5ing|5s|3tch|6ed|8ed|8ing|8s|7s|6ing|2eak|5ed|6rs|5ing|8ed|8ing|8s|5s|3',
  'ered|2iff|5ed|5ing|8ed|8ing|8s|5s|3per|6ed|6ing|6s|2ooker|7ed|7ing|7s|4p|5ed|5ing|5s|3rt|5ed|5ing|5s|3ut|5ed|5ing|5s|3w|',
  '4ed|4fall|8ed|8ing|8s|4ied|6s|5ng|4s|4y|2uck|5ed|5ing|5s|3ggled|1o|2aked|6ed|6ing|6s|4ing|7ed|7ing|7s|3p|4ed|4ing|4s|3re',
  'd|4ing|7ed|7ing|7s|2b|3bing|7ed|7ing|7s|3er|5ed|5ing|5s|3s|2c|3cer|6ed|6ing|6s|3ial|6ed|6ing|7sm|9ed|9ing|9s|8t|9ed|9ing',
  '|9s|6lied|9s|7y|6s|4etal|8ed|8ing|8s|6ied|8s|6y|4ological|Ced|Cing|Cs|9ed|As|9st|Bed|Bing|Bs|8y|3k|4ed|5t|6ed|6ing|6s|4i',
  'ng|4s|3orrito|9ed|9ing|9s|3s|2da|4ed|4ing|4s|3ium|6ed|6ing|6s|2fa|4ed|4ing|4s|3ia|5ed|5ing|5s|3oklis|8es|3t|4ball|8ed|8i',
  'ng|8s|4ed|5ned|5r|6s|4ing|4lied|7s|5y|4ness|8es|4s|4ware|8d|8s|7ing|2ho|4ed|4ing|4s|2il|4ed|4ing|4s|2l|3ar|5ed|5ing|5s|3',
  'd|4ed|4ier|7ed|7ing|7s|5ng|4s|3e|4d|4lied|7s|5y|4mn|6ed|6ing|6lied|9s|7y|6s|4s|3icitor|9ed|9ing|9s|4d|5aritied|Bs|9y|5ed',
  '|5ing|5s|4ng|4taried|9s|7y|5ude|8d|8s|7ing|3o|4ed|4ing|5st|7ed|7ing|7s|4mon|7ed|7ing|7s|4s|3s|3uble|7d|7s|6ing|4tion|8ed',
  '|8ing|8s|3ve|5d|5nt|7ed|7ing|7s|5s|4ing|2mali|6ed|6ing|6s|3ber|6ed|6ing|6s|3e|4bodied|9s|7y|4d|5ay|7s|4how|7ed|7ing|7s|4',
  'one|7d|7s|6ing|4place|9d|9s|8ing|4rset|8ed|8ing|8s|4s|4thing|9ed|9ing|9s|5ime|8d|8s|9es|7ing|4what|8ed|8ing|8s|6ere|9d|9',
  's|8ing|3ing|2n|3ar|5ed|5ing|5s|4ta|6ed|6ing|6s|3g|4ed|4ing|4s|3ic|5ed|5ing|5s|3ja|5ed|5ing|5s|3nied|6s|4y|3s|4es|2ohong|',
  '7ed|7ing|7s|3n|4ed|5r|6ed|6ing|6s|4ing|4s|3the|6d|6s|5ing|8ed|8ing|8s|2ph|4ed|4ia|6ed|6ing|6s|5ng|5stic|9ated|Ded|Ding|D',
  's|9ed|9ing|9s|4omore|9d|9s|8ing|4s|3rano|7ed|7ing|7s|2rbonne|8d|8s|7ing|3cerer|8ed|8ing|8s|3e|4d|4s|3ing|3oritied|9s|7y|',
  '3rel|6ed|6ing|6s|4ied|6s|4ow|6ed|6ing|6s|4y|3t|4ed|6ed|6ing|6s|4ing|4s|2ught|6ed|6ing|6s|3l|4ed|4ing|4s|3nd|5ed|5ing|8ed',
  '|8ing|8s|5s|3p|4ed|4ing|4s|3r|4ce|6d|6s|5ing|4ed|4ing|4s|3s|4es|3th|5bound|Aed|Aing|As|5east|9ed|Arn|Ced|Cing|Cs|9ing|9s',
  '|6d|6rn|8ed|8ing|8most|Ced|Cing|Cs|8s|5ing|5land|9ed|9ing|9s|5s|5ward|9ed|9ing|9s|6est|9ed|Arn|Ced|Cing|Cs|9ing|9s|2v|3e',
  'reign|9ed|9ing|9s|9tied|Cs|Ay|3iet|6ed|6ing|6s|3s|2y|3s|1pa|3ce|5d|6ed|6ing|6s|5s|6hip|9ed|9ing|9s|4ing|5ous|8es|3de|5d|',
  '5s|4ing|3ghetti|9ed|9ing|9s|3m|4ed|4ing|4s|3n|4ed|4iards|5ng|5sh|7ed|8s|7ing|4ned|5ing|4s|3re|5d|5s|4hawk|8ed|8ing|8s|4i',
  'ng|4k|5ed|7ed|7ing|7s|5ing|5le|7d|7s|6ing|9ed|9ing|9s|5s|6es|4row|7ed|7ing|7s|4se|6d|6lied|9s|7y|6s|5ing|4t|5an|7ed|7ing',
  '|7s|5ed|5ing|5s|3s|4s|5es|3t|4ed|4ial|7ed|7ing|7s|5ng|4s|3wn|5ed|5ing|8ed|8ing|8s|5s|2eak|5ed|6r|7ed|7ing|7s|5ing|8ed|8i',
  'ng|8s|5s|4r|5ed|5headed|5ing|5s|3c|4ed|4ial|7ed|7ing|8st|Aed|Aing|As|8zation|Eed|Eing|Es|9ed|Bed|Bing|Bs|As|9ing|7lied|A',
  's|8y|7s|7tied|As|8y|5es|7es|5fic|8allied|Ds|By|9tion|Ded|Ding|Ds|8ed|8ing|8s|7ed|8s|6y|5men|8ed|8ing|8s|5ng|4s|4tacle|9d',
  '|9s|8ing|7ular|Bed|Bing|Bs|6tor|9ed|9ing|9s|5ra|7ed|7ing|7l|8ed|8ing|8s|7s|6oscopied|Ds|By|6um|8ed|8ing|8s|4ulated|8ion|',
  'Bed|Bing|Bs|9ve|Bd|Bs|Aing|3d|4ed|4ing|4s|3ech|6ed|7s|6ing|6less|Aes|4d|5ed|5ied|7s|6ng|8ed|8ing|8s|5s|5way|8s|5y|3ll|5e',
  'd|5ing|8ed|8ing|8s|5s|3nce|6d|6r|7ed|7ing|7s|6s|5ing|4d|5ed|5ing|8ed|8ing|8s|5s|4t|5ed|5ing|5s|3rm|5ed|5ing|5s|2here|6d|',
  '6s|5ical|9ed|9ing|9s|6ng|3inx|6es|2ice|5d|5s|4ied|6s|5ng|4y|3der|6ed|6ing|6s|3ed|4s|3ke|5d|6ed|6ing|6s|5s|4ing|3ll|5ed|5',
  'ing|5s|3n|4al|6ed|6ing|6s|4e|5d|5s|4ing|4ning|8ed|8ing|8s|4s|3ral|6ed|6ing|6s|4e|5d|5s|4ing|5t|6ed|8ed|8ing|8s|6ing|6s|6',
  'ual|9ed|9ing|Atied|Ds|By|9s|3t|4e|5d|5s|4fire|8d|8s|7ing|4ing|4s|4ting|8ed|8ing|8s|2lash|6ed|8ed|8ing|8s|7s|6ing|3endid|',
  '8ed|8ing|8s|3inter|8ed|8ing|8s|4t|5ed|5ing|5s|5ting|9ed|9ing|9s|2ock|5ed|5ing|5s|3il|5ed|7ed|7ing|7s|5ing|5s|3ke|5d|5n|6',
  'ed|6ing|6s|5s|6man|9ed|9ing|9s|6woman|Bed|Bing|Bs|4ing|3nge|6d|6s|5ing|4sor|7ed|7ing|7s|8hip|Bed|Bing|Bs|4taneous|Bes|Bl',
  'ied|Es|Cy|3on|5ed|5ing|5s|3radic|8ed|8ing|8s|4es|4t|5ed|5ing|8ed|8ing|8s|5s|6es|6man|9ed|9ing|9s|3t|4ed|4ing|4light|9ed|',
  '9ing|9s|4s|4ted|7ed|7ing|7s|5ing|8ed|8ing|8s|3use|6d|6s|5ing|2rang|6ed|6ing|6s|4wled|6ing|9ed|9ing|9s|4y|5s|3ead|6ed|6in',
  'g|9ed|9ing|9s|6s|3ing|6ed|7r|8ed|8ing|8s|6ing|6s|5t|6ed|7r|8ed|8ing|8s|6ing|6s|3uce|6d|6s|5ing|4ng|6ed|6ing|6s|2udboy|7s',
  '|3n|4ed|4ing|4s|3r|4ed|4ing|4red|7ed|7ing|7s|4s|2y|3ros|6es|1quad|5ed|5ing|5ron|8ed|8ing|8s|5s|4re|6d|7ed|7ing|7s|6s|5in',
  'g|4sh|6ed|7s|6ing|4t|5ed|5ing|5s|3eak|6ed|6ing|6s|5led|4eze|7d|7s|6ing|9ed|9ing|9s|3id|5ed|5ing|5s|4nted|8ed|8ing|8s|6in',
  'g|9ed|9ing|9s|4re|6d|6s|5ing|5rel|8ed|8ing|8s|1ri|3dhar|7an|9ed|9ing|9s|7ed|7ing|7s|3kanth|8ed|8ing|8s|3nivas|8an|Aed|Ai',
  'ng|As|8es|3ram|6ed|6ing|6s|3s|3vatsan|9ed|9ing|9s|1si|3s|1tab|4bing|8ed|8ing|8s|4ed|4ilitied|As|8y|7zation|Ded|Ding|Ds|8',
  'e|9d|9s|8ing|5ng|4le|6d|6s|5ing|4s|3cey|6s|4ied|6s|4k|5ed|5ing|5s|4y|3de|5d|5s|4ing|5on|7ed|7ing|7s|5um|7ed|7ing|7s|3ff|',
  '5ed|7ed|7ing|7s|5ing|5s|3ge|5coach|Aed|Bs|Aing|5d|6ed|6ing|6s|5s|6es|4ger|7ed|7ing|Aed|Aing|As|7s|4ing|7ed|7ing|7s|3in|5',
  'ed|5ing|5less|9es|5s|4r|5case|9d|9s|8ing|5ed|5ing|5s|5way|8s|3ke|5d|5holders|5s|4ing|3le|5d|5s|4ing|4k|5ed|7ed|7ing|7s|6',
  'r|7ed|7ing|7s|5ing|8ed|8ing|8s|5s|4l|5ed|5ing|6on|8ed|8ing|8s|5s|3mmered|4p|5ed|7e|8d|8s|7ing|5ing|5s|3n|4ce|6d|6s|5ing|',
  '4d|5ard|8ed|8ing|9zation|Fed|Fing|Fs|Aed|Ced|Cing|Cs|8s|5ed|5ing|8ed|8ing|8s|5s|4ed|4ing|5slaw|9ed|9ing|9s|4ley|7s|5ied|',
  '7s|5y|4s|4za|6ed|6ing|6s|3ple|6d|6s|5ing|3r|4board|9ed|9ing|9s|5uck|8ed|8ing|8s|4e|5d|5s|4ing|7ed|7ing|7s|4k|5ed|5ing|5s',
  '|4red|7ed|7ing|7s|5ing|8ed|8ing|8s|4s|4t|5ed|6r|7ed|7ing|7s|5ing|8ed|8ing|8s|5led|6ing|9ed|9ing|9s|5s|4vation|Aed|Aing|A',
  's|5ed|7ed|7ing|7s|5ing|3te|5d|6ed|6ing|6s|5hood|9ed|9ing|9s|5ment|9ed|9ing|9s|5s|6man|9ed|9ing|9s|4ic|6ed|6ing|6s|5ng|5o',
  'n|7aried|Bs|9y|7ed|7ing|7s|5st|7ed|7ical|Bed|Bing|Blied|Es|Cy|Bs|9s|Aes|8ng|7s|4ue|6d|6s|5ing|5re|7d|7s|6ing|5s|6es|5te|',
  '7d|7s|6ing|6oried|As|8y|3unch|7ed|8s|7ing|3y|4ed|6ed|6ing|6s|4s|5es|2ead|5ed|5ied|7s|6lied|9s|7y|6ng|5s|5y|4k|5ed|5ing|5',
  's|4l|5ed|5ing|8ed|8ing|8s|5s|5th|7ed|7ing|7s|4m|5boat|9ed|9ing|9s|5ed|6r|7ed|7ing|7s|5ing|8ed|8ing|8s|5s|6hip|9ed|9ing|9',
  's|3el|5ed|6rs|5ing|5s|4n|5ed|5ing|5s|4p|5ed|5ing|5s|4r|5ed|5ing|8ed|8ing|8s|5s|3fan|6ed|6ing|6s|3in|5ed|6r|7s|5ing|5s|3l',
  'la|6ed|6ing|6r|7ed|7ing|7s|6s|3m|4ed|4ing|4med|7ed|7ing|7s|5ing|8ed|8ing|8s|4s|3nch|6ed|7s|6ing|3p|4ed|4father|Aed|Aing|',
  'As|4han|7e|8d|8s|7ie|9d|9s|8ing|8ng|7s|5e|6d|6n|7ed|7ing|7s|6s|5ing|4ing|4mother|Aed|Aing|As|4pe|6d|7ed|7ing|7s|6s|5ing|',
  '8ed|8ing|8s|4s|3re|5d|5o|6ed|6ing|6s|6types|5s|4ile|7d|7s|6ing|5ng|4ling|8ed|8ing|8s|4n|5ed|5ing|5s|3van|6ed|6ing|6s|4e|',
  '5d|5n|6ed|6ing|6s|5s|4ing|3w|4ard|7ed|7ing|7s|6t|7ed|7ing|7s|4ed|4ing|4s|2ick|5ed|5ied|7s|6ng|8ed|8ing|8s|5s|6es|5y|3ed|',
  '4s|3ff|5ed|6ned|5ing|5lied|8s|6y|5s|4led|3gma|6ed|6ing|6s|3ll|5ed|5ing|5ness|9es|5s|3m|4ed|4ing|4s|4ulate|9d|9s|8ing|9on',
  '|Bed|Bing|Bs|6i|7ed|7ing|7s|6us|8es|3ng|5ed|5ing|8ed|8ing|8s|5s|4k|5ed|5ing|5s|4t|5ed|5ing|5s|3pulated|3r|4ed|4ing|4ring',
  '|8ed|8ing|8s|4s|3tch|6ed|7s|6ing|2ock|5ed|5ing|8s|5s|6es|5ton|8ed|8ing|8s|3ke|5d|5s|4ing|3le|5d|5n|6ed|6ing|6s|5s|4ing|3',
  'mach|7ed|8s|7ing|4ped|3ne|5d|5s|4ied|6s|5ng|4y|3od|5ed|5ing|5s|4l|5ed|5ing|5s|3p|4ed|4ing|4ped|7ed|7ing|7s|5ing|8ed|8ing',
  '|8s|4s|3rage|7d|7s|6ing|4e|5d|5s|4ied|6s|5ng|4m|5ed|5ied|7s|6ng|5s|5y|4y|5telling|Ced|Cing|Cs|3ut|5ed|5ing|5s|3ve|5d|5s|',
  '4ing|2ra|4ed|4ight|8ed|9n|Aed|Aing|As|8forward|Fed|Fing|Fs|8ing|8s|5n|6ed|8ed|8ing|8s|6g|6ing|9ed|9ing|9s|6s|5t|6ed|6ing',
  '|6s|4ka|6ed|6ing|6s|4nd|6ed|6ing|6s|5ge|7d|7lied|As|8y|7r|8ed|8ing|8s|7s|6ing|6led|4p|5ed|5ing|5ped|8ed|8ing|8s|5s|4s|4t',
  'a|6ed|6ing|6s|5egic|9allied|Es|Cy|9ed|9ing|9s|8ed|9s|7y|4w|5berried|Bs|9y|5ed|5ing|5s|4y|5s|3e|4ak|6ed|8ed|8ing|8s|6ing|',
  '6s|5m|6ed|6ing|9ed|9ing|9s|6lined|Bed|Bing|Bs|6s|4d|4et|6car|9ed|9ing|9s|6ed|6ing|6s|7es|4ng|6ed|6ing|6s|6th|8ed|9n|Aed|',
  'Aing|Ded|Ding|Ds|As|8ing|8s|4s|5s|6es|4t|5ch|7ed|8s|7ing|5ed|5ing|5s|4wn|6ed|6ing|6s|3icken|8ed|8ing|8s|5t|6ed|6ing|6lie',
  'd|9s|7y|6s|4de|6d|6s|5ing|4fe|6d|6s|5ing|4ke|6d|6r|7ed|7ing|7s|6s|5ing|8ed|8ing|8s|4ng|6ed|6ing|6s|4p|5e|6d|7ed|7ing|7s|',
  '6s|5ing|5ped|8ed|8ing|8s|6ing|9ed|9ing|9s|5s|4ve|6d|6s|5ing|3ode|6d|6s|5ing|4ke|6d|6s|5ing|8ed|8ing|8s|4ll|6ed|6ing|6s|4',
  'ng|6ed|7r|8s|7st|6hold|Aed|Aing|As|6ing|6lied|9s|7y|6s|3uck|6ed|6ing|6s|5tural|Aed|Aing|Alied|Ds|By|As|8e|9d|Aed|Aing|As',
  '|9s|8ing|4ggle|8d|8s|7ing|Aed|Aing|As|4ng|6ed|6ing|6s|2u|3art|6ed|6ing|6s|3b|4ble|7d|7s|6ing|5orn|8ed|8ing|8s|4ed|4ing|4',
  's|3cco|6ed|6ing|6s|4k|5ed|5ing|5s|3d|4ed|5nt|7ed|7ing|7s|4ied|7ed|7ing|7s|6s|5ng|5o|6ed|6ing|6s|4s|4y|3ff|5ed|7ed|7ing|7',
  's|5ing|8ed|8ing|8s|5s|3mble|7d|7s|6ing|9ed|9ing|9s|4p|5ed|5ing|5s|3n|4ed|4g|5ed|5ing|5s|4ing|4ning|8ed|8ing|8s|4s|4t|5ed',
  '|5ing|5s|3pid|6ed|6ing|7tied|As|8y|6s|3rdied|7s|5y|3s|2y|3le|5d|5s|4ing|7ed|7ing|7s|5stic|9ed|9ing|9s|5zed|3x|4es|1ub|3c',
  'ommittee|Ced|Cing|Cs|5nscious|Ces|6tinent|Ced|Cing|Cs|3district|Bed|Bing|Bs|5vided|7sion|Bed|Bing|Bs|4ued|7ed|7ing|7s|3f',
  'amilied|As|8y|3genus|8es|4roup|8ed|8ing|8s|3ject|7ed|9ed|9ing|9s|7ing|8ve|Ad|As|9ing|7s|3lime|7d|7s|6ing|3marine|9d|9s|8',
  'ing|4erged|9ed|9ing|9s|4ission|Aed|Aing|As|5t|6ed|6ing|6s|3ordinate|Bd|Bs|Aing|3ra|5ed|5ing|5s|3s|4cribe|9d|9rs|9s|8ing|',
  '7ption|Ced|Cing|Cs|4ection|Aed|Aing|As|5quent|Aed|Aing|Alied|Ds|By|As|5t|6ed|6ing|6s|4ided|6iaried|Bs|9y|7ed|8s|6y|5sten',
  'ce|Bd|Bs|Aing|4pecies|Aes|4tance|9d|9s|8ing|7t|8ed|8ial|Bed|Bing|Blied|Es|Cy|Bs|9ng|9ve|Bd|Bs|Aing|8s|5itute|Ad|Bed|Bing',
  '|Bs|As|9ing|Aon|Ced|Cing|Cs|5rate|9d|9s|8ing|3terranean|Ced|Cing|Cs|4le|6d|6s|5ied|7s|6ng|5y|4ropical|Bed|Bing|Bs|3unit|',
  '7ed|7ing|7s|4rb|6an|8ed|8ing|8s|6ed|6ing|6s|3way|6s|2cceed|7ed|7ing|Aed|Aing|As|7s|5ss|7es|7ful|Aed|Aing|Alied|Ds|By|As|',
  '7ion|Aed|Aing|As|8ve|Ad|Alied|Ds|By|As|9ing|7or|9ed|9ing|9s|4umbed|3h|4ed|5s|4ing|3k|4ed|5r|6ed|6ing|6s|4ing|7ed|7ing|7s',
  '|4s|2d|3an|5ed|6se|8d|8s|7ing|5ing|5s|3den|6ed|6ing|6lied|9s|7y|6s|3s|2e|3d|4ed|4ing|3s|2ff|4ed|5r|6ed|6ing|9ed|9ing|9s|',
  '6s|4icient|Aed|Aing|Alied|Ds|By|As|5ng|5x|6es|4olk|7ed|7ing|7s|4rage|8d|8s|7ing|4s|3i|4ed|4ing|4s|2gar|5ed|5ing|5s|3gest',
  '|7ed|7ing|Aed|Aing|As|8on|Aed|Aing|As|7s|3ih|5ed|5ing|5s|2i|3cidal|8ed|8ing|8s|6e|7d|7s|6ing|3s|3t|4able|8d|8s|7ing|4cas',
  'e|8d|8s|7ing|4e|5d|5s|4ing|4s|2ltan|6ate|9d|9s|8ing|6ed|6ing|6s|2m|3atra|7ed|7ing|7s|3itro|7ed|7ing|7s|3mar|6ed|6ied|8s|',
  '7ng|7zed|6s|6y|4er|6ed|6ing|6s|4it|6ed|6ing|6s|4on|6ed|6ing|6s|7es|3ner|6ed|6ing|6s|3o|4ed|4ing|4s|3s|2n|3dar|6ed|7san|A',
  'ed|Aing|As|6ing|6s|5y|6s|3g|4ed|4ing|4lasses|4s|3il|5ed|5ing|5s|3k|4ed|5n|6ed|6ing|6s|4ing|4s|3light|8ed|8ing|8s|3ni|5ed',
  '|6s|5ing|5s|4y|3rise|7d|7s|6ing|3s|4et|6ed|6ing|6s|4hine|8d|8s|7ing|2p|3er|5b|6ed|6ing|6s|5ed|5familied|Cs|Ay|6icial|Bed',
  '|Bing|Bs|5hero|9ed|9ing|9s|6uman|Aed|Aing|As|5ing|7tendent|Eed|Eing|Es|6or|8ed|8ing|9tied|Cs|Ay|8s|5man|8ed|8ing|8s|7rke',
  't|Bed|Bing|Bs|5natural|Ced|Cing|Cs|5s|6eded|6tructure|Ed|Es|Ding|5vise|9d|9s|8ing|9on|Bed|Bing|Bs|8or|Aed|Aied|Cs|Bng|As',
  '|Ay|3per|6ed|6ing|6s|4lement|Aal|Ced|Cing|Cs|Bried|Es|Cy|Aed|Aing|As|5ied|7r|8ed|8ing|8s|7s|5y|4ort|7ed|8r|9ed|9ing|9s|7',
  'ing|Aed|Aing|As|8ve|Ad|As|9ing|7s|5se|7d|8ed|8ing|8lied|Bs|9y|8s|7s|6ing|4ress|8ed|Aed|Aing|As|9s|8ion|Bed|Bing|Bs|3rema',
  'cied|As|8y|6e|7d|7s|6ing|3s|2r|3e|4d|4lied|7s|5y|4s|5h|6ed|7s|6ing|3f|4ace|7d|8ed|8ing|8s|7s|6ing|4ed|5r|6ed|6ing|6s|4in',
  'g|4s|3ge|5d|5on|7ed|7ing|7s|5ried|8s|6y|5s|4ical|8ed|8ing|8s|5ng|3ing|3name|7d|7s|6ing|3pass|7es|7ing|Aed|Aing|As|4lus|7',
  'es|4rise|8d|8s|7ing|Aed|Aing|Alied|Ds|By|As|3render|9ed|9ing|9s|5y|6s|4ound|8ed|Aed|Aing|As|8ing|Bed|Bing|Bs|Ces|8s|3s|3',
  'veillance|Cd|Cs|Bing|5y|6ing|9ed|9ing|9s|6or|8ed|8ing|8s|6s|4ival|8ed|8ing|8s|6e|7d|7s|6ing|9ed|9ing|9s|6or|8ed|8ing|8s|',
  '3ya|5ed|5ing|5s|2s|3an|5ed|5ing|5na|7ed|7ing|7s|6e|7d|7s|6ing|5s|3cept|7ed|7ible|Bd|Bs|Aing|8ng|7s|3es|3ie|5d|5s|4ing|3p',
  'ect|7ed|9ed|9ing|9s|7ing|7s|5nd|7ed|9ed|9ing|9s|7ing|7s|6se|8d|8s|7ing|8on|Aed|Aing|As|4icion|9ed|9ing|9s|8us|Aes|Alied|',
  'Ds|By|3quehanna|Bed|Bing|Bs|3sex|6es|3tain|7able|Bd|Bs|Aing|7ed|9ed|9ing|9s|7ing|Aed|Aing|As|7s|3umu|6ed|6ing|6s|2tra|5e',
  'd|5ing|5s|2u|3s|2wandi|7ed|7ing|7s|2yog|5ed|5ing|5s|2zan|5ed|5ing|5ne|7d|7s|6ing|5s|3ied|5s|3y|1vante|6d|6s|5ing|1wallow',
  '|7ed|7ing|7s|3m|4ed|4i|5ed|6s|5ing|5ng|5s|4p|5ed|5ing|5s|4s|4y|3n|4ed|4ing|4s|3p|4ed|4ing|4s|3rm|5ed|5ing|5s|3t|4ed|4ing',
  '|4s|3y|4ed|6ed|6ing|6s|4ing|7ed|7ing|7s|4s|2ear|5ed|5ing|5s|4t|5ed|6r|7ed|7ing|7s|5ied|7s|6ng|8ed|8ing|8s|5s|5y|3dish|7e',
  'd|8s|7ing|3ep|5ed|5ing|8ed|8ing|8s|5s|4t|5ed|5heart|Aed|Aing|As|5ie|7d|7s|6ing|6ng|5lied|8s|6y|5ness|9es|5s|3ll|5ed|7ed|',
  '7ing|7s|5ing|8ed|8ing|8s|5s|3pt|5ed|5ing|5s|2ift|5ed|5ing|5ly|5s|3m|4ed|4ing|4mer|7ed|7ing|7s|5ing|8ed|8ing|8s|4s|3ng|5e',
  'd|5ing|8ed|8ing|8s|5s|3ped|3rl|5ed|5ing|5s|3ss|5es|3tch|6ed|8ed|8ing|8s|7s|6ing|9ed|9ing|9s|2ollen|7ed|7ing|7s|3rd|5ed|5',
  'ing|5s|4e|5d|5s|4ing|4n|5ed|5ing|5s|2ung|5ed|5ing|5s|1yd|3s|2ed|4ed|4ing|4s|2llable|8d|8s|7ing|3van|6ed|6ing|6s|4ester|9',
  'ed|9ing|9s|4ia|6ed|6ing|6s|2mbol|6ed|6ic|8ed|8ing|8s|7ng|7sm|9ed|9ing|9s|6s|3metric|9al|Bed|Bing|Bs|9ed|9ing|9s|8ed|9s|7',
  'y|3pathetic|Bed|Bing|Bs|7ied|9s|7y|4honic|9ed|9ing|9s|8ed|9s|7y|4osium|9ed|9ing|9s|4toms|2nagogue|9d|9s|8ing|3c|4ed|4hro',
  'nized|Ced|Cing|Cs|4ing|4s|3dicate|9d|9s|8ing|9on|Bed|Bing|Bs|4rome|8d|8s|7ing|3od|5ed|5ing|5s|4nym|7ed|7ing|7ous|Aes|7s|',
  '3tax|6es|4hesis|9es|8zed|Ar|Bed|Bing|Bs|6tic|9ed|9ing|9s|2riac|6ed|6ing|6s|5n|6ed|6ing|6s|3up|5ed|5ing|5s|2stem|6atic|Aa',
  'llied|Fs|Dy|Aed|Aing|As|6ed|6ic|8ed|8ing|8s|7ng|6s|2un|4ed|4ing|4s|0tab|3itha|7ed|7ing|7s|3le|5d|5s|6es|5t|6ed|6ing|6s|4',
  'ing|4oid|7ed|7ing|7s|3oo|5ed|5ing|5s|3s|2ck|4ed|4ing|4le|6d|7ed|7ing|7s|6s|5ing|4s|3t|4ed|4ic|6al|8ed|8ing|8s|6ed|6ing|6',
  's|7es|5ng|4s|2d|3s|2e|3d|3s|2ft|4ed|4ing|4s|2g|3ged|6ed|6ing|6s|3s|2hsin|6ed|6ing|6s|2i|3l|4ed|6ed|6ing|6s|4ing|4or|6ed|',
  '6ing|6s|4s|3nted|3s|3t|4ed|4ing|4s|2kao|5ed|5ing|5s|4yuki|8ed|8ing|8s|3e|4d|4n|5ed|5ing|5s|4s|4uchi|8ed|8ing|8s|3ing|6ed',
  '|6ing|6s|2l|3bot|6ed|6ing|6s|3e|4d|4nt|6ed|8ed|8ing|8s|6ing|6s|4s|5es|3ing|3k|4ed|4ing|7ed|7ing|7s|4s|3l|4ed|5r|6ed|6ing',
  '|6s|5st|4ied|6s|5ng|4s|4y|3mud|6ed|6ing|6s|3on|5ed|5ing|5s|3s|3uk|5a|6ed|6ing|6s|5ed|5ing|5s|2m|3ara|6ed|6ing|6s|3e|4d|4',
  's|3il|5ed|5ing|5s|4ng|3mied|6s|4y|3s|2n|3aka|6ed|6ing|6s|3dem|6ed|6ing|6s|4ied|6s|4y|3g|4ed|5nt|7ed|7ing|7s|4ible|8d|8s|',
  '7ing|5ng|4le|6d|6s|5ing|4o|5ed|5ing|5s|4s|3k|4ed|5r|6ed|6ing|6s|4ing|4s|3ned|6ed|6ing|6s|5r|6ed|6ing|6s|3s|3ya|5ed|5ing|',
  '5s|2o|3s|2p|3e|4d|4s|5tried|9s|7y|3ing|3ping|7ed|7ing|7s|3s|4es|2r|3a|4ed|4ing|4s|3eq|5ed|5ing|5s|3get|6ed|8ed|8ing|8s|6',
  'ing|6s|3iff|6ed|6ing|6s|3mi|5ed|5ing|5s|3s|3zan|6ed|6ing|6s|2sk|4ed|4ing|4s|3manian|9ed|9ing|9s|3te|5d|6ed|6ing|6s|5s|4i',
  'ng|7ed|7ing|7s|2tar|5ed|5ing|5s|3e|4d|4s|3ing|3too|6ed|6ing|6s|2u|3ght|6ed|6ing|6s|3nting|8ed|8ing|8s|5on|7ed|7ing|7s|3r',
  'us|6es|3s|3t|4ed|4ing|4s|2vern|6ed|6ing|6s|2x|3ation|8ed|8ing|8s|3es|3i|4ed|4ing|4s|5es|3on|5ed|5ing|5omic|9ed|9ing|9s|8',
  'ed|9s|7y|5s|3payer|8ed|8ing|8s|2y|3lor|6ed|6ing|6s|3s|1ea|3ch|5ed|6r|7ed|7ing|7s|6s|5ing|8ed|8ing|8s|3m|4ed|4ing|7ed|7in',
  'g|7s|4mate|8d|8s|7ing|4s|3r|4ed|4ing|7ed|7ing|7s|4s|3s|4e|5d|5r|6ed|6ing|6s|5s|4ing|7ed|7ing|7s|2ch|4ed|5s|4ing|4nical|9',
  'ed|9ing|9lied|Cs|Ay|9s|7ian|Aed|Aing|As|6que|9d|9s|8ing|5ological|Ded|Ding|Ds|Aed|Bs|9y|2d|3died|6s|4y|3s|2e|3n|4age|7d|',
  '7r|8s|7s|6ing|4ed|4ing|4s|5es|3s|3th|5ed|5ing|5s|2hsil|6ed|6ing|6s|2le|4cast|8ed|8ing|8s|5ommunication|Foned|Foning|Fons',
  '|4d|4gram|8ed|8ing|8s|7ph|9ed|9ing|9s|4phone|9d|9s|8ing|4s|5cope|9d|9s|8ing|4vised|7ion|Aed|Aing|As|3ing|3l|4ed|5r|6ed|6',
  'ing|6s|4ing|7ed|7ing|7s|4s|3ugu|6ed|6ing|6s|2mp|4ed|5r|6ament|Bed|Bing|Bs|7nce|Ad|As|9ing|7te|9d|9s|8ing|8ure|Bd|Bs|Aing',
  '|6ed|8ed|8ing|8s|6ing|6s|5st|7ed|7ing|7s|4ing|4lar|7ed|7ing|7s|6te|8d|8s|7ing|5e|6d|6s|5ing|4o|5ed|5ing|5ral|8ed|8ing|8s',
  '|7ried|As|9lied|Cs|Ay|8y|5s|4s|4t|5ation|Aed|Aing|As|5ed|5ing|8ed|8ing|8s|5s|2n|3ant|6ed|6ing|6s|3d|4ed|5ncied|9s|7y|5r|',
  '6ed|6ing|6lied|9s|7y|6ness|Aes|6s|4ing|7ed|7ing|7s|4s|3nis|6es|3or|5ed|5ing|5s|3s|4e|5d|5s|4ing|5on|7ed|7ing|7s|4or|6ed|',
  '6ing|6s|3t|4acles|5tive|9d|9lied|Cs|Ay|9s|8ing|4ed|4h|5ed|5ing|5s|4ing|4s|3ure|6d|6s|5ing|2quila|7ed|7ing|7s|2rence|7d|7',
  's|6ing|4sa|6ed|6ing|6s|3i|4ann|7ed|7ing|7s|4ed|4ing|4s|3m|4ed|4in|6al|8ed|8ing|8s|7te|9d|9s|8ing|9on|Bed|Bing|Bs|6ed|6g|',
  '6ing|6ologied|Cs|Ay|6s|6us|8es|4s|3race|7d|7s|6ing|5in|7ed|7ing|7s|5nce|8d|8s|7ing|4ence|8d|8s|7ing|5strial|Bed|Bing|Bs|',
  '4i|5ble|8d|8s|7ied|9s|8ng|7y|5ed|6s|5fic|8ed|8ing|8s|7ed|6ying|Aed|Aing|As|5ing|5s|5torial|Bed|Bing|Bs|9ed|As|8y|4or|6ed',
  '|6ing|7sm|9ed|9ing|9s|8t|9ed|9ing|9s|6s|4y|3tiaried|9s|7y|3uyuki|8ed|8ing|8s|2ss|4es|3t|4ament|9ed|9ing|9s|4ed|6ed|6ing|',
  '6s|4ified|8s|6y|5monied|As|8y|5ng|7ed|7ing|7s|4osterone|Cd|Cs|Bing|4s|2xans|4s|5es|3t|4book|8ed|8ing|8s|4ed|4ile|7d|7s|6',
  'ing|5ng|4s|4ual|7ed|7ing|7s|5re|7d|7s|6ing|1ha|3d|4ed|4ing|4s|3i|4ed|4ing|4s|3n|4ed|4ing|4k|5ed|5ful|8ed|8ing|8lied|Bs|9',
  'y|8s|5ing|5s|6es|6giving|Ced|Cing|Cs|4s|3ren|6ed|6ing|6s|3s|3t|4cher|8ed|8ing|8s|4ed|4ing|4s|2e|3ater|7ed|7ing|7s|5re|7s',
  '|6ical|Aed|Aing|As|3d|3e|4ed|4ing|4s|3ft|5ed|5ing|5s|3ir|5ed|5ing|5s|6es|3m|4atic|8ed|8ing|8s|4e|5d|5s|4ing|4s|5elves|Ae',
  's|3n|4ce|6d|6s|5ing|4ed|4ing|4s|3o|4dore|8d|8s|7ing|4ed|4ing|4logian|Aed|Aing|As|8cal|Bed|Bing|Bs|8ed|9s|7y|4rem|7ed|7in',
  'g|7s|6tical|Bed|Bing|Blied|Es|Cy|Bs|5ied|7s|6st|8ed|8ing|8s|5y|4s|3r|4apeutic|Bed|Bing|Bs|6ied|8s|7st|9ed|9ing|9s|6y|4e|',
  '5after|Aed|Aing|As|5bied|8s|6y|5d|5fore|9d|9s|8ing|5of|7ed|7ing|7s|5s|6a|7ed|7ing|7s|6e|7d|7s|6ing|4ing|4m|5al|7ed|7ing|',
  '7s|5ed|5ing|5s|4s|3s|4e|5d|5s|4ing|5s|6es|3ta|5ed|5ing|5s|3y|4s|2ick|5ed|6r|7s|5ing|5ness|9es|5s|3ed|4f|5ed|5ing|5s|4rri',
  'ed|8s|6y|4s|4ves|3gh|5ed|5ing|5s|3n|4ed|4g|5ed|5ing|5s|4ing|4k|5ed|6rs|5ing|8ed|8ing|8s|5s|4ner|7ed|7ing|7s|4s|3rd|5ed|5',
  'ing|5s|4st|6ed|6ied|8s|7ng|6s|6y|4teen|8ed|8ing|8s|8th|Aed|Aing|As|5ied|7s|5y|3s|4es|4tle|7d|7s|6ing|2o|3mas|6es|3ng|5ed',
  '|5ing|5s|3rn|5ed|5ing|5s|4ough|8bred|Ced|Cing|Cs|8ed|8ing|8lied|Bs|9y|8s|3s|4e|5d|5s|4ing|3u|4ed|4gh|6ed|6ing|6s|6t|7ed|',
  '7ful|Aed|Aing|Alied|Ds|By|As|7ing|7s|4ing|4s|5and|8ed|8ing|8s|5es|2rash|6ed|7s|6ing|3ead|6ed|8ed|8ing|8s|6ing|6s|5t|6ed|',
  '7n|8ed|8ing|Bed|Bing|Bs|8s|6ing|6s|4e|5ed|5ing|5s|4shold|9ed|9ing|9s|4w|5ed|5ing|5s|3ill|6ed|7r|8ed|8ing|8s|6ing|9ed|9in',
  'g|9s|6s|4ve|6d|6s|5ing|8ed|8ing|8s|3o|4at|6ed|6ing|6s|4ed|4ing|4ne|6d|6s|5ing|4s|4ttle|8d|8s|7ing|4ugh|7ed|7ing|7out|Aed',
  '|Aing|As|7s|4w|5ed|5ing|8ed|8ing|8s|5n|6ed|6ing|6s|5s|3ust|6ed|6ing|9ed|9ing|9s|6s|2uan|5ed|5ing|5s|3d|4ed|4ing|4s|3g|4e',
  'd|4ing|4s|3mb|5ed|5ing|5s|4p|5ed|5ing|8ed|8ing|8s|5s|3nder|7ed|7ing|7s|3rsday|8s|3s|4es|2warted|2y|3roid|7ed|7ing|7s|1ib',
  '|3erius|8es|4t|5an|7ed|7ing|7s|5ed|5ing|5s|3s|2ck|4ed|6ed|6ing|6s|5t|6ed|6ing|6s|4ing|7ed|7ing|7s|4s|2dal|5ed|5ing|5s|3e',
  '|4d|4s|3ied|5s|4ng|3y|2e|3d|4ed|4ing|4s|3fenthal|Aed|Aing|As|3r|4ed|4ing|4s|3s|2ffanied|8s|6y|2g|3er|5ed|5ing|5s|3ger|6e',
  'd|6ing|6s|3ht|5ed|6n|7ed|7ing|7s|6r|7s|5ing|5lied|8s|6y|5s|3s|2l|3e|4d|5ed|5ing|5s|4s|3ing|3l|4ed|4ing|4s|3s|3t|4ed|4ing',
  '|7ed|7ing|7s|4s|2m|3ber|6ed|6ing|6s|3e|4d|5ed|5ing|5s|4less|8es|5ied|7s|5y|4r|5ed|5ing|5s|4s|5es|4table|9d|9s|8ing|3ing|',
  '6ed|6ing|6s|3o|4ed|4ing|4r|5ed|5ing|5s|4s|4thied|8s|6y|3s|2n|3a|4ed|4ing|4s|3g|4ed|6ed|6ing|6s|4ing|4le|6d|6s|5ing|8ed|8',
  'ing|8s|4s|3ied|5s|3s|3ted|6ed|6ing|6s|3y|2p|3ped|6ed|6ing|6s|4ing|7ed|7ing|7s|3s|2re|4d|5ed|5ing|5s|4s|3ing|2ssue|6d|6s|',
  '5ing|2t|3an|5ed|5ic|7ed|7ing|7s|6ng|6um|8ed|8ing|8s|5s|3le|5d|6ed|6ing|6s|5s|4ing|3s|3ular|7ed|7ing|7s|4s|5es|1o|2ad|4ed',
  '|4ing|4s|3st|5ed|5ing|5s|2bacco|7ed|7ing|7s|3ias|6es|4ed|5s|3y|2d|3ay|5s|3d|4ed|4ing|4s|3s|2e|3rless|8es|3s|2ft|4ed|4ing',
  '|4s|2gether|8ed|8ing|8s|3gle|6d|6s|5ing|2ilet|6ed|6ing|6s|2ken|5ed|5ing|5s|2l|3d|4ed|4ing|4s|3edo|6ed|6ing|6s|4r|5ance|9',
  'd|9s|8ing|7t|8ed|8ing|8s|6te|8d|8s|7ing|5s|3l|4ed|5fsen|9ed|9ing|9s|4ing|4s|3s|2m|3as|5es|4to|6ed|6ing|6s|3b|4ed|4ing|4s',
  '|5tone|9d|9s|8ing|3e|4d|4s|3ing|3mied|6s|4y|3orrow|8ed|8ing|8s|3s|2n|3e|4d|5ed|5ing|5s|4s|3g|4a|5ed|5ing|5s|4ed|4ing|4s|',
  '4ue|6d|6s|5ing|3ic|5ed|5ing|5s|4ed|5s|4ght|7ed|7ing|7s|4ng|3s|3y|2o|3k|4ed|4ing|4s|3l|4ed|4ing|4s|3s|3th|5ed|5ing|5s|2p|',
  '3ic|5al|7ed|7ing|7s|5ed|5ing|5s|3ographic|Bed|Bing|Bs|Aed|Bs|9y|4logical|Bed|Bing|Bs|8ed|9s|7y|3ped|6ed|6ing|6s|4ing|7ed',
  '|7ing|7s|4led|3s|4es|2r|3ah|5ed|5ing|5s|3ch|5ed|6s|5ing|3e|4d|4s|3ied|5s|4ng|3ment|7ed|9ed|9ing|9s|7ing|7s|3n|4ado|7ed|7',
  'ing|7s|4ed|4ing|4s|3o|4ed|4ing|4s|3pedo|7ed|7ing|7s|3que|6d|6s|5ing|3s|4o|5ed|5ing|5s|4ten|7ed|7ing|7s|3t|4ed|4ing|4rici',
  'dae|Bd|Bs|Aing|4s|4ure|7d|8ed|8ing|8s|7s|6ing|3y|2ss|4es|4ing|7ed|7ing|7s|2t|3al|5ed|5ing|5lied|8s|6y|5s|3s|2u|3ch|5down',
  '|9ed|9ing|9s|5ed|7ed|7ing|7s|6s|5ing|8ed|8ing|8s|3fic|6ed|6ing|6s|3g|4ed|4h|5ed|6r|7s|5ing|5s|4ing|4s|3r|4ed|4ing|7ed|7i',
  'ng|7s|5sm|7ed|7ing|7s|6t|7ed|7ing|7s|4nament|Aed|Aing|As|4s|3s|2vah|5ed|5ing|5s|2w|3ard|6ed|6ing|6s|7es|3el|5ed|5ing|5s|',
  '4r|5ed|5ing|8ed|8ing|8s|5s|3ing|6ed|6ing|6s|3n|4ed|4ing|4land|8ed|8ing|8s|4s|5hip|8ed|8ing|8s|5people|Bd|Bs|Aing|3s|2x|3',
  'es|3ic|5ed|5ing|6tied|9s|7y|5s|4n|5ed|5ing|5s|2y|3s|1ra|3ce|5d|5s|5y|6s|4ied|6s|5ng|7ed|7ing|7s|4k|5ed|7ed|7ing|7s|6r|7e',
  'd|7ing|7s|5ing|5s|4t|5ed|5ing|6on|8ed|8ing|8s|5or|7ed|7ing|7s|5s|4y|3dable|8d|8s|7ing|4e|5d|5mark|9ed|9ing|9s|5r|6ed|6in',
  'g|6s|5s|4ing|7ed|7ing|7s|5tion|9al|Bed|Bing|Blied|Es|Cy|Bs|9ed|9ing|9s|3ffic|7ed|7ing|7s|3ged|6ied|8s|6y|4ic|6ed|6ing|6s',
  '|3il|5ed|6r|7ed|7ing|7s|5ing|8ed|8ing|8s|5s|4n|5ed|7ed|7ing|7s|6e|7ed|7ing|7s|6r|7ed|7ing|7s|5ing|8ed|8ing|8s|5s|4t|5ed|',
  '5ing|5or|7ed|7ing|7s|5s|3ject|7ed|7ing|7oried|Bs|9y|7s|3m|4ed|4ing|4s|4way|7s|3n|4ce|6d|6s|5ing|4ed|4ing|4s|5action|Bed|',
  'Bing|Bs|6tlantic|Ded|Ding|Ds|5cribed|8pt|Aed|Aing|Bon|Ded|Ding|Ds|As|5fer|8ed|8ing|8red|Bed|Bing|Bs|9ing|Ced|Cing|Cs|8s|',
  '6orm|9ation|Eed|Eing|Es|9ed|Ars|9ing|Ced|Cing|Cs|9s|5ient|9ed|9ing|9s|6t|7ed|7ing|8on|Aal|Ced|Cing|Cs|Aed|Aing|As|7s|5la',
  'te|9d|9s|8ing|9on|Bed|Bing|Bs|8or|Aed|Aing|As|6ucent|Bed|Bing|Bs|5mission|Ced|Cing|Cs|7t|8ed|8ing|8s|8ter|Bed|Bing|Bs|5p',
  'arencied|Ds|By|At|Bed|Bing|Bs|6lant|Aed|Aing|As|6ort|9ation|Eed|Eing|Es|9ed|Bed|Bing|Bs|9ing|Ced|Cing|Cs|9s|5vaal|9ed|9i',
  'ng|9s|6erse|Ad|As|9ing|3p|4ed|4ing|4ped|7ed|7ing|7s|5ing|8ed|8ing|8s|4s|5es|3s|4h|5ed|6s|5ing|3uma|6ed|6ing|6s|6tic|9ed|',
  '9ing|9s|3ve|5d|5l|6ed|8ed|8ing|8s|7r|8ed|8ing|8s|6ing|9ed|9ing|9s|6led|9ed|9ing|9s|8r|9ed|9ing|9s|7ing|6s|5rs|7e|8d|9ed|',
  '9ing|9s|8s|7ing|5s|4ing|5s|6es|3y|4s|2eacherous|Bes|4d|5ed|5ing|5s|4son|7ed|7ing|7s|5ure|8d|8r|9ed|9ing|9s|8s|7ied|9s|8n',
  'g|7y|4t|5ed|5ied|7s|6ng|8ed|8ing|8s|6se|8d|8s|7ing|5ment|9ed|9ing|9s|5s|5y|3e|4ed|4ing|4s|3k|4ed|4ing|4s|3mble|7d|7s|6in',
  'g|9ed|9ing|9s|4endous|Aes|4or|6ed|6ing|6s|3nch|6ed|7s|6ing|4d|5ed|5ing|5s|4t|5ed|5ing|5on|7ed|7ing|7s|5s|3vor|6ed|6ing|6',
  's|3y|4s|2i|3ad|5ed|5ing|5s|4l|5ed|5ing|5s|4ngle|8d|8s|7ing|6ular|Aed|Aing|As|5taphyllos|Ees|4ssic|8ed|8ing|8s|3bal|6ed|6',
  'ing|6s|4e|5d|5s|4ing|4unal|8ed|8ing|8s|6e|7d|7s|6ing|5taried|As|8y|6e|7d|7s|6ing|3cia|6ed|6ing|6s|4k|5ed|5ied|7s|6ng|5le',
  '|7d|7s|6ing|5s|5y|3dent|7ed|7ing|7s|3ed|5ed|5ing|5s|4r|5ed|5ing|5s|4s|3g|4ed|4ger|7ed|9ed|9ing|9s|7ing|7s|4ing|4s|3llion',
  '|8ed|8ing|8s|4ogied|8s|6y|3m|4ed|4ing|4s|3nitied|8s|6y|3o|4ed|4ing|4s|3p|4ed|4ing|4le|6d|6s|5ing|4oli|7ed|7ing|7s|4s|3s|',
  '4tan|7ed|7ing|7s|3umph|7ant|Aed|Aing|As|7ed|7ing|7s|3vial|7ed|7ing|7s|2ojan|6ed|6ing|6s|3ll|5ed|6y|7s|5ing|5s|3mbone|8d|',
  '8s|7ing|3op|5ed|6r|7ed|7ing|7s|5ing|5s|3phied|7s|5y|4ical|8ed|8ing|8s|3uble|7d|7s|6ing|9ed|9ing|9s|4gh|6ed|6ing|6s|4pe|6',
  'd|6s|5ing|4sers|8es|4t|5ed|5ing|5s|3y|4s|2uce|5d|5s|4ing|4k|5ed|5ing|5s|6es|3e|4d|4s|3ing|3lied|6s|4y|3mp|5ed|6t|7ed|8r|',
  '9ed|9ing|9s|7ing|7s|5ing|5s|3ncated|9ed|9ing|9s|4k|5ed|5ing|5s|3ss|5es|4t|5ed|6e|7ed|7ing|7s|5ing|8ed|8ing|8s|5s|3th|5ed',
  '|5ing|5s|2y|3ing|6ed|6ing|6s|1sar|4ed|4ing|4s|2unami|7ed|7ing|7s|1uan|4ed|4ing|4s|2b|3a|4ed|4ing|4s|3e|4d|4rculosis|Ces|',
  '4s|3ing|3s|3ular|7ed|7ing|7s|2ck|4ed|5r|6ed|6ing|6s|4ing|7ed|7ing|7s|4s|2dor|5ed|5ing|5s|2esday|7s|2fts|2g|3ging|7ed|7in',
  'g|7s|3s|2ition|7ed|7ing|7s|2m|3ble|6d|7ed|7ing|7s|6s|5ing|8ed|8ing|8s|3or|5ed|5ing|5s|3s|2n|3a|4ed|4ing|4s|3e|4d|5ed|5in',
  'g|5s|4s|3g|4ed|4ing|4s|3ic|5ed|5ing|5s|4ng|6ed|6ing|6s|4sian|8ed|8ing|8s|3nel|6ed|6ing|6s|3s|2r|3b|4ed|4ine|7d|7s|8es|6g',
  '|6ing|4o|5ed|5ing|5s|4s|4ulence|Ad|As|9ing|8t|9ed|9ing|9s|3f|4ed|4ing|4s|3k|4ed|5er|7ed|7ing|7s|5y|6s|4ic|6ed|6ing|6s|5n',
  'g|5sh|7ed|8s|7ing|4s|3moil|7ed|7ing|7s|3n|4ed|6ed|6ing|6s|5r|6ed|6ing|6s|4ing|7ed|7ing|7s|4out|7ed|7ing|7s|5ver|8ed|8ing',
  '|8s|4pike|8d|8s|7ing|4s|5es|3quoise|9d|9s|8ing|3ret|6ed|6ing|6s|3s|3tle|6d|6s|5ing|2scanied|8s|6y|2t|3or|5ed|5ial|8ed|8i',
  'ng|8s|6ng|5s|3s|1v|1wain|5ed|5ing|5s|2eed|5ed|5ing|5s|4t|5ed|5ing|5s|3lfth|7ed|7ing|7s|4ve|6d|6s|5ing|3ntied|7s|7th|9ed|',
  '9ing|9s|5y|2ice|5d|5s|4ing|3gs|3light|8ed|8ing|8s|3n|4ed|4ing|4kle|7d|7s|6ing|4ned|7ed|7ing|7s|4s|3st|5ed|7ed|7ing|7s|5i',
  'ng|8ed|8ing|8s|5s|3tch|6ed|7s|6ing|4ter|7ed|7ing|7s|2o|3s|1ying|5ed|5ing|5s|2ler|5ed|5ing|5s|2pe|4d|4s|3hoon|7ed|7ing|7s',
  '|3ical|7ed|7ing|7lied|As|8y|7s|4ng|2rant|6ed|6ing|6s|3e|4d|4s|3ing|3one|6d|6s|5ing|0ubiquitous|Aes|1glied|5s|3y|1k|2rain',
  'ian|9ed|9ing|9s|1lster|6ed|6ing|6s|2timate|8d|8lied|Bs|9y|8s|7ing|7um|9ed|9ing|9s|3ra|5ed|5ing|5s|5violet|Bed|Bing|Bs|2y',
  'sses|7es|1mbrella|8ed|8ing|8s|2pire|6d|6s|5ing|1n|2a|3ble|6d|6s|5ing|3cceptable|Cd|Cs|Bing|3ffected|Aed|Aing|As|3nimous|',
  '9es|9lied|Cs|Ay|3rmed|7ed|7ing|7s|3s|3uthorized|Ced|Cing|Cs|3vailable|Bd|Bs|Aing|3ware|7d|7s|6ing|2bearable|Ad|As|9ing|5',
  'ten|8ed|8ing|8s|4lievable|Cd|Cs|Bing|3roken|8ed|8ing|8s|2cannied|8s|6y|3ertain|9ed|9ing|9s|9tied|Cs|Ay|3hanged|9ed|9ing|',
  '9s|3le|5ar|7ed|7ing|7s|5d|5s|4ing|3omfortable|Dd|Ds|Cied|Es|Dng|Cy|5mon|8ed|8ing|8s|4nscious|Bes|6titutional|Fled|Fling|',
  'Fls|5ventional|Eed|Eing|Es|4ver|7ed|9ed|9ing|9s|7ing|7s|3redited|Aed|Aing|As|2dead|6ed|6ing|6s|4feated|Aed|Aing|As|4r|5c',
  'over|Aed|Aing|As|5ed|6st|5go|7ed|7ing|Aed|Aing|As|7s|6raduate|Dd|Ds|Cing|7ound|Bed|Bing|Bs|5ing|5lying|Aed|Aing|As|5mine',
  '|9d|9s|8ing|5neath|Aed|Aing|As|5s|6ide|9d|9s|8ing|6tand|Aable|Ed|Es|Ding|Aed|Aing|Ded|Ding|Ds|As|7ood|Aed|Aing|As|5take|',
  '9d|9r|Aed|Aing|As|9s|8ing|Bed|Bing|Bs|6ook|9ed|9ing|9s|5water|Aed|Aing|As|7y|8s|6ear|9ed|9ing|9s|7nt|9ed|9ing|9s|6ood|9e',
  'd|9ing|9s|7rld|Aed|Aing|As|4veloped|Bed|Bing|Bs|3isclosed|Bed|Bing|Bs|3o|4cumented|Ced|Cing|Cs|4ed|4ing|4ne|6d|6s|5ing|4',
  's|4ubtedlied|Cs|Ay|3rafted|9ed|9ing|9s|2earthed|9ed|9ing|9s|4se|6d|6s|5ied|7s|6ng|5y|3mploy|8ed|Aed|Aing|As|8ment|Ced|Ci',
  'ng|Cs|8s|3sco|6ed|6ing|6s|3ven|6ed|6ing|6s|3xpected|Aed|Aing|Alied|Ds|By|As|2fair|6ed|6ing|6s|4miliar|Aed|Aing|As|3inish',
  'ed|Aed|Aing|As|4t|5ed|5ing|5s|3old|6ed|8ed|8ing|8s|6ing|6s|4rtunate|Bd|Blied|Es|Cy|Bs|Aing|2happied|8s|6y|4rmed|8ed|8ing',
  '|8s|2icorn|7ed|7ing|7s|3dentified|Ced|Cing|Cs|3fication|Bed|Bing|Bs|5ed|7ed|7ing|7s|4orm|7ed|9ed|9ing|9s|7ing|7lied|As|8',
  'y|7s|3ncorporated|Eed|Eing|Es|4habited|Bed|Bing|Bs|3on|5ed|5ing|6st|8ed|8ing|8s|5s|3que|6d|6lied|9s|7y|6s|5ing|3son|6ed|',
  '6ing|6s|3t|4arian|9ed|9ing|9s|7ed|8s|6y|4e|5d|6ed|6ing|6s|5s|4ied|6s|5ng|7ed|7ing|7s|4s|4y|3versal|9ed|9ing|9lied|Cs|Ay|',
  '9s|7e|8d|8s|7ing|8tied|Bs|9y|2just|6ed|6ing|6s|2known|7ed|7ing|7s|2law|5ed|5ful|8ed|8ing|8s|5ing|5s|3eashed|9ed|9ing|9s|',
  '4ss|6es|3ike|6d|6lied|9s|7y|6s|5ing|4mited|9ed|9ing|9s|3ock|6ed|8ed|8ing|8s|6ing|6s|2manned|8ed|8ing|8s|4rked|8ed|8ing|8',
  's|5ried|9ed|9ing|9s|3istakable|Cd|Cs|Bing|2named|7ed|7ing|7s|4tural|9ed|9ing|9s|3ecessaried|Cs|Ay|3oticed|9ed|9ing|9s|2o',
  'fficial|Aed|Aing|Alied|Ds|By|As|3pposed|9ed|9ing|9s|2paid|6ed|6ing|6s|3leasant|Aed|Aing|As|3opular|9ed|9ing|9s|3recedent',
  'ed|Ded|Ding|Ds|5dict|9able|Dd|Ds|Cing|9ed|9ing|9s|3ublished|Bed|Bing|Bs|2reasonable|Cd|Cs|Bing|4lated|9ed|9ing|9s|5eased',
  '|Aed|Aing|As|5iable|Ad|As|9ing|4st|6ed|6ing|6s|2safe|6d|6s|5ing|3een|6ed|6ing|6s|3igned|8ed|8ing|8s|3pecified|Bed|Bing|B',
  's|4oken|8ed|8ing|8s|3table|8d|8s|7ing|3uccessful|Ced|Cing|Clied|Fs|Dy|Cs|4itable|Ad|As|9ing|4re|6d|6s|5ing|2til|5ed|5ing',
  '|5s|4tled|8ed|8ing|8s|3o|4ed|4ing|4s|4uched|9ed|9ing|9s|2used|6ed|6ing|6s|4ual|7ed|7ing|7lied|As|8y|7s|2veiled|8ed|8ing|',
  '8s|2wanted|8ed|8ing|8s|3illing|9ed|9ing|9s|1p|2beat|6ed|6ing|6s|3ringing|2coming|8ed|8ing|8s|2date|6d|6s|5ing|2grade|7d|',
  '7s|6ing|2held|6ed|6ing|6s|3old|6ed|6ing|6s|2land|6ed|6ing|6s|3oad|6ed|6ing|6s|2on|4ed|4ing|4s|2per|5ed|5ing|5s|2right|7e',
  'd|7ing|7s|4sing|8ed|8ing|8s|2scale|7d|7s|6ing|3et|5ed|5ing|5s|3ide|6d|6s|5ing|3tairs|8es|5te|7d|7s|6ing|4ream|8ed|8ing|8',
  's|2town|6ed|6ing|6s|2ward|6ed|6ing|6s|7es|1ranium|7ed|7ing|7s|2ban|5ed|5ing|5s|2du|4ed|4ing|4s|2ge|4d|4ncied|8s|6y|5t|6e',
  'd|6ing|6lied|9s|7y|6s|4s|3ing|6ed|6ing|6s|2i|3ne|5d|5s|4ing|3s|2s|3es|3ula|6ed|6ing|6s|2uguayan|9ed|9ing|9s|1s|2able|6d|',
  '6s|5ing|3ge|5d|5s|4ing|2e|3d|4ed|4ing|4s|3ful|6ed|6ing|6s|3less|7es|3r|4ed|4ing|4s|3s|2her|5ed|5ing|5s|2ual|5ed|5ing|5li',
  'ed|8s|6y|5s|1ta|3h|4ed|4ing|4s|3s|2ilitied|8s|6y|5zation|Bed|Bing|Bs|6e|7d|7s|6ing|2most|6ed|6ing|6s|2opia|6ed|6ing|6s|2',
  'recht|7ed|7ing|7s|2ter|5ed|5ing|5lied|8s|6y|5s|0vacancied|8s|6y|5t|6ed|6ing|6s|4ted|5ion|8ed|8ing|8s|3cine|7d|7s|6ing|3u',
  'um|6ed|6ing|6s|2dim|5ed|5ing|5s|2g|3s|3ue|5d|5lied|8s|6y|5s|4ing|2in|4ed|4ing|4s|2l|3e|4d|4ncia|8ed|8ing|8s|5t|6ed|6in|8',
  'e|9d|9s|8g|8ing|8s|6s|4ria|7ed|7ing|7s|6e|7d|7s|6ing|4s|4t|5ed|5ing|5s|3iant|7ed|7ing|7s|4d|5ation|Aed|Aing|As|5ed|5ing|',
  '6tied|9s|7y|5s|4ng|3kyrie|8d|8s|7ing|3ley|6s|3or|5ed|5ing|5s|3s|3uable|8d|8s|7ing|5tion|9ed|9ing|9s|4e|5d|6ed|6ing|6s|5s',
  '|4ing|3ve|5d|5s|4ing|2mp|4ed|4ing|5re|7d|7s|6ing|4s|2n|3ce|5d|5s|4ing|3e|4d|4s|5sa|7ed|7ing|7s|3guard|8ed|8ing|8s|3illa|',
  '7ed|7ing|7s|4ng|4sh|6ed|7s|6ing|9ed|9ing|9s|4tied|7s|5y|3s|3tage|7d|7s|6ing|2por|5ed|5ing|5s|2rda|5ed|5ing|5s|3i|4abilit',
  'ied|Cs|Ay|6le|8d|8s|7ing|5nce|8d|8s|7ing|6t|7ed|7ing|7s|5tion|9ed|9ing|9s|4ed|6ed|6ing|6s|5s|5tied|8s|6y|4ing|4ous|7es|7',
  'lied|As|8y|4s|3sitied|8s|6y|3y|2scular|8ed|8ing|8s|3e|4d|4s|3ing|3sal|6ed|6ing|6s|4os|6es|3t|4ed|4ing|4lied|7s|5y|4s|2ti',
  'can|7ed|7ing|7s|2udeville|Ad|As|9ing|3ghn|6ed|6ing|6s|3lt|5ed|7ed|7ing|7s|5ing|5s|1ector|6ed|6ing|6s|2da|4ed|4ing|4s|3ic',
  '|5ed|5ing|5s|2ga|4ed|4ing|4s|3etable|9d|9s|8ing|6rian|Aed|Aing|As|6tion|Aed|Aing|As|2hicle|7d|7s|6ing|2il|4ed|4ing|4s|3n',
  '|4ed|4ing|4s|2locitied|9s|7y|3vet|6ed|6ing|6s|2nd|4ed|4ing|4or|6ed|6ing|6s|4s|3erable|9d|9s|8ing|4tian|8ed|8ing|8s|4zuel',
  'an|Aed|Aing|As|3geance|9d|9s|8ing|3ice|6d|6s|5ing|3kata|7ed|7ing|7s|3om|5ed|5ing|5s|3t|4ed|4ilation|Bed|Bing|Bs|5ng|4ral',
  '|7ed|7ing|7s|4s|4ure|7d|7s|6ing|3ue|5d|5s|4ing|4s|5es|2ra|4ed|4ing|4s|3b|4al|6ed|6ing|6s|4ed|4ing|4s|3dict|7ed|7ing|7s|3',
  'ge|5d|5s|4ing|3ied|5s|4fication|Ced|Cing|Cs|6ed|7s|5y|4tied|7s|5y|3mont|7ed|7ing|7s|3n|4acular|Aed|Aing|As|4ed|4ing|4on|',
  '6ed|6ing|6s|4s|3ona|6ed|6ing|6s|5ica|8ed|8ing|8s|3satile|9d|9s|8ing|4e|5d|5s|4ing|5on|7ed|7ing|7s|4us|6es|3t|4ebrae|9d|9',
  's|8ing|5d|5x|6es|4ical|8ed|8ing|8lied|Bs|9y|8s|6es|8es|5go|7ed|7ing|7s|5ng|4s|3ve|5d|5s|4ing|3y|2ssel|6ed|6ing|6s|3t|4ed',
  '|4ing|4s|2t|3er|5an|7ed|7ing|7s|5inaried|Bs|9y|5s|3o|4ed|4ing|4s|3s|1ia|3ble|6d|6s|5ing|3duct|7ed|7ing|7s|3l|4ed|4ing|4s',
  '|3s|2brant|7ed|7ing|7s|5ted|6ing|9ed|9ing|9s|7on|9ed|9ing|9s|2c|3ar|5ed|5ing|5s|3e|4d|4roy|7s|4s|3ing|5itied|9s|7y|4ous|',
  '7es|3k|4ed|5rs|4i|5e|6d|6s|5ing|5ng|5s|4s|4y|3s|3tim|6ed|6ing|6s|4or|6ed|6ia|8ed|8ing|8n|9ed|9ing|9s|8s|7ed|8s|7ng|7ous|',
  'Aes|6s|6y|2deo|5ed|5ing|5s|3hyanath|Aed|Aing|As|2e|3d|3nna|6ed|6ing|6s|3s|3tnamese|Ad|As|9ing|3w|4ed|5r|6ed|6ing|6s|4ing',
  '|4point|9ed|9ing|9s|4s|2gil|5ed|5ing|5s|3or|5ed|5ing|5ous|8es|8lied|Bs|9y|5s|2jay|5s|2king|6ed|6ing|6s|2la|4ed|4ing|4s|3',
  'e|4d|4s|3helm|7ed|7ing|7s|3ing|3l|4a|5ed|5ge|7d|7rs|7s|6ing|5in|7ed|7g|7ing|7s|5s|4e|5d|5s|4ing|4s|2nce|5d|5nt|7ed|7ing|',
  '7s|6zo|8ed|8ing|8s|5s|4ing|3e|4d|4gar|7ed|7ing|7s|4s|4yard|8ed|8ing|8s|3ing|3od|5ed|5ing|5s|3tage|7d|7s|6ing|3yl|5ed|5in',
  'g|5s|2ol|4a|5ed|5ing|5s|5te|7d|7s|6ing|7on|9ed|9ing|9s|4ed|5nce|8d|8s|7ing|6t|7ed|7ing|7lied|As|8y|7s|5t|6ed|6ing|6s|4in',
  '|6ed|6g|6ing|7st|9ed|9ing|9s|6s|4s|2p|3er|5ed|5ing|5s|3s|2ral|5ed|5ing|5s|3gin|6ed|6ia|8ed|8ing|8s|7ng|7tied|As|8y|6s|3t',
  'ual|7ed|7ing|7lied|As|8y|7s|5e|6d|6s|5ing|3us|5es|2s|3a|4ed|4ing|4s|3count|8ed|8ing|8s|3es|3hal|6ed|6ing|6s|4nu|6ed|6ing',
  '|6s|3ibilitied|Bs|9y|5le|7d|7s|6ied|8s|7ng|6y|4on|6aried|As|8y|6ed|6ing|6s|4t|5ation|Aed|Aing|As|5ed|5ing|8ed|8ing|8s|5o',
  'r|7ed|7ing|7s|5s|3ta|5ed|5ing|5s|4lik|7ed|7ing|7s|3ual|6ed|6ing|6lied|9s|7y|6s|2ta|4ed|4ing|4l|5ed|5ing|5s|4min|7ed|7ing',
  '|7s|4s|2va|4ed|4ing|4s|3ek|5ed|5ing|5s|3id|5ed|5ing|5s|1ladimir|8ed|8ing|8s|5slav|9ed|9ing|9s|1ocabularied|Bs|9y|4l|5ed|',
  '5ing|6st|8ed|8ing|8s|5s|4tional|Aed|Aing|As|2dka|5ed|5ing|5s|2gue|5d|5s|4ing|2ice|5d|6ed|6ing|6s|5s|4ing|3d|4ed|4ing|4s|',
  '3vodeship|Bed|Bing|Bs|2l|3atile|8d|8s|7ing|3can|6ed|6ic|8ed|8ing|8s|7ng|6o|7ed|7ing|7s|6s|3ley|6ball|Aed|Aing|As|6s|3s|3',
  't|4a|5ed|5ge|7d|7s|6ing|5ing|5s|4ed|4ing|4s|3ume|6d|6s|5ing|4ntaried|As|9lied|Cs|Ay|8y|6eer|9ed|9ing|9s|2mit|5ed|5ing|8e',
  'd|8ing|8s|5s|2odoo|6ed|6ing|6s|2rtex|6es|2te|4d|4r|5ed|5ing|5s|4s|3ing|6ed|6ing|6s|2w|3ed|5ed|5ing|5s|4l|5ed|5ing|5s|3s|',
  '2yage|6d|6r|7ed|7ing|7s|6s|5ing|1s|1ulcan|6ed|6ing|6s|3gar|6ed|6ing|6s|3ner|6abilitied|Es|Cy|8le|Ad|As|9ing|6s|3ture|7d|',
  '7s|6ing|0wade|4d|4s|3i|4ed|4ing|4ng|4s|2g|3e|4d|4s|5es|3ing|3on|5ed|5ing|5s|3s|2h|3s|2inwright|Aed|Aing|As|3st|5band|9ed',
  '|9ing|9s|5ed|5ing|5s|3t|4ed|5r|6ed|6ing|6s|4ing|7ed|7ing|7s|4ress|8es|4s|3ved|5rs|2ke|4d|4s|5es|3ing|6ed|6ing|6s|2les|3k',
  '|4ed|5r|6ed|6ing|6s|4ing|7ed|7ing|7s|4over|8ed|8ing|8s|4s|4way|7s|3l|4ed|6ed|6ing|6s|5r|6ed|6ing|6s|5t|6ed|6ing|6s|4ied|',
  '6s|5ng|4s|4y|3nut|6ed|6ing|6s|3sh|5ed|6s|5ing|3t|4ed|5r|6ed|6ing|6s|4ing|4s|4z|5es|2n|3d|4ed|5r|6ed|7rs|6ing|9ed|9ing|9s',
  '|6s|4ing|4s|3g|4ed|4ing|4s|3s|3t|4ed|4ing|7ed|7ing|7s|4s|2r|3d|4ed|5n|6ed|6ing|6s|4ing|4robe|8d|8s|7ing|4s|3e|4d|4house|',
  '9d|9s|8ing|4s|3fare|7d|7s|6ing|3ied|5s|4lied|7s|5y|4ng|3lock|7ed|7ing|7s|3m|4ed|6ed|6ing|6s|5r|6ed|6ing|6s|4ing|7ed|7ing',
  '|7s|4lied|7s|5y|4s|4th|6ed|6ing|6s|3n|4ed|5r|6ed|6ing|6s|4ing|7ed|7ing|7s|4s|3p|4ed|6ed|6ing|6s|4ing|4s|3rant|7ed|7ied|9',
  's|8ng|7s|7y|4en|6ed|6ing|6s|4ior|7ed|7ing|7s|3s|4aw|6ed|6ing|6s|4es|4hip|7ed|7ing|7s|3time|7d|7s|6ing|3wick|7ed|7ing|7s|',
  '3y|2s|3es|3h|4ed|6ed|6ing|6s|5s|4ing|7ed|7ing|7s|7ton|Aed|Aing|As|3p|4ed|4ing|4s|3te|5d|6ed|6ing|6s|5s|4ing|7ed|7ing|7s|',
  '2t|3ch|5ed|7ed|7ing|7s|6s|5ing|8ed|8ing|8s|3er|5ed|7ed|7ing|7s|5fall|9ed|9ing|9s|6ront|Aed|Aing|As|5ied|7s|6ng|8ed|8ing|',
  '8s|5loo|8ed|8ing|8s|5s|6hed|9ed|9ing|9s|5way|8s|5y|3s|3t|4ed|4ing|4s|2ve|4d|5ed|5ing|5s|4s|3ied|5s|4ng|6ed|6ing|6s|3y|2x',
  '|3es|2y|3ne|5d|5s|4ing|3s|4es|1e|2ak|4ed|5n|6ed|6ing|9ed|9ing|9s|6s|5r|6s|4ing|4lied|7s|5y|4ness|8es|4s|3lth|6ed|6ied|8s',
  '|9t|7ng|6s|6y|3pon|6ed|6ing|6ried|9s|7y|6s|3r|4ed|4ied|6s|5ng|7ed|7ing|7s|4s|4y|3sel|6ed|6ing|6s|3ther|7ed|9ed|9ing|9s|7',
  'ing|7s|3ve|5d|5r|6ed|6ing|6s|5s|4ing|7ed|7ing|7s|2b|3ber|6ed|6ing|6s|3er|5ed|5ing|5s|3s|4ite|7s|4ter|7ed|7ing|7s|2d|3din',
  'g|7ed|7ing|7s|3ge|5d|5s|4ing|3nesday|9s|3s|2e|3d|4ed|4ing|4s|3k|4day|7s|4ed|5nd|7ed|7ing|7s|4ing|4lied|7s|5y|4s|3p|4ed|4',
  'ing|7ed|7ing|7s|4s|3s|2i|3gh|5ed|7ed|7ing|7s|5ing|8ed|8ing|8s|5s|5t|6ed|8ed|8ing|8s|6ing|6s|3r|4d|5ed|5ing|5s|4ed|4ing|4',
  's|3s|2lcome|7d|7s|6ing|9ed|9ing|9s|3ded|4ing|7ed|7ing|7s|3f|4are|7d|7s|6ing|4ed|4ing|4s|3l|4ed|4ing|7ton|Aed|Aing|As|4ne',
  'ss|8es|4s|3sh|5ed|6s|5ing|3terweight|Ced|Cing|Cs|2n|3d|4ed|5ll|7ed|7ing|7s|4i|5ed|6s|5ing|5ng|5s|4s|4y|3s|3t|4ed|4ing|4s',
  '|2pt|4ed|4ing|4s|2re|4d|4s|4wolf|8ed|8ing|8s|3ing|3ner|6ed|6ing|6s|2s|3es|3leyan|8ed|8ing|8s|3t|4bound|9ed|9ing|9s|4ed|5',
  'rn|7ed|7ing|7s|4ing|4s|4ward|8ed|8ing|8s|2t|3s|1hale|5d|5s|4ing|7ed|7ing|7s|3rf|5ed|5ing|5s|3t|4ed|5ver|8ed|8ing|8s|4ing',
  '|4s|5oever|Aed|Aing|As|2eat|5ed|5ing|5s|3el|5ed|7ed|7ing|7s|6r|7ed|7ing|7s|5ing|8ed|8ing|8s|5s|3n|4ed|5ver|8ed|8ing|8s|4',
  'ing|4s|3re|5abouts|Bes|6s|7es|5bied|8s|6y|5d|5in|7ed|7ing|7s|5s|5upon|9ed|9ing|9s|5ver|8ed|8ing|8s|4ing|3ther|7ed|7ing|7',
  's|2ich|5ed|6s|6ver|9ed|9ing|9s|5ing|3ed|4s|3g|4ed|4ing|4s|3le|5d|5s|4ing|4st|6ed|6ing|6s|3mper|7ed|7ing|7s|3p|4ed|4ing|4',
  'ped|7ed|7ing|7s|5ing|8ed|8ing|8s|4s|3rled|7ed|7ing|7s|3sk|5ed|6y|7s|5ied|7s|6ng|5s|5y|4per|7ed|9ed|9ing|9s|7ing|Aed|Aing',
  '|As|7s|4tle|7d|7s|6ing|9ed|9ing|9s|3t|4e|5d|5head|9ed|9ing|9s|5s|6es|4ing|5sh|7ed|8s|7ing|4s|2o|3a|4ed|4ing|4s|3ever|7ed',
  '|7ing|7s|3le|5d|5s|6ale|9d|9s|8ing|4ing|4lied|7s|5y|3m|4ed|4ing|4s|3re|5d|5s|4ing|4ls|3s|4e|5d|5s|4ing|2y|1ichita|7ed|7i',
  'ng|7s|3ked|6ed|6ing|6s|5t|6ed|6ing|6s|2d|3e|4d|4lied|7s|5y|4n|5ed|5ing|5s|4r|5s|4s|5pread|Aed|Aing|As|3ing|3ow|5ed|7ed|7',
  'ing|7s|5ing|5s|3s|3th|5ed|5ing|5s|2eld|5ed|5ing|5s|3ner|6ed|6ing|6s|2fe|4d|4s|3ing|2g|3an|5ed|5ing|5s|3gled|3ht|5ed|5ing',
  '|5s|3s|2lbur|6ed|6ing|6s|3d|4cats|4ed|5r|6ed|6ing|6ness|Aes|6s|4ing|4lied|7s|6fe|8d|8s|7ing|5y|4s|3fred|7ed|7ing|7s|3hel',
  'm|7ed|7ing|7s|3kins|7on|9ed|9ing|9s|3l|4ed|6ed|6ing|6s|4iam|7ed|7ing|7s|5e|6d|6s|5ing|5ng|7ed|7ing|7lied|As|8y|7ness|Bes',
  '|7s|4ow|6ed|6ing|6s|4s|4y|3mer|6ed|6ing|6s|3son|6ed|6ing|6s|3ton|6ed|6ing|6s|4shire|9d|9s|8ing|2n|3ce|5d|5s|4hester|Aed|',
  'Aing|As|4ing|3d|4ed|4ied|6s|5ng|7ed|7ing|7s|4mill|8ed|8ing|8s|4ow|6ed|6ing|6s|4s|5hield|Aed|Aing|As|5or|7ed|7ing|7s|4y|3',
  'e|4d|4ried|7s|5y|4s|3g|4ed|6ed|6ing|6s|5r|6ed|6ing|6s|4ing|4s|3ing|3k|4ed|4ing|4ler|7s|4s|3ner|6ed|6ing|6s|4ie|6d|6s|5in',
  'g|5ng|7ed|7ing|7s|3s|4ton|7ed|7ing|7s|3ter|6ed|6ing|6s|2pe|4d|4s|3ing|2re|4d|5ed|5ing|5s|4less|8es|4s|3ing|6ed|6ing|6s|2',
  'sdom|6ed|6ing|6s|3e|4d|4s|3h|4ed|6ed|6ing|6s|5s|4ing|7ed|7ing|7s|3ing|2t|3ch|5craft|Aed|Aing|As|5ed|6s|5ing|3h|4draw|8al',
  '|Aed|Aing|As|8ed|8ing|Bed|Bing|Bs|8n|9ed|9ing|9s|8s|4ed|4in|6ed|6g|6ing|6s|4out|7ed|7ing|7s|4s|5tand|9ed|9ing|9s|3ness|7',
  'es|3s|3tied|6s|4y|2ves|2zard|6ed|6ing|6s|1oke|4d|4s|3ing|2lf|4ed|4gang|8ed|8ing|8s|4ing|4s|3verine|9d|9s|8ing|5s|2man|5e',
  'd|5ing|5s|3b|4ed|4ing|4s|2n|3der|6ed|6ful|9ed|9ing|9s|6ing|9ed|9ing|9s|6land|Aed|Aing|As|6s|3g|4ed|4ing|4s|3s|2o|3d|4ed|',
  '6ed|6ing|6s|5n|6ed|6ing|6s|4ied|6s|5ng|4land|8ed|8ing|8s|4row|7ed|7ing|7s|4s|4ward|8ed|8ing|8s|4y|3l|4ed|4ing|4s|3s|2rce',
  'ster|9ed|9ing|9s|3d|4ed|4ing|4s|3e|4d|4s|3ing|3k|4ed|6ed|6ing|6s|5r|6ed|6ing|6s|4ing|7ed|7ing|7s|4out|7ed|7ing|7s|4place',
  '|9d|9s|8ing|4s|5es|5hop|8ed|8ing|8s|3ld|5ed|5ing|5s|3m|4ed|4ing|4s|3n|4ed|4ing|4s|3ried|7ed|7ing|7s|6s|4y|5ing|8ed|8ing|',
  '8s|3se|5d|5ned|5s|4hip|7ed|7ing|7s|4ing|4t|5ed|5ing|5s|3th|5ed|5ied|7s|6ng|5less|9es|5s|5y|2uld|5ed|5ing|5s|3nd|5ed|7ed|',
  '7ing|7s|5ing|8ed|8ing|8s|5s|6es|2ven|5ed|5ing|5s|2w|3s|1rap|4ed|4ing|4ped|7ed|7ing|7s|5ing|8ed|8ing|8s|4s|3th|5ed|5ing|5',
  's|2eath|6ed|6ing|6s|3ck|5age|8d|8s|7ing|5ed|5ing|5s|3n|4ched|8ed|8ing|8s|4ed|4ing|4s|3st|5ed|5ing|5le|7d|7r|8ed|8ing|8s|',
  '7s|6ing|9ed|9ing|9s|5s|2ied|4s|3ght|6ed|6ing|6s|3nkled|8ed|8ing|8s|3st|5ed|5ing|5s|3t|4e|5d|5r|6ed|6ing|6s|5s|4hing|8ed|',
  '8ing|8s|4ing|7ed|7ing|7s|4s|4ten|7ed|7ing|7s|2ong|5ed|5ing|5lied|8s|6y|5s|3te|5d|5s|4ing|3ught|7ed|7ing|7s|2y|3lied|6s|4',
  'y|1ynn|4ed|4ing|4s|0yacht|5ed|5ing|5s|2hoo|5ed|5ing|5s|2le|4d|4s|3ing|2m|3s|2n|3g|4ed|4ing|4s|3k|4ed|5e|6ed|6ing|6s|4ing',
  '|7ed|7ing|7s|4s|3s|2o|3s|2rd|4ed|4ing|4s|3n|4ed|4ing|4s|2tes|2wned|1eah|4ed|4ing|4s|3r|4book|8ed|8ing|8s|4ed|4ing|4lied|',
  '7s|5y|4ning|8ed|8ing|8s|4s|3st|5ed|5ing|5s|2ll|4ed|4ing|7ed|7ing|7s|4ow|6ed|6ing|7sh|9ed|As|9ing|6s|4s|2men|5ed|5ing|5s|',
  '2n|3s|2omanried|9s|7y|2p|3s|2r|3s|2s|3es|3hiva|7ed|7ing|7s|3terday|9s|2t|3s|1iddish|7ed|8s|7ing|2eld|5ed|5ing|8ed|8ing|8',
  's|5s|2n|3s|1oga|4ed|4ing|4s|2rk|4ed|5r|6ed|6ing|6s|4ing|4s|5hire|9d|9s|8ing|2u|3ng|5ed|6r|7ed|7ing|7s|6st|5ing|5s|3r|4ed',
  '|4ing|4s|5elf|8ed|8ing|8s|7ves|Aes|6s|3s|3th|5ed|5ful|8ed|8ing|8s|5ing|5s|1uan|4ed|4ing|4s|2goslav|8ed|8ing|8s|2ki|4ed|4',
  'ing|4s|2n|3s|1vonne|6d|6s|5ing|0zac|3h|4ed|5s|4ing|3s|1eal|4ed|4ing|4s|2bra|5ed|5ing|5s|2e|3s|2ke|4d|4s|3ing|2n|3ith|6ed',
  '|6ing|6s|3s|2ppelin|8ed|8ing|8s|2ro|4ed|4ing|4s|2ta|4ed|4ing|4s|2us|4es|1imbabwe|8d|8s|7ing|3mer|6s|2nc|4ed|4ing|4s|2on|',
  '4ed|4ing|5st|7ed|7ing|7s|4s|2p|3per|6ed|6ing|6s|3s|1odiac|6ed|6ing|6s|2mbie|6d|6s|5ing|2ne|4d|4s|3ing|6ed|6ing|6s|2o|3lo',
  'gical|Aed|Aing|As|7ed|8s|6y|3m|4ed|4ing|4s|3s|1ulu|4ed|4ing|4s'
].join('');

let cachedEnWords                     = null;
let cachedEnPrefixes                     = null;

const EN_CLITIC_SUFFIXES = ["'s", "'d", "'ll", "'re", "'ve", "'m"];

function getEnLexicon()                                                {
  if (cachedEnWords !== null && cachedEnPrefixes !== null) {
    return { words: cachedEnWords, prefixes: cachedEnPrefixes };
  }

  const words = new Set        (['a', 'i']);
  const prefixes = new Set        ('abcdefghijklmnopqrstuvwxyz'.split(''));

  let prev = '';
  const entries = PACKED_EN_LEXICON.split('|');
  for (let idx = 0; idx < entries.length; idx++) {
    const entry = entries[idx];
    if (!entry) continue;
    const lcp = parseInt(entry[0], 16);
    const word = prev.slice(0, lcp) + entry.slice(1);
    prev = word;
    words.add(word);
    for (let k = 2; k <= word.length; k++) {
      prefixes.add(word.slice(0, k));
    }
  }

  const contractions = [
    "don't", "doesn't", "didn't", "isn't", "aren't", "wasn't", "weren't",
    "won't", "wouldn't", "can't", "couldn't", "shouldn't", "haven't",
    "hasn't", "hadn't", "mustn't", "needn't", "let's", "that's", "what's",
    "there's", "here's", "who's", "where's", "how's", "it's", "he's",
    "she's", "o'clock",
  ];
  for (let c = 0; c < contractions.length; c++) {
    const contr = contractions[c];
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
  for (let s = 0; s < EN_CLITIC_SUFFIXES.length; s++) {
    const suf = EN_CLITIC_SUFFIXES[s];
    if (word.endsWith(suf) && word.length > suf.length) {
      if (words.has(word.slice(0, word.length - suf.length))) {
        return true;
      }
    }
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
      words.has(stem) &&
      (tail === "'" || tail === "'s" || tail === "'d" || tail === "'l" || tail === "'ll" ||
       tail === "'r" || tail === "'re" || tail === "'v" || tail === "'ve" || tail === "'m" || tail === "'t")
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

function endsWithBrahmicConsonant(tok        )          {
  if (!tok || tok.length === 0) return false;
  const cp = tok.charCodeAt(tok.length - 1);
  if (cp < 0x0900 || cp > 0x0d7f) return false;
  const off = cp & 0x7f;
  return (off >= 0x15 && off <= 0x39) || (off >= 0x58 && off <= 0x5f) || off === 0x79;
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

function extendEnLexicalState(
  lmScore        ,
  curWord        ,
  inPrefix         ,
  piece        ,
  words             ,
  prefixes             
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
        sc -= 2.85;
      }
      cw = nextWord;
    } else {
      if (cw.length > 0) {
        const clean = stripTrailingApostrophes(cw);
        if (clean.length > 0) {
          if (isEnWord(clean, words)) {
            sc += clean.length >= 3 ? 2.55 : 0.85;
          } else {
            sc += ip ? -4.75 : -1.90;
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
  words             
)         {
  if (curWord.length === 0) return lmScore;
  const clean = stripTrailingApostrophes(curWord);
  if (clean.length === 0) return lmScore;
  if (isEnWord(clean, words)) {
    return lmScore + (clean.length >= 3 ? 2.55 : 0.85);
  }
  if (inPrefix) return lmScore;
  return lmScore - 1.90;
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
  const beamWidth = isEn ? 14 : 6;
  const topK = Math.min(numClasses - 1, isEn ? 10 : 5);

  const lex = isEn ? getEnLexicon() : null;
  const enWords = lex ? lex.words : new Set        ();
  const enPrefixes = lex ? lex.prefixes : new Set        ();
  const viramaIds = new Set        ();
  if (!isEn) {
    for (let idx = 1; idx < vocabList.length; idx++) {
      if (BRAHMIC_VIRAMAS.has(vocabList[idx])) {
        viramaIds.add(idx);
      }
    }
  }

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
          if (isEn) {
            let tokStr = c < vocabList.length ? vocabList[c] : '';
            if (skipSpecial && isSpecialToken(tokStr)) {
              tokStr = '';
            }
            [nLm, nW, nIp] = extendEnLexicalState(
              state.lmScore,
              state.curWord,
              state.inPrefix,
              tokStr,
              enWords,
              enPrefixes
            );
          } else {
            const prevTok = lastTok > 0 && lastTok < vocabList.length ? vocabList[lastTok] : '';
            const virBonus = viramaIds.has(c) && endsWithBrahmicConsonant(prevTok) ? 0.28 : 0.0;
            nLm = state.lmScore + virBonus;
          }
          nextBeams.set(newKey, {
            ids: [...state.ids, c],
            pb: NEG_INF,
            pnb: extPnb,
            lmScore: nLm,
            curWord: nW,
            inPrefix: nIp,
          });
        }
      }
    }

    if (nextBeams.size > beamWidth) {
      const entries = Array.from(nextBeams.entries());
      entries.sort((a, b) => {
        const sa = logAddExp(a[1].pb, a[1].pnb) + a[1].lmScore;
        const sb = logAddExp(b[1].pb, b[1].pnb) + b[1].lmScore;
        return sb - sa;
      });
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
      ? finalizeEnLexicalScore(state.lmScore, state.curWord, state.inPrefix, enWords)
      : state.lmScore;
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

  const text = normalizeIndicText(tokens.join(''), options);
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
          highStabilityThreshold        ;

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

    // 3. Commit confirmed tokens
    for (let i = alreadyCommitted; i < commitIdx; i++) {
      this.committedTokens.push(rawTokens[i]);
    }

    this.lastHypTokens = [...rawTokens];

    const committedStr = normalizeIndicText(this.committedTokens.join(''), this.options);
    this.committedText = committedStr;

    const volatileTokens = rawTokens.slice(this.committedTokens.length);
    const volatileStr = normalizeIndicText(volatileTokens.join(''), this.options);

    const fullText = joinSubwords(committedStr, volatileStr, volatileTokens, this.options);

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

        // 1. Resolve relative to require('url').pathToFileURL(__filename).href
        if (typeof __filename !== 'undefined') {
          try {
            for (const mn of modelNames) {
              candidates.push(fileURLToPath(new URL(`../../../models/onnx/${mn}`, require('url').pathToFileURL(__filename).href)));
              candidates.push(fileURLToPath(new URL(`../../models/onnx/${mn}`, require('url').pathToFileURL(__filename).href)));
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
          pauseThresholdSamples         = 16000; // 1,000 ms @ 16 kHz (true turn boundary, never mid-clause breath)
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
      trailTokens: 5,
      requireStabilityOnWordBoundary: true,
    });
    this.leftContextSamples = options?.leftContextSamples ?? 30720; // 1,920 ms overlap guarantees committed tail stays in window
    this.maxBufferSamples = options?.maxBufferSamples ?? 61440; // 3,840 ms window cap
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
        if (this.audioBuffer.length >= 24000) {
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

      // Hold irreversible prefix commits during the first <1800ms of an utterance segment
      // while still emitting live volatile partial transcripts from 100ms onward.
      const allowCommit = this.isWindowSliding || this.audioBuffer.length >= 28800;

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
      modelUrl: config.modelUrl,
      headUrl: config.headUrl,
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
    options                                                             = {}
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

  if (sessionCache.has(lang)) {
    if (myEpoch !== latestSetupEpoch) return;
    currentLanguage = lang;
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
  let modelBytes                   ;
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
  sessionCache.set(lang, { session: activeSession, vocab: activeVocab });

  const engineAdapter      = {
    config: { language: lang },
    getVocab: () => activeVocab,
    transcribe: async (pcm              ) => {
      return runAcousticInference(pcm);
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
  pcm              
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
};
