"""Minimal app logging so INFO lines (notably `app.timing`) reach stdout under uvicorn.

uvicorn only configures its own loggers; the root logger stays at WARNING with no
handler, so INFO records from `app.*` would be dropped. We attach one stream handler to
the `app` logger, but only when nobody else (the host process, pytest's caplog) already
installed handlers. Never log user text, transcripts, replies or keys at INFO."""
import logging
import re
import sys
from typing import TextIO

_MARK = "_enjoy_app_handler"

# uvicorn writes the request path *with its query string* into its access lines (`uvicorn.access`)
# and its WebSocket lines (`uvicorn.error`: `"WebSocket /api/realtime?ticket=…" [accepted]`, and
# the websockets library's debug output, which uvicorn routes to the same logger). The realtime
# ticket is a bearer secret, so its value is redacted on those loggers.
REDACTED_LOGGERS = ("uvicorn.access", "uvicorn.error", "uvicorn")
_SECRET_QUERY = re.compile(r"(?i)\b(ticket=)[^&\s\"'#]+")
REDACTED = "[redacted]"


def redact_query_secrets(text: str) -> str:
    return _SECRET_QUERY.sub(lambda m: m.group(1) + REDACTED, text)


class QuerySecretFilter(logging.Filter):
    """Redacts `ticket=<value>` in a record's message and string arguments, keeping the args'
    shape (uvicorn's AccessFormatter unpacks a 5-tuple)."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = redact_query_secrets(record.msg)
        args = record.args
        if isinstance(args, tuple):
            record.args = tuple(redact_query_secrets(a) if isinstance(a, str) else a for a in args)
        elif isinstance(args, dict):
            record.args = {k: redact_query_secrets(v) if isinstance(v, str) else v for k, v in args.items()}
        return True


def install_query_redaction() -> None:
    """Idempotent. Logger filters (not handler filters) so it holds whatever handlers uvicorn's
    dictConfig installed; uvicorn configures logging before it calls the app factory, and
    dictConfig never removes filters it did not add."""
    for name in REDACTED_LOGGERS:
        logger = logging.getLogger(name)
        if not any(isinstance(f, QuerySecretFilter) for f in logger.filters):
            logger.addFilter(QuerySecretFilter())


def configure_logging(level: str = "INFO", stream: TextIO | None = None) -> None:
    install_query_redaction()
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
