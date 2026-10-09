from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models import AdminAudit, SettingOverride
from tests.admin_helpers import ADMIN_ENABLED, PASSWORD, assert_no_secrets, login_as


@pytest.fixture
def settings_overrides(request):
    return {**ADMIN_ENABLED, **getattr(request, "param", {})}


async def test_create_publicly_visible_within_window_and_archive(app, client):
    h = await login_as(app, client, "operator")
    now = datetime.now(timezone.utc)
    body = {"level": "warning", "text_zh": "今晚 23:00 维护 10 分钟", "text_en": "Maintenance at 23:00 for 10 minutes",
            "starts_at": (now - timedelta(minutes=1)).isoformat(), "ends_at": (now + timedelta(hours=1)).isoformat(),
            "dismissible": True}
    created = await client.post("/api/admin/announcements", headers=h, json=body)
    assert created.status_code == 201 and created.json()["status"] == "active"
    future = {**body, "starts_at": (now + timedelta(days=1)).isoformat(), "ends_at": None}
    assert (await client.post("/api/admin/announcements", headers=h, json=future)).json()["status"] == "scheduled"
    r = await client.get("/api/announcements")
    public = r.json()
    assert r.headers["cache-control"] == "public, max-age=60"
    assert [a["text_zh"] for a in public["announcements"]] == ["今晚 23:00 维护 10 分钟"]
    assert set(public["announcements"][0]) == {"id", "level", "text_zh", "text_en", "dismissible", "starts_at", "ends_at"}
    assert public["maintenance"] == {"mode": "off", "message_zh": "", "message_en": ""}
    await client.delete(f"/api/admin/announcements/{created.json()['id']}", headers=h)
    assert (await client.get("/api/announcements")).json()["announcements"] == []
    listed = (await client.get("/api/admin/announcements")).json()["announcements"]
    assert sorted(a["status"] for a in listed) == ["archived", "scheduled"]
    async with app.state.sessionmaker() as s:
        actions = [a.action for a in (await s.scalars(select(AdminAudit).order_by(AdminAudit.id))).all()]
    assert actions.count("announcement.create") == 2 and "announcement.archive" in actions


async def test_validation_update_and_roles(app, client):
    h = await login_as(app, client, "operator")
    r = await client.post("/api/admin/announcements", headers=h, json={"level": "danger", "text_zh": "x" * 300, "text_en": "",
                                                                       "starts_at": "2026-10-09T00:00:00Z"})
    assert r.status_code == 422
    r = await client.post("/api/admin/announcements", headers=h, json={
        "level": "info", "text_zh": "x", "starts_at": "2026-10-09T10:00:00Z", "ends_at": "2026-10-09T09:00:00Z"})
    assert r.status_code == 422 and "ends_at" in r.json()["fields"]
    created = (await client.post("/api/admin/announcements", headers=h, json={
        "level": "info", "text_zh": "  你好  ", "starts_at": "2026-10-09T10:00:00Z"})).json()
    assert created["text_zh"] == "你好" and created["ends_at"] is None
    r = await client.patch(f"/api/admin/announcements/{created['id']}", headers=h, json={"level": "warning",
                                                                                       "ends_at": "2026-10-10T10:00:00Z"})
    assert r.status_code == 200 and r.json()["level"] == "warning" and r.json()["ends_at"].startswith("2026-10-10")
    assert (await client.patch("/api/admin/announcements/999", headers=h, json={"level": "info"})).status_code == 404
    assert (await client.post("/api/admin/announcements", json={"level": "info", "text_zh": "x",
                                                                "starts_at": "2026-10-09T10:00:00Z"})).status_code == 403
    client.cookies.clear()
    await login_as(app, client, "viewer")
    assert (await client.get("/api/admin/announcements")).status_code == 403


async def test_maintenance_switch_needs_step_up_reason_and_confirmation(app, client):
    h = await login_as(app, client, "superadmin")
    body = {"mode": "read_only", "message_zh": "正在升级", "reason": "数据库迁移"}
    assert (await client.post("/api/admin/maintenance", headers=h, json=body)).json() == {"error": "Step-up required"}
    await client.post("/api/admin/step-up", headers=h, json={"password": PASSWORD})
    r = await client.post("/api/admin/maintenance", headers=h, json=body)
    assert r.status_code == 409 and r.json()["details"]["confirm"] == "MAINTENANCE_MODE"
    r = await client.post("/api/admin/maintenance", headers=h, json={**body, "confirm": "MAINTENANCE_MODE"})
    assert r.status_code == 200, r.text
    assert r.json()["mode"] == "read_only" and set(r.json()["changed"]) == {"maintenance_mode", "maintenance_message_zh"}
    assert app.state.settings.maintenance_mode == "read_only"
    public = (await client.get("/api/announcements")).json()["maintenance"]
    assert public == {"mode": "read_only", "message_zh": "正在升级", "message_en": ""}
    assert_no_secrets(public, app.state.settings)
    # turning it off needs only a reason; a value equal to env removes the override
    r = await client.post("/api/admin/maintenance", headers=h, json={"mode": "off", "reason": "ok"})
    assert r.status_code == 422
    r = await client.post("/api/admin/maintenance", headers=h, json={"mode": "off", "reason": "升级完成"})
    assert r.status_code == 200 and app.state.settings.maintenance_mode == "off"
    assert (await client.post("/api/admin/maintenance", headers=h, json={"mode": "off", "reason": "升级完成"})).status_code == 409
    async with app.state.sessionmaker() as s:
        keys = {o.key for o in (await s.scalars(select(SettingOverride))).all()}
        audits = [a for a in (await s.scalars(select(AdminAudit))).all() if a.action == "maintenance.set"]
    assert keys == {"maintenance_message_zh"}
    assert len(audits) == 2 and audits[0].reason == "数据库迁移"


async def test_operator_cannot_switch_maintenance(app, client):
    h = await login_as(app, client, "operator")
    r = await client.post("/api/admin/maintenance", headers=h, json={"mode": "full", "reason": "xxxx"})
    assert r.status_code == 403


async def test_maintenance_switch_goes_through_the_settings_service(app, client, monkeypatch):
    """Integration (lane E × lane B): one write path for settings — revisions, guards, hub publish and listeners."""
    from app.admin import settings_service

    calls = []
    real = settings_service.save

    async def spy(session, app_, actor, changes, **kw):
        calls.append((dict(changes), kw.get("action")))
        return await real(session, app_, actor, changes, **kw)

    monkeypatch.setattr(settings_service, "save", spy)
    h = await login_as(app, client, "superadmin")
    await client.post("/api/admin/step-up", headers=h, json={"password": PASSWORD})
    r = await client.post("/api/admin/maintenance", headers=h,
                          json={"mode": "full", "reason": "数据库迁移", "confirm": "MAINTENANCE_MODE"})
    assert r.status_code == 200, r.text
    assert calls == [({"maintenance_mode": "full"}, "maintenance.set")]
    revisions = (await client.get("/api/admin/settings/revisions")).json()["items"]
    assert revisions[0]["changes"][0]["key"] == "maintenance_mode"
    r = await client.post("/api/admin/maintenance", headers=h, json={"mode": "off", "reason": "升级完成"})
    assert r.status_code == 200 and calls[-1] == ({"maintenance_mode": None}, "maintenance.set")  # env value: reset
