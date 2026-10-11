"""管理端「智能体」(spec 2026-10-12-agents §10.2;计划 R-C12、R-C23、R-C26):总览(开关、工具方式与探测、7 天计数、
今日调用、角色与举报计数,无任何内容)、角色查询(含人设原文,仅供审核)、停用 / 恢复 / 编辑 / 删除、举报处理、函数调用探测。
管理员读不到任何记忆内容(A2 只追加计数)。审计只记角色 id、动作、改动的字段名与计数,永不记录名称、简介或人设原文。"""
from datetime import datetime, timedelta

from sqlalchemy import case, delete, func, or_, select

from app.admin import audit
from app.agents import limits
from app.agents.personas import ADMIN_EDITABLE, PersonaInvalid, clean_persona
from app.models import (
    AgentPersona, AgentPersonaReport, AgentUserSettings, UpstreamCall, User, iso_utc, utcnow,
)
from app.models import DailyUsage
from app.providers import llm
from app.services import usage

PAGE_SIZE = 50
REPORTS_LIMIT = 100


class AgentsAdminError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def _like(q: str) -> str:
    return "%" + q.lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def persona_row(row: AgentPersona, owner: str | None, reports_open: int) -> dict:
    return {"id": row.id, "owner_id": row.owner_id, "owner": owner, "name": row.name, "intro": row.intro or "",
            "prompt": row.prompt, "level": row.level, "style": row.style, "tools": list(row.tools or []),
            "prompt_public": bool(row.prompt_public), "deep_think": bool(row.deep_think),
            "disabled": row.disabled_at is not None,
            "disabled_at": iso_utc(row.disabled_at) if row.disabled_at else None,
            "created_at": iso_utc(row.created_at), "updated_at": iso_utc(row.updated_at),
            "reports_open": int(reports_open or 0)}


def _open_counts():
    return (select(AgentPersonaReport.persona_id.label("persona_id"), func.count().label("n"))
            .where(AgentPersonaReport.resolved_at.is_(None)).group_by(AgentPersonaReport.persona_id).subquery())


async def personas(session, *, q: str | None, status: str, page: int) -> dict:
    counts = _open_counts()
    n = func.coalesce(counts.c.n, 0)
    query = (select(AgentPersona, User.username, n)
             .outerjoin(User, User.id == AgentPersona.owner_id)
             .outerjoin(counts, counts.c.persona_id == AgentPersona.id))
    if q:
        pattern = _like(q)
        query = query.where(or_(*(func.lower(col).like(pattern, escape="\\")
                                  for col in (AgentPersona.name, AgentPersona.intro, AgentPersona.prompt))))
    if status == "active":
        query = query.where(AgentPersona.disabled_at.is_(None))
    elif status == "disabled":
        query = query.where(AgentPersona.disabled_at.is_not(None))
    elif status == "reported":
        query = query.where(n > 0)
    rows = (await session.execute(query.order_by(AgentPersona.created_at.desc(), AgentPersona.id.desc())
                                  .offset((page - 1) * PAGE_SIZE).limit(PAGE_SIZE + 1))).all()
    return {"items": [persona_row(p, owner, count) for p, owner, count in rows[:PAGE_SIZE]], "page": page,
            "next": page + 1 if len(rows) > PAGE_SIZE else None}


async def _get(session, persona_id: str) -> AgentPersona:
    row = await session.get(AgentPersona, persona_id)
    if row is None:
        raise AgentsAdminError(404, "Persona not found")
    return row


async def set_disabled(session, actor, persona_id: str, *, disabled: bool, reason: str, now: datetime) -> dict:
    row = await _get(session, persona_id)
    if (row.disabled_at is not None) == disabled:
        raise AgentsAdminError(409, "Persona already disabled" if disabled else "Persona is not disabled")
    row.disabled_at = now if disabled else None
    await audit.record(session, actor, "agents.persona.disable" if disabled else "agents.persona.restore",
                       target_type="agent_persona", target_id=row.id, reason=reason)
    await session.commit()
    return {"id": row.id, "disabled": disabled}


