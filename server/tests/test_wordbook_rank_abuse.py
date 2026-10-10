"""Wordbook answers must not farm rank events (review B1)."""
from sqlalchemy import select

from app.models import VocabularyItem, WordbookEvent, XpEvent
from app.rank import ledger, points
from app.rank.points import StageTask
from tests.wordbook_helpers import enable_wordbook, make_data_dir

URL = "/api/wordbook"
NOW_OFFSET = 480


async def login(app, client, tmp_path, **overrides):
    enable_wordbook(app, make_data_dir(tmp_path), rank_enabled=True, **overrides)
    r = await client.post("/api/users", json={"username": "alice", "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    await client.put(f"{URL}/enrollment", headers=h, json={"book_id": "junior", "order_mode": "book"})
    return h


async def ans(client, h, **body):
    return await client.post(f"{URL}/answers", headers=h,
                             json={"book_id": "junior", "tz_offset_minutes": NOW_OFFSET, **body})


def task(me: dict, key: str) -> dict:
    return next(t for t in me["stage_tasks"] if t["key"] == key)


async def me(client, h) -> dict:
    r = await client.get("/api/rank/me", headers=h, params={"tz_offset_minutes": NOW_OFFSET})
    assert r.status_code == 200, r.text
    return r.json()


async def test_wrong_answers_on_a_word_that_is_not_due_cannot_complete_vocab_reviews(app, client, tmp_path):
    """The reviewer's scenario: alternate a wrong review answer on one not-due word with GET /api/rank/me."""
    h = await login(app, client, tmp_path)
    assert (await ans(client, h, key="talk", mode="learn", qtype="meaning", known=True)).status_code == 200
    assert task(await me(client, h), "vocab_reviews")["target"] == 10
    for _ in range(12):
        r = (await ans(client, h, key="talk", mode="review", qtype="word", choice="stop")).json()
        assert r["grade"] == "forgot"
        done = task(await me(client, h), "vocab_reviews")
    assert done["done"] <= 1 and done["complete"] is False
    async with app.state.sessionmaker() as s:
        row = (await s.scalars(select(VocabularyItem).where(VocabularyItem.word == "talk"))).one()
        assert (row.box, row.reps, row.last_reviewed_at) == (0, 0, None)  # the lapse still resets the box
        assert (await s.scalars(select(XpEvent).where(XpEvent.kind == "vocab_review"))).all() == []


async def test_first_wrong_answer_on_a_not_due_word_lapses_it_once(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    await ans(client, h, key="talk", mode="learn", qtype="meaning", known=True)
    first = (await ans(client, h, key="talk", mode="review", qtype="word", choice="stop")).json()
    assert (first["grade"], first["applied"], first["item"]["box"]) == ("forgot", True, 0)
    again = (await ans(client, h, key="talk", mode="review", qtype="word", choice="stop")).json()
    assert (again["grade"], again["applied"]) == ("forgot", False)  # already box 0: nothing to change
    async with app.state.sessionmaker() as s:
        row = (await s.scalars(select(VocabularyItem).where(VocabularyItem.word == "talk"))).one()
        assert (row.lapses, row.reps) == (1, 0)


async def test_capped_zero_point_events_do_not_advance_stage_tasks(app, client, tmp_path, monkeypatch):
    """Events the daily cap trims to 0 points stay as rows, but they must not count for a stage task."""
    monkeypatch.setitem(points.STAGE_TASKS, 0, (StageTask("words", "words_learned", 3),))
    h = await login(app, client, tmp_path, rank_daily_rp_cap=2)
    for key in ("talk", "ability", "able", "abandon"):
        assert (await ans(client, h, key=key, mode="learn", qtype="meaning", known=True)).status_code == 200
    body = await me(client, h)
    words = task(body, "words")
    assert (words["done"], words["complete"]) == (2, False)
    async with app.state.sessionmaker() as s:
        pts = (await s.scalars(select(XpEvent.points).where(XpEvent.kind == "word_learned")
                               .order_by(XpEvent.created_at))).all()
        assert sorted(pts) == [0, 0, 1, 1]


async def test_rules_that_give_a_kind_zero_points_still_count_it(app):
    """A kind the published rules value at 0 points is not 'trimmed': its rows still count."""
    from datetime import datetime, timezone

    from app.models import RankProfile, User
    from app.rank.rules import DEFAULT_RULES

    now = datetime(2026, 11, 10, 9, 0, tzinfo=timezone.utc)
    custom = DEFAULT_RULES.model_copy(update={"points": DEFAULT_RULES.points.model_copy(update={"vocab_review": 0})})
    async with app.state.sessionmaker() as s:
        s.add(User(id=10000031, username="z", password_hash="x"))
        s.add(RankProfile(user_id=10000031, tier=0, division=3, rp=0, stars=0, best_tier=0, tier_started_at=now,
                          updated_at=now))
        for i in range(10):
            s.add(XpEvent(user_id=10000031, kind="vocab_review", ref_id=f"r{i}", points=0, score=None,
                          day="2026-11-10", tier=0, created_at=now))
        await s.commit()
        profile = await s.get(RankProfile, 10000031)
        tasks = await ledger.stage_progress_for(s, profile, rules=custom)
    assert next(t for t in tasks if t.key == "vocab_reviews").complete is True
