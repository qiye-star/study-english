"""Room voice messages (spec 2026-10-10 §4, §8, §13): upload `POST /api/rooms/{room_id}/voice` and playback
`GET /api/rooms/{room_id}/voice/{message_id}`. `install(app, rt)` (plan P2-1) builds the `VoiceService`, sets
`rt.voice` and registers the staging sweep and the startup resume.

Audio is only served to active members of the room (closed rooms included; kicked members and non-members get
404, hidden messages 404, admin-purged audio 410). Never logs audio, transcripts or file paths."""
import asyncio
import logging
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from starlette.datastructures import UploadFile

from app.core.config import Settings
from app.core.deps import current_user, limited_user
from app.core.quotas import effective
from app.core.ratelimit import RateLimiter
from app.models import User, display_of, utcnow
from app.providers import llm
from app.rooms import audio
from app.rooms.protocol import MAX_ID, MAX_SEQ
from app.rooms.rules import is_persona_id
from app.rooms.store import RoomError
from app.rooms.voice import VoiceDeps, VoiceError, VoiceService
from app.rooms.voice_store import VoiceStore
from app.routers.rooms import RoomsRuntime, require_rooms, runtime
from app.services import usage
from app.services.prompts import prompt_cache
from app.services.uploads import parse_buffered_form, read_limited_body
from app.speech.asr import make_transcriber, shared_asr_gate

router = APIRouter(prefix="/api/rooms")
logger = logging.getLogger(__name__)

MAX_CLIENT_ID = 64
VOICE_ERRORS: dict[str, tuple[int, str]] = {
    "off": (403, "Voice messages are off"), "bad_audio": (400, "Expected 16 kHz mono WAV"),
    "too_short": (400, "Audio too short"), "too_long": (400, "Audio too long"),
    "quota": (429, "Voice storage quota reached"), "daily": (429, "Daily voice limit reached"),
    "rate": (429, "Too many requests, please try again later"), "bad_reply": (400, "Invalid reply"),
    "not_found": (404, "Room not found"),
}
# revalidate on every play (ETag/304 is cheap and runs after the membership and hidden checks), so a kick, a hide or a
# purge wins over the browser cache (review m5); never let a browser sniff a stored clip as something else
CACHE_CONTROL = "private, no-cache"
SAFE_HEADERS = {"X-Content-Type-Options": "nosniff", "Content-Disposition": "inline"}


def install(app, rt: RoomsRuntime) -> None:
    """Called once by `routers.rooms.runtime(app)`. Upstream settings are read from `app.state.settings` on every
    call (hot reload); data dir and concurrency are fixed at startup (`rooms_voice_concurrency` is restart-only)."""
    sm = app.state.sessionmaker
    settings0: Settings = app.state.settings

    def settings() -> Settings:
        return app.state.settings

    async def transcribe(wav: bytes, sender_id: int) -> str:
        s = settings()
        return await make_transcriber(app.state.http, s, None, gate=shared_asr_gate(app.state, s),
                                      uid=str(sender_id))(wav)

    async def complete(messages: list[dict], max_tokens: int, temperature: float) -> str:
        s = settings()
        return await llm.complete(app.state.http, s, messages, model=s.resolved_rooms_ai_model,
                                  max_tokens=max_tokens, temperature=temperature)

    async def consume(scope: str, subject: str, limit: int) -> bool:
        async with sm() as s:
            return await usage.consume(s, scope, subject, usage.utc_day(utcnow()), limit)

    async def refund(scope: str, subject: str) -> None:
        async with sm() as s:
            await usage.refund(s, scope, subject, usage.utc_day(utcnow()))

    async def quota_mb_for(user_id: int) -> int:
        async with sm() as s:
            return await effective(s, app, user_id, "rooms_voice_quota_mb")

    async def daily_for(user_id: int) -> int:
        async with sm() as s:
            return await effective(s, app, user_id, "rooms_voice_daily_per_user")

    async def template(key: str) -> str | None:
        return (await prompt_cache(app).get(key))[1]

    limits = rt.limits
    service = VoiceService(VoiceDeps(
        store=rt.store, voices=VoiceStore(sm), hub=rt.hub, limits=lambda: rt.limits,
        data_dir=Path(settings0.resolved_data_dir), store_format=lambda: settings().rooms_voice_store_format,
        available=lambda: settings().rooms_voice_available, llm_available=lambda: settings().rooms_ai_available,
        transcribe=transcribe, complete=complete, consume=consume, refund=refund, quota_mb_for=quota_mb_for,
        daily_for=daily_for, template=template, clock=utcnow,
        gate=asyncio.Semaphore(settings0.rooms_voice_concurrency),
        upload_limiter=RateLimiter(limits.voice_per_minute, 60),
        translate_limiter=RateLimiter(limits.translate_per_minute, 60),
        retry_limiter=RateLimiter(limits.retry_per_minute, 60), agents=lambda: rt.agents,
        publish=lambda event: app.state.learning_bus.publish(event)))  # plan L4 Task 17: the transcript count as active use
    rt.voice = service

    async def _voice_staging_sweep(rt_: RoomsRuntime, now) -> None:
        await service.cleanup_staging(now)

    async def _voice_resume(rt_: RoomsRuntime) -> None:
        await service.resume()

    rt.sweep_listeners.append(_voice_staging_sweep)
    rt.startup_listeners.append(_voice_resume)


