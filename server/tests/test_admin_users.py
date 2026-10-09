import logging

import pytest
from sqlalchemy import func, select

from app.models import AccessToken, AdminAudit, Room, RoomMember, RoomMessage, SpeechToken, User
from tests.admin_helpers import ADMIN_ENABLED, PASSWORD, login_as
from tests.test_admin_api import register, seed_assessment


@pytest.fixture
def settings_overrides(tmp_path):
    return {**ADMIN_ENABLED, "data_dir": str(tmp_path / "data"), "rooms_enabled": True}


async def test_disable_blocks_login_tokens_and_enable_restores(app, client):
    uid, headers = await register(client, "alice")
    async with app.state.sessionmaker() as s:
        s.add(SpeechToken(user_id=uid, purpose="assessment", state="issued"))
        await s.commit()
    h = await login_as(app, client, "operator")
    r = await client.post(f"/api/admin/users/{uid}/disable", headers=h, json={"reason": "滥用"})
    assert r.status_code == 200 and r.json()["revoked"] >= 1 and r.json()["disabled_at"]
    assert (await client.get("/api/me", headers=headers)).status_code == 401  # token revoked
    async with app.state.sessionmaker() as s:
        assert await s.scalar(select(func.count()).select_from(SpeechToken).where(SpeechToken.user_id == uid)) == 0
    r = await client.post("/api/sessions", json={"provider": "password", "username": "alice", "password": "password123"})
    assert r.status_code == 200  # can log in, but every authed call is 403
    assert (await client.get("/api/me", headers={"Authorization": f"Bearer {r.json()['access_token']}"})).status_code == 403
    listing = (await client.get("/api/admin/users", params={"status": "disabled"})).json()
    assert [u["id"] for u in listing["users"]] == [uid] and listing["users"][0]["disabled_at"]
    assert (await client.post(f"/api/admin/users/{uid}/enable", headers=h, json={"reason": "申诉通过"})).status_code == 200
    listing = (await client.get("/api/admin/users", params={"status": "disabled"})).json()
    assert listing["users"] == []
    async with app.state.sessionmaker() as s:
        actions = [a.action for a in (await s.scalars(select(AdminAudit).order_by(AdminAudit.id))).all()]
    assert "user.disable" in actions and "user.enable" in actions


async def test_disable_needs_reason_and_unknown_user_is_404(app, client):
    uid, _ = await register(client, "erin")
    h = await login_as(app, client, "operator")
    assert (await client.post(f"/api/admin/users/{uid}/disable", headers=h, json={"reason": ""})).status_code == 422
    assert (await client.post("/api/admin/users/99999999/disable", headers=h, json={"reason": "x y"})).status_code == 404


async def test_revoke_tokens_logs_out_everywhere(app, client):
    uid, headers = await register(client, "fay")
    h = await login_as(app, client, "operator")
    r = await client.post(f"/api/admin/users/{uid}/revoke-tokens", headers=h)
    assert r.status_code == 200 and r.json() == {"revoked": 1}
    assert (await client.get("/api/me", headers=headers)).status_code == 401


async def test_reset_password_returns_once_and_is_never_logged(app, client, caplog):
    uid, _ = await register(client, "bob")
    h = await login_as(app, client, "operator")
    caplog.set_level(logging.DEBUG)
    r = await client.post(f"/api/admin/users/{uid}/reset-password", headers=h)
    password = r.json()["password"]
    assert r.status_code == 200 and len(password) == 16 and r.headers["cache-control"] == "no-store"
    assert password not in caplog.text
    async with app.state.sessionmaker() as s:
        audits = [(a.after, a.summary, a.reason) for a in (await s.scalars(select(AdminAudit))).all()]
        assert await s.scalar(select(func.count()).select_from(AccessToken).where(AccessToken.user_id == uid)) == 0
    assert password not in str(audits)
    r = await client.post("/api/sessions", json={"provider": "password", "username": "bob", "password": password})
    assert r.status_code == 200


async def test_delete_user_needs_superadmin_step_up_and_exact_username(app, client):
    uid, _ = await register(client, "carol")
    await seed_assessment(app, uid)
    h = await login_as(app, client, "superadmin")
    body = {"confirm_username": "carol", "reason": "用户要求注销"}
    assert (await client.request("DELETE", f"/api/admin/users/{uid}", headers=h, json=body)).status_code == 403
    await client.post("/api/admin/step-up", headers=h, json={"password": PASSWORD})
    r = await client.request("DELETE", f"/api/admin/users/{uid}", headers=h, json={**body, "confirm_username": "carl"})
    assert r.status_code == 409
    r = await client.request("DELETE", f"/api/admin/users/{uid}", headers=h, json=body)
    assert r.status_code == 200 and r.json()["recordings_bytes"] > 0
    async with app.state.sessionmaker() as s:
        assert await s.get(User, uid) is None
        audit = await s.scalar(select(AdminAudit).where(AdminAudit.action == "user.delete"))
    assert audit.target_id == str(uid) and "carol" in audit.summary
    assert not (app.state.settings.resolved_data_dir / "recordings" / str(uid)).exists()


async def test_delete_room_owner_keeps_shared_rooms_and_their_messages(app, client):
    alice, ha = await register(client, "alice")
    bob, hb = await register(client, "bob")
    shared = (await client.post("/api/rooms", headers=ha, json={"topic": "美食"})).json()["room"]
    await client.post("/api/rooms/join", headers=hb, json={"code": shared["code"]})
    solo = (await client.post("/api/rooms", headers=ha, json={"topic": "独自"})).json()["room"]
    h = await login_as(app, client, "superadmin")
    await client.post("/api/admin/step-up", headers=h, json={"password": PASSWORD})
    r = await client.request("DELETE", f"/api/admin/users/{alice}", headers=h,
                             json={"confirm_username": "alice", "reason": "用户要求注销"})
    assert r.status_code == 200, r.text
    async with app.state.sessionmaker() as s:
        room = await s.get(Room, shared["id"])
        assert room.owner_id == bob and room.status == "closed" and room.close_reason == "admin"
        assert await s.scalar(select(func.count()).select_from(RoomMessage)
                              .where(RoomMessage.room_id == shared["id"])) >= 1  # kept (R-6)
        assert await s.scalar(select(func.count()).select_from(RoomMember).where(RoomMember.user_id == alice)) == 0
        assert await s.get(Room, solo["id"]) is None  # nobody else ever joined: nothing of anyone else to keep


async def test_viewer_cannot_moderate(app, client):
    uid, _ = await register(client, "dave")
    h = await login_as(app, client, "viewer")
    assert (await client.post(f"/api/admin/users/{uid}/disable", headers=h, json={"reason": "x"})).status_code == 403


async def test_operator_cannot_delete(app, client):
    uid, _ = await register(client, "gil")
    h = await login_as(app, client, "operator")
    r = await client.request("DELETE", f"/api/admin/users/{uid}", headers=h,
                             json={"confirm_username": "gil", "reason": "测试测试"})
    assert r.status_code == 403


async def test_user_list_sort_and_status(app, client):
    a, _ = await register(client, "aa1")
    b, _ = await register(client, "bb2")
    await seed_assessment(app, b)
    await login_as(app, client, "viewer")
    by_storage = (await client.get("/api/admin/users", params={"sort": "storage"})).json()["users"]
    assert [u["id"] for u in by_storage][:1] == [b]
    active = (await client.get("/api/admin/users", params={"status": "active"})).json()
    assert {u["id"] for u in active["users"]} == {a, b} and active["total"] == 2
    assert all(u["disabled_at"] is None for u in active["users"])
