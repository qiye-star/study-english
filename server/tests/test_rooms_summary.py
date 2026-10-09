import json

import pytest

from app.rooms.summary import Line, SummaryFormatError, build_chat, eligible, member_lines, parse_summary, view_for

A, B = 1, 2
LINES = [Line(1, A, "alice", "text", "I go to cinema yesterday."), Line(2, B, "bob", "voice", "What film you saw?"),
         Line(3, None, "AI 助手", "ai_answer", "Use the past tense."), Line(4, A, "alice", "text", "A comedy.")]


def test_eligibility_counts_member_messages_only():
    assert [line.seq for line in member_lines(LINES)] == [1, 2, 4]
    assert eligible(LINES, 3) is True and eligible(LINES, 4) is False


def test_build_chat_drops_oldest_lines_first():
    chat = build_chat(LINES, 60)
    assert chat.splitlines()[-1] == "#4 alice: A comedy." and "#1" not in chat
    assert len(chat) <= 60
    assert build_chat(LINES, 10_000).splitlines()[0] == "#1 alice: I go to cinema yesterday."


def test_build_chat_flattens_newlines_in_messages():
    chat = build_chat([Line(5, A, "alice", "text", "line one\nline two")], 1000)
    assert chat == "#5 alice: line one line two"


def test_parse_summary_trusts_only_known_member_seqs():
    raw = "```json\n" + json.dumps({
        "overview_zh": "大家聊了电影。" * 40,
        "words": [{"en": "comedy", "zh": "喜剧", "example": "I love comedies."}] * 10,
        "fixes": [{"seq": 1, "better": "I went to the cinema yesterday.", "note_zh": "过去时"},
                  {"seq": 3, "better": "x", "note_zh": "AI 消息不批改"},
                  {"seq": 99, "better": "x", "note_zh": "不存在"},
                  {"seq": 2, "better": "What film did you see?", "note_zh": "疑问句"}],
    }) + "\n```"
    data = parse_summary(raw, LINES)
    assert len(data["overview_zh"]) == 200 and len(data["words"]) == 8
    assert [(f["seq"], f["sender_id"], f["original"]) for f in data["fixes"]] == [
        (1, A, "I go to cinema yesterday."), (2, B, "What film you saw?")]
    mine = view_for(data, B)
    assert [f["seq"] for f in mine["my_fixes"]] == [2] and "sender_id" not in mine["my_fixes"][0]
    assert mine["overview_zh"] == data["overview_zh"] and mine["words"] == data["words"]


def test_parse_summary_caps_fixes_per_member_and_total():
    lines = [Line(i, i % 6, f"u{i % 6}", "text", f"msg {i}") for i in range(1, 41)]
    fixes = [{"seq": i, "better": f"better {i}", "note_zh": "n"} for i in range(1, 41)]
    fixes += [{"seq": 1, "better": "dup", "note_zh": "n"}, {"seq": True, "better": "x"}, {"seq": 2, "better": ""},
              "junk"]
    data = parse_summary(json.dumps({"overview_zh": "好", "words": "nope", "fixes": fixes}), lines)
    per_member = {}
    for f in data["fixes"]:
        per_member[f["sender_id"]] = per_member.get(f["sender_id"], 0) + 1
    assert len(data["fixes"]) == 15 and max(per_member.values()) == 3 and data["words"] == []
    assert len({f["seq"] for f in data["fixes"]}) == 15


def test_parse_summary_truncates_fields_and_drops_bad_words():
    raw = json.dumps({"overview_zh": "  好  ", "words": [{"en": "w" * 100, "zh": "z" * 100, "example": "e" * 300},
                                                        {"en": "", "zh": "空"}, {"zh": "no en"}, 5],
                      "fixes": [{"seq": 1, "better": "b" * 400, "note_zh": "n" * 100}]})
    data = parse_summary(raw, LINES)
    assert data["overview_zh"] == "好"
    assert data["words"] == [{"en": "w" * 80, "zh": "z" * 80, "example": "e" * 200}]
    assert len(data["fixes"][0]["better"]) == 300 and len(data["fixes"][0]["note_zh"]) == 80


@pytest.mark.parametrize("raw", ["not json", "[]", '{"words": []}', '{"overview_zh": "   "}', "", None])
def test_parse_summary_rejects_bad_output(raw):
    with pytest.raises(SummaryFormatError):
        parse_summary(raw, LINES)