def _service(rt: RoomsRuntime) -> VoiceService:
    if not isinstance(rt.voice, VoiceService):  # not installed (e.g. a bare app in a script)
        raise HTTPException(403, VOICE_ERRORS["off"][1])
    return rt.voice


def _form_text(value, *, name: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise HTTPException(400, f"Invalid {name}")
    return value


@router.post("/{room_id}/voice")
async def upload_voice(room_id: str, request: Request, user: User = Depends(limited_user),
                       _: Settings = Depends(require_rooms)):
    rt = runtime(request.app)
    service = _service(rt)
    try:
        room, _member = await rt.store.membership(room_id[:MAX_ID], user.id)
    except RoomError:
        raise HTTPException(404, "Room not found") from None
    if room.status != "open":
        raise HTTPException(404, "Room not found")
    body = await read_limited_body(request, audio.MAX_UPLOAD_BYTES)  # 413 "Audio file is too large"
    form = await parse_buffered_form(request, body)
    file = form.get("file")
    if not isinstance(file, UploadFile):
        raise HTTPException(400, "Audio file is required")
    client_id = _form_text(form.get("client_id"), name="client_id")
    if client_id is None or not 1 <= len(client_id) <= MAX_CLIENT_ID:
        raise HTTPException(400, "Invalid client_id")
    raw_reply = _form_text(form.get("reply_to"), name="reply")
    reply_to = None
    if raw_reply not in (None, "", "null"):
        try:
            reply_to = int(raw_reply)
        except ValueError:
            raise HTTPException(400, "Invalid reply") from None
        if not 1 <= reply_to <= MAX_SEQ:
            raise HTTPException(400, "Invalid reply")
    raw_to = _form_text(form.get("to_agent"), name="to_agent")
    to_agent = None
    if raw_to is not None and raw_to.strip() not in ("", "null"):
        to_agent = raw_to.strip()
        if not is_persona_id(to_agent):  # shape only: membership of the room's agents is checked after transcription
            raise HTTPException(400, "Invalid to_agent")
    wav = await file.read()
    try:
        message = await service.upload(room, user.id, display_of(user), wav, client_id, reply_to, to_agent)
    except VoiceError as e:
        status, text = VOICE_ERRORS.get(e.code, (400, "Invalid request"))
        raise HTTPException(status, text) from None
    return {"seq": message["seq"], "message": message}


@router.get("/{room_id}/voice/{message_id}")
async def play_voice(room_id: str, message_id: str, request: Request, user: User = Depends(current_user),
                     _: Settings = Depends(require_rooms)):
    """Members only (closed rooms too). Hidden or missing -> 404 `Not Found`; purged -> 410 `Audio removed`."""
    rt = runtime(request.app)
    service = _service(rt)
    room_id, message_id = room_id[:MAX_ID], message_id[:MAX_ID]
    try:
        await rt.store.membership(room_id, user.id)
    except RoomError:
        raise HTTPException(404, "Not Found") from None
    ref = await service.deps.voices.audio_ref(room_id, message_id)
    if ref is None or ref[2]:
        raise HTTPException(404, "Not Found")
    path, fmt, _hidden = ref
    if path is None:
        raise HTTPException(410, "Audio removed")
    etag = f'"{message_id}"'
    headers = {"Cache-Control": CACHE_CONTROL, "ETag": etag, **SAFE_HEADERS}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    try:
        content = await asyncio.to_thread(audio.read_file, service.deps.data_dir, path)
    except FileNotFoundError:
        logger.warning("room voice file missing room=%s message=%s", room_id, message_id)
        raise HTTPException(410, "Audio removed") from None
    except (ValueError, OSError) as e:
        logger.warning("room voice file unreadable room=%s message=%s error=%s", room_id, message_id,
                       type(e).__name__)
        raise HTTPException(404, "Not Found") from None
    return Response(content, media_type=audio.MEDIA_TYPES.get(fmt, "application/octet-stream"), headers=headers)
