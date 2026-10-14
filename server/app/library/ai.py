"""句子译文与 AI 分析(spec 2026-10-13-video-import D8、E11、E12):批量译文、单句分析、按句计的额度、提示词渲染。

- 译文 `translate`:一次最多 20 句,一次大模型调用;已存且语言一致的直接用,其余按额度生成后写回句子行。
  额度不够时先生成能生成的,其余缺着并带 `limited`;上游失败或模型漏答的句子,额度退还。
- 分析 `analyze`:一次一句,只在用户点「分析」时调用;已存且语言一致的直接返回(`cached`),不计额度。
- 大模型只经 `providers/llm.complete`;提示词按桌面端 `enjoy/src/shared/commands/{translate,analyze}.command.ts` 的原文,
  管理端可编辑(`library.translate` / `library.analyze`,注册在 `services/prompts.py`;没有发布版本时用本文件的默认值)。
- 精选库(spec 2026-10-14-curated-library R3):`translate_texts`(导入时批量译,不计额度)与 `analyze_catalog`(目录句子上的
  共享缓存,首次生成由系统付费:全站每日计数 `library_cat_ai` + `metering.system_scope`)。
- 日志只有条目 id、失败种类与句数;句子、译文、分析、提示词正文永不进日志。计量记在 feature `lib_translate` /
  `lib_analysis`(`llm.complete` 自己 `metering.record` 成功与失败;feature 列只有 16 个字符,所以不叫 `library_translate`)。
"""
import asyncio
import logging
import re
import weakref
from datetime import datetime

from app.core import metering
from app.library import catalog_store, limits, store
from app.models import LibrarySegment
from app.providers import llm

logger = logging.getLogger(__name__)

# 母语白名单(桌面端 `languages.json` 的 12 个码)→ 提示词里的语言名(英文名,避免母语文字名带来歧义)
LANGS: dict[str, str] = {
    "en-US": "English (United States)", "en-GB": "English (United Kingdom)", "zh-CN": "Simplified Chinese",
    "zh-HK": "Cantonese (Traditional Chinese)", "ja-JP": "Japanese", "ko-KR": "Korean", "es-ES": "Spanish",
    "it-IT": "Italian", "de-DE": "German", "fr-FR": "French", "th-TH": "Thai", "vi-VN": "Vietnamese",
}
LEARNING_LANGUAGE = "English"
KEYS = ("library.translate", "library.analyze")
FEATURE_TRANSLATE, FEATURE_ANALYSIS = "lib_translate", "lib_analysis"  # metering features (upstream_calls.feature is 16 chars)
TRANSLATE_TEMPERATURE = 0.2
ANALYZE_TEMPERATURE = 0.3
ANALYZE_MAX_TOKENS = 1500
TRANSLATE_TOKENS_BASE, TRANSLATE_TOKENS_PER_SENTENCE, TRANSLATE_TOKENS_CAP = 200, 120, 3000

TRANSLATE_SYSTEM = "You are a professional, authentic translation engine, only returns translations."
# enjoy 的 TRANSLATION_PROMPT 原句 + 批量格式的一句说明(模板里 {text} 是带编号的句子列表,边界标签防止句子伪造指令)
DEFAULT_TRANSLATE_TEMPLATE = (
    "Translate the text to {native_language} Language, please do not explain my original text. "
    "The text is a numbered list with one sentence per line, written as \"N. sentence\". "
    "Reply with exactly one line per sentence in the same \"N. translation\" format and nothing else:\n\n"
    "<text>\n{text}\n</text>")
# enjoy 的分析系统提示词原文(analyze.command.ts 的 SYSTEM_PROMPT);用户消息就是那一句
DEFAULT_ANALYZE_TEMPLATE = (
    "I speak {native_language}. You're my {learning_language} coach, I'll provide {learning_language} text, you'll "
    "help me analyze the sentence structure, grammar, and vocabulary/phrases, and provide a detailed explanation of "
    "the text. Please return the results in the following format(but in {native_language}):\n\n"
    "### Sentence Structure\n(Explain each element of the sentence)\n\n"
    "### Grammar\n(Explain the grammar of the sentence)\n\n"
    "### Vocabulary/Phrases\n(Explain the key vocabulary and phrases used)")
DEFAULTS = {"library.translate": DEFAULT_TRANSLATE_TEMPLATE, "library.analyze": DEFAULT_ANALYZE_TEMPLATE}
_LINE = re.compile(r"^\s*(\d{1,3})\s*[.、)）:：]\s*(\S.*?)\s*$")


class AiUnavailable(Exception):
    """kind ∈ user_cap | global_cap | upstream。开关与未配置由路由在入口处按 `library_ai_available` 拒绝(404)。"""

    def __init__(self, kind: str):
        super().__init__(kind)
        self.kind = kind


def _plain(text: str, limit: int = limits.SEGMENT_TEXT_MAX) -> str:
    """压成一行、截断,并把尖括号换成形近字符:句子文字不能伪造 `<text>` 边界。"""
    return " ".join(text.replace("<", "‹").replace(">", "›").split())[:limit]


