"""Integration (lane C publish × lane B settings): once rank rules are published, the six rank_* settings are
read-only in the settings service and API, with an error that points to the rank rules editor."""
import pytest

from app.core.settings_registry import SPECS
from app.rank.rules import DEFAULT_RULES, rules_json
from tests.admin_helpers import ADMIN_ENABLED, PASSWORD, login_as

RANK_KEYS = {"rank_daily_rp_cap", "rank_match_daily_attempts", "rank_match_cooldown_minutes", "rank_match_minutes",
             "rank_season_anchor", "rank_season_weeks"}


@pytest.fixture
def settings_overrides(request):
    return {**ADMIN_ENABLED, "rank_enabled": True, "registration_mode": "closed", **getattr(request, "param", {})}


async def test_publish_locks_the_six_rank_settings(app, client):
    assert {k for k, s in SPECS.items() if s.managed_by == "rank_rules"} == RANK_KEYS
    su = await login_as(app, client, "superadmin")
    await client.post("/api/admin/step-up", headers=su, json={"password": PASSWORD})
    # before any publish the settings are editable (and leave a revision to revert later)
    r = await client.patch("/api/admin/settings", headers=su, json={"changes": {"rank_daily_rp_cap": 70}, "reason": "试点"})
    assert r.status_code == 200, r.text
    revision = r.json()["revision"]
    listing = (await client.get("/api/admin/settings")).json()
    assert listing["rank_rules_managed"] is False

    await client.post("/api/admin/rank/rules/draft", headers=su, json={})
    data = rules_json(DEFAULT_RULES)
    data["points"]["daily_cap"] = 80
    await client.put("/api/admin/rank/rules/draft", headers=su, json={"rules": data, "note": ""})
    assert (await client.post("/api/admin/rank/rules/draft/publish", headers=su, json={"reason": "上线"})).status_code == 200

    listing = (await client.get("/api/admin/settings")).json()
    assert listing["rank_rules_managed"] is True
    managed = {i["key"] for i in listing["items"] if i["managed"]}
    assert managed == RANK_KEYS
    for attempt in (
        client.patch("/api/admin/settings", headers=su, json={"changes": {"rank_match_minutes": 25}, "reason": "x"}),
        client.delete("/api/admin/settings/rank_daily_rp_cap", headers=su, params={"reason": "x"}),
        client.post(f"/api/admin/settings/revisions/{revision}/revert", headers=su, json={"reason": "回滚"}),
    ):
        r = await attempt
        assert r.status_code == 409, r.text
        body = r.json()
        assert body["error"] == "Managed by rank rules"
        assert all("rank rules editor" in msg for msg in body["fields"].values())
    # other settings stay editable
    r = await client.patch("/api/admin/settings", headers=su, json={"changes": {"rate_limit_per_minute": 30}, "reason": "x"})
    assert r.status_code == 200
