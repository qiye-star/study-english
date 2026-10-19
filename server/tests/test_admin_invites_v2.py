"""Admin side of invites v2 (plan 2026-10-14-invites-v2 S7; R-I10, R-I11, X21): batch one-off codes, listing by kind and
owner, redemption attribution, per-user status and the owner's code revoke / replace. Codes never reach the audit log,
a listing, a status or a log line; the batch answer is the only place an admin sees a plain code (once, no-store)."""
import logging
import re
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models import AdminAudit as AuditRow, InviteCode, User, utcnow
from tests.accounts_helpers import bind, enable_email
from tests.admin_helpers import ADMIN_ENABLED, PASSWORD, login_as


@pytest.fixture
def settings_overrides():
    return dict(ADMIN_ENABLED)

CODE_RE = re.compile(r"^[A-HJKMNP-TV-Z2-9]{5}-[A-HJKMNP-TV-Z2-9]{5}$")


def _set(app, **update):
    app.state.base_settings = app.state.settings = app.state.settings.model_copy(update=update)


async def _owner(app, client, name: str, *, verified: bool = True) -> tuple[dict, int]:
    """An eligible owner: aged past the minimum, with a verified email (bind writes the verified flag directly).
    Registers in open mode whatever the test has switched on, then restores the mode."""
    mode = app.state.settings.registration_mode
    _set(app, registration_mode="open")
    r = await client.post("/api/users", json={"username": name, "password": "password123"})
    _set(app, registration_mode=mode)
    assert r.status_code == 200, r.text
    uid = int(r.json()["id"])
    async with app.state.sessionmaker() as s:
        user = await s.get(User, uid)
        user.created_at = utcnow() - timedelta(days=10)
        await s.commit()
    if verified:
        await bind(app, uid, f"{name}@example.com")
    return {"Authorization": f"Bearer {r.json()['access_token']}"}, uid


async def _join(client, code: str, name: str):
    """Register in invite mode (the caller switches the mode on first)."""
    return await client.post("/api/users", json={"username": name, "password": "password123", "invite_code": code})


async def _step_up(client, h):
    assert (await client.post("/api/admin/step-up", headers=h, json={"password": PASSWORD})).status_code == 200


async def _audit_text(app) -> str:
    """Every audit row, flattened: the audit must never carry a plain code."""
    async with app.state.sessionmaker() as s:
        rows = (await s.scalars(select(AuditRow))).all()
        return "\n".join(repr((r.action, r.summary, r.before, r.after, r.reason, r.target_id)) for r in rows)


async def _batch(client, h, count: int = 3, label: str = "班级 B", **extra):
    return await client.post("/api/admin/invites/batch", headers=h, json={"count": count, "label": label, **extra})


def _no_store(r) -> None:
    assert r.headers.get("cache-control") == "no-store"


# ---- batch generation ----

async def test_batch_returns_one_use_codes_once_and_they_redeem_once(app, client):
    h = await login_as(app, client, "operator")
    future = (datetime.now(timezone.utc) + timedelta(days=3)).isoformat()
    r = await _batch(client, h, count=3, expires_at=future)
    assert r.status_code == 201, r.text
    _no_store(r)
    body = r.json()
    assert len(body["codes"]) == 3 and len(set(body["codes"])) == 3
    assert all(CODE_RE.match(c) for c in body["codes"])
    assert [i["max_uses"] for i in body["invites"]] == [1, 1, 1] and {i["kind"] for i in body["invites"]} == {"admin"}
    assert all(i["uses"] == 0 and i["state"] == "active" and i["expires_at"] for i in body["invites"])
    _set(app, registration_mode="invite", invite_code="ENV-CODE-999")
    first = await _join(client, body["codes"][0], "batch_one")
    assert first.status_code == 200, first.text
    again = await _join(client, body["codes"][0], "batch_two")
    assert again.status_code == 403 and again.json() == {"error": "Invite code used up"}


async def test_batch_bounds_and_expiry_are_checked(app, client):
    h = await login_as(app, client, "operator")
    assert (await _batch(client, h, count=0)).status_code == 422
    assert (await _batch(client, h, count=101)).status_code == 422
    past = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    assert (await _batch(client, h, count=2, expires_at=past)).status_code == 422
    assert (await _batch(client, h, count=100)).status_code == 201


