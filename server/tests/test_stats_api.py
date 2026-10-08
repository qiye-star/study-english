from datetime import timedelta

import pytest

from app.services import stats as stats_rules
from app.models import Assessment, Message, utcnow

URL = "/api/stats"
GRAMMAR = {"has_errors": True, "corrected": "Yesterday I went home.",
           "errors": [{"original": "go", "corrected": "went", "category": "tense", "explanation": "past"}]}


async def register(client, username):
    r = await client.post("/api/users", json={"username": username, "password": "password123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def uid_of(client, headers) -> int:
    return int((await client.get("/api/me", headers=headers)).json()["id"])


async def conversation(client, headers) -> str:
    return (await client.post("/api/conversations", headers=headers, json={})).json()["id"]


async def seed_message(app, cid, *, ago=timedelta(0), role="user", grammar=None):
    async with app.state.sessionmaker() as s:
        s.add(Message(conversation_id=cid, role=role, content="Yesterday I go home.", grammar=grammar, created_at=utcnow() - ago))
        await s.commit()


async def seed_assessment(app, uid, *, ago=timedelta(0), score=80, duration_ms=2500, words=()):
    detail = {"words": [{"word": w, "pronunciation_assessment": {"accuracy_score": a, "error_type": e}} for w, a, e in words]}
    async with app.state.sessionmaker() as s:
        s.add(Assessment(
            user_id=uid, reference_text="x", language="en-US", duration_ms=duration_ms, audio_bytes=0,
            scores={"pronunciation_score": score}, result={"detail_result": detail}, audio_path="", source="practice",
            created_at=utcnow() - ago,
        ))
        await s.commit()


async def test_requires_login(client):
    assert (await client.get(URL)).status_code == 401


async def test_empty_user(client, auth_headers):
    r = await client.get(URL, headers=auth_headers)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["days"] == 7 and len(out["daily"]) == 7 and out["tz_offset_minutes"] == 0
    assert (out["user_messages"], out["assessments"], out["streak_days"], out["avg_pronunciation"], out["truncated"]) == (0, 0, 0, None, False)


@pytest.mark.parametrize("params,error", [({"days": 14}, "Invalid days"), ({"days": 0}, "Invalid days")])
async def test_invalid_days(client, auth_headers, params, error):
    r = await client.get(URL, headers=auth_headers, params=params)
    assert r.status_code == 422 and r.json() == {"error": error}


@pytest.mark.parametrize("offset", [-721, 841])
async def test_invalid_offset(client, auth_headers, offset):
    assert (await client.get(URL, headers=auth_headers, params={"tz_offset_minutes": offset})).status_code == 422


async def test_counts_only_the_callers_data(app, client, auth_headers):
    cid = await conversation(client, auth_headers)
    await seed_message(app, cid, grammar=GRAMMAR)
    await seed_message(app, cid)
    await seed_message(app, cid, role="assistant")  # 助手消息不计
    await seed_assessment(app, await uid_of(client, auth_headers), words=[("Think", 30, "None"), ("so", 95, "None")])
    bob = await register(client, "bob")
    await seed_message(app, await conversation(client, bob))
    await seed_assessment(app, await uid_of(client, bob), score=10, words=[("bad", 0, "Omission")])

    out = (await client.get(URL, headers=auth_headers, params={"days": 30, "tz_offset_minutes": 480})).json()
    assert (out["days"], len(out["daily"]), out["tz_offset_minutes"]) == (30, 30, 480)
    assert (out["user_messages"], out["assessments"], out["speaking_seconds"], out["avg_pronunciation"]) == (2, 1, 2.5, 80.0)
    assert out["grammar_top"] == [{"category": "tense", "count": 1}]
    assert out["poor_words"] == [{"word": "think", "count": 1}]
    assert out["streak_days"] == 1 and out["active_days"] == 1 and any(d["active"] for d in out["daily"][-2:])
    bobs = (await client.get(URL, headers=bob)).json()
    assert (bobs["user_messages"], bobs["assessments"], bobs["poor_words"]) == (1, 1, [{"word": "bad", "count": 1}])


async def test_period_window(app, client, auth_headers):
    cid = await conversation(client, auth_headers)
    await seed_message(app, cid, ago=timedelta(days=10))
    await seed_message(app, cid, ago=timedelta(days=100))  # 超出 90 天扫描范围
    assert (await client.get(URL, headers=auth_headers, params={"days": 7})).json()["user_messages"] == 0
    assert (await client.get(URL, headers=auth_headers, params={"days": 30})).json()["user_messages"] == 1
    assert (await client.get(URL, headers=auth_headers, params={"days": 90})).json()["user_messages"] == 1


async def test_scans_are_bounded(app, client, auth_headers, monkeypatch):
    monkeypatch.setattr(stats_rules, "MAX_STATS_MESSAGES", 3)
    monkeypatch.setattr(stats_rules, "MAX_POOR_WORD_ASSESSMENTS", 1)
    cid = await conversation(client, auth_headers)
    for i in range(4):
        await seed_message(app, cid, ago=timedelta(minutes=i))
    uid = await uid_of(client, auth_headers)
    await seed_assessment(app, uid, ago=timedelta(minutes=5), words=[("older", 10, "None")])
    await seed_assessment(app, uid, ago=timedelta(minutes=1), words=[("newer", 10, "None")])
    out = (await client.get(URL, headers=auth_headers)).json()
    assert out["truncated"] is True and out["user_messages"] == 3
    assert out["poor_words"] == [{"word": "newer", "count": 1}]
    assert out["assessments"] == 2


@pytest.mark.parametrize("settings_overrides", [{"ai_rate_limit_per_minute": 2}], indirect=True)
async def test_rate_limited_per_user(client, auth_headers):
    assert (await client.get(URL, headers=auth_headers)).status_code == 200
    assert (await client.get(URL, headers=auth_headers)).status_code == 200
    r = await client.get(URL, headers=auth_headers)
    assert r.status_code == 429 and r.json() == {"error": "Too many requests, please try again later"}


@pytest.mark.parametrize("offset", [-720, -300, 0, 330, 840])
async def test_daily_buckets_follow_the_client_offset(app, client, auth_headers, offset):
    cid = await conversation(client, auth_headers)
    uid = await uid_of(client, auth_headers)
    ages = [timedelta(hours=1), timedelta(days=1, hours=3), timedelta(days=3, hours=20)]
    for ago in ages:
        await seed_message(app, cid, ago=ago)
        await seed_assessment(app, uid, ago=ago, score=60, duration_ms=1000)
    now = utcnow()
    out = (await client.get(URL, headers=auth_headers, params={"days": 7, "tz_offset_minutes": offset})).json()
    expected: dict[str, int] = {}
    for ago in ages:
        day = stats_rules.local_date(now - ago, offset).isoformat()
        expected[day] = expected.get(day, 0) + 1
    assert out["today"] == stats_rules.local_date(now, offset).isoformat()
    got = {d["date"]: d["user_messages"] for d in out["daily"] if d["user_messages"]}
    assert got == expected
    assert all(d["assessments"] == d["user_messages"] and d["speaking_seconds"] == d["assessments"] for d in out["daily"])
    assert out["user_messages"] == out["assessments"] == 3 and out["avg_pronunciation"] == 60.0
