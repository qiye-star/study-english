import logging

import pytest
from sqlalchemy import func, select

from app.models import AccessToken, AdminAudit, Room, RoomMember, RoomMessage, SpeechToken, User
from tests.admin_helpers import ADMIN_ENABLED, PASSWORD, login_as
from tests.test_admin_api import register, seed_assessment


@pytest.fixture
def settings_overrides(tmp_path):
    return {**ADMIN_ENABLED, "data_dir": str(tmp_path / "data"), "rooms_enabled": True}


async def test_disable_blocks_login_tokens_and_enable_restores(app, client):
    uid, headers = await register(client, "alice")
    async with app.state.sessionmaker() as s:
        s.add(SpeechToken(user_id=uid, purpose="assessment", state="issued"))
        await s.commit()
    h = await login_as(app, client, "operator")
    r = await client.post(f"/api/admin/users/{uid}/disable", headers=h, json={"reason": "滥用"})
    assert r.status_code == 200 and r.json()["revoked"] >= 1 and r.json()["disabled_at"]
    assert (await client.get("/api/me", headers=headers)).status_code == 401  # token revoked
    async with app.state.sessionmaker() as s:
        assert await s.scalar(select(func.count()).select_from(SpeechToken).where(SpeechToken.user_id == uid)) == 0
    r = await client.post("/api/sessions", json={"provider": "password", "username": "alice", "password": "password123"})
    assert r.status_code == 403 and r.json() == {"error": "Account disabled"}  # no new token (review M1)
    listing = (await client.get("/api/admin/users", params={"status": "disabled"})).json()
    assert [u["id"] for u in listing["users"]] == [uid] and listing["users"][0]["disabled_at"]
    assert (await client.post(f"/api/admin/users/{uid}/enable", headers=h, json={"reason": "申诉通过"})).status_code == 200
    listing = (await client.get("/api/admin/users", params={"status": "disabled"})).json()
    assert listing["users"] == []
    async with app.state.sessionmaker() as s:
        actions = [a.action for a in (await s.scalars(select(AdminAudit).order_by(AdminAudit.id))).all()]
    assert "user.disable" in actions and "user.enable" in actions


async def test_disable_needs_reason_and_unknown_user_is_404(app, client):
    uid, _ = await register(client, "erin")
    h = await login_as(app, client, "operator")
    assert (await client.post(f"/api/admin/users/{uid}/disable", headers=h, json={"reason": ""})).status_code == 422
    assert (await client.post("/api/admin/users/99999999/disable", headers=h, json={"reason": "x y"})).status_code == 404


async def test_revoke_tokens_logs_out_everywhere(app, client):
    uid, headers = await register(client, "fay")
    h = await login_as(app, client, "operator")
    r = await client.post(f"/api/admin/users/{uid}/revoke-tokens", headers=h)
    assert r.status_code == 200 and r.json() == {"revoked": 1}
    assert (await client.get("/api/me", headers=headers)).status_code == 401


async def test_reset_password_returns_once_and_is_never_logged(app, client, caplog):
    uid, _ = await register(client, "bob")
    h = await login_as(app, client, "operator")
    caplog.set_level(logging.DEBUG)
    r = await client.post(f"/api/admin/users/{uid}/reset-password", headers=h)
    password = r.json()["password"]
    assert r.status_code == 200 and len(password) == 16 and r.headers["cache-control"] == "no-store"
    assert password not in caplog.text
    async with app.state.sessionmaker() as s:
        audits = [(a.after, a.summary, a.reason) for a in (await s.scalars(select(AdminAudit))).all()]
        assert await s.scalar(select(func.count()).select_from(AccessToken).where(AccessToken.user_id == uid)) == 0
    assert password not in str(audits)
    r = await client.post("/api/sessions", json={"provider": "password", "username": "bob", "password": password})
    assert r.status_code == 200


async def test_delete_user_needs_superadmin_step_up_and_exact_username(app, client):
    uid, _ = await register(client, "carol")
    await seed_assessment(app, uid)
    h = await login_as(app, client, "superadmin")
    body = {"confirm_username": "carol", "reason": "用户要求注销"}
    assert (await client.request("DELETE", f"/api/admin/users/{uid}", headers=h, json=body)).status_code == 403
    await client.post("/api/admin/step-up", headers=h, json={"password": PASSWORD})
    r = await client.request("DELETE", f"/api/admin/users/{uid}", headers=h, json={**body, "confirm_username": "carl"})
    assert r.status_code == 409
    r = await client.request("DELETE", f"/api/admin/users/{uid}", headers=h, json=body)
    assert r.status_code == 200 and r.json()["recordings_bytes"] > 0
    async with app.state.sessionmaker() as s:
        assert await s.get(User, uid) is None
        audit = await s.scalar(select(AdminAudit).where(AdminAudit.action == "user.delete"))
    assert audit.target_id == str(uid) and "carol" in audit.summary
    assert not (app.state.settings.resolved_data_dir / "recordings" / str(uid)).exists()


