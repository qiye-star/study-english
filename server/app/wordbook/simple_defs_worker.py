"""简单英英释义的后台改写(计划 2026-10-27 R-S5 / R-S6 / R-S7 / R-S10)。

读路径(`simple_defs.SimpleDefs.apply`)只把需要改写的释义放进队列;这里的单协程按批(每批 <= 20 条)处理:
1. 第一层:来源(`simple_sources`,如 Simple English Wiktionary)已有且通过校验的 -> 直接写 ok(model 记为 `source:<名>`),
   不调用模型、不占每日额度;
2. 其余:一次 `llm.complete` 改写(温度 0.2,max_tokens 900),按序号对回,校验后写库并更新内存镜像。
用户看到的始终是原文,直到改写成功;这里的任何失败都不影响读路径。

- 两次模型调用之间等 3 秒。
- 额度:`wordbook_simple_defs_daily` 次调用 / 全站 / 每天(计入用量,`usage.consume`);0 = 不限制(仍计入用量)。
- 失败:LLM 不可用 -> 本批 failed、退还额度、暂停 10 分钟;JSON 不合法 -> 本批 failed(额度不退);
  failed 的重试间隔 1 h × 2^(attempts-1),到 3 次不再自动重试。
- 校验(每条独立):压成一行、去一个末尾句号、首字母小写(R-DS19 的规则);<= 16 个词;不含汉字和尖括号;
  不含词头或其词形;难词数必须少于原文。不通过 -> skip(永久用原文)。
- 日志只记批大小与计数和异常种类;不记词、原文、改写文本或提示词正文。"""
import asyncio
import json
import logging
import re
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.core import metering
from app.models import WordbookSimpleDef
from app.providers import llm
from app.services import usage
from app.services.prompts import prompt_cache
from app.wordbook.simple_defs import (RETRY_LIMIT, SimpleDefs, SimpleRow, hard_count, simple_of, src_hash)

logger = logging.getLogger(__name__)

PROMPT_KEY = "wordbook.simplify_defs"
BATCH = 20
MAX_TOKENS = 900
TEMPERATURE = 0.2
MAX_WORDS = 16
IDLE_SECONDS = 5.0
GAP_SECONDS = 3.0  # between two model calls
PAUSE_SECONDS = 600.0  # after an upstream failure
RELOAD_SECONDS = 600.0  # cache rows are re-read this often (other worker processes write too)
UNLIMITED = 10**9
USAGE_SCOPE, USAGE_SUBJECT = "wordbook_simplify", "all"
DEFAULT_TEMPLATE = (
    "Rewrite each dictionary definition below in simple English for a Chinese learner at A2-B1 level. "
    "Use only common words. Do not use the headword or its forms. At most 16 words. Keep the meaning and the "
    "part of speech. Reply with JSON only: an object with an \"items\" list; each item has the \"id\" number "
    "given in its tag and the rewritten \"text\".\n{items}"
)
_CJK = re.compile(r"[㐀-鿿豈-﫿]")
_LETTERS = re.compile(r"[a-z]+")
_ATTR_STRIP = re.compile(r"[^a-z' -]")


@dataclass
class _State:
    paused_until: float = 0.0


def _state(app) -> _State:
    found = getattr(app.state, "simple_defs_state", None)
    if found is None:
        found = app.state.simple_defs_state = _State()
    return found


# ---------------------------------------------------------------- pure helpers (no I/O, no logging)

def render_items(template: str, items: list[tuple[str, str, str]]) -> str:
    """`items` = [(word, pos, original text)]. Tags carry the batch index; the brackets in the text are replaced
    so the dictionary text cannot forge a tag."""
    rows = []
    for i, (word, pos, text) in enumerate(items):
        plain = " ".join(text.replace("<", "‹").replace(">", "›").split())[:400]
        rows.append(f'<item id={i} word="{_ATTR_STRIP.sub("", word.lower())}" pos="{pos}">{plain}</item>')
    body = "\n".join(rows)
    try:
        return template.format(items=body)
    except (KeyError, IndexError, ValueError):  # published at a bad version: fall back, never log the template
        return DEFAULT_TEMPLATE.format(items=body)


