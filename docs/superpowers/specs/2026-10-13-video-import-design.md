# 跟读库:导入音视频 / 链接 + 逐句跟读 · 设计

- 日期:2026-10-13 · 状态:D1–D7 用户已确认;E 系列是本文的设计裁定,待用户复核(§15 有 5 个开放问题);本文是服务端(2 份)、网页(2 份)、管理端三条车道计划的唯一依据
- 前置:`2026-10-04` 网页版设计、`2026-10-09-admin-console-v2-design.md`、`2026-10-10-rooms-v2-design.md`(语音转写与重试的先例)、`2026-10-11-learning-links-design.md`(扩展点)
- 「核对」处:计划作者必须读真实代码确认,不得凭本文推断;本文已核对的结论见 §2
- 不动 `enjoy/`;网页只经 `web/src/shims` 与 `@renderer/*` 复用上游,本功能不需要新 shim

## 1. 用户已确认的决定

| # | 决定 |
|---|---|
| D1 | 自托管、个人使用,**版权不是约束**;不做公开分享、社区、跨用户共享 |
| D2 | 全部都做:上传自己的音视频(可附 SRT / VTT 字幕)、链接导入、跟读体验,不砍范围 |
| D3 | 没有字幕时,服务端用**现有语音识别上游**转写;要查清哪种识别带时间戳,并决定分句;复用共享切句夹具 `server/tests/fixtures/sentence_cases.json` |
| D4 | 链接导入(YouTube,以及 yt-dlp 支持的其他站)**必须能由管理员开关**:设置登记表里的项,**默认关**,同时有环境变量并写进 `server/.env.example`。服务端用 yt-dlp。受 DRM 保护的流媒体站不支持,界面必须明说 |
| D5 | 每个用户一个**私有库**,条目可由用户自己删除 |
| D6 | 跟读体验:句子列表、单句循环、可调速度、跟读录音 + 发音评测(复用现有评测)、点词查词(复用现有查词)、把句子加入练习清单、续播位置 |
| D7 | 管理页只做桌面端,列出大小 / 所有者 / 删除 |
| D8 | (2026-10-13 增补,对齐桌面端 enjoy 播放页)**每句翻译(双语显示)**、**AI 分析句子**(结构 / 语法 / 词汇与短语)、**复制句子**列入本期范围;译文和分析由服务端调大模型生成后**存进句子行**,重复打开不再花钱 |
| D9 | (2026-10-13 设计稿拍板)入口 = **独立底部标签**;跟读 = **点话筒才录**(不做自动跟读模式);盲听 = **整页句子文字遮住、点一下显示**;列表只按添加时间**倒序**(不做「最近在学」置顶);横屏全屏视频**不做** |
| D11 | (2026-10-13 视觉评审)跟读库页面采用**深色优先、加强透明玻璃**的外观(浅色同样支持);动效强度保持「克制档」(处理中流光、当前句描边、主按钮光带、一次性入场与数字滚动);**12 个效果全部采用**;**只用在跟读库新页面**,不改全站现有页面。设计稿:`docs/superpowers/design/video-import-v1/mockup-glass.html`(视觉的唯一依据) |
| D12 | (2026-10-13)用户要求**可以切换深色和浅色**。现状:应用只跟随系统(`layout/color-scheme.ts` 的 `initColorScheme` 只读 `prefers-color-scheme`),没有手动开关。本期加一个**全站「外观:跟随系统 / 浅色 / 深色」设置**(默认「跟随系统」),存在现有设置里(`settings/`,本机),`initColorScheme` 读取它后切换 `html.dark`;入口放在「我的」设置区,库页面不另设开关。全站原本就有 `.dark` 变量,所以这只是加开关,不重画其他页面;玻璃与动效仍只在跟读库 |
| D10 | (同上)**第二期**再做:录音管理页(列表 / 批量删除 / 导出)、转写稿下载与打印、每句笔记、重新识别(重转写)、单句音频下载、素材 AI 摘要与录音统计、音标显示。**不做**:波形图与拖动区域、快捷键、词级强制对齐(与 §14 一致) |

## 2. 设计裁定(E 系列,待复核)与已核对的事实

### 2.1 设计裁定

| # | 裁定 |
|---|---|
| E1 | 新增服务端包 `server/app/library/`(顶层之下的业务层)、迁移 `0018_library`、网页 feature `web/src/features/library/`、管理端页 `admin/src/features/library/`。总开关 `LIBRARY_ENABLED` 默认关,关 = `/api/library/*` 除 `config` 外 404,与未安装完全一致 |
| E2 | **一条处理流水线 + 一个后台队列**:上传和链接导入都变成一个 `library_items` 行,由进程内 worker 按阶段处理(探测 → 取回 → 转码 → 字幕 → 转写 → 分句 → 完成);进度、重试、取消都挂在这一行上,不另建任务表 |
| E3 | **大文件上传用分片**(每片 ≤ 8 MiB,multipart,可断点续传),因为现有请求体限制(`core/bodylimit.py`)对非 multipart 超过 1 MiB 的请求直接 413,而 multipart 的上限要各路由自己卡;反向代理的单请求体上限(例如 Nginx `client_max_body_size`、Cloudflare 免费档 100 MB)也不会挡住分片 |
| E4 | **媒体播放用短期票据 URL**:网页的 HTTP 客户端只会发 `Authorization: Bearer`,`<video>` / `<audio>` 发不了头。`POST /api/library/items/{id}/media-ticket` 返回带 `?ticket=` 的同源 URL(多次可用、30 分钟、内存里保存);参数名沿用 `ticket`,这样 `core/logging_setup.py` 现有的 `ticket=` 脱敏直接生效 |
| E5 | **时间戳策略分两档**:A 档(有则用)= 识别上游自带时间戳;B 档(必有、本文的生产路径)= 静音感知分块转写 + 按字符比例估算句边界并吸附到静音点,界面提供每句 ±0.2 s 微调。A 档是否可行由 spike S1 决定,不阻塞 B 档(§6.4) |
| E6 | **字幕优先级**:用户上传的字幕 > 平台人工字幕 > 识别转写 > 平台自动字幕(仅当识别不可用时才用,因为滚动式自动字幕重复多、无标点)。字幕与识别都走同一个「文本 + 时间 → 句子」分句器(§6.3) |
| E7 | 所有设置项(含链接导入的)统一由服务端车道 S1 一次性加进 `config.py` / `settings_registry.py` / `.env.example`,避免多车道改同一批文件冲突 |
| E8 | 链接导入的 yt-dlp **以子进程运行**(`python -m yt_dlp`),环境变量白名单(绝不继承 `UPSTREAM_*_KEY` 等密钥)、超时、可被取消终止;标准错误只做分类后丢弃(里面有 URL 和标题) |
| E9 | **入口:独立底部标签「跟读库」**(用户 2026-10-13 决定,取代原先的练习页入口卡)。在 `web/src/layout/bottom-nav.tsx` 的标签数组里增加 `LIBRARY`(`/library`,`also: []`,`/library/*` 下保持高亮),与「联机」一样由 `useLibraryEnabled()`(来自 `~/features/library` 的 `index.ts`,只含读 `GET /api/library/config` 的小钩子,页面全部懒加载)控制:`enabled` 为假时不显示标签,直接访问路由跳回 `/practice`。标签顺序:练习 · 对话 · 联机 · 跟读库 · 我的(联机或跟读库任一关闭时对应少一个;最多 5 个,360 px 下每个标签约 72 px,标签文字 ≤ 4 个汉字 / 8 个英文字符,「核对」`glass-tab-bar` 在 5 列时不溢出)。layout 层导入 feature 的 `index.ts` 是现有做法(联机同理),**不新增 `practiceHome` 扩展点,也不新增跨 feature 边**(layout 不在 feature 之间的边基线里,「核对」`architecture.test.ts`)。新文案键 `web.nav.library` 进主包(≈ 几十字节),体积预算 §11.5 照旧 |
| E10 | 管理员**看不到**标题、URL、字幕与转写内容,只看大小、所有者、种类、状态、时长、时间、来源主机名(与「管理员不能读记忆内容」同一原则) |
| E11 | **译文与分析放服务端、存在 `library_segments` 行上**(而不是像全站选词那样在网页直接调模型):理由是一条素材几百句,反复打开不应重复花钱,且额度能统一计量。提示词沿用桌面端 `enjoy/src/shared/commands/{translate,analyze}.command.ts` 的原文(服务端放进现有提示词注册方式,「核对」`app/services/prompts.py` 与 `admin/prompts_admin.py` 怎么登记可编辑的提示词;不新增 enjoy 改动)。母语取自用户设置,服务端只接受白名单语言码。句子文字被编辑(`PATCH segments` 改了 `text`)或字幕被替换时,该句的 `zh` / `analysis` 清空 |
| E12 | 译文**按需批量生成**:打开「译」开关后,网页只请求视野内及前后各 10 句里还没有译文的句子(每次 ≤ 20 句);分析**只在点「分析」时**生成。额度按「句」计(§5.2),开关关或额度满时给固定文案,不影响播放与跟读 |

### 2.2 已核对的事实(读代码得到,计划作者仍要在动手前复核一遍)

