"""Save a recording plus its assessment (extracted from routers/speech.py; shared by uploads and realtime calls)."""
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.services import recordings
from app.core.config import Settings
from app.core.quotas import quota_for
from app.models import Assessment

SCORE_KEYS = ("pronunciation_score", "accuracy_score", "fluency_score", "completeness_score")


class QuotaExceeded(Exception):
    pass


async def check_quota(session: AsyncSession, settings: Settings, user_id: int, nbytes: int) -> None:
    quota = await quota_for(session, settings, user_id, "recording_quota_mb") * 1024 * 1024
    if await recordings.used_bytes(session, user_id) + nbytes > quota:
        raise QuotaExceeded()


async def save_assessment(session: AsyncSession, settings: Settings, user_id: int, *, store, wav_bytes: bytes,
                          duration: float, reference: str, language: str, source: str, result: dict) -> str:
    """Write the file, insert the row and commit; the file is deleted if the commit fails. OSError (StorageError
    included) from the file write propagates to the caller (nothing is added to the session in that case)."""
    assessment_id = str(uuid.uuid4())
    relpath = recordings.recording_relpath(user_id, assessment_id)
    await recordings.write_recording(store, relpath, wav_bytes)
    session.add(Assessment(
        id=assessment_id, user_id=user_id, reference_text=reference, language=language.strip()[:16],
        duration_ms=round(duration * 1000), audio_bytes=len(wav_bytes),
        scores={key: result.get(key) for key in SCORE_KEYS}, result=result, audio_path=relpath, source=source,
    ))
    try:
        await session.commit()
    except Exception:
        await recordings.delete_recording(store, relpath)
        raise
    return assessment_id
