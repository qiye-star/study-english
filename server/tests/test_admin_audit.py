from sqlalchemy import update

from app.admin.audit import CLI_ACTOR, GENESIS, Actor, listing, record, redact_setting, verify
from app.models import AdminAudit

ROOT = Actor("root", "superadmin", "s1", "203.0.113.5")


async def test_records_chain_and_verify(app):
    async with app.state.sessionmaker() as s:
        a = await record(s, ROOT, "settings.update", target_type="setting", target_id="rate_limit_per_minute",
                         before={"rate_limit_per_minute": 10}, after={"rate_limit_per_minute": 20}, reason="spike")
        b = await record(s, CLI_ACTOR, "auth.unlock", target_type="admin", target_id="ops")
        await s.commit()
        assert a.prev_hash == GENESIS and b.prev_hash == a.hash and len(b.hash) == 64
        assert await verify(s) == (True, None)
        await s.execute(update(AdminAudit).where(AdminAudit.id == a.id).values(summary="tampered"))
        await s.commit()
        assert await verify(s) == (False, a.id)


async def test_listing_filters_and_paginates(app):
    async with app.state.sessionmaker() as s:
        for i in range(3):
            await record(s, ROOT, "room.close", target_type="room", target_id=f"r{i}")
        await record(s, Actor("ops", "operator", "s2", "198.51.100.1"), "user.disable", target_type="user", target_id=1)
        await s.commit()
        page = await listing(s, action="room.close", limit=2)
        assert [r["target_id"] for r in page["items"]] == ["r2", "r1"] and page["next_before_id"]
        page2 = await listing(s, action="room.close", before_id=page["next_before_id"], limit=2)
        assert [r["target_id"] for r in page2["items"]] == ["r0"] and page2["next_before_id"] is None
        assert [r["actor"] for r in (await listing(s, actor="ops"))["items"]] == ["ops"]


def test_redact_setting_masks_secrets_only():
    assert redact_setting("upstream_llm_key", "sk-live", "a1b2c3d4") == {"set": True, "fp": "a1b2c3d4"}
    assert redact_setting("upstream_llm_key", "", "") == {"set": False, "fp": ""}
    assert redact_setting("rate_limit_per_minute", 20, "") == 20


async def test_summary_and_reason_are_truncated(app):
    async with app.state.sessionmaker() as s:
        row = await record(s, ROOT, "x.y", summary="s" * 500, reason="r" * 500)
        assert len(row.summary) == 200 and len(row.reason) == 200


# ---- review: concurrent writers must not fork the chain (security M1 / correctness m5) ------------------------------

import asyncio  # noqa: E402

import httpx  # noqa: E402
import pytest  # noqa: E402
from sqlalchemy import delete  # noqa: E402

from app.core.db import Base  # noqa: E402
from app.main import create_app  # noqa: E402
from tests.admin_helpers import ADMIN_ENABLED  # noqa: E402
from tests.conftest import make_settings  # noqa: E402


@pytest.fixture
async def file_app(tmp_path):
    application = create_app(make_settings(database_url=f"sqlite+aiosqlite:///{(tmp_path / 'a.db').as_posix()}",
                                           **ADMIN_ENABLED))
    async with application.state.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield application
    await application.state.http.aclose()
    await application.state.engine.dispose()


async def test_second_writer_waits_for_the_first_commit_and_chains_after_it(file_app):
    async with file_app.state.sessionmaker() as a, file_app.state.sessionmaker() as b:
        first = await record(a, ROOT, "room.close", target_type="room", target_id="r1")

        async def other():
            row = await record(b, CLI_ACTOR, "auth.unlock", target_type="admin", target_id="ops")
            await b.commit()
            return row

        task = asyncio.create_task(other())
        await asyncio.sleep(0.3)
        assert not task.done()  # serialised behind the uncommitted first row
        await a.commit()
        second = await task
        assert second.prev_hash == first.hash
    async with file_app.state.sessionmaker() as s:
        assert await verify(s) == (True, None)


async def test_parallel_bad_logins_keep_the_chain_intact(file_app):
    """The exploit from the review: two unauthenticated failed logins in parallel used to fork the chain."""
    transport = httpx.ASGITransport(app=file_app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        bad = {"username": "root", "password": "wrong-password-xx"}
        results = await asyncio.gather(*[c.post("/api/admin/login", json=bad) for _ in range(12)])  # crosses the lockout
    assert {r.status_code for r in results} <= {401, 429}
    async with file_app.state.sessionmaker() as s:
        assert await verify(s) == (True, None)


async def test_verify_detects_deleted_head_rows_unless_a_purge_anchor_covers_them(app):
    """Review m7: deleting the oldest rows straight in the DB must not verify as OK."""
    from app.admin import housekeeping

    async with app.state.sessionmaker() as s:
        rows = [await record(s, ROOT, "room.close", target_type="room", target_id=f"r{i}") for i in range(4)]
        await s.commit()
        await s.execute(delete(AdminAudit).where(AdminAudit.id <= rows[1].id))
        await s.commit()
        assert await verify(s) == (False, rows[2].id)
        # a real purge records an anchor for the first kept row: the chain verifies again
        await housekeeping.purge_audit(s, ROOT, 400, retention_days=180)
        await s.commit()
        assert await verify(s) == (True, None)
