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


VOLCENGINE_VOICES_FILE = STATIC / "volcengine_voices.json"


class VoiceListError(RuntimeError):
    pass


def load_volcengine_voices(path: Path = VOLCENGINE_VOICES_FILE) -> list[dict]:
    """Read and validate rows of [name, voice_type, language, "M"|"F"] into client voice dicts."""
    try:
        rows = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise VoiceListError(f"Cannot load {path.name}: {type(e).__name__}") from None
    if not isinstance(rows, list):
        raise VoiceListError(f"Invalid {path.name}: expected a list")
    voices, seen = [], set()
    for i, row in enumerate(rows):
        if (
            not isinstance(row, list)
            or len(row) != 4
            or not all(isinstance(x, str) and x for x in row)
            or row[3] not in ("M", "F")
        ):
            raise VoiceListError(f"Invalid {path.name}: bad row {i}")
        name, value, language, gender = row
        if value in seen:
            raise VoiceListError(f"Invalid {path.name}: duplicate voice {value}")
        seen.add(value)
        label = f"{name} ({'Male' if gender == 'M' else 'Female'})"
        voices.append({"label": label, "value": value, "language": language})
    return voices


# Loaded and validated once at import, so a corrupt file fails server startup.
VOLCENGINE_VOICES = load_volcengine_voices()


def _set_model(preset: dict, model: str) -> None:
    cfg = preset.get("configuration")
    if preset.get("engine") == "enjoyai" and isinstance(cfg, dict) and "model" in cfg:
        cfg["model"] = model


DEFAULT_VOICES = {"volcengine/": "en_female_dacey_uranus_bigtts", "openai/": "alloy"}


def _canonical_model(model: str) -> str:
    # Snapshots sometimes carry the bare OpenAI name ("tts-1") the client strips to.
    return model if "/" in model else f"openai/{model}"


def rewrite_tts(preset: dict, tts_models: list[str]) -> None:
    """Point an enjoyai preset's TTS model/voice at a configured model."""
    cfg = preset.get("configuration")
    tts = cfg.get("tts") if isinstance(cfg, dict) else None
    if preset.get("engine") != "enjoyai" or not isinstance(tts, dict) or not tts_models:
        return
    model = tts.get("model")
    if isinstance(model, str) and _canonical_model(model) in tts_models:
        return
    tts["model"] = tts_models[0]
    for prefix, voice in DEFAULT_VOICES.items():
        if tts_models[0].startswith(prefix):
            tts["voice"] = voice
            break


def apply_overrides(key: str, data, settings: Settings):
    if key == "gpt_providers" and "enjoyai" in data:
        data["enjoyai"]["models"] = settings.llm_model_list
    elif key == "tts_providers_v2" and "enjoyai" in data:
        for name in [k for k in data if k != "enjoyai"]:
            del data[name]
        data["enjoyai"]["models"] = settings.tts_model_list
        data["enjoyai"].setdefault("voices", {})["volcengine"] = [dict(v) for v in VOLCENGINE_VOICES]
    elif key == "gpt_presets":
        for preset in data:
            _set_model(preset, settings.default_llm_model)
            rewrite_tts(preset, settings.tts_model_list)
    elif key == "default_gpt_preset":
        _set_model(data, settings.default_llm_model)
        rewrite_tts(data, settings.tts_model_list)
    elif key == "default_tts_preset":
        rewrite_tts(data, settings.tts_model_list)
    return data


@router.get("/config/{key}")
async def get_config(key: str, settings: Settings = Depends(get_settings)):
    if key == "app_version":
        return {"version": settings.app_version}
    if key not in SNAPSHOT_KEYS:
        raise HTTPException(404, "Unknown config key")
    data = json.loads((STATIC / f"{key}.json").read_text(encoding="utf-8"))
    return apply_overrides(key, data, settings)