def parse_reply(reply: str, n: int) -> dict[int, str] | None:
    """{batch index: text}, or None when the reply is not the JSON object we asked for."""
    raw = (reply or "").strip()
    start, end = raw.find("{"), raw.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        data = json.loads(raw[start:end + 1])
    except ValueError:
        return None
    items = data.get("items") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return None
    out: dict[int, str] = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        ident, text = item.get("id"), item.get("text")
        if isinstance(ident, int) and not isinstance(ident, bool) and 0 <= ident < n and isinstance(text, str):
            out.setdefault(ident, text)
    return out


def _lower_first(text: str) -> str:
    words = text.split(" ")
    first = words[0] if words else ""
    if not first or not first[0].isupper() or (len(first) > 1 and first[1].isupper()) or first == "I":
        return text
    if any(w[:1].isupper() for w in words[1:]):  # another capitalised word (a name): keep the case
        return text
    return first[0].lower() + first[1:] + text[len(first):]


def check_rewrite(new_text: str, word: str, original: str, *, easy: frozenset[str], lemma_of) -> str | None:
    """The checked text, or None (skip). Rules R-S6."""
    text = " ".join(new_text.split())
    if text.endswith("."):
        text = text[:-1]
    text = _lower_first(text)
    if not text or len(text.split()) > MAX_WORDS or _CJK.search(text) or "<" in text or ">" in text:
        return None
    head = (word or "").strip().lower()
    head_parts = set(head.split())
    for token in _LETTERS.findall(text.lower()):
        if token == head or token in head_parts or lemma_of(token) == head:
            return None
    if hard_count(text, word, easy=easy, lemma_of=lemma_of) >= hard_count(original, word, easy=easy, lemma_of=lemma_of):
        return None
    return text


def judge(reply: str, items: list[tuple[str, str, str]], *, easy: frozenset[str], lemma_of) -> list[tuple[str, str | None]]:
    """Per item: ("ok", text) | ("skip", None) | ("failed", None). A reply that is not JSON fails the whole batch."""
    parsed = parse_reply(reply, len(items))
    if parsed is None:
        return [("failed", None)] * len(items)
    out: list[tuple[str, str | None]] = []
    for i, (word, _pos, original) in enumerate(items):
        new = parsed.get(i)
        checked = None if new is None else check_rewrite(new, word, original, easy=easy, lemma_of=lemma_of)
        out.append(("ok", checked) if checked else ("skip", None))
    return out


def _prompt_messages(template: str, items) -> list[dict]:
    return [{"role": "user", "content": render_items(template, items)}]


# ---------------------------------------------------------------- the worker

async def _reload(app) -> None:
    try:
        await simple_of(app).warm(app.state.sessionmaker)
    except Exception as e:  # e.g. the table is missing on an old database: reads keep the originals
        logger.warning("simple defs warm failed kind=%s", type(e).__name__)


async def warm(app) -> None:
    """Startup (lifespan): cached rows into memory before the first request."""
    await _reload(app)


def _drop_done(simple: SimpleDefs) -> None:
    for key in list(simple.queue):
        row = simple.rows.get(key)
        if row is not None and (row.status in ("ok", "skip") or row.attempts >= RETRY_LIMIT):
            simple.queue.pop(key, None)


async def _from_sources(simple: SimpleDefs, taken) -> dict:
    """{key: (checked text, source name)} for the items a first-layer source answers well."""
    for source in simple.sources:
        await asyncio.to_thread(source.prepare)
    out: dict = {}
    for key, word, pos, text in taken:
        for source in simple.sources:
            candidate = source.simple_text(word, pos)
            checked = None if candidate is None else check_rewrite(
                candidate, word, text, easy=simple.easy, lemma_of=simple.lemma_of)
            if checked:
                out[key] = (checked, source.name)
                break
    return out


async def _write(app, simple: SimpleDefs, entries, *, version: int | None, now: datetime) -> None:
    """entries: [(key, status, text, attempts, retry_after, model)]. Memory is updated even if the write fails."""
    try:
        async with app.state.sessionmaker() as session:
            for key, status, text, attempts, retry_after, model in entries:
                word, pos, digest = key
                row = await session.scalar(select(WordbookSimpleDef).where(
                    WordbookSimpleDef.word == word, WordbookSimpleDef.pos == pos, WordbookSimpleDef.src_hash == digest))
                if row is None:
                    session.add(WordbookSimpleDef(word=word, pos=pos, src_hash=digest, text=text, status=status,
                                                  attempts=attempts, retry_after=retry_after, model=model[:100],
                                                  prompt_version=version, created_at=now, updated_at=now))
                else:
                    row.text, row.status, row.attempts = text, status, attempts
                    row.retry_after, row.model, row.prompt_version, row.updated_at = retry_after, model[:100], version, now
            await session.commit()
    except Exception as e:
        logger.warning("simple defs write failed kind=%s", type(e).__name__)
    for key, status, text, attempts, retry_after, _model in entries:
        simple.rows[key] = SimpleRow(status, text, attempts, retry_after)


