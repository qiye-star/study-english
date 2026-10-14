# 跟读库 · 精选库(内置素材)· 设计

- 日期:2026-10-14 · 状态:用户已批准方向(D1–D9);E 系列与 Ruling 是本文的设计裁定,§14 有待用户确认的开放问题
- 计划:`docs/superpowers/plans/2026-10-14-curated-library-INDEX.md`(车道顺序、冻结接口)+ 四份车道计划
  (`-server-core.md`、`-server-import.md`、`-admin-ui.md`、`-web.md`)
- 前置:`2026-10-13-video-import-design.md`(跟读库本体,本文只追加)、`plans/2026-10-14-library-alignment-v2.md`(当前分句算法)
- 本文与 INDEX 里的表名、列名、路由、JSON 形状、函数签名**对所有计划有约束力**;计划与本文冲突时以 INDEX 为准(INDEX 与本文一致)
- 不动 `enjoy/`;不引入对象存储(只用现有数据卷)

## 1. 用户已确认的决定

| # | 决定 |
|---|---|
| D1 | 跟读库里新增「精选」:用户不上传任何东西也能跟读内置素材 |
| D2 | 管理员**只导入一次**:新的管理页「精选库」,两种入口都要——粘贴链接(复用现有 yt-dlp + 识别流水线)和**上传文件 / 字幕**(生产服务器在大陆,不配 `LIBRARY_YTDLP_PROXY` 时到不了 YouTube)。有平台人工字幕时优先用(不花识别费、时间更准) |
| D3 | 管理员审核后发布 / 下架;条目有标题、级别、话题标签、时长、来源与许可说明、封面 |
| D4 | **只存音频**:m4a(单声道约 64 kbps)+ 一张小封面 jpg,放在现有数据卷的共享目录 `library/_catalog/<catalog_id>/`,所有用户共用;**不用对象存储** |
| D5 | 新的全局(系统所有)目录表:目录条目 + 目录句子(含预先生成的逐句译文);句子、时间、译文由管理员一次处理好 |
| D6 | **添加即复制(copy-on-add)**:用户点「添加到我的库」→ 生成一条普通的 `library_items` + 从目录复制的 `library_segments`(含译文),媒体**指向共享文件**;播放页、跟读、成绩、AI 分析、字幕视图全部复用 |
| D7 | 计费:内置素材对用户**只收跟读评测**(现有的逐次发音评测照旧扣)。不收识别、不占上传 / 存储额度;逐句译文由管理员导入时生成(系统开销,按系统计量);句子 AI 分析对目录来源的条目**首次请求时生成、缓存在目录句子上、所有用户共享**,计入系统,不扣任何用户额度 |
| D8 | 首批素材建议来自可复用来源(VOA Learning English、TED);每条存来源 / 许可说明;**不编造视频链接**,链接由站长提供 |
| D9 | 管理端页面:按链接导入、按上传导入、状态 / 进度、发布开关、编辑元数据、删除 |

## 2. 已核对的事实(读代码,计划作者动手前复核)

