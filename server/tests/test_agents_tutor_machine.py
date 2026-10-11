"""导师状态机(spec 2026-10-12-agents §7.2;计划 A3 S2)。单元测试 + 固定种子的性质测试(R-T9)。"""
import random

import pytest

from app.agents.tutor.machine import (HINTS_MAX, LEVELS, VERDICTS, Answered, Asked, Finished, HintUsed, InvalidTransition,
                                      Skipped, TutorState, current_item, difficulty, from_dict, initial_state, is_last,
                                      level_name, new_state, next_state, step_number, to_dict)
from app.agents.tutor.plan import KINDS, PlanItem


def plan_of(*kinds: str) -> tuple[PlanItem, ...]:
    return tuple(PlanItem(k, "free", ("apple",) if k == "words" else ()) for k in kinds)


def opened(*kinds: str, level: str = "B1") -> TutorState:
    return next_state(new_state(plan_of(*kinds), level), Asked())


def test_new_state_starts_in_opening_at_question_one():
    s = new_state(plan_of("ask", "words", "retell"), "B2")
    assert (s.phase, s.index, step_number(s), level_name(s), difficulty(s)) == ("opening", 0, 1, "B2", 2)
    assert s.start_level == 2 and s.answers == ()
    assert initial_state is new_state  # INDEX X6 name


def test_unknown_level_defaults_to_b1_and_empty_plan_is_rejected():
    assert level_name(new_state(plan_of("ask"), "Z9")) == "B1"
    assert level_name(new_state(plan_of("ask"), None)) == "B1"
    with pytest.raises(ValueError):
        new_state((), "B1")


def test_answers_advance_one_question_each():
    s = opened("ask", "ask", "ask")
    assert s.phase == "await_answer"
    s = next_state(s, Answered("ok"))
    assert (s.index, s.phase, [a.verdict for a in s.answers]) == (1, "await_answer", ["ok"])


def test_two_good_in_a_row_raise_two_weak_lower():
    s = opened(*["ask"] * 6)
    s = next_state(s, Answered("good"))
    assert level_name(s) == "B1"
    s = next_state(s, Answered("good"))
    assert level_name(s) == "B2"
    s = next_state(next_state(s, Answered("weak")), Answered("weak"))
    assert level_name(s) == "B1"


def test_level_stays_within_a2_c1():
    s = opened(*["ask"] * 8, level="C1")
    for _ in range(4):
        s = next_state(s, Answered("good"))
    assert level_name(s) == "C1"
    s = opened(*["ask"] * 8, level="A2")
    for _ in range(4):
        s = next_state(s, Answered("weak"))
    assert level_name(s) == "A2"


def test_ok_and_skip_break_streaks():
    s = opened(*["ask"] * 6)
    s = next_state(next_state(next_state(s, Answered("good")), Answered("ok")), Answered("good"))
    assert level_name(s) == "B1"
    s = opened(*["ask"] * 6)
    s = next_state(next_state(next_state(next_state(s, Answered("weak")), Skipped()), Asked()), Answered("weak"))
    assert level_name(s) == "B1"


def test_hint_does_not_advance_and_is_capped():
    s = opened("ask", "ask")
    h = next_state(s, HintUsed())
    assert (h.index, h.phase, h.answers, h.hints) == (0, "await_answer", (), 1)
    h = next_state(h, HintUsed())
    with pytest.raises(InvalidTransition):
        next_state(h, HintUsed())
    assert HINTS_MAX == 2
    after = next_state(h, Answered("good"))
    assert after.answers[0].hints == 2 and after.hints == 0
    with pytest.raises(InvalidTransition):
        next_state(new_state(plan_of("ask"), "B1"), HintUsed())  # 还没出题


def test_skip_records_unanswered_and_waits_for_the_agent():
    s = next_state(opened("ask", "ask", "ask"), Skipped())
    assert (s.index, s.phase, s.answers[0].verdict) == (1, "ask", "skip")
    with pytest.raises(InvalidTransition):
        next_state(s, Answered("good"))
    assert next_state(s, Asked()).phase == "await_answer"


