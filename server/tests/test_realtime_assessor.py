import asyncio
from pathlib import Path

from sqlalchemy import select

from app.models import Assessment, Message
from app.realtime_providers import DbMessageStore, XfyunAssessor, make_assessor
from app.xfyun import XfyunError
from tests.conftest import make_settings

GOOD_XML = (Path(__file__).parent / "fixtures" / "ise_good.xml").read_text(encoding="utf-8")
REFERENCE = "Hello, nice to meet you. I would like a cup of coffee, please."
PCM = b"\x00\x00" * 16000


class FakeXfyun:
    configured = True

    def __init__(self, error=None, delay=0.0):
        self.error = error
        self.delay = delay
        self.calls = []

    async def evaluate(self, pcm, text, ent, timeout=60.0):
        self.calls.append((len(pcm), text, ent))
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.error:
            raise self.error
        return GOOD_XML


async def setup_message(app, client, headers):
    cid = (await client.post("/api/conversations", json={"name": "c", "config": {}}, headers=headers)).json()["id"]
    uid = int((await client.get("/api/me", headers=headers)).json()["id"])
    message_id = await DbMessageStore(app.state.sessionmaker, uid, cid, 100).add_user(REFERENCE)
    return uid, message_id


async def test_assess_without_saving(app, client, auth_headers):
    uid, mid = await setup_message(app, client, auth_headers)
    out = await XfyunAssessor(FakeXfyun(), app.state.sessionmaker, app.state.settings, uid, save=False).assess(mid, PCM, REFERENCE)
    assert out["status"] == "done" and out["assessment_id"] is None and "pronunciation_score" in out["result"]


async def test_assess_and_save_links_the_message(app, client, auth_headers, tmp_path):
    app.state.settings.data_dir = str(tmp_path)
    uid, mid = await setup_message(app, client, auth_headers)
    out = await XfyunAssessor(FakeXfyun(), app.state.sessionmaker, app.state.settings, uid, save=True).assess(mid, PCM, REFERENCE)
    assert out["status"] == "done" and out["assessment_id"]
    async with app.state.sessionmaker() as session:
        message = await session.get(Message, mid)
        row = await session.get(Assessment, out["assessment_id"])
    assert message.assessment_id == out["assessment_id"]
    assert row.source == "chat" and row.reference_text == REFERENCE
    assert (tmp_path / row.audio_path).exists()


async def test_quota_and_failures(app, client, auth_headers, tmp_path):
    app.state.settings.data_dir = str(tmp_path)
    app.state.settings.recording_quota_mb = 0
    uid, mid = await setup_message(app, client, auth_headers)
    out = await XfyunAssessor(FakeXfyun(), app.state.sessionmaker, app.state.settings, uid, save=True).assess(mid, PCM, REFERENCE)
    assert out["status"] == "quota" and out["assessment_id"] is None
    assert not list(tmp_path.rglob("*.wav"))
    failed = await XfyunAssessor(FakeXfyun(XfyunError("x")), app.state.sessionmaker, app.state.settings, uid, save=False).assess(mid, PCM, REFERENCE)
    assert failed == {"status": "failed"}


async def test_audio_is_capped_at_60_seconds(app, client, auth_headers):
    uid, mid = await setup_message(app, client, auth_headers)
    fake = FakeXfyun()
    await XfyunAssessor(fake, app.state.sessionmaker, app.state.settings, uid, save=False).assess(mid, b"\x00\x00" * 16000 * 90, REFERENCE)
    assert fake.calls[0][0] == 60 * 32000


