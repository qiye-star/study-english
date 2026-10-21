"""运维端点(spec §9、§12、§13):公告、维护模式、系统状态、脱敏日志、备份与数据清理。薄端点:业务在 app.admin.*,写操作同一事务审计。"""
import time
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin import announcements, audit, backups, housekeeping, storage, system
from app.admin.announcements import AnnouncementError
from app.admin.perms import AdminContext, require, require_step_up, step_up_until
from app.core import log_buffer
from app.core.deps import get_session
from app.models import AdminAudit
from app.storage import BlobNotFound, get_store
from app.storage.http import blob_response

router = APIRouter(prefix="/api/admin")


def _error(e: AnnouncementError) -> JSONResponse:
    return JSONResponse({"error": e.message, **(e.details or {})} if e.status == 422 else
                        {"error": e.message, **({"details": e.details} if e.details else {})}, status_code=e.status)


# ---- announcements (operator) ----

class AnnouncementIn(BaseModel):
    level: Literal["info", "warning"]
    text_zh: str = Field(min_length=1, max_length=280)
    text_en: str = Field("", max_length=280)
    starts_at: datetime
    ends_at: datetime | None = None
    dismissible: bool = True


class AnnouncementPatch(BaseModel):
    level: Literal["info", "warning"] | None = None
    text_zh: str | None = Field(None, min_length=1, max_length=280)
    text_en: str | None = Field(None, max_length=280)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    dismissible: bool | None = None


@router.get("/announcements")
async def list_announcements(_: AdminContext = Depends(require("operator")),
                             session: AsyncSession = Depends(get_session)):
    return {"announcements": await announcements.listing(session)}


@router.post("/announcements", status_code=201)
async def create_announcement(body: AnnouncementIn, ctx: AdminContext = Depends(require("operator")),
                              session: AsyncSession = Depends(get_session)):
    try:
        row = await announcements.create(session, ctx.actor, body.model_dump())
    except AnnouncementError as e:
        return _error(e)
    await session.commit()
    return announcements.admin_out(row, datetime.now(timezone.utc))


@router.patch("/announcements/{announcement_id}")
async def update_announcement(announcement_id: int, body: AnnouncementPatch,
                              ctx: AdminContext = Depends(require("operator")),
                              session: AsyncSession = Depends(get_session)):
    data = body.model_dump(exclude_unset=True)
    if data.get("level") is None:
        data.pop("level", None)
    try:
        row = await announcements.update(session, ctx.actor, announcement_id, data)
    except AnnouncementError as e:
        return _error(e)
    await session.commit()
    return announcements.admin_out(row, datetime.now(timezone.utc))


@router.delete("/announcements/{announcement_id}")
async def archive_announcement(announcement_id: int, ctx: AdminContext = Depends(require("operator")),
                               session: AsyncSession = Depends(get_session)):
    try:
        row = await announcements.archive(session, ctx.actor, announcement_id)
    except AnnouncementError as e:
        return _error(e)
    await session.commit()
    return announcements.admin_out(row, datetime.now(timezone.utc))


# ---- maintenance (superadmin; turning it on also needs step-up + typed confirmation) ----

class MaintenanceIn(BaseModel):
    mode: Literal["off", "read_only", "full"] | None = None
    message_zh: str | None = Field(None, max_length=280)
    message_en: str | None = Field(None, max_length=280)
    reason: str = Field(max_length=200)
    confirm: str | None = Field(None, max_length=64)


@router.get("/maintenance")
async def get_maintenance(request: Request, _: AdminContext = Depends(require("operator"))):
    return announcements.maintenance_out(request.app.state.settings)


@router.post("/maintenance")
async def set_maintenance(body: MaintenanceIn, request: Request, ctx: AdminContext = Depends(require("superadmin")),
                          session: AsyncSession = Depends(get_session)):
    changes = {"maintenance_mode": body.mode, "maintenance_message_zh": body.message_zh,
               "maintenance_message_en": body.message_en}
    try:
        result = await announcements.set_maintenance(
            session, request.app, ctx.actor, changes, reason=body.reason, confirm=body.confirm,
            stepped_up=step_up_until(request.app.state.settings, ctx.session) is not None)
    except AnnouncementError as e:
        return _error(e)
    return {"revision": result.revision, "changed": result.changed,
            **announcements.maintenance_out(request.app.state.settings)}


# ---- system status (viewer) and the redacted in-memory log viewer (operator) ----

@router.get("/system")
async def system_status(request: Request, _: AdminContext = Depends(require("viewer")),
                        session: AsyncSession = Depends(get_session)):
    return await system.status(request.app, session)


