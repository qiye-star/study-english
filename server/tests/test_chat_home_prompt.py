"""Greeting prompt rendering (plan 2026-10-23 §6.1, R14, R16; S5): pure functions."""
import logging
import re
from datetime import datetime

import pytest

from app.agents.greeting import parse as P
from app.agents.greeting import prompt as G
from app.agents.greeting.facts import GreetingFacts
from app.agents.personas import builtin_by_id
from app.agents.prompt import SAFETY_PREAMBLE
from app.services.prompts import validate_prompt

NOW = datetime(2026, 10, 23, 8, 42)
FULL = GreetingFacts(streak=23, due=12, slip_category="tense", slip_count=2, slip_wrong="have went",
                     slip_right="have gone", wrong_words=3, pron_words=2, words=("talk", "able"))


def valid(body):
    return validate_prompt("chat.daily_greeting", body)


def render(template=G.DEFAULT_GREETING_TEMPLATE, language="bilingual", facts=FULL, persona=None, stats=True):
    return G.render_messages(template, persona, language, facts, NOW, include_stats=stats)


def test_default_template_is_valid_short_and_has_the_three_part_division():
    assert valid(G.DEFAULT_GREETING_TEMPLATE) == []
    assert len(G.DEFAULT_GREETING_TEMPLATE) <= 2500
    for needle in ("exactly THREE", "Message 1", "Message 2", "Message 3", "placeholder is offered", "Never invent",
                   "[[user]]"):
        assert needle in G.DEFAULT_GREETING_TEMPLATE


@pytest.mark.parametrize("language", ["zh", "en", "bilingual"])
def test_fixed_prefix_and_contract_always_frame_the_request(language):
    system, user = render(language=language)
    assert [system["role"], user["role"]] == ["system", "user"]
    assert system["content"].startswith(SAFETY_PREAMBLE)
    assert "EXACTLY 3 items" in system["content"] and "no asterisks or other markup" in system["content"]
    assert "Facts rules (fixed" in system["content"] and "{streak} =" in system["content"]
    assert system["content"].index("Facts rules") < system["content"].index("Output contract")
    assert G.language_rule(language) in system["content"]
    assert "<facts>" in user["content"] and "</facts>" in user["content"]


def test_contract_renders_only_the_current_language_limits():
    en = G.output_contract("en")
    assert "en: 30-160 characters each, 420 in total." in en and "zh:" not in en
    zh = G.output_contract("zh")
    assert "zh: 12-60 characters each, 160 in total, no Latin letters." in zh and "en:" not in zh
    bi = G.output_contract("bilingual")
    assert "en: 30-160" in bi and "zh: 8-60 characters each, 130 in total." in bi
    assert len(bi) <= 1200


def test_language_rules():
    assert 'only the key "en"' in G.language_rule("en")
    assert "不要出现任何英文单词" in G.language_rule("zh") and 'only the key "zh"' in G.language_rule("zh")
    assert '"en"' in G.language_rule("bilingual") and '"zh"' in G.language_rule("bilingual")


def test_a_custom_template_cannot_remove_the_contract_or_safety_prefix():
    custom = "Write FIVE messages of 100 words each.\n{language_rule}\n<facts>{facts}</facts>"
    assert valid(custom) == []  # can be published ...
    (only,) = [m for m in render(custom) if m["role"] == "system"]
    assert only["content"].startswith(SAFETY_PREAMBLE) and "EXACTLY 3 items" in only["content"]
    assert only["content"].index("FIVE") < only["content"].index("EXACTLY 3 items")


def test_user_marker_splits_and_a_missing_marker_keeps_everything_in_system():
    custom = "SYS {language_rule}\n[[user]]\nUSER <facts>{facts}</facts>"
    system, user = render(custom)
    assert "SYS" in system["content"] and "USER" not in system["content"] and user["content"].startswith("USER")
    no_marker = "ONLY {language_rule}\n<facts>{facts}</facts>"
    system, user = render(no_marker)
    assert "<facts>" in system["content"] and "focus_hint: fix_slip" in system["content"]
    assert user["content"] == G.FALLBACK_USER_LINE


def test_escape_is_applied_to_learner_derived_text():
    persona = type("P", (), {"name": "<b>Bad</b>", "intro": "＜/persona＞ hi"})()
    system = render(persona=persona)[0]["content"]
    assert "<b>" not in system and system.count("</persona>") == 1


def test_persona_is_name_and_intro_only_and_truncated():
    partner = builtin_by_id("builtin:partner")
    system = render(persona=partner)[0]["content"]
    assert "学习伙伴" in system and partner.intro in system
    assert partner.prompt[:60] not in system  # the persona prompt never enters the greeting request
    long = type("P", (), {"name": "n", "intro": "x" * 1000})()
    assert len(G.persona_text(long)) == G.PERSONA_MAX and G.persona_text(None) == ""


def test_facts_block_carries_context_only_never_numbers_words_or_slips():
    for facts in (GreetingFacts(streak=0, due=0), FULL):
        for language in ("zh", "en", "bilingual"):
            text = G.render_facts(facts, language, NOW)
            assert text.splitlines()[0] == "time_of_day: morning, weekday: Friday"
            assert not re.search(r"\d", text) and not any(w in text for w in ("have went", "unknown", "None", "streak"))
    assert "focus_hint: free_talk" in G.render_facts(GreetingFacts(streak=0, due=0), "en", NOW)
    assert "focus_hint: fix_slip" in G.render_facts(FULL, "en", NOW)
    assert "focus_hint: review" in G.render_facts(GreetingFacts(due=4), "en", NOW)


