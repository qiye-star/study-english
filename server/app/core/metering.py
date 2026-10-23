"""上游调用计量(spec §8.1)。

记录点调用 `record(kind, provider, model, status, ms, units_in=, units_out=, unit=)`:只记数字,
不记任何请求/响应文本。`feature` 由 `MeteringMiddleware` 按路径前缀设定,`user_id` 由
`deps.current_user` 绑定;两者都是 contextvar。记录先进内存队列(满了丢最旧并计数),
`flush_loop` 每 5 秒批量写 `upstream_calls`,每小时把超过保留期的原始行汇总进 `usage_daily` 后删除。
`record` 永不抛错:计量出问题绝不能让请求失败。
"""
import asyncio
import logging
import struct
import time
from collections import deque
from contextlib import contextmanager, suppress
from contextvars import ContextVar
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

from sqlalchemy import delete, select

from app.models import UpstreamCall, UsageDaily

logger = logging.getLogger(__name__)

_user: ContextVar[int | None] = ContextVar("metering_user", default=None)
_feature: ContextVar[str] = ContextVar("metering_feature", default="other")

KINDS = ("llm", "tts", "stt", "asr_stream", "assess_azure", "assess_xfyun", "probe", "email")
UNITS = ("tokens", "bytes", "chars", "audio_ms", "calls")
# usage_daily has no unit column: a rolled-up bucket keeps only the units of its kind's main unit
# (an llm stream's bytes count as a call, not as tokens).
DAILY_UNIT = {"llm": "tokens", "tts": "chars", "stt": "audio_ms", "asr_stream": "audio_ms",
              "assess_xfyun": "audio_ms", "assess_azure": "calls", "probe": "calls", "email": "calls"}
FEATURE_PREFIXES: tuple[tuple[str, str], ...] = (
    ("/api/ai/chat", "chat"),
    ("/api/ai/audio", "audio"),
    ("/api/ai/grammar", "grammar"),
    ("/api/speech", "assessment"),
    ("/api/realtime", "realtime"),
    ("/api/rank", "rank"),
    ("/api/rooms", "rooms"),
    ("/api/wordbook", "wordbook"),
    ("/api/agents", "agents"),
    ("/api/library", "library"),
    ("/api/email", "account"),  # verification codes (accounts v2)
    ("/api/me/email", "account"),
    ("/api/admin", "admin"),
)
_PROVIDER_SUFFIXES = (
    ("api.openai.com", "openai"),
    ("deepseek.com", "deepseek"),
    ("volces.com", "ark"),
    ("openspeech.bytedance.com", "volcengine"),
    ("microsoft.com", "azure"),
    ("xfyun.cn", "xfyun"),
)
ROLLUP_INTERVAL = 3600.0


def bind_user(user_id: int | None) -> None:
    _user.set(user_id)


def current_user_id() -> int | None:
    return _user.get()


def current_feature() -> str:
    return _feature.get()


@contextmanager
def feature_scope(name: str):
    token = _feature.set(name)
    try:
        yield
    finally:
        _feature.reset(token)


@contextmanager
def system_scope():
    """Upstream calls inside are the system's (curated catalog: plan 2026-10-14-curated-library R-SC9): no user is
    charged in `upstream_calls` (user_id NULL; usage_daily rolls it up as 0). The previous user comes back on exit."""
    token = _user.set(None)
    try:
        yield
    finally:
        _user.reset(token)


def feature_for(path: str) -> str:
    return next((name for prefix, name in FEATURE_PREFIXES if path == prefix or path.startswith(prefix + "/")),
                "other")


def provider_of(url: str) -> str:
    """Short provider name for a base URL (only the host is looked at, never the path or query)."""
    try:
        host = (urlsplit(url).hostname if "://" in url else url.split("/")[0].split(":")[0]) or ""
    except ValueError:
        host = ""
    host = host.lower()
    for suffix, name in _PROVIDER_SUFFIXES:
        if host == suffix or host.endswith("." + suffix):
            return name
    return (host or "unknown")[:32]


def wav_ms(data: bytes) -> int | None:
    """Duration of the first RIFF/WAVE in `data` (a bare WAV or a multipart body), from its header."""
    start = data.find(b"RIFF", 0, 4096)
    if start < 0 or data[start + 8:start + 12] != b"WAVE":
        return None
    pos, byte_rate = start + 12, 0
    while pos + 8 <= len(data):
        chunk, size = data[pos:pos + 4], struct.unpack_from("<I", data, pos + 4)[0]
        if chunk == b"fmt " and pos + 20 <= len(data):
            byte_rate = struct.unpack_from("<I", data, pos + 16)[0]
        elif chunk == b"data":
            size = min(size, len(data) - pos - 8)  # streamed WAVs may claim 0xFFFFFFFF
            return int(size * 1000 / byte_rate) if byte_rate else None
        pos += 8 + size + (size & 1)
    return None


def audio_units(data: bytes) -> tuple[int, str]:
    """(units, unit) for a recognition request: audio_ms from a WAV header, else the byte count."""
    try:
        ms = wav_ms(data)
    except struct.error:
        ms = None
    return (ms, "audio_ms") if ms is not None else (len(data), "bytes")


def pcm_ms(pcm_bytes: int, rate: int = 16000) -> int:
    """Duration of 16-bit mono PCM."""
    return int(pcm_bytes * 1000 / (rate * 2))


def tokens_of(payload: object) -> tuple[int, int] | None:
    """(prompt_tokens, completion_tokens) from an OpenAI-style JSON body, else None."""
    usage = payload.get("usage") if isinstance(payload, dict) else None
    if not isinstance(usage, dict):
        return None
    pt, ct = usage.get("prompt_tokens"), usage.get("completion_tokens")
    if not all(isinstance(v, int) and not isinstance(v, bool) for v in (pt, ct)):
        return None
    return pt, ct


