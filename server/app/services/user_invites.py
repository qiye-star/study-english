"""Per-user permanent invite codes (invites v2 plan S5; R-I6..R-I9, X18, X19, X32).

Each user has at most one live random code (partial unique index). Its plain copy is kept encrypted (`code_enc`,
secretbox) so the owner can see it again; lookups use only the SHA-256 (`hash_code`). The cumulative use count lives
on the code row and a replacement inherits it (R-I8), so the cap is per person, not per string.

Services take the session, Settings, the clock and the SecretBox as parameters (X32). Nothing here logs a code.
"""
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.core.quotas import quota_for
from app.core.secretbox import SecretBox, SecretBoxError
from app.models import InviteCode, InviteRedemption, User, display_name, iso_utc
from app.services.invites import generate_code, hash_code

CAP_KEY = "invites_user_code_max_uses"
INVITEES_LIMIT = 50

REASON_TOO_NEW = "too_new"
REASON_EMAIL_UNVERIFIED = "email_unverified"
REASON_DISABLED = "disabled_by_admin"
REASON_INVITES_DISABLED = "invites_disabled"
# not an eligibility refusal: a live code exists but cannot be read (SETTINGS_ENCRYPTION_KEY changed); replace it
REASON_ROTATE_REQUIRED = "rotate_required"


class UserInviteError(Exception):
    pass


class InvitesNotConfigured(UserInviteError):
    """No SETTINGS_ENCRYPTION_KEY: user codes cannot be stored or shown (INDEX X9, R-I7)."""


class NotEligible(UserInviteError):
    def __init__(self, reason: str, available_at: datetime | None = None):
        super().__init__(reason)
        self.reason = reason
        self.available_at = available_at


class RotateRequired(UserInviteError):
    """The live code cannot be read; generating would collide with it, so the owner must replace it."""


class NoCodeToReplace(UserInviteError):
    pass


def _utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def eligibility(user: User, now: datetime, settings, cap: int) -> tuple[str | None, datetime | None]:
    """(refusal reason, earliest time it becomes possible). Pure: the caller supplies the live cap (R-I6)."""
    if user.disabled_at is not None:
        return REASON_DISABLED, None
    if cap <= 0:
        return REASON_INVITES_DISABLED, None
    if user.email_verified_at is None:
        return REASON_EMAIL_UNVERIFIED, None
    ready = _utc(user.created_at) + timedelta(days=settings.invites_user_min_account_days)
    if now < ready:
        return REASON_TOO_NEW, ready
    return None, None


async def live_row(session, user_id: int) -> InviteCode | None:
    return await session.scalar(select(InviteCode).where(
        InviteCode.kind == "user", InviteCode.owner_user_id == user_id, InviteCode.revoked_at.is_(None)))


async def cumulative_uses(session, user_id: int) -> int:
    """Uses across every code the user has had (R-I8/R-I9): a replacement starts from this number."""
    value = await session.scalar(select(func.max(InviteCode.uses)).where(
        InviteCode.kind == "user", InviteCode.owner_user_id == user_id))
    return int(value or 0)


def read_code(box: SecretBox, row: InviteCode) -> str | None:
    """The plain code of a live row, or None when it cannot be decrypted (for example after a key change)."""
    if not row.code_enc:
        return None
    try:
        return box.decrypt(row.code_enc)
    except SecretBoxError:
        return None


async def _fresh_code(session) -> str:
    for _ in range(5):
        code = generate_code()
        if await session.scalar(select(InviteCode.id).where(InviteCode.code_hash == hash_code(code))) is None:
            return code
    raise RuntimeError("could not allocate an invite code")  # pragma: no cover - 30^10 codes


async def invitees(session, user_id: int) -> list[dict]:
    """Who joined through any of the user's codes: display name and time only, newest first (INDEX X34)."""
    rows = (await session.execute(
        select(display_name(), InviteRedemption.redeemed_at)
        .select_from(InviteRedemption)
        .join(InviteCode, InviteCode.id == InviteRedemption.code_id)
        .join(User, User.id == InviteRedemption.user_id)
        .where(InviteCode.kind == "user", InviteCode.owner_user_id == user_id)
        .order_by(InviteRedemption.redeemed_at.desc(), InviteRedemption.id.desc())
        .limit(INVITEES_LIMIT))).all()
    return [{"display_name": name, "joined_at": iso_utc(joined)} for name, joined in rows]


