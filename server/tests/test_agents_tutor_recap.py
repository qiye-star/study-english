"""收尾总结(spec §7.4;计划 A3 S5)。"""
from app.agents.tutor.machine import Answered, Asked, Finished, HintUsed, Skipped, new_state, next_state
from app.agents.tutor.plan import Goal, PlanItem
from app.agents.tutor.recap import MAX_CANDIDATES, build_recap, memory_candidates, summary_text

PLAN = (PlanItem("words", "today_words", ("abandon", "give up")), PlanItem("ask", "today_words", ()),
        PlanItem("repeat", "today_words", ("resilient",)), PlanItem("dictate", "today_words", ()),
        PlanItem("words", "today_words", ("zephyr", "abandon")))


def run(*events):
    s = next_state(new_state(PLAN, "B1"), Asked())
    for event in events:
        s = next_state(s, event)
        if s.phase == "ask":
            s = next_state(s, Asked())
    return next_state(s, Finished())


FULL = (Answered("good"), Answered("good"), HintUsed(), Answered("ok"), Skipped(), Answered("weak"))


def test_scores_strengths_weaknesses_and_words():
    r = build_recap(run(*FULL), Goal(topic="today_words", length=5))
    assert r["scores"] == {"good": 2, "ok": 1, "weak": 1, "skip": 1}
    assert (r["total"], r["answered"], r["skipped"]) == (5, 4, 1)
    assert r["strengths"] == [{"kind": "words", "focus": "today_words"}, {"kind": "ask", "focus": "today_words"}]
    assert r["weaknesses"] == [{"kind": "dictate", "focus": "today_words"}, {"kind": "words", "focus": "today_words"}]
    assert r["words"] == ["resilient", "zephyr", "abandon"]
    assert (r["level_start"], r["level_end"], r["topic"]) == ("B1", "B2", "today_words")


def test_finished_early_counts_only_what_was_answered():
    s = next_state(next_state(next_state(new_state(PLAN, "B1"), Asked()), Answered("good")), Finished())
    r = build_recap(s)
    assert (r["total"], r["answered"], r["skipped"], r["words"], r["topic"]) == (5, 1, 0, [], None)


def test_memory_candidates_hold_no_words_and_are_capped():
    cands = memory_candidates(build_recap(run(*FULL), Goal(topic="today_words")))
    assert len(cands) == MAX_CANDIDATES == 3
    assert cands[0] == {"kind": "progress", "text": "Tutor lessons: level moved from B1 to B2.", "importance": 3}
    text = " ".join(c["text"] for c in cands)
    for word in ("abandon", "zephyr", "resilient", "give up"):
        assert word not in text
    assert "dictation" in text and {c["kind"] for c in cands} <= {"progress", "weakness"}


def test_summary_text_is_numbers_and_codes_only():
    assert summary_text(build_recap(run(*FULL), Goal(topic="today_words"))) == (
        "Tutor lesson (5 questions, topic today_words): good 2, ok 1, weak 1, skipped 1; level B1 to B2.")
