"""Dictionary-backed source for the daily greeting's facts (plan 2026-10-23 R3).

links is the layer that may read wordbook, so this source lives here and is registered into the greeting facts registry
by main.create_app (same arrangement as agent_sources.py, R-A1; not gated by LINKS_ENABLED, only by WORDBOOK_ENABLED).
Read-only, no logging; the greeting service owns timeouts and error logging."""
from app.agents.greeting.facts import FactCtx, facts_registry
from app.wordbook import service
from app.wordbook.index import DataUnavailable, dictionary


class WordbookToday:
    key = "wordbook_today"

    def __init__(self, app):
        self.app = app

    async def load(self, ctx: FactCtx) -> dict | None:
        settings = self.app.state.settings
        if not settings.wordbook_enabled:
            return None
        async with self.app.state.sessionmaker() as s:
            try:
                today = await service.today_out(s, dictionary(self.app), ctx.user_id, settings, ctx.offset, ctx.now)
            except DataUnavailable:
                return None
        plan = today.get("plan")
        out: dict = {}
        if plan and plan.get("review_left"):
            out["wordbook_due"] = int(plan["review_left"])
        if today["streak"]["current"]:
            out["wordbook_streak"] = int(today["streak"]["current"])
        return out or None


def install(app) -> None:
    facts_registry(app).register(WordbookToday(app))
