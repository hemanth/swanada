"""Python Streaming Audio Transcription Pipeline with Stabilized Prefix Locking."""

import time
from dataclasses import dataclass, field
from typing import Callable, List, Optional, Union
import numpy as np

from .engine import AcousticEngine, TranscriptionResult
from .normalizer import normalize_indic_text


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
    ):
        self.vocab = vocab
        self.stability_threshold = stability_threshold
        self.trail_tokens = trail_tokens
        self.committed_tokens: List[str] = []
        self.committed_text: str = ""
        self.last_hyp_tokens: List[str] = []
        self.token_stability_counts: List[int] = []

    def reset(self) -> None:
        self.committed_tokens.clear()
        self.committed_text = ""
        self.last_hyp_tokens.clear()
        self.token_stability_counts.clear()

    def update(
        self,
        raw_tokens: List[str],
        is_stream_end: bool = False,
        duration_ms: float = 0.0,
        inference_ms: float = 0.0,
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

        lockable_limit = max(0, len(raw_tokens) - self.trail_tokens)
        already_committed = len(self.committed_tokens)

        for i in range(already_committed, lockable_limit):
            is_word_ahead = any(
                raw_tokens[j].startswith("▁") or raw_tokens[j].startswith("\u2581")
                for j in range(i + 1, len(raw_tokens))
            )
            is_stable = self.token_stability_counts[i] >= self.stability_threshold

            if is_word_ahead or is_stable:
                self.committed_tokens.append(raw_tokens[i])
            else:
                break

        self.last_hyp_tokens = list(raw_tokens)

        committed_str = normalize_indic_text("".join(self.committed_tokens))
        self.committed_text = committed_str
        volatile_tokens = raw_tokens[len(self.committed_tokens):]
        volatile_str = normalize_indic_text("".join(volatile_tokens))

        full_text = f"{committed_str} {volatile_str}".strip() if committed_str and volatile_str else (committed_str or volatile_str)
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
        left_context_samples: int = 16000,   # 1,000 ms
        max_buffer_samples: int = 32000,     # 2,000 ms
        vad_silence_threshold: float = 0.005,
    ):
        self.engine = engine
        self.decoder = StreamingCTCDecoder(engine.vocab)
        self.chunk_size_samples = chunk_size_samples
        self.left_context_samples = left_context_samples
        self.max_buffer_samples = max_buffer_samples
        self.vad_silence_threshold = vad_silence_threshold

        self.audio_buffer = np.zeros(0, dtype=np.float32)
        self.total_audio_samples = 0
        self.consecutive_silent_chunks = 0
        self.consecutive_silent_samples = 0
        self.pause_threshold_samples = 8000  # 500 ms @ 16 kHz
        self.base_committed_tokens: List[str] = []
        self.is_window_sliding = False
        self.is_finished = False
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
        self.total_audio_samples += len(chunk_float)

        # Non-destructive silence check & pause utterance segmentation
        rms = float(np.sqrt(np.mean(chunk_float ** 2))) if len(chunk_float) > 0 else 0.0
        if rms < self.vad_silence_threshold:
            self.consecutive_silent_samples += len(chunk_float)
            if self.consecutive_silent_samples >= self.pause_threshold_samples:
                if len(self.audio_buffer) > 0:
                    # Flush unconfirmed tokens on natural speech pause (turn completion)
                    if len(self.decoder.last_hyp_tokens) > len(self.decoder.committed_tokens):
                        self.decoder.committed_tokens = list(self.decoder.last_hyp_tokens)
                    self.base_committed_tokens = list(self.decoder.committed_tokens)
                    self.audio_buffer = np.zeros(0, dtype=np.float32)
                    self.is_window_sliding = False
                return None
        else:
            self.consecutive_silent_samples = 0

        self.audio_buffer = np.concatenate([self.audio_buffer, chunk_float])

        # Defer inference on tiny trailing fragments (< 800 samples = 50ms) after sliding window
        if self.is_window_sliding and len(chunk_float) < 800:
            return None

        if len(self.audio_buffer) < 1600:
            return None

        t0 = time.perf_counter()
        res = self.engine.transcribe(self.audio_buffer)
        inference_ms = (time.perf_counter() - t0) * 1000.0
        duration_ms = (self.total_audio_samples / 16000.0) * 1000.0

        # Track window offset with base committed tokens across segmented pauses
        if not self.is_window_sliding:
            global_tokens = self.base_committed_tokens + res.tokens
        else:
            best_offset, best_raw_start = self._find_window_alignment(
                self.decoder.committed_tokens, res.tokens
            )
            global_tokens = self.decoder.committed_tokens[:best_offset] + res.tokens[best_raw_start:]

        st = self.decoder.update(global_tokens, False, duration_ms, inference_ms)

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

        # Process pending audio tail if needed (< 1600 samples)
        if len(self.audio_buffer) >= 400 and (len(self.audio_buffer) < 1600 or not self.decoder.last_hyp_tokens):
            tail_res = self.engine.transcribe(self.audio_buffer)
            if not self.is_window_sliding:
                global_tokens = self.base_committed_tokens + tail_res.tokens
            else:
                best_offset, best_raw_start = self._find_window_alignment(
                    self.decoder.committed_tokens, tail_res.tokens
                )
                global_tokens = self.decoder.committed_tokens[:best_offset] + tail_res.tokens[best_raw_start:]
            self.decoder.update(global_tokens, False, duration_ms, 0.0)

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
