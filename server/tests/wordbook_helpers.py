"""背单词测试夹具:迷你词书目录与开关注入(计划 P-W1)。"""
import shutil
from pathlib import Path

MINI = Path(__file__).resolve().parent / "fixtures" / "wordbook" / "mini.jsonl"


def make_data_dir(tmp_path: Path, books: tuple[str, ...] = ("junior",)) -> Path:
    data = tmp_path / "dict"
    data.mkdir(exist_ok=True)
    for book in books:
        shutil.copyfile(MINI, data / f"{book}.jsonl")
    return data


def enable_wordbook(app, data_dir: Path, **overrides) -> None:
    app.state.settings = app.state.settings.model_copy(
        update={"wordbook_enabled": True, "wordbook_data_dir": str(data_dir), **overrides})
    if hasattr(app.state, "wordbook_dict"):
        del app.state.wordbook_dict
