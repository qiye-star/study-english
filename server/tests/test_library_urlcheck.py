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


# ==== Task 5: POST /api/library/imports (spec §7.1, §9) ====
import logging  # noqa: E402

from sqlalchemy import select  # noqa: E402

from app.core import config as config_module  # noqa: E402
from app.library import store  # noqa: E402
from app.library.ytdlp import Proc, YtDlpFetch  # noqa: E402
from app.models import LibraryItem  # noqa: E402
from tests.library_helpers import SRT, enable, fake_media, library_settings, process, use_fakes  # noqa: E402
from tests.test_library_ytdlp import STDERR_SECRET, TITLE, FakeRunner  # noqa: E402

ON = {"library_enabled": True, "library_link_import_enabled": True}
LINK = "https://www.youtube.com/watch?v=SECRETVIDEO9"
TOO_MANY = (429, {"error": "Too many requests, please try again later"})


@pytest.fixture
def settings_overrides(request, tmp_path):
    """Every case gets its own data directory (the end-to-end cases write `library/_tmp/...`); a case lists only the
    settings it changes. `library_settings` turns `library_enabled` on, so the 404 cases say `False` explicitly."""
    return library_settings(tmp_path, **getattr(request, "param", {}))


@pytest.fixture
def available(monkeypatch):
    """ffmpeg / yt-dlp presence belongs to the machine, not to these tests: S1's two module functions are patched
    (R-LI23; S1's own tests patch `media_tools_present` the same way)."""
    enable(monkeypatch)  # media_tools_present -> True
    monkeypatch.setattr(config_module, "ytdlp_present", lambda: True)


@pytest.fixture
def dns(monkeypatch):
    calls: list[str] = []
    monkeypatch.setattr("app.library.urlcheck.system_resolve", fake_resolver("142.250.1.1", calls=calls))
    return calls


@pytest.fixture
def wakes(app, monkeypatch):
    calls: list[int] = []
    monkeypatch.setattr(app.state.library, "wake", lambda: calls.append(1))
    return calls


async def items_of(app) -> list:
    async with app.state.sessionmaker() as s:
        return list((await s.scalars(select(LibraryItem).order_by(LibraryItem.created_at))).all())


@pytest.mark.parametrize("settings_overrides", [ON], indirect=True)
async def test_import_needs_login(client, available, dns):
    r = await client.post("/api/library/imports", json={"url": LINK})
    assert r.status_code == 401 and dns == []


@pytest.mark.parametrize("settings_overrides, error", [
    ({"library_enabled": False}, "Library is disabled"),
    ({"library_enabled": False, "library_link_import_enabled": True}, "Library is disabled"),
    ({"library_enabled": True, "library_link_import_enabled": False}, "Link import is disabled"),
], indirect=["settings_overrides"])
async def test_import_is_404_when_off(client, auth_headers, available, dns, wakes, error):
    r = await client.post("/api/library/imports", json={"url": LINK}, headers=auth_headers)
    assert (r.status_code, r.json()) == (404, {"error": error})
    assert dns == [] and wakes == []


@pytest.mark.parametrize("settings_overrides", [ON], indirect=True)
async def test_import_is_404_when_yt_dlp_is_missing(client, auth_headers, available, dns, wakes, monkeypatch):
    """`library_link_available` = switch AND yt-dlp importable (spec §5.2): a missing package reads as 'off'."""
    monkeypatch.setattr(config_module, "ytdlp_present", lambda: False)
    r = await client.post("/api/library/imports", json={"url": LINK}, headers=auth_headers)
    assert (r.status_code, r.json()) == (404, {"error": "Link import is disabled"})
    assert dns == [] and wakes == []


@pytest.mark.parametrize("settings_overrides", [{**ON, "library_imports_daily_per_user": 1}], indirect=True)
async def test_import_without_ffmpeg_is_503_and_spends_nothing(app, client, auth_headers, available, dns, wakes,
                                                               monkeypatch):
    """The route gate is `library_enabled` only (S1 R-SC9); missing media tools surface through S1's admission as
    503, and the refused request does not spend the daily count."""
    monkeypatch.setattr(config_module, "media_tools_present", lambda: False)
    r = await client.post("/api/library/imports", json={"url": LINK}, headers=auth_headers)
    assert (r.status_code, r.json()) == (503, {"error": "Media tools are not installed"})
    assert await items_of(app) == [] and wakes == []
    monkeypatch.setattr(config_module, "media_tools_present", lambda: True)
    assert (await client.post("/api/library/imports", json={"url": LINK}, headers=auth_headers)).status_code == 200


