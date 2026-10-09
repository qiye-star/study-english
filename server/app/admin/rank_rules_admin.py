"""段位规则的草稿 / 校验 / 发布(管理后台 v2 spec §5.2)。读取与缓存在 app/rank/rules_store.py。

同一时刻最多一个草稿;已发布版本不可变,回滚 = 以旧版本为内容新建草稿再发布。每个写函数在本进程内串行
(`_LOCK`)、写审计并自行提交——草稿唯一与版本号递增都依赖这一点。审计不写规则正文(含提示词),只写版本号与
改动的顶层字段名。"""
import asyncio
import weakref
from datetime import date, datetime, timezone

from pydantic import ValidationError
from sqlalchemy import func, select

from app.admin import audit
from app.admin.audit import Actor
from app.core.runtime_settings import bump_revision
from app.models import AdminAudit, RankRuleSet, iso_utc
from app.rank.rules import DEFAULT_RULES, RankRules, rules_from_json, rules_json, validate_rules
from app.rank.rules_store import RulesCache, load_published, load_version, rank_rules

_LOCKS: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Lock]" = weakref.WeakKeyDictionary()


def _lock() -> asyncio.Lock:
    loop = asyncio.get_running_loop()
    lock = _LOCKS.get(loop)
    if lock is None:
        lock = _LOCKS[loop] = asyncio.Lock()
    return lock


class RulesError(Exception):
    def __init__(self, status: int, error: str, details: dict | None = None):
        super().__init__(error)
        self.status, self.error, self.details = status, error, details


def field_errors(exc: ValidationError) -> dict[str, str]:
    """pydantic errors as {"match.thresholds.2": "message"} (no input values: they may hold prompt text)."""
    return {".".join(str(p) for p in e["loc"]) or "rules": e["msg"] for e in exc.errors(include_input=False)}


def changed_sections(before: dict | None, after: dict) -> list[str]:
    if before is None:
        return sorted(after)
    return sorted(k for k in after if before.get(k) != after.get(k))


async def _draft(session) -> RankRuleSet | None:
    return await session.scalar(select(RankRuleSet).where(RankRuleSet.status == "draft")
                                .order_by(RankRuleSet.id.desc()).limit(1))


async def _based_on(session, draft: RankRuleSet) -> int | None:
    """The version a draft was copied from (kept in its creation audit row; the table has no column for it)."""
    row = await session.scalar(select(AdminAudit).where(
        AdminAudit.action == "rank.rules.draft.create", AdminAudit.target_id == str(draft.id))
        .order_by(AdminAudit.id.desc()).limit(1))
    return (row.after or {}).get("from_version") if row is not None else None


async def overview(session, cache: RulesCache) -> dict:
    version, data = await load_published(session)
    published = None
    if version is not None:
        row = await session.scalar(select(RankRuleSet).where(RankRuleSet.version == version))
        published = {"version": version, "rules": data, "published_at": iso_utc(row.published_at),
                     "published_by": row.published_by, "note": row.note}
    draft_row = await _draft(session)
    draft = None
    if draft_row is not None:
        draft = {"rules": draft_row.rules, "note": draft_row.note, "based_on": await _based_on(session, draft_row),
                 "updated_by": draft_row.created_by, "updated_at": iso_utc(draft_row.created_at)}
    rows = (await session.scalars(select(RankRuleSet).where(RankRuleSet.version.is_not(None))
                                  .order_by(RankRuleSet.version.desc()))).all()
    return {
        "published": published,
        "v0": rules_json(cache.v0()) if version is None else None,
        "draft": draft,
        "versions": [{"version": r.version, "published_at": iso_utc(r.published_at), "published_by": r.published_by,
                      "note": r.note} for r in rows],
    }


async def version_detail(session, version: int) -> dict:
    row = await session.scalar(select(RankRuleSet).where(RankRuleSet.version == version))
    if row is None:
        raise RulesError(404, "Version not found")
    return {"version": row.version, "status": row.status, "rules": row.rules, "note": row.note,
            "published_at": iso_utc(row.published_at), "published_by": row.published_by}


