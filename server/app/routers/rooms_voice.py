"""Room voice messages (spec 2026-10-10 §4): upload `POST /api/rooms/{room_id}/voice` and playback
`GET /api/rooms/{room_id}/voice/{message_id}`. Filled in by lane SV (SV4); foundation F2 only provides the
router and the install hook."""
from fastapi import APIRouter

router = APIRouter(prefix="/api/rooms")


def install(app, rt) -> None:
    """Called by `routers.rooms.runtime(app)` once per app (plan P2-1). SV4 sets `rt.voice` (a
    `rooms.connection.VoiceHandler`) and registers its sweep/startup listeners here."""
    return None
