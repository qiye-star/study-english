"""Tier table, division math and seasons (spec 2026-10-09 §2.1, §2.4). Pure.

Divisions count down: 3 = III (lowest), 1 = I. Points fill III -> II -> I and stop at the gate
(division I full); only a passed promotion match changes the tier. Master has no divisions:
every `division_rp` points add a star."""
from dataclasses import dataclass, replace
from datetime import date, timedelta


@dataclass(frozen=True)
class Tier:
    key: str
    index: int
    cefr: str
    divisions: int
    division_rp: int
    icon: str


TIERS: tuple[Tier, ...] = (
    Tier("bronze", 0, "A1", 3, 100, "shield"),
    Tier("silver", 1, "A2", 3, 100, "shield-half"),
    Tier("gold", 2, "B1", 3, 120, "shield-star"),
    Tier("platinum", 3, "B1+", 3, 140, "hexagon"),
    Tier("diamond", 4, "B2", 3, 160, "diamond"),
    Tier("star", 5, "C1", 3, 200, "star"),
    Tier("master", 6, "C1+", 0, 200, "crown"),
)
MASTER = 6
FAIL_KEEP = 0.8


@dataclass(frozen=True)
class RankState:
    tier: int = 0
    division: int = 3
    rp: int = 0
    stars: int = 0


def division_rp(tier: int, *, rules=None) -> int:
    """`rules` (admin v2, plan P-6): a RankRules read by duck typing; None = the TIERS table."""
    return (rules.tiers[tier] if rules is not None else TIERS[tier]).division_rp


def tier_key(index: int) -> str:
    return TIERS[index].key


def add_rp(state: RankState, points: int, *, rules=None) -> RankState:
    if points <= 0:
        return state
    size = division_rp(state.tier, rules=rules)
    if state.tier == MASTER:
        total = state.rp + points
        return replace(state, rp=total % size, stars=state.stars + total // size)
    division, rp = state.division, state.rp + points
    while rp >= size and division > 1:
        rp -= size
        division -= 1
    if division == 1:
        rp = min(rp, size)
    return replace(state, division=division, rp=rp)


def clamp_rp(state: RankState, *, rules=None) -> RankState:
    """After division_rp was lowered (admin v2 §5.2): cut rp to the new size (master: below one star). Never rolls
    excess points into a division or star."""
    size = division_rp(state.tier, rules=rules)
    limit = size - 1 if state.tier == MASTER else size
    return state if state.rp <= limit else replace(state, rp=limit)


def at_gate(state: RankState, *, rules=None) -> bool:
    return state.tier < MASTER and state.division == 1 and state.rp >= division_rp(state.tier, rules=rules)


def promote(state: RankState) -> RankState:
    if state.tier >= MASTER:
        raise ValueError("master has no promotion")
    tier = state.tier + 1
    return RankState(tier=tier, division=0 if tier == MASTER else 3, rp=0, stars=0)


def after_failed_match(state: RankState, *, rules=None) -> RankState:
    keep = rules.match.fail_keep if rules is not None else FAIL_KEEP
    return replace(state, rp=min(state.rp, int(division_rp(state.tier, rules=rules) * keep)))


@dataclass(frozen=True)
class Season:
    id: int
    starts_on: date
    ends_on: date


def season_of(today: date, anchor: date, weeks: int) -> Season | None:
    if today < anchor:
        return None
    length = weeks * 7
    n = (today - anchor).days // length
    start = anchor + timedelta(days=n * length)
    return Season(n + 1, start, start + timedelta(days=length - 1))
