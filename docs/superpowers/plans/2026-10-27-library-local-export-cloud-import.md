# 桌面端视频本地导出 · 管理端精选库导入包 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- 日期:2026-10-27 · 状态:只有文档,没有产品代码;未提交 · **已按用户 2026-10-27 的裁定修订(见文末「修订记录」)**
- 基线:`main` @ `0719491c`(下文 文件:行号 都是在这个提交上打开核对过的;实现前 Task 0 重新核对)
- 需求来源:用户 2026-10-27 确认的需求——把 Enjoy 桌面端本地导入的**视频**搬到云端,分「本地导出」与「云端导入」两步,两步互不依赖,只靠一个导出包(zip)衔接。
  **修订后的裁定:导入只在管理端做,目标是「精选库」**(系统所有、所有用户可在「精选」里添加,处理费用系统出);不做用户个人跟读库的导入,不改 `web/`。
  精选库本身的规则以 `docs/superpowers/specs/2026-10-14-curated-library-design.md` 与 `docs/superpowers/plans/2026-10-15-catalog-keep-video.md`(R-KV1–R-KV9,替换媒体)为准;
  本计划的「裁定」就是这次的设计,真正待定的放在文末「待用户确认」。
- 写计划前读过:根 `CLAUDE.md`、`web/CLAUDE.md`、`docs/CLAUDE.md`、`scripts/CLAUDE.md`、`server/README.md`、`server/app/library/CLAUDE.md`、`admin/README.md`、
  `admin/src/features/catalog/CLAUDE.md`、上面的 spec 与 keep-video 计划;代码 `server/app/library/{catalog_store,catalog_import,catalog_jobs,catalog_bundle}.py`、
  `server/app/admin/{catalog_admin,library_admin}.py`、`server/app/routers/admin_catalog.py`、`admin/src/features/catalog/*`;
  桌面端只读了 `enjoy/src/main/db/models/{video,transcription}.ts`、`enjoy/src/main/db/index.ts`、`enjoy/src/main/db/migrations/*`、
  `enjoy/src/main/config/{config-manager,config-schema}.ts`、`enjoy/src/shared/constants/index.ts`(**`enjoy/` 一行不改**)。
- **写本计划时没有运行任何测试,没有打开过任何真实的桌面端数据库**;凡涉及真实桌面端数据形状、各平台默认路径、浏览器对大文件的行为的结论都列进「未验证清单」。

**Goal:**
- **E 本地导出:** `node scripts/enjoy-export.mjs` 一条命令,读本机 Enjoy 桌面端的 `videos` 表 + 对应 `transcriptions` + 本机媒体文件,
  生成一个 zip:每条视频 = 媒体文件 + 标准 SRT(由桌面端已有的带时间转写生成,云端因此不需要再做语音识别)+ `meta.json`,根下一个 `manifest.json`。
  只在本机运行,不联网、不读令牌。默认导出全部,`--pick` 先列清单再选,`--out` 指定输出。(与修订前相同)
- **A 管理端导入:** 管理后台「精选库」页(`/admin/catalog`,桌面 ≥ 1024px)工具栏新增「导入包」按钮:选 zip → 浏览器按中央目录**随机读取**(不把 zip 读进内存)→ 预览
  (多少个、多大、哪些精选库里已有、哪些不能导入)→ 选「已存在的条目:跳过(默认)/ 覆盖」→ 逐个复用现有管理端分片上传(带 SRT)建精选条目 → 单个失败不影响其余 → 汇总。
  导入的条目和手动上传的一样进入「未发布」,管理员审核后发布。
- **S 服务端最小改动:** `catalog_items.source_md5`(迁移 0033)+ 管理端上传开始可带 `source_md5`(重复拦截)+ 一个管理端「包检查」端点 +
  把现有「替换媒体」扩展为**可同时换字幕**(原位覆盖,副本不丢)。精选库的导入队列、转码、计费一律不变。

**Architecture:**
- 导出侧零依赖:Node ≥ 22.13 自带 `node:sqlite`(只读打开桌面端数据库的**临时副本**)、`zlib.crc32`(流式 CRC);自写一个只用 STORE 方法、支持 ZIP64 的流式 zip 写入器。
- 导入侧(`admin/`)零新 npm 依赖:`File.slice()` 读 zip 尾部的 EOCD / ZIP64 记录与中央目录,条目数据用 `file.slice(dataStart, dataEnd)` 得到 **Blob 视图**,
  媒体条目必须是 STORE(不压缩),所以这个 Blob 视图直接交给现有 `uploadChunks`(`admin/src/features/catalog/upload.ts`,入参 `file: Blob`,8 MiB 逐片 `slice`)上传;
  小文本条目(manifest / meta / srt)若被别的工具 DEFLATE 过,用浏览器内置 `DecompressionStream("deflate-raw")` 解压,带字节上限。MD5 校验用自写的增量 MD5。
- 通用的纯逻辑(zip 读取、MD5)放 `admin/src/lib/`;包格式校验、批次执行器、对话框放 `admin/src/features/catalog/`(扁平文件,`package-*` 前缀)。管理端没有主包预算、页面不懒加载,不需要拆块。

**Tech Stack:** 导出脚本 Node ESM + `node:test`;管理端 React 18 + Vite + vitest + Testing Library(jsdom);服务端 FastAPI + SQLAlchemy async + alembic + pytest。

## Global Constraints

- 每个任务一个逻辑改动、一个提交(约定式前缀),提交后该任务列出的测试 + typecheck 为绿;提交信息末尾加会话提示的 `Co-Authored-By` 行。**先写失败测试,再实现。**
- **不改** `enjoy/`(及其他上游目录);桌面端**不加按钮**。导出脚本只**读**桌面端的数据目录,且读的是数据库的临时副本。**不改** `web/`(用户的跟读库添加面板不动)。
- **两边互不 import:** `scripts/enjoy-export*` 不 import `admin/`、`web/`、`server/`、`enjoy/` 的任何模块;`admin/` 不 import `scripts/`(也不 import `web/`,`admin/README.md`「与 `web/` 零代码共享」)。
  两边只共享**包格式**:本计划的「包格式规格」+ 一个由导出脚本生成、提交进仓库的黄金样例 zip(管理端测试只把它当二进制文件读)。
- **隐私:** 标题、文件名、md5、用户 id、本机路径**不进 URL、不进服务端日志 / 审计、不进测试快照**;md5 只在 POST 体与包检查回包里。包里**没有**用户 id、令牌、本机绝对路径。
  导出脚本**不读** `settings.json` 里除 `library` 以外的任何键(`user` 键里有桌面端的登录信息)。精选条目是系统内容,管理员在界面上可以看标题(spec R5),但日志 / 审计仍只有 id 与数字。
- 管理端的请求只发往本站 `/api/admin/*`;导入包功能不访问任何第三方主机。
- 文案只有中文(管理端约定),全部放 `admin/src/features/catalog/strings.ts`;新增服务端错误串同步加进 `S.errors` 映射。
- 改变目录契约的任务在同一提交里更新该目录的 `CLAUDE.md`;`server/README.md`、`admin/README.md`、`scripts/CLAUDE.md` 在各车道最后一个任务一次改完。
- 网页契约 `server/tests/fixtures/library_contract.json` **不应变化**(用户侧接口与 `item_out` 不变);若录制出差异,说明有改动越界,停下来查。
- 不跑 E2E(要真上游、花钱),不重建 / 重启容器,不运行 `scripts/deploy.sh`(用户要求时才做)。
- 命令约定:管理端 `yarn workspace admin typecheck` / `yarn workspace admin test`,单目录 `cd admin && yarn vitest run <path>`;服务端 `cd server && uv run pytest -q <files>`;
  导出脚本 `node --test scripts/enjoy-export/`。宿主机若 PATH 上没有 `yarn`,Task 0.1 先 `corepack enable && yarn install`(worktree 里按根 `CLAUDE.md` 链接 `node_modules`,含 `admin/` 若有自己的)。

## 现状调研结论(2026-10-27,`0719491c`)

### 桌面端本地数据(只读参考,修订未改)
- **数据目录不是 userData,而是「库目录」**:`config.libraryPath()` = 设置项 `library`(`enjoy/src/main/config/config-manager.ts:352-354`);
  默认值 `process.env.LIBRARY_PATH || path.join(app.getPath("documents"), "EnjoyLibrary")`(`config-schema.ts:35-37`,后缀常量 `LIBRARY_PATH_SUFFIX = "EnjoyLibrary"`,`shared/constants/index.ts:24`)。
  首次启动会把库目录的**绝对路径**写回 electron-settings 的 `library` 键(`config-manager.ts:414-427`);electron-settings 的文件默认在 Electron 的 `userData` 目录下(`settings.json`,
  可被 `SETTINGS_PATH` 环境变量改,`config-manager.ts:40-45`)。同一文件还有 `user` 键(`config-manager.ts:453`,登录信息)——**导出脚本只读 `library` 键**。
- 用户目录 = `<库目录>/<user.id>/`(`config-manager.ts:368-375`);桌面端自己按 `/^\d{8}$/` 识别会话目录(`:399-404`)。
  数据库 = `<用户目录>/enjoy_database.sqlite`(打包版;开发版是 `enjoy_database_dev.sqlite`,`:380-387`,`DATABASE_NAME`,`shared/constants/index.ts:23`),Sequelize + sqlite(`db/index.ts:104-113`)。
- `videos` 表(`underscored: true`,列为蛇形;建表 `db/migrations/1703902826529-create-video.js`,`language` 由 `1718164365171-add-language-column.js` 追加):
  `id`(uuid)、`language`(`video.ts:53`)、`source`(**原文件路径或网址,不导出**)、`md5`(唯一,`:60`,**原始导入文件**的 md5)、`name`(`:63`)、`description`、
  `metadata`(JSON,`:69`;是 ffprobe 的输出再加 `extname`、`duration`,`:383-398`——**里面有 `format.filename` 这类本机绝对路径,只取 `duration` 与 `extname`**)、`cover_url`(`:72`,远程存储网址)。
- 媒体文件:`<用户目录>/videos/<md5>.compressed.mp4`(导入时压缩,默认开,`video.ts:192-203`、`:376-380`)或 `<用户目录>/videos/<md5><extname>`(未压缩,`:178-190`);
  **压缩版的字节 md5 ≠ `videos.md5`**(后者是原始文件的)。桌面端视频扩展名 `mp4 mkv avi mov wmv flv webm`(`shared/constants/index.ts:64`),其中 `avi wmv flv` 不在云端白名单。
- 封面:`cover_url` 是桌面端云存储的网址(`video.ts:206-224`,本地只在 `cache/<hash>.png` 短暂存在)——导出脚本**不联网**,所以拿不到可靠的本地封面;云端流水线本来就给视频生成封面。
- `transcriptions` 表(`transcription.ts`):`target_id` / `target_type`(`"Video"`)/ `target_md5`(唯一,`:47`)、`state ∈ pending|processing|finished`(`:51`)、`language`、`engine`、`model`、
  `result`(JSON,`:60`,echogarden `AlignmentResult` + `originalText`):顶层 `result.timeline` 是句 / 段级条目 `{type, text, startTime, endTime, timeline?}`,**时间单位为秒**
  (渲染端按 `transcription.result.timeline[i]` 逐句播放,`renderer/components/medias/media-bottom-panel/media-player-controls.tsx:75-108`;类型 `shared/types/index.d.ts:266-274`)。
  `processing` 超时后读出时会被改成 `finished`(有 `result`)或 `pending`(`transcription.ts:120-132`)——导出脚本读副本、不触发这条逻辑,所以以库里的原值为准。
