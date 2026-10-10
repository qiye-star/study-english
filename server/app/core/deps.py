from collections.abc import AsyncIterator

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import learning_events, metering
from app.core.config import Settings
from app.core.quotas import quota_cache
from app.models import AccessToken, User
from app.core.security import hash_token


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.sessionmaker() as session:
        yield session


async def current_user(
    request: Request, session: AsyncSession = Depends(get_session)
) -> User:
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(401, "Unauthorized")
    result = await session.execute(
        select(User)
        .join(AccessToken, AccessToken.user_id == User.id)
        .where(AccessToken.token_hash == hash_token(token.strip()))
    )
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(401, "Unauthorized")
    if user.disabled_at is not None:
        raise HTTPException(403, "Account disabled")
    metering.bind_user(user.id)
    learning_events.bind(getattr(request.app.state, "learning_bus", None))  # learning-links spec §4.3
    return user


def client_ip(request: Request) -> str:
    if request.app.state.settings.trust_proxy_headers:
        # Right-most entry: the address our (trusted) proxy appended; anything left of it is client-controlled.
        forwarded = request.headers.get("x-forwarded-for", "").split(",")[-1].strip()
        if forwarded:
            return forwarded
    return request.client.host if request.client else "unknown"


async def auth_rate_limit(request: Request) -> None:
    if not request.app.state.limiter.allow(client_ip(request)):
        raise HTTPException(429, "Too many requests, please try again later")


async def limited_user(request: Request, user: User = Depends(current_user),
                       session: AsyncSession = Depends(get_session)) -> User:
    """已鉴权用户 + 按用户 ID 的每分钟限流(用于会消耗上游额度的接口);按用户配额覆盖优先(§7)。"""
    overrides = await quota_cache(request.app).get(session, user.id)
    if not request.app.state.user_limiter.allow(str(user.id), overrides.get("ai_rate_limit_per_minute")):
        raise HTTPException(429, "Too many requests, please try again later")
    return user
