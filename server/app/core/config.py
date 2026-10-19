import importlib.util
import ipaddress
import re
import shutil
from datetime import date
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url


def _split(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


# = app.wordbook.books.BOOK_IDS(core 不能导入 wordbook 层;tests/test_wordbook_books.py 断言两处一致)
WORDBOOK_BOOK_IDS = ("junior", "senior", "cet4", "cet6", "kaoyan", "toefl", "sat")
WORDBOOK_NEW_BOUNDS = (1, 200)  # 每日新词硬边界(spec 2026-10-11 §3.1);管理员只能在其中收窄
WORDBOOK_REVIEW_BOUNDS = (10, 1000)  # 每日复习上限硬边界;「不限」在库里存 0

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
    # 账号 v2(计划 S2):登录有效天数(每次使用滑动续期,热改);身份 HMAC 密钥(只读环境变量,等同密钥)
    access_token_ttl_days: int = Field(30, ge=1, le=365)
    identity_pepper: str = ""  # env-only secret;丢失或更换 = 所有邮箱登录与唯一性失效
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
    # ---- 联机练习 v2(设计文档 2026-10-10-rooms-v2 §11.2);有上游成本的两个子开关默认关 ----
    rooms_voice_enabled: bool = False
    rooms_voice_max_seconds: int = Field(60, ge=10, le=60)
    rooms_voice_daily_per_user: int = Field(100, ge=0, le=1000)
    rooms_voice_global_daily: int = Field(3000, ge=0, le=100000)
    rooms_voice_quota_mb: int = Field(200, ge=0, le=100000)
    rooms_voice_concurrency: int = Field(4, ge=1, le=32)
    rooms_voice_store_format: Literal["mp3", "wav"] = "mp3"
    rooms_translate_global_daily: int = Field(3000, ge=0, le=100000)
    rooms_summary_enabled: bool = False
    rooms_summary_global_daily: int = Field(200, ge=0, le=10000)
    # ---- 背单词(设计文档 2026-10-10-wordbook §10)----
    wordbook_enabled: bool = False
    wordbook_ai_enabled: bool = False
    wordbook_books: str = ",".join(WORDBOOK_BOOK_IDS)
    wordbook_daily_new: int = Field(20, ge=WORDBOOK_NEW_BOUNDS[0], le=WORDBOOK_NEW_BOUNDS[1])
    wordbook_review_cap: int = Field(100, ge=WORDBOOK_REVIEW_BOUNDS[0], le=WORDBOOK_REVIEW_BOUNDS[1])
    # 用户可选范围(spec 2026-10-11 §10;交叉校验在 runtime_settings.runtime_problems)
    wordbook_daily_new_min: int = Field(1, ge=WORDBOOK_NEW_BOUNDS[0], le=WORDBOOK_NEW_BOUNDS[1])
    wordbook_daily_new_max: int = Field(200, ge=WORDBOOK_NEW_BOUNDS[0], le=WORDBOOK_NEW_BOUNDS[1])
    wordbook_review_cap_min: int = Field(10, ge=WORDBOOK_REVIEW_BOUNDS[0], le=WORDBOOK_REVIEW_BOUNDS[1])
    wordbook_review_cap_max: int = Field(1000, ge=WORDBOOK_REVIEW_BOUNDS[0], le=WORDBOOK_REVIEW_BOUNDS[1])
    wordbook_review_unlimited: bool = True
    wordbook_bonus_max: int = Field(50, ge=0, le=200)
    wordbook_ai_model: str = ""
    wordbook_ai_global_daily: int = Field(200, ge=0, le=100000)
    wordbook_ai_daily_per_user: int = Field(20, ge=0, le=1000)
    # 背单词 v2 · 三档自评与快速回忆(设计文档 2026-10-11-wordbook-recall §7)
    wordbook_spot_check_pct: int = Field(33, ge=0, le=100)
    wordbook_recall_enabled: bool = True
    wordbook_autoplay: bool = True
    wordbook_show_example: bool = True
    wordbook_data_dir: str = ""

    # 学习联动(spec 2026-10-11-learning-links §7.1);总开关关 = 与未安装联动完全相同
    links_enabled: bool = False
    link_word_actions_enabled: bool = True
    link_daily_tasks_enabled: bool = True
    link_mistakes_enabled: bool = True
    link_pron_shadow_enabled: bool = True
    link_chat_words_enabled: bool = True
    link_rank_sources_enabled: bool = True
    links_queue_max: int = Field(1000, ge=10, le=10000)
    links_handler_timeout_ms: int = Field(2000, ge=100, le=10000)
    links_breaker_failures: int = Field(5, ge=1, le=100)
    links_breaker_cooldown_seconds: int = Field(60, ge=5, le=3600)
    links_retention_days: int = Field(90, ge=7, le=365)
    link_chat_words_daily_max: int = Field(10, ge=1, le=50)
    link_chat_words_llm_enabled: bool = False
    link_chat_words_llm_global_daily: int = Field(200, ge=0, le=10000)

    # 智能体(spec 2026-10-12-agents §10.1);总开关关 = /api/agents/* 除 config 外 404,对话与联机行为不变
    agents_enabled: bool = False
    agents_tutor_enabled: bool = True
    agents_memory_enabled: bool = True
    agents_rooms_enabled: bool = True
    agents_tools_mode: Literal["prefetch", "native", "off"] = "prefetch"
    agents_model: str = ""
    agents_memory_model: str = ""
    agents_turns_global_daily: int = Field(3000, ge=0, le=100000)
    agents_turns_daily_per_user: int = Field(300, ge=0, le=10000)
    agents_memory_extract_daily_per_user: int = Field(100, ge=0, le=1000)
    agents_tutor_daily_per_user: int = Field(20, ge=0, le=200)
    agents_personas_max: int = Field(10, ge=0, le=50)
    agents_prompt_max_chars: int = Field(800, ge=100, le=4000)
    agents_memory_items_max: int = Field(200, ge=10, le=2000)
    agents_memory_tokens: int = Field(600, ge=0, le=2000)
    agents_source_timeout_ms: int = Field(150, ge=20, le=250)  # 总预算固定 250 ms(agents/context.PREFETCH_BUDGET_MS)
    agents_history_max: int = Field(20, ge=2, le=50)
    agents_history_chars_max: int = Field(8000, ge=500, le=100000)  # 评审 #1:带入历史的总字数预算
    agents_chat_max_tokens: int = Field(300, ge=64, le=2000)  # 计划 R-C9
    agents_tutor_max_tokens: int = Field(350, ge=64, le=2000)

    # 跟读库(spec 2026-10-13-video-import §5.2);总开关关 = /api/library/* 除 config 外 404
    library_enabled: bool = False
    library_asr_enabled: bool = False
    library_link_import_enabled: bool = False
    library_quota_mb: int = Field(2000, ge=1, le=1_000_000)
    library_max_items: int = Field(100, ge=1, le=10_000)
    library_max_upload_mb: int = Field(500, ge=1, le=20_000)
    library_max_duration_minutes: int = Field(90, ge=1, le=600)
    library_asr_minutes_daily_per_user: int = Field(60, ge=0, le=2000)
    library_asr_minutes_global_daily: int = Field(600, ge=0, le=100_000)
    library_imports_daily_per_user: int = Field(20, ge=0, le=1000)
    library_job_concurrency: int = Field(1, ge=1, le=4)
    library_transcode_max_height: int = Field(720, ge=240, le=1080)
    library_link_timeout_minutes: int = Field(20, ge=1, le=120)
    library_link_allow_generic: bool = False
    library_ytdlp_cookies_file: str = ""  # env-only;Netscape 格式,含账号会话,等同密钥
    library_ytdlp_proxy: str = ""  # env-only secret;可能含账号口令
    # D8:每句译文与句子分析(调大模型,花钱);按「句」计的每日额度,命中已存的译文 / 分析不计
    library_ai_enabled: bool = False
    library_translate_daily_per_user: int = Field(500, ge=0, le=20_000)
    library_analysis_daily_per_user: int = Field(30, ge=0, le=1000)
    library_ai_daily_global: int = Field(5000, ge=0, le=1_000_000)
    # 精选库(spec 2026-10-14-curated-library E12、R3):用户可见开关;共享分析每天全站最多生成多少句(系统付费)
    library_catalog_enabled: bool = False
    library_catalog_ai_daily: int = Field(300, ge=0, le=100_000)

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

    @field_validator("azure_speech_region")
    @classmethod
    def _azure_region(cls, value: str) -> str:
        """A bare region name (e.g. eastus): it becomes part of the host the Azure key is sent to (review M2)."""
        value = value.strip().lower()
        if value and not re.fullmatch(r"[a-z0-9]{2,32}", value):
            raise ValueError("invalid Azure region (letters and digits only, e.g. eastus)")
        return value

    @field_validator("identity_pepper")
    @classmethod
    def _identity_pepper(cls, value: str) -> str:
        """Empty is allowed (email features stay off); otherwise long enough to be a real key. The value is never echoed."""
        if value and len(value) < 32:
            raise ValueError("IDENTITY_PEPPER must be at least 32 characters")
        return value

    @field_validator("admin_ip_allowlist")
    @classmethod
    def _cidrs(cls, value: str) -> str:
        for item in _split(value):
            try:
                ipaddress.ip_network(item, strict=False)
            except ValueError:
                raise ValueError("invalid CIDR") from None
        return value

    @field_validator("wordbook_books")
    @classmethod
    def _wordbook_books(cls, value: str) -> str:
        unknown = set(_split(value)) - set(WORDBOOK_BOOK_IDS)
        if unknown:
            raise ValueError(f"unknown wordbook ids: {', '.join(sorted(unknown))}")
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
    def rooms_voice_available(self) -> bool:
        """Room voice uploads need the sub-switch and a recognizer (Volcengine stream or Whisper/chat fallback)."""
        return self.rooms_enabled and self.rooms_voice_enabled and (
            asr_stream_usable(self) or whisper_fallback_configured(self))

    @property
    def rooms_summary_available(self) -> bool:
        return self.rooms_enabled and self.rooms_summary_enabled and bool(self.upstream_llm_base_url)

    @property
    def resolved_wordbook_data_dir(self) -> Path:
        """空 = server/dictionaries/kylebing-english-vocabulary(容器里 /app/dictionaries/...),与 app 包同级。"""
        if self.wordbook_data_dir:
            return Path(self.wordbook_data_dir)
        return Path(__file__).resolve().parents[2] / "dictionaries" / "kylebing-english-vocabulary"

    @property
    def wordbook_ai_available(self) -> bool:
        return self.wordbook_enabled and self.wordbook_ai_enabled and bool(self.upstream_llm_base_url)

    @property
    def resolved_wordbook_ai_model(self) -> str:
        return self.wordbook_ai_model.strip() or self.default_llm_model

    @property
    def agents_available(self) -> bool:
        return self.agents_enabled and bool(self.upstream_llm_base_url)

    @property
    def resolved_agents_model(self) -> str:
        return self.agents_model.strip() or self.default_llm_model

    @property
    def resolved_agents_memory_model(self) -> str:
        return self.agents_memory_model.strip() or self.resolved_agents_model

    @property
    def library_available(self) -> bool:
        """跟读库能处理媒体:总开关开,且 ffmpeg 与 ffprobe 都在 PATH 上(spec §5.2)。"""
        return self.library_enabled and media_tools_present()

    @property
    def library_asr_available(self) -> bool:
        """无字幕时可用识别转写:子开关开,且现有识别路径可用(火山流式或 Whisper/chat 回退)。"""
        return self.library_asr_enabled and (asr_stream_usable(self) or whisper_fallback_configured(self))

    @property
    def library_link_available(self) -> bool:
        """链接导入:子开关开,且 yt-dlp 可导入(依赖由计划 S2 加进 pyproject)。"""
        return self.library_link_import_enabled and ytdlp_present()

    @property
    def library_ai_available(self) -> bool:
        """译文与句子分析(D8):总开关与子开关都开,且大模型上游已配置。不需要 ffmpeg:已处理好的条目照常可译。"""
        return self.library_enabled and self.library_ai_enabled and bool(self.upstream_llm_base_url)

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


def media_tools_present() -> bool:
    """ffmpeg 与 ffprobe 都能在 PATH 上找到(跟读库;测试里 monkeypatch 这个函数)。"""
    return shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


def ytdlp_present() -> bool:
    """yt-dlp 能被导入(只查找,不导入;测试里 monkeypatch 这个函数)。"""
    return importlib.util.find_spec("yt_dlp") is not None


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