| 核对项 | 结论 | 依据 |
|---|---|---|
| 迁移最新号 | 最新是 `0017`(`0017_room_agents.py`,`down_revision = '0016'`);`server/app/CLAUDE.md` 写的「head 0016」已过期。`2026-10-12-agents-addressing` 的 R-AS1 裁定该计划**不**占用 `0018`。本功能用 `0018_library`,计划 Task 0 先跑 `alembic heads` 复核 | `server/alembic/versions/`、`docs/superpowers/plans/2026-10-12-agents-addressing-server.md` |
| 现有识别有没有时间戳 | **没有**。火山流式 `transcribe_pcm` 只返回 `str`,请求负载没开 `show_utterances`(`asr_stream._request_payload`);Whisper 路径 `response_format=json` 只取 `text`;`chat` 模式(多模态 LLM)的提示词明文禁止时间戳(`stt.CHAT_PROMPT`)。所以今天的三条路径都拿不到时间。上游是否能返回(火山 `utterances[].start_time/end_time`、Whisper `verbose_json` 的 `segments`)**本仓库没验证过**,列为 spike S1 | `server/app/speech/asr_stream.py`、`stt.py`、`asr.py` |
| 单次识别的长度 | 评测录音上限 `MAX_ASSESSMENT_SECONDS = 300`;`chat` 模式把音频 base64 塞进 JSON 请求体,太长会撑爆请求与成本。所以识别块 ≤ 50 s | `routers/speech.py`、`stt.chat_body` |
| 识别入口 | `make_transcriber(http, settings, language, gate=shared_asr_gate(app.state, settings), uid=...)` 返回 `WAV(16 kHz 单声道 16 位) → str`,内含「火山流式优先、失败回退 Whisper/chat」和熔断闸门;库的转写**只**经它,不直接碰上游 | `speech/asr.py` |
| 识别可用性判断 | `asr_stream_usable(settings) or whisper_fallback_configured(settings)`(`core/config.py` 末尾的纯函数) | `core/config.py` |
| 切句器 | `app/speech/sentence_split.py::split_all(text)` 与网页 `sentence-stream.ts` 共用 64 个夹具(`tests/fixtures/sentence_cases.json`,每项 `{text, sentences}`),`MAX_SENTENCE_CHARS = 200`;库的分句**包装它而不改它**(§6.3),夹具与网页切句器都不改 | `speech/sentence_split.py`、`tests/test_sentence_split.py` |
| 服务端镜像 | `python:3.12-slim`,**没有 ffmpeg**(`lameenc` 就是为了免 ffmpeg 而选的);非 root 用户 `app`(uid 10001),`/data` 卷,`--workers 1`(进程内队列与限流器成立的前提) | `server/Dockerfile` |
| 请求体限制 | 非 multipart 且声明长度 > 1 MiB → 413;multipart 放行,由路由自己限制(现有评测 25 MiB) | `core/bodylimit.py` |
| 网页鉴权 | 只有 `Authorization: Bearer`(`web/src/api/client.ts`),没有 Cookie;现有评测音频是 `api.request(..., {as:"blob"})` 取回再播 | `web/src/api/client.ts`、`practice/assessment-api.ts` |
| 日志脱敏 | `logging_setup._SECRET_QUERY` 只匹配 `ticket=`(uvicorn 访问日志);沿用该参数名 | `core/logging_setup.py` |
| Range | Starlette 1.7.0(`uv.lock`)的 `FileResponse` 应已支持 `Range` / `If-Range` / 416;**以测试为准**(S1 Task 0 写 206 / 416 / 多段 / `If-Range` 测试,不通过就自己实现) | `server/uv.lock` |
| Service Worker | 只缓存 `/assets/*` 与 `/vad/*`,API 与媒体一律走网络,不会拦截媒体请求 | `web/public/sw.js` |
| 设置登记 | 每个 `Settings` 字段必须有 `SettingSpec`(测试强制),`GROUPS` 要加组 `("library","跟读库")`;env-only 项用 `_env(...)`;花钱的开关 `danger=_COST` | `core/settings_registry.py`、`core/CLAUDE.md` |
| 每用户配额覆盖 | `core/quotas.py::QUOTA_KEYS` 登记后管理员可按用户覆盖;`library_quota_mb`、`library_max_items` 要加进去 | `core/quotas.py` |
| 每日计数 | `daily_usage(scope, subject, day, count)` 已被各功能当每日上限用(`subject` 是用户 id 或 `*`),识别分钟数用它,**不新增表** | `models.py::DailyUsage` |
| 后台任务约定 | `tests/background.py::_task_sets` 列出所有「响应之后还在跑」的任务集;新 worker 必须把自己的 `pending` 集加进去,`drain_background` 才能等它;共享内存 SQLite 的测试靠这个不炸 | `server/tests/CLAUDE.md`、`tests/background.py` |
| worker 先例 | `agents/memory/worker.py`(队列 + `pending` + 退避 + `join()`)、`rooms/voice.py`(落盘 + `pending/done/failed` + `attempts` + 暂存目录清理 + `metering.bind_user` + `feature_scope`) | 对应文件 |
| 用量归属 | worker 在请求之外跑,必须显式 `metering.bind_user(user_id)` + `feature_scope("library")`;`core/metering.py::FEATURE_PREFIXES` 加 `("/api/library","library")` | `core/metering.py` |
| 删用户 | `admin/users_admin.delete_user` 是显式逐表删除(SQLite 没有 FK 级联),新表与用户目录要加进去,否则留孤儿文件 | `admin/users_admin.py` |
| 段位 | `rank/ledger.py` 把 `source != "chat"` 的评测都算成 `assessment` 类积分;库的跟读用 `source="library"` 会按练习计分,受每日 RP 上限约束,**接受**(不做特殊加成也不排除) | `rank/ledger.py` |
| 练习清单来源 | `practice_items.source` 的 `Literal["chat","lookup","grammar","manual"]`(服务端)与网页 `PracticeItemSource` 都要加 `"library"`;列宽 `String(16)` 够用,不需要迁移 | `routers/practice_items.py`、`practice-items-api.ts` |
| 评测保存的来源 | `routers/speech.py::SOURCES = ("practice","chat")` 要加 `"library"`;`links/daily_tasks.py` 只统计 `source == "practice"`,库的跟读**不计入**今日任务(接受,不改 links) | `routers/speech.py`、`links/daily_tasks.py` |
| 评测限制 | 参考文本 ≤ 2000 字(`MAX_REFERENCE_CHARS`);录音必须 16 kHz 单声道 16 位 WAV(网页有 `toAssessmentWav`);评测保存后计入 `recording_quota_mb` | `services/pronunciation.py`、`web/src/features/practice` |
| 查词入口 | 网页的 `LookupLayer` 只由**文本选区**驱动(`use-text-selection.ts`,容器标 `data-lookup-context`),没有编程入口;`lookup` 的公开面里也没有。所以「点词」= 库在被点的词上用 `Selection.selectAllChildren` 做程序化选区(选区稳定 300 ms 后查词层自动打开),不新增跨 feature 边;iOS 上的表现**未验证**(§13) | `features/lookup/*` |
| 跨 feature 边 | `architecture.test.ts::CROSS_FEATURE_BASELINE` 禁止新增边。库需要 `library->practice`(评测 API、`MobileScoreResult`、`savePracticeItem`),与已有的 `chat->practice` 同理;裁定:**加这一条到基线并在注释写明理由**,别的边一律不加 | `web/src/architecture.test.ts` |
| 文案进主包 | `web/src/i18n/index.ts` 用 `import.meta.glob("../**/i18n/*.json", {eager:true})`,所以各 feature 的文案都在主包里;预算按此计(§11.5) | `web/src/i18n/index.ts` |
| 管理端 | 独立 workspace `admin/`(不是 web 的一部分),`components/layout.tsx` 里有 `DESKTOP_QUERY = (min-width: 1024px)` 和「仅桌面」占位页,导航在 `layout.tsx`、路由在 `app.tsx` | `admin/src/components/layout.tsx` |
| 备份 | `admin/backups.py` 对数据目录文件的引用没有出现在 `data_dir` / `recordings` 检索里,看起来**只备份数据库**;媒体不进备份(可重新导入)。Task 0 读该文件确认,确认后写进 README | `server/app/admin/backups.py` |
| enjoy 上游行为(只参考) | 桌面版:YouTube 用自带 Go 二进制 `youtubedr` 下载到本机缓存(`enjoy/src/main/services/youtubedr.ts`),本地音视频用 ffmpeg 压缩转码(`db/models/audio.ts`),转写由上游服务出 + `echogarden` 对齐成 `timeline`;网页不复用任何一条,**只借鉴**「导入时统一压成易播放的格式」和「句子 = 带时间的时间线」两个想法 | `enjoy/src/main/*` |

## 3. 总体架构

```
上传 (分片) ─┐                                    ┌─ 字幕: 解析 SRT/VTT / 平台字幕
链接 (yt-dlp) ┴→ library_items(queued) → worker ─┼─ 无字幕: ffmpeg 静音检测 → ≤50 s 分块 → 现有识别 → 文本
                     │                            └─ 分句(包装 split_all)→ library_segments(start_ms,end_ms,text)
                     └ 状态/阶段/进度/重试 → 网页轮询(3 s)
播放:  POST media-ticket → GET /api/library/items/{id}/media?ticket= (Range) → <video>/<audio>
跟读:  句子 → 循环播放 → 录音 → 现有 POST /api/speech/assessments (source=library) → POST attempts
```

