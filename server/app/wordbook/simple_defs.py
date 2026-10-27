"""简单英英释义(计划 2026-10-27 S 车道)。

- 难词判定(纯函数):`hard_words`。难词 = 释义里不在「易词表」里的英文词。易词表 `easy-words.txt` 由
  `scripts/wordbook_definitions.py easy-words` 离线生成,只来自仓库内的输入。
- `SimpleDefs`:进程内的缓存镜像(数据库表 `wordbook_simple_defs` 的内容)与读路径。读路径同步、零上游、无日志:
  有 ok 行就换成简化文本;skip / failed / 无行 = 原文;无行且判为难 = 放进生成队列(由 `simple_defs_worker` 处理)。
  开关关闭时 `apply` 不会被调用(`DictionaryStore.english_defs` 直接返回 `defs_for`)。

缓存键 = (词, 词性, 原释义文本的 sha256 前 16 位);词典重建改了原文,旧行自然不再命中。"""
import asyncio
import hashlib
import re
import time
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select

from app.models import WordbookSimpleDef
from app.wordbook.definitions import DIR_NAME
from app.wordbook.forms import Forms
from app.wordbook.forms import default_path as forms_path

EASY_FILE = "easy-words.txt"
HARD_MIN = 1  # 难词数 >= 此值的释义才需要改写(可调)
MAX_QUEUE = 2000  # 生成队列上限;满了静默丢弃(下次有人看到再入队)
RETRY_LIMIT = 3  # failed 行的自动重试次数上限(管理端 --purge 可清掉重来)
_LETTERS = re.compile(r"[a-z]+")
_BRACKET_ABBR = re.compile(r"\([^()]*\.[^()]*\)")  # (e.g.) (sb.) 之类缩写括号整段跳过

Key = tuple[str, str, str]  # (word, pos, src_hash)


def easy_path(book_data_dir: Path) -> Path:
    """与释义同目录:`<dictionaries>/wordbook-definitions/easy-words.txt`。"""
    return Path(book_data_dir).parent / DIR_NAME / EASY_FILE


def src_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def load_easy(path: Path) -> frozenset[str]:
    """每行一个小写词;文件缺失 = 空集合(此时所有词都会被判为难,结果是多调用模型,不会出错)。"""
    try:
        text = Path(path).read_text(encoding="utf-8")
    except OSError:
        return frozenset()
    return frozenset(line.strip() for line in text.splitlines() if line.strip())


def hard_words(text: str, headword: str, *, easy: frozenset[str],
               lemma_of: Callable[[str], str | None]) -> list[str]:
    """释义里的难词(去重、保持出现顺序)。

    跳过:词头本身及其词形(`lemma_of(形式) == 词头`)、词头里的各个词、长度 <= 2 的词、缩写括号里的内容;
    大小写不敏感。词形经 `lemma_of` 还原后在易词表里即为易词。"""
    head = (headword or "").strip().lower()
    head_parts = set(head.split())
    cleaned = _BRACKET_ABBR.sub(" ", (text or "").lower())
    out: list[str] = []
    for token in _LETTERS.findall(cleaned):
        if len(token) <= 2 or token == head or token in head_parts or token in out:
            continue
        lemma = lemma_of(token)
        if lemma == head:
            continue
        if token in easy or (lemma is not None and lemma in easy):
            continue
        out.append(token)
    return out


def hard_count(text: str, headword: str, *, easy: frozenset[str], lemma_of: Callable[[str], str | None]) -> int:
    return len(hard_words(text, headword, easy=easy, lemma_of=lemma_of))


def is_hard(texts: Iterable[str], headword: str, *, easy: frozenset[str], lemma_of: Callable[[str], str | None]) -> bool:
    return any(hard_count(t, headword, easy=easy, lemma_of=lemma_of) >= HARD_MIN for t in texts)


@dataclass(frozen=True, slots=True)
class SimpleRow:
    status: str  # ok | skip | failed
    text: str | None
    attempts: int
    retry_after: datetime | None


def _aware(value: datetime | None) -> datetime | None:
    if value is not None and value.tzinfo is None:  # SQLite returns naive datetimes
        return value.replace(tzinfo=timezone.utc)
    return value


