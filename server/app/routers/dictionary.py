"""本地词典查询(spec 2026-10-13-defs-default-lookup-ios §3.2):`POST /api/dictionary/lookup`。

单词只在请求体里,不进 URL、不进日志(这里与 app/wordbook/lookup.py 都没有日志调用,校验错误也只回字段名)。
需要登录;限流与 AI 路由共用每用户每分钟桶(`limited_user`,管理端的 `ai_rate_limit_per_minute` 与按用户覆盖同样适用)。
不受 WORDBOOK_ENABLED 控制:词典文件随镜像提供,选词查词不依赖背单词功能。无迁移、不写库。
命中返回 `{hit: true, word, lemma?, phonetic?, defs_zh, defs_en, phrases?, source: "dict", def_lang}`,未命中只回 `{hit: false}`。"""
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_session, limited_user
from app.models import User
from app.wordbook import service
from app.wordbook.lookup import lookup_service

router = APIRouter(prefix="/api/dictionary")


class LookupIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=1000)  # 网页最多发 1000 个字符;太长的由 lookup 直接判未命中


@router.post("/lookup")
async def dictionary_lookup(payload: LookupIn, request: Request, user: User = Depends(limited_user),
                            session: AsyncSession = Depends(get_session)):
    found = await lookup_service(request.app).lookup(payload.text)
    if found is None:
        return {"hit": False}
    return {**found, "def_lang": await service.def_lang_of(session, user.id)}
