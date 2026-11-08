"""Python Streaming Audio Transcription Pipeline with Stabilized Prefix Locking."""

import re
import time
from dataclasses import dataclass, field
from typing import Callable, List, Optional, Union
import numpy as np

from .engine import AcousticEngine, TranscriptionResult
from .normalizer import normalize_indic_text, join_subwords


def _is_en_vocab(vocab: Union[List[str], dict]) -> bool:
    if not isinstance(vocab, list) or len(vocab) < 200:
        return False
    probe = "".join(vocab[2:12])
    return any("a" <= ch <= "z" for ch in probe)


def _format_en_display(text: str) -> str:
    if not text:
        return text
    out = re.sub(r"^[a-z]", lambda m: m.group(0).upper(), text)
    out = re.sub(r"([.?!]\s+)([a-z])", lambda m: m.group(1) + m.group(2).upper(), out)
    out = re.sub(r"\bi(?=(?:['’](?:m|ve|ll|d))?\b)", "I", out)
    return out


@dataclass
class StreamingTranscript:
    text: str
    committed: str
    volatile: str
    is_final: bool
    tokens: List[str]
    duration_ms: float
    inference_ms: float
    rtf: float


class StreamingCTCDecoder:
    """Stabilized Prefix-Locking CTC Decoder in Python.

    Maintains committed prefix tokens and provisional unconfirmed trailing tokens.
    Prevents boundary token flicker on partial transcripts.
    """

    def __init__(
        self,
        vocab: Union[List[str], dict],
        stability_threshold: int = 2,
        trail_tokens: int = 3,
        suffix_window_tokens: int = 15,
        require_stability_on_word_boundary: bool = False,
        high_stability_threshold: int = 4,
    ):
        self.vocab = vocab
        self.stability_threshold = stability_threshold
        self.trail_tokens = trail_tokens
        self.suffix_window_tokens = suffix_window_tokens
        self.require_stability_on_word_boundary = require_stability_on_word_boundary
        self.high_stability_threshold = high_stability_threshold
        self._is_english = _is_en_vocab(vocab)
        self.committed_tokens: List[str] = []
        self.committed_text: str = ""
        self.last_hyp_tokens: List[str] = []
        self.token_stability_counts: List[int] = []

        # O(1) Incremental Prefix Normalization State
        self._frozen_text: str = ""
        self._frozen_token_count: int = 0
        self._last_committed_count: int = 0

    def reset(self) -> None:
        self.committed_tokens.clear()
        self.committed_text = ""
        self.last_hyp_tokens.clear()
        self.token_stability_counts.clear()
        self._frozen_text = ""
        self._frozen_token_count = 0
        self._last_committed_count = 0

    def _update_committed_text(self) -> str:
        """Incrementally computes and caches committed_text in O(1) time."""
        n_comm = len(self.committed_tokens)
        if n_comm == 0:
            self.committed_text = ""
            return ""

        # O(1) Fast Path: No new tokens were committed in this chunk
        if n_comm == self._last_committed_count:
            return self.committed_text

        self._last_committed_count = n_comm

        # Bounded Prefix Freezing: Freeze tokens older than suffix_window_tokens
        unfrozen_count = n_comm - self._frozen_token_count
        if unfrozen_count > self.suffix_window_tokens:
            freeze_limit = n_comm - self.suffix_window_tokens

            # Look for a clean word boundary (starts with space marker)
            freeze_idx = -1
            for idx in range(freeze_limit, self._frozen_token_count, -1):
                tok = self.committed_tokens[idx]
                if tok.startswith("\u2581") or tok.startswith("▁") or tok.startswith(" "):
                    freeze_idx = idx
                    break

            if freeze_idx > self._frozen_token_count:
                full_unfrozen = normalize_indic_text("".join(self.committed_tokens[self._frozen_token_count:]))
                while freeze_idx > self._frozen_token_count:
                    new_slice = self.committed_tokens[self._frozen_token_count:freeze_idx]
                    rem_slice = self.committed_tokens[freeze_idx:]
                    slice_text = normalize_indic_text("".join(new_slice))
                    rem_text = normalize_indic_text("".join(rem_slice))
                    joined_unfrozen = (
                        f"{slice_text} {rem_text}".strip()
                        if (slice_text and rem_text)
                        else (slice_text or rem_text)
                    )
                    if joined_unfrozen == full_unfrozen:
                        break
                    prev_idx = -1
                    for k_idx in range(freeze_idx - 1, self._frozen_token_count, -1):
                        kt = self.committed_tokens[k_idx]
                        if kt.startswith("\u2581") or kt.startswith("▁") or kt.startswith(" "):
                            prev_idx = k_idx
                            break
                    freeze_idx = prev_idx if prev_idx > self._frozen_token_count else self._frozen_token_count

            if freeze_idx > self._frozen_token_count:
                new_slice = self.committed_tokens[self._frozen_token_count:freeze_idx]
                slice_text = normalize_indic_text("".join(new_slice))
                if slice_text:
                    if self._frozen_text:
                        self._frozen_text = f"{self._frozen_text} {slice_text}"
                    else:
                        self._frozen_text = slice_text
                self._frozen_token_count = freeze_idx
            elif unfrozen_count > self.suffix_window_tokens * 2 and not any(
                t.startswith(("\u2581", "▁", " "))
                for t in self.committed_tokens[self._frozen_token_count + 1 :]
            ):
                # Fallback ONLY for continuous compound words without spaces: freeze at window midpoint
                freeze_idx = self._frozen_token_count + self.suffix_window_tokens
                new_slice = self.committed_tokens[self._frozen_token_count:freeze_idx]
                slice_text = normalize_indic_text("".join(new_slice))
                if slice_text:
                    if self._frozen_text:
                        self._frozen_text = f"{self._frozen_text}{slice_text}"
                    else:
                        self._frozen_text = slice_text
                self._frozen_token_count = freeze_idx

        # Normalize only the active suffix window tokens (<= suffix_window_tokens)
        suffix_tokens = self.committed_tokens[self._frozen_token_count:]
        if suffix_tokens:
            suffix_text = normalize_indic_text("".join(suffix_tokens))
            if self._frozen_text and suffix_text:
                first_tok = suffix_tokens[0]
                if first_tok.startswith("\u2581") or first_tok.startswith("▁") or first_tok.startswith(" "):
                    self.committed_text = f"{self._frozen_text} {suffix_text}"
                else:
                    self.committed_text = f"{self._frozen_text}{suffix_text}"
            elif self._frozen_text:
                self.committed_text = self._frozen_text
            else:
                self.committed_text = suffix_text
        else:
            self.committed_text = self._frozen_text

        return self.committed_text

    def update(
        self,
        raw_tokens: List[str],
        is_stream_end: bool = False,
        duration_ms: float = 0.0,
        inference_ms: float = 0.0,
        allow_commit: bool = True,
    ) -> StreamingTranscript:
        if is_stream_end:
            if len(raw_tokens) > len(self.committed_tokens):
                all_tokens = self.committed_tokens + raw_tokens[len(self.committed_tokens):]
            else:
                all_tokens = list(self.committed_tokens) if self.committed_tokens else list(raw_tokens)
            norm_text = normalize_indic_text("".join(all_tokens))
            full_text = _format_en_display(norm_text) if self._is_english else norm_text
            self.reset()
            rtf = (inference_ms / duration_ms) if duration_ms > 0 else 0.0
            return StreamingTranscript(
                text=full_text,
                committed=full_text,
                volatile="",
                is_final=True,
                tokens=all_tokens,
                duration_ms=duration_ms,
                inference_ms=inference_ms,
                rtf=rtf,
            )

        already_committed = len(self.committed_tokens)

        # Longest Common Prefix with previous hypothesis
        common_len = 0
        min_len = min(len(self.last_hyp_tokens), len(raw_tokens))
        while common_len < min_len and self.last_hyp_tokens[common_len] == raw_tokens[common_len]:
            common_len += 1

        new_stability: List[int] = []
        for i in range(len(raw_tokens)):
            if i < common_len:
                prev_count = self.token_stability_counts[i] if i < len(self.token_stability_counts) else 0
                new_stability.append(prev_count + 1)
            else:
                new_stability.append(1)
        self.token_stability_counts = new_stability

        lockable_limit = max(0, len(raw_tokens) - self.trail_tokens) if allow_commit else 0

        # 1. Compute contiguous stable run from already_committed
        stable_limit = already_committed
        while stable_limit < lockable_limit and self.token_stability_counts[stable_limit] >= self.stability_threshold:
            stable_limit += 1

        # 2. Strict word-boundary-gated commitment
        commit_idx = already_committed
        if stable_limit > already_committed:
            closed_word_end = already_committed
            has_boundary_ahead = False

            for j in range(already_committed + 1, len(raw_tokens)):
                tok = raw_tokens[j]
                is_boundary = bool(
                    tok and tok[0] in ("\u2581", "\u2582", "\u2583", "▁", " ", "\t")
                )
                if is_boundary:
                    has_boundary_ahead = True
                    j_stable = (
                        self.token_stability_counts[j] >= self.stability_threshold
                        if self.require_stability_on_word_boundary
                        else True
                    )
                    if j <= stable_limit and j_stable:
                        closed_word_end = j
                    else:
                        break

            if has_boundary_ahead:
                commit_idx = closed_word_end
            else:
                # Fallback for continuous compound words without word boundaries
                for i in range(already_committed, stable_limit):
                    if self.token_stability_counts[i] >= self.high_stability_threshold:
                        commit_idx = i + 1
                    else:
                        break

        # Guard: never advance commit_idx to leave only whitespace in volatile_tokens,
        # violate strict prefix monotonicity on committed_text, or split mid-sandhi.
        prev_raw_comm = (
            normalize_indic_text("".join(self.committed_tokens))
            if already_committed > 0
            else ""
        )
        full_norm_check = normalize_indic_text("".join(raw_tokens))
        while commit_idx > already_committed:
            cand_prefix = normalize_indic_text("".join(raw_tokens[:commit_idx]))
            if (
                normalize_indic_text("".join(raw_tokens[commit_idx:])) == ""
                or not full_norm_check.startswith(cand_prefix)
                or (prev_raw_comm and not cand_prefix.startswith(prev_raw_comm))
                or (cand_prefix.endswith("\u0c21\u0c02") and len(raw_tokens) - commit_idx < 7)
            ):
                commit_idx -= 1
            else:
                break

        # 3. Commit confirmed tokens
        for i in range(already_committed, commit_idx):
            self.committed_tokens.append(raw_tokens[i])

        self.last_hyp_tokens = list(raw_tokens)

        raw_committed_str = self._update_committed_text()
        committed_str = _format_en_display(raw_committed_str) if self._is_english else raw_committed_str
        if self._is_english:
            self.committed_text = committed_str
        volatile_tokens = raw_tokens[len(self.committed_tokens):]
        volatile_str = normalize_indic_text("".join(volatile_tokens)) if volatile_tokens else ""
        if self._is_english and volatile_str:
            if not committed_str:
                volatile_str = _format_en_display(volatile_str)
            else:
                volatile_str = re.sub(r"\bi(?=(?:['’](?:m|ve|ll|d))?\b)", "I", volatile_str)
                if re.search(r"[.?!]\s*$", committed_str):
                    volatile_str = re.sub(r"^[a-z]", lambda m: m.group(0).upper(), volatile_str)

        raw_full_text = join_subwords(committed_str, volatile_str, volatile_tokens)
        full_text = _format_en_display(raw_full_text) if self._is_english else raw_full_text
        rtf = (inference_ms / duration_ms) if duration_ms > 0 else 0.0

        return StreamingTranscript(
            text=full_text,
            committed=committed_str,
            volatile=volatile_str,
            is_final=False,
            tokens=raw_tokens,
            duration_ms=duration_ms,
            inference_ms=inference_ms,
            rtf=rtf,
        )


