from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.deps import current_user, get_session, get_settings, limited_user
from app.models import User
from app.realtime_asr import effective_realtime_asr
from app.routers.conversations import owned_conversation

router = APIRouter(prefix="/api")


class TicketIn(BaseModel):
    conversation_id: str = Field(min_length=1, max_length=64)


@router.get("/realtime/config")
async def realtime_config(_: User = Depends(current_user), settings: Settings = Depends(get_settings)):
    return {
        "enabled": settings.realtime_available,
        "max_minutes": settings.realtime_max_minutes,
        "idle_timeout_seconds": settings.realtime_idle_timeout_seconds,
        "asr_mode": effective_realtime_asr(settings),
        "sample_rate_in": 16000,
        "sample_rate_out": settings.realtime_tts_sample_rate,
    }


@router.post("/realtime/ticket")
async def realtime_ticket(
    payload: TicketIn,
    request: Request,
    user: User = Depends(limited_user),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    if not settings.realtime_available:
        raise HTTPException(503, "Realtime is not enabled")
    conversation = await owned_conversation(session, user, payload.conversation_id)
    ticket = request.app.state.realtime_tickets.issue(user.id, conversation.id)
    return {"ticket": ticket, "expires_in": settings.realtime_ticket_ttl_seconds}