| 核对项 | 结论 | 依据 |
|---|---|---|
| 迁移头 | `0021`(`0021_library_word_alignment.py`,`down_revision='0020'`);本功能用 `0022`。head 钉子 7 处:`tests/test_migrations.py` 5 处、`tests/test_library_models.py`、`tests/test_changelog_models.py` 各 1 处 | `server/alembic/versions/`、`Grep "get_heads\(\) == \["` |
| 撞号风险 | 工作树里**未跟踪、未实现**的 `plans/2026-10-14-accounts-*.md` 计划从 `0021` 起编号(写它时 head 还是 `0020`),它们实施时同样要顺延。**谁后合并谁顺延**,记录在 INDEX §3 | `docs/superpowers/plans/2026-10-14-accounts-INDEX.md` §3 |
| 删除条目的文件范围 | `store.delete_item` → `paths.remove_item_files(data_dir, user_id, item_id)` 只删 `library/<uid>/<item_id>/` 与 `library/_tmp/<item_id>/`,**不按 `media_path` 删**;`users_admin.delete_user` → `remove_user_files` 只删 `library/<uid>/`。所以指向 `library/_catalog/…` 的副本被删时共享文件天然不受影响(仍要回归测试钉住) | `app/library/store.py`、`paths.py`、`admin/users_admin.py` |
| 配额 | `limits.used_bytes` = Σ`library_bytes` + 进行中条目的 `upload_total`;副本两者都写 0,天然不占配额。`item_count` 统计全部条目,需排除副本(E7) | `app/library/limits.py` |
| 媒体服务 | `GET /items/{id}/media?ticket=` 用 `store.get_owned(user_id, item_id)` 找条目,再 `paths.absolute(data_dir, item.media_path)`;票据绑定「用户 + 条目」。媒体路径指向目录文件时这条路**不用改**;封面同理(`item.poster_path`) | `app/routers/library.py::media`、`poster` |
| `_tmp` 清扫 | `LibraryWorker.sweep` 删除 `library/_tmp/` 下「条目不存在 / ready / canceled」的目录。目录任务的暂存若放在那里会被误删 → 目录暂存放 `library/_catalog/_tmp/<id>/`(E4) | `app/library/worker.py::sweep` |
| 取回阶段 | `FetchStage.fetch(FetchRequest)` 只用 `item_id`(日志、cookies 副本名)、`tmp_dir`、`url`、`settings`、`asr_available`、`report`;`user_id` 不被 yt-dlp 使用。`pick_subtitles` 已是「人工英文字幕 > (识别)> 自动字幕仅当识别不可用」 | `app/library/ytdlp.py`、`pipeline.py` |
| 取回开关 | `YtDlpFetch.fetch` 开头 `if not s.library_link_available: raise LibraryError("link_disabled")`——用户的链接导入开关关着时,管理员导入也会失败。需要一个「系统请求」旗标(E5) | `app/library/ytdlp.py:420` 附近 |
| 流水线耦合 | `pipeline.process` / `_media_stage` / `_transcribe` 直接读写 `LibraryItem`,识别按**用户**预留每日秒数。目录导入不能直接调用它,只能复用其**零件**(取回、探测、字幕解析、分句、识别分块与 `sentences.build`)(E3) | `app/library/pipeline.py` |
| 计量 | `metering.record` 记 contextvar 的用户;`bind_user(None)` 即「无用户」,`upstream_calls.user_id` 可空,日汇总里记 `0`。**不需要假用户**;`feature` 截断到 16 字符 | `app/core/metering.py` |
| 每日计数 | `limits.reserve(scope, subject, day, amount, limit)` / `release`,`subject="*"` = 全站;新 scope 不需要迁移 | `app/library/limits.py`、`models.DailyUsage` |
| 大模型 | 只经 `providers/llm.complete`;译文批量 ≤ 20 句,`parse_translations` 解析 `N. 译文` 行;提示词 `library.translate` / `library.analyze` 由 `prompt_cache(app).get(key)` 取 | `app/library/ai.py` |
| 识别闸门 uid | `make_transcriber(..., uid="server")` 的 `uid` 只用于闸门 / 上游会话标识,默认就是 `"server"` | `app/speech/asr.py` |
| 备份 | `admin/backups.py` 只做 SQLite `VACUUM INTO`(Postgres 提示用 pg_dump),**不含媒体文件** | `app/admin/backups.py` |
| 管理端客户端 | `admin/src/api/client.ts` 只会发 JSON(`opts.json`);上传分片需要加 `FormData` 支持 | `admin/src/api/client.ts` |
| 请求体 | 非 multipart 且 > 1 MiB → 413;multipart 由路由自己限长。管理端上传分片用 multipart(与用户上传同法) | `core/bodylimit.py` |
| 网页契约 | `library-contract.test.ts` 对 `config`、条目键做**精确**比对;服务端给条目 / 配置加键必须同时改网页类型(否则网页测试红)。所有服务端错误文本必须在 `LIBRARY_SERVER_ERRORS` 里有映射 | `web/src/features/library/library-contract.test.ts` |
| 播放页封面 | 只在 `kind === "video"` 时取封面;音频条目显示图标 | `web/src/features/library/player-page.tsx` |
| 管理端隐私原则 | E10:管理员看不到**用户**素材的标题 / URL / 文字。目录条目是**系统内容**,管理员本来就是作者,可以看标题与句子(R5) | spec 2026-10-13 E10 |

## 3. 设计裁定(E 系列)

