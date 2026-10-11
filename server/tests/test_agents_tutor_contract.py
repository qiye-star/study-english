"""Shape samples of the tutor REST + the meta event (R-T14): fixtures/agents_tutor_contract.json, read by the web
tutor-contract test. After an intentional shape change re-record with CONTRACT_UPDATE=1. uuids / times are fixed by
`agents_helpers.stable`, so re-recording is noise-free. Null SSE keys are omitted on the wire (A1 Event.to_dict)."""

from tests.background import drain_background
from tests.agents_helpers import check_contract
from tests.agents_tutor_helpers import conversation, enable_agents, fake_stream, install_sources, login, start_body, turn
from tests.test_agents_tutor_turn import OPENING, reply


async def test_tutor_contract(app, client, monkeypatch):
    enable_agents(app)
    install_sources(app, due_words=["apple", "banana", "cherry"])
    h = await login(client)
    cid = await conversation(client, h)
    start = (await client.post("/api/agents/tutor/start", json=start_body(cid, topic="today_words", length=3),
                               headers=h)).json()
    sid = start["id"]
    fake_stream(monkeypatch, OPENING, reply("good"))
    opening = await turn(client, h, cid, sid, None)
    await drain_background(app)
    active = (await client.get("/api/agents/tutor/active", params={"conversation_id": cid}, headers=h)).json()
    answer = await turn(client, h, cid, sid, "I like apples and bananas.")
    await drain_background(app)
    hint = (await client.post(f"/api/agents/tutor/{sid}/hint", headers=h)).json()
    skip = (await client.post(f"/api/agents/tutor/{sid}/skip", headers=h)).json()
    got = (await client.get(f"/api/agents/tutor/{sid}", headers=h)).json()
    finish = (await client.post(f"/api/agents/tutor/{sid}/finish", headers=h)).json()
    sample = {"start": start, "active": active, "get": got, "hint": hint, "skip": skip, "finish": finish,
              "meta_opening": next(d for k, d in opening if k == "meta"),
              "meta_answer": next(d for k, d in answer if k == "meta")}
    assert finish["recap"]["words"] and skip["phase"] == "ask"
    check_contract("agents_tutor_contract", sample)
