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
