"""背单词测试夹具:迷你词书目录与开关注入(计划 P-W1)。"""
import json
import shutil
from pathlib import Path

MINI = Path(__file__).resolve().parent / "fixtures" / "wordbook" / "mini.jsonl"


def make_data_dir(tmp_path: Path, books: tuple[str, ...] = ("junior",)) -> Path:
    data = tmp_path / "dict"
    data.mkdir(exist_ok=True)
    for book in books:
        shutil.copyfile(MINI, data / f"{book}.jsonl")
    return data


MINI_DEFS = {  # English definitions for the mini fixture book (spec 2026-10-12-wordbook-definitions)
    "talk": [("v", "speak to someone"), ("v", "have a conversation"), ("n", "a conversation between people")],
    "ability": [("n", "the power or skill to do something")],
    "able": [("a", "having the power or skill to do something")],
    "abandon": [("v", "leave something or someone for good")],
    "absorb": [("v", "take in a liquid or gas slowly")],
    "accept": [("v", "agree to take something offered")],
    "accident": [("n", "something bad that happens by chance")],
    "go": [("v", "move or travel to a place")],
    "child": [("n", "a young person who is not yet an adult")],
    "careful": [("a", "thinking about what you do to avoid mistakes")],
    "carry": [("v", "hold something and take it somewhere")],
    "stop": [("v", "end a movement or an action")],
    "used to": [("v", "did something often in the past")],
    "monday": [("n", "the day of the week after Sunday")],
}


def make_defs_dir(tmp_path: Path, rows: dict | None = None) -> Path:
    """`<tmp>/wordbook-definitions/definitions.jsonl`: the sibling of `make_data_dir`'s `<tmp>/dict` (what the loader finds)."""
    folder = tmp_path / "wordbook-definitions"
    folder.mkdir(exist_ok=True)
    lines = [json.dumps({"word": w, "defs": [{"pos": p, "text": t, "src": "oewn"} for p, t in defs]}, ensure_ascii=False)
             for w, defs in sorted((MINI_DEFS if rows is None else rows).items())]
    (folder / "definitions.jsonl").write_bytes(("\n".join(lines) + "\n").encode("utf-8"))
    return folder


def enable_wordbook(app, data_dir: Path, **overrides) -> None:
    app.state.settings = app.state.settings.model_copy(
        update={"wordbook_enabled": True, "wordbook_data_dir": str(data_dir), "wordbook_spot_check_pct": 0, **overrides})
    if hasattr(app.state, "wordbook_dict"):
        del app.state.wordbook_dict
