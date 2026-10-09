"""内存日志环形缓冲(spec §13):挂在 `app` 与 `uvicorn.error` logger 上(不挂 access 日志),
写入时格式化并脱敏,每条截 2000 字符;只在内存,重启即空,不读磁盘日志文件。

脱敏:`ticket=…`(复用 logging_setup.redact_query_secrets)、`Bearer …`、`…key/token/secret/password/code/csrf=…`、
JSON 形式 `"api_key": "…"`,以及当前全部密钥值的精确匹配(≥ 6 字符,`set_secrets` 由设置监听器更新)。
"""
import logging
import re
from collections import deque
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timezone

from app.core.logging_setup import REDACTED, redact_query_secrets

MAX_MESSAGE = 2000
BUFFER_CAPACITY = 2000
MIN_SECRET = 6
_SENSITIVE = r"[\w-]*(?:key|token|secret|password|passwd|code|csrf|ticket|authorization)"
_BEARER = re.compile(r"(?i)\b(bearer\s+)[^\s\"',;]+")
_KV = re.compile(rf"(?i)\b({_SENSITIVE}=)[^&\s\"',;]+")
_JSON = re.compile(rf"(?i)(\"{_SENSITIVE}\"\s*:\s*\")((?:[^\"\\]|\\.)*)(\")")
_HEADER = re.compile(r"(?i)\b((?:x-api-key|ocp-apim-subscription-key|x-admin-csrf|cookie)\s*:\s*)[^\s,;]+")


def redact(text: str, secrets: frozenset[str]) -> str:
    text = redact_query_secrets(text)
    text = _BEARER.sub(lambda m: m.group(1) + REDACTED, text)
    text = _JSON.sub(lambda m: m.group(1) + REDACTED + m.group(3), text)
    text = _KV.sub(lambda m: m.group(1) + REDACTED, text)
    text = _HEADER.sub(lambda m: m.group(1) + REDACTED, text)
    for value in sorted(secrets, key=len, reverse=True):  # longest first: a secret may contain another
        if len(value) >= MIN_SECRET and value in text:
            text = text.replace(value, REDACTED)
    return text


@dataclass(frozen=True)
class LogEntry:
    id: int
    at: str
    level: str
    logger: str
    message: str


_secrets: frozenset[str] = frozenset()


def set_secrets(values: Iterable[str]) -> None:
    global _secrets
    _secrets = frozenset(v for v in (str(x or "") for x in values) if len(v) >= MIN_SECRET)


class RingBufferHandler(logging.Handler):
    def __init__(self, capacity: int = 2000):
        super().__init__()
        self._items: deque[tuple[int, LogEntry]] = deque(maxlen=capacity)
        self._next = 1
        self.setFormatter(logging.Formatter("%(message)s"))

    def emit(self, record: logging.LogRecord) -> None:  # called under self.lock by Handler.handle
        try:
            message = redact(self.format(record), _secrets)[:MAX_MESSAGE]
            at = datetime.fromtimestamp(record.created, timezone.utc).isoformat()
            entry = LogEntry(self._next, at, record.levelname, record.name[:100], message)
            self._next += 1
            self._items.append((record.levelno, entry))
        except Exception:  # noqa: BLE001 - logging must never raise
            self.handleError(record)

    def query(self, *, level: str | None, logger_prefix: str | None, q: str | None, after_id: int | None,
              limit: int = 200) -> list[LogEntry]:
        min_level = logging.getLevelName(level.upper()) if level else 0
        if not isinstance(min_level, int):
            min_level = 0
        needle = (q or "").lower()
        self.acquire()
        try:
            items = list(self._items)
        finally:
            self.release()
        out = [e for levelno, e in items
               if levelno >= min_level and (after_id is None or e.id > after_id)
               and (not logger_prefix or e.logger == logger_prefix or e.logger.startswith(logger_prefix))
               and (not needle or needle in e.message.lower())]
        limit = max(1, min(limit, 2000))
        return out[:limit] if after_id is not None else out[-limit:]

    def clear(self) -> None:
        self.acquire()
        try:
            self._items.clear()
        finally:
            self.release()


BUFFER = RingBufferHandler(BUFFER_CAPACITY)


def install(loggers: tuple[str, ...] = ("app", "uvicorn.error")) -> None:
    """Idempotent: attach BUFFER to each logger (records of child loggers reach it by propagation)."""
    for name in loggers:
        logger = logging.getLogger(name)
        if BUFFER not in logger.handlers:
            logger.addHandler(BUFFER)


def query(*, level: str | None = None, logger_prefix: str | None = None, q: str | None = None,
          after_id: int | None = None, limit: int = 200) -> list[LogEntry]:
    return BUFFER.query(level=level, logger_prefix=logger_prefix, q=q, after_id=after_id, limit=limit)
