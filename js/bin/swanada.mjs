#!/usr/bin/env node
/**
 * Swanada: In-browser & multi-runtime 16 kHz Multilingual Indic STT CLI.
 * Zero external dependencies. Pure Node.js runtime.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import compiled Swanada library bundle
const distModulePath = path.resolve(__dirname, '../dist/index.mjs');
const { Swanada, parseWav, resamplePcm } = await import(distModulePath);

const SUPPORTED_LANGUAGES = ['sa', 'en', 'hi', 'kn', 'mr', 'bn', 'ta', 'te', 'ml', 'gu', 'pa', 'or'];

function printHelp() {
  console.log(`swanada -l <lang> [-m <model_dir>] [-o <output.txt>] [--json] [--stream] [--iast] <input.wav>

Swanada (स्वनद) — 16 kHz Multilingual Indic Speech-to-Text CLI

Positional Arguments:
  <input.wav>              Input WAV audio file or '-' for stdin pipe

Options:
  -l, --language, --lang   Language code: sa | en | hi | kn | mr | bn | ta | te | ml | gu | pa | or (default: sa)
  -m, --model-dir, --model Custom model directory containing ONNX weights and vocabularies
  -o, --output, --out      Output text file path (default: stdout)
  --json                   Emit structured JSON with text, durationMs, inferenceMs, rtf, and tokens
  --stream                 Simulate chunk-by-chunk streaming transcription (320ms / 5120 samples)
  --iast                   Transliterate Classical Sanskrit output to Roman IAST with Vedic accents
  --threads <n>            Number of inference execution threads (default: 4)
  -h, --help               Display this help text and exit
  -v, --version            Display version information and exit

Examples:
  swanada audio.wav -l sa
  swanada speech.wav -l hi --json -o out.json
  cat stream.wav | swanada -l kn --stream`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('-h') || args.includes('--help')) {
    printHelp();
    process.exit(0);
  }

  if (args.includes('-v') || args.includes('--version')) {
    console.log('swanada 1.0.2');
    process.exit(0);
  }

  let language = 'sa';
  let modelDir = null;
  let outputPath = null;
  let jsonOutput = false;
  let streamMode = false;
  let iastMode = false;
  let threads = 4;
  let inputPath = null;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-l' || a === '--language' || a === '--lang') {
      language = args[++i];
    } else if (a === '-m' || a === '--model-dir' || a === '--model') {
      modelDir = args[++i];
    } else if (a === '-o' || a === '--output' || a === '--out') {
      outputPath = args[++i];
    } else if (a === '--threads' && args[i + 1]) {
      threads = parseInt(args[++i], 10) || 4;
    } else if (a === '--json') {
      jsonOutput = true;
    } else if (a === '--stream') {
      streamMode = true;
    } else if (a === '--iast') {
      iastMode = true;
    } else if (a === '-' || !a.startsWith('-')) {
      inputPath = a;
    } else {
      console.error(`Unknown option: ${a}`);
      printHelp();
      process.exit(1);
    }
  }

  language = (language || '').toLowerCase().trim();
  if (!SUPPORTED_LANGUAGES.includes(language)) {
    console.error(`Error: Unsupported language '${language}'. Supported languages: ${SUPPORTED_LANGUAGES.join(', ')}`);
    process.exit(1);
  }

  // Audio reading
  let rawBuffer;
  if (inputPath === '-' || (!inputPath && !process.stdin.isTTY)) {
    try {
      const chunks = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk);
      }
      if (chunks.length === 0) {
        console.error('Error: Empty standard input received.');
        process.exit(1);
      }
      rawBuffer = Buffer.concat(chunks);
      if (!rawBuffer || rawBuffer.length === 0) {
        console.error('Error: Empty standard input received.');
        process.exit(1);
      }
    } catch (err) {
      console.error(`Error reading from stdin: ${err.message}`);
      process.exit(1);
    }
  } else if (inputPath) {
    if (!fs.existsSync(inputPath)) {
      console.error(`Error: Input file not found: ${inputPath}`);
      process.exit(1);
    }
    rawBuffer = fs.readFileSync(inputPath);
  } else {
    console.error('Error: Missing input audio. Provide <input.wav> or pipe via stdin.');
    printHelp();
    process.exit(1);
  }

  // Parse WAV and ensure 16 kHz mono Float32 PCM
  let pcm;
  try {
    const ab = rawBuffer.buffer.slice(rawBuffer.byteOffset, rawBuffer.byteOffset + rawBuffer.byteLength);
    const decoded = parseWav(ab);
    if (decoded.sampleRate !== 16000) {
      pcm = resamplePcm(decoded.pcm, decoded.sampleRate, 16000);
    } else {
      pcm = decoded.pcm;
    }
  } catch (err) {
    console.error(`Error parsing WAV audio: ${err.message}`);
    process.exit(2);
  }

  // Initialize Swanada
  let transcriber;
  try {
    const config = { language, numThreads: threads };
    if (modelDir) {
      const resolvedDir = path.resolve(modelDir);
      if (fs.existsSync(resolvedDir) && fs.statSync(resolvedDir).isDirectory()) {
        const modelNames = [`swanada_${language}_ctc_int8.onnx`];
        if (language === 'sa') modelNames.push('sushrota_sanskrit_ctc_int8.onnx');
        let foundModel = null;
        for (const mn of modelNames) {
          const c1 = path.join(resolvedDir, 'onnx', mn);
          const c2 = path.join(resolvedDir, mn);
          if (fs.existsSync(c1)) { foundModel = c1; break; }
          if (fs.existsSync(c2)) { foundModel = c2; break; }
        }
        if (foundModel) {
          config.modelPath = foundModel;
        }
        const vocabNames = [`${language}_vocab.json`];
        if (language === 'sa') vocabNames.push('sanskrit_vocab.json');
        let foundVocab = null;
        for (const vn of vocabNames) {
          const v1 = path.join(resolvedDir, 'vocabularies', vn);
          const v2 = path.join(resolvedDir, vn);
          if (fs.existsSync(v1)) { foundVocab = v1; break; }
          if (fs.existsSync(v2)) { foundVocab = v2; break; }
        }
        if (foundVocab) {
          config.vocabPath = foundVocab;
        }
      } else {
        config.modelPath = resolvedDir;
      }
    }
    transcriber = await Swanada.create(config);
  } catch (err) {
    console.error(`Error initializing Swanada engine: ${err.message}`);
    process.exit(2);
  }

  // Transcribe
  let result;
  let mode = 'batch';
  try {
    if (streamMode) {
      const stream = transcriber.createStream();
      const chunkSize = 5120; // 320ms @ 16kHz
      for (let offset = 0; offset < pcm.length; offset += chunkSize) {
        const slice = pcm.subarray(offset, Math.min(offset + chunkSize, pcm.length));
        await stream.push(slice);
      }
      result = await stream.finish();
      mode = 'streaming';
    } else {
      result = await transcriber.transcribe(pcm);
      mode = 'batch';
    }
  } catch (err) {
    console.error(`Error during transcription: ${err.message}`);
    process.exit(2);
  } finally {
    if (transcriber && typeof transcriber.release === 'function') {
      await transcriber.release();
    }
  }

  let finalTranscript = result.text;
  if (iastMode && language === 'sa' && finalTranscript) {
    finalTranscript = Swanada.transliterateIast(finalTranscript);
  }

  // Output formatting
  const formattedJson = {
    text: finalTranscript,
    language: result.language,
    durationMs: result.durationMs,
    duration_ms: result.durationMs,
    inferenceMs: result.inferenceMs,
    inference_ms: result.inferenceMs,
    rtf: Number(result.rtf.toFixed(4)),
    tokens: result.tokens || [],
    mode,
  };

  const outputContent = jsonOutput ? JSON.stringify(formattedJson, null, 2) + '\n' : finalTranscript + '\n';

  if (outputPath) {
    try {
      const outDir = path.dirname(path.resolve(outputPath));
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(outputPath, outputContent, 'utf8');
    } catch (err) {
      console.error(`Error writing to output file ${outputPath}: ${err.message}`);
      process.exit(1);
    }
  } else {
    process.stdout.write(outputContent);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(`Fatal CLI error: ${err.stack || err.message}`);
  process.exit(2);
});
