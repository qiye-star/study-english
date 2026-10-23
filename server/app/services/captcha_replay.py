"""人机验证挑战的一次性认领与过期清理(spec 2026-10-20-captcha-altcha §5、R-C7、R-C22)。

只收参数(session、签名、时间),不读应用状态与设置。不提交:认领与清理都由调用方的事务提交(R-C22)。
"""
from datetime import datetime

from sqlalchemy import delete

from app.core.db import insert_ignore
from app.models import CaptchaReplay


async def claim(session, signature: str, expires_at: datetime, now: datetime) -> bool:
    """记下这个挑战已用过。首次认领返回 True;同一签名再次认领返回 False(INSERT ... ON CONFLICT DO NOTHING)。

    `now` 暂不使用(日后做就地清理时用),保留为参数,不要删。
    """
    result = await session.execute(
        insert_ignore(session, CaptchaReplay.__table__).values(signature=signature, expires_at=expires_at))
    return (result.rowcount or 0) == 1


async def purge(session, now: datetime) -> int:
    """删除已过期的认领行(expires_at < now),返回删除行数。过期签名本来就过不了 expiresAt 检查。"""
    result = await session.execute(delete(CaptchaReplay).where(CaptchaReplay.expires_at < now))
    return result.rowcount or 0
