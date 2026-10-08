import io
import logging
import wave
from datetime import timedelta
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Path, Request
from starlette.datastructures import UploadFile
from starlette.formparsers import MultiPartException
from starlette.requests import Request as StarletteRequest
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.assessment_store import SCORE_KEYS, QuotaExceeded, check_quota, save_assessment  # noqa: F401
from app.azure import AzureError, AzureNotConfigured, AzureSpeech
from app.provider_clients import get_azure, get_xfyun
from app.config import Settings
from app.deps import current_user, get_session, get_settings, limited_user
from app.models import Assessment, Message, SpeechToken, User, utcnow
from app.routers.conversations import drop_assessments, remove_files
from app.xfyun import XfyunError, XfyunIse, XfyunNotConfigured
from app.xfyun_result import to_assessment

router = APIRouter(prefix="/api/speech")
logger = logging.getLogger(__name__)

MAX_ASSESSMENT_BYTES = 25 * 1024 * 1024
MAX_ASSESSMENT_SECONDS = 300
MAX_REFERENCE_CHARS = 2000
TIMEOUT_BASE_SECONDS = 30
TIMEOUT_CAP_SECONDS = 330
ASSESSMENT_RATE = 16000
TRUTHY = {"true", "1", "yes"}
SOURCES = ("practice", "chat")
BAD_WAV = "Audio must be a 16 kHz mono 16-bit WAV"


class SpeechTokenIn(BaseModel):
    model_config = ConfigDict(coerce_numbers_to_str=True, extra="ignore")

    purpose: str | None = Field(default=None, max_length=32)
    target_type: str | None = Field(default=None, max_length=32)
    target_id: str | None = Field(default=None, max_length=64)


class SpeechTokenState(BaseModel):
    state: Literal["consumed", "revoked"]


@router.post("/tokens")
async def create_token(
    payload: SpeechTokenIn,
    user: User = Depends(limited_user),
    session: AsyncSession = Depends(get_session),
    azure: AzureSpeech = Depends(get_azure),
):
    try:
        token = await azure.get_token()
    except AzureNotConfigured:
        raise HTTPException(503, "Azure Speech is not configured")
    except (AzureError, httpx.HTTPError):
        raise HTTPException(502, "Azure unavailable")

    row = SpeechToken(
        user_id=user.id,
        purpose=payload.purpose,
        target_type=payload.target_type,
        target_id=payload.target_id,
    )
    session.add(row)
    await session.commit()
    return {"id": row.id, "token": token, "region": azure.region}


