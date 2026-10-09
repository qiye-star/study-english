"""`room_voice` reads and writes (spec 2026-10-10 §4, §7). One row per voice message; transcript and
translation are written once and shared by every member. Never logs transcripts or translations.

Room audio is kept forever (O-4): nothing here deletes a voice row or clears `audio_path`. Only the admin
`room_audio` tool (lane AD) and the explicit ROOM_MESSAGE_RETENTION_DAYS purge remove anything. The sweeper only
clears *staging* WAVs (`stale_staging` / `clear_staging`) and restart turns `pending` into `failed`."""
from datetime import datetime

from sqlalchemy import func, select, update

from app.models import Room, RoomMessage, RoomVoice, new_uuid

MAX_TRANSCRIPT = 1000  # code points (spec §4.4)
MAX_TRANSLATION = 1200


class VoiceStore:
    def __init__(self, sessionmaker):
        self._sm = sessionmaker

    async def append_voice(self, room_id: str, *, sender_id: int, client_id: str, reply_to: int | None,
                           quote: dict | None, duration_ms: int, audio_path: str, audio_bytes: int, audio_format: str,
                           staging_path: str, now: datetime,
                           message_id: str | None = None) -> tuple[RoomMessage, RoomVoice]:
        """The voice message and its `room_voice` row in one transaction (plan P2-9). Same seq logic as
        `RoomStore.append` (the caller holds `RoomHub.lock(room_id)`). `message_id` lets the caller name the files
        before the row exists."""
        async with self._sm() as s:
            room = await s.get(Room, room_id)
            room.last_seq += 1
            room.last_active_at = now
            msg = RoomMessage(id=message_id or new_uuid(), room_id=room_id, seq=room.last_seq, lane="public",
                              audience_id=None, sender_kind="user", sender_id=sender_id, kind="voice", text="",
                              assisted=False, reply_to=reply_to, ai_status=None, client_id=client_id,
                              meta={"quote": quote} if quote else None, created_at=now)
            s.add(msg)
            await s.flush()
            voice = RoomVoice(message_id=msg.id, room_id=room_id, sender_id=sender_id, duration_ms=duration_ms,
                              audio_path=audio_path, audio_bytes=audio_bytes, audio_format=audio_format,
                              staging_path=staging_path, status="pending", attempts=0, translation_attempts=0,
                              created_at=now)
            s.add(voice)
            await s.commit()
            return msg, voice

    async def get(self, message_id: str) -> RoomVoice | None:
        async with self._sm() as s:
            return await s.get(RoomVoice, message_id)

    async def by_seq(self, room_id: str, seq: int) -> tuple[RoomMessage, RoomVoice] | None:
        """A public, visible voice message of the room by seq (hidden messages cannot be translated or retried)."""
        async with self._sm() as s:
            row = (await s.execute(select(RoomMessage, RoomVoice).join(RoomVoice, RoomVoice.message_id == RoomMessage.id)
                                   .where(RoomMessage.room_id == room_id, RoomMessage.seq == seq,
                                          RoomMessage.lane == "public", RoomMessage.kind == "voice",
                                          RoomMessage.hidden_at.is_(None)))).first()
        return (row[0], row[1]) if row is not None else None

    async def begin_attempt(self, message_id: str, max_attempts: int) -> bool:
        """Claim one transcription attempt: `pending`/`failed` with attempts left -> attempts+1, `pending`."""
        async with self._sm() as s:
            result = await s.execute(update(RoomVoice).where(
                RoomVoice.message_id == message_id, RoomVoice.status.in_(("pending", "failed")),
                RoomVoice.attempts < max_attempts).values(attempts=RoomVoice.attempts + 1, status="pending"))
            await s.commit()
            return (result.rowcount or 0) > 0

    async def set_transcript(self, message_id: str, *, status: str, transcript: str | None, lang: str | None,
                             now: datetime) -> RoomVoice:
        """`done` also writes `room_messages.text` (AI context, summary, admin search, v1 clients); `done`/`empty`
        drop the staging path (the caller deletes the file); `failed` keeps it for a retry."""
        async with self._sm() as s:
            voice = await s.get(RoomVoice, message_id)
            voice.status = status
            voice.transcribed_at = now
            if status == "done":
                voice.transcript = (transcript or "")[:MAX_TRANSCRIPT]
                voice.lang = lang
                await s.execute(update(RoomMessage).where(RoomMessage.id == message_id)
                                .values(text=voice.transcript))
            if status in ("done", "empty"):
                voice.staging_path = None
            await s.commit()
            await s.refresh(voice)
            return voice

    async def begin_translation(self, message_id: str, max_attempts: int) -> bool:
        """Claim one translation: transcript `done`, translation not pending/done, attempts left -> `pending`."""
        async with self._sm() as s:
            result = await s.execute(update(RoomVoice).where(
                RoomVoice.message_id == message_id, RoomVoice.status == "done",
                (RoomVoice.translation_status.is_(None)) | (RoomVoice.translation_status == "failed"),
                RoomVoice.translation_attempts < max_attempts)
                .values(translation_status="pending", translation_attempts=RoomVoice.translation_attempts + 1))
            await s.commit()
            return (result.rowcount or 0) > 0

    async def undo_translation(self, message_id: str) -> None:
        """Give back a claimed translation that never ran (e.g. the daily cap was reached)."""
        async with self._sm() as s:
            voice = await s.get(RoomVoice, message_id)
            if voice is not None and voice.translation_status == "pending":
                voice.translation_attempts = max(0, voice.translation_attempts - 1)
                voice.translation_status = None if voice.translation is None and voice.translation_attempts == 0 \
                    else "failed"
                await s.commit()

    async def set_translation(self, message_id: str, *, status: str, translation: str | None) -> RoomVoice:
        async with self._sm() as s:
            voice = await s.get(RoomVoice, message_id)
            voice.translation_status = status
            if status == "done":
                voice.translation = (translation or "")[:MAX_TRANSLATION]
            await s.commit()
            await s.refresh(voice)
            return voice

    async def used_bytes(self, sender_id: int, since: datetime | None = None) -> int:
        """Stored bytes of the sender's clips that were not purged (optionally only clips created since `since`)."""
        conds = [RoomVoice.sender_id == sender_id, RoomVoice.audio_path.is_not(None)]
        if since is not None:
            conds.append(RoomVoice.created_at >= since)
        async with self._sm() as s:
            return int(await s.scalar(select(func.coalesce(func.sum(RoomVoice.audio_bytes), 0)).where(*conds)) or 0)

    async def fail_pending(self) -> int:
        """Startup: transcriptions and translations interrupted by a restart become `failed` (retryable)."""
        async with self._sm() as s:
            result = await s.execute(update(RoomVoice).where(RoomVoice.status == "pending").values(status="failed"))
            await s.execute(update(RoomVoice).where(RoomVoice.translation_status == "pending")
                            .values(translation_status="failed"))
            await s.commit()
            return result.rowcount or 0

    async def stale_staging(self, closed_before: datetime) -> list[tuple[str, str]]:
        """(message_id, staging_path) of staging WAVs whose room closed before `closed_before`."""
        async with self._sm() as s:
            rows = (await s.execute(select(RoomVoice.message_id, RoomVoice.staging_path)
                                    .join(Room, Room.id == RoomVoice.room_id)
                                    .where(RoomVoice.staging_path.is_not(None), Room.status == "closed",
                                           Room.closed_at < closed_before)
                                    .order_by(RoomVoice.created_at, RoomVoice.message_id))).all()
        return [(m, p) for m, p in rows]

    async def clear_staging(self, message_id: str) -> None:
        async with self._sm() as s:
            await s.execute(update(RoomVoice).where(RoomVoice.message_id == message_id).values(staging_path=None))
            await s.commit()

    async def audio_ref(self, room_id: str, message_id: str) -> tuple[str | None, str, bool] | None:
        """(audio_path, format, hidden) of a voice message of this room; None when there is no such message."""
        async with self._sm() as s:
            row = (await s.execute(select(RoomVoice.audio_path, RoomVoice.audio_format, RoomMessage.hidden_at)
                                   .join(RoomMessage, RoomMessage.id == RoomVoice.message_id)
                                   .where(RoomVoice.message_id == message_id, RoomMessage.room_id == room_id,
                                          RoomMessage.lane == "public"))).first()
        if row is None:
            return None
        return row[0], row[1], row[2] is not None
