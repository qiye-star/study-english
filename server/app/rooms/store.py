"""All DB access for rooms (spec 2026-10-09 §5, §6). Callers hold `RoomHub.lock(room_id)` around `append`
so the per-room `seq` stays gapless in the single worker. Never logs message text.

Retention: room messages are kept forever by default (`RoomLimits.retention_days == 0`); closed rooms stay
readable as history for their members. `purge` only deletes when ROOM_MESSAGE_RETENTION_DAYS > 0."""
import asyncio
import base64
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError

from app.models import (
    RankProfile, Room, RoomJoinRequest, RoomMember, RoomMessage, RoomReaction, RoomReport, RoomSummary, RoomVoice, User,
    display_name, iso_utc, new_uuid,
)
from app.rooms.codes import generate_code
from app.rooms.protocol import REACTION_KEYS
from app.rooms.rules import CEFR_BY_TIER, MAX_TOPIC, NAME_MAX, SETTING_FIELDS, RoomLimits, clean_text, default_level
from app.services.avatars import avatar_url
from app.services.stats import as_utc

CODE_ATTEMPTS = 5
INVITE_ATTEMPTS = 3
REPORT_REASONS = ("spam", "abuse", "other")
AI_NAME = "AI 助手"
QUOTE_MAX = 80  # code points kept in a quote snapshot (spec 2026-10-10 §6.4)
QUOTABLE = ("text", "voice", "ai_answer")  # also the kinds that take reactions
IN_CHUNK = 500  # bound for IN (...) lists (same as services/chat_recordings.py)


class RoomError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class MemberView:
    user_id: int
    name: str
    role: str
    avatar_id: str | None = None


def _agent_meta(m: RoomMessage) -> dict | None:
    """`meta.agent` of a room agent's answer (plan 2026-10-12-agents-rooms R-RA2), else None."""
    agent = m.meta.get("agent") if isinstance(m.meta, dict) else None
    return agent if isinstance(agent, dict) and isinstance(agent.get("name"), str) else None


def _ai_name(m: RoomMessage, name: str | None) -> str:
    """Speaker label for AI context and quotes: the agent's name, the legacy assistant name, or the member."""
    if m.sender_kind != "ai":
        return name or ""
    agent = _agent_meta(m)
    return agent["name"] if agent else AI_NAME


def voice_out(v: RoomVoice) -> dict:
    """The shared voice state of one message (spec 2026-10-10 §9). `audio` is False once an admin purged the file."""
    return {"duration_ms": v.duration_ms, "status": v.status, "transcript": v.transcript, "lang": v.lang,
            "translation": v.translation, "translation_status": v.translation_status, "attempts": v.attempts,
            "audio": v.audio_path is not None}


def sender_avatar(m: RoomMessage) -> str | None:
    """The sender's avatar id as read by `RoomStore._named` (a join on users, not a column, plan S8)."""
    return getattr(m, "sender_avatar_id", None)


def message_out(m: RoomMessage, name: str | None, *, voice: RoomVoice | None = None,
                reactions: list[dict] | None = None, avatar_id: str | None = None) -> dict:
    """Member view (protocol v2 shape). A message hidden by an admin keeps its row (R-6) but its text, meta, quote,
    voice and reactions are withheld. `quote` is a promoted copy of `meta.quote`. Callers that need the voice and
    reaction attachments use `RoomStore.replay_out / history_out / out_one` (plan P2-2)."""
    hidden = m.hidden_at is not None
    quote = m.meta.get("quote") if isinstance(m.meta, dict) else None
    return {"seq": m.seq, "id": m.id, "lane": m.lane, "kind": m.kind,
            # only member messages show an avatar: AI and system rows carry null whatever their sender id (R-V8)
            "sender": {"kind": m.sender_kind, "id": m.sender_id, "name": name,
                       "avatar_url": avatar_url(avatar_id) if m.sender_kind == "user" else None},
            "text": "" if hidden else m.text, "assisted": bool(m.assisted), "reply_to": m.reply_to,
            "ai_status": m.ai_status, "meta": None if hidden else m.meta, "created_at": iso_utc(m.created_at),
            "hidden": hidden, "quote": None if hidden else quote,
            "voice": None if hidden or voice is None else voice_out(voice),
            "reactions": [] if hidden else list(reactions or [])}


def room_out(room: Room, *, my_role: str | None, member_count: int, online_count: int) -> dict:
    """`topic` stays for v1 clients and now carries the room name (spec R2-1)."""
    return {"id": room.id, "code": room.code, "topic": room.name or room.topic, "status": room.status,
            "locked": room.locked, "ai_public": room.ai_public, "ai_muted": bool(room.ai_muted),
            "owner_id": room.owner_id, "my_role": my_role, "member_count": member_count, "online_count": online_count,
            "created_at": iso_utc(room.created_at), "closed_at": iso_utc(room.closed_at) if room.closed_at else None,
            "name": room.name, "scenario": room.scenario, "level": room.level, "join_mode": room.join_mode,
            "max_members": room.max_members, "allow_voice": room.allow_voice,
            "close_reason": room.close_reason,
            "agent_ids": list((room.agent_config or {}).get("persona_ids") or [])
            if isinstance(room.agent_config, dict) else []}


def request_out(r: RoomJoinRequest, name: str, room_name: str, avatar_id: str | None = None) -> dict:
    return {"id": r.id, "room_id": r.room_id, "room_name": room_name, "user_id": r.user_id, "name": name,
            "avatar_url": avatar_url(avatar_id), "status": r.status, "created_at": iso_utc(r.created_at)}


REOPEN_ADMIN_ONLY = ("admin",)  # R-O9: a room an operator closed can only be reopened by an operator


def opened_anchor(room: Room) -> datetime:
    """The start of the room's current life: `opened_at`, or `created_at` for rows from before migration 0014 and for
    rows an old process inserted during a rolling deploy (R-O1). Always UTC-aware."""
    return as_utc(room.opened_at or room.created_at)


def encode_cursor(ended_at: datetime, room_id: str) -> str:
    """Opaque keyset cursor of the ended list: the sort key and the room id, nothing user-written."""
    return base64.urlsafe_b64encode(f"{as_utc(ended_at).isoformat()}|{room_id}".encode()).decode().rstrip("=")


def decode_cursor(raw: str) -> tuple[datetime, str]:
    try:
        text = base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)).decode()
        stamp, room_id = text.split("|", 1)
        at = datetime.fromisoformat(stamp)
    except (ValueError, UnicodeDecodeError) as e:  # binascii.Error is a ValueError
        raise ValueError("bad cursor") from e
    if at.tzinfo is None or not room_id or len(room_id) > 64:
        raise ValueError("bad cursor")
    return at, room_id


