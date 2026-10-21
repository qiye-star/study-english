"""影视配音接口 `/api/dubbing/*`(plan 2026-10-21-l5-dubbing S7–S9,R4、R6–R10)。

全部要求登录(未登录 401 先于开关检查);`DUBBING_ENABLED` 关或跟读库不可用时,除 `GET /config` 外返回 404
`Dubbing is disabled`(与 `routers/library.py` 的 `require_library` 同一写法)。管理端角色接口在 `admin_dubbing.py`,不受此开关影响。
URL 里只有 uuid 与整数序号;查询参数为空;错误文本是固定英文(`app/dubbing/errors.py`)。
建议与写入创建的读写走 `limited_user`(每分钟限流);角色的读写走 `current_user`。
日志只有条目 id、句数与失败种类;句子、角色名、模型回复一律不记。
"""
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Path as PathParam, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.deps import current_user, get_session, get_settings, limited_user
from app.dubbing import clip, scoring, takes
from app.dubbing.errors import api_error
from app.library import roles as library_roles
from app.library import roles_ai, store
from app.library.ai import AiUnavailable
from app.models import LibraryItem, User, utcnow

router = APIRouter(prefix="/api/dubbing")
logger = logging.getLogger(__name__)
ItemId = Annotated[str, PathParam(max_length=36)]


def require_dubbing(_: User = Depends(current_user), settings: Settings = Depends(get_settings)) -> Settings:
    """R8: the feature switch and the library (media tools) must be on; otherwise 404 after authentication."""
    if not (settings.dubbing_enabled and settings.library_available):
        raise api_error("disabled")
    return settings


def require_suggest(settings: Settings = Depends(require_dubbing)) -> Settings:
    """R7: suggestions need the library's AI switch and a configured model, otherwise 404 (as `/translate` does)."""
    if not settings.library_ai_available:
        raise api_error("not_found")
    return settings


async def owned(session: AsyncSession, user: User, item_id: str) -> LibraryItem:
    item = await store.get_owned(session, user.id, item_id)
    if item is None:
        raise api_error("not_found")
    return item


def ready(item: LibraryItem) -> None:
    if item.status != "ready":
        raise api_error("not_ready")


def roles_of(item: LibraryItem, segs: list) -> dict:
    """R4: a catalog copy is read-only for the learner; the catalog's editors set its roles."""
    copy = item.catalog_id is not None
    return library_roles.roles_out(item.role_names, segs, editable=not copy, locked="catalog" if copy else None)


class SpeakerIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    idx: int
    speaker: str | None = None


class RolesIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    names: dict[str, str | None] = Field(default_factory=dict)
    speakers: list[SpeakerIn] = Field(default_factory=list)


class ClipIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    seg_from: int
    seg_to: int


def limits_out(settings: Settings) -> dict:
    """The placeholder limits the web shows as hints; the server enforces them (R6, R11)."""
    return {"max_lines": clip.MAX_LINES, "max_ms": clip.MAX_MS, "window_before_ms": clip.WINDOW_BEFORE_MS,
            "window_after_ms": clip.WINDOW_AFTER_MS, "sync_tolerance_ms": scoring.SYNC_TOLERANCE_MS,
            "weights": {"pronunciation": round(scoring.W_PRON * 100), "fluency": round(scoring.W_FLUENCY * 100),
                        "sync": round(scoring.W_SYNC * 100)},
            "max_roles": clip.MAX_ROLES}


@router.get("/config")
async def config(user: User = Depends(current_user), settings: Settings = Depends(get_settings)) -> dict:
    enabled = settings.dubbing_enabled and settings.library_available
    return {"enabled": enabled, "suggest": enabled and settings.library_ai_available, "limits": limits_out(settings)}


