"""Invites payload shapes the web and admin clients mirror (plan 2026-10-14-invites-v2 S8; INDEX X28), and the privacy
sweep over the same flows: no plain code in the fixture, a log line, an error body, a listing or the audit.

The real app drives the owner's panel (GET / POST /api/me/invite, the invitee), the admin batch and the admin listing;
every body is compared by shape with `fixtures/invites_contract.json`. Codes, tokens and times are fixed placeholders.
Re-record after an intentional change: `CONTRACT_UPDATE=1 uv run pytest -q tests/test_invites_contract.py`
(PowerShell: `$env:CONTRACT_UPDATE=1; uv run pytest -q tests/test_invites_contract.py; Remove-Item Env:CONTRACT_UPDATE`).
"""
import json
import logging
import os
import re
from datetime import timedelta
from pathlib import Path

import pytest
from sqlalchemy import select

from app.models import AdminAudit, User, utcnow
from tests.accounts_helpers import bind, enable_email
from tests.admin_helpers import ADMIN_ENABLED, login_as
from tests.links_helpers import shape

FIXTURE = Path(__file__).parent / "fixtures" / "invites_contract.json"
KEYS = {"my_invite_none", "my_invite", "admin_batch", "admin_list"}
PLACEHOLDER = "REDACTED"
STAMP = "2026-01-01T00:00:00Z"
PASSWORD = "contract-password-1"
# the shape of a real code: 10 characters from the invite alphabet, displayed XXXXX-XXXXX (INDEX X18)
CODE_RE = re.compile(r"(?<![A-Za-z0-9])[A-HJKMNP-TV-Z2-9]{5}-[A-HJKMNP-TV-Z2-9]{5}(?![A-Za-z0-9])")
TIME_KEYS = {"created_at", "joined_at", "redeemed_at", "available_at", "expires_at", "revoked_at"}


@pytest.fixture
def settings_overrides():
    return dict(ADMIN_ENABLED)


def redact(value, key: str | None = None):
    """Fixed placeholders for codes and times; ids and counts are kept (they are part of the shape)."""
    if isinstance(value, dict):
        out = {k: redact(v, k) for k, v in value.items()}
        if key == "owner" and value.get("id") is not None:
            out["id"] = 10000001  # a user id is a fixed placeholder, like the accounts contract
        return out
    if isinstance(value, list):
        return [redact(v, key) for v in value]
    if isinstance(value, str) and (key == "code" or key == "codes"):
        return PLACEHOLDER
    if isinstance(value, str) and key in TIME_KEYS:
        return STAMP
    return value


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _record(app, client, plain: list[str], raw: list[str]) -> dict:
    """Runs the flows. `plain` collects every real code (for the privacy test); `raw` keeps the error bodies and
    the admin listing, which must never contain a code."""
    enable_email(app)
    got = {}
    r = await client.post("/api/users", json={"username": "owner_contract", "password": PASSWORD})
    assert r.status_code == 200, r.text
    owner_id = int(r.json()["id"])
    async with app.state.sessionmaker() as s:
        user = await s.get(User, owner_id)
        user.created_at = utcnow() - timedelta(days=10)
        await s.commit()
    await bind(app, owner_id, "owner.contract@example.com")
    headers = _auth(r.json()["access_token"])

    got["my_invite_none"] = (await client.get("/api/me/invite", headers=headers)).json()
    r = await client.post("/api/me/invite", headers=headers)
    assert r.status_code == 200, r.text
    code = r.json()["code"]
    plain.append(code)

    app.state.settings = app.state.settings.model_copy(update={"registration_mode": "invite"})
    guest = await client.post("/api/users", json={"username": "guest_contract", "password": PASSWORD,
                                                  "invite_code": code})
    assert guest.status_code == 200, guest.text
    got["my_invite"] = (await client.get("/api/me/invite", headers=headers)).json()
    assert got["my_invite"]["code"] == code  # the owner sees its own code, and only the owner does

    # an error body that names the reason, never the code
    stale = await client.post("/api/users", json={"username": "stale_contract", "password": PASSWORD,
                                                  "invite_code": "ZZZZZ-ZZZZZ"})
    raw.append(stale.text)
    rotated = await client.post("/api/me/invite/rotate", headers=headers, json={"confirm": True})
    assert rotated.status_code == 200, rotated.text
    plain.append(rotated.json()["code"])
    late = await client.post("/api/users", json={"username": "late_contract", "password": PASSWORD,
                                                 "invite_code": code})  # the replaced code
    assert late.status_code == 403
    raw.append(late.text)

    h = await login_as(app, client, "operator")
    batch = await client.post("/api/admin/invites/batch", headers=h, json={"count": 2, "label": "contract"})
    assert batch.status_code == 201, batch.text
    got["admin_batch"] = batch.json()
    plain.extend(batch.json()["codes"])
    listing = await client.get("/api/admin/invites", headers=h)
    assert listing.status_code == 200, listing.text
    got["admin_list"] = listing.json()
    raw.append(listing.text)
    return got


async def test_invites_payloads_match_the_web_contract(app, client):
    plain: list[str] = []
    actual = redact(await _record(app, client, plain, []))
    assert set(actual) == KEYS
    assert actual["my_invite_none"]["code"] is None and actual["my_invite"]["code"] == PLACEHOLDER
    assert actual["my_invite"]["invitees"] and set(actual["my_invite"]["invitees"][0]) == {"display_name", "joined_at"}
    assert [i["kind"] for i in actual["admin_batch"]["invites"]] == ["admin", "admin"]
    assert actual["admin_batch"]["codes"] == [PLACEHOLDER, PLACEHOLDER]
    if os.environ.get("CONTRACT_UPDATE"):
        FIXTURE.write_text(json.dumps(actual, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    expected = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert set(expected) == KEYS
    assert shape(actual) == shape(expected)


def test_the_fixture_holds_only_placeholders():
    raw = FIXTURE.read_text(encoding="utf-8")
    assert not CODE_RE.search(raw)  # no real-looking invite code (REDACTED is the only code form here)
    assert "Bearer" not in raw and "secret" not in raw and "@" not in raw
    assert not re.search(r"[A-Za-z0-9_-]{32,}", raw)  # no token-looking string
    data = json.loads(raw)
    assert data["my_invite"]["code"] == PLACEHOLDER and data["admin_batch"]["codes"] == [PLACEHOLDER] * 2


async def test_no_plain_code_reaches_logs_errors_listings_or_the_audit(app, client, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    plain: list[str] = []
    raw: list[str] = []
    await _record(app, client, plain, raw)
    assert len(plain) == 4 and len(set(plain)) == 4
    async with app.state.sessionmaker() as s:
        audit = "\n".join(repr((r.action, r.summary, r.before, r.after, r.reason, r.target_id))
                          for r in (await s.scalars(select(AdminAudit))).all())
    haystacks = {"logs": caplog.text, "errors and listings": "\n".join(raw), "audit": audit}
    for code in plain:
        bare = code.replace("-", "")
        for where, text in haystacks.items():
            assert code not in text and bare not in text, where
    assert "invite.batch_create" in audit  # the admin action is audited; the owner's own rotate is not an admin action
