"""句子角色的「智能建议」(plan L5 R7):让大模型按对白轮替给一个片段的句子标 A–F,只返回建议,不写库。

- 用户侧 `suggest`:一个片段一次调用;额度是按句计的 `dubbing_suggest`(每人每天)加全站 `library_ai`;
  只要有一句不能预留就整段拒绝(不给半个片段的建议);上游失败与漏答的句子退还额度。
- 管理端 `suggest_catalog`:系统付费(`metering.system_scope`),计入全站 `library_cat_ai`。
- 提示词 `library.roles` 可由管理员编辑(默认值在本模块,经 `services/prompts.py` 登记);占位符只有 `{text}`。
- 句子文字、提示词正文、模型回复永不进日志:只记条目 id、句数与失败种类(测试 `test_dubbing_suggest.py` 守护)。
"""
import logging
import re
from datetime import datetime

from app.core import metering
from app.library import ai, limits
from app.library.ai import AiUnavailable
from app.library.roles import ROLE_KEYS
from app.providers import llm

logger = logging.getLogger(__name__)

KEY = "library.roles"
FEATURE_SUGGEST = "lib_roles"  # metering feature, <= 16 characters
FEATURE_CAT_SUGGEST = "cat_roles"
ADMIN_SUGGEST_MAX_LINES = 40  # PLACEHOLDER: per request from the admin console (plan L5 R7)
TEMPERATURE = 0.0

SYSTEM = ("You assign speakers to subtitle lines of film or show dialogue. "
          "Answer only in the requested format, nothing else.")

# Editable by the admin (services/prompts.py). The only placeholder is {text}; keep braces out of the wording.
DEFAULT_TEMPLATE = (
    "Below are consecutive subtitle lines from one film or show, in order, numbered.\n"
    "Give each line the letter of the speaker who says it, from A to F. Use the same letter for the same person. "
    "Consecutive lines by one person share a letter. A new speaker takes the next unused letter.\n"
    "Answer with exactly one line per subtitle, in the form \"N. X\", where N is the line number and X is the letter. "
    "No other text.\n"
    "<text>\n{text}\n</text>"
)

# `N. X`, `N) X`, `N: X`; the letter must not run on into a word (so "1. Adam" is not a letter).
_LINE = re.compile(r"^\s*(\d{1,3})\s*[.):]\s*([A-Za-z])(?![A-Za-z])")


def _tokens(count: int) -> int:
    return 20 + 8 * count


def render(template: str | None, sentences: list[str]) -> list[dict]:
    """Chat messages for one clip. Sentences are flattened and their angle brackets are defanged (ai._plain), so a
    sentence cannot close the <text> boundary early."""
    numbered = "\n".join(f"{n}. {ai._plain(s)}" for n, s in enumerate(sentences, 1))
    body = ai._format(template, DEFAULT_TEMPLATE, text=numbered)
    return [{"role": "system", "content": SYSTEM}, {"role": "user", "content": body}]


def render_test(template: str, sample: dict[str, str]) -> list[dict]:
    """Admin test run: the same path as the live call, with one sample sentence."""
    text = sample.get("text", "").strip() or "Hello there, my friend."
    return render(template, [text])


def parse(raw: str, count: int) -> dict[int, str]:
    """`N. X` lines to {N: letter} (N from 1, only 1..count, letters only from A–F, first answer for a number wins).
    Anything else (prose, fences, a letter outside A–F) is dropped, so a refusal is never stored as a label."""
    found: dict[int, str] = {}
    for line in raw.splitlines():
        match = _LINE.match(line)
        if not match:
            continue
        number, letter = int(match.group(1)), match.group(2).upper()
        if 1 <= number <= count and letter in ROLE_KEYS and number not in found:
            found[number] = letter
    return found


async def suggest(session, http, settings, *, user_id: int, item_id: str, segments: list, now: datetime,
                  template: str | None = None) -> dict[int, str]:
    """{idx: letter} for the clip's sentences the model answered. Raises AiUnavailable("user_cap" | "global_cap") before
    any upstream call when the allowance cannot cover the whole clip, and AiUnavailable("upstream") when the model
    gave nothing usable. Commits nothing: the caller saves the labels after the user confirms."""
    rows = [(seg.idx, seg.text) for seg in segments]
    if not rows:
        return {}
    day = limits.day_of(now)
    granted, shortfall = await limits.reserve_ai(session, user_id, limits.SCOPE_DUBBING_SUGGEST,
                                                 settings.dubbing_suggest_daily_per_user,
                                                 settings.library_ai_daily_global, len(rows), day)
    if granted < len(rows):
        if granted:
            await limits.refund_ai(session, user_id, limits.SCOPE_DUBBING_SUGGEST, granted, day)
        raise AiUnavailable("global_cap" if shortfall == "global" else "user_cap")
    texts = [text for _idx, text in rows]
    try:
        with metering.feature_scope(FEATURE_SUGGEST):
            raw = await llm.complete(http, settings, render(template, texts), model=settings.default_llm_model,
                                     max_tokens=_tokens(len(rows)), temperature=TEMPERATURE)
    except llm.LlmUnavailable as e:
        await limits.refund_ai(session, user_id, limits.SCOPE_DUBBING_SUGGEST, len(rows), day)
        logger.warning("dubbing suggest unavailable item=%s kind=%s count=%d", item_id, e.kind, len(rows))
        raise AiUnavailable("upstream") from None
    parsed = parse(raw, len(rows))
    if len(parsed) < len(rows):
        await limits.refund_ai(session, user_id, limits.SCOPE_DUBBING_SUGGEST, len(rows) - len(parsed), day)
    if not parsed:
        logger.warning("dubbing suggest empty item=%s count=%d", item_id, len(rows))
        raise AiUnavailable("upstream")
    return {rows[number - 1][0]: letter for number, letter in sorted(parsed.items())}


async def suggest_catalog(session, http, settings, *, catalog_id: str, texts: list[str], now: datetime,
                          template: str | None = None) -> dict[int, str]:
    """Admin suggestion for a curated clip: {0-based position: letter}. System-paid, counted against the site-wide
    catalog AI budget (`library_cat_ai`); AiUnavailable("global_cap") when it is spent."""
    if not texts:
        return {}
    day = limits.day_of(now)
    count = len(texts)
    if not await limits.reserve(session, limits.SCOPE_CATALOG_AI, limits.GLOBAL, day, count,
                                settings.library_catalog_ai_daily):
        raise AiUnavailable("global_cap")
    try:
        with metering.system_scope(), metering.feature_scope(FEATURE_CAT_SUGGEST):
            raw = await llm.complete(http, settings, render(template, texts), model=settings.default_llm_model,
                                     max_tokens=_tokens(count), temperature=TEMPERATURE)
    except llm.LlmUnavailable as e:
        await limits.release(session, limits.SCOPE_CATALOG_AI, limits.GLOBAL, day, count)
        logger.warning("catalog roles unavailable catalog=%s kind=%s count=%d", catalog_id, e.kind, count)
        raise AiUnavailable("upstream") from None
    parsed = parse(raw, count)
    if len(parsed) < count:
        await limits.release(session, limits.SCOPE_CATALOG_AI, limits.GLOBAL, day, count - len(parsed))
    if not parsed:
        logger.warning("catalog roles empty catalog=%s count=%d", catalog_id, count)
        raise AiUnavailable("upstream")
    return {number - 1: letter for number, letter in sorted(parsed.items())}
