"""Adaptive captcha on login after repeated failures (plan S12; spec R-C1, R-C6, R-C8, R-C21; INDEX X31).

The failure counters take their limits at startup. `enable_captcha` only swaps `app.state.settings`, so `_on` also
reconfigures `app.state.login_failures` the same way the settings hub listener does in production. X-Forwarded-For
is honoured (`trust_proxy_headers`) so one test can send failures from several addresses.
"""
import base64
import json
import logging
from datetime import datetime, timezone

from sqlalchemy import update

from app.models import User
from tests.captcha_helpers import SECRET, enable_captcha, header_for
from tests.test_admin_api import register

PASSWORD = "password123"
WRONG = "not-the-password"
REQUIRED = {"error": "captcha_required"}
INVALID = {"error": "captcha_invalid"}
UNKNOWN = {"error": "Invalid username or password"}


def _on(app, mode="adaptive", failures=5):
    enable_captcha(app, mode, captcha_login_failures=failures, trust_proxy_headers=True)
    app.state.login_failures.reconfigure(failures, 15 * 60)


async def _login(client, name, password=PASSWORD, ip=None, headers=None):
    h = dict(headers or {})
    if ip is not None:
        h["X-Forwarded-For"] = ip
    return await client.post("/api/sessions", json={"provider": "password", "username": name,
                                                    "password": password}, headers=h)


async def test_login_free_until_flagged(app, client):
    await register(client, "alice")
    _on(app, failures=3)
    for _ in range(3):
        r = await _login(client, "alice", WRONG)
        assert r.status_code == 401 and r.json() == UNKNOWN
    r = await _login(client, "alice")
    assert r.status_code == 428 and r.json() == REQUIRED
    r = await _login(client, "alice", headers=await header_for(client))
    assert r.status_code == 200


async def test_unknown_names_flag_the_same_way(app, client):
    await register(client, "alice")
    _on(app, failures=3)
    for name in ("alice", "ghost-user"):  # the same flag for an existing and a made-up name (anti-enumeration)
        for i in range(3):
            r = await _login(client, name, WRONG, ip=f"10.0.1.{i + 1}")
            assert r.status_code == 401 and r.json() == UNKNOWN
        r = await _login(client, name, WRONG, ip="10.0.1.9")
        assert r.status_code == 428 and r.json() == REQUIRED, name


async def test_name_flag_follows_the_name_across_ips(app, client):
    await register(client, "alice")
    await register(client, "bobby")
    _on(app, failures=3)
    for i in range(3):
        assert (await _login(client, "alice", WRONG, ip=f"10.1.0.{i + 1}")).status_code == 401
    assert (await _login(client, "alice", ip="10.1.0.9")).status_code == 428
    assert (await _login(client, "bobby", ip="10.1.0.9")).status_code == 200


async def test_email_variants_share_a_key(app, client):
    _on(app, failures=3)
    for i, name in enumerate(["A@Example.com ", "a@example.com", " A@EXAMPLE.COM"]):
        assert (await _login(client, name, WRONG, ip=f"10.2.0.{i + 1}")).status_code == 401
    assert (await _login(client, "a@example.com", ip="10.2.0.9")).status_code == 428
    assert (await _login(client, "b@example.com", WRONG, ip="10.2.0.10")).status_code == 401


async def test_always_mode_requires_captcha_for_every_login(app, client):
    await register(client, "alice")
    _on(app, mode="always")
    r = await _login(client, "alice")
    assert r.status_code == 428 and r.json() == REQUIRED
    assert (await _login(client, "alice", headers=await header_for(client))).status_code == 200


async def test_off_mode_never_flags(app, client):
    await register(client, "alice")
    _on(app, mode="off", failures=3)
    for _ in range(10):
        assert (await _login(client, "alice", WRONG)).status_code == 401
    assert (await _login(client, "alice")).status_code == 200


async def test_captcha_failure_is_not_counted(app, client):
    await register(client, "alice")
    _on(app, failures=3)
    for i in range(3):
        assert (await _login(client, "alice", WRONG, ip=f"10.3.0.{i + 1}")).status_code == 401

    def counted() -> int:
        return sum(len(hits) for hits in app.state.login_failures._ip._hits.values())

    before = counted()
    for _ in range(5):
        r = await _login(client, "alice", ip="10.3.0.1", headers={"X-Captcha": "junk-payload"})
        assert r.status_code == 428 and r.json() == INVALID
    assert counted() == before


async def test_disabled_account_is_not_counted(app, client):
    await register(client, "alice")
    async with app.state.sessionmaker() as s:
        await s.execute(update(User).where(User.username == "alice")
                        .values(disabled_at=datetime.now(timezone.utc)))
        await s.commit()
    _on(app, failures=3)
    for i in range(5):
        r = await _login(client, "alice", ip=f"10.5.0.{i + 1}")
        assert r.status_code == 403 and r.json() == {"error": "Account disabled"}  # never 428: not a failure


async def test_desktop_login_shape_unchanged(app, client):
    await register(client, "alice")
    off = await _login(client, "alice")
    assert off.status_code == 200
    _on(app)
    on = await _login(client, "alice")
    assert on.status_code == 200 and set(on.json()) == set(off.json())
    assert on.json()["name"] == "alice" and on.json()["access_token"]


async def test_login_logs_no_payload_or_name(app, client, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    await register(client, "zebra_login_name")
    _on(app, failures=2)
    await _login(client, "zebra_login_name", WRONG, ip="10.4.0.1")
    await _login(client, "zebra_login_name", WRONG, ip="10.4.0.2")
    captcha = await header_for(client)
    payload = captcha["X-Captcha"]
    decoded = json.loads(base64.b64decode(payload))
    signature = decoded["challenge"]["signature"]
    nonce = decoded["challenge"]["parameters"]["nonce"]
    assert (await _login(client, "zebra_login_name", headers=captcha)).status_code == 200
    assert (await _login(client, "zebra_login_name", WRONG, ip="10.4.0.3",
                         headers={"X-Captcha": "junk-payload"})).status_code == 428
    for secret in (payload, signature, nonce, SECRET, PASSWORD, WRONG, "zebra_login_name"):
        assert secret not in caplog.text
