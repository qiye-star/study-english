import json
from dataclasses import dataclass
from pathlib import Path

import pytest

from app.agents.personas import Persona
from app.rooms import agent_config
from app.rooms.agent_mentions import agent_mention, find_handoff

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "room_agent_mentions.json").read_text(encoding="utf-8"))
U1 = "0b6c1f3e-2a4d-4c5e-9f00-1234567890ab"
U2 = "1c7d2f4e-3b5e-4d6f-8a11-234567890abc"


def persona(pid, name, owner_id=None, **kw):
    fields = dict(intro="英语教练", prompt="You are a patient coach.", level="B1", style="friendly")
    fields.update(kw)
    return Persona(id=pid, owner_id=owner_id, name=name, **fields)


class FakeLookup:
    def __init__(self, *personas):
        self.by_id = {p.id: p for p in personas}

    async def get(self, user_id, persona_id):
        p = self.by_id.get(persona_id)
        return p if p is not None and p.owner_id in (None, user_id) else None

    async def report(self, reporter_id, persona_id, reason):
        return "ok"


@pytest.mark.parametrize("case", FIXTURE["cases"], ids=lambda c: c["text"])
def test_agent_mention_matches_the_shared_cases(case):
    assert agent_mention(case["text"], FIXTURE["names"]) == (case["index"], case["question"])


def test_handoff_finds_the_first_other_agent_anywhere():
    names = ["Emma", "Leo"]
    assert find_handoff("Good try. @Leo can check the grammar.", names, 0) == 1
    assert find_handoff("Ask @leo, or me.", names, 0) == 1
    assert find_handoff("I am @Emma and that is fine.", names, 0) is None  # never itself
    assert find_handoff("mail me at a@Leo.com", names, 0) is None  # not after a word character
    assert find_handoff("No hand-off here.", names, 0) is None


async def test_validate_owner_rule():
    owner, other = 7, 8
    lookup = FakeLookup(persona("builtin:coach", "Emma"), persona(U1, "Leo", owner_id=owner),
                        persona(U2, "Max", owner_id=other), persona("builtin:ai", "AI"),
                        persona("builtin:twin", "emma"), persona("builtin:off", "Off", disabled=True))
    found, problem = await agent_config.validate(lookup, owner, ["builtin:coach", U1])
    assert problem is None and [p.name for p in found] == ["Emma", "Leo"]
    for ids, code in (([U2], "unknown"), (["builtin:missing"], "unknown"), (["builtin:off"], "disabled"),
                      (["builtin:ai"], "reserved_name"), (["builtin:coach", "builtin:twin"], "duplicate_name")):
        assert await agent_config.validate(lookup, owner, ids) == ([], code), ids


async def test_config_resolve_and_views():
    class Room:
        agent_config = {"persona_ids": ["builtin:coach", U1, "builtin:gone"], "chosen_by": 7}

    cfg = agent_config.config_of(Room())
    assert cfg == agent_config.AgentConfig(("builtin:coach", U1, "builtin:gone"), 7)
    lookup = FakeLookup(persona("builtin:coach", "Emma"), persona(U1, "Leo", owner_id=7, prompt_public=False))
    personas = await agent_config.resolve(lookup, cfg)  # a deleted persona drops out (R-RA3)
    assert [p.name for p in personas] == ["Emma", "Leo"]
    assert agent_config.persona_out(personas[1]) == {
        "id": U1, "name": "Leo", "intro": "英语教练", "level": "B1", "style": "friendly", "builtin": False,
        "prompt_public": False, "prompt": None, "disabled": False}
    assert agent_config.persona_out(personas[0])["prompt"] == "You are a patient coach."
    assert agent_config.agent_meta(personas[0]) == {"persona_id": "builtin:coach", "name": "Emma"}

    class Empty:
        agent_config = None

    assert agent_config.config_of(Empty()) == agent_config.AgentConfig((), None)
