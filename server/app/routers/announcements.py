"""公开公告与维护状态(spec §9):无需登录,维护 `full` 下仍可访问,网页据此显示横幅或维护页。"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin import announcements
from app.core.deps import get_session

router = APIRouter(prefix="/api")


@router.get("/announcements")
async def public_announcements(request: Request, response: Response, session: AsyncSession = Depends(get_session)):
    rows = await announcements.active(session, datetime.now(timezone.utc))
    response.headers["Cache-Control"] = "public, max-age=60"
    return {"announcements": [announcements.announcement_out(a) for a in rows],
            "maintenance": announcements.maintenance_out(request.app.state.settings)}
