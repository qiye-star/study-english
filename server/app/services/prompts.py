"""管理后台可版本化的提示词(spec 2026-10-09-admin-console-v2 §11):注册表、校验、已发布版本缓存与语法规则接入。

只有已发布(status=published)的版本在线使用;草稿只在管理后台可见。提示词正文永不写日志与审计。
多进程:发布时 `config_revisions['prompts'] += 1`,各进程的 `watch_revisions` 回调 `invalidate()` 并重新应用语法规则。
"""
import json
import logging
import re
import string
from dataclasses import dataclass
from typing import Literal

from sqlalchemy import select

from app.core.runtime_settings import on_revision, register_startup_hook
from app.models import PromptVersion
from app.services.grammar import MAX_PROMPT_CHARS, clean_prompt, resolve_rules

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class PromptSpec:
    key: str
    label_zh: str
    kind: Literal["text", "json"]
    required: frozenset[str] = frozenset()
    boundaries: tuple[str, ...] = ()
    max_chars: int = 8000
    # False = the body is used verbatim (never str.format-ed), so braces are literal and not checked
    formatted: bool = True
    # inputs the admin "test run" form asks for (in display order)
    sample_fields: tuple[str, ...] = ()


PROMPTS: dict[str, PromptSpec] = {
    "grammar.rules": PromptSpec(
        "grammar.rules", "语法检查规则", "text", max_chars=MAX_PROMPT_CHARS, formatted=False,
        sample_fields=("text", "context")),
    "rooms.assist": PromptSpec(
        "rooms.assist", "联机助手组句", "text", frozenset({"level", "chat", "draft"}),
        ("<chat>", "</chat>", "<draft>", "</draft>"), 8000, sample_fields=("level", "chat", "draft")),
    "rooms.answer": PromptSpec(
        "rooms.answer", "@ai 公开回答", "text", frozenset({"topic", "asker", "chat", "question"}),
        ("<chat>", "</chat>", "<question>", "</question>"), 8000, sample_fields=("topic", "asker", "chat", "question")),
    "config.chat_agent_templates": PromptSpec(
        "config.chat_agent_templates", "对话情景模板", "json", max_chars=200_000),
}

_TEMPLATE_KEY = re.compile(r"^[a-z0-9-]{1,48}$")
_TEMPLATE_LIMITS = {"key": 48, "name": 60, "description": 200, "prompt": 4000}
_IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _fields(body: str) -> list[str] | None:
    """Placeholders as written (`{a}` -> "a", `{a.b}` -> "a.b", `{a:x}` -> "a:x", `{}` -> "{}"); None = bad braces."""
    try:
        parsed = list(string.Formatter().parse(body))
    except ValueError:
        return None
    out = []
    for _, name, spec, conversion in parsed:
        if name is None:
            continue
        raw = name or "{}"
        if conversion:
            raw += "!" + conversion
        if spec:
            raw += ":" + spec
        out.append(raw)
    return out


def _templates_ok(value: object) -> bool:
    if not isinstance(value, list) or not 1 <= len(value) <= 50:
        return False
    keys = set()
    for item in value:
        if not isinstance(item, dict) or set(item) != set(_TEMPLATE_LIMITS):
            return False
        for field, limit in _TEMPLATE_LIMITS.items():
            v = item[field]
            # the shipped static file has empty descriptions, so only description may be blank
            if not isinstance(v, str) or len(v) > limit or (field != "description" and not v.strip()):
                return False
        if not _TEMPLATE_KEY.match(item["key"]) or item["key"] in keys:
            return False
        keys.add(item["key"])
    return True


def validate_prompt(key: str, body: str) -> list[str]:
    """Error codes (empty list = valid). KeyError for an unknown key. The body is cleaned first."""
    spec = PROMPTS[key]
    body = clean_prompt(body)
    if not body:
        return ["empty"]
    if len(body) > spec.max_chars:
        return ["too_long"]
    if spec.kind == "json":
        try:
            value = json.loads(body)
        except ValueError:
            return ["invalid_json"]
        return [] if _templates_ok(value) else ["invalid_templates"]
    errors: list[str] = []
    if spec.formatted:
        fields = _fields(body)
        if fields is None:
            errors.append("invalid_braces")
        else:
            seen = set(fields)
            missing = sorted(spec.required - seen)
            unknown = sorted({f for f in seen if f not in spec.required or not _IDENT.match(f)})
            if missing:
                errors.append("missing_fields:" + ",".join(missing))
            if unknown:
                errors.append("unknown_fields:" + ",".join(unknown))
    errors += [f"missing_boundary:{tag}" for tag in spec.boundaries if tag not in body]
    return errors


async def published(session, key: str) -> tuple[int | None, str | None]:
    row = (await session.execute(
        select(PromptVersion.version, PromptVersion.body)
        .where(PromptVersion.key == key, PromptVersion.status == "published")
        .order_by(PromptVersion.version.desc()).limit(1)
    )).first()
    return (row[0], row[1]) if row else (None, None)


class PromptCache:
    """Published (version, body) per key; one DB read per key until `invalidate()`."""

    def __init__(self, sessionmaker):
        self._sessionmaker = sessionmaker
        self._values: dict[str, tuple[int | None, str | None]] = {}

    async def get(self, key: str) -> tuple[int | None, str | None]:
        if key not in self._values:
            async with self._sessionmaker() as session:
                self._values[key] = await published(session, key)
        return self._values[key]

    def invalidate(self) -> None:
        self._values = {}


def prompt_cache(app) -> PromptCache:
    cache = getattr(app.state, "prompt_cache", None)
    if cache is None:
        cache = PromptCache(app.state.sessionmaker)
        app.state.prompt_cache = cache

        async def refresh() -> None:
            cache.invalidate()
            await apply_grammar(app)

        on_revision(app, "prompts", refresh)
    return cache


async def apply_grammar(app) -> None:
    """Published `grammar.rules` pins app.state.grammar_rules (the settings listener then leaves it alone)."""
    _, body = await prompt_cache(app).get("grammar.rules")
    if body is not None and not validate_prompt("grammar.rules", body):
        app.state.grammar_rules = resolve_rules(app.state.settings, body)
        app.state.grammar_rules_pinned = True
        return
    if body is not None:
        logger.warning("published prompt ignored key=grammar.rules reason=invalid")
    app.state.grammar_rules_pinned = False
    try:
        app.state.grammar_rules = resolve_rules(app.state.settings, None)
    except RuntimeError as exc:  # unreadable GRAMMAR_PROMPT_FILE: keep the current rules
        logger.warning("grammar rules reload failed error=%s", type(exc).__name__)


@register_startup_hook
async def warm_prompts(app) -> None:
    prompt_cache(app)
    await apply_grammar(app)
