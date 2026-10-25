"""Today's default conversation and daily greeting service (plan 2026-10-23 R1-R8, R10, R14-R17; S7).
The model is a fake upstream (httpx.MockTransport); nothing here calls a real vendor."""
import asyncio
import json
import logging
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import delete, func, select, update

from app.agents.greeting import facts as facts_mod
from app.agents.greeting import prefs as prefs_mod
from app.agents.greeting import service as S
from app.models import (ChatGreeting, Conversation, DailyUsage, Message, PromptVersion, VocabularyItem)
from tests.agents_helpers import FakeLLM, use_fake_llm
from tests.test_admin_api import register
from tests.test_chat_home_parse import (DEMO_EN, DEMO_SUB, DEMO_ZH, FACTS, MODEL_EN, MODEL_SUB, MODEL_ZH, WELCOME_EN,
                                        WELCOME_SUB, WELCOME_ZH, welcome)

NOW = datetime(2026, 10, 23, 8, 42, tzinfo=timezone.utc)
SECRET = "SECRETFACTWORD"


def answer(language="bilingual", items=None):
    """A model answer for a learner with NO facts (welcome text, no placeholder); `facts_answer` is for FACTS."""
    return json.dumps({"lines": welcome(language) if items is None else items}, ensure_ascii=False)


def facts_answer(language="bilingual"):
    items = ([{"zh": t} for t in MODEL_ZH] if language == "zh" else [{"en": t} for t in MODEL_EN] if language == "en"
             else [{"en": e, "zh": z} for e, z in zip(MODEL_EN, MODEL_SUB)])
    return json.dumps({"lines": items}, ensure_ascii=False)


@pytest.fixture
def known_facts(monkeypatch):
    """The learner has FACTS (streak 23, 12 due, a tense slip with a pair): the sources are stubbed."""
    async def gather(app, ctx):
        return FACTS

    monkeypatch.setattr(S.facts_mod, "gather", gather)


async def setup(app, client, name="gina", fake=None, **prefs):
    uid, headers = await register(client, name)
    fake = await use_fake_llm(app, fake or FakeLLM(texts=(answer(prefs.get("language", "bilingual")),)))
    if prefs:
        async with app.state.sessionmaker() as s:
            await prefs_mod.save(s, uid, prefs)
            await s.commit()
    return uid, fake


async def today(app, uid, offset=0, now=NOW):
    async with app.state.sessionmaker() as s:
        return await S.ensure_today(app, s, uid, offset, now)


async def messages_of(app, conversation_id):
    async with app.state.sessionmaker() as s:
        rows = await s.scalars(select(Message).where(Message.conversation_id == conversation_id)
                               .order_by(Message.created_at, Message.id))
        return list(rows)


async def usage_count(app, scope):
    async with app.state.sessionmaker() as s:
        return await s.scalar(select(func.coalesce(func.sum(DailyUsage.count), 0)).where(DailyUsage.scope == scope))


async def test_first_call_writes_conversation_three_ordered_messages_and_the_greeting_row(app, client):
    uid, fake = await setup(app, client)
    t = await today(app, uid)
    assert t.status == "ready" and t.local_date.isoformat() == "2026-10-23"
    conv = t.conversation
    assert conv.daily_date == t.local_date and conv.name == "2026-10-23"
    msgs = await messages_of(app, conv.id)
    assert [m.id for m in msgs] == t.greeting["message_ids"] and len(msgs) == 3
    assert all(m.role == "assistant" for m in msgs)
    assert [m.content for m in msgs] == [e + "\n\n" + z for e, z in zip(WELCOME_EN, WELCOME_SUB)]
    assert t.greeting["lines"] == welcome("bilingual")
    assert [m.created_at for m in msgs] == sorted(m.created_at for m in msgs)
    assert t.greeting["source"] == "llm" and t.greeting["language"] == "bilingual" and t.greeting["first_view"] is True
    assert t.greeting["generated_at"].endswith("Z")
    assert len(fake.requests) == 1 and fake.requests[0]["max_tokens"] == 600 and fake.requests[0]["temperature"] == 0.8
    async with app.state.sessionmaker() as s:
        row = await s.scalar(select(ChatGreeting))
        assert row.status == "ready" and row.conversation_id == conv.id and row.prompt_version is None
        assert row.error_kind is None and row.facts == {} and (await s.get(Conversation, conv.id)).updated_at is not None
    assert await usage_count(app, S.SCOPE_GREETING_USER) == 1 and await usage_count(app, S.SCOPE_GREETING_GLOBAL) == 1


