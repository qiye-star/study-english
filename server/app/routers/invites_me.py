"""The owner's permanent invite code (invites v2 plan S6; R-I6..R-I9, X3, X31). HTTP only: the rules live in
`services/user_invites.py`. Every response is `Cache-Control: no-store`; the plain code appears only here, and never in
a log, an audit row or an error body (the refusal bodies carry the reason name only)."""
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.deps import current_user, get_session, get_settings
from app.core.secretbox import box_for
from app.models import User, iso_utc, utcnow
from app.services import user_invites

router = APIRouter(prefix="/api")

NO_STORE = {"Cache-Control": "no-store"}
LIMITED = "Too many requests, please try again later"


class RotateIn(BaseModel):
    confirm: bool  # the owner must say so: the old code stops working at once

    @field_validator("confirm")
    @classmethod
    def _must_confirm(cls, value: bool) -> bool:
        if not value:
            raise ValueError("confirm must be true")
        return value


def _box(settings: Settings):
    box = box_for(settings)
    if box is None:  # INDEX X9 / R-I7: no SETTINGS_ENCRYPTION_KEY, no user codes
        raise HTTPException(503, "Invites are not configured")
    return box


def _refused(exc: user_invites.NotEligible) -> JSONResponse:
    return JSONResponse({"error": "Not eligible", "reason": exc.reason,
                         "available_at": iso_utc(exc.available_at) if exc.available_at else None},
                        status_code=403, headers=NO_STORE)


def _budget(request: Request, user: User) -> None:
    """Generating and replacing share one budget per user per day (R-I6)."""
    if not request.app.state.invite_action_limiter.allow(str(user.id)):
        raise HTTPException(429, LIMITED)


@router.get("/me/invite")
async def my_invite(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    data = await user_invites.view(session, settings, user.id, _box(settings), utcnow())
    return JSONResponse(data, headers=NO_STORE)


@router.post("/me/invite")
async def generate_my_invite(
    request: Request,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    box = _box(settings)
    _budget(request, user)
    try:
        data = await user_invites.generate(session, settings, user.id, box, utcnow())
    except user_invites.NotEligible as exc:
        return _refused(exc)
    except user_invites.RotateRequired:
        return JSONResponse({"error": "Replace your invite code to get a new one", "reason": "rotate_required"},
                            status_code=409, headers=NO_STORE)
    return JSONResponse(data, headers=NO_STORE)


@router.post("/me/invite/rotate")
async def rotate_my_invite(
    payload: RotateIn,
    request: Request,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    box = _box(settings)
    _budget(request, user)
    try:
        data = await user_invites.rotate(session, settings, user.id, box, utcnow())
    except user_invites.NotEligible as exc:
        return _refused(exc)
    except user_invites.NoCodeToReplace:
        return JSONResponse({"error": "No invite code to replace"}, status_code=409, headers=NO_STORE)
    return JSONResponse(data, headers=NO_STORE)
