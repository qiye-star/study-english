"""更新日志的隐私与路由表(计划 2026-10-14-changelog S5;spec §3):日志、错误体、审计、命令输出与 URL 里都没有条目文字。"""
import json
import logging
from pathlib import Path

import pytest
from sqlalchemy import select

from app.admin import changelog_import
from app.main import create_app
from app.models import AdminAudit
from tests.admin_helpers import ADMIN_ENABLED, login_as
from tests.conftest import make_settings
from tests.test_admin_routes_guarded import api_routes

MARK = "ZQMARKER-PRIVACY"
URL = "/api/admin/changelog"
APP_DIR = Path(__file__).resolve().parents[1] / "app"
MODULES = ("admin/changelog.py", "admin/changelog_import.py", "routers/changelog.py", "routers/admin_changelog.py")
PUBLIC_ROUTES = {("GET", "/api/changelog"), ("POST", "/api/changelog/seen")}
ADMIN_ROUTES = {("GET", "/api/admin/changelog"), ("POST", "/api/admin/changelog"),
                ("PATCH", "/api/admin/changelog/{entry_id}"), ("POST", "/api/admin/changelog/{entry_id}/publish"),
                ("POST", "/api/admin/changelog/{entry_id}/unpublish"), ("DELETE", "/api/admin/changelog/{entry_id}")}


@pytest.fixture
def settings_overrides():
    return {**ADMIN_ENABLED}


def test_the_route_table_is_pinned_and_urls_carry_only_ids_and_paging():
    """A new changelog route must be added here on purpose (and keep text out of its URL)."""
    found = {}
    for path, route in api_routes(create_app(make_settings()).routes):
        if path.startswith(("/api/changelog", "/api/admin/changelog")):
            for method in route.methods - {"HEAD"}:
                found[(method, path)] = route
    assert set(found) == PUBLIC_ROUTES | ADMIN_ROUTES
    for route in found.values():
        assert {p.name for p in route.dependant.path_params} <= {"entry_id"}
        assert {q.name for q in route.dependant.query_params} <= {"cursor", "limit"}


def test_the_changelog_modules_have_no_logging_or_printing_of_their_own():
    for rel in MODULES:
        source = (APP_DIR / rel).read_text(encoding="utf-8")
        assert "logging" not in source and "logger" not in source, rel
        if rel != "admin/changelog_import.py":  # the command prints counts and file names only
            assert "print(" not in source, rel


def write(directory: Path, name: str, entries) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    (directory / name).write_text(json.dumps(entries, ensure_ascii=False), encoding="utf-8")


async def test_no_entry_text_reaches_logs_errors_audit_or_command_output(app, client, auth_headers, caplog, monkeypatch,
                                                                         tmp_path, capsys):
    # scoped to logger "app" like the other privacy tests: aiosqlite's own DEBUG records print SQL parameters
    # (a site-wide fact at LOG_LEVEL=DEBUG; the default is INFO), which is not this feature's logging
    caplog.set_level(logging.DEBUG, logger="app")
    monkeypatch.setattr(changelog_import, "_sessionmaker", lambda: app.state.sessionmaker)
    admin = await login_as(app, client, "operator")
    good = {"entry_date": "2026-10-14", "version": None, "title_zh": f"{MARK} 标题", "title_en": f"{MARK} title",
            "items": [{"tag": "new", "zh": f"{MARK} 中文", "en": f"{MARK} english"}]}
    created = await client.post(URL, headers=admin, json=good)
    assert created.status_code == 201
    eid = created.json()["id"]
    too_long = {**good, "items": [{"tag": "new", "zh": MARK * 40, "en": ""}]}
    for call in (client.post(URL, headers=admin, json=too_long), client.patch(f"{URL}/{eid}", headers=admin, json=too_long)):
        r = await call
        assert r.status_code == 422 and MARK not in r.text
    assert (await client.patch(f"{URL}/{eid}", headers=admin, json={"title_en": f"{MARK} edited"})).status_code == 200
    await client.post(f"{URL}/{eid}/publish", headers=admin)
    served = await client.get("/api/changelog", headers=auth_headers)
    assert MARK in served.text  # the published content itself is served ...
    await client.post("/api/changelog/seen", headers=auth_headers, json={"upto_id": eid})
    await client.get("/api/changelog", headers=auth_headers, params={"cursor": "2026-10-14.1", "limit": 5})
    await client.get("/api/changelog", headers=auth_headers, params={"cursor": "bad"})
    await client.post(f"{URL}/{eid}/unpublish", headers=admin)
    await client.post(f"{URL}/{eid}/publish", headers=admin)
    await client.delete(f"{URL}/{eid}", headers=admin)
    write(tmp_path / "ok", "a.json", [{**good, "entry_date": "2026-10-15", "title_zh": f"{MARK} 另一条"}])
    write(tmp_path / "bad", "a.json", [{**good, "items": [{"tag": "new", "zh": MARK * 40, "en": ""}]}])
    assert await changelog_import.run(["--dir", str(tmp_path / "ok")]) == 0
    assert await changelog_import.run(["--dir", str(tmp_path / "ok")]) == 0
    assert await changelog_import.run(["--dir", str(tmp_path / "bad")]) == 2
    captured = capsys.readouterr()
    assert MARK not in captured.out + captured.err  # ... but never logged, audited or printed
    assert MARK not in caplog.text
    async with app.state.sessionmaker() as s:
        rows = (await s.scalars(select(AdminAudit).where(AdminAudit.action.like("changelog.%")))).all()
    assert len(rows) >= 7
    dumped = json.dumps([[a.action, a.target_type, a.target_id, a.summary, a.before, a.after, a.reason] for a in rows], default=str)
    assert MARK not in dumped
