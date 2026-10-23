"""Greeting prompt (plan 2026-10-23 §6.1, R14): pure functions.

The request is the fixed SAFETY_PREAMBLE, then the admin-editable template (published `chat.daily_greeting`, or
DEFAULT_GREETING_TEMPLATE), then the fixed output contract. A template line that is exactly `[[user]]` splits the
rendered template into the system part (before) and the user message (after), the same convention as rooms.assistant.
Whatever an admin writes in the template, the contract suffix and the parser still demand exactly 3 items within the limits.
Learner-derived text (persona, words) is escaped before it enters the template; nothing here logs."""
import logging
from datetime import datetime

from app.agents.greeting import parse
from app.agents.greeting.facts import GreetingFacts, focus_hint
from app.agents.greeting.templates import (
    GRAMMAR_CATEGORY_EN, GRAMMAR_CATEGORY_ZH, PRACTICE_MINUTES, UNKNOWN_CATEGORY, WEEKDAY_EN, time_of_day)
from app.agents.personas import Persona
from app.agents.prompt import SAFETY_PREAMBLE, escape

logger = logging.getLogger(__name__)

USER_MARKER = "[[user]]"
_SPLIT = f"\n{USER_MARKER}\n"
FACTS_MAX = 600
PERSONA_MAX = 300
WORD_CHARS = 32
REQUEST_MAX = 7000
FALLBACK_USER_LINE = "Write today's three messages now."

DEFAULT_GREETING_TEMPLATE = """<persona>{persona}</persona>
You write today's opening for an English practice chat: exactly THREE separate messages, shown one after another as a small daily ritual. Be warm and personal, like a friend who knows how the learner is doing; never guilt-tripping, never salesy.
Message 1: greet with the local time of day and weekday, mention the streak from <facts> (streak 0 or missing: celebrate a fresh start instead), and add one warm, specific line of encouragement.
Message 2: say how many words are due today and describe yesterday's slip clearly (what was wrong and what is right). Nothing due: say so lightly. No slip: say yesterday went smoothly. Never invent numbers, words or mistakes that are not in <facts>.
Message 3: one concrete plan for today that follows focus_hint and practice_minutes in <facts> (what to do, for how long, in what order), ending on an encouraging note. Not a list of questions.
Style: each message 1-2 sentences; mark 1-3 key phrases per message (numbers, the slip) with single *asterisks*; no other markdown, no emoji, no headings, no quotes around messages, do not address the learner by name.
{language_rule}
[[user]]
<facts>
{facts}
</facts>
Write today's three messages now."""

LANGUAGE_RULES = {
    "en": 'Language: English only. Each item has only the key "en".',
    "zh": ("语言：全部用简体中文写，不要出现任何英文单词、字母或拼音；错点用中文描述（例如「在现在完成时里把过去分词错用成了过去式」）。"
           'Each item has only the key "zh".'),
    "bilingual": ('Language: each item has "en" (the full English message) and "zh" (a shorter, natural one-sentence '
                  "Chinese version; it may quote the English slip, e.g. have went → have gone)."),
}

_ITEM_SHAPE = {"en": '{"en": "..."}', "zh": '{"zh": "..."}', "bilingual": '{"en": "...", "zh": "..."}'}


def language_rule(language: str) -> str:
    return LANGUAGE_RULES[language]


def output_contract(language: str) -> str:
    """The fixed, non-editable suffix: only the limit lines of the current language are rendered."""
    limits = parse.LIMITS[language]
    lines = ["Output contract (fixed): return JSON only, no prose, no code fences:",
             '{"lines": [item1, item2, item3]} with EXACTLY 3 items in this order: 1 opening, 2 review and '
             f"yesterday's slip, 3 today's plan. Each item is {_ITEM_SHAPE[language]} as the language rule says. "
             f"Limits per item, asterisks not counted, at most {parse.MAX_SENTENCES} sentences and "
             f"{parse.MAX_MARKS_PER_LINE} *marks* per item (single asterisks only, 1-{parse.MAX_MARK_CHARS} "
             "characters inside, no other markup):"]
    for key in ("en", "zh"):
        if key in limits:
            low, high, total = limits[key]
            tail = ", no Latin letters" if key == "zh" and language == "zh" else ""
            lines.append(f"{key}: {low}-{high} characters each, {total} in total{tail}.")
    return "\n".join(lines)


def _word(text: str) -> str:
    return escape(text)[:WORD_CHARS]


