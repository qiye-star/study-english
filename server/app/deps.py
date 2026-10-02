from collections.abc import AsyncIterator

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.models import AccessToken, User
from app.security import hash_token


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
    return user


def client_ip(request: Request) -> str:
    if request.app.state.settings.trust_proxy_headers:
        forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        if forwarded:
            return forwarded
    return request.client.host if request.client else "unknown"


async def auth_rate_limit(request: Request) -> None:
    if not request.app.state.limiter.allow(client_ip(request)):
        raise HTTPException(429, "Too many requests, please try again later")
