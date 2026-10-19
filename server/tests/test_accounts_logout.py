"""登出与 `current_user_unbound`(计划 S4;INDEX X3、X5)。"""
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import select, update
from starlette.requests import Request

from app.core import deps
from app.core.security import hash_token
from app.models import AccessToken, User
from tests.test_admin_api import register


async def _login(client, username="tig", password="password123") -> dict:
    r = await client.post(
        "/api/sessions", json={"provider": "password", "username": username, "password": password}
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _token_rows(app) -> list[AccessToken]:
    async with app.state.sessionmaker() as s:
        return list((await s.scalars(select(AccessToken))).all())


def _request(app, token: str | None) -> Request:
    headers = [(b"authorization", f"Bearer {token}".encode())] if token else []
    return Request({"type": "http", "app": app, "headers": headers, "method": "GET", "path": "/",
                    "query_string": b""})


async def _call(app, dependency, token: str | None) -> tuple[str, int | None]:
    async with app.state.sessionmaker() as s:
        try:
            user = await dependency(_request(app, token), s)
            return ("ok", user.id)
        except HTTPException as e:
            return ("http", e.status_code)


async def test_logout_deletes_only_the_current_token(app, client):
    _uid, _first = await register(client, "tig")
    second = await _login(client)
    first = _first

    r = await client.delete("/api/sessions/current", headers=first)
    assert r.status_code == 204
    assert (await client.get("/api/me", headers=first)).status_code == 401
    assert (await client.get("/api/me", headers=second)).status_code == 200


async def test_logout_requires_a_token(client):
    r = await client.delete("/api/sessions/current")
    assert r.status_code == 401


async def test_logout_precedes_stubs(app, client):
    _uid, headers = await register(client, "tih")
    r = await client.delete("/api/sessions/current", headers=headers)
    assert r.status_code == 204
    assert r.content == b""  # stubs answered {} for DELETE; the real endpoint has an empty body


async def test_unbound_dependency_matches_current_user_today(app, client):
    _uid, headers = await register(client, "tii")
    token = headers["Authorization"].split(" ", 1)[1]

    assert await _call(app, deps.current_user_unbound, token) == await _call(app, deps.current_user, token)
    assert await _call(app, deps.current_user_unbound, "not-a-token") == ("http", 401)
    assert await _call(app, deps.current_user_unbound, None) == ("http", 401)

    async with app.state.sessionmaker() as s:
        await s.execute(update(AccessToken).values(expires_at=datetime.now(timezone.utc) - timedelta(days=1)))
        await s.commit()
    assert await _call(app, deps.current_user_unbound, token) == await _call(app, deps.current_user, token)
    assert await _call(app, deps.current_user_unbound, token) == ("http", 401)

    async with app.state.sessionmaker() as s:
        await s.execute(update(AccessToken).values(expires_at=datetime.now(timezone.utc) + timedelta(days=1)))
        user = await s.scalar(select(User))
        user.disabled_at = datetime.now(timezone.utc)
        await s.commit()
    assert await _call(app, deps.current_user_unbound, token) == await _call(app, deps.current_user, token)
    assert await _call(app, deps.current_user_unbound, token) == ("http", 403)


async def test_get_me_uses_unbound(app, client):
    """GET /api/me must not depend on the binding-gated current_user (S21 will gate that one)."""
    _uid, headers = await register(client, "tik")

    async def refuse_gated(request):  # would be called only if /api/me depended on current_user
        raise HTTPException(418, "gated")

    app.dependency_overrides[deps.current_user] = refuse_gated
    try:
        r = await client.get("/api/me", headers=headers)
    finally:
        app.dependency_overrides.pop(deps.current_user, None)
    assert r.status_code == 200, r.text


async def test_token_row_is_marked_on_the_request(app, client):
    _uid, headers = await register(client, "tij")
    token = headers["Authorization"].split(" ", 1)[1]
    req = _request(app, token)
    async with app.state.sessionmaker() as s:
        await deps.current_user_unbound(req, s)
    rows = await _token_rows(app)
    assert req.state.access_token_id in {row.id for row in rows}
    assert {row.token_hash for row in rows if row.id == req.state.access_token_id} == {hash_token(token)}
