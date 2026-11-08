# swanada (स्वनद)

In-browser, Node.js, and Python 16,000 Hz multilingual speech-to-text (STT) for Classical Sanskrit (`sa`), Indian English (`en`), and ten Indic languages (`hi`, `kn`, `mr`, `bn`, `ta`, `te`, `ml`, `gu`, `pa`, `or`) powered by 17-layer Conformer-CTC INT8 models running 100% client-side via ONNX/WASM with zero cloud or server dependencies.

```bash
npm install swanada
```

```bash
pip install swanada
```

## Quick Start (JavaScript / TypeScript)

```typescript
import { Swanada } from 'swanada';

// Initialize transcriber for Classical Sanskrit
const transcriber = await Swanada.create({
  language: 'sa',
  executionProvider: 'wasm',
  numThreads: 4,
});

// Transcribe audio Float32Array PCM or WAV ArrayBuffer
const result = await transcriber.transcribe(audioPcmFloat32);
console.log(`Transcript (${result.language}):`, result.text);
console.log(`Duration: ${result.durationMs}ms | Latency: ${result.inferenceMs}ms | RTF: ${result.rtf}`);

// Classical Sanskrit to Roman IAST transliteration
const iast = Swanada.transliterateIast(result.text);
console.log('IAST Transliteration:', iast);

await transcriber.release();
```

## Quick Start (Python)

```python
from swanada import Swanada

stt = Swanada.create(language="kn")  # Kannada
result = stt.transcribe("speech_16k.wav")

print("Transcript:", result.text)
print(f"Duration: {result.duration_ms:.1f}ms | Latency: {result.inference_ms:.1f}ms | RTF: {result.rtf:.3f}")
```

## CLI Usage

Dual-runtime command-line interface with identical flags:

```bash
# Node.js CLI
npx swanada speech.wav -l sa
npx swanada recitation.wav -l sa --json -o output.json
cat stream.wav | npx swanada -l hi --stream

# Python CLI
swanada speech.wav -l kn
cat stream.wav | swanada -l ta --stream
```

### Unified CLI Flags
- `-l, --language <lang>`: Language code (default: `sa`). Supported: `sa, en, hi, kn, mr, bn, ta, te, ml, gu, pa, or`.
- `-m, --model-dir <dir>`: Optional custom models directory.
- `-o, --output <file>`: Output text file (default: stdout).
- `--json`: Emit structured JSON with text, durationMs, inferenceMs, rtf, and tokens.
- `--stream`: Simulate chunk-by-chunk streaming transcription (320 ms quanta).
- `--iast`: Transliterate Classical Sanskrit output to Roman IAST with Vedic accents.
- `-h, --help`: Show help and usage summary.
- `-v, --version`: Show version (`swanada 1.0.2`).

## Benchmarks

Evaluated across 480 held-out 16 kHz utterances (40 per language, `B = 1,000` bootstrap 95% CIs), 1,200 unseen `google/fleurs` + wild test clips, 150 real-world multi-accent / conversational slang utterances (`MushanW/GLOBE`, `AMI`, regional accents, Indic loanwords), and 72 streaming sessions (100 ms chunks):

- **Overall 12-Language Held-Out CER**: `5.43% [4.85%, 6.01%]` (WER `25.88%`, `0.00%` committed streaming churn)
- **Conversational Slang & Multi-Accent Suite (`n = 150`)**: `17.44% [15.35%, 19.64%]` CER / `41.88% [37.49%, 46.67%]` WER (`-2.60 pp` CER / `-8.02 pp` WER vs `v1.0.1`)

## Live Playground

- h3manth.com AI Experiments Studio: [https://h3manth.com/ai/swanada/](https://h3manth.com/ai/swanada/)
- GitHub Pages Web Studio: [https://hemanth.github.io/swanada/](https://hemanth.github.io/swanada/)

## Model Weights & Hugging Face Hub

Quantized INT8 model weights are hosted on Hugging Face Hub:
- Repository: [https://huggingface.co/gnumanth/swanada](https://huggingface.co/gnumanth/swanada)

## License

MIT © [Hemanth HM](https://h3manth.com)
