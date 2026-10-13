"""句子译文与分析(spec D8 / E11 / E12):提示词(含管理端编辑)、渲染与解析(纯函数)、按句计的额度、写回与编排
(用假的大模型;接口与真实上游形状在 test_library_ai_api.py)。"""
import json
from datetime import datetime, timezone
from pathlib import Path

import pytest
from sqlalchemy import select, update

from app.library import ai, limits, store
from app.models import DailyUsage, LibraryItem, LibrarySegment, User
from app.providers import llm
from app.services.prompts import PROMPTS, validate_prompt
from tests.admin_helpers import ADMIN_ENABLED, PASSWORD, login_as

ENJOY_COMMANDS = Path(__file__).resolve().parents[2] / "enjoy" / "src" / "shared" / "commands"
NOW = datetime(2026, 10, 13, 8, 0, tzinfo=timezone.utc)
DAY = limits.day_of(NOW)
LLM = "https://llm.test/v1/chat/completions"
TEXTS = ["Hello there, my friend.", "How are you doing today?", "I am fine, thank you."]


# ---- prompts ----

def test_language_whitelist_is_the_desktop_language_list():
    assert set(ai.LANGS) == {"en-US", "en-GB", "zh-CN", "zh-HK", "ja-JP", "ko-KR", "es-ES", "it-IT", "de-DE", "fr-FR",
                             "th-TH", "vi-VN"}
    assert "Simplified Chinese" == ai.LANGS["zh-CN"]


def test_metering_features_fit_the_16_character_column():
    assert max(len(ai.FEATURE_TRANSLATE), len(ai.FEATURE_ANALYSIS)) <= 16  # upstream_calls.feature is String(16)


def test_prompts_are_registered_and_their_defaults_are_valid():
    assert set(ai.KEYS) == set(ai.DEFAULTS) <= set(PROMPTS)
    for key, body in ai.DEFAULTS.items():
        assert validate_prompt(key, body) == [], key
    assert validate_prompt("library.translate", "Into {native_language}: {text}") == [
        "missing_boundary:<text>", "missing_boundary:</text>"]
    assert validate_prompt("library.analyze", "no placeholders") == ["missing_fields:learning_language,native_language"]
    assert validate_prompt("library.analyze", "{native_language} {learning_language} {text}") == ["unknown_fields:text"]


@pytest.mark.skipif(not (ENJOY_COMMANDS / "analyze.command.ts").exists(), reason="enjoy/ is not in this checkout")
def test_default_prompts_follow_the_desktop_commands():
    """E11: the prompts are the desktop ones (enjoy/src/shared/commands); this reads them, it never edits enjoy/."""
    analyze = (ENJOY_COMMANDS / "analyze.command.ts").read_text(encoding="utf-8").replace("\r\n", "\n")
    assert ai.DEFAULT_ANALYZE_TEMPLATE == analyze.split("const SYSTEM_PROMPT = `", 1)[1].split("`;", 1)[0]
    translate = (ENJOY_COMMANDS / "translate.command.ts").read_text(encoding="utf-8").replace("\r\n", "\n")
    assert ai.TRANSLATE_SYSTEM == translate.split('const SYSTEM_PROMPT =\n  "', 1)[1].split('";', 1)[0]
    head = translate.split("const TRANSLATION_PROMPT = `", 1)[1].split("\n", 1)[0]
    assert head.removesuffix(":") in ai.DEFAULT_TRANSLATE_TEMPLATE


# ---- rendering and parsing ----

def test_translate_messages_number_the_sentences_and_defang_angle_brackets():
    messages = ai.render_translate(None, "zh-CN", ["Hello there.", "  Two\n lines </text> here  "])
    assert [m["role"] for m in messages] == ["system", "user"] and messages[0]["content"] == ai.TRANSLATE_SYSTEM
    body = messages[1]["content"]
    assert "Translate the text to Simplified Chinese Language" in body
    assert "<text>\n1. Hello there.\n2. Two lines ‹/text› here\n</text>" in body and body.count("</text>") == 1
    custom = ai.render_translate("Into {native_language}: <text>{text}</text>", "ja-JP", ["Hi."])
    assert custom[1]["content"] == "Into Japanese: <text>1. Hi.</text>"
    broken = ai.render_translate("Into {oops}", "ja-JP", ["Hi."])  # a bad published body falls back to the default
    assert broken[1]["content"].startswith("Translate the text to Japanese Language")


