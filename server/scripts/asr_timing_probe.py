"""Task 0 of plan 2026-10-13-library-alignment: does the configured recognition service return per-sentence times?

Run BY HAND inside the running server container against ONE clip of about a minute per run (do two runs: one clip
with continuous background music, one without). It spends a small amount of the recognition quota (the clip is cut to
--seconds, default 60, at most 90) and refuses to start without --yes.

It prints only field NAMES, counts and timing numbers (milliseconds, or seconds for Whisper): never the key, the URL,
a transcript, or any text from a response. Field names that are not plain identifiers are shown as `<other>`.
`--append-to` appends the same Markdown block to the results document.

    docker compose cp server/scripts/asr_timing_probe.py server:/tmp/asr_timing_probe.py
    docker compose cp ./clip-a.mp3 server:/tmp/clip-a.mp3
    docker compose exec -e PYTHONPATH=/app server python /tmp/asr_timing_probe.py \
        --clip /tmp/clip-a.mp3 --label A-music --yes [--whisper] [--truth /tmp/truth-a.json]
    docker compose exec server rm -f /tmp/asr_timing_probe.py /tmp/clip-a.mp3 /tmp/truth-a.json

`--truth` is a JSON list `[[start_ms, end_ms], ...]` you wrote by listening to the first sentences (to about 100 ms);
the script then prints our minus yours for each. Without it the boundary error stays UNVERIFIED.
"""
import argparse
import asyncio
import io
import json
import re
import subprocess
import sys
import tempfile
import time
import uuid
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

DEFAULT_SECONDS = 60
MAX_SECONDS = 90
MAX_ROWS_PRINTED = 40
FIELD_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,31}$")


# ---- pure helpers (unit-tested; they never return text taken from a response) ----

def field_names(value: object) -> list[str]:
    """Sorted key names of a dict; anything that is not a plain identifier is shown as `<other>`. Never a value."""
    if not isinstance(value, dict):
        return []
    return sorted({k if isinstance(k, str) and FIELD_NAME.match(k) else "<other>" for k in value})


def number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def unit_guess(max_end: float | None, audio_ms: int) -> str:
    """`seconds?` when the largest end time fits the clip length in seconds (clips >= 20 s only), `ms` when it fits in
    milliseconds, else `out_of_range`."""
    if max_end is None:
        return "none"
    if audio_ms >= 20_000 and max_end <= audio_ms / 1000 + 2:
        return "seconds?"
    if max_end <= audio_ms + 2000:
        return "ms"
    return "out_of_range"


def _rows(raw: object, start_key: str, end_key: str) -> list[dict]:
    rows = []
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        text, words, definite = item.get("text"), item.get("words"), item.get("definite")
        rows.append({
            "fields": field_names(item),
            "start": number(item.get(start_key)),
            "end": number(item.get(end_key)),
            "chars": len(text) if isinstance(text, str) else None,
            "definite": definite if isinstance(definite, bool) else None,
            "words": len(words) if isinstance(words, list) else None,
            "word_fields": field_names(words[0]) if isinstance(words, list) and words else [],
        })
    return rows


def summarize_rows(rows: list[dict], audio_ms: int) -> dict:
    pairs = [(r["start"], r["end"]) for r in rows if r["start"] is not None and r["end"] is not None]
    starts, ends = [s for s, _ in pairs], [e for _, e in pairs]
    return {
        "count": len(rows), "rows": rows, "unit_guess": unit_guess(max(ends) if ends else None, audio_ms),
        "monotonic": all(a <= b for a, b in zip(starts, starts[1:])),
        "overlaps": sum(1 for (_s1, e1), (s2, _e2) in zip(pairs, pairs[1:]) if s2 < e1),
        "negative_or_inverted": sum(1 for s, e in pairs if s < 0 or e <= s),
        "first_start": starts[0] if starts else None, "last_end": ends[-1] if ends else None,
    }


def summarize_utterances(raw: object, audio_ms: int) -> dict:
    return summarize_rows(_rows(raw, "start_time", "end_time"), audio_ms)


def summarize_whisper(status: int | None, payload: object, audio_ms: int) -> dict:
    segments = payload.get("segments") if isinstance(payload, dict) else None
    return {"status": status, "payload_fields": field_names(payload),
            "has_segments": isinstance(segments, list) and len(segments) > 0,
            "segments": summarize_rows(_rows(segments, "start", "end"), audio_ms)}


def summarize_frames(frames: list[dict], audio_ms: int) -> dict:
    """`frames`: {"last", "sequence", "payload"} per response frame, or {"error": True, "code"} for an error frame."""
    def result_of(frame: dict) -> object:
        payload = frame.get("payload")
        return payload.get("result") if isinstance(payload, dict) else None

    last = next((f for f in reversed(frames) if f.get("last")), None)
    out: dict = {"frames": len(frames), "final": None,
                 "error_code": next((f.get("code") for f in frames if f.get("error")), None),
                 "partial_frames_with_utterances": sum(
                     1 for f in frames if not f.get("last") and isinstance(result_of(f), dict) and result_of(f).get("utterances"))}
    if last is not None:
        result = result_of(last)
        raw = result.get("utterances") if isinstance(result, dict) else None
        text = result.get("text") if isinstance(result, dict) else None
        out["final"] = {
            "payload_fields": field_names(last.get("payload")), "result_fields": field_names(result),
            "text_chars": len(text) if isinstance(text, str) else None,
            "has_utterances": isinstance(raw, list) and len(raw) > 0,
            "utterances": summarize_utterances(raw, audio_ms),
        }
    return out


