"""The yt-dlp fetch stage (spec 2026-10-13-video-import §7): the dependency, argv / env rules, error classification,
probe checks, subtitle choice and `YtDlpFetch.fetch` with a fake child process. No network; the only real yt-dlp
run is `--version` (adapter test)."""
import importlib.metadata
import importlib.util
import re
from pathlib import Path

import pytest

PYPROJECT = Path(__file__).resolve().parent.parent / "pyproject.toml"


def test_ytdlp_is_a_declared_dependency():
    text = PYPROJECT.read_text(encoding="utf-8")
    assert re.search(r'"yt-dlp\[default\]>=\d{4}\.\d+\.\d+"', text)


@pytest.mark.skipif(importlib.util.find_spec("yt_dlp") is None,
                    reason="yt-dlp is not installed in this environment (not locked offline yet: run `uv lock` + `uv sync`)")
def test_ytdlp_dependency_is_installed():
    assert importlib.metadata.version("yt-dlp")


# ==== Task 3: pure helpers ====
import sys  # noqa: E402

import pytest  # noqa: E402

from app.library import errors, ytdlp  # noqa: E402
from app.library.errors import LibraryError  # noqa: E402

URL = "https://www.youtube.com/watch?v=SECRETVIDEO1"
TITLE = "A very private title 42"


def info(**over):
    data = {"_type": "video", "id": "SECRETVIDEO1", "title": TITLE, "duration": 61.5, "extractor_key": "Youtube",
            "is_live": False, "live_status": "not_live", "formats": [{"format_id": "18"}],
            "requested_formats": [{"filesize": 10 * ytdlp.MB}, {"filesize_approx": 2 * ytdlp.MB}],
            "subtitles": {"en": [{"ext": "vtt"}]}, "automatic_captions": {"en": [], "en-orig": [], "fr": []}}
    data.update(over)
    return data


# ---- classification ----

@pytest.mark.parametrize("stderr, kind", [
    ("ERROR: [youtube] abc: This video is DRM protected", "drm"),
    ("ERROR: [youtube] abc: This live event will begin in 3 hours.", "live_unsupported"),
    ("ERROR: [youtube] abc: Premieres in 2 days", "live_unsupported"),
    ("ERROR: [youtube] abc: Sign in to confirm you’re not a bot. Use --cookies-from-browser", "blocked"),
    ("ERROR: [youtube] abc: Sign in to confirm you're not a bot", "blocked"),
    ("ERROR: Unable to download webpage: HTTP Error 429: Too Many Requests", "blocked"),
    ("ERROR: [youtube] abc: Video unavailable. The uploader has not made this video available in your country", "geo_blocked"),
    ("ERROR: [vimeo] 1: This video is not available from your location due to geo restriction", "geo_blocked"),
    ("ERROR: [youtube] abc: Private video. Sign in if you've been granted access to this video", "private"),
    ("ERROR: [youtube] abc: Sign in to confirm your age. This video may be inappropriate", "login_required"),
    ("ERROR: [youtube] abc: Join this channel to get access to members-only content", "login_required"),
    ("ERROR: Unsupported URL: https://example.com/page", "unsupported_site"),
    ("ERROR: 'foo' is not a valid URL. Set --default-search", "bad_url"),
    ("ERROR: [youtube] abc: n challenge solving failed: No supported JavaScript runtime", "ytdlp_failed"),
    ("ERROR: [youtube] abc: Requested format is not available", "ytdlp_failed"),
    ("ERROR: Unable to download webpage: <urlopen error timed out>", "network"),
    ("ERROR: Unable to download webpage: [Errno 104] Connection reset by peer", "network"),
    ("ERROR: unable to download video data: HTTP Error 403: Forbidden", "ytdlp_transient"),
    ("ERROR: Unable to download JSON metadata: HTTP Error 503", "ytdlp_transient"),
    ("ERROR: something nobody has seen before", "ytdlp_failed"),
    ("", "ytdlp_failed"),
])
def test_classify(stderr, kind):
    assert ytdlp.classify(stderr) == kind


