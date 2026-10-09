"""All DB access for rooms (spec 2026-10-09 §5, §6). Callers hold `RoomHub.lock(room_id)` around `append`
so the per-room `seq` stays gapless in the single worker. Never logs message text.

Retention: room messages are kept forever by default (`RoomLimits.retention_days == 0`); closed rooms stay
readable as history for their members. `purge` only deletes when ROOM_MESSAGE_RETENTION_DAYS > 0."""
import asyncio
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError

from app.models import (
    RankProfile, Room, RoomJoinRequest, RoomMember, RoomMessage, RoomReaction, RoomReport, RoomSummary, RoomVoice, User,
    iso_utc, new_uuid,
)
from app.rooms.codes import generate_code
from app.rooms.protocol import REACTION_KEYS
from app.rooms.rules import CEFR_BY_TIER, MAX_TOPIC, RoomLimits, clean_text
from app.services.stats import as_utc

CODE_ATTEMPTS = 5
REPORT_REASONS = ("spam", "abuse", "other")
AI_NAME = "AI 助手"
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


def voice_out(v: RoomVoice) -> dict:
    """The shared voice state of one message (spec 2026-10-10 §9). `audio` is False once an admin purged the file."""
    return {"duration_ms": v.duration_ms, "status": v.status, "transcript": v.transcript, "lang": v.lang,
            "translation": v.translation, "translation_status": v.translation_status, "attempts": v.attempts,
            "audio": v.audio_path is not None}


def message_out(m: RoomMessage, name: str | None, *, voice: RoomVoice | None = None,
                reactions: list[dict] | None = None) -> dict:
    """Member view (protocol v2 shape). A message hidden by an admin keeps its row (R-6) but its text, meta, quote,
    voice and reactions are withheld. `quote` is a promoted copy of `meta.quote`. Callers that need the voice and
    reaction attachments use `RoomStore.replay_out / history_out / out_one` (plan P2-2)."""
    hidden = m.hidden_at is not None
    quote = m.meta.get("quote") if isinstance(m.meta, dict) else None
    return {"seq": m.seq, "id": m.id, "lane": m.lane, "kind": m.kind,
            "sender": {"kind": m.sender_kind, "id": m.sender_id, "name": name},
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
            "max_members": room.max_members, "allow_voice": room.allow_voice}


