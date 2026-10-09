from datetime import datetime, timedelta, timezone

import pytest

from app.admin import usage
from app.core.runtime_settings import OverrideError, compose
from app.models import UpstreamCall, UsageDaily, User
from tests.admin_helpers import ADMIN_ENABLED, assert_no_secrets, login_as

NOW = datetime(2026, 10, 9, 9, tzinfo=timezone.utc)
PRICES = '{"llm:deepseek-v4-flash": {"in_per_1k": 0.001, "out_per_1k": 0.002}, "tts:*": {"per_1k_chars": 0.3}}'


def test_parse_and_estimate():
    prices = usage.parse_prices(PRICES)
    row = UpstreamCall(kind="llm", provider="deepseek", model="deepseek-v4-flash", units_in=2000, units_out=1000, unit="tokens")
    assert usage.estimate(row, prices) == pytest.approx(0.004)
    tts = UpstreamCall(kind="tts", provider="volcengine", model="seed-tts-2.0", units_in=500, units_out=0, unit="chars")
    assert usage.estimate(tts, prices) == pytest.approx(0.15)
    assert usage.estimate(UpstreamCall(kind="stt", provider="x", model="y", units_in=1, units_out=0, unit="audio_ms"), prices) is None
    with pytest.raises(ValueError):
        usage.parse_prices('{"llm:x": {"in_per_1k": -1}}')


def test_price_lookup_order_and_units():
    prices = usage.parse_prices('{"tts:volcengine/seed-tts-2.0": {"per_1k_chars": 1}, "tts:*": {"per_1k_chars": 9},'
                                ' "stt:*": {"per_minute": 0.06}, "assess_azure:speech": {"per_call": 0.01}}')
    tts = UpstreamCall(kind="tts", provider="volcengine", model="seed-tts-2.0", units_in=1000, units_out=0, unit="chars")
    assert usage.estimate(tts, prices) == pytest.approx(1.0)
    stt = UpstreamCall(kind="stt", provider="w", model="m", units_in=120_000, units_out=0, unit="audio_ms")
    assert usage.estimate(stt, prices) == pytest.approx(0.12)
    azure = UpstreamCall(kind="assess_azure", provider="azure", model="speech", units_in=0, units_out=0, unit="calls")
    assert usage.estimate(azure, prices) == pytest.approx(0.01)
    stream = UpstreamCall(kind="tts", provider="v", model="x", units_in=0, units_out=10, unit="bytes")
    assert usage.estimate(stream, prices) is None
    for bad in ("[]", '{"nocolon": {}}', '{"llm:x": {"per_token": 1}}', '{"llm:x": {"in_per_1k": true}}', "{"):
        with pytest.raises(ValueError):
            usage.parse_prices(bad)


@pytest.fixture
def settings_overrides(request):
    return {**ADMIN_ENABLED, "usage_prices_json": PRICES, **getattr(request, "param", {})}


