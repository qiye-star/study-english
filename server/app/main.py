from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.config import Settings
from app.db import make_engine
from app.errors import install_error_handlers
from app.grammar import load_grammar_rules
from app.bodylimit import BodyLimitMiddleware
from app.ratelimit import RateLimiter
from app.routers import (
    ai_audio, ai_chat, assessments, config_api, conversations, grammar, grammar_prompt, health, practice_items, sessions, speech, stats, stubs, vocabulary, web,
)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    if settings.registration_mode == "invite" and not settings.invite_code:
        raise RuntimeError("REGISTRATION_MODE=invite requires INVITE_CODE")
    if settings.default_llm_model not in settings.llm_model_list:
        raise RuntimeError("DEFAULT_LLM_MODEL must be one of LLM_MODELS")

    grammar_rules = load_grammar_rules(settings)

    engine = make_engine(settings.database_url)
    http = httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0))

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        yield
        await http.aclose()
        await engine.dispose()

    app = FastAPI(title="enjoy-server", lifespan=lifespan)
    app.state.settings = settings
    app.state.grammar_rules = grammar_rules
    app.state.engine = engine
    app.state.sessionmaker = async_sessionmaker(engine, expire_on_commit=False)
    app.state.http = http
    app.state.limiter = RateLimiter(settings.rate_limit_per_minute)
    app.state.user_limiter = RateLimiter(settings.ai_rate_limit_per_minute)
    app.add_middleware(BodyLimitMiddleware)

    install_error_handlers(app)
    # 顺序重要:stubs 含 /api/** 的兜底写入路由,真实 API 必须在它之前;
    # web(静态托管 + SPA 回退)兜底所有非 API 的 GET,必须最后。
    for module in (
        health, sessions, grammar_prompt, config_api, speech, conversations, assessments,
        practice_items, vocabulary, stats, ai_chat, grammar, ai_audio, stubs, web,
    ):
        app.include_router(module.router)
    return app
