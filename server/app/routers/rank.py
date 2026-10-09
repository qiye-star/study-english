"""Rank endpoints (spec 2026-10-09 §7.1). Off unless RANK_ENABLED; the config endpoint always answers."""
from fastapi import APIRouter, Depends, HTTPException

from app.core.config import Settings
from app.core.deps import current_user, get_settings
from app.models import User

router = APIRouter(prefix="/api/rank")


def require_rank(settings: Settings = Depends(get_settings)) -> Settings:
    if not settings.rank_enabled:
        raise HTTPException(404, "Rank is disabled")
    return settings


@router.get("/config")
async def rank_config(_: User = Depends(current_user), settings: Settings = Depends(get_settings)):
    if not settings.rank_enabled:
        return {"enabled": False, "match_available": False, "tiers": [], "season": None}
    return {"enabled": True, "match_available": settings.rank_match_available, "tiers": [], "season": None}


@router.get("/me")
async def rank_me(_: User = Depends(current_user), __: Settings = Depends(require_rank)):
    raise HTTPException(404, "Not Found")  # replaced in Task R7
