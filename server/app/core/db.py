from pathlib import Path

from sqlalchemy import event
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import StaticPool


class Base(DeclarativeBase):
    pass


def insert_ignore(session, table):
    """`INSERT ... ON CONFLICT DO NOTHING` for the session's dialect (SQLite or Postgres). Unlike catching an
    IntegrityError it needs no rollback, so ORM objects the caller loaded in that session stay usable."""
    dialect = postgresql if session.get_bind().dialect.name == "postgresql" else sqlite
    return dialect.insert(table).on_conflict_do_nothing()


def ensure_sqlite_dir(url: str) -> None:
    parsed = make_url(url)
    if parsed.get_backend_name() == "sqlite" and parsed.database and parsed.database != ":memory:":
        Path(parsed.database).parent.mkdir(parents=True, exist_ok=True)


def _harden_aiosqlite_terminate() -> None:
    """Make SQLAlchemy's "terminate a cancelled connection" path unable to hang on SQLite.

    When a task is cancelled while a query runs, SQLAlchemy (2.1) calls `terminate()`: it starts a shielded
    `_terminate_graceful_close()` task and, because it was cancelled, immediately force-stops the aiosqlite worker
    thread (`stop()` queues a stop sentinel; the thread exits). The graceful task then starts *after* that and
    queues `Connection.close()` behind a sentinel nobody will ever read: its future never completes, and whoever
    awaits it (`AsyncSession.close()` in the cancelled request/WebSocket task, hence also TestClient's `__exit__`
    and a graceful server shutdown) waits forever. A connection that was already stopped has nothing left to close."""
    from sqlalchemy.dialects.sqlite import aiosqlite as dialect

    cls = getattr(dialect, "AsyncAdapt_aiosqlite_connection", None)
    original = getattr(cls, "_terminate_graceful_close", None)
    if original is None or getattr(original, "_stopped_guard", False):
        return

    async def _terminate_graceful_close(self) -> None:
        if not getattr(self._connection, "_running", True):  # `stop()` already ran: the worker thread is gone
            return
        await original(self)

    _terminate_graceful_close._stopped_guard = True
    cls._terminate_graceful_close = _terminate_graceful_close


_harden_aiosqlite_terminate()


def make_engine(url: str) -> AsyncEngine:
    if url.startswith("sqlite") and ":memory:" in url:
        return create_async_engine(
            url, poolclass=StaticPool, connect_args={"check_same_thread": False}
        )
    ensure_sqlite_dir(url)
    engine = create_async_engine(url, pool_pre_ping=True)
    if make_url(url).get_backend_name() == "sqlite":
        event.listen(engine.sync_engine, "connect", _sqlite_pragmas)
    return engine


def _sqlite_pragmas(dbapi_connection, _record) -> None:
    """WAL lets readers (e.g. the backup's VACUUM INTO) run beside writers instead of making commits wait for the
    exclusive lock and fail after the 5 s timeout (review correctness m7)."""
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=10000")
    finally:
        cursor.close()
