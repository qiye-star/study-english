"""头像图片处理(计划 S1、R-V1):字节进、字节出,纯函数。

不碰数据库、设置或文件系统(存储在 S3 的同一模块里另加)。路由在 `asyncio.to_thread` 里调用 `process`,
因为 Pillow 解码是 CPU 密集操作。错误只用 `AvatarError.kind` 表达,不带图片内容或路径。
"""
import io
import warnings

from PIL import Image, ImageOps, UnidentifiedImageError

MAX_UPLOAD_BYTES = 2 * 1024 * 1024
OUTPUT_SIDE = 256
MAX_SIDE = 8000
MAX_PIXELS = 20_000_000
_ALLOWED_FORMATS = frozenset({"JPEG", "PNG", "WEBP"})

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
