"""账号身份与登录会话的数据库操作(INDEX X4、X32)。

纯函数:会话、设置与时间都由调用方传入;不提交事务(调用方与其他写入同一次提交);不记录日志。
"""
from datetime import datetime, timedelta

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.security import hash_token, new_token
from app.models import AccessToken, SpeechToken


async def revoke_sessions(session: AsyncSession, user_id: int) -> int:
    """Delete every login token of the user and every unredeemed speech token; returns the login tokens removed."""
    access = await session.execute(delete(AccessToken).where(AccessToken.user_id == user_id))
    await session.execute(delete(SpeechToken).where(SpeechToken.user_id == user_id, SpeechToken.state == "issued"))
    return access.rowcount or 0


def issue_token(session: AsyncSession, user_id: int, settings: Settings, now: datetime) -> str:
    """Add a login token row (the caller commits) and return the plaintext token, which is never stored."""
    token = new_token()
    session.add(AccessToken(
        user_id=user_id, token_hash=hash_token(token), created_at=now,
        expires_at=now + timedelta(days=settings.access_token_ttl_days), last_used_at=now,
    ))
    return token
