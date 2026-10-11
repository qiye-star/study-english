"""智能体记忆 REST(spec 2026-10-12-agents §4.5、§8.4;计划 A2 R-M2):只有本人可读写;管理员只看计数
(app.agents.memory.store.memory_counts,由 A1 的管理端调用)。

日志、错误、URL 里永不出现记忆文本或档案值:路径里只有记忆 / 回顾 id,查询串只有 kind、persona_id、cursor、limit。
用户的每个写操作都作废该用户的提示词快照(R-M5)。"""
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents import personas
from app.agents import settings as agent_settings
from app.agents.memory.profile import PROFILE_KEYS, ProfileError
from app.agents.memory.store import MemoryNotFound, ProfileState
from app.core.deps import current_user, get_session
from app.models import AgentMemoryItem, AgentPersona, AgentRecap, User, iso_utc

router = APIRouter(prefix="/api/agents/memory")
ItemId = Annotated[str, Path(max_length=64)]
Kind = Literal["fact", "preference", "goal", "weakness", "progress"]
EXPORT_HEADERS = {"Content-Disposition": 'attachment; filename="agent-memory.json"', "Cache-Control": "no-store"}


async def memory_user(request: Request, user: User = Depends(current_user)) -> User:
    if not request.app.state.settings.agents_enabled:
        raise HTTPException(404, "Agents are disabled")
    return user


def _runtime(request: Request):
    return request.app.state.agent_memory


async def _names(session: AsyncSession, user_id: int) -> dict[str, str]:
    """角色 id → 名字(内置 + 我的);已删除的角色不在其中(R-M14)。"""
    names = {p.id: p.name for p in personas.builtin_personas()}
    rows = (await session.execute(select(AgentPersona.id, AgentPersona.name)
                                  .where(AgentPersona.owner_id == user_id))).all()
    names.update({pid: name for pid, name in rows})
    return names


def _persona(persona_id: str | None, names: dict[str, str]) -> dict | None:
    return None if persona_id is None else {"id": persona_id, "name": names.get(persona_id)}


def item_out(row: AgentMemoryItem, names: dict[str, str]) -> dict:
    return {"id": row.id, "kind": row.kind, "text": row.text, "importance": row.importance, "pinned": row.pinned,
            "persona": _persona(row.persona_id, names), "source": row.source,
            "created_at": iso_utc(row.created_at), "updated_at": iso_utc(row.updated_at)}


def recap_out(row: AgentRecap, names: dict[str, str]) -> dict:
    return {"id": row.id, "source": row.source, "persona": _persona(row.persona_id, names),
            "conversation_id": row.conversation_id, "text": row.text, "created_at": iso_utc(row.created_at)}


async def _profile_out(request: Request, session: AsyncSession, user_id: int, state: ProfileState) -> dict:
    prefs = await agent_settings.load(session, user_id)
    return {"profile": state.data, "edited_keys": state.edited_keys, "proposals": state.proposals,
            "memory_enabled": bool(prefs.memory_enabled),
            "memory_available": bool(request.app.state.settings.agents_memory_enabled)}


class ProfilePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    values: dict[str, Any] = Field(default_factory=dict)
    dismiss: list[str] = Field(default_factory=list, max_length=len(PROFILE_KEYS))


class PinIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pinned: bool


class ClearIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    confirm: bool = False
    scope: Literal["all", "persona"]
    persona_id: str | None = Field(default=None, min_length=1, max_length=64)


@router.get("/profile")
async def get_profile(request: Request, user: User = Depends(memory_user),
                      session: AsyncSession = Depends(get_session)):
    return await _profile_out(request, session, user.id, await _runtime(request).store.profile(user.id))


@router.patch("/profile")
async def patch_profile(payload: ProfilePatch, request: Request, user: User = Depends(memory_user),
                        session: AsyncSession = Depends(get_session)):
    if not payload.values and not payload.dismiss:
        raise HTTPException(400, "Nothing to update")
    if len(payload.values) > len(PROFILE_KEYS):
        raise HTTPException(422, "Invalid profile value")
    rt = _runtime(request)
    try:
        state = await rt.store.patch_profile(user.id, payload.values, payload.dismiss)
    except ProfileError:
        raise HTTPException(422, "Invalid profile value") from None
    rt.cache.invalidate_user(user.id)
    return await _profile_out(request, session, user.id, state)


@router.get("/items")
async def list_items(request: Request, kind: Kind | None = Query(None),
                     persona_id: str | None = Query(None, max_length=64),
                     cursor: str | None = Query(None, max_length=6), limit: int = Query(30, ge=1, le=50),
                     user: User = Depends(memory_user), session: AsyncSession = Depends(get_session)):
    rt = _runtime(request)
    try:
        rows, next_cursor = await rt.store.items(user.id, kind, persona_id, cursor, limit)
    except ValueError:
        raise HTTPException(400, "Invalid cursor") from None
    names = await _names(session, user.id)
    counts = await rt.store.persona_counts(user.id)
    return {"items": [item_out(r, names) for r in rows], "next_cursor": next_cursor,
            "persona_counts": [{"persona": _persona(pid, names), "count": n} for pid, n in counts]}


@router.delete("/items/{item_id}")
async def delete_item(item_id: ItemId, request: Request, user: User = Depends(memory_user)):
    rt = _runtime(request)
    if not await rt.store.delete(user.id, item_id, by_user=True):
        raise HTTPException(404, "Memory not found")
    rt.cache.invalidate_user(user.id)
    return {"id": item_id}


@router.post("/items/{item_id}/pin")
async def pin_item(item_id: ItemId, payload: PinIn, request: Request, user: User = Depends(memory_user),
                   session: AsyncSession = Depends(get_session)):
    rt = _runtime(request)
    try:
        row = await rt.store.pin(user.id, item_id, payload.pinned)
    except MemoryNotFound:
        raise HTTPException(404, "Memory not found") from None
    rt.cache.invalidate_user(user.id)
    return item_out(row, await _names(session, user.id))


@router.get("/recaps")
async def list_recaps(request: Request, cursor: str | None = Query(None, max_length=6),
                      limit: int = Query(20, ge=1, le=50), user: User = Depends(memory_user),
                      session: AsyncSession = Depends(get_session)):
    try:
        rows, next_cursor = await _runtime(request).store.recaps(user.id, cursor, limit)
    except ValueError:
        raise HTTPException(400, "Invalid cursor") from None
    names = await _names(session, user.id)
    return {"recaps": [recap_out(r, names) for r in rows], "next_cursor": next_cursor}


@router.delete("/recaps/{recap_id}")
async def delete_recap(recap_id: ItemId, request: Request, user: User = Depends(memory_user)):
    if not await _runtime(request).store.delete_recap(user.id, recap_id):
        raise HTTPException(404, "Recap not found")
    return {"id": recap_id}


@router.get("/export")
async def export_memory(request: Request, user: User = Depends(memory_user)):
    return JSONResponse(await _runtime(request).store.export(user.id), headers=EXPORT_HEADERS)


@router.delete("")
async def clear_memory(payload: ClearIn, request: Request, user: User = Depends(memory_user)):
    if payload.confirm is not True:
        raise HTTPException(400, "Confirmation required")
    if payload.scope == "persona" and not payload.persona_id:
        raise HTTPException(422, "persona_id is required")
    rt = _runtime(request)
    deleted = await rt.store.clear(user.id, payload.scope, payload.persona_id if payload.scope == "persona" else None)
    rt.cache.invalidate_user(user.id)
    return {"scope": payload.scope, "deleted": deleted}
