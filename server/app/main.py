import asyncio
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timezone

import httpx
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.admin import backups, usage
from app.agents.orchestrator import runtime as agents_runtime
from app.core import log_buffer, metering
from app.core.config import Settings
from app.core.db import make_engine
from app.core.errors import install_error_handlers
from app.core.learning_events import LearningBus
from app.services.grammar import load_grammar_rules
from app.core.logging_setup import configure_logging
from app.core.bodylimit import BodyLimitMiddleware
from app.core.maintenance import MaintenanceMiddleware
from app.core.ratelimit import RateLimiter
from app.core.settings_registry import SECRETS
from app.core.runtime_settings import (
    SettingsHub, reload_from_db, run_startup_hooks, runtime_problems, watch_revisions,
)
from app.links import purge as links_purge
from app.links.agent_sources import install as install_agent_sources
from app.links.setup import install as install_links
from app.agents.memory.setup import install as install_memory  # agents memory (plan A2)
from app.agents.tutor.handler import TutorModeHandler  # agents tutor mode (plan A3)
from app.library.worker import install as install_library  # imported media library (plan 2026-10-13 S1)
from app.realtime.realtime_tickets import RealtimeRegistry, TicketStore
from app.routers import (
    admin, admin_accounts, admin_agents, agents, agents_memory, agents_tutor, admin_auth, admin_links, admin_ops, announcements, admin_prompts, admin_rank, admin_rooms, admin_settings, admin_usage,
    admin_users, admin_web, admin_wordbook, ai_audio, ai_chat, assessments, config_api, conversations, dictionary, grammar, grammar_prompt, health, links, practice_items, rank, realtime, rooms, rooms_agents, rooms_summary, rooms_voice, sessions, speech, stats, stubs, vocabulary, web, wordbook,
)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    configure_logging(settings.log_level)
    # The same checks guard every admin settings save, so a saved configuration can always start.
    for problem in runtime_problems(settings):
        raise RuntimeError(problem)

    grammar_rules = load_grammar_rules(settings)

    engine = make_engine(settings.database_url)
    http = httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0))

    @asynccontextmanager
    async def lifespan(app_: FastAPI):
        await reload_from_db(app_, startup=True)  # DB overrides on top of env (admin v2 §3.6)
        await run_startup_hooks(app_)
        await rooms.rooms_startup(app_)
        tasks = app_.state.background_tasks
        tasks["watcher"] = asyncio.create_task(watch_revisions(app_))
        tasks["metering"] = asyncio.create_task(metering.flush_loop(app_))  # admin v2 §8.1
        tasks["backups"] = asyncio.create_task(backups.daily_loop(app_))  # admin v2 §12
        tasks["links"] = asyncio.create_task(app_.state.learning_bus.run())  # learning links §4.4
        tasks["links_purge"] = asyncio.create_task(links_purge.daily_loop(app_))  # learning links §12
        tasks["library"] = asyncio.create_task(app_.state.library.loop())  # library queue (video-import §6.1)
        yield
        await _stop_tasks(tasks, exclude="metering")
        await app_.state.library.shutdown()  # running jobs stay `processing`; recovered at the next start
        for task in list(agents_runtime(app_).tasks):  # after-turn hooks still running (memory extraction, plan A2)
            task.cancel()
        with suppress(asyncio.TimeoutError, Exception):  # last pass over queued learning events, give up after 2 s
            await asyncio.wait_for(app_.state.learning_bus.drain(), 2.0)
        with suppress(asyncio.TimeoutError, Exception):  # last memory jobs, give up after 2 s (plan A2)
            await asyncio.wait_for(app_.state.agent_memory.worker.join(), 2.0)
        await rooms.rooms_shutdown(app_)  # sockets close with 1012 so clients reconnect at once (spec §5.8)
        await realtime.cancel_drains(app_)  # late assessments of closed calls (before the engine goes)
        await _stop_tasks(tasks)  # metering last: its final flush keeps the calls made while shutting down
        await http.aclose()
        await engine.dispose()

    app = FastAPI(title="enjoy-server", lifespan=lifespan)
    app.state.base_settings = settings  # env only; app.state.settings = base + DB overrides
    app.state.settings = settings
    app.state.started_at = datetime.now(timezone.utc)
    app.state.admin_secret = None  # loaded on first admin use: admin.sessions.ensure_secret (review B1)
    app.state.grammar_rules = grammar_rules
    app.state.engine = engine
    app.state.sessionmaker = async_sessionmaker(engine, expire_on_commit=False)
    app.state.http = http
    app.state.limiter = RateLimiter(settings.rate_limit_per_minute)
    app.state.user_limiter = RateLimiter(settings.ai_rate_limit_per_minute)
    app.state.realtime_tickets = TicketStore(settings.realtime_ticket_ttl_seconds)
    app.state.realtime_registry = RealtimeRegistry(settings.realtime_max_sessions)
    app.state.realtime_drains = set()  # background drains of closed calls (see routers/realtime.py)
    app.state.background_tasks = {}  # name -> asyncio.Task, reported by GET /api/admin/system
    app.state.learning_bus = LearningBus(lambda: app.state.settings)  # learning links §4 (reads settings per call)
    install_links(app)  # gate + each link's subscriptions (app.links.registry)
    agents_runtime(app)  # agents spec §3.3: sources, modes, hooks, idempotency ledger (plan R-C2); the only access is runtime(app)
    install_agent_sources(app)  # learned / weak / due words + word lookup (links layer, R-A1; gated per turn)
    # --- anchors for the other agents plans (append below, in this order; runtime(app) is the only access) ---
    install_memory(app, agents_runtime(app))  # agents memory: source "memory" + after_turn hook (plan A2)
    agents_runtime(app).modes.register(TutorModeHandler(app.state.sessionmaker, lambda: app.state.settings))  # plan A3 tutor
    # plan A5 (rooms): room persona wiring via deps_for(app) / TurnRequest(in_room=True)
    # Rooms v2 (plan P2-1): installed onto the RoomsRuntime when routers.rooms.runtime() first builds it.
    app.state.rooms_extensions = (rooms_voice.install, rooms_summary.install, rooms_agents.install)  # + agents (plan A5)
    install_library(app)  # app.state.library: queue, media tickets, fetch stage (spec 2026-10-13-video-import §6.1)
    # --- anchor for plan S2 (2026-10-13-video-import-server-import): `library_import.install(app)` goes on the next
    # line; it registers the yt-dlp fetch stage with app.state.library.set_fetch_stage(...) ---
    app.state.settings_hub = hub = SettingsHub(app.state)
    register_core_listeners(app, hub)
    _log_secrets(None, settings)
    app.add_middleware(BodyLimitMiddleware)
    app.add_middleware(MaintenanceMiddleware)  # reads app.state.settings per request (hot)
    app.add_middleware(metering.MeteringMiddleware)  # added last = outermost

    install_error_handlers(app)
    # 顺序重要:stubs 含 /api/** 的兜底写入路由,真实 API 必须在它之前;
    # admin_web(/admin 静态托管)与 web(SPA 回退)兜底非 API 的 GET,且 admin_web 必须在 web 之前。
    for module in (
        agents_memory,  # /api/agents/memory/*; must precede A1's `agents` router and stubs (plan A2)
        health, announcements, sessions, grammar_prompt, config_api, speech, conversations, assessments,
        practice_items, vocabulary, stats, ai_chat, grammar, ai_audio, realtime, rank, rooms, rooms_agents, rooms_voice, rooms_summary, wordbook,
        dictionary,  # /api/dictionary/*: before stubs (catch-all writes)
        links, agents, agents_tutor, admin_auth, admin, admin_accounts, admin_settings, admin_rank, admin_users, admin_rooms, admin_usage, admin_ops,
        admin_prompts, admin_wordbook, admin_links, admin_agents, stubs, admin_web, web,
    ):
        app.include_router(module.router)
    return app


