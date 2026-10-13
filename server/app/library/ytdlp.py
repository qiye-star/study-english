"""The link-import fetch stage (spec 2026-10-13-video-import §7): yt-dlp as a child process.

`YtDlpFetch.fetch(req)` is the real `app.library.pipeline.FetchStage` (S1 ships only the interface and a default
that raises `unsupported_site`); `routers/library_import.install(app)` registers it on the worker.

Steps (spec §7.1): re-run the URL precheck (DNS may have changed since the item was queued) -> `--dump-single-json`
(title, duration, live / playlist / DRM, subtitle lists; all permanent refusals happen before any download) ->
size + disk check -> download into `_tmp/<item>/dl.<ext>` (+ at most one English subtitle file `subs.<lang>.srt`).

Safety (spec §7.2, §13):
- `python -I -X utf8 -m yt_dlp` (isolated: no PYTHON* variables, no user site, the downloads directory is never on
  `sys.path`), never through a shell, `--` before the URL, `--ignore-config --no-plugin-dirs --no-cache-dir`, no
  `--exec`; fixed output names only;
- the child environment is a whitelist (`child_env`): PATH, HOME (= the item's `_tmp`), LANG and, when configured,
  the proxy variables; never UPSTREAM_*, *_KEY, ADMIN_*, DATABASE_URL;
- the generic extractor is off unless `library_link_allow_generic` (`--use-extractors default,-generic` and an
  `extractor_key` check on the probe result);
- cookies are copied into `_tmp` (mode 0600) for each run and deleted in `finally`; the configured file is only read;
- stderr / stdout are only classified (`classify`, a fixed regex table) or parsed for progress, then dropped. Logs
  carry the item id, the error kind, the exit code, milliseconds and byte counts: never the URL, the title, subtitle
  text, yt-dlp output, the cookies path or the proxy."""
from __future__ import annotations

import asyncio
import importlib.metadata
import json
import logging
import math
import os
import re
import shutil
import sys
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.library import media, urlcheck
from app.library.errors import LibraryError
from app.library.pipeline import FetchRequest, FetchResult

logger = logging.getLogger(__name__)

MB = 1_048_576
INFO_TIMEOUT = 180.0  # seconds for the probe; the download gets the rest of library_link_timeout_minutes
SOCKET_TIMEOUT = 15
RETRIES = 3
COOKIES_NAME = "cookies.txt"
CACHE_NAME = "fetch.json"  # a finished fetch, reused by a retry of a later stage (spec §6.5): no second download
MAX_COOKIES_BYTES = MB
# Extra arguments that select the JavaScript runtime for YouTube challenges; filled by Task 6 from spike T0.2
# (empty = yt-dlp's own default). Never `--remote-components`: no code is downloaded at run time (spec §7.3).
JS_RUNTIME_ARGS: tuple[str, ...] = ()
MEDIA_SUFFIXES = frozenset({".mp4", ".m4a", ".m4v", ".mov", ".webm", ".mkv", ".mp3", ".aac", ".ogg", ".opus",
                            ".oga", ".flac", ".wav", ".flv", ".3gp"})
MANUAL_LANGS = ("en", "en-US", "en-GB")
AUTO_LANGS = ("en-orig", "en")  # never a machine-translated track
LIVE_STATUSES = frozenset({"is_live", "is_upcoming", "post_live"})
PROGRESS_TEMPLATE = ("download:LIBPROG %(progress.downloaded_bytes)s %(progress.total_bytes)s "
                     "%(progress.total_bytes_estimate)s")
# progress inside the fetch stage (S1 maps 0-100 onto the pipeline's 0-40)
P_CHECKED, P_PROBED, P_DOWNLOADED, P_DONE = 2, 10, 95, 100

_PROGRESS = re.compile(r"^LIBPROG (\d+(?:\.\d+)?) (\S+) (\S+)$")
_URLS = re.compile(r"https?://\S+", re.I)
_EN = re.compile(r"en(?:[-_][A-Za-z0-9]+)*")
_TOO_LARGE = re.compile(r"larger than max-filesize", re.I)

