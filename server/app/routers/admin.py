"""管理端 v1 只读 API:/api/admin/*。全部要求管理会话(Cookie)且角色 >= viewer;登录见 admin_auth.py。"""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import recordings
from app.admin import service
from app.admin.perms import require
from app.core.config import Settings
from app.core.deps import get_session, get_settings

router = APIRouter(prefix="/api/admin")
guarded = APIRouter(dependencies=[Depends(require("viewer"))])

ItemId = Annotated[str, Path(max_length=64)]
UserId = Annotated[int, Path(ge=1, le=2**31 - 1)]
Page = Annotated[int, Query(ge=1, le=10_000)]
PerPage = Annotated[int, Query(ge=1, le=50)]
Source = Annotated[Literal["all", "practice", "chat"], Query()]


def _found(value, what: str):
    if value is None:
        raise HTTPException(404, f"{what} not found")
    return value


@guarded.get("/overview")
async def overview(days: Annotated[int, Query(ge=1, le=90)] = 30, session: AsyncSession = Depends(get_session)):
    return await service.overview(session, days)


@guarded.get("/users")
async def users(
    q: Annotated[str, Query(max_length=64)] = "",
    page: Page = 1,
    per_page: PerPage = 20,
    session: AsyncSession = Depends(get_session),
):
    return await service.list_users(session, q, page, per_page)


@guarded.get("/users/{user_id}")
async def user_detail(user_id: UserId, session: AsyncSession = Depends(get_session)):
    return _found(await service.get_user(session, user_id), "User")


@guarded.get("/users/{user_id}/conversations")
async def user_conversations(
    user_id: UserId, page: Page = 1, per_page: PerPage = 20, session: AsyncSession = Depends(get_session)
):
    _found(await service.get_user(session, user_id), "User")
    return await service.list_conversations(session, user_id, page, per_page)


@guarded.get("/conversations/{conversation_id}/messages")
async def conversation_messages(conversation_id: ItemId, session: AsyncSession = Depends(get_session)):
    return _found(await service.conversation_messages(session, conversation_id), "Conversation")


@guarded.get("/users/{user_id}/assessments")
async def user_assessments(
    user_id: UserId,
    source: Source = "all",
    page: Page = 1,
    per_page: PerPage = 20,
    session: AsyncSession = Depends(get_session),
):
    _found(await service.get_user(session, user_id), "User")
    return await service.list_assessments(session, source, page, per_page, user_id=user_id)


@guarded.get("/assessments")
async def all_assessments(
    source: Source = "all", page: Page = 1, per_page: PerPage = 20, session: AsyncSession = Depends(get_session)
):
    return await service.list_assessments(session, source, page, per_page)


@guarded.get("/assessments/{assessment_id}")
async def assessment(assessment_id: ItemId, session: AsyncSession = Depends(get_session)):
    row = _found(await service.get_assessment_row(session, assessment_id), "Assessment")
    return service.assessment_detail(*row)


@guarded.get("/assessments/{assessment_id}/audio")
async def assessment_audio(
    assessment_id: ItemId,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    row, _ = _found(await service.get_assessment_row(session, assessment_id), "Assessment")
    try:
        path = recordings.absolute_path(settings.resolved_data_dir, row.audio_path)
    except ValueError:
        raise HTTPException(404, "Recording not found")
    if not path.is_file():
        raise HTTPException(404, "Recording not found")
    return FileResponse(path, media_type="audio/wav", headers={"Cache-Control": "private, no-store"})


@guarded.get("/users/{user_id}/practice-items")
async def user_practice_items(
    user_id: UserId, page: Page = 1, per_page: PerPage = 20, session: AsyncSession = Depends(get_session)
):
    _found(await service.get_user(session, user_id), "User")
    return await service.list_practice_items(session, user_id, page, per_page)


@guarded.get("/users/{user_id}/vocabulary")
async def user_vocabulary(
    user_id: UserId, page: Page = 1, per_page: PerPage = 20, session: AsyncSession = Depends(get_session)
):
    _found(await service.get_user(session, user_id), "User")
    return await service.list_vocabulary(session, user_id, page, per_page)


router.include_router(guarded)
