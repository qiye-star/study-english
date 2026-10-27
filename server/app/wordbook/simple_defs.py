"""简单英英释义(计划 2026-10-27 S 车道)。S1 部分:难词判定,纯函数,不做 I/O(`load_easy` 只读一个小文件)。

难词 = 释义里不在「易词表」里的英文词。易词表 `easy-words.txt` 由 `scripts/wordbook_definitions.py easy-words` 离线生成,
只来自仓库内的输入(初中 + 高中词头、功能词、forms.txt 里这些原形的词形)。不调用模型、不记录词。"""
import re
from collections.abc import Callable, Iterable
from pathlib import Path

from app.wordbook.definitions import DIR_NAME

EASY_FILE = "easy-words.txt"
HARD_MIN = 1  # 难词数 >= 此值的释义才需要改写(可调)
_LETTERS = re.compile(r"[a-z]+")
_BRACKET_ABBR = re.compile(r"\([^()]*\.[^()]*\)")  # (e.g.) (sb.) 之类缩写括号整段跳过


def easy_path(book_data_dir: Path) -> Path:
    """与释义同目录:`<dictionaries>/wordbook-definitions/easy-words.txt`。"""
    return Path(book_data_dir).parent / DIR_NAME / EASY_FILE


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
