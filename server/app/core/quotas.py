"""按用户的配额覆盖(管理后台 v2 §7)。读取统一走 quota_for;没有覆盖或已过期时用全站设置。

放在 core:`core/deps.limited_user` 也要读按用户覆盖,而 core 不能导入 services。
"""
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
