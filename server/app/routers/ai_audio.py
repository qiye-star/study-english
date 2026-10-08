import base64
import logging
import re
import time

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel
from starlette.datastructures import UploadFile

from app.speech.asr_stream import SAMPLE_RATE, AsrGate, AsrStreamError, transcribe_pcm, wav_to_pcm
from app.providers.azure import AzureError, AzureNotConfigured, AzureSpeech
from app.core.config import Settings
from app.core.deps import get_settings, limited_user
from app.models import User
from app.speech.stt import CHAT_PROMPT, transcribe_chat  # noqa: F401 (CHAT_PROMPT for older importers)
from app.core.timing import Stopwatch, log_timing
from app.provider_clients import get_azure
from app.core.upstream import check_upstream_auth
from app.providers.volcengine import VolcengineError, synthesize as volcengine_synthesize, synthesize_stream
from app.uploads import parse_buffered_form, read_limited_body

router = APIRouter(prefix="/api/ai")
logger = logging.getLogger(__name__)

MAX_TTS_INPUT = 4096
VOLCENGINE_RESOURCES = {"seed-tts-2.0"}
VOLCENGINE_VOICE = re.compile(r"^[A-Za-z0-9_-]{3,100}$")
MAX_AUDIO_BYTES = 25 * 1024 * 1024
# Raw audio cap for chat mode: base64 is 4/3 larger, so 18 MB -> 24 MB, under
# the upstream's 25 MB limit whether that means MB or MiB.
MAX_CHAT_AUDIO_BYTES = 18_000_000
MULTIPART_OVERHEAD = 64 * 1024


class SpeechIn(BaseModel):
    input: str
    model: str
    voice: str = "alloy"
    response_format: str | None = None
    stream: bool = False


@router.post("/audio/speech")
async def speech(
    payload: SpeechIn,
    request: Request,
    user: User = Depends(limited_user),
    settings: Settings = Depends(get_settings),
    azure: AzureSpeech = Depends(get_azure),
):
    # 客户端会去掉 openai/ 前缀(发送裸 tts-1),这里还原后再校验。
    model = payload.model
    if "/" not in model and f"openai/{model}" in settings.tts_model_list:
        model = f"openai/{model}"
    is_volcengine = model.startswith("volcengine/") and (
        model.removeprefix("volcengine/") in VOLCENGINE_RESOURCES
    )
    if model not in settings.tts_model_list or not (
        model == "azure/speech" or model.startswith("openai/") or is_volcengine
    ):
        raise HTTPException(400, f"Unsupported TTS model: {payload.model}")
    if len(payload.input) > MAX_TTS_INPUT:
        raise HTTPException(400, "Input is too long")
    try:
        payload.input.encode("utf-8")
    except UnicodeEncodeError:
        raise HTTPException(400, "Invalid input")

    if is_volcengine:
        if not VOLCENGINE_VOICE.fullmatch(payload.voice):
            raise HTTPException(400, "Invalid voice")
        if not settings.volcengine_tts_key:
            raise HTTPException(503, "Volcengine TTS is not configured")
        chars = len(payload.input)
        if payload.stream:
            watch = Stopwatch()
            chunks = synthesize_stream(
                request.app.state.http,
                settings.volcengine_tts_url,
                settings.volcengine_tts_key,
                model.removeprefix("volcengine/"),
                payload.input,
                payload.voice,
                str(user.id),
            )
            try:
                first = await anext(chunks)
            except VolcengineError as e:
                await chunks.aclose()
                log_timing("tts_volcengine", ms=watch.ms(), chars=chars, stream=True, status=0)
                raise HTTPException(
                    502, "Upstream authentication failed" if e.kind == "auth" else "Upstream unavailable"
                )
            except BaseException:
                await chunks.aclose()
                raise
            log_timing("tts_volcengine_first_chunk", ms=watch.ms(), chars=chars)

            async def body():
                status = 200
                try:
                    yield first
                    async for chunk in chunks:
                        yield chunk
                except VolcengineError:
                    status = 0
                    logger.warning("Volcengine TTS stream truncated")
                finally:
                    # Also runs when the client disconnects (generator closed/cancelled),
                    # which closes the upstream httpx response.
                    await chunks.aclose()
                    log_timing("tts_volcengine", ms=watch.ms(), chars=chars, stream=True, status=status)

            return StreamingResponse(
                body(), media_type="audio/mpeg",
                headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
            )
        watch = Stopwatch()
        try:
            audio = await volcengine_synthesize(
                request.app.state.http,
                settings.volcengine_tts_url,
                settings.volcengine_tts_key,
                model.removeprefix("volcengine/"),
                payload.input,
                payload.voice,
                str(user.id),
            )
        except VolcengineError as e:
            log_timing("tts_volcengine", ms=watch.ms(), chars=chars, stream=False, status=0)
            if e.kind == "auth":
                raise HTTPException(502, "Upstream authentication failed")
            raise HTTPException(502, "Upstream unavailable")
        log_timing("tts_volcengine", ms=watch.ms(), chars=chars, stream=False, status=200)
        return Response(content=audio, media_type="audio/mpeg")

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
    if settings.upstream_asr_mode == "volc_stream":
        return await _stream_transcription(request, settings, content_type, str(_.id))
    if settings.upstream_whisper_mode == "chat":
        return await _chat_transcription(request, settings)
    if not settings.upstream_whisper_base_url:
        raise HTTPException(503, "Whisper upstream is not configured")
    data = await read_limited_body(request, MAX_AUDIO_BYTES)
    return await _openai_transcription(request, settings, content_type, data)


