# server/app/rooms/tutor_rotation.py
"""Pure participant rotation and deadlines for the room tutor (spec 2026-10-12-agents §7.5, plan A5 R-RA8).
The order is fixed at start (online members in join order); members who join later go to the end, members who
left are skipped, nobody is ever removed from the order (so positions stay stable)."""
from datetime import datetime

from app.agents.tutor.plan import LENGTH_DEFAULT as DEFAULT_STEPS, LENGTH_MAX as MAX_STEPS, LENGTH_MIN as MIN_STEPS  # spec §7.2: 3–12, default 8


def clamp_steps(n: int | None) -> int:
    return DEFAULT_STEPS if n is None else max(MIN_STEPS, min(MAX_STEPS, int(n)))


def initial_order(member_ids: list[int], online: set[int]) -> list[int]:
    return [u for u in member_ids if u in online]


def next_participant(order: list[int], last: int | None, active: list[int]) -> tuple[list[int], int | None]:
    """(order with newcomers appended, next user after `last`); None when no active member is in the order."""
    alive = set(active)
    order = list(order) + [u for u in active if u not in order]
    start = order.index(last) + 1 if last in order else 0
    for k in range(len(order)):
        user = order[(start + k) % len(order)]
        if user in alive:
            return order, user
    return order, None


def remaining_ms(deadline_iso: str | None, now: datetime) -> int | None:
    if not deadline_iso:
        return None
    deadline = datetime.fromisoformat(deadline_iso.replace("Z", "+00:00"))
    return max(0, int((deadline - now).total_seconds() * 1000))
