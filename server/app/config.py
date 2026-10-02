from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


def _split(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite+aiosqlite:///./data/app.db"

    registration_mode: Literal["open", "invite", "closed"] = "open"
    invite_code: str = ""
    trust_proxy_headers: bool = False
    rate_limit_per_minute: int = 10

    upstream_llm_base_url: str = ""
    upstream_llm_key: str = ""
    llm_models: str = "gpt-4o-mini,gpt-4o"
    default_llm_model: str = "gpt-4o"

    upstream_tts_base_url: str = ""
    upstream_tts_key: str = ""
    tts_models: str = "openai/tts-1,azure/speech"

    upstream_whisper_base_url: str = ""
    upstream_whisper_key: str = ""

    azure_speech_key: str = ""
    azure_speech_region: str = ""

    app_version: str = "0.7.9"

    @property
    def llm_model_list(self) -> list[str]:
        return _split(self.llm_models)

    @property
    def tts_model_list(self) -> list[str]:
        return _split(self.tts_models)
