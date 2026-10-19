"""头像图片处理(计划 S1;R-V1):Pillow 重新编码、去元数据、拒绝畸形与解压炸弹。

测试在运行时用 Pillow 生成图片,不提交二进制夹具。"""
import io
import struct
import time
import zlib

import pytest
from PIL import Image

from app.services.avatars import AvatarError, process

MAX_BYTES = 2 * 1024 * 1024


def _encode(img: Image.Image, fmt: str, **kwargs) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format=fmt, **kwargs)
    return buf.getvalue()


def _solid(size, color, mode="RGB") -> Image.Image:
    return Image.new(mode, size, color)


def _png_header_only(width: int, height: int) -> bytes:
    """只有签名与一个(CRC 正确的)IHDR,声明的尺寸远超像素上限;不含像素数据。"""

    def chunk(kind: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)


def _is_webp(data: bytes) -> bool:
    return data[:4] == b"RIFF" and data[8:12] == b"WEBP"


def test_png_jpeg_and_webp_inputs_become_256_square_webp():
    for fmt, kwargs in (("PNG", {}), ("JPEG", {"quality": 90}), ("WEBP", {"quality": 90})):
        out = process(_encode(_solid((300, 200), (30, 160, 90)), fmt, **kwargs))
        assert _is_webp(out), fmt
        img = Image.open(io.BytesIO(out))
        assert img.format == "WEBP"
        assert img.size == (256, 256), fmt


def test_wide_and_tall_inputs_are_center_cropped():
    # 300x100: the centre 100x100 square (x 100..200) is blue, everything else red.
    wide = _solid((300, 100), (220, 20, 20))
    wide.paste(_solid((100, 100), (20, 20, 220)), (100, 0))
    img = Image.open(io.BytesIO(process(_encode(wide, "PNG"))))
    r, g, b = img.convert("RGB").getpixel((5, 5))
    assert b > 180 and r < 80
    r, g, b = img.convert("RGB").getpixel((250, 250))
    assert b > 180 and r < 80

    # 100x300: the centre square (y 100..200) is green; corners of the output are green too.
    tall = _solid((100, 300), (220, 20, 20))
    tall.paste(_solid((100, 100), (20, 220, 20)), (0, 100))
    img = Image.open(io.BytesIO(process(_encode(tall, "PNG"))))
    r, g, b = img.convert("RGB").getpixel((5, 5))
    assert g > 180 and r < 80


def test_exif_is_stripped_and_orientation_is_applied():
    # Stored 200x100: left half red, right half blue. Orientation 6 means "rotate 90 degrees clockwise to
    # display", so the displayed image is 100 wide and 200 tall with red on top and blue at the bottom.
    stored = _solid((200, 100), (20, 20, 220))
    stored.paste(_solid((100, 100), (220, 20, 20)), (0, 0))
    exif = Image.Exif()
    exif[0x0112] = 6  # Orientation
    exif[0x010F] = "ExampleCamera"  # Make
    gps = exif.get_ifd(0x8825)  # GPS IFD
    gps[1] = "N"
    gps[2] = (31.0, 14.0, 0.0)
    src = _encode(stored, "JPEG", quality=95, exif=exif.tobytes())
    assert Image.open(io.BytesIO(src)).getexif().get(0x0112) == 6  # the input really carried the tag

    out = process(src)
    img = Image.open(io.BytesIO(out))
    assert len(img.getexif()) == 0
    assert "exif" not in img.info and "icc_profile" not in img.info and "xmp" not in img.info
    rgb = img.convert("RGB")
    r, g, b = rgb.getpixel((128, 30))
    assert r > 150 and b < 100  # top half red: orientation applied
    r, g, b = rgb.getpixel((128, 220))
    assert b > 150 and r < 100  # bottom half blue


def test_animated_webp_keeps_only_the_first_frame():
    first = _solid((64, 64), (220, 20, 20))
    second = _solid((64, 64), (20, 20, 220))
    buf = io.BytesIO()
    first.save(buf, format="WEBP", save_all=True, append_images=[second], duration=100, loop=0)
    out = process(buf.getvalue())
    img = Image.open(io.BytesIO(out))
    assert getattr(img, "n_frames", 1) == 1
    r, g, b = img.convert("RGB").getpixel((128, 128))
    assert r > 180 and b < 80


@pytest.mark.parametrize("data", [
    _encode(_solid((20, 20), (1, 2, 3)), "GIF"),
    _encode(_solid((20, 20), (1, 2, 3)), "BMP"),
    b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>",
    bytes(range(256)) * 4,
    _encode(_solid((64, 64), (1, 2, 3)), "PNG")[:-40],  # truncated PNG
    b"",
], ids=["gif", "bmp", "svg", "random", "truncated-png", "empty"])
def test_rejects_non_images_and_broken_files(data):
    with pytest.raises(AvatarError) as info:
        process(data)
    assert info.value.kind == "invalid_image"


def test_rejects_files_over_two_mib_before_decoding():
    data = _encode(_solid((64, 64), (1, 2, 3)), "PNG") + b"\x00" * (MAX_BYTES + 1)
    assert len(data) > MAX_BYTES
    with pytest.raises(AvatarError) as info:
        process(data)
    assert info.value.kind == "too_large"


def test_rejects_extreme_aspect_ratio():
    with pytest.raises(AvatarError) as info:
        process(_encode(_solid((9000, 10), (1, 2, 3)), "PNG"))
    assert info.value.kind == "invalid_image"


def test_rejects_decompression_bomb_before_loading_pixels():
    # Declares 6000 x 6000 (36 million pixels, over the 20 million limit) with no pixel data at all.
    bomb = _png_header_only(6000, 6000)
    started = time.monotonic()
    with pytest.raises(AvatarError) as info:
        process(bomb)
    assert time.monotonic() - started < 1.0
    assert info.value.kind == "invalid_image"


def test_error_message_carries_only_the_kind():
    with pytest.raises(AvatarError) as info:
        process(b"not an image at all")
    assert str(info.value) == "invalid_image"
