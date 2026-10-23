"""SQLite 备份(spec §12):`VACUUM INTO` 生成一致性快照到 `BACKUP_DIR`(默认 DATA_DIR/backups),保留最近
`BACKUP_KEEP` 份,`BACKUP_HOUR_UTC` 每日自动一次。Postgres 不在应用内备份(提示用 pg_dump,不执行外部命令)。

下载用短期签名链接(60 秒、一次性、绑定签发它的管理会话):token = base64url("name|exp") + "." + HMAC。
文件名只由时间生成并且必须匹配 BACKUP_RE,任何外部输入都不能拼出备份目录外的路径。
"""
import asyncio
import base64
import binascii
import hashlib
import hmac
import logging
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.admin import housekeeping

logger = logging.getLogger(__name__)

BACKUP_RE = re.compile(r"^app-\d{8}-\d{6}\.db$")
LINK_TTL = 60
PG_HINT = ("PostgreSQL 请在服务器上用 pg_dump 备份,例如:docker compose exec postgres pg_dump -U enjoy enjoy > backup.sql")


class BackupUnsupported(Exception):
    pass


def _check(name: str) -> str:
    if not isinstance(name, str) or not BACKUP_RE.fullmatch(name):
        raise ValueError("Invalid backup name")
    return name


def path_of(settings, name: str) -> Path:
    return settings.resolved_backup_dir / _check(name)


def supported(app) -> bool:
    return app.state.engine.dialect.name == "sqlite"


def _out(path: Path) -> dict:
    stat = path.stat()
    return {"name": path.name, "bytes": stat.st_size,
            "created_at": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat()}


def list_backups(settings) -> list[dict]:
    root = settings.resolved_backup_dir
    if not root.is_dir():
        return []
    files = [p for p in root.iterdir() if p.is_file() and BACKUP_RE.fullmatch(p.name)]
    return [_out(p) for p in sorted(files, key=lambda p: p.name, reverse=True)]


def delete_backup(settings, name: str) -> None:
    path = path_of(settings, name)
    if not path.is_file():
        raise FileNotFoundError(name)
    path.unlink()


def prune(settings) -> int:
    keep = max(1, settings.backup_keep)
    removed = 0
    for item in list_backups(settings)[keep:]:
        try:
            (settings.resolved_backup_dir / item["name"]).unlink()
            removed += 1
        except OSError as exc:
            logger.warning("backup prune failed error=%s", type(exc).__name__)
    return removed


REMOTE_PREFIX = "backups/"


def remote_of(blobs):
    """The object store that keeps backup copies: the S3 primary (also behind a read fallback), else None. A local
    primary keeps backups where they always were (plan L1 R13: no second copy on the same disk)."""
    store = getattr(blobs, "primary", blobs)
    return store if getattr(store, "name", "") == "s3" else None


async def list_all(settings, blobs) -> list[dict]:
    """Local and remote copies merged by name; `where` says which copies exist (plan L1 R13)."""
    local = {item["name"]: item for item in list_backups(settings)}
    remote_names: set[str] = set()
    remote = remote_of(blobs)
    if remote is not None:
        async for info in remote.list(REMOTE_PREFIX):
            name = info.key[len(REMOTE_PREFIX):]
            if BACKUP_RE.fullmatch(name):
                remote_names.add(name)
    out = []
    for name in sorted(set(local) | remote_names, reverse=True):
        item = dict(local.get(name) or {"name": name, "bytes": 0, "created_at": None})
        item["where"] = "both" if name in local and name in remote_names else ("local" if name in local else "remote")
        out.append(item)
    return out


async def exists_anywhere(settings, blobs, name: str) -> bool:
    if path_of(settings, name).is_file():
        return True
    remote = remote_of(blobs)
    return remote is not None and await remote.stat(REMOTE_PREFIX + _check(name)) is not None


async def delete_everywhere(settings, blobs, name: str) -> None:
    """Deletes the local and the remote copy. FileNotFoundError when neither exists."""
    found = False
    if path_of(settings, name).is_file():
        path_of(settings, name).unlink()
        found = True
    remote = remote_of(blobs)
    if remote is not None:
        found = await remote.delete(REMOTE_PREFIX + _check(name)) or found
    if not found:
        raise FileNotFoundError(name)


