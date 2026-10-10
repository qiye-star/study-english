"""学习事件通道(spec 2026-10-11-learning-links §4):进程内、有界、尽力而为。

发布方在提交之后调用 `publish(event)`,不知道谁在听;订阅方(`app/links`)在启动时 `subscribe`。
只依赖标准库(核心层)。日志只记联动键、事件类名、异常类名;永不记录词、文本、异常消息或用户 id。"""
import asyncio
import logging
import time
import uuid
from collections import deque
from collections.abc import Awaitable, Callable
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

MAX_WORD = 100
MAX_TEXT = 4000
MAX_WEAK = 32
MAX_GOOD = 64
MAX_ERRORS = 50


def _event_id() -> str:
    return uuid.uuid4().hex


def _set(obj: object, name: str, value: object) -> None:
    object.__setattr__(obj, name, value)


@dataclass(frozen=True)
class WordAnswered:
    """背单词写入一行作答记录(wordbook_events;spell_set / bonus / goal / reset 除外,抽查 pending 不写也不发布)。

    kind ∈ learn | relearn | review | practice | blank;outcome 见 INDEX §3.4(客观题 correct/typo/inflection/wrong,
    三档自评 know/know_chk/fuzzy/unknown;旧行才有 known)。"""
    user_id: int
    book_id: str
    word: str
    kind: str
    qtype: str | None
    outcome: str
    credit: int
    at: datetime
    event_id: str = field(default_factory=_event_id)

    def __post_init__(self) -> None:
        _set(self, "word", self.word[:MAX_WORD])


@dataclass(frozen=True)
class WeakWord:
    word: str
    score: int | None


@dataclass(frozen=True)
class AssessmentFinished:
    """一次已保存的发音评测。SentencePracticed = source == "practice"(spec L-R2)。"""
    user_id: int
    assessment_id: str
    source: str
    score: int | None
    weak_words: tuple[WeakWord, ...]
    good_words: tuple[str, ...]
    at: datetime
    event_id: str = field(default_factory=_event_id)

    def __post_init__(self) -> None:
        _set(self, "weak_words", tuple(self.weak_words)[:MAX_WEAK])
        _set(self, "good_words", tuple(self.good_words)[:MAX_GOOD])


@dataclass(frozen=True)
class MessageSent:
    """用户在 AI 对话里发出的一条消息。text 只在内存里交给订阅者,任何地方都不记录、不入库。"""
    user_id: int
    conversation_id: str
    message_id: str
    text: str = field(repr=False)
    at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    event_id: str = field(default_factory=_event_id)

    def __post_init__(self) -> None:
        _set(self, "text", self.text[:MAX_TEXT])


EVENT_TYPES: tuple[type, ...] = (WordAnswered, AssessmentFinished, MessageSent)
Handler = Callable[[Any], Awaitable[None]]
Gate = Callable[[str, int], Awaitable[bool]]
_COUNTERS = ("published", "handled", "skipped", "failed", "timeouts", "dropped", "breaker_skipped", "breaker_opens",
             "last_ms")


@dataclass
class _Stats:
    published: int = 0
    handled: int = 0
    skipped: int = 0
    failed: int = 0
    timeouts: int = 0
    dropped: int = 0
    breaker_skipped: int = 0
    breaker_opens: int = 0
    last_ms: int = 0
    consecutive: int = 0
    open_until: float = 0.0
    half_open: bool = False
    extra: dict[str, int] = field(default_factory=dict)


def _int(settings: Any, name: str, default: int) -> int:
    try:
        return int(getattr(settings, name, default))
    except (TypeError, ValueError):
        return default


