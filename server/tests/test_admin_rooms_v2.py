"""Admin console for rooms v2 (spec 2026-10-10 §14): settings card, voice timeline and audited playback."""
import json
from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.models import AdminAudit, Room, RoomMessage, RoomVoice
from app.routers.rooms import runtime
from tests.admin_helpers import ADMIN_ENABLED, login_as
from tests.test_admin_api import register

NOW = datetime(2026, 10, 10, 9, tzinfo=timezone.utc)
LATEST = 2_147_483_647


@pytest.fixture
def settings_overrides(tmp_path):
    return {**ADMIN_ENABLED, "rooms_enabled": True, "data_dir": str(tmp_path / "data")}


async def _room(client, headers, topic="美食"):
    return (await client.post("/api/rooms", headers=headers, json={"topic": topic})).json()["room"]


async def _audits(app, action: str) -> list[AdminAudit]:
    async with app.state.sessionmaker() as s:
        return list((await s.scalars(select(AdminAudit).where(AdminAudit.action == action)
                                     .order_by(AdminAudit.id))).all())


async def _voice(app, room_id: str, sender: int, *, audio_path: str | None, transcript: str = "hello there",
                 hidden: bool = False) -> RoomMessage:
    rt = runtime(app)
    async with rt.hub.lock(room_id):
        m = await rt.store.append(room_id, lane="public", sender_kind="user", sender_id=sender, kind="voice",
                                  text=transcript, now=NOW)
    async with app.state.sessionmaker() as s:
        s.add(RoomVoice(message_id=m.id, room_id=room_id, sender_id=sender, duration_ms=6200, audio_path=audio_path,
                        audio_bytes=3, audio_format="mp3", status="done", transcript=transcript, lang="en",
                        translation="你好", translation_status="done", created_at=NOW,
                        purged_at=None if audio_path else NOW))
        if hidden:
            (await s.get(RoomMessage, m.id)).hidden_at = NOW
        await s.commit()
    return m


async def test_detail_has_settings_without_the_invite_token(app, client):
    _, ha = await register(client, "alice")
    room = await _room(client, ha)
    await login_as(app, client, "viewer")
    detail = (await client.get(f"/api/admin/rooms/{room['id']}")).json()
    # SC1: a v1-style create seeds the name from the topic; the level follows the creator's rank (none -> A2)
    assert detail["settings"] == {"name": "美食", "scenario": "free", "level": "A2", "join_mode": "code",
                                  "max_members": 4, "ai_public": True, "allow_voice": True, "locked": False,
                                  "has_invite": False}
    async with app.state.sessionmaker() as s:
        (await s.get(Room, room["id"])).invite_token = "tok-secret-123456"
        await s.commit()
    detail = (await client.get(f"/api/admin/rooms/{room['id']}")).json()
    assert detail["settings"]["has_invite"] is True and "tok-secret-123456" not in json.dumps(detail)


async def test_settings_patch_is_operator_only_audited_and_broadcast(app, client):
    alice, ha = await register(client, "alice")
    room = await _room(client, ha)
    hv = await login_as(app, client, "viewer", "viewer1")
    r = await client.patch(f"/api/admin/rooms/{room['id']}/settings", headers=hv,
                           json={"allow_voice": False, "reason": "滥用"})
    assert r.status_code == 403
    h = await login_as(app, client, "operator")
    r = await client.patch(f"/api/admin/rooms/{room['id']}/settings", headers=h,
                           json={"allow_voice": False, "name": "秘密小屋", "reason": "滥用语音"})
    assert r.status_code == 200, r.text
    assert r.json()["settings"]["allow_voice"] is False and r.json()["settings"]["name"] == "秘密小屋"
    assert r.json()["changes"] == [{"field": "name", "value": "秘密小屋"}, {"field": "allow_voice", "value": False}]
    async with app.state.sessionmaker() as s:
        assert (await s.get(Room, room["id"])).allow_voice is False
    audits = await _audits(app, "room.settings")
    assert len(audits) == 1 and audits[-1].target_id == room["id"] and audits[-1].reason == "滥用语音"
    assert audits[-1].after == {"name": "<changed>", "allow_voice": False}
    assert "秘密小屋" not in json.dumps([(a.after, a.before, a.summary) for a in audits], ensure_ascii=False)
    msgs = (await client.get(f"/api/rooms/{room['id']}/messages", headers=ha,
                             params={"before_seq": LATEST})).json()["messages"]
    system = [m for m in msgs if m["kind"] == "system" and m["text"] == "settings"]
    assert system[-1]["meta"] == {"changes": [{"field": "name", "value": "秘密小屋"},
                                              {"field": "allow_voice", "value": False}]}
    # nothing changed: no audit, no system message
    r = await client.patch(f"/api/admin/rooms/{room['id']}/settings", headers=h,
                           json={"allow_voice": False, "reason": "再次"})
    assert r.status_code == 200 and r.json()["changes"] == [] and len(await _audits(app, "room.settings")) == 1