@router.get("/logs")
async def logs(level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] | None = None,
               logger: str | None = Query(None, max_length=100), q: str | None = Query(None, max_length=200),
               after_id: int | None = Query(None, ge=0), limit: int = Query(200, ge=1, le=2000),
               ctx: AdminContext = Depends(require("operator")), session: AsyncSession = Depends(get_session)):
    seen = await session.scalar(select(AdminAudit.id).where(AdminAudit.action == "logs.view",
                                                            AdminAudit.session_id == ctx.session.id).limit(1))
    if seen is None:  # audited once per admin session
        await audit.record(session, ctx.actor, "logs.view")
        await session.commit()
    entries = log_buffer.query(level=level, logger_prefix=logger, q=q, after_id=after_id, limit=limit)
    return {"entries": [e.__dict__ for e in entries], "capacity": log_buffer.BUFFER_CAPACITY}


# ---- SQLite backups (superadmin; link/delete need step-up) ----

def _link_secret(request: Request, ctx: AdminContext) -> bytes:
    """Download links only work in the admin session that created them."""
    return request.app.state.admin_secret + b"|backup|" + ctx.session.id.encode()


def _used_links(request: Request) -> dict[str, float]:
    used = getattr(request.app.state, "used_backup_links", None)
    if used is None:
        used = request.app.state.used_backup_links = {}
    now = time.time()
    for token, exp in list(used.items()):
        if exp < now:
            del used[token]
    return used


@router.get("/backups")
async def list_backups(request: Request, _: AdminContext = Depends(require("superadmin"))):
    s = request.app.state.settings
    supported = backups.supported(request.app)
    listing = await backups.list_all(s, get_store(request.app)) if supported else []
    return {"supported": supported, "hint": None if supported else backups.PG_HINT, "keep": s.backup_keep,
            "hour_utc": s.backup_hour_utc, "backups": listing}


@router.post("/backups", status_code=201)
async def create_backup(request: Request, ctx: AdminContext = Depends(require("superadmin")),
                        session: AsyncSession = Depends(get_session)):
    try:
        out = await backups.create_backup(request.app, datetime.now(timezone.utc))
    except backups.BackupUnsupported:
        return JSONResponse({"error": "Use pg_dump", "details": {"hint": backups.PG_HINT}}, status_code=409)
    await audit.record(session, ctx.actor, "backup.create", target_type="backup", target_id=out["name"],
                       summary=f"{out['bytes']} bytes")
    await session.commit()
    return out


@router.post("/backups/{name}/link")
async def backup_link(name: str, request: Request, ctx: AdminContext = Depends(require_step_up)):
    try:
        if not await backups.exists_anywhere(request.app.state.settings, get_store(request.app), name):
            raise HTTPException(404, "Not Found")
        token = backups.sign_download(_link_secret(request, ctx), name, time.time())
    except ValueError:
        raise HTTPException(404, "Not Found") from None
    return {"url": f"/api/admin/backups/download/{token}", "expires_in": backups.LINK_TTL}


@router.get("/backups/download/{token}")
async def backup_download(token: str, request: Request, ctx: AdminContext = Depends(require("superadmin")),
                          session: AsyncSession = Depends(get_session)):
    now = time.time()
    name = backups.verify_download(_link_secret(request, ctx), token, now)
    used = _used_links(request)
    if name is None or token in used:
        raise HTTPException(404, "Not Found")
    path = backups.path_of(request.app.state.settings, name)
    remote = backups.remote_of(get_store(request.app))
    if not path.is_file() and (remote is None or await remote.stat(backups.REMOTE_PREFIX + name) is None):
        raise HTTPException(404, "Not Found")
    used[token] = now + backups.LINK_TTL
    await audit.record(session, ctx.actor, "backup.download", target_type="backup", target_id=name)
    await session.commit()
    if path.is_file():  # the local copy first (plan L1 R13)
        return FileResponse(path, media_type="application/octet-stream", filename=name,
                            headers={"Cache-Control": "no-store"})
    try:  # no local copy: stream it from the object store, same headers
        return await blob_response(remote, backups.REMOTE_PREFIX + name, request, media_type="application/octet-stream",
                                   headers={"Cache-Control": "no-store"}, filename=name)
    except BlobNotFound:
        raise HTTPException(404, "Not Found") from None


@router.delete("/backups/{name}", status_code=204)
async def delete_backup(name: str, request: Request, ctx: AdminContext = Depends(require_step_up),
                        session: AsyncSession = Depends(get_session)):
    try:
        await backups.delete_everywhere(request.app.state.settings, get_store(request.app), name)
    except (ValueError, FileNotFoundError):
        raise HTTPException(404, "Not Found") from None
    await audit.record(session, ctx.actor, "backup.delete", target_type="backup", target_id=name)
    await session.commit()
    return Response(status_code=204)


