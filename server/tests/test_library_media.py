"""子进程封装与 ffmpeg 规则(spec §5.1、§6.1)。真实 ffmpeg 的用例只在装了 ffmpeg / ffprobe 的机器上跑。"""
import asyncio
import json
import shutil
import subprocess
import sys

import pytest

from app.library import media
from app.library.errors import LibraryError
from app.library.media import Ffmpeg, ProbeInfo, normalize_plan, parse_probe

HAVE_FFMPEG = shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None
needs_ffmpeg = pytest.mark.skipif(not HAVE_FFMPEG, reason="ffmpeg / ffprobe not installed")


def py(code: str) -> list[str]:
    return [sys.executable, "-c", code]


# ---- run() ----

async def test_run_collects_stdout_and_stderr():
    result = await media.run(py("import sys; print('out'); print('err', file=sys.stderr); sys.exit(3)"), timeout=30)
    assert result.returncode == 3 and result.stdout.strip() == b"out" and result.stderr.strip() == "err"


async def test_run_passes_only_whitelisted_environment(monkeypatch, tmp_path):
    monkeypatch.setenv("UPSTREAM_LLM_KEY", "llm-secret")
    monkeypatch.setenv("ADMIN_PASSWORD", "pw-secret")
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@h/db")
    code = "import os, json; print(json.dumps(sorted(os.environ)))"
    result = await media.run(py(code), timeout=30, env=media.safe_env(tmp_path, {"HTTPS_PROXY": "http://p:1"}))
    names = set(json.loads(result.stdout))
    assert not {"UPSTREAM_LLM_KEY", "ADMIN_PASSWORD", "DATABASE_URL"} & names
    assert {"HOME", "HTTPS_PROXY", "LANG"} <= names
    assert names <= set(media.SAFE_ENV_KEYS) | {"HOME", "HTTPS_PROXY"} | {"__CF_USER_TEXT_ENCODING"}


async def test_run_streams_stdout_lines():
    seen = []

    async def on_line(line):
        seen.append(line)

    result = await media.run(py("print('a=1'); print('b=2')"), timeout=30, on_stdout_line=on_line)
    assert seen == ["a=1", "b=2"] and result.stdout == b""


async def test_run_times_out_and_kills():
    result = await media.run(py("import time; time.sleep(30)"), timeout=0.5)
    assert result.timed_out and result.returncode != 0


async def test_run_takes_a_cwd_and_a_sync_line_callback(tmp_path):
    seen = []
    result = await media.run(py("import os; print(os.getcwd())"), timeout=30, cwd=tmp_path, on_stdout_line=seen.append)
    assert seen == [str(tmp_path)] and not result.timed_out


async def test_run_cancellation_stops_the_process(tmp_path):
    marker = tmp_path / "alive"
    code = f"import time, pathlib\nfor _ in range(60):\n    pathlib.Path(r'{marker}').write_text('x')\n    time.sleep(0.1)"
    task = asyncio.create_task(media.run(py(code), timeout=60))
    for _ in range(100):
        await asyncio.sleep(0.05)
        if marker.exists():
            break
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    marker.unlink()
    await asyncio.sleep(0.5)
    assert not marker.exists()


def test_timeout_rule():
    assert media.timeout_for(None) == 120 and media.timeout_for(10_000) == 120 and media.timeout_for(90 * 60_000) == 16200


# ---- probe and the normalization rules (pure) ----

def _probe(streams, fmt):
    return json.dumps({"streams": streams, "format": fmt}).encode()


def test_parse_probe_ignores_cover_art_and_takes_the_longest_duration():
    info = parse_probe(_probe(
        [{"codec_type": "audio", "codec_name": "mp3", "duration": "61.5"},
         {"codec_type": "video", "codec_name": "mjpeg", "disposition": {"attached_pic": 1}, "height": 500}],
        {"format_name": "mp3", "duration": "61.4"}))
    assert info == ProbeInfo(61500, True, False, None, "mp3", "mp3", None)


@pytest.mark.parametrize("raw", [b"not json", _probe([], {}), _probe([{"codec_type": "audio"}], {"duration": "N/A"})],
                         ids=["garbage", "empty", "no-duration"])
def test_parse_probe_rejects_garbage(raw):
    with pytest.raises(LibraryError) as e:
        parse_probe(raw)
    assert e.value.kind == "corrupt"