def request_out(r: RoomJoinRequest, name: str, room_name: str) -> dict:
    return {"id": r.id, "room_id": r.room_id, "room_name": room_name, "user_id": r.user_id, "name": name,
            "status": r.status, "created_at": iso_utc(r.created_at)}


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

    async def create(self, owner_id: int, topic: str, now: datetime, *, max_owned: int | None = None) -> Room:
        """`max_owned` is the owner's own cap (admin per-user quota override); default: the site limit."""
        async with self._admission, self._sm() as s:
            if await s.scalar(select(func.count()).select_from(Room).where(Room.status == "open")) >= self.limits.max_active:
                raise RoomError("capacity")
            owned = await s.scalar(select(func.count()).select_from(Room).where(Room.status == "open",
                                                                                Room.owner_id == owner_id))
            if owned >= (self.limits.max_owned if max_owned is None else max_owned):
                raise RoomError("too_many")
            for _ in range(CODE_ATTEMPTS):
                code = self._code_gen()
                if await s.scalar(select(Room.id).where(Room.code == code)):
                    continue
                room = Room(id=new_uuid(), code=code, last_code=code, owner_id=owner_id,
                            topic=clean_text(topic or "", MAX_TOPIC) or "", status="open", locked=False,
                            ai_public=True, last_seq=0, created_at=now, last_active_at=now)
                s.add(room)
                s.add(RoomMember(room_id=room.id, user_id=owner_id, role="owner", joined_at=now, kicked=False))
                try:
                    await s.commit()
                    return room
                except IntegrityError:
                    await s.rollback()
            raise RoomError("capacity")

    async def join(self, code: str, user_id: int, now: datetime) -> tuple[Room, bool]:
        async with self._admission, self._sm() as s:
            room = await s.scalar(select(Room).where(Room.code == code, Room.status == "open"))
            if room is None:
                raise RoomError("not_found")
            member = await s.scalar(select(RoomMember).where(RoomMember.room_id == room.id,
                                                             RoomMember.user_id == user_id))
            if member is not None and member.kicked:
                raise RoomError("kicked")
            if member is not None and member.left_at is None:
                return room, False
            if room.locked:
                raise RoomError("locked")
            count = await s.scalar(select(func.count()).select_from(RoomMember).where(RoomMember.room_id == room.id,
                                                                                      *_ACTIVE))
            if count >= self.limits.max_members:
                raise RoomError("full")
            has_owner = await s.scalar(select(RoomMember.id).where(RoomMember.room_id == room.id,
                                                                   RoomMember.role == "owner", *_ACTIVE))
            role = "member" if has_owner is not None else "owner"  # the owner left an empty room: inherit it
            if member is None:
                s.add(RoomMember(room_id=room.id, user_id=user_id, role=role, joined_at=now, kicked=False))
            else:
                member.left_at, member.joined_at, member.role = None, now, role
            if role == "owner":
                room.owner_id = user_id
            room.last_active_at = now
            await s.commit()
            return room, True

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

    async def username(self, user_id: int) -> str:
        async with self._sm() as s:
            return await s.scalar(select(User.username).where(User.id == user_id)) or ""

    async def user_level(self, user_id: int) -> str | None:
        async with self._sm() as s:
            tier = await s.scalar(select(RankProfile.tier).where(RankProfile.user_id == user_id))
        if tier is None or not 0 <= tier < len(CEFR_BY_TIER):
            return None
        return CEFR_BY_TIER[tier]

    async def members(self, room_id: str) -> list[MemberView]:
        async with self._sm() as s:
            rows = (await s.execute(select(RoomMember.user_id, User.username, RoomMember.role)
                                    .join(User, User.id == RoomMember.user_id)
                                    .where(RoomMember.room_id == room_id, *_ACTIVE)
                                    .order_by(RoomMember.joined_at, RoomMember.id))).all()
        return [MemberView(u, n, r) for u, n, r in rows]

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

    async def _owned_room(self, s, room_id: str, owner_id: int) -> Room:
        room = await s.get(Room, room_id)
        if room is None or room.status != "open":
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
        async with self._sm() as s:
            return [(m, n) for m, n in (await s.execute(stmt)).all()]

    def _select(self):
        return select(RoomMessage, User.username).outerjoin(User, User.id == RoomMessage.sender_id)

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
        rows = await self._named(self._select().where(RoomMessage.room_id == room_id, RoomMessage.lane == "public",
                                                      RoomMessage.kind.in_(("text", "ai_answer")),
                                                      RoomMessage.hidden_at.is_(None))
                                 .order_by(RoomMessage.seq.desc()).limit(limit))
        return [(AI_NAME if m.sender_kind == "ai" else (n or ""), m.text) for m, n in reversed(rows)]

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
        return [message_out(m, n, voice=voices.get(m.id), reactions=_group(reactions.get(m.id, [])))
                for m, n in rows]

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
            rows = (await s.scalars(select(RoomReaction).where(RoomReaction.room_id == room_id,
                                                               RoomReaction.seq > floor)
                                    .order_by(RoomReaction.seq, RoomReaction.created_at, RoomReaction.id))).all()
        by_seq: dict[int, list[RoomReaction]] = {}
        for r in rows:
            by_seq.setdefault(r.seq, []).append(r)
        return [{"seq": seq, **g} for seq, items in by_seq.items() for g in _group(items)]

    async def pending_requests(self, room_id: str) -> list[dict]:
        async with self._sm() as s:
            rows = (await s.execute(select(RoomJoinRequest, User.username, Room.name, Room.topic)
                                    .join(User, User.id == RoomJoinRequest.user_id)
                                    .join(Room, Room.id == RoomJoinRequest.room_id)
                                    .where(RoomJoinRequest.room_id == room_id, RoomJoinRequest.status == "pending")
                                    .order_by(RoomJoinRequest.created_at, RoomJoinRequest.id))).all()
        return [request_out(r, n, rn or rt) for r, n, rn, rt in rows]

    async def assist_history(self, room_id: str, user_id: int, limit: int):
        rows = await self._named(self._select().where(RoomMessage.room_id == room_id, RoomMessage.lane == "private",
                                                      RoomMessage.audience_id == user_id)
                                 .order_by(RoomMessage.seq.desc()).limit(limit))
        return list(reversed(rows))

    async def mine(self, user_id: int, now: datetime) -> list[tuple[Room, str]]:
        since = now - timedelta(days=self.limits.mine_closed_days)
        async with self._sm() as s:
            rows = (await s.execute(select(Room, RoomMember.role).join(RoomMember, RoomMember.room_id == Room.id).where(
                RoomMember.user_id == user_id, *_ACTIVE, or_(Room.status == "open", Room.closed_at >= since))
                .order_by(Room.status.desc(), Room.last_active_at.desc()))).all()
        return [(r, role) for r, role in rows]

    async def sweep(self, now: datetime, online: set[str]) -> list[tuple[str, str]]:
        """Close idle/expired rooms. Never deletes messages (that is `purge`, off by default)."""
        closed: list[tuple[str, str]] = []
        async with self._sm() as s:
            for room in (await s.scalars(select(Room).where(Room.status == "open"))).all():
                reason = None
                if as_utc(room.created_at) <= now - timedelta(hours=self.limits.max_hours):
                    reason = "expired"
                elif room.id not in online and as_utc(room.last_active_at) <= now - timedelta(minutes=self.limits.idle_minutes):
                    reason = "idle"
                if reason:
                    room.status, room.code, room.closed_at, room.close_reason = "closed", None, now, reason
                    closed.append((room.id, reason))
            await s.commit()
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
