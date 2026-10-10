"""背单词接口(设计文档 2026-10-10-wordbook §7)。业务在 app/wordbook/;F3 只有开关与 /config,S 车道扩展。

WORDBOOK_ENABLED=false 时只有 GET /config 回答 {"enabled": false},其余端点经 require_wordbook 返回
404 {"error": "Wordbook is disabled"}。"""
from fastapi import APIRouter, Depends, HTTPException

from app.core.config import Settings
from app.core.deps import current_user, get_settings
from app.models import User
from app.wordbook.service import config_out

router = APIRouter(prefix="/api/wordbook")
DISABLED = "Wordbook is disabled"


def require_wordbook(settings: Settings = Depends(get_settings)) -> Settings:
    if not settings.wordbook_enabled:
        raise HTTPException(404, DISABLED)
    return settings


@router.get("/config")
async def wordbook_config(_: User = Depends(current_user), settings: Settings = Depends(get_settings)):
    if not settings.wordbook_enabled:
        return {"enabled": False}
    return config_out(settings)
