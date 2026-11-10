# swanada (स्वनद)

In-browser, Node.js, and Python 16,000 Hz multilingual speech-to-text (STT) for Classical Sanskrit (`sa`), Indian English (`en`), and ten Indic languages (`hi`, `kn`, `mr`, `bn`, `ta`, `te`, `ml`, `gu`, `pa`, `or`) powered by **capability-routed dual-tier Conformer-CTC INT8 models** (`25.35 MiB` Mobile Conformer-Small for phones/tablets + `177.4 MiB` Studio Conformer-Large for desktop/servers) running 100% client-side via ONNX/WASM with zero cloud or server dependencies.

```bash
npm install swanada
```

```bash
pip install swanada
```

## Quick Start (JavaScript / TypeScript)

```typescript
import { Swanada } from 'swanada';

// Initialize transcriber (`modelTier: 'auto'` picks `25.4 MiB` mobile on phones & `177.4 MiB` studio on desktop)
const transcriber = await Swanada.create({
  language: 'sa',
  modelTier: 'auto', // 'auto' | 'mobile' | 'studio'
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

stt = Swanada.create(language="kn", tier="studio")  # or tier="mobile" (25.35 MiB)
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
- `--tier <studio|mobile|auto>`: Select `177.4 MiB` `studio` tier or `< 30 MB` (`25.35 MiB`) `mobile` tier (default: `studio`).
- `-h, --help`: Show help and usage summary.
- `-v, --version`: Show version (`swanada 1.1.0`).

## Capability-Routed Dual-Tier Footprint (`v1.1.0`)

| Model Tier | Architecture | Shared INT8 Encoder | Per-Lang Head | First-Load Size | 4T CPU RTF | Offline Cache |
| :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **Mobile (`< 30 MB`)** | 14-layer Conformer-Small (`d=256`, `23.56M`) | `25.35 MiB` (`26.58 MB`) | `515 KB` | **`25.85 MiB`** | **`0.0097x`** (`103×` RT) | iOS Safari & Android Chrome `CacheStorage` |
| **Studio (Desktop)** | 17-layer Conformer-Large (`d=512`, `115.2M`) | `177.4 MiB` (`186.0 MB`) | `515 KB` | **`177.9 MiB`** | **`0.0264x`** (`38×` RT) | Desktop Chrome / Edge / Firefox / Node / Python |

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

Shared INT8 Conformer encoders (`25.35 MiB` Mobile / `177.4 MiB` Studio) + `515 KB` per-language CTC projection heads run at `0.0097x`–`0.0264x` CPU RTF, `~8-11 ms` streaming chunk latency, and `0.00%` committed prefix churn.

### Open Public Benchmarks in the Wild (`n = 1,280` Unseen Official `test` Clips, `B = 1,000` Bootstrap)

Reproducible via [`python bench/eval_open_benchmarks.py`](bench/eval_open_benchmarks.py) across 16 official Hugging Face `test` splits with zero training overlap:

| Open Public Benchmark (`test` split) | Lang | Clips | Studio (`177.4 MiB`) CER [95% CI] | Mobile (`25.35 MiB`) CER [95% CI] | Mobile 4T RTF |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `openslr/librispeech_asr` (`test-clean`) | `en` | 80 | `10.53% [8.58%, 12.47%]` | `16.91% [14.60%, 19.24%]` | `0.009x` |
| `openslr/librispeech_asr` (`test-other`) | `en` | 80 | `19.21% [16.71%, 22.00%]` | `28.04% [25.78%, 30.36%]` | `0.009x` |
| `MushanW/GLOBE` (`default/test`, global accents) | `en` | 80 | `15.29% [12.98%, 17.82%]` | `22.26% [20.00%, 24.84%]` | `0.011x` |
| `edinburghcstr/ami` (`ihm/test`, meeting speech) | `en` | 80 | `41.50% [36.90%, 46.24%]` | `51.63% [47.36%, 56.33%]` | `0.012x` |
| `sushrota-sanskrit-asr` (`in_the_wild_test`) | `sa` | 80 | `18.92% [9.94%, 30.36%]` | `40.15% [29.73%, 52.95%]` | `0.007x` |
| `google/fleurs` (`en_us/test`) | `en` | 80 | `17.23% [15.37%, 19.21%]` | `25.97% [23.74%, 28.22%]` | `0.012x` |
| `google/fleurs` (`hi_in/test`) | `hi` | 80 | `5.13% [3.86%, 6.61%]` | `14.04% [12.17%, 16.22%]` | `0.009x` |
| `google/fleurs` (`kn_in/test`) | `kn` | 80 | `4.49% [3.48%, 5.69%]` | `9.60% [8.14%, 11.15%]` | `0.009x` |
| `google/fleurs` (`mr_in/test`) | `mr` | 80 | `7.85% [6.48%, 9.46%]` | `21.44% [18.86%, 23.95%]` | `0.008x` |
| `google/fleurs` (`bn_in/test`) | `bn` | 80 | `5.44% [4.61%, 6.34%]` | `13.88% [12.37%, 15.41%]` | `0.009x` |
| `google/fleurs` (`ta_in/test`) | `ta` | 80 | `10.32% [8.90%, 11.84%]` | `18.58% [16.86%, 20.40%]` | `0.011x` |
| `google/fleurs` (`te_in/test`) | `te` | 80 | `8.14% [6.24%, 10.05%]` | `16.04% [13.99%, 18.16%]` | `0.010x` |
| `google/fleurs` (`ml_in/test`) | `ml` | 80 | `6.36% [4.98%, 7.90%]` | `14.89% [13.60%, 16.21%]` | `0.011x` |
| `google/fleurs` (`gu_in/test`) | `gu` | 80 | `5.97% [4.68%, 7.53%]` | `16.80% [14.74%, 18.89%]` | `0.009x` |
| `google/fleurs` (`pa_in/test`) | `pa` | 80 | `8.84% [7.44%, 10.50%]` | `20.56% [18.01%, 23.30%]` | `0.010x` |
| `google/fleurs` (`or_in/test`) | `or` | 80 | `7.69% [6.37%, 9.03%]` | `18.87% [16.61%, 21.18%]` | `0.008x` |
| **12-Lang Open `FLEURS` + Wild (`n = 960`)** | — | **960** | **`8.87% [7.94%, 10.02%]`** | **`19.23% [18.11%, 20.64%]`** | **`0.009x`** |
| **All 16 Open Public Suites (`n = 1,280`)** | — | **1,280** | **`12.06% [11.09%, 12.97%]`** | **`21.85% [20.79%, 22.87%]`** | **`0.0097x`** |

## Live Playground

- h3manth.com AI Experiments Studio: [https://h3manth.com/ai/swanada/](https://h3manth.com/ai/swanada/)
- GitHub Pages Web Studio: [https://hemanth.github.io/swanada/](https://hemanth.github.io/swanada/)

## Model Weights & Hugging Face Hub

Quantized INT8 model weights are hosted on Hugging Face Hub:
- Repository: [https://huggingface.co/gnumanth/swanada](https://huggingface.co/gnumanth/swanada)

## License

MIT © [Hemanth HM](https://h3manth.com)
