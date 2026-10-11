"""今日任务聚合卡的服务端计数 `GET /api/links/today`(spec §6.2,计划 L2-1)。"""
import uuid
from datetime import timedelta

from app.models import Conversation, Message, utcnow
from tests.links_helpers import check_contract, enable_links
from tests.test_admin_api import register, seed_assessment


async def _chat(client, h, name: str) -> str:
    conv = (await client.post("/api/conversations", headers=h, json={"name": name})).json()
    r = await client.post(f"/api/conversations/{conv['id']}/messages", headers=h, json={"messages": [
        {"role": "user", "content": "hi"}, {"role": "assistant", "content": "hello"}]})
    assert r.status_code == 200, r.text
    return conv["id"]


async def test_counts_today_in_the_users_local_day(app, client):
    enable_links(app)
    uid, h = await register(client, "alice")
    await seed_assessment(app, uid, source="practice")
    await seed_assessment(app, uid, source="chat")
    await seed_assessment(app, uid, source="practice", at=utcnow() - timedelta(days=2))
    for name in ("a", "b"):
        await _chat(client, h, name)
    body = (await client.get("/api/links/today", headers=h, params={"offset": 0})).json()
    assert body == {"practice_today": 1, "chat_messages_today": 2, "conversations_today": 2}
    assert (await client.get("/api/links/today", headers=h, params={"offset": 900})).status_code == 422
    assert (await client.get("/api/links/today", headers=h, params={"offset": -721})).status_code == 422
    check_contract("links_daily_tasks_contract", {"today": body})


async def test_only_the_callers_rows_and_only_today_count(app, client):
    enable_links(app)
    uid, h = await register(client, "carol")
    other, oh = await register(client, "dave")
    await seed_assessment(app, other, source="practice")
    await _chat(client, oh, "theirs")
    conv_id = await _chat(client, h, "mine")
    async with app.state.sessionmaker() as s:  # 一条两天前的旧消息,不算今天
        s.add(Message(id=str(uuid.uuid4()), conversation_id=conv_id, role="user", content="old",
                      created_at=utcnow() - timedelta(days=2)))
        old = Conversation(id=str(uuid.uuid4()), user_id=uid, name="old")
        s.add(old)
        await s.flush()
        s.add(Message(id=str(uuid.uuid4()), conversation_id=old.id, role="user", content="older",
                      created_at=utcnow() - timedelta(days=3)))
        await s.commit()
    body = (await client.get("/api/links/today", headers=h)).json()
    assert body == {"practice_today": 0, "chat_messages_today": 1, "conversations_today": 1}


async def test_the_local_day_follows_the_offset(app, client):
    enable_links(app)
    uid, h = await register(client, "erin")
    now = utcnow()
    # 偏移 +840(UTC+14):本地今天从「本地午夜」开始;一条 25 小时前的记录必定不在本地今天
    await seed_assessment(app, uid, source="practice", at=now - timedelta(hours=25))
    for offset in (-720, 0, 840):
        body = (await client.get("/api/links/today", headers=h, params={"offset": offset})).json()
        assert body["practice_today"] == 0, offset
    await seed_assessment(app, uid, source="practice", at=now)
    for offset in (-720, 0, 840):
        body = (await client.get("/api/links/today", headers=h, params={"offset": offset})).json()
        assert body["practice_today"] == 1, offset


async def test_off_for_the_user_is_404(app, client):
    enable_links(app)
    _, h = await register(client, "bob")
    await client.put("/api/links/prefs", headers=h, json={"key": "daily_tasks", "enabled": False})
    r = await client.get("/api/links/today", headers=h)
    assert (r.status_code, r.json()) == (404, {"error": "Link is off"})


async def test_off_globally_or_master_off_is_404(app, client):
    _, h = await register(client, "frank")
    r = await client.get("/api/links/today", headers=h)
    assert (r.status_code, r.json()) == (404, {"error": "Link is off"})
    enable_links(app, link_daily_tasks_enabled=False)
    r = await client.get("/api/links/today", headers=h)
    assert (r.status_code, r.json()) == (404, {"error": "Link is off"})


async def test_requires_login(app, client):
    enable_links(app)
    assert (await client.get("/api/links/today")).status_code == 401
