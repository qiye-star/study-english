"""全开 / 全关矩阵(spec §15):既有接口的响应在联动开关的任何组合下逐值相同(去掉 id 与时间);只有开时才写联动表。"""
from contextlib import asynccontextmanager

import httpx
import pytest
from sqlalchemy import func, select

from app.core.db import Base
from app.links.spec import LINK_KEYS, flag_of
from app.main import create_app
from app.models import LinkCredit, LinkMistakeWord, LinkWeakWord, LinkWordUse, UserLinkPref
from tests.conftest import make_settings
from tests.wordbook_helpers import enable_wordbook, make_data_dir

OFF = {"links_enabled": False}
MATRIX = [{"links_enabled": True},
          *({"links_enabled": True, **{flag_of(k): k == only for k in LINK_KEYS}} for only in LINK_KEYS)]
VOLATILE = ("id", "created_at", "updated_at", "due_at", "started_at", "last_reviewed_at", "conversation_id")
LINK_TABLES = (LinkMistakeWord, LinkWeakWord, LinkWordUse, LinkCredit, UserLinkPref)


def strip(body):
    """去掉每次都会变的值(id、时间),只比较键与稳定值。"""
    if isinstance(body, dict):
        return {k: strip(v) for k, v in body.items() if k not in VOLATILE}
    if isinstance(body, list):
        return [strip(v) for v in body]
    return body


@asynccontextmanager
async def fresh(tmp_path):
    application = create_app(make_settings(data_dir=str(tmp_path / "data")))
    async with application.state.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application), base_url="http://test") as c:
            yield application, c
    finally:
        await application.state.http.aclose()
        await application.state.engine.dispose()


async def scenario(app, client, tmp_path, flags):
    enable_wordbook(app, make_data_dir(tmp_path))
    app.state.settings = app.state.settings.model_copy(update=flags)
    r = await client.post("/api/users", json={"username": "alice", "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    out = {"enroll": (await client.put("/api/wordbook/enrollment", headers=h, json={"book_id": "junior", "order_mode": "book"})).json()}
    out["wrong"] = (await client.post("/api/wordbook/answers", headers=h, json={
        "book_id": "junior", "tz_offset_minutes": 480, "key": "talk", "mode": "learn", "qtype": "meaning", "choice": "x"})).json()
    out["rated"] = (await client.post("/api/wordbook/answers", headers=h, json={
        "book_id": "junior", "tz_offset_minutes": 480, "key": "ability", "mode": "learn", "qtype": "recall",
        "rating": "unknown"})).json()
    conv = (await client.post("/api/conversations", headers=h, json={"name": "c"})).json()
    out["messages"] = (await client.post(f"/api/conversations/{conv['id']}/messages", headers=h,
                                         json={"messages": [{"role": "user", "content": "We talked."}]})).json()
    out["vocab"] = (await client.get("/api/vocabulary", headers=h, params={"scope": "all"})).json()
    out["today"] = (await client.get("/api/wordbook/today", headers=h, params={"tz_offset_minutes": 480})).json()
    await app.state.learning_bus.drain()
    async with app.state.sessionmaker() as s:
        rows = {m.__tablename__: await s.scalar(select(func.count()).select_from(m)) for m in LINK_TABLES}
    return strip(out), rows


async def test_all_off_writes_nothing_and_queues_nothing(app, client, tmp_path):
    body, rows = await scenario(app, client, tmp_path, OFF)
    assert set(body) == {"enroll", "wrong", "rated", "messages", "vocab", "today"}
    assert body["wrong"]["outcome"] == "wrong" and body["rated"]["outcome"] == "unknown"
    assert set(rows.values()) == {0}
    assert app.state.learning_bus.queue() == {"size": 0, "max": 1000, "dropped": 0}
    assert all(s["published"] == 0 for s in app.state.learning_bus.stats().values())


@pytest.mark.parametrize("flags", MATRIX, ids=["all_on", *(f"only_{k}" for k in LINK_KEYS)])
async def test_existing_responses_do_not_depend_on_links(tmp_path, flags):
    for name in ("off", "on"):
        (tmp_path / name).mkdir()
    async with fresh(tmp_path / "off") as (app, client):
        off, _ = await scenario(app, client, tmp_path / "off", OFF)
    async with fresh(tmp_path / "on") as (app, client):
        on, _ = await scenario(app, client, tmp_path / "on", flags)
    assert on == off
