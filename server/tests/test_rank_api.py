import json
from pathlib import Path

import pytest

from app.models import RankProfile, utcnow
from app.rank import match as match_module
from app.rank import points
from app.speech.stt import pcm_to_wav
from tests.test_rank_match import Fakes

pytestmark = pytest.mark.parametrize("settings_overrides", [{"rank_enabled": True}], indirect=True)
CONTRACT = json.loads((Path(__file__).parent / "fixtures" / "rank_contract.json").read_text(encoding="utf-8"))
WAV = pcm_to_wav(b"\x10\x00" * 16000 * 3)


def shape(value):
    if isinstance(value, dict):
        return {k: shape(v) for k, v in sorted(value.items())}
    if isinstance(value, list):  # lists of objects compare their first item; lists of scalars compare as []
        return [shape(value[0])] if value and isinstance(value[0], (dict, list)) else []
    return None


async def uid_of(client, headers):
    return int((await client.get("/api/me", headers=headers)).json()["id"])


@pytest.fixture
async def eligible_user(app, client, auth_headers, monkeypatch):
    monkeypatch.setitem(points.STAGE_TASKS, 2, ())
    fakes = Fakes()
    monkeypatch.setattr("app.routers.rank.build_deps", lambda request, settings, user_id: fakes.deps())
    uid = await uid_of(client, auth_headers)
    async with app.state.sessionmaker() as s:
        now = utcnow()
        s.add(RankProfile(user_id=uid, tier=2, division=1, rp=120, stars=0, best_tier=2, tier_started_at=now,
                          synced_at=now, updated_at=now))
        await s.commit()
    return fakes


async def test_config_and_me_match_the_contract(client, auth_headers):
    config = (await client.get("/api/rank/config", headers=auth_headers)).json()
    assert shape(config)["tiers"] == shape(CONTRACT["config"])["tiers"] and len(config["tiers"]) == 7
    me = await client.get("/api/rank/me", params={"tz_offset_minutes": 480}, headers=auth_headers)
    assert me.status_code == 200
    body = me.json()
    assert set(body) == set(CONTRACT["me"])
    assert (body["tier"], body["division"], body["promotion"]["state"]) == ("bronze", 3, "locked")
    assert shape(body["stage_tasks"]) == shape(CONTRACT["me"]["stage_tasks"])
    achievements = (await client.get("/api/rank/achievements", headers=auth_headers)).json()
    assert shape(achievements) == shape(CONTRACT["achievements"])


async def test_full_match_over_http(client, auth_headers, eligible_user):
    started = await client.post("/api/rank/matches", params={"tz_offset_minutes": 0}, headers=auth_headers)
    assert started.status_code == 200, started.text
    match = started.json()["match"]
    assert shape(match) == shape(CONTRACT["match"])
    assert (await client.post("/api/rank/matches", headers=auth_headers)).json() == {"error": "Match in progress"}
    for i in range(match["turn_limit"]):
        r = await client.post(f"/api/rank/matches/{match['id']}/turns", headers=auth_headers,
                              files={"file": ("t.wav", WAV, "audio/wav")})
        assert r.status_code == 200, r.text
        assert shape(r.json()) == shape(CONTRACT["turn"]) or r.json()["done"]
    finished = await client.post(f"/api/rank/matches/{match['id']}/finish", headers=auth_headers)
    assert finished.status_code == 200
    assert shape(finished.json()) == shape(CONTRACT["finish_pass"])
    me = (await client.get("/api/rank/me", headers=auth_headers)).json()
    assert (me["tier"], me["division"]) == ("platinum", 3)
    history = (await client.get("/api/rank/matches", headers=auth_headers)).json()
    assert [h["status"] for h in history["matches"]] == ["passed"] and "turns" not in history["matches"][0]


async def test_errors_and_isolation(client, auth_headers, eligible_user):
    match = (await client.post("/api/rank/matches", headers=auth_headers)).json()["match"]
    r = await client.post(f"/api/rank/matches/{match['id']}/turns", headers=auth_headers,
                          files={"file": ("t.wav", pcm_to_wav(b"\x00\x00" * 4000), "audio/wav")})
    assert (r.status_code, r.json()) == (400, {"error": "Audio too short"})
    other = await client.post("/api/users", json={"username": "bob", "password": "password123"})
    bob = {"Authorization": f"Bearer {other.json()['access_token']}"}
    assert (await client.get(f"/api/rank/matches/{match['id']}", headers=bob)).status_code == 404
    assert (await client.post(f"/api/rank/matches/{match['id']}/finish", headers=auth_headers)).json() == {"error": "Match is not finished"}
    abandon = await client.post(f"/api/rank/matches/{match['id']}/abandon", headers=auth_headers)
    assert abandon.json()["match"]["status"] == "abandoned"
    again = await client.post("/api/rank/matches", headers=auth_headers)
    assert (again.status_code, again.json()) == (403, {"error": "Not eligible"})


async def test_turn_logs_never_include_transcripts(client, auth_headers, eligible_user, caplog):
    eligible_user.transcript = "MY-PRIVATE-WORDS are here today"
    match = (await client.post("/api/rank/matches", headers=auth_headers)).json()["match"]
    await client.post(f"/api/rank/matches/{match['id']}/turns", headers=auth_headers, files={"file": ("t.wav", WAV, "audio/wav")})
    assert "MY-PRIVATE-WORDS" not in caplog.text


async def test_rank_me_writes_nothing_in_read_only_maintenance(app, client, auth_headers):
    """Review correctness m6: read_only (e.g. a backup window) must not let GET /api/rank/me sync and commit."""
    from sqlalchemy import func, select

    from app.core.runtime_settings import compose
    from app.models import UserAchievement, XpEvent

    app.state.settings_hub.publish(compose(app.state.base_settings, {"rank_enabled": True,
                                                                     "maintenance_mode": "read_only"}))
    r = await client.get("/api/rank/me", headers=auth_headers)
    assert r.status_code == 200 and r.json()["tier"] == "bronze" and r.json()["new_achievements"] == []
    async with app.state.sessionmaker() as s:
        for model in (RankProfile, XpEvent, UserAchievement):
            assert await s.scalar(select(func.count()).select_from(model)) == 0, model.__name__
