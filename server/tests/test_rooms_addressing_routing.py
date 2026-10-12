"""AgentLane.route: `@ai` = default agent, `@name`, the reply rule and `say.to` (plan addressing-server R2; spec
addressing §3, §4; rulings R-AS2..R-AS5, R-AS21..R-AS24)."""
import asyncio
import json
import logging
from dataclasses import replace

import pytest

from app.rooms.agent_lane import DEFAULT_PERSONA_ID
from tests.test_rooms_agents_lane import A, EMMA, LEO, env, say, types  # noqa: F401 (fixture)


def send(text: str, client_id: str = "q", **extra) -> str:
    return json.dumps({"type": "say", "client_id": client_id, "text": text, **extra})


def answers(conn) -> list[dict]:
    return [e["message"] for e in conn.sender.sent if e["type"] == "message" and e["message"]["kind"] == "ai_answer"]


def called(env) -> list[str]:
    return [req.persona.id for _, req in env.script.calls]


async def ask_emma(env) -> int:
    """One finished Emma answer in the room (bob asked); returns the answer's seq."""
    await env.cb.handle(say("@Emma first question", "seed"))
    await env.hub.drain()
    return answers(env.alice)[-1]["seq"]


@pytest.mark.parametrize("alias", ["@ai", "@AI", "@助手", "@ai:", "@助手,"])
async def test_the_alias_goes_to_the_first_configured_agent(env, alias):
    await env.cb.handle(send(f"{alias} what is a latte?"))
    await env.hub.drain()
    assert called(env) == [EMMA.id]
    assert answers(env.alice)[0]["meta"]["agent"] == {"persona_id": EMMA.id, "name": "Emma"}
    assert env.script.calls[0][1].text == "bob: what is a latte?"


async def test_the_default_is_the_first_agent_of_the_room_not_the_most_popular(env):
    await env.store.set_agents(env.room.id, A, [LEO.id, EMMA.id])
    await env.cb.handle(send("@ai is this fine?"))
    await env.hub.drain()
    assert called(env) == [LEO.id]


async def test_without_agents_or_with_only_deleted_ones_the_alias_uses_the_builtin_coach(env):
    await env.store.set_agents(env.room.id, A, [])
    await env.cb.handle(send("@ai hi"))
    await env.hub.drain()
    assert called(env) == [DEFAULT_PERSONA_ID]
    deps, _ = env.script.calls[0]
    assert deps["allow_private"] is True and deps["modes"]["chat"].others == []  # nobody to hand over to
    await env.store.set_agents(env.room.id, A, [LEO.id])
    del env.lookup.by_id[LEO.id]  # the only configured persona was deleted
    await env.cb.handle(send("@ai again", "q2"))
    await env.hub.drain()
    assert called(env) == [DEFAULT_PERSONA_ID, DEFAULT_PERSONA_ID]


async def test_a_disabled_first_agent_means_agent_off_not_the_second(env):
    env.lookup.by_id[EMMA.id] = replace(EMMA, disabled=True)
    await env.cb.handle(send("@ai hi"))
    assert types(env.bob)[-3:] == ["notice", "ack", "message"]
    assert env.bob.sender.sent[-3] == {"type": "notice", "code": "agent_off"}
    await env.hub.drain()
    assert env.script.calls == []


async def test_agents_off_gives_agent_off_for_every_explicit_way_and_keeps_the_message(env):
    env.feature = False
    await env.cb.handle(send("@ai hi", "q0"))
    await env.cb.handle(send("@Emma hi", "q1"))
    await env.cb.handle(send("hello", "q2", to=EMMA.id))
    notices = [e for e in env.bob.sender.sent if e["type"] == "notice"]
    assert notices == [{"type": "notice", "code": "agent_off"}] * 3
    assert types(env.bob).count("message") == 3 and env.script.calls == [] and env.hub.ai_pending(env.room.id) == 0


async def test_priority_alias_then_name_then_reply_then_to(env):
    seq = await ask_emma(env)  # replying to it would go to Emma
    await env.ca.handle(send("@Leo and you?", "p1", reply_to=seq, to=EMMA.id))  # a name beats reply and to
    await env.hub.drain()
    await env.ca.handle(send("@ai and you?", "p2", reply_to=seq, to=LEO.id))  # the alias beats everything (Emma is first)
    await env.hub.drain()
    await env.ca.handle(send("plain follow-up", "p3", reply_to=seq, to=LEO.id))  # the reply beats `to`
    await env.hub.drain()
    await env.ca.handle(send("only to", "p4", to=LEO.id))
    await env.hub.drain()
    assert called(env) == [EMMA.id, LEO.id, EMMA.id, EMMA.id, LEO.id]  # one turn per message, never two


