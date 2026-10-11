import logging
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app.agents import settings as agent_settings
from app.agents.memory.store import ThreadKey
from app.models import AgentRecap, AgentThreadState
from tests.agents_memory_helpers import check_contract, enable_agents, user_id_of

NOW = datetime(2026, 10, 12, 8, 0, tzinfo=timezone.utc)
BASE = "/api/agents/memory"


@pytest.fixture
async def uid(client, auth_headers):
    return await user_id_of(client, auth_headers)


async def seed(app, uid):
    store = app.state.agent_memory.store
    a = await store.add(uid, kind="goal", text="准备雅思口语考试", importance=4, persona_id=None, source="chat")
    b = await store.add(uid, kind="preference", text="喜欢先听再说", importance=3, persona_id="builtin:coach",
                        source="tutor")
    r = await store.add_recap(uid, source="tutor", text="8 题答对 6 题", persona_id="builtin:coach",
                              tutor_session_id="t-1")
    return a, b, r


@pytest.mark.parametrize("method, path", [("GET", "/profile"), ("GET", "/items"), ("GET", "/recaps"),
                                          ("GET", "/export"), ("DELETE", "/items/x")])
async def test_memory_routes_are_404_while_agents_are_off(client, auth_headers, method, path):
    r = await client.request(method, BASE + path, headers=auth_headers)
    assert (r.status_code, r.json()) == (404, {"error": "Agents are disabled"})


async def test_memory_routes_require_login(app, client):
    enable_agents(app)
    assert (await client.get(f"{BASE}/profile")).status_code == 401


async def test_profile_get_patch_and_proposals(app, client, auth_headers, uid):
    enable_agents(app)
    r = await client.get(f"{BASE}/profile", headers=auth_headers)
    assert r.json() == {"profile": {}, "edited_keys": [], "proposals": {}, "memory_enabled": True,
                        "memory_available": True}
    r = await client.patch(f"{BASE}/profile", headers=auth_headers,
                           json={"values": {"level": "B1", "goals": ["雅思 7 分"]}})
    assert r.status_code == 200
    assert (r.json()["profile"], r.json()["edited_keys"]) == ({"level": "B1", "goals": ["雅思 7 分"]}, ["level", "goals"])
    assert await app.state.agent_memory.store.propose(uid, "level", "B2") == "proposed"
    assert (await client.get(f"{BASE}/profile", headers=auth_headers)).json()["proposals"] == {"level": "B2"}
    r = await client.patch(f"{BASE}/profile", headers=auth_headers, json={"dismiss": ["level"]})
    assert r.json()["proposals"] == {}
    for body in ({"values": {"level": "Z9"}}, {"values": {"age": 3}}, {"dismiss": ["age"]}):
        r = await client.patch(f"{BASE}/profile", headers=auth_headers, json=body)
        assert (r.status_code, r.json()) == (422, {"error": "Invalid profile value"})
    r = await client.patch(f"{BASE}/profile", headers=auth_headers, json={})
    assert (r.status_code, r.json()) == (400, {"error": "Nothing to update"})


async def test_profile_reports_the_pause_switch_and_the_server_switch(app, client, auth_headers):
    enable_agents(app)
    uid = await user_id_of(client, auth_headers)
    async with app.state.sessionmaker() as s:  # what PATCH /api/agents/settings (A1) does; that router merges separately
        await agent_settings.save(s, uid, {"memory_enabled": False})
        await s.commit()
    enable_agents(app, agents_memory_enabled=False)
    body = (await client.get(f"{BASE}/profile", headers=auth_headers)).json()
    assert (body["memory_enabled"], body["memory_available"]) == (False, False)


