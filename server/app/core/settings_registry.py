"""每个 Settings 字段的后台元数据(管理后台 v2 spec §3.2)。新增字段必须在这里登记(tests/test_settings_registry.py)。"""
import typing
from dataclasses import dataclass
from typing import Literal

from annotated_types import Ge, Le

from app.core.config import Settings

Apply = Literal["hot", "new_sessions", "restart"]
Kind = Literal["str", "text", "int", "float", "bool", "enum", "csv", "url", "date", "json", "secret"]

GROUPS: tuple[tuple[str, str], ...] = (
    ("features", "功能开关"), ("registration", "注册与访问"), ("limits", "限流与配额"), ("llm", "大模型"),
    ("grammar", "语法检查"), ("tts", "语音合成"), ("asr", "语音识别"), ("assessment", "发音评测"),
    ("realtime", "实时通话"), ("rank", "段位赛"), ("rooms", "联机练习"), ("admin", "管理端"),
    ("ops", "运维与维护"), ("system", "系统(只读)"),
)


@dataclass(frozen=True)
class SettingSpec:
    key: str
    group: str
    kind: Kind
    label_zh: str
    help_zh: str = ""
    apply: Apply = "hot"
    env_only: bool = False
    secret: bool = False
    danger: str | None = None
    min: float | None = None
    max: float | None = None
    choices: tuple[str, ...] | None = None
    pair: str | None = None
    managed_by: str | None = None


def _s(key: str, group: str, kind: Kind, label: str, **kw) -> SettingSpec:
    if kind == "secret":
        kw.setdefault("secret", True)
    return SettingSpec(key, group, kind, label, **kw)


def _env(key: str, kind: Kind, label: str, **kw) -> SettingSpec:
    return _s(key, kw.pop("group", "system"), kind, label, env_only=True, apply="restart", **kw)


_URL_DANGER = "改主机会把配对的密钥发送到新地址"
_COST = "打开后会产生上游费用"

