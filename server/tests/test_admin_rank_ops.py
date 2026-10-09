from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.admin import rank_ops
from app.admin.audit import Actor, verify
from app.models import AdminAudit, DailyUsage, PromotionMatch, RankProfile, User, UserAchievement, XpEvent
from app.rank.rules import DEFAULT_RULES

NOW = datetime(2026, 10, 9, 9, 0, tzinfo=timezone.utc)
OPS = Actor("ops", "operator", "s1", "127.0.0.1")
U1, U2 = 11111111, 22222222


@pytest.fixture
async def users(app):
    async with app.state.sessionmaker() as s:
        s.add_all([User(id=U1, username="alice", password_hash="x"), User(id=U2, username="bob", password_hash="x")])
        await s.flush()
        s.add_all([
            RankProfile(user_id=U1, tier=2, division=1, rp=120, stars=0, best_tier=2, tier_started_at=NOW,
                        cooldown_until=NOW + timedelta(minutes=20), updated_at=NOW),
            RankProfile(user_id=U2, tier=4, division=2, rp=30, stars=0, best_tier=4, tier_started_at=NOW, updated_at=NOW),
        ])
        s.add(DailyUsage(scope="rank_match", subject=str(U1), day="2026-10-09", count=3))
        await s.commit()


async def test_clear_cooldown_reset_attempts_and_adjust(app, users):
    async with app.state.sessionmaker() as s:
        await rank_ops.clear_cooldown(s, OPS, U1)
        assert await rank_ops.reset_attempts(s, OPS, U1, "2026-10-09") == 1
        out = await rank_ops.adjust_points(s, OPS, U2, -50, reason="误记", now=NOW, rules=DEFAULT_RULES)
        assert out["rp"] == 0 and out["division"] == 2  # never demotes (R-1)
        await rank_ops.adjust_points(s, OPS, U2, 200, reason="补偿", now=NOW, rules=DEFAULT_RULES)
        await s.commit()
        p1 = await s.get(RankProfile, U1)
        p2 = await s.get(RankProfile, U2)
        events = (await s.scalars(select(XpEvent).where(XpEvent.user_id == U2).order_by(XpEvent.id))).all()
        audits = (await s.scalars(select(AdminAudit).order_by(AdminAudit.id))).all()
        assert await verify(s) == (True, None)
    assert p1.cooldown_until is None
    assert (p2.division, p2.rp) == (1, 40)  # 0 + 200 over 160-rp divisions
    assert [e.kind for e in events] == ["admin_adjust", "admin_adjust"] and all(e.ref_id.startswith("audit:") for e in events)
    assert [e.points for e in events] == [-50, 200]
    assert [a.action for a in audits] == ["rank.user.clear_cooldown", "rank.user.reset_attempts",
                                          "rank.user.adjust_points", "rank.user.adjust_points"]
    assert events[0].ref_id == f"audit:{audits[2].id}" and audits[2].reason == "误记"
    for bad in (0, 1001, -1001):
        with pytest.raises(rank_ops.RankOpError):
            async with app.state.sessionmaker() as s:
                await rank_ops.adjust_points(s, OPS, U2, bad, reason="x", now=NOW, rules=DEFAULT_RULES)
    with pytest.raises(rank_ops.RankOpError) as exc:
        async with app.state.sessionmaker() as s:
            await rank_ops.reset_attempts(s, OPS, U1, "yesterday")
    assert exc.value.status == 422


async def test_user_rank_view(app, users):
    async with app.state.sessionmaker() as s:
        await rank_ops.adjust_points(s, OPS, U1, 5, reason="补偿", now=NOW, rules=DEFAULT_RULES)
        await s.commit()
        out = await rank_ops.user_rank(s, U1, NOW, DEFAULT_RULES, settings=app.state.settings)
        with pytest.raises(rank_ops.RankOpError):
            await rank_ops.user_rank(s, 999, NOW, DEFAULT_RULES, settings=app.state.settings)
    assert out["profile"]["tier_key"] == "gold" and out["profile"]["at_gate"] is True
    assert out["attempts_today"] == {"day": "2026-10-09", "used": 3, "limit": 3, "left": 0}
    assert out["quota_override"] is None and len(out["stage_tasks"]) == 3
    assert out["division_rps"] == [100, 100, 120, 140, 160, 200, 200]
    assert out["recent_events"][0] | {"created_at": None} == {
        "kind": "admin_adjust", "points": 5, "day": "2026-10-09", "tier": 2, "created_at": None, "actor": "ops",
        "reason": "补偿"}
    assert out["promotion"]["state"] == "unavailable" and out["matches"] == []  # RANK_ENABLED off here


async def test_void_failed_match_restores_gate_and_refunds(app, users):
    async with app.state.sessionmaker() as s:
        m = PromotionMatch(id="m1", user_id=U1, from_tier=2, to_tier=3, scenario_key="k", status="failed", turn_limit=6,
                           turns=[], threshold=68, attempt_no=1, started_at=NOW, expires_at=NOW, finished_at=NOW)
        s.add(m)
        p = await s.get(RankProfile, U1)
        p.rp = 96
        await s.commit()
        out = await rank_ops.void_match(s, OPS, "m1", reason="评委上游故障", now=NOW, rules=DEFAULT_RULES)
        await s.commit()
        p = await s.get(RankProfile, U1)
        usage = await s.scalar(select(DailyUsage.count).where(DailyUsage.subject == str(U1)))
    assert out["status"] == "voided" and out["restored"] is True and out["gates_failed"] == []
    assert (p.rp, p.cooldown_until) == (120, None) and usage == 2
    with pytest.raises(rank_ops.RankOpError) as exc:
        async with app.state.sessionmaker() as s:
            await rank_ops.void_match(s, OPS, "m1", reason="again", now=NOW, rules=DEFAULT_RULES)
    assert exc.value.status == 409


