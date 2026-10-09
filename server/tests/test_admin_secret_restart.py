"""B1 (review): with ADMIN_SESSION_SECRET empty the CSRF/fingerprint secret must survive a restart.

These tests deliberately do NOT pin ADMIN_SESSION_SECRET: a restart = a second app on the same database file.
"""
import httpx
import pytest

from app.core.db import Base
from app.main import create_app
from tests.admin_helpers import ADMIN_ENABLED
from tests.conftest import make_settings

NO_SECRET = {k: v for k, v in ADMIN_ENABLED.items() if k != "admin_session_secret"}
LOGIN = {"username": "root", "password": "correct-horse-battery"}


@pytest.fixture
def db_url(tmp_path):
    return f"sqlite+aiosqlite:///{(tmp_path / 'restart.db').as_posix()}"


async def _boot(url: str, *, create: bool = False, **extra):
    app = create_app(make_settings(database_url=url, **{**NO_SECRET, **extra}))
    if create:
        async with app.state.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    return app


async def _close(app) -> None:
    await app.state.http.aclose()
    await app.state.engine.dispose()


def _client(app, cookies=None) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", cookies=cookies)


async def test_admin_writes_keep_working_after_restart_without_session_secret(db_url):
    first = await _boot(db_url, create=True)
    async with _client(first) as c:
        assert (await c.post("/api/admin/login", json=LOGIN)).status_code == 200
        cookies = dict(c.cookies)
        csrf = (await c.get("/api/admin/session")).json()["csrf_token"]
        r = await c.patch("/api/admin/settings", headers={"X-Admin-CSRF": csrf},
                          json={"changes": {"max_practice_items": 321}})
        assert r.status_code == 200, r.text
    await _close(first)

    second = await _boot(db_url)  # restart: new process, same DB, still no ADMIN_SESSION_SECRET
    try:
        async with _client(second, cookies) as c:
            session = await c.get("/api/admin/session")
            assert session.status_code == 200
            csrf = session.json()["csrf_token"]
            listed = (await c.get("/api/admin/settings")).json()
            item = next(i for i in listed["items"] if i["key"] == "max_practice_items")
            assert item["drift"] is False  # env fingerprint is stable across restarts too
            r = await c.patch("/api/admin/settings", headers={"X-Admin-CSRF": csrf},
                              json={"changes": {"max_practice_items": 322}})
            assert r.status_code == 200, r.text
            assert (await c.post("/api/admin/logout", headers={"X-Admin-CSRF": csrf})).status_code == 204
    finally:
        await _close(second)


async def test_changed_session_secret_signs_everyone_out_instead_of_failing_csrf(db_url):
    first = await _boot(db_url, create=True)
    async with _client(first) as c:
        assert (await c.post("/api/admin/login", json=LOGIN)).status_code == 200
        cookies = dict(c.cookies)
    await _close(first)

    second = await _boot(db_url, admin_session_secret="a-new-operator-chosen-secret")
    try:
        async with _client(second, cookies) as c:
            assert (await c.get("/api/admin/session")).status_code == 401  # must log in again, not a stuck UI
            assert (await c.post("/api/admin/login", json=LOGIN)).status_code == 200
            csrf = (await c.get("/api/admin/session")).json()["csrf_token"]
            assert (await c.post("/api/admin/logout", headers={"X-Admin-CSRF": csrf})).status_code == 204
    finally:
        await _close(second)


async def test_generated_secret_is_shared_by_workers_and_never_returned(db_url):
    a = await _boot(db_url, create=True)
    b = await _boot(db_url)  # a second worker on the same DB
    try:
        async with _client(a) as ca:
            assert (await ca.post("/api/admin/login", json=LOGIN)).status_code == 200
            cookies = dict(ca.cookies)
            body = (await ca.get("/api/admin/session")).text
        async with _client(b, cookies) as cb:
            csrf = (await cb.get("/api/admin/session")).json()["csrf_token"]
            assert (await cb.post("/api/admin/logout", headers={"X-Admin-CSRF": csrf})).status_code == 204
        assert a.state.admin_secret == b.state.admin_secret
        assert a.state.admin_secret.decode() not in body
    finally:
        await _close(a)
        await _close(b)
