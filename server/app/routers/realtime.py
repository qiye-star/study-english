"""Realtime calls: `GET /api/realtime/config`, `POST /api/realtime/ticket` and `WS /api/realtime`.

The WebSocket is authenticated by a one-time ticket in the query string (`?ticket=`), as the web
client sends it. uvicorn prints the query string in its access/WebSocket log lines, so
`app.core.logging_setup` installs a filter that redacts `ticket=` values there; nothing here logs it.

Order of checks after `accept` (plan R12): disabled 4003 → ticket invalid/expired 4001 → user or
global call slot taken 4029 → no valid `start` within `START_TIMEOUT` 4400 → conversation gone 4004
→ no recognizer configured 4502. Then the `RealtimeSession` runs and its code closes the socket.
The registry slot is held by `RealtimeRegistry.hold`, so it is released on every exit path
(return, exception, client disconnect, cancellation). It is released as soon as the close frame is
sent: the call's late assessments are then finished by a background drain task (`spawn_drain`,
bounded by `DRAIN_GRACE`, cancelled at app shutdown), so a user who hangs up can redial at once.
"""
import asyncio
import logging
import time
from collections.abc import Callable

from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.websockets import WebSocketState

from app.speech.asr import AsrError, shared_asr_gate
from app.core.config import Settings
from app.core.deps import current_user, get_session, get_settings, limited_user
from app.models import User
from app.speech.realtime_asr import effective_realtime_asr
from app.realtime.realtime_protocol import (
    CLOSE_BUSY,
    CLOSE_DISABLED,
    CLOSE_NORMAL,
    CLOSE_NOT_FOUND,
    CLOSE_PROTOCOL,
    CLOSE_UNAUTHORIZED,
    CLOSE_UPSTREAM,
    ProtocolError,
    StartMsg,
    parse_client_message,
)
from app.realtime.realtime_providers import (
    DbMessageStore,
    make_assessor,
    make_recognizers,
    openai_llm_stream,
    volc_tts_stream,
)
from app.realtime.realtime_session import CallStats, ConversationGoneError, RealtimeLimits, RealtimeSession, Upstreams
from app.realtime.realtime_tickets import TicketGrant
from app.routers.conversations import owned_conversation
from app.core.timing import log_timing

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")

START_TIMEOUT = 10.0  # seconds to wait for the first (`start`) message
CLOSE_INTERNAL = 1011  # unexpected server error (standard code; the client shows its generic text)
CLOSE_GOING_AWAY = 1001  # the handler was cancelled (server shutdown); only logged
DRAIN_GRACE = 10.0  # seconds a closed call's late assessments get to persist (in the background)
DRAIN_SLACK = 1.0  # extra backstop on top of DRAIN_GRACE for the cancel-and-wait of late assessments
DRAIN_SHUTDOWN_WAIT = 1.0  # app shutdown waits this long for cancelled drains to unwind
session_clock: Callable[[], float] | None = None  # tests inject a fake clock for idle/max-duration


class TicketIn(BaseModel):
    conversation_id: str = Field(min_length=1, max_length=64)


@router.get("/realtime/config")
async def realtime_config(_: User = Depends(current_user), settings: Settings = Depends(get_settings)):
    return {
        "enabled": settings.realtime_available,
        "max_minutes": settings.realtime_max_minutes,
        "idle_timeout_seconds": settings.realtime_idle_timeout_seconds,
        "asr_mode": effective_realtime_asr(settings),
        "sample_rate_in": 16000,
        "sample_rate_out": settings.realtime_tts_sample_rate,
    }


