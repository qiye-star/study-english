"""apply_review / apply_lapse through the scheduling port (L3 Task 6, plan R2, R6, R11).

Default policy is Leitner: box and due_at must match the golden rows, and the FSRS columns are written as a shadow.
"""
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.models import VocabularyItem
from app.services.scheduling import LEITNER, SchedulingPolicy, SrsSnapshot, decide, derive_box, next_review
from app.services.vocabulary import apply_lapse, apply_review

T = datetime(2026, 10, 5, 12, 0, tzinfo=timezone.utc)
DAY = timedelta(days=1)
FSRS = SchedulingPolicy("fsrs", 0.9)


def _naive(value):
    if value is None:
        return None
    if value.tzinfo is not None:
        value = value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


async def _register(client) -> int:
    r = await client.post("/api/users", json={"username": "srs", "password": "password123"})
    return int(r.json()["id"])


async def _seed(app, user_id: int, item_id: str, **cols) -> None:
    base = dict(box=0, reps=0, lapses=0, due_at=T - timedelta(hours=1), last_reviewed_at=None,
                created_at=T - 30 * DAY, stability=None, difficulty=None, fsrs_state=None, last_review=None)
    base.update(cols)
    async with app.state.sessionmaker() as s:
        s.add(VocabularyItem(id=item_id, user_id=user_id, word=item_id, meaning="", example=None, source="manual",
                             **base))
        await s.commit()


async def _row(app, item_id: str) -> dict:
    async with app.state.sessionmaker() as s:
        item = (await s.execute(select(VocabularyItem).where(VocabularyItem.id == item_id))).scalar_one()
        return {
            "box": item.box, "due_at": _naive(item.due_at), "reps": item.reps, "lapses": item.lapses,
            "last_reviewed_at": _naive(item.last_reviewed_at), "stability": item.stability,
            "difficulty": item.difficulty, "fsrs_state": item.fsrs_state, "last_review": _naive(item.last_review),
        }


async def _review(app, user_id, item_id, *, seen_box, seen_reps, grade, now=T, policy=None):
    async with app.state.sessionmaker() as s:
        kwargs = {} if policy is None else {"policy": policy}
        ok = await apply_review(s, user_id, item_id, seen_box=seen_box, seen_reps=seen_reps, grade=grade, now=now,
                                **kwargs)
        await s.commit()
        return ok


async def _lapse(app, user_id, item_id, *, seen_box, seen_reps, now=T, policy=None):
    async with app.state.sessionmaker() as s:
        kwargs = {} if policy is None else {"policy": policy}
        ok = await apply_lapse(s, user_id, item_id, seen_box=seen_box, seen_reps=seen_reps, now=now, **kwargs)
        await s.commit()
        return ok


def _snap(box, *, last_reviewed_at=None, created_at=T - 30 * DAY, stability=None, difficulty=None, fsrs_state=None,
          last_review=None) -> SrsSnapshot:
    return SrsSnapshot(box=box, stability=stability, difficulty=difficulty, fsrs_state=fsrs_state,
                       last_review=last_review, last_reviewed_at=last_reviewed_at, created_at=created_at)


async def test_default_review_matches_leitner_and_writes_the_shadow_state(client, app):
    uid = await _register(client)
    await _seed(app, uid, "a", box=2, reps=3, lapses=1, last_reviewed_at=T - 5 * DAY)
    assert await _review(app, uid, "a", seen_box=2, seen_reps=3, grade="good") is True
    row = await _row(app, "a")
    expected = decide(LEITNER, _snap(2, last_reviewed_at=T - 5 * DAY), "good", T)
    assert (row["box"], row["due_at"], row["reps"], row["lapses"]) == (3, _naive(T + 7 * DAY), 4, 1)
    assert row["last_reviewed_at"] == _naive(T)
    assert (row["stability"], row["difficulty"], row["fsrs_state"], row["last_review"]) == (
        expected.fsrs.stability, expected.fsrs.difficulty, 2, _naive(T))


async def test_the_same_seen_reps_twice_writes_once_and_the_second_is_false(client, app):
    uid = await _register(client)
    await _seed(app, uid, "b", box=1, reps=7, last_reviewed_at=T - 2 * DAY)
    assert await _review(app, uid, "b", seen_box=1, seen_reps=7, grade="good") is True
    once = await _row(app, "b")
    assert await _review(app, uid, "b", seen_box=1, seen_reps=7, grade="good") is False
    assert await _row(app, "b") == once


async def test_a_stale_read_writes_no_column_including_the_fsrs_ones(client, app):
    uid = await _register(client)
    await _seed(app, uid, "c", box=4, reps=9, last_reviewed_at=T - 15 * DAY)
    before = await _row(app, "c")
    assert await _review(app, uid, "c", seen_box=4, seen_reps=5, grade="good") is False
    assert await _row(app, "c") == before


async def test_another_user_cannot_review_the_row(client, app):
    uid = await _register(client)
    await _seed(app, uid, "d", box=2, reps=2)
    before = await _row(app, "d")
    assert await _review(app, uid + 999, "d", seen_box=2, seen_reps=2, grade="good") is False
    assert await _row(app, "d") == before


