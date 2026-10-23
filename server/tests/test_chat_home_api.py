"""/api/chat-home routes (plan 2026-10-23 §5, S9). Fake upstream; no real vendor is called."""
import json
import uuid

import pytest

from tests.agents_helpers import FakeLLM, use_fake_llm
from tests.test_chat_home_service import answer

BASE = "/api/chat-home"


@pytest.fixture
def settings_overrides(request):
    return {"chat_home_enabled": True, **getattr(request, "param", {})}


def today_body(offset=0):
    return {"tz_offset_minutes": offset, "client_request_id": str(uuid.uuid4())}


async def post_today(client, headers, offset=0):
    return await client.post(f"{BASE}/today", headers=headers, json=today_body(offset))


@pytest.mark.parametrize("method,path", [
    ("GET", "/config"), ("GET", "/settings"), ("PATCH", "/settings"), ("POST", "/today"), ("POST", "/greetings/x/seen"),
])
async def test_requires_login(client, method, path):
    r = await client.request(method, BASE + path, json={})
    assert r.status_code == 401


@pytest.mark.parametrize("settings_overrides", [{"chat_home_enabled": False}], indirect=True)
async def test_switch_off_is_404_except_config(client, auth_headers):
    assert (await client.get(f"{BASE}/config", headers=auth_headers)).json() == {"enabled": False, "llm": True}
    for method, path, body in (("GET", "/settings", None), ("PATCH", "/settings", {"language": "en"}),
                               ("POST", "/today", today_body()), ("POST", "/greetings/x/seen", None)):
        r = await client.request(method, BASE + path, headers=auth_headers, json=body)
        assert (r.status_code, r.json()) == (404, {"error": "Chat home is disabled"}), path


async def test_config_reports_enabled_and_llm(app, client, auth_headers):
    assert (await client.get(f"{BASE}/config", headers=auth_headers)).json() == {"enabled": True, "llm": True}
    app.state.settings = app.state.settings.model_copy(update={"chat_greeting_llm_enabled": False})
    assert (await client.get(f"{BASE}/config", headers=auth_headers)).json() == {"enabled": True, "llm": False}


async def test_settings_defaults_patch_round_trip_and_422_bodies(client, auth_headers):
    assert (await client.get(f"{BASE}/settings", headers=auth_headers)).json() == {
        "greeting_trigger": "daily", "language": "bilingual", "daily_persona_id": "builtin:partner",
        "include_stats": True}
    r = await client.patch(f"{BASE}/settings", headers=auth_headers, json={"include_stats": False, "language": "zh"})
    assert r.status_code == 200 and r.json()["include_stats"] is False and r.json()["language"] == "zh"
    assert (await client.get(f"{BASE}/settings", headers=auth_headers)).json()["include_stats"] is False
    r = await client.patch(f"{BASE}/settings", headers=auth_headers, json={"include_stats": "no"})
    assert (r.status_code, r.json()) == (422, {"error": "invalid", "field": "include_stats"})
    r = await client.patch(f"{BASE}/settings", headers=auth_headers, json={"language": "fr"})
    assert r.json() == {"error": "invalid", "field": "language"}
    r = await client.patch(f"{BASE}/settings", headers=auth_headers, json={"nope": 1})
    assert r.json() == {"error": "invalid", "field": "unknown"}
    r = await client.patch(f"{BASE}/settings", headers=auth_headers, json={"language": "en", "greeting_trigger": "bad"})
    assert r.json()["field"] == "greeting_trigger"
    assert (await client.get(f"{BASE}/settings", headers=auth_headers)).json()["language"] == "zh"  # nothing half-saved
    assert (await client.patch(f"{BASE}/settings", headers=auth_headers, json=["x"])).status_code == 422


@pytest.mark.parametrize("body", [
    {"tz_offset_minutes": 841, "client_request_id": str(uuid.uuid4())},
    {"tz_offset_minutes": -721, "client_request_id": str(uuid.uuid4())},
    {"tz_offset_minutes": 0, "client_request_id": "not-a-uuid"},
    {"tz_offset_minutes": 0},
    {"client_request_id": str(uuid.uuid4())},
    {"tz_offset_minutes": 0, "client_request_id": str(uuid.uuid4()), "extra": 1},
])
async def test_today_validates_the_body(client, auth_headers, body):
    assert (await client.post(f"{BASE}/today", headers=auth_headers, json=body)).status_code == 422


async def test_today_edges_of_the_offset_range_are_accepted(app, client, auth_headers):
    await use_fake_llm(app, FakeLLM(texts=(answer(),)))
    for offset in (-720, 840):
        assert (await post_today(client, auth_headers, offset)).status_code == 200


