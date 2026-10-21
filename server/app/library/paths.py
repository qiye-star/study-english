"""跟读库的文件布局(spec §5.1),全部在 `Settings.resolved_data_dir` 下:

    library/<user_id>/<item_id>/media.mp4 | media.m4a | media.mp3
    library/<user_id>/<item_id>/poster.jpg            # 仅视频
    library/_tmp/<item_id>/                           # 分片、下载、WAV、chunks.json;完成 / 取消 / 失败清理时整个删除
    library/_catalog/<catalog_id>/media.m4a | poster.jpg   # 精选库,系统所有,所有用户共用(spec 2026-10-14-curated-library E4)
    library/_catalog/_tmp/<catalog_id>/               # 精选库的导入暂存(不在 library/_tmp/:用户库的清扫碰不到)

路径逃逸检查与 `services.recordings.absolute_path` 相同;id 先按形状校验,任何外部输入都拼不出数据目录外的路径。
"""
import logging
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


# ---- stored keys (plan L1 R2): the same relative paths, used as object keys by every backend ----

def media_key(user_id: int, item_id: str, name: str) -> str:
    return f"{item_rel(user_id, item_id)}/{name}"


def poster_key(user_id: int, item_id: str) -> str:
    return f"{item_rel(user_id, item_id)}/poster.jpg"


def transcript_key(user_id: int, item_id: str) -> str:
    return f"{item_rel(user_id, item_id)}/{TRANSCRIPT_NAME}"


def item_prefix(user_id: int, item_id: str) -> str:
    return f"{item_rel(user_id, item_id)}/"


def user_prefix(user_id: int) -> str:
    return f"{user_rel(user_id)}/"


def catalog_media_key(catalog_id: str, name: str) -> str:
    return f"{catalog_rel(catalog_id)}/{name}"


def catalog_poster_key(catalog_id: str) -> str:
    return f"{catalog_rel(catalog_id)}/poster.jpg"


def catalog_prefix(catalog_id: str) -> str:
    return f"{catalog_rel(catalog_id)}/"


TRANSCRIPT_NAME = "transcript.json"
_log = logging.getLogger(__name__)


async def drop_persistent(store, prefix: str) -> None:
    """Delete everything under a stored prefix. Runs after the database commit and never raises: a failure is logged
    with its code only, and the daily sweep is the backstop (plan L1 R6.2)."""
    try:
        await store.delete_prefix(prefix)
    except Exception as exc:  # noqa: BLE001 - deletes after commit must not fail the request
        _log.warning("library delete failed op=delete_prefix code=%s", getattr(exc, "code", type(exc).__name__))


async def remove_item_files(store, data_dir: Path, user_id: int, item_id: str) -> None:
    await drop_persistent(store, item_prefix(user_id, item_id))
    remove_tree(tmp_dir(data_dir, item_id))


async def remove_user_files(store, data_dir: Path, user_id: int, item_ids: list[str]) -> None:
    """Deleting a user: their whole library prefix in the store plus the local staging of their items."""
    await drop_persistent(store, user_prefix(user_id))
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


# ---- 精选库(spec 2026-10-14-curated-library E4):系统所有,所有用户共用 ----
CATALOG = "_catalog"


def catalog_rel(catalog_id: str) -> str:
    return f"{ROOT}/{CATALOG}/{check_item_id(catalog_id)}"


def catalog_tmp_rel(catalog_id: str) -> str:
    return f"{ROOT}/{CATALOG}/{TMP}/{check_item_id(catalog_id)}"


def catalog_dir(data_dir: Path, catalog_id: str) -> Path:
    return absolute(data_dir, catalog_rel(catalog_id))


def catalog_tmp_dir(data_dir: Path, catalog_id: str) -> Path:
    return absolute(data_dir, catalog_tmp_rel(catalog_id))


async def remove_catalog_files(store, data_dir: Path, catalog_id: str) -> None:
    await drop_persistent(store, catalog_prefix(catalog_id))
    remove_tree(catalog_tmp_dir(data_dir, catalog_id))
