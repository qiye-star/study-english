from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url


def _split(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite+aiosqlite:///./data/app.db"

    registration_mode: Literal["open", "invite", "closed"] = "open"
    invite_code: str = ""
    trust_proxy_headers: bool = False
    rate_limit_per_minute: int = 10
    ai_rate_limit_per_minute: int = 60
    llm_max_tokens: int = 4096

    upstream_llm_base_url: str = ""
    upstream_llm_key: str = ""
    llm_models: str = "gpt-4o-mini,gpt-4o"
    default_llm_model: str = "gpt-4o"

    upstream_tts_base_url: str = ""
    upstream_tts_key: str = ""
    tts_models: str = "openai/tts-1,azure/speech"

    upstream_whisper_base_url: str = ""
    upstream_whisper_key: str = ""
    upstream_whisper_mode: Literal["openai", "chat"] = "openai"
    upstream_whisper_model: str = ""

    volcengine_tts_key: str = ""
    volcengine_tts_url: str = "https://openspeech.bytedance.com/api/v3/tts/unidirectional"

    azure_speech_key: str = ""
    azure_speech_region: str = ""

    xfyun_app_id: str = ""
    xfyun_api_key: str = ""
    xfyun_api_secret: str = ""
    xfyun_ws_url: str = "wss://ise-api.xfyun.cn/v2/open-ise"

    # ---- 网页版(设计文档 2026-10-04)----
    data_dir: str = ""
    recording_quota_mb: int = 500
    max_conversations: int = 200
    max_messages_per_conversation: int = 1000
    web_dist_dir: str = ""

    app_version: str = "0.7.9"

    @property
    def llm_model_list(self) -> list[str]:
        return _split(self.llm_models)

    @property
    def tts_model_list(self) -> list[str]:
        return _split(self.tts_models)

    @property
    def resolved_data_dir(self) -> Path:
        if self.data_dir:
            return Path(self.data_dir)
        url = make_url(self.database_url)
        if url.get_backend_name() == "sqlite" and url.database and url.database != ":memory:":
            return Path(url.database).resolve().parent
        return Path("/data")
