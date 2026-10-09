"""管理员账号:env 应急超级管理员 + 库内账号(spec §4.1)。不存在的用户名也跑一次 argon2(等时)。"""
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import delete, func, select

from app.admin.auth import credentials_match
from app.admin.totp import new_recovery_codes, normalise_recovery_code
from app.core.secretbox import SecretBoxError
from app.core.security import hash_password, verify_password
from app.models import AdminAccount, AdminRecoveryCode, iso_utc

logger = logging.getLogger(__name__)

USERNAME_RE = re.compile(r"^[a-z0-9_.-]{3,32}$")
_DUMMY_HASH = hash_password("timing-equaliser-password")


@dataclass(frozen=True)
class Principal:
    account_id: int | None
    username: str
    role: str
    totp_secret: str | None


async def authenticate(session, settings, box, username: str, password: str) -> Principal | None:
    name = username.strip().lower()
    if settings.admin_username.strip() and credentials_match(settings, username, password):
        return Principal(None, settings.admin_username.strip(), "superadmin", settings.admin_totp_secret or None)
    account = await session.scalar(select(AdminAccount).where(AdminAccount.username == name))
    if account is None:
        verify_password(_DUMMY_HASH, password)
        return None
    if not verify_password(account.password_hash, password) or account.disabled_at is not None:
        return None
    secret = None
    if account.totp_enc:
        # A bound TOTP that cannot be read (no or rotated SETTINGS_ENCRYPTION_KEY) must never turn into "no MFA":
        # the login fails; the env emergency account or `recover reset-totp` gets the admin back in.
        try:
            secret = box.decrypt(account.totp_enc) if box else None
        except SecretBoxError:
            secret = None
        if not secret:
            logger.warning("admin login refused: totp unreadable account_id=%s", account.id)
            return None
    account.last_login_at = datetime.now(timezone.utc)
    return Principal(account.id, account.username, account.role, secret)


async def create_account(session, *, username: str, password: str, role: str, created_by: str) -> AdminAccount:
    name = username.strip().lower()
    if not USERNAME_RE.fullmatch(name):
        raise ValueError("Invalid username")
    if len(password) < 12:
        raise ValueError("Password must be at least 12 characters")
    if role not in ("viewer", "operator", "superadmin"):
        raise ValueError("Invalid role")
    account = AdminAccount(username=name, password_hash=hash_password(password), role=role, created_by=created_by)
    session.add(account)
    await session.flush()
    return account


async def get_account(session, account_id: int) -> AdminAccount | None:
    return await session.get(AdminAccount, account_id)


def account_out(account: AdminAccount) -> dict:
    """Public shape of a DB account: never the password hash, TOTP secret or recovery codes."""
    return {"id": account.id, "username": account.username, "role": account.role, "env": False,
            "totp": bool(account.totp_enc), "disabled": account.disabled_at is not None,
            "created_by": account.created_by, "created_at": iso_utc(account.created_at),
            "last_login_at": iso_utc(account.last_login_at) if account.last_login_at else None}


async def list_accounts(session, settings) -> list[dict]:
    """Env emergency account first (id None, always superadmin, not editable here), then DB accounts by id."""
    out = []
    if settings.admin_username.strip():
        out.append({"id": None, "username": settings.admin_username.strip(), "role": "superadmin", "env": True,
                    "totp": bool(settings.admin_totp_secret.strip()), "disabled": False, "created_by": None,
                    "created_at": None, "last_login_at": None})
    rows = (await session.scalars(select(AdminAccount).order_by(AdminAccount.id))).all()
    return out + [account_out(a) for a in rows]


async def _enabled_superadmins(session) -> int:
    return await session.scalar(select(func.count()).select_from(AdminAccount).where(
        AdminAccount.role == "superadmin", AdminAccount.disabled_at.is_(None))) or 0


async def update_account(session, account_id: int, *, role: str | None = None,
                         disabled: bool | None = None) -> AdminAccount:
    """Change role / enable state. The last enabled DB superadmin can be neither demoted nor disabled
    (the env account does not count: it may be removed from .env at any time)."""
    account = await session.get(AdminAccount, account_id)
    if account is None:
        raise LookupError("Account not found")
    if role is not None and role not in ("viewer", "operator", "superadmin"):
        raise ValueError("Invalid role")
    losing = account.role == "superadmin" and account.disabled_at is None and (
        (role is not None and role != "superadmin") or disabled is True)
    if losing and await _enabled_superadmins(session) <= 1:
        raise ValueError("Cannot remove the last superadmin")
    if role is not None:
        account.role = role
    if disabled is not None:
        account.disabled_at = (account.disabled_at or datetime.now(timezone.utc)) if disabled else None
    await session.flush()
    return account


async def reset_totp(session, account_id: int) -> None:
    account = await session.get(AdminAccount, account_id)
    if account is None:
        raise LookupError("Account not found")
    account.totp_enc, account.totp_last_step = None, None
    await session.execute(delete(AdminRecoveryCode).where(AdminRecoveryCode.account_id == account_id))


async def set_password(session, account_id: int, password: str) -> None:
    if len(password) < 12:
        raise ValueError("Password must be at least 12 characters")
    account = await session.get(AdminAccount, account_id)
    if account is None:
        raise LookupError("Account not found")
    account.password_hash = hash_password(password)
    account.password_changed_at = datetime.now(timezone.utc)


async def check_password(session, settings, account_id: int | None, username: str, password: str) -> bool:
    """Re-check the signed-in admin's password (step-up, password change). Env account: env credentials."""
    if account_id is None:
        return bool(settings.admin_username.strip()) and credentials_match(settings, username, password)
    account = await session.get(AdminAccount, account_id)
    if account is None or account.disabled_at is not None:
        verify_password(_DUMMY_HASH, password)
        return False
    return verify_password(account.password_hash, password)


def totp_secret(settings, box, account: AdminAccount | None) -> str | None:
    """The bound TOTP secret (env account: ADMIN_TOTP_SECRET), or None when unbound or unreadable."""
    if account is None:
        return settings.admin_totp_secret.strip() or None
    if not account.totp_enc or box is None:
        return None
    try:
        return box.decrypt(account.totp_enc)
    except SecretBoxError:
        return None


async def replace_recovery_codes(session, account_id: int) -> list[str]:
    """New one-time recovery codes (argon2 hashes stored); the plain codes are returned exactly once."""
    await session.execute(delete(AdminRecoveryCode).where(AdminRecoveryCode.account_id == account_id))
    codes = new_recovery_codes()
    session.add_all([AdminRecoveryCode(account_id=account_id, code_hash=hash_password(c)) for c in codes])
    return codes


async def use_recovery_code(session, account_id: int, code: str, now: datetime) -> bool:
    code = normalise_recovery_code(code)
    if len(code) != 9:
        return False
    rows = (await session.scalars(select(AdminRecoveryCode).where(
        AdminRecoveryCode.account_id == account_id, AdminRecoveryCode.used_at.is_(None)))).all()
    for row in rows:
        if verify_password(row.code_hash, code):
            row.used_at = now
            return True
    return False
