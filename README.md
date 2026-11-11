# swanada (स्वनद)

In-browser, Node.js, and Python 16,000 Hz multilingual speech-to-text (STT) for Classical Sanskrit (`sa`), Indian English (`en`), and ten Indic languages (`hi`, `kn`, `mr`, `bn`, `ta`, `te`, `ml`, `gu`, `pa`, `or`) powered by **capability-routed dual-tier Conformer-CTC INT8 models** (`25.35 MiB` Mobile Conformer-Small for phones/tablets + `177.4 MiB` Studio Conformer-Large for desktop/servers), **`< 1 ms` 12-Way Automatic Language Detection (`lid.bin`, `396 KiB`)**, and **Voronoi `+EN` Latin code-switching** running 100% client-side via ONNX/WASM with zero cloud or server dependencies.

```bash
npm install swanada
```

```bash
pip install swanada
```

## Quick Start (JavaScript / TypeScript)

```typescript
import { Swanada } from 'swanada';

// Initialize transcriber (`language: 'auto'` runs <1 ms 12-Way Auto-LID; `modelTier: 'auto'` picks 25.4 MiB mobile on phones)
const transcriber = await Swanada.create({
  language: 'auto', // 'auto' | 'sa' | 'en' | 'hi' | 'kn' | 'mr' | 'bn' | 'ta' | 'te' | 'ml' | 'gu' | 'pa' | 'or'
  codeSwitchEn: true, // Optional frame-synchronous Voronoi +EN Latin code-switching
  modelTier: 'auto', // 'auto' | 'mobile' | 'studio'
  executionProvider: 'wasm',
  numThreads: 4,
});

// Transcribe audio Float32Array PCM or WAV ArrayBuffer
const result = await transcriber.transcribe(audioPcmFloat32);
console.log(`Transcript (${result.language}, conf=${result.languageConfidence}):`, result.text);
console.log(`Duration: ${result.durationMs}ms | Latency: ${result.inferenceMs}ms | RTF: ${result.rtf}`);

// Classical Sanskrit to Roman IAST transliteration
const iast = Swanada.transliterateIast(result.text);
console.log('IAST Transliteration:', iast);

await transcriber.release();
```

## Quick Start (Python)

```python
from swanada import Swanada

stt = Swanada.create(language="auto", code_switch_en=True, tier="studio")  # or tier="mobile" (25.35 MiB)
result = stt.transcribe("speech_16k.wav")

print(f"Transcript ({result.language}):", result.text)
print(f"Duration: {result.duration_ms:.1f}ms | Latency: {result.inference_ms:.1f}ms | RTF: {result.rtf:.3f}")
```

## CLI Usage

Dual-runtime command-line interface with identical flags:

```bash
# Node.js CLI
npx swanada speech.wav -l auto --code-switch-en
npx swanada recitation.wav -l sa --iast --json -o output.json
cat stream.wav | npx swanada -l hi --stream

# Python CLI
swanada speech.wav -l auto
cat stream.wav | swanada -l ta --stream
```

### Unified CLI Flags
- `-l, --language <lang>`: Language code or `auto` for 12-way automatic language detection (default: `sa`). Supported: `auto, sa, en, hi, kn, mr, bn, ta, te, ml, gu, pa, or`.
- `--code-switch-en`: Enable frame-synchronous Voronoi English (`+EN` Latin) code-switching during Indic/Sanskrit speech.
- `-m, --model-dir <dir>`: Optional custom models directory.
- `-o, --output <file>`: Output text file (default: stdout).
- `--json`: Emit structured JSON with text, language, languageConfidence, durationMs, inferenceMs, rtf, and tokens.
- `--stream`: Simulate chunk-by-chunk streaming transcription (320 ms quanta).
- `--iast`: Transliterate Classical Sanskrit output to Roman IAST with Vedic accents.
- `--tier <studio|mobile|auto>`: Select `177.4 MiB` `studio` tier or `< 30 MB` (`25.35 MiB`) `mobile` tier (default: `studio`).
- `-h, --help`: Show help and usage summary.
- `-v, --version`: Show version (`swanada 1.1.0`).

