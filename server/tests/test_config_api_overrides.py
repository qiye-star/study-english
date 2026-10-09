import json
import logging

from app.models import PromptVersion
from app.services.prompts import prompt_cache

CUSTOM = [{"key": "job-interview", "name": "求职面试", "description": "练习回答面试问题", "prompt": "You are an interviewer."}]


async def _publish(app, body: str, version: int = 1) -> None:
    async with app.state.sessionmaker() as s:
        s.add(PromptVersion(key="config.chat_agent_templates", version=version, status="published", body=body,
                            created_by="t"))
        await s.commit()
    prompt_cache(app).invalidate()


async def test_published_templates_override_static_file(app, client, auth_headers):
    before = (await client.get("/api/config/chat_agent_templates", headers=auth_headers)).json()
    await _publish(app, json.dumps(CUSTOM, ensure_ascii=False))
    after = (await client.get("/api/config/chat_agent_templates", headers=auth_headers)).json()
    assert after == CUSTOM and before != CUSTOM


async def test_invalid_published_templates_fall_back_to_static_file(app, client, caplog):
    before = (await client.get("/api/config/chat_agent_templates")).json()
    await _publish(app, json.dumps([{"key": "BAD KEY", "name": "x", "description": "", "prompt": "SECRET-PROMPT"}]))
    with caplog.at_level(logging.WARNING):
        after = (await client.get("/api/config/chat_agent_templates")).json()
    assert after == before
    assert "invalid" in caplog.text and "SECRET-PROMPT" not in caplog.text


async def test_other_keys_ignore_prompt_versions(app, client):
    before = (await client.get("/api/config/gpt_presets")).json()
    await _publish(app, json.dumps(CUSTOM))
    assert (await client.get("/api/config/gpt_presets")).json() == before
