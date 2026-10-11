import pytest

from app.agents.memory import profile as P
from app.agents.memory.tombstones import REDACTED, clean_text, redact, text_hash, unsafe_reason


def test_clean_text_is_one_line_nfkc_without_controls():
    assert clean_text("  Ｉ ｌｉｋｅ\n\tcats​ ") == "I like cats"


def test_text_hash_ignores_case_spacing_and_punctuation():
    assert text_hash("I want to pass IELTS.") == text_hash("i want to pass ielts")
    assert text_hash("想考雅思 7 分!") == text_hash("想考雅思7分")
    assert text_hash("likes cats") != text_hash("likes dogs")


@pytest.mark.parametrize("text, reason", [
    ("我的邮箱是 lily@example.com", "email"),
    ("看 https://example.org/a", "url"),
    ("my blog is lily.dev", "url"),
    ("key sk-abcdEFGH12345678", "secret"),
    ("我的密码是 hunter2", "secret"),
    ("token a1b2c3d4e5f6a7b8c9d0e1f2a3", "secret"),
    ("学号 20231234", "digits"),
    ("电话 138 1234 5678", "phone"),
])
def test_unsafe_content_is_rejected(text, reason):
    assert unsafe_reason(text) == reason


@pytest.mark.parametrize("text, reason", [
    ("short link bit.ly/x", "url"),
    ("see t.co/AbC123", "url"),
    ("go to tinyurl.com/yabc", "url"),
    ("my key AKIAIOSFODNN7EXAMPLE", "secret"),
    ("pw: hunter2", "secret"),
    ("pwd = hunter2", "secret"),
    ("密码:abc123", "secret"),
    ("github_pat_11ABCDEFG0abcdefghijkl", "secret"),
    ("138/1234/5678", "phone"),
    ("138_1234_5678", "phone"),
    ("１３８１２３４５６７８", "digits"),
    ("tom at gmail dot com", "email"),
    ("tom (at) gmail (dot) com", "email"),
    ("tom 艾特 gmail 点 com", "email"),
    ("我的微信号 abc_12345", "contact"),
    ("wechat: lily2024x", "contact"),
    ("vx lily_2024", "contact"),
    ("手机 一三八一二三四五六七八", "digits"),
    ("零〇一二三四五六", "digits"),
    ("日期 10/12/20261234", "digits"),
])
def test_obfuscated_sensitive_content_is_rejected(text, reason):
    assert unsafe_reason(text) == reason
    assert REDACTED in redact(text)


@pytest.mark.parametrize("text", [
    "I'll meet you at the gym", "Please dot the i and cross the t", "pass the salt please", "I use WeChat every day",
    "我喜欢用微信聊天", "wechat is popular in China", "Meet at 3/4 of the way", "on 10/12/2026 I start",
    "我会数一二三", "Version 2.0 and 3.1", "and/or, he/she", "e.g. a.m. / p.m.", "I want to look at the dot plot",
    "pass: I mean the exam", "Time: 7:30 to 8:30"])
def test_normal_learning_text_is_not_flagged(text):
    assert unsafe_reason(text) is None


@pytest.mark.parametrize("text", ["我想在 2026-12-20 前考到 B2", "I like cats and jazz", "每天晚上学 20 分钟",
                                  "Goal: IELTS 7.0"])
def test_ordinary_text_passes(text):
    assert unsafe_reason(text) is None


def test_redact_replaces_only_the_unsafe_parts_and_keeps_dates():
    assert redact("约在 2026-10-20,联系 lily@example.com 或 138 1234 5678") == \
        f"约在 2026-10-20,联系 {REDACTED} 或 {REDACTED}"


def test_clean_value_per_key():
    assert P.clean_value("level", "B1") == "B1"
    assert P.clean_value("goals", [" 雅思 7 分 ", "雅思 7 分", "口语流利"]) == ["雅思 7 分", "口语流利"]
    assert P.clean_value("native", "中文") == "中文"
    assert P.clean_value("correction", "direct") == "direct"
    assert P.clean_value("schedule", None) is None


@pytest.mark.parametrize("key, value", [
    ("level", "B3"), ("level", 3), ("goals", "雅思"), ("goals", ["a"] * 6), ("interests", ["x" * 21]),
    ("native", "x" * 21), ("schedule", "call me 13812345678"), ("correction", "always"), ("age", 20),
])
def test_clean_value_rejects(key, value):
    with pytest.raises(P.ProfileError) as exc:
        P.clean_value(key, value)
    assert exc.value.key == key


def test_user_edits_win_and_the_agent_only_proposes_for_edited_keys():
    data, edited, proposals = P.apply_user_patch({}, [], {"level": "B2"}, {"level": "B1"}, [])
    assert (data, edited, proposals) == ({"level": "B1"}, ["level"], {})
    data2, proposals2, outcome = P.apply_proposal(data, edited, proposals, "level", "B2")
    assert (data2, proposals2, outcome) == ({"level": "B1"}, {"level": "B2"}, "proposed")
    data3, _, outcome = P.apply_proposal(data, edited, proposals, "native", "中文")
    assert (data3, outcome) == ({"level": "B1", "native": "中文"}, "applied")
    assert P.apply_proposal(data3, edited, {}, "native", "中文")[2] == "same"
    assert P.apply_proposal(data3, edited, {}, "native", None)[2] == "same"  # the agent never deletes a key
    data4, edited4, proposals4 = P.apply_user_patch(data3, edited, {"level": "B2"}, {"native": None}, ["level"])
    assert (data4, edited4, proposals4) == ({"level": "B1"}, ["level", "native"], {})


def test_profile_line_is_ordered_and_skips_empty_values():
    assert P.profile_line({"goals": ["雅思 7 分"], "level": "B1", "native": ""}) == "level: B1; goals: 雅思 7 分"
