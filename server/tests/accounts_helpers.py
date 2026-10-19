"""Helpers for the accounts v2 email tests (plan S16+): switch email on with a FakeSender, read mailed codes."""
import re
from datetime import timedelta

from cryptography.fernet import Fernet
from sqlalchemy import select

from app.providers.email import FakeSender
from app.services.identities import bind_email, normalize_email
from app.models import User, VerificationCode, utcnow

PEPPER = "test-pepper-" + "x" * 32


def enable_email(app, **overrides) -> FakeSender:
    """Both keys, a backend and a FakeSender behind `app.state.email_sender_override` (INDEX X9, X15).
    Extra keyword arguments override other settings (for example `email_codes_per_target_daily=2`)."""
    values = dict(identity_pepper=PEPPER, settings_encryption_key=Fernet.generate_key().decode(),
                  email_backend="console")
    values.update(overrides)
    new = app.state.settings.model_copy(update=values)  # skips validators: callers pass valid values
    app.state.base_settings = app.state.settings = new
    app.state.email_ip_limiter.limit = new.email_codes_per_ip_hourly
    sender = FakeSender()
    app.state.email_sender_override = sender
    return sender


def fake_sender(app) -> FakeSender:
    return app.state.email_sender_override


def last_code(app, email: str) -> str:
    """The 6-digit code in the newest mail to `email` (the address is compared in its normalised form)."""
    wanted = normalize_email(email)
    for to, _subject, body in reversed(fake_sender(app).outbox):
        if to == wanted:
            found = re.findall(r"\b(\d{6})\b", body)
            if found:
                return found[0]
    raise AssertionError("no code was mailed to that address")


async def bind(app, user_id: int, email: str) -> None:
    """Give an existing user a verified email directly in the database."""
    async with app.state.sessionmaker() as s:
        user = await s.get(User, user_id)
        await bind_email(s, app.state.settings, user, email, utcnow())
        await s.commit()


async def age_codes(app, *, seconds: int = 0, hours: int = 0) -> None:
    """Move every stored code into the past (fake clock for the cooldown and the daily window)."""
    delta = timedelta(seconds=seconds, hours=hours)
    async with app.state.sessionmaker() as s:
        for row in (await s.execute(select(VerificationCode))).scalars():
            row.created_at = row.created_at - delta
            row.expires_at = row.expires_at - delta
        await s.commit()
