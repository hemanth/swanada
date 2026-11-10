---
language:
  - sa
  - en
  - hi
  - kn
  - mr
  - bn
  - ta
  - te
  - ml
  - gu
  - pa
  - or
license: mit
library_name: onnx
pipeline_tag: automatic-speech-recognition
datasets:
  - ai4bharat/IndicVoices
  - ai4bharat/vistaar
  - mozilla-foundation/common_voice_17_0
  - prathoshap/sushrota-sanskrit-asr
tags:
  - automatic-speech-recognition
  - speech-to-text
  - indic
  - onnx
  - conformer-ctc
  - wasm
  - webgpu
  - zero-cloud
  - sanskrit
  - indian-english
  - hindi
  - kannada
  - marathi
  - bengali
  - tamil
  - telugu
  - malayalam
  - gujarati
  - punjabi
  - odia
  - onnxruntime-web
metrics:
  - wer
  - cer
---

# Swanada (स्वनद) v1.1.0 — Dual-Tier (`25.4 MiB` Mobile + `177.4 MiB` Studio) In-Browser & Multi-Runtime Indic Speech-to-Text

Swanada (*Svanada* — Sanskrit `स्वनद`, resonant acoustic stream) is a **16 kHz In-Browser, Node.js, and Python Multilingual Speech-to-Text** suite with **Capability-Routed Dual-Tier INT8 ONNX models** (`25.35 MiB` Conformer-Small Mobile tier + `515 KB` heads for phones/tablets; `177.4 MiB` Conformer-Large Studio tier + `515 KB` heads for desktop/workstations) providing client-side speech recognition across **Classical Sanskrit (`sa`)**, **Indian English (`en`)**, and **10 Indic languages** (`hi`, `kn`, `mr`, `bn`, `ta`, `te`, `ml`, `gu`, `pa`, `or`) with **zero cloud or server dependencies**.

