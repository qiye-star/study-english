"""零成本题型与同书干扰项(spec §6.4、§6.5)。纯函数;随机一律用传入的 random.Random。"""
import hashlib
import random
import re
from dataclasses import dataclass
from typing import Literal

from app.wordbook.entry import Example, WordCard, meaning_line
from app.wordbook.index import BookIndex
from app.wordbook.textnorm import find_form, fold, same_lemma

QType = Literal["meaning", "word", "cloze", "dictation", "spell", "recall"]
QTYPES: tuple[QType, ...] = ("meaning", "word", "cloze", "dictation", "spell", "recall")
CHOICE_QTYPES: tuple[QType, ...] = ("meaning", "word", "cloze")
# 快速回忆(spec 2026-10-11-wordbook-recall §4.1):盒 0 刚忘、盒 3 → 4 是进入「已掌握」的那一步,都要客观题
RECALL_BOXES = frozenset({1, 2, 4, 5})
RECALL_SHARE_PCT = 40
BLANK = "_____"
_SPLIT = re.compile(r"[，；、,;]")
_NOTE = re.compile(r"\[[^\]]*\]")


@dataclass(frozen=True)
class Question:
    key: str
    qtype: QType
    prompt: dict[str, str]
    options: tuple[str, ...] | None
    length: int | None


def question_rng(user_id: int, key: str, reps: int) -> random.Random:
    digest = hashlib.sha256(f"{user_id}:{key}:{reps}".encode()).digest()
    return random.Random(int.from_bytes(digest[:8], "big"))


def cloze_example(card: WordCard) -> tuple[Example, int, int] | None:
    """第一条以原形出现目标词的例句(选择题挖空只用原形,选项才不会因词形泄露答案)。"""
    for example in card.examples:
        span = find_form(example.en, card.key)
        if span and fold(span[2]) == card.key:
            return example, span[0], span[1]
    return None


def eligible_qtypes(box: int, card: WordCard, *, tts: bool = True) -> tuple[QType, ...]:
    out: list[QType] = []
    if box <= 1:
        out.append("meaning")
    if box <= 2:
        out.append("word")
    if 1 <= box <= 3 and cloze_example(card):
        out.append("cloze")
    if box >= 2 and card.spellable and " " not in card.key:
        if tts:
            out.append("dictation")
        if box >= 3:
            out.append("spell")
    return tuple(out) or ("meaning",)


def pick_qtype(box: int, card: WordCard, rng: random.Random, *, tts: bool = True) -> QType:
    return rng.choice(eligible_qtypes(box, card, tts=tts))


def use_recall(user_id: int, key: str, reps: int, box: int) -> bool:
    """这次复习是否出「快速回忆」:与 pick_qtype 用不同的哈希,所以 v1 的选题结果逐项不变;
    客户端不声明支持或设置关闭时调用方不调用它。"""
    if box not in RECALL_BOXES:
        return False
    digest = hashlib.sha256(f"recall:{user_id}:{key}:{reps}".encode()).digest()
    return int.from_bytes(digest[:4], "big") % 100 < RECALL_SHARE_PCT


def _related(a: str, b: str) -> bool:
    return (min(len(a), len(b)) >= 5 and a[:5] == b[:5]) or same_lemma(a, b)


def candidate_keys(index: BookIndex, target_key: str, rng: random.Random, k: int = 24) -> list[str]:
    """按 rng 从书里抽最多 k 个候选:先要求词性有交集,不足 3 个再放宽词性(spec §6.5-1/3)。"""
    target_mask = index.pos_mask[index.ordinal[target_key]] if target_key in index else 0
    n = len(index.keys)
    picked: list[str] = []
    seen: set[str] = set()
    for strict in (True, False):
        tries = 0
        while len(picked) < k and tries < k * 20 and n > 1:
            tries += 1
            j = rng.randrange(n)
            key = index.keys[j]
            if key == target_key or key in seen or _related(key, target_key):
                continue
            if strict and target_mask and not index.pos_mask[j] & target_mask:
                continue
            seen.add(key)
            picked.append(key)
        if len(picked) >= 3:
            break
    return picked


def _fragments(card: WordCard) -> set[str]:
    out: set[str] = set()
    for sense in card.senses:
        out |= {p.strip() for p in _SPLIT.split(_NOTE.sub("", sense.text)) if p.strip()}
    return out


def pick_distractors(target: WordCard, pool: list[WordCard], qtype: QType, rng: random.Random,
                     n: int = 3) -> list[WordCard]:
    """去掉与目标共享释义片段、同词或释义行相同的;word/cloze 优先词长接近的。不足 n 个时返回更少。"""
    mine, line = _fragments(target), meaning_line(target)
    ok: list[WordCard] = []
    seen_words, seen_lines = {target.word.lower()}, {line}
    for c in pool:
        c_line = meaning_line(c)
        if (c.key == target.key or c.word.lower() in seen_words or c_line in seen_lines
                or _fragments(c) & mine):
            continue
        seen_words.add(c.word.lower())
        seen_lines.add(c_line)
        ok.append(c)
    if qtype in ("word", "cloze"):
        ok.sort(key=lambda c: abs(len(c.word) - len(target.word)))
        ok = ok[: 2 * n]
    return rng.sample(ok, min(n, len(ok)))


def build_question(qtype: QType, card: WordCard, distractors: list[WordCard], rng: random.Random) -> Question:
    if qtype == "recall":  # 只给词头与音标;释义在翻面后从词卡显示
        return Question(card.key, qtype, {"word": card.word, "us": card.us or card.uk}, None, None)
    if qtype in ("dictation", "spell"):
        prompt = {"word": card.word} if qtype == "dictation" else {"meaning": meaning_line(card, 40), "us": card.us or card.uk}
        return Question(card.key, qtype, prompt, None, len(card.word))
    if qtype == "meaning":
        options = [meaning_line(card)] + [meaning_line(d) for d in distractors]
        prompt = {"word": card.word, "us": card.us or card.uk}
    elif qtype == "word":
        options = [card.word] + [d.word for d in distractors]
        prompt = {"meaning": meaning_line(card, 40)}
    elif qtype == "cloze":
        found = cloze_example(card)
        if found is None:
            raise ValueError("card has no cloze example")
        example, start, end = found
        options = [card.word] + [d.word for d in distractors]
        prompt = {"sentence": example.en[:start] + BLANK + example.en[end:], "zh": example.zh}
    else:
        raise ValueError(f"unknown qtype {qtype!r}")
    rng.shuffle(options)
    return Question(card.key, qtype, prompt, tuple(options), None)


def correct_option(qtype: QType, card: WordCard) -> str:
    """选择题正确项的原文,与 `build_question` 放进 options 的那一项逐字相同(网页按它标绿)。"""
    if qtype == "meaning":
        return meaning_line(card)
    if qtype in ("word", "cloze"):
        return card.word
    raise ValueError(f"{qtype} is not a choice question")


def check_choice(qtype: QType, card: WordCard, choice: str) -> bool:
    if qtype == "meaning":
        return choice == meaning_line(card)
    if qtype in ("word", "cloze"):
        return fold(choice) == card.key
    raise ValueError(f"{qtype} is not a choice question")
