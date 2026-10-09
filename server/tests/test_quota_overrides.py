from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.core.quotas import QuotaCache, effective
from app.models import AdminAudit, UserQuotaOverride
from tests.admin_helpers import ADMIN_ENABLED, login_as
from tests.test_admin_api import register


@pytest.fixture
def settings_overrides(tmp_path):
    return {**ADMIN_ENABLED, "data_dir": str(tmp_path / "d"), "max_conversations": 1, "ai_rate_limit_per_minute": 1}


async def test_conversation_cap_override(app, client):
    uid, headers = await register(client, "alice")
    assert (await client.post("/api/conversations", headers=headers, json={"name": "a"})).status_code == 200
    assert (await client.post("/api/conversations", headers=headers, json={"name": "b"})).status_code == 429
    h = await login_as(app, client, "operator")
    r = await client.put(f"/api/admin/users/{uid}/quotas/max_conversations", headers=h, json={"value": 3, "note": "老师"})
    assert r.status_code == 200 and r.json()["override"] == 3
    assert (await client.post("/api/conversations", headers=headers, json={"name": "b"})).status_code == 200
    items = {i["key"]: i for i in (await client.get(f"/api/admin/users/{uid}/quotas")).json()["items"]}
    assert items["max_conversations"]["override"] == 3 and items["max_conversations"]["default"] == 1
    assert items["max_conversations"]["note"] == "老师" and items["max_conversations"]["updated_by"] == "operator1"
    assert items["max_vocab_items"]["override"] is None
    assert (await client.delete(f"/api/admin/users/{uid}/quotas/max_conversations", headers=h)).status_code == 204
    assert (await client.post("/api/conversations", headers=headers, json={"name": "c"})).status_code == 429
    async with app.state.sessionmaker() as s:
        actions = [a.action for a in (await s.scalars(select(AdminAudit))).all()]
    assert actions.count("quota.set") == 1 and actions.count("quota.clear") == 1


async def test_ai_rate_limit_override_applies_per_user(app, client):
    uid, headers = await register(client, "bob")
    h = await login_as(app, client, "operator")
    await client.put(f"/api/admin/users/{uid}/quotas/ai_rate_limit_per_minute", headers=h, json={"value": 5})
    codes = [(await client.get("/api/stats", headers=headers)).status_code for _ in range(3)]
    assert codes == [200, 200, 200]
    other, other_headers = await register(client, "bob2")
    codes = [(await client.get("/api/stats", headers=other_headers)).status_code for _ in range(2)]
    assert codes == [200, 429]  # global AI_RATE_LIMIT_PER_MINUTE=1 still applies to everyone else


async def test_expired_override_falls_back(app, client):
    uid, headers = await register(client, "cid")
    h = await login_as(app, client, "operator")
    past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    r = await client.put(f"/api/admin/users/{uid}/quotas/max_conversations", headers=h,
                         json={"value": 9, "expires_at": past})
    assert r.status_code == 200 and r.json()["override"] is None and r.json()["expired"] is True
    await client.post("/api/conversations", headers=headers, json={"name": "a"})
    assert (await client.post("/api/conversations", headers=headers, json={"name": "b"})).status_code == 429


async def test_unknown_key_and_negative_value_rejected(app, client):
    uid, _ = await register(client, "carol")
    h = await login_as(app, client, "operator")
    assert (await client.put(f"/api/admin/users/{uid}/quotas/nope", headers=h, json={"value": 1})).status_code == 404
    assert (await client.put(f"/api/admin/users/{uid}/quotas/max_vocab_items", headers=h, json={"value": -1})).status_code == 422
    assert (await client.put("/api/admin/users/99999999/quotas/max_vocab_items", headers=h, json={"value": 1})).status_code == 404
    assert (await client.delete(f"/api/admin/users/{uid}/quotas/max_vocab_items", headers=h)).status_code == 404


async def test_viewer_cannot_read_or_set_quotas(app, client):
    uid, _ = await register(client, "dee")
    h = await login_as(app, client, "viewer")
    assert (await client.get(f"/api/admin/users/{uid}/quotas")).status_code == 403
    assert (await client.put(f"/api/admin/users/{uid}/quotas/max_vocab_items", headers=h, json={"value": 1})).status_code == 403


async def test_cache_respects_expiry_and_invalidation(app, client):
    uid, _ = await register(client, "eve")
    ticks = [0.0]
    cache = QuotaCache(ttl_seconds=30, clock=lambda: ticks[0])
    now = datetime.now(timezone.utc)
    async with app.state.sessionmaker() as s:
        s.add(UserQuotaOverride(user_id=uid, key="max_vocab_items", value=7, expires_at=now + timedelta(hours=1),
                                updated_by="t"))
        await s.commit()
        assert await cache.get(s, uid, now) == {"max_vocab_items": 7}
        assert await cache.get(s, uid, now + timedelta(hours=2)) == {}  # lapses without a reload
        row = await s.get(UserQuotaOverride, (uid, "max_vocab_items"))
        row.value = 8
        await s.commit()
        assert (await cache.get(s, uid, now))["max_vocab_items"] == 7  # cached
        cache.invalidate(uid)
        assert (await cache.get(s, uid, now))["max_vocab_items"] == 8
        assert await effective(s, app.state.settings, uid, "max_vocab_items") == 8
        assert await effective(s, app.state.settings, uid, "max_practice_items") == app.state.settings.max_practice_items


async def test_recording_quota_override(app, client):
    from app.services.assessment_store import QuotaExceeded, check_quota

    uid, _ = await register(client, "fin")
    settings = app.state.settings
    async with app.state.sessionmaker() as s:
        await check_quota(s, settings, uid, 1024)  # site default (500 MB) allows it
        s.add(UserQuotaOverride(user_id=uid, key="recording_quota_mb", value=0, updated_by="t"))
        await s.commit()
        with pytest.raises(QuotaExceeded):
            await check_quota(s, settings, uid, 1024)
