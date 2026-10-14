"""Link import (spec 2026-10-13-video-import §7.1, §9): `POST /api/library/imports {url, title?}`.

Only the URL precheck runs inside the request (yt-dlp never runs here): the item is created `queued` and the
worker's fetch stage does the rest (`app.library.ytdlp.YtDlpFetch`, registered by `install`). Order: 401 (login),
404 `Library is disabled` when `library_enabled` is off (S1's gate, R-SC9), 404 `Link import is disabled` when the
link switch is off or yt-dlp is missing (D4: admin switch, default off), 429 per-minute limit, 422 body, 400
`Invalid link` for every precheck rejection (the reason code only goes to the log), then S1's shared admission
(`limits.admit_new_item`: 503 without ffmpeg, 409 item / quota limits, 429 daily). Never logs the URL or the title."""
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.deps import current_user, get_session, get_settings, limited_user
from app.library import limits, store, urlcheck
from app.library.errors import LibraryError, api_error, http_error
from app.library.ytdlp import YtDlpFetch
from app.models import User

router = APIRouter(prefix="/api/library")
logger = logging.getLogger(__name__)

LINK_DISABLED = "Link import is disabled"
BAD_URL = "Invalid link"
MAX_BODY_URL = 4096  # pydantic bound only; the precheck's own limit (2000 after trimming) answers 400


class ImportIn(BaseModel):
    url: str = Field(min_length=1, max_length=MAX_BODY_URL)
    title: str | None = Field(default=None, max_length=200)


def install(app) -> None:
    """Called once from `create_app` at S1's anchor: the worker's fetch stage becomes yt-dlp (S1's default raises
    `unsupported_site`)."""
    app.state.library.set_fetch_stage(YtDlpFetch())


async def import_user(request: Request, user: User = Depends(current_user),
                      settings: Settings = Depends(get_settings),
                      session: AsyncSession = Depends(get_session)) -> User:
    # `get_settings` reads `app.state.settings` per request: the switches are hot (never cache them)
    if not settings.library_enabled:  # same gate as every other library route; ffmpeg is checked by admit_new_item
        raise api_error("disabled")
    if not settings.library_link_available:
        raise HTTPException(404, LINK_DISABLED)
    return await limited_user(request, user, session)


@router.post("/imports")
async def create_import(body: ImportIn, request: Request, user: User = Depends(import_user),
                        session: AsyncSession = Depends(get_session),
                        settings: Settings = Depends(get_settings)) -> dict:
    try:
        # With a yt-dlp proxy the proxy resolves the host remotely (the local resolver may be poisoned): syntax only.
        checked = await urlcheck.precheck(urlcheck.extract_link(body.url), resolve=not (settings.library_ytdlp_proxy or "").strip())
    except urlcheck.UrlRejected as e:
        logger.info("library import rejected user=%s reason=%s", user.id, e.reason)
        raise HTTPException(400, BAD_URL) from None
    try:
        await limits.admit_new_item(session, request.app, user.id)
    except LibraryError as e:
        logger.info("library import refused user=%s kind=%s", user.id, e.kind)
        raise http_error(e) from None
    try:
        item = await store.create_item(session, user_id=user.id, kind="video", source="link", status="queued",
                                       title=store.clean_title(body.title, fallback=""), source_url=checked.url,
                                       source_host=checked.source_host)
    except Exception:
        await limits.refund_new_item(session, request.app, user.id)
        raise
    request.app.state.library.wake()
    logger.info("library import queued user=%s item=%s", user.id, item.id)
    return store.item_out(item)
