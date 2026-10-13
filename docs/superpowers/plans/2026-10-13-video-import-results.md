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

## W2 网页跟读与评测(plans/2026-10-13-video-import-web-shadow.md)

### 预检(Task 0,2026-10-13)
本次基底只含 W1(分支 feat/library-web,最新提交 64e298c1),**不含 S1 服务端库代码**,涉及服务端的项标 PENDING。

| 项 | 结果 |
|---|---|
| S1 / W1 已合并 | W1:64e298c1(底部标签、懒加载路由)及其前序;S1:PENDING(`server/app/routers/library.py`、`server/tests/fixtures/library_contract.json` 不在基底) |
| ShadowPanel / SegmentText props(W1 ↔ W2) | `ShadowPanelProps` = R-SH02 原文(itemId、segment、active、durationMs、prevEndMs、nextStartMs、player、onSegmentSaved),`SegmentTextProps` = { segment, active },一致;无缺项;`LibrarySegment` 来自 `./library-api`(含可选 zh/zhLang/analysis/analysisLang),`PlayerHandle` 来自 `./use-media-player` |
| 「译」开关怎么传给 ShadowPanel | **不传**。W1 在 `player-page.tsx` 里自己调 `useTranslations`(W1 在 `use-translations.ts` 放了 W2 接缝:`UseTranslationsArgs` / `TranslationsState`,`translate`/`pending`/`notice`),`segment-list.tsx` 只渲染 `segment.zh` 与骨架。所以 ShadowPanel 不需要 `translate` prop;Task 10 的实现要替换 W1 的 `use-translations.ts`(保持其导出),Task 12 不渲染 `useRowTranslation`(见缺口) |
| onSegmentSaved 是否函数式更新 | 是(`setSegments((list) => list.map(...))`,player-page.tsx:140) |
| 效果组件 | `./fx` 已导出 ClickSpark、CountUp、GradientText、BlurText、GlassSurface(`fx/index.ts`),五个都转出 W1,无本地后备(签名在 Task 4 逐个核对) |
| useLibraryConfig 的 ai 字段 | 有(`LibraryConfig.ai: boolean`) |
| locales 子树结构 | `{"web":{"library":{…,"shadow":{…}}}}`,`locales.ts` 在模块求值时 `addResourceBundle`;W1 已预置一个小的 `shadow` 子树(record、stop、assessing、listenMine… 共 19 键),Task 2 整棵替换 |
| 改句 / 记成绩 / 译文 / 分析的错误文本与状态码 | PENDING(无服务端代码)。W1 的 `library-api.ts` 假设 429 = 额度满(`isAiLimited`);Task 2 的 `SHADOW_SERVER_ERRORS` 先用计划假设的键 |
| 契约夹具键名 | PENDING(夹具不在基底);`attempts-contract.test.ts` 以「夹具缺失则 skipIf」写 |
| speech SOURCES / practice_items Literal 含 library | **否**(基底里 `SOURCES = ("practice", "chat")`、`Literal["chat","lookup","grammar","manual"]`);服务端由 S1 加,PENDING |
| 跨 feature 基线 | N = 18 → Task 5 改为 19;库此前未导入 practice(grep 无命中) |

### W2 缺口(交 Z)
- 重复:W1 的 `library-api.ts` 已有 `translateSegments`、`analyzeSegment`、`isAiLimited`、`MAX_TRANSLATE_BATCH`;计划 R-SH29 要求 W2 在 `attempts-api.ts` 里另写一份(W2 不依赖 W1 未承诺的导出名),记为「重复,Z 去重」。
- 译文接线与计划假设不同:译文开关与批量取译文由 W1 的 `player-page.tsx` + `use-translations.ts` 接缝承担,ShadowPanel 无 `translate` prop。
- `web/src/features/library/CLAUDE.md` 不在基底(任务说明说 W1 写了,实际没有);未创建。
- S1 相关(错误文本、夹具键名、`source=library`)全部 PENDING,待服务端合并后复核。

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

### S2 · Task 1–8 结果(无网络执行者)

