from pathlib import Path

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
    return create_async_engine(url, pool_pre_ping=True)
