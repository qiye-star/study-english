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

    # 语音识别:chat = 沿用 UPSTREAM_WHISPER_MODE 的现有路径;volc_stream = 火山大模型流式识别,
    # 失败时回退到现有路径(已配置时)。密钥默认复用 VOLCENGINE_TTS_KEY。
    upstream_asr_mode: Literal["chat", "volc_stream"] = "chat"
    asr_stream_url: str = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_nostream"
    asr_stream_resource_id: str = "volc.bigasr.sauc.duration"
    asr_stream_timeout_seconds: float = 30.0
    # 每个进程同时进行的流式识别上限;超出的请求直接走回退路径,不连接火山
    asr_stream_max_concurrency: int = 3
    volcengine_asr_key: str = ""

    azure_speech_key: str = ""
    azure_speech_region: str = ""

    xfyun_app_id: str = ""
    xfyun_api_key: str = ""
    xfyun_api_secret: str = ""
    xfyun_ws_url: str = "wss://ise-api.xfyun.cn/v2/open-ise"

    # ---- 网页版(设计文档 2026-10-04)----
    data_dir: str = ""
    recording_quota_mb: int = 500
    # 未关联任何消息的对话录音(source=chat)超过该小时数后,在该用户下次保存对话录音时被清理
    chat_orphan_grace_hours: int = 6
    max_conversations: int = 200
    max_messages_per_conversation: int = 1000
    web_dist_dir: str = ""

    # ---- 对话增强(设计文档 2026-10-05)----
    grammar_model: str = ""
    upstream_grammar_base_url: str = ""
    upstream_grammar_key: str = ""
    grammar_prompt: str = ""
    grammar_prompt_file: str = ""
    max_practice_items: int = 500
    max_vocab_items: int = 2000

    app_version: str = "0.7.9"

    @property
    def llm_model_list(self) -> list[str]:
        return _split(self.llm_models)

    @property
    def asr_stream_key(self) -> str:
        return self.volcengine_asr_key or self.volcengine_tts_key

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

    @property
    def resolved_grammar_model(self) -> str:
        return self.grammar_model.strip() or self.default_llm_model

    @property
    def grammar_upstream(self) -> tuple[str, str]:
        """(base_url, key)。设置了 UPSTREAM_GRAMMAR_BASE_URL 就连同它自己的 key 一起用,绝不借用 LLM 的 key。"""
        if self.upstream_grammar_base_url.strip():
            return self.upstream_grammar_base_url.strip(), self.upstream_grammar_key
        return self.upstream_llm_base_url, self.upstream_llm_key
