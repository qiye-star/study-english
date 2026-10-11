import uuid
from datetime import datetime, timezone

from sqlalchemy import (JSON, Boolean, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, false, text,
                        true)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso_utc(value: datetime) -> str:
    """SQLite 读回的是 naive 时间(实为 UTC),统一补上时区再输出。"""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()


def new_uuid() -> str:
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "users"

    # 8 位数字,由应用生成(客户端用 /^\d{8}$/ 识别本地用户目录)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    username: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    grammar_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    disabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AccessToken(Base):
    __tablename__ = "access_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SpeechToken(Base):
    __tablename__ = "speech_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    purpose: Mapped[str | None] = mapped_column(String(32), nullable=True)
    target_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    target_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    state: Mapped[str] = mapped_column(String(16), default="issued")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    config: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    conversation_id: Mapped[str] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String(16))
    content: Mapped[str] = mapped_column(Text)
    assessment_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("assessments.id", ondelete="SET NULL", name="fk_messages_assessment_id_assessments"),
        nullable=True,
        index=True,
    )
    grammar: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # 智能体回合的压缩过程(spec 2026-10-12-agents §4.4;只在 assistant 消息上,≤ 4 KB,旧消息为 NULL)
    agent_trace: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Assessment(Base):
    __tablename__ = "assessments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    reference_text: Mapped[str] = mapped_column(Text)
    language: Mapped[str] = mapped_column(String(16))
    duration_ms: Mapped[int] = mapped_column(Integer)
    audio_bytes: Mapped[int] = mapped_column(Integer)
    scores: Mapped[dict] = mapped_column(JSON)
    result: Mapped[dict] = mapped_column(JSON)
    audio_path: Mapped[str] = mapped_column(String(255))
    source: Mapped[str] = mapped_column(String(16), default="practice", server_default="practice")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PracticeItem(Base):
    __tablename__ = "practice_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    text: Mapped[str] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class VocabularyItem(Base):
    """词汇本(设计文档 §3.5)。同用户同词在应用层去重(不建唯一索引,见计划 R17)。"""

    __tablename__ = "vocabulary_items"
    __table_args__ = (
        Index("ix_vocabulary_items_user_id_due_at", "user_id", "due_at"),
        Index("ix_vocabulary_items_user_id_word", "user_id", "word"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    word: Mapped[str] = mapped_column(String(100))
    meaning: Mapped[str] = mapped_column(Text, default="")
    example: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(String(16))
    box: Mapped[int] = mapped_column(Integer, default=0)
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    reps: Mapped[int] = mapped_column(Integer, default=0)
    lapses: Mapped[int] = mapped_column(Integer, default=0)
    last_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# ---- 段位赛与联机练习(设计文档 2026-10-09 §6)----

class RankProfile(Base):
    __tablename__ = "rank_profiles"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    tier: Mapped[int] = mapped_column(Integer, default=0)
    division: Mapped[int] = mapped_column(Integer, default=3)
    rp: Mapped[int] = mapped_column(Integer, default=0)
    stars: Mapped[int] = mapped_column(Integer, default=0)
    best_tier: Mapped[int] = mapped_column(Integer, default=0)
    tier_started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cooldown_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class XpEvent(Base):
    __tablename__ = "xp_events"
    __table_args__ = (
        UniqueConstraint("user_id", "kind", "ref_id", name="uq_xp_events_user_kind_ref"),
        Index("ix_xp_events_user_id_day", "user_id", "day"),
        Index("ix_xp_events_user_id_created_at", "user_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(16))
    ref_id: Mapped[str] = mapped_column(String(80))
    points: Mapped[int] = mapped_column(Integer)
    score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    day: Mapped[str] = mapped_column(String(10))
    tier: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


OPEN_MATCH = text("status IN ('active', 'grading_failed')")


class PromotionMatch(Base):
    __tablename__ = "promotion_matches"
    __table_args__ = (
        Index("ix_promotion_matches_user_id_started_at", "user_id", "started_at"),
        # At most one open match per user, enforced by the DB (migration 0007).
        Index("uq_promotion_matches_user_open", "user_id", unique=True, sqlite_where=OPEN_MATCH,
              postgresql_where=OPEN_MATCH),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    from_tier: Mapped[int] = mapped_column(Integer)
    to_tier: Mapped[int] = mapped_column(Integer)
    scenario_key: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(16))
    turn_limit: Mapped[int] = mapped_column(Integer)
    turns: Mapped[list] = mapped_column(JSON, default=list)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    total: Mapped[int | None] = mapped_column(Integer, nullable=True)
    threshold: Mapped[int] = mapped_column(Integer)
    attempt_no: Mapped[int] = mapped_column(Integer)
    grade_attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rules_version: Mapped[int | None] = mapped_column(Integer, nullable=True)  # NULL = v0 / built-in rules


class UserAchievement(Base):
    __tablename__ = "user_achievements"
    __table_args__ = (UniqueConstraint("user_id", "key", name="uq_user_achievements_user_key"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    key: Mapped[str] = mapped_column(String(48))
    unlocked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class DailyUsage(Base):
    __tablename__ = "daily_usage"
    __table_args__ = (UniqueConstraint("scope", "subject", "day", name="uq_daily_usage_scope_subject_day"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    scope: Mapped[str] = mapped_column(String(32))
    subject: Mapped[str] = mapped_column(String(64))
    day: Mapped[str] = mapped_column(String(10))
    count: Mapped[int] = mapped_column(Integer, default=0)


class Room(Base):
    __tablename__ = "rooms"
    __table_args__ = (Index("ix_rooms_status_last_active_at", "status", "last_active_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    code: Mapped[str | None] = mapped_column(String(6), unique=True, nullable=True)
    last_code: Mapped[str] = mapped_column(String(6))
    # Deleting an owner must never cascade to the room and its messages (0007 RESTRICT, 0009 SET NULL).
    # NULL = the owner was deleted and nobody else had joined: a closed, read-only room kept forever (R-6).
    owner_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL", name="fk_rooms_owner_id_users"), index=True, nullable=True)
    topic: Mapped[str] = mapped_column(String(100), default="")
    status: Mapped[str] = mapped_column(String(8), default="open")
    locked: Mapped[bool] = mapped_column(Boolean, default=False)
    ai_public: Mapped[bool] = mapped_column(Boolean, default=True)
    last_seq: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_active_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    close_reason: Mapped[str | None] = mapped_column(String(16), nullable=True)
    ai_muted: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    # ---- rooms v2 (spec 2026-10-10 §3.1, §7) ----
    name: Mapped[str] = mapped_column(String(30), default="", server_default="")
    scenario: Mapped[str] = mapped_column(String(24), default="free", server_default="free")
    level: Mapped[str] = mapped_column(String(2), default="B1", server_default="B1")
    join_mode: Mapped[str] = mapped_column(String(8), default="code", server_default="code")
    max_members: Mapped[int] = mapped_column(Integer, default=4, server_default="4")
    allow_voice: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    invite_token: Mapped[str | None] = mapped_column(String(32), nullable=True, unique=True)
    # ---- reopen (spec 2026-10-12 part 2): the expiry clock starts at the last (re)opening ----
    opened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)  # NULL = created_at
    reopen_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class RoomMember(Base):
    __tablename__ = "room_members"
    __table_args__ = (UniqueConstraint("room_id", "user_id", name="uq_room_members_room_user"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    room_id: Mapped[str] = mapped_column(ForeignKey("rooms.id", ondelete="CASCADE"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(8))
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    left_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    kicked: Mapped[bool] = mapped_column(Boolean, default=False)


class RoomMessage(Base):
    __tablename__ = "room_messages"
    __table_args__ = (
        UniqueConstraint("room_id", "seq", name="uq_room_messages_room_seq"),
        Index("ix_room_messages_room_id_audience_id_seq", "room_id", "audience_id", "seq"),
        Index("ix_room_messages_sender_id", "sender_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    room_id: Mapped[str] = mapped_column(ForeignKey("rooms.id", ondelete="CASCADE"))
    seq: Mapped[int] = mapped_column(Integer)
    lane: Mapped[str] = mapped_column(String(8))
    audience_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sender_kind: Mapped[str] = mapped_column(String(8))
    sender_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    kind: Mapped[str] = mapped_column(String(16))
    text: Mapped[str] = mapped_column(Text)
    assisted: Mapped[bool] = mapped_column(Boolean, default=False)
    reply_to: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ai_status: Mapped[str | None] = mapped_column(String(8), nullable=True)
    client_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    meta: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    hidden_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class RoomReport(Base):
    __tablename__ = "room_reports"
    __table_args__ = (UniqueConstraint("message_id", "reporter_id", name="uq_room_reports_message_reporter"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    room_id: Mapped[str] = mapped_column(ForeignKey("rooms.id", ondelete="CASCADE"), index=True)
    message_id: Mapped[str] = mapped_column(String(36))
    reporter_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    reason: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_by: Mapped[str | None] = mapped_column(String(32), nullable=True)
    resolution: Mapped[str | None] = mapped_column(String(16), nullable=True)


# ---- 管理后台 v2(设计文档 2026-10-09-admin-console-v2 §15)----

class AdminAccount(Base):
    __tablename__ = "admin_accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(32), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(16))  # viewer / operator / superadmin
    totp_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    totp_last_step: Mapped[int | None] = mapped_column(Integer, nullable=True)
    disabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    password_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AdminSession(Base):
    __tablename__ = "admin_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    account_id: Mapped[int | None] = mapped_column(
        ForeignKey("admin_accounts.id", ondelete="CASCADE"), nullable=True, index=True)  # NULL = env 应急账号
    username: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ip: Mapped[str] = mapped_column(String(64))
    user_agent: Mapped[str] = mapped_column(String(120))
    mfa_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    step_up_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    csrf_hash: Mapped[str] = mapped_column(String(64))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    mfa_failures: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))  # wrong TOTP codes


class AdminLoginState(Base):
    __tablename__ = "admin_login_state"
    __table_args__ = (UniqueConstraint("username", "ip", name="uq_admin_login_state_username_ip"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(64))
    ip: Mapped[str] = mapped_column(String(64))  # "*" = 按用户名的全局计数
    failures: Mapped[int] = mapped_column(Integer, default=0)
    lock_level: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AdminRecoveryCode(Base):
    __tablename__ = "admin_recovery_codes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("admin_accounts.id", ondelete="CASCADE"), index=True)
    code_hash: Mapped[str] = mapped_column(String(255))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AdminAudit(Base):
    __tablename__ = "admin_audit"
    __table_args__ = (Index("ix_admin_audit_target", "target_type", "target_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    actor: Mapped[str] = mapped_column(String(64), index=True)
    role: Mapped[str] = mapped_column(String(16))
    session_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    ip: Mapped[str] = mapped_column(String(64))
    action: Mapped[str] = mapped_column(String(48), index=True)
    target_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    target_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    summary: Mapped[str] = mapped_column(String(200), default="")
    before: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    after: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    reason: Mapped[str | None] = mapped_column(String(200), nullable=True)
    result: Mapped[str] = mapped_column(String(8), default="ok")
    prev_hash: Mapped[str] = mapped_column(String(64))
    hash: Mapped[str] = mapped_column(String(64))


class AppSecret(Base):
    """Server-generated secrets that must survive restarts and be shared by workers (review B1 ruling):
    `admin_session` = the CSRF/fingerprint/backup-link key when ADMIN_SESSION_SECRET is empty;
    `admin_session_check` = SHA-256 of the key in use, so a changed key signs every admin session out."""
    __tablename__ = "app_secrets"

    name: Mapped[str] = mapped_column(String(32), primary_key=True)
    value: Mapped[str] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AuditHead(Base):
    """One row (id=1): the hash of the newest audit row. Every `audit.record` updates it first, which takes the DB
    write lock (SQLite) / row lock (Postgres) until the caller commits, so writers in any process chain in order."""
    __tablename__ = "audit_head"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    hash: Mapped[str] = mapped_column(String(64))


class SettingOverride(Base):
    __tablename__ = "setting_overrides"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text)  # JSON 文本;secret=True 时为 Fernet token
    secret: Mapped[bool] = mapped_column(Boolean, default=False)
    env_fp: Mapped[str] = mapped_column(String(16))
    revision: Mapped[int] = mapped_column(Integer)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_by: Mapped[str] = mapped_column(String(64))


class SettingRevision(Base):
    __tablename__ = "setting_revisions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    actor: Mapped[str] = mapped_column(String(64))
    reason: Mapped[str] = mapped_column(String(200), default="")
    changes: Mapped[list] = mapped_column(JSON)  # [{key, op, old, new}];密钥为 {"enc": token}
    reverted_by: Mapped[int | None] = mapped_column(Integer, nullable=True)


class ConfigRevision(Base):
    __tablename__ = "config_revisions"

    name: Mapped[str] = mapped_column(String(32), primary_key=True)  # settings / rank_rules / prompts
    revision: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class RankRuleSet(Base):
    __tablename__ = "rank_rule_sets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    version: Mapped[int | None] = mapped_column(Integer, nullable=True, unique=True)
    status: Mapped[str] = mapped_column(String(12))  # draft / published / archived
    rules: Mapped[dict] = mapped_column(JSON)
    note: Mapped[str] = mapped_column(String(200), default="")
    created_by: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    published_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class RankProfileSnapshot(Base):
    __tablename__ = "rank_profile_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    batch_id: Mapped[str] = mapped_column(String(36), index=True)
    user_id: Mapped[int] = mapped_column(Integer)
    data: Mapped[dict] = mapped_column(JSON)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PromptVersion(Base):
    __tablename__ = "prompt_versions"
    __table_args__ = (UniqueConstraint("key", "version", name="uq_prompt_versions_key_version"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String(48), index=True)
    version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(12))
    body: Mapped[str] = mapped_column(Text)
    note: Mapped[str] = mapped_column(String(200), default="")
    created_by: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    published_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Announcement(Base):
    __tablename__ = "announcements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    level: Mapped[str] = mapped_column(String(8))  # info / warning
    text_zh: Mapped[str] = mapped_column(String(280))
    text_en: Mapped[str] = mapped_column(String(280))
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    dismissible: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class UpstreamCall(Base):
    __tablename__ = "upstream_calls"
    __table_args__ = (Index("ix_upstream_calls_user_id_at", "user_id", "at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    feature: Mapped[str] = mapped_column(String(16))
    kind: Mapped[str] = mapped_column(String(16))
    provider: Mapped[str] = mapped_column(String(32))
    model: Mapped[str] = mapped_column(String(64))
    status: Mapped[int] = mapped_column(Integer)
    ms: Mapped[int] = mapped_column(Integer)
    units_in: Mapped[int] = mapped_column(Integer, default=0)
    units_out: Mapped[int] = mapped_column(Integer, default=0)
    unit: Mapped[str] = mapped_column(String(8))


class UsageDaily(Base):
    __tablename__ = "usage_daily"
    __table_args__ = (UniqueConstraint("day", "feature", "kind", "provider", "model", "user_id",
                                       name="uq_usage_daily_bucket"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    day: Mapped[str] = mapped_column(String(10), index=True)
    feature: Mapped[str] = mapped_column(String(16))
    kind: Mapped[str] = mapped_column(String(16))
    provider: Mapped[str] = mapped_column(String(32))
    model: Mapped[str] = mapped_column(String(64))
    user_id: Mapped[int] = mapped_column(Integer, default=0)  # 0 = 无用户(系统调用)
    calls: Mapped[int] = mapped_column(Integer, default=0)
    errors: Mapped[int] = mapped_column(Integer, default=0)
    units_in: Mapped[int] = mapped_column(Integer, default=0)
    units_out: Mapped[int] = mapped_column(Integer, default=0)
    ms_total: Mapped[int] = mapped_column(Integer, default=0)


class UserQuotaOverride(Base):
    __tablename__ = "user_quota_overrides"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    key: Mapped[str] = mapped_column(String(40), primary_key=True)
    value: Mapped[int] = mapped_column(Integer)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    note: Mapped[str] = mapped_column(String(200), default="")
    updated_by: Mapped[str] = mapped_column(String(64))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class InviteCode(Base):
    __tablename__ = "invite_codes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code_hash: Mapped[str] = mapped_column(String(64), unique=True)
    label: Mapped[str] = mapped_column(String(64), default="")
    max_uses: Mapped[int] = mapped_column(Integer)
    uses: Mapped[int] = mapped_column(Integer, default=0)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


# ---- 联机练习 v2(设计文档 2026-10-10-rooms-v2 §7)----

class RoomVoice(Base):
    __tablename__ = "room_voice"
    __table_args__ = (Index("ix_room_voice_sender_id_created_at", "sender_id", "created_at"),)

    message_id: Mapped[str] = mapped_column(ForeignKey("room_messages.id", ondelete="CASCADE"), primary_key=True)
    room_id: Mapped[str] = mapped_column(ForeignKey("rooms.id", ondelete="CASCADE"), index=True)
    sender_id: Mapped[int] = mapped_column(Integer)  # no FK: survives user deletion like room_messages.sender_id
    duration_ms: Mapped[int] = mapped_column(Integer)
    audio_path: Mapped[str | None] = mapped_column(String(200), nullable=True)  # NULL once purged
    audio_bytes: Mapped[int] = mapped_column(Integer, default=0)
    audio_format: Mapped[str] = mapped_column(String(8))  # mp3 / wav
    staging_path: Mapped[str | None] = mapped_column(String(200), nullable=True)
    status: Mapped[str] = mapped_column(String(8))  # pending / done / empty / failed
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    transcript: Mapped[str | None] = mapped_column(Text, nullable=True)
    lang: Mapped[str | None] = mapped_column(String(2), nullable=True)
    translation: Mapped[str | None] = mapped_column(Text, nullable=True)
    translation_status: Mapped[str | None] = mapped_column(String(8), nullable=True)
    translation_attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    transcribed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    purged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class RoomReaction(Base):
    __tablename__ = "room_reactions"
    __table_args__ = (UniqueConstraint("message_id", "user_id", "key", name="uq_room_reactions_message_user_key"),
                      Index("ix_room_reactions_room_id_seq", "room_id", "seq"))

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    room_id: Mapped[str] = mapped_column(ForeignKey("rooms.id", ondelete="CASCADE"))
    message_id: Mapped[str] = mapped_column(ForeignKey("room_messages.id", ondelete="CASCADE"))
    seq: Mapped[int] = mapped_column(Integer)
    user_id: Mapped[int] = mapped_column(Integer)
    key: Mapped[str] = mapped_column(String(8))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class RoomJoinRequest(Base):
    __tablename__ = "room_join_requests"
    __table_args__ = (Index("ix_room_join_requests_room_id_status", "room_id", "status"),
                      Index("ix_room_join_requests_user_id_status", "user_id", "status"))

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    room_id: Mapped[str] = mapped_column(ForeignKey("rooms.id", ondelete="CASCADE"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    status: Mapped[str] = mapped_column(String(10))  # pending / approved / denied / expired / cancelled
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decided_by: Mapped[int | None] = mapped_column(Integer, nullable=True)


class RoomSummary(Base):
    __tablename__ = "room_summaries"

    room_id: Mapped[str] = mapped_column(ForeignKey("rooms.id", ondelete="CASCADE"), primary_key=True)
    status: Mapped[str] = mapped_column(String(8))  # pending / done / failed / skipped
    reason: Mapped[str | None] = mapped_column(String(16), nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


# ---- 背单词(设计文档 2026-10-10-wordbook §5)----

class WordbookEnrollment(Base):
    __tablename__ = "wordbook_enrollments"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    book_id: Mapped[str] = mapped_column(String(16), primary_key=True)
    status: Mapped[str] = mapped_column(String(8))  # active | paused(同一用户最多一本 active,应用层保证)
    order_mode: Mapped[str] = mapped_column(String(8))  # shuffle | book
    seed: Mapped[int] = mapped_column(Integer)
    cursor: Mapped[int] = mapped_column(Integer, default=0)  # 在书序排列中的下一个位置;只有新词真正建行才前进
    daily_new: Mapped[int] = mapped_column(Integer)
    review_cap: Mapped[int] = mapped_column(Integer)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class WordbookEvent(Base):
    __tablename__ = "wordbook_events"
    __table_args__ = (
        Index("ix_wordbook_events_user_id_created_at", "user_id", "created_at"),
        Index("ix_wordbook_events_user_id_day", "user_id", "day"),
        Index("ix_wordbook_events_book_id_kind", "book_id", "kind"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    book_id: Mapped[str] = mapped_column(String(16))
    kind: Mapped[str] = mapped_column(String(12))  # learn | review | practice | blank | spell_set
    word: Mapped[str] = mapped_column(String(100))  # 规范化键
    item_id: Mapped[str | None] = mapped_column(String(36), nullable=True)  # vocabulary_items.id
    qtype: Mapped[str | None] = mapped_column(String(12), nullable=True)
    outcome: Mapped[str] = mapped_column(String(12))
    credit: Mapped[int] = mapped_column(Integer, default=0)  # 0–100
    day: Mapped[str] = mapped_column(String(10))  # 用户本地日 YYYY-MM-DD
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class WordbookExplanation(Base):
    """AI「为什么」讲解的全站缓存:一个规范化词一条(不含用户输入)。"""
    __tablename__ = "wordbook_explanations"

    word: Mapped[str] = mapped_column(String(100), primary_key=True)
    body: Mapped[str] = mapped_column(Text)
    model: Mapped[str] = mapped_column(String(100))
    prompt_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class WordbookReport(Base):
    __tablename__ = "wordbook_reports"
    __table_args__ = (Index("ix_wordbook_reports_status_created_at", "status", "created_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    book_id: Mapped[str] = mapped_column(String(16))
    word: Mapped[str] = mapped_column(String(100))
    sentence_id: Mapped[str] = mapped_column(String(16))
    kind: Mapped[str] = mapped_column(String(12))  # sentence | passage (phase 2)
    reason: Mapped[str] = mapped_column(String(16))  # wrong | offensive | other
    status: Mapped[str] = mapped_column(String(12), default="open")  # open | hidden | dismissed
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class WordbookHiddenSentence(Base):
    __tablename__ = "wordbook_hidden_sentences"

    sentence_id: Mapped[str] = mapped_column(String(16), primary_key=True)
    book_id: Mapped[str] = mapped_column(String(16))
    hidden_by: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# ---- 学习联动(设计文档 2026-10-11-learning-links §10)----

class UserLinkPref(Base):
    """每用户联动开关;没有行 = 开。"""
    __tablename__ = "user_link_prefs"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    link_key: Mapped[str] = mapped_column(String(24), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class LinkMistakeWord(Base):
    """易错词(虚拟视图的状态;不复制 vocabulary_items)。"""
    __tablename__ = "link_mistake_words"
    __table_args__ = (Index("ix_link_mistake_words_user_id_cleared_at", "user_id", "cleared_at"),)

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    word: Mapped[str] = mapped_column(String(100), primary_key=True)
    book_id: Mapped[str] = mapped_column(String(16))
    wrong_count: Mapped[int] = mapped_column(Integer, default=0)
    ok_streak: Mapped[int] = mapped_column(Integer, default=0)
    last_event_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_wrong_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    cleared_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class LinkWeakWord(Base):
    """发音弱词。"""
    __tablename__ = "link_weak_words"
    __table_args__ = (Index("ix_link_weak_words_user_id_cleared_at", "user_id", "cleared_at"),)

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    word: Mapped[str] = mapped_column(String(100), primary_key=True)
    hits: Mapped[int] = mapped_column(Integer, default=0)
    last_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ok_streak: Mapped[int] = mapped_column(Integer, default=0)
    last_event_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_weak_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    cleared_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class LinkWordUse(Base):
    """对话里用到今日词:每个 learn 事件只记第一次;不存消息正文。"""
    __tablename__ = "link_word_uses"
    __table_args__ = (
        UniqueConstraint("user_id", "learn_event_id", name="uq_link_word_uses_user_learn"),
        Index("ix_link_word_uses_user_id_created_at", "user_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    word: Mapped[str] = mapped_column(String(100))
    learn_event_id: Mapped[int] = mapped_column(Integer)
    message_id: Mapped[str] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class LinkCredit(Base):
    """联动登记的段位点来源事实;段位经本模型读取(不导入 app.links)。"""
    __tablename__ = "link_credits"
    __table_args__ = (
        UniqueConstraint("user_id", "kind", "ref_id", name="uq_link_credits_user_kind_ref"),
        Index("ix_link_credits_user_id_created_at", "user_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(16))
    ref_id: Mapped[str] = mapped_column(String(80))
    score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


# ---- 智能体(设计文档 2026-10-12-agents §4.2、§4.3;计划 R-C3)----

class AgentPersona(Base):
    """用户自建角色;内置角色是代码里的静态数据(app/agents/personas.py),不进表。"""
    __tablename__ = "agent_personas"
    __table_args__ = (Index("ix_agent_personas_owner_id_created_at", "owner_id", "created_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(20))
    intro: Mapped[str] = mapped_column(String(60), default="", server_default="")
    prompt: Mapped[str] = mapped_column(Text)
    level: Mapped[str] = mapped_column(String(2), default="B1", server_default="B1")
    style: Mapped[str] = mapped_column(String(12), default="friendly", server_default="friendly")
    voice: Mapped[str | None] = mapped_column(String(64), nullable=True)
    tools: Mapped[list] = mapped_column(JSON, default=list)
    prompt_public: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    deep_think: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    disabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AgentUserSettings(Base):
    """用户级智能体设置(一行 JSON,逐键校验在 app/agents/settings.py)。没有行 = 全部默认值。"""
    __tablename__ = "agent_user_settings"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AgentPersonaReport(Base):
    """角色举报(计划 R-C3):每人每个角色一条;处理后写 resolved_*。不存举报理由之外的任何文本。"""
    __tablename__ = "agent_persona_reports"
    __table_args__ = (
        UniqueConstraint("persona_id", "reporter_id", name="uq_agent_persona_reports_persona_reporter"),
        Index("ix_agent_persona_reports_resolved_at_created_at", "resolved_at", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    persona_id: Mapped[str] = mapped_column(ForeignKey("agent_personas.id", ondelete="CASCADE"), index=True)
    reporter_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    reason: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    resolution: Mapped[str | None] = mapped_column(String(16), nullable=True)
