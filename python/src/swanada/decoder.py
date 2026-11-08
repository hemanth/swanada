"""CTC Acoustic Decoders in Python: Exact Marginal Prefix Beam Search,
Trie-Guided English Lexical Beam Search, and Stateful Greedy Streaming.

Compatible with NumPy arrays and standard Python lists.
"""

from dataclasses import dataclass
import math
import re
from typing import Dict, List, Set, Tuple, Union
import unicodedata
import numpy as np

from .en_lexicon import get_en_lexicon, is_en_prefix, is_en_word
from .indic_lexicon import detect_indic_vocab_lang, get_indic_lexicon, score_indic_word
from .normalizer import normalize_indic_text

_NEG_INF = -1.0e30

_BRAHMIC_VIRAMAS = frozenset(
    {"\u094d", "\u09cd", "\u0a4d", "\u0acd", "\u0b4d", "\u0bcd", "\u0c4d", "\u0ccd", "\u0d4d"}
)
_SHORT_A_VOWELS = frozenset(
    {"\u0905", "\u0985", "\u0a05", "\u0a85", "\u0b05", "\u0b85", "\u0c05", "\u0c85", "\u0d05"}
)
_PRIMARY_MATRA_RANGES = (
    (0x093E, 0x094C), (0x094E, 0x094F), (0x0962, 0x0963),
    (0x09BE, 0x09C4), (0x09C7, 0x09C8), (0x09CB, 0x09CC), (0x09E2, 0x09E3),
    (0x0A3E, 0x0A42), (0x0A47, 0x0A48), (0x0A4B, 0x0A4C),
    (0x0ABE, 0x0AC5), (0x0AC7, 0x0AC9), (0x0ACB, 0x0ACC), (0x0AE2, 0x0AE3),
    (0x0B3E, 0x0B44), (0x0B47, 0x0B48), (0x0B4B, 0x0B4C), (0x0B62, 0x0B63),
    (0x0BBE, 0x0BC2), (0x0BC6, 0x0BC8), (0x0BCA, 0x0BCC),
    (0x0C3E, 0x0C44), (0x0C46, 0x0C48), (0x0C4A, 0x0C4C), (0x0C62, 0x0C63),
    (0x0CBE, 0x0CC4), (0x0CC6, 0x0CC8), (0x0CCA, 0x0CCC), (0x0CE2, 0x0CE3),
    (0x0D3E, 0x0D44), (0x0D46, 0x0D48), (0x0D4A, 0x0D4C), (0x0D62, 0x0D63),
)


def _is_primary_matra(ch: str) -> bool:
    cp = ord(ch)
    for lo, hi in _PRIMARY_MATRA_RANGES:
        if lo <= cp <= hi:
            return True
    return False


def _is_brahmic_consonant(ch: str) -> bool:
    cp = ord(ch)
    if not (0x0900 <= cp <= 0x0D7F):
        return False
    off = cp & 0x7F
    return (
        (0x15 <= off <= 0x39)
        or (0x58 <= off <= 0x5F)
        or off == 0x79
        or (0x7A <= off <= 0x7F and (cp & ~0x7F) == 0x0D00)
    )


def _matra_to_indep_vowel(m_ch: str) -> str:
    m_cp = ord(m_ch)
    base = m_cp & ~0x7F
    off = m_cp & 0x7F
    if off == 0x44:
        return chr(base + 0x60)
    if off == 0x62:
        return chr(base + 0x0C)
    if off == 0x63:
        return chr(base + 0x61)
    return chr(m_cp - 0x38)


