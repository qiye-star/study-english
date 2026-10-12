"""一次回合(spec 2026-10-12-agents §3、§5、§6):扣额度 → 内置步骤 + 并行预取 → 拼提示词 → 一次流式模型调用 → 过程事件。
不用框架。模式(导师,A3)经 ModeHandler 插入;回合后的工作(记忆整理,A2)经 TurnHooks.after_turn 在后台运行。
回复语言:聊天模式在模式块之后加 `lang.chat_rule`;流经「模式过滤器 → <<ZH>> → 中文句兜底」;`note_zh` 只进 `Done` 与压缩过程。
用户文本、回复、人设只在内存;日志只有 `timing event=agent_turn` 的数字与固定字符串,以及模式名 / 异常类名。"""
import asyncio
import contextlib
import dataclasses
import logging
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import aclosing
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Protocol

from app.agents import lang, limits, prompt, trace
from app.agents import settings as agent_settings
from app.agents.context import PREFETCH_BUDGET_MS, SourceCtx, SourceOutcome, SourceRegistry, SourceResult, prefetch
from app.agents.personas import Persona
from app.agents.settings import AgentSettings
from app.core import timing
from app.models import utcnow
from app.providers import llm

logger = logging.getLogger(__name__)

_BACKGROUND: set[asyncio.Task] = set()  # after_turn tasks spawned without a runtime (kept referenced until done)


# ---- 模式(spec §13 ModeHandler)----

@dataclass(frozen=True)
class ModeBlock:
    text: str | None = None  # 放在最后一条 user 消息最前面的说明(我们写的,不转义)
    max_tokens: int | None = None  # None = AGENTS_CHAT_MAX_TOKENS
    user_text: str | None = None  # AX-1:text=None 的回合(导师开场 / 跳过后出下一题)里,作为用户消息(转义后放进 <user_message>)


class ModeError(Exception):
    """模式在 prepare / finish 里抛出;编排器映射成 SSE error{code}(HTTP 仍 200)。code 必须在 trace.ERROR_CODES 里,
    否则按 bad_request。消息里没有任何文本。"""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _error(code: str) -> trace.Error:
    return trace.Error(code if code in trace.ERROR_CODES else "bad_request")


class StreamFilter(Protocol):
    def feed(self, chunk: str) -> str: ...

    def flush(self) -> str: ...


class PassThrough:
    def feed(self, chunk: str) -> str:
        return chunk

    def flush(self) -> str:
        return ""


class ModeHandler(Protocol):
    name: str

    async def prepare(self, req: "TurnRequest") -> ModeBlock: ...

    def stream_filter(self) -> StreamFilter: ...

    async def finish(self, req: "TurnRequest", full_text: str) -> dict | None: ...


class ChatMode:
    name = "chat"

    async def prepare(self, req: "TurnRequest") -> ModeBlock:
        return ModeBlock()

    def stream_filter(self) -> StreamFilter:
        return PassThrough()

    async def finish(self, req: "TurnRequest", full_text: str) -> dict | None:
        return None


class ModeRegistry:
    def __init__(self):
        self._modes: dict[str, ModeHandler] = {"chat": ChatMode()}

    def register(self, handler: ModeHandler) -> None:
        name = getattr(handler, "name", "")
        if not isinstance(name, str) or not name or name == "chat":
            raise ValueError("invalid mode name")
        current = self._modes.get(name)
        if current is not None and current is not handler:
            raise ValueError(f"duplicate mode: {name}")
        self._modes[name] = handler

    def get(self, name: str) -> ModeHandler | None:
        return self._modes.get(name)

    def names(self) -> tuple[str, ...]:
        return tuple(self._modes)


# ---- 回合后钩子(spec §13 TurnHooks)----

@dataclass(frozen=True)
class TurnRecord:
    """交给 after_turn 钩子。text / reply 只在内存:不进日志、异常或 repr;钩子自己决定存什么(A2 的过滤规则)。"""
    turn_id: str
    user_id: int
    persona_id: str
    conversation_id: str | None
    room_id: str | None
    mode: str
    tutor_session_id: str | None
    in_room: bool
    text: str | None = field(repr=False)
    reply: str = field(repr=False)
    history_len: int
    usage: tuple[int, int] | None
    at: datetime


@dataclass
class TurnHooks:
    after_turn: list[Callable[[TurnRecord], Awaitable[None]]] = field(default_factory=list)


