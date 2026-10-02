import re

from sqlalchemy import select

from app.models import AccessToken


async def _register(client, username="alice", password="password123", **extra):
    return await client.post("/api/users", json={"username": username, "password": password, **extra})


async def test_register_returns_user_and_token(client):
    r = await _register(client, "Alice")
    assert r.status_code == 200
    body = r.json()
    assert re.fullmatch(r"\d{8}", body["id"])
    assert body["name"] == "alice"
    assert len(body["access_token"]) >= 32


async def test_register_duplicate_username_is_409(client):
    assert (await _register(client, "alice")).status_code == 200
    r = await _register(client, "ALICE")
    assert r.status_code == 409
    assert r.json()["error"] == "Username already taken"


async def test_register_rejects_short_password(client):
    r = await _register(client, "alice", "short")
    assert r.status_code == 422
    assert "error" in r.json()


async def test_register_rejects_bad_username(client):
    r = await _register(client, "a b")
    assert r.status_code == 422


async def test_login_success(client):
    reg = (await _register(client)).json()
    r = await client.post(
        "/api/sessions", json={"provider": "password", "username": "alice", "password": "password123"}
    )
    assert r.status_code == 200
    assert r.json()["id"] == reg["id"]
    assert r.json()["access_token"]


async def test_login_wrong_password_and_unknown_user_look_the_same(client):
    await _register(client)
    wrong = await client.post(
        "/api/sessions", json={"provider": "password", "username": "alice", "password": "nope-nope"}
    )
    unknown = await client.post(
        "/api/sessions", json={"provider": "password", "username": "ghost", "password": "nope-nope"}
    )
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json() == {"error": "Invalid username or password"}


async def test_login_unsupported_provider(client):
    r = await client.post("/api/sessions", json={"provider": "github", "username": "a", "password": "b"})
    assert r.status_code == 400


async def test_me_requires_token(client):
    assert (await client.get("/api/me")).status_code == 401
    r = await client.get("/api/me", headers={"Authorization": "Bearer garbage"})
    assert r.status_code == 401


async def test_me_returns_profile_without_access_token(client, auth_headers):
    r = await client.get("/api/me", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "alice"
    assert re.fullmatch(r"\d{8}", body["id"])
    assert "access_token" not in body


async def test_token_is_stored_hashed(app, client):
    token = (await _register(client)).json()["access_token"]
    async with app.state.sessionmaker() as session:
        hashes = (await session.execute(select(AccessToken.token_hash))).scalars().all()
    assert hashes and token not in hashes and len(hashes[0]) == 64
