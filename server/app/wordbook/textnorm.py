"""分词、折叠、规则与不规则变形、反求原形、在例句中定位目标词(spec §6.6)。纯函数。"""
import re
import unicodedata
from dataclasses import dataclass
from functools import lru_cache

WORD_RE = re.compile(r"[A-Za-zÀ-ÿ]+(?:['’\-][A-Za-zÀ-ÿ]+)*")
_FOLD = str.maketrans({"’": "'", "‘": "'", "ʼ": "'"})
_VOWELS = "aeiou"

# 常见不规则动词三形与不规则复数(lemma -> 变形);只用于判「词形不对」与定位例句中的目标词
_IRREGULAR_TEXT = """
be am is are was were been being|go goes went gone going|have has had having|do does did done doing
begin began begun beginning|break broke broken|bring brought|build built|buy bought|catch caught|choose chose chosen
come came|cost|cut cutting|draw drew drawn|drink drank drunk|drive drove driven|eat ate eaten|fall fell fallen
feel felt|fight fought|find found|fly flew flown flies|forget forgot forgotten forgetting|get got gotten getting
give gave given|grow grew grown|hang hung|hear heard|hide hid hidden|hit hitting|hold held|hurt|keep kept
know knew known|lay laid|lead led|leave left|lend lent|let letting|lie lay lain lying|lose lost|make made
mean meant|meet met|pay paid|put putting|read|ride rode ridden|ring rang rung|rise rose risen|run ran running
say said|see saw seen|seek sought|sell sold|send sent|set setting|shake shook shaken|shine shone|shoot shot
show showed shown|shut shutting|sing sang sung|sink sank sunk|sit sat sitting|sleep slept|speak spoke spoken
spend spent|stand stood|steal stole stolen|stick stuck|strike struck|swim swam swum swimming|take took taken
teach taught|tear tore torn|tell told|think thought|throw threw thrown|understand understood|wake woke woken
wear wore worn|win won winning|write wrote written|bear bore born borne|bend bent|bind bound|bite bit bitten
blow blew blown|burn burnt|deal dealt|dig dug digging|feed fed|forbid forbade forbidden|freeze froze frozen
light lit|overcome overcame|shrink shrank shrunk|slide slid|spread|spring sprang sprung|swear swore sworn
sweep swept|swing swung|undergo underwent undergone|withdraw withdrew withdrawn|weep wept|wind wound
child children|man men|woman women|person people|foot feet|tooth teeth|mouse mice|goose geese|ox oxen
life lives|wife wives|knife knives|leaf leaves|half halves|wolf wolves|shelf shelves|thief thieves
crisis crises|analysis analyses|basis bases|thesis theses|phenomenon phenomena|criterion criteria
datum data|medium media|bacterium bacteria|curriculum curricula|good better best|bad worse worst|far farther further
"""
IRREGULAR: dict[str, tuple[str, ...]] = {}
for _group in _IRREGULAR_TEXT.replace("\n", "|").split("|"):
    _words = _group.split()
    if _words:
        IRREGULAR[_words[0]] = tuple(_words[1:])
# 这些词的规则变形会撞上真实单词(be → bed / best),只用不规则表
_NO_REGULAR = frozenset({"be"})
_REVERSE: dict[str, set[str]] = {}
for _lemma, _forms in IRREGULAR.items():
    for _form in _forms:
        _REVERSE.setdefault(_form, set()).add(_lemma)


@dataclass(frozen=True)
class Token:
    text: str
    start: int
    end: int


def fold(text: str) -> str:
    return unicodedata.normalize("NFC", text).translate(_FOLD).strip().lower()


def tokenize(text: str) -> list[Token]:
    return [Token(m.group(0), m.start(), m.end()) for m in WORD_RE.finditer(text)]


def _one_syllable(word: str) -> bool:
    return len(re.findall(r"[aeiou]+", word)) == 1


