import io
import uuid
import wave
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app.models import Assessment
from app.services.recordings import recording_relpath, write_recording
from app.services.provider_clients import get_xfyun

FIXTURES = Path(__file__).parent / "fixtures"
GOOD_XML = (FIXTURES / "ise_good.xml").read_text(encoding="utf-8")
REFERENCE = "Hello, nice to meet you. I would like a cup of coffee, please."
SCORES = {"pronunciation_score": 80.0, "accuracy_score": 81.0, "fluency_score": 82.0, "completeness_score": 83.0}
SUMMARY_KEYS = {"id", "reference_text", "language", "duration_ms", "scores", "created_at"}


def make_wav(seconds=0.5) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(b"\x02\x00" * int(16000 * seconds))
    return buf.getvalue()


class FakeXfyun:
    configured = True

    async def evaluate(self, pcm, text, ent, timeout=60.0):
        return GOOD_XML


@pytest.fixture
def settings_overrides(tmp_path):
    return {"data_dir": str(tmp_path / "data")}


async def register(client, username):
    r = await client.post("/api/users", json={"username": username, "password": "password123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def user_id(client, headers) -> int:
    return int((await client.get("/api/me", headers=headers)).json()["id"])


async def seed(app, uid, n=1) -> list[str]:
    data_dir = app.state.settings.resolved_data_dir
    base = datetime(2026, 10, 4, tzinfo=timezone.utc)
    ids = []
    async with app.state.sessionmaker() as s:
        for i in range(n):
            aid = str(uuid.uuid4())
            rel = recording_relpath(uid, aid)
            wav = make_wav()
            await write_recording(app.state.storage, rel, wav)
            s.add(Assessment(
                id=aid, user_id=uid, reference_text=f"Sentence {i}", language="en-US", duration_ms=500,
                audio_bytes=len(wav), scores=SCORES, result={**SCORES, "detail_result": {"words": []}},
                audio_path=rel, created_at=base + timedelta(minutes=i),
            ))
            ids.append(aid)
        await s.commit()
    return ids


@pytest.mark.parametrize("method,path", [
    ("GET", "/api/assessments"), ("GET", "/api/assessments/x"),
    ("GET", "/api/assessments/x/audio"), ("DELETE", "/api/assessments/x"),
])
async def test_requires_login(client, method, path):
    r = await client.request(method, path)
    assert r.status_code == 401


async def test_list_is_newest_first_and_paginated(app, client, auth_headers):
    ids = await seed(app, await user_id(client, auth_headers), n=3)
    first = (await client.get("/api/assessments", headers=auth_headers, params={"per_page": 2})).json()
    assert [a["id"] for a in first["assessments"]] == [ids[2], ids[1]]
    assert first["page"] == 1 and first["next"] == 2
    assert set(first["assessments"][0]) == SUMMARY_KEYS
    assert first["assessments"][0]["scores"] == SCORES
    assert first["assessments"][0]["created_at"].endswith("+00:00")
    second = (await client.get("/api/assessments", headers=auth_headers, params={"per_page": 2, "page": 2})).json()
    assert [a["id"] for a in second["assessments"]] == [ids[0]]
    assert second["next"] is None


async def test_per_page_capped(client, auth_headers):
    assert (await client.get("/api/assessments", headers=auth_headers, params={"per_page": 51})).status_code == 422


async def test_detail_includes_result(app, client, auth_headers):
    (aid,) = await seed(app, await user_id(client, auth_headers))
    body = (await client.get(f"/api/assessments/{aid}", headers=auth_headers)).json()
    assert set(body) == SUMMARY_KEYS | {"result"}
    assert body["result"]["detail_result"] == {"words": []}


async def test_audio_streams_wav(app, client, auth_headers):
    (aid,) = await seed(app, await user_id(client, auth_headers))
    r = await client.get(f"/api/assessments/{aid}/audio", headers=auth_headers)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("audio/wav")
    assert r.headers["cache-control"] == "private, no-store"
    assert r.content == make_wav()


async def test_audio_missing_file(app, client, auth_headers):
    uid = await user_id(client, auth_headers)
    (aid,) = await seed(app, uid)
    (app.state.settings.resolved_data_dir / recording_relpath(uid, aid)).unlink()
    r = await client.get(f"/api/assessments/{aid}/audio", headers=auth_headers)
    assert r.status_code == 404 and r.json() == {"error": "Recording not found"}


async def test_audio_path_traversal_is_refused(app, client, auth_headers):
    uid = await user_id(client, auth_headers)
    (app.state.settings.resolved_data_dir.parent / "evil.wav").write_bytes(b"EVIL")
    async with app.state.sessionmaker() as s:
        s.add(Assessment(id="evil", user_id=uid, reference_text="x", language="en-US", duration_ms=1,
                         audio_bytes=4, scores=SCORES, result={}, audio_path="../evil.wav"))
        await s.commit()
    r = await client.get("/api/assessments/evil/audio", headers=auth_headers)
    assert r.status_code == 404
    assert b"EVIL" not in r.content


async def test_delete_removes_row_and_file(app, client, auth_headers):
    uid = await user_id(client, auth_headers)
    (aid,) = await seed(app, uid)
    path = app.state.settings.resolved_data_dir / recording_relpath(uid, aid)
    r = await client.delete(f"/api/assessments/{aid}", headers=auth_headers)
    assert r.status_code == 200 and r.json() == {"id": aid}
    assert not path.exists()
    assert (await client.get(f"/api/assessments/{aid}", headers=auth_headers)).status_code == 404
    assert (await client.delete(f"/api/assessments/{aid}", headers=auth_headers)).status_code == 404


async def test_isolation(app, client, auth_headers):
    uid = await user_id(client, auth_headers)
    (aid,) = await seed(app, uid)
    bob = await register(client, "bob")
    for method, path in [("GET", f"/api/assessments/{aid}"), ("GET", f"/api/assessments/{aid}/audio"),
                         ("DELETE", f"/api/assessments/{aid}")]:
        r = await client.request(method, path, headers=bob)
        assert r.status_code == 404 and r.json() == {"error": "Assessment not found"}
    assert (await client.get("/api/assessments", headers=bob)).json()["assessments"] == []
    assert (app.state.settings.resolved_data_dir / recording_relpath(uid, aid)).exists()


async def test_saved_assessment_round_trip(app, client, auth_headers):
    app.dependency_overrides[get_xfyun] = lambda: FakeXfyun()
    wav = make_wav()
    r = await client.post(
        "/api/speech/assessments", headers=auth_headers,
        data={"reference": REFERENCE, "language": "en-US", "save": "true"},
        files={"file": ("audio.wav", wav, "audio/wav")},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    aid = body.pop("assessment_id")
    detail = (await client.get(f"/api/assessments/{aid}", headers=auth_headers)).json()
    assert detail["result"] == body
    assert detail["reference_text"] == REFERENCE
    assert detail["duration_ms"] == 500
    audio = await client.get(f"/api/assessments/{aid}/audio", headers=auth_headers)
    assert audio.content == wav
