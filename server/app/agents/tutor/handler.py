"""导师模式的 ModeHandler(spec §13;R-T2、R-T5、R-T6)。

prepare:读会话(归属、对话一致、进行中),按阶段校验 text / null,返回模式块(放在历史之后)与 max_tokens 350。
stream_filter:每回合新实例,剥掉 <<META>>。finish:用原始全文解析 META,回落规则,推进状态机,返回 meta 事件数据。
只记种类与数字。"""
import logging
from collections import OrderedDict
from collections.abc import Callable

from app.agents.orchestrator import ModeBlock, ModeError
from app.agents.tutor import service
from app.agents.tutor.parse import StreamFilter, parse_meta, resolve
from app.agents.tutor.plan import Goal
from app.agents.tutor.prompt import MAX_TOKENS, OPENING_USER_TEXT, tutor_block
from app.models import utcnow

logger = logging.getLogger(__name__)
PENDING_MAX = 1000
ANSWER_PHASES = frozenset({"await_answer"})
SPEAK_FIRST_PHASES = frozenset({"opening", "ask"})


class TutorModeHandler:
    name = "tutor"

    def __init__(self, sessionmaker, settings: Callable[[], object]):
        self._sessionmaker = sessionmaker
        self._settings = settings
        self._pending: OrderedDict[str, tuple[str, int, bool]] = OrderedDict()  # client_turn_id → (会话, 版本, 是否作答)

    async def prepare(self, req) -> ModeBlock:
        if not getattr(self._settings(), "agents_tutor_enabled", False):
            raise ModeError("disabled")
        if not req.tutor_session_id or req.in_room:
            raise ModeError("bad_request")
        now = utcnow()
        async with self._sessionmaker() as session:
            row = await service.load_owned(session, req.user_id, req.tutor_session_id)
            if (row is None or row.conversation_id != req.conversation_id
                    or service.effective_status(row, now) != service.ACTIVE):
                raise ModeError("bad_request")
            state, goal, version = service.state_of(row), Goal.from_dict(row.goal), row.version
        answering = req.text is not None
        if state.phase not in (ANSWER_PHASES if answering else SPEAK_FIRST_PHASES):
            raise ModeError("bad_request")
        self._remember(req.client_turn_id, req.tutor_session_id, version, answering)
        return ModeBlock(text=tutor_block(state, goal), max_tokens=MAX_TOKENS,
                         user_text=None if answering else OPENING_USER_TEXT)

    def stream_filter(self) -> StreamFilter:
        return StreamFilter()

    async def finish(self, req, full_text: str) -> dict | None:
        pending = self._pending.pop(req.client_turn_id, None)
        if pending is None:
            return None
        session_id, version, answering = pending
        _, meta = parse_meta(full_text)
        resolved, fell_back = resolve(meta, answering=answering)
        if fell_back:
            logger.info("tutor meta fallback answering=%s", answering)
        async with self._sessionmaker() as session:
            return await service.apply_turn(session, req.user_id, session_id, version, resolved, answering, utcnow())

    def _remember(self, turn_id: str, session_id: str, version: int, answering: bool) -> None:
        self._pending[turn_id] = (session_id, version, answering)
        self._pending.move_to_end(turn_id)
        while len(self._pending) > PENDING_MAX:
            self._pending.popitem(last=False)
