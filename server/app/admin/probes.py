"""测试连接(spec §3.10):只返回 {ok, status, ms, code},从不返回上游响应体;不跟随重定向;
解析主机名并拒绝回环/私网/链路本地地址(防 SSRF);8 秒超时。密钥只出现在发往上游的请求头里。"""
import asyncio
import ipaddress
import ssl
import time
from dataclasses import dataclass
from urllib.parse import urlsplit

import httpx
import websockets
from websockets.asyncio.client import connect

from app.providers.xfyun import signed_url

UPSTREAMS = ("llm", "grammar", "tts", "whisper", "volc_tts", "asr_stream", "azure", "xfyun")
CODES = ("ok", "auth", "not_found", "timeout", "network", "tls", "bad_response", "not_configured",
         "blocked_private", "cost_not_allowed")
TIMEOUT = httpx.Timeout(8.0, connect=5.0)
SCHEMES = ("http", "https", "ws", "wss")


@dataclass(frozen=True)
class ProbeResult:
    ok: bool
    status: int
    ms: int
    code: str

    def out(self) -> dict:
        return {"ok": self.ok, "status": self.status, "ms": self.ms, "code": self.code}


def target(s, upstream: str) -> tuple[str, str]:
    return {
        "llm": (s.upstream_llm_base_url, s.upstream_llm_key),
        "grammar": s.grammar_upstream,
        "tts": (s.upstream_tts_base_url, s.upstream_tts_key),
        "whisper": (s.upstream_whisper_base_url, s.upstream_whisper_key),
        "volc_tts": (s.volcengine_tts_url, s.volcengine_tts_key),
        "asr_stream": (s.asr_stream_url, s.asr_stream_key),
        "azure": (f"https://{s.azure_speech_region}.api.cognitive.microsoft.com/sts/v1.0/issueToken"
                  if s.azure_speech_region else "", s.azure_speech_key),
        "xfyun": (s.xfyun_ws_url if s.xfyun_app_id and s.xfyun_api_secret else "", s.xfyun_api_key),
    }[upstream]


def _blocked(address: str) -> bool:
    ip = ipaddress.ip_address(address.split("%", 1)[0])
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast
            or ip.is_unspecified)


async def is_private_host(host: str, resolver=None) -> bool:
    if resolver is not None:
        return await resolver(host)
    try:
        return _blocked(host)  # IP literal
    except ValueError:
        pass
    infos = await asyncio.get_running_loop().getaddrinfo(host, None)
    return not infos or any(_blocked(i[4][0]) for i in infos)


def _code_for(status: int) -> str:
    if 200 <= status < 300:
        return "ok"
    if status in (401, 403):
        return "auth"
    if status == 404:
        return "not_found"
    return "bad_response"


def _is_tls(exc: BaseException) -> bool:
    seen = 0
    while exc is not None and seen < 5:
        if isinstance(exc, ssl.SSLError):
            return True
        exc = exc.__cause__ or exc.__context__
        seen += 1
    return False


async def _xfyun_handshake(s, clock, start) -> ProbeResult:
    url = signed_url(s.xfyun_ws_url, s.xfyun_api_key, s.xfyun_api_secret)
    ms = lambda: int((clock() - start) * 1000)  # noqa: E731
    try:
        async with asyncio.timeout(8):
            async with connect(url, open_timeout=8, max_size=2 ** 16):
                pass
    except websockets.InvalidStatus as exc:
        status = exc.response.status_code
        return ProbeResult(False, status, ms(), _code_for(status))
    except TimeoutError:
        return ProbeResult(False, 0, ms(), "timeout")
    except (OSError, websockets.WebSocketException) as exc:
        return ProbeResult(False, 0, ms(), "tls" if _is_tls(exc) else "network")
    return ProbeResult(True, 101, ms(), "ok")


async def probe(http, s, upstream: str, *, allow_cost: bool = False, resolver=None,
                clock=time.monotonic) -> ProbeResult:
    url, key = target(s, upstream)
    if not url or not key:
        return ProbeResult(False, 0, 0, "not_configured")
    parts = urlsplit(url)
    host = parts.hostname or ""
    if parts.scheme not in SCHEMES or not host:
        return ProbeResult(False, 0, 0, "not_configured")
    try:
        if await is_private_host(host, resolver):
            return ProbeResult(False, 0, 0, "blocked_private")
    except (OSError, ValueError):
        return ProbeResult(False, 0, 0, "network")
    start = clock()
    ms = lambda: int((clock() - start) * 1000)  # noqa: E731
    auth = {"Authorization": f"Bearer {key}"}
    try:
        if upstream in ("llm", "grammar", "tts", "whisper"):
            r = await http.get(url.rstrip("/") + "/models", headers=auth, timeout=TIMEOUT, follow_redirects=False)
            if r.status_code == 404 and upstream in ("llm", "grammar"):
                if not allow_cost:
                    return ProbeResult(False, 404, ms(), "cost_not_allowed")
                model = s.resolved_grammar_model if upstream == "grammar" else s.default_llm_model
                r = await http.post(url.rstrip("/") + "/chat/completions", headers=auth,
                                    json={"model": model, "messages": [{"role": "user", "content": "ping"}],
                                          "max_tokens": 1},
                                    timeout=TIMEOUT, follow_redirects=False)
        elif upstream == "azure":
            r = await http.post(url, headers={"Ocp-Apim-Subscription-Key": key}, timeout=TIMEOUT,
                                follow_redirects=False)
        elif upstream == "xfyun":
            return await _xfyun_handshake(s, clock, start)
        else:  # volc_tts / asr_stream: TCP + TLS reachability only, no credentials sent
            r = await http.head(url.replace("wss://", "https://", 1).replace("ws://", "http://", 1), timeout=TIMEOUT,
                                follow_redirects=False)
            return ProbeResult(True, r.status_code, ms(), "ok")
    except httpx.TimeoutException:
        return ProbeResult(False, 0, ms(), "timeout")
    except httpx.HTTPError as exc:
        return ProbeResult(False, 0, ms(), "tls" if _is_tls(exc) else "network")
    return ProbeResult(200 <= r.status_code < 300, r.status_code, ms(), _code_for(r.status_code))
