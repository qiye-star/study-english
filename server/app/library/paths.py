"""跟读库的文件布局(spec §5.1),全部在 `Settings.resolved_data_dir` 下:

    library/<user_id>/<item_id>/media.mp4 | media.m4a | media.mp3
    library/<user_id>/<item_id>/poster.jpg            # 仅视频
    library/_tmp/<item_id>/                           # 分片、下载、WAV、chunks.json;完成 / 取消 / 失败清理时整个删除

路径逃逸检查与 `services.recordings.absolute_path` 相同;id 先按形状校验,任何外部输入都拼不出数据目录外的路径。
"""
import os
import re
import shutil
from pathlib import Path

ROOT = "library"
TMP = "_tmp"
_ITEM_ID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def check_item_id(item_id: str) -> str:
    if not isinstance(item_id, str) or not _ITEM_ID.fullmatch(item_id):
        raise ValueError("Invalid item id")
    return item_id


def check_user_id(user_id: int) -> int:
    if not isinstance(user_id, int) or isinstance(user_id, bool) or user_id <= 0:
        raise ValueError("Invalid user id")
    return user_id


def absolute(data_dir: Path, relpath: str) -> Path:
    root = Path(data_dir).resolve()
    path = (root / relpath).resolve()
    if not path.is_relative_to(root) or path == root:
        raise ValueError("Library path escapes the data directory")
    return path


def user_rel(user_id: int) -> str:
    return f"{ROOT}/{check_user_id(user_id)}"


def item_rel(user_id: int, item_id: str) -> str:
    return f"{user_rel(user_id)}/{check_item_id(item_id)}"


def tmp_rel(item_id: str) -> str:
    return f"{ROOT}/{TMP}/{check_item_id(item_id)}"


def item_dir(data_dir: Path, user_id: int, item_id: str) -> Path:
    return absolute(data_dir, item_rel(user_id, item_id))


def tmp_dir(data_dir: Path, item_id: str) -> Path:
    return absolute(data_dir, tmp_rel(item_id))


def tmp_root(data_dir: Path) -> Path:
    return absolute(data_dir, f"{ROOT}/{TMP}")


def remove_tree(path: Path) -> None:
    """Best effort: a missing directory is fine; errors are swallowed (the daily sweep tries again)."""
    shutil.rmtree(path, ignore_errors=True)


def remove_item_files(data_dir: Path, user_id: int, item_id: str) -> None:
    remove_tree(item_dir(data_dir, user_id, item_id))
    remove_tree(tmp_dir(data_dir, item_id))


def remove_user_files(data_dir: Path, user_id: int, item_ids: list[str]) -> None:
    """Deleting a user: their whole library directory plus the staging directories of their items."""
    remove_tree(absolute(data_dir, user_rel(user_id)))
    for item_id in item_ids:
        try:
            remove_tree(tmp_dir(data_dir, item_id))
        except ValueError:
            continue


def file_bytes(path: Path) -> int:
    try:
        return path.stat().st_size
    except OSError:
        return 0


def disk_free(path: Path) -> int:
    """Free bytes on the volume that holds `path` (its nearest existing parent)."""
    probe = Path(path)
    while not probe.exists() and probe != probe.parent:
        probe = probe.parent
    return shutil.disk_usage(probe).free


def replace(src: Path, dst: Path) -> None:
    """Atomic move inside the data volume (`_tmp` and the final directory are on the same file system)."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    os.replace(src, dst)
