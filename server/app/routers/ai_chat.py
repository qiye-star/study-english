import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response, StreamingResponse

from app.config import Settings
from app.deps import current_user, get_settings
from app.models import User

router = APIRouter(prefix="/api/ai")


@router.post("/chat/completions")
async def chat_completions(
    request: Request,
    _: User = Depends(current_user),
    settings: Settings = Depends(get_settings),
):
    if not settings.upstream_llm_base_url:
        raise HTTPException(503, "LLM upstream is not configured")

    body = await request.json()
    if body.get("model") not in settings.llm_model_list:
        body["model"] = settings.default_llm_model

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

            async def relay():
                try:
                    async for chunk in upstream.aiter_bytes():
                        yield chunk
                finally:
                    await upstream.aclose()

            return StreamingResponse(
                relay(),
                status_code=upstream.status_code,
                media_type=upstream.headers.get("content-type", "text/event-stream"),
            )

        upstream = await http.post(url, json=body, headers=headers)
    except httpx.HTTPError:
        raise HTTPException(502, "Upstream unavailable")

    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        media_type=upstream.headers.get("content-type", "application/json"),
    )
