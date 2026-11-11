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

# English function words permitted inside multi-word English code-switched clauses
_EN_PHRASE_FUNC_WORDS = frozenset({
    "the", "was", "were", "are", "is", "am", "be", "been", "to", "of", "in",
    "on", "at", "for", "with", "from", "by", "and", "or", "but", "not", "this",
    "that", "these", "those", "my", "our", "your", "his", "her", "their", "its",
    "us", "we", "you", "they", "he", "she", "it", "can", "will", "just", "now",
    "new", "all", "out", "up", "let",
})

# High-specificity 3-letter English technical & everyday borrowings safe for standalone code-switching
_EN_SAFE_SHORT_WORDS = frozenset({
    "app", "api", "web", "net", "cpu", "gpu", "ram", "sql", "cli", "git", "sdk",
    "url", "pdf", "csv", "xml", "css", "aws", "gcp", "llm", "ios", "mac", "pro",
    "fix", "bug", "log", "run", "try", "add", "set", "get", "put", "job",
    "bus", "car", "cab", "gym", "tax", "fee", "pay", "buy", "win",
})

_INDIAN_EN_LOANWORD_FIXES: Dict[str, str] = {
    "mobil": "mobile",
    "mobal": "mobile",
    "vidio": "video",
    "vidyo": "video",
    "vait": "wait",
    "ofis": "office",
    "afis": "office",
    "afie": "office",
    "afice": "office",
    "ofice": "office",
    "meething": "meeting",
    "miting": "meeting",
    "diployment": "deployment",
    "prodakt": "product",
    "onlain": "online",
}


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


def _count_indic_syllables_and_virama(phrase: str) -> Tuple[int, bool]:
    w = phrase.strip()
    if not w:
        return 0, False
    cps = [ord(c) for c in w if not c.isspace()]
    if not cps:
        return 0, False
    ends_virama = (0x0900 <= cps[-1] <= 0x0D7F) and ((cps[-1] & 0x7F) == 0x4D)
    syl = 0
    n = len(cps)
    for i, cp in enumerate(cps):
        if not (0x0900 <= cp <= 0x0D7F):
            continue
        off = cp & 0x7F
        if 0x05 <= off <= 0x14:
            syl += 1
        elif 0x15 <= off <= 0x39:
            nxt_off = (cps[i + 1] & 0x7F) if (i + 1 < n and 0x0900 <= cps[i + 1] <= 0x0D7F) else -1
            if nxt_off != 0x4D:
                syl += 1
    return max(1, syl), ends_virama


def _count_en_syllables_and_coda(phrase: str) -> Tuple[int, bool]:
    words = [w for w in phrase.lower().split() if w]
    tot = 0
    for w in words:
        core = w[:-1] if (len(w) > 3 and w.endswith("e") and not w.endswith(("le", "ee", "ie"))) else w
        groups = re.findall(r"[aeiouy]+", core)
        tot += max(1, len(groups))
    last_w = words[-1] if words else ""
    ends_cons = bool(last_w) and last_w[-1] not in "aeiouy"
    if last_w.endswith("e") and len(last_w) > 3 and last_w[-2] not in "aeiouy":
        ends_cons = True
    return max(1, tot), ends_cons


def _canonical_consonant_skeleton_indic(phrase: str) -> str:
    out: List[str] = []
    first_alpha = True
    for ch in phrase:
        cp = ord(ch)
        if 0x0900 <= cp <= 0x0D7F:
            off = cp & 0x7F
            c = ""
            if off in (0x01, 0x02):
                c = "n"
            elif off in (0x15, 0x16, 0x17, 0x18, 0x58, 0x59, 0x5A):
                c = "k"
            elif off == 0x19:
                c = "n"
            elif off in (0x1A, 0x1B, 0x1C, 0x1D):
                c = "c"
            elif off == 0x5B:
                c = "s"
            elif off == 0x1E:
                c = "n"
            elif off in (0x1F, 0x20, 0x21, 0x22, 0x24, 0x25, 0x26, 0x27, 0x5C, 0x5D):
                c = "t"
            elif off in (0x23, 0x28, 0x29):
                c = "n"
            elif off in (0x2A, 0x2B, 0x2C, 0x2D, 0x5E):
                c = "p"
            elif off == 0x2E:
                c = "m"
            elif off in (0x2F, 0x5F):
                c = "y" if first_alpha else ""
            elif off in (0x30, 0x31, 0x0B):
                c = "r"
            elif off in (0x32, 0x33, 0x34):
                c = "l"
            elif off == 0x35:
                c = "w"
            elif off in (0x36, 0x37, 0x38):
                c = "s"
            elif off == 0x39:
                c = "h"
            if 0x05 <= off <= 0x39:
                first_alpha = False
            if c and (not out or out[-1] != c):
                out.append(c)
        elif ch == " ":
            first_alpha = True
    return "".join(out)


