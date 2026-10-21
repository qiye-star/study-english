"""L4 Task 5: 候选原形与句子词元(纯函数;plan R6、R10)。"""
from app.activation.matcher import CANDIDATES_MAX, candidates, segment_lemmas

LEMMAS = {"went": "go", "talked": "talk"}


def lemma_of(form: str):
    return LEMMAS.get(form)


def test_candidates_cover_the_headword_behind_irregular_and_regular_forms():
    found, truncated = candidates("She went and talked", lemma_of)
    assert {"go", "talk", "went", "talked", "she"} <= found
    assert truncated is False


def test_a_candidate_must_be_able_to_turn_back_into_the_form():
    found, _ = candidates("bed", lambda _f: None)
    assert "be" not in found and "bed" in found


def test_empty_text_and_pure_chinese_give_no_candidates():
    assert candidates("", lemma_of) == (set(), False)
    assert candidates("我今天去了学校", lemma_of) == (set(), False)


def test_candidates_are_capped_and_the_cap_is_reported():
    def letters(i: int) -> str:  # 300 distinct letters-only words (digits would split the token)
        return "zq" + "".join(chr(97 + (i // 26 ** k) % 26) for k in range(3))
    text = " ".join(letters(i) for i in range(300))
    found, truncated = candidates(text, lambda _f: None)
    assert len(found) == CANDIDATES_MAX and truncated is True
    assert CANDIDATES_MAX == 200


def test_segment_lemmas_keep_one_lemma_per_token_and_drop_stopwords_and_short_words():
    # "go" is two letters, "I" is one, "and" is a stopword: only "there" and "talk" are indexed
    assert segment_lemmas("I went there and talked", lemma_of) == {"there", "talk"}


def test_segment_lemmas_of_nothing_is_empty():
    assert segment_lemmas("", lemma_of) == set()
    assert segment_lemmas("这是一句中文", lemma_of) == set()