分层:`library -> core, models, providers, speech, services`;只有 `admin`、`routers`、`main.py` 导入它(`tests/test_architecture.py` 与 `app/CLAUDE.md` 同步更新,**不放宽**测试)。`admin` 的允许列表追加 `library`。

## 4. 数据模型与迁移 `0018_library`

SQLite(batch)与 Postgres 两条路径都要有,带往返测试;`tests/test_migrations.py::test_models_match_migrations` 保持绿。

**`library_items`**

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | `String(36)` PK | uuid |
| `user_id` | FK `users.id` CASCADE,索引 | 所有者;所有查询都带 `user_id`,别人的 id 一律 404 |
| `kind` | `String(8)` | `audio` / `video`(探测后以实际为准) |
| `source` | `String(8)` | `upload` / `link` |
| `title` | `String(200)` | 用户可改;默认取文件名主干或平台标题;**不进日志** |
| `status` | `String(12)` | `uploading` / `queued` / `processing` / `ready` / `failed` / `canceled` |
| `stage` | `String(16)` 可空 | `probe` / `fetch` / `transcode` / `subtitles` / `transcribe` / `segment` |
| `progress` | `SmallInteger` | 0–100,整条流水线的加权进度 |
| `error_kind` | `String(24)` 可空 | 见 §6.6;只存种类,不存上游文本 |
| `attempts` | `Integer` | 自动重试次数 |
| `next_run_at` | `DateTime` 可空 | 退避到期时间 |
| `source_host` | `String(64)` 可空 | 链接的主机名(给管理页),只存主机 |
| `source_url` | `Text` 可空 | 重试要用;**ready 后清空**,失败项在删除或 7 天清理时一起清 |
| `upload_total` / `upload_received` | `BigInteger` | 分片上传进度(上传完成后保留作大小核对) |
| `duration_ms` | `Integer` 可空 | |
| `media_path` | `String(200)` 可空 | 相对数据目录 |
| `poster_path` | `String(200)` 可空 | 视频封面 jpg |
| `media_mime` | `String(32)` 可空 | `video/mp4` / `audio/mp4` / `audio/mpeg` |
| `library_bytes` | `BigInteger` | 媒体 + 封面字节数;配额与管理页都用它 |
| `sub_source` | `String(10)` 可空 | `uploaded` / `platform` / `asr` |
| `asr_seconds` | `Integer` | 实际花在识别上的秒数(用量对账) |
| `seg_count` | `Integer` | |
| `resume_ms` / `resume_idx` / `rate_pct` | `Integer` | 续播位置、所在句、速度(50–125,默认 100) |
| `created_at` / `updated_at` / `last_opened_at` | `DateTime` | 索引 `(user_id, created_at)` |

**`library_segments`**:`item_id` FK CASCADE + `idx` 复合主键,`start_ms`、`end_ms`、`text`(`Text`,≤ 600 字,见 §6.3),以及 D8 增补的 `zh`(`Text` 可空,译文,≤ 1200 字)、`zh_lang`(`String(8)` 可空,译成哪种语言,用户改母语后旧译文视为失效)、`analysis`(`Text` 可空,≤ 4000 字,存模型返回的原文)、`analysis_lang`(`String(8)` 可空)。两列都在 `0018_library` 里一起建(迁移尚未写,不另开迁移)。选独立表而不是 JSON 列:支持按句微调的小更新,且不把几百 KB 的 JSON 读进每次列表查询。

**`library_attempts`**:`id` uuid,`user_id`、`item_id`(FK CASCADE)、`seg_idx`、`assessment_id`(`String(36)`,可空,指向 `assessments.id` 的 SET NULL 语义,**由应用层保证**以兼容 SQLite)、`score`(`SmallInteger` 可空,取评测的发音总分)、`created_at`;索引 `(item_id, seg_idx)`。用来显示「每句最好成绩」。评测与录音本身仍属于现有的练习记录,删库项**不**删它们(用户在历史页自己删)。

**不建任务表。** 理由:同一条目同一时刻只有一个任务;状态、阶段、进度、重试、退避都是条目的属性。这也让「用户删条目 = 取消任务 + 清文件 + 清行」成为一个事务。

**显式删除**:SQLite 没有 FK 级联(`users_admin.delete_user` 的先例),所以 `library.store.delete_item` 与删用户都要显式删 `library_attempts`、`library_segments`、`library_items` 并清目录;`delete_user` 的改动算 S1 的文件(§15)。

## 5. 存储布局、配额与设置

### 5.1 目录(都在 `Settings.resolved_data_dir` 下,路径逃逸检查沿用 `recordings.absolute_path` 的写法,新函数在 `library/paths.py`)

```
library/<user_id>/<item_id>/media.mp4 | media.m4a | media.mp3
library/<user_id>/<item_id>/poster.jpg            # 仅视频
library/_tmp/<item_id>/                           # 分片、下载、WAV 块、chunks.json;完成/取消/失败清理时一并删除
```

- `_tmp` 与成品**同一文件系统**(都在数据卷),完成时 `os.replace` 原子移动。
- 启动时和每日一次清扫 `_tmp`:对应条目不在 `uploading` / `queued` / `processing` 的、或 24 小时没动静的目录删除;`uploading` 超过 24 小时的条目标 `failed(upload_expired)`。
- **规范化后的媒体**:视频已是 H.264 + AAC 的 mp4 就 `-c copy -movflags +faststart` 重封装(秒级),否则转码到 H.264/AAC,最高 `LIBRARY_TRANSCODE_MAX_HEIGHT`(默认 720)、`-preset veryfast`;音频已是 mp3 / m4a(AAC)就原样保留,其余转 AAC 96 kbps m4a。理由:iOS Safari 对 webm / mkv / ogg 的支持不齐,而且统一格式才能让 Range 和 seek 行为可预测。原始上传文件**不保留**。
- 转码速度取决于部署机器,**未测**;时长上限(§5.2)就是为了给它封顶。
- ffmpeg / ffprobe 用 `-nostdin`、`-threads 2`,POSIX 上 `nice 10`,超时 = `max(120, 3 × 时长)` 秒。
- 开始取回 / 转码前检查数据卷剩余空间 ≥ 预计大小的 2 倍,否则 `disk_full`(永久错误)。

### 5.2 新增设置(全部由 S1 一次加完;`Settings` 字段名即环境变量名,默认值给出;热更新的项在后台「跟读库」组里可改)

| 键 | 默认 | 范围 / 类型 | 说明 |
|---|---|---|---|
| `library_enabled` | `false` | bool(功能开关组) | 总开关 |
| `library_asr_enabled` | `false` | bool,`danger=_COST` | 无字幕时是否允许用识别转写(花钱) |
| `library_link_import_enabled` | `false` | bool,`danger` = 「会让服务器访问用户提交的网址并下载内容」 | **链接导入开关(D4)**。关 = `POST /api/library/imports` 返回 404,`config` 里 `link_import: false`,网页不显示链接页签的输入框 |
| `library_quota_mb` | 2000 | 1–1,000,000 | 每人媒体总量上限;加进 `QUOTA_KEYS` 可按人覆盖 |
| `library_max_items` | 100 | 1–10,000 | 每人条目数上限;同样可按人覆盖 |
| `library_max_upload_mb` | 500 | 1–20,000 | 单个上传文件上限 |
| `library_max_duration_minutes` | 90 | 1–600 | 单条时长上限(上传与链接都按探测出的时长检查) |
| `library_asr_minutes_daily_per_user` | 60 | 0–2000 | 每人每天识别分钟数 |
| `library_asr_minutes_global_daily` | 600 | 0–100,000 | 全站每天识别分钟数 |
| `library_imports_daily_per_user` | 20 | 0–1000 | 每人每天新建条目(上传 + 链接)次数 |
| `library_ai_enabled` | `false` | bool,`danger=_COST` | D8:是否允许生成译文与句子分析(调大模型,花钱)。关 = 两类端点 404、`config.ai: false`、网页不显示「译」与「分析」 |
| `library_translate_daily_per_user` | 500 | 0–20,000 | 每人每天生成译文的**句数**(命中已存的译文不计) |
| `library_analysis_daily_per_user` | 30 | 0–1000 | 每人每天句子分析次数(命中已存的不计) |
| `library_ai_daily_global` | 5000 | 0–1,000,000 | 全站每天上述两类合计的句数上限 |
| `library_job_concurrency` | 1 | 1–4 | 同时处理的条目数(ffmpeg / yt-dlp 吃 CPU 与带宽) |
| `library_transcode_max_height` | 720 | 240–1080 | 视频转码与链接取回的最大高度 |
| `library_link_timeout_minutes` | 20 | 1–120 | 单次链接取回的墙钟超时 |
| `library_link_allow_generic` | `false` | bool,`danger` = 「通用抓取器会让服务器请求任意网页」 | 是否允许 yt-dlp 的 `generic` 提取器(见 §7.2 SSRF) |
| `library_ytdlp_cookies_file` | 空 | **env-only**,路径 | cookies 文件(Netscape 格式);**含账号会话,等同密钥** |
| `library_ytdlp_proxy` | 空 | **env-only**,`secret`(可能含账号口令) | 取回时走的代理 |

代码常量(不是设置):分片 8 MiB、每人同时上传 ≤ 2 个、识别块目标 25 s / 上限 50 s、单条自动重试 ≤ 2 次(退避 30 s、120 s)、失败项 7 天后清理、媒体票据 30 分钟 / 全站 ≤ 1000 张、句子字数上限 600。

