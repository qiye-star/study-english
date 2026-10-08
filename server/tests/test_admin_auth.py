import pytest

from app.admin import auth
from tests.conftest import make_settings
from app.main import create_app

PASSWORD = "correct-horse-battery"
ENABLED = {"admin_username": "root", "admin_password": PASSWORD, "admin_session_secret": "s3cret"}
SECRET = b"unit-secret"


def test_token_round_trip_and_expiry():
    token, exp = auth.issue_token(SECRET, 10, now=1000)
    assert exp == 1600
    assert auth.verify_token(SECRET, token, now=1599)
    assert not auth.verify_token(SECRET, token, now=1600)


def test_token_rejects_tampering_wrong_secret_and_garbage():
    token, _ = auth.issue_token(SECRET, 10)
    body, _, sig = token.partition(".")
    assert not auth.verify_token(b"other", token)
    assert not auth.verify_token(SECRET, f"{body}.{sig[:-2]}xx")
    assert not auth.verify_token(SECRET, "")
    assert not auth.verify_token(SECRET, "abc")
    assert not auth.verify_token(SECRET, "a.b")


def test_token_with_wrong_type_is_rejected():
    import json

    body = auth._b64(json.dumps({"typ": "user", "exp": 9_999_999_999}).encode())
    assert not auth.verify_token(SECRET, f"{body}.{auth._sign(SECRET, body)}")


@pytest.mark.parametrize("settings_overrides", [ENABLED], indirect=True)
async def test_login_success_returns_working_token(client):
    r = await client.post("/api/admin/login", json={"username": "root", "password": PASSWORD})
    assert r.status_code == 200
    body = r.json()
    assert body["expires_at"].endswith("+00:00")
    ok = await client.get("/api/admin/overview", headers={"Authorization": f"Bearer {body['token']}"})
    assert ok.status_code == 200


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
async def test_requires_admin_token(client, auth_headers):
    assert (await client.get("/api/admin/overview")).status_code == 401
    assert (await client.get("/api/admin/overview", headers={"Authorization": "Bearer nope"})).status_code == 401
    # a normal user's access token is not an admin token
    assert (await client.get("/api/admin/overview", headers=auth_headers)).status_code == 401


@pytest.mark.parametrize("settings_overrides", [ENABLED], indirect=True)
async def test_expired_token_is_rejected(app, client):
    token, _ = auth.issue_token(app.state.admin_secret, 10, now=1)
    r = await client.get("/api/admin/overview", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401


async def test_disabled_by_default_everything_404(client):
    assert (await client.post("/api/admin/login", json={"username": "a", "password": "b"})).status_code == 404
    assert (await client.get("/api/admin/overview")).status_code == 404


@pytest.mark.parametrize("settings_overrides", [{"admin_username": "root"}], indirect=True)
async def test_username_without_password_stays_disabled(client):
    assert (await client.get("/api/admin/overview")).status_code == 404


def test_short_admin_password_refuses_to_start():
    with pytest.raises(RuntimeError, match="ADMIN_PASSWORD"):
        create_app(make_settings(admin_username="root", admin_password="short"))
