"""上下文来源(spec 2026-10-12-agents §4.6):协议、注册表、开关判断、并行预取(逐源超时 + 总预算,超时 skip、
异常 fail、None 记 done;都不阻断回复)。具体来源不在这里:学习数据在 app/links/agent_sources.py(R-A1),
记忆在 agents/memory/(A2)。日志只记来源键与异常类名,永不记录文本、词或 params。"""
import asyncio
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal, Protocol

logger = logging.getLogger(__name__)

PREFETCH_BUDGET_MS = 250  # spec §4.6 总预算(固定,不是设置)
BLOCK_MAX_CHARS = 800  # 单个来源放进提示词的文本上限
TOOL_KEYS = ("lookup", "learned_words", "weak_words", "due_words", "memory")  # spec §4.3 用户 / 角色工具开关
TOOL_OF = {"word_lookup": "lookup", "learned_words": "learned_words", "weak_words": "weak_words",
           "due_words": "due_words", "memory": "memory"}
BUILTIN_STEPS = ("persona", "history")
Status = Literal["run", "done", "fail", "skip"]


@dataclass(frozen=True)
class SourceCtx:
    user_id: int
    persona: Any  # agents.personas.Persona(这里只读 .tools)
    settings: Any  # agents.settings.AgentSettings(这里只读 .tools / .memory_enabled / .share_in_rooms)
    text: str | None
    thread_id: str | None
    in_room: bool = False


@dataclass(frozen=True)
class SourceResult:
    label_key: str
    params: dict
    block: str  # 放进提示词的纯文本(预取会截到 BLOCK_MAX_CHARS)
    ms: int = 0


class ContextSource(Protocol):
    key: str
    private: bool  # True:读个人数据;联机里只在 share_in_rooms 时运行,过程只给提问者

    async def load(self, ctx: SourceCtx) -> SourceResult | None: ...


@dataclass(frozen=True)
class SourceOutcome:
    key: str
    status: Status
    result: SourceResult | None
    ms: int
    private: bool


def enabled(source, ctx: SourceCtx, tools_mode: str) -> bool:
    """AGENTS_TOOLS_MODE=off 关掉除 memory 外的全部来源(R-C15);工具类来源还要用户开关与角色工具都开;
    memory 还要 memory_enabled;联机里私有来源需要 share_in_rooms。"""
    key = source.key
    if tools_mode == "off" and key != "memory":
        return False
    tool = TOOL_OF.get(key)
    if tool is not None:
        if not ctx.settings.tools.get(tool, True) or tool not in tuple(ctx.persona.tools):
            return False
    if key == "memory" and not ctx.settings.memory_enabled:
        return False
    if ctx.in_room and source.private and not ctx.settings.share_in_rooms:
        return False
    return True


class SourceRegistry:
    def __init__(self):
        self._sources: dict[str, ContextSource] = {}

    def register(self, source: ContextSource) -> None:
        key = getattr(source, "key", "")
        if not isinstance(key, str) or not key or key in BUILTIN_STEPS:
            raise ValueError("invalid source key")
        current = self._sources.get(key)
        if current is not None and current is not source:
            raise ValueError(f"duplicate source key: {key}")
        self._sources[key] = source

    def unregister(self, key: str) -> None:
        self._sources.pop(key, None)

    def keys(self) -> tuple[str, ...]:
        return tuple(self._sources)

    def get(self, key: str) -> ContextSource | None:
        return self._sources.get(key)

    def selected(self, ctx: SourceCtx, tools_mode: str) -> list[ContextSource]:
        return [s for s in self._sources.values() if enabled(s, ctx, tools_mode)]


def _ms(clock: Callable[[], float], start: float) -> int:
    return max(0, round((clock() - start) * 1000))


async def prefetch(registry: SourceRegistry, ctx: SourceCtx, budget_ms: int = PREFETCH_BUDGET_MS, *,
                   timeout_ms: int = 150, tools_mode: str = "prefetch",
                   clock: Callable[[], float] = time.perf_counter) -> list[SourceOutcome]:
    """按注册顺序返回每个被选中来源的结果。每源超时 = min(timeout_ms, budget_ms);总预算到了仍未结束的一律取消、记 skip。"""
    sources = registry.selected(ctx, tools_mode)
    if not sources:
        return []
    per_source = min(timeout_ms, budget_ms) / 1000
    start = clock()

    async def one(source) -> SourceOutcome:
        t0 = clock()
        try:
            result = await asyncio.wait_for(source.load(ctx), per_source)
        except TimeoutError:
            return SourceOutcome(source.key, "skip", None, _ms(clock, t0), source.private)
        except Exception as e:  # noqa: BLE001 - a broken source never breaks the reply
            logger.warning("agents source failed key=%s error=%s", source.key, type(e).__name__)
            return SourceOutcome(source.key, "fail", None, _ms(clock, t0), source.private)
        ms = _ms(clock, t0)
        if result is not None:
            result = SourceResult(result.label_key, dict(result.params or {}), (result.block or "")[:BLOCK_MAX_CHARS], ms)
        return SourceOutcome(source.key, "done", result, ms, source.private)

    tasks = [asyncio.ensure_future(one(s)) for s in sources]
    done, pending = await asyncio.wait(tasks, timeout=budget_ms / 1000)
    for task in pending:
        task.cancel()
    if pending:
        await asyncio.gather(*pending, return_exceptions=True)
    out = []
    for source, task in zip(sources, tasks):
        if task in done and not task.cancelled():
            out.append(task.result())
        else:
            out.append(SourceOutcome(source.key, "skip", None, _ms(clock, start), source.private))
    return out
