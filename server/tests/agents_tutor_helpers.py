"""Tutor-mode test helpers (plan A3). fake_stream is the only place that depends on `llm.complete_stream` /
`llm.Delta`; install_sources the only one that depends on how sources are registered (INDEX X1: runtime(app).registry)."""
import json
import uuid
from dataclasses import replace

from app.agents.context import SourceResult
from app.agents.orchestrator import runtime
from app.agents.tutor import machine
from app.models import AgentTutorSession
from app.providers import llm


def enable_agents(app, **overrides) -> None:
    # extraction of the tutor recap text would call the (unmocked) upstream; the per-user cap of 0 skips it
    app.state.settings = app.state.settings.model_copy(
        update={"agents_enabled": True, "agents_tutor_enabled": True, "agents_memory_extract_daily_per_user": 0,
                **overrides})


async def login(client, name: str = "alice") -> dict:
    r = await client.post("/api/users", json={"username": name, "password": "password123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def conversation(client, headers) -> str:
    r = await client.post("/api/conversations", json={"name": "tutor"}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def start_body(conversation_id: str, **overrides) -> dict:
    body = {"conversation_id": conversation_id, "persona_id": "builtin:coach", "topic": "free", "length": 5,
            "input": "text", "client_start_id": str(uuid.uuid4())}
    body.update(overrides)
    return body


class FakeSource:
    private = True

    def __init__(self, key: str, words: list[str]):
        self.key = key
        self._words = words

    async def load(self, ctx):
        return SourceResult(label_key=f"agents.source.{self.key}",
                            params={"count": len(self._words), "words": list(self._words)}, block="", ms=0)


def install_sources(app, **words_by_key: list[str]) -> None:
    registry = runtime(app).registry
    for key, words in words_by_key.items():
        registry.unregister(key)  # replace the real learning source
        registry.register(FakeSource(key, words))


def fake_stream(monkeypatch, *replies: list[str]) -> list[dict]:
    """Each complete_stream call takes the next reply (list of text deltas). Returns call records (args / kwargs)."""
    queue = list(replies)
    calls: list[dict] = []

    async def fake(*args, **kwargs):
        calls.append({"args": args, "kwargs": kwargs})
        for chunk in queue.pop(0):
            yield llm.Delta(kind="text", text=chunk)

    monkeypatch.setattr("app.providers.llm.complete_stream", fake)
    return calls


def sse(text: str) -> list[tuple[str, dict]]:
    events: list[tuple[str, dict]] = []
    for block in text.replace("\r\n", "\n").split("\n\n"):
        kind, data = None, None
        for line in block.split("\n"):
            if line.startswith("event:"):
                kind = line[6:].strip()
            elif line.startswith("data:"):
                data = json.loads(line[5:].strip())
        if kind:
            events.append((kind, data))
    return events


async def turn(client, headers, conversation_id: str, session_id: str, text: str | None) -> list[tuple[str, dict]]:
    body = {"persona_id": "builtin:coach", "conversation_id": conversation_id, "text": text, "history": [],
            "mode": "tutor", "tutor_session_id": session_id, "client_turn_id": str(uuid.uuid4())}
    r = await client.post("/api/agents/turn", json=body, headers=headers)
    assert r.status_code == 200, r.text
    return sse(r.text)


async def set_state(app, session_id: str, **changes) -> None:
    async with app.state.sessionmaker() as s:
        row = await s.get(AgentTutorSession, session_id)
        row.state = machine.to_dict(replace(machine.from_dict(row.state), **changes))
        await s.commit()
