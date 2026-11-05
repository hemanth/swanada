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
 * Implements NFD -> Combining Mark Deduplication -> NFC -> Whitespace collapse.
 */

/**
 * Deduplicate consecutive identical combining marks (Unicode category M: Mn, Mc, Me).
 * Prevents the CTC greedy artifact where prolonged vowels produce duplicated
 * matras (e.g. [matra, blank, matra] -> 'सुु' -> 'सु').
 * Consonants and letters (e.g. double 'l' in "hello", or geminates in Indic scripts) are preserved.
 */
function dedupMarks(text        )         {
  // \p{M} matches any Unicode mark (Mn = Nonspacing Mark, Mc = Spacing Mark, Me = Enclosing Mark)
  return text.replace(/(\p{M})\1+/gu, '$1');
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
  // Replace legacy space markers if present
  text = text.replace(/[\u2581\u2582\u2583▁]/g, ' ');

  // 2. Deduplicate combining marks
  // Two-pass deduplication: NFC handles composite two-part vowel signs (e.g. Bengali \u09cb, Tamil \u0bca),
  // followed by NFD to handle decomposed combining sequences, before final recomposition.
  if (shouldDedup) {
    text = text.normalize('NFC');
    text = dedupMarks(text);
    text = text.normalize('NFD');
    text = dedupMarks(text);
  }

  // 3. Recompose to canonical NFC
  if (shouldNFC) {
    text = text.normalize('NFC');
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
    inferenceMs         = 0
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
    const lockableLimit = Math.max(0, rawTokens.length - this.trailTokens);
    const alreadyCommitted = this.committedTokens.length;

    for (let i = alreadyCommitted; i < lockableLimit; i++) {
      // Check if a space / word boundary appears ahead in the rawTokens
      const isWordBoundaryAhead = rawTokens.slice(i + 1).some(
        (tok) => tok.startsWith('\u2581') || tok.startsWith('▁')
      );
      const isStable = (this.tokenStabilityCounts[i] || 0) >= this.stabilityThreshold;

      if (isWordBoundaryAhead || isStable) {
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
  if (!urlOrPath.startsWith('http://') && !urlOrPath.startsWith('https://') && typeof window === 'undefined') {
    throw new Error(`Model not found at path: ${urlOrPath}`);
  }

  const response = await fetch(urlOrPath);
  if (!response.ok) {
    throw new Error(`Failed to fetch model from ${urlOrPath}: HTTP ${response.status} ${response.statusText}`);
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

    // 1. Feature extraction
    let features              ;
    let numFrames        ;

    if (this.config.preprocessorMode === 'onnx' && this.preprocessorSession) {
      let audioTensor      = null;
      let lenTensor      = null;
      let outputs      = null;
      try {
        audioTensor = new this.ort.Tensor('float32', pcm, [1, pcm.length]);
        lenTensor = new this.ort.Tensor('int64', BigInt64Array.from([BigInt(pcm.length)]), [1]);
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
      const melResult = extractLogMelFeatures(pcm);
      features = melResult.features;
      numFrames = melResult.numFrames;
    }

    if (!this.acousticSession) {
      throw new Error('Acoustic model session is not initialized. Ensure models are available at modelPath.');
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
    };
  }

  /**
   * Warm-up the session with synthetic non-silent buffers covering sliding window and chunk shapes.
   */
  async warmup()                {
    if (!this.acousticSession) return;
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
  }

  getVocab()           {
    return this.vocab;
  }

  async release()                {
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
    this.decoder = new StreamingCTCDecoder(vocab);
    this.leftContextSamples = options?.leftContextSamples ?? 16000; // 1,000 ms
    this.maxBufferSamples = options?.maxBufferSamples ?? 32000; // 2,000 ms
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
          if (lastHyp.length > comm.length) {
            (this.decoder       ).committedTokens = [...lastHyp];
          }
          this.baseCommittedTokens = this.decoder.getCommittedTokens();
          this.audioBuffer = new Float32Array(0);
          this.isWindowSliding = false;
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

    try {
      const startInference = performance.now();
      // Acoustic model inference over active buffer window
      const res = await this.engine.transcribe(this.audioBuffer);
      const inferenceMs = performance.now() - startInference;
      const durationMs = (this.totalAudioSamples / 16000) * 1000;

      // Track window offset with base committed tokens across segmented pauses
      let globalTokens          ;
      if (!this.isWindowSliding) {
        globalTokens = [...this.baseCommittedTokens, ...res.tokens];
      } else {
        const committed = this.decoder.getCommittedTokens();
        const [bestOffset, bestRawStart] = this.findWindowAlignment(committed, res.tokens);
        globalTokens = [...committed.slice(0, bestOffset), ...res.tokens.slice(bestRawStart)];
      }

      // Update streaming decoder with aligned global tokens
      const st = this.decoder.update(globalTokens, false, durationMs, inferenceMs);

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

    // Process pending audio tail if needed (< 1600 samples)
    if (this.audioBuffer.length >= 400 && (this.audioBuffer.length < 1600 || !(this.decoder       ).lastHypTokens?.length)) {
      const tailRes = await this.engine.transcribe(this.audioBuffer);
      let globalTokens          ;
      if (!this.isWindowSliding) {
        globalTokens = [...this.baseCommittedTokens, ...tailRes.tokens];
      } else {
        const committed = this.decoder.getCommittedTokens();
        const [bestOffset, bestRawStart] = this.findWindowAlignment(committed, tailRes.tokens);
        globalTokens = [...committed.slice(0, bestOffset), ...tailRes.tokens.slice(bestRawStart)];
      }
      this.decoder.update(globalTokens, false, durationMs, 0);
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
        }
      }
    }

    if (bestMatchLen >= 3) {
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
        }
      }
    }

    if (bestMatchLen >= 3) {
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

    // Auto-initiate if config provided
    this.init(config).catch((err) => {
      this.emit('error', { message: err.message, fatal: true });
    });
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
            iast: msg.iast,
            rtf: msg.rtf,
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
  )                {
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
                        

                                                                                             

                              
               
                               
                    
                    
                                        
                      
                     
                     
            
                                 
                      
                      
                                          
                        
                       
                       
    
 

                                    
                                        
                       
                                  
                    
                      
 

                                
                 
 

                               
                
 

                                     
                       
                              
                    
                    
 

                            
               
                     
                 
                
                       

// State management
let workerState              = 'UNINITIALIZED';
let ort      = null;
let currentLanguage                    = 'sa';
let activeSession      = null;
let activeVocab           = [];
let ctcDecoder                          = null;
let executionProvider                    = 'wasm';
let cacheStorageName         = CACHE_STORAGE_NAME;

// Session cache (LRU) for instant language switching without redownloading
const sessionCache = new Map                                           ();

// Audio accumulator for streaming transcription
let accumulatedAudio                 = [];
let totalAccumulatedSamples = 0;
let lastPartialTimeMs = 0;
const PARTIAL_THROTTLE_MS = 250; // Emit partials at most every 250ms

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
  try {
    const mod = await import('onnxruntime-web');
    ort = mod.default || mod;
    return ort;
  } catch (err) {
    throw new Error(`Failed to load onnxruntime-web in worker: ${(err         ).message}`);
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
  }

  const isIsolated = typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : false;
  let threads = 1;
  if (numThreads && numThreads >= 1) {
    threads = isIsolated ? Math.min(4, numThreads) : 1;
  } else if (isIsolated) {
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
  if (typeof process !== 'undefined' && process.versions?.node) {
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
  if (!vocabUrlOrPath.startsWith('http://') && !vocabUrlOrPath.startsWith('https://') && typeof window === 'undefined') {
    throw new Error(`Vocabulary not found at path: ${vocabUrlOrPath}`);
  }

  const res = await fetch(vocabUrlOrPath);
  if (!res.ok) {
    throw new Error(`Failed to fetch vocabulary from ${vocabUrlOrPath}: HTTP ${res.status}`);
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

  const modelBytes = await loadModelAsset(effectiveModelUrl, cacheStorageName, (p) => {
    postWorkerMessage({
      type: 'PROGRESS',
      stage: p.phase === 'cache' ? 'downloading' : 'downloading',
      progress: p.pct / 100,
      loadedBytes: p.loadedBytes,
      totalBytes: p.totalBytes,
      fromCache: p.fromCache,
    });
  });

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
async function processAudio(pcm              , isFinal         , chunkIndex         )                {
  if (!activeSession || !ctcDecoder) {
    throw new Error('Inference session is not ready.');
  }

  workerState = isFinal ? 'READY' : 'STREAMING';
  const startMs = performance.now();
  const durationMs = (pcm.length / 16000) * 1000;

  // Silence gate: RMS < 1e-4 (-80 dBFS) bypasses model
  let sumSq = 0;
  for (let i = 0; i < pcm.length; i++) sumSq += pcm[i] * pcm[i];
  const rms = pcm.length > 0 ? Math.sqrt(sumSq / pcm.length) : 0;

  if (rms < 1e-4) {
    const elapsed = performance.now() - startMs;
    const rtf = durationMs > 0 ? elapsed / durationMs : 0;
    if (isFinal) {
      postWorkerMessage({
        type: 'FINAL',
        text: '',
        iast: currentLanguage === 'sa' ? '' : undefined,
        language: currentLanguage,
        durationMs,
        inferenceMs: elapsed,
        rtf,
        tokens: [],
      });
      accumulatedAudio = [];
      totalAccumulatedSamples = 0;
      ctcDecoder.reset();
      workerState = 'READY';
    }
    return;
  }

  // 1. Analytical Log-Mel Spectrogram Extraction
  const mel = extractLogMelFeatures(pcm);

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
  const decoded = isFinal
    ? decodeCTC(logits, [timeSteps, numClasses], activeVocab)
    : ctcDecoder.decodeChunk(logits, [timeSteps, numClasses]);

  const elapsedMs = performance.now() - startMs;
  const rtf = durationMs > 0 ? elapsedMs / durationMs : 0;
  const iastText = currentLanguage === 'sa' ? devanagariToIast(decoded.text) : undefined;

  if (isFinal) {
    postWorkerMessage({
      type: 'FINAL',
      text: decoded.text,
      iast: iastText,
      language: currentLanguage,
      durationMs,
      inferenceMs: elapsedMs,
      rtf,
      tokens: decoded.tokens,
    });
    accumulatedAudio = [];
    totalAccumulatedSamples = 0;
    ctcDecoder.reset();
    workerState = 'READY';
  } else {
    postWorkerMessage({
      type: 'PARTIAL',
      text: decoded.text,
      iast: iastText,
      rtf,
      tokens: decoded.tokens,
      chunkIndex,
    });
  }
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

        const rawAudio = msg.audio || msg.chunk;
        if (!rawAudio) {
          postWorkerMessage({
            type: 'ERROR',
            message: 'Missing chunk payload',
            fatal: false,
          });
          return;
        }

        const chunk = rawAudio instanceof Float32Array ? rawAudio : new Float32Array(rawAudio);
        if (chunk.length > 0) {
          accumulatedAudio.push(chunk);
          totalAccumulatedSamples += chunk.length;
        }

        const isFinal = Boolean(msg.isFinal);
        const now = performance.now();
        const shouldEmitPartial = !isFinal && (now - lastPartialTimeMs >= PARTIAL_THROTTLE_MS);

        if (isFinal || shouldEmitPartial) {
          // Merge accumulated chunks into continuous buffer
          const merged = new Float32Array(totalAccumulatedSamples);
          let offset = 0;
          for (const c of accumulatedAudio) {
            merged.set(c, offset);
            offset += c.length;
          }
          lastPartialTimeMs = now;
          await processAudio(merged, isFinal, msg.chunkIndex);
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

        const merged = new Float32Array(totalAccumulatedSamples);
        let offset = 0;
        for (const c of accumulatedAudio) {
          merged.set(c, offset);
          offset += c.length;
        }
        await processAudio(merged, true);
        break;
      }

      case 'RESET': {
        accumulatedAudio = [];
        totalAccumulatedSamples = 0;
        ctcDecoder?.reset();
        workerState = 'READY';
        break;
      }

      case 'SET_LANGUAGE': {
        await setupLanguage(msg.language, msg.modelUrl, msg.vocabUrl);
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

// Global Worker Message Handler setup if running in Worker scope
if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
  self.addEventListener('message', (event                              ) => {
    handleIncomingMessage(event.data);
  });
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
    if ((this.engine       ).warmup) {
      (this.engine       ).warmup().catch(() => {});
    }
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
  dedupMarks,
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

