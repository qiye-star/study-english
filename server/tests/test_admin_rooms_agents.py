"""Admin room detail shows the room's agents and tutor read-only (plan 2026-10-12-agents-rooms A1)."""
import json
from datetime import datetime, timezone

import pytest

from app.models import Room
from app.routers.rooms import runtime
from tests.admin_helpers import ADMIN_ENABLED, login_as
from tests.test_admin_api import register

NOW = datetime(2026, 10, 12, 9, tzinfo=timezone.utc)
MISSING = "0b6c1f3e-2a4d-4c5e-9f00-1234567890ab"


@pytest.fixture
def settings_overrides(tmp_path):
    return {**ADMIN_ENABLED, "rooms_enabled": True, "data_dir": str(tmp_path / "data")}


async def test_detail_lists_agents_and_tutor_and_hides_trace_meta(app, client):
    owner_id, ha = await register(client, "alice")
    room = (await client.post("/api/rooms", headers=ha, json={"topic": "面试"})).json()["room"]
    async with app.state.sessionmaker() as s:
        r = await s.get(Room, room["id"])
        r.agent_config = {"persona_ids": ["builtin:coach", MISSING], "chosen_by": owner_id}
        r.agent_tutor = {"phase": "await_answer", "step_index": 2, "steps_total": 8, "persona_id": "builtin:coach",
                         "run_id": "x", "machine": {"secret": "state"}}
        await s.commit()
    rt = runtime(app)
    async with rt.hub.lock(room["id"]):
        await rt.store.append(room["id"], lane="private", audience_id=owner_id, sender_kind="ai", sender_id=None,
                              kind="agent_trace", text="", now=NOW, reply_to=1,
                              meta={"trace": {"steps": [{"params": {"word": "abandon"}}]}})
    await login_as(app, client, "viewer")
    detail = (await client.get(f"/api/admin/rooms/{room['id']}")).json()
    assert [a["id"] for a in detail["agents"]] == ["builtin:coach"]  # a deleted persona drops out
    assert detail["agents"][0]["builtin"] is True and detail["agents"][0]["disabled"] is False
    assert detail["tutor"] == {"phase": "await_answer", "step_index": 2, "steps_total": 8, "persona_id": "builtin:coach"}
    assert "secret" not in json.dumps(detail)
    timeline = (await client.get(f"/api/admin/rooms/{room['id']}/messages", params={"lane": "all"})).json()
    trace = next(m for m in timeline["messages"] if m["kind"] == "agent_trace")
    assert trace["meta"] is None and "abandon" not in json.dumps(timeline)


async def test_rooms_without_agents_show_empty(app, client):
    _, ha = await register(client, "alice")
    room = (await client.post("/api/rooms", headers=ha, json={"topic": "美食"})).json()["room"]
    await login_as(app, client, "viewer")
    detail = (await client.get(f"/api/admin/rooms/{room['id']}")).json()
    assert (detail["agents"], detail["tutor"]) == ([], None)
