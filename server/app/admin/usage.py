"""用量与估算费用(spec §8.2)。

数据源:保留期内是 `upstream_calls` 原始行,更早的是 `usage_daily` 汇总(汇总与删除同时发生,二者不重叠)。
费用只是按 `USAGE_PRICES_JSON` 单价表的估算;缺单价或无法估算(字节计量)的部分记为 None,
`cost_complete` 为 False。成功 = 2xx;错误分桶:402、429、401/403 → auth、≥500 → 5xx、0 → network。
"""
import json
import logging
import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import case, func, select

from app.core.metering import DAILY_UNIT
from app.models import UpstreamCall, UsageDaily, User

logger = logging.getLogger(__name__)

DAYS = (1, 7, 30, 90)
PRICE_FIELDS = ("in_per_1k", "out_per_1k", "per_1k_chars", "per_minute", "per_call")


@dataclass(frozen=True)
class Price:
    in_per_1k: float | None = None
    out_per_1k: float | None = None
    per_1k_chars: float | None = None
    per_minute: float | None = None
    per_call: float | None = None


def parse_prices(text: str) -> dict[str, Price]:
    """`{"kind:model": {...}}`; model may be `*` or `provider/model`. Bad JSON, unknown fields or negatives → ValueError."""
    try:
        data = json.loads(text or "{}")
    except ValueError:
        raise ValueError("Prices must be valid JSON") from None
    if not isinstance(data, dict):
        raise ValueError("Prices must be a JSON object")
    prices: dict[str, Price] = {}
    for key, entry in data.items():
        if not isinstance(key, str) or ":" not in key or not isinstance(entry, dict):
            raise ValueError(f"Invalid price entry: {str(key)[:64]}")
        values: dict[str, float] = {}
        for field, value in entry.items():
            if field not in PRICE_FIELDS:
                raise ValueError(f"Unknown price field: {str(field)[:32]}")
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
                raise ValueError(f"Price must be a non-negative number: {key[:64]}.{field}")
            values[field] = float(value)
        prices[key] = Price(**values)
    return prices


_cache: dict[str, dict[str, Price]] = {}


def prices_for(settings) -> dict[str, Price]:
    """Parsed `usage_prices_json` (memoised by text). Invalid text → no prices (logged once, value-free)."""
    text = settings.usage_prices_json or "{}"
    if text not in _cache:
        try:
            parsed = parse_prices(text)
        except ValueError:
            logger.warning("usage prices invalid; costs are not estimated")
            parsed = {}
        _cache.clear()
        _cache[text] = parsed
    return _cache[text]


def price_for(prices: dict[str, Price], kind: str, provider: str, model: str) -> Price | None:
    for key in (f"{kind}:{provider}/{model}", f"{kind}:{model}", f"{kind}:*"):
        if key in prices:
            return prices[key]
    return None


def estimate(row_like, prices: dict[str, Price]) -> float | None:
    """Estimated cost of one row (raw call or aggregate with `calls`); None when it cannot be priced."""
    price = price_for(prices, row_like.kind, getattr(row_like, "provider", "") or "", row_like.model)
    if price is None:
        return None
    unit = row_like.unit
    units_in, units_out = row_like.units_in or 0, row_like.units_out or 0
    calls = getattr(row_like, "calls", None) or 1
    if unit == "tokens" and (price.in_per_1k is not None or price.out_per_1k is not None):
        return (price.in_per_1k or 0) * units_in / 1000 + (price.out_per_1k or 0) * units_out / 1000
    if unit == "chars" and price.per_1k_chars is not None:
        return price.per_1k_chars * units_in / 1000
    if unit == "audio_ms" and price.per_minute is not None:
        return price.per_minute * units_in / 60000
    if unit == "calls" and price.per_call is not None:
        return price.per_call * calls
    return None


@dataclass
class _Group:
    day: str
    feature: str
    kind: str
    provider: str
    model: str
    unit: str
    user_id: int | None
    calls: int
    errors: int
    units_in: int
    units_out: int


