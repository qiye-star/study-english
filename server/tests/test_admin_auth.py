import httpx
import pytest

from app.admin import auth
from app.main import create_app
from tests.admin_helpers import ADMIN_ENABLED as ENABLED
from tests.conftest import make_settings

PASSWORD = ENABLED["admin_password"]


def test_credentials_match_needs_both_parts():
    s = make_settings(**ENABLED)
    assert auth.credentials_match(s, "root", PASSWORD)
    assert auth.credentials_match(s, " root ", PASSWORD)
    assert not auth.credentials_match(s, "root", "wrong")
    assert not auth.credentials_match(s, "nobody", PASSWORD)


@pytest.mark.parametrize("settings_overrides", [ENABLED], indirect=True)
async def test_login_success_returns_a_working_cookie_session(client):
    r = await client.post("/api/admin/login", json={"username": "root", "password": PASSWORD})
    assert r.status_code == 200
    body = r.json()
    assert body["expires_at"].endswith("+00:00") and "token" not in body
    assert (await client.get("/api/admin/overview")).status_code == 200


@pytest.mark.parametrize("settings_overrides", [ENABLED], indirect=True)
@pytest.mark.parametrize("username,password", [("root", "wrong"), ("nobody", PASSWORD), ("", "")])
async def test_login_failure_is_uniform_401(client, username, password):
    r = await client.post("/api/admin/login", json={"username": username, "password": password})
    assert r.status_code == 401
    assert r.json() == {"error": "Invalid username or password"}


@pytest.mark.parametrize("settings_overrides", [{**ENABLED, "rate_limit_per_minute": 2}], indirect=True)
async def test_login_is_rate_limited(client):
    codes = [
        (await client.post("/api/admin/login", json={"username": "root", "password": "x"})).status_code
        for _ in range(3)
    ]
    assert codes == [401, 401, 429]


@pytest.mark.parametrize("settings_overrides", [ENABLED], indirect=True)
async def test_requires_admin_session(app, client, auth_headers):
    assert (await client.get("/api/admin/overview")).status_code == 401
    assert (await client.get("/api/admin/overview", headers={"Authorization": "Bearer nope"})).status_code == 401
    # a normal user's access token is not an admin credential
    assert (await client.get("/api/admin/overview", headers=auth_headers)).status_code == 401
    # a forged cookie is not a session
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test",
                                 cookies={"enjoy_admin": "forged"}) as other:
        assert (await other.get("/api/admin/overview")).status_code == 401


async def test_disabled_by_default_everything_404(client):
    assert (await client.post("/api/admin/login", json={"username": "a", "password": "b"})).status_code == 404
    assert (await client.get("/api/admin/overview")).status_code == 404
    assert (await client.get("/api/admin/session")).status_code == 404


@pytest.mark.parametrize("settings_overrides", [{"admin_username": "root"}], indirect=True)
async def test_username_without_password_stays_disabled(client):
    assert (await client.get("/api/admin/overview")).status_code == 404


def test_short_admin_password_refuses_to_start():
    with pytest.raises(RuntimeError, match="ADMIN_PASSWORD"):
        create_app(make_settings(admin_username="root", admin_password="short"))
