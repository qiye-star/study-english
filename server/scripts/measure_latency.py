"""服务端层延迟测量(计划「延迟测量方法」)。只打印数字与状态码,不打印密钥。

基线口径(R23):被测 uvicorn 进程须带环境变量 UPSTREAM_ASR_MODE=chat(用户 .env 已开 volc_stream)。
用法(先按 server/README.md 起本机 uvicorn,开放注册的临时库):
  uv run python scripts/measure_latency.py --base-url http://127.0.0.1:8765 --label baseline \
      --samples ../.superpowers/latency --runs 7 --out ../.superpowers/latency/baseline.json
"""
import argparse
import json
import statistics
import time
import uuid
from pathlib import Path

import httpx

REPLY_TEXT = "That sounds like a great plan. What time would you like to meet tomorrow?"
FIRST_SENTENCE = "That sounds like a great plan."


def summarize(values: list[float]) -> dict:
    if not values:
        raise ValueError("no values")
    return {"n": len(values), "median": statistics.median(values), "min": min(values), "max": max(values)}


def ratio(base: float, after: float) -> float:
    return round(after / base, 2)


def markdown_row(metric: str, sample: str, base: float | None, after: float | None, target: str) -> str:
    if base is None or after is None:
        b = "未测" if base is None else f"{base:.0f}"
        a = "未测" if after is None else f"{after:.0f}"
        return f"| {metric} | {sample} | {b} | {a} | — | {target} | — |"
    r = ratio(base, after)
    verdict = "—"
    if target.startswith("≤ ") and target.endswith("%"):
        verdict = "达标" if r * 100 <= float(target[2:-1]) else "未达标"
    return f"| {metric} | {sample} | {base:.0f} | {after:.0f} | {r * 100:.0f}% | {target} | {verdict} |"


def _timed(fn) -> tuple[float, httpx.Response]:
    start = time.perf_counter()
    response = fn()
    return (time.perf_counter() - start) * 1000, response


def run(base_url: str, samples: Path, runs: int, voice: str, tts_model: str) -> dict:
    with httpx.Client(base_url=base_url, timeout=300) as http:
        creds = {"username": f"lat_{uuid.uuid4().hex[:10]}", "password": "latency-password-123"}
        token = http.post("/api/users", json=creds).raise_for_status().json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        out: dict[str, dict] = {}
        for name in ("s5", "s15"):
            wav = (samples / f"{name}.wav").read_bytes()
            values = []
            for i in range(runs + 1):
                ms, r = _timed(lambda: http.post(
                    "/api/ai/audio/transcriptions", headers=headers,
                    files={"file": ("a.wav", wav, "audio/wav")}, data={"model": "whisper-1"}))
                print(f"stt {name} run={i} status={r.status_code} ms={ms:.0f}")
                if r.status_code != 200:
                    raise SystemExit(f"transcription failed with HTTP {r.status_code}")
                if i > 0:  # 第 0 次是热身
                    values.append(ms)
            out[f"stt_ms_{name}"] = summarize(values)
        for metric, text, stream in (("tts_full_ms", REPLY_TEXT, False), ("tts_first_sentence_ms", FIRST_SENTENCE, False),
                                     ("tts_first_chunk_ms", REPLY_TEXT, True)):
            values = []
            for i in range(runs + 1):
                body = {"input": f"{text} ({i})", "model": tts_model, "voice": voice}  # 后缀避免任何缓存
                if stream:
                    body["stream"] = True
                start = time.perf_counter()
                with http.stream("POST", "/api/ai/audio/speech", headers=headers, json=body) as r:
                    first = None
                    for chunk in r.iter_bytes():
                        if chunk and first is None:
                            first = (time.perf_counter() - start) * 1000
                    total = (time.perf_counter() - start) * 1000
                print(f"{metric} run={i} status={r.status_code} first={first or 0:.0f} total={total:.0f}")
                if r.status_code != 200:
                    raise SystemExit(f"speech failed with HTTP {r.status_code}")
                if i > 0:
                    values.append(first if stream else total)
            out[metric] = summarize(values)
        return out


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--base-url", required=True)
    p.add_argument("--label", choices=["baseline", "after"], required=True)
    p.add_argument("--samples", type=Path, required=True)
    p.add_argument("--runs", type=int, default=7)
    p.add_argument("--voice", default="en_female_dacey_uranus_bigtts")
    p.add_argument("--tts-model", default="volcengine/seed-tts-2.0")
    p.add_argument("--out", type=Path, required=True)
    a = p.parse_args()
    result = {"label": a.label, "at": time.strftime("%Y-%m-%d %H:%M:%S"), **run(a.base_url, a.samples, a.runs, a.voice, a.tts_model)}
    a.out.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
