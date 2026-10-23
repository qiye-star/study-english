"""用户治理(管理后台 v2 §7):停用/启用、撤销登录、重置密码、删除用户。

每个写操作在同一事务里写审计(`audit.record`)后提交。审计与日志永不含密码、token、临时密码。
在线连接(房间 WebSocket、一次性票据)由调用方(routers/admin_users.py)断开:admin 不导入 routers。
"""
import asyncio
import logging
import secrets
from datetime import datetime, timezone

from sqlalchemy import delete, select, update

from app.admin import audit
from app.admin.audit import Actor
from app.core.quotas import QUOTA_KEYS
from app.core.security import hash_password
from app.models import (
    AccessToken, Assessment, Conversation, DailyUsage, LibraryDub, Message, PracticeItem, PromotionMatch, RankProfile,
    RankProfileSnapshot, Room, RoomJoinRequest, RoomMember, RoomReport, SpeechToken, UpstreamCall, UsageDaily, User,
    UserAchievement, UserIdentity, UserQuotaOverride, VocabularyItem, XpEvent, iso_utc,
    LinkCredit, LinkMistakeWord, LinkWeakWord, LinkWordUse, UserLinkPref,
    WordbookEnrollment, WordbookEvent, WordbookReport,
    AgentPersona, AgentPersonaReport, AgentUserSettings,
    AgentMemoryItem, AgentMemoryTombstone, AgentProfile, AgentRecap, AgentThreadState,
    AgentTutorSession, ChatGreeting, ChatPrefs,
    LibraryAttempt, LibraryItem, LibrarySegment,
    SegmentLemma, WordUsage,  # L4 (plan 2026-10-21-l4 R2 / R10)
    ChangelogRead, VerificationCode, AvatarReport,
    InviteCode, InviteRedemption,
)
from app.library import paths as library_paths
from app.services import avatars, recordings

logger = logging.getLogger(__name__)
from app.services.identities import EMAIL_PROVIDER

TEMP_PASSWORD_LEN = 16
# Letters and digits without look-alikes (0/O/o, 1/l/I), so a password read out over the phone survives.
_ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"


# Every column that references users.id, handled explicitly because SQLite enforces no FK cascade; this mirrors
# the models' / migrations' ON DELETE so SQLite and Postgres end in the same state (tests/test_admin_users.py
# fails when a new table that references users is missing here). Rooms they own are released first (R-6).
USER_ROWS = (  # ON DELETE CASCADE: deleted with the user (vocabulary_items includes source "wordbook:<book>")
    (ChatGreeting, "user_id"), (ChatPrefs, "user_id"),  # greetings reference conversations: delete them first (plan 2026-10-23)
    (Conversation, "user_id"), (Assessment, "user_id"), (PracticeItem, "user_id"), (VocabularyItem, "user_id"),
    (AccessToken, "user_id"), (SpeechToken, "user_id"), (UserIdentity, "user_id"), (VerificationCode, "user_id"), (RankProfile, "user_id"), (XpEvent, "user_id"),
    (PromotionMatch, "user_id"), (UserAchievement, "user_id"), (UserQuotaOverride, "user_id"),
    (RoomMember, "user_id"), (RoomReport, "reporter_id"), (RoomJoinRequest, "user_id"),
    (WordbookEnrollment, "user_id"), (WordbookEvent, "user_id"),
    (UserLinkPref, "user_id"), (LinkMistakeWord, "user_id"), (LinkWeakWord, "user_id"), (LinkWordUse, "user_id"),
    (LinkCredit, "user_id"),
    (AgentPersona, "owner_id"), (AgentUserSettings, "user_id"), (AgentPersonaReport, "reporter_id"),
    (AgentMemoryItem, "user_id"), (AgentProfile, "user_id"), (AgentThreadState, "user_id"), (AgentRecap, "user_id"),
    (AgentMemoryTombstone, "user_id"), (AgentTutorSession, "user_id"),
    (LibraryAttempt, "user_id"), (LibraryDub, "user_id"), (LibraryItem, "user_id"),  # segments go first, by item (no user_id column)
    (ChangelogRead, "user_id"),  # per-user changelog read position (plan 2026-10-14-changelog R-20)
    (AvatarReport, "reporter_id"), (AvatarReport, "avatar_user_id"),  # avatar reports, both roles (plan avatar R-V10)
    (WordUsage, "user_id"),  # vocabulary activation counters (plan L4 R2)
)
USER_REFS_NULLED = (  # ON DELETE SET NULL: the row stays without the user's id
    (Room, "owner_id"),  # via _release_rooms (ownership moves to another member first)
    (WordbookReport, "user_id"),  # a content report stays for moderation
    (InviteCode, "owner_user_id"),  # a user's invite code outlives them only as a revoked row (delete_user revokes it first)
    (InviteRedemption, "user_id"),  # who invited whom stays; the invitee is gone (invites v2 R-I11)
)


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
    """Rooms owned by the user. Open ones close with reason "admin". Ownership passes to the earliest other member;
    a room nobody else ever joined is kept as a closed, read-only room without owner (owner_id NULL, shown as
    已删除用户). Owner ruling: rooms and messages are never deleted with a user (R-6).
    Returns (rooms closed now, transferred, orphaned)."""
    closed: list[str] = []
    transferred = orphaned = 0
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
            room.owner_id = None
            orphaned += 1
    await session.flush()
    return closed, transferred, orphaned


