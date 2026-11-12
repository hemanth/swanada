/**
 * SENH v2: Dilated Conformer-GLU Temporal Adapter + BPE CTC Head for English (TypeScript / WebWorker).
 *
 * Operates on frozen `layer_norm_84` (`[timeSteps, 512]`) hidden states from either
 * Swanada Studio or Swanada Mobile with zero changes to the shared Conformer encoder
 * and 0.00e+00 drift on all 11 Indic languages.
 */

export const SENH_VERSION = 2;

export interface AdapterBlockWeights {
  dilation: number;
  ln1Gamma: Float32Array;
  ln1Beta: Float32Array;
  wIn: Float32Array; // [2 * dInner, dModel]
  bIn: Float32Array; // [2 * dInner]
  dwWeight: Float32Array; // [dInner, kernelSize]
  dwBias: Float32Array; // [dInner]
  ln2Gamma: Float32Array;
  ln2Beta: Float32Array;
  wOut: Float32Array; // [dModel, dInner]
  bOut: Float32Array; // [dModel]
}

export interface EnglishAdapterWeights {
  dModel: number;
  dInner: number;
  kernelSize: number;
  numClasses: number;
  blocks: AdapterBlockWeights[];
  lnOutGamma: Float32Array;
  lnOutBeta: Float32Array;
  wCtc: Float32Array; // [numClasses, dModel]
  bCtc: Float32Array; // [numClasses]
}

export function isEnAdapterBytes(raw: ArrayBuffer | Uint8Array): boolean {
  const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  return (
    bytes.byteLength >= 28 &&
    bytes[0] === 0x53 && // 'S'
    bytes[1] === 0x45 && // 'E'
    bytes[2] === 0x4e && // 'N'
    bytes[3] === 0x48 // 'H'
  );
}

export function parseEnAdapterBytes(raw: ArrayBuffer | Uint8Array): EnglishAdapterWeights {
  const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  if (!isEnAdapterBytes(bytes)) {
    throw new Error("Invalid en_adapter.bin header: expected magic 'SENH'");
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = dv.getUint32(4, true);
  if (version !== SENH_VERSION) {
    throw new Error(`Unsupported en_adapter.bin version=${version}`);
  }
  const dModel = dv.getUint32(8, true);
  const nBlocks = dv.getUint32(12, true);
  const dInner = dv.getUint32(16, true);
  const kernelSize = dv.getUint32(20, true);
  const numClasses = dv.getUint32(24, true);

  let pos = 28;
  const dilBytes = 4 * nBlocks;
  if (bytes.byteLength < pos + dilBytes) {
    throw new Error('Truncated en_adapter.bin dilations header');
  }
  const dilations: number[] = [];
  for (let i = 0; i < nBlocks; i++) {
    dilations.push(dv.getUint32(pos + i * 4, true));
  }
  pos += dilBytes;

  const readF32 = (count: number): Float32Array => {
    const nbytes = count * 4;
    if (pos + nbytes > bytes.byteLength) {
      throw new Error(`Truncated en_adapter.bin reading float32[${count}] at ${pos}`);
    }
    const out = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      out[i] = dv.getFloat32(pos + i * 4, true);
    }
    pos += nbytes;
    return out;
  };

  const readQMat = (rows: number, cols: number): Float32Array => {
    const scales = readF32(rows);
    const nbytes = rows * cols;
    if (pos + nbytes > bytes.byteLength) {
      throw new Error(`Truncated en_adapter.bin reading int8[${rows},${cols}] at ${pos}`);
    }
    const i8 = new Int8Array(bytes.buffer, bytes.byteOffset + pos, nbytes);
    const out = new Float32Array(nbytes);
    for (let r = 0; r < rows; r++) {
      const sc = scales[r];
      const rOff = r * cols;
      for (let c = 0; c < cols; c++) {
        out[rOff + c] = i8[rOff + c] * sc;
      }
    }
    pos += nbytes;
    return out;
  };

  const blocks: AdapterBlockWeights[] = [];
  for (let i = 0; i < nBlocks; i++) {
    const ln1Gamma = readF32(dModel);
    const ln1Beta = readF32(dModel);
    const wIn = readQMat(2 * dInner, dModel);
    const bIn = readF32(2 * dInner);
    const dwWeight = readF32(dInner * kernelSize);
    const dwBias = readF32(dInner);
    const ln2Gamma = readF32(dInner);
    const ln2Beta = readF32(dInner);
    const wOut = readQMat(dModel, dInner);
    const bOut = readF32(dModel);
    blocks.push({
      dilation: dilations[i],
      ln1Gamma,
      ln1Beta,
      wIn,
      bIn,
      dwWeight,
      dwBias,
      ln2Gamma,
      ln2Beta,
      wOut,
      bOut,
    });
  }

  const lnOutGamma = readF32(dModel);
  const lnOutBeta = readF32(dModel);
  const wCtc = readQMat(numClasses, dModel);
  const bCtc = readF32(numClasses);

  return {
    dModel,
    dInner,
    kernelSize,
    numClasses,
    blocks,
    lnOutGamma,
    lnOutBeta,
    wCtc,
    bCtc,
  };
}

