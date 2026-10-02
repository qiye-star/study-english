import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from app.config import Settings
from app.deps import get_settings

router = APIRouter(prefix="/api")

STATIC = Path(__file__).resolve().parent.parent / "static_config"
SNAPSHOT_KEYS = {
    "ipa_mappings",
    "gpt_providers",
    "tts_providers_v2",
    "chat_agent_templates",
    "gpt_presets",
    "default_gpt_preset",
    "default_tts_preset",
    "ytb_channels",
}


def _set_model(preset: dict, model: str) -> None:
    cfg = preset.get("configuration")
    if preset.get("engine") == "enjoyai" and isinstance(cfg, dict) and "model" in cfg:
        cfg["model"] = model


def apply_overrides(key: str, data, settings: Settings):
    if key == "gpt_providers" and "enjoyai" in data:
        data["enjoyai"]["models"] = settings.llm_model_list
    elif key == "tts_providers_v2" and "enjoyai" in data:
        for name in [k for k in data if k != "enjoyai"]:
            del data[name]
        data["enjoyai"]["models"] = settings.tts_model_list
    elif key == "gpt_presets":
        for preset in data:
            _set_model(preset, settings.default_llm_model)
    elif key == "default_gpt_preset":
        _set_model(data, settings.default_llm_model)
    return data


@router.get("/config/{key}")
async def get_config(key: str, settings: Settings = Depends(get_settings)):
    if key == "app_version":
        return {"version": settings.app_version}
    if key not in SNAPSHOT_KEYS:
        raise HTTPException(404, "Unknown config key")
    data = json.loads((STATIC / f"{key}.json").read_text(encoding="utf-8"))
    return apply_overrides(key, data, settings)
