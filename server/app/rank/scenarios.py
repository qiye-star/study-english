"""Promotion-match scenarios (spec 2026-10-09 §3.2), shipped with the code (not served by /api/config)."""
import json
import random
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

FILE = Path(__file__).with_name("scenarios.json")


@dataclass(frozen=True)
class Scenario:
    key: str
    target_tier: int
    title_zh: str
    title_en: str
    brief_zh: str
    role: str
    setting: str
    functions: tuple[str, ...]
    opener: str


@lru_cache(maxsize=1)
def load_scenarios() -> tuple[Scenario, ...]:
    raw = json.loads(FILE.read_text(encoding="utf-8"))
    return tuple(Scenario(**{**item, "functions": tuple(item["functions"])}) for item in raw)


def _from_rule(rule) -> Scenario:
    """A RankRules ScenarioRule (duck typed, plan P-6) as a Scenario."""
    return Scenario(rule.key, rule.target_tier, rule.title_zh, rule.title_en, rule.brief_zh, rule.role, rule.setting,
                    tuple(rule.functions), rule.opener)


def scenario_by_key(key: str, *, rules=None) -> Scenario:
    """Disabled scenarios still resolve (an in-flight match may use one); a key missing from `rules` falls back to
    the shipped file so old match rows always render."""
    if rules is not None:
        for rule in rules.scenarios:
            if rule.key == key:
                return _from_rule(rule)
    for s in load_scenarios():
        if s.key == key:
            return s
    raise KeyError(key)


def pick_scenario(target_tier: int, recent: set[str], rng: random.Random, *, rules=None) -> Scenario:
    if rules is not None:
        pool = [_from_rule(r) for r in rules.scenarios if r.target_tier == target_tier and r.enabled]
    else:
        pool = [s for s in load_scenarios() if s.target_tier == target_tier]
    fresh = [s for s in pool if s.key not in recent]
    return rng.choice(fresh or pool)