async def test_batch_audit_counts_and_carries_no_codes(app, client, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    h = await login_as(app, client, "operator")
    r = await _batch(client, h, count=2, label="audit me")
    codes = r.json()["codes"]
    async with app.state.sessionmaker() as s:
        rows = (await s.scalars(select(AuditRow).where(AuditRow.action == "invite.batch_create"))).all()
    assert len(rows) == 1 and rows[0].summary == "audit me" and rows[0].after == {"count": 2, "expires_at": None}
    audit = await _audit_text(app)
    for code in codes:
        assert code not in audit and code.replace("-", "") not in audit and code not in caplog.text


# ---- listing ----

async def test_listing_filters_by_kind_owner_and_state_and_summarises_redeemers(app, client):
    enable_email(app)
    _set(app, registration_mode="invite", invite_code="ENV-CODE-999")
    h = await login_as(app, client, "operator")
    await _batch(client, h, count=1, label="one-off")
    owner_headers, owner_id = await _owner(app, client, "lister")
    code = (await client.post("/api/me/invite", headers=owner_headers)).json()["code"]
    joined = await _join(client, code, "lister_guest")
    assert joined.status_code == 200, joined.text

    everything = (await client.get("/api/admin/invites", headers=h)).json()["invites"]
    kinds = {i["kind"] for i in everything}
    assert kinds == {"admin", "user"}
    user_row = next(i for i in everything if i["kind"] == "user")
    assert user_row["owner"] == {"id": owner_id, "username": "lister", "nickname": None}
    assert user_row["redeemers"] == {"total": 1, "usernames": ["lister_guest"]}
    assert "code" not in user_row and code not in repr(everything)

    only_user = (await client.get("/api/admin/invites?kind=user", headers=h)).json()["invites"]
    assert [i["kind"] for i in only_user] == ["user"]
    by_name = (await client.get("/api/admin/invites?owner=lister", headers=h)).json()["invites"]
    by_id = (await client.get(f"/api/admin/invites?owner={owner_id}", headers=h)).json()["invites"]
    assert [i["id"] for i in by_name] == [i["id"] for i in by_id] == [user_row["id"]]
    assert (await client.get("/api/admin/invites?owner=nobody_here", headers=h)).json()["invites"] == []
    assert (await client.get("/api/admin/invites?state=active", headers=h)).json()["invites"]
    assert (await client.get("/api/admin/invites?state=revoked", headers=h)).json()["invites"] == []
    assert (await client.get("/api/admin/invites?state=sideways", headers=h)).status_code == 422


async def test_listing_state_of_a_user_code_follows_the_live_cap(app, client):
    enable_email(app)
    h = await login_as(app, client, "operator")
    owner_headers, owner_id = await _owner(app, client, "capped_owner")
    await client.post("/api/me/invite", headers=owner_headers)
    async with app.state.sessionmaker() as s:
        row = await s.scalar(select(InviteCode).where(InviteCode.owner_user_id == owner_id))
        row.uses = 10  # the default cap of 10 is now reached
        await s.commit()
    rows = (await client.get("/api/admin/invites?kind=user", headers=h)).json()["invites"]
    assert rows[0]["state"] == "used_up" and rows[0]["uses"] == 10 and rows[0]["max_uses"] == 10


async def test_redemptions_show_disabled_invitees(app, client):
    enable_email(app)
    _set(app, registration_mode="invite", invite_code="ENV-CODE-999")
    h = await login_as(app, client, "operator")
    owner_headers, _ = await _owner(app, client, "rd_owner")
    code = (await client.post("/api/me/invite", headers=owner_headers)).json()["code"]
    await _join(client, code, "rd_guest")
    listing = (await client.get("/api/admin/invites?kind=user", headers=h)).json()["invites"]
    rows = (await client.get(f"/api/admin/invites/{listing[0]['id']}/redemptions", headers=h)).json()["redemptions"]
    assert len(rows) == 1 and set(rows[0]) == {"user_id", "username", "nickname", "redeemed_at", "disabled"}
    assert rows[0]["username"] == "rd_guest" and rows[0]["disabled"] is False
    guest_id = rows[0]["user_id"]
    assert (await client.post(f"/api/admin/users/{guest_id}/disable", headers=h,
                              json={"reason": "spam"})).status_code == 200
    rows = (await client.get(f"/api/admin/invites/{listing[0]['id']}/redemptions", headers=h)).json()["redemptions"]
    assert rows[0]["disabled"] is True


# ---- per-user status ----

async def test_per_user_status_counts_and_never_shows_the_code(app, client, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    enable_email(app)
    _set(app, registration_mode="invite", invite_code="ENV-CODE-999")
    h = await login_as(app, client, "operator")
    owner_headers, owner_id = await _owner(app, client, "status_owner")
    code = (await client.post("/api/me/invite", headers=owner_headers)).json()["code"]
    await _join(client, code, "status_guest")
    r = await client.get(f"/api/admin/users/{owner_id}/invite", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"current", "history_codes", "redemptions", "disabled_invitees", "invitees"}
    assert set(body["current"]) == {"uses", "cap", "created_at", "revoked_at", "state"}
    assert body["current"]["uses"] == 1 and body["current"]["cap"] == 10 and body["current"]["state"] == "active"
    assert body["history_codes"] == 1 and body["redemptions"] == 1 and body["disabled_invitees"] == 0
    assert body["invitees"][0]["display_name"] == "status_guest"
    assert code not in r.text and code.replace("-", "") not in r.text and code not in caplog.text
    assert (await client.get("/api/admin/users/999999999/invite", headers=h)).status_code == 404


# ---- owner's code: revoke and replace ----

async def test_admin_revoke_and_replace_need_step_up_and_inherit_the_uses(app, client, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    enable_email(app)
    _set(app, registration_mode="invite", invite_code="ENV-CODE-999")
    h = await login_as(app, client, "operator")
    owner_headers, owner_id = await _owner(app, client, "revoked_owner")
    old = (await client.post("/api/me/invite", headers=owner_headers)).json()["code"]
    await _join(client, old, "revoked_guest")

    body = {"reason": "码泄露到群里"}
    assert (await client.post(f"/api/admin/users/{owner_id}/invite/revoke", headers=h, json=body)).status_code == 403
    await _step_up(client, h)
    r = await client.post(f"/api/admin/users/{owner_id}/invite/revoke", headers=h, json=body)
    assert r.status_code == 204
    view = (await client.get("/api/me/invite", headers=owner_headers)).json()
    assert view["code"] is None and view["uses"] == 1 and view["eligible"] is True

    fresh = (await client.post("/api/me/invite", headers=owner_headers)).json()
    assert fresh["code"] != old and fresh["uses"] == 1  # the cumulative uses carry over (R-I8)
    assert (await client.post(f"/api/admin/users/{owner_id}/invite/revoke", headers=h, json=body)).status_code == 204

    r = await client.post(f"/api/admin/users/{owner_id}/invite/rotate", headers=h, json=body)
    assert r.status_code == 409 and r.json() == {"error": "No invite code to replace"}
    fresh = (await client.post("/api/me/invite", headers=owner_headers)).json()
    r = await client.post(f"/api/admin/users/{owner_id}/invite/rotate", headers=h, json=body)
    assert r.status_code == 204 and "code" not in r.text
    after = (await client.get("/api/me/invite", headers=owner_headers)).json()
    assert after["code"] not in (None, fresh["code"]) and after["uses"] == 1
    assert (await _join(client, fresh["code"], "late_guest")).json() == {"error": "Invalid invite code"}

    audit = await _audit_text(app)
    assert "invite.user.revoke" in audit and "invite.user.rotate" in audit
    for code in (old, fresh["code"], after["code"]):
        assert code not in audit and code not in caplog.text and code.replace("-", "") not in caplog.text


async def test_admin_replace_without_the_key_is_503(app, client):
    h = await login_as(app, client, "operator")
    _, owner_id = await _owner(app, client, "no_key_admin", verified=False)  # no enable_email: no key
    await _step_up(client, h)
    r = await client.post(f"/api/admin/users/{owner_id}/invite/rotate", headers=h, json={"reason": "x"})
    assert r.status_code == 503 and r.json() == {"error": "Invites are not configured"}


async def test_viewers_cannot_touch_any_of_the_new_routes(app, client):
    h = await login_as(app, client, "viewer")
    assert (await client.post("/api/admin/invites/batch", headers=h, json={"count": 1})).status_code == 403
    assert (await client.get("/api/admin/users/1/invite", headers=h)).status_code == 403
    assert (await client.post("/api/admin/users/1/invite/revoke", headers=h, json={"reason": "x"})).status_code == 403
    assert (await client.post("/api/admin/users/1/invite/rotate", headers=h, json={"reason": "x"})).status_code == 403
    assert (await client.get("/api/admin/invites/1/redemptions", headers=h)).status_code == 403


async def test_admin_single_revoke_also_wipes_a_user_codes_plain_copy(app, client):
    enable_email(app)
    h = await login_as(app, client, "operator")
    owner_headers, owner_id = await _owner(app, client, "wiped_owner")
    await client.post("/api/me/invite", headers=owner_headers)
    async with app.state.sessionmaker() as s:
        row = await s.scalar(select(InviteCode).where(InviteCode.owner_user_id == owner_id))
        invite_id = row.id
    assert (await client.delete(f"/api/admin/invites/{invite_id}", headers=h)).status_code == 204
    async with app.state.sessionmaker() as s:
        row = await s.get(InviteCode, invite_id)
        assert row.revoked_at is not None and row.code_enc is None
