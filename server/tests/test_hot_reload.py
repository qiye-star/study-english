import pytest

from app.core.runtime_settings import compose


async def test_new_requests_see_new_settings_and_core_listeners_apply(app, client, auth_headers):
    hub = app.state.settings_hub
    before = app.state.grammar_rules
    hub.publish(compose(app.state.base_settings, {
        "ai_rate_limit_per_minute": 2, "realtime_ticket_ttl_seconds": 30, "realtime_max_sessions": 9,
        "grammar_prompt": "Only flag article errors.", "log_level": "WARNING", "registration_mode": "closed",
    }))
    assert app.state.user_limiter.limit == 2
    assert app.state.realtime_tickets._ttl == 30
    assert app.state.realtime_registry._max == 9
    assert app.state.grammar_rules != before and "article" in app.state.grammar_rules
    r = await client.post("/api/users", json={"username": "bob", "password": "password123"})
    assert r.status_code == 403  # registration closed is read per request


async def test_provider_clients_are_rebuilt_after_key_change(app):
    app.state.azure = object()
    app.state.settings_hub.publish(compose(app.state.base_settings, {"azure_speech_region": "westus"}))
    assert not hasattr(app.state, "azure")


@pytest.mark.parametrize("settings_overrides", [{"rooms_enabled": True}], indirect=True)
async def test_live_room_connections_follow_hot_reloaded_limits(app):
    """Review correctness m12: a connection captured RoomLimits and rooms_ai_available at connect time."""
    from app.routers.rooms import deps_for, runtime

    rt = runtime(app)
    deps = deps_for(app, rt, app.state.settings)  # one live connection's dependencies
    old = deps.limits.ai_global_daily
    app.state.settings_hub.publish(app.state.settings.model_copy(update={"rooms_ai_global_daily": old + 7}))
    assert deps.limits.ai_global_daily == old + 7
    assert deps.ai_available is True
    app.state.settings_hub.publish(app.state.settings.model_copy(update={"upstream_llm_base_url": ""}))
    assert deps.ai_available is False