async def test_second_call_and_every_open_replay_never_call_the_model_or_append(app, client):
    uid, fake = await setup(app, client, greeting_trigger="every_open")
    first = await today(app, uid)
    again = await today(app, uid)
    third = await today(app, uid)
    assert len(fake.requests) == 1
    assert again.greeting["lines"] == third.greeting["lines"] == first.greeting["lines"]
    assert again.conversation.id == first.conversation.id
    assert len(await messages_of(app, first.conversation.id)) == 3  # a replay appends nothing
    assert again.greeting["message_ids"] == first.greeting["message_ids"]


async def test_concurrent_requests_call_the_model_once_and_the_loser_gets_pending(app, client):
    uid, fake = await setup(app, client, fake=FakeLLM(texts=(answer(),), first_delay=0.3))
    first, second = await asyncio.gather(today(app, uid), today(app, uid))
    statuses = sorted([first.status, second.status])
    assert statuses == ["pending", "ready"] and len(fake.requests) == 1
    loser = first if first.status == "pending" else second
    assert loser.greeting is None
    assert (await today(app, uid)).status == "ready" and len(fake.requests) == 1
    assert len(await messages_of(app, first.conversation.id)) == 3  # never a half-written greeting


async def test_a_stale_pending_claim_is_taken_over_and_a_fresh_one_is_respected(app, client):
    uid, fake = await setup(app, client)
    t0 = await today(app, uid, now=NOW)
    async with app.state.sessionmaker() as s:
        await s.execute(delete(Message))
        await s.execute(delete(DailyUsage))  # the claimant died before it spent any allowance
        await s.execute(update(ChatGreeting).values(status="pending", lines=[], message_ids=[],
                                                    updated_at=NOW - timedelta(seconds=10)))
        await s.commit()
    fresh = await today(app, uid, now=NOW)
    assert fresh.status == "pending" and len(fake.requests) == 1
    stale = await today(app, uid, now=NOW + timedelta(seconds=S.PENDING_STALE_SECONDS + 1))
    assert stale.status == "ready" and len(fake.requests) == 2
    assert len(await messages_of(app, t0.conversation.id)) == 3


@pytest.mark.parametrize("fake_kwargs,kind", [
    ({"status": 402}, "http"),
    ({"texts": ("not json",)}, "invalid"),
    ({"texts": (answer(items=[{"en": WELCOME_EN[0]}, {"en": WELCOME_EN[1]}]),)}, "invalid"),
    ({"texts": (answer(items=[{"en": WELCOME_EN[0]}] * 4),)}, "invalid"),
    ({"texts": (answer(items=[{"en": "x" * 400}] * 3),)}, "invalid"),
])
async def test_upstream_failure_or_bad_output_gives_template_lines_and_refunds(app, client, fake_kwargs, kind):
    uid, fake = await setup(app, client, language="en", fake=FakeLLM(**fake_kwargs))
    t = await today(app, uid)
    assert t.status == "ready" and t.greeting["source"] == "template" and len(t.greeting["lines"]) == 3
    assert all(set(line) == {"en"} for line in t.greeting["lines"])
    assert len(await messages_of(app, t.conversation.id)) == 3
    async with app.state.sessionmaker() as s:
        assert (await s.scalar(select(ChatGreeting.error_kind))) == kind
    assert await usage_count(app, S.SCOPE_GREETING_USER) == 0 and await usage_count(app, S.SCOPE_GREETING_GLOBAL) == 0
    assert len(fake.requests) == 1
    again = await today(app, uid)  # no retry today: the greeting is already in the conversation
    assert again.greeting["lines"] == t.greeting["lines"] and len(fake.requests) == 1


async def test_zh_answer_with_english_words_is_rejected(app, client):
    mixed = answer(items=[{"zh": "早上好，今天的 streak 已经很棒了，继续保持下去吧。"}] * 3)
    uid, fake = await setup(app, client, language="zh", fake=FakeLLM(texts=(mixed,)))
    t = await today(app, uid)
    assert t.greeting["source"] == "template"
    assert not any(c.isascii() and c.isalpha() for line in t.greeting["lines"] for c in line["zh"])


