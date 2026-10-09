import ipaddress
from datetime import date
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url


def _split(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


THINKING_TRUE = {"true", "1", "yes", "on"}
THINKING_FALSE = {"false", "0", "no", "off"}
LLM_THINKING_HOST_SUFFIXES = ("deepseek.com", "volces.com")
STT_THINKING_HOST_SUFFIXES = ("volces.com",)


def parse_thinking_mode(value) -> str:
    """auto / true / false;大小写不敏感,兼容旧的布尔写法,无法识别的值按 auto(不报错)。"""
    if isinstance(value, bool):
        return "true" if value else "false"
    text = str(value).strip().lower() if value is not None else ""
    if text in THINKING_TRUE:
        return "true"
    if text in THINKING_FALSE:
        return "false"
    return "auto"


def host_matches(base_url: str, suffixes: tuple[str, ...]) -> bool:
    """主机恰好等于某后缀,或是它的子域(点边界);伪造的相似域名不匹配。"""
    try:
        host = (urlsplit((base_url or "").strip()).hostname or "").rstrip(".").lower()
    except ValueError:
        return False
    return any(host == s or host.endswith("." + s) for s in suffixes)


def send_thinking_param(mode: str, base_url: str, suffixes: tuple[str, ...]) -> bool:
    if mode == "true":
        return True
    if mode == "false":
        return False
    return host_matches(base_url, suffixes)


class Settings(BaseSettings):
    # hide_input_in_errors: a ValidationError must never echo a value back (secrets live in these fields)
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", hide_input_in_errors=True)

    database_url: str = "sqlite+aiosqlite:///./data/app.db"
    log_level: str = "INFO"

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

    # ---- 语音提速与实时通话(设计文档 2026-10-07)----
    stt_max_tokens: int = 512
    # auto(默认)= 仅当识别上游主机是方舟(volces.com)时发送 `thinking`;true = 总是发送;false = 从不发送
    stt_disable_thinking: Literal["auto", "true", "false"] = "auto"
    # UPSTREAM_ASR_MODE / ASR_STREAM_URL / ASR_STREAM_RESOURCE_ID / VOLCENGINE_ASR_KEY 已存在(spike 提交)
    asr_realtime_url: str = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async"
    realtime_asr_mode: Literal["buffered", "stream"] = "buffered"
    realtime_enabled: bool = False
    realtime_max_minutes: int = Field(10, ge=1, le=60)
    realtime_idle_timeout_seconds: int = Field(60, ge=10, le=600)
    realtime_max_sessions: int = Field(5, ge=1, le=100)
    realtime_ticket_ttl_seconds: int = Field(60, ge=10, le=300)
    realtime_tts_model: str = "volcengine/seed-tts-2.0"
    realtime_tts_sample_rate: int = 24000
    # 实时通话的 LLM 请求加 `thinking: {"type": "disabled"}`(复核 4.4-I1):DeepSeek v4 默认会先推理,
    # 推理 token 既拖慢第一句话又占用 600 的 max_tokens。2026-10-07 真实上游两款模型都接受该参数
    # 取值 auto(默认)/ true / false:auto 只对已知接受该参数的上游(deepseek.com、volces.com 及其子域)发送;
    # OpenAI、Azure 等严格的上游会对未知参数返回 400(复核 F5-I1)
    realtime_llm_disable_thinking: Literal["auto", "true", "false"] = "auto"

    @field_validator("stt_disable_thinking", "realtime_llm_disable_thinking", mode="before")
    @classmethod
    def _thinking_mode(cls, value):
        return parse_thinking_mode(value)

    # ---- 段位赛与联机练习(设计文档 2026-10-09)----
    rank_enabled: bool = False
    rank_daily_rp_cap: int = Field(60, ge=10, le=500)
    rank_match_daily_attempts: int = Field(3, ge=1, le=20)
    rank_match_cooldown_minutes: int = Field(30, ge=0, le=1440)
    rank_match_minutes: int = Field(20, ge=5, le=60)
    rank_matches_global_daily: int = Field(200, ge=1, le=100000)
    rank_judge_model: str = ""
    rank_season_anchor: date = date(2026, 11, 2)
    rank_season_weeks: int = Field(8, ge=1, le=52)
    rooms_enabled: bool = False
    rooms_ai_model: str = ""
    rooms_max_active: int = Field(50, ge=1, le=1000)
    rooms_max_members: int = Field(8, ge=2, le=50)
    rooms_max_owned: int = Field(3, ge=1, le=20)
    rooms_idle_minutes: int = Field(30, ge=5, le=1440)
    rooms_max_hours: int = Field(24, ge=1, le=168)
    # 房间消息默认永久保存(产品负责人 2026-10-09);正数 = 房间关闭 N 天后清理
    room_message_retention_days: int = Field(0, ge=0, le=3650)
    rooms_ticket_ttl_seconds: int = Field(60, ge=10, le=300)
    rooms_assist_daily_per_user: int = Field(60, ge=0, le=1000)
    rooms_ai_per_room_hour: int = Field(30, ge=0, le=1000)
    rooms_ai_global_daily: int = Field(1000, ge=0, le=100000)
    rooms_ai_concurrency: int = Field(4, ge=1, le=32)

    # ---- 管理端(设计文档 2026-10-08):账号来自环境变量,任一为空则整个管理端关闭 ----
    admin_username: str = ""
    admin_password: str = ""
    admin_token_ttl_minutes: int = Field(480, ge=5, le=1440)
    # HMAC 密钥;留空则每次启动随机生成(重启后需重新登录)
    admin_session_secret: str = ""
    admin_dist_dir: str = ""

    # ---- 管理后台 v2(设计文档 2026-10-09-admin-console-v2 §3.2)----
    settings_encryption_key: str = ""
    admin_settings_safe_mode: bool = False
    admin_ip_allowlist: str = ""
    admin_cookie_secure: bool = True
    admin_totp_secret: str = ""
    admin_require_totp: bool = False
    admin_idle_minutes: int = Field(30, ge=5, le=240)
    admin_lockout_threshold: int = Field(5, ge=3, le=20)
    admin_lockout_minutes: int = Field(15, ge=1, le=1440)
    admin_step_up_minutes: int = Field(5, ge=1, le=30)
    admin_audit_retention_days: int = Field(365, ge=30, le=3650)
    maintenance_mode: Literal["off", "read_only", "full"] = "off"
    maintenance_message_zh: str = Field("", max_length=280)
    maintenance_message_en: str = Field("", max_length=280)
    usage_prices_json: str = "{}"
    usage_currency: str = "CNY"
    usage_raw_retention_days: int = Field(90, ge=7, le=730)
    backup_dir: str = ""
    backup_keep: int = Field(7, ge=1, le=60)
    backup_hour_utc: int = Field(-1, ge=-1, le=23)
    build_sha: str = ""

    @field_validator("admin_ip_allowlist")
    @classmethod
    def _cidrs(cls, value: str) -> str:
        for item in _split(value):
            try:
                ipaddress.ip_network(item, strict=False)
            except ValueError:
                raise ValueError("invalid CIDR") from None
        return value

    @field_validator("settings_encryption_key")
    @classmethod
    def _fernet_key(cls, value: str) -> str:
        if value.strip():
            from app.core.secretbox import SecretBox, SecretBoxError

            try:
                SecretBox(value)
            except SecretBoxError:
                raise ValueError("SETTINGS_ENCRYPTION_KEY is not a valid Fernet key") from None
        return value

    app_version: str = "0.7.9"

    @property
    def admin_ip_networks(self) -> list:
        return [ipaddress.ip_network(item, strict=False) for item in _split(self.admin_ip_allowlist)]

    @property
    def resolved_backup_dir(self) -> Path:
        return Path(self.backup_dir) if self.backup_dir else self.resolved_data_dir / "backups"

    @property
    def admin_enabled(self) -> bool:
        return bool(self.admin_username.strip() and self.admin_password)

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

    @property
    def asr_stream_enabled(self) -> bool:
        return self.upstream_asr_mode == "volc_stream"

    @property
    def resolved_rank_judge_model(self) -> str:
        return self.rank_judge_model.strip() or self.default_llm_model

    @property
    def resolved_rooms_ai_model(self) -> str:
        return self.rooms_ai_model.strip() or self.default_llm_model

    @property
    def rank_match_available(self) -> bool:
        """晋级赛需要 LLM(考官 + 评委)和语音识别(火山流式或 Whisper/chat 回退)。"""
        return (
            self.rank_enabled
            and bool(self.upstream_llm_base_url)
            and (asr_stream_usable(self) or whisper_fallback_configured(self))
        )

    @property
    def rooms_ai_available(self) -> bool:
        return self.rooms_enabled and bool(self.upstream_llm_base_url)

    @property
    def realtime_available(self) -> bool:
        return (
            self.realtime_enabled
            and bool(self.volcengine_tts_key)
            and self.realtime_tts_model in self.tts_model_list
            and bool(self.upstream_llm_base_url)
            and realtime_asr_configured(self)
        )


# --- ASR configuration predicates -------------------------------------------------------------
# Pure functions of the settings (duck-typed, so tests may pass a SimpleNamespace). They live here,
# not in the speech layer, because `Settings.realtime_available` needs them and the core layer must
# not import speech modules (server layering, enforced by tests/test_architecture.py). The speech
# modules re-export them under their historical names (`asr._fallback_configured`,
# `realtime_asr.effective_realtime_asr`, ...), which stay the call sites' entry points.

RealtimeAsr = Literal["stream", "buffered"]


def whisper_fallback_configured(settings) -> bool:
    if not settings.upstream_whisper_base_url:
        return False
    return settings.upstream_whisper_mode != "chat" or bool(settings.upstream_whisper_model)


def asr_stream_usable(settings) -> bool:
    return settings.asr_stream_enabled and bool(settings.asr_stream_key)


def effective_realtime_asr(settings) -> RealtimeAsr:
    if settings.realtime_asr_mode == "stream" and settings.asr_stream_key:
        return "stream"
    return "buffered"


def realtime_asr_configured(settings) -> bool:
    """Whether `realtime_providers.make_recognizers` can build a recognizer (review 4.1-m2).
    `Settings.realtime_available` uses this, so the config/ticket endpoints never report a call
    that would fail with 4502 at once, nor hide one that works. Stream needs only its key; buffered
    needs the volc upload path or a usable chat/Whisper path (chat mode needs a model)."""
    if effective_realtime_asr(settings) == "stream":
        return True
    return asr_stream_usable(settings) or whisper_fallback_configured(settings)