`Settings` 属性:`library_available`(`library_enabled` 且 `shutil.which("ffmpeg")` 与 `ffprobe`)、`library_asr_available`(`library_asr_enabled` 且 `asr_stream_usable or whisper_fallback_configured`)、`library_link_available`(`library_link_import_enabled` 且能 import `yt_dlp`)。

`config_doctor`(`admin/doctor.py`)新增发现:`library_ffmpeg_missing`、`library_ytdlp_missing`、`library_asr_unavailable`(开了子开关但没配识别)、`library_cookies_missing`(配了路径但文件不在或权限过宽)。

**`.env.example`**:新增一个「跟读库」段,每个键一条中文注释并说明数字含义;链接导入那几行单独写警告(见 §7.4)。

## 6. 处理流水线(后台)

### 6.1 队列与 worker

- `app/library/worker.py::LibraryWorker`:`app.state.library`,在 `lifespan` 里起一个轮询循环(`tasks["library"]`,2 s 一次或被端点 `wake()` 唤醒),按 `created_at` 取 `status='queued' AND (next_run_at IS NULL OR next_run_at <= now)` 的条目,**原子认领**(`UPDATE … WHERE status='queued'` 看影响行数,Postgres 上同样安全),最多 `library_job_concurrency` 个并发,运行中的任务放在 `self.pending`(集合,完成自己移除)。
- 启动恢复:`processing` 的条目 → 回到 `queued`(`attempts` 不加)。进程关停时取消所有任务,条目靠下次启动恢复;`join()` 与 `agents` 的先例一致,关停最多等 2 s。
- **测试约定**:`tests/background.py::_task_sets` 加一项 `library.pending`;worker 的循环本身不放进 `pending`(它按设计一直在睡),测试用 `run_once()` 手动驱动一轮,不在 `app` fixture 里自动起循环。`drain_background` 不得被打破。
- 阶段内每完成一小步就把 `stage` / `progress` 写库(≥ 1 s 或 ≥ 2 个百分点才写,避免写放大)。权重:取回 0–40、转码 40–60、转写 60–95、分句与收尾 95–100;上传类没有取回阶段,转码占 0–50。
- 子进程(`ffmpeg`、`ffprobe`、`yt-dlp`)统一走 `library/media.py::run(cmd, *, timeout, env)`:`create_subprocess_exec`(不经 shell)、环境变量白名单、`stdout` 只解析进度、`stderr` **读完后只分类、不记录**;取消时先 SIGTERM 再 SIGKILL。

### 6.2 阶段

1. **上传(§8)**:`uploading` 状态,分片落到 `_tmp/<id>/upload.part`,完成后核对字节数 → `queued`。
2. **探测**:`ffprobe -v error -show_format -show_streams -of json`,得时长、流、编码。无音频流 → `no_audio`;时长 > 上限 → `too_long`;解析失败 → `corrupt`;全部是永久错误。
3. **取回(仅链接,§7)**。
4. **转码**:规范化(§5.1),写 `library/<uid>/<id>/media.*`,视频再用 `ffmpeg -ss <10%> -frames:v 1 -vf scale=-2:360` 出封面。
5. **字幕**:有上传的字幕或平台字幕 → 解析(§6.3)。
6. **转写**(仅当没有可用字幕,且 `library_asr_available`):§6.4。识别不可用时:状态 `failed`,`error_kind = no_subtitles`,界面提示「这条没有字幕,管理员也没有开启自动转写;可以上传一份字幕后重新导入」。(条目不保留,不占配额的话用户体验很差,所以失败项保留媒体 7 天,**允许用户补传字幕后重试**:`PUT /api/library/items/{id}/subtitles` 把状态改回 `queued`。)
7. **分句与完成**:一个事务里写 `library_segments`、`seg_count`、`sub_source`、`library_bytes`,置 `ready`,清 `source_url` 与 `_tmp`。

### 6.3 字幕解析与分句(`library/subtitles.py`、`library/segment.py`,纯函数,表驱动测试)

**解析**:SRT 与 WebVTT 两种;处理 BOM、`\r\n`、编码(先 UTF-8-sig,再 UTF-16 BOM,再回退 `latin-1` 仅为了不报错;含大量不可打印字符判为二进制 → `bad_subtitle`)、时间戳两种写法(`HH:MM:SS,mmm` / `MM:SS.mmm`)、WebVTT 的 `NOTE` / `STYLE` / `REGION` 块与 cue 设置、`<c>` `<i>` `<b>` `<font>` 与 `{\an8}` 标签、HTML 实体、乱序或重叠的 cue。清洗:去掉 `[Music]`、`(applause)`、`♪`、行首 `- ` 与 `>>`;**含中日韩字符占比 > 50% 的行整行丢掉**(双语字幕只留英文行,不做译文显示,见 §14);平台自动字幕的滚动重复(后一条 cue 以前一条的末行开头)只保留新增尾部。文件上限 2 MiB、cue 上限 20,000。

**分句(E6 的两种输入共用一个函数)**:输入是「带时间的片段」(字幕 cue 或识别块里估算出的片段),输出 `[(start_ms, end_ms, text)]`:
1. 把片段文本按空格连接,同时记录每个片段在连接串里的字符区间。
2. 调 `app.speech.sentence_split.split_all`(**不改它**);按顺序在连接串里推进游标定位每个句子的字符区间(切句器会丢掉没有字母的碎片与首尾空白,游标法能容忍)。
3. 句子的起点 = 包含其首字符的片段的 `start`,终点 = 包含其末字符的片段的 `end`。
4. 后处理(为跟读调的,与切句器无关):**最长 14 秒或 40 个词**,超了就在片段边界处断开,优先断在前后间隔 ≥ 400 ms 的边界;**少于 1 秒或少于 3 个词**的句子与相邻句合并(合并后仍不超限才合);单句文本 ≤ 600 字,再长的在逗号 / 分号处硬切;句与句之间不允许时间重叠(后一句起点不得早于前一句终点)。
5. 无标点的输入(平台自动字幕、部分识别结果):切句器切不出句子时,第 4 步的长度规则兜底,标 `sub_source` 即可,界面不另外提示。
6. 存的是**原始**起止时间;网页播放时再加「提前 150 ms、延后 250 ms」的缓冲(常量,不进库),避免吃头吃尾。

**复用共享夹具(D3)**:`tests/test_library_segment.py` 遍历 `sentence_cases.json` 的全部 64 项,断言(a)整段放进一个片段 → 句子文本与夹具逐项相同;(b)把同一文本在词边界处随机(固定种子)切成 2–6 个片段 → 句子文本仍相同;(c)每个句子的时间落在其覆盖的片段区间内。**夹具与网页切句器都不改**,因此不触发「两边同改」的规矩。

### 6.4 无字幕转写(B 档,E5)

1. `ffmpeg -vn -ac 1 -ar 16000 -f wav` 得到 16 kHz 单声道 WAV(放 `_tmp`,用完删);同时 `silencedetect=noise=-35dB:d=0.35` 得静音区间表。
2. **静音感知分块**:从头贪心,窗口 15–50 s,在窗口内最长的静音区间中点切;窗口内没有静音就在 40 s 处硬切。每块 ≈ 25 s 为目标。这样同一个词很少被切在中间,每块长度也落在三条识别路径都吃得下的范围内。
3. **逐块转写**:`make_transcriber(...)`,并发 ≤ 2(同时受 `shared_asr_gate` 约束,与实时通话、联机语音共用闸门,不抢爆);每块独立重试 2 次;**已完成块的文本写进 `_tmp/<id>/chunks.json`**,自动重试与手动重试从断点继续,**不重复花钱**。
4. **估算句边界**:块内先用静音表扣掉首尾静音得到语音区间 `[s0, s1]`;块文本过切句器得句子;句边界按「字符累计占比」映射到 `[s0, s1]`,再各自吸附到 ±0.8 s 内最近的静音区间中点(没有就不吸附)。块与块的边界本来就在静音处,所以不会累积漂移。
5. **预期精度**:每个句边界误差大致在零点几秒量级,**这是估算,不是实测**;合计精度要在 spike S1 用真实样本测量并写进结果文档。界面给每句 ±0.2 s 的起止微调(§11.4),并允许改句子文字(纠正听错的词,≤ 600 字)。
6. **A 档(可选增强)**:spike S1 若证明识别上游能稳定返回带时间的片段(火山 `show_utterances` 的 `utterances`、Whisper `verbose_json` 的 `segments`),则 `asr.py` 追加一个并列函数(例如 `transcribe_timed`)返回 `[(start_ms,end_ms,text)]`,流水线把它的输出当作「字幕 cue」直接进 §6.3,`sub_source` 仍记 `asr`;B 档保留为回退。**改 `speech/` 属于 S1 的文件范围**,且要保持 `asr.py` 现有函数与测试不变。
7. 计费:开始转写前在 `daily_usage` 里按「秒」预留(`scope="library_asr"`,`subject` = 用户 id 与 `*`),超出每人 / 全站每日上限 → `quota`(永久错误,次日可重试);永久失败时把**未实际转写的块**对应秒数退还(与 rooms voice 上游失败退还同一思路);`asr_seconds` 记实际值。上游调用的计量由 `asr` 层已有的 `metering.record` 完成,worker 只负责 `bind_user` + `feature_scope("library")`。