async def test_timeout_falls_back_and_refunds(app, client):
    uid, fake = await setup(app, client, fake=FakeLLM(texts=(answer(),), first_delay=1.6))
    app.state.settings = app.state.settings.model_copy(update={"chat_greeting_timeout_seconds": 1})
    t = await today(app, uid)
    assert t.greeting["source"] == "template"
    async with app.state.sessionmaker() as s:
        assert (await s.scalar(select(ChatGreeting.error_kind))) == "timeout"
    assert await usage_count(app, S.SCOPE_GREETING_USER) == 0


async def test_quota_exhaustion_uses_the_template_without_asking_the_model(app, client):
    uid, fake = await setup(app, client)
    async with app.state.sessionmaker() as s:
        s.add(DailyUsage(scope=S.SCOPE_GREETING_USER, subject=str(uid), day="2026-10-23", count=1))
        await s.commit()
    t = await today(app, uid)
    assert t.greeting["source"] == "template" and len(fake.requests) == 0
    async with app.state.sessionmaker() as s:
        assert (await s.scalar(select(ChatGreeting.error_kind))) == "quota"


async def test_global_cap_is_enforced_and_gives_the_user_allowance_back(app, client):
    uid, fake = await setup(app, client)
    app.state.settings = app.state.settings.model_copy(update={"chat_greeting_global_daily": 0})
    t = await today(app, uid)
    assert t.greeting["source"] == "template" and len(fake.requests) == 0
    assert await usage_count(app, S.SCOPE_GREETING_USER) == 0


async def test_llm_switch_off_means_zero_upstream_requests(app, client):
    uid, fake = await setup(app, client)
    app.state.settings = app.state.settings.model_copy(update={"chat_greeting_llm_enabled": False})
    t = await today(app, uid)
    assert t.greeting["source"] == "template" and len(fake.requests) == 0 and len(t.greeting["lines"]) == 3


async def test_slots_are_filled_by_code_with_marks_and_the_stored_facts_stay_numbers(app, client, known_facts):
    uid, fake = await setup(app, client, language="en", fake=FakeLLM(texts=(facts_answer("en"),)))
    t = await today(app, uid)
    assert t.greeting["source"] == "llm" and [line["en"] for line in t.greeting["lines"]] == DEMO_EN
    assert t.greeting["lines"][1]["en"].count("*") == 6
    assert t.greeting["facts"] == {"streak": 23, "due": 12, "yesterday_mistakes": 2}
    system = fake.requests[0]["messages"][0]["content"]
    assert "{streak} = a N-day streak" in system and "{mistake} =" in system and not any(ch.isdigit() for ch in fake.requests[0]["messages"][1]["content"])
    msgs = await messages_of(app, t.conversation.id)
    assert all("*" not in m.content for m in msgs) and "12 words to review" in msgs[1].content


async def test_hallucinated_numbers_fall_back_to_the_template_and_invent_nothing(app, client):
    """The reported defect: a brand-new learner got 'a streak' and 'twenty words due' from the real model."""
    invented = [{"en": "Good morning! You are on a 7-day streak, keep up that steady effort today."},
                {"en": "You have twenty words due for review today, so let's clear them together."},
                {"en": "Spend 15 minutes on a short chat today and finish with a warm and happy note."}]
    uid, fake = await setup(app, client, language="en", fake=FakeLLM(texts=(answer(items=invented),)))
    t = await today(app, uid)
    assert t.greeting["source"] == "template" and t.greeting["facts"] == {}
    async with app.state.sessionmaker() as s:
        assert (await s.scalar(select(ChatGreeting.error_kind))) == "invalid"
    joined = " ".join(line["en"] for line in t.greeting["lines"])
    assert "day streak" not in joined and "twenty" not in joined and "7" not in joined and "20" not in joined
    assert "words due" not in joined  # the template says nothing is due, it claims no amount
    assert await usage_count(app, S.SCOPE_GREETING_USER) == 0


