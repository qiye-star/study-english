import sqlite3
from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.admin import backups
from app.models import AdminAudit
from tests.admin_helpers import ADMIN_ENABLED, PASSWORD, login_as


@pytest.fixture
def settings_overrides(tmp_path):
    db = tmp_path / "app.db"
    return {**ADMIN_ENABLED, "database_url": f"sqlite+aiosqlite:///{db.as_posix()}", "data_dir": str(tmp_path),
            "backup_keep": 2}


async def test_backup_create_list_download_prune(app, client):
    h = await login_as(app, client, "superadmin")
    await client.post("/api/admin/step-up", headers=h, json={"password": PASSWORD})
    names = []
    for _ in range(3):
        r = await client.post("/api/admin/backups", headers=h)
        assert r.status_code == 201
        names.append(r.json()["name"])
    assert len(set(names)) == 3
    body = (await client.get("/api/admin/backups")).json()
    listed = [b["name"] for b in body["backups"]]
    assert body["supported"] is True and len(listed) == 2 and names[0] not in listed  # pruned to BACKUP_KEEP
    path = app.state.settings.resolved_backup_dir / listed[0]
    con = sqlite3.connect(path)
    try:
        assert "admin_accounts" in {r[0] for r in con.execute("select name from sqlite_master")}
    finally:
        con.close()
    link = (await client.post(f"/api/admin/backups/{listed[0]}/link", headers=h)).json()["url"]
    r = await client.get(link)
    assert r.status_code == 200 and r.headers["content-disposition"].startswith("attachment")
    assert r.headers["cache-control"] == "no-store" and r.content == path.read_bytes()
    assert (await client.get(link)).status_code == 404  # one-time link
    assert (await client.get(link.replace(link.rsplit("/", 1)[1], "forged"))).status_code == 404
    for bad in ("app.db", "app-20261009-090000.db"):  # invalid name, missing file
        assert (await client.post(f"/api/admin/backups/{bad}/link", headers=h)).status_code == 404
    assert (await client.delete(f"/api/admin/backups/{listed[1]}", headers=h)).status_code == 204
    assert [b["name"] for b in (await client.get("/api/admin/backups")).json()["backups"]] == [listed[0]]
    async with app.state.sessionmaker() as s:
        actions = [a.action for a in (await s.scalars(select(AdminAudit))).all()]
    assert actions.count("backup.create") == 3 and "backup.download" in actions and "backup.delete" in actions


async def test_links_are_bound_to_the_session_and_need_step_up(app, client):
    h = await login_as(app, client, "superadmin")
    await client.post("/api/admin/backups", headers=h)
    name = (await client.get("/api/admin/backups")).json()["backups"][0]["name"]
    assert (await client.post(f"/api/admin/backups/{name}/link", headers=h)).json() == {"error": "Step-up required"}
    await client.post("/api/admin/step-up", headers=h, json={"password": PASSWORD})
    link = (await client.post(f"/api/admin/backups/{name}/link", headers=h)).json()["url"]
    client.cookies.clear()
    await login_as(app, client, "superadmin", username="other1")
    assert (await client.get(link)).status_code == 404
    client.cookies.clear()
    await login_as(app, client, "operator")
    assert (await client.get("/api/admin/backups")).status_code == 403


async def test_daily_job_backs_up_once_at_the_configured_hour(app):
    app.state.settings = app.state.settings.model_copy(update={"backup_hour_utc": 3})
    state: dict = {}
    await backups.run_daily(app, datetime(2026, 10, 9, 2, 59, tzinfo=timezone.utc), state)
    assert backups.list_backups(app.state.settings) == [] and state["purged"] == "2026-10-09"
    await backups.run_daily(app, datetime(2026, 10, 9, 3, 0, tzinfo=timezone.utc), state)
    await backups.run_daily(app, datetime(2026, 10, 9, 3, 30, tzinfo=timezone.utc), state)
    assert [b["name"] for b in backups.list_backups(app.state.settings)] == ["app-20261009-030000.db"]


def test_download_tokens_expire_and_names_are_validated():
    token = backups.sign_download(b"k", "app-20261009-090000.db", now=1000.0)
    assert backups.verify_download(b"k", token, now=1030.0) == "app-20261009-090000.db"
    assert backups.verify_download(b"k", token, now=1061.0) is None
    assert backups.verify_download(b"other", token, now=1030.0) is None
    assert backups.verify_download(b"k", "garbage", now=1030.0) is None
    with pytest.raises(ValueError):
        backups.sign_download(b"k", "../app.db", now=1000.0)


async def test_postgres_is_refused_with_a_pg_dump_hint(app, client, monkeypatch):
    monkeypatch.setattr(backups, "supported", lambda app_: False)
    h = await login_as(app, client, "superadmin")
    r = await client.post("/api/admin/backups", headers=h)
    assert r.status_code == 409 and r.json()["error"] == "Use pg_dump" and "pg_dump" in r.json()["details"]["hint"]
    body = (await client.get("/api/admin/backups")).json()
    assert body["supported"] is False and body["backups"] == [] and "pg_dump" in body["hint"]
