"""登录 token 的过期与滑动续期(计划 S3;R-F8、INDEX X4)。"""
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update

from app.core import deps
from app.core.security import hash_token
from app.models import AccessToken
from tests.test_admin_api import register


def _utc(value: datetime) -> datetime:
    """SQLite 读回的是 naive 时间(实为 UTC)。"""
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


async def _row(app, headers) -> AccessToken:
    token = headers["Authorization"].split(" ", 1)[1]
    async with app.state.sessionmaker() as s:
        return await s.scalar(select(AccessToken).where(AccessToken.token_hash == hash_token(token)))


async def _set(app, headers, **values) -> None:
    row = await _row(app, headers)
    async with app.state.sessionmaker() as s:
        await s.execute(update(AccessToken).where(AccessToken.id == row.id).values(**values))
        await s.commit()


async def test_new_token_expires_after_ttl(app, client):
    _uid, headers = await register(client, "tia")
    row = await _row(app, headers)
    now = datetime.now(timezone.utc)
    assert row.expires_at is not None
    assert abs(_utc(row.expires_at) - (now + timedelta(days=30))) < timedelta(minutes=5)
    assert row.last_used_at is not None


async def test_expired_token_is_401(app, client):
    _uid, headers = await register(client, "tib")
    await _set(app, headers, expires_at=datetime.now(timezone.utc) - timedelta(days=1))
    r = await client.get("/api/me", headers=headers)
    assert r.status_code == 401


async def test_null_expiry_is_accepted_and_filled_on_use(app, client):
    _uid, headers = await register(client, "tic")
    await _set(app, headers, expires_at=None, last_used_at=None)
    r = await client.get("/api/me", headers=headers)
    assert r.status_code == 200, r.text
    row = await _row(app, headers)
    assert row.expires_at is not None
    assert row.last_used_at is not None


async def test_sliding_renewal_writes_at_most_once_per_hour(app, client, monkeypatch):
    _uid, headers = await register(client, "tid")
    t0 = datetime.now(timezone.utc).replace(microsecond=0)
    clock = {"now": t0}
    monkeypatch.setattr(deps, "utcnow", lambda: clock["now"])
    await _set(app, headers, expires_at=t0 + timedelta(days=1), last_used_at=t0 - timedelta(hours=2))

    assert (await client.get("/api/me", headers=headers)).status_code == 200  # writes: last use was 2 h ago
    first = await _row(app, headers)
    assert _utc(first.last_used_at) == t0
    assert abs(_utc(first.expires_at) - (t0 + timedelta(days=30))) < timedelta(seconds=1)

    assert (await client.get("/api/me", headers=headers)).status_code == 200  # same instant: no write
    second = await _row(app, headers)
    assert _utc(second.last_used_at) == t0
    assert _utc(second.expires_at) == _utc(first.expires_at)

    clock["now"] = t0 + timedelta(minutes=61)
    assert (await client.get("/api/me", headers=headers)).status_code == 200
    third = await _row(app, headers)
    assert _utc(third.last_used_at) == t0 + timedelta(minutes=61)
    assert _utc(third.expires_at) > _utc(second.expires_at)


async def test_ttl_change_is_hot(app, client):
    app.state.settings = app.state.settings.model_copy(update={"access_token_ttl_days": 1})
    _uid, headers = await register(client, "tie")
    row = await _row(app, headers)
    now = datetime.now(timezone.utc)
    assert abs(_utc(row.expires_at) - (now + timedelta(days=1))) < timedelta(minutes=5)


async def test_token_lifecycle_logs_nothing_sensitive(app, client, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    _uid, headers = await register(client, "tif")
    assert (await client.get("/api/me", headers=headers)).status_code == 200
    token = headers["Authorization"].split(" ", 1)[1]
    assert token not in caplog.text
    assert "password123" not in caplog.text