@pytest.mark.parametrize("language,key,text,reason", [
    ("en", "en", "Good morning, you are on {streak} today, my dear friend.", "slot"),  # nothing offered to a new learner
    ("en", "en", "Good morning, you have 20 words waiting for you, my friend.", "number"),
    ("en", "en", "Good morning, you have twenty words waiting for you, my friend.", "number"),
    ("zh", "zh", "早上好，你已经连续学习七天了，继续保持下去哦朋友。", "number"),
    ("zh", "zh", "早上好，你已经连续学习 ７ 天了，继续保持下去哦朋友。", "number"),
    ("bilingual", "zh", "早上好，你今天有 ２０ 个单词要复习哦朋友。", "number"),
    ("en", "en", "Good morning, you have {due waiting for you, my friend.", "braces"),
])
async def test_every_validator_failure_path_falls_back_to_the_template(app, client, caplog, language, key, text, reason):
    good = welcome(language)
    items = [{**item, key: text} for item in good]
    items[1] = good[1]
    uid, fake = await setup(app, client, language=language, fake=FakeLLM(texts=(answer(items=items),)))
    caplog.set_level(logging.INFO, logger="app")
    t = await today(app, uid)
    assert t.greeting["source"] == "template" and len(t.greeting["lines"]) == 3
    assert f"chat greeting rejected reason={reason}" in caplog.text
    assert text not in caplog.text  # the log carries the rule code only
    async with app.state.sessionmaker() as s:
        assert (await s.scalar(select(ChatGreeting.error_kind))) == "invalid"


async def test_an_unoffered_slot_is_refused_even_when_others_are_offered(app, client, known_facts):
    only_due = [{"en": "Good morning, my friend! Today you have {due}, so let's go."},
                {"en": "Good morning, my friend! Today you are on {streak}, so let's go."},
                {"en": "Today, let's spend a little time on a friendly chat in English together."}]
    async def narrow(app, ctx):
        return facts_mod.GreetingFacts(due=3)

    S.facts_mod.gather = narrow  # restored by the known_facts monkeypatch teardown
    uid, fake = await setup(app, client, language="en", fake=FakeLLM(texts=(answer(items=only_due),)))
    assert (await today(app, uid)).greeting["source"] == "template"


async def test_deleting_today_conversation_then_today_again_restores_the_same_lines_without_the_model(app, client):
    uid, fake = await setup(app, client)
    first = await today(app, uid)
    await _seen(app, uid, first.greeting["id"])
    old_texts = [m.content for m in await messages_of(app, first.conversation.id)]
    async with app.state.sessionmaker() as s:  # what DELETE /api/conversations/{id} does (S9)
        await s.execute(delete(Message).where(Message.conversation_id == first.conversation.id))
        await s.execute(delete(Conversation).where(Conversation.id == first.conversation.id))
        await s.execute(update(ChatGreeting).values(conversation_id=None, message_ids=[]))
        await s.commit()
    after = await today(app, uid)
    assert after.conversation.id != first.conversation.id and after.status == "ready"
    msgs = await messages_of(app, after.conversation.id)
    assert [m.content for m in msgs] == old_texts and [m.id for m in msgs] == after.greeting["message_ids"]
    assert after.greeting["message_ids"] != first.greeting["message_ids"]
    assert after.greeting["first_view"] is False and len(fake.requests) == 1
    assert await usage_count(app, S.SCOPE_GREETING_USER) == 1
    assert (await today(app, uid)).greeting["message_ids"] == after.greeting["message_ids"]  # no second restore


async def _seen(app, uid, greeting_id):
    async with app.state.sessionmaker() as s:
        return await S.mark_seen(s, uid, greeting_id, NOW)


async def test_deleting_one_greeting_message_is_respected(app, client):
    uid, fake = await setup(app, client)
    first = await today(app, uid)
    async with app.state.sessionmaker() as s:
        await s.execute(delete(Message).where(Message.id == first.greeting["message_ids"][1]))
        await s.commit()
    again = await today(app, uid)
    assert len(await messages_of(app, first.conversation.id)) == 2 and len(fake.requests) == 1
    assert again.greeting["message_ids"] == first.greeting["message_ids"]


async def test_off_still_creates_an_empty_daily_conversation_each_day_without_greeting_or_model(app, client):
    uid, fake = await setup(app, client, greeting_trigger="off")
    one = await today(app, uid)
    two = await today(app, uid, now=NOW + timedelta(days=1))
    assert one.status == two.status == "off" and one.greeting is None and two.greeting is None
    assert one.conversation.id != two.conversation.id and len(fake.requests) == 0
    assert await messages_of(app, one.conversation.id) == []
    async with app.state.sessionmaker() as s:
        assert await s.scalar(select(func.count()).select_from(ChatGreeting)) == 0
        assert await s.scalar(select(func.count()).select_from(Conversation)) == 2
    assert (await today(app, uid)).conversation.id == one.conversation.id  # idempotent


