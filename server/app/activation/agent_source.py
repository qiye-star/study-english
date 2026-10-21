"""智能体来源 `dormant_words`(plan L4 R18):沉睡词中稳定选出 2–3 个,让对话自然引出。

- 只读、不写表、不记日志;自己开会话;`ACTIVATION_ENABLED` 关 → 返回 None 且不开会话(R17)。
- private=True:联机里只在 share_in_rooms 时运行(agents.context.enabled);过程只给提问者。
- 选词与普通对话的提示词补充同一规则(`words.prompt_hint`),这里用 UTC 日。
"""
from app.activation import words
from app.agents.context import SourceResult
from app.agents.orchestrator import runtime
from app.models import utcnow


class DormantWords:
    key = "dormant_words"
    private = True

    def __init__(self, app) -> None:
        self.app = app

    async def load(self, ctx) -> SourceResult | None:
        if not self.app.state.settings.activation_enabled:
            return None
        now = utcnow()
        async with self.app.state.sessionmaker() as session:
            hint = await words.prompt_hint(session, ctx.user_id, 0, now)
        if not hint["words"]:
            return None
        return SourceResult("agents.step.dormant_words", {"count": len(hint["words"]), "words": hint["words"]},
                            hint["block"])


def install(app) -> None:
    """Registered after the agents runtime exists (main.create_app); the turn checks the switches per call."""
    runtime(app).registry.register(DormantWords(app))
