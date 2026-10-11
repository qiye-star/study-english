"""智能体的学习数据来源(spec §3.3、§4.6;裁定 R-A1;计划 R-C19、R-C20)。"""
import dataclasses
import logging
from datetime import timedelta

from app.agents.context import SourceCtx
from app.agents.orchestrator import runtime
from app.agents.personas import builtin_by_id
from app.agents.settings import DEFAULTS
from app.links import agent_sources as A
from app.models import (
    LinkMistakeWord, LinkWeakWord, User, VocabularyItem, WordbookEnrollment, WordbookEvent, utcnow,
)
from tests.background import drain_background
from tests.agents_helpers import FakeLLM, enable_agents, new_conversation, parse_sse, turn_body, use_fake_llm
from tests.wordbook_helpers import enable_wordbook, make_data_dir

UID = 10000001


def ctx(text="hello", **settings):
    agent = dataclasses.replace(DEFAULTS, **settings) if settings else DEFAULTS
    return SourceCtx(UID, builtin_by_id("builtin:partner"), agent, text, "c1")


async def seed(app):
    now = utcnow()
    async with app.state.sessionmaker() as s:
        s.add(User(id=UID, username="u", password_hash="x"))
        s.add(User(id=UID + 1, username="v", password_hash="x"))
        for i, word in enumerate(["talk", "able", "talk", "carry"]):
            s.add(WordbookEvent(user_id=UID, book_id="junior", kind="learn", word=word, outcome="ok", day="2026-10-12",
                                created_at=now - timedelta(hours=i)))
        s.add(WordbookEvent(user_id=UID, book_id="junior", kind="learn", word="ancient", outcome="ok",
                            day="2026-09-01", created_at=now - timedelta(days=30)))
        s.add(WordbookEvent(user_id=UID + 1, book_id="junior", kind="learn", word="other", outcome="ok",
                            day="2026-10-12", created_at=now))
        s.add(LinkMistakeWord(user_id=UID, word="accept", book_id="junior", wrong_count=3, ok_streak=0,
                              last_event_at=now, last_wrong_at=now))
        s.add(LinkMistakeWord(user_id=UID, word="cleared", book_id="junior", wrong_count=9, ok_streak=3,
                              last_event_at=now, last_wrong_at=now, cleared_at=now))
        s.add(LinkWeakWord(user_id=UID, word="three", hits=2, ok_streak=0, last_event_at=now, last_weak_at=now))
        s.add(VocabularyItem(user_id=UID, word="absorb", source="manual", due_at=now - timedelta(hours=1)))
        s.add(VocabularyItem(user_id=UID, word="later", source="manual", due_at=now + timedelta(days=2)))
        await s.commit()


async def test_sources_are_registered_at_create_app(app):
    assert {"learned_words", "weak_words", "due_words", "word_lookup"} <= set(runtime(app).registry.keys())
    assert all(runtime(app).registry.get(k).private for k in ("learned_words", "weak_words", "due_words", "word_lookup"))


async def test_learned_words_recent_distinct_and_own_only(app):
    await seed(app)
    result = await A.LearnedWords(app).load(ctx())
    assert result.params == {"count": 3, "words": ["talk", "able", "carry"]}
    assert "talk, able, carry" in result.block and "ancient" not in result.block and "other" not in result.block


async def test_weak_words_reads_link_tables_even_when_links_are_off(app):
    await seed(app)
    assert app.state.settings.links_enabled is False
    result = await A.WeakWords(app).load(ctx())
    assert result.params == {"count": 2, "words": ["accept", "three"]}
    assert "answered wrong: accept" in result.block and "mispronounced: three" in result.block
    assert "cleared" not in result.block


async def test_due_words_and_empty_results(app):
    await seed(app)
    due = await A.DueWords(app).load(ctx())
    assert due.params == {"count": 1, "words": ["absorb"]} and "later" not in due.block
    assert await A.DueWords(app).load(dataclasses.replace(ctx(), user_id=UID + 1)) is None


async def test_word_lookup_uses_the_active_book_and_needs_the_wordbook_switch(app, tmp_path):
    await seed(app)
    assert await A.WordLookup(app).load(ctx("They had to abandon the car and stopped")) is None  # wordbook off
    enable_wordbook(app, make_data_dir(tmp_path))
    async with app.state.sessionmaker() as s:
        s.add(WordbookEnrollment(user_id=UID, book_id="junior", status="active", order_mode="book", seed=1, cursor=0,
                                 daily_new=20, review_cap=100))
        await s.commit()
    result = await A.WordLookup(app).load(ctx("They had to abandon the car and stopped"))
    assert result.params == {"count": 2, "words": ["abandon", "stop"]}
    assert result.block.startswith("Dictionary (data):") and "abandon — " in result.block
    assert await A.WordLookup(app).load(ctx("ok so we go")) is None  # only short / function words
    assert await A.WordLookup(app).load(ctx(None)) is None


async def test_sources_follow_user_and_persona_tool_switches_in_a_turn(app, client, auth_headers, caplog):
    caplog.set_level(logging.DEBUG, logger="app")  # root DEBUG would capture aiosqlite bound SQL parameters (test-environment artifact)
    await use_fake_llm(app, FakeLLM())
    enable_agents(app)
    conv = await new_conversation(client, auth_headers)
    events = parse_sse((await client.post("/api/agents/turn", headers=auth_headers,
                                          json=turn_body(conv, text="SECRETWORD please"))).text)
    keys = {d["key"] for e, d in events if e == "step"}
    assert {"learned_words", "weak_words", "due_words", "word_lookup"} <= keys
    # the memory after_turn task shares the one in-memory SQLite connection (StaticPool) with the next request: let it finish first
    await drain_background(app)
    await client.patch("/api/agents/settings", headers=auth_headers,
                       json={"tools": {"lookup": False, "due_words": False}})
    events = parse_sse((await client.post("/api/agents/turn", headers=auth_headers, json=turn_body(conv))).text)
    keys = {d["key"] for e, d in events if e == "step"}
    assert "word_lookup" not in keys and "due_words" not in keys and "learned_words" in keys
    assert "SECRETWORD" not in caplog.text
