"""管理端的用户邮箱(计划 A1):脱敏显示与清除。

管理端永远只看到脱敏地址(`a***@qq.com`)与「已验证」标记;完整地址不进响应、审计或日志。
函数把会话、设置与时间作为参数(INDEX X32)。
"""
from datetime import datetime

from sqlalchemy import select

from app.admin import audit
from app.admin.audit import Actor
from app.core.secretbox import SecretBoxError, box_for
from app.models import User, UserIdentity
from app.services import identities
from app.services.identities import EMAIL_PROVIDER


class UserEmailError(Exception):
    def __init__(self, status: int, error: str):
        super().__init__(error)
        self.status = status
        self.error = error


async def attach_masked(session, settings, rows: list[dict]) -> list[dict]:
    """Adds `email_masked` (None when unbound or the keys are gone) and `email_verified` to each user row."""
    ids = [r["id"] for r in rows]
    tokens: dict[int, str] = {}
    verified: set[int] = set()
    if ids:
        verified = set((await session.scalars(select(User.id).where(
            User.id.in_(ids), User.email_verified_at.is_not(None)))).all())
        for user_id, token in (await session.execute(select(UserIdentity.user_id, UserIdentity.subject_enc).where(
                UserIdentity.provider == EMAIL_PROVIDER, UserIdentity.user_id.in_(ids)))).all():
            tokens[user_id] = token
    try:
        box = box_for(settings)
    except SecretBoxError:
        box = None
    for row in rows:
        masked = None
        if box is not None and row["id"] in verified and row["id"] in tokens:
            try:
                masked = identities.mask_email(identities.decrypt_email(box, tokens[row["id"]]))
            except Exception:  # noqa: BLE001 - a damaged copy shows as "no mask"; nothing is logged
                masked = None
        row["email_masked"] = masked
        row["email_verified"] = row["id"] in verified
    return rows


async def attach_masked_one(session, settings, row: dict | None) -> dict | None:
    if row is not None:
        await attach_masked(session, settings, [row])
    return row


async def clear_email(session, actor: Actor, user_id: int, *, reason: str, now: datetime) -> dict:
    """Removes the user's email identity and `email_verified_at`. Tokens stay (the plan does not revoke them).
    The audit holds ids and the bound flag only, never the address. One transaction."""
    user = await session.get(User, user_id)
    if user is None:
        raise UserEmailError(404, "User not found")
    was_bound = user.email_verified_at is not None or await session.scalar(
        select(UserIdentity.id).where(UserIdentity.user_id == user_id, UserIdentity.provider == EMAIL_PROVIDER)
    ) is not None
    await identities.clear_email(session, user)
    await audit.record(session, actor, "user.email.clear", target_type="user", target_id=user_id,
                       summary=user.username, before={"bound": was_bound}, after={"bound": False}, reason=reason)
    await session.commit()
    return {"user_id": user_id, "email_masked": None, "email_verified": False}
