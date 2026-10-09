"""Multi-use invite codes stored in the DB (admin console v2 §7). Only the SHA-256 of the normalised code is
stored; codes are bearer secrets and never logged."""
import hashlib
import re
from datetime import datetime

from sqlalchemy import or_, update

from app.models import InviteCode

_IGNORED = re.compile(r"[\s\-]+")


def normalise(code: str) -> str:
    """Case, spaces and dashes do not matter: `abcd - efgh` == `ABCD-EFGH`."""
    return _IGNORED.sub("", code or "").upper()


def hash_code(code: str) -> str:
    return hashlib.sha256(normalise(code).encode()).hexdigest()


async def consume(session, code: str, now: datetime) -> bool:
    """Atomically take one use of a live code (single UPDATE, no read-then-write race). Never commits: the
    caller commits it together with the new user, so a failed registration gives the use back."""
    if not normalise(code):
        return False
    result = await session.execute(
        update(InviteCode)
        .where(InviteCode.code_hash == hash_code(code), InviteCode.revoked_at.is_(None),
               or_(InviteCode.expires_at.is_(None), InviteCode.expires_at > now),
               InviteCode.uses < InviteCode.max_uses)
        .values(uses=InviteCode.uses + 1)
        .execution_options(synchronize_session=False))
    return result.rowcount == 1