| 项 | 结果 |
|---|---|
| 锁定的 yt-dlp 版本 | **未锁定**:`server/pyproject.toml` 已加 `"yt-dlp[default]>=2025.11.12"`,但 `uv.lock` 没有重新生成(离线:`uv add --offline` 报本机 uv 缓存里只有 < 2025.11.12 的 yt-dlp,解析失败)。需要在有网络的检出里运行 `cd server && uv lock && uv sync`,并核对 `git diff --stat` 只有依赖行 |
| Task 6(JS 运行时) | 未做:取决于 T0.2(PENDING)。既没有走分支 A / B / C 的结论,也没有提交 |
| 测试 | `tests/test_library_ytdlp.py` + `tests/test_library_urlcheck.py`:171 passed、3 skipped(三个 skip 都是需要已安装的 yt-dlp:依赖已安装、版本一致、`media_runner` 跑真实 `--version`);`tests/test_architecture.py` + 全部 `tests/test_library_*.py`:598 passed、3 skipped |
| `media_runner` 适配 | 用 `python -I -c print(...)` 对真实 S1 `media.run` 跑过一次(带回调 stdout 为空、回调拿到各行;不带回调 stdout 有内容):A-3 成立。没有跑真实 yt-dlp |

**未验证清单 → 已做 / 未做**

| 项 | 状态 |
|---|---|
| yt-dlp 真实参数语法、`--use-extractors`、`yt-dlp-ejs` | 未做(T0.1 需要联网) |
| YouTube 是否需要 JS 运行时、`deno` 轮子 | 未做(T0.2) |
| yt-dlp 是否读 `HTTP(S)_PROXY` 环境变量 | 未做(T0.2) |
| `CLASSIFY` 对真实错误文案 | 未做(只用计划里写的样例文案) |
| 目标服务器 / 机房 IP 能否下载 | 未做(T0.3) |
| 镜像体积增量 | 未做(Z) |
| SSRF 剩余风险(DNS 重绑、站点重定向) | 如实保留:默认关 generic 是唯一缓解 |
| Postgres | 未做:路由与端到端用例只在 SQLite 上跑 |
| S1 接口 A-1 至 A-9 | 已做:对合并后的真实代码核对一致(见 Task 0b 表) |
| `max-filesize` 真实文案与 stdout 逐行到达 | 未做(T0.2 (e));假进程只证明了代码路径 |
| 取消时真实子进程被终止 | 未做(只有假进程测过) |

**与计划不一致之处(偏离)**

1. `uv.lock` 未更新(见上),所以 Task 1 的依赖测试拆成两个:`test_ytdlp_is_a_declared_dependency`(读 `pyproject.toml`,始终运行)与 `test_ytdlp_dependency_is_installed`(yt-dlp 未安装时 skip)。Task 3 的 `test_installed_version_matches_the_dependency` 与 Task 4 的 `test_media_runner_runs_the_real_yt_dlp` 同样加了 skipif。
2. Task 5 测试:详情接口返回 `{"item": ..., "segments": ...}`,所以断言改为 `.json()["item"]["error_kind"]`;`app.routes` 在本仓库的 FastAPI 里不展开 `include_router` 的路由,`test_the_import_route_carries_no_text_in_its_url` 改用 `app.openapi()["paths"]`(S1 的隐私测试同样做法)。
3. S1 的 `tests/test_library_worker.py::test_links_fail_until_plan_s2_registers_a_fetch_stage` 断言默认取回阶段为 `NoFetch`;`create_app` 现在注册 `YtDlpFetch`,它会红。最小修复:该用例开头显式 `set_fetch_stage(pipeline.NoFetch())`(改了 S1 的测试文件一行,计划没预料到)。S1 所有者应知悉。
4. 没有运行任何联网步骤;`classify` 对真实文案的核对待补。

**交接**(文末「交接」一节的待办,均尚未被对方落地)

- W1:`POST /api/library/imports` 的线上行为与 `Invalid link` / `Link import is disabled` 两条错误文案(见计划「交接」给 W1 一节)。
- S1 所有者:`app/library/CLAUDE.md` 增加 `urlcheck.py` / `ytdlp.py` 两条;`routers/CLAUDE.md` 增加 `library_import`;`server/README.md` 链接导入一节(升级流程、cookies 小号、机房 IP、DRM、SSRF 剩余风险);`test_library_privacy.py` 已有 `LATER`;`tests/test_library_worker.py` 的一行改动(偏离 3)。
- A:`from app.library.ytdlp import installed_version`。
- Z:镜像体积、T0.3 真实导入、**重新生成 `uv.lock`**、Task 6 的 JS 运行时决定(依赖 T0.2)。
