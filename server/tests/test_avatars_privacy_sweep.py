"""Privacy sweep for the avatar flows (plan Z1, INDEX X30-X36).

One pass through upload (with EXIF and a JPEG comment carrying a marker, and a distinctive file name), public read,
room payloads, replace, a report, a duplicate report, an admin list, admin remove (with step-up), admin dismiss, the
upload switch (off, then on), the user's own delete, and admin user deletion. Afterwards none of the distinctive
values may appear in: the DEBUG `app` log (caplog and the admin log buffer), any error body, the admin audit rows or
the settings revision rows. Avatar ids are checked everywhere except the success bodies, where the endpoints return
them as `avatar_url`. The stored files must carry no metadata, and deleting a user removes the file and every
`AvatarReport` row that names them.

Exceptions, by design (documented, not leaks): the admin remove `reason` is written to the audit row (the operator's
own note); the `user.delete` audit summary holds the deleted account's username (the pre-existing deletion audit,
unchanged by the avatar work), so the username is checked against every corpus except the audit rows.
"""
import io
import json
import logging

import pytest
from PIL import Image
from sqlalchemy import select

from app.core import log_buffer
from app.models import AdminAudit, AvatarReport, SettingRevision
from app.services.avatars import avatar_key


def path_for(settings, avatar_id: str):
    """The local file of an avatar (the sweep runs on the default local backend, rooted at the data directory)."""
    return settings.resolved_data_dir / avatar_key(avatar_id)
from tests.accounts_helpers import enable_email, mail_code, register_body
from tests.admin_helpers import ADMIN_ENABLED, PASSWORD as ADMIN_PASSWORD, login_as

MARK_EXIF = "SWEEPMARK-EXIF-5Qd1"
MARK_COMMENT = "SWEEPMARK-COMMENT-8Lr3"
FILE_NAME = "sweep-filename-marker-2Hz9.jpg"
REASON_ADMIN = "SWEEPMARK-ADMIN-REASON-4Xa7"
ALICE_EMAIL = "sweep.alice@example.test"
ALICE, BOB, CAROL, VIEWER = "sweep_alice", "sweep_bob", "sweep_carol", "viewer1"
NICK = "Sweepy7Nick"
PASSWORD = "Sweep-Pass-7fQ2!xyz"


@pytest.fixture
def settings_overrides(tmp_path):
    return {**ADMIN_ENABLED, "data_dir": str(tmp_path / "data"), "rooms_enabled": True}


def marked_jpeg(color=(30, 120, 200)) -> bytes:
    exif = Image.Exif()
    exif[0x010E] = MARK_EXIF  # ImageDescription
    exif[0x013B] = MARK_EXIF  # Artist
    buf = io.BytesIO()
    Image.new("RGB", (64, 48), color).save(buf, format="JPEG", exif=exif.tobytes(), comment=MARK_COMMENT.encode())
    return buf.getvalue()


def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def avatar_id_of(url: str) -> str:
    assert url.startswith("/api/avatars/"), url
    return url.rsplit("/", 1)[1]


def stored_bytes(app, avatar_id: str) -> bytes:
    return path_for(app.state.settings, avatar_id).read_bytes()


