from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from fastapi.responses import FileResponse
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import recordings
from app.core.config import Settings
from app.core.deps import current_user, get_session, get_settings
from app.models import Assessment, Message, User, iso_utc

router = APIRouter(prefix="/api")

ItemId = Annotated[str, Path(max_length=64)]


def summary_out(row: Assessment) -> dict:
    return {
        "id": row.id,
        "reference_text": row.reference_text,
        "language": row.language,
        "duration_ms": row.duration_ms,
        "scores": row.scores,
        "created_at": iso_utc(row.created_at),
    }


async def owned_assessment(session: AsyncSession, user: User, assessment_id: str) -> Assessment:
    row = (
        await session.execute(
            select(Assessment).where(Assessment.id == assessment_id, Assessment.user_id == user.id)
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "Assessment not found")
    return row


@router.get("/assessments")
async def list_assessments(
    page: int = Query(1, ge=1, le=10_000),
    per_page: int = Query(20, ge=1, le=50),
    source: Literal["practice", "chat", "all"] = Query("practice"),
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    stmt = select(Assessment).where(Assessment.user_id == user.id)
    if source != "all":
        stmt = stmt.where(Assessment.source == source)
    rows = (
        await session.execute(
            stmt.order_by(Assessment.created_at.desc(), Assessment.id.desc())
            .offset((page - 1) * per_page)
            .limit(per_page + 1)
        )
    ).scalars().all()
    return {
        "assessments": [summary_out(r) for r in rows[:per_page]],
        "page": page,
        "next": page + 1 if len(rows) > per_page else None,
    }


@router.get("/assessments/{assessment_id}")
async def get_assessment(
    assessment_id: ItemId,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    row = await owned_assessment(session, user, assessment_id)
    return {**summary_out(row), "result": row.result}


@router.get("/assessments/{assessment_id}/audio")
async def get_assessment_audio(
    assessment_id: ItemId,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    row = await owned_assessment(session, user, assessment_id)
    try:
        path = recordings.absolute_path(settings.resolved_data_dir, row.audio_path)
    except ValueError:
        raise HTTPException(404, "Recording not found")
    if not path.is_file():
        raise HTTPException(404, "Recording not found")
    return FileResponse(path, media_type="audio/wav", headers={"Cache-Control": "private, no-store"})


@router.delete("/assessments/{assessment_id}")
async def delete_assessment(
    assessment_id: ItemId,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    row = await owned_assessment(session, user, assessment_id)
    relpath = row.audio_path
    await session.execute(update(Message).where(Message.assessment_id == row.id).values(assessment_id=None))
    await session.delete(row)
    await session.commit()
    recordings.delete_recording(settings.resolved_data_dir, relpath)
    return {"id": assessment_id}
