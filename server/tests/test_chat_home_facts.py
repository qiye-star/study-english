"""Greeting facts sources and registry (plan 2026-10-23 R3, S4)."""
import asyncio
import logging
from datetime import date, datetime, timedelta, timezone

import pytest

from app.agents.greeting import facts as F
from app.links.greeting_facts import WordbookToday
from app.models import (Assessment, Conversation, LinkMistakeWord, Message, User, VocabularyItem, WordbookEnrollment,
                        utcnow)
from tests.wordbook_helpers import enable_wordbook, make_data_dir

UID = 10000001
NOW = datetime(2026, 10, 23, 9, 0, tzinfo=timezone.utc)
TODAY = date(2026, 10, 23)


def ctx(offset=0, now=NOW, uid=UID):
    from app.services.stats import local_date
    return F.FactCtx(user_id=uid, offset=offset, now=now, local_date=local_date(now, offset))


async def seed_user(app, uid=UID):
    async with app.state.sessionmaker() as s:
        s.add(User(id=uid, username=f"u{uid}", password_hash="x"))
        s.add(Conversation(id=f"c{uid}", user_id=uid, name="n", config={}, created_at=NOW, updated_at=NOW))
        await s.commit()


async def add_message(app, at, grammar=None, role="user", uid=UID, mid=None):
    async with app.state.sessionmaker() as s:
        s.add(Message(id=mid, conversation_id=f"c{uid}", role=role, content="x", grammar=grammar, created_at=at))
        await s.commit()


def slip(category, original="have went", corrected="have gone"):
    return {"has_errors": True, "errors": [{"original": original, "corrected": corrected, "category": category,
                                            "explanation": "e"}]}


async def test_streak_counts_user_message_days_like_stats_and_ignores_assistant(app):
    await seed_user(app)
    assert await F.Streak(app).load(ctx()) is None
    for days in (1, 2, 3):  # yesterday and two days before: streak 3 although today is still empty
        await add_message(app, NOW - timedelta(days=days))
    await add_message(app, NOW - timedelta(days=5))  # gap
    await add_message(app, NOW - timedelta(days=4), role="assistant")  # does not count
    assert await F.Streak(app).load(ctx()) == {"streak": 3}
    await add_message(app, NOW)
    assert await F.Streak(app).load(ctx()) == {"streak": 4}


async def test_streak_counts_assessments_and_respects_the_local_day_across_offsets(app):
    await seed_user(app)
    async with app.state.sessionmaker() as s:
        s.add(Assessment(user_id=UID, reference_text="r", language="en-US", duration_ms=1, audio_bytes=1, scores={},
                         result={}, audio_path="p", created_at=NOW - timedelta(days=1)))
        await s.commit()
    assert await F.Streak(app).load(ctx()) == {"streak": 1}
    # 22:00 UTC on Oct 22 is already Oct 23 at +840 minutes: that is "today" there, so the run still ends at today
    late = datetime(2026, 10, 22, 22, 0, tzinfo=timezone.utc)
    await add_message(app, late)
    got = await F.Streak(app).load(ctx(offset=840, now=NOW))
    assert got == {"streak": 2}  # Oct 23 (message) and Oct 22 (assessment at 09:00 UTC = Oct 22 23:00 local)


async def test_due_vocab_counts_only_due_items_of_the_user(app):
    await seed_user(app)
    await seed_user(app, UID + 1)
    async with app.state.sessionmaker() as s:
        for word, due, uid in (("a", -1, UID), ("b", -1, UID), ("c", 5, UID), ("d", -1, UID + 1)):
            s.add(VocabularyItem(user_id=uid, word=word, source="x", box=0, due_at=NOW + timedelta(days=due)))
        await s.commit()
    assert await F.DueVocab(app).load(ctx()) == {"due": 2}
    assert await F.DueVocab(app).load(ctx(uid=UID + 2)) is None


