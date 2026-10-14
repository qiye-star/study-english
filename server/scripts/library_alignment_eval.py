"""Sentence-boundary evaluation for one library item (plan 2026-10-14-library-alignment-v2 Task 9). No network, no cost.

It reads the item's kept recognizer output (`library/<uid>/<item>/transcript.json`), runs the CURRENT algorithm and v1 on
it, and prints numbers only (never sentence text):

    report  ground-truth-free consistency: monotonic / overlap violations, edges sitting off the words, boundaries cutting
            a word, pauses kept inside sentences, word-free stretches (possible missed speech), seams, flags, rates
    sample  pick N sentences spread over the item and write a gold template (times only) you fill in by listening
    score   compare the current algorithm (and v1) with your filled-in gold file: median / p95 boundary error, bias,
            clipping rate, and the plan's targets (UNVERIFIED until a real gold file exists)

Inside the container (the script is not in the image):

    docker compose cp server/scripts/library_alignment_eval.py server:/tmp/eval.py
    docker compose exec -e PYTHONPATH=/app server python /tmp/eval.py report --item-id <item-id>
    docker compose exec -e PYTHONPATH=/app server python /tmp/eval.py sample --item-id <item-id> --n 30 --out /tmp/gold.json
    docker compose cp server:/tmp/gold.json ./gold.json      # fill in true_start_ms / true_end_ms, then copy it back
    docker compose exec -e PYTHONPATH=/app server python /tmp/eval.py score --item-id <item-id> --gold /tmp/gold.json
    docker compose exec -u root server rm -f /tmp/eval.py /tmp/gold.json

Gold labels: open the item's own media (`library/<uid>/<item>/media.*`, same time base as the sentences; the original
file can be shifted by encoder padding) in an audio editor, and for each sampled sentence write where the first word
really starts and the last word really ends, in ms (about 10 ms precision).
"""
import argparse
import json
import math
import random
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

TARGETS = {"start_p50": 120, "start_p95": 400, "end_p50": 150, "end_p95": 500, "clip_rate": 0.05}
CLIP_START_MS = 50  # starting this much after the true start clips the first sound
CLIP_END_MS = 80  # ending this much before the true end clips the last sound
INSIDE_MARGIN_MS = 30
WORD_FREE_MS = 5_000


# ---- pure helpers (unit-tested; numbers only) ----

def pct(values, p):
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, max(0, math.ceil(p / 100 * len(ordered)) - 1))]


def summary(values) -> dict:
    return {"n": len(values), "p50": pct(values, 50), "p95": pct(values, 95), "max": max(values, default=None)}


def words_inside(sentence, tokens):
    return [t for t in tokens if t.kind == "word" and sentence.start_ms <= t.mid_ms <= sentence.end_ms]


def edge_offsets(sentences, tokens) -> tuple[list[int], list[int], int]:
    """(leads, tails, sentences without any word): lead = first word start - sentence start (> 0 = silence or music
    included at the front), tail = sentence end - last word end."""
    leads, tails, empty = [], [], 0
    for s in sentences:
        inside = words_inside(s, tokens)
        if not inside:
            empty += 1
            continue
        leads.append(inside[0].start_ms - s.start_ms)
        tails.append(s.end_ms - inside[-1].end_ms)
    return leads, tails, empty


def cuts_inside_words(sentences, tokens) -> int:
    """Sentence edges that fall inside a word (by more than 30 ms on both sides): a clipped or doubled word."""
    edges = [x for s in sentences for x in (s.start_ms, s.end_ms)]
    return sum(1 for x in edges for t in tokens
               if t.kind == "word" and t.start_ms + INSIDE_MARGIN_MS < x < t.end_ms - INSIDE_MARGIN_MS)


def violations(sentences) -> dict:
    return {"inverted": sum(1 for s in sentences if s.end_ms <= s.start_ms),
            "overlapping": sum(1 for a, b in zip(sentences, sentences[1:]) if b.start_ms < a.end_ms),
            "not_monotonic": sum(1 for a, b in zip(sentences, sentences[1:]) if b.start_ms < a.start_ms)}


