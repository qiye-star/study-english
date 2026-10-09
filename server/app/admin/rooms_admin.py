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
from app.models import Room, RoomMember, RoomMessage, RoomReport, User, iso_utc

Resolution = Literal["dismissed", "removed_message", "kicked", "closed_room"]
RESOLUTIONS = ("dismissed", "removed_message", "kicked", "closed_room")
SNIPPET = 200


class RoomAdminError(Exception):
    def __init__(self, status: int, error: str):
        super().__init__(error)
        self.status = status
        self.error = error


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
    return {"id": room.id, "code": room.code, "last_code": room.last_code, "topic": room.topic, "status": room.status,
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
                         User.username.ilike(like, escape="\\")))
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
            "report_count": int(total_reports or 0),
            "members": [{"user_id": mm.user_id, "name": name, "role": mm.role, "joined_at": iso_utc(mm.joined_at),
                         "left_at": _iso(mm.left_at), "kicked": bool(mm.kicked), "online": mm.user_id in online}
                        for mm, name in people]}


def admin_message_out(m: RoomMessage, sender: str | None, audience: str | None) -> dict:
    """Admin view: the full text, also of hidden messages (shown struck through with a badge)."""
    return {"seq": m.seq, "id": m.id, "lane": m.lane, "kind": m.kind,
            "sender": {"kind": m.sender_kind, "id": m.sender_id, "name": sender},
            "audience": None if m.audience_id is None else {"id": m.audience_id, "name": audience},
            "text": m.text, "meta": m.meta, "assisted": bool(m.assisted), "reply_to": m.reply_to,
            "ai_status": m.ai_status, "created_at": iso_utc(m.created_at), "hidden": m.hidden_at is not None,
            "hidden_at": _iso(m.hidden_at)}


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
    return {"messages": [admin_message_out(m, s, a) for m, s, a in rows],
            "next_before_seq": rows[0][0].seq if more and rows else None}


async def message(session, room_id: str, message_id: str) -> RoomMessage | None:
    return await session.scalar(select(RoomMessage).where(RoomMessage.id == message_id,
                                                          RoomMessage.room_id == room_id))


def _snippet(text: str) -> str:
    return text if len(text) <= SNIPPET else text[:SNIPPET] + "…"


async def list_reports(session, *, status: Literal["open", "resolved"], page: int, per_page: int = 20) -> dict:
    reporter, sender = aliased(User), aliased(User)
    stmt = (select(RoomReport, Room.topic, Room.last_code, RoomMessage, reporter.username, sender.username)
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
    for rep, topic, code, msg, reporter_name, sender_name in rows:
        out.append({
            "id": rep.id, "room": {"id": rep.room_id, "topic": topic, "code": code},
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
