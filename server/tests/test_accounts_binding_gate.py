"""Forced email binding and the /api/me fields (plan S21; INDEX X3, X12, X13, X33; R-F10)."""
import inspect
import logging
from datetime import datetime, timedelta, timezone

import pytest

from app.core import deps
from app.core.account_policy import binding_state
from app.core.deps import current_user, current_user_unbound, limited_user
from app.models import User, utcnow
from tests.accounts_helpers import bind, enable_email
from tests.conftest import make_settings
from tests.test_admin_api import register
from tests.test_admin_routes_guarded import api_routes

NOW = datetime(2026, 10, 20, 12, 0, tzinfo=timezone.utc)
PAST = "2026-10-01T00:00:00+08:00"
FUTURE = "2026-12-01T00:00:00+08:00"
BLOCKED = {"error": "email_binding_required"}
MAIL = "gate.user@example.com"


# ---- the pure decision (X33) ----

def test_off_is_none_whatever_the_deadline():
    assert binding_state(make_settings(email_binding_required=False, email_binding_deadline=PAST), NOW) == "none"


def test_required_with_a_future_deadline_is_pending():
    assert binding_state(make_settings(email_binding_required=True, email_binding_deadline=FUTURE), NOW) == "pending"


def test_required_with_a_past_deadline_is_enforced():
    assert binding_state(make_settings(email_binding_required=True, email_binding_deadline=PAST), NOW) == "enforced"


def test_required_with_an_empty_deadline_is_enforced_at_once():
    assert binding_state(make_settings(email_binding_required=True, email_binding_deadline=""), NOW) == "enforced"


def test_the_deadline_instant_itself_is_enforced():
    at = make_settings(email_binding_required=True, email_binding_deadline="2026-10-20T12:00:00+00:00")
    assert binding_state(at, NOW) == "enforced"
    assert binding_state(at, NOW - timedelta(seconds=1)) == "pending"


def test_policy_and_deps_stay_free_of_services_and_email_details():
    import app.core.account_policy as module
    source = open(module.__file__, encoding="utf-8").read()
    assert "app.services" not in source and "app.models" not in source
    assert "app.services" not in open(deps.__file__, encoding="utf-8").read()


# ---- the gate ----

def _set(app, **values):
    """Hot change: swap `app.state.settings` for a copy (what the settings hub does)."""
    app.state.settings = app.state.settings.model_copy(update=values)


@pytest.fixture
async def unbound(app, client):
    return await register(client, "unbound")


async def test_switch_off_never_blocks(app, client, unbound):
    _, headers = unbound
    _set(app, email_binding_required=False)
    assert (await client.get("/api/conversations", headers=headers)).status_code == 200
    body = (await client.get("/api/me", headers=headers)).json()
    assert body["email_binding"] == {"state": "none", "deadline": None}
    assert body["email_verified"] is False
    assert "email_masked" not in body
    assert set(body) == {"id", "name", "created_at", "display_name", "email_verified", "email_binding"}


async def test_pending_never_blocks_and_shows_the_deadline(app, client, unbound):
    _, headers = unbound
    _set(app, email_binding_required=True, email_binding_deadline=FUTURE)
    assert (await client.get("/api/conversations", headers=headers)).status_code == 200
    binding = (await client.get("/api/me", headers=headers)).json()["email_binding"]
    assert binding["state"] == "pending"
    assert datetime.fromisoformat(binding["deadline"]) == datetime.fromisoformat(FUTURE)