def compare_truth(rows: list[dict], truth: object, scale: float = 1.0) -> list[dict]:
    """Ours minus yours per listened-to sentence, in ms. `scale` converts the recognizer's unit to ms (1000 = seconds)."""
    out: list[dict] = []
    if not isinstance(truth, list):
        return out
    for index, (row, want) in enumerate(zip(rows, truth)):
        if row["start"] is None or row["end"] is None or not (isinstance(want, list) and len(want) == 2):
            continue
        out.append({"index": index, "start_error_ms": round(row["start"] * scale - want[0]),
                    "end_error_ms": round(row["end"] * scale - want[1])})
    return out


def _rows_markdown(summary: dict) -> list[str]:
    lines = [f"- 条数 {summary['count']};单位猜测 `{summary['unit_guess']}`;起点单调 {summary['monotonic']};"
             f"重叠 {summary['overlaps']};倒置或负值 {summary['negative_or_inverted']};"
             f"首条起点 {summary['first_start']},末条终点 {summary['last_end']}"]
    if summary["rows"]:
        first = summary["rows"][0]
        lines.append(f"- 每条的字段:{', '.join(first['fields']) or '(无)'};words 字段:{', '.join(first['word_fields']) or '(无)'}")
    shown = summary["rows"][:MAX_ROWS_PRINTED]
    lines.append("- 逐条(序号:起点 – 终点 / 字符数 / definite):" + ";".join(
        f"{i}:{r['start']} – {r['end']} / {r['chars']} / {r['definite']}" for i, r in enumerate(shown)))
    return lines


def render_markdown(label: str, audio_ms: int, stream: dict | None, whisper: dict | None, truth_errors: list[dict]) -> str:
    lines = [f"### 素材 {label}(音频 {audio_ms / 1000:.1f} s)", ""]
    if stream is None:
        lines.append("- 火山流式:未运行(没有配置密钥,或请求失败)")
    else:
        lines.append(f"- 火山流式:响应帧 {stream['frames']},错误码 {stream['error_code']},耗时 {stream.get('seconds', 0):.1f} s;"
                     f"中间帧带 utterances 的 {stream['partial_frames_with_utterances']} 帧")
        final = stream["final"]
        if final is None:
            lines.append("- 没有最终帧")
        else:
            lines += [f"- 最终帧顶层字段:{', '.join(final['payload_fields']) or '(无)'}",
                      f"- result 字段:{', '.join(final['result_fields']) or '(无)'};result.text 字符数 {final['text_chars']}",
                      f"- `utterances`:{'有' if final['has_utterances'] else '没有'}"]
            if final["has_utterances"]:
                lines += _rows_markdown(final["utterances"])
    if whisper is not None:
        lines.append(f"- Whisper verbose_json:HTTP {whisper['status']};顶层字段 {', '.join(whisper['payload_fields']) or '(无)'};"
                     f"`segments`:{'有' if whisper['has_segments'] else '没有'}")
        if whisper["has_segments"]:
            lines += _rows_markdown(whisper["segments"])
    if truth_errors:
        worst = max(max(abs(e["start_error_ms"]), abs(e["end_error_ms"])) for e in truth_errors)
        lines.append(f"- 与你听出来的边界相比(我方减你方,ms):最大绝对误差 {worst};"
                     + ";".join(f"{e['index']}:{e['start_error_ms']:+d} / {e['end_error_ms']:+d}" for e in truth_errors))
    else:
        lines.append("- 边界误差:**未验证**(没有提供 --truth)")
    return "\n".join(lines) + "\n"


# ---- the real run ----

def decode_clip(clip: Path, seconds: int, workdir: Path) -> Path:
    out = workdir / "probe.wav"
    subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-t", str(seconds), "-i", str(clip),
                    "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "wav", str(out)],
                   check=True, timeout=180, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return out


def read_pcm(wav: bytes) -> tuple[bytes, int]:
    with wave.open(io.BytesIO(wav), "rb") as w:
        frames = w.getnframes()
        return w.readframes(frames), round(frames * 1000 / w.getframerate())


