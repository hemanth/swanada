# Swanada Mobile Showcase Video Assets

This directory contains the split-stage animated mobile showcase videos and configurations for **Swanada (स्वनद)** — 100% offline multilingual speech-to-text with 12-way Auto-LID, Sanskrit IAST transliteration, and Kanglish/Hinglish bilingual code-switching.

The videos follow the `mobile-showcase-post` design specification: pairing a static, zero-jitter editorial pitch on the left with a live `@2x` Retina Playwright recording inside an iPhone chassis on the right, accompanied by synchronized 48 kHz stereo audio and strict platform transcoder compliance.

---

## 1. Deliverable Assets Summary

| File | Aspect Ratio | Dimensions | Duration | Size | Format & Codecs |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **`swanada-showcase-square.mp4`** | `1:1` | 1080 × 1080 | 38.47 s | ~3.7 MB | H.264 Main@4.1 (bt709, yuv420p, SAR 1:1, mp42) + AAC 48 kHz stereo |
| **`swanada-showcase-square.gif`** | `1:1` | 1080 × 1080 | 38.47 s | ~7.5 MB | 256-color animated GIF (`sierra2_4a` dither, 15 fps) |
| **`swanada-showcase-portrait.mp4`** | `4:5` | 1080 × 1350 | 38.59 s | ~4.2 MB | H.264 Main@4.1 (bt709, yuv420p, SAR 1:1, mp42) + AAC 48 kHz stereo |
| **`swanada-showcase-portrait.gif`** | `4:5` | 1080 × 1350 | 38.59 s | ~8.6 MB | 256-color animated GIF (`sierra2_4a` dither, 15 fps) |
| **`swanada-showcase-square.json`** | — | — | — | 4.9 KB | Declarative configuration and choreography for square showcase |
| **`swanada-showcase-portrait.json`**| — | — | — | 4.9 KB | Declarative configuration and choreography for portrait showcase |

*Note: The workspace root `swanada-mobile-showcase.mp4` is maintained as a synchronized copy of `social/swanada-showcase-square.mp4`.*

---

## 2. Technical Encoding Specifications

Both video deliverables are strictly compliant with **LinkedIn**, **X / Twitter**, **Bluesky**, and **Instagram** ingestion standards:

- **Video Stream**:
  - Codec: H.264 / AVC (`libx264`)
  - Profile & Level: `Main@4.1`
  - Color Range: `tv` (limited range, avoiding full-range `yuvj420p` rejection)
  - Color Primaries / Matrix / Transfer: `bt709` / `bt709` / `bt709`
  - Pixel Format: `yuv420p`
  - Sample Aspect Ratio (SAR): `1:1`
  - Frame Rate: 30 fps progressive
- **Audio Stream**:
  - Codec: AAC LC (`aac`)
  - Sample Rate: 48,000 Hz
  - Channels: 2 (Stereo)
  - Bitrate: ~68–192 kbps
  - Mixing: Zero-jitter sample-accurate mix of local 16-bit uncompressed WAVs from `docs/samples/` aligned to Web Audio fetch events with `alimiter=0.96` ceiling
- **Container**:
  - Major Brand: `mp42`
  - Flags: `+faststart` (moov atom placed before mdat for instant progressive streaming)

---

## 3. Demonstrated Scenarios

The live mobile viewport on the right demonstrates three end-to-end speech recognition scenarios on `docs/index.html` (running Conformer-CTC in WASM SIMD):

1. **Auto-LID & Sanskrit Recitation** (`sa_madhva.wav`, synthesized with `ninada`):
   - Sri Madhvacharya (*Pramāṇalakṣaṇam*): *"प्रज्ञापूर्वकव्यापारवत्त्वं जीवत्वम्"*
   - Dynamic 12-way language detection (<1 ms neural SLID head)
   - Real-time Roman IAST transliteration box (*"prajñāpūrvakavyāpāravattvaṃ jīvatvam"*)
2. **English Speech Recognition** (`en_clean.wav`, synthesized with `ninada`):
   - Fast, clean Latin transcription with real-time waveform trace
3. **Bilingual Code-Switching in Kanglish** (`kanglish.wav`, synthesized with `ninada`):
   - Mixed Kannada + English: *"ಈ ಹೊಸ ಅಪ್ಲಿಕೇಶನ್ ತುಂಬಾ ಚೆನ್ನಾಗಿದೆ It works completely offline on my phone."*
   - Automatic preservation of fused Brahmic suffixes
   - English borrowings underlined in terracotta (`u.en-codemix`)
   - Monotonic prefix progression with strictly 0.00% character churn

---

## 4. Reproduction & Rendering Workflow

### Prerequisites
- Node.js (>= v20, tested on v26.8.1)
- FFmpeg (>= 6.x, tested on 8.1.1 with `libx264` and `aac`)
- Playwright Chromium installed (`NODE_PATH=/Users/lika/labs/swanada/node_modules`)

### Step-by-Step Commands

```bash
cd /Users/lika/labs/swanada

# 1. Render Square 1080x1080 MP4 and GIF:
NODE_PATH=/Users/lika/labs/swanada/node_modules node \
  /Users/lika/.gemini/config/skills/mobile-showcase-post/scripts/render_mobile_showcase.cjs \
  --config social/swanada-showcase-square.json --gif

# 2. Render Portrait 1080x1350 MP4 and GIF:
NODE_PATH=/Users/lika/labs/swanada/node_modules node \
  /Users/lika/.gemini/config/skills/mobile-showcase-post/scripts/render_mobile_showcase.cjs \
  --config social/swanada-showcase-portrait.json --gif

# 3. Synchronize root video deliverable:
cp social/swanada-showcase-square.mp4 swanada-mobile-showcase.mp4

# 4. Verify stream compliance via ffprobe:
ffprobe -hide_banner social/swanada-showcase-square.mp4
ffprobe -hide_banner social/swanada-showcase-portrait.mp4
```