async def test_yesterday_grammar_window_category_and_pair(app):
    await seed_user(app)
    y = NOW - timedelta(days=1)
    await add_message(app, y - timedelta(hours=2), slip("tense", "go yesterday", "went yesterday"))
    await add_message(app, y - timedelta(hours=1), slip("tense"))
    await add_message(app, y, slip("article", "a apple", "an apple"))
    await add_message(app, NOW - timedelta(hours=1), slip("spelling"))  # today: outside the window
    await add_message(app, NOW - timedelta(days=2), slip("spelling"))  # the day before
    await add_message(app, y, slip("tense"), role="assistant")
    got = await F.YesterdayGrammar(app).load(ctx())
    assert got == {"slip_category": "tense", "slip_count": 2, "slip_wrong": "have went", "slip_right": "have gone"}


async def test_yesterday_grammar_skips_long_pairs_and_empty_days(app):
    await seed_user(app)
    assert await F.YesterdayGrammar(app).load(ctx()) is None
    y = NOW - timedelta(days=1)
    await add_message(app, y, slip("tense", "x" * 17, "y"))
    got = await F.YesterdayGrammar(app).load(ctx())
    assert got == {"slip_category": "tense", "slip_count": 1}  # too long: category and count only
    await add_message(app, y, {"has_errors": False, "errors": []})


async def test_yesterday_window_follows_the_offset(app):
    await seed_user(app)
    # Oct 22 20:00 UTC is Oct 23 04:00 at +480 -> today there, not yesterday; at 0 it is yesterday
    at = datetime(2026, 10, 22, 20, 0, tzinfo=timezone.utc)
    await add_message(app, at, slip("tense"))
    assert await F.YesterdayGrammar(app).load(ctx(offset=0)) is not None
    assert await F.YesterdayGrammar(app).load(ctx(offset=480)) is None
    # at -720 it is Oct 22 21:00 local, so the message (Oct 22 08:00 local) is today, not yesterday
    assert await F.YesterdayGrammar(app).load(ctx(offset=-720)) is None


def _result(word, kind="Mispronunciation", score=40):
    return {"detail_result": {"words": [{"word": word, "pronunciation_assessment": {"error_type": kind,
                                                                                      "accuracy_score": score}}]}}


async def test_yesterday_pron_collects_weak_words(app):
    await seed_user(app)
    assert await F.YesterdayPron(app).load(ctx()) is None
    y = NOW - timedelta(days=1)
    async with app.state.sessionmaker() as s:
        for word, kind, at in (("three", "Mispronunciation", y), ("world", "Omission", y), ("fine", "None", y),
                               ("old", "Mispronunciation", NOW - timedelta(days=3))):
            s.add(Assessment(user_id=UID, reference_text="r", language="en-US", duration_ms=1, audio_bytes=1, scores={},
                             result=_result(word, kind, 40 if kind != "None" else 95), audio_path="p", created_at=at))
        await s.commit()
    assert await F.YesterdayPron(app).load(ctx()) == {"pron_words": 2, "words": ["three", "world"]}


async def test_yesterday_wrong_counts_link_mistakes_answered_yesterday(app):
    await seed_user(app)
    y = NOW - timedelta(days=1)
    async with app.state.sessionmaker() as s:
        for word, count, at in (("talk", 3, y), ("able", 1, y), ("old", 9, NOW - timedelta(days=4))):
            s.add(LinkMistakeWord(user_id=UID, word=word, book_id="junior", wrong_count=count, ok_streak=0,
                                  last_event_at=at, last_wrong_at=at, cleared_at=None))
        await s.commit()
    assert await F.YesterdayWrong(app).load(ctx()) == {"wrong_words": 2, "words": ["talk", "able"]}
    assert await F.YesterdayWrong(app).load(ctx(uid=UID + 5)) is None


