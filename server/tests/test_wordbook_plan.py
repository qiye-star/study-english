from datetime import datetime, timedelta, timezone

from app.wordbook.plan import (Known, compute_plan, count_due_before, day_end, due_keys, next_new, permutation,
                               progress_of)

NOW = datetime(2026, 10, 10, 9, 0, tzinfo=timezone.utc)


def k(box, days=0, reps=1):
    return Known("id", box, NOW + timedelta(days=days), reps, "wordbook:junior")


def test_compute_plan_caps_and_backlog_guard():
    p = compute_plan(daily_new=20, review_cap=100, new_done=3, review_done=10, review_due=40)
    assert (p.new_left, p.review_left, p.backlog_guard) == (17, 40, False)
    p = compute_plan(daily_new=20, review_cap=100, new_done=0, review_done=95, review_due=140)
    assert (p.new_left, p.review_left, p.backlog_guard) == (5, 5, True)
    assert compute_plan(daily_new=20, review_cap=100, new_done=25, review_done=0, review_due=0).new_left == 0


def test_progress_and_due_order():
    keys = ("a", "b", "c", "d")
    known = {"a": k(4, -1), "b": k(0, -3), "c": k(1, 2), "x": k(5, -9)}
    assert progress_of(keys, known).__dict__ == {"words": 4, "learned": 3, "mastered": 1, "remaining": 1}
    assert due_keys(keys, known, NOW, 10) == ["b", "a"] and due_keys(keys, known, NOW, 1) == ["b"]
    assert due_keys(keys, known, NOW, 0) == []
    assert count_due_before(keys, known, day_end(NOW, 480, 1)) == 2  # c 在后天到期


def test_due_ties_break_on_lower_box():
    known = {"a": k(3, -1), "b": k(1, -1)}
    assert due_keys(("a", "b"), known, NOW, 5) == ["b", "a"]


def test_day_end_uses_local_midnight():
    assert day_end(NOW, 480) == datetime(2026, 10, 10, 16, 0, tzinfo=timezone.utc)  # 北京时间 10-11 00:00
    assert day_end(NOW, 480, 1) == datetime(2026, 10, 11, 16, 0, tzinfo=timezone.utc)
    assert day_end(datetime(2026, 10, 10, 20, 0, tzinfo=timezone.utc), 480) == datetime(2026, 10, 11, 16, 0, tzinfo=timezone.utc)
    assert day_end(NOW, -300) == datetime(2026, 10, 11, 5, 0, tzinfo=timezone.utc)  # UTC-5


def test_permutation_and_next_new():
    assert permutation(5, 1, "book") == [0, 1, 2, 3, 4]
    shuffled = permutation(50, 7, "shuffle")
    assert sorted(shuffled) == list(range(50)) and shuffled == permutation(50, 7, "shuffle") != list(range(50))
    keys = ("a", "b", "c", "d", "e")
    assert next_new(keys, [0, 1, 2, 3, 4], 0, {"a": k(0), "c": k(0)}, 2) == (["b", "d"], 1)
    assert next_new(keys, [0, 1, 2, 3, 4], 0, {"a": k(0), "b": k(0)}, 0) == ([], 2)
    assert next_new(keys, [0, 1, 2, 3, 4], 9, {}, 3) == ([], 5)
