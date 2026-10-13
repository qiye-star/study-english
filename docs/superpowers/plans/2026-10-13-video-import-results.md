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

### S2 · Task 0b:假设的 S1 接口 → 真实名字(读合并后的代码核对,2026-10-13)

alembic heads:`0018 (head)`。名字与签名全部与计划一致,没有需要适配的地方;只有下面的细节差异。

| # | 真实位置与签名 | 与计划的差异 |
|---|---|---|
| A-1 | `app/library/errors.py`:`LibraryError(kind)`(种类不在 `ALL` / `ADMIT` 抛 `ValueError`)、`KINDS = ALL`、`ADMIT`、`Aborted`、`api_error(code)`、`http_error(err)` | 无 |
| A-2 | `app/library/pipeline.py`:`FetchRequest(item_id, user_id, url, tmp_dir, settings: Any, asr_available, report)`、`FetchResult(media_path, title=None, duration_ms=None, subtitle_path=None, subtitle_auto=False, source_host=None)`、`FetchStage`、`NoFetch`;字幕被移到 `platform.srt` | 无(`FetchResult` 后五个字段有默认值) |
| A-3 | `app/library/media.py`:`async run(cmd, *, timeout, env=None, cwd=None, on_stdout_line=None) -> RunResult(returncode, stdout: bytes, stderr: str, timed_out=False)`;带回调时 stdout 为空;`on_stdout_line` 同步或异步均可 | `env` 有默认值(`None` = `safe_env()`);我们总是显式传入 |
| A-4 | `app/library/worker.py`:`LibraryWorker.set_fetch_stage(stage)`、`fetch_stage` 属性、`wake()`;`install(app)` 在 `create_app` 里 | 无 |
| A-5 | `app/library/limits.py`:`admit_new_item(session, app, user_id, *, size_bytes=0, upload=False)`、`refund_new_item(session, app, user_id)`;读 `app.state.settings.library_available` | 无 |
| A-6 | `app/library/store.py`:`create_item(session, *, user_id, kind, source, status, title, source_url=None, source_host=None, upload_total=0)`、`item_out(row)`、`clean_title(raw, fallback="Untitled")` | 无 |
| A-7 | `app/models.py::LibraryItem` | 无 |
| A-8 | `app/core/config.py`:设置字段与属性 `library_available` / `library_link_available`;模块函数 `media_tools_present()` / `ytdlp_present()`(后者是 `importlib.util.find_spec("yt_dlp")`) | 无 |
| A-9 | `app/main.py` 第 103 行起两行锚点、路由元组里 `library,` 之后的锚点;`tests/test_library_privacy.py::LATER` 含 `("POST", "/api/library/imports")`;`tests/background.py` 登记 `library.pending`;`tests/library_helpers.py` 有 `enable` / `library_settings` / `fake_media` / `use_fakes` / `process` / `SRT` | 无 |

注:`.venv` 里没有安装 `yt_dlp`(Task 1 之前),所以 `ytdlp_present()` 现在为假。