async def test_gather_merges_sources_and_numbers_only_in_storage_shape(app):
    await seed_user(app)
    y = NOW - timedelta(days=1)
    await add_message(app, y, slip("tense"))
    async with app.state.sessionmaker() as s:
        s.add(VocabularyItem(user_id=UID, word="secretword", source="x", box=0, due_at=NOW - timedelta(days=1)))
        s.add(LinkMistakeWord(user_id=UID, word="talk", book_id="junior", wrong_count=1, ok_streak=0, last_event_at=y,
                              last_wrong_at=y, cleared_at=None))
        await s.commit()
    got = await F.gather(app, ctx())
    assert (got.streak, got.due, got.slip_category, got.wrong_words) == (1, 1, "tense", 1)
    assert got.words == ("talk",) and got.numbers() == {"streak": 1, "due": 1, "yesterday_mistakes": 2}
    assert "talk" not in repr(got.numbers())
    assert F.focus_hint(got) == "fix_slip"
    assert F.focus_hint(F.GreetingFacts(due=3)) == "review" and F.focus_hint(F.GreetingFacts()) == "free_talk"
    assert F.GreetingFacts().numbers() == {}


def test_word_budget_counts_the_slip_pair_as_one():
    class Many:
        key = "many"

        async def load(self, c):
            return {"slip_wrong": "a", "slip_right": "b", "words": ["w1", "w2", "w3"]}

    class App:
        class state:
            pass

    app = App()
    app.state.greeting_facts = F.FactsRegistry()
    app.state.greeting_facts.register(Many())
    got = asyncio.run(F.gather(app, ctx()))
    assert got.words == ("w1", "w2")
    app.state.greeting_facts.register(Many())  # same key replaces
    assert len(app.state.greeting_facts.sources()) == 1


async def test_slow_failing_and_over_budget_sources_are_skipped_and_logged_by_key_and_class(app, caplog, monkeypatch):
    class Slow:
        key = "slow"

        async def load(self, c):
            await asyncio.sleep(5)

    class Boom:
        key = "boom"

        async def load(self, c):
            raise ValueError("SECRETWORD")

    class Fine:
        key = "fine"

        async def load(self, c):
            return {"streak": 7}

    registry = F.FactsRegistry()
    for source in (Slow(), Boom(), Fine()):
        registry.register(source)
    app.state.greeting_facts = registry
    monkeypatch.setattr(F, "SOURCE_TIMEOUT_MS", 50)
    caplog.set_level(logging.INFO, logger="app")
    got = await F.gather(app, ctx())
    assert got.streak == 7
    text = caplog.text
    assert "key=slow" in text and "key=boom error=ValueError" in text and "SECRETWORD" not in text
    # total budget: a source that ignores its own timeout is cancelled at the budget
    monkeypatch.setattr(F, "SOURCE_TIMEOUT_MS", 5000)
    monkeypatch.setattr(F, "TOTAL_BUDGET_MS", 50)
    registry.register(Slow())
    got = await asyncio.wait_for(F.gather(app, ctx()), 2)
    assert got.streak == 7


async def test_wordbook_source_needs_the_switch_and_an_enrollment(app, tmp_path):
    await seed_user(app)
    source = WordbookToday(app)
    assert await source.load(ctx()) is None  # wordbook off
    enable_wordbook(app, make_data_dir(tmp_path))
    assert await source.load(ctx(now=utcnow())) is None  # no active book
    async with app.state.sessionmaker() as s:
        s.add(WordbookEnrollment(user_id=UID, book_id="junior", status="active", order_mode="book", seed=1, cursor=0,
                                 daily_new=20, review_cap=100))
        await s.commit()
    got = await source.load(ctx(now=utcnow()))
    assert got is None or set(got) <= {"wordbook_due", "wordbook_streak"}


async def test_the_app_registers_all_builtin_sources_and_the_links_source(app):
    keys = [s.key for s in F.facts_registry(app).sources()]
    assert keys == ["streak", "due_vocab", "yesterday_grammar", "yesterday_pron", "yesterday_wrong", "wordbook_today"]