async def test_items_list_filter_pin_delete(app, client, auth_headers, uid):
    enable_agents(app)
    a, b, _ = await seed(app, uid)
    body = (await client.get(f"{BASE}/items", headers=auth_headers)).json()
    assert [i["id"] for i in body["items"]] == [b.id, a.id] and body["next_cursor"] is None
    coach = body["items"][0]["persona"]
    assert coach["id"] == "builtin:coach" and coach["name"]
    assert body["items"][1]["persona"] is None
    assert body["persona_counts"] == [{"persona": None, "count": 1}, {"persona": coach, "count": 1}]
    r = await client.get(f"{BASE}/items", params={"kind": "goal"}, headers=auth_headers)
    assert [i["id"] for i in r.json()["items"]] == [a.id]
    r = await client.get(f"{BASE}/items", params={"persona_id": "shared"}, headers=auth_headers)
    assert [i["id"] for i in r.json()["items"]] == [a.id]
    assert (await client.get(f"{BASE}/items", params={"kind": "nope"}, headers=auth_headers)).status_code == 422
    r = await client.get(f"{BASE}/items", params={"cursor": "x"}, headers=auth_headers)
    assert (r.status_code, r.json()) == (400, {"error": "Invalid cursor"})
    r = await client.post(f"{BASE}/items/{a.id}/pin", json={"pinned": True}, headers=auth_headers)
    assert r.json()["pinned"] is True
    assert (await client.get(f"{BASE}/items", headers=auth_headers)).json()["items"][0]["id"] == a.id
    assert (await client.delete(f"{BASE}/items/{a.id}", headers=auth_headers)).json() == {"id": a.id}
    r = await client.delete(f"{BASE}/items/{a.id}", headers=auth_headers)
    assert (r.status_code, r.json()) == (404, {"error": "Memory not found"})
    assert await app.state.agent_memory.store.add(uid, kind="goal", text="准备雅思口语考试", importance=4,
                                                  persona_id=None, source="chat") is None


async def test_user_writes_invalidate_the_prompt_snapshot(app, client, auth_headers, uid):
    enable_agents(app)
    a, _, _ = await seed(app, uid)
    from tests.agents_memory_helpers import ctx
    assert "准备雅思口语考试" in (await app.state.agent_memory.source.load(ctx(uid))).block
    await client.delete(f"{BASE}/items/{a.id}", headers=auth_headers)
    assert "准备雅思口语考试" not in (await app.state.agent_memory.source.load(ctx(uid))).block


async def test_users_cannot_see_or_touch_each_others_memory(app, client, auth_headers, uid):
    enable_agents(app)
    a, _, r = await seed(app, uid)
    bob = await client.post("/api/users", json={"username": "bob", "password": "password123"})
    hb = {"Authorization": f"Bearer {bob.json()['access_token']}"}
    assert (await client.get(f"{BASE}/items", headers=hb)).json()["items"] == []
    assert (await client.delete(f"{BASE}/items/{a.id}", headers=hb)).status_code == 404
    assert (await client.post(f"{BASE}/items/{a.id}/pin", json={"pinned": True}, headers=hb)).status_code == 404
    assert (await client.delete(f"{BASE}/recaps/{r.id}", headers=hb)).status_code == 404
    assert (await client.get(f"{BASE}/export", headers=hb)).json()["items"] == []
    assert len((await client.get(f"{BASE}/items", headers=auth_headers)).json()["items"]) == 2


async def test_recaps_list_and_delete(app, client, auth_headers, uid):
    enable_agents(app)
    _, _, recap = await seed(app, uid)
    body = (await client.get(f"{BASE}/recaps", headers=auth_headers)).json()
    assert [(x["id"], x["source"]) for x in body["recaps"]] == [(recap.id, "tutor")] and body["next_cursor"] is None
    assert (await client.delete(f"{BASE}/recaps/{recap.id}", headers=auth_headers)).json() == {"id": recap.id}
    r = await client.delete(f"{BASE}/recaps/{recap.id}", headers=auth_headers)
    assert (r.status_code, r.json()) == (404, {"error": "Recap not found"})


async def test_export_is_an_uncached_attachment(app, client, auth_headers, uid):
    enable_agents(app)
    await seed(app, uid)
    r = await client.get(f"{BASE}/export", headers=auth_headers)
    assert r.headers["content-disposition"] == 'attachment; filename="agent-memory.json"'
    assert r.headers["cache-control"] == "no-store"
    assert (r.json()["version"], len(r.json()["items"]), len(r.json()["recaps"])) == (1, 2, 1)


