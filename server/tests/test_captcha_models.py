"""人机验证的防重放表(计划 S5;迁移 0027_captcha_replay;spec §5、R-C7)。"""
import sqlite3
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy.exc import IntegrityError

from app.models import CaptchaReplay

ROOT = Path(__file__).resolve().parent.parent
SIG = "a" * 64


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


def _indexes(db: Path, table: str) -> set[str]:
    con = sqlite3.connect(db)
    try:
        return {row[1] for row in con.execute(f"pragma index_list({table})")}
    finally:
        con.close()


def _tables(db: Path) -> set[str]:
    con = sqlite3.connect(db)
    try:
        return {row[0] for row in con.execute("select name from sqlite_master where type='table'")}
    finally:
        con.close()


def test_head_is_0027_and_follows_0026():
    script = ScriptDirectory.from_config(Config(str(ROOT / "alembic.ini")))
    assert script.get_heads() == ["0028"]
    assert script.get_revision("0027").down_revision == "0026"


def test_round_trip(tmp_path, monkeypatch):
    cfg, db = _config(tmp_path, monkeypatch)
    command.upgrade(cfg, "0026")
    assert "captcha_replays" not in _tables(db)

    command.upgrade(cfg, "0027")
    assert "captcha_replays" in _tables(db)
    assert _columns(db, "captcha_replays") == {"signature", "expires_at"}
    assert "ix_captcha_replays_expires_at" in _indexes(db, "captcha_replays")

    command.downgrade(cfg, "0026")
    assert "captcha_replays" not in _tables(db)

    command.upgrade(cfg, "0027")
    assert "captcha_replays" in _tables(db)


async def test_signature_is_unique(app):
    async with app.state.sessionmaker() as s:
        s.add(CaptchaReplay(signature=SIG, expires_at=_when()))
        await s.commit()
    async with app.state.sessionmaker() as s:
        s.add(CaptchaReplay(signature=SIG, expires_at=_when()))
        with pytest.raises(IntegrityError):
            await s.commit()


def test_no_user_or_ip_columns():
    names = {c.name.lower() for c in CaptchaReplay.__table__.columns}
    assert names == {"signature", "expires_at"}
    assert not any("user" in n or "ip" in n for n in names)


def _when():
    from datetime import datetime, timezone

    return datetime(2026, 10, 20, 12, 0, tzinfo=timezone.utc)
