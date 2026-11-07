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
- `-v, --version`: Show version (`swanada 1.0.0`).

## Benchmarks

Evaluated across 480 held-out 16 kHz utterances (40 per language, `B = 1,000` bootstrap 95% CIs), 1,200 unseen `google/fleurs` + wild test clips, and 72 streaming sessions (100 ms chunks):

| Language | Code | Held-Out CER (95% CI) | Held-Out WER | Unseen Fleurs CER |
| :--- | :---: | :---: | :---: | :---: |
| Classical Sanskrit | `sa` | `5.24% [3.47%, 7.28%]` | `27.77%` | `17.10%` |
| Indian English | `en` | `5.70% [4.41%, 7.00%]` | `16.94%` | `15.61%` |
| Hindi | `hi` | `3.44% [2.34%, 4.53%]` | `12.64%` | `5.52%` |
| Kannada | `kn` | `6.03% [4.65%, 7.58%]` | `35.70%` | `5.11%` |
| Marathi | `mr` | `7.31% [4.30%, 10.50%]` | `27.52%` | `7.37%` |
| Bengali | `bn` | `7.76% [6.07%, 9.54%]` | `40.66%` | `5.71%` |
| Tamil | `ta` | `8.01% [6.28%, 9.86%]` | `38.46%` | `10.88%` |
| Telugu | `te` | `5.54% [4.01%, 7.16%]` | `30.62%` | `9.05%` |
| Malayalam | `ml` | `7.78% [5.58%, 10.13%]` | `40.27%` | `6.42%` |
| Gujarati | `gu` | `5.32% [3.42%, 7.73%]` | `23.17%` | `6.69%` |
| Punjabi | `pa` | `7.71% [4.69%, 11.34%]` | `29.47%` | `9.59%` |
| Odia | `or` | `8.94% [6.25%, 12.46%]` | `37.55%` | `8.95%` |
| **Overall (12 Langs)** | — | **`6.57% [5.94%, 7.22%]`** | **`30.06%`** | **`9.00%`** |

Shared 178 MB INT8 Conformer encoder + 515 KB per-language CTC projection heads run at `0.0325x` CPU RTF, `~8-11 ms` streaming chunk latency, and `0.00%` committed prefix churn.

## Live Playground

- h3manth.com AI Experiments Studio: [https://h3manth.com/ai/swanada/](https://h3manth.com/ai/swanada/)
- GitHub Pages Web Studio: [https://hemanth.github.io/swanada/](https://hemanth.github.io/swanada/)

## Model Weights & Hugging Face Hub

Quantized INT8 model weights are hosted on Hugging Face Hub:
- Repository: [https://huggingface.co/gnumanth/swanada](https://huggingface.co/gnumanth/swanada)

## License

MIT © [Hemanth HM](https://h3manth.com)
