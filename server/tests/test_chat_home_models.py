"""Migration 0031 and the chat-home models (plan 2026-10-23-chat-home-daily-greeting §4, S1)."""
import json
import sqlite3

import pytest
from alembic import command
from alembic.script import ScriptDirectory
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.models import ChatGreeting, ChatPrefs, Conversation, utcnow
from tests.admin_helpers import ADMIN_ENABLED, PASSWORD, login_as
from tests.test_admin_api import register
from tests.test_migrations import _config, _tables


@pytest.fixture
def settings_overrides(tmp_path):
    return {**ADMIN_ENABLED, "data_dir": str(tmp_path / "data")}


def test_head_is_0031_and_follows_0030(tmp_path, monkeypatch):
    cfg, _db = _config(tmp_path, monkeypatch)
    script = ScriptDirectory.from_config(cfg)
    assert script.get_heads() == ["0031"]
    assert script.get_revision("0031").down_revision == "0030"


def test_0031_adds_daily_date_and_tables_and_round_trips(tmp_path, monkeypatch):
    cfg, db = _config(tmp_path, monkeypatch)
    command.upgrade(cfg, "0030")
    assert not {"chat_greetings", "chat_prefs"} & _tables(db)
    command.upgrade(cfg, "0031")
    con = sqlite3.connect(db)
    try:
        assert {"chat_greetings", "chat_prefs"} <= _tables(db)
        cols = {r[1]: r for r in con.execute("pragma table_info(conversations)")}
        assert "daily_date" in cols and cols["daily_date"][3] == 0
        con.execute("insert into users (id, username, password_hash, created_at) values (12345678, 'u', 'x', '2026-10-23')")

        def conv(cid, daily):
            con.execute("insert into conversations (id, user_id, name, config, daily_date, created_at, updated_at) "
                        "values (?, 12345678, 'n', '{}', ?, '2026-10-23', '2026-10-23')", (cid, daily))

        conv("a", None)
        conv("b", None)  # NULL daily_date never conflicts
        conv("c", "2026-10-23")
        with pytest.raises(sqlite3.IntegrityError):
            conv("d", "2026-10-23")
        lines = [{"en": "Hi *there*", "zh": "你好"}] * 3
        con.execute("insert into chat_greetings (id, user_id, local_date, conversation_id, message_ids, status, language, "
                    "persona_id, lines, facts, created_at, updated_at) values ('g', 12345678, '2026-10-23', 'c', ?, 'ready', "
                    "'bilingual', 'builtin:partner', ?, '{}', '2026-10-23', '2026-10-23')",
                    (json.dumps(["m1", "m2", "m3"]), json.dumps(lines)))
        row = con.execute("select message_ids, lines from chat_greetings").fetchone()
        assert json.loads(row[0]) == ["m1", "m2", "m3"] and json.loads(row[1]) == lines
        with pytest.raises(sqlite3.IntegrityError):
            con.execute("insert into chat_greetings (id, user_id, local_date, message_ids, status, language, persona_id, "
                        "lines, facts, created_at, updated_at) values ('h', 12345678, '2026-10-23', '[]', 'pending', 'en', "
                        "'p', '[]', '{}', '2026-10-23', '2026-10-23')")
        con.commit()
    finally:
        con.close()
    command.downgrade(cfg, "0030")
    con = sqlite3.connect(db)
    try:
        assert not {"chat_greetings", "chat_prefs"} & _tables(db)
        assert "daily_date" not in {r[1] for r in con.execute("pragma table_info(conversations)")}
        assert con.execute("select count(*) from conversations").fetchone()[0] == 3  # a, b, c survive
    finally:
        con.close()
    command.upgrade(cfg, "head")


async def test_models_enforce_uniqueness_and_round_trip_json(app, client):
    uid, _ = await register(client, "gina")
    now = utcnow()
    async with app.state.sessionmaker() as s:
        s.add(Conversation(id="c1", user_id=uid, name="n", config={}, daily_date=None, created_at=now, updated_at=now))
        s.add(Conversation(id="c2", user_id=uid, name="n", config={}, daily_date=None, created_at=now, updated_at=now))
        s.add(Conversation(id="c3", user_id=uid, name="2026-10-23", config={}, daily_date=now.date(),
                           created_at=now, updated_at=now))
        await s.commit()
    async with app.state.sessionmaker() as s:
        s.add(Conversation(id="c4", user_id=uid, name="dup", config={}, daily_date=now.date(), created_at=now,
                           updated_at=now))
        with pytest.raises(IntegrityError):
            await s.commit()
    kw = dict(user_id=uid, local_date=now.date(), status="ready", language="en", persona_id="builtin:partner",
              created_at=now, updated_at=now)
    async with app.state.sessionmaker() as s:
        s.add(ChatGreeting(id="g1", conversation_id="c3", message_ids=["a", "b", "c"], lines=[{"en": "x"}] * 3,
                           facts={"streak": 3}, **kw))
        await s.commit()
    async with app.state.sessionmaker() as s:
        g = await s.get(ChatGreeting, "g1")
        assert g.message_ids == ["a", "b", "c"] and g.lines == [{"en": "x"}] * 3 and g.facts == {"streak": 3}
        s.add(ChatGreeting(id="g2", message_ids=[], lines=[], facts={}, **kw))
        with pytest.raises(IntegrityError):
            await s.commit()


async def test_delete_user_removes_greetings_and_prefs(app, client):
    uid, _ = await register(client, "hank")
    other, _ = await register(client, "ivy")
    now = utcnow()
    async with app.state.sessionmaker() as s:
        for u in (uid, other):
            s.add(Conversation(id=f"c{u}", user_id=u, name="n", config={}, daily_date=now.date(), created_at=now,
                               updated_at=now))
            s.add(ChatGreeting(user_id=u, local_date=now.date(), conversation_id=f"c{u}", message_ids=[], status="ready",
                               language="en", persona_id="p", lines=[], facts={}, created_at=now, updated_at=now))
            s.add(ChatPrefs(user_id=u, data={"language": "zh"}, updated_at=now))
        await s.commit()
    h = await login_as(app, client, "superadmin")
    await client.post("/api/admin/step-up", headers=h, json={"password": PASSWORD})
    r = await client.request("DELETE", f"/api/admin/users/{uid}", headers=h,
                             json={"confirm_username": "hank", "reason": "用户要求注销"})
    assert r.status_code == 200, r.text
    async with app.state.sessionmaker() as s:
        for model in (ChatGreeting, ChatPrefs):
            ids = list((await s.scalars(select(model.user_id))).all())
            assert ids == [other]
        assert await s.scalar(select(func.count()).select_from(Conversation)) == 1
