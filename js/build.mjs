import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import moduleApi from 'node:module';
const stripTypeScriptTypes = moduleApi.stripTypeScriptTypes;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(__dirname, 'src');
const distDir = path.join(__dirname, 'dist');
fs.mkdirSync(distDir, { recursive: true });

function stripTypes(code) {
  if (typeof stripTypeScriptTypes === 'function') {
    return stripTypeScriptTypes(code);
  }
  // Fallback: remove interface declarations and type annotations
  return code
    .replace(/export\s+interface\s+[\s\S]*?^}/gm, '')
    .replace(/interface\s+[\s\S]*?^}/gm, '')
    .replace(/export\s+type\s+[^;]+;/gm, '')
    .replace(/type\s+[^;]+;/gm, '')
    .replace(/:\s*[A-Za-z0-9_<>[\]|,\s]+(?=[=,)])/g, '');
}

// 1. Read and strip modules
const ingestSrc = stripTypes(fs.readFileSync(path.join(srcDir, 'audio', 'ingest.ts'), 'utf8'))
  .replace(/import type .*?;/g, '')
  .replace(/^export /gm, '');

const resampleSrc = stripTypes(fs.readFileSync(path.join(srcDir, 'audio', 'resample.ts'), 'utf8'))
  .replace(/import .*? from '\.\/ingest\.ts';/g, '')
  .replace(/import type .*?;/g, '')
  .replace(/^export /gm, '');

const frontendSrc = stripTypes(fs.readFileSync(path.join(srcDir, 'audio', 'frontend.ts'), 'utf8'))
  .replace(/import type .*?;/g, '')
  .replace(/^export /gm, '');

const denoiseSrc = stripTypes(fs.readFileSync(path.join(srcDir, 'audio', 'denoise.ts'), 'utf8'))
  .replace(/import .*? from '\.\/frontend\.ts';/g, '')
  .replace(/import type .*?;/g, '')
  .replace(/^export /gm, '');

const captureSrc = stripTypes(fs.readFileSync(path.join(srcDir, 'audio', 'audio-capture.ts'), 'utf8'))
  .replace(/import type .*?;/g, '')
  .replace(/^export /gm, '');

const indicLexiconSrc = stripTypes(fs.readFileSync(path.join(srcDir, 'decoder', 'indic_lexicon.ts'), 'utf8'))
  .replace(/import type .*?;/g, '')
  .replace(/^export /gm, '');

const normalizerSrc = stripTypes(fs.readFileSync(path.join(srcDir, 'decoder', 'normalizer.ts'), 'utf8'))
  .replace(/import .*? from '\.\/indic_lexicon\.ts';/g, '')
  .replace(/import type .*?;/g, '')
  .replace(/^export /gm, '');

const enLexiconSrc = stripTypes(fs.readFileSync(path.join(srcDir, 'decoder', 'en_lexicon.ts'), 'utf8'))
  .replace(/import type .*?;/g, '')
  .replace(/^export /gm, '');

const ctcSrc = stripTypes(fs.readFileSync(path.join(srcDir, 'decoder', 'ctc.ts'), 'utf8'))
  .replace(/import .*? from '\.\/en_lexicon\.ts';/g, '')
  .replace(/import .*? from '\.\/indic_lexicon\.ts';/g, '')
  .replace(/import .*? from '\.\/normalizer\.ts';/g, '')
  .replace(/import type .*?;/g, '')
  .replace(/^export /gm, '');

const streamingDecoderSrc = stripTypes(fs.readFileSync(path.join(srcDir, 'decoder', 'streaming.ts'), 'utf8'))
  .replace(/import .*? from '\.\/normalizer\.ts';/g, '')
  .replace(/import type .*?;/g, '')
  .replace(/^export /gm, '');

const cacheSrc = stripTypes(fs.readFileSync(path.join(srcDir, 'models', 'cache.ts'), 'utf8'))
  .replace(/import type .*?;/g, '')
  .replace(/^export /gm, '');

const engineSrc = stripTypes(fs.readFileSync(path.join(srcDir, 'models', 'engine.ts'), 'utf8'))
  .replace(/import .*? from '\.\.\/audio\/frontend\.ts';/g, '')
  .replace(/import .*? from '\.\.\/audio\/denoise\.ts';/g, '')
  .replace(/import .*? from '\.\.\/decoder\/ctc\.ts';/g, '')
  .replace(/import .*? from '\.\/cache\.ts';/g, '')
  .replace(/import type .*?;/g, '')
  .replace(/^export /gm, '');

const streamingEngineSrc = stripTypes(fs.readFileSync(path.join(srcDir, 'models', 'streaming.ts'), 'utf8'))
  .replace(/import .*? from '\.\/engine\.ts';/g, '')
  .replace(/import .*? from '\.\.\/decoder\/streaming\.ts';/g, '')
  .replace(/import .*? from '\.\.\/decoder\/normalizer\.ts';/g, '')
  .replace(/import type .*?;/g, '')
  .replace(/^export /gm, '');

const registrySrc = stripTypes(fs.readFileSync(path.join(srcDir, 'tokenizers', 'registry.ts'), 'utf8'))
  .replace(/import type .*?;/g, '')
  .replace(/^export /gm, '');