async def create_draft(session, actor: Actor, *, from_version: int | None, cache: RulesCache | None = None,
                       now: datetime | None = None) -> RankRuleSet:
    """Copy `from_version`, or (None) the current published version — or v0 when nothing is published."""
    now = now or datetime.now(timezone.utc)
    async with _lock():
        if await _draft(session) is not None:
            raise RulesError(409, "Draft exists")
        if from_version is not None:
            data = await load_version(session, from_version)
            if data is None:
                raise RulesError(404, "Version not found")
            based_on = from_version
        else:
            based_on, data = await load_published(session)
            if data is None:
                data = rules_json(cache.v0() if cache is not None else DEFAULT_RULES)
        row = RankRuleSet(version=None, status="draft", rules=data, note="", created_by=actor.name[:64], created_at=now)
        session.add(row)
        await session.flush()
        await audit.record(session, actor, "rank.rules.draft.create", target_type="rank_rules", target_id=row.id,
                           summary=f"from v{based_on}" if based_on else "from v0", after={"from_version": based_on})
        await session.commit()
        return row


async def save_draft(session, actor: Actor, rules: dict, note: str, *, now: datetime | None = None) -> RankRuleSet:
    now = now or datetime.now(timezone.utc)
    try:
        parsed = rules_from_json(rules)
    except ValidationError as e:
        raise RulesError(422, "Invalid rules", {"fields": field_errors(e)}) from None
    async with _lock():
        row = await _draft(session)
        if row is None:
            raise RulesError(404, "No draft")
        data = rules_json(parsed)
        sections = changed_sections(row.rules, data)
        row.rules, row.note = data, (note or "")[:200]
        row.created_by, row.created_at = actor.name[:64], now  # a draft's created_* = last saved by / at
        await audit.record(session, actor, "rank.rules.draft.save", target_type="rank_rules", target_id=row.id,
                           summary=",".join(sections) or "no changes")
        await session.commit()
        return row


async def delete_draft(session, actor: Actor) -> None:
    async with _lock():
        row = await _draft(session)
        if row is None:
            raise RulesError(404, "No draft")
        await audit.record(session, actor, "rank.rules.draft.delete", target_type="rank_rules", target_id=row.id)
        await session.delete(row)
        await session.commit()


async def draft_rules(session) -> RankRules:
    row = await _draft(session)
    if row is None:
        raise RulesError(404, "No draft")
    return rules_from_json(row.rules)


async def validate_draft(session, cache: RulesCache, today: date) -> list[str]:
    draft = await draft_rules(session)
    return validate_rules(draft, current=(await cache.current())[1], today=today)


async def publish(session, app, actor: Actor, *, reason: str, now: datetime | None = None) -> int:
    now = now or datetime.now(timezone.utc)
    cache = rank_rules(app)
    async with _lock():
        row = await _draft(session)
        if row is None:
            raise RulesError(404, "No draft")
        current_version, current_data = await load_published(session)
        current = rules_from_json(current_data) if current_data is not None else cache.v0()
        errors = validate_rules(rules_from_json(row.rules), current=current, today=now.date())
        if errors:
            raise RulesError(422, "Invalid rules", {"errors": errors})
        version = int(await session.scalar(select(func.max(RankRuleSet.version))) or 0) + 1
        old = await session.scalar(select(RankRuleSet).where(RankRuleSet.status == "published"))
        if old is not None:
            old.status = "archived"
        row.status, row.version, row.published_by, row.published_at = "published", version, actor.name[:64], now
        await bump_revision(session, "rank_rules")
        sections = changed_sections(current_data if current_data is not None else rules_json(current), row.rules)
        await audit.record(session, actor, "rank.rules.publish", target_type="rank_rules", target_id=version,
                           summary=",".join(sections) or "no changes", before={"version": current_version},
                           after={"version": version}, reason=reason)
        await session.commit()
    cache.invalidate()
    return version
