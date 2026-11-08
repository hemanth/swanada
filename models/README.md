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
| **Swanada INT8 (Shared + 515 KB Head)** | **ONNX Runtime Web / CPU** | **178.4 MB + 515 KB** | **0.0436x** | **0.1937x** | **43.1 ms** | **`5.53% [4.94, 6.11]`** | **`26.15% [23.77, 28.53]`** |
| Zero-Dep VAD Gate (Tier 2) | Audio Energy RMS < 1e-4 | 0.0 MB | < 0.001x | < 0.001x | < 1 ms | 0.00 (silence) | 0.00 (silence) |

### Per-Language Held-Out Accuracy

| Language | Script | Swanada INT8 CER (%) | Swanada INT8 WER (%) | Baseline FP32 CER (%) |
| :--- | :--- | :---: | :---: | :---: |
| Sanskrit (`sa`) | Devanagari | `4.27% [2.69, 6.10]` | `22.99% [15.41, 32.21]` | `8.20%` |
| Indian English (`en`) | Latin | `6.23% [4.67, 7.92]` | `17.07% [13.85, 20.47]` | `15.80%` |
| Hindi (`hi`) | Devanagari | `2.20% [1.45, 3.03]` | `8.18% [5.49, 10.98]` | `9.80%` |
| Kannada (`kn`) | Kannada | `5.21% [3.88, 6.88]` | `31.67% [24.62, 39.64]` | `14.50%` |
| Marathi (`mr`) | Devanagari | `5.72% [3.19, 8.34]` | `22.52% [13.86, 31.50]` | `24.10%` |
| Bengali (`bn`) | Bengali | `5.95% [4.37, 7.59]` | `31.14% [24.66, 37.64]` | `24.50%` |
| Tamil (`ta`) | Tamil | `7.56% [6.01, 9.11]` | `38.24% [31.42, 45.24]` | `20.20%` |
| Telugu (`te`) | Telugu | `4.95% [3.62, 6.49]` | `29.83% [22.28, 38.12]` | `20.80%` |
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
