"""Spike:识别请求参数对延迟的影响与 `<none>` 指令(计划 Task 0.3,裁定 R4/R5)。

只读工具,不是产品代码。不打印任何密钥、URL 或响应正文;只打印"已配置/未配置"、状态码、
耗时、token 用量与测试样本的简短转写(样本是公开的 JFK 演讲 + 本机合成的一句话)。

真实上游运行方式(读取主工作区的 server/.env,执行本工作区的代码):
    cd E:/workspace/everyone-can-use-english/server
    PYTHONPATH=<worktree>/server uv run python <worktree>/server/scripts/spikes/stt_params_spike.py \
        --wav <worktree>/.superpowers/latency/s5.wav [--voice2 <16 kHz 单声道 wav>]

调用次数:4 个变体 × --rounds(默认 3)+ 静音 1 + 噪声 1 + (有 --voice2 时)双人 2。
"""
import argparse
import array
import base64
import io
import random
import statistics
import time
import wave
from pathlib import Path

import httpx

from app.core.config import Settings

# 与 Task 1.2 计划的提示词一致(R4 的 <none> + R10 的"只转写最近说话人")。
PROMPT = (
    "Transcribe the audio verbatim in its original language. "
    "Output only the transcript text, without any extra words, quotes or timestamps. "
    "Only transcribe the nearest, clearest speaker and ignore background voices. "
    "If there is no clear foreground speech, output exactly <none>."
)
RATE = 16000
VARIANTS = {
    "baseline": {},
    "max_tokens": {"max_tokens": 512},
    "no_thinking": {"thinking": {"type": "disabled"}},
    "both": {"max_tokens": 512, "thinking": {"type": "disabled"}},
}


def to_wav(samples: array.array) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(samples.tobytes())
    return buf.getvalue()


def read_pcm(path: Path) -> array.array:
    with wave.open(str(path)) as w:
        if (w.getnchannels(), w.getsampwidth(), w.getframerate()) != (1, 2, RATE):
            raise SystemExit(f"{path.name}: need 16 kHz mono 16-bit WAV")
        return array.array("h", w.readframes(w.getnframes()))


def silence_wav(seconds: float = 2.0) -> bytes:
    return to_wav(array.array("h", bytes(int(seconds * RATE) * 2)))


def noise_wav(seconds: float = 2.0, sigma: float = 300.0) -> bytes:
    rng = random.Random(7)
    clip = lambda v: max(-32768, min(32767, v))  # noqa: E731
    return to_wav(array.array("h", (clip(int(rng.gauss(0, sigma))) for _ in range(int(seconds * RATE)))))


def mix_wav(fg: array.array, bg: array.array, bg_db: float) -> bytes:
    """前景 fg 全长;背景 bg 按 bg_db 衰减后循环叠加。"""
    gain = 10 ** (bg_db / 20)
    out = array.array("h", fg)
    for i in range(len(out)):
        out[i] = max(-32768, min(32767, int(out[i] + bg[i % len(bg)] * gain)))
    return to_wav(out)


def call(http: httpx.Client, s: Settings, wav: bytes, extra: dict) -> tuple[int, float, str, str]:
    body = {
        "model": s.upstream_whisper_model,
        "temperature": 0,
        "messages": [{"role": "user", "content": [
            {"type": "input_audio", "input_audio": {"data": base64.b64encode(wav).decode(), "format": "wav"}},
            {"type": "text", "text": PROMPT}]}],
        **extra,
    }
    start = time.perf_counter()
    try:
        r = http.post(s.upstream_whisper_base_url.rstrip("/") + "/chat/completions", json=body,
                      headers={"Authorization": f"Bearer {s.upstream_whisper_key}"})
    except httpx.HTTPError as e:
        return 0, (time.perf_counter() - start) * 1000, "", type(e).__name__
    ms = (time.perf_counter() - start) * 1000
    text, usage = "", ""
    if r.status_code == 200:
        data = r.json()
        text = (data["choices"][0]["message"].get("content") or "").strip()
        u = data.get("usage") or {}
        reasoning = (u.get("completion_tokens_details") or {}).get("reasoning_tokens")
        usage = f"prompt={u.get('prompt_tokens')} completion={u.get('completion_tokens')} reasoning={reasoning}"
    else:
        # 只取错误码/类型字段,不打印原始响应体。
        try:
            err = r.json().get("error") or {}
            usage = f"error_code={err.get('code')} error_type={err.get('type')}"
        except ValueError:
            usage = "error_body=non-json"
    return r.status_code, ms, text, usage


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--wav", type=Path, required=True)
    p.add_argument("--voice2", type=Path, help="第二说话人(16 kHz 单声道 wav),用于双人样本")
    p.add_argument("--rounds", type=int, default=3)
    a = p.parse_args()
    s = Settings()
    print("whisper mode:", s.upstream_whisper_mode, "| model:", s.upstream_whisper_model or "<not configured>",
          "| base url configured:", bool(s.upstream_whisper_base_url),
          "| key configured:", bool(s.upstream_whisper_key))
    if not (s.upstream_whisper_base_url and s.upstream_whisper_model):
        raise SystemExit("whisper upstream not configured")
    wav = a.wav.read_bytes()
    results: dict[str, list] = {name: [] for name in VARIANTS}
    with httpx.Client(timeout=httpx.Timeout(120.0, connect=10.0)) as http:
        # 轮转执行,避免某个变体集中落在网络较慢的时段。
        for rnd in range(a.rounds):
            for name, extra in VARIANTS.items():
                code, ms, text, usage = call(http, s, wav, extra)
                results[name].append((code, ms, text, usage))
                print(f"  round {rnd + 1} {name}: status={code} ms={ms:.0f} {usage} text={text[:80]!r}")
        for name, runs in results.items():
            ok = [ms for c, ms, _, _ in runs if c == 200]
            med = f"{statistics.median(ok):.0f}" if ok else "n/a"
            print(f"{name}: status={[c for c, *_ in runs]} median_ms={med} all_ms={[round(r[1]) for r in runs]}")

        extra = VARIANTS["both"] if all(c == 200 for c, *_ in results["both"]) else VARIANTS["max_tokens"]
        print("special clips use:", extra)
        clips = {"silence-2s": silence_wav(), "noise-only-2s": noise_wav()}
        if a.voice2:
            fg, bg = read_pcm(a.wav), read_pcm(a.voice2)
            clips["two-speakers bg -12dB"] = mix_wav(fg, bg, -12.0)
            clips["two-speakers equal"] = mix_wav(fg, bg, 0.0)
        for label, clip in clips.items():
            code, ms, text, usage = call(http, s, clip, extra)
            print(f"{label}: status={code} ms={ms:.0f} {usage} text={text[:160]!r}")


if __name__ == "__main__":
    main()