| # | 裁定 |
|---|---|
| E1 | 新增两张表 `catalog_items`、`catalog_segments`(系统所有,无 `user_id`),`library_items` 加可空列 `catalog_id` + 唯一索引 `(user_id, catalog_id)`;迁移 `0022_curated_catalog`。副本的 `source = "catalog"`、`kind = "audio"`、`library_bytes = 0`、`media_path` / `poster_path` 指向目录文件 |
| E2 | 新的服务端模块都在 `app/library/` 里(`catalog_store.py`、`catalog_import.py`、`catalog_jobs.py`),管理端在 `app/admin/catalog_admin.py`,路由 `routers/library_catalog.py`(用户)与 `routers/admin_catalog.py`(管理)。分层不变:`library -> core, models, providers, speech, services`;`tests/test_architecture.py` **不改** |
| E3 | **目录导入复用零件,不复用 `pipeline.process`**:取回(`FetchStage`)、探测、封面、字幕解析(`subtitles.parse`)、分句(`segment.build`、`sentences.build`)、识别分块(`asr_chunks`,经 `pipeline` 里抽出的两个助手)全部复用;新的只有「只要音频」的转码(`Ffmpeg.audio_only`)、目录行的进度 / 写回、翻译阶段与任务运行器。用户条目的行为与现有测试不变 |
| E4 | 文件布局:成品 `library/_catalog/<catalog_id>/media.m4a` + `poster.jpg`;暂存 `library/_catalog/_tmp/<catalog_id>/`(不在 `library/_tmp/`,用户库的清扫不会碰它)。`_catalog` 不是整数,不会与 `library/<user_id>/` 冲突 |
| E5 | `FetchRequest` 追加 `system: bool = False`;`YtDlpFetch.fetch` 在 `system=True` 时只要求 `library_enabled ∧ ytdlp_present()`,**不要求**面向用户的 `LIBRARY_LINK_IMPORT_ENABLED`(那个开关管的是「让用户提交链接」)。代理、cookies、URL 预检、generic 提取器规则完全相同 |
| E6 | 目录任务由新的 `CatalogJobs`(`app.state.catalog`)运行:**一次一个**、无轮询循环(建条目 / 重试 / 补译 / 启动恢复时 `kick()`);不自动重试(管理员按「重试」);媒体工具、取回阶段、识别器取自 `app.state.library.deps`(测试的 `use_fakes` 自动生效) |
| E7 | 副本不计入:`used_bytes`(天然 0)、上传额度、每日新建次数(`library_imports_daily_per_user`)、条目数上限(`item_count` 排除 `source == "catalog"`) |
| E8 | **幂等**:同一用户对同一目录条目第二次「添加」返回已有副本(`created: false`);并发由唯一索引兜底(`IntegrityError` → 回读) |
| E9 | 副本是用户自己的:可改标题、续播、改句子文字 / 时间、删除。**不能**重新识别、不能替换字幕(`409 Built-in items cannot be changed this way`);「重新分句」本来就不可用(副本 `rebuildable = false`,不复制 `transcript.json`) |
| E10 | 目录条目「发布」只在 `status = ready ∧ seg_count > 0 ∧ 媒体文件存在 ∧ 未退役` 时允许。目录句子的编辑与「补全译文」只在**未发布**时允许(先下架,改好再发布)。已加入的副本不随目录更新(复制语义) |
| E11 | 目录的译文与共享分析只有一种语言:每个目录条目的 `ai_lang`(创建时选,默认 `zh-CN`,白名单 = `ai.LANGS`,之后不可改)|
| E12 | 用户侧的「精选」由新开关 `LIBRARY_CATALOG_ENABLED`(默认关)控制:关 = `GET /api/library/catalog*` 404、`config.catalog: false`、网页不显示「精选」页签;**已加入的副本照常可用**(它们就是普通条目)。管理端导入只需要 `library_available`(总开关 + ffmpeg) |

## 4. Rulings(删除、引用计数、计费的细节)