def _extend_indic_lexical_state(
    lm_score: float,
    cur_word: str,
    last_char: str,
    piece: str,
    lang: str,
    core_set: Set[str],
    ext_set: Set[str],
) -> Tuple[float, str, str]:
    sc = lm_score
    cw = cur_word
    lc = last_char

    for k, ch in enumerate(piece):
        if ch in ("\u2581", " ", "\u2582", "\u2583"):
            if cw:
                sc += score_indic_word(cw, lang, core_set, ext_set)
                cw = ""
            lc = " "
            continue

        if lc in _BRAHMIC_VIRAMAS and ch in _BRAHMIC_VIRAMAS:
            if not (k == 0 and len(piece) >= 2 and _is_brahmic_consonant(piece[1])):
                sc -= 4.20
            continue

        if lc == ch and unicodedata.category(ch) in ("Mn", "Mc", "Me"):
            continue

        if ch in _SHORT_A_VOWELS and lc and (
            _is_brahmic_consonant(lc) or (ch == "\u0d05" and _is_primary_matra(lc))
        ):
            sc += score_indic_word(cw, lang, core_set, ext_set)
            cw = ch
            lc = ch
            continue

        if lc and lc != " ":
            if ch in _BRAHMIC_VIRAMAS:
                if _is_primary_matra(lc):
                    if not (lc == "\u0d41" and ch == "\u0d4d"):
                        sc -= 4.20
                elif lc in _BRAHMIC_VIRAMAS:
                    sc -= 4.20
            elif _is_primary_matra(ch):
                if _is_primary_matra(lc):
                    sc -= 4.20
                elif lc in _BRAHMIC_VIRAMAS:
                    if (ord(lc) & ~0x7F) == (ord(ch) & ~0x7F):
                        sc += 0.28 + score_indic_word(cw, lang, core_set, ext_set)
                        indep = _matra_to_indep_vowel(ch)
                        cw = indep
                        lc = indep
                        continue
            elif _is_brahmic_consonant(ch):
                if lc in _BRAHMIC_VIRAMAS:
                    sc += 0.22

        cw += ch
        lc = ch

    return sc, cw, lc


def _finalize_indic_lexical_score(
    lm_score: float,
    cur_word: str,
    lang: str,
    core_set: Set[str],
    ext_set: Set[str],
    is_partial: bool = False,
) -> float:
    if not cur_word or is_partial:
        return lm_score
    return lm_score + score_indic_word(cur_word, lang, core_set, ext_set)


@dataclass
class CTCDecodeResult:
    text: str
    tokens: List[str]
    token_ids: List[int]


def is_special_token(token: str) -> bool:
    """Check if token is a special non-speech token like <unk>, <blank>, [PAD], etc."""
    if not token:
        return False
    return (token.startswith("<") and token.endswith(">")) or (
        token.startswith("[") and token.endswith("]")
    )


def _log_add_exp(a: float, b: float) -> float:
    if a <= _NEG_INF * 0.5:
        return b
    if b <= _NEG_INF * 0.5:
        return a
    if a > b:
        return a + math.log1p(math.exp(b - a))
    return b + math.log1p(math.exp(a - b))


def _is_english_sentencepiece_vocab(vocab_list: List[str]) -> bool:
    if len(vocab_list) < 200:
        return False
    probe = "".join(vocab_list[2:12])
    return any("a" <= ch <= "z" for ch in probe)


def _format_en_display(text: str) -> str:
    if not text:
        return text
    out = re.sub(r"^[a-z]", lambda m: m.group(0).upper(), text)
    out = re.sub(r"([.?!]\s+)([a-z])", lambda m: m.group(1) + m.group(2).upper(), out)
    out = re.sub(r"\bi(?=(?:['’](?:m|ve|ll|d))?\b)", "I", out)
    return out


def _is_plausible_en_oov(word: str) -> bool:
    """Check whether an out-of-lexicon English token is phonotactically plausible
    (e.g. slang, proper noun, brand, code-switched word) vs stray consonant noise."""
    n = len(word)
    if n < 2 or "'" in word:
        return False
    has_vowel = False
    run_len = 1
    for i, ch in enumerate(word):
        if ch in "aeiouy":
            has_vowel = True
        if i > 0:
            if ch == word[i - 1]:
                run_len += 1
                if run_len >= 3:
                    return False
            else:
                run_len = 1
    return has_vowel


