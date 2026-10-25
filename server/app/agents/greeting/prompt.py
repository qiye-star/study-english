"""Greeting prompt (plan 2026-10-23 §6.1, R14): pure functions.

The request is the fixed SAFETY_PREAMBLE, then the admin-editable template (published `chat.daily_greeting`, or
DEFAULT_GREETING_TEMPLATE), then the fixed output contract. A template line that is exactly `[[user]]` splits the
rendered template into the system part (before) and the user message (after), the same convention as rooms.assistant.
Whatever an admin writes in the template, the contract suffix and the parser still demand exactly 3 items within the limits.
Between the template and the output contract the code adds the fixed facts rules (slots.rules_block, R18): which
placeholders are offered and that the model writes no numbers. Learner-derived text (persona) is escaped before it enters the template; nothing here logs."""
import logging
from datetime import datetime

from app.agents.greeting import parse, slots as slots_mod
from app.agents.greeting.facts import GreetingFacts, focus_hint
from app.agents.greeting.templates import (
    WEEKDAY_EN, time_of_day)
from app.agents.personas import Persona
from app.agents.prompt import SAFETY_PREAMBLE, escape

logger = logging.getLogger(__name__)

USER_MARKER = "[[user]]"
_SPLIT = f"\n{USER_MARKER}\n"
FACTS_MAX = 600
PERSONA_MAX = 300
REQUEST_MAX = 7000
FALLBACK_USER_LINE = "Write today's three messages now."

DEFAULT_GREETING_TEMPLATE = """<persona>{persona}</persona>
You write today's opening for an English practice chat: exactly THREE separate messages, shown one after another as a small daily ritual. Be warm and personal, like a friend who knows how the learner is doing; never guilt-tripping, never salesy.
Message 1: greet with the time of day and weekday and add one warm, specific line of encouragement; if a streak placeholder is offered in the facts rules, weave it in (never celebrate a streak that is not offered).
Message 2: if a due-words placeholder is offered, say words are waiting for review; if a mistake placeholder is offered, describe yesterday's slip with it and what to do about it. If neither is offered, say something light and welcoming about starting together. Never invent counts, words or mistakes.
Message 3: one concrete plan for today that follows focus_hint in <facts> (what to do, in what order); if a minutes placeholder is offered, use it for how long. End on an encouraging note. Not a list of questions.
Style: each message 1-2 sentences; no markdown, no emoji, no headings, no quotes around messages, do not address the learner by name.
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
             '{"lines": [item1, item2, item3]} with EXACTLY 3 items in this order: 1 opening, 2 review (only '
             f"offered facts), 3 today's plan. Each item is {_ITEM_SHAPE[language]} as the language rule says. "
             f"Limits per item: at most {parse.MAX_SENTENCES} sentences, no asterisks or other markup; a placeholder "
             "counts as about 12 characters:"]
    for key in ("en", "zh"):
        if key in limits:
            low, high, total = limits[key]
            tail = ", no Latin letters" if key == "zh" and language == "zh" else ""
            lines.append(f"{key}: {low}-{high} characters each, {total} in total{tail}.")
    return "\n".join(lines)


def render_facts(facts: GreetingFacts, language: str, local_now: datetime, *, include_stats: bool = True) -> str:
    """Context lines only (R18): time of day, weekday and the focus. No number, word or mistake text ever enters the prompt;
    the facts the learner really has reach the message through the offered placeholders (slots.py). `language` is kept
    for the callers' signature."""
    part = time_of_day(local_now.hour)[3]
    lines = [f"time_of_day: {part}, weekday: {WEEKDAY_EN[local_now.weekday()]}",
             f"focus_hint: {focus_hint(facts) if include_stats else 'free_talk'}"]
    return "\n".join(lines)[:FACTS_MAX]


def persona_text(persona: Persona | None) -> str:
    """Name and intro only (tone reference); the persona prompt itself never goes into the greeting request."""
    if persona is None:
        return ""
    return escape(f"Name: {persona.name}. {persona.intro}".strip())[:PERSONA_MAX]


def _assemble(template: str, persona: str, rule: str, facts_text: str, language: str, slots: dict) -> list[dict]:
    try:
        body = template.format(persona=persona, language_rule=rule, facts=facts_text)
    except (KeyError, IndexError, ValueError):  # validated at publish; a broken one falls back to the default, no body logged
        logger.warning("chat greeting template invalid, using default")
        body = DEFAULT_GREETING_TEMPLATE.format(persona=persona, language_rule=rule, facts=facts_text)
    system, marker, user = body.partition(_SPLIT)
    system = f"{SAFETY_PREAMBLE}\n\n{system.strip()}\n\n{slots_mod.rules_block(slots, language)}\n\n{output_contract(language)}"
    return [{"role": "system", "content": system},
            {"role": "user", "content": user.strip() if marker and user.strip() else FALLBACK_USER_LINE}]


def render_messages(template: str, persona: Persona | None, language: str, facts: GreetingFacts, local_now: datetime,
                    *, include_stats: bool = True) -> list[dict]:
    """The chat messages for one generation: [system, user]."""
    return _assemble(template, persona_text(persona), language_rule(language),
                     render_facts(facts, language, local_now, include_stats=include_stats), language,
                     slots_mod.build(facts, include_stats, language))


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
    return _assemble(template, persona, language_rule(language), facts_text, language,
                     slots_mod.build(SAMPLE_FACTS, True, language))