- 桌面端的 `Audio`(音频素材,如播客)与 `Recording`(跟读录音)**不在范围**,只导出 `videos`。

### 管理端精选库的上传(本计划复用;修订时重新调研)
- **入口与权限:** 路由 `server/app/routers/admin_catalog.py`(前缀 `/api/admin/library/catalog`,uuid 路径参数 `CatalogUuid`,错误体 `{"error": …}`),业务在 `server/app/admin/catalog_admin.py`。
  上传开始 `POST /uploads`(`require("operator")`,体 `UploadIn{filename, size, title?, level?, tags?, license_note?, ai_lang?}`,`extra="forbid"`,`admin_catalog.py:52-55`、`:146-154`)。
- **管理端上传的约束(用户的额度一概不适用):** `start_upload`(`catalog_admin.py:129-146`)只查 ① `library_available`(总开关 + ffmpeg/ffprobe,否则 503 `Media tools are not installed`)、
  ② 扩展名 ∈ `limits.UPLOAD_EXTENSIONS`(含 `mp4 m4v mov webm mkv`,否则 400 `Unsupported file type`)、③ `size ≤ library_max_upload_mb × MB`(否则 413 `File is too large`)。
  **没有**每日新建次数、空间、条目数、同时 2 个上传的限制(那些是用户库 `limits.admit_new_item` 的,spec E7)。
  `library_max_upload_mb`:`core/config.py:306` 默认 **500**,范围 1–20,000,`settings_registry.py:441` 可在管理端热改;**对管理端精选上传与替换媒体都生效**(`catalog_admin.py:135`、`:241`),并经 `state.max_upload_mb` 下发给管理端(`:79`)。
  时长上限 `library_max_duration_minutes`(默认 90,`config.py:307`)在处理阶段检查(`catalog_import.py:93-94`,`too_long`);暂存盘剩余 < 2 × 源文件 → `disk_full`(`:95-96`)。
- **分片:** `PUT /uploads/{id}/chunks/{n}`(multipart 字段 `chunk`,≤ 8 MiB + slack,`admin_catalog.py:157-163`);`put_chunk` 幂等重发、严格顺序、大小精确(`catalog_admin.py:160-183`,与用户上传同规则)。
  **没有** `GET` 上传进度端点,但列表行 `admin_out` 带 `upload_received` / `upload_total`(`catalog_store.py:86-98`);重发已收过的分片会被接受并原样返回状态,所以从任意已收分片处接着发即可续传。
  原始上传存在 `library/_catalog/_tmp/<id>/upload.<ext>.part`;精选库**没有**超时清扫上传中的条目(用户库的清扫不碰 `_catalog/_tmp`),停在 `uploading` 的条目由管理员「取消」。
- **字幕:** `PUT /uploads/{id}/subtitles`(multipart `file`,≤ 2 MiB,`admin_catalog.py:166-172`),**收到就解析校验**(400 `Invalid subtitle file`),写到暂存 `UPLOADED_SUBS`;
  只在 `uploading ∧ seg_count = 0` 或 `failed(no_subtitles)` 时允许,**替换媒体期间 409 `Subtitles cannot be changed now`**(`catalog_admin.py:186-204`,keep-video R-KV8)。
  处理时上传的字幕优先于平台字幕与识别(`catalog_import.py:_sentences`),所以带 SRT 的条目**不花识别费**。
- **完成与队列:** `POST /uploads/{id}/complete` → `queued` + `kick()`(`catalog_admin.py:207-222`)。`CatalogJobs`(`catalog_jobs.py`)**一次一个**、无轮询、不自动重试;
  每条:探测 → 封面 → 转码(视频 ≤ 720p / ≤ 1600 kbps,`catalog_import.py:26-38`)→ 字幕 → 分句 → 逐句翻译(`ai_lang`,系统付费,`cat_translate`)→ `ready`(未发布)。
- **去重:** `catalog_items` **没有**任何内容指纹列(`server/app/models.py:1144-1177`);`admin_out` 不含 md5;上传接口不查重。`catalog_bundle.py` 的「bundle」是服务器之间搬已处理条目
  (`bundles/<id>/manifest.json` + 已在存储里的媒体,sha256 校验),与本计划的导出包无关,不复用。
- **「只替换媒体」的真实语义(keep-video R-KV5–R-KV9):**
  - `POST /{id}/replace-media`(`ReplaceIn{filename, size}`,`admin_catalog.py:181-186`)→ `start_replace`(`catalog_admin.py:225-260`):只允许 `ready ∧ seg_count > 0 ∧ 未发布 ∧ 未退役`
    (已发布 409 `Item is published`、退役 409 `Item is retired`);状态改 `uploading`、清暂存、写 `replace.flag`;分片与 complete 复用上传接口。
  - 任务 `process` 发现 `seg_count > 0` 且有 `replace.flag` → `_replace_stage`(`catalog_import.py:162-221`):探测;**新时长与原时长相差 > max(2 s, 2%) → `unsupported_format` 失败**(R-KV7);
    转码;新媒体写到**新键**(`media.mp4` ↔ `media-2.mp4`,`_fresh_name`,R-KV6),封面原位替换;**同一个事务**里更新目录行并 `sync_copies`,提交后才删旧文件;
    提交前任何失败只删新文件,旧媒体与副本不动;失败 → `catalog_store.fail` 把有句子的条目放回 `ready` 并保留 `error_kind`(`catalog_store.py:213-223`),暂存整个删掉(R-KV9,`catalog_jobs.py:98-104`)。
    之后照常进翻译阶段(只译缺的句子)→ `ready`。**句子(`catalog_segments`)完全不动,不能带新字幕。**
  - `catalog_store.sync_copies`(`catalog_store.py:401-411`)对每个副本只改:`kind`、`media_path`、`media_mime`、`poster_path`、`duration_ms`、`updated_at`。
    **副本保留**(不读不写):标题(用户可能改过)、全部句子行 `library_segments`(文字、起止时间、译文 `zh`、分析、`flags`、说话人 `speaker`,含用户的句子编辑)、
    跟读成绩 `library_attempts`(按 `item_id + seg_idx + text_hash`)、配音录制 `library_dubs`(按 `item_id`)、续播位置 `resume_ms` / `resume_idx`、`last_opened_at`、角色名 `role_names`。
    **没有任何东西被清空**;代价是:副本是「添加时的复制」(spec D6 / E10),目录换了句子,**已有副本不会跟着换**,只有之后新添加的副本拿到新句子。
- **管理端前端:** `admin/src/features/catalog/`:`api.ts`(`startUpload` / `putChunk` / `putSubtitles` / `completeUpload` / `startReplace` / `cancel` …,snake → camel)、
  `upload.ts`(`uploadChunks(id, file: Blob, chunkBytes, onProgress, signal)`,逐片串行、每片重试 2 次、可中止;**总是从第 0 片开始**)、`upload-dialog.tsx`(对话框内「建条目 → 分片 → 字幕 → complete」,关闭 = 中止)、
  `replace-media.tsx`、`meta-fields.tsx`(标题 / 级别 / 标签 / 许可 / 译文语言)、`catalog-page.tsx`(工具栏按钮 + 表格,3 秒轮询)、`strings.ts`(含 `S.errors` 映射)。
  依赖只许 `../../api/*`、`../../components/*`、`../../hooks/*`、`../../lib/*`(`features/catalog/CLAUDE.md`)。测试一律 mock `./api`(计划 P-7)。
  `admin/package.json` 无 zip / md5 依赖;`@types/node` 在 devDependencies(测试里可 `readFileSync` 黄金样例)。构建目标 `es2020, safari15`(`admin/vite.config.ts`);仅桌面(< 1024px 整页提示)。
  管理员会话空闲 30 分钟过期(`admin_idle_minutes`,`config.py:348`);连续的分片请求会保持活跃。
- 迁移最新是 `0032_wordbook_simple_defs.py`(修订时 `ls server/alembic/versions` 核对)→ 本计划用 **0033**(Task 0 再查)。
- 宿主机 Node 是 v24.22.1,根 `package.json` 要求 `>=20`。

## 依赖边

| 车道 | 用到的已允许边 | 新增边 |
|---|---|---|
| E 导出 | 只用 Node 内置模块(`node:sqlite`、`node:zlib`、`node:fs`、`node:readline`、`node:crypto`) | 无;不 import 仓库内任何其他模块 |
| S 服务端 | `app/routers → app/admin`、`app/admin → app/library`(已有);`app/library → app.core / app.models / app.services` | 无(`tests/test_architecture.py` 不改) |
| A 管理端 | `features/catalog/* → ./`(同 feature)、`../../api/*`、`../../components/*`、`../../hooks/*`、`../../lib/*` | 无;`lib/zip-reader.ts`、`lib/md5.ts` 是新文件但 `lib` 本来就是允许边;`lib` 不 import 任何 feature |

## 裁定(Rulings)

### 包格式(修订未改语义)

- **R-P1 文件布局**(zip 内路径,全部 ASCII、正斜杠、无目录条目也可):
  ```
  manifest.json
  items/<source_md5>/meta.json
  items/<source_md5>/media.<ext>        # ext ∈ mp4 m4v mov webm mkv(云端白名单里的视频扩展名)
  items/<source_md5>/subtitle.srt
  items/<source_md5>/cover.<jpg|png>    # 保留名:v1 导出器不写,v1 导入器忽略(R-E6)
  ```
  `<source_md5>` = 桌面端 `videos.md5`(32 位小写十六进制)。导入器**只认**符合下列正则的条目,其他条目一律忽略(不报错、不读):
  `^manifest\.json$`、`^items/[0-9a-f]{32}/(meta\.json|subtitle\.srt|media\.(mp4|m4v|mov|webm|mkv)|cover\.(jpg|png))$`。
- **R-P2 `manifest.json`(v1)精确 schema**(UTF-8 JSON,无 BOM,≤ 1 MiB,未知键忽略):
  ```json
  {
    "format": "enjoy-video-export",          // 固定串;不等 → 拒收整个包
    "version": 1,                             // 整数;导入器只收 1(R-P4)
    "exported_at": "2026-10-27T08:00:00Z",    // ISO-8601 UTC
    "generator": "enjoy-export/1",            // 导出器名/版本,只做诊断
    "items": [                                // 0–1000 项,按导出顺序;source_md5 不得重复
      {
        "source_md5": "0123…cdef",            // ^[0-9a-f]{32}$,= 目录名
        "title": "string",                    // 1–200 个字符(已去控制字符、首尾空白)
        "language": "en-US",                  // string ≤ 16 或 null
        "duration_ms": 123456,                // 正整数或 null
        "media_bytes": 104857600,             // 正整数 = media.<ext> 的字节数
        "media_md5": "…",                     // ^[0-9a-f]{32}$,媒体字节的 md5(≠ source_md5,见现状)
        "subtitle_cues": 321                  // 1–20000
      }
    ],
    "skipped": { "not_transcribed": 2, "media_missing": 1 }   // 只有原因 → 条数;没有标题、没有 md5
  }
  ```
  **不含**:用户 id、令牌、本机路径、原文件名、`videos.source`、`cover_url`、ffprobe 元数据、导出机器信息。
  **两个 md5 的分工:** `source_md5`(原始文件指纹)是**去重键**,在服务端存进 `catalog_items.source_md5`;`media_md5`(包里媒体字节的指纹)只用于导入前的完整性校验,不上服务端。
