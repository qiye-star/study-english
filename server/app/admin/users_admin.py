"""用户治理(管理后台 v2 §7):停用/启用、撤销登录、重置密码、删除用户。

每个写操作在同一事务里写审计(`audit.record`)后提交。审计与日志永不含密码、token、临时密码。
在线连接(房间 WebSocket、一次性票据)由调用方(routers/admin_users.py)断开:admin 不导入 routers。
"""
import asyncio
import secrets
import shutil
from datetime import datetime

from sqlalchemy import delete, select, update

from app.admin import audit
from app.admin.audit import Actor
from app.core.security import hash_password
from app.models import (
    AccessToken, Assessment, Conversation, DailyUsage, Message, PracticeItem, PromotionMatch, RankProfile, Room,
    RoomMember, RoomMessage, RoomReport, SpeechToken, User, UserAchievement, UserQuotaOverride, VocabularyItem,
    XpEvent, iso_utc,
)
from app.services import recordings

TEMP_PASSWORD_LEN = 16
# Letters and digits without look-alikes (0/O/o, 1/l/I), so a password read out over the phone survives.
_ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"


class UserAdminError(Exception):
    def __init__(self, status: int, error: str):
        super().__init__(error)
        self.status = status
        self.error = error


async def _user(session, user_id: int) -> User:
    user = await session.get(User, user_id)
    if user is None:
        raise UserAdminError(404, "User not found")
    return user


async def _drop_tokens(session, user_id: int) -> int:
    access = await session.execute(delete(AccessToken).where(AccessToken.user_id == user_id))
    await session.execute(delete(SpeechToken).where(SpeechToken.user_id == user_id, SpeechToken.state == "issued"))
    return access.rowcount or 0


def temp_password() -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(TEMP_PASSWORD_LEN))


async def set_disabled(session, actor: Actor, user_id: int, disabled: bool, *, reason: str, now: datetime) -> dict:
    user = await _user(session, user_id)
    was = user.disabled_at is not None
    revoked = 0
    if disabled:
        if not was:
            user.disabled_at = now
        revoked = await _drop_tokens(session, user_id)  # also on a repeat: a stray login is cut again
    else:
        user.disabled_at = None
    await audit.record(session, actor, "user.disable" if disabled else "user.enable", target_type="user",
                       target_id=user_id, summary=user.username, before={"disabled": was},
                       after={"disabled": disabled, **({"revoked": revoked} if disabled else {})}, reason=reason)
    await session.commit()
    return {"user_id": user_id, "disabled_at": iso_utc(user.disabled_at) if user.disabled_at else None,
            "revoked": revoked}


async def revoke_tokens(session, actor: Actor, user_id: int) -> int:
    user = await _user(session, user_id)
    revoked = await _drop_tokens(session, user_id)
    await audit.record(session, actor, "user.revoke_tokens", target_type="user", target_id=user_id,
                       summary=user.username, after={"revoked": revoked})
    await session.commit()
    return revoked


async def reset_password(session, actor: Actor, user_id: int) -> str:
    """Returns the temporary password once; the caller only puts it in the response (never logs it)."""
    user = await _user(session, user_id)
    password = temp_password()
    user.password_hash = await asyncio.to_thread(hash_password, password)
    revoked = await _drop_tokens(session, user_id)
    await audit.record(session, actor, "user.reset_password", target_type="user", target_id=user_id,
                       summary=user.username, after={"revoked": revoked})
    await session.commit()
    return password


async def _release_rooms(session, user_id: int, now: datetime) -> tuple[list[str], int, int]:
    """Rooms owned by the user (rooms.owner_id is ON DELETE RESTRICT). Open ones close with reason "admin".
    Ownership passes to the earliest other member, so shared rooms and every message in them are kept (R-6);
    a room nobody else ever joined holds only the user's own content and is deleted with the user.
    Returns (rooms closed now, transferred, removed)."""
    closed: list[str] = []
    transferred = removed = 0
    for room in (await session.scalars(select(Room).where(Room.owner_id == user_id))).all():
        if room.status == "open":
            room.status, room.code, room.closed_at, room.close_reason = "closed", None, now, "admin"
            closed.append(room.id)
        heir = await session.scalar(
            select(RoomMember).where(RoomMember.room_id == room.id, RoomMember.user_id != user_id)
            .order_by(RoomMember.kicked, RoomMember.left_at.is_not(None), RoomMember.joined_at, RoomMember.id)
            .limit(1))
        if heir is not None:
            room.owner_id = heir.user_id
            if not heir.kicked and heir.left_at is None:
                heir.role = "owner"
            transferred += 1
        else:
            await session.execute(delete(RoomReport).where(RoomReport.room_id == room.id))
            await session.execute(delete(RoomMessage).where(RoomMessage.room_id == room.id))
            await session.execute(delete(RoomMember).where(RoomMember.room_id == room.id))
            await session.delete(room)
            removed += 1
    await session.flush()
    return closed, transferred, removed


async def delete_user(session, actor: Actor, settings, user_id: int, *, confirm_username: str, reason: str,
                      now: datetime) -> dict:
    """Deletes the user and everything they own (explicit deletes: SQLite does not enforce FK cascades),
    then their recordings directory. Room messages they sent in other rooms stay (R-6)."""
    user = await _user(session, user_id)
    if confirm_username.strip().lower() != user.username:
        raise UserAdminError(409, "Confirmation required")
    recording_bytes = await recordings.used_bytes(session, user_id)
    closed, transferred, removed = await _release_rooms(session, user_id, now)
    conversations = select(Conversation.id).where(Conversation.user_id == user_id)
    await session.execute(delete(Message).where(Message.conversation_id.in_(conversations)))
    await session.execute(update(Message).where(Message.assessment_id.in_(
        select(Assessment.id).where(Assessment.user_id == user_id))).values(assessment_id=None))
    for model in (Conversation, Assessment, PracticeItem, VocabularyItem, AccessToken, SpeechToken, RankProfile,
                  XpEvent, PromotionMatch, UserAchievement, UserQuotaOverride):
        await session.execute(delete(model).where(model.user_id == user_id))
    await session.execute(delete(RoomMember).where(RoomMember.user_id == user_id))
    await session.execute(delete(RoomReport).where(RoomReport.reporter_id == user_id))
    await session.execute(delete(DailyUsage).where(DailyUsage.subject == str(user_id)))
    await session.execute(delete(User).where(User.id == user_id))
    await audit.record(session, actor, "user.delete", target_type="user", target_id=user_id,
                       summary=user.username,
                       after={"deleted": True, "recordings_bytes": recording_bytes,
                              "rooms_transferred": transferred, "rooms_removed": removed},
                       reason=reason)
    await session.commit()
    _remove_recordings(settings, user_id)
    return {"deleted": user_id, "recordings_bytes": recording_bytes, "closed_rooms": closed}


def _remove_recordings(settings, user_id: int) -> None:
    try:
        path = recordings.absolute_path(settings.resolved_data_dir, f"recordings/{user_id}")
    except ValueError:
        return
    if path.is_dir():
        shutil.rmtree(path, ignore_errors=False)
