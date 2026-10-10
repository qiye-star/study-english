import dataclasses
import random

import pytest

from app.wordbook.books import default_data_dir
from app.wordbook.entry import meaning_line
from app.wordbook.index import DictionaryStore
from app.wordbook.quiz import (build_question, candidate_keys, check_choice, cloze_example, eligible_qtypes,
                               pick_distractors, pick_qtype, question_rng)
from tests.wordbook_helpers import make_data_dir


@pytest.fixture
async def cards(tmp_path):
    store = DictionaryStore(make_data_dir(tmp_path))
    index = await store.index("junior")
    return index, await store.cards("junior", list(index.keys))


async def test_eligible_qtypes_by_box(cards):
    _, c = cards
    assert eligible_qtypes(0, c["talk"]) == ("meaning", "word")
    assert eligible_qtypes(2, c["abandon"]) == ("word", "cloze", "dictation")
    assert eligible_qtypes(2, c["abandon"], tts=False) == ("word", "cloze")
    assert eligible_qtypes(4, c["abandon"]) == ("dictation", "spell")
    assert eligible_qtypes(4, c["used to"]) == ("meaning",)  # 多词词头不出拼写,回落
    assert cloze_example(c["talk"])[0].en == "After a long talk, we decided on divorce."
    assert cloze_example(c["go"]) is None  # 只有变形 went,不出 cloze
    assert "cloze" not in eligible_qtypes(1, c["go"])


def test_question_rng_is_stable():
    assert question_rng(7, "talk", 3).random() == question_rng(7, "talk", 3).random()
    assert question_rng(7, "talk", 3).random() != question_rng(7, "talk", 4).random()


async def test_candidates_share_pos_and_skip_related(cards):
    index, _ = cards
    keys = candidate_keys(index, "abandon", random.Random(1), k=6)
    assert "abandon" not in keys and len(keys) == 6
    assert all(index.pos_mask[index.ordinal[k]] & index.pos_mask[index.ordinal["abandon"]] for k in keys)
    assert candidate_keys(index, "abandon", random.Random(1), k=6) == keys  # 同一 rng 种子结果稳定
    # 只有 adj 的词极少(able、careful)→ 放宽词性也凑够 3 个
    assert len(candidate_keys(index, "able", random.Random(2), k=10)) >= 3


async def test_candidates_skip_inflections_and_shared_prefix():
    store = DictionaryStore(default_data_dir(), cache_size=8)
    index = await store.index("junior")
    for seed in range(5):
        keys = candidate_keys(index, "happy", random.Random(seed))
        assert len(keys) == 24 and not {"happy", "happily", "happier", "happiest"} & set(keys)
        keys = candidate_keys(index, "interest", random.Random(seed))
        assert not [k for k in keys if k.startswith("inter")]  # 共同 5 字母前缀视为同根


async def test_distractors_avoid_shared_meanings(cards):
    _, c = cards
    fake = dataclasses.replace(c["accept"], key="receive", word="receive")
    pool = [c["abandon"], c["absorb"], c["carry"], c["stop"], fake]
    picked = pick_distractors(c["accept"], pool, "meaning", random.Random(3))
    assert len(picked) == 3 and fake not in picked and c["accept"] not in picked


async def test_build_and_check_questions(cards):
    _, c = cards
    others = [c["abandon"], c["absorb"], c["carry"]]
    q = build_question("meaning", c["accept"], others, random.Random(4))
    assert q.prompt == {"word": "accept", "us": "əkˈsɛpt"} and len(q.options) == 4
    assert meaning_line(c["accept"]) in q.options and check_choice("meaning", c["accept"], meaning_line(c["accept"]))
    assert not check_choice("meaning", c["accept"], meaning_line(c["abandon"]))
    w = build_question("word", c["accept"], others, random.Random(4))
    assert set(w.options) == {"accept", "abandon", "absorb", "carry"} and w.prompt["meaning"].startswith("v.")
    cz = build_question("cloze", c["talk"], others, random.Random(5))
    assert cz.prompt["sentence"] == "After a long _____, we decided on divorce." and check_choice("cloze", c["talk"], "Talk")
    sp = build_question("spell", c["accept"], [], random.Random(6))
    assert sp.options is None and sp.length == 6 and "word" not in sp.prompt
    dc = build_question("dictation", c["accept"], [], random.Random(6))
    assert dc.prompt == {"word": "accept"} and dc.length == 6
    assert pick_qtype(0, c["talk"], random.Random(1)) in ("meaning", "word")
    with pytest.raises(ValueError):
        build_question("cloze", c["go"], others, random.Random(1))
    with pytest.raises(ValueError):
        check_choice("spell", c["accept"], "accept")
