# 跟读库 · 服务端数据与任务(S1 server-core)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **执行前先读 spec §15「计划拆分、文件归属与合并顺序」。** 本计划是车道 **S1**,第一个合并;S2(链接导入)、A(管理端)、W1(网页库与播放器)都在本计划合并之后开始,并读本计划冻结的表结构、设置、接口与契约夹具。

**Goal:** 实现跟读库的服务端核心(spec §4–§6、§8–§10):迁移 `0018_library` 的三张表(`library_segments` 一并建 D8 的 `zh` / `zh_lang` / `analysis` / `analysis_lang` 四列);全部 20 个设置(含链接导入的 E7 与每句译文 / AI 分析的 D8)、两个配额键、计量前缀与 `.env.example`;`app/library/` 包——错误种类与固定错误文本、路径与常量、准入、SRT / WebVTT 解析、「带时间的片段 → 句子」分句器(包装共享切句器,复用 64 个共享夹具)、B 档无字幕转写(静音感知分块、句边界估算与吸附、`chunks.json` 断点、按秒预留与退还)、沙箱化的子进程与 ffmpeg 工具、媒体票据、数据库读写、处理流水线(取回阶段只留 `FetchStage` 接口,默认 `unsupported_site`)、进程内后台队列;`app/library/ai.py`(D8 / E11 / E12:批量译文、单句分析、按句计额度、提示词渲染,大模型只经 `providers/llm.py`)与两个可编辑提示词 `library.translate` / `library.analyze`;`/api/library/*` 的全部接口(配置〔含 `ai`〕、分片上传、条目、重试 / 取消、补传字幕、句子微调〔改字清译文与分析〕、每句译文 `translate`、单句分析 `analysis`、媒体票据 + 只认票据的 Range 媒体、封面、跟读成绩);评测与练习清单接受 `library` 来源;删用户删库;隐私测试与网页契约夹具;镜像装 ffmpeg;文档。

**Architecture:** 一个条目 = `library_items` 的一行,状态 / 阶段 / 进度 / 重试都挂在这一行上,不建任务表(E2)。上传走 8 MiB 分片(E3),完成后条目 `queued`;`app.state.library` 上唯一的 `LibraryWorker` 每 2 秒(或被 `wake()`)用条件 UPDATE 原子认领,最多 `LIBRARY_JOB_CONCURRENCY` 个任务并发,任务在 `pending` 集合里(`tests/background.py` 等它)。流水线每个阶段都以「产物在不在」为准,所以重试从断点继续;子进程只经 `media.run`(不经 shell、环境变量白名单、超时 / 取消终止、stderr 只分类)。字幕与识别结果走同一个分句器(E6)。播放:`POST media-ticket` 换进程内 30 分钟票据,`GET …/media?ticket=` 由 Starlette `FileResponse` 提供 Range(E4,S0 已钉住)。分层:`library -> core, models, providers, speech, services`,只有 `admin`、`routers`、`main.py` 导入它(测试不放宽,只为新层加规则)。

**Tech Stack:** Python 3.12(uv)、FastAPI 0.142 + Starlette 1.7.0、SQLAlchemy 2 async、alembic、pydantic v2、pytest + pytest-asyncio(auto);外部程序 ffmpeg / ffprobe(镜像里 apt 安装;测试用假的,装了的机器另跑真实用例)。**不新增 Python 依赖**(yt-dlp 由 S2 加)。

**Spec:** `docs/superpowers/specs/2026-10-13-video-import-design.md`(D1–D12、E1–E12;2026-10-13 修订版:**D8 / E11 / E12** 的每句译文与单句分析、§4 的 `zh` / `zh_lang` / `analysis` / `analysis_lang` 四列、§5.2 的四个 AI 设置、§9 的 `translate` / `analysis` 两个端点与 `config.ai`、§15 的 D8 增补都在本计划里;D9 / D11 / D12 / E9〔入口标签、玻璃与动效、应用外观开关〕是网页侧,服务端无改动,见 R-SC37;D10 的第二期清单不在任何本期计划;§16 的开放问题 1–5 按推荐默认值:两个开关与链接开关都默认关、容量默认值照表、接受 B 档估算精度、平台自动字幕只在识别不可用时用、不预配 cookies / 代理)。兄弟计划:`2026-10-13-video-import-server-import.md`(S2)、`-admin.md`(A)、`-web-library.md`(W1)、`-web-shadow.md`(W2);它们依赖的确切接口见文末「对外接口(冻结)」。结果文档:`docs/superpowers/plans/2026-10-13-video-import-results.md`(各车道**追加**自己的一节,不覆盖)。

## Global Constraints

- **合并顺序(spec §15):S1 →(S2 ‖ A 服务端 ‖ W1)→ W2 → A 网页 → Z。** 本计划内按 Task 0 → 0b → 1 → … → 11 → 11a → 11b → 12 → 13 → 14 → 15 合并;Task 0b 与 Task 15 是不改代码的 spike / 实测(需要真实上游,BLOCKED 时跳过并在结果文档写明,不阻塞其他任务)。
- **文件归属(spec §15 的 S1 行)。** 本计划独占:`server/alembic/versions/0018_library.py`、`server/app/models.py`(追加三张表)、`server/app/core/{config,settings_registry,quotas,metering}.py`、`server/.env.example`、`server/Dockerfile`、`server/app/library/`(本计划的 13 个模块〔含 D8 的 `ai.py`〕与 `CLAUDE.md`;S2 另加 `ytdlp.py`、`urlcheck.py`)、`server/app/routers/library.py`、`server/app/routers/speech.py` 与 `practice_items.py`(各一行)、`server/app/main.py`(lifespan、`install`、`library` 路由与给 S2 / A 的锚点注释)、`server/app/admin/users_admin.py`(删用户一处)、`server/tests/test_library_*.py`(S2 的 `test_library_ytdlp.py` / `test_library_urlcheck.py` 除外)、`server/tests/background.py`、`server/tests/test_architecture.py`、`server/tests/fixtures/library_contract.json`、`server/app/CLAUDE.md`、`server/app/routers/CLAUDE.md`、`server/README.md`(跟读库一节:隐私与代理)。**spec §15 没列、也没有别的车道拥有、但必须改的文件**(R-SC16、R-SC29):`server/tests/test_settings_registry.py`、`server/tests/test_migrations.py`、`server/tests/CLAUDE.md`,新助手 `server/tests/library_helpers.py`;D8 的提示词注册还要改 `server/app/services/prompts.py`(spec §15 已列)、`server/app/admin/prompts_admin.py`(`default_body` / `test_messages` 各加一个 `library.*` 分支)与两个枚举全部提示词键的测试 `server/tests/test_prompts.py`、`server/tests/test_prompts_api.py`。**不改** `app/speech/*`(R-SC4)、`app/admin/settings_service.py`、`app/admin/doctor.py`(A 车道)、`enjoy/`、`web/`、`admin/`。
- **迁移:`0018`,`down_revision = '0017'`。** Task 0 Step 1 先跑 `alembic heads`;若别的车道已占 `0018`,本计划顺延为下一个号,改迁移文件名 / `revision` / `down_revision` 与 Task 2 里所有 `"0018"` 字样,并在结果文档与 R-SC1 下写明。
- **隐私(spec §13):** 日志、错误、审计、计量、URL 里永不出现标题、文件名、URL、字幕与转写文字、ffmpeg / yt-dlp 的输出、cookies、代理、票据;只记条目 id、阶段、`error_kind`、退出码、字节数、毫秒数、块数。新增的 `caplog` 一律 `caplog.set_level(..., logger="app")`。票据值不进测试快照(契约夹具写 `REDACTED`)。
- **分层不放宽:** `tests/test_architecture.py` 只**新增**一层 `library` 与它的规则测试,不改任何已有层的允许集合以外的东西(`admin` / `routers` / `main` 的允许集合各追加 `library`,spec §3)。
- **工作树是 CRLF**(`core.autocrlf=true`,仓库里是 LF):改现有文件一律用 Edit 工具(old_string 按下文原文,行尾由工具处理),新文件用 Write。
- **测试口径:** 每个任务只跑它列出的测试与 `tests/test_architecture.py`;**不跑全量、不跑 E2E、不重建容器**(仓库规则:只在用户要求时)。需要 ffmpeg 的真实用例用 `skipif`,没装 ffmpeg 的机器上跳过,不算失败。
- **提交:** conventional(`feat(server): …`、`test(server): …`、`chore(server): …`、`docs: …`),一个任务一个提交,信息以 `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` 结尾;提交命令都给出。不要 `--no-verify`。
- **写计划时的实跑(如实):** 本计划的**全部代码与测试**(Task 0–14,含 2026-10-13 修订加的 D8 部分:T1 / T2 / T3 / T9 / T11 / T13 的就地修改与新增的 T11a / T11b)都在计划作者机器上真实运行过:把 `server/` 的 `HEAD` 复制到一个临时目录,用脚本按本计划的任务顺序**逐条执行文中的全部 Write / Edit**(每个 Edit 的 old_string 在当时的文件里恰好出现一次,脚本断言),再跑各任务列出的测试与受改动影响的套件(全量 `pytest` 没有跑完,见「验证矩阵」);用的是本仓库的 `server/.venv`(Python 3.12)与本机 ffmpeg 9.0(gyan.dev 构建),所以 `skipif` 的真实 ffmpeg 用例也跑过。契约夹具 JSON 是用 `CONTRACT_UPDATE=1` 在这个副本里录出来后原样贴进文中的。D8 部分的「先红后绿」是在开发时逐步观察到的(缺模块 / 缺路由 / 缺列时的失败),成稿后是**整份计划一次性重放**,不是每个任务重放一遍红绿;全量结果见文末「验证矩阵」。**没有运行过的**:Task 0b / Task 15(需要真实识别上游与真实素材)、Task 0 Step 4(镜像体积)、**真实大模型对 `N. 译文` 批量格式的遵守程度**(测试用 respx 假上游)、Postgres、真机 / 真实反向代理。执行者第一次运行时以真实结果为准;差异先弄清原因,不得改本计划的裁定与接口名迁就。


---

## 文件结构

```
server/
  alembic/versions/0018_library.py        新(T2)三张表 + 两个 items 索引 + attempts 索引;segments 带 D8 四列
  app/models.py                           [S1] 末尾追加 LibraryItem / LibrarySegment(含 zh / zh_lang / analysis / analysis_lang)/ LibraryAttempt(T2)
  app/core/config.py                      [S1] 20 个字段 + 4 个属性 + media_tools_present / ytdlp_present(T1)
  app/core/settings_registry.py           [S1] 组 ("library","跟读库") + 20 个 SettingSpec(T1)
  app/core/quotas.py                      [S1] QUOTA_KEYS + library_quota_mb、library_max_items(T1)
  app/core/metering.py                    [S1] FEATURE_PREFIXES + ("/api/library","library")(T1)
  .env.example                            [S1] 末尾「跟读库」一节(T1)
  app/library/__init__.py                 新(T3)
  app/library/errors.py                   新(T3)KINDS / ADMIT / LibraryError / Aborted / API_ERRORS / http_error
  app/library/paths.py                    新(T3)
  app/library/limits.py                   新(T3)常量、reserve / release、used_bytes、admit_new_item / refund_new_item;T11a 追加 AI 常量、reserve_upto / reserve_ai / refund_ai
  app/library/subtitles.py                新(T4)
  app/library/segment.py                  新(T5)
  app/library/asr_chunks.py               新(T6)
  app/library/tickets.py                  新(T7)
  app/library/media.py                    新(T8)
  app/library/store.py                    新(T9);T11 追加 cancel_item / delete_item;T11a 追加 segments_at / clear_ai / set_translations / set_analysis
  app/library/ai.py                       新(T11a)D8 译文与分析:提示词渲染、解析、额度、编排
  app/library/pipeline.py                 新(T10)FetchRequest / FetchResult / FetchStage / NoFetch / process
  app/library/worker.py                   新(T10)LibraryWorker / install
  app/library/CLAUDE.md                   新(T14)
  app/routers/library.py                  新(T11);T11b 追加 translate / analysis 两个端点与改字清空
  app/services/prompts.py                 [S1] PROMPTS 加 library.translate / library.analyze(T11a)
  app/admin/prompts_admin.py              [S1] default_body / test_messages 加 library.* 分支(T11a)
  app/routers/speech.py                   [S1] SOURCES + "library"(T11)
  app/routers/practice_items.py           [S1] source Literal + "library"(T11)
  app/main.py                             [S1] install + lifespan(T10);路由 + S2 / A 锚点(T11)
  app/admin/users_admin.py                [S1] 删用户的行(T2)与文件(T12)
  Dockerfile                              [S1] 最终阶段装 ffmpeg(T14)
  README.md、app/CLAUDE.md、app/routers/CLAUDE.md   [S1](T14)
  tests/test_library_range.py             新(T0)
  tests/test_library_settings.py          新(T1);tests/test_settings_registry.py 两个固定集合(T1)
  tests/test_library_models.py            新(T2);tests/test_migrations.py 五处 heads 断言(T2)
  tests/test_library_basics.py            新(T3);tests/test_architecture.py 新层与规则测试(T3)
  tests/test_library_{subtitles,segment,asr_chunks,tickets,media,store}.py   新(T4–T9)
  tests/library_helpers.py、tests/test_library_worker.py   新(T10);tests/background.py 一项(T10)
  tests/test_library_api.py、tests/test_library_media_api.py   新(T11)
  tests/test_library_ai.py                新(T11a);tests/test_prompts.py、tests/test_prompts_api.py 各一处枚举(T11a)
  tests/test_library_ai_api.py            新(T11b)
  tests/test_library_delete_user.py       新(T12)
  tests/test_library_privacy.py、tests/test_library_contract.py、tests/fixtures/library_contract.json   新(T13)
  tests/test_library_image.py             新(T14);tests/CLAUDE.md 两行(T14)
docs/superpowers/plans/2026-10-13-video-import-results.md   追加「S1」一节(T0、T0b、T15)
```

## 任务依赖与合并顺序

| 任务 | 依赖 | 说明 |
|---|---|---|
| T0 S0 spike | 无 | 核对迁移头、备份范围、Range(提交一个钉住框架行为的测试) |
| T0b S1 spike | 真实识别上游有余额 | **BLOCKED 时跳过**,不阻塞后续;A 档不在本计划(R-SC4) |
| T1 设置 | T0 | |
| T2 表与迁移 | T1 | |
| T3 包骨架 | T1、T2 | `admit_new_item` 读设置与表 |
| T4–T9 | T3(T5 依赖 T3 的常量;T6 依赖 T5;T8 依赖 T6) | 纯函数与工具,可以一个执行者串行做完 |
| T10 流水线与队列 | T4–T9 | |
| T11 接口 | T10 | |
| T11a D8 译文与分析的核心 | T1、T2、T3、T9(与 T11 互不依赖,可并行,但按序合并) | 提示词注册、额度、`ai.py` |
| T11b D8 接口 | T11、T11a | `translate` / `analysis` 端点、改字清空 |
| T12 删用户的文件 | T3、T11 | |
| T13 隐私与契约 | T11、T11b | 契约夹具供 W1 / W2 读取(含 `translate` / `analysis`) |
| T14 镜像与文档 | T1–T13 | |
| T15 B 档实测 | T14 合并 + 真实上游 + 带人工字幕的素材 | **BLOCKED 时跳过** |
| T16 译文格式实测 | T14 合并 + 真实大模型 + 40 句真实句子 | **BLOCKED 时跳过** |

**评审波:** T11b 合并前一次 `/code-review high`(T11 与 T11b 合起来是全部接口;重点:额度的预留 / 退还在每条失败路径上都对、写回的旧文本保护、提示词注入面),T13 之后一次 `security-review`(重点:子进程环境变量、路径逃逸、票据、URL 与日志里没有文字)。


---

## 本计划的裁定

> 格式:**裁定 / 为什么 / 代价**。spec 不改;「核对」项都是读真实代码得出的(依据写在每条里)。

- **R-SC1 迁移号 `0018`。** 核对:`server/alembic/versions/` 最新是 `0017_room_agents.py`(`down_revision = '0016'`),`2026-10-12-agents-addressing-server.md` R-AS1 明确不占 `0018`,本日其他计划(defs-default、ios-keyboard-scroll、lookup-dict)都没有迁移。`tests/test_migrations.py` 有五处 `get_heads() == ["0017"]`,必须同时改成 `"0018"`(先例:`0017` 的提交 `90a91855` 同样改了该文件)。*代价*:无。
- **R-SC2 备份只含数据库。** 核对 `server/app/admin/backups.py`:只有 SQLite `VACUUM INTO` 快照(Postgres 提示 `pg_dump`),不碰数据目录里的文件。媒体不进备份(可以重新导入),README 写明并建议自己备份数据卷的 `library/`。*代价*:恢复备份后库条目还在、媒体文件可能缺失——播放时 404,用户删除重导。
- **R-SC3 Range 用 Starlette 原生 `FileResponse`。** 核对 `server/.venv/.../starlette/responses.py`(1.7.0):单区间 206 + `Content-Range`、越界 416 + `bytes */size`、`If-Range` 比对 ETag / Last-Modified、畸形 400、多区间 `multipart/byteranges`;`tests/test_library_range.py` 钉住全部行为。spec §10「多区间一律返回整段或 416」是「自己实现时」的退路,框架的多区间响应是标准行为,**接受**。*代价*:升级 Starlette 时这组测试先红。
- **R-SC4 A 档(上游自带时间戳)不在本计划;`app/speech/*` 不改。** spec §6.4 第 6 步允许 S1 在 spike 通过后追加 `transcribe_timed`。但字段形状只有真实上游能确认,本仓库上游目前不可调用(计划写作时其他车道记录过 402),无法 test-first 地写解析代码;B 档(§6.4 第 1–5 步)是 spec 指定的生产路径。Task 0b 照做 spike 并记录结果;若通过,另写 `## Addendum (日期)` 追加 A 档任务(仍不改 `asr.py` 现有函数与测试)。*代价*:边界精度先停在 B 档的估算水平(界面有 ±0.2 s 微调与改字)。
- **R-SC5 字符位置 → 时间:片段内按字符比例线性插值。** 偏离 spec §6.3 第 3 步(「起点 = 包含首字符的片段的 start」)。为什么:一个字幕 cue 里常有两句,按 spec 原文两句会得到完全相同的起止,违反同节第 4 步「句与句不重叠」;插值在句首 / 句尾正好落在片段边界时与 spec 结果相同,§6.4 第 4 步的 B 档本来就是按字符比例映射。*代价*:cue 内的句边界是估算(与 B 档同一精度量级)。
- **R-SC6 共享夹具三组用例测 `segment.align`(后处理之前)。** 夹具里有 1–2 词的短句(如 `Nice!`),§6.3 第 4 步按设计会把它们并进相邻句,所以 spec 的「(a) 句子文本与夹具逐项相同」只对切句本身成立。(b) 的「在词边界处切成 2–6 片」只在「两侧都不是空白的单个空格」处切,重新用一个空格连接后与原文逐字相同(用例有换行与连续空格)。后处理另有表驱动用例。夹具与网页切句器都不改。*代价*:无。
- **R-SC7 超长句(> 14 s 或 > 40 词)断开的位置:** 先选前后间隔 ≥ 400 ms 的片段边界,其次任意片段边界,都没有时选最靠近时间中点的词边界;递归到不超限或只剩一个词。spec 只写了片段边界;识别路径一个块就是一个片段,没有片段边界可断。**600 字硬切不实现**:`split_all` 每句 ≤ 200 字(`MAX_SENTENCE_CHARS`),合并时另有 ≤ 600 字的条件,所以超 600 字不会出现(有测试)。*代价*:无。
- **R-SC8 短句(< 1 s 或 < 3 词)先并入前一句,不行再并入后一句**;合并后仍须 ≤ 14 s、≤ 40 词、≤ 600 字,两边都不行就保留。*代价*:无。
- **R-SC9 开关与可用性:** 路由闸门是 `library_enabled`(关 = 除 `GET /config` 外 404 `{"error":"Library is disabled"}`,先鉴权,未登录 401 优先;与背单词同一做法);`config.enabled` = `library_available`(总开关 ∧ ffmpeg / ffprobe 在 PATH 上);新建条目与重试在工具缺失时 503 `Media tools are not installed`。`media_tools_present()` / `ytdlp_present()` 是 `core/config.py` 的模块函数(`shutil.which` / `importlib.util.find_spec`,core 不能导入别的层),测试 monkeypatch 它们。spec「关 = 与未安装完全一致」做不到逐字一致(未安装时写请求会落到 `stubs` 的兜底),以 404 为准。
- **R-SC10 `app.state.library` 就是 `LibraryWorker`,在 `create_app` 里建好**(不是 lifespan),同时持有票据 `tickets`、取回阶段 `fetch_stage` / `set_fetch_stage()`、分片锁 `upload_lock(id)`;轮询循环在 lifespan 的 `tasks["library"]` 里起,关停时 `shutdown()`(取消运行中的任务、最多等 2 s,条目留在 `processing`,下次启动恢复)。测试的 `app` fixture 不跑 lifespan,所以循环不会自己起;测试用 `run_once()` + `drain_background`。
- **R-SC11 媒体工具可注入:** `PipelineDeps.tools` 默认是真实的 `media.Ffmpeg`,测试换成 `tests/library_helpers.FakeTools`(假媒体文件 = `FAKE:` + 一行 JSON)。真实 ffmpeg 的用例在 `test_library_media.py` 与 `test_library_worker.py::test_real_ffmpeg_end_to_end`,没装就跳过。
- **R-SC12 索引:** 只建 `ix_library_items_user_id_created_at`(spec 的 `user_id` 索引由它的前缀覆盖,不重复建)、`ix_library_items_status_next_run_at`(worker 每 2 秒的认领查询)、`ix_library_attempts_item_id_seg_idx`。*代价*:无。
- **R-SC13 与 S2 / A 计划已写好的接口对齐。** S2(`2026-10-13-video-import-server-import.md` 的 A-1–A-6)与 A(`-admin.md` 的 R-A3)在本计划之前按 spec 推定了 S1 的名字,并已实跑了它们自己的代码;本计划直接按那些签名实现,省掉它们的适配:`errors.KINDS` / `LibraryError(kind)` / `http_error(err)`;`pipeline.FetchRequest(item_id, user_id, url, tmp_dir, settings, asr_available, report)`、`FetchResult(media_path, title, duration_ms, subtitle_path, subtitle_auto, source_host)`、`FetchStage.fetch(req)`;`media.run(cmd, *, timeout, env, cwd, on_stdout_line) -> RunResult(returncode, stdout, stderr, timed_out)`(超时**返回** `timed_out=True`,不抛);`limits.admit_new_item(session, app, user_id, *, size_bytes=0, upload=False)` / `refund_new_item`;`store.create_item(...)`、`store.item_out`;`store.cancel_item(session, app, item)` / `store.delete_item(session, app, item)`;`worker.set_fetch_stage` / `fetch_stage` / `wake` / `pending`。spec 没定这些名字,不算偏离。*代价*:`LibraryError` 同时承载入库的错误种类(`KINDS`)与只出现在 HTTP 里的准入原因码(`ADMIT`:`unavailable` / `max_items` / `quota` / `uploads` / `daily`),后者永不写进 `error_kind`。
- **R-SC14 `library_attempts` 多一列 `text_hash`(`String(16)`)。** spec §9 把「补传字幕后旧成绩怎么显示」交给 S1 裁定:成绩按句序号保留、不迁移不删除;`GET attempts` 只统计 `text_hash` 等于该句**当前**文本指纹(规范化空白后 sha256 的前 16 位)的成绩。改字(`PATCH segments`)同理。同一 `assessment_id` 重复提交只算一次。`assessment_id` 不设外键(SET NULL 语义由应用保证,spec §4)。*代价*:改一个字就看不到这句的旧成绩(旧行仍在库里)。
- **R-SC15 `library_enabled` 放「功能开关」组**(spec §5.2),危险提示「关闭后跟读库接口返回 404;素材与记录保留」。`admin/settings_service.danger_reasons` 对没有方向规则的键两个方向都提示(与 `rooms_voice_enabled` 等一致);该文件不归本计划,不加规则。三个「会花钱 / 有安全面」的子开关与全站识别分钟数都有 `danger`。*代价*:关闭时也会弹确认。
- **R-SC16 spec §15 没列、但必须改的文件:** `tests/test_settings_registry.py`(`EXPECTED_ENV_ONLY` 加两个 env-only 键、`EXPECTED_SECRETS` 加代理)、`tests/test_migrations.py`(五处 heads)、`tests/CLAUDE.md`(两行)、新助手 `tests/library_helpers.py`。这些文件没有别的车道拥有;不改则测试变红。
- **R-SC17 `_tmp` 清扫规则:** 条目不存在、`ready`、`canceled` 的目录删除;`failed` 的保留到 7 天清理(给手动重试用,spec §6.5);`uploading` 24 小时没有新分片 → `failed(upload_expired)` 并删目录。spec §5.1 的「24 小时没动静的目录删除」**不用于** `queued` / `processing`:长视频转码时目录本来就可能很久不变,误删会毁掉正在进行的任务;进程重启后这些条目由恢复逻辑接手。
- **R-SC18 意外异常按 `upstream`(瞬时)处理**:自动重试 ≤ 2 次,日志只记异常类名;永久错误不自动重试。
- **R-SC19 媒体端点:** 没有 / 过期 / 属于别的条目的票据 → 401 `Invalid ticket`;条目不存在、未 `ready`、用户被停用 → 404;支持 `HEAD`;响应头 `Cache-Control: private, no-store`、`Referrer-Policy: no-referrer`、`X-Content-Type-Options: nosniff`。封面不走票据,走 Bearer(网页用 blob 取,spec §9)。
- **R-SC20 「没有句子」:** 用户上传的字幕一句都切不出来 → `bad_subtitle`;平台字幕解析失败或为空 → 当作没有字幕,走识别 / `no_subtitles`;识别结果全空 → `no_subtitles`。
- **R-SC21 补传字幕(`PUT /items/{id}/subtitles`):** `ready` → 请求里同步解析、分句、整表替换(纯函数,毫秒级),`sub_source = "uploaded"`;`failed(no_subtitles)` → 写 `_tmp/<id>/subs.raw` 并回到 `queued`(媒体已在成品目录,只跑字幕与分句);其他状态 409 `Subtitles cannot be changed now`。
- **R-SC22 标题与条目形状:** 上传的默认标题 = 文件名主干(下划线换空格,≤ 200 字),空 → `Untitled`;链接条目由 S2 在用户没给标题时存 `""`,取回后用平台标题补(只在标题为空时)。条目输出比 spec §9 多两个键:`resume_idx`(播放器要滚到这一句)与 `has_poster`(网页据此决定取不取封面);`uploading` 状态下 `progress` = 已收字节的百分比;探测前 `kind` 按扩展名先猜(mp3 / m4a / aac / wav / ogg / opus / flac → `audio`,其余 `video`)。
- **R-SC23 识别秒数按「当天」预留与退还**(`daily_usage` 的 `library_asr`,subject = 用户 id 与 `*`);跨 UTC 日的重试会把退还记到新的一天。*代价*:极少数情况下当天计数偏低几十秒,接受。
- **R-SC24 分片:** 每片整块读入内存(≤ 8 MiB + 64 KiB 的 multipart 框架)再交给 Starlette 解析;同一条目的分片写入用进程内锁串行;续传:已收下的同一片、同样长度重发 → 200 且不写;其他乱序 → 409 `Unexpected chunk`;最后一片以外必须正好 8 MiB。分片不走每分钟限流(spec §8),但每次都更新 `updated_at`(24 小时过期从最后一片算)。
- **R-SC25 手动重试的前提:** 链接条目(`source_url` 还在)、或成品媒体在、或 `_tmp/in.*` 在;否则 409 `Nothing left to retry`。「坏素材」类永久错误(`corrupt`、`too_long`、`no_audio`、`unsupported_format`、`too_large`、`upload_expired`、`bad_subtitle` 与全部链接类)在失败时立刻删 `_tmp`;`quota`、`disk_full`、`no_subtitles` 与瞬时错误保留(spec §6.5 的断点续用)。
- **R-SC26 镜像体积不在本计划实测。** Task 0 Step 4 需要 `docker compose build`,仓库规则是只在用户要求时重建容器 → 标 BLOCKED,由 Z(或用户要求时)测前后体积写进结果文档。Dockerfile 只加一层 `apt-get install -y --no-install-recommends ffmpeg`(以 root,在 `USER app` 之前)。
- **R-SC27 识别语言固定 `en`**(非英语素材不做,spec §14);块并发 ≤ 2,同时受 `shared_asr_gate` 约束;每块 3 次尝试;用量由 `asr` 层已有的 `metering.record` 记,worker 只 `bind_user` + `feature_scope("library")`。
- **R-SC28 `cancel_item` / `delete_item` 在 `app.library.store`(spec §4 的名字),带 `app` 参数**(要停 worker 的任务、撤票据、删文件),路由与管理端共用,**自己提交**;删除隐含取消。评测与录音不随条目删除(spec §4)。
- **R-SC29 D8 的归属与文件(spec §15 的「D8 增补的归属」)。** S1 加:迁移里 `library_segments` 的四列(T2;spec §4 写明迁移尚未写,不另开 revision)、四个设置与 `library_ai_available`(T1)、`ai.py`、两个端点、`PATCH segments` 改字清空、`GET config` 的 `ai`、契约夹具与隐私测试的扩充、提示词注册(T11a、T11b、T13)。**spec §15 没列、但「管理端可编辑提示词」就必须改的文件**:`app/admin/prompts_admin.py`(`default_body` 与 `test_messages` 各加一个 `library.*` 分支——不加,这两个键的「默认正文」会读成静态模板 JSON、「试运行」会误走联机助手的渲染)、`tests/test_prompts.py`、`tests/test_prompts_api.py`(两处枚举全部提示词键的断言)。没有别的车道拥有它们(A 只拥有 `library_admin.py` 等);`app/admin/CLAUDE.md` 是 A 的文件,S1 不碰,交给 A 补一句(见文末「交接」)。*代价*:S1 多碰三个文件,都是追加或同一处枚举。
- **R-SC30 提示词。** 核对 `services/prompts.py`、`admin/prompts_admin.py`:`PROMPTS` 注册表 + `validate_prompt`(必需占位符、边界标签、未知占位符)+ 已发布版本缓存 `prompt_cache(app).get(key)`;没有发布版本时用代码里的默认值(与 `wordbook.explain` 同一做法)。注册 `library.translate`(必需 `{native_language}`、`{text}`,边界 `<text>` `</text>`,≤ 4000 字)与 `library.analyze`(必需 `{native_language}`、`{learning_language}`,无边界,≤ 4000 字)。默认正文取桌面端 `enjoy/src/shared/commands/translate.command.ts` / `analyze.command.ts` 的原文:**分析**的系统提示词逐字相同(测试读 enjoy 源码核对,不改 enjoy);**译文**的 `TRANSLATION_PROMPT` 保留原句,另加一句批量格式说明(编号列表,一句一行 `N. 译文`)——一次调用译 ≤ 20 句必需的偏离;`translate` 的系统提示词(`You are a professional, authentic translation engine…`)逐字相同,不可编辑(代码常量)。`{text}` 被替换成带编号的句子,句子里的 `<` `>` 换成形近字符,伪造不了 `<text>` 边界(与 `wordbook.explain` 同一做法)。*代价*:管理员改译文模板时必须保留编号格式说明,否则解析不到(解析不到的句子额度退还,不存脏数据)。
- **R-SC31 母语白名单与语言名。** spec E11「服务端只接受白名单语言码」:白名单取桌面端 `enjoy/src/shared/constants/languages.json` 的 12 个码(`en-US en-GB zh-CN zh-HK ja-JP ko-KR es-ES it-IT de-DE fr-FR th-TH vi-VN`);提示词里用英文语言名(`Simplified Chinese` 等,避免 `普通话` / `한국인` 这类母语文字名带来的歧义;桌面端用的是 JSON 里的 `name`)。不在白名单 → 400 `Unsupported language`。学习语言固定 `English`(spec §14 不做非英语素材)。`zh` 列名沿用 spec,实际存的是用户母语的译文,`zh_lang` 记语言码。网页的 `nativeLanguageCode` 目前只产出 `en-US` / `zh-CN` / `es-ES`,都在白名单里。
- **R-SC32 额度按「句」计,存在 `daily_usage`,不新增表。** scope `library_translate`(subject = 用户 id,句数)、`library_analysis`(subject = 用户 id,次数)、`library_ai`(subject `*`,两类合计的句数);天按 UTC(与其他每日计数一致)。命中已存且语言一致的译文 / 分析不计。译文额度不够时**部分授予**:先给能给的(用户上限与全站上限取小),其余缺着并带 `limited: true`;全站上限拒绝的部分退回用户计数。上游失败、模型漏答的句子额度原路退还(`reserve_ai` / `refund_ai`)。不读 `QUOTA_KEYS` 覆盖(spec 只让 `library_quota_mb` / `library_max_items` 可按人覆盖)。分析用满 → 429 `Daily analysis limit reached`;全站用满 → 429 `Daily AI limit reached`。
- **R-SC33 译文的批量格式与解析。** 一次大模型调用译 ≤ 20 句(spec E12);请求里句子带本地编号 `1.`…`N.`(不是句序号,避免序号上千的干扰),回复按 `N. 译文` 行解析:没有编号的行(前言、拒绝语、代码围栏)一律丢弃,同号取第一次,越界编号丢弃。每句译文 ≤ 1200 字、分析 ≤ 4000 字(spec §4)。`max_tokens` = min(3000, 200 + 120 × 句数)(分析 1500),`temperature` 0.2(分析 0.3),模型 = `default_llm_model`(spec 没给模型设置,不新增)。*代价*:模型不按格式回复时整批失败(503,额度退还),下次重试;**真实模型的遵守程度未验证**。
- **R-SC34 写回带「旧文本」保护。** `store.set_translations` / `set_analysis` 的 UPDATE 带 `text = <请求时读到的文本>`:模型在跑的时候用户改了这句 → 不写(返回里也不带),不会把旧句的译文挂到新句上;`PATCH segments` 改字(规范化空白后文字不同)时 `clear_ai` 清四列,只改时间或只改空白不清;补传 / 替换字幕整表重建,译文与分析自然清空(spec E11)。*代价*:同一句的两个并发请求会各调一次模型、各计一次额度,后写覆盖(不加分布式锁;网页自己去重,见 W2 的 `use-translations`)。
- **R-SC35 `translate` / `analysis` 的返回形状**(spec §9 只写了 `[{idx, zh}]` 与 `{analysis, cached}`,形状在此冻结):`POST …/translate {indices, native_language}` → `{"segments":[{"idx","zh"}…],"limited":bool}`(含已存的;按 idx 升序;不存在的序号略过;`indices` 1–20 个、去重);`POST …/segments/{idx}/analysis {native_language}` → `{"analysis","cached"}`。`GET /items/{id}`(以及 `PUT …/subtitles`、`PATCH …/segments/{idx}` 的返回)的句子多四个键:`zh`、`zh_lang`、`has_analysis`、`analysis_lang`(分析正文最长 4000 字,只在点「分析」时取,列表只告诉有没有)。网页拿 `zh_lang` 与当前母语比,不一致当作没有。开关 / 未配置 → 404 `AI is disabled`(`config.ai` 同为假);条目非 `ready` → 409 `Item is not ready`;大模型失败 → 503 `AI is unavailable`;两个端点都走 `limited_user` 的每分钟限流。
- **R-SC36 计量 feature 名与 spec 不同。** spec §9 写 `library_translate` / `library_analysis`,但 `upstream_calls.feature` / `usage_daily.feature` 列只有 `String(16)`,`metering.record` 会把 `library_translate` 截成 `library_translat`(写计划时用测试复现过)。改用 `lib_translate` / `lib_analysis`(≤ 16 字符,测试钉住);A 车道的用量页若要给中文名,键是这两个。计量只记现有的「一次大模型调用」行(tokens),**不另记句数**——句数在 `daily_usage`(R-SC32)。
- **R-SC37 D9 / D11 / D12 / E9(入口标签、盲听、玻璃与动效、应用外观 浅色 / 深色 / 跟随系统)是网页侧的事,服务端无改动**:不新增接口、设置或表,库页面的深浅色只跟随 `html.dark`;本计划的接口形状与深浅色无关。D10 的第二期清单(录音管理页、转写稿下载、每句笔记、重新识别、单句音频下载、AI 摘要、音标)不在本计划,也没有为它们预留接口。


---

## 对外接口(冻结;S2 / A / W1 / W2 依赖)

> 名字与签名就是本计划代码里的;合并后以代码为准,但改名必须先改本节并通知对应车道。

**给 S2(`2026-10-13-video-import-server-import.md`,其「依赖的 S1 接口」A-1–A-9 逐条对应):**
- A-1 `app.library.errors`:`LibraryError(kind)`(`.kind`)、`KINDS`(= §6.6 全部种类)、`http_error(err) -> HTTPException`(准入错误的固定状态码与英文串)、`api_error(code)`、`API_ERRORS`。
- A-2 `app.library.pipeline`:`FetchRequest(item_id: str, user_id: int, url: str, tmp_dir: Path, settings: Settings, asr_available: bool, report: Callable[[int], Awaitable[None]])`(`report` 收 0–100,本计划映射到流水线的 0–40 并节流;条目被取消时它抛 `Aborted`);`FetchResult(media_path: Path, title: str | None = None, duration_ms: int | None = None, subtitle_path: Path | None = None, subtitle_auto: bool = False, source_host: str | None = None)`;`FetchStage` 协议 `async fetch(req) -> FetchResult`;`NoFetch`。本计划对结果的处理:`subtitle_path` 存在则移到 `_tmp/<id>/platform.srt` 并优先于识别使用(`sub_source = "platform"`;解析失败当作没有);`title` 只在条目 `title == ""` 时采用;`source_host` 只在条目没有时采用;`duration_ms` 只作参考(以探测为准)。取回失败抛 `LibraryError(kind)`;瞬时种类自动重试。
- A-3 `app.library.media.run(cmd: Sequence[str], *, timeout: float, env: Mapping[str, str] | None = None, cwd: Path | None = None, on_stdout_line: Callable[[str], Any] | None = None) -> RunResult(returncode: int, stdout: bytes, stderr: str, timed_out: bool)`:`env` 是子进程的**完整**环境(`None` = `safe_env()`);回调可同步可异步,给了回调 stdout 就不缓存;超时 → 终止进程并返回 `timed_out=True`;取消 → 终止进程后继续抛出;自己不记录任何输出。另有 `safe_env(home=None, extra=None)`。
- A-4 `app.state.library`(`LibraryWorker`,`create_app` 里建好):`set_fetch_stage(stage)`、`fetch_stage`、`wake()`(循环没起时调用也安全)、`pending`。
- A-5 `app.library.limits.admit_new_item(session, app, user_id, *, size_bytes=0, upload=False) -> None`(不满足抛 `LibraryError("unavailable" | "max_items" | "quota" | "uploads" | "daily")`,每日次数最后才扣)、`refund_new_item(session, app, user_id)`。
- A-6 `app.library.store.create_item(session, *, user_id, kind, source, status, title, source_url=None, source_host=None, upload_total=0) -> LibraryItem`(自己提交)、`store.item_out(item) -> dict`、`store.clean_title(raw, fallback="Untitled")`。
- A-7 / A-8 模型与设置名见 Task 1 / Task 2(与 spec §4、§5.2 逐字相同)。
- A-9 `main.py` 锚点原文:`# --- anchor for plan S2 (2026-10-13-video-import-server-import): \`library_import.install(app)\` goes on the next` …(在 `install_library(app)` 之后)与 `# --- anchor for plan S2 (2026-10-13-video-import-server-import): \`library_import,\` goes on the next line ---`(路由元组里 `library,` 之后)。`tests/test_library_privacy.py` 已把 `("POST", "/api/library/imports")` 列为允许的后续路由(`LATER`);S2 自己的隐私测试覆盖它的请求体。

**给 A(`2026-10-13-video-import-admin.md`,其 A0 核对表):**
- `LibraryItem` 列与 spec §4 逐字相同(另有本计划的 `library_attempts.text_hash`,不在 items 表)。
- 删除 `store.delete_item(session, app, item) -> None`、取消 `store.cancel_item(session, app, item) -> bool`(`False` = 不在可取消状态);二者都**自己提交**,都会停任务、撤票据、删 `library/<uid>/<id>/` 与 `library/_tmp/<id>/`。
- 识别计数:`limits.SCOPE_ASR = "library_asr"`、全站 subject `limits.GLOBAL = "*"`,值是**秒**;每日新建次数 `limits.SCOPE_IMPORTS = "library_imports"`。
- 运行中任务:`app.state.library.pending`(集合)与 `app.state.library.running`(条目 id → 任务)。
- D8(今日译文 / 分析句数,给 `overview`):`daily_usage` 的 scope `limits.SCOPE_TRANSLATE = "library_translate"`(subject = 用户 id,句数)、`limits.SCOPE_ANALYSIS = "library_analysis"`(subject = 用户 id,次数)、`limits.SCOPE_AI_GLOBAL = "library_ai"`(subject `limits.GLOBAL = "*"`,两类合计的句数;全站上限 `settings.library_ai_daily_global`),天按 UTC(`limits.day_of(now)`)。用量页的 feature 键是 `lib_translate` / `lib_analysis`(R-SC36,不是 spec 里的 `library_translate` / `library_analysis`,那样会被截断);ASR 与其余库请求仍是 `library`。设置名:`library_ai_enabled`、`library_translate_daily_per_user`、`library_analysis_daily_per_user`、`library_ai_daily_global`;属性 `Settings.library_ai_available`。
- `QUOTA_KEYS` 含 `library_quota_mb`、`library_max_items`;`test_architecture.py` 的 `admin` 允许集合含 `library`;`main.py` 锚点原文 `# --- anchor for plan A (2026-10-13-video-import-admin): \`admin_library,\` goes on the next line (before stubs) ---`。

**给 W1 / W2(网页):** 线上形状以 `server/tests/fixtures/library_contract.json` 为准(T13 录制),摘要:
- `GET /api/library/config` → `{enabled, link_import, asr, ai, limits:{max_upload_mb, max_duration_minutes, quota_mb, used_bytes, max_items, chunk_bytes, formats[]}}`(开关关时同形,`enabled:false`);`ai` = 总开关 ∧ `LIBRARY_AI_ENABLED` ∧ 已配置大模型上游(D8:假 = 不显示「译」与「分析」,两个端点 404)。
- 条目 `item` = `{id, kind, source, title, status, stage, progress, error_kind, duration_ms, seg_count, library_bytes, sub_source, resume_ms, resume_idx, rate_pct, has_poster, created_at, last_opened_at}`;`status` ∈ `uploading|queued|processing|ready|failed|canceled`;`stage` ∈ `fetch|probe|transcode|subtitles|transcribe|segment|null`;`sub_source` ∈ `uploaded|platform|asr|null`;链接条目处理中 `title` 可能是 `""`。
- 句子 `{idx, start_ms, end_ms, text, zh, zh_lang, has_analysis, analysis_lang}`(原始时间,播放缓冲由网页加;`zh` / `zh_lang` / `analysis_lang` 可空;`zh_lang` 与当前母语不一致就当没有译文;分析正文不在列表里,只有 `has_analysis`)。`GET /items/{id}`、`PUT …/subtitles`(`segments`)、`PATCH …/segments/{idx}`(`segment`)都是这个形状。
- D8:`POST /items/{id}/translate {indices:[int, 1–20 个], native_language}` → `{segments:[{idx, zh}], limited}`(含已存且语言一致的;`limited: true` = 每日额度只够译一部分,缺的没生成;不存在的序号略过);`POST /items/{id}/segments/{idx}/analysis {native_language}` → `{analysis, cached}`(正文是模型返回的原文,桌面端 `analyze` 提示词规定的三节 `### Sentence Structure` / `### Grammar` / `### Vocabulary/Phrases`,按母语写);`native_language` 只接受白名单码 `en-US en-GB zh-CN zh-HK ja-JP ko-KR es-ES it-IT de-DE fr-FR th-TH vi-VN`(其余 400 `Unsupported language`)。错误:`ai_disabled` 404、`not_ready` 409、`ai_unavailable` 503、`ai_user_cap`(分析次数用满)与 `ai_global_cap`(全站用满)429;译文额度用满不是错误,是 `limited`。两个端点走 `limited_user` 限流;**网页不要预取分析**(spec E12)。夹具键:`translate`、`analysis`、`item_detail_with_ai`(译完 / 分析完之后的句子列表)。
- `POST /uploads {filename, size, title?}` → `{item_id, chunk_bytes}`;`PUT /uploads/{id}/chunks/{n}`(multipart 字段 `chunk`)与 `GET /uploads/{id}` → `{item_id, status, upload_received, upload_total, chunk_bytes}`;`PUT /uploads/{id}/subtitles`(字段 `file`)→ `{cue_count}`;`POST /uploads/{id}/complete` → `{item}`。
- `GET /items?cursor=` → `{items[], next_cursor}`;`GET /items/{id}` → `{item, segments[]}`(只有 `ready` 有句子);`PATCH /items/{id} {title?, resume_ms?, resume_idx?, rate_pct?}` → `{item}`;`DELETE` → `{deleted:true}`;`POST …/retry`、`…/cancel` → `{item}`;`PUT …/subtitles` → `{item, segments}`;`PATCH …/segments/{idx} {start_ms?, end_ms?, text?}` → `{segment}`;`POST …/media-ticket` → `{url, expires_in}`(`url` 是同源相对路径,含 `?ticket=`);`GET …/poster`(Bearer,`image/jpeg`);`POST …/attempts {seg_idx, assessment_id}` → `{seg_idx, score}`;`GET …/attempts` → `{attempts:[{seg_idx, best_score, count, last_at}]}`(只含文本未变的句子)。
- 错误一律 `{"error": <固定英文串>}`;全部文本在夹具的 `errors` 键(= `API_ERRORS`),`error_kind` 的全部取值在 `error_kinds` 键——网页的 `LIBRARY_SERVER_ERRORS` 与中文映射表必须覆盖它们。评测保存用 `source=library`;练习清单 `source: "library"`。


---

## 任务

### Task 0: S0 spike:迁移号、备份范围、Range 行为、镜像体积

**Files:**
- Create: `server/tests/test_library_range.py`
- Modify(追加一节): `docs/superpowers/plans/2026-10-13-video-import-results.md`(不存在就新建,首行 `# 跟读库 · 结果与核对(2026-10-13)`)

**目的:** spec §15 指定给 S1 车道的 S0:`alembic heads`、Range 测试、`backups.py` 确认、镜像加 ffmpeg 前后体积。

- [ ] **Step 1: 迁移头** — `cd server && uv run alembic heads`。期望输出含 `0017 (head)`。若不是 `0017`,按 Global Constraints 的「迁移」一条顺延并记下。

- [ ] **Step 2: 备份范围** — Read `server/app/admin/backups.py`,确认只有 `VACUUM INTO`(SQLite 快照)与 Postgres 的 `pg_dump` 提示、没有对数据目录文件的引用(写计划时核对的结论,见 R-SC2)。结论写进结果文档;README 的说明在 Task 14。

- [ ] **Step 3: Range 测试(钉住框架行为,应直接通过)**

Write `server/tests/test_library_range.py`:

````python
"""Spike S0 / E4 核对项:锁定的 Starlette(uv.lock 1.7.0)的 `FileResponse` 自带 Range 支持。iOS Safari 对媒体
必须拿到 206 才能 seek 与循环,所以这里直接钉住框架行为(不经跟读库的路由);升级 Starlette 时这组测试先红。"""
import httpx
import pytest
from fastapi import FastAPI
from fastapi.responses import FileResponse

DATA = bytes(range(256)) * 40  # 10240 bytes


@pytest.fixture
async def client(tmp_path):
    path = tmp_path / "media.mp4"
    path.write_bytes(DATA)
    app = FastAPI()

    @app.get("/m")
    async def media():
        return FileResponse(path, media_type="video/mp4")

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        yield c


async def test_plain_get_advertises_ranges(client):
    r = await client.get("/m")
    assert (r.status_code, r.content, r.headers["accept-ranges"]) == (200, DATA, "bytes")
    assert r.headers["content-length"] == str(len(DATA)) and r.headers["etag"] and r.headers["last-modified"]


@pytest.mark.parametrize("header, body, content_range", [
    ("bytes=0-1", DATA[:2], "bytes 0-1/10240"),
    ("bytes=100-", DATA[100:], "bytes 100-10239/10240"),
    ("bytes=-500", DATA[-500:], "bytes 9740-10239/10240"),
    ("bytes=10000-99999", DATA[10000:], "bytes 10000-10239/10240"),
], ids=["first-two", "open-end", "suffix", "end-past-size"])
async def test_single_ranges_are_206(client, header, body, content_range):
    r = await client.get("/m", headers={"Range": header})
    assert (r.status_code, r.content, r.headers["content-range"]) == (206, body, content_range)
    assert r.headers["content-length"] == str(len(body))


async def test_unsatisfiable_is_416_with_the_size(client):
    r = await client.get("/m", headers={"Range": "bytes=10240-"})
    assert (r.status_code, r.headers["content-range"]) == (416, "bytes */10240")


async def test_malformed_is_400_and_unknown_units_are_400(client):
    assert (await client.get("/m", headers={"Range": "bytes=5-2"})).status_code == 400
    assert (await client.get("/m", headers={"Range": "items=0-1"})).status_code == 400


async def test_if_range_matches_the_etag_or_falls_back_to_200(client):
    etag = (await client.get("/m")).headers["etag"]
    assert (await client.get("/m", headers={"Range": "bytes=0-1", "If-Range": etag})).status_code == 206
    r = await client.get("/m", headers={"Range": "bytes=0-1", "If-Range": '"other"'})
    assert (r.status_code, r.content) == (200, DATA)


async def test_multiple_ranges_are_multipart_byteranges(client):
    r = await client.get("/m", headers={"Range": "bytes=0-1,100-101"})
    assert r.status_code == 206 and r.headers["content-type"].startswith("multipart/byteranges; boundary=")
    assert DATA[:2] in r.content and DATA[100:102] in r.content
````

运行:`cd server && uv run pytest -q tests/test_library_range.py` → 9 passed。**若有失败**:停下,在结果文档记录哪一条不符,并改为在 `routers/library.py` 里自己实现单区间 Range(spec §10 的退路;本计划其余部分不变),先与编排者确认。

- [ ] **Step 4: 镜像体积(BLOCKED,R-SC26)** — 需要 `docker compose build`,仓库规则是只在用户要求时重建容器。不要执行;在结果文档写「未测,等用户要求或 Z 车道」。用户要求时:改 Dockerfile 之前与之后各 `docker compose build server` 一次,`docker image inspect <image> --format '{{.Size}}'` 记两个数字。

- [ ] **Step 5: 结果文档追加一节**(方括号换成真实结论,不编造):


````markdown
## S1 服务端数据与任务 · S0 核对(计划 2026-10-13-video-import-server-core.md Task 0)

- 日期 / 基于提交:[YYYY-MM-DD / git rev-parse --short HEAD]
- alembic heads:[输出];本计划使用的迁移号:[0018 / 顺延为 …]
- backups.py:[只备份数据库(VACUUM INTO / pg_dump 提示),不含数据目录文件 / 与此不同:…]
- Starlette 版本(uv.lock):[1.7.0];tests/test_library_range.py:[9 passed / 失败项 …]
- 镜像体积(加 ffmpeg 前 / 后):未测(需要重建镜像,按仓库规则等用户要求)
````

- [ ] **Step 6: 提交**

```bash
git add server/tests/test_library_range.py docs/superpowers/plans/2026-10-13-video-import-results.md
git commit -m "test(server): pin Starlette FileResponse range behaviour for the media library" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 0b: S1 spike:识别上游能否返回带时间的片段(BLOCKED 时跳过)

**Files:** 不改仓库代码;只追加结果文档。脚本放在**仓库之外**(例如会话的临时目录),不提交。

**前提:** 用户确认识别上游有余额(火山流式 `UPSTREAM_ASR_MODE=volc_stream` 与 / 或 OpenAI 风格的 Whisper),并提供两段约 1 分钟的真实英语素材。花费很小,但会产生真实调用:**没有用户确认就不跑**,在结果文档写「BLOCKED:等上游余额 / 素材」后继续 Task 1。

- [ ] **Step 1: 准备素材** — `ffmpeg -i <素材> -t 60 -vn -ac 1 -ar 16000 -c:a pcm_s16le s1.wav`(两段)。

- [ ] **Step 2: 写脚本**(仓库外,例如 `<临时目录>/spike_asr_timestamps.py`):

````python
"""Spike S1 (plan 2026-10-13-video-import-server-core, Task 0b): do the configured recognizers return timed segments?

Not committed. Save outside the repo, then from server/:
    uv run python <path>/spike_asr_timestamps.py <sample1.wav> [<sample2.wav>]
Each sample: about 1 minute of real English speech as a 16 kHz mono 16-bit WAV
(`ffmpeg -i in.mp4 -t 60 -vn -ac 1 -ar 16000 -c:a pcm_s16le s1.wav`). Uses server/.env (real upstreams, small cost).
Prints field names, counts and times only: never transcripts, keys or upstream error text."""
import asyncio
import os
import sys
import wave

sys.path.insert(0, os.getcwd())  # run from server/

import httpx  # noqa: E402

from app.core.config import Settings  # noqa: E402
from app.speech import asr_stream  # noqa: E402


def pcm_of(path: str) -> bytes:
    with wave.open(path, "rb") as w:
        assert (w.getframerate(), w.getnchannels(), w.getsampwidth()) == (16000, 1, 2), "need 16 kHz mono 16-bit"
        return w.readframes(w.getnframes())


async def volc(settings: Settings, pcm: bytes) -> None:
    if not settings.asr_stream_key:
        print("volc: not configured")
        return
    captured: dict = {}
    original_payload, original_decode = asr_stream._request_payload, asr_stream.decode_frame

    def payload(uid: str) -> dict:
        body = original_payload(uid)
        body["request"]["show_utterances"] = True
        return body

    def decode(raw):
        frame = original_decode(raw)
        if frame.last:
            captured["result"] = frame.payload.get("result")
        return frame

    asr_stream._request_payload, asr_stream.decode_frame = payload, decode
    try:
        await asr_stream.transcribe_pcm(settings, pcm, "spike")
    except asr_stream.AsrStreamError as e:
        print("volc: failed kind=", e.kind)
        return
    finally:
        asr_stream._request_payload, asr_stream.decode_frame = original_payload, original_decode
    result = captured.get("result") or {}
    utterances = result.get("utterances") or [] if isinstance(result, dict) else []
    print("volc result keys:", sorted(result) if isinstance(result, dict) else type(result).__name__)
    print("volc utterances:", len(utterances))
    if utterances:
        print("volc utterance keys:", sorted(utterances[0]))
        print("volc first times (ms):", [(u.get("start_time"), u.get("end_time")) for u in utterances[:8]])
        words = utterances[0].get("words") or []
        print("volc words in first utterance:", len(words), "word keys:", sorted(words[0]) if words else [])


async def whisper(settings: Settings, wav_path: str) -> None:
    if not settings.upstream_whisper_base_url or settings.upstream_whisper_mode == "chat":
        print("whisper: not configured as an OpenAI-style /audio/transcriptions endpoint")
        return
    with open(wav_path, "rb") as fh:
        data = fh.read()
    async with httpx.AsyncClient(timeout=120) as http:
        r = await http.post(settings.upstream_whisper_base_url.rstrip("/") + "/audio/transcriptions",
                            files={"file": ("a.wav", data, "audio/wav")},
                            data={"model": "whisper-1", "response_format": "verbose_json", "language": "en",
                                  "timestamp_granularities[]": "segment"},
                            headers={"Authorization": f"Bearer {settings.upstream_whisper_key}"})
    print("whisper status:", r.status_code)
    if not r.is_success:
        return
    body = r.json()
    segments = body.get("segments") or []
    print("whisper keys:", sorted(body), "segments:", len(segments))
    if segments:
        print("whisper segment keys:", sorted(segments[0]))
        print("whisper first times (s):", [(s.get("start"), s.get("end")) for s in segments[:8]])


async def main() -> None:
    settings = Settings()
    for path in sys.argv[1:]:
        print("==", os.path.basename(path))
        await volc(settings, pcm_of(path))
        await whisper(settings, path)


asyncio.run(main())
````

- [ ] **Step 3: 运行** — `cd server && uv run python <临时目录>/spike_asr_timestamps.py s1.wav s2.wav`。脚本只打印字段名、数量与时间,不打印转写文字;不要把输出以外的东西(文字、密钥)抄进文档。

- [ ] **Step 4: 结果文档追加**:

````markdown
## S1 spike:识别上游的时间戳(Task 0b)

- 日期 / 上游:[火山流式(resource id …)/ Whisper(主机)/ 未配置]
- 火山 `show_utterances`:[返回 / 不返回];`result` 的键:[…];utterance 的键:[…];时间单位:[毫秒 / …];每段 1 分钟的 utterance 数:[…]
- Whisper `verbose_json`:[返回 segments / 不支持(状态码)];segment 的键:[…];时间单位:[秒]
- 结论:[A 档可行(写 Addendum 追加 `transcribe_timed`)/ 不可行(B 档是唯一路径)/ BLOCKED:原因]
````

- [ ] **Step 5: 提交结果文档**(只有这一个文件):

```bash
git add docs/superpowers/plans/2026-10-13-video-import-results.md
git commit -m "docs: record the library ASR timestamp spike" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

> A 档的实现**不在本计划**(R-SC4)。即使 spike 通过,也只写结论;是否追加 Addendum 由编排者决定。

### Task 1: 设置、配额键、计量前缀与 `.env.example`

**Files:**
- Create: `server/tests/test_library_settings.py`
- Modify: `server/app/core/config.py`、`server/app/core/settings_registry.py`、`server/app/core/quotas.py`、`server/app/core/metering.py`、`server/tests/test_settings_registry.py`、`server/.env.example`

**Interfaces(Produces):** `Settings.library_*`(20 个字段,名字即环境变量)、属性 `library_available` / `library_asr_available` / `library_link_available` / `library_ai_available`、`core.config.media_tools_present()` / `ytdlp_present()`;注册表组 `library`;`QUOTA_KEYS` 两个键;计量 feature `library`;`.env.example`「跟读库」一节。

- [ ] **Step 1: 写失败测试**

Write `server/tests/test_library_settings.py`:

````python
"""跟读库的设置、配额键与计量前缀(spec 2026-10-13-video-import §5.2、§2.2)。"""
import pytest

from app.core import config as config_module
from app.core import metering
from app.core.config import Settings
from app.core.quotas import QUOTA_KEYS
from app.core.settings_registry import ENV_ONLY, GROUPS, SECRETS, SPECS, field_bounds

LIBRARY_KEYS = {
    "library_enabled", "library_asr_enabled", "library_link_import_enabled", "library_quota_mb", "library_max_items",
    "library_max_upload_mb", "library_max_duration_minutes", "library_asr_minutes_daily_per_user",
    "library_asr_minutes_global_daily", "library_imports_daily_per_user", "library_job_concurrency",
    "library_transcode_max_height", "library_link_timeout_minutes", "library_link_allow_generic",
    "library_ytdlp_cookies_file", "library_ytdlp_proxy",
    # D8(spec §5.2):每句译文与句子分析
    "library_ai_enabled", "library_translate_daily_per_user", "library_analysis_daily_per_user",
    "library_ai_daily_global",
}


def test_defaults_match_the_spec():
    s = Settings(_env_file=None)
    assert (s.library_enabled, s.library_asr_enabled, s.library_link_import_enabled, s.library_link_allow_generic,
            s.library_ai_enabled) == (False, False, False, False, False)
    assert (s.library_translate_daily_per_user, s.library_analysis_daily_per_user, s.library_ai_daily_global) == (
        500, 30, 5000)
    assert (s.library_quota_mb, s.library_max_items, s.library_max_upload_mb, s.library_max_duration_minutes,
            s.library_asr_minutes_daily_per_user, s.library_asr_minutes_global_daily, s.library_imports_daily_per_user,
            s.library_job_concurrency, s.library_transcode_max_height, s.library_link_timeout_minutes) == (
        2000, 100, 500, 90, 60, 600, 20, 1, 720, 20)
    assert (s.library_ytdlp_cookies_file, s.library_ytdlp_proxy) == ("", "")


def test_bounds_match_the_spec():
    assert field_bounds("library_quota_mb") == (1, 1_000_000)
    assert field_bounds("library_max_items") == (1, 10_000)
    assert field_bounds("library_max_upload_mb") == (1, 20_000)
    assert field_bounds("library_max_duration_minutes") == (1, 600)
    assert field_bounds("library_asr_minutes_daily_per_user") == (0, 2000)
    assert field_bounds("library_asr_minutes_global_daily") == (0, 100_000)
    assert field_bounds("library_imports_daily_per_user") == (0, 1000)
    assert field_bounds("library_job_concurrency") == (1, 4)
    assert field_bounds("library_transcode_max_height") == (240, 1080)
    assert field_bounds("library_link_timeout_minutes") == (1, 120)
    assert field_bounds("library_translate_daily_per_user") == (0, 20_000)
    assert field_bounds("library_analysis_daily_per_user") == (0, 1000)
    assert field_bounds("library_ai_daily_global") == (0, 1_000_000)


def test_registry_entries():
    assert {k for k in Settings.model_fields if k.startswith("library_")} == LIBRARY_KEYS
    assert ("library", "跟读库") in GROUPS
    assert SPECS["library_enabled"].group == "features"
    assert {k for k in LIBRARY_KEYS if SPECS[k].group == "library"} == LIBRARY_KEYS - {"library_enabled"}
    assert {k for k in LIBRARY_KEYS if k in ENV_ONLY} == {"library_ytdlp_cookies_file", "library_ytdlp_proxy"}
    assert {k for k in LIBRARY_KEYS if k in SECRETS} == {"library_ytdlp_proxy"}
    hot = LIBRARY_KEYS - ENV_ONLY
    assert all(SPECS[k].apply == "hot" for k in hot)
    for key in ("library_asr_enabled", "library_link_import_enabled", "library_link_allow_generic",
                "library_asr_minutes_global_daily", "library_enabled", "library_ai_enabled", "library_ai_daily_global"):
        assert SPECS[key].danger, key
    assert "网址" in SPECS["library_link_import_enabled"].danger


def test_quota_keys_and_metering_prefix():
    assert QUOTA_KEYS["library_quota_mb"] == "library_quota_mb"
    assert QUOTA_KEYS["library_max_items"] == "library_max_items"
    assert metering.feature_for("/api/library/uploads") == "library"
    assert metering.feature_for("/api/libraryx") == "other"


@pytest.mark.parametrize("tools, enabled, expected", [(True, True, True), (False, True, False), (True, False, False)])
def test_library_available_needs_the_switch_and_ffmpeg(monkeypatch, tools, enabled, expected):
    monkeypatch.setattr(config_module, "media_tools_present", lambda: tools)
    assert Settings(_env_file=None, library_enabled=enabled).library_available is expected


def test_asr_available_needs_the_sub_switch_and_a_recognizer():
    no_asr = dict(upstream_whisper_base_url="", upstream_asr_mode="chat")
    assert Settings(_env_file=None, library_asr_enabled=True, **no_asr).library_asr_available is False
    whisper = dict(upstream_whisper_base_url="https://w.test/v1")
    assert Settings(_env_file=None, library_asr_enabled=True, **whisper).library_asr_available is True
    assert Settings(_env_file=None, library_asr_enabled=False, **whisper).library_asr_available is False
    volc = dict(upstream_asr_mode="volc_stream", volcengine_asr_key="k")
    assert Settings(_env_file=None, library_asr_enabled=True, **volc).library_asr_available is True


@pytest.mark.parametrize("present, enabled, expected", [(True, True, True), (False, True, False), (True, False, False)])
def test_link_available_needs_the_sub_switch_and_yt_dlp(monkeypatch, present, enabled, expected):
    monkeypatch.setattr(config_module, "ytdlp_present", lambda: present)
    assert Settings(_env_file=None, library_link_import_enabled=enabled).library_link_available is expected


@pytest.mark.parametrize("library, ai, llm, expected", [
    (True, True, "https://llm.test/v1", True), (False, True, "https://llm.test/v1", False),
    (True, False, "https://llm.test/v1", False), (True, True, "", False)])
def test_ai_available_needs_both_switches_and_a_configured_llm(library, ai, llm, expected):
    """D8:译文 / 分析调大模型;不需要 ffmpeg(已经处理好的条目在没有 ffmpeg 的机器上也能译)。"""
    s = Settings(_env_file=None, library_enabled=library, library_ai_enabled=ai, upstream_llm_base_url=llm)
    assert s.library_ai_available is expected
````

- [ ] **Step 2: 运行确认失败** — `cd server && uv run pytest -q tests/test_library_settings.py` → `AttributeError` / `KeyError`(`library_*` 字段不存在),`test_settings_registry.py` 的两个固定集合断言失败。

- [ ] **Step 3: 实现**

Edit `server/app/core/config.py` —— old_string:

````python
import ipaddress
import re
from datetime import date
````

new_string:

````python
import importlib.util
import ipaddress
import re
import shutil
from datetime import date
````

Edit `server/app/core/config.py` —— old_string:

````python
    agents_tutor_max_tokens: int = Field(350, ge=64, le=2000)
````

new_string:

````python
    agents_tutor_max_tokens: int = Field(350, ge=64, le=2000)

    # 跟读库(spec 2026-10-13-video-import §5.2);总开关关 = /api/library/* 除 config 外 404
    library_enabled: bool = False
    library_asr_enabled: bool = False
    library_link_import_enabled: bool = False
    library_quota_mb: int = Field(2000, ge=1, le=1_000_000)
    library_max_items: int = Field(100, ge=1, le=10_000)
    library_max_upload_mb: int = Field(500, ge=1, le=20_000)
    library_max_duration_minutes: int = Field(90, ge=1, le=600)
    library_asr_minutes_daily_per_user: int = Field(60, ge=0, le=2000)
    library_asr_minutes_global_daily: int = Field(600, ge=0, le=100_000)
    library_imports_daily_per_user: int = Field(20, ge=0, le=1000)
    library_job_concurrency: int = Field(1, ge=1, le=4)
    library_transcode_max_height: int = Field(720, ge=240, le=1080)
    library_link_timeout_minutes: int = Field(20, ge=1, le=120)
    library_link_allow_generic: bool = False
    library_ytdlp_cookies_file: str = ""  # env-only;Netscape 格式,含账号会话,等同密钥
    library_ytdlp_proxy: str = ""  # env-only secret;可能含账号口令
    # D8:每句译文与句子分析(调大模型,花钱);按「句」计的每日额度,命中已存的译文 / 分析不计
    library_ai_enabled: bool = False
    library_translate_daily_per_user: int = Field(500, ge=0, le=20_000)
    library_analysis_daily_per_user: int = Field(30, ge=0, le=1000)
    library_ai_daily_global: int = Field(5000, ge=0, le=1_000_000)
````

Edit `server/app/core/config.py` —— old_string:

````python
    @property
    def realtime_available(self) -> bool:
````

new_string:

````python
    @property
    def library_available(self) -> bool:
        """跟读库能处理媒体:总开关开,且 ffmpeg 与 ffprobe 都在 PATH 上(spec §5.2)。"""
        return self.library_enabled and media_tools_present()

    @property
    def library_asr_available(self) -> bool:
        """无字幕时可用识别转写:子开关开,且现有识别路径可用(火山流式或 Whisper/chat 回退)。"""
        return self.library_asr_enabled and (asr_stream_usable(self) or whisper_fallback_configured(self))

    @property
    def library_link_available(self) -> bool:
        """链接导入:子开关开,且 yt-dlp 可导入(依赖由计划 S2 加进 pyproject)。"""
        return self.library_link_import_enabled and ytdlp_present()

    @property
    def library_ai_available(self) -> bool:
        """译文与句子分析(D8):总开关与子开关都开,且大模型上游已配置。不需要 ffmpeg:已处理好的条目照常可译。"""
        return self.library_enabled and self.library_ai_enabled and bool(self.upstream_llm_base_url)

    @property
    def realtime_available(self) -> bool:
````

Edit `server/app/core/config.py` —— old_string:

````python
def whisper_fallback_configured(settings) -> bool:
````

new_string:

````python
def media_tools_present() -> bool:
    """ffmpeg 与 ffprobe 都能在 PATH 上找到(跟读库;测试里 monkeypatch 这个函数)。"""
    return shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


def ytdlp_present() -> bool:
    """yt-dlp 能被导入(只查找,不导入;测试里 monkeypatch 这个函数)。"""
    return importlib.util.find_spec("yt_dlp") is not None


def whisper_fallback_configured(settings) -> bool:
````

Edit `server/app/core/settings_registry.py` —— old_string:

````python
    ("links", "学习联动"), ("agents", "智能体"),
    ("admin", "管理端"),
````

new_string:

````python
    ("links", "学习联动"), ("agents", "智能体"), ("library", "跟读库"),
    ("admin", "管理端"),
````

Edit `server/app/core/settings_registry.py` —— old_string:

````python
         help_zh="留空 = server/dictionaries/kylebing-english-vocabulary(容器 /app/dictionaries/...)"),
````

new_string:

````python
         help_zh="留空 = server/dictionaries/kylebing-english-vocabulary(容器 /app/dictionaries/...)"),
    _env("library_ytdlp_cookies_file", "str", "yt-dlp cookies 文件", group="library",
         help_zh="Netscape 格式;含账号会话,等同密钥;请用专门的小号;只读挂载"),
    _env("library_ytdlp_proxy", "secret", "yt-dlp 代理", group="library", help_zh="链接取回时使用;可能含账号口令"),
````

Edit `server/app/core/settings_registry.py` —— old_string:

````python
    _s("wordbook_ai_enabled", "features", "bool", "背单词 AI 讲解", help_zh="按需、全站缓存、受每日额度限制",
       danger=_COST),
````

new_string:

````python
    _s("wordbook_ai_enabled", "features", "bool", "背单词 AI 讲解", help_zh="按需、全站缓存、受每日额度限制",
       danger=_COST),
    _s("library_enabled", "features", "bool", "跟读库", help_zh="需要服务器装有 ffmpeg / ffprobe",
       danger="关闭后跟读库接口返回 404;素材与记录保留"),
````

Edit `server/app/core/settings_registry.py` —— old_string:

````python
    _s("agents_tutor_max_tokens", "agents", "int", "导师回复 max_tokens", help_zh="同时受 LLM_MAX_TOKENS 约束"),
)
````

new_string:

````python
    _s("agents_tutor_max_tokens", "agents", "int", "导师回复 max_tokens", help_zh="同时受 LLM_MAX_TOKENS 约束"),
    # 跟读库(设计文档 2026-10-13-video-import §5.2)
    _s("library_asr_enabled", "library", "bool", "无字幕时自动转写", help_zh="用现有语音识别上游;受每日分钟数限制",
       danger=_COST),
    _s("library_link_import_enabled", "library", "bool", "链接导入",
       help_zh="yt-dlp 能直接下载的公开页面;DRM 流媒体不支持", danger="会让服务器访问用户提交的网址并下载内容"),
    _s("library_link_allow_generic", "library", "bool", "允许通用抓取器", help_zh="关 = 只用针对具体站点的提取器",
       danger="通用抓取器会让服务器请求任意网页"),
    _s("library_quota_mb", "library", "int", "每人媒体总量 MB", help_zh="可按用户覆盖"),
    _s("library_max_items", "library", "int", "每人条目数上限", help_zh="可按用户覆盖"),
    _s("library_max_upload_mb", "library", "int", "单个上传文件上限 MB"),
    _s("library_max_duration_minutes", "library", "int", "单条时长上限(分钟)", help_zh="上传与链接都按探测出的时长检查"),
    _s("library_asr_minutes_daily_per_user", "library", "int", "每人每天识别分钟数"),
    _s("library_asr_minutes_global_daily", "library", "int", "全站每天识别分钟数", danger=_COST),
    _s("library_imports_daily_per_user", "library", "int", "每人每天新建条目次数", help_zh="上传与链接合计"),
    _s("library_job_concurrency", "library", "int", "同时处理的条目数", help_zh="ffmpeg / yt-dlp 吃 CPU 与带宽"),
    _s("library_transcode_max_height", "library", "int", "视频最大高度(像素)", help_zh="转码与链接取回都按它"),
    _s("library_link_timeout_minutes", "library", "int", "单次链接取回超时(分钟)"),
    # D8:每句译文与句子分析(同样走现有大模型上游)
    _s("library_ai_enabled", "library", "bool", "每句译文与 AI 分析",
       help_zh="调大模型生成并存进句子;关 = 译文 / 分析接口返回 404", danger=_COST),
    _s("library_translate_daily_per_user", "library", "int", "每人每天译文句数", help_zh="命中已存的译文不计"),
    _s("library_analysis_daily_per_user", "library", "int", "每人每天句子分析次数", help_zh="命中已存的分析不计"),
    _s("library_ai_daily_global", "library", "int", "全站每天译文 + 分析句数", help_zh="两类合计", danger=_COST),
)
````

Edit `server/app/core/quotas.py` —— old_string:

````python
    "agents_memory_extract_daily_per_user": "agents_memory_extract_daily_per_user",
}
````

new_string:

````python
    "agents_memory_extract_daily_per_user": "agents_memory_extract_daily_per_user",
    "library_quota_mb": "library_quota_mb",
    "library_max_items": "library_max_items",
}
````

Edit `server/app/core/metering.py` —— old_string:

````python
    ("/api/agents", "agents"),
````

new_string:

````python
    ("/api/agents", "agents"),
    ("/api/library", "library"),
````

Edit `server/tests/test_settings_registry.py` —— old_string:

````python
    "wordbook_data_dir",  # spec 2026-10-10-wordbook §10
}
````

new_string:

````python
    "wordbook_data_dir",  # spec 2026-10-10-wordbook §10
    "library_ytdlp_cookies_file", "library_ytdlp_proxy",  # spec 2026-10-13-video-import §5.2
}
````

Edit `server/tests/test_settings_registry.py` —— old_string:

````python
    "admin_password", "admin_session_secret", "admin_totp_secret", "settings_encryption_key",
}
````

new_string:

````python
    "admin_password", "admin_session_secret", "admin_totp_secret", "settings_encryption_key",
    "library_ytdlp_proxy",
}
````

在 `server/.env.example` **末尾**追加(前面空一行):

````text
# ---- 跟读库(spec 2026-10-13-video-import §5.2;说明见 server/README.md「跟读库」)----
# 总开关(默认关)。关 = /api/library/* 除 config 外 404,网页不显示入口;打开还需要服务器装有 ffmpeg / ffprobe
# (镜像已装)。除最后两项外都在设置注册表里,可在管理端「设置 → 跟读库」热改(写审计)。
# LIBRARY_ENABLED=false
# 没有字幕时用现有语音识别上游转写(会花钱;需要 UPSTREAM_ASR_MODE=volc_stream 或已配置的 Whisper / chat 转写)。
# LIBRARY_ASR_ENABLED=false
# 每人媒体总量上限(MB,1–1000000);管理端可按用户覆盖(配额键 library_quota_mb)。数据卷要留够空间。
# LIBRARY_QUOTA_MB=2000
# 每人条目数上限(1–10000);可按用户覆盖(配额键 library_max_items)。
# LIBRARY_MAX_ITEMS=100
# 单个上传文件上限(MB,1–20000)。上传是 8 MiB 一片的分片,反向代理的 client_max_body_size 设 9m 以上即可。
# LIBRARY_MAX_UPLOAD_MB=500
# 单条时长上限(分钟,1–600);上传与链接都按探测出的时长检查,也给转码时间封顶。
# LIBRARY_MAX_DURATION_MINUTES=90
# 识别分钟数:每人每天(0–2000)与全站每天(0–100000)。开始转写前按秒预留,失败时退还没转写的部分。
# LIBRARY_ASR_MINUTES_DAILY_PER_USER=60
# LIBRARY_ASR_MINUTES_GLOBAL_DAILY=600
# 每人每天新建条目(上传 + 链接)次数(0–1000;0 = 不能新建)。
# LIBRARY_IMPORTS_DAILY_PER_USER=20
# 同时处理的条目数(1–4);ffmpeg / yt-dlp 吃 CPU 与带宽,小机器保持 1。
# LIBRARY_JOB_CONCURRENCY=1
# 视频转码与链接取回的最大高度(像素,240–1080)。
# LIBRARY_TRANSCODE_MAX_HEIGHT=720
# --- 每句译文与 AI 分析(D8):调现有大模型上游生成,存进句子行,重复打开不再花钱 ---
# 总开关(默认关,会花钱)。关 = 译文 / 分析接口返回 404,网页不显示「译」与「分析」。需要已配置大模型上游(UPSTREAM_LLM_*)。
# LIBRARY_AI_ENABLED=false
# 每人每天生成译文的句数(0–20000;命中已存的译文不计),生成分析的次数(0–1000;命中已存的不计)。
# LIBRARY_TRANSLATE_DAILY_PER_USER=500
# LIBRARY_ANALYSIS_DAILY_PER_USER=30
# 全站每天上述两类合计的句数上限(0–1000000)。
# LIBRARY_AI_DAILY_GLOBAL=5000
# --- 链接导入(yt-dlp,计划 S2)。警告:打开后服务器会访问用户提交的网址并下载内容 ---
# 只支持 yt-dlp 能直接下载的公开页面;受 DRM 保护的流媒体(Netflix、Disney+、爱奇艺、腾讯视频、优酷、Spotify 等)无法导入。
# LIBRARY_LINK_IMPORT_ENABLED=false
# 单次链接取回的墙钟超时(分钟,1–120)。
# LIBRARY_LINK_TIMEOUT_MINUTES=20
# 允许 yt-dlp 的通用抓取器(generic)。警告:打开后服务器可能请求任意网页(SSRF 面变大),默认关。
# LIBRARY_LINK_ALLOW_GENERIC=false
# cookies 文件(Netscape 格式,只读挂载)。含账号会话,等同密钥;务必用专门的小号,主账号有被平台限制的风险。只能写在 .env 里。
# LIBRARY_YTDLP_COOKIES_FILE=
# 链接取回时走的代理(可能含账号口令,等同密钥);只能写在 .env 里。机房 IP 常被拦,最稳的办法是在本机下载后上传文件。
# LIBRARY_YTDLP_PROXY=
````

- [ ] **Step 4: 运行通过** — `cd server && uv run pytest -q tests/test_library_settings.py tests/test_settings_registry.py tests/test_quotas.py tests/test_metering.py tests/test_config.py tests/test_architecture.py` → 全绿。

- [ ] **Step 5: 提交**

```bash
git add server/tests/test_library_settings.py server/app/core/config.py server/app/core/settings_registry.py server/app/core/quotas.py server/app/core/metering.py server/tests/test_settings_registry.py server/.env.example
git commit -m "feat(server): library settings, quota keys and metering prefix" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 2: 三张表、迁移 `0018_library` 与删用户的行

**Files:**
- Create: `server/tests/test_library_models.py`、`server/alembic/versions/0018_library.py`
- Modify: `server/tests/test_migrations.py`、`server/app/models.py`、`server/app/admin/users_admin.py`

**Interfaces(Produces):** `app.models.LibraryItem` / `LibrarySegment` / `LibraryAttempt`;迁移 `0018`;`users_admin.USER_ROWS` 含两张有 `user_id` 的表,segments 按条目删。

- [ ] **Step 1: 写失败测试**

Write `server/tests/test_library_models.py`:

````python
"""迁移 0018_library 与三张表(spec 2026-10-13-video-import §4)。"""
import sqlite3

from alembic import command
from alembic.script import ScriptDirectory

from app.models import LibraryAttempt, LibraryItem, LibrarySegment
from tests.test_migrations import _config, _tables

LIBRARY_TABLES = {"library_items", "library_segments", "library_attempts"}


def test_head_is_0018_and_down_revision_is_0017(tmp_path, monkeypatch):
    cfg, _db = _config(tmp_path, monkeypatch)
    script = ScriptDirectory.from_config(cfg)
    assert script.get_heads() == ["0018"]
    assert script.get_revision("0018").down_revision == "0017"


def test_0018_creates_the_tables_with_their_keys_and_round_trips(tmp_path, monkeypatch):
    cfg, db = _config(tmp_path, monkeypatch)
    command.upgrade(cfg, "0017")
    assert not LIBRARY_TABLES & _tables(db)
    command.upgrade(cfg, "0018")
    assert LIBRARY_TABLES <= _tables(db)
    con = sqlite3.connect(db)
    try:
        item_cols = {r[1] for r in con.execute("pragma table_info(library_items)")}
        seg_info = list(con.execute("pragma table_info(library_segments)"))
        seg_pk = [r[1] for r in sorted(seg_info, key=lambda r: r[5]) if r[5]]
        item_idx = {r[1] for r in con.execute("pragma index_list(library_items)")}
        attempt_idx = {r[1] for r in con.execute("pragma index_list(library_attempts)")}
        item_fks = {(r[2], r[3], r[6]) for r in con.execute("pragma foreign_key_list(library_items)")}
        seg_fks = {(r[2], r[3], r[6]) for r in con.execute("pragma foreign_key_list(library_segments)")}
        attempt_fks = {(r[2], r[3], r[6]) for r in con.execute("pragma foreign_key_list(library_attempts)")}
        con.execute("insert into users (id, username, password_hash, created_at) values (12345678, 'u', 'x', '2026-10-13')")
        con.execute("insert into library_items (id, user_id, kind, source, title, status, created_at, updated_at) "
                    "values ('i1', 12345678, 'video', 'upload', 't', 'uploading', '2026-10-13', '2026-10-13')")
        defaults = con.execute("select progress, attempts, upload_total, upload_received, library_bytes, asr_seconds, "
                               "seg_count, resume_ms, resume_idx, rate_pct from library_items").fetchone()
        con.execute("insert into library_segments (item_id, idx, start_ms, end_ms, text) values ('i1', 0, 0, 900, 'Hi.')")
        try:
            con.execute("insert into library_segments (item_id, idx, start_ms, end_ms, text) "
                        "values ('i1', 0, 0, 900, 'Again.')")
            raise AssertionError("duplicate (item_id, idx) was accepted")
        except sqlite3.IntegrityError:
            pass
        con.commit()
    finally:
        con.close()
    assert {"id", "user_id", "kind", "source", "title", "status", "stage", "progress", "error_kind", "attempts",
            "next_run_at", "source_host", "source_url", "upload_total", "upload_received", "duration_ms", "media_path",
            "poster_path", "media_mime", "library_bytes", "sub_source", "asr_seconds", "seg_count", "resume_ms",
            "resume_idx", "rate_pct", "created_at", "updated_at", "last_opened_at"} == item_cols
    assert seg_pk == ["item_id", "idx"]
    # D8:译文与分析四列,都可空(旧句子没有译文),与 spec §4 的长度一致
    assert {r[1]: (r[2], r[3]) for r in seg_info if r[1] in ("zh", "zh_lang", "analysis", "analysis_lang")} == {
        "zh": ("TEXT", 0), "zh_lang": ("VARCHAR(8)", 0), "analysis": ("TEXT", 0), "analysis_lang": ("VARCHAR(8)", 0)}
    assert {"ix_library_items_user_id_created_at", "ix_library_items_status_next_run_at"} <= item_idx
    assert "ix_library_attempts_item_id_seg_idx" in attempt_idx
    assert item_fks == {("users", "user_id", "CASCADE")}
    assert seg_fks == {("library_items", "item_id", "CASCADE")}
    assert attempt_fks == {("users", "user_id", "CASCADE"), ("library_items", "item_id", "CASCADE")}
    assert defaults == (0, 0, 0, 0, 0, 0, 0, 0, 0, 100)
    command.downgrade(cfg, "0017")
    assert not LIBRARY_TABLES & _tables(db)
    command.upgrade(cfg, "head")
    assert LIBRARY_TABLES <= _tables(db)


def test_model_defaults():
    item = LibraryItem(user_id=1, kind="video", source="upload", title="t", status="uploading")
    assert item.id is None  # default applied on flush (new_uuid)
    assert LibraryItem.__table__.c.rate_pct.default.arg == 100
    assert LibrarySegment.__table__.primary_key.columns.keys() == ["item_id", "idx"]
    seg = LibrarySegment(item_id="i", idx=0, start_ms=0, end_ms=1, text="Hi.")
    assert (seg.zh, seg.zh_lang, seg.analysis, seg.analysis_lang) == (None, None, None, None)
    assert LibraryAttempt.__table__.c.assessment_id.foreign_keys == set()
````

Edit `server/tests/test_migrations.py`(`replace_all: true`):把 `get_heads() == ["0017"]` 全部换成 `get_heads() == ["0018"]`。

- [ ] **Step 2: 运行确认失败** — `cd server && uv run pytest -q tests/test_library_models.py` → `ImportError: cannot import name 'LibraryAttempt'`;`test_migrations.py` 的 heads 断言(已改成 `0018`)失败。

- [ ] **Step 3: 实现**

Edit `server/app/models.py` —— old_string:

````python
from sqlalchemy import (JSON, Boolean, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, false, text,
                        true)
````

new_string:

````python
from sqlalchemy import (JSON, BigInteger, Boolean, DateTime, ForeignKey, Index, Integer, SmallInteger, String, Text,
                        UniqueConstraint, false, text, true)
````

在 `server/app/models.py` **末尾**追加(前面空一行):

````python
# ---- 跟读库(设计文档 2026-10-13-video-import §4;迁移 0018)----

class LibraryItem(Base):
    """用户私有库里的一条音视频。同一时刻最多一个处理任务,状态 / 阶段 / 进度 / 重试都是本行的属性(不建任务表)。
    标题与链接只给所有者;日志、审计、管理端永远不读它们(spec §13、E10)。"""
    __tablename__ = "library_items"
    __table_args__ = (
        Index("ix_library_items_user_id_created_at", "user_id", "created_at"),
        Index("ix_library_items_status_next_run_at", "status", "next_run_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(8))  # audio / video(探测后以实际为准)
    source: Mapped[str] = mapped_column(String(8))  # upload / link
    title: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(12))  # uploading / queued / processing / ready / failed / canceled
    stage: Mapped[str | None] = mapped_column(String(16), nullable=True)
    progress: Mapped[int] = mapped_column(SmallInteger, default=0, server_default="0")
    error_kind: Mapped[str | None] = mapped_column(String(24), nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    next_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    source_host: Mapped[str | None] = mapped_column(String(64), nullable=True)
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    upload_total: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
    upload_received: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    media_path: Mapped[str | None] = mapped_column(String(200), nullable=True)
    poster_path: Mapped[str | None] = mapped_column(String(200), nullable=True)
    media_mime: Mapped[str | None] = mapped_column(String(32), nullable=True)
    library_bytes: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
    sub_source: Mapped[str | None] = mapped_column(String(10), nullable=True)
    asr_seconds: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    seg_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    resume_ms: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    resume_idx: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    rate_pct: Mapped[int] = mapped_column(Integer, default=100, server_default="100")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_opened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class LibrarySegment(Base):
    """一条素材的一句:原始起止毫秒(播放时网页再加缓冲)与文本(≤ 600 字)。D8:译文 `zh`(≤ 1200 字)与分析
    `analysis`(≤ 4000 字,模型返回的原文)存在句子行上,各带语言码;句子文字被改或字幕被替换时清空(spec E11)。"""
    __tablename__ = "library_segments"

    item_id: Mapped[str] = mapped_column(ForeignKey("library_items.id", ondelete="CASCADE"), primary_key=True)
    idx: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    start_ms: Mapped[int] = mapped_column(Integer)
    end_ms: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    zh: Mapped[str | None] = mapped_column(Text, nullable=True)
    zh_lang: Mapped[str | None] = mapped_column(String(8), nullable=True)
    analysis: Mapped[str | None] = mapped_column(Text, nullable=True)
    analysis_lang: Mapped[str | None] = mapped_column(String(8), nullable=True)


class LibraryAttempt(Base):
    """一次跟读评测的成绩。assessment_id 指向 assessments.id,SET NULL 语义由应用层保证(无外键,兼容 SQLite);
    text_hash = 评测时该句文本的指纹(计划 R-SC14):句子改字或重新分句后,旧成绩不再算在这一句上。"""
    __tablename__ = "library_attempts"
    __table_args__ = (Index("ix_library_attempts_item_id_seg_idx", "item_id", "seg_idx"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    item_id: Mapped[str] = mapped_column(ForeignKey("library_items.id", ondelete="CASCADE"))
    seg_idx: Mapped[int] = mapped_column(Integer)
    assessment_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    text_hash: Mapped[str] = mapped_column(String(16))
    score: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
````

Write `server/alembic/versions/0018_library.py`:

````python
"""library: imported audio / video, sentences and shadowing attempts (spec 2026-10-13-video-import §4)

Revision ID: 0018
Revises: 0017
Create Date: 2026-10-13 12:00:00.000000

New tables only (no ALTER), so one path is safe on SQLite and Postgres. user_id references users.id and item_id
references library_items.id, both ON DELETE CASCADE. SQLite enforces neither: app/library/store.delete_item and
app/admin/users_admin.delete_user delete explicitly. library_attempts.assessment_id has no foreign key on purpose
(SET NULL semantics are kept by the application, plan R-SC14). library_segments carries the D8 columns zh / zh_lang /
analysis / analysis_lang from the start (spec §4: the migration is not written yet, no second revision).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0018'
down_revision: Union[str, Sequence[str], None] = '0017'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TZ = sa.DateTime(timezone=True)


def _user() -> sa.Column:
    return sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)


def _item(primary_key: bool = False) -> sa.Column:
    return sa.Column('item_id', sa.String(36), sa.ForeignKey('library_items.id', ondelete='CASCADE'),
                     primary_key=primary_key, nullable=False)


def upgrade() -> None:
    op.create_table(
        'library_items',
        sa.Column('id', sa.String(36), primary_key=True),
        _user(),
        sa.Column('kind', sa.String(8), nullable=False),
        sa.Column('source', sa.String(8), nullable=False),
        sa.Column('title', sa.String(200), nullable=False),
        sa.Column('status', sa.String(12), nullable=False),
        sa.Column('stage', sa.String(16), nullable=True),
        sa.Column('progress', sa.SmallInteger(), nullable=False, server_default='0'),
        sa.Column('error_kind', sa.String(24), nullable=True),
        sa.Column('attempts', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('next_run_at', TZ, nullable=True),
        sa.Column('source_host', sa.String(64), nullable=True),
        sa.Column('source_url', sa.Text(), nullable=True),
        sa.Column('upload_total', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('upload_received', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('duration_ms', sa.Integer(), nullable=True),
        sa.Column('media_path', sa.String(200), nullable=True),
        sa.Column('poster_path', sa.String(200), nullable=True),
        sa.Column('media_mime', sa.String(32), nullable=True),
        sa.Column('library_bytes', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('sub_source', sa.String(10), nullable=True),
        sa.Column('asr_seconds', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('seg_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('resume_ms', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('resume_idx', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('rate_pct', sa.Integer(), nullable=False, server_default='100'),
        sa.Column('created_at', TZ, nullable=False),
        sa.Column('updated_at', TZ, nullable=False),
        sa.Column('last_opened_at', TZ, nullable=True),
    )
    op.create_index('ix_library_items_user_id_created_at', 'library_items', ['user_id', 'created_at'])
    op.create_index('ix_library_items_status_next_run_at', 'library_items', ['status', 'next_run_at'])
    op.create_table(
        'library_segments',
        _item(primary_key=True),
        sa.Column('idx', sa.Integer(), primary_key=True, autoincrement=False),
        sa.Column('start_ms', sa.Integer(), nullable=False),
        sa.Column('end_ms', sa.Integer(), nullable=False),
        sa.Column('text', sa.Text(), nullable=False),
        sa.Column('zh', sa.Text(), nullable=True),
        sa.Column('zh_lang', sa.String(8), nullable=True),
        sa.Column('analysis', sa.Text(), nullable=True),
        sa.Column('analysis_lang', sa.String(8), nullable=True),
    )
    op.create_table(
        'library_attempts',
        sa.Column('id', sa.String(36), primary_key=True),
        _user(),
        _item(),
        sa.Column('seg_idx', sa.Integer(), nullable=False),
        sa.Column('assessment_id', sa.String(36), nullable=True),
        sa.Column('text_hash', sa.String(16), nullable=False),
        sa.Column('score', sa.SmallInteger(), nullable=True),
        sa.Column('created_at', TZ, nullable=False),
    )
    op.create_index('ix_library_attempts_item_id_seg_idx', 'library_attempts', ['item_id', 'seg_idx'])


def downgrade() -> None:
    op.drop_index('ix_library_attempts_item_id_seg_idx', table_name='library_attempts')
    op.drop_table('library_attempts')
    op.drop_table('library_segments')
    op.drop_index('ix_library_items_status_next_run_at', table_name='library_items')
    op.drop_index('ix_library_items_user_id_created_at', table_name='library_items')
    op.drop_table('library_items')
````

Edit `server/app/admin/users_admin.py` —— old_string:

````python
    AgentTutorSession,
)
````

new_string:

````python
    AgentTutorSession,
    LibraryAttempt, LibraryItem, LibrarySegment,
)
````

Edit `server/app/admin/users_admin.py` —— old_string:

````python
    (AgentMemoryTombstone, "user_id"), (AgentTutorSession, "user_id"),
)
````

new_string:

````python
    (AgentMemoryTombstone, "user_id"), (AgentTutorSession, "user_id"),
    (LibraryAttempt, "user_id"), (LibraryItem, "user_id"),  # segments go first, by item (no user_id column)
)
````

Edit `server/app/admin/users_admin.py` —— old_string:

````python
    for model, column in USER_ROWS:
        await session.execute(delete(model).where(getattr(model, column) == user_id))
````

new_string:

````python
    # library sentences reference the user's items, not the user (spec 2026-10-13-video-import §4)
    await session.execute(delete(LibrarySegment).where(LibrarySegment.item_id.in_(
        select(LibraryItem.id).where(LibraryItem.user_id == user_id))))
    for model, column in USER_ROWS:
        await session.execute(delete(model).where(getattr(model, column) == user_id))
````

- [ ] **Step 4: 运行通过** — `cd server && uv run pytest -q tests/test_library_models.py tests/test_migrations.py tests/test_admin_users.py tests/test_architecture.py` → 全绿。

- [ ] **Step 5: 提交**

```bash
git add server/tests/test_library_models.py server/tests/test_migrations.py server/app/models.py server/alembic/versions/0018_library.py server/app/admin/users_admin.py
git commit -m "feat(server): library tables and migration 0018" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 3: `app/library` 包骨架:错误种类、路径、常量与准入;分层规则

**Files:**
- Create: `server/tests/test_library_basics.py`、`server/app/library/__init__.py`、`server/app/library/errors.py`、`server/app/library/paths.py`、`server/app/library/limits.py`
- Modify: `server/tests/test_architecture.py`

**Interfaces(Produces):** `app.library.errors`(`PERMANENT` / `LINK` / `TRANSIENT` / `KINDS` / `ADMIT` / `API_ERRORS` / `LibraryError` / `Aborted` / `is_transient` / `api_error` / `http_error`)、`paths`(`item_rel` / `tmp_rel` / `item_dir` / `tmp_dir` / `tmp_root` / `absolute` / `remove_tree` / `remove_item_files` / `remove_user_files` / `file_bytes` / `disk_free` / `replace`)、`limits`(常量、`reserve` / `release` / `used_bytes` / `item_count` / `uploads_in_progress` / `admit_new_item` / `refund_new_item`、`SCOPE_IMPORTS` / `SCOPE_ASR` / `GLOBAL`);分层新增 `library`。

- [ ] **Step 1: 写失败测试**

Write `server/tests/test_library_basics.py`:

````python
"""跟读库的路径、错误种类与每日计数 / 准入(spec §5.1、§6.6、§8)。"""
import pytest

from app.core import config as config_module
from app.library import errors, limits, paths
from app.models import DailyUsage, LibraryItem, User
from sqlalchemy import select

ITEM = "0f0e0d0c-0b0a-4908-8706-050403020100"


# ---- paths ----

def test_layout_and_escape_checks(tmp_path):
    assert paths.item_rel(12345678, ITEM) == f"library/12345678/{ITEM}"
    assert paths.tmp_rel(ITEM) == f"library/_tmp/{ITEM}"
    assert paths.item_dir(tmp_path, 12345678, ITEM) == (tmp_path / "library" / "12345678" / ITEM).resolve()
    for bad in ("../x", "..", ITEM.upper(), ITEM + "/..", "", "a" * 36):
        with pytest.raises(ValueError):
            paths.tmp_rel(bad)
    for bad in (0, -1, True, "12"):
        with pytest.raises(ValueError):
            paths.user_rel(bad)
    with pytest.raises(ValueError):
        paths.absolute(tmp_path, "../outside")
    with pytest.raises(ValueError):
        paths.absolute(tmp_path, ".")


def test_remove_user_files_takes_the_user_dir_and_their_staging_only(tmp_path):
    other = "11111111-2222-4333-8444-555555555555"
    for rel in (f"library/7/{ITEM}/media.mp4", f"library/_tmp/{ITEM}/in.mp4", f"library/8/{other}/media.mp4",
                f"library/_tmp/{other}/in.mp4"):
        (tmp_path / rel).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / rel).write_bytes(b"x")
    paths.remove_user_files(tmp_path, 7, [ITEM, "not-an-id"])
    assert not (tmp_path / "library/7").exists() and not (tmp_path / f"library/_tmp/{ITEM}").exists()
    assert (tmp_path / f"library/8/{other}/media.mp4").exists() and (tmp_path / f"library/_tmp/{other}").exists()


def test_disk_free_walks_up_to_an_existing_parent(tmp_path):
    assert paths.disk_free(tmp_path / "a" / "b" / "c") > 0
    assert paths.file_bytes(tmp_path / "missing") == 0


# ---- errors ----

def test_error_kinds_match_the_spec():
    assert errors.TRANSIENT == {"upstream", "network", "ytdlp_transient"}
    assert {"too_large", "too_long", "quota", "corrupt", "no_audio", "bad_subtitle", "no_subtitles", "disk_full",
            "unsupported_format", "upload_expired"} == errors.PERMANENT
    assert {"drm", "blocked", "login_required", "unsupported_site", "ytdlp_failed"} <= errors.LINK
    assert not (errors.PERMANENT & errors.LINK) and not (errors.TRANSIENT & (errors.PERMANENT | errors.LINK))
    assert all(len(k) <= 24 for k in errors.ALL)  # library_items.error_kind is String(24)
    assert errors.LibraryError("corrupt").kind == "corrupt" and str(errors.LibraryError("corrupt")) == "corrupt"
    assert errors.LibraryError("max_items").kind == "max_items"  # an admission code (never stored)
    with pytest.raises(ValueError):
        errors.LibraryError("Traceback: secret text")
    assert errors.is_transient("network") and not errors.is_transient("drm") and not errors.is_transient(None)


# ---- daily counters and admission ----

async def _user(app, uid=12345678, name="u1"):
    async with app.state.sessionmaker() as s:
        s.add(User(id=uid, username=name, password_hash="x"))
        await s.commit()
    return uid


async def test_reserve_and_release_by_amount(app):
    async with app.state.sessionmaker() as s:
        assert await limits.reserve(s, "library_asr", "7", "2026-10-13", 30, 100)
        assert await limits.reserve(s, "library_asr", "7", "2026-10-13", 70, 100)
        assert not await limits.reserve(s, "library_asr", "7", "2026-10-13", 1, 100)
        assert not await limits.reserve(s, "library_asr", "8", "2026-10-13", 101, 100)
        assert await limits.reserve(s, "library_asr", "8", "2026-10-13", 0, 0)
        await limits.release(s, "library_asr", "7", "2026-10-13", 40)
        await limits.release(s, "library_asr", "7", "2026-10-13", 500)
        await limits.release(s, "library_asr", "9", "2026-10-13", 5)  # no row: nothing happens
        row = await s.scalar(select(DailyUsage).where(DailyUsage.subject == "7"))
    assert row.count == 0


async def test_used_bytes_counts_stored_media_and_announced_uploads(app):
    uid = await _user(app)
    async with app.state.sessionmaker() as s:
        s.add_all([
            LibraryItem(user_id=uid, kind="video", source="upload", title="a", status="ready", library_bytes=100),
            LibraryItem(user_id=uid, kind="video", source="upload", title="b", status="uploading", upload_total=50),
            LibraryItem(user_id=uid, kind="video", source="upload", title="c", status="processing", upload_total=7),
            LibraryItem(user_id=uid, kind="video", source="upload", title="d", status="canceled", upload_total=999),
            LibraryItem(user_id=uid, kind="audio", source="upload", title="e", status="failed", upload_total=999,
                        library_bytes=3),
        ])
        await s.commit()
        assert await limits.used_bytes(s, uid) == 100 + 50 + 7 + 3
        assert await limits.item_count(s, uid) == 4
        assert await limits.uploads_in_progress(s, uid) == 1


@pytest.fixture
def settings_overrides():
    return {"library_enabled": True, "library_max_items": 2, "library_quota_mb": 1, "library_imports_daily_per_user": 3}


async def _refused(session, app, uid, **kw) -> str | None:
    try:
        await limits.admit_new_item(session, app, uid, **kw)
    except errors.LibraryError as e:
        return e.kind
    return None


async def test_admit_checks_in_order_and_spends_the_daily_count_last(app, monkeypatch):
    monkeypatch.setattr(config_module, "media_tools_present", lambda: True)
    uid = await _user(app)
    async with app.state.sessionmaker() as s:
        assert await _refused(s, app, uid, size_bytes=limits.MB + 1, upload=True) == "quota"
        assert await _refused(s, app, uid, size_bytes=10, upload=True) is None
        s.add_all([LibraryItem(user_id=uid, kind="video", source="upload", title=t, status="uploading", upload_total=1)
                   for t in "ab"])
        await s.commit()
        assert await _refused(s, app, uid, size_bytes=10, upload=True) == "max_items"
        count = await s.scalar(select(DailyUsage.count).where(DailyUsage.scope == "library_imports"))
        assert count == 1  # refused requests never spent it
        await limits.refund_new_item(s, app, uid)
        assert await s.scalar(select(DailyUsage.count).where(DailyUsage.scope == "library_imports")) == 0


async def test_admit_parallel_uploads_and_daily_cap(app, monkeypatch):
    monkeypatch.setattr(config_module, "media_tools_present", lambda: True)
    app.state.settings = app.state.settings.model_copy(update={"library_max_items": 100, "library_quota_mb": 100})
    uid = await _user(app)
    async with app.state.sessionmaker() as s:
        s.add_all([LibraryItem(user_id=uid, kind="video", source="upload", title=t, status="uploading", upload_total=1)
                   for t in "ab"])
        await s.commit()
        assert await _refused(s, app, uid, size_bytes=1, upload=True) == "uploads"
        for _ in range(3):
            assert await _refused(s, app, uid) is None
        assert await _refused(s, app, uid) == "daily"


async def test_admit_is_unavailable_without_ffmpeg(app, monkeypatch):
    monkeypatch.setattr(config_module, "media_tools_present", lambda: False)
    uid = await _user(app)
    async with app.state.sessionmaker() as s:
        assert await _refused(s, app, uid, size_bytes=1, upload=True) == "unavailable"


def test_http_errors_are_fixed_english_texts():
    e = errors.http_error(errors.LibraryError("daily"))
    assert (e.status_code, e.detail) == (429, "Daily import limit reached")
    assert errors.http_error(errors.LibraryError("drm")).status_code == 400
    assert errors.api_error("ticket").status_code == 401
    assert errors.KINDS == errors.ALL and not (errors.ADMIT - {"quota"}) & errors.KINDS
````

Edit `server/tests/test_architecture.py` —— old_string:

````python
    links      -> core, providers, speech, services, rank, rooms, wordbook, agents (top layer: only routers and main)
    admin      -> core, providers, speech, services, realtime, rank, rooms, wordbook, agents (admin console logic)
````

new_string:

````python
    links      -> core, providers, speech, services, rank, rooms, wordbook, agents (top layer: only routers and main)
    library    -> core, providers, speech, services (imported media library: only admin, routers and main import it)
    admin      -> core, providers, speech, services, realtime, rank, rooms, wordbook, agents, library (admin console logic)
````

Edit `server/tests/test_architecture.py` —— old_string:

````python
LAYERS = ("core", "providers", "speech", "services", "realtime", "rank", "rooms", "wordbook", "agents", "links",
          "admin", "routers")
````

new_string:

````python
LAYERS = ("core", "providers", "speech", "services", "realtime", "rank", "rooms", "wordbook", "agents", "links",
          "library", "admin", "routers")
````

Edit `server/tests/test_architecture.py` —— old_string:

````python
    "links": {"links", "core", "models", "providers", "speech", "services", "rank", "rooms", "wordbook", "agents"},
    "admin": {"admin", "core", "models", "providers", "speech", "services", "realtime", "rank", "rooms", "wordbook",
              "agents"},
    "routers": {"routers", "core", "models", "providers", "speech", "services", "realtime", "rank", "rooms", "wordbook",
                "admin", "links", "agents"},
    "main": {"core", "models", "providers", "speech", "services", "realtime", "rank", "rooms", "wordbook", "admin",
             "routers", "links", "agents"},
````

new_string:

````python
    "links": {"links", "core", "models", "providers", "speech", "services", "rank", "rooms", "wordbook", "agents"},
    "library": {"library", "core", "models", "providers", "speech", "services"},
    "admin": {"admin", "core", "models", "providers", "speech", "services", "realtime", "rank", "rooms", "wordbook",
              "agents", "library"},
    "routers": {"routers", "core", "models", "providers", "speech", "services", "realtime", "rank", "rooms", "wordbook",
                "admin", "links", "agents", "library"},
    "main": {"core", "models", "providers", "speech", "services", "realtime", "rank", "rooms", "wordbook", "admin",
             "routers", "links", "agents", "library"},
````

Edit `server/tests/test_architecture.py` —— old_string:

````python
            assert ok, f"app/{rel}:{lineno} imports {target}"
````

new_string:

````python
            assert ok, f"app/{rel}:{lineno} imports {target}"


def test_library_layer_rules(tmp_path):
    """spec 2026-10-13-video-import §3: library imports only core/models/providers/speech/services; only admin, routers
    and main import it (links, agents, rooms, rank, wordbook, realtime, services, speech and core may not)."""
    app = tmp_path / "app"
    for pkg in ("library", "admin", "routers", "links", "agents", "rooms", "rank", "wordbook", "realtime", "services",
                "speech", "core"):
        (app / pkg).mkdir(parents=True)
        (app / pkg / "__init__.py").write_text("", encoding="utf-8")
    (app / "__init__.py").write_text("", encoding="utf-8")
    bad = {  # file -> (source, line of the bad import)
        "library/a.py": ("from app.admin import audit\n", 1),
        "library/b.py": ("def f():\n    from app.routers import library\n", 2),
        "library/c.py": ("from app.agents import orchestrator\n", 1),
        "library/d.py": ("from app.links import gate\n", 1),
        "library/e.py": ("from app.rooms import audio\n", 1),
        "library/f.py": ("from app.realtime import x\n", 1),
        "links/g.py": ("from app.library import store\n", 1),
        "agents/h.py": ("from app.library import store\n", 1),
        "rooms/i.py": ("from app.library import store\n", 1),
        "services/j.py": ("from app.library import store\n", 1),
        "speech/k.py": ("import app.library.segment\n", 1),
        "core/l.py": ("from app.library.paths import tmp_dir\n", 1),
    }
    ok = {
        "library/ok.py": "from app.speech.sentence_split import split_all\nfrom app.services import usage\n"
                         "from app.core import metering\nfrom app.models import LibraryItem\nfrom app.library import paths\n",
        "admin/ok.py": "from app.library import paths\n",
        "routers/ok.py": "from app.library import store\n",
    }
    for rel, (src, _) in bad.items():
        (app / rel).write_text(src, encoding="utf-8")
    for rel, src in ok.items():
        (app / rel).write_text(src, encoding="utf-8")
    found = violations(app)
    for rel, (_, line) in bad.items():
        assert any(p.startswith(f"app/{rel}:{line}") for p in found), rel
    assert not any(p.startswith(tuple(f"app/{rel}" for rel in ok)) for p in found)
````

- [ ] **Step 2: 运行确认失败** — `cd server && uv run pytest -q tests/test_library_basics.py` → `ModuleNotFoundError: No module named 'app.library'`(`test_library_basics.py` 收集失败)。`test_architecture.py` 的新用例只扫临时目录,这一步已能通过;它的作用是钉住新层的规则。

- [ ] **Step 3: 实现**

Write `server/app/library/__init__.py`:

````python
"""跟读库:导入音视频 / 链接 + 逐句跟读(spec docs/superpowers/specs/2026-10-13-video-import-design.md)。

一条处理流水线 + 一个进程内后台队列(`worker.LibraryWorker`,挂在 `app.state.library`);只有 admin、routers 与
`main.py` 导入本包(`tests/test_architecture.py::test_library_layer_rules`)。见本目录 CLAUDE.md。"""
````

Write `server/app/library/errors.py`:

````python
"""错误种类(spec §6.6)与接口的固定英文错误文本。

- `KINDS`(= `PERMANENT | LINK | TRANSIENT`)是能写进 `library_items.error_kind` 的全部取值:英文常量,只存种类,
  不存上游文本;网页用映射表翻成中文。
- `ADMIT` 是新建条目被拒的原因码(只出现在 HTTP 响应里,永不入库);`LibraryError` 两种都接受。
- `API_ERRORS` / `http_error`:接口错误的状态码与固定英文串(`{"error": ...}`),契约夹具把它录给网页的
  `LIBRARY_SERVER_ERRORS`。计划 S2 的 `POST /imports` 也经 `http_error` 转换准入错误。
"""
from fastapi import HTTPException

PERMANENT = frozenset({
    "too_large", "too_long", "quota", "corrupt", "no_audio", "bad_subtitle", "no_subtitles", "disk_full",
    "unsupported_format", "upload_expired",
})
LINK = frozenset({
    "link_disabled", "bad_url", "drm", "private", "geo_blocked", "login_required", "blocked", "playlist_unsupported",
    "live_unsupported", "unsupported_site", "ytdlp_failed",
})
TRANSIENT = frozenset({"upstream", "network", "ytdlp_transient"})
ALL = PERMANENT | LINK | TRANSIENT
KINDS = ALL
ADMIT = frozenset({"unavailable", "max_items", "quota", "uploads", "daily"})

API_ERRORS: dict[str, tuple[int, str]] = {
    "disabled": (404, "Library is disabled"),
    "not_found": (404, "Not Found"),
    "unavailable": (503, "Media tools are not installed"),
    "format": (400, "Unsupported file type"),
    "too_large": (413, "File is too large"),
    "chunk_too_large": (413, "Chunk is too large"),
    "quota": (409, "Library storage quota reached"),
    "max_items": (409, "Library item limit reached"),
    "uploads": (409, "Too many uploads in progress"),
    "daily": (429, "Daily import limit reached"),
    "not_uploading": (409, "Upload is not in progress"),
    "unexpected_chunk": (409, "Unexpected chunk"),
    "chunk_size": (400, "Wrong chunk size"),
    "chunk_required": (400, "Chunk is required"),
    "incomplete": (409, "Upload is incomplete"),
    "upload_expired": (409, "Upload expired"),
    "file_required": (400, "Subtitle file is required"),
    "bad_subtitle": (400, "Invalid subtitle file"),
    "subs_state": (409, "Subtitles cannot be changed now"),
    "not_ready": (409, "Item is not ready"),
    "not_failed": (409, "Item has not failed"),
    "no_material": (409, "Nothing left to retry"),
    "not_active": (409, "Item cannot be canceled"),
    "no_changes": (400, "No changes"),
    "bad_resume": (400, "Invalid resume position"),
    "bad_text": (400, "Invalid sentence text"),
    "bad_times": (400, "Invalid sentence times"),
    "segment_missing": (404, "Sentence not found"),
    "assessment": (400, "Assessment does not match"),
    "ticket": (401, "Invalid ticket"),
    # D8:译文与分析
    "ai_disabled": (404, "AI is disabled"),
    "language": (400, "Unsupported language"),
    "ai_user_cap": (429, "Daily analysis limit reached"),
    "ai_global_cap": (429, "Daily AI limit reached"),
    "ai_unavailable": (503, "AI is unavailable"),
}


class LibraryError(Exception):
    """A pipeline stage failed with one of `KINDS`, or a new item was refused with one of `ADMIT`.
    The message is the code itself, never upstream text."""

    def __init__(self, kind: str):
        if kind not in ALL and kind not in ADMIT:
            raise ValueError(f"unknown library error kind: {kind}")
        super().__init__(kind)
        self.kind = kind


class Aborted(Exception):
    """The item was canceled or deleted while its job ran: stop quietly, clean up, write nothing."""


def is_transient(kind: str | None) -> bool:
    return kind in TRANSIENT


def api_error(code: str) -> HTTPException:
    status, text = API_ERRORS[code]
    return HTTPException(status, text)


def http_error(err: LibraryError) -> HTTPException:
    """A refused new item (or any library error that reaches an endpoint) as the fixed HTTP error."""
    status, text = API_ERRORS.get(err.kind, (400, "Invalid request"))
    return HTTPException(status, text)
````

Write `server/app/library/paths.py`:

````python
"""跟读库的文件布局(spec §5.1),全部在 `Settings.resolved_data_dir` 下:

    library/<user_id>/<item_id>/media.mp4 | media.m4a | media.mp3
    library/<user_id>/<item_id>/poster.jpg            # 仅视频
    library/_tmp/<item_id>/                           # 分片、下载、WAV、chunks.json;完成 / 取消 / 失败清理时整个删除

路径逃逸检查与 `services.recordings.absolute_path` 相同;id 先按形状校验,任何外部输入都拼不出数据目录外的路径。
"""
import os
import re
import shutil
from pathlib import Path

ROOT = "library"
TMP = "_tmp"
_ITEM_ID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def check_item_id(item_id: str) -> str:
    if not isinstance(item_id, str) or not _ITEM_ID.fullmatch(item_id):
        raise ValueError("Invalid item id")
    return item_id


def check_user_id(user_id: int) -> int:
    if not isinstance(user_id, int) or isinstance(user_id, bool) or user_id <= 0:
        raise ValueError("Invalid user id")
    return user_id


def absolute(data_dir: Path, relpath: str) -> Path:
    root = Path(data_dir).resolve()
    path = (root / relpath).resolve()
    if not path.is_relative_to(root) or path == root:
        raise ValueError("Library path escapes the data directory")
    return path


def user_rel(user_id: int) -> str:
    return f"{ROOT}/{check_user_id(user_id)}"


def item_rel(user_id: int, item_id: str) -> str:
    return f"{user_rel(user_id)}/{check_item_id(item_id)}"


def tmp_rel(item_id: str) -> str:
    return f"{ROOT}/{TMP}/{check_item_id(item_id)}"


def item_dir(data_dir: Path, user_id: int, item_id: str) -> Path:
    return absolute(data_dir, item_rel(user_id, item_id))


def tmp_dir(data_dir: Path, item_id: str) -> Path:
    return absolute(data_dir, tmp_rel(item_id))


def tmp_root(data_dir: Path) -> Path:
    return absolute(data_dir, f"{ROOT}/{TMP}")


def remove_tree(path: Path) -> None:
    """Best effort: a missing directory is fine; errors are swallowed (the daily sweep tries again)."""
    shutil.rmtree(path, ignore_errors=True)


def remove_item_files(data_dir: Path, user_id: int, item_id: str) -> None:
    remove_tree(item_dir(data_dir, user_id, item_id))
    remove_tree(tmp_dir(data_dir, item_id))


def remove_user_files(data_dir: Path, user_id: int, item_ids: list[str]) -> None:
    """Deleting a user: their whole library directory plus the staging directories of their items."""
    remove_tree(absolute(data_dir, user_rel(user_id)))
    for item_id in item_ids:
        try:
            remove_tree(tmp_dir(data_dir, item_id))
        except ValueError:
            continue


def file_bytes(path: Path) -> int:
    try:
        return path.stat().st_size
    except OSError:
        return 0


def disk_free(path: Path) -> int:
    """Free bytes on the volume that holds `path` (its nearest existing parent)."""
    probe = Path(path)
    while not probe.exists() and probe != probe.parent:
        probe = probe.parent
    return shutil.disk_usage(probe).free


def replace(src: Path, dst: Path) -> None:
    """Atomic move inside the data volume (`_tmp` and the final directory are on the same file system)."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    os.replace(src, dst)
````

Write `server/app/library/limits.py`:

````python
"""跟读库的代码常量(spec §5.2 末段)、每日计数与新建条目的准入检查。

每日计数用现有的 `daily_usage`(不新增表):`library_imports`(每人每天新建条目次数,subject = 用户 id)与
`library_asr`(识别秒数,subject = 用户 id 与 `*`)。`reserve` 一次加 N(识别按秒预留),条件 UPDATE 保证并发也不超限。
"""
from datetime import datetime, timezone

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import insert_ignore
from app.core.quotas import effective
from app.library.errors import LibraryError
from app.models import DailyUsage, LibraryItem
from app.services import usage

MB = 1_048_576
CHUNK_BYTES = 8 * MB  # one upload chunk (spec §8)
CHUNK_SLACK = 64 * 1024  # multipart framing around one chunk
MAX_PARALLEL_UPLOADS = 2
UPLOAD_EXTENSIONS = ("mp4", "m4v", "mov", "webm", "mkv", "mp3", "m4a", "aac", "wav", "ogg", "opus", "flac")
AUDIO_EXTENSIONS = frozenset({"mp3", "m4a", "aac", "wav", "ogg", "opus", "flac"})  # the kind shown until the probe
SUBTITLE_MAX_BYTES = 2 * MB
SUBTITLE_MAX_CUES = 20_000
SEGMENT_TEXT_MAX = 600
TITLE_MAX = 200
RATE_BOUNDS = (50, 125)
AUTO_RETRIES = 2
BACKOFF_SECONDS = (30, 120)
FAILED_KEEP_DAYS = 7
UPLOAD_EXPIRE_HOURS = 24
TICKET_TTL_SECONDS = 30 * 60
TICKET_MAX = 1000
ASR_CHUNK_MIN_MS = 15_000
ASR_CHUNK_TARGET_MS = 25_000
ASR_CHUNK_MAX_MS = 50_000
ASR_HARD_CUT_MS = 40_000
ASR_CONCURRENCY = 2
ASR_CHUNK_RETRIES = 2
POLL_SECONDS = 2.0
SHUTDOWN_WAIT_SECONDS = 2.0
LIST_LIMIT = 50
ACTIVE = ("uploading", "queued", "processing")

SCOPE_IMPORTS = "library_imports"
SCOPE_ASR = "library_asr"
GLOBAL = "*"


def day_of(now: datetime) -> str:
    return usage.utc_day(now)


async def reserve(session: AsyncSession, scope: str, subject: str, day: str, amount: int, limit: int) -> bool:
    """Add `amount` to today's counter unless that would pass `limit` (commits). amount <= 0 always succeeds."""
    if amount <= 0:
        return True
    if amount > limit:
        return False
    match = (DailyUsage.scope == scope, DailyUsage.subject == subject, DailyUsage.day == day)
    for _ in range(2):
        result = await session.execute(update(DailyUsage).where(*match, DailyUsage.count + amount <= limit)
                                       .values(count=DailyUsage.count + amount))
        if result.rowcount:
            await session.commit()
            return True
        if await session.scalar(select(DailyUsage.id).where(*match)) is not None:
            break
        inserted = await session.execute(
            insert_ignore(session, DailyUsage).values(scope=scope, subject=subject, day=day, count=amount))
        if inserted.rowcount:
            await session.commit()
            return True
    await session.commit()
    return False


async def release(session: AsyncSession, scope: str, subject: str, day: str, amount: int) -> None:
    """Give back up to `amount` (never below zero; commits)."""
    if amount <= 0:
        return
    match = (DailyUsage.scope == scope, DailyUsage.subject == subject, DailyUsage.day == day)
    current = await session.scalar(select(DailyUsage.count).where(*match))
    if current:
        await session.execute(update(DailyUsage).where(*match).values(count=max(0, current - amount)))
    await session.commit()


async def used_bytes(session: AsyncSession, user_id: int) -> int:
    """Stored media + posters, plus the announced size of items still being uploaded or processed."""
    stored = await session.scalar(select(func.coalesce(func.sum(LibraryItem.library_bytes), 0))
                                  .where(LibraryItem.user_id == user_id))
    pending = await session.scalar(select(func.coalesce(func.sum(LibraryItem.upload_total), 0)).where(
        LibraryItem.user_id == user_id, LibraryItem.status.in_(ACTIVE), LibraryItem.library_bytes == 0))
    return int(stored or 0) + int(pending or 0)


async def item_count(session: AsyncSession, user_id: int) -> int:
    return int(await session.scalar(select(func.count()).select_from(LibraryItem).where(
        LibraryItem.user_id == user_id, LibraryItem.status != "canceled")) or 0)


async def uploads_in_progress(session: AsyncSession, user_id: int) -> int:
    return int(await session.scalar(select(func.count()).select_from(LibraryItem).where(
        LibraryItem.user_id == user_id, LibraryItem.status == "uploading")) or 0)


async def admit_new_item(session: AsyncSession, app, user_id: int, *, size_bytes: int = 0,
                         upload: bool = False) -> None:
    """A new item (upload or link) may be created, and today's import count was taken; else
    `LibraryError(code)` with code `unavailable` | `max_items` | `quota` | `uploads` | `daily`
    (`errors.http_error` turns it into the fixed HTTP error). The daily count is taken last, so a refused request
    never spends it; a caller that fails after this call gives it back with `refund_new_item`."""
    settings = app.state.settings
    if not settings.library_available:
        raise LibraryError("unavailable")
    if await item_count(session, user_id) >= await effective(session, app, user_id, "library_max_items"):
        raise LibraryError("max_items")
    quota = await effective(session, app, user_id, "library_quota_mb") * MB
    if await used_bytes(session, user_id) + max(0, size_bytes) > quota:
        raise LibraryError("quota")
    if upload and await uploads_in_progress(session, user_id) >= MAX_PARALLEL_UPLOADS:
        raise LibraryError("uploads")
    if not await usage.consume(session, SCOPE_IMPORTS, str(user_id), day_of(datetime.now(timezone.utc)),
                               settings.library_imports_daily_per_user):
        raise LibraryError("daily")


async def refund_new_item(session: AsyncSession, app, user_id: int) -> None:
    await usage.refund(session, SCOPE_IMPORTS, str(user_id), day_of(datetime.now(timezone.utc)))
````

- [ ] **Step 4: 运行通过** — `cd server && uv run pytest -q tests/test_library_basics.py tests/test_architecture.py` → 全绿。

- [ ] **Step 5: 提交**

```bash
git add server/tests/test_library_basics.py server/tests/test_architecture.py server/app/library/__init__.py server/app/library/errors.py server/app/library/paths.py server/app/library/limits.py
git commit -m "feat(server): library package with error kinds, paths, limits and admission" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 4: 字幕解析 `subtitles.py`

**Files:**
- Create: `server/tests/test_library_subtitles.py`、`server/app/library/subtitles.py`

**Interfaces(Produces):** `subtitles.Cue`、`decode(data)`、`clean_line(line)`、`parse(data) -> list[Cue]`(坏文件 `LibraryError('bad_subtitle')`)。

- [ ] **Step 1: 写失败测试**

Write `server/tests/test_library_subtitles.py`:

````python
"""字幕解析(spec §6.3「解析」):表驱动。"""
import pytest

from app.library.errors import LibraryError
from app.library.subtitles import Cue, clean_line, decode, parse

SRT = """1
00:00:01,000 --> 00:00:02,500
Hello there.

2
00:00:02,600 --> 00:00:04,000
How are you?
I'm fine.
"""

VTT = """WEBVTT
Kind: captions
Language: en

NOTE this is a comment
with two lines

STYLE
::cue { color: yellow }

intro
00:01.000 --> 00:02.000 align:start position:0%
<c.colorE5E5E5>Good</c> <i>morning</i>

00:00:02.500 --> 00:00:03.250
Tom &amp; Jerry
"""


def test_srt_basic():
    assert parse(SRT.encode()) == [Cue(1000, 2500, "Hello there."), Cue(2600, 4000, "How are you? I'm fine.")]


def test_webvtt_skips_header_note_style_and_cue_settings():
    assert parse(VTT.encode()) == [Cue(1000, 2000, "Good morning"), Cue(2500, 3250, "Tom & Jerry")]


@pytest.mark.parametrize("data", [
    SRT.replace("\n", "\r\n").encode(),
    b"\xef\xbb\xbf" + SRT.encode(),
    SRT.encode("utf-16"),
], ids=["crlf", "utf8-bom", "utf16"])
def test_line_endings_and_encodings(data):
    assert [c.text for c in parse(data)] == ["Hello there.", "How are you? I'm fine."]


def test_latin1_fallback_never_raises():
    data = "1\n00:00:01,000 --> 00:00:02,000\nCaf\xe9 au lait\n".encode("latin-1")
    assert parse(data) == [Cue(1000, 2000, "Café au lait")]


@pytest.mark.parametrize("stamp, ms", [
    ("00:00:01,5", 1500), ("00:00:01,05", 1050), ("01:02:03,004", 3723004), ("02:03.004", 123004), ("1:02:03.4", 3723400),
])
def test_timestamp_forms(stamp, ms):
    cues = parse(f"{stamp} --> 99:00:00,000\nWord here\n".encode())
    assert cues[0].start_ms == ms


@pytest.mark.parametrize("raw, cleaned", [
    ("[Music]", ""),
    ("(applause)", ""),
    ("(MUSIC PLAYING) Let's go.", "Let's go."),
    ("I said (quietly, to myself) no.", "I said (quietly, to myself) no."),
    ("♪ la la la ♪", "la la la"),
    ("- Are you sure?", "Are you sure?"),
    (">> SPEAKER: hello", "SPEAKER: hello"),
    ("{\\an8}Top line", "Top line"),
    ("<font color=\"#fff\">White</font> <b>bold</b>", "White bold"),
    ("It&#39;s&nbsp;fine", "It's fine"),
    ("你好,今天怎么样?", ""),
    ("Hello 你好", "Hello 你好"),
    ("...", ""),
])
def test_clean_line(raw, cleaned):
    assert clean_line(raw) == cleaned


def test_bilingual_subtitles_keep_only_the_english_line():
    data = "1\n00:00:01,000 --> 00:00:02,000\nWhere are you going?\n你要去哪里?\n".encode()
    assert parse(data) == [Cue(1000, 2000, "Where are you going?")]


def test_out_of_order_and_overlapping_cues_are_sorted_and_kept():
    data = ("2\n00:00:03,000 --> 00:00:04,000\nSecond.\n\n"
            "1\n00:00:01,000 --> 00:00:03,500\nFirst.\n\n"
            "3\n00:00:05,000 --> 00:00:04,000\nBackwards end is dropped.\n").encode()
    assert parse(data) == [Cue(1000, 3500, "First."), Cue(3000, 4000, "Second.")]


def test_rolling_auto_captions_keep_only_the_new_tail():
    data = ("1\n00:00:01,000 --> 00:00:03,000\nso today we are\n\n"
            "2\n00:00:03,000 --> 00:00:05,000\nso today we are\ngoing to talk about\n\n"
            "3\n00:00:05,000 --> 00:00:07,000\ngoing to talk about\nshadowing practice\n").encode()
    assert [c.text for c in parse(data)] == ["so today we are", "going to talk about", "shadowing practice"]


@pytest.mark.parametrize("data", [
    b"",
    b"just some text without any timing\n",
    b"1\n00:00:01,000 --> 00:00:02,000\n[Music]\n",
    bytes(range(256)) * 20,
    b"x" * (2 * 1_048_576 + 1),
], ids=["empty", "no-timing", "music-only", "binary", "too-big"])
def test_bad_files(data):
    with pytest.raises(LibraryError) as e:
        parse(data)
    assert e.value.kind == "bad_subtitle"


def test_too_many_cues():
    one = "00:00:01,000 --> 00:00:02,000\nA word\n\n"
    with pytest.raises(LibraryError):
        parse((one * 20_001).encode())


def test_decode_rejects_mostly_control_characters():
    with pytest.raises(LibraryError):
        decode(b"\x01\x02\x03\x04" * 100)
````

- [ ] **Step 2: 运行确认失败** — `cd server && uv run pytest -q tests/test_library_subtitles.py` → `ModuleNotFoundError: No module named 'app.library.subtitles'`。

- [ ] **Step 3: 实现**

Write `server/app/library/subtitles.py`:

````python
"""SRT / WebVTT 解析与清洗(spec §6.3「解析」;纯函数)。输出按开始时间排序的 `Cue(start_ms, end_ms, text)`,
文本已清洗、单行(多行用空格连接);坏文件一律 `LibraryError("bad_subtitle")`。字幕文本永远不进日志。"""
import html
import re
from dataclasses import dataclass

from app.library.errors import LibraryError
from app.library.limits import SUBTITLE_MAX_BYTES, SUBTITLE_MAX_CUES

_TIME = r"(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})"
_ARROW = re.compile(rf"^\s*{_TIME}\s*-->\s*{_TIME}")
_TAG = re.compile(r"<[^>\n]*>")
_ASS = re.compile(r"\{\\[^}]*\}")
_BRACKETS = re.compile(r"\[[^\]\n]*\]")
_PARENS = re.compile(r"\(([^()\n]{1,40})\)")
_NOTES = re.compile(r"[♪♫]")
_LEAD = re.compile(r"^\s*(?:-|>>)\s*")
_SKIP_BLOCK = ("NOTE", "STYLE", "REGION", "WEBVTT")
_CONTROL_OK = {"\n", "\r", "\t"}


@dataclass(frozen=True)
class Cue:
    start_ms: int
    end_ms: int
    text: str


def decode(data: bytes) -> str:
    """UTF-8 (BOM or not) → UTF-16 with a BOM → latin-1 (never fails); mostly non-printable = binary."""
    if len(data) > SUBTITLE_MAX_BYTES:
        raise LibraryError("bad_subtitle")
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        try:
            text = data.decode("utf-16")
        except UnicodeDecodeError:
            raise LibraryError("bad_subtitle") from None
    else:
        try:
            text = data.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = data.decode("latin-1")
    if text and sum(1 for c in text if not c.isprintable() and c not in _CONTROL_OK) > len(text) * 0.1:
        raise LibraryError("bad_subtitle")
    return text


def _ms(h: str | None, m: str, s: str, frac: str) -> int:
    return ((int(h or 0) * 60 + int(m)) * 60 + int(s)) * 1000 + int(frac.ljust(3, "0")[:3])


def _cjk_share(line: str) -> float:
    letters = [c for c in line if c.isalpha()]
    if not letters:
        return 0.0
    cjk = sum(1 for c in letters if 0x3040 <= ord(c) <= 0x30FF or 0x3400 <= ord(c) <= 0x9FFF
              or 0xAC00 <= ord(c) <= 0xD7AF or 0xF900 <= ord(c) <= 0xFAFF)
    return cjk / len(letters)


def clean_line(line: str) -> str:
    """Tags, entities, sound labels, music notes, dialogue dashes / `>>`; bilingual (mostly CJK) lines are dropped."""
    line = _ASS.sub("", _TAG.sub("", line))
    line = html.unescape(line).replace(" ", " ")
    line = _BRACKETS.sub(" ", line)
    line = _PARENS.sub(lambda m: " " if not re.search(r"[.,!?;:]", m.group(1)) else m.group(0), line)
    line = _NOTES.sub(" ", line)
    line = _LEAD.sub("", line)
    line = " ".join(line.split())
    if not line or _cjk_share(line) > 0.5 or not any(c.isalnum() for c in line):
        return ""
    return line


def _blocks(text: str) -> list[list[str]]:
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    blocks, current = [], []
    for line in lines:
        if line.strip():
            current.append(line)
        elif current:
            blocks.append(current)
            current = []
    if current:
        blocks.append(current)
    return blocks


def parse(data: bytes) -> list[Cue]:
    """Raw SRT or WebVTT bytes → cleaned cues sorted by start (overlaps kept; the segmenter resolves them).
    Rolling auto-captions (a cue that starts with the previous cue's last line) keep only the new tail."""
    text = decode(data)
    raw: list[tuple[int, int, list[str]]] = []
    for block in _blocks(text):
        if block[0].strip().split(" ")[0].upper().rstrip(":") in _SKIP_BLOCK and not _ARROW.match(block[0]):
            continue
        at = next((i for i, line in enumerate(block) if _ARROW.match(line)), None)
        if at is None:
            continue
        m = _ARROW.match(block[at])
        start, end = _ms(*m.groups()[:4]), _ms(*m.groups()[4:])
        if end <= start:
            continue
        raw.append((start, end, block[at + 1:]))
        if len(raw) > SUBTITLE_MAX_CUES:
            raise LibraryError("bad_subtitle")
    if not raw:
        raise LibraryError("bad_subtitle")
    raw.sort(key=lambda r: (r[0], r[1]))
    cues: list[Cue] = []
    previous_last = ""
    for start, end, lines in raw:
        cleaned = [c for c in (clean_line(line) for line in lines) if c]
        if cleaned and previous_last and cleaned[0] == previous_last:
            cleaned = cleaned[1:]
        if lines:
            last = clean_line(lines[-1])
            previous_last = last or previous_last
        if cleaned:
            cues.append(Cue(start, end, " ".join(cleaned)))
    if not cues:  # only music / sound labels / other-language lines
        raise LibraryError("bad_subtitle")
    return cues
````

- [ ] **Step 4: 运行通过** — `cd server && uv run pytest -q tests/test_library_subtitles.py tests/test_architecture.py` → 全绿。

- [ ] **Step 5: 提交**

```bash
git add server/tests/test_library_subtitles.py server/app/library/subtitles.py
git commit -m "feat(server): parse and clean SRT / WebVTT subtitles for the library" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 5: 分句器 `segment.py`(共享夹具 64 例)

**Files:**
- Create: `server/tests/test_library_segment.py`、`server/app/library/segment.py`

**Interfaces(Produces):** `segment.Fragment` / `Sentence` / `Span` / `Aligned`(`text` / `piece_at` / `time_at` / `end_time`)、`align(fragments)`、`finish(aligned)`、`build(fragments, *, adjust=None)`、`set_span`;常量 `MAX_MS` 14000、`MAX_WORDS` 40、`MIN_MS` 1000、`MIN_WORDS` 3、`PREFERRED_GAP_MS` 400。

- [ ] **Step 1: 写失败测试**

Write `server/tests/test_library_segment.py`:

````python
"""分句器(spec §6.3「分句」)。前三组用共享夹具 sentence_cases.json 的全部用例(D3,夹具与切句器都不改)。"""
import json
import random
from pathlib import Path

import pytest

from app.library.segment import Fragment, Sentence, align, build, finish

CASES = json.loads((Path(__file__).parent / "fixtures" / "sentence_cases.json").read_text(encoding="utf-8"))
IDS = [f"case{i}" for i in range(len(CASES))]


def test_the_shared_fixture_has_64_cases():
    assert len(CASES) == 64


@pytest.mark.parametrize("case", CASES, ids=IDS)
def test_a_whole_text_in_one_fragment_gives_the_fixture_sentences(case):
    aligned = align([Fragment(0, 10_000, case["text"])])
    assert [aligned.text(s) for s in aligned.spans] == case["sentences"]


def _split_points(text: str) -> list[int]:
    """Single spaces between two non-space characters: splitting there and re-joining with one space is exact."""
    return [i for i in range(1, len(text) - 1)
            if text[i] == " " and not text[i - 1].isspace() and not text[i + 1].isspace()]


def _fragments(text: str, rng: random.Random) -> list[Fragment]:
    points = _split_points(text)
    k = min(len(points), rng.randint(1, 5))
    cuts = sorted(rng.sample(points, k))
    pieces, last = [], 0
    for c in cuts:
        pieces.append(text[last:c])
        last = c + 1
    pieces.append(text[last:])
    frags, t = [], 0
    for piece in pieces:
        dur = 300 + 40 * len(piece)
        frags.append(Fragment(t, t + dur, piece))
        t += dur + rng.choice([0, 150, 500])
    return frags


@pytest.mark.parametrize("case", CASES, ids=IDS)
def test_b_the_same_text_cut_into_2_to_6_fragments_gives_the_same_sentences(case):
    rng = random.Random(20261013 + CASES.index(case))
    frags = _fragments(case["text"], rng)
    aligned = align(frags)
    assert aligned.joined == (case["text"] if case["text"].strip() else "")
    assert [aligned.text(s) for s in aligned.spans] == case["sentences"]


@pytest.mark.parametrize("case", CASES, ids=IDS)
def test_c_sentence_times_stay_inside_the_fragments_they_cover(case):
    rng = random.Random(7 + CASES.index(case))
    aligned = align(_fragments(case["text"], rng))
    for span in aligned.spans:
        first = aligned.piece_at(span.char_start)[2]
        last = aligned.piece_at(span.char_end - 1)[2]
        assert first.start_ms <= span.start_ms <= span.end_ms <= last.end_ms


def test_interpolation_inside_one_cue():
    aligned = align([Fragment(1000, 3000, "First one here. Second one here.")])
    first, second = aligned.spans
    assert (first.start_ms, second.end_ms) == (1000, 3000)
    assert first.end_ms <= second.start_ms
    assert 1900 <= first.end_ms <= 2000  # 15 of 32 characters


def test_blank_fragments_are_ignored_and_nothing_gives_nothing():
    assert align([]).spans == [] and finish(align([Fragment(0, 1, "  ")])) == []
    aligned = align([Fragment(0, 1000, "Hi there you."), Fragment(1000, 2000, "   "), Fragment(2000, 3000, "Yes it is.")])
    assert aligned.joined == "Hi there you. Yes it is."


def test_long_sentences_split_at_the_widest_cue_gap_first():
    frags = [Fragment(0, 5000, "one two three four five"), Fragment(5100, 10_000, "six seven eight nine ten"),
             Fragment(10_600, 16_000, "eleven twelve thirteen fourteen fifteen")]
    out = build(frags)
    assert [s.text for s in out] == ["one two three four five six seven eight nine ten",
                                     "eleven twelve thirteen fourteen fifteen"]
    assert out[0] == Sentence(0, 10_000, out[0].text) and out[1].start_ms == 10_600


def test_long_sentences_without_cues_split_at_word_boundaries():
    words = " ".join(f"w{i}" for i in range(90))  # 90 words, no punctuation: one 200-char cut by split_all at most
    out = build([Fragment(0, 60_000, words)])
    assert all(len(s.text.split()) <= 40 and s.end_ms - s.start_ms <= 14_000 for s in out)
    assert " ".join(s.text for s in out) == words
    assert all(a.end_ms <= b.start_ms for a, b in zip(out, out[1:]))


def test_short_sentences_merge_backwards_then_forwards():
    frags = [Fragment(0, 3000, "This is the first sentence."), Fragment(3000, 3400, "Yes."),
             Fragment(3500, 3900, "Ok."), Fragment(4000, 7000, "And here is the last one.")]
    assert [s.text for s in build(frags)] == ["This is the first sentence. Yes. Ok.", "And here is the last one."]
    first = build([Fragment(0, 400, "Right."), Fragment(500, 4000, "Then we start the lesson.")])
    assert [s.text for s in first] == ["Right. Then we start the lesson."]
    assert first[0].start_ms == 0 and first[0].end_ms == 4000


def test_a_short_sentence_stays_when_both_merges_would_be_too_long():
    long_a = " ".join(["go"] * 40) + "."  # 40 words (the cap), 120 characters (split_all cuts at 200)
    long_b = " ".join(["no"] * 40) + "."
    out = build([Fragment(0, 13_000, long_a), Fragment(13_000, 13_500, "Hm."), Fragment(13_500, 26_000, long_b)])
    assert [s.text for s in out] == [long_a, "Hm.", long_b]


def test_overlapping_cues_never_give_overlapping_sentences():
    out = build([Fragment(0, 4000, "We start here today."), Fragment(3000, 8000, "Then we go on and on.")])
    assert all(a.end_ms <= b.start_ms for a, b in zip(out, out[1:]))
    assert all(s.start_ms <= s.end_ms for s in out)


def test_every_sentence_fits_the_text_cap():
    text = ". ".join(["word " * 30] * 10)
    assert all(len(s.text) <= 600 for s in build([Fragment(0, 600_000, text)]))


def test_adjust_hook_runs_between_align_and_finish():
    seen = []
    build([Fragment(0, 2000, "Hello there friend.")], adjust=lambda a: seen.append(len(a.spans)))
    assert seen == [1]
````

- [ ] **Step 2: 运行确认失败** — `cd server && uv run pytest -q tests/test_library_segment.py` → `ModuleNotFoundError: No module named 'app.library.segment'`。

- [ ] **Step 3: 实现**

Write `server/app/library/segment.py`:

````python
"""「带时间的片段 → 句子」分句器(spec §6.3「分句」;纯函数)。字幕 cue 与识别块估算出的片段共用它(E6)。

1. 片段文本按一个空格连接,记下每个片段在连接串里的字符区间(`align`)。
2. 调 `app.speech.sentence_split.split_all`(不改它),用游标在连接串里依次定位每个句子。
3. 字符位置 → 时间:片段内按字符比例线性插值(计划 R-SC5;句首在片段开头时就是片段的 start)。
4. `finish`:超长(> 14 s 或 > 40 词)的句子优先在前后间隔 ≥ 400 ms 的片段边界断开,其次任意片段边界,
   最后是最靠近中点的词边界;短句(< 1 s 或 < 3 词)先并入前一句、不行再并入后一句(合并后仍不超限才合);
   句与句不重叠;每句 ≤ 600 字(`split_all` 每句 ≤ 200 字,合并受 600 字约束,所以硬切不会发生,计划 R-SC7)。
存原始起止毫秒;播放缓冲由网页加。
"""
from collections.abc import Callable
from dataclasses import dataclass, replace

from app.library.limits import SEGMENT_TEXT_MAX
from app.speech.sentence_split import split_all

MAX_MS = 14_000
MAX_WORDS = 40
MIN_MS = 1_000
MIN_WORDS = 3
PREFERRED_GAP_MS = 400


@dataclass(frozen=True)
class Fragment:
    start_ms: int
    end_ms: int
    text: str


@dataclass(frozen=True)
class Sentence:
    start_ms: int
    end_ms: int
    text: str


@dataclass(frozen=True)
class Span:
    """A sentence located in the joined text: [char_start, char_end) plus its times."""
    char_start: int
    char_end: int
    start_ms: int
    end_ms: int


@dataclass
class Aligned:
    joined: str
    pieces: list[tuple[int, int, Fragment]]  # (char_start, char_end, fragment) for every non-blank fragment
    spans: list[Span]

    def text(self, span: Span) -> str:
        return self.joined[span.char_start:span.char_end]

    def piece_at(self, pos: int) -> tuple[int, int, Fragment]:
        """The fragment that holds character `pos` (a joining space belongs to the next fragment)."""
        for start, end, frag in self.pieces:
            if pos < end:
                return start, end, frag
        return self.pieces[-1]

    def time_at(self, pos: int) -> int:
        """Linear interpolation inside the fragment that holds `pos` (pos == fragment end -> its end time)."""
        start, end, frag = self.piece_at(pos)
        if pos <= start:
            return frag.start_ms
        if pos >= end:
            return frag.end_ms
        return frag.start_ms + round((frag.end_ms - frag.start_ms) * (pos - start) / max(1, end - start))

    def end_time(self, char_end: int) -> int:
        """Time just after the last character (char_end is exclusive)."""
        start, end, frag = self.piece_at(max(0, char_end - 1))
        if char_end >= end:
            return frag.end_ms
        return frag.start_ms + round((frag.end_ms - frag.start_ms) * (char_end - start) / max(1, end - start))


def align(fragments: list[Fragment]) -> Aligned:
    pieces: list[tuple[int, int, Fragment]] = []
    parts: list[str] = []
    pos = 0
    for frag in fragments:
        if not frag.text.strip():
            continue
        if parts:
            parts.append(" ")
            pos += 1
        pieces.append((pos, pos + len(frag.text), frag))
        parts.append(frag.text)
        pos += len(frag.text)
    joined = "".join(parts)
    aligned = Aligned(joined, pieces, [])
    if not pieces:
        return aligned
    cursor = 0
    for sentence in split_all(joined):
        at = joined.find(sentence, cursor)
        if at < 0:  # cannot happen (split_all returns stripped substrings); skip rather than misplace
            continue
        end = at + len(sentence)
        aligned.spans.append(Span(at, end, aligned.time_at(at), aligned.end_time(end)))
        cursor = end
    return aligned


def _words(text: str) -> int:
    return len(text.split())


def _too_long(aligned: Aligned, span: Span) -> bool:
    return span.end_ms - span.start_ms > MAX_MS or _words(aligned.text(span)) > MAX_WORDS


def _cut_points(aligned: Aligned, span: Span) -> list[tuple[int, int, int]]:
    """(rank, char position, time) of every place the span may be cut: 0 = fragment boundary with a gap >= 400 ms,
    1 = other fragment boundary, 2 = word boundary inside a fragment. The position is the joining space."""
    points = []
    boundaries = {}
    for (s1, e1, f1), (s2, _e2, f2) in zip(aligned.pieces, aligned.pieces[1:]):
        boundaries[e1] = (0 if f2.start_ms - f1.end_ms >= PREFERRED_GAP_MS else 1, f1.end_ms)
    for pos in range(span.char_start + 1, span.char_end - 1):
        if aligned.joined[pos] != " " or aligned.joined[pos - 1] == " ":
            continue
        if pos in boundaries:
            rank, time = boundaries[pos]
        else:
            rank, time = 2, aligned.time_at(pos)
        points.append((rank, pos, time))
    return points


def _split_long(aligned: Aligned, span: Span) -> list[Span]:
    if not _too_long(aligned, span):
        return [span]
    points = _cut_points(aligned, span)
    if not points:
        return [span]
    middle = (span.start_ms + span.end_ms) / 2
    best_rank = min(p[0] for p in points)
    _rank, pos, _time = min((p for p in points if p[0] == best_rank),
                            key=lambda p: (abs(p[2] - middle), p[1]))
    left_end = pos
    right_start = pos + 1
    left = Span(span.char_start, left_end, span.start_ms, aligned.end_time(left_end))
    right = Span(right_start, span.char_end, max(left.end_ms, aligned.time_at(right_start)), span.end_ms)
    return _split_long(aligned, left) + _split_long(aligned, right)


def _merged(a: Span, b: Span) -> Span:
    return Span(a.char_start, b.char_end, min(a.start_ms, b.start_ms), max(a.end_ms, b.end_ms))


def _fits(aligned: Aligned, span: Span) -> bool:
    return not _too_long(aligned, span) and len(aligned.text(span)) <= SEGMENT_TEXT_MAX


def _short(aligned: Aligned, span: Span) -> bool:
    return span.end_ms - span.start_ms < MIN_MS or _words(aligned.text(span)) < MIN_WORDS


def _merge_short(aligned: Aligned, spans: list[Span]) -> list[Span]:
    out = list(spans)
    i = 0
    while i < len(out):
        if not _short(aligned, out[i]):
            i += 1
            continue
        if i > 0 and _fits(aligned, _merged(out[i - 1], out[i])):
            out[i - 1:i + 1] = [_merged(out[i - 1], out[i])]
            i -= 1
            continue
        if i + 1 < len(out) and _fits(aligned, _merged(out[i], out[i + 1])):
            out[i:i + 2] = [_merged(out[i], out[i + 1])]
            continue
        i += 1
    return out


def finish(aligned: Aligned) -> list[Sentence]:
    spans: list[Span] = []
    for span in aligned.spans:
        spans += _split_long(aligned, span)
    spans = _merge_short(aligned, spans)
    out: list[Sentence] = []
    previous_end = 0
    for span in spans:
        start = max(span.start_ms, previous_end)
        end = max(span.end_ms, start)
        text = " ".join(aligned.text(span).split())
        if not text:
            continue
        out.append(Sentence(start, end, text))
        previous_end = end
    return out


def build(fragments: list[Fragment], *, adjust: Callable[[Aligned], None] | None = None) -> list[Sentence]:
    """align → optional in-place boundary adjustment (the transcription path snaps to silences) → finish."""
    aligned = align(fragments)
    if adjust is not None:
        adjust(aligned)
    return finish(aligned)


def set_span(aligned: Aligned, index: int, **changes) -> None:
    aligned.spans[index] = replace(aligned.spans[index], **changes)
````

- [ ] **Step 4: 运行通过** — `cd server && uv run pytest -q tests/test_library_segment.py tests/test_architecture.py` → 全绿。

- [ ] **Step 5: 提交**

```bash
git add server/tests/test_library_segment.py server/app/library/segment.py
git commit -m "feat(server): timed fragments to sentences for the library, on the shared splitter" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 6: B 档转写的分块、吸附与断点 `asr_chunks.py`

**Files:**
- Create: `server/tests/test_library_asr_chunks.py`、`server/app/library/asr_chunks.py`

**Interfaces(Produces):** `asr_chunks.Silence` / `Chunk`、`parse_silences`、`plan_chunks`、`speech_span`、`fragments`、`nearest_mid`、`snapper`、`load_state` / `save_state`、`slice_wav`、`transcribe_chunks(chunks, *, read, transcribe, save, progress, concurrency, retries) -> int`。

- [ ] **Step 1: 写失败测试**

Write `server/tests/test_library_asr_chunks.py`:

````python
"""B 档转写的纯函数与逐块调度(spec §6.4)。"""
import asyncio
import io
import wave

import pytest

from app.library import asr_chunks as ac
from app.library.errors import LibraryError
from app.library.segment import build

LOG = """[Parsed_silencedetect_0 @ 000001] silence_start: -0.01
[Parsed_silencedetect_0 @ 000001] silence_end: 0.4 | silence_duration: 0.41
[aac @ 000002] Qavg: 20622.104
[Parsed_silencedetect_0 @ 000001] silence_start: 2
[Parsed_silencedetect_0 @ 000001] silence_end: 3.000023 | silence_duration: 1.000023
[Parsed_silencedetect_0 @ 000001] silence_start: 9.5
"""


def test_parse_silences_clips_and_closes_the_last_one():
    assert ac.parse_silences(LOG, 10_000) == [ac.Silence(0, 400), ac.Silence(2000, 3000), ac.Silence(9500, 10_000)]
    assert ac.parse_silences("", 5000) == []


def test_short_media_is_one_chunk():
    assert ac.plan_chunks(50_000, []) == [ac.Chunk(0, 50_000)]
    assert ac.plan_chunks(0, []) == []


def test_cut_at_the_longest_silence_in_the_window():
    silences = [ac.Silence(10_000, 11_000), ac.Silence(20_000, 20_500), ac.Silence(30_000, 31_200),
                ac.Silence(60_000, 60_400)]
    chunks = ac.plan_chunks(100_000, silences)
    assert [(c.start_ms, c.end_ms) for c in chunks] == [(0, 30_600), (30_600, 60_200), (60_200, 100_000)]


def test_ties_prefer_the_target_and_no_silence_means_a_hard_cut_at_40_s():
    silences = [ac.Silence(17_000, 17_500), ac.Silence(24_800, 25_300)]
    assert ac.plan_chunks(70_000, silences)[0].end_ms == 25_050
    chunks = ac.plan_chunks(130_000, [])
    assert [(c.start_ms, c.end_ms) for c in chunks] == [(0, 40_000), (40_000, 80_000), (80_000, 130_000)]
    assert all(c.end_ms - c.start_ms <= 50_000 for c in chunks)


def test_speech_span_drops_edge_silences():
    chunk = ac.Chunk(10_000, 30_000)
    silences = [ac.Silence(9_000, 11_000), ac.Silence(29_000, 31_000), ac.Silence(20_000, 21_000)]
    assert ac.speech_span(chunk, silences) == (11_000, 29_000)
    assert ac.speech_span(chunk, [ac.Silence(5_000, 40_000)]) == (10_000, 30_000)


def test_fragments_skip_empty_chunks():
    chunks = [ac.Chunk(0, 10_000, "  Hello   there. "), ac.Chunk(10_000, 20_000, ""), ac.Chunk(20_000, 30_000, None)]
    assert ac.fragments(chunks, []) == [ac.Fragment(0, 10_000, "Hello there.")]


def test_boundaries_inside_a_chunk_snap_to_the_nearest_silence():
    chunk = ac.Chunk(0, 10_000, "One two three four five. Six seven eight nine ten.")
    silences = [ac.Silence(5_300, 5_900)]
    frags = ac.fragments([chunk], silences)
    out = build(frags, adjust=ac.snapper(silences))
    assert [(s.start_ms, s.end_ms) for s in out] == [(0, 5_600), (5_600, 10_000)]


def test_far_silences_do_not_move_a_boundary():
    chunk = ac.Chunk(0, 10_000, "One two three four five. Six seven eight nine ten.")
    out = build(ac.fragments([chunk], [ac.Silence(8_000, 8_500)]), adjust=ac.snapper([ac.Silence(8_000, 8_500)]))
    assert (out[0].end_ms, out[1].start_ms) == (4_800, 5_000)  # plain character-share estimate


def test_state_round_trip_and_bad_files(tmp_path):
    path = tmp_path / "chunks.json"
    chunks = [ac.Chunk(0, 1000, "hi"), ac.Chunk(1000, 2000)]
    ac.save_state(path, chunks)
    assert ac.load_state(path) == chunks
    path.write_text("{not json", encoding="utf-8")
    assert ac.load_state(path) is None
    assert ac.load_state(tmp_path / "missing.json") is None
    path.write_text('{"version": 99, "chunks": []}', encoding="utf-8")
    assert ac.load_state(path) is None


def _wav(path, seconds: float, rate=16000):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x01\x00" * int(rate * seconds))


def test_slice_wav(tmp_path):
    _wav(tmp_path / "a.wav", 3)
    data = ac.slice_wav(tmp_path / "a.wav", 1000, 2500)
    with wave.open(io.BytesIO(data)) as w:
        assert (w.getframerate(), w.getnchannels(), w.getnframes()) == (16000, 1, 24000)
    assert len(ac.slice_wav(tmp_path / "a.wav", 2500, 9000)) == 44 + 2 * 8000
    _wav(tmp_path / "b.wav", 1, rate=8000)
    with pytest.raises(LibraryError):
        ac.slice_wav(tmp_path / "b.wav", 0, 500)


async def test_transcribe_chunks_resumes_and_counts_only_new_seconds():
    chunks = [ac.Chunk(0, 25_000, "done before"), ac.Chunk(25_000, 50_000), ac.Chunk(50_000, 60_500)]
    saved, seen = [], []

    async def read(chunk):
        return f"{chunk.start_ms}".encode()

    async def transcribe(wav):
        seen.append(wav)
        return f" text  {wav.decode()} "

    async def progress(done, total):
        seen.append((done, total))

    spent = await ac.transcribe_chunks(chunks, read=read, transcribe=transcribe,
                                       save=lambda c: saved.append([x.text for x in c]), progress=progress)
    assert spent == 25 + 11
    assert [c.text for c in chunks] == ["done before", "text 25000", "text 50000"]
    assert sorted(w for w in seen if isinstance(w, bytes)) == [b"25000", b"50000"]
    assert saved[-1] == ["done before", "text 25000", "text 50000"] and (3, 3) in seen


async def test_transcribe_chunks_retries_then_fails_and_keeps_finished_chunks():
    chunks = [ac.Chunk(0, 10_000), ac.Chunk(10_000, 20_000)]
    calls = {"b": 0}

    async def read(chunk):
        return b"a" if chunk.start_ms == 0 else b"b"

    async def transcribe(wav):
        if wav == b"b":
            calls["b"] += 1
            raise RuntimeError("upstream text that must never be shown")
        await asyncio.sleep(0)
        return "ok"

    async def progress(done, total):
        pass

    with pytest.raises(LibraryError) as e:
        await ac.transcribe_chunks(chunks, read=read, transcribe=transcribe, save=lambda c: None, progress=progress)
    assert e.value.kind == "upstream" and calls["b"] == 3
    assert chunks[0].text == "ok" and chunks[1].text is None
````

- [ ] **Step 2: 运行确认失败** — `cd server && uv run pytest -q tests/test_library_asr_chunks.py` → `ModuleNotFoundError: No module named 'app.library.asr_chunks'`。

- [ ] **Step 3: 实现**

Write `server/app/library/asr_chunks.py`:

````python
"""无字幕转写(B 档,spec §6.4、E5):静音感知分块 → 逐块现有识别 → 按字符比例估算句边界并吸附到静音点。

纯函数:`parse_silences`(ffmpeg silencedetect 的输出,只取数字)、`plan_chunks`(15–50 s 窗口里最长静音的中点切,
没有静音就在 40 s 处硬切)、`speech_span`(扣掉块首尾静音)、`fragments`、`snapper`(句边界吸附到 ±0.8 s 内最近的
静音中点)。异步:`transcribe_chunks`(并发 ≤ 2、每块重试 2 次、每完成一块就写 `chunks.json`,重试从断点继续,
已完成的块不再花钱)。识别结果与 ffmpeg 输出永远不进日志。"""
import asyncio
import io
import json
import math
import os
import re
import wave
from collections.abc import Awaitable, Callable
from dataclasses import asdict, dataclass
from pathlib import Path

from app.library.errors import LibraryError
from app.library.limits import (
    ASR_CHUNK_MAX_MS, ASR_CHUNK_MIN_MS, ASR_CHUNK_RETRIES, ASR_CHUNK_TARGET_MS, ASR_CONCURRENCY, ASR_HARD_CUT_MS,
)
from app.library.segment import Aligned, Fragment, set_span

SNAP_WINDOW_MS = 800
STATE_VERSION = 1
_START = re.compile(r"silence_start:\s*(-?\d+(?:\.\d+)?)")
_END = re.compile(r"silence_end:\s*(-?\d+(?:\.\d+)?)")


@dataclass(frozen=True)
class Silence:
    start_ms: int
    end_ms: int

    @property
    def mid_ms(self) -> int:
        return (self.start_ms + self.end_ms) // 2

    @property
    def length_ms(self) -> int:
        return self.end_ms - self.start_ms


@dataclass
class Chunk:
    start_ms: int
    end_ms: int
    text: str | None = None  # None = not transcribed yet

    @property
    def seconds(self) -> int:
        return math.ceil((self.end_ms - self.start_ms) / 1000)


def parse_silences(log: str, duration_ms: int) -> list[Silence]:
    """ffmpeg `silencedetect` lines → silences clipped to [0, duration]; an open silence runs to the end."""
    out: list[Silence] = []
    start: int | None = None
    for line in log.splitlines():
        if (m := _START.search(line)) is not None:
            start = max(0, round(float(m.group(1)) * 1000))
        elif (m := _END.search(line)) is not None and start is not None:
            end = min(duration_ms, round(float(m.group(1)) * 1000))
            if end > start:
                out.append(Silence(start, end))
            start = None
    if start is not None and start < duration_ms:
        out.append(Silence(start, duration_ms))
    return out


def plan_chunks(duration_ms: int, silences: list[Silence]) -> list[Chunk]:
    """Greedy from 0: the rest fits in 50 s -> one last chunk; else cut at the middle of the longest silence whose
    middle lies 15-50 s after the chunk start (ties: closest to 25 s); no silence there -> hard cut at 40 s."""
    chunks: list[Chunk] = []
    start = 0
    while start < duration_ms:
        if duration_ms - start <= ASR_CHUNK_MAX_MS:
            chunks.append(Chunk(start, duration_ms))
            break
        lo, hi = start + ASR_CHUNK_MIN_MS, start + ASR_CHUNK_MAX_MS
        inside = [s for s in silences if lo <= s.mid_ms <= hi]
        if inside:
            best = max(inside, key=lambda s: (s.length_ms, -abs(s.mid_ms - (start + ASR_CHUNK_TARGET_MS))))
            cut = best.mid_ms
        else:
            cut = start + ASR_HARD_CUT_MS
        chunks.append(Chunk(start, cut))
        start = cut
    return chunks


def speech_span(chunk: Chunk, silences: list[Silence]) -> tuple[int, int]:
    """The chunk minus a silence touching its start and one touching its end (whole chunk if nothing is left)."""
    s0, s1 = chunk.start_ms, chunk.end_ms
    for s in silences:
        if s.start_ms <= s0 < s.end_ms:
            s0 = min(s.end_ms, chunk.end_ms)
        if s.start_ms < s1 <= s.end_ms:
            s1 = max(s.start_ms, chunk.start_ms)
    return (s0, s1) if s1 > s0 else (chunk.start_ms, chunk.end_ms)


def fragments(chunks: list[Chunk], silences: list[Silence]) -> list[Fragment]:
    out = []
    for chunk in chunks:
        text = " ".join((chunk.text or "").split())
        if text:
            s0, s1 = speech_span(chunk, silences)
            out.append(Fragment(s0, s1, text))
    return out


def nearest_mid(t: int, silences: list[Silence], window: int = SNAP_WINDOW_MS) -> int | None:
    best = min(silences, key=lambda s: abs(s.mid_ms - t), default=None)
    return best.mid_ms if best is not None and abs(best.mid_ms - t) <= window else None


def snapper(silences: list[Silence]) -> Callable[[Aligned], None]:
    """Boundary between two consecutive sentences of the same chunk -> both sides move to the nearest silence
    middle within ±0.8 s (kept inside that chunk). Chunk edges already sit in silences: they are not moved."""
    def adjust(aligned: Aligned) -> None:
        for i in range(len(aligned.spans) - 1):
            a, b = aligned.spans[i], aligned.spans[i + 1]
            piece_a = aligned.piece_at(max(a.char_start, a.char_end - 1))
            piece_b = aligned.piece_at(b.char_start)
            if piece_a[0] != piece_b[0]:  # the boundary is a chunk edge (already in a silence)
                continue
            frag = piece_a[2]
            mid = nearest_mid((a.end_ms + b.start_ms) // 2, silences)
            if mid is None or not frag.start_ms < mid < frag.end_ms or not a.start_ms < mid < b.end_ms:
                continue
            set_span(aligned, i, end_ms=mid)
            set_span(aligned, i + 1, start_ms=mid)
    return adjust


# ---- state file and WAV slices ----

def load_state(path: Path) -> list[Chunk] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("version") != STATE_VERSION:
            return None
        return [Chunk(int(c["start_ms"]), int(c["end_ms"]), c.get("text")) for c in data["chunks"]]
    except (OSError, ValueError, KeyError, TypeError):
        return None


def save_state(path: Path, chunks: list[Chunk]) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps({"version": STATE_VERSION, "chunks": [asdict(c) for c in chunks]}), encoding="utf-8")
    os.replace(tmp, path)


def slice_wav(path: Path, start_ms: int, end_ms: int) -> bytes:
    """[start, end) of a 16 kHz mono 16-bit WAV as its own WAV."""
    with wave.open(str(path), "rb") as src:
        rate = src.getframerate()
        if rate != 16000 or src.getnchannels() != 1 or src.getsampwidth() != 2:
            raise LibraryError("corrupt")
        first = max(0, start_ms * rate // 1000)
        count = max(0, min(src.getnframes(), end_ms * rate // 1000) - first)
        src.setpos(min(first, src.getnframes()))
        pcm = src.readframes(count)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(16000)
        out.writeframes(pcm)
    return buf.getvalue()


async def transcribe_chunks(chunks: list[Chunk], *, read: Callable[[Chunk], Awaitable[bytes]],
                            transcribe: Callable[[bytes], Awaitable[str]], save: Callable[[list[Chunk]], None],
                            progress: Callable[[int, int], Awaitable[None]],
                            concurrency: int = ASR_CONCURRENCY, retries: int = ASR_CHUNK_RETRIES) -> int:
    """Fill `text` of every chunk that has none (concurrency <= 2, each chunk tried 1 + `retries` times).
    `save` runs after every finished chunk; `progress(done, total)` after every chunk. Returns the seconds actually
    transcribed in this call. Any chunk failing for good -> LibraryError("upstream") (the others finish first)."""
    todo = [c for c in chunks if c.text is None]
    total, done = len(chunks), len(chunks) - len(todo)
    gate = asyncio.Semaphore(max(1, concurrency))
    spent = 0
    failed = False
    lock = asyncio.Lock()

    async def one(chunk: Chunk) -> None:
        nonlocal spent, done, failed
        async with gate:
            if failed:
                return
            wav = await read(chunk)
            for attempt in range(retries + 1):
                try:
                    text = await transcribe(wav)
                    break
                except asyncio.CancelledError:
                    raise
                except Exception:  # noqa: BLE001 - recognizer errors are classified by kind only
                    if attempt == retries:
                        failed = True
                        return
            async with lock:
                chunk.text = " ".join((text or "").split())
                spent += chunk.seconds
                done += 1
                save(chunks)
        await progress(done, total)

    await asyncio.gather(*(one(c) for c in todo))
    if failed:
        raise LibraryError("upstream")
    return spent
````

- [ ] **Step 4: 运行通过** — `cd server && uv run pytest -q tests/test_library_asr_chunks.py tests/test_architecture.py` → 全绿。

- [ ] **Step 5: 提交**

```bash
git add server/tests/test_library_asr_chunks.py server/app/library/asr_chunks.py
git commit -m "feat(server): silence-aware chunks, boundary snapping and resumable chunk transcription" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 7: 媒体票据 `tickets.py`

**Files:**
- Create: `server/tests/test_library_tickets.py`、`server/app/library/tickets.py`

**Interfaces(Produces):** `tickets.MediaTicketStore(ttl_seconds=1800, capacity=1000, clock=...)`:`issue(user_id, item_id)`、`resolve(token, item_id) -> user_id | None`、`revoke_item(item_id)`、`ttl`、`len()`。

- [ ] **Step 1: 写失败测试**

Write `server/tests/test_library_tickets.py`:

````python
"""媒体票据(spec §10)。"""
from app.library.tickets import MediaTicketStore

ITEM = "0f0e0d0c-0b0a-4908-8706-050403020100"
OTHER = "11111111-2222-4333-8444-555555555555"


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def test_a_ticket_is_reusable_until_it_expires_and_bound_to_its_item():
    clock = Clock()
    store = MediaTicketStore(ttl_seconds=1800, clock=clock)
    token = store.issue(7, ITEM)
    assert len(token) >= 40 and store.resolve(token, ITEM) == 7 and store.resolve(token, ITEM) == 7
    assert store.resolve(token, OTHER) is None
    clock.t += 1799
    assert store.resolve(token, ITEM) == 7
    clock.t += 1
    assert store.resolve(token, ITEM) is None and len(store) == 0


def test_unknown_empty_and_oversized_tokens():
    store = MediaTicketStore()
    assert store.resolve(None, ITEM) is None and store.resolve("", ITEM) is None
    assert store.resolve("x" * 129, ITEM) is None and store.resolve("nope", ITEM) is None


def test_capacity_evicts_the_oldest():
    store = MediaTicketStore(capacity=3)
    tokens = [store.issue(1, ITEM) for _ in range(4)]
    assert len(store) == 3
    assert store.resolve(tokens[0], ITEM) is None and store.resolve(tokens[3], ITEM) == 1


def test_expired_tickets_are_pruned_on_issue_and_revoke_by_item():
    clock = Clock()
    store = MediaTicketStore(ttl_seconds=10, clock=clock)
    store.issue(1, ITEM)
    clock.t += 11
    keep = store.issue(2, OTHER)
    assert len(store) == 1
    store.issue(2, ITEM)
    assert store.revoke_item(ITEM) == 1 and store.resolve(keep, OTHER) == 2
````

- [ ] **Step 2: 运行确认失败** — `cd server && uv run pytest -q tests/test_library_tickets.py` → `ModuleNotFoundError: No module named 'app.library.tickets'`。

- [ ] **Step 3: 实现**

Write `server/app/library/tickets.py`:

````python
"""媒体播放票据(spec §10、E4):`<video>` / `<audio>` 发不了 Authorization 头,所以 `POST media-ticket` 发一张
同源 URL 用的短期票据。进程内保存(单 worker),随机 32 字节 urlsafe,30 分钟内可多次使用,全站 ≤ 1000 张,
满了淘汰最老的;重启即失效。参数名是 `ticket`,`core/logging_setup` 对 uvicorn 访问日志的 `ticket=` 脱敏直接生效。
票据值永远不进日志、错误与测试快照。"""
import secrets
import time
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass

from app.library.limits import TICKET_MAX, TICKET_TTL_SECONDS


@dataclass(frozen=True)
class _Ticket:
    user_id: int
    item_id: str
    expires_at: float


class MediaTicketStore:
    def __init__(self, ttl_seconds: int = TICKET_TTL_SECONDS, capacity: int = TICKET_MAX,
                 clock: Callable[[], float] = time.monotonic):
        self.ttl = ttl_seconds
        self.capacity = capacity
        self._clock = clock
        self._items: OrderedDict[str, _Ticket] = OrderedDict()

    def __len__(self) -> int:
        return len(self._items)

    def _prune(self) -> None:
        now = self._clock()
        for token in [t for t, v in self._items.items() if v.expires_at <= now]:
            del self._items[token]

    def issue(self, user_id: int, item_id: str) -> str:
        self._prune()
        while len(self._items) >= self.capacity:
            self._items.popitem(last=False)
        token = secrets.token_urlsafe(32)
        self._items[token] = _Ticket(user_id, item_id, self._clock() + self.ttl)
        return token

    def resolve(self, token: str | None, item_id: str) -> int | None:
        """The user id behind a live ticket for this item, else None (wrong item, expired, unknown)."""
        if not token or len(token) > 128:
            return None
        ticket = self._items.get(token)
        if ticket is None:
            return None
        if ticket.expires_at <= self._clock():
            del self._items[token]
            return None
        return ticket.user_id if secrets.compare_digest(ticket.item_id, item_id) else None

    def revoke_item(self, item_id: str) -> int:
        tokens = [t for t, v in self._items.items() if v.item_id == item_id]
        for token in tokens:
            del self._items[token]
        return len(tokens)
````

- [ ] **Step 4: 运行通过** — `cd server && uv run pytest -q tests/test_library_tickets.py tests/test_architecture.py` → 全绿。

- [ ] **Step 5: 提交**

```bash
git add server/tests/test_library_tickets.py server/app/library/tickets.py
git commit -m "feat(server): in-process media tickets for library playback" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 8: 子进程与 ffmpeg `media.py`

**Files:**
- Create: `server/tests/test_library_media.py`、`server/app/library/media.py`

**Interfaces(Produces):** `media.RunResult`、`safe_env`、`run`(签名见「对外接口」A-3)、`timeout_for`、`ProbeInfo`、`Normalized`、`parse_probe`、`normalize_plan`、`Ffmpeg(ffmpeg='ffmpeg', ffprobe='ffprobe')`:`probe` / `normalize` / `poster` / `speech_wav`(都要 `home=` 关键字)。

- [ ] **Step 1: 写失败测试**

Write `server/tests/test_library_media.py`:

````python
"""子进程封装与 ffmpeg 规则(spec §5.1、§6.1)。真实 ffmpeg 的用例只在装了 ffmpeg / ffprobe 的机器上跑。"""
import asyncio
import json
import shutil
import subprocess
import sys

import pytest

from app.library import media
from app.library.errors import LibraryError
from app.library.media import Ffmpeg, ProbeInfo, normalize_plan, parse_probe

HAVE_FFMPEG = shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None
needs_ffmpeg = pytest.mark.skipif(not HAVE_FFMPEG, reason="ffmpeg / ffprobe not installed")


def py(code: str) -> list[str]:
    return [sys.executable, "-c", code]


# ---- run() ----

async def test_run_collects_stdout_and_stderr():
    result = await media.run(py("import sys; print('out'); print('err', file=sys.stderr); sys.exit(3)"), timeout=30)
    assert result.returncode == 3 and result.stdout.strip() == b"out" and result.stderr.strip() == "err"


async def test_run_passes_only_whitelisted_environment(monkeypatch, tmp_path):
    monkeypatch.setenv("UPSTREAM_LLM_KEY", "llm-secret")
    monkeypatch.setenv("ADMIN_PASSWORD", "pw-secret")
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@h/db")
    code = "import os, json; print(json.dumps(sorted(os.environ)))"
    result = await media.run(py(code), timeout=30, env=media.safe_env(tmp_path, {"HTTPS_PROXY": "http://p:1"}))
    names = set(json.loads(result.stdout))
    assert not {"UPSTREAM_LLM_KEY", "ADMIN_PASSWORD", "DATABASE_URL"} & names
    assert {"HOME", "HTTPS_PROXY", "LANG"} <= names
    assert names <= set(media.SAFE_ENV_KEYS) | {"HOME", "HTTPS_PROXY"} | {"__CF_USER_TEXT_ENCODING"}


async def test_run_streams_stdout_lines():
    seen = []

    async def on_line(line):
        seen.append(line)

    result = await media.run(py("print('a=1'); print('b=2')"), timeout=30, on_stdout_line=on_line)
    assert seen == ["a=1", "b=2"] and result.stdout == b""


async def test_run_times_out_and_kills():
    result = await media.run(py("import time; time.sleep(30)"), timeout=0.5)
    assert result.timed_out and result.returncode != 0


async def test_run_takes_a_cwd_and_a_sync_line_callback(tmp_path):
    seen = []
    result = await media.run(py("import os; print(os.getcwd())"), timeout=30, cwd=tmp_path, on_stdout_line=seen.append)
    assert seen == [str(tmp_path)] and not result.timed_out


async def test_run_cancellation_stops_the_process(tmp_path):
    marker = tmp_path / "alive"
    code = f"import time, pathlib\nfor _ in range(60):\n    pathlib.Path(r'{marker}').write_text('x')\n    time.sleep(0.1)"
    task = asyncio.create_task(media.run(py(code), timeout=60))
    for _ in range(100):
        await asyncio.sleep(0.05)
        if marker.exists():
            break
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    marker.unlink()
    await asyncio.sleep(0.5)
    assert not marker.exists()


def test_timeout_rule():
    assert media.timeout_for(None) == 120 and media.timeout_for(10_000) == 120 and media.timeout_for(90 * 60_000) == 16200


# ---- probe and the normalization rules (pure) ----

def _probe(streams, fmt):
    return json.dumps({"streams": streams, "format": fmt}).encode()


def test_parse_probe_ignores_cover_art_and_takes_the_longest_duration():
    info = parse_probe(_probe(
        [{"codec_type": "audio", "codec_name": "mp3", "duration": "61.5"},
         {"codec_type": "video", "codec_name": "mjpeg", "disposition": {"attached_pic": 1}, "height": 500}],
        {"format_name": "mp3", "duration": "61.4"}))
    assert info == ProbeInfo(61500, True, False, None, "mp3", "mp3", None)


@pytest.mark.parametrize("raw", [b"not json", _probe([], {}), _probe([{"codec_type": "audio"}], {"duration": "N/A"})],
                         ids=["garbage", "empty", "no-duration"])
def test_parse_probe_rejects_garbage(raw):
    with pytest.raises(LibraryError) as e:
        parse_probe(raw)
    assert e.value.kind == "corrupt"


@pytest.mark.parametrize("info, name, mime, copies", [
    (ProbeInfo(1000, True, True, "h264", "aac", "mov,mp4,m4a,3gp,3g2,mj2", 720), "media.mp4", "video/mp4", True),
    (ProbeInfo(1000, True, True, "h264", "aac", "mov,mp4,m4a,3gp,3g2,mj2", 1080), "media.mp4", "video/mp4", False),
    (ProbeInfo(1000, True, True, "vp9", "opus", "matroska,webm", 720), "media.mp4", "video/mp4", False),
    (ProbeInfo(1000, True, False, None, "mp3", "mp3", None), "media.mp3", "audio/mpeg", True),
    (ProbeInfo(1000, True, False, None, "aac", "mov,mp4,m4a,3gp,3g2,mj2", None), "media.m4a", "audio/mp4", True),
    (ProbeInfo(1000, True, False, None, "pcm_s16le", "wav", None), "media.m4a", "audio/mp4", False),
    (ProbeInfo(1000, True, False, None, "opus", "ogg", None), "media.m4a", "audio/mp4", False),
], ids=["mp4-copy", "mp4-too-tall", "webm", "mp3", "m4a-copy", "wav", "ogg"])
def test_normalize_plan(tmp_path, info, name, mime, copies):
    args, out = normalize_plan(info, tmp_path, 720)
    assert out.path == tmp_path / name and out.mime == mime and out.kind == ("video" if info.has_video else "audio")
    assert ("copy" in args) is copies and args[-1] == str(tmp_path / name)
    if info.has_video and not copies:
        assert "libx264" in args and "scale=-2:'trunc(min(720,ih)/2)*2'" in args


# ---- real ffmpeg ----

def _make(path, *lavfi_and_codec):
    subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", *lavfi_and_codec, str(path)],
                   check=True, timeout=120)


SPEECHY = "aevalsrc='if(lt(mod(t\\,3)\\,2)\\,0.5*sin(2*PI*440*t)\\,0)':s=44100:d=10"


@needs_ffmpeg
async def test_real_video_is_transcoded_capped_and_gets_a_poster(tmp_path):
    src = tmp_path / "in.webm"
    _make(src, "-f", "lavfi", "-i", "testsrc=size=640x481:rate=10:duration=3", "-f", "lavfi", "-i", SPEECHY,
          "-shortest", "-c:v", "libvpx-vp9", "-c:a", "libopus")
    tool = Ffmpeg()
    info = await tool.probe(src, home=tmp_path)
    assert info.has_video and info.has_audio and info.height == 481 and 2900 <= info.duration_ms <= 3200
    out_dir = tmp_path / "out"
    out_dir.mkdir()
    seen = []

    async def progress(f):
        seen.append(f)

    result = await tool.normalize(src, info, out_dir, max_height=240, home=tmp_path, progress=progress)
    again = await tool.probe(result.path, home=tmp_path)
    assert (result.mime, again.vcodec, again.acodec, again.height) == ("video/mp4", "h264", "aac", 240)
    assert seen and max(seen) <= 1.0
    assert await tool.poster(result.path, out_dir / "poster.jpg", again.duration_ms, home=tmp_path)


@needs_ffmpeg
async def test_real_audio_wav_and_silences(tmp_path):
    src = tmp_path / "in.wav"
    _make(src, "-f", "lavfi", "-i", SPEECHY)
    tool = Ffmpeg()
    info = await tool.probe(src, home=tmp_path)
    result = await tool.normalize(src, info, tmp_path, max_height=720, home=tmp_path)
    assert result.path.name == "media.m4a" and (await tool.probe(result.path, home=tmp_path)).acodec == "aac"
    silences = await tool.speech_wav(result.path, tmp_path / "speech.wav", info.duration_ms, home=tmp_path)
    assert [(round(s.start_ms, -2), round(s.end_ms, -2)) for s in silences][:2] == [(2000, 3000), (5000, 6000)]


@needs_ffmpeg
async def test_real_garbage_is_corrupt(tmp_path):
    src = tmp_path / "in.mp4"
    src.write_bytes(b"\x00" * 4096)
    with pytest.raises(LibraryError) as e:
        await Ffmpeg().probe(src, home=tmp_path)
    assert e.value.kind == "corrupt"
````

- [ ] **Step 2: 运行确认失败** — `cd server && uv run pytest -q tests/test_library_media.py` → `ModuleNotFoundError: No module named 'app.library.media'`。

- [ ] **Step 3: 实现**

Write `server/app/library/media.py`:

````python
"""子进程与 ffmpeg / ffprobe(spec §5.1、§6.1 末段、§6.2)。

`run(cmd, *, timeout, env, cwd, on_stdout_line)`:`create_subprocess_exec`(不经 shell)、stdin 关闭、环境变量白名单(`safe_env`,
绝不继承 `UPSTREAM_*` / `*_KEY` / `ADMIN_*` / `DATABASE_URL`)、POSIX 上 `nice -n 10`;stdout 只用来解析进度或
ffprobe 的 JSON;stderr 读完后只交给调用方分类(silencedetect 的数字、「磁盘满」),**绝不记录**(里面有文件名、
标题与 URL)。超时:结束进程并返回 `timed_out=True`;取消:结束进程后继续抛出。结束 = 先 terminate,5 秒后 kill。

`Ffmpeg` 是流水线用的媒体工具(测试里换成假的):`probe`、`normalize`(规范化成 H.264/AAC mp4,或 mp3 / m4a)、
`poster`(视频封面)、`speech_wav`(16 kHz 单声道 WAV + 静音表)。
"""
import asyncio
import inspect
import json
import os
import shutil
from collections.abc import Awaitable, Callable, Mapping, Sequence
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.library.asr_chunks import Silence, parse_silences
from app.library.errors import LibraryError

STDERR_CAP = 4 * 1024 * 1024
KILL_GRACE_SECONDS = 5.0
SAFE_ENV_KEYS = ("PATH", "LANG", "LC_ALL", "SYSTEMROOT", "TEMP", "TMP")  # SYSTEMROOT/TEMP: Windows dev machines
THREADS = "2"


@dataclass(frozen=True)
class RunResult:
    returncode: int
    stdout: bytes  # empty when `on_stdout_line` consumed it
    stderr: str  # for classification only; never log it
    timed_out: bool = False


def safe_env(home: Path | None = None, extra: dict[str, str] | None = None) -> dict[str, str]:
    """Only the whitelisted variables of this process, HOME pointed at the job's staging directory, plus `extra`."""
    env = {k: os.environ[k] for k in SAFE_ENV_KEYS if k in os.environ}
    env.setdefault("LANG", "C.UTF-8")
    if home is not None:
        env["HOME"] = str(home)
    env.update(extra or {})
    return env


def _prefix() -> list[str]:
    if os.name == "posix" and shutil.which("nice"):
        return ["nice", "-n", "10"]
    return []


async def _stop(proc: asyncio.subprocess.Process) -> None:
    with suppress(ProcessLookupError):
        proc.terminate()
    try:
        await asyncio.wait_for(proc.wait(), KILL_GRACE_SECONDS)
    except (TimeoutError, asyncio.TimeoutError):
        with suppress(ProcessLookupError):
            proc.kill()
        await proc.wait()


async def run(cmd: Sequence[str], *, timeout: float, env: Mapping[str, str] | None = None, cwd: Path | None = None,
              on_stdout_line: Callable[[str], Any] | None = None) -> RunResult:
    """Run one subprocess (no shell). `env` is the child's complete environment (default `safe_env()`).
    `on_stdout_line` (sync or async) gets each stdout line instead of buffering it. A timeout stops the process and
    returns `timed_out=True`; cancellation stops it and re-raises."""
    proc = await asyncio.create_subprocess_exec(
        *_prefix(), *cmd, stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE, env=dict(env) if env is not None else safe_env(),
        cwd=str(cwd) if cwd is not None else None)
    out = bytearray()
    err = bytearray()

    async def pump_out() -> None:
        while True:
            line = await proc.stdout.readline()
            if not line:
                return
            if on_stdout_line is not None:
                result = on_stdout_line(line.decode("utf-8", "replace").strip())
                if inspect.isawaitable(result):
                    await result
            else:
                out.extend(line)

    async def pump_err() -> None:
        while chunk := await proc.stderr.read(65536):
            err.extend(chunk)
            if len(err) > STDERR_CAP:
                del err[:len(err) - STDERR_CAP]

    timed_out = False
    try:
        await asyncio.wait_for(asyncio.gather(pump_out(), pump_err(), proc.wait()), timeout)
    except (TimeoutError, asyncio.TimeoutError):
        timed_out = True
        await _stop(proc)
    except BaseException:
        await asyncio.shield(_stop(proc))
        raise
    code = proc.returncode if proc.returncode is not None else -1
    return RunResult(code, bytes(out), err.decode("utf-8", "replace"), timed_out)


def timeout_for(duration_ms: int | None) -> float:
    """max(120, 3 x duration) seconds (spec §5.1)."""
    return max(120.0, 3 * (duration_ms or 0) / 1000)


def _failure_kind(stderr: str, default: str) -> str:
    return "disk_full" if "No space left on device" in stderr else default


@dataclass(frozen=True)
class ProbeInfo:
    duration_ms: int
    has_audio: bool
    has_video: bool
    vcodec: str | None
    acodec: str | None
    format_name: str
    height: int | None


@dataclass(frozen=True)
class Normalized:
    path: Path
    mime: str
    kind: str  # audio / video


def parse_probe(raw: bytes) -> ProbeInfo:
    try:
        data = json.loads(raw.decode("utf-8", "replace"))
        streams = data.get("streams") or []
        fmt = data.get("format") or {}
    except (ValueError, AttributeError):
        raise LibraryError("corrupt") from None
    video = [s for s in streams if s.get("codec_type") == "video"
             and not (s.get("disposition") or {}).get("attached_pic")]
    audio = [s for s in streams if s.get("codec_type") == "audio"]
    durations = [fmt.get("duration")] + [s.get("duration") for s in streams]
    seconds = 0.0
    for value in durations:
        try:
            seconds = max(seconds, float(value))
        except (TypeError, ValueError):
            continue
    if seconds <= 0:
        raise LibraryError("corrupt")
    height = None
    if video:
        try:
            height = int(video[0].get("height") or 0) or None
        except (TypeError, ValueError):
            height = None
    return ProbeInfo(round(seconds * 1000), bool(audio), bool(video), video[0].get("codec_name") if video else None,
                     audio[0].get("codec_name") if audio else None, str(fmt.get("format_name") or ""), height)


def _is_mp4(format_name: str) -> bool:
    return bool({"mov", "mp4", "m4a"} & set(format_name.split(",")))


def normalize_plan(info: ProbeInfo, out_dir: Path, max_height: int) -> tuple[list[str], Normalized]:
    """ffmpeg output arguments (after `-i src`) and the result, by the rules of spec §5.1."""
    if info.has_video:
        out = out_dir / "media.mp4"
        if (info.vcodec == "h264" and info.acodec == "aac" and _is_mp4(info.format_name)
                and (info.height or 0) <= max_height):
            args = ["-map", "0:v:0", "-map", "0:a:0", "-c", "copy"]
        else:
            args = ["-map", "0:v:0", "-map", "0:a:0", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
                    "-pix_fmt", "yuv420p", "-vf", f"scale=-2:'trunc(min({max_height},ih)/2)*2'",
                    "-c:a", "aac", "-b:a", "128k", "-ac", "2"]
        return args + ["-movflags", "+faststart", "-f", "mp4", str(out)], Normalized(out, "video/mp4", "video")
    if info.acodec == "mp3" and "mp3" in info.format_name.split(","):
        out = out_dir / "media.mp3"
        return ["-vn", "-map", "0:a:0", "-c:a", "copy", "-f", "mp3", str(out)], Normalized(out, "audio/mpeg", "audio")
    out = out_dir / "media.m4a"
    if info.acodec == "aac" and _is_mp4(info.format_name):
        args = ["-vn", "-map", "0:a:0", "-c:a", "copy"]
    else:
        args = ["-vn", "-map", "0:a:0", "-c:a", "aac", "-b:a", "96k"]
    return args + ["-movflags", "+faststart", "-f", "mp4", str(out)], Normalized(out, "audio/mp4", "audio")


class Ffmpeg:
    def __init__(self, ffmpeg: str = "ffmpeg", ffprobe: str = "ffprobe"):
        self.ffmpeg = ffmpeg
        self.ffprobe = ffprobe

    def _base(self) -> list[str]:
        return [self.ffmpeg, "-nostdin", "-hide_banner", "-y"]

    async def probe(self, src: Path, *, home: Path) -> ProbeInfo:
        result = await run([self.ffprobe, "-v", "error", "-show_format", "-show_streams", "-of", "json", str(src)],
                           timeout=120, env=safe_env(home))
        if result.timed_out or result.returncode != 0:
            raise LibraryError("corrupt")
        return parse_probe(result.stdout)

    async def normalize(self, src: Path, info: ProbeInfo, out_dir: Path, *, max_height: int, home: Path,
                        progress: Callable[[float], Awaitable[None]] | None = None) -> Normalized:
        args, result = normalize_plan(info, out_dir, max_height)
        total_us = max(1, info.duration_ms * 1000)

        async def on_line(line: str) -> None:
            key, _, value = line.partition("=")
            if progress is not None and key in ("out_time_us", "out_time_ms") and value.strip().isdigit():
                await progress(min(1.0, int(value) / total_us))

        cmd = [*self._base(), "-nostats", "-progress", "pipe:1", "-i", str(src), "-threads", THREADS, *args]
        done = await run(cmd, timeout=timeout_for(info.duration_ms), env=safe_env(home), on_stdout_line=on_line)
        if done.timed_out:
            raise LibraryError("unsupported_format")
        if done.returncode != 0 or not result.path.is_file():
            raise LibraryError(_failure_kind(done.stderr, "unsupported_format"))
        return result

    async def poster(self, media: Path, dst: Path, duration_ms: int, *, home: Path) -> bool:
        """One frame at 10 % of the duration, 360 px high. A failure only means "no poster"."""
        at = f"{duration_ms * 0.1 / 1000:.3f}"
        cmd = [*self._base(), "-v", "error", "-ss", at, "-i", str(media), "-frames:v", "1", "-vf", "scale=-2:360",
               "-q:v", "4", str(dst)]
        done = await run(cmd, timeout=120, env=safe_env(home))
        return not done.timed_out and done.returncode == 0 and dst.is_file()

    async def speech_wav(self, src: Path, dst: Path, duration_ms: int, *, home: Path) -> list[Silence]:
        """16 kHz mono 16-bit WAV for the recognizer plus the silences found on the way (one ffmpeg pass)."""
        cmd = [*self._base(), "-nostats", "-i", str(src), "-vn", "-ac", "1", "-ar", "16000", "-af",
               "silencedetect=noise=-35dB:d=0.35", "-c:a", "pcm_s16le", "-f", "wav", str(dst)]
        done = await run(cmd, timeout=timeout_for(duration_ms), env=safe_env(home))
        if done.timed_out:
            raise LibraryError("corrupt")
        if done.returncode != 0 or not dst.is_file():
            raise LibraryError(_failure_kind(done.stderr, "corrupt"))
        return parse_silences(done.stderr, duration_ms)
````

- [ ] **Step 4: 运行通过** — `cd server && uv run pytest -q tests/test_library_media.py tests/test_architecture.py` → 全绿。

- [ ] **Step 5: 提交**

```bash
git add server/tests/test_library_media.py server/app/library/media.py
git commit -m "feat(server): sandboxed subprocess runner and ffmpeg tools for the library" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 9: 数据库读写 `store.py`

**Files:**
- Create: `server/tests/test_library_store.py`、`server/app/library/store.py`

**Interfaces(Produces):** `store`:`is_item_id`、`clean_title`、`title_from_filename`、`extension_of`、`text_hash`、`same_text`、`item_out`、`segment_out`、`create_item`、`create_upload`、`get_owned`、`list_page`、`segments_of`、`write_segments`、`delete_item_rows`、`claim`、`recover`、`set_progress`、`fail`、`expire_uploads`、`stale_items`、`statuses`、`active_count`、`add_attempt`、`best_attempts`。

- [ ] **Step 1: 写失败测试**

Write `server/tests/test_library_store.py`:

````python
"""跟读库的数据库读写(spec §4、§6.1、§6.5)。"""
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from app.library import store
from app.library.segment import Sentence
from app.models import LibraryAttempt, LibraryItem, LibrarySegment, User

NOW = datetime(2026, 10, 13, 8, 0, tzinfo=timezone.utc)


async def _users(app, *ids):
    async with app.state.sessionmaker() as s:
        s.add_all([User(id=i, username=f"u{i}", password_hash="x") for i in ids])
        await s.commit()


async def _item(app, uid=11111111, **kw) -> str:
    values = dict(user_id=uid, kind="video", source="upload", title="t", status="queued", created_at=NOW,
                  updated_at=NOW)
    values.update(kw)
    async with app.state.sessionmaker() as s:
        row = LibraryItem(**values)
        s.add(row)
        await s.commit()
        return row.id


def test_titles_extensions_and_hashes():
    assert store.clean_title("  My \n  clip  ") == "My clip" and store.clean_title("   ") == "Untitled"
    assert store.clean_title("x" * 300) == "x" * 200
    assert store.title_from_filename("C:\\clips\\my_first_clip.MP4") == "my first clip"
    assert store.extension_of("a.b.MKV") == "mkv" and store.extension_of("noext") == ""
    assert store.text_hash("Hello  world") == store.text_hash(" Hello world ") != store.text_hash("Hello world.")
    assert len(store.text_hash("x")) == 16 and store.same_text("a  b", "a b")
    assert store.is_item_id("0f0e0d0c-0b0a-4908-8706-050403020100") and not store.is_item_id("../x")


async def test_owner_scoping_and_paging(app):
    await _users(app, 11111111, 22222222)
    ids = [await _item(app, created_at=NOW + timedelta(seconds=i)) for i in range(5)]
    theirs = await _item(app, uid=22222222)
    async with app.state.sessionmaker() as s:
        assert await store.get_owned(s, 11111111, theirs) is None
        assert await store.get_owned(s, 11111111, "not-a-uuid") is None
        page, cursor = await store.list_page(s, 11111111, None, limit=2)
        assert [r.id for r in page] == [ids[4], ids[3]] and cursor == ids[3]
        page, cursor = await store.list_page(s, 11111111, cursor, limit=2)
        assert [r.id for r in page] == [ids[2], ids[1]]
        page, cursor = await store.list_page(s, 11111111, cursor, limit=2)
        assert [r.id for r in page] == [ids[0]] and cursor is None
        page, _ = await store.list_page(s, 11111111, theirs, limit=10)
        assert len(page) == 5  # someone else's cursor is ignored


async def test_claim_is_atomic_and_respects_next_run_at(app):
    await _users(app, 11111111)
    due = await _item(app)
    later = await _item(app, next_run_at=NOW + timedelta(minutes=5), created_at=NOW - timedelta(seconds=1))
    await _item(app, status="uploading")
    async with app.state.sessionmaker() as a, app.state.sessionmaker() as b:
        first = await store.claim(a, NOW, 5)
        second = await store.claim(b, NOW, 5)
    assert [r.id for r in first] == [due] and second == []
    async with app.state.sessionmaker() as s:
        assert [r.id for r in await store.claim(s, NOW + timedelta(minutes=6), 5)] == [later]
        assert await store.claim(s, NOW, 0) == []


async def test_recover_progress_and_fail(app):
    await _users(app, 11111111)
    item = await _item(app, status="processing")
    async with app.state.sessionmaker() as s:
        assert await store.set_progress(s, item, "transcode", 140, NOW)
        row = await s.get(LibraryItem, item)
        assert (row.stage, row.progress) == ("transcode", 100)
        assert await store.fail(s, item, "network", retry_at=NOW + timedelta(seconds=30), now=NOW)
        await s.refresh(row)
        assert (row.status, row.attempts, row.error_kind, row.next_run_at is not None) == ("queued", 1, "network", True)
        assert not await store.set_progress(s, item, "probe", 1, NOW)  # not processing any more
        row.status = "processing"
        await s.commit()
        assert await store.recover(s, NOW) == 1
        await s.refresh(row)
        assert row.status == "queued" and row.attempts == 1
        row.status = "processing"
        await s.commit()
        assert await store.fail(s, item, "corrupt", retry_at=None, now=NOW)
        await s.refresh(row)
        assert (row.status, row.error_kind, row.next_run_at) == ("failed", "corrupt", None)


async def test_segments_attempts_and_explicit_delete(app):
    await _users(app, 11111111)
    item_id = await _item(app, status="ready")
    async with app.state.sessionmaker() as s:
        item = await s.get(LibraryItem, item_id)
        item.resume_idx = 9
        await store.write_segments(s, item, [Sentence(0, 900, "Hello there."), Sentence(900, 2000, "Bye now.")])
        await s.commit()
        segs = await store.segments_of(s, item_id)
        assert [store.segment_out(x) for x in segs] == [
            {"idx": 0, "start_ms": 0, "end_ms": 900, "text": "Hello there.", "zh": None, "zh_lang": None,
             "has_analysis": False, "analysis_lang": None},
            {"idx": 1, "start_ms": 900, "end_ms": 2000, "text": "Bye now.", "zh": None, "zh_lang": None,
             "has_analysis": False, "analysis_lang": None}]
        segs[0].zh, segs[0].zh_lang, segs[0].analysis, segs[0].analysis_lang = "你好。", "zh-CN", "### Grammar", "zh-CN"
        assert store.segment_out(segs[0]) == {"idx": 0, "start_ms": 0, "end_ms": 900, "text": "Hello there.",
                                              "zh": "你好。", "zh_lang": "zh-CN", "has_analysis": True,
                                              "analysis_lang": "zh-CN"}  # the analysis text itself is not listed
        assert (item.seg_count, item.resume_idx) == (2, 1)
        for aid, score, text in (("a1", 70, "Hello there."), ("a2", 90, "Hello  there."), ("a3", 99, "Old text."),
                                 ("a1", 10, "Hello there.")):
            await store.add_attempt(s, user_id=11111111, item_id=item_id, seg_idx=0, assessment_id=aid, text=text,
                                    score=score, now=NOW)
        best = await store.best_attempts(s, item_id, segs)
        assert best == [{"seg_idx": 0, "best_score": 90, "count": 2, "last_at": best[0]["last_at"]}]
        await store.delete_item_rows(s, item_id)
        await s.commit()
        for model in (LibraryItem, LibrarySegment, LibraryAttempt):
            assert await s.scalar(select(func.count()).select_from(model)) == 0


async def test_item_out_shape_and_upload_progress(app):
    await _users(app, 11111111)
    item_id = await _item(app, status="uploading", upload_total=400, upload_received=100)
    async with app.state.sessionmaker() as s:
        out = store.item_out(await s.get(LibraryItem, item_id))
    assert out["progress"] == 25 and out["has_poster"] is False and out["last_opened_at"] is None
    assert set(out) == {"id", "kind", "source", "title", "status", "stage", "progress", "error_kind", "duration_ms",
                        "seg_count", "library_bytes", "sub_source", "resume_ms", "resume_idx", "rate_pct", "has_poster",
                        "created_at", "last_opened_at"}


async def test_sweeps(app):
    await _users(app, 11111111)
    old = NOW - timedelta(days=8)
    expired = await _item(app, status="uploading", updated_at=NOW - timedelta(hours=25))
    fresh = await _item(app, status="uploading")
    stale = await _item(app, status="failed", updated_at=old)
    gone = await _item(app, status="canceled", updated_at=old)
    await _item(app, status="ready", updated_at=old)
    async with app.state.sessionmaker() as s:
        assert await store.expire_uploads(s, NOW) == [expired]
        assert sorted(i for _, i in await store.stale_items(s, NOW)) == sorted([stale, gone])
        assert (await store.statuses(s, [expired, fresh])) == {expired: "failed", fresh: "uploading"}
        assert (await s.get(LibraryItem, expired)).error_kind == "upload_expired"
        assert await store.active_count(s) == 1


async def test_create_item_for_plan_s2_and_upload_kinds(app):
    await _users(app, 11111111)
    async with app.state.sessionmaker() as s:
        row = await store.create_item(s, user_id=11111111, kind="video", source="link", status="queued", title="",
                                      source_url="https://www.youtube.com/watch?v=x", source_host="www.youtube.com")
        assert (row.status, row.source, row.title, row.source_host) == ("queued", "link", "", "www.youtube.com")
        audio = await store.create_upload(s, 11111111, title="  a  b ", size=10, ext="mp3")
        video = await store.create_upload(s, 11111111, title="", size=10, ext="mkv")
    assert (audio.kind, audio.title, audio.status, audio.upload_total) == ("audio", "a b", "uploading", 10)
    assert (video.kind, video.title) == ("video", "Untitled")
````

- [ ] **Step 2: 运行确认失败** — `cd server && uv run pytest -q tests/test_library_store.py` → `ModuleNotFoundError: No module named 'app.library.store'`。

- [ ] **Step 3: 实现**

Write `server/app/library/store.py`:

````python
"""跟读库的数据库读写(spec §4、§9)。所有用户可见的查询都带 user_id:别人的 id 一律当作不存在。
SQLite 没有外键级联:删条目显式删 attempts → segments → item(`delete_item_rows`)。
本模块只读写库(停任务、删文件的 `cancel_item` / `delete_item` 由 Task 11 追加)。标题、链接、句子文本永远不进日志。"""
import hashlib
import re
from datetime import datetime, timedelta
from pathlib import PurePath

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.library.limits import (
    ACTIVE, AUDIO_EXTENSIONS, FAILED_KEEP_DAYS, LIST_LIMIT, TITLE_MAX, UPLOAD_EXPIRE_HOURS,
)
from app.library.segment import Sentence
from app.models import LibraryAttempt, LibraryItem, LibrarySegment, iso_utc, utcnow

_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def is_item_id(value: str | None) -> bool:
    return isinstance(value, str) and _UUID.fullmatch(value) is not None


def clean_title(raw: str | None, fallback: str = "Untitled") -> str:
    title = " ".join((raw or "").split())[:TITLE_MAX].strip()
    return title or fallback


def title_from_filename(filename: str) -> str:
    stem = PurePath(filename.replace("\\", "/")).stem
    return clean_title(stem.replace("_", " "))


def extension_of(filename: str) -> str:
    return PurePath(filename.replace("\\", "/")).suffix.lower().lstrip(".")


def text_hash(text: str) -> str:
    return hashlib.sha256(" ".join(text.split()).encode("utf-8")).hexdigest()[:16]


def same_text(a: str, b: str) -> bool:
    return " ".join(a.split()) == " ".join(b.split())


# ---- output shapes (the web reads them through tests/fixtures/library_contract.json) ----

def item_out(row: LibraryItem) -> dict:
    progress = row.progress
    if row.status == "uploading" and row.upload_total:
        progress = min(100, row.upload_received * 100 // row.upload_total)
    return {
        "id": row.id, "kind": row.kind, "source": row.source, "title": row.title, "status": row.status,
        "stage": row.stage, "progress": progress, "error_kind": row.error_kind, "duration_ms": row.duration_ms,
        "seg_count": row.seg_count, "library_bytes": row.library_bytes, "sub_source": row.sub_source,
        "resume_ms": row.resume_ms, "resume_idx": row.resume_idx, "rate_pct": row.rate_pct,
        "has_poster": row.poster_path is not None, "created_at": iso_utc(row.created_at),
        "last_opened_at": iso_utc(row.last_opened_at) if row.last_opened_at else None,
    }


def segment_out(row: LibrarySegment) -> dict:
    """D8:列表里带译文 `zh`(+ `zh_lang`,网页拿它和当前母语比,不一致就当没有);分析正文最长 4000 字、只在点「分析」时
    才取,列表只告诉有没有(`has_analysis` + `analysis_lang`)。"""
    return {"idx": row.idx, "start_ms": row.start_ms, "end_ms": row.end_ms, "text": row.text, "zh": row.zh,
            "zh_lang": row.zh_lang, "has_analysis": bool(row.analysis), "analysis_lang": row.analysis_lang}


# ---- create / read ----

async def create_item(session: AsyncSession, *, user_id: int, kind: str, source: str, status: str, title: str,
                      source_url: str | None = None, source_host: str | None = None,
                      upload_total: int = 0) -> LibraryItem:
    """Insert and commit one item. Plan S2 creates link items with it (`source="link"`, `status="queued"`,
    `title=""` when the user gave none: the fetch stage's page title fills it in, R-SC22)."""
    now = utcnow()
    row = LibraryItem(user_id=user_id, kind=kind, source=source, title=(title or "")[:TITLE_MAX], status=status,
                      source_url=source_url, source_host=(source_host or None) and source_host[:64],
                      upload_total=upload_total, upload_received=0, created_at=now, updated_at=now)
    session.add(row)
    await session.commit()
    return row


async def create_upload(session: AsyncSession, user_id: int, *, title: str, size: int, ext: str) -> LibraryItem:
    """`kind` is a guess from the extension until the probe decides (spec §4)."""
    return await create_item(session, user_id=user_id, kind="audio" if ext in AUDIO_EXTENSIONS else "video",
                             source="upload", status="uploading", title=clean_title(title), upload_total=size)


async def get_owned(session: AsyncSession, user_id: int, item_id: str) -> LibraryItem | None:
    if not is_item_id(item_id):
        return None
    return await session.scalar(select(LibraryItem).where(LibraryItem.id == item_id, LibraryItem.user_id == user_id))


async def list_page(session: AsyncSession, user_id: int, cursor: str | None,
                    limit: int = LIST_LIMIT) -> tuple[list[LibraryItem], str | None]:
    """Newest first; `cursor` is the id of the last item of the previous page (unknown cursor = first page)."""
    query = select(LibraryItem).where(LibraryItem.user_id == user_id)
    anchor = await get_owned(session, user_id, cursor) if cursor else None
    if anchor is not None:
        query = query.where((LibraryItem.created_at < anchor.created_at)
                            | ((LibraryItem.created_at == anchor.created_at) & (LibraryItem.id < anchor.id)))
    rows = (await session.scalars(query.order_by(LibraryItem.created_at.desc(), LibraryItem.id.desc())
                                  .limit(limit + 1))).all()
    more = len(rows) > limit
    rows = list(rows[:limit])
    return rows, (rows[-1].id if more and rows else None)


async def segments_of(session: AsyncSession, item_id: str) -> list[LibrarySegment]:
    return list((await session.scalars(select(LibrarySegment).where(LibrarySegment.item_id == item_id)
                                       .order_by(LibrarySegment.idx))).all())


async def write_segments(session: AsyncSession, item: LibraryItem, sentences: list[Sentence]) -> None:
    """Replace every sentence of the item (caller commits). Old attempts stay; their text hash decides (R-SC14)."""
    await session.execute(delete(LibrarySegment).where(LibrarySegment.item_id == item.id))
    session.add_all(LibrarySegment(item_id=item.id, idx=i, start_ms=s.start_ms, end_ms=s.end_ms, text=s.text)
                    for i, s in enumerate(sentences))
    item.seg_count = len(sentences)
    item.resume_idx = min(item.resume_idx, max(0, len(sentences) - 1))


async def delete_item_rows(session: AsyncSession, item_id: str) -> None:
    """Explicit child deletes (SQLite has no FK cascade); caller commits, then removes the files."""
    await session.execute(delete(LibraryAttempt).where(LibraryAttempt.item_id == item_id))
    await session.execute(delete(LibrarySegment).where(LibrarySegment.item_id == item_id))
    await session.execute(delete(LibraryItem).where(LibraryItem.id == item_id))


# ---- the worker's queue ----

async def claim(session: AsyncSession, now: datetime, limit: int) -> list[LibraryItem]:
    """Atomically move up to `limit` due queued items to `processing` (UPDATE ... WHERE status='queued' and check
    the row count, so two claimers never get the same item; safe on Postgres too)."""
    if limit <= 0:
        return []
    ids = (await session.scalars(
        select(LibraryItem.id).where(LibraryItem.status == "queued",
                                     (LibraryItem.next_run_at.is_(None)) | (LibraryItem.next_run_at <= now))
        .order_by(LibraryItem.created_at, LibraryItem.id).limit(limit))).all()
    claimed = []
    for item_id in ids:
        result = await session.execute(update(LibraryItem).where(LibraryItem.id == item_id,
                                                                 LibraryItem.status == "queued")
                                       .values(status="processing", stage=None, updated_at=now))
        if result.rowcount == 1:
            claimed.append(item_id)
    await session.commit()
    if not claimed:
        return []
    return list((await session.scalars(select(LibraryItem).where(LibraryItem.id.in_(claimed))
                                       .order_by(LibraryItem.created_at, LibraryItem.id))).all())


async def recover(session: AsyncSession, now: datetime) -> int:
    """Startup: items left `processing` by a stopped process go back to the queue (attempts unchanged)."""
    result = await session.execute(update(LibraryItem).where(LibraryItem.status == "processing")
                                   .values(status="queued", updated_at=now))
    await session.commit()
    return result.rowcount or 0


async def set_progress(session: AsyncSession, item_id: str, stage: str, progress: int, now: datetime) -> bool:
    """False = the item is no longer processing (canceled or deleted): the job must stop."""
    result = await session.execute(update(LibraryItem).where(LibraryItem.id == item_id,
                                                             LibraryItem.status == "processing")
                                   .values(stage=stage, progress=max(0, min(100, progress)), updated_at=now))
    await session.commit()
    return result.rowcount == 1


async def fail(session: AsyncSession, item_id: str, kind: str, *, retry_at: datetime | None, now: datetime) -> bool:
    """A failed job: transient with retries left -> back to `queued` with `next_run_at`; else `failed`."""
    values = dict(error_kind=kind, updated_at=now, stage=None)
    if retry_at is not None:
        values.update(status="queued", next_run_at=retry_at, attempts=LibraryItem.attempts + 1)
    else:
        values.update(status="failed", next_run_at=None)
    result = await session.execute(update(LibraryItem).where(LibraryItem.id == item_id,
                                                             LibraryItem.status == "processing").values(**values))
    await session.commit()
    return result.rowcount == 1


# ---- sweeps ----

async def expire_uploads(session: AsyncSession, now: datetime) -> list[str]:
    """Uploads idle for 24 h become failed(upload_expired); returns their ids (the caller deletes `_tmp`)."""
    cutoff = now - timedelta(hours=UPLOAD_EXPIRE_HOURS)
    ids = list((await session.scalars(select(LibraryItem.id).where(LibraryItem.status == "uploading",
                                                                   LibraryItem.updated_at < cutoff))).all())
    if ids:
        await session.execute(update(LibraryItem).where(LibraryItem.id.in_(ids), LibraryItem.status == "uploading")
                              .values(status="failed", error_kind="upload_expired", updated_at=now))
    await session.commit()
    return ids


async def stale_items(session: AsyncSession, now: datetime) -> list[tuple[int, str]]:
    """(user_id, item_id) of failed / canceled items untouched for 7 days: rows and files go."""
    cutoff = now - timedelta(days=FAILED_KEEP_DAYS)
    rows = (await session.execute(select(LibraryItem.user_id, LibraryItem.id).where(
        LibraryItem.status.in_(("failed", "canceled")), LibraryItem.updated_at < cutoff))).all()
    return [(r[0], r[1]) for r in rows]


async def statuses(session: AsyncSession, item_ids: list[str]) -> dict[str, str]:
    if not item_ids:
        return {}
    rows = (await session.execute(select(LibraryItem.id, LibraryItem.status)
                                  .where(LibraryItem.id.in_(item_ids)))).all()
    return {r[0]: r[1] for r in rows}


async def active_count(session: AsyncSession) -> int:
    return int(await session.scalar(select(func.count()).select_from(LibraryItem)
                                    .where(LibraryItem.status.in_(ACTIVE))) or 0)


# ---- attempts ----

async def add_attempt(session: AsyncSession, *, user_id: int, item_id: str, seg_idx: int, assessment_id: str,
                      text: str, score: int | None, now: datetime) -> LibraryAttempt:
    existing = await session.scalar(select(LibraryAttempt).where(LibraryAttempt.item_id == item_id,
                                                                 LibraryAttempt.assessment_id == assessment_id))
    if existing is not None:  # the same assessment posted twice counts once
        return existing
    row = LibraryAttempt(user_id=user_id, item_id=item_id, seg_idx=seg_idx, assessment_id=assessment_id,
                         text_hash=text_hash(text), score=score, created_at=now)
    session.add(row)
    await session.commit()
    return row


async def best_attempts(session: AsyncSession, item_id: str, segments: list[LibrarySegment]) -> list[dict]:
    """Per sentence: best score, count and last time, counting only attempts made on the sentence's current text."""
    hashes = {s.idx: text_hash(s.text) for s in segments}
    rows = (await session.scalars(select(LibraryAttempt).where(LibraryAttempt.item_id == item_id)
                                  .order_by(LibraryAttempt.seg_idx, LibraryAttempt.created_at))).all()
    out: dict[int, dict] = {}
    for row in rows:
        if hashes.get(row.seg_idx) != row.text_hash:
            continue
        entry = out.setdefault(row.seg_idx, {"seg_idx": row.seg_idx, "best_score": None, "count": 0, "last_at": None})
        entry["count"] += 1
        if row.score is not None and (entry["best_score"] is None or row.score > entry["best_score"]):
            entry["best_score"] = row.score
        entry["last_at"] = iso_utc(row.created_at)
    return [out[k] for k in sorted(out)]
````

- [ ] **Step 4: 运行通过** — `cd server && uv run pytest -q tests/test_library_store.py tests/test_architecture.py` → 全绿。

- [ ] **Step 5: 提交**

```bash
git add server/tests/test_library_store.py server/app/library/store.py
git commit -m "feat(server): library store: items, sentences, queue claims, sweeps and attempts" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 10: 流水线、后台队列与 lifespan 接线

**Files:**
- Create: `server/tests/library_helpers.py`、`server/tests/test_library_worker.py`、`server/app/library/pipeline.py`、`server/app/library/worker.py`
- Modify: `server/tests/background.py`、`server/app/main.py`

**Interfaces(Produces):** `pipeline`:`FetchRequest` / `FetchResult` / `FetchStage` / `NoFetch` / `MediaTools` / `PipelineDeps` / `Progress` / `fetch_request` / `process(deps, item_id)`,文件名常量 `UPLOADED_SUBS` / `PLATFORM_SUBS` / `INPUT_PREFIX`;`worker`:`LibraryWorker`(`deps`、`fetch_stage`、`tickets`、`pending`、`running`、`set_fetch_stage`、`wake`、`upload_lock`、`cancel`、`run_once`、`loop`、`sweep`、`join`、`shutdown`)、`install(app)`;`app.state.library`;`tests/library_helpers.py`。

- [ ] **Step 1: 写失败测试**

Write `server/tests/library_helpers.py`:

````python
"""跟读库测试工具:假的媒体工具(不需要 ffmpeg)、假的识别、上传助手、驱动 worker 一轮。

假媒体文件是 `FAKE:` + 一行 JSON(`duration_ms`、`video`、`audio`)+ 任意字节;`FakeTools` 按它「探测」,规范化时写出同样格式的
成品文件,`speech_wav` 写一段真正的 16 kHz 单声道 WAV(静音)并返回预设的静音表。"""
import io
import json
import wave
from pathlib import Path

from app.core import config as config_module
from app.library.asr_chunks import Silence
from app.library.errors import LibraryError
from app.library.media import Normalized, ProbeInfo
from tests.background import drain_background

SRT = (b"1\n00:00:00,500 --> 00:00:03,000\nHello there, my friend.\n\n"
       b"2\n00:00:03,200 --> 00:00:06,000\nHow are you doing today?\n")


def enable(monkeypatch) -> None:
    """The library needs ffmpeg on PATH; tests pretend it is there (the tools themselves are fakes)."""
    monkeypatch.setattr(config_module, "media_tools_present", lambda: True)


def library_settings(tmp_path, **extra) -> dict:
    return {"library_enabled": True, "data_dir": str(tmp_path / "data"), **extra}


def fake_media(duration_ms: int = 6000, video: bool = True, audio: bool = True) -> bytes:
    return b"FAKE:" + json.dumps({"duration_ms": duration_ms, "video": video, "audio": audio}).encode() + b"\n"


class FakeTools:
    def __init__(self, silences: list[Silence] | None = None, fail: dict[str, str] | None = None):
        self.silences = silences or []
        self.fail = fail or {}  # step -> LibraryError kind
        self.calls: list[str] = []

    def _check(self, step: str) -> None:
        self.calls.append(step)
        if step in self.fail:
            raise LibraryError(self.fail[step])

    async def probe(self, src: Path, *, home: Path) -> ProbeInfo:
        self._check("probe")
        raw = src.read_bytes()
        if not raw.startswith(b"FAKE:"):
            raise LibraryError("corrupt")
        meta = json.loads(raw[5:].split(b"\n", 1)[0])
        return ProbeInfo(meta["duration_ms"], meta["audio"], meta["video"], "h264" if meta["video"] else None,
                         "aac" if meta["audio"] else None, "mov,mp4,m4a,3gp,3g2,mj2", 720 if meta["video"] else None)

    async def normalize(self, src, info, out_dir, *, max_height, home, progress=None):
        self._check("normalize")
        if progress is not None:
            await progress(0.5)
            await progress(1.0)
        out = out_dir / ("media.mp4" if info.has_video else "media.m4a")
        out.write_bytes(src.read_bytes())
        return Normalized(out, "video/mp4" if info.has_video else "audio/mp4", "video" if info.has_video else "audio")

    async def poster(self, media, dst, duration_ms, *, home) -> bool:
        self._check("poster")
        dst.write_bytes(b"\xff\xd8\xff\xe0fake-jpeg")
        return True

    async def speech_wav(self, src, dst, duration_ms, *, home) -> list[Silence]:
        self._check("speech_wav")
        with wave.open(str(dst), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(16000)
            w.writeframes(b"\x00\x00" * (16 * duration_ms))
        return list(self.silences)


class FakeAsr:
    """transcriber(user_id) -> async (wav) -> text; `texts` are returned in order, an Exception instance is raised."""

    def __init__(self, texts: list):
        self.texts = list(texts)
        self.calls: list[int] = []

    def __call__(self, user_id: int):
        async def transcribe(wav: bytes) -> str:
            with wave.open(io.BytesIO(wav)) as w:
                self.calls.append(w.getnframes() * 1000 // 16000)
            item = self.texts.pop(0) if self.texts else ""
            if isinstance(item, Exception):
                raise item
            return item
        return transcribe


def use_fakes(app, tools: FakeTools | None = None, asr: FakeAsr | None = None) -> FakeTools:
    tools = tools or FakeTools()
    app.state.library.deps.tools = tools
    if asr is not None:
        app.state.library.deps.transcriber = asr
    return tools


async def upload(client, headers, data: bytes, *, filename: str = "My_clip.mp4", title: str | None = None,
                 subs: bytes | None = None, complete: bool = True) -> str:
    body = {"filename": filename, "size": len(data)}
    if title is not None:
        body["title"] = title
    r = await client.post("/api/library/uploads", headers=headers, json=body)
    assert r.status_code == 200, r.text
    item_id, size = r.json()["item_id"], r.json()["chunk_bytes"]
    for n in range(0, max(1, (len(data) + size - 1) // size)):
        part = data[n * size:(n + 1) * size]
        r = await client.put(f"/api/library/uploads/{item_id}/chunks/{n}", headers=headers,
                             files={"chunk": ("blob", part, "application/octet-stream")})
        assert r.status_code == 200, r.text
    if subs is not None:
        r = await client.put(f"/api/library/uploads/{item_id}/subtitles", headers=headers,
                             files={"file": ("subs.srt", subs, "application/x-subrip")})
        assert r.status_code == 200, r.text
    if complete:
        r = await client.post(f"/api/library/uploads/{item_id}/complete", headers=headers)
        assert r.status_code == 200, r.text
    return item_id


async def process(app) -> int:
    """One worker round, then wait for its jobs."""
    claimed = await app.state.library.run_once()
    await drain_background(app)
    return claimed
````

Write `server/tests/test_library_worker.py`:

````python
"""流水线与后台队列(spec §6):假媒体工具、假识别;不起轮询循环,用 run_once() 手动驱动(tests/background.py)。"""
import asyncio
import json
import shutil
import subprocess
from datetime import timedelta

import pytest
from sqlalchemy import select

from app.core import metering
from app.library import limits, paths, pipeline
from app.library.asr_chunks import Silence, load_state
from app.library.errors import LibraryError
from app.library.media import Ffmpeg
from app.models import DailyUsage, LibraryItem, LibrarySegment, User, utcnow
from tests.background import drain_background
from tests.library_helpers import SRT, FakeAsr, FakeTools, enable, fake_media, library_settings, process, use_fakes

UID = 12345678


@pytest.fixture
def settings_overrides(request, tmp_path):
    return library_settings(tmp_path, **getattr(request, "param", {}))


@pytest.fixture(autouse=True)
def _tools(monkeypatch):
    enable(monkeypatch)


async def seed(app, data: bytes | None = None, *, subs: bytes | None = None, source="upload", url=None,
               title="clip", status="queued", **kw) -> str:
    async with app.state.sessionmaker() as s:
        if await s.get(User, UID) is None:
            s.add(User(id=UID, username="owner", password_hash="x"))
        row = LibraryItem(user_id=UID, kind="video", source=source, title=title, status=status, source_url=url,
                          source_host="www.example.com" if url else None, upload_total=len(data or b""), **kw)
        s.add(row)
        await s.commit()
        item_id = row.id
    tmp = paths.tmp_dir(app.state.library.deps.data_dir, item_id)
    tmp.mkdir(parents=True, exist_ok=True)
    if data is not None:
        (tmp / "in.mp4").write_bytes(data)
    if subs is not None:
        (tmp / pipeline.UPLOADED_SUBS).write_bytes(subs)
    return item_id


async def get(app, item_id) -> LibraryItem:
    async with app.state.sessionmaker() as s:
        return await s.get(LibraryItem, item_id)


async def sentences(app, item_id) -> list[tuple[int, int, str]]:
    async with app.state.sessionmaker() as s:
        rows = (await s.scalars(select(LibrarySegment).where(LibrarySegment.item_id == item_id)
                                .order_by(LibrarySegment.idx))).all()
    return [(r.start_ms, r.end_ms, r.text) for r in rows]


async def test_upload_with_subtitles_becomes_ready(app):
    tools = use_fakes(app)
    item_id = await seed(app, fake_media(6000), subs=SRT)
    assert await process(app) == 1
    item = await get(app, item_id)
    assert (item.status, item.progress, item.stage, item.sub_source, item.seg_count) == ("ready", 100, None, "uploaded", 2)
    assert (item.kind, item.duration_ms, item.media_mime) == ("video", 6000, "video/mp4")
    assert item.media_path == f"library/{UID}/{item_id}/media.mp4" and item.poster_path.endswith("poster.jpg")
    data_dir = app.state.library.deps.data_dir
    assert item.library_bytes == (data_dir / item.media_path).stat().st_size + (data_dir / item.poster_path).stat().st_size
    assert not paths.tmp_dir(data_dir, item_id).exists()
    assert await sentences(app, item_id) == [(500, 3000, "Hello there, my friend."), (3200, 6000, "How are you doing today?")]
    assert tools.calls == ["probe", "normalize", "poster"]


async def test_no_subtitles_and_no_recognizer_fails_but_keeps_the_media(app):
    use_fakes(app)
    item_id = await seed(app, fake_media(4000, video=False))
    await process(app)
    item = await get(app, item_id)
    assert (item.status, item.error_kind, item.kind, item.poster_path) == ("failed", "no_subtitles", "audio", None)
    assert (app.state.library.deps.data_dir / item.media_path).is_file()
    assert await app.state.library.run_once() == 0  # permanent: no automatic retry


@pytest.mark.parametrize("settings_overrides", [{"library_asr_enabled": True}], indirect=True)
async def test_transcription_path_counts_seconds_and_snaps_to_silences(app, monkeypatch):
    monkeypatch.setattr(limits, "ASR_CONCURRENCY", 1)  # chunk order = call order, so the fake texts line up
    seen = {}

    class Spy(FakeAsr):
        def __call__(self, user_id):
            inner = super().__call__(user_id)

            async def transcribe(wav):
                seen["feature"], seen["user"] = metering.current_feature(), metering.current_user_id()
                return await inner(wav)
            return transcribe

    first = "One two three four. Five six seven eight. Nine ten eleven twelve. Thirteen fourteen fifteen sixteen."
    second = "We are done for today. Thank you all very much. See you again next time. Goodbye to everyone here."
    asr = Spy([first, second])
    use_fakes(app, FakeTools(silences=[Silence(5_500, 6_100), Silence(29_800, 30_400)]), asr)
    item_id = await seed(app, fake_media(60_000, video=False))
    await process(app)
    item = await get(app, item_id)
    assert (item.status, item.sub_source, item.asr_seconds) == ("ready", "asr", 61)
    assert asr.calls == [30_100, 29_900] and seen == {"feature": "library", "user": UID}
    out = await sentences(app, item_id)
    assert [t for _, _, t in out] == ["One two three four.", "Five six seven eight.", "Nine ten eleven twelve.",
                                      "Thirteen fourteen fifteen sixteen.", "We are done for today.",
                                      "Thank you all very much.", "See you again next time.", "Goodbye to everyone here."]
    assert out[0][1] == out[1][0] == 5_800  # snapped to the silence middle (the estimate was 5.66 / 5.96 s)
    assert out[3][1] <= 30_100 <= out[4][0]  # the chunk edge sits in the long silence
    async with app.state.sessionmaker() as s:
        counts = {r.subject: r.count for r in (await s.scalars(select(DailyUsage).where(
            DailyUsage.scope == "library_asr"))).all()}
    assert counts == {str(UID): 61, "*": 61}


@pytest.mark.parametrize("settings_overrides", [{"library_asr_enabled": True}], indirect=True)
async def test_transcription_failure_retries_from_the_checkpoint_and_refunds(app, monkeypatch):
    monkeypatch.setattr(limits, "ASR_CONCURRENCY", 1)
    asr = FakeAsr(["First chunk words here.", RuntimeError("x"), RuntimeError("x"), RuntimeError("x")])
    use_fakes(app, FakeTools(silences=[Silence(29_800, 30_400)]), asr)
    item_id = await seed(app, fake_media(60_000, video=False))
    await process(app)
    item = await get(app, item_id)
    assert (item.status, item.error_kind, item.attempts, item.asr_seconds) == ("queued", "upstream", 1, 31)
    assert item.next_run_at is not None
    state = load_state(paths.tmp_dir(app.state.library.deps.data_dir, item_id) / "chunks.json")
    assert [c.text for c in state] == ["First chunk words here.", None]
    async with app.state.sessionmaker() as s:
        assert {r.subject: r.count for r in (await s.scalars(select(DailyUsage))).all()
                if r.scope == "library_asr"} == {str(UID): 31, "*": 31}
        row = await s.get(LibraryItem, item_id)
        row.next_run_at = utcnow() - timedelta(seconds=1)
        await s.commit()
    asr.texts = ["Second chunk words here."]
    asr.calls.clear()
    await process(app)
    item = await get(app, item_id)
    assert (item.status, item.asr_seconds, len(asr.calls)) == ("ready", 61, 1)


@pytest.mark.parametrize("settings_overrides", [{"library_asr_enabled": True,
                                                 "library_asr_minutes_daily_per_user": 0}], indirect=True)
async def test_transcription_over_the_daily_minutes_is_a_quota_failure(app):
    use_fakes(app, asr=FakeAsr(["never"]))
    item_id = await seed(app, fake_media(20_000, video=False))
    await process(app)
    assert ((await get(app, item_id)).status, (await get(app, item_id)).error_kind) == ("failed", "quota")


@pytest.mark.parametrize("data, kind", [
    (fake_media(5000, audio=False), "no_audio"), (fake_media(91 * 60_000), "too_long"), (b"not media", "corrupt"),
], ids=["no-audio", "too-long", "corrupt"])
async def test_permanent_media_failures_drop_the_staging_files(app, data, kind):
    use_fakes(app)
    item_id = await seed(app, data, subs=SRT)
    await process(app)
    item = await get(app, item_id)
    assert (item.status, item.error_kind, item.attempts) == ("failed", kind, 0)
    assert not paths.tmp_dir(app.state.library.deps.data_dir, item_id).exists()


async def test_transient_tool_failures_back_off_30_then_120_seconds_then_fail(app):
    use_fakes(app, FakeTools(fail={"normalize": "upstream"}))
    item_id = await seed(app, fake_media(), subs=SRT)
    for expected in (30, 120):
        before = utcnow()
        await process(app)
        item = await get(app, item_id)
        delay = (item.next_run_at.replace(tzinfo=None) - before.replace(tzinfo=None)).total_seconds()
        assert item.status == "queued" and expected - 2 <= delay <= expected + 2
        async with app.state.sessionmaker() as s:
            row = await s.get(LibraryItem, item_id)
            row.next_run_at = None
            await s.commit()
    await process(app)
    item = await get(app, item_id)
    assert (item.status, item.error_kind, item.attempts) == ("failed", "upstream", 2)
    assert paths.tmp_dir(app.state.library.deps.data_dir, item_id).exists()  # kept for a manual retry


async def test_links_fail_until_plan_s2_registers_a_fetch_stage(app):
    use_fakes(app)
    item_id = await seed(app, source="link", url="https://www.example.com/v/1", title="")
    await process(app)
    assert ((await get(app, item_id)).error_kind) == "unsupported_site"


async def test_a_registered_fetch_stage_supplies_media_title_and_platform_subtitles(app):
    use_fakes(app)
    requests = []

    class Fetch:
        async def fetch(self, req: pipeline.FetchRequest) -> pipeline.FetchResult:
            requests.append(req)
            await req.report(50)
            (req.tmp_dir / "dl.mp4").write_bytes(fake_media(6000))
            (req.tmp_dir / "subs.en.srt").write_bytes(SRT)
            return pipeline.FetchResult(media_path=req.tmp_dir / "dl.mp4", title="A page title", duration_ms=6000,
                                        subtitle_path=req.tmp_dir / "subs.en.srt", subtitle_auto=False,
                                        source_host="www.example.com")

    app.state.library.set_fetch_stage(Fetch())
    assert isinstance(app.state.library.fetch_stage, Fetch)
    item_id = await seed(app, source="link", url="https://www.example.com/v/1", title="")
    named = await seed(app, source="link", url="https://www.example.com/v/2", title="My own name")
    app.state.settings = app.state.settings.model_copy(update={"library_job_concurrency": 2})
    await process(app)
    item = await get(app, item_id)
    assert (item.status, item.sub_source, item.title, item.source_url) == ("ready", "platform", "A page title", None)
    assert (await get(app, named)).title == "My own name"  # a user title is never replaced
    req = requests[0]
    assert (req.url, req.user_id, req.asr_available, req.settings.library_transcode_max_height) == (
        "https://www.example.com/v/1", UID, False, 720)
    assert req.tmp_dir == paths.tmp_dir(app.state.library.deps.data_dir, item_id)


async def test_concurrency_and_the_switch(app):
    use_fakes(app)
    for _ in range(3):
        await seed(app, fake_media(), subs=SRT)
    assert await process(app) == 1  # library_job_concurrency = 1
    app.state.settings = app.state.settings.model_copy(update={"library_job_concurrency": 4})
    assert await process(app) == 2
    await seed(app, fake_media(), subs=SRT)
    app.state.settings = app.state.settings.model_copy(update={"library_enabled": False})
    assert await app.state.library.run_once() == 0


async def test_cancel_stops_a_running_job_and_cleans_up(app):
    gate = asyncio.Event()

    class Slow(FakeTools):
        async def normalize(self, *a, **kw):
            gate.set()
            await asyncio.sleep(30)

    use_fakes(app, Slow())
    item_id = await seed(app, fake_media(), subs=SRT)
    await app.state.library.run_once()
    await asyncio.wait_for(gate.wait(), 5)
    async with app.state.sessionmaker() as s:
        row = await s.get(LibraryItem, item_id)
        row.status = "canceled"
        await s.commit()
    await app.state.library.cancel(item_id)
    await drain_background(app)
    assert (await get(app, item_id)).status == "canceled"
    assert not paths.tmp_dir(app.state.library.deps.data_dir, item_id).exists()
    assert app.state.library.running == {}


async def test_a_deleted_item_aborts_quietly(app):
    class Deleting(FakeTools):
        async def normalize(self, src, info, out_dir, **kw):
            async with app.state.sessionmaker() as s:
                await s.delete(await s.get(LibraryItem, item_id))
                await s.commit()
            return await super().normalize(src, info, out_dir, **kw)

    use_fakes(app, Deleting())
    item_id = await seed(app, fake_media(), subs=SRT)
    await process(app)
    data_dir = app.state.library.deps.data_dir
    assert not paths.item_dir(data_dir, UID, item_id).exists() and not paths.tmp_dir(data_dir, item_id).exists()


async def test_shutdown_leaves_processing_rows_for_recovery_and_the_loop_recovers_them(app):
    class Slow(FakeTools):
        async def normalize(self, *a, **kw):
            await asyncio.sleep(30)

    use_fakes(app, Slow())
    item_id = await seed(app, fake_media(), subs=SRT)
    await app.state.library.run_once()
    await asyncio.sleep(0.05)
    await app.state.library.shutdown(wait=2)
    assert (await get(app, item_id)).status == "processing"
    use_fakes(app)
    loop = asyncio.create_task(app.state.library.loop())
    try:
        for _ in range(100):
            await asyncio.sleep(0.05)
            await drain_background(app)
            if (await get(app, item_id)).status == "ready":
                break
        assert (await get(app, item_id)).status == "ready"
    finally:
        loop.cancel()
        await asyncio.gather(loop, return_exceptions=True)


async def test_sweep_expires_uploads_purges_old_failures_and_orphan_staging(app):
    worker = app.state.library
    data_dir = worker.deps.data_dir
    now = utcnow()
    expired = await seed(app, status="uploading", updated_at=now - timedelta(hours=25))
    stale = await seed(app, status="failed", updated_at=now - timedelta(days=8), media_path=None)
    paths.item_dir(data_dir, UID, stale).mkdir(parents=True)
    ready = await seed(app, status="ready")
    kept = await seed(app, status="failed")
    orphan = paths.tmp_dir(data_dir, "0f0e0d0c-0b0a-4908-8706-050403020100")
    orphan.mkdir(parents=True)
    counts = await worker.sweep(now)
    assert counts == {"expired": 1, "purged": 1, "orphans": 2}
    assert (await get(app, expired)).error_kind == "upload_expired" and await get(app, stale) is None
    assert not paths.item_dir(data_dir, UID, stale).exists() and not orphan.exists()
    assert not paths.tmp_dir(data_dir, ready).exists() and paths.tmp_dir(data_dir, kept).exists()


def test_fetch_interface_is_the_s2_contract():
    assert list(pipeline.FetchRequest.__dataclass_fields__) == ["item_id", "user_id", "url", "tmp_dir", "settings",
                                                                "asr_available", "report"]
    assert list(pipeline.FetchResult.__dataclass_fields__) == ["media_path", "title", "duration_ms", "subtitle_path",
                                                               "subtitle_auto", "source_host"]


async def test_no_fetch_raises_unsupported_site():
    with pytest.raises(LibraryError) as e:
        await pipeline.NoFetch().fetch(None)
    assert e.value.kind == "unsupported_site"


def test_staging_rule_lists_are_json_safe():
    from app.library.worker import DROP_STAGING
    assert "no_subtitles" not in DROP_STAGING and "quota" not in DROP_STAGING and "upstream" not in DROP_STAGING
    json.dumps(sorted(DROP_STAGING))


@pytest.mark.skipif(shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None, reason="ffmpeg not installed")
async def test_real_ffmpeg_end_to_end(app):
    """The default tools (real ffmpeg / ffprobe): a VP9/Opus webm upload with subtitles becomes an H.264/AAC mp4."""
    item_id = await seed(app, None, subs=SRT)
    src = paths.tmp_dir(app.state.library.deps.data_dir, item_id) / "in.webm"
    subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                    "testsrc=size=320x240:rate=10:duration=6", "-f", "lavfi", "-i", "sine=f=440:d=6", "-shortest",
                    "-c:v", "libvpx-vp9", "-c:a", "libopus", str(src)], check=True, timeout=120)
    await process(app)
    item = await get(app, item_id)
    assert (item.status, item.kind, item.media_mime, item.seg_count) == ("ready", "video", "video/mp4", 2)
    info = await Ffmpeg().probe(app.state.library.deps.data_dir / item.media_path, home=src.parent.parent)
    assert (info.vcodec, info.acodec) == ("h264", "aac") and item.poster_path is not None
````

Edit `server/tests/background.py` —— old_string:

````python
    judge = getattr(state, "links_judge", None)
    if judge is not None:
        out.append(judge.pending)
````

new_string:

````python
    judge = getattr(state, "links_judge", None)
    if judge is not None:
        out.append(judge.pending)
    library = getattr(state, "library", None)
    if library is not None:  # library jobs (spec 2026-10-13-video-import §6.1); its poll loop is never in here
        out.append(library.pending)
````

- [ ] **Step 2: 运行确认失败** — `cd server && uv run pytest -q tests/test_library_worker.py` → `ImportError: cannot import name 'pipeline' from 'app.library'`(测试文件收集失败)。

- [ ] **Step 3: 实现**

Write `server/app/library/pipeline.py`:

````python
"""一个条目的处理流水线(spec §6.2):取回(仅链接)→ 探测 → 转码 → 字幕 → 转写 → 分句 → 完成。

每个阶段都以「产物在不在」为准,所以自动 / 手动重试从断点继续:规范化后的媒体已在成品目录就跳过取回与转码,
`_tmp/<id>/chunks.json` 里已转写的块不再花钱。进度按权重写库(链接:取回 0–40、转码 40–60、转写 60–95、
分句与收尾 95–100;上传:转码 0–50、转写 50–95),变化 ≥ 2 个百分点或距上次 ≥ 1 秒才写;写库发现条目已不在
`processing`(取消 / 删除)就抛 `Aborted`。

取回阶段只有一个接口 `FetchStage`;默认实现 `NoFetch` 抛 `unsupported_site`,计划 S2 在 `main.py` 的锚点处换成
yt-dlp 的实现(spec §15)。日志只记条目 id、阶段、错误种类、字节数与毫秒数。
"""
import asyncio
import json
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Protocol

from sqlalchemy import update

from app.library import asr_chunks, limits, paths, segment, store, subtitles
from app.library.errors import Aborted, LibraryError
from app.library.media import ProbeInfo
from app.models import LibraryItem

logger = logging.getLogger(__name__)

UPLOADED_SUBS = "subs.raw"
PLATFORM_SUBS = "platform.srt"
SILENCES = "silences.json"
SPEECH_WAV = "speech.wav"
CHUNKS = "chunks.json"
INPUT_PREFIX = "in."


# ---- the fetch stage interface (implemented by plan S2) ----

@dataclass(frozen=True)
class FetchRequest:
    item_id: str
    user_id: int
    url: str
    tmp_dir: Path  # the item's `_tmp` directory: write every output here, never elsewhere
    settings: Any  # the current Settings (read the library_* limits from it)
    asr_available: bool  # transcription is possible: then skip platform auto-captions (E6)
    report: Callable[[int], Awaitable[None]]  # progress 0-100 inside the fetch stage; raises Aborted when canceled


@dataclass(frozen=True)
class FetchResult:
    media_path: Path  # the downloaded file, inside tmp_dir
    title: str | None = None  # the page title; used only when the item's title is "" (never logged)
    duration_ms: int | None = None  # informational; the probe decides
    subtitle_path: Path | None = None  # an SRT inside tmp_dir (manual subtitles, or auto ones only without ASR)
    subtitle_auto: bool = False  # platform auto-captions (the parser already drops rolling repeats)
    source_host: str | None = None


class FetchStage(Protocol):
    async def fetch(self, req: FetchRequest) -> FetchResult: ...


class NoFetch:
    """Until plan S2 registers yt-dlp: every link fails as `unsupported_site`."""

    async def fetch(self, req: FetchRequest) -> FetchResult:
        raise LibraryError("unsupported_site")


# ---- dependencies ----

class MediaTools(Protocol):
    async def probe(self, src: Path, *, home: Path) -> ProbeInfo: ...

    async def normalize(self, src: Path, info: ProbeInfo, out_dir: Path, *, max_height: int, home: Path,
                        progress: Callable[[float], Awaitable[None]] | None = None) -> Any: ...

    async def poster(self, media: Path, dst: Path, duration_ms: int, *, home: Path) -> bool: ...

    async def speech_wav(self, src: Path, dst: Path, duration_ms: int, *, home: Path) -> list: ...


@dataclass
class PipelineDeps:
    sessionmaker: Any
    settings: Callable[[], Any]
    data_dir: Path
    tools: MediaTools
    fetch: Callable[[], FetchStage]  # read at run time: S2 may replace the stage after startup
    transcriber: Callable[[int], Callable[[bytes], Awaitable[str]]]  # user id -> (16 kHz WAV -> text)
    clock: Callable[[], datetime]


class Progress:
    """Throttled stage / progress writes. `Aborted` once the item left `processing`."""

    def __init__(self, deps: PipelineDeps, item_id: str, monotonic: Callable[[], float] = time.monotonic):
        self._deps = deps
        self._item_id = item_id
        self._monotonic = monotonic
        self.stage: str | None = None
        self.value = -100
        self._at = float("-inf")

    async def set(self, stage: str, value: int) -> None:
        now = self._monotonic()
        if stage == self.stage and (value == self.value or (value - self.value < 2 and now - self._at < 1.0)):
            return
        async with self._deps.sessionmaker() as s:
            if not await store.set_progress(s, self._item_id, stage, value, self._deps.clock()):
                raise Aborted()
        self.stage, self.value, self._at = stage, value, now


def _input_file(tmp: Path) -> Path | None:
    return next((p for p in sorted(tmp.glob(INPUT_PREFIX + "*")) if p.is_file()), None)


def _fragments(cues: list[subtitles.Cue]) -> list[segment.Fragment]:
    return [segment.Fragment(c.start_ms, c.end_ms, c.text) for c in cues]


async def _media_stage(deps: PipelineDeps, item: LibraryItem, tmp: Path, progress: Progress) -> int:
    """Fetch (links) or take the upload, probe, normalize and move into the item directory. Returns the duration."""
    settings = deps.settings()
    link = item.source == "link"
    t0, t1 = (40, 60) if link else (0, 50)
    if link:
        await progress.set("fetch", 0)
        result = await deps.fetch().fetch(fetch_request(item, tmp, settings, progress))
        src = result.media_path
        if result.subtitle_path is not None and result.subtitle_path.is_file():
            paths.replace(result.subtitle_path, tmp / PLATFORM_SUBS)
        values = {}
        if result.title and not item.title:  # the user gave no title (R-SC22)
            values["title"] = store.clean_title(result.title)
        if result.source_host and not item.source_host:
            values["source_host"] = result.source_host[:64]
        if values:
            async with deps.sessionmaker() as s:
                await s.execute(update(LibraryItem).where(LibraryItem.id == item.id).values(**values))
                await s.commit()
    else:
        src = _input_file(tmp)
        if src is None:
            raise LibraryError("corrupt")
    await progress.set("probe", t0)
    info = await deps.tools.probe(src, home=tmp)
    if not info.has_audio:
        raise LibraryError("no_audio")
    if info.duration_ms > settings.library_max_duration_minutes * 60_000:
        raise LibraryError("too_long")
    if paths.disk_free(tmp) < 2 * paths.file_bytes(src):
        raise LibraryError("disk_full")
    await progress.set("transcode", t0)
    out_dir = tmp / "out"
    out_dir.mkdir(parents=True, exist_ok=True)

    async def on_progress(fraction: float) -> None:
        await progress.set("transcode", t0 + round((t1 - t0) * fraction))

    normalized = await deps.tools.normalize(src, info, out_dir, max_height=settings.library_transcode_max_height,
                                            home=tmp, progress=on_progress)
    poster = out_dir / "poster.jpg"
    has_poster = normalized.kind == "video" and await deps.tools.poster(normalized.path, poster, info.duration_ms,
                                                                        home=tmp)
    final = paths.item_dir(deps.data_dir, item.user_id, item.id)
    media_dst = final / normalized.path.name
    paths.replace(normalized.path, media_dst)
    poster_dst = final / "poster.jpg"
    if has_poster:
        paths.replace(poster, poster_dst)
    size = paths.file_bytes(media_dst) + (paths.file_bytes(poster_dst) if has_poster else 0)
    rel = paths.item_rel(item.user_id, item.id)
    async with deps.sessionmaker() as s:
        done = await s.execute(update(LibraryItem).where(LibraryItem.id == item.id,
                                                         LibraryItem.status == "processing").values(
            kind=normalized.kind, duration_ms=info.duration_ms, media_path=f"{rel}/{media_dst.name}",
            poster_path=f"{rel}/poster.jpg" if has_poster else None, media_mime=normalized.mime,
            library_bytes=size, updated_at=deps.clock()))
        await s.commit()
    if done.rowcount != 1:
        paths.remove_tree(final)
        raise Aborted()
    src.unlink(missing_ok=True)  # the original upload / download is not kept (spec §5.1)
    logger.info("library media ready item=%s kind=%s duration_ms=%d bytes=%d", item.id, normalized.kind,
                info.duration_ms, size)
    return info.duration_ms


def fetch_request(item: LibraryItem, tmp: Path, settings, progress: Progress) -> FetchRequest:
    async def report(percent: int) -> None:
        await progress.set("fetch", round(40 * max(0, min(100, percent)) / 100))

    return FetchRequest(item_id=item.id, user_id=item.user_id, url=item.source_url or "", tmp_dir=tmp,
                        settings=settings, asr_available=settings.library_asr_available, report=report)


async def _add_asr_seconds(deps: PipelineDeps, item_id: str, seconds: int) -> None:
    if seconds <= 0:
        return
    async with deps.sessionmaker() as s:
        await s.execute(update(LibraryItem).where(LibraryItem.id == item_id)
                        .values(asr_seconds=LibraryItem.asr_seconds + seconds))
        await s.commit()


async def _transcribe(deps: PipelineDeps, item: LibraryItem, media: Path, duration_ms: int, tmp: Path,
                      progress: Progress, t0: int) -> list[segment.Sentence]:
    settings = deps.settings()
    wav, state_path, silences_path = tmp / SPEECH_WAV, tmp / CHUNKS, tmp / SILENCES
    chunks = asr_chunks.load_state(state_path)
    silences: list[asr_chunks.Silence] | None = None
    try:
        silences = [asr_chunks.Silence(int(a), int(b)) for a, b in json.loads(silences_path.read_text("utf-8"))]
    except (OSError, ValueError, TypeError):
        silences = None
    if silences is None or not wav.is_file():
        silences = await deps.tools.speech_wav(media, wav, duration_ms, home=tmp)
        silences_path.write_text(json.dumps([[s.start_ms, s.end_ms] for s in silences]), encoding="utf-8")
    if chunks is None:
        chunks = asr_chunks.plan_chunks(duration_ms, silences)
        asr_chunks.save_state(state_path, chunks)
    need = sum(c.seconds for c in chunks if c.text is None)
    uid, day = str(item.user_id), limits.day_of(deps.clock())
    async with deps.sessionmaker() as s:
        if not await limits.reserve(s, limits.SCOPE_ASR, uid, day, need,
                                    settings.library_asr_minutes_daily_per_user * 60):
            raise LibraryError("quota")
        if not await limits.reserve(s, limits.SCOPE_ASR, limits.GLOBAL, day, need,
                                    settings.library_asr_minutes_global_daily * 60):
            await limits.release(s, limits.SCOPE_ASR, uid, day, need)
            raise LibraryError("quota")
    t1 = 95

    async def read(chunk: asr_chunks.Chunk) -> bytes:
        return await asyncio.to_thread(asr_chunks.slice_wav, wav, chunk.start_ms, chunk.end_ms)

    async def on_chunk(done: int, total: int) -> None:
        await progress.set("transcribe", t0 + (t1 - t0) * done // max(1, total))

    await progress.set("transcribe", t0)
    try:
        spent = await asr_chunks.transcribe_chunks(
            chunks, read=read, transcribe=deps.transcriber(item.user_id),
            save=lambda c: asr_chunks.save_state(state_path, c), progress=on_chunk,
            concurrency=limits.ASR_CONCURRENCY, retries=limits.ASR_CHUNK_RETRIES)
    except BaseException:
        unspent = sum(c.seconds for c in chunks if c.text is None)
        async with deps.sessionmaker() as s:  # give back what was not transcribed (spec §6.4 step 7)
            await limits.release(s, limits.SCOPE_ASR, uid, day, unspent)
            await limits.release(s, limits.SCOPE_ASR, limits.GLOBAL, day, unspent)
        await _add_asr_seconds(deps, item.id, need - unspent)
        raise
    await _add_asr_seconds(deps, item.id, spent)
    logger.info("library transcribed item=%s chunks=%d seconds=%d", item.id, len(chunks), spent)
    return segment.build(asr_chunks.fragments(chunks, silences), adjust=asr_chunks.snapper(silences))


async def process(deps: PipelineDeps, item_id: str) -> None:
    """Run one claimed item to `ready`. Raises LibraryError (classified failure) or Aborted (canceled / deleted)."""
    async with deps.sessionmaker() as s:
        item = await s.get(LibraryItem, item_id)
        if item is None or item.status != "processing":
            raise Aborted()
    settings = deps.settings()
    tmp = paths.tmp_dir(deps.data_dir, item.id)
    tmp.mkdir(parents=True, exist_ok=True)
    progress = Progress(deps, item.id)
    media = deps.data_dir / item.media_path if item.media_path else None
    if media is None or not media.is_file():
        duration_ms = await _media_stage(deps, item, tmp, progress)
        async with deps.sessionmaker() as s:
            item = await s.get(LibraryItem, item_id)
        media = deps.data_dir / item.media_path
    else:
        duration_ms = item.duration_ms or 0
    t0 = 60 if item.source == "link" else 50
    await progress.set("subtitles", t0)
    sentences: list[segment.Sentence]
    if (tmp / UPLOADED_SUBS).is_file():
        cues = subtitles.parse((tmp / UPLOADED_SUBS).read_bytes())
        sentences, sub_source = segment.build(_fragments(cues)), "uploaded"
        if not sentences:
            raise LibraryError("bad_subtitle")
    elif (tmp / PLATFORM_SUBS).is_file() and (cues := _platform_cues(tmp / PLATFORM_SUBS)):
        sentences, sub_source = segment.build(_fragments(cues)), "platform"
    elif settings.library_asr_available:
        sentences, sub_source = await _transcribe(deps, item, media, duration_ms, tmp, progress, t0), "asr"
    else:
        raise LibraryError("no_subtitles")
    if not sentences:
        raise LibraryError("no_subtitles")
    await progress.set("segment", 95)
    async with deps.sessionmaker() as s:
        row = await s.get(LibraryItem, item_id)
        if row is None or row.status != "processing":
            raise Aborted()
        await store.write_segments(s, row, sentences)
        row.sub_source, row.status, row.stage, row.progress = sub_source, "ready", None, 100
        row.error_kind, row.source_url, row.next_run_at, row.attempts = None, None, None, 0
        row.updated_at = deps.clock()
        await s.commit()
    paths.remove_tree(tmp)
    logger.info("library item ready item=%s sentences=%d sub_source=%s", item_id, len(sentences), sub_source)


def _platform_cues(path: Path) -> list[subtitles.Cue]:
    try:
        return subtitles.parse(path.read_bytes())
    except LibraryError:
        return []  # unusable platform subtitles: fall through to transcription
````

Write `server/app/library/worker.py`:

````python
"""进程内后台队列(spec §6.1、§6.5):`app.state.library` 是唯一的 `LibraryWorker`。

- `loop()`(lifespan 里的 `tasks["library"]`):启动时把 `processing` 恢复为 `queued` 并清扫一次,之后每 2 秒或被
  `wake()` 唤醒时 `run_once()`;每天清扫一次。循环本身不在 `pending` 里(它按设计一直在睡)。
- `run_once()`:按 `created_at` 原子认领到期的 `queued` 条目,最多 `library_job_concurrency` 个同时运行;
  运行中的任务在 `pending`(完成自己移除;`tests/background.py` 等它)。测试不起循环,手动调 `run_once()`。
- 失败:瞬时错误(upstream / network / ytdlp_transient)自动重试 ≤ 2 次,退避 30 s、120 s;其余直接 `failed`。
  意外异常按 `upstream` 处理(计划 R-SC18)。取消 = 结束子进程、清 `_tmp`;关停 = 取消所有任务,条目留在
  `processing`,下次启动恢复。
- 每个任务都 `metering.bind_user(所有者)` + `feature_scope("library")`(spec §2.2「用量归属」)。
日志只有条目 id、错误种类、异常类名与数字。"""
import asyncio
import logging
import time
import weakref
from datetime import datetime, timedelta
from pathlib import Path

from app.core import metering
from app.library import limits, paths, pipeline, store
from app.library.errors import LINK, TRANSIENT, Aborted, LibraryError
from app.library.media import Ffmpeg
from app.library.pipeline import FetchStage, NoFetch, PipelineDeps
from app.library.tickets import MediaTicketStore
from app.models import LibraryItem, utcnow
from app.speech.asr import make_transcriber, shared_asr_gate

logger = logging.getLogger(__name__)

FEATURE = "library"
SWEEP_EVERY_SECONDS = 24 * 3600
CANCEL_WAIT_SECONDS = 5.0
# permanent failures whose staging files are useless for a retry (the upload / download is broken or refused)
DROP_STAGING = frozenset({"corrupt", "too_long", "no_audio", "unsupported_format", "too_large", "upload_expired",
                          "bad_subtitle"}) | LINK


class LibraryWorker:
    def __init__(self, deps: PipelineDeps, *, monotonic=time.monotonic):
        self.deps = deps
        self.fetch_stage: FetchStage = NoFetch()
        self.tickets = MediaTicketStore()
        self.pending: set[asyncio.Task] = set()
        self.running: dict[str, asyncio.Task] = {}
        self._canceled: set[str] = set()
        self._locks: weakref.WeakValueDictionary[str, asyncio.Lock] = weakref.WeakValueDictionary()
        self._wake: asyncio.Event | None = None
        self._monotonic = monotonic

    # ---- hooks for the routers ----

    def set_fetch_stage(self, stage: FetchStage) -> None:
        """Plan S2 registers the yt-dlp stage here (main.py anchor)."""
        self.fetch_stage = stage

    def wake(self) -> None:
        if self._wake is not None:
            self._wake.set()

    def upload_lock(self, item_id: str) -> asyncio.Lock:
        lock = self._locks.get(item_id)
        if lock is None:
            lock = self._locks[item_id] = asyncio.Lock()
        return lock

    async def cancel(self, item_id: str) -> None:
        """Stop a running job (the caller already changed the row) and wait for its subprocesses to end."""
        task = self.running.get(item_id)
        if task is None or task.done():
            return
        self._canceled.add(item_id)
        task.cancel()
        try:
            await asyncio.wait_for(asyncio.shield(asyncio.gather(task, return_exceptions=True)), CANCEL_WAIT_SECONDS)
        except (TimeoutError, asyncio.TimeoutError):
            logger.warning("library cancel slow item=%s", item_id)

    # ---- queue ----

    async def run_once(self) -> int:
        settings = self.deps.settings()
        if not settings.library_available:
            return 0
        free = settings.library_job_concurrency - len(self.running)
        async with self.deps.sessionmaker() as s:
            claimed = await store.claim(s, self.deps.clock(), free)
        for item in claimed:
            task = asyncio.get_running_loop().create_task(self._job(item.id, item.user_id))
            self.running[item.id] = task
            self.pending.add(task)
            task.add_done_callback(self.pending.discard)
        return len(claimed)

    async def _job(self, item_id: str, user_id: int) -> None:
        started = self._monotonic()
        metering.bind_user(user_id)  # this task's own context copy
        try:
            with metering.feature_scope(FEATURE):
                await pipeline.process(self.deps, item_id)
        except Aborted:
            self._drop_staging(item_id)
            logger.info("library job aborted item=%s", item_id)
        except asyncio.CancelledError:
            if item_id not in self._canceled:
                raise  # shutdown: the row stays `processing` and is recovered at the next start
            self._drop_staging(item_id)
            logger.info("library job canceled item=%s", item_id)
        except LibraryError as e:
            await self._failed(item_id, e.kind)
        except Exception as e:  # noqa: BLE001 - an unexpected bug: classify as transient, log the class only
            logger.warning("library job crashed item=%s error=%s", item_id, type(e).__name__)
            await self._failed(item_id, "upstream")
        else:
            logger.info("library job done item=%s ms=%d", item_id, (self._monotonic() - started) * 1000)
        finally:
            self.running.pop(item_id, None)
            self._canceled.discard(item_id)

    async def _failed(self, item_id: str, kind: str) -> None:
        now = self.deps.clock()
        async with self.deps.sessionmaker() as s:
            row = await s.get(LibraryItem, item_id)
            if row is None:
                return
            retry_at = None
            if kind in TRANSIENT and row.attempts < limits.AUTO_RETRIES:
                retry_at = now + timedelta(seconds=limits.BACKOFF_SECONDS[row.attempts])
            await store.fail(s, item_id, kind, retry_at=retry_at, now=now)
        if retry_at is None and kind in DROP_STAGING:
            self._drop_staging(item_id)
        logger.info("library job failed item=%s kind=%s retry=%s", item_id, kind, retry_at is not None)

    def _drop_staging(self, item_id: str) -> None:
        try:
            paths.remove_tree(paths.tmp_dir(self.deps.data_dir, item_id))
        except ValueError:
            pass

    # ---- loop, sweep, shutdown ----

    async def loop(self) -> None:
        self._wake = asyncio.Event()
        async with self.deps.sessionmaker() as s:
            recovered = await store.recover(s, self.deps.clock())
        logger.info("library worker started recovered=%d", recovered)
        await self._safe_sweep()
        last_sweep = self._monotonic()
        while True:
            try:
                await self.run_once()
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001 - keep polling
                logger.warning("library worker poll failed error=%s", type(e).__name__)
            if self._monotonic() - last_sweep >= SWEEP_EVERY_SECONDS:
                await self._safe_sweep()
                last_sweep = self._monotonic()
            try:
                await asyncio.wait_for(self._wake.wait(), limits.POLL_SECONDS)
            except (TimeoutError, asyncio.TimeoutError):
                pass
            self._wake.clear()

    async def _safe_sweep(self) -> None:
        try:
            await self.sweep(self.deps.clock())
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001
            logger.warning("library sweep failed error=%s", type(e).__name__)

    async def sweep(self, now: datetime) -> dict[str, int]:
        """Expire 24 h old uploads, purge failed / canceled items after 7 days (rows + files), and remove staging
        directories whose item is gone, ready or canceled (failed items keep theirs for a retry; R-SC17)."""
        data_dir = self.deps.data_dir
        async with self.deps.sessionmaker() as s:
            expired = await store.expire_uploads(s, now)
            stale = await store.stale_items(s, now)
            for _user, item_id in stale:
                if item_id not in self.running:
                    await store.delete_item_rows(s, item_id)
            await s.commit()
        for item_id in expired:
            self._drop_staging(item_id)
        for user_id, item_id in stale:
            if item_id not in self.running:
                paths.remove_item_files(data_dir, user_id, item_id)
        orphans = 0
        root = paths.tmp_root(data_dir)
        if root.is_dir():
            names = [p.name for p in root.iterdir() if p.is_dir() and store.is_item_id(p.name)]
            async with self.deps.sessionmaker() as s:
                known = await store.statuses(s, names)
            for name in names:
                if name not in self.running and known.get(name) in (None, "ready", "canceled"):
                    paths.remove_tree(root / name)
                    orphans += 1
        counts = {"expired": len(expired), "purged": len(stale), "orphans": orphans}
        logger.info("library sweep expired=%d purged=%d orphans=%d", *counts.values())
        return counts

    async def join(self) -> None:
        while self.pending:
            await asyncio.gather(*list(self.pending), return_exceptions=True)

    async def shutdown(self, wait: float = limits.SHUTDOWN_WAIT_SECONDS) -> None:
        """Cancel running jobs (rows stay `processing`, recovered at the next start); wait at most `wait` seconds."""
        tasks = [t for t in self.pending if not t.done()]
        for task in tasks:
            task.cancel()
        if tasks:
            try:
                await asyncio.wait_for(asyncio.gather(*tasks, return_exceptions=True), wait)
            except (TimeoutError, asyncio.TimeoutError):
                logger.warning("library shutdown left jobs=%d", len([t for t in tasks if not t.done()]))


def install(app) -> LibraryWorker:
    """Build the one worker on `app.state.library` (called from `create_app`). Settings are read per call;
    the data directory is fixed at startup (DATA_DIR is env-only)."""
    state = app.state

    def settings():
        return state.settings

    def transcriber(user_id: int):
        s = settings()
        return make_transcriber(state.http, s, "en", gate=shared_asr_gate(state, s), uid=str(user_id))

    worker: LibraryWorker | None = None
    deps = PipelineDeps(sessionmaker=state.sessionmaker, settings=settings,
                        data_dir=Path(state.settings.resolved_data_dir), tools=Ffmpeg(),
                        fetch=lambda: worker.fetch_stage, transcriber=transcriber, clock=utcnow)
    worker = LibraryWorker(deps)
    state.library = worker
    return worker
````

Edit `server/app/main.py` —— old_string:

````python
from app.agents.tutor.handler import TutorModeHandler  # agents tutor mode (plan A3)
````

new_string:

````python
from app.agents.tutor.handler import TutorModeHandler  # agents tutor mode (plan A3)
from app.library.worker import install as install_library  # imported media library (plan 2026-10-13 S1)
````

Edit `server/app/main.py` —— old_string:

````python
        tasks["links_purge"] = asyncio.create_task(links_purge.daily_loop(app_))  # learning links §12
        yield
        await _stop_tasks(tasks, exclude="metering")
````

new_string:

````python
        tasks["links_purge"] = asyncio.create_task(links_purge.daily_loop(app_))  # learning links §12
        tasks["library"] = asyncio.create_task(app_.state.library.loop())  # library queue (video-import §6.1)
        yield
        await _stop_tasks(tasks, exclude="metering")
        await app_.state.library.shutdown()  # running jobs stay `processing`; recovered at the next start
````

Edit `server/app/main.py` —— old_string:

````python
    app.state.rooms_extensions = (rooms_voice.install, rooms_summary.install, rooms_agents.install)  # + agents (plan A5)
````

new_string:

````python
    app.state.rooms_extensions = (rooms_voice.install, rooms_summary.install, rooms_agents.install)  # + agents (plan A5)
    install_library(app)  # app.state.library: queue, media tickets, fetch stage (spec 2026-10-13-video-import §6.1)
    # --- anchor for plan S2 (2026-10-13-video-import-server-import): `library_import.install(app)` goes on the next
    # line; it registers the yt-dlp fetch stage with app.state.library.set_fetch_stage(...) ---
````

- [ ] **Step 4: 运行通过** — `cd server && uv run pytest -q tests/test_library_worker.py tests/test_architecture.py` → 全绿。

- [ ] **Step 5: 提交**

```bash
git add server/tests/library_helpers.py server/tests/test_library_worker.py server/tests/background.py server/app/library/pipeline.py server/app/library/worker.py server/app/main.py
git commit -m "feat(server): library pipeline and in-process worker" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 11: 接口 `routers/library.py`、共用的取消 / 删除、评测与练习清单的 `library` 来源

**Files:**
- Create: `server/tests/test_library_api.py`、`server/tests/test_library_media_api.py`、`server/app/routers/library.py`
- Modify: `server/app/library/store.py`、`server/app/main.py`、`server/app/routers/speech.py`、`server/app/routers/practice_items.py`

**Interfaces(Produces):** `routers/library.py` 的 20 个路由(见「对外接口」W1 段;D8 的 `translate` / `analysis` 两个由 T11b 追加);`store.cancel_item` / `store.delete_item`;`speech.SOURCES` 与练习清单 `source` 接受 `library`。

- [ ] **Step 1: 写失败测试**

Write `server/tests/test_library_api.py`:

````python
"""跟读库接口:开关、配置、分片上传、条目列表 / 详情 / 修改 / 删除 / 重试 / 取消(spec §8、§9)。"""
import pytest
from sqlalchemy import func, select

from app.core import config as config_module
from app.library import limits, paths
from app.models import DailyUsage, LibraryItem
from tests.library_helpers import SRT, FakeTools, enable, fake_media, library_settings, process, upload, use_fakes

CHUNK = limits.CHUNK_BYTES


@pytest.fixture
def settings_overrides(request, tmp_path):
    return library_settings(tmp_path, **getattr(request, "param", {}))


@pytest.fixture(autouse=True)
def _tools(monkeypatch):
    enable(monkeypatch)


def data_dir(app):
    return app.state.library.deps.data_dir


@pytest.mark.parametrize("settings_overrides", [{"library_enabled": False}], indirect=True)
async def test_switch_off_means_404_except_config(client, auth_headers):
    r = await client.get("/api/library/config", headers=auth_headers)
    assert r.status_code == 200 and r.json()["enabled"] is False
    for method, url in (("GET", "/api/library/items"), ("POST", "/api/library/uploads"),
                        ("GET", "/api/library/items/0f0e0d0c-0b0a-4908-8706-050403020100/media?ticket=x")):
        r = await client.request(method, url, headers=auth_headers, json={})
        assert r.status_code == 404 and r.json() == {"error": "Library is disabled"}, url


async def test_everything_needs_a_login(client):
    for method, url in (("GET", "/api/library/config"), ("GET", "/api/library/items"), ("POST", "/api/library/uploads")):
        assert (await client.request(method, url, json={})).status_code == 401


async def test_config_reports_switches_limits_and_usage(app, client, auth_headers, monkeypatch):
    r = await client.get("/api/library/config", headers=auth_headers)
    assert r.json() == {"enabled": True, "link_import": False, "asr": False, "ai": False, "limits": {
        "max_upload_mb": 500, "max_duration_minutes": 90, "quota_mb": 2000, "used_bytes": 0, "max_items": 100,
        "chunk_bytes": CHUNK, "formats": list(limits.UPLOAD_EXTENSIONS)}}
    monkeypatch.setattr(config_module, "media_tools_present", lambda: False)
    assert (await client.get("/api/library/config", headers=auth_headers)).json()["enabled"] is False
    monkeypatch.setattr(config_module, "media_tools_present", lambda: True)
    monkeypatch.setattr(config_module, "ytdlp_present", lambda: True)
    app.state.settings = app.state.settings.model_copy(update={"library_link_import_enabled": True,
                                                               "library_asr_enabled": True,
                                                               "library_ai_enabled": True})
    body = (await client.get("/api/library/config", headers=auth_headers)).json()
    assert (body["link_import"], body["asr"], body["ai"]) == (True, True, True)
    app.state.settings = app.state.settings.model_copy(update={"upstream_llm_base_url": ""})
    assert (await client.get("/api/library/config", headers=auth_headers)).json()["ai"] is False  # no LLM configured


async def test_chunked_upload_resumes_and_is_idempotent(app, client, auth_headers):
    use_fakes(app)
    data = fake_media() + b" " * (CHUNK + 10)
    r = await client.post("/api/library/uploads", headers=auth_headers, json={"filename": "Talk_one.MKV", "size": len(data)})
    item_id = r.json()["item_id"]
    assert r.json() == {"item_id": item_id, "chunk_bytes": CHUNK}
    part = lambda n: {"chunk": ("blob", data[n * CHUNK:(n + 1) * CHUNK], "application/octet-stream")}  # noqa: E731
    url = f"/api/library/uploads/{item_id}/chunks"
    assert (await client.put(f"{url}/1", headers=auth_headers, files=part(1))).status_code == 409  # out of order
    r = await client.put(f"{url}/0", headers=auth_headers, files=part(0))
    assert r.json()["upload_received"] == CHUNK
    r = await client.put(f"{url}/0", headers=auth_headers, files=part(0))  # resent after a lost response
    assert r.status_code == 200 and r.json()["upload_received"] == CHUNK
    short = {"chunk": ("blob", b"xx", "application/octet-stream")}
    assert (await client.put(f"{url}/1", headers=auth_headers, files=short)).json() == {"error": "Wrong chunk size"}
    assert (await client.post(f"/api/library/uploads/{item_id}/complete", headers=auth_headers)).status_code == 409
    state = (await client.get(f"/api/library/uploads/{item_id}", headers=auth_headers)).json()
    assert (state["upload_received"], state["upload_total"], state["status"]) == (CHUNK, len(data), "uploading")
    assert (await client.put(f"{url}/1", headers=auth_headers, files=part(1))).status_code == 200
    r = await client.post(f"/api/library/uploads/{item_id}/complete", headers=auth_headers)
    assert r.json()["item"]["status"] == "queued" and r.json()["item"]["title"] == "Talk one"
    assert (paths.tmp_dir(data_dir(app), item_id) / "in.mkv").read_bytes() == data
    assert (await client.put(f"{url}/2", headers=auth_headers, files=part(1))).json() == {"error": "Upload is not in progress"}


async def test_chunk_size_cap(app, client, auth_headers):
    item_id = (await client.post("/api/library/uploads", headers=auth_headers,
                                 json={"filename": "a.mp4", "size": CHUNK * 3})).json()["item_id"]
    big = {"chunk": ("blob", b"x" * (CHUNK + 1), "application/octet-stream")}
    r = await client.put(f"/api/library/uploads/{item_id}/chunks/0", headers=auth_headers, files=big)
    assert r.status_code == 413 and r.json() == {"error": "Chunk is too large"}


@pytest.mark.parametrize("body, status, error", [
    ({"filename": "notes.txt", "size": 10}, 400, "Unsupported file type"),
    ({"filename": "big.mp4", "size": 500 * 1_048_576 + 1}, 413, "File is too large"),
    ({"filename": "a.mp4", "size": 0}, 422, None),
    ({"filename": "a.mp4", "size": 1, "extra": 1}, 422, None),
], ids=["type", "size", "zero", "extra-key"])
async def test_upload_start_validation(client, auth_headers, body, status, error):
    r = await client.post("/api/library/uploads", headers=auth_headers, json=body)
    assert r.status_code == status
    if error:
        assert r.json() == {"error": error}


@pytest.mark.parametrize("settings_overrides", [{"library_quota_mb": 1, "library_imports_daily_per_user": 3}],
                         indirect=True)
async def test_upload_quota_parallel_and_daily_limits(app, client, auth_headers):
    r = await client.post("/api/library/uploads", headers=auth_headers, json={"filename": "a.mp4", "size": 1_048_577})
    assert (r.status_code, r.json()) == (409, {"error": "Library storage quota reached"})
    for _ in range(2):
        assert (await client.post("/api/library/uploads", headers=auth_headers,
                                  json={"filename": "a.mp4", "size": 10})).status_code == 200
    r = await client.post("/api/library/uploads", headers=auth_headers, json={"filename": "a.mp4", "size": 10})
    assert (r.status_code, r.json()) == (409, {"error": "Too many uploads in progress"})
    async with app.state.sessionmaker() as s:
        assert await s.scalar(select(DailyUsage.count).where(DailyUsage.scope == "library_imports")) == 2


async def test_upload_subtitles_are_validated_and_used(app, client, auth_headers):
    use_fakes(app)
    item_id = await upload(client, auth_headers, fake_media(), subs=None, complete=False)
    bad = {"file": ("x.srt", b"no cues here", "text/plain")}
    r = await client.put(f"/api/library/uploads/{item_id}/subtitles", headers=auth_headers, files=bad)
    assert (r.status_code, r.json()) == (400, {"error": "Invalid subtitle file"})
    r = await client.put(f"/api/library/uploads/{item_id}/subtitles", headers=auth_headers,
                         files={"file": ("x.srt", SRT, "application/x-subrip")})
    assert r.json() == {"cue_count": 2}
    await client.post(f"/api/library/uploads/{item_id}/complete", headers=auth_headers)
    await process(app)
    detail = (await client.get(f"/api/library/items/{item_id}", headers=auth_headers)).json()
    assert detail["item"]["status"] == "ready" and detail["item"]["sub_source"] == "uploaded"
    assert [s["text"] for s in detail["segments"]] == ["Hello there, my friend.", "How are you doing today?"]
    assert detail["item"]["last_opened_at"] is not None


async def test_items_are_private_paged_and_patchable(app, client, auth_headers):
    use_fakes(app)
    ids = [await upload(client, auth_headers, fake_media(), subs=SRT) for _ in range(2)]
    other = await client.post("/api/users", json={"username": "bob", "password": "password123"})
    bob = {"Authorization": f"Bearer {other.json()['access_token']}"}
    assert (await client.get(f"/api/library/items/{ids[0]}", headers=bob)).status_code == 404
    assert (await client.get("/api/library/items", headers=bob)).json() == {"items": [], "next_cursor": None}
    listed = (await client.get("/api/library/items", headers=auth_headers)).json()
    assert [i["id"] for i in listed["items"]] == ids[::-1] and listed["next_cursor"] is None
    await process(app)
    r = await client.patch(f"/api/library/items/{ids[0]}", headers=auth_headers,
                           json={"title": "  New   name ", "resume_ms": 1500, "resume_idx": 1, "rate_pct": 75})
    item = r.json()["item"]
    assert (item["title"], item["resume_ms"], item["resume_idx"], item["rate_pct"]) == ("New name", 1500, 1, 75)
    for body, error in (({}, "No changes"), ({"resume_ms": 6001}, "Invalid resume position"),
                        ({"resume_idx": 2}, "Invalid resume position")):
        assert (await client.patch(f"/api/library/items/{ids[0]}", headers=auth_headers, json=body)).json() == {
            "error": error}
    assert (await client.patch(f"/api/library/items/{ids[0]}", headers=auth_headers,
                               json={"rate_pct": 200})).status_code == 422


async def test_delete_removes_rows_files_and_tickets(app, client, auth_headers):
    use_fakes(app)
    item_id = await upload(client, auth_headers, fake_media(), subs=SRT)
    await process(app)
    url = (await client.post(f"/api/library/items/{item_id}/media-ticket", headers=auth_headers)).json()["url"]
    assert (await client.delete(f"/api/library/items/{item_id}", headers=auth_headers)).json() == {"deleted": True}
    async with app.state.sessionmaker() as s:
        assert await s.scalar(select(func.count()).select_from(LibraryItem)) == 0
    assert not paths.item_dir(data_dir(app), await _uid(client, auth_headers), item_id).exists()
    assert (await client.get(url)).status_code == 401
    assert (await client.delete(f"/api/library/items/{item_id}", headers=auth_headers)).status_code == 404


async def _uid(client, headers) -> int:
    return int((await client.get("/api/me", headers=headers)).json()["id"])


async def test_retry_and_cancel(app, client, auth_headers):
    use_fakes(app, FakeTools(fail={"normalize": "corrupt"}))
    item_id = await upload(client, auth_headers, fake_media(), subs=SRT)
    await process(app)
    assert (await client.get(f"/api/library/items/{item_id}", headers=auth_headers)).json()["item"]["error_kind"] == "corrupt"
    r = await client.post(f"/api/library/items/{item_id}/retry", headers=auth_headers)
    assert (r.status_code, r.json()) == (409, {"error": "Nothing left to retry"})  # the broken upload was dropped
    use_fakes(app, FakeTools(fail={"normalize": "disk_full"}))
    item_id = await upload(client, auth_headers, fake_media(), subs=SRT)
    await process(app)
    use_fakes(app)
    r = await client.post(f"/api/library/items/{item_id}/retry", headers=auth_headers)
    assert r.json()["item"]["status"] == "queued" and r.json()["item"]["error_kind"] is None
    assert (await client.post(f"/api/library/items/{item_id}/retry", headers=auth_headers)).json() == {
        "error": "Item has not failed"}
    r = await client.post(f"/api/library/items/{item_id}/cancel", headers=auth_headers)
    assert r.json()["item"]["status"] == "canceled" and r.json()["item"]["library_bytes"] == 0
    assert not paths.tmp_dir(data_dir(app), item_id).exists()
    assert (await client.post(f"/api/library/items/{item_id}/cancel", headers=auth_headers)).json() == {
        "error": "Item cannot be canceled"}
    assert await app.state.library.run_once() == 0


async def test_cancel_an_upload_in_progress(app, client, auth_headers):
    item_id = await upload(client, auth_headers, fake_media(), complete=False)
    assert (await client.post(f"/api/library/items/{item_id}/cancel", headers=auth_headers)).json()["item"][
        "status"] == "canceled"
    r = await client.put(f"/api/library/uploads/{item_id}/chunks/0", headers=auth_headers,
                         files={"chunk": ("b", b"x", "application/octet-stream")})
    assert r.json() == {"error": "Upload is not in progress"}
````

Write `server/tests/test_library_media_api.py`:

````python
"""媒体票据与 Range、封面、补传字幕、句子微调、跟读成绩、评测与练习清单的 `library` 来源(spec §9、§10)。"""
import pytest
from sqlalchemy import select

from app.models import Assessment, LibraryItem, User
from app.services.provider_clients import get_xfyun
from tests.library_helpers import SRT, enable, fake_media, library_settings, process, upload, use_fakes
from tests.test_assessment_save import GOOD_XML, FakeXfyun, make_wav

MEDIA = fake_media(6000) + bytes(range(256)) * 8  # 2 KiB+ of known bytes


@pytest.fixture
def settings_overrides(request, tmp_path):
    return library_settings(tmp_path, **getattr(request, "param", {}))


@pytest.fixture(autouse=True)
def _tools(monkeypatch):
    enable(monkeypatch)


async def ready_item(app, client, headers) -> str:
    use_fakes(app)
    item_id = await upload(client, headers, MEDIA, subs=SRT)
    await process(app)
    return item_id


async def ticket_url(client, headers, item_id) -> str:
    r = await client.post(f"/api/library/items/{item_id}/media-ticket", headers=headers)
    assert r.status_code == 200 and r.json()["expires_in"] == 1800
    url = r.json()["url"]
    assert url.startswith(f"/api/library/items/{item_id}/media?ticket=")
    return url


async def test_media_needs_a_ticket_and_supports_ranges(app, client, auth_headers):
    item_id = await ready_item(app, client, auth_headers)
    url = await ticket_url(client, auth_headers, item_id)
    size = len(MEDIA)
    r = await client.get(url)  # no Authorization header: the ticket is the credential
    assert r.status_code == 200 and r.content == MEDIA and r.headers["content-type"] == "video/mp4"
    assert r.headers["accept-ranges"] == "bytes" and r.headers["cache-control"] == "private, no-store"
    assert r.headers["referrer-policy"] == "no-referrer"
    r = await client.get(url, headers={"Range": "bytes=0-1"})
    assert (r.status_code, r.content, r.headers["content-range"]) == (206, MEDIA[:2], f"bytes 0-1/{size}")
    r = await client.get(url, headers={"Range": "bytes=100-"})
    assert r.status_code == 206 and r.content == MEDIA[100:]
    r = await client.get(url, headers={"Range": "bytes=-500"})
    assert r.status_code == 206 and r.content == MEDIA[-500:]
    r = await client.get(url, headers={"Range": f"bytes={size}-"})
    assert r.status_code == 416 and r.headers["content-range"] == f"bytes */{size}"
    etag = (await client.get(url)).headers["etag"]
    assert (await client.get(url, headers={"Range": "bytes=0-1", "If-Range": etag})).status_code == 206
    assert (await client.get(url, headers={"Range": "bytes=0-1", "If-Range": '"stale"'})).status_code == 200
    assert (await client.head(url)).status_code == 200


async def test_bad_tickets_other_items_deleted_items_and_disabled_users(app, client, auth_headers):
    item_id = await ready_item(app, client, auth_headers)
    other_id = await ready_item(app, client, auth_headers)
    url = await ticket_url(client, auth_headers, item_id)
    base = f"/api/library/items/{item_id}/media"
    assert (await client.get(base)).json() == {"error": "Invalid ticket"}
    assert (await client.get(base + "?ticket=forged")).status_code == 401
    assert (await client.get(url.replace(item_id, other_id))).status_code == 401  # bound to its item
    async with app.state.sessionmaker() as s:
        user = (await s.scalars(select(User))).first()
        user.disabled_at = user.created_at
        await s.commit()
    assert (await client.get(url)).status_code == 404
    async with app.state.sessionmaker() as s:
        user = (await s.scalars(select(User))).first()
        user.disabled_at = None
        await s.commit()
    assert (await client.get(url)).status_code == 200


async def test_tickets_only_for_ready_items_and_poster_needs_bearer(app, client, auth_headers):
    item_id = await upload(client, auth_headers, MEDIA, complete=False)
    r = await client.post(f"/api/library/items/{item_id}/media-ticket", headers=auth_headers)
    assert (r.status_code, r.json()) == (409, {"error": "Item is not ready"})
    ready = await ready_item(app, client, auth_headers)
    assert (await client.get(f"/api/library/items/{ready}/poster")).status_code == 401
    r = await client.get(f"/api/library/items/{ready}/poster", headers=auth_headers)
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg" and r.content.startswith(b"\xff\xd8")


async def test_replacing_subtitles_resegments_a_ready_item(app, client, auth_headers):
    item_id = await ready_item(app, client, auth_headers)
    new = b"1\n00:00:01,000 --> 00:00:04,000\nA brand new first line here.\n"
    r = await client.put(f"/api/library/items/{item_id}/subtitles", headers=auth_headers,
                         files={"file": ("n.srt", new, "application/x-subrip")})
    body = r.json()
    assert body["item"]["seg_count"] == 1 and [(s["idx"], s["start_ms"], s["end_ms"], s["text"]) for s in body["segments"]] == [
        (0, 1000, 4000, "A brand new first line here.")]
    assert (body["segments"][0]["zh"], body["segments"][0]["has_analysis"]) == (None, False)  # E11: replaced = cleared
    r = await client.put(f"/api/library/items/{item_id}/subtitles", headers=auth_headers,
                         files={"file": ("n.srt", b"garbage", "text/plain")})
    assert r.json() == {"error": "Invalid subtitle file"}


async def test_subtitles_rescue_a_failed_no_subtitles_item(app, client, auth_headers):
    use_fakes(app)
    item_id = await upload(client, auth_headers, MEDIA)
    await process(app)
    item = (await client.get(f"/api/library/items/{item_id}", headers=auth_headers)).json()["item"]
    assert (item["status"], item["error_kind"]) == ("failed", "no_subtitles")
    r = await client.put(f"/api/library/items/{item_id}/subtitles", headers=auth_headers,
                         files={"file": ("s.srt", SRT, "application/x-subrip")})
    assert r.json()["item"]["status"] == "queued"
    await process(app)
    item = (await client.get(f"/api/library/items/{item_id}", headers=auth_headers)).json()["item"]
    assert (item["status"], item["sub_source"]) == ("ready", "uploaded")


async def test_segment_fine_tuning(app, client, auth_headers):
    item_id = await ready_item(app, client, auth_headers)  # sentences 500-3000, 3200-6000; duration 6000
    url = f"/api/library/items/{item_id}/segments"
    r = await client.patch(f"{url}/0", headers=auth_headers, json={"start_ms": 300, "end_ms": 3200,
                                                                   "text": "  Hello  there, my dear friend. "})
    assert r.json() == {"segment": {"idx": 0, "start_ms": 300, "end_ms": 3200, "text": "Hello there, my dear friend.",
                                    "zh": None, "zh_lang": None, "has_analysis": False, "analysis_lang": None}}
    for idx, body, error in (
        (0, {"end_ms": 3201}, "Invalid sentence times"),  # overlaps the next sentence
        (1, {"end_ms": 6001}, "Invalid sentence times"),  # beyond the media
        (1, {"start_ms": 6000}, "Invalid sentence times"),  # empty
        (0, {"text": "123 456"}, "Invalid sentence text"),
        (0, {"text": "a" * 601}, "Invalid sentence text"),
        (0, {}, "No changes"),
        (5, {"text": "Hi"}, "Sentence not found"),
    ):
        assert (await client.patch(f"{url}/{idx}", headers=auth_headers, json=body)).json() == {"error": error}


async def _assessment(app, uid, text, source="library", score=81.6) -> str:
    async with app.state.sessionmaker() as s:
        row = Assessment(user_id=uid, reference_text=text, language="en-US", duration_ms=500, audio_bytes=1,
                         scores={"pronunciation_score": score}, result={}, audio_path="x", source=source)
        s.add(row)
        await s.commit()
        return row.id


async def test_attempts_check_the_assessment_and_keep_the_best_score_per_current_text(app, client, auth_headers):
    item_id = await ready_item(app, client, auth_headers)
    uid = int((await client.get("/api/me", headers=auth_headers)).json()["id"])
    url = f"/api/library/items/{item_id}/attempts"
    good = await _assessment(app, uid, "Hello there,  my friend.")
    assert (await client.post(url, headers=auth_headers, json={"seg_idx": 0, "assessment_id": good})).json() == {
        "seg_idx": 0, "score": 82}
    better = await _assessment(app, uid, "Hello there, my friend.", score=95)
    await client.post(url, headers=auth_headers, json={"seg_idx": 0, "assessment_id": better})
    await client.post(url, headers=auth_headers, json={"seg_idx": 0, "assessment_id": better})  # counted once
    for aid, idx in ((await _assessment(app, uid, "Hello there, my friend.", source="practice"), 0),
                     (await _assessment(app, uid, "Something else."), 0), (good, 1)):
        r = await client.post(url, headers=auth_headers, json={"seg_idx": idx, "assessment_id": aid})
        assert r.json() == {"error": "Assessment does not match"}
    stats = (await client.get(url, headers=auth_headers)).json()["attempts"]
    assert [(a["seg_idx"], a["best_score"], a["count"]) for a in stats] == [(0, 95, 2)]
    await client.patch(f"/api/library/items/{item_id}/segments/0", headers=auth_headers, json={"text": "Hello friend."})
    assert (await client.get(url, headers=auth_headers)).json() == {"attempts": []}  # the text changed


async def test_speech_and_practice_items_accept_the_library_source(app, client, auth_headers):
    fake = FakeXfyun()
    app.dependency_overrides[get_xfyun] = lambda: fake
    r = await client.post("/api/speech/assessments", headers=auth_headers,
                          data={"reference": "Hello there", "language": "en-US", "save": "true", "source": "library"},
                          files={"file": ("a.wav", make_wav(), "audio/wav")})
    assert r.status_code == 200, r.text
    async with app.state.sessionmaker() as s:
        assert (await s.scalars(select(Assessment.source))).all() == ["library"]
    r = await client.post("/api/practice-items", headers=auth_headers, json={"text": "Hello there.", "source": "library"})
    assert r.status_code == 200 and r.json()["source"] == "library"
    assert GOOD_XML  # the fake upstream answers with this sample
    async with app.state.sessionmaker() as s:
        assert (await s.scalars(select(LibraryItem))).all() == []
````

- [ ] **Step 2: 运行确认失败** — `cd server && uv run pytest -q tests/test_library_api.py tests/test_library_media_api.py` → 全部新用例 404(路由不存在);`test_speech_and_practice_items_accept_the_library_source` 400 / 422。

- [ ] **Step 3: 实现**

Edit `server/app/library/store.py` —— old_string:

````python
from app.library.limits import (
````

new_string:

````python
from app.library import paths
from app.library.limits import (
````

Edit `server/app/library/store.py` —— old_string:

````python
本模块只读写库(停任务、删文件的 `cancel_item` / `delete_item` 由 Task 11 追加)。
````

new_string:

````python
除 `cancel_item` / `delete_item`(停任务、删文件,路由与管理端共用)外只读写库。
````

Edit `server/app/library/store.py` —— old_string:

````python


# ---- the worker's queue ----
````

new_string:

````python


async def cancel_item(session: AsyncSession, app, item: LibraryItem) -> bool:
    """spec §6.5: an uploading / queued / processing item becomes `canceled`, its job and subprocesses stop, its
    staging and media files go, its tickets die. False = it was not active (nothing changed). Commits.
    Shared by `POST /api/library/items/{id}/cancel` and the admin console (plan A)."""
    done = await session.execute(update(LibraryItem).where(LibraryItem.id == item.id, LibraryItem.status.in_(ACTIVE))
                                 .values(status="canceled", stage=None, updated_at=utcnow()))
    await session.commit()
    if done.rowcount != 1:
        return False
    worker = app.state.library
    await worker.cancel(item.id)
    worker.tickets.revoke_item(item.id)
    paths.remove_item_files(app.state.library.deps.data_dir, item.user_id, item.id)
    await session.execute(update(LibraryItem).where(LibraryItem.id == item.id).values(
        media_path=None, poster_path=None, library_bytes=0, error_kind=None, source_url=None))
    await session.commit()
    await session.refresh(item)
    return True


async def delete_item(session: AsyncSession, app, item: LibraryItem) -> None:
    """spec §4 / §6.5: deleting implies canceling; then explicit deletes of attempts, sentences and the item, and
    both directories. Commits. Shared by `DELETE /api/library/items/{id}` and the admin console (plan A).
    Assessments and recordings made while shadowing stay (they belong to the practice history)."""
    item_id, user_id = item.id, item.user_id
    if item.status in ACTIVE:
        await cancel_item(session, app, item)
    await delete_item_rows(session, item_id)
    await session.commit()
    app.state.library.tickets.revoke_item(item_id)
    paths.remove_item_files(app.state.library.deps.data_dir, user_id, item_id)


# ---- the worker's queue ----
````

Write `server/app/routers/library.py`:

````python
"""跟读库接口 `/api/library/*`(spec 2026-10-13-video-import §8–§10)。

全部要求登录(媒体读取除外:它只认票据);`LIBRARY_ENABLED` 关 = 除 `GET /config` 外 404 `Library is disabled`
(先鉴权,未登录 401 优先)。URL 里只有 uuid、序号与票据,不出现标题、URL、文字;错误文本是固定英文(`ERRORS`,
契约夹具里有一份给网页的 `LIBRARY_SERVER_ERRORS`)。创建类端点(上传开始、媒体票据)走 `limited_user`;
分片与媒体读取不走每分钟限流。链接导入 `POST /imports` 在 `routers/library_import.py`(计划 S2)。
日志只有条目 id、序号、字节数;标题、文件名、字幕、票据一律不记。"""
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path as PathParam, Query, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.datastructures import UploadFile

from app.core.config import Settings
from app.core.deps import current_user, get_session, get_settings, limited_user
from app.core.quotas import effective
from app.library import limits, paths, segment, store, subtitles
from app.library.errors import API_ERRORS, LibraryError, api_error, http_error
from app.library.pipeline import UPLOADED_SUBS, INPUT_PREFIX
from app.library.worker import LibraryWorker
from app.models import Assessment, LibraryItem, User, utcnow
from app.services.uploads import parse_buffered_form

router = APIRouter(prefix="/api/library")
logger = logging.getLogger(__name__)

ERRORS = API_ERRORS  # the fixed English error texts (app/library/errors.py); recorded in the contract fixture
NO_STORE = {"Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff"}
ItemId = Annotated[str, PathParam(max_length=36)]


def fail(code: str) -> HTTPException:
    return api_error(code)


def require_library(_: User = Depends(current_user), settings: Settings = Depends(get_settings)) -> Settings:
    if not settings.library_enabled:
        raise fail("disabled")
    return settings


def runtime(request: Request) -> LibraryWorker:
    return request.app.state.library


async def owned(session: AsyncSession, user: User, item_id: str) -> LibraryItem:
    item = await store.get_owned(session, user.id, item_id)
    if item is None:
        raise fail("not_found")
    return item


async def read_body(request: Request, limit: int, code: str) -> bytes:
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > limit:
        raise fail(code)
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            raise fail(code)
        chunks.append(chunk)
    return b"".join(chunks)


async def form_file(request: Request, field: str, limit: int, too_large: str, missing: str) -> bytes:
    body = await read_body(request, limit + limits.CHUNK_SLACK, too_large)
    form = await parse_buffered_form(request, body)
    try:
        upload = form.get(field)
        if not isinstance(upload, UploadFile):
            raise fail(missing)
        data = await upload.read()
    finally:
        await form.close()
    if len(data) > limit:
        raise fail(too_large)
    return data


# ---- config ----

@router.get("/config")
async def config(request: Request, user: User = Depends(current_user), settings: Settings = Depends(get_settings),
                 session: AsyncSession = Depends(get_session)):
    enabled = settings.library_available
    app = request.app
    return {
        "enabled": enabled,
        "link_import": enabled and settings.library_link_available,
        "asr": enabled and settings.library_asr_available,
        "ai": enabled and settings.library_ai_available,  # D8:关 = 译文 / 分析接口 404,网页不显示「译」与「分析」
        "limits": {
            "max_upload_mb": settings.library_max_upload_mb,
            "max_duration_minutes": settings.library_max_duration_minutes,
            "quota_mb": await effective(session, app, user.id, "library_quota_mb"),
            "used_bytes": await limits.used_bytes(session, user.id),
            "max_items": await effective(session, app, user.id, "library_max_items"),
            "chunk_bytes": limits.CHUNK_BYTES,
            "formats": list(limits.UPLOAD_EXTENSIONS),
        },
    }


# ---- uploads (spec §8) ----

class UploadIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    filename: str = Field(min_length=1, max_length=255)
    size: int = Field(ge=1)
    title: str | None = Field(default=None, max_length=400)


def _part_file(data_dir, item_id: str):
    tmp = paths.tmp_dir(data_dir, item_id)
    return next(iter(sorted(tmp.glob("upload.*.part"))), None) if tmp.is_dir() else None


@router.post("/uploads")
async def start_upload(payload: UploadIn, request: Request, user: User = Depends(limited_user),
                       settings: Settings = Depends(require_library), session: AsyncSession = Depends(get_session)):
    ext = store.extension_of(payload.filename)
    if ext not in limits.UPLOAD_EXTENSIONS:
        raise fail("format")
    if payload.size > settings.library_max_upload_mb * limits.MB:
        raise fail("too_large")
    try:
        await limits.admit_new_item(session, request.app, user.id, size_bytes=payload.size, upload=True)
    except LibraryError as e:
        raise http_error(e) from None
    title = payload.title if payload.title and payload.title.strip() else store.title_from_filename(payload.filename)
    item = await store.create_upload(session, user.id, title=title, size=payload.size, ext=ext)
    tmp = paths.tmp_dir(settings.resolved_data_dir, item.id)
    tmp.mkdir(parents=True, exist_ok=True)
    (tmp / f"upload.{ext}.part").write_bytes(b"")
    logger.info("library upload started item=%s bytes=%d", item.id, payload.size)
    return {"item_id": item.id, "chunk_bytes": limits.CHUNK_BYTES}


def _upload_state(item: LibraryItem) -> dict:
    return {"item_id": item.id, "status": item.status, "upload_received": item.upload_received,
            "upload_total": item.upload_total, "chunk_bytes": limits.CHUNK_BYTES}


@router.get("/uploads/{item_id}")
async def upload_state(item_id: ItemId, user: User = Depends(current_user), _: Settings = Depends(require_library),
                       session: AsyncSession = Depends(get_session)):
    return _upload_state(await owned(session, user, item_id))


@router.put("/uploads/{item_id}/chunks/{n}")
async def put_chunk(request: Request, item_id: ItemId, n: int = PathParam(ge=0, le=1_000_000),
                    user: User = Depends(current_user), settings: Settings = Depends(require_library),
                    session: AsyncSession = Depends(get_session)):
    item = await owned(session, user, item_id)
    if item.status != "uploading":
        raise fail("not_uploading")
    data = await form_file(request, "chunk", limits.CHUNK_BYTES, "chunk_too_large", "chunk_required")
    async with runtime(request).upload_lock(item.id):
        await session.refresh(item)
        if item.status != "uploading":
            raise fail("not_uploading")
        part = _part_file(settings.resolved_data_dir, item.id)
        if part is None:
            raise fail("upload_expired")
        size = limits.CHUNK_BYTES
        offset = n * size
        expected_len = min(size, item.upload_total - offset)
        if offset + len(data) <= item.upload_received and len(data) == expected_len:
            return _upload_state(item)  # a chunk we already have, sent again: idempotent
        if offset != item.upload_received:
            raise fail("unexpected_chunk")
        if expected_len <= 0 or len(data) != expected_len:
            raise fail("chunk_size")
        with part.open("ab") as fh:
            fh.write(data)
        item.upload_received += len(data)
        item.updated_at = utcnow()
        await session.commit()
    return _upload_state(item)


@router.put("/uploads/{item_id}/subtitles")
async def put_upload_subtitles(request: Request, item_id: ItemId, user: User = Depends(current_user),
                               settings: Settings = Depends(require_library),
                               session: AsyncSession = Depends(get_session)):
    item = await owned(session, user, item_id)
    if item.status != "uploading":
        raise fail("not_uploading")
    data = await form_file(request, "file", limits.SUBTITLE_MAX_BYTES, "too_large", "file_required")
    try:
        cues = subtitles.parse(data)
    except LibraryError:
        raise fail("bad_subtitle") from None
    tmp = paths.tmp_dir(settings.resolved_data_dir, item.id)
    if not tmp.is_dir():
        raise fail("upload_expired")
    (tmp / UPLOADED_SUBS).write_bytes(data)
    return {"cue_count": len(cues)}


@router.post("/uploads/{item_id}/complete")
async def complete_upload(request: Request, item_id: ItemId, user: User = Depends(current_user),
                          settings: Settings = Depends(require_library), session: AsyncSession = Depends(get_session)):
    item = await owned(session, user, item_id)
    async with runtime(request).upload_lock(item.id):
        await session.refresh(item)
        if item.status != "uploading":
            raise fail("not_uploading")
        if item.upload_received != item.upload_total:
            raise fail("incomplete")
        part = _part_file(settings.resolved_data_dir, item.id)
        if part is None:
            raise fail("upload_expired")
        ext = part.name.split(".")[1]
        part.rename(part.with_name(f"{INPUT_PREFIX}{ext}"))
        item.status, item.updated_at = "queued", utcnow()
        await session.commit()
    runtime(request).wake()
    logger.info("library upload complete item=%s bytes=%d", item.id, item.upload_total)
    return {"item": store.item_out(item)}


# ---- items (spec §9) ----

@router.get("/items")
async def list_items(cursor: str | None = Query(None, max_length=36), user: User = Depends(current_user),
                     _: Settings = Depends(require_library), session: AsyncSession = Depends(get_session)):
    rows, next_cursor = await store.list_page(session, user.id, cursor)
    return {"items": [store.item_out(r) for r in rows], "next_cursor": next_cursor}


@router.get("/items/{item_id}")
async def get_item(item_id: ItemId, user: User = Depends(current_user), _: Settings = Depends(require_library),
                   session: AsyncSession = Depends(get_session)):
    item = await owned(session, user, item_id)
    segs = await store.segments_of(session, item.id) if item.status == "ready" else []
    if item.status == "ready":
        item.last_opened_at = utcnow()
        await session.commit()
    return {"item": store.item_out(item), "segments": [store.segment_out(s) for s in segs]}


class ItemPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str | None = Field(default=None, max_length=400)
    resume_ms: int | None = Field(default=None, ge=0)
    resume_idx: int | None = Field(default=None, ge=0)
    rate_pct: int | None = Field(default=None, ge=limits.RATE_BOUNDS[0], le=limits.RATE_BOUNDS[1])


@router.patch("/items/{item_id}")
async def patch_item(payload: ItemPatch, item_id: ItemId, user: User = Depends(current_user),
                     _: Settings = Depends(require_library), session: AsyncSession = Depends(get_session)):
    changes = payload.model_dump(exclude_none=True)
    if not changes:
        raise fail("no_changes")
    item = await owned(session, user, item_id)
    if "resume_ms" in changes and changes["resume_ms"] > (item.duration_ms or 0):
        raise fail("bad_resume")
    if "resume_idx" in changes and changes["resume_idx"] >= max(1, item.seg_count):
        raise fail("bad_resume")
    if "title" in changes:
        item.title = store.clean_title(changes.pop("title"), item.title)
    for key, value in changes.items():
        setattr(item, key, value)
    item.updated_at = utcnow()
    await session.commit()
    return {"item": store.item_out(item)}


@router.delete("/items/{item_id}")
async def delete_item(request: Request, item_id: ItemId, user: User = Depends(current_user),
                      _: Settings = Depends(require_library), session: AsyncSession = Depends(get_session)):
    item = await owned(session, user, item_id)
    await store.delete_item(session, request.app, item)
    logger.info("library item deleted item=%s", item_id)
    return {"deleted": True}


def _has_material(data_dir, item: LibraryItem) -> bool:
    if item.source == "link":
        return bool(item.source_url)
    if item.media_path and (data_dir / item.media_path).is_file():
        return True
    tmp = paths.tmp_dir(data_dir, item.id)
    return tmp.is_dir() and any(tmp.glob(INPUT_PREFIX + "*"))


@router.post("/items/{item_id}/retry")
async def retry_item(request: Request, item_id: ItemId, user: User = Depends(current_user),
                     settings: Settings = Depends(require_library), session: AsyncSession = Depends(get_session)):
    item = await owned(session, user, item_id)
    if item.status != "failed":
        raise fail("not_failed")
    if not settings.library_available:
        raise fail("unavailable")
    if not _has_material(settings.resolved_data_dir, item):
        raise fail("no_material")
    item.status, item.stage, item.progress, item.error_kind = "queued", None, 0, None
    item.attempts, item.next_run_at, item.updated_at = 0, None, utcnow()
    await session.commit()
    runtime(request).wake()
    return {"item": store.item_out(item)}


@router.post("/items/{item_id}/cancel")
async def cancel_item(request: Request, item_id: ItemId, user: User = Depends(current_user),
                      _: Settings = Depends(require_library), session: AsyncSession = Depends(get_session)):
    item = await owned(session, user, item_id)
    if not await store.cancel_item(session, request.app, item):
        raise fail("not_active")
    return {"item": store.item_out(item)}


@router.put("/items/{item_id}/subtitles")
async def put_item_subtitles(request: Request, item_id: ItemId, user: User = Depends(current_user),
                             settings: Settings = Depends(require_library),
                             session: AsyncSession = Depends(get_session)):
    """ready → re-segment now from the new subtitles (R-SC21); failed(no_subtitles) → back to the queue."""
    item = await owned(session, user, item_id)
    if not (item.status == "ready" or (item.status == "failed" and item.error_kind == "no_subtitles")):
        raise fail("subs_state")
    data = await form_file(request, "file", limits.SUBTITLE_MAX_BYTES, "too_large", "file_required")
    try:
        cues = subtitles.parse(data)
    except LibraryError:
        raise fail("bad_subtitle") from None
    sentences = segment.build([segment.Fragment(c.start_ms, c.end_ms, c.text) for c in cues])
    if not sentences:
        raise fail("bad_subtitle")
    if item.status == "ready":
        await store.write_segments(session, item, sentences)
        item.sub_source, item.updated_at = "uploaded", utcnow()
        await session.commit()
        segs = await store.segments_of(session, item.id)
        return {"item": store.item_out(item), "segments": [store.segment_out(s) for s in segs]}
    tmp = paths.tmp_dir(settings.resolved_data_dir, item.id)
    tmp.mkdir(parents=True, exist_ok=True)
    (tmp / UPLOADED_SUBS).write_bytes(data)
    item.status, item.stage, item.progress, item.error_kind = "queued", None, 0, None
    item.attempts, item.next_run_at, item.updated_at = 0, None, utcnow()
    await session.commit()
    runtime(request).wake()
    return {"item": store.item_out(item), "segments": []}


class SegmentPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    start_ms: int | None = Field(default=None, ge=0)
    end_ms: int | None = Field(default=None, ge=0)
    text: str | None = Field(default=None, max_length=2000)


@router.patch("/items/{item_id}/segments/{idx}")
async def patch_segment(payload: SegmentPatch, item_id: ItemId, idx: int = PathParam(ge=0, le=1_000_000),
                        user: User = Depends(current_user), _: Settings = Depends(require_library),
                        session: AsyncSession = Depends(get_session)):
    changes = payload.model_dump(exclude_none=True)
    if not changes:
        raise fail("no_changes")
    item = await owned(session, user, item_id)
    if item.status != "ready":
        raise fail("not_ready")
    segs = await store.segments_of(session, item.id)
    if idx >= len(segs):
        raise fail("segment_missing")
    seg = segs[idx]
    if "text" in changes:
        text = " ".join(changes["text"].split())
        if not text or len(text) > limits.SEGMENT_TEXT_MAX or not any(c.isalpha() for c in text):
            raise fail("bad_text")
        seg.text = text
    start, end = changes.get("start_ms", seg.start_ms), changes.get("end_ms", seg.end_ms)
    low = segs[idx - 1].end_ms if idx > 0 else 0
    high = segs[idx + 1].start_ms if idx + 1 < len(segs) else (item.duration_ms or end)
    if not (low <= start < end <= high):
        raise fail("bad_times")
    seg.start_ms, seg.end_ms = start, end
    item.updated_at = utcnow()
    await session.commit()
    return {"segment": store.segment_out(seg)}


# ---- media (spec §10) ----

@router.post("/items/{item_id}/media-ticket")
async def media_ticket(request: Request, item_id: ItemId, user: User = Depends(limited_user),
                       _: Settings = Depends(require_library), session: AsyncSession = Depends(get_session)):
    item = await owned(session, user, item_id)
    if item.status != "ready" or not item.media_path:
        raise fail("not_ready")
    tickets = runtime(request).tickets
    token = tickets.issue(user.id, item.id)
    return {"url": f"/api/library/items/{item.id}/media?ticket={token}", "expires_in": tickets.ttl}


@router.get("/items/{item_id}/media")
@router.head("/items/{item_id}/media")
async def media(request: Request, item_id: ItemId, ticket: str | None = Query(None, max_length=128),
                settings: Settings = Depends(get_settings), session: AsyncSession = Depends(get_session)):
    """No Bearer: the ticket is the credential. Range / If-Range / 416 come from Starlette's FileResponse
    (pinned by tests/test_library_range.py). Every read re-checks the item and the user (one PK lookup each)."""
    if not settings.library_enabled:
        raise fail("disabled")
    user_id = runtime(request).tickets.resolve(ticket, item_id)
    if user_id is None:
        raise fail("ticket")
    user = await session.get(User, user_id)
    item = await store.get_owned(session, user_id, item_id)
    if user is None or user.disabled_at is not None or item is None or item.status != "ready" or not item.media_path:
        raise fail("not_found")
    try:
        path = paths.absolute(settings.resolved_data_dir, item.media_path)
    except ValueError:
        raise fail("not_found") from None
    if not path.is_file():
        raise fail("not_found")
    return FileResponse(path, media_type=item.media_mime or "application/octet-stream", headers=NO_STORE)


@router.get("/items/{item_id}/poster")
async def poster(item_id: ItemId, user: User = Depends(current_user), settings: Settings = Depends(require_library),
                 session: AsyncSession = Depends(get_session)):
    item = await owned(session, user, item_id)
    if not item.poster_path:
        raise fail("not_found")
    path = paths.absolute(settings.resolved_data_dir, item.poster_path)
    if not path.is_file():
        raise fail("not_found")
    return FileResponse(path, media_type="image/jpeg", headers=NO_STORE)


# ---- shadowing attempts ----

class AttemptIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    seg_idx: int = Field(ge=0, le=1_000_000)
    assessment_id: str = Field(min_length=1, max_length=36)


@router.post("/items/{item_id}/attempts")
async def add_attempt(payload: AttemptIn, item_id: ItemId, user: User = Depends(current_user),
                      _: Settings = Depends(require_library), session: AsyncSession = Depends(get_session)):
    item = await owned(session, user, item_id)
    if item.status != "ready":
        raise fail("not_ready")
    segs = await store.segments_of(session, item.id)
    if payload.seg_idx >= len(segs):
        raise fail("segment_missing")
    seg = segs[payload.seg_idx]
    assessment = await session.scalar(select(Assessment).where(Assessment.id == payload.assessment_id,
                                                               Assessment.user_id == user.id))
    if assessment is None or assessment.source != "library" or not store.same_text(assessment.reference_text, seg.text):
        raise fail("assessment")
    raw = (assessment.scores or {}).get("pronunciation_score")
    score = round(raw) if isinstance(raw, (int, float)) and not isinstance(raw, bool) else None
    row = await store.add_attempt(session, user_id=user.id, item_id=item.id, seg_idx=seg.idx,
                                  assessment_id=assessment.id, text=seg.text, score=score, now=utcnow())
    return {"seg_idx": row.seg_idx, "score": row.score}


@router.get("/items/{item_id}/attempts")
async def list_attempts(item_id: ItemId, user: User = Depends(current_user),
                        _: Settings = Depends(require_library), session: AsyncSession = Depends(get_session)):
    item = await owned(session, user, item_id)
    return {"attempts": await store.best_attempts(session, item.id, await store.segments_of(session, item.id))}
````

Edit `server/app/main.py` —— old_string:

````python
grammar, grammar_prompt, health, links,
````

new_string:

````python
grammar, grammar_prompt, health, library, links,
````

Edit `server/app/main.py` —— old_string:

````python
        links, agents, agents_tutor, admin_auth, admin, admin_accounts, admin_settings, admin_rank, admin_users, admin_rooms, admin_usage, admin_ops,
        admin_prompts, admin_wordbook, admin_links, admin_agents, stubs, admin_web, web,
````

new_string:

````python
        links, agents, agents_tutor,
        library,  # /api/library/* (spec 2026-10-13-video-import §9); before stubs
        # --- anchor for plan S2 (2026-10-13-video-import-server-import): `library_import,` goes on the next line ---
        admin_auth, admin, admin_accounts, admin_settings, admin_rank, admin_users, admin_rooms, admin_usage, admin_ops,
        admin_prompts, admin_wordbook, admin_links, admin_agents,
        # --- anchor for plan A (2026-10-13-video-import-admin): `admin_library,` goes on the next line (before stubs) ---
        stubs, admin_web, web,
````

Edit `server/app/routers/speech.py` —— old_string:

````python
SOURCES = ("practice", "chat")
````

new_string:

````python
SOURCES = ("practice", "chat", "library")
````

Edit `server/app/routers/practice_items.py` —— old_string:

````python
    source: Literal["chat", "lookup", "grammar", "manual"] = "manual"
````

new_string:

````python
    source: Literal["chat", "lookup", "grammar", "manual", "library"] = "manual"
````

- [ ] **Step 4: 运行通过** — `cd server && uv run pytest -q tests/test_library_api.py tests/test_library_media_api.py tests/test_assessment_source.py tests/test_practice_items.py tests/test_library_store.py tests/test_architecture.py` → 全绿。

- [ ] **Step 5: 提交**

```bash
git add server/tests/test_library_api.py server/tests/test_library_media_api.py server/app/library/store.py server/app/routers/library.py server/app/main.py server/app/routers/speech.py server/app/routers/practice_items.py
git commit -m "feat(server): /api/library endpoints: chunked uploads, items, media tickets, sentences and attempts" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 11a: D8 译文与分析的核心 `ai.py`、按句计的额度、写回与两个可编辑提示词

**Files:**
- Create: `server/tests/test_library_ai.py`、`server/app/library/ai.py`
- Modify: `server/app/library/limits.py`、`server/app/library/store.py`、`server/app/services/prompts.py`、`server/app/admin/prompts_admin.py`、`server/tests/test_prompts.py`、`server/tests/test_prompts_api.py`

**Interfaces(Produces):** `app.library.ai`:`LANGS`、`KEYS`、`DEFAULTS`、`DEFAULT_TRANSLATE_TEMPLATE` / `DEFAULT_ANALYZE_TEMPLATE`、`TRANSLATE_SYSTEM`、`FEATURE_TRANSLATE` / `FEATURE_ANALYSIS`、`AiUnavailable(kind)`(`user_cap` / `global_cap` / `upstream`)、`render_translate` / `render_analysis` / `render_test`、`parse_translations`、`async translate(session, http, settings, *, user_id, item_id, segments, language, template, now) -> (dict[int, str], limited)`、`async analyze(session, http, settings, *, user_id, item_id, segment, language, template, now) -> (str, cached)`。`limits`:`AI_BATCH_MAX`、`TRANSLATION_MAX`、`ANALYSIS_MAX`、`SCOPE_TRANSLATE` / `SCOPE_ANALYSIS` / `SCOPE_AI_GLOBAL`、`reserve_upto`、`reserve_ai`、`refund_ai`。`store`:`segments_at`、`clear_ai`、`set_translations`、`set_analysis`。`PROMPTS` 多两个键 `library.translate` / `library.analyze`(管理端「提示词」页自动出现,可编辑、发布、试运行)。依赖:T1(设置)、T2(四列)、T3(`limits`)、T9(`store`)。

**读真实代码得到的结论**(细节见 R-SC29–R-SC36):提示词注册表在 `app/services/prompts.py`(`PROMPTS`、`validate_prompt`、`prompt_cache`),管理端的默认正文与试运行在 `app/admin/prompts_admin.py` 里**按键分支**(不加分支,新键的默认正文会读成静态模板 JSON、试运行会误走联机助手的渲染);大模型一次调用是 `providers/llm.complete(http, settings, messages, *, model, max_tokens, temperature)`,自己 `metering.record`;`daily_usage` 的 `usage.remaining` 可以算剩余额度;`upstream_calls.feature` 只有 16 个字符。

- [ ] **Step 1: 写失败测试**

Write `server/tests/test_library_ai.py`:

````python
"""句子译文与分析(spec D8 / E11 / E12):提示词(含管理端编辑)、渲染与解析(纯函数)、按句计的额度、写回与编排
(用假的大模型;接口与真实上游形状在 test_library_ai_api.py)。"""
import json
from datetime import datetime, timezone
from pathlib import Path

import pytest
from sqlalchemy import select, update

from app.library import ai, limits, store
from app.models import DailyUsage, LibraryItem, LibrarySegment, User
from app.providers import llm
from app.services.prompts import PROMPTS, validate_prompt
from tests.admin_helpers import ADMIN_ENABLED, PASSWORD, login_as

ENJOY_COMMANDS = Path(__file__).resolve().parents[2] / "enjoy" / "src" / "shared" / "commands"
NOW = datetime(2026, 10, 13, 8, 0, tzinfo=timezone.utc)
DAY = limits.day_of(NOW)
LLM = "https://llm.test/v1/chat/completions"
TEXTS = ["Hello there, my friend.", "How are you doing today?", "I am fine, thank you."]


# ---- prompts ----

def test_language_whitelist_is_the_desktop_language_list():
    assert set(ai.LANGS) == {"en-US", "en-GB", "zh-CN", "zh-HK", "ja-JP", "ko-KR", "es-ES", "it-IT", "de-DE", "fr-FR",
                             "th-TH", "vi-VN"}
    assert "Simplified Chinese" == ai.LANGS["zh-CN"]


def test_metering_features_fit_the_16_character_column():
    assert max(len(ai.FEATURE_TRANSLATE), len(ai.FEATURE_ANALYSIS)) <= 16  # upstream_calls.feature is String(16)


def test_prompts_are_registered_and_their_defaults_are_valid():
    assert set(ai.KEYS) == set(ai.DEFAULTS) <= set(PROMPTS)
    for key, body in ai.DEFAULTS.items():
        assert validate_prompt(key, body) == [], key
    assert validate_prompt("library.translate", "Into {native_language}: {text}") == [
        "missing_boundary:<text>", "missing_boundary:</text>"]
    assert validate_prompt("library.analyze", "no placeholders") == ["missing_fields:learning_language,native_language"]
    assert validate_prompt("library.analyze", "{native_language} {learning_language} {text}") == ["unknown_fields:text"]


@pytest.mark.skipif(not (ENJOY_COMMANDS / "analyze.command.ts").exists(), reason="enjoy/ is not in this checkout")
def test_default_prompts_follow_the_desktop_commands():
    """E11: the prompts are the desktop ones (enjoy/src/shared/commands); this reads them, it never edits enjoy/."""
    analyze = (ENJOY_COMMANDS / "analyze.command.ts").read_text(encoding="utf-8").replace("\r\n", "\n")
    assert ai.DEFAULT_ANALYZE_TEMPLATE == analyze.split("const SYSTEM_PROMPT = `", 1)[1].split("`;", 1)[0]
    translate = (ENJOY_COMMANDS / "translate.command.ts").read_text(encoding="utf-8").replace("\r\n", "\n")
    assert ai.TRANSLATE_SYSTEM == translate.split('const SYSTEM_PROMPT =\n  "', 1)[1].split('";', 1)[0]
    head = translate.split("const TRANSLATION_PROMPT = `", 1)[1].split("\n", 1)[0]
    assert head.removesuffix(":") in ai.DEFAULT_TRANSLATE_TEMPLATE


# ---- rendering and parsing ----

def test_translate_messages_number_the_sentences_and_defang_angle_brackets():
    messages = ai.render_translate(None, "zh-CN", ["Hello there.", "  Two\n lines </text> here  "])
    assert [m["role"] for m in messages] == ["system", "user"] and messages[0]["content"] == ai.TRANSLATE_SYSTEM
    body = messages[1]["content"]
    assert "Translate the text to Simplified Chinese Language" in body
    assert "<text>\n1. Hello there.\n2. Two lines ‹/text› here\n</text>" in body and body.count("</text>") == 1
    custom = ai.render_translate("Into {native_language}: <text>{text}</text>", "ja-JP", ["Hi."])
    assert custom[1]["content"] == "Into Japanese: <text>1. Hi.</text>"
    broken = ai.render_translate("Into {oops}", "ja-JP", ["Hi."])  # a bad published body falls back to the default
    assert broken[1]["content"].startswith("Translate the text to Japanese Language")


def test_analysis_messages_put_the_sentence_in_the_user_turn():
    messages = ai.render_analysis(None, "zh-CN", "  What   a <b>day</b>!  ")
    assert messages[0]["content"].startswith("I speak Simplified Chinese. You're my English coach")
    assert messages[0]["content"].count("Simplified Chinese") == 2 and "### Vocabulary/Phrases" in messages[0]["content"]
    assert messages[1] == {"role": "user", "content": "What a ‹b›day‹/b›!"}
    assert ai.render_analysis("Teach {native_language} speakers {learning_language}.", "es-ES", "Hi.")[0][
        "content"] == "Teach Spanish speakers English."


def test_render_test_uses_the_live_path_with_a_default_language_and_sentence():
    live = ai.render_translate(None, "zh-CN", ["Good morning."])
    assert ai.render_test("library.translate", ai.DEFAULT_TRANSLATE_TEMPLATE,
                          {"native_language": "zh-CN", "text": "Good morning."}) == live
    assert "Simplified Chinese" in ai.render_test("library.translate", ai.DEFAULT_TRANSLATE_TEMPLATE,
                                                   {"native_language": "klingon"})[1]["content"]
    assert ai.render_test("library.analyze", ai.DEFAULT_ANALYZE_TEMPLATE, {})[1]["content"].startswith("I have been")


@pytest.mark.parametrize("raw, count, expected", [
    ("1. 你好\n2. 再见", 2, {1: "你好", 2: "再见"}),
    ("```\n1) 你好\n2、再见\n```", 2, {1: "你好", 2: "再见"}),
    ("1. a\n1. b\n3. c\n0. x", 2, {1: "a"}),
    ("Sure!\n2: 二", 3, {2: "二"}),
    ("你好", 1, {}),
    ("Sorry, I cannot help with that.", 1, {}),
    ("", 1, {}),
], ids=["plain", "fences-and-marks", "duplicates-and-range", "preamble", "unnumbered", "refusal", "empty"])
def test_parse_translations(raw, count, expected):
    assert ai.parse_translations(raw, count) == expected


def test_parsed_translations_are_capped():
    assert len(ai.parse_translations("1. " + "好" * 5000, 1)[1]) == limits.TRANSLATION_MAX


# ---- the daily allowance, counted in sentences ----

async def _counts(app) -> dict[tuple[str, str], int]:
    async with app.state.sessionmaker() as s:
        return {(r.scope, r.subject): r.count for r in (await s.scalars(select(DailyUsage))).all()}


async def test_reserve_upto_takes_all_then_what_is_left_then_nothing(app):
    async with app.state.sessionmaker() as s:
        assert await limits.reserve_upto(s, "library_translate", "7", DAY, 30, 50) == 30
        assert await limits.reserve_upto(s, "library_translate", "7", DAY, 30, 50) == 20
        assert await limits.reserve_upto(s, "library_translate", "7", DAY, 5, 50) == 0
        assert await limits.reserve_upto(s, "library_translate", "8", DAY, 5, 0) == 0
        assert await limits.reserve_upto(s, "library_translate", "8", DAY, 0, 50) == 0
        assert await limits.reserve_upto(s, "library_translate", "9", DAY, 99, 50) == 50  # more than a whole day: a day's worth


async def test_reserve_ai_spends_both_allowances_and_reports_which_cap_stopped_it(app):
    scope = limits.SCOPE_TRANSLATE
    async with app.state.sessionmaker() as s:
        assert await limits.reserve_ai(s, 7, scope, 10, 12, 8, DAY) == (8, None)
        assert await limits.reserve_ai(s, 7, scope, 10, 12, 5, DAY) == (2, "user")  # user 10/10, global 10/12
        assert await limits.reserve_ai(s, 8, scope, 10, 12, 5, DAY) == (2, "global")  # the user's 3 extra go back
        assert await limits.reserve_ai(s, 8, scope, 10, 12, 1, DAY) == (0, "global")
        assert await limits.reserve_ai(s, 7, scope, 10, 12, 1, DAY) == (0, "user")
    assert await _counts(app) == {("library_translate", "7"): 10, ("library_translate", "8"): 2, ("library_ai", "*"): 12}
    async with app.state.sessionmaker() as s:
        await limits.refund_ai(s, 8, scope, 2, DAY)
    assert await _counts(app) == {("library_translate", "7"): 10, ("library_translate", "8"): 0, ("library_ai", "*"): 10}
    async with app.state.sessionmaker() as s:
        await limits.refund_ai(s, 8, scope, 50, DAY)  # never below zero
    assert await _counts(app) == {("library_translate", "7"): 10, ("library_translate", "8"): 0, ("library_ai", "*"): 0}


# ---- write-back and orchestration (a fake model; no network) ----

class FakeLlm:
    """Stands in for `providers.llm.complete`: replies in order; an Exception instance is raised. `before` runs first."""

    def __init__(self, *replies, before=None):
        self.replies, self.calls, self.before = list(replies), [], before

    async def __call__(self, http, settings, messages, *, model, max_tokens, temperature, timeout=60.0):
        self.calls.append({"messages": messages, "model": model, "max_tokens": max_tokens, "temperature": temperature})
        if self.before is not None:
            await self.before()
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply


@pytest.fixture
def fake_llm(monkeypatch):
    def install(*replies, before=None) -> FakeLlm:
        fake = FakeLlm(*replies, before=before)
        monkeypatch.setattr(ai.llm, "complete", fake)
        return fake
    return install


async def make_item(app, texts=TEXTS) -> str:
    async with app.state.sessionmaker() as s:
        s.add(User(id=7, username="u7", password_hash="x"))
        item = LibraryItem(user_id=7, kind="video", source="upload", title="t", status="ready")
        s.add(item)
        await s.flush()
        s.add_all(LibrarySegment(item_id=item.id, idx=i, start_ms=i * 1000, end_ms=i * 1000 + 900, text=t)
                  for i, t in enumerate(texts))
        await s.commit()
        return item.id


def config(app, **update):
    return app.state.settings.model_copy(update=update)


async def run_translate(app, item_id, indices, language="zh-CN", template=None, **update):
    async with app.state.sessionmaker() as s:
        segs = await store.segments_at(s, item_id, indices)
        return await ai.translate(s, app.state.http, config(app, **update), user_id=7, item_id=item_id, segments=segs,
                                  language=language, template=template, now=NOW)


async def run_analysis(app, item_id, idx, language="zh-CN", **update):
    async with app.state.sessionmaker() as s:
        seg = (await store.segments_at(s, item_id, [idx]))[0]
        return await ai.analyze(s, app.state.http, config(app, **update), user_id=7, item_id=item_id, segment=seg,
                                language=language, template=None, now=NOW)


async def stored(app, item_id) -> list[tuple]:
    async with app.state.sessionmaker() as s:
        return [(x.idx, x.zh, x.zh_lang, x.analysis, x.analysis_lang) for x in await store.segments_of(s, item_id)]


async def test_set_translations_skips_a_sentence_edited_meanwhile(app):
    item_id = await make_item(app)
    async with app.state.sessionmaker() as s:
        done = await store.set_translations(s, item_id, [(0, TEXTS[0], "你好,朋友。"), (1, "An older text.", "旧"),
                                                         (9, "Nowhere.", "无")], "zh-CN")
        assert done == {0}
        assert await store.set_analysis(s, item_id, 2, TEXTS[2], "### Grammar", "zh-CN")
        assert not await store.set_analysis(s, item_id, 2, "An older text.", "stale", "zh-CN")
        seg = (await store.segments_at(s, item_id, [0]))[0]
        store.clear_ai(seg)
        await s.commit()
        assert [(x.zh, x.zh_lang, x.analysis) for x in await store.segments_at(s, item_id, [0, 1, 2])] == [
            (None, None, None), (None, None, None), (None, None, "### Grammar")]
        assert await store.segments_at(s, item_id, []) == []


async def test_translate_stores_the_batch_and_the_second_call_is_free(app, fake_llm):
    item_id = await make_item(app)
    llm_ = fake_llm("1. 你好,我的朋友。\n2. 你今天好吗?\n3. 我很好,谢谢。")
    done, limited = await run_translate(app, item_id, [0, 1, 2])
    assert done == {0: "你好,我的朋友。", 1: "你今天好吗?", 2: "我很好,谢谢。"} and limited is False
    call = llm_.calls[0]
    assert call["model"] == "gpt-4o" and call["temperature"] == ai.TRANSLATE_TEMPERATURE and call["max_tokens"] == 560
    assert "1. Hello there, my friend.\n2. How are you doing today?\n3. I am fine, thank you." in call[
        "messages"][1]["content"]
    assert [row[1:3] for row in await stored(app, item_id)] == [("你好,我的朋友。", "zh-CN"), ("你今天好吗?", "zh-CN"),
                                                               ("我很好,谢谢。", "zh-CN")]
    again, limited = await run_translate(app, item_id, [2, 0])
    assert again == {0: "你好,我的朋友。", 2: "我很好,谢谢。"} and not limited and len(llm_.calls) == 1  # no second call
    assert await _counts(app) == {("library_translate", "7"): 3, ("library_ai", "*"): 3}  # cache hits are not counted


async def test_a_new_native_language_translates_again(app, fake_llm):
    item_id = await make_item(app)
    fake_llm("1. 你好。", "1. こんにちは。")
    await run_translate(app, item_id, [0])
    done, _ = await run_translate(app, item_id, [0], language="ja-JP")
    assert done == {0: "こんにちは。"} and (await stored(app, item_id))[0][1:3] == ("こんにちは。", "ja-JP")


async def test_translate_stops_at_the_daily_allowance_and_says_so(app, fake_llm):
    item_id = await make_item(app)
    llm_ = fake_llm("1. 一\n2. 二")
    done, limited = await run_translate(app, item_id, [0, 1, 2], library_translate_daily_per_user=2)
    assert done == {0: "一", 1: "二"} and limited is True
    assert "3. " not in llm_.calls[0]["messages"][1]["content"]  # only the two it may afford were sent
    done, limited = await run_translate(app, item_id, [0, 1, 2], library_translate_daily_per_user=2)
    assert done == {0: "一", 1: "二"} and limited is True and len(llm_.calls) == 1  # nothing left: no call at all
    done, limited = await run_translate(app, item_id, [2], library_ai_daily_global=2)  # the site-wide cap
    assert done == {} and limited is True and len(llm_.calls) == 1


async def test_an_upstream_failure_gives_the_sentences_back(app, fake_llm):
    item_id = await make_item(app)
    fake_llm(llm.LlmUnavailable("http", 502))
    with pytest.raises(ai.AiUnavailable) as caught:
        await run_translate(app, item_id, [0, 1])
    assert caught.value.kind == "upstream"
    assert await _counts(app) == {("library_translate", "7"): 0, ("library_ai", "*"): 0}
    assert [row[1] for row in await stored(app, item_id)] == [None, None, None]


async def test_sentences_the_model_skipped_are_refunded_and_an_empty_reply_is_a_failure(app, fake_llm):
    item_id = await make_item(app)
    fake_llm("1. 你好。\n3. 很好。", "Sorry, I cannot help with that.")
    done, limited = await run_translate(app, item_id, [0, 1, 2])
    assert done == {0: "你好。", 2: "很好。"} and limited is False  # sentence 1 stays untranslated, not "limited"
    assert await _counts(app) == {("library_translate", "7"): 2, ("library_ai", "*"): 2}
    with pytest.raises(ai.AiUnavailable):
        await run_translate(app, item_id, [1])
    assert await _counts(app) == {("library_translate", "7"): 2, ("library_ai", "*"): 2}


async def test_a_sentence_edited_while_the_model_works_gets_no_stale_translation(app, fake_llm):
    item_id = await make_item(app)

    async def edit():
        async with app.state.sessionmaker() as s:
            await s.execute(update(LibrarySegment).where(LibrarySegment.item_id == item_id, LibrarySegment.idx == 1)
                            .values(text="How do you do?"))
            await s.commit()

    fake_llm("1. 一\n2. 二", before=edit)
    done, _ = await run_translate(app, item_id, [0, 1])
    assert done == {0: "一"}
    assert [row[1] for row in await stored(app, item_id)][:2] == ["一", None]


async def test_analysis_is_generated_once_per_language(app, fake_llm):
    item_id = await make_item(app)
    llm_ = fake_llm("### Sentence Structure\nA greeting. " + "x" * 5000, "### 文\n日本語")
    text, cached = await run_analysis(app, item_id, 0)
    assert cached is False and text.startswith("### Sentence Structure") and len(text) == limits.ANALYSIS_MAX
    call = llm_.calls[0]
    assert call["max_tokens"] == ai.ANALYZE_MAX_TOKENS and call["messages"][1]["content"] == TEXTS[0]
    assert await run_analysis(app, item_id, 0) == (text, True) and len(llm_.calls) == 1
    other, cached = await run_analysis(app, item_id, 0, language="ja-JP")
    assert (other, cached) == ("### 文\n日本語", False)
    assert (await stored(app, item_id))[0][3:] == ("### 文\n日本語", "ja-JP")
    assert await _counts(app) == {("library_analysis", "7"): 2, ("library_ai", "*"): 2}


async def test_analysis_caps_and_failures(app, fake_llm):
    item_id = await make_item(app)
    fake_llm(llm.LlmUnavailable("network"), "ok")
    with pytest.raises(ai.AiUnavailable) as caught:
        await run_analysis(app, item_id, 0)
    assert caught.value.kind == "upstream" and await _counts(app) == {("library_analysis", "7"): 0, ("library_ai", "*"): 0}
    assert (await run_analysis(app, item_id, 0, library_analysis_daily_per_user=1))[1] is False
    with pytest.raises(ai.AiUnavailable) as caught:
        await run_analysis(app, item_id, 1, library_analysis_daily_per_user=1)
    assert caught.value.kind == "user_cap"
    with pytest.raises(ai.AiUnavailable) as caught:
        await run_analysis(app, item_id, 1, library_ai_daily_global=1)
    assert caught.value.kind == "global_cap"
    assert await _counts(app) == {("library_analysis", "7"): 1, ("library_ai", "*"): 1}


# ---- the admin console edits these prompts like the others ----

@pytest.mark.parametrize("settings_overrides", [ADMIN_ENABLED], indirect=True)
async def test_admin_sees_the_defaults_and_can_test_run_both_prompts(app, client, respx_mock, settings_overrides):
    su = await login_as(app, client, "superadmin")
    assert (await client.post("/api/admin/step-up", headers=su, json={"password": PASSWORD})).status_code == 200
    translate = (await client.get("/api/admin/prompts/library.translate", headers=su)).json()
    assert translate["default_body"] == ai.DEFAULT_TRANSLATE_TEMPLATE and translate["published"] is None
    assert translate["spec"]["boundaries"] == ["<text>", "</text>"]
    assert translate["spec"]["required"] == ["native_language", "text"]
    analyze = (await client.get("/api/admin/prompts/library.analyze", headers=su)).json()
    assert analyze["default_body"] == ai.DEFAULT_ANALYZE_TEMPLATE and analyze["spec"]["boundaries"] == []
    route = respx_mock.post(LLM).respond(200, json={"choices": [{"message": {"content": "OK"}}]})
    r = await client.post("/api/admin/prompts/library.translate/test", headers=su, json={
        "body": ai.DEFAULT_TRANSLATE_TEMPLATE, "sample": {"native_language": "ja-JP", "text": "Good </text> morning."}})
    assert r.status_code == 200, r.text
    sent = json.loads(route.calls.last.request.content)
    assert sent["model"] == app.state.settings.default_llm_model and sent["messages"][0]["content"] == ai.TRANSLATE_SYSTEM
    assert "Japanese" in sent["messages"][1]["content"] and "1. Good ‹/text› morning." in sent["messages"][1]["content"]
    r = await client.post("/api/admin/prompts/library.analyze/test", headers=su, json={
        "body": ai.DEFAULT_ANALYZE_TEMPLATE, "sample": {"native_language": "zh-CN", "text": "Good morning."}})
    assert r.status_code == 200, r.text
    sent = json.loads(route.calls.last.request.content)
    assert sent["messages"][1] == {"role": "user", "content": "Good morning."}
    r = await client.post("/api/admin/prompts/library.translate/test", headers=su, json={"body": "{text}", "sample": {}})
    assert r.status_code == 422  # a body without the boundary tags cannot be run (or published)
````

Edit `server/tests/test_prompts.py` —— old_string:

````python
    assert set(PROMPTS) == {"grammar.rules", "rooms.assist", "rooms.voice_translate", "rooms.summary",
                            "wordbook.explain", "config.chat_agent_templates"}
````

new_string:

````python
    assert set(PROMPTS) == {"grammar.rules", "rooms.assist", "rooms.voice_translate", "rooms.summary",
                            "wordbook.explain", "library.translate", "library.analyze",
                            "config.chat_agent_templates"}
````

Edit `server/tests/test_prompts_api.py` —— old_string:

````python
    assert [i["key"] for i in items] == ["grammar.rules", "rooms.assist", "rooms.voice_translate",
                                         "rooms.summary", "wordbook.explain", "config.chat_agent_templates"]
````

new_string:

````python
    assert [i["key"] for i in items] == ["grammar.rules", "rooms.assist", "rooms.voice_translate",
                                         "rooms.summary", "wordbook.explain", "library.translate",
                                         "library.analyze", "config.chat_agent_templates"]
````

- [ ] **Step 2: 运行确认失败** — `cd server && uv run pytest -q tests/test_library_ai.py tests/test_prompts.py tests/test_prompts_api.py` → `ImportError: cannot import name 'ai' from 'app.library'`(`test_library_ai.py` 收集失败);`test_prompts.py` / `test_prompts_api.py` 的两条枚举断言失败(键还没注册)。

- [ ] **Step 3: 实现**

Edit `server/app/library/limits.py` —— old_string:

````python
ACTIVE = ("uploading", "queued", "processing")
````

new_string:

````python
ACTIVE = ("uploading", "queued", "processing")
AI_BATCH_MAX = 20  # sentences per translate request (spec E12)
TRANSLATION_MAX = 1200  # stored translation length (spec §4)
ANALYSIS_MAX = 4000  # stored analysis length (spec §4)
````

Edit `server/app/library/limits.py` —— old_string:

````python
SCOPE_ASR = "library_asr"
GLOBAL = "*"
````

new_string:

````python
SCOPE_ASR = "library_asr"
SCOPE_TRANSLATE = "library_translate"  # D8: sentences translated today (subject = user id)
SCOPE_ANALYSIS = "library_analysis"  # D8: sentence analyses today (subject = user id)
SCOPE_AI_GLOBAL = "library_ai"  # D8: both kinds together, in sentences (subject = "*")
GLOBAL = "*"
````

Edit `server/app/library/limits.py` —— old_string:

````python
async def refund_new_item(session: AsyncSession, app, user_id: int) -> None:
    await usage.refund(session, SCOPE_IMPORTS, str(user_id), day_of(datetime.now(timezone.utc)))
````

new_string:

````python
async def refund_new_item(session: AsyncSession, app, user_id: int) -> None:
    await usage.refund(session, SCOPE_IMPORTS, str(user_id), day_of(datetime.now(timezone.utc)))


async def reserve_upto(session: AsyncSession, scope: str, subject: str, day: str, want: int, limit: int) -> int:
    """Take up to `want` of today's `limit`: all of it, else what is left, else 0 (commits)."""
    if want <= 0 or limit <= 0:
        return 0
    if await reserve(session, scope, subject, day, want, limit):
        return want
    for _ in range(2):  # a concurrent request may take the rest between the read and the update
        take = min(want, await usage.remaining(session, scope, subject, day, limit))
        if take <= 0:
            return 0
        if await reserve(session, scope, subject, day, take, limit):
            return take
    return 0


async def reserve_ai(session: AsyncSession, user_id: int, scope: str, user_limit: int, global_limit: int, want: int,
                     day: str) -> tuple[int, str | None]:
    """D8: spend up to `want` sentences of the user's daily allowance for `scope` (translate or analysis) and of the
    site-wide one. Returns (granted, shortfall): `shortfall` is None when all `want` were granted, else which cap
    stopped it, "user" or "global". Whatever the site-wide cap refused is given back to the user's counter."""
    mine = await reserve_upto(session, scope, str(user_id), day, want, user_limit)
    if mine == 0:
        return 0, "user"
    both = await reserve_upto(session, SCOPE_AI_GLOBAL, GLOBAL, day, mine, global_limit)
    if both < mine:
        await release(session, scope, str(user_id), day, mine - both)
    if both >= want:
        return both, None
    return both, "global" if both < mine else "user"


async def refund_ai(session: AsyncSession, user_id: int, scope: str, amount: int, day: str) -> None:
    """Give back sentences that were reserved but not produced (upstream failure or a short reply)."""
    await release(session, scope, str(user_id), day, amount)
    await release(session, SCOPE_AI_GLOBAL, GLOBAL, day, amount)
````

Edit `server/app/library/store.py` —— old_string:

````python
async def delete_item_rows(session: AsyncSession, item_id: str) -> None:
````

new_string:

````python
async def segments_at(session: AsyncSession, item_id: str, indices: list[int]) -> list[LibrarySegment]:
    """The sentences with these indices (unknown ones are simply absent), in index order."""
    if not indices:
        return []
    return list((await session.scalars(select(LibrarySegment).where(
        LibrarySegment.item_id == item_id, LibrarySegment.idx.in_(indices)).order_by(LibrarySegment.idx))).all())


def clear_ai(seg: LibrarySegment) -> None:
    """Spec E11: a sentence whose text changed keeps no translation or analysis (caller commits)."""
    seg.zh = seg.zh_lang = seg.analysis = seg.analysis_lang = None


async def set_translations(session: AsyncSession, item_id: str, entries: list[tuple[int, str, str]],
                           language: str) -> set[int]:
    """Store translations (commits). Each entry is (idx, the text the translation was made for, zh): a sentence edited
    while the model was working no longer matches and is skipped, so a stale translation never lands on new text.
    Returns the indices that were stored."""
    stored = set()
    for idx, text, zh in entries:
        result = await session.execute(update(LibrarySegment).where(
            LibrarySegment.item_id == item_id, LibrarySegment.idx == idx, LibrarySegment.text == text)
            .values(zh=zh, zh_lang=language))
        if result.rowcount == 1:
            stored.add(idx)
    await session.commit()
    return stored


async def set_analysis(session: AsyncSession, item_id: str, idx: int, text: str, analysis: str,
                       language: str) -> bool:
    """Store one analysis (commits) under the same stale-text guard as `set_translations`."""
    result = await session.execute(update(LibrarySegment).where(
        LibrarySegment.item_id == item_id, LibrarySegment.idx == idx, LibrarySegment.text == text)
        .values(analysis=analysis, analysis_lang=language))
    await session.commit()
    return result.rowcount == 1


async def delete_item_rows(session: AsyncSession, item_id: str) -> None:
````

Edit `server/app/services/prompts.py` —— old_string:

````python
        ("<word>", "</word>"), 4000, sample_fields=("word", "meanings", "example")),
    "config.chat_agent_templates":
````

new_string:

````python
        ("<word>", "</word>"), 4000, sample_fields=("word", "meanings", "example")),
    # 跟读库的句子译文与分析(spec 2026-10-13-video-import D8 / E11);默认值在 app/library/ai.py,取自桌面端 enjoy 的原文
    "library.translate": PromptSpec(
        "library.translate", "跟读库句子译文", "text", frozenset({"native_language", "text"}), ("<text>", "</text>"),
        4000, sample_fields=("native_language", "text")),
    "library.analyze": PromptSpec(
        "library.analyze", "跟读库句子分析", "text", frozenset({"native_language", "learning_language"}), (), 4000,
        sample_fields=("native_language", "text")),
    "config.chat_agent_templates":
````

Edit `server/app/admin/prompts_admin.py` —— old_string:

````python
from app.core.runtime_settings import bump_revision
from app.models import PromptVersion, iso_utc
````

new_string:

````python
from app.core.runtime_settings import bump_revision
from app.library import ai as library_ai
from app.models import PromptVersion, iso_utc
````

Edit `server/app/admin/prompts_admin.py` —— old_string:

````python
    if key == "wordbook.explain":
        return wordbook_explain.DEFAULT_EXPLAIN_TEMPLATE
    return TEMPLATES_FILE
````

new_string:

````python
    if key == "wordbook.explain":
        return wordbook_explain.DEFAULT_EXPLAIN_TEMPLATE
    if key in library_ai.DEFAULTS:
        return library_ai.DEFAULTS[key]
    return TEMPLATES_FILE
````

Edit `server/app/admin/prompts_admin.py` —— old_string:

````python
                settings)
    # same rendering as the live room socket
````

new_string:

````python
                settings)
    if key in library_ai.KEYS:  # same rendering as the live library endpoints (escaping, numbering; spec D8)
        return (library_ai.render_test(key, grammar.clean_prompt(body), sample), settings.default_llm_model,
                settings)
    # same rendering as the live room socket
````

Write `server/app/library/ai.py`:

````python
"""句子译文与 AI 分析(spec 2026-10-13-video-import D8、E11、E12):批量译文、单句分析、按句计的额度、提示词渲染。

- 译文 `translate`:一次最多 20 句,一次大模型调用;已存且语言一致的直接用,其余按额度生成后写回句子行。
  额度不够时先生成能生成的,其余缺着并带 `limited`;上游失败或模型漏答的句子,额度退还。
- 分析 `analyze`:一次一句,只在用户点「分析」时调用;已存且语言一致的直接返回(`cached`),不计额度。
- 大模型只经 `providers/llm.complete`;提示词按桌面端 `enjoy/src/shared/commands/{translate,analyze}.command.ts` 的原文,
  管理端可编辑(`library.translate` / `library.analyze`,注册在 `services/prompts.py`;没有发布版本时用本文件的默认值)。
- 日志只有条目 id、失败种类与句数;句子、译文、分析、提示词正文永不进日志。计量记在 feature `lib_translate` /
  `lib_analysis`(`llm.complete` 自己 `metering.record` 成功与失败;feature 列只有 16 个字符,所以不叫 `library_translate`)。
"""
import logging
import re
from datetime import datetime

from app.core import metering
from app.library import limits, store
from app.models import LibrarySegment
from app.providers import llm

logger = logging.getLogger(__name__)

# 母语白名单(桌面端 `languages.json` 的 12 个码)→ 提示词里的语言名(英文名,避免母语文字名带来歧义)
LANGS: dict[str, str] = {
    "en-US": "English (United States)", "en-GB": "English (United Kingdom)", "zh-CN": "Simplified Chinese",
    "zh-HK": "Cantonese (Traditional Chinese)", "ja-JP": "Japanese", "ko-KR": "Korean", "es-ES": "Spanish",
    "it-IT": "Italian", "de-DE": "German", "fr-FR": "French", "th-TH": "Thai", "vi-VN": "Vietnamese",
}
LEARNING_LANGUAGE = "English"
KEYS = ("library.translate", "library.analyze")
FEATURE_TRANSLATE, FEATURE_ANALYSIS = "lib_translate", "lib_analysis"  # metering features (upstream_calls.feature is 16 chars)
TRANSLATE_TEMPERATURE = 0.2
ANALYZE_TEMPERATURE = 0.3
ANALYZE_MAX_TOKENS = 1500
TRANSLATE_TOKENS_BASE, TRANSLATE_TOKENS_PER_SENTENCE, TRANSLATE_TOKENS_CAP = 200, 120, 3000

TRANSLATE_SYSTEM = "You are a professional, authentic translation engine, only returns translations."
# enjoy 的 TRANSLATION_PROMPT 原句 + 批量格式的一句说明(模板里 {text} 是带编号的句子列表,边界标签防止句子伪造指令)
DEFAULT_TRANSLATE_TEMPLATE = (
    "Translate the text to {native_language} Language, please do not explain my original text. "
    "The text is a numbered list with one sentence per line, written as \"N. sentence\". "
    "Reply with exactly one line per sentence in the same \"N. translation\" format and nothing else:\n\n"
    "<text>\n{text}\n</text>")
# enjoy 的分析系统提示词原文(analyze.command.ts 的 SYSTEM_PROMPT);用户消息就是那一句
DEFAULT_ANALYZE_TEMPLATE = (
    "I speak {native_language}. You're my {learning_language} coach, I'll provide {learning_language} text, you'll "
    "help me analyze the sentence structure, grammar, and vocabulary/phrases, and provide a detailed explanation of "
    "the text. Please return the results in the following format(but in {native_language}):\n\n"
    "### Sentence Structure\n(Explain each element of the sentence)\n\n"
    "### Grammar\n(Explain the grammar of the sentence)\n\n"
    "### Vocabulary/Phrases\n(Explain the key vocabulary and phrases used)")
DEFAULTS = {"library.translate": DEFAULT_TRANSLATE_TEMPLATE, "library.analyze": DEFAULT_ANALYZE_TEMPLATE}
_LINE = re.compile(r"^\s*(\d{1,3})\s*[.、)）:：]\s*(\S.*?)\s*$")


class AiUnavailable(Exception):
    """kind ∈ user_cap | global_cap | upstream。开关与未配置由路由在入口处按 `library_ai_available` 拒绝(404)。"""

    def __init__(self, kind: str):
        super().__init__(kind)
        self.kind = kind


def _plain(text: str, limit: int = limits.SEGMENT_TEXT_MAX) -> str:
    """压成一行、截断,并把尖括号换成形近字符:句子文字不能伪造 `<text>` 边界。"""
    return " ".join(text.replace("<", "‹").replace(">", "›").split())[:limit]


def _format(template: str | None, default: str, **values: str) -> str:
    try:
        return (template or default).format(**values)
    except (KeyError, IndexError, ValueError):  # 发布时已校验;万一坏了回落默认,不记模板正文
        logger.warning("library ai template invalid, using default")
        return default.format(**values)


def render_translate(template: str | None, language: str, sentences: list[str]) -> list[dict]:
    numbered = "\n".join(f"{n}. {_plain(s)}" for n, s in enumerate(sentences, 1))
    body = _format(template, DEFAULT_TRANSLATE_TEMPLATE, native_language=LANGS[language], text=numbered)
    return [{"role": "system", "content": TRANSLATE_SYSTEM}, {"role": "user", "content": body}]


def render_analysis(template: str | None, language: str, sentence: str) -> list[dict]:
    system = _format(template, DEFAULT_ANALYZE_TEMPLATE, native_language=LANGS[language],
                     learning_language=LEARNING_LANGUAGE)
    return [{"role": "system", "content": system}, {"role": "user", "content": _plain(sentence)}]


def render_test(key: str, template: str, sample: dict[str, str]) -> list[dict]:
    """管理端「试运行」:用样例句子与母语码渲染,与线上同一路径(转义、编号)。"""
    code = sample.get("native_language", "").strip()
    language = code if code in LANGS else "zh-CN"
    text = sample.get("text", "").strip() or "I have been learning English for two years."
    if key == "library.translate":
        return render_translate(template, language, [text])
    return render_analysis(template, language, text)


def parse_translations(raw: str, count: int) -> dict[int, str]:
    """`N. translation` 行 → {N: 译文}(N 从 1 起,只收 1..count,同号取第一次)。没有编号的行一律不要:模型的拒绝语、
    前言、代码围栏都不会被当成译文存下来(漏答的句子额度退还,下次再试)。"""
    found: dict[int, str] = {}
    for line in raw.splitlines():
        match = _LINE.match(line)
        if match and 1 <= int(match.group(1)) <= count and int(match.group(1)) not in found:
            found[int(match.group(1))] = match.group(2)[:limits.TRANSLATION_MAX]
    return found


async def translate(session, http, settings, *, user_id: int, item_id: str, segments: list[LibrarySegment],
                    language: str, template: str | None, now: datetime) -> tuple[dict[int, str], bool]:
    """({idx: zh} for every requested sentence that has a translation in `language` afterwards, limited).
    `limited` = the daily allowance stopped some sentences. Raises AiUnavailable("upstream") when the model gave
    nothing usable (the reserved sentences are given back first)."""
    rows = [(s.idx, s.text, s.zh, s.zh_lang) for s in segments]  # plain values: the commits below must not matter
    out = {idx: zh for idx, _text, zh, lang in rows if zh and lang == language}
    todo = [(idx, text) for idx, text, zh, lang in rows if not (zh and lang == language)]
    if not todo:
        return out, False
    day = limits.day_of(now)
    granted, _why = await limits.reserve_ai(session, user_id, limits.SCOPE_TRANSLATE,
                                            settings.library_translate_daily_per_user,
                                            settings.library_ai_daily_global, len(todo), day)
    if granted == 0:
        return out, True
    batch = todo[:granted]
    max_tokens = min(TRANSLATE_TOKENS_CAP, TRANSLATE_TOKENS_BASE + TRANSLATE_TOKENS_PER_SENTENCE * len(batch))
    try:
        with metering.feature_scope(FEATURE_TRANSLATE):
            raw = await llm.complete(http, settings, render_translate(template, language, [t for _i, t in batch]),
                                     model=settings.default_llm_model, max_tokens=max_tokens,
                                     temperature=TRANSLATE_TEMPERATURE)
    except llm.LlmUnavailable as e:
        await limits.refund_ai(session, user_id, limits.SCOPE_TRANSLATE, granted, day)
        logger.warning("library translate unavailable item=%s kind=%s count=%d", item_id, e.kind, len(batch))
        raise AiUnavailable("upstream") from None
    parsed = parse_translations(raw, len(batch))
    if len(parsed) < granted:
        await limits.refund_ai(session, user_id, limits.SCOPE_TRANSLATE, granted - len(parsed), day)
    if not parsed:
        logger.warning("library translate empty item=%s count=%d", item_id, len(batch))
        raise AiUnavailable("upstream")
    entries = [(batch[n - 1][0], batch[n - 1][1], zh) for n, zh in sorted(parsed.items())]
    stored = await store.set_translations(session, item_id, entries, language)
    out.update({idx: zh for idx, _text, zh in entries if idx in stored})
    return out, granted < len(todo)


async def analyze(session, http, settings, *, user_id: int, item_id: str, segment: LibrarySegment, language: str,
                  template: str | None, now: datetime) -> tuple[str, bool]:
    """(analysis, cached). A stored analysis in the same language is free; otherwise one sentence of the daily
    allowance is reserved first (AiUnavailable user_cap / global_cap) and given back if the model fails."""
    idx, text, stored, stored_lang = segment.idx, segment.text, segment.analysis, segment.analysis_lang
    if stored and stored_lang == language:
        return stored, True
    day = limits.day_of(now)
    granted, why = await limits.reserve_ai(session, user_id, limits.SCOPE_ANALYSIS,
                                           settings.library_analysis_daily_per_user,
                                           settings.library_ai_daily_global, 1, day)
    if granted == 0:
        raise AiUnavailable("global_cap" if why == "global" else "user_cap")
    try:
        with metering.feature_scope(FEATURE_ANALYSIS):
            raw = await llm.complete(http, settings, render_analysis(template, language, text),
                                     model=settings.default_llm_model, max_tokens=ANALYZE_MAX_TOKENS,
                                     temperature=ANALYZE_TEMPERATURE)
    except llm.LlmUnavailable as e:
        await limits.refund_ai(session, user_id, limits.SCOPE_ANALYSIS, 1, day)
        logger.warning("library analysis unavailable item=%s kind=%s", item_id, e.kind)
        raise AiUnavailable("upstream") from None
    body = raw.strip()[:limits.ANALYSIS_MAX]
    await store.set_analysis(session, item_id, idx, text, body, language)
    return body, False
````

- [ ] **Step 4: 运行通过** — `cd server && uv run pytest -q tests/test_library_ai.py tests/test_prompts.py tests/test_prompts_api.py tests/test_architecture.py tests/test_library_store.py tests/test_library_basics.py` → 全绿(`test_default_prompts_follow_the_desktop_commands` 读 `enjoy/` 源码核对默认提示词,仓库里有 `enjoy/` 就会跑;没有就跳过)。

- [ ] **Step 5: 提交**

```bash
git add server/tests/test_library_ai.py server/tests/test_prompts.py server/tests/test_prompts_api.py server/app/library/ai.py server/app/library/limits.py server/app/library/store.py server/app/services/prompts.py server/app/admin/prompts_admin.py
git commit -m "feat(server): library sentence translation and analysis core with editable prompts" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 11b: D8 译文与分析的接口、改字清空与 `config.ai`

**Files:**
- Create: `server/tests/test_library_ai_api.py`
- Modify: `server/app/routers/library.py`

**Interfaces(Produces):** `POST /api/library/items/{id}/translate`、`POST /api/library/items/{id}/segments/{idx}/analysis`(形状冻结在 R-SC35 与「对外接口」W2 段);`PATCH …/segments/{idx}` 改字清 `zh` / `analysis`;`GET config` 的 `ai`(T11 已加)。依赖:T11(路由与 `owned` / `fail` / `require_library`)、T11a。

- [ ] **Step 1: 写失败测试**

Write `server/tests/test_library_ai_api.py`:

````python
"""每句译文与单句分析的接口(spec D8 / E11 / E12 / §9):开关、白名单语言、批量与额度、存进句子行、改字清空、
已发布的提示词;大模型用 respx 假上游(真实的 `providers/llm.complete` 路径,含计量)。"""
import json
import logging

import httpx
import pytest
import respx
from sqlalchemy import select

from app.core.metering import METER
from app.library import ai
from app.models import DailyUsage, PromptVersion
from tests.library_helpers import SRT, enable, fake_media, library_settings, process, upload, use_fakes

LLM = "https://llm.test/v1/chat/completions"
ZH = "1. 你好,我的朋友。\n2. 你今天好吗?"


@pytest.fixture
def settings_overrides(request, tmp_path):
    return library_settings(tmp_path, **{"library_ai_enabled": True, **getattr(request, "param", {})})


@pytest.fixture(autouse=True)
def _tools(monkeypatch):
    enable(monkeypatch)
    METER.drain()
    yield
    METER.drain()


def reply(text: str = ZH) -> httpx.Response:
    return httpx.Response(200, json={"choices": [{"message": {"content": text}}],
                                     "usage": {"prompt_tokens": 40, "completion_tokens": 30}})


async def ready_item(app, client, headers) -> str:
    use_fakes(app)
    item_id = await upload(client, headers, fake_media(), subs=SRT)
    await process(app)
    return item_id


async def counts(app) -> dict[str, int]:
    async with app.state.sessionmaker() as s:  # only the AI counters (an upload also counts as an import)
        return {f"{r.scope}:{r.subject}": r.count for r in (await s.scalars(select(DailyUsage))).all()
                if r.scope in ("library_translate", "library_analysis", "library_ai")}


async def detail(client, headers, item_id) -> list[dict]:
    return (await client.get(f"/api/library/items/{item_id}", headers=headers)).json()["segments"]


def translate_url(item_id: str) -> str:
    return f"/api/library/items/{item_id}/translate"


def analysis_url(item_id: str, idx: int = 0) -> str:
    return f"/api/library/items/{item_id}/segments/{idx}/analysis"


@pytest.mark.parametrize("settings_overrides", [{"library_ai_enabled": False}, {"upstream_llm_base_url": ""}],
                         indirect=True, ids=["switch-off", "no-llm"])
async def test_switch_off_or_no_llm_means_404_and_config_says_so(app, client, auth_headers, settings_overrides):
    item_id = await ready_item(app, client, auth_headers)
    assert (await client.get("/api/library/config", headers=auth_headers)).json()["ai"] is False
    for url, body in ((translate_url(item_id), {"indices": [0], "native_language": "zh-CN"}),
                      (analysis_url(item_id), {"native_language": "zh-CN"})):
        r = await client.post(url, headers=auth_headers, json=body)
        assert (r.status_code, r.json()) == (404, {"error": "AI is disabled"})


async def test_everything_needs_a_login(client):
    item = "0f0e0d0c-0b0a-4908-8706-050403020100"
    assert (await client.post(translate_url(item), json={})).status_code == 401
    assert (await client.post(analysis_url(item), json={})).status_code == 401


@pytest.mark.parametrize("settings_overrides", [{"library_enabled": False}], indirect=True)
async def test_the_library_switch_closes_both_endpoints_first(client, auth_headers, settings_overrides):
    item = "0f0e0d0c-0b0a-4908-8706-050403020100"
    for url, body in ((translate_url(item), {"indices": [0], "native_language": "zh-CN"}),
                      (analysis_url(item), {"native_language": "zh-CN"})):
        r = await client.post(url, headers=auth_headers, json=body)
        assert (r.status_code, r.json()) == (404, {"error": "Library is disabled"})


@pytest.mark.parametrize("body, status, error", [
    ({"indices": [0], "native_language": "tlh"}, 400, "Unsupported language"),
    ({"indices": [], "native_language": "zh-CN"}, 422, None),
    ({"indices": list(range(21)), "native_language": "zh-CN"}, 422, None),
    ({"indices": [-1], "native_language": "zh-CN"}, 422, None),
    ({"indices": [0]}, 422, None),
    ({"indices": [0], "native_language": "zh-CN", "extra": 1}, 422, None),
], ids=["language", "empty", "too-many", "negative", "no-language", "extra-key"])
async def test_translate_validation(app, client, auth_headers, body, status, error):
    item_id = await ready_item(app, client, auth_headers)
    r = await client.post(translate_url(item_id), headers=auth_headers, json=body)
    assert r.status_code == status
    if error:
        assert r.json() == {"error": error}


@respx.mock
async def test_translate_batches_stores_and_serves_the_second_request_from_the_rows(app, client, auth_headers, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    route = respx.post(LLM).mock(return_value=reply())
    item_id = await ready_item(app, client, auth_headers)
    body = {"indices": [1, 0, 1], "native_language": "zh-CN"}
    r = await client.post(translate_url(item_id), headers=auth_headers, json=body)
    assert r.json() == {"segments": [{"idx": 0, "zh": "你好,我的朋友。"}, {"idx": 1, "zh": "你今天好吗?"}], "limited": False}
    sent = json.loads(route.calls[0].request.content)
    assert sent["model"] == "gpt-4o" and sent["messages"][0]["content"] == ai.TRANSLATE_SYSTEM
    prompt = sent["messages"][1]["content"]
    assert "Simplified Chinese" in prompt and "<text>\n1. Hello there, my friend.\n2. How are you doing today?\n</text>" in prompt
    segs = await detail(client, auth_headers, item_id)
    assert [(s["zh"], s["zh_lang"], s["has_analysis"]) for s in segs] == [
        ("你好,我的朋友。", "zh-CN", False), ("你今天好吗?", "zh-CN", False)]
    again = await client.post(translate_url(item_id), headers=auth_headers, json={"indices": [0], "native_language": "zh-CN"})
    assert again.json() == {"segments": [{"idx": 0, "zh": "你好,我的朋友。"}], "limited": False}
    assert route.call_count == 1  # stored translations cost nothing more
    spent = await counts(app)  # two sentences, counted once for the user and once site-wide
    assert sorted(spent.values()) == [2, 2] and {k.split(":")[0] for k in spent} == {"library_translate", "library_ai"}
    rows = METER.drain()
    assert [(m.feature, m.kind, m.status) for m in rows] == [("lib_translate", "llm", 200)]
    assert "你好" not in caplog.text and "Hello there" not in caplog.text


@respx.mock
async def test_unknown_indices_are_skipped_and_only_ready_items_translate(app, client, auth_headers):
    respx.post(LLM).mock(return_value=reply("1. 你好,我的朋友。"))
    item_id = await ready_item(app, client, auth_headers)
    r = await client.post(translate_url(item_id), headers=auth_headers, json={"indices": [0, 99], "native_language": "zh-CN"})
    assert r.json()["segments"] == [{"idx": 0, "zh": "你好,我的朋友。"}]
    uploading = await upload(client, auth_headers, fake_media(), complete=False)
    r = await client.post(translate_url(uploading), headers=auth_headers, json={"indices": [0], "native_language": "zh-CN"})
    assert (r.status_code, r.json()) == (409, {"error": "Item is not ready"})
    other = await client.post("/api/users", json={"username": "bob", "password": "password123"})
    bob = {"Authorization": f"Bearer {other.json()['access_token']}"}
    r = await client.post(translate_url(item_id), headers=bob, json={"indices": [0], "native_language": "zh-CN"})
    assert r.status_code == 404  # someone else's item


@respx.mock
@pytest.mark.parametrize("settings_overrides", [{"library_translate_daily_per_user": 1}], indirect=True)
async def test_the_daily_allowance_limits_a_batch_and_says_so(app, client, auth_headers, settings_overrides):
    route = respx.post(LLM).mock(return_value=reply("1. 你好,我的朋友。"))
    item_id = await ready_item(app, client, auth_headers)
    body = {"indices": [0, 1], "native_language": "zh-CN"}
    r = await client.post(translate_url(item_id), headers=auth_headers, json=body)
    assert r.json() == {"segments": [{"idx": 0, "zh": "你好,我的朋友。"}], "limited": True}
    r = await client.post(translate_url(item_id), headers=auth_headers, json=body)
    assert r.status_code == 200 and r.json()["limited"] is True and len(r.json()["segments"]) == 1
    assert route.call_count == 1  # the second request had nothing it could afford: no call, the stored one comes back


@respx.mock
async def test_an_upstream_failure_is_503_and_gives_the_allowance_back(app, client, auth_headers):
    respx.post(LLM).mock(return_value=httpx.Response(502, json={"error": "SECRET-UPSTREAM"}))
    item_id = await ready_item(app, client, auth_headers)
    r = await client.post(translate_url(item_id), headers=auth_headers, json={"indices": [0, 1], "native_language": "zh-CN"})
    assert (r.status_code, r.json()) == (503, {"error": "AI is unavailable"})
    assert all(v == 0 for v in (await counts(app)).values())
    assert [s["zh"] for s in await detail(client, auth_headers, item_id)] == [None, None]
    rows = METER.drain()
    assert [(m.feature, m.status) for m in rows] == [("lib_translate", 502)]


@respx.mock
async def test_analysis_is_generated_on_click_stored_and_free_the_second_time(app, client, auth_headers, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    route = respx.post(LLM).mock(return_value=reply("### 句子结构\nSECRET-ANALYSIS"))
    item_id = await ready_item(app, client, auth_headers)
    r = await client.post(analysis_url(item_id, 1), headers=auth_headers, json={"native_language": "zh-CN"})
    assert r.json() == {"analysis": "### 句子结构\nSECRET-ANALYSIS", "cached": False}
    sent = json.loads(route.calls[0].request.content)
    assert sent["messages"][0]["content"].startswith("I speak Simplified Chinese. You're my English coach")
    assert sent["messages"][1] == {"role": "user", "content": "How are you doing today?"}
    r = await client.post(analysis_url(item_id, 1), headers=auth_headers, json={"native_language": "zh-CN"})
    assert r.json()["cached"] is True and route.call_count == 1
    r = await client.post(analysis_url(item_id, 1), headers=auth_headers, json={"native_language": "ja-JP"})
    assert r.json()["cached"] is False and route.call_count == 2  # another language is a new analysis
    seg = (await detail(client, auth_headers, item_id))[1]
    assert (seg["has_analysis"], seg["analysis_lang"]) == (True, "ja-JP") and "analysis" not in seg  # the text is not listed
    assert "SECRET-ANALYSIS" not in caplog.text and "How are you" not in caplog.text
    assert [(m.feature, m.kind) for m in METER.drain()] == [("lib_analysis", "llm")] * 2


@respx.mock
@pytest.mark.parametrize("settings_overrides", [{"library_analysis_daily_per_user": 1}], indirect=True)
async def test_analysis_limits_and_errors(app, client, auth_headers, settings_overrides):
    respx.post(LLM).mock(return_value=reply("### ok"))
    item_id = await ready_item(app, client, auth_headers)
    body = {"native_language": "zh-CN"}
    assert (await client.post(analysis_url(item_id, 0), headers=auth_headers, json=body)).status_code == 200
    r = await client.post(analysis_url(item_id, 1), headers=auth_headers, json=body)
    assert (r.status_code, r.json()) == (429, {"error": "Daily analysis limit reached"})
    assert (await client.post(analysis_url(item_id, 0), headers=auth_headers, json=body)).json()["cached"] is True
    r = await client.post(analysis_url(item_id, 7), headers=auth_headers, json=body)
    assert (r.status_code, r.json()) == (404, {"error": "Sentence not found"})
    r = await client.post(analysis_url(item_id, 0), headers=auth_headers, json={"native_language": "tlh"})
    assert (r.status_code, r.json()) == (400, {"error": "Unsupported language"})
    uploading = await upload(client, auth_headers, fake_media(), complete=False)
    assert (await client.post(analysis_url(uploading), headers=auth_headers, json=body)).status_code == 409


@respx.mock
@pytest.mark.parametrize("settings_overrides", [{"library_ai_daily_global": 1}], indirect=True)
async def test_the_site_wide_cap_is_its_own_message(app, client, auth_headers, settings_overrides):
    respx.post(LLM).mock(return_value=reply("1. 你好,我的朋友。"))
    item_id = await ready_item(app, client, auth_headers)
    r = await client.post(translate_url(item_id), headers=auth_headers, json={"indices": [0], "native_language": "zh-CN"})
    assert r.json()["limited"] is False
    r = await client.post(analysis_url(item_id, 1), headers=auth_headers, json={"native_language": "zh-CN"})
    assert (r.status_code, r.json()) == (429, {"error": "Daily AI limit reached"})


@respx.mock
async def test_an_analysis_upstream_failure_is_503(app, client, auth_headers):
    respx.post(LLM).mock(side_effect=httpx.ConnectError("boom"))
    item_id = await ready_item(app, client, auth_headers)
    r = await client.post(analysis_url(item_id, 0), headers=auth_headers, json={"native_language": "zh-CN"})
    assert (r.status_code, r.json()) == (503, {"error": "AI is unavailable"})
    assert all(v == 0 for v in (await counts(app)).values())


@respx.mock
async def test_editing_the_text_clears_translation_and_analysis_but_times_and_spacing_do_not(app, client, auth_headers):
    respx.post(LLM).mock(side_effect=[reply(), reply("### ok")])
    item_id = await ready_item(app, client, auth_headers)
    await client.post(translate_url(item_id), headers=auth_headers, json={"indices": [0, 1], "native_language": "zh-CN"})
    await client.post(analysis_url(item_id, 0), headers=auth_headers, json={"native_language": "zh-CN"})
    patch = f"/api/library/items/{item_id}/segments"
    await client.patch(f"{patch}/0", headers=auth_headers, json={"start_ms": 400, "text": " Hello  there, my friend. "})
    seg = (await detail(client, auth_headers, item_id))[0]
    assert (seg["zh"], seg["has_analysis"]) == ("你好,我的朋友。", True)  # only times and spacing changed
    r = await client.patch(f"{patch}/0", headers=auth_headers, json={"text": "Hello there, my dear friend."})
    assert (r.json()["segment"]["zh"], r.json()["segment"]["has_analysis"]) == (None, False)
    segs = await detail(client, auth_headers, item_id)
    assert (segs[0]["zh"], segs[0]["zh_lang"], segs[0]["analysis_lang"]) == (None, None, None)
    assert segs[1]["zh"] == "你今天好吗?"  # the neighbour keeps its translation


@respx.mock
async def test_a_published_prompt_is_used_and_a_bad_one_falls_back(app, client, auth_headers):
    route = respx.post(LLM).mock(return_value=reply("1. 一"))
    async with app.state.sessionmaker() as s:
        s.add_all([
            PromptVersion(key="library.translate", version=1, status="published", created_by="t",
                          body="Into {native_language}, tersely. <text>{text}</text>"),
            PromptVersion(key="library.analyze", version=1, status="published", created_by="t", body="Broken {oops}")])
        await s.commit()
    item_id = await ready_item(app, client, auth_headers)
    await client.post(translate_url(item_id), headers=auth_headers, json={"indices": [0], "native_language": "ja-JP"})
    sent = json.loads(route.calls[0].request.content)
    assert sent["messages"][1]["content"] == "Into Japanese, tersely. <text>1. Hello there, my friend.</text>"
    await client.post(analysis_url(item_id, 0), headers=auth_headers, json={"native_language": "ja-JP"})
    sent = json.loads(route.calls[1].request.content)
    assert sent["messages"][0]["content"].startswith("I speak Japanese. You're my English coach")  # the default again
````

- [ ] **Step 2: 运行确认失败** — `cd server && uv run pytest -q tests/test_library_ai_api.py` → 译文 / 分析的用例 404 或 405(路由不存在),`test_editing_the_text_clears_…` 失败(没清空)。

- [ ] **Step 3: 实现**

Edit `server/app/routers/library.py` —— old_string:

````python
from app.library import limits, paths, segment, store, subtitles
from app.library.errors import API_ERRORS, LibraryError, api_error, http_error
from app.library.pipeline import UPLOADED_SUBS, INPUT_PREFIX
from app.library.worker import LibraryWorker
from app.models import Assessment, LibraryItem, User, utcnow
from app.services.uploads import parse_buffered_form
````

new_string:

````python
from app.library import ai as library_ai
from app.library import limits, paths, segment, store, subtitles
from app.library.errors import API_ERRORS, LibraryError, api_error, http_error
from app.library.pipeline import UPLOADED_SUBS, INPUT_PREFIX
from app.library.worker import LibraryWorker
from app.models import Assessment, LibraryItem, User, utcnow
from app.services.prompts import prompt_cache
from app.services.uploads import parse_buffered_form
````

Edit `server/app/routers/library.py` —— old_string:

````python
            raise fail("bad_text")
        seg.text = text
````

new_string:

````python
            raise fail("bad_text")
        if not store.same_text(text, seg.text):
            store.clear_ai(seg)  # E11: a changed sentence keeps no translation or analysis
        seg.text = text
````

Edit `server/app/routers/library.py` —— old_string:

````python
    return {"segment": store.segment_out(seg)}


# ---- media (spec §10) ----
````

new_string:

````python
    return {"segment": store.segment_out(seg)}


# ---- translations and analysis (D8 / E11 / E12) ----

def require_ai(settings: Settings = Depends(require_library)) -> Settings:
    """译文与分析需要 `library_ai_available`(子开关开且大模型已配置),否则 404,与 `config.ai: false` 一致。"""
    if not settings.library_ai_available:
        raise fail("ai_disabled")
    return settings


def language_of(code: str) -> str:
    if code not in library_ai.LANGS:
        raise fail("language")
    return code


class TranslateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    indices: list[Annotated[int, Field(ge=0, le=1_000_000)]] = Field(min_length=1, max_length=limits.AI_BATCH_MAX)
    native_language: str = Field(min_length=1, max_length=16)


@router.post("/items/{item_id}/translate")
async def translate_segments(payload: TranslateIn, request: Request, item_id: ItemId,
                             user: User = Depends(limited_user), settings: Settings = Depends(require_ai),
                             session: AsyncSession = Depends(get_session)):
    """E12:一次最多 20 句。已存且语言一致的照常返回;其余按额度批量生成并写回句子行。额度不够时能生成的先生成,
    缺的不生成并带 `limited: true`;模型失败 503。不存在的序号直接略过(网页的视野可能比刚替换的字幕旧)。"""
    language = language_of(payload.native_language)
    item = await owned(session, user, item_id)
    if item.status != "ready":
        raise fail("not_ready")
    segs = await store.segments_at(session, item.id, list(dict.fromkeys(payload.indices)))
    _, template = await prompt_cache(request.app).get("library.translate")
    try:
        done, limited = await library_ai.translate(session, request.app.state.http, settings, user_id=user.id,
                                                   item_id=item.id, segments=segs, language=language,
                                                   template=template, now=utcnow())
    except library_ai.AiUnavailable:
        raise fail("ai_unavailable") from None
    return {"segments": [{"idx": idx, "zh": done[idx]} for idx in sorted(done)], "limited": limited}


class AnalysisIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    native_language: str = Field(min_length=1, max_length=16)


@router.post("/items/{item_id}/segments/{idx}/analysis")
async def analyze_segment(payload: AnalysisIn, request: Request, item_id: ItemId,
                          idx: int = PathParam(ge=0, le=1_000_000), user: User = Depends(limited_user),
                          settings: Settings = Depends(require_ai), session: AsyncSession = Depends(get_session)):
    """只在用户点「分析」时调用;命中已存的(同语言)直接返回 `cached: true`,不计额度;额度满 429,模型失败 503。"""
    language = language_of(payload.native_language)
    item = await owned(session, user, item_id)
    if item.status != "ready":
        raise fail("not_ready")
    segs = await store.segments_at(session, item.id, [idx])
    if not segs:
        raise fail("segment_missing")
    _, template = await prompt_cache(request.app).get("library.analyze")
    try:
        text, cached = await library_ai.analyze(session, request.app.state.http, settings, user_id=user.id,
                                                item_id=item.id, segment=segs[0], language=language,
                                                template=template, now=utcnow())
    except library_ai.AiUnavailable as e:
        raise fail({"user_cap": "ai_user_cap", "global_cap": "ai_global_cap"}.get(e.kind, "ai_unavailable")) from None
    return {"analysis": text, "cached": cached}


# ---- media (spec §10) ----
````

- [ ] **Step 4: 运行通过** — `cd server && uv run pytest -q tests/test_library_ai_api.py tests/test_library_api.py tests/test_library_media_api.py tests/test_library_ai.py tests/test_architecture.py` → 全绿。

- [ ] **Step 5: 提交**

```bash
git add server/tests/test_library_ai_api.py server/app/routers/library.py
git commit -m "feat(server): library sentence translation and analysis endpoints" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 12: 删用户时删库文件

**Files:**
- Create: `server/tests/test_library_delete_user.py`
- Modify: `server/app/admin/users_admin.py`

**Interfaces(Produces):** 删用户同时删 `DATA_DIR/library/<uid>/` 与其条目的 `library/_tmp/<id>/`。

- [ ] **Step 1: 写失败测试**

Write `server/tests/test_library_delete_user.py`:

````python
"""删用户 = 删其全部库文件与行(spec §4「显式删除」、§13);别人的条目不动。"""
import pytest
from sqlalchemy import func, select

from app.library import paths
from app.models import LibraryAttempt, LibraryItem, LibrarySegment
from tests.admin_helpers import ADMIN_ENABLED, PASSWORD, login_as
from tests.library_helpers import SRT, enable, fake_media, library_settings, process, upload, use_fakes
from tests.test_admin_api import register


@pytest.fixture
def settings_overrides(tmp_path):
    return {**ADMIN_ENABLED, **library_settings(tmp_path)}


async def test_deleting_a_user_removes_their_library_rows_and_files(app, client, monkeypatch):
    enable(monkeypatch)
    use_fakes(app)
    dora, dh = await register(client, "dora")
    erin, eh = await register(client, "erin")
    mine = await upload(client, dh, fake_media(), subs=SRT)
    staged = await upload(client, dh, fake_media(), complete=False)
    theirs = await upload(client, eh, fake_media(), subs=SRT)
    await process(app)
    await process(app)
    async with app.state.sessionmaker() as s:
        s.add(LibraryAttempt(user_id=dora, item_id=mine, seg_idx=0, assessment_id=None, text_hash="0" * 16, score=1))
        await s.commit()
    data_dir = app.state.library.deps.data_dir
    assert paths.item_dir(data_dir, dora, mine).is_dir() and paths.tmp_dir(data_dir, staged).is_dir()
    h = await login_as(app, client, "superadmin")
    await client.post("/api/admin/step-up", headers=h, json={"password": PASSWORD})
    r = await client.request("DELETE", f"/api/admin/users/{dora}", headers=h,
                             json={"confirm_username": "dora", "reason": "用户要求注销"})
    assert r.status_code == 200, r.text
    async with app.state.sessionmaker() as s:
        assert await s.scalar(select(func.count()).select_from(LibraryItem).where(LibraryItem.user_id == dora)) == 0
        assert await s.scalar(select(func.count()).select_from(LibraryAttempt)) == 0
        assert await s.scalar(select(func.count()).select_from(LibrarySegment).where(
            LibrarySegment.item_id == mine)) == 0
        assert (await s.get(LibraryItem, theirs)).status == "ready"
    assert not (data_dir / "library" / str(dora)).exists() and not paths.tmp_dir(data_dir, staged).exists()
    assert paths.item_dir(data_dir, erin, theirs).is_dir()
````

- [ ] **Step 2: 运行确认失败** — `cd server && uv run pytest -q tests/test_library_delete_user.py` → `assert not (data_dir / 'library' / str(dora)).exists()` 失败(文件还在)。

- [ ] **Step 3: 实现**

Edit `server/app/admin/users_admin.py` —— old_string:

````python
from app.services import recordings
````

new_string:

````python
from app.library import paths as library_paths
from app.services import recordings
````

Edit `server/app/admin/users_admin.py` —— old_string:

````python
    # library sentences reference the user's items, not the user (spec 2026-10-13-video-import §4)
    await session.execute(delete(LibrarySegment)
````

new_string:

````python
    # library sentences reference the user's items, not the user (spec 2026-10-13-video-import §4)
    library_items = list((await session.scalars(select(LibraryItem.id).where(LibraryItem.user_id == user_id))).all())
    await session.execute(delete(LibrarySegment)
````

Edit `server/app/admin/users_admin.py` —— old_string:

````python
    await session.commit()
    _remove_recordings(settings, user_id)
````

new_string:

````python
    await session.commit()
    _remove_recordings(settings, user_id)
    library_paths.remove_user_files(settings.resolved_data_dir, user_id, library_items)  # media, posters, staging
````

- [ ] **Step 4: 运行通过** — `cd server && uv run pytest -q tests/test_library_delete_user.py tests/test_admin_users.py tests/test_architecture.py` → 全绿。

- [ ] **Step 5: 提交**

```bash
git add server/tests/test_library_delete_user.py server/app/admin/users_admin.py
git commit -m "feat(server): deleting a user removes their library files" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 13: 隐私测试与契约夹具

**Files:**
- Create: `server/tests/test_library_privacy.py`、`server/tests/test_library_contract.py`、`server/tests/fixtures/library_contract.json`

**Interfaces(Produces):** `tests/test_library_privacy.py`(新增库路由必须加进它的 `ROUTES`)、`tests/fixtures/library_contract.json`。

- [ ] **Step 1: 写失败测试**

Write `server/tests/test_library_privacy.py`:

````python
"""隐私(spec §13):跟读库的每个端点、worker 的成功 / 失败 / 重试路径、票据请求的访问日志行里,没有标题、文件名、
字幕与转写文字、上游 / 工具的错误原文、票据;路由 URL 里没有文字(路径参数只有 id 与序号,查询参数只有游标与票据)。
caplog 只收 `app` 日志(根 logger 的 DEBUG 会带上 aiosqlite 绑定的 SQL 参数,是测试环境的假象)。"""
import logging

import httpx
import pytest
import respx

from app.core.logging_setup import redact_query_secrets
from tests.library_helpers import FakeAsr, FakeTools, enable, fake_media, library_settings, process, upload, use_fakes

SECRETS = ("SECRET-TITLE", "SECRET-FILE", "SECRET-SUBTITLE", "SECRET-TRANSCRIPT", "SECRET-UPSTREAM", "SECRET-EDIT",
           "SECRET-TRANSLATION", "SECRET-ANALYSIS")  # the last two: D8 model output (translations, analyses)
LLM = "https://llm.test/v1/chat/completions"
SUBS = (b"1\n00:00:00,500 --> 00:00:03,000\nSECRET-SUBTITLE says hello there.\n\n"
        b"2\n00:00:03,200 --> 00:00:06,000\nAnd then we talk for a while.\n")
ROUTES = {
    ("GET", "/api/library/config"), ("POST", "/api/library/uploads"), ("GET", "/api/library/uploads/{item_id}"),
    ("PUT", "/api/library/uploads/{item_id}/chunks/{n}"), ("PUT", "/api/library/uploads/{item_id}/subtitles"),
    ("POST", "/api/library/uploads/{item_id}/complete"), ("GET", "/api/library/items"),
    ("GET", "/api/library/items/{item_id}"), ("PATCH", "/api/library/items/{item_id}"),
    ("DELETE", "/api/library/items/{item_id}"), ("POST", "/api/library/items/{item_id}/retry"),
    ("POST", "/api/library/items/{item_id}/cancel"), ("PUT", "/api/library/items/{item_id}/subtitles"),
    ("PATCH", "/api/library/items/{item_id}/segments/{idx}"), ("POST", "/api/library/items/{item_id}/media-ticket"),
    ("POST", "/api/library/items/{item_id}/translate"), ("POST", "/api/library/items/{item_id}/segments/{idx}/analysis"),
    ("GET", "/api/library/items/{item_id}/media"), ("HEAD", "/api/library/items/{item_id}/media"),
    ("GET", "/api/library/items/{item_id}/poster"), ("POST", "/api/library/items/{item_id}/attempts"),
    ("GET", "/api/library/items/{item_id}/attempts"),
}
LATER = {("POST", "/api/library/imports")}  # plan S2 (server-import); its own privacy test covers the body
ALLOWED_PATH = {"item_id", "n", "idx"}
ALLOWED_QUERY = {"cursor", "ticket"}


@pytest.fixture
def settings_overrides(tmp_path):
    return library_settings(tmp_path, library_asr_enabled=True, library_ai_enabled=True)


def leaked(caplog, extra: tuple[str, ...] = ()) -> list[str]:
    found = []
    for record in caplog.records:
        text = f"{record.getMessage()} {record.args!r} {record.exc_text or ''}".lower()
        found += [s for s in (*SECRETS, *extra) if s.lower() in text]
    return found


async def test_logs_never_carry_titles_names_texts_upstream_text_or_tickets(app, client, auth_headers, caplog,
                                                                             monkeypatch):
    caplog.set_level(logging.DEBUG, logger="app")
    enable(monkeypatch)
    use_fakes(app, asr=FakeAsr([RuntimeError("SECRET-UPSTREAM")] * 3 + ["SECRET-TRANSCRIPT is spoken here today."]))
    ok = await upload(client, auth_headers, fake_media(), filename="SECRET-FILE.mp4", title="SECRET-TITLE", subs=SUBS)
    asr = await upload(client, auth_headers, fake_media(4000, video=False), filename="SECRET-FILE.m4a")
    await process(app)
    await process(app)  # the transcription fails three times -> queued with backoff (upstream)
    from app.models import LibraryItem
    async with app.state.sessionmaker() as s:
        row = await s.get(LibraryItem, asr)
        row.next_run_at = None
        await s.commit()
    await process(app)
    await client.patch(f"/api/library/items/{ok}", headers=auth_headers, json={"title": "SECRET-TITLE again"})
    await client.patch(f"/api/library/items/{ok}/segments/0", headers=auth_headers, json={"text": "SECRET-EDIT words"})
    url = (await client.post(f"/api/library/items/{ok}/media-ticket", headers=auth_headers)).json()["url"]
    token = url.split("ticket=")[1]
    assert (await client.get(url)).status_code == 200
    await client.get(f"/api/library/items/{ok}/media?ticket=SECRET-UPSTREAM")
    use_fakes(app, FakeTools())

    class Boom(FakeTools):
        async def normalize(self, *a, **kw):
            raise RuntimeError("SECRET-UPSTREAM from a tool")

    use_fakes(app, Boom())
    await upload(client, auth_headers, fake_media(), filename="SECRET-FILE.mov", subs=SUBS)
    await process(app)
    await client.put(f"/api/library/items/{ok}/subtitles", headers=auth_headers,
                     files={"file": ("SECRET-FILE.srt", SUBS, "application/x-subrip")})
    await client.delete(f"/api/library/items/{ok}", headers=auth_headers)
    assert any("library" in r.name for r in caplog.records)  # the scan saw the library's own lines
    assert leaked(caplog, (token,)) == []


@respx.mock
async def test_ai_endpoints_never_log_sentences_translations_analyses_or_prompts(app, client, auth_headers, caplog,
                                                                                monkeypatch):
    """D8:句子文字会发给大模型上游,但日志里只有条目 id、失败种类与句数;成功、模型失败(HTTP / 网络)、额度用满
    各走一遍。上游错误原文、模型回复、提示词正文都不得出现在日志里。"""
    caplog.set_level(logging.DEBUG, logger="app")
    enable(monkeypatch)
    use_fakes(app)
    ok = await upload(client, auth_headers, fake_media(), filename="SECRET-FILE.mp4", title="SECRET-TITLE", subs=SUBS)
    await process(app)

    def reply(text):
        return httpx.Response(200, json={"choices": [{"message": {"content": text}}]})

    respx.post(LLM).mock(side_effect=[
        reply("1. SECRET-TRANSLATION one\n2. SECRET-TRANSLATION two"), reply("### SECRET-ANALYSIS"),
        httpx.Response(502, json={"error": "SECRET-UPSTREAM"}), httpx.ConnectError("SECRET-UPSTREAM")])
    base = f"/api/library/items/{ok}"
    zh = {"native_language": "zh-CN"}
    assert (await client.post(f"{base}/translate", headers=auth_headers, json={"indices": [0, 1], **zh})).status_code == 200
    assert (await client.post(f"{base}/segments/0/analysis", headers=auth_headers, json=zh)).status_code == 200
    ja = {"native_language": "ja-JP"}
    assert (await client.post(f"{base}/translate", headers=auth_headers, json={"indices": [0], **ja})).status_code == 503
    assert (await client.post(f"{base}/segments/1/analysis", headers=auth_headers, json=ja)).status_code == 503
    app.state.settings = app.state.settings.model_copy(update={"library_analysis_daily_per_user": 0})
    assert (await client.post(f"{base}/segments/1/analysis", headers=auth_headers, json=zh)).status_code == 429
    assert (await client.post(f"{base}/segments/0/analysis", headers=auth_headers, json=zh)).status_code == 200  # stored
    await client.patch(f"{base}/segments/0", headers=auth_headers, json={"text": "SECRET-EDIT words"})
    assert any(r.name == "app.library.ai" for r in caplog.records)  # the scan saw the AI module's own lines
    assert leaked(caplog) == []


def test_access_log_lines_redact_the_ticket():
    line = 'GET /api/library/items/0f0e0d0c-0b0a-4908-8706-050403020100/media?ticket=abcDEF123_-xyz HTTP/1.1'
    assert "abcDEF123_-xyz" not in redact_query_secrets(line) and "ticket=[redacted]" in redact_query_secrets(line)


def test_library_routes_carry_no_text_in_urls(app):
    seen = set()
    for path, item in app.openapi()["paths"].items():
        if not path.startswith("/api/library"):
            continue
        for method, op in item.items():
            if method.upper() not in {"GET", "HEAD", "POST", "PATCH", "PUT", "DELETE"}:
                continue
            key = (method.upper(), path)
            assert key in ROUTES | LATER, f"new library route needs a privacy test: {method} {path}"
            seen.add(key)
            params = op.get("parameters", [])
            assert {p["name"] for p in params if p["in"] == "path"} <= ALLOWED_PATH, path
            assert {p["name"] for p in params if p["in"] == "query"} <= ALLOWED_QUERY, path
    assert ROUTES <= seen
````

Write `server/tests/test_library_contract.py`:

````python
"""契约夹具 `fixtures/library_contract.json`(spec §9 末段):跑一遍真实接口,按形状核对;`CONTRACT_UPDATE=1` 重录。
网页 `web/src/features/library/library-contract.test.ts`(计划 W1)逐键读它。uuid / 时间由 `agents_helpers.stable` 固定;
媒体票据写成 `REDACTED`。`errors` 是服务端的固定英文错误文本(网页的 `LIBRARY_SERVER_ERRORS` 以它为准),
`error_kinds` 是 `error_kind` 的全部取值(网页的中文映射表必须覆盖)。"""
import httpx
import pytest
import respx

from app.library.errors import ALL
from app.models import Assessment
from app.routers.library import ERRORS
from tests.agents_helpers import check_contract
from tests.library_helpers import SRT, enable, fake_media, library_settings, process, use_fakes

LLM = "https://llm.test/v1/chat/completions"


@pytest.fixture
def settings_overrides(tmp_path):
    return library_settings(tmp_path, library_ai_enabled=True)


@respx.mock
async def test_library_contract(app, client, auth_headers, monkeypatch):
    enable(monkeypatch)
    use_fakes(app)
    reply = lambda text: httpx.Response(200, json={"choices": [{"message": {"content": text}}]})  # noqa: E731
    respx.post(LLM).mock(side_effect=[reply("1. 你好,我的朋友。\n2. 你今天好吗?"), reply("### 句子结构\n一句问候。")])
    h = auth_headers
    out = {"errors": {code: text for code, (_status, text) in sorted(ERRORS.items())}, "error_kinds": sorted(ALL)}
    out["config"] = (await client.get("/api/library/config", headers=h)).json()
    data = fake_media(6000)
    out["upload_start"] = (await client.post("/api/library/uploads", headers=h,
                                             json={"filename": "Talk.mp4", "size": len(data), "title": "Talk"})).json()
    item_id = out["upload_start"]["item_id"]
    out["upload_chunk"] = (await client.put(f"/api/library/uploads/{item_id}/chunks/0", headers=h,
                                            files={"chunk": ("blob", data, "application/octet-stream")})).json()
    out["upload_state"] = (await client.get(f"/api/library/uploads/{item_id}", headers=h)).json()
    out["upload_subtitles"] = (await client.put(f"/api/library/uploads/{item_id}/subtitles", headers=h,
                                                files={"file": ("t.srt", SRT, "application/x-subrip")})).json()
    out["upload_complete"] = (await client.post(f"/api/library/uploads/{item_id}/complete", headers=h)).json()
    await process(app)
    out["items"] = (await client.get("/api/library/items", headers=h)).json()
    out["item_detail"] = (await client.get(f"/api/library/items/{item_id}", headers=h)).json()
    out["item_patch"] = (await client.patch(f"/api/library/items/{item_id}", headers=h,
                                            json={"resume_ms": 1200, "resume_idx": 1, "rate_pct": 75})).json()
    out["segment_patch"] = (await client.patch(f"/api/library/items/{item_id}/segments/0", headers=h,
                                               json={"start_ms": 400})).json()
    zh = {"native_language": "zh-CN"}
    out["translate"] = (await client.post(f"/api/library/items/{item_id}/translate", headers=h,
                                          json={"indices": [0, 1], **zh})).json()
    out["analysis"] = (await client.post(f"/api/library/items/{item_id}/segments/0/analysis", headers=h, json=zh)).json()
    out["item_detail_with_ai"] = (await client.get(f"/api/library/items/{item_id}", headers=h)).json()["segments"]
    ticket = (await client.post(f"/api/library/items/{item_id}/media-ticket", headers=h)).json()
    ticket["url"] = ticket["url"].split("ticket=")[0].replace(item_id, "00000000-0000-4000-8000-000000000000") + "ticket=REDACTED"
    out["media_ticket"] = ticket
    uid = int((await client.get("/api/me", headers=h)).json()["id"])
    async with app.state.sessionmaker() as s:
        row = Assessment(user_id=uid, reference_text="Hello there, my friend.", language="en-US", duration_ms=1,
                         audio_bytes=1, scores={"pronunciation_score": 88}, result={}, audio_path="x", source="library")
        s.add(row)
        await s.commit()
        aid = row.id
    out["attempt_post"] = (await client.post(f"/api/library/items/{item_id}/attempts", headers=h,
                                             json={"seg_idx": 0, "assessment_id": aid})).json()
    out["attempts"] = (await client.get(f"/api/library/items/{item_id}/attempts", headers=h)).json()
    out["subtitles_replace"] = (await client.put(f"/api/library/items/{item_id}/subtitles", headers=h,
                                                 files={"file": ("t.srt", SRT, "application/x-subrip")})).json()
    out["error_example"] = (await client.post(f"/api/library/items/{item_id}/retry", headers=h)).json()
    other = (await client.post("/api/library/uploads", headers=h, json={"filename": "b.mp3", "size": 10})).json()
    out["cancel"] = (await client.post(f"/api/library/items/{other['item_id']}/cancel", headers=h)).json()
    out["delete"] = (await client.delete(f"/api/library/items/{item_id}", headers=h)).json()
    assert out["item_detail"]["item"]["status"] == "ready" and out["error_example"] == {"error": "Item has not failed"}
    check_contract("library_contract", out)
````

- [ ] **Step 2: 运行确认失败** — `cd server && uv run pytest -q tests/test_library_privacy.py tests/test_library_contract.py` → 隐私的 4 个用例(含 D8 的 AI 用例)直接通过(它们核对的是已实现的行为);契约用例 `FileNotFoundError`(夹具还没录)。

- [ ] **Step 3: 录制契约夹具** — `cd server && CONTRACT_UPDATE=1 uv run pytest -q tests/test_library_contract.py`,然后**不带**环境变量再跑一次。录出的文件应与下面逐字相同(uuid / 时间由 `agents_helpers.stable` 固定,票据写成 `REDACTED`;若只有数字不同,先弄清原因):

````json
{
  "errors": {
    "ai_disabled": "AI is disabled",
    "ai_global_cap": "Daily AI limit reached",
    "ai_unavailable": "AI is unavailable",
    "ai_user_cap": "Daily analysis limit reached",
    "assessment": "Assessment does not match",
    "bad_resume": "Invalid resume position",
    "bad_subtitle": "Invalid subtitle file",
    "bad_text": "Invalid sentence text",
    "bad_times": "Invalid sentence times",
    "chunk_required": "Chunk is required",
    "chunk_size": "Wrong chunk size",
    "chunk_too_large": "Chunk is too large",
    "daily": "Daily import limit reached",
    "disabled": "Library is disabled",
    "file_required": "Subtitle file is required",
    "format": "Unsupported file type",
    "incomplete": "Upload is incomplete",
    "language": "Unsupported language",
    "max_items": "Library item limit reached",
    "no_changes": "No changes",
    "no_material": "Nothing left to retry",
    "not_active": "Item cannot be canceled",
    "not_failed": "Item has not failed",
    "not_found": "Not Found",
    "not_ready": "Item is not ready",
    "not_uploading": "Upload is not in progress",
    "quota": "Library storage quota reached",
    "segment_missing": "Sentence not found",
    "subs_state": "Subtitles cannot be changed now",
    "ticket": "Invalid ticket",
    "too_large": "File is too large",
    "unavailable": "Media tools are not installed",
    "unexpected_chunk": "Unexpected chunk",
    "upload_expired": "Upload expired",
    "uploads": "Too many uploads in progress"
  },
  "error_kinds": [
    "bad_subtitle",
    "bad_url",
    "blocked",
    "corrupt",
    "disk_full",
    "drm",
    "geo_blocked",
    "link_disabled",
    "live_unsupported",
    "login_required",
    "network",
    "no_audio",
    "no_subtitles",
    "playlist_unsupported",
    "private",
    "quota",
    "too_large",
    "too_long",
    "unsupported_format",
    "unsupported_site",
    "upload_expired",
    "upstream",
    "ytdlp_failed",
    "ytdlp_transient"
  ],
  "config": {
    "enabled": true,
    "link_import": false,
    "asr": false,
    "ai": true,
    "limits": {
      "max_upload_mb": 500,
      "max_duration_minutes": 90,
      "quota_mb": 2000,
      "used_bytes": 0,
      "max_items": 100,
      "chunk_bytes": 8388608,
      "formats": [
        "mp4",
        "m4v",
        "mov",
        "webm",
        "mkv",
        "mp3",
        "m4a",
        "aac",
        "wav",
        "ogg",
        "opus",
        "flac"
      ]
    }
  },
  "upload_start": {
    "item_id": "00000000-0000-4000-8000-000000000000",
    "chunk_bytes": 8388608
  },
  "upload_chunk": {
    "item_id": "00000000-0000-4000-8000-000000000000",
    "status": "uploading",
    "upload_received": 57,
    "upload_total": 57,
    "chunk_bytes": 8388608
  },
  "upload_state": {
    "item_id": "00000000-0000-4000-8000-000000000000",
    "status": "uploading",
    "upload_received": 57,
    "upload_total": 57,
    "chunk_bytes": 8388608
  },
  "upload_subtitles": {
    "cue_count": 2
  },
  "upload_complete": {
    "item": {
      "id": "00000000-0000-4000-8000-000000000000",
      "kind": "video",
      "source": "upload",
      "title": "Talk",
      "status": "queued",
      "stage": null,
      "progress": 0,
      "error_kind": null,
      "duration_ms": null,
      "seg_count": 0,
      "library_bytes": 0,
      "sub_source": null,
      "resume_ms": 0,
      "resume_idx": 0,
      "rate_pct": 100,
      "has_poster": false,
      "created_at": "2026-01-01T00:00:00Z",
      "last_opened_at": null
    }
  },
  "items": {
    "items": [
      {
        "id": "00000000-0000-4000-8000-000000000000",
        "kind": "video",
        "source": "upload",
        "title": "Talk",
        "status": "ready",
        "stage": null,
        "progress": 100,
        "error_kind": null,
        "duration_ms": 6000,
        "seg_count": 2,
        "library_bytes": 70,
        "sub_source": "uploaded",
        "resume_ms": 0,
        "resume_idx": 0,
        "rate_pct": 100,
        "has_poster": true,
        "created_at": "2026-01-01T00:00:00Z",
        "last_opened_at": null
      }
    ],
    "next_cursor": null
  },
  "item_detail": {
    "item": {
      "id": "00000000-0000-4000-8000-000000000000",
      "kind": "video",
      "source": "upload",
      "title": "Talk",
      "status": "ready",
      "stage": null,
      "progress": 100,
      "error_kind": null,
      "duration_ms": 6000,
      "seg_count": 2,
      "library_bytes": 70,
      "sub_source": "uploaded",
      "resume_ms": 0,
      "resume_idx": 0,
      "rate_pct": 100,
      "has_poster": true,
      "created_at": "2026-01-01T00:00:00Z",
      "last_opened_at": "2026-01-01T00:00:00Z"
    },
    "segments": [
      {
        "idx": 0,
        "start_ms": 500,
        "end_ms": 3000,
        "text": "Hello there, my friend.",
        "zh": null,
        "zh_lang": null,
        "has_analysis": false,
        "analysis_lang": null
      },
      {
        "idx": 1,
        "start_ms": 3200,
        "end_ms": 6000,
        "text": "How are you doing today?",
        "zh": null,
        "zh_lang": null,
        "has_analysis": false,
        "analysis_lang": null
      }
    ]
  },
  "item_patch": {
    "item": {
      "id": "00000000-0000-4000-8000-000000000000",
      "kind": "video",
      "source": "upload",
      "title": "Talk",
      "status": "ready",
      "stage": null,
      "progress": 100,
      "error_kind": null,
      "duration_ms": 6000,
      "seg_count": 2,
      "library_bytes": 70,
      "sub_source": "uploaded",
      "resume_ms": 1200,
      "resume_idx": 1,
      "rate_pct": 75,
      "has_poster": true,
      "created_at": "2026-01-01T00:00:00Z",
      "last_opened_at": "2026-01-01T00:00:00Z"
    }
  },
  "segment_patch": {
    "segment": {
      "idx": 0,
      "start_ms": 400,
      "end_ms": 3000,
      "text": "Hello there, my friend.",
      "zh": null,
      "zh_lang": null,
      "has_analysis": false,
      "analysis_lang": null
    }
  },
  "translate": {
    "segments": [
      {
        "idx": 0,
        "zh": "你好,我的朋友。"
      },
      {
        "idx": 1,
        "zh": "你今天好吗?"
      }
    ],
    "limited": false
  },
  "analysis": {
    "analysis": "### 句子结构\n一句问候。",
    "cached": false
  },
  "item_detail_with_ai": [
    {
      "idx": 0,
      "start_ms": 400,
      "end_ms": 3000,
      "text": "Hello there, my friend.",
      "zh": "你好,我的朋友。",
      "zh_lang": "zh-CN",
      "has_analysis": true,
      "analysis_lang": "zh-CN"
    },
    {
      "idx": 1,
      "start_ms": 3200,
      "end_ms": 6000,
      "text": "How are you doing today?",
      "zh": "你今天好吗?",
      "zh_lang": "zh-CN",
      "has_analysis": false,
      "analysis_lang": null
    }
  ],
  "media_ticket": {
    "url": "/api/library/items/00000000-0000-4000-8000-000000000000/media?ticket=REDACTED",
    "expires_in": 1800
  },
  "attempt_post": {
    "seg_idx": 0,
    "score": 88
  },
  "attempts": {
    "attempts": [
      {
        "seg_idx": 0,
        "best_score": 88,
        "count": 1,
        "last_at": "2026-01-01T00:00:00Z"
      }
    ]
  },
  "subtitles_replace": {
    "item": {
      "id": "00000000-0000-4000-8000-000000000000",
      "kind": "video",
      "source": "upload",
      "title": "Talk",
      "status": "ready",
      "stage": null,
      "progress": 100,
      "error_kind": null,
      "duration_ms": 6000,
      "seg_count": 2,
      "library_bytes": 70,
      "sub_source": "uploaded",
      "resume_ms": 1200,
      "resume_idx": 1,
      "rate_pct": 75,
      "has_poster": true,
      "created_at": "2026-01-01T00:00:00Z",
      "last_opened_at": "2026-01-01T00:00:00Z"
    },
    "segments": [
      {
        "idx": 0,
        "start_ms": 500,
        "end_ms": 3000,
        "text": "Hello there, my friend.",
        "zh": null,
        "zh_lang": null,
        "has_analysis": false,
        "analysis_lang": null
      },
      {
        "idx": 1,
        "start_ms": 3200,
        "end_ms": 6000,
        "text": "How are you doing today?",
        "zh": null,
        "zh_lang": null,
        "has_analysis": false,
        "analysis_lang": null
      }
    ]
  },
  "error_example": {
    "error": "Item has not failed"
  },
  "cancel": {
    "item": {
      "id": "00000000-0000-4000-8000-000000000000",
      "kind": "audio",
      "source": "upload",
      "title": "b",
      "status": "canceled",
      "stage": null,
      "progress": 0,
      "error_kind": null,
      "duration_ms": null,
      "seg_count": 0,
      "library_bytes": 0,
      "sub_source": null,
      "resume_ms": 0,
      "resume_idx": 0,
      "rate_pct": 100,
      "has_poster": false,
      "created_at": "2026-01-01T00:00:00Z",
      "last_opened_at": null
    }
  },
  "delete": {
    "deleted": true
  }
}
````

- [ ] **Step 4: 运行通过** — `cd server && uv run pytest -q tests/test_library_privacy.py tests/test_library_contract.py tests/test_architecture.py` → 全绿。

- [ ] **Step 5: 提交**

```bash
git add server/tests/test_library_privacy.py server/tests/test_library_contract.py server/tests/fixtures/library_contract.json
git commit -m "test(server): library privacy scan and the web contract fixture" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 14: 镜像装 ffmpeg 与文档

**Files:**
- Create: `server/tests/test_library_image.py`、`server/app/library/CLAUDE.md`
- Modify: `server/Dockerfile`、`server/README.md`、`server/app/CLAUDE.md`、`server/app/routers/CLAUDE.md`、`server/tests/CLAUDE.md`

**Interfaces(Produces):** 镜像最终阶段装 ffmpeg;`app/library/CLAUDE.md`;`app/CLAUDE.md`、`routers/CLAUDE.md`、`tests/CLAUDE.md`、`README.md` 的跟读库内容。

- [ ] **Step 1: 写失败测试**

Write `server/tests/test_library_image.py`:

````python
"""镜像与部署文件(spec §5.1、§7.3):最终阶段以 root 安装 ffmpeg(含 ffprobe),再切到非 root 用户;仍是单 worker。"""
from pathlib import Path

SERVER = Path(__file__).resolve().parents[1]


def test_the_runtime_image_installs_ffmpeg_before_dropping_root():
    text = (SERVER / "Dockerfile").read_text(encoding="utf-8")
    final = text[text.rindex("FROM python:3.12-slim\n"):]
    install = final.index("apt-get install -y --no-install-recommends ffmpeg")
    assert install < final.index("USER app")
    assert "rm -rf /var/lib/apt/lists/*" in final
    assert "--workers 1" in final  # the in-process queue, tickets and upload locks need one worker


def test_env_example_documents_every_library_setting():
    from app.core.config import Settings
    text = (SERVER / ".env.example").read_text(encoding="utf-8")
    for key in Settings.model_fields:
        if key.startswith("library_"):
            assert f"# {key.upper()}=" in text, key
````

- [ ] **Step 2: 运行确认失败** — `cd server && uv run pytest -q tests/test_library_image.py` → `test_the_runtime_image_installs_ffmpeg_before_dropping_root` 失败(`ValueError: substring not found`)。

- [ ] **Step 3: 实现**

Edit `server/Dockerfile` —— old_string:

````text
FROM python:3.12-slim
WORKDIR /app
COPY --from=builder /app /app
````

new_string:

````text
FROM python:3.12-slim
WORKDIR /app
# ffmpeg + ffprobe for the media library (spec 2026-10-13-video-import §7.3); installed as root, before privileges are dropped
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app /app
````

Edit `server/README.md` —— old_string:

````markdown
## 成本保护
````

new_string:

````markdown
## 跟读库(计划 2026-10-13)

规格:[docs/superpowers/specs/2026-10-13-video-import-design.md](../docs/superpowers/specs/2026-10-13-video-import-design.md);迁移 `0018_library`(三张表:`library_items`、`library_segments`、`library_attempts`)。代码在 `app/library/`(只被 `admin/`、`routers/` 与 `main.py` 导入),接口 `routers/library.py`(`/api/library/*`)。

- **开关,默认关**:`LIBRARY_ENABLED=false` 时 `GET /api/library/config` 返回 `{"enabled": false, …}`,其余 `/api/library/*` 返回 404 `{"error":"Library is disabled"}`。打开后还需要 ffmpeg / ffprobe(镜像里已装);缺了 `config.enabled` 为假,新建条目返回 503 `Media tools are not installed`。无字幕时的自动转写另有子开关 `LIBRARY_ASR_ENABLED`(默认关,花钱);链接导入 `LIBRARY_LINK_IMPORT_ENABLED`(默认关,计划 S2)。每句译文与单句分析另有子开关 `LIBRARY_AI_ENABLED`(默认关,花钱;需要已配置大模型上游),每人 / 全站每日额度按句计(`LIBRARY_TRANSLATE_DAILY_PER_USER`、`LIBRARY_ANALYSIS_DAILY_PER_USER`、`LIBRARY_AI_DAILY_GLOBAL`),提示词在管理端「提示词」页可编辑(`library.translate` / `library.analyze`)。全部变量与范围见 `server/.env.example`「跟读库」一节。
- **上传**:8 MiB 一片的分片上传(`POST /api/library/uploads` → `PUT …/chunks/{n}` → `POST …/complete`),同一片重发是幂等的,断网后用 `GET /api/library/uploads/{id}` 续传;每人同时最多 2 个上传。处理在进程内后台队列里进行(探测 → 转码 → 字幕 → 转写 → 分句),网页每 3 秒轮询进度;瞬时错误自动重试 2 次(30 s、120 s 后)。
- **存储**:媒体在 `DATA_DIR/library/<用户>/<条目>/`(规范化成 H.264/AAC 的 mp4,或 mp3 / m4a;视频另有一张封面),处理中的暂存在 `DATA_DIR/library/_tmp/<条目>/`,原始上传不保留。每人总量 `LIBRARY_QUOTA_MB`(默认 2000)、条目数 `LIBRARY_MAX_ITEMS`(默认 100),都可在管理端按用户覆盖。失败 / 取消的条目 7 天后连同文件自动清理;24 小时没传完的上传作废。
- **备份**:应用内备份(`admin/backups.py`)只备份数据库,**媒体不在备份里**(可以重新导入)。要备份媒体,自己备份数据卷里的 `library/` 目录。
- **隐私**:日志、错误、审计与用量计量里没有标题、文件名、URL、字幕与转写文字、ffmpeg / yt-dlp 的输出、cookies、代理和票据,只有条目 id、阶段、错误种类与数字(`tests/test_library_privacy.py`)。管理员看不到标题与内容。**句子译文与 AI 分析(`LIBRARY_AI_ENABLED`,默认关)会把句子文字发给已配置的大模型上游**(与现有聊天、翻译同一信任边界;结果存进句子行,重复打开不再花钱,按句计每日额度,日志与计量里只有数字);**自动转写会把媒体里的音频切成 15–50 秒的块发给已配置的识别上游**(火山流式或 Whisper / chat 转写,与现有语音功能同一信任边界);网页端从不请求第三方,链接导入只在服务端发生。删除用户会删除他的全部库文件与行。
- **媒体播放**:`<video>` / `<audio>` 发不了 `Authorization` 头,所以先 `POST /api/library/items/{id}/media-ticket` 换一张 30 分钟可多次使用的票据,再 `GET /api/library/items/{id}/media?ticket=…`(支持 `Range` / `If-Range`,206 / 416)。票据只在进程内,重启即失效(网页会自动换票);访问日志里的 `ticket=` 会被脱敏。
- **反向代理**:分片每片不超过 8 MiB,所以 `client_max_body_size 9m`(或更大)即可,建议对 `/api/library/` 关掉请求缓冲(`proxy_request_buffering off`);媒体读取必须把 `Range` 头原样转给后端并原样返回 206,建议 `proxy_buffering off`。Caddy 默认即可。**未验证**:Nginx / Caddy / Cloudflare 对分片与 Range 的实际行为、iOS Safari 的 seek 都没有在真实代理与真机上跑过。
- **镜像**:最终阶段以 root 安装 `ffmpeg`(含 `ffprobe`)再切回 `app` 用户;镜像增大多少**未测**(需要 `docker compose build`,按仓库规则只在需要时做,结果写进 `docs/superpowers/plans/2026-10-13-video-import-results.md`)。转码速度取决于机器,**未测**;单条时长上限给它封顶。
- **单 worker**:队列、票据、分片锁都在进程内,与房间、智能体一样只支持 `--workers 1`。

## 成本保护
````

Write `server/app/library/CLAUDE.md`:

````markdown
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
````

Edit `server/app/CLAUDE.md` —— old_string:

````markdown
| `links/` | 学习联动(顶层):订阅核心学习事件(`core/learning_events.py`),实现六个联动;只有 routers 与 `main.py` 导入 (off unless `LINKS_ENABLED`; see `links/CLAUDE.md`) |
````

new_string:

````markdown
| `links/` | 学习联动(顶层):订阅核心学习事件(`core/learning_events.py`),实现六个联动;只有 routers 与 `main.py` 导入 (off unless `LINKS_ENABLED`; see `links/CLAUDE.md`) |
| `library/` | 跟读库:上传 / 链接导入的音视频、处理流水线与进程内队列、字幕解析与分句、媒体票据 (off unless `LIBRARY_ENABLED`; see `library/CLAUDE.md`) |
````

Edit `server/app/CLAUDE.md` —— old_string:

````markdown
- admin -> core, models, providers, speech, services, realtime, rank, rooms, wordbook, agents; only routers and `main.py` import admin
- routers -> anything above (incl. rank, rooms, wordbook, links, agents); only `main.py` (and other routers) import routers
````

new_string:

````markdown
- library -> core, models, providers, speech, services; only admin, routers and `main.py` import it
- admin -> core, models, providers, speech, services, realtime, rank, rooms, wordbook, agents, library; only routers and `main.py` import admin
- routers -> anything above (incl. rank, rooms, wordbook, links, agents, library); only `main.py` (and other routers) import routers
````

Edit `server/app/CLAUDE.md` —— old_string:

````markdown
and reach the runtime only through `runtime(app)` / `deps_for(app)`.
````

new_string:

````markdown
and reach the runtime only through `runtime(app)` / `deps_for(app)`.
Library wiring: `library.worker.install(app)` builds `app.state.library` (queue, media tickets, fetch stage); the lifespan runs
its poll loop as `tasks["library"]` and calls `shutdown()` before the engine closes. Plan S2 (`library_import`) and plan A
(`admin_library`) append at the labelled anchor comments.
````

Edit `server/app/CLAUDE.md` —— old_string:

````markdown
(head `0016`)
````

new_string:

````markdown
(head `0018`)
````

Edit `server/app/routers/CLAUDE.md` —— old_string:

````markdown
`agents_tutor` (/api/agents/tutor/*: start, active, get, hint, skip, finish; the turn itself is `POST /api/agents/turn` with `mode=tutor`; logic in `app/agents/tutor/service.py`; must precede `stubs`),
````

new_string:

````markdown
`agents_tutor` (/api/agents/tutor/*: start, active, get, hint, skip, finish; the turn itself is `POST /api/agents/turn` with `mode=tutor`; logic in `app/agents/tutor/service.py`; must precede `stubs`),
`library` (/api/library/*: config, chunked uploads, items, retry/cancel, subtitles, sentence edits, media tickets + ticket-only media with Range, poster, shadowing attempts, per-sentence `translate` and `analysis` (D8; AI switch `LIBRARY_AI_ENABLED`); logic in `app/library/`; ids only in URLs; must precede `stubs`),
````

Edit `server/tests/CLAUDE.md` —— old_string:

````markdown
  `dictionary_contract.json` (recorded by `test_dictionary_contract.py`; web `dictionary-contract.test.ts` reads it);
````

new_string:

````markdown
  `dictionary_contract.json` (recorded by `test_dictionary_contract.py`; web `dictionary-contract.test.ts` reads it);
  `library_contract.json` (recorded by `test_library_contract.py`; web `library-contract.test.ts` reads it; tickets written `REDACTED`);
````

Edit `server/tests/CLAUDE.md` —— old_string:

````markdown
- `test_architecture.py` – AST import scan enforcing the `app/` layering rules
````

new_string:

````markdown
- `test_architecture.py` – AST import scan enforcing the `app/` layering rules
- `library_helpers.py` – library fakes: `FakeTools` (no ffmpeg needed), `FakeAsr`, `fake_media`, `enable`, `library_settings`, `upload` (chunked), `process` (one worker round + drain)
- `test_library_privacy.py` – caplog over every `/api/library` endpoint (incl. the D8 translate / analysis paths) and the worker paths; pins that library routes carry only ids, `cursor` and `ticket` (new routes must be added there)
- `test_library_ai.py` / `test_library_ai_api.py` – sentence translation and analysis: pure functions, per-sentence allowances, write-back, editable prompts; endpoints against a respx fake LLM
````

- [ ] **Step 4: 运行通过** — `cd server && uv run pytest -q tests/test_library_image.py tests/test_architecture.py` → 全绿。

- [ ] **Step 5: 提交**

```bash
git add server/tests/test_library_image.py server/Dockerfile server/README.md server/app/library/CLAUDE.md server/app/CLAUDE.md server/app/routers/CLAUDE.md server/tests/CLAUDE.md
git commit -m "chore(server): install ffmpeg in the image and document the library" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 15: B 档边界误差实测(spec §6.4 第 5 步;BLOCKED 时跳过)

**Files:** 不改仓库代码;只追加结果文档。脚本放在仓库之外,不提交。

**前提:** Task 1–14 已合并;本机有 ffmpeg;识别上游可用且有余额;用户提供 1–3 段**带人工字幕**的英语素材(媒体 + SRT)。费用约等于素材时长的识别分钟数。没有这些就在结果文档写「BLOCKED」。

- [ ] **Step 1: 写脚本**(仓库外,例如 `<临时目录>/measure_btier.py`):

````python
"""B-tier boundary error on real samples (plan 2026-10-13-video-import-server-core, Task 15; spec §6.4 step 5).

Not committed. Save outside the repo, then from server/ (after Tasks 1-14 are merged):
    uv run python <path>/measure_btier.py <media file> <human SRT of the same media> [<more pairs> ...]
Uses server/.env (the real recognizer; costs about one minute of recognition per minute of media) and the real
ffmpeg. Prints only counts and millisecond statistics: never transcripts, titles or keys."""
import asyncio
import os
import statistics
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, os.getcwd())  # run from server/

import httpx  # noqa: E402

from app.core.config import Settings  # noqa: E402
from app.library import asr_chunks, segment, subtitles  # noqa: E402
from app.library.media import Ffmpeg  # noqa: E402
from app.speech.asr import make_transcriber  # noqa: E402


def nearest(value: int, candidates: list[int]) -> int:
    return min(abs(value - c) for c in candidates)


async def one(settings: Settings, http: httpx.AsyncClient, media: Path, srt: Path) -> list[int]:
    tools = Ffmpeg()
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        info = await tools.probe(media, home=tmp)
        silences = await tools.speech_wav(media, tmp / "speech.wav", info.duration_ms, home=tmp)
        chunks = asr_chunks.plan_chunks(info.duration_ms, silences)
        transcribe = make_transcriber(http, settings, "en", uid="measure")

        async def read(chunk):
            return asr_chunks.slice_wav(tmp / "speech.wav", chunk.start_ms, chunk.end_ms)

        async def progress(done, total):
            print(f"  chunks {done}/{total}", end="\r")

        await asr_chunks.transcribe_chunks(chunks, read=read, transcribe=transcribe, save=lambda c: None,
                                           progress=progress)
    estimated = segment.build(asr_chunks.fragments(chunks, silences), adjust=asr_chunks.snapper(silences))
    cues = subtitles.parse(srt.read_bytes())
    starts, ends = [c.start_ms for c in cues], [c.end_ms for c in cues]
    errors = [nearest(s.start_ms, starts) for s in estimated] + [nearest(s.end_ms, ends) for s in estimated]
    print(f"\n{media.name}: duration_ms={info.duration_ms} chunks={len(chunks)} silences={len(silences)} "
          f"sentences={len(estimated)} reference_cues={len(cues)}")
    return errors


async def main() -> None:
    settings = Settings()
    pairs = list(zip(sys.argv[1::2], sys.argv[2::2]))
    errors: list[int] = []
    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0)) as http:
        for media, srt in pairs:
            errors += await one(settings, http, Path(media), Path(srt))
    errors.sort()
    p90 = errors[int(len(errors) * 0.9) - 1] if errors else None
    print(f"boundaries={len(errors)} median_ms={statistics.median(errors) if errors else None} p90_ms={p90} "
          f"max_ms={errors[-1] if errors else None}")


asyncio.run(main())
````

- [ ] **Step 2: 运行** — `cd server && uv run python <临时目录>/measure_btier.py a.mp4 a.srt [b.mp4 b.srt]`。它只打印数量与毫秒统计(每个估算句首到最近的人工 cue 起点、句尾到最近的 cue 终点的距离)。

- [ ] **Step 3: 结果文档追加**:

````markdown
## S1 · B 档句边界误差实测(Task 15)

- 日期 / 识别上游:[…];素材:[段数、总时长,来源类型(不写标题)]
- 边界数:[…];中位数:[… ms];P90:[… ms];最大:[… ms]
- 结论:[±0.2 s 微调是否够用 / 建议]
````

- [ ] **Step 4: 提交结果文档** —

```bash
git add docs/superpowers/plans/2026-10-13-video-import-results.md
git commit -m "docs: record the measured library sentence boundary error" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```


### Task 16: 真实大模型的批量译文格式与分析分节实测(D8、R-SC33;BLOCKED 时跳过)

**Files:** 不改仓库代码;只追加结果文档。脚本放在仓库之外,不提交。

**前提:** Task 1–14 已合并;大模型上游(`UPSTREAM_LLM_*`)可用;用户提供一份**至少 40 句**的真实英语句子文件(一行一句,来自自己的素材)。费用是几十次短调用。没有这些就在结果文档写「BLOCKED」。**这是 D8 唯一依赖真实上游的假设**:测试里的大模型是 respx 假上游,`N. 译文` 的批量格式有多少句会被真实模型漏掉、桌面端 `analyze` 提示词会不会稳定给出三节,只有这里能回答;结果决定一次调用 20 句是否合适(`limits.AI_BATCH_MAX` 是常量,可以调小)。

- [ ] **Step 1: 写脚本**(仓库外,例如 `<临时目录>/measure_translate.py`;下面的脚本写计划时用 respx 假上游跑通过,只验证脚本本身,**没有**连过真实模型):

````python
"""Batch-format adherence of the real LLM (plan 2026-10-13-video-import-server-core, Task 16; D8, R-SC33).

Not committed. Save outside the repo, then from server/ (after Tasks 1-14 are merged):
    uv run python <path>/measure_translate.py <sentences.txt> [native language code, default zh-CN]
sentences.txt: at least 40 lines, one real English sentence per line, from your own material. Uses server/.env (the
real LLM upstream; small cost). Prints counts and milliseconds only: never sentences, translations, analyses or keys."""
import asyncio
import os
import sys
import time

sys.path.insert(0, os.getcwd())  # run from server/

import httpx  # noqa: E402

from app.core.config import Settings  # noqa: E402
from app.library import ai  # noqa: E402
from app.providers import llm  # noqa: E402

SIZES = (1, 5, 10, 20)
SAMPLE = 40  # sentences per batch size


async def translate_runs(settings: Settings, http: httpx.AsyncClient, sentences: list[str], language: str) -> None:
    for size in SIZES:
        batches = [sentences[i:i + size] for i in range(0, SAMPLE, size)]
        translated = missing = failed = 0
        started = time.monotonic()
        for batch in batches:
            max_tokens = min(ai.TRANSLATE_TOKENS_CAP, ai.TRANSLATE_TOKENS_BASE + ai.TRANSLATE_TOKENS_PER_SENTENCE * len(batch))
            try:
                raw = await llm.complete(http, settings, ai.render_translate(None, language, batch),
                                         model=settings.default_llm_model, max_tokens=max_tokens,
                                         temperature=ai.TRANSLATE_TEMPERATURE)
            except llm.LlmUnavailable:
                failed += 1
                continue
            got = ai.parse_translations(raw, len(batch))
            translated += len(got)
            missing += len(batch) - len(got)
        print(f"translate batch={size} calls={len(batches)} failed_calls={failed} translated={translated} "
              f"missing={missing} ms={int((time.monotonic() - started) * 1000)}")


async def analysis_runs(settings: Settings, http: httpx.AsyncClient, sentences: list[str], language: str) -> None:
    sections = []
    started = time.monotonic()
    for sentence in sentences[:5]:
        try:
            raw = await llm.complete(http, settings, ai.render_analysis(None, language, sentence),
                                     model=settings.default_llm_model, max_tokens=ai.ANALYZE_MAX_TOKENS,
                                     temperature=ai.ANALYZE_TEMPERATURE)
        except llm.LlmUnavailable:
            sections.append(-1)
            continue
        sections.append(raw.count("### "))
    print(f"analysis calls=5 sections_per_reply={sections} ms={int((time.monotonic() - started) * 1000)}")


async def main() -> None:
    sentences = [ln.strip() for ln in open(sys.argv[1], encoding="utf-8") if ln.strip()]
    language = sys.argv[2] if len(sys.argv) > 2 else "zh-CN"
    assert len(sentences) >= SAMPLE and language in ai.LANGS, "need 40+ sentences and a whitelisted language code"
    settings = Settings()
    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0)) as http:
        await translate_runs(settings, http, sentences, language)
        await analysis_runs(settings, http, sentences, language)


asyncio.run(main())
````

- [ ] **Step 2: 运行** — `cd server && uv run python <临时目录>/measure_translate.py sentences.txt zh-CN`。输出只有每种批量大小的调用数、失败调用数、译出句数、漏句数与毫秒,以及 5 次分析各自的 `### ` 节数;不打印句子、译文或密钥。

- [ ] **Step 3: 结果文档追加**(方括号换成真实结论,不编造):

````markdown
## S1 · 真实大模型的批量译文与分析格式(Task 16)

- 日期 / 模型:[…](只写模型名,不写密钥或上游地址)
- 译文:批量 1 / 5 / 10 / 20 各 40 句——漏句数 [… / … / … / …],失败调用 [… / … / … / …],耗时 [… / … / … / … ms]
- 分析:5 次回复的分节数 [… ](期望每次 3 节)
- 结论:[20 句一批可用 / 调小 `AI_BATCH_MAX` 到 … / 模板需要加强格式说明(改 `DEFAULT_TRANSLATE_TEMPLATE` 并更新 `test_library_ai.py`)/ BLOCKED:原因]
````

- [ ] **Step 4: 提交结果文档** —

```bash
git add docs/superpowers/plans/2026-10-13-video-import-results.md
git commit -m "docs: record the measured library translation format adherence" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## 验证矩阵

| 要验证的事 | 怎么验证 | 写计划时的状态 |
|---|---|---|
| Range:206 / 416 / `If-Range` / 多区间 / 畸形 | `test_library_range.py`(9)+ `test_library_media_api.py::test_media_needs_a_ticket_and_supports_ranges` | 副本实跑,通过 |
| 设置默认值、边界、注册表、配额键、计量前缀、三个可用性属性 | `test_library_settings.py`、`test_settings_registry.py` | 副本实跑,通过 |
| 迁移往返、外键与索引、模型一致 | `test_library_models.py`、`test_migrations.py`(含 `test_models_match_migrations`) | 副本实跑(SQLite),通过;**Postgres 未跑** |
| 分层 | `test_architecture.py::test_library_layer_rules` + 全仓扫描 | 副本实跑,通过 |
| 字幕解析(SRT / VTT / 编码 / 标签 / 双语 / 滚动字幕 / 坏文件) | `test_library_subtitles.py`(34) | 副本实跑,通过 |
| 分句器 + 64 个共享夹具(a)(b)(c) + 后处理 | `test_library_segment.py`(202) | 副本实跑,通过 |
| 分块、吸附、断点、重试与计秒 | `test_library_asr_chunks.py`、`test_library_worker.py` 的两个转写用例 | 副本实跑(假识别),通过;**真实识别未跑(T0b / T15)** |
| 子进程白名单 / 超时 / 取消;ffmpeg 规则与真实转码 | `test_library_media.py`(真实 ffmpeg 用例 skipif) | 副本实跑(本机 ffmpeg 9.0),通过 |
| 票据 | `test_library_tickets.py` | 副本实跑,通过 |
| 认领原子性、恢复、失败退避、清扫 | `test_library_store.py`、`test_library_worker.py` | 副本实跑,通过 |
| 接口:开关 404、鉴权、分片幂等 / 续传 / 超限、配额 / 并发 / 每日、私有、分页、修改、删除、重试、取消 | `test_library_api.py` | 副本实跑,通过 |
| 票据媒体、停用用户、封面、补传字幕、微调、成绩、`library` 来源 | `test_library_media_api.py` | 副本实跑,通过 |
| 删用户删库(行与文件,不动别人) | `test_library_delete_user.py`、`test_admin_users.py` | 副本实跑,通过 |
| 隐私(日志)与 URL 无文字,含 D8 的译文 / 分析路径(成功、模型 HTTP / 网络失败、额度用满) | `test_library_privacy.py`(4 个用例;AI 用例在 `ai.py` 里临时加一行记录模型回复时变红,已验证它真的能抓到) | 副本实跑,通过 |
| D8 提示词:注册、默认值取自桌面端 enjoy 原文、管理端默认正文与试运行、编号格式解析、转义 | `test_library_ai.py`、`test_prompts.py`、`test_prompts_api.py` | 副本实跑,通过(`enjoy/` 原文核对用例在副本里带着 `enjoy/src/shared/commands` 跑过) |
| D8 额度:按句计、部分授予、全站上限退回、失败 / 漏答退还 | `test_library_ai.py` | 副本实跑,通过 |
| D8 写回与改字清空、字幕替换清空、旧文本保护 | `test_library_ai.py`、`test_library_ai_api.py`、`test_library_media_api.py` | 副本实跑,通过 |
| D8 接口:开关 / 无大模型 404、白名单语言、批量、`limited`、503 退还、429 两种文案、`cached`、已发布提示词与回落、计量 feature | `test_library_ai_api.py`(respx 假上游,走真实 `providers/llm.complete`) | 副本实跑,通过;**真实大模型未跑(Task 16)** |
| 契约夹具 | `test_library_contract.py`(`CONTRACT_UPDATE=1` 录制后再跑一次) | 副本实跑,通过 |
| 镜像装 ffmpeg、`.env.example` 覆盖全部键 | `test_library_image.py` | 副本实跑(只查文件内容),通过;**镜像未构建** |
| 全量回归 | `cd server && uv run pytest -q`(只在合并车道前、由编排者决定是否跑) | **修订版没有跑完全量**:在副本里起过一次,跑到约 56% 时(这台机器上约 1% / 数分钟)被中止,已跑部分无失败;改跑「各任务列出的测试 + 受改动影响的套件」共 483 个用例(`test_library_*`、`test_settings_registry`、`test_quotas`、`test_metering`、`test_config`、`test_migrations`、`test_admin_users`、`test_assessment_source`、`test_practice_items`、`test_prompts*`、`test_wordbook_explain`、`test_architecture`),全绿。写第一版计划时的那次全量里有一条与本计划无关的 `test_agents_tutor_turn.py` 用例失败(临时目录路径相关),本次未复核 |

## 未验证清单(如实)

- **真实大模型对批量格式 `N. 译文` 的遵守程度、桌面端分析提示词的分节稳定性(Task 16)**:测试只用 respx 假上游;写计划时没有跑过真实模型。`AI_BATCH_MAX = 20`、`max_tokens` 公式与 `temperature` 都是未经实测的初值。
- **译文 / 分析的耗时与费用**:未测;额度默认值(每人每天 500 句译文 / 30 次分析、全站 5000 句)是 spec 给的,不是按真实账单算的。
- **识别上游是否返回时间戳(spike S1,T0b)**与 **B 档边界的真实误差(T15)**:需要真实上游余额与带人工字幕的素材;写计划时都没有跑。界面文案与 README 不得写具体精度数字,直到 T15 有结果。
- **ffmpeg 在部署机器上的转码速度、镜像体积**(T0 Step 4,需要重建镜像)。本机 ffmpeg 9.0 跑过的只是几秒的合成素材。Debian bookworm 源里的 ffmpeg 版本与编解码器(`libx264`、`libvpx-vp9`、`libopus` 解码)**未在镜像里核对**——本机是 gyan.dev 的完整构建。
- **Postgres**:三张表与条件 UPDATE 认领只在 SQLite 上跑过(语义上 Postgres 同样安全,但没跑)。
- **大文件**:数百 MB 的分片上传、长视频转码与 `max(120, 3×时长)` 超时只做了单元级验证;手机网络上的断点续传未在真机跑。
- **反向代理**(Nginx / Caddy / Cloudflare)对分片与 Range 的实际行为、`proxy_buffering` 建议是否必要:未验证。
- **iOS Safari** 的 Range seek、单句循环:属于网页车道,但依赖本计划的 206 行为;真机未验证。
- **多进程**:票据、分片锁、运行中的任务都在进程内;镜像固定 `--workers 1`,多 worker 不受支持。

## 不做

- A 档(上游时间戳)的解析代码与 `app/speech/*` 的任何改动(R-SC4,等 T0b 结论)。
- D10 的第二期清单(录音管理页、转写稿下载与打印、每句笔记、重新识别、单句音频下载、素材 AI 摘要、音标)与 spec §14 的并排双栏译文视图:服务端不为它们预留接口。
- 译文 / 分析的流式输出、按用户覆盖译文额度(`QUOTA_KEYS` 不加)、可配置的译文 / 分析模型(用 `default_llm_model`)、全站共享译文缓存(译文按条目存,不跨用户复用)。
- 链接导入的一切(S2):URL 预检、yt-dlp、`POST /imports`、`pyproject.toml` / `uv.lock`、`docker-compose.example.yml`。
- 管理端端点、诊断四个发现、管理端网页(A)。
- 网页任何代码(W1 / W2)、根 README 与 `web/README.md` 的功能介绍(Z)。
- spec §14 的全部「不做」:公开分享、离线缓存媒体、字幕翻译的并排双栏视图(D8 只做「句下一行」)、播放列表、直播、绕过 DRM、应用内自动更新 yt-dlp、说话人分离、词级强制对齐、剪辑导出、非英语素材、与桌面版同步、把 SSRF 检查抽到 `core/`。
- 媒体的应用内备份(R-SC2);`settings_service.danger_reasons` 的方向规则(R-SC15)。

## 交接(本计划产出、别的车道要落地的东西)

1. **S2**:在 `main.py` 两个 `plan S2` 锚点处各加一行(`library_import.install(app)`、路由元组 `library_import,`),并把 `library_import` 加进 `from app.routers import (...)`;`app/library/CLAUDE.md` 的 What lives here 由 S2 自己追加 `urlcheck.py` / `ytdlp.py` 两条(S2 计划把它列为交给 S1 所有者;本计划允许 S2 在该文件末尾的列表里**只追加**这两条,避免多一次往返)。镜像若需要 JS 运行时,按 S2 结果文档改 `Dockerfile`(本计划的文件,允许 S2 / Z 只追加一行 `RUN`)。
2. **A**:在 `plan A` 锚点处加 `admin_library,`,并在 `from app.routers import (...)` 里加名字;删除 / 取消经 `store.delete_item` / `store.cancel_item`(自己提交,A 计划 R-A3 的「S1 自己提交」分支)。
3. **W1**:读 `server/tests/fixtures/library_contract.json`;`LIBRARY_SERVER_ERRORS` 以夹具 `errors` 为准,错误种类中文表覆盖 `error_kinds`;入口(底部标签「跟读库」,E9)只在 `config.enabled` 时显示;链接条目处理中 `title` 可能为空串。
4. **A**:`app/admin/CLAUDE.md` 的 `prompts_admin.py` 一行补一句「`library.translate` / `library.analyze` 经 `library.ai.render_test` 渲染」(S1 不碰 A 的文件,R-SC29);`overview` 的「今日译文 / 分析句数」读 `daily_usage` 的 `library_translate` / `library_analysis` / `library_ai`(见「对外接口」A 段);用量页(`admin/src/features/usage/strings.ts`)的 feature 中文名加 `lib_translate`、`lib_analysis`(R-SC36;不是 `library_translate`)。设置页自动出现新设置,无额外工作。
5. **W1 / W2**:D8 的形状(`zh` / `zh_lang` / `has_analysis` / `analysis_lang`、`translate` 与 `analysis` 的请求 / 返回、白名单语言码、错误文案)以夹具 `library_contract.json` 的 `translate`、`analysis`、`item_detail_with_ai`、`errors` 键为准;网页的「译」开关只在 `config.ai` 为真时出现,批量请求 ≤ 20 句,**不预取分析**;`limited: true` 与 429 / 503 给一次固定提示,不逐句报错。
6. **Z**:镜像体积、T15 的真实误差、T16 的真实模型格式遵守程度、§13「未验证」逐条结果写进结果文档与根 README;`docker compose build` 只在用户要求时。
