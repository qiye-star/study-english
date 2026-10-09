import json

import httpx
import pytest
from cryptography.fernet import Fernet
from sqlalchemy import select

from app.models import AdminAudit
from tests.admin_helpers import ADMIN_ENABLED, PASSWORD, login_as


@pytest.fixture
def settings_overrides(request):
    return {**ADMIN_ENABLED, **getattr(request, "param", {})}


async def _step_up(client, h):
    assert (await client.post("/api/admin/step-up", headers=h, json={"password": PASSWORD})).status_code == 200


async def test_create_list_update_and_last_superadmin_guard(app, client):
    h = await login_as(app, client, "superadmin", "boss")
    r = await client.post("/api/admin/accounts", headers=h, json={"username": "ops", "password": "x" * 12, "role": "operator"})
    assert r.status_code == 403 and r.json()["error"] == "Step-up required"
    await _step_up(client, h)
    r = await client.post("/api/admin/accounts", headers=h, json={"username": "ops", "password": "x" * 12, "role": "operator"})
    assert r.status_code == 201
    accounts = (await client.get("/api/admin/accounts")).json()["accounts"]
    assert accounts[0]["env"] is True and [a["username"] for a in accounts[1:]] == ["boss", "ops"]
    assert "password_hash" not in str(accounts) and "totp_enc" not in str(accounts)
    boss_id = accounts[1]["id"]
    r = await client.patch(f"/api/admin/accounts/{boss_id}", headers=h, json={"role": "viewer"})
    assert r.status_code == 409 and r.json() == {"error": "Cannot remove the last superadmin"}
    r = await client.post("/api/admin/accounts", headers=h, json={"username": "root", "password": "x" * 12, "role": "viewer"})
    assert r.status_code == 409  # env account name is reserved
    r = await client.post("/api/admin/accounts", headers=h, json={"username": "ops", "password": "x" * 12, "role": "viewer"})
    assert r.status_code == 409
    r = await client.post("/api/admin/accounts", headers=h, json={"username": "Bad Name!", "password": "x" * 12, "role": "viewer"})
    assert r.status_code == 422
    r = await client.patch(f"/api/admin/accounts/{accounts[2]['id']}", headers=h, json={"role": "superadmin"})
    assert r.status_code == 200 and r.json()["role"] == "superadmin"
    assert (await client.patch(f"/api/admin/accounts/{boss_id}", headers=h, json={"role": "viewer"})).status_code == 200


async def test_operator_cannot_manage_accounts(app, client):
    h = await login_as(app, client, "operator")
    assert (await client.get("/api/admin/accounts")).status_code == 403
    assert (await client.post("/api/admin/accounts", headers=h,
                              json={"username": "x1x", "password": "x" * 12, "role": "viewer"})).status_code == 403


async def test_disabling_revokes_sessions_and_password_reset_is_audited(app, client):
    h = await login_as(app, client, "superadmin", "boss")
    await _step_up(client, h)
    ops = (await client.post("/api/admin/accounts", headers=h, json={"username": "ops", "password": "y" * 12, "role": "operator"})).json()

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as other:
        assert (await other.post("/api/admin/login", json={"username": "ops", "password": "y" * 12})).status_code == 200
        assert (await client.patch(f"/api/admin/accounts/{ops['id']}", headers=h, json={"password": "z" * 12})).status_code == 200
        assert (await other.get("/api/admin/session")).status_code == 401
        assert (await other.post("/api/admin/login", json={"username": "ops", "password": "z" * 12})).status_code == 200
        assert (await client.patch(f"/api/admin/accounts/{ops['id']}", headers=h, json={"disabled": True})).status_code == 200
        assert (await other.get("/api/admin/session")).status_code == 401
        assert (await other.post("/api/admin/login", json={"username": "ops", "password": "z" * 12})).status_code == 401
    r = await client.post(f"/api/admin/accounts/{ops['id']}/reset-totp", headers=h)
    assert r.status_code == 200 and r.json()["totp"] is False
    async with app.state.sessionmaker() as s:
        rows = (await s.scalars(select(AdminAudit).where(AdminAudit.action.like("admin.account.%")))).all()
    actions = [a.action for a in rows]
    assert actions == ["admin.account.create", "admin.account.password", "admin.account.update", "admin.account.reset_totp"]
    dump = json.dumps([(a.before, a.after, a.summary) for a in rows])
    assert "z" * 12 not in dump and "y" * 12 not in dump


async def test_sessions_list_and_revoke(app, client):
    h = await login_as(app, client, "viewer")
    sessions = (await client.get("/api/admin/sessions")).json()["sessions"]
    assert len(sessions) == 1 and sessions[0]["current"] is True
    assert "token" not in json.dumps(sessions) and "csrf" not in json.dumps(sessions)
    assert (await client.get("/api/admin/sessions", params={"all": 1})).status_code == 403
    assert (await client.delete(f"/api/admin/sessions/{sessions[0]['id']}", headers=h)).status_code == 204
    assert (await client.get("/api/admin/session")).status_code == 401


async def test_superadmin_revokes_other_sessions_with_step_up(app, client):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as other:
        await login_as(app, other, "viewer", "vic")
        h = await login_as(app, client, "superadmin", "boss")
        everyone = (await client.get("/api/admin/sessions", params={"all": 1})).json()["sessions"]
        vic = next(s for s in everyone if s["username"] == "vic")
        assert (await client.delete(f"/api/admin/sessions/{vic['id']}", headers=h)).status_code == 403
        await _step_up(client, h)
        assert (await client.delete(f"/api/admin/sessions/{vic['id']}", headers=h)).status_code == 204
        assert (await other.get("/api/admin/session")).status_code == 401


@pytest.mark.parametrize("settings_overrides", [{"settings_encryption_key": Fernet.generate_key().decode()}],
                         indirect=True)
async def test_me_security(app, client):
    await login_as(app, client, "viewer")
    me = (await client.get("/api/admin/me/security")).json()
    assert me == {"username": "viewer1", "role": "viewer", "env": False, "totp_enabled": False, "encryption": True,
                  "require_totp": False, "recovery_codes_left": 0}