async def test_delete_room_owner_keeps_shared_rooms_and_their_messages(app, client):
    alice, ha = await register(client, "alice")
    bob, hb = await register(client, "bob")
    shared = (await client.post("/api/rooms", headers=ha, json={"topic": "美食"})).json()["room"]
    await client.post("/api/rooms/join", headers=hb, json={"code": shared["code"]})
    solo = (await client.post("/api/rooms", headers=ha, json={"topic": "独自"})).json()["room"]
    async with app.state.sessionmaker() as s:
        s.add(RoomMessage(room_id=solo["id"], seq=1, lane="public", sender_kind="user", sender_id=alice, kind="text",
                          text="only me", assisted=False))
        await s.commit()
    h = await login_as(app, client, "superadmin")
    await client.post("/api/admin/step-up", headers=h, json={"password": PASSWORD})
    r = await client.request("DELETE", f"/api/admin/users/{alice}", headers=h,
                             json={"confirm_username": "alice", "reason": "用户要求注销"})
    assert r.status_code == 200, r.text
    async with app.state.sessionmaker() as s:
        room = await s.get(Room, shared["id"])
        assert room.owner_id == bob and room.status == "closed" and room.close_reason == "admin"
        assert await s.scalar(select(func.count()).select_from(RoomMessage)
                              .where(RoomMessage.room_id == shared["id"])) >= 1  # kept (R-6)
        assert await s.scalar(select(func.count()).select_from(RoomMember).where(RoomMember.user_id == alice)) == 0
        # owner ruling: rooms and their messages are kept forever; a room nobody else joined stays as a closed,
        # read-only room without owner (shown as 已删除用户)
        kept = await s.get(Room, solo["id"])
        assert kept is not None and kept.owner_id is None and kept.status == "closed" and kept.code is None
        assert await s.scalar(select(func.count()).select_from(RoomMessage).where(RoomMessage.room_id == solo["id"])) == 1
        assert await s.scalar(select(func.count()).select_from(RoomMember).where(RoomMember.room_id == solo["id"])) == 0
    detail = (await client.get(f"/api/admin/rooms/{solo['id']}")).json()
    assert detail["owner"] == {"id": None, "name": None} and detail["status"] == "closed"
    listed = (await client.get("/api/admin/rooms", params={"status": "closed"})).json()
    assert solo["id"] in str(listed)


async def test_viewer_cannot_moderate(app, client):
    uid, _ = await register(client, "dave")
    h = await login_as(app, client, "viewer")
    assert (await client.post(f"/api/admin/users/{uid}/disable", headers=h, json={"reason": "x"})).status_code == 403


async def test_operator_cannot_delete(app, client):
    uid, _ = await register(client, "gil")
    h = await login_as(app, client, "operator")
    r = await client.request("DELETE", f"/api/admin/users/{uid}", headers=h,
                             json={"confirm_username": "gil", "reason": "测试测试"})
    assert r.status_code == 403


async def test_user_list_sort_and_status(app, client):
    a, _ = await register(client, "aa1")
    b, _ = await register(client, "bb2")
    await seed_assessment(app, b)
    await login_as(app, client, "viewer")
    by_storage = (await client.get("/api/admin/users", params={"sort": "storage"})).json()["users"]
    assert [u["id"] for u in by_storage][:1] == [b]
    active = (await client.get("/api/admin/users", params={"status": "active"})).json()
    assert {u["id"] for u in active["users"]} == {a, b} and active["total"] == 2
    assert all(u["disabled_at"] is None for u in active["users"])


