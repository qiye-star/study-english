"""Easy, the event timestamp and set_learn_box's FSRS reset (L3 Task 8, plan R5, R6, R8).

The answer endpoint's `grade` field stays three-valued; Easy only reaches the scheduler.
"""
import pytest
from sqlalchemy import select, update

from app.models import VocabularyItem, WordbookEvent, utcnow
from app.services.stats import as_utc
from app.wordbook import store
from app.wordbook.grading import EASY_BASE_MS, EASY_PER_CHAR_MS, event_grade, review_grade
from tests.test_wordbook_learn import TALK_MEANING, ans, login, make_due, pin_qtypes
from tests.wordbook_helpers import enable_wordbook, make_data_dir

URL = "/api/wordbook"


# ---- pure mapping ----

@pytest.mark.parametrize("qtype", ["spell", "dictation"])
def test_fast_clean_typed_answer_is_easy(qtype):
    limit = EASY_BASE_MS + EASY_PER_CHAR_MS * 4
    assert review_grade("correct", False, qtype=qtype, elapsed_ms=limit, length=4) == "easy"
    assert review_grade("correct", False, qtype=qtype, elapsed_ms=limit + 1, length=4) == "good"


def test_the_limit_grows_with_the_word_length():
    limit_14 = EASY_BASE_MS + EASY_PER_CHAR_MS * 14  # 7900 ms
    assert review_grade("correct", False, qtype="spell", elapsed_ms=limit_14, length=14) == "easy"
    assert review_grade("correct", False, qtype="spell", elapsed_ms=limit_14 + 1, length=14) == "good"
    assert review_grade("correct", False, qtype="spell", elapsed_ms=limit_14, length=4) == "good"  # 4400 ms limit


@pytest.mark.parametrize("outcome,hinted,qtype,elapsed", [
    ("correct", True, "spell", 100),      # hinted
    ("typo", False, "spell", 100),        # a small slip is not a clean answer
    ("inflection", False, "spell", 100),
    ("wrong", False, "spell", 100),
    ("correct", False, "spell", None),    # no timing, no Easy
    ("correct", False, "word", 100),      # choice questions never get Easy
    ("correct", False, "spell_ctx", 100),  # sentence spelling never gets Easy
])
def test_everything_else_keeps_the_three_value_rule(outcome, hinted, qtype, elapsed):
    from app.wordbook.grading import srs_grade
    assert review_grade(outcome, hinted, qtype=qtype, elapsed_ms=elapsed, length=4) == srs_grade(outcome, hinted)


@pytest.mark.parametrize("qtype,outcome,credit,expected", [
    ("spell", "correct", 100, "good"),
    ("spell", "correct", 50, "hard"),
    ("spell", "typo", 50, "hard"),
    ("spell", "inflection", 50, "hard"),
    ("spell", "wrong", 0, "forgot"),
    ("meaning", "know", 100, "good"),
    ("meaning", "know_chk", 100, "good"),
    ("recall", "fuzzy", 0, "hard"),
    ("recall", "unknown", 0, "forgot"),
    ("practice", "pending", 0, None),
])
def test_event_grade_reads_the_rating_back(qtype, outcome, credit, expected):
    assert event_grade(qtype, outcome, credit) == expected


# ---- through the answer endpoint ----

async def _enrolled(client, name: str):
    r = await client.post("/api/users", json={"username": name, "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    await client.put(f"{URL}/enrollment", headers=h, json={"book_id": "junior", "order_mode": "book"})
    return h, int(r.json()["id"])


async def test_a_fast_typed_correct_review_is_easy_at_full_rollout(app, client, tmp_path, monkeypatch):
    enable_wordbook(app, make_data_dir(tmp_path), wordbook_fsrs_pct=100)
    pin_qtypes(monkeypatch, {"talk": "spell"})
    fast_h, fast_uid = await _enrolled(client, "fast_user")
    slow_h, slow_uid = await _enrolled(client, "slow_user")
    for h in (fast_h, slow_h):
        await ans(client, h, key="talk", mode="learn", qtype="meaning", choice=TALK_MEANING)
    await make_due(app, "talk")
    fast = (await ans(client, fast_h, key="talk", mode="review", qtype="spell", typed="talk", elapsed_ms=2000)).json()
    slow = (await ans(client, slow_h, key="talk", mode="review", qtype="spell", typed="talk", elapsed_ms=60000)).json()
    assert (fast["grade"], slow["grade"]) == ("good", "good")  # the response stays three-valued
    async with app.state.sessionmaker() as s:
        rows = (await s.execute(select(VocabularyItem.user_id, VocabularyItem.stability)
                                .where(VocabularyItem.word == "talk"))).all()
    stability = {uid: st for uid, st in rows}
    assert stability[fast_uid] > stability[slow_uid]  # Easy grows the stability more than Good


async def test_reviewed_at_is_set_only_when_the_schedule_changed(app, client, tmp_path, monkeypatch):
    h = await login(app, client, tmp_path)
    pin_qtypes(monkeypatch, {"talk": "spell"})
    await ans(client, h, key="talk", mode="learn", qtype="meaning", choice=TALK_MEANING)
    await make_due(app, "talk")
    before = utcnow()
    due = (await ans(client, h, key="talk", mode="review", qtype="spell", typed="talk")).json()
    assert due["applied"] is True
    not_due = (await ans(client, h, key="talk", mode="review", qtype="spell", typed="talk")).json()
    assert not_due["applied"] is False  # not due any more: a practice answer
    async with app.state.sessionmaker() as s:
        events = (await s.scalars(select(WordbookEvent).where(WordbookEvent.word == "talk")
                                  .order_by(WordbookEvent.id))).all()
    review_event, practice_event = events[-2], events[-1]
    assert (review_event.kind, practice_event.kind) == ("review", "practice")
    assert review_event.reviewed_at is not None and as_utc(review_event.reviewed_at) >= before
    assert practice_event.reviewed_at is None


async def test_set_learn_box_clears_the_fsrs_columns(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    r = await client.post("/api/vocabulary", headers=h, json={"word": "orchard", "source": "manual"})
    item_id = r.json()["id"]
    async with app.state.sessionmaker() as s:
        await s.execute(update(VocabularyItem).where(VocabularyItem.id == item_id)
                        .values(stability=6.5, difficulty=3.0, fsrs_state=2, last_review=utcnow()))
        await s.commit()
    async with app.state.sessionmaker() as s:
        owner, box = (await s.execute(select(VocabularyItem.user_id, VocabularyItem.box)
                                      .where(VocabularyItem.id == item_id))).one()
        ok = await store.set_learn_box(s, owner, item_id, seen_box=box, to_box=box + 1, now=utcnow())
        await s.commit()
    assert ok is True  # reps = 0, so this is the same-day box move, not a review
    async with app.state.sessionmaker() as s:
        row = (await s.execute(select(VocabularyItem.stability, VocabularyItem.difficulty, VocabularyItem.fsrs_state,
                                      VocabularyItem.last_review).where(VocabularyItem.id == item_id))).one()
    assert tuple(row) == (None, None, None, None)