@pytest.mark.parametrize("info, name, mime, copies", [
    (ProbeInfo(1000, True, True, "h264", "aac", "mov,mp4,m4a,3gp,3g2,mj2", 720), "media.mp4", "video/mp4", True),
    (ProbeInfo(1000, True, True, "h264", "aac", "mov,mp4,m4a,3gp,3g2,mj2", 1080), "media.mp4", "video/mp4", False),
    (ProbeInfo(1000, True, True, "vp9", "opus", "matroska,webm", 720), "media.mp4", "video/mp4", False),
    (ProbeInfo(1000, True, False, None, "mp3", "mp3", None), "media.mp3", "audio/mpeg", True),
    (ProbeInfo(1000, True, False, None, "aac", "mov,mp4,m4a,3gp,3g2,mj2", None), "media.m4a", "audio/mp4", True),
    (ProbeInfo(1000, True, False, None, "pcm_s16le", "wav", None), "media.m4a", "audio/mp4", False),
    (ProbeInfo(1000, True, False, None, "opus", "ogg", None), "media.m4a", "audio/mp4", False),
], ids=["mp4-copy", "mp4-too-tall", "webm", "mp3", "m4a-copy", "wav", "ogg"])
def test_normalize_plan(tmp_path, info, name, mime, copies):
    args, out = normalize_plan(info, tmp_path, 720)
    assert out.path == tmp_path / name and out.mime == mime and out.kind == ("video" if info.has_video else "audio")
    assert ("copy" in args) is copies and args[-1] == str(tmp_path / name)
    if info.has_video and not copies:
        assert "libx264" in args and "scale=-2:'trunc(min(720,ih)/2)*2'" in args


# ---- real ffmpeg ----

def _make(path, *lavfi_and_codec):
    subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", *lavfi_and_codec, str(path)],
                   check=True, timeout=120)


SPEECHY = "aevalsrc='if(lt(mod(t\\,3)\\,2)\\,0.5*sin(2*PI*440*t)\\,0)':s=44100:d=10"


@needs_ffmpeg
async def test_real_video_is_transcoded_capped_and_gets_a_poster(tmp_path):
    src = tmp_path / "in.webm"
    _make(src, "-f", "lavfi", "-i", "testsrc=size=640x481:rate=10:duration=3", "-f", "lavfi", "-i", SPEECHY,
          "-shortest", "-c:v", "libvpx-vp9", "-c:a", "libopus")
    tool = Ffmpeg()
    info = await tool.probe(src, home=tmp_path)
    assert info.has_video and info.has_audio and info.height == 481 and 2900 <= info.duration_ms <= 3200
    out_dir = tmp_path / "out"
    out_dir.mkdir()
    seen = []

    async def progress(f):
        seen.append(f)

    result = await tool.normalize(src, info, out_dir, max_height=240, home=tmp_path, progress=progress)
    again = await tool.probe(result.path, home=tmp_path)
    assert (result.mime, again.vcodec, again.acodec, again.height) == ("video/mp4", "h264", "aac", 240)
    assert seen and max(seen) <= 1.0
    assert await tool.poster(result.path, out_dir / "poster.jpg", again.duration_ms, home=tmp_path)


@needs_ffmpeg
async def test_real_audio_wav_and_silences(tmp_path):
    src = tmp_path / "in.wav"
    _make(src, "-f", "lavfi", "-i", SPEECHY)
    tool = Ffmpeg()
    info = await tool.probe(src, home=tmp_path)
    result = await tool.normalize(src, info, tmp_path, max_height=720, home=tmp_path)
    assert result.path.name == "media.m4a" and (await tool.probe(result.path, home=tmp_path)).acodec == "aac"
    silences = await tool.speech_wav(result.path, tmp_path / "speech.wav", info.duration_ms, home=tmp_path)
    assert [(round(s.start_ms, -2), round(s.end_ms, -2)) for s in silences][:2] == [(2000, 3000), (5000, 6000)]


@needs_ffmpeg
async def test_real_garbage_is_corrupt(tmp_path):
    src = tmp_path / "in.mp4"
    src.write_bytes(b"\x00" * 4096)
    with pytest.raises(LibraryError) as e:
        await Ffmpeg().probe(src, home=tmp_path)
    assert e.value.kind == "corrupt"