def test_classify_ignores_urls_and_prefers_error_lines():
    assert ytdlp.classify("ERROR: Unsupported URL: https://example.com/what-is-drm-explained") == "unsupported_site"
    assert ytdlp.classify("WARNING: [youtube] Sign in to confirm your age\nERROR: Unable to download webpage: "
                          "<urlopen error timed out>") == "network"
    assert ytdlp.classify("WARNING: login required for hd\nsome other text") == "login_required"  # no ERROR line


def test_every_kind_the_stage_raises_is_a_library_kind():
    assert ytdlp.KINDS_RAISED <= errors.KINDS
    assert {kind for kind, _ in ytdlp.CLASSIFY} <= errors.KINDS


# ---- argv and environment ----

def test_info_args(tmp_path):
    argv = ytdlp.info_args(URL, allow_generic=False, cookies=None, max_height=480)
    assert argv[:6] == [sys.executable, "-I", "-X", "utf8", "-m", "yt_dlp"]
    for flag in ("--ignore-config", "--no-plugin-dirs", "--no-cache-dir", "--no-playlist", "--dump-single-json",
                 "--skip-download"):
        assert flag in argv
    assert argv[argv.index("--use-extractors") + 1] == "default,-generic"
    assert argv[-2:] == ["--", URL] and "[height<=480]" in argv[argv.index("-f") + 1]
    assert "--cookies" not in argv and not any(a.startswith("--exec") for a in argv)
    generic = ytdlp.info_args(URL, allow_generic=True, cookies=tmp_path / "c.txt", max_height=720)
    assert "--use-extractors" not in generic and generic[generic.index("--cookies") + 1] == str(tmp_path / "c.txt")


def test_format_selector_prefers_h264_and_falls_back_to_audio():
    assert ytdlp.format_selector(720) == ("bv*[height<=720][ext=mp4][vcodec^=avc1]+ba[ext=m4a]"
                                          "/bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720]/b/ba")


def test_download_args(tmp_path):
    argv = ytdlp.download_args(URL, tmp_path, allow_generic=False, cookies=None, max_height=720, max_mb=500,
                               sub_lang="en-US", sub_auto=False)
    pairs = {argv[i]: argv[i + 1] for i in range(len(argv) - 1)}
    assert pairs["--max-filesize"] == "500M" and pairs["-P"] == str(tmp_path)
    assert pairs["--merge-output-format"] == "mp4" and pairs["--sub-langs"] == r"en\-US"
    assert pairs["--convert-subs"] == "srt" and "--write-subs" in argv and "--write-auto-subs" not in argv
    assert [argv[i + 1] for i, a in enumerate(argv) if a == "-o"] == ["dl.%(ext)s", "subtitle:subs.%(ext)s"]
    assert "--no-part" in argv and "--newline" in argv and argv[-2:] == ["--", URL]
    auto = ytdlp.download_args(URL, tmp_path, allow_generic=False, cookies=None, max_height=720, max_mb=500,
                               sub_lang="en-orig", sub_auto=True)
    assert "--write-auto-subs" in auto and "--write-subs" not in auto
    none = ytdlp.download_args(URL, tmp_path, allow_generic=False, cookies=None, max_height=720, max_mb=500,
                               sub_lang=None, sub_auto=False)
    assert "--sub-langs" not in none and "--write-subs" not in none


def test_child_env_is_a_whitelist(monkeypatch, tmp_path):
    for key in ("UPSTREAM_LLM_KEY", "ADMIN_PASSWORD", "DATABASE_URL", "AZURE_SPEECH_KEY", "PYTHONPATH",
                "HTTPS_PROXY"):
        monkeypatch.setenv(key, "leak-" + key)
    env = ytdlp.child_env(tmp_path, "")
    assert set(env) <= {"PATH", "HOME", "LANG", "SYSTEMROOT"} and env["HOME"] == str(tmp_path)
    assert not any("leak-" in v for v in env.values())
    proxied = ytdlp.child_env(tmp_path, "http://user:pw@proxy.example:3128")
    assert {proxied[k] for k in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy")} == {
        "http://user:pw@proxy.example:3128"}


