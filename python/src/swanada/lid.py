"""Zero-Overhead 12-Language Spoken Language Identification (Auto-LID) &
Frame-Synchronous Indic+English Code-Switching on Shared `layer_norm_84` Features.

Runs in < 1 ms directly on the Conformer encoder's `[T, 512]` `layer_norm_84`
tensor without loading any additional acoustic backbone. Supports both:
  1. Optional compact `lid.bin` (`SLID` v1, ~396 KiB) Attentive Statistics Pooling
     neural classifier trained on quantized `layer_norm_84` representations, and
  2. Multi-head CTC conditional acoustic certainty + native lexicon verification
     across all 12 `515 KiB` linear language heads (`sa, en, hi, kn, mr, bn, ta,
     te, ml, gu, pa, or`).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
import re
import struct
from typing import Dict, List, Optional, Sequence, Tuple, Union
import numpy as np

from .decoder import CTCDecodeResult, decode_ctc, is_special_token
from .en_lexicon import get_en_lexicon, is_en_word
from .indic_lexicon import get_indic_lexicon, score_indic_word
from .normalizer import normalize_indic_text

LID_LANGUAGES: Tuple[str, ...] = (
    "sa", "en", "hi", "kn", "mr", "bn", "ta", "te", "ml", "gu", "pa", "or"
)
SLID_MAGIC = b"SLID"
SLID_VERSION = 1

_HI_MARKERS = frozenset({
    "है", "हैं", "था", "थी", "थे", "में", "को", "का", "की", "के", "से", "पर",
    "और", "नहीं", "यह", "वह", "एक", "तो", "भी", "कर", "रहा", "रही", "रहे",
    "लिए", "किया", "गया", "गई", "अपने", "देखो", "कहा", "होता", "साहब", "मुझे", "हम",
})
_MR_MARKERS = frozenset({
    "आहे", "आहेत", "नाही", "मध्ये", "ला", "चा", "ची", "चे", "च्या", "वर",
    "आणि", "पण", "काय", "मला", "तुला", "होता", "होती", "होते", "आणखीही",
    "काही", "हो", "माझ्या", "तुमच्या", "केले", "झाले", "येथे", "आता",
})
_SA_MARKERS = frozenset({
    "च", "एव", "इति", "अपि", "अस्ति", "भवति", "तस्य", "अत्र", "तत्र", "यथा",
    "तथा", "अहं", "वयम्", "किम्", "येन", "तेन", "ददाति", "विषये", "देहस्य",
})

# Short English words that collide phonetically with common Indic syllables/particles
_CODEMIX_AMBIGUOUS_EN = frozenset({
    "a", "i", "am", "an", "as", "at", "be", "bi", "bo", "by", "da", "de", "di",
    "do", "ed", "eh", "el", "em", "en", "er", "es", "et", "ex", "fa", "go", "ha",
    "he", "hi", "hm", "ho", "id", "if", "in", "is", "it", "jo", "ka", "ki", "ko",
    "la", "li", "lo", "ma", "me", "mi", "mm", "mo", "mu", "my", "na", "ne", "no",
    "nu", "od", "oe", "of", "oh", "oi", "ok", "om", "on", "op", "or", "os", "ow",
    "ox", "oy", "pa", "pe", "pi", "po", "qi", "re", "sh", "si", "so", "ta", "te",
    "ti", "to", "uh", "um", "un", "up", "us", "ut", "we", "wo", "xi", "xu", "ya",
    "ye", "yo", "the", "and", "are", "too", "see", "haa", "tum", "hum", "hai",
    "ho", "kar", "par", "aur", "ek", "ko", "ki", "ka", "ke", "se", "ne", "naa",
})

_EN_VOWELS_RE = re.compile(r"[aeiouy]")
_EN_CLEAN_RE = re.compile(r"[^a-z']")


@dataclass
class LanguageDetectionResult:
    language: str
    confidence: float
    probabilities: Dict[str, float]
    used_neural_lid: bool = False


@dataclass
class CodeSwitchSpan:
    word: str
    start_char: int
    end_char: int


@dataclass
class CodeSwitchDecodeResult:
    text: str
    tokens: List[str]
    english_spans: List[CodeSwitchSpan] = field(default_factory=list)


@dataclass
class NeuralLIDWeights:
    d_in: int
    d_att: int
    d_hid: int
    languages: Tuple[str, ...]
    w_att: np.ndarray     # [d_in, d_att]
    b_att: np.ndarray     # [d_att]
    v_att: np.ndarray     # [d_att]
    ln_gamma: np.ndarray  # [2 * d_in]
    ln_beta: np.ndarray   # [2 * d_in]
    w_fc1: np.ndarray     # [2 * d_in, d_hid]
    b_fc1: np.ndarray     # [d_hid]
    w_fc2: np.ndarray     # [d_hid, n_langs]
    b_fc2: np.ndarray     # [n_langs]
    temperature: float = 1.0

    def predict_log_probs(self, hidden: np.ndarray) -> Dict[str, float]:
        h = np.asarray(hidden, dtype=np.float32)
        if h.ndim == 3:
            h = h[0]
        if h.shape[0] == 0:
            u = -np.log(float(len(self.languages)))
            return {lg: float(u) for lg in self.languages}

        norms = np.linalg.norm(h, axis=-1)
        peak_norm = float(np.max(norms)) if norms.size > 0 else 0.0
        active = norms >= (0.25 * peak_norm) if peak_norm > 1e-6 else np.ones(h.shape[0], dtype=bool)
        if not np.any(active):
            active = np.ones(h.shape[0], dtype=bool)

        att_raw = np.tanh(h @ self.w_att + self.b_att) @ self.v_att
        att_masked = np.where(active, att_raw, -1.0e9)
        att_shift = att_masked - np.max(att_masked)
        alpha = np.exp(att_shift)
        alpha_sum = float(np.sum(alpha))
        if alpha_sum <= 0.0 or not np.isfinite(alpha_sum):
            alpha = np.full(h.shape[0], 1.0 / h.shape[0], dtype=np.float32)
        else:
            alpha = (alpha / alpha_sum).astype(np.float32)

        mu = alpha @ h  # [d_in]
        diff = h - mu[None, :]
        var = alpha @ (diff * diff)
        sigma = np.sqrt(np.maximum(var, 1.0e-5))
        stats = np.concatenate([mu, sigma], axis=0)  # [2 * d_in]

        s_mean = float(np.mean(stats))
        s_var = float(np.mean((stats - s_mean) ** 2))
        s_ln = ((stats - s_mean) / np.sqrt(s_var + 1.0e-5)) * self.ln_gamma + self.ln_beta

        # Approximate GELU matching PyTorch tanh approximation
        x1 = s_ln @ self.w_fc1 + self.b_fc1
        gelu = 0.5 * x1 * (1.0 + np.tanh(0.7978845608 * (x1 + 0.044715 * (x1 ** 3))))
        logits = (gelu @ self.w_fc2 + self.b_fc2) / max(self.temperature, 0.05)

        l_max = float(np.max(logits))
        log_z = l_max + float(np.log(np.sum(np.exp(logits - l_max))))
        log_p = logits - log_z
        return {lg: float(log_p[i]) for i, lg in enumerate(self.languages)}


def parse_lid_head_bytes(raw: bytes) -> NeuralLIDWeights:
    """Parses compact `lid.bin` (`SLID` v1) binary weights."""
    if len(raw) < 24 or raw[:4] != SLID_MAGIC:
        raise ValueError("Invalid lid.bin header: expected magic b'SLID'")
    version, d_in, d_att, d_hid, n_langs = struct.unpack("<5I", raw[4:24])
    if version != SLID_VERSION or n_langs != len(LID_LANGUAGES):
        raise ValueError(f"Unsupported lid.bin version={version} or n_langs={n_langs}")

    d_stats = 2 * d_in
    counts = [
        d_in * d_att,
        d_att,
        d_att,
        d_stats,
        d_stats,
        d_stats * d_hid,
        d_hid,
        d_hid * n_langs,
        n_langs,
        1,
    ]
    expected_bytes = 24 + sum(counts) * 4
    if len(raw) < expected_bytes:
        raise ValueError(f"Truncated lid.bin: got {len(raw)} bytes, expected {expected_bytes}")

    arr = np.frombuffer(raw[24:expected_bytes], dtype="<f4").astype(np.float32, copy=True)
    pos = 0

    def take(shape: Tuple[int, ...]) -> np.ndarray:
        nonlocal pos
        n = 1
        for s in shape:
            n *= s
        out = arr[pos : pos + n].reshape(shape)
        pos += n
        return out

    w_att = take((d_in, d_att))
    b_att = take((d_att,))
    v_att = take((d_att,))
    ln_gamma = take((d_stats,))
    ln_beta = take((d_stats,))
    w_fc1 = take((d_stats, d_hid))
    b_fc1 = take((d_hid,))
    w_fc2 = take((d_hid, n_langs))
    b_fc2 = take((n_langs,))
    temp = float(take((1,))[0])
    return NeuralLIDWeights(
        d_in=d_in,
        d_att=d_att,
        d_hid=d_hid,
        languages=LID_LANGUAGES,
        w_att=w_att,
        b_att=b_att,
        v_att=v_att,
        ln_gamma=ln_gamma,
        ln_beta=ln_beta,
        w_fc1=w_fc1,
        b_fc1=b_fc1,
        w_fc2=w_fc2,
        b_fc2=b_fc2,
        temperature=temp,
    )


def serialize_lid_head_bytes(weights: NeuralLIDWeights) -> bytes:
    """Serializes `NeuralLIDWeights` into deterministic `lid.bin` (`SLID` v1) bytes."""
    header = SLID_MAGIC + struct.pack(
        "<5I",
        SLID_VERSION,
        weights.d_in,
        weights.d_att,
        weights.d_hid,
        len(weights.languages),
    )
    parts = [
        np.ascontiguousarray(weights.w_att, dtype="<f4").ravel(),
        np.ascontiguousarray(weights.b_att, dtype="<f4").ravel(),
        np.ascontiguousarray(weights.v_att, dtype="<f4").ravel(),
        np.ascontiguousarray(weights.ln_gamma, dtype="<f4").ravel(),
        np.ascontiguousarray(weights.ln_beta, dtype="<f4").ravel(),
        np.ascontiguousarray(weights.w_fc1, dtype="<f4").ravel(),
        np.ascontiguousarray(weights.b_fc1, dtype="<f4").ravel(),
        np.ascontiguousarray(weights.w_fc2, dtype="<f4").ravel(),
        np.ascontiguousarray(weights.b_fc2, dtype="<f4").ravel(),
        np.asarray([weights.temperature], dtype="<f4"),
    ]
    return header + np.concatenate(parts).tobytes()


def load_lid_head(path: Union[str, Path]) -> NeuralLIDWeights:
    return parse_lid_head_bytes(Path(path).read_bytes())


def _greedy_collapse_text(argmax_ids: np.ndarray, vocab: Sequence[str]) -> str:
    last_id = 0
    pieces: List[str] = []
    vlen = len(vocab)
    for raw_id in argmax_ids:
        idx = int(raw_id)
        if idx == 0:
            last_id = 0
            continue
        if idx == last_id:
            continue
        last_id = idx
        if 0 < idx < vlen:
            tok = vocab[idx]
            if tok and not is_special_token(tok):
                pieces.append(tok)
    return normalize_indic_text("".join(pieces))


def _score_lexical_plausibility(text: str, lang: str) -> float:
    words = [w for w in text.strip().split() if w]
    if not words:
        return -1.5

    if lang == "en":
        en_words, _ = get_en_lexicon()
        total_w = 0.0
        weighted_hits = 0.0
        for w in words:
            cw = _EN_CLEAN_RE.sub("", w.lower()).strip("'")
            if not cw:
                continue
            w_len = float(min(len(cw), 8))
            total_w += w_len
            if len(cw) >= 3 and is_en_word(cw, en_words):
                weighted_hits += w_len * 1.05
            elif len(cw) == 2 and is_en_word(cw, en_words):
                weighted_hits += w_len * 0.55
            elif cw in ("i", "a"):
                weighted_hits += 0.30
            else:
                has_v = bool(_EN_VOWELS_RE.search(cw))
                weighted_hits -= w_len * (0.55 if has_v else 1.10)
        if total_w <= 0.0:
            return -1.2
        return float(np.clip(weighted_hits / total_w, -1.2, 1.05))

    core_set, ext_set = get_indic_lexicon(lang)
    total_w = 0.0
    acc = 0.0
    for w in words:
        w_clean = w.strip("।॥,?!.'\"-")
        if not w_clean:
            continue
        c_len = float(min(len(w_clean), 8))
        total_w += c_len
        sc = score_indic_word(w_clean, lang, core_set, ext_set)
        acc += sc * (c_len / 4.0)

    base = (acc / max(total_w, 1.0)) * 2.2

    # Devanagari sibling disambiguation (`sa` vs `hi` vs `mr`)
    if lang in ("sa", "hi", "mr"):
        hi_hits = sum(1 for w in words if w in _HI_MARKERS)
        mr_hits = sum(1 for w in words if w in _MR_MARKERS) + text.count("\u0933")  # 'ळ'
        sa_hits = (
            sum(1 for w in words if w in _SA_MARKERS)
            + text.count("\u0903") * 2  # visarga 'ः'
            + text.count("\u093d") * 2  # avagraha 'ऽ'
            + sum(1 for w in words if w.endswith(("म्", "त्", "न्", "स्य", "णां", "नाम्", "ेषु")))
        )
        n_w = float(max(len(words), 1))
        if lang == "hi":
            base += 0.75 * (hi_hits / n_w) - 0.45 * ((mr_hits + sa_hits) / n_w)
        elif lang == "mr":
            base += 0.80 * (mr_hits / n_w) - 0.45 * ((hi_hits + sa_hits) / n_w)
        elif lang == "sa":
            base += 0.75 * (sa_hits / n_w) - 0.50 * ((hi_hits + mr_hits) / n_w)

    return float(np.clip(base, -1.2, 1.15))


def score_ctc_head_evidence(
    hidden: np.ndarray,
    weight: np.ndarray,
    bias: np.ndarray,
    vocab: Sequence[str],
    lang: str,
) -> Tuple[float, np.ndarray]:
    """Computes frame-conditional acoustic certainty + native lexical plausibility
    for a single language CTC head `[257, 512]` on `hidden` `[T, 512]`."""
    h = np.asarray(hidden, dtype=np.float32)
    if h.ndim == 3:
        h = h[0]
    w = weight.squeeze(-1) if weight.ndim == 3 else weight
    logits = h @ w.T + bias  # [T, 257]
    if logits.shape[0] == 0:
        return -10.0, logits

    max_l = np.max(logits, axis=-1, keepdims=True)
    log_z = max_l + np.log(np.sum(np.exp(logits - max_l), axis=-1, keepdims=True))
    log_p = logits - log_z  # [T, 257]

    p_blank = np.exp(log_p[:, 0])
    p_nb = np.clip(1.0 - p_blank, 1.0e-6, 1.0)
    mean_nb = float(np.mean(p_nb))

    active = p_nb > 0.20
    if int(np.sum(active)) < max(2, logits.shape[0] // 12):
        thresh = float(np.percentile(p_nb, 75))
        active = p_nb >= max(thresh, 1.0e-4)

    log_nb = np.log(p_nb[active])
    nb_log_p = log_p[active, 1:] - log_nb[:, None]  # conditional log P(c | c != blank)
    cond_peak = float(np.mean(np.max(nb_log_p, axis=-1)))  # in (-inf, 0]
    p_cond = np.exp(np.clip(nb_log_p, -30.0, 0.0))
    cond_neg_ent = float(np.mean(np.sum(p_cond * np.clip(nb_log_p, -30.0, 0.0), axis=-1)))  # in [-ln(256), 0]

    # Mild penalty when a head emits almost all blanks on real speech
    act_penalty = -1.5 * max(0.0, 0.06 - mean_nb) / 0.06 if mean_nb < 0.06 else 0.0

    argmax_ids = np.argmax(logits, axis=-1)
    greedy_txt = _greedy_collapse_text(argmax_ids, vocab)
    lex_sc = _score_lexical_plausibility(greedy_txt, lang)

    evidence = 1.35 * cond_peak + 0.45 * cond_neg_ent + 0.85 * lex_sc + act_penalty
    return float(evidence), logits


def detect_language_from_hidden(
    hidden: np.ndarray,
    heads: Dict[str, Tuple[np.ndarray, np.ndarray]],
    vocabs: Dict[str, Sequence[str]],
    lid_weights: Optional[NeuralLIDWeights] = None,
    candidate_languages: Optional[Sequence[str]] = None,
) -> Tuple[LanguageDetectionResult, Dict[str, np.ndarray]]:
    """Detects spoken language from shared `layer_norm_84` `[T, 512]` features and
    returns `(LanguageDetectionResult, cached_logits_by_lang)` so the winning
    language's CTC logits do not even need to be recomputed."""
    h = np.asarray(hidden, dtype=np.float32)
    if h.ndim == 3:
        h = h[0]

    avail = [
        lg for lg in (candidate_languages or LID_LANGUAGES)
        if lg in heads and lg in vocabs
    ]
    if not avail:
        return LanguageDetectionResult("sa", 1.0, {"sa": 1.0}, False), {}

    neural_lp: Optional[Dict[str, float]] = None
    eval_langs = list(avail)
    if lid_weights is not None:
        neural_lp = lid_weights.predict_log_probs(h)
        ranked_neural = sorted(avail, key=lambda lg: neural_lp.get(lg, -20.0), reverse=True)
        # Evaluate Top-8 neural candidates + always include 'en' for accent/code-mix safety
        shortlist = ranked_neural[: min(8, len(ranked_neural))]
        if "en" in avail and "en" not in shortlist:
            shortlist.append("en")
        eval_langs = shortlist

    ctc_scores: Dict[str, float] = {}
    cached_logits: Dict[str, np.ndarray] = {}
    for lg in eval_langs:
        w, b = heads[lg]
        ev, lg_mat = score_ctc_head_evidence(h, w, b, vocabs[lg], lg)
        ctc_scores[lg] = ev
        cached_logits[lg] = lg_mat

    combined: Dict[str, float] = {}
    if neural_lp is not None:
        min_ctc = min(ctc_scores.values()) if ctc_scores else -5.0
        for lg in avail:
            nlp = neural_lp.get(lg, -12.0)
            cev = ctc_scores.get(lg, min_ctc - 1.5)
            combined[lg] = 0.50 * nlp + 1.65 * cev
        temp = 0.65
    else:
        for lg in eval_langs:
            combined[lg] = ctc_scores[lg]
        temp = 0.28

    max_s = max(combined.values())
    exps = {lg: float(np.exp((sc - max_s) / temp)) for lg, sc in combined.items()}
    z = sum(exps.values()) or 1.0
    probs = {lg: exps[lg] / z for lg in avail}
    best_lang = max(probs.items(), key=lambda kv: kv[1])[0]
    return (
        LanguageDetectionResult(
            language=best_lang,
            confidence=float(probs[best_lang]),
            probabilities=probs,
            used_neural_lid=(neural_lp is not None),
        ),
        cached_logits,
    )