@pytest.mark.parametrize("settings_overrides", [ON], indirect=True)
async def test_import_creates_a_queued_link_item(app, client, auth_headers, available, dns, wakes):
    r = await client.post("/api/library/imports", json={"url": "  " + LINK + "#t=30 "}, headers=auth_headers)
    assert r.status_code == 200, r.text
    [row] = await items_of(app)
    assert r.json()["id"] == row.id and set(r.json()) == set(store.item_out(row))
    assert (row.source, row.status, row.title) == ("link", "queued", "")
    assert (row.source_url, row.source_host) == (LINK, "www.youtube.com")
    assert dns == ["www.youtube.com"] and wakes == [1]
    r = await client.post("/api/library/imports", json={"url": LINK, "title": "  My\ttalk  "}, headers=auth_headers)
    assert r.status_code == 200 and r.json()["title"] == "My talk" and wakes == [1, 1]


@pytest.mark.parametrize("settings_overrides", [ON], indirect=True)
@pytest.mark.parametrize("url", ["ftp://example.com/v", "http://localhost/v", "https://intranet/v",
                                 "https://user:pw@example.com/v", "https://example.com:8443/v",
                                 "https://example.com/" + "a" * 2100])
async def test_import_rejects_bad_links(app, client, auth_headers, available, dns, wakes, url):
    r = await client.post("/api/library/imports", json={"url": url}, headers=auth_headers)
    assert (r.status_code, r.json()) == (400, {"error": "Invalid link"})
    assert await items_of(app) == [] and wakes == []


@pytest.mark.parametrize("settings_overrides", [ON], indirect=True)
async def test_import_rejects_hosts_that_resolve_privately(app, client, auth_headers, available, wakes, monkeypatch):
    monkeypatch.setattr("app.library.urlcheck.system_resolve", fake_resolver("8.8.8.8", "10.0.0.2"))
    r = await client.post("/api/library/imports", json={"url": LINK}, headers=auth_headers)
    assert (r.status_code, r.json()) == (400, {"error": "Invalid link"})
    assert await items_of(app) == [] and wakes == []


@pytest.mark.parametrize("settings_overrides", [ON], indirect=True)
@pytest.mark.parametrize("body", [{}, {"url": ""}, {"url": 5}, {"url": LINK, "title": "t" * 201}])
async def test_import_validates_the_body(app, client, auth_headers, available, dns, body):
    r = await client.post("/api/library/imports", json=body, headers=auth_headers)
    assert r.status_code == 422 and "SECRETVIDEO9" not in r.text
    assert await items_of(app) == []


@pytest.mark.parametrize("settings_overrides, refused", [
    ({**ON, "library_max_items": 1}, (409, {"error": "Library item limit reached"})),
    ({**ON, "library_imports_daily_per_user": 1}, (429, {"error": "Daily import limit reached"})),
], indirect=["settings_overrides"])
async def test_import_counts_against_the_library_limits(app, client, auth_headers, available, dns, wakes, refused):
    """S1's `admit_new_item` (A-5): the same rules and the same fixed texts as the upload start."""
    first = await client.post("/api/library/imports", json={"url": LINK}, headers=auth_headers)
    assert first.status_code == 200, first.text
    second = await client.post("/api/library/imports", json={"url": LINK}, headers=auth_headers)
    assert (second.status_code, second.json()) == refused
    assert len(await items_of(app)) == 1 and wakes == [1]


@pytest.mark.parametrize("settings_overrides", [{**ON, "ai_rate_limit_per_minute": 1}], indirect=True)
async def test_import_is_rate_limited_per_minute(app, client, auth_headers, available, dns):
    assert (await client.post("/api/library/imports", json={"url": LINK}, headers=auth_headers)).status_code == 200
    r = await client.post("/api/library/imports", json={"url": LINK}, headers=auth_headers)
    assert (r.status_code, r.json()) == TOO_MANY
    assert len(await items_of(app)) == 1


