"""Spike:按实时节奏向火山大模型流式识别推流(计划 Task 0.4,按裁定 R21/R22 缩减)。

只读工具,不是产品代码。鉴权与帧协议已由 2026-10-07-volc-streaming-asr-spike.md 验证,
这里复用 app.asr_stream 的帧编解码,密钥只取 Settings().asr_stream_key(进程内)。
只打印"已配置/未配置"、状态码/错误码、耗时与测试样本(公开的 JFK 演讲片段)的简短转写;
不打印请求头、密钥、URL 查询串或 logid。

真实上游运行方式(读取主工作区的 server/.env,执行本工作区的代码):
    cd E:/workspace/everyone-can-use-english/server
    PYTHONPATH=<worktree>/server uv run python <worktree>/server/scripts/spikes/asr_realtime_spike.py \
        --wav <worktree>/.superpowers/latency/s5.wav --runs a_default,b_default

每个 run 是一个上游连接(concurrency 是两个)。音频按 100 ms(3200 字节)一块、按绝对时间表
推送(第 i 块在 t0 + i*0.1 s 发出,不累计漂移),语音后接静音,最后一块带"最后一包"标志。
时间一律相对 t0 = 第一块音频发出的时刻;"语音结束"用 20 ms 帧能量(> -38 dBFS 的最后一帧)估计。
"""
import argparse
import array
import asyncio
import json
import math
import time
import uuid
import wave
from pathlib import Path

import websockets
from websockets.asyncio.client import connect

from app.asr_stream import (
    MSG_ERROR,
    _ws_logger,
    decode_frame,
    encode_audio,
    encode_full_request,
)
from app.config import Settings

BASE = "wss://openspeech.bytedance.com/api/v3/sauc/"
RESOURCE = "volc.bigasr.sauc.duration"
RATE = 16000
CHUNK_MS = 100
CHUNK = RATE * 2 * CHUNK_MS // 1000
SPEECH_DBFS = -38.0


def silence(seconds: float) -> bytes:
    return bytes(int(seconds * RATE) * 2)


def speech_end_ms(pcm: bytes) -> int:
    """End of the last 20 ms frame above SPEECH_DBFS (audio time, ms)."""
    samples = array.array("h", pcm)
    n = RATE // 50
    end = 0
    for i in range(0, len(samples) - n + 1, n):
        frame = samples[i : i + n]
        rms = math.sqrt(sum(s * s for s in frame) / n) or 1e-9
        if 20 * math.log10(rms / 32768) > SPEECH_DBFS:
            end = (i + n) * 1000 // RATE
    return end


def request(extra: dict) -> dict:
    return {
        "user": {"uid": "spike"},
        "audio": {"format": "pcm", "codec": "raw", "rate": RATE, "bits": 16, "channel": 1},
        "request": {"model_name": "bigmodel", "enable_itn": True, "enable_punc": True, **extra},
    }


def runs(speech: bytes) -> dict:
    one = speech + silence(2.0)
    two = speech + silence(1.5) + speech + silence(2.0)
    return {
        # name: (endpoint, extra request params, audio)
        "a_default": ("bigmodel_async", {"show_utterances": True}, one),
        "a_ew800_single": ("bigmodel_async", {"show_utterances": True, "result_type": "single", "end_window_size": 800}, one),
        "a_ew800_two": ("bigmodel_async", {"show_utterances": True, "end_window_size": 800}, two),
        "a_nonstream": ("bigmodel_async", {"show_utterances": True, "end_window_size": 800, "enable_nonstream": True}, one),
        "b_default": ("bigmodel", {"show_utterances": True}, one),
        "a_silence": ("bigmodel_async", {"show_utterances": True, "end_window_size": 800}, silence(3.0)),
    }


def short(text: str, n: int = 80) -> str:
    return text if len(text) <= n else text[: n - 1] + "…"