def load_static(book_data_dir: Path) -> tuple[frozenset[str], dict[str, str]]:
    """(易词表, 词形 -> 原形)。读两个小文件,在线程里调用。"""
    return load_easy(easy_path(book_data_dir)), dict(Forms(forms_path(book_data_dir)).table())


async def read_rows(sessionmaker) -> dict[Key, SimpleRow]:
    async with sessionmaker() as session:
        result = await session.execute(select(WordbookSimpleDef))
        return {(r.word, r.pos, r.src_hash): SimpleRow(r.status, r.text, r.attempts, _aware(r.retry_after))
                for r in result.scalars()}


class SimpleDefs:
    """进程内缓存。`settings_of()` 每次读取当前设置(热改即时生效)。未 `install` 前读路径返回原文。"""

    def __init__(self, book_data_dir: Path, settings_of: Callable[[], object], *, max_queue: int = MAX_QUEUE):
        self.book_data_dir = Path(book_data_dir)
        self._settings_of = settings_of
        self._max_queue = max_queue
        self._static: tuple[frozenset[str], dict[str, str]] | None = None
        self.loaded = False
        self.loaded_at = 0.0
        self.easy: frozenset[str] = frozenset()
        self.lemmas: dict[str, str] = {}
        self.rows: dict[Key, SimpleRow] = {}
        self.queue: dict[Key, tuple[str, str, str]] = {}  # key -> (word, pos, original text)

    def enabled(self) -> bool:
        return bool(getattr(self._settings_of(), "wordbook_simple_defs_enabled", False))

    def generating(self) -> bool:
        return bool(getattr(self._settings_of(), "wordbook_simple_defs_generate_available", False))

    def lemma_of(self, form: str) -> str | None:
        return self.lemmas.get(form)

    def install(self, *, easy: frozenset[str], lemmas: dict[str, str], rows: dict[Key, SimpleRow]) -> None:
        self.easy, self.lemmas, self.rows = easy, lemmas, rows
        self.loaded = True
        self.loaded_at = time.monotonic()

    async def warm(self, sessionmaker) -> None:
        """启动与每 10 分钟一次:静态文件读一次,缓存行整体重读(多 worker 时由此看到别的进程的改写)。"""
        if self._static is None:
            self._static = await asyncio.to_thread(load_static, self.book_data_dir)
        easy, lemmas = self._static
        rows = await read_rows(sessionmaker)
        self.install(easy=easy, lemmas=lemmas, rows=rows)

    def apply(self, word: str, defs: list[dict], now: datetime | None = None) -> list[dict]:
        """读路径(同步):把 `defs_for` 的结果换成缓存里的简化文本;需要改写的入队。返回新列表,不改入参。"""
        if not self.loaded:
            return defs
        now = now or datetime.now(timezone.utc)
        generate = self.generating()
        out: list[dict] = []
        for d in defs:
            pos, text = d["pos"], d["text"]
            key: Key = (word, pos, src_hash(text))
            row = self.rows.get(key)
            if row is None:
                if generate and is_hard([text], word, easy=self.easy, lemma_of=self.lemma_of):
                    self._enqueue(key, word, pos, text)
                out.append(d)
            elif row.status == "ok" and row.text:
                out.append({"pos": pos, "text": row.text})
            else:
                due = row.retry_after is None or row.retry_after <= now
                if generate and row.status == "failed" and row.attempts < RETRY_LIMIT and due:
                    self._enqueue(key, word, pos, text)
                out.append(d)
        return out

    def _enqueue(self, key: Key, word: str, pos: str, text: str) -> None:
        if key in self.queue or len(self.queue) >= self._max_queue:
            return
        self.queue[key] = (word, pos, text)


def simple_of(app) -> SimpleDefs:
    """唯一入口(同 `dictionary(app)`):数据目录变了就换一个新的缓存对象。"""
    want = Path(app.state.settings.resolved_wordbook_data_dir)
    found = getattr(app.state, "simple_defs", None)
    if found is None or found.book_data_dir != want:
        found = app.state.simple_defs = SimpleDefs(want, lambda: app.state.settings)
    return found