def _score_known_en_word(clean: str) -> float:
    """Length-scaled lexical bonus that prevents splitting one spoken word
    into multiple short dictionary words while correcting acoustic misspellings."""
    wlen = len(clean)
    if wlen <= 2:
        return 0.70
    return min(3.05, 0.70 + 0.34 * wlen)


def _extend_en_lexical_state(
    lm_score: float,
    cur_word: str,
    in_prefix: bool,
    piece: str,
    words: set,
    prefixes: set,
    near_cut_edge: bool = False,
) -> Tuple[float, str, bool]:
    for ch in piece:
        if ("a" <= ch <= "z") or ("A" <= ch <= "Z") or ch == "'":
            lc = ch.lower()
            if not cur_word and lc == "'":
                continue
            next_word = cur_word + lc
            if in_prefix and not is_en_prefix(next_word, prefixes, words):
                in_prefix = False
                lm_score -= 2.35
            cur_word = next_word
        else:
            if near_cut_edge and ch in (".", "?", "!"):
                lm_score -= 2.60
            if cur_word:
                clean = cur_word.rstrip("'")
                if clean:
                    if is_en_word(clean, words):
                        lm_score += _score_known_en_word(clean)
                    elif _is_plausible_en_oov(clean):
                        lm_score += -3.40 if in_prefix else -2.75
                    else:
                        lm_score += -4.35 if in_prefix else -2.85
                cur_word = ""
                in_prefix = True
    return lm_score, cur_word, in_prefix


def _finalize_en_lexical_score(
    lm_score: float,
    cur_word: str,
    in_prefix: bool,
    words: set,
    is_partial: bool = False,
) -> float:
    if not cur_word:
        return lm_score
    clean = cur_word.rstrip("'")
    if not clean:
        return lm_score
    if is_en_word(clean, words):
        if is_partial:
            return lm_score + (0.65 if len(clean) >= 4 else 0.20)
        return lm_score + _score_known_en_word(clean)
    if in_prefix:
        return lm_score
    if _is_plausible_en_oov(clean):
        return lm_score - 2.75
    return lm_score - 2.85