@router.get("/items/{item_id}/roles")
async def get_roles(item_id: ItemId, settings: Settings = Depends(require_dubbing),
                    user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict:
    item = await owned(session, user, item_id)
    ready(item)
    return roles_of(item, await store.segments_of(session, item.id))


@router.put("/items/{item_id}/roles")
async def put_roles(item_id: ItemId, payload: RolesIn, settings: Settings = Depends(require_dubbing),
                    user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict:
    item = await owned(session, user, item_id)
    ready(item)
    if item.catalog_id is not None:
        raise api_error("roles_locked")
    try:
        await library_roles.apply(session, item, names=payload.names,
                                  speakers=[entry.model_dump() for entry in payload.speakers])
    except ValueError:
        await session.rollback()
        raise api_error("bad_roles") from None
    await session.commit()
    logger.info("dubbing roles saved item=%s speakers=%d", item.id, len(payload.speakers))
    return roles_of(item, await store.segments_of(session, item.id))


@router.post("/items/{item_id}/roles/suggest")
async def suggest_roles(item_id: ItemId, payload: ClipIn, request: Request,
                        settings: Settings = Depends(require_suggest), user: User = Depends(limited_user),
                        session: AsyncSession = Depends(get_session)) -> dict:
    """R7: one clip per call; returns suggestions only. The learner saves them with PUT after confirming."""
    item = await owned(session, user, item_id)
    ready(item)
    if item.catalog_id is not None:
        raise api_error("roles_locked")
    segs = await store.segments_of(session, item.id)
    problem = clip.check_span(segs, payload.seg_from, payload.seg_to)
    if problem is not None:
        raise api_error(problem)
    chosen = segs[payload.seg_from:payload.seg_to + 1]
    try:
        out = await roles_ai.suggest(session, request.app.state.http, settings, user_id=user.id, item_id=item.id,
                                     segments=chosen, now=utcnow())
    except AiUnavailable as e:
        await session.commit()  # the refund inside roles_ai belongs to this transaction
        codes = {"user_cap": "ai_user_cap", "global_cap": "ai_global_cap"}
        raise api_error(codes.get(e.kind, "ai_unavailable")) from None
    await session.commit()
    return {"speakers": [{"idx": idx, "speaker": letter} for idx, letter in sorted(out.items())]}


class TakeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    seg_from: int
    seg_to: int
    role: str


async def take_payload(session: AsyncSession, take) -> dict:
    segs = await store.segments_of(session, take.item_id)
    return takes.take_out(take, takes.expected_lines(segs, take), await takes.stale_lines(session, take, segs))


@router.post("/items/{item_id}/takes", status_code=201)
async def create_take(item_id: ItemId, payload: TakeIn, settings: Settings = Depends(require_dubbing),
                      user: User = Depends(limited_user), session: AsyncSession = Depends(get_session)) -> dict:
    """R6/R10: one take per run of the clip; `role` is the letter the learner plays (case-insensitive)."""
    item = await owned(session, user, item_id)
    role = library_roles.clean_role(payload.role) or ""
    take = await takes.create(session, item, user_id=user.id, seg_from=payload.seg_from, seg_to=payload.seg_to,
                              role=role, now=utcnow())
    await session.commit()
    logger.info("dubbing take created item=%s", item.id)
    return {"take": await take_payload(session, take)}


@router.get("/items/{item_id}/takes")
async def list_takes(item_id: ItemId, settings: Settings = Depends(require_dubbing),
                     user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict:
    item = await owned(session, user, item_id)
    rows = await takes.list_for_item(session, user.id, item.id)
    return {"takes": [await take_payload(session, take) for take in rows]}


@router.get("/takes/{dub_id}")
async def get_take(dub_id: ItemId, settings: Settings = Depends(require_dubbing),
                   user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict:
    take = await takes.get_owned(session, user.id, dub_id)
    if take is None:
        raise api_error("not_found")
    return {"take": await take_payload(session, take)}


@router.delete("/takes/{dub_id}", status_code=204)
async def delete_take(dub_id: ItemId, settings: Settings = Depends(require_dubbing),
                      user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> Response:
    take = await takes.get_owned(session, user.id, dub_id)
    if take is None:
        raise api_error("not_found")
    await takes.remove(session, take)
    await session.commit()
    return Response(status_code=204)
