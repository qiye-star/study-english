# 精选库 · 视频素材保留画面 — 结果

计划:`2026-10-15-catalog-keep-video.md` · 分支 `feat/w2-ks` · 日期 2026-10-15 · ffmpeg/ffprobe 9.0-full_build-www.gyan.dev(本机)

## Task 0 闸门(R-KV11)
- alembic head 仍是 `0022`;`audio_only`(catalog_import)、`kind="audio"`(catalog_store)、网页 `detail.kind === "video"` 各一处,与计划一致。
- `tests/test_library_catalog_video.py`:1 passed(副本音频可解码、Range 206、时长 6 s 内)、1 xfailed(视频副本仍是音频,符合预期)。
  `tests/test_library_catalog_media.py tests/test_library_range.py`:17 passed。
- 结论:**没有独立的播放 bug**,问题只是「目录只存音频」的设计;无需先修。

## 已做 / 偏差 / 未验证
(各任务追加)