async def test_summary_top_users_and_error_buckets(app, client):
    async with app.state.sessionmaker() as s:
        s.add_all([User(id=1, username="a", password_hash="x"), User(id=2, username="b", password_hash="x")])
        rows = [(1, 200, 2000, 1000), (1, 402, 0, 0), (2, 429, 0, 0), (2, 200, 1000, 500), (2, 0, 0, 0)]
        for uid, status, i, o in rows:
            s.add(UpstreamCall(at=NOW - timedelta(hours=1), user_id=uid, feature="chat", kind="llm", provider="deepseek",
                               model="deepseek-v4-flash", status=status, ms=300, units_in=i, units_out=o, unit="tokens"))
        await s.commit()
        out = await usage.summary(s, app.state.settings, 7, NOW)
        top = await usage.top_users(s, app.state.settings, 7, "cost", 10, NOW)
    assert out["totals"]["calls"] == 5 and out["totals"]["errors"] == 3
    assert out["errors"] == {"402": 1, "429": 1, "auth": 0, "5xx": 0, "network": 1}
    assert out["totals"]["cost"] == pytest.approx(0.004 + 0.002)
    assert out["totals"]["cost_complete"] is True and out["totals"]["active_users"] == 2
    assert out["totals"]["p50_ms"] == 300 and out["totals"]["error_rate"] == pytest.approx(0.6)
    assert [t["username"] for t in top] == ["a", "b"]
    await login_as(app, client, "viewer")
    r = await client.get("/api/admin/usage/summary", params={"days": 7})
    assert r.status_code == 200 and r.json()["currency"] == "CNY"
    assert_no_secrets(r.json(), app.state.settings)
    assert (await client.get("/api/admin/usage/summary", params={"days": 5})).status_code == 422
    # endpoints use the real clock: the rows above are in the past relative to "now" only if NOW <= now
    r = await client.get("/api/admin/usage/top-users", params={"days": 90, "by": "calls"})
    assert r.status_code == 200 and isinstance(r.json()["items"], list)
    assert (await client.get("/api/admin/usage/top-users", params={"by": "nope"})).status_code == 422


async def test_daily_rollups_join_the_raw_rows_and_missing_prices(app):
    async with app.state.sessionmaker() as s:
        s.add(UsageDaily(day=(NOW - timedelta(days=20)).date().isoformat(), feature="audio", kind="stt", provider="w",
                         model="whisper-1", user_id=0, calls=4, errors=1, units_in=60_000, units_out=0, ms_total=10))
        s.add(UpstreamCall(at=NOW - timedelta(minutes=5), user_id=None, feature="chat", kind="llm", provider="deepseek",
                           model="deepseek-v4-flash", status=200, ms=50, units_in=0, units_out=99, unit="bytes"))
        await s.commit()
        out = await usage.summary(s, app.state.settings, 30, NOW)
        assert out["totals"]["calls"] == 5 and out["totals"]["errors"] == 1
        assert out["totals"]["cost_complete"] is False  # stt has no price, the stream is in bytes
        assert out["totals"]["active_users"] == 0
        assert [d["day"] for d in out["daily"]] == sorted(d["day"] for d in out["daily"])
        assert [d["features"] for d in out["daily"]] == [{"audio": 4}, {"chat": 1}]
        stt = next(m for m in out["by_model"] if m["kind"] == "stt")
        assert (stt["unit"], stt["units_in"], stt["cost"]) == ("audio_ms", 60_000, None)
        week = await usage.summary(s, app.state.settings, 7, NOW)
        assert week["totals"]["calls"] == 1
        assert await usage.missing_prices(s, app.state.settings, NOW) == ()
        s.add(UpstreamCall(at=NOW - timedelta(minutes=1), user_id=None, feature="audio", kind="stt", provider="w",
                           model="whisper-1", status=500, ms=50, units_in=10, units_out=0, unit="audio_ms"))
        await s.commit()
        assert await usage.missing_prices(s, app.state.settings, NOW) == ("stt:whisper-1",)
        health = await usage.health(s, NOW)
        stt_h = next(h for h in health if h["kind"] == "stt")
        assert (stt_h["calls"], stt_h["errors"], stt_h["success_rate"], stt_h["last_error_status"]) == (1, 1, 0.0, 500)


async def test_bad_prices_are_rejected_by_the_hub_and_ignored_from_env(app):
    with pytest.raises(OverrideError):
        app.state.settings_hub.prepare(compose(app.state.base_settings, {"usage_prices_json": '{"llm:x": {"in_per_1k": -2}}'}))
    bad = compose(app.state.base_settings, {"usage_prices_json": '{"llm:x": {"in_per_1k": -2}}'})
    assert usage.prices_for(bad) == {}


async def test_usage_endpoints_need_a_session(app, client):
    assert (await client.get("/api/admin/usage/summary")).status_code == 401
    assert (await client.get("/api/admin/usage/health")).status_code == 401