@dataclass
class AgentsRuntime:
    """每个应用一份(main.create_app 建;R-C2):来源注册表、模式、钩子、幂等账本、后台任务。"""
    registry: SourceRegistry = field(default_factory=SourceRegistry)
    modes: ModeRegistry = field(default_factory=ModeRegistry)
    hooks: TurnHooks = field(default_factory=TurnHooks)
    ledger: limits.TurnLedger = field(default_factory=limits.TurnLedger)
    tasks: set = field(default_factory=set)

    def spawn(self, coro: Awaitable[None]) -> asyncio.Task:
        task = asyncio.ensure_future(coro)
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)
        return task


def runtime(app) -> AgentsRuntime:
    rt = getattr(app.state, "agents", None)
    if rt is None:
        rt = app.state.agents = AgentsRuntime()
    return rt


# ---- 依赖与请求(spec §13;增量字段见 R-C21)----

@dataclass
class TurnDeps:
    http: Any
    settings: Callable[[], Any]  # 每次读(热改)
    sessions: Any  # async_sessionmaker
    registry: SourceRegistry
    modes: ModeRegistry
    hooks: TurnHooks
    app: Any = None  # 用 core.quotas 的进程缓存读按用户覆盖;None = 直接读覆盖表
    tools_probe: Callable[[], dict | None] = lambda: None
    clock: Callable[[], float] = time.perf_counter
    spawn: Callable[[Awaitable[None]], Any] | None = None
    now: Callable[[], datetime] = utcnow


def deps_for(app) -> TurnDeps:
    """路由(对话)与联机(A5)共用的依赖。"""
    rt = runtime(app)
    return TurnDeps(http=app.state.http, settings=lambda: app.state.settings, sessions=app.state.sessionmaker,
                    registry=rt.registry, modes=rt.modes, hooks=rt.hooks, app=app,
                    tools_probe=lambda: getattr(app.state, "agents_tools_probe", None), spawn=rt.spawn)


@dataclass(frozen=True)
class TurnRequest:
    user_id: int
    persona: Persona
    conversation_id: str | None
    room_id: str | None
    text: str | None = field(repr=False)
    history: list[dict] = field(repr=False)
    mode: str
    tutor_session_id: str | None
    client_turn_id: str
    in_room: bool = False
    agent_settings: AgentSettings | None = None  # None = 编排器自己读
    charge: bool = True  # False = 调用方已经扣过回合额度


# ---- 回合 ----

def _ms(clock: Callable[[], float], start: float) -> int:
    return max(0, round((clock() - start) * 1000))


async def _guarded(hook, record: TurnRecord) -> None:
    try:
        await hook(record)
    except Exception as e:  # noqa: BLE001 - a hook never breaks a turn
        logger.warning("agents after_turn hook failed error=%s", type(e).__name__)


def _spawn_default(coro) -> None:
    task = asyncio.ensure_future(coro)
    _BACKGROUND.add(task)
    task.add_done_callback(_BACKGROUND.discard)


def detach(deps: TurnDeps, coro) -> asyncio.Task:
    """把一段必须做完的收尾(退额度)放进独立任务:调用方此刻即使有待处理的取消,数据库操作也不会被取消打断
    (被打断会让连接被终止、退款丢失)。任务登记在 runtime(app).tasks(测试按它排空)。"""
    task = asyncio.ensure_future(coro)
    tasks = runtime(deps.app).tasks if deps.app is not None else _BACKGROUND
    tasks.add(task)
    task.add_done_callback(tasks.discard)
    return task


async def _refund(deps: TurnDeps, user_id: int, now: datetime) -> None:
    try:
        async with deps.sessions() as session:
            await limits.refund_turn(session, user_id, now)
    except Exception as e:  # noqa: BLE001
        logger.warning("agents refund failed error=%s", type(e).__name__)


async def run_turn(deps: TurnDeps, req: TurnRequest) -> AsyncIterator[trace.Event]:
    """事件顺序:start → step*(persona、来源 run/终态、history)→ thought* / delta* → meta? → done;或在任一处 error 结束。
    关闭这个迭代器(客户端断开)会立即关闭上游流。无论怎样结束都写一行 timing。"""
    settings = deps.settings()
    t0 = deps.clock()
    stats = {"status": "cancelled", "ctx_ms": 0, "ttft_ms": -1, "src_count": 0, "src_skipped": 0, "src_failed": 0,
             "chars": 0, "tools": "off", "delivered": False}
    try:
        async with aclosing(_turn(deps, req, settings, t0, stats)) as events:
            async for event in events:
                yield event
    finally:
        timing.log_timing("agent_turn", chars=stats["chars"], ctx_ms=stats["ctx_ms"],
                          mode=req.mode if req.mode in ("chat", "tutor") else "other", room=req.in_room,
                          src_count=stats["src_count"], src_failed=stats["src_failed"],
                          src_skipped=stats["src_skipped"], status=stats["status"], tools=stats["tools"],
                          total_ms=_ms(deps.clock, t0), ttft_ms=stats["ttft_ms"])


