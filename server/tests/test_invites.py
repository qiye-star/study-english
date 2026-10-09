from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.admin.invites import new_code
from app.models import InviteCode
from app.services.invites import consume, hash_code, normalise
from tests.admin_helpers import ADMIN_ENABLED, login_as


@pytest.fixture
def settings_overrides():
    return {**ADMIN_ENABLED, "registration_mode": "invite", "invite_code": "ENV-CODE-123"}


async def _register(client, name, code):
    return await client.post("/api/users", json={"username": name, "password": "password123", "invite_code": code})


def test_codes_are_normalised_and_unambiguous():
    code = new_code()
    assert len(code) == 14 and code.count("-") == 2 and not set(code) & set("01OIL")
    assert normalise(" abcd - efgh-jkmn ") == "ABCDEFGHJKMN"
    assert hash_code("abcd-efgh") == hash_code("ABCD EFGH")


async def test_db_codes_have_limited_uses_and_env_code_still_works(app, client):
    h = await login_as(app, client, "operator")
    r = await client.post("/api/admin/invites", headers=h, json={"label": "班级 A", "max_uses": 2})
    code = r.json()["code"]
    listing = (await client.get("/api/admin/invites")).json()
    assert r.status_code == 201 and r.headers["cache-control"] == "no-store"
    assert "code" not in str(listing) and code not in str(listing)
    assert (await _register(client, "user_a1", code)).status_code == 200
    assert (await _register(client, "user_a2", code.lower().replace("-", " - "))).status_code == 200  # normalised
    assert (await _register(client, "user_a3", code)).status_code == 403
    assert (await _register(client, "user_a4", "ENV-CODE-123")).status_code == 200
    invites = (await client.get("/api/admin/invites")).json()["invites"]
    assert {i["label"]: i["state"] for i in invites} == {"班级 A": "used_up"} and invites[0]["uses"] == 2


async def test_failed_registration_does_not_consume_and_revoked_codes_fail(app, client):
    h = await login_as(app, client, "operator")
    created = (await client.post("/api/admin/invites", headers=h, json={"label": "x", "max_uses": 1})).json()
    assert (await _register(client, "dup", created["code"])).status_code == 200
    second = (await client.post("/api/admin/invites", headers=h, json={"label": "y", "max_uses": 1})).json()
    assert (await _register(client, "dup", second["code"])).status_code == 409  # username taken
    assert (await _register(client, "fresh", second["code"])).status_code == 200  # use was not consumed
    third = (await client.post("/api/admin/invites", headers=h, json={"label": "z", "max_uses": 5})).json()
    assert (await client.delete(f"/api/admin/invites/{third['invite']['id']}", headers=h)).status_code == 204
    assert (await _register(client, "late", third["code"])).status_code == 403
    states = {i["label"]: i["state"] for i in (await client.get("/api/admin/invites")).json()["invites"]}
    assert states["z"] == "revoked"


async def test_expired_codes_and_bad_input(app, client):
    h = await login_as(app, client, "operator")
    assert (await _register(client, "nob", "")).status_code == 403
    assert (await client.post("/api/admin/invites", headers=h, json={"label": "x", "max_uses": 0})).status_code == 422
    past = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    assert (await client.post("/api/admin/invites", headers=h,
                              json={"label": "x", "max_uses": 1, "expires_at": past})).status_code == 422
    soon = (await client.post("/api/admin/invites", headers=h, json={"label": "soon", "max_uses": 3})).json()
    async with app.state.sessionmaker() as s:
        row = await s.get(InviteCode, soon["invite"]["id"])
        row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await s.commit()
    assert (await _register(client, "tardy", soon["code"])).status_code == 403
    states = {i["label"]: i["state"] for i in (await client.get("/api/admin/invites")).json()["invites"]}
    assert states["soon"] == "expired"
    assert (await client.delete("/api/admin/invites/9999", headers=h)).status_code == 404


async def test_consume_is_one_conditional_update(app, client):
    h = await login_as(app, client, "operator")
    code = (await client.post("/api/admin/invites", headers=h, json={"label": "c", "max_uses": 1})).json()["code"]
    now = datetime.now(timezone.utc)
    async with app.state.sessionmaker() as s1, app.state.sessionmaker() as s2:
        assert await consume(s1, code, now) is True
        await s1.commit()
        assert await consume(s2, code, now) is False
        await s2.rollback()
        assert (await s2.scalar(select(InviteCode.uses))) == 1


async def test_viewer_cannot_manage_invites(app, client):
    h = await login_as(app, client, "viewer")
    assert (await client.get("/api/admin/invites")).status_code == 403
    assert (await client.post("/api/admin/invites", headers=h, json={"label": "x", "max_uses": 1})).status_code == 403
