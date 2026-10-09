"""Non-streaming OpenAI-compatible chat completion for server-side features (rank judge/examiner,
room assistant). Never logs prompts, replies or keys: only the failure kind and HTTP status."""
import logging

import httpx

from app.core import metering
from app.core.config import LLM_THINKING_HOST_SUFFIXES, Settings, send_thinking_param

logger = logging.getLogger(__name__)


class LlmUnavailable(Exception):
    def __init__(self, kind: str = "http"):
        super().__init__(kind)
        self.kind = kind


async def complete(http: httpx.AsyncClient, settings: Settings, messages: list[dict], *, model: str,
                   max_tokens: int, temperature: float, timeout: float = 60.0) -> str:
    if not settings.upstream_llm_base_url:
        raise LlmUnavailable("config")
    body = {
        "model": model,
        "messages": messages,
        "max_tokens": min(max_tokens, settings.llm_max_tokens),
        "temperature": temperature,
        "stream": False,
    }
    if send_thinking_param(settings.realtime_llm_disable_thinking, settings.upstream_llm_base_url,
                           LLM_THINKING_HOST_SUFFIXES):
        body["thinking"] = {"type": "disabled"}
    url = settings.upstream_llm_base_url.rstrip("/") + "/chat/completions"
    headers = {"Authorization": f"Bearer {settings.upstream_llm_key}", "Content-Type": "application/json"}
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
        raise LlmUnavailable("http")
    try:
        content = payload["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        raise LlmUnavailable("format") from None
    if not isinstance(content, str) or not content.strip():
        raise LlmUnavailable("empty")
    return content.strip()
