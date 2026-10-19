"""Invites v2 privacy sweep (plan 2026-10-14-invites-v2 Z1; INDEX X18, X19, X34).

One pass through the whole invite lifecycle, with plain codes captured from the responses: an admin batch, the owner's
permanent code (generate, view, rotate), a legacy registration and an email registration with it, the legacy env
INVITE_CODE, an admin single code (create, revoke), an admin rotate of the owner's code (its plain code is read from the
database here, never from a response) and the deletion of the owner.

Afterwards no plain code (dashed and undashed) may appear in the DEBUG `app` log (caplog and the admin log buffer), any
error body, any response other than the owner's or the admin creator's own reveal, the audit rows, the settings revision
rows, the metering rows or the contract fixture. Stored rows keep only the hash; `code_enc` is set only for a live user
code, and the ciphertext of every code the sweep stored never appears in those corpora. Every reveal is
`Cache-Control: no-store`. The per-IP bad-code throttle answers a real code and a fake code with the same 429.
"""
import json
import logging
import re
from datetime import timedelta
from pathlib import Path

import pytest
from sqlalchemy import select

from app.core import log_buffer, metering
from app.core.secretbox import box_for
from app.models import AdminAudit, InviteCode, SettingRevision, UpstreamCall, UsageDaily, User, utcnow
from app.services.invites import generate_code, hash_code
from tests.accounts_helpers import bind, enable_email, mail_code, register_body
from tests.admin_helpers import ADMIN_ENABLED, PASSWORD as ADMIN_PASSWORD, login_as

FIXTURE_TEXT = (Path(__file__).parent / "fixtures" / "invites_contract.json").read_text(encoding="utf-8")
# the shape of a displayed code: XXXXX-XXXXX from the invite alphabet (INDEX X18)
CODE_RE = re.compile(r"(?<![A-Za-z0-9])[A-HJKMNP-TV-Z2-9]{5}-[A-HJKMNP-TV-Z2-9]{5}(?![A-Za-z0-9])")

ENV_CODE = "LGCYENV2K9QM"  # the legacy INVITE_CODE: a 12-character unlimited code (discouraged, never shown)
ENV_USER, ENV_PW = "priv_env", "Priv-Env-3hJ7!ds"
OWNER, OWNER_EMAIL, OWNER_PW = "priv_owner", "owner.priv@example.test", "Priv-Owner-7qW3!kd"
GUEST_A, GUEST_PW = "priv_guest_a", "Priv-Guest-4zR9!mn"
GUEST_B, GUEST_B_EMAIL = "priv_guest_b", "guest.priv@example.test"
LATE, LATE_EMAIL = "priv_late", "late.priv@example.test"


@pytest.fixture
def settings_overrides():
    return {**ADMIN_ENABLED, "registration_mode": "invite", "invite_code": ENV_CODE}


class Ledger:
    """What the sweep saw: plain codes, responses that may not carry one, and the stored ciphertexts."""

    def __init__(self):
        self.plain: set[str] = {ENV_CODE}
        self.bodies: list[str] = []  # every response body that is not an owner or creator reveal
        self.errors: list[str] = []  # every body with status >= 400
        self.ciphertexts: set[str] = set()
        self.reveals = 0

    def keep(self, r):
        self.bodies.append(r.text)
        if r.status_code >= 400:
            self.errors.append(r.text)
        return r

    def reveal(self, r):
        """A response that carries a plain code to its owner or creator: must be no-store, and must carry one."""
        assert r.status_code in (200, 201), r.text
        assert r.headers.get("cache-control") == "no-store", f"{r.request.method} {r.request.url.path} is not no-store"
        codes = set(CODE_RE.findall(r.text))
        assert codes, f"{r.request.method} {r.request.url.path} should carry a code"
        self.plain |= codes
        self.reveals += 1
        return r


async def _snapshot(app, ledger: Ledger) -> None:
    async with app.state.sessionmaker() as s:
        for enc in (await s.scalars(select(InviteCode.code_enc).where(InviteCode.code_enc.is_not(None)))).all():
            ledger.ciphertexts.add(enc)


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _rows_text(rows, model, skip: tuple[str, ...] = ()) -> str:
    return json.dumps([{c.name: getattr(row, c.name) for c in model.__table__.columns if c.name not in skip}
                       for row in rows], default=str, ensure_ascii=False)