- **R1 删除目录条目的规则(最简单的安全规则)。** 不维护引用计数器;引用数 = `SELECT count(*) FROM library_items WHERE catalog_id = :id`。唯一索引以 `user_id` 开头,帮不了按 `catalog_id` 的计数;本期不另建索引(这类查询只在管理动作、用户删除副本与每日清扫时跑,规模是「目录几百条 × 用户几十人」),以后变慢再加。
  - **下架**(unpublish):只是从「精选」列表消失;副本照常播放。
  - **删除**(管理员默认的删除):引用数 = 0 → 立即删行 + 删 `library/_catalog/<id>/` 与暂存;引用数 > 0 → **退役**:`published = false`、`retired_at = now`,文件与行保留,管理端标「已退役 · N 个副本仍在使用」。
  - **回收**:退役且引用数 = 0 的目录条目在三处被回收(删行 + 删文件):用户删除副本的接口之后(`DELETE /api/library/items/{id}`)、每日清扫(`LibraryWorker.sweep`)、管理端删除动作。管理员删用户、管理员在「跟读库」页删用户条目不立即回收,由每日清扫兜底。
  - **强制删除**(purge,超级管理员 + 二次验证 + 输入确认 `PURGE <id 前 8 位>` + 理由):删除**所有用户的副本**(行、句子、成绩;练习历史里的评测与录音保留,与删条目一致)、吊销票据,然后删目录行与文件。审计记录副本数与受影响用户数。这是唯一会「弄坏」已加入副本的操作,所以它直接删掉副本,不留下播放不了的空壳。
  - 为什么不用计数列:计数要在用户删除、删用户、管理员删除、清扫多处保持一致,任何一处漏改就会提前删文件;查询算出来的数不会漂。
- **R2 目录媒体不可替换。** ready 之后 `media_path` 不再变;要换媒体就新建一条再删旧的。这样副本的 `media_path` 永远有效(除非 purge)。
- **R3 计费矩阵**(§8)按「谁触发、谁付钱」:导入时的识别、译文 = 系统(`bind_user(None)`,feature `cat_import` / `cat_translate`,不进任何用户的 `daily_usage`);副本的分析在「目录语言 + 原文未改」时走共享缓存,首次生成记系统(feature `cat_analysis`,全站每日上限 `LIBRARY_CATALOG_AI_DAILY`,scope `library_cat_ai`、subject `*`);**其他语言或用户改过文字的句子**走普通用户路径(扣用户自己的 `library_translate` / `library_analysis`,与上传条目一样)。理由:目录只缓存一种语言,站长与用户是中文母语者;不这样就得为 12 种母语各存一份,复杂且花钱无上限。这一条是开放问题 1。
- **R4 系统计量不造假用户。** `core/metering.py` 新增 `system_scope()` 上下文管理器:进入时 `_user` 设为 `None`、退出恢复。请求内的共享分析用它包住 `llm.complete`;后台目录任务一开始就 `bind_user(None)`。管理端「用量」页里 `user_id` 为空的行按现有逻辑显示(**未验证**显示文案,§13)。
- **R5 管理员可以看目录内容。** 目录是系统内容,管理端接口返回标题、级别、标签、许可说明与句子(审核需要);但**日志、审计、计量里仍然没有**标题、URL、句子文字(与 `library/CLAUDE.md` 一致,`tests/test_library_privacy.py` 与新测试覆盖)。审计只记 id、动作、数字与布尔。
- **R6 来源链接不长期保存。** `catalog_items.source_url` 与用户条目一样在 ready 时清空;出处写进 `license_note`(管理员自填,≤ 300 字,可含链接文字,只在界面显示,不进日志)。`source_host` 保留给管理端显示。
- **R7 级别用 CEFR**:`A1 A2 B1 B2 C1 C2` 或空;**标签** ≤ 5 个,每个 1–16 个字符(合并空白、去首尾、不含逗号、大小写不敏感去重),存为逗号连接的字符串。
- **R8 目录句子的修改**(管理端,未发布时):文字(≤ 600 字、必须含字母;改了就清该句 `analysis`,译文若未同时提供也清空)、译文(≤ 1200 字,写入时 `zh_lang = ai_lang`)、起止时间(不与相邻句重叠、在时长内;改时间清 `flags`)。
- **R9 「补全译文」**:未发布、ready、`library_ai_available` 时,条目回到 `queued`,任务发现已有句子 → 直接进翻译阶段,只译缺的句子;失败不改句子,条目回到 `ready`(带 `error_kind = upstream`,与重新识别失败的先例一致)。
- **R10 恢复后媒体缺失。** 只恢复了数据库(媒体不在备份里)时,目录条目的 `media_missing = true`:不能发布、不能添加;已有副本播放返回 404(网页已有错误提示)。管理员处理方式:重新导入一条,旧的走删除 / 强制删除。