def test_analysis_messages_put_the_sentence_in_the_user_turn():
    messages = ai.render_analysis(None, "zh-CN", "  What   a <b>day</b>!  ")
    assert messages[0]["content"].startswith("I speak Simplified Chinese. You're my English coach")
    assert messages[0]["content"].count("Simplified Chinese") == 2 and "### Vocabulary/Phrases" in messages[0]["content"]
    assert messages[1] == {"role": "user", "content": "What a ‹b›day‹/b›!"}
    assert ai.render_analysis("Teach {native_language} speakers {learning_language}.", "es-ES", "Hi.")[0][
        "content"] == "Teach Spanish speakers English."


def test_render_test_uses_the_live_path_with_a_default_language_and_sentence():
    live = ai.render_translate(None, "zh-CN", ["Good morning."])
    assert ai.render_test("library.translate", ai.DEFAULT_TRANSLATE_TEMPLATE,
                          {"native_language": "zh-CN", "text": "Good morning."}) == live
    assert "Simplified Chinese" in ai.render_test("library.translate", ai.DEFAULT_TRANSLATE_TEMPLATE,
                                                   {"native_language": "klingon"})[1]["content"]
    assert ai.render_test("library.analyze", ai.DEFAULT_ANALYZE_TEMPLATE, {})[1]["content"].startswith("I have been")


@pytest.mark.parametrize("raw, count, expected", [
    ("1. 你好\n2. 再见", 2, {1: "你好", 2: "再见"}),
    ("```\n1) 你好\n2、再见\n```", 2, {1: "你好", 2: "再见"}),
    ("1. a\n1. b\n3. c\n0. x", 2, {1: "a"}),
    ("Sure!\n2: 二", 3, {2: "二"}),
    ("你好", 1, {}),
    ("Sorry, I cannot help with that.", 1, {}),
    ("", 1, {}),
], ids=["plain", "fences-and-marks", "duplicates-and-range", "preamble", "unnumbered", "refusal", "empty"])
def test_parse_translations(raw, count, expected):
    assert ai.parse_translations(raw, count) == expected


def test_parsed_translations_are_capped():
    assert len(ai.parse_translations("1. " + "好" * 5000, 1)[1]) == limits.TRANSLATION_MAX


# ---- the daily allowance, counted in sentences ----

async def _counts(app) -> dict[tuple[str, str], int]:
    async with app.state.sessionmaker() as s:
        return {(r.scope, r.subject): r.count for r in (await s.scalars(select(DailyUsage))).all()}


async def test_reserve_upto_takes_all_then_what_is_left_then_nothing(app):
    async with app.state.sessionmaker() as s:
        assert await limits.reserve_upto(s, "library_translate", "7", DAY, 30, 50) == 30
        assert await limits.reserve_upto(s, "library_translate", "7", DAY, 30, 50) == 20
        assert await limits.reserve_upto(s, "library_translate", "7", DAY, 5, 50) == 0
        assert await limits.reserve_upto(s, "library_translate", "8", DAY, 5, 0) == 0
        assert await limits.reserve_upto(s, "library_translate", "8", DAY, 0, 50) == 0
        assert await limits.reserve_upto(s, "library_translate", "9", DAY, 99, 50) == 50  # more than a whole day: a day's worth


async def test_reserve_ai_spends_both_allowances_and_reports_which_cap_stopped_it(app):
    scope = limits.SCOPE_TRANSLATE
    async with app.state.sessionmaker() as s:
        assert await limits.reserve_ai(s, 7, scope, 10, 12, 8, DAY) == (8, None)
        assert await limits.reserve_ai(s, 7, scope, 10, 12, 5, DAY) == (2, "user")  # user 10/10, global 10/12
        assert await limits.reserve_ai(s, 8, scope, 10, 12, 5, DAY) == (2, "global")  # the user's 3 extra go back
        assert await limits.reserve_ai(s, 8, scope, 10, 12, 1, DAY) == (0, "global")
        assert await limits.reserve_ai(s, 7, scope, 10, 12, 1, DAY) == (0, "user")
    assert await _counts(app) == {("library_translate", "7"): 10, ("library_translate", "8"): 2, ("library_ai", "*"): 12}
    async with app.state.sessionmaker() as s:
        await limits.refund_ai(s, 8, scope, 2, DAY)
    assert await _counts(app) == {("library_translate", "7"): 10, ("library_translate", "8"): 0, ("library_ai", "*"): 10}
    async with app.state.sessionmaker() as s:
        await limits.refund_ai(s, 8, scope, 50, DAY)  # never below zero
    assert await _counts(app) == {("library_translate", "7"): 10, ("library_translate", "8"): 0, ("library_ai", "*"): 0}


