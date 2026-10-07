"""The single source of truth for which recognizer a realtime call really uses (ruling R25).

`GET /api/realtime/config` reports it and Task 4.4's `make_recognizers` must select by it, so the
two can never disagree. Streaming needs `REALTIME_ASR_MODE=stream` and a streaming key;
`UPSTREAM_ASR_MODE` only affects the upload path and the buffered fallback, never this choice.
A stream recognizer that fails to start degrades to buffered at run time (R3); that is a
per-call event, not a configuration state."""
from typing import Literal

from app.config import Settings

RealtimeAsr = Literal["stream", "buffered"]


def effective_realtime_asr(settings: Settings) -> RealtimeAsr:
    if settings.realtime_asr_mode == "stream" and settings.asr_stream_key:
        return "stream"
    return "buffered"
