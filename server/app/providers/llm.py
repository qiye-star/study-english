"""OpenAI-compatible chat completion for server-side features: non-streaming `complete` (rank judge/examiner,
room assistant, summaries), streaming `complete_stream` (agents spec 2026-10-12 §3.3) and the native function
calling probe `probe_tools` (§6.2). Never logs prompts, replies or keys: only the failure kind and HTTP status."""
import asyncio
import json
import logging
import time
from contextlib import AsyncExitStack
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Literal

import httpx

from app.core import metering
from app.core.config import LLM_THINKING_HOST_SUFFIXES, Settings, send_thinking_param

logger = logging.getLogger(__name__)

STREAM_TOTAL_SECONDS = 120.0  # 评审 #6:一次流式调用的总期限(含等首包);60 s 读间隔只管「卡住」,管不了「一直滴答」


class LlmUnavailable(Exception):
    """kind: config | network | http | format | empty | timeout (total deadline) | upstream (in-band error object). `status` is the upstream HTTP status (0 = none)."""

    def __init__(self, kind: str = "http", status: int = 0):
        super().__init__(kind)
        self.kind = kind
        self.status = status


@dataclass(frozen=True)
class Delta:
    """One piece of a streamed reply. kind "text" / "reasoning" carry `text`; kind "usage" carries (in, out) tokens."""
    kind: Literal["text", "reasoning", "usage"]
    text: str = ""
    usage: tuple[int, int] | None = None


def _endpoint(settings: Settings) -> tuple[str, dict]:
    url = settings.upstream_llm_base_url.rstrip("/") + "/chat/completions"
    headers = {"Authorization": f"Bearer {settings.upstream_llm_key}", "Content-Type": "application/json"}
    return url, headers


def _body(settings: Settings, messages: list[dict], *, model: str, max_tokens: int, temperature: float,
          stream: bool, thinking: bool = False) -> dict:
    body = {
        "model": model,
        "messages": messages,
        "max_tokens": min(max_tokens, settings.llm_max_tokens),
        "temperature": temperature,
        "stream": stream,
    }
    # `thinking=True` (a deep-think persona) leaves the parameter out, so the upstream's default reasoning applies
    if not thinking and send_thinking_param(settings.realtime_llm_disable_thinking, settings.upstream_llm_base_url,
                                            LLM_THINKING_HOST_SUFFIXES):
        body["thinking"] = {"type": "disabled"}
    if stream:
        body["stream_options"] = {"include_usage": True}
    return body


