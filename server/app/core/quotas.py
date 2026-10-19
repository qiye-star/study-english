"""按用户的配额覆盖(管理后台 v2 §7)。读取统一走 quota_for;没有覆盖或已过期时用全站设置。

放在 core:`core/deps.limited_user` 也要读按用户覆盖,而 core 不能导入 services。
"""
import time
from collections.abc import Callable
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import UserQuotaOverride

# 配额键 → Settings 字段名
QUOTA_KEYS: dict[str, str] = {
    "recording_quota_mb": "recording_quota_mb",
    "max_conversations": "max_conversations",
    "max_messages_per_conversation": "max_messages_per_conversation",
    "max_practice_items": "max_practice_items",
    "max_vocab_items": "max_vocab_items",
    "ai_rate_limit_per_minute": "ai_rate_limit_per_minute",
    "rank_match_daily_attempts": "rank_match_daily_attempts",
    "rooms_assist_daily_per_user": "rooms_assist_daily_per_user",
    "rooms_max_owned": "rooms_max_owned",
    "rooms_voice_quota_mb": "rooms_voice_quota_mb",
    "rooms_voice_daily_per_user": "rooms_voice_daily_per_user",
    "wordbook_ai_daily_per_user": "wordbook_ai_daily_per_user",
    "agents_turns_daily_per_user": "agents_turns_daily_per_user",
    "agents_personas_max": "agents_personas_max",
    "agents_tutor_daily_per_user": "agents_tutor_daily_per_user",
    "agents_memory_extract_daily_per_user": "agents_memory_extract_daily_per_user",
    "library_quota_mb": "library_quota_mb",
    "library_max_items": "library_max_items",
    "invites_user_code_max_uses": "invites_user_code_max_uses",
}


def _utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


async def overrides_for(session: AsyncSession, user_id: int, now: datetime | None = None) -> dict[str, int]:
    """该用户当前有效(未过期)的覆盖值。"""
    now = now or datetime.now(timezone.utc)
    rows = (await session.scalars(select(UserQuotaOverride).where(UserQuotaOverride.user_id == user_id))).all()
    return {r.key: r.value for r in rows if r.expires_at is None or _utc(r.expires_at) > now}


async def quota_for(session: AsyncSession, settings, user_id: int, key: str, now: datetime | None = None) -> int:
    field = QUOTA_KEYS[key]  # KeyError on unknown keys is intended
    return (await overrides_for(session, user_id, now)).get(key, getattr(settings, field))


class QuotaCache:
    """Per-process cache of each user's override rows (hot paths such as `limited_user` run on every AI call).
    Rows are cached with their expiry, so an override still lapses on time; admin writes call `invalidate`."""

    def __init__(self, ttl_seconds: float = 30.0, clock: Callable[[], float] = time.monotonic):
        self._ttl = ttl_seconds
        self._clock = clock
        self._items: dict[int, tuple[float, list[tuple[str, int, datetime | None]]]] = {}

    async def get(self, session: AsyncSession, user_id: int, now: datetime | None = None) -> dict[str, int]:
        now = now or datetime.now(timezone.utc)
        tick = self._clock()
        item = self._items.get(user_id)
        if item is None or item[0] <= tick:
            rows = (await session.execute(select(UserQuotaOverride.key, UserQuotaOverride.value,
                                                 UserQuotaOverride.expires_at)
                                          .where(UserQuotaOverride.user_id == user_id))).all()
            if len(self._items) >= MAX_CACHED_USERS:
                self._items.clear()
            item = self._items[user_id] = (tick + self._ttl, [tuple(r) for r in rows])
        return {k: v for k, v, exp in item[1] if exp is None or _utc(exp) > now}

    def invalidate(self, user_id: int | None = None) -> None:
        if user_id is None:
            self._items.clear()
        else:
            self._items.pop(user_id, None)


MAX_CACHED_USERS = 10_000


def quota_cache(app) -> QuotaCache:
    cache = getattr(app.state, "quota_cache", None)
    if cache is None:
        cache = app.state.quota_cache = QuotaCache()
    return cache


async def effective(session: AsyncSession, app_or_settings, user_id: int, key: str) -> int:
    """The user's limit for `key`: a live override (cached when given the app), else the site-wide setting."""
    field = QUOTA_KEYS[key]
    state = getattr(app_or_settings, "state", None)
    if state is None:
        return await quota_for(session, app_or_settings, user_id, key)
    overrides = await quota_cache(app_or_settings).get(session, user_id)
    return overrides.get(key, getattr(state.settings, field))