## 5. 数据模型与迁移 `0022_curated_catalog`

SQLite(加列 / 建表 / 建索引都不需要 batch;降级用 batch 删列)与 Postgres 两条路径;往返测试;`test_models_match_migrations` 保持绿。

**`catalog_items`**

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | `String(36)` PK | uuid |
| `title` | `String(200)` 非空 | 管理员可改;链接导入且未填时取平台标题 |
| `level` | `String(2)` 可空 | R7 |
| `tags` | `String(120)` 可空 | R7,逗号连接 |
| `license_note` | `String(300)` 可空 | 来源与许可说明,用户可见 |
| `source` | `String(8)` 非空 | `upload` / `link` |
| `source_host` | `String(64)` 可空 | |
| `source_url` | `Text` 可空 | ready 时清空(R6) |
| `status` | `String(12)` 非空 | `uploading` / `queued` / `processing` / `ready` / `failed` / `canceled` |
| `stage` | `String(16)` 可空 | 同用户条目,另加 `translate` |
| `progress` | `SmallInteger` 默认 0 | |
| `error_kind` | `String(24)` 可空 | `app.library.errors.KINDS` |
| `upload_total` / `upload_received` | `BigInteger` 默认 0 | 管理端分片上传 |
| `duration_ms` | `Integer` 可空 | |
| `media_path` / `poster_path` | `String(200)` 可空 | `library/_catalog/<id>/media.m4a`、`…/poster.jpg` |
| `media_mime` | `String(32)` 可空 | `audio/mp4` |
| `media_bytes` | `BigInteger` 默认 0 | 媒体 + 封面 |
| `sub_source` | `String(10)` 可空 | `uploaded` / `platform` / `asr` |
| `asr_seconds` | `Integer` 默认 0 | 系统识别秒数(对账) |
| `seg_count` | `Integer` 默认 0 | |
| `low_confidence` | `Boolean` 默认 false | 同用户条目 |
| `ai_lang` | `String(8)` 非空,默认 `zh-CN` | E11 |
| `published` | `Boolean` 默认 false | |
| `published_at` / `retired_at` | `DateTime(tz)` 可空 | |
| `created_at` / `updated_at` | `DateTime(tz)` 非空 | 索引 `ix_catalog_items_status_created_at (status, created_at)` |

**`catalog_segments`**:`catalog_id`(FK `catalog_items.id` `ON DELETE CASCADE`)+ `idx` 复合主键;`start_ms`、`end_ms`、`text`(`Text`)、`zh`(`Text` 可空)、`zh_lang`(`String(8)` 可空)、`analysis`(`Text` 可空)、`analysis_lang`(`String(8)` 可空)、`flags`(`String(48)` 可空)。列与 `library_segments` 同名同型,复制时一一对应。

**`library_items`** 追加 `catalog_id String(36) NULL`(**无外键**:目录行被删时由应用层先处理副本,R1)与唯一索引 `ux_library_items_user_id_catalog_id (user_id, catalog_id)`(SQLite 与 Postgres 的唯一索引都把 NULL 视为互不相同,普通条目不受影响)。

## 6. 存储、配额与设置

- 路径函数在 `app/library/paths.py`(§9 INDEX 有签名):`catalog_rel`、`catalog_dir`、`catalog_tmp_dir`、`remove_catalog_files`;id 先按 uuid 形状校验,逃逸检查沿用 `absolute`。
- 转码:`Ffmpeg.audio_only` = `-vn -map 0:a:0 -ac 1 -c:a aac -b:a 64k -movflags +faststart -f mp4 media.m4a`(总是重编码,保证单声道 64 kbps);视频源先用现有 `poster()` 从**源文件**截一帧(10% 处,360 px 高)。原始下载 / 上传不保留。
- 新设置(`config.py` + `settings_registry.py` + `server/.env.example`,热更新,「跟读库」组):

| 键 | 默认 | 范围 | 说明 |
|---|---|---|---|
| `library_catalog_enabled` | `false` | bool | 「精选」对用户可见(E12) |
| `library_catalog_ai_daily` | 300 | 0–100,000 | 共享分析每天全站最多生成多少句(系统付费,`danger=_COST`) |

