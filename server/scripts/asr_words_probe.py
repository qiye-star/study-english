"""Task 0 of plan 2026-10-14-library-alignment-v2: are the recognizer's WORD times good enough to cut sentences on?

Run BY HAND inside the running server container, one clip of about a minute per run (two runs: one clip that starts with
background music, one fast-speech clip). Each run sends THREE recognition requests: the whole clip, then two halves
that overlap by 2 s around the middle (about 2 x the clip length of recognition in total, so ~4 minutes for two 60 s
clips). It refuses to start without --yes.

It prints only field NAMES, counts and numbers (ms): never the key, the URL, a transcript or any text from a response.
`--append-to` appends the same Markdown block to the results document.

    docker compose cp server/scripts/asr_timing_probe.py server:/tmp/asr_timing_probe.py
    docker compose cp server/scripts/asr_words_probe.py server:/tmp/asr_words_probe.py
    docker compose cp ./clip-a.mp3 server:/tmp/clip-a.mp3
    docker compose exec -e PYTHONPATH=/app server python /tmp/asr_words_probe.py --clip /tmp/clip-a.mp3 --label A-music --yes
    docker compose exec -u root server rm -f /tmp/asr_timing_probe.py /tmp/asr_words_probe.py /tmp/clip-a.mp3
"""
import argparse
import asyncio
import math
import sys
from difflib import SequenceMatcher
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # the sibling asr_timing_probe.py (container: /tmp)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # the server package when run from the repo

import asr_timing_probe as base  # noqa: E402

OVERLAP_MS = 2_000
SEAM_WINDOW_MS = 600  # words whose middle is this close to the split point are compared between the runs
EDGE_MS = 50


# ---- pure helpers (unit-tested; they return numbers and field names only) ----

def norm(text: str) -> str:
    return "".join(c for c in text.lower() if c.isalnum())


def utterances_of(result: object) -> list[dict]:
    """[{text, tokens, chars, start, end, definite, words: [(normalized text, start, end, has punctuation)], fields,
    word_fields, addition_fields}]. `text` / `tokens` stay in memory for matching and for v1's splitter; nothing that
    holds text is ever printed (`render` takes numbers and field names only)."""
    raw = result.get("utterances") if isinstance(result, dict) else None
    out = []
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        text, start, end = item.get("text"), base.number(item.get("start_time")), base.number(item.get("end_time"))
        words = []
        for w in item.get("words") if isinstance(item.get("words"), list) else []:
            if not isinstance(w, dict):
                continue
            ws, we = base.number(w.get("start_time")), base.number(w.get("end_time"))
            wt = w.get("text")
            if ws is None or we is None or ws < 0 or we < 0 or not isinstance(wt, str):
                continue  # the recognizer interleaves 1-char placeholders timed -1/-1: never a real word
            words.append((norm(wt), ws, we, any(not c.isalnum() and not c.isspace() for c in wt)))
        additions = item.get("additions")
        out.append({
            "text": " ".join(text.split()) if isinstance(text, str) else "",
            "chars": len(text) if isinstance(text, str) else 0,
            "tokens": [norm(t) for t in text.split()] if isinstance(text, str) else [],
            "start": start, "end": end, "definite": item.get("definite"), "words": words,
            "fields": base.field_names(item),
            "word_fields": base.field_names(item["words"][0]) if isinstance(item.get("words"), list) and item["words"]
            and isinstance(item["words"][0], dict) else [],
            "addition_fields": base.field_names(additions),
        })
    return out


def pct(values: list[float], p: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, max(0, math.ceil(p / 100 * len(ordered)) - 1))]


def time_grid(values: list[float]) -> int:
    """The greatest common divisor of all times in ms (10 = times come in 10 ms steps); 0 for none."""
    g = 0
    for v in values:
        g = math.gcd(g, int(round(v)))
    return g


