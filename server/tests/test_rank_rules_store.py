import random
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.admin import rank_rules_admin as rra
from app.admin.audit import Actor
from app.core.runtime_settings import check_revisions
from app.models import AdminAudit, PromotionMatch, RankRuleSet, UserQuotaOverride, XpEvent
from app.rank import ledger
from app.rank import match as match_mod
from app.rank.rules import DEFAULT_RULES, rules_json
from app.rank.rules_store import rank_rules
from app.services.usage import local_day

ROOT = Actor("root", "superadmin", "s1", "127.0.0.1")
TODAY = date(2026, 10, 9)


@pytest.fixture
def settings_overrides(request):
    return {"rank_enabled": True, "rank_daily_rp_cap": 70, **getattr(request, "param", {})}


async def _etag(s) -> str:
    row = await rra._draft(s)
    return rra.draft_etag(row) if row is not None else "no-draft"


async def publish_with(app, s, mutate, reason="r"):
    await rra.create_draft(s, ROOT, from_version=None)
    data = rules_json(DEFAULT_RULES)
    mutate(data)
    await rra.save_draft(s, ROOT, data, "")
    return await rra.publish(s, app, ROOT, reason=reason, etag=await _etag(s))


async def test_v0_comes_from_settings_until_a_version_is_published(app):
    cache = rank_rules(app)
    version, rules = await cache.current()
    assert version is None and rules.points.daily_cap == 70
    async with app.state.sessionmaker() as s:
        draft = await rra.create_draft(s, ROOT, from_version=None, cache=cache)
        assert draft.rules["points"]["daily_cap"] == 70  # copied from v0
        data = rules_json(rules)
        data["points"]["daily_cap"] = 90
        await rra.save_draft(s, ROOT, data, "提高上限")
        assert await rra.validate_draft(s, cache, TODAY) == []
        v = await rra.publish(s, app, ROOT, reason="活动周", etag=await _etag(s))
    assert v == 1
    version, rules = await cache.current()
    assert (version, rules.points.daily_cap) == (1, 90)
    assert (await cache.for_version(None)).points.daily_cap == 70
    assert (await cache.for_version(1)).points.daily_cap == 90
    with pytest.raises(KeyError):
        await cache.for_version(99)
    async with app.state.sessionmaker() as s:
        actions = (await s.scalars(select(AdminAudit.action).order_by(AdminAudit.id))).all()
        publish_row = await s.scalar(select(AdminAudit).where(AdminAudit.action == "rank.rules.publish"))
    assert actions == ["rank.rules.draft.create", "rank.rules.draft.save", "rank.rules.publish"]
    assert (publish_row.summary, publish_row.after, publish_row.reason) == ("points", {"version": 1}, "活动周")


async def test_only_one_draft_and_invalid_rules_block_publish(app):
    async with app.state.sessionmaker() as s:
        await rra.create_draft(s, ROOT, from_version=None)
        with pytest.raises(rra.RulesError) as exc:
            await rra.create_draft(s, ROOT, from_version=None)
        assert exc.value.status == 409
        data = rules_json(DEFAULT_RULES)
        data["match"]["speech_weight"] = 0.9
        await rra.save_draft(s, ROOT, data, "")
        with pytest.raises(rra.RulesError) as exc:
            await rra.publish(s, app, ROOT, reason="x", etag=await _etag(s))
        assert exc.value.status == 422 and "weights_sum" in exc.value.details["errors"]
        with pytest.raises(rra.RulesError) as exc:
            await rra.save_draft(s, ROOT, {**data, "unknown": 1}, "")
        assert exc.value.status == 422 and "unknown" in exc.value.details["fields"]
        await rra.delete_draft(s, ROOT)
        with pytest.raises(rra.RulesError) as exc:
            await rra.publish(s, app, ROOT, reason="x", etag=await _etag(s))
        assert exc.value.status == 404


