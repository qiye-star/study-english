"""Pure `@name` routing for room agents (spec 2026-10-12-agents §9.2, plan A5 R-RA4/R-RA7). `@ai` / `@助手` keep
their own parser (`rules.mention`) and are matched first by the caller; a persona can never be named like them
(`agent_config.RESERVED_NAMES`). Shared cases: tests/fixtures/room_agent_mentions.json (the web mirrors this)."""
import re

_SEP = r"(?=$|[\s:：,，.!?！？])"
_LEAD = re.compile(r"^[\s:：,，]*")


def _order(names: list[str]) -> list[int]:
    """Indexes of non-empty names, longest first ("Emma Lee" before "Emma"); stable for equal lengths."""
    return sorted((i for i, n in enumerate(names) if n.strip()), key=lambda i: -len(names[i].strip()))


def agent_mention(text: str, names: list[str]) -> tuple[int | None, str]:
    """(index into `names`, question) when the message starts with @<name>, a separator and a question;
    (None, "") otherwise. Case-insensitive."""
    stripped = (text or "").strip()
    if not stripped.startswith("@"):
        return None, ""
    body = stripped[1:]
    for i in _order(names):
        match = re.match(re.escape(names[i].strip()) + _SEP, body, re.IGNORECASE)
        if match:
            question = _LEAD.sub("", body[match.end():], count=1).strip()
            return (i, question) if question else (None, "")
    return None, ""


def find_handoff(text: str, names: list[str], current: int) -> int | None:
    """Index of the first *other* agent written as `@<name>` anywhere in an agent's reply (hand-off, depth 1)."""
    best: tuple[int, int] | None = None
    for i in _order(names):
        if i == current:
            continue
        match = re.search(r"(?<![\w@])@" + re.escape(names[i].strip()) + _SEP, text or "", re.IGNORECASE)
        if match and (best is None or match.start() < best[0]):
            best = (match.start(), i)
    return None if best is None else best[1]
