# app/library/

跟读库(spec `docs/superpowers/specs/2026-10-13-video-import-design.md`;计划 `docs/superpowers/plans/2026-10-13-video-import-server-core.md`)。
每个用户一个私有库:上传音视频(可附 SRT / VTT)或链接导入(计划 S2),由进程内 worker 处理成规范化媒体 + 带时间的句子,
网页逐句跟读。Off unless `LIBRARY_ENABLED`(`/api/library/*` 除 `config` 外 404);处理媒体还需要 ffmpeg / ffprobe。

## What lives here
- `errors.py` – `KINDS`(可入库的 `error_kind`,spec §6.6)、`ADMIT`(新建被拒的原因码)、`LibraryError`、`Aborted`、
  `API_ERRORS` / `api_error` / `http_error`(接口的固定英文错误串,契约夹具录给网页)
- `paths.py` – 文件布局 `library/<uid>/<id>/`、`library/_tmp/<id>/`,id 形状校验与路径逃逸检查,删除助手
- `limits.py` – 代码常量(分片 8 MiB、票据 30 分钟、识别块 15–50 s ……)、`reserve` / `release`(按量的每日计数)、
  `used_bytes`、`admit_new_item` / `refund_new_item`(上传与链接共用的准入)
- `subtitles.py` – SRT / WebVTT 解析与清洗(纯函数)
- `segment.py` – 「带时间的片段 → 句子」:`align`(包装 `speech.sentence_split.split_all`,不改它)+ `finish`(长句断开、短句合并、不重叠)
- `asr_chunks.py` – B 档转写:静音表解析、静音感知分块、句边界吸附、`chunks.json` 断点、逐块调度
- `media.py` – 子进程 `run`(不经 shell、环境变量白名单、超时 / 取消终止)与 `Ffmpeg`(探测、规范化、封面、识别用 WAV)
- `tickets.py` – 媒体票据 `MediaTicketStore`(进程内,30 分钟,≤ 1000 张)
- `store.py` – 数据库读写、输出形状 `item_out` / `segment_out`、队列认领 / 恢复 / 失败、清扫查询、跟读成绩;
  `cancel_item` / `delete_item`(路由与管理端共用)
- `ai.py` – D8 / E11 / E12:每句译文(批量,≤ 20 句一次调用)与单句分析;额度按句计(`limits.reserve_ai`);提示词
  `library.translate` / `library.analyze`(管理端可编辑,默认值取自桌面端 enjoy);大模型只经 `providers/llm.complete`
- `pipeline.py` – 一个条目的流水线;取回阶段接口 `FetchRequest` / `FetchResult` / `FetchStage`(默认 `NoFetch`,S2 注册 yt-dlp)
- `worker.py` – `LibraryWorker`(`app.state.library`):轮询循环、认领、重试退避、取消、清扫、关停;`install(app)`

## Allowed dependencies
`app.core`、`app.models`、`app.providers`、`app.speech`、`app.services`。只有 `admin`、`routers` 与 `main.py` 导入本包
(`tests/test_architecture.py::test_library_layer_rules`)。

## Wiring
`main.create_app` 调 `worker.install(app)`;lifespan 起 `tasks["library"] = app.state.library.loop()`,关停时
`app.state.library.shutdown()`。路由 `routers/library.py`;链接导入 `routers/library_import.py`(计划 S2,在锚点处注册
`set_fetch_stage`);管理端 `admin/library_admin.py`(计划 A,经 `store.cancel_item` / `store.delete_item`)。

## Tests
`uv run pytest -q tests/test_library_*.py tests/test_architecture.py`
助手:`tests/library_helpers.py`(`enable`、`library_settings`、`fake_media`、`FakeTools`、`FakeAsr`、`use_fakes`、`upload`、`process`)。
AI:`tests/test_library_ai.py`(纯函数、额度、编排、管理端提示词)、`tests/test_library_ai_api.py`(接口,respx 假上游)。
契约:`tests/fixtures/library_contract.json`(`CONTRACT_UPDATE=1` 重录;网页 `library-contract.test.ts` 逐键核对)。

## Pitfalls
- 日志、错误、审计、计量里永远没有标题、文件名、URL、字幕 / 转写文字、ffmpeg / yt-dlp 的输出、cookies、代理、票据;
  只记条目 id、阶段、`error_kind`、退出码、字节数、毫秒数、块数(`tests/test_library_privacy.py`;新路由要加进它的清单)。
- 子进程一律经 `media.run`:不经 shell、`safe_env`(绝不继承 `UPSTREAM_*` / `*_KEY` / `ADMIN_*` / `DATABASE_URL`)、stderr 只分类不记录。
- worker 的任务在 `pending` 里(`tests/background.py` 等它);循环不在。测试不起循环,用 `run_once()` + `drain_background`。
- 每个任务都 `metering.bind_user(所有者)` + `feature_scope("library")`;识别只经 `speech.asr.make_transcriber`(带 `shared_asr_gate`)。
- D8:句子文字、译文、分析、提示词正文永不进日志(`tests/test_library_privacy.py` 的 AI 用例);译文 / 分析写回带「旧文本」
  保护(`store.set_translations` / `set_analysis`),`PATCH segments` 改字 `clear_ai`;计量 feature 名 ≤ 16 字符(`lib_translate` /
  `lib_analysis`);额度 scope `library_translate` / `library_analysis` / `library_ai`(按句)。
- 进度写库发现条目已不在 `processing` 就停(`Aborted`);新的写库点照做,别在取消之后写行或文件。
- SQLite 没有外键级联:删条目用 `store.delete_item`,删用户在 `admin/users_admin.py`(segments 按条目删)。
- 原始上传 / 下载不保留;成品与 `_tmp` 在同一数据卷(`os.replace`)。媒体不进备份(`admin/backups.py` 只备份数据库)。
- 单 worker 前提:票据、分片锁、运行中的任务都在进程内。
