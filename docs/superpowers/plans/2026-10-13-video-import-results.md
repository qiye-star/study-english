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

### 预检复核(Task 8 起,基底已含 S1 服务端与录制的契约夹具,2026-10-13)
| 原 PENDING 项 | 复核结果(对真实 `server/app/routers/library.py`、`server/app/library/errors.py`、`server/tests/fixtures/library_contract.json`) |
|---|---|
| 改句 / 记成绩 / 分析的错误文本 | 真实文本:`Not Found`、`Sentence not found`、`Invalid sentence times`、`Invalid sentence text`、`Item is not ready`、`No changes`、`Assessment does not match`、`AI is disabled`(404)、`Daily analysis limit reached` / `Daily AI limit reached`(429)、`AI is unavailable`(503)、`Unsupported language`。`SHADOW_SERVER_ERRORS` 以 W1 的 `LIBRARY_SERVER_ERRORS` 为底,只把前四条换成本车道的文案键;契约用例逐条核对键存在于两种语言 |
| 429 / 404 语义 | 429 = 额度满(`ai_user_cap` / `ai_global_cap`,译文端点以 `limited: true` 表示);404 = AI 未开启(`ai_disabled`);失败 503。批处理器与分析卡按状态码处理,不靠文本 |
| 契约夹具键 | `attempts`(`{attempts:[{seg_idx,best_score,count,last_at}]}`)、`attempt_post`(`{seg_idx,score}`)、`segment_patch`(`{segment:{idx,start_ms,end_ms,text,zh,zh_lang,has_analysis,analysis_lang}}`)、`translate`(`{segments:[{idx,zh}],limited}`)、`analysis`(`{analysis,cached}`)、`item_detail_with_ai`(句子带 `has_analysis` 布尔,**没有**分析正文)。`attempts-contract.test.ts` 不再跳过 |
| `source=library` | `speech.py` 的 `SOURCES` 与 `practice_items.py` 的 `Literal` 均已含 `library` |
| 句子里的分析 | 详情只给 `has_analysis`;分析卡在要显示时 POST `…/segments/{idx}/analysis` 取正文(服务端已缓存的返回 `cached: true`,不计额度、不动画) |

### 自动化测试(Task 8–12,2026-10-13)
- 最后一次 `yarn vitest run src/features/library src/features/practice src/architecture.test.ts`:64 个文件通过,414 个用例通过,1 个跳过(W1 `library-contract.test.ts` 的 `import` 用例,等 S2 录制);`tsc --noEmit -p .` 无错误。
- 各任务目标测试(首次观察到失败后才实现,Task 10 / 12 的失败是「模块 / 导出不存在」):segment-editor 9、analysis-card 9、use-translations 19(批处理器 11 + 钩子 8)、segment-menu 10、shadow-panel 13 + shadow-theme 5;`architecture.test.ts` 11 通过(基线 19,不变)。
- 译文接线:W1 的 `player-page.tsx` 调 `useTranslations`;W2 替换了 `use-translations.ts` 的内容并保持导出(`useTranslations`、`UseTranslationsArgs`、`TranslationsState`),`ShadowPanel` 没有 `translate` prop、没有行级译文钩子。
- 全量 `yarn web:test`、`yarn web:build`、主包体积、E2E:**未跑**。

### 偏离(Part 2)
| 项 | 偏离与理由 |
|---|---|
| 删除 `attempts-api.ts` 里的 `translateSegments` / `analyzeSegment`(裁定 2) | 复用 W1 `library-api.ts` 的同名函数;`SegmentWithAi` 改为带 `hasAnalysis`;`patchSegment` 解 `{segment}` 并带回 D8 字段;`attempts-api.test.ts` 删去对应用例、`attempts-contract.test.ts` 改读真实夹具键 |
| 分析卡取正文(裁定 1) | 原计划读 `segment.analysis`;改为 `hasAnalysis` 时 POST 取正文。分析卡对空文本报错(W1 的 `analyzeSegment` 不检查);W1 的 `analyzeSegment` 没有计划里的 120 s 超时(用默认 60 s),大模型很慢时可能提前超时,记给 Z |
| `use-translations.ts` 重写(裁定 3) | 不再是行级哨兵 + `IntersectionObserver` + toast:按 W1 接缝(`segments` / `anchorIdx` / `onTranslated` / `pending` / `notice` / `retry`)取锚点前后各 10 句(E12 的字面做法,取代 R-SH27 的 800 px 近似);一批结果一次交回(W1 的 `mergeTranslations` 是函数式的);提示由 W1 渲染(`web.library.player.translate*`),所以 `web.library.shadow.translateLimited / translateFailed` 两个键现在没有使用者 |
| `shadow-panel.tsx` | 非当前句返回 `null`(不再有哨兵 div);没有 `translate` prop;`SegmentText` 在查词容器外多放一份 sr-only 整句文字、逐词的 `<p>` 设为 `aria-hidden`:W1 的 `segment-list.test.tsx` / `player-page.test.tsx` 按整句文字找元素,逐词 span 会让它们失败,而计划禁止改 W1 的测试;容器外所以查词上下文不重复 |
| `shadow-fx.tsx`(裁定 4) | 保留本地无模糊的 `GlassSurface`,其余四个转出 W1 |