def _canonical_consonant_skeleton_en(phrase: str) -> str:
    w = phrase.lower()
    w = w.replace("tch", "c").replace("ch", "c").replace("dg", "c")
    w = w.replace("ph", "p").replace("gh", "").replace("ck", "k").replace("sh", "s").replace("th", "t")
    out: List[str] = []
    first_alpha = True
    for ch in w:
        if ch == " ":
            first_alpha = True
            continue
        c = ""
        if ch in ("k", "g", "q", "x"):
            c = "k"
        elif ch in ("c", "j"):
            c = "c"
        elif ch in ("s", "z"):
            c = "s"
        elif ch in ("t", "d"):
            c = "t"
        elif ch == "n":
            c = "n"
        elif ch in ("p", "b", "f"):
            c = "p"
        elif ch == "m":
            c = "m"
        elif ch == "y" and first_alpha:
            c = "y"
        elif ch == "r":
            c = "r"
        elif ch == "l":
            c = "l"
        elif ch in ("v", "w"):
            c = "w"
        elif ch == "h":
            c = "h"
        if "a" <= ch <= "z":
            first_alpha = False
        if c and (not out or out[-1] != c):
            out.append(c)
    return "".join(out)


def _skel_edit_dist(a: str, b: str) -> int:
    n, m = len(a), len(b)
    dp = list(range(m + 1))
    for i in range(1, n + 1):
        prev = dp[0]
        dp[0] = i
        for j in range(1, m + 1):
            tmp = dp[j]
            cost = 0 if a[i - 1] == b[j - 1] else 1
            dp[j] = min(prev + cost, dp[j] + 1, dp[j - 1] + 1)
            prev = tmp
    return dp[m]


def _is_phonetic_loanword_match(ind_phrase: str, en_phrase: str) -> bool:
    en_clean = en_phrase.strip().lower()
    si = _canonical_consonant_skeleton_indic(ind_phrase)
    if not si:
        return False
    if len(si) == 1 and en_clean != "app":
        return False
    w_hard = re.sub(r"c(?=[aoukrlt]|$)", "k", en_clean)
    w_hard = re.sub(r"c(?=[eiy])", "s", w_hard)
    variants = [v for v in (_canonical_consonant_skeleton_en(w_hard), _canonical_consonant_skeleton_en(en_clean)) if v]
    if not variants:
        return False
    best_d = 99
    best_len_ok = False
    for se in variants:
        if abs(len(si) - len(se)) <= 1:
            best_len_ok = True
            d = _skel_edit_dist(si, se)
            if d < best_d:
                best_d = d
    if not best_len_ok:
        return False
    if min(len(si), min(len(v) for v in variants)) <= 2:
        if best_d != 0:
            return False
    elif best_d > 1:
        return False

    first_ind_cp = next((ord(c) for c in ind_phrase if 0x0900 <= ord(c) <= 0x0D7F), 0)
    is_south_indic = 0x0B80 <= first_ind_cp <= 0x0D7F
    ind_syl, ends_virama = _count_indic_syllables_and_virama(ind_phrase)
    en_syl, ends_cons = _count_en_syllables_and_coda(en_clean)
    max_syl_diff = 1 if is_south_indic else 2
    if ind_syl - en_syl > max_syl_diff or en_syl - ind_syl > 1:
        return False
    if is_south_indic and ends_cons and not ends_virama and ind_syl > en_syl:
        return False
    return True


