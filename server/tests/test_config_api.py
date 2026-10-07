import json
import re
from pathlib import Path

import pytest

from app.config import Settings
from app.routers import config_api
from app.routers.config_api import VoiceListError, apply_overrides, load_volcengine_voices, rewrite_tts

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
async def test_preset_already_configured_is_kept_when_azure_is_first(client):
    data = await _fetch(client, "default_tts_preset")
    assert data["configuration"]["tts"] == {"engine": "enjoyai", "model": "openai/tts-1", "voice": "alloy"}


def test_rewrite_to_azure_uses_azure_default_voice():
    preset = {"engine": "enjoyai", "configuration": {"tts": {"model": "x/y", "voice": "alloy"}}}
    rewrite_tts(preset, ["azure/speech"])
    assert preset["configuration"]["tts"] == {"model": "azure/speech", "voice": "en-US-AvaNeural"}


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


async def _volc_voices(client):
    data = (await client.get("/api/config/tts_providers_v2")).json()
    voices = data["enjoyai"]["voices"]
    assert "azure" in voices and "openai" in voices
    return voices["volcengine"]


async def test_volcengine_voice_counts(client):
    voices = await _volc_voices(client)
    assert len(voices) == 158
    langs = {}
    for v in voices:
        assert set(v) == {"label", "value", "language", "accent"}
        langs[v["language"]] = langs.get(v["language"], 0) + 1
    assert langs == {"zh-CN": 90, "en-US": 64, "en-GB": 4}


async def test_volcengine_voice_accent(client):
    voices = await _volc_voices(client)
    accents = {}
    for v in voices:
        accents.setdefault(v["accent"], []).append(v["language"])
    assert {k: len(x) for k, x in accents.items()} == {"other": 90, "us": 64, "gb": 4}
    assert set(accents["us"]) == {"en-US"} and set(accents["gb"]) == {"en-GB"}


def test_derive_accent():
    d = config_api.derive_accent
    assert d("en-US", "x") == "us"
    assert d("en-GB", "x") == "gb"
    assert d("en-AU", "x") == "other"
    assert d("en-US", "en_female_authoritative-british_uranus_bigtts") == "gb"
    assert d("zh-CN", "zh_female_vv_uranus_bigtts") == "other"


async def test_volcengine_voice_values(client):
    voices = await _volc_voices(client)
    values = [v["value"] for v in voices]
    assert len(set(values)) == len(values)
    for value in values:
        assert re.fullmatch(r"(en|zh)_(male|female)_.+_uranus_bigtts", value)
        assert "ICL_" not in value


async def test_volcengine_known_voices_and_default(client):
    voices = await _volc_voices(client)
    by_value = {v["value"]: v for v in voices}
    assert by_value["en_male_tim_uranus_bigtts"]["label"] == "Tim (Male)"
    assert by_value["en_female_dacey_uranus_bigtts"]["label"] == "Dacey (Female)"
    assert by_value["en_female_stokie_uranus_bigtts"]["label"] == "Stokie (Female)"
    assert by_value["en_female_dacey_uranus_bigtts"]["language"] == "en-US"
    assert config_api.DEFAULT_VOICES["volcengine/"] in by_value
    gb = [v["label"].split(" (")[0] for v in voices if v["language"] == "en-GB"]
    assert gb == ["Charlotte", "Alfred", "Knightley", "Russell"]


async def test_volcengine_voices_follow_file_order(client):
    raw = json.loads((STATIC / "volcengine_voices.json").read_text(encoding="utf-8"))
    voices = await _volc_voices(client)
    assert [v["value"] for v in voices] == [r[1] for r in raw]
    assert voices[0]["label"] == f"{raw[0][0]} ({'Male' if raw[0][3] == 'M' else 'Female'})"


def test_voice_file_missing_raises(tmp_path):
    with pytest.raises(VoiceListError, match="volcengine_voices"):
        load_volcengine_voices(tmp_path / "volcengine_voices.json")


@pytest.mark.parametrize(
    "content",
    [
        "not json",
        '{"a": 1}',
        '[["Tim", "en_male_tim_uranus_bigtts", "en-US"]]',
        '[["Tim", "en_male_tim_uranus_bigtts", "en-US", "X"]]',
        '[["Tim", "en_male_tim_uranus_bigtts", "en-US", 1]]',
        '[["Tim", "a", "en-US", "M"], ["Tom", "a", "en-US", "M"]]',
    ],
)
def test_voice_file_corrupt_raises(tmp_path, content):
    path = tmp_path / "volcengine_voices.json"
    path.write_text(content, encoding="utf-8")
    with pytest.raises(VoiceListError, match="volcengine_voices"):
        load_volcengine_voices(path)
