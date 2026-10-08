import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.admin import auth
from app.models import Assessment, Conversation, Message, PracticeItem, User, VocabularyItem
from app.services.recordings import recording_relpath, write_recording
from tests.test_assessments_api import SCORES, make_wav

ENABLED = {"admin_username": "root", "admin_password": "correct-horse-battery", "admin_session_secret": "s3cret"}


@pytest.fixture
def settings_overrides(tmp_path):
    return {**ENABLED, "data_dir": str(tmp_path / "data")}


@pytest.fixture
def admin(app):
    token, _ = auth.issue_token(app.state.admin_secret, 60)
    return {"Authorization": f"Bearer {token}"}


async def register(client, username):
    r = await client.post("/api/users", json={"username": username, "password": "password123"})
    assert r.status_code == 200, r.text
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    uid = int((await client.get("/api/me", headers=headers)).json()["id"])
    return uid, headers


async def seed_assessment(app, uid, *, source="practice", text="Hello there", at=None) -> str:
    aid = str(uuid.uuid4())
    rel = recording_relpath(uid, aid)
    wav = make_wav()
    write_recording(app.state.settings.resolved_data_dir, rel, wav)
    async with app.state.sessionmaker() as s:
        s.add(Assessment(
            id=aid, user_id=uid, reference_text=text, language="en-US", duration_ms=500,
            audio_bytes=len(wav), scores=SCORES, result={**SCORES, "detail_result": {"words": [{"word": "Hello"}]}},
            audio_path=rel, source=source, created_at=at or datetime.now(timezone.utc),
        ))
        await s.commit()
    return aid


@pytest.fixture
async def world(app, client):
    """两个用户:alice 有对话/评测/练习/词汇,bob 只有一条评测。"""
    alice, _ = await register(client, "alice")
    bob, _ = await register(client, "bob")
    now = datetime.now(timezone.utc)
    a1 = await seed_assessment(app, alice, source="chat", text="I like tea", at=now - timedelta(minutes=2))
    a2 = await seed_assessment(app, alice, source="practice", text="Good morning", at=now - timedelta(minutes=1))
    b1 = await seed_assessment(app, bob, source="practice", text="Bob speaks", at=now)
    conv_id = str(uuid.uuid4())
    async with app.state.sessionmaker() as s:
        s.add(Conversation(id=conv_id, user_id=alice, name="Tea talk", config={"scenario": "cafe"}))
        await s.flush()
        s.add_all([
            Message(conversation_id=conv_id, role="user", content="I like tea", assessment_id=a1,
                    grammar={"corrected": "I like tea."}, created_at=now - timedelta(seconds=30)),
            Message(conversation_id=conv_id, role="assistant", content="Nice!", created_at=now - timedelta(seconds=20)),
        ])
        s.add(PracticeItem(user_id=alice, text="Say cheese", source="manual"))
        s.add(VocabularyItem(user_id=alice, word="tea", meaning="a drink", source="chat", due_at=now))
        await s.commit()
    return {"alice": alice, "bob": bob, "a1": a1, "a2": a2, "b1": b1, "conv": conv_id}


async def test_overview_counts_everyone_and_fills_days(client, admin, world):
    body = (await client.get("/api/admin/overview", headers=admin, params={"days": 7})).json()
    assert body["totals"]["users"] == 2
    assert body["totals"]["assessments"] == 3
    assert body["totals"]["messages"] == 2
    assert body["totals"]["conversations"] == 1
    assert body["totals"]["vocabulary"] == 1 and body["totals"]["practice_items"] == 1
    assert body["totals"]["recording_bytes"] == 3 * len(make_wav())
    assert len(body["daily"]) == 7
    today = body["daily"][-1]
    assert today["new_users"] == 2 and today["assessments"] == 3 and today["messages"] == 2


async def test_overview_days_validated(client, admin):
    assert (await client.get("/api/admin/overview", headers=admin, params={"days": 0})).status_code == 422
    assert (await client.get("/api/admin/overview", headers=admin, params={"days": 91})).status_code == 422


async def test_users_list_has_stats_search_and_paging(client, admin, world):
    body = (await client.get("/api/admin/users", headers=admin)).json()
    assert body["total"] == 2 and body["next"] is None
    by_name = {u["username"]: u for u in body["users"]}
    assert by_name["alice"]["conversations"] == 1 and by_name["alice"]["assessments"] == 2
    assert by_name["alice"]["recording_bytes"] == 2 * len(make_wav())
    assert by_name["alice"]["last_active_at"] is not None
    assert by_name["bob"]["conversations"] == 0 and by_name["bob"]["assessments"] == 1

    found = (await client.get("/api/admin/users", headers=admin, params={"q": "ALI"})).json()
    assert [u["username"] for u in found["users"]] == ["alice"] and found["total"] == 1
    by_id = (await client.get("/api/admin/users", headers=admin, params={"q": str(world["bob"])})).json()
    assert [u["username"] for u in by_id["users"]] == ["bob"]
    assert (await client.get("/api/admin/users", headers=admin, params={"q": "%"})).json()["users"] == []

    page = (await client.get("/api/admin/users", headers=admin, params={"per_page": 1})).json()
    assert len(page["users"]) == 1 and page["next"] == 2 and page["total"] == 2


