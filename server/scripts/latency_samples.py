"""生成延迟测量样本(计划「延迟测量方法」):s5.wav、s15.wav,16 kHz 单声道 16 位。

用法:cd server && uv run python scripts/latency_samples.py --out ../.superpowers/latency
"""
import argparse
import io
import wave
from pathlib import Path

RATE = 16000
SOURCE = Path(__file__).resolve().parents[2] / "enjoy" / "samples" / "jfk.wav"


def make_sample(src: bytes, seconds: float) -> bytes:
    with wave.open(io.BytesIO(src)) as w:
        if (w.getnchannels(), w.getsampwidth(), w.getframerate()) != (1, 2, RATE):
            raise ValueError("source must be 16 kHz mono 16-bit WAV")
        pcm = w.readframes(w.getnframes())
    need = int(seconds * RATE) * 2
    out = bytearray()
    while len(out) < need:
        out += pcm[: need - len(out)]
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(bytes(out))
    return buf.getvalue()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    src = SOURCE.read_bytes()
    for name, seconds in (("s5.wav", 5.0), ("s15.wav", 15.0)):
        (args.out / name).write_bytes(make_sample(src, seconds))
        print(f"wrote {args.out / name} ({seconds:.0f} s)")


if __name__ == "__main__":
    main()