async def test_existing_link_is_not_overwritten(app, client, auth_headers, tmp_path):
    app.state.settings.data_dir = str(tmp_path)
    uid, mid = await setup_message(app, client, auth_headers)
    assessor = XfyunAssessor(FakeXfyun(), app.state.sessionmaker, app.state.settings, uid, save=True)
    first = await assessor.assess(mid, PCM, REFERENCE)
    second = await assessor.assess(mid, PCM, REFERENCE)
    async with app.state.sessionmaker() as session:
        message = await session.get(Message, mid)
    assert message.assessment_id == first["assessment_id"]
    # Review 4.6b-m1: the second recording was not linked, so the client must not be told it was saved
    # (the unlinked row is an orphan that `cleanup_orphan_chat_recordings` reclaims).
    assert second["status"] == "done" and second["assessment_id"] is None and "pronunciation_score" in second["result"]


async def test_deleted_message_reports_no_saved_assessment(app, client, auth_headers, tmp_path):
    app.state.settings.data_dir = str(tmp_path)
    uid, mid = await setup_message(app, client, auth_headers)
    async with app.state.sessionmaker() as session:
        await session.delete(await session.get(Message, mid))
        await session.commit()
    out = await XfyunAssessor(FakeXfyun(), app.state.sessionmaker, app.state.settings, uid, save=True).assess(mid, PCM, REFERENCE)
    assert out["status"] == "done" and out["assessment_id"] is None


async def test_cancel_during_xfyun_leaves_nothing(app, client, auth_headers, tmp_path):
    app.state.settings.data_dir = str(tmp_path)
    uid, mid = await setup_message(app, client, auth_headers)
    task = asyncio.create_task(
        XfyunAssessor(FakeXfyun(delay=5), app.state.sessionmaker, app.state.settings, uid, save=True).assess(mid, PCM, REFERENCE))
    await asyncio.sleep(0.05)
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    assert task.cancelled()
    assert not list(tmp_path.rglob("*.wav"))
    async with app.state.sessionmaker() as session:
        assert (await session.scalars(select(Assessment))).first() is None


async def test_cancel_during_save_keeps_file_and_row_consistent(app, client, auth_headers, tmp_path):
    app.state.settings.data_dir = str(tmp_path)
    uid, mid = await setup_message(app, client, auth_headers)
    task = asyncio.create_task(
        XfyunAssessor(FakeXfyun(), app.state.sessionmaker, app.state.settings, uid, save=True).assess(mid, PCM, REFERENCE))
    await asyncio.sleep(0)
    for _ in range(50):  # cancel somewhere inside the shielded write
        await asyncio.sleep(0)
        if task.done():
            break
        task.cancel()
        break
    try:
        await task
    except asyncio.CancelledError:
        pass
    await asyncio.sleep(0.5)  # let the shielded write settle
    async with app.state.sessionmaker() as session:
        rows = (await session.scalars(select(Assessment))).all()
    files = list(tmp_path.rglob("*.wav"))
    assert len(files) == len(rows)


def test_make_assessor_needs_xfyun(app):
    assert make_assessor(app, make_settings(), 1, False) is None


async def test_concurrent_saves_for_one_user_never_exceed_the_quota(app, client, auth_headers, tmp_path):
    app.state.settings.data_dir = str(tmp_path)
    app.state.settings.recording_quota_mb = 1
    app.state.xfyun = FakeXfyun()
    uid, mid = await setup_message(app, client, auth_headers)
    pcm = b"\x00\x00" * 16000 * 10  # 10 s ≈ 320 KB: three fit in 1 MB, a fourth does not
    # two assessors (e.g. a call ending and the next one starting) share the per-user lock
    first = make_assessor(app, app.state.settings, uid, True)
    second = make_assessor(app, app.state.settings, uid, True)
    outs = await asyncio.gather(*[(first if i % 2 else second).assess(mid, pcm, REFERENCE) for i in range(6)])
    async with app.state.sessionmaker() as session:
        rows = (await session.scalars(select(Assessment))).all()
    assert sum(r.audio_bytes for r in rows) <= 1024 * 1024
    assert len(rows) == 3 and sorted(o["status"] for o in outs) == ["done"] * 3 + ["quota"] * 3
    assert len(list(tmp_path.rglob("*.wav"))) == 3
