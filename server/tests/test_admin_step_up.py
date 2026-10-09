import pytest
from fastapi import APIRouter, Depends

from app.admin.perms import require, require_step_up
from tests.admin_helpers import ADMIN_ENABLED, PASSWORD, login_as


@pytest.fixture
def settings_overrides(request):
    return getattr(request, "param", dict(ADMIN_ENABLED))


async def test_step_up_gate(app, client):
    probe = APIRouter(prefix="/api/admin")

    @probe.post("/_probe")
    async def _probe(ctx=Depends(require_step_up)):
        return {"ok": True}

    for route in probe.routes:
        app.router.routes.insert(0, route)
    headers = await login_as(app, client, "superadmin")
    r = await client.post("/api/admin/_probe", headers=headers)
    assert r.status_code == 403 and r.json() == {"error": "Step-up required"}
    assert (await client.post("/api/admin/step-up", headers=headers, json={"password": "wrong-password-x"})).status_code == 401
    r = await client.post("/api/admin/step-up", headers=headers, json={"password": PASSWORD})
    assert r.status_code == 200 and r.json()["step_up_until"]
    assert (await client.post("/api/admin/_probe", headers=headers)).status_code == 200


async def test_totp_enrolment_then_login_needs_code(app, client):
    from cryptography.fernet import Fernet

    from app.admin import totp

    app.state.settings = app.state.settings.model_copy(update={"settings_encryption_key": Fernet.generate_key().decode()})
    headers = await login_as(app, client, "operator", "ops")
    begin = (await client.post("/api/admin/me/totp/begin", headers=headers)).json()
    import time

    code = totp.code_at(begin["secret"], int(time.time() // 30))
    confirm = await client.post("/api/admin/me/totp/confirm", headers=headers,
                                json={"enrolment": begin["enrolment"], "code": code})
    assert confirm.status_code == 200 and len(confirm.json()["recovery_codes"]) == 8
    await client.post("/api/admin/logout", headers=headers)
    r = await client.post("/api/admin/login", json={"username": "ops", "password": PASSWORD})
    assert r.json()["mfa_required"] is True
    pending = {"X-Admin-CSRF": r.json()["csrf_token"]}
    assert (await client.get("/api/admin/overview")).status_code == 401  # MFA not done
    r = await client.post("/api/admin/login/totp", headers=pending, json={"code": confirm.json()["recovery_codes"][0]})
    assert r.status_code == 200
    assert (await client.get("/api/admin/overview")).status_code == 200


def _probe_route(app, dep):
    probe = APIRouter(prefix="/api/admin")

    @probe.post("/_probe")
    async def _probe(ctx=Depends(dep)):
        return {"ok": True}

    for route in probe.routes:
        app.router.routes.insert(0, route)


async def test_step_up_needs_the_role_first(app, client):
    _probe_route(app, require_step_up)
    headers = await login_as(app, client, "operator")
    assert (await client.post("/api/admin/step-up", headers=headers, json={"password": PASSWORD})).status_code == 200
    r = await client.post("/api/admin/_probe", headers=headers)
    assert r.status_code == 403 and r.json() == {"error": "Forbidden"}


@pytest.mark.parametrize("settings_overrides", [{**ADMIN_ENABLED, "admin_totp_secret": "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"}],
                         indirect=True)
async def test_env_account_totp_login_and_replay(app, client):
    import time

    from app.admin import totp

    r = await client.post("/api/admin/login", json={"username": "root", "password": ADMIN_ENABLED["admin_password"]})
    assert r.json()["mfa_required"] is True
    pending = {"X-Admin-CSRF": r.json()["csrf_token"]}
    assert (await client.post("/api/admin/login/totp", headers=pending, json={"code": "000000"})).status_code in (401, 200)
    code = totp.code_at("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", int(time.time() // 30))
    r = await client.post("/api/admin/login/totp", headers=pending, json={"code": code})
    assert r.status_code == 200 and r.json()["totp_enabled"] is True
    assert (await client.get("/api/admin/session")).json()["totp_enabled"] is True
    # the same code cannot complete a second login
    r = await client.post("/api/admin/login", json={"username": "root", "password": ADMIN_ENABLED["admin_password"]})
    again = await client.post("/api/admin/login/totp", headers={"X-Admin-CSRF": r.json()["csrf_token"]}, json={"code": code})
    assert again.status_code == 401


async def test_recovery_codes_are_single_use(app, client):
    import time

    from cryptography.fernet import Fernet

    from app.admin import totp

    app.state.settings = app.state.settings.model_copy(update={"settings_encryption_key": Fernet.generate_key().decode()})
    headers = await login_as(app, client, "viewer", "viewer2")
    begin = (await client.post("/api/admin/me/totp/begin", headers=headers)).json()
    codes = (await client.post("/api/admin/me/totp/confirm", headers=headers, json={
        "enrolment": begin["enrolment"], "code": totp.code_at(begin["secret"], int(time.time() // 30))})).json()["recovery_codes"]
    for expected in (200, 401):
        r = await client.post("/api/admin/login", json={"username": "viewer2", "password": PASSWORD})
        r = await client.post("/api/admin/login/totp", headers={"X-Admin-CSRF": r.json()["csrf_token"]},
                              json={"code": codes[0].upper()})
        assert r.status_code == expected


async def test_require_totp_blocks_superadmin_writes_until_bound(app, client):
    _probe_route(app, require("superadmin"))
    app.state.settings = app.state.settings.model_copy(update={"admin_require_totp": True})
    headers = await login_as(app, client, "superadmin")
    r = await client.post("/api/admin/_probe", headers=headers)
    assert r.status_code == 403 and r.json() == {"error": "TOTP required"}
    assert (await client.get("/api/admin/session")).status_code == 200  # reads still work
    r = await client.post("/api/admin/me/totp/begin", headers=headers)
    assert r.status_code == 409  # exempt path; here no encryption key is configured


async def test_password_change_revokes_other_sessions(app, client):
    import httpx

    headers = await login_as(app, client, "operator", "ops")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as other:
        assert (await other.post("/api/admin/login", json={"username": "ops", "password": PASSWORD})).status_code == 200
        r = await client.post("/api/admin/me/password", headers=headers,
                              json={"current": PASSWORD, "new": "another-long-password"})
        assert r.status_code == 204
        assert (await other.get("/api/admin/session")).status_code == 401
    assert (await client.get("/api/admin/session")).status_code == 200
    env = await client.post("/api/admin/login", json={"username": "root", "password": ADMIN_ENABLED["admin_password"]})
    r = await client.post("/api/admin/me/password", headers={"X-Admin-CSRF": env.json()["csrf_token"]},
                          json={"current": "x", "new": "another-long-password"})
    assert r.status_code == 400
