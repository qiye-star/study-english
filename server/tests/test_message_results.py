import datetime
import os
import pathlib
import uuid

import pytest
from sqlalchemy import select

from app.services import recordings
from app.models import Assessment, Message
from app.services.recordings import recording_relpath, write_recording
from tests.test_assessments_api import SCORES, make_wav

GRAMMAR = {"has_errors": True, "corrected": "She doesn't like it.",
           "errors": [{"original": "don't", "corrected": "doesn't", "category": "agreement", "explanation": "三单"}]}
WORDS = [{"word": "she", "pronunciation_assessment": {"accuracy_score": 95.0, "error_type": "None"}},
         {"word": "like", "pronunciation_assessment": {"accuracy_score": 40.0, "error_type": "Mispronunciation"}}]


@pytest.fixture
def settings_overrides(tmp_path):
    return {"data_dir": str(tmp_path / "data")}


async def register(client, username):
    r = await client.post("/api/users", json={"username": username, "password": "password123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def uid(client, headers) -> int:
    return int((await client.get("/api/me", headers=headers)).json()["id"])


async def seed_assessment(app, user_id: int, source="chat") -> tuple[str, pathlib.Path]:
    aid = str(uuid.uuid4())
    rel = recording_relpath(user_id, aid)
    wav = make_wav()
    data_dir = app.state.settings.resolved_data_dir
    await write_recording(app.state.storage, rel, wav)
    async with app.state.sessionmaker() as s:
        s.add(Assessment(id=aid, user_id=user_id, reference_text="She don't like it.", language="en-US", duration_ms=500,
                         audio_bytes=len(wav), scores=SCORES, result={**SCORES, "detail_result": {"words": WORDS}},
                         audio_path=rel, source=source))
        await s.commit()
    return aid, data_dir / rel


async def conversation(client, headers) -> str:
    return (await client.post("/api/conversations", headers=headers, json={})).json()["id"]


async def post_messages(client, headers, cid, *messages):
    return await client.post(f"/api/conversations/{cid}/messages", headers=headers, json={"messages": list(messages)})


async def assessment_exists(app, aid) -> bool:
    async with app.state.sessionmaker() as s:
        return await s.get(Assessment, aid) is not None


@pytest.mark.parametrize("method,path", [("PATCH", "/api/messages/x")])
async def test_requires_login(client, method, path):
    assert (await client.request(method, path, json={"grammar": GRAMMAR})).status_code == 401


async def test_pair_saved_with_results_round_trips(app, client, auth_headers):
    aid, _ = await seed_assessment(app, await uid(client, auth_headers))
    cid = await conversation(client, auth_headers)
    r = await post_messages(client, auth_headers, cid,
                            {"role": "user", "content": "She don't like it.", "assessment_id": aid, "grammar": GRAMMAR},
                            {"role": "assistant", "content": "Why not?"})
    assert r.status_code == 200, r.text
    user, bot = r.json()["messages"]
    assert user["assessment_id"] == aid and user["grammar"] == GRAMMAR
    assert user["assessment"] == {"id": aid, "scores": SCORES, "words": [
        {"word": "she", "accuracy_score": 95.0, "error_type": "None"},
        {"word": "like", "accuracy_score": 40.0, "error_type": "Mispronunciation"}]}
    assert bot["assessment_id"] is None and bot["grammar"] is None and bot["assessment"] is None
    listed = (await client.get(f"/api/conversations/{cid}/messages", headers=auth_headers)).json()["messages"]
    assert listed == [user, bot]


@pytest.mark.parametrize("field", [{"grammar": GRAMMAR}, {"assessment_id": "x"}])
async def test_results_only_on_user_messages(client, auth_headers, field):
    cid = await conversation(client, auth_headers)
    r = await post_messages(client, auth_headers, cid, {"role": "assistant", "content": "She don't like it.", **field})
    assert r.status_code == 422 and r.json() == {"error": "Only user messages can carry assessment or grammar"}


async def test_assessment_must_belong_to_the_user(app, client, auth_headers):
    bob = await register(client, "bob")
    bobs, _ = await seed_assessment(app, await uid(client, bob))
    cid = await conversation(client, auth_headers)
    for aid in (bobs, "missing"):
        r = await post_messages(client, auth_headers, cid, {"role": "user", "content": "hi", "assessment_id": aid})
        assert r.status_code == 404 and r.json() == {"error": "Assessment not found"}
    assert (await client.get(f"/api/conversations/{cid}/messages", headers=auth_headers)).json()["messages"] == []


async def test_grammar_is_validated_and_normalized(client, auth_headers):
    cid = await conversation(client, auth_headers)
    r = await post_messages(client, auth_headers, cid, {"role": "user", "content": "hi there", "grammar": {"errors": "x"}})
    assert r.status_code == 422 and r.json() == {"error": "Invalid grammar result"}
    r = await post_messages(client, auth_headers, cid, {"role": "user", "content": "hi there", "grammar": GRAMMAR})
    assert r.json()["messages"][0]["grammar"] == {"has_errors": False, "corrected": "hi there", "errors": []}


async def test_patch_adds_late_results(app, client, auth_headers):
    aid, _ = await seed_assessment(app, await uid(client, auth_headers))
    cid = await conversation(client, auth_headers)
    user, _ = (await post_messages(client, auth_headers, cid, {"role": "user", "content": "She don't like it."},
                                   {"role": "assistant", "content": "Why?"})).json()["messages"]
    r = await client.patch(f"/api/messages/{user['id']}", headers=auth_headers, json={"grammar": GRAMMAR})
    assert r.status_code == 200 and r.json()["grammar"] == GRAMMAR and r.json()["assessment_id"] is None
    r = await client.patch(f"/api/messages/{user['id']}", headers=auth_headers, json={"assessment_id": aid})
    assert r.status_code == 200
    assert r.json()["assessment_id"] == aid and r.json()["assessment"]["scores"] == SCORES and r.json()["grammar"] == GRAMMAR
    assert (await client.patch(f"/api/messages/{user['id']}", headers=auth_headers, json={"assessment_id": aid})).status_code == 200
    listed = (await client.get(f"/api/conversations/{cid}/messages", headers=auth_headers)).json()["messages"]
    assert listed[0]["assessment_id"] == aid and listed[0]["grammar"] == GRAMMAR


async def test_patch_rules(app, client, auth_headers):
    me = await uid(client, auth_headers)
    first, _ = await seed_assessment(app, me)
    second, _ = await seed_assessment(app, me)
    cid = await conversation(client, auth_headers)
    user, bot = (await post_messages(client, auth_headers, cid, {"role": "user", "content": "She don't like it.", "assessment_id": first},
                                     {"role": "assistant", "content": "Why?"})).json()["messages"]
    patch = lambda mid, body: client.patch(f"/api/messages/{mid}", headers=auth_headers, json=body)  # noqa: E731
    r = await patch(user["id"], {"assessment_id": second})
    assert r.status_code == 409 and r.json() == {"error": "Message already has an assessment"}
    r = await patch(user["id"], {})
    assert r.status_code == 400 and r.json() == {"error": "Nothing to update"}
    r = await patch(user["id"], {"assessment_id": None, "grammar": None})
    assert r.status_code == 400
    assert (await patch(user["id"], {"content": "changed"})).status_code == 422
    r = await patch(bot["id"], {"grammar": GRAMMAR})
    assert r.status_code == 422 and r.json() == {"error": "Only user messages can carry assessment or grammar"}
    r = await patch(user["id"], {"grammar": ["x"]})
    assert r.status_code == 422
    r = await patch(user["id"], {"grammar": {"errors": [1]}})
    assert r.status_code == 422 and r.json() == {"error": "Invalid grammar result"}


async def test_patch_isolation(app, client, auth_headers):
    cid = await conversation(client, auth_headers)
    user = (await post_messages(client, auth_headers, cid, {"role": "user", "content": "She don't like it."})).json()["messages"][0]
    bob = await register(client, "bob")
    r = await client.patch(f"/api/messages/{user['id']}", headers=bob, json={"grammar": GRAMMAR})
    assert r.status_code == 404 and r.json() == {"error": "Message not found"}
    bobs, _ = await seed_assessment(app, await uid(client, bob))
    r = await client.patch(f"/api/messages/{user['id']}", headers=auth_headers, json={"assessment_id": bobs})
    assert r.status_code == 404 and r.json() == {"error": "Assessment not found"}


async def test_deleting_a_message_deletes_its_chat_assessment_but_only_unlinks_practice(app, client, auth_headers):
    me = await uid(client, auth_headers)
    chat, chat_file = await seed_assessment(app, me, "chat")
    practice, practice_file = await seed_assessment(app, me, "practice")
    cid = await conversation(client, auth_headers)
    a, b = (await post_messages(client, auth_headers, cid, {"role": "user", "content": "one", "assessment_id": chat},
                                {"role": "user", "content": "two", "assessment_id": practice})).json()["messages"]
    assert (await client.delete(f"/api/messages/{a['id']}", headers=auth_headers)).status_code == 200
    assert not await assessment_exists(app, chat) and not chat_file.exists()
    assert (await client.delete(f"/api/messages/{b['id']}", headers=auth_headers)).status_code == 200
    assert await assessment_exists(app, practice) and practice_file.exists()


async def test_deleting_a_conversation_deletes_its_chat_assessments_and_files(app, client, auth_headers):
    me = await uid(client, auth_headers)
    keep, keep_file = await seed_assessment(app, me, "chat")
    gone = [await seed_assessment(app, me, "chat") for _ in range(2)]
    cid, other = await conversation(client, auth_headers), await conversation(client, auth_headers)
    await post_messages(client, auth_headers, cid, *[{"role": "user", "content": "x", "assessment_id": aid} for aid, _ in gone])
    await post_messages(client, auth_headers, other, {"role": "user", "content": "x", "assessment_id": keep})
    assert (await client.delete(f"/api/conversations/{cid}", headers=auth_headers)).status_code == 200
    for aid, path in gone:
        assert not await assessment_exists(app, aid) and not path.exists()
    assert await assessment_exists(app, keep) and keep_file.exists()
    async with app.state.sessionmaker() as s:
        assert await recordings.used_bytes(s, me) == keep_file.stat().st_size


async def test_file_removal_failure_still_deletes_rows_and_frees_quota(app, client, auth_headers, monkeypatch):
    me = await uid(client, auth_headers)
    aid, path = await seed_assessment(app, me, "chat")
    cid = await conversation(client, auth_headers)
    await post_messages(client, auth_headers, cid, {"role": "user", "content": "x", "assessment_id": aid})

    def refuse(self, missing_ok=False):
        raise PermissionError("locked")

    monkeypatch.setattr(pathlib.Path, "unlink", refuse)
    assert (await client.delete(f"/api/conversations/{cid}", headers=auth_headers)).status_code == 200
    monkeypatch.undo()
    assert not await assessment_exists(app, aid)
    async with app.state.sessionmaker() as s:
        assert await recordings.used_bytes(s, me) == 0
    assert path.exists()  # 残留文件只占磁盘,不计配额(文档已注明)


async def test_deleting_an_assessment_unlinks_messages(app, client, auth_headers):
    aid, _ = await seed_assessment(app, await uid(client, auth_headers), "practice")
    cid = await conversation(client, auth_headers)
    await post_messages(client, auth_headers, cid, {"role": "user", "content": "x", "assessment_id": aid})
    assert (await client.delete(f"/api/assessments/{aid}", headers=auth_headers)).status_code == 200
    listed = (await client.get(f"/api/conversations/{cid}/messages", headers=auth_headers)).json()["messages"]
    assert listed[0]["assessment_id"] is None and listed[0]["assessment"] is None
    async with app.state.sessionmaker() as s:
        assert (await s.execute(select(Message.assessment_id))).scalars().all() == [None]


# --- additional hardening / Task 1.5 deferred regressions ---


async def test_deleting_a_conversation_with_many_linked_messages_stays_under_sqlite_limits(app, client, auth_headers):
    me = await uid(client, auth_headers)
    cid = await conversation(client, auth_headers)
    n = 1200
    now = datetime.datetime.now(datetime.timezone.utc)
    async with app.state.sessionmaker() as s:
        for i in range(n):
            aid = str(uuid.uuid4())
            s.add(Assessment(id=aid, user_id=me, reference_text="x", language="en-US", duration_ms=1, audio_bytes=1,
                             scores=SCORES, result={}, audio_path=f"missing/{aid}.wav", source="chat"))
            s.add(Message(id=str(uuid.uuid4()), conversation_id=cid, role="user", content="x", created_at=now,
                          assessment_id=aid))
        await s.commit()
    assert (await client.delete(f"/api/conversations/{cid}", headers=auth_headers)).status_code == 200
    async with app.state.sessionmaker() as s:
        assert (await s.execute(select(Assessment.id))).scalars().all() == []
        assert (await s.execute(select(Message.id))).scalars().all() == []


async def test_deleting_does_not_touch_other_users_assessments(app, client, auth_headers):
    bob = await register(client, "bob")
    bobs, bobs_file = await seed_assessment(app, await uid(client, bob), "chat")
    cid = await conversation(client, auth_headers)
    # forge a link to another user's assessment at the DB level
    r = await post_messages(client, auth_headers, cid, {"role": "user", "content": "x"})
    mid = r.json()["messages"][0]["id"]
    async with app.state.sessionmaker() as s:
        (await s.get(Message, mid)).assessment_id = bobs
        await s.commit()
    assert (await client.delete(f"/api/conversations/{cid}", headers=auth_headers)).status_code == 200
    assert await assessment_exists(app, bobs) and bobs_file.exists()


async def test_chat_assessment_detail_and_source_filtering(app, client, auth_headers):
    me = await uid(client, auth_headers)
    chat_ids = [(await seed_assessment(app, me, "chat"))[0] for _ in range(3)]
    practice, _ = await seed_assessment(app, me, "practice")
    bob = await register(client, "bob")
    bobs, _ = await seed_assessment(app, await uid(client, bob), "chat")

    detail = await client.get(f"/api/assessments/{chat_ids[0]}", headers=auth_headers)
    assert detail.status_code == 200 and detail.json()["id"] == chat_ids[0]

    page1 = (await client.get("/api/assessments?source=chat&per_page=2", headers=auth_headers)).json()
    assert len(page1["assessments"]) == 2 and page1["next"] == 2
    page2 = (await client.get("/api/assessments?source=chat&per_page=2&page=2", headers=auth_headers)).json()
    assert len(page2["assessments"]) == 1 and page2["next"] is None
    got = {a["id"] for a in page1["assessments"] + page2["assessments"]}
    assert got == set(chat_ids)

    everything = (await client.get("/api/assessments?source=all", headers=auth_headers)).json()["assessments"]
    assert {a["id"] for a in everything} == set(chat_ids) | {practice}
    assert bobs not in {a["id"] for a in everything} | got


# --- review fix round 1 ---
from app.routers import conversations as conv_router  # noqa: E402


async def force_link(app, message_id, assessment_id):
    async with app.state.sessionmaker() as s:
        (await s.get(Message, message_id)).assessment_id = assessment_id
        await s.commit()


async def test_empty_assessment_id_is_rejected(client, auth_headers):
    cid = await conversation(client, auth_headers)
    r = await post_messages(client, auth_headers, cid, {"role": "user", "content": "hi", "assessment_id": ""})
    assert r.status_code == 422
    user = (await post_messages(client, auth_headers, cid, {"role": "user", "content": "hi"})).json()["messages"][0]
    assert (await client.patch(f"/api/messages/{user['id']}", headers=auth_headers, json={"assessment_id": ""})).status_code == 422


async def test_assessment_can_be_linked_to_one_message_only(app, client, auth_headers):
    aid, _ = await seed_assessment(app, await uid(client, auth_headers))
    cid = await conversation(client, auth_headers)
    first = (await post_messages(client, auth_headers, cid, {"role": "user", "content": "one", "assessment_id": aid})).json()["messages"][0]
    r = await post_messages(client, auth_headers, cid, {"role": "user", "content": "two", "assessment_id": aid})
    assert r.status_code == 409
    r = await post_messages(client, auth_headers, cid, {"role": "user", "content": "a", "assessment_id": aid},
                            {"role": "user", "content": "b", "assessment_id": aid})
    assert r.status_code == 409
    other = (await post_messages(client, auth_headers, cid, {"role": "user", "content": "three"})).json()["messages"][0]
    r = await client.patch(f"/api/messages/{other['id']}", headers=auth_headers, json={"assessment_id": aid})
    assert r.status_code == 409
    r = await client.patch(f"/api/messages/{first['id']}", headers=auth_headers, json={"assessment_id": aid})
    assert r.status_code == 200  # same message, same assessment: idempotent


async def test_cascade_keeps_assessment_still_referenced_by_a_surviving_message(app, client, auth_headers):
    aid, path = await seed_assessment(app, await uid(client, auth_headers), "chat")
    c1, c2 = await conversation(client, auth_headers), await conversation(client, auth_headers)
    a = (await post_messages(client, auth_headers, c1, {"role": "user", "content": "one", "assessment_id": aid})).json()["messages"][0]
    b = (await post_messages(client, auth_headers, c2, {"role": "user", "content": "two"})).json()["messages"][0]
    await force_link(app, b["id"], aid)
    assert (await client.delete(f"/api/messages/{a['id']}", headers=auth_headers)).status_code == 200
    assert await assessment_exists(app, aid) and path.exists()
    listed = (await client.get(f"/api/conversations/{c2}/messages", headers=auth_headers)).json()["messages"]
    assert listed[0]["assessment_id"] == aid
    assert (await client.delete(f"/api/conversations/{c2}", headers=auth_headers)).status_code == 200
    assert not await assessment_exists(app, aid) and not path.exists()


async def test_conversation_delete_keeps_assessment_referenced_from_another_conversation(app, client, auth_headers):
    aid, path = await seed_assessment(app, await uid(client, auth_headers), "chat")
    c1, c2 = await conversation(client, auth_headers), await conversation(client, auth_headers)
    await post_messages(client, auth_headers, c1, {"role": "user", "content": "one", "assessment_id": aid})
    b = (await post_messages(client, auth_headers, c2, {"role": "user", "content": "two"})).json()["messages"][0]
    await force_link(app, b["id"], aid)
    assert (await client.delete(f"/api/conversations/{c1}", headers=auth_headers)).status_code == 200
    assert await assessment_exists(app, aid) and path.exists()


async def test_patch_racing_a_message_delete_is_404(app, client, auth_headers, monkeypatch):
    cid = await conversation(client, auth_headers)
    user = (await post_messages(client, auth_headers, cid, {"role": "user", "content": "She don't like it."})).json()["messages"][0]
    real = conv_router.owned_message

    async def racing(session, u, mid):
        row = await real(session, u, mid)
        async with app.state.sessionmaker() as other:
            await other.execute(Message.__table__.delete().where(Message.id == mid))
            await other.commit()
        return row

    monkeypatch.setattr(conv_router, "owned_message", racing)
    r = await client.patch(f"/api/messages/{user['id']}", headers=auth_headers, json={"grammar": GRAMMAR})
    assert r.status_code == 404 and r.json() == {"error": "Message not found"}


async def test_patch_racing_an_assessment_delete_leaves_no_dangling_link(app, client, auth_headers, monkeypatch):
    aid, _ = await seed_assessment(app, await uid(client, auth_headers), "practice")
    cid = await conversation(client, auth_headers)
    user = (await post_messages(client, auth_headers, cid, {"role": "user", "content": "hi"})).json()["messages"][0]
    real = conv_router.owned_assessments

    async def racing(session, u, ids):
        found = await real(session, u, ids)
        async with app.state.sessionmaker() as other:
            await other.execute(Assessment.__table__.delete().where(Assessment.id == aid))
            await other.commit()
        return found

    monkeypatch.setattr(conv_router, "owned_assessments", racing)
    r = await client.patch(f"/api/messages/{user['id']}", headers=auth_headers, json={"assessment_id": aid})
    assert r.status_code == 404 and r.json() == {"error": "Assessment not found"}
    monkeypatch.undo()
    listed = (await client.get(f"/api/conversations/{cid}/messages", headers=auth_headers)).json()["messages"]
    assert listed[0]["assessment_id"] is None and listed[0]["assessment"] is None
    async with app.state.sessionmaker() as s:
        assert (await s.execute(select(Message.assessment_id))).scalars().all() == [None]


@pytest.mark.skipif("sqlite" not in os.environ.get("TEST_DATABASE_URL", "sqlite"), reason="FKs enforced: dangling impossible")
async def test_message_out_never_returns_a_dangling_assessment_id(app, client, auth_headers):
    cid = await conversation(client, auth_headers)
    m = (await post_messages(client, auth_headers, cid, {"role": "user", "content": "hi"})).json()["messages"][0]
    await force_link(app, m["id"], "ghost")
    listed = (await client.get(f"/api/conversations/{cid}/messages", headers=auth_headers)).json()["messages"]
    assert listed[0]["assessment_id"] is None and listed[0]["assessment"] is None


async def test_forged_links_to_another_users_assessment(app, client, auth_headers):
    bob = await register(client, "bob")
    bobs, bobs_file = await seed_assessment(app, await uid(client, bob), "chat")
    cid = await conversation(client, auth_headers)
    m = (await post_messages(client, auth_headers, cid, {"role": "user", "content": "x"})).json()["messages"][0]
    await force_link(app, m["id"], bobs)
    listed = (await client.get(f"/api/conversations/{cid}/messages", headers=auth_headers)).json()["messages"]
    assert listed[0]["assessment_id"] is None and listed[0]["assessment"] is None
    r = await client.patch(f"/api/messages/{m['id']}", headers=auth_headers, json={"grammar": GRAMMAR})
    assert r.status_code == 200 and r.json()["assessment_id"] is None and r.json()["assessment"] is None
    other = (await post_messages(client, auth_headers, cid, {"role": "user", "content": "y"})).json()["messages"][0]
    r = await client.patch(f"/api/messages/{other['id']}", headers=auth_headers, json={"assessment_id": bobs})
    assert r.status_code == 404
    assert (await client.delete(f"/api/messages/{m['id']}", headers=auth_headers)).status_code == 200
    assert await assessment_exists(app, bobs) and bobs_file.exists()


# --- review fix round 2: FK violations (Postgres) and dialect-aware dangling tests ---
import os  # noqa: E402

from sqlalchemy.exc import IntegrityError  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: E402

FKS_ENFORCED = not os.environ.get("TEST_DATABASE_URL", "sqlite").startswith("sqlite")


def fail_commit_once(monkeypatch):
    real = AsyncSession.commit
    state = {"raised": False}

    async def commit(self):
        if not state["raised"]:
            state["raised"] = True
            raise IntegrityError("INSERT", {}, Exception("FOREIGN KEY constraint failed"))
        return await real(self)

    monkeypatch.setattr(AsyncSession, "commit", commit)


async def test_post_fk_violation_on_write_is_404_with_no_partial_insert(app, client, auth_headers, monkeypatch):
    aid, _ = await seed_assessment(app, await uid(client, auth_headers))
    cid = await conversation(client, auth_headers)
    fail_commit_once(monkeypatch)
    r = await post_messages(client, auth_headers, cid, {"role": "user", "content": "hi", "assessment_id": aid},
                            {"role": "assistant", "content": "yo"})
    assert r.status_code == 404 and r.json() == {"error": "Assessment not found"}
    monkeypatch.undo()
    assert (await client.get(f"/api/conversations/{cid}/messages", headers=auth_headers)).json()["messages"] == []


async def test_patch_fk_violation_on_write_is_404_and_changes_nothing(app, client, auth_headers, monkeypatch):
    aid, _ = await seed_assessment(app, await uid(client, auth_headers))
    cid = await conversation(client, auth_headers)
    user = (await post_messages(client, auth_headers, cid, {"role": "user", "content": "She don't like it."})).json()["messages"][0]
    fail_commit_once(monkeypatch)
    r = await client.patch(f"/api/messages/{user['id']}", headers=auth_headers, json={"assessment_id": aid, "grammar": GRAMMAR})
    assert r.status_code == 404 and r.json() == {"error": "Assessment not found"}
    monkeypatch.undo()
    listed = (await client.get(f"/api/conversations/{cid}/messages", headers=auth_headers)).json()["messages"]
    assert listed[0]["assessment_id"] is None and listed[0]["grammar"] is None
