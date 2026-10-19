"""Invite code management (admin console v2 §7). The plain code is returned once, at creation; listings and
the audit only ever see the label, counters and dates."""
from datetime import datetime, timezone

from sqlalchemy import select

from app.admin import audit
from app.admin.audit import Actor
from app.models import InviteCode, iso_utc
from app.services.invites import generate_code, hash_code

MAX_USES = 1000


class InviteError(Exception):
    def __init__(self, status: int, error: str):
        super().__init__(error)
        self.status = status
        self.error = error


def _utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def state(row: InviteCode, now: datetime) -> str:
    if row.revoked_at is not None:
        return "revoked"
    if row.expires_at is not None and _utc(row.expires_at) <= now:
        return "expired"
    if row.uses >= row.max_uses:
        return "used_up"
    return "active"


def invite_out(row: InviteCode, now: datetime) -> dict:
    return {"id": row.id, "label": row.label, "uses": row.uses, "max_uses": row.max_uses,
            "expires_at": iso_utc(row.expires_at) if row.expires_at else None,
            "revoked_at": iso_utc(row.revoked_at) if row.revoked_at else None,
            "created_by": row.created_by, "created_at": iso_utc(row.created_at), "state": state(row, now)}


async def create(session, actor: Actor, *, label: str, max_uses: int, expires_at: datetime | None,
                 now: datetime | None = None) -> tuple[InviteCode, str]:
    now = now or datetime.now(timezone.utc)
    if not 1 <= max_uses <= MAX_USES:
        raise InviteError(422, "Invalid max_uses")
    if expires_at is not None and _utc(expires_at) <= now:
        raise InviteError(422, "Expiry must be in the future")
    for _ in range(5):
        code = generate_code()
        if await session.scalar(select(InviteCode.id).where(InviteCode.code_hash == hash_code(code))) is None:
            break
    else:  # pragma: no cover - 31^12 codes
        raise InviteError(500, "Could not allocate a code")
    row = InviteCode(code_hash=hash_code(code), label=label.strip()[:64], max_uses=max_uses, uses=0,
                     expires_at=expires_at, created_by=actor.name[:64], created_at=now)
    session.add(row)
    await session.flush()
    await audit.record(session, actor, "invite.create", target_type="invite", target_id=row.id, summary=row.label,
                       after={"max_uses": max_uses, "expires_at": iso_utc(expires_at) if expires_at else None})
    await session.commit()
    return row, code


async def listing(session, now: datetime | None = None) -> list[dict]:
    now = now or datetime.now(timezone.utc)
    rows = (await session.scalars(select(InviteCode).order_by(InviteCode.id.desc()))).all()
    return [invite_out(r, now) for r in rows]


async def revoke(session, actor: Actor, invite_id: int, now: datetime | None = None) -> None:
    now = now or datetime.now(timezone.utc)
    row = await session.get(InviteCode, invite_id)
    if row is None:
        raise InviteError(404, "Invite not found")
    if row.revoked_at is None:
        row.revoked_at = now
        await audit.record(session, actor, "invite.revoke", target_type="invite", target_id=row.id,
                           summary=row.label, after={"uses": row.uses})
    await session.commit()
