import pytest

from app.wordbook.grading import DiffOp, align, grade_blank, levenshtein, srs_grade, typo_limit, worst


@pytest.mark.parametrize("expected,lemma,typed,outcome,credit", [
    ("talking", "talk", "talking", "correct", 100),
    ("talking", "talk", "  Talking ", "correct", 100),
    ("don’t", "don't", "don't", "correct", 100),
    ("talking", "talk", "talked", "inflection", 50),
    ("talking", "talk", "talk", "inflection", 50),
    ("went", "go", "go", "inflection", 50),
    ("children", "child", "childs", "inflection", 50),
    ("children", "child", "chilren", "typo", 50),
    ("talking", "talk", "talkng", "typo", 50),
    ("necessary", "necessary", "neccessary", "typo", 50),
    ("necessary", "necessary", "nesesary", "typo", 50),
    ("cat", "cat", "cut", "typo", 50),
    ("cat", "cat", "dog", "wrong", 0),
    ("ability", "ability", "", "wrong", 0),
    ("ability", "ability", "   ", "wrong", 0),
    ("accident", "accident", "event", "wrong", 0),
])
def test_grade_blank(expected, lemma, typed, outcome, credit):
    result = grade_blank(expected, lemma, typed)
    assert (result.outcome, result.credit) == (outcome, credit)


def test_result_carries_trimmed_input_and_expected_form():
    result = grade_blank("Monday", "monday", "  monday ")
    assert (result.outcome, result.typed, result.expected) == ("correct", "monday", "Monday")


def test_hint_halves_credit_and_maps_to_hard():
    assert grade_blank("talk", "talk", "talk", hinted=True).credit == 50
    assert grade_blank("talking", "talk", "talkng", hinted=True).credit == 25
    assert grade_blank("talk", "talk", "dog", hinted=True).credit == 0
    assert srs_grade("correct", False) == "good" and srs_grade("correct", True) == "hard"
    assert srs_grade("typo", False) == "hard" and srs_grade("inflection", False) == "hard"
    assert srs_grade("wrong", False) == "forgot" and srs_grade("wrong", True) == "forgot"


def test_levenshtein_and_limits():
    assert levenshtein("kitten", "sitting") == 3 and levenshtein("", "ab") == 2
    assert typo_limit(4) == 1 and typo_limit(5) == 2 and typo_limit(12) == 2


def test_align_marks_missing_extra_and_wrong_letters():
    assert align("talking", "talkng") == (
        DiffOp("eq", "t", "t"), DiffOp("eq", "a", "a"), DiffOp("eq", "l", "l"), DiffOp("eq", "k", "k"),
        DiffOp("del", "i", ""), DiffOp("eq", "n", "n"), DiffOp("eq", "g", "g"))
    assert [d.op for d in align("cat", "cut")] == ["eq", "sub", "eq"]
    assert [d.op for d in align("go", "goo")].count("ins") == 1
    assert grade_blank("talking", "talk", "talkng").diff[4] == DiffOp("del", "i", "")
    assert grade_blank("cat", "cat", "dog").diff == (DiffOp("sub", "c", "d"), DiffOp("sub", "a", "o"),
                                                    DiffOp("sub", "t", "g"))
    assert grade_blank("talking", "talk", "talking").diff == ()
    assert grade_blank("talking", "talk", "talked").diff == ()
    assert grade_blank("ability", "ability", "xyzxyzxyzxyz").diff == ()  # 长度差太大不对齐


def test_worst():
    assert worst(["correct", "typo"]) == "typo" and worst(["typo", "inflection"]) == "inflection"
    assert worst(["correct", "wrong", "typo"]) == "wrong"


def test_very_long_input_is_wrong_without_alignment():
    result = grade_blank("talk", "talk", "x" * 5000)
    assert (result.outcome, result.diff) == ("wrong", ())
