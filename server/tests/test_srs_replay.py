"""Offline replay (L3 Task 9, plan R12, R13): the pure core and the read-only CLI."""
import json
import math
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app.admin import fsrs_replay
from app.models import VocabularyItem, WordbookEvent
from app.services.srs_replay import Replay, ReplayEvent, replay
from tests.test_architecture import APP, logging_violations

T = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)
D = timedelta(days=1)


# ---- pure core ----

def test_one_good_review_is_predicted_before_it_is_scored():
    # start box 2 = stability 4 days. Four days later the implied recall is R(S = 4, 4 d) = 0.9, and that prediction
    # must come before the Good rating changes either engine.
    rep = replay([[ReplayEvent(T, "learn", start_box=2), ReplayEvent(T + 4 * D, "review", grade="good")]], [0.9])
    lei, fs = rep["engines"]["leitner"], rep["engines"]["fsrs_retention_90"]
    assert lei["reviews"] == 1 and fs["reviews"] == 1
    assert lei["mean_predicted_recall"] == pytest.approx(0.9, abs=1e-6)
    assert fs["mean_predicted_recall"] == pytest.approx(0.9, abs=1e-6)
    assert lei["log_loss"] == pytest.approx(-math.log(0.9), abs=1e-6)
    assert lei["brier"] == pytest.approx(0.01, abs=1e-6)


def test_a_forgot_is_an_outcome_of_zero():
    rep = replay([[ReplayEvent(T, "learn", start_box=2), ReplayEvent(T + 4 * D, "review", grade="forgot")]], [0.9])
    lei = rep["engines"]["leitner"]
    assert lei["actual_recall_rate"] == 0.0
    assert lei["log_loss"] == pytest.approx(-math.log(0.1), abs=1e-6)
    assert lei["brier"] == pytest.approx(0.81, abs=1e-6)


def test_calibration_counts_add_up_to_the_reviews():
    rep = replay([[ReplayEvent(T, "learn", start_box=2), ReplayEvent(T + 4 * D, "review", grade="good")],
                  [ReplayEvent(T, "learn", start_box=0), ReplayEvent(T + D, "review", grade="forgot")]], [0.9])
    cal = rep["engines"]["leitner"]["calibration"]
    assert len(cal) == 10 and sum(b["reviews"] for b in cal) == rep["reviews"] == 2
    # Both reviews come exactly one interval after their start: R(S, S days) = 0.9 by the FSRS definition, so both fall
    # in the 0.9-1.0 bin (int(0.9 * 10) == 9).
    assert cal[9]["reviews"] == 2 and cal[9]["actual"] == 0.5


def test_constant_baseline_is_the_global_rate():
    rep = replay([[ReplayEvent(T, "learn", start_box=2), ReplayEvent(T + 4 * D, "review", grade="good")],
                  [ReplayEvent(T, "learn", start_box=0), ReplayEvent(T + D, "review", grade="forgot")]], [0.9])
    base = rep["baseline_constant"]
    assert base["constant_rate"] == 0.5
    assert base["log_loss"] == pytest.approx(math.log(2), abs=1e-6)
    assert base["brier"] == pytest.approx(0.25, abs=1e-6)


def test_leitner_intervals_follow_next_review():
    # box 0, Good at +1 d -> box 1, due +2 d; Good at +3 d -> box 2, due +4 d. Mean of 2 and 4.
    rep = replay([[ReplayEvent(T, "learn", start_box=0), ReplayEvent(T + D, "review", grade="good"),
                   ReplayEvent(T + 3 * D, "review", grade="good")]], [0.9])
    assert rep["engines"]["leitner"]["mean_next_interval_days"] == pytest.approx(3.0, abs=1e-6)


def test_items_without_a_start_box_are_skipped_and_non_reviews_do_not_count():
    rep = replay([
        [ReplayEvent(T, "review", grade="good")],  # no start box: skipped
        [ReplayEvent(T, "learn", start_box=1), ReplayEvent(T + D, "practice", grade="forgot")],  # not scheduled
    ], [0.9])
    assert (rep["skipped_items"], rep["items"], rep["reviews"]) == (1, 1, 0)
    assert rep["engines"]["leitner"] == {"reviews": 0}


def test_higher_retention_means_a_longer_interval_and_the_same_predictions():
    rep = replay([[ReplayEvent(T, "learn", start_box=2), ReplayEvent(T + 4 * D, "review", grade="good")]],
                 [0.85, 0.95])
    f85, f95 = rep["engines"]["fsrs_retention_85"], rep["engines"]["fsrs_retention_95"]
    assert f95["mean_next_interval_days"] < f85["mean_next_interval_days"]
    assert f95["mean_predicted_recall"] == f85["mean_predicted_recall"]  # stability does not depend on retention


