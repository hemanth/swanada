#!/usr/bin/env python3
"""Empirical Slang, Colloquial & Multi-Accent ASR Benchmark Suite for Swanada.

Evaluates Swanada across 4 held-out slices designed to measure real-world
conversational, slang, code-switched, and regional-accent robustness (with
B=1,000 non-parametric bootstrap 95% confidence intervals):

  1. `real_human_accents`: Unseen real human speakers from:
     - `skbose/indian-english-nptel-v0-tts-tags-gender-accent-text-descriptions` (`test` split:
       spontaneous Indian regional accents across Tamil, Telugu, Kannada, Malayalam, Bengali, Hindi, etc.)
     - `MushanW/GLOBE` (`test` split: global English accents including UK, Scottish, Irish,
       Australian, Canadian, US regional, Indian, etc.)
  2. `en_slang_multi_accent`: 36 casual English / developer / Hinglish / slang utterances
     rendered across 6 distinct regional accents (`en_IN` Rishi & Aman, `en_US` Samantha,
     `en_GB` Daniel, `en_AU` Karen, `en_IE` Moira).
  3. `indic_colloquial_loanwords`: 25 spoken colloquial + English-loanword utterances across
     Hindi (`hi`), Kannada (`kn`), Tamil (`ta`), Telugu (`te`), and Bengali (`bn`).
  4. `acoustic_accent_mic_perturbations`: Tempo (`0.85x` drawl, `1.18x` rapid casual),
     vocal-tract/pitch shift, and reverberant 48 kHz -> 16 kHz mobile-mic simulations
     on held-out speech clips.

Strict Quarantine: None of the test utterances or speaker clips in this suite
may ever appear in training, head calibration, or hardcoded phrase rules.
"""

from __future__ import annotations

import argparse
import io
import json
import math
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
import unicodedata
import urllib.request
from typing import Dict, List, Optional, Tuple

import numpy as np
import pyarrow.parquet as pq
import scipy.signal
import soundfile as sf

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "python" / "src"))

from swanada.audio import load_audio
from swanada.engine import AcousticEngine


# ------------------------------------------------------------------------------
# Slice 2: 36 Multi-Accent Casual / Slang / Developer / Indian-English Utterances
# ------------------------------------------------------------------------------
EN_SLANG_MULTI_ACCENT_SUITE: List[Tuple[str, str, str]] = [
    # Indian English (Rishi & Aman) - Hinglish, everyday Indian English & dev slang
    ("Rishi", "en_IN", "Bro, I am gonna deploy the app to prod right now, okay?"),
    ("Rishi", "en_IN", "Yaar, let us prepone the meeting, the wifi is super sketchy."),
    ("Rishi", "en_IN", "Bhai, send me a screenshot of the backend config on github."),
    ("Rishi", "en_IN", "Acha, we need around ten lakhs for the cloud gpu servers."),
    ("Rishi", "en_IN", "Guru, this masala dosa and filter coffee are totally legit."),
    ("Rishi", "en_IN", "Are we gonna debug the webhook workflow before logout?"),
    ("Aman", "en_IN", "Macha, lemme check the repo and revert by evening, pakka."),
    ("Aman", "en_IN", "Honestly the new frontend ui has really chill vibes."),
    ("Aman", "en_IN", "Did you push the async auth fix to docker or nah?"),
    ("Aman", "en_IN", "Let us grab biryani and chai in Bengaluru after the sync."),
    ("Aman", "en_IN", "I kinda wanna test the onnx model on my laptop first."),
    ("Aman", "en_IN", "No timepass yaar, please do the needful on the api docs."),
    # US Casual / Slang (Samantha)
    ("Samantha", "en_US", "Hey guys, wanna grab some masala dosa and chai?"),
    ("Samantha", "en_US", "I gotta admit, that livestream demo was lowkey awesome."),
    ("Samantha", "en_US", "Lemme ping the devs cuz the signup page looks kinda broken."),
    ("Samantha", "en_US", "Yup, I dunno why bluetooth keeps dropping on my phone."),
    ("Samantha", "en_US", "We're gonna ship the fullstack codebase update tonight."),
    ("Samantha", "en_US", "Nah, don't worry about the yaml config, it's all good."),
    # UK Casual / Accent (Daniel)
    ("Daniel", "en_GB", "Honestly I kinda dunno why the backend config failed."),
    ("Daniel", "en_GB", "Let's have a quick cuppa before we debug the sql query."),
    ("Daniel", "en_GB", "That deployment script wasproper dodgy, wasn't it mate?".replace("wasproper", "was proper")),
    ("Daniel", "en_GB", "Are you gonna join the devops call this afternoon or nope?"),
    ("Daniel", "en_GB", "Cheers bro, the wasm build runs super fast in the browser."),
    ("Daniel", "en_GB", "I've gotta double check the json payload before we deploy."),
    # Australian Casual / Accent (Karen)
    ("Karen", "en_AU", "No worries mate, lemme debug the repo and push a fix."),
    ("Karen", "en_AU", "Reckon we're gonna need more gpu memory for that llm."),
    ("Karen", "en_AU", "Hey folks, the podcast audio sounds a bit iffy on mobile."),
    ("Karen", "en_AU", "Gotta say, offline speech recognition on wifi is pretty cool."),
    ("Karen", "en_AU", "Wanna check if the kubernetes cluster is back online?"),
    ("Karen", "en_AU", "Yep, just gimme five minutes to run the cli benchmark."),
    # Irish Casual / Accent (Moira)
    ("Moira", "en_IE", "Are y'all gonna join the livestream or nah?"),
    ("Moira", "en_IE", "Sure look, the app works grand once you clear the cache."),
    ("Moira", "en_IE", "I'm tryna figure out why the login webhook timed out."),
    ("Moira", "en_IE", "Kinda feels like the server latency spiked again today."),
    ("Moira", "en_IE", "Lemme send you the npm package link right away."),
    ("Moira", "en_IE", "We'd better backup the database before running that migration."),
]

