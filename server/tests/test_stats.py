from datetime import date, datetime, timedelta, timezone

from app.stats import AssessmentRow, MessageRow, aggregate, local_date, local_midnight_utc, poor_words, streak, window

UTC = timezone.utc
NOW = datetime(2026, 10, 5, 3, 0, tzinfo=UTC)  # UTC 03:00;UTC+8 时为当天 11:00
TODAY = date(2026, 10, 5)


def grammar(*categories):
    return {"has_errors": True, "corrected": "x", "errors": [{"original": "a", "corrected": "b", "category": c, "explanation": ""} for c in categories]}


def word(w, score, kind="None"):
    return {"word": w, "pronunciation_assessment": {"accuracy_score": score, "error_type": kind}}


def result(*words):
    return {"detail_result": {"words": list(words)}}


def run(**kw):
    base = dict(now=NOW, days=7, offset_minutes=0, messages=[], assessments=[], poor_results=[], truncated=False)
    return aggregate(**{**base, **kw})


def test_local_dates_and_window():
    assert local_date(datetime(2026, 10, 4, 17, 0, tzinfo=UTC), 480) == date(2026, 10, 5)
    assert local_date(datetime(2026, 10, 4, 17, 0, tzinfo=UTC), 0) == date(2026, 10, 4)
    assert local_date(datetime(2026, 10, 4, 17, 0), 0) == date(2026, 10, 4)  # SQLite 读回 naive(实为 UTC)
    assert window(NOW, 7, 0) == (date(2026, 9, 29), TODAY)
    assert local_midnight_utc(TODAY, 480) == datetime(2026, 10, 4, 16, 0, tzinfo=UTC)
    assert local_midnight_utc(TODAY, -300) == datetime(2026, 10, 5, 5, 0, tzinfo=UTC)


def test_streak():
    d = lambda n: TODAY - timedelta(days=n)  # noqa: E731
    assert streak({d(0), d(1), d(2)}, TODAY) == 3
    assert streak({d(1), d(2)}, TODAY) == 2  # 今天还没练不算断
    assert streak({d(0)}, TODAY) == 1
    assert streak({d(0), d(2)}, TODAY) == 1
    assert streak({d(2)}, TODAY) == 0
    assert streak(set(), TODAY) == 0


def test_empty_data():
    out = run()
    assert out["today"] == "2026-10-05" and out["days"] == 7 and out["tz_offset_minutes"] == 0
    assert [d["date"] for d in out["daily"]] == [(date(2026, 9, 29) + timedelta(days=i)).isoformat() for i in range(7)]
    assert all(d == {"date": d["date"], "active": False, "user_messages": 0, "assessments": 0, "speaking_seconds": 0.0, "avg_pronunciation": None}
               for d in out["daily"])
    assert (out["active_days"], out["streak_days"], out["user_messages"], out["assessments"]) == (0, 0, 0, 0)
    assert (out["speaking_seconds"], out["avg_pronunciation"], out["grammar_top"], out["poor_words"], out["truncated"]) == (0.0, None, [], [], False)


def test_counts_per_day_and_totals():
    at = lambda days_ago, hour=1: datetime(2026, 10, 5, hour, 0, tzinfo=UTC) - timedelta(days=days_ago)  # noqa: E731
    out = run(
        messages=[
            MessageRow(at(0), grammar("tense", "article")), MessageRow(at(0, 2), grammar("tense")),
            MessageRow(at(3), None), MessageRow(at(40), grammar("plural")),  # 40 天前:窗口外,不计入合计
        ],
        assessments=[
            AssessmentRow(at(0), 1500, {"pronunciation_score": 80}), AssessmentRow(at(0, 2), 2500, {"pronunciation_score": 90}),
            AssessmentRow(at(1), 1000, {"pronunciation_score": 70}), AssessmentRow(at(1, 2), None, {"pronunciation_score": None}),
            AssessmentRow(at(1, 3), 0, {"pronunciation_score": True}), AssessmentRow(at(1, 4), 0, {"pronunciation_score": float("nan")}),
        ],
    )
    today, yesterday, three_ago = out["daily"][-1], out["daily"][-2], out["daily"][-4]
    assert today == {"date": "2026-10-05", "active": True, "user_messages": 2, "assessments": 2, "speaking_seconds": 4.0, "avg_pronunciation": 85.0}
    assert (yesterday["assessments"], yesterday["avg_pronunciation"], yesterday["speaking_seconds"]) == (4, 70.0, 1.0)
    assert (three_ago["user_messages"], three_ago["active"]) == (1, True)
    assert (out["user_messages"], out["assessments"], out["speaking_seconds"], out["avg_pronunciation"]) == (3, 6, 5.0, 80.0)
    assert out["grammar_top"] == [{"category": "tense", "count": 2}, {"category": "article", "count": 1}]
    assert (out["active_days"], out["streak_days"]) == (3, 2)


def test_timezone_moves_a_message_across_midnight():
    m = [MessageRow(datetime(2026, 10, 4, 16, 30, tzinfo=UTC), None)]
    assert run(messages=m, offset_minutes=480)["daily"][-1]["user_messages"] == 1  # UTC+8:10-05 00:30
    utc = run(messages=m, offset_minutes=0)
    assert utc["daily"][-1]["user_messages"] == 0 and utc["daily"][-2]["user_messages"] == 1
    assert run(messages=m, offset_minutes=480)["today"] == "2026-10-05"