# ---- probe checks ----

@pytest.mark.parametrize("over, kind", [
    ({"_type": "playlist"}, "playlist_unsupported"), ({"_type": "multi_video"}, "playlist_unsupported"),
    ({"is_live": True}, "live_unsupported"), ({"live_status": "is_upcoming"}, "live_unsupported"),
    ({"live_status": "post_live"}, "live_unsupported"),
    ({"extractor_key": "Generic"}, "unsupported_site"),
    ({"formats": [{"has_drm": True}, {"has_drm": "maybe"}]}, "drm"),
    ({"duration": 90 * 60 + 1}, "too_long"),
])
def test_check_info_refuses(over, kind):
    with pytest.raises(LibraryError) as e:
        ytdlp.check_info(info(**over), max_minutes=90, allow_generic=False)
    assert e.value.kind == kind


def test_check_info_accepts():
    ytdlp.check_info(info(), max_minutes=90, allow_generic=False)
    ytdlp.check_info(info(extractor_key="Generic"), max_minutes=90, allow_generic=True)
    ytdlp.check_info(info(duration=None, formats=[{"has_drm": True}, {"has_drm": False}]), max_minutes=1,
                     allow_generic=False)


def test_estimate_and_space():
    assert ytdlp.estimate_bytes(info()) == 12 * ytdlp.MB
    assert ytdlp.estimate_bytes({"filesize_approx": 5.5}) == 5
    assert ytdlp.estimate_bytes({"requested_formats": [{"filesize": 1}, {}]}) is None
    ytdlp.check_space(10, 100, 20)
    for args, kind in (((101, 100, 10 ** 9), "too_large"), ((10, 100, 19), "disk_full"), ((None, 100, 199), "disk_full")):
        with pytest.raises(LibraryError) as e:
            ytdlp.check_space(*args)
        assert e.value.kind == kind


@pytest.mark.parametrize("subs, auto, asr, expected", [
    ({"en": []}, {}, False, ("en", False)),
    ({"en-GB": [], "en-US": []}, {}, True, ("en-US", False)),
    ({"en-CA": [], "de": []}, {}, True, ("en-CA", False)),
    ({"live_chat": [], "de": []}, {"en-orig": [], "en": []}, False, ("en-orig", True)),
    ({}, {"en": [], "fr": []}, False, ("en", True)),
    ({}, {"en": []}, True, (None, False)),  # ASR is preferred over auto captions (E6)
    ({}, {"en-de": [], "fr": []}, False, (None, False)),  # translated tracks are never used
    ({}, {}, False, (None, False)),
])
def test_pick_subtitles(subs, auto, asr, expected):
    assert ytdlp.pick_subtitles({"subtitles": subs, "automatic_captions": auto}, asr) == expected


def test_progress_is_monotonic_and_bounded():
    p = ytdlp.Progress(10, 90)
    for line in ("noise", "LIBPROG 50 100 NA", "LIBPROG 10 100 NA", "LIBPROG 1 NA 4.0", "LIBPROG NA NA NA",
                 "LIBPROG 999 100 NA"):
        p.feed(line)
    assert p.value == 90
    q = ytdlp.Progress(10, 90)
    q.feed("LIBPROG 25 NA 100.0")
    assert q.value == 30


def test_find_media_ignores_partial_merges(tmp_path):
    (tmp_path / "dl.f137.mp4").write_bytes(b"x" * 50)
    (tmp_path / "subs.en.srt").write_text("1")
    assert ytdlp.find_media(tmp_path) is None
    (tmp_path / "dl.webm").write_bytes(b"x" * 5)
    assert ytdlp.find_media(tmp_path) == tmp_path / "dl.webm"
    assert ytdlp.find_subtitles(tmp_path) == tmp_path / "subs.en.srt"