def _repair_indian_en_spelling(raw_w: str, en_lex_words: frozenset) -> str:
    cw = _EN_CLEAN_RE.sub("", raw_w.lower()).strip("'")
    if not cw:
        return cw
    if cw in _INDIAN_EN_LOANWORD_FIXES:
        fixed = _INDIAN_EN_LOANWORD_FIXES[cw]
        if is_en_word(fixed, en_lex_words):
            return fixed
    if is_en_word(cw, en_lex_words) or len(cw) < 3:
        return cw
    cands = (
        cw + "e",
        cw.replace("io", "eo"),
        ("w" + cw[1:]) if cw.startswith("v") else "",
        cw.replace("th", "t"),
        cw.replace("f", "ff"),
        ("o" + cw.replace("f", "ff")) if cw.startswith("af") else "",
        cw.replace("k", "c"),
    )
    for c in cands:
        if c and len(c) >= 3 and is_en_word(c, en_lex_words):
            return c
    return cw


def _extract_ctc_word_spans(
    logits_2d: np.ndarray,
    vocab: Sequence[str],
) -> List[Tuple[str, int, int]]:
    """Extracts `(word_text, start_frame, end_frame)` spans from greedy/aligned CTC frames."""
    argmax_ids = np.argmax(logits_2d, axis=-1)
    vlen = len(vocab)
    raw_spans: List[Tuple[str, int, int]] = []
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
                    raw_spans.append((w_txt, cur_start, max(cur_end, cur_start + 1)))
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
            raw_spans.append((w_txt, cur_start, max(cur_end, cur_start + 1)))

    words: List[Tuple[str, int, int]] = []
    for w_txt, s0, s1 in raw_spans:
        parts = [p for p in w_txt.split() if p]
        if len(parts) <= 1:
            words.append((w_txt, s0, s1))
        else:
            tot_c = max(1, sum(len(p) for p in parts))
            span_len = max(len(parts), s1 - s0)
            cur_f = s0
            for i, p in enumerate(parts):
                w_f = max(1, int(round(span_len * len(p) / tot_c)))
                nxt_f = s1 if i == len(parts) - 1 else min(s1, cur_f + w_f)
                words.append((p, cur_f, max(cur_f + 1, nxt_f)))
                cur_f = nxt_f
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
    and clauses in Latin script (Kanglish / Hinglish / Tanglish) via whole-utterance
    frame alignment, Indic-to-English consonant skeleton matching, and acoustic certainty."""
    lg_ind = logits_indic[0] if logits_indic.ndim == 3 else logits_indic
    lg_en = logits_en[0] if logits_en.ndim == 3 else logits_en
    base_res: CTCDecodeResult = decode_ctc(lg_ind, vocab=vocab_indic, is_partial=is_partial)
    if lang_indic == "en" or lg_ind.shape[0] < 4 or not base_res.text:
        return CodeSwitchDecodeResult(text=base_res.text, tokens=base_res.tokens, english_spans=[])

    ind_spans = _extract_ctc_word_spans(lg_ind, vocab_indic)
    if not ind_spans:
        return CodeSwitchDecodeResult(text=base_res.text, tokens=base_res.tokens, english_spans=[])

    base_words = base_res.text.split()
    if len(base_words) == len(ind_spans):
        ind_spans = [(base_words[i], ind_spans[i][1], ind_spans[i][2]) for i in range(len(ind_spans))]

    en_res: CTCDecodeResult = decode_ctc(lg_en, vocab=vocab_en, is_partial=is_partial)
    en_spans_raw = _extract_ctc_word_spans(lg_en, vocab_en)
    en_words_dec = en_res.text.split()
    if len(en_words_dec) == len(en_spans_raw):
        en_spans_raw = [(en_words_dec[i], en_spans_raw[i][1], en_spans_raw[i][2]) for i in range(len(en_spans_raw))]

    core_set, ext_set = get_indic_lexicon(lang_indic)
    en_lex_words, _ = get_en_lexicon()

    classified_en: List[Tuple[str, str, int, int, bool, bool]] = []
    for w_raw, e0, e1 in en_spans_raw:
        cw = _repair_indian_en_spelling(w_raw, en_lex_words)
        has_v = bool(_EN_VOWELS_RE.search(cw))
        in_lex = bool(cw) and is_en_word(cw, en_lex_words)
        is_strong = has_v and in_lex and (
            (len(cw) >= 4 and cw not in _CODEMIX_AMBIGUOUS_EN)
            or (cw in _EN_SAFE_SHORT_WORDS)
        )
        is_phrase_ok = is_strong or (cw in _EN_PHRASE_FUNC_WORDS) or (len(cw) >= 3 and has_v and in_lex)
        classified_en.append((cw, w_raw, e0, e1, is_strong, is_phrase_ok))

    cand_regions: List[List[Tuple[str, str, int, int, bool, bool]]] = []
    i = 0
    n_en = len(classified_en)
    while i < n_en:
        if not classified_en[i][5]:
            i += 1
            continue
        j = i
        while j + 1 < n_en and classified_en[j + 1][5] and (classified_en[j + 1][2] - classified_en[j][3]) <= 12:
            j += 1
        sub = classified_en[i : j + 1]
        if any(item[4] for item in sub) and (len(sub) > 1 or sub[0][4]):
            cand_regions.append(sub)
        i = j + 1

    replacements: Dict[int, Tuple[int, List[str]]] = {}
    used_ind: set[int] = set()

    def try_region(sub_items: List[Tuple[str, str, int, int, bool, bool]]) -> bool:
        r_e0 = sub_items[0][2]
        r_e1 = sub_items[-1][3]
        en_clean_list = [x[0] for x in sub_items if x[0]]
        if not en_clean_list:
            return False
        overlap_idxs: List[int] = []
        for idx_i, (_, i0, i1) in enumerate(ind_spans):
            i_mid = 0.5 * (i0 + i1)
            ov = min(i1, r_e1) - max(i0, r_e0)
            i_len = max(1, i1 - i0)
            if (r_e0 <= i_mid <= r_e1) or (ov >= 0.60 * i_len):
                overlap_idxs.append(idx_i)
        if not overlap_idxs:
            return False
        lo, hi = overlap_idxs[0], overlap_idxs[-1] + 1

        while (hi - lo) > len(en_clean_list):
            w_left = ind_spans[lo][0].strip("।॥,?!.'\"-")
            if (
                w_left
                and score_indic_word(w_left, lang_indic, core_set, ext_set) > 0.5
                and not _is_phonetic_loanword_match(w_left, en_clean_list[0])
            ):
                lo += 1
                continue
            w_right = ind_spans[hi - 1][0].strip("।॥,?!.'\"-")
            if (
                w_right
                and score_indic_word(w_right, lang_indic, core_set, ext_set) > 0.5
                and not _is_phonetic_loanword_match(w_right, en_clean_list[-1])
            ):
                hi -= 1
                continue
            break

        if lo >= hi or any(k in used_ind for k in range(lo, hi)):
            return False

        ind_words_slice = [ind_spans[k][0] for k in range(lo, hi)]
        ind_phrase = " ".join(ind_words_slice)
        en_phrase = " ".join(en_clean_list)
        f0 = max(0, min(r_e0, ind_spans[lo][1]) - 2)
        f1 = min(lg_ind.shape[0], max(r_e1, ind_spans[hi - 1][2]) + 2)
        if f1 - f0 < 3:
            return False

        cert_ind = _span_conditional_certainty(lg_ind[f0:f1])
        cert_en = _span_conditional_certainty(lg_en[f0:f1])
        any_core = any(w.strip("।॥,?!.'\"-") in core_set for w in ind_words_slice if w.strip("।॥,?!.'\"-"))
        phon_match = _is_phonetic_loanword_match(ind_phrase, en_phrase)

        if any_core and not (len(en_clean_list) >= 3 and cert_en >= cert_ind + 0.20):
            return False

        accept = False
        if phon_match:
            edges_ok = True
            if len(en_clean_list) >= 2 and len(ind_words_slice) >= 2:
                if not _is_phonetic_loanword_match(ind_words_slice[0], en_clean_list[0]) or not _is_phonetic_loanword_match(ind_words_slice[-1], en_clean_list[-1]):
                    edges_ok = False
            _, ends_vir = _count_indic_syllables_and_virama(ind_phrase)
            if not ends_vir and len(en_clean_list) == 1:
                margin = -0.05
            elif len(en_clean_list) == 1 and len(en_clean_list[0]) <= 4:
                margin = -0.32
            else:
                margin = -0.45
            if edges_ok and cert_en >= -0.82 and cert_en >= cert_ind + margin:
                accept = True
        elif len(en_clean_list) >= 3 and sum(1 for x in sub_items if x[4]) >= 1:
            if cert_en >= cert_ind + 0.04 and cert_en >= -0.65:
                accept = True
        else:
            ind_lex_scores = [
                score_indic_word(w.strip("।॥,?!.'\"-"), lang_indic, core_set, ext_set)
                for w in ind_words_slice
                if w.strip("।॥,?!.'\"-")
            ]
            max_ind_lex = max(ind_lex_scores) if ind_lex_scores else 0.0
            if max_ind_lex <= 0.05 and cert_en >= cert_ind + 0.28 and cert_en > -0.32:
                accept = True

        if accept:
            replacements[lo] = (hi, en_clean_list)
            for k in range(lo, hi):
                used_ind.add(k)
            return True
        return False

    for reg in cand_regions:
        if not try_region(reg) and len(reg) > 1:
            for length in range(min(3, len(reg) - 1), 0, -1):
                for start_k in range(0, len(reg) - length + 1):
                    sub = reg[start_k : start_k + length]
                    if any(x[4] for x in sub) and (len(sub) > 1 or sub[0][4]):
                        try_region(sub)

    # Local Voronoi fallback for isolated English loanwords missed by full-sequence greedy boundaries
    total_frames = lg_ind.shape[0]
    for idx, (w_i, i0, i1) in enumerate(ind_spans):
        if idx in used_ind:
            continue
        w_clean = w_i.strip("।॥,?!.'\"-")
        if not w_clean or w_clean in core_set:
            continue
        prev_e = ind_spans[idx - 1][2] if idx > 0 else 0
        next_s = ind_spans[idx + 1][1] if (idx + 1) < len(ind_spans) else total_frames
        s0 = max(prev_e, i0 - 1)
        s1 = min(next_s, i1 + 1)
        if (s1 - s0) < 3:
            continue
        sub_en_txt = decode_ctc(lg_en[s0:s1], vocab=vocab_en, is_partial=True).text.strip()
        sub_en_words = [_repair_indian_en_spelling(u, en_lex_words) for u in sub_en_txt.split()]
        sub_en_words = [u for u in sub_en_words if u and is_en_word(u, en_lex_words) and bool(_EN_VOWELS_RE.search(u))]
        if len(sub_en_words) == 1:
            cand_w = sub_en_words[0]
            if (len(cand_w) >= 4 and cand_w not in _CODEMIX_AMBIGUOUS_EN) or (cand_w in _EN_SAFE_SHORT_WORDS):
                if _is_phonetic_loanword_match(w_clean, cand_w):
                    _, ends_vir2 = _count_indic_syllables_and_virama(w_clean)
                    m2 = -0.42 if ends_vir2 else -0.05
                    c_ind = _span_conditional_certainty(lg_ind[s0:s1])
                    c_en = _span_conditional_certainty(lg_en[s0:s1])
                    if c_en >= -0.82 and c_en >= c_ind + m2:
                        replacements[idx] = (idx + 1, [cand_w])
                        used_ind.add(idx)
                elif (
                    len(_canonical_consonant_skeleton_en(cand_w)) >= 2
                    and score_indic_word(w_clean, lang_indic, core_set, ext_set) <= 0.05
                ):
                    c_ind = _span_conditional_certainty(lg_ind[s0:s1])
                    c_en = _span_conditional_certainty(lg_en[s0:s1])
                    if c_en >= c_ind + 0.28 and c_en > -0.35:
                        replacements[idx] = (idx + 1, [cand_w])
                        used_ind.add(idx)

    if not replacements:
        return CodeSwitchDecodeResult(text=base_res.text, tokens=base_res.tokens, english_spans=[])

    out_words: List[str] = []
    en_spans: List[CodeSwitchSpan] = []
    cursor = 0
    idx = 0
    while idx < len(ind_spans):
        if idx in replacements:
            hi, en_list = replacements[idx]
            for ew in en_list:
                if out_words:
                    cursor += 1
                sc = cursor
                cursor += len(ew)
                en_spans.append(CodeSwitchSpan(word=ew, start_char=sc, end_char=cursor))
                out_words.append(ew)
            idx = hi
        else:
            w_i = ind_spans[idx][0]
            if out_words:
                cursor += 1
            cursor += len(w_i)
            out_words.append(w_i)
            idx += 1

    out_tokens = [f"\u2581{w}" for w in out_words]
    return CodeSwitchDecodeResult(text=" ".join(out_words), tokens=out_tokens, english_spans=en_spans)


def split_pcm_at_pauses(
    pcm: np.ndarray,
    sr: int = 16000,
    min_segment_sec: float = 1.55,
    min_pause_ms: float = 160.0,
) -> List[Tuple[int, int]]:
    """Splits a 16 kHz PCM buffer into `(start_sample, end_sample)` active-speech
    segments separated by clear acoustic pauses (`>= min_pause_ms`), trimming dead
    silence margins (`40 ms` pad) so per-segment CMVN is never skewed by silence."""
    min_seg = int(min_segment_sec * sr)
    if len(pcm) < 2 * min_seg:
        return [(0, len(pcm))]
    hop = int(0.02 * sr)
    n_frames = len(pcm) // hop
    if n_frames < 20:
        return [(0, len(pcm))]
    frames = pcm[: n_frames * hop].reshape(n_frames, hop)
    rms = np.sqrt(np.mean(frames * frames, axis=1))
    p80 = float(np.percentile(rms, 80))
    if p80 < 1.0e-4:
        return [(0, len(pcm))]
    valley_th = max(0.0035, min(0.018, 0.12 * p80))
    is_sil = rms < valley_th
    min_sil_frames = max(4, int(round(min_pause_ms / 20.0)))

    cuts: List[Tuple[int, float]] = []
    i = 0
    while i < n_frames:
        if not is_sil[i]:
            i += 1
            continue
        j = i
        while j < n_frames and is_sil[j]:
            j += 1
        if (j - i) >= min_sil_frames:
            med_v_rms = float(np.median(rms[i:j]))
            strength = (float(j - i) ** 1.5) / (med_v_rms + 5.0e-4)
            cuts.append((((i + j) // 2) * hop, strength))
        i = j

    if not cuts:
        return [(0, len(pcm))]

    segs: List[List[int]] = []
    boundary_strengths: List[float] = []
    prev = 0
    for c_samp, st in cuts:
        segs.append([prev, c_samp])
        boundary_strengths.append(st)
        prev = c_samp
    segs.append([prev, len(pcm)])

    while len(segs) > 1:
        shortest_idx = min(range(len(segs)), key=lambda k: segs[k][1] - segs[k][0])
        if (segs[shortest_idx][1] - segs[shortest_idx][0]) >= min_seg:
            break
        if shortest_idx == 0:
            segs[1][0] = segs[0][0]
            segs.pop(0)
            boundary_strengths.pop(0)
        elif shortest_idx == len(segs) - 1:
            segs[-2][1] = segs[-1][1]
            segs.pop()
            boundary_strengths.pop()
        else:
            if boundary_strengths[shortest_idx - 1] <= boundary_strengths[shortest_idx]:
                segs[shortest_idx - 1][1] = segs[shortest_idx][1]
                segs.pop(shortest_idx)
                boundary_strengths.pop(shortest_idx - 1)
            else:
                segs[shortest_idx + 1][0] = segs[shortest_idx][0]
                segs.pop(shortest_idx)
                boundary_strengths.pop(shortest_idx)

    if len(segs) <= 1:
        return [(0, len(pcm))]

    trimmed: List[Tuple[int, int]] = []
    for s0, s1 in segs:
        f0 = s0 // hop
        f1 = min(n_frames, s1 // hop)
        while f0 < f1 and is_sil[f0]:
            f0 += 1
        while f1 > f0 and is_sil[f1 - 1]:
            f1 -= 1
        t0 = max(s0, (f0 - 2) * hop)
        t1 = min(s1, (f1 + 2) * hop)
        if (t1 - t0) >= int(0.4 * sr):
            trimmed.append((t0, t1))
        else:
            trimmed.append((s0, s1))
    return trimmed
