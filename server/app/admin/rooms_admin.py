"""Room moderation queries (admin console v2 §6). Database only: live state (who is online, closing sockets)
comes from the caller (routers/admin_rooms.py via app.routers.rooms.runtime). Room messages are kept forever
(R-6); "hide" is a flag. Never logs message text."""
from datetime import datetime
from typing import Literal

from sqlalchemy import func, or_, select
from sqlalchemy.orm import aliased

from app.admin import audit
from app.admin.audit import Actor
from app.admin.service import _escape_like, paginate
from app.models import Room, RoomMember, RoomMessage, RoomReport, RoomVoice, User, iso_utc
from app.rooms.rules import clean_settings

Resolution = Literal["dismissed", "removed_message", "kicked", "closed_room"]
RESOLUTIONS = ("dismissed", "removed_message", "kicked", "closed_room")
SNIPPET = 200


class RoomAdminError(Exception):
    def __init__(self, status: int, error: str):
        super().__init__(error)
        self.status = status
        self.error = error


class RoomSettingsError(RoomAdminError):
    """400 {"error": "Invalid settings", "fields": {...}} (same shape as the member endpoints)."""

    def __init__(self, fields: dict[str, str]):
        super().__init__(400, "Invalid settings")
        self.fields = fields


def _iso(value: datetime | None) -> str | None:
    return iso_utc(value) if value is not None else None


def _counts():
    members = (select(func.count()).select_from(RoomMember)
               .where(RoomMember.room_id == Room.id, RoomMember.left_at.is_(None), RoomMember.kicked.is_(False))
               .correlate(Room).scalar_subquery())
    messages = select(func.count()).where(RoomMessage.room_id == Room.id).correlate(Room).scalar_subquery()
    reports = (select(func.count()).select_from(RoomReport)
               .where(RoomReport.room_id == Room.id, RoomReport.resolved_at.is_(None)).correlate(Room).scalar_subquery())
    return members, messages, reports


def _room_row(room: Room, owner: str | None, members: int, messages: int, reports: int, online: int) -> dict:
    # v2 rooms keep `topic` empty: `name` is the room's title (v1 rooms got name = topic in migration 0011)
    return {"id": room.id, "code": room.code, "last_code": room.last_code, "name": room.name or room.topic,
            "topic": room.topic, "status": room.status,
            "owner": {"id": room.owner_id, "name": owner}, "member_count": int(members or 0), "online_count": online,
            "message_count": int(messages or 0), "open_reports": int(reports or 0),
            "locked": room.locked, "ai_public": room.ai_public, "ai_muted": bool(room.ai_muted),
            "created_at": iso_utc(room.created_at), "last_active_at": iso_utc(room.last_active_at),
            "closed_at": _iso(room.closed_at), "close_reason": room.close_reason}


async def list_rooms(session, *, status: Literal["open", "closed", "all"], q: str, page: int, per_page: int,
                     online: dict[str, int]) -> dict:
    members, messages, reports = _counts()
    stmt = select(Room, User.username, members, messages, reports).outerjoin(User, User.id == Room.owner_id)
    count = select(func.count()).select_from(Room).outerjoin(User, User.id == Room.owner_id)
    conds = []
    if status != "all":
        conds.append(Room.status == status)
    q = q.strip()
    if q:
        like = f"%{_escape_like(q)}%"
        conds.append(or_(Room.code == q, Room.last_code == q, Room.topic.ilike(like, escape="\\"),
                         Room.name.ilike(like, escape="\\"), User.username.ilike(like, escape="\\")))
    if conds:
        stmt, count = stmt.where(*conds), count.where(*conds)
    rows, nxt = await paginate(session, stmt.order_by(Room.last_active_at.desc(), Room.id), page, per_page)
    return {"rooms": [_room_row(r, o, m, n, rep, online.get(r.id, 0)) for r, o, m, n, rep in rows],
            "page": page, "next": nxt, "total": int(await session.scalar(count) or 0)}


async def room_detail(session, room_id: str, online: set[int]) -> dict | None:
    members, messages, reports = _counts()
    row = (await session.execute(select(Room, User.username, members, messages, reports)
                                 .outerjoin(User, User.id == Room.owner_id).where(Room.id == room_id))).first()
    if row is None:
        return None
    room, owner, m, n, rep = row
    people = (await session.execute(
        select(RoomMember, User.username).outerjoin(User, User.id == RoomMember.user_id)
        .where(RoomMember.room_id == room_id).order_by(RoomMember.joined_at, RoomMember.id))).all()
    total_reports = await session.scalar(select(func.count()).select_from(RoomReport)
                                         .where(RoomReport.room_id == room_id))
    return {**_room_row(room, owner, m, n, rep, len(online)),
            "settings": settings_out(room),
            "report_count": int(total_reports or 0),
            "members": [{"user_id": mm.user_id, "name": name, "role": mm.role, "joined_at": iso_utc(mm.joined_at),
                         "left_at": _iso(mm.left_at), "kicked": bool(mm.kicked), "online": mm.user_id in online}
                        for mm, name in people]}