@router.post("/realtime/ticket")
async def realtime_ticket(
    payload: TicketIn,
    request: Request,
    user: User = Depends(limited_user),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    if not settings.realtime_available:
        raise HTTPException(503, "Realtime is not enabled")
    conversation = await owned_conversation(session, user, payload.conversation_id)
    ticket = request.app.state.realtime_tickets.issue(user.id, conversation.id)
    return {"ticket": ticket, "expires_in": settings.realtime_ticket_ttl_seconds}


# ---- WebSocket ----

def build_upstreams(app, settings: Settings, user_id: int, start: StartMsg) -> Upstreams:
    """Real upstreams for one call. `asr_mode` is the mode the recognizers were built for, and the
    session sends exactly that value in `ready` (R25). Raises `AsrError("config")` when no
    recognizer is configured (→ 4502). Tests replace this function."""
    http = app.state.http
    uid = str(user_id)
    recognizers, fallback, mode = make_recognizers(http, settings, uid, gate=shared_asr_gate(app.state, settings))
    return Upstreams(
        recognizers=recognizers,
        fallback=fallback,
        asr_mode=mode,
        llm=openai_llm_stream(http, settings, start.model, start.temperature),
        tts=volc_tts_stream(http, settings, start.voice, uid),
        assessor=make_assessor(app, settings, user_id, start.save_recordings),
    )


class _ClientGone(Exception):
    pass


async def _close(websocket: WebSocket, code: int) -> None:
    if WebSocketState.DISCONNECTED in (websocket.application_state, websocket.client_state):
        return
    try:
        await websocket.close(code)
    except Exception as e:  # the client went away at the same moment
        logger.info("realtime close failed error=%s", type(e).__name__)


async def _read_start(websocket: WebSocket) -> StartMsg:
    message = await websocket.receive()
    if message["type"] == "websocket.disconnect":
        raise _ClientGone()
    text = message.get("text")
    if not isinstance(text, str):
        raise ProtocolError("expected a start message")
    msg = parse_client_message(text)
    if not isinstance(msg, StartMsg):
        raise ProtocolError("expected a start message")
    return msg


def _receiver(websocket: WebSocket):
    """`receive` for the session: audio bytes or text; `None` once the client is gone."""

    async def receive() -> str | bytes | None:
        try:
            message = await websocket.receive()
        except Exception:  # WebSocketDisconnect / RuntimeError after a disconnect / transport errors
            return None
        if message["type"] == "websocket.disconnect":
            return None
        data = message.get("bytes")
        if data is not None:
            return data
        text = message.get("text")
        return text if text is not None else ""  # "" → protocol error, never mistaken for a disconnect

    return receive


# ---- background drain of a closed call's late assessments ----

async def _drain(session: RealtimeSession) -> None:
    """Gives the closed call's pending assessments up to `DRAIN_GRACE` to persist and link; their
    events are dropped. Holds no DB session itself (each assessment opens its own for its write)."""
    try:
        async with asyncio.timeout(DRAIN_GRACE + DRAIN_SLACK):  # backstop if a task ignores cancellation
            await session.drain(DRAIN_GRACE)
    except asyncio.CancelledError:  # app shutdown
        session.cancel_pending()
        raise
    except Exception as e:  # never log the message: it may carry user text
        logger.warning("realtime drain failed error=%s", type(e).__name__)
        session.cancel_pending()


def spawn_drain(app, session: RealtimeSession) -> None:
    """Runs `_drain` as a task kept in `app.state.realtime_drains` (so it is not garbage-collected and
    the lifespan can cancel it). These calls hold no registry slot: `REALTIME_MAX_SESSIONS` and the
    per-user limit count live calls only, not calls whose assessments are still finishing."""
    drains: set[asyncio.Task] = app.state.realtime_drains
    task = asyncio.get_running_loop().create_task(_drain(session))
    drains.add(task)
    task.add_done_callback(drains.discard)


async def cancel_drains(app) -> None:
    """App shutdown: cancels outstanding drains and waits briefly for them to unwind."""
    drains = list(app.state.realtime_drains)
    for task in drains:
        task.cancel()
    if drains:
        await asyncio.wait(drains, timeout=DRAIN_SHUTDOWN_WAIT)
        await asyncio.sleep(0)  # let the done callbacks empty the set


@router.websocket("/realtime")
async def realtime_ws(websocket: WebSocket, ticket: str = ""):
    await websocket.accept()
    app = websocket.app
    settings: Settings = app.state.settings
    if not settings.realtime_available:
        return await _close(websocket, CLOSE_DISABLED)
    grant = app.state.realtime_tickets.redeem(ticket) if ticket else None
    if grant is None:
        return await _close(websocket, CLOSE_UNAUTHORIZED)
    with app.state.realtime_registry.hold(grant.user_id) as acquired:
        if not acquired:
            return await _close(websocket, CLOSE_BUSY)
        await _call(websocket, app, settings, grant)


async def _call(websocket: WebSocket, app, settings: Settings, grant: TicketGrant) -> None:
    started = time.monotonic()
    code: int | None = None  # the close code sent (for a vanished client / cancellation: only logged)
    session: RealtimeSession | None = None
    handed_off = False  # `run` returned and the drain task took over the session

    async def close(with_code: int) -> None:
        nonlocal code
        code = with_code
        await _close(websocket, with_code)

    try:
        try:
            start = await asyncio.wait_for(_read_start(websocket), START_TIMEOUT)
        except _ClientGone:
            code = CLOSE_NORMAL
            return
        except (TimeoutError, ProtocolError):
            return await close(CLOSE_PROTOCOL)
        store = DbMessageStore(app.state.sessionmaker, grant.user_id, grant.conversation_id,
                               settings.max_messages_per_conversation)
        try:
            await store.history(0)  # existence/ownership check only
        except ConversationGoneError:
            return await close(CLOSE_NOT_FOUND)
        try:
            upstreams = build_upstreams(app, settings, grant.user_id, start)
        except AsrError:
            return await close(CLOSE_UPSTREAM)
        limiter = app.state.user_limiter
        user_key = str(grant.user_id)
        session = RealtimeSession(
            upstreams=upstreams,
            store=store,
            system_prompt=start.system_prompt,
            allow_turn=lambda: limiter.allow(user_key),
            # Starlette's send_* await the ASGI send, which waits until uvicorn's transport is
            # writable, so the session's SEND_TIMEOUT does see a stuck client. Send errors
            # (WebSocketDisconnect, RuntimeError, OSError) end the call cleanly inside the session.
            send_json=websocket.send_json,
            send_bytes=websocket.send_bytes,
            limits=RealtimeLimits(max_seconds=settings.realtime_max_minutes * 60,
                                  idle_seconds=settings.realtime_idle_timeout_seconds),
            clock=session_clock,
        )
        result = await session.run(_receiver(websocket))
        # From here the background drain owns the session's late assessments (spawned before the
        # close so that a cancellation during the close cannot orphan them); returning frees the slot.
        spawn_drain(app, session)
        handed_off = True
        await close(result)
    except asyncio.CancelledError:
        if code is None:
            code = CLOSE_GOING_AWAY
        raise
    except Exception as e:  # never log the message: it may carry user text
        logger.warning("realtime call failed error=%s", type(e).__name__)
        if code is None:
            await close(CLOSE_INTERNAL)
    finally:
        if session is not None and not handed_off:
            session.cancel_pending()  # synchronous: also works while being cancelled
        stats = session.stats if session is not None else CallStats()
        log_timing("realtime_call", seconds=time.monotonic() - started, turns=stats.turns,
                   interrupts=stats.interrupts, close=code if code is not None else CLOSE_INTERNAL)
