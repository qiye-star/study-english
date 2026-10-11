"""<<META>> 输出协议(spec §7.3;计划 A3 S3):解析、流式剥离(拆分模糊测试)、回落规则。"""
import json
import random

from app.agents.tutor.parse import META_MARKER, Meta, StreamFilter, parse_meta, resolve


def run(parts: list[str]) -> tuple[str, StreamFilter]:
    f = StreamFilter()
    return "".join(f.feed(p) for p in parts) + f.flush(), f


def test_parse_valid_meta():
    text = 'Nice!\n简评:很好。\n<<META>>{"verdict":"good","kind":"repeat","next_focus":"past <tense>","hint":"慢一点","say":"","done":false}'
    visible, meta = parse_meta(text)
    assert visible == "Nice!\n简评:很好。"
    assert meta == Meta(verdict="good", kind="repeat", next_focus="past ‹tense›", hint="慢一点", say="", done=False)


def test_parse_without_marker_invalid_json_or_values():
    assert parse_meta("Just text  \n") == ("Just text", None)
    assert parse_meta("Hi <<META>>{not json") == ("Hi", None)
    assert parse_meta("Hi <<META>>no braces") == ("Hi", None)
    _, meta = parse_meta('Hi<<meta>>{"verdict":"excellent","kind":"sing","done":"true","hint":7} trailing')
    assert meta == Meta(verdict=None, kind=None, next_focus="", hint="", say="", done=False)


def test_filter_hides_marker_split_across_chunks():
    out, f = run(["Good job.\n<<", "MET", 'A>>{"verdict":"good"}'])
    assert out == "Good job." and f.seen and json.loads(f.tail)["verdict"] == "good"


def test_filter_lowercase_marker_and_lookalikes():
    assert run(["a <<meta>>", "{}"])[0] == "a"
    assert run(["<<METRO>> stays"])[0] == "<<METRO>> stays"
    assert run(["ends with <<ME"])[0] == "ends with <<ME"


def test_resolve_fallback_rules():
    assert resolve(None, answering=True) == (Meta(verdict="ok"), True)
    assert resolve(None, answering=False) == (Meta(verdict=None), True)
    assert resolve(Meta(verdict=None, hint="h"), answering=True) == (Meta(verdict="ok", hint="h"), True)
    assert resolve(Meta(verdict="weak"), answering=False) == (Meta(verdict=None), False)
    assert resolve(Meta(verdict="weak"), answering=True) == (Meta(verdict="weak"), False)


ALPHABET = ["a", "b", " ", "\n", "\t", "<", ">", "<<", "<<M", "<<ME", "<<MET", "<<META", "META", ">>", "你好",
            "简评:", "{", "}", "e", "T", "m"]


def _visible(rng: random.Random) -> str:
    while True:
        text = "".join(rng.choice(ALPHABET) for _ in range(rng.randint(0, 40)))
        if "<<meta>>" not in text.lower():
            return text


def _split(rng: random.Random, text: str) -> list[str]:
    if len(text) < 2:
        return [text]
    cuts = sorted(rng.sample(range(1, len(text)), k=min(len(text) - 1, rng.randint(0, 8))))
    return [text[a:b] for a, b in zip([0, *cuts], [*cuts, len(text)])]


def test_fuzz_chunk_splits_never_leak_meta_and_match_parse():
    rng = random.Random(20261012)
    for i in range(3000):
        visible = _visible(rng)
        marker = rng.choice([META_MARKER, "<<meta>>", "<<Meta>>"])
        tail = rng.choice([json.dumps({"verdict": "good", "next_focus": f"HIDDEN{i}", "done": False}),
                           f"{{broken HIDDEN{i}", f"HIDDEN{i}"])
        has_meta = rng.random() < 0.8
        full = visible + rng.choice(["", "\n", " \n"]) + marker + tail if has_meta else visible
        out, f = run(_split(rng, full))
        assert out == parse_meta(full)[0], repr(full)
        assert "HIDDEN" not in out
        if has_meta:
            assert parse_meta("x" + META_MARKER + f.tail)[1] == parse_meta(full)[1]
        else:
            assert not f.seen
