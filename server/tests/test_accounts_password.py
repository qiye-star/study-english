"""改密端点 POST /api/me/password(计划 S5;R-F9、INDEX X3、X5、X30)。"""
import logging

from sqlalchemy import select

from app.models import AccessToken
from tests.test_admin_api import register

OLD = "password123"
NEW = "brand-new-pass-456"


async def _login(client, username: str, password: str = OLD) -> dict:
    r = await client.post(
        "/api/sessions", json={"provider": "password", "username": username, "password": password}
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _token_count(app, user_id: int) -> int:
    async with app.state.sessionmaker() as s:
        return len((await s.scalars(select(AccessToken).where(AccessToken.user_id == user_id))).all())


async def test_change_password_rotates_every_token(app, client, monkeypatch):
    monkeypatch.setattr("app.routers.account.cut_connections", _noop_cut)
    uid, first = await register(client, "pwa")
    second = await _login(client, "pwa")

    r = await client.post("/api/me/password", headers=first,
                          json={"current_password": OLD, "new_password": NEW})
    assert r.status_code == 200, r.text
    fresh = {"Authorization": f"Bearer {r.json()['access_token']}"}

    assert (await client.get("/api/me", headers=first)).status_code == 401
    assert (await client.get("/api/me", headers=second)).status_code == 401
    assert (await client.get("/api/me", headers=fresh)).status_code == 200
    assert await _token_count(app, uid) == 1

    bad = await client.post("/api/sessions", json={"provider": "password", "username": "pwa", "password": OLD})
    assert bad.status_code == 401
    await _login(client, "pwa", NEW)


async def test_wrong_current_password_is_403_and_changes_nothing(app, client, monkeypatch):
    monkeypatch.setattr("app.routers.account.cut_connections", _noop_cut)
    uid, headers = await register(client, "pwb")
    r = await client.post("/api/me/password", headers=headers,
                          json={"current_password": "not-the-password", "new_password": NEW})
    assert r.status_code == 403
    assert r.json() == {"error": "Wrong password"}
    assert (await client.get("/api/me", headers=headers)).status_code == 200
    await _login(client, "pwb", OLD)


async def test_new_password_rules_match_registration(client):
    _uid, headers = await register(client, "pwc")
    r = await client.post("/api/me/password", headers=headers,
                          json={"current_password": OLD, "new_password": "short"})
    assert r.status_code == 422


async def test_change_password_needs_a_token(client):
    r = await client.post("/api/me/password", json={"current_password": OLD, "new_password": NEW})
    assert r.status_code == 401


async def test_change_password_cuts_live_connections(app, client, monkeypatch):
    cut: list[int] = []

    async def record(_app, user_id: int) -> None:
        cut.append(user_id)

    monkeypatch.setattr("app.routers.account.cut_connections", record)
    uid, headers = await register(client, "pwd")
    assert (await client.post("/api/me/password", headers=headers,
                              json={"current_password": OLD, "new_password": NEW})).status_code == 200
    assert cut == [uid]


async def test_change_password_response_is_not_cacheable(client, monkeypatch):
    monkeypatch.setattr("app.routers.account.cut_connections", _noop_cut)
    _uid, headers = await register(client, "pwf")
    r = await client.post("/api/me/password", headers=headers,
                          json={"current_password": OLD, "new_password": NEW})
    assert r.status_code == 200
    assert r.headers.get("cache-control") == "no-store"


async def test_change_password_logs_no_secrets(app, client, monkeypatch, caplog):
    monkeypatch.setattr("app.routers.account.cut_connections", _noop_cut)
    caplog.set_level(logging.DEBUG, logger="app")
    _uid, headers = await register(client, "pwg")
    token = headers["Authorization"].split(" ", 1)[1]
    r = await client.post("/api/me/password", headers=headers,
                          json={"current_password": OLD, "new_password": NEW})
    new_token = r.json()["access_token"]
    assert OLD not in caplog.text
    assert NEW not in caplog.text
    assert token not in caplog.text
    assert new_token not in caplog.text


async def _noop_cut(_app, _user_id: int) -> None:
    return None


async def test_cut_connections_failure_does_not_lose_the_new_token(client, monkeypatch, caplog):
    async def boom(_app, _user_id):
        raise RuntimeError("socket gone")

    monkeypatch.setattr("app.routers.account.cut_connections", boom)
    caplog.set_level(logging.DEBUG, logger="app")
    _uid, headers = await register(client, "pwg")
    r = await client.post("/api/me/password", headers=headers,
                          json={"current_password": OLD, "new_password": NEW})
    assert r.status_code == 200 and r.json()["access_token"]
    assert NEW not in caplog.text and OLD not in caplog.text
