"""Invite code management (admin console v2 §7; invites v2 plan S7, R-I10, R-I11, X21).

The plain code is returned once, at creation (single or batch). Listings, statuses and the audit only ever see
labels, counters, kinds, owners and dates: never a code, its hash or its ciphertext."""
from datetime import datetime, timezone

from sqlalchemy import func, select

from app.admin import audit
from app.admin.audit import Actor
from app.core.quotas import quota_for
from app.models import InviteCode, InviteRedemption, User, display_name, iso_utc, utcnow
from app.services import user_invites
from app.services.invites import generate_code, hash_code

MAX_USES = 1000
BATCH_MAX = 100
REDEEMERS_SHOWN = 5  # usernames per listing row (the total is always exact)
INVITEES_SHOWN = 50  # per-user view
CAP_KEY = user_invites.CAP_KEY


class InviteError(Exception):
    def __init__(self, status: int, error: str):
        super().__init__(error)
        self.status = status
        self.error = error


def _utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def state(row: InviteCode, now: datetime, cap: int | None = None) -> str:
    """`cap` is the live cap of a user code (quota, INDEX X19); admin codes use their own `max_uses`."""
    limit = row.max_uses if cap is None else cap
    if row.revoked_at is not None:
        return "revoked"
    if row.expires_at is not None and _utc(row.expires_at) <= now:
        return "expired"
    if row.uses >= limit:
        return "used_up"
    return "active"


def invite_out(row: InviteCode, now: datetime, cap: int | None = None) -> dict:
    return {"id": row.id, "label": row.label, "kind": row.kind, "uses": row.uses,
            "max_uses": row.max_uses if cap is None else cap,
            "expires_at": iso_utc(row.expires_at) if row.expires_at else None,
            "revoked_at": iso_utc(row.revoked_at) if row.revoked_at else None,
            "created_by": row.created_by, "created_at": iso_utc(row.created_at), "state": state(row, now, cap)}


async def _unused_code(session, taken: set[str]) -> str:
    for _ in range(5):
        code = generate_code()
        digest = hash_code(code)
        if digest not in taken and await session.scalar(select(InviteCode.id).where(
                InviteCode.code_hash == digest)) is None:
            return code
    raise InviteError(500, "Could not allocate a code")  # pragma: no cover - 30^10 codes


async def create(session, actor: Actor, *, label: str, max_uses: int, expires_at: datetime | None,
                 now: datetime | None = None) -> tuple[InviteCode, str]:
    now = now or datetime.now(timezone.utc)
    if not 1 <= max_uses <= MAX_USES:
        raise InviteError(422, "Invalid max_uses")
    if expires_at is not None and _utc(expires_at) <= now:
        raise InviteError(422, "Expiry must be in the future")
    code = await _unused_code(session, set())
    row = InviteCode(code_hash=hash_code(code), label=label.strip()[:64], max_uses=max_uses, uses=0,
                     expires_at=expires_at, created_by=actor.name[:64], created_at=now)
    session.add(row)
    await session.flush()
    await audit.record(session, actor, "invite.create", target_type="invite", target_id=row.id, summary=row.label,
                       after={"max_uses": max_uses, "expires_at": iso_utc(expires_at) if expires_at else None})
    await session.commit()
    return row, code


async def create_batch(session, actor: Actor, *, count: int, label: str, expires_at: datetime | None,
                       now: datetime | None = None) -> tuple[list[InviteCode], list[str]]:
    """One-off admin codes (max_uses 1), all or nothing, one audit row carrying the count only (R-I10)."""
    now = now or datetime.now(timezone.utc)
    if not 1 <= count <= BATCH_MAX:
        raise InviteError(422, "Invalid count")
    if expires_at is not None and _utc(expires_at) <= now:
        raise InviteError(422, "Expiry must be in the future")
    label = label.strip()[:64]
    rows: list[InviteCode] = []
    codes: list[str] = []
    taken: set[str] = set()
    for _ in range(count):
        code = await _unused_code(session, taken)
        taken.add(hash_code(code))
        row = InviteCode(code_hash=hash_code(code), label=label, max_uses=1, uses=0, expires_at=expires_at,
                         created_by=actor.name[:64], created_at=now)
        session.add(row)
        rows.append(row)
        codes.append(code)
    await session.flush()
    await audit.record(session, actor, "invite.batch_create", summary=label,
                       after={"count": count, "expires_at": iso_utc(expires_at) if expires_at else None})
    await session.commit()
    return rows, codes