- 时长、单文件大小沿用 `library_max_duration_minutes`、`library_max_upload_mb`;识别是否可用沿用 `library_asr_available`;翻译阶段需要 `library_ai_available`(不可用时跳过翻译,条目照样 ready,管理端显示「已译 0 / N」)。

## 7. 处理流程(管理端导入)

```
链接 ─ POST imports ──┐                                   ┌ 上传的字幕 → subtitles.parse
上传 ─ uploads/chunks ┴→ catalog_items(queued) → CatalogJobs ┼ 平台人工字幕(yt-dlp)
                                                          ├ 识别(系统付费,无每日上限)
                                                          └ 平台自动字幕(仅当识别不可用)
   取回(system=True)→ 探测 → 封面(视频源)→ audio_only → 分句 → 写 catalog_segments
   → 翻译(ai_lang,每批 ≤ 20 句,系统付费)→ ready(未发布)→ 管理员审核 → 发布
```

- 阶段与权重:链接 取回 0–30、转码 30–45、字幕 / 识别 45–85、分句 85、翻译 85–99、完成 100;上传类没有取回,转码 0–20。
- 字幕优先级与用户条目一致(spec 2026-10-13 E6):上传的字幕 > 平台人工字幕 > 识别 > 平台自动字幕;都没有 → `failed(no_subtitles)`(管理员可补传字幕后重试:暂存目录保留到删除)。
- 识别:与用户条目同一分块与分句代码;**不预留任何每日额度**(管理员发起、一次一个、时长有上限);`asr_seconds` 记实际秒数;计量 `cat_import`。
- 取消:`uploading` / `queued` / `processing` → `canceled`,结束子进程、删暂存与成品目录。
- 失败:`failed` + `error_kind`,不自动重试;「重试」回到 `queued`,暂存里的下载缓存(`fetch.json`)与 `chunks.json` 接着用。
- 进程重启:`processing` → `queued` 并 `kick()`。

## 8. 计费矩阵

| 动作 | 谁付钱 | 计量 feature(≤ 16 字符) | 每日计数 | 用户额度 |
|---|---|---|---|---|
| 管理员导入:yt-dlp 下载 | 不计(不是付费上游,同 S2 R-LI11) | — | — | — |
| 管理员导入:识别 | 系统 | `cat_import`(user 为空) | 无 | 不扣 |
| 管理员导入 / 补全:逐句译文 | 系统 | `cat_translate` | 无 | 不扣 |
| 用户:浏览 / 添加 / 播放副本 | 免费 | — | — | 不占存储、上传、每日新建、条目数 |
| 用户:副本的译文(目录语言,文字未改) | 免费(复制目录已存的) | — | — | 不扣 |
| 用户:副本的分析(目录语言,文字未改) | 系统(首次生成后共享) | `cat_analysis` | `library_cat_ai` / `*` ≤ `LIBRARY_CATALOG_AI_DAILY` | 不扣 |
| 用户:副本的译文 / 分析(其他母语,或改过文字) | 用户 | `lib_translate` / `lib_analysis` | 现有 | 扣现有额度(R3) |
| 用户:跟读评测 | 用户 | `assessment`(现有) | 现有 | 照旧扣 |

## 9. API(只追加;URL 里只有 uuid 与序号)

**用户**(`routers/library_catalog.py`,前缀 `/api/library/catalog`,在 `stubs` 之前;先鉴权,再 `library_enabled`(404 `Library is disabled`),再 `library_catalog_enabled`(404 `Built-in library is disabled`)):

| 方法与路径 | 说明 |
|---|---|
| `GET /api/library/catalog` | `{items: [CatalogCard]}`,已发布、ready、未退役,按 `published_at` 倒序,≤ 200 条;`added_item_id` = 本人副本 id 或 null |
| `POST /api/library/catalog/{catalog_id}/add` | `limited_user`;`{item: item_out, created: bool}`,幂等(E8);目录条目不可用 404 `Built-in item not found` |
| `GET /api/library/catalog/{catalog_id}/poster` | jpg(Bearer,网页 blob 取);只给已发布的 |

**现有用户接口的变化**(`routers/library.py`):`GET /config` 加 `catalog: bool`;条目形状加 `catalog_id: str | null`、`source` 可为 `"catalog"`;`reprocess`、`PUT items/{id}/subtitles` 对副本 409 `Built-in items cannot be changed this way`;`DELETE items/{id}` 之后回收退役目录(R1);`translate` 先从目录补译文(R3);`analysis` 走共享路径(R3)。

