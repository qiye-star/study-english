"""把记忆装进应用:main.py 调用一次 install(app, runtime(app))(INDEX X1:A1 的 AgentsRuntime 是唯一入口,
由 main 传入——本包不能导入 app.agents.orchestrator)。
不受 AGENTS_ENABLED 控制(开关在来源与任务里每次读),这样管理端热切换不需要重启。"""
from dataclasses import dataclass
from datetime import datetime
from functools import partial

from app.agents import settings as agent_settings
from app.agents.memory.cache import SnapshotCache
from app.agents.memory.source import MemorySource
from app.agents.memory.store import MemoryStore
from app.agents.memory.worker import CALL_TIMEOUT, CAP_SCOPE, MemoryDeps, MemoryWorker
from app.providers import llm
from app.services import usage


@dataclass
class MemoryRuntime:
    store: MemoryStore
    cache: SnapshotCache
    worker: MemoryWorker
    source: MemorySource


def memory_model(settings) -> str:
    """AGENTS_MEMORY_MODEL → AGENTS_MODEL → 默认模型(spec §10.1)。"""
    return settings.resolved_agents_memory_model


async def _user_settings(app, user_id: int):
    async with app.state.sessionmaker() as session:
        return await agent_settings.load(session, user_id)


async def _complete(app, messages: list[dict], max_tokens: int) -> str:
    settings = app.state.settings
    return await llm.complete(app.state.http, settings, messages, model=memory_model(settings), max_tokens=max_tokens,
                              temperature=0, timeout=CALL_TIMEOUT)


async def _consume(app, user_id: int, at: datetime) -> bool:
    async with app.state.sessionmaker() as session:
        return await usage.consume(session, CAP_SCOPE, str(user_id), usage.utc_day(at),
                                   app.state.settings.agents_memory_extract_daily_per_user)


async def _refund(app, user_id: int, at: datetime) -> None:
    async with app.state.sessionmaker() as session:
        await usage.refund(session, CAP_SCOPE, str(user_id), usage.utc_day(at))


def install(app, agents) -> MemoryRuntime:
    """agents: A1 的 AgentsRuntime(registry / hooks)。"""
    store = MemoryStore(app.state.sessionmaker)
    cache = SnapshotCache()
    deps = MemoryDeps(store=store, cache=cache, settings=lambda: app.state.settings,
                      user_settings=partial(_user_settings, app), complete=partial(_complete, app),
                      consume=partial(_consume, app), refund=partial(_refund, app))
    runtime = MemoryRuntime(store, cache, MemoryWorker(deps), MemorySource(store, cache, lambda: app.state.settings))
    agents.registry.register(runtime.source)
    agents.hooks.after_turn.append(runtime.worker.after_turn)
    app.state.agent_memory = runtime
    return runtime
