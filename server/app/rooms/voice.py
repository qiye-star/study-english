"""Room voice messages (spec 2026-10-10 §4): upload orchestration, the shared transcription (once, at send time),
the lazy shared translation, sender retries and the staging sweep. Upstreams and counters are injected through
`VoiceDeps` (the router builds them in `routers/rooms_voice.install`).

Rules kept here:
- audio and its transcript/translation are kept forever: this module never deletes a stored clip; the sweep only
  removes *staging* WAVs of rooms that closed `staging_keep_days` ago (after that a failed clip cannot be retried);
- every upstream call runs under `metering.bind_user(...)` + `feature_scope("rooms_voice")` (spec §11.3):
  transcription as the sender, translation as the requester;
- logs carry only room/message ids, durations, byte counts, statuses, timings and exception class names - never
  audio, transcripts, translations or user text."""
import asyncio
import logging
import time
import weakref
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

from app.core import metering
from app.core.ratelimit import RateLimiter
from app.models import Room, new_uuid
from app.rooms import assistant, audio
from app.rooms.hub import RoomHub
from app.rooms.protocol import event
from app.rooms.rules import RoomLimits
from app.rooms.store import RoomStore, voice_out
from app.rooms.voice_store import VoiceStore

logger = logging.getLogger(__name__)
GLOBAL = "*"
FEATURE = "rooms_voice"
MB = 1_048_576
CJK_SHARE = 0.3  # spec §4.4 / P2-10: CJK share of letter-class characters for "zh" (web isMostlyNative uses it too)


class VoiceError(Exception):
    def __init__(self, code: str):  # off | bad_audio | too_short | too_long | quota | daily | rate | bad_reply | not_found
        super().__init__(code)
        self.code = code


@dataclass
class VoiceDeps:
    store: RoomStore
    voices: VoiceStore
    hub: RoomHub
    limits: Callable[[], RoomLimits]  # hot reload: the current limits on every call
    data_dir: Path
    store_format: Callable[[], str]  # "mp3" | "wav"
    available: Callable[[], bool]  # settings.rooms_voice_available
    llm_available: Callable[[], bool]  # settings.rooms_ai_available
    transcribe: Callable[[bytes, int], Awaitable[str]]  # (wav, sender_id) -> text; raising = upstream failure
    complete: Callable[[list[dict], int, float], Awaitable[str]]
    consume: Callable[[str, str, int], Awaitable[bool]]
    refund: Callable[[str, str], Awaitable[None]]
    quota_mb_for: Callable[[int], Awaitable[int]]  # rooms_voice_quota_mb (per-user override)
    daily_for: Callable[[int], Awaitable[int]]  # rooms_voice_daily_per_user (per-user override)
    template: Callable[[str], Awaitable[str | None]]  # published prompt (rooms.voice_translate)
    clock: Callable[[], datetime]
    gate: asyncio.Semaphore  # ROOMS_VOICE_CONCURRENCY
    upload_limiter: RateLimiter  # 6/minute, key room:user
    translate_limiter: RateLimiter  # 20/minute, key user
    retry_limiter: RateLimiter  # 6/minute, key room:user


def _is_cjk(ch: str) -> bool:
    o = ord(ch)
    return (0x4E00 <= o <= 0x9FFF or 0x3400 <= o <= 0x4DBF or 0xF900 <= o <= 0xFAFF or 0x20000 <= o <= 0x2FA1F)


def detect_lang(text: str) -> str:
    """"zh" when CJK characters are at least 30% of the letter-class characters, else "en"."""
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return "en"
    return "zh" if sum(1 for c in letters if _is_cjk(c)) / len(letters) >= CJK_SHARE else "en"


def _day_start(now: datetime) -> datetime:
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