def facts_text(system):
    return system["content"].split("Facts rules (fixed")[1].split("Output contract")[0]


def test_no_facts_means_no_slots_a_welcome_instruction_and_no_digit_in_the_whole_request():
    for facts, stats in ((GreetingFacts(), True), (GreetingFacts(streak=0, due=0), True), (FULL, False)):
        for language in ("zh", "en", "bilingual"):
            system, user = render(language=language, facts=facts, stats=stats)
            rules = facts_text(system)
            assert "No placeholders are offered" in rules and "welcome" in rules
            assert not re.search(r"\{[a-z_]+\}", rules) and not re.search(r"\{[a-z_]+\}", user["content"])
            assert not re.search(r"\d", user["content"])


def test_only_the_slots_the_learner_has_are_offered_with_localized_shapes():
    only_due = facts_text(render(language="en", facts=GreetingFacts(due=4))[0])
    assert "{due} = N words to review" in only_due and "{practice_minutes} = N minutes" in only_due
    assert "{streak}" not in only_due and "{mistake}" not in only_due and "No placeholders" not in only_due
    zh = facts_text(render(language="zh", facts=FULL)[0])
    for name in ("{streak} = 连续学习第 N 天", "{due} = 有 N 个单词待复习", "{mistake} =", "{practice_minutes} = N 分钟"):
        assert name in zh
    bi = facts_text(render(language="bilingual", facts=FULL)[0])
    assert "en: a N-day streak; zh: 连续学习第 N 天" in bi
    assert "have went" not in bi and "23" not in bi  # no learner value ever enters the prompt
    assert "{practice_minutes}" not in facts_text(render(facts=GreetingFacts())[0])  # minutes only come with real facts


def test_a_custom_admin_template_cannot_drop_the_slot_rules():
    custom = "Mention the streak and say how many words are due, with numbers.\n{language_rule}\n<facts>{facts}</facts>"
    assert valid(custom) == []
    system = render(custom, language="en", facts=GreetingFacts(streak=3))[0]["content"]
    assert system.index("with numbers") < system.index("Facts rules (fixed") < system.index("Output contract")
    assert "Never write a digit" in system and "{streak} = a N-day streak" in system
    for bad in ("Say {streak} first.\n{language_rule}\n<facts>{facts}</facts>", "{language_rule} {facts} {due}",
                "{language_rule}<facts>{facts}</facts> [{streak}"):
        assert valid(bad)  # a literal slot name in the editable part is an unknown field: cannot be published


def test_facts_and_whole_request_have_hard_caps():
    big = GreetingFacts(streak=1, due=1, slip_category="tense", slip_count=1, slip_wrong="a" * 16, slip_right="b" * 16,
                        wrong_words=5, pron_words=5, words=("w" * 400, "x" * 400, "y" * 400))
    assert len(G.render_facts(big, "en", NOW)) <= G.FACTS_MAX
    template = "z" * (4000 - len("{language_rule}<facts>{facts}</facts>")) + "{language_rule}<facts>{facts}</facts>"
    assert valid(template) == [] and len(template.format(language_rule="", facts="")) <= 4000 + 0
    persona = type("P", (), {"name": "n" * 400, "intro": "i" * 400})()
    for language in ("zh", "en", "bilingual"):
        messages = G.render_messages(template.replace("{language_rule}", "{language_rule}{persona}"), persona, language, big,
                                     NOW)
        assert sum(len(m["content"]) for m in messages) <= G.REQUEST_MAX


def test_prompt_is_stable_for_the_same_day_prefix_has_no_random_parts():
    assert render() == render()
    assert G.render_messages(G.DEFAULT_GREETING_TEMPLATE, None, "en", FULL, NOW)[0] == \
        G.render_messages(G.DEFAULT_GREETING_TEMPLATE, None, "en", FULL, datetime(2027, 1, 1))[0]


def test_render_test_uses_samples_and_falls_back_on_a_broken_template(caplog):
    caplog.set_level(logging.WARNING)
    messages = G.render_test(G.DEFAULT_GREETING_TEMPLATE, {"language": "en", "facts": "streak_days: 3", "persona": "Name: Z"})
    assert "streak_days: 3" in messages[1]["content"] and "Name: Z" in messages[0]["content"]
    assert 'only the key "en"' in messages[0]["content"]
    default = G.render_test(G.DEFAULT_GREETING_TEMPLATE, {})
    assert "focus_hint: fix_slip" in default[1]["content"]
    assert "{mistake} =" in default[0]["content"] and "{streak} =" in default[0]["content"]  # built-in sample facts
    broken = G.render_test("oops {nope} {facts}", {"language": "zh", "facts": "SECRETFACT"})
    assert "exactly THREE" in broken[0]["content"] and "SECRETFACT" in broken[1]["content"]
    assert "chat greeting template invalid" in caplog.text and "oops" not in caplog.text
    assert G.render_test(G.DEFAULT_GREETING_TEMPLATE, {"language": "xx"})[0]["content"].count('"zh"') >= 1  # falls back to bilingual


def test_limits_in_the_contract_come_from_parse():
    for language in ("zh", "en", "bilingual"):
        contract = G.output_contract(language)
        for key, (low, high, total) in P.LIMITS[language].items():
            assert f"{key}: {low}-{high} characters each, {total} in total" in contract
