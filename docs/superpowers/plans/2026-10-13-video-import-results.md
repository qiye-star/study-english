# 跟读库 · 结果与核对(2026-10-13)

## S1 服务端数据与任务 · S0 核对(计划 2026-10-13-video-import-server-core.md Task 0)

- 日期 / 基于提交:2026-10-13 / bc3640a3
- alembic heads:0017 (head);本计划使用的迁移号:0018
- backups.py:只备份数据库(VACUUM INTO / pg_dump 提示),不含数据目录文件
- Starlette 版本(uv.lock):1.7.0;tests/test_library_range.py:9 passed
- 镜像体积(加 ffmpeg 前 / 后):未测(需要重建镜像,按仓库规则等用户要求)

# 跟读库 · 实测结果

## W1 网页库与播放器(计划 2026-10-13-video-import-web-library)

### L0 主包基线
- 提交:bc3640a3
- `node scripts/check-main-bundle.mjs --record`:未运行(本次执行者被禁止构建);基线仍是 2026-10-12 的 396.86 kB gzip(`web/scripts/main-bundle-baseline.json` 未改)。待办:有构建许可时在 W1 无代码的提交上重录,或在 L16 之前由后续执行者处理。
- S1 契约夹具(`server/tests/fixtures/library_contract.json`):不存在;L3 跳过,后续补。
- R-L1 核对:全部成立(Step 2 的 grep 全部命中;`CROSS_FEATURE_BASELINE.size` 为 18;`src/features/library` 尚不存在)。

### LA 外观设置的主包增量(R-L35)
- 构建与 `check-main-bundle.mjs --max-delta=1000` 未运行(本次执行者被禁止构建),基线未重录;主包增量待量(未验证)。目标测试 95 个用例通过,`yarn web:typecheck` 无错误。

### L16 合并前实测
(L16 填写)

### 未验证(W1)
(L16 填写)

## A 管理端 · 前置核对(计划 2026-10-13-video-import-admin.md Task A0)

- 日期 / 基于提交:2026-10-13 / 8fe55f2c
- alembic heads:0018 (head)
- LibraryItem 列:与 spec §4 一致(全部 29 列同名,`library_bytes` / `source_host` / `status` / `kind` / `user_id` / `created_at` 都在);add_item 是否调整:否(列的可空性与计划假设相符,add_item 显式给值即可)
- 删除函数:`app.library.store.delete_item(session, app, item) -> None`;自己提交:是(先在需要时 `cancel_item`,再删子行与条目并 commit,最后清文件与票据);取消运行中任务并清两个目录:是(经 `cancel_item` + `paths.remove_item_files`)。需要 `app.state.library`(worker)存在
- 取消函数:`app.library.store.cancel_item(session, app, item) -> bool`(False = 条目不是 uploading / queued / processing,未改动;自己提交);与学习者端点共用。计划假设它返回 None,实际返回 bool,`_s1_cancel` 据此处理
- 识别计数:scope=`library_asr` 全站 subject=`*`(常量:有,`app.library.limits.SCOPE_ASR` / `limits.GLOBAL`)
- worker:app.state.library.pending 存在(`set[asyncio.Task]`)
- QUOTA_KEYS 含 library_quota_mb / library_max_items:是
- 设置字段与属性(含 D8 的四个 AI 设置与 library_ai_available):齐全(`library_ai_available` = library_enabled 且 library_ai_enabled 且配了 LLM 上游);另有 `library_asr_minutes_daily_per_user`、`library_imports_daily_per_user`
- AI 额度计数:译文 scope=`library_translate` 分析 scope=`library_analysis`,**只有每人行**(subject=用户 id);全站行 subject=`*` 只存在于合计 scope `library_ai`(译文 + 分析的句数之和,`limits.SCOPE_AI_GLOBAL`)。常量:有(`limits.SCOPE_TRANSLATE` / `SCOPE_ANALYSIS` / `SCOPE_AI_GLOBAL` / `GLOBAL`)。`_day_total` 的 `max(全站行, 每人行之和)` 在这里等于每人行之和(译文 / 分析各自没有全站行),满足「分别显示两个数字」
- LibrarySegment 列:与 spec §4 一致;add_item 的 segments 分支是否调整:否
- test_architecture 中 admin 可导入 library:是
- main.py 锚点:`# --- anchor for plan A (2026-10-13-video-import-admin): `admin_library,` goes on the next line (before stubs) ---`,在路由元组里 `admin_agents,` 之后、`stubs` 之前;`from app.routers import (...)` 的导入处按 R-A16 后备放在 `admin_agents` 之后
- 本机 ffmpeg:有(ffmpeg version 9.0-full_build-www.gyan.dev);ffprobe 有;yt-dlp:未安装(`PackageNotFoundError`)
- 结论:可以开始 AS1
