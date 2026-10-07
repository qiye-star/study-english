"""Spike:火山单向 TTS 的分块到达时间(计划 Task 0.5)。不打印密钥、地址或音频内容。

只读工具,不是产品代码。测量:首块时间 vs 整段时间、块数与块大小分布、块间隔(节奏),
`mp3` 与 `pcm`(请求 24000 Hz)两种格式;`pcm` 的实际采样率用"字节数 / 2 / 时长"核对,
时长取同一文本 `mp3` 的帧头解析结果(与 `pcm` 无关的独立参照),并可另发一次 16000 Hz 请求交叉验证。

真实上游运行方式(读取主工作区的 server/.env,执行本工作区的代码):
    cd E:/workspace/everyone-can-use-english/server
    PYTHONPATH=<worktree>/server uv run python <worktree>/server/scripts/spikes/tts_chunk_spike.py \
        [--rounds 3] [--long-rounds 2] [--check-16k] [--out <json>]

调用次数:2 格式 × (--rounds + --long-rounds) + (--check-16k 时)1。
"""
import argparse
import base64
import json
import statistics
import time
from pathlib import Path

import httpx

from app.config import Settings

REPLY_TEXT = "That sounds like a great plan. What time would you like to meet tomorrow?"
LONG_TEXT = (
    "That sounds like a great plan. What time would you like to meet tomorrow? "
    "I usually finish work around five, so anything after six would be perfect for me. "
    "If the weather is nice, we could walk along the river first and then find a quiet place for dinner. "
    "Let me know what you think, and feel free to suggest somewhere else if you have a favorite spot."
)
SPEAKER = "en_female_dacey_uranus_bigtts"
RESOURCE = "seed-tts-2.0"

# MPEG 音频帧头解析(只为算 mp3 时长,作为 pcm 采样率的独立参照)。
_BITRATES = {  # (version_is_mpeg1, layer3) -> kbps 表
    True: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
    False: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
}
_RATES = {3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000]}


def mp3_info(data: bytes) -> dict:
    """数 Layer III 帧,返回 {sample_rate, frames, seconds, kbps}。跳过 ID3 头。"""
    pos = 0
    if data[:3] == b"ID3" and len(data) >= 10:
        size = (data[6] << 21) | (data[7] << 14) | (data[8] << 7) | data[9]
        pos = 10 + size
    frames, rate, kbps, samples = 0, 0, 0, 0
    while pos + 4 <= len(data):
        b1, b2 = data[pos + 1], data[pos + 2]
        if data[pos] != 0xFF or (b1 & 0xE0) != 0xE0:
            pos += 1
            continue
        version = (b1 >> 3) & 0x03  # 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
        layer = (b1 >> 1) & 0x03  # 1 = Layer III
        br_idx, sr_idx, pad = (b2 >> 4) & 0x0F, (b2 >> 2) & 0x03, (b2 >> 1) & 0x01
        if version == 1 or layer != 1 or sr_idx == 3 or br_idx in (0, 15):
            pos += 1
            continue
        mpeg1 = version == 3
        rate = _RATES[version][sr_idx]
        kbps = _BITRATES[mpeg1][br_idx]
        per_frame = 1152 if mpeg1 else 576
        length = (144 if mpeg1 else 72) * kbps * 1000 // rate + pad
        frames += 1
        samples += per_frame
        pos += length
    return {"sample_rate": rate, "frames": frames, "seconds": round(samples / rate, 3) if rate else 0, "kbps": kbps}


