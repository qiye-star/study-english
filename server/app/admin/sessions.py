"""库内管理会话(spec §4.3):token 与 CSRF 只存 SHA-256;Cookie HttpOnly + SameSite=Strict(+ __Host-/Secure)。"""
import hmac
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update

from app.core.security import hash_token
from app.models import AdminSession, iso_utc, new_uuid

SECURE_COOKIE = "__Host-enjoy_admin"
DEV_COOKIE = "enjoy_admin"
TOUCH_EVERY = timedelta(minutes=1)


def _utc(v: datetime) -> datetime:
    return v if v.tzinfo else v.replace(tzinfo=timezone.utc)


def cookie_name(settings) -> str:
    return SECURE_COOKIE if settings.admin_cookie_secure else DEV_COOKIE


def csrf_for(secret: bytes, session_id: str) -> str:
    """签名式双重提交:CSRF = HMAC(admin_secret, 会话 id)。可随时重新推导(刷新页面、多标签页共用),库里只存哈希。"""
    return hmac.new(secret, f"csrf:{session_id}".encode(), "sha256").hexdigest()


async def create(session, principal, *, secret: bytes, ip: str, user_agent: str, now: datetime, ttl_minutes: int,
                 mfa_done: bool) -> tuple[AdminSession, str, str]:
    token = secrets.token_urlsafe(32)
    row = AdminSession(id=new_uuid(), token_hash=hash_token(token), account_id=principal.account_id,
                       username=principal.username, created_at=now, last_seen_at=now,
                       expires_at=now + timedelta(minutes=ttl_minutes), ip=ip[:64], user_agent=user_agent[:120],
                       mfa_at=now if mfa_done else None, csrf_hash="")
    csrf = csrf_for(secret, row.id)
    row.csrf_hash = hash_token(csrf)
    session.add(row)
    await session.flush()
    return row, token, csrf


async def resolve(session, token: str, now: datetime, idle_minutes: int) -> AdminSession | None:
    row = await session.scalar(select(AdminSession).where(AdminSession.token_hash == hash_token(token)))
    if row is None or row.revoked_at is not None:
        return None
    if _utc(row.expires_at) <= now or _utc(row.last_seen_at) + timedelta(minutes=idle_minutes) <= now:
        return None
    return row


async def touch(session, row: AdminSession, now: datetime) -> None:
    if now - _utc(row.last_seen_at) >= TOUCH_EVERY:
        row.last_seen_at = now
        await session.commit()


async def revoke(session, row_id: str, now: datetime) -> bool:
    result = await session.execute(update(AdminSession).where(AdminSession.id == row_id, AdminSession.revoked_at.is_(None))
                                   .values(revoked_at=now))
    return bool(result.rowcount)


async def revoke_all(session, *, account_id, username: str, now: datetime, except_id: str | None = None) -> int:
    query = update(AdminSession).where(AdminSession.revoked_at.is_(None), AdminSession.username == username)
    if account_id is None:
        query = query.where(AdminSession.account_id.is_(None))
    else:
        query = query.where(AdminSession.account_id == account_id)
    if except_id:
        query = query.where(AdminSession.id != except_id)
    return (await session.execute(query.values(revoked_at=now))).rowcount or 0


def check_csrf(row: AdminSession, header: str | None) -> bool:
    return bool(header) and hmac.compare_digest(hash_token(header), row.csrf_hash)


def set_cookie(response, settings, token: str, max_age: int) -> None:
    response.set_cookie(cookie_name(settings), token, max_age=max_age, path="/", httponly=True,
                        secure=settings.admin_cookie_secure, samesite="strict")


def clear_cookie(response, settings) -> None:
    response.delete_cookie(cookie_name(settings), path="/", secure=settings.admin_cookie_secure,
                           httponly=True, samesite="strict")


def session_out(row: AdminSession, current_id: str | None) -> dict:
    return {"id": row.id, "username": row.username, "ip": row.ip, "user_agent": row.user_agent,
            "created_at": iso_utc(row.created_at), "last_seen_at": iso_utc(row.last_seen_at),
            "expires_at": iso_utc(row.expires_at), "current": row.id == current_id}