async def test_user_detail(client, admin, world):
    body = (await client.get(f"/api/admin/users/{world['alice']}", headers=admin)).json()
    assert body["username"] == "alice"
    assert body["counts"] == {"conversations": 1, "messages": 2, "assessments": 2, "practice_items": 1, "vocabulary": 1}
    assert body["grammar_prompt"] is None
    assert (await client.get("/api/admin/users/99999999", headers=admin)).status_code == 404


async def test_conversations_and_full_transcript(client, admin, world):
    convs = (await client.get(f"/api/admin/users/{world['alice']}/conversations", headers=admin)).json()
    assert [(c["name"], c["message_count"]) for c in convs["conversations"]] == [("Tea talk", 2)]
    body = (await client.get(f"/api/admin/conversations/{world['conv']}/messages", headers=admin)).json()
    assert body["conversation"]["username"] == "alice" and body["conversation"]["config"] == {"scenario": "cafe"}
    first, second = body["messages"]
    assert (first["role"], first["content"]) == ("user", "I like tea")
    assert first["grammar"] == {"corrected": "I like tea."}
    assert first["assessment_id"] == world["a1"] and first["assessment"]["scores"] == SCORES
    assert second["role"] == "assistant" and second["assessment"] is None
    assert (await client.get("/api/admin/conversations/nope/messages", headers=admin)).status_code == 404


async def test_assessments_global_feed_has_usernames_and_filters(client, admin, world):
    body = (await client.get("/api/admin/assessments", headers=admin)).json()
    assert [(a["username"], a["reference_text"]) for a in body["assessments"]] == [
        ("bob", "Bob speaks"), ("alice", "Good morning"), ("alice", "I like tea"),
    ]
    assert body["assessments"][0]["user_id"] == world["bob"]
    chat = (await client.get("/api/admin/assessments", headers=admin, params={"source": "chat"})).json()
    assert [a["reference_text"] for a in chat["assessments"]] == ["I like tea"]
    assert (await client.get("/api/admin/assessments", headers=admin, params={"source": "x"})).status_code == 422
    paged = (await client.get("/api/admin/assessments", headers=admin, params={"per_page": 2})).json()
    assert len(paged["assessments"]) == 2 and paged["next"] == 2


async def test_user_assessments_only_that_user(client, admin, world):
    body = (await client.get(f"/api/admin/users/{world['alice']}/assessments", headers=admin)).json()
    assert {a["reference_text"] for a in body["assessments"]} == {"Good morning", "I like tea"}
    assert all("username" not in a for a in body["assessments"])
    assert (await client.get("/api/admin/users/99999999/assessments", headers=admin)).status_code == 404


async def test_assessment_detail_and_audio_across_users(client, admin, world):
    detail = (await client.get(f"/api/admin/assessments/{world['b1']}", headers=admin)).json()
    assert detail["username"] == "bob" and detail["result"]["detail_result"]["words"] == [{"word": "Hello"}]
    audio = await client.get(f"/api/admin/assessments/{world['b1']}/audio", headers=admin)
    assert audio.status_code == 200
    assert audio.headers["content-type"].startswith("audio/wav")
    assert audio.headers["cache-control"] == "private, no-store"
    assert audio.content[:4] == b"RIFF"
    assert (await client.get("/api/admin/assessments/nope", headers=admin)).status_code == 404


async def test_audio_missing_file_and_path_escape_are_404(app, client, admin, world):
    async with app.state.sessionmaker() as s:
        row = await s.get(Assessment, world["a1"])
        row.audio_path = "recordings/0/gone.wav"
        other = await s.get(Assessment, world["a2"])
        other.audio_path = "../../etc/passwd"
        await s.commit()
    assert (await client.get(f"/api/admin/assessments/{world['a1']}/audio", headers=admin)).status_code == 404
    assert (await client.get(f"/api/admin/assessments/{world['a2']}/audio", headers=admin)).status_code == 404


async def test_practice_items_and_vocabulary(client, admin, world):
    practice = (await client.get(f"/api/admin/users/{world['alice']}/practice-items", headers=admin)).json()
    assert [(i["text"], i["source"]) for i in practice["items"]] == [("Say cheese", "manual")]
    vocab = (await client.get(f"/api/admin/users/{world['alice']}/vocabulary", headers=admin)).json()
    item = vocab["items"][0]
    assert (item["word"], item["meaning"], item["box"], item["last_reviewed_at"]) == ("tea", "a drink", 0, None)
    assert (await client.get("/api/admin/users/99999999/vocabulary", headers=admin)).status_code == 404


@pytest.mark.parametrize("path", [
    "/api/admin/overview", "/api/admin/users", "/api/admin/users/1", "/api/admin/users/1/conversations",
    "/api/admin/conversations/x/messages", "/api/admin/assessments", "/api/admin/assessments/x",
    "/api/admin/assessments/x/audio", "/api/admin/users/1/practice-items", "/api/admin/users/1/vocabulary",
    "/api/admin/users/1/assessments",
])
async def test_every_endpoint_requires_admin(client, path):
    # 未带 token 必须是 401,而不是被 /api/** 兜底路由吞成 200 {}
    assert (await client.get(path)).status_code == 401
