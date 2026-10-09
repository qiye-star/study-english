from datetime import timedelta

import pytest
from sqlalchemy import select

from app.models import AdminAudit, PromotionMatch, RankProfile, utcnow
from app.rank.rules import DEFAULT_RULES, rules_json
from tests.admin_helpers import ADMIN_ENABLED, PASSWORD, assert_no_secrets, login_as
from tests.test_rank_match import Fakes, judge_json


@pytest.fixture
def settings_overrides(request):
    return {**ADMIN_ENABLED, "rank_enabled": True, **getattr(request, "param", {})}


async def uid_of(client, headers) -> int:
    return int((await client.get("/api/me", headers=headers)).json()["id"])


async def test_draft_validate_simulate_publish_roles(app, client):
    op = await login_as(app, client, "operator")
    assert (await client.post("/api/admin/rank/rules/draft", headers=op, json={})).status_code == 201
    data = rules_json(DEFAULT_RULES)
    data["points"]["daily_cap"] = 75
    assert (await client.put("/api/admin/rank/rules/draft", headers=op, json={"rules": data, "note": "n"})).status_code == 200
    assert (await client.post("/api/admin/rank/rules/draft/validate", headers=op)).json() == {"errors": []}
    sim = (await client.post("/api/admin/rank/rules/draft/simulate", headers=op)).json()
    assert "daily_cap" in sim and "verdicts" in sim
    assert (await client.post("/api/admin/rank/rules/draft/publish", headers=op, json={"reason": "x"})).status_code == 403
    client.cookies.clear()
    su = await login_as(app, client, "superadmin")
    r = await client.post("/api/admin/rank/rules/draft/publish", headers=su, json={"reason": "活动周"})
    assert r.status_code == 403 and r.json()["error"] == "Step-up required"
    await client.post("/api/admin/step-up", headers=su, json={"password": PASSWORD})
    r = await client.post("/api/admin/rank/rules/draft/publish", headers=su, json={"reason": "活动周"})
    assert r.status_code == 200 and r.json() == {"version": 1}
    overview = (await client.get("/api/admin/rank/rules")).json()
    assert overview["published"]["rules"]["points"]["daily_cap"] == 75 and overview["draft"] is None
    assert overview["season_started"] in (True, False)
    assert (await client.get("/api/admin/rank/rules/versions/1")).json()["rules"]["points"]["daily_cap"] == 75
    assert (await client.get("/api/admin/rank/rules/versions/9")).status_code == 404
    assert_no_secrets(overview, app.state.settings)


async def test_viewer_is_read_only(app, client):
    viewer = await login_as(app, client, "viewer")
    assert (await client.get("/api/admin/rank/rules")).status_code == 200
    assert (await client.get("/api/admin/rank/overview")).status_code == 200
    assert (await client.post("/api/admin/rank/rules/draft", headers=viewer, json={})).status_code == 403
    assert (await client.post("/api/admin/rank/clear-cooldowns", headers=viewer, json={"reason": "x"})).status_code == 403


async def test_invalid_draft_is_422_with_field_errors(app, client):
    op = await login_as(app, client, "operator")
    await client.post("/api/admin/rank/rules/draft", headers=op, json={})
    assert (await client.post("/api/admin/rank/rules/draft", headers=op, json={})).status_code == 409
    data = rules_json(DEFAULT_RULES)
    data["match"]["thresholds"]["2"] = 300
    r = await client.put("/api/admin/rank/rules/draft", headers=op, json={"rules": data, "note": ""})
    assert r.status_code == 200
    assert "match_ranges" in (await client.post("/api/admin/rank/rules/draft/validate", headers=op)).json()["errors"]
    data["unknown"] = 1
    data["points"]["daily_cap"] = -5
    r = await client.put("/api/admin/rank/rules/draft", headers=op, json={"rules": data, "note": ""})
    assert r.status_code == 422 and r.json()["error"] == "Invalid rules"
    assert {"unknown", "points.daily_cap"} <= set(r.json()["fields"])
    assert (await client.delete("/api/admin/rank/rules/draft", headers=op)).status_code == 204
    assert (await client.post("/api/admin/rank/rules/draft/validate", headers=op)).status_code == 404