def _chunks(items: list):
    for i in range(0, len(items), IN_CHUNK):
        yield items[i:i + IN_CHUNK]


def _group(items: list[RoomReaction]) -> list[dict]:
    """Reactions of one message as [{key, user_ids}] in REACTION_KEYS order; only keys someone used."""
    by_key: dict[str, list[int]] = {}
    for r in items:
        users = by_key.setdefault(r.key, [])
        if r.user_id not in users:
            users.append(r.user_id)
    return [{"key": k, "user_ids": by_key[k]} for k in REACTION_KEYS if by_key.get(k)]


_ACTIVE = (RoomMember.left_at.is_(None), RoomMember.kicked.is_(False))


class RoomStore:
    def __init__(self, sessionmaker, limits: RoomLimits, code_gen=generate_code):
        self._sm = sessionmaker
        self.limits = limits
        self._code_gen = code_gen
        # Create and join check a count and then insert; one at a time keeps the caps exact (single worker, review #16).
        self._admission = asyncio.Lock()

    @property
    def admission(self) -> asyncio.Lock:
        """The admission lock, for writers outside the store (admin setting edits) that change a cap."""
        return self._admission

    async def _check_slots(self, s, owner_id: int, max_owned: int | None) -> None:
        """Site-wide and per-owner open-room caps; shared by create and reopen. Callers hold `_admission`."""
        if await s.scalar(select(func.count()).select_from(Room).where(Room.status == "open")) >= self.limits.max_active:
            raise RoomError("capacity")
        owned = await s.scalar(select(func.count()).select_from(Room).where(Room.status == "open",
                                                                            Room.owner_id == owner_id))
        if owned >= (self.limits.max_owned if max_owned is None else max_owned):
            raise RoomError("too_many")

    async def create(self, owner_id: int, topic: str, now: datetime, *, max_owned: int | None = None,
                     settings: dict | None = None) -> Room:
        """`max_owned` is the owner's own cap (admin per-user quota override); default: the site limit.
        `settings` is `rules.clean_settings` output; missing fields get the defaults (spec 2026-10-10 §3.1). The v1
        `topic` only seeds the name; the `topic` column is no longer written (R2-1)."""
        settings = settings or {}
        async with self._admission, self._sm() as s:
            await self._check_slots(s, owner_id, max_owned)
            name = settings.get("name") or clean_text(topic or "", NAME_MAX)
            if not name:
                owner = await s.scalar(select(display_name()).where(User.id == owner_id)) or ""
                name = f"{owner}的房间"[:NAME_MAX]
            level = settings.get("level")
            if level is None:
                level = default_level(await s.scalar(select(RankProfile.tier).where(RankProfile.user_id == owner_id)))
            for _ in range(CODE_ATTEMPTS):
                code = self._code_gen()
                if await s.scalar(select(Room.id).where(Room.code == code)):
                    continue
                room = Room(id=new_uuid(), code=code, last_code=code, owner_id=owner_id, topic="", status="open",
                            locked=False, ai_public=settings.get("ai_public", True), last_seq=0, created_at=now,
                            opened_at=now, last_active_at=now, name=name, scenario=settings.get("scenario", "free"), level=level,
                            join_mode=settings.get("join_mode", "code"),
                            max_members=settings.get("max_members", min(self.limits.default_max_members,
                                                                        self.limits.max_members)),
                            allow_voice=settings.get("allow_voice", True))
                s.add(room)
                s.add(RoomMember(room_id=room.id, user_id=owner_id, role="owner", joined_at=now, kicked=False))
                try:
                    await s.commit()
                    return room
                except IntegrityError:
                    await s.rollback()
            raise RoomError("capacity")

    async def _admit(self, s, room: Room, member: RoomMember | None, user_id: int, now: datetime) -> str:
        """Write the membership (no commit). Returns the role: an owner who left an empty room is inherited."""
        has_owner = await s.scalar(select(RoomMember.id).where(RoomMember.room_id == room.id,
                                                               RoomMember.role == "owner", *_ACTIVE))
        role = "member" if has_owner is not None else "owner"
        if member is None:
            s.add(RoomMember(room_id=room.id, user_id=user_id, role=role, joined_at=now, kicked=False))
        else:
            member.left_at, member.joined_at, member.role = None, now, role
        if role == "owner":
            room.owner_id = user_id
        room.last_active_at = now
        return role

    async def _seat_free(self, s, room: Room) -> bool:
        count = await s.scalar(select(func.count()).select_from(RoomMember).where(RoomMember.room_id == room.id,
                                                                                  *_ACTIVE))
        return count < min(room.max_members, self.limits.max_members)

    async def _member_row(self, s, room_id: str, user_id: int) -> RoomMember | None:
        return await s.scalar(select(RoomMember).where(RoomMember.room_id == room_id, RoomMember.user_id == user_id))

    async def join(self, code: str, user_id: int, now: datetime) -> tuple[Room, bool, RoomJoinRequest | None]:
        """(room, joined, request). An `approval` room answers a non-member with a pending join request instead
        (spec 2026-10-10 3.4): one pending request per user and room (the existing row comes back), a cooldown
        after a denial, at most `join_pending_per_room` pending per room. Kicked, locked and full come first."""
        async with self._admission, self._sm() as s:
            room = await s.scalar(select(Room).where(Room.code == code, Room.status == "open"))
            if room is None:
                raise RoomError("not_found")
            member = await self._member_row(s, room.id, user_id)
            if member is not None and member.kicked:
                raise RoomError("kicked")
            if member is not None and member.left_at is None:
                return room, False, None
            if room.locked:
                raise RoomError("locked")
            if not await self._seat_free(s, room):
                raise RoomError("full")
            has_owner = await s.scalar(select(RoomMember.id).where(RoomMember.room_id == room.id,
                                                                   RoomMember.role == "owner", *_ACTIVE))
            if room.join_mode == "approval" and has_owner is not None:  # nobody could approve an ownerless room
                return room, False, await self._request(s, room, user_id, now)
            await self._admit(s, room, member, user_id, now)
            await s.commit()
            return room, True, None

    async def _request(self, s, room: Room, user_id: int, now: datetime) -> RoomJoinRequest:
        pending = await s.scalar(select(RoomJoinRequest).where(
            RoomJoinRequest.room_id == room.id, RoomJoinRequest.user_id == user_id,
            RoomJoinRequest.status == "pending").order_by(RoomJoinRequest.created_at).limit(1))
        if pending is not None:
            return pending
        denied = await s.scalar(select(RoomJoinRequest.id).where(
            RoomJoinRequest.room_id == room.id, RoomJoinRequest.user_id == user_id,
            RoomJoinRequest.status == "denied",
            RoomJoinRequest.decided_at > now - timedelta(minutes=self.limits.join_deny_cooldown_minutes)).limit(1))
        if denied is not None:
            raise RoomError("cooldown")
        count = await s.scalar(select(func.count()).select_from(RoomJoinRequest).where(
            RoomJoinRequest.room_id == room.id, RoomJoinRequest.status == "pending"))
        if count >= self.limits.join_pending_per_room:
            raise RoomError("too_many_requests")
        request = RoomJoinRequest(id=new_uuid(), room_id=room.id, user_id=user_id, status="pending", created_at=now)
        s.add(request)
        await s.commit()
        return request

    async def decide_request(self, room_id: str, owner_id: int, request_id: str, approve: bool,
                             now: datetime) -> RoomJoinRequest:
        """The owner approves (writes the membership; locked, full and kicked refuse) or denies a pending request."""
        async with self._admission, self._sm() as s:
            room = await self._owned_room(s, room_id, owner_id)
            request = await s.scalar(select(RoomJoinRequest).where(
                RoomJoinRequest.id == request_id, RoomJoinRequest.room_id == room_id,
                RoomJoinRequest.status == "pending"))
            if request is None:
                raise RoomError("no_request")
            if approve:
                member = await self._member_row(s, room_id, request.user_id)
                if member is not None and member.kicked:
                    raise RoomError("kicked")
                if member is None or member.left_at is not None:
                    if room.locked:
                        raise RoomError("locked")
                    if not await self._seat_free(s, room):
                        raise RoomError("full")
                    await self._admit(s, room, member, request.user_id, now)
            request.status = "approved" if approve else "denied"
            request.decided_at, request.decided_by = now, owner_id
            await s.commit()
            return request

    async def cancel_request(self, request_id: str, user_id: int, now: datetime) -> RoomJoinRequest:
        """The requester withdraws; a request that is no longer pending comes back unchanged."""
        async with self._admission, self._sm() as s:
            request = await s.scalar(select(RoomJoinRequest).where(RoomJoinRequest.id == request_id,
                                                                   RoomJoinRequest.user_id == user_id))
            if request is None:
                raise RoomError("no_request")
            if request.status == "pending":
                request.status, request.decided_at = "cancelled", now
                await s.commit()
            return request

    # ---- invite links (spec 2026-10-10 §3.4, R2-4/R2-5): the token is a secret, never logged ----

    async def _new_token(self, room_id: str) -> str:
        for _ in range(INVITE_ATTEMPTS):
            token = secrets.token_urlsafe(16)
            async with self._sm() as s:
                room = await s.get(Room, room_id)
                room.invite_token = token
                try:
                    await s.commit()
                    return token
                except IntegrityError:
                    await s.rollback()
        raise RoomError("capacity")

    async def invite_token(self, room_id: str, user_id: int) -> str:
        """The room's link token, created on first use. Any member of a `code` room may share it; in an `approval`
        room only the owner (a member's link would bypass the owner)."""
        room, member = await self.membership(room_id, user_id)
        if room.status != "open":
            raise RoomError("not_found")
        if room.join_mode == "approval" and member.role != "owner":
            raise RoomError("forbidden")
        return room.invite_token or await self._new_token(room_id)

    async def rotate_invite(self, room_id: str, owner_id: int) -> str:
        async with self._sm() as s:
            await self._owned_room(s, room_id, owner_id)
        return await self._new_token(room_id)

    async def _invite_room(self, s, token: str) -> Room:
        room = await s.scalar(select(Room).where(Room.invite_token == token, Room.status == "open")) if token else None
        if room is None:
            raise RoomError("not_found")
        return room

    async def invite_preview(self, token: str, user_id: int) -> dict:
        """Room name, scenario, level and size only; never the member list (spec 2026-10-10 §13)."""
        async with self._sm() as s:
            room = await self._invite_room(s, token)
            count = await s.scalar(select(func.count()).select_from(RoomMember).where(RoomMember.room_id == room.id,
                                                                                      *_ACTIVE))
            joined = await s.scalar(select(RoomMember.id).where(RoomMember.room_id == room.id,
                                                                RoomMember.user_id == user_id, *_ACTIVE))
        return {"room_id": room.id, "name": room.name or room.topic, "scenario": room.scenario, "level": room.level,
                "member_count": int(count or 0), "max_members": room.max_members, "joined": joined is not None}

    async def join_by_invite(self, token: str, user_id: int, now: datetime) -> tuple[Room, bool]:
        """Like `join` without the approval step (R2-4: the link is the owner's consent). A pending request of the
        user in that room is settled as approved (the router reads `user_pending` first to tell the owner)."""
        async with self._admission, self._sm() as s:
            room = await self._invite_room(s, token)
            member = await self._member_row(s, room.id, user_id)
            if member is not None and member.kicked:
                raise RoomError("kicked")
            if member is not None and member.left_at is None:
                return room, False
            if room.locked:
                raise RoomError("locked")
            if not await self._seat_free(s, room):
                raise RoomError("full")
            await self._admit(s, room, member, user_id, now)
            for r in (await s.scalars(select(RoomJoinRequest).where(
                    RoomJoinRequest.room_id == room.id, RoomJoinRequest.user_id == user_id,
                    RoomJoinRequest.status == "pending"))).all():
                r.status, r.decided_at = "approved", now
            await s.commit()
            return room, True

    async def user_pending(self, room_id: str, user_id: int) -> list[str]:
        """Ids of the user's pending requests in the room (an invite join settles them)."""
        async with self._sm() as s:
            return list((await s.scalars(select(RoomJoinRequest.id).where(
                RoomJoinRequest.room_id == room_id, RoomJoinRequest.user_id == user_id,
                RoomJoinRequest.status == "pending"))).all())

    async def _requests_out(self, *conds) -> list[dict]:
        async with self._sm() as s:
            rows = (await s.execute(select(RoomJoinRequest, display_name(), User.avatar_id, Room.name, Room.topic)
                                    .join(User, User.id == RoomJoinRequest.user_id)
                                    .join(Room, Room.id == RoomJoinRequest.room_id)
                                    .where(*conds)
                                    .order_by(RoomJoinRequest.created_at, RoomJoinRequest.id))).all()
        return [request_out(r, n, rn or rt, a) for r, n, a, rn, rt in rows]

    async def request_view(self, request_id: str) -> dict | None:
        rows = await self._requests_out(RoomJoinRequest.id == request_id)
        return rows[0] if rows else None

    async def get_request(self, request_id: str, user_id: int) -> dict:
        """The requester's own request (polled by the lobby); anyone else gets `no_request`."""
        rows = await self._requests_out(RoomJoinRequest.id == request_id, RoomJoinRequest.user_id == user_id)
        if not rows:
            raise RoomError("no_request")
        return rows[0]

    async def list_requests(self, room_id: str, owner_id: int) -> list[dict]:
        async with self._sm() as s:
            await self._owned_room(s, room_id, owner_id)
        return await self.pending_requests(room_id)

    async def expire_requests(self, now: datetime) -> list[tuple[str, str]]:
        """Pending requests older than `join_request_minutes` become expired. Returns [(room_id, request_id)]."""
        cutoff = now - timedelta(minutes=self.limits.join_request_minutes)
        async with self._admission, self._sm() as s:
            rows = (await s.scalars(select(RoomJoinRequest).where(RoomJoinRequest.status == "pending",
                                                                  RoomJoinRequest.created_at <= cutoff)
                                    .order_by(RoomJoinRequest.created_at, RoomJoinRequest.id))).all()
            for r in rows:
                r.status, r.decided_at = "expired", now
            if rows:
                await s.commit()
            return [(r.room_id, r.id) for r in rows]

    async def approve_all(self, room_id: str, now: datetime) -> list[RoomJoinRequest]:
        """The room went back to `code`: pending requests are approved in request order while seats last and the
        rest expire (spec 2026-10-10 3.2). A locked room approves nobody. Returns every request it closed."""
        async with self._admission, self._sm() as s:
            room = await s.get(Room, room_id)
            if room is None:
                return []
            rows = (await s.scalars(select(RoomJoinRequest).where(RoomJoinRequest.room_id == room_id,
                                                                  RoomJoinRequest.status == "pending")
                                    .order_by(RoomJoinRequest.created_at, RoomJoinRequest.id))).all()
            for r in rows:
                member = await self._member_row(s, room_id, r.user_id)
                ok = room.status == "open" and not room.locked and not (member is not None and member.kicked)
                if ok and (member is None or member.left_at is not None):
                    ok = await self._seat_free(s, room)
                    if ok:
                        await self._admit(s, room, member, r.user_id, now)
                        await s.flush()  # the next seat count sees this member
                r.status, r.decided_at = ("approved" if ok else "expired"), now
            if rows:
                await s.commit()
            return list(rows)

    async def membership(self, room_id: str, user_id: int) -> tuple[Room, RoomMember]:
        """Active membership (not left, not kicked) in an open or closed room."""
        async with self._sm() as s:
            row = (await s.execute(select(Room, RoomMember).join(RoomMember, RoomMember.room_id == Room.id).where(
                Room.id == room_id, RoomMember.user_id == user_id, *_ACTIVE))).first()
            if row is None:
                raise RoomError("not_found")
            return row[0], row[1]

    async def room(self, room_id: str) -> Room | None:
        async with self._sm() as s:
            return await s.get(Room, room_id)

    async def display_name(self, user_id: int) -> str:
        async with self._sm() as s:
            return await s.scalar(select(display_name()).where(User.id == user_id)) or ""

    async def user_level(self, user_id: int) -> str | None:
        async with self._sm() as s:
            tier = await s.scalar(select(RankProfile.tier).where(RankProfile.user_id == user_id))
        if tier is None or not 0 <= tier < len(CEFR_BY_TIER):
            return None
        return CEFR_BY_TIER[tier]

    async def members(self, room_id: str) -> list[MemberView]:
        async with self._sm() as s:
            rows = (await s.execute(select(RoomMember.user_id, display_name(), RoomMember.role, User.avatar_id)
                                    .join(User, User.id == RoomMember.user_id)
                                    .where(RoomMember.room_id == room_id, *_ACTIVE)
                                    .order_by(RoomMember.joined_at, RoomMember.id))).all()
        return [MemberView(u, n, r, a) for u, n, r, a in rows]

    async def member_count(self, room_id: str) -> int:
        async with self._sm() as s:
            return int(await s.scalar(select(func.count()).select_from(RoomMember).where(
                RoomMember.room_id == room_id, *_ACTIVE)) or 0)

    async def leave(self, room_id: str, user_id: int, now: datetime) -> int | None:
        async with self._sm() as s:
            member = await s.scalar(select(RoomMember).where(RoomMember.room_id == room_id,
                                                             RoomMember.user_id == user_id, *_ACTIVE))
            if member is None:
                raise RoomError("not_found")
            member.left_at = now
            new_owner = None
            if member.role == "owner":
                member.role = "member"
                heir = await s.scalar(select(RoomMember).where(RoomMember.room_id == room_id,
                                                               RoomMember.user_id != user_id, *_ACTIVE)
                                      .order_by(RoomMember.joined_at, RoomMember.id).limit(1))
                if heir is not None:
                    heir.role = "owner"
                    (await s.get(Room, room_id)).owner_id = heir.user_id
                    new_owner = heir.user_id
            await s.commit()
            return new_owner

    async def _owned_room(self, s, room_id: str, owner_id: int, *, closed: bool = False) -> Room:
        room = await s.get(Room, room_id)
        if room is None or (room.status != "open" and not closed):
            raise RoomError("not_found")
        if room.owner_id != owner_id:
            raise RoomError("forbidden")
        owner = await s.scalar(select(RoomMember.id).where(  # an owner who left keeps owner_id but no powers
            RoomMember.room_id == room_id, RoomMember.user_id == owner_id, RoomMember.role == "owner", *_ACTIVE))
        if owner is None:
            raise RoomError("forbidden")
        return room

    async def kick(self, room_id: str, owner_id: int, target_id: int, now: datetime) -> None:
        async with self._sm() as s:
            await self._owned_room(s, room_id, owner_id)
            if target_id == owner_id:
                raise RoomError("forbidden")
            member = await s.scalar(select(RoomMember).where(RoomMember.room_id == room_id,
                                                             RoomMember.user_id == target_id, *_ACTIVE))
            if member is None:
                raise RoomError("not_found")
            member.kicked, member.left_at = True, now
            await s.commit()

    async def admin_kick(self, room_id: str, user_id: int, now: datetime) -> None:
        """Admin removal: no owner check, works on the owner too (ownership passes to the earliest member) and on
        someone who already left (so they cannot rejoin with the code)."""
        async with self._sm() as s:
            room = await s.get(Room, room_id)
            if room is None:
                raise RoomError("not_found")
            member = await s.scalar(select(RoomMember).where(RoomMember.room_id == room_id,
                                                             RoomMember.user_id == user_id))
            if member is None:
                raise RoomError("not_found")
            if member.kicked:
                return
            member.kicked, member.left_at = True, member.left_at or now
            if member.role == "owner":
                member.role = "member"
                heir = await s.scalar(select(RoomMember).where(RoomMember.room_id == room_id,
                                                               RoomMember.user_id != user_id, *_ACTIVE)
                                      .order_by(RoomMember.joined_at, RoomMember.id).limit(1))
                if heir is not None:
                    heir.role = "owner"
                    room.owner_id = heir.user_id
            await s.commit()

    async def hide(self, room_id: str, message_id: str, now: datetime) -> int:
        """Admin hide: sets `hidden_at` and keeps the row (R-6: room messages are never deleted). Returns the seq."""
        async with self._sm() as s:
            msg = await s.scalar(select(RoomMessage).where(RoomMessage.id == message_id,
                                                           RoomMessage.room_id == room_id))
            if msg is None or msg.kind == "system":
                raise RoomError("not_found")
            if msg.hidden_at is None:
                msg.hidden_at = now
                # Quote snapshots of the hidden message lose their text in the same commit (spec 2026-10-10 §6.4).
                quoting = (await s.scalars(select(RoomMessage).where(
                    RoomMessage.room_id == room_id, RoomMessage.reply_to == msg.seq,
                    RoomMessage.kind.in_(("text", "voice"))))).all()
                for q in quoting:
                    quote = q.meta.get("quote") if isinstance(q.meta, dict) else None
                    if isinstance(quote, dict) and quote.get("seq") == msg.seq:
                        q.meta = {**q.meta, "quote": {**quote, "text": ""}}
                await s.commit()
            return msg.seq

    async def set_ai_muted(self, room_id: str, muted: bool) -> Room:
        async with self._sm() as s:
            room = await s.get(Room, room_id)
            if room is None:
                raise RoomError("not_found")
            room.ai_muted = muted
            await s.commit()
            return room

    async def update(self, room_id: str, owner_id: int, *, topic: str | None = None, locked: bool | None = None,
                     ai_public: bool | None = None) -> Room:
        async with self._sm() as s:
            room = await self._owned_room(s, room_id, owner_id)
            if topic is not None:
                room.topic = clean_text(topic, MAX_TOPIC) or ""
            if locked is not None:
                room.locked = locked
            if ai_public is not None:
                room.ai_public = ai_public
            await s.commit()
            return room

    async def update_settings(self, room_id: str, owner_id: int, changes: dict) -> tuple[Room, list[dict]]:
        """Owner edit of the seven settings (`clean_settings(partial=True)` output). Returns the room and the fields
        that really changed as [{field, value}] in SETTING_FIELDS order. `max_members` below the current member
        count -> `below_members` (spec 2026-10-10 §3.2). Under the admission lock so a concurrent join cannot
        slip past a lowered cap."""
        async with self._admission, self._sm() as s:
            room = await self._owned_room(s, room_id, owner_id)
            changed: list[dict] = []
            for field in SETTING_FIELDS:
                if field not in changes or getattr(room, field) == changes[field]:
                    continue
                if field == "max_members":
                    count = await s.scalar(select(func.count()).select_from(RoomMember).where(
                        RoomMember.room_id == room_id, *_ACTIVE))
                    if changes[field] < count:
                        raise RoomError("below_members")
                changed.append({"field": field, "value": changes[field]})
            for c in changed:
                setattr(room, c["field"], c["value"])
            if any(c["field"] == "join_mode" and c["value"] == "approval" for c in changed):
                room.invite_token = None  # a member's link from the `code` days must not bypass approval (R2-4)
            if changed:
                await s.commit()
            return room, changed

    async def close(self, room_id: str, reason: str, now: datetime) -> Room | None:
        async with self._sm() as s:
            room = await s.get(Room, room_id)
            if room is None or room.status != "open":
                return None
            room.status, room.code, room.closed_at, room.close_reason = "closed", None, now, reason
            await s.commit()
            return room

    async def close_by_owner(self, room_id: str, owner_id: int, now: datetime) -> Room:
        async with self._sm() as s:
            await self._owned_room(s, room_id, owner_id)
        room = await self.close(room_id, "owner", now)
        if room is None:  # closed concurrently (sweeper)
            raise RoomError("not_found")
        return room

    async def reopen(self, room_id: str, user_id: int | None, now: datetime, *, max_owned: int | None = None,
                     admin: bool = False) -> Room:
        """closed -> open (spec 2026-10-12 part 2). Owner path: the caller must be the room's active owner and the
        room must not have been closed by an operator; admin path (`user_id=None`): needs an owner_id. Both obey the
        site and per-owner caps (R-O7). Members are untouched, the invite link is dropped, a fresh code is drawn.
        Runs under the admission lock, so two parallel requests count once (the loser gets `not_closed`, R-O6)."""
        async with self._admission, self._sm() as s:
            if admin:
                room = await s.get(Room, room_id)
                if room is None:
                    raise RoomError("not_found")
                if room.owner_id is None:
                    raise RoomError("no_owner")
                if await s.scalar(select(RoomMember.id).where(  # owner left, or the room was retention-purged (members gone)
                        RoomMember.room_id == room_id, RoomMember.user_id == room.owner_id,
                        RoomMember.role == "owner", *_ACTIVE)) is None:
                    raise RoomError("owner_gone")
            else:
                room = await self._owned_room(s, room_id, user_id, closed=True)
            if room.status != "closed":
                raise RoomError("not_closed")
            if room.close_reason in REOPEN_ADMIN_ONLY and not admin:
                raise RoomError("admin_closed")
            await self._check_slots(s, room.owner_id, max_owned)
            for _ in range(CODE_ATTEMPTS):
                code = self._code_gen()
                if await s.scalar(select(Room.id).where(Room.code == code)):
                    continue
                room.status, room.code, room.last_code = "open", code, code
                room.closed_at = room.close_reason = None
                room.opened_at = room.last_active_at = now
                room.reopen_count = (room.reopen_count or 0) + 1
                room.invite_token = None
                try:
                    await s.commit()
                    return room
                except IntegrityError:  # the same code was taken between the check and the commit
                    await s.rollback()
                    room = await s.get(Room, room_id, populate_existing=True)
                    if room is None or room.status != "closed":
                        raise RoomError("not_closed") from None
            raise RoomError("capacity")

    async def append(self, room_id: str, *, lane: str, sender_kind: str, sender_id: int | None, kind: str, text: str,
                     now: datetime, audience_id: int | None = None, assisted: bool = False, reply_to: int | None = None,
                     ai_status: str | None = None, client_id: str | None = None, meta: dict | None = None) -> RoomMessage:
        async with self._sm() as s:
            room = await s.get(Room, room_id)
            room.last_seq += 1
            if lane == "public":
                room.last_active_at = now
            msg = RoomMessage(id=new_uuid(), room_id=room_id, seq=room.last_seq, lane=lane, audience_id=audience_id,
                              sender_kind=sender_kind, sender_id=sender_id, kind=kind, text=text, assisted=assisted,
                              reply_to=reply_to, ai_status=ai_status, client_id=client_id, meta=meta, created_at=now)
            s.add(msg)
            await s.commit()
            return msg

    async def find_client(self, room_id: str, sender_id: int, client_id: str, since: datetime) -> RoomMessage | None:
        async with self._sm() as s:
            return await s.scalar(select(RoomMessage).where(
                RoomMessage.room_id == room_id, RoomMessage.sender_id == sender_id, RoomMessage.client_id == client_id,
                RoomMessage.lane == "public", RoomMessage.created_at >= since).limit(1))

    async def set_ai_status(self, message_id: str, status: str) -> None:
        async with self._sm() as s:
            await s.execute(update(RoomMessage).where(RoomMessage.id == message_id).values(ai_status=status))
            await s.commit()

    async def get_assist(self, message_id: str, user_id: int, room_id: str) -> RoomMessage | None:
        async with self._sm() as s:
            return await s.scalar(select(RoomMessage).where(
                RoomMessage.id == message_id, RoomMessage.room_id == room_id, RoomMessage.lane == "private",
                RoomMessage.audience_id == user_id, RoomMessage.kind == "assist_reply"))

    async def claim_assist(self, message_id: str, user_id: int, room_id: str) -> bool:
        """Mark the user's assist reply as used by one public send (review #9). Callers hold the room lock."""
        async with self._sm() as s:
            reply = await s.scalar(select(RoomMessage).where(
                RoomMessage.id == message_id, RoomMessage.room_id == room_id, RoomMessage.lane == "private",
                RoomMessage.audience_id == user_id, RoomMessage.kind == "assist_reply"))
            meta = reply.meta if reply is not None and isinstance(reply.meta, dict) else None
            if meta is None or meta.get("used"):
                return False
            reply.meta = {**meta, "used": True}
            await s.commit()
            return True

    def _visible(self, room_id: str, user_id: int):
        return (RoomMessage.room_id == room_id,
                or_(RoomMessage.lane == "public", RoomMessage.audience_id == user_id))

    async def _named(self, stmt) -> list[tuple[RoomMessage, str | None]]:
        """(message, sender's display name). The sender's avatar id rides on the instance (`sender_avatar_id`, not a
        column) so the pair shape the callers use stays as it was (plan S8)."""
        async with self._sm() as s:
            out = []
            for m, n, avatar in (await s.execute(stmt)).all():
                m.sender_avatar_id = avatar
                out.append((m, n))
            return out

    def _select(self):
        return select(RoomMessage, display_name(), User.avatar_id).outerjoin(User, User.id == RoomMessage.sender_id)

    async def replay(self, room_id: str, user_id: int, after_seq: int, limit: int):
        rows = await self._named(self._select().where(*self._visible(room_id, user_id), RoomMessage.seq > after_seq)
                                 .order_by(RoomMessage.seq.desc()).limit(limit + 1))
        truncated = len(rows) > limit
        return list(reversed(rows[:limit])), truncated

    async def history(self, room_id: str, user_id: int, before_seq: int, limit: int):
        rows = await self._named(self._select().where(*self._visible(room_id, user_id), RoomMessage.seq < before_seq)
                                 .order_by(RoomMessage.seq.desc()).limit(limit))
        return list(reversed(rows))

    async def recent_public(self, room_id: str, limit: int) -> list[tuple[str, str]]:
        """AI context: visible member text, @ai answers and transcribed voice (prefixed "(voice) ")."""
        rows = await self._named(self._select().where(RoomMessage.room_id == room_id, RoomMessage.lane == "public",
                                                      RoomMessage.kind.in_(QUOTABLE), RoomMessage.text != "",
                                                      RoomMessage.hidden_at.is_(None))
                                 .order_by(RoomMessage.seq.desc()).limit(limit))
        return [(_ai_name(m, n), f"(voice) {m.text}" if m.kind == "voice" else m.text) for m, n in reversed(rows)]

    async def quote_for(self, room_id: str, seq: int) -> dict | None:
        """Snapshot for `meta.quote` of a reply: public, not hidden, member text / voice / @ai answer only.
        A voice message quotes its transcript ("" until there is one)."""
        async with self._sm() as s:
            row = (await s.execute(self._select().where(
                RoomMessage.room_id == room_id, RoomMessage.seq == seq, RoomMessage.lane == "public",
                RoomMessage.hidden_at.is_(None), RoomMessage.kind.in_(QUOTABLE)))).first()
            if row is None:
                return None
            m, name = row[0], row[1]
            text = m.text or ""
            if m.kind == "voice":
                text = await s.scalar(select(RoomVoice.transcript).where(RoomVoice.message_id == m.id)) or ""
        return {"seq": m.seq, "name": _ai_name(m, name), "kind": m.kind, "text": text[:QUOTE_MAX]}

    async def toggle_reaction(self, room_id: str, seq: int, user_id: int, key: str, on: bool,
                              now: datetime) -> list[int] | None:
        """Set or clear one user's reaction; returns the key's full user list (idempotent). None when the seq is
        not a public, visible text / voice / @ai answer of this room."""
        async with self._sm() as s:
            message_id = await s.scalar(select(RoomMessage.id).where(
                RoomMessage.room_id == room_id, RoomMessage.seq == seq, RoomMessage.lane == "public",
                RoomMessage.hidden_at.is_(None), RoomMessage.kind.in_(QUOTABLE)))
            if message_id is None:
                return None
            mine = (RoomReaction.message_id == message_id, RoomReaction.user_id == user_id, RoomReaction.key == key)
            if on and await s.scalar(select(RoomReaction.id).where(*mine)) is None:
                s.add(RoomReaction(room_id=room_id, message_id=message_id, seq=seq, user_id=user_id, key=key,
                                   created_at=now))
            elif not on:
                await s.execute(delete(RoomReaction).where(*mine))
            try:
                await s.commit()
            except IntegrityError:  # the same toggle raced in from another socket
                await s.rollback()
            return list((await s.scalars(select(RoomReaction.user_id).where(
                RoomReaction.message_id == message_id, RoomReaction.key == key)
                .order_by(RoomReaction.created_at, RoomReaction.id))).all())

    async def _attach(self, rows: list[tuple[RoomMessage, str | None]]) -> list[dict]:
        """v2 member view of `rows`: voice rows and reactions loaded in batches (public lane only)."""
        ids = [m.id for m, _ in rows if m.lane == "public"]
        voices: dict[str, RoomVoice] = {}
        reactions: dict[str, list[RoomReaction]] = {}
        if ids:
            async with self._sm() as s:
                for chunk in _chunks(ids):
                    voices.update({v.message_id: v for v in (await s.scalars(
                        select(RoomVoice).where(RoomVoice.message_id.in_(chunk)))).all()})
                    for r in (await s.scalars(select(RoomReaction).where(RoomReaction.message_id.in_(chunk))
                                              .order_by(RoomReaction.created_at, RoomReaction.id))).all():
                        reactions.setdefault(r.message_id, []).append(r)
        return [message_out(m, n, voice=voices.get(m.id), reactions=_group(reactions.get(m.id, [])),
                            avatar_id=sender_avatar(m)) for m, n in rows]

    async def replay_out(self, room_id: str, user_id: int, after_seq: int, limit: int) -> tuple[list[dict], bool]:
        rows, truncated = await self.replay(room_id, user_id, after_seq, limit)
        return await self._attach(rows), truncated

    async def history_out(self, room_id: str, user_id: int, before_seq: int, limit: int) -> list[dict]:
        return await self._attach(await self.history(room_id, user_id, before_seq, limit))

    async def out_one(self, message_id: str) -> dict | None:
        """One message in the v2 member view (for broadcasts). Private-lane rows come out without attachments."""
        rows = await self._named(self._select().where(RoomMessage.id == message_id))
        return (await self._attach(rows))[0] if rows else None

    async def recent_reactions(self, room_id: str, messages: int = 200) -> list[dict]:
        """All reactions on the room's last `messages` seqs as [{seq, key, user_ids}] (welcome refresh)."""
        async with self._sm() as s:
            floor = (await s.scalar(select(Room.last_seq).where(Room.id == room_id)) or 0) - messages
            rows = (await s.scalars(select(RoomReaction)
                                    .join(RoomMessage, RoomMessage.id == RoomReaction.message_id)
                                    .where(RoomReaction.room_id == room_id, RoomReaction.seq > floor,
                                           RoomMessage.hidden_at.is_(None))  # like message_out (review m4)
                                    .order_by(RoomReaction.seq, RoomReaction.created_at, RoomReaction.id))).all()
        by_seq: dict[int, list[RoomReaction]] = {}
        for r in rows:
            by_seq.setdefault(r.seq, []).append(r)
        return [{"seq": seq, **g} for seq, items in by_seq.items() for g in _group(items)]

    async def pending_requests(self, room_id: str) -> list[dict]:
        return await self._requests_out(RoomJoinRequest.room_id == room_id, RoomJoinRequest.status == "pending")

    async def assist_history(self, room_id: str, user_id: int, limit: int):
        rows = await self._named(self._select().where(RoomMessage.room_id == room_id, RoomMessage.lane == "private",
                                                      RoomMessage.audience_id == user_id,
                                                      RoomMessage.kind.in_(("assist_request", "assist_reply")))
                                 .order_by(RoomMessage.seq.desc()).limit(limit))
        return list(reversed(rows))

    async def mine(self, user_id: int, now: datetime) -> list[tuple[Room, str]]:
        """Open rooms only (spec 2026-10-12 §2.2); ended rooms are in `ended`. `now` is kept for callers."""
        async with self._sm() as s:
            rows = (await s.execute(select(Room, RoomMember.role).join(RoomMember, RoomMember.room_id == Room.id).where(
                RoomMember.user_id == user_id, *_ACTIVE, Room.status == "open")
                .order_by(Room.last_active_at.desc(), Room.id))).all()
        return [(r, role) for r, role in rows]

    async def ended_count(self, user_id: int) -> int:
        async with self._sm() as s:
            return int(await s.scalar(select(func.count()).select_from(Room).join(
                RoomMember, RoomMember.room_id == Room.id).where(RoomMember.user_id == user_id, *_ACTIVE,
                                                                 Room.status == "closed")) or 0)

    async def ended(self, user_id: int, after: tuple[datetime, str] | None, limit: int):
        """The user's ended rooms (active member, any age), newest end first, keyset-paged on
        (coalesce(closed_at, last_active_at), id). Returns (rows, next cursor key or None)."""
        ended_at = func.coalesce(Room.closed_at, Room.last_active_at)
        stmt = (select(Room, RoomMember.role, ended_at).join(RoomMember, RoomMember.room_id == Room.id)
                .where(RoomMember.user_id == user_id, *_ACTIVE, Room.status == "closed"))
        if after is not None:
            at, room_id = after
            stmt = stmt.where(or_(ended_at < at, and_(ended_at == at, Room.id < room_id)))
        async with self._sm() as s:
            rows = (await s.execute(stmt.order_by(ended_at.desc(), Room.id.desc()).limit(limit + 1))).all()
        more = len(rows) > limit
        rows = rows[:limit]
        nxt = (as_utc(rows[-1][2]), rows[-1][0].id) if more and rows else None
        return [(r, role) for r, role, _ in rows], nxt

    async def summary_statuses(self, room_ids: list[str]) -> dict[str, str]:
        """{room_id: learning-summary status} for rooms that have a summary row (spec 2026-10-10 §6.1)."""
        if not room_ids:
            return {}
        async with self._sm() as s:
            rows = (await s.execute(select(RoomSummary.room_id, RoomSummary.status)
                                    .where(RoomSummary.room_id.in_(room_ids)))).all()
        return {room_id: status for room_id, status in rows}

    async def _sweep_candidates(self, now: datetime, online: set[str]) -> list[tuple[str, str, int, datetime | None]]:
        """(id, reason, reopen_count, opened_at) of the open rooms that are idle or past their age limit."""
        found = []
        async with self._sm() as s:
            for room in (await s.scalars(select(Room).where(Room.status == "open"))).all():
                reason = None
                if opened_anchor(room) <= now - timedelta(hours=self.limits.max_hours):
                    reason = "expired"
                elif room.id not in online and as_utc(room.last_active_at) <= now - timedelta(minutes=self.limits.idle_minutes):
                    reason = "idle"
                if reason:
                    found.append((room.id, reason, room.reopen_count or 0, room.opened_at))
        return found

    async def sweep(self, now: datetime, online: set[str]) -> list[tuple[str, str]]:
        """Close idle/expired rooms. Never deletes messages (that is `purge`, off by default). Each close is a
        conditional UPDATE on the same life (status open, same reopen_count / opened_at), so a room closed and
        reopened between the read and the write is left open; only rooms actually closed are reported."""
        closed: list[tuple[str, str]] = []
        for room_id, reason, count, opened_at in await self._sweep_candidates(now, online):
            same_life = (Room.opened_at.is_(None) if opened_at is None else Room.opened_at == opened_at)
            async with self._sm() as s:
                result = await s.execute(
                    update(Room).where(Room.id == room_id, Room.status == "open", func.coalesce(Room.reopen_count, 0) == count,
                                       same_life)
                    .values(status="closed", code=None, closed_at=now, close_reason=reason))
                await s.commit()
            if result.rowcount == 1:
                closed.append((room_id, reason))
        return closed

    async def purge(self, now: datetime) -> int:
        if self.limits.retention_days <= 0:  # default: keep forever
            return 0
        cutoff = now - timedelta(days=self.limits.retention_days)
        async with self._sm() as s:
            ids = list((await s.scalars(select(Room.id).where(Room.status == "closed", Room.closed_at <= cutoff))).all())
            if not ids:
                return 0
            # v2 rows first (FKs are not enforced on SQLite). Audio files are not touched here: the admin
            # room_audio tool's orphan scan removes them (spec 2026-10-10 §12).
            for model in (RoomVoice, RoomReaction, RoomJoinRequest, RoomSummary):
                await s.execute(delete(model).where(model.room_id.in_(ids)))
            result = await s.execute(delete(RoomMessage).where(RoomMessage.room_id.in_(ids)))
            await s.execute(delete(RoomMember).where(RoomMember.room_id.in_(ids)))
            await s.execute(delete(RoomReport).where(RoomReport.room_id.in_(ids)))
            await s.execute(update(Room).where(Room.id.in_(ids)).values(topic="", name="", invite_token=None))
            await s.commit()
            return result.rowcount or 0

    # ---- agents in rooms (plan 2026-10-12-agents-rooms) ----

    async def set_agents(self, room_id: str, owner_id: int, persona_ids: list[str]) -> tuple[Room, bool]:
        """Owner picks (already validated) persona ids; `chosen_by` = this owner (R-RA3). [] clears. A running room
        tutor blocks changes (`tutor_active`)."""
        async with self._sm() as s:
            room = await self._owned_room(s, room_id, owner_id)
            current = list((room.agent_config or {}).get("persona_ids") or []) if isinstance(room.agent_config, dict) else []
            if current == list(persona_ids):
                return room, False
            if isinstance(room.agent_tutor, dict):
                raise RoomError("tutor_active")
            room.agent_config = {"persona_ids": list(persona_ids), "chosen_by": owner_id} if persona_ids else None
            await s.commit()
            return room, True

    async def set_tutor(self, room_id: str, snapshot: dict | None) -> None:
        """The room tutor snapshot (agent_tutor.py); None = no tutor (SQL NULL)."""
        async with self._sm() as s:
            room = await s.get(Room, room_id)
            if room is not None:
                room.agent_tutor = dict(snapshot) if snapshot is not None else None
                await s.commit()

    async def tutor_rooms(self) -> list[tuple[str, dict]]:
        """Open rooms that have a tutor snapshot (startup: pause them, R-RA8)."""
        async with self._sm() as s:
            rows = (await s.execute(select(Room.id, Room.agent_tutor).where(
                Room.status == "open", Room.agent_tutor.is_not(None)))).all()
        return [(room_id, snap) for room_id, snap in rows if isinstance(snap, dict)]

    async def agent_context(self, room_id: str, limit: int, *, before_seq: int) -> list[tuple[str, str, str | None]]:
        """Recent public text before `before_seq` for an agent turn: (speaker, text, persona id of an agent answer)."""
        rows = await self._named(self._select().where(RoomMessage.room_id == room_id, RoomMessage.lane == "public",
                                                      RoomMessage.kind.in_(QUOTABLE), RoomMessage.text != "",
                                                      RoomMessage.hidden_at.is_(None), RoomMessage.seq < before_seq)
                                 .order_by(RoomMessage.seq.desc()).limit(limit))
        out: list[tuple[str, str, str | None]] = []
        for m, n in reversed(rows):
            agent = _agent_meta(m)
            out.append((_ai_name(m, n), f"(voice) {m.text}" if m.kind == "voice" else m.text,
                        agent.get("persona_id") if agent else None))
        return out

    async def agent_of(self, room_id: str, seq: int) -> str | None:
        """Persona id of the public, visible agent answer at `seq` (the reply rule, spec addressing §3.2); None for
        everything else: members' messages, old `@ai` answers (no `meta.agent`), hidden or private rows, other rooms."""
        async with self._sm() as s:
            row = await s.scalar(select(RoomMessage).where(
                RoomMessage.room_id == room_id, RoomMessage.seq == seq, RoomMessage.lane == "public",
                RoomMessage.kind == "ai_answer", RoomMessage.hidden_at.is_(None)))
        agent = _agent_meta(row) if row is not None else None
        persona_id = agent.get("persona_id") if agent else None
        return persona_id if isinstance(persona_id, str) else None

    async def message_named(self, message_id: str) -> tuple[RoomMessage, str | None] | None:
        """One message with its sender's name (None for AI / system rows); the voice hook re-reads the stored row so
        the transcript never travels through arguments (addressing R-AS20)."""
        rows = await self._named(self._select().where(RoomMessage.id == message_id))
        return rows[0] if rows else None

    async def fail_pending_ai(self) -> int:
        async with self._sm() as s:
            result = await s.execute(update(RoomMessage).where(RoomMessage.ai_status == "pending")
                                     .values(ai_status="failed"))
            await s.commit()
            return result.rowcount or 0

    async def report(self, room_id: str, message_id: str, reporter_id: int, reason: str, now: datetime) -> None:
        if reason not in REPORT_REASONS:
            raise RoomError("bad_reason")
        async with self._sm() as s:
            exists = await s.scalar(select(RoomMessage.id).where(
                RoomMessage.id == message_id, RoomMessage.room_id == room_id, RoomMessage.lane == "public"))
            if exists is None:
                raise RoomError("not_found")
            s.add(RoomReport(room_id=room_id, message_id=message_id, reporter_id=reporter_id, reason=reason,
                             created_at=now))
            try:
                await s.commit()
            except IntegrityError:
                await s.rollback()
