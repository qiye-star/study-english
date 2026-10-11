"""Tutor REST (spec §4.5, §7; plan A3 S7): switches, start (idempotent, daily cap, ownership, validation), active, hint,
skip, finish, expiry, log hygiene."""
from datetime import timedelta

import pytest
from sqlalchemy import select, update

from app.agents import limits
from app.agents.tutor import machine
from app.models import AgentTutorSession, DailyUsage, utcnow
from tests.agents_tutor_helpers import conversation, enable_agents, install_sources, login, set_state, start_body

BASE = "/api/agents/tutor"


async def _start(client, headers, cid, **kw):
    return await client.post(f"{BASE}/start", json=start_body(cid, **kw), headers=headers)


async def _plan(app, sid):
    async with app.state.sessionmaker() as s:
        return machine.from_dict((await s.get(AgentTutorSession, sid)).state).plan


async def test_tutor_is_404_while_agents_or_tutor_are_off(app, client):
    h = await login(client)
    cid = await conversation(client, h)
    assert (await _start(client, h, cid)).status_code == 404
    enable_agents(app, agents_tutor_enabled=False)
    r = await _start(client, h, cid)
    assert r.status_code == 404 and r.json()["error"] == "Tutor is disabled"
    assert (await client.get(f"{BASE}/active", params={"conversation_id": cid}, headers=h)).status_code == 404


async def test_start_creates_an_opening_session(app, client):
    enable_agents(app)
    h = await login(client)
    cid = await conversation(client, h)
    r = await _start(client, h, cid, length=5, topic="scenario", scenario="travel")
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["status"], body["phase"], body["step_index"], body["steps_total"], body["resumed"]) == (
        "active", "opening", 1, 5, False)
    assert body["goal"]["topic"] == "scenario" and body["goal"]["scenario"] == "travel"
    assert body["recap"] is None and body["answers"] == [] and body["hints_max"] == 2 and body["say"] is None
    active = (await client.get(f"{BASE}/active", params={"conversation_id": cid}, headers=h)).json()
    assert active["session"]["id"] == body["id"]
    assert {p.focus for p in await _plan(app, body["id"])} == {"travel"}


async def test_start_is_idempotent_and_one_active_session_per_conversation(app, client):
    enable_agents(app, agents_tutor_daily_per_user=5)
    h = await login(client)
    cid = await conversation(client, h)
    first = start_body(cid)
    a = (await client.post(f"{BASE}/start", json=first, headers=h)).json()
    b = (await client.post(f"{BASE}/start", json=first, headers=h)).json()
    c = (await _start(client, h, cid)).json()
    assert a["id"] == b["id"] == c["id"] and b["resumed"] and c["resumed"]
    async with app.state.sessionmaker() as s:
        used = await s.scalar(select(DailyUsage.count).where(DailyUsage.scope == limits.SCOPE_TUTOR_USER))
    assert used == 1


async def test_reusing_a_start_id_in_another_conversation_is_409(app, client):
    enable_agents(app, agents_tutor_daily_per_user=5)
    h = await login(client)
    c1, c2 = await conversation(client, h), await conversation(client, h)
    body = start_body(c1)
    assert (await client.post(f"{BASE}/start", json=body, headers=h)).status_code == 200
    r = await client.post(f"{BASE}/start", json={**body, "conversation_id": c2}, headers=h)
    assert r.status_code == 409 and r.json()["error"] == "Tutor session id reused"


async def test_daily_limit_counts_starts(app, client):
    enable_agents(app, agents_tutor_daily_per_user=1)
    h = await login(client)
    c1, c2 = await conversation(client, h), await conversation(client, h)
    assert (await _start(client, h, c1)).status_code == 200
    r = await _start(client, h, c2)
    assert r.status_code == 429 and r.json()["error"] == "Daily tutor limit reached"


async def test_sessions_belong_to_their_owner(app, client):
    enable_agents(app)
    alice, bob = await login(client, "alice"), await login(client, "bob")
    cid = await conversation(client, alice)
    sid = (await _start(client, alice, cid)).json()["id"]
    assert (await _start(client, bob, cid)).status_code == 404
    for method, path in (("GET", f"{BASE}/{sid}"), ("POST", f"{BASE}/{sid}/skip"), ("POST", f"{BASE}/{sid}/hint"),
                         ("POST", f"{BASE}/{sid}/finish")):
        assert (await client.request(method, path, headers=bob)).status_code == 404, path
    assert (await client.get(f"{BASE}/active", params={"conversation_id": cid}, headers=bob)).json() == {"session": None}


@pytest.mark.parametrize("change", [{"length": 2}, {"length": 13}, {"topic": "anything"}, {"input": "telepathy"},
                                    {"scenario": "moon"}, {"extra": 1}, {"client_start_id": "short"}])
async def test_start_validation(app, client, change):
    enable_agents(app)
    h = await login(client)
    cid = await conversation(client, h)
    assert (await client.post(f"{BASE}/start", json={**start_body(cid), **change}, headers=h)).status_code == 422


async def test_unknown_persona_is_404(app, client):
    enable_agents(app)
    h = await login(client)
    cid = await conversation(client, h)
    assert (await _start(client, h, cid, persona_id="builtin:nobody")).status_code == 404