**管理端**(`routers/admin_catalog.py`,前缀 `/api/admin/library/catalog`,每个端点声明角色,写操作要 CSRF):

| 方法与路径 | 角色 | 说明 |
|---|---|---|
| `GET ""` | viewer | `{items: [CatalogAdminRow], state: {...}}` |
| `GET /{catalog_id}` | viewer | `{item: CatalogAdminRow, segments: [CatalogAdminSegment]}` |
| `POST /imports` | operator | `{url, title?, level?, tags?, license_note?, ai_lang?}` → `{item}` |
| `POST /uploads` | operator | `{filename, size, title?, level?, tags?, license_note?, ai_lang?}` → `{catalog_id, chunk_bytes}` |
| `PUT /uploads/{catalog_id}/chunks/{n}` | operator | multipart `chunk`(≤ 8 MiB)→ 上传状态 |
| `PUT /uploads/{catalog_id}/subtitles` | operator | multipart `file`(SRT / VTT ≤ 2 MiB)→ `{cue_count}`;状态 `uploading` 或 `failed(no_subtitles)` |
| `POST /uploads/{catalog_id}/complete` | operator | → `{item}`,`queued` 并 `kick()` |
| `PATCH /{catalog_id}` | operator | `{title?, level?, tags?, license_note?}` |
| `POST /{catalog_id}/publish`、`/unpublish` | operator | E10 |
| `POST /{catalog_id}/retry`、`/cancel`、`/translate` | operator | §7、R9 |
| `PATCH /{catalog_id}/segments/{idx}` | operator | R8 |
| `POST /{catalog_id}/delete` | operator | `{reason, confirm}`,确认串 `DELETE <id 前 8 位>`;R1 → `{id, outcome: "deleted"|"retired", refs}` |
| `POST /{catalog_id}/purge` | superadmin + step-up | `{reason, confirm}`,确认串 `PURGE <id 前 8 位>`;→ `{id, copies_deleted, users}` |
| `GET /{catalog_id}/media`、`/poster` | viewer | 管理端 Cookie 同源,`<audio>` 可直接播放;Range 由 `FileResponse` 提供 |

**错误(新增固定英文串)**:用户侧 `catalog_disabled` 404 `Built-in library is disabled`、`catalog_not_found` 404 `Built-in item not found`、`catalog_locked` 409 `Built-in items cannot be changed this way`(写进 `app/library/errors.API_ERRORS`,契约夹具 `errors` 手工追加,网页 `LIBRARY_SERVER_ERRORS` 加映射)。管理端沿用 `{"error": ...}`:`Catalog item not found`(404)、`Confirmation required`(409,`details.confirm`)、`Item is not ready`(409)、`Item is published`(409)、`Media is missing`(409)、`Item is not running`(409)、`Item has not failed`(409)、`Item is retired`(409)、`Link import is unavailable`(503,yt-dlp 不在)、`Media tools are not installed`(503)、`Invalid link`(400)、`AI is unavailable`(503)、`Unsupported file type`(400)、`File is too large`(413)、上传类沿用用户侧同名文案。

## 10. 网页(`web/src/features/library/`)

- **先出设计稿**:`docs/superpowers/design/curated-library-v1/mockup.html`(网页计划 Task 0),用户确认前不写界面代码。
- 列表页顶部 `我的 / 精选` 分段(`?tab=catalog` 记在 URL);「精选」只在 `config.catalog` 为真时出现。卡片:封面、标题、级别徽标、标签、时长、句数、许可说明一行、按钮「添加到我的库」/「已添加 · 去学习」;级别筛选在客户端做(目录 ≤ 200 条)。添加成功后跳到播放页。
- 「我的」里的副本卡片带「精选」小徽标;⋯ 菜单不显示「重新识别 / 换字幕 / 重新分句」。播放页对有封面的音频条目显示封面(副本都是音频)。副本已有译文时,即使 `config.ai` 为假也显示「译」开关(只显示已存的,不请求)。
- 沿用深色优先玻璃风格(`library.css`、`fx/`),不新增 npm 依赖、不新增跨 feature 边、全部在懒加载块里;新增文案键 ≤ 15 个(`locales/`,懒加载)。

