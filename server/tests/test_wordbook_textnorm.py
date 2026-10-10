import pytest

from app.wordbook.textnorm import fold, find_form, inflections, lemma_candidates, same_lemma, tokenize


def test_fold_and_tokenize():
    assert fold("  Don’t ") == "don't"
    assert [t.text for t in tokenize("Sue and Bob still aren’t talking (= no) , oat-milk!")] == [
        "Sue", "and", "Bob", "still", "aren’t", "talking", "no", "oat-milk"]


@pytest.mark.parametrize("lemma,forms", [
    ("talk", {"talks", "talked", "talking"}),
    ("carry", {"carries", "carried", "carrying"}),
    ("stop", {"stops", "stopped", "stopping"}),
    ("make", {"makes", "made", "making"}),
    ("go", {"goes", "went", "gone", "going"}),
    ("child", {"children"}),
    ("box", {"boxes"}),
    ("happy", {"happier", "happiest", "happily"}),
])
def test_inflections(lemma, forms):
    assert forms <= inflections(lemma) and lemma in inflections(lemma)


def test_visit_is_not_double_consonant():
    assert "visited" in inflections("visit") and "visitted" not in inflections("visit")


@pytest.mark.parametrize("form,lemma", [("talking", "talk"), ("carried", "carry"), ("stopped", "stop"),
                                        ("went", "go"), ("children", "child"), ("making", "make"), ("boxes", "box")])
def test_lemma_candidates(form, lemma):
    assert lemma in lemma_candidates(form)
    assert same_lemma(form, lemma) and same_lemma(lemma, form)


def test_same_lemma_rejects_unrelated_words():
    assert not same_lemma("talk", "walk") and not same_lemma("bed", "be")


def test_find_form_prefers_exact_then_inflected_and_handles_phrases():
    s = "I could hear Sarah and Andy talking in the next room."
    assert find_form(s, "talk") == (28, 35, "talking")
    assert find_form("After a long talk, we talked.", "talk") == (13, 17, "talk")
    assert find_form("She went home early.", "go") == (4, 8, "went")
    assert find_form("I used to live by the sea.", "used to") == (2, 9, "used to")
    assert find_form("See you on Monday morning.", "monday") == (11, 17, "Monday")
    assert find_form("Nothing here.", "talk") is None
