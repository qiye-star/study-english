"""头像端点(计划 S4–S6):上传 / 删除自己的头像。路由只做 HTTP,逻辑在 services/avatars.py(INDEX X31)。"""
import re
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, StrictInt, field_validator
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.datastructures import UploadFile

from app.core.config import Settings
from app.core.deps import current_user, get_session, get_settings
from app.models import User, utcnow
from app.services import avatars
from app.services.uploads import parse_buffered_form
from app.storage import get_store

router = APIRouter(prefix="/api")

# The multipart envelope adds a few hundred bytes around the file; process() checks the file size again (R-V5).
_BODY_LIMIT = avatars.MAX_UPLOAD_BYTES + 64 * 1024
TOO_LARGE = "Avatar file is too large"
INVALID = "Invalid image"


async def _read_upload(request: Request) -> bytes:
    """Read the body while counting it: a larger body is refused at once, never buffered in full (R-V5)."""
    too_large = HTTPException(413, TOO_LARGE)
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > _BODY_LIMIT:
        raise too_large
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > _BODY_LIMIT:
            raise too_large
        chunks.append(chunk)
    return b"".join(chunks)


@router.post("/me/avatar")
async def upload_avatar(
    request: Request,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    """Replace your avatar with an uploaded JPEG, PNG or WebP (field `file`, at most 2 MiB)."""
    if not settings.avatar_upload_enabled:
        raise HTTPException(403, "Avatar upload is disabled")
    if not request.app.state.avatar_upload_limiter.allow(str(user.id)):
        raise HTTPException(429, "Too many requests, please try again later")
    form = await parse_buffered_form(request, await _read_upload(request))
    upload = form.get("file")
    if not isinstance(upload, UploadFile):
        raise HTTPException(422, INVALID)
    raw = await upload.read(avatars.MAX_UPLOAD_BYTES + 1)  # one byte over the limit tells process() it is too large
    try:
        url = await avatars.upload(session, get_store(request.app), user, raw)
    except avatars.AvatarError as exc:
        if exc.kind == "too_large":
            raise HTTPException(413, TOO_LARGE) from None
        raise HTTPException(422, INVALID) from None
    return {"avatar_url": url}


@router.delete("/me/avatar", status_code=204)
async def delete_avatar(
    request: Request,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    """Remove your avatar. Allowed even while uploads are switched off (R-V3); idempotent."""
    await avatars.clear(session, get_store(request.app), user)


@router.get("/avatars/{avatar_id}")
async def read_avatar(
    avatar_id: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    """Public: <img> cannot send a Bearer token, so the 128-bit id is the only secret (R-V4)."""
    content = None
    if settings.avatar_upload_enabled:  # switched off: reads are 404 too (R-V3)
        content = await avatars.public_read(session, get_store(request.app), avatar_id)
    if content is None:
        raise HTTPException(404, "Not Found")
    return Response(content, media_type="image/webp", headers={
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Security-Policy": "default-src 'none'",
    })


_MAX_USER_ID = 2**31 - 1
_DIGITS = re.compile(r"[0-9]{1,10}")


class ReportIn(BaseModel):
    # The reported user's id, as /api/rooms members show it: the web client sends a JSON number, others a string.
    # StrictInt rejects bools and floats; the str branch never coerces numbers. Both forms are range-checked.
    user_id: StrictInt | str
    reason: Literal["inappropriate", "impersonation", "other"]

    @field_validator("user_id", mode="after")
    @classmethod
    def _id_in_range(cls, value: int | str) -> int | str:
        if isinstance(value, str) and not _DIGITS.fullmatch(value):
            raise ValueError("invalid user id")
        if not 1 <= int(value) <= _MAX_USER_ID:
            raise ValueError("invalid user id")
        return value


@router.post("/avatar-reports")
async def report_avatar(
    payload: ReportIn,
    request: Request,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    """Report a fellow room member's current avatar. 201 when recorded, 200 when this reporter already did."""
    if not request.app.state.avatar_report_limiter.allow(str(user.id)):
        raise HTTPException(429, "Too many requests, please try again later")
    try:
        created = await avatars.report(session, user, str(payload.user_id), payload.reason, utcnow())
    except avatars.ReportError as exc:
        message = "No avatar to report" if exc.kind == "no_avatar" else "User not found"
        raise HTTPException(404, message) from None
    return JSONResponse({"ok": True}, status_code=201 if created else 200)
