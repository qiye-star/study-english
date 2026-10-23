"""测试连接(spec §3.10):只返回 {ok, status, ms, code},从不返回上游响应体;不跟随重定向(HTTP 与 WebSocket);
主机名只解析一次,任一地址不是公网地址(`is_global`)就拒绝,随后连接固定到这个已检查的地址(防 DNS 重绑定),
TLS 仍按原主机名做 SNI 与证书校验;8 秒超时。密钥只出现在发往上游的请求头里。"""
import asyncio
import ipaddress
import ssl
import time
from dataclasses import dataclass
from urllib.parse import urlsplit

import httpcore
import httpx
import websockets
from websockets.asyncio.client import connect

from app.providers import email as email_provider
from app.providers.xfyun import signed_url

UPSTREAMS = ("llm", "grammar", "tts", "whisper", "volc_tts", "asr_stream", "azure", "xfyun", "smtp")
CODES = ("ok", "auth", "not_found", "timeout", "network", "tls", "bad_response", "not_configured",
         "blocked_private", "cost_not_allowed")
TIMEOUT = httpx.Timeout(8.0, connect=5.0)
SCHEMES = ("http", "https", "ws", "wss")
SMTP_TIMEOUT = 8.0  # seconds for connect + TLS + login together


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
    # not is_global also covers 100.64.0.0/10 (CGNAT), benchmarking and other special ranges (review m4)
    return not ip.is_global or ip.is_multicast


async def _system_resolve(host: str) -> list[str]:
    try:
        ipaddress.ip_address(host)
        return [host]  # IP literal
    except ValueError:
        pass
    infos = await asyncio.get_running_loop().getaddrinfo(host, None)
    return [i[4][0] for i in infos]


async def resolve_public(host: str, resolver=None) -> str | None:
    """The address to connect to, or None when the host resolves to nothing or to any non-public address."""
    addresses = await (resolver or _system_resolve)(host)
    if not addresses or any(_blocked(a) for a in addresses):
        return None
    return addresses[0].split("%", 1)[0]


async def is_private_host(host: str, resolver=None) -> bool:
    return await resolve_public(host, resolver) is None


class PinnedBackend(httpcore.AsyncNetworkBackend):
    """Connects `host` to the already checked address (no second DNS lookup, review m4); TLS still uses `host` for
    SNI and certificate checks because httpcore passes the URL's host as server_hostname."""

    def __init__(self, host: str, address: str, inner: httpcore.AsyncNetworkBackend | None = None):
        self.host, self.address = host, address
        self._inner = inner or httpcore.AnyIOBackend()

    async def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
        if host != self.host:
            raise httpcore.ConnectError("unexpected host")
        return await self._inner.connect_tcp(self.address, port, timeout=timeout, local_address=local_address,
                                             socket_options=socket_options)

    async def connect_unix_socket(self, path, timeout=None, socket_options=None):
        raise httpcore.ConnectError("unix sockets are not allowed")

    async def sleep(self, seconds: float) -> None:
        await self._inner.sleep(seconds)


def pinned_client(host: str, address: str) -> httpx.AsyncClient:
    transport = httpx.AsyncHTTPTransport()
    transport._pool._network_backend = PinnedBackend(host, address)  # httpx has no public resolver hook
    return httpx.AsyncClient(transport=transport, timeout=TIMEOUT, follow_redirects=False)


class _connect_no_redirect(connect):
    """websockets follows up to 10 redirects by default, to targets nobody checked (review m4): never follow."""

    def process_redirect(self, exc: Exception) -> Exception:
        return exc


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


async def _xfyun_handshake(s, clock, start, address: str) -> ProbeResult:
    url = signed_url(s.xfyun_ws_url, s.xfyun_api_key, s.xfyun_api_secret)
    parts = urlsplit(url)
    pin = {"host": address, "port": parts.port or (443 if parts.scheme == "wss" else 80)}
    if parts.scheme == "wss":
        pin["server_hostname"] = parts.hostname  # SNI + certificate check against the real name
    ms = lambda: int((clock() - start) * 1000)  # noqa: E731
    try:
        async with asyncio.timeout(8):
            async with _connect_no_redirect(url, open_timeout=8, max_size=2 ** 16, **pin):
                pass
    except websockets.InvalidStatus as exc:
        status = exc.response.status_code
        return ProbeResult(False, status, ms(), _code_for(status))
    except TimeoutError:
        return ProbeResult(False, 0, ms(), "timeout")
    except (OSError, websockets.WebSocketException) as exc:
        return ProbeResult(False, 0, ms(), "tls" if _is_tls(exc) else "network")
    return ProbeResult(True, 101, ms(), "ok")