def test_poor_words_follow_the_client_rule():
    assert poor_words(result(word("Think", 30), word("the", 0, "Insertion"), word("now,", 90, "Mispronunciation"),
                             word("ok", 95), word("think", 40), word("gone", 0, "Omission"))) == {"think", "now", "gone"}
    assert poor_words({}) == set() and poor_words(None) == set() and poor_words({"detail_result": {"words": "x"}}) == set()


def test_top_lists_are_limited_and_ordered():
    results = [result(word("think", 30), word("very", 30)), result(word("think", 20))]
    results += [result(word(f"w{i:02d}", 10)) for i in range(12)]
    out = run(poor_results=results, messages=[MessageRow(NOW, grammar(*"abcdefg"))])
    assert out["poor_words"][0] == {"word": "think", "count": 2}
    assert len(out["poor_words"]) == 10 and out["poor_words"][1] == {"word": "very", "count": 1}
    assert [c["category"] for c in out["grammar_top"]] == ["a", "b", "c", "d", "e"]


def test_truncated_flag_passes_through():
    assert run(truncated=True)["truncated"] is True


def test_aware_non_utc_input_is_converted():
    plus8 = timezone(timedelta(hours=8))
    # 2026-10-05 00:30 +08:00 == 2026-10-04 16:30 UTC
    v = datetime(2026, 10, 5, 0, 30, tzinfo=plus8)
    assert local_date(v, 0) == date(2026, 10, 4)
    assert local_date(v, 480) == date(2026, 10, 5)


def test_single_day_window():
    out = run(days=1, messages=[MessageRow(NOW, None)])
    assert [d["date"] for d in out["daily"]] == ["2026-10-05"]
    assert out["user_messages"] == 1 and out["active_days"] == 1


def test_negative_offset_crosses_local_midnight():
    # UTC 04:59 on 10-05 is 23:59 on 10-04 at -300; 05:00 is 00:00 on 10-05
    m = [MessageRow(datetime(2026, 10, 5, 4, 59, tzinfo=UTC), None), MessageRow(datetime(2026, 10, 5, 5, 0, tzinfo=UTC), None)]
    out = run(now=datetime(2026, 10, 5, 6, 0, tzinfo=UTC), offset_minutes=-300, messages=m)
    assert out["today"] == "2026-10-05"
    assert out["daily"][-1]["user_messages"] == 1 and out["daily"][-2]["user_messages"] == 1


def test_leap_day_listing():
    out = run(now=datetime(2028, 3, 2, 12, 0, tzinfo=UTC), days=4)
    assert [d["date"] for d in out["daily"]] == ["2028-02-28", "2028-02-29", "2028-03-01", "2028-03-02"]
    out = run(now=datetime(2026, 3, 1, 12, 0, tzinfo=UTC), days=3)
    assert [d["date"] for d in out["daily"]] == ["2026-02-27", "2026-02-28", "2026-03-01"]


def test_streak_cap_and_pre_window_activity():
    d = lambda n: TODAY - timedelta(days=n)  # noqa: E731
    assert streak({d(n) for n in range(0, 120)}, TODAY) == 90
    assert streak({d(1), d(2), d(3)}, TODAY) == 3
    # activity before the 7-day window still counts toward the streak
    msgs = [MessageRow(datetime(2026, 10, 5, 1, 0, tzinfo=UTC) - timedelta(days=n), None) for n in range(1, 11)]
    out = run(messages=msgs)
    assert out["streak_days"] == 10 and out["active_days"] == 6 and out["user_messages"] == 6


def test_malformed_grammar_is_skipped():
    bad = [
        MessageRow(NOW, "oops"), MessageRow(NOW, {"errors": "x"}), MessageRow(NOW, {"errors": None}),
        MessageRow(NOW, {"errors": ["s", 3, None, {"category": 5}, {"category": ""}, {"category": None}, {}]}),
        MessageRow(NOW, {"errors": [{"category": "tense"}]}),
    ]
    out = run(messages=bad)
    assert out["user_messages"] == 5
    assert out["grammar_top"] == [{"category": "tense", "count": 1}]


def test_duration_none_and_negative():
    a = [AssessmentRow(NOW, None, None), AssessmentRow(NOW, -500, {}), AssessmentRow(NOW, 2000, {"pronunciation_score": 50})]
    out = run(assessments=a)
    assert out["speaking_seconds"] == 2.0 and out["assessments"] == 3 and out["avg_pronunciation"] == 50.0


def test_poor_words_aggregate_case_insensitive_with_tie_break():
    results = [result(word("Zed", 10), word("apple", 10)), result(word("ZED", 10), word("Banana", 10)), result(word("banana", 5)),
               result(word("apple", 5), word("apple", 5))]
    out = run(poor_results=results, messages=[MessageRow(NOW, grammar("b", "a", "b", "a"))])
    assert out["poor_words"] == [{"word": "apple", "count": 2}, {"word": "banana", "count": 2}, {"word": "zed", "count": 2}]
    assert out["grammar_top"] == [{"category": "a", "count": 2}, {"category": "b", "count": 2}]