@dataclass(frozen=True)
class CallRecord:
    at: datetime
    user_id: int | None
    feature: str
    kind: str
    provider: str
    model: str
    status: int
    ms: int
    units_in: int
    units_out: int
    unit: str


class Meter:
    def __init__(self, capacity: int = 10_000):
        self._items: deque[CallRecord] = deque(maxlen=capacity)
        self.dropped = 0

    def record(self, rec: CallRecord) -> None:
        if len(self._items) == self._items.maxlen:
            self.dropped += 1
        self._items.append(rec)

    def drain(self) -> list[CallRecord]:
        items = list(self._items)
        self._items.clear()
        return items

    def requeue(self, items: list[CallRecord]) -> None:
        """Put records back at the front after a failed write (newest win when over capacity)."""
        room = self._items.maxlen - len(self._items)
        keep = items[-room:] if room > 0 else []
        self.dropped += len(items) - len(keep)
        self._items.extendleft(reversed(keep))

    @property
    def depth(self) -> int:
        return len(self._items)


METER = Meter()


def record(kind: str, provider: str, model: str, status: int, ms: int, *, units_in: int = 0, units_out: int = 0,
           unit: str = "calls", meter: Meter = METER) -> None:
    try:
        meter.record(CallRecord(
            datetime.now(timezone.utc), _user.get(), _feature.get()[:16], str(kind)[:16], str(provider)[:32],
            str(model)[:64], int(status), max(0, int(ms)), max(0, int(units_in)), max(0, int(units_out)),
            str(unit)[:8]))
    except Exception:  # noqa: BLE001 - metering must never break a request
        pass


class Timer:
    """Milliseconds since construction (for record points)."""

    def __init__(self):
        self._start = time.perf_counter()

    def ms(self) -> int:
        return round((time.perf_counter() - self._start) * 1000)


class MeteringMiddleware:
    """Pure ASGI: tags every HTTP request / WebSocket with its feature and a fresh (unbound) user."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket"):
            return await self.app(scope, receive, send)
        feature = _feature.set(feature_for(scope.get("path", "")))
        user = _user.set(None)
        try:
            return await self.app(scope, receive, send)
        finally:
            _user.reset(user)
            _feature.reset(feature)


async def flush(sessionmaker, meter: Meter = METER) -> int:
    items = meter.drain()
    if not items:
        return 0
    try:
        async with sessionmaker() as session:
            session.add_all(UpstreamCall(**asdict(r)) for r in items)
            await session.commit()
    except Exception as exc:  # noqa: BLE001 - keep the records for the next attempt
        meter.requeue(items)
        logger.warning("metering flush failed error=%s", type(exc).__name__)
        return 0
    return len(items)


def _day(value: datetime) -> str:
    value = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
    return value.date().isoformat()


async def rollup_and_prune(session, now: datetime, raw_retention_days: int) -> tuple[int, int]:
    """Add raw rows older than the retention period into usage_daily, then delete them (caller commits)."""
    cutoff = now - timedelta(days=max(1, raw_retention_days))
    rows = (await session.execute(
        select(UpstreamCall.at, UpstreamCall.feature, UpstreamCall.kind, UpstreamCall.provider, UpstreamCall.model,
               UpstreamCall.user_id, UpstreamCall.status, UpstreamCall.ms, UpstreamCall.units_in,
               UpstreamCall.units_out, UpstreamCall.unit).where(UpstreamCall.at < cutoff))).all()
    if not rows:
        return 0, 0
    buckets: dict[tuple, list[int]] = {}
    for at, feature, kind, provider, model, user_id, status, ms, units_in, units_out, unit in rows:
        key = (_day(at), feature, kind, provider, model, user_id or 0)
        b = buckets.setdefault(key, [0, 0, 0, 0, 0])
        b[0] += 1
        b[1] += 0 if 200 <= status < 300 else 1
        if unit == DAILY_UNIT.get(kind, "calls"):
            b[2] += units_in
            b[3] += units_out
        b[4] += ms
    days = {k[0] for k in buckets}
    existing = {(d.day, d.feature, d.kind, d.provider, d.model, d.user_id): d for d in
                (await session.scalars(select(UsageDaily).where(UsageDaily.day.in_(days)))).all()}
    for key, (calls, errors, units_in, units_out, ms_total) in buckets.items():
        row = existing.get(key)
        if row is None:
            day, feature, kind, provider, model, user_id = key
            row = UsageDaily(day=day, feature=feature, kind=kind, provider=provider, model=model, user_id=user_id,
                             calls=0, errors=0, units_in=0, units_out=0, ms_total=0)
            session.add(row)
        row.calls += calls
        row.errors += errors
        row.units_in += units_in
        row.units_out += units_out
        row.ms_total += ms_total
    result = await session.execute(delete(UpstreamCall).where(UpstreamCall.at < cutoff))
    return len(buckets), result.rowcount or len(rows)


async def _rollup(app) -> None:
    try:
        async with app.state.sessionmaker() as session:
            await rollup_and_prune(session, datetime.now(timezone.utc), app.state.settings.usage_raw_retention_days)
            await session.commit()
    except Exception as exc:  # noqa: BLE001
        logger.warning("metering rollup failed error=%s", type(exc).__name__)


async def flush_loop(app, interval: float = 5.0) -> None:
    last_rollup = 0.0
    try:
        while True:
            await asyncio.sleep(interval)
            await flush(app.state.sessionmaker)
            if time.monotonic() - last_rollup >= ROLLUP_INTERVAL:
                last_rollup = time.monotonic()
                await _rollup(app)
    finally:
        with suppress(Exception):
            await asyncio.shield(flush(app.state.sessionmaker))
