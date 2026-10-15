"""CatalogJobs(plan SI Task 4):一次一个、kick 触发、失败 / 取消 / 恢复、系统计量。"""
import asyncio

import pytest

from app.core import config as config_module, metering
from app.library import catalog_jobs, paths
from app.models import CatalogItem
from tests.background import drain_background
from tests.library_helpers import SRT, FakeTools, enable, fake_media, library_settings, use_fakes
from tests.test_library_catalog_import import queued, row_of, staged_upload


@pytest.fixture
def settings_overrides(tmp_path):
    return library_settings(tmp_path)


async def kick_and_wait(app) -> None:
    app.state.catalog.kick()
    await drain_background(app)


async def test_installed_on_app_state(app):
    assert isinstance(app.state.catalog, catalog_jobs.CatalogJobs)


async def test_queued_items_run_one_after_another(app, monkeypatch):
    enable(monkeypatch)
    use_fakes(app)
    ids = []
    for _ in range(2):
        cid = await queued(app, status="queued")
        staged_upload(app, cid, fake_media(6000), SRT)
        ids.append(cid)
    await kick_and_wait(app)
    assert [(await row_of(app, cid)).status for cid in ids] == ["ready", "ready"]


async def test_nothing_runs_without_media_tools(app, monkeypatch):
    monkeypatch.setattr(config_module, "media_tools_present", lambda: False)  # ffmpeg "missing" (even if installed)
    cid = await queued(app, status="queued")
    await kick_and_wait(app)
    assert (await row_of(app, cid)).status == "queued"


async def test_failures_are_recorded_without_auto_retry(app, monkeypatch):
    enable(monkeypatch)
    use_fakes(app, FakeTools(fail={"probe": "corrupt"}))
    cid = await queued(app, status="queued")
    staged_upload(app, cid, fake_media(6000), SRT)
    await kick_and_wait(app)
    row = await row_of(app, cid)
    assert (row.status, row.error_kind) == ("failed", "corrupt")
    assert not paths.catalog_tmp_dir(app.state.library.deps.data_dir, cid).exists()  # useless staging dropped


async def test_a_crash_is_upstream_and_jobs_bind_no_user(app, monkeypatch):
    enable(monkeypatch)
    seen = []

    class Boom(FakeTools):
        async def probe(self, *a, **kw):
            seen.append((metering.current_user_id(), metering.current_feature()))
            raise RuntimeError("bug")

    use_fakes(app, Boom())
    metering.bind_user(99)
    cid = await queued(app, status="queued")
    staged_upload(app, cid, fake_media(6000), SRT)
    await kick_and_wait(app)
    assert (await row_of(app, cid)).error_kind == "upstream"
    assert seen == [(None, "cat_import")]
    metering.bind_user(None)


async def test_recover_requeues_processing_items_and_runs_them(app, monkeypatch):
    enable(monkeypatch)
    use_fakes(app)
    cid = await queued(app, status="processing")
    staged_upload(app, cid, fake_media(6000), SRT)
    assert await app.state.catalog.recover() == 1
    await drain_background(app)
    assert (await row_of(app, cid)).status == "ready"


async def test_recover_tolerates_an_unmigrated_schema(app, caplog):
    from sqlalchemy import text
    async with app.state.engine.begin() as conn:  # a database the catalog migration has not reached yet
        await conn.execute(text("DROP TABLE catalog_segments"))
        await conn.execute(text("DROP TABLE catalog_items"))
    with caplog.at_level("WARNING"):
        assert await app.state.catalog.recover() == 0  # startup must continue (like the library worker's recovery)
    text_ = " ".join(r.getMessage() for r in caplog.records)
    assert "catalog recovery failed error=OperationalError" in text_
    assert "SELECT" not in text_ and "UPDATE" not in text_ and "catalog_items" not in text_


async def test_cancel_stops_a_running_job(app, monkeypatch):
    enable(monkeypatch)
    gate, reached = asyncio.Event(), asyncio.Event()

    class Slow(FakeTools):
        async def probe(self, *a, **kw):
            reached.set()
            await gate.wait()
            return await super().probe(*a, **kw)

    use_fakes(app, Slow())
    cid = await queued(app, status="queued")
    staged_upload(app, cid, fake_media(6000), SRT)
    app.state.catalog.kick()
    await asyncio.wait_for(reached.wait(), 5)  # never cancel a task in the middle of a SQLite query
    async with app.state.sessionmaker() as s:
        row = await s.get(CatalogItem, cid)
        row.status = "canceled"
        await s.commit()
    await app.state.catalog.cancel(cid)
    await drain_background(app)
    assert (await row_of(app, cid)).status == "canceled"