function siluScalar(v: number): number {
  const c = v < -40.0 ? -40.0 : v > 40.0 ? 40.0 : v;
  return v / (1.0 + Math.exp(-c));
}

function layerNorm2dInPlace(
  src: Float32Array,
  dst: Float32Array,
  timeSteps: number,
  dim: number,
  gamma: Float32Array,
  beta: Float32Array
): void {
  const invDim = 1.0 / dim;
  for (let t = 0; t < timeSteps; t++) {
    const off = t * dim;
    let sum = 0.0;
    for (let j = 0; j < dim; j++) {
      sum += src[off + j];
    }
    const mean = sum * invDim;
    let sq = 0.0;
    for (let j = 0; j < dim; j++) {
      const d = src[off + j] - mean;
      sq += d * d;
    }
    const invStd = 1.0 / Math.sqrt(sq * invDim + 1.0e-5);
    for (let j = 0; j < dim; j++) {
      dst[off + j] = (src[off + j] - mean) * invStd * gamma[j] + beta[j];
    }
  }
}

function linearProject(
  x: Float32Array,
  out: Float32Array,
  timeSteps: number,
  inDim: number,
  outDim: number,
  w: Float32Array,
  b: Float32Array,
  addResidual: Float32Array | null
): void {
  const inDim8 = inDim & ~7;
  for (let t = 0; t < timeSteps; t++) {
    const xOff = t * inDim;
    const yOff = t * outDim;
    for (let r = 0; r < outDim; r++) {
      const wOff = r * inDim;
      let s0 = 0.0;
      let s1 = 0.0;
      let k = 0;
      for (; k < inDim8; k += 8) {
        s0 +=
          x[xOff + k] * w[wOff + k] +
          x[xOff + k + 1] * w[wOff + k + 1] +
          x[xOff + k + 2] * w[wOff + k + 2] +
          x[xOff + k + 3] * w[wOff + k + 3];
        s1 +=
          x[xOff + k + 4] * w[wOff + k + 4] +
          x[xOff + k + 5] * w[wOff + k + 5] +
          x[xOff + k + 6] * w[wOff + k + 6] +
          x[xOff + k + 7] * w[wOff + k + 7];
      }
      let sum = b[r] + s0 + s1;
      for (; k < inDim; k++) {
        sum += x[xOff + k] * w[wOff + k];
      }
      out[yOff + r] = addResidual !== null ? addResidual[yOff + r] + sum : sum;
    }
  }
}

export function forwardEnAdapter(
  weights: EnglishAdapterWeights,
  hidden: Float32Array,
  timeSteps: number
): Float32Array {
  const { dModel, dInner, kernelSize, numClasses, blocks } = weights;
  if (timeSteps <= 0) {
    return new Float32Array(0);
  }

  const x = new Float32Array(timeSteps * dModel);
  x.set(hidden.subarray(0, timeSteps * dModel));

  const hNorm = new Float32Array(timeSteps * dModel);
  const proj = new Float32Array(timeSteps * 2 * dInner);
  const gated = new Float32Array(timeSteps * dInner);
  const convOut = new Float32Array(timeSteps * dInner);
  const half = kernelSize >> 1;

  for (let bi = 0; bi < blocks.length; bi++) {
    const blk = blocks[bi];
    layerNorm2dInPlace(x, hNorm, timeSteps, dModel, blk.ln1Gamma, blk.ln1Beta);
    linearProject(hNorm, proj, timeSteps, dModel, 2 * dInner, blk.wIn, blk.bIn, null);

    for (let t = 0; t < timeSteps; t++) {
      const pOff = t * 2 * dInner;
      const gOff = t * dInner;
      for (let c = 0; c < dInner; c++) {
        gated[gOff + c] = proj[pOff + c] * siluScalar(proj[pOff + dInner + c]);
      }
    }

    const dil = blk.dilation;
    const dwW = blk.dwWeight;
    const dwB = blk.dwBias;
    for (let t = 0; t < timeSteps; t++) {
      const cOff = t * dInner;
      for (let c = 0; c < dInner; c++) {
        convOut[cOff + c] = dwB[c];
      }
      for (let k = 0; k < kernelSize; k++) {
        const srcT = t + (k - half) * dil;
        if (srcT >= 0 && srcT < timeSteps) {
          const sOff = srcT * dInner;
          for (let c = 0; c < dInner; c++) {
            convOut[cOff + c] += gated[sOff + c] * dwW[c * kernelSize + k];
          }
        }
      }
    }

    layerNorm2dInPlace(convOut, gated, timeSteps, dInner, blk.ln2Gamma, blk.ln2Beta);
    for (let i = 0; i < timeSteps * dInner; i++) {
      gated[i] = siluScalar(gated[i]);
    }
    linearProject(gated, x, timeSteps, dInner, dModel, blk.wOut, blk.bOut, x);
  }

  layerNorm2dInPlace(x, hNorm, timeSteps, dModel, weights.lnOutGamma, weights.lnOutBeta);
  const logits = new Float32Array(timeSteps * numClasses);
  linearProject(hNorm, logits, timeSteps, dModel, numClasses, weights.wCtc, weights.bCtc, null);
  return logits;
}