def _beam_decode_ctc(
    logits_2d: np.ndarray,
    vocab_list: List[str],
    skip_special_tokens: bool,
    dedup_marks: bool,
    normalize_nfc: bool,
    space_marker: str,
    is_partial: bool = False,
) -> CTCDecodeResult:
    # Numerically stable row-wise log_softmax over [T, V]
    arr = np.asarray(logits_2d, dtype=np.float64)
    row_max = np.max(arr, axis=-1, keepdims=True)
    shifted = arr - row_max
    log_probs = shifted - np.log(np.sum(np.exp(shifted), axis=-1, keepdims=True))

    t_steps, num_classes = log_probs.shape
    is_en = _is_english_sentencepiece_vocab(vocab_list)
    if is_partial:
        beam_width = 9 if is_en else 7
        top_k = min(num_classes - 1, 7 if is_en else 6)
    else:
        beam_width = 20 if is_en else 12
        top_k = min(num_classes - 1, 18 if is_en else 8)

    if is_en:
        en_words, en_prefixes = get_en_lexicon()
        indic_lang = "en"
        indic_core, indic_ext = set(), set()
    else:
        en_words, en_prefixes = set(), set()
        indic_lang = detect_indic_vocab_lang(vocab_list)
        indic_core, indic_ext = get_indic_lexicon(indic_lang)

    # Pre-extract top-k non-blank indices per frame
    non_blank_lp = log_probs[:, 1:]  # [T, V-1]
    max_non_blank = np.max(non_blank_lp, axis=-1)
    if top_k < num_classes - 1:
        part_idx = np.argpartition(non_blank_lp, -top_k, axis=-1)[:, -top_k:]
    else:
        part_idx = np.tile(np.arange(num_classes - 1), (t_steps, 1))

    # Beam entry tuple:
    #   key = tuple of emitted non-blank token IDs
    #   val = [pb, pnb, lm_score, cur_word, in_prefix, last_char]
    beams: Dict[Tuple[int, ...], list] = {(): [0.0, _NEG_INF, 0.0, "", True, ""]}

    for t in range(t_steps):
        lp_row = log_probs[t]
        lp_blank = float(lp_row[0])

        # Fast-skip confident blank frames or flat uniform non-speech frames
        if lp_blank > -0.02 or float(max_non_blank[t]) < -4.2:
            for state in beams.values():
                state[0] = _log_add_exp(state[0], state[1]) + lp_blank
                state[1] = _NEG_INF
            continue

        cand_cols = (part_idx[t] + 1).tolist()
        cand_cols.sort(key=lambda c: float(lp_row[c]), reverse=True)

        next_beams: Dict[Tuple[int, ...], list] = {}

        for prefix, state in beams.items():
            pb, pnb, lm_sc, cur_w, in_pref, last_ch = state
            total_p = _log_add_exp(pb, pnb)

            # 1. Blank transition stays on `prefix`
            nb_cur = next_beams.get(prefix)
            new_pb = total_p + lp_blank
            if nb_cur is None:
                nb_cur = [new_pb, _NEG_INF, lm_sc, cur_w, in_pref, last_ch]
                next_beams[prefix] = nb_cur
            else:
                nb_cur[0] = _log_add_exp(nb_cur[0], new_pb)

            # 2. Repeat of last token without blank collapses into `prefix`
            last_tok = prefix[-1] if prefix else -1
            if last_tok > 0 and pnb > _NEG_INF * 0.5:
                nb_cur[1] = _log_add_exp(nb_cur[1], pnb + float(lp_row[last_tok]))

            # 3. Top-K non-blank token extensions
            for c in cand_cols:
                lp_c = float(lp_row[c])
                if c == last_tok:
                    if pb <= _NEG_INF * 0.5:
                        continue
                    ext_pnb = pb + lp_c
                else:
                    ext_pnb = total_p + lp_c

                new_prefix = prefix + (c,)
                nb_ext = next_beams.get(new_prefix)
                if nb_ext is not None:
                    nb_ext[1] = _log_add_exp(nb_ext[1], ext_pnb)
                else:
                    tok_str = vocab_list[c] if c < len(vocab_list) else ""
                    if skip_special_tokens and is_special_token(tok_str):
                        tok_str = ""
                    if is_en:
                        n_lm, n_w, n_ip = _extend_en_lexical_state(
                            lm_sc,
                            cur_w,
                            in_pref,
                            tok_str,
                            en_words,
                            en_prefixes,
                            near_cut_edge=(is_partial and t >= max(0, t_steps - 8)),
                        )
                        n_lc = ""
                    else:
                        n_lm, n_w, n_lc = _extend_indic_lexical_state(
                            lm_sc,
                            cur_w,
                            last_ch,
                            tok_str,
                            indic_lang,
                            indic_core,
                            indic_ext,
                        )
                        n_ip = True
                    next_beams[new_prefix] = [_NEG_INF, ext_pnb, n_lm, n_w, n_ip, n_lc]

        if len(next_beams) > beam_width:
            if is_en:
                def _en_prune_key(kv: Tuple[Tuple[int, ...], list]) -> float:
                    st = kv[1]
                    if st[4]:
                        w_cur = st[3]
                        pend = (min(1.45, 0.28 * len(w_cur)) if w_cur in en_words else (0.35 if len(w_cur) >= 2 else 0.0))
                    else:
                        pend = 0.0
                    return _log_add_exp(st[0], st[1]) + st[2] + pend

                ranked = sorted(next_beams.items(), key=_en_prune_key, reverse=True)[:beam_width]
            elif indic_lang == "ta":
                ranked = sorted(
                    next_beams.items(),
                    key=lambda kv: _log_add_exp(kv[1][0], kv[1][1]) + kv[1][2],
                    reverse=True,
                )[:beam_width]
            else:
                def _indic_prune_key(kv: Tuple[Tuple[int, ...], list]) -> float:
                    st = kv[1]
                    w_cur = st[3]
                    if w_cur in indic_core:
                        pend = 1.65
                    elif w_cur in indic_ext and len(w_cur) >= 3:
                        pend = 0.65
                    else:
                        pend = 0.0
                    return _log_add_exp(st[0], st[1]) + st[2] + pend

                ranked = sorted(next_beams.items(), key=_indic_prune_key, reverse=True)[:beam_width]
            beams = dict(ranked)
        else:
            beams = next_beams

    best_prefix: Tuple[int, ...] = ()
    best_score = _NEG_INF
    for prefix, state in beams.items():
        ac_score = _log_add_exp(state[0], state[1])
        final_lm = (
            _finalize_en_lexical_score(state[2], state[3], state[4], en_words, is_partial=is_partial)
            if is_en
            else _finalize_indic_lexical_score(
                state[2], state[3], indic_lang, indic_core, indic_ext, is_partial=is_partial
            )
        )
        score = ac_score + final_lm
        if score > best_score:
            best_score = score
            best_prefix = prefix

    emitted_ids = list(best_prefix)
    tokens: List[str] = []
    for idx in emitted_ids:
        tok = vocab_list[idx] if idx < len(vocab_list) else ""
        if tok:
            if skip_special_tokens and is_special_token(tok):
                continue
            tokens.append(tok)

    raw_text = normalize_indic_text(
        "".join(tokens),
        dedup=dedup_marks,
        normalize_nfc=normalize_nfc,
        space_marker=space_marker,
    )
    text = _format_en_display(raw_text) if (is_en and not is_partial) else raw_text
    return CTCDecodeResult(text=text, tokens=tokens, token_ids=emitted_ids)


