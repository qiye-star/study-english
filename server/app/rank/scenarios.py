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


def scenario_by_key(key: str) -> Scenario:
    for s in load_scenarios():
        if s.key == key:
            return s
    raise KeyError(key)


def pick_scenario(target_tier: int, recent: set[str], rng: random.Random) -> Scenario:
    pool = [s for s in load_scenarios() if s.target_tier == target_tier]
    fresh = [s for s in pool if s.key not in recent]
    return rng.choice(fresh or pool)
