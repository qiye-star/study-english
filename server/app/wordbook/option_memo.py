"""答题后「每个选项对应哪个词」的进程内备忘(计划 2026-10-13-review-after-answer R-A1)。

`/answers` 是无状态判分(P-W2):请求里没有选项,干扰项又是出题时按 rng 抽的,答题时无法重算。所以出题时把
`(用户, 书, 词, 题型) -> ((选项原文, 词键), ...)`(与题面 options 同序)记在 `DictionaryStore` 上,答题后据此回填 `option_info`。
纯标准库;容量有界(LRU);进程重启、多进程或被淘汰时取不到,调用方就省略 `option_info`(降级,不报错)。
不打印、不持久化任何词。"""
from collections import OrderedDict

Pairs = tuple[tuple[str, str], ...]
Slot = tuple[int, str, str, str]


class OptionMemo:
    def __init__(self, size: int = 2048):
        self._size = size
        self._data: OrderedDict[Slot, Pairs] = OrderedDict()

    def remember(self, user_id: int, book_id: str, key: str, qtype: str, pairs: Pairs) -> None:
        slot = (user_id, book_id, key, qtype)
        self._data[slot] = pairs
        self._data.move_to_end(slot)
        while len(self._data) > self._size:
            self._data.popitem(last=False)

    def recall(self, user_id: int, book_id: str, key: str, qtype: str) -> Pairs | None:
        slot = (user_id, book_id, key, qtype)
        found = self._data.get(slot)
        if found is not None:
            self._data.move_to_end(slot)
        return found

    def clear(self) -> None:
        self._data.clear()

    def __len__(self) -> int:
        return len(self._data)
