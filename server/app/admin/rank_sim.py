"""段位规则影响预演(管理后台 v2 spec §5.3)。只读:最近 14 天事件、最近 30 天已结束比赛、全部档案。

结果是"当前 → 草稿"两组数字;比赛判定翻转只提示,不改历史。节奏是估算(每天 40–60 点,spec §2.2)。"""
import math
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import and_, select

from app.models import PromotionMatch, RankProfile, XpEvent
from app.rank import grading
from app.rank.ledger import state_of
from app.rank.points import CAPPED, EventRow, assessment_points, points_for, stage_progress
from app.rank.tiers import MASTER, TIERS, at_gate, division_rp

EVENT_DAYS = 14
MATCH_DAYS = 30
DAILY_PACE = (40, 60)  # points per day for ~15 minutes of practice (estimate)
OPEN = ("active", "grading_failed")


@dataclass(frozen=True)
class SimEvent:
    user_id: int
    kind: str
    score: int | None
    day: str


def recompute_points(kind: str, score: int | None, rules) -> int:
    """Points an event would earn under `rules` (before the daily cap)."""
    if kind in ("assessment", "voice_turn"):
        return assessment_points(score, rules=rules)
    if kind in ("chat_turn", "vocab_review", "active_day", "streak_7", "stage_task", "word_learned", "spelling_set"):
        return points_for(kind, rules=rules)
    return 0


def day_totals(events, rules) -> dict[tuple[int, str], int]:
    """Uncapped points of the capped kinds per (user, day)."""
    totals: dict[tuple[int, str], int] = defaultdict(int)
    for e in events:
        if e.kind in CAPPED:
            totals[(e.user_id, e.day)] += recompute_points(e.kind, e.score, rules)
    return dict(totals)


def _cap_stats(totals: dict[tuple[int, str], int], cap: int) -> tuple[int, float]:
    capped = sum(1 for v in totals.values() if v >= cap)
    avg = sum(min(v, cap) for v in totals.values()) / len(totals) if totals else 0.0
    return capped, round(avg, 1)


def _judge(dims: dict) -> grading.Judge | None:
    try:
        values = [float(dims[k]) for k in grading.DIMENSIONS]
    except (KeyError, TypeError, ValueError):
        return None
    return grading.Judge(*values, functions_met=(), strengths_zh=(), improve_zh=(), drill_en="")


def _facts(turns: list) -> list[grading.TurnFacts]:
    return [grading.TurnFacts(t.get("pron"), t.get("fluency"), bool(t.get("english")), bool(t.get("echo")),
                              bool(t.get("short"))) for t in turns or [] if isinstance(t, dict) and t.get("role") == "user"]


def _passes(judge: grading.Judge, speech: float | None, facts, to_tier: int, rules) -> bool:
    total = grading.composite(judge, speech, rules=rules)
    return total >= grading.threshold_for(to_tier, rules=rules) and not grading.gates(judge, facts, rules=rules)


def _pace(rules) -> dict[str, list[int]]:
    lo, hi = DAILY_PACE
    return {t.key: [math.ceil(3 * division_rp(t.index, rules=rules) / hi), math.ceil(3 * division_rp(t.index, rules=rules) / lo)]
            for t in TIERS if t.index < MASTER}


async def simulate(session, draft, current, now: datetime) -> dict:
    profiles = (await session.scalars(select(RankProfile))).all()
    gate_current = gate_draft = clamped = 0
    for p in profiles:
        s = state_of(p)
        gate_current += at_gate(s, rules=current)
        gate_draft += at_gate(s, rules=draft)
        limit = division_rp(p.tier, rules=draft) - (1 if p.tier == MASTER else 0)
        clamped += p.rp > limit

    # stage tasks: events of the profile's tier since tier_started_at
    stage_rows = (await session.execute(
        select(XpEvent.user_id, XpEvent.kind, XpEvent.score, XpEvent.day).join(
            RankProfile, and_(RankProfile.user_id == XpEvent.user_id, RankProfile.tier == XpEvent.tier,
                              XpEvent.created_at >= RankProfile.tier_started_at)))).all()
    by_user: dict[int, list[EventRow]] = defaultdict(list)
    for uid, kind, score, day in stage_rows:
        by_user[uid].append(EventRow(kind, score, day))
    stage_current = stage_draft = 0
    for p in profiles:
        if p.tier >= MASTER:
            continue
        events = by_user.get(p.user_id, [])
        cur = stage_progress(p.tier, events, rules=current)
        new = stage_progress(p.tier, events, rules=draft)
        stage_current += bool(cur) and all(t.complete for t in cur)
        stage_draft += bool(new) and all(t.complete for t in new)

    since = now - timedelta(days=EVENT_DAYS)
    recent = [SimEvent(*row) for row in (await session.execute(
        select(XpEvent.user_id, XpEvent.kind, XpEvent.score, XpEvent.day).where(
            XpEvent.created_at >= since, XpEvent.kind.in_(CAPPED)))).all()]
    totals_current, totals_draft = day_totals(recent, current), day_totals(recent, draft)
    capped_current, avg_current = _cap_stats(totals_current, current.points.daily_cap)
    capped_draft, avg_draft = _cap_stats(totals_draft, draft.points.daily_cap)

    matches = (await session.scalars(select(PromotionMatch).where(
        PromotionMatch.status.in_(("passed", "failed")), PromotionMatch.result.is_not(None),
        PromotionMatch.finished_at >= now - timedelta(days=MATCH_DAYS)))).all()
    counted = pass_to_fail = fail_to_pass = 0
    for m in matches:
        dims = (m.result or {}).get("dimensions") or {}
        judge = _judge(dims)
        if judge is None:
            continue
        speech = dims.get("speech")
        speech = float(speech) if isinstance(speech, (int, float)) and not isinstance(speech, bool) else None
        counted += 1
        now_pass = _passes(judge, speech, _facts(m.turns), m.to_tier, draft)
        if m.status == "passed" and not now_pass:
            pass_to_fail += 1
        elif m.status == "failed" and now_pass:
            fail_to_pass += 1

    draft_keys = {s.key for s in draft.scenarios}
    in_use = (await session.scalars(select(PromotionMatch.scenario_key).where(PromotionMatch.status.in_(OPEN)))).all()
    return {
        "profiles": len(profiles),
        "gate": {"current": gate_current, "draft": gate_draft},
        "clamped": clamped,
        "stage_complete": {"current": stage_current, "draft": stage_draft},
        "daily_cap": {"user_days": len(totals_current), "capped_current": capped_current, "capped_draft": capped_draft,
                      "avg_points_current": avg_current, "avg_points_draft": avg_draft},
        "verdicts": {"matches": counted, "pass_to_fail": pass_to_fail, "fail_to_pass": fail_to_pass},
        "scenario_pool": {str(t): sum(1 for s in draft.scenarios if s.target_tier == t and s.enabled)
                          for t in range(1, len(TIERS))},
        "scenario_pool_current": {str(t): sum(1 for s in current.scenarios if s.target_tier == t and s.enabled)
                                  for t in range(1, len(TIERS))},
        "removed_in_use": sorted({k for k in in_use if k not in draft_keys}),
        "pace_days": _pace(draft),
        "pace_days_current": _pace(current),
    }
