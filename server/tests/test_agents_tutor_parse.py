"""<<META>> 输出协议(spec §7.3;计划 A3 S3):解析、流式剥离(拆分模糊测试)、回落规则。"""
import json
import random

from app.agents.tutor.parse import _MARK, META_MARKER, MAX_NOTE, Meta, StreamFilter, parse_meta, resolve


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


VARIANTS = ["<< META >>", "<<META >>", "<< meta>>", "«META»", "‹‹ Meta ››", "＜＜META＞＞", "<<\tMETA\n>>", "<META>"]


def test_marker_variants_are_parsed_and_hidden():
    for marker in VARIANTS:
        full = "Nice.\n" + marker + '{"verdict":"good","hint":"h"}'
        visible, meta = parse_meta(full)
        assert visible == "Nice." and meta is not None and meta.verdict == "good", marker
        for size in (1, 2, 3, 100):
            out, f = run([full[i:i + size] for i in range(0, len(full), size)])
            assert out == "Nice." and f.seen, (marker, size)
    assert run(["a << META list >> b"])[0] == "a << META list >> b"
    assert run(["x <<", " ME", "TA >", ">{}"])[0] == "x"


def test_resolve_fallback_rules():
    assert resolve(None, answering=True) == (Meta(verdict="ok"), True)
    assert resolve(None, answering=False) == (Meta(verdict=None), True)
    assert resolve(Meta(verdict=None, hint="h"), answering=True) == (Meta(verdict="ok", hint="h"), True)
    assert resolve(Meta(verdict="weak"), answering=False) == (Meta(verdict=None), False)
    assert resolve(Meta(verdict="weak"), answering=True) == (Meta(verdict="weak"), False)


ALPHABET = ["«", "»", "< ", " >", "‹", "＞","a", "b", " ", "\n", "\t", "<", ">", "<<", "<<M", "<<ME", "<<MET", "<<META", "META", ">>", "你好",
            "简评:", "{", "}", "e", "T", "m"]


def _visible(rng: random.Random) -> str:
    while True:
        text = "".join(rng.choice(ALPHABET) for _ in range(rng.randint(0, 40)))
        if _MARK.search(text) is None:
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
        marker = rng.choice([META_MARKER, "<<meta>>", "<<Meta>>", *VARIANTS])
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


def test_parse_note_zh_and_hint_zh_clip_and_default_to_empty():
    text = ('Nice!\n<<META>>{"verdict":"good","hint":"Start with when.","hint_zh":"先说什么时候","note_zh":"表达很自然",'
            '"done":false}')
    visible, meta = parse_meta(text)
    assert visible == "Nice!"
    assert (meta.hint, meta.hint_zh, meta.note_zh) == ("Start with when.", "先说什么时候", "表达很自然")
    _, long = parse_meta('x<<META>>{"note_zh":"' + "很" * 200 + '","hint_zh":7}')
    assert long.note_zh == "很" * MAX_NOTE and long.hint_zh == ""
    for raw in ('{"verdict":"ok"}', '{"note_zh":["a"],"hint_zh":{"a":1}}', '{"note_zh":null}'):
        _, plain = parse_meta("x<<META>>" + raw)
        assert (plain.note_zh, plain.hint_zh) == ("", ""), raw
    _, angle = parse_meta('x<<META>>{"note_zh":"a <b> c"}')
    assert angle.note_zh == "a ‹b› c"  # same look-alike rule as every other META text


def test_resolve_keeps_the_chinese_fields_and_the_filter_still_hides_them():
    meta = Meta(verdict="weak", note_zh="再试一次", hint_zh="慢一点")
    assert resolve(meta, answering=False) == (Meta(verdict=None, note_zh="再试一次", hint_zh="慢一点"), False)
    assert resolve(Meta(note_zh="n"), answering=True)[0].note_zh == "n"
    assert resolve(None, answering=True)[0].note_zh == ""
    full = 'Good.\n<<META>>{"verdict":"good","hint_zh":"提示","note_zh":"不错"}'
    out, f = run([full[i:i + 3] for i in range(0, len(full), 3)])
    assert out == "Good." and "提示" in f.tail and "不错" in f.tail  # the tail is the META JSON: never visible
