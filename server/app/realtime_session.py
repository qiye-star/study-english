"""实时通话状态机(计划 R12–R15)。只依赖注入的上游;日志只记类别与数字,不记文本。

并发模型(单个事件循环):
- 读取任务 `_pump` 把客户端消息放进**有界**收件箱;满了就不再读套接字(背压回到 TCP)。
- 主循环 `run` 逐条处理消息、计算静音/时长限额;打断在主循环里同步完成(取消并等待回复任务结束)。
- 每句用户话语一个 `_Turn` 任务:识别 → 按说话顺序保存 → (可选)回复。回复内部 LLM 与 TTS 两个子任务
  经有界句子队列相连;下行发送串行化(同一把锁),慢的消费者只会让上游读取停下,不会堆内存。
- 任一时刻至多一轮在回复:新的一轮只能在打开识别器时产生,而打开识别器前会打断当前一轮
  (回复中 → 取消并等待结束;识别中 → 标记不回复)。被打断的回复的音频不会再下发。
"""
import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, field, replace
from typing import Protocol

from app.asr import MAX_UTTERANCE_BYTES, AsrError, RecognizerFactory, UtteranceRecognizer
from app.realtime_protocol import (
    CLOSE_IDLE, CLOSE_MAX_DURATION, CLOSE_MESSAGE_LIMIT, CLOSE_NORMAL, CLOSE_NOT_FOUND, CLOSE_PROTOCOL, CLOSE_UPSTREAM,
    HangupMsg, InterruptMsg, ProtocolError, UtteranceEndMsg, audio_frame, check_uplink, parse_client_message,
)
from app.sentence_split import SentenceSplitter

logger = logging.getLogger(__name__)

INBOX_MAX = 32  # 客户端消息(每条 ≤ 32 KB)
SENTENCE_QUEUE_MAX = 4  # LLM 领先 TTS 的句数上限
SEND_TIMEOUT = 15.0  # 一次下行发送超过这么久 → 视为连接已死
FINISH_GRACE = 5.0  # 挂断时等待"只差保存"的一轮这么久
INTERRUPTED_SUFFIX = " …"


class MessageLimitError(Exception):
    pass


class ConversationGoneError(Exception):
    pass


class LlmError(Exception):
    pass


class TtsError(Exception):
    pass


class MessageStore(Protocol):
    async def history(self, limit: int) -> list[dict]: ...

    async def add_user(self, text: str) -> str: ...

    async def add_assistant(self, text: str) -> str: ...


class Assessor(Protocol):
    async def assess(self, message_id: str, pcm: bytes, text: str) -> dict: ...


LlmStream = Callable[[list[dict]], AsyncIterator[str]]
TtsStream = Callable[[str], AsyncIterator[bytes]]


@dataclass
class RealtimeLimits:
    max_seconds: float
    idle_seconds: float
    history: int = 20


@dataclass
class Upstreams:
    recognizers: RecognizerFactory
    fallback: RecognizerFactory | None
    asr_mode: str
    llm: LlmStream
    tts: TtsStream
    assessor: Assessor | None


@dataclass
class CallStats:
    turns: int = 0
    interrupts: int = 0


@dataclass
class _Turn:
    after: asyncio.Event | None
    saved: asyncio.Event = field(default_factory=asyncio.Event)
    task: asyncio.Task | None = None
    # recognising → replying(可被打断取消)→ finishing(回复已完整下发,只剩保存/收尾,不可打断)
    phase: str = "recognising"
    skip_reply: bool = False


class _DeadRecognizer:
    """流式识别中途失败且没有兜底:吞掉这一句剩下的音频,结束时报 asr_failed(而不是把半句当成新的一句)。"""

    async def send_audio(self, pcm: bytes) -> None:
        return None

    async def finish(self) -> str:
        raise AsrError("upstream")

    async def abort(self) -> None:
        return None


_WAKE = object()
_CLOSED = object()


async def _abort(recognizer: UtteranceRecognizer | None) -> None:
    if recognizer is not None:
        with contextlib.suppress(Exception):
            await recognizer.abort()


@contextlib.asynccontextmanager
async def _closing(stream):
    """保证上游流(异步生成器)在取消/出错时被关闭,释放其 HTTP 连接。"""
    try:
        yield stream
    finally:
        aclose = getattr(stream, "aclose", None)
        if aclose is not None:
            with contextlib.suppress(Exception):
                await aclose()


