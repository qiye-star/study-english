"""Rank x learning-link point sources (spec 2026-10-11-learning-links §5.3–5.4, plan L6-1).

Existing rank tests stay untouched; these prove the link sources only fill the daily cap's leftover."""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError
from sqlalchemy import event, select

from app.core import rank_sources
from app.core.rank_sources import RankSource
from app.links.rank_sources import SPEC
from app.models import Conversation, LinkCredit, Message, RankProfile, XpEvent
from app.rank import extra_sources, ledger
from app.rank.rules import DEFAULT_RULES, rules_from_json, rules_json
from tests.links_helpers import enable_links

SRC = RankSource("word_in_chat", 1, "对话用到新词", "New word used in chat")
DAY = datetime(2026, 10, 11, 4, 0, tzinfo=timezone.utc)  # 12:00 local at +480
NOW = DAY + timedelta(hours=1)


@pytest.fixture(autouse=True)
def registry():
    saved = rank_sources.registered()
    rank_sources.clear_for_tests()
    yield
    rank_sources.clear_for_tests()
    for s in saved:
        rank_sources.register(s)


def statements(engine):
    seen = []

    def before(conn, cursor, statement, params, context, executemany):
        seen.append(statement)
    event.listen(engine.sync_engine, "before_cursor_execute", before)
    return seen, lambda: event.remove(engine.sync_engine, "before_cursor_execute", before)