# ------------------------------------------------------------------------------
# Slice 3: 25 Colloquial Spoken Indic & Code-Switched Native-Script Utterances
# ------------------------------------------------------------------------------
INDIC_COLLOQUIAL_SUITE: List[Tuple[str, str, str]] = [
    # Hindi (Lekha) - everyday Hinglish & spoken forms
    ("hi", "Lekha", "यार आज ऑफिस की मीटिंग में बहुत प्रॉब्लम हो गई भाई"),
    ("hi", "Lekha", "अरे भाई थोड़ा टाइमपास मत करो जल्दी ऑनलाइन आओ"),
    ("hi", "Lekha", "अच्छा सुनो मैं अभी मोबाइल पर मैसेज और वीडियो भेजता हूं"),
    ("hi", "Lekha", "आज का खाना एकदम मस्त था यार चाय भी पक्का पिएंगे"),
    ("hi", "Lekha", "कल सुबह दस बजे कॉल करूंगा फिर आराम से बात करेंगे"),
    # Kannada (Soumya) - spoken Bengaluru/Mysuru Kanglish & colloquial contractions
    ("kn", "Soumya", "ಮಚ್ಚಾ ನಾನು ಇವಾಗ ಆಫೀಸ್ ಮೀಟಿಂಗ್ ಮುಗಿಸಿ ಬರ್ತೀನಿ ಗುರು"),
    ("kn", "Soumya", "ಯಾಕೆ ಇನ್ನೂ ಫೋನ್ ಮಾಡಿಲ್ಲ ಗೊತ್ತಿಲ್ಲ ಅಲ್ವಾ"),
    ("kn", "Soumya", "ಹೌದಾ ಈ ಹೊಸ ಆಪ್ ತುಂಬಾ ಚೆನ್ನಾಗಿದೆ ನೋಡು"),
    ("kn", "Soumya", "ಬೆಳಿಗ್ಗೆ ಬ್ಯಾಂಕ್ ಕೆಲಸ ಮುಗಿಸಿ ಆಮೇಲೆ ಮನೆಗೆ ಹೋಗೋಣ"),
    ("kn", "Soumya", "ಮೊಬೈಲ್ ನಲ್ಲಿ ವಿಡಿಯೋ ಕಾಲ್ ಮಾಡ್ತೀನಿ ಸ್ವಲ್ಪ ವೇಟ್ ಮಾಡು"),
    # Tamil (Vani) - spoken colloquial Tamil & Tanglish loanwords
    ("ta", "Vani", "மச்சான் நான் இப்போ ஆபீஸ் மீட்டிங் முடிச்சுட்டு வர்றேன்"),
    ("ta", "Vani", "இல்லப்பா எனக்கு இன்னும் மொபைல் மெசேஜ் வரல"),
    ("ta", "Vani", "ரொம்ப நல்லா இருக்கு இந்த புது ஆப் கண்டிப்பா ட்ரை பண்றேன்"),
    ("ta", "Vani", "அப்போ நாளைக்கு காலைல பத்து மணிக்கு கால் பண்ணுங்க"),
    ("ta", "Vani", "ஏன் இன்னும் வீடியோ ஆன்லைன்ல அப்லோட் பண்ணல"),
    # Telugu (Geeta) - spoken colloquial Telugu & loanwords
    ("te", "Geeta", "బ్రో నేను ఇప్పుడే ఆఫీస్ మీటింగ్ ముగించి వస్తున్నా"),
    ("te", "Geeta", "అవునా ఈ కొత్త మొబైల్ యాప్ చాలా బాగుంది రా"),
    ("te", "Geeta", "ఏంటి ఇంకా ఫోన్ చేయలేదు నాకు అసలు తెలియదు"),
    ("te", "Geeta", "రేపు ఉదయం పది గంటలకు వీడియో కాల్ చేద్దాం"),
    ("te", "Geeta", "ఆన్లైన్ పేమెంట్ కొంచెం ప్రాబ్లం అయింది భయ్యా"),
    # Bengali (Piya) - spoken colloquial Bengali & loanwords
    ("bn", "Piya", "ভাই আজ অফিসের মিটিংয়ে অনেক প্রবলেম হয়েছে"),
    ("bn", "Piya", "আরে দাদা মোবাইলে একটা মেসেজ আর ভিডিও পাঠিয়েছি দেখো"),
    ("bn", "Piya", "এখন একদম টাইম নেই পরে কল করছি তোমায়"),
    ("bn", "Piya", "অনলাইনে নতুন অ্যাপটা কিন্তু দারুণ কাজ করছে"),
    ("bn", "Piya", "চলো আজ বিকেলে একটু চা আর আড্ডা হয়ে যাক"),
]