## 11. 管理端(`admin/src/features/catalog/`,仅桌面)

导航「内容」组新增「精选库」(`/catalog`,viewer 可看,写操作 operator,强制删除 superadmin)。页面:状态说明条(开关、识别 / 翻译 / 链接是否可用、**备份提示**)、条目表(标题、级别、标签、状态 / 进度、时长、句数、已译、副本数、发布开关)、「按链接导入」与「上传文件」两个对话框(上传可附字幕,分片 8 MiB,进度条)、详情抽屉(音频播放、句子与译文、逐句编辑、元数据编辑、补全译文、删除 / 强制删除)。处理中的条目每 3 秒轮询。

**备份提示(固定文案)**:「数据库备份不包含音频与封面文件。服务器数据卷丢失或只恢复了数据库时,精选条目会显示『媒体缺失』,需要重新导入。」同一句写进 `server/README.md` 的备份一节。

## 12. 内容来源建议(写给站长,不是法律意见)

- **VOA Learning English**:美国政府作品,一般属公有领域;但个别文章 / 图片 / 音频可能含第三方素材(如通讯社图片),导入前看页面署名。许可说明示例:`VOA Learning English · Public domain (U.S. Government work)`。
- **TED / TED-Ed**:CC BY-NC-ND 4.0(署名、非商业、禁止演绎)。自托管、不收费的小范围使用符合「非商业」的通常理解;**机器生成的逐句译文是否算「演绎」有争议**——开放问题 3。许可说明示例:`TED · Speaker Name · CC BY-NC-ND 4.0`。
- 不在任何文档或代码里写入具体视频链接;站长自己提供。每条都填 `license_note`。

## 13. 隐私、测试与未验证

- 日志 / 审计 / 计量里只有 id、阶段、`error_kind`、数字;没有标题、URL、许可说明、句子、译文、分析。`tests/test_library_privacy.py` 的路由表加上三个用户路由(路径参数允许 `catalog_id`);管理端路由由新测试 `tests/test_admin_catalog.py` 的隐私用例覆盖。
- 必须由测试证明:迁移往返与模型一致;副本删除 / 删用户不删共享文件;副本不占配额;幂等添加与并发;票据 + Range 对副本可用;下架 / 删除 / 退役 / 回收 / 强制删除各自的结果;共享分析只花一次系统额度且不动用户计数;其他语言走用户额度;目录导入的四种字幕来源、翻译阶段、补全译文、取消、失败、重试、重启恢复;`system=True` 绕过用户链接开关但不绕过总开关与 yt-dlp;契约与网页类型同步;管理端角色与 CSRF。
- **未验证**(结果文档逐条写「已做 / 未做」,不编造数字):真实 ffmpeg 在部署机器上 `audio_only` 的产物大小与速度;大陆服务器经代理用 yt-dlp 取回;真实大模型的译文质量与费用;iOS Safari 播放共享 m4a 与封面;管理端「用量」页对 `user_id` 为空的行如何显示;Postgres 上唯一索引与迁移(只在 SQLite 上跑过测试);大文件(数百 MB)在管理端浏览器分片上传的稳定性。

## 14. 开放问题(不回答就按推荐默认走)

1. **非中文母语的用户**:目录只缓存 `ai_lang`(默认简体中文)的译文与分析;其他母语的用户请求译文 / 分析时扣**他自己的**额度(R3)。**推荐:接受**(用户群是中文母语者)。替代:系统付费并按语言缓存(要新表,费用随语言数增长)。
2. **共享分析每日上限** `LIBRARY_CATALOG_AI_DAILY = 300` 句是否合适?**推荐:先用 300**,后台可热改;满了返回现有的「今日 AI 次数已满」文案。
3. **TED 素材的译文**:CC BY-NC-ND 的「禁止演绎」可能覆盖机器译文。本期**不做**「单条不翻译」开关(翻译阶段在 `library_ai_available` 时总会运行)。**推荐**:首批只导 VOA;TED 等站长决定后再导,需要「不翻译」开关就告诉我们,作为后续小改动(加一列,不影响本期接口)。
4. **强制删除的角色**:超级管理员 + 二次验证。**推荐:按此**。
5. **迁移号**:本功能与账号体系计划都想用 `0022` 起的号。**推荐:谁先合并谁用**,后者顺延并在 INDEX 记录。
