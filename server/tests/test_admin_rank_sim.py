from datetime import datetime, timedelta, timezone

from app.admin.rank_sim import SimEvent, day_totals, recompute_points, simulate
from app.models import PromotionMatch, RankProfile, User, XpEvent
from app.rank.rules import DEFAULT_RULES

NOW = datetime(2026, 10, 9, 9, tzinfo=timezone.utc)


def test_recompute_points_uses_draft_bands():
    draft = DEFAULT_RULES.model_copy(update={"points": DEFAULT_RULES.points.model_copy(
        update={"assessment_bands": ((80, 5), (0, 2)), "chat_turn": 2})})
    assert recompute_points("assessment", 82, draft) == 5
    assert recompute_points("voice_turn", None, draft) == 2
    assert recompute_points("chat_turn", None, draft) == 2
    assert recompute_points("active_day", None, draft) == DEFAULT_RULES.points.active_day
    assert recompute_points("admin_adjust", None, draft) == 0
    events = [SimEvent(1, "assessment", 90, "d"), SimEvent(1, "active_day", None, "d"), SimEvent(2, "chat_turn", None, "d")]
    assert day_totals(events, draft) == {(1, "d"): 5, (2, "d"): 2}


async def test_simulate_reports_gate_clamp_cap_and_verdict_flips(app):
    async with app.state.sessionmaker() as s:
        s.add(User(id=1, username="a", password_hash="x"))
        await s.flush()
        s.add(RankProfile(user_id=1, tier=2, division=1, rp=120, stars=0, best_tier=2, tier_started_at=NOW - timedelta(days=3), updated_at=NOW))
        for i in range(20):
            s.add(XpEvent(user_id=1, kind="assessment", ref_id=f"a{i}", points=4 if i < 15 else 0, score=90,
                          day="2026-10-08", tier=2, created_at=NOW - timedelta(days=1)))
        s.add(PromotionMatch(id="m", user_id=1, from_tier=1, to_tier=2, scenario_key="k", status="passed", turn_limit=5,
                             turns=[{"role": "user", "text": "x", "pron": 80, "fluency": 70, "english": True, "echo": False, "short": False}],
                             result={"dimensions": {"task": 3, "accuracy": 3, "range": 2, "interaction": 3, "speech": 76.0}, "gates_failed": []},
                             total=70, threshold=65, attempt_no=1, started_at=NOW - timedelta(days=2),
                             expires_at=NOW, finished_at=NOW - timedelta(days=2)))
        await s.commit()
        draft = DEFAULT_RULES.model_copy(update={
            "tiers": tuple(t.model_copy(update={"division_rp": 100}) if t.key == "gold" else t for t in DEFAULT_RULES.tiers),
            "points": DEFAULT_RULES.points.model_copy(update={"daily_cap": 100}),
            "match": DEFAULT_RULES.match.model_copy(update={"thresholds": {**DEFAULT_RULES.match.thresholds, 2: 90}}),
        })
        out = await simulate(s, draft, DEFAULT_RULES, NOW)
        same = await simulate(s, DEFAULT_RULES, DEFAULT_RULES, NOW)
    assert out["profiles"] == 1 and out["clamped"] == 1
    assert out["gate"] == {"current": 1, "draft": 1}
    assert out["daily_cap"]["capped_current"] == 1 and out["daily_cap"]["capped_draft"] == 0
    assert (out["daily_cap"]["avg_points_current"], out["daily_cap"]["avg_points_draft"]) == (60, 80)
    assert out["stage_complete"] == {"current": 0, "draft": 0}
    assert out["verdicts"] == {"matches": 1, "pass_to_fail": 1, "fail_to_pass": 0}
    assert set(out["scenario_pool"]) == {"1", "2", "3", "4", "5", "6"}
    assert out["pace_days"]["gold"] == [5, 8] and out["pace_days_current"]["gold"] == [6, 9]
    assert same["verdicts"]["pass_to_fail"] == 0 and same["clamped"] == 0