_ALL: tuple[SettingSpec, ...] = (
    # system / env-only
    _env("database_url", "secret", "数据库连接"),
    _env("data_dir", "str", "数据目录"),
    _env("web_dist_dir", "str", "网页构建目录"),
    _env("admin_dist_dir", "str", "管理端构建目录"),
    _env("backup_dir", "str", "备份目录"),
    _env("build_sha", "str", "构建版本"),
    _env("trust_proxy_headers", "bool", "信任反向代理头"),
    _env("grammar_prompt_file", "str", "语法规则文件", group="grammar"),
    _env("admin_username", "str", "应急管理员账号", group="admin"),
    _env("admin_password", "secret", "应急管理员密码", group="admin"),
    _env("admin_totp_secret", "secret", "应急管理员 TOTP", group="admin"),
    _env("admin_session_secret", "secret", "会话签名密钥", group="admin"),
    _env("settings_encryption_key", "secret", "加密主密钥", group="admin"),
    _env("admin_settings_safe_mode", "bool", "安全模式", group="admin"),
    _env("admin_ip_allowlist", "csv", "管理端 IP 白名单", group="admin"),
    _env("admin_cookie_secure", "bool", "仅 HTTPS Cookie", group="admin"),
    # features
    _s("realtime_enabled", "features", "bool", "实时通话", apply="new_sessions", danger=_COST),
    _s("rank_enabled", "features", "bool", "段位赛", danger="关闭后段位接口返回 404"),
    _s("rooms_enabled", "features", "bool", "联机练习", danger="关闭会断开所有在线房间连接"),
    # registration / limits
    _s("registration_mode", "registration", "enum", "注册方式", danger="open 会让任何人注册并消耗上游额度"),
    _s("invite_code", "registration", "secret", "邀请码(env 单码)"),
    _s("rate_limit_per_minute", "limits", "int", "登录/注册每分钟次数(按 IP)", min=1, max=10000),
    _s("ai_rate_limit_per_minute", "limits", "int", "AI 接口每分钟次数(按用户)", min=1, max=10000),
    _s("recording_quota_mb", "limits", "int", "每人录音上限 MB", min=1, max=100000),
    _s("chat_orphan_grace_hours", "limits", "int", "孤儿对话录音保留小时", min=1, max=720),
    _s("max_conversations", "limits", "int", "每人对话数上限", min=1, max=100000),
    _s("max_messages_per_conversation", "limits", "int", "单对话消息上限", min=10, max=100000),
    _s("max_practice_items", "limits", "int", "练习清单上限", min=1, max=100000),
    _s("max_vocab_items", "limits", "int", "词汇本上限", min=1, max=100000),
    # llm
    _s("llm_max_tokens", "llm", "int", "聊天 max_tokens 上限", min=64, max=32768),
    _s("upstream_llm_base_url", "llm", "url", "LLM 地址", danger=_URL_DANGER, pair="upstream_llm_key"),
    _s("upstream_llm_key", "llm", "secret", "LLM 密钥"),
    _s("llm_models", "llm", "csv", "可选模型"),
    _s("default_llm_model", "llm", "str", "默认模型"),
    # grammar
    _s("grammar_model", "grammar", "str", "语法模型"),
    _s("upstream_grammar_base_url", "grammar", "url", "语法上游地址", danger=_URL_DANGER, pair="upstream_grammar_key"),
    _s("upstream_grammar_key", "grammar", "secret", "语法上游密钥"),
    _s("grammar_prompt", "grammar", "text", "语法规则(env)", help_zh="已发布的提示词版本优先"),
    # tts
    _s("upstream_tts_base_url", "tts", "url", "TTS 地址", danger=_URL_DANGER, pair="upstream_tts_key"),
    _s("upstream_tts_key", "tts", "secret", "TTS 密钥"),
    _s("tts_models", "tts", "csv", "TTS 模型"),
    _s("volcengine_tts_key", "tts", "secret", "豆包语音密钥"),
    _s("volcengine_tts_url", "tts", "url", "豆包语音地址", danger=_URL_DANGER, pair="volcengine_tts_key"),
    # asr
    _s("upstream_whisper_base_url", "asr", "url", "转写地址", danger=_URL_DANGER, pair="upstream_whisper_key"),
    _s("upstream_whisper_key", "asr", "secret", "转写密钥"),
    _s("upstream_whisper_mode", "asr", "enum", "转写方式"),
    _s("upstream_whisper_model", "asr", "str", "转写模型"),
    _s("upstream_asr_mode", "asr", "enum", "识别方式"),
    _s("asr_stream_url", "asr", "url", "流式识别地址", danger=_URL_DANGER, pair="volcengine_asr_key"),
    _s("asr_stream_resource_id", "asr", "str", "流式识别资源 ID"),
    _s("asr_stream_timeout_seconds", "asr", "float", "流式识别超时秒", min=5, max=120),
    _s("asr_stream_max_concurrency", "asr", "int", "流式识别并发", min=1, max=32, apply="restart"),
    _s("volcengine_asr_key", "asr", "secret", "流式识别密钥"),
    _s("stt_max_tokens", "asr", "int", "chat 识别 max_tokens", min=32, max=4096),
    _s("stt_disable_thinking", "asr", "enum", "识别关闭深度思考"),
    # assessment
    _s("azure_speech_key", "assessment", "secret", "Azure Speech 密钥"),
    _s("azure_speech_region", "assessment", "str", "Azure 区域", pair="azure_speech_key", danger=_URL_DANGER,
       help_zh="只填区域名(如 eastus);它决定 Azure 密钥发往的主机"),
    _s("xfyun_app_id", "assessment", "str", "讯飞 APPID"),
    _s("xfyun_api_key", "assessment", "secret", "讯飞 APIKey"),
    _s("xfyun_api_secret", "assessment", "secret", "讯飞 APISecret"),
    _s("xfyun_ws_url", "assessment", "url", "讯飞地址", danger=_URL_DANGER, pair="xfyun_api_key"),
    # realtime
    _s("asr_realtime_url", "realtime", "url", "通话识别地址", apply="new_sessions", danger=_URL_DANGER,
       pair="volcengine_asr_key"),
    _s("realtime_asr_mode", "realtime", "enum", "通话识别方式", apply="new_sessions"),
    _s("realtime_max_minutes", "realtime", "int", "单通时长上限(分钟)", apply="new_sessions"),
    _s("realtime_idle_timeout_seconds", "realtime", "int", "通话空闲超时秒", apply="new_sessions"),
    _s("realtime_max_sessions", "realtime", "int", "同时通话上限", danger="调高会增加并发上游费用"),
    _s("realtime_ticket_ttl_seconds", "realtime", "int", "通话票据有效秒"),
    _s("realtime_tts_model", "realtime", "str", "通话 TTS 模型", apply="new_sessions"),
    _s("realtime_tts_sample_rate", "realtime", "enum", "通话采样率", apply="new_sessions", choices=("16000", "24000")),
    _s("realtime_llm_disable_thinking", "realtime", "enum", "通话关闭深度思考", apply="new_sessions"),
    # rank(将存在,S1)
    _s("rank_daily_rp_cap", "rank", "int", "每日段位点上限", managed_by="rank_rules"),
    _s("rank_match_daily_attempts", "rank", "int", "每人每日晋级赛次数", managed_by="rank_rules"),
    _s("rank_match_cooldown_minutes", "rank", "int", "失败冷却分钟", managed_by="rank_rules"),
    _s("rank_match_minutes", "rank", "int", "单场时限分钟", managed_by="rank_rules"),
    _s("rank_season_anchor", "rank", "date", "第 1 赛季开始日", managed_by="rank_rules"),
    _s("rank_season_weeks", "rank", "int", "赛季周数", managed_by="rank_rules"),
    _s("rank_matches_global_daily", "rank", "int", "全站每日晋级赛上限", danger=_COST),
    _s("rank_judge_model", "rank", "str", "评委模型"),
    # rooms(将存在,S1)
    _s("rooms_ai_model", "rooms", "str", "房间 AI 模型"),
    _s("rooms_max_active", "rooms", "int", "全站活跃房间上限"),
    _s("rooms_max_members", "rooms", "int", "每房成员上限"),
    _s("rooms_max_owned", "rooms", "int", "每人拥有房间上限"),
    _s("rooms_idle_minutes", "rooms", "int", "空闲关闭分钟"),
    _s("rooms_max_hours", "rooms", "int", "房间最长小时"),
    _s("room_message_retention_days", "rooms", "int", "房间消息保留天数",
       help_zh="0 = 永久保留(spec R-6)", danger="大于 0 会定期删除已结束房间的消息"),
    _s("rooms_ticket_ttl_seconds", "rooms", "int", "房间票据有效秒"),
    _s("rooms_assist_daily_per_user", "rooms", "int", "每人每日助手次数"),
    _s("rooms_ai_per_room_hour", "rooms", "int", "每房每小时 @ai 次数"),
    _s("rooms_ai_global_daily", "rooms", "int", "全站每日房间 AI 次数", danger=_COST),
    _s("rooms_ai_concurrency", "rooms", "int", "房间 AI 并发", apply="restart"),
    # admin
    _s("admin_token_ttl_minutes", "admin", "int", "会话有效分钟"),
    _s("admin_idle_minutes", "admin", "int", "会话空闲超时分钟"),
    _s("admin_require_totp", "admin", "bool", "超级管理员必须绑定 TOTP", danger="打开后未绑定的超级管理员不能执行写操作"),
    _s("admin_lockout_threshold", "admin", "int", "锁定阈值(次)"),
    _s("admin_lockout_minutes", "admin", "int", "锁定分钟"),
    _s("admin_step_up_minutes", "admin", "int", "二次验证有效分钟"),
    _s("admin_audit_retention_days", "admin", "int", "审计保留天数"),
    # ops
    _s("log_level", "ops", "enum", "日志级别", choices=("DEBUG", "INFO", "WARNING", "ERROR"),
       danger="DEBUG 会产生大量日志"),
    _s("maintenance_mode", "ops", "enum", "维护模式", danger="read_only/full 会拒绝用户写操作或全部 API"),
    _s("maintenance_message_zh", "ops", "text", "维护说明(中文)", max=280),
    _s("maintenance_message_en", "ops", "text", "维护说明(英文)", max=280),
    _s("usage_prices_json", "ops", "json", "上游单价表(估算)"),
    _s("usage_currency", "ops", "str", "币种"),
    _s("usage_raw_retention_days", "ops", "int", "计量原始行保留天数"),
    _s("backup_keep", "ops", "int", "保留备份份数"),
    _s("backup_hour_utc", "ops", "int", "每日自动备份(UTC 小时,-1 关)"),
    _s("app_version", "ops", "str", "客户端看到的版本号"),
)

