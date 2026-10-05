from datetime import timedelta
from pathlib import Path

import pytest
from sqlalchemy import select

from app import recordings
from app.models import Assessment, utcnow
from app.routers import speech
from app.xfyun import get_xfyun
from tests.test_assessment_save import FakeXfyun, files_under, make_wav
from tests.test_assessment_source import post
from tests.test_conversations import create, register

OLD = timedelta(hours=7)


@pytest.fixture
def settings_overrides(tmp_path):
    return {"data_dir": str(tmp_path / "data")}


@pytest.fixture
def fake(app):
    f = FakeXfyun()
    app.dependency_overrides[get_xfyun] = lambda: f
    return f


async def uid_of(client, headers) -> int:
    return int((await client.get("/api/me", headers=headers)).json()["id"])


async def seed(app, user_id, *, source="chat", age=OLD, size=100) -> str:
    """A saved assessment with a real file on disk."""
    async with app.state.sessionmaker() as s:
        row = Assessment(
            user_id=user_id, reference_text="x", language="en-US", duration_ms=1, audio_bytes=size,
            scores={}, result={}, audio_path="", source=source, created_at=utcnow() - age,
        )
        s.add(row)
        await s.flush()
        row.audio_path = recordings.recording_relpath(user_id, row.id)
        recordings.write_recording(app.state.settings.resolved_data_dir, row.audio_path, b"x" * size)
        await s.commit()
        return row.id


async def ids(app) -> set[str]:
    async with app.state.sessionmaker() as s:
        return set((await s.execute(select(Assessment.id))).scalars().all())


async def link(client, headers, assessment_id):
    conv = await create(client, headers)
    r = await client.post(
        f"/api/conversations/{conv['id']}/messages", headers=headers,
        json={"messages": [{"role": "user", "content": "hi", "assessment_id": assessment_id}]},
    )
    assert r.status_code == 200, r.text


async def test_old_orphan_is_deleted_with_its_file(app, client, auth_headers, fake):
    uid = await uid_of(client, auth_headers)
    orphan = await seed(app, uid)
    new = (await post(client, auth_headers, save="true", source="chat")).json()["assessment_id"]
    assert await ids(app) == {new}
    assert len(files_under(app.state.settings.resolved_data_dir)) == 1


async def test_young_orphan_is_kept(app, client, auth_headers, fake):
    uid = await uid_of(client, auth_headers)
    young = await seed(app, uid, age=timedelta(hours=1))
    new = (await post(client, auth_headers, save="true", source="chat")).json()["assessment_id"]
    assert await ids(app) == {young, new}


async def test_grace_is_configurable(app, client, auth_headers, fake):
    app.state.settings.chat_orphan_grace_hours = 1
    uid = await uid_of(client, auth_headers)
    await seed(app, uid, age=timedelta(hours=2))
    new = (await post(client, auth_headers, save="true", source="chat")).json()["assessment_id"]
    assert await ids(app) == {new}


async def test_linked_chat_assessment_is_kept(app, client, auth_headers, fake):
    uid = await uid_of(client, auth_headers)
    linked = await seed(app, uid)
    await link(client, auth_headers, linked)
    new = (await post(client, auth_headers, save="true", source="chat")).json()["assessment_id"]
    assert await ids(app) == {linked, new}


async def test_practice_assessment_is_kept(app, client, auth_headers, fake):
    uid = await uid_of(client, auth_headers)
    practice = await seed(app, uid, source="practice")
    new = (await post(client, auth_headers, save="true", source="chat")).json()["assessment_id"]
    assert await ids(app) == {practice, new}


async def test_practice_save_does_not_trigger_cleanup(app, client, auth_headers, fake):
    uid = await uid_of(client, auth_headers)
    orphan = await seed(app, uid)
    new = (await post(client, auth_headers, save="true")).json()["assessment_id"]
    assert await ids(app) == {orphan, new}


async def test_other_users_orphan_is_untouched(app, client, auth_headers, fake):
    other = await register(client, "bob")
    bob = await seed(app, await uid_of(client, other))
    new = (await post(client, auth_headers, save="true", source="chat")).json()["assessment_id"]
    assert await ids(app) == {bob, new}
    assert len(files_under(app.state.settings.resolved_data_dir)) == 2


async def test_cleanup_failure_does_not_break_the_save(app, client, auth_headers, fake, monkeypatch):
    uid = await uid_of(client, auth_headers)
    orphan = await seed(app, uid)

    async def boom(*args, **kwargs):
        raise RuntimeError("/secret/path")

    monkeypatch.setattr(speech, "drop_assessments", boom)
    r = await post(client, auth_headers, save="true", source="chat")
    assert r.status_code == 200, r.text
    assert await ids(app) == {orphan, r.json()["assessment_id"]}


async def test_file_removal_failure_does_not_break_the_save(app, client, auth_headers, fake, monkeypatch):
    uid = await uid_of(client, auth_headers)
    await seed(app, uid)

    def boom(*args, **kwargs):
        raise OSError("nope")

    monkeypatch.setattr(recordings, "delete_recording", boom)
    r = await post(client, auth_headers, save="true", source="chat")
    assert r.status_code == 200, r.text
    assert await ids(app) == {r.json()["assessment_id"]}


async def test_full_quota_of_orphans_self_heals(app, client, auth_headers, fake):
    app.state.settings.recording_quota_mb = 1
    uid = await uid_of(client, auth_headers)
    await seed(app, uid, size=1024 * 1024 - 100)
    r = await post(client, auth_headers, save="true", source="chat")
    assert r.status_code == 200, r.text
    assert await ids(app) == {r.json()["assessment_id"]}


async def test_full_quota_of_live_data_is_still_413(app, client, auth_headers, fake):
    app.state.settings.recording_quota_mb = 1
    uid = await uid_of(client, auth_headers)
    linked = await seed(app, uid, size=1024 * 1024 - 100)
    await link(client, auth_headers, linked)
    r = await post(client, auth_headers, save="true", source="chat")
    assert r.status_code == 413 and r.json() == {"error": "Recording storage quota exceeded"}
    assert await ids(app) == {linked}


async def test_full_quota_of_young_orphans_is_still_413(app, client, auth_headers, fake):
    app.state.settings.recording_quota_mb = 1
    uid = await uid_of(client, auth_headers)
    young = await seed(app, uid, size=1024 * 1024 - 100, age=timedelta(minutes=5))
    r = await post(client, auth_headers, save="true", source="chat")
    assert r.status_code == 413
    assert await ids(app) == {young}
