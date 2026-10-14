"""跟读库测试工具:假的媒体工具(不需要 ffmpeg)、假的识别、上传助手、驱动 worker 一轮。

假媒体文件是 `FAKE:` + 一行 JSON(`duration_ms`、`video`、`audio`)+ 任意字节;`FakeTools` 按它「探测」,规范化时写出同样格式的
成品文件,`speech_wav` 写一段真正的 16 kHz 单声道 WAV(静音)并返回预设的静音表。"""
import io
import json
import wave
from pathlib import Path

from app.core import config as config_module
from app.library.asr_chunks import Silence
from app.library.errors import LibraryError
from app.library.media import Normalized, ProbeInfo
from app.speech.timed import TimedText
from tests.background import drain_background

SRT = (b"1\n00:00:00,500 --> 00:00:03,000\nHello there, my friend.\n\n"
       b"2\n00:00:03,200 --> 00:00:06,000\nHow are you doing today?\n")


def enable(monkeypatch) -> None:
    """The library needs ffmpeg on PATH; tests pretend it is there (the tools themselves are fakes)."""
    monkeypatch.setattr(config_module, "media_tools_present", lambda: True)


def library_settings(tmp_path, **extra) -> dict:
    return {"library_enabled": True, "data_dir": str(tmp_path / "data"), **extra}


def fake_media(duration_ms: int = 6000, video: bool = True, audio: bool = True) -> bytes:
    return b"FAKE:" + json.dumps({"duration_ms": duration_ms, "video": video, "audio": audio}).encode() + b"\n"


class FakeTools:
    def __init__(self, silences: list[Silence] | None = None, fail: dict[str, str] | None = None):
        self.silences = silences or []
        self.fail = fail or {}  # step -> LibraryError kind
        self.calls: list[str] = []

    def _check(self, step: str) -> None:
        self.calls.append(step)
        if step in self.fail:
            raise LibraryError(self.fail[step])

    async def probe(self, src: Path, *, home: Path) -> ProbeInfo:
        self._check("probe")
        raw = src.read_bytes()
        if not raw.startswith(b"FAKE:"):
            raise LibraryError("corrupt")
        meta = json.loads(raw[5:].split(b"\n", 1)[0])
        return ProbeInfo(meta["duration_ms"], meta["audio"], meta["video"], "h264" if meta["video"] else None,
                         "aac" if meta["audio"] else None, "mov,mp4,m4a,3gp,3g2,mj2", 720 if meta["video"] else None)

    async def normalize(self, src, info, out_dir, *, max_height, home, progress=None):
        self._check("normalize")
        if progress is not None:
            await progress(0.5)
            await progress(1.0)
        out = out_dir / ("media.mp4" if info.has_video else "media.m4a")
        out.write_bytes(src.read_bytes())
        return Normalized(out, "video/mp4" if info.has_video else "audio/mp4", "video" if info.has_video else "audio")

    async def audio_only(self, src, out_dir, *, duration_ms, home):
        self._check("audio_only")
        out = out_dir / "media.m4a"
        out.write_bytes(src.read_bytes())
        return Normalized(out, "audio/mp4", "audio")

    async def poster(self, media, dst, duration_ms, *, home) -> bool:
        self._check("poster")
        dst.write_bytes(b"\xff\xd8\xff\xe0fake-jpeg")
        return True

    async def speech_wav(self, src, dst, duration_ms, *, home) -> list[Silence]:
        self._check("speech_wav")
        with wave.open(str(dst), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(16000)
            w.writeframes(b"\x00\x00" * (16 * duration_ms))
        return list(self.silences)


class FakeAsr:
    """transcriber(user_id) -> async (wav) -> text; `texts` are returned in order, an Exception instance is raised."""

    def __init__(self, texts: list):
        self.texts = list(texts)
        self.calls: list[int] = []

    def __call__(self, user_id: int):
        async def transcribe(wav: bytes) -> str:
            with wave.open(io.BytesIO(wav)) as w:
                self.calls.append(w.getnframes() * 1000 // 16000)
            item = self.texts.pop(0) if self.texts else ""
            if isinstance(item, Exception):
                raise item
            return item
        return transcribe


class FakeTimedAsr:
    """timed transcriber(user_id) -> async (wav) -> TimedText. `results` are returned in order: a `TimedText`, a plain str
    (a recognizer that gives no times) or an Exception instance (raised)."""

    def __init__(self, results: list):
        self.results = list(results)
        self.calls: list[int] = []

    def __call__(self, user_id: int):
        async def transcribe(wav: bytes) -> TimedText:
            with wave.open(io.BytesIO(wav)) as w:
                self.calls.append(w.getnframes() * 1000 // 16000)
            item = self.results.pop(0) if self.results else ""
            if isinstance(item, Exception):
                raise item
            return item if isinstance(item, TimedText) else TimedText(item)
        return transcribe


def use_fakes(app, tools: FakeTools | None = None, asr: FakeAsr | None = None,
              timed_asr: FakeTimedAsr | None = None) -> FakeTools:
    """`asr=` (text only) turns the timed transcriber off so the fake is what runs; `timed_asr=` turns it on."""
    tools = tools or FakeTools()
    app.state.library.deps.tools = tools
    if asr is not None:
        app.state.library.deps.transcriber = asr
        app.state.library.deps.timed_transcriber = None
    if timed_asr is not None:
        app.state.library.deps.timed_transcriber = timed_asr
    return tools


async def upload(client, headers, data: bytes, *, filename: str = "My_clip.mp4", title: str | None = None,
                 subs: bytes | None = None, complete: bool = True) -> str:
    body = {"filename": filename, "size": len(data)}
    if title is not None:
        body["title"] = title
    r = await client.post("/api/library/uploads", headers=headers, json=body)
    assert r.status_code == 200, r.text
    item_id, size = r.json()["item_id"], r.json()["chunk_bytes"]
    for n in range(0, max(1, (len(data) + size - 1) // size)):
        part = data[n * size:(n + 1) * size]
        r = await client.put(f"/api/library/uploads/{item_id}/chunks/{n}", headers=headers,
                             files={"chunk": ("blob", part, "application/octet-stream")})
        assert r.status_code == 200, r.text
    if subs is not None:
        r = await client.put(f"/api/library/uploads/{item_id}/subtitles", headers=headers,
                             files={"file": ("subs.srt", subs, "application/x-subrip")})
        assert r.status_code == 200, r.text
    if complete:
        r = await client.post(f"/api/library/uploads/{item_id}/complete", headers=headers)
        assert r.status_code == 200, r.text
    return item_id


async def process(app) -> int:
    """One worker round, then wait for its jobs."""
    claimed = await app.state.library.run_once()
    await drain_background(app)
    return claimed
