import json
from collections import defaultdict

from app.wordbook.entry import (clean_meaning, clean_sentence, headword_key, meaning_line, merge_rows,
                                normalize_phonetic, pos_mask_of, pos_parts, sentence_id)
from tests.wordbook_helpers import MINI


def rows_by_key():
    groups = defaultdict(list)
    for line in MINI.read_text(encoding="utf-8").splitlines():
        row = json.loads(line)
        key = headword_key(row["word"])
        if key:
            groups[key].append(row)
    return groups


def test_headword_rules():
    assert headword_key("  Talk ") == "talk"
    assert headword_key("adj.") is None and headword_key("undersize d") is None
    assert headword_key("a. 灵巧的， 熟练的") is None and headword_key("AluminumAl") is None
    assert headword_key("used to") == "used to" and headword_key("Mr.") == "mr."
    assert len(rows_by_key()) == 14


def test_pos_parsing():
    assert pos_parts("n & v") == ["n", "v"] and pos_parts("v / n") == ["v", "n"] and pos_parts("a&ad") == ["adj", "adv"]
    assert pos_parts(None) == ["other"] and pos_parts("vt") == ["v"]
    assert pos_mask_of(["n", "v"]) == 3 and pos_mask_of(["abbr"]) == 16


def test_text_cleaning():
    assert clean_meaning(" 能力， 本领； 才能 ") == "能力，本领；才能"
    assert normalize_phonetic("/suːˈpɜːrb/") == "suːˈpɜːrb" and normalize_phonetic("ə'bɪləti") == "əˈbɪləti"
    assert clean_sentence("Sue and Bob still aren’t talking (= are refusing to talk to each other ) .") == \
        "Sue and Bob still aren’t talking."
    assert clean_sentence("...memories of her father's complete abandonment of her.") is None
    assert clean_sentence("Too short.") is None
    assert clean_sentence("This coat was dirt cheap 非正式用语 today.") is None
    assert clean_sentence("It was a very cold day.") == "It was a very cold day."
    assert len(sentence_id("abc")) == 16


def test_merge_talk_duplicates():
    card = merge_rows(rows_by_key()["talk"])
    assert (card.key, card.word, card.us, card.uk) == ("talk", "talk", "tɔk", "tɔːk")
    assert [(s.pos, s.text) for s in card.senses] == [("v", "说话；谈话"), ("n", "交谈"), ("n/v", "谈话，讲话")]
    assert [e.en for e in card.examples] == [
        "I could hear Sarah and Andy talking in the next room.", "After a long talk, we decided on divorce.",
        "Sue and Bob still aren’t talking."]
    assert card.pos_mask == 3 and card.spellable
    assert meaning_line(card) == "v. 说话；谈话；n. 交谈"


def test_merge_drops_unmatched_hidden_and_marks_unspellable():
    groups = rows_by_key()
    abandon = merge_rows(groups["abandon"])
    assert [e.en for e in abandon.examples] == ["They had to abandon the car in the deep snow."]
    hidden = frozenset({abandon.examples[0].id})
    assert merge_rows(groups["abandon"], hidden=hidden).examples == ()
    careful = merge_rows(groups["careful"])
    assert careful.us == "" and careful.examples == () and careful.senses[0].text == "小心的，仔细的"
    assert merge_rows(groups["used to"]).spellable
    assert merge_rows([{"word": "Mr.", "us": "", "uk": "", "translations": [], "phrases": [], "sentences": []}]).spellable is False
    assert merge_rows([{"word": "façade"}]).spellable is False
    assert merge_rows([{"word": "adj."}]) is None


def test_meaning_line_truncates():
    card = merge_rows([{"word": "x", "translations": [{"type": "n", "translation": "一" * 30}]}])
    line = meaning_line(card)
    assert len(line) == 24 and line.endswith("…")