### 6.5 重试与取消

- **自动重试**:只对瞬时错误(`upstream`、`network`、`ytdlp_transient`),最多 2 次,退避 30 s、120 s(写 `next_run_at`);永久错误不自动重试。
- **手动重试**:`failed` 的条目 `POST …/retry` → `queued`,`attempts` 清零;阶段性产物(已下载的文件、`chunks.json`)还在 `_tmp` 里就接着用。
- **取消**:`POST …/cancel`(`queued` / `processing` / `uploading` 可用)→ 终止子进程、清 `_tmp`、条目标 `canceled`(保留行 7 天以便界面反馈,随后清理);用户也可以直接删除条目,删除隐含取消。

### 6.6 错误种类(`error_kind`,英文常量,网页用映射表翻成中文,服务端返回的错误文本沿用项目约定 `LIBRARY_SERVER_ERRORS`)

永久:`too_large`、`too_long`、`quota`、`corrupt`、`no_audio`、`bad_subtitle`、`no_subtitles`、`disk_full`、`unsupported_format`、`upload_expired`;链接专属:`link_disabled`、`bad_url`、`drm`、`private`、`geo_blocked`、`login_required`、`blocked`(站点拒绝服务器,常见于机房 IP)、`playlist_unsupported`、`live_unsupported`、`unsupported_site`、`ytdlp_failed`;瞬时:`upstream`、`network`、`ytdlp_transient`。yt-dlp 的标准错误输出用一张**固定的正则表**映射到上面的种类(不匹配的归 `ytdlp_failed`),然后丢弃。

## 7. 链接导入(yt-dlp,`LIBRARY_LINK_IMPORT_ENABLED` 控制)

### 7.1 流程

`POST /api/library/imports {url, title?}` → 校验开关与限额 → 同步做 URL 预检(§7.2)→ 建条目 `queued`,**立刻返回**(不在请求里跑 yt-dlp)。worker 的取回阶段:
1. `yt-dlp --dump-single-json --no-playlist --skip-download` 得标题、时长、是否直播、`_type`、字幕清单 → 直播 `live_unsupported`、`_type == playlist` `playlist_unsupported`、时长超限 `too_long`(都在下载前判定,不浪费流量)。
2. 下载:格式 `bv*[height<=H][ext=mp4]+ba[ext=m4a]/b[height<=H]/b`(H = `library_transcode_max_height`,纯音频页面退成 `ba`),`--max-filesize` = `library_max_upload_mb`,`--socket-timeout 15`,`--retries 3`,`--no-playlist --no-part --no-mtime`,输出模板固定为 `_tmp/<id>/dl.%(ext)s`(不用站点给的文件名)。
3. 字幕:先要人工字幕 `--write-subs --sub-langs "en.*,en"`;**没有人工字幕且识别可用**就不下自动字幕、交给 §6.4;识别不可用才加 `--write-auto-subs`(E6)。字幕转成 `srt`(`--convert-subs srt`)再进 §6.3。
4. 失败分类见 §6.6;其余字符串一律不记。

### 7.2 SSRF 与子进程安全

用户提交的网址由**服务器**去请求,这是本功能最大的攻击面,按以下层次防护,**剩余风险明说**:
- 预检(`library/urlcheck.py`,自己写,不导入 `admin/probes.py`,因为分层不允许 library 依赖 admin):只收 `http` / `https`,不带用户信息,主机名解析出的**每个地址**都必须是全局地址(拒绝回环 / 私网 / 链路本地 / 元数据地址),长度 ≤ 2000。预检通过只代表提交时的状态;**DNS 重绑与站点重定向到内网仍可能绕过**,所以:
- 默认**关掉 `generic` 提取器**(`--use-extractors "default,-generic"` 一类参数,精确语法以锁定的 yt-dlp 版本为准,Task 0 验证;`library_link_allow_generic` 打开才放开),这样只剩对具体站点的提取器,它们只访问各自的域名。
- 子进程环境变量白名单:只有 `PATH`、`HOME`(指向本条目的 `_tmp`)、`LANG`,以及代理(从 `library_ytdlp_proxy` 注入);**不继承任何 `UPSTREAM_*`、`*_KEY`、`ADMIN_*`、`DATABASE_URL`**;`--ignore-config --no-plugin-dirs`,不允许 `--exec`;输出路径固定在 `_tmp`。
- cookies 文件:每次任务**复制**到 `_tmp` 里再传 `--cookies`(yt-dlp 会回写 cookie jar),任务结束删除副本;原文件只读使用;文件权限比 `0600` 宽时 doctor 报 `library_cookies_missing` 一类的警告。
- 请求不带用户的令牌;yt-dlp 联系的是目标站点(这是导入链接本身的性质),网页端**永远不**请求第三方(`CLAUDE.md` 的安全规则成立)。

### 7.3 yt-dlp 在容器里

- **依赖**:`yt-dlp` 作为 Python 依赖写进 `server/pyproject.toml` 并锁进 `uv.lock`(S2 的文件)。YouTube 经常改版,需要定期升级:重新 `uv lock --upgrade-package yt-dlp` 后重建镜像。**不做应用内自动更新**(镜像是只读式部署,且自动下载并执行外部代码违反本仓库的安全立场)。管理页显示当前 yt-dlp 版本。
- **ffmpeg**:`Dockerfile` 最终阶段以 root 执行 `apt-get install -y --no-install-recommends ffmpeg`(含 `ffprobe`),再 `USER app`(S1 的文件)。镜像增大多少**未测**,Task 0 记录前后体积;上传类功能也要 ffmpeg,所以无条件安装。
- **YouTube 的 JS 运行时**:近期的 yt-dlp 在解 YouTube 的签名挑战时可能需要外部 JS 运行时(如 deno / node);我对确切要求与版本**没有在本仓库核实**,S2 Task 0 必须在锁定的版本上实测一遍「不装运行时能不能下」,不能则把所需运行时加进镜像并记录体积。
- **机房 IP 被拦**:YouTube 等站对数据中心 IP 常返回「请登录确认你不是机器人」一类拒绝(`blocked` / `login_required`)。可选对策,**都不默认开启**:(a) `LIBRARY_YTDLP_COOKIES_FILE`(从浏览器导出的 cookies;务必用**专门的小号**,用主账号有被平台限制的风险);(b) `LIBRARY_YTDLP_PROXY`(住宅代理);(c) 放弃链接,改为在本机下载后**上传文件**——这是最稳的路。界面对 `blocked` 的文案要把 (c) 列在第一位。
- `docker-compose.example.yml` 里加一段注释掉的 cookies 只读挂载示例(S2)。

### 7.4 DRM 与界面明示(D4)

yt-dlp **不支持也不会绕过 DRM**。导入页的链接页签与 `drm` 错误都必须写明:

> 支持 yt-dlp 能直接下载的公开视频页面(如 YouTube 等)。受 DRM 保护的流媒体服务(Netflix、Disney+、爱奇艺、腾讯视频、优酷、Spotify 等)**无法导入**,请使用你自己拥有的文件上传。

`drm` 的判定:yt-dlp 的提示里含 DRM 字样(固定正则),或探测得到的所有格式都标了 DRM;命中即永久失败,不重试。导入开关关闭时,页签显示「管理员没有开启链接导入」。这段文案在 `features/library/i18n/{en,zh-CN}.json`,中英文都要有。

## 8. 上传(分片、可续传)

| 步骤 | 端点 | 说明 |
|---|---|---|
| 1 开始 | `POST /api/library/uploads` `{filename, size, title?}` | 校验开关、扩展名白名单(`mp4 m4v mov webm mkv mp3 m4a aac wav ogg opus flac`)、`size ≤ library_max_upload_mb`、配额(已用 + size ≤ `library_quota_mb`)、条目数、每日次数、同时上传 ≤ 2;建 `uploading` 条目,返回 `{item_id, chunk_bytes: 8388608}`。文件名只用来取扩展名和默认标题,**不落盘、不记日志** |
| 2 传片 | `PUT /api/library/uploads/{item_id}/chunks/{n}`(multipart,字段 `chunk`) | 单片 ≤ 8 MiB;`n` 必须等于 `upload_received // chunk_bytes`(补传已收下的同一片、长度相同 = 幂等成功);读取时流式限长,超限 413;**不经** `limited_user` 的每分钟限流(500 MB ≈ 63 片),靠「同时上传 ≤ 2」和配额封顶 |
| 2′ 查进度 | `GET /api/library/uploads/{item_id}` | 返回 `{upload_received, upload_total}`,断网后据此续传(浏览器刷新后拿不到 `File` 对象,只能在同一会话内续传;刷新后界面提示「请重新选择同一个文件继续」,按文件名 + 大小匹配) |
| 3 字幕(可选) | `PUT /api/library/uploads/{item_id}/subtitles`(multipart,字段 `file`,≤ 2 MiB) | `.srt` / `.vtt`;立即解析校验,失败 `bad_subtitle`;成功则记为 `uploaded` 字幕 |
| 4 完成 | `POST /api/library/uploads/{item_id}/complete` | 核对 `upload_received == upload_total`,移动到 `_tmp/<id>/in.<ext>`,状态 → `queued`,唤醒 worker |

## 9. API(只追加;均要求登录,开关关时除 `config` 外 404)