async def test_today_response_shape_and_the_full_greeting_flow(app, client, auth_headers):
    fake = await use_fake_llm(app, FakeLLM(texts=(answer(),)))
    r = await post_today(client, auth_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"local_date", "status", "conversation", "greeting"} and body["status"] == "ready"
    conv, greeting = body["conversation"], body["greeting"]
    assert conv["daily_date"] == body["local_date"] and set(conv) == {"id", "name", "config", "daily_date", "created_at",
                                                                       "updated_at"}
    assert set(greeting) == {"id", "message_ids", "source", "language", "generated_at", "lines", "facts", "first_view"}
    assert len(greeting["lines"]) == len(greeting["message_ids"]) == 3 and greeting["first_view"] is True
    assert all(set(line) == {"en", "zh"} for line in greeting["lines"]) and greeting["facts"] == {}
    msgs = (await client.get(f"/api/conversations/{conv['id']}/messages", headers=auth_headers)).json()["messages"]
    assert [m["id"] for m in msgs] == greeting["message_ids"]
    seen = await client.post(f"{BASE}/greetings/{greeting['id']}/seen", headers=auth_headers)
    again = await client.post(f"{BASE}/greetings/{greeting['id']}/seen", headers=auth_headers)
    assert seen.status_code == 200 and seen.json() == again.json() and seen.json()["first_seen_at"]
    second = (await post_today(client, auth_headers)).json()
    assert second["greeting"]["first_view"] is False and second["conversation"]["id"] == conv["id"]
    assert second["greeting"]["lines"] == greeting["lines"] and len(fake.requests) == 1
    # delete today's default, ask again: same lines in a new conversation, no model call, no new pop-up
    assert (await client.delete(f"/api/conversations/{conv['id']}", headers=auth_headers)).status_code == 200
    rebuilt = (await post_today(client, auth_headers)).json()
    assert rebuilt["conversation"]["id"] != conv["id"] and rebuilt["greeting"]["lines"] == greeting["lines"]
    assert rebuilt["greeting"]["first_view"] is False and len(fake.requests) == 1
    msgs = (await client.get(f"/api/conversations/{rebuilt['conversation']['id']}/messages", headers=auth_headers)).json()["messages"]
    assert [m["id"] for m in msgs] == rebuilt["greeting"]["message_ids"] != greeting["message_ids"]


async def test_off_returns_no_greeting_and_an_empty_default(app, client, auth_headers):
    fake = await use_fake_llm(app, FakeLLM(texts=(answer(),)))
    await client.patch(f"{BASE}/settings", headers=auth_headers, json={"greeting_trigger": "off"})
    body = (await post_today(client, auth_headers)).json()
    assert body["status"] == "off" and body["greeting"] is None and body["conversation"]["daily_date"]
    assert (await client.get(f"/api/conversations/{body['conversation']['id']}/messages",
                             headers=auth_headers)).json()["messages"] == []
    assert len(fake.requests) == 0


async def test_seen_is_404_for_other_users_and_unknown_ids(app, client, auth_headers):
    await use_fake_llm(app, FakeLLM(texts=(answer(),)))
    gid = (await post_today(client, auth_headers)).json()["greeting"]["id"]
    r = await client.post("/api/users", json={"username": "bob", "password": "password123"})
    bob = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert (await client.post(f"{BASE}/greetings/{gid}/seen", headers=bob)).status_code == 404
    assert (await client.post(f"{BASE}/greetings/{uuid.uuid4()}/seen", headers=auth_headers)).status_code == 404


async def test_include_stats_toggle_hides_facts_on_the_next_read(app, client, auth_headers):
    from app.models import VocabularyItem
    from datetime import datetime, timedelta, timezone
    await use_fake_llm(app, FakeLLM(texts=(answer(),)))
    uid = int((await client.get("/api/me", headers=auth_headers)).json()["id"])
    async with app.state.sessionmaker() as s:
        s.add(VocabularyItem(user_id=uid, word="w", source="x", box=0, due_at=datetime.now(timezone.utc) - timedelta(days=1)))
        await s.commit()
    first = (await post_today(client, auth_headers)).json()["greeting"]
    assert first["facts"] == {"due": 1}
    await client.patch(f"{BASE}/settings", headers=auth_headers, json={"include_stats": False})
    later = (await post_today(client, auth_headers)).json()["greeting"]
    assert later["facts"] == {} and later["lines"] == first["lines"]
    assert json.dumps(first).count("\"w\"") == 0