async def _turn(deps: TurnDeps, req: TurnRequest, settings, t0: float, stats: dict) -> AsyncIterator[trace.Event]:
    turn_id = str(uuid.uuid4())
    yield trace.Start(turn_id)
    if req.persona.disabled:
        stats["status"] = "disabled"
        yield trace.Error("disabled")
        return
    mode = deps.modes.get(req.mode)
    # AX-1:text=None 只允许导师模式(开场 / 跳过后出下一题);聊天模式的文本不能为空白
    if mode is None or (req.text is None and req.mode != "tutor") or (req.mode == "chat" and not (req.text or "").strip()):
        stats["status"] = "bad_request"
        yield trace.Error("bad_request")
        return
    now = deps.now()
    if req.charge:
        async with deps.sessions() as session:
            refused = await limits.consume_turn(session, deps.app if deps.app is not None else settings, settings,
                                                req.user_id, now)
        if refused is not None:
            stats["status"] = "limit"
            yield trace.Error("limit")
            return
    charged = [req.charge]

    async def refund_once(*, unwinding: bool = False) -> None:
        """退一次且只退一次;退款在独立任务里做完(取消不会打断它)。`unwinding`:正在因取消 / 异常退出,
        等待时若又收到取消就不再等(任务照样跑完),原异常继续往外抛。"""
        if charged[0]:
            charged[0] = False
            task = detach(deps, _refund(deps, req.user_id, now))
            if unwinding:
                with contextlib.suppress(asyncio.CancelledError):
                    await asyncio.shield(task)
            else:
                await asyncio.shield(task)

    try:
        async with aclosing(_charged(deps, req, mode, settings, t0, stats, turn_id, now, refund_once)) as events:
            async for event in events:
                yield event
    except BaseException:
        # 评审 #4 #5:扣了额度之后,只要回复文字还没送到客户端(取消 / 断开 / 意外异常)就退还;
        # 送出过文字就不退(Ruling:学习者已经看到内容、成本已经发生)。
        if not stats["delivered"]:
            await refund_once(unwinding=True)
        raise