- **R-P3 `meta.json`(v1)**(≤ 64 KiB,与 manifest 中同一项冗余,用于单条校验,未知键忽略):
  ```json
  {
    "version": 1,
    "source_md5": "…", "title": "…", "language": "en-US" | null, "duration_ms": 123456 | null,
    "media":    { "name": "media.mp4", "bytes": 104857600, "md5": "…", "compressed_by_enjoy": true },
    "subtitle": { "name": "subtitle.srt", "bytes": 20480, "md5": "…", "cues": 321,
                  "from": "enjoy-transcription", "engine": "string|null", "model": "string|null" }
  }
  ```
  `engine` / `model` 只是诊断(桌面端识别引擎名,≤ 64 字),导入器不用。manifest 与 meta 的同名字段不一致 → 该条目判 `bad_meta` 跳过。
- **R-P4 版本策略:** `version` 只在**不兼容**变化时加 1(例:改目录布局、改 SRT 以外的字幕格式、媒体允许 DEFLATE);**新增可选键不升版本**,读者一律忽略未知键。
  导入器:`version === 1` 收;`> 1` 拒收并提示「这个包来自更新的导出脚本,请更新管理后台后再试」;缺失 / 非整数 → 「不是有效的导入包」。导出器只写当前版本。
- **R-P5 zip 约束(导出器保证、导入器校验):**
  - 压缩方法:导出器**全部用 STORE(0)**;导入器对 `media.*` **只收 STORE**(否则该条 `media_compressed` 跳过,提示用导出脚本原包),对 manifest / meta / srt 收 STORE 或 DEFLATE(8);其他方法、加密位(通用标志 bit 0)、多分卷 → 拒收整个包。
  - 需要时用 ZIP64(单条 ≥ 4 GiB 或偏移 ≥ 4 GiB 或条目数 ≥ 65535);导入器必须支持 ZIP64 EOCD / locator 与中央目录里的 ZIP64 扩展字段。
  - 文件名用 UTF-8(通用标志 bit 11);不写数据描述符(bit 3 清零,本地头里就有 CRC 与大小);每条的 DOS 时间 = `exported_at`。
  - 导出器自己保证 `CRC32` 正确;导入器**不**校验 CRC(媒体用 md5,R-A3)。