## Capability-Routed Dual-Tier Footprint (`v1.1.0`)

| Model Tier | Architecture | Shared INT8 Encoder | Per-Lang Head | 12-Way LID Head | 12-Lang Fleet Total | CPU RTF | Offline Cache |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **Mobile (`< 30 MB`)** | 14-layer Conformer-Small (`d=256`, `23.56M`) | `25.35 MiB` (`26.58 MB`) | `515 KB` | `396 KB` (`lid.bin`) | **`31.8 MiB` (`33.3 MB`)** | **`0.009x`** (`111×` RT) | iOS Safari & Android Chrome `CacheStorage` |
| **Studio (Desktop)** | 17-layer Conformer-Large (`d=512`, `115.2M`) | `177.4 MiB` (`186.0 MB`) | `515 KB` | `396 KB` (`lid.bin`) | **`183.8 MiB` (`192.7 MB`)** | **`0.021x`** (`48×` RT) | Desktop Chrome / Edge / Firefox / Node / Python |

## Benchmarks

Evaluated across **1,600 strictly unseen official public `test` clips** across 16 Hugging Face suites (`OpenASR` English + `Google FLEURS` 11-Language + `Sushrota` wild Sanskrit, [`LEADERBOARD_REPORT.md`](bench/LEADERBOARD_REPORT.md)), **480 held-out 16 kHz studio utterances** ([`ACCURACY_REPORT.md`](bench/ACCURACY_REPORT.md)), **240 unseen 12-Way Auto-LID clips**, **100 silent/ambient-noise clips**, **150 multi-accent & conversational slang clips**, and **72 streaming sessions** (`B = 1,000` bootstrap 95% CIs, `0.00%` test-set leakage):

### 1. Head-to-Head vs. Udgam Labs Shruti (`https://udgamlabs.com/models/shruti`)

All WER scores below use Shruti's exact published protocol (`Unicode NFC + lowercase + stripped punctuation`) on strictly unseen `google/fleurs` (`test`) splits:

| Capability / Benchmark | Udgam Labs Shruti (Published) | Swanada Mobile (`25.35 MiB`) | Swanada Studio (`177.4 MiB`) | Advantage |
| :--- | :---: | :---: | :---: | :--- |
| **All 12 Languages Total Footprint** | `356.2 MB` (`12 × 29.7 MB` `.ct2`) | **`33.3 MB` (`31.8 MiB`)** | **`192.7 MB` (`183.8 MiB`)** | **`10.7×` smaller Mobile / `1.9×` smaller Studio** |
| **12-Way Automatic Language ID** | **None** (manual picker required) | **`95.4%` (`< 1 ms`)** | **`100.0%` (`240/240`, `< 1 ms`)** | **Single shared encoder pass + `+EN` code-mix** |
| **Browser / Mobile ONNX Parity** | **`0 / 22` passed** (9 failed incl. Hindi) | **`12 / 12` passed** | **`12 / 12` passed** | **Full browser WebGPU/WASM, iOS, Android, Node, Py** |
| **Words Invented on 100 Silent Clips** | `0` | **`0`** (`auto` & explicit) | **`0`** (`auto` & explicit) | **Tied at `0` hallucinations** |
| **10-Indic `google/fleurs` Mean WER** | `32.20%` | `50.15%` | **`24.18%` (`10/10` wins)** | **`-8.02` pp lower Studio WER across all 10 langs** |