# ---- housekeeping (superadmin; running a tool needs step-up and a reason) ----

Tool = Literal["orphan_recordings", "audit", "room_audio"]
ROOM_AUDIO_MIN_DAYS = 30
ROOM_AUDIO_DEFAULT_DAYS = 365  # a suggestion only: the tool never runs by itself


class HousekeepingRunIn(BaseModel):
    token: str | None = Field(None, max_length=64)
    older_than_days: int | None = Field(None, ge=1, le=36500)
    reason: str = Field(min_length=4, max_length=200)
    confirm: str | None = Field(None, max_length=64)  # room_audio: the typed phrase "DELETE {count} FILES"


class HousekeepingScanIn(BaseModel):
    older_than_days: int = Field(ROOM_AUDIO_DEFAULT_DAYS, ge=ROOM_AUDIO_MIN_DAYS, le=36500)


@router.get("/storage")
async def storage_usage(request: Request, _: AdminContext = Depends(require("viewer")),
                        session: AsyncSession = Depends(get_session)):
    return await storage.storage_summary(session, get_store(request.app))


async def _room_audio_run(body: HousekeepingRunIn, request: Request, ctx: AdminContext, session: AsyncSession):
    days = body.older_than_days
    if days is None or days < ROOM_AUDIO_MIN_DAYS:
        return JSONResponse({"error": "Invalid settings", "fields": {
            "older_than_days": f"at least {ROOM_AUDIO_MIN_DAYS}"}}, status_code=422)
    try:
        files, size = await housekeeping.purge_room_audio_detail(
            session, get_store(request.app), days, body.token or "", datetime.now(timezone.utc),
            confirm=body.confirm or "")
    except ValueError as e:
        if str(e) == "Confirmation required":
            return JSONResponse({"error": "Confirmation required"}, status_code=422)
        return JSONResponse({"error": "Rescan required"}, status_code=409)
    await audit.record(session, ctx.actor, "housekeeping.room_audio", target_type="room_audio",
                       summary=f"deleted {files} files, {size} bytes",
                       after={"files": files, "bytes": size, "older_than_days": days}, reason=body.reason)
    await session.commit()
    return {"deleted": files, "bytes": size}


@router.post("/housekeeping/{tool}/scan")
async def housekeeping_scan(tool: Tool, request: Request, body: HousekeepingScanIn | None = None,
                            _: AdminContext = Depends(require("superadmin")),
                            session: AsyncSession = Depends(get_session)):
    settings = request.app.state.settings
    if tool == "room_audio":
        days = (body or HousekeepingScanIn()).older_than_days
        scan = await housekeeping.scan_room_audio(session, get_store(request.app), days, datetime.now(timezone.utc))
        return {"token": scan.token, "count": scan.count, "bytes": scan.bytes, "rooms": scan.rooms,
                "samples": scan.samples, "older_than_days": days,
                "confirm": housekeeping.confirm_phrase(scan.count)}
    if tool == "orphan_recordings":
        scan = await housekeeping.scan_orphan_recordings(session, get_store(request.app))
        return {"token": scan.token, "count": scan.count, "bytes": scan.bytes, "samples": scan.samples}
    days = settings.admin_audit_retention_days
    return {"retention_days": days, "count": await housekeeping.audit_purgeable(session, days)}


@router.post("/housekeeping/{tool}/run")
async def housekeeping_run(tool: Tool, body: HousekeepingRunIn, request: Request,
                           ctx: AdminContext = Depends(require_step_up), session: AsyncSession = Depends(get_session)):
    settings = request.app.state.settings
    if tool == "room_audio":
        return await _room_audio_run(body, request, ctx, session)
    if tool == "orphan_recordings":
        try:
            deleted = await housekeeping.delete_orphan_recordings(session, get_store(request.app), body.token or "")
        except ValueError:
            return JSONResponse({"error": "Rescan required"}, status_code=409)
        await audit.record(session, ctx.actor, "housekeeping.orphan_recordings", target_type="recordings",
                           summary=f"deleted {deleted} files", reason=body.reason)
    else:
        days = body.older_than_days or settings.admin_audit_retention_days
        try:
            deleted = await housekeeping.purge_audit(session, ctx.actor, days,
                                                     retention_days=settings.admin_audit_retention_days,
                                                     reason=body.reason)
        except ValueError:
            return JSONResponse({"error": "Invalid settings", "fields": {
                "older_than_days": f"at least {settings.admin_audit_retention_days}"}}, status_code=422)
    await session.commit()
    return {"deleted": deleted}