`routers/library.py`(S1)、`routers/library_import.py`(S2,仅 `POST /imports`)、`routers/admin_library.py`(管理端车道)。必须排在 `stubs` 之前。**URL 里只有 uuid 与序号,不出现标题、URL、文字**;错误文本是固定的英文字符串。

| 方法与路径 | 说明 |
|---|---|
| `GET /api/library/config` | `{enabled, link_import, asr, limits:{max_upload_mb, max_duration_minutes, quota_mb, used_bytes, max_items, chunk_bytes, formats[]}}`;`link_import` = 总开关 ∧ 链接开关 ∧ yt-dlp 可用 |
| `GET /api/library/items?cursor=` | 列表:`{id, kind, source, title, status, stage, progress, error_kind, duration_ms, seg_count, library_bytes, sub_source, resume_ms, rate_pct, created_at, last_opened_at}` |
| `GET /api/library/items/{id}` | 详情 + 全部句子 `[{idx,start_ms,end_ms,text}]`(2 小时素材约一两千句,一次返回) |
| `PATCH /api/library/items/{id}` | `{title?, resume_ms?, resume_idx?, rate_pct?}`,逐键校验;续播位置的更新按「≥ 5 s 一次」由网页节流 |
| `DELETE /api/library/items/{id}` | 取消任务、删文件、显式删子表与行 |
| `POST /api/library/items/{id}/retry`、`/cancel` | §6.5 |
| `PUT /api/library/items/{id}/subtitles` | 为 `failed(no_subtitles)` 或任何 `ready` 条目补传 / 替换字幕(替换会重新分句;`library_attempts` 里的旧记录按 `seg_idx` 保留,不迁移、不删除,界面只显示文本仍一致的句子的成绩,细节由 S1 计划裁定) |
| `PATCH /api/library/items/{id}/segments/{idx}` | `{start_ms?, end_ms?, text?}`;起止必须仍在媒体时长内且不与相邻句重叠;文本 ≤ 600 字、必须含字母 |
| `POST /api/library/items/{id}/media-ticket` | `{url, expires_in}`;仅 `ready` |
| `GET /api/library/items/{id}/media?ticket=` | 媒体字节,支持 `Range`(206 / 416 / `If-Range`),`Accept-Ranges: bytes`,`Cache-Control: private, no-store`,`Referrer-Policy: no-referrer`,`Content-Type` = `media_mime`;**不走 Bearer**,只认票据(票据 ↔ 用户 + 条目 + 过期;每次请求还要核对条目仍存在、状态 `ready`、用户未被停用) |
| `GET /api/library/items/{id}/poster` | 封面 jpg,走 Bearer(网页用 blob 取) |
| `POST /api/library/items/{id}/translate` | D8:`{indices: [int, ≤ 20], native_language}` → `[{idx, zh}]`;已存且语言一致的直接返回,其余批量调大模型后写回;超额度时**已有的照常返回、缺的不生成**并带 `limited: true`;`library_ai_enabled` 关 404;`limited_user` 限流,并计入 `metering`(前缀 `library_translate`) |
| `POST /api/library/items/{id}/segments/{idx}/analysis` | D8:`{native_language}` → `{analysis, cached}`;命中直接返回;额度满 429(固定英文文案);`metering` 前缀 `library_analysis` |
| `POST /api/library/items/{id}/attempts` | `{seg_idx, assessment_id}`:服务端核对该评测属于本人、`source == "library"`、参考文本与该句文本一致,再记 `score` |
| `GET /api/library/items/{id}/attempts` | `[{seg_idx, best_score, count, last_at}]` |
| 上传 5 个端点 | §8 |
| `POST /api/library/imports` | `{url, title?}` → 条目;开关关 404;错误 `bad_url` 等 |

`routers/speech.py` 追加 `library` 作为合法 `source`(只此一行改动);`routers/practice_items.py` 的 `source` 追加 `library`。

**限流**:创建类端点(`uploads` 开始、`imports`)走 `limited_user`(每人每分钟 `ai_rate_limit_per_minute`)并扣每日 `library_imports_daily_per_user`;`media-ticket` 走 `limited_user`;分片与媒体读取不走每分钟限流(见 §8、§10)。

**契约夹具** `server/tests/fixtures/library_contract.json`:由 `test_library_contract.py` 录制(`CONTRACT_UPDATE=1`),网页 `library-contract.test.ts` 逐键校验(与 `rooms_contract.json` 同一做法)。

## 10. 媒体服务(Range 与鉴权)

- 票据存在进程内 `MediaTicketStore`(随机 32 字节 urlsafe,多次可用,30 分钟,全站 ≤ 1000 张,满了淘汰最老的;重启即失效)。网页在 `<video>` 收到 401 / 403 / 404 时重新取票并保持 `currentTime` 重设 `src`。
- 响应由 Starlette `FileResponse` 提供(E4 的核对项:先用测试证明它的 Range 行为正确;不正确就自己实现单区间 Range,多区间一律返回整段或 416)。iOS Safari 对媒体**必须**支持 `206` 才能 seek 与循环,这是硬要求,有测试覆盖(`bytes=0-1`、`bytes=100-`、`bytes=-500`、越界 416、`If-Range`)。
- 读取不扣额度、不限每分钟次数;但每次读取前核对条目(一次主键查询),停用用户或已删除条目立刻 404。
- 反向代理文档(`server/README.md`)补充:`/api/library/` 需要 `proxy_buffering off`(或至少允许 Range 透传)、`proxy_request_buffering off` 与足够的 `client_max_body_size`(≥ 9 MiB 即可,因为是分片)。

## 11. 网页(`web/src/features/library/`)

### 11.1 路由与入口

`/library`(列表)、`/library/:id`(播放器与跟读),在 `app.tsx` 里用 `React.lazy` 懒加载;添加素材用列表页里的底部弹层(上传 / 链接两个页签),不单独路由。入口是底部导航里的独立标签(E9)。`GET /api/library/config` 的 `enabled` 为假时标签不渲染,直接访问路由则跳回 `/practice`(与 `LinkRoute` 的行为一致)。

### 11.2 列表页

卡片:封面(视频,经 blob 懒取)或音频图标、标题、时长、句数、字幕来源徽标(上传 / 平台 / 自动识别)、大小;处理中的卡片显示阶段与进度条(每 3 秒轮询,页面不可见时停);失败卡片显示本地化的原因与「重试 / 补传字幕 / 删除」,`drm` / `blocked` 用专门文案(§7.3、§7.4);删除要二次确认。页头显示「已用 X / 配额 Y」。

### 11.3 添加素材

- **上传页签**:选文件(`accept` 按白名单)、可选字幕文件、标题;进度条 + 取消;分片逐片串行上传,失败自动重试同一片 3 次;离开页面前提示。大文件上传时保持屏幕常亮不在范围内。
- **链接页签**:输入框 + 提交;§7.4 的文案常驻显示;开关关时只显示说明。提交后回到列表,新卡片进入处理中状态。

### 11.4 播放器与跟读页

布局(手机优先):顶部固定媒体区(视频 16:9,`playsInline`;音频显示封面图标与波形占位,不做波形),下面是**句子列表**(当前句高亮并自动滚到可视区,用户手动滚动 3 秒内不抢滚动),底部是控制条。
- **播放控制**:上一句 / 播放暂停 / 下一句;**单句循环**(关 / 无限 / 3 次 / 5 次);**速度** 0.5、0.75、1、1.25(每条目记住,存 `rate_pct`;库内自己设置 `preservesPitch`,不动全局 `PLAYBACK_RATES`,那是给 TTS 用的);**盲听**(隐藏句子文字,点一下显示);点句子 = 跳到该句并播放。
- **精确循环**:`timeupdate` 只有约 250 ms 粒度,循环用 `requestAnimationFrame` 轮询 `currentTime`,到 `end + 250 ms` 就 `currentTime = start - 150 ms`。iOS 的 seek 精度与卡顿**未验证**(§13)。
- **跟读**(车道 W2):句子右侧的麦克风按钮 → 先暂停媒体(录音与播放**不并行**,避免 iOS 音频路由冲突)→ 用 `~/audio/use-recorder` 录音(在用户手势内调用 `getUserMedia`)→ `toAssessmentWav` → 现有 `POST /api/speech/assessments`(`source=library`,`save=true`,参考文本 = 句子文本)→ 在该句下展开 `MobileScoreResult`(发音总分 + 逐词着色)→ `POST attempts`。同时提供「听我的录音 ↔ 听原句」对比;评测不可用或额度满时给现有的错误文案(`PRACTICE_SERVER_ERRORS`)。句子超过 2000 字不可能出现(§6.3 上限 600)。
- **点词查词**:每个词渲染为带 `data-lookup-context` 的句子容器里的 `<span>`;点按时用 `Selection` 程序化选中该词,300 ms 稳定后现有 `LookupLayer` 打开(无新跨 feature 边,§2.2);选区的上下文就是整句。查词面板里已有 `<WordActions>`(加词汇本等联动),无需额外实现。
- **双语(D8)**:控制条里的「译」开关(记在本机 `localStorage`,按条目)打开后,每句下方显示小一号的中文译文(`lang` 按母语,`text-ink-2`);打开时按 E12 批量取视野附近的译文,取到之前显示骨架行,失败或额度满显示一次固定提示而不是逐句报错;盲听模式下译文同样隐藏。
- **每句「更多」菜单(D8)**:句子右侧话筒旁的 ⋯ 按钮展开:**复制句子**(只在网页端,`navigator.clipboard`,失败回退选中文本)、**AI 分析**、**加入练习清单**、**微调**。**AI 分析**在该句下展开一张卡片:加载中显示骨架,完成后按桌面端 `analyze` 提示词规定的分节(句子结构、语法、词汇与短语)分段显示;卡片可收起,已生成的分析再次展开不再请求;失败有「重试」。分析不会自动触发,也不预取。
- **加入练习清单**:每句一个星标按钮 → `savePracticeItem(api, t, text, "library")`;已加入过的不去重(服务端本来也不去重,沿用)。
- **微调**:每句的「编辑」展开面板:起点 / 终点各 ±0.2 s 按钮、修改文字;保存走 `PATCH segments`。
- **续播**:进入时 `seek(resume_ms)` 并滚到 `resume_idx`;播放中每 5 s、暂停、页面隐藏(`visibilitychange`)与卸载时保存(用 `fetch` 的 `keepalive: true`,因为 `sendBeacon` 带不了 Bearer)。
- **错误与边界**:票据过期自动换票;处理中的条目只显示进度;`failed` 的条目不进播放器。

