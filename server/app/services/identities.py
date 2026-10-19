"""账号身份与登录会话的数据库操作(INDEX X4、X32;邮箱身份见计划 S13、R-F1)。

纯函数:会话、设置与时间都由调用方传入;不提交事务(调用方与其他写入同一次提交);不记录日志。
邮箱:`subject_hmac` = HMAC-SHA256(pepper, "email:" + identity_key) 用于查找与唯一性,`subject_enc` 是 secretbox
加密的规范化原值(保留 +标签,发信发到用户输入的地址)。邮箱、HMAC、密文都不进日志或异常信息。
"""
import hashlib
import hmac
import re
from datetime import datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.secretbox import SecretBox, SecretBoxError, box_for
from app.core.security import hash_token, new_token
from app.models import AccessToken, SpeechToken, User, UserIdentity

EMAIL_PROVIDER = "email"
_INVALID = "invalid email"
_LOCAL = re.compile(r"[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*")
_LABEL = re.compile(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?")


class EmailNotConfigured(Exception):
    """IDENTITY_PEPPER or the encryption key is missing / unusable (INDEX X9)."""


class EmailTaken(Exception):
    """The email already belongs to another account. The message never names the address."""


def normalize_email(raw: str) -> str:
    """Trim, lowercase and validate (R-F1). ASCII only; one `@`; no whitespace or control characters (header
    injection); total <= 254, local <= 64, domain with at least one dot and valid labels. Raises ValueError("invalid
    email") without echoing the input."""
    if not isinstance(raw, str):
        raise ValueError(_INVALID)
    if "\r" in raw or "\n" in raw:  # a line break anywhere is header injection, even at the ends
        raise ValueError(_INVALID)
    email = raw.strip().lower()
    if not email or len(email) > 254 or not email.isascii() or email.count("@") != 1:
        raise ValueError(_INVALID)
    local, domain = email.split("@")
    labels = domain.split(".")
    if (not local or len(local) > 64 or not _LOCAL.fullmatch(local) or len(labels) < 2
            or not all(_LABEL.fullmatch(label) for label in labels)):
        raise ValueError(_INVALID)
    return email


def identity_key(email: str) -> str:
    """The uniqueness key: the normalised address without the `+tag` of the local part (dots are kept, spec section 3)."""
    local, domain = normalize_email(email).split("@")
    local = local.split("+", 1)[0]
    if not local:
        raise ValueError(_INVALID)
    return f"{local}@{domain}"


def subject_hmac(pepper: str, email: str) -> str:
    if not pepper:
        raise EmailNotConfigured("email is not configured")
    return hmac.new(pepper.encode(), f"email:{identity_key(email)}".encode(), hashlib.sha256).hexdigest()


def encrypt_email(box: SecretBox, email: str) -> str:
    return box.encrypt(normalize_email(email))


def decrypt_email(box: SecretBox, token: str) -> str:
    return box.decrypt(token)


def mask_email(email: str) -> str:
    """`alice@qq.com` -> `a***@qq.com` (the admin and /api/me only ever see this form)."""
    try:
        local, domain = normalize_email(email).split("@")
    except ValueError:
        return "***"
    return f"{local[0]}***@{domain}"


def email_ready(settings: Settings) -> bool:
    """Email features need BOTH keys and a backend (INDEX X9)."""
    if settings.email_backend == "off" or not settings.identity_pepper:
        return False
    try:
        return box_for(settings) is not None
    except SecretBoxError:
        return False


def _box(settings: Settings) -> SecretBox:
    try:
        box = box_for(settings)
    except SecretBoxError:
        box = None
    if box is None or not settings.identity_pepper:
        raise EmailNotConfigured("email is not configured")
    return box


async def find_user_by_email(session: AsyncSession, settings: Settings, email: str) -> User | None:
    """The user whose verified email has the same identity key, or None (also for a malformed address)."""
    if not settings.identity_pepper:
        return None
    try:
        key = subject_hmac(settings.identity_pepper, email)
    except ValueError:
        return None
    return (await session.execute(
        select(User).join(UserIdentity, UserIdentity.user_id == User.id)
        .where(UserIdentity.provider == EMAIL_PROVIDER, UserIdentity.subject_hmac == key))).scalar_one_or_none()


async def bind_email(session: AsyncSession, settings: Settings, user: User, email: str, now: datetime) -> None:
    """Attach the verified email to the user (replacing the user's current one) and set `users.email_verified_at`.
    Does not commit. Raises EmailTaken when another account owns it (a concurrent bind trips the unique
    constraint at flush time instead: the caller treats IntegrityError the same way)."""
    box = _box(settings)
    key = subject_hmac(settings.identity_pepper, email)
    enc = encrypt_email(box, email)
    holder = (await session.execute(select(UserIdentity).where(
        UserIdentity.provider == EMAIL_PROVIDER, UserIdentity.subject_hmac == key))).scalar_one_or_none()
    if holder is not None and holder.user_id != user.id:
        raise EmailTaken("email is already in use")
    own = holder or (await session.execute(select(UserIdentity).where(
        UserIdentity.provider == EMAIL_PROVIDER, UserIdentity.user_id == user.id))).scalar_one_or_none()
    if own is None:
        session.add(UserIdentity(user_id=user.id, provider=EMAIL_PROVIDER, subject_hmac=key, subject_enc=enc,
                                 verified_at=now))
    else:
        own.subject_hmac, own.subject_enc, own.verified_at = key, enc, now
    user.email_verified_at = now
    await session.flush()


async def clear_email(session: AsyncSession, user: User) -> None:
    """Remove the user's email identity and the verified flag. Does not commit."""
    await session.execute(delete(UserIdentity).where(
        UserIdentity.user_id == user.id, UserIdentity.provider == EMAIL_PROVIDER))
    user.email_verified_at = None


async def revoke_sessions(session: AsyncSession, user_id: int) -> int:
    """Delete every login token of the user and every unredeemed speech token; returns the login tokens removed."""
    access = await session.execute(delete(AccessToken).where(AccessToken.user_id == user_id))
    await session.execute(delete(SpeechToken).where(SpeechToken.user_id == user_id, SpeechToken.state == "issued"))
    return access.rowcount or 0


async def change_password(session: AsyncSession, user, password_hash: str, settings: Settings, now: datetime) -> str:
    """Set the new password hash, drop every login and return one fresh token. Does not commit: the caller commits,
    so the new hash and the rotated tokens land in one transaction."""
    user.password_hash = password_hash
    await revoke_sessions(session, user.id)
    return issue_token(session, user.id, settings, now)


def issue_token(session: AsyncSession, user_id: int, settings: Settings, now: datetime) -> str:
    """Add a login token row (the caller commits) and return the plaintext token, which is never stored."""
    token = new_token()
    session.add(AccessToken(
        user_id=user_id, token_hash=hash_token(token), created_at=now,
        expires_at=now + timedelta(days=settings.access_token_ttl_days), last_used_at=now,
    ))
    return token
