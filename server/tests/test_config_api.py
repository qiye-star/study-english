async def test_ipa_mappings(client):
    r = await client.get("/api/config/ipa_mappings")
    assert r.status_code == 200
    assert r.json()["p"] == "p"


async def test_app_version(client):
    r = await client.get("/api/config/app_version")
    assert r.json() == {"version": "0.7.9"}


async def test_gpt_providers_models_come_from_settings(client):
    data = (await client.get("/api/config/gpt_providers")).json()
    assert list(data) == ["enjoyai"]
    assert data["enjoyai"]["models"] == ["gpt-4o-mini", "gpt-4o"]


async def test_tts_models_come_from_settings(client):
    data = (await client.get("/api/config/tts_providers_v2")).json()
    assert data["enjoyai"]["models"] == ["openai/tts-1", "azure/speech"]


async def test_presets_use_default_model(client):
    presets = (await client.get("/api/config/gpt_presets")).json()
    assert presets
    for preset in presets:
        cfg = preset.get("configuration", {})
        if preset.get("engine") == "enjoyai" and "model" in cfg:
            assert cfg["model"] == "gpt-4o"
    default = (await client.get("/api/config/default_gpt_preset")).json()
    assert default["configuration"]["model"] == "gpt-4o"


async def test_other_snapshots_are_served(client):
    for key in ("chat_agent_templates", "default_tts_preset", "ytb_channels"):
        assert (await client.get(f"/api/config/{key}")).status_code == 200


async def test_unknown_and_bugsnag_keys_are_404(client):
    for key in ("nope", "bugsnag_api_key", "discuss"):
        r = await client.get(f"/api/config/{key}")
        assert r.status_code == 404
        assert r.json()["error"] == "Unknown config key"