async def test_clear_needs_confirmation_and_respects_the_scope(app, client, auth_headers, uid):
    enable_agents(app)
    await seed(app, uid)

    async def clear(body):
        return await client.request("DELETE", BASE, json=body, headers=auth_headers)

    r = await clear({"scope": "all"})
    assert (r.status_code, r.json()) == (400, {"error": "Confirmation required"})
    r = await clear({"confirm": True, "scope": "persona"})
    assert (r.status_code, r.json()) == (422, {"error": "persona_id is required"})
    r = await clear({"confirm": True, "scope": "persona", "persona_id": "builtin:coach"})
    assert r.json() == {"scope": "persona", "deleted": {"items": 1, "recaps": 1, "threads": 0, "profile": False}}
    r = await clear({"confirm": True, "scope": "all"})
    assert r.json() == {"scope": "all", "deleted": {"items": 1, "recaps": 0, "threads": 0, "profile": False}}


async def test_deleting_a_conversation_drops_its_thread_state_and_recaps_but_keeps_long_term_items(
        app, client, auth_headers, uid):
    conv = (await client.post("/api/conversations", json={}, headers=auth_headers)).json()["id"]
    store = app.state.agent_memory.store
    await store.touch_thread(uid, ThreadKey("conversation", conv), at=NOW, text="hi", count_turn=True,
                             idle=timedelta(minutes=30))
    await store.add_recap(uid, source="conversation", text="聊了天气", conversation_id=conv)
    keep = await store.add(uid, kind="fact", text="lives in Hangzhou", importance=3, persona_id=None, source="chat")
    assert (await client.delete(f"/api/conversations/{conv}", headers=auth_headers)).status_code == 200
    async with app.state.sessionmaker() as s:
        assert await s.scalar(select(func.count()).select_from(AgentThreadState)) == 0
        assert await s.scalar(select(func.count()).select_from(AgentRecap)) == 0
    assert [r.id for r in (await store.items(uid))[0]] == [keep.id]


async def test_memory_contract(app, client, auth_headers, uid):
    enable_agents(app)
    a, _, _ = await seed(app, uid)
    await client.patch(f"{BASE}/profile", json={"values": {"level": "B1", "goals": ["雅思 7 分"]}},
                       headers=auth_headers)
    await app.state.agent_memory.store.propose(uid, "level", "B2")
    sample = {
        "profile": (await client.get(f"{BASE}/profile", headers=auth_headers)).json(),
        "items": (await client.get(f"{BASE}/items", headers=auth_headers)).json(),
        "pin": (await client.post(f"{BASE}/items/{a.id}/pin", json={"pinned": True}, headers=auth_headers)).json(),
        "recaps": (await client.get(f"{BASE}/recaps", headers=auth_headers)).json(),
        "export": (await client.get(f"{BASE}/export", headers=auth_headers)).json(),
        "clear": (await client.request("DELETE", BASE, json={"confirm": True, "scope": "all"},
                                       headers=auth_headers)).json(),
    }
    check_contract("agents_memory_contract", sample)


async def test_no_memory_or_user_text_in_logs(app, client, auth_headers, uid, caplog):
    caplog.set_level(logging.DEBUG, logger="app")  # not the root: driver DEBUG lines carry SQL parameters
    enable_agents(app)
    secret = "MAGENTA-PINEAPPLE-42"
    row = await app.state.agent_memory.store.add(uid, kind="fact", text=f"likes {secret}", importance=3,
                                                 persona_id=None, source="chat")
    await client.patch(f"{BASE}/profile", json={"values": {"schedule": f"evenings {secret}"}}, headers=auth_headers)
    await client.patch(f"{BASE}/profile", json={"values": {"native": secret * 3}}, headers=auth_headers)
    for path in ("/profile", "/items", "/recaps", "/export"):
        await client.get(BASE + path, headers=auth_headers)
    await client.post(f"{BASE}/items/{row.id}/pin", json={"pinned": True}, headers=auth_headers)
    await client.delete(f"{BASE}/items/{row.id}", headers=auth_headers)
    await client.request("DELETE", BASE, json={"confirm": True, "scope": "all"}, headers=auth_headers)
    assert secret not in caplog.text and str(uid) not in caplog.text
