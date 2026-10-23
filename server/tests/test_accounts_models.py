"""迁移 0023_accounts_foundation 与账号 v2 地基表(计划 S1;INDEX §3 实际编号、X4 token 撤销)。"""
import sqlite3
from datetime import datetime, timedelta, timezone

import pytest
from alembic import command
from alembic.script import ScriptDirectory
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.models import User, UserIdentity
from tests.admin_helpers import ADMIN_ENABLED, PASSWORD, login_as
from tests.test_admin_api import register
from tests.test_migrations import _config, _tables


@pytest.fixture
def settings_overrides(tmp_path):
    return {**ADMIN_ENABLED, "data_dir": str(tmp_path / "data"), "rooms_enabled": True}


def _cols(con, table: str) -> set[str]:
    return {row[1] for row in con.execute(f"pragma table_info({table})")}


def test_head_is_0025_and_chain_is_linear(tmp_path, monkeypatch):
    cfg, _db = _config(tmp_path, monkeypatch)
    script = ScriptDirectory.from_config(cfg)
    assert script.get_heads() == ["0031"]
    assert script.get_revision("0024").down_revision == "0023"
    assert script.get_revision("0023").down_revision == "0022"


def test_0023_round_trips_and_backfills_token_expiry(tmp_path, monkeypatch):
    cfg, db = _config(tmp_path, monkeypatch)
    command.upgrade(cfg, "0022")
    con = sqlite3.connect(db)
    con.execute("insert into users (id, username, password_hash, created_at) values (12345678, 'u', 'x', '2026-10-14')")
    con.execute("insert into access_tokens (user_id, token_hash, created_at) values (12345678, 'h1', '2026-10-14')")
    con.commit()
    con.close()

    before = datetime.now(timezone.utc)
    command.upgrade(cfg, "0023")
    con = sqlite3.connect(db)
    assert {"nickname", "email_verified_at"} <= _cols(con, "users")
    assert {"expires_at", "last_used_at"} <= _cols(con, "access_tokens")
    assert "user_identities" in _tables(db)
    expires, last_used = con.execute(
        "select expires_at, last_used_at from access_tokens where token_hash = 'h1'").fetchone()
    assert last_used is None
    assert expires is not None
    got = datetime.fromisoformat(expires).replace(tzinfo=timezone.utc)
    assert abs(got - (before + timedelta(days=30))) < timedelta(days=1)
    con.close()

    command.downgrade(cfg, "0022")
    con = sqlite3.connect(db)
    assert not ({"nickname", "email_verified_at"} & _cols(con, "users"))
    assert not ({"expires_at", "last_used_at"} & _cols(con, "access_tokens"))
    assert "user_identities" not in _tables(db)
    assert con.execute("select count(*) from access_tokens where token_hash = 'h1'").fetchone() == (1,)
    con.close()

    command.upgrade(cfg, "0023")
    con = sqlite3.connect(db)
    assert "user_identities" in _tables(db)
    con.close()


def test_0024_round_trips(tmp_path, monkeypatch):
    cfg, db = _config(tmp_path, monkeypatch)
    command.upgrade(cfg, "0023")
    assert not ({"verification_codes", "email_daily_counts"} & _tables(db))

    command.upgrade(cfg, "0024")
    con = sqlite3.connect(db)
    assert {"verification_codes", "email_daily_counts"} <= _tables(db)
    assert _cols(con, "verification_codes") == {
        "id", "channel", "purpose", "target_hmac", "user_id", "code_hmac", "expires_at", "attempts",
        "consumed_at", "created_at"}
    assert _cols(con, "email_daily_counts") == {"day", "sent"}
    con.execute("insert into email_daily_counts (day, sent) values ('2026-10-19', 3)")
    con.execute(
        "insert into verification_codes (channel, purpose, target_hmac, code_hmac, expires_at, attempts, created_at)"
        " values ('email', 'register', 't', 'c', '2026-10-19', 0, '2026-10-19')")
    con.commit()
    con.close()

    command.downgrade(cfg, "0023")
    assert not ({"verification_codes", "email_daily_counts"} & _tables(db))
    con = sqlite3.connect(db)
    assert {"nickname", "email_verified_at"} <= _cols(con, "users")  # 0023 stays intact
    con.close()

    command.upgrade(cfg, "0024")
    assert {"verification_codes", "email_daily_counts"} <= _tables(db)


