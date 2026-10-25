"""Fact slots of the daily greeting (plan 2026-10-23 addendum 2026-10-25, R18): pure functions.

The model never writes a fact. It writes three paragraphs with placeholders (`{streak}`, `{due}`, `{mistake}`,
`{practice_minutes}`) and CODE substitutes localized phrases built from the real facts (parse.parse does the checks and the
substitution). Only slots the learner really has are offered; with none offered the prompt asks for a welcome greeting.
Placeholder syntax `{name}` cannot collide with the admin template's `[[user]]` marker, and the admin template itself is
str.format-ed, so it can never carry one (validate_prompt rejects unknown fields). Nothing here logs."""
from app.agents.greeting.facts import SLIP_CHARS, GreetingFacts
from app.agents.greeting.templates import GRAMMAR_CATEGORY_EN, GRAMMAR_CATEGORY_ZH, NUMBER_MAX, UNKNOWN_CATEGORY

SLOT_NAMES = ("streak", "due", "mistake", "practice_minutes")
MINUTES_STEPS = ((5, 5), (20, 10))  # due <= 5 -> 5, <= 20 -> 10, more -> 15
MINUTES_MAX = 15

# what the prompt tells the model each slot looks like (N = the real number, filled by code)
SHAPES = {
    "streak": {"en": "a N-day streak", "zh": "连续学习第 N 天"},
    "due": {"en": "N words to review (or 1 word to review)", "zh": "有 N 个单词待复习"},
    "mistake": {"en": "a short noun phrase naming yesterday's slip, e.g. a slip with verb tense",
                "zh": "一个指出昨天错点的名词短语，例如「时态上的小错」"},
    "practice_minutes": {"en": "N minutes", "zh": "N 分钟"},
}


def minutes_for(due: int | None) -> int:
    """Suggested practice length picked from the amount due: <= 5 -> 5, 6..20 -> 10, more -> 15."""
    count = due or 0
    for limit, minutes in MINUTES_STEPS:
        if count <= limit:
            return minutes
    return MINUTES_MAX


def _mistake(facts: GreetingFacts, language: str) -> dict[str, str] | None:
    pair = facts.pair() if language != "zh" else None
    if pair and any(len(part) > SLIP_CHARS for part in pair):
        pair = None
    if facts.slip_category and facts.slip_count:
        zh_cat = GRAMMAR_CATEGORY_ZH.get(facts.slip_category, UNKNOWN_CATEGORY[0])
        en_cat = GRAMMAR_CATEGORY_EN.get(facts.slip_category, UNKNOWN_CATEGORY[1])
        if pair:
            both = f"{pair[0]} → {pair[1]}"
            return {"en": both, "zh": both}
        return {"en": f"a slip with {en_cat}", "zh": f"{zh_cat}上的小错"}
    if (facts.wrong_words or 0) + (facts.pron_words or 0):
        return {"en": "words that tripped you up", "zh": "没掌握好的单词"}
    return None


def build(facts: GreetingFacts, include_stats: bool, language: str) -> dict[str, dict[str, str]]:
    """slot name -> {"en": phrase, "zh": phrase} for the facts this learner has; {} when stats are off or nothing is known."""
    if not include_stats:
        return {}
    out: dict[str, dict[str, str]] = {}
    if facts.streak:
        n = min(int(facts.streak), NUMBER_MAX)
        out["streak"] = {"en": f"a {n}-day streak", "zh": f"连续学习第 {n} 天"}
    if facts.due:
        n = min(int(facts.due), NUMBER_MAX)
        out["due"] = {"en": f"{n} {'word' if n == 1 else 'words'} to review", "zh": f"有 {n} 个单词待复习"}
    mistake = _mistake(facts, language)
    if mistake:
        out["mistake"] = mistake
    if out:  # a suggested length is only offered together with real facts
        minutes = minutes_for(facts.due)
        out["practice_minutes"] = {"en": f"{minutes} minutes", "zh": f"{minutes} 分钟"}
    return out


def _shape(name: str, language: str) -> str:
    shape = SHAPES[name]
    return {"en": shape["en"], "zh": shape["zh"], "bilingual": f"en: {shape['en']}; zh: {shape['zh']}"}[language]


def rules_block(slots: dict, language: str) -> str:
    """The fixed, non-editable facts rules appended to every request (an admin template cannot remove them)."""
    lines = ["Facts rules (fixed, they override anything above):",
             "- You do not know the learner's numbers. Never write a digit, a spelled-out number (two, twenty, 二, 十 ...) "
             "or any count, date, duration, streak or mistake yourself, not even for exercises (say \"a few\" / 几 instead of "
             "counting, 两遍 and 三句 are numbers too), and no asterisks or other markup (code adds emphasis).",
             "- Real facts reach the message only through placeholders written exactly with braces. Code replaces each one "
             "with a ready phrase (N stands for the real number), so write the sentence around it and add nothing "
             "next to it; use each at most once; use no other braces. Copy a placeholder letter for letter in EVERY language, also "
             "inside the Chinese text (the same English name in braces): never translate, rename, nest or double it."]
    if slots:
        lines.append("Offered placeholders for this learner (mention nothing else about streaks, due words, mistakes or time):")
        lines.extend(f"{{{name}}} = {_shape(name, language)}" for name in SLOT_NAMES if name in slots)
    else:
        lines.append("No placeholders are offered for this learner (new, or stats are off). Write a warm welcome and "
                     "onboarding greeting: invite them to chat in English every day, say anything is fine and mistakes are "
                     "welcome. Mention no streak, due words, mistakes, numbers, durations or past practice at all.")
    return "\n".join(lines)