@pytest.mark.skipif(importlib.util.find_spec("yt_dlp") is None, reason="yt-dlp is not installed here")
def test_installed_version_matches_the_dependency():
    assert ytdlp.installed_version() == importlib.metadata.version("yt-dlp")


def test_clean_title():
    assert ytdlp.clean_title("  A\tB\n\x00C  ") == "A B C"
    assert ytdlp.clean_title("x" * 300) == "x" * 200
    assert ytdlp.clean_title(None) is None and ytdlp.clean_title("   ") is None




# ==== Task 4: the stage ====
import asyncio  # noqa: E402
from dataclasses import replace  # noqa: E402
import json  # noqa: E402
import logging  # noqa: E402
from pathlib import Path  # noqa: E402
from types import SimpleNamespace  # noqa: E402

from app.library.pipeline import FetchRequest, FetchResult  # noqa: E402
from app.library.ytdlp import Proc, YtDlpFetch  # noqa: E402

STDERR_SECRET = "ERROR: [youtube] SECRETVIDEO1: Sign in to confirm you're not a bot. cookie=SESSIONSECRET"


def settings(**over):
    values = dict(library_link_available=True, library_link_timeout_minutes=20, library_link_allow_generic=False, library_ytdlp_cookies_file="",
                  library_ytdlp_proxy="", library_transcode_max_height=720, library_max_upload_mb=500,
                  library_max_duration_minutes=90)
    values.update(over)
    return SimpleNamespace(**values)


async def public(host):
    return ["142.250.1.1"]


async def private(host):
    return ["10.0.0.7"]


class FakeRunner:
    """Plays yt-dlp: the first call is the probe (prints `info`), the second the download (writes files).

    Like S1's real `media.run`, a call that passes `on_line` gets its stdout line by line and the returned process
    has an EMPTY stdout (R-LI23): the `download` stdout is therefore fed through `on_line`, never returned.
    `contents` maps a file name to the bytes written for it (default 1000 x "x")."""

    def __init__(self, probe: Proc | None = None, download: Proc | None = None, files=("dl.mp4", "subs.en.srt"),
                 lines=(), on_download=None, contents: dict[str, bytes] | None = None):
        self.calls: list[dict] = []
        self.probe = probe or Proc(0, json.dumps(info()), "")
        self.download = download or Proc(0, "", "")
        self.files, self.lines, self.on_download = files, lines, on_download
        self.contents = contents or {}

    async def __call__(self, argv, *, timeout, env, cwd, on_line=None):
        self.calls.append({"argv": list(argv), "timeout": timeout, "env": dict(env), "cwd": Path(cwd),
                           "cookies": (Path(cwd) / ytdlp.COOKIES_NAME).exists()})
        if "--dump-single-json" in argv:
            return self.probe
        if self.on_download is not None:
            await self.on_download()
        for line in (*self.lines, *self.download.stdout.splitlines()):
            on_line(line)
        for name in self.files:
            (Path(cwd) / name).write_bytes(self.contents.get(name, b"x" * 1000))
        return Proc(self.download.returncode, "", self.download.stderr, self.download.timed_out)


def request(tmp_path, *, asr=False, reports=None, **over):
    async def report(pct):
        if reports is not None:
            reports.append(pct)
    return FetchRequest(item_id="item-1", user_id=7, url=URL, tmp_dir=tmp_path / "_tmp" / "item-1",
                        settings=settings(**over), asr_available=asr, report=report)


def stage(runner, **kw):
    kw.setdefault("resolver", public)
    kw.setdefault("disk_free", lambda p: 100 * 1024 * ytdlp.MB)
    return YtDlpFetch(runner, **kw)


# ---- the stage ----