def _failed_entries(simple: SimpleDefs, keys, now: datetime, model: str) -> list:
    out = []
    for key in keys:
        prev = simple.rows.get(key)
        attempts = (prev.attempts if prev else 0) + 1
        out.append((key, "failed", None, attempts, now + timedelta(hours=2 ** (attempts - 1)), model))
    return out


async def run_once(app, *, now: datetime | None = None) -> int:
    """One pass. Returns the work done: model calls made plus items answered by a source (0 = idle, paused,
    capped, disabled or no upstream)."""
    simple = simple_of(app)
    settings = app.state.settings
    state = _state(app)
    mono = time.monotonic()
    if not simple.loaded or mono - simple.loaded_at > RELOAD_SECONDS:
        await _reload(app)
    if not simple.generating() or mono < state.paused_until:
        return 0
    _drop_done(simple)
    if not simple.queue:
        return 0
    now = now or datetime.now(timezone.utc)
    taken = [(key, *simple.queue.pop(key)) for key in list(simple.queue)[:BATCH]]  # (key, word, pos, text)
    answered = await _from_sources(simple, taken)
    if answered:
        await _write(app, simple, [(key, "ok", text, 0, None, f"source:{name}")
                                   for key, (text, name) in answered.items()], version=None, now=now)
    rest = [item for item in taken if item[0] not in answered]
    if not rest:
        return len(answered)
    cap = settings.wordbook_simple_defs_daily or UNLIMITED
    day = usage.utc_day(now)
    async with app.state.sessionmaker() as session:
        allowed = await usage.consume(session, USAGE_SCOPE, USAGE_SUBJECT, day, cap)
    if not allowed:  # back to the queue; try again later (the cap is per UTC day)
        for key, word, pos, text in rest:
            simple.queue[key] = (word, pos, text)
        state.paused_until = mono + PAUSE_SECONDS
        logger.info("simple defs daily cap reached")
        return len(answered)
    items = [(word, pos, text) for _key, word, pos, text in rest]
    keys = [key for key, *_ in rest]
    version, body = await prompt_cache(app).get(PROMPT_KEY)
    model = settings.resolved_wordbook_ai_model
    try:
        with metering.feature_scope("wordbook"):
            reply = await llm.complete(app.state.http, settings, _prompt_messages(body or DEFAULT_TEMPLATE, items),
                                       model=model, max_tokens=MAX_TOKENS, temperature=TEMPERATURE)
    except llm.LlmUnavailable as e:
        async with app.state.sessionmaker() as session:
            await usage.refund(session, USAGE_SCOPE, USAGE_SUBJECT, day)
        await _write(app, simple, _failed_entries(simple, keys, now, model), version=version, now=now)
        state.paused_until = mono + PAUSE_SECONDS
        logger.warning("simple defs batch failed kind=%s batch=%d", e.kind, len(items))
        return 1 + len(answered)
    verdicts = judge(reply, items, easy=simple.easy, lemma_of=simple.lemma_of)
    if all(status == "failed" for status, _ in verdicts):
        entries = _failed_entries(simple, keys, now, model)
    else:
        entries = [(key, status, text, 0, None, model) for key, (status, text) in zip(keys, verdicts)]
    await _write(app, simple, entries, version=version, now=now)
    counts = {s: sum(1 for st, _ in verdicts if st == s) for s in ("ok", "skip", "failed")}
    logger.info("simple defs batch size=%d ok=%d skip=%d failed=%d", len(items), counts["ok"], counts["skip"],
                counts["failed"])
    return 1 + len(answered)


async def loop(app) -> None:
    """The single background coroutine (lifespan task `simple_defs`); cancelled at shutdown."""
    while True:
        try:
            work = await run_once(app)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.warning("simple defs worker error kind=%s", type(e).__name__)
            work = 0
        await asyncio.sleep(GAP_SECONDS if work else IDLE_SECONDS)
