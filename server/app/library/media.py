"""子进程与 ffmpeg / ffprobe(spec §5.1、§6.1 末段、§6.2)。

`run(cmd, *, timeout, env, cwd, on_stdout_line)`:`create_subprocess_exec`(不经 shell)、stdin 关闭、环境变量白名单(`safe_env`,
绝不继承 `UPSTREAM_*` / `*_KEY` / `ADMIN_*` / `DATABASE_URL`)、POSIX 上 `nice -n 10`;stdout 只用来解析进度或
ffprobe 的 JSON;stderr 读完后只交给调用方分类(silencedetect 的数字、「磁盘满」),**绝不记录**(里面有文件名、
标题与 URL)。超时:结束进程并返回 `timed_out=True`;取消:结束进程后继续抛出。结束 = 先 terminate,5 秒后 kill。

`Ffmpeg` 是流水线用的媒体工具(测试里换成假的):`probe`、`normalize`(规范化成 H.264/AAC mp4,或 mp3 / m4a)、
`poster`(视频封面)、`speech_wav`(16 kHz 单声道 WAV + 静音表)。
"""
import asyncio
import inspect
import json
import os
import shutil
from collections.abc import Awaitable, Callable, Mapping, Sequence
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.library.asr_chunks import Silence, parse_silences
from app.library.errors import LibraryError

STDERR_CAP = 4 * 1024 * 1024
# asyncio's StreamReader refuses a line over 64 KiB (ValueError); `yt-dlp --dump-single-json` prints everything on ONE line.
STDOUT_LINE_LIMIT = 64 * 1024 * 1024
KILL_GRACE_SECONDS = 5.0
SAFE_ENV_KEYS = ("PATH", "LANG", "LC_ALL", "SYSTEMROOT", "TEMP", "TMP")  # SYSTEMROOT/TEMP: Windows dev machines
THREADS = "2"


@dataclass(frozen=True)
class RunResult:
    returncode: int
    stdout: bytes  # empty when `on_stdout_line` consumed it
    stderr: str  # for classification only; never log it
    timed_out: bool = False


def safe_env(home: Path | None = None, extra: dict[str, str] | None = None) -> dict[str, str]:
    """Only the whitelisted variables of this process, HOME pointed at the job's staging directory, plus `extra`."""
    env = {k: os.environ[k] for k in SAFE_ENV_KEYS if k in os.environ}
    env.setdefault("LANG", "C.UTF-8")
    if home is not None:
        env["HOME"] = str(home)
    env.update(extra or {})
    return env


def _prefix() -> list[str]:
    if os.name == "posix" and shutil.which("nice"):
        return ["nice", "-n", "10"]
    return []


async def _stop(proc: asyncio.subprocess.Process) -> None:
    with suppress(ProcessLookupError):
        proc.terminate()
    try:
        await asyncio.wait_for(proc.wait(), KILL_GRACE_SECONDS)
    except (TimeoutError, asyncio.TimeoutError):
        with suppress(ProcessLookupError):
            proc.kill()
        await proc.wait()


async def run(cmd: Sequence[str], *, timeout: float, env: Mapping[str, str] | None = None, cwd: Path | None = None,
              on_stdout_line: Callable[[str], Any] | None = None) -> RunResult:
    """Run one subprocess (no shell). `env` is the child's complete environment (default `safe_env()`).
    `on_stdout_line` (sync or async) gets each stdout line instead of buffering it. A timeout stops the process and
    returns `timed_out=True`; cancellation stops it and re-raises."""
    proc = await asyncio.create_subprocess_exec(
        *_prefix(), *cmd, stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE, env=dict(env) if env is not None else safe_env(),
        cwd=str(cwd) if cwd is not None else None, limit=STDOUT_LINE_LIMIT)
    out = bytearray()
    err = bytearray()

    async def pump_out() -> None:
        while True:
            line = await proc.stdout.readline()
            if not line:
                return
            if on_stdout_line is not None:
                result = on_stdout_line(line.decode("utf-8", "replace").strip())
                if inspect.isawaitable(result):
                    await result
            else:
                out.extend(line)

    async def pump_err() -> None:
        while chunk := await proc.stderr.read(65536):
            err.extend(chunk)
            if len(err) > STDERR_CAP:
                del err[:len(err) - STDERR_CAP]

    timed_out = False
    try:
        await asyncio.wait_for(asyncio.gather(pump_out(), pump_err(), proc.wait()), timeout)
    except (TimeoutError, asyncio.TimeoutError):
        timed_out = True
        await _stop(proc)
    except BaseException:
        await asyncio.shield(_stop(proc))
        raise
    code = proc.returncode if proc.returncode is not None else -1
    return RunResult(code, bytes(out), err.decode("utf-8", "replace"), timed_out)


