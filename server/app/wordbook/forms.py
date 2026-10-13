"""词形 -> 原形小表(spec 2026-10-13-defs-default-lookup-ios §3.2):`wordbook-definitions/forms.txt`,每行 `形式<TAB>原形`,
按形式排序,由 `server/scripts/wordbook_definitions.py forms` 离线生成(只含七本书里出现的原形的变形)。

运行时只读;文件缺失或损坏 = 没有词形还原,查词照常(静默降级)。不发网络请求,不调用 LLM,不记录词(日志只有行数)。
文件被换掉(大小或修改时间变了)时下一次查询重新读取。纯标准库。"""
import asyncio
import logging
import threading
from pathlib import Path

from app.wordbook.definitions import DIR_NAME

logger = logging.getLogger(__name__)

FILE_NAME = "forms.txt"


def default_path(book_data_dir: Path) -> Path:
    """与英文释义同目录:`<dictionaries>/wordbook-definitions/forms.txt`(容器里 /app/dictionaries/...)。"""
    return Path(book_data_dir).parent / DIR_NAME / FILE_NAME


class Forms:
    """懒加载的 形式 -> 原形。第一次查询(或 `warm`)读一次文件;线程安全。"""

    def __init__(self, path: Path):
        self.path = Path(path)
        self._lock = threading.Lock()
        self._data: dict[str, str] | None = None
        self._stamp: tuple[int, int] | None = None

    def _stamp_now(self) -> tuple[int, int] | None:
        try:
            stat = self.path.stat()
        except OSError:
            return None
        return stat.st_size, stat.st_mtime_ns

    def _load(self) -> dict[str, str]:
        data: dict[str, str] = {}
        bad = 0
        try:
            with self.path.open("rb") as handle:
                for raw in handle:
                    if not raw.strip():
                        continue
                    form, tab, lemma = raw.decode("utf-8", "replace").rstrip("\r\n").partition("\t")
                    if tab and form and lemma and "\t" not in lemma:
                        data[form] = lemma
                    else:
                        bad += 1
        except OSError:
            logger.info("wordbook forms file unavailable")
            return {}
        if bad:
            logger.warning("wordbook forms skipped lines=%d", bad)
        return data

    def _ensure(self) -> dict[str, str]:
        stamp = self._stamp_now()
        data = self._data
        if data is None or stamp != self._stamp:
            with self._lock:
                if self._data is None or stamp != self._stamp:
                    self._data, self._stamp = self._load(), stamp
                data = self._data
        return data

    async def warm(self) -> None:
        """在事件循环之外先读一次(几百 KB),之后的 `lemma_of` 不再阻塞。文件变了也在这里重读。"""
        if self._data is None or self._stamp_now() != self._stamp:
            await asyncio.to_thread(self._ensure)

    def __len__(self) -> int:
        return len(self._ensure())

    def lemma_of(self, form: str) -> str | None:
        """键是规范化小写词;没有 = None。"""
        return self._ensure().get(form)
