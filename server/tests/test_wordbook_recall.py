"""三档自评纯规则(spec 2026-10-11-wordbook-recall §5)。"""
from app.wordbook.recall import (FAST_MS, GRADE, KNOW_CHECK, LearnDecision, as_rating, effective_rating, learn_decision,
                                 learn_quiz_target, learn_rerate_target, needs_check, spot_hit)


def test_peek_turns_know_into_fuzzy():
    assert effective_rating("know", revealed_before=True, previous=None) == "fuzzy"
    assert effective_rating("know", revealed_before=False, previous="fuzzy") == "know"


def test_two_fuzzy_in_a_row_count_as_unknown_in_pairs():
    assert effective_rating("fuzzy", revealed_before=False, previous=None) == "fuzzy"
    assert effective_rating("fuzzy", revealed_before=False, previous="fuzzy") == "unknown"
    assert effective_rating("fuzzy", revealed_before=False, previous="unknown") == "fuzzy"
    assert effective_rating("know", revealed_before=True, previous="fuzzy") == "unknown"
    assert effective_rating("unknown", revealed_before=False, previous="fuzzy") == "unknown"


def test_know_check_counts_as_know_for_the_streak():
    assert as_rating(KNOW_CHECK) == "know" and as_rating("correct") is None
    assert effective_rating("fuzzy", revealed_before=False, previous=KNOW_CHECK) == "fuzzy"


def test_spot_hit_is_deterministic_and_close_to_the_ratio():
    keys = [f"w{i}" for i in range(10_000)]
    hits = sum(spot_hit(12345, 7, k, 0, 33) for k in keys)
    assert 3100 <= hits <= 3500, hits  # 写计划时实测 3,344
    assert [spot_hit(12345, 7, k, 0, 33) for k in keys[:50]] == [spot_hit(12345, 7, k, 0, 33) for k in keys[:50]]


def test_spot_hit_bounds():
    assert not any(spot_hit(1, 1, f"w{i}", 0, 0) for i in range(500))
    assert all(spot_hit(1, 1, f"w{i}", 0, 100) for i in range(500))


def test_seed_changes_the_pick():
    assert [spot_hit(1, 7, f"w{i}", 0, 33) for i in range(200)] != [spot_hit(2, 7, f"w{i}", 0, 33) for i in range(200)]


def test_needs_check_only_for_know_and_fast_taps_force_it():
    miss = next(f"w{i}" for i in range(1000) if not spot_hit(9, 7, f"w{i}", 0, 33))
    assert not needs_check("know", seed=9, user_id=7, key=miss, reps=0, pct=33, elapsed_ms=4000)
    assert needs_check("know", seed=9, user_id=7, key=miss, reps=0, pct=33, elapsed_ms=400)
    assert not needs_check("know", seed=9, user_id=7, key=miss, reps=0, pct=0, elapsed_ms=400)
    assert not needs_check("fuzzy", seed=9, user_id=7, key=miss, reps=0, pct=100, elapsed_ms=400)
    assert not needs_check("know", seed=9, user_id=7, key=miss, reps=0, pct=33, elapsed_ms=None)
    assert FAST_MS == 1000


def test_learn_decision_boxes():
    assert learn_decision("know", False) == LearnDecision(2, "know", False)
    assert learn_decision("know", True) == LearnDecision(1, KNOW_CHECK, True)
    assert learn_decision("fuzzy", True) == LearnDecision(1, "fuzzy", False)
    assert learn_decision("unknown", False) == LearnDecision(0, "unknown", False)


def test_learn_quiz_target():
    assert learn_quiz_target(1, KNOW_CHECK, True) == 2
    assert learn_quiz_target(1, KNOW_CHECK, False) == 0
    assert learn_quiz_target(1, "fuzzy", True) is None
    assert learn_quiz_target(1, "fuzzy", False) == 0
    assert learn_quiz_target(0, "unknown", False) is None
    assert learn_quiz_target(2, KNOW_CHECK, True) is None   # 已升过:不再升
    assert learn_quiz_target(0, KNOW_CHECK, True) is None   # 已降:答对也不回升
    assert learn_quiz_target(1, KNOW_CHECK, True, passes_check=False) is None  # 不是抽查题 / 抽中后再评过
    assert learn_quiz_target(1, KNOW_CHECK, False, passes_check=False) == 0


def test_rerate_only_lowers():
    assert learn_rerate_target(2, "unknown") == 0
    assert learn_rerate_target(2, "fuzzy") == 1
    assert learn_rerate_target(1, "know") is None
    assert learn_rerate_target(0, "unknown") is None
    assert GRADE == {"know": "good", "fuzzy": "hard", "unknown": "forgot"}


async def test_recall_is_never_offered_at_box_0_or_3_and_keeps_v1_picks(tmp_path):
    from app.wordbook.index import DictionaryStore
    from app.wordbook.quiz import RECALL_SHARE_PCT, build_question, pick_qtype, question_rng, use_recall
    from tests.wordbook_helpers import make_data_dir
    keys = [f"w{i}" for i in range(5000)]
    assert not any(use_recall(7, k, 0, box) for k in keys[:500] for box in (0, 3))
    share = sum(use_recall(7, k, 0, 1) for k in keys)
    assert abs(share - 5000 * RECALL_SHARE_PCT / 100) <= 150, share
    assert [use_recall(7, k, 2, 2) for k in keys[:100]] == [use_recall(7, k, 2, 2) for k in keys[:100]]
    store = DictionaryStore(make_data_dir(tmp_path))
    card = (await store.cards("junior", ["talk"]))["talk"]
    q = build_question("recall", card, [], question_rng(7, "talk", 0))
    assert (q.qtype, q.prompt, q.options, q.length) == ("recall", {"word": "talk", "us": "tɔk"}, None, None)
    assert pick_qtype(2, card, question_rng(7, "talk", 3)) in ("word", "cloze", "dictation")  # v1 选题不变
