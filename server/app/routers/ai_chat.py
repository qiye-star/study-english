import anyio
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response, StreamingResponse
from starlette.background import BackgroundTask

from app.config import Settings
from app.deps import get_settings, limited_user
from app.models import User
from app.upstream import check_upstream_auth

router = APIRouter(prefix="/api/ai")

MAX_N = 4


def _clamp(body: dict, field: str, cap: int) -> None:
    if field not in body or body[field] is None:
        return
    value = body[field]
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise HTTPException(400, f"Invalid {field}")
    if value > cap:
        body[field] = cap


@router.post("/chat/completions")
async def chat_completions(
    request: Request,
    _: User = Depends(limited_user),
    settings: Settings = Depends(get_settings),
):
    if not settings.upstream_llm_base_url:
        raise HTTPException(503, "LLM upstream is not configured")

    try:
        body = await request.json()
    except ValueError:
        raise HTTPException(400, "Invalid JSON body")

    if not isinstance(body, dict):
        raise HTTPException(400, "Invalid JSON body")

    if body.get("model") not in settings.llm_model_list:
        body["model"] = settings.default_llm_model

    _clamp(body, "n", MAX_N)
    _clamp(body, "max_tokens", settings.llm_max_tokens)
    _clamp(body, "max_completion_tokens", settings.llm_max_tokens)

    url = settings.upstream_llm_base_url.rstrip("/") + "/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.upstream_llm_key}",
        "Content-Type": "application/json",
    }
    http: httpx.AsyncClient = request.app.state.http

    try:
        if body.get("stream"):
            upstream = await http.send(
                http.build_request("POST", url, json=body, headers=headers), stream=True
            )

            try:
                check_upstream_auth(upstream.status_code)
            except HTTPException:
                await upstream.aclose()
                raise

            async def relay():
                try:
                    async for chunk in upstream.aiter_bytes():
                        yield chunk
                except httpx.HTTPError:
                    yield b'data: {"error": "Upstream unavailable"}\n\n'
                finally:
                    with anyio.CancelScope(shield=True):
                        await upstream.aclose()

            try:
                return StreamingResponse(
                    relay(),
                    status_code=upstream.status_code,
                    media_type=upstream.headers.get("content-type", "text/event-stream"),
                    headers={
                        "Cache-Control": "no-cache",
                        "X-Accel-Buffering": "no",
                    },
                    background=BackgroundTask(upstream.aclose),
                )
            except Exception:
                await upstream.aclose()
                raise

        upstream = await http.post(url, json=body, headers=headers)
    except httpx.HTTPError:
        raise HTTPException(502, "Upstream unavailable")

    check_upstream_auth(upstream.status_code)

    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        media_type=upstream.headers.get("content-type", "application/json"),
    )
