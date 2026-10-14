"""Link-import URL precheck (spec 2026-10-13-video-import §7.2). Standard library only.

Written for the library on its own: `app.library` may not import `app.admin.probes` (layering), so the address rule
is the same as `probes._blocked` but kept here (spec §14: merging the two is out of scope).

Passing the check describes the moment it ran. DNS rebinding and site redirects to private addresses can still
bypass it (residual risk, spec §7.2); the generic extractor is therefore off by default and the fetch stage runs
the check again right before yt-dlp starts. Nothing here logs or returns the URL: `UrlRejected.reason` is a fixed
code (for logs and tests), and every rejection maps to the one error kind `bad_url`."""
from __future__ import annotations

import asyncio
import ipaddress
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from urllib.parse import urlsplit, urlunsplit

MAX_URL_CHARS = 2000
SCHEMES = ("http", "https")
ALLOWED_PORTS = (None, 80, 443)
RESOLVE_TIMEOUT = 5.0
BLOCKED_NAMES = ("localhost",)
BLOCKED_SUFFIXES = (".localhost", ".local", ".internal", ".lan", ".home.arpa", ".onion")
REASONS = ("empty", "length", "chars", "scheme", "userinfo", "host", "port", "private", "resolve")
KIND = "bad_url"

Resolver = Callable[[str], Awaitable[list[str]]]


class UrlRejected(Exception):
    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason
        self.kind = KIND


@dataclass(frozen=True)
class CheckedUrl:
    url: str  # normalised: lowercase scheme, IDNA host, no fragment
    host: str  # lowercase ASCII host (IDNA), no port, no brackets

    @property
    def source_host(self) -> str:
        """For `library_items.source_host` (`String(64)`)."""
        return self.host[:64]


def blocked_address(address: str) -> bool:
    """True for anything that is not a public unicast address (loopback, private, link-local incl. 169.254.169.254,
    CGNAT, multicast, reserved, unspecified; IPv4-mapped IPv6 is judged as IPv4). Unparseable = blocked."""
    try:
        ip = ipaddress.ip_address(address.split("%", 1)[0])
    except ValueError:
        return True
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return not ip.is_global or ip.is_multicast


def _literal(host: str) -> bool:
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return False
    return True


async def system_resolve(host: str) -> list[str]:
    infos = await asyncio.get_running_loop().getaddrinfo(host, None)
    return [info[4][0] for info in infos]


# Full-width punctuation and closers end a pasted link (a share text has no space after a Chinese full stop).
_LINK = re.compile(r"https?://[^\s<>\"“”‘’，。；、）】》」』！？]+",
                   re.IGNORECASE)
_TRAILING = ").,;:!?]}>'\"）】"


def extract_link(raw: object) -> object:
    """Pasted share text ("title + link"): when the trimmed string holds whitespace, the first `http(s)://...` piece
    (trailing punctuation removed) stands in for it; nothing found means the string is returned unchanged (so `parse`
    rejects it as `chars`). A string without whitespace is returned untouched. The result still goes through `precheck`."""
    if not isinstance(raw, str):
        return raw
    stripped = raw.strip()
    if not any(c.isspace() for c in stripped):
        return raw
    match = _LINK.search(stripped)
    if match is None:
        return raw
    return match.group(0).rstrip(_TRAILING) or raw


def parse(raw: object) -> CheckedUrl:
    """Syntax rules only (no DNS). Raises `UrlRejected`."""
    if not isinstance(raw, str) or not raw.strip():
        raise UrlRejected("empty")
    url = raw.strip()
    if len(url) > MAX_URL_CHARS:
        raise UrlRejected("length")
    if any(c.isspace() or ord(c) < 0x20 or ord(c) == 0x7F or c == "\\" for c in url):
        raise UrlRejected("chars")
    try:
        parts = urlsplit(url)
    except ValueError:  # e.g. an unbalanced IPv6 bracket
        raise UrlRejected("host") from None
    if parts.scheme.lower() not in SCHEMES:
        raise UrlRejected("scheme")
    if "@" in parts.netloc:
        raise UrlRejected("userinfo")
    try:
        port = parts.port
    except ValueError:
        raise UrlRejected("port") from None
    host = (parts.hostname or "").rstrip(".")
    if not host:
        raise UrlRejected("host")
    if _literal(host):
        ascii_host = host.lower()
    else:
        try:
            ascii_host = host.encode("idna").decode("ascii").lower()
        except UnicodeError:
            raise UrlRejected("host") from None
        if ascii_host in BLOCKED_NAMES or ascii_host.endswith(BLOCKED_SUFFIXES):
            raise UrlRejected("private")
        if "." not in ascii_host:  # single-label names resolve through search domains (intranet)
            raise UrlRejected("host")
    if port not in ALLOWED_PORTS:
        raise UrlRejected("port")
    if _literal(ascii_host) and blocked_address(ascii_host):
        raise UrlRejected("private")
    netloc = f"[{ascii_host}]" if ":" in ascii_host else ascii_host
    if port is not None:
        netloc = f"{netloc}:{port}"
    return CheckedUrl(urlunsplit((parts.scheme.lower(), netloc, parts.path or "/", parts.query, "")), ascii_host)


async def precheck(raw: object, *, resolver: Resolver | None = None,
                   timeout: float = RESOLVE_TIMEOUT, resolve: bool = True) -> CheckedUrl:
    """`parse` + every resolved address must be public. `resolver(host) -> [addresses]` replaces DNS in tests.
    `resolve=False` (a yt-dlp proxy is configured: it resolves and connects remotely, and the local resolver may be
    poisoned) keeps only the syntactic checks of `parse` (scheme, length, characters, userinfo, port, blocked names
    and suffixes, literal addresses)."""
    checked = parse(raw)
    if not resolve or _literal(checked.host):
        return checked
    try:
        async with asyncio.timeout(timeout):
            addresses = await (resolver or system_resolve)(checked.host)
    except (OSError, UnicodeError, ValueError, TimeoutError):
        raise UrlRejected("resolve") from None
    if not addresses:
        raise UrlRejected("resolve")
    if any(blocked_address(a) for a in addresses):
        raise UrlRejected("private")
    return checked
