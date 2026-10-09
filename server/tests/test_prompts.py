import json

import pytest

from app.models import PromptVersion
from app.services import prompts
from app.services.grammar import MAX_PROMPT_CHARS
from app.services.prompts import PROMPTS, validate_prompt


def test_validation_codes():
    assert validate_prompt("grammar.rules", "Flag article errors only.") == []
    assert validate_prompt("grammar.rules", "") == ["empty"]
    ok = "Level {level}. <chat>{chat}</chat> <draft>{draft}</draft>"
    assert validate_prompt("rooms.assist", ok) == []
    assert "missing_fields:draft" in validate_prompt("rooms.assist", "Level {level}. <chat>{chat}</chat>")
    assert "unknown_fields:secret" in validate_prompt("rooms.assist", ok + " {secret}")
    assert "missing_boundary:<draft>" in validate_prompt("rooms.assist", "Level {level}. <chat>{chat}</chat> {draft}")
    assert validate_prompt("config.chat_agent_templates", "{") == ["invalid_json"]
    assert validate_prompt("config.chat_agent_templates", json.dumps([{"key": "x"}])) == ["invalid_templates"]


def test_validation_edge_cases():
    # whitespace and control characters are cleaned before checking
    assert validate_prompt("grammar.rules", " \x00\n ") == ["empty"]
    assert validate_prompt("grammar.rules", "x" * (MAX_PROMPT_CHARS + 1)) == ["too_long"]
    # grammar rules are never str.format-ed, so literal braces are fine
    assert validate_prompt("grammar.rules", 'Reply like {"a": 1} and keep {this}.') == []
    ok = "Level {level}. <chat>{chat}</chat> <draft>{draft}</draft>"
    assert validate_prompt("rooms.assist", ok + ' JSON: {{"x": 1}}') == []
    assert "invalid_braces" in validate_prompt("rooms.assist", ok + " {")
    # attribute/index access and format specs are not plain placeholders
    assert "unknown_fields:level.__class__" in validate_prompt("rooms.assist", ok + " {level.__class__}")
    assert "unknown_fields:level:{draft}" in validate_prompt("rooms.assist", ok + " {level:{draft}}")
    assert "unknown_fields:{}" in validate_prompt("rooms.assist", ok + " {}")
    assert validate_prompt("rooms.answer", "{topic}{asker}<chat>{chat}</chat>") == [
        "missing_fields:question", "missing_boundary:<question>", "missing_boundary:</question>"]
    with pytest.raises(KeyError):
        validate_prompt("nope", "x")


def _tpl(**kw):
    item = {"key": "job-interview", "name": "求职面试", "description": "练习回答面试问题", "prompt": "You are an interviewer."}
    item.update(kw)
    return item


@pytest.mark.parametrize("value", [
    [],
    [_tpl()] * 2,  # duplicate key
    [_tpl(key="Bad Key")],
    [_tpl(name="")],
    [_tpl(name="x" * 61)],
    [_tpl(description="x" * 201)],
    [_tpl(prompt="x" * 4001)],
    [{**_tpl(), "extra": "y"}],
    [_tpl(prompt=3)],
    [_tpl(key=f"k{i}") for i in range(51)],
    {"key": "x"},
])
def test_invalid_templates(value):
    assert validate_prompt("config.chat_agent_templates", json.dumps(value)) == ["invalid_templates"]


def test_static_templates_file_is_valid_and_every_spec_is_consistent():
    from app.routers.config_api import STATIC

    body = (STATIC / "chat_agent_templates.json").read_text(encoding="utf-8")
    assert validate_prompt("config.chat_agent_templates", body) == []
    assert PROMPTS["grammar.rules"].max_chars == MAX_PROMPT_CHARS
    assert set(PROMPTS) == {"grammar.rules", "rooms.assist", "rooms.answer", "rooms.voice_translate", "rooms.summary",
                            "config.chat_agent_templates"}


async def test_published_grammar_rules_pin_and_unpin(app):
    default_rules = app.state.grammar_rules
    async with app.state.sessionmaker() as s:
        s.add(PromptVersion(key="grammar.rules", version=1, status="published", body="Only flag tense errors.",
                            created_by="t"))
        await s.commit()
    await prompts.warm_prompts(app)
    assert app.state.grammar_rules == "Only flag tense errors." and app.state.grammar_rules_pinned is True
    async with app.state.sessionmaker() as s:
        await s.execute(PromptVersion.__table__.update().values(status="archived"))
        await s.commit()
    prompts.prompt_cache(app).invalidate()
    await prompts.apply_grammar(app)
    assert app.state.grammar_rules == default_rules and app.state.grammar_rules_pinned is False


async def test_pinned_rules_survive_a_settings_reload(app):
    from app.core.runtime_settings import compose

    async with app.state.sessionmaker() as s:
        s.add(PromptVersion(key="grammar.rules", version=1, status="published", body="Pinned.", created_by="t"))
        await s.commit()
    await prompts.warm_prompts(app)
    hub = app.state.settings_hub
    hub.publish(compose(app.state.base_settings, {"grammar_prompt": "From settings."}))
    assert app.state.grammar_rules == "Pinned."


async def test_cache_reads_once_and_revision_bump_refreshes(app):
    from app.core.runtime_settings import bump_revision, check_revisions

    cache = prompts.prompt_cache(app)
    assert cache is prompts.prompt_cache(app)
    assert await cache.get("rooms.assist") == (None, None)
    seen = await check_revisions(app, None)
    async with app.state.sessionmaker() as s:
        s.add(PromptVersion(key="grammar.rules", version=3, status="published", body="Other process.", created_by="t"))
        await bump_revision(s, "prompts")
        await s.commit()
    await check_revisions(app, seen)
    assert app.state.grammar_rules == "Other process." and app.state.grammar_rules_pinned is True
    assert await cache.get("grammar.rules") == (3, "Other process.")


async def test_invalid_published_grammar_body_is_ignored(app):
    default_rules = app.state.grammar_rules
    async with app.state.sessionmaker() as s:
        s.add(PromptVersion(key="grammar.rules", version=1, status="published", body="x" * (MAX_PROMPT_CHARS + 5),
                            created_by="t"))
        await s.commit()
    await prompts.apply_grammar(app)
    assert app.state.grammar_rules == default_rules and app.state.grammar_rules_pinned is False
