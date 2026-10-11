"""Room agent selection (spec 2026-10-12-agents §9.1–9.2, plan A5 R-RA3/R-RA10). The owner picks up to MAX_AGENTS
personas: builtin ones or their own, not disabled, not named like @ai, no two with the same name. Stored on
`rooms.agent_config` with the chooser's id (`chosen_by`): personas resolve against the chooser even after ownership
passes to an heir. Persona objects come from app.agents (`Persona`); here they are duck-typed (id, name, intro,
prompt, level, style, prompt_public, owner_id, disabled). Never logs names or prompts."""
from dataclasses import dataclass
from typing import Any, Protocol

RESERVED_NAMES = frozenset({"ai", "助手"})


class PersonaLookup(Protocol):
    """What the rooms layer needs from `PersonaStore`. The real store is session-bound (INDEX X4), so rooms_agents
    builds one adapter that opens a session per call."""

    async def get(self, user_id: int, persona_id: str) -> Any: ...

    async def report(self, reporter_id: int, persona_id: str, reason: str) -> str: ...


@dataclass(frozen=True)
class AgentConfig:
    persona_ids: tuple[str, ...]
    chosen_by: int | None


def config_of(room) -> AgentConfig:
    raw = room.agent_config if isinstance(getattr(room, "agent_config", None), dict) else {}
    ids = raw.get("persona_ids") or []
    chosen = raw.get("chosen_by")
    return AgentConfig(tuple(i for i in ids if isinstance(i, str)),
                       chosen if isinstance(chosen, int) and not isinstance(chosen, bool) else None)


def is_builtin(persona_id: str) -> bool:
    return persona_id.startswith("builtin:")


def _name_key(name: str) -> str:
    return " ".join((name or "").split()).casefold()


async def resolve(lookup: PersonaLookup, cfg: AgentConfig) -> list:
    """The configured personas that still exist, in the owner's order (a deleted one drops out)."""
    out = []
    for persona_id in cfg.persona_ids:
        persona = await lookup.get(cfg.chosen_by or 0, persona_id)
        if persona is not None:
            out.append(persona)
    return out


async def validate(lookup: PersonaLookup, owner_id: int, ids: list[str]) -> tuple[list, str | None]:
    """DB half of the owner's rule (the shape is checked by rules.clean_settings)."""
    personas = []
    for persona_id in ids:
        persona = await lookup.get(owner_id, persona_id)
        if persona is None or (not is_builtin(persona_id) and getattr(persona, "owner_id", None) != owner_id):
            return [], "unknown"
        if getattr(persona, "disabled", False):
            return [], "disabled"
        if _name_key(persona.name) in RESERVED_NAMES:
            return [], "reserved_name"
        personas.append(persona)
    keys = [_name_key(p.name) for p in personas]
    if len(set(keys)) != len(keys):
        return [], "duplicate_name"
    return personas, None


def persona_out(p) -> dict:
    """Member view (spec D3): name, intro, level, style; the prompt only when the creator left it public."""
    public = bool(getattr(p, "prompt_public", True))
    return {"id": p.id, "name": p.name, "intro": p.intro, "level": p.level, "style": p.style,
            "builtin": is_builtin(p.id), "prompt_public": public, "prompt": p.prompt if public else None,
            "disabled": bool(getattr(p, "disabled", False))}


def agent_meta(p) -> dict:
    """`meta.agent` of a public agent answer: id and name only."""
    return {"persona_id": p.id, "name": p.name}
