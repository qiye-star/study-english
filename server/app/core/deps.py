import logging
from collections.abc import AsyncIterator
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, Request
from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import learning_events, metering
from app.core.account_policy import binding_state
from app.core.config import Settings
from app.core.quotas import quota_cache
from app.models import AccessToken, User, utcnow
from app.core.security import hash_token

logger = logging.getLogger(__name__)

# Sliding renewal (INDEX X4, plan R-F8): a token used again within this window keeps its expiry; otherwise
# the first use after the window moves expires_at to now + access_token_ttl_days (one write per hour at most).
RENEW_AFTER = timedelta(hours=1)


def _utc(value: datetime) -> datetime:
    """SQLite reads back naive datetimes (they are UTC)."""
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.sessionmaker() as session:
        yield session


async def _authenticate(request: Request, session: AsyncSession) -> tuple[User, AccessToken]:
    """Bearer token -> live user and its token row (INDEX X3). Shared by every auth dependency."""
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(401, "Unauthorized")
    now = utcnow()
    result = await session.execute(
        select(User, AccessToken)
        .join(AccessToken, AccessToken.user_id == User.id)
        .where(
            AccessToken.token_hash == hash_token(token.strip()),
            or_(AccessToken.expires_at.is_(None), AccessToken.expires_at > now),
        )
    )
    row = result.first()
    if row is None:
        raise HTTPException(401, "Unauthorized")
    user, access = row
    if user.disabled_at is not None:
        raise HTTPException(403, "Account disabled")
    if access.last_used_at is None or _utc(access.last_used_at) < now - RENEW_AFTER:
        ttl = request.app.state.settings.access_token_ttl_days
        await session.execute(
            update(AccessToken)
            .where(AccessToken.id == access.id)
            .values(last_used_at=now, expires_at=now + timedelta(days=ttl))
        )
        await session.commit()  # expire_on_commit=False: `user` stays readable after this
    request.state.access_token_id = access.id  # logout deletes this row (routers/sessions.py)
    metering.bind_user(user.id)
    learning_events.bind(getattr(request.app.state, "learning_bus", None))  # learning-links spec §4.3
    return user, access


async def current_user(
    request: Request, session: AsyncSession = Depends(get_session)
) -> User:
    user, _ = await _authenticate(request, session)
    state = binding_state(request.app.state.settings, utcnow())  # per request: a hot settings change applies at once
    if state == "enforced" and user.email_verified_at is None:
        logger.debug("email binding required: request blocked state=%s", state)
        raise HTTPException(403, "email_binding_required")
    return user


async def current_user_unbound(
    request: Request, session: AsyncSession = Depends(get_session)
) -> User:
    """Same authentication as current_user; for the account endpoints that must work while binding is pending."""
    user, _ = await _authenticate(request, session)
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