# ---- write-back and orchestration (a fake model; no network) ----

class FakeLlm:
    """Stands in for `providers.llm.complete`: replies in order; an Exception instance is raised. `before` runs first."""

    def __init__(self, *replies, before=None):
        self.replies, self.calls, self.before = list(replies), [], before

    async def __call__(self, http, settings, messages, *, model, max_tokens, temperature, timeout=60.0):
        self.calls.append({"messages": messages, "model": model, "max_tokens": max_tokens, "temperature": temperature})
        if self.before is not None:
            await self.before()
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply


@pytest.fixture
def fake_llm(monkeypatch):
    def install(*replies, before=None) -> FakeLlm:
        fake = FakeLlm(*replies, before=before)
        monkeypatch.setattr(ai.llm, "complete", fake)
        return fake
    return install


async def make_item(app, texts=TEXTS) -> str:
    async with app.state.sessionmaker() as s:
        s.add(User(id=7, username="u7", password_hash="x"))
        item = LibraryItem(user_id=7, kind="video", source="upload", title="t", status="ready")
        s.add(item)
        await s.flush()
        s.add_all(LibrarySegment(item_id=item.id, idx=i, start_ms=i * 1000, end_ms=i * 1000 + 900, text=t)
                  for i, t in enumerate(texts))
        await s.commit()
        return item.id


def config(app, **update):
    return app.state.settings.model_copy(update=update)


async def run_translate(app, item_id, indices, language="zh-CN", template=None, **update):
    async with app.state.sessionmaker() as s:
        segs = await store.segments_at(s, item_id, indices)
        return await ai.translate(s, app.state.http, config(app, **update), user_id=7, item_id=item_id, segments=segs,
                                  language=language, template=template, now=NOW)


async def run_analysis(app, item_id, idx, language="zh-CN", **update):
    async with app.state.sessionmaker() as s:
        seg = (await store.segments_at(s, item_id, [idx]))[0]
        return await ai.analyze(s, app.state.http, config(app, **update), user_id=7, item_id=item_id, segment=seg,
                                language=language, template=None, now=NOW)


async def stored(app, item_id) -> list[tuple]:
    async with app.state.sessionmaker() as s:
        return [(x.idx, x.zh, x.zh_lang, x.analysis, x.analysis_lang) for x in await store.segments_of(s, item_id)]


async def test_set_translations_skips_a_sentence_edited_meanwhile(app):
    item_id = await make_item(app)
    async with app.state.sessionmaker() as s:
        done = await store.set_translations(s, item_id, [(0, TEXTS[0], "你好,朋友。"), (1, "An older text.", "旧"),
                                                         (9, "Nowhere.", "无")], "zh-CN")
        assert done == {0}
        assert await store.set_analysis(s, item_id, 2, TEXTS[2], "### Grammar", "zh-CN")
        assert not await store.set_analysis(s, item_id, 2, "An older text.", "stale", "zh-CN")
        seg = (await store.segments_at(s, item_id, [0]))[0]
        store.clear_ai(seg)
        await s.commit()
        assert [(x.zh, x.zh_lang, x.analysis) for x in await store.segments_at(s, item_id, [0, 1, 2])] == [
            (None, None, None), (None, None, None), (None, None, "### Grammar")]
        assert await store.segments_at(s, item_id, []) == []


