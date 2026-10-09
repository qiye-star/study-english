"""Room endpoints (spec 2026-10-09 §7.2–7.3). Off unless ROOMS_ENABLED; the config endpoint always answers."""
from fastapi import APIRouter, Depends, HTTPException

from app.core.config import Settings
from app.core.deps import current_user, get_settings
from app.models import User

router = APIRouter(prefix="/api/rooms")
MAX_TEXT = 500  # Task M7 replaces this with app.rooms.rules.MAX_TEXT


def require_rooms(settings: Settings = Depends(get_settings)) -> Settings:
    if not settings.rooms_enabled:
        raise HTTPException(404, "Rooms are disabled")
    return settings


@router.get("/config")
async def rooms_config(_: User = Depends(current_user), settings: Settings = Depends(get_settings)):
    return {
        "enabled": settings.rooms_enabled,
        "ai_available": settings.rooms_ai_available,
        "max_members": settings.rooms_max_members,
        "max_text": MAX_TEXT,
    }


@router.get("/mine")
async def my_rooms(_: User = Depends(current_user), __: Settings = Depends(require_rooms)):
    return {"rooms": []}  # replaced in Task M7
