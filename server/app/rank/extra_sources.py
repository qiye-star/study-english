"""段位的联动来源(spec 2026-10-11-learning-links §5.3–5.4)。只经 app.models.LinkCredit 读;不导入 app.links。

既有种类的点数永远不因联动而变少:联动来源不进 cap_daily,只吃当天共享上限的剩余额度,并另有子上限。
联动来源不产生活跃日、不计入阶段任务(它们的种类不在 points.CAPPED / 阶段任务种类里)。"""
from collections import defaultdict
from dataclasses import replace
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import rank_sources
from app.models import LinkCredit, XpEvent
from app.rank import points as rules_mod
from app.rank.points import Candidate
from app.services import usage
from app.services.stats import as_utc

DEFAULT_SUB_CAP = 5
MAX_ROWS = 2000


def points_of(source: rank_sources.RankSource, rules=None) -> int:
    """`rules.points.sources[kind]`,未设置时用来源的默认点数;`rules is None`(v0)= 默认点数。"""
    if rules is None:
        return source.default_points
    return int(getattr(rules.points, "sources", {}).get(source.kind, source.default_points))


def sub_cap(rules=None) -> int:
    return DEFAULT_SUB_CAP if rules is None else int(getattr(rules.points, "sources_daily_cap", DEFAULT_SUB_CAP))


async def collect(session: AsyncSession, user_id: int, since: datetime, now: datetime, offset_minutes: int,
                  rules=None) -> tuple[list[Candidate], datetime | None]:
    """登记过的来源在 since 之后的事实 → 候选;注册表为空时不发查询。满 MAX_ROWS 时返回水位(最后一行的时间)。"""
    sources = {s.kind: s for s in rank_sources.registered()}
    if not sources:
        return [], None
    rows = (await session.execute(
        select(LinkCredit.kind, LinkCredit.ref_id, LinkCredit.score, LinkCredit.created_at)
        .where(LinkCredit.user_id == user_id, LinkCredit.kind.in_(sorted(sources)), LinkCredit.created_at >= since)
        .order_by(LinkCredit.created_at, LinkCredit.id).limit(MAX_ROWS))).all()
    out = [Candidate(kind, ref, usage.local_day(at, offset_minutes), points_of(sources[kind], rules), score, as_utc(at))
           for kind, ref, score, at in rows]
    return out, (as_utc(rows[-1][3]) if len(rows) >= MAX_ROWS else None)


async def capped(session: AsyncSession, user_id: int, extra: list[Candidate], batch: list[Candidate], daily_cap: int,
                 rules=None) -> list[Candidate]:
    """grant = min(points, cap − core_used − extra_used, sub_cap − extra_used),不小于 0;被削到 0 的仍返回(写 0 分行)。

    core_used = 当天既有 CAPPED 种类已入账点数 + 本批(`batch`,已封顶)里这些种类的点数;extra_used = 当天联动来源已入账点数。"""
    if not extra:
        return []
    kinds = rank_sources.kinds()
    days = {c.day for c in extra}
    rows = (await session.execute(
        select(XpEvent.day, XpEvent.kind, func.sum(XpEvent.points))
        .where(XpEvent.user_id == user_id, XpEvent.day.in_(sorted(days)),
               XpEvent.kind.in_(sorted(rules_mod.CAPPED | kinds)))
        .group_by(XpEvent.day, XpEvent.kind))).all()
    core: dict[str, int] = defaultdict(int)
    mine: dict[str, int] = defaultdict(int)
    for day, kind, total in rows:
        (mine if kind in kinds else core)[day] += int(total or 0)
    for c in batch:
        if c.kind in rules_mod.CAPPED and c.day in days:
            core[c.day] += c.points
    limit = sub_cap(rules)
    out: list[Candidate] = []
    for c in sorted(extra, key=lambda x: (x.created_at, x.kind, x.ref_id)):
        grant = max(0, min(c.points, daily_cap - core[c.day] - mine[c.day], limit - mine[c.day]))
        mine[c.day] += grant
        out.append(replace(c, points=grant))
    return out
