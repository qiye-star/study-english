import io
import uuid
import wave
from pathlib import Path

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import recordings
from app.models import Assessment
from app.provider_clients import get_xfyun
from app.xfyun import XfyunError
from app.xfyun_result import to_assessment

FIXTURES = Path(__file__).parent / "fixtures"
GOOD_XML = (FIXTURES / "ise_good.xml").read_text(encoding="utf-8")
REFERENCE = "Hello, nice to meet you. I would like a cup of coffee, please."
URL = "/api/speech/assessments"


def make_wav(seconds=0.5) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(b"\x01\x00" * int(16000 * seconds))
    return buf.getvalue()


class FakeXfyun:
    def __init__(self):
        self.calls = []
        self.configured = True
        self.error = None

    async def evaluate(self, pcm, text, ent, timeout=60.0):
        self.calls.append(text)
        if self.error:
            raise self.error
        return GOOD_XML


@pytest.fixture
def settings_overrides(tmp_path):
    return {"data_dir": str(tmp_path / "data")}


@pytest.fixture
def fake(app):
    f = FakeXfyun()
    app.dependency_overrides[get_xfyun] = lambda: f
    return f


def post(client, headers, save=None, wav=None):
    data = {"reference": REFERENCE, "language": "en-US"}
    if save is not None:
        data["save"] = save
    files = {"file": ("audio.wav", wav or make_wav(), "audio/wav")}
    return client.post(URL, headers=headers, data=data, files=files)


async def count_rows(app) -> int:
    async with app.state.sessionmaker() as s:
        return await s.scalar(select(func.count()).select_from(Assessment))


def files_under(path: Path) -> list[Path]:
    return [p for p in path.rglob("*") if p.is_file()] if path.exists() else []


async def test_without_save_response_is_unchanged(app, client, auth_headers, fake):
    r = await post(client, auth_headers)
    assert r.status_code == 200, r.text
    assert r.json() == to_assessment(GOOD_XML, REFERENCE)
    assert await count_rows(app) == 0
    assert files_under(app.state.settings.resolved_data_dir) == []


@pytest.mark.parametrize("value", ["false", "0", "", "no"])
async def test_falsy_save_values_do_not_save(app, client, auth_headers, fake, value):
    r = await post(client, auth_headers, save=value)
    assert r.status_code == 200
    assert "assessment_id" not in r.json()
    assert await count_rows(app) == 0


@pytest.mark.parametrize("value", ["true", "TRUE", " 1 ", "yes"])
async def test_save_persists_recording_and_row(app, client, auth_headers, fake, value):
    wav = make_wav()
    r = await post(client, auth_headers, save=value, wav=wav)
    assert r.status_code == 200, r.text
    body = r.json()
    assessment_id = body.pop("assessment_id")
    uuid.UUID(assessment_id)
    assert body == to_assessment(GOOD_XML, REFERENCE)

    uid = int((await client.get("/api/me", headers=auth_headers)).json()["id"])
    rel = f"recordings/{uid}/{assessment_id}.wav"
    data_dir = app.state.settings.resolved_data_dir
    assert (data_dir / rel).read_bytes() == wav

    async with app.state.sessionmaker() as s:
        row = await s.get(Assessment, assessment_id)
    assert row.user_id == uid
    assert row.reference_text == REFERENCE
    assert row.language == "en-US"
    assert row.duration_ms == 500
    assert row.audio_bytes == len(wav)
    assert row.audio_path == rel
    assert row.scores == {k: body[k] for k in ("pronunciation_score", "accuracy_score", "fluency_score", "completeness_score")}
    assert row.result == body


async def test_failed_evaluation_saves_nothing(app, client, auth_headers, fake):
    fake.error = XfyunError("boom")  # 签名:XfyunError(message, code=None)
    r = await post(client, auth_headers, save="true")
    assert r.status_code == 502
    assert await count_rows(app) == 0
    assert files_under(app.state.settings.resolved_data_dir) == []


async def test_quota_checked_before_upstream(app, client, auth_headers, fake):
    app.state.settings.recording_quota_mb = 0
    r = await post(client, auth_headers, save="true")
    assert r.status_code == 413
    assert r.json() == {"error": "Recording storage quota exceeded"}
    assert fake.calls == []