def decode_ctc(
    logits: Union[np.ndarray, List[List[float]]],
    vocab: Union[List[str], Dict[int, str]],
    blank_id: int = 0,
    collapse_repeats: bool = True,
    skip_special_tokens: bool = True,
    dedup_marks: bool = True,
    normalize_nfc: bool = True,
    space_marker: str = "\u2581",
    is_partial: bool = False,
) -> CTCDecodeResult:
    """Decode CTC logits using exact marginal / lexical prefix beam search on full
    vocabularies and linear-time greedy decoding on custom/compact vocabularies."""
    if isinstance(logits, np.ndarray):
        if logits.ndim == 3:
            logits = logits[0]
        if logits.size == 0 or logits.shape[0] == 0 or logits.shape[-1] == 0:
            return CTCDecodeResult(text="", tokens=[], token_ids=[])
        logits_2d = logits
    else:
        if not logits or any(len(r) == 0 for r in logits):
            return CTCDecodeResult(text="", tokens=[], token_ids=[])
        logits_2d = np.asarray(logits, dtype=np.float32)

    if (
        isinstance(vocab, list)
        and len(vocab) >= 200
        and blank_id == 0
        and collapse_repeats
        and logits_2d.shape[-1] == len(vocab)
    ):
        return _beam_decode_ctc(
            logits_2d,
            vocab,
            skip_special_tokens=skip_special_tokens,
            dedup_marks=dedup_marks,
            normalize_nfc=normalize_nfc,
            space_marker=space_marker,
            is_partial=is_partial,
        )

    argmax_indices = np.argmax(logits_2d, axis=-1).tolist()
    return decode_ctc_tokens(
        argmax_indices,
        vocab=vocab,
        blank_id=blank_id,
        collapse_repeats=collapse_repeats,
        skip_special_tokens=skip_special_tokens,
        dedup_marks=dedup_marks,
        normalize_nfc=normalize_nfc,
        space_marker=space_marker,
    )


