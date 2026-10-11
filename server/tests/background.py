"""Draining the app's background work in tests.

The test database is ONE shared in-memory SQLite connection (StaticPool): a background task that is still running
interleaves its transactions / rollbacks with the next request, or touches the connection after the `app` fixture
disposed the engine (`ProgrammingError: Cannot operate on a closed database`, `KeyError: 'connection'`).
Tasks that start after a response (agents after_turn hooks, the memory worker, rooms summaries / presence, learning
judge, closed-call assessments) therefore have to be awaited before the next request and before teardown:

- the `app` fixture (conftest.py) calls `drain_background` on teardown, then `cancel_background` for stragglers;
- a test that sends another request right after one that spawns such work calls `await drain_background(app)`;
  never sleep or hand-pick one task set (agents `runtime(app).tasks` alone misses the memory worker and rooms tasks).
"""
import asyncio


def _task_sets(app) -> list:
    """Every place app code keeps fire-and-forget tasks (live sets: tasks remove themselves when done)."""
    state = app.state
    out = []
    agents = getattr(state, "agents", None)
    if agents is not None:
        out.append(agents.tasks)
    memory = getattr(state, "agent_memory", None)
    if memory is not None:
        out.append(memory.worker.pending)
    rooms = getattr(state, "rooms", None)
    if rooms is not None:
        out.append(rooms.hub.tasks)
    judge = getattr(state, "links_judge", None)
    if judge is not None:
        out.append(judge.pending)
    out.append(getattr(state, "realtime_drains", set()))
    return out


def timer_tasks(app) -> list[asyncio.Task]:
    """Room tutor 60 s timers: they sleep by design, so `drain_background` must not wait for them (they are only
    cancelled, here and by `RoomTutor.shutdown`)."""
    tutor = getattr(getattr(getattr(app.state, "rooms", None), "agents", None), "tutor", None)
    return tutor.timers() if tutor is not None else []


def live_tasks(app) -> list[asyncio.Task]:
    current = asyncio.current_task()
    return [t for tasks in _task_sets(app) for t in list(tasks) if t is not current and not t.done()]


async def drain_background(app, *, timeout: float = 5.0) -> None:
    """Wait until no background task is left (tasks can spawn tasks, so loop until quiet). Raises TimeoutError."""
    async def loop() -> None:
        while pending := live_tasks(app):
            await asyncio.gather(*pending, return_exceptions=True)
    await asyncio.wait_for(loop(), timeout)


async def cancel_background(app) -> None:
    pending = live_tasks(app) + timer_tasks(app)
    for task in pending:
        task.cancel()
    await asyncio.gather(*pending, return_exceptions=True)
