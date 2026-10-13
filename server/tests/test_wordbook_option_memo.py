"""选项备忘(计划 2026-10-13-review-after-answer S1):按 (用户, 书, 词, 题型) 取、有界 LRU、模块里没有日志调用。"""
from pathlib import Path

from app.wordbook import option_memo
from app.wordbook.index import DictionaryStore
from app.wordbook.option_memo import OptionMemo
from tests.wordbook_helpers import make_data_dir

PAIRS = (("v. 说话；谈话", "talk"), ("n. 事故", "accident"))


def test_remember_and_recall_by_the_whole_slot():
    memo = OptionMemo()
    memo.remember(1, "junior", "talk", "meaning", PAIRS)
    assert memo.recall(1, "junior", "talk", "meaning") == PAIRS
    assert memo.recall(2, "junior", "talk", "meaning") is None  # another user
    assert memo.recall(1, "senior", "talk", "meaning") is None  # another book
    assert memo.recall(1, "junior", "able", "meaning") is None  # another word
    assert memo.recall(1, "junior", "talk", "word") is None  # another question type


def test_the_latest_question_for_a_slot_wins():
    memo = OptionMemo()
    memo.remember(1, "junior", "talk", "meaning", PAIRS)
    newer = (("x", "talk"),)
    memo.remember(1, "junior", "talk", "meaning", newer)
    assert memo.recall(1, "junior", "talk", "meaning") == newer and len(memo) == 1


def test_it_is_bounded_and_the_least_recently_used_goes_first():
    memo = OptionMemo(size=2)
    memo.remember(1, "junior", "a", "meaning", PAIRS)
    memo.remember(1, "junior", "b", "meaning", PAIRS)
    assert memo.recall(1, "junior", "a", "meaning") == PAIRS  # touching a makes b the oldest
    memo.remember(1, "junior", "c", "meaning", PAIRS)
    assert memo.recall(1, "junior", "b", "meaning") is None
    assert memo.recall(1, "junior", "a", "meaning") == PAIRS and len(memo) == 2


def test_clear_forgets_everything():
    memo = OptionMemo()
    memo.remember(1, "junior", "talk", "meaning", PAIRS)
    memo.clear()
    assert memo.recall(1, "junior", "talk", "meaning") is None and len(memo) == 0


def test_the_module_is_not_a_logging_site():
    source = Path(option_memo.__file__).read_text(encoding="utf-8")
    assert "logging" not in source and "logger" not in source


async def test_the_dictionary_store_carries_its_own_memo(tmp_path):
    first = DictionaryStore(make_data_dir(tmp_path))
    second = DictionaryStore(make_data_dir(tmp_path))
    assert isinstance(first.option_memo, OptionMemo) and first.option_memo is not second.option_memo
