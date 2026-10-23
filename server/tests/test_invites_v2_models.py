"""Invites v2 schema (plan 2026-10-14-invites-v2 S1; migration 0026, R-I1): kinds, owners, redemptions, and what
deleting a user does to them."""
import sqlite3
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.models import InviteCode, InviteRedemption, User
from tests.admin_helpers import ADMIN_ENABLED, PASSWORD, login_as
from tests.test_admin_api import register

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture
def settings_overrides(tmp_path):
    return {**ADMIN_ENABLED, "data_dir": str(tmp_path / "data")}


def _config(tmp_path, monkeypatch) -> tuple[Config, Path]:
    db = tmp_path / "m.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{db.as_posix()}")
    cfg = Config(str(ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(ROOT / "alembic"))
    return cfg, db


def _columns(db: Path, table: str) -> set[str]:
    con = sqlite3.connect(db)
    try:
        return {row[1] for row in con.execute(f"pragma table_info({table})")}
    finally:
        con.close()


def _tables(db: Path) -> set[str]:
    con = sqlite3.connect(db)
    try:
        return {row[0] for row in con.execute("select name from sqlite_master where type='table'")}
    finally:
        con.close()


def test_0026_follows_0025_and_the_head_is_0027():
    script = ScriptDirectory.from_config(Config(str(ROOT / "alembic.ini")))
    assert script.get_heads() == ["0031"]  # the head moved to 0027 (captcha replay table)
    assert script.get_revision("0026").down_revision == "0025"


def test_round_trip_keeps_old_codes_as_admin_codes(tmp_path, monkeypatch):
    cfg, db = _config(tmp_path, monkeypatch)
    command.upgrade(cfg, "0025")
    con = sqlite3.connect(db)
    try:
        con.execute("insert into invite_codes (code_hash, label, max_uses, uses, created_by, created_at) "
                    "values ('old-hash', '班级 A', 3, 1, 'operator', '2026-10-05 00:00:00')")
        con.commit()
    finally:
        con.close()

    command.upgrade(cfg, "head")
    assert {"kind", "owner_user_id", "code_enc"} <= _columns(db, "invite_codes")
    assert "invite_redemptions" in _tables(db)
    con = sqlite3.connect(db)
    try:
        assert con.execute("select kind, owner_user_id, code_enc, max_uses, uses from invite_codes "
                           "where code_hash = 'old-hash'").fetchone() == ("admin", None, None, 3, 1)
    finally:
        con.close()

    command.downgrade(cfg, "0025")
    assert not {"kind", "owner_user_id", "code_enc"} & _columns(db, "invite_codes")
    assert "invite_redemptions" not in _tables(db)
    command.upgrade(cfg, "head")
    assert "invite_redemptions" in _tables(db)


async def test_one_live_user_code_per_owner_and_admin_codes_are_free(app, client):
    uid, _ = await register(client, "owner1")
    async with app.state.sessionmaker() as s:
        s.add(InviteCode(code_hash="u-1", max_uses=10, uses=0, created_by="owner1", kind="user", owner_user_id=uid))
        await s.commit()
    async with app.state.sessionmaker() as s:
        s.add(InviteCode(code_hash="u-2", max_uses=10, uses=0, created_by="owner1", kind="user", owner_user_id=uid))
        with pytest.raises(IntegrityError):
            await s.commit()
    async with app.state.sessionmaker() as s:
        first = await s.scalar(select(InviteCode).where(InviteCode.code_hash == "u-1"))
        first.revoked_at = first.created_at  # any non-null time
        await s.commit()
    async with app.state.sessionmaker() as s:
        s.add(InviteCode(code_hash="u-2", max_uses=10, uses=0, created_by="owner1", kind="user", owner_user_id=uid))
        await s.commit()  # the old code is revoked, so a new one may be live
    async with app.state.sessionmaker() as s:
        for n in range(3):  # admin codes carry no owner, so the partial index never sees them
            s.add(InviteCode(code_hash=f"a-{n}", max_uses=1, uses=0, created_by="op"))
        await s.commit()
        assert await s.scalar(select(func.count()).select_from(InviteCode).where(InviteCode.kind == "admin")) == 3


async def test_redemption_is_one_per_invitee_but_anonymous_rows_may_repeat(app, client):
    invitee, _ = await register(client, "guest1")
    async with app.state.sessionmaker() as s:
        s.add(InviteCode(code_hash="r-code", max_uses=5, uses=1, created_by="op"))
        await s.flush()
        code_id = await s.scalar(select(InviteCode.id).where(InviteCode.code_hash == "r-code"))
        s.add(InviteRedemption(code_id=code_id, user_id=invitee))
        await s.commit()
    async with app.state.sessionmaker() as s:
        s.add(InviteRedemption(code_id=code_id, user_id=invitee))
        with pytest.raises(IntegrityError):
            await s.commit()
    async with app.state.sessionmaker() as s:
        s.add(InviteRedemption(code_id=code_id, user_id=None))
        s.add(InviteRedemption(code_id=code_id, user_id=None))
        await s.commit()


async def test_deleting_the_owner_revokes_the_user_code_and_clears_its_copy(app, client):
    owner, _ = await register(client, "owner2")
    async with app.state.sessionmaker() as s:
        s.add(InviteCode(code_hash="o-code", max_uses=10, uses=2, created_by="owner2", kind="user",
                         owner_user_id=owner, code_enc="ciphertext-not-a-code"))
        await s.commit()
    h = await login_as(app, client, "superadmin")
    await client.post("/api/admin/step-up", headers=h, json={"password": PASSWORD})
    r = await client.request("DELETE", f"/api/admin/users/{owner}", headers=h,
                             json={"confirm_username": "owner2", "reason": "用户要求注销"})
    assert r.status_code == 200, r.text
    async with app.state.sessionmaker() as s:
        row = await s.scalar(select(InviteCode).where(InviteCode.code_hash == "o-code"))
        assert row.owner_user_id is None and row.code_enc is None and row.revoked_at is not None
        assert row.uses == 2  # the usage count stays with the (dead) code


async def test_deleting_an_invitee_keeps_the_redemption_without_the_user_id(app, client):
    invitee, _ = await register(client, "guest2")
    async with app.state.sessionmaker() as s:
        s.add(InviteCode(code_hash="g-code", max_uses=1, uses=1, created_by="op"))
        await s.flush()
        code_id = await s.scalar(select(InviteCode.id).where(InviteCode.code_hash == "g-code"))
        s.add(InviteRedemption(code_id=code_id, user_id=invitee))
        await s.commit()
    h = await login_as(app, client, "superadmin")
    await client.post("/api/admin/step-up", headers=h, json={"password": PASSWORD})
    r = await client.request("DELETE", f"/api/admin/users/{invitee}", headers=h,
                             json={"confirm_username": "guest2", "reason": "用户要求注销"})
    assert r.status_code == 200, r.text
    async with app.state.sessionmaker() as s:
        assert await s.get(User, invitee) is None
        rows = (await s.scalars(select(InviteRedemption).where(InviteRedemption.code_id == code_id))).all()
        assert len(rows) == 1 and rows[0].user_id is None
