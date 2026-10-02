import json
from pathlib import Path

import pytest

STATIC = Path(__file__).resolve().parent.parent / "app" / "static_config"
KEYS = [
    "ipa_mappings",
    "gpt_providers",
    "tts_providers_v2",
    "chat_agent_templates",
    "gpt_presets",
    "default_gpt_preset",
    "default_tts_preset",
    "ytb_channels",
]


@pytest.mark.parametrize("key", KEYS)
def test_snapshot_exists_and_is_json(key):
    data = json.loads((STATIC / f"{key}.json").read_text(encoding="utf-8"))
    assert data, f"{key} snapshot is empty"