async def user(client, name):
    r = await client.post("/api/users", json={"username": name, "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return int((await client.get("/api/me", headers=h)).json()["id"])


async def seed_messages(app, uid, n, at):
    async with app.state.sessionmaker() as s:
        conv = Conversation(id=str(uuid.uuid4()), user_id=uid, name="c", config={}, created_at=at, updated_at=at)
        s.add(conv)
        for i in range(n):
            s.add(Message(id=str(uuid.uuid4()), conversation_id=conv.id, role="user", content="x",
                          created_at=at + timedelta(seconds=i)))
        await s.commit()


async def seed_credits(app, uid, n, at, prefix="wic"):
    async with app.state.sessionmaker() as s:
        for i in range(n):
            s.add(LinkCredit(user_id=uid, kind="word_in_chat", ref_id=f"{prefix}:{i}", score=None,
                             created_at=at + timedelta(seconds=i)))
        await s.commit()


async def run_sync(app, uid, cap=60, rules=None, now=NOW):
    async with app.state.sessionmaker() as s:
        await ledger.sync(s, uid, now, 480, cap, rules=rules)
    async with app.state.sessionmaker() as s:
        rows = (await s.scalars(select(XpEvent).where(XpEvent.user_id == uid).order_by(XpEvent.created_at, XpEvent.id))).all()
    return [(e.kind, e.ref_id, e.points) for e in rows]


async def test_an_empty_registry_issues_no_query(app):
    seen, stop = statements(app.state.engine)
    async with app.state.sessionmaker() as s:
        assert await extra_sources.collect(s, 1, DAY - timedelta(days=1), NOW, 480) == ([], None)
        assert await extra_sources.capped(s, 1, [], [], 60) == []
    stop()
    assert seen == []


async def test_an_empty_registry_keeps_sync_statements_and_events_as_before(app, client, monkeypatch):
    """Spec §5.4: with nothing registered `_sync` issues the same SQL and writes the same rows as without the hook."""
    a, b = await user(client, "alpha"), await user(client, "bravo")
    for uid in (a, b):
        await seed_messages(app, uid, 3, DAY)
        await seed_credits(app, uid, 2, DAY)  # rows of an unregistered kind are never read

    async def traced(uid):
        seen, stop = statements(app.state.engine)
        events = await run_sync(app, uid)
        stop()
        return events, len(seen)

    hooked, hooked_count = await traced(a)

    async def no_collect(*args, **kwargs):
        return [], None

    async def no_capped(*args, **kwargs):
        return []
    monkeypatch.setattr(extra_sources, "collect", no_collect)
    monkeypatch.setattr(extra_sources, "capped", no_capped)
    plain, plain_count = await traced(b)
    assert hooked_count == plain_count
    assert [(k, p) for k, _, p in hooked] == [(k, p) for k, _, p in plain]


async def test_a_registered_source_without_rows_changes_nothing(app, client):
    a, b = await user(client, "alpha"), await user(client, "bravo")
    for uid in (a, b):
        await seed_messages(app, uid, 5, DAY)
    base = await run_sync(app, a)
    rank_sources.register(SRC)
    with_source = await run_sync(app, b)
    assert sorted((k, p) for k, _, p in base) == sorted((k, p) for k, _, p in with_source)


async def test_credits_only_take_the_leftover_and_never_reduce_core_points(app, client):
    rank_sources.register(SRC)
    a, b = await user(client, "alpha"), await user(client, "bravo")
    await seed_credits(app, b, 3, DAY - timedelta(minutes=30))  # earlier in the day than the chat
    for uid in (a, b):
        await seed_messages(app, uid, 4, DAY)
    plain, mixed = await run_sync(app, a, cap=5), await run_sync(app, b, cap=5)
    core = lambda events: sorted(p for k, _, p in events if k == "chat_turn")  # noqa: E731
    assert core(plain) == core(mixed) == [1, 1, 1, 1]
    assert [p for k, _, p in mixed if k == "word_in_chat"] == [1, 0, 0]  # cap 5 - 4 core points = 1 left
    assert len([k for k, _, _ in mixed if k == "word_in_chat"]) == 3  # trimmed rows stay (never re-evaluated)
    assert await run_sync(app, b, cap=5) == mixed  # idempotent


async def test_credits_synced_earlier_count_against_the_leftover_of_later_syncs(app, client):
    rank_sources.register(SRC)
    uid = await user(client, "alpha")
    await seed_credits(app, uid, 4, DAY - timedelta(minutes=30))
    first = await run_sync(app, uid, cap=6, now=DAY)
    assert [p for k, _, p in first if k == "word_in_chat"] == [1, 1, 1, 1]
    await seed_messages(app, uid, 4, DAY + timedelta(minutes=1))
    await seed_credits(app, uid, 2, DAY + timedelta(minutes=5), prefix="late")
    second = await run_sync(app, uid, cap=6)
    # core points never shrink: 4 chat turns on top of 4 extra points = 8 > cap 6 (the documented upper bound)
    assert [p for k, _, p in second if k == "chat_turn"] == [1, 1, 1, 1]
    assert [p for k, r, p in second if k == "word_in_chat" and r.startswith("late:")] == [0, 0]


async def test_sub_cap_and_points_from_published_rules(app, client):
    rank_sources.register(SRC)
    a, b = await user(client, "alpha"), await user(client, "bravo")
    await seed_credits(app, a, 7, DAY)
    assert sorted(p for k, _, p in await run_sync(app, a) if k == "word_in_chat") == [0, 0, 1, 1, 1, 1, 1]
    rules = DEFAULT_RULES.model_copy(update={"points": DEFAULT_RULES.points.model_copy(
        update={"sources": {"word_in_chat": 3}, "sources_daily_cap": 4})})
    await seed_credits(app, b, 3, DAY)
    assert [p for k, _, p in await run_sync(app, b, rules=rules) if k == "word_in_chat"] == [3, 1, 0]


async def test_credits_alone_make_no_active_day_and_no_stage_progress(app, client):
    rank_sources.register(SRC)
    uid = await user(client, "alpha")
    await seed_credits(app, uid, 2, DAY)
    assert {k for k, _, _ in await run_sync(app, uid)} == {"word_in_chat"}
    async with app.state.sessionmaker() as s:
        tasks = await ledger.stage_progress_for(s, await s.get(RankProfile, uid))
    assert tasks and all(t.done == 0 for t in tasks)


async def test_a_full_page_of_credits_lowers_the_watermark(app, client, monkeypatch):
    rank_sources.register(SRC)
    monkeypatch.setattr(extra_sources, "MAX_ROWS", 2)
    uid = await user(client, "alpha")
    await seed_credits(app, uid, 3, DAY)
    first = await run_sync(app, uid)
    assert [r for k, r, _ in first if k == "word_in_chat"] == ["wic:0", "wic:1"]
    async with app.state.sessionmaker() as s:
        synced = (await s.get(RankProfile, uid)).synced_at
    assert synced.replace(tzinfo=timezone.utc) == DAY + timedelta(seconds=1)
    second = await run_sync(app, uid)
    assert [r for k, r, _ in second if k == "word_in_chat"] == ["wic:0", "wic:1", "wic:2"]


def test_points_rule_fields_default_for_old_json_and_are_bounded():
    old = rules_json(DEFAULT_RULES)
    del old["points"]["sources"], old["points"]["sources_daily_cap"]
    parsed = rules_from_json(old)
    assert (parsed.points.sources, parsed.points.sources_daily_cap) == ({}, 5)
    assert rules_from_json(rules_json(DEFAULT_RULES)) == DEFAULT_RULES
    for bad in ({"Bad-Key": 1}, {"word_in_chat": 101}, {"x" * 17: 1}):
        data = rules_json(DEFAULT_RULES)
        data["points"]["sources"] = bad
        with pytest.raises(ValidationError):
            rules_from_json(data)
    data = rules_json(DEFAULT_RULES)
    data["points"]["sources_daily_cap"] = 101
    with pytest.raises(ValidationError):
        rules_from_json(data)


def test_points_and_sub_cap_follow_the_rules_or_the_defaults():
    rules = DEFAULT_RULES.model_copy(update={"points": DEFAULT_RULES.points.model_copy(
        update={"sources": {"word_in_chat": 7}, "sources_daily_cap": 9})})
    assert (extra_sources.points_of(SRC), extra_sources.sub_cap()) == (1, extra_sources.DEFAULT_SUB_CAP) == (1, 5)
    assert (extra_sources.points_of(SRC, DEFAULT_RULES), extra_sources.sub_cap(DEFAULT_RULES)) == (1, 5)
    assert (extra_sources.points_of(SRC, rules), extra_sources.sub_cap(rules)) == (7, 9)


async def test_the_rank_sources_link_is_a_gate_key_without_subscription_or_router(app, client, auth_headers):
    assert (SPEC.key, SPEC.install, SPEC.router) == ("rank_sources", None, None)
    enable_links(app)
    links = {x["key"]: x for x in (await client.get("/api/links/config", headers=auth_headers)).json()["links"]}
    assert links["rank_sources"]["effective"] is True
    enable_links(app, link_rank_sources_enabled=False)
    links = {x["key"]: x for x in (await client.get("/api/links/config", headers=auth_headers)).json()["links"]}
    assert (links["rank_sources"]["global"], links["rank_sources"]["effective"]) == (False, False)
