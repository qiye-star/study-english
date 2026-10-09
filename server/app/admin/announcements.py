"""公告与维护模式开关(spec §9)。每个写操作在同一事务里写审计(只记级别、时间窗与摘要)。

维护模式是普通设置(`maintenance_mode`、`maintenance_message_zh/en`):经 `settings_service.save(action="maintenance.set")`
写库(修订、审计、发布中心与监听器与设置页同一条路径),立即生效;
切到 read_only/full 是危险操作:超级管理员 + 二次验证 + 理由 + 输入 `MAINTENANCE_MODE` 确认。
"""
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select

from app.admin import audit
from app.admin.audit import Actor
from app.core.runtime_settings import OverrideError, coerce
from app.core.settings_registry import SPECS
from app.models import Announcement, SettingOverride, iso_utc

LEVELS = ("info", "warning")
MAX_TEXT = 280
MAINTENANCE_KEYS = ("maintenance_mode", "maintenance_message_zh", "maintenance_message_en")
CONFIRM_PHRASE = "MAINTENANCE_MODE"


class AnnouncementError(Exception):
    def __init__(self, status: int, message: str, details: dict | None = None):
        super().__init__(message)
        self.status, self.message, self.details = status, message, details


def _utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def status_of(a: Announcement, now: datetime) -> str:
    if a.archived_at is not None:
        return "archived"
    if _utc(a.starts_at) > now:
        return "scheduled"
    if a.ends_at is not None and _utc(a.ends_at) <= now:
        return "ended"
    return "active"


def announcement_out(a: Announcement) -> dict:
    return {"id": a.id, "level": a.level, "text_zh": a.text_zh, "text_en": a.text_en, "dismissible": a.dismissible,
            "starts_at": iso_utc(a.starts_at), "ends_at": iso_utc(a.ends_at) if a.ends_at else None}


def admin_out(a: Announcement, now: datetime) -> dict:
    return {**announcement_out(a), "status": status_of(a, now), "created_by": a.created_by,
            "created_at": iso_utc(a.created_at), "archived_at": iso_utc(a.archived_at) if a.archived_at else None}


async def active(session, now: datetime) -> list[Announcement]:
    rows = (await session.scalars(select(Announcement).where(Announcement.archived_at.is_(None))
                                  .order_by(Announcement.starts_at.desc(), Announcement.id.desc()))).all()
    return [a for a in rows if status_of(a, now) == "active"]


async def listing(session, now: datetime | None = None) -> list[dict]:
    now = now or datetime.now(timezone.utc)
    rows = (await session.scalars(select(Announcement).order_by(Announcement.id.desc()))).all()
    return [admin_out(a, now) for a in rows]


def _validate(data: dict) -> dict:
    level, zh, en = data.get("level"), (data.get("text_zh") or "").strip(), (data.get("text_en") or "").strip()
    starts, ends = _utc(data.get("starts_at")), _utc(data.get("ends_at"))
    fields = {}
    if level not in LEVELS:
        fields["level"] = "must be info or warning"
    if not 1 <= len(zh) <= MAX_TEXT:
        fields["text_zh"] = f"1–{MAX_TEXT} characters"
    if len(en) > MAX_TEXT:
        fields["text_en"] = f"at most {MAX_TEXT} characters"
    if starts is None:
        fields["starts_at"] = "required"
    elif ends is not None and ends <= starts:
        fields["ends_at"] = "must be after starts_at"
    if fields:
        raise AnnouncementError(422, "Invalid announcement", {"fields": fields})
    return {"level": level, "text_zh": zh, "text_en": en, "starts_at": starts, "ends_at": ends,
            "dismissible": bool(data.get("dismissible", True))}


def _audit_view(a: Announcement) -> dict:
    return {"level": a.level, "starts_at": iso_utc(a.starts_at), "ends_at": iso_utc(a.ends_at) if a.ends_at else None,
            "dismissible": a.dismissible}


async def create(session, actor: Actor, data: dict) -> Announcement:
    row = Announcement(**_validate(data), created_by=actor.name[:64], created_at=datetime.now(timezone.utc))
    session.add(row)
    await session.flush()
    await audit.record(session, actor, "announcement.create", target_type="announcement", target_id=row.id,
                       summary=row.text_zh[:60], after=_audit_view(row))
    return row


async def _get(session, id: int) -> Announcement:
    row = await session.get(Announcement, id)
    if row is None:
        raise AnnouncementError(404, "Not Found")
    return row


async def update(session, actor: Actor, id: int, data: dict) -> Announcement:
    row = await _get(session, id)
    if row.archived_at is not None:
        raise AnnouncementError(409, "Announcement is archived")
    before = _audit_view(row)
    current = {"level": row.level, "text_zh": row.text_zh, "text_en": row.text_en, "starts_at": row.starts_at,
               "ends_at": row.ends_at, "dismissible": row.dismissible}
    for key, value in _validate({**current, **data}).items():
        setattr(row, key, value)
    await audit.record(session, actor, "announcement.update", target_type="announcement", target_id=row.id,
                       summary=row.text_zh[:60], before=before, after=_audit_view(row))
    return row


async def archive(session, actor: Actor, id: int) -> Announcement:
    row = await _get(session, id)
    if row.archived_at is None:
        row.archived_at = datetime.now(timezone.utc)
        await audit.record(session, actor, "announcement.archive", target_type="announcement", target_id=row.id,
                           summary=row.text_zh[:60])
    return row


# ---- maintenance mode ----

@dataclass(frozen=True)
class MaintenanceResult:
    revision: int
    changed: list[str]


def maintenance_out(settings) -> dict:
    return {"mode": settings.maintenance_mode, "message_zh": settings.maintenance_message_zh,
            "message_en": settings.maintenance_message_en}


async def set_maintenance(session, app, actor: Actor, changes: dict, *, reason: str, confirm: str | None,
                          stepped_up: bool) -> MaintenanceResult:
    """Write the maintenance settings through the settings service (one write path: revision, audit
    `maintenance.set`, hub publish and listeners). Caller has superadmin. A value equal to the env value resets the
    override. Turning maintenance on (read_only/full) needs step-up + reason + typed MAINTENANCE_MODE (the registry
    danger rule); every change needs a reason of at least 4 characters."""
    from app.admin import settings_service  # module attribute, so tests can spy on save

    base, current = app.state.base_settings, app.state.settings
    changes = {k: v for k, v in changes.items() if k in MAINTENANCE_KEYS and v is not None}
    try:
        coerced = {k: coerce(SPECS[k], v) for k, v in changes.items()}
    except OverrideError as exc:
        raise AnnouncementError(422, "Invalid settings", {"fields": exc.fields}) from None
    changed = [k for k in MAINTENANCE_KEYS if k in coerced and coerced[k] != getattr(current, k)]
    if not changed:
        raise AnnouncementError(409, "Nothing to change")
    if len(reason.strip()) < 4:
        raise AnnouncementError(422, "Invalid settings", {"fields": {"reason": "at least 4 characters"}})
    stored = set((await session.scalars(select(SettingOverride.key).where(SettingOverride.key.in_(changed)))).all())
    writes = {k: (None if coerced[k] == getattr(base, k) and k in stored else coerced[k]) for k in changed}
    try:
        result = await settings_service.save(session, app, actor, writes, reason=reason, confirm=confirm,
                                             stepped_up=stepped_up, action="maintenance.set")
    except settings_service.SettingsError as exc:
        details = {"fields": exc.fields} if exc.status == 422 and exc.fields else (exc.details or None)
        raise AnnouncementError(exc.status, exc.error, details) from None
    return MaintenanceResult(result.revision, result.changed)