const iastSrc = stripTypes(fs.readFileSync(path.join(srcDir, 'tokenizers', 'iast.ts'), 'utf8'))
  .replace(/import type .*?;/g, '')
  .replace(/^export /gm, '');

const workerClientSrc = stripTypes(fs.readFileSync(path.join(srcDir, 'worker', 'client.ts'), 'utf8'))
  .replace(/import type .*?;/g, '')
  .replace(/^export /gm, '');

const workerHandlerSrc = stripTypes(fs.readFileSync(path.join(srcDir, 'worker', 'stt-worker.ts'), 'utf8'))
  .replace(/import .*? from '\.\.\/audio\/frontend\.ts';/g, '')
  .replace(/import .*? from '\.\.\/audio\/denoise\.ts';/g, '')
  .replace(/import .*? from '\.\.\/decoder\/ctc\.ts';/g, '')
  .replace(/import .*? from '\.\.\/tokenizers\/iast\.ts';/g, '')
  .replace(/import .*? from '\.\.\/models\/cache\.ts';/g, '')
  .replace(/import .*? from '\.\.\/models\/streaming\.ts';/g, '')
  .replace(/import type .*?;/g, '')
  .replace(/^export /gm, '');

const indexSrc = stripTypes(fs.readFileSync(path.join(srcDir, 'index.ts'), 'utf8'))
  .replace(/import .*? from '\.\/audio\/ingest\.ts';/g, '')
  .replace(/import .*? from '\.\/audio\/resample\.ts';/g, '')
  .replace(/import .*? from '\.\/audio\/frontend\.ts';/g, '')
  .replace(/import .*? from '\.\/models\/engine\.ts';/g, '')
  .replace(/import .*? from '\.\/models\/streaming\.ts';/g, '')
  .replace(/import .*? from '\.\/decoder\/ctc\.ts';/g, '')
  .replace(/import .*? from '\.\/decoder\/streaming\.ts';/g, '')
  .replace(/import .*? from '\.\/decoder\/normalizer\.ts';/gs, '')
  .replace(/import .*? from '\.\/tokenizers\/iast\.ts';/g, '')
  .replace(/import .*? from '\.\/tokenizers\/registry\.ts';/g, '')
  .replace(/import .*? from '\.\/tokenizers\/index\.ts';/g, '')
  .replace(/import .*? from '\.\/audio\/audio-capture\.ts';/g, '')
  .replace(/import .*? from '\.\/worker\/client\.ts';/g, '')
  .replace(/import type .*?;/g, '')
  .replace(/export \* from .*?;/g, '')
  .replace(/^export /gm, '');

const allExports = `
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
  Swanada,
};
export default Swanada;
`;

const esmBundle = `// Auto-generated ESM bundle for swanada v1.0.0
${ingestSrc}
${resampleSrc}
${frontendSrc}
${denoiseSrc}
${captureSrc}
${indicLexiconSrc}
${normalizerSrc}
${enLexiconSrc}
${ctcSrc}
${streamingDecoderSrc}
${cacheSrc}
${engineSrc}
${streamingEngineSrc}
${registrySrc}
${iastSrc}
${workerClientSrc}
${workerHandlerSrc}
${indexSrc}
${allExports}
`;

fs.writeFileSync(path.join(distDir, 'index.mjs'), esmBundle, 'utf8');

// Copy TypeScript declaration file to dist
fs.copyFileSync(path.join(srcDir, 'index.d.ts'), path.join(distDir, 'index.d.ts'));

// Synchronize ESM bundle with interactive playground docs/
const docsDir = path.resolve(__dirname, '..', 'docs');
fs.mkdirSync(docsDir, { recursive: true });
fs.copyFileSync(path.join(distDir, 'index.mjs'), path.join(docsDir, 'swanada.mjs'));

// Transform ESM import.meta constructs into CommonJS-safe expressions
function makeCjsSafe(code) {
  return code
    .replace(
      /typeof import\.meta !== 'undefined' && import\.meta\.url/g,
      "typeof __filename !== 'undefined'"
    )
    .replace(
      /import\.meta\.url/g,
      "require('url').pathToFileURL(__filename).href"
    )
    .replace(/import\.meta/g, "({ url: require('url').pathToFileURL(__filename).href })");
}

const cjsEngineSrc = makeCjsSafe(engineSrc);
const cjsWorkerHandlerSrc = makeCjsSafe(workerHandlerSrc);

const cjsBody = `// Auto-generated CommonJS bundle for swanada v1.0.0
${ingestSrc}
${resampleSrc}
${frontendSrc}
${denoiseSrc}
${captureSrc}
${indicLexiconSrc}
${normalizerSrc}
${enLexiconSrc}
${ctcSrc}
${streamingDecoderSrc}
${cacheSrc}
${cjsEngineSrc}
${streamingEngineSrc}
${registrySrc}
${iastSrc}
${workerClientSrc}
${cjsWorkerHandlerSrc}
${indexSrc}

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
`;

fs.writeFileSync(path.join(distDir, 'index.cjs'), makeCjsSafe(cjsBody), 'utf8');

console.log('Successfully built js/dist/index.mjs, js/dist/index.cjs, js/dist/index.d.ts, and docs/swanada.mjs');

