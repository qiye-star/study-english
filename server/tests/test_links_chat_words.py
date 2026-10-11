"""对话用到今日词(spec 2026-10-11-learning-links §6.5;计划 L5)。"""
import asyncio
from datetime import datetime, timedelta, timezone

import httpx
import pytest
import respx
from sqlalchemy import func, select

from app.core import metering, rank_sources
from app.core.learning_events import MessageSent
from app.links import chat_words
from app.links.chat_words import matches, parse_judge, render_judge
from app.models import LinkCredit, LinkWordUse, WordbookEvent
from tests.links_helpers import check_contract, drain, enable_links, user_id_of

T0 = datetime(2026, 10, 11, 8, 0, tzinfo=timezone.utc)


@pytest.mark.parametrize("text,keys,expected", [
    ("I talked to her yesterday.", {"talk"}, {"talk"}),
    ("We were carrying boxes.", {"carry"}, {"carry"}),
    ("The children went home.", {"child", "go"}, {"child", "go"}),
    ("I used to swim.", {"used to"}, {"used to"}),
    ("I went to bed.", {"be"}, set()),  # bed is not a form of be
    ("Talking talks talked", {"talk", "walk"}, {"talk"}),
    ("", {"talk"}, set()),
])
def test_matches_uses_lemmas_without_an_llm(text, keys, expected):
    assert matches(text, keys) == expected


