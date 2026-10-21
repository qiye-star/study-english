"""纯函数:文本 → 候选原形(聊天匹配用);句子 → 索引词元(句子倒排用)。plan L4 R6、R10。

不导入数据库、不写日志。`lemma_of` 由调用方注入(生产用 `lookup_service(app).forms.lemma_of`,调用前 `await forms.warm()`)。
"""
from collections.abc import Callable

from app.wordbook.textnorm import fold, lemma_candidates, tokenize

CANDIDATES_MAX = 200  # 单次查询的候选上限(R6);超出截断并报告
SEGMENT_MIN_LEN = 3  # 索引词元至少 3 个字母(R10)
LEMMA_MAX = 100  # segment_lemma.lemma 的列宽
STOPWORDS = frozenset({
    "the", "and", "for", "are", "but", "not", "you", "all", "any", "can", "had", "her", "was", "one", "our", "out",
    "has", "his", "how", "its", "may", "who", "did", "yes", "too", "use", "she", "him", "your", "from",
    "with", "this", "that", "they", "them", "then", "than", "what", "when", "were", "will", "have", "been", "into",
    "just", "like", "over", "some", "very", "their", "would", "could", "should", "about",
})  # 停用词只用于索引(R10);聊天匹配不过滤,由已学词集合求交决定

LemmaOf = Callable[[str], str | None]


def candidates(text: str, lemma_of: LemmaOf) -> tuple[set[str], bool]:
    """文本里每个词元的候选原形(折叠形、规则反求、不规则表、词形表),最多 CANDIDATES_MAX 个。返回 (集合, 是否截断)。"""
    out: set[str] = set()
    for token in tokenize(text):
        folded = fold(token.text)
        out.add(folded)
        out |= lemma_candidates(folded)
        lemma = lemma_of(folded)
        if lemma:
            out.add(lemma)
    truncated = len(out) > CANDIDATES_MAX
    if truncated:
        out = set(sorted(out)[:CANDIDATES_MAX])
    return out, truncated


def segment_lemmas(text: str, lemma_of: LemmaOf) -> set[str]:
    """句子的索引词元:每个词元一个原形(词形表优先,否则折叠形),去停用词、去短词、去超长。"""
    out: set[str] = set()
    for token in tokenize(text):
        folded = fold(token.text)
        lemma = lemma_of(folded) or folded
        if len(lemma) < SEGMENT_MIN_LEN or len(lemma) > LEMMA_MAX or lemma in STOPWORDS:
            continue
        out.add(lemma)
    return out