async def test_easy_under_leitner_moves_the_row_like_good(client, app):
    uid = await _register(client)
    await _seed(app, uid, "e1", box=2, reps=3, last_reviewed_at=T - 5 * DAY)
    await _seed(app, uid, "e2", box=2, reps=3, last_reviewed_at=T - 5 * DAY)
    await _review(app, uid, "e1", seen_box=2, seen_reps=3, grade="easy")
    await _review(app, uid, "e2", seen_box=2, seen_reps=3, grade="good")
    a, b = await _row(app, "e1"), await _row(app, "e2")
    assert (a["box"], a["due_at"], a["reps"]) == (b["box"], b["due_at"], b["reps"])


async def test_fsrs_engine_takes_box_and_due_from_the_shadow_state(client, app):
    uid = await _register(client)
    await _seed(app, uid, "f", box=3, reps=4, last_reviewed_at=T - 15 * DAY)
    assert await _review(app, uid, "f", seen_box=3, seen_reps=4, grade="good", policy=FSRS) is True
    row = await _row(app, "f")
    expected = decide(FSRS, _snap(3, last_reviewed_at=T - 15 * DAY), "good", T)
    assert row["box"] == derive_box(expected.fsrs.stability) == expected.box
    assert row["due_at"] == _naive(expected.due_at)
    assert (row["reps"], row["last_reviewed_at"], row["lapses"]) == (5, _naive(T), 0)


async def test_fsrs_forgot_counts_a_lapse(client, app):
    uid = await _register(client)
    await _seed(app, uid, "g", box=3, reps=4, last_reviewed_at=T - 15 * DAY)
    assert await _review(app, uid, "g", seen_box=3, seen_reps=4, grade="forgot", policy=FSRS) is True
    row = await _row(app, "g")
    assert (row["lapses"], row["reps"]) == (1, 5)


async def test_switching_back_to_leitner_continues_from_the_derived_box(client, app):
    uid = await _register(client)
    await _seed(app, uid, "h", box=3, reps=4, last_reviewed_at=T - 15 * DAY)
    assert await _review(app, uid, "h", seen_box=3, seen_reps=4, grade="good", policy=FSRS) is True
    fsrs_row = await _row(app, "h")
    derived = fsrs_row["box"]
    later = T + 2 * DAY
    assert await _review(app, uid, "h", seen_box=derived, seen_reps=5, grade="good", now=later) is True
    row = await _row(app, "h")
    assert row["box"] == next_review(derived, "good", later).box
    assert row["due_at"] == _naive(next_review(derived, "good", later).due_at)
    assert row["stability"] != fsrs_row["stability"]  # the shadow keeps moving under Leitner too
    assert row["fsrs_state"] == 2


async def test_a_lapse_under_leitner_goes_to_box_zero_and_keeps_reps(client, app):
    uid = await _register(client)
    await _seed(app, uid, "i", box=3, reps=4, lapses=1, last_reviewed_at=T - 2 * DAY, due_at=T + 3 * DAY)
    before = await _row(app, "i")
    assert await _lapse(app, uid, "i", seen_box=3, seen_reps=4) is True
    row = await _row(app, "i")
    expected = decide(LEITNER, _snap(3, last_reviewed_at=T - 2 * DAY), "forgot", T)
    assert (row["box"], row["due_at"], row["lapses"]) == (0, _naive(T + DAY), 2)
    assert (row["reps"], row["last_reviewed_at"]) == (before["reps"], before["last_reviewed_at"])
    assert (row["stability"], row["difficulty"]) == (expected.fsrs.stability, expected.fsrs.difficulty)


async def test_a_lapse_under_fsrs_uses_the_shadow_box_and_due(client, app):
    uid = await _register(client)
    await _seed(app, uid, "j", box=3, reps=4, last_reviewed_at=T - 2 * DAY, due_at=T + 3 * DAY)
    assert await _lapse(app, uid, "j", seen_box=3, seen_reps=4, policy=FSRS) is True
    row = await _row(app, "j")
    expected = decide(FSRS, _snap(3, last_reviewed_at=T - 2 * DAY), "forgot", T)
    assert (row["box"], row["due_at"]) == (expected.box, _naive(expected.due_at))
    assert row["reps"] == 4


async def test_a_box_zero_lapse_is_refused_and_writes_nothing(client, app):
    uid = await _register(client)
    await _seed(app, uid, "k", box=0, reps=1, lapses=1, last_reviewed_at=T - DAY, due_at=T + DAY)
    before = await _row(app, "k")
    assert await _lapse(app, uid, "k", seen_box=0, seen_reps=1) is False
    assert await _row(app, "k") == before


async def test_a_new_row_with_null_fsrs_columns_is_seeded_from_its_box(client, app):
    uid = await _register(client)
    await _seed(app, uid, "l", box=4, reps=6, last_reviewed_at=None, created_at=T - 40 * DAY)
    assert await _review(app, uid, "l", seen_box=4, seen_reps=6, grade="good") is True
    row = await _row(app, "l")
    expected = decide(LEITNER, _snap(4, created_at=T - 40 * DAY), "good", T)
    assert (row["stability"], row["fsrs_state"]) == (expected.fsrs.stability, 2)
    assert row["stability"] > 15.0  # seeded at 15 days, then one Good review grows it
