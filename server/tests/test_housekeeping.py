import os
import time
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.admin import audit, housekeeping
from app.admin.audit import CLI_ACTOR
from app.models import AccessToken, AdminAudit, AdminLoginState, AdminSession, SpeechToken
from tests.admin_helpers import ADMIN_ENABLED, PASSWORD, login_as
from tests.test_admin_api import register, seed_assessment

OLD = time.time() - 3600


@pytest.fixture
def settings_overrides(tmp_path):
    return {**ADMIN_ENABLED, "data_dir": str(tmp_path / "data")}


def _orphan(app, uid, name="ghost.wav"):
    path = app.state.settings.resolved_data_dir / "recordings" / str(uid) / name
    path.write_bytes(b"RIFF0000")
    os.utime(path, (OLD, OLD))  # older than the grace period for in-flight writes
    return path


async def test_orphan_scan_and_guarded_delete(app, client):
    uid, _ = await register(client, "alice")
    await seed_assessment(app, uid)
    orphan = _orphan(app, uid)
    fresh = app.state.settings.resolved_data_dir / "recordings" / str(uid) / "being-written.wav"
    fresh.write_bytes(b"RIFF")
    async with app.state.sessionmaker() as s:
        scan = await housekeeping.scan_orphan_recordings(s, app.state.storage)
        assert (scan.count, scan.bytes) == (1, 8) and scan.samples == [f"recordings/{uid}/ghost.wav"]
        with pytest.raises(ValueError):
            await housekeeping.delete_orphan_recordings(s, app.state.storage, "stale-token")
        assert await housekeeping.delete_orphan_recordings(s, app.state.storage, scan.token) == 1
    assert not orphan.exists() and fresh.exists()


async def test_housekeeping_endpoints(app, client):
    uid, _ = await register(client, "alice")
    await seed_assessment(app, uid)
    _orphan(app, uid)
    h = await login_as(app, client, "superadmin")
    scan = (await client.post("/api/admin/housekeeping/orphan_recordings/scan", headers=h)).json()
    assert scan["count"] == 1
    run = {"token": scan["token"], "reason": "清理孤儿录音"}
    assert (await client.post("/api/admin/housekeeping/orphan_recordings/run", headers=h, json=run)).status_code == 403
    await client.post("/api/admin/step-up", headers=h, json={"password": PASSWORD})
    _orphan(app, uid, "second.wav")  # the file set changed since the scan
    r = await client.post("/api/admin/housekeeping/orphan_recordings/run", headers=h, json=run)
    assert r.status_code == 409 and r.json()["error"] == "Rescan required"
    scan = (await client.post("/api/admin/housekeeping/orphan_recordings/scan", headers=h)).json()
    r = await client.post("/api/admin/housekeeping/orphan_recordings/run", headers=h, json={**run, "token": scan["token"]})
    assert r.json() == {"deleted": 2}
    r = await client.post("/api/admin/housekeeping/audit/run", headers=h, json={"older_than_days": 30, "reason": "清理审计"})
    assert r.status_code == 422
    assert (await client.post("/api/admin/housekeeping/nope/scan", headers=h)).status_code == 422
    assert (await client.post("/api/admin/housekeeping/audit/scan", headers=h)).json() == {"retention_days": 365, "count": 0}


async def test_purge_audit_keeps_the_remaining_chain_verifiable(app):
    async with app.state.sessionmaker() as s:
        for i in range(3):
            await audit.record(s, CLI_ACTOR, f"test.{i}")
        await s.commit()
        rows = (await s.scalars(select(AdminAudit).order_by(AdminAudit.id))).all()
        rows[0].at = datetime.now(timezone.utc) - timedelta(days=400)
        await s.commit()
    async with app.state.sessionmaker() as s:
        with pytest.raises(ValueError):
            await housekeeping.purge_audit(s, CLI_ACTOR, 30, retention_days=365)
        assert await housekeeping.purge_audit(s, CLI_ACTOR, 365, retention_days=365) == 1
        await s.commit()
        purge = (await s.scalars(select(AdminAudit).where(AdminAudit.action == "audit.purge"))).one()
        anchor = purge.before["anchor_id"]
        assert anchor == rows[1].id
        assert await audit.verify(s, start_id=anchor) == (True, None)


async def test_purge_expired(app, client):
    uid, _ = await register(client, "alice")
    now = datetime.now(timezone.utc)
    async with app.state.sessionmaker() as s:
        s.add_all([
            AdminSession(token_hash="a" * 64, username="x", expires_at=now - timedelta(days=8), ip="1", user_agent="",
                         csrf_hash="c"),
            AdminSession(token_hash="b" * 64, username="x", expires_at=now + timedelta(days=1), ip="1", user_agent="",
                         csrf_hash="c"),
            AdminLoginState(username="x", ip="1", updated_at=now - timedelta(days=31)),
            AdminLoginState(username="y", ip="1", updated_at=now - timedelta(days=31),
                            locked_until=now + timedelta(hours=1)),
            SpeechToken(user_id=uid, created_at=now - timedelta(days=2)),
            SpeechToken(user_id=uid, created_at=now),
        ])
        await s.commit()
        assert await housekeeping.purge_expired(s, now) == {"admin_sessions": 1, "admin_login_state": 1,
                                                            "speech_tokens": 1, "access_tokens": 0,
                                                            "rank_profile_snapshots": 0, "captcha_replays": 0}


async def test_purge_removes_tokens_expired_over_7_days(app, client):
    uid, _ = await register(client, "alice")
    now = datetime.now(timezone.utc)
    async with app.state.sessionmaker() as s:
        s.add_all([
            AccessToken(user_id=uid, token_hash="1" * 64, expires_at=now - timedelta(days=8)),  # removed
            AccessToken(user_id=uid, token_hash="2" * 64, expires_at=now - timedelta(days=1)),  # kept: recently expired
            AccessToken(user_id=uid, token_hash="3" * 64, expires_at=None),  # kept: legacy, no expiry yet
            AccessToken(user_id=uid, token_hash="4" * 64, expires_at=now + timedelta(days=20)),  # kept: live
        ])
        await s.commit()
        counts = await housekeeping.purge_expired(s, now)
        await s.commit()
        assert counts["access_tokens"] == 1
        left = {t.token_hash for t in (await s.scalars(select(AccessToken))).all()}
    assert "1" * 64 not in left and {"2" * 64, "3" * 64, "4" * 64} <= left  # the login token of alice is kept too
