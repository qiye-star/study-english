"""Greeting output rules (plan 2026-10-23 §4, §6.2, R17): pure functions.

`lines` is exactly 3 items (the three paragraphs: opening, review + yesterday's slip, today's plan); each item holds
"en", "zh" or both, following the language. Emphasis is a single-asterisk mark (`*12 words*`), kept in `lines`
and stripped from the stored message text. `check_lines` is the one place that knows every rule; the parser (model output)
and the templates (fallback) both go through it. Failures carry a short reason code, never text."""
import json
import re

LINE_COUNT = 3
LANGUAGES = ("zh", "en", "bilingual")
MAX_MARKS_PER_LINE = 3
MAX_MARK_CHARS = 24
MAX_SENTENCES = 2
# (min per item, max per item, max in total), characters after removing marks and collapsing whitespace
LIMITS = {
    "zh": {"zh": (12, 60, 160)},
    "en": {"en": (30, 160, 420)},
    "bilingual": {"en": (30, 160, 420), "zh": (8, 60, 130)},
}
BILINGUAL_ZH_MIN_CHARS = 6

_CJK = re.compile("[一-鿿㐀-䶿豈-﫿\U00020000-\U0002fa1f぀-ヿㇰ-ㇿ]")
_LATIN = re.compile("[A-Za-zＡ-Ｚａ-ｚ]")
_EMOJI = re.compile("[\U0001f000-\U0001faff☀-➿⬀-⯿‍️]")
_FORBIDDEN = re.compile(r"[<>]|https?|www\.", re.IGNORECASE)
_DOUBLE_STAR = re.compile(r"\*\*([^*\n]+)\*\*")
_SENTENCE_END = re.compile(r"[。！？!?…]+|\.+(?!\d)")
_LIST_PREFIX = re.compile(r"^\s*(?:#+\s*|[-•]\s+|\*\s+|\d+[.)]\s+)")
_QUOTES = "\"'“”‘’「」『』"


class GreetingInvalid(ValueError):
    """The model output (or a template) broke a rule; `reason` is a short code, never text."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def plain(text: str) -> str:
    """Display text without marks, whitespace collapsed (what lengths are counted on and what the message stores)."""
    return " ".join(text.replace("*", "").split())


def normalize_marks(text: str) -> str:
    """R17: `**x**` becomes `*x*`; a legal set of marks is kept, any violation removes every `*` of the item."""
    text = _DOUBLE_STAR.sub(r"*\1*", text)
    stars = [i for i, ch in enumerate(text) if ch == "*"]
    if not stars:
        return text
    if len(stars) % 2 or len(stars) // 2 > MAX_MARKS_PER_LINE:
        return text.replace("*", "")
    for opening, closing in zip(stars[::2], stars[1::2]):
        inner = text[opening + 1:closing]
        if (not inner or len(inner) > MAX_MARK_CHARS or inner != inner.strip() or "\n" in inner
                or "<" in inner or ">" in inner):
            return text.replace("*", "")
    return text


def sentence_count(text: str) -> int:
    parts = _SENTENCE_END.split(text)
    ends = len(_SENTENCE_END.findall(text))
    return ends + (1 if parts and parts[-1].strip() else 0)


def _clean(value: str) -> str:
    text = value.strip()
    while _LIST_PREFIX.match(text):
        text = _LIST_PREFIX.sub("", text, count=1)
    text = " ".join(text.split()).strip(_QUOTES + " ")
    return normalize_marks(text)


def _text_error(language: str, key: str, text: str) -> str | None:
    shown = plain(text)
    if _FORBIDDEN.search(shown) or _EMOJI.search(shown):
        return "forbidden"
    if key == "en" and _CJK.search(shown):
        return "cjk_in_en"
    if key == "zh":
        count = len(_CJK.findall(shown))
        if language == "zh" and (not count or _LATIN.search(shown)):
            return "latin_in_zh"
        if language == "bilingual" and count < BILINGUAL_ZH_MIN_CHARS:
            return "zh_too_short"
    return None


def check_lines(lines: object, language: str) -> str | None:
    """None when `lines` satisfies every invariant of §4, else a reason code."""
    if language not in LIMITS:
        return "language"
    if not isinstance(lines, list) or len(lines) != LINE_COUNT:
        return "count"
    keys = set(LIMITS[language])
    totals = dict.fromkeys(keys, 0)
    for item in lines:
        if not isinstance(item, dict) or set(item) != keys:
            return "keys"
        for key in keys:
            text = item[key]
            if not isinstance(text, str) or not text.strip() or normalize_marks(text) != text:
                return "text"
            shown = plain(text)
            low, high, _ = LIMITS[language][key]
            if not low <= len(shown) <= high:
                return "length"
            error = _text_error(language, key, text)
            if error:
                return error
            if sentence_count(shown) > MAX_SENTENCES:
                return "sentences"
            totals[key] += len(shown)
    if any(totals[key] > LIMITS[language][key][2] for key in keys):
        return "total"
    return None


def parse(raw: str, language: str) -> list[dict]:
    """Model output -> the three normalized items, or GreetingInvalid. Nothing is truncated, padded or partially kept."""
    if language not in LIMITS:
        raise GreetingInvalid("language")
    text = raw.strip() if isinstance(raw, str) else ""
    if text.startswith("```"):
        text = re.sub(r"^```[A-Za-z]*\s*|\s*```$", "", text).strip()
    try:
        data = json.loads(text)
    except ValueError:
        raise GreetingInvalid("json") from None
    if not isinstance(data, dict) or set(data) != {"lines"}:
        raise GreetingInvalid("shape")
    items = data["lines"]
    if not isinstance(items, list) or len(items) != LINE_COUNT:
        raise GreetingInvalid("count")
    keys = set(LIMITS[language])
    lines = []
    for item in items:
        if not isinstance(item, dict) or set(item) != keys or any(
                not isinstance(item[k], str) or not item[k].strip() for k in keys):
            raise GreetingInvalid("keys")
        lines.append({key: _clean(item[key]) for key in LIMITS[language]})
    reason = check_lines(lines, language)
    if reason:
        raise GreetingInvalid(reason)
    return lines


def message_text(line: dict) -> str:
    """The stored assistant message: en / zh / en + blank line + zh, marks removed."""
    return "\n\n".join(plain(line[key]) for key in ("en", "zh") if key in line)