async def edit(session, actor, persona_id: str, changes: dict, *, reason: str, max_prompt_chars: int,
               now: datetime) -> dict:
    row = await _get(session, persona_id)
    if not changes:
        raise AgentsAdminError(422, "Nothing to update")
    if any(key not in ADMIN_EDITABLE for key in changes):
        raise AgentsAdminError(422, "Invalid unknown")
    try:
        clean = clean_persona(changes, max_prompt_chars=max_prompt_chars, partial=True)
    except PersonaInvalid as e:
        raise AgentsAdminError(422, f"Invalid {e.field}") from None
    for key, value in clean.items():
        setattr(row, key, value)
    row.updated_at = now
    await audit.record(session, actor, "agents.persona.edit", target_type="agent_persona", target_id=row.id,
                       after={"fields": sorted(clean)}, reason=reason)
    await session.commit()
    owner = await session.scalar(select(User.username).where(User.id == row.owner_id))
    count = await session.scalar(select(func.count()).select_from(AgentPersonaReport).where(
        AgentPersonaReport.persona_id == row.id, AgentPersonaReport.resolved_at.is_(None)))
    return persona_row(row, owner, count or 0)


async def remove(session, actor, persona_id: str, *, reason: str) -> dict:
    row = await _get(session, persona_id)
    await session.execute(delete(AgentPersonaReport).where(AgentPersonaReport.persona_id == row.id))
    await session.delete(row)
    await audit.record(session, actor, "agents.persona.delete", target_type="agent_persona", target_id=persona_id,
                       reason=reason)
    await session.commit()
    return {"id": persona_id}


async def reports(session) -> list[dict]:
    """待处理举报按角色合并,次数多的在前。"""
    rows = (await session.execute(
        select(AgentPersonaReport.persona_id, AgentPersona.name, User.username, AgentPersona.disabled_at,
               func.count(), func.min(AgentPersonaReport.created_at), func.max(AgentPersonaReport.created_at))
        .join(AgentPersona, AgentPersona.id == AgentPersonaReport.persona_id)
        .outerjoin(User, User.id == AgentPersona.owner_id)
        .where(AgentPersonaReport.resolved_at.is_(None))
        .group_by(AgentPersonaReport.persona_id, AgentPersona.name, User.username, AgentPersona.disabled_at)
        .order_by(func.count().desc(), func.max(AgentPersonaReport.created_at).desc())
        .limit(REPORTS_LIMIT))).all()
    reasons: dict[str, dict[str, int]] = {}
    for persona_id, reason, count in (await session.execute(
            select(AgentPersonaReport.persona_id, AgentPersonaReport.reason, func.count())
            .where(AgentPersonaReport.resolved_at.is_(None))
            .group_by(AgentPersonaReport.persona_id, AgentPersonaReport.reason))).all():
        reasons.setdefault(persona_id, {})[reason] = int(count)
    return [{"persona_id": pid, "name": name, "owner": owner, "count": int(count),
             "reasons": dict(sorted(reasons.get(pid, {}).items())), "first_at": iso_utc(first),
             "last_at": iso_utc(last), "disabled": disabled_at is not None}
            for pid, name, owner, disabled_at, count, first, last in rows]


async def resolve(session, actor, persona_id: str, *, action: str, reason: str, now: datetime) -> dict:
    rows = (await session.scalars(select(AgentPersonaReport).where(
        AgentPersonaReport.persona_id == persona_id, AgentPersonaReport.resolved_at.is_(None)))).all()
    if not rows:
        raise AgentsAdminError(404, "No open reports")
    resolution = "disabled" if action == "disable" else "dismissed"
    for row in rows:
        row.resolved_at, row.resolved_by, row.resolution = now, actor.name[:64], resolution
    if action == "disable":
        persona = await session.get(AgentPersona, persona_id)
        if persona is not None and persona.disabled_at is None:
            persona.disabled_at = now
    await audit.record(session, actor, "agents.report.resolve", target_type="agent_persona", target_id=persona_id,
                       after={"action": action, "count": len(rows)}, reason=reason)
    await session.commit()
    return {"persona_id": persona_id, "resolved": len(rows), "action": action}


