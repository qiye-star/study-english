"""对话用到今日词 → 段位「最近获得」(计划 L5-3;验证 L5-1 + L6-1 的组合)。"""
from datetime import datetime, timedelta, timezone

from tests.links_helpers import drain, enable_links
from tests.test_links_chat_words import learned


async def _chat_after_learning(app, client, name):
    r = await client.post("/api/users", json={"username": name, "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    uid = int((await client.get("/api/me", headers=h)).json()["id"])
    await learned(app, uid, "talk", at=datetime.now(timezone.utc) - timedelta(hours=1))
    return h


async def _say(app, client, h, text):
    conv = (await client.post("/api/conversations", headers=h, json={"name": "c"})).json()
    await client.post(f"/api/conversations/{conv['id']}/messages", headers=h,
                      json={"messages": [{"role": "user", "content": text}]})
    await drain(app)
    return (await client.get("/api/rank/me", headers=h)).json()


async def test_a_chat_use_shows_up_in_rank_recent_points(app, client):
    enable_links(app, rank_enabled=True)
    h = await _chat_after_learning(app, client, "alice")
    me = await _say(app, client, h, "I talked")
    credited = [e for e in me["recent_events"] if e["kind"] == "word_in_chat"]
    assert len(credited) == 1 and credited[0]["points"] == 1
    me = await _say(app, client, h, "We talk a lot")  # the same learned word again: no second credit
    assert len([e for e in me["recent_events"] if e["kind"] == "word_in_chat"]) == 1


async def test_turning_off_rank_points_from_links_keeps_rank_unchanged(app, client):
    enable_links(app, rank_enabled=True)
    h = await _chat_after_learning(app, client, "bob")
    r = await client.put("/api/links/prefs", headers=h, json={"key": "rank_sources", "enabled": False})
    assert r.status_code == 200
    me = await _say(app, client, h, "I talked")
    assert "word_in_chat" not in [e["kind"] for e in me["recent_events"]]
