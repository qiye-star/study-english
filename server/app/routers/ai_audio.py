import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel

from app.azure import AzureError, AzureNotConfigured, AzureSpeech, get_azure
from app.config import Settings
from app.deps import get_settings, limited_user
from app.models import User
from app.upstream import check_upstream_auth

router = APIRouter(prefix="/api/ai")

MAX_TTS_INPUT = 4096
MAX_AUDIO_BYTES = 25 * 1024 * 1024


class SpeechIn(BaseModel):
    input: str
    model: str
    voice: str = "alloy"
    response_format: str | None = None


@router.post("/audio/speech")
async def speech(
    payload: SpeechIn,
    request: Request,
    _: User = Depends(limited_user),
    settings: Settings = Depends(get_settings),
    azure: AzureSpeech = Depends(get_azure),
):
    # 客户端会去掉 openai/ 前缀(发送裸 tts-1),这里还原后再校验。
    model = payload.model
    if "/" not in model and f"openai/{model}" in settings.tts_model_list:
        model = f"openai/{model}"
    if model not in settings.tts_model_list or not (
        model == "azure/speech" or model.startswith("openai/")
    ):
        raise HTTPException(400, f"Unsupported TTS model: {payload.model}")
    if len(payload.input) > MAX_TTS_INPUT:
        raise HTTPException(400, "Input is too long")
    try:
        payload.input.encode("utf-8")
    except UnicodeEncodeError:
        raise HTTPException(400, "Invalid input")

    if model == "azure/speech":
        try:
            audio = await azure.synthesize(payload.input, payload.voice)
        except ValueError:
            raise HTTPException(400, "Invalid voice")
        except AzureNotConfigured:
            raise HTTPException(503, "Azure Speech is not configured")
        except (AzureError, httpx.HTTPError):
            raise HTTPException(502, "Azure unavailable")
        return Response(content=audio, media_type="audio/mpeg")

    if not settings.upstream_tts_base_url:
        raise HTTPException(503, "TTS upstream is not configured")
    http: httpx.AsyncClient = request.app.state.http
    try:
        upstream = await http.post(
            settings.upstream_tts_base_url.rstrip("/") + "/audio/speech",
            json={
                "model": model.removeprefix("openai/"),
                "input": payload.input,
                "voice": payload.voice,
                "response_format": payload.response_format or "mp3",
            },
            headers={"Authorization": f"Bearer {settings.upstream_tts_key}"},
        )
    except httpx.HTTPError:
        raise HTTPException(502, "Upstream unavailable")
    check_upstream_auth(upstream.status_code)
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        media_type=upstream.headers.get("content-type", "audio/mpeg"),
    )


@router.post("/audio/transcriptions")
async def transcriptions(
    request: Request,
    _: User = Depends(limited_user),
    settings: Settings = Depends(get_settings),
):
    content_type = request.headers.get("content-type", "")
    if not content_type.lower().startswith("multipart/form-data"):
        raise HTTPException(400, "Expected multipart/form-data")
    if not settings.upstream_whisper_base_url:
        raise HTTPException(503, "Whisper upstream is not configured")

    too_large = HTTPException(413, "Audio file is too large")
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > MAX_AUDIO_BYTES:
        raise too_large
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_AUDIO_BYTES:
            raise too_large
        chunks.append(chunk)
    data = b"".join(chunks)

    http: httpx.AsyncClient = request.app.state.http
    try:
        upstream = await http.post(
            settings.upstream_whisper_base_url.rstrip("/") + "/audio/transcriptions",
            content=data,
            headers={
                "Authorization": f"Bearer {settings.upstream_whisper_key}",
                "Content-Type": content_type,
            },
            timeout=httpx.Timeout(300.0, connect=10.0),
        )
    except httpx.HTTPError:
        raise HTTPException(502, "Upstream unavailable")
    check_upstream_auth(upstream.status_code)
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        media_type=upstream.headers.get("content-type", "application/json"),
    )
