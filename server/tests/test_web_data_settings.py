from datetime import datetime, timezone
from pathlib import Path

from app.core.config import Settings
from app.models import iso_utc


def make(**kw) -> Settings:
    return Settings(_env_file=None, **kw)


def test_defaults():
    s = make()
    assert s.data_dir == ""
    assert s.web_dist_dir == ""
    assert s.recording_quota_mb == 500
    assert s.max_conversations == 200
    assert s.max_messages_per_conversation == 1000


def test_data_dir_explicit(tmp_path):
    assert make(data_dir=str(tmp_path)).resolved_data_dir == tmp_path


def test_data_dir_follows_sqlite_file(tmp_path):
    db = tmp_path / "sub" / "app.db"
    s = make(database_url=f"sqlite+aiosqlite:///{db.as_posix()}")
    assert s.resolved_data_dir == db.parent.resolve()


def test_data_dir_falls_back_to_slash_data():
    assert make(database_url="sqlite+aiosqlite:///:memory:").resolved_data_dir == Path("/data")
    assert make(database_url="postgresql+asyncpg://u:p@db:5432/enjoy").resolved_data_dir == Path("/data")


def test_iso_utc_handles_naive_and_aware():
    naive = datetime(2026, 10, 4, 1, 2, 3, 456789)
    aware = naive.replace(tzinfo=timezone.utc)
    assert iso_utc(naive) == "2026-10-04T01:02:03.456789+00:00"
    assert iso_utc(aware) == "2026-10-04T01:02:03.456789+00:00"