def word_free_spans(tokens, limit_ms: int, min_ms: int = WORD_FREE_MS) -> list[tuple[int, int]]:
    """Stretches of at least `min_ms` without any token (music, silence, or speech the recognizer missed)."""
    out, last = [], 0
    for t in tokens:
        if t.start_ms - last >= min_ms:
            out.append((last, t.start_ms))
        last = max(last, t.end_ms)
    if limit_ms - last >= min_ms:
        out.append((last, limit_ms))
    return out


def inner_pauses(sentences, tokens, over_ms: int = 1_500) -> int:
    count = 0
    for s in sentences:
        inside = words_inside(s, tokens)
        if any(b.start_ms - a.end_ms > over_ms for a, b in zip(inside, inside[1:])):
            count += 1
    return count


def sample_rows(sentences, n: int, seed: int) -> list[dict]:
    """N sentences spread evenly over the item (one random pick inside each of N equal slices), times only."""
    if not sentences:
        return []
    rng = random.Random(seed)
    n = min(n, len(sentences))
    rows = []
    for k in range(n):
        lo, hi = k * len(sentences) // n, max(k * len(sentences) // n, (k + 1) * len(sentences) // n - 1)
        s = sentences[rng.randint(lo, hi)]
        rows.append({"ours_start_ms": s.start_ms, "ours_end_ms": s.end_ms, "true_start_ms": None, "true_end_ms": None})
    return rows


def match(sentences, start_ms: int, end_ms: int):
    """The sentence that overlaps [start, end] the most (ties: the closest start)."""
    def key(s):
        overlap = min(s.end_ms, end_ms) - max(s.start_ms, start_ms)
        return (overlap, -abs(s.start_ms - start_ms))
    return max(sentences, key=key, default=None)


def gold_errors(sentences, gold: list[dict]) -> dict:
    starts, ends, clipped = [], [], 0
    for row in gold:
        ts, te = row.get("true_start_ms"), row.get("true_end_ms")
        if not isinstance(ts, (int, float)) or not isinstance(te, (int, float)) or te <= ts:
            continue
        s = match(sentences, ts, te)
        if s is None:
            continue
        starts.append(s.start_ms - ts)
        ends.append(s.end_ms - te)
        if s.start_ms - ts > CLIP_START_MS or te - s.end_ms > CLIP_END_MS:
            clipped += 1
    n = len(starts)
    return {"n": n, "start_p50": pct([abs(x) for x in starts], 50), "start_p95": pct([abs(x) for x in starts], 95),
            "end_p50": pct([abs(x) for x in ends], 50), "end_p95": pct([abs(x) for x in ends], 95),
            "start_bias_p50": pct(starts, 50), "end_bias_p50": pct(ends, 50),
            "clip_rate": round(clipped / n, 3) if n else None}


def verdict(errors: dict) -> dict:
    """PASS / FAIL against the plan's targets (None when there is no gold row)."""
    if not errors["n"]:
        return {k: None for k in TARGETS}
    return {k: ("PASS" if errors[k] is not None and errors[k] <= limit else "FAIL") for k, limit in TARGETS.items()}


def report_numbers(built, v1, tokens, chunks) -> dict:
    limit = max((c.end_ms for c in chunks), default=0)
    out = {"algorithm": built.algorithm, "sentences": len(built.sentences), "low_confidence": built.low_confidence,
           "flags": dict(sorted(Counter(f for fl in built.flags for f in fl).items())),
           "flagged_sentences": sum(1 for f in built.flags if f),
           "chunks": len(chunks), "empty_chunks": sum(1 for c in chunks if c.text is not None and not c.text.strip()),
           "overlapping_seams": sum(1 for a, b in zip(chunks, chunks[1:]) if b.start_ms < a.end_ms),
           "seam_tokens": sum(1 for t in tokens if t.seam),
           "token_kinds": dict(sorted(Counter(t.kind for t in tokens).items())),
           "word_free_spans_s": [(round(a / 1000, 1), round(b / 1000, 1)) for a, b in word_free_spans(tokens, limit)]}
    for name, result in (("now", built), ("v1", v1)):
        leads, tails, empty = edge_offsets(result.sentences, tokens)
        out[name] = {"violations": violations(result.sentences), "lead": summary([abs(x) for x in leads]),
                     "tail": summary([abs(x) for x in tails]), "no_words": empty,
                     "cuts_inside_words": cuts_inside_words(result.sentences, tokens),
                     "pauses_over_1500_inside": inner_pauses(result.sentences, tokens),
                     "duration_ms": summary([s.end_ms - s.start_ms for s in result.sentences])}
    return out


