import asyncio
import json
import logging

from sqlalchemy import update

from app.models import RoomVoice
from tests.fixtures.audio import wav_bytes
from tests.test_rooms_ws import login, make_client, until


def _client(tmp_path, monkeypatch, **over):
    app, client = make_client(tmp_path, monkeypatch, rooms_voice_enabled=True, upstream_whisper_base_url="http://w",
                              upstream_whisper_mode="openai", data_dir=str(tmp_path / "data"), **over)
    from app.routers import rooms as rooms_router

    rt = rooms_router.runtime(app)

    async def fake(wav, sender_id):
        return "Hello everyone."

    rt.voice.deps.transcribe = fake
    return app, client, rt


def _upload(client, room_id, headers, cid="c1", seconds=2.0, **extra):
    files = {"file": ("v.wav", wav_bytes(seconds), "audio/wav")}
    return client.post(f"/api/rooms/{room_id}/voice", files=files, data={"client_id": cid, **extra}, headers=headers)


def _run(client, coro):
    return client.portal.call(lambda: coro)


def test_upload_play_and_access_rules(tmp_path, monkeypatch, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    app, client, rt = _client(tmp_path, monkeypatch)
    try:
        alice, _ = login(client, "alice")
        bob, bob_id = login(client, "bob")
        mallory, _ = login(client, "mallory")
        room = client.post("/api/rooms", json={}, headers=alice).json()["room"]
        client.post("/api/rooms/join", json={"code": room["code"]}, headers=bob)
        ticket = client.post(f"/api/rooms/{room['id']}/ticket", headers=bob).json()["ticket"]
        with client.websocket_connect(f"/api/rooms/ws?ticket={ticket}") as wb:
            wb.send_text('{"type":"hello","last_seq":0,"v":2}')
            until(wb, "welcome")
            r = _upload(client, room["id"], alice)
            assert r.status_code == 200
            body = r.json()
            assert body["message"]["kind"] == "voice" and body["seq"] == body["message"]["seq"]
            assert until(wb, "voice_update")[-1]["voice"]["transcript"] == "Hello everyone."
        mid = body["message"]["id"]
        data_dir = tmp_path / "data"
        assert (data_dir / f"room_audio/{room['id']}/{mid}.mp3").exists()
        assert not (data_dir / "recordings").exists()  # R2-18: never under recordings/
        audio = client.get(f"/api/rooms/{room['id']}/voice/{mid}", headers=bob)
        assert audio.status_code == 200 and audio.headers["content-type"] == "audio/mpeg"
        assert audio.headers["cache-control"] == "private, max-age=86400" and audio.content[0] == 0xFF
        assert audio.headers["etag"] == f'"{mid}"'
        again = client.get(f"/api/rooms/{room['id']}/voice/{mid}", headers={**bob, "If-None-Match": f'"{mid}"'})
        assert again.status_code == 304
        assert client.get(f"/api/rooms/{room['id']}/voice/{mid}", headers=mallory).status_code == 404
        assert client.get(f"/api/rooms/{room['id']}/voice/nope", headers=bob).status_code == 404
        # the message history carries the shared transcript
        history = client.get(f"/api/rooms/{room['id']}/messages?before_seq=999", headers=bob).json()["messages"]
        voice = next(m for m in history if m["kind"] == "voice")
        assert voice["text"] == "Hello everyone." and voice["voice"]["status"] == "done"
        # a closed room's members still play; a kicked member does not
        client.post(f"/api/rooms/{room['id']}/kick", json={"user_id": bob_id}, headers=alice)
        assert client.get(f"/api/rooms/{room['id']}/voice/{mid}", headers=bob).status_code == 404
        client.post(f"/api/rooms/{room['id']}/close", headers=alice)
        assert client.get(f"/api/rooms/{room['id']}/voice/{mid}", headers=alice).status_code == 200
        # an admin purge leaves the transcript but the audio answers 410
        async def purge():
            async with app.state.sessionmaker() as s:
                await s.execute(update(RoomVoice).where(RoomVoice.message_id == mid).values(audio_path=None))
                await s.commit()

        _run(client, purge())
        gone = client.get(f"/api/rooms/{room['id']}/voice/{mid}", headers=alice)
        assert gone.status_code == 410 and gone.json() == {"error": "Audio removed"}
        assert "Hello everyone." not in caplog.text
    finally:
        client.__exit__(None, None, None)


def test_hidden_voice_is_not_served(tmp_path, monkeypatch):
    app, client, rt = _client(tmp_path, monkeypatch)
    try:
        alice, _ = login(client, "alice")
        room = client.post("/api/rooms", json={}, headers=alice).json()["room"]
        mid = _upload(client, room["id"], alice).json()["message"]["id"]
        _run(client, rt.store.hide(room["id"], mid, rt.voice.deps.clock()))
        assert client.get(f"/api/rooms/{room['id']}/voice/{mid}", headers=alice).status_code == 404
    finally:
        client.__exit__(None, None, None)


def test_upload_errors(tmp_path, monkeypatch):
    app, client, rt = _client(tmp_path, monkeypatch)
    try:
        alice, _ = login(client, "alice")
        mallory, _ = login(client, "mallory")
        room = client.post("/api/rooms", json={"allow_voice": False}, headers=alice).json()["room"]
        off = _upload(client, room["id"], alice)
        assert off.status_code == 403 and off.json() == {"error": "Voice messages are off"}
        client.patch(f"/api/rooms/{room['id']}", json={"allow_voice": True}, headers=alice)
        short = _upload(client, room["id"], alice, seconds=0.2)
        assert short.status_code == 400 and short.json() == {"error": "Audio too short"}
        bad = client.post(f"/api/rooms/{room['id']}/voice", files={"file": ("v.mp3", b"ID3xxxx", "audio/mpeg")},
                          data={"client_id": "x"}, headers=alice)
        assert bad.status_code == 400 and bad.json() == {"error": "Expected 16 kHz mono WAV"}
        big = client.post(f"/api/rooms/{room['id']}/voice", content=b"0" * 2_200_000,
                          headers={**alice, "content-type": "multipart/form-data; boundary=x"})
        assert big.status_code == 413
        reply = _upload(client, room["id"], alice, cid="c2", reply_to="999")
        assert reply.status_code == 400 and reply.json() == {"error": "Invalid reply"}
        nofile = client.post(f"/api/rooms/{room['id']}/voice", data={"client_id": "c3"}, headers=alice)
        assert nofile.status_code == 400 and nofile.json() == {"error": "Audio file is required"}
        assert _upload(client, room["id"], alice, cid="").status_code == 400
        assert _upload(client, room["id"], alice, cid="x" * 65).status_code == 400
        assert _upload(client, room["id"], alice, cid="c4", reply_to="abc").status_code == 400
        assert _upload(client, room["id"], mallory).status_code == 404  # not a member
        client.post(f"/api/rooms/{room['id']}/close", headers=alice)
        closed = _upload(client, room["id"], alice, cid="c5")
        assert closed.status_code == 404 and closed.json() == {"error": "Room not found"}
    finally:
        client.__exit__(None, None, None)


def test_quota_answers_429(tmp_path, monkeypatch):
    app, client, rt = _client(tmp_path, monkeypatch, rooms_voice_daily_per_user=1)
    try:
        alice, _ = login(client, "alice")
        room = client.post("/api/rooms", json={}, headers=alice).json()["room"]
        assert _upload(client, room["id"], alice, cid="c1").status_code == 200
        daily = _upload(client, room["id"], alice, cid="c2")
        assert daily.status_code == 429 and daily.json() == {"error": "Daily voice limit reached"}
    finally:
        client.__exit__(None, None, None)


def test_translate_over_the_socket(tmp_path, monkeypatch):
    app, client, rt = _client(tmp_path, monkeypatch)

    async def complete(messages, max_tokens, temperature):
        return "大家好。"

    rt.voice.deps.complete = complete
    try:
        alice, _ = login(client, "alice")
        bob, _ = login(client, "bob")
        room = client.post("/api/rooms", json={}, headers=alice).json()["room"]
        client.post("/api/rooms/join", json={"code": room["code"]}, headers=bob)
        seq = _upload(client, room["id"], alice).json()["seq"]
        _run(client, rt.hub.drain())
        ticket = client.post(f"/api/rooms/{room['id']}/ticket", headers=bob).json()["ticket"]
        with client.websocket_connect(f"/api/rooms/ws?ticket={ticket}") as wb:
            wb.send_text('{"type":"hello","last_seq":0,"v":2}')
            until(wb, "welcome")
            wb.send_text(json.dumps({"type": "voice_translate", "seq": seq}))
            while True:
                update_ = until(wb, "voice_update")[-1]
                if update_["voice"]["translation_status"] == "done":
                    break
            assert update_["voice"]["translation"] == "大家好。"
            wb.send_text(json.dumps({"type": "voice_retry", "seq": seq}))  # bob is not the sender
            assert until(wb, "error")[-1]["code"] == "bad_seq"
    finally:
        client.__exit__(None, None, None)


def test_startup_and_sweep_listeners_are_installed(tmp_path, monkeypatch):
    app, client, rt = _client(tmp_path, monkeypatch)
    try:
        assert any(getattr(f, "__name__", "") == "_voice_staging_sweep" for f in rt.sweep_listeners)
        assert any(getattr(f, "__name__", "") == "_voice_resume" for f in rt.startup_listeners)
    finally:
        client.__exit__(None, None, None)


def test_voice_disabled_site_wide_hides_the_feature(tmp_path, monkeypatch):
    app, client = make_client(tmp_path, monkeypatch)
    try:
        alice, _ = login(client, "alice")
        assert client.get("/api/rooms/config", headers=alice).json()["voice_available"] is False
        room = client.post("/api/rooms", json={}, headers=alice).json()["room"]
        assert _upload(client, room["id"], alice).status_code == 403
    finally:
        client.__exit__(None, None, None)
