import secrets
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.core.config import Settings
from app.core.db import make_engine
from app.core.errors import install_error_handlers
from app.services.grammar import load_grammar_rules
from app.core.logging_setup import configure_logging
from app.core.bodylimit import BodyLimitMiddleware
from app.core.ratelimit import RateLimiter
from app.realtime.realtime_tickets import RealtimeRegistry, TicketStore
from app.routers import (
    admin, admin_web, ai_audio, ai_chat, assessments, config_api, conversations, grammar, grammar_prompt, health, practice_items, rank, realtime, rooms, sessions, speech, stats, stubs, vocabulary, web,
)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    configure_logging(settings.log_level)
    if settings.registration_mode == "invite" and not settings.invite_code:
        raise RuntimeError("REGISTRATION_MODE=invite requires INVITE_CODE")
    if settings.default_llm_model not in settings.llm_model_list:
        raise RuntimeError("DEFAULT_LLM_MODEL must be one of LLM_MODELS")

    if settings.admin_enabled and len(settings.admin_password) < 12:
        raise RuntimeError("ADMIN_PASSWORD must be at least 12 characters")

    grammar_rules = load_grammar_rules(settings)

    engine = make_engine(settings.database_url)
    http = httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0))

    @asynccontextmanager
    async def lifespan(app_: FastAPI):
        yield
        await realtime.cancel_drains(app_)  # late assessments of closed calls (before the engine goes)
        await http.aclose()
        await engine.dispose()

    app = FastAPI(title="enjoy-server", lifespan=lifespan)
    app.state.settings = settings
    app.state.admin_secret = (settings.admin_session_secret or secrets.token_hex(32)).encode()
    app.state.grammar_rules = grammar_rules
    app.state.engine = engine
    app.state.sessionmaker = async_sessionmaker(engine, expire_on_commit=False)
    app.state.http = http
    app.state.limiter = RateLimiter(settings.rate_limit_per_minute)
    app.state.user_limiter = RateLimiter(settings.ai_rate_limit_per_minute)
    app.state.realtime_tickets = TicketStore(settings.realtime_ticket_ttl_seconds)
    app.state.realtime_registry = RealtimeRegistry(settings.realtime_max_sessions)
    app.state.realtime_drains = set()  # background drains of closed calls (see routers/realtime.py)
    app.add_middleware(BodyLimitMiddleware)

    install_error_handlers(app)
    # 顺序重要:stubs 含 /api/** 的兜底写入路由,真实 API 必须在它之前;
    # admin_web(/admin 静态托管)与 web(SPA 回退)兜底非 API 的 GET,且 admin_web 必须在 web 之前。
    for module in (
        health, sessions, grammar_prompt, config_api, speech, conversations, assessments,
        practice_items, vocabulary, stats, ai_chat, grammar, ai_audio, realtime, rank, rooms, admin, stubs, admin_web, web,
    ):
        app.include_router(module.router)
    return app
