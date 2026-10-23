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


# ---- chat home (plan 2026-10-23 R1, R4, R11, R12) ----

async def seed_daily(app, headers, client, day, *, cid=None, updated=None):
    from datetime import datetime, timezone
    from app.models import Conversation
    uid = int((await client.get("/api/me", headers=headers)).json()["id"])
    cid = cid or str(uuid.uuid4())
    at = updated or datetime.now(timezone.utc)
    async with app.state.sessionmaker() as s:
        s.add(Conversation(id=cid, user_id=uid, name=day.isoformat(), config={}, daily_date=day, created_at=at, updated_at=at))
        await s.commit()
    return cid, uid


async def test_daily_date_is_in_the_output_and_clients_cannot_write_it(client, auth_headers):
    plain = await create(client, auth_headers, name="x", daily_date="2026-01-01", config={})
    assert plain["daily_date"] is None
    assert (await client.get(f"{URL}/{plain['id']}", headers=auth_headers)).json()["daily_date"] is None
    r = await client.patch(f"{URL}/{plain['id']}", headers=auth_headers, json={"daily_date": "2026-01-01"})
    assert r.json()["daily_date"] is None


async def test_hide_idle_daily_hides_but_keeps_idle_past_defaults(app, client, auth_headers):
    from datetime import datetime, timedelta, timezone
    today = datetime.now(timezone.utc).date()
    normal = (await create(client, auth_headers, name="normal"))["id"]
    idle, _ = await seed_daily(app, auth_headers, client, today - timedelta(days=2))
    replied, _ = await seed_daily(app, auth_headers, client, today - timedelta(days=3))
    current, _ = await seed_daily(app, auth_headers, client, today)
    await add_messages(client, auth_headers, replied, ("assistant", "hi"), ("user", "hello"))
    everything = (await client.get(URL, headers=auth_headers)).json()["conversations"]
    assert {c["id"] for c in everything} == {normal, idle, replied, current}
    hidden = (await client.get(URL, headers=auth_headers, params={"hide_idle_daily": "true"})).json()["conversations"]
    assert {c["id"] for c in hidden} == {normal, replied, current}  # today's default never hides, even with no messages
    assert (await client.get(f"{URL}/{idle}", headers=auth_headers)).status_code == 200  # hidden, not deleted
    assert next(c for c in hidden if c["id"] == current)["daily_date"] == today.isoformat()
    # the viewer's local day decides which default is "today": 14 h ahead of UTC can already be tomorrow
    ahead = (await client.get(URL, headers=auth_headers,
                              params={"hide_idle_daily": "true", "tz_offset_minutes": 840})).json()["conversations"]
    local_today = (datetime.now(timezone.utc) + timedelta(minutes=840)).date()
    assert (current in {c["id"] for c in ahead}) == (local_today == today)
    r = await client.get(URL, headers=auth_headers, params={"tz_offset_minutes": 900})
    assert r.status_code == 422


async def test_listing_order_is_updated_then_id_and_pagination_is_stable_on_ties(app, client, auth_headers):
    from datetime import date, datetime, timezone
    at = datetime(2026, 10, 1, tzinfo=timezone.utc)
    ids = sorted(str(uuid.uuid4()) for _ in range(5))
    for index, cid in enumerate(ids):
        await seed_daily(app, auth_headers, client, date(2026, 9, 1 + index), cid=cid, updated=at)
    seen = []
    for page in (1, 2, 3):
        body = (await client.get(URL, headers=auth_headers, params={"page": page, "per_page": 2})).json()
        seen += [c["id"] for c in body["conversations"]]
    assert seen == sorted(ids, reverse=True) and len(set(seen)) == 5  # same updated_at: id desc, no repeats, no gaps


async def test_a_reply_in_yesterdays_default_moves_it_up_to_today(app, client, auth_headers):
    from datetime import datetime, timedelta, timezone
    now = datetime.now(timezone.utc)
    old = now - timedelta(days=1)
    yesterday, _ = await seed_daily(app, auth_headers, client, old.date(), updated=old)
    other = (await create(client, auth_headers, name="other"))["id"]
    await asyncio.sleep(TICK)
    assert (await add_messages(client, auth_headers, yesterday, ("user", "hi again"))).status_code == 200
    rows = (await client.get(URL, headers=auth_headers, params={"hide_idle_daily": "true"})).json()["conversations"]
    assert [c["id"] for c in rows][:2] == [yesterday, other]
    assert rows[0]["updated_at"][:10] == now.date().isoformat() and rows[0]["daily_date"] == old.date().isoformat()


@pytest.mark.parametrize("settings_overrides", [{"max_conversations": 1}], indirect=True)
async def test_daily_defaults_do_not_count_toward_the_conversation_cap(app, client, auth_headers):
    from datetime import datetime, timedelta, timezone
    today = datetime.now(timezone.utc).date()
    for back in range(3):
        await seed_daily(app, auth_headers, client, today - timedelta(days=back))
    await create(client, auth_headers, name="the one")  # zero ordinary chats so far: allowed
    r = await client.post(URL, headers=auth_headers, json={})
    assert r.status_code == 429 and r.json() == {"error": "Conversation limit reached"}


async def test_deleting_a_default_clears_the_greeting_link_but_keeps_the_greeting(app, client, auth_headers):
    from datetime import datetime, timezone
    from app.models import ChatGreeting
    today = datetime.now(timezone.utc).date()
    cid, uid = await seed_daily(app, auth_headers, client, today)
    now = datetime.now(timezone.utc)
    async with app.state.sessionmaker() as s:
        s.add(ChatGreeting(user_id=uid, local_date=today, conversation_id=cid, message_ids=["m1", "m2", "m3"],
                           status="ready", language="en", persona_id="builtin:partner", lines=[{"en": "x"}] * 3,
                           facts={}, created_at=now, updated_at=now))
        await s.commit()
    assert (await client.delete(f"{URL}/{cid}", headers=auth_headers)).status_code == 200
    async with app.state.sessionmaker() as s:
        row = await s.scalar(select(ChatGreeting))
        assert row.conversation_id is None and row.message_ids == [] and row.lines == [{"en": "x"}] * 3