async def resolve_owner(session, text: str) -> int | None:
    """A login name first, then a user id (a name can look like digits, so the name wins)."""
    text = text.strip()
    user = await session.scalar(select(User).where(User.username == text))
    if user is None and text.isdigit() and 0 < int(text) < 2**31:
        user = await session.get(User, int(text))
    return None if user is None else user.id


async def _redeemers(session, code_ids: list[int]) -> dict[int, dict]:
    """Exact count of redemptions per code, and up to REDEEMERS_SHOWN login names (newest first)."""
    if not code_ids:
        return {}
    rows = (await session.execute(
        select(InviteRedemption.code_id, User.username)
        .select_from(InviteRedemption)
        .outerjoin(User, User.id == InviteRedemption.user_id)
        .where(InviteRedemption.code_id.in_(code_ids))
        .order_by(InviteRedemption.redeemed_at.desc(), InviteRedemption.id.desc()))).all()
    out: dict[int, dict] = {}
    for code_id, username in rows:
        item = out.setdefault(code_id, {"total": 0, "usernames": []})
        item["total"] += 1
        if username is not None and len(item["usernames"]) < REDEEMERS_SHOWN:
            item["usernames"].append(username)
    return out


async def listing(session, settings, *, kind: str | None = None, owner: str | None = None,
                  state_filter: str | None = None, now: datetime | None = None) -> list[dict]:
    now = now or datetime.now(timezone.utc)
    stmt = select(InviteCode, User).outerjoin(User, User.id == InviteCode.owner_user_id).order_by(InviteCode.id.desc())
    if kind is not None:
        stmt = stmt.where(InviteCode.kind == kind)
    if owner is not None and owner.strip():
        owner_id = await resolve_owner(session, owner)
        if owner_id is None:
            return []
        stmt = stmt.where(InviteCode.owner_user_id == owner_id)
    rows = (await session.execute(stmt)).all()
    redeemers = await _redeemers(session, [row.id for row, _ in rows])
    caps: dict[int, int] = {}
    out: list[dict] = []
    for row, holder in rows:
        cap = None
        if row.kind == "user" and row.owner_user_id is not None:  # the live per-owner cap (INDEX X19)
            if row.owner_user_id not in caps:
                caps[row.owner_user_id] = await quota_for(session, settings, row.owner_user_id, CAP_KEY, now)
            cap = caps[row.owner_user_id]
        if state_filter is not None and state(row, now, cap) != state_filter:
            continue
        item = invite_out(row, now, cap)
        item["owner"] = None if holder is None else {"id": holder.id, "username": holder.username,
                                                     "nickname": holder.nickname}
        item["redeemers"] = redeemers.get(row.id, {"total": 0, "usernames": []})
        out.append(item)
    return out


async def revoke(session, actor: Actor, invite_id: int, now: datetime | None = None) -> None:
    now = now or datetime.now(timezone.utc)
    row = await session.get(InviteCode, invite_id)
    if row is None or row.kind == "user":  # user codes are revoked only through the per-user routes (step-up)
        raise InviteError(404, "Invite not found")  # the same answer as an unknown id: reveals nothing
    if row.revoked_at is None:
        row.revoked_at = now
        row.code_enc = None
        await audit.record(session, actor, "invite.revoke", target_type="invite", target_id=row.id,
                           summary=row.label, after={"uses": row.uses})
    await session.commit()


