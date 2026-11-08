"""End-to-end 12-language streaming exact-match verification across Python & JS runtimes."""

import json
import subprocess
import wave
from pathlib import Path
import numpy as np

from swanada import Swanada

REPO_ROOT = Path(__file__).resolve().parents[1]
SAMPLES_DIR = REPO_ROOT / "docs" / "samples"
MODELS_DIR = REPO_ROOT / "models"

CANONICAL_PRESETS = {
    "sa": "व्यायामः देहस्य अङ्गेषु पुष्टिं ददाति",
    "en": "The king was troubled with jealousy.",
    "hi": "अपने हेडमास्टर साहब ही को देखो",
    "kn": "ಹಾಗಾಗಿ ಬ್ಯಾಂಕ್ ಇದ್ನ ಸ್ಥಗಿತಗೊಳ್ಸಿದೆ",
    "mr": "हो आणखीही काही आहे",
    "bn": "সেজন্য যেন আবার দাদার উপর অভিমান করে বসিনে",
    "ta": "அதோ கலங்கரை விளக்கமும் தெரிகிறது",
    "te": "నాకు కూడా ప్రయాణం చేయటం చదవటం ఇష్టం",
    "ml": "ഉമ്മായ്ക്കതിൽ പരിപൂർണവിശ്വാസമുണ്ട്",
    "gu": "જો એવું હોય તો હું બસથી જઈશ",
    "pa": "ਉਦਯੋਗਨਗਰੀ ਐਕਸਪ੍ਰੈਸ",
    "or": "ସନ୍ଧ୍ୟାଙ୍କୁ ଇମେଲ କରି ଏହା ଲେଖ",
}


def _load_wav_float32(path: Path) -> np.ndarray:
    with wave.open(str(path), "rb") as wf:
        raw = wf.readframes(wf.getnframes())
        return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0


def test_python_12_languages_batch_and_streaming_exact_match():
    """Verify 100.00% exact character-for-character match across all 12 languages in Python."""
    failures = []
    for lang, expected in CANONICAL_PRESETS.items():
        asr = Swanada(language=lang, model_dir=str(MODELS_DIR))
        wav_path = SAMPLES_DIR / f"{lang}.wav"
        pcm = _load_wav_float32(wav_path)

        batch_res = asr.transcribe(pcm)
        if batch_res.text != expected:
            failures.append(f"[{lang}] PY batch: {batch_res.text!r} != {expected!r}")

        for chunk_size in (1600, 2400, 3200, 5120):
            stream = asr.stream(chunk_size_samples=chunk_size)
            committed_history = []
            partials = []
            for off in range(0, len(pcm), chunk_size):
                ev = stream.push(pcm[off : off + chunk_size])
                if ev is not None and ev.text:
                    partials.append(ev)
                    if ev.committed:
                        if committed_history:
                            prev_c = committed_history[-1]
                            if not ev.committed.startswith(prev_c):
                                failures.append(
                                    f"[{lang} chunk={chunk_size}] PY churn: {prev_c!r} -> {ev.committed!r}"
                                )
                        committed_history.append(ev.committed)
            final_ev = stream.finish()
            if len(partials) < 1:
                failures.append(f"[{lang} chunk={chunk_size}] PY zero partials")
            if final_ev.text != expected:
                failures.append(
                    f"[{lang} chunk={chunk_size}] PY stream: {final_ev.text!r} != {expected!r}"
                )
            if committed_history and not final_ev.text.startswith(committed_history[-1]):
                failures.append(
                    f"[{lang} chunk={chunk_size}] PY final prefix mismatch: "
                    f"{committed_history[-1]!r} -> {final_ev.text!r}"
                )

    assert not failures, "Python 12-lang streaming mismatches:\n" + "\n".join(failures)


def test_js_12_languages_batch_and_mobile_streaming_exact_match(tmp_path: Path):
    """Verify 100.00% exact character-for-character match across all 12 languages in Node/Browser JS."""
    runner_mjs = tmp_path / "verify_12lang_stream.mjs"
    runner_mjs.write_text(
        f"""
import fs from 'node:fs';
import path from 'node:path';
import Swanada, {{ parseWav }} from {json.dumps(str(REPO_ROOT / "js" / "dist" / "index.mjs"))};

const MODELS = {json.dumps(str(MODELS_DIR))};
const SAMPLES = {json.dumps(str(SAMPLES_DIR))};
const PRESETS = {json.dumps(CANONICAL_PRESETS, ensure_ascii=False)};

const failures = [];
for (const [lang, expected] of Object.entries(PRESETS)) {{
  const asr = await Swanada.create({{ language: lang, modelDir: MODELS }});
  const wavBytes = fs.readFileSync(path.join(SAMPLES, `${{lang}}.wav`));
  const {{ pcm }} = parseWav(wavBytes);

  const batchRes = await asr.transcribe(pcm);
  if (batchRes.text !== expected) {{
    failures.push(`[${{lang}}] JS batch: ${{JSON.stringify(batchRes.text)}} !== ${{JSON.stringify(expected)}}`);
  }}

  for (const chunkSize of [1600, 2400, 3200, 5120]) {{
    const session = asr.stream({{ chunkSizeSamples: chunkSize }});
    let prevCommitted = '';
    let partialCount = 0;
    for (let off = 0; off < pcm.length; off += chunkSize) {{
      const ev = await session.push(pcm.subarray(off, Math.min(off + chunkSize, pcm.length)));
      if (ev && ev.text) {{
        partialCount++;
        if (ev.committed) {{
          if (prevCommitted && !ev.committed.startsWith(prevCommitted)) {{
            failures.push(`[${{lang}} chunk=${{chunkSize}}] JS churn: ${{JSON.stringify(prevCommitted)}} -> ${{JSON.stringify(ev.committed)}}`);
          }}
          prevCommitted = ev.committed;
        }}
      }}
    }}
    const finalEv = await session.finish();
    if (partialCount < 1) {{
      failures.push(`[${{lang}} chunk=${{chunkSize}}] JS zero partials`);
    }}
    if (finalEv.text !== expected) {{
      failures.push(`[${{lang}} chunk=${{chunkSize}}] JS stream: ${{JSON.stringify(finalEv.text)}} !== ${{JSON.stringify(expected)}}`);
    }}
    if (prevCommitted && !finalEv.text.startsWith(prevCommitted)) {{
      failures.push(`[${{lang}} chunk=${{chunkSize}}] JS final prefix mismatch: ${{JSON.stringify(prevCommitted)}} -> ${{JSON.stringify(finalEv.text)}}`);
    }}
  }}
  await asr.release();
}}

if (failures.length > 0) {{
  console.error(failures.join('\\n'));
  process.exit(1);
}}
console.log('ALL 12 LANGUAGES x 4 CHUNK SIZES = 48 JS STREAMING RUNS + 12 BATCH RUNS 100% EXACT!');
process.exit(0);
""",
        encoding="utf-8",
    )
    proc = subprocess.run(
        ["node", str(runner_mjs)],
        cwd=str(REPO_ROOT / "js"),
        capture_output=True,
        text=True,
        timeout=480,
    )
    assert proc.returncode == 0, f"JS 12-language streaming test failed:\n{proc.stderr}\n{proc.stdout}"
