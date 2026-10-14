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
- `asr_chunks.py` – B 档转写:静音表解析、静音感知分块、句边界吸附、`chunks.json` 断点、逐块调度;`Chunk.utterances` /
  `usable_utterances` / `transcribe_chunks_timed`:识别服务给的真实句子时间优先(plan 2026-10-13-library-alignment),不可信的块逐块回落估算;
  `chunks.json` 版本 3(识别句带词 `[text, start_ms, end_ms]`,仍读 1、2);硬切处重叠(`plan_chunks(..., overlap_ms)`,只在有带时间的转写器时);
  `save_transcript` / `load_transcript`(条目目录里的 `transcript.json`)
- `quality.py` – 合理性检查(纯函数):字符速度 6–25 / 秒、估算块说话占比 ≥ 40%,结果写 `library_items.low_confidence`(阈值未用真实素材校准);v2:`sentence_flags`(rate / pause / timing / estimated / seam,按本条素材的分布)+ `item_low_confidence`(被标记 >= 15%)
- `timeline.py` – 词级时间线(纯函数):识别句文字的词元对齐到词(`word` / `interp`),不可信块回落 v1 估算(`est`),硬切重叠的接缝去重
  (plan 2026-10-14-library-alignment-v2)
- `wordseg.py` – 词元 → 句子:`split_all` 定文字,长停顿断句、超长断在最大间隔、短句只在 <= 700 ms 的间隔内合并、带上限的首尾余量
- `sentences.py` – 总入口 `build(chunks, silences)`:有词走词路径(每句标记 + v2 检查),否则 v1 原样;流水线与「重新分句」共用
- `media.py` – 子进程 `run`(不经 shell、环境变量白名单、超时 / 取消终止)与 `Ffmpeg`(探测、规范化、封面、识别用 WAV)
- `tickets.py` – 媒体票据 `MediaTicketStore`(进程内,30 分钟,≤ 1000 张)
- `store.py` – 数据库读写、输出形状 `item_out` / `segment_out`、队列认领 / 恢复 / 失败、清扫查询、跟读成绩;
  `cancel_item` / `delete_item`(路由与管理端共用);`fail` / `cancel_item` 对重新识别(`seg_count > 0`)回到 `ready`
- `ai.py` – D8 / E11 / E12:每句译文(批量,≤ 20 句一次调用)与单句分析;额度按句计(`limits.reserve_ai`);提示词
  `library.translate` / `library.analyze`(管理端可编辑,默认值取自桌面端 enjoy);大模型只经 `providers/llm.complete`
- `pipeline.py` – 一个条目的流水线(`PipelineDeps.timed_transcriber` 给带时间的转写);取回阶段接口 `FetchRequest` / `FetchResult` / `FetchStage`(默认 `NoFetch`,S2 注册 yt-dlp)
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
- 重新识别(`POST /items/{id}/reprocess`):`ready` 且 `sub_source=asr`;状态由 `seg_count > 0` 且 `queued/processing` 推出,**不要**在这种条目上直接删媒体;
  失败 / 取消回到 `ready`(失败保留 `error_kind`);旧句子到新句子写入前一直在,手动修改与译文会被替换。
- 识别服务返回的 `utterances[].text` / `words[].text` 与转写一样永不进日志;`chunks.json` 在 `_tmp`,条目 ready 时随目录清掉;
  最终的识别结果另存为条目目录里的 `transcript.json`(含转写文字:随条目 / 用户删除,换字幕时删除并清 `rebuildable`,不进备份,
  不计入 `library_bytes`)。
- `low_confidence` 只对 ASR 条目有意义,换字幕时清。
- 单 worker 前提:票据、分片锁、运行中的任务都在进程内。
- 重新分句(`POST /items/{id}/rebuild`):`ready` + `sub_source=asr` + `rebuildable`;不排队、不扣额度;文字没变的句子保留译文;
  每句标记 `library_segments.flags` 在手动改时间时清空。
- 链接预检(`urlcheck.precheck`):配置了 `LIBRARY_YTDLP_PROXY`(非空白)时 `resolve=False`——只做语法检查(协议 / 长度 / 字符 / userinfo / 端口 / 黑名单名与后缀 / 字面 IP),**不做本地 DNS 与解析地址检查**(代理在远端解析,本地解析器可能被污染);无代理时行为不变。路由 `library_import` 与取回阶段 `ytdlp.fetch` 的复查用同一规则。永远不记录代理值。
