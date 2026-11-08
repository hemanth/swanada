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

| Language | Code | Held-Out CER (95% CI) | Held-Out WER | Unseen Fleurs CER |
| :--- | :---: | :---: | :---: | :---: |
| Classical Sanskrit | `sa` | `4.27% [2.69%, 6.10%]` | `22.99%` | `17.10%` |
| Indian English | `en` | `5.45% [4.19%, 6.80%]` | `15.82%` | `15.61%` |
| Hindi | `hi` | `2.14% [1.41%, 2.97%]` | `8.04%` | `5.52%` |
| Kannada | `kn` | `5.18% [3.86%, 6.86%]` | `31.39%` | `5.11%` |
| Marathi | `mr` | `5.72% [3.19%, 8.34%]` | `22.52%` | `7.37%` |
| Bengali | `bn` | `5.92% [4.34%, 7.54%]` | `30.98%` | `5.71%` |
| Tamil | `ta` | `7.50% [5.92%, 9.09%]` | `38.12%` | `10.88%` |
| Telugu | `te` | `4.79% [3.48%, 6.33%]` | `28.51%` | `9.05%` |
| Malayalam | `ml` | `6.16% [4.10%, 8.27%]` | `34.03%` | `6.42%` |
| Gujarati | `gu` | `4.79% [2.97%, 6.98%]` | `19.28%` | `6.69%` |
| Punjabi | `pa` | `6.35% [3.52%, 9.78%]` | `23.38%` | `9.59%` |
| Odia | `or` | `6.93% [4.91%, 9.41%]` | `35.50%` | `8.95%` |
| **Overall (12 Langs)** | — | **`5.43% [4.85%, 6.01%]`** | **`25.88%`** | **`9.00%`** |

### Conversational Slang, Regional Accents & Reverberant Mic Suite (`n = 150`, `B = 1,000` Bootstrap)

| Evaluation Slice | Clips | `v1.0.1` CER / WER | `v1.0.2` CER (95% CI) | `v1.0.2` WER (95% CI) |
| :--- | :---: | :---: | :---: | :---: |
| Real Human Global & South Asian Accents (`GLOBE` + `AMI`) | 60 | `20.30%` / `44.83%` | `19.04% [15.78%, 22.45%]` | `40.57% [34.71%, 46.80%]` |
| Casual Contractions, Slang & Hinglish (6 Regional Accents) | 36 | `28.07%` / `74.80%` | `22.36% [18.71%, 26.23%]` | `60.89% [50.85%, 71.76%]` |
| Indic Colloquial Contractions & English Loanwords | 25 | `7.38%` / `25.51%` | `6.17% [3.60%, 9.43%]` | `18.68% [12.52%, 26.07%]` |
| Tempo / Vocal-Tract & Reverberant Mobile-Mic Perturbations | 29 | `20.42%` / `50.54%` | `17.76% [13.85%, 22.07%]` | `41.00% [32.55%, 49.11%]` |
| **Overall (`n = 150`)** | **150** | **`20.04%` / `49.90%`** | **`17.44% [15.35%, 19.64%]`** | **`41.88% [37.49%, 46.67%]`** |

Shared 178 MB INT8 Conformer encoder + 515 KB per-language CTC projection heads run at `0.0325x` CPU RTF, `~8-11 ms` streaming chunk latency, and `0.00%` committed prefix churn.

## Live Playground

- h3manth.com AI Experiments Studio: [https://h3manth.com/ai/swanada/](https://h3manth.com/ai/swanada/)
- GitHub Pages Web Studio: [https://hemanth.github.io/swanada/](https://hemanth.github.io/swanada/)

## Model Weights & Hugging Face Hub

Quantized INT8 model weights are hosted on Hugging Face Hub:
- Repository: [https://huggingface.co/gnumanth/swanada](https://huggingface.co/gnumanth/swanada)

## License

MIT © [Hemanth HM](https://h3manth.com)
