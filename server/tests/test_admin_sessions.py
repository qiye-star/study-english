from datetime import datetime, timedelta, timezone

import pytest

from app.admin import sessions as sess
from app.admin.accounts import Principal
from app.models import AdminSession
from tests.admin_helpers import ADMIN_ENABLED, PASSWORD, login_as


@pytest.fixture
def settings_overrides(request):
    return getattr(request, "param", dict(ADMIN_ENABLED))


async def test_login_sets_httponly_strict_cookie_and_returns_csrf(client):
    r = await client.post("/api/admin/login", json={"username": "root", "password": "correct-horse-battery"})
    assert r.status_code == 200
    body = r.json()
    assert body["role"] == "superadmin" and body["mfa_required"] is False and len(body["csrf_token"]) >= 32
    cookie = r.headers["set-cookie"]
    assert cookie.startswith("enjoy_admin=") and "HttpOnly" in cookie and "SameSite=strict" in cookie.replace("Strict", "strict")
    assert "token" not in body


@pytest.mark.parametrize("settings_overrides", [{**ADMIN_ENABLED, "admin_cookie_secure": True}], indirect=True)
async def test_secure_cookie_uses_host_prefix(client):
    r = await client.post("/api/admin/login", json={"username": "root", "password": "correct-horse-battery"})
    cookie = r.headers["set-cookie"]
    assert cookie.startswith("__Host-enjoy_admin=") and "Secure" in cookie and "Path=/" in cookie and "Domain" not in cookie


async def test_wrong_password_401_same_message_for_unknown_user(client):
    a = await client.post("/api/admin/login", json={"username": "root", "password": "wrong-password-xx"})
    b = await client.post("/api/admin/login", json={"username": "ghost", "password": "wrong-password-xx"})
    assert (a.status_code, b.status_code) == (401, 401) and a.json() == b.json()


async def test_session_endpoint_and_logout_revokes(app, client):
    headers = await login_as(app, client, "env")
    r = await client.get("/api/admin/session")
    assert r.status_code == 200 and r.json()["username"] == "root" and r.json()["csrf_token"] == headers["X-Admin-CSRF"]
    assert (await client.post("/api/admin/logout", headers=headers)).status_code == 204
    assert (await client.get("/api/admin/session")).status_code == 401


async def test_unsafe_methods_require_csrf_and_same_origin(app, client):
    headers = await login_as(app, client, "superadmin")
    assert (await client.post("/api/admin/logout")).status_code == 403
    assert (await client.post("/api/admin/logout", headers={"X-Admin-CSRF": "nope"})).status_code == 403
    bad_origin = {**headers, "Origin": "https://evil.example"}
    assert (await client.post("/api/admin/logout", headers=bad_origin)).status_code == 403
    assert (await client.post("/api/admin/logout", headers={**headers, "Origin": "http://test"})).status_code == 204


async def test_bearer_tokens_are_rejected(client):
    assert (await client.get("/api/admin/overview", headers={"Authorization": "Bearer abc.def"})).status_code == 401


async def test_idle_and_absolute_expiry(app):
    now = datetime(2026, 10, 9, 9, tzinfo=timezone.utc)
    async with app.state.sessionmaker() as s:
        row, token, _ = await sess.create(s, Principal(None, "root", "superadmin", None), secret=b"k", ip="1.1.1.1",
                                          user_agent="ua", now=now, ttl_minutes=480, mfa_done=True)
        await s.commit()
        assert (await sess.resolve(s, token, now + timedelta(minutes=29), 30)) is not None
        assert (await sess.resolve(s, token, now + timedelta(minutes=31), 30)) is None  # idle
        row.last_seen_at = now + timedelta(minutes=479)
        await s.commit()
        assert (await sess.resolve(s, token, now + timedelta(minutes=481), 30)) is None  # absolute


async def test_role_matrix(app, client):
    viewer = await login_as(app, client, "viewer")
    assert (await client.get("/api/admin/overview")).status_code == 200
    r = await client.get("/api/admin/session")
    assert r.json()["role"] == "viewer"
    assert (await client.post("/api/admin/logout", headers=viewer)).status_code == 204


async def test_disabled_end_user_gets_403(app, client, auth_headers):
    from sqlalchemy import update

    from app.models import User

    async with app.state.sessionmaker() as s:
        await s.execute(update(User).values(disabled_at=datetime.now(timezone.utc)))
        await s.commit()
    r = await client.get("/api/me", headers=auth_headers)
    assert r.status_code == 403 and r.json() == {"error": "Account disabled"}


async def test_admin_disabled_when_env_account_missing(app, client):
    app.state.settings = app.state.settings.model_copy(update={"admin_username": ""})
    assert (await client.post("/api/admin/login", json={"username": "x", "password": PASSWORD})).status_code == 404


async def test_permission_denials_are_audited_once_per_session_path_and_minute(app, client):
    """Review security m8 (spec §4.7): an operator probing superadmin endpoints must leave a trace."""
    from sqlalchemy import select

    from app.models import AdminAudit

    op = await login_as(app, client, "operator")
    for _ in range(3):
        assert (await client.get("/api/admin/settings/export")).status_code == 403
    assert (await client.post("/api/admin/rank/reset-all", headers=op,
                              json={"reason": "x", "confirm": "RESET 0 USERS"})).status_code == 403
    client.cookies.clear()
    su = await login_as(app, client, "superadmin")
    r = await client.post("/api/admin/rank/reset-all", headers=su, json={"reason": "x", "confirm": "RESET 0 USERS"})
    assert r.status_code == 403 and r.json() == {"error": "Step-up required"}
    async with app.state.sessionmaker() as s:
        rows = (await s.scalars(select(AdminAudit).where(AdminAudit.action == "auth.denied")
                                .order_by(AdminAudit.id))).all()
    assert [(a.actor, a.target_id, a.summary) for a in rows] == [
        ("operator1", "/api/admin/settings/export", "Forbidden"),
        ("operator1", "/api/admin/rank/reset-all", "Forbidden"),
        ("superadmin1", "/api/admin/rank/reset-all", "Step-up required"),
    ]
    assert all(a.result == "denied" for a in rows)