def _format(template: str | None, default: str, **values: str) -> str:
    try:
        return (template or default).format(**values)
    except (KeyError, IndexError, ValueError):  # 发布时已校验;万一坏了回落默认,不记模板正文
        logger.warning("library ai template invalid, using default")
        return default.format(**values)


def render_translate(template: str | None, language: str, sentences: list[str]) -> list[dict]:
    numbered = "\n".join(f"{n}. {_plain(s)}" for n, s in enumerate(sentences, 1))
    body = _format(template, DEFAULT_TRANSLATE_TEMPLATE, native_language=LANGS[language], text=numbered)
    return [{"role": "system", "content": TRANSLATE_SYSTEM}, {"role": "user", "content": body}]


def render_analysis(template: str | None, language: str, sentence: str) -> list[dict]:
    system = _format(template, DEFAULT_ANALYZE_TEMPLATE, native_language=LANGS[language],
                     learning_language=LEARNING_LANGUAGE)
    return [{"role": "system", "content": system}, {"role": "user", "content": _plain(sentence)}]


def render_test(key: str, template: str, sample: dict[str, str]) -> list[dict]:
    """管理端「试运行」:用样例句子与母语码渲染,与线上同一路径(转义、编号)。"""
    code = sample.get("native_language", "").strip()
    language = code if code in LANGS else "zh-CN"
    text = sample.get("text", "").strip() or "I have been learning English for two years."
    if key == "library.translate":
        return render_translate(template, language, [text])
    return render_analysis(template, language, text)


def parse_translations(raw: str, count: int) -> dict[int, str]:
    """`N. translation` 行 → {N: 译文}(N 从 1 起,只收 1..count,同号取第一次)。没有编号的行一律不要:模型的拒绝语、
    前言、代码围栏都不会被当成译文存下来(漏答的句子额度退还,下次再试)。"""
    found: dict[int, str] = {}
    for line in raw.splitlines():
        match = _LINE.match(line)
        if match and 1 <= int(match.group(1)) <= count and int(match.group(1)) not in found:
            found[int(match.group(1))] = match.group(2)[:limits.TRANSLATION_MAX]
    return found


async def translate(session, http, settings, *, user_id: int, item_id: str, segments: list[LibrarySegment],
                    language: str, template: str | None, now: datetime) -> tuple[dict[int, str], bool]:
    """({idx: zh} for every requested sentence that has a translation in `language` afterwards, limited).
    `limited` = the daily allowance stopped some sentences. Raises AiUnavailable("upstream") when the model gave
    nothing usable (the reserved sentences are given back first)."""
    rows = [(s.idx, s.text, s.zh, s.zh_lang) for s in segments]  # plain values: the commits below must not matter
    out = {idx: zh for idx, _text, zh, lang in rows if zh and lang == language}
    todo = [(idx, text) for idx, text, zh, lang in rows if not (zh and lang == language)]
    if not todo:
        return out, False
    day = limits.day_of(now)
    granted, _why = await limits.reserve_ai(session, user_id, limits.SCOPE_TRANSLATE,
                                            settings.library_translate_daily_per_user,
                                            settings.library_ai_daily_global, len(todo), day)
    if granted == 0:
        return out, True
    batch = todo[:granted]
    max_tokens = min(TRANSLATE_TOKENS_CAP, TRANSLATE_TOKENS_BASE + TRANSLATE_TOKENS_PER_SENTENCE * len(batch))
    try:
        with metering.feature_scope(FEATURE_TRANSLATE):
            raw = await llm.complete(http, settings, render_translate(template, language, [t for _i, t in batch]),
                                     model=settings.default_llm_model, max_tokens=max_tokens,
                                     temperature=TRANSLATE_TEMPERATURE)
    except llm.LlmUnavailable as e:
        await limits.refund_ai(session, user_id, limits.SCOPE_TRANSLATE, granted, day)
        logger.warning("library translate unavailable item=%s kind=%s count=%d", item_id, e.kind, len(batch))
        raise AiUnavailable("upstream") from None
    parsed = parse_translations(raw, len(batch))
    if len(parsed) < granted:
        await limits.refund_ai(session, user_id, limits.SCOPE_TRANSLATE, granted - len(parsed), day)
    if not parsed:
        logger.warning("library translate empty item=%s count=%d", item_id, len(batch))
        raise AiUnavailable("upstream")
    entries = [(batch[n - 1][0], batch[n - 1][1], zh) for n, zh in sorted(parsed.items())]
    stored = await store.set_translations(session, item_id, entries, language)
    out.update({idx: zh for idx, _text, zh in entries if idx in stored})
    return out, granted < len(todo)


