import sqlite3
from pathlib import Path

from alembic import command
from alembic.config import Config

ROOT = Path(__file__).resolve().parent.parent


def test_upgrade_head_creates_tables(tmp_path, monkeypatch):
    db = tmp_path / "m.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{db.as_posix()}")
    cfg = Config(str(ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(ROOT / "alembic"))

    command.upgrade(cfg, "head")

    con = sqlite3.connect(db)
    try:
        names = {row[0] for row in con.execute("select name from sqlite_master where type='table'")}
    finally:
        con.close()
    assert {"users", "access_tokens", "alembic_version"} <= names