async def _user(session, user_id: int) -> User:
    user = await session.get(User, user_id)
    if user is None:  # the caller is authenticated, so this only happens in a race with deletion
        raise NotEligible("disabled_by_admin")
    return user


async def view(session, settings, user_id: int, box: SecretBox | None, now: datetime) -> dict:
    """The owner's panel data (R-I9). The plain code is included only when the owner may use it."""
    if box is None:
        raise InvitesNotConfigured()
    user = await _user(session, user_id)
    cap = await quota_for(session, settings, user_id, CAP_KEY, now)
    refusal, ready = eligibility(user, now, settings, cap)
    reason, code = refusal, None
    row = await live_row(session, user_id)
    if refusal is None and row is not None:
        code = read_code(box, row)
        if code is None:
            reason = REASON_ROTATE_REQUIRED
    return {"eligible": refusal is None, "reason": reason,
            "available_at": iso_utc(ready) if ready is not None else None, "code": code,
            "uses": await cumulative_uses(session, user_id), "cap": cap,
            "invitees": await invitees(session, user_id)}


async def generate(session, settings, user_id: int, box: SecretBox | None, now: datetime) -> dict:
    """Return the owner's live code, creating it when there is none (R-I7). Commits."""
    if box is None:
        raise InvitesNotConfigured()
    user = await _user(session, user_id)
    cap = await quota_for(session, settings, user_id, CAP_KEY, now)
    refusal, ready = eligibility(user, now, settings, cap)
    if refusal is not None:
        raise NotEligible(refusal, ready)
    row = await live_row(session, user_id)
    if row is not None:
        if read_code(box, row) is None:
            raise RotateRequired()
        return await view(session, settings, user_id, box, now)
    await _insert(session, user_id, cap, await cumulative_uses(session, user_id), box, now, created_by="user")
    try:
        await session.commit()
    except IntegrityError:  # two requests raced: the other one's live code is the answer (partial unique index)
        await session.rollback()
        if await live_row(session, user_id) is None:
            raise
    return await view(session, settings, user_id, box, now)


async def _insert(session, user_id: int, cap: int, uses: int, box: SecretBox, now: datetime, *,
                  created_by: str) -> str:
    code = await _fresh_code(session)
    session.add(InviteCode(code_hash=hash_code(code), label="", max_uses=cap, uses=uses, created_by=created_by[:64],
                           created_at=now, kind="user", owner_user_id=user_id, code_enc=box.encrypt(code)))
    await session.flush()
    return code


async def replace_code(session, settings, user_id: int, box: SecretBox | None, now: datetime, *,
                       created_by: str, commit: bool = True) -> str:
    """Revoke the live code (its plain copy is wiped) and create a random one that inherits the cumulative uses.
    Used by the owner (after the eligibility check, see `rotate`) and by the admin console, which passes
    `commit=False` to write its audit row in the same transaction. Returns the new plain code: the caller must not put
    it anywhere but the owner's own response (the admin caller discards it)."""
    if box is None:
        raise InvitesNotConfigured()
    row = await live_row(session, user_id)
    if row is None:
        raise NoCodeToReplace()
    cap = await quota_for(session, settings, user_id, CAP_KEY, now)
    uses = await cumulative_uses(session, user_id)
    row.revoked_at, row.code_enc = now, None
    await session.flush()  # the old row leaves the partial unique index before the new one enters it
    code = await _insert(session, user_id, cap, uses, box, now, created_by=created_by)
    if commit:
        await session.commit()
    return code


async def rotate(session, settings, user_id: int, box: SecretBox | None, now: datetime) -> dict:
    """The owner's replacement (R-I8): refused unless the owner is eligible. Returns the panel data with the new code."""
    if box is None:
        raise InvitesNotConfigured()
    user = await _user(session, user_id)
    cap = await quota_for(session, settings, user_id, CAP_KEY, now)
    refusal, ready = eligibility(user, now, settings, cap)
    if refusal is not None:
        raise NotEligible(refusal, ready)
    await replace_code(session, settings, user_id, box, now, created_by="user")
    return await view(session, settings, user_id, box, now)
