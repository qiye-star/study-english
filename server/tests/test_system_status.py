import logging

import pytest
from sqlalchemy import select

from app.models import AdminAudit
from tests.admin_helpers import ADMIN_ENABLED, assert_no_secrets, login_as


@pytest.fixture
def settings_overrides(tmp_path):
    return {**ADMIN_ENABLED, "data_dir": str(tmp_path)}


async def test_status_shape_and_roles(app, client):
    await login_as(app, client, "viewer")
    r = await client.get("/api/admin/system")
    body = r.json()
    assert r.status_code == 200
    assert {"version", "uptime_seconds", "db", "disk", "settings", "meter", "tasks", "findings"} <= set(body)
    assert body["workers"] == 1 and body["db"]["backend"] == "sqlite"
    assert body["db"]["alembic_head"] and body["db"]["alembic_current"] is None  # tests use create_all
    assert body["tasks"] == {"watcher": None, "metering": None, "rooms_sweeper": None, "backups": None}
    assert body["disk"]["total"] > 0 and body["recordings_bytes"] == 0
    assert_no_secrets(body, app.state.settings)
    assert (await client.get("/api/admin/logs")).status_code == 403
    client.cookies.clear()
    await login_as(app, client, "operator")
    logging.getLogger("app.ops_test").warning("ticket=abc123 llm-secret visible?")
    r = await client.get("/api/admin/logs", params={"level": "WARNING", "logger": "app.ops_test"})
    assert r.status_code == 200
    messages = [e["message"] for e in r.json()["entries"]]
    assert messages == ["ticket=[redacted] [redacted] visible?"]
    after = r.json()["entries"][-1]["id"]
    assert (await client.get("/api/admin/logs", params={"after_id": after, "logger": "app.ops_test"})).json()["entries"] == []
    assert (await client.get("/api/admin/logs", params={"level": "LOUD"})).status_code == 422
    async with app.state.sessionmaker() as s:
        views = (await s.scalars(select(AdminAudit).where(AdminAudit.action == "logs.view"))).all()
    assert len(views) == 1  # once per session


async def test_dead_background_task_is_an_error_finding(app, client):
    import asyncio

    async def boom():
        raise RuntimeError("x")

    task = asyncio.create_task(boom())
    await asyncio.gather(task, return_exceptions=True)
    app.state.background_tasks["metering"] = task
    await login_as(app, client, "viewer")
    body = (await client.get("/api/admin/system")).json()
    assert body["tasks"]["metering"] is False and body["findings"]["error"] >= 1