async def _charged(deps: TurnDeps, req: TurnRequest, mode: ModeHandler, settings, t0: float, stats: dict, turn_id: str, now: datetime,
                   refund_once) -> AsyncIterator[trace.Event]:
    agent = req.agent_settings
    if agent is None:
        async with deps.sessions() as session:
            agent = await agent_settings.load(session, req.user_id)
    if req.agent_settings is not agent:  # R-AS9: a mode (the tutor) reads the asker's zh_note from req
        req = dataclasses.replace(req, agent_settings=agent)
    tools_mode = limits.effective_tools_mode(settings, deps.tools_probe())
    stats["tools"] = tools_mode
    history = prompt.clamp_history(req.history, settings.agents_history_max, settings.agents_history_chars_max)
    ids: dict[str, str] = {}

    def step(key: str, status: str, *, private: bool = False, result: SourceResult | None = None,
             ms: int | None = None) -> trace.Step:
        sid = ids.setdefault(key, f"s{len(ids) + 1}")
        params = trace.clean_params(result.params) if result is not None else {}
        return trace.Step(id=sid, group=trace.group_of(key), key=key, status=status,
                          label_key=result.label_key if result is not None else trace.label_of(key),
                          private=private, params=params or None, ms=ms)

    persona_done = SourceOutcome("persona", "done", None, 0, False)
    yield step("persona", "done", ms=0)
    ctx = SourceCtx(req.user_id, req.persona, agent, req.text, req.conversation_id or req.room_id, req.in_room)
    selected = deps.registry.selected(ctx, tools_mode)
    for source in selected:
        yield step(source.key, "run", private=source.private)
    c0 = deps.clock()
    outcomes = await prefetch(deps.registry, ctx, PREFETCH_BUDGET_MS, timeout_ms=settings.agents_source_timeout_ms,
                              tools_mode=tools_mode, clock=deps.clock) if selected else []
    stats.update(ctx_ms=_ms(deps.clock, c0), src_count=len(outcomes),
                 src_skipped=sum(o.status == "skip" for o in outcomes),
                 src_failed=sum(o.status == "fail" for o in outcomes))
    for o in outcomes:
        yield step(o.key, o.status, private=o.private, result=o.result, ms=o.ms)
    history_done = SourceOutcome("history", "done", SourceResult(trace.label_of("history"), {"turns": len(history)}, ""),
                                 0, False)
    yield step("history", "done", result=history_done.result, ms=0)

    try:
        block = await mode.prepare(req)
    except Exception as e:  # noqa: BLE001
        logger.warning("agents mode prepare failed mode=%s error=%s", mode.name, type(e).__name__)
        await refund_once()
        error = _error(e.code) if isinstance(e, ModeError) else trace.Error("bad_request")
        stats["status"] = error.code
        yield error
        return
    memory_block = next((o.result.block for o in outcomes if o.key == "memory" and o.result is not None), None)
    blocks = [(o.key, o.result.block) for o in outcomes if o.key != "memory" and o.result is not None and o.result.block]
    lang_block = lang.chat_rule(lang.want_note(agent.zh_note, req.persona.level)) if req.mode == "chat" else None
    messages = prompt.build_messages(req.persona, memory_block=memory_block, blocks=blocks, history=history,
                                     text=req.text if req.text is not None else block.user_text, mode_block=block.text,
                                     in_room=req.in_room, lang_block=lang_block)
    zh_filter, gate = lang.MarkerFilter(), lang.SentenceGate()
    flt = lang.Chain(mode.stream_filter(), zh_filter, gate)  # mode <<META>> -> <<ZH>> -> Chinese sentence fallback (R-AS10)
    raw: list[str] = []
    shown: list[str] = []
    thinking: list[str] = []
    usage_tokens = None
    try:
        async with aclosing(llm.complete_stream(
                deps.http, settings, messages, model=settings.resolved_agents_model,
                max_tokens=block.max_tokens or settings.agents_chat_max_tokens,
                temperature=limits.CHAT_TEMPERATURE, thinking=req.persona.deep_think)) as stream:
            async for piece in stream:
                if piece.kind == "usage":
                    usage_tokens = piece.usage
                elif piece.kind == "reasoning":
                    if req.persona.deep_think:
                        thinking.append(piece.text)
                        yield trace.Thought("reasoning", piece.text)
                else:
                    raw.append(piece.text)
                    visible = flt.feed(piece.text)
                    if visible:
                        if not shown:
                            stats["ttft_ms"] = _ms(deps.clock, t0)
                        shown.append(visible)
                        yield trace.Delta(visible)
                        stats["delivered"] = True
        tail = flt.flush()
        if tail:
            if not shown:
                stats["ttft_ms"] = _ms(deps.clock, t0)
            shown.append(tail)
            yield trace.Delta(tail)
            stats["delivered"] = True
        if not shown:
            raise llm.LlmUnavailable("empty", 200)
    except llm.LlmUnavailable as e:
        if not shown:
            await refund_once()
        stats["status"] = f"llm_{e.kind}"
        yield trace.Error("llm_unavailable")
        return

    reply = "".join(shown)
    meta = None
    mode_note = None
    try:
        found = await mode.finish(req, "".join(raw))
        if isinstance(found, dict) and "note_zh" in found:  # R-AS11: the Chinese note never enters the meta event
            mode_note, found = found["note_zh"], {k: v for k, v in found.items() if k != "note_zh"}
        meta =trace.Meta.from_dict(found) if found else None
    except ModeError as e:  # AX-1:the text already streamed (no refund); the client gets the code instead of done
        logger.warning("agents mode finish failed mode=%s error=ModeError", mode.name)
        stats["status"] = _error(e.code).code
        yield _error(e.code)
        return
    except Exception as e:  # noqa: BLE001 - a broken finish never hides the reply
        logger.warning("agents mode finish failed mode=%s error=%s", mode.name, type(e).__name__)
    if meta is not None:
        yield meta
    note = lang.resolve_note(agent.zh_note, mode_note, zh_filter.tail, gate.removed)
    thought = trace.Thought("reasoning", "".join(thinking)) if thinking else None
    total = _ms(deps.clock, t0)
    compact = trace.compact_trace([persona_done, *outcomes, history_done], tools_mode, thought,
                                  ms={"ctx": stats["ctx_ms"], "ttft": stats["ttft_ms"], "total": total}, note_zh=note)
    stats.update(status="ok", chars=len(reply))
    record = TurnRecord(turn_id=turn_id, user_id=req.user_id, persona_id=req.persona.id,
                        conversation_id=req.conversation_id, room_id=req.room_id, mode=req.mode,
                        tutor_session_id=req.tutor_session_id, in_room=req.in_room, text=req.text, reply=reply,
                        history_len=len(history), usage=usage_tokens, at=now)
    spawn = deps.spawn or _spawn_default
    for hook in list(deps.hooks.after_turn):
        spawn(_guarded(hook, record))
    yield trace.Done(text_len=len(reply), trace=compact, usage=usage_tokens, note_zh=note)
