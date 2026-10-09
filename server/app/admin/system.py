"""系统状态(spec §13,viewer):版本、运行时长、数据库与迁移、磁盘、录音、在线数、计量队列、后台任务、设置状态。
只读;不含任何密钥(数据库 URL 只报后端类型)。"""
import logging
import platform
import shutil
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import func, select, text

from app.core import metering
from app.core.runtime_settings import read_revisions
from app.models import Assessment

logger = logging.getLogger(__name__)

SERVER_ROOT = Path(__file__).resolve().parents[2]  # server/ (holds alembic.ini and alembic/)
TASK_NAMES = ("watcher", "metering", "rooms_sweeper", "backups")
LOW_DISK = 0.10


def alembic_head(root: Path = SERVER_ROOT) -> str | None:
    try:
        from alembic.config import Config
        from alembic.script import ScriptDirectory

        cfg = Config(str(root / "alembic.ini"))
        cfg.set_main_option("script_location", str(root / "alembic"))
        return ScriptDirectory.from_config(cfg).get_current_head()
    except Exception as exc:  # noqa: BLE001 - status page must render anyway
        logger.warning("alembic head unavailable error=%s", type(exc).__name__)
        return None


async def _alembic_current(session) -> str | None:
    try:
        return await session.scalar(text("select version_num from alembic_version"))
    except Exception:  # noqa: BLE001 - table missing (tests use create_all)
        await session.rollback()
        return None


async def _db_size(app, session) -> int | None:
    engine = app.state.engine
    try:
        if engine.dialect.name == "sqlite":
            database = engine.url.database
            if not database or database == ":memory:":
                return None
            path = Path(database)
            return path.stat().st_size if path.exists() else None
        if engine.dialect.name == "postgresql":
            return int(await session.scalar(text("select pg_database_size(current_database())")))
    except Exception:  # noqa: BLE001
        await session.rollback()
    return None


def _disk(path: Path) -> dict:
    probe = path
    while not probe.exists() and probe.parent != probe:
        probe = probe.parent
    try:
        usage = shutil.disk_usage(probe)
    except OSError:
        return {"path": str(path), "total": None, "used": None, "free": None}
    return {"path": str(path), "total": usage.total, "used": usage.used, "free": usage.free}


def _task_state(task) -> bool | None:
    return None if task is None else not task.done()


def _tasks(app) -> dict:
    state = app.state
    tasks = dict(getattr(state, "background_tasks", {}) or {})
    rooms = getattr(state, "rooms", None)
    if rooms is not None and getattr(rooms, "sweeper", None) is not None:
        tasks["rooms_sweeper"] = rooms.sweeper
    return {name: _task_state(tasks.get(name)) for name in TASK_NAMES}


def _rooms_online(app) -> int:
    rt = getattr(app.state, "rooms", None)
    if rt is None:
        return 0
    return sum(len(rt.hub.online(room_id)) for room_id in rt.hub.active_rooms())


async def status(app, session) -> dict:
    s = app.state.settings
    hub = app.state.settings_hub
    now = datetime.now(timezone.utc)
    started = app.state.started_at
    current, head = await _alembic_current(session), alembic_head()
    revisions = await read_revisions(session)
    recordings = await session.scalar(select(func.coalesce(func.sum(Assessment.audio_bytes), 0)))
    disk = _disk(s.resolved_data_dir)
    tasks = _tasks(app)
    meter = {"depth": metering.METER.depth, "dropped": metering.METER.dropped}
    errors = (current != head and current is not None and head is not None) + sum(v is False for v in tasks.values()) \
        + bool(hub.load_error) + len(hub.apply_errors)
    low_disk = bool(disk["total"]) and disk["free"] / disk["total"] < LOW_DISK
    warns = bool(hub.pending_restart) + len(hub.invalid) + bool(meter["dropped"]) + low_disk + bool(hub.safe_mode)
    return {
        "version": s.app_version,
        "build_sha": s.build_sha,
        "python": platform.python_version(),
        "started_at": started.isoformat(),
        "uptime_seconds": int((now - started).total_seconds()),
        "workers": 1,
        "db": {"backend": app.state.engine.dialect.name, "size_bytes": await _db_size(app, session),
               "alembic_current": current, "alembic_head": head},
        "disk": disk,
        "recordings_bytes": int(recordings or 0),
        "realtime_active": app.state.realtime_registry.active_count,
        "rooms_connections": _rooms_online(app),
        "meter": meter,
        "tasks": tasks,
        "settings": {"revision": revisions.get("settings", 0), "safe_mode": hub.safe_mode,
                     "pending_restart": sorted(hub.pending_restart), "invalid": dict(hub.invalid),
                     "load_error": hub.load_error, "apply_errors": list(hub.apply_errors)},
        "findings": {"error": int(errors), "warn": int(warns)},
    }