async def attempt(name: str, key: str, endpoint: str, extra: dict, pcm: bytes, quiet: bool = False) -> dict:
    headers = {"X-Api-Key": key, "X-Api-Resource-Id": RESOURCE, "X-Api-Connect-Id": str(uuid.uuid4())}
    rep: dict = {"run": name, "endpoint": endpoint, "params": extra, "audio_ms": len(pcm) * 1000 // (RATE * 2)}
    rep["speech_end_ms"] = speech_end_ms(pcm)
    timeline: list[dict] = []
    c0 = time.perf_counter()
    try:
        async with connect(
            BASE + endpoint, additional_headers=headers, open_timeout=10, max_size=1024 * 1024,
            close_timeout=2, logger=_ws_logger,
        ) as ws:
            rep["connect_ms"] = round((time.perf_counter() - c0) * 1000)
            await ws.send(encode_full_request(request(extra)))
            t0 = time.perf_counter()
            chunks = [pcm[i : i + CHUNK] for i in range(0, len(pcm), CHUNK)]
            sent = {}

            async def sender():
                for i, c in enumerate(chunks):
                    delay = t0 + i * CHUNK_MS / 1000 - time.perf_counter()
                    if delay > 0:
                        await asyncio.sleep(delay)
                    try:
                        await ws.send(encode_audio(c, i == len(chunks) - 1))
                    except websockets.ConnectionClosed:
                        return
                sent["last_ms"] = round((time.perf_counter() - t0) * 1000)

            task = asyncio.create_task(sender())
            try:
                async with asyncio.timeout(len(pcm) / (RATE * 2) + 15):
                    async for raw in ws:
                        f = decode_frame(raw)
                        t = round((time.perf_counter() - t0) * 1000)
                        if f.msg_type == MSG_ERROR:
                            msg = str(f.payload.get("error") or f.payload.get("message") or "")[:120]
                            rep["error"] = {"code": f.code, "message": msg, "at_ms": t}
                            break
                        res = f.payload.get("result") or {}
                        if isinstance(res, list):  # result_type=single may return a list (unverified)
                            res = res[0] if res else {}
                        utts = res.get("utterances") or []
                        timeline.append({
                            "t": t, "seq": f.sequence, "last": f.last, "text": res.get("text") or "",
                            "utts": [(u.get("start_time"), u.get("end_time"), bool(u.get("definite")), u.get("text", ""))
                                     for u in utts],
                        })
                        if f.last:
                            break
            except TimeoutError:
                rep["failure"] = "timeout"
            except websockets.ConnectionClosed as e:
                rep["closed"] = f"{e.rcvd.code if e.rcvd else None}"
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            rep["last_packet_sent_ms"] = sent.get("last_ms")
    except websockets.InvalidStatus as e:
        rep["http_status"] = e.response.status_code
    except (OSError, websockets.WebSocketException, TimeoutError) as e:
        rep["failure"] = type(e).__name__
    summarize(rep, timeline, quiet)
    return rep


def summarize(rep: dict, timeline: list[dict], quiet: bool) -> None:
    texts = [e for e in timeline if e["text"]]
    rep["responses"] = len(timeline)
    rep["text_responses"] = len(texts)
    rep["first_partial_ms"] = texts[0]["t"] if texts else None
    distinct = []
    for e in texts:
        if not distinct or distinct[-1]["text"] != e["text"]:
            distinct.append(e)
    rep["distinct_text_updates"] = len(distinct)
    if len(distinct) > 1:
        gaps = [b["t"] - a["t"] for a, b in zip(distinct, distinct[1:])]
        rep["update_gap_ms_median"] = sorted(gaps)[len(gaps) // 2]
    # first time each utterance (by start_time) is seen with definite=true
    definite: dict = {}
    for e in timeline:
        for st, en, d, tx in e["utts"]:
            if d and st not in definite:
                definite[st] = {"start": st, "end": en, "seen_ms": e["t"], "text": short(tx, 60)}
    rep["definite_utterances"] = list(definite.values())
    if timeline:
        rep["final_ms"] = timeline[-1]["t"]
        rep["final_is_last_flag"] = timeline[-1]["last"]
        rep["final_text"] = short(timeline[-1]["text"])
    if not quiet:
        print(f"--- timeline {rep['run']} (t ms from first audio packet; speech ends ~{rep['speech_end_ms']} ms) ---")
        prev = None
        for e in timeline:
            key = (e["text"], tuple(u[2] for u in e["utts"]), e["last"])
            if key == prev:
                continue
            prev = key
            flags = "".join("D" if u[2] else "p" for u in e["utts"])
            print(f"  t={e['t']:>5} seq={e['seq']} last={int(e['last'])} utts=[{flags}] {short(e['text'])!r}")
    print(json.dumps(rep, ensure_ascii=False))


async def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--wav", type=Path, required=True)
    p.add_argument("--runs", required=True, help="comma-separated run names, or 'concurrency'")
    a = p.parse_args()
    key = Settings().asr_stream_key
    print("asr stream key:", "configured" if key else "not configured")
    if not key:
        return
    with wave.open(str(a.wav)) as w:
        assert (w.getframerate(), w.getnchannels(), w.getsampwidth()) == (RATE, 1, 2)
        speech = w.readframes(w.getnframes())
    table = runs(speech)
    for name in a.runs.split(","):
        if name == "concurrency":
            # two simultaneous connections on the duration resource: does the 2nd get 45000292?
            pcm = speech[: RATE * 2 * 2] + silence(1.0)
            extra = {"show_utterances": True, "end_window_size": 800}
            await asyncio.gather(
                attempt("conc_1", key, "bigmodel_async", extra, pcm, quiet=True),
                attempt("conc_2", key, "bigmodel_async", extra, pcm, quiet=True),
            )
            continue
        endpoint, extra, pcm = table[name]
        await attempt(name, key, endpoint, extra, pcm)


if __name__ == "__main__":
    asyncio.run(main())
