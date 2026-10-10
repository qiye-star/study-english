"""行清洗与重复行合并(spec §2.11)。纯函数:输入是 json.loads 后的行,输出不可变的 WordCard。"""
import hashlib
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass

from app.services.vocabulary import normalize_word
from app.wordbook.books import DENYLIST, POS_ABBREVIATIONS
from app.wordbook.textnorm import find_form, tokenize

POS_BITS = {"n": 1, "v": 2, "adj": 4, "adv": 8}
OTHER_BIT = 16
_ALIASES = {"vt": "v", "vi": "v", "a": "adj", "ad": "adv", "modal verb": "v", "modalverb": "v", "aux": "v"}
MAX_SENSES, MAX_PHRASES, MAX_EXAMPLES = 6, 10, 6
MIN_WORDS, MAX_WORDS = 4, 25
_CJK = re.compile(r"[㐀-鿿豈-﫿]")
_GLOSS = re.compile(r"\s*\(\s*=[^)]*\)")
_SPACE_BEFORE_PUNCT = re.compile(r"\s+([,.;:!?])")
_SPACE_AFTER_FULLWIDTH = re.compile(r"([，；：。、])\s+")
_ODD_SPACES = str.maketrans({" ": " ", " ": " ", " ": " ", " ": " ", " ": " "})
_SPELLABLE = re.compile(r"[a-z]+(?:[ '\-][a-z]+)*")


@dataclass(frozen=True)
class Sense:
    pos: str
    text: str


@dataclass(frozen=True)
class Example:
    id: str
    en: str
    zh: str


@dataclass(frozen=True)
class WordCard:
    key: str
    word: str
    us: str
    uk: str
    senses: tuple[Sense, ...]
    phrases: tuple[tuple[str, str], ...]
    examples: tuple[Example, ...]
    pos_mask: int

    @property
    def spellable(self) -> bool:
        """拼写/听写/挖空只出 ASCII 字母(可含空格、连字符、撇号)的词头(spec §2.11-7)。"""
        return _SPELLABLE.fullmatch(self.key) is not None


def headword_key(word: str) -> str | None:
    text = unicodedata.normalize("NFC", word or "").strip()
    if not text or _CJK.search(text):
        return None
    key = normalize_word(text)
    if not key or key in POS_ABBREVIATIONS or key in DENYLIST:
        return None
    return key


def pos_parts(type_str: str | None) -> list[str]:
    raw = (type_str or "").strip().lower()
    if not raw:
        return ["other"]
    parts = [p.strip().rstrip(".") for p in re.split(r"[&/,]", raw) if p.strip().rstrip(".")]
    return [_ALIASES.get(p, p) for p in parts] or ["other"]


def pos_mask_of(parts: list[str]) -> int:
    mask = 0
    for part in parts:
        mask |= POS_BITS.get(part, OTHER_BIT)
    return mask


def clean_meaning(text: str) -> str:
    cleaned = _SPACE_AFTER_FULLWIDTH.sub(r"\1", unicodedata.normalize("NFC", text or "").strip())
    return " ".join(cleaned.split())


def normalize_phonetic(text: str | None) -> str:
    return (text or "").strip().strip("/[]").strip().replace("'", "ˈ")


def clean_sentence(text: str) -> str | None:
    t = unicodedata.normalize("NFC", text or "").translate(_ODD_SPACES)
    t = _SPACE_BEFORE_PUNCT.sub(r"\1", _GLOSS.sub("", t))
    t = " ".join(t.split())
    if not t or t.startswith(("...", "…")) or _CJK.search(t):
        return None
    if not MIN_WORDS <= len(tokenize(t)) <= MAX_WORDS:
        return None
    return t


def sentence_id(en: str) -> str:
    return hashlib.sha1(en.encode("utf-8")).hexdigest()[:16]


def merge_rows(rows: list[dict], *, hidden: frozenset[str] = frozenset()) -> WordCard | None:
    usable = [(k, r) for r in rows if (k := headword_key(r.get("word", "")))]
    if not usable:
        return None
    key = usable[0][0]
    display = Counter(unicodedata.normalize("NFC", r["word"]).strip() for _, r in usable).most_common(1)[0][0]
    us = next((normalize_phonetic(r.get("us")) for _, r in usable if (r.get("us") or "").strip()), "")
    uk = next((normalize_phonetic(r.get("uk")) for _, r in usable if (r.get("uk") or "").strip()), "")
    senses: list[Sense] = []
    phrases: list[tuple[str, str]] = []
    examples: list[Example] = []
    seen_senses, seen_phrases, seen_examples = set(), set(), set()
    mask = 0
    for _, row in usable:
        for t in row.get("translations") or []:
            parts = pos_parts(t.get("type"))
            mask |= pos_mask_of(parts)
            text = clean_meaning(t.get("translation") or "")
            pos = "/".join(p for p in parts if p != "other")
            if text and (pos, text) not in seen_senses and len(senses) < MAX_SENSES:
                seen_senses.add((pos, text))
                senses.append(Sense(pos, text))
        for p in row.get("phrases") or []:
            en = " ".join((p.get("phrase") or "").split())
            if en and en.lower() not in seen_phrases and len(phrases) < MAX_PHRASES:
                seen_phrases.add(en.lower())
                phrases.append((en, " ".join((p.get("translation") or "").split())))
        for s in row.get("sentences") or []:
            if len(examples) >= MAX_EXAMPLES:
                break
            en = clean_sentence(s.get("sentence") or "")
            if en is None or find_form(en, key) is None:
                continue
            sid = sentence_id(en)
            if sid in hidden or sid in seen_examples:
                continue
            seen_examples.add(sid)
            examples.append(Example(sid, en, " ".join((s.get("translation") or "").split())))
    return WordCard(key, display, us, uk, tuple(senses), tuple(phrases), tuple(examples), mask)


def meaning_line(card: WordCard, max_chars: int = 24) -> str:
    line = "；".join(f"{s.pos}. {s.text}" if s.pos else s.text for s in card.senses[:2])
    return line if len(line) <= max_chars else line[: max_chars - 1] + "…"