@pytest.mark.parametrize("settings_overrides", [ON], indirect=True)
async def test_import_logs_neither_url_nor_title(client, auth_headers, available, dns, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    await client.post("/api/library/imports", json={"url": LINK, "title": "Secret Title 77"}, headers=auth_headers)
    await client.post("/api/library/imports", json={"url": "http://localhost/SECRETVIDEO9"}, headers=auth_headers)
    for secret in ("SECRETVIDEO9", "youtube", "Secret Title 77", "localhost"):
        assert secret not in caplog.text
    assert "reason=private" in caplog.text and "library import queued" in caplog.text


async def test_create_app_registers_the_ytdlp_fetch_stage(app):
    assert isinstance(app.state.library.fetch_stage, YtDlpFetch)


# ---- through S1's worker with a fake yt-dlp (R-LI25) ----

async def row_of(app, item_id: str) -> LibraryItem:
    async with app.state.sessionmaker() as s:
        return await s.get(LibraryItem, item_id)


def fake_stage(runner) -> YtDlpFetch:
    return YtDlpFetch(runner, resolver=fake_resolver("142.250.1.1"), disk_free=lambda p: 10 ** 12)


@pytest.mark.parametrize("settings_overrides", [ON], indirect=True)
async def test_an_import_runs_to_ready_through_the_worker(app, client, auth_headers, available, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    use_fakes(app)  # S1's fake ffmpeg / ffprobe; the "downloaded" file below is a fake media file for it
    runner = FakeRunner(contents={"dl.mp4": fake_media(6000), "subs.en.srt": SRT})
    app.state.library.set_fetch_stage(fake_stage(runner))
    r = await client.post("/api/library/imports", json={"url": LINK}, headers=auth_headers)
    assert r.status_code == 200, r.text
    assert await process(app) == 1
    row = await row_of(app, r.json()["id"])
    assert (row.status, row.error_kind, row.sub_source, row.title) == ("ready", None, "platform", TITLE)
    assert row.source_url is None and row.source_host == "www.youtube.com" and row.seg_count >= 1
    probe, download = runner.calls
    assert probe["argv"][-1] == LINK and download["argv"][-1] == LINK
    assert not any(k in probe["env"] for k in ("UPSTREAM_LLM_KEY", "ADMIN_PASSWORD", "DATABASE_URL"))
    for secret in ("SECRETVIDEO9", "SECRETVIDEO1", "youtube", TITLE):
        assert secret not in caplog.text
    assert "library fetch done" in caplog.text


@pytest.mark.parametrize("settings_overrides", [ON], indirect=True)
async def test_a_blocked_site_fails_the_item_with_a_kind_and_logs_nothing_else(app, client, auth_headers, available,
                                                                               caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    use_fakes(app)
    app.state.library.set_fetch_stage(fake_stage(FakeRunner(probe=Proc(1, "", STDERR_SECRET))))
    r = await client.post("/api/library/imports", json={"url": LINK, "title": "Secret Title 77"},
                          headers=auth_headers)
    await process(app)
    row = await row_of(app, r.json()["id"])
    assert (row.status, row.error_kind) == ("failed", "blocked")
    assert (await client.get(f"/api/library/items/{row.id}", headers=auth_headers)).json()["item"]["error_kind"] == "blocked"
    for secret in ("SECRETVIDEO9", "SECRETVIDEO1", "youtube", "Secret Title 77", "SESSIONSECRET", "not a bot"):
        assert secret not in caplog.text
    assert "kind=blocked" in caplog.text


@pytest.mark.parametrize("settings_overrides", [ON], indirect=True)
async def test_a_transient_yt_dlp_failure_is_retried_by_the_worker(app, client, auth_headers, available):
    """`ytdlp_transient` is one of the kinds S1 retries automatically (spec §6.5): back to `queued` with a backoff."""
    use_fakes(app)
    app.state.library.set_fetch_stage(fake_stage(FakeRunner(probe=Proc(-9, "", "", timed_out=True))))
    r = await client.post("/api/library/imports", json={"url": LINK}, headers=auth_headers)
    await process(app)
    row = await row_of(app, r.json()["id"])
    assert (row.status, row.attempts) == ("queued", 1) and row.next_run_at is not None  # not asserting error_kind: S1's call


def test_the_import_route_carries_no_text_in_its_url(app):
    paths = {path for path in app.openapi()["paths"] if path.startswith("/api/library/imports")}
    assert paths == {"/api/library/imports"}