def settings_out(room: Room) -> dict:
    """The 7 room settings + lock + whether an invite link exists (never the token itself)."""
    return {"name": room.name, "scenario": room.scenario, "level": room.level, "join_mode": room.join_mode,
            "max_members": room.max_members, "ai_public": room.ai_public, "allow_voice": room.allow_voice,
            "locked": room.locked, "has_invite": room.invite_token is not None}


def admin_voice_out(v: RoomVoice) -> dict:
    """Voice details for the admin timeline; `audio` is False once the file was purged (text is kept)."""
    return {"duration_ms": v.duration_ms, "status": v.status, "transcript": v.transcript, "lang": v.lang,
            "translation": v.translation, "translation_status": v.translation_status,
            "audio": v.audio_path is not None, "purged_at": _iso(v.purged_at)}


def admin_message_out(m: RoomMessage, sender: str | None, audience: str | None, voice: RoomVoice | None = None) -> dict:
    """Admin view: the full text, also of hidden messages (shown struck through with a badge)."""
    return {"seq": m.seq, "id": m.id, "lane": m.lane, "kind": m.kind,
            "sender": {"kind": m.sender_kind, "id": m.sender_id, "name": sender},
            "audience": None if m.audience_id is None else {"id": m.audience_id, "name": audience},
            "text": m.text, "meta": m.meta, "assisted": bool(m.assisted), "reply_to": m.reply_to,
            "ai_status": m.ai_status, "created_at": iso_utc(m.created_at), "hidden": m.hidden_at is not None,
            "hidden_at": _iso(m.hidden_at), "voice": None if voice is None else admin_voice_out(voice)}


# Editable by an operator (spec 2026-10-10 §14); scenario and level stay the owner's choice.
ADMIN_SETTING_FIELDS = ("name", "join_mode", "max_members", "ai_public", "allow_voice")


def clean_admin_settings(raw: dict, *, site_max_members: int) -> tuple[dict, dict[str, str]]:
    """Partial validation of the operator-editable settings: the owner's rule (`rooms.rules.clean_settings`,
    SC1) applied to the five admin fields only (spec §14; scenario, level and the lock are not admin-editable)."""
    return clean_settings({k: raw[k] for k in ADMIN_SETTING_FIELDS if k in raw},
                          site_max_members=site_max_members, partial=True)


async def update_settings(session, actor: Actor, room_id: str, changes: dict, reason: str, *,
                          site_max_members: int) -> tuple[Room, list[dict]]:
    """Applies operator setting changes (already cleaned or raw: they are validated here), audits `room.settings`
    (field names and boolean/number values only; the room name is recorded as "<changed>") and commits. The caller
    holds the room store's admission lock (a concurrent join must not slip past a lowered `max_members`).
    Returns the room and the fields that really changed, `[{field, value}]` in setting order."""
    clean, errors = clean_admin_settings(changes, site_max_members=site_max_members)
    if errors:
        raise RoomSettingsError(errors)
    room = await session.get(Room, room_id)
    if room is None:
        raise RoomAdminError(404, "Room not found")
    if room.status != "open":
        raise RoomAdminError(409, "Room is closed")  # ended rooms are read-only (R2-2)
    changed = [{"field": k, "value": clean[k]} for k in ADMIN_SETTING_FIELDS
               if k in clean and getattr(room, k) != clean[k]]
    if not changed:
        return room, []
    if any(c["field"] == "max_members" for c in changed):
        members, _, _ = _counts()
        count = await session.scalar(select(members).select_from(Room).where(Room.id == room_id))
        if clean["max_members"] < int(count or 0):
            raise RoomAdminError(409, "Below current members")
    before = {c["field"]: ("<changed>" if c["field"] == "name" else getattr(room, c["field"])) for c in changed}
    for c in changed:
        setattr(room, c["field"], c["value"])
    if any(c["field"] == "join_mode" and c["value"] == "approval" for c in changed):
        room.invite_token = None  # links members shared in `code` mode must not bypass approval (R2-4)
    await audit.record(session, actor, "room.settings", target_type="room", target_id=room_id,
                       before=before,
                       after={c["field"]: ("<changed>" if c["field"] == "name" else c["value"]) for c in changed},
                       reason=reason)
    await session.commit()
    return room, changed


async def voice_audio(session, room_id: str, message_id: str) -> RoomVoice | None:
    """The voice row of a message in this room (any lane, hidden or not: the admin view ignores hiding)."""
    return await session.scalar(select(RoomVoice).join(RoomMessage, RoomMessage.id == RoomVoice.message_id)
                                .where(RoomVoice.message_id == message_id, RoomMessage.room_id == room_id))


