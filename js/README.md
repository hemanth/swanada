# swanada (स्वनद)

In-browser, Node.js, and Python 16,000 Hz multilingual speech-to-text (STT) for Classical Sanskrit (`sa`), Indian English (`en`), and ten Indic languages (`hi`, `kn`, `mr`, `bn`, `ta`, `te`, `ml`, `gu`, `pa`, `or`) powered by **capability-routed dual-tier Conformer-CTC INT8 models** (`25.35 MiB` Mobile Conformer-Small + `177.4 MiB` Studio Conformer-Large) running 100% client-side via ONNX/WASM with zero cloud or server dependencies.

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
- `--tier <studio|mobile|auto>`: Select `177.4 MiB` `studio` tier or `25.35 MiB` (`< 30 MB`) `mobile` tier (default: `studio`).
- `-h, --help`: Show help and usage summary.
- `-v, --version`: Show version (`swanada 1.1.0`).

## Benchmarks (`v1.1.0`)

Evaluated across 16 open public `test` suites (`n = 1,280` unseen clips: `LibriSpeech test-clean` & `test-other`, `MushanW/GLOBE`, `AMI`, `Sushrota Sanskrit`, and 11 `google/fleurs` languages), 480 held-out studio utterances, and 150 multi-accent / conversational slang utterances (`B = 1,000` bootstrap 95% CIs):

- **Studio Tier (`177.4 MiB` shared + `515 KB` heads)**: `5.43% [4.85%, 6.01%]` held-out CER | `8.87% [7.94%, 10.02%]` 12-lang open `FLEURS`+Wild CER | `10.53%` `LibriSpeech test-clean` CER | `0.0264x` 4T RTF
- **Mobile Tier (`25.35 MiB` / `26.58 MB` shared + `515 KB` heads, `7.0×` smaller)**: `18.56% [17.46%, 19.75%]` held-out CER | `19.23% [18.11%, 20.64%]` 12-lang open `FLEURS`+Wild CER (`kn` `9.60%`, `bn` `13.88%`, `hi` `14.04%`, `ml` `14.89%`, `te` `16.04%`, `librispeech_test_clean` `16.91%`) | `0.0097x` 4T RTF (`103×` faster than real-time; full iOS Safari & Android Chrome offline `CacheStorage`)
- **Conversational Slang & Multi-Accent Suite (`n = 150`)**: `17.44% [15.35%, 19.64%]` CER / `41.88%` WER (`0.00%` committed streaming churn)

## Live Playground

- h3manth.com AI Experiments Studio: [https://h3manth.com/ai/swanada/](https://h3manth.com/ai/swanada/)
- GitHub Pages Web Studio: [https://hemanth.github.io/swanada/](https://hemanth.github.io/swanada/)

## Model Weights & Hugging Face Hub

Quantized INT8 model weights are hosted on Hugging Face Hub:
- Repository: [https://huggingface.co/gnumanth/swanada](https://huggingface.co/gnumanth/swanada)

## License

MIT © [Hemanth HM](https://h3manth.com)
