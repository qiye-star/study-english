"""Payload shapes of /api/chat-home/* (plan 2026-10-23 §5.1, S10): the web contract test reads the same fixture.
Re-record after an intentional change: `CONTRACT_UPDATE=1 uv run pytest -q tests/test_chat_home_contract.py`.
Ids and times are fixed by `agents_helpers.stable`; the clock is pinned so the dates in the fixture do not drift."""
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest

from app.models import ChatGreeting
from tests.agents_helpers import FakeLLM, check_contract, use_fake_llm
from tests.test_admin_api import register
from tests.test_chat_home_parse import DEMO_EN
from tests.test_chat_home_service import FACTS, answer, facts_answer

BASE = "/api/chat-home"
NOW = datetime(2026, 10, 23, 8, 42, tzinfo=timezone.utc)
FIXTURE = Path(__file__).parent / "fixtures" / "chat_home_contract.json"
KEYS = {"config", "settings", "settings_patched", "today_bilingual", "today_zh", "today_en", "today_no_stats",
        "today_pending", "today_off", "seen"}
GREETING_KEYS = {"id", "message_ids", "source", "language", "generated_at", "lines", "facts", "first_view"}
CONVERSATION_KEYS = {"id", "name", "config", "daily_date", "created_at", "updated_at"}


@pytest.fixture
def settings_overrides():
    return {"chat_home_enabled": True, "agents_enabled": True}


async def today(client, headers):
    r = await client.post(f"{BASE}/today", headers=headers, json={"tz_offset_minutes": 480,
                                                                   "client_request_id": str(uuid.uuid4())})
    assert r.status_code == 200, r.text
    return r.json()


async def configure(client, headers, **prefs):
    r = await client.patch(f"{BASE}/settings", headers=headers, json=prefs)
    assert r.status_code == 200, r.text
    return r.json()


async def test_chat_home_payloads_match_the_web_contract(app, client, monkeypatch):
    monkeypatch.setattr("app.routers.chat_home.utcnow", lambda: NOW)
    await use_fake_llm(app, FakeLLM(texts=(facts_answer("bilingual"),)))
    _, bi = await register(client, "bilin")
    config = (await client.get(f"{BASE}/config", headers=bi)).json()
    settings = (await client.get(f"{BASE}/settings", headers=bi)).json()
    patched = await configure(client, bi, language="bilingual", include_stats=True)
    async def known(app_, ctx):  # this learner has facts, so the model's placeholders are offered and filled by code
        return FACTS

    with monkeypatch.context() as scoped:
        scoped.setattr("app.agents.greeting.service.facts_mod.gather", known)
        ready_bi = await today(client, bi)
    seen = (await client.post(f"{BASE}/greetings/{ready_bi['greeting']['id']}/seen", headers=bi)).json()

    _, zh = await register(client, "zhuser")
    await use_fake_llm(app, FakeLLM(texts=(answer("zh"),)))
    await configure(client, zh, language="zh")
    ready_zh = await today(client, zh)

    _, en = await register(client, "enuser")
    await use_fake_llm(app, FakeLLM(texts=(answer("en"),)))
    await configure(client, en, language="en")
    ready_en = await today(client, en)

    uid_stats, stats_off = await register(client, "nostats")
    await configure(client, stats_off, language="en", include_stats=False)
    no_stats = await today(client, stats_off)

    uid_pending, pending_headers = await register(client, "pendinguser")
    async with app.state.sessionmaker() as s:
        s.add(ChatGreeting(user_id=uid_pending, local_date=datetime(2026, 10, 23).date(), status="pending",
                           language="bilingual", persona_id="builtin:partner", message_ids=[], lines=[], facts={},
                           created_at=NOW, updated_at=NOW))
        await s.commit()
    pending = await today(client, pending_headers)

    _, off_headers = await register(client, "offuser")
    await configure(client, off_headers, greeting_trigger="off")
    off = await today(client, off_headers)

    actual = {"config": config, "settings": settings, "settings_patched": patched, "today_bilingual": ready_bi,
              "today_zh": ready_zh, "today_en": ready_en, "today_no_stats": no_stats, "today_pending": pending,
              "today_off": off, "seen": seen}
    assert set(actual) == KEYS
    check_contract("chat_home_contract", actual)

    expected = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert set(expected) == KEYS
    assert expected["config"] == {"enabled": True, "llm": True}
    assert set(expected["settings"]) == {"greeting_trigger", "language", "daily_persona_id", "include_stats"}
    for key, language in (("today_bilingual", "bilingual"), ("today_zh", "zh"), ("today_en", "en")):
        body = expected[key]
        assert set(body) == {"local_date", "status", "conversation", "greeting"} and body["status"] == "ready"
        assert body["local_date"] == "2026-10-23" and body["conversation"]["daily_date"] == "2026-10-23"
        assert set(body["conversation"]) == CONVERSATION_KEYS
        greeting = body["greeting"]
        assert set(greeting) == GREETING_KEYS and greeting["language"] == language
        assert len(greeting["lines"]) == len(greeting["message_ids"]) == 3  # exactly three paragraphs
        assert greeting["generated_at"] and isinstance(greeting["first_view"], bool)
        assert greeting["source"] in ("llm", "template") and isinstance(greeting["facts"], dict)
        keys = {"bilingual": {"en", "zh"}, "zh": {"zh"}, "en": {"en"}}[language]
        assert all(set(line) == keys for line in greeting["lines"])
        config = body["conversation"]["config"]  # snake_case only (plan §1 item 22)
        assert "agent_persona_id" in config and "bilingual" in config
        assert not any(any(c.isupper() for c in k) for k in config)
    assert "zh_note" in expected["today_zh"]["conversation"]["config"] and "zh_note" in expected["today_bilingual"]["conversation"]["config"]
    assert "zh_note" not in expected["today_en"]["conversation"]["config"]
    # emphasis: at least one line carries three legal *marks* (the demo's second English paragraph, all three filled by code)
    en_lines = [line["en"] for line in expected["today_bilingual"]["greeting"]["lines"]]
    assert en_lines[1].count("*") == 6 and en_lines == DEMO_EN
    assert expected["today_no_stats"]["greeting"]["facts"] == {}
    assert expected["today_pending"]["status"] == "pending" and expected["today_pending"]["greeting"] is None
    assert expected["today_off"]["status"] == "off" and expected["today_off"]["greeting"] is None
    assert expected["today_off"]["conversation"]["daily_date"] == "2026-10-23"
    assert set(expected["seen"]) == {"first_seen_at"}
    assert expected["settings_patched"]["include_stats"] is True
    raw = FIXTURE.read_text(encoding="utf-8")
    assert "Bearer" not in raw and "access_token" not in raw
