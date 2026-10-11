"""Room learning summary (spec 2026-10-10 §6.1, §8): `GET /api/rooms/{room_id}/summary` and
`POST /api/rooms/{room_id}/summary/retry`.

`install(app, rt)` (plan P2-1) builds one `SummaryRunner` per app, keeps it on `rt.summary_runner`, adds a close
listener that generates the summary once in the background after any room close (owner/idle/expired/admin), and a
startup listener that re-queues up to 20 summaries left `pending` by a restart. Dependencies read the CURRENT
`app.state.settings` at call time (hot reload). Members only; "could say better" is shown only to its author
(R2-13). Never logs summary or chat text."""
from fastapi import APIRouter, Depends, HTTPException, Request

from app.core.config import Settings
from app.core.deps import current_user
from app.models import RoomSummary, User, iso_utc, utcnow
from app.providers import llm
from app.rooms.protocol import MAX_ID
from app.rooms.rules import RoomLimits
from app.rooms.scenarios import brief
from app.rooms.store import RoomError, opened_anchor
from app.rooms.summary import view_for
from app.rooms.summary_store import SummaryRunner, SummaryStore
from app.routers.rooms import RoomsRuntime, _raise, require_rooms, runtime
from app.services import usage
from app.services.prompts import prompt_cache

router = APIRouter(prefix="/api/rooms")
STARTUP_REQUEUE = 20


def summary_out(row: RoomSummary | None, user_id: int) -> dict:
    """spec §8: {status, reason, overview_zh, words, my_fixes, created_at, finished_at}; no row -> status none."""
    if row is None:
        return {"status": "none"}
    view = view_for(row.data or {}, user_id) if row.status == "done" else {"overview_zh": "", "words": [],
                                                                            "my_fixes": []}
    return {"status": row.status, "reason": row.reason, **view, "created_at": iso_utc(row.created_at),
            "finished_at": iso_utc(row.finished_at) if row.finished_at else None}


def _runner(app, rt: RoomsRuntime) -> SummaryRunner:
    sm = app.state.sessionmaker

    def settings() -> Settings:
        return app.state.settings

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

    async def template(key: str) -> str | None:
        return (await prompt_cache(app).get(key))[1]

    async def room_info(room_id: str) -> tuple[str, str, str] | None:
        room = await rt.store.room(room_id)
        if room is None:
            return None
        members = await rt.store.members(room_id)
        return room.level, brief(room.scenario), ", ".join(m.name for m in members)

    def limits() -> RoomLimits:
        return rt.limits

    async def owner_of(room_id: str) -> int | None:
        room = await rt.store.room(room_id)
        return None if room is None else room.owner_id

    async def opened_of(room_id: str):
        room = await rt.store.room(room_id)
        return None if room is None or not room.reopen_count else opened_anchor(room)

    return SummaryRunner(store=SummaryStore(sm), complete=complete, consume=consume, refund=refund,
                         template=template, room_info=room_info, limits=limits,
                         available=lambda: settings().rooms_summary_available,
                         model=lambda: settings().resolved_rooms_ai_model, clock=utcnow, owner_of=owner_of,
                         opened_of=opened_of)


def install(app, rt) -> None:
    """Called by `routers.rooms.runtime(app)` once per app (plan P2-1)."""
    runner = _runner(app, rt)
    rt.summary_runner = runner

    async def on_close(rt_: RoomsRuntime, room_id: str, reason: str) -> None:
        rt_.hub.spawn(rt_.summary_runner.run(room_id))  # generate in the background; closing never waits

    async def on_startup(rt_: RoomsRuntime) -> None:
        for room_id in await rt_.summary_runner.store.pending(STARTUP_REQUEUE):
            rt_.hub.spawn(rt_.summary_runner.run(room_id, resume=True))

    rt.close_listeners.append(on_close)
    rt.startup_listeners.append(on_startup)


async def _closed_room(rt: RoomsRuntime, room_id: str, user: User):
    try:
        room, _member = await rt.store.membership(room_id[:MAX_ID], user.id)
    except RoomError as e:
        _raise(e)
    if room.status == "open":
        raise HTTPException(409, "Room is still open")
    return room


@router.get("/{room_id}/summary")
async def room_summary(room_id: str, request: Request, user: User = Depends(current_user),
                       _: Settings = Depends(require_rooms)):
    rt = runtime(request.app)
    room = await _closed_room(rt, room_id, user)
    return {"summary": summary_out(await rt.summary_runner.store.get(room.id), user.id)}


@router.post("/{room_id}/summary/retry")
async def retry_summary(room_id: str, request: Request, user: User = Depends(current_user),
                        _: Settings = Depends(require_rooms)):
    """Any member may retry a failed summary while attempts remain (spec §6.1: at most 2 per room)."""
    rt = runtime(request.app)
    try:
        room, _member = await rt.store.membership(room_id[:MAX_ID], user.id)
    except RoomError as e:
        _raise(e)
    runner: SummaryRunner = rt.summary_runner
    row = await runner.store.get(room.id)
    retryable = row is not None and (row.status == "failed" or (row.status == "done" and row.reason == "stale"))
    if room.status == "open" or not retryable \
            or not await runner.store.start(room.id, utcnow(), rt.limits.summary_attempts):
        raise HTTPException(409, "Cannot retry")
    rt.hub.spawn(runner.generate(room.id))
    return {"summary": summary_out(await runner.store.get(room.id), user.id)}
