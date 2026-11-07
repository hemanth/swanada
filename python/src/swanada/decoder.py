"""CTC Acoustic Decoders in Python: Exact Marginal Prefix Beam Search,
Trie-Guided English Lexical Beam Search, and Stateful Greedy Streaming.

Compatible with NumPy arrays and standard Python lists.
"""

from dataclasses import dataclass
import math
from typing import Dict, List, Tuple, Union
import numpy as np

from .en_lexicon import get_en_lexicon, is_en_prefix, is_en_word
from .normalizer import normalize_indic_text

_NEG_INF = -1.0e30

_BRAHMIC_VIRAMAS = frozenset(
    {"\u094d", "\u09cd", "\u0a4d", "\u0acd", "\u0b4d", "\u0bcd", "\u0c4d", "\u0ccd", "\u0d4d"}
)


def _ends_with_brahmic_consonant(tok: str) -> bool:
    if not tok:
        return False
    cp = ord(tok[-1])
    if not (0x0900 <= cp <= 0x0D7F):
        return False
    off = cp & 0x7F
    return (0x15 <= off <= 0x39) or (0x58 <= off <= 0x5F) or off == 0x79


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


def _extend_en_lexical_state(
    lm_score: float,
    cur_word: str,
    in_prefix: bool,
    piece: str,
    words: set,
    prefixes: set,
) -> Tuple[float, str, bool]:
    for ch in piece:
        if ("a" <= ch <= "z") or ("A" <= ch <= "Z") or ch == "'":
            lc = ch.lower()
            if not cur_word and lc == "'":
                continue
            next_word = cur_word + lc
            if in_prefix and not is_en_prefix(next_word, prefixes, words):
                in_prefix = False
                lm_score -= 2.85
            cur_word = next_word
        else:
            if cur_word:
                clean = cur_word.rstrip("'")
                if clean:
                    if is_en_word(clean, words):
                        lm_score += 2.55 if len(clean) >= 3 else 0.85
                    else:
                        lm_score += -4.75 if in_prefix else -1.90
                cur_word = ""
                in_prefix = True
    return lm_score, cur_word, in_prefix


def _finalize_en_lexical_score(
    lm_score: float,
    cur_word: str,
    in_prefix: bool,
    words: set,
) -> float:
    if not cur_word:
        return lm_score
    clean = cur_word.rstrip("'")
    if not clean:
        return lm_score
    if is_en_word(clean, words):
        return lm_score + (2.55 if len(clean) >= 3 else 0.85)
    if in_prefix:
        return lm_score
    return lm_score - 1.90


def _beam_decode_ctc(
    logits_2d: np.ndarray,
    vocab_list: List[str],
    skip_special_tokens: bool,
    dedup_marks: bool,
    normalize_nfc: bool,
    space_marker: str,
) -> CTCDecodeResult:
    # Numerically stable row-wise log_softmax over [T, V]
    arr = np.asarray(logits_2d, dtype=np.float64)
    row_max = np.max(arr, axis=-1, keepdims=True)
    shifted = arr - row_max
    log_probs = shifted - np.log(np.sum(np.exp(shifted), axis=-1, keepdims=True))

    t_steps, num_classes = log_probs.shape
    is_en = _is_english_sentencepiece_vocab(vocab_list)
    beam_width = 14 if is_en else 6
    top_k = min(num_classes - 1, 10 if is_en else 5)

    if is_en:
        en_words, en_prefixes = get_en_lexicon()
        virama_ids = frozenset()
    else:
        en_words, en_prefixes = set(), set()
        virama_ids = frozenset(
            idx for idx, tok in enumerate(vocab_list) if tok in _BRAHMIC_VIRAMAS
        )

    # Pre-extract top-k non-blank indices per frame
    non_blank_lp = log_probs[:, 1:]  # [T, V-1]
    max_non_blank = np.max(non_blank_lp, axis=-1)
    if top_k < num_classes - 1:
        part_idx = np.argpartition(non_blank_lp, -top_k, axis=-1)[:, -top_k:]
    else:
        part_idx = np.tile(np.arange(num_classes - 1), (t_steps, 1))

    # Beam entry tuple:
    #   key = tuple of emitted non-blank token IDs
    #   val = [pb, pnb, lm_score, cur_word, in_prefix]
    beams: Dict[Tuple[int, ...], list] = {(): [0.0, _NEG_INF, 0.0, "", True]}

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
            pb, pnb, lm_sc, cur_w, in_pref = state
            total_p = _log_add_exp(pb, pnb)

            # 1. Blank transition stays on `prefix`
            nb_cur = next_beams.get(prefix)
            new_pb = total_p + lp_blank
            if nb_cur is None:
                nb_cur = [new_pb, _NEG_INF, lm_sc, cur_w, in_pref]
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
                    if is_en:
                        tok_str = vocab_list[c] if c < len(vocab_list) else ""
                        if skip_special_tokens and is_special_token(tok_str):
                            tok_str = ""
                        n_lm, n_w, n_ip = _extend_en_lexical_state(
                            lm_sc, cur_w, in_pref, tok_str, en_words, en_prefixes
                        )
                    else:
                        prev_tok = vocab_list[last_tok] if 0 < last_tok < len(vocab_list) else ""
                        vir_bonus = (
                            0.28
                            if (c in virama_ids and _ends_with_brahmic_consonant(prev_tok))
                            else 0.0
                        )
                        n_lm, n_w, n_ip = lm_sc + vir_bonus, "", True
                    next_beams[new_prefix] = [_NEG_INF, ext_pnb, n_lm, n_w, n_ip]

        if len(next_beams) > beam_width:
            ranked = sorted(
                next_beams.items(),
                key=lambda kv: _log_add_exp(kv[1][0], kv[1][1]) + kv[1][2],
                reverse=True,
            )[:beam_width]
            beams = dict(ranked)
        else:
            beams = next_beams

    best_prefix: Tuple[int, ...] = ()
    best_score = _NEG_INF
    for prefix, state in beams.items():
        ac_score = _log_add_exp(state[0], state[1])
        final_lm = (
            _finalize_en_lexical_score(state[2], state[3], state[4], en_words)
            if is_en
            else state[2]
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

    text = normalize_indic_text(
        "".join(tokens),
        dedup=dedup_marks,
        normalize_nfc=normalize_nfc,
        space_marker=space_marker,
    )
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
