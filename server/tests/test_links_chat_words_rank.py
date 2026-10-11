"""对话用到今日词 → 段位「最近获得」(计划 L5-3;验证 L5-1 + L6-1 的组合)。

L6-ENABLE: 段位读取 LinkCredit 的 `app/rank/extra_sources.py` 由 L6 车道提供。L6 合并前本用例自动跳过;合并后
`find_spec` 找到模块即自动启用,无需改动(若 L6 的模块名不同,改下面的 `L6_MODULE` 即可)。
"""
import importlib.util
from datetime import datetime, timedelta, timezone

import pytest

from tests.links_helpers import drain, enable_links
from tests.test_links_chat_words import learned

L6_MODULE = "app.rank.extra_sources"

pytestmark = pytest.mark.skipif(
    importlib.util.find_spec(L6_MODULE) is None,
    reason="L6-ENABLE: rank does not read link_credits until lane L6 (rank_sources) merges")


async def test_a_chat_use_shows_up_in_rank_recent_points(app, client):
    enable_links(app, rank_enabled=True)
    r = await client.post("/api/users", json={"username": "alice", "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    uid = int((await client.get("/api/me", headers=h)).json()["id"])
    await learned(app, uid, "talk", at=datetime.now(timezone.utc) - timedelta(hours=1))
    conv = (await client.post("/api/conversations", headers=h, json={"name": "c"})).json()
    await client.post(f"/api/conversations/{conv['id']}/messages", headers=h,
                      json={"messages": [{"role": "user", "content": "I talked"}]})
    await drain(app)
    me = (await client.get("/api/rank/me", headers=h)).json()
    assert "word_in_chat" in [e["kind"] for e in me["recent_events"]]