async def test_reset_all_requires_exact_confirmation(app, client, auth_headers):
    await client.get("/api/rank/me", headers=auth_headers)  # creates alice's profile
    su = await login_as(app, client, "superadmin")
    await client.post("/api/admin/step-up", headers=su, json={"password": PASSWORD})
    assert (await client.get("/api/admin/rank/overview")).json()["reset_confirm"] == "RESET 1 USERS"
    r = await client.post("/api/admin/rank/reset-all", headers=su, json={"reason": "新赛制", "confirm": "yes"})
    assert r.status_code == 409 and r.json()["details"]["confirm"] == "RESET 1 USERS"
    r = await client.post("/api/admin/rank/reset-all", headers=su, json={"reason": "新赛制", "confirm": "RESET 1 USERS"})
    assert r.status_code == 200 and r.json()["users"] == 1
    assert (await client.get("/api/admin/rank/overview")).json()["last_reset"]["batch_id"] == r.json()["batch_id"]
    assert (await client.post(f"/api/admin/rank/reset-all/{r.json()['batch_id']}/undo", headers=su)).status_code == 200
    assert (await client.post(f"/api/admin/rank/reset-all/{r.json()['batch_id']}/undo", headers=su)).status_code == 404


async def test_user_rank_operations(app, client, auth_headers):
    uid = await uid_of(client, auth_headers)
    await client.get("/api/rank/me", headers=auth_headers)
    op = await login_as(app, client, "operator")
    view = await client.get(f"/api/admin/users/{uid}/rank")
    assert view.status_code == 200 and view.json()["profile"]["tier_key"] == "bronze"
    assert_no_secrets(view.json(), app.state.settings)
    assert (await client.get("/api/admin/users/999/rank")).status_code == 404
    r = await client.post(f"/api/admin/users/{uid}/rank/adjust", headers=op, json={"delta": 30, "reason": "补偿"})
    assert r.status_code == 200 and r.json()["rp"] == 30
    assert (await client.post(f"/api/admin/users/{uid}/rank/adjust", headers=op,
                              json={"delta": 5, "reason": "  "})).status_code == 422
    assert (await client.post(f"/api/admin/users/{uid}/rank/clear-cooldown", headers=op)).status_code == 204
    r = await client.post(f"/api/admin/users/{uid}/rank/reset-attempts", headers=op, json={"day": "2026-10-09"})
    assert r.json() == {"deleted": 0}
    assert (await client.post(f"/api/admin/users/{uid}/rank/achievement", headers=op,
                              json={"key": "streak_3", "granted": True})).status_code == 204
    assert (await client.post(f"/api/admin/users/{uid}/rank/achievement", headers=op,
                              json={"key": "nope", "granted": True})).status_code == 422
    body = {"tier": 1, "division": 3, "rp": 0, "reason": "老用户定级"}
    r = await client.post(f"/api/admin/users/{uid}/rank/reset", headers=op, json=body)
    assert r.status_code == 403 and r.json()["error"] == "Step-up required"
    await client.post("/api/admin/step-up", headers=op, json={"password": PASSWORD})
    r = await client.post(f"/api/admin/users/{uid}/rank/reset", headers=op, json=body)
    assert r.status_code == 200 and r.json()["batch_id"]
    view = (await client.get(f"/api/admin/users/{uid}/rank")).json()
    assert view["profile"]["tier_key"] == "silver"
    assert view["recent_events"][0]["kind"] == "admin_adjust" and view["recent_events"][0]["actor"] == "operator1"
    async with app.state.sessionmaker() as s:
        actions = (await s.scalars(select(AdminAudit.action).where(AdminAudit.action.like("rank.%")).order_by(AdminAudit.id))).all()
    assert actions == ["rank.user.adjust_points", "rank.user.clear_cooldown", "rank.user.reset_attempts",
                       "rank.user.achievement", "rank.user.reset"]


