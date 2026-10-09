from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.models import AdminAudit, RoomMessage, RoomReport
from app.routers.rooms import runtime
from tests.admin_helpers import ADMIN_ENABLED, login_as
from tests.test_admin_api import register

NOW = datetime(2026, 10, 9, 9, tzinfo=timezone.utc)


@pytest.fixture
def settings_overrides():
    return {**ADMIN_ENABLED, "rooms_enabled": True}


async def _room(client, headers, topic="美食"):
    return (await client.post("/api/rooms", headers=headers, json={"topic": topic})).json()["room"]


async def _say(app, room_id, sender, text, *, lane="public", audience=None):
    rt = runtime(app)
    async with rt.hub.lock(room_id):
        return await rt.store.append(room_id, lane=lane, sender_kind="user", sender_id=sender, kind="text",
                                     text=text, now=NOW, audience_id=audience)


async def _actions(app):
    async with app.state.sessionmaker() as s:
        return [a.action for a in (await s.scalars(select(AdminAudit).order_by(AdminAudit.id))).all()]


async def test_list_detail_and_private_lane_audit(app, client):
    uid, headers = await register(client, "alice")
    room = await _room(client, headers)
    await _say(app, room["id"], uid, "secret draft", lane="private", audience=uid)
    await login_as(app, client, "viewer")
    rooms = (await client.get("/api/admin/rooms", params={"status": "open"})).json()
    assert [r["id"] for r in rooms["rooms"]] == [room["id"]] and rooms["rooms"][0]["owner"]["name"] == "alice"
    assert (await client.get("/api/admin/rooms", params={"q": "alice", "status": "all"})).json()["total"] == 1
    assert (await client.get("/api/admin/rooms", params={"q": room["code"]})).json()["total"] == 1
    assert (await client.get("/api/admin/rooms", params={"status": "closed"})).json()["rooms"] == []
    detail = (await client.get(f"/api/admin/rooms/{room['id']}")).json()
    assert detail["members"][0]["name"] == "alice" and detail["members"][0]["online"] is False
    public = (await client.get(f"/api/admin/rooms/{room['id']}/messages")).json()["messages"]
    assert all(m["lane"] == "public" for m in public) and "room.view_private" not in await _actions(app)
    r = await client.get(f"/api/admin/rooms/{room['id']}/messages", params={"lane": "all"})
    assert r.status_code == 200
    private = [m for m in r.json()["messages"] if m["lane"] == "private"]
    assert private[0]["text"] == "secret draft" and private[0]["audience"] == {"id": uid, "name": "alice"}
    assert "room.view_private" in await _actions(app)
    assert (await client.get("/api/admin/rooms/nope")).status_code == 404


async def test_close_kick_mute_hide(app, client):
    alice, ha = await register(client, "alice")
    bob, hb = await register(client, "bob")
    room = await _room(client, ha)
    await client.post("/api/rooms/join", headers=hb, json={"code": room["code"]})
    msg = await _say(app, room["id"], bob, "spam spam")
    h = await login_as(app, client, "operator")
    r = await client.post(f"/api/admin/rooms/{room['id']}/messages/{msg.id}/hide", headers=h, json={"reason": "广告"})
    assert r.status_code == 200
    async with app.state.sessionmaker() as s:
        assert (await s.get(RoomMessage, msg.id)).hidden_at is not None  # hidden, never deleted (R-6)
    member_view = (await client.get(f"/api/rooms/{room['id']}/messages", headers=ha, params={"before_seq": 999})).json()
    hidden = [m for m in member_view["messages"] if m["id"] == msg.id][0]
    assert hidden["hidden"] is True and hidden["text"] == ""
    admin_view = (await client.get(f"/api/admin/rooms/{room['id']}/messages")).json()["messages"]
    assert [m for m in admin_view if m["id"] == msg.id][0]["text"] == "spam spam"
    r = await client.post(f"/api/admin/rooms/{room['id']}/ai", headers=h, json={"muted": True, "reason": "刷屏"})
    assert r.json()["ai_muted"] is True
    assert (await client.post(f"/api/admin/rooms/{room['id']}/kick", headers=h,
                              json={"user_id": bob, "reason": "广告"})).status_code == 200
    r = await client.post("/api/rooms/join", headers=hb, json={"code": room["code"]})
    assert r.status_code == 403 and r.json() == {"error": "Removed from room"}
    assert (await client.post(f"/api/admin/rooms/{room['id']}/close", headers=h, json={"reason": "违规"})).status_code == 200
    detail = (await client.get(f"/api/admin/rooms/{room['id']}")).json()
    assert detail["status"] == "closed" and detail["close_reason"] == "admin" and detail["ai_muted"] is True
    assert (await client.post(f"/api/admin/rooms/{room['id']}/close", headers=h, json={"reason": "违规"})).status_code == 404
    actions = [a for a in await _actions(app) if a.startswith("room.")]
    assert actions == ["room.hide_message", "room.ai_mute", "room.kick", "room.close"]
    async with app.state.sessionmaker() as s:
        audits = (await s.scalars(select(AdminAudit))).all()
    assert "spam" not in str([(a.after, a.summary) for a in audits])  # message text never reaches the audit


