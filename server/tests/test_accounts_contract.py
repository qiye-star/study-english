"""Accounts payload shapes the web client mirrors (plan S23; INDEX X28).

The real app drives register / login / me / email code / password change / the binding gate; every body is compared by
*shape* (nested key sets) with `fixtures/accounts_contract.json`, which web `features/account/accounts-contract.test.ts`
reads key by key. Tokens, ids, times and the masked address are written as fixed placeholders.
Re-record after an intentional change: `CONTRACT_UPDATE=1 uv run pytest -q tests/test_accounts_contract.py`
(PowerShell: `$env:CONTRACT_UPDATE=1; uv run pytest -q tests/test_accounts_contract.py; Remove-Item Env:CONTRACT_UPDATE`).
"""
import json
import os
import re
from pathlib import Path

from tests.accounts_helpers import enable_email, last_code, register_body
from tests.background import drain_background
from tests.links_helpers import shape

FIXTURE = Path(__file__).parent / "fixtures" / "accounts_contract.json"
KEYS = {"me", "me_unbound", "register", "login", "email_code", "password_changed", "error_binding_required"}
EMAIL = "alice.contract@example.com"
PASSWORD = "contract-password-1"
NEW_PASSWORD = "contract-password-2"
MASKED = "a***@example.com"
STAMP = "2026-01-01T00:00:00Z"
DEADLINE = "2026-12-01T00:00:00+08:00"


def redact(value):
    """Fixed placeholders for everything that is random, secret or time-dependent."""
    if isinstance(value, dict):
        out = {}
        for key, item in value.items():
            if key == "access_token":
                out[key] = "REDACTED"
            elif key == "id":
                out[key] = "10000001"
            elif key == "created_at":
                out[key] = STAMP
            elif key == "email_masked":
                out[key] = MASKED
            else:
                out[key] = redact(item)
        return out
    return value


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _record(app, client) -> dict:
    enable_email(app, email_registration_required=True)
    got = {}
    r = await client.post("/api/email/code", json={"email": EMAIL, "purpose": "register"})
    assert r.status_code == 200, r.text
    got["email_code"] = r.json()
    await drain_background(app)
    code = last_code(app, EMAIL)
    r = await client.post("/api/users", json=register_body(EMAIL, code, username="alice", password=PASSWORD))
    assert r.status_code == 200, r.text
    got["register"] = r.json()
    r = await client.post("/api/sessions", json={"provider": "password", "username": EMAIL, "password": PASSWORD})
    assert r.status_code == 200, r.text
    got["login"] = r.json()
    headers = _auth(got["login"]["access_token"])

    app.state.settings = app.state.settings.model_copy(
        update={"email_binding_required": True, "email_binding_deadline": DEADLINE})
    r = await client.get("/api/me", headers=headers)
    assert r.status_code == 200, r.text
    got["me"] = r.json()

    app.state.settings = app.state.settings.model_copy(
        update={"email_registration_required": False, "email_binding_deadline": ""})
    r = await client.post("/api/users", json={"username": "legacy", "password": PASSWORD})
    assert r.status_code == 200, r.text
    legacy = _auth(r.json()["access_token"])
    r = await client.get("/api/me", headers=legacy)
    assert r.status_code == 200, r.text
    got["me_unbound"] = r.json()
    r = await client.get("/api/conversations", headers=legacy)
    assert r.status_code == 403, r.text
    got["error_binding_required"] = r.json()

    app.state.settings = app.state.settings.model_copy(update={"email_binding_required": False})
    r = await client.post("/api/me/password", headers=headers,
                          json={"current_password": PASSWORD, "new_password": NEW_PASSWORD})
    assert r.status_code == 200, r.text
    got["password_changed"] = r.json()
    return got


async def test_accounts_payloads_match_the_web_contract(app, client):
    actual = redact(await _record(app, client))
    assert set(actual) == KEYS
    assert actual["me"]["email_binding"] == {"state": "pending", "deadline": DEADLINE}
    assert actual["me_unbound"]["email_binding"] == {"state": "enforced", "deadline": None}
    assert actual["error_binding_required"] == {"error": "email_binding_required"}
    if os.environ.get("CONTRACT_UPDATE"):
        FIXTURE.write_text(json.dumps(actual, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    expected = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert set(expected) == KEYS
    assert shape(actual) == shape(expected)


def test_the_fixture_holds_only_placeholders():
    raw = FIXTURE.read_text(encoding="utf-8")
    for forbidden in (EMAIL, "alice.contract", PASSWORD, NEW_PASSWORD, "Bearer", "pepper", "secret"):
        assert forbidden not in raw
    assert not re.search(r"\b\d{6}\b", raw)  # an email code
    assert not re.search(r"[A-Za-z0-9_-]{32,}", raw)  # a real-looking token
    assert set(re.findall(r"[\w.*+-]*@[\w.-]+", raw)) == {MASKED}
    data = json.loads(raw)
    assert {data["register"]["access_token"], data["login"]["access_token"],
            data["password_changed"]["access_token"]} == {"REDACTED"}
