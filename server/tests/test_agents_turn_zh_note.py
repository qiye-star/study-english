"""Per-conversation zh_note override on POST /api/agents/turn (plan 2026-10-23 R7, §1 item 22)."""
import json

from tests.agents_helpers import FakeLLM, enable_agents, parse_sse, turn_body, use_fake_llm

NOTE_MARK = "<<ZH>>"  # only the "write a Chinese note" rule mentions it (app/agents/lang.py)


async def make(client, headers, config=None) -> str:
    r = await client.post("/api/conversations", headers=headers, json={"name": "c", "config": config or {}})
    assert r.status_code == 200, r.text
    return r.json()["id"]


async def set_user_note(client, headers, value):
    assert (await client.patch("/api/agents/settings", headers=headers, json={"zh_note": value})).status_code == 200


async def turn_prompt(app, client, headers, cid, fake) -> str:
    before = len(fake.requests)
    r = await client.post("/api/agents/turn", headers=headers, json=turn_body(cid))
    assert [e for e, _ in parse_sse(r.text)][-1] == "done", r.text
    assert len(fake.requests) == before + 1
    return json.dumps(fake.requests[-1]["messages"], ensure_ascii=False)


async def test_conversation_zh_note_always_overrides_a_user_never(app, client, auth_headers):
    fake = await use_fake_llm(app, FakeLLM(["Hi"]))
    enable_agents(app)
    await set_user_note(client, auth_headers, "never")
    plain = await make(client, auth_headers)
    always = await make(client, auth_headers, {"zh_note": "always"})
    assert NOTE_MARK not in await turn_prompt(app, client, auth_headers, plain, fake)
    assert NOTE_MARK in await turn_prompt(app, client, auth_headers, always, fake)


async def test_conversation_never_overrides_user_always_and_values_follow_the_settings_vocabulary(app, client, auth_headers):
    fake = await use_fake_llm(app, FakeLLM(["Hi"]))
    enable_agents(app)
    await set_user_note(client, auth_headers, "always")
    never = await make(client, auth_headers, {"zh_note": "never"})
    assert NOTE_MARK not in await turn_prompt(app, client, auth_headers, never, fake)
    auto = await make(client, auth_headers, {"zh_note": "auto"})  # auto = the persona level decides
    await turn_prompt(app, client, auth_headers, auto, fake)


async def test_missing_or_invalid_key_keeps_the_user_setting(app, client, auth_headers):
    fake = await use_fake_llm(app, FakeLLM(["Hi"]))
    enable_agents(app)
    await set_user_note(client, auth_headers, "always")
    for config in ({}, {"zh_note": "loud"}, {"zh_note": 1}, {"zh_note": None}, {"zh_note": ["always"]}):
        cid = await make(client, auth_headers, config)
        assert NOTE_MARK in await turn_prompt(app, client, auth_headers, cid, fake), config
    await set_user_note(client, auth_headers, "never")
    cid = await make(client, auth_headers, {"zh_note": "loud"})
    assert NOTE_MARK not in await turn_prompt(app, client, auth_headers, cid, fake)


async def test_camel_case_zhNote_is_ignored(app, client, auth_headers):
    fake = await use_fake_llm(app, FakeLLM(["Hi"]))
    enable_agents(app)
    await set_user_note(client, auth_headers, "never")
    cid = await make(client, auth_headers, {"zhNote": "always"})
    assert NOTE_MARK not in await turn_prompt(app, client, auth_headers, cid, fake)


async def test_a_snake_case_patch_from_the_web_takes_effect_and_only_that_conversation(app, client, auth_headers):
    fake = await use_fake_llm(app, FakeLLM(["Hi"]))
    enable_agents(app)
    await set_user_note(client, auth_headers, "never")
    one, two = await make(client, auth_headers), await make(client, auth_headers)
    r = await client.patch(f"/api/conversations/{one}", headers=auth_headers,
                           json={"config": {"agent_persona_id": "builtin:partner", "zh_note": "always", "bilingual": True}})
    assert r.status_code == 200
    assert NOTE_MARK in await turn_prompt(app, client, auth_headers, one, fake)
    assert NOTE_MARK not in await turn_prompt(app, client, auth_headers, two, fake)
    stored = (await client.get(f"/api/agents/settings", headers=auth_headers)).json()
    assert stored["zh_note"] == "never"  # the user-level setting itself is untouched
