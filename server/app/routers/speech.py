import io
import wave
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Path, Request
from starlette.datastructures import UploadFile
from starlette.formparsers import MultiPartException
from starlette.requests import Request as StarletteRequest
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.azure import AzureError, AzureNotConfigured, AzureSpeech, get_azure
from app.deps import current_user, get_session, limited_user
from app.models import SpeechToken, User
from app.xfyun import XfyunError, XfyunIse, XfyunNotConfigured, get_xfyun
from app.xfyun_result import to_assessment

router = APIRouter(prefix="/api/speech")

MAX_ASSESSMENT_BYTES = 25 * 1024 * 1024
MAX_ASSESSMENT_SECONDS = 300
MAX_REFERENCE_CHARS = 2000
ASSESSMENT_RATE = 16000
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
    code = language.strip().lower()
    if code == "en" or code.startswith(("en-", "en_")):
        return "en_vip"
    if code == "zh" or code.startswith(("zh-", "zh_")):
        return "cn_vip"
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


@router.post("/assessments")
async def create_assessment(
    request: Request,
    _: User = Depends(limited_user),
    xfyun: XfyunIse = Depends(get_xfyun),
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
        if not isinstance(upload, UploadFile):
            raise HTTPException(400, "Audio file is required")
        if not isinstance(language, str):
            raise HTTPException(400, "Unsupported language")
        ent = _ise_entry(language)
        if not isinstance(reference, str) or not reference.strip():
            raise HTTPException(400, "Reference text is required")
        if len(reference.strip()) > MAX_REFERENCE_CHARS:
            raise HTTPException(400, "Reference text is too long")
        pcm = _wav_to_pcm(await upload.read())
    finally:
        await form.close()

    try:
        xml = await xfyun.evaluate(pcm, reference, ent)
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
        return to_assessment(xml, reference)
    except ValueError:
        raise HTTPException(502, "Upstream unavailable")
