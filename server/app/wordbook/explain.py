"""AI「为什么」讲解(spec §6.7):按需、一个词一条全站缓存、每日额度、上游失败降级。

提示词 `wordbook.explain` 在管理端可版本化(app/services/prompts.py);没有发布版本时用 DEFAULT_EXPLAIN_TEMPLATE。
输入只来自词典(词头、释义、例句),不含用户输入,所以缓存可在全站复用。日志只记失败种类与词长,
永不记录讲解正文、提示词正文与词本身。"""
import logging

from sqlalchemy.exc import IntegrityError

from app.core import metering
from app.core.quotas import quota_for
from app.models import WordbookExplanation
from app.providers import llm
from app.services import usage
from app.wordbook.entry import WordCard

logger = logging.getLogger(__name__)
MAX_TOKENS = 400
TEMPERATURE = 0.3
MAX_BODY = 1200
USER_SCOPE, GLOBAL_SCOPE, GLOBAL_SUBJECT = "wordbook_ai_user", "wordbook_ai_global", "all"
DEFAULT_EXPLAIN_TEMPLATE = (
    "你是耐心的英语老师。请用简体中文为中国学习者讲解下面这个英语单词,不超过 300 字,分三点:"
    "1) 常见用法与搭配;2) 容易混淆的词或词形;3) 拼写记忆要点。只输出讲解正文。\n"
    "<word>{word}</word>\n释义:{meanings}\n例句:{example}"
)


class ExplainUnavailable(Exception):
    """kind ∈ off | user_cap | global_cap | upstream;路由一律映射为 503。"""

    def __init__(self, kind: str):
        super().__init__(kind)
        self.kind = kind


def _plain(text: str, limit: int) -> str:
    """压成一行、截断,并把尖括号换成形近字符,词典内容不能伪造边界标签。"""
    return " ".join(text.replace("<", "‹").replace(">", "›").split())[:limit]


def render_test(template: str, sample: dict[str, str]) -> list[dict]:
    values = {"word": _plain(sample.get("word", "") or "talk", 100),
              "meanings": _plain(sample.get("meanings", "") or "v. 说话", 300),
              "example": _plain(sample.get("example", ""), 300)}
    try:
        body = template.format(**values)
    except (KeyError, IndexError, ValueError):  # 发布时已校验;万一坏了回落默认,不记模板正文
        logger.warning("wordbook explain template invalid, using default")
        body = DEFAULT_EXPLAIN_TEMPLATE.format(**values)
    return [{"role": "user", "content": body}]


def render_messages(template: str, card: WordCard) -> list[dict]:
    meanings = "；".join(f"{s.pos}. {s.text}" if s.pos else s.text for s in card.senses[:4])
    example = card.examples[0].en if card.examples else ""
    return render_test(template, {"word": card.word, "meanings": meanings, "example": example})


async def explain(session, http, settings, card: WordCard, user_id: int, now, *, template: str,
                  prompt_version: int | None) -> tuple[str, bool]:
    """(讲解, 是否缓存命中)。开关关或 LLM 未配置时连缓存也不给(与 config.ai_available 一致)。
    未命中:先扣每人每日、再扣全站每日;上游失败两者都退还。"""
    if not settings.wordbook_ai_available:
        raise ExplainUnavailable("off")
    model = settings.resolved_wordbook_ai_model
    cached = await session.get(WordbookExplanation, card.key)
    # review m7:管理端发布了新提示词版本或换了模型 → 旧讲解过期,重新生成并覆盖
    if cached is not None and cached.prompt_version == prompt_version and cached.model == model[:100]:
        return cached.body, True
    day = usage.utc_day(now)
    per_user = await quota_for(session, settings, user_id, "wordbook_ai_daily_per_user", now)
    if not await usage.consume(session, USER_SCOPE, str(user_id), day, per_user):
        raise ExplainUnavailable("user_cap")
    if not await usage.consume(session, GLOBAL_SCOPE, GLOBAL_SUBJECT, day, settings.wordbook_ai_global_daily):
        await usage.refund(session, USER_SCOPE, str(user_id), day)
        raise ExplainUnavailable("global_cap")
    try:
        with metering.feature_scope("wordbook"):
            text = await llm.complete(http, settings, render_messages(template, card), model=model,
                                      max_tokens=MAX_TOKENS, temperature=TEMPERATURE)
    except llm.LlmUnavailable as e:
        await usage.refund(session, USER_SCOPE, str(user_id), day)
        await usage.refund(session, GLOBAL_SCOPE, GLOBAL_SUBJECT, day)
        logger.warning("wordbook explain unavailable kind=%s word_len=%d", e.kind, len(card.key))
        raise ExplainUnavailable("upstream") from None
    body = text.strip()[:MAX_BODY]
    if cached is not None:
        cached.body, cached.model, cached.prompt_version, cached.created_at = body, model[:100], prompt_version, now
    else:
        session.add(WordbookExplanation(word=card.key, body=body, model=model[:100], prompt_version=prompt_version,
                                        created_at=now))
    try:
        await session.commit()
    except IntegrityError:  # 并发的同词请求先写入了;两份都是合法讲解,返回自己这份
        await session.rollback()
    return body, False