async def _per_day(session, scope: str, days: list[str]) -> list[int]:
    rows = dict((await session.execute(
        select(DailyUsage.day, func.sum(DailyUsage.count))
        .where(DailyUsage.scope == scope, DailyUsage.day.in_(days)).group_by(DailyUsage.day))).all())
    return [int(rows.get(day) or 0) for day in days]


async def overview(session, app, now: datetime) -> dict:
    s = app.state.settings
    probe = getattr(app.state, "agents_tools_probe", None)
    days = [usage.utc_day(now - timedelta(days=i)) for i in range(6, -1, -1)]
    turns = await _per_day(session, limits.SCOPE_TURNS_GLOBAL, days)
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    calls, errors, tokens_in, tokens_out = (await session.execute(
        select(func.count(),
               func.coalesce(func.sum(case((UpstreamCall.status.between(200, 299), 0), else_=1)), 0),
               func.coalesce(func.sum(case((UpstreamCall.unit == "tokens", UpstreamCall.units_in), else_=0)), 0),
               func.coalesce(func.sum(case((UpstreamCall.unit == "tokens", UpstreamCall.units_out), else_=0)), 0))
        .where(UpstreamCall.feature == "agents", UpstreamCall.at >= start))).one()
    count = lambda *where: session.scalar(select(func.count()).select_from(where[0]).where(*where[1:]))  # noqa: E731
    return {
        "switches": {"enabled": s.agents_enabled, "tutor": s.agents_tutor_enabled, "memory": s.agents_memory_enabled,
                     "rooms": s.agents_rooms_enabled},
        "available": s.agents_available,
        "tools_mode": {"configured": s.agents_tools_mode, "effective": limits.effective_tools_mode(s, probe),
                       "probe": probe},
        "limits": {"turns_global_daily": s.agents_turns_global_daily,
                   "turns_daily_per_user": s.agents_turns_daily_per_user,
                   "tutor_daily_per_user": s.agents_tutor_daily_per_user,
                   "memory_extract_daily_per_user": s.agents_memory_extract_daily_per_user,
                   "personas_max": s.agents_personas_max},
        "usage": {"days": days, "turns": turns,
                  "tutor": await _per_day(session, limits.SCOPE_TUTOR_USER, days),
                  "memory": await _per_day(session, limits.SCOPE_MEMORY_USER, days),
                  "today": {"turns": turns[-1], "calls": int(calls or 0), "errors": int(errors or 0),
                            "tokens_in": int(tokens_in or 0), "tokens_out": int(tokens_out or 0)}},
        "personas": {"total": int(await count(AgentPersona) or 0),
                     "disabled": int(await count(AgentPersona, AgentPersona.disabled_at.is_not(None)) or 0),
                     "reports_open": int(await count(AgentPersonaReport, AgentPersonaReport.resolved_at.is_(None)) or 0)},
        "users_with_settings": int(await count(AgentUserSettings) or 0),
        # "memory_counts": reserved (INDEX X9): wired by the last A2-S task via app.agents.memory.store.memory_counts
        # (numbers only; admins never read memory content, X20).
    }


async def probe_tools(session, app, actor) -> dict:
    """先调上游(不持有审计锁),再写审计并提交(admin/CLAUDE.md:审计与提交之间不等上游)。"""
    s = app.state.settings
    model = s.resolved_agents_model
    result = await llm.probe_tools(app.state.http, s, model=model)
    out = {**result.out(), "at": iso_utc(utcnow()), "model": model[:64]}
    app.state.agents_tools_probe = out
    await audit.record(session, actor, "agents.probe.tools", target_type="upstream", target_id="llm",
                       after={"ok": result.ok, "code": result.code})
    await session.commit()
    return out