async def test_void_rejects_passed_and_skips_restore_after_promotion(app, users):
    async with app.state.sessionmaker() as s:
        s.add(PromotionMatch(id="p", user_id=U2, from_tier=3, to_tier=4, scenario_key="k", status="passed", turn_limit=6,
                             turns=[], threshold=70, attempt_no=1, started_at=NOW, expires_at=NOW, finished_at=NOW))
        s.add(PromotionMatch(id="f", user_id=U2, from_tier=3, to_tier=4, scenario_key="k", status="abandoned",
                             turn_limit=6, turns=[], threshold=70, attempt_no=1, started_at=NOW, expires_at=NOW))
        await s.commit()
        with pytest.raises(rank_ops.RankOpError) as exc:
            await rank_ops.void_match(s, OPS, "p", reason="x", now=NOW, rules=DEFAULT_RULES)
        assert exc.value.status == 409
        out = await rank_ops.void_match(s, OPS, "f", reason="x", now=NOW, rules=DEFAULT_RULES)
        await s.commit()
        p = await s.get(RankProfile, U2)
    assert out["restored"] is False and (p.tier, p.division, p.rp) == (4, 2, 30)


async def test_reset_user_and_reset_all_with_undo(app, users):
    async with app.state.sessionmaker() as s:
        batch = await rank_ops.reset_user(s, OPS, U2, tier=1, division=3, rp=10, reason="定级", now=NOW, rules=DEFAULT_RULES)
        await s.commit()
        p = await s.get(RankProfile, U2)
        assert (p.tier, p.rp, p.best_tier, p.cooldown_until) == (1, 10, 4, None)
        assert await rank_ops.undo_reset(s, OPS, batch, NOW) == 1
        await s.commit()
        assert (await s.get(RankProfile, U2)).tier == 4
        batch, n = await rank_ops.reset_all(s, OPS, reason="新赛制", now=NOW)
        await s.commit()
        assert n == 2 and {p.tier for p in (await s.scalars(select(RankProfile))).all()} == {0}
        assert (await rank_ops.latest_reset(s, NOW))["users"] == 2
        assert await rank_ops.latest_reset(s, NOW + timedelta(days=8)) is None
        with pytest.raises(rank_ops.RankOpError) as exc:
            await rank_ops.undo_reset(s, OPS, batch, NOW + timedelta(days=8))
        assert exc.value.status == 410
        assert await rank_ops.undo_reset(s, OPS, batch, NOW + timedelta(days=6)) == 2
        await s.commit()
        p1 = await s.get(RankProfile, U1)
        assert (p1.tier, p1.division, p1.rp) == (2, 1, 120) and p1.cooldown_until is not None
        with pytest.raises(rank_ops.RankOpError) as exc:
            await rank_ops.undo_reset(s, OPS, batch, NOW)
        assert exc.value.status == 404


async def test_reset_user_validates_target(app, users):
    async with app.state.sessionmaker() as s:
        for kw in ({"tier": 7}, {"tier": 1, "division": 4}, {"tier": 1, "division": 2, "rp": 100},
                   {"tier": 6, "rp": 200}):
            with pytest.raises(rank_ops.RankOpError):
                await rank_ops.reset_user(s, OPS, U2, reason="x", now=NOW, rules=DEFAULT_RULES, **kw)
        await rank_ops.reset_user(s, OPS, U2, tier=6, division=3, rp=10, reason="x", now=NOW, rules=DEFAULT_RULES)
        p = await s.get(RankProfile, U2)
    assert (p.tier, p.division, p.rp, p.best_tier) == (6, 0, 10, 6)


async def test_achievements_grant_revoke(app, users):
    async with app.state.sessionmaker() as s:
        await rank_ops.set_achievement(s, OPS, U1, "streak_7", True, NOW)
        await rank_ops.set_achievement(s, OPS, U1, "streak_7", True, NOW)  # idempotent
        await rank_ops.set_achievement(s, OPS, U1, "season_1_gold", True, NOW)
        for bad in ("made_up", "season_1_wood", "season_0_gold"):
            with pytest.raises(rank_ops.RankOpError):
                await rank_ops.set_achievement(s, OPS, U1, bad, True, NOW)
        await rank_ops.set_achievement(s, OPS, U1, "streak_7", False, NOW)
        await s.commit()
        keys = (await s.scalars(select(UserAchievement.key).where(UserAchievement.user_id == U1))).all()
    assert keys == ["season_1_gold"]


async def test_clear_all_cooldowns(app, users):
    async with app.state.sessionmaker() as s:
        assert await rank_ops.clear_all_cooldowns(s, OPS, reason="评委故障补偿") == 1
        await s.commit()
        assert (await s.get(RankProfile, U1)).cooldown_until is None
