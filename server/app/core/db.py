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
