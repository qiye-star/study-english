"""配置诊断(spec §3.10):纯函数 diagnose(settings, facts) + 事实收集 gather_facts。消息只含键名,不含值。"""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal

from sqlalchemy import func, select
from sqlalchemy.engine import make_url

from app.admin import sessions, usage
from app.core.config import realtime_asr_configured
from app.core.secretbox import box_for, fingerprint
from app.models import AdminAccount, AdminAudit, InviteCode, SettingOverride

Level = Literal["error", "warn", "info"]

CODES = (
    "realtime_unavailable", "rank_match_unavailable", "rooms_ai_unavailable", "grammar_upstream_missing",
    "registration_open", "no_encryption_key", "superadmin_without_totp", "insecure_cookie", "invalid_overrides",
    "env_drift", "pending_restart", "sqlite_without_backup", "missing_prices", "login_alarm", "safe_mode",
    "retention_enabled", "invite_without_codes",
)


@dataclass(frozen=True)
class Finding:
    level: Level
    code: str
    keys: tuple[str, ...]
    message_zh: str


@dataclass(frozen=True)
class Facts:
    encryption: bool
    superadmins_without_totp: int
    invalid: dict[str, str]
    drift: tuple[str, ...]
    pending_restart: tuple[str, ...]
    login_alarm: bool
    db_backend: str
    backups: int
    missing_prices: tuple[str, ...]
    safe_mode: bool
    live_invites: int = 0  # admin-issued invite codes that can still be used


def _realtime_reasons(s) -> tuple[str, ...]:
    reasons = []
    if not s.volcengine_tts_key:
        reasons.append("volcengine_tts_key")
    if s.realtime_tts_model not in s.tts_model_list:
        reasons.append("realtime_tts_model")
    if not s.upstream_llm_base_url:
        reasons.append("upstream_llm_base_url")
    if not realtime_asr_configured(s):
        reasons.append("realtime_asr_mode")
    return tuple(reasons)


def diagnose(s, f: Facts) -> list[Finding]:
    out: list[Finding] = []
    if s.realtime_enabled and not s.realtime_available:
        keys = _realtime_reasons(s)
        out.append(Finding("error", "realtime_unavailable", keys,
                           "实时通话已开启但不可用:缺少 " + "、".join(k.upper() for k in keys)))
    if getattr(s, "rank_enabled", False) and not s.rank_match_available:
        out.append(Finding("warn", "rank_match_unavailable", ("upstream_llm_base_url",),
                           "段位赛已开启,但晋级赛不可用(需要 LLM 与语音识别)"))
    if getattr(s, "rooms_enabled", False) and not s.rooms_ai_available:
        out.append(Finding("warn", "rooms_ai_unavailable", ("upstream_llm_base_url",), "联机已开启,但房间 AI 不可用"))
    if not s.grammar_upstream[0]:
        out.append(Finding("warn", "grammar_upstream_missing", ("upstream_grammar_base_url",), "语法检查没有可用的上游"))
    if s.registration_mode == "open":
        out.append(Finding("warn", "registration_open", ("registration_mode",), "注册开放:任何人都能注册并消耗上游额度"))
    if s.registration_mode == "invite" and not s.invite_code and not f.live_invites:
        out.append(Finding("warn", "invite_without_codes", ("registration_mode", "invite_code"),
                           "邀请注册已开启,但既没有 INVITE_CODE 也没有可用的邀请码:现在没人能注册"))
    if not f.encryption:
        out.append(Finding("warn", "no_encryption_key", ("settings_encryption_key",),
                           "未设置加密主密钥,后台不能修改密钥,也不能绑定 TOTP"))
    if f.superadmins_without_totp:
        out.append(Finding("warn", "superadmin_without_totp", ("admin_require_totp",),
                           f"{f.superadmins_without_totp} 个超级管理员未绑定 TOTP"))
    if not s.admin_cookie_secure:
        out.append(Finding("warn", "insecure_cookie", ("admin_cookie_secure",), "管理端 Cookie 未要求 HTTPS"))
    if f.invalid:
        out.append(Finding("error", "invalid_overrides", tuple(sorted(f.invalid)), "有覆盖值无效已被忽略"))
    if f.drift:
        out.append(Finding("info", "env_drift", f.drift, ".env 已变更,但覆盖值仍然生效"))
    if f.pending_restart:
        out.append(Finding("warn", "pending_restart", f.pending_restart, "有设置等待重启生效"))
    if f.db_backend == "sqlite" and f.backups == 0:
        out.append(Finding("warn", "sqlite_without_backup", ("backup_hour_utc",), "SQLite 数据库还没有任何备份"))
    if f.missing_prices:
        out.append(Finding("info", "missing_prices", ("usage_prices_json",), "部分在用模型没有单价,费用估算不完整"))
    if f.login_alarm:
        out.append(Finding("warn", "login_alarm", (), "近期有大量失败登录"))
    if f.safe_mode:
        out.append(Finding("error", "safe_mode", ("admin_settings_safe_mode",), "安全模式:数据库覆盖已全部忽略"))
    if getattr(s, "room_message_retention_days", 0) > 0:
        out.append(Finding("info", "retention_enabled", ("room_message_retention_days",),
                           "房间消息会被定期删除(spec R-6 默认永久保留)"))
    rank = {"error": 0, "warn": 1, "info": 2}
    return sorted(out, key=lambda x: rank[x.level])