def timeout_for(duration_ms: int | None) -> float:
    """max(120, 3 x duration) seconds (spec §5.1)."""
    return max(120.0, 3 * (duration_ms or 0) / 1000)


def _failure_kind(stderr: str, default: str) -> str:
    return "disk_full" if "No space left on device" in stderr else default


@dataclass(frozen=True)
class ProbeInfo:
    duration_ms: int
    has_audio: bool
    has_video: bool
    vcodec: str | None
    acodec: str | None
    format_name: str
    height: int | None


@dataclass(frozen=True)
class Normalized:
    path: Path
    mime: str
    kind: str  # audio / video


def parse_probe(raw: bytes) -> ProbeInfo:
    try:
        data = json.loads(raw.decode("utf-8", "replace"))
        streams = data.get("streams") or []
        fmt = data.get("format") or {}
    except (ValueError, AttributeError):
        raise LibraryError("corrupt") from None
    video = [s for s in streams if s.get("codec_type") == "video"
             and not (s.get("disposition") or {}).get("attached_pic")]
    audio = [s for s in streams if s.get("codec_type") == "audio"]
    durations = [fmt.get("duration")] + [s.get("duration") for s in streams]
    seconds = 0.0
    for value in durations:
        try:
            seconds = max(seconds, float(value))
        except (TypeError, ValueError):
            continue
    if seconds <= 0:
        raise LibraryError("corrupt")
    height = None
    if video:
        try:
            height = int(video[0].get("height") or 0) or None
        except (TypeError, ValueError):
            height = None
    return ProbeInfo(round(seconds * 1000), bool(audio), bool(video), video[0].get("codec_name") if video else None,
                     audio[0].get("codec_name") if audio else None, str(fmt.get("format_name") or ""), height)


def _is_mp4(format_name: str) -> bool:
    return bool({"mov", "mp4", "m4a"} & set(format_name.split(",")))


def normalize_plan(info: ProbeInfo, out_dir: Path, max_height: int) -> tuple[list[str], Normalized]:
    """ffmpeg output arguments (after `-i src`) and the result, by the rules of spec §5.1."""
    if info.has_video:
        out = out_dir / "media.mp4"
        if (info.vcodec == "h264" and info.acodec == "aac" and _is_mp4(info.format_name)
                and (info.height or 0) <= max_height):
            args = ["-map", "0:v:0", "-map", "0:a:0", "-c", "copy"]
        else:
            args = ["-map", "0:v:0", "-map", "0:a:0", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
                    "-pix_fmt", "yuv420p", "-vf", f"scale=-2:'trunc(min({max_height},ih)/2)*2'",
                    "-c:a", "aac", "-b:a", "128k", "-ac", "2"]
        return args + ["-movflags", "+faststart", "-f", "mp4", str(out)], Normalized(out, "video/mp4", "video")
    if info.acodec == "mp3" and "mp3" in info.format_name.split(","):
        out = out_dir / "media.mp3"
        return ["-vn", "-map", "0:a:0", "-c:a", "copy", "-f", "mp3", str(out)], Normalized(out, "audio/mpeg", "audio")
    out = out_dir / "media.m4a"
    if info.acodec == "aac" and _is_mp4(info.format_name):
        args = ["-vn", "-map", "0:a:0", "-c:a", "copy"]
    else:
        args = ["-vn", "-map", "0:a:0", "-c:a", "aac", "-b:a", "96k"]
    return args + ["-movflags", "+faststart", "-f", "mp4", str(out)], Normalized(out, "audio/mp4", "audio")