def test_last_answer_or_skip_goes_to_wrap_up_then_done():
    s = opened("ask")
    assert is_last(s)
    w = next_state(s, Answered("good"))
    assert w.phase == "wrap_up" and len(w.answers) == 1
    d = next_state(w, Finished())
    assert d.phase == "done" and next_state(d, Finished()) == d
    with pytest.raises(InvalidTransition):
        next_state(d, Asked())
    assert next_state(opened("ask"), Skipped()).phase == "wrap_up"


def test_weak_repeat_or_dictate_gets_one_retry():
    s = opened("repeat", "ask")
    r = next_state(s, Answered("weak"))
    assert (r.index, r.phase, r.answers, r.repeats) == (0, "await_answer", (), 1)
    n = next_state(r, Answered("weak"))
    assert (n.index, [a.verdict for a in n.answers]) == (1, ["weak"])
    assert next_state(opened("ask", "ask"), Answered("weak")).index == 1


def test_unknown_verdict_counts_as_ok():
    assert next_state(opened("ask", "ask"), Answered("excellent")).answers[0].verdict == "ok"


def test_dictation_sentence_kept_only_for_dictate_questions():
    s = next_state(new_state(plan_of("dictate", "ask"), "B1"), Asked(hint="h", say="The cat sat."))
    assert (s.say, s.hint_text) == ("The cat sat.", "h")
    s2 = next_state(s, Answered("good", hint="h2", say="ignored"))
    assert s2.say == "" and s2.hint_text == "h2"
    s3 = next_state(new_state(plan_of("ask", "dictate"), "B1"), Asked(say="nope"))
    assert s3.say == ""
    s4 = next_state(s3, Answered("ok", say="Listen to me."))
    assert s4.say == "Listen to me." and current_item(s4).kind == "dictate"


def test_finish_early_from_any_open_phase():
    for s in (new_state(plan_of("ask", "ask"), "B1"), opened("ask", "ask"), next_state(opened("ask", "ask"), Skipped())):
        assert next_state(s, Finished()).phase == "done"


def test_dict_round_trip_and_tolerant_load():
    s = next_state(next_state(opened("words", "dictate", "ask"), HintUsed()), Answered("good", say="x"))
    assert from_dict(to_dict(s)) == s
    loaded = from_dict({**to_dict(s), "phase": "nonsense", "index": 99, "level": -3})
    assert (loaded.phase, loaded.index, loaded.level) == ("opening", 2, 0)
    with pytest.raises(ValueError):
        from_dict({"plan": []})


def _reference_level(start: int, verdicts: list[str]) -> int:
    level, good, weak = start, 0, 0
    for v in verdicts:
        if v == "good":
            good, weak = good + 1, 0
        elif v == "weak":
            good, weak = 0, weak + 1
        else:
            good, weak = 0, 0
        if good == 2:
            level, good = min(len(LEVELS) - 1, level + 1), 0
        if weak == 2:
            level, weak = max(0, level - 1), 0
    return level


def _event(rng: random.Random):
    return rng.choices([Asked(), Answered(rng.choice(VERDICTS + ("bogus",))), HintUsed(), Skipped(), Finished()],
                       weights=[3, 6, 2, 2, 0.3])[0]


def test_property_random_event_sequences_keep_invariants():
    rng = random.Random(20261012)
    for _ in range(2000):
        n = rng.randint(3, 12)
        state = new_state(tuple(PlanItem(rng.choice(KINDS), "free", ()) for _ in range(n)), rng.choice(LEVELS))
        for _ in range(rng.randint(1, 60)):
            event = _event(rng)
            before = to_dict(state)
            try:
                nxt = next_state(state, event)
            except InvalidTransition:
                assert to_dict(state) == before
                continue
            assert to_dict(state) == before  # 输入不可变
            assert 0 <= nxt.level < len(LEVELS) and 0 <= nxt.index < n
            assert [a.index for a in nxt.answers] == list(range(len(nxt.answers)))
            if nxt.phase in ("opening", "ask", "await_answer"):
                assert len(nxt.answers) == nxt.index
            if nxt.phase == "wrap_up":
                assert len(nxt.answers) == n
            if isinstance(event, HintUsed):
                assert (nxt.index, nxt.answers, nxt.hints) == (state.index, state.answers, state.hints + 1)
            assert nxt.level == _reference_level(nxt.start_level, [a.verdict for a in nxt.answers])
            assert from_dict(to_dict(nxt)) == nxt
            state = nxt