# First match wins. Applied to yt-dlp's ERROR lines first, then to all of stderr; URLs are blanked out before
# matching so a link or a slug can never decide the kind. Unmatched -> ytdlp_failed.
CLASSIFY: tuple[tuple[str, re.Pattern[str]], ...] = tuple((kind, re.compile(pattern, re.I)) for kind, pattern in (
    ("drm", r"\bDRM\b"),
    ("live_unsupported", r"live event will begin|premieres? in \d|this live stream|is (?:currently )?live\b"
                         r"|live stream recording is not available"),
    ("blocked", r"not a bot|HTTP Error 429|too many requests|unusual traffic|IP (?:address )?(?:is |has been )?blocked"),
    ("geo_blocked", r"not available in your country|not made this video available in your country"
                    r"|available from your location|geo[- ]?restrict"),
    ("private", r"private video|this video is private|video is private"),
    ("login_required", r"sign in to confirm your age|age[- ]restricted|members[- ]only|join this channel"
                       r"|login required|requires? (?:a )?(?:login|account|subscription|authentication)|sign in"),
    ("unsupported_site", r"unsupported url|no suitable (?:infoextractor|extractor)"),
    ("bad_url", r"is not a valid url"),
    ("too_large", r"larger than max-filesize"),
    ("ytdlp_failed", r"javascript runtime|n challenge|\bnsig\b|signature extraction failed|unable to extract"
                     r"|requested format is not available"),
    ("network", r"timed out|connection (?:reset|refused|aborted)|temporary failure in name resolution"
                r"|name or service not known|getaddrinfo failed|network is unreachable|remote end closed"
                r"|incompleteread|eof occurred|urlopen error"),
    ("ytdlp_transient", r"HTTP Error 5\d\d|HTTP Error 403|unable to download (?:webpage|api page|json)"
                        r"|giving up after \d+ (?:fragment )?retries"),
))
KINDS_RAISED = frozenset({kind for kind, _ in CLASSIFY} | {
    "link_disabled", "bad_url", "playlist_unsupported", "unsupported_site", "too_long", "too_large", "disk_full",
    "ytdlp_failed", "ytdlp_transient"})


def installed_version() -> str | None:
    """The installed yt-dlp version (admin overview, spec §12), or None when the package is missing."""
    try:
        return importlib.metadata.version("yt-dlp")
    except importlib.metadata.PackageNotFoundError:
        return None


# ---- pure helpers ----

def _match(text: str) -> str | None:
    for kind, pattern in CLASSIFY:
        if pattern.search(text):
            return kind
    return None


def classify(stderr: str) -> str:
    text = _URLS.sub(" ", stderr or "")
    errors = "\n".join(line for line in text.splitlines() if line.lstrip().startswith("ERROR"))
    return _match(errors) or _match(text) or "ytdlp_failed"


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        return None
    return float(value)