- **R-P6 导入器的安全上限(全部是代码常量,超了给固定提示,不读条目内容):**
  中央目录 ≤ 8 MiB、条目数 ≤ 5000、manifest 项 ≤ 1000;条目路径不得含 `..`、`\`、开头 `/`、盘符 `X:`、NUL、控制字符,且必须命中 R-P1 正则(不命中直接忽略,命中但重复 → 拒收整个包);
  每条的「本地头 + 数据」区间必须完全落在文件内,且与其他条目区间**不重叠**(挡住重叠条目式 zip bomb);
  manifest ≤ 1 MiB、meta ≤ 64 KiB、srt ≤ 2 MiB(同服务端 `SUBTITLE_MAX_BYTES`,`limits.py:26`):压缩大小、声明的解压大小**和实际解压时的计数**三者都卡,DEFLATE 解压边读边数,超过上限立刻中止(zip bomb);
  媒体:STORE 下压缩 = 解压大小,必须 = `media_bytes`,且 ≤ `state.maxUploadMb`(管理端 `GET /api/admin/library/catalog` 的 `state.max_upload_mb`;超了该条 `too_large` 跳过,不发请求)。
  **导入器从不把任何条目写到文件系统**,所以没有路径穿越写盘的问题;正则与区间检查是为了不读到包外 / 伪造的数据。

### E 本地导出(`scripts/enjoy-export.mjs` + `scripts/enjoy-export/`;修订只改了黄金样例路径与 R-E5 的上限说明)

- **R-E1 形态与依赖:** 入口 `scripts/enjoy-export.mjs`(薄 CLI),实现分模块放 `scripts/enjoy-export/{locate,enjoy-db,srt,zip-writer,export}.mjs`,测试 `scripts/enjoy-export/*.test.mjs`(`node --test`)。
  **零 npm 依赖**,要求 Node ≥ 22.13(`node:sqlite` 免开关的最低版本,Task 0.3 实测确认;更低版本时脚本打印要求后退出码 2)。根 `package.json` 加 `"export:enjoy": "node scripts/enjoy-export.mjs"` 与 `"scripts:test": "node --test scripts/enjoy-export/"`。
  不 import `enjoy/`(那边是 TypeScript + Electron + Sequelize,本脚本直接读 SQLite)。
- **R-E2 命令行:**
  ```
  node scripts/enjoy-export.mjs [--library <库目录>] [--user <用户目录名>] [--db <sqlite 文件>]
                                [--out <zip 路径>] [--pick | --list] [--force] [--dev]
  ```
  - `--library` 缺省时按 R-E3 定位;`--db` 直接指定数据库(媒体目录 = 它所在目录下的 `videos/`),优先级最高。
  - 库目录下有多个用户目录(含 `enjoy_database.sqlite` 的子目录)且没给 `--user` → 列出目录名后退出码 2(目录名是桌面端的数字用户 id,只打印在本机终端,不进包)。
  - `--dev` 改读 `enjoy_database_dev.sqlite`。
  - `--out` 缺省 = 当前目录 `enjoy-export-YYYYMMDD-HHmm.zip`;目标已存在且没 `--force` → 退出码 2。根 `.gitignore` 加 `/enjoy-export-*.zip` 与 `*.zip.partial`,防止误提交媒体。
  - `--list`:只打印清单(序号、标题、时长、大小、状态 / 跳过原因)后退出,不写文件。
  - `--pick`:打印同样的清单,用 `node:readline` 读一行选择(`all` / `1,3,5-8`,空行 = 取消,退出码 0),只导出可导出的被选项;非 TTY 时 `--pick` 报错退出码 2。大包靠 `--pick` 手动分批(不做自动分卷)。
- **R-E3 定位库目录(写清各平台,未在真机验证的标出):**
  1. 环境变量 `LIBRARY_PATH`(桌面端同名变量,`config-schema.ts:36`)。
  2. electron-settings 文件 `settings.json` 的 `library` 键(`SETTINGS_PATH` 环境变量优先),文件位置 = Electron `userData`:
     Windows `%APPDATA%\Enjoy\settings.json`;macOS `~/Library/Application Support/Enjoy/settings.json`;Linux `${XDG_CONFIG_HOME:-~/.config}/Enjoy/settings.json`。
     目录名 `Enjoy` 来自 `enjoy/package.json` 的 `productName`(Electron 以它作 `app.name`)——**未在三个平台的安装版上验证**。只解析 JSON、只取 `library`,其余键不读进变量、不打印。
  3. 回退默认 `<文档>/EnjoyLibrary`:Windows `%USERPROFILE%\Documents\EnjoyLibrary`(**文档被 OneDrive 重定向时会不同**,桌面端用的是系统已知文件夹,脚本拿不到;此时提示用 `--library`);
     macOS `~/Documents/EnjoyLibrary`;Linux 先读 `~/.config/user-dirs.dirs` 的 `XDG_DOCUMENTS_DIR`,否则 `~/Documents/EnjoyLibrary`。
  4. 都找不到 → 打印上面尝试过的位置(本机路径只在终端出现)+ 「请用 --library 指定」,退出码 2。
- **R-E4 读数据库:** 先把 `enjoy_database.sqlite`(以及存在时的 `-wal` / `-shm`)复制到 `os.tmpdir()` 下的新建私有目录(`mkdtemp`),用 `new DatabaseSync(copy, { readOnly: true })` 打开副本,结束(含异常、Ctrl-C)时删掉副本目录。
  这样桌面端开着也不会被锁、不会被改。提示语建议导出前关掉 Enjoy(复制瞬间正在写入时副本可能不一致,**未验证**)。查询:
  ```sql
  SELECT v.id, v.md5, v.name, v.language, v.metadata,
         t.state, t.result, t.language AS t_language, t.engine, t.model
  FROM videos v
  LEFT JOIN transcriptions t ON t.target_type = 'Video' AND (t.target_id = v.id OR t.target_md5 = v.md5)
  ORDER BY v.created_at
  ```
  (同一视频若匹配到多行转写,取 `state = 'finished'` 且 `updated_at` 最新的一行。)`metadata` / `result` 是 JSON 文本,`JSON.parse` 失败 → 该条 `bad_record` 跳过。
- **R-E5 每条视频的判定(按顺序,命中即跳过并计入汇总):**
  | 原因码 | 条件 |
  |---|---|
  | `not_transcribed` | 没有转写行,或 `state != 'finished'`(含 `pending` / `processing`) |
  | `no_timeline` | `result.timeline` 不是非空数组(只有纯文本、没有时间) |
  | `empty_subtitle` | 转成 SRT 后 0 条 cue |
  | `subtitle_too_large` | SRT > 2 MiB 或 cue > 20,000(与服务端上限一致,`limits.py:26-27`) |
  | `media_missing` | `videos/<md5>.compressed.mp4` 与 `videos/<md5><extname>` 都不存在 |
  | `unsupported_format` | 只有原文件且扩展名不在 `mp4 m4v mov webm mkv` 内(如 `avi wmv flv`) |
  | `bad_record` | md5 不是 32 位十六进制、JSON 解析失败 |
  | `read_error` | 读媒体时 IO 错误(该条已写入的部分无法撤回 → 整个导出失败,见 R-E8) |
  媒体选择:**优先压缩版** `<md5>.compressed.mp4`(更小,且是 mp4),否则原文件。`extname` 取 `metadata.extname`,缺省用 `.mp4` 试探。
  单条 > 500 MB(`library_max_upload_mb` 的默认值;它对管理端精选上传同样生效)**不跳过**,但在汇总里标「可能超过云端单文件上限」(导出侧不连云端,不知道实际配置;管理端预览按实际值判)。
- **R-E6 字段取值:** 标题 = `name` 去控制字符、压空白、截到 200 字,空则 `"Enjoy video"`;语言 = `videos.language ?? transcriptions.language ?? null`(≤ 16 字,否则 null);
  时长 = `round(metadata.duration × 1000)`(非有限正数 → null)。**不导出** `source`、`description`、`cover_url`、`metadata` 的其余字段。**v1 不导出封面**(没有可靠的本地封面文件且不联网;云端流水线自己截封面,用户已确认)。
- **R-E7 SRT 转换(`srt.mjs`,纯函数):** 取 `result.timeline` 顶层条目;`text` 压成单行(换行 → 空格,压连续空白,去首尾空白),空的丢弃;
  `start = round(startTime × 1000)`、`end = round(endTime × 1000)`,非有限数丢弃,`start < 0` 归零,`end <= start` 丢弃;按 `start` 稳定排序;**不**修改重叠(服务端分句器会处理,`segment.finish` 保证不重叠)。
  输出 `序号\nHH:MM:SS,mmm --> HH:MM:SS,mmm\n文本\n\n`,UTF-8 无 BOM,`\n` 换行(服务端解析 `\r\n` / `\n` 都收)。丢弃的条数只计数进汇总。
  **秒为单位是读渲染端代码得出的推断,Task 0.2 用真实数据库确认**;若真实数据里有毫秒单位或嵌套形状,改这里并补用例。
- **R-E8 流式写 zip(`zip-writer.mjs`):**
  - 对每个成员先**流式读一遍**算 `size`、`crc32`(`zlib.crc32(chunk, prev)`)与 `md5`(`crypto.createHash('md5')`),再写本地头(大小已知,无数据描述符),然后 `stream.pipeline(createReadStream, out, {end:false})` 写数据(背压由 pipeline 处理,内存只占一个 64 KiB 缓冲);
    第二遍读到的字节数与第一遍不同 → `read_error`(文件在导出期间被改)→ 整个导出失败。媒体因此读两遍(本地磁盘,换来不需要数据描述符的简单格式)。
  - 中央目录项只在内存里保留元数据(每条几十字节);最后写中央目录、按需写 ZIP64 EOCD + locator,再写 EOCD。
  - 写到 `<out>.partial`,`fsync` 后 `rename` 成 `<out>`。开始前用 `fs.statfs` 检查目标盘剩余空间 ≥ 预计总大小 + 1%,不够 → 退出码 2,不开始。
  - 成员顺序:每条 `meta.json`(需要媒体与字幕的 md5,所以先算再写)→ `subtitle.srt` → `media.*`;最后写 `manifest.json`。
- **R-E9 中断与汇总:** Ctrl-C / SIGTERM / 任何异常 → 关闭输出流、删除 `.partial` 与数据库副本,打印「已中断,未生成文件」,退出码 130(信号)或 1(错误)。**不做断点续导**:重新运行即可(用 `--pick` 分批)。
  成功时打印:导出条数与总大小、输出路径;按原因分组列出被跳过的条目(**标题只打印在本机终端**,不写日志文件、不写进包——包里只有 `skipped` 计数)。
  有导出条目 → 退出码 0;一条都没有 → 不生成文件,退出码 3。
- **R-E10 不做:** 音频条目(Enjoy 的 Audio,如播客)与用户跟读录音(Recording)都**不导出**;不上传、不联网、不读令牌、不改桌面端数据。

### S 服务端最小改动(修订:目标改为精选库)

- **R-S1 新列 `catalog_items.source_md5`:** `String(32)` 可空,索引 `ix_catalog_items_source_md5 (source_md5)`(**非唯一**:失败 / 取消 / 退役的旧行可以与新行同 md5);
  迁移 `0033_catalog_source_md5.py`,`batch_alter_table`(SQLite 与 Postgres 同一路径,照 `0031_chat_home.py:27`),`downgrade` 删索引与列。只有导入包创建的目录条目有值;链接导入、手动上传、bundle 导入恒为 NULL
  (所以早先手动上传的同一视频**不会**被识别为「已存在」,见风险)。**不进** `admin_out`、`public_out`、副本(`add_to_library` 不复制它)、`catalog_bundle` 的 manifest、审计、日志。
  `library_items` **不加列**(用户库不参与)。
- **R-S2 管理端上传开始可带 `source_md5`:** `admin_catalog.UploadIn.source_md5: str | None = Field(None, pattern=r"^[0-9a-f]{32}$")`;`catalog_admin.start_upload(..., source_md5=...)` → `catalog_store.create(..., source_md5=...)`。
  有值时在建行**之前**查:已有同 md5、`retired_at IS NULL` 且 `status ∈ (uploading, queued, processing, ready)` 的目录条目 → 409 `Item already imported`(两个标签页 / 双击同时导入时不重复建条)。
  `failed` / `canceled` / 已退役的旧行不拦。日志行不变(只有 catalog id 与字节数);审计 `catalog.upload` 的 `after` 加布尔 `package: true`(不放 md5)。
- **R-S3 包检查端点 `POST /api/admin/library/catalog/packages/check`**(`require("operator")`,写在 `/{catalog_id}` 系列路由**之前**注册;不改任何状态):
  体 `{source_md5s: [str]}`(1–1000 个,每个匹配上面的正则,`extra="forbid"`);回包
  ```json
  { "matches": [ { "source_md5": "…", "catalog_id": "…", "title": "…", "status": "ready", "published": false, "retired": false,
                   "seg_count": 321, "duration_ms": 123456, "media_missing": false, "refs": 3,
                   "upload_received": 0, "upload_total": 0 } ] }
  ```
  `matches` 只含请求里给的 md5,同一 md5 多行时按 `created_at` 新的在前全部返回;`title` 可以给(目录是系统内容,spec R5);`refs` = 副本数(`catalog_store.ref_counts`)。
  单文件上限不重复返回(管理端已有 `state.max_upload_mb`)。md5 只在请求体与响应体里;日志一行 `library catalog package check n=<个数> matched=<个数>`;不写审计(只读)。
  `catalog_store` 加 `find_by_source_md5(session, md5s) -> list[CatalogItem]`。
- **R-S4 「替换媒体」可同时换字幕(覆盖的最小扩展):**
  - `put_subtitles`(`catalog_admin.py:186-204`)放宽 R-KV8:状态 `uploading ∧ seg_count > 0 ∧ 暂存里有 replace.flag` 时**也接受**字幕(仍是收到就解析,400 `Invalid subtitle file`),写到暂存 `UPLOADED_SUBS`。
    其余状态的 409 `Subtitles cannot be changed now` 不变。现有「替换媒体」按钮(`replace-media.tsx`)不传字幕,行为不变。
  - `_replace_stage`(`catalog_import.py:162-221`):暂存里有 `UPLOADED_SUBS` 时,**在探测之前**解析并分句(`subtitles.parse` → `segment.build(pipeline.fragments(cues))`,空 → `bad_subtitle`),
    这样坏字幕在动任何文件之前就失败(旧媒体、旧句子、副本都不变)。时长校验 R-KV7 **照旧**(副本保留旧句子与旧时间,新媒体必须同长,否则副本会错位)。
    在现有的同一个提交里(目录行更新 + `sync_copies`)再调用新的 `catalog_store.rewrite_segments(session, row, sentences)`:
    重写 `catalog_segments`;**文字相同(`store.same_text`)的新句按顺序承接旧句的 `zh` / `zh_lang` / `analysis` / `analysis_lang` / `speaker`**(每条旧句最多被承接一次),其余为空;`flags` 清空;
    `sub_source = "uploaded"`、`low_confidence = false`。随后的翻译阶段只译缺的句子(现有 `_translate`)。日志 `library catalog media replaced …` 加 `sentences=<数>`。
  - 只对**未发布、未退役**的条目(沿用 `start_replace` 的检查与 spec E10「目录句子只在未发布时可改」)。**已发布的条目不能原位覆盖**,见 R-A7 与 Q1。
  - 副本:`sync_copies` 不变(只跟随媒体);副本的句子、成绩、配音、续播、译文、标题都保留,**不跟随新字幕**(spec D6 / E10「已加入的副本不随目录更新」)。
- **R-S5 不改:** `CatalogJobs`(一次一个)、转码参数、计费(系统付费 `cat_import` / `cat_translate`)、`library_max_upload_mb` 语义、分片协议、用户库的一切(`routers/library.py`、`limits.admit_new_item`、`library_contract.json`)。
  不新增设置项、不改 `.env.example`、不改 `settings_registry`、不新增 `error_kind`(`errors.ALL` 录在网页契约里)。

### A 管理端导入(`admin/src/lib/{zip-reader,md5}.ts` + `admin/src/features/catalog/package-*`)

- **R-A1 入口:** `catalog-page.tsx` 工具栏在「上传文件」旁加「导入包」按钮(`RoleGate` operator,同上传按钮;`data-testid="catalog-package-import"`),打开 `PackageDialog`(`package-dialog.tsx`,复用 `components/dialog`)。
  选择文件是一个 `<input type="file" accept=".zip,application/zip">`(同 `upload-dialog.tsx` 的写法,桌面,无 iOS 规则)。`state.available` 为假时按钮可点但对话框显示「媒体工具不可用」且「开始」禁用。
- **R-A2 zip 读取(`admin/src/lib/zip-reader.ts`,纯逻辑,输入是 `Blob`,不知道包格式):**
  读尾部 `min(size, 65,557)` 字节找 EOCD(从后往前找签名并核对注释长度)→ 有 ZIP64 locator 则读 ZIP64 EOCD → 一次 `slice` 读整个中央目录(≤ 8 MiB)→ 解析条目(含 ZIP64 扩展字段)→
  对**调用方给的名字过滤器命中的条目**再读 30 字节本地头 + 名字 / 扩展长度,算出数据起点 → 得到 `{name, method, compressedSize, size, dataStart}`;做完 R-P6 的通用检查(区间、重叠、方法、加密、分卷、路径字符)。
  对外:`openZip(blob, {accept: (name) => boolean, maxEntries, maxDirectoryBytes})` → 条目表;`entryBlob(blob, entry)` → `blob.slice(dataStart, dataStart + compressedSize)`;
  `readSmallText(blob, entry, cap)` → 字符串(STORE 直接读,DEFLATE 经 `DecompressionStream("deflate-raw")` 边读边数)。`DecompressionStream` 不存在且遇到 DEFLATE 文本 → 固定原因码 `deflate_unsupported`。
  **整个过程只有中央目录与小文本进内存。** 读 Blob 字节只经一个内部助手 `bytesOf(blob)`(优先 `blob.arrayBuffer()`,缺失时用 `FileReader`),以免 jsdom 的 `Blob` 能力差异影响测试(Task 0.5 核对)。
- **R-A3 校验(`features/catalog/package-model.ts` + `admin/src/lib/md5.ts`):**
  - `parsePackage(blob, {maxUploadMb})`:用 R-P1 正则作 `accept`;`parseManifest` / `parseMeta` 按 R-P2 / R-P3 逐键校验(类型、范围、正则),错误收敛成固定原因码
    (`not_package` / `newer_version` / `bad_manifest` / `bad_meta` / `missing_entry` / `media_compressed` / `too_large` / `duplicate` / `deflate_unsupported`)。
    manifest 里的每一项必须有 meta、srt、恰好一个 media 条目;条目大小必须等于 manifest / meta 的声明;不一致的那一项判跳过,其余照常。
  - `md5.ts`:自写增量 MD5(RFC 1321,约 120 行,无依赖),`md5Blob(blob, {signal, onProgress})` 以 4 MiB 为块逐块喂入。
    **上传前**校验该条媒体与字幕的 md5 = meta 声明;不符 → 该条 `checksum` 失败,不发任何请求。媒体因此被读两遍(校验一遍、上传一遍),换来上传逻辑零改动。
  - 标题再清一次(去控制字符、≤ 200 字);**语言非空且不以 `en` 开头(大小写不敏感)的条目在预览里默认不勾选**并标「非英语」,管理员可以手动勾上;语言为 null 的条目默认勾选。
- **R-A4 预览(选文件后、开始前,在对话框里):**
  - 调 `POST /api/admin/library/catalog/packages/check`(manifest 里全部 md5,每 1000 个一批)。每项按**最新一条未退役的匹配**归类:
    | 类别 | 条件 | 跳过模式 | 覆盖模式 |
    |---|---|---|---|
    | `new` | 无匹配,或只有 `failed` / `canceled` / 已退役的匹配 | 新建 | 新建 |
    | `exists` | `ready ∧ 未发布 ∧ seg_count > 0 ∧ !media_missing` | 跳过 | **原位替换媒体 + 字幕**(R-A7) |
    | `published` | `ready ∧ 已发布` | 跳过 | 跳过,标「已发布:先下架才能覆盖」(Q1) |
    | `resumable` | `uploading ∧ seg_count = 0 ∧ upload_total = media_bytes` | 续传 | 续传 |
    | `busy` | 其他 `uploading`(含替换中)、`queued`、`processing`,或 `ready` 但 `media_missing` | 跳过 | 跳过 |
    | `skip_local` | 本地校验已判跳过(`too_large`、`media_compressed`、`bad_meta`、`missing_entry` …;管理端 `state` 不含时长上限,`too_long` 不在本地判,由服务端处理阶段判) | 不能导入 | 不能导入 |
    `new` 里有失败 / 取消的旧行时,标一句「表格里有一条失败的旧条目,可在导入后删除」(导入器不替管理员删,删除要理由与确认串)。
  - 批次元数据(`meta-fields.tsx` 去掉标题后复用):级别、标签、许可说明、译文语言(默认 `zh-CN`)——**对本批所有新建条目相同**;标题逐条取自包(以后可在详情里改)。覆盖时不改元数据。
  - 显示:总数与总大小;新建 / 已存在 / 已发布 / 可续传 / 进行中 / 不能导入 各多少;单选「已存在的条目:**跳过**(默认)/ **覆盖**」(`role="radiogroup"`,`data-testid="package-existing-mode"`),
    选「覆盖」后出现一行说明(R-A7 的保留 / 不保留);逐条列表(标题、语言、时长、大小、类别,带勾选框)。
  - 「开始导入(N 个)」;N = 勾选的 `new` + `resumable` + (覆盖时)`exists`。
- **R-A5 上传复用:** `api.ts` 的 `startUpload(filename, size, meta)` 加可选 `sourceMd5`(体里 `source_md5`;不给时请求体与今天逐字节相同);新增 `checkPackage(md5s)`。
  `upload.ts` 的 `uploadChunks` 加可选参数 `startChunk = 0`(续传从 `floor(upload_received / chunkBytes)` 起;服务端对重发的已收分片幂等),默认值下行为不变。
  每条新建:`startUpload("media.<ext>", media_bytes, {...批次元数据, title, sourceMd5})` → `uploadChunks(id, entryBlob(media), …)` → `putSubtitles(id, entryBlob(srt), "subtitle.srt")` → `completeUpload(id)`。
  文件名用中性名 `media.<ext>` / `subtitle.srt`(只用来让服务端取扩展名)。
- **R-A6 批次执行器(`features/catalog/package-runner.ts`,纯逻辑 + 注入的 api,UI 用 `useSyncExternalStore` 订阅):**
  - **一次只传一条**,顺序 = manifest 顺序。
  - **处理背压(新):** 服务端队列一次处理一个,而每条原始上传在处理前一直占着暂存盘(`library/_catalog/_tmp/<id>/`)。执行器在开始下一条上传前,若本批已完成上传、仍在 `queued` / `processing` 的条目 ≥ 2,
    就每 3 秒拉一次 `fetchCatalog()` 等它降下来(`waiting: "queue"`,显示「等待服务器处理前面的条目」)。这样暂存盘最多压着约 3 份原始文件。
  - 每条的步骤:md5 校验 → (新建)`startUpload` / (续传)沿用旧 id / (覆盖)`startReplace(旧 id, "media.<ext>", media_bytes)` → `uploadChunks` → `putSubtitles` → `completeUpload`。
  - 错误分流(按 `ApiError` 的状态与固定英文串,不按文字猜):
    | 情况 | 处理 |
    |---|---|
    | 503 `Media tools are not installed` | **暂停**整批 `paused: "unavailable"` |
    | 401 / 会话过期 | **暂停** `paused: "auth"`,「请重新登录后点继续」(当前条目保留 id,继续时续传) |
    | 网络 / 5xx(`uploadChunks` 自己的 2 次重试之后) | **暂停** `paused: "network"`,当前条目保留 id,「继续」时从服务端已收的分片续传 |
    | 409 `Item already imported` | 该条记为「已存在,跳过」 |
    | 409 `Item is published` / `Item is retired` / `Item is not ready`(覆盖时状态已变) | 该条跳过并写明原因 |
    | 400 `Unsupported file type` / 413 `File is too large` / 400 `Invalid subtitle file` / `checksum` / 其他 4xx | 该条**失败**,继续下一条;已建的新条目(字幕被拒时)用现有 `cancel(id)` 取消(`uploading → canceled`,删暂存);覆盖中的条目 `cancel` 后回到 `ready`(`_stop` 对有句子的条目恢复,旧媒体不动) |
    403 `Step-up required` 由 `api/client.ts` 现有逻辑弹二次验证并重放,执行器不处理。
  - 「继续」从当前条目接着跑;「停止」= 中止当前分片上传(条目留在 `uploading`,下次选同一个包时被识别为「可续传」)并结束批次。
  - **对话框内运行**(与 `upload-dialog.tsx` 一致,不另做后台卡片):运行中点遮罩 / Esc 不关闭,只有「停止」;运行中挂 `beforeunload` 提示。进度:`已完成 a / 共 n`、当前条目标题与百分比、暂停原因与「继续 / 停止」;
    结束后显示汇总:新建(已上传,服务器处理中)/ 覆盖 / 续传 / 跳过(已存在、已发布、进行中)/ 失败(逐条标题 + 中文原因)/ 未开始。背后的表格照常 3 秒轮询,能看到处理进度。
  - **关页后的续传**:浏览器拿不到原 `File`,只能重新选择同一个包;预览把已完成的识别为「已存在」(默认跳过),把传了一半的识别为「可续传」。批次状态只在内存里,不写 `localStorage` / `sessionStorage`(里面有标题与 md5)。
- **R-A7 覆盖的语义(原位替换,复用「替换媒体」):** 只对 `exists`(未发布、未退役、ready、有句子、媒体在)做:`startReplace` → 分片 → `putSubtitles`(R-S4 放宽后接受)→ `completeUpload`,服务端 `_replace_stage` 原位替换。
  - **保留:** 目录条目 id、标题 / 级别 / 标签 / 许可 / 译文语言、发布状态(仍未发布)、文字没变的句子的译文 / 分析 / 说话人;**所有学习者副本**及其句子、跟读成绩、配音、续播位置、译文、用户改过的标题与句子(R-S4、现状「sync_copies」)。
  - **变化:** 目录的媒体与封面(新文件,副本自动改用);目录句子按新字幕重建,改了文字的句子译文由系统重新翻译(费用系统出);手动改过的目录句子会被新字幕覆盖。
  - **不跟随:** 已有副本的句子仍是添加时的那份(spec E10);只有之后新添加的人拿到新句子。说明文案写在「覆盖」选项下。
  - 失败时(时长不一致 `unsupported_format`、字幕坏、转码失败):条目回到 `ready` 并带 `error_kind`,旧媒体、旧句子、副本**全部不变**(R-KV7 / R-KV9)。
  - 不做「删旧建新」:精选条目有副本时删除只会退役,建新条目会让旧副本永远停在旧条目上。
- **R-A8 不改:** `upload-dialog.tsx`、`import-dialog.tsx`、`replace-media.tsx` 的行为(`uploadChunks` 只加带默认值的参数);`web/` 一行不改;不新增 npm 依赖;管理端无主包预算,不做懒加载。

## 文件结构(本计划触碰的文件)

- 导出 E:`scripts/enjoy-export.mjs`(新)、`scripts/enjoy-export/{locate,enjoy-db,srt,zip-writer,export}.mjs` 与 `*.test.mjs`(新)、`scripts/enjoy-export/fixtures/make-fixture.mjs`(新,测试里现造 SQLite 与假媒体)、
  `scripts/CLAUDE.md`、根 `package.json`(两个脚本命令)、根 `.gitignore`、黄金样例 `admin/src/features/catalog/fixtures/enjoy-export-v1.zip`(由 E4 生成,A6 读)。
- 服务端 S:`server/app/models.py`、`server/alembic/versions/0033_catalog_source_md5.py`(新)、`server/app/library/{catalog_store.py,catalog_import.py,CLAUDE.md}`、`server/app/admin/catalog_admin.py`、
  `server/app/routers/admin_catalog.py`、`server/tests/{test_migration_0033.py(新),test_admin_catalog_package.py(新),test_admin_catalog_replace.py,test_migrations.py}`(head 钉子按 Task 0.4 实际位置改)、`server/README.md`。
- 管理端 A:新 `admin/src/lib/{zip-reader,md5,test-zip}.ts` 与测试(`test-zip.ts` 是测试专用 zip 生成器);`admin/src/features/catalog/{api.ts,upload.ts,catalog-page.tsx,strings.ts,CLAUDE.md}`、
  新 `admin/src/features/catalog/{package-model.ts,package-runner.ts,package-dialog.tsx,package-preview.tsx}` 与测试、`fixtures/`;`admin/README.md`(catalog 一行)。

## Task 0:核对(不提交)

- [ ] **0.1** 从 `main` 拉三条分支(`feat/enjoy-export`、`feat/catalog-source-md5`、`feat/catalog-package-import`,各一个 worktree,`node_modules` 按根 `CLAUDE.md` 链接);确认上文 文件:行号 仍成立,不成立以实际代码为准并在 PR 描述里记一句。
- [ ] **0.2** **真实桌面端数据(需要用户在装了 Enjoy 的机器上配合,做不了就记入未验证清单,不阻塞开发)**:用 `sqlite3` 只读打开**副本**,只看形状、不复制内容进仓库或文档:
  `SELECT state, count(*) FROM transcriptions WHERE target_type='Video' GROUP BY state;`、
  `SELECT json_type(result,'$.timeline'), json_extract(result,'$.timeline[0].type'), typeof(json_extract(result,'$.timeline[0].startTime')) FROM transcriptions LIMIT 5;`、
  `videos/` 下 `.compressed.mp4` 与原文件的比例。把结论(只有类型与计数)写进 PR 描述,确认 R-E7 的「秒」与「顶层 = 句」。
- [ ] **0.3** Node 能力:`node -e "const {DatabaseSync}=require('node:sqlite'); new DatabaseSync(':memory:',{readOnly:false}); console.log(typeof require('node:zlib').crc32)"` 在 Node 22.13 与 24 上都通过;确认 `readOnly` 选项名,不对就以官方文档为准改 R-E4。
- [ ] **0.4** 名字没被占用:`rg -n "source_md5|packages/check|enjoy-export|package-runner|Item already imported" server/app server/tests admin/src scripts` 应为空;
  `ls server/alembic/versions | sort | tail -1` 仍是 `0032_wordbook_simple_defs.py`(否则顺延编号,并改本计划所有 `0033`);`rg -n "get_heads\(\) == \[" server/tests` 列出 head 钉子位置。
- [ ] **0.5** 管理端测试环境:在 `admin/` 的 vitest(jsdom)里确认 `Blob.prototype.arrayBuffer`、`Blob.prototype.slice`、全局 `DecompressionStream` 是否可用(写一个临时测试跑一下,不提交);
  不可用的那项在 `lib/zip-reader.test.ts` 里改用 `node:buffer` 的 `Blob` 作输入,或给 `DecompressionStream` 打桩;结论记进 A1 的 PR 描述。
- [ ] **0.6** 基线绿:`cd server && uv run pytest -q tests/test_admin_catalog*.py tests/test_library_catalog_*.py tests/test_migrations.py tests/test_architecture.py`;
  `yarn workspace admin typecheck && yarn workspace admin test`。

---

## 车道 E:本地导出(只在 `scripts/`)

### Task E1:流式 zip 写入器

文件:`scripts/enjoy-export/zip-writer.mjs`、`scripts/enjoy-export/zip-writer.test.mjs`

- [ ] **E1.1 先写失败测试**(`node:test`,临时目录):写 3 个成员(空文件、小文本、1 MiB 随机文件)→ 用**系统 `unzip -t`**(有就跑,没有就跳过该断言)与测试里自写的最小中央目录解析器读回:名字、大小、CRC、内容一致;
  方法全是 0、bit 3 为 0、bit 11 为 1;DOS 时间等于传入的固定时间;强制 ZIP64 模式(测试开关 `forceZip64`)时有 ZIP64 EOCD / locator 且解析器读得出;
  写入中途抛错 → `.partial` 被删、目标不存在;源文件在两遍读之间被改(测试里第二遍前追加字节)→ 抛 `read_error`;同一输入两次输出逐字节相同。
- [ ] **E1.2 实现:** 按 R-P5、R-E8;API `createZipWriter(outPath, {now})` → `{addFile(name, srcPath) → {size, crc32, md5}, addBuffer(name, buf), finish(), abort()}`。
- [ ] **E1.3 验证:** `node --test scripts/enjoy-export/`
- [ ] **E1.4 提交:** `feat(scripts): streaming STORE-only zip writer with ZIP64 for the Enjoy export`

### Task E2:读桌面端数据库与 SRT 转换

文件:`scripts/enjoy-export/{locate,enjoy-db,srt}.mjs`、`fixtures/make-fixture.mjs`、对应测试

- [ ] **E2.1 先写失败测试:**
  `srt.test.mjs`:秒 → `HH:MM:SS,mmm`(含 ≥ 1 h、四舍五入)、换行压成空格、空文本 / `end <= start` / 非数值丢弃并计数、乱序排序、输出无 BOM;20,001 条 → `subtitle_too_large`。
  `enjoy-db.test.mjs`(`make-fixture.mjs` 用 `node:sqlite` 现造带 `videos` / `transcriptions` 两表的库,列名照桌面端迁移):R-E5 表里每个原因码各一条;压缩版优先于原文件;`avi` 原文件 → `unsupported_format`;
  `metadata` 里的 `format.filename` 与 `videos.source` 不出现在返回对象的任何字段里(深度遍历断言);数据库被复制到临时目录且结束后删除;原库文件的修改时间不变。
  `locate.test.mjs`:`LIBRARY_PATH` > `SETTINGS_PATH/settings.json` 的 `library` > 平台默认(用注入的 `platform` / `env` / `home`,三平台各一例);`settings.json` 里有 `user.accessToken` 时返回值与任何输出都不含它;多个用户目录且无 `--user` → 报错并列目录名。
- [ ] **E2.2 实现:** 按 R-E3、R-E4、R-E5、R-E6、R-E7。
- [ ] **E2.3 验证:** `node --test scripts/enjoy-export/`
- [ ] **E2.4 提交:** `feat(scripts): read Enjoy desktop videos and transcriptions into SRT`

### Task E3:CLI(全部 / `--pick` / `--list`)、包组装、中断与汇总

文件:`scripts/enjoy-export.mjs`、`scripts/enjoy-export/export.mjs`、`export.test.mjs`、根 `package.json`、根 `.gitignore`

- [ ] **E3.1 先写失败测试**(子进程跑 CLI,固定时间环境变量 `ENJOY_EXPORT_NOW` 仅测试用):
  默认导出全部可导出项,zip 里的条目与 R-P1 一致;`manifest.json` / `meta.json` 精确符合 R-P2 / R-P3(键集合逐一断言,`skipped` 只有计数);manifest 与 meta 的 md5 等于实际字节的 md5;
  **整个 zip 的字节里搜不到**:临时目录路径、fixture 的 `source` 路径、`settings.json` 里的假令牌、用户目录名;
  `--pick` 输入 `1,3` 只导出这两条;输入空行 → 不生成文件、退出码 0;非 TTY 用 `--pick` → 退出码 2;`--list` 不写文件;目标已存在无 `--force` → 退出码 2;
  0 条可导出 → 退出码 3 且无文件;子进程收到 SIGINT(在写媒体时)→ 无 `.partial`、无目标文件、临时数据库副本已删、退出码 130;磁盘空间不足(注入 `statfs`)→ 不开始。
- [ ] **E3.2 实现:** 按 R-E2、R-E8、R-E9;根 `package.json` 加 `export:enjoy`、`scripts:test`;`.gitignore` 加 `/enjoy-export-*.zip`、`*.zip.partial`。
- [ ] **E3.3 验证:** `node --test scripts/enjoy-export/`
- [ ] **E3.4 提交:** `feat(scripts): enjoy-export CLI with pick, list and interrupt-safe output`

### Task E4:黄金样例与文档

- [ ] **E4.1** `scripts/enjoy-export/golden.test.mjs`:用 fixture 库(2 条可导出(其中 1 条 `language: "zh-CN"`)、2 条跳过,媒体是几 KB 的假字节)+ 固定时间生成包,
  与 `admin/src/features/catalog/fixtures/enjoy-export-v1.zip` **逐字节比较**;`UPDATE_GOLDEN=1` 时重写该文件。(这是两边唯一的「共享物」:只是一个二进制文件,不是 import。)
- [ ] **E4.2** `scripts/CLAUDE.md` 加一节:用途、命令、各平台库目录位置(R-E3,含「未验证」)、包格式指向本计划 R-P1–R-P6、导入在管理后台「精选库 → 导入包」、隐私(只读 `library` 键、不联网、包里无路径 / 令牌)、`node --test` 命令、Node ≥ 22.13。
  `scripts/CLAUDE.md` 首行「Not imported by any app code」保持成立。
- [ ] **E4.3 验证:** `node --test scripts/enjoy-export/`
- [ ] **E4.4 提交:** `test(scripts): golden v1 export package shared with the admin importer`

---

## 车道 S:服务端(`source_md5`、包检查、带字幕的替换)

### Task S1:迁移 0033 与模型

文件:`server/app/models.py`、`server/alembic/versions/0033_catalog_source_md5.py`(新)、`server/tests/test_migration_0033.py`(新)、`server/tests/test_migrations.py`(及 Task 0.4 列出的其他 head 钉子)

- [ ] **S1.1 先写失败测试**(照 `tests/test_migration_0032.py`):head 是 0033 且 `down_revision = '0032'`;SQLite 上 `upgrade head` 后 `catalog_items` 有 `source_md5` 列与 `ix_catalog_items_source_md5` 索引、旧行该列为 NULL;
  两行同 md5 可以插入(非唯一);`downgrade 0032` 后列与索引消失、`catalog_items` 其余列与数据不变;`test_migrations.py::test_models_match_migrations` 绿。
- [ ] **S1.2 实现:** 按 R-S1;模型注释写「导入包来源指纹(桌面端 videos.md5);只在管理端 POST 体与包检查回包里出现,不进日志 / 审计 / admin_out / 副本」。
- [ ] **S1.3 验证:** `cd server && uv run pytest -q tests/test_migration_0033.py tests/test_migrations.py tests/test_library_catalog_models.py tests/test_architecture.py`;Postgres(`postgres` profile,有就跑 `alembic upgrade head && alembic downgrade 0032`,没有就在 PR 描述里标未验证)。
- [ ] **S1.4 提交:** `feat(server): catalog_items.source_md5 for package imports (0033)`

### Task S2:上传带 `source_md5`、重复拦截与包检查端点

文件:`server/app/routers/admin_catalog.py`、`server/app/admin/catalog_admin.py`、`server/app/library/catalog_store.py`、`server/tests/test_admin_catalog_package.py`(新)

- [ ] **S2.1 先写失败测试**(`tests/catalog_helpers.py` + 管理端登录夹具,照 `test_admin_catalog.py`):
  开始上传带合法 `source_md5` → 行里有值,`GET ""` / `GET /{id}` 的 JSON 里**没有** `source_md5`;不合法(31 位、大写、非十六进制)→ 422;不带时行为与今天相同;
  同 md5 已有 `uploading` / `queued` / `processing` / `ready`(未退役)→ 409 `Item already imported` 且没有建行;只有 `failed` / `canceled` / 已退役 → 允许;
  包检查:只返回请求里的 md5,多行按新到旧;字段与 R-S3 一致(`refs`、`published`、`retired`、`media_missing`、`upload_received`);1001 个 → 422;viewer → 403;未登录 → 401;不改任何行;
  副本:发布后 `add_to_library` 出来的 `library_items` 行里没有 md5(模型就没有这列,断言 `item_out` 键集合不变);
  隐私:`caplog` 与审计行里没有 md5、标题(用 `SECRET` 标记值);审计 `catalog.upload` 的 `after` 有 `package: true`、没有 md5;`library_contract.json` 重录无差异(`CONTRACT_UPDATE=1` 跑一次后 `git diff --exit-code` 该文件)。
- [ ] **S2.2 实现:** 按 R-S2、R-S3;路由 `POST /packages/check` 放在 `/{catalog_id}` 系列之前;`catalog_store.create` 加 `source_md5` 关键字参数、`find_by_source_md5`。
- [ ] **S2.3 验证:** `cd server && uv run pytest -q tests/test_admin_catalog_package.py tests/test_admin_catalog.py tests/test_library_catalog_store.py tests/test_library_privacy.py tests/test_library_contract.py tests/test_architecture.py`
- [ ] **S2.4 提交:** `feat(server): admin catalog package check and source_md5 on catalog uploads`

### Task S3:替换媒体时可同时换字幕

文件:`server/app/admin/catalog_admin.py`、`server/app/library/{catalog_import.py,catalog_store.py}`、`server/tests/test_admin_catalog_replace.py`

- [ ] **S3.1 先写失败测试**(在现有 `test_admin_catalog_replace.py` 的假工具上加用例):
  替换中(`uploading` + `seg_count > 0` + `replace.flag`)`PUT subtitles` → 200 `{cue_count}`;坏字幕 → 400 且状态不变;非替换的 `uploading ∧ seg_count > 0`(无 flag)仍 409;
  带字幕替换完成后:目录行新媒体键与 `_fresh_name` 一致、`catalog_segments` 是新字幕的句子、`sub_source = "uploaded"`、文字相同的句子保留了 `zh` / `analysis` / `speaker`、文字不同的句子 `zh` 为空且随后被翻译阶段补上(假 AI);
  已有两个副本(其中一个改过标题、改过一句文字、有一条 `library_attempts`、一条 `library_dubs`、`resume_ms > 0`):替换后副本的 `media_path` / `duration_ms` 跟随新媒体,**其余全部不变**(句子行逐列比较、成绩 / 配音 / 续播 / 标题仍在);
  时长差 > 2% → `unsupported_format`,条目回到 `ready`,旧媒体键、旧句子、副本都不变,暂存被删;字幕在探测之前失败(假工具的 `probe` 未被调用);不带字幕的替换与今天逐项相同(现有用例全绿);
  日志里有 `sentences=` 数字、没有句子文字与标题。
- [ ] **S3.2 实现:** 按 R-S4;`catalog_store.rewrite_segments(session, row, sentences)`(不提交,调用方在 `_replace_stage` 的同一个事务里提交)。
- [ ] **S3.3 验证:** `cd server && uv run pytest -q tests/test_admin_catalog_replace.py tests/test_library_catalog_*.py tests/test_admin_catalog*.py tests/test_library_privacy.py`
- [ ] **S3.4 提交:** `feat(server): replace catalog media together with new subtitles`

### Task S4:文档

- [ ] **S4.1** `server/app/library/CLAUDE.md`:`catalog_store.py` 一条加 `find_by_source_md5` / `rewrite_segments`;`catalog_import.py` 一条改为「有句子且有 `replace.flag` → 替换媒体,暂存里有字幕时一并重建句子(文字相同的句子承接译文 / 分析 / 说话人)」;
  Pitfalls 加「`catalog_items.source_md5` 只在管理端 POST 体与包检查回包,不进日志 / 审计 / `admin_out` / 副本」与「带字幕的替换不改已有副本的句子」。
  `server/README.md` 精选库一节加「导入包」:端点、单文件上限 `LIBRARY_MAX_UPLOAD_MB`、覆盖 = 原位替换(只对未发布条目)、导出脚本见 `scripts/CLAUDE.md`。
- [ ] **S4.2 提交:** `docs(server): document catalog package imports`

---

## 车道 A:管理端导入(`admin/`)

### Task A1:zip 读取器(纯逻辑)

文件:`admin/src/lib/zip-reader.ts`、`admin/src/lib/test-zip.ts`(测试专用:在内存里拼 STORE / DEFLATE / ZIP64 的小 zip)、`admin/src/lib/zip-reader.test.ts`

- [ ] **A1.1 先写失败测试:** 正常包 → 条目表与数据起点正确,`entryBlob` 的字节等于原文;EOCD 带注释;ZIP64(`test-zip` 强制)可读;DEFLATE 的文本经 `DecompressionStream` 读出;
  拒收:不是 zip、截断(中央目录越界)、加密位、方法 12、多分卷、条目数超过 `maxEntries`、中央目录超过 `maxDirectoryBytes`、名字含 `..` / `\` / 开头 `/` / `C:`、`accept` 命中的重复名、两个条目区间重叠、条目数据越过文件尾;
  DEFLATE 文本声明 1 KiB 实际解出 > 上限 → 中止并报 `too_large`(zip bomb);`DecompressionStream` 不存在时遇到 DEFLATE 文本 → `deflate_unsupported`;`accept` 不命中的条目被忽略且不读本地头。
  用一个只记录 `slice` 调用的假 `Blob` 断言:打开一个 100 MB(假)包时读取的字节总数 < 中央目录大小 + 64 KiB + 每条 30 字节本地头(证明没有整包读入)。
- [ ] **A1.2 实现:** 按 R-A2、R-P5、R-P6 的通用部分。
- [ ] **A1.3 验证:** `cd admin && yarn vitest run src/lib && cd .. && yarn workspace admin typecheck`
- [ ] **A1.4 提交:** `feat(admin): read zip packages from the central directory`

### Task A2:增量 MD5 与包模型校验

文件:`admin/src/lib/md5.ts` 与测试、`admin/src/features/catalog/package-model.ts` 与测试

- [ ] **A2.1 先写失败测试:** `md5`:RFC 1321 附录的 7 个测试向量;跨 4 MiB 块边界的输入与一次性计算相同;`signal` 中止;进度回调单调。
  `package-model`(用 `test-zip` 造包):合法 manifest / meta 通过;R-P2 / R-P3 每个键的类型、范围、正则各一个反例;`version: 2` → `newer_version`;`format` 不对 → `not_package`;manifest 与 meta 不一致 → 该项 `bad_meta`、其余项不受影响;
  缺 srt / 缺 media / 两个 media → `missing_entry`;media 是 DEFLATE → `media_compressed`;条目大小 ≠ 声明 → `bad_meta`;媒体 > `maxUploadMb` → `too_large`;
  语言 `zh-CN` / `ja` → 预选为未勾选、`en-US` / `EN` / null → 勾选;标题里的控制字符被去掉。
- [ ] **A2.2 实现:** 按 R-A3、R-P2–R-P4。
- [ ] **A2.3 验证与提交:** `cd admin && yarn vitest run src/lib src/features/catalog && cd .. && yarn workspace admin typecheck`;`feat(admin): package manifest validation and incremental md5`

### Task A3:API 与上传续传参数(合并在 S2 之后)

文件:`admin/src/features/catalog/{api.ts,api.test.ts,upload.ts,upload.test.ts,strings.ts}`

- [ ] **A3.1 先写失败测试:** `checkPackage(md5s)` 发 `POST /api/admin/library/catalog/packages/check`,md5 只在体里、URL 固定,1500 个分两批,回包转 camel;
  `startUpload` 带 `sourceMd5` 时体含 `source_md5`,不带时体与今天逐字节相同;`uploadChunks(…, {startChunk: 3})` 第一个请求是第 3 片,默认仍从 0 起,现有用例全绿;
  `S.errors["Item already imported"]` 有中文映射。
- [ ] **A3.2 实现:** 按 R-A5;判定函数 `isAlreadyImported(err)` 等放 `package-runner.ts` 还是 `api.ts` 以就近为准(按状态 + 固定英文串)。
- [ ] **A3.3 验证:** `cd admin && yarn vitest run src/features/catalog && cd .. && yarn workspace admin typecheck`
- [ ] **A3.4 提交:** `feat(admin): package check API and resumable chunk start for catalog uploads`

### Task A4:批次执行器(背压 / 暂停 / 继续 / 覆盖 / 汇总)

文件:`admin/src/features/catalog/package-runner.ts` 与测试

- [ ] **A4.1 先写失败测试**(注入假的 api:`startUpload` / `startReplace` / `putChunk` / `putSubtitles` / `completeUpload` / `cancel` / `fetchCatalog` 与 `md5Blob`,假定时器,不发真请求):
  一次只有一个上传在跑;顺序 = manifest 顺序;`skip` 模式下 `exists` 不上传;`overwrite` 模式下 `exists` 走 `startReplace` → 分片 → `putSubtitles` → `complete`,**不调用任何删除**;`published` / `busy` 两种模式都跳过;
  `resumable` 用旧 id 并从 `floor(uploadReceived / chunkBytes)` 片起;md5 不符 → 该条 `checksum` 失败且**没有任何请求**;
  背压:本批已有 2 条 `queued` / `processing` 时不开始下一条,`fetchCatalog` 报告降到 1 后才开始;
  503 → `paused:"unavailable"`;401 → `paused:"auth"`;网络错误 → `paused:"network"` 且「继续」用同一 id 从服务端已收的分片续传;
  `Invalid subtitle file` → 该条失败、新建条目被 `cancel`、继续下一条;覆盖中字幕被拒 → `cancel`(服务端恢复 ready)、该条失败;`Item already imported` → 计为跳过;`Item is published`(覆盖时被别人发布)→ 跳过并带原因;
  「停止」中止当前上传、不调用 `cancel`;汇总计数正确;store 里没有任何东西写进 `localStorage` / `sessionStorage`。
- [ ] **A4.2 实现:** 按 R-A6、R-A7。
- [ ] **A4.3 验证与提交:** `cd admin && yarn vitest run src/features/catalog && cd .. && yarn workspace admin typecheck`;`feat(admin): catalog package import runner with queue backpressure and per-item failures`

### Task A5:「导入包」按钮、预览与运行对话框

文件:`admin/src/features/catalog/{catalog-page.tsx,package-dialog.tsx,package-preview.tsx,strings.ts}` 与测试(`catalog-page.test.tsx` 追加、`package-dialog.test.tsx` 新)

- [ ] **A5.1 先写失败测试**(mock `./api`):operator 看得到「导入包」按钮、viewer 看不到;选文件(`test-zip` 生成)→ 显示总数 / 总大小 / 各类别计数;批次元数据表单没有标题框、译文语言默认 `zh-CN`;
  默认选中「跳过」;切「覆盖」后出现保留 / 不跟随说明;非英语条目默认未勾选且可勾上;已发布条目在覆盖模式下仍不可勾选并显示原因;「开始导入(N 个)」的 N 随勾选与模式变化;
  运行中点遮罩 / Esc 不关闭、挂了 `beforeunload`;暂停文案 3 种、继续 / 停止;结束汇总(失败条目显示标题与中文原因);坏包显示固定提示且没有任何 API 请求;`state.available = false` 时「开始」禁用。
- [ ] **A5.2 实现:** 按 R-A1、R-A4、R-A6 的界面部分;文案放 `S.package.*`。
- [ ] **A5.3 验证:** `cd admin && yarn vitest run src/features/catalog && cd .. && yarn workspace admin typecheck && yarn workspace admin build`
- [ ] **A5.4 提交:** `feat(admin): 导入包 dialog with preview, skip or overwrite, and batch progress`

### Task A6:与导出脚本的互通(依赖 E4)

- [ ] **A6.1** `admin/src/features/catalog/package-golden.test.ts`:读黄金样例 `fixtures/enjoy-export-v1.zip`(`readFileSync` → `Blob`)→ `parsePackage` 全部通过,md5 校验通过,2 条可导入(其中非英语那条预选未勾选),`skipped` 计数与导出脚本测试一致。
- [ ] **A6.2 提交:** `test(admin): importer accepts the golden enjoy-export v1 package`

### Task A7:文档

- [ ] **A7.1** `admin/src/features/catalog/CLAUDE.md`:What lives here 加 `package-model` / `package-runner` / `package-dialog` / `package-preview`(只经现有上传 / 替换接口、一次一条、队列背压);
  Pitfalls 加「媒体条目只收 STORE、包内容不写文件系统、md5 / 标题不进 URL 与本机存储、批次状态只在内存、覆盖只对未发布条目」。`admin/README.md` 表格 `catalog` 一行加「导入包」,
  并写明 `src/lib/zip-reader.ts`、`md5.ts` 是通用纯逻辑。**未验证**清单(见下)写进 `features/catalog/CLAUDE.md`。
- [ ] **A7.2 提交:** `docs(admin): document catalog package import`

---

## 测试策略汇总

- 每个任务先写失败测试再实现。导出脚本 `node:test`(临时目录、`node:sqlite` 现造 fixture 库、假媒体字节、子进程跑 CLI 测中断);服务端 pytest(SQLite 临时库,`catalog_helpers` + 假媒体工具 / 假 AI);
  管理端 vitest(jsdom,`test-zip.ts` 在内存里造 zip,假 `Blob` 记录读取量,mock `./api`)。
- **小 zip 夹具两种:** ① 管理端测试自己用 `test-zip.ts` 现造(覆盖各种坏包);② 导出脚本生成并提交的黄金样例 `enjoy-export-v1.zip`(几 KB,无真实媒体,固定时间,两边各有一个逐字节 / 可解析的测试守着格式)。
- 契约:管理端没有契约夹具(`admin/README.md`「服务端契约由 `server/tests` 钉住」),所以 S2 的测试逐键断言包检查回包形状,A3 的 mock 照本计划 R-S3 写;用户侧 `library_contract.json` 必须不变。
- 隐私守卫:服务端 `caplog` + 审计断言(md5、标题不出现);导出脚本断言 zip 字节里没有本机路径 / 令牌 / 用户目录名;管理端断言 md5 不进 URL、批次不写本机存储。
- 副本保留:S3 的副本逐列比较用例是「覆盖不丢副本」的唯一证据,必须有。
- 迁移:SQLite 自动测试 + Postgres 手动一次(有环境才跑,否则标未验证)。
- 不跑 E2E;真实桌面端数据库、真实浏览器读数 GB zip、真实 ffmpeg 处理速度全部列入「未验证清单」。

## 并行策略

| 波次 | 可并行的独立代理(各自 worktree) | 依赖边 |
|---|---|---|
| 1 | **代理 A(导出):** E1 → E2 → E3 → E4(只碰 `scripts/`、根 `package.json` / `.gitignore`、黄金样例文件)<br>**代理 B(服务端):** S1 → S2 → S3 → S4(只碰 `server/`;S2、S3 都改 `catalog_admin.py`,所以同一代理串行)<br>**代理 C(管理端):** A1 → A2(只碰 `admin/src/lib/` 与 `features/catalog/package-model.ts`) | 三者没有共享文件;E4 写的黄金样例路径在 `admin/` 下但只有它写、A6 只读 |
| 2 | **代理 C 续:** A3 → A4 → A5 | A3 的代码可先写(测试 mock api),**合并**等 S2;A4 需要 A2、A3;A5 需要 A4;覆盖路径的真实可用等 S3 合入 |
| 3 | A6、A7 | A6 需要 E4 与 A2 都已合入;A7 在 A5 之后 |

- 合并顺序:**(E1–E4 ‖ S1 → S2 → S3 ‖ A1–A2)→ A3(等 S2)→ A4 → A5(等 S3,否则覆盖会被服务端 409)→ A6(等 E4)→ S4 / A7**;三条车道互不阻塞,只有 A3 等 S2、A5 等 S3、A6 等 E4;每次合并后该车道测试全绿。
- 唯一的跨车道「接口」是包格式(本计划 R-P1–R-P6)与 R-S3 / R-S4 的接口形状;任何一方想改,先改本计划写 Addendum,再同时改两边(包格式还要改黄金样例)。

## 安全与隐私

- **令牌不进包:** 导出脚本不读 `settings.json` 的 `user` 键、不读 `user_settings` 表、不联网;包里只有 R-P2 / R-P3 列出的字段;E3 的测试在整个 zip 字节里搜假令牌与本机路径。
- **本机路径不进包:** `videos.source`、`metadata.format.filename`、用户目录名都不导出;zip 内路径只有 `items/<md5>/固定文件名`。
- **服务端日志 / 审计:** 新端点只记个数;上传开始的日志行不变,审计只多一个布尔;`source_md5` 不进 `admin_out`、副本、bundle、审计、计量。md5 只出现在管理端 POST 体与包检查回包里。
- **管理端:** md5、标题、文件名不进 URL、不写 `localStorage` / `sessionStorage`、不写 `console`;上传用中性文件名 `media.<ext>` / `subtitle.srt`;不访问第三方主机。
- **解析不可信 zip:** R-P6 的上限、正则、区间不重叠检查;不写文件系统;DEFLATE 只用于小文本并带计数上限;媒体只做 `Blob.slice` 不解压。服务端照旧把上传当不可信输入(探测、转码、字幕解析都不变)。
- **包本身含个人素材**:导出脚本完成时提示「包里是你的视频和字幕,请勿上传到公共位置」;`.gitignore` 防止误提交到本仓库。
- **版权:** 导入后的条目对所有用户可见(发布后)。导入不等于发布:条目默认未发布,`license_note` 由管理员在批次元数据里填写;是否有权公开给其他用户由站长判断(spec §12,不是法律意见)。

## 对既有约束、费用与迁移的影响

- 用户库的额度(每日新建次数、空间、条目数、同时 2 个上传)**全部不适用**:导入的是系统所有的精选条目,副本不占任何用户额度(spec E7)。修订前的「额度暂停」逻辑已删除。
- 管理端自身的约束:单文件 `library_max_upload_mb`(默认 500 MB,可热改;超了在预览里判 `too_large`,不发请求);时长 `library_max_duration_minutes`(默认 90,处理阶段判 `too_long`);
  队列一次处理一个;暂存盘剩余 < 2 × 源文件 → `disk_full`(R-A6 的背压把暂存压在约 3 份原始文件以内)。
- 费用(系统出):有字幕 → 不调用识别;每条逐句翻译一次(`cat_translate`,不设每日上限,**费用未测**);覆盖时只译文字变了的句子。转码占服务器 CPU(≤ 720p,单任务串行,**速度未测**)。
- 存储:每条视频保留一份 ≤ 720p 的成品(计入 `catalog_items.media_bytes`,不计入任何用户);媒体不进数据库备份(spec 备份提示照旧)。
- 迁移 0033 只给 `catalog_items` 加一个可空列与一个索引,对现有行无回填;部署时随 `alembic upgrade head` 执行(`scripts/CLAUDE.md` Pitfalls:有迁移的版本先备份生产库并在 Postgres 上核对)。
- 不新增设置项,不改 `.env.example`,不改 `settings_registry`,不改用户侧接口与网页。

## 风险

- **桌面端数据形状未实测:** `timeline` 的单位与层级、`state` 分布、压缩版是否总存在,全靠读代码推断(Task 0.2)。缓解:SRT 转换是纯函数、表驱动测试,发现差异只改 `srt.mjs`;导出前 `--list` 先看会跳过多少。
- **覆盖不改已有副本的句子:** 新字幕只进目录与以后的新副本;已加入的学习者仍看到旧句子(媒体已换成新的)。若新旧媒体时长一致但剪辑不同,副本的旧时间会错位——R-KV7 只挡住时长差 > 2%。同一 `source_md5` 意味着同一原始文件,实际风险低。
- **已发布条目不能覆盖:** 需要先下架(用户在「精选」里暂时看不到),覆盖处理完再上架;见 Q1。
- **早先手动上传的同一视频:** 它们没有 `source_md5`,导入包会再建一条(重复)。缓解:预览只能按 md5 判;管理员导入后在表格里按标题删除重复的新条目。
- **暂存盘:** 背压之外,如果管理员同时用「上传文件」传大文件,暂存可能更多;`disk_full` 会让该条失败,可「重试」。
- **长批次与会话:** 管理员会话空闲 30 分钟过期;等待队列时只有每 3 秒的列表请求,应能保持会话(**未验证**);过期则 `paused:"auth"`,重新登录后继续。
- **转码排队:** 一次导入几十条视频,服务端单任务逐条转码 + 翻译,表格里会长时间「处理中」;不影响正确性。
- **翻译费用:** 每条都由系统逐句翻译,几十条视频的总费用未测;需要省钱时可在导入前把 `library_ai_available` 关掉(翻译阶段跳过,以后用「补全译文」补)。
- **非 STORE 的包:** 用户若解开后自己重新压缩,媒体会是 DEFLATE 而被拒;提示「请用导出脚本生成的原包」。

## 未验证清单(实现完成后在结果文档逐条写「已做 / 未做」)

- 真实桌面端数据库:`transcriptions.result.timeline` 顶层是句级条目、时间单位为秒;`state` 的真实分布;`.compressed.mp4` 的存在比例;旧版本桌面端的列名是否一致。
- 各平台库目录定位:Windows `%APPDATA%\Enjoy\settings.json` 与 OneDrive 重定向的文档目录、macOS `~/Library/Application Support/Enjoy`、Linux `~/.config/Enjoy` 与 XDG 文档目录;开发版(`--dev`)路径。
- 桌面端开着时复制数据库副本的一致性(WAL 模式下)。
- Node 22.13 上 `node:sqlite` 的 `readOnly` 选项与实验性警告(输出到 stderr,不影响结果)。
- 桌面浏览器(Chrome / Edge / Firefox / Safari)对数 GB `File.slice` 的行为、`DecompressionStream("deflate-raw")` 的可用性(Safari 16.4+、Firefox 113+)、浏览器里 MD5 的速度。
- jsdom 测试环境里 `Blob.arrayBuffer` / `DecompressionStream` 的可用性(Task 0.5)。
- 真实服务器上批量导入:转码 + 翻译排队时长、翻译费用、反向代理对连续分片的表现、背压等待期间会话是否保持、跨天重新选包续传。
- 真实 ffmpeg 下 Enjoy 压缩版与原文件的时长差是否在 R-KV7 的 2% 以内(覆盖时用到)。

## 待用户确认(Open questions)

- **Q1 已发布条目的覆盖:** 现有「替换媒体」与 spec E10 只允许改**未发布**的条目。推荐(本计划按此实现):覆盖模式下已发布的条目**跳过**并提示「先在表格里下架,再用同一个包覆盖,处理完再上架」。
  替代:导入器自动「下架 → 替换 → 等处理完 → 重新上架」(要在执行器里等待处理完成,失败时条目会停在下架状态;spec E10 不用改)。需要的话告诉我们,作为后续小改动。

(修订前的 Q2–Q7 已由用户裁定或不再适用:每日次数不适用于管理端;非英语默认不勾选;封面不导;Node ≥ 22.13;`--pick` 手动分批;命名「导入包」/ `enjoy-export`,端点按管理端风格定为 `/api/admin/library/catalog/packages/check`。)

## 修订记录

- **2026-10-27 修订 1(用户裁定:导入改到管理端精选库)**
  - 导入目标从「用户个人跟读库(`web/` 添加面板『导入包』标签)」改为「管理端精选库」:删除全部 `web/` 改动(车道 W),新增车道 A(`admin/`);入口是精选库页工具栏的「导入包」按钮,仅桌面。
  - 服务端:`source_md5` 从 `library_items` 改到 `catalog_items`(迁移名 `0033_catalog_source_md5`,核对过最新迁移仍是 0032);上传开始的字段与重复拦截改到 `POST /api/admin/library/catalog/uploads`;
    包检查端点从 `/api/library/packages/check` 改为 `/api/admin/library/catalog/packages/check`(operator);删掉「剩余次数 / 空间 / 条目数」回包字段与 `source_exists` 用户错误码,改为管理端错误串 `Item already imported`;用户侧契约不再变化。
  - 删除用户额度相关的一切(每日次数、空间、条目数、同时 2 个上传、额度暂停与「明天继续」);改以管理端约束为准:`library_max_upload_mb`(调研确认默认 500、对精选上传与替换生效)、导入队列一次一个、现有分片机制;新增执行器的**队列背压**(暂存盘)。
  - 覆盖从「删旧建新(会丢成绩)」改为**复用「替换媒体」原位替换**;调研写清 `_replace_stage` / `sync_copies` 的真实语义(副本只跟随媒体,成绩、译文、配音、续播、句子编辑全部保留,但不跟随新字幕);
    因现有机制不能带字幕,新增最小服务端扩展 R-S4(替换期间接受字幕、在同一提交里重建目录句子并承接相同文字的译文 / 分析 / 说话人)与 Task S3;已发布条目不覆盖(Q1)。默认仍是「跳过」。
  - zip 读取 / MD5 / 包校验 / 执行器从 `web/src/features/library/package-import/` 移到 `admin/src/lib/`(通用)与 `admin/src/features/catalog/package-*`(格式相关);不新增 npm 依赖;管理端无包体积预算,不懒加载;黄金样例改放 `admin/src/features/catalog/fixtures/`。
  - 保留不变:包格式 R-P1–R-P6(只改了 R-P4 的提示语、R-P6 的上限来源,并写明两个 md5 的分工)、导出车道 E 全部(只改黄金样例路径、R-E5 的上限说明、E4 的样例加一条非英语条目)、桌面端调研结论、隐私规则。
  - 未验证清单去掉手机浏览器项,加入 jsdom 能力、翻译费用、会话保持、R-KV7 时长容差;开放问题从 7 个减到 1 个(Q1)。