async def _prune_remote(blobs, keep: int) -> int:
    remote = remote_of(blobs)
    if remote is None:
        return 0
    names = sorted([info.key[len(REMOTE_PREFIX):] async for info in remote.list(REMOTE_PREFIX)], reverse=True)
    removed = 0
    for name in names[max(1, keep):]:
        try:
            if await remote.delete(REMOTE_PREFIX + name):
                removed += 1
        except Exception as exc:  # noqa: BLE001
            logger.warning("backup prune failed remote code=%s", getattr(exc, "code", type(exc).__name__))
    return removed


async def create_backup(app, now: datetime) -> dict:
    if not supported(app):
        raise BackupUnsupported()
    settings = app.state.settings
    root = settings.resolved_backup_dir
    await asyncio.to_thread(root.mkdir, parents=True, exist_ok=True)
    stamp = now.astimezone(timezone.utc).replace(microsecond=0)
    path = root / f"app-{stamp:%Y%m%d-%H%M%S}.db"
    while path.exists():  # two backups in one second: the name is a timestamp, so move it on
        stamp += timedelta(seconds=1)
        path = root / f"app-{stamp:%Y%m%d-%H%M%S}.db"
    async with app.state.engine.connect() as conn:
        conn = await conn.execution_options(isolation_level="AUTOCOMMIT")
        await conn.exec_driver_sql("VACUUM INTO ?", (str(path),))
    blobs = app.state.storage
    remote = remote_of(blobs)
    if remote is not None:  # the local file is kept: an upload failure never fails the backup (plan L1 R13)
        try:
            await remote.put_file(REMOTE_PREFIX + path.name, path, content_type="application/x-sqlite3")
        except Exception as exc:  # noqa: BLE001
            logger.warning("backup upload failed code=%s", getattr(exc, "code", type(exc).__name__))
    prune(settings)
    try:
        await _prune_remote(blobs, settings.backup_keep)
    except Exception as exc:  # noqa: BLE001 - the new backup exists; a failed prune is retried next time
        logger.warning("backup prune failed remote code=%s", getattr(exc, "code", type(exc).__name__))
    return _out(path)


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _mac(secret: bytes, payload: str) -> str:
    return _b64(hmac.new(secret, payload.encode(), hashlib.sha256).digest())


def sign_download(secret: bytes, name: str, now: float, ttl: int = LINK_TTL) -> str:
    payload = f"{_check(name)}|{int(now + ttl)}"
    return f"{_b64(payload.encode())}.{_mac(secret, payload)}"


def verify_download(secret: bytes, token: str, now: float) -> str | None:
    try:
        body, mac = token.split(".", 1)
        payload = _unb64(body).decode()
        name, exp = payload.rsplit("|", 1)
        if not hmac.compare_digest(mac, _mac(secret, payload)) or now > int(exp) or not BACKUP_RE.fullmatch(name):
            return None
        return name
    except (ValueError, binascii.Error, UnicodeDecodeError):
        return None


# ---- daily job: automatic backup at BACKUP_HOUR_UTC and expired-row cleanup ----

async def run_daily(app, now: datetime, state: dict) -> None:
    """One step of the daily job (exposed for tests). `state` remembers what already ran today."""
    settings = app.state.settings
    today = now.date().isoformat()
    if state.get("purged") != today:
        state["purged"] = today
        try:
            async with app.state.sessionmaker() as session:
                counts = await housekeeping.purge_expired(session, now)
                await session.commit()
            logger.info("housekeeping purge_expired %s", " ".join(f"{k}={v}" for k, v in counts.items()))
        except Exception as exc:  # noqa: BLE001
            logger.warning("housekeeping purge_expired failed error=%s", type(exc).__name__)
    if settings.backup_hour_utc >= 0 and now.hour == settings.backup_hour_utc and state.get("backup") != today \
            and supported(app):
        state["backup"] = today
        try:
            out = await create_backup(app, now)
            logger.info("backup created bytes=%d", out["bytes"])
        except Exception as exc:  # noqa: BLE001
            logger.warning("backup failed error=%s", type(exc).__name__)


async def daily_loop(app, interval: float = 60.0) -> None:
    state: dict = {}
    while True:
        await run_daily(app, datetime.now(timezone.utc), state)
        await asyncio.sleep(interval)
