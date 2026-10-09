import pytest

from tests.conftest import make_settings


def test_flags_default_off():
    s = make_settings()
    assert (s.rank_enabled, s.rooms_enabled) == (False, False)
    assert (s.rank_match_available, s.rooms_ai_available) == (False, False)
    assert s.rank_season_anchor.isoformat() == "2026-11-02"


def test_match_available_needs_llm_and_speech_recognition():
    assert make_settings(rank_enabled=True).rank_match_available is True
    assert make_settings(rank_enabled=True, upstream_llm_base_url="").rank_match_available is False
    assert make_settings(rank_enabled=True, upstream_whisper_base_url="").rank_match_available is False


def test_rooms_ai_needs_llm():
    assert make_settings(rooms_enabled=True).rooms_ai_available is True
    assert make_settings(rooms_enabled=True, upstream_llm_base_url="").rooms_ai_available is False


def test_resolved_models_fall_back_to_default():
    s = make_settings(rank_judge_model="  ", rooms_ai_model="gpt-4o-mini")
    assert s.resolved_rank_judge_model == "gpt-4o"
    assert s.resolved_rooms_ai_model == "gpt-4o-mini"


async def test_config_requires_auth(client):
    assert (await client.get("/api/rank/config")).status_code == 401
    assert (await client.get("/api/rooms/config")).status_code == 401


async def test_config_reports_disabled_and_other_paths_404(client, auth_headers):
    r = await client.get("/api/rank/config", headers=auth_headers)
    assert r.json() == {"enabled": False, "match_available": False, "tiers": [], "season": None}
    r = await client.get("/api/rooms/config", headers=auth_headers)
    rooms = r.json()
    assert {k: rooms[k] for k in ("enabled", "ai_available", "max_members", "max_text")} == {
        "enabled": False, "ai_available": False, "max_members": 8, "max_text": 500}
    # rooms v2 fields (spec 2026-10-10 §8): costly sub-features report unavailable while rooms are off
    assert (rooms["voice_available"], rooms["summary_available"], rooms["default_max_members"], rooms["max_voice_ms"]) == (
        False, False, 4, 60_000)
    r = await client.get("/api/rank/me", headers=auth_headers)
    assert r.status_code == 404 and r.json() == {"error": "Rank is disabled"}
    r = await client.get("/api/rooms/mine", headers=auth_headers)
    assert r.status_code == 404 and r.json() == {"error": "Rooms are disabled"}


@pytest.mark.parametrize("settings_overrides", [{"rank_enabled": True, "rooms_enabled": True}], indirect=True)
async def test_config_reports_enabled(client, auth_headers):
    assert (await client.get("/api/rank/config", headers=auth_headers)).json()["enabled"] is True
    rooms = (await client.get("/api/rooms/config", headers=auth_headers)).json()
    assert rooms["enabled"] is True and rooms["ai_available"] is True


def test_room_messages_are_kept_forever_by_default():
    assert make_settings().room_message_retention_days == 0
    assert make_settings(room_message_retention_days=30).room_message_retention_days == 30