async def test_translate_stores_the_batch_and_the_second_call_is_free(app, fake_llm):
    item_id = await make_item(app)
    llm_ = fake_llm("1. 你好,我的朋友。\n2. 你今天好吗?\n3. 我很好,谢谢。")
    done, limited = await run_translate(app, item_id, [0, 1, 2])
    assert done == {0: "你好,我的朋友。", 1: "你今天好吗?", 2: "我很好,谢谢。"} and limited is False
    call = llm_.calls[0]
    assert call["model"] == "gpt-4o" and call["temperature"] == ai.TRANSLATE_TEMPERATURE and call["max_tokens"] == 560
    assert "1. Hello there, my friend.\n2. How are you doing today?\n3. I am fine, thank you." in call[
        "messages"][1]["content"]
    assert [row[1:3] for row in await stored(app, item_id)] == [("你好,我的朋友。", "zh-CN"), ("你今天好吗?", "zh-CN"),
                                                               ("我很好,谢谢。", "zh-CN")]
    again, limited = await run_translate(app, item_id, [2, 0])
    assert again == {0: "你好,我的朋友。", 2: "我很好,谢谢。"} and not limited and len(llm_.calls) == 1  # no second call
    assert await _counts(app) == {("library_translate", "7"): 3, ("library_ai", "*"): 3}  # cache hits are not counted


async def test_a_new_native_language_translates_again(app, fake_llm):
    item_id = await make_item(app)
    fake_llm("1. 你好。", "1. こんにちは。")
    await run_translate(app, item_id, [0])
    done, _ = await run_translate(app, item_id, [0], language="ja-JP")
    assert done == {0: "こんにちは。"} and (await stored(app, item_id))[0][1:3] == ("こんにちは。", "ja-JP")


async def test_translate_stops_at_the_daily_allowance_and_says_so(app, fake_llm):
    item_id = await make_item(app)
    llm_ = fake_llm("1. 一\n2. 二")
    done, limited = await run_translate(app, item_id, [0, 1, 2], library_translate_daily_per_user=2)
    assert done == {0: "一", 1: "二"} and limited is True
    assert "3. " not in llm_.calls[0]["messages"][1]["content"]  # only the two it may afford were sent
    done, limited = await run_translate(app, item_id, [0, 1, 2], library_translate_daily_per_user=2)
    assert done == {0: "一", 1: "二"} and limited is True and len(llm_.calls) == 1  # nothing left: no call at all
    done, limited = await run_translate(app, item_id, [2], library_ai_daily_global=2)  # the site-wide cap
    assert done == {} and limited is True and len(llm_.calls) == 1


async def test_an_upstream_failure_gives_the_sentences_back(app, fake_llm):
    item_id = await make_item(app)
    fake_llm(llm.LlmUnavailable("http", 502))
    with pytest.raises(ai.AiUnavailable) as caught:
        await run_translate(app, item_id, [0, 1])
    assert caught.value.kind == "upstream"
    assert await _counts(app) == {("library_translate", "7"): 0, ("library_ai", "*"): 0}
    assert [row[1] for row in await stored(app, item_id)] == [None, None, None]


async def test_sentences_the_model_skipped_are_refunded_and_an_empty_reply_is_a_failure(app, fake_llm):
    item_id = await make_item(app)
    fake_llm("1. 你好。\n3. 很好。", "Sorry, I cannot help with that.")
    done, limited = await run_translate(app, item_id, [0, 1, 2])
    assert done == {0: "你好。", 2: "很好。"} and limited is False  # sentence 1 stays untranslated, not "limited"
    assert await _counts(app) == {("library_translate", "7"): 2, ("library_ai", "*"): 2}
    with pytest.raises(ai.AiUnavailable):
        await run_translate(app, item_id, [1])
    assert await _counts(app) == {("library_translate", "7"): 2, ("library_ai", "*"): 2}


async def test_a_sentence_edited_while_the_model_works_gets_no_stale_translation(app, fake_llm):
    item_id = await make_item(app)

    async def edit():
        async with app.state.sessionmaker() as s:
            await s.execute(update(LibrarySegment).where(LibrarySegment.item_id == item_id, LibrarySegment.idx == 1)
                            .values(text="How do you do?"))
            await s.commit()

    fake_llm("1. 一\n2. 二", before=edit)
    done, _ = await run_translate(app, item_id, [0, 1])
    assert done == {0: "一"}
    assert [row[1] for row in await stored(app, item_id)][:2] == ["一", None]


