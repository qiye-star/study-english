"""导师出题计划(spec 2026-10-12-agents §7.1;计划 A3 S1)。纯函数,确定性。"""
from app.agents.tutor.plan import (KINDS, Goal, PlanItem, PlanSources, build_plan, clamp_length, clean_goal, clean_words,
                                   sources_from)


def test_length_is_clamped_to_3_12_with_default_8():
    assert [clamp_length(v) for v in (2, 3, 12, 13, "5", "x", None)] == [3, 3, 12, 12, 5, 8, 8]


def test_today_words_take_due_words_first_two_per_words_item():
    plan = build_plan(Goal(topic="today_words", length=8),
                      PlanSources(due_words=("apple", "banana", "cherry"), weak_words=("delta",)))
    assert len(plan) == 8
    assert [p.kind for p in plan] == ["words", "repeat", "words", "dictate", "words", "ask", "words", "retell"]
    assert plan[0].words == ("apple", "banana") and plan[1].words == ("cherry",)
    assert plan[2].words == ("delta", "apple")
    assert all(len(p.words) == 2 for p in plan if p.kind == "words")
    assert {p.focus for p in plan} == {"today_words"}


def test_weak_words_topic_puts_weak_words_first():
    plan = build_plan(Goal(topic="weak_words", length=3), PlanSources(due_words=("apple",), weak_words=("zebra", "yacht")))
    assert plan[0].words == ("zebra", "yacht")


def test_without_words_words_items_become_open_questions():
    plan = build_plan(Goal(topic="today_words", length=5), PlanSources())
    assert [p.kind for p in plan] == ["ask", "repeat", "ask", "dictate", "ask"]
    assert all(p.words == () for p in plan)


def test_mix_limits_the_kinds():
    plan = build_plan(Goal(topic="free", length=6, mix=("ask", "retell")), PlanSources(due_words=("apple",)))
    assert [p.kind for p in plan] == ["ask", "retell", "ask", "ask", "retell", "ask"]


def test_scenario_focus_and_memory_focus():
    goal = clean_goal({"topic": "scenario"})
    assert goal.scenario == "restaurant"
    assert {p.focus for p in build_plan(goal, PlanSources())} == {"restaurant"}
    plan = build_plan(Goal(topic="free", length=8),
                      PlanSources(due_words=("apple",), memory_focus=("past tense", "phrasal verbs")))
    assert [p.kind for p in plan].count("ask") == 2
    assert [p.focus for p in plan if p.kind == "ask"] == ["past tense", "phrasal verbs"]
    assert {p.focus for p in plan if p.kind != "ask"} == {"free"}


def test_plans_are_deterministic():
    goal, sources = Goal(topic="free", length=12), PlanSources(due_words=("a", "be"), weak_words=("sea",))
    assert build_plan(goal, sources) == build_plan(goal, sources)


def test_clean_goal_rejects_unknown_values():
    goal = clean_goal({"topic": "hack", "scenario": "travel", "length": 99, "input": "telepathy", "mix": "ask"})
    assert goal == Goal(topic="free", length=12, scenario=None, input="text", mix=KINDS)
    assert Goal.from_dict(goal.to_dict()) == goal


def test_clean_words_keeps_plain_english_headwords_only():
    assert clean_words(["Apple", " apple ", "<b>", "x1", "", 3, "ice cream", "don't"]) == ("apple", "ice cream", "don't")


def test_sources_from_tolerates_missing_or_garbage_params():
    assert sources_from({}) == PlanSources()
    assert sources_from({"due_words": {"words": "apple"}, "memory": {"focus": "x"}}) == PlanSources()
    got = sources_from({"due_words": {"count": 2, "words": ["Apple", "pear"]}, "weak_words": {"words": ["fig"]},
                        "memory": {"focus": ["past <tense>", "", "articles"]}})
    assert got == PlanSources(due_words=("apple", "pear"), weak_words=("fig",), memory_focus=("past tense", "articles"))


def test_plan_item_round_trip_and_bad_kind():
    item = PlanItem("words", "today_words", ("apple", "pear"))
    assert PlanItem.from_dict(item.to_dict()) == item
    assert PlanItem.from_dict({"kind": "sing", "focus": "free"}).kind == "ask"