async def test_hint_skip_and_finish(app, client):
    enable_agents(app)
    h = await login(client)
    cid = await conversation(client, h)
    sid = (await _start(client, h, cid, length=3)).json()["id"]
    r = await client.post(f"{BASE}/{sid}/skip", headers=h)
    assert r.status_code == 409 and r.json()["error"] == "Tutor session is not waiting for an answer"
    await set_state(app, sid, phase="await_answer", hint_text="想想你昨天做了什么")
    first = (await client.post(f"{BASE}/{sid}/hint", headers=h)).json()
    assert first["hint"] == "想想你昨天做了什么"
    assert (first["session"]["hints_used"], first["session"]["step_index"]) == (1, 1)
    second = (await client.post(f"{BASE}/{sid}/hint", headers=h)).json()
    assert second["hint"] and second["hint"] != first["hint"] and second["session"]["hints_used"] == 2
    third = await client.post(f"{BASE}/{sid}/hint", headers=h)
    assert third.status_code == 409 and third.json()["error"] == "Hint limit reached"
    skipped = (await client.post(f"{BASE}/{sid}/skip", headers=h)).json()
    assert (skipped["phase"], skipped["step_index"], skipped["hints_used"]) == ("ask", 2, 0)
    assert [a["verdict"] for a in skipped["answers"]] == ["skip"]
    done = (await client.post(f"{BASE}/{sid}/finish", headers=h)).json()
    assert (done["status"], done["phase"]) == ("done", "done")
    assert (done["recap"]["skipped"], done["recap"]["total"]) == (1, 3)
    again = (await client.post(f"{BASE}/{sid}/finish", headers=h)).json()
    assert again["recap"] == done["recap"]
    r = await client.post(f"{BASE}/{sid}/skip", headers=h)
    assert r.status_code == 409 and r.json()["error"] == "Tutor session finished"
    assert (await client.get(f"{BASE}/active", params={"conversation_id": cid}, headers=h)).json() == {"session": None}


async def test_skipping_the_last_question_waits_for_finish(app, client):
    enable_agents(app)
    h = await login(client)
    cid = await conversation(client, h)
    sid = (await _start(client, h, cid, length=3)).json()["id"]
    await set_state(app, sid, phase="await_answer", index=2)
    body = (await client.post(f"{BASE}/{sid}/skip", headers=h)).json()
    assert (body["phase"], body["step_index"], body["kind"]) == ("wrap_up", 3, None)


async def test_idle_session_expires_and_a_new_start_replaces_it(app, client):
    enable_agents(app, agents_tutor_daily_per_user=5)
    h = await login(client)
    cid = await conversation(client, h)
    sid = (await _start(client, h, cid)).json()["id"]
    async with app.state.sessionmaker() as s:
        await s.execute(update(AgentTutorSession).values(updated_at=utcnow() - timedelta(minutes=31)))
        await s.commit()
    assert (await client.get(f"{BASE}/{sid}", headers=h)).json()["status"] == "expired"
    assert (await client.get(f"{BASE}/active", params={"conversation_id": cid}, headers=h)).json() == {"session": None}
    fresh = (await _start(client, h, cid)).json()
    assert fresh["id"] != sid and not fresh["resumed"]
    r = await client.post(f"{BASE}/{sid}/skip", headers=h)
    assert r.status_code == 409 and r.json()["error"] == "Tutor session expired"
    assert (await client.post(f"{BASE}/{sid}/finish", headers=h)).json()["status"] == "done"


async def test_plan_uses_due_and_weak_words_from_context_sources(app, client):
    enable_agents(app)
    install_sources(app, due_words=["apple", "banana"], weak_words=["cherry"])
    h = await login(client)
    cid = await conversation(client, h)
    sid = (await _start(client, h, cid, topic="today_words", length=5)).json()["id"]
    plan = await _plan(app, sid)
    assert plan[0].kind == "words" and plan[0].words == ("apple", "banana") and plan[1].words == ("cherry",)


async def test_tools_turned_off_keep_their_words_out(app, client):
    enable_agents(app)
    install_sources(app, due_words=["apple", "banana"], weak_words=["cherry"])
    h = await login(client)
    r = await client.patch("/api/agents/settings", json={"tools": {"due_words": False, "weak_words": False}}, headers=h)
    assert r.status_code == 200, r.text
    cid = await conversation(client, h)
    sid = (await _start(client, h, cid, topic="today_words", length=5)).json()["id"]
    assert all(p.words == () for p in await _plan(app, sid))


async def test_logs_never_carry_words_or_hints(app, client, caplog):
    enable_agents(app)
    install_sources(app, due_words=["zephyrine"], weak_words=["quixotic"])
    h = await login(client)
    cid = await conversation(client, h)
    with caplog.at_level("DEBUG", logger="app"):
        sid = (await _start(client, h, cid, topic="today_words", length=8)).json()["id"]
        await set_state(app, sid, phase="await_answer", hint_text="HINT_PRIVATE")
        hint = (await client.post(f"{BASE}/{sid}/hint", headers=h)).json()
        await client.post(f"{BASE}/{sid}/skip", headers=h)
        await client.post(f"{BASE}/{sid}/finish", headers=h)
    assert hint["hint"] == "HINT_PRIVATE"
    for private in ("zephyrine", "quixotic", "HINT_PRIVATE"):
        assert private not in caplog.text
    assert "tutor start topic=today_words length=8" in caplog.text
    assert "tutor finish answered=0 total=8" in caplog.text