def test_the_same_history_gives_the_same_report():
    history = [[ReplayEvent(T, "learn", start_box=2), ReplayEvent(T + 4 * D, "review", grade="good"),
                ReplayEvent(T + 10 * D, "review", grade="hard")]]
    assert replay(history, [0.9]) == replay(history, [0.9])


def test_the_accumulator_matches_the_one_shot_helper():
    history = [[ReplayEvent(T, "learn", start_box=1), ReplayEvent(T + 2 * D, "review", grade="good")]]
    acc = Replay([0.9])
    for h in history:
        acc.add(h)
    assert acc.report() == replay(history, [0.9])


def test_the_core_module_does_not_log():
    assert logging_violations(APP, ("services/srs_replay.py",)) == []


def test_the_cli_module_does_not_log():
    assert logging_violations(APP, ("admin/fsrs_replay.py",)) == []


# ---- CLI (read-only; the database is the fixture's SQLite) ----

async def _user(client, name: str) -> int:
    r = await client.post("/api/users", json={"username": name, "password": "password123"})
    return int(r.json()["id"])


def _event(user_id, item_id, kind, qtype, outcome, credit, when):
    return WordbookEvent(user_id=user_id, book_id="junior", kind=kind, word="zyzzyva", item_id=item_id, qtype=qtype,
                         outcome=outcome, credit=credit, day="2026-10-01", created_at=when)


async def _seed_history(app, client):
    a, b = await _user(client, "replay_a"), await _user(client, "replay_b")
    item_a, item_b = "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"
    async with app.state.sessionmaker() as s:
        s.add_all([
            _event(a, item_a, "learn", "meaning", "correct", 100, T),
            _event(a, item_a, "review", "spell", "correct", 100, T + 2 * D),
            _event(a, item_a, "review", "spell", "wrong", 0, T + 6 * D),
            _event(b, item_b, "learn", "recall", "know", 100, T),
            _event(b, item_b, "review", "recall", "fuzzy", 0, T + 5 * D),
            _event(b, item_b, "practice", "spell", "wrong", 0, T + 6 * D),
        ])
        s.add(VocabularyItem(id=item_a, user_id=a, word="zyzzyva", meaning="", example=None, source="manual", box=0,
                             due_at=T, reps=0, lapses=0, created_at=T))
        await s.commit()
    return a, b


async def _counts(app) -> tuple:
    async with app.state.sessionmaker() as s:
        events = await s.scalar(select(func.count()).select_from(WordbookEvent))
        items = await s.scalar(select(func.count()).select_from(VocabularyItem))
        box_sum = await s.scalar(select(func.sum(VocabularyItem.box)))
    return events, items, box_sum


async def test_the_report_counts_reviews_and_leaks_no_word_or_id(app, client):
    await _seed_history(app, client)
    report = await fsrs_replay.build_report(app.state.sessionmaker, since=None, retentions=[90])
    assert (report["items"], report["reviews"], report["skipped_items"]) == (2, 3, 0)
    text = json.dumps(report)
    assert "zyzzyva" not in text
    assert "11111111" not in text and "22222222" not in text
    assert "item_id" not in text and "user_id" not in text


async def test_the_cli_prints_json_and_only_reads(app, client, tmp_path, monkeypatch, capsys, caplog):
    await _seed_history(app, client)
    monkeypatch.setattr(fsrs_replay, "_sessionmaker", lambda: app.state.sessionmaker)
    before = await _counts(app)
    out = tmp_path / "replay.json"
    rc = await fsrs_replay._main(["--retention", "85,90,95", "--out", str(out)])
    assert rc == 0
    printed = capsys.readouterr().out
    report = json.loads(printed)
    assert set(report["engines"]) == {"leitner", "fsrs_retention_85", "fsrs_retention_90", "fsrs_retention_95"}
    assert json.loads(out.read_text(encoding="utf-8")) == report
    assert "zyzzyva" not in printed and "11111111" not in printed
    assert "zyzzyva" not in caplog.text
    assert await _counts(app) == before  # nothing written


async def test_the_cli_refuses_retention_outside_the_setting_range(app, client, monkeypatch):
    monkeypatch.setattr(fsrs_replay, "_sessionmaker", lambda: app.state.sessionmaker)
    with pytest.raises(SystemExit):
        await fsrs_replay._main(["--retention", "84"])
    with pytest.raises(SystemExit):
        await fsrs_replay._main(["--retention", "90,abc"])
