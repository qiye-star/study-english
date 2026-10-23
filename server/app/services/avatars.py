"""头像图片处理(计划 S1、R-V1):字节进、字节出,纯函数。

`process` 不碰数据库、设置或文件系统;文件存取(`store`、`path_for`、`remove`)只接受 `Settings` 参数,
不读 `app.state`。路由在 `asyncio.to_thread` 里调用 `process` 与 `store`(Pillow 解码与磁盘写入都是阻塞操作)。
错误只用 `AvatarError.kind` 表达,不带图片内容、文件名或路径。
"""
import asyncio
import io
import logging
import os
import re
import secrets
import warnings
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.core.config import Settings
from app.models import AvatarReport, RoomMember, User
from app.storage import BlobNotFound

MAX_UPLOAD_BYTES = 2 * 1024 * 1024
OUTPUT_SIDE = 256
MAX_SIDE = 8000
MAX_PIXELS = 20_000_000
_ALLOWED_FORMATS = frozenset({"JPEG", "MPO", "PNG", "WEBP"})  # MPO: multi-picture JPEG from some phone cameras
_ID_RE = re.compile(r"[0-9a-f]{32}")
logger = logging.getLogger(__name__)

# 解压炸弹防护与 `process` 自己的像素检查取同一上限(R-V1)。
Image.MAX_IMAGE_PIXELS = MAX_PIXELS


class AvatarError(Exception):
    """`kind` 是稳定的错误码:`too_large` 或 `invalid_image`。"""

    def __init__(self, kind: str):
        super().__init__(kind)
        self.kind = kind


def _sniff(data: bytes) -> str | None:
    """只信任文件头的魔数,不信任 Content-Type 或文件名。"""
    if data.startswith(b"\xff\xd8\xff"):
        return "JPEG"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "PNG"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "WEBP"
    return None


def process(data: bytes) -> bytes:
    """把上传的图片重新编码为 256×256 WebP(居中裁成正方形,去掉 EXIF / ICC / XMP)。"""
    if len(data) > MAX_UPLOAD_BYTES:
        raise AvatarError("too_large")
    if _sniff(data) is None:
        raise AvatarError("invalid_image")
    try:
        with Image.open(io.BytesIO(data)) as probe:
            if probe.format not in _ALLOWED_FORMATS:
                raise AvatarError("invalid_image")
            width, height = probe.size
            # 先于 load():声明的尺寸超限时不解码任何像素
            if width < 1 or height < 1 or width > MAX_SIDE or height > MAX_SIDE or width * height > MAX_PIXELS:
                raise AvatarError("invalid_image")
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                probe.load()  # 动画只取第一帧
                img = ImageOps.exif_transpose(probe)
        img = img.convert("RGBA" if _has_alpha(img) else "RGB")
        side = min(img.size)
        left = (img.width - side) // 2
        top = (img.height - side) // 2
        img = img.crop((left, top, left + side, top + side)).resize(
            (OUTPUT_SIDE, OUTPUT_SIDE), Image.Resampling.LANCZOS)
        # 新建一张没有任何元数据的图再编码
        clean = Image.frombytes(img.mode, img.size, img.tobytes())
        out = io.BytesIO()
        clean.save(out, format="WEBP", quality=82, method=4)
        return out.getvalue()
    except AvatarError:
        raise
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError,
            Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise AvatarError("invalid_image") from None


def _has_alpha(img: Image.Image) -> bool:
    return img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)


# ---- 文件存储(R-V2):DATA_DIR/avatars/<32 位十六进制随机 id>.webp ----

def _check_id(avatar_id: object) -> str:
    """只接受 32 位小写十六进制;拼路径之前校验,杜绝路径遍历。"""
    if not isinstance(avatar_id, str) or _ID_RE.fullmatch(avatar_id) is None:
        raise ValueError("invalid avatar id")
    return avatar_id


def avatar_key(avatar_id: str) -> str:
    """The object key of an avatar: `avatars/<id>.webp` (plan L1 Task 14; the id check runs before any key is built)."""
    return f"avatars/{_check_id(avatar_id)}.webp"


async def save(blobs, data: bytes) -> str:
    """Store one processed avatar under a fresh random id and return the id. The database commit is the caller's job:
    if it fails, `remove` deletes the object written here."""
    avatar_id = secrets.token_hex(16)
    await blobs.put_bytes(avatar_key(avatar_id), data, content_type="image/webp")
    return avatar_id