async def _anonymise_metering(session, user_id: int) -> None:
    """Review security m9: cost history stays, but no longer names the deleted user (raw calls -> NULL user, daily
    buckets merged into the system bucket user_id=0, which is unique per day/feature/kind/provider/model)."""
    await session.execute(update(UpstreamCall).where(UpstreamCall.user_id == user_id).values(user_id=None))
    for row in (await session.scalars(select(UsageDaily).where(UsageDaily.user_id == user_id))).all():
        system = await session.scalar(select(UsageDaily).where(
            UsageDaily.day == row.day, UsageDaily.feature == row.feature, UsageDaily.kind == row.kind,
            UsageDaily.provider == row.provider, UsageDaily.model == row.model, UsageDaily.user_id == 0))
        if system is None:
            row.user_id = 0
            continue
        for column in ("calls", "errors", "units_in", "units_out", "ms_total"):
            setattr(system, column, getattr(system, column) + getattr(row, column))
        await session.delete(row)
    await session.flush()


async def delete_user(session, actor: Actor, settings, user_id: int, *, store, confirm_username: str, reason: str,
                      now: datetime) -> dict:
    """Deletes the user and everything they own (explicit deletes: SQLite does not enforce FK cascades),
    then their recordings directory. Room messages they sent in other rooms stay (R-6)."""
    user = await _user(session, user_id)
    if confirm_username.strip().lower() != user.username:
        raise UserAdminError(409, "Confirmation required")
    avatar_id = user.avatar_id  # read before the commit expires the row; the file goes after it (R-V10)
    recording_bytes = await recordings.used_bytes(session, user_id)
    closed, transferred, orphaned = await _release_rooms(session, user_id, now)
    conversations = select(Conversation.id).where(Conversation.user_id == user_id)
    await session.execute(delete(Message).where(Message.conversation_id.in_(conversations)))
    await session.execute(update(Message).where(Message.assessment_id.in_(
        select(Assessment.id).where(Assessment.user_id == user_id))).values(assessment_id=None))
    # reports other users filed against this user's personas (SQLite has no FK cascade from agent_personas)
    await session.execute(delete(AgentPersonaReport).where(AgentPersonaReport.persona_id.in_(
        select(AgentPersona.id).where(AgentPersona.owner_id == user_id))))
    # library sentences reference the user's items, not the user (spec 2026-10-13-video-import §4)
    library_items = list((await session.scalars(select(LibraryItem.id).where(LibraryItem.user_id == user_id))).all())
    await session.execute(delete(LibrarySegment).where(LibrarySegment.item_id.in_(
        select(LibraryItem.id).where(LibraryItem.user_id == user_id))))
    await session.execute(delete(SegmentLemma).where(SegmentLemma.scope == "lib", SegmentLemma.owner_id.in_(  # L4 R10
        select(LibraryItem.id).where(LibraryItem.user_id == user_id))))
    # codes are found by their target: a hidden "already registered" row has no user_id. Before the identity goes.
    await session.execute(delete(VerificationCode).where(
        VerificationCode.channel == "email",
        VerificationCode.target_hmac.in_(select(UserIdentity.subject_hmac).where(
            UserIdentity.user_id == user_id, UserIdentity.provider == EMAIL_PROVIDER))))
    # invites v2 (R-I11): the permanent user code stops working and its plain copy is wiped before the owner goes
    await session.execute(update(InviteCode).where(InviteCode.owner_user_id == user_id,
                                                   InviteCode.revoked_at.is_(None)).values(revoked_at=now))
    await session.execute(update(InviteCode).where(InviteCode.owner_user_id == user_id).values(code_enc=None))
    for model, column in USER_ROWS:
        await session.execute(delete(model).where(getattr(model, column) == user_id))
    for model, column in USER_REFS_NULLED:
        await session.execute(update(model).where(getattr(model, column) == user_id).values({column: None}))
    await session.execute(delete(DailyUsage).where(DailyUsage.subject == str(user_id)))
    await session.execute(delete(RankProfileSnapshot).where(RankProfileSnapshot.user_id == user_id))
    await _anonymise_metering(session, user_id)
    await session.execute(delete(User).where(User.id == user_id))
    await audit.record(session, actor, "user.delete", target_type="user", target_id=user_id,
                       summary=user.username,
                       after={"deleted": True, "recordings_bytes": recording_bytes,
                              "rooms_transferred": transferred, "rooms_orphaned": orphaned},
                       reason=reason)
    await session.commit()
    await _remove_recordings(store, user_id)
    await library_paths.remove_user_files(store, settings.resolved_data_dir, user_id, library_items)  # media, posters, staging
    await avatars.remove(store, avatar_id)  # the avatar object; after the commit, never raises (R-V10)
    return {"deleted": user_id, "recordings_bytes": recording_bytes, "closed_rooms": closed}


