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

## S2 链接导入(spike S2,计划 2026-10-13-video-import-server-import)

本节由无网络的执行者写成:T0.1 只联网到 PyPI、T0.2 访问 YouTube、T0.3 要目标服务器,**全部没有做**,一律 PENDING(不编造任何数字)。

| 项 | 结果 | 状态 |
|---|---|---|
| 锁定的 yt-dlp 版本 | 未锁定(见 Task 1 记录) | PENDING(T0.1) |
| `[default]` 是否带 `yt-dlp-ejs` | 未验证 | PENDING(T0.1) |
| 参数全部存在(`--use-extractors` 等) | 未验证 | PENDING(T0.1) |
| `--use-extractors "default,-generic"` 对通用 URL | 未验证 | PENDING(T0.1) |
| 开发机:不给 JS 运行时能否下载 YouTube | 未测(禁止联网) | PENDING(T0.2) |
| 开发机:有 deno 轮子时 | 未测 | PENDING(T0.2) |
| yt-dlp 读环境代理 | 未验证 | PENDING(T0.2) |
| 进度行格式 | 未验证 | PENDING(T0.2) |
| `--max-filesize 1K`:退出码 / 是否产生文件 / stdout 有无 `max-filesize` 行 | 未测 | PENDING(T0.2 (e)) |
| `classify` 对真实错误文本 | 未测 | PENDING(T0.2) |
| 目标服务器真实导入 | 未做(需要用户重建容器) | PENDING(T0.3) |

结论:Task 6 无法按 spike 结果三选一;因 T0.2 PENDING,本次不做 Task 6(见后续记录)。