async def test_analysis_is_generated_once_per_language(app, fake_llm):
    item_id = await make_item(app)
    llm_ = fake_llm("### Sentence Structure\nA greeting. " + "x" * 5000, "### 文\n日本語")
    text, cached = await run_analysis(app, item_id, 0)
    assert cached is False and text.startswith("### Sentence Structure") and len(text) == limits.ANALYSIS_MAX
    call = llm_.calls[0]
    assert call["max_tokens"] == ai.ANALYZE_MAX_TOKENS and call["messages"][1]["content"] == TEXTS[0]
    assert await run_analysis(app, item_id, 0) == (text, True) and len(llm_.calls) == 1
    other, cached = await run_analysis(app, item_id, 0, language="ja-JP")
    assert (other, cached) == ("### 文\n日本語", False)
    assert (await stored(app, item_id))[0][3:] == ("### 文\n日本語", "ja-JP")
    assert await _counts(app) == {("library_analysis", "7"): 2, ("library_ai", "*"): 2}


async def test_analysis_caps_and_failures(app, fake_llm):
    item_id = await make_item(app)
    fake_llm(llm.LlmUnavailable("network"), "ok")
    with pytest.raises(ai.AiUnavailable) as caught:
        await run_analysis(app, item_id, 0)
    assert caught.value.kind == "upstream" and await _counts(app) == {("library_analysis", "7"): 0, ("library_ai", "*"): 0}
    assert (await run_analysis(app, item_id, 0, library_analysis_daily_per_user=1))[1] is False
    with pytest.raises(ai.AiUnavailable) as caught:
        await run_analysis(app, item_id, 1, library_analysis_daily_per_user=1)
    assert caught.value.kind == "user_cap"
    with pytest.raises(ai.AiUnavailable) as caught:
        await run_analysis(app, item_id, 1, library_ai_daily_global=1)
    assert caught.value.kind == "global_cap"
    assert await _counts(app) == {("library_analysis", "7"): 1, ("library_ai", "*"): 1}


# ---- the admin console edits these prompts like the others ----

@pytest.mark.parametrize("settings_overrides", [ADMIN_ENABLED], indirect=True)
async def test_admin_sees_the_defaults_and_can_test_run_both_prompts(app, client, respx_mock, settings_overrides):
    su = await login_as(app, client, "superadmin")
    assert (await client.post("/api/admin/step-up", headers=su, json={"password": PASSWORD})).status_code == 200
    translate = (await client.get("/api/admin/prompts/library.translate", headers=su)).json()
    assert translate["default_body"] == ai.DEFAULT_TRANSLATE_TEMPLATE and translate["published"] is None
    assert translate["spec"]["boundaries"] == ["<text>", "</text>"]
    assert translate["spec"]["required"] == ["native_language", "text"]
    analyze = (await client.get("/api/admin/prompts/library.analyze", headers=su)).json()
    assert analyze["default_body"] == ai.DEFAULT_ANALYZE_TEMPLATE and analyze["spec"]["boundaries"] == []
    route = respx_mock.post(LLM).respond(200, json={"choices": [{"message": {"content": "OK"}}]})
    r = await client.post("/api/admin/prompts/library.translate/test", headers=su, json={
        "body": ai.DEFAULT_TRANSLATE_TEMPLATE, "sample": {"native_language": "ja-JP", "text": "Good </text> morning."}})
    assert r.status_code == 200, r.text
    sent = json.loads(route.calls.last.request.content)
    assert sent["model"] == app.state.settings.default_llm_model and sent["messages"][0]["content"] == ai.TRANSLATE_SYSTEM
    assert "Japanese" in sent["messages"][1]["content"] and "1. Good ‹/text› morning." in sent["messages"][1]["content"]
    r = await client.post("/api/admin/prompts/library.analyze/test", headers=su, json={
        "body": ai.DEFAULT_ANALYZE_TEMPLATE, "sample": {"native_language": "zh-CN", "text": "Good morning."}})
    assert r.status_code == 200, r.text
    sent = json.loads(route.calls.last.request.content)
    assert sent["messages"][1] == {"role": "user", "content": "Good morning."}
    r = await client.post("/api/admin/prompts/library.translate/test", headers=su, json={"body": "{text}", "sample": {}})
    assert r.status_code == 422  # a body without the boundary tags cannot be run (or published)