@pytest.mark.parametrize("deadline", [PAST, ""])
async def test_enforced_blocks_an_unbound_user_but_not_the_four_account_endpoints(app, client, unbound, deadline):
    _, headers = unbound
    enable_email(app)
    _set(app, email_binding_required=True, email_binding_deadline=deadline)
    r = await client.get("/api/conversations", headers=headers)
    assert r.status_code == 403 and r.json() == BLOCKED
    me = await client.get("/api/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["email_binding"]["state"] == "enforced"
    assert me.json()["email_binding"]["deadline"] == (None if not deadline else me.json()["email_binding"]["deadline"])
    assert (await client.post("/api/me/email/code", headers=headers, json={"email": MAIL})).status_code == 200
    assert (await client.post("/api/me/email", headers=headers,
                              json={"email": MAIL, "code": "000000"})).status_code == 400
    assert (await client.delete("/api/sessions/current", headers=headers)).status_code == 204


async def test_enforced_blocks_other_account_endpoints(app, client, unbound):
    _, headers = unbound
    _set(app, email_binding_required=True, email_binding_deadline="")
    for method, path in [("PATCH", "/api/me"), ("POST", "/api/me/password")]:
        r = await client.request(method, path, headers=headers, json={})
        assert (r.status_code, r.json()) == (403, BLOCKED), (method, path)


async def test_enforced_blocks_the_ticket_endpoints(app, client, unbound):
    _, headers = unbound
    _set(app, email_binding_required=True, email_binding_deadline="")
    for path in ("/api/rooms/abc/ticket", "/api/realtime/ticket", "/api/library/items/abc/media-ticket"):
        r = await client.post(path, headers=headers)
        assert (r.status_code, r.json()) == (403, BLOCKED), path


async def test_a_bound_user_is_not_affected(app, client, unbound):
    uid, headers = unbound
    enable_email(app)
    await bind(app, uid, MAIL)
    _set(app, email_binding_required=True, email_binding_deadline="")
    assert (await client.get("/api/conversations", headers=headers)).status_code == 200
    body = (await client.get("/api/me", headers=headers)).json()
    assert body["email_verified"] is True
    assert body["email_masked"] == "g***@example.com"
    assert body["email_binding"]["state"] == "enforced"
    assert MAIL not in str(body)


async def test_a_disabled_user_gets_account_disabled_before_the_binding_check(app, client, unbound):
    uid, headers = unbound
    async with app.state.sessionmaker() as s:
        (await s.get(User, uid)).disabled_at = utcnow()
        await s.commit()
    _set(app, email_binding_required=True, email_binding_deadline="")
    r = await client.get("/api/conversations", headers=headers)
    assert (r.status_code, r.json()) == (403, {"error": "Account disabled"})


async def test_a_hot_settings_change_applies_to_the_next_request(app, client, unbound):
    _, headers = unbound
    _set(app, email_binding_required=True, email_binding_deadline="")
    assert (await client.get("/api/conversations", headers=headers)).status_code == 403
    _set(app, email_binding_required=False)
    assert (await client.get("/api/conversations", headers=headers)).status_code == 200
    _set(app, email_binding_required=True, email_binding_deadline=PAST)
    assert (await client.get("/api/conversations", headers=headers)).status_code == 403


async def test_a_token_is_still_required(client):
    assert (await client.get("/api/conversations")).status_code == 401


# ---- which routes may skip the gate (X3) ----

def _depends_on(route, target) -> bool:
    stack = list(route.dependant.dependencies)
    while stack:
        dep = stack.pop()
        if dep.call is target:
            return True
        stack.extend(dep.dependencies)
    return False


async def test_exactly_the_four_account_endpoints_use_the_unbound_dependency(app):
    found = {(m, p) for p, r in api_routes(app.routes) if _depends_on(r, current_user_unbound)
             for m in r.methods}
    assert found == {("GET", "/api/me"), ("POST", "/api/me/email/code"), ("POST", "/api/me/email"),
                     ("DELETE", "/api/sessions/current")}


async def test_limited_user_builds_on_the_gated_dependency():
    assert inspect.signature(limited_user).parameters["user"].default.dependency is current_user


async def test_the_gate_logs_the_state_only(app, client, unbound, caplog):
    _, headers = unbound
    _set(app, email_binding_required=True, email_binding_deadline="")
    with caplog.at_level(logging.DEBUG, logger="app"):
        await client.get("/api/conversations", headers=headers)
        await client.get("/api/me", headers=headers)
    assert "binding" in caplog.text
    assert headers["Authorization"].split()[1] not in caplog.text and "unbound" not in caplog.text
