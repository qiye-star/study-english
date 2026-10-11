import json
import logging

import pytest
from sqlalchemy import select

from app.models import AdminAudit, Room, utcnow
from app.routers.rooms import runtime
from tests.admin_helpers import ADMIN_ENABLED, login_as
from tests.test_admin_api import register


@pytest.fixture
def settings_overrides(tmp_path):
    return {**ADMIN_ENABLED, "rooms_enabled": True, "data_dir": str(tmp_path / "data")}


async def _closed(app, client, headers, reason="admin"):
    room = (await client.post("/api/rooms", headers=headers, json={"topic": "美食"})).json()["room"]
    await runtime(app).store.close(room["id"], reason, utcnow())
    return room


async def _audits(app):
    async with app.state.sessionmaker() as s:
        return list((await s.scalars(select(AdminAudit).where(AdminAudit.action == "room.reopen"))).all())


async def test_operator_reopens_an_admin_closed_room_with_an_audit_row(app, client, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    _, ha = await register(client, "alice")
    room = await _closed(app, client, ha)
    h = await login_as(app, client, "operator")
    r = await client.post(f"/api/admin/rooms/{room['id']}/reopen", headers=h, json={"reason": "误关闭,已和房主确认"})
    assert r.status_code == 200 and r.json() == {"ok": True, "reopen_count": 1}
    async with app.state.sessionmaker() as s:
        row = await s.get(Room, room["id"])
    assert row.status == "open" and len(row.code) == 6 and row.close_reason is None and row.reopen_count == 1
    audits = await _audits(app)
    assert len(audits) == 1 and audits[0].target_id == room["id"] and audits[0].reason == "误关闭,已和房主确认"
    assert audits[0].after == {"reopen_count": 1}  # JSON column
    assert row.code not in json.dumps(r.json()) and row.code not in caplog.text
    detail = (await client.get(f"/api/admin/rooms/{room['id']}", headers=h)).json()
    assert detail["reopen_count"] == 1 and detail["opened_at"] is not None and detail["status"] == "open"


async def test_reopen_requires_operator_a_reason_and_a_closed_room(app, client):
    _, ha = await register(client, "alice")
    room = await _closed(app, client, ha)
    hv = await login_as(app, client, "viewer")
    assert (await client.post(f"/api/admin/rooms/{room['id']}/reopen", headers=hv, json={"reason": "x"})).status_code == 403
    ho = await login_as(app, client, "operator")
    assert (await client.post(f"/api/admin/rooms/{room['id']}/reopen", headers=ho, json={})).status_code == 422
    assert (await client.post("/api/admin/rooms/nope/reopen", headers=ho, json={"reason": "x"})).status_code == 404
    ok = await client.post(f"/api/admin/rooms/{room['id']}/reopen", headers=ho, json={"reason": "再开"})
    assert ok.status_code == 200
    again = await client.post(f"/api/admin/rooms/{room['id']}/reopen", headers=ho, json={"reason": "再开"})
    assert again.status_code == 409 and again.json() == {"error": "Room is not closed"}
    assert len(await _audits(app)) == 1  # the failed attempt wrote nothing


async def test_reopen_obeys_the_owner_quota_and_needs_an_owner(app, client):
    _, ha = await register(client, "alice")
    first = await _closed(app, client, ha, reason="owner")
    for _ in range(3):
        await client.post("/api/rooms", headers=ha, json={})
    ho = await login_as(app, client, "operator")
    capped = await client.post(f"/api/admin/rooms/{first['id']}/reopen", headers=ho, json={"reason": "x"})
    assert capped.status_code == 409 and capped.json() == {"error": "Owner has too many open rooms"}
    async with app.state.sessionmaker() as s:
        (await s.get(Room, first["id"])).owner_id = None
        await s.commit()
    nobody = await client.post(f"/api/admin/rooms/{first['id']}/reopen", headers=ho, json={"reason": "x"})
    assert nobody.status_code == 409 and nobody.json() == {"error": "Room has no owner"}
    assert await _audits(app) == []
