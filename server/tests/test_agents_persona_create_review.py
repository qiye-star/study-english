"""评审 #2:创建角色的上限检查是原子的,且走与其他 agents 写入相同的限流依赖。"""
import asyncio

import pytest

from tests.agents_helpers import enable_agents

PERSONA = {"name": "Tom", "prompt": "Be Tom."}


async def test_parallel_creates_cannot_exceed_the_cap(app, client, auth_headers):
    enable_agents(app, agents_personas_max=10, agents_turns_daily_per_user=300)
    for i in range(9):
        assert (await client.post("/api/agents/personas", headers=auth_headers,
                                  json={**PERSONA, "name": f"P{i}"})).status_code == 200
    results = await asyncio.gather(*[
        client.post("/api/agents/personas", headers=auth_headers, json={**PERSONA, "name": f"Race{i}"})
        for i in range(30)])
    codes = sorted(r.status_code for r in results)
    assert codes.count(200) == 1 and codes.count(429) == 29
    mine = [p for p in (await client.get("/api/agents/personas", headers=auth_headers)).json()["personas"] if p["mine"]]
    assert len(mine) == 10


@pytest.mark.parametrize("settings_overrides", [{"ai_rate_limit_per_minute": 2}], indirect=True)
async def test_create_persona_is_rate_limited_like_other_agents_writes(app, client, auth_headers):
    enable_agents(app, agents_personas_max=50)
    codes = [(await client.post("/api/agents/personas", headers=auth_headers,
                                json={**PERSONA, "name": f"R{i}"})).status_code for i in range(4)]
    assert codes[:2] == [200, 200] and 429 in codes[2:]
