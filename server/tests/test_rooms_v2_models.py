from datetime import datetime, timezone

import pytest
from sqlalchemy.exc import IntegrityError

from app.core.quotas import QUOTA_KEYS
from app.models import Room, RoomJoinRequest, RoomMessage, RoomReaction, RoomSummary, RoomVoice, User
from app.rooms.rules import RoomLimits

NOW = datetime(2026, 10, 10, 9, 0, tzinfo=timezone.utc)


async def _room(s):
    s.add(User(id=7, username="lily", password_hash="x"))
    await s.flush()
    s.add(Room(id="r1", code="482913", last_code="482913", owner_id=7, topic="", status="open", created_at=NOW,
               last_active_at=NOW))
    await s.flush()
    s.add(RoomMessage(id="m1", room_id="r1", seq=1, lane="public", sender_kind="user", sender_id=7, kind="voice",
                      text="", created_at=NOW))
    await s.commit()


async def test_new_room_defaults_and_v2_rows(app):
    async with app.state.sessionmaker() as s:
        await _room(s)
        room = await s.get(Room, "r1")
        assert (room.name, room.scenario, room.level, room.join_mode, room.max_members, room.allow_voice,
                room.invite_token) == ("", "free", "B1", "code", 4, True, None)
        s.add_all([
            RoomVoice(message_id="m1", room_id="r1", sender_id=7, duration_ms=6400, audio_path="room_audio/r1/m1.mp3",
                      audio_bytes=19200, audio_format="mp3", status="pending", created_at=NOW),
            RoomReaction(room_id="r1", message_id="m1", seq=1, user_id=7, key="like", created_at=NOW),
            RoomJoinRequest(id="q1", room_id="r1", user_id=7, status="pending", created_at=NOW),
            RoomSummary(room_id="r1", status="pending", created_at=NOW),
        ])
        await s.commit()
        voice = await s.get(RoomVoice, "m1")
        assert (voice.attempts, voice.translation_attempts, voice.transcript) == (0, 0, None)
        assert (await s.get(RoomSummary, "r1")).attempts == 0
        s.add(RoomReaction(room_id="r1", message_id="m1", seq=1, user_id=7, key="like", created_at=NOW))
        with pytest.raises(IntegrityError):
            await s.commit()


def test_settings_quota_keys_and_limits(app):
    s = app.state.settings
    assert (s.rooms_voice_enabled, s.rooms_voice_max_seconds, s.rooms_voice_store_format) == (False, 60, "mp3")
    assert (s.rooms_voice_daily_per_user, s.rooms_voice_global_daily, s.rooms_voice_quota_mb,
            s.rooms_voice_concurrency, s.rooms_translate_global_daily, s.rooms_summary_enabled,
            s.rooms_summary_global_daily) == (100, 3000, 200, 4, 3000, False, 200)
    assert s.rooms_voice_available is False and s.rooms_summary_available is False
    on = s.model_copy(update={"rooms_enabled": True, "rooms_voice_enabled": True, "rooms_summary_enabled": True})
    assert on.rooms_summary_available is bool(on.upstream_llm_base_url)
    assert {"rooms_voice_quota_mb", "rooms_voice_daily_per_user"} <= set(QUOTA_KEYS)
    limits = RoomLimits.from_settings(s.model_copy(update={"rooms_voice_max_seconds": 30, "rooms_voice_global_daily": 9}))
    assert (limits.voice_max_ms, limits.voice_global_daily, limits.voice_per_minute, limits.default_max_members) == (
        30_000, 9, 6, 4)
    assert (limits.voice_daily, limits.voice_quota_mb, limits.translate_global_daily, limits.summary_global_daily) == (
        100, 200, 3000, 200)