async def redemptions(session, invite_id: int) -> list[dict]:
    """Who used this code, newest first. A deleted invitee keeps the row with empty identity fields (R-I11)."""
    if await session.get(InviteCode, invite_id) is None:
        raise InviteError(404, "Invite not found")
    rows = (await session.execute(
        select(InviteRedemption, User)
        .select_from(InviteRedemption)
        .outerjoin(User, User.id == InviteRedemption.user_id)
        .where(InviteRedemption.code_id == invite_id)
        .order_by(InviteRedemption.redeemed_at.desc(), InviteRedemption.id.desc()))).all()
    return [{"user_id": None if holder is None else holder.id,
             "username": None if holder is None else holder.username,
             "nickname": None if holder is None else holder.nickname,
             "redeemed_at": iso_utc(row.redeemed_at),
             "disabled": holder is not None and holder.disabled_at is not None}
            for row, holder in rows]


async def user_status(session, settings, user_id: int, *, now: datetime | None = None) -> dict:
    """A user's invite state for the operator: usage and counts, never the code (R-I10)."""
    now = now or datetime.now(timezone.utc)
    if await session.get(User, user_id) is None:
        raise InviteError(404, "User not found")
    cap = await quota_for(session, settings, user_id, CAP_KEY, now)
    live = await user_invites.live_row(session, user_id)
    current = None if live is None else {
        "uses": live.uses, "cap": cap, "created_at": iso_utc(live.created_at), "revoked_at": None,
        "state": state(live, now, cap)}
    history = await session.scalar(select(func.count(InviteCode.id)).where(
        InviteCode.kind == "user", InviteCode.owner_user_id == user_id))
    via_user = (select(func.count(InviteRedemption.id))
                .select_from(InviteRedemption)
                .join(InviteCode, InviteCode.id == InviteRedemption.code_id)
                .where(InviteCode.kind == "user", InviteCode.owner_user_id == user_id))
    redemptions_total = await session.scalar(via_user)
    disabled = await session.scalar(via_user.join(User, User.id == InviteRedemption.user_id)
                                    .where(User.disabled_at.is_not(None)))
    invitees = (await session.execute(
        select(display_name(), InviteRedemption.redeemed_at, User.disabled_at)
        .select_from(InviteRedemption)
        .join(InviteCode, InviteCode.id == InviteRedemption.code_id)
        .join(User, User.id == InviteRedemption.user_id)
        .where(InviteCode.kind == "user", InviteCode.owner_user_id == user_id)
        .order_by(InviteRedemption.redeemed_at.desc(), InviteRedemption.id.desc())
        .limit(INVITEES_SHOWN))).all()
    return {"current": current, "history_codes": int(history or 0), "redemptions": int(redemptions_total or 0),
            "disabled_invitees": int(disabled or 0),
            "invitees": [{"display_name": name, "redeemed_at": iso_utc(at), "disabled": gone is not None}
                         for name, at, gone in invitees]}


async def revoke_user_code(session, actor: Actor, user_id: int, *, reason: str, now: datetime | None = None) -> None:
    now = now or datetime.now(timezone.utc)
    user = await session.get(User, user_id)
    if user is None:
        raise InviteError(404, "User not found")
    row = await user_invites.live_row(session, user_id)
    if row is None:
        raise InviteError(404, "No invite code")
    row.revoked_at, row.code_enc = now, None
    await audit.record(session, actor, "invite.user.revoke", target_type="user", target_id=user_id,
                       summary=user.username, after={"invite_id": row.id, "uses": row.uses}, reason=reason)
    await session.commit()


async def rotate_user_code(session, actor: Actor, settings, box, user_id: int, *, reason: str,
                           now: datetime | None = None) -> None:
    """Replace the user's code. The new plain code is created and then discarded here: the operator never sees it."""
    now = now or datetime.now(timezone.utc)
    user = await session.get(User, user_id)
    if user is None:
        raise InviteError(404, "User not found")
    if box is None:
        raise InviteError(503, "Invites are not configured")
    row = await user_invites.live_row(session, user_id)
    if row is None:
        raise InviteError(409, "No invite code to replace")
    uses = row.uses
    try:
        await user_invites.replace_code(session, settings, user_id, box, now, created_by=actor.name, commit=False)
    except user_invites.UserInviteError as exc:  # pragma: no cover - the checks above cover these
        raise InviteError(409, str(exc)) from None
    await audit.record(session, actor, "invite.user.rotate", target_type="user", target_id=user_id,
                       summary=user.username, after={"uses": uses}, reason=reason)
    await session.commit()
