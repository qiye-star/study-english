"""SRT / WebVTT 解析与清洗(spec §6.3「解析」;纯函数)。输出按开始时间排序的 `Cue(start_ms, end_ms, text)`,
文本已清洗、单行(多行用空格连接);坏文件一律 `LibraryError("bad_subtitle")`。字幕文本永远不进日志。"""
import html
import re
from dataclasses import dataclass

from app.library.errors import LibraryError
from app.library.limits import SUBTITLE_MAX_BYTES, SUBTITLE_MAX_CUES

_TIME = r"(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})"
_ARROW = re.compile(rf"^\s*{_TIME}\s*-->\s*{_TIME}")
_TAG = re.compile(r"<[^>\n]*>")
_ASS = re.compile(r"\{\\[^}]*\}")
_BRACKETS = re.compile(r"\[[^\]\n]*\]")
_PARENS = re.compile(r"\(([^()\n]{1,40})\)")
_NOTES = re.compile(r"[♪♫]")
_LEAD = re.compile(r"^\s*(?:-|>>)\s*")
_SKIP_BLOCK = ("NOTE", "STYLE", "REGION", "WEBVTT")
_CONTROL_OK = {"\n", "\r", "\t"}


@dataclass(frozen=True)
class Cue:
    start_ms: int
    end_ms: int
    text: str


def decode(data: bytes) -> str:
    """UTF-8 (BOM or not) → UTF-16 with a BOM → latin-1 (never fails); mostly non-printable = binary."""
    if len(data) > SUBTITLE_MAX_BYTES:
        raise LibraryError("bad_subtitle")
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        try:
            text = data.decode("utf-16")
        except UnicodeDecodeError:
            raise LibraryError("bad_subtitle") from None
    else:
        try:
            text = data.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = data.decode("latin-1")
    if text and sum(1 for c in text if not c.isprintable() and c not in _CONTROL_OK) > len(text) * 0.1:
        raise LibraryError("bad_subtitle")
    return text


def _ms(h: str | None, m: str, s: str, frac: str) -> int:
    return ((int(h or 0) * 60 + int(m)) * 60 + int(s)) * 1000 + int(frac.ljust(3, "0")[:3])


def _cjk_share(line: str) -> float:
    letters = [c for c in line if c.isalpha()]
    if not letters:
        return 0.0
    cjk = sum(1 for c in letters if 0x3040 <= ord(c) <= 0x30FF or 0x3400 <= ord(c) <= 0x9FFF
              or 0xAC00 <= ord(c) <= 0xD7AF or 0xF900 <= ord(c) <= 0xFAFF)
    return cjk / len(letters)


def clean_line(line: str) -> str:
    """Tags, entities, sound labels, music notes, dialogue dashes / `>>`; bilingual (mostly CJK) lines are dropped."""
    line = _ASS.sub("", _TAG.sub("", line))
    line = html.unescape(line).replace(" ", " ")
    line = _BRACKETS.sub(" ", line)
    line = _PARENS.sub(lambda m: " " if not re.search(r"[.,!?;:]", m.group(1)) else m.group(0), line)
    line = _NOTES.sub(" ", line)
    line = _LEAD.sub("", line)
    line = " ".join(line.split())
    if not line or _cjk_share(line) > 0.5 or not any(c.isalnum() for c in line):
        return ""
    return line


def _blocks(text: str) -> list[list[str]]:
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    blocks, current = [], []
    for line in lines:
        if line.strip():
            current.append(line)
        elif current:
            blocks.append(current)
            current = []
    if current:
        blocks.append(current)
    return blocks


def parse(data: bytes) -> list[Cue]:
    """Raw SRT or WebVTT bytes → cleaned cues sorted by start (overlaps kept; the segmenter resolves them).
    Rolling auto-captions (a cue that starts with the previous cue's last line) keep only the new tail."""
    text = decode(data)
    raw: list[tuple[int, int, list[str]]] = []
    for block in _blocks(text):
        if block[0].strip().split(" ")[0].upper().rstrip(":") in _SKIP_BLOCK and not _ARROW.match(block[0]):
            continue
        at = next((i for i, line in enumerate(block) if _ARROW.match(line)), None)
        if at is None:
            continue
        m = _ARROW.match(block[at])
        start, end = _ms(*m.groups()[:4]), _ms(*m.groups()[4:])
        if end <= start:
            continue
        raw.append((start, end, block[at + 1:]))
        if len(raw) > SUBTITLE_MAX_CUES:
            raise LibraryError("bad_subtitle")
    if not raw:
        raise LibraryError("bad_subtitle")
    raw.sort(key=lambda r: (r[0], r[1]))
    cues: list[Cue] = []
    previous_last = ""
    for start, end, lines in raw:
        cleaned = [c for c in (clean_line(line) for line in lines) if c]
        if cleaned and previous_last and cleaned[0] == previous_last:
            cleaned = cleaned[1:]
        if lines:
            last = clean_line(lines[-1])
            previous_last = last or previous_last
        if cleaned:
            cues.append(Cue(start, end, " ".join(cleaned)))
    if not cues:  # only music / sound labels / other-language lines
        raise LibraryError("bad_subtitle")
    return cues
