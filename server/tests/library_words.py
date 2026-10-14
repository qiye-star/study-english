"""v2 测试助手(plan 2026-10-14-library-alignment-v2):按「每个词多长、词间隔多长」造带词级时间的识别句与块。纯数据,不碰网络。
`tok` / `run` 造 `timeline.Token`(Task 3 才有这个模块,所以在函数里导入)。"""
from typing import TYPE_CHECKING

from app.library.asr_chunks import Chunk
from app.speech.timed import Utterance, Word

if TYPE_CHECKING:
    from app.library.timeline import Token


def words_at(text: str, start_ms: int, word_ms: int = 300, gap_ms: int = 60, gaps: dict[int, int] | None = None) -> list[Word]:
    """One word per whitespace token (punctuation stripped from the word, like the recognizer), `word_ms` long, `gap_ms`
    apart; `gaps` = {token index: gap in ms AFTER that token} overrides single gaps (long pauses)."""
    out: list[Word] = []
    t = start_ms
    for i, tok in enumerate(text.split()):
        out.append(Word(tok.strip(".,!?;:"), t, t + word_ms))
        t += word_ms + (gaps or {}).get(i, gap_ms)
    return out


def utt(text: str, start_ms: int, **kw) -> Utterance:
    """A recognizer sentence whose span is exactly its words' span."""
    ws = words_at(text, start_ms, **kw)
    return Utterance(text, ws[0].start_ms, ws[-1].end_ms, tuple(ws))


def chunk(start_ms: int, end_ms: int, *utts: Utterance) -> Chunk:
    """A transcribed chunk: utterance times are given relative to the chunk start (as the recognizer sends them)."""
    return Chunk(start_ms, end_ms, " ".join(u.text for u in utts), list(utts))


def tok(text: str, start_ms: int, end_ms: int, kind: str = "word", seam: bool = False) -> "Token":
    from app.library.timeline import Token

    return Token(text, start_ms, end_ms, kind, seam)


def run(texts: list[str], start_ms: int = 0, word_ms: int = 300, gap_ms: int = 60,
        gaps: dict[int, int] | None = None) -> list["Token"]:
    """Word tokens laid out like `words_at`, already in absolute ms."""
    from app.library.timeline import Token

    out: list[Token] = []
    t = start_ms
    for i, text in enumerate(texts):
        out.append(Token(text, t, t + word_ms, "word"))
        t += word_ms + (gaps or {}).get(i, gap_ms)
    return out
