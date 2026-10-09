"""Storage usage card and the guarded `room_audio` purge (spec 2026-10-10 §12, §14). Audio is kept forever:
the only deletion path is this manual tool (scan → token → reason + step-up + typed confirmation, audited)."""
import json
import os
import time
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.admin import housekeeping
from app.admin.storage import storage_summary
from app.models import AdminAudit, Room, RoomMessage, RoomVoice, User
from tests.admin_helpers import ADMIN_ENABLED, PASSWORD, login_as

NOW = datetime(2026, 10, 10, 9, 0, tzinfo=timezone.utc)
OLD = time.time() - 3600


@pytest.fixture
def settings_overrides(tmp_path):
    return {**ADMIN_ENABLED, "data_dir": str(tmp_path / "data")}


async def _seed(app, data, closed_days_ago: int, *, now=NOW):
    async with app.state.sessionmaker() as s:
        s.add(User(id=7, username="lily", password_hash="x"))
        await s.flush()
        s.add(Room(id="r1", code=None, last_code="482913", owner_id=7, topic="", status="closed", created_at=now,
                   last_active_at=now, closed_at=now - timedelta(days=closed_days_ago)))
        await s.flush()
        s.add(RoomMessage(id="m1", room_id="r1", seq=1, lane="public", sender_kind="user", sender_id=7, kind="voice",
                          text="hi", created_at=now))
        await s.flush()
        s.add(RoomVoice(message_id="m1", room_id="r1", sender_id=7, duration_ms=1000, audio_path="room_audio/r1/m1.mp3",
                        audio_bytes=3000, audio_format="mp3", status="done", created_at=now))
        await s.commit()
    (data / "room_audio/r1").mkdir(parents=True)
    (data / "room_audio/r1/m1.mp3").write_bytes(b"x" * 3000)
    orphan = data / "room_audio/r1/orphan.mp3"
    orphan.write_bytes(b"x" * 10)
    os.utime(orphan, (OLD, OLD))
    return data


async def test_storage_summary(app, tmp_path):
    data = await _seed(app, tmp_path, 400)
    (data / "room_audio/_staging").mkdir(parents=True)
    (data / "room_audio/_staging/m9.wav").write_bytes(b"x" * 64)
    async with app.state.sessionmaker() as s:
        out = await storage_summary(s, data)
    assert out["room_audio"]["files"] == 1 and out["room_audio"]["bytes"] == 3000
    assert out["room_audio"]["staging_bytes"] == 64
    assert out["room_audio"]["by_month"] == [{"month": "2026-10", "files": 1, "bytes": 3000}]
    assert out["recordings"] == {"files": 0, "bytes": 0}
    assert out["top_voice_users"] == [{"user_id": 7, "username": "lily", "bytes": 3000}]


async def test_room_audio_purge_is_scanned_tokened_and_keeps_text(app, tmp_path):
    data = await _seed(app, tmp_path, 400)
    settings = app.state.settings.model_copy(update={"data_dir": str(data)})
    async with app.state.sessionmaker() as s:
        scan = await housekeeping.scan_room_audio(s, settings, 365, NOW, grace=0)
        assert scan.count == 2 and scan.bytes == 3010 and scan.rooms == 1
        with pytest.raises(ValueError):
            await housekeeping.purge_room_audio(s, settings, 365, "wrong", NOW, grace=0)
        assert await housekeeping.purge_room_audio(s, settings, 365, scan.token, NOW, grace=0) == 2
        await s.commit()
        voice = await s.get(RoomVoice, "m1")
        assert voice.audio_path is None and voice.purged_at is not None and (await s.get(RoomMessage, "m1")).text == "hi"
    assert not (data / "room_audio/r1/m1.mp3").exists() and not (data / "room_audio/r1/orphan.mp3").exists()


async def test_recent_rooms_are_not_purged(app, tmp_path):
    data = await _seed(app, tmp_path, 10)
    settings = app.state.settings.model_copy(update={"data_dir": str(data)})
    async with app.state.sessionmaker() as s:
        assert (await housekeeping.scan_room_audio(s, settings, 365, NOW, grace=0)).count == 1  # only the orphan
        # a file written a moment ago (row not committed yet) is never an orphan
        assert (await housekeeping.scan_room_audio(s, settings, 365, NOW)).count == 1
        (data / "room_audio/r1/fresh.mp3").write_bytes(b"x")
        assert (await housekeeping.scan_room_audio(s, settings, 365, NOW)).count == 1


