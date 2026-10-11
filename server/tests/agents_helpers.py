"""智能体测试工具:假上游(httpx.MockTransport,从不访问真实厂商)、SSE 解析、开关。"""
import asyncio
import json
import os
import re
from pathlib import Path

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


async def new_conversation(client, headers) -> str:
    r = await client.post("/api/conversations", headers=headers, json={"name": "Agents"})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def turn_body(conversation_id: str, **overrides) -> dict:
    import uuid
    body = {"persona_id": "builtin:partner", "conversation_id": conversation_id, "text": "Hello", "history": [],
            "mode": "chat", "tutor_session_id": None, "client_turn_id": str(uuid.uuid4())}
    body.update(overrides)
    return body


def shape(value):
    """嵌套键集合(与 tests/links_helpers.shape 相同;复制一份,不导入别的测试模块)。"""
    if isinstance(value, dict):
        return {k: shape(v) for k, v in sorted(value.items())}
    if isinstance(value, list):
        return [shape(value[0])] if value and isinstance(value[0], (dict, list)) else []
    return None


_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}")
TIMING_KEYS = ("ms", "ctx", "ttft", "total")


def stable(value):
    """把随机 / 计时值换成固定值,重录夹具不会无谓抖动:uuid、ISO 时间、毫秒数。"""
    if isinstance(value, dict):
        return {k: (0 if k in TIMING_KEYS and isinstance(v, (int, float)) and not isinstance(v, bool) else stable(v))
                for k, v in value.items()}
    if isinstance(value, list):
        return [stable(v) for v in value]
    if isinstance(value, str):
        if _UUID.match(value):
            return "00000000-0000-4000-8000-000000000000"
        if _ISO.match(value):
            return "2026-01-01T00:00:00Z"
    return value


def check_contract(name: str, actual: dict) -> None:
    """`CONTRACT_UPDATE=1` 重录 `fixtures/<name>.json`;否则按形状比较。样例里不能有令牌或密钥。"""
    fixture = Path(__file__).parent / "fixtures" / f"{name}.json"
    actual = stable(actual)
    if os.environ.get("CONTRACT_UPDATE"):
        fixture.write_text(json.dumps(actual, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    expected = json.loads(fixture.read_text(encoding="utf-8"))
    assert shape(actual) == shape(expected)
    raw = fixture.read_text(encoding="utf-8")
    assert "access_token" not in raw and "secret" not in raw.lower() and "Bearer" not in raw