async def test_fetch_success(tmp_path):
    runner = FakeRunner(lines=["LIBPROG 50 100 NA", "LIBPROG 100 100 NA"])
    reports: list[int] = []
    result = await stage(runner, tick=0.001).fetch(request(tmp_path, reports=reports))
    tmp = tmp_path / "_tmp" / "item-1"
    assert result == FetchResult(media_path=tmp / "dl.mp4", title=TITLE, duration_ms=61500,
                                 subtitle_path=tmp / "subs.en.srt", subtitle_auto=False,
                                 source_host="www.youtube.com")
    assert reports[0] == ytdlp.P_CHECKED and reports[-1] == ytdlp.P_DONE and reports == sorted(reports)
    probe, download = runner.calls
    assert probe["cwd"] == tmp and probe["timeout"] == ytdlp.INFO_TIMEOUT and download["timeout"] <= 20 * 60
    assert download["argv"][download["argv"].index("--sub-langs") + 1] == "en"


async def test_a_finished_fetch_is_reused_by_a_retry(tmp_path):
    first = await stage(FakeRunner()).fetch(request(tmp_path))
    assert (tmp_path / "_tmp" / "item-1" / ytdlp.CACHE_NAME).is_file()
    again = FakeRunner(probe=Proc(1, "", "ERROR: must not run"))
    reports: list[int] = []
    assert await stage(again, resolver=private).fetch(request(tmp_path, reports=reports)) == first
    assert again.calls == [] and reports == [ytdlp.P_DONE]


@pytest.mark.parametrize("cache", ["not json", '{"media": "../dl.mp4"}', '{"media": "other.mp4"}', '{"media": 5}',
                                   '{"media": "dl.mp4"}', "[]"])
async def test_a_broken_or_stale_cache_means_fetch_again(tmp_path, cache):
    tmp = tmp_path / "_tmp" / "item-1"
    tmp.mkdir(parents=True)
    (tmp / ytdlp.CACHE_NAME).write_text(cache, encoding="utf-8")
    if "other" in cache:
        (tmp / "other.mp4").write_bytes(b"x")
    runner = FakeRunner()
    result = await stage(runner).fetch(request(tmp_path))
    assert len(runner.calls) == 2 and result.media_path == tmp / "dl.mp4"


async def test_fetch_uses_auto_captions_only_without_asr(tmp_path):
    runner = FakeRunner(probe=Proc(0, json.dumps(info(subtitles={})), ""), files=("dl.mp4", "subs.en-orig.srt"))
    result = await stage(runner).fetch(request(tmp_path, asr=False))
    assert result.subtitle_auto is True and result.subtitle_path.name == "subs.en-orig.srt"
    runner = FakeRunner(probe=Proc(0, json.dumps(info(subtitles={})), ""), files=("dl.mp4",))
    result = await stage(runner).fetch(request(tmp_path / "b", asr=True))
    assert result.subtitle_path is None and "--sub-langs" not in runner.calls[1]["argv"]


async def test_fetch_missing_subtitle_file_is_not_an_error(tmp_path):
    result = await stage(FakeRunner(files=("dl.mp4",))).fetch(request(tmp_path))
    assert result.subtitle_path is None and result.subtitle_auto is False