async def test_matches_list_detail_void_and_regrade(app, client, auth_headers, monkeypatch):
    uid = await uid_of(client, auth_headers)
    now = utcnow()
    turns = [{"role": "ai", "text": "Hi"}]
    for _ in range(5):
        turns += [{"role": "user", "text": "I would like a coffee please", "pron": 80.0, "fluency": 70.0,
                   "english": True, "echo": False, "short": False, "duration_ms": 3000},
                  {"role": "ai", "text": "Sure"}]
    async with app.state.sessionmaker() as s:
        s.add(RankProfile(user_id=uid, tier=1, division=1, rp=80, stars=0, best_tier=1, tier_started_at=now,
                          cooldown_until=now + timedelta(minutes=30), synced_at=now, updated_at=now))
        s.add(PromotionMatch(id="failed1", user_id=uid, from_tier=1, to_tier=2, scenario_key="gold-hotel-problem",
                             status="failed", turn_limit=5, turns=turns, threshold=65, total=50, attempt_no=1,
                             started_at=now - timedelta(minutes=30), expires_at=now, finished_at=now))
        s.add(PromotionMatch(id="gf1", user_id=uid, from_tier=1, to_tier=2, scenario_key="gold-hotel-problem",
                             status="grading_failed", turn_limit=5, turns=turns, threshold=65, attempt_no=2,
                             grade_attempts=1, started_at=now - timedelta(minutes=5), expires_at=now + timedelta(minutes=15)))
        await s.commit()
    op = await login_as(app, client, "operator")
    listing = (await client.get("/api/admin/rank/matches", params={"user_id": uid})).json()
    assert [m["id"] for m in listing["items"]] == ["gf1", "failed1"] and "turns" not in listing["items"][0]
    assert (await client.get("/api/admin/rank/matches", params={"status": "voided"})).json()["items"] == []
    for _ in range(2):
        detail = (await client.get("/api/admin/rank/matches/failed1")).json()
    assert detail["match"]["turns"][1]["text"] == "I would like a coffee please" and detail["match"]["rules_version"] is None
    async with app.state.sessionmaker() as s:
        views = (await s.scalars(select(AdminAudit).where(AdminAudit.action == "rank.match.view"))).all()
    assert len(views) == 1 and views[0].target_id == "failed1"
    r = await client.post("/api/admin/rank/matches/failed1/void", headers=op, json={"reason": "评委故障"})
    assert r.status_code == 200 and r.json()["status"] == "voided"
    assert (await client.post("/api/admin/rank/matches/failed1/regrade", headers=op)).status_code == 409
    fakes = Fakes(judge_outputs=[judge_json(task=4, dims=4)])
    monkeypatch.setattr("app.routers.rank.build_deps", lambda request, settings, user_id: fakes.deps())
    async with app.state.sessionmaker() as s:  # the void restored the gate: division I, full
        p = await s.get(RankProfile, uid)
        assert (p.division, p.rp, p.cooldown_until) == (1, 100, None)
    r = await client.post("/api/admin/rank/matches/gf1/regrade", headers=op)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "passed" and r.json()["new_tier"] == "gold"
    assert (await client.post("/api/admin/rank/matches/nope/void", headers=op, json={"reason": "x"})).status_code == 404


@pytest.mark.parametrize("settings_overrides", [{"rank_enabled": False}], indirect=True)
async def test_rules_work_while_rank_is_disabled(app, client):
    op = await login_as(app, client, "operator")
    assert (await client.post("/api/admin/rank/rules/draft", headers=op, json={})).status_code == 201
    assert (await client.get("/api/admin/rank/rules")).json()["draft"]["based_on"] is None
    assert (await client.get("/api/admin/rank/overview")).json()["profiles"] == 0