def render_facts(facts: GreetingFacts, language: str, local_now: datetime, *, include_stats: bool = True) -> str:
    """One item per line, <= FACTS_MAX; a missing item is omitted (never 0 or unknown). Chinese mode carries no learner words."""
    part = time_of_day(local_now.hour)[3]
    lines = [f"local_date: {local_now.date().isoformat()} ({WEEKDAY_EN[local_now.weekday()]}), time_of_day: {part}"]
    if include_stats:
        if facts.streak:
            lines.append(f"streak_days: {facts.streak}")
        if facts.due:
            lines.append(f"words_due_today: {facts.due}")
        zh_cat = GRAMMAR_CATEGORY_ZH.get(facts.slip_category or "", UNKNOWN_CATEGORY[0])
        en_cat = GRAMMAR_CATEGORY_EN.get(facts.slip_category or "", UNKNOWN_CATEGORY[1])
        if facts.slip_category and facts.slip_count:
            if language == "zh":
                lines.append(f"yesterday_slip_zh: 在{zh_cat}上出了 {facts.slip_count} 处错")
            elif facts.pair():
                wrong, right = facts.pair()
                lines.append(f'yesterday_slip: "{_word(wrong)}" -> "{_word(right)}" (category: {en_cat})')
            else:
                lines.append(f"yesterday_slip: {facts.slip_count} slips (category: {en_cat})")
        other = []
        if facts.wrong_words:
            other.append(f"{facts.wrong_words} wrong answers in word review")
        if facts.pron_words:
            other.append(f"{facts.pron_words} words with weak pronunciation")
        if other:
            lines.append("yesterday_other: " + "; ".join(other))
        if language != "zh" and facts.words:
            lines.append("weak_words: " + ", ".join(_word(w) for w in facts.words))
    lines.append(f"focus_hint: {focus_hint(facts) if include_stats else 'free_talk'}")
    lines.append(f"practice_minutes: {PRACTICE_MINUTES}")
    text = "\n".join(lines)
    if len(text) > FACTS_MAX:
        text = text[:FACTS_MAX].rsplit("\n", 1)[0]
    return text


def persona_text(persona: Persona | None) -> str:
    """Name and intro only (tone reference); the persona prompt itself never goes into the greeting request."""
    if persona is None:
        return ""
    return escape(f"Name: {persona.name}. {persona.intro}".strip())[:PERSONA_MAX]


def _assemble(template: str, persona: str, rule: str, facts_text: str, language: str) -> list[dict]:
    try:
        body = template.format(persona=persona, language_rule=rule, facts=facts_text)
    except (KeyError, IndexError, ValueError):  # validated at publish; a broken one falls back to the default, no body logged
        logger.warning("chat greeting template invalid, using default")
        body = DEFAULT_GREETING_TEMPLATE.format(persona=persona, language_rule=rule, facts=facts_text)
    system, marker, user = body.partition(_SPLIT)
    system = f"{SAFETY_PREAMBLE}\n\n{system.strip()}\n\n{output_contract(language)}"
    return [{"role": "system", "content": system},
            {"role": "user", "content": user.strip() if marker and user.strip() else FALLBACK_USER_LINE}]


def render_messages(template: str, persona: Persona | None, language: str, facts: GreetingFacts, local_now: datetime,
                    *, include_stats: bool = True) -> list[dict]:
    """The chat messages for one generation: [system, user]."""
    return _assemble(template, persona_text(persona), language_rule(language),
                     render_facts(facts, language, local_now, include_stats=include_stats), language)


SAMPLE_FACTS = GreetingFacts(streak=5, due=12, slip_category="tense", slip_count=2, slip_wrong="have went",
                             slip_right="have gone", wrong_words=3, pron_words=2)
SAMPLE_PERSONA = "Name: 学习伙伴. 轻松的英语日常对话,每次三句以内"
SAMPLE_NOW = datetime(2026, 10, 23, 8, 42)


def render_test(template: str, sample: dict[str, str]) -> list[dict]:
    """Admin test run: `sample` may carry persona / language / facts text; missing ones use built-in examples."""
    language = sample.get("language") if sample.get("language") in parse.LIMITS else "bilingual"
    facts_text = (sample.get("facts") or "").strip()
    facts_text = escape(facts_text)[:FACTS_MAX] if facts_text else render_facts(SAMPLE_FACTS, language, SAMPLE_NOW)
    persona = escape((sample.get("persona") or "").strip())[:PERSONA_MAX] or SAMPLE_PERSONA
    return _assemble(template, persona, language_rule(language), facts_text, language)
