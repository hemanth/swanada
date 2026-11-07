"""Python Streaming Audio Transcription Pipeline with Stabilized Prefix Locking."""

import time
from dataclasses import dataclass, field
from typing import Callable, List, Optional, Union
import numpy as np

from .engine import AcousticEngine, TranscriptionResult
from .normalizer import normalize_indic_text, join_subwords


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
                new_slice = self.committed_tokens[self._frozen_token_count:freeze_idx]
                slice_text = normalize_indic_text("".join(new_slice))
                if slice_text:
                    if self._frozen_text:
                        self._frozen_text = f"{self._frozen_text} {slice_text}"
                    else:
                        self._frozen_text = slice_text
                self._frozen_token_count = freeze_idx
            elif unfrozen_count > self.suffix_window_tokens * 2:
                # Fallback for continuous compound words without spaces: freeze at window midpoint
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
            full_text = normalize_indic_text("".join(all_tokens))
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

        # 3. Commit confirmed tokens
        for i in range(already_committed, commit_idx):
            self.committed_tokens.append(raw_tokens[i])

        self.last_hyp_tokens = list(raw_tokens)

        committed_str = self._update_committed_text()
        volatile_tokens = raw_tokens[len(self.committed_tokens):]
        volatile_str = normalize_indic_text("".join(volatile_tokens)) if volatile_tokens else ""

        full_text = join_subwords(committed_str, volatile_str, volatile_tokens)
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
        left_context_samples: int = 30720,   # 1,920 ms
        max_buffer_samples: int = 61440,     # 3,840 ms
        vad_silence_threshold: float = 0.005,
    ):
        self.engine = engine
        self.decoder = StreamingCTCDecoder(
            engine.vocab,
            trail_tokens=5,
            require_stability_on_word_boundary=True,
        )
        self.chunk_size_samples = chunk_size_samples
        self.left_context_samples = left_context_samples
        self.max_buffer_samples = max_buffer_samples
        self.vad_silence_threshold = vad_silence_threshold

        self.audio_buffer = np.zeros(0, dtype=np.float32)
        self.total_audio_samples = 0
        self.consecutive_silent_chunks = 0
        self.consecutive_silent_samples = 0
        self.pause_threshold_samples = 16000  # 1,000 ms @ 16 kHz (true turn boundary)
        self.base_committed_tokens: List[str] = []
        self.is_window_sliding = False
        self.is_finished = False
        if self.chunk_size_samples <= 800:
            self.stride = max(2, 3200 // max(1, self.chunk_size_samples))
        elif self.chunk_size_samples <= 1600:
            self.stride = 6
        elif self.chunk_size_samples <= 2560:
            self.stride = 2
        else:
            self.stride = 1
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

    def _find_window_alignment(self, committed_tokens: List[str], raw_tokens: List[str]) -> tuple[int, int]:
        if not committed_tokens or not raw_tokens:
            return len(committed_tokens), 0

        search_limit = max(0, len(committed_tokens) - 30)
        best_offset = len(committed_tokens)
        best_raw_start = 0
        best_match_len = 0

        for r_start in range(len(raw_tokens)):
            for j in range(len(committed_tokens) - 1, search_limit - 1, -1):
                match_len = 0
                while (
                    j + match_len < len(committed_tokens)
                    and r_start + match_len < len(raw_tokens)
                    and committed_tokens[j + match_len] == raw_tokens[r_start + match_len]
                ):
                    match_len += 1
                if j + match_len == len(committed_tokens) and match_len > best_match_len:
                    best_match_len = match_len
                    best_offset = j
                    best_raw_start = r_start
                    if match_len >= 2:
                        break
            if best_match_len >= 2:
                break

        if best_match_len > 0:
            return best_offset, best_raw_start

        # Near-suffix match (within 1 token of end) when boundary token revised
        for r_start in range(len(raw_tokens)):
            for j in range(len(committed_tokens) - 1, search_limit - 1, -1):
                match_len = 0
                while (
                    j + match_len < len(committed_tokens)
                    and r_start + match_len < len(raw_tokens)
                    and committed_tokens[j + match_len] == raw_tokens[r_start + match_len]
                ):
                    match_len += 1
                if j + match_len >= len(committed_tokens) - 1 and match_len > best_match_len:
                    best_match_len = match_len
                    best_offset = j
                    best_raw_start = r_start
                    if match_len >= 2:
                        break
            if best_match_len >= 2:
                break

        if best_match_len >= 2:
            return best_offset, best_raw_start

        return len(committed_tokens), 0

    def push(self, chunk: np.ndarray) -> Optional[StreamingTranscript]:
        if self.is_finished or len(chunk) == 0:
            return None

        chunk_float = chunk.astype(np.float32)
        chunk_len = len(chunk_float)
        self.total_audio_samples += chunk_len
        self.push_count += 1

        # Stride-2 inference scheduling for low-latency streaming
        if (
            self.chunk_size_samples <= 2560
            and chunk_len <= 2560
            and self.push_count > 1
            and (self.push_count % self.stride != 0)
            and self.last_transcript is not None
        ):
            self.audio_buffer = np.concatenate([self.audio_buffer, chunk_float])
            self.has_untranscribed_tail = True

            if len(self.audio_buffer) > self.max_buffer_samples:
                self.audio_buffer = self.audio_buffer[-self.left_context_samples:]
                self.is_window_sliding = True

            duration_ms = (self.total_audio_samples / 16000.0) * 1000.0
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

        # Non-destructive silence check & pause utterance segmentation
        rms = float(np.sqrt(np.mean(chunk_float ** 2))) if chunk_len > 0 else 0.0
        if rms < self.vad_silence_threshold:
            self.consecutive_silent_samples += chunk_len
            if self.consecutive_silent_samples >= self.pause_threshold_samples:
                if len(self.audio_buffer) >= 24000:
                    # Flush unconfirmed tokens on natural speech pause (turn completion)
                    if (
                        len(self.decoder.last_hyp_tokens) > len(self.decoder.committed_tokens)
                        and self.decoder.last_hyp_tokens[:len(self.decoder.committed_tokens)] == self.decoder.committed_tokens
                    ):
                        self.decoder.committed_tokens = list(self.decoder.last_hyp_tokens)
                    self.base_committed_tokens = list(self.decoder.committed_tokens)
                    self.audio_buffer = np.zeros(0, dtype=np.float32)
                    self.is_window_sliding = False
                    self.last_transcript = None
                return None
        else:
            self.consecutive_silent_samples = 0

        self.audio_buffer = np.concatenate([self.audio_buffer, chunk_float])

        if len(self.audio_buffer) < 1600:
            return None

        t0 = time.perf_counter()
        res = self.engine.transcribe(self.audio_buffer)
        inference_ms = (time.perf_counter() - t0) * 1000.0
        duration_ms = (self.total_audio_samples / 16000.0) * 1000.0
        self.has_untranscribed_tail = False

        # Track window offset with base committed tokens across segmented pauses
        if not self.is_window_sliding:
            window_tokens = self.base_committed_tokens + res.tokens
            global_tokens = self._align_growing_window(
                self.decoder.committed_tokens, window_tokens, len(self.base_committed_tokens)
            )
        else:
            best_offset, best_raw_start = self._find_window_alignment(
                self.decoder.committed_tokens, res.tokens
            )
            global_tokens = self.decoder.committed_tokens[:best_offset] + res.tokens[best_raw_start:]

        allow_commit = self.is_window_sliding or len(self.audio_buffer) >= 16000
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

        # Process pending audio tail if needed (< 1600 samples or untranscribed tail from stride)
        if len(self.audio_buffer) >= 400 and (
            self.has_untranscribed_tail
            or len(self.audio_buffer) < 1600
            or not self.decoder.last_hyp_tokens
        ):
            tail_res = self.engine.transcribe(self.audio_buffer)
            if not self.is_window_sliding:
                window_tokens = self.base_committed_tokens + tail_res.tokens
                global_tokens = self._align_growing_window(
                    self.decoder.committed_tokens, window_tokens, len(self.base_committed_tokens)
                )
            else:
                best_offset, best_raw_start = self._find_window_alignment(
                    self.decoder.committed_tokens, tail_res.tokens
                )
                global_tokens = self.decoder.committed_tokens[:best_offset] + tail_res.tokens[best_raw_start:]
            self.decoder.update(global_tokens, False, duration_ms, 0.0, allow_commit=True)
            self.has_untranscribed_tail = False

        streaming_tokens = (
            list(self.decoder.last_hyp_tokens)
            if self.decoder.last_hyp_tokens
            else list(self.decoder.committed_tokens)
        )

        inference_ms = (time.perf_counter() - t0) * 1000.0
        final_st = self.decoder.update(streaming_tokens, True, duration_ms, inference_ms)

        # Free buffer memory immediately
        self.audio_buffer = np.zeros(0, dtype=np.float32)
        self.total_audio_samples = 0
        self.consecutive_silent_chunks = 0
        self.consecutive_silent_samples = 0
        self.base_committed_tokens.clear()
        self.is_window_sliding = False
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
        self.total_audio_samples = 0
        self.consecutive_silent_chunks = 0
        self.consecutive_silent_samples = 0
        self.base_committed_tokens.clear()
        self.is_window_sliding = False
        self.is_finished = False
        self.push_count = 0
        self.last_transcript = None
        self.has_untranscribed_tail = False
        self.decoder.reset()
