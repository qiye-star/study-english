import pytest

from tests.admin_helpers import ADMIN_ENABLED


@pytest.fixture
def settings_overrides(request):
    return getattr(request, "param", {**ADMIN_ENABLED, "admin_lockout_threshold": 3, "admin_lockout_minutes": 15})


async def test_lock_after_threshold_even_with_right_password(client):
    for _ in range(3):
        assert (await client.post("/api/admin/login", json={"username": "root", "password": "bad-password-1"})).status_code == 401
    r = await client.post("/api/admin/login", json={"username": "root", "password": "correct-horse-battery"})
    assert r.status_code == 429 and r.json() == {"error": "Too many attempts"}


async def test_unknown_usernames_are_counted_identically(client):
    for _ in range(3):
        await client.post("/api/admin/login", json={"username": "ghost", "password": "bad-password-1"})
    r = await client.post("/api/admin/login", json={"username": "ghost", "password": "bad-password-1"})
    assert r.status_code == 429


@pytest.mark.parametrize("settings_overrides", [{**ADMIN_ENABLED, "admin_ip_allowlist": "10.0.0.0/8"}], indirect=True)
async def test_ip_allowlist_hides_admin_entirely(client):
    assert (await client.post("/api/admin/login", json={"username": "root", "password": "x" * 12})).status_code == 404
    assert (await client.get("/admin")).status_code == 404


# ---- review M5: the TOTP login step is capped per session and per username, whatever the source IP --------------

import httpx  # noqa: E402

from app.admin.accounts import create_account  # noqa: E402
from app.admin import totp  # noqa: E402
from app.core.secretbox import SecretBox  # noqa: E402
from app.models import AdminAccount  # noqa: E402
from tests.admin_helpers import PASSWORD  # noqa: E402

MFA = {**ADMIN_ENABLED, "admin_lockout_threshold": 3, "admin_lockout_minutes": 15, "trust_proxy_headers": True}


def _mfa_settings():
    from cryptography.fernet import Fernet

    return {**MFA, "settings_encryption_key": Fernet.generate_key().decode()}


async def _bound_account(app) -> str:
    secret = totp.generate_secret()
    box = SecretBox(app.state.settings.settings_encryption_key)
    async with app.state.sessionmaker() as s:
        account = await create_account(s, username="ops", password=PASSWORD, role="operator", created_by="test")
        account.totp_enc = box.encrypt(secret)
        await s.commit()
    return secret


def _ip(n: int) -> dict:
    return {"X-Forwarded-For": f"198.51.100.{n}"}


async def _pending(app, n: int) -> tuple[httpx.AsyncClient, dict]:
    c = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
    r = await c.post("/api/admin/login", headers=_ip(n), json={"username": "ops", "password": PASSWORD})
    assert r.status_code == 200 and r.json()["mfa_required"] is True
    return c, {"X-Admin-CSRF": r.json()["csrf_token"]}


def _now_code(secret: str) -> str:
    import time

    return totp.code_at(secret, int(time.time() // 30))


def _wrong(secret: str) -> str:
    right = {totp.code_at(secret, int(__import__("time").time() // 30) + d) for d in (-1, 0, 1)}
    return next(c for c in ("000000", "111111", "222222", "333333") if c not in right)


@pytest.mark.parametrize("settings_overrides", [_mfa_settings()], indirect=True)
async def test_pending_session_is_revoked_after_five_wrong_codes_from_rotating_ips(app):
    secret = await _bound_account(app)
    c, h = await _pending(app, 1)
    try:
        for i in range(5):
            r = await c.post("/api/admin/login/totp", headers={**h, **_ip(10 + i)}, json={"code": _wrong(secret)})
            assert r.status_code == 401
        r = await c.post("/api/admin/login/totp", headers={**h, **_ip(20)}, json={"code": _now_code(secret)})
        assert r.status_code == 401 and r.json() == {"error": "Unauthorized"}  # log in with the password again
    finally:
        await c.aclose()


@pytest.mark.parametrize("settings_overrides", [_mfa_settings()], indirect=True)
async def test_mfa_step_locks_per_username_across_sessions_and_ips(app):
    secret = await _bound_account(app)
    n = 30
    for session_failures in (4, 2):  # 6 = 2 x threshold failures spread over sessions and IPs
        c, h = await _pending(app, n)
        try:
            for _ in range(session_failures):
                n += 1
                await c.post("/api/admin/login/totp", headers={**h, **_ip(n)}, json={"code": _wrong(secret)})
        finally:
            await c.aclose()
    c, h = await _pending(app, 99)
    try:
        r = await c.post("/api/admin/login/totp", headers={**h, **_ip(99)}, json={"code": _now_code(secret)})
        assert r.status_code == 429 and r.json() == {"error": "Too many attempts"}
    finally:
        await c.aclose()


@pytest.mark.parametrize("settings_overrides", [{**ADMIN_ENABLED, "trust_proxy_headers": True}], indirect=True)
async def test_client_ip_is_the_entry_the_trusted_proxy_appended(app, client):
    from starlette.requests import Request

    from app.core.deps import client_ip

    scope = {"type": "http", "app": app, "client": ("10.0.0.2", 1234),
             "headers": [(b"x-forwarded-for", b"6.6.6.6, 203.0.113.9")]}
    assert client_ip(Request(scope)) == "203.0.113.9"  # the left part is whatever the client sent


# ---- review m6: one TOTP code is accepted once, also by concurrent requests and by other workers ----------------

from app.core.db import Base  # noqa: E402
from app.main import create_app  # noqa: E402
from tests.conftest import make_settings  # noqa: E402


async def _file_app(url: str, **extra):
    app = create_app(make_settings(database_url=url, **{**ADMIN_ENABLED, **extra}))
    async with app.state.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return app


async def _close(*apps):
    for a in apps:
        await a.state.http.aclose()
        await a.state.engine.dispose()


async def test_concurrent_logins_cannot_both_use_one_totp_code(tmp_path):
    import asyncio

    app = await _file_app(f"sqlite+aiosqlite:///{(tmp_path / 'r.db').as_posix()}", **_mfa_settings())
    try:
        secret = await _bound_account(app)
        pending = [await _pending(app, n) for n in (1, 2, 3)]
        code = _now_code(secret)
        results = await asyncio.gather(*[c.post("/api/admin/login/totp", headers=h, json={"code": code})
                                         for c, h in pending])
        assert sorted(r.status_code for r in results) == [200, 401, 401]
        for c, _ in pending:
            await c.aclose()
    finally:
        await _close(app)


async def test_env_account_totp_code_is_single_use_across_workers(tmp_path):
    url = f"sqlite+aiosqlite:///{(tmp_path / 'w.db').as_posix()}"
    secret = totp.generate_secret()
    a = await _file_app(url, admin_totp_secret=secret)
    b = await _file_app(url, admin_totp_secret=secret)
    try:
        code = _now_code(secret)
        statuses = []
        for worker in (a, b):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=worker), base_url="http://test") as c:
                r = await c.post("/api/admin/login", json={"username": "root", "password": "correct-horse-battery"})
                r = await c.post("/api/admin/login/totp", headers={"X-Admin-CSRF": r.json()["csrf_token"]},
                                 json={"code": code})
                statuses.append(r.status_code)
        assert statuses == [200, 401]
    finally:
        await _close(a, b)
