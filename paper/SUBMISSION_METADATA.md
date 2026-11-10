# Swanada: arXiv & Interspeech / ICASSP Show-and-Tell Submission Package

All submission artifacts are built, verified with TeX Live `pdflatex` (100% Type-1/CID vector fonts, zero Type-3 bitmap fonts, zero overfull boxes, `\pdfoutput=1` header, pre-compiled `main.bbl`, 7 pages total), and audited against `research-paper-writing` and `diagram-design` guidelines:

- **arXiv Source Bundle (Upload to arXiv)**: [`swanada-arxiv-submission.tar.gz`](./swanada-arxiv-submission.tar.gz)
  - Contains: `main.tex`, `main.bbl`, `references.bib`, `figures/fig1_split_encoder_distillation.pdf`, `figures/fig2_capability_streaming_pipeline.pdf`
- **Camera-Ready PDF**: [`main.pdf`](./main.pdf)
  - Layout: 7 pages including main text (Sections 1-8), 2 vector blueprint figures, 3 `booktabs` tables, and 16 peer-reviewed references.

---

## 1. arXiv Submission Fields (`https://arxiv.org/submit`)

- **License**: CC BY 4.0 (`http://creativecommons.org/licenses/by/4.0/`)
- **Primary Category**: `eess.AS` (Audio and Speech Processing) or `cs.SD` (Sound)
- **Cross-List Categories**: `cs.CL` (Computation and Language), `cs.PF` (Performance)
- **ACM Classification**: `I.2.7; H.5.5; D.3.4`
- **Upload File**: [`swanada-arxiv-submission.tar.gz`](./swanada-arxiv-submission.tar.gz)

### Title
```text
Swanada: Split-Encoder Capability-Routed Conformer CTC and Sub-30 MB On-Device Speech Recognition Across Twelve Scripts
```

### Authors
```text
Hemanth HM
```
*(or `Hemanth Hegadehalli Madhavarao` to match your existing arXiv author profile)*

### Abstract (arXiv MathJax format, < 1,920 characters)
```text
Client-side automatic speech recognition (ASR) across Indic and Classical scripts eliminates cloud transcription costs, network tail latency, and server-side audio retention, yet neural exports face four systems bottlenecks in browsers and mobile runtimes: (1) monolithic per-language Conformer checkpoints require ~177 MiB per script (> 2.1 GiB across 12 scripts), exhausting CacheStorage quotas; (2) static relative positional encoding tables embed 10.2-20.5 MB of FP32 constants while 1x1 Conv1d layers trigger slow or unsupported ConvInteger kernels in WebAssembly SIMD; (3) sliding-window CTC flickers on boundary tokens; and (4) mobile WebAudio pipelines suffer 44.1/48 kHz sample-rate mismatches and silent AudioWorklet stalls under iOS WKWebView.

We present Swanada, an open-source 16 kHz streaming ASR system spanning Classical Sanskrit, Indian English, and ten Indian languages (sa, en, hi, kn, mr, bn, ta, te, ml, gu, pa, or) across browser WebAssembly, Node.js, and Python. Swanada pairs capability-routed shared INT8 Conformer encoders (a 17-layer 177.38 MiB Studio tier at $d = 512$ for desktop/servers and a distilled 14-layer 25.35 MiB Mobile tier at $d = 256$ for phones) with twelve hot-swappable 515.0 KiB native-script linear CTC heads ($257 \times 512$), cutting 12-language storage by $11.6\times$ (183.4 MiB) and $67.8\times$ (31.39 MiB; 25.85 MiB first load). Runtime protobuf tail surgery exposes the shared representation in $< 2$ ms, while dynamic positional synthesis, MatMul pointwise convolutions, and post-quantization QInt8 head calibration preserve sub-30 MB accuracy. Across $N = 480$ held-out and $N = 1,280$ open public test clips (FLEURS, LibriSpeech, GLOBE, AMI, wild Sanskrit), Swanada achieves 5.43% held-out and 8.87% 12-language open CER on Studio (18.56% and 19.23% on Mobile) at $0.0097\times$-$0.0264\times$ RTF, with 30.6 ms median TTFT and 0.00% committed-prefix churn.
```

### Comments
```text
7 pages, 2 figures, 3 tables. Open-source browser, Node.js, and Python implementation with interactive demo at https://hemanth.github.io/swanada/ (and https://h3manth.com/ai/swanada/) and https://github.com/hemanth/swanada
```

---

## 2. Interspeech Show & Tell / Workshop Track Fields (OpenReview / Softconf)

- **PDF Upload**: [`main.pdf`](./main.pdf)
- **Code & Interactive Studio**: `https://github.com/hemanth/swanada` (`https://hemanth.github.io/swanada/`)

### TL;DR (One-sentence summary)
```text
Swanada pairs < 2 ms runtime ONNX protobuf tail surgery and 12 hot-swappable 515 KiB native-script CTC heads with capability-routed 177.4 MiB Studio and distilled 25.35 MiB Mobile INT8 Conformer encoders, achieving 5.43% held-out and 8.87% open 12-language FLEURS+Wild CER (19.23% Mobile) at 0.0097x-0.0264x RTF with 30.6 ms TTFT and 0.00% streaming churn.
```

### Keywords
```text
Streaming Speech Recognition, Conformer CTC, Knowledge Distillation, On-Device ASR, Indic ASR, Sanskrit Speech Recognition, ONNX Quantization, WebAssembly SIMD
```