def clean_title(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    text = " ".join("".join(c if c.isprintable() else " " for c in value).split())
    return text[:200] or None


def format_selector(max_height: int) -> str:
    h = int(max_height)
    return (f"bv*[height<={h}][ext=mp4][vcodec^=avc1]+ba[ext=m4a]/bv*[height<={h}][ext=mp4]+ba[ext=m4a]"
            f"/b[height<={h}]/b/ba")


def child_env(tmp: Path, proxy: str | None) -> dict[str, str]:
    env = {"PATH": os.environ.get("PATH", os.defpath), "HOME": str(tmp), "LANG": "C.UTF-8"}
    if os.name == "nt":  # dev machines only: Python cannot open sockets without it
        env["SYSTEMROOT"] = os.environ.get("SYSTEMROOT", r"C:\Windows")
    if proxy:
        for key in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
            env[key] = proxy
    return env


def common_args(*, allow_generic: bool, cookies: Path | None) -> list[str]:
    args = [sys.executable, "-I", "-X", "utf8", "-m", "yt_dlp", "--ignore-config", "--no-plugin-dirs",
            "--no-cache-dir", "--no-playlist", "--socket-timeout", str(SOCKET_TIMEOUT), "--retries", str(RETRIES),
            "--fragment-retries", str(RETRIES), *JS_RUNTIME_ARGS]
    if not allow_generic:
        args += ["--use-extractors", "default,-generic"]
    if cookies is not None:
        args += ["--cookies", str(cookies)]
    return args


def info_args(url: str, *, allow_generic: bool, cookies: Path | None, max_height: int) -> list[str]:
    return [*common_args(allow_generic=allow_generic, cookies=cookies), "--dump-single-json", "--skip-download",
            "-f", format_selector(max_height), "--", url]


def download_args(url: str, tmp: Path, *, allow_generic: bool, cookies: Path | None, max_height: int,
                  max_mb: int, sub_lang: str | None, sub_auto: bool) -> list[str]:
    args = [*common_args(allow_generic=allow_generic, cookies=cookies), "-f", format_selector(max_height),
            "--merge-output-format", "mp4", "--max-filesize", f"{int(max_mb)}M", "--no-part", "--no-mtime",
            "--newline", "--progress-template", PROGRESS_TEMPLATE, "-P", str(tmp), "-o", "dl.%(ext)s",
            "-o", "subtitle:subs.%(ext)s"]
    if sub_lang:
        args += ["--write-auto-subs" if sub_auto else "--write-subs", "--sub-langs", re.escape(sub_lang),
                 "--sub-format", "srt/vtt/best", "--convert-subs", "srt"]
    return [*args, "--", url]


def check_info(info: dict, *, max_minutes: int, allow_generic: bool) -> None:
    """Permanent refusals decided before any byte of media is downloaded (spec §7.1 step 1, §7.4)."""
    if info.get("_type") in ("playlist", "multi_video"):
        raise LibraryError("playlist_unsupported")
    if info.get("is_live") is True or info.get("live_status") in LIVE_STATUSES:
        raise LibraryError("live_unsupported")
    extractor = str(info.get("extractor_key") or info.get("extractor") or "").lower()
    if not allow_generic and extractor == "generic":
        raise LibraryError("unsupported_site")
    formats = [f for f in info.get("formats") or [] if isinstance(f, dict)]
    if formats and all(f.get("has_drm") for f in formats):
        raise LibraryError("drm")
    duration = _number(info.get("duration"))
    if duration is not None and duration > max_minutes * 60:
        raise LibraryError("too_long")


def estimate_bytes(info: dict) -> int | None:
    """Sum of the selected formats' sizes (exact or approximate); None when any part is unknown."""
    parts = info.get("requested_formats") or [info]
    total = 0.0
    for part in parts:
        if not isinstance(part, dict):
            return None
        size = _number(part.get("filesize")) or _number(part.get("filesize_approx"))
        if not size:
            return None
        total += size
    return int(total)


def check_space(estimate: int | None, cap_bytes: int, free_bytes: int) -> None:
    if estimate is not None and estimate > cap_bytes:
        raise LibraryError("too_large")
    if free_bytes < 2 * (estimate if estimate is not None else cap_bytes):
        raise LibraryError("disk_full")


def _pick_lang(keys, preferred: tuple[str, ...], *, any_english: bool) -> str | None:
    names = [k for k in keys if isinstance(k, str)]
    for lang in preferred:
        if lang in names:
            return lang
    if any_english:
        english = sorted(k for k in names if _EN.fullmatch(k))
        return english[0] if english else None
    return None


def pick_subtitles(info: dict, asr_available: bool) -> tuple[str | None, bool]:
    """(language key, is_auto). Spec E6: manual English > (ASR, decided by the pipeline) > platform auto captions,
    and auto captions only when ASR is unavailable."""
    manual = info.get("subtitles") if isinstance(info.get("subtitles"), dict) else {}
    lang = _pick_lang(manual.keys(), MANUAL_LANGS, any_english=True)
    if lang:
        return lang, False
    if asr_available:
        return None, False
    auto = info.get("automatic_captions") if isinstance(info.get("automatic_captions"), dict) else {}
    lang = _pick_lang(auto.keys(), AUTO_LANGS, any_english=False)
    return (lang, True) if lang else (None, False)


def find_media(tmp: Path) -> Path | None:
    """`dl.<ext>` only: `dl.f137.mp4`-style leftovers of a failed merge never count."""
    found = [p for p in tmp.iterdir() if p.is_file() and p.stem == "dl" and p.suffix.lower() in MEDIA_SUFFIXES]
    return max(found, key=lambda p: p.stat().st_size) if found else None


def find_subtitles(tmp: Path) -> Path | None:
    found = sorted(p for p in tmp.glob("subs.*.srt") if p.is_file())
    return found[0] if found else None


def copy_cookies(source: str | None, tmp: Path, item_id: str) -> Path | None:
    if not source:
        return None
    try:
        path = Path(source)
        if path.stat().st_size > MAX_COOKIES_BYTES:
            raise OSError("too large")
        data = path.read_bytes()
    except OSError:
        logger.warning("library fetch cookies unreadable item=%s", item_id)  # never the path
        return None
    target = tmp / COOKIES_NAME
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as fh:
        fh.write(data)
    return target


def save_cache(tmp: Path, result: FetchResult) -> None:
    data = {"media": result.media_path.name, "title": result.title, "duration_ms": result.duration_ms,
            "subtitles": result.subtitle_path.name if result.subtitle_path else None,
            "auto": result.subtitle_auto, "host": result.source_host}
    (tmp / CACHE_NAME).write_text(json.dumps(data), encoding="utf-8")


def load_cache(tmp: Path) -> FetchResult | None:
    """The cached result when it is intact and its files are still there; anything odd = None (fetch again)."""
    try:
        data = json.loads((tmp / CACHE_NAME).read_text(encoding="utf-8"))
        media_name, subs_name = data["media"], data.get("subtitles")
        if Path(media_name).name != media_name or Path(media_name).stem != "dl":
            return None
        media_path = tmp / media_name
        subs = tmp / subs_name if subs_name and Path(subs_name).name == subs_name else None
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return None
    if not media_path.is_file():
        return None
    if subs is not None and not subs.is_file():
        subs = None
    duration, host = data.get("duration_ms"), data.get("host")
    return FetchResult(media_path=media_path, title=clean_title(data.get("title")),
                       duration_ms=duration if isinstance(duration, int) and not isinstance(duration, bool) else None,
                       subtitle_path=subs, subtitle_auto=bool(data.get("auto")) and subs is not None,
                       source_host=host if isinstance(host, str) else None)


class Progress:
    """Turns `LIBPROG <done> <total> <estimate>` lines into a monotonic percentage between `low` and `high`."""

    def __init__(self, low: int, high: int):
        self.low, self.high, self.value = low, high, low

    def feed(self, line: str) -> None:
        m = _PROGRESS.match(line.strip())
        if not m:
            return
        total = None
        for raw in (m[2], m[3]):
            try:
                total = float(raw)
            except ValueError:
                continue
            if math.isfinite(total) and total > 0:
                break
            total = None
        if not total:
            return
        fraction = min(1.0, max(0.0, float(m[1]) / total))
        self.value = max(self.value, self.low + int((self.high - self.low) * fraction))


# ---- the child process ----

@dataclass(frozen=True)
class Proc:
    returncode: int
    stdout: str
    stderr: str
    timed_out: bool = False


Runner = Callable[..., Awaitable[Proc]]  # (argv, *, timeout, env, cwd, on_line) -> Proc


def _text(value: Any) -> str:
    if isinstance(value, (bytes, bytearray)):
        return bytes(value).decode("utf-8", "replace")
    return value or ""


async def media_runner(argv: list[str], *, timeout: float, env: dict[str, str], cwd: Path,
                       on_line: Callable[[str], None] | None = None) -> Proc:
    """The only place that knows S1's `media.run` signature (plan assumption A-3)."""
    result = await media.run(argv, timeout=timeout, env=env, cwd=cwd, on_stdout_line=on_line)
    return Proc(int(result.returncode), _text(result.stdout), _text(result.stderr),
                bool(getattr(result, "timed_out", False)))


def _disk_free(path: Path) -> int:
    return shutil.disk_usage(path).free


class YtDlpFetch:
    """The real `FetchStage`. Everything external is injectable for tests: `runner`, `resolver` (DNS), `disk_free`,
    `clock`, `tick` (seconds between progress reports while downloading)."""

    def __init__(self, runner: Runner = media_runner, *, resolver: urlcheck.Resolver | None = None,
                 disk_free: Callable[[Path], int] = _disk_free, clock: Callable[[], float] = time.monotonic,
                 tick: float = 1.0):
        self._runner, self._resolver, self._disk_free = runner, resolver, disk_free
        self._clock, self._tick = clock, tick

    def _remaining(self, deadline: float) -> float:
        left = deadline - self._clock()
        if left <= 0:
            raise LibraryError("ytdlp_transient")
        return left

    async def _download(self, argv: list[str], *, timeout: float, env: dict[str, str], cwd: Path,
                        report: Callable[[int], Awaitable[None]]) -> tuple[Proc, bool]:
        """Run the download; returns `(process, refused_for_size)`.

        S1's `media.run` does not buffer stdout when it is given a line callback, so the one stdout line that matters
        besides progress ("File is larger than max-filesize": yt-dlp exits 0 without a file) is caught in the
        callback (R-LI23). The progress ticker and the child run side by side: when `report` raises (S1 raises
        `Aborted` for a canceled / deleted item) the child is cancelled and the exception comes out unchanged
        (R-LI24); an outer cancellation cancels both. Nothing outlives this call."""
        progress = Progress(P_PROBED, P_DOWNLOADED - 5)
        too_large = False

        def on_line(line: str) -> None:
            nonlocal too_large
            progress.feed(line)
            if _TOO_LARGE.search(line):
                too_large = True

        async def tick() -> None:
            sent = progress.low
            while True:
                await asyncio.sleep(self._tick)
                if progress.value > sent:
                    sent = progress.value
                    await report(sent)

        run = asyncio.ensure_future(self._runner(argv, timeout=timeout, env=env, cwd=cwd, on_line=on_line))
        ticker = asyncio.ensure_future(tick())
        try:
            await asyncio.wait({run, ticker}, return_when=asyncio.FIRST_COMPLETED)
            if not run.done():  # the ticker only ends by raising
                run.cancel()
                await asyncio.gather(run, return_exceptions=True)
                ticker.result()
            return run.result(), too_large
        finally:
            for task in (run, ticker):
                task.cancel()
            await asyncio.gather(run, ticker, return_exceptions=True)

    async def fetch(self, req: FetchRequest) -> FetchResult:
        s = req.settings
        started = self._clock()
        deadline = started + int(s.library_link_timeout_minutes) * 60
        tmp = Path(req.tmp_dir)
        tmp.mkdir(parents=True, exist_ok=True)
        cookies: Path | None = None
        exit_code: int | None = None
        try:
            if not s.library_link_available:  # switched off (or yt-dlp gone) after the item was queued
                raise LibraryError("link_disabled")
            cached = load_cache(tmp)
            if cached is not None:
                await req.report(P_DONE)
                logger.info("library fetch reused item=%s", req.item_id)
                return cached
            try:
                checked = await urlcheck.precheck(req.url, resolver=self._resolver)
            except urlcheck.UrlRejected as e:
                logger.info("library fetch precheck rejected item=%s reason=%s", req.item_id, e.reason)
                raise LibraryError("bad_url") from None
            await req.report(P_CHECKED)
            allow_generic = bool(s.library_link_allow_generic)
            cookies = copy_cookies(s.library_ytdlp_cookies_file, tmp, req.item_id)
            env = child_env(tmp, s.library_ytdlp_proxy)

            proc = await self._runner(
                info_args(checked.url, allow_generic=allow_generic, cookies=cookies,
                          max_height=s.library_transcode_max_height),
                timeout=min(INFO_TIMEOUT, self._remaining(deadline)), env=env, cwd=tmp, on_line=None)
            exit_code = proc.returncode
            if proc.timed_out:
                raise LibraryError("ytdlp_transient")
            if proc.returncode != 0:
                raise LibraryError(classify(proc.stderr))
            try:
                info = json.loads(proc.stdout)
            except ValueError:
                raise LibraryError("ytdlp_failed") from None
            if not isinstance(info, dict):
                raise LibraryError("ytdlp_failed")
            check_info(info, max_minutes=int(s.library_max_duration_minutes), allow_generic=allow_generic)
            check_space(estimate_bytes(info), int(s.library_max_upload_mb) * MB, self._disk_free(tmp))
            sub_lang, sub_auto = pick_subtitles(info, req.asr_available)
            await req.report(P_PROBED)

            proc, too_large = await self._download(
                download_args(checked.url, tmp, allow_generic=allow_generic, cookies=cookies,
                              max_height=s.library_transcode_max_height, max_mb=s.library_max_upload_mb,
                              sub_lang=sub_lang, sub_auto=sub_auto),
                timeout=self._remaining(deadline), env=env, cwd=tmp, report=req.report)
            exit_code = proc.returncode
            if proc.timed_out:
                raise LibraryError("ytdlp_transient")
            if proc.returncode != 0:
                raise LibraryError(classify(proc.stderr))
            media_path = find_media(tmp)
            if media_path is None:
                raise LibraryError("too_large" if too_large else "ytdlp_failed")
            await req.report(P_DOWNLOADED)
            subtitles = find_subtitles(tmp) if sub_lang else None
            duration = _number(info.get("duration"))
            result = FetchResult(media_path=media_path, title=clean_title(info.get("title")),
                                 duration_ms=round(duration * 1000) if duration is not None else None,
                                 subtitle_path=subtitles, subtitle_auto=bool(subtitles is not None and sub_auto),
                                 source_host=checked.source_host)
            save_cache(tmp, result)
            await req.report(P_DONE)
            logger.info("library fetch done item=%s ms=%d bytes=%d subs=%s auto=%s", req.item_id,
                        (self._clock() - started) * 1000, media_path.stat().st_size,
                        "yes" if subtitles else "no", "yes" if result.subtitle_auto else "no")
            return result
        except LibraryError as e:
            logger.info("library fetch failed item=%s kind=%s exit=%s ms=%d", req.item_id, e.kind,
                        exit_code if exit_code is not None else "-", (self._clock() - started) * 1000)
            raise
        finally:
            if cookies is not None:
                cookies.unlink(missing_ok=True)
