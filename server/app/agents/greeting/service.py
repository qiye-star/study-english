"""Today's default conversation and daily greeting (plan 2026-10-23 R1-R8, R10, R14-R16; §5 service flow).

`ensure_today` is idempotent per user and local day: it finds or creates the day's default conversation and, unless the
trigger is `off`, the day's greeting (3 lines, one model call at most, template fallback). The greeting is written as three
assistant messages; a replay never calls the model or appends messages. Logs carry event name, status, source, error kind,
counts and ms only: never user ids, greeting text, words, persona or prompt text."""
import asyncio
import logging
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.greeting import facts as facts_mod
from app.agents.greeting import parse, prefs as prefs_mod, prompt as prompt_mod, slots as slots_mod, templates
from app.agents.personas import ID_RE, Persona, PersonaStore
from app.core.db import insert_ignore
from app.core.timing import log_timing
from app.core import metering
from app.models import ChatGreeting, Conversation, Message, new_uuid
from app.providers import llm
from app.services import prompts as prompts_mod, usage
from app.services.stats import as_utc, local_date

logger = logging.getLogger(__name__)

PROMPT_KEY = "chat.daily_greeting"
SCOPE_GREETING_USER = "chat_greeting"
SCOPE_GREETING_GLOBAL = "chat_greeting_global"
GLOBAL_SUBJECT = "all"
PENDING_STALE_SECONDS = 60
MAX_TOKENS = 600
TEMPERATURE = 0.8
# keys are snake_case: the web ApiClient snake_cases config keys on save, so camelCase here would be rewritten later
DAILY_CONFIG_DEFAULTS = {"auto_speak": True, "bilingual": False}


@dataclass
class Today:
    local_date: date
    status: str  # ready / pending / off
    conversation: Conversation
    greeting: dict | None


@dataclass(frozen=True)
class Generated:
    lines: list[dict]
    source: str  # llm / template
    error_kind: str | None
    prompt_version: int | None


def language_config(language: str) -> dict:
    """Chat-side language effect (R7): English replies stay; zh / bilingual add the Chinese note, bilingual translates."""
    if language == "en":
        return {"bilingual": False}
    return {"zh_note": "always", "bilingual": language == "bilingual"}


def daily_config(language: str, persona_id: str | None) -> dict:
    config = {**DAILY_CONFIG_DEFAULTS, **language_config(language)}
    if persona_id:
        config["agent_persona_id"] = persona_id
    return config


async def resolve_persona(session: AsyncSession, user_id: int, wanted: str) -> Persona | None:
    """The preferred persona, else builtin:partner, else None (R10). A missing or disabled one never rewrites the prefs."""
    store = PersonaStore(session)
    for persona_id in dict.fromkeys((wanted, prefs_mod.DEFAULT_PERSONA_ID)):
        if not ID_RE.fullmatch(persona_id):
            continue
        persona = await store.get(user_id, persona_id)
        if persona is not None and not persona.disabled:
            return persona
    return None


async def _daily_conversation(session: AsyncSession, user_id: int, day: date, config: dict, now: datetime) -> Conversation:
    where = (Conversation.user_id == user_id, Conversation.daily_date == day)
    row = await session.scalar(select(Conversation).where(*where))
    if row is not None:
        return row
    # the unique (user_id, daily_date) makes a concurrent insert a no-op; the default chat never counts toward the cap (R12)
    await session.execute(insert_ignore(session, Conversation).values(
        id=new_uuid(), user_id=user_id, name=day.isoformat(), config=config, daily_date=day, created_at=now,
        updated_at=now))
    await session.commit()
    return await session.scalar(select(Conversation).where(*where))


async def load_template(app) -> tuple[str, int | None]:
    """(template, published version | None). An invalid published body is ignored (no body in the log)."""
    version, body = await prompts_mod.prompt_cache(app).get(PROMPT_KEY)
    if body is None:
        return prompt_mod.DEFAULT_GREETING_TEMPLATE, None
    try:
        invalid = bool(prompts_mod.validate_prompt(PROMPT_KEY, body))
        body.format(persona="", language_rule="", facts="")
    except (KeyError, IndexError, ValueError):
        invalid = True
    if invalid:
        logger.warning("published prompt ignored key=%s reason=invalid", PROMPT_KEY)
        return prompt_mod.DEFAULT_GREETING_TEMPLATE, None
    return body, version


