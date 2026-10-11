"""导师会话存取与端点逻辑(spec 2026-10-12-agents §4.5、§7;计划 A3 S7)。

归属:每个读写都按 user_id 过滤;幂等:同一 client_start_id 返回同一会话,同一对话最多一个进行中的会话(R-T8);
过期:闲置 IDLE 视为 expired(R-T10);乐观锁:state 只经 version 条件更新写入。
日志只记种类与数字,永不记录词、题目、提示或回答。"""
import logging
from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents import limits
from app.agents.tutor import machine
from app.agents.tutor.machine import (Answered, Asked, Finished, HintUsed, InvalidTransition, Skipped, TutorState,
                                      current_item, level_name, new_state, next_state, step_number)
from app.agents.tutor.parse import Meta
from app.agents.tutor.plan import Goal, PlanSources, build_plan
from app.agents.tutor.recap import build_recap
from app.models import AgentTutorSession, iso_utc, new_uuid
from app.services import usage
from app.services.stats import as_utc

logger = logging.getLogger(__name__)
IDLE = timedelta(minutes=30)
USAGE_SCOPE = limits.SCOPE_TUTOR_USER  # INDEX X5: "agents_tutor"
ACTIVE, DONE, EXPIRED = "active", "done", "expired"
FALLBACK_HINT = {
    "ask": "先用一句简单的话直接回答,再补充一个原因或例子。",
    "words": "试着把这几个词放进同一个句子:{words}。",
    "repeat": "放慢速度,一个词一个词地照着说。",
    "retell": "按「谁 → 做了什么 → 结果」三步复述。",
    "roleplay": "想象你就在这个场景里:先打招呼,再说你的需要。",
    "dictate": "点「听一遍」再听一次,先写下听清的词。",
}

RecapHook = Callable[[AgentTutorSession, dict], Awaitable[None]]


class TutorError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def effective_status(row: AgentTutorSession, now: datetime) -> str:
    if row.status == ACTIVE and as_utc(row.updated_at) + IDLE < as_utc(now):
        return EXPIRED
    return row.status


def state_of(row: AgentTutorSession) -> TutorState:
    return machine.from_dict(row.state)


def out(row: AgentTutorSession, now: datetime, *, resumed: bool = False) -> dict:
    state = state_of(row)
    open_ = state.phase in machine.OPEN_PHASES
    return {
        "id": row.id, "conversation_id": row.conversation_id, "persona_id": row.persona_id,
        "status": effective_status(row, now), "phase": state.phase, "step_index": step_number(state),
        "steps_total": len(state.plan), "level": level_name(state),
        "kind": current_item(state).kind if open_ else None,
        "hints_used": state.hints, "hints_max": machine.HINTS_MAX, "goal": row.goal,
        "answers": [{"index": a.index, "kind": a.kind, "verdict": a.verdict} for a in state.answers],
        "say": state.say or None, "recap": row.recap, "resumed": resumed,
        "created_at": iso_utc(row.created_at), "updated_at": iso_utc(row.updated_at),
    }


def meta_out(state: TutorState, verdict: str | None, *, retry: bool) -> dict:
    """SSE `meta` 事件数据(spec §4.4 + R-T3 追加键)。verdict 属于刚答的题,kind / say 属于现在等待的题。"""
    open_ = state.phase in machine.OPEN_PHASES
    return {"step_index": step_number(state), "steps_total": len(state.plan), "verdict": verdict,
            "kind": current_item(state).kind if open_ else None, "done": state.phase in ("wrap_up", "done"),
            "retry": retry, "say": state.say or None}


def hint_text(state: TutorState) -> str:
    """第一次提示优先用模型给的(META hint),否则 / 第二次用按题型的固定提示。"""
    if state.hints <= 1 and state.hint_text:
        return state.hint_text
    item = current_item(state)
    return FALLBACK_HINT.get(item.kind, FALLBACK_HINT["ask"]).format(words="、".join(item.words))


async def load_owned(session: AsyncSession, user_id: int, session_id: str) -> AgentTutorSession | None:
    row = await session.get(AgentTutorSession, session_id)
    return row if row is not None and row.user_id == user_id else None


async def _owned(session: AsyncSession, user_id: int, session_id: str) -> AgentTutorSession:
    row = await load_owned(session, user_id, session_id)
    if row is None:
        raise TutorError(404, "Not Found")
    return row


async def _owned_active(session: AsyncSession, user_id: int, session_id: str, now: datetime) -> AgentTutorSession:
    row = await _owned(session, user_id, session_id)
    status = effective_status(row, now)
    if status == EXPIRED:
        raise TutorError(409, "Tutor session expired")
    if status == DONE:
        raise TutorError(409, "Tutor session finished")
    return row


async def active_for(session: AsyncSession, user_id: int, conversation_id: str,
                     now: datetime) -> AgentTutorSession | None:
    rows = (await session.scalars(
        select(AgentTutorSession)
        .where(AgentTutorSession.user_id == user_id, AgentTutorSession.conversation_id == conversation_id,
               AgentTutorSession.status == ACTIVE)
        .order_by(AgentTutorSession.created_at.desc()))).all()
    found = None
    changed = False
    for row in rows:
        if found is None and effective_status(row, now) == ACTIVE:
            found = row
        else:  # 闲置过期,或并发开始留下的旧会话
            row.status = EXPIRED
            changed = True
    if changed:
        await session.commit()
    return found