async def test_avatar_flows_leak_no_distinctive_value(app, client, caplog, tmp_path):
    caplog.set_level(logging.DEBUG, logger="app")
    log_buffer.install()
    log_buffer.BUFFER.clear()
    enable_email(app)
    errors: list[str] = []
    public_bodies: list[bytes] = []
    issued: set[str] = set()

    def keep(r):
        if r.status_code >= 400:
            errors.append(r.text)
        return r

    async def upload(headers, color=(30, 120, 200)):
        r = keep(await client.post("/api/me/avatar", headers=headers,
                                   files={"file": (FILE_NAME, marked_jpeg(color), "image/jpeg")}))
        assert r.status_code == 200, r.text
        aid = avatar_id_of(r.json()["avatar_url"])
        issued.add(aid)
        return aid

    # --- register: alice by email (nickname), bob and carol by username
    code = await mail_code(app, client, ALICE_EMAIL, "register")
    r = keep(await client.post("/api/users", json=register_body(ALICE_EMAIL, code, username=ALICE,
                                                                password=PASSWORD, nickname=NICK)))
    assert r.status_code == 200, r.text
    alice_h, alice_id = bearer(r.json()["access_token"]), int(r.json()["id"])
    r = keep(await client.post("/api/users", json={"username": BOB, "password": PASSWORD}))
    assert r.status_code == 200, r.text
    bob_h, bob_id = bearer(r.json()["access_token"]), int(r.json()["id"])
    r = keep(await client.post("/api/users", json={"username": CAROL, "password": PASSWORD}))
    assert r.status_code == 200, r.text
    carol_h, carol_id = bearer(r.json()["access_token"]), int(r.json()["id"])

    # --- upload, public read (body and stored file), then replace
    first = await upload(alice_h)
    public = keep(await client.get(f"/api/avatars/{first}"))
    assert public.status_code == 200 and public.headers["content-type"] == "image/webp"
    public_bodies.append(public.content)
    stored = stored_bytes(app, first)
    assert MARK_EXIF.encode() not in stored and MARK_COMMENT.encode() not in stored
    kept = Image.open(io.BytesIO(stored))
    assert len(kept.getexif()) == 0
    assert not {"exif", "icc_profile", "xmp", "comment"} & set(kept.info)
    second = await upload(alice_h, color=(200, 40, 40))
    assert second != first
    assert (await client.get(f"/api/avatars/{first}")).status_code == 404
    assert not path_for(app.state.settings, first).exists()  # the replaced file is gone after the commit

    # --- bob and carol upload too; alice creates a room; bob and carol join; room payloads carry the path
    bob_avatar = await upload(bob_h, color=(10, 10, 200))
    carol_avatar = await upload(carol_h, color=(10, 200, 10))
    room = keep(await client.post("/api/rooms", json={"topic": "sweep"}, headers=alice_h)).json()["room"]
    for headers in (bob_h, carol_h):
        assert keep(await client.post("/api/rooms/join", json={"code": room["code"]}, headers=headers)).status_code == 200
    detail = keep(await client.get(f"/api/rooms/{room['id']}", headers=bob_h))
    assert detail.status_code == 200
    members = {m["user_id"]: m["avatar_url"] for m in detail.json()["members"]}
    assert members[alice_id] == f"/api/avatars/{second}"
    msgs = keep(await client.get(f"/api/rooms/{room['id']}/messages", params={"before_seq": 1000},
                                  headers=alice_h))
    assert msgs.status_code == 200

    # --- reports: bob and carol report alice's avatar; carol repeats (200); alice reports bob's avatar; unknown user
    assert (await client.post("/api/avatar-reports", headers=bob_h,
                              json={"user_id": str(alice_id), "reason": "inappropriate"})).status_code == 201
    assert (await client.post("/api/avatar-reports", headers=carol_h,
                              json={"user_id": str(alice_id), "reason": "impersonation"})).status_code == 201
    assert (await client.post("/api/avatar-reports", headers=carol_h,
                              json={"user_id": str(alice_id), "reason": "impersonation"})).status_code == 200
    assert keep(await client.post("/api/avatar-reports", headers=alice_h,
                                  json={"user_id": str(bob_id), "reason": "other"})).status_code == 201
    missing = keep(await client.post("/api/avatar-reports", headers=alice_h,
                                     json={"user_id": "999999", "reason": "other"}))
    assert missing.status_code == 404

    # --- admin: viewer lists; operator removes alice's avatar (step-up, reason); operator dismisses bob's reports
    viewer_h = await login_as(app, client, "viewer", username=VIEWER)
    listed = (await client.get("/api/admin/avatar-reports", headers=viewer_h)).json()
    assert {u["user_id"] for u in listed["users"]} == {alice_id, bob_id}
    op_h = await login_as(app, client, "operator", username="operator1")
    assert (await client.post("/api/admin/step-up", headers=op_h, json={"password": ADMIN_PASSWORD})).status_code == 200
    removed = keep(await client.request("DELETE", f"/api/admin/users/{alice_id}/avatar", headers=op_h,
                                        json={"reason": REASON_ADMIN}))
    assert removed.status_code == 200, removed.text
    assert not path_for(app.state.settings, second).exists()
    assert (await client.get(f"/api/avatars/{second}")).status_code == 404
    dismissed = keep(await client.post(f"/api/admin/avatar-reports/{bob_id}/dismiss", headers=op_h))
    assert dismissed.status_code == 200, dismissed.text
    assert (await client.get(f"/api/avatars/{bob_avatar}")).status_code == 200  # dismiss keeps the avatar
    public_bodies.append((await client.get(f"/api/avatars/{bob_avatar}")).content)

    # --- the upload switch: off refuses uploads and reads, the user's own delete still works; on again
    su_h = await login_as(app, client, "superadmin", username="superadmin1")
    assert (await client.post("/api/admin/step-up", headers=su_h, json={"password": ADMIN_PASSWORD})).status_code == 200
    r = keep(await client.patch("/api/admin/settings", headers=su_h, json={
        "changes": {"avatar_upload_enabled": False}, "reason": "sweep switch off"}))
    assert r.status_code == 200, r.text
    assert (await client.get(f"/api/avatars/{carol_avatar}")).status_code == 404
    refused = keep(await client.post("/api/me/avatar", headers=carol_h,
                                     files={"file": (FILE_NAME, marked_jpeg(), "image/jpeg")}))
    assert refused.status_code == 403
    assert (await client.delete("/api/me/avatar", headers=carol_h)).status_code == 204
    r = keep(await client.patch("/api/admin/settings", headers=su_h, json={
        "changes": {"avatar_upload_enabled": True}, "reason": "sweep switch on"}))
    assert r.status_code == 200, r.text

    # --- admin user deletion removes bob's file and every report row that names bob
    deleted = keep(await client.request("DELETE", f"/api/admin/users/{bob_id}", headers=su_h,
                                        json={"confirm_username": BOB, "reason": "sweep delete"}))
    assert deleted.status_code == 200, deleted.text
    assert not path_for(app.state.settings, bob_avatar).exists()
    async with app.state.sessionmaker() as s:
        assert (await s.scalar(select(AvatarReport).where(AvatarReport.avatar_user_id == bob_id).limit(1))) is None
        assert (await s.scalar(select(AvatarReport).where(AvatarReport.reporter_id == bob_id).limit(1))) is None
        audit_rows = (await s.scalars(select(AdminAudit))).all()
        revision_rows = (await s.scalars(select(SettingRevision))).all()
    assert {row.action for row in audit_rows} >= {"user.avatar.remove", "user.avatar.dismiss", "user.delete"}
    assert revision_rows, "the switch must have written settings revisions"

    # --- the sweep: no distinctive value in any corpus
    def rows_text(rows, model) -> str:
        return json.dumps([{c.name: getattr(row, c.name) for c in model.__table__.columns} for row in rows],
                          default=str, ensure_ascii=False)

    user_audit = [row for row in audit_rows if row.action != "user.delete"]  # the deletion summary keeps the username
    corpora = {
        "caplog": caplog.text,
        "log_buffer": "\n".join(e.message for e in log_buffer.query(limit=2000)),
        "error_bodies": "\n".join(errors),
        "audit_rows": rows_text(audit_rows, AdminAudit),
        "audit_rows_without_delete": rows_text(user_audit, AdminAudit),
        "revision_rows": rows_text(revision_rows, SettingRevision),
    }
    markers = {"exif_marker": MARK_EXIF, "comment_marker": MARK_COMMENT, "file_name": FILE_NAME,
               "nickname": NICK, "email": ALICE_EMAIL, "alice_username": ALICE, "carol_username": CAROL,
               "password": PASSWORD, "reason_admin": REASON_ADMIN}
    storage = {"data_dir": str(tmp_path), "data_dir_json": json.dumps(str(tmp_path))[1:-1]}
    for part, text in corpora.items():
        lowered = text.lower()
        for label, value in markers.items():
            if label == "reason_admin" and part in ("audit_rows", "audit_rows_without_delete"):
                continue  # the operator's own note, kept in the audit by design
            assert value.lower() not in lowered, f"{label} leaked into {part}"
        if part != "audit_rows":  # the deletion summary names the deleted account (pre-existing audit text)
            assert BOB.lower() not in lowered, f"bob_username leaked into {part}"
        for label, value in storage.items():
            assert value not in text, f"{label} leaked into {part}"
        for aid in issued:
            assert aid not in text, f"an avatar id leaked into {part}"
    assert REASON_ADMIN in corpora["audit_rows"], "the admin remove reason must reach its audit row"
    for body in public_bodies:
        assert MARK_EXIF.encode() not in body and MARK_COMMENT.encode() not in body


def test_avatar_routes_carry_only_ids_in_their_paths(app):
    """Avatar routes take an unguessable id or a numeric user id in the path, never free text (the same rule as the
    library, changelog and agents privacy tests). Read from the OpenAPI document, which flattens the included routers."""
    allowed = {"avatar_id", "user_id"}
    paths = [p for p in app.openapi()["paths"] if "avatar" in p]
    assert len(paths) >= 6, paths
    for path in paths:
        params = {part[1:-1] for part in path.split("/") if part.startswith("{") and part.endswith("}")}
        assert params <= allowed, f"{path} has an unexpected path parameter"
