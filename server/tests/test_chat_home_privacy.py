"""Privacy of the chat-home feature (plan 2026-10-23 R13, S10): the route table is pinned, URLs carry only ids, and a full
generation (model call, custom published prompt, facts with words, a custom persona) leaves no text, word, user id,
persona text or prompt text in the logs."""
import json
import logging
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.main import create_app
from app.models import ChatGreeting, LinkMistakeWord, Message, PromptVersion, VocabularyItem
from tests.agents_helpers import FakeLLM, use_fake_llm
from tests.conftest import make_settings
from tests.test_admin_api import register
from tests.test_admin_routes_guarded import api_routes
from tests.test_chat_home_parse import DEMO_EN, DEMO_SUB
from tests.test_chat_home_service import answer

BASE = "/api/chat-home"
ROUTES = {("GET", "/api/chat-home/config"), ("GET", "/api/chat-home/settings"), ("PATCH", "/api/chat-home/settings"),
          ("POST", "/api/chat-home/today"), ("POST", "/api/chat-home/greetings/{greeting_id}/seen")}
SECRET_WORD, SECRET_PERSONA, SECRET_PROMPT = "zebrafishword", "SECRET-PERSONA-TEXT", "SECRET-PROMPT-BODY"
NOW = datetime(2026, 10, 23, 8, 42, tzinfo=timezone.utc)


@pytest.fixture
def settings_overrides():
    return {"chat_home_enabled": True, "agents_enabled": True}


def test_the_route_table_is_pinned_and_urls_carry_only_ids():
    """A new chat-home route must be added here on purpose: path params are ids, there are no query parameters
    (the offset travels in the POST body)."""
    found = {}
    for path, route in api_routes(create_app(make_settings()).routes):
        if path.startswith(BASE):
            for method in route.methods - {"HEAD"}:
                found[(method, path)] = route
    assert set(found) == ROUTES
    for route in found.values():
        assert {p.name for p in route.dependant.path_params} <= {"greeting_id"}
        assert {q.name for q in route.dependant.query_params} == set()


def test_the_chat_home_modules_never_put_text_in_logs():
    """Static check: the only log calls in the greeting package carry source keys, error class names, kinds and counts."""
    from pathlib import Path
    root = Path(__file__).resolve().parents[1] / "app"
    sources = [root / "routers" / "chat_home.py", *sorted((root / "agents" / "greeting").glob("*.py")),
               root / "links" / "greeting_facts.py"]
    for path in sources:
        text = path.read_text(encoding="utf-8")
        assert "print(" not in text, path.name
        assert "logger.exception" not in text and "log.exception" not in text, path.name  # tracebacks carry values
        assert "exc_info" not in text, path.name


async def test_a_full_generation_leaves_no_text_word_id_persona_or_prompt_in_logs(app, client, auth_headers, caplog):
    uid = int((await client.get("/api/me", headers=auth_headers)).json()["id"])
    created = await client.post("/api/agents/personas", headers=auth_headers,
                                json={"name": "Tom", "prompt": SECRET_PERSONA})
    assert created.status_code in (200, 201), created.text
    persona_id = created.json()["id"]
    assert (await client.patch(f"{BASE}/settings", headers=auth_headers, json={"daily_persona_id": persona_id})).status_code == 200
    async with app.state.sessionmaker() as s:
        s.add(VocabularyItem(user_id=uid, word=SECRET_WORD, source="manual", box=0, due_at=NOW - timedelta(days=1)))
        s.add(LinkMistakeWord(user_id=uid, word=SECRET_WORD, book_id="junior", wrong_count=3, ok_streak=0,
                              last_event_at=NOW - timedelta(days=1), last_wrong_at=datetime.now(timezone.utc) - timedelta(days=1)))
        s.add(PromptVersion(key="chat.daily_greeting", version=1, status="published", created_by="t",
                            body=SECRET_PROMPT + "\n{language_rule}\n<facts>{facts}</facts>"))
        await s.commit()
    fake = await use_fake_llm(app, FakeLLM(texts=(answer(),)))
    caplog.set_level(logging.DEBUG, logger="app")  # root DEBUG would capture aiosqlite's bound SQL parameters
    body = {"tz_offset_minutes": 0, "client_request_id": "00000000-0000-4000-8000-000000000000"}
    first = await client.post(f"{BASE}/today", headers=auth_headers, json=body)
    assert first.status_code == 200 and first.json()["greeting"]["source"] == "llm"
    greeting = first.json()["greeting"]
    await client.post(f"{BASE}/greetings/{greeting['id']}/seen", headers=auth_headers)
    await client.post(f"{BASE}/today", headers=auth_headers, json=body)  # the replay path
    sent = json.dumps(fake.requests[0], ensure_ascii=False)
    assert SECRET_PROMPT in sent  # the model may see the published prompt and the words ...
    assert SECRET_PERSONA not in sent  # ... but the persona prompt never enters the greeting request
    # ... and a failed generation (the error path) as well
    fail = await use_fake_llm(app, FakeLLM(status=402, error_body=b"upstream-secret-body"))
    other_uid, other = await register(client, "second")
    await client.patch(f"{BASE}/settings", headers=other, json={"language": "en"})
    assert (await client.post(f"{BASE}/today", headers=other, json=body)).status_code == 200 and len(fail.requests) == 1
    forbidden = [SECRET_WORD, SECRET_PERSONA, SECRET_PROMPT, "upstream-secret-body", str(uid), str(other_uid),
                 *DEMO_EN, *DEMO_SUB, *[t.replace("*", "") for t in DEMO_EN], "你已连续学习", greeting["id"],
                 *greeting["message_ids"], "llm-secret"]
    text = "\n".join(r.getMessage() for r in caplog.records if r.name == "app" or r.name.startswith("app."))
    for needle in forbidden:
        assert needle not in text, needle
    assert "event=chat_greeting" in text  # the one timing line is there, with numbers and codes only
    async with app.state.sessionmaker() as s:  # the stored facts hold numbers, never a word
        stored = (await s.scalars(select(ChatGreeting.facts))).all()
        assert all(SECRET_WORD not in json.dumps(f) for f in stored)
        assert SECRET_WORD not in " ".join(m.content for m in (await s.scalars(select(Message))).all())