SPECS: dict[str, SettingSpec] = {s.key: s for s in _ALL}
ENV_ONLY = frozenset(k for k, s in SPECS.items() if s.env_only)
SECRETS = frozenset(k for k, s in SPECS.items() if s.secret)


def spec_for(key: str) -> SettingSpec:
    return SPECS[key]


def env_name(key: str) -> str:
    return key.upper()


def field_bounds(key: str) -> tuple[float | None, float | None]:
    lo = hi = None
    for meta in Settings.model_fields[key].metadata:
        if isinstance(meta, Ge):
            lo = meta.ge
        elif isinstance(meta, Le):
            hi = meta.le
    return lo, hi


def effective_bounds(spec: SettingSpec) -> tuple[float | None, float | None]:
    lo, hi = field_bounds(spec.key)
    if spec.min is not None:
        lo = spec.min if lo is None else max(lo, spec.min)
    if spec.max is not None and spec.kind in ("int", "float"):
        hi = spec.max if hi is None else min(hi, spec.max)
    return lo, hi


def choices_for(key: str) -> tuple[str, ...] | None:
    spec = SPECS.get(key)
    if spec and spec.choices:
        return spec.choices
    annotation = Settings.model_fields[key].annotation
    if typing.get_origin(annotation) is Literal:
        return tuple(str(a) for a in typing.get_args(annotation))
    return None
