"""词典文件的内存索引与按需读行(spec §4)。按书懒加载;建索引与读行都在线程里做,不阻塞事件循环。

索引只保留「键 → 行字节偏移」与两个 array('B') 位图,不常驻解析后的行;词卡按需 seek + readline 解析后进 LRU。
"""
import array
import asyncio
import json
import time
from collections import OrderedDict
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

from app.wordbook.books import book_by_id
from app.wordbook.definitions import Definitions, default_path
from app.wordbook.entry import WordCard, clean_sentence, headword_key, merge_rows, pos_mask_of, pos_parts
from app.wordbook.option_memo import OptionMemo
from app.wordbook.textnorm import find_form


class DataUnavailable(Exception):
    def __init__(self, book_id: str):
        super().__init__(book_id)
        self.book_id = book_id


@dataclass
class BookIndex:
    book_id: str
    size: int
    mtime_ns: int
    keys: tuple[str, ...]
    ordinal: dict[str, int]
    offsets: list[tuple[int, ...]]
    pos_mask: array.array
    has_example: array.array
    dropped: int
    built_ms: int

    def __contains__(self, key: object) -> bool:
        return key in self.ordinal

    def __len__(self) -> int:
        return len(self.keys)


def _loads(line: bytes) -> dict:
    row = json.loads(line)
    if not isinstance(row, dict):
        raise ValueError("dictionary line is not an object")
    return row


def build_index(book_id: str, path: Path) -> BookIndex:
    started = time.perf_counter()
    stat = path.stat()
    ordinal: dict[str, int] = {}
    keys: list[str] = []
    offsets: list[tuple[int, ...]] = []
    mask, flags = array.array("B"), array.array("B")
    dropped = offset = 0
    with path.open("rb") as handle:
        for line in handle:
            if line.strip():
                row = _loads(line)
                key = headword_key(row.get("word", ""))
                if key is None:
                    dropped += 1
                else:
                    bits = 0
                    for t in row.get("translations") or []:
                        bits |= pos_mask_of(pos_parts(t.get("type")))
                    i = ordinal.get(key)
                    known = i is not None and flags[i]
                    example = known or any(
                        (en := clean_sentence(s.get("sentence") or "")) and find_form(en, key)
                        for s in row.get("sentences") or [])
                    if i is None:
                        ordinal[key] = len(keys)
                        keys.append(key)
                        offsets.append((offset,))
                        mask.append(bits)
                        flags.append(int(bool(example)))
                    else:
                        offsets[i] += (offset,)
                        mask[i] |= bits
                        flags[i] |= int(bool(example))
            offset += len(line)
    return BookIndex(book_id, stat.st_size, stat.st_mtime_ns, tuple(keys), ordinal, offsets, mask, flags, dropped,
                     round((time.perf_counter() - started) * 1000))


def _read_rows(path: Path, groups: list[tuple[int, ...]]) -> list[list[dict]]:
    out: list[list[dict]] = []
    with path.open("rb") as handle:
        for offsets in groups:
            rows = []
            for offset in offsets:
                handle.seek(offset)
                rows.append(_loads(handle.readline()))
            out.append(rows)
    return out


class DictionaryStore:
    def __init__(self, data_dir: Path, *, cache_size: int = 1024):
        self.data_dir = Path(data_dir)
        self.definitions = Definitions(default_path(self.data_dir))  # English definitions (spec 2026-10-12 §3)
        self.option_memo = OptionMemo()  # 出题时记下「选项 → 词」,答题后回填 option_info(计划 2026-10-13-review-after-answer R-A1)
        self._cache_size = cache_size
        self._indexes: dict[str, BookIndex] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._cards: OrderedDict[tuple[str, str], WordCard] = OrderedDict()
        self.hidden: frozenset[str] = frozenset()
        self.hidden_loaded = False
        self._generation = 0  # reload() bumps it: a build or read in flight across a reload is not kept (review m6)

    def path_for(self, book_id: str) -> Path:
        spec = book_by_id(book_id)
        if spec is None:
            raise DataUnavailable(book_id)
        return self.data_dir / spec.file

    async def index(self, book_id: str) -> BookIndex:
        found = self._indexes.get(book_id)
        if found is not None and self.stale(book_id):  # the file changed without an admin reload (one stat call)
            self.reload(book_id)
            found = None
        if found is not None:
            return found
        async with self._locks.setdefault(book_id, asyncio.Lock()):
            found = self._indexes.get(book_id)
            if found is None:
                path = self.path_for(book_id)
                if not path.is_file():
                    raise DataUnavailable(book_id)
                generation = self._generation
                try:
                    found = await asyncio.to_thread(build_index, book_id, path)
                except (OSError, ValueError):
                    raise DataUnavailable(book_id) from None
                if generation == self._generation:
                    self._indexes[book_id] = found
        return found

    def _remember(self, slot: tuple[str, str], card: WordCard) -> None:
        self._cards[slot] = card
        self._cards.move_to_end(slot)
        while len(self._cards) > self._cache_size:
            self._cards.popitem(last=False)

    async def cards(self, book_id: str, keys: list[str]) -> dict[str, WordCard]:
        """按 keys 的顺序返回词卡;不在书里的键省略。键按 normalize 后的形式查(调用方传规范化键)。"""
        index = await self.index(book_id)
        found: dict[str, WordCard] = {}
        missing: list[str] = []
        for key in keys:
            slot = (book_id, key)
            if slot in self._cards:
                self._cards.move_to_end(slot)
                found[key] = self._cards[slot]
            elif key in index and key not in missing:
                missing.append(key)
        if missing:
            generation = self._generation
            try:
                rows = await asyncio.to_thread(_read_rows, self.path_for(book_id),
                                               [index.offsets[index.ordinal[k]] for k in missing])
            except (OSError, ValueError):
                raise DataUnavailable(book_id) from None
            hidden = self.hidden
            for key, group in zip(missing, rows):
                card = merge_rows(group, hidden=hidden)
                if card is not None and card.key != key:  # stale offsets landed on another headword
                    raise DataUnavailable(book_id)
                if card is not None:
                    found[key] = card
                    if generation == self._generation:
                        self._remember((book_id, key), card)
        return {k: found[k] for k in keys if k in found}

    async def card(self, book_id: str, key: str) -> WordCard | None:
        return (await self.cards(book_id, [key])).get(key)

    def set_hidden(self, ids: Iterable[str]) -> None:
        self.hidden = frozenset(ids)
        self.hidden_loaded = True
        self._cards.clear()

    def reload(self, book_id: str | None = None) -> None:
        self._generation += 1
        self.definitions.reload()
        if book_id is None:
            self._indexes.clear()
            self._cards.clear()
            return
        self._indexes.pop(book_id, None)
        for slot in [s for s in self._cards if s[0] == book_id]:
            del self._cards[slot]

    def loaded(self) -> dict[str, BookIndex]:
        return dict(self._indexes)

    def stale(self, book_id: str) -> bool:
        index = self._indexes.get(book_id)
        if index is None:
            return False
        try:
            stat = self.path_for(book_id).stat()
        except OSError:
            return True
        return (stat.st_size, stat.st_mtime_ns) != (index.size, index.mtime_ns)


def dictionary(app) -> DictionaryStore:
    """唯一入口(计划 P-W1):数据目录随设置变化时换一个新 store。"""
    want = Path(app.state.settings.resolved_wordbook_data_dir)
    store = getattr(app.state, "wordbook_dict", None)
    if store is None or store.data_dir != want:
        store = app.state.wordbook_dict = DictionaryStore(want)
    return store