async def test_delete_user_leaves_no_rows_with_their_id_but_keeps_usage_totals(app, client):
    """Review security m9: snapshots and metering rows kept the deleted user's id and activity."""
    from datetime import datetime, timezone

    from app.models import RankProfileSnapshot, UpstreamCall, UsageDaily

    uid, _ = await register(client, "dora")
    now = datetime.now(timezone.utc)
    bucket = dict(day="2026-10-09", feature="chat", kind="llm", provider="p", model="m")
    async with app.state.sessionmaker() as s:
        s.add(RankProfileSnapshot(batch_id="usr-" + "0" * 32, user_id=uid, data={"tier": 1}, at=now))
        s.add(UpstreamCall(at=now, user_id=uid, feature="chat", kind="llm", provider="p", model="m", status=200, ms=5,
                           units_in=3, units_out=4, unit="tokens"))
        s.add(UsageDaily(**bucket, user_id=uid, calls=2, errors=0, units_in=6, units_out=8, ms_total=10))
        s.add(UsageDaily(**bucket, user_id=0, calls=1, errors=1, units_in=1, units_out=1, ms_total=1))
        await s.commit()
    h = await login_as(app, client, "superadmin")
    await client.post("/api/admin/step-up", headers=h, json={"password": PASSWORD})
    r = await client.request("DELETE", f"/api/admin/users/{uid}", headers=h,
                             json={"confirm_username": "dora", "reason": "用户要求注销"})
    assert r.status_code == 200, r.text
    async with app.state.sessionmaker() as s:
        assert await s.scalar(select(func.count()).select_from(RankProfileSnapshot).where(RankProfileSnapshot.user_id == uid)) == 0
        assert await s.scalar(select(func.count()).select_from(UpstreamCall).where(UpstreamCall.user_id == uid)) == 0
        assert await s.scalar(select(func.count()).select_from(UsageDaily).where(UsageDaily.user_id == uid)) == 0
        assert await s.scalar(select(func.count()).select_from(UpstreamCall)) == 1  # cost history stays, anonymised
        merged = (await s.scalars(select(UsageDaily))).all()
    assert [(u.user_id, u.calls, u.units_in) for u in merged] == [(0, 3, 7)]


# ---- deleting a user removes every row that references them (SQLite enforces no FK cascade) ----

def _user_foreign_keys():
    """(table, column, ondelete) for every column of the models that references users.id."""
    from app.core.db import Base
    out = set()
    for table in Base.metadata.sorted_tables:
        for fk in table.foreign_keys:
            if fk.column.table.name == "users" and fk.column.name == "id":
                out.add((table.name, fk.parent.name, (fk.ondelete or "").upper()))
    return out


def test_delete_user_handles_every_table_that_references_users():
    """A table with a CASCADE (or SET NULL) foreign key to users must be deleted (or nulled) explicitly by
    delete_user, so SQLite ends where Postgres' ON DELETE semantics end. A new table cannot be forgotten."""
    from app.admin import users_admin
    handled_delete = {(m.__tablename__, col) for m, col in users_admin.USER_ROWS}
    handled_null = {(m.__tablename__, col) for m, col in users_admin.USER_REFS_NULLED}
    for table, column, ondelete in _user_foreign_keys():
        if table == "users":
            continue
        if ondelete == "CASCADE":
            assert (table, column) in handled_delete, f"{table}.{column} is not deleted with the user"
        elif ondelete == "SET NULL":
            assert (table, column) in handled_null, f"{table}.{column} is not cleared with the user"
        else:
            raise AssertionError(f"{table}.{column} references users without ON DELETE")