async def test_settings_patch_validation(app, client):
    alice, ha = await register(client, "alice")
    _, hb = await register(client, "bob")
    _, hc = await register(client, "carol")
    room = await _room(client, ha)
    for hh in (hb, hc):
        assert (await client.post("/api/rooms/join", headers=hh, json={"code": room["code"]})).status_code == 200
    h = await login_as(app, client, "operator")
    url = f"/api/admin/rooms/{room['id']}/settings"
    r = await client.patch(url, headers=h, json={"max_members": 2, "reason": "缩小"})
    assert r.status_code == 409 and r.json() == {"error": "Below current members"}
    r = await client.patch(url, headers=h, json={"max_members": 9, "join_mode": "password", "reason": "x" * 5})
    assert r.status_code == 400 and r.json() == {"error": "Invalid settings",
                                                 "fields": {"join_mode": "unknown", "max_members": "range"}}
    r = await client.patch(url, headers=h, json={"name": "x" * 31, "reason": "改名改名"})
    assert r.status_code == 400 and r.json()["fields"] == {"name": "too_long"}
    assert (await client.patch(url, headers=h, json={"scenario": "cafe", "reason": "改场景"})).status_code == 422
    assert (await client.patch(url, headers=h, json={"allow_voice": False})).status_code == 422  # reason required
    assert (await client.patch("/api/admin/rooms/nope/settings", headers=h,
                               json={"allow_voice": False, "reason": "没有"})).status_code == 404
    r = await client.patch(url, headers=h, json={"max_members": 3, "join_mode": "approval", "reason": "收紧"})
    assert r.status_code == 200 and r.json()["settings"]["max_members"] == 3
    assert r.json()["settings"]["join_mode"] == "approval"


async def test_voice_timeline_and_audited_playback(app, client):
    alice, ha = await register(client, "alice")
    room = await _room(client, ha)
    data = app.state.settings.resolved_data_dir
    (data / "room_audio" / room["id"]).mkdir(parents=True)
    m = await _voice(app, room["id"], alice, audio_path=f"room_audio/{room['id']}/m.mp3", hidden=True)
    (data / "room_audio" / room["id"] / "m.mp3").write_bytes(b"ID3")
    gone = await _voice(app, room["id"], alice, audio_path=None, transcript="old one")
    await login_as(app, client, "viewer", "viewer1")
    msgs = (await client.get(f"/api/admin/rooms/{room['id']}/messages")).json()["messages"]
    by_id = {x["id"]: x for x in msgs}
    assert by_id[m.id]["voice"] == {"duration_ms": 6200, "status": "done", "transcript": "hello there", "lang": "en",
                                    "translation": "你好", "translation_status": "done", "audio": True,
                                    "purged_at": None}
    assert by_id[m.id]["hidden"] is True  # the admin view ignores hiding
    assert by_id[gone.id]["voice"]["audio"] is False and by_id[gone.id]["voice"]["purged_at"] is not None
    assert all(x["voice"] is None for x in msgs if x["kind"] != "voice")
    url = f"/api/admin/rooms/{room['id']}/messages/{m.id}/audio"
    assert (await client.get(url)).status_code == 403
    assert await _audits(app, "room.audio.play") == []
    await login_as(app, client, "operator")
    r = await client.get(url)
    assert r.status_code == 200 and r.content == b"ID3"
    assert r.headers["content-type"] == "audio/mpeg" and r.headers["cache-control"] == "no-store"
    await client.get(url)
    plays = await _audits(app, "room.audio.play")
    assert len(plays) == 2 and plays[0].target_id == m.id and room["id"] in plays[0].summary
    assert "hello" not in json.dumps([(p.after, p.summary) for p in plays])
    r = await client.get(f"/api/admin/rooms/{room['id']}/messages/{gone.id}/audio")
    assert r.status_code == 410 and r.json() == {"error": "Audio purged"}
    assert (await client.get(f"/api/admin/rooms/other/messages/{m.id}/audio")).status_code == 404
    assert len(await _audits(app, "room.audio.play")) == 2  # failures are not plays


async def test_list_search_and_reports_use_the_room_name(app, client):
    """Integration gap: v2 rooms keep `topic` empty, so the admin list, search and reports carry `name`."""
    alice, ha = await register(client, "alice")
    room = (await client.post("/api/rooms", headers=ha, json={"name": "咖啡角", "scenario": "cafe"})).json()["room"]
    async with app.state.sessionmaker() as s:
        assert (await s.get(Room, room["id"])).topic == ""
    m = await _voice(app, room["id"], alice, audio_path=None)
    assert (await client.post(f"/api/rooms/{room['id']}/messages/{m.id}/report", headers=ha,
                              json={"reason": "spam"})).status_code == 200
    await login_as(app, client, "operator")
    found = (await client.get("/api/admin/rooms", params={"q": "咖啡", "status": "all"})).json()
    assert found["total"] == 1 and found["rooms"][0]["name"] == "咖啡角"
    assert (await client.get(f"/api/admin/rooms/{room['id']}")).json()["name"] == "咖啡角"
    reports = (await client.get("/api/admin/reports")).json()["reports"]
    assert reports[0]["room"]["name"] == "咖啡角"


def test_admin_settings_validation_is_the_owner_rule():
    """Integration: AD's temporary validator is replaced by SC1's `rules.clean_settings` (one rule for both)."""
    from app.admin.rooms_admin import clean_admin_settings
    from app.rooms.rules import clean_settings

    padded = "  " + "咖" * 30 + "  "  # 34 raw code points, 30 after cleaning: the owner may save it
    for raw in ({"name": padded}, {"name": "咖" * 31}, {"join_mode": "open"}, {"max_members": 9},
                {"max_members": 1}, {"max_members": 3, "allow_voice": False, "ai_public": True}, {"name": "   "}):
        assert clean_admin_settings(raw, site_max_members=8) == clean_settings(raw, site_max_members=8, partial=True)
    # the admin may not change scenario, level or the lock (spec §14): those keys are dropped, never applied
    assert clean_admin_settings({"scenario": "cafe", "level": "C1", "locked": True}, site_max_members=8) == ({}, {})
