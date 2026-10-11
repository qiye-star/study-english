"""/api/admin/links:学习联动状态与熔断复位(learning links spec §9)。视图在 app/links/admin_view.py。"""
from fastapi import APIRouter, Depends, HTTPException, Path, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin import audit
from app.admin.perms import AdminContext, require
from app.core.deps import get_session
from app.links import admin_view, registry

router = APIRouter(prefix="/api/admin/links")


@router.get("")
async def links_view(request: Request, _: AdminContext = Depends(require("viewer")),
                     session: AsyncSession = Depends(get_session)):
    return await admin_view.view(request.app, session)


@router.post("/{key}/reset-breaker")
async def reset_breaker(request: Request, key: str = Path(min_length=1, max_length=24),
                        ctx: AdminContext = Depends(require("operator")),
                        session: AsyncSession = Depends(get_session)):
    if key not in registry.keys():
        raise HTTPException(404, "Unknown link")
    # 没有订阅(只有接口的联动)时通道里没有它的统计:复位等于无事可做,仍然留审计
    request.app.state.learning_bus.reset_breaker(key)
    await audit.record(session, ctx.actor, "links.breaker.reset", target_type="link", target_id=key, summary=key)
    await session.commit()
    return {"key": key, "state": "closed"}
