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
    for needle in ("exactly THREE", "Message 1", "Message 2", "Message 3", "streak 0 or missing", "Nothing due",
                   "No slip", "Never invent", "[[user]]"):
        assert needle in G.DEFAULT_GREETING_TEMPLATE


@pytest.mark.parametrize("language", ["zh", "en", "bilingual"])
def test_fixed_prefix_and_contract_always_frame_the_request(language):
    system, user = render(language=language)
    assert [system["role"], user["role"]] == ["system", "user"]
    assert system["content"].startswith(SAFETY_PREAMBLE)
    assert "EXACTLY 3 items" in system["content"] and "3 *marks*" in system["content"]
    assert "single asterisks only" in system["content"]
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
    assert "<facts>" in system["content"] and "streak_days: 23" in system["content"]
    assert user["content"] == G.FALLBACK_USER_LINE


def test_escape_is_applied_to_learner_derived_text():
    nasty = GreetingFacts(slip_category="tense", slip_count=1, slip_wrong="a", slip_right="b", words=("<x>", "＜/facts＞"))
    text = render(language="en", facts=nasty)[1]["content"]
    assert "<x>" not in text and "＜/facts＞" not in text and "‹x›" in text
    assert text.count("</facts>") == 1
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


def test_facts_omit_missing_items_and_never_print_zero_or_unknown():
    text = G.render_facts(GreetingFacts(streak=0, due=0), "en", NOW)
    assert text.splitlines()[0] == "local_date: 2026-10-23 (Friday), time_of_day: morning"
    assert "streak" not in text and "words_due" not in text and "unknown" not in text and "None" not in text
    assert "focus_hint: free_talk" in text and "practice_minutes: 10" in text
    full = G.render_facts(FULL, "en", NOW)
    for line in ('streak_days: 23', 'words_due_today: 12', 'yesterday_slip: "have went" -> "have gone" (category: verb tense)',
                 "yesterday_other: 3 wrong answers in word review; 2 words with weak pronunciation",
                 "weak_words: talk, able", "focus_hint: fix_slip"):
        assert line in full
    assert G.render_facts(GreetingFacts(due=4), "en", NOW).count("focus_hint: review") == 1


def test_facts_without_a_pair_give_only_the_category():
    f = GreetingFacts(slip_category="article", slip_count=3, slip_wrong="x" * 3, slip_right="a<b")
    assert "yesterday_slip: 3 slips (category: articles)" in G.render_facts(f, "en", NOW)


def test_zh_facts_carry_no_learner_words():
    text = G.render_facts(FULL, "zh", NOW)
    assert "yesterday_slip_zh: 在时态上出了 2 处错" in text
    for word in ("have went", "have gone", "talk", "able", "weak_words", "yesterday_slip:"):
        assert word not in text
    stripped = text.replace("yesterday_slip_zh", "").replace("yesterday_other", "")
    assert not re.search(r"\b(?:have|went|gone|talk|able)\b", stripped)


def test_include_stats_false_gives_date_and_free_talk_only_even_with_full_facts():
    for language in ("zh", "en", "bilingual"):
        user = render(language=language, stats=False)[1]["content"]
        for banned in ("streak_days", "words_due_today", "yesterday_", "weak_words", "have went", "talk, able"):
            assert banned not in user
        assert "focus_hint: free_talk" in user and "local_date: 2026-10-23" in user and "practice_minutes: 10" in user


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
        G.render_messages(G.DEFAULT_GREETING_TEMPLATE, None, "en", GreetingFacts(), datetime(2027, 1, 1))[0]


def test_render_test_uses_samples_and_falls_back_on_a_broken_template(caplog):
    caplog.set_level(logging.WARNING)
    messages = G.render_test(G.DEFAULT_GREETING_TEMPLATE, {"language": "en", "facts": "streak_days: 3", "persona": "Name: Z"})
    assert "streak_days: 3" in messages[1]["content"] and "Name: Z" in messages[0]["content"]
    assert 'only the key "en"' in messages[0]["content"]
    default = G.render_test(G.DEFAULT_GREETING_TEMPLATE, {})
    assert "words_due_today: 12" in default[1]["content"] and "have went" in default[1]["content"]
    broken = G.render_test("oops {nope} {facts}", {"language": "zh", "facts": "SECRETFACT"})
    assert "exactly THREE" in broken[0]["content"] and "SECRETFACT" in broken[1]["content"]
    assert "chat greeting template invalid" in caplog.text and "oops" not in caplog.text
    assert G.render_test(G.DEFAULT_GREETING_TEMPLATE, {"language": "xx"})[0]["content"].count('"zh"') >= 1  # falls back to bilingual


def test_limits_in_the_contract_come_from_parse():
    for language in ("zh", "en", "bilingual"):
        contract = G.output_contract(language)
        for key, (low, high, total) in P.LIMITS[language].items():
            assert f"{key}: {low}-{high} characters each, {total} in total" in contract