class LearningBus:
    def __init__(self, settings: Callable[[], Any], *, clock: Callable[[], float] = time.monotonic) -> None:
        self._settings = settings
        self._clock = clock
        self._subs: dict[type, list[tuple[str, Handler]]] = {}
        self._stats: dict[str, _Stats] = {}
        self._queue: deque = deque()
        self._wake = asyncio.Event()
        self._gate: Gate | None = None
        self._errors: deque = deque(maxlen=MAX_ERRORS)
        self._dropped = 0

    # ---- wiring ----
    def subscribe(self, event_type: type, link: str, handler: Handler) -> None:
        if event_type not in EVENT_TYPES:
            raise ValueError(f"unknown event type {getattr(event_type, '__name__', event_type)}")
        self._subs.setdefault(event_type, []).append((link, handler))
        self._stats.setdefault(link, _Stats())

    def set_gate(self, gate: Gate | None) -> None:
        self._gate = gate

    def links(self) -> tuple[str, ...]:
        return tuple(self._stats)

    # ---- publishing ----
    def publish(self, event: Any) -> bool:
        settings = self._settings()
        if not getattr(settings, "links_enabled", False):
            return False
        subs = self._subs.get(type(event))
        if not subs:
            return False
        if len(self._queue) >= max(1, _int(settings, "links_queue_max", 1000)):
            self._dropped += 1
            for link, _ in subs:
                self._stats[link].dropped += 1
            return False
        for link, _ in subs:
            self._stats[link].published += 1
        self._queue.append(event)
        self._wake.set()
        return True

    # ---- consuming ----
    async def drain(self) -> int:
        done = 0
        while self._queue:
            await self._dispatch(self._queue.popleft())
            done += 1
        return done

    async def run(self) -> None:
        while True:
            if not self._queue:
                self._wake.clear()
                await self._wake.wait()
            await self.drain()

    async def _dispatch(self, event: Any) -> None:
        settings = self._settings()
        timeout = max(0.1, _int(settings, "links_handler_timeout_ms", 2000) / 1000)
        for link, handler in list(self._subs.get(type(event), ())):
            st = self._stats[link]
            if st.open_until:
                if self._clock() < st.open_until:
                    st.breaker_skipped += 1
                    continue
                st.open_until, st.half_open = 0.0, True
            started = self._clock()
            try:
                if self._gate is not None and not await self._gate(link, event.user_id):
                    st.skipped += 1
                    continue
                await asyncio.wait_for(handler(event), timeout)
            except TimeoutError:
                st.timeouts += 1
                self._failure(link, st, event, "TimeoutError", settings)
            except Exception as exc:  # noqa: BLE001 - a link must never break the bus or the next link
                st.failed += 1
                self._failure(link, st, event, type(exc).__name__, settings)
            else:
                st.handled += 1
                st.consecutive, st.half_open = 0, False
            finally:
                st.last_ms = int((self._clock() - started) * 1000)

    def _failure(self, link: str, st: _Stats, event: Any, error: str, settings: Any) -> None:
        st.consecutive += 1
        if st.half_open or st.consecutive >= max(1, _int(settings, "links_breaker_failures", 5)):
            st.open_until = self._clock() + max(1, _int(settings, "links_breaker_cooldown_seconds", 60))
            st.consecutive, st.half_open = 0, False
            st.breaker_opens += 1
        name = type(event).__name__
        self._errors.append({"at": datetime.now(timezone.utc).isoformat(), "link": link, "event": name, "error": error})
        logger.warning("links failure link=%s event=%s error=%s", link, name, error)

    # ---- observability ----
    def count(self, link: str, name: str, n: int = 1) -> None:
        st = self._stats.setdefault(link, _Stats())
        st.extra[name] = st.extra.get(name, 0) + n

    def stats(self) -> dict[str, dict]:
        now = self._clock()
        out: dict[str, dict] = {}
        for link, st in self._stats.items():
            if st.open_until and now < st.open_until:
                state, left = "open", max(0, round(st.open_until - now))
            elif st.open_until or st.half_open:
                state, left = "half_open", 0
            else:
                state, left = "closed", 0
            out[link] = {**{k: getattr(st, k) for k in _COUNTERS}, "breaker": state, "open_seconds": left,
                         "extra": dict(st.extra)}
        return out

    def queue(self) -> dict:
        return {"size": len(self._queue), "max": max(1, _int(self._settings(), "links_queue_max", 1000)),
                "dropped": self._dropped}

    def recent_errors(self) -> list[dict]:
        return list(reversed(self._errors))

    def reset_breaker(self, link: str) -> bool:
        st = self._stats.get(link)
        if st is None:
            return False
        st.open_until, st.consecutive, st.half_open = 0.0, 0, False
        return True


_current: ContextVar[LearningBus | None] = ContextVar("learning_bus", default=None)


def bind(bus: LearningBus | None) -> None:
    """current_user 依赖里调用(同 metering.bind_user);只影响当前请求的上下文。"""
    _current.set(bus)


def publish(event: Any) -> bool:
    """提交之后调用。未绑定、总开关关、无订阅、队列满 → False;永不抛错。"""
    bus = _current.get()
    if bus is None:
        return False
    try:
        return bus.publish(event)
    except Exception as exc:  # noqa: BLE001 - publishing must never fail the request
        logger.warning("links publish failed error=%s", type(exc).__name__)
        return False
