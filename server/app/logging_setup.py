"""Minimal app logging so INFO lines (notably `app.timing`) reach stdout under uvicorn.

uvicorn only configures its own loggers; the root logger stays at WARNING with no
handler, so INFO records from `app.*` would be dropped. We attach one stream handler to
the `app` logger, but only when nobody else (the host process, pytest's caplog) already
installed handlers. Never log user text, transcripts, replies or keys at INFO."""
import logging
import sys
from typing import TextIO

_MARK = "_enjoy_app_handler"


def configure_logging(level: str = "INFO", stream: TextIO | None = None) -> None:
    app_logger = logging.getLogger("app")
    resolved = logging.getLevelName(level.strip().upper()) if isinstance(level, str) else logging.INFO
    if not isinstance(resolved, int):
        resolved = logging.INFO
    existing = [h for h in app_logger.handlers if getattr(h, _MARK, False)]
    if existing:
        app_logger.setLevel(resolved)
        return
    if app_logger.handlers or logging.getLogger().handlers:
        return  # the host already configured logging; do not duplicate or override
    handler = logging.StreamHandler(stream or sys.stdout)
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    setattr(handler, _MARK, True)
    app_logger.addHandler(handler)
    app_logger.setLevel(resolved)
    app_logger.propagate = False