def decode_ctc_tokens(
    token_ids: List[int],
    vocab: Union[List[str], Dict[int, str]],
    blank_id: int = 0,
    collapse_repeats: bool = True,
    skip_special_tokens: bool = True,
    dedup_marks: bool = True,
    normalize_nfc: bool = True,
    space_marker: str = "\u2581",
) -> CTCDecodeResult:
    """Decode from pre-computed argmax token sequences."""
    last_id = blank_id
    emitted_ids: List[int] = []
    tokens: List[str] = []

    for idx in token_ids:
        idx = int(idx)
        if idx == blank_id:
            last_id = blank_id
            continue

        if collapse_repeats and idx == last_id:
            continue

        last_id = idx
        emitted_ids.append(idx)

        tok = (
            vocab[idx]
            if (isinstance(vocab, list) and idx < len(vocab))
            or (isinstance(vocab, dict) and idx in vocab)
            else ""
        )
        if tok:
            if skip_special_tokens and is_special_token(tok):
                continue
            tokens.append(tok)

    text = normalize_indic_text(
        "".join(tokens),
        dedup=dedup_marks,
        normalize_nfc=normalize_nfc,
        space_marker=space_marker,
    )
    return CTCDecodeResult(text=text, tokens=tokens, token_ids=emitted_ids)


class CTCGreedyDecoder:
    """Stateful CTC Greedy Decoder maintaining state across streaming chunks."""

    def __init__(
        self,
        vocab: Union[List[str], Dict[int, str]],
        blank_id: int = 0,
        collapse_repeats: bool = True,
        skip_special_tokens: bool = True,
        dedup_marks: bool = True,
        normalize_nfc: bool = True,
        space_marker: str = "\u2581",
    ):
        self.vocab = vocab
        self.blank_id = blank_id
        self.collapse_repeats = collapse_repeats
        self.skip_special_tokens = skip_special_tokens
        self.dedup_marks = dedup_marks
        self.normalize_nfc = normalize_nfc
        self.space_marker = space_marker
        self.last_token_id = blank_id

    def reset(self) -> None:
        self.last_token_id = self.blank_id

    def decode_chunk(
        self, logits: Union[np.ndarray, List[List[float]]]
    ) -> CTCDecodeResult:
        if isinstance(logits, np.ndarray):
            if logits.ndim == 3:
                logits = logits[0]
            if logits.size == 0 or logits.shape[0] == 0 or logits.shape[-1] == 0:
                return CTCDecodeResult(text="", tokens=[], token_ids=[])
            argmax_indices = np.argmax(logits, axis=-1).tolist()
        else:
            if not logits or any(len(r) == 0 for r in logits):
                return CTCDecodeResult(text="", tokens=[], token_ids=[])
            argmax_indices = [
                max(range(len(row)), key=lambda c: row[c]) for row in logits
            ]

        emitted_ids: List[int] = []
        tokens: List[str] = []

        for idx in argmax_indices:
            idx = int(idx)
            if idx == self.blank_id:
                self.last_token_id = self.blank_id
                continue

            if self.collapse_repeats and idx == self.last_token_id:
                continue

            self.last_token_id = idx
            emitted_ids.append(idx)

            tok = (
                self.vocab[idx]
                if (isinstance(self.vocab, list) and idx < len(self.vocab))
                or (isinstance(self.vocab, dict) and idx in self.vocab)
                else ""
            )
            if tok:
                if self.skip_special_tokens and is_special_token(tok):
                    continue
                tokens.append(tok)

        text = normalize_indic_text(
            "".join(tokens),
            dedup=self.dedup_marks,
            normalize_nfc=self.normalize_nfc,
            space_marker=self.space_marker,
        )
        return CTCDecodeResult(text=text, tokens=tokens, token_ids=emitted_ids)

    def decode(
        self, logits: Union[np.ndarray, List[List[float]]]
    ) -> CTCDecodeResult:
        self.reset()
        return self.decode_chunk(logits)
