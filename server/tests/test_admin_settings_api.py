import json

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import select

from app.models import AdminAudit
from tests.admin_helpers import ADMIN_ENABLED, PASSWORD, assert_no_secrets, login_as


# Ruling: registration_mode pinned to "closed" (Settings default is "open", which made the danger flow a no-op).
@pytest.fixture
def settings_overrides(request):
    return {**ADMIN_ENABLED, "settings_encryption_key": Fernet.generate_key().decode(),
            "upstream_llm_key": "sk-env-llm-123456", "registration_mode": "closed", **getattr(request, "param", {})}


async def test_viewer_reads_operator_cannot_write(app, client):
    await login_as(app, client, "viewer")
    r = await client.get("/api/admin/settings")
    assert r.status_code == 200 and {"groups", "items", "revision"} <= set(r.json())
    assert_no_secrets(r.json(), app.state.settings)
    client.cookies.clear()
    op = await login_as(app, client, "operator")
    r = await client.patch("/api/admin/settings", headers=op, json={"changes": {"rate_limit_per_minute": 20}})
    assert r.status_code == 403
    assert (await client.get("/api/admin/settings/export")).status_code == 403


async def test_superadmin_patch_reset_and_errors(app, client):
    h = await login_as(app, client, "superadmin")
    r = await client.patch("/api/admin/settings", headers=h, json={"changes": {"rate_limit_per_minute": 20}, "reason": "x"})
    assert r.status_code == 200 and r.json()["changed"] == ["rate_limit_per_minute"]
    r = await client.patch("/api/admin/settings", headers=h, json={"changes": {"rate_limit_per_minute": -1}})
    assert r.status_code == 422 and "rate_limit_per_minute" in r.json()["fields"]
    r = await client.patch("/api/admin/settings", headers=h, json={"changes": {"database_url": "x"}})
    assert r.status_code == 400 and r.json()["error"] == "Setting is read-only"
    r = await client.delete("/api/admin/settings/rate_limit_per_minute", headers=h, params={"reason": "回退"})
    assert r.status_code == 200 and app.state.settings.rate_limit_per_minute == app.state.base_settings.rate_limit_per_minute
    assert (await client.delete("/api/admin/settings/nope", headers=h)).status_code == 400
    assert (await client.patch("/api/admin/settings", json={"changes": {"rate_limit_per_minute": 20}})).status_code == 403


async def test_danger_flow_through_step_up(app, client):
    h = await login_as(app, client, "superadmin")
    body = {"changes": {"registration_mode": "open"}, "reason": "活动开放", "confirm": "REGISTRATION_MODE"}
    r = await client.patch("/api/admin/settings", headers=h, json=body)
    assert r.status_code == 403 and r.json()["error"] == "Step-up required"
    assert (await client.post("/api/admin/step-up", headers=h, json={"password": PASSWORD})).status_code == 200
    r = await client.patch("/api/admin/settings", headers=h, json={**body, "confirm": "nope"})
    assert r.status_code == 409 and r.json()["details"]["confirm"] == "REGISTRATION_MODE"
    assert (await client.patch("/api/admin/settings", headers=h, json=body)).status_code == 200


async def test_require_totp_needs_own_totp(app, client):
    h = await login_as(app, client, "superadmin")
    assert (await client.post("/api/admin/step-up", headers=h, json={"password": PASSWORD})).status_code == 200
    r = await client.patch("/api/admin/settings", headers=h, json={
        "changes": {"admin_require_totp": True}, "reason": "加固安全", "confirm": "ADMIN_REQUIRE_TOTP"})
    assert r.status_code == 409 and r.json()["error"] == "Bind TOTP first"


async def test_revisions_export_import(app, client):
    h = await login_as(app, client, "superadmin")
    await client.patch("/api/admin/settings", headers=h, json={"changes": {"upstream_tts_key": "sk-tts-secret-777",
                                                                           "max_vocab_items": 50}})
    revs = (await client.get("/api/admin/settings/revisions")).json()
    assert_no_secrets(revs, app.state.settings)
    exported = await client.get("/api/admin/settings/export")
    assert "attachment" in exported.headers["content-disposition"]
    assert_no_secrets(exported.json(), app.state.settings)
    preview = await client.post("/api/admin/settings/import/preview", headers=h, json=exported.json())
    assert all(i["status"] in ("unchanged", "secret") for i in preview.json()["items"])
    r = await client.post("/api/admin/settings/import/preview", headers=h, content=b"not json")
    assert r.status_code == 400 and r.json()["error"] == "Unsupported file"
    r = await client.post("/api/admin/settings/import/preview", headers=h, content=b" " * (256 * 1024 + 1))
    assert r.status_code == 413
    payload = {**exported.json(), "overrides": {"MAX_VOCAB_ITEMS": 60}}
    r = await client.post("/api/admin/settings/import/apply", headers=h, json={"payload": payload, "reason": "同步"})
    assert r.status_code == 200 and app.state.settings.max_vocab_items == 60
    rid = (await client.get("/api/admin/settings/revisions")).json()["items"][-1]["id"]
    r = await client.post(f"/api/admin/settings/revisions/{rid}/revert", headers=h, json={"reason": "撤销"})
    assert r.status_code == 409 and r.json()["details"] == {"conflicts": ["max_vocab_items"]}
    r = await client.post(f"/api/admin/settings/revisions/{rid}/revert", headers=h,
                          json={"reason": "撤销", "acknowledge_conflicts": True})
    assert r.status_code == 200 and app.state.settings.max_vocab_items == app.state.base_settings.max_vocab_items
    async with app.state.sessionmaker() as s:
        actions = [a.action for a in (await s.scalars(select(AdminAudit).order_by(AdminAudit.id))).all()]
        audit_rows = [(a.before, a.after) for a in (await s.scalars(select(AdminAudit))).all()]
    assert {"settings.update", "settings.export", "settings.import", "settings.revert"} <= set(actions)
    assert "sk-tts-secret-777" not in json.dumps(audit_rows, ensure_ascii=False)
