"""Room learning summary, pure logic (spec 2026-10-10 §6.1): eligibility, the '#<seq> <name>: <text>' chat
context, strict parsing of the model's JSON and the per-person view (R2-13: "could say better" only for its
author). The model only names message seqs; originals and senders come from our own lines, so it cannot invent
a sentence or pin it on the wrong person. Never logs anything (summary text is user content)."""
import json
from dataclasses import dataclass

OVERVIEW_MAX = 200
WORDS_MAX = 8
WORD_EN_MAX = 80
WORD_ZH_MAX = 80
EXAMPLE_MAX = 200
BETTER_MAX = 300
NOTE_MAX = 80
ORIGINAL_MAX = 300
FIXES_PER_MEMBER = 3
FIXES_TOTAL = 15


class SummaryFormatError(Exception):
    """The model output is not a usable summary (no JSON object, or no overview)."""


@dataclass(frozen=True)
class Line:
    seq: int
    sender_id: int | None  # None = AI answer
    name: str
    kind: str  # "text" | "voice" | "ai_answer"
    text: str


def member_lines(lines: list[Line]) -> list[Line]:
    return [line for line in lines if line.sender_id is not None]


def eligible(lines: list[Line], min_messages: int) -> bool:
    return len(member_lines(lines)) >= min_messages


def _flat(text: str) -> str:
    return " ".join((text or "").split())


def build_chat(lines: list[Line], max_chars: int) -> str:
    """One '#<seq> <name>: <text>' line per message (newlines inside a message are flattened); when the total
    is longer than `max_chars` code points the oldest lines are dropped first."""
    rendered = [f"#{line.seq} {_flat(line.name)}: {_flat(line.text)}" for line in lines]
    total = sum(len(r) for r in rendered) + max(len(rendered) - 1, 0)
    start = 0
    while start < len(rendered) and total > max_chars:
        total -= len(rendered[start]) + (1 if start < len(rendered) - 1 else 0)
        start += 1
    return "\n".join(rendered[start:])


def _object(raw: str | None) -> dict:
    text = raw or ""
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        raise SummaryFormatError("no json")
    try:
        value = json.loads(text[start:end + 1])
    except ValueError:
        raise SummaryFormatError("invalid json") from None
    if not isinstance(value, dict):
        raise SummaryFormatError("not an object")
    return value


def _str(value, limit: int) -> str:
    return value.strip()[:limit].strip() if isinstance(value, str) else ""


def _words(value) -> list[dict]:
    words: list[dict] = []
    for item in value if isinstance(value, list) else []:
        if len(words) >= WORDS_MAX:
            break
        if not isinstance(item, dict):
            continue
        en = _str(item.get("en"), WORD_EN_MAX)
        if not en:
            continue
        words.append({"en": en, "zh": _str(item.get("zh"), WORD_ZH_MAX),
                      "example": _str(item.get("example"), EXAMPLE_MAX)})
    return words


def _fixes(value, lines: list[Line]) -> list[dict]:
    by_seq = {line.seq: line for line in member_lines(lines)}
    fixes: list[dict] = []
    seen: set[int] = set()
    per_member: dict[int, int] = {}
    for item in value if isinstance(value, list) else []:
        if len(fixes) >= FIXES_TOTAL:
            break
        if not isinstance(item, dict):
            continue
        seq = item.get("seq")
        if isinstance(seq, bool) or not isinstance(seq, int) or seq in seen or seq not in by_seq:
            continue
        better = _str(item.get("better"), BETTER_MAX)
        if not better:
            continue
        line = by_seq[seq]
        if per_member.get(line.sender_id, 0) >= FIXES_PER_MEMBER:
            continue
        seen.add(seq)
        per_member[line.sender_id] = per_member.get(line.sender_id, 0) + 1
        fixes.append({"seq": seq, "sender_id": line.sender_id, "original": line.text[:ORIGINAL_MAX],
                      "better": better, "note_zh": _str(item.get("note_zh"), NOTE_MAX)})
    return fixes


def parse_summary(raw: str | None, lines: list[Line]) -> dict:
    """Model output -> {"overview_zh", "words", "fixes": [{seq, sender_id, original, better, note_zh}]}.
    Missing/empty overview -> SummaryFormatError; bad words/fixes entries are dropped, not fatal."""
    data = _object(raw)
    overview = _str(data.get("overview_zh"), OVERVIEW_MAX)
    if not overview:
        raise SummaryFormatError("no overview")
    return {"overview_zh": overview, "words": _words(data.get("words")), "fixes": _fixes(data.get("fixes"), lines)}


def view_for(data: dict, user_id: int) -> dict:
    """What one member sees: everyone's overview and words, only their own fixes (R2-13)."""
    return {"overview_zh": data.get("overview_zh", ""), "words": list(data.get("words") or []),
            "my_fixes": [{"seq": f["seq"], "original": f["original"], "better": f["better"],
                          "note_zh": f.get("note_zh", "")}
                         for f in data.get("fixes") or [] if f.get("sender_id") == user_id]}
