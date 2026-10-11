"""智能体测试工具:假上游(httpx.MockTransport,从不访问真实厂商)、SSE 解析、开关。"""
import asyncio
import json

import httpx


class Recording(httpx.AsyncByteStream):
    """上游响应体:记录 httpx 是否关闭了它;`gate` 挡住第一块之后的所有块,`delay` 是块间隔(秒)。"""

    def __init__(self, parts: list[bytes], *, gate: asyncio.Event | None = None, delay: float = 0.0):
        self.parts, self.gate, self.delay, self.closed = list(parts), gate, delay, False

    async def __aiter__(self):
        for i, part in enumerate(self.parts):
            if i and self.gate is not None:
                await self.gate.wait()
            if i and self.delay:
                await asyncio.sleep(self.delay)
            yield part

    async def aclose(self) -> None:
        self.closed = True


def _data(obj) -> bytes:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n".encode()


def sse_body(texts=("Hello", " there."), *, reasoning=(), usage=(12, 5)) -> list[bytes]:
    parts = [_data({"choices": [{"index": 0, "delta": {"reasoning_content": r}}]}) for r in reasoning]
    parts += [_data({"choices": [{"index": 0, "delta": {"content": t}}]}) for t in texts]
    if usage:
        parts.append(_data({"choices": [], "usage": {"prompt_tokens": usage[0], "completion_tokens": usage[1]}}))
    parts.append(b"data: [DONE]\n\n")
    return parts


class FakeLLM:
    """OpenAI 兼容 /chat/completions 假上游。stream=true 返回 SSE(Recording);否则返回普通 JSON
    (`tool_call` 给了就返回一个函数调用)。`requests` 收集每次请求体,`streams` 收集每个流。"""

    def __init__(self, texts=("Hello", " there."), *, reasoning=(), usage=(12, 5), status: int = 200,
                 gate: asyncio.Event | None = None, delay: float = 0.0, first_delay: float = 0.0,
                 error_body: bytes = b'{"error":{"message":"upstream-secret-body"}}', tool_call: dict | None = None,
                 parts: list[bytes] | None = None):
        self.texts, self.reasoning, self.usage, self.status = tuple(texts), tuple(reasoning), usage, status
        self.gate, self.delay, self.first_delay, self.error_body = gate, delay, first_delay, error_body
        self.tool_call, self.parts = tool_call, parts
        self.requests: list[dict] = []
        self.streams: list[Recording] = []

    async def handler(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        self.requests.append(body)
        if self.first_delay:
            await asyncio.sleep(self.first_delay)
        if self.status != 200:
            return httpx.Response(self.status, content=self.error_body)
        if not body.get("stream"):
            message: dict = {"role": "assistant", "content": "".join(self.texts)}
            if self.tool_call is not None:
                message = {"role": "assistant", "content": None, "tool_calls": [
                    {"id": "call_1", "type": "function", "function": dict(self.tool_call)}]}
            return httpx.Response(200, json={"choices": [{"index": 0, "message": message}],
                                             "usage": {"prompt_tokens": 9, "completion_tokens": 3}})
        parts = self.parts if self.parts is not None else sse_body(self.texts, reasoning=self.reasoning,
                                                                  usage=self.usage)
        stream = Recording(parts, gate=self.gate, delay=self.delay)
        self.streams.append(stream)
        return httpx.Response(200, stream=stream, headers={"content-type": "text/event-stream"})

    def client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=httpx.MockTransport(self.handler))


async def use_fake_llm(app, fake: FakeLLM) -> FakeLLM:
    """换掉 app.state.http(conftest 的 app 夹具在结束时关闭它)。"""
    await app.state.http.aclose()
    app.state.http = fake.client()
    return fake


def enable_agents(app, **overrides) -> None:
    app.state.settings = app.state.settings.model_copy(update={"agents_enabled": True, **overrides})


def parse_sse(text: str) -> list[tuple[str, dict]]:
    out = []
    for block in text.strip().split("\n\n"):
        if not block.strip():
            continue
        lines = block.splitlines()
        event = next(line[7:] for line in lines if line.startswith("event: "))
        data = next(line[6:] for line in lines if line.startswith("data: "))
        out.append((event, json.loads(data)))
    return out


def make_deps(app, *, registry=None, modes=None, hooks=None, probe=None):
    """直接驱动 run_turn 的依赖(不经路由);设置每次读 app.state.settings。"""
    from app.agents.orchestrator import AgentsRuntime, TurnDeps
    rt = AgentsRuntime()
    return TurnDeps(http=app.state.http, settings=lambda: app.state.settings, sessions=app.state.sessionmaker,
                    registry=registry or rt.registry, modes=modes or rt.modes, hooks=hooks or rt.hooks, app=app,
                    tools_probe=lambda: probe, spawn=rt.spawn), rt


def make_request(user_id: int, persona=None, *, text="Hello", history=(), mode="chat", agent_settings=None,
                 in_room=False, charge=True):
    from app.agents.orchestrator import TurnRequest
    from app.agents.personas import builtin_by_id
    from app.agents.settings import DEFAULTS
    return TurnRequest(user_id=user_id, persona=persona or builtin_by_id("builtin:partner"), conversation_id="c1",
                       room_id=None, text=text, history=list(history), mode=mode, tutor_session_id=None,
                       client_turn_id="11111111-1111-4111-8111-111111111111", in_room=in_room,
                       agent_settings=agent_settings or DEFAULTS, charge=charge)


async def run_events(deps, req) -> list:
    from app.agents.orchestrator import run_turn
    return [e async for e in run_turn(deps, req)]
