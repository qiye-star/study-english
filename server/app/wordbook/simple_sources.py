"""简单英英释义的第一层来源(可插拔,计划 2026-10-27 R-S1 与用户裁定)。

第一层 = 现成的简单释义;没有可用的、或仍含难词的,才由模型改写(`simple_defs_worker`)。
- 本模块只定义接口与一个读本地文件的来源。Simple English Wiktionary(CC BY-SA 4.0,需署名)的数据文件**未随仓库分发**;
  文件不存在 = 空来源,什么也不做。
- Learner's 系列(Longman / Oxford / Cambridge / Merriam-Webster)**不接入**:没有可随软件分发的开放数据,MW 的 API 有授权与缓存限制。
- 文件格式:`<dictionaries>/wordbook-definitions/simple-wiktionary.jsonl`,每行 `{"word": "...", "pos": "n", "text": "..."}`。
- 不记录日志;不做网络请求。"""
import json
from pathlib import Path
from typing import Protocol

from app.wordbook.definitions import DIR_NAME

WIKTIONARY_FILE = "simple-wiktionary.jsonl"


class DefinitionSource(Protocol):
    name: str

    def prepare(self) -> None: ...

    def simple_text(self, word: str, pos: str) -> str | None: ...


class FileSource:
    """A JSONL file of simple definitions keyed by (word, pos). Loaded once (`prepare` runs off the event loop)."""

    def __init__(self, name: str, path: Path):
        self.name = name
        self.path = Path(path)
        self._map: dict[tuple[str, str], str] | None = None

    def prepare(self) -> None:
        if self._map is None:
            self._map = self._load()

    def _load(self) -> dict[tuple[str, str], str]:
        out: dict[tuple[str, str], str] = {}
        try:
            lines = self.path.read_text(encoding="utf-8").splitlines()
        except OSError:
            return out  # no file = an empty source
        for line in lines:
            if not line.strip():
                continue
            try:
                row = json.loads(line)
                word, pos, text = row["word"], row["pos"], row["text"]
            except (ValueError, KeyError, TypeError):
                continue
            if isinstance(word, str) and isinstance(pos, str) and isinstance(text, str) and text.strip():
                out.setdefault((word.strip().lower(), pos), " ".join(text.split()))
        return out

    def simple_text(self, word: str, pos: str) -> str | None:
        self.prepare()
        return (self._map or {}).get((word, pos))


def default_sources(book_data_dir: Path) -> tuple[DefinitionSource, ...]:
    """The first layer, in order. Only the Simple English Wiktionary extract (absent in the repository)."""
    defs_dir = Path(book_data_dir).parent / DIR_NAME
    return (FileSource("simple-wiktionary", defs_dir / WIKTIONARY_FILE),)
