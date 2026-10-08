from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import current_user, get_session
from app.services.grammar import MAX_PROMPT_CHARS, clean_prompt
from app.models import User

router = APIRouter(prefix="/api/me")


class GrammarPromptIn(BaseModel):
    prompt: str = Field(max_length=MAX_PROMPT_CHARS)


def prompt_out(request: Request, user: User) -> dict:
    return {"prompt": user.grammar_prompt, "default_prompt": request.app.state.grammar_rules, "max_length": MAX_PROMPT_CHARS}


@router.get("/grammar-prompt")
async def get_grammar_prompt(request: Request, user: User = Depends(current_user)):
    return prompt_out(request, user)


@router.put("/grammar-prompt")
async def save_grammar_prompt(
    payload: GrammarPromptIn,
    request: Request,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    # current_user 与本路由共用同一个会话(FastAPI 依赖缓存),直接改 user 即可
    text = clean_prompt(payload.prompt)
    # 空串、或与当前默认规则完全一致 -> 存 NULL(跟随默认,运营方改默认后自动生效)
    if not text or text == clean_prompt(request.app.state.grammar_rules):
        text = None
    user.grammar_prompt = text
    await session.commit()
    return prompt_out(request, user)


@router.delete("/grammar-prompt")
async def reset_grammar_prompt(
    request: Request,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    user.grammar_prompt = None
    await session.commit()
    return prompt_out(request, user)
