import pytest
from sqlalchemy import func, select

from app.services import recordings
from app.services.assessment_store import SCORE_KEYS, QuotaExceeded, check_quota, save_assessment
from app.models import Assessment
from app.storage.local import LocalStore

RESULT = {"pronunciation_score": 80, "accuracy_score": 81, "fluency_score": 82, "completeness_score": 83, "words": []}


@pytest.fixture
async def uid(client, auth_headers):
    return int((await client.get("/api/me", headers=auth_headers)).json()["id"])


async def save(session, settings, uid, store, wav=b"RIFFdata", source="chat", language=" en-US "):
    return await save_assessment(session, settings, uid, store=store, wav_bytes=wav, duration=1.2345,
                                 reference="hi", language=language, source=source, result=RESULT)


async def test_save_writes_file_and_row(app, uid, tmp_path):
    app.state.settings.data_dir = str(tmp_path)
    app.state.storage = LocalStore(tmp_path)
    async with app.state.sessionmaker() as session:
        aid = await save(session, app.state.settings, uid, app.state.storage)
        row = await session.get(Assessment, aid)
    assert row.user_id == uid and row.source == "chat" and row.language == "en-US"
    assert row.duration_ms == 1234 and row.audio_bytes == 8 and row.reference_text == "hi"
    assert row.scores == {key: RESULT[key] for key in SCORE_KEYS} and row.result == RESULT
    assert (tmp_path / row.audio_path).read_bytes() == b"RIFFdata"


async def test_two_saves_get_distinct_ids_and_files(app, uid, tmp_path):
    app.state.settings.data_dir = str(tmp_path)
    app.state.storage = LocalStore(tmp_path)
    async with app.state.sessionmaker() as session:
        a = await save(session, app.state.settings, uid, app.state.storage)
        b = await save(session, app.state.settings, uid, app.state.storage)
        count = await session.scalar(select(func.count()).select_from(Assessment))
    assert a != b and count == 2
    assert recordings.absolute_path(tmp_path, recordings.recording_relpath(uid, a)).exists()
    assert recordings.absolute_path(tmp_path, recordings.recording_relpath(uid, b)).exists()


async def test_commit_failure_deletes_file(app, uid, tmp_path):
    app.state.settings.data_dir = str(tmp_path)
    app.state.storage = LocalStore(tmp_path)
    async with app.state.sessionmaker() as session:
        async def boom():
            raise RuntimeError("db down")
        session.commit = boom
        with pytest.raises(RuntimeError):
            await save(session, app.state.settings, uid, app.state.storage)
    assert [p for p in tmp_path.rglob("*") if p.is_file()] == []


async def test_write_failure_raises_oserror_and_adds_nothing(app, uid, tmp_path, monkeypatch):
    app.state.settings.data_dir = str(tmp_path)
    app.state.storage = LocalStore(tmp_path)

    async def fail(*args, **kwargs):
        raise OSError("disk full")
    monkeypatch.setattr(recordings, "write_recording", fail)
    async with app.state.sessionmaker() as session:
        with pytest.raises(OSError):
            await save(session, app.state.settings, uid, app.state.storage)
        assert not session.new
    async with app.state.sessionmaker() as session:
        assert await session.scalar(select(func.count()).select_from(Assessment)) == 0


async def test_quota_boundaries(app, uid, tmp_path):
    settings = app.state.settings
    settings.data_dir = str(tmp_path)
    settings.recording_quota_mb = 1
    quota = 1024 * 1024
    async with app.state.sessionmaker() as session:
        await check_quota(session, settings, uid, quota)  # exactly at the limit is allowed
        with pytest.raises(QuotaExceeded):
            await check_quota(session, settings, uid, quota + 1)
        await save(session, settings, uid, app.state.storage, wav=b"x" * 100)
        await check_quota(session, settings, uid, quota - 100)
        with pytest.raises(QuotaExceeded):
            await check_quota(session, settings, uid, quota - 99)


async def test_zero_quota_rejects_any_bytes(app, uid):
    app.state.settings.recording_quota_mb = 0
    async with app.state.sessionmaker() as session:
        with pytest.raises(QuotaExceeded):
            await check_quota(session, app.state.settings, uid, 1)
        await check_quota(session, app.state.settings, uid, 0)
