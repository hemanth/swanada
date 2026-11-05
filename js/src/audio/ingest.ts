/**
 * Zero-dependency RIFF/WAVE parser and encoder for Node.js and Browser runtimes.
 */

import type { DecodedAudio } from './types.ts';

/**
 * Parses binary WAV data into mono Float32Array PCM and audio metadata.
 * Supports 16-bit signed PCM and 32-bit IEEE float, mono and multi-channel.
 */
export function parseWav(buffer: ArrayBuffer | Uint8Array): DecodedAudio {
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

  let pcm: Float32Array;

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
export function encodeWav(pcm: Float32Array, sampleRate: number = 16000): Uint8Array {
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