### 11.4a 视觉与动效(D11)

- **依据**:`mockup-glass.html`(深色为默认展示,玻璃参数:模糊 34px、饱和 200%、深色填充 rgba(150,170,255,.10) / 强面 .17、内高光边 .26,浅色填充 .38 / .55)。具体数值由实现者从稿中取,偏离要写 Ruling。
- **范围**:样式与小组件只放在 `features/library/` 内(`library.css` 随懒加载块进入,不进主包);**底部标签栏沿用全站现有的 `GlassTabBar`,不改**;不动 `theme.css` 的全局令牌,只新增库内作用域的 CSS 变量(`.library-root` 上定义)。深浅色跟随 `html.dark`(D12 的「外观」设置或系统),库页面不另设开关。
- **12 个效果**(自写,**不引入 reactbits 或任何新 npm 依赖**):GlassSurface、SoftAurora(纯 CSS 色块,**不用 WebGL**)、SpotlightCard、SpecularButton、ShinyText、Stepper、BorderGlow、GradualBlur、ElasticSlider、CountUp + GradientText、ClickSpark、BlurText。
- **性能与无障碍(硬规则)**:一屏模糊层 ≤ 3(播放器:顶栏、渐进模糊、控制条);列表卡片只用半透明填充 + 高光边,不加 `backdrop-filter`;沿用现有 `glass-quality.ts` 的低端机 `.lite`(去模糊、去动画、玻璃退为实色);`prefers-reduced-motion` 时全部静止;动画只用 `transform` / `opacity` / `background-position`(不触发布局);`@property` 旋转描边在不支持的浏览器上退化为静态描边。iOS Safari 需 `-webkit-backdrop-filter`。
- **测试**:降级与减少动态效果有样式源码断言;组件逻辑(ElasticSlider 吸附、CountUp 终值、BlurText 逐字、ClickSpark 清理)有单元测试;**真机的模糊性能、耗电、旋转描边表现标「未验证」**。
- **体积目标**(非实测):库内样式 + 小组件 gzip ≤ 6 kB,全部在懒加载块里;主包增量 ≤ 0(不新增)。

### 11.5 文案、体积与测试

- 文案:`features/library/i18n/{en,zh-CN}.json`(自动合并,不改 `i18n/index.ts`),服务端错误映射表 `LIBRARY_SERVER_ERRORS`。
- **体积预算(目标,不是已测数字)**:主包 gzip 增量 ≤ 1.5 kB(代码 ≤ 0.5 kB:两条懒路由 + 底部标签与 `useLibraryEnabled`;文案 ≤ 1.0 kB,因为文案是 eager 进主包的,见 §2.2);列表页、添加弹层、播放器、跟读面板全部在懒块里,懒块 gzip 目标 ≤ 40 kB 并在结果文档里报告实数;不引入新的 npm 依赖(不做虚拟列表库,用 `content-visibility: auto` + 按需渲染逐词 `span`)。基线以计划 P0 用 `node web/scripts/check-main-bundle.mjs --record` 重录为准,合并后报告前后数字。
- 测试:API 客户端与分片上传(`MockTransport`/fetch 假实现)、列表轮询与状态呈现、播放器状态机(循环、速度、续播)用假的 `HTMLMediaElement`、跟读流程、点词选区、契约、架构测试(`CROSS_FEATURE_BASELINE` 只多一条 `library->practice`)、中英文文案键一致性。

## 12. 管理端(`admin/`,仅桌面)

- 服务端:`admin/library_admin.py`(查询与动作)、`routers/admin_library.py`(`/api/admin/library/*`):`overview`(条目数、总字节、按状态计数、队列长度与运行数、今日识别分钟 / 全站上限、yt-dlp 与 ffmpeg 版本、链接开关与 cookies 是否已配置〔只给「已配置 / 未配置」〕)、`items`(分页 + 筛选:状态、所有者、种类;**每行**:用户名、种类、状态、阶段、时长、字节数、字幕来源、来源主机名、创建时间;**不含标题 / URL / 文字**)、`top_users`(按占用字节)、`delete`(单条删除,审计 `library.item.delete`,只记条目 id 与字节数;**操作员角色 + 输入确认**,不需要 step-up)、`cancel`、`purge_failed`(清理所有失败项,审计只记数量)。所有写操作经 `perms.require(...)`,与其他管理动作同一审计链。
- 网页:`admin/src/features/library/{api.ts, library-page.tsx, strings.ts, index.ts}`;`components/layout.tsx` 加导航项(`min: "viewer"` 可看,删除按钮要 `operator`),`app.tsx` 加路由;窄屏沿用现有「仅桌面」占位页。「设置」页自动出现「跟读库」组,不另写。
- 用户详情页(`user-detail-page.tsx`)显示该用户的库占用,并复用现有的配额覆盖面板设置 `library_quota_mb` / `library_max_items`。

## 13. 隐私、验证与未验证

**隐私硬规则**
- 日志、错误、`timing` 行、审计、`metering` 里**绝不出现**:标题、文件名、URL、字幕与转写文字、yt-dlp / ffmpeg 的标准错误、cookies、代理地址、票据。允许出现:条目 id、用户 id、阶段名、`error_kind`、退出码、字节数、毫秒数、块数。
- `tests/test_library_privacy.py`(仿 `test_agents_privacy.py`):`caplog` 限定 logger `app`,覆盖库的每个端点、worker 的成功 / 失败 / 重试路径(用假的 ffmpeg / yt-dlp / 识别)、票据请求的访问日志行;并断言库的路由 URL 里没有文字(新增路由必须加进这个测试)。
- D8:句子文字会发给**已配置的大模型上游**生成译文与分析(与现有聊天、翻译同一信任边界,README 隐私一节补一句);`test_library_privacy.py` 覆盖 `translate` 与 `analysis` 端点与失败路径,断言日志里没有句子文字与译文,`metering` 只记前缀与句数。
- 用户媒体的音频会作为识别块发给**已配置的识别上游**(与现有语音功能同一信任边界),这一点在 README 的隐私一节写明;网页端不请求任何第三方,链接导入只在服务端发生。
- 管理员看不到内容(E10);删除用户 = 删除其全部库文件与行。

**已验证(读代码)**:§2.2 全表。

**必须由测试证明(计划里的验收)**:迁移往返与模型一致;Range 行为;分片上传的幂等 / 续传 / 超限;字幕解析的表驱动用例与 64 个夹具;分块与边界估算的纯函数用例;worker 的认领、恢复、重试、取消与 `drain_background`;配额、每日上限、开关关闭时的 404;隐私测试;架构测试;网页各项;管理端各项。

**未验证,计划完成后要在结果文档里逐条写「已做 / 未做」**:识别上游是否返回时间戳(spike S1)与 B 档边界的真实误差;ffmpeg 转码在部署机器上的速度和镜像体积;yt-dlp 在**你的服务器**上下载 YouTube 能否成功(机房 IP、JS 运行时);iOS Safari 上的 Range seek、单句循环精度、录音与播放的音频路由切换、程序化选区触发查词的表现;大文件(数百 MB)在手机网络上的分片上传稳定性;反向代理(Nginx / Caddy / Cloudflare)对分片与 Range 的实际行为;真实评测上游的额度。**没有真机 / 真上游运行过的一律写「未验证」,不得编造数字。**

## 14. 不做

公开分享或跨用户共享、离线下载 / PWA 缓存媒体、字幕翻译的**并排双栏视图**(D8 只做「句下一行」)、**D10 的第二期清单**(录音管理页、转写稿下载与打印、每句笔记、重新识别、单句音频下载、素材 AI 摘要、音标显示)、波形图与拖动区域、快捷键、播放列表 / 频道批量导入、直播与录屏、**绕过 DRM**、应用内自动更新 yt-dlp、说话人分离、强制对齐到词级时间戳、视频剪辑与导出、非英语素材、与桌面版 `enjoy` 数据的同步或迁移、把 SSRF 检查抽到 `core/`(两处各自实现,以后再合并)、给库的跟读单独的段位加成或排除、改共享切句夹具或网页切句器、按用户限制可用的链接站点名单。

