import pytest

from app.core import rank_sources
from app.core.rank_sources import RankSource

SRC = RankSource(kind="word_in_chat", default_points=1, label_zh="对话用到新词", label_en="New word used in chat")


@pytest.fixture(autouse=True)
def clean():
    saved = rank_sources.registered()
    rank_sources.clear_for_tests()
    yield
    rank_sources.clear_for_tests()
    for s in saved:
        rank_sources.register(s)


def test_register_is_idempotent_for_the_same_source():
    rank_sources.register(SRC)
    rank_sources.register(SRC)
    assert rank_sources.registered() == (SRC,) and rank_sources.kinds() == frozenset({"word_in_chat"})
    assert rank_sources.get("word_in_chat") is SRC and rank_sources.get("nope") is None


def test_conflicting_or_reserved_or_malformed_kinds_are_refused():
    rank_sources.register(SRC)
    with pytest.raises(ValueError):
        rank_sources.register(RankSource("word_in_chat", 2, "x", "x"))
    for kind in ("chat_turn", "word_learned", "spelling_set", "stage_task", "Bad-Kind", "a" * 17, ""):
        with pytest.raises(ValueError):
            rank_sources.register(RankSource(kind, 1, "x", "x"))
    with pytest.raises(ValueError):
        rank_sources.register(RankSource("ok_kind", 101, "x", "x"))


def test_reserved_kinds_cover_every_existing_rank_kind():
    from app.rank.points import CAPPED, POINTS
    assert set(CAPPED) | set(POINTS) | {"assessment", "voice_turn"} <= rank_sources.RESERVED_KINDS
