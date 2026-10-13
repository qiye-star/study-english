"""选词词典(spec 2026-10-13-defs-default-lookup-ios §3.2):规范化 -> 词书直接命中 -> 词形还原 -> 短语表精确命中。

只读七本词书(`DictionaryStore` 的索引与词卡)、英文释义和词形小表;不发网络请求、不调用 LLM、不写库、不记录查询的词
(这里没有任何日志调用)。没有英文释义 / 词形文件也能工作(对应部分为空)。属于 wordbook 层:只有 routers 导入。"""
import asyncio
import json
import re
import threading
from pathlib import Path

from app.services.vocabulary import normalize_word
from app.wordbook.books import BOOK_IDS, book_by_id
from app.wordbook.entry import WordCard, headword_key
from app.wordbook.forms import Forms, default_path
from app.wordbook.index import DataUnavailable, DictionaryStore, dictionary

MAX_WORDS = 3  # 超过 3 个词或 40 个字符的输入不查词典(网页走翻译 / 大模型)
MAX_CHARS = 40
MAX_ZH = 4  # 一次响应里的中文释义条数上限(词卡最多 6 条)
MAX_PHRASES = 3
_EDGE = re.compile(r"^\W+|\W+$")


def normalize_query(text: str) -> str | None:
    """规范化(NFC、折叠排版撇号、小写、压缩空白)并去掉首尾标点;不是查词候选(空、太长、词太多、含汉字、词头黑名单)返回 None。"""
    key = _EDGE.sub("", normalize_word(text))
    if not key or len(key) > MAX_CHARS or len(key.split()) > MAX_WORDS:
        return None
    return key if headword_key(key) is not None else None


def _variants(key: str) -> list[str]:
    """`john's` 先按原样查,再去掉所有格 's 查一次。"""
    return [key, key[:-2]] if key.endswith("'s") and len(key) > 3 else [key]


def _build_phrases(data_dir: Path) -> dict[str, str]:
    """短语(<= 3 个词)-> 中文释义,按书的顺序取第一次出现;读七个文件一遍(约 1.5 秒),在线程里调用。"""
    out: dict[str, str] = {}
    for book in BOOK_IDS:
        try:
            with (data_dir / book_by_id(book).file).open("rb") as handle:
                for line in handle:
                    if b'"phrase"' not in line:
                        continue
                    try:
                        row = json.loads(line)
                    except ValueError:
                        continue
                    phrases = row.get("phrases") if isinstance(row, dict) else None
                    for p in phrases if isinstance(phrases, list) else []:
                        if not isinstance(p, dict):
                            continue
                        key = normalize_query(str(p.get("phrase") or ""))
                        zh = " ".join(str(p.get("translation") or "").split())
                        if key and " " in key and zh:
                            out.setdefault(key, zh)
        except OSError:
            continue
    return out


class DictionaryLookup:
    def __init__(self, store: DictionaryStore):
        self.store = store
        self.forms = Forms(default_path(store.data_dir))
        self._lock = threading.Lock()
        self._phrases: dict[str, str] | None = None
        self._stamp: tuple | None = None

    async def lookup(self, text: str) -> dict | None:
        """命中返回响应体(不含 def_lang,由路由补),否则 None。"""
        key = normalize_query(text)
        if key is None:
            return None
        await self.forms.warm()
        await self.store.definitions.warm()
        for variant in _variants(key):
            card = await self._card(variant)
            if card is None and " " not in variant and (lemma := self.forms.lemma_of(variant)):
                card = await self._card(lemma)
            if card is not None and (out := self._entry(key, card)) is not None:
                return out
        return await self._phrase(key) if " " in key else None

    async def _card(self, key: str) -> WordCard | None:
        for book in BOOK_IDS:  # 初中 -> SAT:先命中的书给词卡
            try:
                if key in await self.store.index(book):
                    card = await self.store.card(book, key)
                    if card is not None:
                        return card
            except DataUnavailable:
                continue
        return None

    def _entry(self, query: str, card: WordCard) -> dict | None:
        zh = [{"pos": s.pos, "text": s.text} for s in card.senses[:MAX_ZH]]
        en = self.store.definitions.defs_for(card.key)
        if not zh and not en:
            return None
        inflected = card.key != query
        out: dict = {"hit": True, "word": query if inflected else card.word}
        if inflected:
            out["lemma"] = card.word
        if phonetic := card.us or card.uk:
            out["phonetic"] = phonetic
        out["defs_zh"], out["defs_en"] = zh, en
        if card.phrases:
            out["phrases"] = [{"en": en_text, "zh": zh_text} for en_text, zh_text in card.phrases[:MAX_PHRASES]]
        out["source"] = "dict"
        return out

    def _signature(self) -> tuple:
        stamps = []
        for book in BOOK_IDS:
            try:
                stat = (self.store.data_dir / book_by_id(book).file).stat()
            except OSError:
                stamps.append(None)
            else:
                stamps.append((stat.st_size, stat.st_mtime_ns))
        return tuple(stamps)

    def _phrase_map(self) -> dict[str, str]:
        stamp = self._signature()
        with self._lock:
            if self._phrases is None or stamp != self._stamp:
                self._phrases, self._stamp = _build_phrases(self.store.data_dir), stamp
            return self._phrases

    async def _phrase(self, key: str) -> dict | None:
        zh = (await asyncio.to_thread(self._phrase_map)).get(key)
        if zh is None:
            return None
        return {"hit": True, "word": key, "defs_zh": [{"pos": "", "text": zh}], "defs_en": [], "source": "dict"}


def lookup_service(app) -> DictionaryLookup:
    """唯一入口:跟随 `dictionary(app)` 的 store(数据目录变了就换一个新的)。"""
    store = dictionary(app)
    service = getattr(app.state, "dict_lookup", None)
    if service is None or service.store is not store:
        service = app.state.dict_lookup = DictionaryLookup(store)
    return service
