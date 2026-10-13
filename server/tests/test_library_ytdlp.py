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