async def test_daily_conversation_ignores_the_conversation_cap(app, client):
    uid, _ = await setup(app, client)
    app.state.settings = app.state.settings.model_copy(update={"max_conversations": 1})
    async with app.state.sessionmaker() as s:
        s.add(Conversation(id="c-old", user_id=uid, name="old", config={}, created_at=NOW, updated_at=NOW))
        await s.commit()
    assert (await today(app, uid)).status == "ready"


async def test_persona_fallback_never_rewrites_prefs_and_agents_off_writes_no_persona(app, client):
    ghost = "00000000-0000-0000-0000-000000000000"
    uid, fake = await setup(app, client, daily_persona_id=ghost)
    app.state.settings = app.state.settings.model_copy(update={"agents_enabled": True})
    t = await today(app, uid)
    assert t.conversation.config["agent_persona_id"] == "builtin:partner"
    assert "学习伙伴" in fake.requests[0]["messages"][0]["content"]
    async with app.state.sessionmaker() as s:
        assert (await prefs_mod.load(s, uid)).daily_persona_id == ghost
        assert (await s.scalar(select(ChatGreeting.persona_id))) == "builtin:partner"
    uid2, _ = await setup(app, client, name="hank")
    app.state.settings = app.state.settings.model_copy(update={"agents_enabled": False})
    off = await today(app, uid2)
    assert "agent_persona_id" not in off.conversation.config


@pytest.mark.parametrize("language,expected", [
    ("en", {"auto_speak": True, "bilingual": False}),
    ("zh", {"auto_speak": True, "bilingual": False, "zh_note": "always"}),
    ("bilingual", {"auto_speak": True, "bilingual": True, "zh_note": "always"}),
])
async def test_conversation_config_per_language_is_snake_case_only(app, client, language, expected):
    uid, _ = await setup(app, client, language=language)
    app.state.settings = app.state.settings.model_copy(update={"agents_enabled": True})
    config = (await today(app, uid)).conversation.config
    assert config == {**expected, "agent_persona_id": "builtin:partner"}
    assert not any(any(c.isupper() for c in key) for key in config)


async def test_include_stats_false_asks_no_sources_and_the_prompt_carries_no_data(app, client, monkeypatch):
    uid, fake = await setup(app, client, include_stats=False)
    calls = []

    async def spy(*a, **k):
        calls.append(1)
        return facts_mod.GreetingFacts()

    monkeypatch.setattr(S.facts_mod, "gather", spy)
    t = await today(app, uid)
    assert calls == [] and t.greeting["facts"] == {}
    sent = json.dumps(fake.requests[0]["messages"], ensure_ascii=False)
    for banned in ("streak_days", "words_due_today", "yesterday_", "weak_words"):
        assert banned not in sent
    assert "focus_hint: free_talk" in sent
    async with app.state.sessionmaker() as s:
        assert (await s.scalar(select(ChatGreeting.facts))) == {}


async def test_include_stats_false_template_fallback_uses_the_no_data_lines(app, client):
    uid, fake = await setup(app, client, include_stats=False, language="en", fake=FakeLLM(status=402))
    t = await today(app, uid)
    assert "good to see you" in t.greeting["lines"][0]["en"] and "streak" not in " ".join(
        line["en"] for line in t.greeting["lines"])


async def test_turning_stats_off_after_generation_hides_facts_but_keeps_lines(app, client):
    uid, fake = await setup(app, client, language="en")
    async with app.state.sessionmaker() as s:
        s.add(VocabularyItem(user_id=uid, word=SECRET, source="x", box=0, due_at=NOW - timedelta(days=1)))
        await s.commit()
    first = await today(app, uid)
    assert first.greeting["facts"] == {"due": 1}
    async with app.state.sessionmaker() as s:
        await prefs_mod.save(s, uid, {"include_stats": False})
        await s.commit()
    later = await today(app, uid)
    assert later.greeting["facts"] == {} and later.greeting["lines"] == first.greeting["lines"]
    async with app.state.sessionmaker() as s:
        assert (await s.scalar(select(ChatGreeting.facts))) == {"due": 1}  # stored numbers stay
        await prefs_mod.save(s, uid, {"include_stats": True})
        await s.commit()
    assert (await today(app, uid)).greeting["facts"] == {"due": 1}