def _extract_ctc_word_spans(
    logits_2d: np.ndarray,
    vocab: Sequence[str],
) -> List[Tuple[str, int, int]]:
    """Extracts `(word_text, start_frame, end_frame)` spans from greedy/aligned CTC frames."""
    argmax_ids = np.argmax(logits_2d, axis=-1)
    vlen = len(vocab)
    words: List[Tuple[str, int, int]] = []
    cur_chars: List[str] = []
    cur_start: Optional[int] = None
    cur_end: int = 0
    last_id = 0

    for t, raw_id in enumerate(argmax_ids):
        idx = int(raw_id)
        if idx == 0:
            last_id = 0
            continue
        if idx == last_id:
            cur_end = t + 1
            continue
        last_id = idx
        if not (0 < idx < vlen):
            continue
        tok = vocab[idx]
        if not tok or is_special_token(tok):
            continue

        if tok.startswith("\u2581") or tok == " ":
            if cur_chars and cur_start is not None:
                w_txt = normalize_indic_text("".join(cur_chars)).strip()
                if w_txt:
                    words.append((w_txt, cur_start, max(cur_end, cur_start + 1)))
                cur_chars = []
                cur_start = None
            rest = tok.lstrip("\u2581 ")
            if rest:
                cur_chars.append(rest)
                cur_start = t
                cur_end = t + 1
        else:
            if cur_start is None:
                cur_start = t
            cur_chars.append(tok)
            cur_end = t + 1

    if cur_chars and cur_start is not None:
        w_txt = normalize_indic_text("".join(cur_chars)).strip()
        if w_txt:
            words.append((w_txt, cur_start, max(cur_end, cur_start + 1)))
    return words


