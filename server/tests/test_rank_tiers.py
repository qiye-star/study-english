from datetime import date

import pytest

from app.rank.tiers import (
    MASTER, TIERS, RankState, add_rp, after_failed_match, at_gate, division_rp, promote, season_of, tier_key,
)


def test_table_matches_spec():
    assert [t.key for t in TIERS] == ["bronze", "silver", "gold", "platinum", "diamond", "star", "master"]
    assert [t.division_rp for t in TIERS] == [100, 100, 120, 140, 160, 200, 200]
    assert [t.cefr for t in TIERS] == ["A1", "A2", "B1", "B1+", "B2", "C1", "C1+"]
    assert TIERS[MASTER].divisions == 0 and tier_key(2) == "gold"


def test_points_fill_divisions_and_carry_over():
    s = add_rp(RankState(), 130)
    assert (s.division, s.rp) == (2, 30)
    s = add_rp(s, 175)
    assert (s.division, s.rp) == (1, 100)  # 30+175=205 -> II full (100) -> I with 105, capped at the gate
    assert at_gate(s)
    assert add_rp(s, 50) == s  # no overflow past the gate
    assert add_rp(s, 0) == s and add_rp(s, -5) == s


def test_gate_needs_division_one_and_full_points():
    assert not at_gate(RankState(tier=2, division=1, rp=119))
    assert at_gate(RankState(tier=2, division=1, rp=120))
    assert not at_gate(RankState(tier=MASTER, division=0, rp=200))


def test_promote_and_fail():
    assert promote(RankState(tier=1, division=1, rp=100)) == RankState(tier=2, division=3, rp=0)
    assert promote(RankState(tier=5, division=1, rp=200)) == RankState(tier=MASTER, division=0, rp=0)
    with pytest.raises(ValueError):
        promote(RankState(tier=MASTER, division=0))
    assert after_failed_match(RankState(tier=2, division=1, rp=120)).rp == 96
    assert after_failed_match(RankState(tier=0, division=1, rp=50)).rp == 50


def test_master_accumulates_stars():
    s = add_rp(RankState(tier=MASTER, division=0, rp=150), 470)
    assert (s.rp, s.stars) == (20, 3)
    assert division_rp(MASTER) == 200


def test_seasons():
    anchor = date(2026, 11, 2)
    assert season_of(date(2026, 11, 1), anchor, 8) is None
    s1 = season_of(date(2026, 11, 2), anchor, 8)
    assert (s1.id, s1.starts_on, s1.ends_on) == (1, anchor, date(2026, 12, 27))
    assert season_of(date(2026, 12, 27), anchor, 8).id == 1
    s2 = season_of(date(2026, 12, 28), anchor, 8)
    assert (s2.id, s2.starts_on) == (2, date(2026, 12, 28))
