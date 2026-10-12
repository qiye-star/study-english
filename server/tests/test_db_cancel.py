"""Regression: cancelling a task in the middle of a SQLite query must never leave a close awaiting a dead worker thread.

It used to hang forever (SQLAlchemy 2.1 + aiosqlite 0.22 `terminate()` race, see `app.core.db`), which stalled
`tests/test_rooms_ws.py` in TestClient's `__exit__` in about two of three runs. Each wait here has a hard timeout
so a regression fails instead of hanging the run."""
import asyncio

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.core.db import make_engine

HARD_TIMEOUT = 10.0


@pytest.fixture
async def engine(tmp_path):
    engine = make_engine(f"sqlite+aiosqlite:///{(tmp_path / 'cancel.db').as_posix()}")
    yield engine
    await asyncio.wait_for(engine.dispose(), HARD_TIMEOUT)


async def test_graceful_close_after_force_stop_returns(engine):
    """The exact interleaving: terminate() force-stops the worker before the shielded graceful close first runs."""
    async with engine.connect() as conn:
        raw = await conn.get_raw_connection()
        adapter = raw.dbapi_connection  # SQLAlchemy's AsyncAdapt_aiosqlite_connection
        graceful = asyncio.create_task(adapter._terminate_graceful_close())
        adapter._terminate_force_close()  # queues the stop sentinel before `graceful` takes its first step
        await asyncio.wait_for(graceful, HARD_TIMEOUT)


async def test_cancelling_sessions_mid_query_never_hangs(engine):
    maker = async_sessionmaker(engine, expire_on_commit=False)

    async def work():
        async with maker() as session:
            for _ in range(200):
                await session.execute(text("select 1"))

    for delay in (0, 0, 0, 0.0005, 0.001, 0.002, 0.004, 0.008) * 3:
        task = asyncio.create_task(work())
        await asyncio.sleep(delay)
        task.cancel()
        await asyncio.wait_for(asyncio.gather(task, return_exceptions=True), HARD_TIMEOUT)
    async with maker() as session:  # the engine still serves queries afterwards
        assert (await asyncio.wait_for(session.execute(text("select 1")), HARD_TIMEOUT)).scalar() == 1