async def remove(blobs, avatar_id: str | None) -> None:
    """Delete one avatar object; a missing or illegal id is a no-op, a store failure is logged by class. Never raises.
    Never call this before the database commit."""
    if avatar_id is None:
        return
    try:
        await blobs.delete(avatar_key(avatar_id))
    except Exception as exc:  # noqa: BLE001 - after commit: never fail the request
        logger.warning("avatar delete failed code=%s", getattr(exc, "code", type(exc).__name__))


def avatar_url(avatar_id: str | None) -> str | None:
    """网页使用的相对地址(X17)。没有头像时为 None。"""
    if avatar_id is None:
        return None
    return f"/api/avatars/{_check_id(avatar_id)}"


# ---- 数据库逻辑(计划 S4、S5、S6):会话、设置、用户与时间都是参数,不读 app.state(INDEX X32) ----

async def upload(session: AsyncSession, blobs, user: User, raw: bytes) -> str:
    """R-V1、R-V2:处理图片、写入新对象、提交数据库,提交成功后才删除旧对象。返回新的相对地址。
    提交失败时删除刚写出的新对象并回滚,旧头像保持不变。"""
    png = await asyncio.to_thread(process, raw)
    new_id = await save(blobs, png)
    old_id = user.avatar_id
    user.avatar_id = new_id
    try:
        await session.commit()
    except BaseException:
        await session.rollback()
        await remove(blobs, new_id)
        raise
    await remove(blobs, old_id)  # after the commit; remove() never raises
    logger.debug("avatar stored bytes=%d", len(png))
    return avatar_url(new_id)


async def clear(session: AsyncSession, blobs, user: User) -> None:
    """删除自己的头像;没有头像时什么也不做(幂等)。对象在提交之后删除。"""
    old_id = user.avatar_id
    if old_id is None:
        return
    user.avatar_id = None
    try:
        await session.commit()
    except BaseException:
        await session.rollback()
        raise
    await remove(blobs, old_id)
    logger.debug("avatar removed")


async def public_read(session: AsyncSession, blobs, avatar_id: str) -> bytes | None:
    """公开读取(R-V4):只认 `users.avatar_id` 里存在的 id。id 格式不对时在查库之前就返回 None;
    「不存在」「已删除」「不属于任何人」给出同一个答案,不泄露归属。对象缺失也是 None(由路由给 404)。"""
    if not isinstance(avatar_id, str) or _ID_RE.fullmatch(avatar_id) is None:
        return None
    owner = (await session.execute(select(User.id).where(User.avatar_id == avatar_id))).scalar_one_or_none()
    if owner is None:
        return None
    try:
        return await blobs.get_bytes(avatar_key(avatar_id), max_bytes=MAX_UPLOAD_BYTES)
    except BlobNotFound:
        return None


class ReportError(Exception):
    """`kind`:`not_found`(用户不存在、自己、或两人从未同在一个房间)或 `no_avatar`(被举报者当前没有头像)。"""

    def __init__(self, kind: str):
        super().__init__(kind)
        self.kind = kind


async def report(session: AsyncSession, reporter: User, target_id: str, reason: str, now: datetime) -> bool:
    """R-V6:同过房间(现在或曾经)的人可以举报对方当前的头像;同一人对同一头像只记一次。
    返回 True 表示新记了一行,False 表示重复。日志与错误都不带用户名、头像 id 或文件路径。"""
    try:
        target_pk = int(target_id)
    except (TypeError, ValueError):
        raise ReportError("not_found") from None
    if target_pk == reporter.id:
        raise ReportError("not_found")
    target = await session.get(User, target_pk)
    if target is None:
        raise ReportError("not_found")
    mine, theirs = aliased(RoomMember), aliased(RoomMember)  # left_at keeps the row: "ever" counts
    shared = (await session.execute(
        select(mine.id)
        .join(theirs, theirs.room_id == mine.room_id)
        .where(mine.user_id == reporter.id, theirs.user_id == target.id)
        .limit(1)
    )).first()
    if shared is None:
        raise ReportError("not_found")
    if target.avatar_id is None:
        raise ReportError("no_avatar")
    existing = (await session.execute(
        select(AvatarReport.id).where(AvatarReport.reporter_id == reporter.id,
                                      AvatarReport.avatar_id == target.avatar_id)
    )).first()
    if existing is not None:
        return False
    session.add(AvatarReport(avatar_user_id=target.id, avatar_id=target.avatar_id, reporter_id=reporter.id,
                             reason=reason, created_at=now))
    try:
        await session.commit()
    except IntegrityError:  # a concurrent duplicate: the unique constraint keeps one row
        await session.rollback()
        return False
    logger.debug("avatar report recorded")
    return True