def markdown(label: str, numbers: dict, scores: dict | None = None) -> str:
    lines = [f"### 评估 {label}", ""]
    lines += [f"- {k}:{json.dumps(v, ensure_ascii=False)}" for k, v in numbers.items()]
    if scores is not None:
        lines += [f"- gold {k}:{json.dumps(v, ensure_ascii=False)}" for k, v in scores.items()]
    return "\n".join(lines) + "\n"


# ---- the real run ----

def transcript_path(args) -> Path:
    if args.transcript:
        return Path(args.transcript)
    from app.core.config import Settings

    root = Path(args.data_dir) if args.data_dir else Settings().resolved_data_dir
    found = sorted((root / "library").glob(f"*/{args.item_id}/transcript.json"))
    if not found:
        raise SystemExit("no kept transcript for that item (processed before plan v2, or its subtitles were replaced)")
    return found[0]


def load(args):
    from app.library import asr_chunks, sentences, timeline

    loaded = asr_chunks.load_transcript(transcript_path(args))
    if loaded is None:
        raise SystemExit("the transcript file is not readable")
    chunks, silences = loaded
    return chunks, sentences.build(chunks, silences), sentences.build_v1(chunks, silences), \
        timeline.tokens_for(chunks, silences)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("command", choices=("report", "sample", "score"))
    where = p.add_mutually_exclusive_group(required=True)
    where.add_argument("--item-id")
    where.add_argument("--transcript", help="path of a transcript.json (instead of --item-id)")
    p.add_argument("--data-dir", help="defaults to the server's DATA_DIR")
    p.add_argument("--n", type=int, default=30)
    p.add_argument("--seed", type=int, default=1)
    p.add_argument("--out", help="sample: where to write the gold template")
    p.add_argument("--gold", help="score: the filled-in gold file")
    p.add_argument("--label", default="item")
    p.add_argument("--append-to", help="append the Markdown block to this file (the results document)")
    args = p.parse_args(argv)
    chunks, built, v1, tokens = load(args)
    if args.command == "sample":
        rows = sample_rows(built.sentences, args.n, args.seed)
        if args.out:
            Path(args.out).write_text(json.dumps(rows, indent=1), encoding="utf-8")
        for i, r in enumerate(rows):
            print(f"{i:3d}  {r['ours_start_ms'] / 1000:9.3f} - {r['ours_end_ms'] / 1000:9.3f} s   "
                  f"listen {max(0, r['ours_start_ms'] - 1500) / 1000:.1f} - {(r['ours_end_ms'] + 1500) / 1000:.1f} s")
        return 0
    numbers = report_numbers(built, v1, tokens, chunks)
    scores = None
    if args.command == "score":
        if not args.gold:
            raise SystemExit("score needs --gold")
        gold = json.loads(Path(args.gold).read_text(encoding="utf-8"))
        now, old = gold_errors(built.sentences, gold), gold_errors(v1.sentences, gold)
        scores = {"now": now, "v1": old, "targets": TARGETS, "verdict": verdict(now)}
    block = markdown(args.label, numbers, scores)
    print(block)
    if args.append_to:
        with open(args.append_to, "a", encoding="utf-8", newline="\n") as fh:
            fh.write("\n" + block)
    return 0


if __name__ == "__main__":
    sys.exit(main())
