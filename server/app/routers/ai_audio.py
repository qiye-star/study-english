import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel

from app.azure import AzureError, AzureNotConfigured, AzureSpeech, get_azure
from app.config import Settings
from app.deps import current_user, get_settings
from app.models import User

router = APIRouter(prefix="/api/ai")

MAX_TTS_INPUT = 4096


class SpeechIn(BaseModel):
    input: str
    model: str
    voice: str = "alloy"
    response_format: str | None = None


@router.post("/audio/speech")
async def speech(
    payload: SpeechIn,
    request: Request,
    _: User = Depends(current_user),
    settings: Settings = Depends(get_settings),
    azure: AzureSpeech = Depends(get_azure),
):
    if payload.model not in settings.tts_model_list:
        raise HTTPException(400, f"Unsupported TTS model: {payload.model}")
    if len(payload.input) > MAX_TTS_INPUT:
        raise HTTPException(400, "Input is too long")

    if payload.model == "azure/speech":
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
                "model": payload.model.removeprefix("openai/"),
                "input": payload.input,
                "voice": payload.voice,
                "response_format": payload.response_format or "mp3",
            },
            headers={"Authorization": f"Bearer {settings.upstream_tts_key}"},
        )
    except httpx.HTTPError:
        raise HTTPException(502, "Upstream unavailable")
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        media_type=upstream.headers.get("content-type", "audio/mpeg"),
    )


@router.post("/audio/transcriptions")
async def transcriptions(
    request: Request,
    _: User = Depends(current_user),
    settings: Settings = Depends(get_settings),
):
    content_type = request.headers.get("content-type", "")
    if not content_type.startswith("multipart/form-data"):
        raise HTTPException(400, "Expected multipart/form-data")
    if not settings.upstream_whisper_base_url:
        raise HTTPException(503, "Whisper upstream is not configured")

    http: httpx.AsyncClient = request.app.state.http
    try:
        upstream = await http.post(
            settings.upstream_whisper_base_url.rstrip("/") + "/audio/transcriptions",
            content=await request.body(),
            headers={
                "Authorization": f"Bearer {settings.upstream_whisper_key}",
                "Content-Type": content_type,
            },
        )
    except httpx.HTTPError:
        raise HTTPException(502, "Upstream unavailable")
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        media_type=upstream.headers.get("content-type", "application/json"),
    )