async def test_stale_staging_and_open_rooms(app, tmp_path):
    data = await _seed(app, tmp_path, 10)
    settings = app.state.settings.model_copy(update={"data_dir": str(data)})
    async with app.state.sessionmaker() as s:
        voice = await s.get(RoomVoice, "m1")
        voice.staging_path, voice.status = "room_audio/_staging/m1.wav", "failed"
        await s.commit()
    (data / "room_audio/_staging").mkdir(parents=True)
    (data / "room_audio/_staging/m1.wav").write_bytes(b"x" * 100)  # room ended 10 days ago > 7: stale
    async with app.state.sessionmaker() as s:
        scan = await housekeeping.scan_room_audio(s, settings, 365, NOW, grace=0)
        assert scan.count == 2 and scan.bytes == 110
        assert await housekeeping.purge_room_audio(s, settings, 365, scan.token, NOW, grace=0) == 2
        await s.commit()
        voice = await s.get(RoomVoice, "m1")
        assert voice.staging_path is None and voice.audio_path == "room_audio/r1/m1.mp3"  # the MP3 is kept
    assert (data / "room_audio/r1/m1.mp3").exists() and not (data / "room_audio/_staging/m1.wav").exists()


async def test_files_outside_room_audio_are_never_touched(app, tmp_path):
    data = await _seed(app, tmp_path, 400)
    settings = app.state.settings.model_copy(update={"data_dir": str(data)})
    (data / "recordings/7").mkdir(parents=True)
    (data / "recordings/7/a.wav").write_bytes(b"x")
    async with app.state.sessionmaker() as s:
        (await s.get(RoomVoice, "m1")).audio_path = "recordings/7/a.wav"  # a corrupted row must not reach recordings/
        await s.commit()
        scan = await housekeeping.scan_room_audio(s, settings, 365, NOW, grace=0)
        await housekeeping.purge_room_audio(s, settings, 365, scan.token, NOW, grace=0)
        await s.commit()
    assert (data / "recordings/7/a.wav").exists()


async def test_storage_and_room_audio_endpoints(app, client):
    data = app.state.settings.resolved_data_dir
    now = datetime.now(timezone.utc)
    await _seed(app, data, 400, now=now)
    assert (await client.get("/api/admin/storage")).status_code == 401
    await login_as(app, client, "viewer")
    r = await client.get("/api/admin/storage")
    assert r.status_code == 200 and r.json()["room_audio"]["files"] == 1
    assert (await client.post("/api/admin/housekeeping/room_audio/scan")).status_code == 403
    h = await login_as(app, client, "superadmin")
    url = "/api/admin/housekeeping/room_audio"
    assert (await client.post(f"{url}/scan", headers=h, json={"older_than_days": 29})).status_code == 422
    scan = (await client.post(f"{url}/scan", headers=h)).json()  # default 365 days
    assert (scan["count"], scan["bytes"], scan["rooms"], scan["older_than_days"]) == (2, 3010, 1, 365)
    run = {"token": scan["token"], "older_than_days": 365, "reason": "磁盘快满了", "confirm": "DELETE 2 FILES"}
    assert (await client.post(f"{url}/run", headers=h, json=run)).status_code == 403  # step-up first
    await client.post("/api/admin/step-up", headers=h, json={"password": PASSWORD})
    r = await client.post(f"{url}/run", headers=h, json={**run, "older_than_days": 10})
    assert r.status_code == 422
    r = await client.post(f"{url}/run", headers=h, json={k: v for k, v in run.items() if k != "older_than_days"})
    assert r.status_code == 422
    r = await client.post(f"{url}/run", headers=h, json={**run, "confirm": "DELETE"})
    assert r.status_code == 422 and r.json()["error"] == "Confirmation required"
    assert (data / "room_audio/r1/m1.mp3").exists()
    r = await client.post(f"{url}/run", headers=h, json={**run, "older_than_days": 1000})
    assert r.status_code == 409 and r.json()["error"] == "Rescan required"
    r = await client.post(f"{url}/run", headers=h, json=run)
    assert r.status_code == 200 and r.json() == {"deleted": 2, "bytes": 3010}
    async with app.state.sessionmaker() as s:
        rows = (await s.scalars(select(AdminAudit).where(AdminAudit.action == "housekeeping.room_audio"))).all()
    assert len(rows) == 1 and rows[0].after == {"files": 2, "bytes": 3010, "older_than_days": 365}
    assert rows[0].reason == "磁盘快满了" and "room_audio/" not in json.dumps([rows[0].summary, rows[0].after])