async def test_invite_lifecycle_leaks_no_plain_code(app, client, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    log_buffer.install()
    log_buffer.BUFFER.clear()
    # the app logs little in these flows: a marker proves that caplog and the admin buffer really capture the `app` logger
    logging.getLogger("app.invites_privacy_sweep").debug("sweep start marker")
    led = Ledger()
    enable_email(app)  # keys and a fake sender, once: a new encryption key would make the stored codes unreadable

    # --- admin: a batch of one-off codes (the rollout advice: admin codes first), then one single code
    h = await login_as(app, client, "superadmin")
    assert (await client.post("/api/admin/step-up", headers=h, json={"password": ADMIN_PASSWORD})).status_code == 200
    batch = led.reveal(await client.post("/api/admin/invites/batch", headers=h,
                                         json={"count": 3, "label": "priv batch"}))
    batch_codes = batch.json()["codes"]
    batch_ids = [item["id"] for item in batch.json()["invites"]]
    single = led.reveal(await client.post("/api/admin/invites", headers=h,
                                          json={"label": "priv single", "max_uses": 2}))
    single_id = single.json()["invite"]["id"]
    led.keep(await client.get("/api/admin/invites", headers=h))

    # --- the owner registers (legacy path) with a batch code, then has an email bound and waits out the new-account days
    r = led.keep(await client.post("/api/users", json={"username": OWNER, "password": OWNER_PW,
                                                       "invite_code": batch_codes[0]}))
    assert r.status_code == 200, r.text
    owner_id = r.json()["id"]
    owner = _auth(r.json()["access_token"])
    async with app.state.sessionmaker() as s:
        user = await s.get(User, owner_id)
        user.created_at = utcnow() - timedelta(days=10)
        await s.commit()
    await bind(app, owner_id, OWNER_EMAIL)

    # --- the owner generates, views, and sees no code before that
    assert led.keep(await client.get("/api/me/invite", headers=owner)).json()["code"] is None
    generated = led.reveal(await client.post("/api/me/invite", headers=owner))
    code1 = generated.json()["code"]
    led.reveal(await client.get("/api/me/invite", headers=owner))
    await _snapshot(app, led)

    # --- legacy registrations with the owner's code, a wrong code, and the env code
    guest = led.keep(await client.post("/api/users", json={"username": GUEST_A, "password": GUEST_PW,
                                                           "invite_code": code1}))
    assert guest.status_code == 200, guest.text
    guest_view = led.keep(await client.get("/api/me/invite", headers=_auth(guest.json()["access_token"])))
    assert guest_view.json()["code"] is None  # only the owner sees the owner's code
    led.keep(await client.post("/api/users", json={"username": "priv_wrong", "password": GUEST_PW,
                                                   "invite_code": "ZZZZZ-ZZZZZ"}))
    env = led.keep(await client.post("/api/users", json={"username": ENV_USER, "password": ENV_PW,
                                                         "invite_code": ENV_CODE}))
    assert env.status_code == 200, env.text

    # --- the email path with the owner's code (switched on in place: a new key would orphan the stored codes)
    app.state.base_settings = app.state.settings = app.state.settings.model_copy(
        update={"email_registration_required": True})
    guest_mail = await mail_code(app, client, GUEST_B_EMAIL, "register")
    wrong_mail = led.keep(await client.post("/api/users", json=register_body(
        GUEST_B_EMAIL, "000000", username=GUEST_B, password=GUEST_PW, nickname="PrivGuestB", invite_code=code1)))
    assert wrong_mail.status_code == 400, wrong_mail.text
    ok = led.keep(await client.post("/api/users", json=register_body(
        GUEST_B_EMAIL, guest_mail, username=GUEST_B, password=GUEST_PW, nickname="PrivGuestB", invite_code=code1)))
    assert ok.status_code == 200, ok.text

    # --- the owner rotates: the old code stops working, the new one inherits the two uses
    rotated = led.reveal(await client.post("/api/me/invite/rotate", headers=owner, json={"confirm": True}))
    code2 = rotated.json()["code"]
    assert code2 != code1 and rotated.json()["uses"] == 2
    await _snapshot(app, led)
    late_mail = await mail_code(app, client, LATE_EMAIL, "register")
    late = led.keep(await client.post("/api/users", json=register_body(
        LATE_EMAIL, late_mail, username=LATE, password=GUEST_PW, nickname="PrivLate", invite_code=code1)))
    assert late.status_code == 403

    # --- admin: revoke the single code and one unused batch code
    assert (await client.delete(f"/api/admin/invites/{single_id}", headers=h)).status_code == 204
    assert (await client.delete(f"/api/admin/invites/{batch_ids[1]}", headers=h)).status_code == 204
    led.keep(await client.get("/api/admin/invites", headers=h))

    # --- admin: rotate the owner's code. The new plain code is never returned; the test reads it from the database
    rotate_admin = led.keep(await client.post(f"/api/admin/users/{owner_id}/invite/rotate", headers=h,
                                              json={"reason": "privacy sweep"}))
    assert rotate_admin.status_code == 204, rotate_admin.text
    async with app.state.sessionmaker() as s:
        live = await s.scalar(select(InviteCode).where(InviteCode.kind == "user", InviteCode.owner_user_id == owner_id,
                                                       InviteCode.revoked_at.is_(None)))
        box = box_for(app.state.settings)
        assert live is not None and box is not None
        admin_rotated = box.decrypt(live.code_enc)
    led.plain.add(admin_rotated)
    led.keep(await client.get(f"/api/admin/users/{owner_id}/invite", headers=h))
    seen = led.reveal(await client.get("/api/me/invite", headers=owner))
    assert seen.json()["code"] == admin_rotated
    led.keep(await client.get(f"/api/admin/invites/{batch_ids[0]}/redemptions", headers=h))
    await _snapshot(app, led)

    # --- admin: delete the owner (the live code is revoked and its copy wiped)
    deleted = led.keep(await client.request("DELETE", f"/api/admin/users/{owner_id}", headers=h,
                                            json={"confirm_username": OWNER, "reason": "privacy sweep"}))
    assert deleted.status_code == 200, deleted.text
    led.keep(await client.get("/api/admin/invites", headers=h))
    await _snapshot(app, led)
    assert led.reveals >= 6 and led.ciphertexts

    # --- the corpora the spec names
    async with app.state.sessionmaker() as s:
        rows = (await s.scalars(select(InviteCode))).all()
        audit_rows = (await s.scalars(select(AdminAudit))).all()
        revision_rows = (await s.scalars(select(SettingRevision))).all()
    await metering.flush(app.state.sessionmaker)
    async with app.state.sessionmaker() as s:
        calls = (await s.scalars(select(UpstreamCall))).all()
        daily = (await s.scalars(select(UsageDaily))).all()

    # stored rows: hash only; code_enc only while a user code is live (every owner is deleted by now, so none is)
    assert {row.code_hash for row in rows} >= {hash_code(c) for c in led.plain if c != ENV_CODE}
    assert all(len(row.code_hash) == 64 for row in rows)
    assert all(row.code_enc is None for row in rows)  # admin codes never hold a copy; the owner is gone, so none is live
    actions = {row.action for row in audit_rows}
    assert {"invite.batch_create", "invite.create", "invite.revoke", "invite.user.rotate"} <= actions

    assert "sweep start marker" in caplog.text  # the capture is live, so the log checks below are not vacuous
    assert "sweep start marker" in "\n".join(e.message for e in log_buffer.query(limit=2000))
    corpora = {
        "caplog": caplog.text,
        "log_buffer": "\n".join(e.message for e in log_buffer.query(limit=2000)),
        "error_bodies": "\n".join(led.errors),
        "other_bodies": "\n".join(led.bodies),
        "audit_rows": _rows_text(audit_rows, AdminAudit),
        "revision_rows": _rows_text(revision_rows, SettingRevision),
        "metering_rows": _rows_text(calls, UpstreamCall) + _rows_text(daily, UsageDaily),
        "stored_rows": _rows_text(rows, InviteCode, skip=("code_enc",)),
        "contract_fixture": FIXTURE_TEXT,
    }
    for part, text in corpora.items():
        for code in led.plain:
            assert code not in text, f"a plain code leaked into {part}"
            assert code.replace("-", "") not in text, f"an undashed plain code leaked into {part}"
        for enc in led.ciphertexts:
            assert enc not in text, f"a stored ciphertext leaked into {part}"


async def test_bad_code_throttle_answers_a_real_and_a_fake_code_alike(app, client):
    real = generate_code()
    async with app.state.sessionmaker() as s:
        s.add(InviteCode(code_hash=hash_code(real), max_uses=1, uses=0, created_by="priv", kind="admin"))
        await s.commit()
    app.state.invite_fail_limiter.limit = 2  # two bad codes per IP, then the IP is refused before any code is read
    for n in range(2):
        r = await client.post("/api/users", json={"username": f"priv_bad_{n}", "password": "password123",
                                                  "invite_code": f"BADBAD-{n}X"})
        assert r.status_code == 403, r.text
    real_try = await client.post("/api/users", json={"username": "priv_real", "password": "password123",
                                                     "invite_code": real})
    fake_try = await client.post("/api/users", json={"username": "priv_fake", "password": "password123",
                                                     "invite_code": "QQQQQ-QQQQQ"})
    assert real_try.status_code == fake_try.status_code == 429
    assert real_try.json() == fake_try.json() == {"error": "Too many requests, please try again later"}
    assert real_try.text == fake_try.text
    assert real_try.headers.get("cache-control") == fake_try.headers.get("cache-control")
    assert real not in real_try.text and real.replace("-", "") not in real_try.text
    async with app.state.sessionmaker() as s:
        assert (await s.scalar(select(InviteCode.uses).where(InviteCode.code_hash == hash_code(real)))) == 0