## 15. 计划拆分、文件归属与合并顺序

**Task 0 / spike(各计划各自的第一步,结果写进 `plans/2026-10-13-video-import-results.md`)**:
- S0(S1 车道):`alembic heads`、Range 测试、`backups.py` 确认、镜像加 ffmpeg 前后体积。
- **S1(spike,先于 S1 的转写任务)**:用真实识别上游、两段真实英语素材(各约 1 分钟)验证:火山 `show_utterances` 与 Whisper `verbose_json` 是否返回带时间的片段、字段形状、B 档边界误差;花费很小,需要上游有余额。
- S2(S2 车道):在锁定的 yt-dlp 版本上验证 `--use-extractors` 语法、YouTube 是否需要 JS 运行时、在目标服务器上的真实下载。

| 计划 | 文件 | 拥有的文件(一个文件只有一个所有者) | 内容 |
|---|---|---|---|
| **S1 服务端 数据与任务** | `plans/2026-10-13-video-import-server-core.md` | `alembic/versions/0018_library.py`、`app/models.py`(追加三张表)、`app/core/config.py`、`core/settings_registry.py`(含 `GROUPS`)、`core/quotas.py`、`core/metering.py`(前缀)、`server/.env.example`、`server/Dockerfile`(ffmpeg)、`app/library/{__init__,paths,store,limits,errors,tickets,worker,pipeline,media,subtitles,segment,asr_chunks}.py` 与 `CLAUDE.md`、`routers/library.py`、`routers/speech.py`(一行 `source`)、`routers/practice_items.py`(一行 `source`)、`app/speech/*`(仅当 S1 spike 通过且只追加 A 档函数)、`main.py`(lifespan + 路由,含 admin 路由的锚点注释)、`admin/users_admin.py`(删用户一处)、`tests/test_library_*.py`、`tests/background.py`、`tests/test_architecture.py`、`fixtures/library_contract.json`、`app/CLAUDE.md`、`routers/CLAUDE.md`、`server/README.md`(隐私与代理一节) | §4–§6、§8–§10 的服务端、设置、契约夹具;`pipeline.fetch` 阶段只留一个接口(`FetchStage` 协议),默认实现抛 `unsupported_site` |
| **S2 服务端 链接导入** | `plans/2026-10-13-video-import-server-import.md` | `app/library/{ytdlp,urlcheck}.py`、`routers/library_import.py`、`server/pyproject.toml` 与 `uv.lock`、`docker-compose.example.yml`(注释示例)、`tests/test_library_ytdlp.py`、`tests/test_library_urlcheck.py` | §7 全部:预检、yt-dlp 子进程、错误分类、DRM 判定、cookies / 代理、`FetchStage` 的真实实现并注册;不碰 S1 的文件 |
| **W1 网页 库与播放器** | `plans/2026-10-13-video-import-web-library.md` | `web/src/features/library/` 下除 W2 文件外的全部(`library-api.ts`、`upload-client.ts`、`library-list-page.tsx`、`add-sheet.tsx`、`import-form.tsx`、`player-page.tsx`、`use-media-player.ts`、`segment-list.tsx`、`resume.ts`、`register.tsx`、`index.ts`、`i18n/*`、`CLAUDE.md`、`library-contract.test.ts`)、`web/src/app.tsx`(路由)、`web/src/plugins/`(注册)、`web/README.md`、`web/scripts/main-bundle-baseline.json`(P0 重录) | §11.1–§11.3、播放 / 循环 / 速度 / 续播 / 盲听;`player-page.tsx` 引用 `shadow-panel.tsx`(W1 先放一个返回 `null` 的占位,**之后归 W2**) |
| **W2 网页 跟读与评测** | `plans/2026-10-13-video-import-web-shadow.md` | `features/library/{shadow-panel,use-shadowing,attempts-api,word-tap,save-sentence,segment-editor}.tsx/.ts`、`features/practice/practice-items-api.ts`(`PracticeItemSource` 加 `library`)、`features/practice/assessment-api.ts`(`source` 类型)、`web/src/architecture.test.ts`(基线加 `library->practice` + 理由注释) | §11.4 的跟读、点词、加入练习清单、微调、成绩展示 |
| **A 管理端** | `plans/2026-10-13-video-import-admin.md` | `app/admin/library_admin.py`、`routers/admin_library.py`、`admin/doctor.py`(四个发现)、`tests/test_admin_library.py`、`admin/src/features/library/*`、`admin/src/components/layout.tsx`、`admin/src/app.tsx`、`admin/src/pages/user-detail-page.tsx`(占用显示)、`app/admin/CLAUDE.md` | §12 |
| **Z 收尾** | `plans/2026-10-13-video-import-INDEX.md`、`-results.md` | 根 `README.md` 与 `web/README.md` 的功能与「未验证」一节、`docs/` 结果文档、`web/scripts/main-bundle-baseline.json` 终录 | 联调、体积与测试数字、`docker compose build` 实测镜像、真机清单、把 §13 的「未验证」逐条填结果 |

**D8 增补的归属(各计划需追加 Addendum,不要重写)**:
- **S1**:迁移 `0018` 的 `zh` / `zh_lang` / `analysis` / `analysis_lang` 四列、§5.2 的四个新设置与 `library_ai_available` 属性、新文件 `app/library/ai.py`(批量译文与分析的编排、额度、提示词渲染,大模型只经 `providers/llm.py`)、`routers/library.py` 里 `translate` 与 `analysis` 两个端点、`PATCH segments` 改文字时清 `zh` / `analysis`、契约夹具与隐私测试扩充、`GET config` 的 `ai` 字段、提示词注册(`services/prompts.py`)。
- **W1(含入口标签,E9 与外观设置,D12)**:`web/src/settings/*`(新增 `colorScheme: "system" | "light" | "dark"`)、`layout/color-scheme.ts`(读设置)、「我的」里的设置行及文案与测试、`web/src/layout/bottom-nav.tsx` 与其测试(`layout.test.tsx` 的标签断言)、`web/src/layout/CLAUDE.md`、`features/library/use-library-enabled.ts`、文案 `web.nav.library`(取代 `register.tsx` 与 `practiceHome`;计划里相关任务作废);`segment-list.tsx` 渲染译文行(只读 `segment.zh`)、控制条「译」开关、`library-api.ts` 的 `translate` / `analysis` 调用与类型。
- **W2**:新文件 `segment-menu.tsx`(⋯ 菜单与复制)、`analysis-card.tsx`、`use-translations.ts`(视野附近批量取、去重、失败处理);`shadow-panel` 不变。
- **A 管理端**:设置页自动出现新设置,无额外工作;`overview` 增加今日译文 / 分析句数。
- 第二期清单(D10)不进任何本期计划。

**合并顺序**:**S1 →(S2 ‖ A 服务端 ‖ W1)→ W2 → A 网页 → Z**。
- S1 先合,因为它冻结表结构、设置与契约夹具;之后 S2、A 的服务端部分、W1 互不依赖,可并行(W1 读 S1 录制的契约夹具;S2 只需要 `FetchStage` 接口)。
- W2 在 W1 之后(它替换 W1 的占位文件、改 `architecture.test.ts`);A 的网页部分在 A 服务端之后。
- `main.py`:S1 一次性加好 `app.state.library`、lifespan、`library` 路由,并为 `admin_library` 留带标签的锚点注释,A 只在锚点处追加两行(与 agents 计划的做法一致);S2 的 `library_import` 路由同样由 S1 预留锚点。
- 每份计划合并后测试全绿;迁移号以合并时 `alembic heads` 为准(若别的车道先占了 `0018`,S1 顺延并在 Ruling 里写明)。

## 16. 开放问题(请用户回答;每条带推荐默认值,不回答就按默认走)

1. **默认开关**:`LIBRARY_ENABLED` 与 `LIBRARY_ASR_ENABLED`(花钱)是否都默认关?**推荐:都默认关**,与 `rooms_voice_enabled` 等一致,由你在后台「设置 → 跟读库」里手动打开;`LIBRARY_LINK_IMPORT_ENABLED` 按你的决定默认关。
2. **容量默认值**:每人 2000 MB / 100 条 / 单文件 500 MB / 单条 90 分钟,识别每人每天 60 分钟、全站 600 分钟。**推荐:按此默认**;这些都可在后台热改,但数据卷要有足够空间,请确认你的磁盘规模。
3. **句边界精度**:现有识别没有时间戳,B 档只能估算句边界(误差零点几秒量级,有 ±0.2 s 微调与改字)。是否接受?**推荐:接受**,并先跑 spike S1 看上游能否直接给时间戳;替代方案(在镜像里加本地 Whisper 类模型做强制对齐)会显著增大镜像与 CPU 占用,本期不做。
4. **平台自动字幕**:YouTube 自动生成字幕免费且带时间,但无标点、重复多。是否只在识别不可用时才用它(E6)?**推荐:是**,有人工字幕用人工字幕,否则优先用收费的识别(有标点、更适合跟读),识别没开才退到平台自动字幕。
5. **YouTube 能否下载**:你的服务器是机房 / 云主机 IP 吗?是否愿意为 yt-dlp 准备**专用小号**的 cookies 或一个代理?**推荐:先不配**,在 S2 Task 0 用你的真实服务器试一次;被拦时界面提示改用「本机下载后上传」,这是最稳的路径。