- **h3manth.com AI Studio**: [https://h3manth.com/ai/swanada/](https://h3manth.com/ai/swanada/)
- **GitHub Pages Playground**: [https://hemanth.github.io/swanada/](https://hemanth.github.io/swanada/)
- **GitHub Repository & Multi-Runtime SDKs**: [https://github.com/hemanth/swanada](https://github.com/hemanth/swanada)
- **Hugging Face Model Repository**: [https://huggingface.co/gnumanth/swanada](https://huggingface.co/gnumanth/swanada)

## Capability-Routed Dual-Tier Architecture (`v1.1.0`)

| Model Tier | Shared INT8 Encoder | Per-Language Head | Active Footprint | Native 4T RTF | Target Runtime |
| :--- | :--- | :--- | :---: | :---: | :--- |
| **Mobile (`< 30 MB`)** | `onnx_mobile/swanada_mobile_ctc_int8.onnx` (14L, `d=256`, `23.56M` params) | `heads_mobile/<lang>.bin` (`515 KB`) | **`25.35 MiB` + `515 KB`** | **`0.009x`** | iOS Safari, Android Chrome (`CacheStorage` offline), `--tier mobile` |
| **Studio (Max Accuracy)** | `onnx/sushrota_sanskrit_ctc_int8.onnx` (17L, `d=512`, `115.2M` params) | `heads/<lang>.bin` (`515 KB`) | **`177.4 MiB` + `515 KB`** | **`0.025x`** | Desktop browsers, Node.js, Python (`--tier studio`, default) |

## Architecture & Offline Inference Pipeline

```
[ Audio Input (PCM 16 kHz Mono) ]
               │
               ▼
   [ Audio Frontend: preprocessor.onnx ]
   (80-channel Log-Mel Filterbank, 25ms window, 10ms hop)
               │
               ▼
   [ Acoustic Encoder: Conformer Backbone ]
   (17 layers, d_model=512, 8 heads, conv_kernel=31, 4x subsampling)
               │
               ▼
   [ Multilingual Sliced CTC Acoustic Head ]
   (257-token language-specific linear projection: 512 -> 257)
               │
               ▼
   [ Linear-Time CTC Greedy Decoder ]
   (Argmax -> Dedup consecutive tokens -> Drop blank 0 -> NFC normalization)
               │
               ▼
   [ Transcription: Native Script / Classical Sanskrit IAST ]
```

- **Deterministic Audio Frontend (`preprocessor.onnx`)**: Extracts 80-channel log-mel spectrogram features directly from 16 kHz Float32 PCM. Runtimes provide an analytical standard-library FFT fallback if WASM tensor operators are unavailable.
- **Quantized INT8 Conformer-CTC**: 17 Conformer encoder layers dynamically quantized to `QUInt8` weights, reducing size from 481 MB to 178 MB with minimal precision degradation.
- **Multi-Script Tokenizer Maps (`models/vocabularies/*.json`)**: Subword SentencePiece BPE vocabularies (256 units + blank at index 0) covering Sanskrit Devanagari, Indian English Latin, and 10 regional Indic scripts.
- **Offline CacheStorage Contract**: Model weights are stored in browser `CacheStorage` (`swanada-onnx-v1.0.0`) on first use, guaranteeing **zero network requests** during subsequent sessions.

## Held-Out 16 kHz Benchmark Leaderboard (N = 480 Utterances; B = 1000 Bootstrap 95% CIs)

| System Tier | Runtime / Provider | Active Footprint | Mean RTF (CPU) | Mean RTF (WASM) | TTFT p50 (ms) | CER (%) [95% CI] | WER (%) [95% CI] |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| IndicConformer Full (FP32) | PyTorch (MPS/CUDA/CPU) | 481.4 MB × 12 | 0.082x | — | > 200 ms | `17.68%` | — |
| **Swanada INT8 (Shared + 515 KB Head)** | **ONNX Runtime Web / CPU** | **178.4 MB + 515 KB** | **0.0436x** | **0.1937x** | **43.1 ms** | **`5.43% [4.85, 6.01]`** | **`25.88% [23.50, 28.27]`** |
| Zero-Dep VAD Gate (Tier 2) | Audio Energy RMS < 1e-4 | 0.0 MB | < 0.001x | < 0.001x | < 1 ms | 0.00 (silence) | 0.00 (silence) |

### Per-Language Held-Out Accuracy

| Language | Script | Swanada INT8 CER (%) | Swanada INT8 WER (%) | Baseline FP32 CER (%) |
| :--- | :--- | :---: | :---: | :---: |
| Sanskrit (`sa`) | Devanagari | `4.27% [2.69, 6.10]` | `22.99% [15.41, 32.21]` | `8.20%` |
| Indian English (`en`) | Latin | `5.45% [4.19, 6.80]` | `15.82% [12.99, 18.82]` | `15.80%` |
| Hindi (`hi`) | Devanagari | `2.14% [1.41, 2.97]` | `8.04% [5.40, 10.88]` | `9.80%` |
| Kannada (`kn`) | Kannada | `5.18% [3.86, 6.86]` | `31.39% [24.49, 39.27]` | `14.50%` |
| Marathi (`mr`) | Devanagari | `5.72% [3.19, 8.34]` | `22.52% [13.86, 31.50]` | `24.10%` |
| Bengali (`bn`) | Bengali | `5.92% [4.34, 7.54]` | `30.98% [24.62, 37.53]` | `24.50%` |
| Tamil (`ta`) | Tamil | `7.50% [5.92, 9.09]` | `38.12% [31.30, 45.01]` | `20.20%` |
| Telugu (`te`) | Telugu | `4.79% [3.48, 6.33]` | `28.51% [21.40, 36.34]` | `20.80%` |
| Malayalam (`ml`) | Malayalam | `6.16% [4.10, 8.27]` | `34.03% [23.73, 44.19]` | `18.20%` |
| Gujarati (`gu`) | Gujarati | `4.79% [2.97, 6.98]` | `19.28% [13.26, 25.98]` | `16.10%` |
| Punjabi (`pa`) | Gurmukhi | `6.35% [3.52, 9.78]` | `23.38% [14.27, 33.11]` | `18.40%` |
| Odia (`or`) | Odia | `6.93% [4.91, 9.41]` | `35.50% [24.81, 48.97]` | `21.50%` |

## Quickstart: JavaScript & Python Usage

### 1. In-Browser & Node.js (JavaScript / TypeScript)

```typescript
import { Swanada } from 'swanada';

const transcriber = await Swanada.create({
  language: 'sa', // Classical Sanskrit
  executionProvider: 'wasm',
  numThreads: 4,
});

const result = await transcriber.transcribe(audioPcmFloat32);
console.log(`Transcript (${result.language}):`, result.text);
console.log(`Inference: ${result.inferenceMs.toFixed(1)}ms | RTF: ${result.rtf.toFixed(3)}x`);
```

### 2. Standalone Python

```python
from swanada import Swanada

stt = Swanada(language="kn")  # Kannada
result = stt.transcribe("speech_sample_16k.wav")
print("Transcribed Text:", result.text)
print(f"Duration: {result.duration_ms:.1f}ms | RTF: {result.rtf:.3f}x")
```

## Citation & Academic Lineage

```bibtex
@software{swanada2026,
  author = {Hemanth HM},
  title = {Swanada: In-Browser Multilingual Speech-to-Text for Classical Sanskrit and Indic Languages via ONNX and WASM},
  url = {https://github.com/hemanth/swanada},
  year = {2026}
}
```
