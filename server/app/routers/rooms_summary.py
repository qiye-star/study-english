"""Room learning summary (spec 2026-10-10 §6.1): `GET /api/rooms/{room_id}/summary` and
`POST /api/rooms/{room_id}/summary/retry`. Filled in by lane SX (SX3); foundation F2 only provides the router and
the install hook."""
from fastapi import APIRouter

router = APIRouter(prefix="/api/rooms")


def install(app, rt) -> None:
    """Called by `routers.rooms.runtime(app)` once per app (plan P2-1). SX3 appends its close listener (generate
    once after a room closes) and startup listener (re-queue pending summaries) here."""
    return None