async def _smtp_probe(s, resolver, clock) -> ProbeResult:
    """Connect, secure (ssl / starttls as configured) and log in; never sends a message. The host is checked with
    the same public-address guard as the HTTP upstreams first. The result carries a code only: no host, user or
    password. (smtplib resolves the name again when it connects: the SMTP check is not DNS-pinned.)"""
    host = (s.smtp_host or "").strip()
    if not host:
        return ProbeResult(False, 0, 0, "not_configured")
    try:
        address = await resolve_public(host, resolver)
    except (OSError, ValueError):
        return ProbeResult(False, 0, 0, "network")
    if address is None:
        return ProbeResult(False, 0, 0, "blocked_private")
    start = clock()
    ms = lambda: int((clock() - start) * 1000)  # noqa: E731
    try:
        async with asyncio.timeout(SMTP_TIMEOUT):
            await email_provider.check(s)
    except TimeoutError:
        return ProbeResult(False, 0, ms(), "timeout")
    except email_provider.EmailError as exc:
        code = exc.code if exc.code in ("auth", "timeout", "tls") else "network"
        return ProbeResult(False, exc.status if code == "auth" else 0, ms(), code)
    return ProbeResult(True, 0, ms(), "ok")


async def probe(s, upstream: str, *, allow_cost: bool = False, resolver=None,
                clock=time.monotonic) -> ProbeResult:
    """`resolver(host) -> list[str]` replaces DNS in tests."""
    if upstream == "smtp":
        return await _smtp_probe(s, resolver, clock)
    url, key = target(s, upstream)
    if not url or not key:
        return ProbeResult(False, 0, 0, "not_configured")
    parts = urlsplit(url)
    host = parts.hostname or ""
    if parts.scheme not in SCHEMES or not host:
        return ProbeResult(False, 0, 0, "not_configured")
    try:
        address = await resolve_public(host, resolver)
    except (OSError, ValueError):
        return ProbeResult(False, 0, 0, "network")
    if address is None:
        return ProbeResult(False, 0, 0, "blocked_private")
    start = clock()
    ms = lambda: int((clock() - start) * 1000)  # noqa: E731
    if upstream == "xfyun":
        return await _xfyun_handshake(s, clock, start, address)
    auth = {"Authorization": f"Bearer {key}"}
    try:
        async with pinned_client(host, address) as http:
            if upstream in ("llm", "grammar", "tts", "whisper"):
                r = await http.get(url.rstrip("/") + "/models", headers=auth)
                if r.status_code == 404 and upstream in ("llm", "grammar"):
                    if not allow_cost:
                        return ProbeResult(False, 404, ms(), "cost_not_allowed")
                    model = s.resolved_grammar_model if upstream == "grammar" else s.default_llm_model
                    r = await http.post(url.rstrip("/") + "/chat/completions", headers=auth,
                                        json={"model": model, "messages": [{"role": "user", "content": "ping"}],
                                              "max_tokens": 1})
            elif upstream == "azure":
                r = await http.post(url, headers={"Ocp-Apim-Subscription-Key": key})
            else:  # volc_tts / asr_stream: TCP + TLS reachability only, no credentials sent
                r = await http.head(url.replace("wss://", "https://", 1).replace("ws://", "http://", 1))
                return ProbeResult(True, r.status_code, ms(), "ok")
    except httpx.TimeoutException:
        return ProbeResult(False, 0, ms(), "timeout")
    except httpx.HTTPError as exc:
        return ProbeResult(False, 0, ms(), "tls" if _is_tls(exc) else "network")
    return ProbeResult(200 <= r.status_code < 300, r.status_code, ms(), _code_for(r.status_code))
