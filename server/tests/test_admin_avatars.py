"""管理端头像(计划 S7、R-V7):举报列表(viewer)、移除头像与忽略举报(operator,移除需 step-up)、删除用户时删文件。
审计只记用户 id、动作与计数,不记头像 id、文件名或路径;日志同样不带头像 id 或 .webp 文件名。"""
import io
import logging

import pytest
from PIL import Image
from sqlalchemy import func, select

from app.models import AdminAudit, AvatarReport
from app.services.avatars import avatar_key


def path_for(settings, avatar_id: str):
    """The local file of an avatar (these tests run on the default local backend, rooted at the data directory)."""
    return settings.resolved_data_dir / avatar_key(avatar_id)
from tests.admin_helpers import ADMIN_ENABLED, PASSWORD, login_as


@pytest.fixture
def settings_overrides(tmp_path):
    return {**ADMIN_ENABLED, "data_dir": str(tmp_path / "data"), "rooms_enabled": True}


def image(color=(200, 30, 30)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (32, 32), color).save(buf, format="PNG")
    return buf.getvalue()


async def register(client, name):
    r = await client.post("/api/users", json={"username": name, "password": "password123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}, int(r.json()["id"])


async def upload_avatar(client, headers, color=(200, 30, 30)) -> str:
    r = await client.post("/api/me/avatar", files={"file": ("a.png", image(color), "image/png")}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["avatar_url"].rsplit("/", 1)[1]


async def scenario(app, client) -> dict:
    """bob has an avatar and shares a room with alice and carol. alice and carol report bob's avatar,
    and bob reports alice's avatar (so bob is a reporter as well as a reported user)."""
    alice_h, alice_id = await register(client, "alice_av")
    bob_h, bob_id = await register(client, "bob_av")
    carol_h, carol_id = await register(client, "carol_av")
    alice_avatar = await upload_avatar(client, alice_h, (10, 200, 10))
    bob_avatar = await upload_avatar(client, bob_h)
    room = (await client.post("/api/rooms", json={"topic": "moderation"}, headers=alice_h)).json()["room"]
    for headers in (bob_h, carol_h):
        r = await client.post("/api/rooms/join", json={"code": room["code"]}, headers=headers)
        assert r.status_code == 200, r.text
    for headers, reason in ((alice_h, "inappropriate"), (carol_h, "impersonation")):
        r = await client.post("/api/avatar-reports", json={"user_id": str(bob_id), "reason": reason}, headers=headers)
        assert r.status_code == 201, r.text
    r = await client.post("/api/avatar-reports", json={"user_id": str(alice_id), "reason": "other"}, headers=bob_h)
    assert r.status_code == 201, r.text
    return {"alice": (alice_h, alice_id, alice_avatar), "bob": (bob_h, bob_id, bob_avatar),
            "carol": (carol_h, carol_id, None)}


async def step_up(client, headers) -> None:
    r = await client.post("/api/admin/step-up", headers=headers, json={"password": PASSWORD})
    assert r.status_code == 200, r.text


async def count_reports(app, **where) -> int:
    async with app.state.sessionmaker() as s:
        stmt = select(func.count()).select_from(AvatarReport)
        for column, value in where.items():
            stmt = stmt.where(getattr(AvatarReport, column) == value)
        return await s.scalar(stmt)


async def test_viewer_lists_open_reports_grouped_per_user(app, client, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    people = await scenario(app, client)
    _, bob_id, bob_avatar = people["bob"]
    h = await login_as(app, client, "viewer")
    r = await client.get("/api/admin/avatar-reports", params={"status": "open"}, headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["page"] == 1 and body["next"] is None
    assert {u["user_id"] for u in body["users"]} == {bob_id, people["alice"][1]}  # bob also reported alice
    bob = next(u for u in body["users"] if u["user_id"] == bob_id)
    assert set(bob) == {"user_id", "username", "nickname", "avatar_url", "reports", "last_reason", "last_reported_at"}
    assert bob["username"] == "bob_av" and bob["nickname"] is None
    assert bob["avatar_url"] == f"/api/avatars/{bob_avatar}"
    assert bob["reports"] == 2 and bob["last_reason"] == "impersonation"
    assert bob["last_reported_at"].endswith(("+00:00", "Z"))
    assert bob_avatar not in caplog.text and ".webp" not in caplog.text


async def test_viewer_cannot_remove_or_dismiss(app, client):
    people = await scenario(app, client)
    _, bob_id, _ = people["bob"]
    h = await login_as(app, client, "viewer")
    await step_up(client, h)
    assert (await client.request("DELETE", f"/api/admin/users/{bob_id}/avatar", headers=h, json={"reason": "x y"})).status_code == 403
    assert (await client.post(f"/api/admin/avatar-reports/{bob_id}/dismiss", headers=h)).status_code == 403


async def test_remove_needs_operator_step_up_and_resolves_reports(app, client, caplog):
    people = await scenario(app, client)
    _, bob_id, bob_avatar = people["bob"]
    h = await login_as(app, client, "operator")
    caplog.set_level(logging.DEBUG, logger="app")
    body = {"reason": "头像含不当内容"}
    assert (await client.request("DELETE", f"/api/admin/users/{bob_id}/avatar", headers=h, json=body)).status_code == 403
    await step_up(client, h)
    r = await client.request("DELETE", f"/api/admin/users/{bob_id}/avatar", headers=h, json=body)
    assert r.status_code == 200, r.text
    assert r.json() == {"user_id": bob_id, "removed": True, "reports_resolved": 2}
    assert (await client.get(f"/api/avatars/{bob_avatar}")).status_code == 404  # public URL gone at once
    assert not path_for(app.state.settings, bob_avatar).exists()  # file removed after the commit
    assert "avatar_url" not in (await client.get("/api/me", headers=people["bob"][0])).json()  # absent without one
    open_list = (await client.get("/api/admin/avatar-reports", params={"status": "open"}, headers=h)).json()
    assert [u["user_id"] for u in open_list["users"]] == [people["alice"][1]]  # bob's reports left the open list
    resolved = (await client.get("/api/admin/avatar-reports", params={"status": "resolved"}, headers=h)).json()
    assert [(u["user_id"], u["reports"], u["avatar_url"]) for u in resolved["users"]] == [(bob_id, 2, None)]
    assert await count_reports(app, avatar_user_id=bob_id, resolved_at=None) == 0
    async with app.state.sessionmaker() as s:
        audit = (await s.scalars(select(AdminAudit).where(AdminAudit.action == "user.avatar.remove"))).all()
    assert len(audit) == 1
    row = audit[0]
    assert row.target_id == str(bob_id) and row.after == {"removed": True, "reports": 2}
    assert bob_avatar not in str([row.summary, row.after, row.reason, row.target_id])
    assert bob_avatar not in caplog.text and ".webp" not in caplog.text


async def test_remove_user_without_avatar_is_404(app, client):
    _, nobody_id = await register(client, "nobody_av")
    h = await login_as(app, client, "operator")
    await step_up(client, h)
    r = await client.request("DELETE", f"/api/admin/users/{nobody_id}/avatar", headers=h, json={"reason": "x y"})
    assert r.status_code == 404 and r.json() == {"error": "No avatar"}


async def test_dismiss_resolves_reports_and_keeps_the_avatar(app, client, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    people = await scenario(app, client)
    _, bob_id, bob_avatar = people["bob"]
    h = await login_as(app, client, "operator")
    r = await client.post(f"/api/admin/avatar-reports/{bob_id}/dismiss", headers=h)
    assert r.status_code == 200 and r.json() == {"user_id": bob_id, "reports_resolved": 2}
    assert (await client.get(f"/api/avatars/{bob_avatar}")).status_code == 200  # still there
    open_users = (await client.get("/api/admin/avatar-reports", headers=h)).json()["users"]
    assert [u["user_id"] for u in open_users] == [people["alice"][1]]  # alice's avatar still has bob's report
    again = await client.post(f"/api/admin/avatar-reports/{bob_id}/dismiss", headers=h)
    assert again.status_code == 404 and again.json() == {"error": "No open reports"}
    assert bob_avatar not in caplog.text and ".webp" not in caplog.text


async def test_deleting_a_user_removes_their_avatar_file_and_every_report_row(app, client):
    people = await scenario(app, client)
    bob_h, bob_id, bob_avatar = people["bob"]
    alice_avatar = people["alice"][2]
    h = await login_as(app, client, "superadmin")
    await step_up(client, h)
    r = await client.request("DELETE", f"/api/admin/users/{bob_id}", headers=h,
                             json={"confirm_username": "bob_av", "reason": "用户要求注销"})
    assert r.status_code == 200, r.text
    assert not path_for(app.state.settings, bob_avatar).exists()
    assert path_for(app.state.settings, alice_avatar).exists()  # other users' files are untouched
    assert await count_reports(app, avatar_user_id=bob_id) == 0  # reported-user side
    assert await count_reports(app, reporter_id=bob_id) == 0  # reporter side
    assert await count_reports(app, avatar_user_id=people["alice"][1]) == 0  # bob's report of alice went with bob