async def test_facts_flow_into_the_prompt_as_text_but_storage_keeps_numbers_only(app, client):
    uid, fake = await setup(app, client, language="en")
    async with app.state.sessionmaker() as s:
        s.add(VocabularyItem(user_id=uid, word=SECRET, source="x", box=0, due_at=NOW - timedelta(days=1)))
        await s.commit()
    t = await today(app, uid)
    system = fake.requests[0]["messages"][0]["content"]
    assert "{due} = N words to review" in system and "{streak}" not in system  # one due word: only that slot is offered
    assert not any(ch.isdigit() for ch in fake.requests[0]["messages"][1]["content"])
    assert SECRET not in json.dumps(t.greeting) and SECRET not in json.dumps(fake.requests[0])


async def test_published_prompt_is_used_and_its_version_recorded(app, client):
    uid, fake = await setup(app, client, language="en")
    custom = "CUSTOMTONE be gentle.\n{language_rule}\n<facts>{facts}</facts>"
    async with app.state.sessionmaker() as s:
        s.add(PromptVersion(key=S.PROMPT_KEY, version=3, status="published", body=custom, created_by="t"))
        await s.commit()
    t = await today(app, uid)
    system = fake.requests[0]["messages"][0]["content"]
    assert "CUSTOMTONE" in system and "EXACTLY 3 items" in system
    assert "Facts rules (fixed" in system and "No placeholders are offered" in system  # the admin cannot remove the block
    async with app.state.sessionmaker() as s:
        assert (await s.scalar(select(ChatGreeting.prompt_version))) == 3
    assert t.greeting["source"] == "llm"


@pytest.mark.parametrize("body", ["no fields at all", "{language_rule} {facts} {nope}", "{language_rule} <facts>{facts}</facts> {"])
async def test_a_broken_published_prompt_falls_back_to_the_default_and_logs_no_body(app, client, caplog, body):
    uid, fake = await setup(app, client, language="en")
    async with app.state.sessionmaker() as s:  # written straight to the table, bypassing publish-time validation
        s.add(PromptVersion(key=S.PROMPT_KEY, version=1, status="published", body=body, created_by="t"))
        await s.commit()
    caplog.set_level(logging.INFO, logger="app")
    await today(app, uid)
    assert "exactly THREE" in fake.requests[0]["messages"][0]["content"]
    assert "published prompt ignored key=chat.daily_greeting reason=invalid" in caplog.text
    assert body not in caplog.text
    async with app.state.sessionmaker() as s:
        assert (await s.scalar(select(ChatGreeting.prompt_version))) is None


async def test_the_timing_log_line_has_only_numbers_and_codes(app, client, caplog):
    uid, fake = await setup(app, client, fake=FakeLLM(status=402))
    caplog.set_level(logging.INFO, logger="app")
    await today(app, uid)
    line = next(r.getMessage() for r in caplog.records if "event=chat_greeting" in r.getMessage())
    assert line.startswith("timing event=chat_greeting error=http facts=0 lines=3 ms=") and "source=template" in line
    assert "status=ready" in line


async def test_mark_seen_sets_once_and_only_for_the_owner(app, client):
    uid, _ = await setup(app, client)
    other, _ = await register(client, "ivy")
    t = await today(app, uid)
    gid = t.greeting["id"]
    assert await _seen(app, other, gid) is None
    first = await _seen(app, uid, gid)
    later = await S.mark_seen(await app.state.sessionmaker().__aenter__(), uid, gid, NOW + timedelta(hours=1))
    assert first is not None and later == first
    assert (await today(app, uid)).greeting["first_view"] is False
    async with app.state.sessionmaker() as s:
        assert await S.mark_seen(s, uid, "nope", NOW) is None


async def test_the_day_follows_the_users_offset(app, client):
    uid, fake = await setup(app, client)
    late = datetime(2026, 10, 22, 22, 0, tzinfo=timezone.utc)
    utc = await today(app, uid, now=late)
    ahead = await today(app, uid, offset=840, now=late)  # already Oct 23 there
    assert utc.local_date.isoformat() == "2026-10-22" and ahead.local_date.isoformat() == "2026-10-23"
    assert utc.conversation.id != ahead.conversation.id
    assert "evening" in fake.requests[0]["messages"][1]["content"] or "time_of_day" in fake.requests[0]["messages"][1]["content"]