async def test_reports_queue_and_resolution_actions(app, client):
    alice, ha = await register(client, "alice")
    bob, hb = await register(client, "bob")
    room = await _room(client, ha)
    await client.post("/api/rooms/join", headers=hb, json={"code": room["code"]})
    bad = await _say(app, room["id"], bob, "buy now")
    fine = await _say(app, room["id"], bob, "hello")
    for m in (bad, fine):
        assert (await client.post(f"/api/rooms/{room['id']}/messages/{m.id}/report", headers=ha,
                                  json={"reason": "spam"})).status_code == 200
    h = await login_as(app, client, "operator")
    reports = (await client.get("/api/admin/reports")).json()["reports"]
    assert [r["message"]["text"] for r in reports] == ["buy now", "hello"]
    assert reports[0]["reporter"]["name"] == "alice" and reports[0]["message"]["sender"]["name"] == "bob"
    by_text = {r["message"]["text"]: r["id"] for r in reports}
    r = await client.post(f"/api/admin/reports/{by_text['hello']}/resolve", headers=h,
                          json={"resolution": "dismissed", "reason": "正常发言"})
    assert r.status_code == 200
    r = await client.post(f"/api/admin/reports/{by_text['buy now']}/resolve", headers=h,
                          json={"resolution": "kicked", "reason": "广告"})
    assert r.status_code == 200
    assert (await client.post("/api/rooms/join", headers=hb, json={"code": room["code"]})).status_code == 403
    assert (await client.post(f"/api/admin/reports/{by_text['hello']}/resolve", headers=h,
                              json={"resolution": "dismissed", "reason": "again"})).status_code == 409
    assert (await client.get("/api/admin/reports")).json()["reports"] == []
    done = (await client.get("/api/admin/reports", params={"status": "resolved"})).json()["reports"]
    assert {d["resolution"] for d in done} == {"dismissed", "kicked"} and done[0]["resolved_by"] == "operator1"
    async with app.state.sessionmaker() as s:
        assert all(r.resolved_at for r in (await s.scalars(select(RoomReport))).all())


async def test_resolve_by_hiding_and_by_closing(app, client):
    alice, ha = await register(client, "alice")
    bob, hb = await register(client, "bob")
    room = await _room(client, ha)
    await client.post("/api/rooms/join", headers=hb, json={"code": room["code"]})
    one = await _say(app, room["id"], bob, "rude")
    two = await _say(app, room["id"], bob, "ruder")
    for m in (one, two):
        await client.post(f"/api/rooms/{room['id']}/messages/{m.id}/report", headers=ha, json={"reason": "abuse"})
    h = await login_as(app, client, "operator")
    ids = {r["message"]["id"]: r["id"] for r in (await client.get("/api/admin/reports")).json()["reports"]}
    await client.post(f"/api/admin/reports/{ids[one.id]}/resolve", headers=h,
                      json={"resolution": "removed_message", "reason": "辱骂"})
    await client.post(f"/api/admin/reports/{ids[two.id]}/resolve", headers=h,
                      json={"resolution": "closed_room", "reason": "辱骂"})
    async with app.state.sessionmaker() as s:
        assert (await s.get(RoomMessage, one.id)).hidden_at is not None
    assert (await client.get(f"/api/admin/rooms/{room['id']}")).json()["close_reason"] == "admin"


async def test_viewer_cannot_moderate_and_operator_needs_reason(app, client):
    alice, ha = await register(client, "alice")
    room = await _room(client, ha)
    h = await login_as(app, client, "viewer")
    assert (await client.post(f"/api/admin/rooms/{room['id']}/close", headers=h, json={"reason": "x"})).status_code == 403
    assert (await client.get("/api/admin/reports")).status_code == 403
    h = await login_as(app, client, "operator")
    assert (await client.post(f"/api/admin/rooms/{room['id']}/close", headers=h, json={"reason": " "})).status_code == 422


async def test_room_owner_cap_follows_per_user_override(app, client):
    alice, ha = await register(client, "alice")
    for i in range(3):
        assert (await client.post("/api/rooms", headers=ha, json={"topic": f"t{i}"})).status_code == 200
    assert (await client.post("/api/rooms", headers=ha, json={"topic": "t4"})).status_code == 429
    h = await login_as(app, client, "operator")
    await client.put(f"/api/admin/users/{alice}/quotas/rooms_max_owned", headers=h, json={"value": 4})
    assert (await client.post("/api/rooms", headers=ha, json={"topic": "t4"})).status_code == 200


async def test_reconfigure_applies_limits_and_closes_when_disabled(app, client):
    rt = runtime(app)
    hub = app.state.settings_hub
    closed: list[int] = []

    async def fake_close_all(code):
        closed.append(code)

    rt.hub.close_all = fake_close_all
    rt.hub.active_rooms = lambda: {"r1"}
    new = app.state.settings.model_copy(update={"rooms_max_members": 3, "rooms_ai_per_room_hour": 7})
    hub.publish(new)
    assert rt.store.limits.max_members == 3 and rt.ai_room_limiter.limit == 7 and closed == []
    hub.publish(new.model_copy(update={"maintenance_mode": "read_only"}))
    await rt.hub.drain()
    assert closed == [1012]
    hub.publish(new.model_copy(update={"rooms_enabled": False}))
    await rt.hub.drain()
    assert closed == [1012, 4003]
