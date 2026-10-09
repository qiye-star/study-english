"""用量与估算费用(viewer,spec §8.2)。只读,不写审计。"""
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin import usage
from app.admin.perms import require
from app.core.deps import get_session

router = APIRouter(prefix="/api/admin")


def _days(days: int) -> int:
    if days not in usage.DAYS:
        raise HTTPException(422, "days must be one of 1, 7, 30, 90")
    return days


@router.get("/usage/summary", dependencies=[Depends(require("viewer"))])
async def usage_summary(request: Request, days: int = 7, session: AsyncSession = Depends(get_session)):
    return await usage.summary(session, request.app.state.settings, _days(days), datetime.now(timezone.utc))


@router.get("/usage/top-users", dependencies=[Depends(require("viewer"))])
async def usage_top_users(request: Request, days: int = 7, by: Literal["cost", "calls"] = "cost",
                          limit: int = Query(10, ge=1, le=50), session: AsyncSession = Depends(get_session)):
    items = await usage.top_users(session, request.app.state.settings, _days(days), by, limit,
                                  datetime.now(timezone.utc))
    return {"items": items}


@router.get("/usage/health", dependencies=[Depends(require("viewer"))])
async def usage_health(session: AsyncSession = Depends(get_session)):
    return {"items": await usage.health(session, datetime.now(timezone.utc))}
