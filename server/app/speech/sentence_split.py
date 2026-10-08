"""流式切句(计划 R7)。网页端 web/src/features/chat/sentence-stream.ts 实现同一规则,
两边都以 tests/fixtures/sentence_cases.json 为准。宁可少断,不可错断。"""
import re

MAX_SENTENCE_CHARS = 200
ABBREVIATIONS = frozenset({
    "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "e.g", "i.e", "a.m", "p.m", "u.s", "u.k",
    "fig", "approx", "dept", "inc", "ltd", "co", "mt", "jan", "feb", "aug", "sept", "oct", "nov", "dec",
})
TERMINATORS = ".!?"
CJK_TERMINATORS = "。！？"
CLOSERS = "\"'”’)]」』）"
OPENER = re.compile(r"[A-Z0-9\"“'‘(\[]")
_NEXT = re.compile(r"\s+(\S)")
_NEED_MORE = -1


def _is_abbreviation(text: str, dot: int) -> bool:
    start = dot
    while start > 0 and dot - start <= 10 and re.match(r"[A-Za-z.]", text[start - 1]):
        start -= 1
    if dot - start > 10:
        return False
    token = text[start:dot].lower()
    return bool(token) and (token in ABBREVIATIONS or re.fullmatch(r"[a-z]", token) is not None)


def _scan(s: str, final: bool) -> tuple[int | None, int]:
    """返回 (切点, 扫描停下的位置)。切点为 None 表示没有句末;为 _NEED_MORE 表示需要更多文本才能判断。"""
    i, n = 0, len(s)
    while i < n:
        ch = s[i]
        if ch == "\n":
            return i + 1, i
        if ch == "…" or s.startswith("...", i):
            i += 1 if ch == "…" else 3
            while i < n and s[i] == ".":
                i += 1
            continue
        if ch in CJK_TERMINATORS:
            end = i + 1
            while end < n and (s[end] in CJK_TERMINATORS or s[end] in CLOSERS):
                end += 1
            if end == n and not final:
                return _NEED_MORE, i
            return end, i
        if ch in TERMINATORS:
            end = i + 1
            while end < n and s[end] in TERMINATORS:
                end += 1
            while end < n and s[end] in CLOSERS:
                end += 1
            rest = s[end:]
            if not rest.strip():
                if final:
                    return end, i
                return _NEED_MORE, i
            m = _NEXT.match(rest)
            if m and OPENER.match(m.group(1)) and not (ch == "." and _is_abbreviation(s, i)):
                return end, i
            i = end
            continue
        i += 1
    return None, n


def _forced_cut(s: str, limit: int) -> int:
    head = s[:limit]
    for separators in (",;:", " "):
        k = max(head.rfind(c) for c in separators)
        if k > 0:
            return k + 1
    return limit


def _clean(piece: str) -> list[str]:
    text = piece.strip()
    return [text] if any(c.isalpha() for c in text) else []


class SentenceSplitter:
    def __init__(self, max_chars: int = MAX_SENTENCE_CHARS):
        self._buf = ""
        self._max = max_chars

    def _next_cut(self, final: bool) -> int | None:
        cut, at = _scan(self._buf, final)
        if cut is not None and cut != _NEED_MORE and cut <= self._max:
            return cut
        if len(self._buf) > self._max and (cut != _NEED_MORE or at >= self._max):
            return _forced_cut(self._buf, self._max)
        if cut == _NEED_MORE:
            return None
        return cut

    def _drain(self, final: bool) -> list[str]:
        out: list[str] = []
        while self._buf:
            cut = self._next_cut(final)
            if cut is None:
                break
            piece, self._buf = self._buf[:cut], self._buf[cut:]
            out += _clean(piece)
        return out

    def feed(self, text: str) -> list[str]:
        self._buf += text
        return self._drain(final=False)

    def flush(self) -> list[str]:
        out = self._drain(final=True)
        rest, self._buf = self._buf, ""
        return out + _clean(rest)


def split_all(text: str) -> list[str]:
    splitter = SentenceSplitter()
    return splitter.feed(text) + splitter.flush()