async def collect_frames(settings, pcm: bytes) -> tuple[list[dict], float]:
    """The same wire protocol as `app.speech.asr_stream`, with `show_utterances` added; keeps every response frame."""
    from websockets.asyncio.client import connect

    from app.speech import asr_stream as a

    payload = a._request_payload("timing-probe")
    payload["request"]["show_utterances"] = True
    headers = {"X-Api-Key": settings.asr_stream_key, "X-Api-Resource-Id": settings.asr_stream_resource_id,
               "X-Api-Connect-Id": str(uuid.uuid4())}
    frames: list[dict] = []
    started = time.perf_counter()
    async with asyncio.timeout(a.stream_budget(settings, len(pcm))):
        async with connect(settings.asr_stream_url, additional_headers=headers, open_timeout=a.OPEN_TIMEOUT,
                           max_size=a.MAX_MESSAGE_BYTES, close_timeout=a.CLOSE_TIMEOUT, logger=a._ws_logger) as ws:
            await ws.send(a.encode_full_request(payload))
            sender = asyncio.create_task(a._send_audio(ws, pcm))
            try:
                async for raw in ws:
                    frame = a.decode_frame(raw)
                    if frame.msg_type == a.MSG_ERROR:
                        frames.append({"error": True, "code": frame.code})
                        break
                    frames.append({"last": frame.last, "sequence": frame.sequence, "payload": frame.payload})
                    if frame.last:
                        break
            finally:
                sender.cancel()
                await asyncio.gather(sender, return_exceptions=True)
    return frames, time.perf_counter() - started


async def whisper_probe(settings, wav: bytes) -> tuple[int | None, object]:
    import httpx

    url = settings.upstream_whisper_base_url.rstrip("/") + "/audio/transcriptions"
    async with httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=10.0)) as http:
        reply = await http.post(url, files={"file": ("audio.wav", wav, "audio/wav")},
                                data={"model": "whisper-1", "response_format": "verbose_json", "language": "en"},
                                headers={"Authorization": f"Bearer {settings.upstream_whisper_key}"})
    try:
        return reply.status_code, reply.json() if reply.is_success else None
    except ValueError:
        return reply.status_code, None


async def run(args: argparse.Namespace) -> int:
    from app.core.config import Settings

    settings = Settings()
    with tempfile.TemporaryDirectory() as tmp:
        try:
            wav = decode_clip(Path(args.clip), args.seconds, Path(tmp)).read_bytes()
        except (subprocess.SubprocessError, OSError) as e:
            print(f"ffmpeg failed: {type(e).__name__}", file=sys.stderr)
            return 1
    pcm, audio_ms = read_pcm(wav)
    print(f"audio_seconds={audio_ms / 1000:.1f} whisper={'yes' if args.whisper else 'no'}", file=sys.stderr)
    stream = None
    if settings.asr_stream_key:
        try:
            frames, took = await collect_frames(settings, pcm)
            stream = {**summarize_frames(frames, audio_ms), "seconds": took}
        except Exception as e:  # noqa: BLE001 - print the class name only
            print(f"stream request failed: {type(e).__name__}", file=sys.stderr)
    else:
        print("the streaming recognition key is not configured", file=sys.stderr)
    whisper = None
    if args.whisper:
        if settings.upstream_whisper_mode != "openai" or not settings.upstream_whisper_base_url:
            print("whisper: not applicable (needs UPSTREAM_WHISPER_MODE=openai and a base URL)", file=sys.stderr)
        else:
            try:
                status, payload = await whisper_probe(settings, wav)
                whisper = summarize_whisper(status, payload, audio_ms)
            except Exception as e:  # noqa: BLE001
                print(f"whisper request failed: {type(e).__name__}", file=sys.stderr)
    truth_errors: list[dict] = []
    if args.truth and stream and stream["final"] and stream["final"]["has_utterances"]:
        try:
            truth = json.loads(Path(args.truth).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            truth = None
        summary = stream["final"]["utterances"]
        truth_errors = compare_truth(summary["rows"], truth, 1000.0 if summary["unit_guess"] == "seconds?" else 1.0)
    block = render_markdown(args.label, audio_ms, stream, whisper, truth_errors)
    print(block)
    if args.append_to:
        with open(args.append_to, "a", encoding="utf-8", newline="\n") as fh:
            fh.write("\n" + block)
    return 0 if stream is not None else 1


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--clip", required=True, help="audio or video file readable by ffmpeg (inside the container)")
    p.add_argument("--label", default="clip", help="short name for the results block, e.g. A-music")
    p.add_argument("--seconds", type=int, default=DEFAULT_SECONDS, help=f"first N seconds only (1-{MAX_SECONDS})")
    p.add_argument("--yes", action="store_true", help="really spend recognition quota")
    p.add_argument("--whisper", action="store_true", help="also try Whisper verbose_json (a second paid request)")
    p.add_argument("--truth", help="JSON [[start_ms, end_ms], ...] measured by listening, first sentences")
    p.add_argument("--append-to", help="append the Markdown block to this file (the results document)")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if not args.yes:
        print("refusing to spend recognition quota without --yes", file=sys.stderr)
        return 2
    if not 1 <= args.seconds <= MAX_SECONDS:
        print(f"--seconds must be 1-{MAX_SECONDS}", file=sys.stderr)
        return 2
    if not Path(args.clip).is_file():
        print("clip not found", file=sys.stderr)
        return 2
    return asyncio.run(run(args))


if __name__ == "__main__":
    sys.exit(main())
