"""The single source of truth for which recognizer a realtime call really uses (ruling R25).

`GET /api/realtime/config` reports it and Task 4.4's `make_recognizers` must select by it, so the
two can never disagree. Streaming needs `REALTIME_ASR_MODE=stream` and a streaming key;
`UPSTREAM_ASR_MODE` only affects the upload path and the buffered fallback, never this choice.
A stream recognizer that fails to start degrades to buffered at run time (R3); that is a
per-call event, not a configuration state."""
from typing import Literal

from app.asr import _fallback_configured, _stream_usable
from app.config import Settings

RealtimeAsr = Literal["stream", "buffered"]


def effective_realtime_asr(settings: Settings) -> RealtimeAsr:
    if settings.realtime_asr_mode == "stream" and settings.asr_stream_key:
        return "stream"
    return "buffered"


def realtime_asr_configured(settings: Settings) -> bool:
    """Whether `realtime_providers.make_recognizers` can build a recognizer (review 4.1-m2).
    `Settings.realtime_available` uses this, so the config/ticket endpoints never report a call
    that would fail with 4502 at once, nor hide one that works. Stream needs only its key; buffered
    needs the volc upload path or a usable chat/Whisper path (chat mode needs a model)."""
    if effective_realtime_asr(settings) == "stream":
        return True
    return _stream_usable(settings) or _fallback_configured(settings)