async def _stop_tasks(tasks: dict[str, asyncio.Task], exclude: str | None = None) -> None:
    chosen = [t for name, t in tasks.items() if name != exclude]
    for task in chosen:
        task.cancel()
    for task in chosen:
        with suppress(asyncio.CancelledError, Exception):
            await task


def _log_secrets(old: Settings | None, new: Settings) -> None:
    """The log viewer redacts every current secret value (admin v2 §13)."""
    log_buffer.set_secrets(str(getattr(new, key, "") or "") for key in SECRETS)


def register_core_listeners(app: FastAPI, hub: SettingsHub) -> None:
    """Push hot-reloaded settings into objects that baked a value in at startup (admin v2 §3.6)."""
    state = app.state

    def grammar_prepare(new: Settings) -> None:
        load_grammar_rules(new)  # raises RuntimeError with a value-free message

    def grammar_apply(old: Settings, new: Settings) -> None:
        if not getattr(state, "grammar_rules_pinned", False):  # set by the prompts lane (G1)
            state.grammar_rules = load_grammar_rules(new)

    def drop(*names: str):
        def apply(old: Settings, new: Settings) -> None:
            for name in names:
                if hasattr(state, name):
                    delattr(state, name)  # rebuilt lazily from the new settings (services/provider_clients.py)
        return apply

    hub.subscribe("logging", lambda o, n: configure_logging(n.log_level), keys={"log_level"})
    hub.subscribe("limiter", lambda o, n: setattr(state.limiter, "limit", n.rate_limit_per_minute),
                  keys={"rate_limit_per_minute"})
    hub.subscribe("user_limiter", lambda o, n: setattr(state.user_limiter, "limit", n.ai_rate_limit_per_minute),
                  keys={"ai_rate_limit_per_minute"})
    hub.subscribe("realtime_tickets", lambda o, n: state.realtime_tickets.set_ttl(n.realtime_ticket_ttl_seconds),
                  keys={"realtime_ticket_ttl_seconds"})
    hub.subscribe("realtime_registry", lambda o, n: state.realtime_registry.set_max(n.realtime_max_sessions),
                  keys={"realtime_max_sessions"})
    hub.subscribe("azure", drop("azure"), keys={"azure_speech_key", "azure_speech_region"})
    hub.subscribe("xfyun", drop("xfyun"), keys={"xfyun_app_id", "xfyun_api_key", "xfyun_api_secret", "xfyun_ws_url"})
    hub.subscribe("grammar_rules", grammar_apply, keys={"grammar_prompt"}, prepare=grammar_prepare)
    hub.subscribe("log_secrets", _log_secrets, keys=set(SECRETS))
    hub.subscribe("realtime_maintenance", realtime.end_calls_on_maintenance(app), keys={"maintenance_mode"})
    # Spec §9 "maintenance drops live room sockets with 1012" lives in the rooms runtime listener
    # (`routers/rooms.RoomsRuntime.reconfigure`); new room sockets are refused with 1013 by MaintenanceMiddleware.
    # Prices are parsed per request (admin.usage.prices_for); this only rejects a save with bad numbers.
    hub.subscribe("metering_prices", lambda o, n: None, keys={"usage_prices_json"},
                  prepare=lambda new: usage.parse_prices(new.usage_prices_json))