async def test_replying_to_an_agent_message_needs_no_mention(env):
    seq = await ask_emma(env)
    await env.ca.handle(send("and the past tense?", "r1", reply_to=seq))
    await env.hub.drain()
    assert called(env) == [EMMA.id, EMMA.id]
    assert env.script.calls[1][1].text == "alice: and the past tense?"
    sent = next(e["message"] for e in env.bob.sender.sent if e["type"] == "message" and e["message"]["text"] == "and the past tense?")
    assert set(sent["meta"]) == {"quote"} and sent["ai_status"] == "pending"  # a reply leaves no to_agent trace


async def test_in_a_room_without_agents_a_reply_to_the_default_coach_continues_the_chat(env):
    await env.store.set_agents(env.room.id, A, [])
    await env.cb.handle(send("@ai hi", "k1"))
    await env.hub.drain()
    seq = answers(env.alice)[-1]["seq"]
    await env.ca.handle(send("and then?", "k2", reply_to=seq))
    await env.hub.drain()
    assert called(env) == [DEFAULT_PERSONA_ID, DEFAULT_PERSONA_ID]
    await env.ca.handle(send("hello", "k3", to=DEFAULT_PERSONA_ID))  # `to` still needs a configured agent
    assert env.alice.sender.sent[-3] == {"type": "notice", "code": "agent_off"}


async def test_replies_to_other_messages_or_to_agents_that_left_are_plain(env):
    await env.ca.handle(send("human text", "h1"))
    human = env.bob.sender.sent[-1]["message"]["seq"]
    await env.cb.handle(send("replying to alice", "h2", reply_to=human))
    assert types(env.bob)[-2:] == ["ack", "message"]
    seq = await ask_emma(env)
    await env.store.set_agents(env.room.id, A, [LEO.id])  # Emma is no longer one of the room's agents
    await env.cb.handle(send("still talking to Emma?", "h3", reply_to=seq))
    await env.hub.drain()
    assert called(env) == [EMMA.id] and types(env.bob)[-2:] == ["ack", "message"]  # no turn, no notice


async def test_a_refused_reply_is_silent_for_off_and_disabled_but_not_for_the_room_gates(env):
    seq = await ask_emma(env)
    env.lookup.by_id[EMMA.id] = replace(EMMA, disabled=True)
    await env.cb.handle(send("reply 1", "r1", reply_to=seq))
    assert types(env.bob)[-2:] == ["ack", "message"]
    env.lookup.by_id[EMMA.id] = EMMA
    env.feature = False
    await env.cb.handle(send("reply 2", "r2", reply_to=seq))
    assert types(env.bob)[-2:] == ["ack", "message"]
    env.feature = True
    await env.store.set_ai_muted(env.room.id, True)
    await env.cb.handle(send("reply 3", "r3", reply_to=seq))
    assert env.bob.sender.sent[-3] == {"type": "notice", "code": "ai_off"}  # R-AS22
    await env.store.set_ai_muted(env.room.id, False)
    env.quota["room_ai_global"] = 0
    await env.cb.handle(send("reply 4", "r4", reply_to=seq))
    assert env.bob.sender.sent[-3] == {"type": "notice", "code": "ai_quota"}
    assert called(env) == [EMMA.id]


async def test_say_to_must_name_an_agent_of_the_room(env):
    await env.cb.handle(send("hello Leo", "t1", to=LEO.id))
    await env.hub.drain()
    assert called(env) == [LEO.id]
    sent = next(e["message"] for e in env.alice.sender.sent if e["type"] == "message")
    assert sent["meta"] == {"to_agent": LEO.id} and sent["ai_status"] == "pending"  # R-AS19
    await env.cb.handle(send("hello stranger", "t2", to="builtin:partner"))  # not in this room's config
    assert env.bob.sender.sent[-3] == {"type": "notice", "code": "agent_off"} and types(env.bob)[-2:] == ["ack", "message"]
    await env.cb.handle(send("blank to", "t3", to=""))  # an empty target is no target
    assert types(env.bob)[-3:] == ["message", "ack", "message"]
    env.lookup.by_id[LEO.id] = replace(LEO, disabled=True)
    await env.cb.handle(send("hi again", "t4", to=LEO.id))
    assert env.bob.sender.sent[-3] == {"type": "notice", "code": "agent_off"}
    await env.hub.drain()
    assert called(env) == [LEO.id]


async def test_an_at_that_names_nobody_falls_through_to_the_implicit_rules(env):
    await env.cb.handle(send("@alice look at this", "u1"))
    assert types(env.bob)[-2:] == ["ack", "message"] and env.script.calls == []
    await env.cb.handle(send("@alice look at this too", "u2", to=EMMA.id))
    await env.hub.drain()
    assert called(env) == [EMMA.id]  # R-AS21: the "对象" switch still applies


