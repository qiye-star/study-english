import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.core.config import Settings
from app.core.deps import get_settings, limited_user
from app.grammar import MAX_CONTEXT_CHARS, MAX_TEXT_CHARS, build_request, normalize_grammar, parse_model_output
from app.models import User
from app.core.upstream import check_upstream_auth

router = APIRouter(prefix="/api/ai")

# 语法检查是短输出,不沿用共享客户端的 120 s 读超时与大 max_tokens
GRAMMAR_TIMEOUT = httpx.Timeout(30.0, connect=10.0)
MAX_GRAMMAR_TOKENS = 1024


class GrammarIn(BaseModel):
    # 只读取这两个字段;请求里的其他字段(model、messages、prompt…)一律忽略,提示词只来自服务端
    text: str
    context: str | None = None


def effective_rules(request: Request, user: User) -> str:
    return user.grammar_prompt or request.app.state.grammar_rules


@router.post("/grammar")
async def check_grammar(
    payload: GrammarIn,
    request: Request,
    user: User = Depends(limited_user),
    settings: Settings = Depends(get_settings),
):
    base_url, key = settings.grammar_upstream
    if not base_url:
        raise HTTPException(503, "Grammar upstream is not configured")
    text = payload.text.strip()
    if not text:
        raise HTTPException(400, "Text is required")
    if len(text) > MAX_TEXT_CHARS:
        raise HTTPException(413, "Text is too long")
    context = (payload.context or "").strip()[-MAX_CONTEXT_CHARS:]
    body = build_request(settings.resolved_grammar_model, effective_rules(request, user), text, context, min(settings.llm_max_tokens, MAX_GRAMMAR_TOKENS))
    http: httpx.AsyncClient = request.app.state.http
    try:
        upstream = await http.post(
            base_url.rstrip("/") + "/chat/completions",
            json=body,
            timeout=GRAMMAR_TIMEOUT,
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        )
    except httpx.HTTPError:
        raise HTTPException(502, "Upstream unavailable")
    check_upstream_auth(upstream.status_code)
    if not upstream.is_success:
        raise HTTPException(502, "Upstream unavailable")
    try:
        return normalize_grammar(parse_model_output(upstream.json()), text)
    except ValueError:
        # 不把上游内容带进错误体
        raise HTTPException(502, "Upstream unavailable")