def _local_now(now: datetime, offset: int) -> datetime:
    return as_utc(now).replace(tzinfo=None) + timedelta(minutes=offset)


async def generate(app, session: AsyncSession, *, user_id: int, day: date, language: str, persona: Persona | None,
                   facts: facts_mod.GreetingFacts, include_stats: bool, offset: int, now: datetime) -> Generated:
    """One model call at most; any failure falls back to the template (and gives the quota back)."""
    settings = app.state.settings
    local_now = _local_now(now, offset)

    def fallback(kind: str) -> Generated:
        lines = templates.template_lines(language, facts, include_stats=include_stats, local_now=local_now,
                                         user_id=user_id)
        return Generated(lines, "template", kind, None)

    if not settings.chat_greeting_llm_enabled:
        return fallback("off")
    if not settings.upstream_llm_base_url:
        return fallback("config")
    user_day, utc_day = day.isoformat(), usage.utc_day(now)
    if not await usage.consume(session, SCOPE_GREETING_USER, str(user_id), user_day, 1):
        return fallback("quota")
    if not await usage.consume(session, SCOPE_GREETING_GLOBAL, GLOBAL_SUBJECT, utc_day, settings.chat_greeting_global_daily):
        await usage.refund(session, SCOPE_GREETING_USER, str(user_id), user_day)
        return fallback("quota")

    async def give_back() -> None:
        await usage.refund(session, SCOPE_GREETING_USER, str(user_id), user_day)
        await usage.refund(session, SCOPE_GREETING_GLOBAL, GLOBAL_SUBJECT, utc_day)

    try:
        template, version = await load_template(app)
        messages = prompt_mod.render_messages(template, persona, language, facts, local_now, include_stats=include_stats)
        timeout = float(settings.chat_greeting_timeout_seconds)
        with metering.feature_scope("chat_greeting"):
            raw = await asyncio.wait_for(
                llm.complete(app.state.http, settings, messages, model=settings.resolved_chat_greeting_model,
                             max_tokens=MAX_TOKENS, temperature=TEMPERATURE, timeout=timeout), timeout)
        lines = parse.parse(raw, language, slots_mod.build(facts, include_stats, language))
    except llm.LlmUnavailable as exc:
        await give_back()
        return fallback(exc.kind)
    except TimeoutError:
        await give_back()
        return fallback("timeout")
    except parse.GreetingInvalid as exc:
        logger.info("chat greeting rejected reason=%s", exc.reason)  # a short rule code, never text
        await give_back()
        return fallback("invalid")
    except BaseException:  # cancelled (client gone) or a bug: nothing was delivered, so the allowance returns
        await give_back()
        raise
    return Generated(lines, "llm", None, version)


def _add_messages(session: AsyncSession, conversation: Conversation, lines: list[dict], now: datetime) -> list[str]:
    """Three assistant messages in order (created_at +1 ms each; the list sorts by created_at, id)."""
    ids = []
    for index, line in enumerate(lines):
        ids.append(new_uuid())
        session.add(Message(id=ids[-1], conversation_id=conversation.id, role="assistant",
                            content=parse.message_text(line), created_at=now + timedelta(milliseconds=index)))
    conversation.updated_at = now + timedelta(milliseconds=len(lines) - 1)
    return ids


async def restore_lines(session: AsyncSession, row: ChatGreeting, conversation: Conversation, now: datetime) -> None:
    """The day's conversation changed (deleted and rebuilt): write the stored lines back, no model call (R4)."""
    row.message_ids = _add_messages(session, conversation, row.lines, now)
    row.conversation_id, row.updated_at = conversation.id, now
    await session.commit()


def greeting_out(row: ChatGreeting, prefs: prefs_mod.Prefs) -> dict:
    return {"id": row.id, "message_ids": list(row.message_ids), "source": row.source, "language": row.language,
            "generated_at": _iso(row.created_at), "lines": row.lines,
            "facts": dict(row.facts) if prefs.include_stats and isinstance(row.facts, dict) else {},
            "first_view": row.first_seen_at is None}


def _iso(value: datetime) -> str:
    return as_utc(value).isoformat().replace("+00:00", "Z")


