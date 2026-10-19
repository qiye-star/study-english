"""头像端点(计划 S4–S6):上传 / 删除自己的头像。路由只做 HTTP,逻辑在 services/avatars.py(INDEX X31)。"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.datastructures import UploadFile

from app.core.config import Settings
from app.core.deps import current_user, get_session, get_settings
from app.models import User
from app.services import avatars
from app.services.uploads import parse_buffered_form

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
        url = await avatars.upload(session, settings, user, raw)
    except avatars.AvatarError as exc:
        if exc.kind == "too_large":
            raise HTTPException(413, TOO_LARGE) from None
        raise HTTPException(422, INVALID) from None
    return {"avatar_url": url}


@router.delete("/me/avatar", status_code=204)
async def delete_avatar(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    """Remove your avatar. Allowed even while uploads are switched off (R-V3); idempotent."""
    await avatars.clear(session, settings, user)
