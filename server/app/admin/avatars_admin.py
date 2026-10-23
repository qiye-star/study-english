"""头像管理端(计划 S7、R-V7):举报列表(viewer)、移除头像(operator + step-up)、忽略举报(operator)。

每个写操作在同一事务里写审计后提交;文件在提交之后删除(`services.avatars.remove` 从不抛错)。
审计只记用户 id、动作与计数:不记头像 id、文件名、路径或字节(INDEX X6 的运营身份仍是登录名,但这里连登录名也不进审计)。
会话、设置与时间都作为参数传入(INDEX X32),路由负责从 `app.state` 取出。
"""
from datetime import datetime
from typing import Literal

from sqlalchemy import func, select, update

from app.admin import audit
from app.admin.audit import Actor
from app.admin.service import paginate
from app.models import AvatarReport, User, iso_utc
from app.services import avatars

Status = Literal["open", "resolved"]


class AvatarAdminError(Exception):
    def __init__(self, status: int, error: str):
        super().__init__(error)
        self.status = status
        self.error = error


def _iso(value: datetime | None) -> str | None:
    return iso_utc(value) if value is not None else None


async def reports(session, *, status: Status, page: int, per_page: int = 20) -> dict:
    """一行一个被举报的用户。open:当前头像上未处理的举报(旧头像的举报已随换头像失效);resolved:已处理的举报。
    `avatar_url` 只是公开路径 `/api/avatars/<id>`,没有头像时为 null。"""
    if status == "open":
        cond = (AvatarReport.resolved_at.is_(None), AvatarReport.avatar_id == User.avatar_id)
        order = func.min(AvatarReport.created_at)
    else:
        cond = (AvatarReport.resolved_at.is_not(None),)
        order = func.max(AvatarReport.created_at).desc()
    stmt = (select(User.id, User.username, User.nickname, User.avatar_id,
                   func.count(AvatarReport.id), func.max(AvatarReport.created_at))
            .join(AvatarReport, AvatarReport.avatar_user_id == User.id)
            .where(*cond)
            .group_by(User.id, User.username, User.nickname, User.avatar_id)
            .order_by(order, User.id))
    rows, nxt = await paginate(session, stmt, page, per_page)
    last_reason: dict[int, str] = {}
    if rows:
        latest = await session.execute(
            select(AvatarReport.avatar_user_id, AvatarReport.reason)
            .join(User, User.id == AvatarReport.avatar_user_id)
            .where(AvatarReport.avatar_user_id.in_([r[0] for r in rows]), *cond)
            .order_by(AvatarReport.created_at.desc(), AvatarReport.id.desc()))
        for user_id, reason in latest.all():
            last_reason.setdefault(user_id, reason)
    out = [{
        "user_id": user_id, "username": username, "nickname": nickname,
        "avatar_url": avatars.avatar_url(avatar_id), "reports": int(count),
        "last_reason": last_reason.get(user_id), "last_reported_at": _iso(last_at),
    } for user_id, username, nickname, avatar_id, count, last_at in rows]
    return {"users": out, "page": page, "next": nxt}


async def _resolve(session, user_id: int, avatar_id: str, now: datetime) -> int:
    result = await session.execute(
        update(AvatarReport)
        .where(AvatarReport.avatar_user_id == user_id, AvatarReport.avatar_id == avatar_id,
               AvatarReport.resolved_at.is_(None))
        .values(resolved_at=now))
    return result.rowcount or 0


async def _user(session, user_id: int) -> User:
    user = await session.get(User, user_id)
    if user is None:
        raise AvatarAdminError(404, "User not found")
    return user


async def remove(session, actor: Actor, blobs, user_id: int, *, reason: str, now: datetime) -> dict:
    """清空用户的 `avatar_id`、把该头像的举报置为已处理,写审计并提交;提交后才删除文件(R-V2、R-V7)。"""
    user = await _user(session, user_id)
    old_id = user.avatar_id
    if old_id is None:
        raise AvatarAdminError(404, "No avatar")
    user.avatar_id = None
    resolved = await _resolve(session, user_id, old_id, now)
    await audit.record(session, actor, "user.avatar.remove", target_type="user", target_id=user_id,
                       after={"removed": True, "reports": resolved}, reason=reason)
    await session.commit()
    await avatars.remove(blobs, old_id)  # after the commit; never raises
    return {"user_id": user_id, "removed": True, "reports_resolved": resolved}


async def dismiss(session, actor: Actor, user_id: int, *, now: datetime) -> dict:
    """忽略(保留头像)当前头像上的全部未处理举报。没有未处理举报时 404。"""
    user = await _user(session, user_id)
    resolved = await _resolve(session, user_id, user.avatar_id, now) if user.avatar_id is not None else 0
    if resolved == 0:
        raise AvatarAdminError(404, "No open reports")
    await audit.record(session, actor, "user.avatar.dismiss", target_type="user", target_id=user_id,
                       after={"reports": resolved})
    await session.commit()
    return {"user_id": user_id, "reports_resolved": resolved}
