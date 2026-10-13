"""Link-import URL precheck (spec 2026-10-13-video-import §7.2) and `POST /api/library/imports` (§7.1, §9)."""
import asyncio

import pytest

from app.library import urlcheck
from app.library.urlcheck import UrlRejected, blocked_address, parse, precheck


def fake_resolver(*addresses: str, calls: list | None = None):
    async def resolve(host: str) -> list[str]:
        if calls is not None:
            calls.append(host)
        return list(addresses)
    return resolve


# ---- addresses ----

@pytest.mark.parametrize("address, blocked", [
    ("8.8.8.8", False), ("93.184.216.34", False), ("2606:4700:4700::1111", False),
    ("127.0.0.1", True), ("10.1.2.3", True), ("172.16.0.1", True), ("192.168.1.1", True),
    ("169.254.169.254", True), ("100.64.0.1", True), ("0.0.0.0", True), ("224.0.0.1", True),
    ("::1", True), ("fe80::1%eth0", True), ("fd00::1", True), ("::ffff:127.0.0.1", True),
    ("::ffff:8.8.8.8", False), ("not-an-ip", True),
])
def test_blocked_address(address, blocked):
    assert blocked_address(address) is blocked


# ---- syntax ----

@pytest.mark.parametrize("raw, reason", [
    ("", "empty"), ("   ", "empty"), (None, "empty"), (123, "empty"),
    ("https://example.com/" + "a" * 2000, "length"),
    ("https://exa mple.com/", "chars"), ("https://example.com/\x00", "chars"), ("https://example.com\\@10.0.0.1/", "chars"),
    ("ftp://example.com/a", "scheme"), ("file:///etc/passwd", "scheme"), ("javascript:alert(1)", "scheme"),
    ("example.com/watch", "scheme"), ("//example.com/a", "scheme"),
    ("https://user:pw@example.com/", "userinfo"), ("https://user@example.com/", "userinfo"),
    ("https://example.com:22/", "port"), ("https://example.com:8080/", "port"), ("https://example.com:99999/", "port"),
    ("https:///path", "host"), ("https://[::1/", "host"), ("https://intranet/", "host"),
    ("http://localhost/", "private"), ("http://LOCALHOST./", "private"), ("http://a.localhost/", "private"),
    ("http://nas.local/", "private"), ("http://metadata.google.internal/", "private"), ("http://router.lan/", "private"),
    ("http://x.home.arpa/", "private"), ("http://abc.onion/", "private"),
    ("http://127.0.0.1/", "private"), ("http://[::1]/", "private"), ("http://169.254.169.254/latest/", "private"),
    ("http://10.0.0.5:80/", "private"),
])
def test_parse_rejects(raw, reason):
    with pytest.raises(UrlRejected) as info:
        parse(raw)
    assert info.value.reason == reason and info.value.reason in urlcheck.REASONS
    assert info.value.kind == "bad_url"
    assert "example" not in str(info.value)  # the message is the reason code, never the URL


@pytest.mark.parametrize("raw, url, host", [
    ("https://www.youtube.com/watch?v=abc123#t=30", "https://www.youtube.com/watch?v=abc123", "www.youtube.com"),
    ("  HTTPS://WWW.Example.COM  ", "https://www.example.com/", "www.example.com"),
    ("http://example.com:80/a?b=1", "http://example.com:80/a?b=1", "example.com"),
    ("https://example.com.:443/v", "https://example.com:443/v", "example.com"),
    ("https://bücher.example/x", "https://xn--bcher-kva.example/x", "xn--bcher-kva.example"),
    ("http://8.8.8.8/v", "http://8.8.8.8/v", "8.8.8.8"),
    ("http://[2606:4700:4700::1111]/v", "http://[2606:4700:4700::1111]/v", "2606:4700:4700::1111"),
])
def test_parse_normalises(raw, url, host):
    checked = parse(raw)
    assert (checked.url, checked.host) == (url, host)


def test_source_host_fits_the_column():
    checked = parse("https://" + "a" * 40 + "." + "b" * 30 + ".example.com/v")
    assert len(checked.source_host) == 64 and checked.host.startswith(checked.source_host)


# ---- DNS ----

async def test_precheck_accepts_public_addresses():
    calls: list[str] = []
    checked = await precheck("https://www.youtube.com/watch?v=x", resolver=fake_resolver("142.250.1.1", "2607:f8b0::1", calls=calls))
    assert checked.host == "www.youtube.com" and calls == ["www.youtube.com"]


@pytest.mark.parametrize("addresses", [("10.0.0.1",), ("8.8.8.8", "127.0.0.1"), ("::1",), ("169.254.169.254",)])
async def test_precheck_rejects_any_private_address(addresses):
    with pytest.raises(UrlRejected) as info:
        await precheck("https://rebind.example.com/v", resolver=fake_resolver(*addresses))
    assert info.value.reason == "private"


async def test_precheck_resolution_failures_are_rejected():
    async def boom(host):
        raise OSError("nodename nor servname provided")

    async def slow(host):
        await asyncio.sleep(10)
        return ["8.8.8.8"]

    for resolver in (boom, fake_resolver()):
        with pytest.raises(UrlRejected) as info:
            await precheck("https://nowhere.example.com/", resolver=resolver)
        assert info.value.reason == "resolve"
    with pytest.raises(UrlRejected) as info:
        await precheck("https://slow.example.com/", resolver=slow, timeout=0.05)
    assert info.value.reason == "resolve"


async def test_precheck_skips_dns_for_public_literals():
    calls: list[str] = []
    checked = await precheck("http://8.8.8.8/v", resolver=fake_resolver("10.0.0.1", calls=calls))
    assert checked.host == "8.8.8.8" and calls == []


async def test_precheck_uses_the_module_resolver_by_default(monkeypatch):
    calls: list[str] = []
    monkeypatch.setattr("app.library.urlcheck.system_resolve", fake_resolver("8.8.8.8", calls=calls))
    await precheck("https://example.org/v")
    assert calls == ["example.org"]
