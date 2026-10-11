"""管理端「学习联动」视图(spec §9)。计数来自 app.state.learning_bus(进程内,重启清零);不含任何用户数据:
只有联动键、事件类名、异常类名、计数与「关闭了该联动的用户数」(聚合计数,不含 id)。"""
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import rank_sources
from app.links.registry import LINKS
from app.models import UserLinkPref
from app.rank.rules_store import rank_rules

COUNTERS = ("published", "handled", "skipped", "failed", "timeouts", "dropped", "breaker_skipped")


def _points(source: rank_sources.RankSource, rules) -> int:
    """当前规则里的点数(与 L6 的 `app.rank.extra_sources.points_of` 同一口径;`PointsRule.sources` 由 L6 加入,
    之前一律是默认点数)。"""
    return int(getattr(rules.points, "sources", {}).get(source.kind, source.default_points))


async def view(app, session: AsyncSession) -> dict:
    settings = app.state.settings
    bus = app.state.learning_bus
    stats = bus.stats()
    off = dict((await session.execute(
        select(UserLinkPref.link_key, func.count()).where(UserLinkPref.enabled.is_(False))
        .group_by(UserLinkPref.link_key))).all())
    _, rules = await rank_rules(app).current()  # (published version | None, RankRules)
    master = bool(getattr(settings, "links_enabled", False))
    subscribed = set(bus.links())  # 只有接口、没有事件订阅的联动(word_actions 等)不在其中:页面显示「—」
    links = []
    for spec in LINKS:
        s = stats.get(spec.key, {})
        on = bool(getattr(settings, spec.flag, False))
        links.append({
            "key": spec.key, "label_zh": spec.label_zh, "label_en": spec.label_en, "global": on,
            "effective": master and on, "subscribed": spec.key in subscribed,
            "stats": {k: int(s.get(k, 0)) for k in COUNTERS} | {"extra": dict(s.get("extra", {}))},
            "breaker": s.get("breaker", "closed"), "open_seconds": int(s.get("open_seconds", 0)),
            "users_off": int(off.get(spec.key, 0)),
        })
    sources = [{"kind": src.kind, "default_points": src.default_points, "points": _points(src, rules),
                "label_zh": src.label_zh, "label_en": src.label_en} for src in rank_sources.registered()]
    return {"enabled": master, "queue": bus.queue(), "links": links, "rank_sources": sources,
            "errors": bus.recent_errors(), "process_local": True}
