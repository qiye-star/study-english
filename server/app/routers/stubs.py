import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException

from app.deps import current_user
from app.models import User

router = APIRouter(prefix="/api")


@router.post("/lookups")
async def create_lookup(payload: dict = Body(default_factory=dict), _: User = Depends(current_user)):
    now = datetime.now(timezone.utc).isoformat()
    return {
        "id": uuid.uuid4().hex,
        "word": payload.get("word", ""),
        "context": payload.get("context", ""),
        "context_translation": None,
        "status": "pending",
        "meaning": None,
        "meaning_options": [],
        "created_at": now,
        "updated_at": now,
    }


@router.put("/lookups/{lookup_id}")
async def update_lookup(lookup_id: str, _: User = Depends(current_user)):
    return {}


@router.get("/translations")
async def list_translations(_: User = Depends(current_user)):
    return {"translations": [], "page": 1, "next": None, "last": 1}


@router.post("/translations")
async def create_translation(_: User = Depends(current_user)):
    return {}


# 兜底(必须保证本模块最后注册,真实路由才不会被遮住):
# 1) 客户端的同步类写入(录音、笔记、发音评测等)鉴权后收下即丢;
# 2) 未知的 GET 明确返回 404。若没有这条,Starlette 会因「路径匹配但方法不匹配」返回 405。
@router.api_route("/{path:path}", methods=["POST", "PUT", "DELETE"])
async def accept_and_discard(path: str, _: User = Depends(current_user)):
    return {}


@router.get("/{path:path}")
async def unknown_get(path: str):
    raise HTTPException(404, "Not Found")
