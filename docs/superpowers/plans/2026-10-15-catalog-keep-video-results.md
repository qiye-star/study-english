# 精选库 · 视频素材保留画面 — 结果

计划:`2026-10-15-catalog-keep-video.md` · 分支 `feat/w2-ks` · 日期 2026-10-15 · ffmpeg/ffprobe 9.0-full_build-www.gyan.dev(本机)

## Task 0 闸门(R-KV11)
- alembic head 仍是 `0022`;`audio_only`(catalog_import)、`kind="audio"`(catalog_store)、网页 `detail.kind === "video"` 各一处,与计划一致。
- `tests/test_library_catalog_video.py`:1 passed(副本音频可解码、Range 206、时长 6 s 内)、1 xfailed(视频副本仍是音频,符合预期)。
  `tests/test_library_catalog_media.py tests/test_library_range.py`:17 passed。
- 结论:**没有独立的播放 bug**,问题只是「目录只存音频」的设计;无需先修。

## 已做 / 偏差 / 未验证
(各任务追加)

### 已做(车道 S,提交主题)
- Task 0 `test(server): reproduce catalog copies losing the video picture`
- Task 1 `feat(server): optional bitrate cap for the media normalizer`
- Task 2 `feat(server): catalog kind from the media mime; copies take it and can follow the catalog`
- Task 3 `feat(server): keep the picture of video sources in the curated catalog`
- Task 4 `feat(server): replace a catalog item's media and move its copies`
- Task 5 `test(server): real ffmpeg check for catalog videos and media replacement`(`test_library_catalog_video.py` 3 passed)
- Task 6 `docs: catalog keeps the video picture`

### 裁定与偏差
- 站长批准:720p / 1600 kbps、无迁移、本轮无用户侧「视频」徽标、替换媒体仅上传且须先下架。
- Task 1:计划里的 3000 kbps 测试源实际只有约 100 kbps(x264 不会为 testsrc 浪费码率),会静默走复制分支;改为 CBR 填充的 6000 kbps(约 5.8 Mbit/s)源,并在测试里断言源码率 > 3000 kbps。
- Task 4:`tests/test_admin_catalog.py::test_catalog_admin_urls_carry_only_ids` 的路由清单加了 `replace-media`(新路由必须登记,不属于计划文件表,最小改动)。
- Task 4:隐私断言只扫应用自己的日志记录(排除 `httpx` 记录):测试客户端的 httpx 日志会打印测试自己请求的票据 URL,不是服务端日志。
- Task 3 产物核对(用与任务相同的 ffmpeg 参数在本机复现 6 s、320x240 的 mpeg4 源,不是存储估算):源 167274 字节,`+faststart` 重编码产物 119113 字节,时长 6.0 s。

### 未验证
- 存储估算(R-KV2)、真实素材的转码耗时与体积:待站长第一次真实导入后记下 `media_bytes` / `duration_ms`。
- 浏览器里真实播放(`<video>` + iOS Safari Range / faststart)、管理端 UI(车道 A、W 未做)。
- 可选的人工本机全栈核对(Task 0 Step 4)未做。
- 取消发生在新文件移入目录之后、写库之前的极端时序:只可能留下一个无人引用的文件(下次替换会覆盖同名文件或随目录回收)。