### 未验证(Part 2)
- 点词后选区与操作条(iOS)、剪贴板与回退选中、录音与音频路由、评分卡 / 分析卡 / 火花的动画与深浅色外观:均未在真机或浏览器里看过(没有视觉检查);`/code-review` 评审波未跑。
- 真实服务端的译文 / 分析 / 成绩记录只有契约夹具,没有真上游运行。
- `web/src/features/library/CLAUDE.md` 在本分支基底里不存在(裁定 5 说主线已有),未创建也未更新,合并后由 Z 补 W2 一节。

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

## B 句边界根治 · Task 0 识别服务时间戳验证(plans/2026-10-13-library-alignment.md)

- 日期 / 基于提交:2026-10-14 / fe9ca8da(探针脚本提交;运行用的容器是该日已部署的镜像,脚本经 `docker compose cp` 拷入,未重建、未重启)
- 识别路径:`UPSTREAM_ASR_MODE=volc_stream`,`asr_stream_url` 的路径末段 `bigmodel_nostream`;`UPSTREAM_WHISPER_MODE=chat`
- 素材:A = 已导入库视频开头 60 s(持续背景音乐;人声约从 27 s 起);B = 同一视频中段(400 s 起)60 s 人声(只写时长,不写标题与内容)。两段都用容器内 ffmpeg 切成 16 kHz 单声道 mp3 后由脚本再解成 WAV 发送,每段一次识别请求;用毕已从容器删除。

### 素材 A-music(音频 60.0 s)

- 火山流式:响应帧 301,错误码 None,耗时 8.5 s;中间帧带 utterances 的 60 帧
- 最终帧顶层字段:audio_info, result
- result 字段:additions, text, utterances;result.text 字符数 599
- `utterances`:有
- 条数 6;单位猜测 `ms`;起点单调 True;重叠 0;倒置或负值 0;首条起点 27360.0,末条终点 59890.0
- 每条的字段:additions, definite, end_time, start_time, text, words;words 字段:end_time, start_time, text
- 逐条(序号:起点 – 终点 / 字符数 / definite):0:27360.0 – 32240.0 / 71 / True;1:32560.0 – 46120.0 / 248 / True;2:46120.0 – 47840.0 / 41 / True;3:47890.0 – 50690.0 / 68 / True;4:51050.0 – 55250.0 / 82 / True;5:55690.0 – 59890.0 / 89 / True
- 边界误差:**未验证**(没有提供 --truth)
- Whisper:不适用(`UPSTREAM_WHISPER_MODE=chat`,脚本未发请求)

### 素材 B-clean(音频 60.0 s)

- 火山流式:响应帧 301,错误码 None,耗时 15.0 s;中间帧带 utterances 的 198 帧
- 最终帧顶层字段:audio_info, result
- result 字段:additions, text, utterances;result.text 字符数 490
- `utterances`:有
- 条数 6;单位猜测 `ms`;起点单调 True;重叠 0;倒置或负值 0;首条起点 0.0,末条终点 21770.0
- 每条的字段:additions, definite, end_time, start_time, text, words;words 字段:end_time, start_time, text
- 逐条(序号:起点 – 终点 / 字符数 / definite):0:0.0 – 1040.0 / 19 / True;1:1120.0 – 2640.0 / 51 / True;2:2800.0 – 7920.0 / 120 / True;3:8000.0 – 13560.0 / 138 / True;4:13720.0 – 20160.0 / 140 / True;5:20330.0 – 21770.0 / 22 / True
- 边界误差:**未验证**(没有提供 --truth)