async def test_published_versions_are_immutable_and_rollback_is_a_new_version(app):
    async with app.state.sessionmaker() as s:
        for cap in (80, 100):
            await publish_with(app, s, lambda d, cap=cap: d["points"].__setitem__("daily_cap", cap))
        await rra.create_draft(s, ROOT, from_version=1)
        assert await rra.publish(s, app, ROOT, reason="回滚到 v1", etag=await _etag(s)) == 3
        overview = await rra.overview(s, rank_rules(app))
        statuses = {r.version: r.status for r in (await s.scalars(select(RankRuleSet))).all()}
    assert overview["published"]["version"] == 3 and overview["published"]["rules"]["points"]["daily_cap"] == 80
    assert [v["version"] for v in overview["versions"]] == [3, 2, 1]
    assert overview["draft"] is None and overview["v0"] is None
    assert statuses == {1: "archived", 2: "archived", 3: "published"}


async def test_draft_overview_reports_its_base_version(app):
    async with app.state.sessionmaker() as s:
        await publish_with(app, s, lambda d: None)
        await rra.create_draft(s, ROOT, from_version=None)
        overview = await rra.overview(s, rank_rules(app))
    assert overview["draft"]["based_on"] == 1 and overview["draft"]["updated_by"] == "root"


async def test_revision_bump_invalidates_other_caches(app):
    cache = rank_rules(app)
    seen = await check_revisions(app, None)
    assert (await cache.current())[0] is None
    async with app.state.sessionmaker() as s:  # simulate another process publishing (no local invalidate)
        s.add(RankRuleSet(version=1, status="published", rules=rules_json(DEFAULT_RULES), note="",
                          created_by="x", published_by="x", published_at=datetime.now(timezone.utc)))
        from app.core.runtime_settings import bump_revision
        await bump_revision(s, "rank_rules")
        await s.commit()
    assert (await cache.current())[0] is None  # still cached
    await check_revisions(app, seen)
    assert (await cache.current())[0] == 1


async def test_matches_pin_the_rules_version(app, client, auth_headers):
    async with app.state.sessionmaker() as s:
        def mutate(data):
            data["match"]["turns"]["1"] = 3
            data["stage_tasks"]["0"] = [{"key": "active_days", "kind": "active_days", "target": 1, "min_score": None}]
        await publish_with(app, s, mutate, reason="短赛")
    uid = int((await client.get("/api/me", headers=auth_headers)).json()["id"])
    now = datetime.now(timezone.utc)
    async with app.state.sessionmaker() as s:
        version, rules = await rank_rules(app).current()
        profile = await ledger.load_profile(s, uid, now)
        profile.division, profile.rp = 1, rules.tiers[0].division_rp
        s.add(XpEvent(user_id=uid, kind="active_day", ref_id=local_day(now, 0), points=5, score=None,
                      day=local_day(now, 0), tier=0, created_at=now))
        await s.commit()
        m = await match_mod.start_match(s, uid, now, settings=app.state.settings, offset_minutes=0,
                                        rng=random.Random(1), rules=rules, rules_version=version)
        await s.commit()
        row = await s.get(PromotionMatch, m.id)
    assert (version, row.rules_version, row.turn_limit) == (1, 1, 3)


async def test_user_override_beats_rules_daily_attempts(app, client, auth_headers):
    uid = int((await client.get("/api/me", headers=auth_headers)).json()["id"])
    now = datetime.now(timezone.utc)
    rules = DEFAULT_RULES.model_copy(update={"match": DEFAULT_RULES.match.model_copy(update={"daily_attempts": 7})})
    async with app.state.sessionmaker() as s:
        assert await ledger.daily_attempts(s, uid, now, app.state.settings) == 3
        assert await ledger.daily_attempts(s, uid, now, app.state.settings, rules=rules) == 7
        s.add(UserQuotaOverride(user_id=uid, key="rank_match_daily_attempts", value=5, updated_by="ops"))
        s.add(UserQuotaOverride(user_id=uid, key="max_conversations", value=1, updated_by="ops",
                                expires_at=now - timedelta(days=1)))
        await s.commit()
        assert await ledger.daily_attempts(s, uid, now, app.state.settings, rules=rules) == 5


async def test_rank_api_serves_published_rules(app, client, auth_headers):
    async with app.state.sessionmaker() as s:
        await publish_with(app, s, lambda d: d["tiers"][0].__setitem__("division_rp", 50))
    config = (await client.get("/api/rank/config", headers=auth_headers)).json()
    assert config["tiers"][0]["division_rp"] == 50 and config["tiers"][1]["division_rp"] == 100
    me = (await client.get("/api/rank/me", headers=auth_headers)).json()
    assert me["division_rp"] == 50
