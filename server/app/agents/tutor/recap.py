"""收尾总结(spec 2026-10-12-agents §7.4;R-T17):纯函数。

得分分布、做得好、要加强(按题型 + 主题)、建议加入生词本的词(答差 / 跳过 / 用过提示的题里的词)。
记忆候选与摘要只含题型、主题代码与数字,不含词、题目或回答。"""
from app.agents.tutor.machine import LEVELS, TutorState
from app.agents.tutor.plan import Goal

MAX_POINTS = 3
MAX_WORDS = 8
MAX_CANDIDATES = 3
MAX_SUMMARY = 400
KIND_EN = {"ask": "open questions", "words": "using new words in sentences", "repeat": "repeating sentences",
           "retell": "retelling short stories", "roleplay": "role-play replies", "dictate": "dictation"}
FOCUS_EN = {"free": "everyday topics", "today_words": "today's vocabulary", "weak_words": "often-missed words",
            "restaurant": "restaurant", "travel": "travel", "interview": "job interview", "shopping": "shopping",
            "small_talk": "small talk"}


def build_recap(state: TutorState, goal: Goal | None = None) -> dict:
    scores = {"good": 0, "ok": 0, "weak": 0, "skip": 0}
    strengths: list[dict] = []
    weaknesses: list[dict] = []
    words: list[str] = []
    for answer in state.answers:
        if answer.verdict in scores:
            scores[answer.verdict] += 1
        if not 0 <= answer.index < len(state.plan):
            continue
        item = state.plan[answer.index]
        point = {"kind": item.kind, "focus": item.focus}
        if answer.verdict == "good" and point not in strengths and len(strengths) < MAX_POINTS:
            strengths.append(point)
        if answer.verdict in ("weak", "skip") and point not in weaknesses and len(weaknesses) < MAX_POINTS:
            weaknesses.append(point)
        if answer.verdict in ("weak", "skip") or answer.hints > 0:
            for word in item.words:
                if word not in words and len(words) < MAX_WORDS:
                    words.append(word)
    return {"total": len(state.plan), "answered": scores["good"] + scores["ok"] + scores["weak"],
            "skipped": scores["skip"], "scores": scores, "strengths": strengths, "weaknesses": weaknesses,
            "words": words, "level_start": LEVELS[state.start_level], "level_end": LEVELS[state.level],
            "topic": goal.topic if goal else None}


def _label(point: dict) -> tuple[str, str]:
    return KIND_EN.get(point["kind"], point["kind"]), FOCUS_EN.get(point["focus"], point["focus"])


def memory_candidates(recap: dict) -> list[dict]:
    out: list[dict] = []
    if recap["level_end"] != recap["level_start"]:
        out.append({"kind": "progress", "importance": 3,
                    "text": f"Tutor lessons: level moved from {recap['level_start']} to {recap['level_end']}."})
    for point in recap["weaknesses"]:
        kind, focus = _label(point)
        out.append({"kind": "weakness", "importance": 3, "text": f"Tutor lessons: needs more practice with {kind} ({focus})."})
    for point in recap["strengths"]:
        kind, focus = _label(point)
        out.append({"kind": "progress", "importance": 2, "text": f"Tutor lessons: did well at {kind} ({focus})."})
    return out[:MAX_CANDIDATES]


def summary_text(recap: dict) -> str:
    s = recap["scores"]
    return (f"Tutor lesson ({recap['total']} questions, topic {recap['topic'] or 'free'}): good {s['good']}, "
            f"ok {s['ok']}, weak {s['weak']}, skipped {s['skip']}; level {recap['level_start']} to "
            f"{recap['level_end']}.")[:MAX_SUMMARY]