def word_stats(utts: list[dict]) -> dict:
    words = [w for u in utts for w in u["words"]]
    durations = [e - s for _t, s, e, _p in words]
    gaps, inner_max = [], []
    for u in utts:
        ws = u["words"]
        g = [max(0.0, b[1] - a[2]) for a, b in zip(ws, ws[1:])]
        gaps += g
        inner_max.append(max(g, default=0.0))
    inside = sum(1 for u in utts for _t, s, e, _p in u["words"]
                 if u["start"] is not None and u["end"] is not None and u["start"] - 300 <= s and e <= u["end"] + 300)
    starts = [s for _t, s, _e, _p in words]
    matched = total = 0
    for u in utts:
        sm = SequenceMatcher(None, u["tokens"], [t for t, *_ in u["words"]], autojunk=False)
        matched += sum(size for _a, _b, size in sm.get_matching_blocks())
        total += len(u["tokens"])
    return {
        "utterances": len(utts), "words": len(words),
        "utterances_with_words": sum(1 for u in utts if u["words"]),
        "words_inside_their_utterance": inside,
        "words_monotonic": all(a <= b for a, b in zip(starts, starts[1:])),
        "time_grid_ms": time_grid([x for _t, s, e, _p in words for x in (s, e)]),
        "dur_p5": pct(durations, 5), "dur_p50": pct(durations, 50), "dur_p95": pct(durations, 95),
        "dur_zero": sum(1 for d in durations if d <= 0), "dur_under_30": sum(1 for d in durations if 0 < d < 30),
        "dur_over_1500": sum(1 for d in durations if d > 1500),
        "gap_p50": pct(gaps, 50), "gap_p90": pct(gaps, 90), "gap_p99": pct(gaps, 99),
        "gaps_over_1000": sum(1 for g in gaps if g > 1000), "gaps_over_2000": sum(1 for g in gaps if g > 2000),
        "inner_max_gap_p50": pct(inner_max, 50), "inner_max_gap_max": max(inner_max, default=None),
        "word_punct": sum(1 for *_x, p in words if p),
        "token_word_match": round(matched / total, 3) if total else None,
        "definite_false": sum(1 for u in utts if u["definite"] is False),
    }


def v1_offsets(utts: list[dict]) -> dict:
    """How far v1's sentences (utterance spans split by characters, `app.library.segment.build`) sit from the words they
    contain: lead = first word start - sentence start, tail = sentence end - last word end (ms; > 0 = silence or music
    inside the sentence). Sentences that contain no word count as `empty`."""
    from app.library.segment import Fragment, build

    frags = [Fragment(round(u["start"]), round(u["end"]), u["text"]) for u in utts
             if u["start"] is not None and u["end"] is not None and u["text"]]
    sentences = build(frags)
    words = [(s, e) for u in utts for _t, s, e, _p in u["words"]]
    leads, tails, empty, gapped = [], [], 0, 0
    for s in sentences:
        inside = [(a, b) for a, b in words if s.start_ms <= (a + b) / 2 <= s.end_ms]
        if not inside:
            empty += 1
            continue
        leads.append(inside[0][0] - s.start_ms)
        tails.append(s.end_ms - inside[-1][1])
        if any(b2[0] - a2[1] > 1500 for a2, b2 in zip(inside, inside[1:])):
            gapped += 1
    absolute = [abs(x) for x in leads + tails]
    return {"v1_sentences": len(sentences), "v1_empty": empty, "v1_with_gap_over_1500": gapped,
            "v1_edge_p50": pct(absolute, 50), "v1_edge_p95": pct(absolute, 95), "v1_edge_max": max(absolute, default=None),
            "v1_edges_over_300": sum(1 for x in absolute if x > 300)}


def seam_stats(whole: list[dict], left: list[dict], right: list[dict], split_ms: int) -> dict:
    """Words near `split_ms` as heard by the whole-clip run and by the two halves (right-half times already shifted to
    the clip's time base). Matched by text in order; |delta| in ms between runs is the cross-run jitter."""
    def near(utts):
        return [(t, s, e) for u in utts for t, s, e, _p in u["words"] if abs((s + e) / 2 - split_ms) <= SEAM_WINDOW_MS]

    def deltas(a, b):
        sm = SequenceMatcher(None, [t for t, *_ in a], [t for t, *_ in b], autojunk=False)
        out = []
        for i, j, size in sm.get_matching_blocks():
            for k in range(size):
                out += [abs(a[i + k][1] - b[j + k][1]), abs(a[i + k][2] - b[j + k][2])]
        return out, sum(size for *_x, size in sm.get_matching_blocks())

    w, l, r = near(whole), near(left), near(right)
    d_left, m_left = deltas(w, l)
    d_right, m_right = deltas(w, r)
    jitter = d_left + d_right
    left_edge = split_ms + OVERLAP_MS // 2
    return {"seam_words_whole": len(w), "seam_matched_left": m_left, "seam_matched_right": m_right,
            "jitter_p50": pct(jitter, 50), "jitter_p95": pct(jitter, 95), "jitter_max": max(jitter, default=None),
            "left_edge_word_cut": any(e >= left_edge - EDGE_MS for u in left for _t, _s, e, _p in u["words"])}