async def test_quota_counts_existing_recordings(app, client, auth_headers, fake):
    app.state.settings.recording_quota_mb = 1
    uid = int((await client.get("/api/me", headers=auth_headers)).json()["id"])
    async with app.state.sessionmaker() as s:
        s.add(Assessment(
            user_id=uid, reference_text="x", language="en-US", duration_ms=1, audio_bytes=1024 * 1024 - 100,
            scores={}, result={}, audio_path="recordings/x.wav",
        ))
        await s.commit()
    r = await post(client, auth_headers, save="true")
    assert r.status_code == 413
    # 不保存时不受配额影响
    assert (await post(client, auth_headers)).status_code == 200


async def test_storage_failure_returns_500_and_no_row(app, client, auth_headers, fake, monkeypatch):
    def boom(*args, **kwargs):
        raise OSError("disk full")

    monkeypatch.setattr(recordings, "write_recording", boom)
    r = await post(client, auth_headers, save="true")
    assert r.status_code == 500
    assert r.json() == {"error": "Could not save the recording"}
    assert await count_rows(app) == 0


def test_absolute_path_rejects_escape(tmp_path):
    with pytest.raises(ValueError):
        recordings.absolute_path(tmp_path, "../evil.wav")
    with pytest.raises(ValueError):
        recordings.absolute_path(tmp_path, "recordings/../../evil.wav")
    assert recordings.absolute_path(tmp_path, "recordings/1/a.wav") == (tmp_path / "recordings/1/a.wav").resolve()


def test_write_and_delete_recording(tmp_path):
    rel = recordings.recording_relpath(12345678, "abc")
    assert rel == "recordings/12345678/abc.wav"
    recordings.write_recording(tmp_path, rel, b"RIFF")
    assert (tmp_path / rel).read_bytes() == b"RIFF"
    assert not list((tmp_path / "recordings/12345678").glob("*.tmp"))
    recordings.delete_recording(tmp_path, rel)
    assert not (tmp_path / rel).exists()
    recordings.delete_recording(tmp_path, rel)          # 再删不报错
    recordings.delete_recording(tmp_path, "../x.wav")   # 越界静默


def test_failed_replace_leaves_no_tmp_file(tmp_path, monkeypatch):
    def boom(src, dst):
        raise OSError("replace failed")

    monkeypatch.setattr(recordings.os, "replace", boom)
    with pytest.raises(OSError):
        recordings.write_recording(tmp_path, "recordings/1/a.wav", b"RIFF")
    assert files_under(tmp_path) == []


def test_failed_write_leaves_no_tmp_file(tmp_path, monkeypatch):
    def boom(self, data):
        self.touch()
        raise OSError("disk full")

    monkeypatch.setattr(Path, "write_bytes", boom)
    with pytest.raises(OSError):
        recordings.write_recording(tmp_path, "recordings/1/a.wav", b"RIFF")
    assert files_under(tmp_path) == []


async def test_commit_failure_deletes_file_and_leaves_no_row(app, client, auth_headers, fake, monkeypatch):
    async def boom(self):
        raise RuntimeError("db down")

    monkeypatch.setattr(AsyncSession, "commit", boom)
    with pytest.raises(RuntimeError):
        await post(client, auth_headers, save="true")
    monkeypatch.undo()
    assert files_under(app.state.settings.resolved_data_dir) == []
    assert await count_rows(app) == 0


async def test_quota_is_per_user(app, client, auth_headers, fake):
    app.state.settings.recording_quota_mb = 1
    other = await client.post("/api/users", json={"username": "bob", "password": "password123"})
    other_id = int(other.json()["user"]["id"]) if "user" in other.json() else int(
        (await client.get("/api/me", headers={"Authorization": f"Bearer {other.json()['access_token']}"})).json()["id"]
    )
    async with app.state.sessionmaker() as s:
        s.add(Assessment(
            user_id=other_id, reference_text="x", language="en-US", duration_ms=1, audio_bytes=50 * 1024 * 1024,
            scores={}, result={}, audio_path="recordings/x.wav",
        ))
        await s.commit()
    assert (await post(client, auth_headers, save="true")).status_code == 200


async def test_quota_exact_boundary_is_accepted(app, client, auth_headers, fake):
    wav = make_wav()
    app.state.settings.recording_quota_mb = 1
    uid = int((await client.get("/api/me", headers=auth_headers)).json()["id"])
    async with app.state.sessionmaker() as s:
        s.add(Assessment(
            user_id=uid, reference_text="x", language="en-US", duration_ms=1,
            audio_bytes=1024 * 1024 - len(wav), scores={}, result={}, audio_path="recordings/x.wav",
        ))
        await s.commit()
    assert (await post(client, auth_headers, save="true", wav=wav)).status_code == 200
    # one more byte over the limit is rejected
    assert (await post(client, auth_headers, save="true", wav=wav)).status_code == 413
