"""英文释义(设计文档 2026-10-12-wordbook-definitions §3、§4):运行时只读 definitions.jsonl,键对键查询。

文件缺失或损坏 = 没有英文释义,其余功能照常(静默降级);不发任何网络请求,不调用任何 LLM,不记录词。
文件由 `server/scripts/wordbook_definitions.py` 离线生成,这里不假设它一定存在、不写它。纯标准库。"""
import asyncio
import json
import logging
import threading
from pathlib import Path

logger = logging.getLogger(__name__)

FILE_NAME = "definitions.jsonl"
DIR_NAME = "wordbook-definitions"
MAX_PER_POS = 2
MAX_TOTAL = 4
POS_VALUES = frozenset({"n", "v", "a", "r", "prep", "pron", "conj", "art", "num", "aux", "int"})

Def = tuple[str, str]  # (pos, text)


def default_path(book_data_dir: Path) -> Path:
    """释义目录与词书目录同级:`<dictionaries>/wordbook-definitions/definitions.jsonl`(容器里 /app/dictionaries/...)。"""
    return Path(book_data_dir).parent / DIR_NAME / FILE_NAME


def select_defs(defs: list[Def], max_per_pos: int = MAX_PER_POS, max_total: int = MAX_TOTAL) -> list[Def]:
    """每个词性最多 `max_per_pos` 条、总共最多 `max_total` 条;名额先给每个词性的第一条(按文件里的词性顺序),
    再给第二条;结果保持文件里的原顺序。"""
    per_pos: dict[str, int] = {}
    pool: list[int] = []
    for i, (pos, _) in enumerate(defs):
        if per_pos.get(pos, 0) < max_per_pos:
            per_pos[pos] = per_pos.get(pos, 0) + 1
            pool.append(i)
    firsts, seconds, seen = [], [], set()
    for i in pool:
        (seconds if defs[i][0] in seen else firsts).append(i)
        seen.add(defs[i][0])
    chosen = (firsts + seconds)[:max_total]
    return [defs[i] for i in sorted(chosen)]


def _parse(line: bytes) -> tuple[str, tuple[Def, ...]] | None:
    try:
        row = json.loads(line)
        word = row["word"]
        defs = tuple((d["pos"], d["text"]) for d in row["defs"])
    except (ValueError, KeyError, TypeError):
        return None
    if not isinstance(word, str) or not word or not defs:
        return None
    if any(pos not in POS_VALUES or not isinstance(text, str) or not text.strip() for pos, text in defs):
        return None
    return word, defs


class Definitions:
    """懒加载的 word -> ((pos, text), ...)。第一次查询(或 `warm`)读一次文件;线程安全;`reload` 丢弃缓存。"""

    def __init__(self, path: Path):
        self.path = Path(path)
        self._lock = threading.Lock()
        self._data: dict[str, tuple[Def, ...]] | None = None

    def _load(self) -> dict[str, tuple[Def, ...]]:
        data: dict[str, tuple[Def, ...]] = {}
        bad = 0
        try:
            with self.path.open("rb") as handle:
                for line in handle:
                    if not line.strip():
                        continue
                    parsed = _parse(line)
                    if parsed is None:
                        bad += 1
                    else:
                        data[parsed[0]] = parsed[1]
        except OSError:
            logger.info("wordbook definitions file unavailable")
            return {}
        if bad:
            logger.warning("wordbook definitions skipped lines=%d", bad)
        return data

    def _ensure(self) -> dict[str, tuple[Def, ...]]:
        data = self._data
        if data is None:
            with self._lock:
                if self._data is None:
                    self._data = self._load()
                data = self._data
        return data

    async def warm(self) -> None:
        """在事件循环之外先读一次(几 MB),之后的 `defs_for` 不再阻塞。"""
        if self._data is None:
            await asyncio.to_thread(self._ensure)

    def reload(self) -> None:
        with self._lock:
            self._data = None

    def __len__(self) -> int:
        return len(self._ensure())

    def defs_for(self, key: str) -> list[dict]:
        """`[{"pos": "n", "text": "..."}]`,每词性最多 2 条、总共最多 4 条;没有 = 空列表。键是规范化小写词。"""
        found = self._ensure().get(key)
        if not found:
            return []
        return [{"pos": pos, "text": text} for pos, text in select_defs(list(found))]