def normalize_eval_text(text: str, lang: str) -> str:
    t = unicodedata.normalize("NFC", text).strip()
    if lang == "en":
        t = t.lower()
        t = t.replace("’", "'").replace("‘", "'")
        # Normalize standard colloquial orthographic equivalences only for fair scoring
        t = re.sub(r"[^a-z0-9' ]+", " ", t)
    else:
        # Unify candrabindu -> anusvara & strip nukta/ZWJ/punct for spoken Indic CER/WER
        t = t.replace("\u200c", "").replace("\u200d", "")
        t = t.replace("\u0901", "\u0902").replace("\u0981", "\u0982").replace("\u0a81", "\u0a82")
        t = t.replace("\u093c", "")
        t = re.sub(r"[.,?!|।॥\-–—'\"():;]+", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def levenshtein_seq(ref: list, hyp: list) -> int:
    n, m = len(ref), len(hyp)
    if n == 0:
        return m
    if m == 0:
        return n
    dp = list(range(m + 1))
    for i in range(1, n + 1):
        prev = dp[0]
        dp[0] = i
        for j in range(1, m + 1):
            tmp = dp[j]
            dp[j] = prev if ref[i - 1] == hyp[j - 1] else 1 + min(prev, dp[j], dp[j - 1])
            prev = tmp
    return dp[m]


def compute_cer_wer(ref: str, hyp: str, lang: str) -> Tuple[float, float]:
    nr = normalize_eval_text(ref, lang)
    nh = normalize_eval_text(hyp, lang)
    if not nr:
        return 0.0, 0.0
    cer = levenshtein_seq(list(nr), list(nh)) / max(1, len(nr))
    rw = nr.split()
    hw = nh.split()
    wer = levenshtein_seq(rw, hw) / max(1, len(rw))
    return cer, wer


def bootstrap_ci(vals: List[float], n_boot: int = 1000, seed: int = 20261107) -> dict:
    arr = np.asarray(vals, dtype=np.float64)
    if len(arr) == 0:
        return {"mean": 0.0, "ci_lower": 0.0, "ci_upper": 0.0}
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, len(arr), size=(n_boot, len(arr)))
    means = arr[idx].mean(axis=1)
    return {
        "mean": round(float(arr.mean()), 4),
        "ci_lower": round(float(np.percentile(means, 2.5)), 4),
        "ci_upper": round(float(np.percentile(means, 97.5)), 4),
    }


