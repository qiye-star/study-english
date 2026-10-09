import json

import anyio
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response, StreamingResponse
from starlette.background import BackgroundTask

from app.core import metering
from app.core.config import Settings
from app.core.deps import get_settings, limited_user
from app.models import User
from app.core.upstream import check_upstream_auth

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


USAGE_TAIL = 16 * 1024  # the stream's last bytes, where OpenAI-style upstreams put the usage chunk


def stream_tokens(tail: bytes) -> tuple[int, int] | None:
    """(prompt, completion) tokens from the last SSE `data:` event that carries a usage block (review m8)."""
    for line in reversed(tail.decode("utf-8", errors="ignore").splitlines()):
        line = line.strip()
        if not line.startswith("data:") or '"usage"' not in line:
            continue
        try:
            tokens = metering.tokens_of(json.loads(line[5:].strip()))
        except ValueError:
            continue
        if tokens:
            return tokens
    return None


def _record_completion(provider: str, model: str, upstream: httpx.Response, ms: int) -> None:
    """Numbers only: the usage block of the reply, or its size when the upstream sent none."""
    try:
        tokens = metering.tokens_of(upstream.json())
    except ValueError:
        tokens = None
    if tokens:
        metering.record("llm", provider, model, upstream.status_code, ms, units_in=tokens[0], units_out=tokens[1],
                        unit="tokens")
    else:
        metering.record("llm", provider, model, upstream.status_code, ms, units_out=len(upstream.content),
                        unit="bytes")


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
    provider, model = metering.provider_of(settings.upstream_llm_base_url), str(body["model"])
    timer = metering.Timer()

    try:
        if body.get("stream"):
            # ask for the final usage chunk so streamed chats get a cost estimate (the relay passes it through)
            if not isinstance(body.get("stream_options"), dict):
                body["stream_options"] = {"include_usage": True}
            upstream = await http.send(
                http.build_request("POST", url, json=body, headers=headers), stream=True
            )

            try:
                check_upstream_auth(upstream.status_code)
            except HTTPException:
                metering.record("llm", provider, model, upstream.status_code, timer.ms(), unit="bytes")
                await upstream.aclose()
                raise

            async def relay():
                status, sent, tail = upstream.status_code, 0, b""
                try:
                    async for chunk in upstream.aiter_bytes():
                        sent += len(chunk)
                        tail = (tail + chunk)[-USAGE_TAIL:]
                        yield chunk
                except httpx.HTTPError:
                    status = 0
                    yield b'data: {"error": "Upstream unavailable"}\n\n'
                finally:
                    tokens = stream_tokens(tail)
                    if tokens:
                        metering.record("llm", provider, model, status, timer.ms(), units_in=tokens[0],
                                        units_out=tokens[1], unit="tokens")
                    else:
                        metering.record("llm", provider, model, status, timer.ms(), units_out=sent, unit="bytes")
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
        metering.record("llm", provider, model, 0, timer.ms())
        raise HTTPException(502, "Upstream unavailable")

    _record_completion(provider, model, upstream, timer.ms())
    check_upstream_auth(upstream.status_code)

    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        media_type=upstream.headers.get("content-type", "application/json"),
    )
