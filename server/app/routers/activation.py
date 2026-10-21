"""词汇激活接口(plan L4 R17 / Task 11)。关时除 config 外 404 `Activation is off`。

URL 只有固定路径;查询参数只允许 state、page、offset(见 tests/test_activation_privacy.py)。
"""
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.activation import words
from app.activation.setup import require_activation
from app.core.deps import current_user, get_session
from app.models import User, utcnow

router = APIRouter(prefix="/api/activation")
TZ_MIN, TZ_MAX = -840, 840  # the same bounds as the wordbook's local-day offsets


@router.get("/config")
async def get_config(request: Request, user: User = Depends(current_user)):
    return {"enabled": bool(request.app.state.settings.activation_enabled)}


@router.get("/words")
async def get_words(state: Literal["dormant", "sprouting", "active"] = "dormant",
                    page: int = Query(0, ge=0, le=10000),
                    user: User = Depends(require_activation()),
                    session: AsyncSession = Depends(get_session)):
    return await words.list_words(session, user.id, state, page, utcnow())


@router.get("/prompt-hint")
async def get_prompt_hint(offset: int = Query(0, ge=TZ_MIN, le=TZ_MAX),
                          user: User = Depends(require_activation()),
                          session: AsyncSession = Depends(get_session)):
    return await words.prompt_hint(session, user.id, offset, utcnow())