@router.put("/tokens/{token_id}")
async def update_token(
    payload: SpeechTokenState,
    token_id: int = Path(ge=1, le=2**31 - 1),
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(
        select(SpeechToken).where(SpeechToken.id == token_id, SpeechToken.user_id == user.id)
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "Speech token not found")
    row.state = payload.state
    await session.commit()
    return {"id": row.id, "state": row.state}


def _ise_entry(language: str) -> str:
    # English only for now: the result converter is validated against English
    # results; iFlytek's Chinese format (pinyin phones, other scores) differs.
    code = language.strip().lower()
    if code == "en" or code.startswith(("en-", "en_")):
        return "en_vip"
    raise HTTPException(400, "Unsupported language")


def _wav_to_pcm(data: bytes) -> bytes:
    try:
        with wave.open(io.BytesIO(data), "rb") as w:
            if (
                w.getframerate() != ASSESSMENT_RATE
                or w.getnchannels() != 1
                or w.getsampwidth() != 2
                or w.getcomptype() != "NONE"
            ):
                raise HTTPException(400, BAD_WAV)
            frames = w.getnframes()
            if frames <= 0:
                raise HTTPException(400, BAD_WAV)
            if frames / ASSESSMENT_RATE > MAX_ASSESSMENT_SECONDS:
                raise HTTPException(400, "Audio is too long")
            pcm = w.readframes(frames)
    except (wave.Error, EOFError):
        raise HTTPException(400, BAD_WAV)
    if not pcm:
        raise HTTPException(400, BAD_WAV)
    return pcm


async def _read_limited_body(request: Request) -> bytes:
    too_large = HTTPException(413, "Audio file is too large")
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > MAX_ASSESSMENT_BYTES:
        raise too_large
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_ASSESSMENT_BYTES:
            raise too_large
        chunks.append(chunk)
    return b"".join(chunks)


async def cleanup_orphan_chat_recordings(session: AsyncSession, settings: Settings, user: User) -> None:
    """Delete the caller's source=chat assessments that no message references and that are older than the grace
    window (a tab died / a late link failed). Rows first, files after the commit. Never raises."""
    try:
        cutoff = utcnow() - timedelta(hours=settings.chat_orphan_grace_hours)
        rows = (
            await session.execute(
                select(Assessment).where(
                    Assessment.user_id == user.id,
                    Assessment.source == "chat",
                    Assessment.created_at < cutoff,
                    ~exists().where(Message.assessment_id == Assessment.id),
                )
            )
        ).scalars().all()
        if not rows:
            return
        paths = await drop_assessments(session, list(rows))
        await session.commit()
    except Exception:
        logger.warning("Orphan chat recording cleanup failed")
        try:
            await session.rollback()
            await session.refresh(user)  # rollback expires the loaded user
        except Exception:
            pass
        return
    remove_files(settings, paths)


@router.post("/assessments")
async def create_assessment(
    request: Request,
    user: User = Depends(limited_user),
    xfyun: XfyunIse = Depends(get_xfyun),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    if not xfyun.configured:
        raise HTTPException(503, "Pronunciation assessment is not configured")
    content_type = request.headers.get("content-type", "")
    if not content_type.lower().startswith("multipart/form-data"):
        raise HTTPException(400, "Expected multipart/form-data")
    body = await _read_limited_body(request)

    # The body is already buffered under the size cap; replay it to parse the form.
    sent = False

    async def replay():
        nonlocal sent
        if sent:
            return {"type": "http.disconnect"}
        sent = True
        return {"type": "http.request", "body": body, "more_body": False}

    try:
        form = await StarletteRequest(request.scope, replay).form()
    except (MultiPartException, ValueError):
        raise HTTPException(400, "Invalid multipart body")

    try:
        upload = form.get("file")
        reference = form.get("reference")
        language = form.get("language")
        save = form.get("save")
        source = form.get("source")
        if not isinstance(upload, UploadFile):
            raise HTTPException(400, "Audio file is required")
        if not isinstance(language, str):
            raise HTTPException(400, "Unsupported language")
        ent = _ise_entry(language)
        if not isinstance(reference, str) or not reference.strip():
            raise HTTPException(400, "Reference text is required")
        reference = reference.strip()
        if len(reference) > MAX_REFERENCE_CHARS:
            raise HTTPException(400, "Reference text is too long")
        wav_bytes = await upload.read()
        pcm = _wav_to_pcm(wav_bytes)
    finally:
        await form.close()

    want_save = isinstance(save, str) and save.strip().lower() in TRUTHY
    source_value = "practice"
    if want_save:
        if isinstance(source, str) and source.strip():
            source_value = source.strip().lower()
        if source_value not in SOURCES:
            raise HTTPException(400, "Invalid source")
        if source_value == "chat":
            await cleanup_orphan_chat_recordings(session, settings, user)
        try:
            await check_quota(session, settings, user.id, len(wav_bytes))
        except QuotaExceeded:
            raise HTTPException(413, "Recording storage quota exceeded")

    duration = len(pcm) / (2 * ASSESSMENT_RATE)
    timeout = min(TIMEOUT_BASE_SECONDS + duration, TIMEOUT_CAP_SECONDS)
    try:
        xml = await xfyun.evaluate(pcm, reference, ent, timeout=timeout)
    except XfyunNotConfigured:
        raise HTTPException(503, "Pronunciation assessment is not configured")
    except XfyunError as exc:
        # Map by code only; exc.message may contain provider text.
        if exc.code in (10163, 48195):
            raise HTTPException(400, "Invalid assessment parameters")
        if exc.code == 11200:
            raise HTTPException(503, "Speech evaluation is not authorized")
        if exc.code in (10114, 60114):
            raise HTTPException(400, "Audio is too long")
        raise HTTPException(502, "Upstream unavailable")
    try:
        result = to_assessment(xml, reference)
    except ValueError:
        raise HTTPException(502, "Upstream unavailable")
    if not want_save:
        return result

    try:
        assessment_id = await save_assessment(
            session, settings, user.id, wav_bytes=wav_bytes, duration=duration, reference=reference,
            language=language, source=source_value, result=result,
        )
    except OSError:
        raise HTTPException(500, "Could not save the recording")
    return {**result, "assessment_id": assessment_id}
