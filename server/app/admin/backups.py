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
    prune(settings)
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
