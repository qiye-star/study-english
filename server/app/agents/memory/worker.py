"""回合后的记忆整理(spec §6.6、§8.3):不占首字时间;after_turn 只排队、立刻返回。失败只记异常类名。

触发规则(裁定 R-M3):
- 对话模式、有用户文本的回合:文本进待整理队列(≤ 4 条),段内回合 +1;段内回合 ≥ 4 → 抽取并清空队列。
- 距该线程上一回合 ≥ 30 分钟后的下一次进入:先抽取空闲前剩下的队列;对话线程再为上一段写会话回顾(≥ 4 条消息)。
- 对话线程:窗口(AGENTS_HISTORY_MAX)之外尚未压缩的消息 ≥ 6 条 → 滚动摘要(每次 ≤ 20 条);摘要每变化 3 次 → 摘要原文写成回顾。
- 导师结束(A3 调 submit_tutor):直接写导师回顾,并对回顾文本抽取一次。
每次调用模型前扣每人每日额度(作用域 agents_memory,抽取 / 摘要 / 回顾共用,R-M4);上游失败与超时退还并退避 60 秒。
暂停记忆(用户 memory_enabled=false)或服务端 AGENTS_MEMORY_ENABLED=false → 什么都不写(R-M6)。
并发 ≤ 2、待办 ≤ 50;进程关停时未完成的整理随之丢失(尽力而为)。日志只有任务名、计数、失败种类与异常类名。"""
import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Protocol

from app.agents.memory.cache import SnapshotCache
from app.agents.memory.extract import EXISTING_MAX, INPUT_TEXT_MAX, ExtractInput, Op, extract
from app.agents.memory.retrieve import ranked
from app.agents.memory.source import snapshot_key
from app.agents.memory.store import MemoryStore, ThreadKey, ThreadTouch
from app.agents.memory.summarize import (
    DROPPED_MAX, RECAP_LINES_MAX, RECAP_MIN_LINES, SUMMARY_BATCH, recap, roll_summary,
)
from app.agents.memory.tombstones import clean_text
from app.core import metering
from app.providers import llm

logger = logging.getLogger(__name__)

IDLE_GAP = timedelta(minutes=30)
EXTRACT_EVERY = 4
RECAP_EVERY_ROLLS = 3
CONCURRENCY = 2
PENDING_MAX = 50
BACKOFF_SECONDS = 60.0
CALL_TIMEOUT = 15.0
CAP_SCOPE = "agents_memory_extract"  # == agents.limits.SCOPE_MEMORY_USER (INDEX X19; a test pins the equality)
FEATURE = "agents_memory"


class TurnRecordLike(Protocol):
    """A1 的 TurnRecord 里本计划读取的字段(Cross-plan assumptions)。"""
    user_id: int
    persona_id: str
    conversation_id: str | None
    room_id: str | None
    mode: str
    text: str | None
    at: datetime
    in_room: bool


@dataclass(frozen=True)
class TutorFinished:
    user_id: int
    persona_id: str | None
    conversation_id: str | None
    tutor_session_id: str
    recap_text: str
    at: datetime


@dataclass
class MemoryDeps:
    store: MemoryStore
    cache: SnapshotCache
    settings: Callable[[], Any]
    user_settings: Callable[[int], Awaitable[Any]]
    complete: Callable[[list[dict], int], Awaitable[str]]
    consume: Callable[[int, datetime], Awaitable[bool]]
    refund: Callable[[int, datetime], Awaitable[None]]
    counters: dict[str, int] = field(default_factory=dict)

    def count(self, name: str, n: int = 1) -> None:
        if n:
            self.counters[name] = self.counters.get(name, 0) + int(n)


def thread_key(record: TurnRecordLike) -> ThreadKey | None:
    if record.in_room:
        return ThreadKey("room", record.room_id) if record.room_id else None
    return ThreadKey("conversation", record.conversation_id) if record.conversation_id else None


