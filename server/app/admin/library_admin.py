"""管理端「跟读库」(spec 2026-10-13-video-import §12、E10;计划 2026-10-13-video-import-admin)。

管理员看不到内容:查询只选数字、状态、种类、阶段与来源主机名列,永不选 `title`、`source_url`、`media_path`、
`poster_path`,也不读 `library_segments` / `library_attempts`(计划 R-A7)。审计只记条目 id、字节数与数量(R-A6)。
条目的删除与取消只经 S1 的 `app.library.store`(R-A3),不在这里另写一套清理。"""
import asyncio
import importlib.metadata
import shutil
import time
from contextlib import suppress
from datetime import datetime

from sqlalchemy import func, select

from app.core.quotas import quota_for
from app.library import limits as library_limits
from app.models import DailyUsage, LibraryItem, User, iso_utc
from app.services.usage import utc_day

PAGE_SIZE = 50
TOP_USERS = 10
STATUSES = ("uploading", "queued", "processing", "ready", "failed", "canceled")
# 计数的 scope 与全站 subject 取 S1 的常量(A0 第 4、11 项):识别按秒计,译文 / 分析按「句」计、只有每人行。
ASR_SCOPE = library_limits.SCOPE_ASR
ASR_GLOBAL_SUBJECT = library_limits.GLOBAL
AI_TRANSLATE_SCOPE = library_limits.SCOPE_TRANSLATE
AI_ANALYSIS_SCOPE = library_limits.SCOPE_ANALYSIS
TOOLS_TTL_SECONDS = 600.0
VERSION_MAX = 40


class LibraryAdminError(Exception):
    def __init__(self, status: int, message: str, details: dict | None = None):
        super().__init__(message)
        self.status, self.message, self.details = status, message, details


def purge_phrase(count: int) -> str:
    return f"PURGE {count} ITEMS"


# ---- 工具版本(R-A9) ----

def parse_ffmpeg_version(line: str) -> str | None:
    parts = (line or "").split()
    if len(parts) >= 3 and parts[0] == "ffmpeg" and parts[1] == "version":
        return parts[2][:VERSION_MAX]
    return None


def ytdlp_version() -> str | None:
    """只读包元数据,不 import yt_dlp。"""
    try:
        return importlib.metadata.version("yt-dlp")[:VERSION_MAX]
    except importlib.metadata.PackageNotFoundError:
        return None


async def ffmpeg_version() -> str | None:
    """`ffmpeg -version` 标准输出的第一行;不经 shell,标准错误丢弃,5 s 超时。"""
    path = shutil.which("ffmpeg")
    if not path:
        return None
    try:
        proc = await asyncio.create_subprocess_exec(
            path, "-version", stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL)
    except (OSError, NotImplementedError):
        return None
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), 5.0)
    except asyncio.TimeoutError:
        with suppress(ProcessLookupError):
            proc.kill()
        with suppress(Exception):
            await proc.wait()
        return None
    lines = out.decode("utf-8", "replace").splitlines()
    return parse_ffmpeg_version(lines[0]) if lines else None


async def tool_versions(app) -> dict:
    """每进程缓存 10 分钟(总览每次打开都会调用)。"""
    cached = getattr(app.state, "library_tool_versions", None)
    now = time.monotonic()
    if cached is not None and cached[0] > now:
        return dict(cached[1])
    value = {"ffmpeg": await ffmpeg_version(), "ytdlp": ytdlp_version()}
    app.state.library_tool_versions = (now + TOOLS_TTL_SECONDS, value)
    return dict(value)


# ---- 查询 ----

_ROW_COLUMNS = (
    LibraryItem.id, LibraryItem.user_id, User.username, LibraryItem.kind, LibraryItem.source, LibraryItem.status,
    LibraryItem.stage, LibraryItem.progress, LibraryItem.error_kind, LibraryItem.duration_ms,
    LibraryItem.library_bytes, LibraryItem.sub_source, LibraryItem.source_host, LibraryItem.created_at,
)


def _row(r) -> dict:
    return {"id": r.id, "user_id": r.user_id, "username": r.username, "kind": r.kind, "source": r.source,
            "status": r.status, "stage": r.stage, "progress": int(r.progress or 0), "error_kind": r.error_kind,
            "duration_ms": r.duration_ms, "bytes": int(r.library_bytes or 0), "sub_source": r.sub_source,
            "source_host": r.source_host, "created_at": iso_utc(r.created_at)}


async def _status_counts(session, *where) -> dict[str, int]:
    rows = (await session.execute(
        select(LibraryItem.status, func.count()).where(*where).group_by(LibraryItem.status))).all()
    found = {status: int(count) for status, count in rows}
    return {status: found.get(status, 0) for status in STATUSES}


async def _day_total(session, scope: str, day) -> int:
    """某个 scope 今天的计数(R-A20):取「全站行(subject='*')」与「每人行之和」中较大的一个,
    这样 S1 只写全站行、只写每人行、或两者都写,都不会漏、也不会重复相加。只读 daily_usage,不碰 library_segments。"""
    base = (DailyUsage.scope == scope, DailyUsage.day == day)
    star = await session.scalar(select(func.coalesce(func.sum(DailyUsage.count), 0)).where(
        *base, DailyUsage.subject == ASR_GLOBAL_SUBJECT)) or 0
    users = await session.scalar(select(func.coalesce(func.sum(DailyUsage.count), 0)).where(
        *base, DailyUsage.subject != ASR_GLOBAL_SUBJECT)) or 0
    return int(max(star, users))


