# 精选库 · 服务端导入与管理接口(车道 SI)· 结果

- 日期:2026-10-14 · 分支 `feat/curated-cl-imp` · 计划 `2026-10-14-curated-library-server-import.md`(Task 0–7)
- INDEX 的名字、路由、形状、签名**未改动**。核对过的 SC 接口(`catalog_store.*`、`paths.catalog_*`、`ai.translate_texts`、`metering`、三处锚点、`tests/background.py` 的 `catalog` 任务集)与 INDEX §7 一致。

## 已做

| 任务 | 提交主题 |
|---|---|
| 1 | `feat(server): mono 64 kbps audio-only transcode for the catalog` |
| 2 | `refactor(server): share chunked transcription helpers; system fetch requests` |
| 3 | `feat(server): curated catalog import pipeline (audio only, system-paid)` |
| 4 | `feat(server): catalog import job runner`(含 `main.py` 锚点 1、2) |
| 5 | `feat(server): admin catalog list, import, chunked upload, edit and publish`(含锚点 3) |
| 6 | `feat(server): admin catalog retry, cancel, translate, sentence edits, delete and purge` |
| 7 | `docs: admin catalog notes` |

测试(SQLite,仅定向):新文件 `test_library_catalog_import.py`(10)、`test_library_catalog_jobs.py`(7)、`test_admin_catalog.py`(14)共 31 条;
`test_library_catalog_*`、`test_library_{media,ytdlp,worker,privacy}`、`test_admin_{library,catalog,routes_guarded}`、`test_architecture`、`test_migrations` 共 252 条通过。

## 裁定与偏差(只动测试 / 助手,没有动 INDEX 接口)

1. 提交署名用 `Co-Authored-By: Claude Sonnet 5.5`(派发指令),不是计划里的 Opus 5.5。
2. **`tests/test_library_worker.py::test_fetch_interface_is_the_s2_contract`**(计划未列):`FetchRequest` 末尾新增 `system`,字段清单断言同步加 `"system"`。
3. **`tests/test_admin_library.py::test_admin_library_urls_carry_only_ids`**(计划未列):它列举 `/api/admin/library*` 的全部路径,新增 `…/catalog*` 后必然失败;改为排除 `…/catalog` 前缀,目录路由由 `test_admin_catalog.py::test_catalog_admin_urls_carry_only_ids` 另行钉住(新增的用例)。
4. **`test_nothing_runs_without_media_tools`**:本机真的装了 ffmpeg,计划里的「不调 `enable()`」不再等于「缺工具」;改为 monkeypatch `media_tools_present -> False`。
5. **`test_cancel_stops_a_running_job`**:计划的轮询「`cid in running` 就取消」会在任务还在 SQLite 查询中途取消它(tests/CLAUDE.md 记载的 StaticPool 陷阱,表现为 `no such table`);改为等 `Slow.probe` 被调用(`asyncio.Event`)后再取消。
6. `tests/test_admin_catalog.py` 额外加了「路径只含 id」与(计划已有的)日志 / 审计无内容用例;`main.py` 锚点注释的原文与 INDEX 略有出入(多了 `(before stubs)` 等),按位置填写。
7. 新建文件用 Write(LF),改旧文件保持 CRLF;Git 会提示 LF/CRLF 转换警告,无内容影响。
8. 没有走「先红后绿」的逐步截图:Task 1、2、4、5、6 的测试与实现同次写出后一并运行(Task 2 先暴露了上面第 2 条)。

## 未验证

- 真实 ffmpeg `audio_only` 的产物大小 / 速度(只测了命令参数与假工具);真实 yt-dlp 的系统取回,尤其大陆服务器 + `LIBRARY_YTDLP_PROXY`。
- 真实识别 / 大模型的导入质量与费用;Postgres 上的并发(`claim_next`、分片上传锁只在 SQLite 单连接下验证)。
- 管理端浏览器上传数百 MB 文件的耗时;未跑全量测试、E2E、容器重建。