class SwanadaStream:
    """Real-Time Streaming ASR Pipeline in Python with Sliding Chunk Windows."""

    def __init__(
        self,
        engine: AcousticEngine,
        chunk_size_samples: int = 5120,     # 320 ms
        left_context_samples: int = 25600,   # 1,600 ms
        max_buffer_samples: int = 61440,     # 3,840 ms
        vad_silence_threshold: float = 0.005,
    ):
        self.engine = engine
        self.decoder = StreamingCTCDecoder(
            engine.vocab,
            trail_tokens=3,
            require_stability_on_word_boundary=True,
        )
        self.chunk_size_samples = chunk_size_samples
        self.left_context_samples = left_context_samples
        self.max_buffer_samples = max_buffer_samples
        self.vad_silence_threshold = vad_silence_threshold
        if self.chunk_size_samples <= 1600:
            self.infer_interval_samples = 6400
        elif self.chunk_size_samples <= 2560:
            self.infer_interval_samples = 4800
        else:
            self.infer_interval_samples = 0

        self.audio_buffer = np.zeros(0, dtype=np.float32)
        self.pending_chunk = np.zeros(0, dtype=np.float32)
        self.total_audio_samples = 0
        self.consecutive_silent_chunks = 0
        self.consecutive_silent_samples = 0
        self.pause_threshold_samples = 8000  # 500 ms @ 16 kHz turn-segmentation threshold
        self.base_committed_tokens: List[str] = []
        self.is_window_sliding = False
        self.is_finished = False
        self.samples_since_last_inference: int = 0
        self.pending_turn_flush: bool = False
        self.push_count: int = 0
        self.last_transcript: Optional[StreamingTranscript] = None
        self.has_untranscribed_tail: bool = False
        self.listeners_partial: List[Callable[[StreamingTranscript], None]] = []
        self.listeners_final: List[Callable[[TranscriptionResult], None]] = []
        self.listeners_error: List[Callable[[Exception], None]] = []

    def on_partial(self, callback: Callable[[StreamingTranscript], None]) -> None:
        self.listeners_partial.append(callback)

    def on_final(self, callback: Callable[[TranscriptionResult], None]) -> None:
        self.listeners_final.append(callback)

    def on_error(self, callback: Callable[[Exception], None]) -> None:
        self.listeners_error.append(callback)

    def on(self, event: str, callback: Callable) -> "SwanadaStream":
        if event == "partial":
            self.on_partial(callback)
        elif event == "final":
            self.on_final(callback)
        elif event == "error":
            self.on_error(callback)
        return self

    def _emit_error(self, err: Exception) -> None:
        if self.listeners_error:
            for ecb in self.listeners_error:
                try:
                    ecb(err)
                except Exception:
                    pass
        else:
            import sys
            print(f"[swanada] Stream callback error: {err}", file=sys.stderr)

    def _align_growing_window(
        self,
        committed_tokens: List[str],
        window_tokens: List[str],
        base_len: int,
    ) -> List[str]:
        c_len = len(committed_tokens)
        if c_len <= base_len or not window_tokens:
            return window_tokens

        search_from = max(base_len, c_len - 8)
        min_end = max(base_len + 1, c_len - 4)
        max_end = min(len(window_tokens), c_len + 5)

        best_end = -1
        best_match_len = 0
        best_dist = 999

        for r_end in range(min_end, max_end + 1):
            match_len = 0
            while (
                c_len - 1 - match_len >= search_from
                and r_end - 1 - match_len >= base_len
                and committed_tokens[c_len - 1 - match_len] == window_tokens[r_end - 1 - match_len]
            ):
                match_len += 1
            if match_len > 0:
                dist = abs(r_end - c_len)
                if match_len > best_match_len or (match_len == best_match_len and dist < best_dist):
                    best_match_len = match_len
                    best_end = r_end
                    best_dist = dist

        if best_match_len > 0 and best_end >= 0:
            return list(committed_tokens) + window_tokens[best_end:]

        if c_len - 1 > base_len:
            for r_mid in range(max(base_len + 1, c_len - 5), min(len(window_tokens), c_len + 4) + 1):
                match_len = 0
                while (
                    c_len - 2 - match_len >= search_from
                    and r_mid - 1 - match_len >= base_len
                    and committed_tokens[c_len - 2 - match_len] == window_tokens[r_mid - 1 - match_len]
                ):
                    match_len += 1
                if match_len > 0:
                    r_end = min(len(window_tokens), r_mid + 1)
                    dist = abs(r_end - c_len)
                    if match_len > best_match_len or (match_len == best_match_len and dist < best_dist):
                        best_match_len = match_len
                        best_end = r_end
                        best_dist = dist
            if best_match_len > 0 and best_end >= 0:
                return list(committed_tokens) + window_tokens[best_end:]

        return list(committed_tokens) + window_tokens[min(len(window_tokens), c_len):]

    def _promote_pending_turn(self) -> None:
        last_hyp = list(self.decoder.last_hyp_tokens)
        comm = list(self.decoder.committed_tokens)
        if len(last_hyp) > len(comm) and last_hyp[:len(comm)] == comm:
            prev_comm_str = self.decoder.committed_text
            cand_raw = normalize_indic_text("".join(last_hyp))
            cand_str = _format_en_display(cand_raw) if self.decoder._is_english else cand_raw
            if not prev_comm_str or cand_str.startswith(prev_comm_str):
                self.decoder.committed_tokens = list(last_hyp)
                raw_updated = self.decoder._update_committed_text()
                self.decoder.committed_text = (
                    _format_en_display(raw_updated) if self.decoder._is_english else raw_updated
                )
        self.base_committed_tokens = list(self.decoder.committed_tokens)
        self.pending_turn_flush = False

    def _transcribe_buffer(self, buf: np.ndarray, is_partial: bool = False) -> TranscriptionResult:
        if is_partial and getattr(self.engine, "_supports_is_partial", False):
            return self.engine.transcribe(buf, is_partial=True)
        return self.engine.transcribe(buf)

    def _find_window_alignment(self, committed_tokens: List[str], raw_tokens: List[str]) -> tuple[int, int]:
        if not committed_tokens or not raw_tokens:
            return len(committed_tokens), 0

        search_limit = max(len(self.base_committed_tokens), len(committed_tokens) - 30)
        active_comm_len = len(committed_tokens) - len(self.base_committed_tokens)
        min_req_match = 2 if active_comm_len >= 2 else 1

        best_offset = len(committed_tokens)
        best_raw_start = 0
        best_match_len = 0

        for r_start in range(len(raw_tokens)):
            for j in range(search_limit, len(committed_tokens)):
                match_len = 0
                while (
                    j + match_len < len(committed_tokens)
                    and r_start + match_len < len(raw_tokens)
                    and committed_tokens[j + match_len] == raw_tokens[r_start + match_len]
                ):
                    match_len += 1
                if (
                    j + match_len == len(committed_tokens)
                    and match_len >= min_req_match
                    and match_len > best_match_len
                ):
                    best_match_len = match_len
                    best_offset = j
                    best_raw_start = r_start

        if best_match_len > 0:
            return best_offset, best_raw_start

        # Near-suffix match (within 1 token of end when boundary token revised)
        for r_start in range(len(raw_tokens)):
            for j in range(search_limit, len(committed_tokens)):
                match_len = 0
                while (
                    j + match_len < len(committed_tokens)
                    and r_start + match_len < len(raw_tokens)
                    and committed_tokens[j + match_len] == raw_tokens[r_start + match_len]
                ):
                    match_len += 1
                if (
                    j + match_len >= len(committed_tokens) - 1
                    and match_len >= 2
                    and match_len > best_match_len
                ):
                    best_match_len = match_len
                    best_offset = j
                    best_raw_start = r_start

        if best_match_len >= 2:
            return best_offset, best_raw_start

        return len(committed_tokens), 0

    def _segment_turn_on_pause(self, duration_ms: float) -> bool:
        did_infer = False
        if len(self.audio_buffer) >= 4800:
            if self.has_untranscribed_tail or not self.decoder.last_hyp_tokens:
                try:
                    use_tail_slice = (
                        self.is_window_sliding
                        or (
                            self.chunk_size_samples <= 1600
                            and len(self.decoder.committed_tokens) - len(self.base_committed_tokens) >= 6
                            and len(self.audio_buffer) > 40000
                        )
                    )
                    eval_buf = (
                        self.audio_buffer[-36000:]
                        if (
                            not self.is_window_sliding
                            and use_tail_slice
                            and len(self.audio_buffer) > 36000
                        )
                        else (
                            self.audio_buffer[-self.max_buffer_samples:]
                            if (self.is_window_sliding and len(self.audio_buffer) > self.max_buffer_samples)
                            else self.audio_buffer
                        )
                    )
                    tail_res = self._transcribe_buffer(eval_buf, is_partial=True)
                    did_infer = True
                    if tail_res and tail_res.tokens:
                        if self.pending_turn_flush:
                            self._promote_pending_turn()
                        committed = list(self.decoder.committed_tokens)
                        if not use_tail_slice:
                            global_tokens = self._align_growing_window(
                                committed,
                                self.base_committed_tokens + tail_res.tokens,
                                len(self.base_committed_tokens),
                            )
                        else:
                            bo, br = self._find_window_alignment(committed, tail_res.tokens)
                            global_tokens = committed[:bo] + tail_res.tokens[br:]
                        self.last_transcript = self.decoder.update(
                            global_tokens, False, duration_ms, 0.0, allow_commit=False
                        )
                except Exception as e:
                    self._emit_error(e)
            self.pending_turn_flush = True
            self.audio_buffer = np.zeros(0, dtype=np.float32)
            self.pending_chunk = np.zeros(0, dtype=np.float32)
            self.is_window_sliding = False
            self.samples_since_last_inference = 0
            self.has_untranscribed_tail = False
        return did_infer

    def _has_speech_energy(self, buf: np.ndarray) -> bool:
        if len(buf) == 0:
            return False
        if float(np.sqrt(np.mean(buf ** 2))) >= self.vad_silence_threshold:
            return True
        step = 400
        for off in range(0, len(buf) - step + 1, step):
            sub = buf[off : off + step]
            if float(np.sqrt(np.mean(sub ** 2))) >= self.vad_silence_threshold:
                return True
        return False

    def _cached_or_empty_transcript(self, duration_ms: float) -> StreamingTranscript:
        if self.last_transcript is not None:
            return StreamingTranscript(
                text=self.last_transcript.text,
                committed=self.last_transcript.committed,
                volatile=self.last_transcript.volatile,
                is_final=False,
                tokens=self.last_transcript.tokens,
                duration_ms=duration_ms,
                inference_ms=0.0,
                rtf=(self.last_transcript.inference_ms / duration_ms) if duration_ms > 0 else 0.0,
            )
        comm_txt = self.decoder.committed_text
        return StreamingTranscript(
            text=comm_txt,
            committed=comm_txt,
            volatile="",
            is_final=False,
            tokens=list(self.decoder.committed_tokens),
            duration_ms=duration_ms,
            inference_ms=0.0,
            rtf=0.0,
        )

    def push(self, chunk: np.ndarray) -> Optional[StreamingTranscript]:
        if self.is_finished or len(chunk) == 0:
            return None

        chunk_float = chunk.astype(np.float32)
        chunk_len = len(chunk_float)
        self.total_audio_samples += chunk_len
        self.push_count += 1
        duration_ms = (self.total_audio_samples / 16000.0) * 1000.0

        # Coalesce sub-200ms (< 3200 sample) micro-chunks BEFORE VAD so 20ms-80ms plosive
        # stop consonant closures are never dropped from inside spoken words.
        if chunk_len < 3200 or len(self.pending_chunk) > 0:
            self.pending_chunk = (
                np.concatenate([self.pending_chunk, chunk_float])
                if len(self.pending_chunk) > 0
                else chunk_float
            )
            p_len = len(self.pending_chunk)
            p_rms = float(np.sqrt(np.mean(self.pending_chunk ** 2))) if p_len > 0 else 0.0

            if self.last_transcript is None:
                if p_len < 1600:
                    if self.total_audio_samples < 1600:
                        return None
                    return self._cached_or_empty_transcript(duration_ms)
                if p_len < 3200 and p_rms < self.vad_silence_threshold:
                    return self._cached_or_empty_transcript(duration_ms)
            elif p_len < 3200:
                st = self._cached_or_empty_transcript(duration_ms)
                if not self.pending_turn_flush and p_rms >= self.vad_silence_threshold:
                    for cb in self.listeners_partial:
                        try:
                            cb(st)
                        except Exception as e:
                            self._emit_error(e)
                return st

            chunk_float = self.pending_chunk
            chunk_len = len(chunk_float)
            self.pending_chunk = np.zeros(0, dtype=np.float32)

        # Non-destructive silence check & sub-frame pause utterance segmentation
        rms = float(np.sqrt(np.mean(chunk_float ** 2))) if chunk_len > 0 else 0.0
        if rms < self.vad_silence_threshold:
            self.consecutive_silent_samples += chunk_len
            if self.consecutive_silent_samples >= self.pause_threshold_samples:
                self._segment_turn_on_pause(duration_ms)
            if self.total_audio_samples < 1600:
                return None
            return self._cached_or_empty_transcript(duration_ms)

        step = 400
        lead_silent = 0
        while lead_silent + step <= chunk_len:
            sub = chunk_float[lead_silent : lead_silent + step]
            if float(np.sqrt(np.mean(sub ** 2))) < self.vad_silence_threshold:
                lead_silent += step
            else:
                break

        trail_silent = 0
        while trail_silent + step <= chunk_len - lead_silent:
            start_idx = chunk_len - trail_silent - step
            sub = chunk_float[start_idx : start_idx + step]
            if float(np.sqrt(np.mean(sub ** 2))) < self.vad_silence_threshold:
                trail_silent += step
            else:
                break

        if lead_silent > 0 and (self.consecutive_silent_samples + lead_silent) >= self.pause_threshold_samples:
            did_pause_infer = self._segment_turn_on_pause(duration_ms)
            chunk_float = chunk_float[lead_silent:]
            chunk_len = len(chunk_float)
            self.consecutive_silent_samples = trail_silent
            if chunk_len == 0:
                return self._cached_or_empty_transcript(duration_ms)
            if did_pause_infer:
                self.audio_buffer = np.concatenate([self.audio_buffer, chunk_float])
                self.samples_since_last_inference += chunk_len
                self.has_untranscribed_tail = True
                return self._cached_or_empty_transcript(duration_ms)

        self.consecutive_silent_samples = trail_silent

        self.audio_buffer = np.concatenate([self.audio_buffer, chunk_float])
        self.samples_since_last_inference += chunk_len

        if len(self.audio_buffer) < 1600:
            self.has_untranscribed_tail = True
            if self.total_audio_samples < 1600:
                return None
            return self._cached_or_empty_transcript(duration_ms)

        if (
            self.infer_interval_samples > 0
            and self.last_transcript is not None
            and not self.pending_turn_flush
            and self.samples_since_last_inference < self.infer_interval_samples
        ):
            self.has_untranscribed_tail = True
            if len(self.audio_buffer) > self.max_buffer_samples:
                self.audio_buffer = self.audio_buffer[-self.left_context_samples:]
                self.is_window_sliding = True
            st = StreamingTranscript(
                text=self.last_transcript.text,
                committed=self.last_transcript.committed,
                volatile=self.last_transcript.volatile,
                is_final=False,
                tokens=self.last_transcript.tokens,
                duration_ms=duration_ms,
                inference_ms=0.0,
                rtf=(self.last_transcript.inference_ms / duration_ms) if duration_ms > 0 else 0.0,
            )
            for cb in self.listeners_partial:
                try:
                    cb(st)
                except Exception as e:
                    self._emit_error(e)
            return st

        use_partial_tail_slice = (
            self.is_window_sliding
            or (
                self.chunk_size_samples <= 1600
                and len(self.decoder.committed_tokens) - len(self.base_committed_tokens) >= 6
                and len(self.audio_buffer) > 40000
            )
        )
        eval_buf = (
            self.audio_buffer[-36000:]
            if (
                not self.is_window_sliding
                and use_partial_tail_slice
                and len(self.audio_buffer) > 36000
            )
            else (
                self.audio_buffer[-self.max_buffer_samples:]
                if (self.is_window_sliding and len(self.audio_buffer) > self.max_buffer_samples)
                else self.audio_buffer
            )
        )

        t0 = time.perf_counter()
        res = self._transcribe_buffer(eval_buf, is_partial=True)
        inference_ms = (time.perf_counter() - t0) * 1000.0
        self.samples_since_last_inference = 0
        self.has_untranscribed_tail = False

        if self.pending_turn_flush and res.tokens:
            self._promote_pending_turn()

        committed = list(self.decoder.committed_tokens)
        if self.pending_turn_flush and not res.tokens:
            last_hyp = list(self.decoder.last_hyp_tokens)
            global_tokens = last_hyp if len(last_hyp) > len(committed) else committed
        elif not use_partial_tail_slice:
            window_tokens = self.base_committed_tokens + res.tokens
            global_tokens = self._align_growing_window(
                committed, window_tokens, len(self.base_committed_tokens)
            )
        else:
            best_offset, best_raw_start = self._find_window_alignment(
                committed, res.tokens
            )
            global_tokens = committed[:best_offset] + res.tokens[best_raw_start:]

        # Preserve active volatile tokens across momentary mid-utterance breath frames
        prev_hyp = list(self.decoder.last_hyp_tokens)
        if len(prev_hyp) > len(committed) and (
            len(global_tokens) <= len(committed)
            or normalize_indic_text("".join(global_tokens[len(committed):])) == ""
        ):
            global_tokens = committed + prev_hyp[len(committed):]

        commit_min_samples = (
            28800 if (self.decoder._is_english or self.chunk_size_samples <= 3200) else 34000
        )
        allow_commit = (not self.pending_turn_flush) and (
            self.is_window_sliding or len(self.audio_buffer) >= commit_min_samples
        )
        st = self.decoder.update(global_tokens, False, duration_ms, inference_ms, allow_commit=allow_commit)
        self.last_transcript = st

        for cb in self.listeners_partial:
            try:
                cb(st)
            except Exception as e:
                self._emit_error(e)

        if len(self.audio_buffer) > self.max_buffer_samples:
            self.audio_buffer = self.audio_buffer[-self.left_context_samples:]
            self.is_window_sliding = True

        return st

    def finish(self) -> TranscriptionResult:
        self.is_finished = True
        duration_ms = (self.total_audio_samples / 16000.0) * 1000.0
        t0 = time.perf_counter()

        if len(self.pending_chunk) > 0:
            if (len(self.audio_buffer) > 0 and not self.pending_turn_flush) or self._has_speech_energy(self.pending_chunk):
                self.audio_buffer = np.concatenate([self.audio_buffer, self.pending_chunk])
                self.has_untranscribed_tail = True
            self.pending_chunk = np.zeros(0, dtype=np.float32)

        # Run final full-utterance closure decode when active audio buffer has speech
        if len(self.audio_buffer) >= 400:
            eval_buf = (
                self.audio_buffer[-self.max_buffer_samples:]
                if (self.is_window_sliding and len(self.audio_buffer) > self.max_buffer_samples)
                else self.audio_buffer
            )
            tail_res = self._transcribe_buffer(eval_buf, is_partial=False)
            if (tail_res and tail_res.tokens) or not self.decoder.last_hyp_tokens:
                if self.pending_turn_flush and tail_res and tail_res.tokens:
                    self._promote_pending_turn()
                committed = list(self.decoder.committed_tokens)
                if not self.is_window_sliding:
                    window_tokens = self.base_committed_tokens + tail_res.tokens
                    global_tokens = self._align_growing_window(
                        committed, window_tokens, len(self.base_committed_tokens)
                    )
                else:
                    best_offset, best_raw_start = self._find_window_alignment(
                        committed, tail_res.tokens
                    )
                    global_tokens = committed[:best_offset] + tail_res.tokens[best_raw_start:]
                self.decoder.update(global_tokens, False, duration_ms, 0.0, allow_commit=True)

        streaming_tokens = (
            list(self.decoder.last_hyp_tokens)
            if self.decoder.last_hyp_tokens
            else list(self.decoder.committed_tokens)
        )

        inference_ms = (time.perf_counter() - t0) * 1000.0
        final_st = self.decoder.update(streaming_tokens, True, duration_ms, inference_ms)

        # Free buffer memory immediately
        self.audio_buffer = np.zeros(0, dtype=np.float32)
        self.pending_chunk = np.zeros(0, dtype=np.float32)
        self.total_audio_samples = 0
        self.consecutive_silent_chunks = 0
        self.consecutive_silent_samples = 0
        self.base_committed_tokens.clear()
        self.is_window_sliding = False
        self.samples_since_last_inference = 0
        self.pending_turn_flush = False
        self.push_count = 0
        self.last_transcript = None
        self.has_untranscribed_tail = False

        result = TranscriptionResult(
            text=final_st.text,
            language=self.engine.language,
            duration_ms=duration_ms,
            inference_ms=inference_ms,
            rtf=(inference_ms / duration_ms) if duration_ms > 0 else 0.0,
            tokens=final_st.tokens,
        )

        for cb in self.listeners_final:
            try:
                cb(result)
            except Exception as e:
                self._emit_error(e)

        return result

    def reset(self) -> None:
        """Reset stream session state for fresh streaming without re-instantiating."""
        self.audio_buffer = np.zeros(0, dtype=np.float32)
        self.pending_chunk = np.zeros(0, dtype=np.float32)
        self.total_audio_samples = 0
        self.consecutive_silent_chunks = 0
        self.consecutive_silent_samples = 0
        self.base_committed_tokens.clear()
        self.is_window_sliding = False
        self.is_finished = False
        self.samples_since_last_inference = 0
        self.pending_turn_flush = False
        self.push_count = 0
        self.last_transcript = None
        self.has_untranscribed_tail = False
        self.decoder.reset()
