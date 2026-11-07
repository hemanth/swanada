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

# Swanada (स्वनद) v1.0.0 — In-Browser & Multi-Runtime Indic Speech-to-Text

Swanada (*Svanada* — Sanskrit `स्वनद`, resonant acoustic stream) is a **16 kHz In-Browser, Node.js, and Python Multilingual Speech-to-Text** suite (**~178 MB active INT8 ONNX per language, < 0.12x browser WASM RTF, < 0.04x native CPU RTF**) providing client-side speech recognition across **Classical Sanskrit (`sa`)**, **Indian English (`en`)**, and **10 Indic languages** (`hi`, `kn`, `mr`, `bn`, `ta`, `te`, `ml`, `gu`, `pa`, `or`) with **zero cloud or server dependencies**.

- **Interactive In-Browser Tactile Playground**: [https://hemanth.github.io/swanada/](https://hemanth.github.io/swanada/)
- **GitHub Repository & Multi-Runtime SDKs**: [https://github.com/hemanth/swanada](https://github.com/hemanth/swanada)
- **Hugging Face Model Repository**: [https://huggingface.co/gnumanth/swanada](https://huggingface.co/gnumanth/swanada)

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
| **Swanada INT8 (Shared + 515 KB Head)** | **ONNX Runtime Web / CPU** | **178.4 MB + 515 KB** | **0.0436x** | **0.1937x** | **43.1 ms** | **`16.67% [15.60, 17.85]`** | **`59.15% [56.47, 61.91]`** |
| Zero-Dep VAD Gate (Tier 2) | Audio Energy RMS < 1e-4 | 0.0 MB | < 0.001x | < 0.001x | < 1 ms | 0.00 (silence) | 0.00 (silence) |

### Per-Language Held-Out Accuracy

| Language | Script | Swanada INT8 CER (%) | Swanada INT8 WER (%) | Baseline FP32 CER (%) |
| :--- | :--- | :---: | :---: | :---: |
| Sanskrit (`sa`) | Devanagari | `7.78% [5.47, 10.42]` | `36.25% [26.97, 45.86]` | `8.20%` |
| Indian English (`en`) | Latin | `23.87% [21.73, 26.21]` | `57.39% [52.40, 62.09]` | `15.80%` |
| Hindi (`hi`) | Devanagari | `8.87% [7.28, 10.71]` | `33.02% [27.49, 38.77]` | `9.80%` |
| Kannada (`kn`) | Kannada | `9.64% [7.76, 11.63]` | `51.12% [44.23, 58.30]` | `14.50%` |
| Marathi (`mr`) | Devanagari | `23.44% [19.59, 27.00]` | `77.07% [70.46, 83.08]` | `24.10%` |
| Bengali (`bn`) | Bengali | `23.98% [20.30, 28.01]` | `71.94% [67.21, 77.24]` | `24.50%` |
| Tamil (`ta`) | Tamil | `19.05% [16.50, 21.53]` | `72.08% [63.88, 79.15]` | `20.20%` |
| Telugu (`te`) | Telugu | `19.38% [16.37, 22.63]` | `74.07% [65.84, 82.20]` | `20.80%` |
| Malayalam (`ml`) | Malayalam | `14.43% [11.28, 18.04]` | `65.28% [55.36, 77.64]` | `18.20%` |
| Gujarati (`gu`) | Gujarati | `15.27% [10.06, 23.87]` | `48.36% [39.88, 57.91]` | `16.10%` |
| Punjabi (`pa`) | Gurmukhi | `16.34% [13.76, 18.99]` | `59.80% [50.52, 70.50]` | `18.40%` |
| Odia (`or`) | Odia | `17.94% [14.64, 21.61]` | `63.38% [53.91, 74.51]` | `21.50%` |

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