def test_verification_codes_indexes(tmp_path, monkeypatch):
    cfg, db = _config(tmp_path, monkeypatch)
    command.upgrade(cfg, "head")
    con = sqlite3.connect(db)
    indexes = {row[1]: row[2] for row in con.execute("pragma index_list(verification_codes)")}
    assert "ix_verification_codes_target_purpose_created" in indexes
    columns = [row[2] for row in con.execute("pragma index_info(ix_verification_codes_target_purpose_created)")]
    assert columns == ["target_hmac", "purpose", "created_at"]
    assert "ix_verification_codes_user_id" in indexes
    con.close()


async def test_deleting_user_removes_their_verification_codes(app, client):
    from app.models import VerificationCode

    uid, _ = await register(client, "jane")
    now = datetime.now(timezone.utc)
    async with app.state.sessionmaker() as s:
        s.add(VerificationCode(channel="email", purpose="bind", target_hmac="t" * 64, user_id=uid,
                               code_hmac="c" * 64, expires_at=now + timedelta(minutes=10), created_at=now))
        await s.commit()
    h = await login_as(app, client, "superadmin")
    await client.post("/api/admin/step-up", headers=h, json={"password": PASSWORD})
    r = await client.request("DELETE", f"/api/admin/users/{uid}", headers=h,
                             json={"confirm_username": "jane", "reason": "用户要求注销"})
    assert r.status_code == 200, r.text
    async with app.state.sessionmaker() as s:
        left = await s.scalar(select(func.count()).select_from(VerificationCode))
    assert left == 0


async def test_user_identities_unique_per_provider_subject_and_per_user(app):
    now = datetime.now(timezone.utc)
    async with app.state.sessionmaker() as s:
        s.add_all([User(id=11111111, username="ua", password_hash="x"),
                   User(id=22222222, username="ub", password_hash="x")])
        s.add(UserIdentity(user_id=11111111, provider="email", subject_hmac="a" * 64, subject_enc="enc",
                           verified_at=now))
        await s.commit()

    # same (provider, subject_hmac) for another user: refused
    async with app.state.sessionmaker() as s:
        s.add(UserIdentity(user_id=22222222, provider="email", subject_hmac="a" * 64, subject_enc="enc2",
                           verified_at=now))
        with pytest.raises(IntegrityError):
            await s.commit()

    # same user, same provider, another subject: refused (one identity per provider per user)
    async with app.state.sessionmaker() as s:
        s.add(UserIdentity(user_id=11111111, provider="email", subject_hmac="b" * 64, subject_enc="enc3",
                           verified_at=now))
        with pytest.raises(IntegrityError):
            await s.commit()


async def test_deleting_user_cascades_identities(app, client):
    uid, _ = await register(client, "ivan")
    now = datetime.now(timezone.utc)
    async with app.state.sessionmaker() as s:
        s.add(UserIdentity(user_id=uid, provider="email", subject_hmac="c" * 64, subject_enc="enc",
                           verified_at=now))
        await s.commit()

    h = await login_as(app, client, "superadmin")
    await client.post("/api/admin/step-up", headers=h, json={"password": PASSWORD})
    r = await client.request("DELETE", f"/api/admin/users/{uid}", headers=h,
                             json={"confirm_username": "ivan", "reason": "用户要求注销"})
    assert r.status_code == 200, r.text
    async with app.state.sessionmaker() as s:
        left = await s.scalar(select(func.count()).select_from(UserIdentity).where(UserIdentity.user_id == uid))
    assert left == 0
