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
    ("realtime", "实时通话"), ("rank", "段位赛"), ("rooms", "联机练习"), ("wordbook", "背单词"),
    ("links", "学习联动"), ("agents", "智能体"), ("chat_home", "对话主页"), ("library", "跟读库"),
    ("admin", "管理端"),
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
_WEAKER_LOGIN = "放宽会削弱登录防暴力破解"
_LONGER_SESSIONS = "调长会让被盗或无人看管的管理会话更久有效"
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
    _env("wordbook_data_dir", "str", "词典目录", group="wordbook",
         help_zh="留空 = server/dictionaries/kylebing-english-vocabulary(容器 /app/dictionaries/...)"),
    _env("library_ytdlp_cookies_file", "str", "yt-dlp cookies 文件", group="library",
         help_zh="Netscape 格式;含账号会话,等同密钥;请用专门的小号;只读挂载"),
    _env("library_ytdlp_proxy", "secret", "yt-dlp 代理", group="library", help_zh="链接取回时使用;可能含账号口令"),
    # features
    _s("realtime_enabled", "features", "bool", "实时通话", apply="new_sessions", danger=_COST),
    _s("rank_enabled", "features", "bool", "段位赛", danger="关闭后段位接口返回 404"),
    _s("rooms_enabled", "features", "bool", "联机练习", danger="关闭会断开所有在线房间连接"),
    _s("rooms_voice_enabled", "features", "bool", "联机语音消息", help_zh="关闭后不能上传或重试;已有语音照常播放、翻译",
       danger=_COST),
    _s("rooms_summary_enabled", "features", "bool", "联机学习小结", help_zh="房间结束时生成一次 AI 学习小结", danger=_COST),
    _s("wordbook_enabled", "features", "bool", "背单词", danger="关闭后背单词接口返回 404;学习记录保留"),
    _s("wordbook_ai_enabled", "features", "bool", "背单词 AI 讲解", help_zh="按需、全站缓存、受每日额度限制",
       danger=_COST),
    _s("library_enabled", "features", "bool", "跟读库", help_zh="需要服务器装有 ffmpeg / ffprobe",
       danger="关闭后跟读库接口返回 404;素材与记录保留"),
    # registration / limits
    _s("registration_mode", "registration", "enum", "注册方式", danger="open 会让任何人注册并消耗上游额度"),
    _s("invite_code", "registration", "secret", "邀请码(env 单码)", danger="更换后旧邀请码立即失效,新码可让人注册"),
    _s("rate_limit_per_minute", "limits", "int", "登录/注册每分钟次数(按 IP)", min=1, max=10000,
       danger=_WEAKER_LOGIN),
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
    # rooms v2(设计文档 2026-10-10-rooms-v2 §11.2)
    _s("rooms_voice_max_seconds", "rooms", "int", "单条语音最长秒数"),
    _s("rooms_voice_daily_per_user", "rooms", "int", "每人每日语音条数", help_zh="可按用户覆盖"),
    _s("rooms_voice_global_daily", "rooms", "int", "全站每日语音转写次数", help_zh="含重试", danger=_COST),
    _s("rooms_voice_quota_mb", "rooms", "int", "每人每天语音上传上限 MB", help_zh="按 UTC 日计(产品负责人确认);不占录音配额;可按用户覆盖"),
    _s("rooms_voice_concurrency", "rooms", "int", "语音转写并发", apply="restart"),
    _s("rooms_voice_store_format", "rooms", "enum", "语音存储格式", choices=("mp3", "wav"),
       help_zh="mp3 = 24 kbps(约 WAV 的 1/10);wav 仅在 lameenc 不可用时使用"),
    _s("rooms_translate_global_daily", "rooms", "int", "全站每日语音翻译次数", danger=_COST),
    _s("rooms_summary_global_daily", "rooms", "int", "全站每日学习小结次数", danger=_COST),
    # wordbook(设计文档 2026-10-10-wordbook §10)
    _s("wordbook_books", "wordbook", "csv", "启用的词书",
       help_zh="junior,senior,cet4,cet6,kaoyan,toefl,sat 的子集;停用不删学习记录"),
    _s("wordbook_daily_new", "wordbook", "int", "默认每日新词", help_zh="新选书的默认值", min=1, max=200),
    _s("wordbook_review_cap", "wordbook", "int", "默认每日复习上限", help_zh="新选书的默认值", min=10, max=1000),
    _s("wordbook_daily_new_min", "wordbook", "int", "每日新词下限", help_zh="用户可选的最小值"),
    _s("wordbook_daily_new_max", "wordbook", "int", "每日新词上限", help_zh="用户可选的最大值"),
    _s("wordbook_review_cap_min", "wordbook", "int", "每日复习上限·下限"),
    _s("wordbook_review_cap_max", "wordbook", "int", "每日复习上限·上限", help_zh="也是「不限」时的积压阈值"),
    _s("wordbook_review_unlimited", "wordbook", "bool", "允许「不限」复习",
       help_zh="关掉后,选了「不限」的用户按每日复习上限·上限计算"),
    _s("wordbook_bonus_max", "wordbook", "int", "每日加练上限(新词)", help_zh="0 = 关闭「今天加练」"),
    _s("wordbook_ai_model", "wordbook", "str", "AI 讲解模型", help_zh="留空 = 默认模型"),
    _s("wordbook_ai_global_daily", "wordbook", "int", "全站每日 AI 讲解次数", help_zh="只计未命中缓存的调用", danger=_COST),
    _s("wordbook_ai_daily_per_user", "wordbook", "int", "每人每日 AI 讲解次数", help_zh="可按用户覆盖"),
    # wordbook v2(设计文档 2026-10-11-wordbook-recall §7)
    _s("wordbook_spot_check_pct", "wordbook", "int", "「认识」抽查比例(%)", min=0, max=100,
       help_zh="学新词与快速回忆里按「认识」的词按此比例抽查一道选释义;0 = 不抽查(含太快必抽)"),
    _s("wordbook_recall_enabled", "wordbook", "bool", "复习题型「快速回忆」", help_zh="自评三档后翻面确认;进入已掌握的那次复习不出此题"),
    _s("wordbook_autoplay", "wordbook", "bool", "自动朗读词头", help_zh="新词卡出现、快速回忆翻面时;「不认识」总是朗读"),
    _s("wordbook_show_example", "wordbook", "bool", "翻开后显示例句"),
    # admin
    _s("admin_token_ttl_minutes", "admin", "int", "会话有效分钟", danger=_LONGER_SESSIONS),
    _s("admin_idle_minutes", "admin", "int", "会话空闲超时分钟", danger=_LONGER_SESSIONS),
    _s("admin_require_totp", "admin", "bool", "超级管理员必须绑定 TOTP", danger="打开后未绑定的超级管理员不能执行写操作"),
    _s("admin_lockout_threshold", "admin", "int", "锁定阈值(次)", danger=_WEAKER_LOGIN),
    _s("admin_lockout_minutes", "admin", "int", "锁定分钟", danger=_WEAKER_LOGIN),
    _s("admin_step_up_minutes", "admin", "int", "二次验证有效分钟", danger=_LONGER_SESSIONS),
    _s("admin_audit_retention_days", "admin", "int", "审计保留天数", danger="调低会让更早的审计记录可以被清理"),
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
    # 学习联动(设计文档 2026-10-11-learning-links §7.1)
    _s("links_enabled", "links", "bool", "学习联动总开关", help_zh="关闭 = 与未安装联动完全相同;各联动另有开关"),
    _s("link_word_actions_enabled", "links", "bool", "单词操作位置", help_zh="生词本按钮旁的「更多」菜单"),
    _s("link_daily_tasks_enabled", "links", "bool", "今日任务聚合卡"),
    _s("link_mistakes_enabled", "links", "bool", "易错词", help_zh="背单词答错的词进生词本「易错词」视图"),
    _s("link_pron_shadow_enabled", "links", "bool", "发音弱词与跟读"),
    _s("link_chat_words_enabled", "links", "bool", "对话用到今日词"),
    _s("link_rank_sources_enabled", "links", "bool", "联动段位点",
       danger="打开后联动可以给段位加点(每日最多段位规则里的 sources_daily_cap)"),
    _s("links_queue_max", "links", "int", "事件队列上限", help_zh="满了丢弃并计数"),
    _s("links_handler_timeout_ms", "links", "int", "单个处理器超时(毫秒)"),
    _s("links_breaker_failures", "links", "int", "熔断连续失败次数"),
    _s("links_breaker_cooldown_seconds", "links", "int", "熔断冷却(秒)"),
    _s("links_retention_days", "links", "int", "联动记录保留天数"),
    _s("link_chat_words_daily_max", "links", "int", "每人每日最多记录今日词"),
    _s("link_chat_words_llm_enabled", "links", "bool", "今日词大模型用法检查", danger=_COST),
    _s("link_chat_words_llm_global_daily", "links", "int", "用法检查全站每日次数", danger=_COST),
    # 智能体(设计文档 2026-10-12-agents §10.1;计划 R-C9、R-C10)
    _s("agents_enabled", "agents", "bool", "智能体总开关", help_zh="关闭 = /api/agents/* 除 config 外 404;对话与联机照旧",
       danger=_COST),
    _s("agents_tutor_enabled", "agents", "bool", "导师模式「带我学」"),
    _s("agents_memory_enabled", "agents", "bool", "智能体记忆", help_zh="关闭后不读取也不整理记忆;已存记忆保留"),
    _s("agents_rooms_enabled", "agents", "bool", "联机里的智能体角色"),
    _s("agents_tools_mode", "agents", "enum", "工具方式",
       help_zh="prefetch = 调模型前并行预取;native 需先通过「智能体」页的函数调用探测,否则按 prefetch;off = 不用学习数据工具"),
    _s("agents_model", "agents", "str", "智能体模型", help_zh="留空 = 默认模型"),
    _s("agents_memory_model", "agents", "str", "记忆整理模型", help_zh="留空 = 智能体模型"),
    _s("agents_turns_global_daily", "agents", "int", "全站每日回合上限", danger=_COST),
    _s("agents_turns_daily_per_user", "agents", "int", "每人每日回合上限", help_zh="可按用户覆盖"),
    _s("agents_memory_extract_daily_per_user", "agents", "int", "每人每日记忆整理次数", help_zh="可按用户覆盖"),
    _s("agents_tutor_daily_per_user", "agents", "int", "每人每日导师会话数", help_zh="按开始次数计;可按用户覆盖"),
    _s("agents_personas_max", "agents", "int", "每人自建角色上限", help_zh="可按用户覆盖;0 = 不允许自建"),
    _s("agents_prompt_max_chars", "agents", "int", "人设最长字数", help_zh="只约束新建与修改;已存的长人设照常使用"),
    _s("agents_memory_items_max", "agents", "int", "每人长期记忆条数上限"),
    _s("agents_memory_tokens", "agents", "int", "记忆块预算(token 估算)", help_zh="0 = 不放记忆"),
    _s("agents_source_timeout_ms", "agents", "int", "单个上下文来源超时(毫秒)", help_zh="所有来源并行,总预算固定 250 毫秒;超时记为跳过"),
    _s("agents_history_max", "agents", "int", "带入的历史消息条数"),
    _s("agents_history_chars_max", "agents", "int", "带入历史的总字数上限", help_zh="从最新一条往前取,整条放得下才带入,不截断单条"),
    _s("agents_chat_max_tokens", "agents", "int", "聊天回复 max_tokens", help_zh="同时受 LLM_MAX_TOKENS 约束"),
    _s("agents_tutor_max_tokens", "agents", "int", "导师回复 max_tokens", help_zh="同时受 LLM_MAX_TOKENS 约束"),
    # 对话主页与每日问候(计划 2026-10-23-chat-home-daily-greeting R6、R9)
    _s("chat_home_enabled", "chat_home", "bool", "对话主页与每日问候",
       help_zh="关 = /api/chat-home/* 除 config 外 404,网页保持旧对话列表"),
    _s("chat_greeting_llm_enabled", "chat_home", "bool", "问候用大模型生成",
       help_zh="关 = 只用模板问候,零上游成本;每人每天最多 1 次调用", danger=_COST),
    _s("chat_greeting_model", "chat_home", "str", "问候模型", help_zh="留空 = 智能体模型"),
    _s("chat_greeting_timeout_seconds", "chat_home", "int", "问候生成超时(秒)", help_zh="超时 = 用模板问候"),
    _s("chat_greeting_global_daily", "chat_home", "int", "全站每日问候生成上限", danger=_COST),
    # 跟读库(设计文档 2026-10-13-video-import §5.2)
    _s("library_asr_enabled", "library", "bool", "无字幕时自动转写", help_zh="用现有语音识别上游;受每日分钟数限制",
       danger=_COST),
    _s("library_link_import_enabled", "library", "bool", "链接导入",
       help_zh="yt-dlp 能直接下载的公开页面;DRM 流媒体不支持", danger="会让服务器访问用户提交的网址并下载内容"),
    _s("library_link_allow_generic", "library", "bool", "允许通用抓取器", help_zh="关 = 只用针对具体站点的提取器",
       danger="通用抓取器会让服务器请求任意网页"),
    _s("library_quota_mb", "library", "int", "每人媒体总量 MB", help_zh="可按用户覆盖"),
    _s("library_max_items", "library", "int", "每人条目数上限", help_zh="可按用户覆盖"),
    _s("library_max_upload_mb", "library", "int", "单个上传文件上限 MB"),
    _s("library_max_duration_minutes", "library", "int", "单条时长上限(分钟)", help_zh="上传与链接都按探测出的时长检查"),
    _s("library_asr_minutes_daily_per_user", "library", "int", "每人每天识别分钟数"),
    _s("library_asr_minutes_global_daily", "library", "int", "全站每天识别分钟数", danger=_COST),
    _s("library_imports_daily_per_user", "library", "int", "每人每天新建条目次数", help_zh="上传与链接合计"),
    _s("library_job_concurrency", "library", "int", "同时处理的条目数", help_zh="ffmpeg / yt-dlp 吃 CPU 与带宽"),
    _s("library_transcode_max_height", "library", "int", "视频最大高度(像素)", help_zh="转码与链接取回都按它"),
    _s("library_link_timeout_minutes", "library", "int", "单次链接取回超时(分钟)"),
    # D8:每句译文与句子分析(同样走现有大模型上游)
    _s("library_ai_enabled", "library", "bool", "每句译文与 AI 分析",
       help_zh="调大模型生成并存进句子;关 = 译文 / 分析接口返回 404", danger=_COST),
    _s("library_translate_daily_per_user", "library", "int", "每人每天译文句数", help_zh="命中已存的译文不计"),
    _s("library_analysis_daily_per_user", "library", "int", "每人每天句子分析次数", help_zh="命中已存的分析不计"),
    _s("library_ai_daily_global", "library", "int", "全站每天译文 + 分析句数", help_zh="两类合计", danger=_COST),
    # 精选库(spec 2026-10-14-curated-library)
    _s("library_catalog_enabled", "library", "bool", "精选库(内置素材)",
       help_zh="关 = 用户看不到「精选」;已加入的副本照常可用;管理端导入不受影响"),
    _s("library_catalog_ai_daily", "library", "int", "精选库共享分析每日句数",
       help_zh="首次生成后所有用户共享;系统付费,不扣用户额度", danger=_COST),
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
