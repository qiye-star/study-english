"""Golden outputs of the Leitner scheduling BEFORE the FSRS change (L3 Task 1, plan R2 / flag-off guarantee).

The fixture `fixtures/leitner_golden.json` was recorded from the unmodified `app.services.vocabulary`.
Any change to Leitner results must be deliberate: re-record with `GOLDEN_UPDATE=1` and say why in the commit.
"""
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import select

from app.models import VocabularyItem
from app.services.vocabulary import apply_lapse, apply_review, next_review

GOLDEN = Path(__file__).parent / "fixtures" / "leitner_golden.json"

NOWS = {
    "utc": datetime(2026, 10, 5, 12, 0, tzinfo=timezone.utc),
    "cst": datetime(2026, 10, 5, 20, 0, tzinfo=timezone(timedelta(hours=8))),
    "micro": datetime(2026, 10, 5, 12, 0, 0, 123456, tzinfo=timezone.utc),
}
BOXES = range(-1, 7)
GRADES = ("forgot", "hard", "good")


def _pure_rows() -> list[dict]:
    rows = []
    for label, now in NOWS.items():
        for box in BOXES:
            for grade in GRADES:
                r = next_review(box, grade, now)
                rows.append({
                    "now": label, "box": box, "grade": grade,
                    "box_out": r.box, "due_at": r.due_at.isoformat(), "lapsed": r.lapsed,
                })
    return rows


def _naive_utc(value: datetime | None) -> str | None:
    """SQLite returns naive datetimes; store a canonical UTC wall-clock string for comparison."""
    if value is None:
        return None
    if value.tzinfo is not None:
        value = value.astimezone(timezone.utc).replace(tzinfo=None)
    return value.isoformat()


T = NOWS["utc"]
DAY = timedelta(days=1)


def _item(item_id: str, user_id: int, *, box: int, reps: int, lapses: int,
          due_at: datetime, last_reviewed_at: datetime | None) -> VocabularyItem:
    return VocabularyItem(
        id=item_id, user_id=user_id, word="golden", meaning="", example=None, source="manual",
        box=box, due_at=due_at, reps=reps, lapses=lapses, last_reviewed_at=last_reviewed_at,
        created_at=T - 30 * DAY,
    )


async def _register(client) -> int:
    r = await client.post("/api/users", json={"username": "golden", "password": "password123"})
    return int(r.json()["id"])


async def _db_rows(app, user_id: int) -> dict:
    """Run the six recorded DB scenarios on one SQLite database and return what each one wrote."""
    scenarios = {
        # (item_id, starting row, call) -> the call returns True/False; we record the row afterwards
        "due_good": ("00000000-0000-0000-0000-000000000001",
                     dict(box=2, reps=3, lapses=1, due_at=T - timedelta(hours=1), last_reviewed_at=T - 5 * DAY),
                     lambda s, i: apply_review(s, user_id, i, seen_box=2, seen_reps=3, grade="good", now=T)),
        "due_hard": ("00000000-0000-0000-0000-000000000002",
                     dict(box=3, reps=5, lapses=0, due_at=T - timedelta(hours=1), last_reviewed_at=T - 15 * DAY),
                     lambda s, i: apply_review(s, user_id, i, seen_box=3, seen_reps=5, grade="hard", now=T)),
        "due_forgot": ("00000000-0000-0000-0000-000000000003",
                       dict(box=4, reps=2, lapses=0, due_at=T - timedelta(hours=1), last_reviewed_at=T - 7 * DAY),
                       lambda s, i: apply_review(s, user_id, i, seen_box=4, seen_reps=2, grade="forgot", now=T)),
        "notdue_forgot": ("00000000-0000-0000-0000-000000000004",
                          dict(box=3, reps=4, lapses=2, due_at=T + 3 * DAY, last_reviewed_at=T - 2 * DAY),
                          lambda s, i: apply_lapse(s, user_id, i, seen_box=3, seen_reps=4, now=T)),
        "box0_lapse": ("00000000-0000-0000-0000-000000000005",
                       dict(box=0, reps=1, lapses=1, due_at=T + 1 * DAY, last_reviewed_at=T - 1 * DAY),
                       lambda s, i: apply_lapse(s, user_id, i, seen_box=0, seen_reps=1, now=T)),
    }
    out: dict[str, dict] = {}
    for name, (item_id, start, call) in scenarios.items():
        async with app.state.sessionmaker() as s:
            s.add(_item(item_id, user_id, **start))
            await s.commit()
        async with app.state.sessionmaker() as s:
            ok = await call(s, item_id)
            await s.commit()
        out[name] = {"returned": ok, "row": await _row(app, item_id)}

    # repeated submission: the same seen_reps twice; the second must be a no-op
    rid = "00000000-0000-0000-0000-000000000006"
    async with app.state.sessionmaker() as s:
        s.add(_item(rid, user_id, box=1, reps=7, lapses=0, due_at=T - timedelta(hours=1), last_reviewed_at=T - 2 * DAY))
        await s.commit()
    returns = []
    for _ in range(2):
        async with app.state.sessionmaker() as s:
            returns.append(await apply_review(s, user_id, rid, seen_box=1, seen_reps=7, grade="good", now=T))
            await s.commit()
    out["repeat_submit"] = {"returned": returns, "row": await _row(app, rid)}
    return out


async def _row(app, item_id: str) -> dict:
    async with app.state.sessionmaker() as s:
        item = (await s.execute(select(VocabularyItem).where(VocabularyItem.id == item_id))).scalar_one()
        return {
            "box": item.box,
            "due_at": _naive_utc(item.due_at),
            "reps": item.reps,
            "lapses": item.lapses,
            "last_reviewed_at": _naive_utc(item.last_reviewed_at),
        }


async def test_pure_next_review_matches_the_recorded_leitner_outputs():
    rows = _pure_rows()
    if os.environ.get("GOLDEN_UPDATE") == "1":
        _write_section("pure", rows)
    recorded = json.loads(GOLDEN.read_text(encoding="utf-8"))
    assert rows == recorded["pure"]


def _write_section(key: str, value) -> None:
    data = json.loads(GOLDEN.read_text(encoding="utf-8")) if GOLDEN.exists() else {}
    data[key] = value
    GOLDEN.parent.mkdir(parents=True, exist_ok=True)
    GOLDEN.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


async def test_db_apply_review_and_lapse_match_the_recorded_rows(client, app):
    user_id = await _register(client)
    rows = await _db_rows(app, user_id)
    if os.environ.get("GOLDEN_UPDATE") == "1":
        _write_section("db", rows)
    recorded = json.loads(GOLDEN.read_text(encoding="utf-8"))
    assert rows == recorded["db"]
    # the six scenarios are the ones the plan asks for; the recorded values must encode the Leitner rules
    assert rows["due_good"]["row"]["box"] == 3 and rows["due_good"]["row"]["reps"] == 4
    assert rows["due_forgot"]["row"]["box"] == 0 and rows["due_forgot"]["row"]["lapses"] == 1
    assert rows["notdue_forgot"]["row"]["reps"] == 4  # a lapse is not a review
    assert rows["box0_lapse"]["returned"] is False
    assert rows["repeat_submit"]["returned"] == [True, False]
