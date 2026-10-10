"""对话用到今日词(spec 2026-10-11-learning-links §6.5;计划 L5)。"""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app.core import rank_sources
from app.core.learning_events import MessageSent
from app.links import chat_words
from app.links.chat_words import matches
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