def audio_only_plan(out_dir: Path) -> tuple[list[str], Normalized]:
    """Curated catalog (spec 2026-10-14-curated-library D4): always re-encode to mono AAC 64 kbps m4a."""
    out = out_dir / "media.m4a"
    return (["-vn", "-map", "0:a:0", "-ac", "1", "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart",
             "-f", "mp4", str(out)], Normalized(out, "audio/mp4", "audio"))


class Ffmpeg:
    def __init__(self, ffmpeg: str = "ffmpeg", ffprobe: str = "ffprobe"):
        self.ffmpeg = ffmpeg
        self.ffprobe = ffprobe

    def _base(self) -> list[str]:
        return [self.ffmpeg, "-nostdin", "-hide_banner", "-y"]

    async def probe(self, src: Path, *, home: Path) -> ProbeInfo:
        result = await run([self.ffprobe, "-v", "error", "-show_format", "-show_streams", "-of", "json", str(src)],
                           timeout=120, env=safe_env(home))
        if result.timed_out or result.returncode != 0:
            raise LibraryError("corrupt")
        return parse_probe(result.stdout)

    async def normalize(self, src: Path, info: ProbeInfo, out_dir: Path, *, max_height: int, home: Path,
                        progress: Callable[[float], Awaitable[None]] | None = None) -> Normalized:
        args, result = normalize_plan(info, out_dir, max_height)
        total_us = max(1, info.duration_ms * 1000)

        async def on_line(line: str) -> None:
            key, _, value = line.partition("=")
            if progress is not None and key in ("out_time_us", "out_time_ms") and value.strip().isdigit():
                await progress(min(1.0, int(value) / total_us))

        cmd = [*self._base(), "-nostats", "-progress", "pipe:1", "-i", str(src), "-threads", THREADS, *args]
        done = await run(cmd, timeout=timeout_for(info.duration_ms), env=safe_env(home), on_stdout_line=on_line)
        if done.timed_out:
            raise LibraryError("unsupported_format")
        if done.returncode != 0 or not result.path.is_file():
            raise LibraryError(_failure_kind(done.stderr, "unsupported_format"))
        return result

    async def audio_only(self, src: Path, out_dir: Path, *, duration_ms: int, home: Path) -> Normalized:
        args, result = audio_only_plan(out_dir)
        cmd = [*self._base(), "-nostats", "-i", str(src), "-threads", THREADS, *args]
        done = await run(cmd, timeout=timeout_for(duration_ms), env=safe_env(home))
        if done.timed_out:
            raise LibraryError("unsupported_format")
        if done.returncode != 0 or not result.path.is_file():
            raise LibraryError(_failure_kind(done.stderr, "unsupported_format"))
        return result

    async def poster(self, media: Path, dst: Path, duration_ms: int, *, home: Path) -> bool:
        """One frame at 10 % of the duration, 360 px high. A failure only means "no poster"."""
        at = f"{duration_ms * 0.1 / 1000:.3f}"
        cmd = [*self._base(), "-v", "error", "-ss", at, "-i", str(media), "-frames:v", "1", "-vf", "scale=-2:360",
               "-q:v", "4", str(dst)]
        done = await run(cmd, timeout=120, env=safe_env(home))
        return not done.timed_out and done.returncode == 0 and dst.is_file()

    async def speech_wav(self, src: Path, dst: Path, duration_ms: int, *, home: Path) -> list[Silence]:
        """16 kHz mono 16-bit WAV for the recognizer plus the silences found on the way (one ffmpeg pass)."""
        cmd = [*self._base(), "-nostats", "-i", str(src), "-vn", "-ac", "1", "-ar", "16000", "-af",
               "silencedetect=noise=-35dB:d=0.35", "-c:a", "pcm_s16le", "-f", "wav", str(dst)]
        done = await run(cmd, timeout=timeout_for(duration_ms), env=safe_env(home))
        if done.timed_out:
            raise LibraryError("corrupt")
        if done.returncode != 0 or not dst.is_file():
            raise LibraryError(_failure_kind(done.stderr, "corrupt"))
        return parse_silences(done.stderr, duration_ms)
