"""Invite codes stored in the DB (admin console v2 §7; invites v2 plan S3, R-I2 / R-I3). Only the SHA-256 of the
normalised code is stored; codes are bearer secrets and never logged.

`redeem` takes one use of a live code with ONE conditional UPDATE and never commits: the caller commits it together
with the new user, so a failed registration gives the use back. The per-owner cap of a user code is read LIVE by the
caller and passed in (`user_cap`, INDEX X19), so this module never reads `app.state` or the global settings (X32).
"""
import hashlib
import re
import secrets
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone

from sqlalchemy import or_, select, update

from app.models import InviteCode, InviteRedemption, User

_IGNORED = re.compile(r"[\s\-]+")
# 30 characters without look-alikes (0/O, 1/I/L, and U): 22 letters + 8 digits (INDEX X18).
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789"
CODE_GROUPS = 2
CODE_GROUP_LEN = 5

UserCap = Callable[[int], Awaitable[int]]


class RedeemError(Exception):
    """`reason` is "invalid" (no such live code, or the owner is gone or disabled) or "used_up" (the cap is reached)."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def normalise(code: str) -> str:
    """Case, spaces and dashes do not matter: `abcd - efgh` == `ABCD-EFGH`."""
    return _IGNORED.sub("", code or "").upper()


def hash_code(code: str) -> str:
    return hashlib.sha256(normalise(code).encode()).hexdigest()


def generate_code() -> str:
    """A new random code, displayed `XXXXX-XXXXX` (10 characters, about 49 bits)."""
    chars = [secrets.choice(CODE_ALPHABET) for _ in range(CODE_GROUPS * CODE_GROUP_LEN)]
    return "-".join("".join(chars[i:i + CODE_GROUP_LEN]) for i in range(0, len(chars), CODE_GROUP_LEN))


async def _live_row(session, code_hash: str) -> InviteCode | None:
    """The row by hash, read in the caller's transaction (a seam for the race test)."""
    return await session.scalar(select(InviteCode).where(InviteCode.code_hash == code_hash))


async def redeem(session, code: str, now: datetime, *, user_cap: UserCap) -> InviteCode:
    """Take one use of the code. Returns the code row. Raises RedeemError. Does not commit.

    Admin codes cap at their own `max_uses`. A user code caps at `await user_cap(owner_id)` (the live quota), and its
    owner must exist and be enabled. The UPDATE repeats the cap as `uses < :cap`, so two racing redemptions of the last
    use cannot both win (the loser gets "used_up")."""
    if not normalise(code):
        raise RedeemError("invalid")
    row = await _live_row(session, hash_code(code))
    if row is None or row.revoked_at is not None or (row.expires_at is not None and _aware(row.expires_at) <= now):
        raise RedeemError("invalid")
    if row.kind == "user":
        owner = None if row.owner_user_id is None else await session.get(User, row.owner_user_id)
        if owner is None or owner.disabled_at is not None:
            raise RedeemError("invalid")
        cap = await user_cap(owner.id)
    else:
        cap = row.max_uses
    if row.uses >= cap:
        raise RedeemError("used_up")
    result = await session.execute(
        update(InviteCode)
        .where(InviteCode.id == row.id, InviteCode.revoked_at.is_(None),
               or_(InviteCode.expires_at.is_(None), InviteCode.expires_at > now),
               InviteCode.uses < cap)
        .values(uses=InviteCode.uses + 1)
        .execution_options(synchronize_session=False))
    if result.rowcount != 1:
        raise RedeemError("used_up")
    return row


def record_redemption(session, code: InviteCode, user_id: int, now: datetime) -> None:
    """Attribution (who used whose code). Only adds to the session: the caller commits with the new user."""
    session.add(InviteRedemption(code_id=code.id, user_id=user_id, redeemed_at=now))


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


