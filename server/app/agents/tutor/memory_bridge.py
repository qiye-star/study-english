"""导师总结写入记忆(spec §7.4、§8;R-T17):本计划唯一调用 A2 记忆接口的地方。

只在 AGENTS_MEMORY_ENABLED、用户 memory_enabled、且至少答 / 跳过一题时写;候选只含题型与主题(recap.memory_candidates)。
会话回顾经 A2 的 `worker.submit_tutor(TutorFinished)`(后台写 agent_recaps;worker 自己再做一次受额度限制的抽取);
≤ 3 条确定性候选经 `MemoryStore.add`(A2 负责长度、去重、过滤与墓碑;返回 None = 被拦截)。日志只记异常类名与数字。"""
from app.agents import settings as agent_settings
from app.agents.memory.worker import TutorFinished
from app.agents.tutor.recap import memory_candidates, summary_text
from app.models import utcnow


async def write_recap(app, *, user_id: int, persona_id: str | None, conversation_id: str | None, session_id: str,
                      recap: dict) -> int:
    """返回写入 / 刷新的记忆条数(不含回顾)。"""
    settings = app.state.settings
    memory = getattr(app.state, "agent_memory", None)
    if memory is None or not settings.agents_memory_enabled or recap["answered"] + recap["skipped"] == 0:
        return 0
    async with app.state.sessionmaker() as session:
        prefs = await agent_settings.load(session, user_id)
    if not prefs.memory_enabled:
        return 0
    memory.worker.submit_tutor(TutorFinished(user_id=user_id, persona_id=persona_id, conversation_id=conversation_id,
                                             tutor_session_id=session_id, recap_text=summary_text(recap),
                                             at=utcnow()))
    added = 0
    for candidate in memory_candidates(recap):
        item = await memory.store.add(user_id, kind=candidate["kind"], text=candidate["text"], persona_id=None,
                                      importance=candidate["importance"], source="tutor")
        added += item is not None
    if added:
        memory.cache.invalidate_user(user_id)
    return added
