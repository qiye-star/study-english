"""Admin views add `nickname` beside `username` and search matches nicknames (plan S8, INDEX X6).

`username` stays the operator's identity; `nickname` is additive and may be null.
"""
from datetime import datetime, timezone

import pytest
from sqlalchemy import update

from app.models import User
from app.routers.rooms import runtime
from tests.admin_helpers import ADMIN_ENABLED, login_as
from tests.test_admin_api import register

NOW = datetime(2026, 10, 19, 9, tzinfo=timezone.utc)


@pytest.fixture
def settings_overrides():
    return {**ADMIN_ENABLED, "rooms_enabled": True}


async def _set_nickname(app, user_id: int, nickname: str | None) -> None:
    async with app.state.sessionmaker() as s:
        await s.execute(update(User).where(User.id == user_id).values(nickname=nickname))
        await s.commit()


async def test_user_list_detail_and_search_carry_nickname(app, client):
    alice, _ = await register(client, "alice")
    bob, _ = await register(client, "bob")
    await _set_nickname(app, alice, "小明")
    await login_as(app, client, "viewer")

    body = (await client.get("/api/admin/users")).json()
    by_name = {u["username"]: u for u in body["users"]}
    assert by_name["alice"]["nickname"] == "小明"
    assert by_name["bob"]["nickname"] is None  # present and null, not missing
    assert by_name["alice"]["username"] == "alice"  # the login name is unchanged (X6)

    found = (await client.get("/api/admin/users", params={"q": "小明"})).json()
    assert [u["username"] for u in found["users"]] == ["alice"] and found["total"] == 1
    assert (await client.get("/api/admin/users", params={"q": "ALI"})).json()["total"] == 1  # login name still matches

    detail = (await client.get(f"/api/admin/users/{alice}")).json()
    assert detail["nickname"] == "小明" and detail["username"] == "alice"
    assert (await client.get(f"/api/admin/users/{bob}")).json()["nickname"] is None


async def test_room_members_and_messages_carry_nickname(app, client):
    alice, ha = await register(client, "alice")
    bob, hb = await register(client, "bob")
    await _set_nickname(app, alice, "小明")
    room = (await client.post("/api/rooms", headers=ha, json={"topic": "美食"})).json()["room"]
    await client.post("/api/rooms/join", headers=hb, json={"code": room["code"]})
    rt = runtime(app)
    async with rt.hub.lock(room["id"]):
        await rt.store.append(room["id"], lane="public", sender_kind="user", sender_id=alice, kind="text",
                              text="hello", now=NOW, audience_id=None)
    await login_as(app, client, "viewer")

    detail = (await client.get(f"/api/admin/rooms/{room['id']}")).json()
    members = {m["user_id"]: m for m in detail["members"]}
    assert members[alice]["name"] == "alice" and members[alice]["nickname"] == "小明"
    assert members[bob]["nickname"] is None

    msgs = (await client.get(f"/api/admin/rooms/{room['id']}/messages")).json()["messages"]
    sender = msgs[-1]["sender"]
    assert sender["name"] == "alice" and sender["nickname"] == "小明"