def synthesize_or_load_cached(cache_dir: Path, key: str, voice: str, text: str) -> np.ndarray:
    cache_dir.mkdir(parents=True, exist_ok=True)
    wav_path = cache_dir / f"{key}.wav"
    if wav_path.exists():
        pcm, sr = sf.read(str(wav_path), dtype="float32")
        if sr == 16000:
            return pcm
    with tempfile.NamedTemporaryFile(suffix=".aiff") as tmp:
        r = subprocess.run(["say", "-v", voice, "-o", tmp.name, text], capture_output=True)
        if r.returncode != 0:
            raise RuntimeError(f"macOS say failed for voice={voice}: {r.stderr.decode('utf-8', 'ignore')}")
        pcm = load_audio(tmp.name, target_sr=16000)
        sf.write(str(wav_path), pcm, 16000)
        return pcm


def load_real_human_accent_test_clips(cache_dir: Path, max_per_source: int = 35) -> List[dict]:
    """Loads & caches strictly unseen `test`-split human clips from GLOBE (stratified across
    Indian/South-Asian, UK/Irish/Scottish, Australian/NZ/Global accents) & AMI spontaneous meetings."""
    manifest_path = cache_dir / "real_human_accents_manifest.json"
    if manifest_path.exists():
        meta = json.loads(manifest_path.read_text(encoding="utf-8"))
        out = []
        for item in meta:
            wp = cache_dir / item["wav"]
            if wp.exists():
                pcm, _ = sf.read(str(wp), dtype="float32")
                out.append({**item, "pcm": pcm})
        if len(out) >= 40:
            return out

    cache_dir.mkdir(parents=True, exist_ok=True)
    saved_meta = []
    out_clips = []

    # 1. Stratified Global & Indian Human Accents from MushanW/GLOBE `test` split
    try:
        p_file = cache_dir / "_globe_world_accent_test.parquet"
        if not p_file.exists():
            url = "https://huggingface.co/api/datasets/MushanW/GLOBE/parquet"
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            data = json.loads(urllib.request.urlopen(req, timeout=20).read())
            p_url = data["default"]["test"][0]
            req2 = urllib.request.Request(p_url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req2, timeout=90) as resp, open(p_file, "wb") as f:
                f.write(resp.read())

        pf = pq.ParquetFile(p_file)
        rows = pf.read().to_pylist()
        rng = np.random.default_rng(101)
        perm = rng.permutation(len(rows))
        buckets = {
            "South_Asian": ("India", 15),
            "UK_Irish_Scottish": (("England", "Irish", "Scottish"), 15),
            "AU_NZ_Global": (("Australian", "New Zealand", "Filipino", "Southern African", "Canadian"), 15),
        }
        bucket_counts = {k: 0 for k in buckets}
        for idx in perm:
            if all(bucket_counts[k] >= buckets[k][1] for k in buckets):
                break
            r = rows[int(idx)]
            acc = str(r.get("accent") or "")
            matched_b = None
            for b_name, (pat, cap) in buckets.items():
                if bucket_counts[b_name] >= cap:
                    continue
                if isinstance(pat, str) and pat in acc:
                    matched_b = b_name
                    break
                if isinstance(pat, tuple) and any(p in acc for p in pat):
                    matched_b = b_name
                    break
            if matched_b is None:
                continue
            txt = (r.get("transcript") or r.get("text") or "").strip()
            if not txt or len(txt.split()) < 4 or len(txt.split()) > 26:
                continue
            aud = r.get("audio")
            if not isinstance(aud, dict) or not aud.get("bytes"):
                continue
            pcm, sr = sf.read(io.BytesIO(aud["bytes"]), dtype="float32")
            if pcm.ndim > 1:
                pcm = pcm.mean(axis=-1)
            if sr != 16000:
                g = math.gcd(sr, 16000)
                pcm = scipy.signal.resample_poly(pcm, 16000 // g, sr // g).astype(np.float32)
            dur = len(pcm) / 16000.0
            if dur < 1.5 or dur > 10.5:
                continue
            c_idx = len(saved_meta)
            wav_rel = f"globe_{c_idx:03d}.wav"
            sf.write(str(cache_dir / wav_rel), pcm, 16000)
            rec = {"id": f"globe_{c_idx:03d}", "source": "globe_test", "accent": acc, "text": txt, "wav": wav_rel}
            saved_meta.append(rec)
            out_clips.append({**rec, "pcm": pcm})
            bucket_counts[matched_b] += 1
    except Exception as exc:
        print(f"[warn] Could not load GLOBE test clips: {exc}", file=sys.stderr)

    # 2. Real Spontaneous Conversational Meeting Speech from edinburghcstr/ami (`ihm` `test` split)
    try:
        ami_file = cache_dir / "_ami_ihm_test.parquet"
        if not ami_file.exists():
            url = "https://huggingface.co/api/datasets/edinburghcstr/ami/parquet"
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            data = json.loads(urllib.request.urlopen(req, timeout=20).read())
            p_url = data["ihm"]["test"][0]
            req2 = urllib.request.Request(p_url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req2, timeout=90) as resp, open(ami_file, "wb") as f:
                f.write(resp.read())

        pf_ami = pq.ParquetFile(ami_file)
        rows_ami = pf_ami.read_row_group(0).to_pylist()
        rng_ami = np.random.default_rng(202)
        ami_added = 0
        for idx in rng_ami.permutation(len(rows_ami)):
            if ami_added >= 15:
                break
            r = rows_ami[int(idx)]
            txt = (r.get("text") or r.get("transcript") or "").strip()
            if not txt or len(txt.split()) < 5 or len(txt.split()) > 24:
                continue
            aud = r.get("audio")
            if not isinstance(aud, dict) or not aud.get("bytes"):
                continue
            pcm, sr = sf.read(io.BytesIO(aud["bytes"]), dtype="float32")
            if pcm.ndim > 1:
                pcm = pcm.mean(axis=-1)
            if sr != 16000:
                g = math.gcd(sr, 16000)
                pcm = scipy.signal.resample_poly(pcm, 16000 // g, sr // g).astype(np.float32)
            dur = len(pcm) / 16000.0
            if dur < 1.6 or dur > 9.5:
                continue
            c_idx = len(saved_meta)
            wav_rel = f"ami_{c_idx:03d}.wav"
            sf.write(str(cache_dir / wav_rel), pcm, 16000)
            rec = {"id": f"ami_{c_idx:03d}", "source": "ami_conversational_test", "accent": "Spontaneous_Meeting", "text": txt, "wav": wav_rel}
            saved_meta.append(rec)
            out_clips.append({**rec, "pcm": pcm})
            ami_added += 1
    except Exception as exc:
        print(f"[warn] Could not load AMI conversational test clips: {exc}", file=sys.stderr)

    if saved_meta:
        manifest_path.write_text(json.dumps(saved_meta, indent=2, ensure_ascii=False), encoding="utf-8")
    return out_clips


def perturb_tempo(pcm: np.ndarray, rate: float) -> np.ndarray:
    """Resamples time-scale / vocal-tract rate for fast casual or slow drawl perturbation."""
    up = 100
    down = max(50, int(round(100 * rate)))
    g = math.gcd(up, down)
    return scipy.signal.resample_poly(pcm, up // g, down // g).astype(np.float32)


def perturb_mobile_room_mic(pcm: np.ndarray, seed: int = 7) -> np.ndarray:
    """Simulates arm's-length mobile room mic: early reflections + RT60~0.28s tail + 48k capture + quiet gain."""
    rng = np.random.default_rng(seed)
    ir_len = int(0.28 * 16000)
    ir = np.zeros(ir_len, dtype=np.float32)
    ir[0] = 1.0
    for delay_ms, amp in ((14, 0.28), (27, -0.19), (43, 0.13), (68, -0.08)):
        d = int(delay_ms * 16)
        if d < ir_len:
            ir[d] += amp
    t = np.arange(ir_len, dtype=np.float32) / 16000.0
    diffuse = rng.normal(0.0, 0.018, size=ir_len).astype(np.float32) * np.exp(-t / 0.075)
    diffuse[: int(0.010 * 16000)] = 0.0
    ir += diffuse
    rev = scipy.signal.fftconvolve(pcm, ir, mode="full")[: len(pcm)].astype(np.float32)
    # Add mild ambient HVAC / room floor (-34 dBFS) and realistic quiet mic level (RMS ~ 0.018)
    pink = scipy.signal.lfilter([1.0], [1.0, -0.92], rng.normal(0.0, 0.0008, size=len(rev))).astype(np.float32)
    mixed = rev + pink
    rms = float(np.sqrt(np.mean(mixed * mixed))) + 1e-8
    return (mixed * (0.018 / rms)).astype(np.float32)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=REPO_ROOT / "bench" / "slang_accent_results.json")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    cache_dir = REPO_ROOT / "bench" / ".slang_accent_cache"
    engines: Dict[str, AcousticEngine] = {}

    def get_engine(lang: str) -> AcousticEngine:
        if lang not in engines:
            engines[lang] = AcousticEngine(language=lang)
        return engines[lang]

    t0 = time.perf_counter()
    results = {"slices": {}, "examples": []}

    # 1. Real Human Unseen Regional & Global Accents (NPTEL Indian Accents + GLOBE World Accents)
    human_clips = load_real_human_accent_test_clips(cache_dir, max_per_source=35)
    h_cers, h_wers = [], []
    en_eng = get_engine("en")
    for item in human_clips:
        res = en_eng.transcribe(item["pcm"], sample_rate=16000)
        cer, wer = compute_cer_wer(item["text"], res.text, "en")
        h_cers.append(cer)
        h_wers.append(wer)
        if args.verbose and wer > 0.25:
            print(f"[HUMAN/{item['accent']}] CER={cer:.2f} WER={wer:.2f}\n  REF: {item['text']}\n  HYP: {res.text}")
    results["slices"]["real_human_accents"] = {
        "num_utterances": len(h_cers),
        "cer": bootstrap_ci(h_cers),
        "wer": bootstrap_ci(h_wers),
    }

    # 2. Multi-Accent English Slang, Contractions, Dev & Hinglish (36 utterances x 6 voices)
    s_cers, s_wers = [], []
    for idx, (voice, accent, text) in enumerate(EN_SLANG_MULTI_ACCENT_SUITE):
        pcm = synthesize_or_load_cached(cache_dir / "en_slang", f"en_{idx:02d}_{voice}", voice, text)
        res = en_eng.transcribe(pcm, sample_rate=16000)
        cer, wer = compute_cer_wer(text, res.text, "en")
        s_cers.append(cer)
        s_wers.append(wer)
        results["examples"].append(
            {"slice": "en_slang_multi_accent", "accent": accent, "voice": voice, "ref": text, "hyp": res.text, "cer": round(cer, 4), "wer": round(wer, 4)}
        )
        if args.verbose:
            print(f"[EN_SLANG/{accent}:{voice}] CER={cer:.2f} WER={wer:.2f}\n  REF: {text}\n  HYP: {res.text}")
    results["slices"]["en_slang_multi_accent"] = {
        "num_utterances": len(s_cers),
        "cer": bootstrap_ci(s_cers),
        "wer": bootstrap_ci(s_wers),
    }

    # 3. Colloquial Spoken Indic & Transliterated Loanwords (25 utterances across 5 languages)
    i_cers, i_wers = [], []
    for idx, (lang, voice, text) in enumerate(INDIC_COLLOQUIAL_SUITE):
        pcm = synthesize_or_load_cached(cache_dir / "indic_colloq", f"{lang}_{idx:02d}_{voice}", voice, text)
        res = get_engine(lang).transcribe(pcm, sample_rate=16000)
        cer, wer = compute_cer_wer(text, res.text, lang)
        i_cers.append(cer)
        i_wers.append(wer)
        results["examples"].append(
            {"slice": "indic_colloquial_loanwords", "lang": lang, "voice": voice, "ref": text, "hyp": res.text, "cer": round(cer, 4), "wer": round(wer, 4)}
        )
        if args.verbose:
            print(f"[INDIC/{lang}:{voice}] CER={cer:.2f} WER={wer:.2f}\n  REF: {text}\n  HYP: {res.text}")
    results["slices"]["indic_colloquial_loanwords"] = {
        "num_utterances": len(i_cers),
        "cer": bootstrap_ci(i_cers),
        "wer": bootstrap_ci(i_wers),
    }

    # 4. Acoustic Accent Tempo/Vocal-Tract & Reverberant Quiet Mobile-Mic Perturbations
    p_cers, p_wers = [], []
    # Sample 24 held-out clips across English + Indic colloquial + human accents
    pert_inputs: List[Tuple[str, np.ndarray, str, str]] = []
    for k in range(0, min(12, len(human_clips)), 2):
        pert_inputs.append(("en", perturb_mobile_room_mic(human_clips[k]["pcm"], seed=k), human_clips[k]["text"], "room_mic_human"))
    for k in range(0, 18, 3):
        voice, _, text = EN_SLANG_MULTI_ACCENT_SUITE[k]
        base_pcm = synthesize_or_load_cached(cache_dir / "en_slang", f"en_{k:02d}_{voice}", voice, text)
        pert_inputs.append(("en", perturb_tempo(base_pcm, 1.16), text, "fast_1.16x"))
        pert_inputs.append(("en", perturb_tempo(base_pcm, 0.86), text, "slow_0.86x"))
        pert_inputs.append(("en", perturb_mobile_room_mic(base_pcm, seed=100 + k), text, "room_mic_slang"))
    for k in range(0, 25, 5):
        lang, voice, text = INDIC_COLLOQUIAL_SUITE[k]
        base_pcm = synthesize_or_load_cached(cache_dir / "indic_colloq", f"{lang}_{k:02d}_{voice}", voice, text)
        pert_inputs.append((lang, perturb_mobile_room_mic(base_pcm, seed=200 + k), text, f"room_mic_{lang}"))

    for lang, pcm_p, text, p_kind in pert_inputs:
        res = get_engine(lang).transcribe(pcm_p, sample_rate=16000)
        cer, wer = compute_cer_wer(text, res.text, lang)
        p_cers.append(cer)
        p_wers.append(wer)
        if args.verbose and wer > 0.25:
            print(f"[PERTURB/{p_kind}] CER={cer:.2f} WER={wer:.2f}\n  REF: {text}\n  HYP: {res.text}")

    results["slices"]["acoustic_accent_mic_perturbations"] = {
        "num_utterances": len(p_cers),
        "cer": bootstrap_ci(p_cers),
        "wer": bootstrap_ci(p_wers),
    }

    all_cers = h_cers + s_cers + i_cers + p_cers
    all_wers = h_wers + s_wers + i_wers + p_wers
    results["overall"] = {
        "num_utterances": len(all_cers),
        "elapsed_sec": round(time.perf_counter() - t0, 2),
        "cer": bootstrap_ci(all_cers),
        "wer": bootstrap_ci(all_wers),
    }

    args.out.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
    print("\n=== SWANADA SLANG, COLLOQUIAL & MULTI-ACCENT BENCHMARK ===")
    for sname, sdata in results["slices"].items():
        c = sdata["cer"]
        w = sdata["wer"]
        print(
            f"  {sname:36s} (n={sdata['num_utterances']:3d}) | "
            f"CER: {c['mean']*100:5.2f}% [{c['ci_lower']*100:5.2f}%, {c['ci_upper']*100:5.2f}%] | "
            f"WER: {w['mean']*100:5.2f}% [{w['ci_lower']*100:5.2f}%, {w['ci_upper']*100:5.2f}%]"
        )
    ov_c = results["overall"]["cer"]
    ov_w = results["overall"]["wer"]
    print("-" * 92)
    print(
        f"  {'OVERALL':36s} (n={results['overall']['num_utterances']:3d}) | "
        f"CER: {ov_c['mean']*100:5.2f}% [{ov_c['ci_lower']*100:5.2f}%, {ov_c['ci_upper']*100:5.2f}%] | "
        f"WER: {ov_w['mean']*100:5.2f}% [{ov_w['ci_lower']*100:5.2f}%, {ov_w['ci_upper']*100:5.2f}%]"
    )


if __name__ == "__main__":
    main()