async def test_delete_user_removes_wordbook_and_link_rows_but_not_other_users(app, client):
    from app.models import (LinkCredit, LinkMistakeWord, LinkWeakWord, LinkWordUse, RoomJoinRequest, UserLinkPref,
                            VocabularyItem, WordbookEnrollment, WordbookEvent, WordbookReport, utcnow)

    async def seed(uid, room_id):
        now = utcnow()
        async with app.state.sessionmaker() as s:
            s.add(WordbookEnrollment(user_id=uid, book_id="junior", status="active", order_mode="shuffle", seed=1,
                                     cursor=3, daily_new=10, review_cap=100, started_at=now, updated_at=now))
            s.add(WordbookEvent(user_id=uid, book_id="junior", kind="learn", word="talk", item_id=None, qtype=None,
                                outcome="know", credit=100, day="2026-10-11", created_at=now))
            s.add(WordbookReport(user_id=uid, book_id="junior", word="talk", sentence_id="s1", kind="sentence",
                                 reason="wrong", status="open", created_at=now))
            s.add(VocabularyItem(user_id=uid, word="talk", source="wordbook:junior", box=0, due_at=now))
            s.add(UserLinkPref(user_id=uid, link_key="mistakes", enabled=False, updated_at=now))
            s.add(LinkMistakeWord(user_id=uid, word="talk", book_id="junior", wrong_count=1, ok_streak=0,
                                  last_event_at=now, last_wrong_at=now, cleared_at=None))
            s.add(LinkWeakWord(user_id=uid, word="three", hits=1, last_score=40, ok_streak=0, last_event_at=now,
                               last_weak_at=now, cleared_at=None))
            s.add(LinkWordUse(user_id=uid, word="talk", learn_event_id=1, message_id="m1", created_at=now))
            s.add(LinkCredit(user_id=uid, kind="word_in_chat", ref_id="wic:1", score=None, created_at=now))
            s.add(RoomJoinRequest(room_id=room_id, user_id=uid, status="pending", created_at=now))
            await s.commit()

    uid, ha = await register(client, "dora")
    other, hb = await register(client, "erin")
    room = (await client.post("/api/rooms", headers=hb, json={"topic": "美食"})).json()["room"]
    await seed(uid, room["id"])
    await seed(other, room["id"])
    h = await login_as(app, client, "superadmin")
    await client.post("/api/admin/step-up", headers=h, json={"password": PASSWORD})
    r = await client.request("DELETE", f"/api/admin/users/{uid}", headers=h,
                             json={"confirm_username": "dora", "reason": "用户要求注销"})
    assert r.status_code == 200, r.text
    owned = (WordbookEnrollment, WordbookEvent, VocabularyItem, UserLinkPref, LinkMistakeWord, LinkWeakWord,
             LinkWordUse, LinkCredit, RoomJoinRequest)
    async with app.state.sessionmaker() as s:
        for model in owned:
            assert await s.scalar(select(func.count()).select_from(model).where(model.user_id == uid)) == 0, model
            assert await s.scalar(select(func.count()).select_from(model).where(model.user_id == other)) >= 1, model
        reports = (await s.scalars(select(WordbookReport).order_by(WordbookReport.id))).all()
    # the report about the book's content stays for moderation, without the deleted user's id (ON DELETE SET NULL)
    assert [r.user_id for r in reports] == [None, other]


async def test_delete_user_removes_their_email_identity_and_every_code_for_that_address(app, client):
    """Plan S22: codes are deleted by target (a `reset` row has no user_id), other users' rows stay."""
    from app.models import UserIdentity, VerificationCode
    from tests.accounts_helpers import bind, enable_email, mail_code

    enable_email(app)
    mail = "erin.gone@example.com"
    other_mail = "frank.stays@example.com"
    uid, _ = await register(client, "erin")
    other, _ = await register(client, "frank")
    await bind(app, uid, mail)
    await bind(app, other, other_mail)
    await mail_code(app, client, mail, "reset")  # a real reset code (carries the user's id) ...
    assert (await client.post("/api/email/code", json={"email": mail, "purpose": "register"})).status_code == 200
    assert (await client.post("/api/email/code", json={"email": other_mail, "purpose": "register"})).status_code == 200
    # ... and the hidden "already registered" row, which has no user_id and is found only by its target
    async with app.state.sessionmaker() as s:
        from app.services.identities import subject_hmac
        gone = subject_hmac(app.state.settings.identity_pepper, mail)
        kept = subject_hmac(app.state.settings.identity_pepper, other_mail)
        assert await s.scalar(select(func.count()).select_from(VerificationCode).where(
            VerificationCode.target_hmac == gone, VerificationCode.user_id.is_(None))) == 1
    h = await login_as(app, client, "superadmin")
    await client.post("/api/admin/step-up", headers=h, json={"password": PASSWORD})
    r = await client.request("DELETE", f"/api/admin/users/{uid}", headers=h,
                             json={"confirm_username": "erin", "reason": "用户要求注销"})
    assert r.status_code == 200, r.text
    async with app.state.sessionmaker() as s:
        assert await s.scalar(select(func.count()).select_from(VerificationCode).where(
            VerificationCode.target_hmac == gone)) == 0
        assert await s.scalar(select(func.count()).select_from(VerificationCode).where(
            VerificationCode.user_id == uid)) == 0
        assert await s.scalar(select(func.count()).select_from(UserIdentity).where(UserIdentity.user_id == uid)) == 0
        assert await s.scalar(select(func.count()).select_from(VerificationCode).where(
            VerificationCode.target_hmac == kept)) >= 1
        assert await s.scalar(select(func.count()).select_from(UserIdentity).where(UserIdentity.user_id == other)) == 1
        audit = await s.scalar(select(AdminAudit).where(AdminAudit.action == "user.delete"))
    assert mail not in repr(audit.after) and mail not in audit.summary and "gone" not in repr(audit.after)