def _double_final(word: str) -> bool:
    return (len(word) >= 3 and word[-1] not in _VOWELS + "wxy" and word[-2] in _VOWELS
            and word[-3] not in _VOWELS and _one_syllable(word))


def _regular(w: str) -> set[str]:
    out = {w}
    if re.search(r"(s|x|z|ch|sh|o)$", w):
        out.add(w + "es")
    if re.search(r"[^aeiou]y$", w):
        stem = w[:-1]
        out |= {stem + "ies", stem + "ied", stem + "ier", stem + "iest", stem + "ily", w + "ing"}
    else:
        out.add(w + "s")
        if w.endswith("e"):
            out |= {w + "d", w[:-1] + "ing", w + "r", w + "st", w[:-1] + "y" if w.endswith("le") else w + "ly"}
        else:
            out |= {w + "ed", w + "ing", w + "er", w + "est", w + "ly"}
            if _double_final(w):
                out |= {w + w[-1] + "ed", w + w[-1] + "ing", w + w[-1] + "er", w + w[-1] + "est"}
    if w.endswith("ic"):
        out.add(w + "ally")
    if w.endswith(("f", "fe")):
        out.add(re.sub(r"fe?$", "ves", w))
    return out


@lru_cache(maxsize=4096)
def _inflections_folded(w: str) -> frozenset[str]:
    regular = {w} if w in _NO_REGULAR else _regular(w)
    return frozenset(regular | set(IRREGULAR.get(w, ())))


def inflections(lemma: str) -> frozenset[str]:
    return _inflections_folded(fold(lemma))


_LEMMA_RULES = (("ies", "y"), ("ied", "y"), ("ier", "y"), ("iest", "y"), ("ily", "y"), ("ves", "f"), ("ves", "fe"),
                ("es", ""), ("s", ""), ("ed", ""), ("ed", "e"), ("d", ""), ("ing", ""), ("ing", "e"),
                ("er", ""), ("er", "e"), ("est", ""), ("est", "e"), ("ly", ""), ("ally", ""))


def lemma_candidates(form: str) -> frozenset[str]:
    f = fold(form)
    out = {f} | _REVERSE.get(f, set())
    for suffix, repl in _LEMMA_RULES:
        if f.endswith(suffix) and len(f) - len(suffix) >= 2:
            stem = f[: -len(suffix)]
            out.add(stem + repl)
            if repl == "" and len(stem) >= 3 and stem[-1] == stem[-2] and suffix in ("ed", "ing", "er", "est"):
                out.add(stem[:-1])  # stopped -> stop
    # 候选必须能变回 f,避免 bed → be 这类误判
    return frozenset(c for c in out if len(c) >= 2 and (c == f or f in _inflections_folded(c)))


def same_lemma(a: str, b: str) -> bool:
    fa, fb = fold(a), fold(b)
    if fa == fb:
        return True
    return fb in inflections(fa) or fa in inflections(fb) or bool(
        (lemma_candidates(fa) & lemma_candidates(fb)) - {""})


def find_form(sentence: str, key: str) -> tuple[int, int, str] | None:
    """在句中定位 key:原形优先,其次变形;多词键要求前面各词原形相同、最后一词可变形。返回 (start, end, 原文)。"""
    tokens = tokenize(sentence)
    parts = fold(key).split()
    if not parts:
        return None
    if len(parts) == 1:
        target = parts[0]
        folded = [fold(t.text) for t in tokens]
        for token, text in zip(tokens, folded):
            if text == target:
                return token.start, token.end, token.text
        forms = inflections(target)
        for token, text in zip(tokens, folded):
            if text in forms:
                return token.start, token.end, token.text
        return None
    last_forms = inflections(parts[-1])
    for i in range(len(tokens) - len(parts) + 1):
        window = tokens[i: i + len(parts)]
        if all(fold(t.text) == p for t, p in zip(window[:-1], parts[:-1])) and fold(window[-1].text) in last_forms:
            return window[0].start, window[-1].end, sentence[window[0].start: window[-1].end]
    return None
