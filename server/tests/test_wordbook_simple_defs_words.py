"""难词判定(计划 2026-10-27 S1 / R-S2):纯函数 `hard_words`,不访问网络、不读文件(除了 load_easy 的缺文件情况)。"""
from pathlib import Path

from app.wordbook.simple_defs import easy_path, hard_words, load_easy

EASY = frozenset({"make", "less", "active", "or", "the", "to", "a", "run", "quickly", "go", "person", "who", "child"})


def _no_forms(_form: str) -> None:
    return None


def test_hard_words_returns_the_word_outside_the_easy_list():
    assert hard_words("make less active or intense", "abate", easy=EASY, lemma_of=_no_forms) == ["intense"]


def test_the_headword_and_its_forms_are_not_hard():
    forms = {"abated": "abate", "abating": "abate"}.get
    assert hard_words("to abate, or abated quickly", "abate", easy=EASY, lemma_of=forms) == []


def test_a_form_whose_lemma_is_easy_is_not_hard():
    forms = {"went": "go"}.get
    assert hard_words("went away", "leave", easy=EASY | {"away"}, lemma_of=forms) == []


def test_numbers_single_letters_and_bracketed_abbreviations_are_skipped():
    assert hard_words("a 3 x (e.g. zebra) run", "walk", easy=EASY, lemma_of=_no_forms) == []


def test_matching_is_case_insensitive_and_unique():
    assert hard_words("Intense or INTENSE", "abate", easy=EASY, lemma_of=_no_forms) == ["intense"]


def test_empty_text_has_no_hard_words():
    assert hard_words("", "abate", easy=EASY, lemma_of=_no_forms) == []


def test_load_easy_missing_file_is_an_empty_list(tmp_path: Path):
    assert load_easy(tmp_path / "easy-words.txt") == frozenset()


def test_easy_path_sits_beside_the_word_book_folder(tmp_path: Path):
    books = tmp_path / "kylebing-english-vocabulary"
    assert easy_path(books) == tmp_path / "wordbook-definitions" / "easy-words.txt"
