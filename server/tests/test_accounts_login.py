"""Log in with a username or an email in the same `username` field (plan S18; spec 4.3, INDEX X3, R-F1)."""
import logging

import pytest

from app.models import User, utcnow
from tests.accounts_helpers import PEPPER, bind, enable_email
from tests.test_admin_api import register

EMAIL = "new.user@example.com"
PASSWORD = "password123"
INVALID = {"error": "Invalid username or password"}


@pytest.fixture
async def account(app, client):
    enable_email(app)
    uid, _ = await register(client, "emailer")
    await bind(app, uid, EMAIL)
    return uid


@pytest.fixture
def verify_calls(monkeypatch):
    """Count the password hash verifications of the login route (the equal-time guarantee)."""
    import app.routers.sessions as sessions

    real = sessions.verify_password
    calls: list[int] = []

    def counting(*args, **kwargs):
        calls.append(1)
        return real(*args, **kwargs)

    monkeypatch.setattr(sessions, "verify_password", counting)
    return calls


async def _login(client, username, password=PASSWORD):
    return await client.post("/api/sessions", json={"provider": "password", "username": username, "password": password})


@pytest.mark.parametrize("typed", [EMAIL, "  New.User@EXAMPLE.com ", "new.user+promo@example.com", "NEW.USER@example.com"])
async def test_login_by_email_in_any_spelling(client, account, typed):
    r = await _login(client, typed)
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "emailer" and r.json()["access_token"]
    assert r.headers.get("cache-control") == "no-store"


async def test_login_by_username_still_works(client, account):
    assert (await _login(client, "emailer")).status_code == 200
    assert (await _login(client, " EMAILER ")).status_code == 200


async def test_every_failure_is_the_same_401_and_one_hash_check(client, account, verify_calls):
    answers = []
    for typed, password in ((EMAIL, "wrong-password"), ("nobody@example.com", PASSWORD), ("a@b", PASSWORD),
                            ("x@" + "d" * 200, PASSWORD), ("emailer", "wrong-password"), ("ghost", PASSWORD)):
        verify_calls.clear()
        r = await _login(client, typed, password)
        assert r.status_code == 401 and r.json() == INVALID, typed
        assert verify_calls == [1], typed  # a registered, an unknown and a malformed address all cost one hash
        answers.append(r.content)
    assert len(set(answers)) == 1


async def test_a_correct_login_costs_one_hash_as_well(client, account, verify_calls):
    assert (await _login(client, EMAIL)).status_code == 200
    assert verify_calls == [1]


async def test_disabled_user_is_403_only_after_the_password_check(app, client, account):
    async with app.state.sessionmaker() as s:
        (await s.get(User, account)).disabled_at = utcnow()
        await s.commit()
    assert (await _login(client, EMAIL, "wrong-password")).status_code == 401
    r = await _login(client, EMAIL)
    assert r.status_code == 403 and r.json() == {"error": "Account disabled"}


async def test_email_login_when_email_is_not_configured_is_just_a_401(app, client, account):
    app.state.settings = app.state.settings.model_copy(update={"identity_pepper": ""})
    r = await _login(client, EMAIL)
    assert r.status_code == 401 and r.json() == INVALID


async def test_an_old_email_stops_logging_in_after_a_change(app, client, account):
    await bind(app, account, "second@example.com")
    assert (await _login(client, EMAIL)).status_code == 401
    assert (await _login(client, "second@example.com")).status_code == 200


async def test_username_field_allows_an_email_sized_value(client, account):
    assert (await _login(client, "u" * 64 + "@" + "d" * 60 + ".com")).status_code == 401  # longer than 64: no 422
    assert (await _login(client, "u" * 250 + "@a")).status_code == 401
    assert (await _login(client, "u" * 255)).status_code == 422


async def test_login_logs_nothing_sensitive(client, account, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    ok = await _login(client, EMAIL)
    await _login(client, "other.person@example.com", "another-secret-pw")
    await _login(client, EMAIL, "wrong-secret-pw")
    for secret in (EMAIL, "other.person", "another-secret-pw", "wrong-secret-pw", PASSWORD, ok.json()["access_token"],
                   PEPPER):
        assert secret not in caplog.text