### G0 结论
| 问题 | 结果 |
|---|---|
| `result.utterances` 是否存在、字段名 | 有(两段都在最终帧里);每条 `text, start_time, end_time, definite, words, additions`;`words[]` 有 `text, start_time, end_time`;`result` 另有 `additions` |
| 时间字段与单位 | `start_time` / `end_time`,ms(最大终点 59890 / 21770,不超过 60000 + 2000) |
| 基准 | 相对所发音频起点(A 首条起点 27360 与 27 s 才开口的背景音乐素材一致;B 首条起点 0) |
| 条数、单调、重叠、倒置 | A:6 / 单调 / 0 / 0;B:6 / 单调 / 0 / 0 |
| 与真实边界的误差 | 未验证(没有人工听出的 truth);只有侧面证据:A 的第一句人声起点 27.36 s,与 spec 的证据「开头 ~12 s 人声落在前 40 s」吻合,而旧估算会把它摊在 0 – 13 s |
| Whisper `verbose_json` `segments` | 不适用(chat 模式) |
| **G0** | **A**(可用,继续 T2…)。注意:B 中后 38 s 没有 utterance(A / B 都只有 6 条),T2 / T3 的 `usable_utterances` 须处理「块尾没有识别句」;A 的一条 248 字符 / 13.5 s 的句子很长,分句仍由 `segment.py` 负责 |

### B 句边界根治 · 完成情况与未验证(plans/2026-10-13-library-alignment.md)

- 日期 / 基于提交:2026-10-14 / cc482fb5(文档提交之前的最后一个功能提交);alembic head:0019;T5(Whisper 时间)与 T11(VAD)按 G0 = A 跳过
- 自动化(实际运行并通过):`test_asr_timing_probe` 13、`test_asr_stream_timed` 22、`test_asr_timed` 5、`test_library_asr_timed` 18、`test_library_quality` 13、`test_library_alignment` 8、`test_library_reprocess` 12、`test_library_contract` 1;服务端合并目标运行(全部 `test_library_*.py`、`test_admin_library.py`、`test_architecture.py`、`test_migrations.py`、三个 asr 计时文件)743 通过;网页 `src/features/library` + `architecture.test.ts` 58 个文件 374 通过 1 跳过,`tsc --noEmit` 干净。未跑:服务端全量、网页全量、构建、E2E。
- 持续背景音乐夹具:单元与流水线用例用已知时间证明「有真实时间时不再平摊」;`ffmpeg` 的 `sine` 夹具用例(没有 ffmpeg 会 skip;本机 ffmpeg 存在,已运行并通过)证明 `silencedetect` 在连续音上零静音

**未验证(按规矩写明,直到真环境 / 真机跑过):**

| 项 | 状态 |
|---|---|
| 火山 `result.utterances` 字段名 / 单位 / 相对块起点 / 是否出现在 `bigmodel_nostream` | 见本文档 Task 0 一节(2026-10-14 真实运行,G0 = A) |
| 真实素材上的边界误差(与人耳比) | 未验证(没有人工 truth 列表) |
| Whisper `verbose_json` 的 `segments` | 不适用(`UPSTREAM_WHISPER_MODE=chat`,T5 跳过) |
| 用户那条素材重新识别后前三句是否对上 | 未验证(需要用户在部署后点「重新识别」听) |
| `low_confidence` 的阈值(6 / 25 字符每秒、占比 40%)在真实素材上的误报率 | 未验证 |
| 迁移 `0019` 在 Postgres 上 | 未验证(只在 SQLite 上跑) |
| iOS Safari 上卡片 ⋯ 面板与确认对话框的先后关闭、「译」默认开时的请求量 | 未验证(jsdom 里先关面板再开对话框的用例通过) |
| 重新识别时并发 worker(`library_job_concurrency > 1`)与取消的竞争;并发双击 POST 的竞态 | 只有单 worker、顺序请求的测试 |
| 真实识别服务端到端的 `make_timed_transcriber`(只用假 websocket 与假转写器) | 未验证 |