def _since(now: datetime, days: int) -> datetime:
    return now - timedelta(days=days)


def _ok():
    return (UpstreamCall.status >= 200) & (UpstreamCall.status < 300)


async def _groups(session, now: datetime, days: int) -> list[_Group]:
    since = _since(now, days)
    day = func.date(UpstreamCall.at)
    raw = (await session.execute(
        select(day, UpstreamCall.feature, UpstreamCall.kind, UpstreamCall.provider, UpstreamCall.model,
               UpstreamCall.unit, UpstreamCall.user_id, func.count(),
               func.sum(case((_ok(), 0), else_=1)), func.sum(UpstreamCall.units_in), func.sum(UpstreamCall.units_out))
        .where(UpstreamCall.at >= since)
        .group_by(day, UpstreamCall.feature, UpstreamCall.kind, UpstreamCall.provider, UpstreamCall.model,
                  UpstreamCall.unit, UpstreamCall.user_id))).all()
    out = [_Group(str(r[0]), *r[1:7], int(r[7] or 0), int(r[8] or 0), int(r[9] or 0), int(r[10] or 0)) for r in raw]
    daily = (await session.scalars(select(UsageDaily).where(UsageDaily.day >= since.date().isoformat()))).all()
    for d in daily:
        out.append(_Group(d.day, d.feature, d.kind, d.provider, d.model, DAILY_UNIT.get(d.kind, "calls"),
                          d.user_id or None, d.calls, d.errors, d.units_in, d.units_out))
    return out


def _add(acc: dict, key, g: _Group, cost: float | None) -> dict:
    item = acc.get(key)
    if item is None:
        item = acc[key] = {"calls": 0, "errors": 0, "cost": 0.0, "_priced": True}
    item["calls"] += g.calls
    item["errors"] += g.errors
    if cost is None:
        item["_priced"] = item["_priced"] and g.calls == 0
    else:
        item["cost"] += cost
    return item


def _finish(item: dict) -> dict:
    priced = item.pop("_priced")
    item["cost"] = round(item["cost"], 6) if priced or item["cost"] else None
    item["cost_complete"] = priced
    return item


async def _percentile(session, since: datetime, q: float) -> int | None:
    count = await session.scalar(select(func.count()).select_from(UpstreamCall).where(UpstreamCall.at >= since))
    if not count:
        return None
    offset = min(count - 1, max(0, math.ceil(q * count) - 1))
    return await session.scalar(select(UpstreamCall.ms).where(UpstreamCall.at >= since)
                                .order_by(UpstreamCall.ms).offset(offset).limit(1))


async def _error_buckets(session, since: datetime) -> dict[str, int]:
    rows = (await session.execute(select(UpstreamCall.status, func.count()).where(UpstreamCall.at >= since, ~_ok())
                                  .group_by(UpstreamCall.status))).all()
    buckets = {"402": 0, "429": 0, "auth": 0, "5xx": 0, "network": 0}
    for status, n in rows:
        name = {402: "402", 429: "429", 401: "auth", 403: "auth", 0: "network"}.get(status)
        if name is None and status >= 500:
            name = "5xx"
        if name is not None:
            buckets[name] += n
    return buckets