async def login(app, client, name="alice", **flags):
    enable_links(app, **flags)
    r = await client.post("/api/users", json={"username": name, "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return await user_id_of(client, h), h


async def learned(app, uid, *words, at=T0 - timedelta(hours=2), kind="learn"):
    ids = {}
    async with app.state.sessionmaker() as s:
        for w in words:
            e = WordbookEvent(user_id=uid, book_id="junior", kind=kind, word=w, item_id=None, qtype="meaning",
                              outcome="known", credit=100, day="2026-10-11", created_at=at)
            s.add(e)
            await s.flush()
            ids[w] = e.id
        await s.commit()
    return ids


def msg(uid, text, minutes=0, mid="m1"):
    return MessageSent(user_id=uid, conversation_id="c1", message_id=mid, text=text, at=T0 + timedelta(minutes=minutes))


async def counts(app, uid):
    async with app.state.sessionmaker() as s:
        uses = (await s.scalars(select(LinkWordUse.word).where(LinkWordUse.user_id == uid).order_by(LinkWordUse.word))).all()
        credits = (await s.scalars(select(LinkCredit.ref_id).where(LinkCredit.user_id == uid).order_by(LinkCredit.ref_id))).all()
    return list(uses), list(credits)


async def test_a_use_is_recorded_once_per_learned_word_and_credited(app, client):
    uid, _ = await login(app, client)
    ids = await learned(app, uid, "talk", "carry")
    await chat_words.handle(app, msg(uid, "I talked and talked."))
    await chat_words.handle(app, msg(uid, "Talking again.", 5, "m2"))  # same learned word: no second record
    uses, credits = await counts(app, uid)
    assert uses == ["talk"] and credits == [f"wic:{ids['talk']}"]
    async with app.state.sessionmaker() as s:
        credit = await s.scalar(select(LinkCredit).where(LinkCredit.user_id == uid))
    assert credit.kind == "word_in_chat" and credit.score is None


async def test_replaying_the_same_event_is_idempotent(app, client):
    uid, _ = await login(app, client)
    await learned(app, uid, "talk")
    event = msg(uid, "I talked.")
    await chat_words.handle(app, event)
    await chat_words.handle(app, event)
    assert await counts(app, uid) == (["talk"], [f"wic:{(await learned_ids(app, uid))['talk']}"])


async def learned_ids(app, uid):
    async with app.state.sessionmaker() as s:
        rows = (await s.execute(select(WordbookEvent.word, WordbookEvent.id).where(WordbookEvent.user_id == uid))).all()
    return dict(rows)


async def test_old_learns_are_not_todays_words_and_the_daily_cap_applies(app, client):
    uid, _ = await login(app, client, link_chat_words_daily_max=2)
    await learned(app, uid, "talk", at=T0 - timedelta(hours=30))
    await learned(app, uid, "go", "child", "carry")
    await chat_words.handle(app, msg(uid, "I talked, went with the children and carried bags."))
    uses, _ = await counts(app, uid)
    assert len(uses) == 2 and "talk" not in uses


async def test_learns_after_the_message_and_other_users_words_do_not_count(app, client):
    uid, _ = await login(app, client)
    other, _ = await login(app, client, name="bob")
    await learned(app, uid, "talk", at=T0 + timedelta(minutes=10))
    await learned(app, other, "carry")
    await chat_words.handle(app, msg(uid, "I talked and carried it."))
    assert await counts(app, uid) == ([], [])
    assert await counts(app, other) == ([], [])


async def test_no_credit_when_rank_sources_is_off_for_the_user(app, client):
    uid, h = await login(app, client)
    await client.put("/api/links/prefs", headers=h, json={"key": "rank_sources", "enabled": False})
    await learned(app, uid, "talk")
    await chat_words.handle(app, msg(uid, "talk"))
    assert await counts(app, uid) == (["talk"], [])


async def test_no_credit_when_rank_sources_is_off_globally(app, client):
    uid, _ = await login(app, client, link_rank_sources_enabled=False)
    await learned(app, uid, "talk")
    await chat_words.handle(app, msg(uid, "talk"))
    assert await counts(app, uid) == (["talk"], [])


async def test_end_to_end_api_and_no_text_stored_or_logged(app, client, caplog):
    uid, h = await login(app, client)
    await learned(app, uid, "talk", "carry", at=datetime.now(timezone.utc) - timedelta(hours=1))
    conv = (await client.post("/api/conversations", headers=h, json={"name": "c"})).json()
    with caplog.at_level("DEBUG", logger="app"):
        await client.post(f"/api/conversations/{conv['id']}/messages", headers=h,
                          json={"messages": [{"role": "user", "content": "My secret: I talked a lot"}]})
        await drain(app)
    assert "secret" not in caplog.text
    body = (await client.get("/api/links/chat-words", headers=h)).json()
    assert body == {"today": [{"word": "talk", "used": True}, {"word": "carry", "used": False}], "used_count": 1}
    async with app.state.sessionmaker() as s:
        assert await s.scalar(select(func.count()).select_from(LinkWordUse)) == 1
    assert app.state.learning_bus.stats()["chat_words"]["handled"] == 1
    check_contract("links_chat_words_contract", {"chat_words": body})


async def test_assistant_messages_and_the_switches_gate_the_handler(app, client):
    uid, h = await login(app, client, link_chat_words_enabled=False)
    await learned(app, uid, "talk", at=datetime.now(timezone.utc) - timedelta(hours=1))
    conv = (await client.post("/api/conversations", headers=h, json={"name": "c"})).json()
    url = f"/api/conversations/{conv['id']}/messages"
    await client.post(url, headers=h, json={"messages": [{"role": "user", "content": "I talked"}]})
    await drain(app)
    assert await counts(app, uid) == ([], [])
    assert (await client.get("/api/links/chat-words", headers=h)).json() == {"error": "Link is off"}
    enable_links(app, link_chat_words_enabled=True)
    await client.put("/api/links/prefs", headers=h, json={"key": "chat_words", "enabled": False})
    await client.post(url, headers=h, json={"messages": [{"role": "user", "content": "I talked"}]})
    await drain(app)
    assert await counts(app, uid) == ([], [])
    await client.put("/api/links/prefs", headers=h, json={"key": "chat_words", "enabled": True})
    await client.post(url, headers=h, json={"messages": [{"role": "assistant", "content": "You talked"}]})
    await drain(app)
    assert await counts(app, uid) == ([], [])


async def test_the_api_is_404_when_links_are_off(app, client):
    r = await client.post("/api/users", json={"username": "alice", "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    resp = await client.get("/api/links/chat-words", headers=h)
    assert resp.status_code == 404 and resp.json() == {"error": "Link is off"}


async def test_relearned_words_are_not_todays_words(app, client):
    """B 的 relearn(删掉 / 重置后重学)不是今日词:word_in_chat 每词每人最多一次(INDEX R-P4)。"""
    uid, _ = await login(app, client)
    async with app.state.sessionmaker() as s:
        s.add(WordbookEvent(user_id=uid, book_id="junior", kind="relearn", word="talk", item_id=None, qtype="recall",
                            outcome="know", credit=100, day="2026-10-11", created_at=T0 - timedelta(hours=1)))
        await s.commit()
    await chat_words.handle(app, msg(uid, "I talked."))
    assert await counts(app, uid) == ([], [])


def test_install_registers_the_rank_source(app):
    assert rank_sources.get("word_in_chat") == chat_words.SOURCE
    assert chat_words.SPEC.key == "chat_words" and chat_words.SPEC.router is chat_words.router


# ---- L5-2:可选的大模型用法检查(默认关、限额、402 降级)----
LLM_URL = "https://llm.test/v1/chat/completions"


def ok_reply(content):
    return httpx.Response(200, json={"choices": [{"message": {"content": content}}],
                                     "usage": {"prompt_tokens": 5, "completion_tokens": 3}})


def extra(app):
    return app.state.learning_bus.stats()["chat_words"]["extra"]


def test_parse_judge_is_strict_and_falls_back_to_all():
    assert parse_judge('{"ok": ["talk"]}', ["talk", "carry"]) == {"talk"}
    assert parse_judge('{"ok": ["zebra"]}', ["talk"]) == set()
    assert parse_judge("not json", ["talk"]) == {"talk"}
    assert parse_judge('{"ok": "talk"}', ["talk"]) == {"talk"}
    assert parse_judge('{"ok": [1]}', ["talk"]) == {"talk"}
    assert parse_judge('```json\n{"ok": []}\n```', ["talk"]) == set()


def test_render_judge_wraps_and_truncates_the_learner_text():
    messages = render_judge("<b>hi</b> " + "x" * 1000, ["talk", "carry"])
    assert [m["role"] for m in messages] == ["system", "user"]
    user = messages[1]["content"]
    assert "talk, carry" in user and user.count("<learner>") == 1 and "<b>" not in user
    assert len(user) < 760


async def test_llm_is_off_by_default_and_never_called(app, client):
    uid, _ = await login(app, client)
    await learned(app, uid, "talk")
    with respx.mock(assert_all_called=False) as mock:
        route = mock.post(LLM_URL).mock(return_value=ok_reply('{"ok": []}'))
        await chat_words.handle(app, msg(uid, "I talked"))
        await app.state.links_judge.join()
    assert route.call_count == 0 and (await counts(app, uid))[1]
    assert "llm_calls" not in extra(app)


@respx.mock
async def test_llm_judge_credits_only_approved_words(app, client):
    uid, _ = await login(app, client, link_chat_words_llm_enabled=True)
    ids = await learned(app, uid, "talk", "carry")
    route = respx.post(LLM_URL).mock(return_value=ok_reply('{"ok": ["talk"]}'))
    await chat_words.handle(app, msg(uid, "I talked and carried it."))
    await app.state.links_judge.join()
    uses, credits = await counts(app, uid)
    assert uses == ["carry", "talk"] and credits == [f"wic:{ids['talk']}"]
    assert extra(app)["llm_calls"] == 1 and extra(app)["llm_rejected"] == 1
    assert route.call_count == 1
    assert "I talked and carried it." in route.calls[0].request.content.decode()
    records = [(r.feature, r.user_id) for r in metering.METER.drain() if r.kind == "llm"]
    assert records[-1:] == [("links", uid)]


@respx.mock
async def test_out_of_balance_402_degrades_to_deterministic_credits(app, client, caplog):
    uid, _ = await login(app, client, link_chat_words_llm_enabled=True)
    await learned(app, uid, "talk")
    respx.post(LLM_URL).mock(return_value=httpx.Response(402, json={"error": "balance"}))
    with caplog.at_level("INFO", logger="app"):
        await chat_words.handle(app, msg(uid, "My private sentence: I talked"))
        await app.state.links_judge.join()
    assert (await counts(app, uid))[1]  # credited anyway
    assert extra(app)["llm_degraded"] == 1
    assert "private" not in caplog.text and "talk" not in caplog.text


@respx.mock
async def test_an_upstream_failure_backs_off_without_calling_again(app, client):
    uid, _ = await login(app, client, link_chat_words_llm_enabled=True)
    await learned(app, uid, "talk", "carry")
    route = respx.post(LLM_URL).mock(return_value=httpx.Response(402, json={"error": "balance"}))
    await chat_words.handle(app, msg(uid, "I talked"))
    await app.state.links_judge.join()
    await chat_words.handle(app, msg(uid, "I carried it", 1, "m2"))
    await app.state.links_judge.join()
    assert route.call_count == 1
    assert len((await counts(app, uid))[1]) == 2 and extra(app)["llm_degraded"] == 2


@respx.mock
async def test_unparsable_replies_degrade_to_all_words(app, client):
    uid, _ = await login(app, client, link_chat_words_llm_enabled=True)
    await learned(app, uid, "talk")
    respx.post(LLM_URL).mock(return_value=ok_reply("Sure! talk is fine."))
    await chat_words.handle(app, msg(uid, "I talked"))
    await app.state.links_judge.join()
    assert (await counts(app, uid))[1] and extra(app)["llm_degraded"] == 1


async def test_global_daily_cap_and_full_queue_degrade_without_calling_upstream(app, client, monkeypatch):
    uid, _ = await login(app, client, link_chat_words_llm_enabled=True, link_chat_words_llm_global_daily=0)
    await learned(app, uid, "talk")
    called = []
    monkeypatch.setattr("app.providers.llm.complete", lambda *a, **k: called.append(1))
    await chat_words.handle(app, msg(uid, "talked"))
    await app.state.links_judge.join()
    assert called == [] and (await counts(app, uid))[1]
    assert extra(app)["llm_degraded"] == 1


async def test_a_full_pending_queue_credits_deterministically(app, client, monkeypatch):
    uid, _ = await login(app, client, link_chat_words_llm_enabled=True)
    await learned(app, uid, "talk")
    monkeypatch.setattr(chat_words, "JUDGE_PENDING_MAX", 0)
    called = []
    monkeypatch.setattr("app.providers.llm.complete", lambda *a, **k: called.append(1))
    await chat_words.handle(app, msg(uid, "talked"))
    assert called == [] and (await counts(app, uid))[1]
    assert extra(app)["llm_overflow"] == 1 and extra(app)["llm_degraded"] == 1


async def test_a_slow_upstream_times_out_and_degrades(app, client, monkeypatch):
    uid, _ = await login(app, client, link_chat_words_llm_enabled=True)
    await learned(app, uid, "talk")
    never = asyncio.Event()

    async def slow(*a, **k):
        await never.wait()

    monkeypatch.setattr("app.providers.llm.complete", slow)
    monkeypatch.setattr(chat_words, "JUDGE_TIMEOUT", 0.05)
    await chat_words.handle(app, msg(uid, "talked"))
    await app.state.links_judge.join()
    assert (await counts(app, uid))[1] and extra(app)["llm_degraded"] == 1


async def test_the_judge_never_waits_inside_the_bus_handler(app, client, monkeypatch):
    uid, _ = await login(app, client, link_chat_words_llm_enabled=True)
    await learned(app, uid, "talk")
    gate = asyncio.Event()

    async def held(*a, **k):
        await gate.wait()
        return '{"ok": ["talk"]}'

    monkeypatch.setattr("app.providers.llm.complete", held)
    await chat_words.handle(app, msg(uid, "talked"))  # returns while the judge is still waiting
    assert await counts(app, uid) == (["talk"], []) and len(app.state.links_judge.pending) == 1
    gate.set()
    await app.state.links_judge.join()
    assert len((await counts(app, uid))[1]) == 1