def shift(utts: list[dict], offset_ms: int) -> list[dict]:
    return [{**u, "start": None if u["start"] is None else u["start"] + offset_ms,
             "end": None if u["end"] is None else u["end"] + offset_ms,
             "words": [(t, s + offset_ms, e + offset_ms, p) for t, s, e, p in u["words"]]} for u in utts]


def render(label: str, audio_ms: int, fields: dict, stats: dict, v1: dict, seam: dict | None) -> str:
    def row(d: dict) -> str:
        return ";".join(f"{k} {v}" for k, v in d.items())

    lines = [f"### 素材 {label}(音频 {audio_ms / 1000:.1f} s)", "",
             f"- 字段:utterance {', '.join(fields['fields']) or '(无)'};words {', '.join(fields['word_fields']) or '(无)'};"
             f"additions {', '.join(fields['addition_fields']) or '(无)'}",
             f"- 词:{row(stats)}", f"- v1 句边界离词的距离(ms):{row(v1)}"]
    lines.append(f"- 接缝(两半各多听 1 s):{row(seam)}" if seam else "- 接缝:未运行")
    return "\n".join(lines) + "\n"


# ---- the real run ----

async def recognize(settings, pcm: bytes) -> list[dict]:
    frames, _took = await base.collect_frames(settings, pcm)
    last = next((f for f in reversed(frames) if f.get("last")), None)
    payload = last.get("payload") if last else None
    return utterances_of(payload.get("result") if isinstance(payload, dict) else None)


async def run(args: argparse.Namespace) -> int:
    import tempfile

    from app.core.config import Settings

    settings = Settings()
    if not settings.asr_stream_key:
        print("the streaming recognition key is not configured", file=sys.stderr)
        return 1
    with tempfile.TemporaryDirectory() as tmp:
        try:
            wav = base.decode_clip(Path(args.clip), args.seconds, Path(tmp)).read_bytes()
        except Exception as e:  # noqa: BLE001 - class name only
            print(f"ffmpeg failed: {type(e).__name__}", file=sys.stderr)
            return 1
    pcm, audio_ms = base.read_pcm(wav)
    bytes_per_ms = 32  # 16 kHz, 16-bit mono
    try:
        whole = await recognize(settings, pcm)
        split = audio_ms // 2
        left_end, right_start = split + OVERLAP_MS // 2, split - OVERLAP_MS // 2
        left = await recognize(settings, pcm[:left_end * bytes_per_ms])
        right = shift(await recognize(settings, pcm[right_start * bytes_per_ms:]), right_start)
    except Exception as e:  # noqa: BLE001
        print(f"recognition failed: {type(e).__name__}", file=sys.stderr)
        return 1
    first = next((u for u in whole if u["words"]), whole[0] if whole else None)
    fields = {k: (first[k] if first else []) for k in ("fields", "word_fields", "addition_fields")}
    block = render(args.label, audio_ms, fields, word_stats(whole), v1_offsets(whole), seam_stats(whole, left, right, split))
    print(block)
    if args.append_to:
        with open(args.append_to, "a", encoding="utf-8", newline="\n") as fh:
            fh.write("\n" + block)
    return 0


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--clip", required=True, help="audio or video file readable by ffmpeg (inside the container)")
    p.add_argument("--label", default="clip", help="short name for the results block, e.g. A-music")
    p.add_argument("--seconds", type=int, default=base.DEFAULT_SECONDS, help=f"first N seconds only (20-{base.MAX_SECONDS})")
    p.add_argument("--yes", action="store_true", help="really spend recognition quota (about 2 x --seconds)")
    p.add_argument("--append-to", help="append the Markdown block to this file (the results document)")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if not args.yes:
        print("refusing to spend recognition quota without --yes", file=sys.stderr)
        return 2
    if not 20 <= args.seconds <= base.MAX_SECONDS:
        print(f"--seconds must be 20-{base.MAX_SECONDS}", file=sys.stderr)
        return 2
    if not Path(args.clip).is_file():
        print("clip not found", file=sys.stderr)
        return 2
    return asyncio.run(run(args))


if __name__ == "__main__":
    sys.exit(main())