async def apply_ops(store: MemoryStore, user_id: int, persona_id: str | None, ops: list[Op], source: str) -> int:
    applied = 0
    for op in ops:
        if op.action == "add":
            row = await store.add(user_id, kind=op.kind, text=op.text, importance=op.importance,
                                  persona_id=None if op.shared else persona_id, source=source)
            applied += row is not None
        elif op.action == "update":
            applied += await store.update(user_id, op.item_id, text=op.text, kind=op.kind, importance=op.importance)
        elif op.action == "delete":
            applied += await store.delete(user_id, op.item_id, by_user=False)
        elif op.action == "profile":
            applied += (await store.propose(user_id, op.key, op.value)) != "same"
    return applied


class MemoryWorker:
    def __init__(self, deps: MemoryDeps, *, monotonic: Callable[[], float] = time.monotonic):
        self._deps = deps
        self._monotonic = monotonic
        self._sem = asyncio.Semaphore(CONCURRENCY)
        self._backoff_until = 0.0
        self.pending: set[asyncio.Task] = set()

    def stats(self) -> dict[str, int]:
        return dict(self._deps.counters)

    async def after_turn(self, record: TurnRecordLike) -> None:
        """TurnHooks.after_turn 回调:只排队,立刻返回。"""
        self._submit(self._turn(record))

    def submit_tutor(self, event: TutorFinished) -> bool:
        """A3 在导师会话结束时调用;待办满了返回 False(回顾丢失,只计数)。"""
        return self._submit(self._tutor(event))

    async def join(self) -> None:
        while self.pending:
            await asyncio.gather(*list(self.pending), return_exceptions=True)

    def _submit(self, coro) -> bool:
        if len(self.pending) >= PENDING_MAX:
            coro.close()
            self._deps.count("skipped_overflow")
            return False
        task = asyncio.get_running_loop().create_task(self._guard(coro))
        self.pending.add(task)
        task.add_done_callback(self.pending.discard)
        return True

    async def _guard(self, coro) -> None:
        try:
            async with self._sem:
                await coro
        except Exception as e:  # noqa: BLE001 - background job: never surfaces, never logs text
            self._deps.count("jobs_failed")
            logger.warning("agents memory job failed error=%s", type(e).__name__)

    async def _allowed(self, user_id: int) -> bool:
        server = self._deps.settings()
        if not server.agents_enabled or not server.agents_memory_enabled:
            return False
        prefs = await self._deps.user_settings(user_id)
        return bool(prefs.memory_enabled)

    async def _turn(self, record: TurnRecordLike) -> None:
        d = self._deps
        key = thread_key(record)
        if key is None or not await self._allowed(record.user_id):
            return
        d.count("turns")
        used = d.cache.get(snapshot_key(record.user_id, key, record.persona_id or ""))
        if used is not None and used.item_ids:
            await d.store.touch(record.user_id, used.item_ids, record.at)
        chat = record.mode == "chat"
        touch = await d.store.touch_thread(record.user_id, key, at=record.at, text=record.text,
                                           count_turn=chat, idle=IDLE_GAP)
        source = "room" if key.kind == "room" else "chat"
        if touch.gap and touch.gap_pending:
            await self._extract(record.user_id, record.persona_id, touch.gap_pending, source, record.at)
        if touch.gap and touch.gap_segment is not None and key.kind == "conversation":
            await self._recap_segment(record.user_id, record.persona_id, key.id, touch.gap_segment, record.at)
        if chat and touch.turns >= EXTRACT_EVERY:
            await d.store.clear_pending(record.user_id, key)
            await self._extract(record.user_id, record.persona_id, touch.pending, source, record.at)
        if key.kind == "conversation":
            await self._roll(record.user_id, record.persona_id, key, touch, record.at)

    async def _tutor(self, event: TutorFinished) -> None:
        d = self._deps
        if not await self._allowed(event.user_id):
            return
        row = await d.store.add_recap(event.user_id, source="tutor", text=event.recap_text, persona_id=event.persona_id,
                                      conversation_id=event.conversation_id, tutor_session_id=event.tutor_session_id)
        if row is not None:
            d.count("recaps")
        text = clean_text(event.recap_text)[:INPUT_TEXT_MAX]
        if text:
            await self._extract(event.user_id, event.persona_id, (text,), "tutor", event.at)

    async def _call(self, user_id: int, at: datetime, job: str, fn: Callable[[MemoryDeps], Awaitable[Any]]) -> Any:
        d = self._deps
        if self._monotonic() < self._backoff_until:
            d.count("skipped_backoff")
            return None
        if not await d.consume(user_id, at):
            d.count("skipped_cap")
            return None
        d.count(f"{job}_calls")
        try:
            metering.bind_user(user_id)  # this task's own context copy
            with metering.feature_scope(FEATURE):
                return await asyncio.wait_for(fn(d), CALL_TIMEOUT)
        except llm.LlmUnavailable as e:
            await d.refund(user_id, at)
            if e.kind in ("http", "network"):  # 402 / 429 / 5xx / network: stop calling for a while
                self._backoff_until = self._monotonic() + BACKOFF_SECONDS
            d.count(f"{job}_failed")
            logger.info("agents memory %s upstream failed kind=%s", job, e.kind)
        except TimeoutError:
            await d.refund(user_id, at)
            d.count(f"{job}_failed")
            logger.info("agents memory %s timeout", job)
        return None

    async def _extract(self, user_id: int, persona_id: str | None, texts: tuple[str, ...], source: str,
                       at: datetime) -> None:
        d = self._deps
        texts = tuple(t for t in texts if t)
        if not texts:
            return
        views = await d.store.views(user_id, persona_id)
        existing = tuple(ranked(views, " ".join(texts), at)[:EXISTING_MAX])
        ops = await self._call(user_id, at, "extract",
                               lambda deps: extract(deps, ExtractInput(user_id, persona_id, texts, existing)))
        if ops is None:
            return
        applied = await apply_ops(d.store, user_id, persona_id, ops, source)
        evicted = await d.store.evict(user_id, d.settings().agents_memory_items_max)
        d.count("ops_applied", applied)
        d.count("evicted", evicted)
        logger.info("agents memory extract ops=%d applied=%d evicted=%d", len(ops), applied, evicted)

    async def _recap_segment(self, user_id: int, persona_id: str | None, conversation_id: str,
                             segment: tuple[datetime, datetime], at: datetime) -> None:
        d = self._deps
        lines = await d.store.lines_between(conversation_id, segment[0], segment[1], RECAP_LINES_MAX)
        if len(lines) < RECAP_MIN_LINES:
            return
        text = await self._call(user_id, at, "recap", lambda deps: recap(deps, lines))
        if text:
            await d.store.add_recap(user_id, source="conversation", text=text, persona_id=persona_id,
                                    conversation_id=conversation_id)
            d.count("recaps")
            logger.info("agents memory recap written source=conversation")

    async def _roll(self, user_id: int, persona_id: str | None, key: ThreadKey, touch: ThreadTouch,
                    at: datetime) -> None:
        d = self._deps
        backlog = await d.store.message_count(key.id) - d.settings().agents_history_max - touch.summarized_count
        if backlog < SUMMARY_BATCH:
            return
        dropped = await d.store.lines(key.id, offset=touch.summarized_count, limit=min(backlog, DROPPED_MAX))
        summary = await self._call(user_id, at, "summary", lambda deps: roll_summary(deps, touch, dropped))
        if summary is None:
            return
        rolls = touch.rolls_since_recap + (1 if summary != touch.summary else 0)
        if rolls >= RECAP_EVERY_ROLLS and summary:
            await d.store.add_recap(user_id, source="conversation", text=summary, persona_id=persona_id,
                                    conversation_id=key.id)
            d.count("recaps")
            rolls = 0
        await d.store.save_summary(user_id, key, summary=summary, summarized_count=touch.summarized_count + len(dropped),
                                   rolls_since_recap=rolls)
        d.count("summaries")
        logger.info("agents memory summary rolled lines=%d", len(dropped))
