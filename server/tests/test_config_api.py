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


async def test_tts_providers_only_keeps_enjoyai(client):
    data = (await client.get("/api/config/tts_providers_v2")).json()
    assert list(data) == ["enjoyai"]


# ---- volcengine voices + preset TTS rewriting ----
import json
from pathlib import Path

import pytest

STATIC = Path(__file__).resolve().parent.parent / "app" / "static_config"
VOLC = {"tts_models": "volcengine/seed-tts-2.0"}


def _snapshot(key):
    return json.loads((STATIC / f"{key}.json").read_text(encoding="utf-8"))


def _tts_cfgs(data, key):
    # Real TTS path in every snapshot: preset["configuration"]["tts"] = {engine, model, voice, ...}
    presets = data if key == "gpt_presets" else [data]
    return [(p, p["configuration"]["tts"]) for p in presets]


async def _fetch(client, key):
    return (await client.get(f"/api/config/{key}")).json()


@pytest.mark.parametrize("settings_overrides", [VOLC], indirect=True)
@pytest.mark.parametrize("key", ["gpt_presets", "default_gpt_preset", "default_tts_preset"])
async def test_presets_rewritten_to_volcengine(client, key):
    data = await _fetch(client, key)
    pairs = _tts_cfgs(data, key)
    assert pairs
    for preset, tts in pairs:
        assert preset["engine"] == "enjoyai"
        assert tts["model"] == "volcengine/seed-tts-2.0"
        assert tts["voice"] == "en_female_dacey_uranus_bigtts"
        assert tts["engine"] == "enjoyai"


@pytest.mark.parametrize("settings_overrides", [{"tts_models": "azure/speech,openai/tts-1"}], indirect=True)
async def test_presets_rewritten_to_first_model_keeps_azure_voice(client):
    # first model azure/speech: model is rewritten, voice is kept as is
    data = await _fetch(client, "default_tts_preset")
    assert data["configuration"]["tts"] == {"engine": "enjoyai", "model": "openai/tts-1", "voice": "alloy"}
    from app.routers.config_api import rewrite_tts

    preset = {"engine": "enjoyai", "configuration": {"tts": {"model": "x/y", "voice": "v"}}}
    rewrite_tts(preset, ["azure/speech"])
    assert preset["configuration"]["tts"] == {"model": "azure/speech", "voice": "v"}


@pytest.mark.parametrize("settings_overrides", [{"tts_models": "volcengine/seed-tts-2.0,openai/tts-1"}], indirect=True)
async def test_preset_already_in_list_is_kept(client):
    # bare "tts-1" in gpt_presets means openai/tts-1, which is configured -> untouched
    data = await _fetch(client, "gpt_presets")
    for _, tts in _tts_cfgs(data, "gpt_presets"):
        assert tts["model"] == "tts-1" and tts["voice"] == "alloy"


@pytest.mark.parametrize("key", ["gpt_presets", "default_gpt_preset", "default_tts_preset"])
async def test_presets_unchanged_with_default_tts_models(client, key):
    data = await _fetch(client, key)
    for _, tts in _tts_cfgs(data, key):
        assert tts["voice"] == "alloy" and tts["model"] in ("tts-1", "openai/tts-1")
    expected = _snapshot(key)
    if key == "default_tts_preset":
        assert data == expected
    elif key == "default_gpt_preset":
        expected["configuration"]["model"] = "gpt-4o"
        assert data == expected


async def test_non_enjoyai_presets_untouched():
    from app.config import Settings
    from app.routers.config_api import apply_overrides

    settings = Settings(_env_file=None, tts_models="volcengine/seed-tts-2.0")
    other = {
        "key": "x",
        "engine": "openai",
        "configuration": {"tts": {"engine": "openai", "model": "tts-1", "voice": "alloy"}},
    }
    mine = {
        "key": "y",
        "engine": "enjoyai",
        "configuration": {"tts": {"engine": "enjoyai", "model": "tts-1", "voice": "alloy"}},
    }
    out = apply_overrides("gpt_presets", [other, mine], settings)
    assert out[0]["configuration"]["tts"] == {"engine": "openai", "model": "tts-1", "voice": "alloy"}
    assert out[1]["configuration"]["tts"]["model"] == "volcengine/seed-tts-2.0"


async def test_volcengine_voices_group(client):
    voices = (await client.get("/api/config/tts_providers_v2")).json()["enjoyai"]["voices"]
    assert voices["volcengine"] == [
        {"label": "Tim (Male)", "value": "en_male_tim_uranus_bigtts", "language": "en-US"},
        {"label": "Dacey (Female)", "value": "en_female_dacey_uranus_bigtts", "language": "en-US"},
        {"label": "Stokie (Female)", "value": "en_female_stokie_uranus_bigtts", "language": "en-US"},
    ]
    assert "azure" in voices and "openai" in voices