async def _claim(session: AsyncSession, user_id: int, day: date, language: str, persona_id: str, now: datetime):
    """(row, mine). The insert wins or loses atomically; a pending row older than 60 s is taken over (R5)."""
    where = (ChatGreeting.user_id == user_id, ChatGreeting.local_date == day)
    row = await session.scalar(select(ChatGreeting).where(*where))
    if row is None:
        inserted = await session.execute(insert_ignore(session, ChatGreeting).values(
            id=new_uuid(), user_id=user_id, local_date=day, status="pending", language=language, persona_id=persona_id,
            message_ids=[], lines=[], facts={}, created_at=now, updated_at=now))
        await session.commit()
        row = await session.scalar(select(ChatGreeting).where(*where))
        return row, bool(inserted.rowcount)
    if row.status == "pending":
        cutoff = now - timedelta(seconds=PENDING_STALE_SECONDS)
        taken = await session.execute(update(ChatGreeting).where(
            ChatGreeting.id == row.id, ChatGreeting.status == "pending", ChatGreeting.updated_at < cutoff)
            .values(updated_at=now, language=language, persona_id=persona_id)
            .execution_options(synchronize_session=False))  # SQLite hands back naive datetimes: no in-Python criteria
        await session.commit()
        if taken.rowcount:
            await session.refresh(row)
            return row, True
    return row, False


async def ensure_today(app, session: AsyncSession, user_id: int, offset: int, now: datetime) -> Today:
    prefs = await prefs_mod.load(session, user_id)
    day = local_date(now, offset)
    settings = app.state.settings
    persona = await resolve_persona(session, user_id, prefs.daily_persona_id)
    persona_id = persona.id if persona is not None else None
    config = daily_config(prefs.language, persona_id if settings.agents_enabled else None)
    conversation = await _daily_conversation(session, user_id, day, config, now)
    if prefs.greeting_trigger == "off":  # the empty default chat still exists every day (user ruling), nothing else
        return Today(day, "off", conversation, None)

    row, mine = await _claim(session, user_id, day, prefs.language, persona_id or prefs_mod.DEFAULT_PERSONA_ID, now)
    if row.status == "ready":
        if row.conversation_id != conversation.id:
            await restore_lines(session, row, conversation, now)
        return Today(day, "ready", conversation, greeting_out(row, prefs))
    if not mine:
        return Today(day, "pending", conversation, None)

    started = time.perf_counter()
    facts = facts_mod.GreetingFacts()
    if prefs.include_stats:
        facts = await facts_mod.gather(app, facts_mod.FactCtx(user_id, offset, now, day))
    result = await generate(app, session, user_id=user_id, day=day, language=prefs.language, persona=persona, facts=facts,
                            include_stats=prefs.include_stats, offset=offset, now=now)
    reason = parse.check_lines(result.lines, prefs.language)
    if reason:  # a programming error, never model output (the parser already checked it)
        raise parse.GreetingInvalid(reason)
    # lines, message ids and the ready flag land in one transaction: readers never see half a greeting (R5)
    message_ids = _add_messages(session, conversation, result.lines, now)
    await session.execute(update(ChatGreeting).where(ChatGreeting.id == row.id).values(
        status="ready", source=result.source, language=prefs.language, lines=result.lines, message_ids=message_ids,
        prompt_version=result.prompt_version, facts=facts.numbers() if prefs.include_stats else {},
        error_kind=result.error_kind, conversation_id=conversation.id, updated_at=now))
    await session.commit()
    await session.refresh(row)
    log_timing("chat_greeting", status="ready", source=result.source, error=result.error_kind or "-",
               lines=len(result.lines), ms=round((time.perf_counter() - started) * 1000), facts=len(row.facts))
    return Today(day, "ready", conversation, greeting_out(row, prefs))


async def mark_seen(session: AsyncSession, user_id: int, greeting_id: str, now: datetime) -> datetime | None:
    """Set first_seen_at once (idempotent). None when the greeting is not the user's."""
    row = await session.scalar(select(ChatGreeting).where(ChatGreeting.id == greeting_id, ChatGreeting.user_id == user_id))
    if row is None:
        return None
    if row.first_seen_at is None:
        await session.execute(update(ChatGreeting).where(ChatGreeting.id == row.id, ChatGreeting.first_seen_at.is_(None))
                              .values(first_seen_at=now))
        await session.commit()
        await session.refresh(row)
    return row.first_seen_at