async def _settle(task: asyncio.Task, timeout: float | None = None) -> bool:
    """等待任务结束而不吞掉调用方自己的取消;返回是否已结束。"""
    done, _ = await asyncio.wait([task], timeout=timeout)
    if task in done and not task.cancelled():
        task.exception()  # 已在任务内记录;这里只是取走,避免 "never retrieved"
    return bool(done)


class RealtimeSession:
    def __init__(self, *, upstreams: Upstreams, store: MessageStore, system_prompt: str, allow_turn: Callable[[], bool],
                 send_json: Callable[[dict], Awaitable[None]], send_bytes: Callable[[bytes], Awaitable[None]],
                 limits: RealtimeLimits, clock: Callable[[], float] | None = None):
        self._up = upstreams
        self._store = store
        self._system = system_prompt
        self._allow_turn = allow_turn
        self._send_json = send_json
        self._send_bytes = send_bytes
        self._limits = limits
        self._clock = clock
        self.stats = CallStats()
        self._queue: asyncio.Queue = asyncio.Queue(maxsize=INBOX_MAX)
        self._send_lock = asyncio.Lock()
        self._closed = False
        self._fatal: int | None = None
        self._state = "listening"
        self._recognizer: UtteranceRecognizer | None = None
        self._recognizer_is_fallback = False  # 当前这句的识别器来自兜底(失败了不必再用兜底重试)
        self._degraded = False
        self._utterance = bytearray()
        self._turn: _Turn | None = None
        self._turn_tasks: dict[asyncio.Task, _Turn] = {}
        self._turn_id = 0
        self._speaking_turn: int | None = None
        self._unanswered = False
        self._assessments: set[asyncio.Task] = set()
        self._last_activity = 0.0

    # ---- 发送 ----
    async def _deliver(self, send: Callable, payload) -> None:
        if self._closed:
            return
        async with self._send_lock:
            if self._closed:
                return
            try:
                async with asyncio.timeout(SEND_TIMEOUT):
                    await send(payload)
            except Exception as e:  # 包括超时:连接已不可用
                logger.info("realtime send failed error=%s", type(e).__name__)
                self._closed = True
                self._fail(CLOSE_NORMAL)

    async def _send(self, event: dict) -> None:
        await self._deliver(self._send_json, event)

    async def _send_audio(self, data: bytes) -> None:
        await self._deliver(self._send_bytes, data)

    async def _set_state(self, state: str) -> None:
        if state != self._state:
            self._state = state
            await self._send({"type": "state", "state": state})

    def _wake(self) -> None:
        with contextlib.suppress(asyncio.QueueFull):
            self._queue.put_nowait(_WAKE)  # 收件箱满时主循环本来就会醒

    def _fail(self, code: int) -> None:
        if self._fatal is None:
            self._fatal = code
            self._wake()

    def _now(self) -> float:
        return self._clock() if self._clock is not None else asyncio.get_running_loop().time()

    def _busy(self) -> bool:
        return any(not t.done() for t in self._turn_tasks)

    # ---- 主循环 ----
    async def _pump(self, receive: Callable[[], Awaitable[str | bytes | None]]) -> None:
        try:
            while True:
                item = await receive()
                if item is None:
                    break
                await self._queue.put(item)
        except Exception as e:  # 套接字异常 = 客户端断开
            logger.info("realtime receive ended error=%s", type(e).__name__)
        await self._queue.put(_CLOSED)

    def _limit_reached(self, deadline: float) -> tuple[int | None, float]:
        """(关闭码或 None, 下一次需要重新检查前可以等待的秒数)。"""
        if self._fatal is not None:
            return self._fatal, 0
        now = self._now()
        if now >= deadline:
            return CLOSE_MAX_DURATION, 0
        timeout = deadline - now
        if not self._busy():
            idle_left = self._last_activity + self._limits.idle_seconds - now
            if idle_left <= 0:
                return CLOSE_IDLE, 0
            timeout = min(timeout, idle_left)
        return None, timeout

    async def run(self, receive: Callable[[], Awaitable[str | bytes | None]]) -> int:
        reader = asyncio.create_task(self._pump(receive))
        deadline = self._now() + self._limits.max_seconds
        self._last_activity = self._now()
        try:
            await self._send({"type": "ready", "asr": self._up.asr_mode})
            await self._send({"type": "state", "state": "listening"})
            while True:
                code, timeout = self._limit_reached(deadline)
                if code is not None:
                    return code
                try:
                    item = await asyncio.wait_for(self._queue.get(), timeout)
                except TimeoutError:
                    continue
                if self._fatal is not None:
                    return self._fatal
                if self._now() >= deadline:
                    return CLOSE_MAX_DURATION
                if item is _WAKE:
                    continue
                if item is _CLOSED:
                    return CLOSE_NORMAL
                if isinstance(item, (bytes, bytearray, memoryview)):
                    await self._on_audio(bytes(item))
                    continue
                msg = parse_client_message(item)
                if isinstance(msg, HangupMsg):
                    return CLOSE_NORMAL
                if isinstance(msg, InterruptMsg):
                    await self._interrupt()
                elif isinstance(msg, UtteranceEndMsg):
                    await self._on_utterance_end()
                else:
                    raise ProtocolError("start was already received")
        except ProtocolError:
            return CLOSE_PROTOCOL
        finally:
            reader.cancel()
            await _settle(reader)
            await self._shutdown()
            self._closed = True  # 之后到达的事件(迟到的评测等)一律丢弃

    # ---- 上行音频与断句 ----
    async def _on_partial(self, text: str) -> None:
        await self._send({"type": "transcript_partial", "text": text})

    async def _degrade(self) -> bool:
        """流式识别不可用 → 本通话余下部分改用兜底(R3),只降级一次、只发一次 degraded。
        返回现在是否在用兜底(已经降级过也算);没有兜底返回 False。"""
        if self._degraded:
            return True
        if self._up.fallback is None:
            return False
        logger.warning("realtime asr degraded to fallback")
        self._degraded = True
        self._up = replace(self._up, recognizers=self._up.fallback, fallback=None, asr_mode="buffered")
        await self._send({"type": "degraded", "reason": "asr"})
        return True

    async def _open_recognizer(self) -> UtteranceRecognizer | None:
        degraded = self._degraded
        try:
            recognizer = await self._up.recognizers(self._on_partial)
            self._recognizer_is_fallback = degraded
            return recognizer
        except Exception as e:
            logger.warning("realtime asr open failed error=%s", type(e).__name__)
            if degraded or not await self._degrade():
                self._fail(CLOSE_UPSTREAM)
                return None
        try:
            recognizer = await self._up.recognizers(self._on_partial)
            self._recognizer_is_fallback = True
            return recognizer
        except Exception as e:
            logger.warning("realtime asr fallback open failed error=%s", type(e).__name__)
            self._fail(CLOSE_UPSTREAM)
            return None

    async def _fallback_with(self, pcm: bytes) -> UtteranceRecognizer | None:
        """降级后打开兜底识别器并把这一句已收到的音频补给它;失败返回 None。"""
        recognizer = None
        try:
            recognizer = await self._up.recognizers(self._on_partial)
            if pcm:
                await recognizer.send_audio(pcm)
            return recognizer
        except Exception as e:
            logger.warning("realtime asr fallback failed error=%s", type(e).__name__)
            await _abort(recognizer)
            return None

    async def _on_audio(self, data: bytes) -> None:
        check_uplink(data)
        self._last_activity = self._now()
        if self._fatal is not None:
            return
        if self._recognizer is None:
            if self._busy():
                await self._interrupt()  # 用户开口:打断(R12)
            self._recognizer = await self._open_recognizer()
            if self._recognizer is None:
                return
        room = MAX_UTTERANCE_BYTES - len(self._utterance)
        if room > 0:
            self._utterance += data[:room]
        try:
            await self._recognizer.send_audio(data)
        except Exception as e:
            logger.warning("realtime asr send failed error=%s", type(e).__name__)
            await _abort(self._recognizer)
            retry = not self._recognizer_is_fallback and await self._degrade()
            replacement = await self._fallback_with(bytes(self._utterance)) if retry else None
            self._recognizer = replacement or _DeadRecognizer()
            self._recognizer_is_fallback = True

    async def _on_utterance_end(self) -> None:
        recognizer, pcm, is_fallback = self._recognizer, bytes(self._utterance), self._recognizer_is_fallback
        self._recognizer, self._utterance, self._recognizer_is_fallback = None, bytearray(), False
        if recognizer is None:
            return
        previous = self._turn
        turn = _Turn(after=previous.saved if previous else None)
        self._turn = turn
        await self._set_state("thinking")
        turn.task = asyncio.create_task(self._run_turn(turn, recognizer, pcm, is_fallback))
        self._turn_tasks[turn.task] = turn
        turn.task.add_done_callback(lambda t: self._turn_tasks.pop(t, None))

    async def _interrupt(self) -> None:
        turn = self._turn
        if turn is None or turn.task is None or turn.task.done():
            return
        if turn.phase == "replying":
            self.stats.interrupts += 1
            turn.task.cancel()
            await _settle(turn.task)
            await self._set_state("listening")
        elif turn.phase == "recognising" and not turn.skip_reply:
            self.stats.interrupts += 1
            turn.skip_reply = True
        # finishing:回复已完整下发,没有可打断的

    # ---- 一轮:识别 → 保存 → 回复 ----
    async def _recognise(self, recognizer: UtteranceRecognizer, pcm: bytes, is_fallback: bool) -> str | None:
        """转写文本("" = 没听到话);None = 识别失败(已下发 asr_failed)。"""
        try:
            return (await recognizer.finish()).strip()
        except asyncio.CancelledError:
            await _abort(recognizer)
            raise
        except Exception as e:
            logger.warning("realtime asr finish failed error=%s", type(e).__name__)
            await _abort(recognizer)
        if not is_fallback and await self._degrade():  # 流式这句失败:用这句的全部音频走兜底重试
            fallback = await self._fallback_with(pcm)
            if fallback is not None:
                try:
                    return (await fallback.finish()).strip()
                except asyncio.CancelledError:
                    await _abort(fallback)
                    raise
                except Exception as e:
                    logger.warning("realtime asr fallback finish failed error=%s", type(e).__name__)
                    await _abort(fallback)
        await self._send({"type": "error", "code": "asr_failed"})
        return None

    async def _save_user(self, text: str) -> str | None:
        try:
            return await self._store.add_user(text)
        except MessageLimitError:
            await self._send({"type": "error", "code": "message_limit"})
            self._fail(CLOSE_MESSAGE_LIMIT)
        except ConversationGoneError:
            self._fail(CLOSE_NOT_FOUND)
        except Exception as e:
            logger.warning("realtime save user message failed error=%s", type(e).__name__)
        return None

    async def _run_turn(self, turn: _Turn, recognizer: UtteranceRecognizer, pcm: bytes, is_fallback: bool) -> None:
        try:
            text = await self._recognise(recognizer, pcm, is_fallback)
            if turn.after is not None:
                await turn.after.wait()  # 保存顺序与说话顺序一致
            if self._fatal is not None:
                return  # 通话正在关闭(例如消息已满):不再保存,也不重复报错
            message_id = None
            if text:
                if not self._allow_turn():
                    await self._send({"type": "error", "code": "rate_limited"})
                    return
                try:
                    message_id = await self._save_user(text)
                    if message_id is not None:
                        self._unanswered = True  # 与放行下一轮之间没有 await:下一轮一定看得到
                finally:
                    turn.saved.set()  # 立刻放行下一轮的保存
                if message_id is None:
                    return
                self.stats.turns += 1
                await self._send({"type": "transcript_final", "text": text, "message_id": message_id})
                if self._up.assessor is not None and pcm:
                    self._spawn_assessment(message_id, pcm, text)
            elif text == "":
                await self._send({"type": "transcript_final", "text": "", "message_id": None})
            turn.saved.set()
            if turn.skip_reply:
                # 被新的话语打断:这句先不回复,由下一轮一起回复(下一轮若只是误触发,也要回复这一句)
                return
            if not self._unanswered or self._fatal is not None or self._closed:
                return
            turn.phase = "replying"  # 与上面的 skip_reply 检查之间没有 await:打断要么标记跳过,要么取消回复
            try:
                history = await self._store.history(self._limits.history)
            except ConversationGoneError:
                self._fail(CLOSE_NOT_FOUND)
                return
            except Exception as e:
                logger.warning("realtime history failed error=%s", type(e).__name__)
                return
            messages = ([{"role": "system", "content": self._system}] if self._system.strip() else []) + history
            self._unanswered = False  # 在读历史时被打断的话,这句仍算未回复
            await self._reply(turn, messages)
        finally:
            turn.saved.set()
            turn.phase = "finishing"
            if self._turn is turn:
                self._last_activity = self._now()  # 静音从这一轮结束时重新计时
                await self._set_state("listening")
            self._wake()  # 让主循环重新计算静音超时

    async def _save_assistant(self, text: str) -> str | None:
        try:
            return await self._store.add_assistant(text)
        except MessageLimitError:
            await self._send({"type": "error", "code": "message_limit"})
            self._fail(CLOSE_MESSAGE_LIMIT)
        except ConversationGoneError:
            self._fail(CLOSE_NOT_FOUND)
        except Exception as e:
            logger.warning("realtime save reply failed error=%s", type(e).__name__)
        return None

    async def _reply(self, turn: _Turn, messages: list[dict]) -> None:
        self._turn_id += 1
        turn_id = self._turn_id
        self._speaking_turn = turn_id
        splitter = SentenceSplitter()
        sentences: asyncio.Queue[str | None] = asyncio.Queue(maxsize=SENTENCE_QUEUE_MAX)
        full: list[str] = []
        spoken: list[str] = []

        async def produce() -> None:
            try:
                async with _closing(self._up.llm(messages)) as stream:
                    async for delta in stream:
                        if not delta:
                            continue
                        full.append(delta)
                        await self._send({"type": "reply_delta", "turn_id": turn_id, "text": delta})
                        for sentence in splitter.feed(delta):
                            await sentences.put(sentence)
                for sentence in splitter.flush():
                    await sentences.put(sentence)
            except LlmError:
                raise
            except Exception as e:
                logger.warning("realtime llm failed error=%s", type(e).__name__)
                raise LlmError() from None
            await sentences.put(None)

        async def speak() -> None:
            audio_ok = True
            while (sentence := await sentences.get()) is not None:
                if not audio_ok:
                    continue
                await self._set_state("speaking")
                try:
                    async with _closing(self._up.tts(sentence)) as stream:
                        async for chunk in stream:
                            if self._speaking_turn != turn_id or self._closed:
                                return  # 防御:过期的轮次绝不下发音频
                            if chunk:
                                await self._send_audio(audio_frame(turn_id, chunk))
                    spoken.append(sentence)
                except Exception as e:  # TtsError 或任何意外:这一轮余下只给文字
                    logger.warning("realtime tts failed error=%s", type(e).__name__)
                    audio_ok = False
                    await self._send({"type": "error", "code": "tts_failed"})

        failed = cancelled = False
        try:
            try:
                async with asyncio.TaskGroup() as group:
                    group.create_task(produce())
                    group.create_task(speak())
            except* LlmError:  # except* 不能与普通 except 写在同一个 try 里,所以分两层
                failed = True
        except asyncio.CancelledError:
            cancelled = True  # 打断/挂断:TaskGroup 已取消并等待 LLM 与 TTS 子任务
        turn.phase = "finishing"  # 从这里起不再可被打断(下面没有可取消的下发)
        if self._speaking_turn == turn_id:
            self._speaking_turn = None
        try:
            if failed or cancelled:
                if failed:
                    await self._send({"type": "error", "code": "llm_failed"})
                message_id = await self._save_assistant(" ".join(spoken) + INTERRUPTED_SUFFIX) if spoken else None
                await self._send({"type": "reply_done", "turn_id": turn_id, "message_id": message_id, "interrupted": True})
            else:
                content = "".join(full).strip()
                message_id = await self._save_assistant(content) if content else None
                await self._send({"type": "reply_done", "turn_id": turn_id, "message_id": message_id, "interrupted": False})
        finally:
            if cancelled:
                raise asyncio.CancelledError()

    # ---- 评测与收尾 ----
    def _spawn_assessment(self, message_id: str, pcm: bytes, text: str) -> None:
        assessor = self._up.assessor

        async def job() -> None:
            try:
                payload = await assessor.assess(message_id, pcm, text)
            except Exception as e:
                logger.warning("realtime assessment failed error=%s", type(e).__name__)
                payload = {"status": "failed"}
            await self._send({"type": "assessment", "message_id": message_id, **payload})

        task = asyncio.create_task(job())
        self._assessments.add(task)
        task.add_done_callback(self._assessments.discard)

    async def _shutdown(self) -> None:
        for task, turn in list(self._turn_tasks.items()):
            if turn.phase != "finishing":
                task.cancel()  # 回复中:保存已说出的部分;识别中:中止识别器
            if not await _settle(task, FINISH_GRACE):
                task.cancel()
                await _settle(task)
        recognizer, self._recognizer = self._recognizer, None
        await _abort(recognizer)

    async def drain(self, timeout: float = 10.0) -> None:
        self._closed = True
        pending = set(self._assessments)
        if pending:
            _, late = await asyncio.wait(pending, timeout=timeout)
            for task in late:
                task.cancel()
            if late:
                await asyncio.wait(late)
