"""识别核心(上传识别与实时通话兜底共用)。日志只记耗时与字节数。"""
import base64
import io
import wave

import httpx
from fastapi import HTTPException

from app.core import metering
from app.core.config import STT_THINKING_HOST_SUFFIXES, Settings, send_thinking_param
from app.core.timing import Stopwatch, log_timing
from app.core.upstream import check_upstream_auth

NO_SPEECH_TOKEN = "<none>"
CHAT_PROMPT = (
    "Transcribe the audio verbatim in its original language. "
    "Output only the transcript text, without any extra words, quotes or timestamps. "
    "Only transcribe the nearest, clearest speaker and ignore background voices. "
    f"If there is no clear foreground speech, output exactly {NO_SPEECH_TOKEN}."
)
TIMEOUT = httpx.Timeout(300.0, connect=10.0)


def _language_hint(language: str | None) -> str:
    if not isinstance(language, str):
        return ""
    primary = language.strip().replace("_", "-").split("-")[0].lower()
    return f" The audio language is {primary}." if primary.isalpha() and len(primary) <= 8 else ""


def chat_body(settings: Settings, audio: bytes, fmt: str, language: str | None) -> dict:
    body: dict = {
        "model": settings.upstream_whisper_model,
        "temperature": 0,
        "max_tokens": settings.stt_max_tokens,
        "messages": [{"role": "user", "content": [
            {"type": "input_audio", "input_audio": {"data": base64.b64encode(audio).decode("ascii"), "format": fmt}},
            {"type": "text", "text": CHAT_PROMPT + _language_hint(language)},
        ]}],
    }
    if send_thinking_param(settings.stt_disable_thinking, settings.upstream_whisper_base_url, STT_THINKING_HOST_SUFFIXES):
        body["thinking"] = {"type": "disabled"}
    return body


def _extract_text(response: httpx.Response) -> str:
    try:
        text = response.json()["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError):
        raise HTTPException(502, "Upstream unavailable")
    if not isinstance(text, str) or not text.strip():
        raise HTTPException(502, "Upstream unavailable")
    text = text.strip()
    return "" if text.lower() == NO_SPEECH_TOKEN else text


async def transcribe_chat(http: httpx.AsyncClient, settings: Settings, audio: bytes, fmt: str, language: str | None) -> str:
    if not settings.upstream_whisper_base_url or not settings.upstream_whisper_model:
        raise HTTPException(503, "Whisper upstream is not configured")
    watch = Stopwatch()
    units, unit = metering.audio_units(audio)
    provider = metering.provider_of(settings.upstream_whisper_base_url)
    try:
        upstream = await http.post(
            settings.upstream_whisper_base_url.rstrip("/") + "/chat/completions",
            json=chat_body(settings, audio, fmt, language),
            headers={"Authorization": f"Bearer {settings.upstream_whisper_key}"},
            timeout=TIMEOUT,
        )
    except httpx.HTTPError:
        log_timing("stt_chat", ms=watch.ms(), audio_bytes=len(audio), status=0)
        metering.record("stt", provider, settings.upstream_whisper_model, 0, watch.ms(), units_in=units, unit=unit)
        raise HTTPException(502, "Upstream unavailable")
    log_timing("stt_chat", ms=watch.ms(), audio_bytes=len(audio), status=upstream.status_code)
    metering.record("stt", provider, settings.upstream_whisper_model, upstream.status_code, watch.ms(),
                    units_in=units, unit=unit)
    check_upstream_auth(upstream.status_code)
    if not upstream.is_success:
        raise HTTPException(502, "Upstream unavailable")
    return _extract_text(upstream)


def pcm_to_wav(pcm: bytes, rate: int = 16000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return buf.getvalue()


async def transcribe_wav(http: httpx.AsyncClient, settings: Settings, wav: bytes, language: str | None = "en") -> str:
    if settings.upstream_whisper_mode == "chat":
        return await transcribe_chat(http, settings, wav, "wav", language)
    if not settings.upstream_whisper_base_url:
        raise HTTPException(503, "Whisper upstream is not configured")
    data = {"model": "whisper-1", "response_format": "json"}
    if language:
        data["language"] = language
    units, unit = metering.audio_units(wav)
    provider, timer, status = metering.provider_of(settings.upstream_whisper_base_url), metering.Timer(), 0
    try:
        upstream = await http.post(
            settings.upstream_whisper_base_url.rstrip("/") + "/audio/transcriptions",
            files={"file": ("audio.wav", wav, "audio/wav")}, data=data,
            headers={"Authorization": f"Bearer {settings.upstream_whisper_key}"}, timeout=TIMEOUT,
        )
        status = upstream.status_code
    except httpx.HTTPError:
        raise HTTPException(502, "Upstream unavailable")
    finally:
        metering.record("stt", provider, "whisper-1", status, timer.ms(), units_in=units, unit=unit)
    check_upstream_auth(upstream.status_code)
    if not upstream.is_success:
        raise HTTPException(502, "Upstream unavailable")
    try:
        text = upstream.json()["text"]
    except (ValueError, KeyError, TypeError):
        raise HTTPException(502, "Upstream unavailable")
    return text.strip() if isinstance(text, str) else ""