class VoiceService:
    """Implements `rooms.connection.VoiceHandler`. `deps` is public so tests can swap upstreams."""

    def __init__(self, deps: VoiceDeps):
        self.deps = deps
        self._senders: weakref.WeakValueDictionary[int, asyncio.Lock] = weakref.WeakValueDictionary()

    def _sender_lock(self, sender_id: int) -> asyncio.Lock:
        lock = self._senders.get(sender_id)
        if lock is None:
            lock = self._senders[sender_id] = asyncio.Lock()
        return lock

    # ---- upload (spec §4.2) ----

    async def upload(self, room: Room, sender_id: int, sender_name: str, wav: bytes, client_id: str,
                     reply_to: int | None) -> dict:
        """Store one clip and broadcast it; returns the v2 message dict. The same `client_id` within the dedupe
        window returns the original message (like `say`) and costs nothing."""
        d = self.deps
        limits = d.limits()
        now = d.clock()
        if not d.available() or room.status != "open" or not room.allow_voice:
            raise VoiceError("off")
        dup = await d.store.find_client(room.id, sender_id, client_id, now - timedelta(minutes=limits.dedupe_minutes))
        if dup is not None:
            out = await d.store.out_one(dup.id)
            if out is not None:
                return out
        if not d.upload_limiter.allow(f"{room.id}:{sender_id}"):
            raise VoiceError("rate")
        try:
            info = audio.inspect_wav(wav, min_ms=limits.voice_min_ms, max_ms=limits.voice_max_ms)
        except audio.AudioError as e:
            raise VoiceError(e.code) from None
        quote = None
        if reply_to is not None:
            quote = await d.store.quote_for(room.id, reply_to)
            if quote is None:
                raise VoiceError("bad_reply")
        data, fmt = await asyncio.to_thread(audio.stored_audio, info.pcm, d.store_format())
        staging_wav = audio.canonical_wav(info.pcm)  # the upload's extra chunks are not kept (review m6)
        uid = str(sender_id)
        # quota check through insert is one step per sender: parallel uploads (other rooms) cannot both pass (m8)
        async with self._sender_lock(sender_id):
            used = await d.voices.used_bytes(sender_id, since=_day_start(now))
            if used + len(data) > await d.quota_mb_for(sender_id) * MB:
                raise VoiceError("quota")
            if not await d.consume("room_voice", uid, await d.daily_for(sender_id)):
                raise VoiceError("daily")
            if not await d.consume("room_voice_global", GLOBAL, limits.voice_global_daily):
                await d.refund("room_voice", uid)
                raise VoiceError("daily")
            message_id = new_uuid()
            staging = audio.staging_relpath(message_id)
            stored = audio.audio_relpath(room.id, message_id, fmt)
            try:
                await asyncio.to_thread(audio.write_file, d.data_dir, staging, staging_wav)
                await asyncio.to_thread(audio.write_file, d.data_dir, stored, data)
                async with d.hub.lock(room.id):
                    msg, _voice = await d.voices.append_voice(
                        room.id, sender_id=sender_id, client_id=client_id, reply_to=reply_to, quote=quote,
                        duration_ms=info.duration_ms, audio_path=stored, audio_bytes=len(data), audio_format=fmt,
                        staging_path=staging, now=now, message_id=message_id)
            except BaseException as e:
                for rel in (staging, stored):
                    await asyncio.to_thread(audio.delete_file, d.data_dir, rel)
                await d.refund("room_voice", uid)
                await d.refund("room_voice_global", GLOBAL)
                logger.warning("room voice upload failed room=%s error=%s", room.id, type(e).__name__)
                raise
        logger.info("room voice stored room=%s message=%s duration_ms=%d bytes=%d format=%s",
                    room.id, message_id, info.duration_ms, len(data), fmt)
        out = await d.store.out_one(msg.id)
        await d.hub.broadcast(room.id, event("message", message=out))
        d.hub.spawn(self._transcribe(room.id, msg.id, msg.seq, sender_id))
        return out

    # ---- transcription (spec §4.4) ----

    async def _broadcast_voice(self, room_id: str, seq: int, voice) -> None:
        """A message hidden while its job ran gets no update: its transcript/translation stay withheld (review m1)."""
        if await self.deps.voices.is_hidden(voice.message_id):
            return
        await self.deps.hub.broadcast(room_id, event("voice_update", seq=seq, voice=voice_out(voice)))

    async def _transcribe(self, room_id: str, message_id: str, seq: int, sender_id: int, *,
                          retry: bool = False) -> None:
        d = self.deps
        try:
            if not await d.voices.begin_attempt(message_id, d.limits().voice_attempts):
                if retry:  # a concurrent retry won the claim: this one's global count goes back
                    await d.refund("room_voice_global", GLOBAL)
                return
            voice = await d.voices.get(message_id)
            if retry:
                await self._broadcast_voice(room_id, seq, voice)  # back to "pending" for everyone
            started = time.monotonic()
            try:
                if voice.staging_path is None:
                    raise FileNotFoundError("staging")
                wav = await asyncio.to_thread(audio.read_file, d.data_dir, voice.staging_path)
                metering.bind_user(sender_id)
                with metering.feature_scope(FEATURE):
                    async with d.gate:
                        text = (await d.transcribe(wav, sender_id) or "").strip()
            except asyncio.CancelledError:
                raise
            except Exception as e:  # upstream or unexpected: keep the staging WAV for a retry
                logger.info("room voice transcription failed room=%s message=%s error=%s ms=%d",
                            room_id, message_id, type(e).__name__, (time.monotonic() - started) * 1000)
                await d.refund("room_voice_global", GLOBAL)
                voice = await d.voices.set_transcript(message_id, status="failed", transcript=None, lang=None,
                                                      now=d.clock())
                await self._broadcast_voice(room_id, seq, voice)
                return
            staging = voice.staging_path
            status = "done" if text else "empty"
            voice = await d.voices.set_transcript(message_id, status=status, transcript=text or None,
                                                  lang=detect_lang(text) if text else None, now=d.clock())
            if staging:
                await asyncio.to_thread(audio.delete_file, d.data_dir, staging)
            logger.info("room voice transcribed room=%s message=%s status=%s ms=%d",
                        room_id, message_id, status, (time.monotonic() - started) * 1000)
            await self._broadcast_voice(room_id, seq, voice)
        except asyncio.CancelledError:
            raise
        except Exception as e:  # a background task must never die loudly
            logger.warning("room voice transcription task failed room=%s message=%s error=%s",
                           room_id, message_id, type(e).__name__)

    # ---- WebSocket handlers (connection.VoiceHandler) ----

    async def on_translate(self, conn, seq: int) -> None:
        """Translate a transcript once for the whole room (spec §4.5, R2-7 zh<->en only, R2-8 lazy)."""
        d = self.deps
        limits = d.limits()
        if not d.translate_limiter.allow(str(conn.user_id)):
            await conn.send_self(event("error", code="rate_limited"))
            return
        found = await d.voices.by_seq(conn.room_id, seq)
        if found is None or found[1].status != "done":
            await conn.send_self(event("error", code="bad_seq"))
            return
        msg, voice = found
        if voice.translation_status == "done":  # cached: only the asker needs it again
            await conn.send_self(event("voice_update", seq=seq, voice=voice_out(voice)))
            return
        if not d.llm_available():
            await conn.send_self(event("notice", code="voice_off"))
            return
        if not await d.voices.begin_translation(msg.id, limits.translate_attempts):
            return  # pending (someone else asked first) or out of attempts
        if not await d.consume("room_translate_global", GLOBAL, limits.translate_global_daily):
            await d.voices.undo_translation(msg.id)
            await conn.send_self(event("notice", code="translate_quota"))
            return
        await self._broadcast_voice(conn.room_id, seq, await d.voices.get(msg.id))
        d.hub.spawn(self._translate(conn.room_id, msg.id, seq, conn.user_id))

    async def _translate(self, room_id: str, message_id: str, seq: int, requester_id: int) -> None:
        d = self.deps
        started = time.monotonic()
        try:
            voice = await d.voices.get(message_id)
            source, target = ("Chinese", "English") if voice.lang == "zh" else ("English", "Chinese")
            try:
                template = await d.template("rooms.voice_translate")
                messages = assistant.translate_messages(voice.transcript or "", source, target, template)
                metering.bind_user(requester_id)
                with metering.feature_scope(FEATURE):
                    async with d.gate:
                        raw = await d.complete(messages, assistant.TRANSLATE_MAX_TOKENS,
                                               assistant.TRANSLATE_TEMPERATURE)
                translation = assistant.parse_translation(raw)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                if not isinstance(e, assistant.AssistFormatError):  # spec §11.2: format errors are not refunded
                    await d.refund("room_translate_global", GLOBAL)
                logger.info("room voice translation failed room=%s message=%s error=%s ms=%d",
                            room_id, message_id, type(e).__name__, (time.monotonic() - started) * 1000)
                voice = await d.voices.set_translation(message_id, status="failed", translation=None)
                await self._broadcast_voice(room_id, seq, voice)
                return
            voice = await d.voices.set_translation(message_id, status="done", translation=translation)
            logger.info("room voice translated room=%s message=%s ms=%d",
                        room_id, message_id, (time.monotonic() - started) * 1000)
            await self._broadcast_voice(room_id, seq, voice)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.warning("room voice translation task failed room=%s message=%s error=%s",
                           room_id, message_id, type(e).__name__)

    async def on_retry(self, conn, seq: int) -> None:
        """The sender retries a failed transcription (spec §4.4): at most `voice_attempts` in all; each retry
        counts against the site's daily voice cap, not the sender's daily clips."""
        d = self.deps
        limits = d.limits()
        if not d.available():  # sub-switch off: no new transcriptions (spec §11.2); translation still works
            await conn.send_self(event("notice", code="voice_off"))
            return
        if not d.retry_limiter.allow(f"{conn.room_id}:{conn.user_id}"):  # before any DB work, for everyone (m7)
            await conn.send_self(event("error", code="rate_limited"))
            return
        found = await d.voices.by_seq(conn.room_id, seq)
        if found is None or found[0].sender_id != conn.user_id:
            await conn.send_self(event("error", code="bad_seq"))
            return
        msg, voice = found
        if voice.status != "failed":
            await conn.send_self(event("error", code="bad_seq"))
            return
        if voice.staging_path is None or voice.attempts >= limits.voice_attempts:
            await conn.send_self(event("notice", code="retry_limit"))
            return
        if not await d.consume("room_voice_global", GLOBAL, limits.voice_global_daily):
            await conn.send_self(event("notice", code="voice_quota"))
            return
        d.hub.spawn(self._transcribe(conn.room_id, msg.id, seq, conn.user_id, retry=True))

    # ---- sweep and startup ----

    async def cleanup_staging(self, now: datetime) -> int:
        """Delete staging WAVs of rooms closed more than `staging_keep_days` ago. Stored clips are kept forever."""
        d = self.deps
        stale = await d.voices.stale_staging(now - timedelta(days=d.limits().staging_keep_days))
        for message_id, path in stale:
            await asyncio.to_thread(audio.delete_file, d.data_dir, path)
            await d.voices.clear_staging(message_id)
        if stale:
            logger.info("room voice staging cleaned files=%d", len(stale))
        return len(stale)

    async def resume(self) -> int:
        """Startup: transcriptions/translations cut off by a restart become `failed` (the sender can retry)."""
        failed = await self.deps.voices.fail_pending()
        logger.info("room voice startup pending_failed=%d", failed)
        return failed