def _quota_item(settings, key: str, row: UserQuotaOverride | None, now: datetime) -> dict:
    field = QUOTA_KEYS[key]
    live = row is not None and (row.expires_at is None or _utc(row.expires_at) > now)
    return {"key": key, "setting": field, "default": getattr(settings, field),
            "override": row.value if live else None, "expired": row is not None and not live,
            "expires_at": iso_utc(row.expires_at) if row is not None and row.expires_at else None,
            "note": row.note if row is not None else "", "updated_by": row.updated_by if row is not None else None,
            "updated_at": iso_utc(row.updated_at) if row is not None else None}


async def quotas(session, settings, user_id: int, now: datetime) -> list[dict]:
    await _user(session, user_id)
    rows = {r.key: r for r in (await session.scalars(
        select(UserQuotaOverride).where(UserQuotaOverride.user_id == user_id))).all()}
    return [_quota_item(settings, key, rows.get(key), now) for key in QUOTA_KEYS]


OPERATOR_FACTOR = 10  # operators may set a per-user quota up to 10x the site default (review security m2)
# ... and never above the value that needs superadmin + step-up for the site-wide setting
OPERATOR_CAP = {"ai_rate_limit_per_minute": 600}


def operator_ceiling(settings, key: str) -> int:
    ceiling = max(1, int(getattr(settings, QUOTA_KEYS[key]))) * OPERATOR_FACTOR
    return min(ceiling, OPERATOR_CAP.get(key, ceiling))


async def set_quota(session, actor: Actor, settings, user_id: int, key: str, *, value: int,
                    expires_at: datetime | None, note: str, now: datetime) -> dict:
    if key not in QUOTA_KEYS:
        raise UserAdminError(404, "Unknown quota")
    user = await _user(session, user_id)
    row = await session.get(UserQuotaOverride, (user_id, key))
    before = None if row is None else {"value": row.value, "expires_at": iso_utc(row.expires_at) if row.expires_at else None}
    if row is None:
        row = UserQuotaOverride(user_id=user_id, key=key)
        session.add(row)
    row.value, row.expires_at, row.note, row.updated_by, row.updated_at = value, expires_at, note, actor.name[:64], now
    await audit.record(session, actor, "quota.set", target_type="user", target_id=user_id,
                       summary=f"{user.username} {key}", before=before,
                       after={"key": key, "value": value, "expires_at": iso_utc(expires_at) if expires_at else None})
    await session.commit()
    return _quota_item(settings, key, row, now)


async def clear_quota(session, actor: Actor, user_id: int, key: str) -> None:
    if key not in QUOTA_KEYS:
        raise UserAdminError(404, "Unknown quota")
    user = await _user(session, user_id)
    row = await session.get(UserQuotaOverride, (user_id, key))
    if row is None:
        raise UserAdminError(404, "Override not found")
    before = {"key": key, "value": row.value}
    await session.delete(row)
    await audit.record(session, actor, "quota.clear", target_type="user", target_id=user_id,
                       summary=f"{user.username} {key}", before=before)
    await session.commit()


def _utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


async def _remove_recordings(blobs, user_id: int) -> None:
    """The user's assessment recordings, by prefix, after the commit. A failure is logged by class and never raised
    (plan L1 Task 15: the old local rmtree raised after the commit; the store path does not)."""
    try:
        await blobs.delete_prefix(f"recordings/{user_id}/")
    except Exception as exc:  # noqa: BLE001 - after commit
        logger.warning("user recordings delete failed code=%s", getattr(exc, "code", type(exc).__name__))