@pytest.mark.parametrize("runner, kind", [
    (FakeRunner(probe=Proc(1, "", STDERR_SECRET)), "blocked"),
    (FakeRunner(probe=Proc(-9, "", "", timed_out=True)), "ytdlp_transient"),
    (FakeRunner(probe=Proc(0, "not json", "")), "ytdlp_failed"),
    (FakeRunner(probe=Proc(0, "[1, 2]", "")), "ytdlp_failed"),
    (FakeRunner(probe=Proc(0, json.dumps(info(is_live=True)), "")), "live_unsupported"),
    (FakeRunner(probe=Proc(0, json.dumps(info(duration=10 ** 6)), "")), "too_long"),
    (FakeRunner(download=Proc(1, "", "ERROR: This video is DRM protected")), "drm"),
    # yt-dlp prints this on stdout and exits 0 without a file; the real runner does not buffer stdout when it has a
    # line callback, so only the callback can see it (R-LI23). FakeRunner feeds it through `on_line` only.
    (FakeRunner(download=Proc(0, "[download] File is larger than max-filesize (9 bytes > 1 bytes). Aborting.", ""),
                files=()), "too_large"),
    (FakeRunner(download=Proc(0, "", ""), files=("dl.f1.mp4",)), "ytdlp_failed"),
    (FakeRunner(download=Proc(-9, "", "", timed_out=True)), "ytdlp_transient"),
])
async def test_fetch_failures(tmp_path, runner, kind):
    with pytest.raises(LibraryError) as e:
        await stage(runner).fetch(request(tmp_path))
    assert e.value.kind == kind


async def test_fetch_rechecks_the_url_before_running_anything(tmp_path):
    runner = FakeRunner()
    with pytest.raises(LibraryError) as e:
        await stage(runner, resolver=private).fetch(request(tmp_path))
    assert e.value.kind == "bad_url" and runner.calls == []


async def test_fetch_with_a_proxy_skips_local_dns(tmp_path):
    runner = FakeRunner()
    await stage(runner, resolver=private).fetch(request(tmp_path, library_ytdlp_proxy="http://proxy.invalid:3128"))
    assert runner.calls


async def test_fetch_with_a_proxy_still_refuses_private_literals(tmp_path):
    runner = FakeRunner()
    req = request(tmp_path, library_ytdlp_proxy="http://proxy.invalid:3128")
    req = replace(req, url="http://127.0.0.1/v")
    with pytest.raises(LibraryError) as e:
        await stage(runner, resolver=public).fetch(req)
    assert e.value.kind == "bad_url" and runner.calls == []


async def test_fetch_refuses_when_link_import_was_switched_off(tmp_path):
    runner = FakeRunner()
    with pytest.raises(LibraryError) as e:
        await stage(runner).fetch(request(tmp_path, library_link_available=False))
    assert e.value.kind == "link_disabled" and runner.calls == []


async def test_fetch_refuses_without_disk_space(tmp_path):
    runner = FakeRunner()
    with pytest.raises(LibraryError) as e:
        await stage(runner, disk_free=lambda p: 5 * ytdlp.MB).fetch(request(tmp_path))
    assert e.value.kind == "disk_full" and len(runner.calls) == 1  # never downloaded


async def test_fetch_wall_clock_budget(tmp_path):
    ticks = iter([0.0, 0.0, 1300.0, 1300.0])  # started, probe budget, download budget (> 20 min), log
    runner = FakeRunner()
    with pytest.raises(LibraryError) as e:
        await stage(runner, clock=lambda: next(ticks)).fetch(request(tmp_path))
    assert e.value.kind == "ytdlp_transient" and len(runner.calls) == 1


async def test_cookies_are_copied_for_the_run_and_removed(tmp_path):
    source = tmp_path / "cookies-source.txt"
    source.write_text("# Netscape HTTP Cookie File\n")
    runner = FakeRunner(probe=Proc(1, "", STDERR_SECRET))
    with pytest.raises(LibraryError):
        await stage(runner).fetch(request(tmp_path, library_ytdlp_cookies_file=str(source)))
    assert runner.calls[0]["cookies"] is True
    copied = tmp_path / "_tmp" / "item-1" / ytdlp.COOKIES_NAME
    assert runner.calls[0]["argv"][runner.calls[0]["argv"].index("--cookies") + 1] == str(copied)
    assert not copied.exists() and source.exists()


async def test_unreadable_cookies_are_skipped(tmp_path, caplog):
    caplog.set_level(logging.INFO, logger="app")
    runner = FakeRunner()
    await stage(runner).fetch(request(tmp_path, library_ytdlp_cookies_file=str(tmp_path / "missing" / "c.txt")))
    assert "--cookies" not in runner.calls[0]["argv"]
    assert "missing" not in caplog.text and "cookies unreadable" in caplog.text