async def find_existing(session: AsyncSession, user_id: int, conversation_id: str, client_start_id: str,
                        now: datetime) -> AgentTutorSession | None:
    row = await session.scalar(select(AgentTutorSession).where(
        AgentTutorSession.user_id == user_id, AgentTutorSession.client_start_id == client_start_id))
    if row is not None:
        if row.conversation_id != conversation_id:
            raise TutorError(409, "Tutor session id reused")
        return row
    return await active_for(session, user_id, conversation_id, now)


async def start(session: AsyncSession, settings, *, user_id: int, conversation_id: str, persona_id: str,
                level: str | None, goal: Goal, sources: PlanSources, client_start_id: str,
                now: datetime) -> tuple[AgentTutorSession, bool]:
    existing = await find_existing(session, user_id, conversation_id, client_start_id, now)
    if existing is not None:
        return existing, True
    day = usage.utc_day(now)
    if not await usage.consume(session, USAGE_SCOPE, str(user_id), day, settings.agents_tutor_daily_per_user):
        raise TutorError(429, "Daily tutor limit reached")
    state = new_state(tuple(build_plan(goal, sources)), level)
    row = AgentTutorSession(id=new_uuid(), user_id=user_id, conversation_id=conversation_id, room_id=None,
                            persona_id=persona_id, client_start_id=client_start_id, status=ACTIVE, goal=goal.to_dict(),
                            state=machine.to_dict(state), version=0, recap=None, created_at=now, updated_at=now,
                            finished_at=None)
    session.add(row)
    try:
        await session.commit()
    except IntegrityError:  # 同一 client_start_id 并发开始:另一请求先写入
        await session.rollback()
        await usage.refund(session, USAGE_SCOPE, str(user_id), day)
        again = await find_existing(session, user_id, conversation_id, client_start_id, now)
        if again is None:
            raise
        return again, True
    logger.info("tutor start topic=%s length=%d", goal.topic, len(state.plan))
    return row, False


async def _save(session: AsyncSession, row: AgentTutorSession, state: TutorState, now: datetime, **extra) -> None:
    result = await session.execute(
        update(AgentTutorSession)
        .where(AgentTutorSession.id == row.id, AgentTutorSession.version == row.version)
        .values(state=machine.to_dict(state), version=row.version + 1, updated_at=now, **extra)
        .execution_options(synchronize_session=False))
    if result.rowcount != 1:
        await session.rollback()
        raise TutorError(409, "Tutor session changed, reload")
    await session.commit()
    await session.refresh(row)


async def hint(session: AsyncSession, user_id: int, session_id: str, now: datetime) -> tuple[AgentTutorSession, str]:
    row = await _owned_active(session, user_id, session_id, now)
    current = state_of(row)
    if current.phase != "await_answer":
        raise TutorError(409, "Tutor session is not waiting for an answer")
    try:
        state = next_state(current, HintUsed())
    except InvalidTransition:
        raise TutorError(409, "Hint limit reached") from None
    await _save(session, row, state, now)
    return row, hint_text(state)


async def skip(session: AsyncSession, user_id: int, session_id: str, now: datetime) -> AgentTutorSession:
    row = await _owned_active(session, user_id, session_id, now)
    try:
        state = next_state(state_of(row), Skipped())
    except InvalidTransition:
        raise TutorError(409, "Tutor session is not waiting for an answer") from None
    await _save(session, row, state, now)
    return row


async def finish(session: AsyncSession, user_id: int, session_id: str, now: datetime, *,
                 on_recap: RecapHook | None = None) -> dict:
    """幂等;过期的会话也能结束(按已答生成总结)。先算好响应再调 on_recap:记忆写入失败时的 rollback 不影响响应。"""
    row = await _owned(session, user_id, session_id)
    if row.status == DONE:
        return out(row, now)
    state = next_state(state_of(row), Finished())
    data = build_recap(state, Goal.from_dict(row.goal))
    await _save(session, row, state, now, status=DONE, recap=data, finished_at=now)
    result = out(row, now)
    logger.info("tutor finish answered=%d total=%d", data["answered"], data["total"])
    if on_recap is not None:
        await on_recap(row, data)
    return result


async def apply_turn(session: AsyncSession, user_id: int, session_id: str, version: int, meta: Meta, answering: bool,
                     now: datetime) -> dict | None:
    """回合结束后推进状态机(handler.finish 调用)。版本对不上(并发回合 / 期间跳过了)就不推进,只回报当前状态。"""
    row = await load_owned(session, user_id, session_id)
    if row is None:
        return None
    current = state_of(row)
    if row.version != version or row.status != ACTIVE:
        logger.info("tutor turn conflict")
        return meta_out(current, None, retry=False)
    event = (Answered(meta.verdict or "ok", hint=meta.hint, say=meta.say) if answering
             else Asked(hint=meta.hint, say=meta.say))
    try:
        state = next_state(current, event)
        await _save(session, row, state, now)
    except (InvalidTransition, TutorError):
        logger.info("tutor turn conflict")
        return meta_out(current, None, retry=False)
    retry = answering and state.phase == "await_answer" and state.index == current.index
    return meta_out(state, meta.verdict if answering else None, retry=retry)
