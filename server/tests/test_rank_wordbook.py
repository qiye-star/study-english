"""Rank x wordbook (spec 2026-10-10-wordbook §8). Rank reads `wordbook_events` through app.models only."""
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.models import User, WordbookEvent, XpEvent
from app.rank import ledger, points
from app.rank.points import EventRow, StageTask, stage_progress
from app.rank.rules import DEFAULT_RULES, rules_from_json, rules_json

NOW = datetime(2026, 11, 10, 9, 0, tzinfo=timezone.utc)


def test_points_table_and_cap_membership():
    assert points.POINTS["word_learned"] == 1 and points.POINTS["spelling_set"] == 2
    assert {"word_learned", "spelling_set"} <= points.CAPPED
    assert DEFAULT_RULES.points.word_learned == 1 and DEFAULT_RULES.points.spelling_set == 2


def test_old_published_rules_without_new_fields_still_parse():
    data = rules_json(DEFAULT_RULES)
    del data["points"]["word_learned"], data["points"]["spelling_set"]
    parsed = rules_from_json(data)
    assert (parsed.points.word_learned, parsed.points.spelling_set) == (1, 2)


def test_default_stage_tasks_do_not_use_words_learned():
    # spec R-W9: the default stage tasks are unchanged (wordbook is off by default)
    assert all(t.kind != "words_learned" for tasks in DEFAULT_RULES.stage_tasks.values() for t in tasks)


def test_words_learned_stage_task_counts_events(monkeypatch):
    monkeypatch.setitem(points.STAGE_TASKS, 0, (StageTask("words", "words_learned", 2),))
    events = [EventRow("word_learned", None, "2026-11-10"), EventRow("word_learned", None, "2026-11-10"),
              EventRow("vocab_review", None, "2026-11-10")]
    (task,) = stage_progress(0, events)
    assert (task.kind, task.done, task.complete) == ("words_learned", 2, True)


def test_rules_simulation_recomputes_wordbook_points():
    from app.admin.rank_sim import recompute_points

    assert recompute_points("word_learned", None, DEFAULT_RULES) == 1
    assert recompute_points("spelling_set", None, DEFAULT_RULES) == 2


async def _seed_events(app, user_id: int, kinds: list[str]) -> None:
    async with app.state.sessionmaker() as s:
        s.add(User(id=user_id, username=f"u{user_id}", password_hash="x"))
        for i, kind in enumerate(kinds):
            s.add(WordbookEvent(user_id=user_id, book_id="cet4", kind=kind, word=f"w{i}", item_id=None, qtype=None,
                                outcome="good", credit=100, day="2026-11-10", created_at=NOW - timedelta(minutes=10 - i)))
        await s.commit()


async def test_sync_turns_wordbook_events_into_capped_rp(app):
    await _seed_events(app, 10000007, ["learn", "learn", "learn", "practice", "spell_set"])
    async with app.state.sessionmaker() as s:
        await ledger.sync(s, 10000007, NOW, 0, daily_cap=4)
        rows = (await s.execute(select(XpEvent.kind, XpEvent.ref_id, XpEvent.points).where(
            XpEvent.kind.in_(("word_learned", "spelling_set"))).order_by(XpEvent.created_at))).all()
    assert [(k, p) for k, _, p in rows] == [("word_learned", 1), ("word_learned", 1), ("word_learned", 1),
                                           ("spelling_set", 1)]  # the daily cap of 4 trims the last one to 1
    assert rows[0][1].startswith("wl:") and rows[-1][1].startswith("ws:")


async def test_sync_is_idempotent_and_uses_published_rule_points(app):
    await _seed_events(app, 10000008, ["learn", "spell_set"])
    custom = DEFAULT_RULES.model_copy(update={"points": DEFAULT_RULES.points.model_copy(
        update={"word_learned": 3, "spelling_set": 5})})
    async with app.state.sessionmaker() as s:
        await ledger.sync(s, 10000008, NOW, 0, daily_cap=60, rules=custom)
        await ledger.sync(s, 10000008, NOW + timedelta(minutes=5), 0, daily_cap=60, rules=custom)
        rows = (await s.execute(select(XpEvent.kind, XpEvent.points).where(
            XpEvent.user_id == 10000008, XpEvent.kind.in_(("word_learned", "spelling_set")))
            .order_by(XpEvent.created_at))).all()
    assert [tuple(r) for r in rows] == [("word_learned", 3), ("spelling_set", 5)]