async def room_messages(session, room_id: str, *, lane: Literal["public", "all"], before_seq: int | None,
                        limit: int) -> dict:
    sender, audience = aliased(User), aliased(User)
    stmt = (select(RoomMessage, sender.username, audience.username)
            .outerjoin(sender, sender.id == RoomMessage.sender_id)
            .outerjoin(audience, audience.id == RoomMessage.audience_id)
            .where(RoomMessage.room_id == room_id))
    if lane == "public":
        stmt = stmt.where(RoomMessage.lane == "public")
    if before_seq is not None:
        stmt = stmt.where(RoomMessage.seq < before_seq)
    rows = (await session.execute(stmt.order_by(RoomMessage.seq.desc()).limit(limit + 1))).all()
    more = len(rows) > limit
    rows = list(reversed(rows[:limit]))
    voice_ids = [m.id for m, _, _ in rows if m.kind == "voice"]
    voices = {} if not voice_ids else {
        v.message_id: v for v in (await session.scalars(select(RoomVoice)
                                                        .where(RoomVoice.message_id.in_(voice_ids)))).all()}
    return {"messages": [admin_message_out(m, s, a, voices.get(m.id)) for m, s, a in rows],
            "next_before_seq": rows[0][0].seq if more and rows else None}


async def message(session, room_id: str, message_id: str) -> RoomMessage | None:
    return await session.scalar(select(RoomMessage).where(RoomMessage.id == message_id,
                                                          RoomMessage.room_id == room_id))


def _snippet(text: str) -> str:
    return text if len(text) <= SNIPPET else text[:SNIPPET] + "…"


async def list_reports(session, *, status: Literal["open", "resolved"], page: int, per_page: int = 20) -> dict:
    reporter, sender = aliased(User), aliased(User)
    stmt = (select(RoomReport, Room.name, Room.topic, Room.last_code, RoomMessage, reporter.username, sender.username)
            .join(Room, Room.id == RoomReport.room_id)
            .outerjoin(RoomMessage, RoomMessage.id == RoomReport.message_id)
            .outerjoin(reporter, reporter.id == RoomReport.reporter_id)
            .outerjoin(sender, sender.id == RoomMessage.sender_id))
    if status == "open":
        stmt = stmt.where(RoomReport.resolved_at.is_(None)).order_by(RoomReport.created_at, RoomReport.id)
    else:
        stmt = stmt.where(RoomReport.resolved_at.is_not(None)).order_by(RoomReport.resolved_at.desc(),
                                                                        RoomReport.id.desc())
    rows, nxt = await paginate(session, stmt, page, per_page)
    out = []
    for rep, name, topic, code, msg, reporter_name, sender_name in rows:
        out.append({
            "id": rep.id, "room": {"id": rep.room_id, "name": name or topic, "topic": topic, "code": code},
            "message": None if msg is None else {
                "id": msg.id, "seq": msg.seq, "text": _snippet(msg.text), "hidden": msg.hidden_at is not None,
                "sender": {"kind": msg.sender_kind, "id": msg.sender_id, "name": sender_name}},
            "reporter": {"id": rep.reporter_id, "name": reporter_name}, "reason": rep.reason,
            "created_at": iso_utc(rep.created_at), "resolved_at": _iso(rep.resolved_at),
            "resolved_by": rep.resolved_by, "resolution": rep.resolution})
    return {"reports": out, "page": page, "next": nxt}


async def report_target(session, report_id: int) -> tuple[RoomReport, RoomMessage | None]:
    rep = await session.get(RoomReport, report_id)
    if rep is None:
        raise RoomAdminError(404, "Report not found")
    if rep.resolved_at is not None:
        raise RoomAdminError(409, "Report already resolved")
    return rep, await message(session, rep.room_id, rep.message_id)


async def resolve_report(session, actor: Actor, report_id: int, resolution: Resolution, now: datetime, *,
                         reason: str) -> dict:
    """Marks the report and every other open report on the same message resolved (the linked action has been
    taken by the caller). Audits `report.resolve` and commits."""
    if resolution not in RESOLUTIONS:
        raise RoomAdminError(422, "Invalid resolution")
    rep = await session.get(RoomReport, report_id)
    if rep is None:
        raise RoomAdminError(404, "Report not found")
    if rep.resolved_at is not None:
        raise RoomAdminError(409, "Report already resolved")
    same = (await session.scalars(select(RoomReport).where(RoomReport.message_id == rep.message_id,
                                                           RoomReport.room_id == rep.room_id,
                                                           RoomReport.resolved_at.is_(None)))).all()
    for r in same:
        r.resolved_at, r.resolved_by, r.resolution = now, actor.name[:32], resolution
    await audit.record(session, actor, "report.resolve", target_type="room_report", target_id=report_id,
                       summary=f"room {rep.room_id}", after={"resolution": resolution, "reports": len(same)},
                       reason=reason)
    await session.commit()
    return {"id": rep.id, "resolution": resolution, "resolved": len(same)}


async def record(session, actor: Actor, action: str, room_id: str, *, after: dict | None = None,
                 reason: str | None = None) -> None:
    """Audit a room action the caller already applied through the room store, then commit."""
    await audit.record(session, actor, action, target_type="room", target_id=room_id, after=after, reason=reason)
    await session.commit()
