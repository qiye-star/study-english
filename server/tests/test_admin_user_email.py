"""Plan A1: admin sees masked emails only, filters unbound users and clears a user's email."""
import logging

import pytest
from sqlalchemy import func, select

from app.models import AdminAudit, User, UserIdentity
from tests.accounts_helpers import bind, enable_email
from tests.admin_helpers import ADMIN_ENABLED, PASSWORD, login_as
from tests.test_admin_api import register

MAIL = "alice.secret@example.com"


@pytest.fixture
def settings_overrides():
    return {**ADMIN_ENABLED}


async def test_list_and_detail_show_only_the_masked_email(app, client):
    enable_email(app)
    uid, _ = await register(client, "alice")
    other, _ = await register(client, "bob")
    await bind(app, uid, MAIL)
    await login_as(app, client, "viewer")
    listing = await client.get("/api/admin/users")
    rows = {u["id"]: u for u in listing.json()["users"]}
    assert rows[uid]["email_masked"] == "a***@example.com" and rows[uid]["email_verified"] is True
    assert rows[uid]["username"] == "alice"  # username stays (X6)
    assert rows[other]["email_masked"] is None and rows[other]["email_verified"] is False
    detail = await client.get(f"/api/admin/users/{uid}")
    assert detail.json()["email_masked"] == "a***@example.com" and detail.json()["email_verified"] is True
    assert (await client.get(f"/api/admin/users/{other}")).json()["email_masked"] is None
    for text in (listing.text, detail.text):
        assert MAIL not in text and "alice.secret" not in text


async def test_bound_email_with_lost_keys_is_verified_without_a_mask(app, client):
    enable_email(app)
    uid, _ = await register(client, "alice")
    await bind(app, uid, MAIL)
    app.state.settings = app.state.settings.model_copy(update={"settings_encryption_key": ""})
    await login_as(app, client, "viewer")
    row = (await client.get(f"/api/admin/users/{uid}")).json()
    assert row["email_masked"] is None and row["email_verified"] is True


async def test_email_filter_unbound_bound_all(app, client):
    enable_email(app)
    a, _ = await register(client, "alice")
    b, _ = await register(client, "bob")
    await bind(app, a, MAIL)
    await login_as(app, client, "viewer")

    def ids(r):
        return sorted(u["id"] for u in r.json()["users"])

    assert ids(await client.get("/api/admin/users", params={"email": "unbound"})) == [b]
    assert ids(await client.get("/api/admin/users", params={"email": "bound"})) == [a]
    assert ids(await client.get("/api/admin/users", params={"email": "all"})) == sorted([a, b])
    assert ids(await client.get("/api/admin/users")) == sorted([a, b])
    assert (await client.get("/api/admin/users", params={"email": "nope"})).status_code == 422
    assert (await client.get("/api/admin/users", params={"email": "unbound"})).json()["total"] == 1


async def test_clear_email_needs_operator_and_step_up(app, client):
    enable_email(app)
    uid, _ = await register(client, "alice")
    await bind(app, uid, MAIL)
    body = {"reason": "用户换号"}
    viewer = await login_as(app, client, "viewer")
    assert (await client.post(f"/api/admin/users/{uid}/email/clear", headers=viewer, json=body)).status_code == 403
    op = await login_as(app, client, "operator")
    assert (await client.post(f"/api/admin/users/{uid}/email/clear", headers=op, json=body)).status_code == 403
    async with app.state.sessionmaker() as s:
        assert await s.scalar(select(func.count()).select_from(UserIdentity).where(UserIdentity.user_id == uid)) == 1


async def test_clear_email_removes_identity_audits_ids_only_and_keeps_tokens(app, client, caplog):
    enable_email(app)
    uid, user_headers = await register(client, "alice")
    other, _ = await register(client, "bob")
    await bind(app, uid, MAIL)
    await bind(app, other, "bob.keeps@example.com")
    h = await login_as(app, client, "operator")
    assert (await client.post("/api/admin/step-up", headers=h, json={"password": PASSWORD})).status_code == 200
    caplog.set_level(logging.DEBUG, logger="app")
    r = await client.post(f"/api/admin/users/{uid}/email/clear", headers=h, json={"reason": "  用户换号  "})
    assert r.status_code == 200 and r.json() == {"user_id": uid, "email_masked": None, "email_verified": False}
    async with app.state.sessionmaker() as s:
        user = await s.get(User, uid)
        assert user.email_verified_at is None
        assert await s.scalar(select(func.count()).select_from(UserIdentity).where(UserIdentity.user_id == uid)) == 0
        assert await s.scalar(select(func.count()).select_from(UserIdentity).where(UserIdentity.user_id == other)) == 1
        rows = (await s.scalars(select(AdminAudit).where(AdminAudit.action == "user.email.clear"))).all()
    assert len(rows) == 1
    audit = rows[0]
    assert audit.target_type == "user" and audit.target_id == str(uid) and audit.summary == "alice"
    assert audit.before == {"bound": True} and audit.after == {"bound": False} and audit.reason == "用户换号"
    assert (await client.get("/api/me", headers=user_headers)).status_code == 200  # tokens are not revoked
    assert MAIL not in caplog.text and "alice.secret" not in caplog.text and MAIL not in repr(audit.__dict__)
    # a second clear is a harmless no-op that still answers 200
    assert (await client.post(f"/api/admin/users/{uid}/email/clear", headers=h, json={"reason": "again"})).status_code == 200


async def test_clear_email_validation_and_unknown_user(app, client):
    h = await login_as(app, client, "operator")
    await client.post("/api/admin/step-up", headers=h, json={"password": PASSWORD})
    assert (await client.post("/api/admin/users/99999999/email/clear", headers=h, json={"reason": "x y"})).status_code == 404
    uid, _ = await register(client, "carol")
    assert (await client.post(f"/api/admin/users/{uid}/email/clear", headers=h, json={"reason": ""})).status_code == 422
