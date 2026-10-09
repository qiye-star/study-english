import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
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


class PromotionMatch(Base):
    __tablename__ = "promotion_matches"
    __table_args__ = (Index("ix_promotion_matches_user_id_started_at", "user_id", "started_at"),)

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
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


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
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    topic: Mapped[str] = mapped_column(String(100), default="")
    status: Mapped[str] = mapped_column(String(8), default="open")
    locked: Mapped[bool] = mapped_column(Boolean, default=False)
    ai_public: Mapped[bool] = mapped_column(Boolean, default=True)
    last_seq: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_active_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    close_reason: Mapped[str | None] = mapped_column(String(16), nullable=True)


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


class RoomReport(Base):
    __tablename__ = "room_reports"
    __table_args__ = (UniqueConstraint("message_id", "reporter_id", name="uq_room_reports_message_reporter"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    room_id: Mapped[str] = mapped_column(ForeignKey("rooms.id", ondelete="CASCADE"), index=True)
    message_id: Mapped[str] = mapped_column(String(36))
    reporter_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    reason: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