async def summary(session, settings, days: int, now: datetime) -> dict:
    prices = prices_for(settings)
    groups = await _groups(session, now, days)
    totals = {"calls": 0, "errors": 0, "cost": 0.0, "_priced": True}
    by_feature: dict = {}
    by_model: dict = {}
    daily: dict = {}
    users: set[int] = set()
    for g in groups:
        cost = estimate(g, prices)
        _add({"t": totals}, "t", g, cost)
        _add(by_feature, g.feature, g, cost)
        m = _add(by_model, (g.kind, g.provider, g.model, g.unit), g, cost)
        m["units_in"] = m.get("units_in", 0) + g.units_in
        m["units_out"] = m.get("units_out", 0) + g.units_out
        d = _add(daily, g.day, g, cost)
        features = d.setdefault("features", {})
        features[g.feature] = features.get(g.feature, 0) + g.calls
        if g.user_id:
            users.add(g.user_id)
    since = _since(now, days)
    complete = totals.pop("_priced")
    calls = totals["calls"]
    return {
        "days": days,
        "currency": settings.usage_currency,
        "totals": {
            "calls": calls, "errors": totals["errors"],
            "error_rate": round(totals["errors"] / calls, 4) if calls else 0.0,
            "cost": round(totals["cost"], 6), "cost_complete": complete,
            "p50_ms": await _percentile(session, since, 0.5), "p95_ms": await _percentile(session, since, 0.95),
            "active_users": len(users),
        },
        "by_feature": sorted(({"feature": k, **_finish(v)} for k, v in by_feature.items()),
                             key=lambda x: -x["calls"]),
        "by_model": sorted(({"kind": k[0], "provider": k[1], "model": k[2], "unit": k[3], **_finish(v)}
                            for k, v in by_model.items()), key=lambda x: -x["calls"]),
        "daily": sorted(({"day": k, **_finish(v)} for k, v in daily.items()), key=lambda x: x["day"]),
        "errors": await _error_buckets(session, since),
    }


async def top_users(session, settings, days: int, by: str, limit: int, now: datetime) -> list[dict]:
    prices = prices_for(settings)
    acc: dict[int, dict] = {}
    for g in await _groups(session, now, days):
        if not g.user_id:
            continue
        _add(acc, g.user_id, g, estimate(g, prices))
    if not acc:
        return []
    names = dict((await session.execute(select(User.id, User.username).where(User.id.in_(acc)))).all())
    items = [{"user_id": uid, "username": names.get(uid), **_finish(v)} for uid, v in acc.items()]
    key = (lambda x: (x["cost"] or 0, x["calls"])) if by == "cost" else (lambda x: (x["calls"], x["cost"] or 0))
    return sorted(items, key=key, reverse=True)[:limit]


async def health(session, now: datetime, minutes: int = 15) -> list[dict]:
    since = now - timedelta(minutes=minutes)
    rows = (await session.execute(
        select(UpstreamCall.kind, UpstreamCall.provider, func.count(), func.sum(case((_ok(), 0), else_=1)))
        .where(UpstreamCall.at >= since).group_by(UpstreamCall.kind, UpstreamCall.provider))).all()
    out = []
    for kind, provider, calls, errors in rows:
        last = (await session.execute(
            select(UpstreamCall.status, UpstreamCall.at)
            .where(UpstreamCall.at >= since, UpstreamCall.kind == kind, UpstreamCall.provider == provider, ~_ok())
            .order_by(UpstreamCall.at.desc()).limit(1))).first()
        errors = int(errors or 0)
        at = last[1] if last else None
        if at is not None and at.tzinfo is None:
            at = at.replace(tzinfo=timezone.utc)
        out.append({"kind": kind, "provider": provider, "calls": calls, "errors": errors,
                    "success_rate": round((calls - errors) / calls, 4) if calls else None,
                    "last_error_status": last[0] if last else None,
                    "last_error_at": at.isoformat() if at else None})
    return sorted(out, key=lambda x: (x["kind"], x["provider"]))


async def missing_prices(session, settings, now: datetime, days: int = 30) -> tuple[str, ...]:
    """`kind:model` of metered calls in the last `days` that have no price entry (for the config doctor)."""
    prices = prices_for(settings)
    rows = (await session.execute(
        select(UpstreamCall.kind, UpstreamCall.provider, UpstreamCall.model)
        .where(UpstreamCall.at >= _since(now, days)).distinct())).all()
    missing = {f"{kind}:{model}" for kind, provider, model in rows if price_for(prices, kind, provider, model) is None}
    return tuple(sorted(missing))