async def _openai_transcription(
    request: Request, settings: Settings, content_type: str, data: bytes
) -> Response:
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


def _fallback_configured(settings: Settings) -> bool:
    if not settings.upstream_whisper_base_url:
        return False
    return settings.upstream_whisper_mode != "chat" or bool(settings.upstream_whisper_model)


async def _read_audio_form(request: Request, limit: int) -> tuple[bytes, object, object, bytes]:
    body = await read_limited_body(request, limit)
    form = await parse_buffered_form(request, body)
    try:
        upload = form.get("file")
        language = form.get("language")
        response_format = form.get("response_format")
        if not isinstance(upload, UploadFile):
            raise HTTPException(400, "Audio file is required")
        audio = await upload.read()
    finally:
        await form.close()
    return audio, language, response_format, body


def _asr_gate(request: Request, settings: Settings) -> AsrGate:
    state = request.app.state
    if not hasattr(state, "asr_gate"):
        state.asr_gate = AsrGate(settings.asr_stream_max_concurrency)
    return state.asr_gate


def _streamable_format(settings: Settings, response_format: object) -> bool:
    """The stream returns {text, segments: []}. That matches chat mode for any format,
    but openai mode must keep Whisper's verbose_json / text / srt / vtt responses."""
    if settings.upstream_whisper_mode == "chat":
        return True
    return response_format is None or response_format in ("", "json")


async def _stream_transcription(
    request: Request, settings: Settings, content_type: str, uid: str
) -> Response:
    """Volcengine streaming ASR first; on any failure fall back to the configured
    UPSTREAM_WHISPER_MODE path. Logs carry failure class, ids and timings only."""
    audio, language, response_format, body = await _read_audio_form(request, MAX_AUDIO_BYTES)
    pcm = wav_to_pcm(audio) if _streamable_format(settings, response_format) else None
    if pcm is not None:
        audio_s = len(pcm) / (SAMPLE_RATE * 2)
        fallback = _fallback_configured(settings)
        gate = _asr_gate(request, settings)
        skip = await gate.try_enter()
        if skip is not None:
            logger.warning(
                "asr volc_stream skipped reason=%s audio_s=%.2f fallback=%s", skip, audio_s, fallback
            )
            if not fallback:
                raise HTTPException(502, "Upstream unavailable")
        else:
            started = time.perf_counter()
            kind = None
            try:
                text = await transcribe_pcm(settings, pcm, uid)
            except AsrStreamError as e:
                kind = e.kind
                log_timing("stt_volc_stream", ms=round((time.perf_counter() - started) * 1000),
                           audio_bytes=len(pcm), status=0)
                logger.warning(
                    "asr volc_stream failed kind=%s detail=%s ms=%.0f audio_s=%.2f fallback=%s"
                    " connect_id=%s logid=%s",
                    e.kind, e.detail, (time.perf_counter() - started) * 1000, audio_s, fallback,
                    e.connect_id, e.logid,
                )
                if not fallback:
                    if e.kind == "not_configured":
                        raise HTTPException(503, "Whisper upstream is not configured")
                    if e.kind == "auth":
                        raise HTTPException(502, "Upstream authentication failed")
                    raise HTTPException(502, "Upstream unavailable")
            else:
                log_timing("stt_volc_stream", ms=round((time.perf_counter() - started) * 1000),
                           audio_bytes=len(pcm), status=200)
                logger.info(
                    "asr volc_stream ok ms=%.0f audio_s=%.2f",
                    (time.perf_counter() - started) * 1000, audio_s,
                )
                return JSONResponse({"text": text, "segments": []})
            finally:
                gate.leave(kind)
    del pcm
    if settings.upstream_whisper_mode == "chat":
        del body
        return await _chat_from_audio(request, settings, audio, language)
    if not settings.upstream_whisper_base_url:
        raise HTTPException(503, "Whisper upstream is not configured")
    del audio
    return await _openai_transcription(request, settings, content_type, body)


def _audio_format(data: bytes) -> str:
    if data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        return "wav"
    if data[:3] == b"ID3" or (len(data) >= 2 and data[0] == 0xFF and data[1] & 0xE0 == 0xE0):
        return "mp3"
    raise HTTPException(400, "Unsupported audio format (wav or mp3)")


async def _chat_transcription(request: Request, settings: Settings) -> Response:
    if not settings.upstream_whisper_base_url or not settings.upstream_whisper_model:
        raise HTTPException(503, "Whisper upstream is not configured")
    audio, language, _fmt, _body = await _read_audio_form(
        request, MAX_CHAT_AUDIO_BYTES + MULTIPART_OVERHEAD
    )
    del _body
    return await _chat_from_audio(request, settings, audio, language)


async def _chat_from_audio(
    request: Request, settings: Settings, audio: bytes, language: object
) -> Response:
    if not settings.upstream_whisper_base_url or not settings.upstream_whisper_model:
        raise HTTPException(503, "Whisper upstream is not configured")
    if len(audio) > MAX_CHAT_AUDIO_BYTES:
        raise HTTPException(413, "Audio file is too large")
    fmt = _audio_format(audio)
    text = await transcribe_chat(
        request.app.state.http, settings, audio, fmt, language if isinstance(language, str) else None
    )
    return JSONResponse({"text": text, "segments": []})
