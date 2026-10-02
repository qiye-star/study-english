from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.config import Settings
from app.db import make_engine
from app.errors import install_error_handlers
from app.bodylimit import BodyLimitMiddleware
from app.ratelimit import RateLimiter
from app.routers import ai_audio, ai_chat, config_api, health, sessions, speech, stubs


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    if settings.registration_mode == "invite" and not settings.invite_code:
        raise RuntimeError("REGISTRATION_MODE=invite requires INVITE_CODE")
    if settings.default_llm_model not in settings.llm_model_list:
        raise RuntimeError("DEFAULT_LLM_MODEL must be one of LLM_MODELS")

    engine = make_engine(settings.database_url)
    http = httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0))

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        yield
        await http.aclose()
        await engine.dispose()

    app = FastAPI(title="enjoy-server", lifespan=lifespan)
    app.state.settings = settings
    app.state.engine = engine
    app.state.sessionmaker = async_sessionmaker(engine, expire_on_commit=False)
    app.state.http = http
    app.state.limiter = RateLimiter(settings.rate_limit_per_minute)
    app.state.user_limiter = RateLimiter(settings.ai_rate_limit_per_minute)
    app.add_middleware(BodyLimitMiddleware)

    install_error_handlers(app)
    # stubs 含 /api/** 的兜底写入路由,必须最后注册。
    for module in (health, sessions, config_api, speech, ai_chat, ai_audio, stubs):
        app.include_router(module.router)
    return app
