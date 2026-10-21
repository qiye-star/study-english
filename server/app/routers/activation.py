"""词汇激活接口(plan L4 R17 / Task 11)。关时除 config 外 404 `Activation is off`。"""
from fastapi import APIRouter, Depends, Request

from app.activation.setup import require_activation
from app.core.deps import current_user
from app.models import User

router = APIRouter(prefix="/api/activation")


@router.get("/config")
async def get_config(request: Request, user: User = Depends(current_user)):
    return {"enabled": bool(request.app.state.settings.activation_enabled)}


@router.get("/words")
async def get_words(user: User = Depends(require_activation())):
    # placeholder: the dormant / sprouting / active lists arrive with L4 Task 11
    return {"items": [], "next_page": None}