def _span_conditional_certainty(logits_slice: np.ndarray) -> float:
    if logits_slice.shape[0] == 0:
        return -10.0
    max_l = np.max(logits_slice, axis=-1, keepdims=True)
    log_p = logits_slice - (max_l + np.log(np.sum(np.exp(logits_slice - max_l), axis=-1, keepdims=True)))
    p_nb = np.clip(1.0 - np.exp(log_p[:, 0]), 1.0e-6, 1.0)
    active = p_nb > 0.18
    if not np.any(active):
        return -5.0
    return float(np.mean(np.max(log_p[active, 1:], axis=-1)))


def decode_bilingual_codeswitch(
    logits_indic: np.ndarray,
    vocab_indic: Sequence[str],
    lang_indic: str,
    logits_en: np.ndarray,
    vocab_en: Sequence[str],
    is_partial: bool = False,
) -> CodeSwitchDecodeResult:
    """Decodes an Indic utterance while preserving genuinely English code-mixed words
    in Latin script (Shruti-style bilingual Indic + English transcription) using
    frame-synchronous comparison between `logits_indic` and `logits_en`."""
    lg_ind = logits_indic[0] if logits_indic.ndim == 3 else logits_indic
    lg_en = logits_en[0] if logits_en.ndim == 3 else logits_en
    base_res: CTCDecodeResult = decode_ctc(lg_ind, vocab=vocab_indic, is_partial=is_partial)
    if lang_indic == "en" or lg_ind.shape[0] < 4 or not base_res.text:
        return CodeSwitchDecodeResult(text=base_res.text, tokens=base_res.tokens, english_spans=[])

    spans = _extract_ctc_word_spans(lg_ind, vocab_indic)
    base_words = base_res.text.split()
    if not spans or len(spans) != len(base_words):
        return CodeSwitchDecodeResult(text=base_res.text, tokens=base_res.tokens, english_spans=[])

    core_set, ext_set = get_indic_lexicon(lang_indic)
    en_lex_words, _ = get_en_lexicon()
    total_frames = lg_ind.shape[0]
    out_words: List[str] = []
    en_spans: List[CodeSwitchSpan] = []
    cursor = 0

    for idx, (_, t0, t1) in enumerate(spans):
        w_ind = base_words[idx]
        chosen = w_ind
        is_en_swap = False

        # Voronoi-bounded acoustic window around spiky CTC emissions without crossing adjacent words
        prev_t1 = spans[idx - 1][2] if idx > 0 else 0
        next_t0 = spans[idx + 1][1] if (idx + 1) < len(spans) else total_frames
        s0 = max(prev_t1, t0 - 4)
        s1 = min(next_t0, t1 + 6)
        w_ind_clean = w_ind.strip("।॥,?!.'\"-")
        ind_lex_sc = score_indic_word(w_ind_clean, lang_indic, core_set, ext_set) if w_ind_clean else 0.0
        if (s1 - s0) >= 3 and ind_lex_sc <= 0.05:
            en_sub_res = decode_ctc(lg_en[s0:s1], vocab=vocab_en, is_partial=True)
            en_cand_raw = en_sub_res.text.strip().lower()
            en_words = [
                _EN_CLEAN_RE.sub("", u).strip("'")
                for u in en_cand_raw.split()
                if _EN_CLEAN_RE.sub("", u).strip("'")
            ]
            if (
                len(en_words) == 1
                and len(en_words[0]) >= 4
                and en_words[0] not in _CODEMIX_AMBIGUOUS_EN
                and is_en_word(en_words[0], en_lex_words)
                and bool(_EN_VOWELS_RE.search(en_words[0]))
            ):
                cert_ind = _span_conditional_certainty(lg_ind[s0:s1])
                cert_en = _span_conditional_certainty(lg_en[s0:s1])
                if cert_en >= cert_ind + 0.08 and cert_en > -0.85:
                    chosen = en_words[0]
                    is_en_swap = True

        if idx > 0:
            cursor += 1  # space
        start_c = cursor
        cursor += len(chosen)
        if is_en_swap:
            en_spans.append(CodeSwitchSpan(word=chosen, start_char=start_c, end_char=cursor))
        out_words.append(chosen)

    joined = " ".join(out_words)
    return CodeSwitchDecodeResult(text=joined, tokens=base_res.tokens, english_spans=en_spans)