async def complete(http: httpx.AsyncClient, settings: Settings, messages: list[dict], *, model: str,
                   max_tokens: int, temperature: float, timeout: float = 60.0) -> str:
    if not settings.upstream_llm_base_url:
        raise LlmUnavailable("config")
    url, headers = _endpoint(settings)
    body = _body(settings, messages, model=model, max_tokens=max_tokens, temperature=temperature, stream=False)
    provider = metering.provider_of(settings.upstream_llm_base_url)
    timer = metering.Timer()
    try:
        response = await http.post(url, json=body, headers=headers, timeout=httpx.Timeout(timeout, connect=10.0))
    except httpx.HTTPError as e:
        metering.record("llm", provider, model, 0, timer.ms())
        logger.warning("llm complete failed error=%s", type(e).__name__)
        raise LlmUnavailable("network") from None
    try:
        payload = response.json()
    except ValueError:
        payload = None
    tokens = metering.tokens_of(payload)
    if tokens:
        metering.record("llm", provider, model, response.status_code, timer.ms(), units_in=tokens[0],
                        units_out=tokens[1], unit="tokens")
    else:
        metering.record("llm", provider, model, response.status_code, timer.ms(), units_out=len(response.content),
                        unit="bytes")
    if response.status_code != 200:
        logger.warning("llm complete http status=%s", response.status_code)
        raise LlmUnavailable("http", response.status_code)
    try:
        content = payload["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        raise LlmUnavailable("format") from None
    if not isinstance(content, str) or not content.strip():
        raise LlmUnavailable("empty")
    return content.strip()


def _sse_data(line: str) -> str | None:
    line = line.strip()
    if not line.startswith("data:"):
        return None  # blank separators, `event:` lines and `:` keep-alive comments
    return line[5:].strip()


def _pieces(chunk: object) -> list[tuple[str, str]]:
    choices = chunk.get("choices") if isinstance(chunk, dict) else None
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        return []
    delta = choices[0].get("delta")
    if not isinstance(delta, dict):
        return []
    out = []
    reasoning, content = delta.get("reasoning_content"), delta.get("content")
    if isinstance(reasoning, str) and reasoning:
        out.append(("reasoning", reasoning))
    if isinstance(content, str) and content:
        out.append(("text", content))
    return out


async def complete_stream(http: httpx.AsyncClient, settings: Settings, messages: list[dict], *, model: str,
                          max_tokens: int, temperature: float, thinking: bool = False,
                          timeout: float = 60.0, total_timeout: float | None = None) -> AsyncIterator[Delta]:
    """Streamed chat completion. Yields Delta in arrival order (reasoning, text, a final usage). Raises
    LlmUnavailable before the first delta (config / http / network) or later (network / empty). Closing the
    iterator (`aclose`, cancellation, a disconnected client) leaves the `async with` and closes the upstream
    response at once. `total_timeout` (default STREAM_TOTAL_SECONDS) bounds the whole call: LlmUnavailable("timeout").
    An in-band `{"error": ...}` chunk is a failure (LlmUnavailable("upstream"), body never logged or returned).
    Metered once per call (tokens when the upstream sent usage, else bytes; status 0 = broken)."""
    if not settings.upstream_llm_base_url:
        raise LlmUnavailable("config")
    url, headers = _endpoint(settings)
    body = _body(settings, messages, model=model, max_tokens=max_tokens, temperature=temperature, stream=True,
                 thinking=thinking)
    provider = metering.provider_of(settings.upstream_llm_base_url)
    timer = metering.Timer()
    status, received, tokens, produced = 0, 0, None, False
    deadline = time.monotonic() + (STREAM_TOTAL_SECONDS if total_timeout is None else total_timeout)

    def remaining() -> float:
        left = deadline - time.monotonic()
        if left <= 0:
            raise LlmUnavailable("timeout", status)
        return left

    try:
        async with AsyncExitStack() as stack:
            try:
                response = await asyncio.wait_for(stack.enter_async_context(
                    http.stream("POST", url, json=body, headers=headers,
                                timeout=httpx.Timeout(timeout, connect=10.0))), remaining())
            except TimeoutError:
                raise LlmUnavailable("timeout") from None
            status = response.status_code
            if status != 200:
                logger.warning("llm stream http status=%s", status)
                raise LlmUnavailable("http", status)
            lines = response.aiter_lines().__aiter__()
            while True:
                try:
                    line = await asyncio.wait_for(lines.__anext__(), remaining())
                except StopAsyncIteration:
                    break
                except TimeoutError:
                    raise LlmUnavailable("timeout", status) from None
                received += len(line) + 1
                data = _sse_data(line)
                if data is None:
                    continue
                if data == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                except ValueError:
                    continue
                if isinstance(chunk, dict) and chunk.get("error"):
                    logger.warning("llm stream in-band error")
                    raise LlmUnavailable("upstream", status)
                found = metering.tokens_of(chunk)
                if found:
                    tokens = found
                    yield Delta("usage", usage=found)
                for kind, text in _pieces(chunk):
                    produced = True
                    yield Delta(kind, text)
        if not produced:
            raise LlmUnavailable("empty", status)
    except httpx.HTTPError as e:
        status = 0
        logger.warning("llm stream failed error=%s", type(e).__name__)
        raise LlmUnavailable("network") from None
    except LlmUnavailable as e:
        if e.kind in ("timeout", "upstream"):
            status = 0  # a broken stream is not a 200 success in the meter
        raise
    finally:
        if tokens:
            metering.record("llm", provider, model, status, timer.ms(), units_in=tokens[0], units_out=tokens[1],
                            unit="tokens")
        else:
            metering.record("llm", provider, model, status, timer.ms(), units_out=received, unit="bytes")


PROBE_TOOL = {
    "type": "function",
    "function": {
        "name": "lookup_word",
        "description": "Look up an English word in the learner's dictionary.",
        "parameters": {"type": "object", "properties": {"word": {"type": "string"}}, "required": ["word"]},
    },
}
PROBE_MESSAGES = [
    {"role": "system", "content": "You can call tools. Call a tool whenever the user asks you to look something up."},
    {"role": "user", "content": "Please look up the word 'apple' with the lookup_word tool."},
]


@dataclass(frozen=True)
class ToolProbe:
    ok: bool
    code: str  # ok | no_tool_call | bad_arguments | http | network | format | config
    status: int
    ms: int

    def out(self) -> dict:
        return {"ok": self.ok, "code": self.code, "status": self.status, "ms": self.ms}


def _tool_code(payload: object) -> str:
    try:
        message = payload["choices"][0]["message"]
    except (KeyError, IndexError, TypeError):
        return "format"
    calls = message.get("tool_calls") if isinstance(message, dict) else None
    if not isinstance(calls, list) or not calls or not isinstance(calls[0], dict):
        return "no_tool_call"
    function = calls[0].get("function")
    if not isinstance(function, dict) or function.get("name") != "lookup_word":
        return "no_tool_call"
    try:
        args = json.loads(function.get("arguments") or "")
    except (TypeError, ValueError):
        return "bad_arguments"
    return "ok" if isinstance(args, dict) and isinstance(args.get("word"), str) and args["word"].strip() else "bad_arguments"


async def probe_tools(http: httpx.AsyncClient, settings: Settings, *, model: str, timeout: float = 20.0) -> ToolProbe:
    """Native function calling probe (agents spec §6.2): one cheap non-streamed call offering `lookup_word`; ok when
    the model calls it with JSON {"word": "..."}. Metered as kind "probe"; the reply body is never logged or returned."""
    if not settings.upstream_llm_base_url:
        return ToolProbe(False, "config", 0, 0)
    url, headers = _endpoint(settings)
    body = _body(settings, PROBE_MESSAGES, model=model, max_tokens=64, temperature=0, stream=False)
    body["tools"] = [PROBE_TOOL]
    body["tool_choice"] = "auto"
    provider = metering.provider_of(settings.upstream_llm_base_url)
    timer = metering.Timer()
    try:
        response = await http.post(url, json=body, headers=headers, timeout=httpx.Timeout(timeout, connect=10.0))
    except httpx.HTTPError as e:
        metering.record("probe", provider, model, 0, timer.ms())
        logger.warning("llm tool probe failed error=%s", type(e).__name__)
        return ToolProbe(False, "network", 0, timer.ms())
    ms = timer.ms()
    metering.record("probe", provider, model, response.status_code, ms)
    if response.status_code != 200:
        logger.warning("llm tool probe http status=%s", response.status_code)
        return ToolProbe(False, "http", response.status_code, ms)
    try:
        payload = response.json()
    except ValueError:
        return ToolProbe(False, "format", 200, ms)
    code = _tool_code(payload)
    return ToolProbe(code == "ok", code, 200, ms)