def run(settings: Settings, http: httpx.Client, text: str, fmt: str, rate: int) -> dict:
    body = {"user": {"uid": "spike"}, "req_params": {"text": text, "speaker": SPEAKER,
                                                     "audio_params": {"format": fmt, "sample_rate": rate}}}
    headers = {"X-Api-Key": settings.volcengine_tts_key, "X-Api-Resource-Id": RESOURCE}
    decoder = json.JSONDecoder()
    t0 = time.perf_counter()
    headers_ms = None
    arrivals: list[float] = []  # 每个含音频的 JSON 帧被完整解析出来的时刻
    sizes: list[int] = []
    audio = bytearray()
    codes: list = []
    buf = ""
    with http.stream("POST", settings.volcengine_tts_url, json=body, headers=headers) as r:
        headers_ms = (time.perf_counter() - t0) * 1000
        status = r.status_code
        content_type = r.headers.get("content-type", "")
        for piece in r.iter_text():
            buf += piece
            while True:
                stripped = buf.lstrip()
                if not stripped:
                    buf = ""
                    break
                try:
                    item, end = decoder.raw_decode(stripped)
                except ValueError:
                    buf = stripped
                    break
                buf = stripped[end:]
                if not isinstance(item, dict):
                    continue
                if item.get("code") not in (None, 0):
                    codes.append(item.get("code"))
                data = item.get("data")
                if isinstance(data, str) and data:
                    raw = base64.b64decode(data)
                    arrivals.append((time.perf_counter() - t0) * 1000)
                    sizes.append(len(raw))
                    audio.extend(raw)
    total = (time.perf_counter() - t0) * 1000
    gaps = [b - a for a, b in zip(arrivals, arrivals[1:])]
    out = {
        "text": "long" if text == LONG_TEXT else "reply", "format": fmt, "rate_req": rate, "status": status,
        "content_type": content_type, "headers_ms": round(headers_ms), "first_ms": round(arrivals[0]) if arrivals else None,
        "last_chunk_ms": round(arrivals[-1]) if arrivals else None, "total_ms": round(total),
        "chunks": len(sizes), "bytes": len(audio),
        "chunk_bytes": {"median": statistics.median(sizes), "min": min(sizes), "max": max(sizes)} if sizes else None,
        "gap_ms": {"median": round(statistics.median(gaps)), "min": round(min(gaps)), "max": round(max(gaps))} if gaps else None,
        "arrivals_ms": [round(a) for a in arrivals], "sizes": sizes, "end_codes": codes,
        "riff_header": bytes(audio[:4]) == b"RIFF",
    }
    if fmt == "mp3" and audio:
        out["mp3"] = mp3_info(bytes(audio))
    return out


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--rounds", type=int, default=3, help="REPLY_TEXT 每种格式的次数")
    p.add_argument("--long-rounds", type=int, default=2, help="LONG_TEXT 每种格式的次数")
    p.add_argument("--check-16k", action="store_true", help="另发一次 pcm 16000 Hz(REPLY_TEXT)交叉验证采样率")
    p.add_argument("--out", type=Path)
    a = p.parse_args()
    settings = Settings()
    print("volcengine key configured:", bool(settings.volcengine_tts_key))
    results = []
    with httpx.Client(timeout=httpx.Timeout(120.0, connect=10.0)) as http:
        # 两种格式交替执行,避免某种格式集中落在慢时段。
        for text, rounds in ((REPLY_TEXT, a.rounds), (LONG_TEXT, a.long_rounds)):
            for i in range(rounds):
                for fmt in ("mp3", "pcm"):
                    res = run(settings, http, text, fmt, 24000)
                    res["round"] = i
                    results.append(res)
                    print(json.dumps({k: v for k, v in res.items() if k not in ("arrivals_ms", "sizes")}))
        if a.check_16k:
            res = run(settings, http, REPLY_TEXT, "pcm", 16000)
            results.append(res)
            print(json.dumps({k: v for k, v in res.items() if k not in ("arrivals_ms", "sizes")}))
    # pcm 采样率核对:同一文本 mp3 时长作参照,pcm 字节 / 2 / 时长 = 实测采样率。
    for label in ("reply", "long"):
        mp3s = [r["mp3"]["seconds"] for r in results if r["text"] == label and r["format"] == "mp3" and r.get("mp3")]
        if not mp3s:
            continue
        ref = statistics.median(mp3s)
        for r in results:
            if r["text"] == label and r["format"] == "pcm" and r["bytes"]:
                r["pcm_rate_est"] = round(r["bytes"] / 2 / ref)
                r["pcm_seconds_at_req_rate"] = round(r["bytes"] / 2 / r["rate_req"], 3)
        print(json.dumps({"text": label, "mp3_seconds_median": ref,
                          "pcm_rate_est": [r.get("pcm_rate_est") for r in results
                                           if r["text"] == label and r["format"] == "pcm"]}))
    if a.out:
        a.out.write_text(json.dumps(results, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
