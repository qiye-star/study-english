"""迁移 0025_accounts_avatar 与头像模型(计划 S2):users.avatar_id(唯一)、avatar_reports(每人每头像只举报一次)。"""
import sqlite3
from datetime import datetime, timezone

import pytest
from alembic import command
from alembic.script import ScriptDirectory
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.models import AvatarReport, User
from tests.admin_helpers import ADMIN_ENABLED, PASSWORD, login_as
from tests.test_admin_api import register
from tests.test_migrations import _config, _tables


@pytest.fixture
def settings_overrides(tmp_path):
    return {**ADMIN_ENABLED, "data_dir": str(tmp_path / "data")}


def _cols(con, table: str) -> set[str]:
    return {row[1] for row in con.execute(f"pragma table_info({table})")}


def test_head_is_0025_and_chain_is_linear(tmp_path, monkeypatch):
    cfg, _db = _config(tmp_path, monkeypatch)
    script = ScriptDirectory.from_config(cfg)
    assert script.get_heads() == ["0031"]
    assert script.get_revision("0025").down_revision == "0024"
    assert script.get_revision("0024").down_revision == "0023"


def test_0025_round_trips(tmp_path, monkeypatch):
    cfg, db = _config(tmp_path, monkeypatch)
    command.upgrade(cfg, "0024")
    con = sqlite3.connect(db)
    assert "avatar_id" not in _cols(con, "users")
    con.close()
    assert "avatar_reports" not in _tables(db)

    command.upgrade(cfg, "0025")
    con = sqlite3.connect(db)
    assert "avatar_id" in _cols(con, "users")
    assert _cols(con, "avatar_reports") == {
        "id", "avatar_user_id", "avatar_id", "reporter_id", "reason", "created_at", "resolved_at"}
    indexes = {row[1] for row in con.execute("pragma index_list(users)")}
    assert "uq_users_avatar_id" in indexes
    con.close()

    command.downgrade(cfg, "0024")
    con = sqlite3.connect(db)
    assert "avatar_id" not in _cols(con, "users")
    # 0023 and 0024 stay intact
    assert {"nickname", "email_verified_at"} <= _cols(con, "users")
    assert {"verification_codes", "email_daily_counts"} <= _tables(db)
    con.close()
    assert "avatar_reports" not in _tables(db)

    command.upgrade(cfg, "head")
    assert "avatar_reports" in _tables(db)


async def test_users_avatar_id_is_unique_when_set(app):
    async with app.state.sessionmaker() as s:
        s.add_all([User(id=11111111, username="av1", password_hash="x", avatar_id="a" * 32),
                   User(id=22222222, username="av2", password_hash="x")])
        await s.commit()

    # a second user with the same avatar id is refused
    async with app.state.sessionmaker() as s:
        s.add(User(id=33333333, username="av3", password_hash="x", avatar_id="a" * 32))
        with pytest.raises(IntegrityError):
            await s.commit()

    # several users without an avatar are fine (NULL is not a value)
    async with app.state.sessionmaker() as s:
        s.add(User(id=44444444, username="av4", password_hash="x"))
        await s.commit()


async def test_avatar_reports_unique_per_reporter_and_avatar(app):
    now = datetime.now(timezone.utc)
    async with app.state.sessionmaker() as s:
        s.add_all([User(id=11111111, username="rp1", password_hash="x"),
                   User(id=22222222, username="rp2", password_hash="x"),
                   User(id=33333333, username="rp3", password_hash="x")])
        s.add(AvatarReport(avatar_user_id=22222222, avatar_id="b" * 32, reporter_id=11111111,
                           reason="other", created_at=now))
        await s.commit()

    # same reporter, same avatar: refused (a second report is answered 200 by the router, stored once)
    async with app.state.sessionmaker() as s:
        s.add(AvatarReport(avatar_user_id=22222222, avatar_id="b" * 32, reporter_id=11111111,
                           reason="inappropriate", created_at=now))
        with pytest.raises(IntegrityError):
            await s.commit()

    # same reporter, another avatar of the same user: allowed
    async with app.state.sessionmaker() as s:
        s.add(AvatarReport(avatar_user_id=22222222, avatar_id="c" * 32, reporter_id=11111111,
                           reason="other", created_at=now))
        await s.commit()

    # another reporter, same avatar: allowed
    async with app.state.sessionmaker() as s:
        s.add(AvatarReport(avatar_user_id=22222222, avatar_id="b" * 32, reporter_id=33333333,
                           reason="impersonation", created_at=now))
        await s.commit()


async def test_deleting_user_removes_avatar_reports_in_both_roles(app, client):
    owner, _ = await register(client, "owen")
    reporter, _ = await register(client, "rina")
    bystander, _ = await register(client, "bart")
    now = datetime.now(timezone.utc)
    async with app.state.sessionmaker() as s:
        s.add_all([
            # rina reported owen's avatar
            AvatarReport(avatar_user_id=owner, avatar_id="d" * 32, reporter_id=reporter, reason="other",
                         created_at=now),
            # owen reported bart's avatar
            AvatarReport(avatar_user_id=bystander, avatar_id="e" * 32, reporter_id=owner, reason="other",
                         created_at=now),
        ])
        await s.commit()

    h = await login_as(app, client, "superadmin")
    await client.post("/api/admin/step-up", headers=h, json={"password": PASSWORD})
    r = await client.request("DELETE", f"/api/admin/users/{owner}", headers=h,
                             json={"confirm_username": "owen", "reason": "用户要求注销"})
    assert r.status_code == 200, r.text

    async with app.state.sessionmaker() as s:
        left = await s.scalar(select(func.count()).select_from(AvatarReport))
        survivors = await s.scalar(select(func.count()).select_from(User).where(User.id == bystander))
    assert left == 0  # the report owen filed (as reporter) and the one against owen (as owner) are both gone
    assert survivors == 1