async def test_a_running_tutor_closes_implicit_routing_but_not_explicit_mentions(env):
    seq = await ask_emma(env)
    await env.store.set_tutor(env.room.id, {"phase": "await_answer", "persona_id": EMMA.id})
    await env.cb.handle(send("tutor chat 1", "w1", to=EMMA.id))
    await env.cb.handle(send("tutor chat 2", "w2", reply_to=seq))
    assert types(env.bob)[-3:] == ["message", "ack", "message"]  # published, no turn, no notice (R-AS3)
    await env.cb.handle(send("@Emma explicit", "w3"))
    await env.hub.drain()
    assert called(env) == [EMMA.id, EMMA.id]  # the seed and the explicit mention


async def test_a_refused_turn_still_publishes_the_message(env):
    for _ in range(env.store.limits.ai_queue):
        env.hub.ai_enter(env.room.id)
    await env.cb.handle(send("via to", "b1", to=EMMA.id))
    assert env.bob.sender.sent[-3] == {"type": "notice", "code": "ai_busy"}
    shown = env.alice.sender.sent[-1]["message"]
    assert shown["text"] == "via to" and shown["ai_status"] is None  # the answer is withheld, not the message
    for _ in range(env.store.limits.ai_queue):
        env.hub.ai_leave(env.room.id)
    env.quota["room_ai_global"] = 0
    await env.cb.handle(send("@ai again", "b2"))
    assert env.bob.sender.sent[-3] == {"type": "notice", "code": "ai_quota"}
    assert env.script.calls == [] and env.hub.ai_pending(env.room.id) == 0


async def test_concurrent_implicit_messages_reserve_their_slots_before_awaiting(env):
    env.script.block = asyncio.Event()
    real = env.deps.consume

    async def slow(scope, subject, limit):
        await asyncio.sleep(0.05)
        return await real(scope, subject, limit)

    env.deps.consume = slow
    for _ in range(env.store.limits.ai_queue - 1):
        env.hub.ai_enter(env.room.id)
    await asyncio.gather(env.cb.handle(send("one", "c1", to=EMMA.id)), env.ca.handle(send("two", "c2", to=LEO.id)))
    assert env.hub.ai_pending(env.room.id) == env.store.limits.ai_queue
    busy = [e for c in (env.alice, env.bob) for e in c.sender.sent if e == {"type": "notice", "code": "ai_busy"}]
    assert len(busy) == 1
    env.script.block.set()
    for _ in range(env.store.limits.ai_queue - 1):
        env.hub.ai_leave(env.room.id)
    await env.hub.drain()
    assert env.hub.ai_pending(env.room.id) == 0


async def test_a_failed_store_releases_the_reserved_slot_and_quota(env, monkeypatch):
    async def broken(*args, **kwargs):
        raise RuntimeError("db down")

    monkeypatch.setattr(env.store, "append", broken)
    with pytest.raises(RuntimeError):
        await env.cb.handle(send("hi", "x1", to=EMMA.id))
    assert env.hub.ai_pending(env.room.id) == 0 and env.refunds == ["room_ai_global"]


async def test_the_zh_note_goes_into_the_public_reply_meta_only_when_there_is_one(env):
    await env.cb.handle(send("@Emma hi", "n1"))
    await env.hub.drain()
    assert "note_zh" not in answers(env.alice)[-1]["meta"]
    env.script.note = "用过去式"
    await env.cb.handle(send("@Emma again", "n2"))
    await env.hub.drain()
    assert answers(env.alice)[-1]["meta"]["note_zh"] == "用过去式"
    rows, _ = await env.store.replay(env.room.id, A, 0, 50)
    assert [m.meta.get("note_zh") for m, _ in rows if m.kind == "ai_answer"] == [None, "用过去式"]  # replay carries it


async def test_routing_logs_no_text_names_or_ids(env, caplog):
    caplog.set_level(logging.DEBUG, logger="app")  # the app's own records; aiosqlite DEBUG logs SQL parameters
    seq = await ask_emma(env)
    # drain between sends: the tests share one SQLite connection, so overlapping turns would race (tests/CLAUDE.md)
    await env.ca.handle(send("SECRET-REPLY-1", "s1", reply_to=seq))
    await env.hub.drain()
    await env.cb.handle(send("@ai SECRET-ALIAS-2", "s2"))
    await env.hub.drain()
    await env.cb.handle(send("SECRET-TO-3", "s3", to=LEO.id))
    await env.hub.drain()
    await env.cb.handle(send("SECRET-STRANGER-4", "s4", to="builtin:partner"))
    env.script.error = "llm_unavailable"
    await env.cb.handle(send("SECRET-FAIL-5", "s5", to=EMMA.id))
    await env.hub.drain()
    text = "\n".join(r.getMessage() for r in caplog.records if r.name.startswith("app"))
    for secret in ("SECRET-", "Emma", "Leo", "alice", "bob", EMMA.id, LEO.id, "builtin:partner", "用过去式"):
        assert secret not in text
    assert "room agent turn failed code=upstream" in text
