"""更新日志(用户侧,spec 2026-10-14-changelog-design §2.1):登录即可;内容是公开的发布说明,日志与错误里不记内容。

`GET /api/changelog?cursor=&limit=`:已发布条目(按 entry_date 倒序,每页 20),带 `unread`、`latest_id` 与逐条 `is_new`;
`POST /api/changelog/seen {upto_id}`:已读位置只前进、幂等。必须排在 `stubs` 之前。逻辑在 `app/admin/changelog.py`
(与公告同一做法:routers 可以导入 admin)。
"""
from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin import changelog
from app.core.deps import current_user, get_session
from app.models import User

router = APIRouter(prefix="/api/changelog")


class SeenIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    upto_id: int = Field(ge=1, le=2_147_483_647)


@router.get("")
async def list_changelog(cursor: str | None = Query(None, max_length=32),
                         limit: int = Query(changelog.PAGE_SIZE, ge=1, le=changelog.PAGE_SIZE),
                         user: User = Depends(current_user), session: AsyncSession = Depends(get_session)):
    try:
        return await changelog.public_page(session, user.id, cursor=cursor, limit=limit)
    except changelog.ChangelogError as e:
        return JSONResponse({"error": e.message}, status_code=e.status)


@router.post("/seen")
async def post_seen(body: SeenIn, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)):
    return await changelog.mark_seen(session, user.id, body.upto_id)
