import asyncio
import uuid

import pytest
from sqlalchemy import func, select

from app.models import Message

URL = "/api/conversations"
TICK = 0.02  # Windows 时钟精度约 15 ms,改变 updated_at 顺序的操作之间要等一下


async def register(client, username):
    r = await client.post("/api/users", json={"username": username, "password": "password123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def create(client, headers, **body):
    r = await client.post(URL, headers=headers, json=body)
    assert r.status_code == 200, r.text
    return r.json()


async def add_messages(client, headers, cid, *pairs):
    payload = {"messages": [{"role": role, "content": content} for role, content in pairs]}
    return await client.post(f"{URL}/{cid}/messages", headers=headers, json=payload)


@pytest.mark.parametrize(
    "method,path",
    [
        ("GET", "/api/conversations"),
        ("POST", "/api/conversations"),
        ("GET", "/api/conversations/x"),
        ("PATCH", "/api/conversations/x"),
        ("DELETE", "/api/conversations/x"),
        ("GET", "/api/conversations/x/messages"),
        ("POST", "/api/conversations/x/messages"),
        ("DELETE", "/api/messages/x"),
    ],
)
async def test_requires_login(client, method, path):
    r = await client.request(method, path, json={})
    assert r.status_code == 401
    assert r.json() == {"error": "Unauthorized"}


async def test_create_and_get(client, auth_headers):
    conv = await create(client, auth_headers, name="  Daily chat ", config={"system_prompt": "Be brief", "temperature": 0.5})
    uuid.UUID(conv["id"])
    assert conv["name"] == "Daily chat"
    assert conv["config"] == {"system_prompt": "Be brief", "temperature": 0.5}
    assert conv["created_at"].endswith("+00:00") and conv["updated_at"].endswith("+00:00")
    r = await client.get(f"{URL}/{conv['id']}", headers=auth_headers)
    assert r.status_code == 200
    assert r.json() == conv


async def test_create_defaults(client, auth_headers):
    conv = await create(client, auth_headers)
    assert conv["name"] == "New conversation"
    assert conv["config"] == {}


@pytest.mark.parametrize("body", [{"name": "x" * 101}, {"name": "   "}, {"config": [1, 2]}, {"config": "text"}])
async def test_create_validation(client, auth_headers, body):
    r = await client.post(URL, headers=auth_headers, json=body)
    assert r.status_code == 422
    assert "error" in r.json()


async def test_config_too_large(client, auth_headers):
    big = {"system_prompt": "x" * 17000}
    r = await client.post(URL, headers=auth_headers, json={"config": big})
    assert r.status_code == 400
    assert r.json() == {"error": "Config is too large"}
    conv = await create(client, auth_headers)
    r = await client.patch(f"{URL}/{conv['id']}", headers=auth_headers, json={"config": big})
    assert r.status_code == 400


async def test_list_orders_by_updated_and_paginates(client, auth_headers):
    ids = []
    for name in ("a", "b", "c"):
        ids.append((await create(client, auth_headers, name=name))["id"])
        await asyncio.sleep(TICK)
    first = (await client.get(URL, headers=auth_headers, params={"per_page": 2})).json()
    assert [c["name"] for c in first["conversations"]] == ["c", "b"]
    assert first["page"] == 1 and first["next"] == 2
    second = (await client.get(URL, headers=auth_headers, params={"per_page": 2, "page": 2})).json()
    assert [c["name"] for c in second["conversations"]] == ["a"]
    assert second["next"] is None
    await client.patch(f"{URL}/{ids[0]}", headers=auth_headers, json={"name": "a2"})
    names = [c["name"] for c in (await client.get(URL, headers=auth_headers)).json()["conversations"]]
    assert names == ["a2", "c", "b"]


@pytest.mark.parametrize("params", [{"per_page": 51}, {"per_page": 0}, {"page": 0}])
async def test_list_params_validated(client, auth_headers, params):
    r = await client.get(URL, headers=auth_headers, params=params)
    assert r.status_code == 422


async def test_patch(client, auth_headers):
    conv = await create(client, auth_headers, name="old", config={"a": 1})
    await asyncio.sleep(TICK)
    body = (await client.patch(f"{URL}/{conv['id']}", headers=auth_headers, json={"config": {"b": 2}})).json()
    assert body["name"] == "old" and body["config"] == {"b": 2}
    assert body["updated_at"] > conv["updated_at"]
    body = (await client.patch(f"{URL}/{conv['id']}", headers=auth_headers, json={"name": " new "})).json()
    assert body["name"] == "new" and body["config"] == {"b": 2}
    r = await client.patch(f"{URL}/{conv['id']}", headers=auth_headers, json={"name": ""})
    assert r.status_code == 422


async def test_delete_removes_messages(app, client, auth_headers):
    conv = await create(client, auth_headers)
    assert (await add_messages(client, auth_headers, conv["id"], ("user", "hi"))).status_code == 200
    r = await client.delete(f"{URL}/{conv['id']}", headers=auth_headers)
    assert r.status_code == 200 and r.json() == {"id": conv["id"]}
    assert (await client.get(f"{URL}/{conv['id']}", headers=auth_headers)).status_code == 404
    async with app.state.sessionmaker() as s:
        assert await s.scalar(select(func.count()).select_from(Message)) == 0


async def test_messages_pair_roundtrip_and_order(client, auth_headers):
    conv = await create(client, auth_headers)
    r = await add_messages(client, auth_headers, conv["id"], ("user", "Hello"), ("assistant", "Hi there!"))
    assert r.status_code == 200, r.text
    created = r.json()["messages"]
    assert [(m["role"], m["content"]) for m in created] == [("user", "Hello"), ("assistant", "Hi there!")]
    assert all(m["conversation_id"] == conv["id"] for m in created)
    assert created[0]["created_at"] < created[1]["created_at"]
    # 紧接着再发一批(可能落在同一个时钟刻度内),仍须排在后面
    assert (await add_messages(client, auth_headers, conv["id"], ("user", "Again"))).status_code == 200
    listed = (await client.get(f"{URL}/{conv['id']}/messages", headers=auth_headers)).json()["messages"]
    assert [m["content"] for m in listed] == ["Hello", "Hi there!", "Again"]


async def test_posting_messages_bumps_conversation(client, auth_headers):
    a = await create(client, auth_headers, name="a")
    await asyncio.sleep(TICK)
    await create(client, auth_headers, name="b")
    await asyncio.sleep(TICK)
    await add_messages(client, auth_headers, a["id"], ("user", "hi"))
    names = [c["name"] for c in (await client.get(URL, headers=auth_headers)).json()["conversations"]]
    assert names == ["a", "b"]


@pytest.mark.parametrize(
    "payload",
    [
        {"messages": []},
        {"messages": [{"role": "user", "content": "x"}] * 11},
        {"messages": [{"role": "tool", "content": "x"}]},
        {"messages": [{"role": "user", "content": ""}]},
        {"messages": [{"role": "user", "content": "x" * 20001}]},
    ],
)
async def test_message_validation(client, auth_headers, payload):
    conv = await create(client, auth_headers)
    r = await client.post(f"{URL}/{conv['id']}/messages", headers=auth_headers, json=payload)
    assert r.status_code == 422


async def test_delete_message(client, auth_headers):
    conv = await create(client, auth_headers)
    msg = (await add_messages(client, auth_headers, conv["id"], ("user", "a"), ("assistant", "b"))).json()["messages"][0]
    r = await client.delete(f"/api/messages/{msg['id']}", headers=auth_headers)
    assert r.status_code == 200 and r.json() == {"id": msg["id"]}
    listed = (await client.get(f"{URL}/{conv['id']}/messages", headers=auth_headers)).json()["messages"]
    assert [m["content"] for m in listed] == ["b"]
    r = await client.delete(f"/api/messages/{msg['id']}", headers=auth_headers)
    assert r.status_code == 404 and r.json() == {"error": "Message not found"}


async def test_isolation(client, auth_headers):
    conv = await create(client, auth_headers, name="private")
    msg = (await add_messages(client, auth_headers, conv["id"], ("user", "secret"))).json()["messages"][0]
    bob = await register(client, "bob")
    attempts = [
        ("GET", f"{URL}/{conv['id']}", None),
        ("PATCH", f"{URL}/{conv['id']}", {"name": "x"}),
        ("DELETE", f"{URL}/{conv['id']}", None),
        ("GET", f"{URL}/{conv['id']}/messages", None),
        ("POST", f"{URL}/{conv['id']}/messages", {"messages": [{"role": "user", "content": "x"}]}),
    ]
    for method, path, body in attempts:
        r = await client.request(method, path, headers=bob, json=body)
        assert r.status_code == 404, (method, path)
        assert r.json() == {"error": "Conversation not found"}
    r = await client.delete(f"/api/messages/{msg['id']}", headers=bob)
    assert r.status_code == 404 and r.json() == {"error": "Message not found"}
    assert (await client.get(URL, headers=bob)).json()["conversations"] == []
    mine = (await client.get(f"{URL}/{conv['id']}/messages", headers=auth_headers)).json()["messages"]
    assert [m["id"] for m in mine] == [msg["id"]]
    assert (await client.get(f"{URL}/{conv['id']}", headers=auth_headers)).json()["name"] == "private"


@pytest.mark.parametrize("settings_overrides", [{"max_conversations": 2}], indirect=True)
async def test_conversation_limit_is_per_user(client, auth_headers):
    await create(client, auth_headers)
    await create(client, auth_headers)
    r = await client.post(URL, headers=auth_headers, json={})
    assert r.status_code == 429
    assert r.json() == {"error": "Conversation limit reached"}
    bob = await register(client, "bob")
    await create(client, bob)


@pytest.mark.parametrize("settings_overrides", [{"max_messages_per_conversation": 3}], indirect=True)
async def test_message_limit_rejects_whole_batch(client, auth_headers):
    conv = await create(client, auth_headers)
    assert (await add_messages(client, auth_headers, conv["id"], ("user", "q"), ("assistant", "a"))).status_code == 200
    r = await add_messages(client, auth_headers, conv["id"], ("user", "q2"), ("assistant", "a2"))
    assert r.status_code == 429
    assert r.json() == {"error": "Message limit reached"}
    listed = (await client.get(f"{URL}/{conv['id']}/messages", headers=auth_headers)).json()["messages"]
    assert len(listed) == 2
