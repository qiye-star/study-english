"""上下文来源 `memory`(spec §4.6、§8.2):private=True(联机里这一步只给提问者看)。

先看开关(服务端 AGENTS_MEMORY_ENABLED;用户 memory_enabled 与 tools.memory;联机时 share_in_rooms,裁定 R-M6),
再取线程快照;没有快照才查库(一次会话三次查询)并按 AGENTS_MEMORY_TOKENS 组块。params 只有条数,不含任何文本。"""
import time
from collections.abc import Callable
from typing import Any

from app.agents.context import SourceResult
from app.agents.memory.cache import SnapshotCache
from app.agents.memory.profile import profile_line
from app.agents.memory.retrieve import build_block
from app.agents.memory.store import MemoryStore, ThreadKey
from app.models import utcnow

KEY = "memory"
LABEL_KEY = "agents.step.memory"


def enabled_for(server: Any, prefs: Any, in_room: bool) -> bool:
    if not server.agents_memory_enabled or not prefs.memory_enabled:
        return False
    if not (getattr(prefs, "tools", None) or {}).get("memory", True):
        return False
    return not in_room or bool(prefs.share_in_rooms)


def snapshot_key(user_id: int, thread: ThreadKey | None, persona_id: str) -> tuple[int, str, str, str]:
    return (user_id, thread.kind if thread else "none", thread.id if thread else "", persona_id)


class MemorySource:
    key = KEY
    private = True

    def __init__(self, store: MemoryStore, cache: SnapshotCache, settings: Callable[[], Any], *, clock=utcnow,
                 timer: Callable[[], float] = time.perf_counter):
        self._store, self._cache, self._settings, self._clock, self._timer = store, cache, settings, clock, timer

    async def load(self, ctx) -> SourceResult | None:
        server = self._settings()
        if not enabled_for(server, ctx.settings, ctx.in_room):
            return None
        started = self._timer()
        persona_id = getattr(ctx.persona, "id", None) or ""
        thread = ThreadKey("room" if ctx.in_room else "conversation", ctx.thread_id) if ctx.thread_id else None
        key = snapshot_key(ctx.user_id, thread, persona_id)
        block = self._cache.get(key)
        if block is None:
            views, data, summary = await self._store.snapshot_inputs(ctx.user_id, persona_id or None, thread)
            block = build_block(views, ctx.text or "", server.agents_memory_tokens, profile_line=profile_line(data),
                                thread_summary=summary, now=self._clock())
            self._cache.put(key, block)
        if not block.text:
            return None
        return SourceResult(label_key=LABEL_KEY, params={"count": block.count}, block=block.text,
                            ms=int((self._timer() - started) * 1000))
