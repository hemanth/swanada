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

## Capability-Routed Dual-Tier Architecture + `<1 ms` 12-Way Auto-LID (`v1.1.0`)

| Model Tier | Shared INT8 Encoder | Per-Language Head + Auto-LID Head | 12-Lang Fleet | Native 4T RTF | Target Runtime |
| :--- | :--- | :--- | :---: | :---: | :--- |
| **Mobile (`< 30 MiB`)** | `onnx_mobile/swanada_mobile_ctc_int8.onnx` (14L, `d=256`, `23.56M` params) | `heads_mobile/<lang>.bin` (`515 KiB`) + `lid.bin` (`396 KiB`) | **`31.8 MiB` (`33.3 MB`)** | **`0.009x`** | iOS Safari, Android Chrome (`CacheStorage` offline), `--tier mobile` |
| **Studio (Max Accuracy)** | `onnx/sushrota_sanskrit_ctc_int8.onnx` (17L, `d=512`, `115.2M` params) | `heads/<lang>.bin` (`515 KiB`) + `lid.bin` (`396 KiB`) | **`183.8 MiB` (`192.7 MB`)** | **`0.021x`** | Desktop browsers, Node.js, Python (`--tier studio`, default) |

- **12-Way `<1 ms` Automatic Language Identification (`language="auto"`)**: Attentive statistics pooling (`mean + std`) over shared Conformer hidden states (`layer_norm_84`) fused with CTC acoustic certainty routes speech across all 12 languages in a single encoder pass (`100.0%` Studio / `95.4%` Mobile accuracy on `n = 240` unseen clips).
- **Bilingual Indic + English Code-Switching (`code_switch_en=True` / `codeSwitchEn: true`)**: Simultaneously projects shared Conformer states through the detected Indic head and the English head (`en.bin`), preserving genuine English technical/conversational words in Latin script while keeping Indic phrases in native Brahmic script.
- **Zero Silence Hallucinations**: Multi-stage spectral/modulation/formant non-speech gate guarantees `0 / 100` invented words across silent, hum, rumble, and thermal-floor clips.

## Public ASR Leaderboard (`N = 1,600` Unseen `test` Clips; `B = 1,000` Bootstrap 95% CIs)

| Benchmark / Metric | Swanada Studio (`177.4 MiB`) | Swanada Mobile (`25.35 MiB`) | Udgam Labs `Shruti` (`356.2 MB` for 12 langs) |
| :--- | :---: | :---: | :---: |
| **10-Indic `google/fleurs` (`test`) Mean WER** | **`24.18%` (`10 / 10` wins)** | `50.15%` | `32.20%` |
| **12-Lang Open `FLEURS`+Wild CER (`n = 1,200`)** | **`8.25%` [7.41, 9.29]** | **`19.23%` [18.16, 20.41]** | N/A |
| **All 16 Open Suites Overall CER (`n = 1,600`)** | **`10.44%` [9.62, 11.30]** | **`22.14%` [21.13, 23.11]** | N/A |
| **`LibriSpeech test-clean` CER / WER** | **`5.90%` / `13.90%`** | `14.30%` / `33.75%` | — / `5.95%` |
| **`GLOBE` Multi-Accent CER / WER** | **`9.89%` / `23.76%`** | `21.92%` / `47.81%` | — / `22.47%` (`25.75%` auto) |
| **12-Way `language="auto"` Accuracy (`n = 240`)** | **`100.00%` (`8.45%` Auto CER)** | **`95.42%` (`21.24%` Auto CER)** | None (manual picker) |
| **Words Invented on `100` Silent Clips** | **`0`** | **`0`** | `0` |
| **ONNX / Browser / Mobile Parity** | **`12 / 12` passed** | **`12 / 12` passed** | `0 / 22` passed |

## Held-Out 16 kHz Benchmark Leaderboard (N = 480 Utterances; B = 1000 Bootstrap 95% CIs)

| System Tier | Runtime / Provider | Active Footprint | Mean RTF (CPU) | TTFT p50 (ms) | Committed Churn | CER (%) [95% CI] | WER (%) [95% CI] |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Swanada Studio INT8** | **ONNX Runtime Web / CPU** | **177.4 MiB + 515 KiB** | **0.0227x** | **28.6 ms** | **0.00% (0/72)** | **`5.35% [4.79, 5.95]`** | **`25.08% [22.68, 27.45]`** |
| **Swanada Mobile INT8** | **ONNX Runtime Web / CPU** | **25.35 MiB + 515 KiB** | **0.0101x** | **28.6 ms** | **0.00% (0/72)** | **`18.58% [17.45, 19.72]`** | **`59.11% [56.45, 61.87]`** |
| Non-Speech Gate | Spectral + Modulation VAD | 0.0 MB | < 0.001x | < 1 ms | 0.00% | 0.00 (0/100 silent) | 0.00 (0/100 silent) |

### Per-Language Held-Out Accuracy

| Language | Script | Swanada INT8 CER (%) | Swanada INT8 WER (%) | Baseline FP32 CER (%) |
| :--- | :--- | :---: | :---: | :---: |
| Sanskrit (`sa`) | Devanagari | `4.50% [2.86, 6.40]` | `24.95% [16.60, 34.25]` | `8.20%` |
| Indian English (`en`) | Latin | `3.94% [2.76, 5.13]` | `9.42% [7.01, 11.88]` | `15.80%` |
| Hindi (`hi`) | Devanagari | `2.55% [1.61, 3.61]` | `9.72% [6.62, 13.00]` | `9.80%` |
| Kannada (`kn`) | Kannada | `6.09% [4.36, 8.18]` | `34.28% [27.12, 42.30]` | `14.50%` |
| Marathi (`mr`) | Devanagari | `5.82% [3.56, 8.54]` | `24.63% [16.05, 33.54]` | `24.10%` |
| Bengali (`bn`) | Bengali | `4.71% [3.45, 6.09]` | `23.14% [17.96, 28.76]` | `24.50%` |
| Tamil (`ta`) | Tamil | `6.86% [5.19, 8.65]` | `36.30% [29.09, 44.62]` | `20.20%` |
| Telugu (`te`) | Telugu | `4.05% [2.95, 5.17]` | `25.82% [17.87, 33.30]` | `20.80%` |
| Malayalam (`ml`) | Malayalam | `5.92% [3.71, 8.37]` | `31.15% [20.77, 41.42]` | `18.20%` |
| Gujarati (`gu`) | Gujarati | `5.20% [3.28, 7.79]` | `21.73% [15.20, 29.36]` | `16.10%` |
| Punjabi (`pa`) | Gurmukhi | `7.46% [4.68, 11.38]` | `25.28% [16.71, 34.71]` | `18.40%` |
| Odia (`or`) | Odia | `7.13% [5.06, 9.83]` | `34.51% [23.84, 47.89]` | `21.50%` |

## Quickstart: JavaScript & Python Usage

### 1. In-Browser & Node.js (JavaScript / TypeScript)

```typescript
import { Swanada } from 'swanada';

const transcriber = await Swanada.create({
  language: 'auto', // 12-Way <1 ms Auto-LID across sa, en, hi, kn, mr, bn, ta, te, ml, gu, pa, or
  codeSwitchEn: true, // Optional bilingual Indic + English Latin preservation
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

stt = Swanada(language="auto")  # 12-Way Auto-LID (or explicit 'sa', 'hi', 'kn', ...)
result = stt.transcribe("speech_sample_16k.wav")
print(f"Detected: {result.language} ({result.language_confidence:.2%}) -> {result.text}")
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
