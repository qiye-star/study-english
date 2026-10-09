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


def division_rp(tier: int) -> int:
    return TIERS[tier].division_rp


def tier_key(index: int) -> str:
    return TIERS[index].key


def add_rp(state: RankState, points: int) -> RankState:
    if points <= 0:
        return state
    size = division_rp(state.tier)
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


def at_gate(state: RankState) -> bool:
    return state.tier < MASTER and state.division == 1 and state.rp >= division_rp(state.tier)


def promote(state: RankState) -> RankState:
    if state.tier >= MASTER:
        raise ValueError("master has no promotion")
    tier = state.tier + 1
    return RankState(tier=tier, division=0 if tier == MASTER else 3, rp=0, stars=0)


def after_failed_match(state: RankState) -> RankState:
    return replace(state, rp=min(state.rp, int(division_rp(state.tier) * FAIL_KEEP)))


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
