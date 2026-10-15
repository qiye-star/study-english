"""精选库测试工具:直接写库造一条目录条目(含共享文件),不经过导入流水线(那是车道 SI 的事)。"""
from app.library import paths
from app.models import CatalogItem, CatalogSegment, utcnow

MEDIA = bytes(range(256)) * 16  # 4096 bytes: enough for Range tests
POSTER = b"\xff\xd8\xff\xe0fake-jpeg"
SEGMENTS = [(500, 3000, "Hello there, my friend.", "你好,我的朋友。"),
            (3200, 6000, "How are you doing today?", "你今天好吗?")]


def data_dir_of(app):
    return app.state.library.deps.data_dir


async def make_catalog(app, *, title: str = "Catalog talk", status: str = "ready", published: bool = True,
                       retired: bool = False, ai_lang: str = "zh-CN", segments=SEGMENTS, with_files: bool = True,
                       level: str | None = "B1", tags: str | None = "news,science", kind: str = "audio") -> str:
    name, mime = ("media.mp4", "video/mp4") if kind == "video" else ("media.m4a", "audio/mp4")
    now = utcnow()
    async with app.state.sessionmaker() as s:
        row = CatalogItem(title=title, source="upload", status=status, ai_lang=ai_lang, published=published,
                          published_at=now if published else None, retired_at=now if retired else None,
                          duration_ms=6000, media_mime=mime, sub_source="uploaded", level=level, tags=tags,
                          license_note="VOA Learning English · Public domain", created_at=now, updated_at=now)
        s.add(row)
        await s.flush()
        rel = paths.catalog_rel(row.id)
        if with_files:
            folder = paths.catalog_dir(data_dir_of(app), row.id)
            folder.mkdir(parents=True, exist_ok=True)
            (folder / name).write_bytes(MEDIA)
            (folder / "poster.jpg").write_bytes(POSTER)
        row.media_path, row.poster_path = f"{rel}/{name}", f"{rel}/poster.jpg"
        row.media_bytes = len(MEDIA) + len(POSTER)
        for i, (start, end, text, zh) in enumerate(segments):
            s.add(CatalogSegment(catalog_id=row.id, idx=i, start_ms=start, end_ms=end, text=text, zh=zh,
                                 zh_lang=ai_lang if zh else None))
        row.seg_count = len(segments)
        await s.commit()
        return row.id


def media_file(app, catalog_id: str, name: str = "media.m4a"):
    return paths.catalog_dir(data_dir_of(app), catalog_id) / name