Per-language Indic `FLEURS` `test` WER (Studio vs. Shruti): Hindi **`13.53%`** vs `19.92%` (`-6.39` pp), Bengali **`20.14%`** vs `29.90%` (`-9.76` pp), Punjabi **`20.23%`** vs `29.30%` (`-9.07` pp), Gujarati **`20.50%`** vs `27.90%` (`-7.40` pp), Kannada **`20.92%`** vs `33.10%` (`-12.18` pp), Marathi **`26.55%`** vs `29.90%` (`-3.35` pp), Malayalam **`26.86%`** vs `36.00%` (`-9.14` pp), Odia **`27.47%`** vs `39.50%` (`-12.03` pp), Telugu **`28.63%`** vs `38.00%` (`-9.37` pp), Tamil **`36.93%`** vs `38.50%` (`-1.57` pp).

### 2. Held-Out 12-Language Studio Suite (`n = 480`) & Unseen `FLEURS`+Wild (`n = 1,200`)

| Language | Code | Held-Out CER (95% CI) | Held-Out WER | Unseen Open CER (LB) |
| :--- | :---: | :---: | :---: | :---: |
| Classical Sanskrit | `sa` | `4.50% [2.86%, 6.40%]` | `24.95%` | `18.80%` |
| Indian English | `en` | `3.94% [2.76%, 5.13%]` | `9.42%` | `16.53%` (`5.90%` LibriClean) |
| Hindi | `hi` | `2.55% [1.61%, 3.61%]` | `9.72%` | `4.56%` |
| Kannada | `kn` | `6.09% [4.36%, 8.18%]` | `34.28%` | `4.27%` |
| Marathi | `mr` | `5.82% [3.56%, 8.54%]` | `24.63%` | `7.88%` |
| Bengali | `bn` | `4.71% [3.45%, 6.09%]` | `23.14%` | `5.13%` |
| Tamil | `ta` | `6.86% [5.19%, 8.65%]` | `36.30%` | `8.83%` |
| Telugu | `te` | `4.05% [2.95%, 5.17%]` | `25.82%` | `8.00%` |
| Malayalam | `ml` | `5.92% [3.71%, 8.37%]` | `31.15%` | `5.51%` |
| Gujarati | `gu` | `5.20% [3.28%, 7.79%]` | `21.73%` | `5.63%` |
| Punjabi | `pa` | `7.46% [4.68%, 11.38%]` | `25.28%` | `6.76%` |
| Odia | `or` | `7.13% [5.06%, 9.83%]` | `34.51%` | `7.15%` |
| **Overall (12 Langs)** | — | **`5.35% [4.79%, 5.95%]`** | **`25.08%`** | **`8.25% [7.41%, 9.29%]`** |

### 3. Open Public Benchmarks (`n = 1,600` Unseen `test` Clips, `B = 1,000` Bootstrap)

Reproducible via [`python bench/eval_open_benchmarks.py`](bench/eval_open_benchmarks.py) across 16 official Hugging Face `test` splits:

