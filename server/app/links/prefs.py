"""每用户联动开关(user_link_prefs);没有行 = 开。"""
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import UserLinkPref


async def load(session: AsyncSession, user_id: int) -> dict[str, bool]:
    rows = (await session.execute(select(UserLinkPref.link_key, UserLinkPref.enabled)
                                  .where(UserLinkPref.user_id == user_id))).all()
    return {k: bool(v) for k, v in rows}


async def save(session: AsyncSession, user_id: int, key: str, enabled: bool, now: datetime) -> None:
    row = await session.get(UserLinkPref, (user_id, key))
    if row is None:
        session.add(UserLinkPref(user_id=user_id, link_key=key, enabled=enabled, updated_at=now))
    else:
        row.enabled, row.updated_at = enabled, now
    await session.commit()