async def test_cancel_kills_nothing_left_behind(tmp_path):
    source = tmp_path / "c.txt"
    source.write_text("x")

    async def hang():
        await asyncio.sleep(30)

    task = asyncio.create_task(stage(FakeRunner(on_download=hang), tick=0.001).fetch(
        request(tmp_path, library_ytdlp_cookies_file=str(source))))
    await asyncio.sleep(0.05)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert not (tmp_path / "_tmp" / "item-1" / ytdlp.COOKIES_NAME).exists()


async def test_an_aborted_report_stops_the_download(tmp_path):
    """S1's `report` raises `Aborted` once the item was canceled / deleted: yt-dlp must be stopped (the runner is
    cancelled, which is what `media.run` turns into SIGTERM / SIGKILL), the exception must come out unchanged
    (not swallowed with the ticker, not turned into a LibraryError) and the cookies copy must be gone (R-LI24)."""
    from app.library.errors import Aborted
    source = tmp_path / "c.txt"
    source.write_text("x")
    killed: list[int] = []

    class Hanging(FakeRunner):
        async def __call__(self, argv, *, timeout, env, cwd, on_line=None):
            if "--dump-single-json" in argv:
                return self.probe
            on_line("LIBPROG 50 100 NA")  # the ticker reports 50 % -> report() raises Aborted
            try:
                await asyncio.sleep(30)
            except asyncio.CancelledError:
                killed.append(1)
                raise

    async def report(pct):
        if pct > ytdlp.P_PROBED:
            raise Aborted()

    req = FetchRequest(item_id="item-1", user_id=7, url=URL, tmp_dir=tmp_path / "_tmp" / "item-1",
                       settings=settings(library_ytdlp_cookies_file=str(source)), asr_available=False, report=report)
    with pytest.raises(Aborted):
        await asyncio.wait_for(stage(Hanging(), tick=0.001).fetch(req), 5)
    assert killed == [1]
    assert not (tmp_path / "_tmp" / "item-1" / ytdlp.COOKIES_NAME).exists()


async def test_fetch_logs_no_url_title_output_or_secrets(tmp_path, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    source = tmp_path / "cookie-file-name.txt"
    source.write_text("x")
    over = dict(library_ytdlp_cookies_file=str(source), library_ytdlp_proxy="http://u:PROXYPASS@p.example:1")
    await stage(FakeRunner()).fetch(request(tmp_path, **over))
    with pytest.raises(LibraryError):
        await stage(FakeRunner(probe=Proc(1, "", STDERR_SECRET))).fetch(request(tmp_path / "b", **over))
    text = caplog.text
    for secret in ("SECRETVIDEO1", "youtube.com", TITLE, "SESSIONSECRET", "not a bot", "cookie-file-name",
                   "PROXYPASS", str(tmp_path)):
        assert secret not in text
    assert "item=item-1" in text and "kind=blocked" in text


@pytest.mark.skipif(importlib.util.find_spec("yt_dlp") is None, reason="yt-dlp is not installed here")
async def test_media_runner_runs_the_real_yt_dlp(tmp_path):
    """Pins assumption A-3 against S1's real `media.run`: no network, only `--version`."""
    argv = [sys.executable, "-I", "-X", "utf8", "-m", "yt_dlp", "--ignore-config", "--version"]
    proc = await asyncio.wait_for(
        ytdlp.media_runner(argv, timeout=60, env=ytdlp.child_env(tmp_path, ""), cwd=tmp_path), 90)
    assert proc.returncode == 0 and not proc.timed_out
    printed = [int(x) for x in proc.stdout.strip().split(".")[:3]]
    assert printed == [int(x) for x in ytdlp.installed_version().split(".")[:3]]