async def analyze(session, http, settings, *, user_id: int, item_id: str, segment: LibrarySegment, language: str,
                  template: str | None, now: datetime) -> tuple[str, bool]:
    """(analysis, cached). A stored analysis in the same language is free; otherwise one sentence of the daily
    allowance is reserved first (AiUnavailable user_cap / global_cap) and given back if the model fails."""
    idx, text, stored, stored_lang = segment.idx, segment.text, segment.analysis, segment.analysis_lang
    if stored and stored_lang == language:
        return stored, True
    day = limits.day_of(now)
    granted, why = await limits.reserve_ai(session, user_id, limits.SCOPE_ANALYSIS,
                                           settings.library_analysis_daily_per_user,
                                           settings.library_ai_daily_global, 1, day)
    if granted == 0:
        raise AiUnavailable("global_cap" if why == "global" else "user_cap")
    try:
        with metering.feature_scope(FEATURE_ANALYSIS):
            raw = await llm.complete(http, settings, render_analysis(template, language, text),
                                     model=settings.default_llm_model, max_tokens=ANALYZE_MAX_TOKENS,
                                     temperature=ANALYZE_TEMPERATURE)
    except llm.LlmUnavailable as e:
        await limits.refund_ai(session, user_id, limits.SCOPE_ANALYSIS, 1, day)
        logger.warning("library analysis unavailable item=%s kind=%s", item_id, e.kind)
        raise AiUnavailable("upstream") from None
    body = raw.strip()[:limits.ANALYSIS_MAX]
    await store.set_analysis(session, item_id, idx, text, body, language)
    return body, False


# ---- curated catalog (spec 2026-10-14-curated-library R3, R4) ----
FEATURE_CAT_TRANSLATE, FEATURE_CAT_ANALYSIS = "cat_translate", "cat_analysis"
_CATALOG_LOCKS: "weakref.WeakValueDictionary[tuple[str, int], asyncio.Lock]" = weakref.WeakValueDictionary()


async def translate_texts(http, settings, *, template: str | None, language: str,
                          texts: list[str]) -> dict[int, str]:
    """One batch (<= 20) for the catalog import: {0-based index: translation}. No allowance (the admin's import pays;
    the caller binds no user). AiUnavailable("upstream") when the model gave nothing usable."""
    if not texts:
        return {}
    max_tokens = min(TRANSLATE_TOKENS_CAP, TRANSLATE_TOKENS_BASE + TRANSLATE_TOKENS_PER_SENTENCE * len(texts))
    try:
        with metering.feature_scope(FEATURE_CAT_TRANSLATE):
            raw = await llm.complete(http, settings, render_translate(template, language, texts),
                                     model=settings.default_llm_model, max_tokens=max_tokens,
                                     temperature=TRANSLATE_TEMPERATURE)
    except llm.LlmUnavailable as e:
        logger.warning("library catalog translate unavailable kind=%s count=%d", e.kind, len(texts))
        raise AiUnavailable("upstream") from None
    parsed = parse_translations(raw, len(texts))
    if not parsed:
        logger.warning("library catalog translate empty count=%d", len(texts))
        raise AiUnavailable("upstream")
    return {n - 1: zh for n, zh in parsed.items()}


async def analyze_catalog(session, http, settings, *, catalog_id: str, idx: int, text: str, language: str,
                          template: str | None, now: datetime) -> tuple[str, bool]:
    """(analysis, cached) for a catalog sentence in its catalog language. Generated once, shared by every copy,
    paid by the system: the site-wide `library_cat_ai` count (AiUnavailable("global_cap") when full), upstream metered
    with no user (`metering.system_scope`). A per-sentence lock makes concurrent first requests pay once."""
    key = (catalog_id, idx)
    lock = _CATALOG_LOCKS.get(key)
    if lock is None:
        lock = _CATALOG_LOCKS[key] = asyncio.Lock()
    async with lock:
        seg = await catalog_store.segment_at(session, catalog_id, idx)  # populate_existing: sees a concurrent writer
        if seg is None or not store.same_text(seg.text, text):
            raise AiUnavailable("upstream")  # the caller checked; a concurrent admin edit lands here
        if seg.analysis and seg.analysis_lang == language:
            return seg.analysis, True
        seg_text = seg.text  # plain value: the commits below must not matter
        day = limits.day_of(now)
        if not await limits.reserve(session, limits.SCOPE_CATALOG_AI, limits.GLOBAL, day, 1,
                                    settings.library_catalog_ai_daily):
            raise AiUnavailable("global_cap")
        try:
            with metering.system_scope(), metering.feature_scope(FEATURE_CAT_ANALYSIS):
                raw = await llm.complete(http, settings, render_analysis(template, language, seg_text),
                                         model=settings.default_llm_model, max_tokens=ANALYZE_MAX_TOKENS,
                                         temperature=ANALYZE_TEMPERATURE)
        except llm.LlmUnavailable as e:
            await limits.release(session, limits.SCOPE_CATALOG_AI, limits.GLOBAL, day, 1)
            logger.warning("library catalog analysis unavailable catalog=%s kind=%s", catalog_id, e.kind)
            raise AiUnavailable("upstream") from None
        body = raw.strip()[:limits.ANALYSIS_MAX]
        await catalog_store.set_analysis(session, catalog_id, idx, seg_text, body, language)
        return body, False