def finding_out(f: Finding) -> dict:
    return {"level": f.level, "code": f.code, "keys": list(f.keys), "message": f.message_zh}


def _backups(base) -> int:
    try:
        folder = base.resolved_backup_dir
        return sum(1 for _ in folder.glob("app-*.db")) if folder.is_dir() else 0
    except OSError:
        return 0


async def gather_facts(session, app) -> Facts:
    base = app.state.base_settings
    hub = app.state.settings_hub
    without_totp = await session.scalar(select(func.count()).select_from(AdminAccount).where(
        AdminAccount.role == "superadmin", AdminAccount.disabled_at.is_(None), AdminAccount.totp_enc.is_(None))) or 0
    if base.admin_enabled and not base.admin_totp_secret.strip():
        without_totp += 1
    drift = []
    secret = await sessions.ensure_secret(app)
    for row in (await session.scalars(select(SettingOverride))).all():
        if hasattr(base, row.key):
            value = getattr(base, row.key)
            value = value.isoformat() if hasattr(value, "isoformat") else value
            if row.env_fp != fingerprint(secret, "" if value is None else str(value)):
                drift.append(row.key)
    since = datetime.now(timezone.utc) - timedelta(hours=24)
    alarm = await session.scalar(select(AdminAudit.id).where(
        AdminAudit.action == "auth.login.alarm", AdminAudit.at >= since).limit(1))
    try:
        backend = make_url(base.database_url).get_backend_name()
    except Exception:  # noqa: BLE001 - never echo the URL (it may hold a password)
        backend = "unknown"
    now = datetime.now(timezone.utc)
    live_invites = await session.scalar(select(func.count()).select_from(InviteCode).where(
        InviteCode.revoked_at.is_(None), InviteCode.uses < InviteCode.max_uses,
        (InviteCode.expires_at.is_(None)) | (InviteCode.expires_at > now))) or 0
    return Facts(
        encryption=box_for(base) is not None, superadmins_without_totp=int(without_totp), invalid=dict(hub.invalid),
        drift=tuple(sorted(drift)), pending_restart=tuple(sorted(hub.pending_restart)), login_alarm=alarm is not None,
        db_backend=backend, backups=_backups(base),
        missing_prices=await usage.missing_prices(session, app.state.settings, now), safe_mode=hub.safe_mode,
        live_invites=int(live_invites),
    )
