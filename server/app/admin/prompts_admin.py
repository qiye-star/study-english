"""提示词版本的管理逻辑(spec §11):概览、详情、草稿(一个键一个)、发布、试运行。

语义同段位规则:一个草稿;发布的版本不可变;回滚 = 从旧版本建草稿再发布。审计只记键名与版本号,
永不记提示词正文、试运行样例与输出。各写操作自己提交(发布后要在提交之后刷新缓存)。
"""
import hashlib
import hmac
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import func, select

from app.admin import audit
from app.admin.audit import Actor
from app.core import metering
from app.core.runtime_settings import bump_revision
from app.models import PromptVersion, iso_utc
from app.providers import llm
from app.rooms import assistant
from app.services import grammar
from app.services.prompts import PROMPTS, PromptSpec, apply_grammar, prompt_cache, validate_prompt
from app.wordbook import explain as wordbook_explain

TEST_MAX_TOKENS = 400
MAX_SAMPLE_CHARS = 2000
TEMPLATES_FILE = Path(__file__).resolve().parent.parent / "static_config" / "chat_agent_templates.json"


@dataclass
class PromptError(Exception):
    status: int
    error: str
    details: dict | None = field(default=None)


def _spec(key: str) -> PromptSpec:
    spec = PROMPTS.get(key)
    if spec is None:
        raise PromptError(404, "Unknown prompt")
    return spec


def spec_out(spec: PromptSpec) -> dict:
    return {"key": spec.key, "label": spec.label_zh, "kind": spec.kind, "required": sorted(spec.required),
            "optional": sorted(spec.optional), "boundaries": list(spec.boundaries), "max_chars": spec.max_chars, "formatted": spec.formatted,
            "sample_fields": list(spec.sample_fields)}


def default_body(app, key: str) -> str | None:
    """The body used when nothing is published: env/built-in grammar rules, room templates, static templates file."""
    if key == "grammar.rules":
        return grammar.resolve_rules(app.state.settings, None)
    if key == "rooms.assist":
        return assistant.DEFAULT_ASSIST_TEMPLATE  # template form of M4's prompt (G2)
    if key == "rooms.voice_translate":
        return assistant.DEFAULT_TRANSLATE_TEMPLATE
    if key == "rooms.summary":
        return assistant.DEFAULT_SUMMARY_TEMPLATE
    if key == "wordbook.explain":
        return wordbook_explain.DEFAULT_EXPLAIN_TEMPLATE
    return TEMPLATES_FILE.read_text(encoding="utf-8")


async def _draft(session, key: str) -> PromptVersion | None:
    return await session.scalar(select(PromptVersion).where(PromptVersion.key == key, PromptVersion.status == "draft"))


def draft_etag(row: PromptVersion) -> str:
    """Identifies the draft body a reviewer saw; publish must present it (review M4)."""
    return hashlib.sha256(f"{row.id}:{row.body}".encode()).hexdigest()[:32]


def _draft_out(row: PromptVersion) -> dict:
    return {"body": row.body, "note": row.note, "updated_by": row.created_by, "updated_at": iso_utc(row.created_at),
            "etag": draft_etag(row)}


def _version_out(row: PromptVersion) -> dict:
    return {"version": row.version, "status": row.status, "note": row.note, "created_by": row.created_by,
            "created_at": iso_utc(row.created_at), "published_by": row.published_by,
            "published_at": iso_utc(row.published_at) if row.published_at else None}


async def overview(session) -> list[dict]:
    out = []
    for key, spec in PROMPTS.items():
        pub = await session.scalar(select(PromptVersion).where(
            PromptVersion.key == key, PromptVersion.status == "published").order_by(PromptVersion.version.desc()).limit(1))
        out.append({"key": key, "label": spec.label_zh, "kind": spec.kind,
                    "published_version": pub.version if pub else None,
                    "published_at": iso_utc(pub.published_at) if pub and pub.published_at else None,
                    "has_draft": await _draft(session, key) is not None})
    return out


async def detail(session, app, key: str) -> dict:
    spec = _spec(key)
    rows = (await session.scalars(select(PromptVersion).where(
        PromptVersion.key == key, PromptVersion.status != "draft").order_by(PromptVersion.version.desc()))).all()
    pub = next((r for r in rows if r.status == "published"), None)
    draft = await _draft(session, key)
    return {"spec": spec_out(spec),
            "published": {"version": pub.version, "body": pub.body} if pub else None,
            "draft": _draft_out(draft) if draft else None,
            "versions": [_version_out(r) for r in rows],
            "default_body": default_body(app, key)}


async def create_draft(session, app, actor: Actor, key: str, *, from_version: int | None) -> dict:
    _spec(key)
    if await _draft(session, key) is not None:
        raise PromptError(409, "Draft exists")
    if from_version is not None:
        source = await session.scalar(select(PromptVersion).where(
            PromptVersion.key == key, PromptVersion.version == from_version))
        if source is None:
            raise PromptError(404, "Unknown version")
        body = source.body
    else:
        _, body = await prompt_cache(app).get(key)
        if body is None:
            body = default_body(app, key) or ""
    row = PromptVersion(key=key, version=None, status="draft", body=body, note="", created_by=actor.name[:64],
                        created_at=datetime.now(timezone.utc))
    session.add(row)
    await session.flush()  # the id is part of the etag
    await audit.record(session, actor, "prompt.draft.create", target_type="prompt", target_id=key,
                       after={"from_version": from_version})
    await session.commit()
    return _draft_out(row)


