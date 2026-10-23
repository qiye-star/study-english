"""精选库的用户接口 `/api/library/catalog*`(spec 2026-10-14-curated-library §9)。

先鉴权,再 `library_enabled`(404 Library is disabled),再 `library_catalog_enabled`(404 Built-in library is
disabled)。URL 里只有 uuid;日志只有 id。业务在 `app/library/catalog_store.py`。"""
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Path as PathParam, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import learning_events
from app.core.config import Settings
from app.core.deps import current_user, get_session, get_settings, limited_user
from app.core.learning_events import LibraryItemReady
from app.library import catalog_store, store
from app.library.errors import api_error
from app.models import User, utcnow
from app.storage import BlobNotFound, get_store
from app.storage.http import blob_response

router = APIRouter(prefix="/api/library/catalog")
logger = logging.getLogger(__name__)

NO_STORE = {"Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff"}
CatalogId = Annotated[str, PathParam(max_length=36)]


def require_catalog(_: User = Depends(current_user), settings: Settings = Depends(get_settings)) -> Settings:
    if not settings.library_enabled:
        raise api_error("disabled")
    if not settings.library_catalog_enabled:
        raise api_error("catalog_disabled")
    return settings


@router.get("")
async def list_catalog(user: User = Depends(current_user), _: Settings = Depends(require_catalog),
                       session: AsyncSession = Depends(get_session)):
    rows = await catalog_store.list_published(session, user.id)
    return {"items": [catalog_store.public_out(row, added) for row, added in rows]}


@router.post("/{catalog_id}/add")
async def add_catalog_item(request: Request, catalog_id: CatalogId, user: User = Depends(limited_user),
                           settings: Settings = Depends(require_catalog),
                           session: AsyncSession = Depends(get_session)):
    """Spec D6 / E8: copy into the user's library (idempotent). No quota, no daily import count (E7)."""
    try:
        item, created = await catalog_store.add_to_library(session, get_store(request.app), user_id=user.id,
                                                           catalog_id=catalog_id, now=utcnow())
    except LookupError:
        raise api_error("catalog_not_found") from None
    if created:  # plan L4 Task 9: the copy's sentences were committed by add_to_library; only a new copy is indexed
        learning_events.publish(LibraryItemReady(user_id=user.id, item_id=item.id))
    return {"item": store.item_out(item), "created": created}


@router.get("/{catalog_id}/poster")
async def catalog_poster(request: Request, catalog_id: CatalogId, _user: User = Depends(current_user),
                         settings: Settings = Depends(require_catalog), session: AsyncSession = Depends(get_session)):
    row = await catalog_store.get_published(session, catalog_id)
    if row is None or not row.poster_path:
        raise api_error("catalog_not_found")
    try:
        return await blob_response(get_store(request.app), row.poster_path, request, media_type="image/jpeg",
                                   headers=NO_STORE)
    except (BlobNotFound, ValueError):
        raise api_error("catalog_not_found") from None
