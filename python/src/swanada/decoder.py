"""Linear-time O(T * V) Greedy CTC Decoder in Python.

Compatible with NumPy arrays and standard Python lists.
"""

from dataclasses import dataclass
from typing import Dict, List, Optional, Union
import numpy as np

from .normalizer import normalize_indic_text


@dataclass
class CTCDecodeResult:
    text: str
    tokens: List[str]
    token_ids: List[int]


def is_special_token(token: str) -> bool:
    """Check if token is a special non-speech token like <unk>, <blank>, [PAD], etc."""
    if not token:
        return False
    return (token.startswith("<") and token.endswith(">")) or \
           (token.startswith("[") and token.endswith("]"))


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
    """Linear-time greedy CTC decoding over logits or log-probabilities."""
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
    """Decode from pre-computed argmax token IDs."""
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

        tok = vocab[idx] if (isinstance(vocab, list) and idx < len(vocab)) or (isinstance(vocab, dict) and idx in vocab) else ""
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

            tok = self.vocab[idx] if (isinstance(self.vocab, list) and idx < len(self.vocab)) or (isinstance(self.vocab, dict) and idx in self.vocab) else ""
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