async def save_draft(session, actor: Actor, key: str, body: str, note: str) -> dict:
    _spec(key)
    row = await _draft(session, key)
    if row is None:
        raise PromptError(404, "No draft")
    body = grammar.clean_prompt(body)
    if "too_long" in validate_prompt(key, body):
        raise PromptError(422, "Invalid prompt", {"errors": ["too_long"]})
    row.body, row.note = body, note.strip()[:200]
    row.created_by, row.created_at = actor.name[:64], datetime.now(timezone.utc)  # a draft records its last editor
    await audit.record(session, actor, "prompt.draft.save", target_type="prompt", target_id=key)
    await session.commit()
    return _draft_out(row)


async def delete_draft(session, actor: Actor, key: str) -> None:
    _spec(key)
    row = await _draft(session, key)
    if row is None:
        raise PromptError(404, "No draft")
    await session.delete(row)
    await audit.record(session, actor, "prompt.draft.delete", target_type="prompt", target_id=key)
    await session.commit()


async def publish(session, app, actor: Actor, key: str, *, reason: str, etag: str) -> int:
    """Publishes the draft only when it is still the one the superadmin reviewed (`etag`), else 409."""
    _spec(key)
    row = await _draft(session, key)
    if row is None:
        raise PromptError(404, "No draft")
    if not hmac.compare_digest(draft_etag(row), etag or ""):
        raise PromptError(409, "Draft changed")
    errors = validate_prompt(key, row.body)
    if errors:
        raise PromptError(422, "Invalid prompt", {"errors": errors})
    last = await session.scalar(select(func.max(PromptVersion.version)).where(PromptVersion.key == key))
    previous = await session.scalars(select(PromptVersion).where(
        PromptVersion.key == key, PromptVersion.status == "published"))
    before = None
    for old in previous.all():
        old.status = "archived"
        before = {"version": old.version}
    await session.flush()  # archive before the new row takes the published slot
    version = (last or 0) + 1
    now = datetime.now(timezone.utc)
    row.version, row.status, row.body = version, "published", grammar.clean_prompt(row.body)
    row.published_by, row.published_at = actor.name[:64], now
    await bump_revision(session, "prompts")
    await audit.record(session, actor, "prompt.publish", target_type="prompt", target_id=key, summary=f"v{version}",
                       before=before, after={"version": version}, reason=reason)
    await session.commit()
    prompt_cache(app).invalidate()
    if key == "grammar.rules":
        await apply_grammar(app)
    return version


def test_messages(app, key: str, body: str, sample: dict[str, str]) -> tuple[list[dict], str, object]:
    """(messages, model, settings) for one test run; never persisted or logged."""
    settings = app.state.settings
    sample = {k: str(v)[:MAX_SAMPLE_CHARS] for k, v in sample.items()}
    if key == "grammar.rules":
        req = grammar.build_request(settings.resolved_grammar_model, grammar.clean_prompt(body),
                                    sample.get("text", "").strip() or "I has a apple.",
                                    sample.get("context", "").strip(), TEST_MAX_TOKENS)
        base_url, api_key = settings.grammar_upstream
        upstream = settings.model_copy(update={"upstream_llm_base_url": base_url, "upstream_llm_key": api_key})
        return req["messages"], settings.resolved_grammar_model, upstream
    if key.startswith("wordbook."):
        return (wordbook_explain.render_test(grammar.clean_prompt(body), sample), settings.resolved_wordbook_ai_model,
                settings)
    # same rendering as the live room socket (escaping, optional [[user]] split; G2)
    return assistant.render_test(key, grammar.clean_prompt(body), sample), settings.resolved_rooms_ai_model, settings


async def test_run(session, app, actor: Actor, key: str, body: str, sample: dict[str, str]) -> dict:
    spec = _spec(key)
    if spec.kind != "text":
        raise PromptError(400, "Test run not available")
    errors = validate_prompt(key, body)
    if errors:
        raise PromptError(422, "Invalid prompt", {"errors": errors})
    messages, model, settings = test_messages(app, key, body, sample)
    started = time.monotonic()
    try:
        with metering.feature_scope("admin"):
            output = await llm.complete(app.state.http, settings, messages, model=model,
                                        max_tokens=TEST_MAX_TOKENS, temperature=0.3, timeout=60.0)
    except llm.LlmUnavailable:
        raise PromptError(502, "Upstream unavailable") from None
    ms = int((time.monotonic() - started) * 1000)
    await audit.record(session, actor, "prompt.test", target_type="prompt", target_id=key)  # key only, no text
    await session.commit()
    return {"output": output, "ms": ms}