| Open Public Benchmark (`test` split) | Lang | Clips | Studio (`177.4 MiB`) LB-CER [95% CI] | Mobile (`25.35 MiB`) LB-CER [95% CI] | Mobile RTF |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `openslr/librispeech_asr` (`test-clean`) | `en` | 100 | `5.90% [4.73%, 7.18%]` (`13.90%` WER) | `14.30% [12.41%, 16.40%]` | `0.011x` |
| `openslr/librispeech_asr` (`test-other`) | `en` | 100 | `12.57% [10.68%, 14.54%]` (`26.85%` WER) | `31.77% [28.76%, 34.91%]` | `0.011x` |
| `MushanW/GLOBE` (`default/test`, global accents) | `en` | 100 | `9.89% [8.04%, 12.01%]` (`23.76%` WER) | `21.92% [19.66%, 24.39%]` | `0.011x` |
| `edinburghcstr/ami` (`ihm/test`, meeting speech) | `en` | 100 | `39.71% [35.01%, 44.65%]` (`54.37%` WER) | `55.49% [51.63%, 59.72%]` | `0.011x` |
| `sushrota-sanskrit-asr` (`in_the_wild_test`) | `sa` | 100 | `18.80% [10.95%, 28.44%]` | `40.49% [31.86%, 50.42%]` | `0.006x` |
| `google/fleurs` (`en_us/test`) | `en` | 100 | `16.53% [13.47%, 20.54%]` | `27.46% [24.25%, 31.03%]` | `0.010x` |
| `google/fleurs` (`hi_in/test`) | `hi` | 100 | `4.56% [3.50%, 5.79%]` | `13.56% [11.91%, 15.43%]` | `0.008x` |
| `google/fleurs` (`kn_in/test`) | `kn` | 100 | `4.27% [3.23%, 5.28%]` | `9.19% [7.97%, 10.46%]` | `0.008x` |
| `google/fleurs` (`mr_in/test`) | `mr` | 100 | `7.88% [6.02%, 10.54%]` | `23.15% [20.34%, 26.37%]` | `0.008x` |
| `google/fleurs` (`bn_in/test`) | `bn` | 100 | `5.13% [4.46%, 5.96%]` | `13.88% [12.65%, 15.12%]` | `0.008x` |
| `google/fleurs` (`ta_in/test`) | `ta` | 100 | `8.83% [7.79%, 9.96%]` | `18.73% [17.15%, 20.45%]` | `0.009x` |
| `google/fleurs` (`te_in/test`) | `te` | 100 | `8.00% [6.22%, 10.20%]` | `15.90% [14.06%, 17.86%]` | `0.008x` |
| `google/fleurs` (`ml_in/test`) | `ml` | 100 | `5.51% [4.13%, 7.28%]` | `13.57% [12.39%, 14.67%]` | `0.009x` |
| `google/fleurs` (`gu_in/test`) | `gu` | 100 | `5.63% [4.63%, 6.66%]` | `16.61% [14.79%, 18.45%]` | `0.008x` |
| `google/fleurs` (`pa_in/test`) | `pa` | 100 | `6.76% [5.77%, 7.89%]` | `18.83% [16.75%, 20.79%]` | `0.008x` |
| `google/fleurs` (`or_in/test`) | `or` | 100 | `7.15% [5.89%, 8.45%]` | `19.34% [17.26%, 21.42%]` | `0.008x` |
| **12-Lang Open `FLEURS` + Wild (`n = 1,200`)** | — | **1,200** | **`8.25% [7.41%, 9.29%]`** | **`19.23% [18.16%, 20.41%]`** | **`0.008x`** |
| **All 16 Open Public Suites (`n = 1,600`)** | — | **1,600** | **`10.44% [9.62%, 11.30%]`** | **`22.14% [21.13%, 23.11%]`** | **`0.009x`** |

### 4. Conversational Slang, Regional Accents & Streaming (`n = 150` + `n = 72`)

- **Multi-Accent & Slang Suite (`n = 150`)**: Overall CER **`17.26% [14.20%, 20.54%]`**, WER **`35.47% [31.19%, 39.58%]`** (`real_human_accents` `GLOBE`+`AMI` WER **`30.28%`**, `indic_colloquial_loanwords` CER **`5.91%`** / WER **`17.85%`**).
- **100 ms Streaming Suite (`n = 72` across 12 languages)**: `7.8 ms` mean chunk latency, **`28.62 ms` median TTFT** (`30.51 ms` mean), `0.0958x` streaming RTF, and **`0.00%` (`0 / 72`) committed-prefix churn**.

## Live Playground

- h3manth.com AI Experiments Studio: [https://h3manth.com/ai/swanada/](https://h3manth.com/ai/swanada/)
- GitHub Pages Web Studio: [https://hemanth.github.io/swanada/](https://hemanth.github.io/swanada/)

## Model Weights & Hugging Face Hub

Quantized INT8 model weights, 24 native-script `.bin` CTC heads, and `lid.bin` 12-Way Auto-LID heads are hosted on Hugging Face Hub:
- Repository: [https://huggingface.co/gnumanth/swanada](https://huggingface.co/gnumanth/swanada)

## License

MIT © [Hemanth HM](https://h3manth.com)