async def overview(session, app, now: datetime) -> dict:
    """形状 = admin `LibraryOverview` 的 snake_case;只有开关、数字与版本。"""
    s = app.state.settings
    by_status = await _status_counts(session)
    count, total, users = (await session.execute(
        select(func.count(LibraryItem.id), func.coalesce(func.sum(LibraryItem.library_bytes), 0),
               func.count(func.distinct(LibraryItem.user_id))))).one()
    asr_seconds = await session.scalar(select(DailyUsage.count).where(
        DailyUsage.scope == ASR_SCOPE, DailyUsage.subject == ASR_GLOBAL_SUBJECT, DailyUsage.day == utc_day(now))) or 0
    today = utc_day(now)
    translated = await _day_total(session, AI_TRANSLATE_SCOPE, today)
    analysed = await _day_total(session, AI_ANALYSIS_SCOPE, today)
    worker = getattr(app.state, "library", None)
    running = len(getattr(worker, "pending", None) or ())  # 本进程(R-A8)
    return {
        "enabled": bool(s.library_enabled),
        "available": bool(s.library_available),
        "asr": {"enabled": bool(s.library_asr_enabled), "available": bool(s.library_asr_available),
                "today_minutes": round(int(asr_seconds) / 60, 1),
                "global_daily_minutes": int(s.library_asr_minutes_global_daily)},
        "link": {"enabled": bool(s.library_link_import_enabled), "available": bool(s.library_link_available),
                 "allow_generic": bool(s.library_link_allow_generic),
                 "cookies_configured": bool((s.library_ytdlp_cookies_file or "").strip()),
                 "proxy_configured": bool((s.library_ytdlp_proxy or "").strip())},
        "ai": {"enabled": bool(s.library_ai_enabled), "available": bool(getattr(s, "library_ai_available", False)),
               "today_translated": translated, "today_analysed": analysed,
               "global_daily": int(s.library_ai_daily_global),
               "translate_daily_per_user": int(s.library_translate_daily_per_user),
               "analysis_daily_per_user": int(s.library_analysis_daily_per_user)},
        "tools": await tool_versions(app),
        "totals": {"items": int(count), "bytes": int(total), "users": int(users)},
        "by_status": by_status,
        "queue": {"queued": by_status["queued"], "processing": by_status["processing"], "running": running,
                  "concurrency": int(s.library_job_concurrency)},
        "limits": {"quota_mb": int(s.library_quota_mb), "max_items": int(s.library_max_items),
                   "max_upload_mb": int(s.library_max_upload_mb),
                   "max_duration_minutes": int(s.library_max_duration_minutes)},
        "purge_confirm": purge_phrase(by_status["failed"]),
    }


async def items(session, *, status: str | None, user_id: int | None, kind: str | None, page: int) -> dict:
    where = []
    if status:
        where.append(LibraryItem.status == status)
    if user_id is not None:
        where.append(LibraryItem.user_id == user_id)
    if kind:
        where.append(LibraryItem.kind == kind)
    total = await session.scalar(select(func.count(LibraryItem.id)).where(*where)) or 0
    rows = (await session.execute(
        select(*_ROW_COLUMNS).outerjoin(User, User.id == LibraryItem.user_id).where(*where)
        .order_by(LibraryItem.created_at.desc(), LibraryItem.id.desc())
        .offset((page - 1) * PAGE_SIZE).limit(PAGE_SIZE + 1))).all()
    return {"items": [_row(r) for r in rows[:PAGE_SIZE]], "page": page,
            "next": page + 1 if len(rows) > PAGE_SIZE else None, "total": int(total)}


async def top_users(session, limit: int = TOP_USERS) -> list[dict]:
    total = func.coalesce(func.sum(LibraryItem.library_bytes), 0)
    rows = (await session.execute(
        select(LibraryItem.user_id, User.username, func.count(LibraryItem.id), total)
        .outerjoin(User, User.id == LibraryItem.user_id)
        .group_by(LibraryItem.user_id, User.username)
        .order_by(total.desc(), LibraryItem.user_id)
        .limit(limit))).all()
    return [{"user_id": uid, "username": name, "items": int(n), "bytes": int(b)} for uid, name, n, b in rows]


async def user_usage(session, settings, user_id: int, now: datetime) -> dict:
    """用户详情页的占用条(R-A11);配额含按用户覆盖。"""
    if await session.get(User, user_id) is None:
        raise LibraryAdminError(404, "User not found")
    count, total = (await session.execute(
        select(func.count(LibraryItem.id), func.coalesce(func.sum(LibraryItem.library_bytes), 0))
        .where(LibraryItem.user_id == user_id))).one()
    return {"user_id": user_id, "enabled": bool(settings.library_enabled), "items": int(count), "bytes": int(total),
            "quota_mb": int(await quota_for(session, settings, user_id, "library_quota_mb", now)),
            "max_items": int(await quota_for(session, settings, user_id, "library_max_items", now)),
            "by_status": await _status_counts(session, LibraryItem.user_id == user_id)}
