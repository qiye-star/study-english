# 精选库(内置素材)· 四条车道的总索引(INDEX)

- 日期:2026-10-14 · 状态:只有文档,没有产品代码;未提交
- Spec:`docs/superpowers/specs/2026-10-14-curated-library-design.md`(用户已批准方向;E / R 是设计裁定,§14 开放问题按推荐默认走)
- 本文是四份计划之间的**唯一裁决来源**:计划与本文冲突时以本文为准。§4–§8 的名字、形状、签名**冻结**;要改先改本文,再通知所有车道。
- 写计划时读过的真实代码(只读):`server/app/models.py`(库三表)、`app/library/{paths,limits,store,pipeline,worker,ai,errors,media,ytdlp}.py`、
  `app/routers/{library,library_import,admin_library}.py`、`app/admin/{library_admin,users_admin,backups,perms}.py`、`app/core/{metering,config,settings_registry}.py`、
  `app/main.py`、`alembic/versions/0021_library_word_alignment.py`、`tests/{library_helpers,background,admin_helpers,agents_helpers,test_library_privacy,test_library_contract,test_library_delete_user,test_admin_library,test_library_models}.py`、
  `tests/fixtures/library_contract.json`;网页 `features/library/{CLAUDE.md,index.ts,lazy-pages.tsx,library-api.ts,library-contract.test.ts,library-list-page.tsx,player-page.tsx,item-menu.tsx}`;
  管理端 `src/api/client.ts`、`features/library/{CLAUDE.md,api.ts}`、`components/layout.tsx`、`app.tsx`。**没有运行任何测试**;计划里的测试是要执行者先写的失败测试,首次运行以真实结果为准修正测试数据,不得改裁定、接口名与隐私断言。

## 1. 计划一览

| 车道 | 计划 | 一句话范围 | 主要模型提示 |
|---|---|---|---|
| **SC** 服务端核心 | `2026-10-14-curated-library-server-core.md` | 迁移 0022、模型、设置、错误码、路径、`metering.system_scope`、`catalog_store`、用户侧 `/api/library/catalog*`、副本的保护 / 回收 / 计费(`ai.py`)、共享媒体测试、隐私与契约、网页契约同步 | 迁移与 store 用强模型;设置 / 文档 / 夹具任务是誊写 |
| **SI** 服务端导入与管理接口 | `2026-10-14-curated-library-server-import.md` | `Ffmpeg.audio_only`、`pipeline` 两个助手抽取与 `FetchRequest.system`、`ytdlp` 系统旗标、`catalog_import.process`、`CatalogJobs`、`admin/catalog_admin.py` + `routers/admin_catalog.py`(导入 / 上传 / 发布 / 编辑 / 删除 / 强制删除 / 媒体) | 流水线与任务运行器用强模型;路由大多是誊写 |
| **AU** 管理端界面 | `2026-10-14-curated-library-admin-ui.md` | 客户端 `FormData`、`features/catalog/`(列表、导入对话框、分片上传、详情抽屉、句子编辑、发布、删除)、导航与路由 | 中等;接口与文案是誊写 |
| **W** 网页 | `2026-10-14-curated-library-web.md` | **Task 0 设计稿**(给用户看);「精选」页签、目录卡片与添加、副本徽标与菜单、音频封面、「译」开关、文档 | 设计稿与界面用强模型 |
| **Z** 控制者收尾 | 本文 §10 | 合并后写更新日志草稿(中英),不是实现者的任务 | — |

## 2. 合并顺序(权威)

**SC →(SI ‖ W)→ AU → Z**

| 后来的 | 必须等 | 原因 |
|---|---|---|
| SC Task 0 | 无 | 核对迁移头与撞号(§3) |
| SI 开始 | SC 合并 | 用 SC 的模型、迁移、`catalog_store`、`paths`、`ai.translate_texts`、`main.py` 锚点、`tests/background.py` 的 `catalog` 任务集 |
| W Task 0(设计稿) | 无(可与 SC 同时做) | 只写 `docs/superpowers/design/curated-library-v1/mockup.html` |
| W Task 1 起 | **用户确认设计稿** + SC 合并 | 界面以设计稿为准;契约夹具与网页类型由 SC 先同步 |
| AU 开发 | 可在 SC 合并后与 SI 并行(测试全部 mock `features/catalog/api.ts`) | |
| AU 合并 | SI 合并 | 端点存在后才能联调;AU 的 `api.ts` 形状以 §6 为准 |
| Z | 全部合并并经用户验证 | 见 §10 |

- 各车道在自己的 worktree(`node_modules` 联接,见根 `CLAUDE.md`);**一个文件只有一个所有者**(§9);合并不越过前一步。
- 测试口径:每个任务只跑它列出的测试文件 + `tests/test_architecture.py`(服务端)或对应目录(网页 / 管理端);**不跑全量、不跑 E2E、不重建容器**(用户要求时才做)。永远不打真实付费上游(用 `tests/library_helpers.py` 的假工具 / 假识别、respx 假大模型)。

## 3. 迁移号

- 已核对:当前 head = `0021`(`0021_library_word_alignment.py`)。本功能 = **`0022_curated_catalog.py`**(`revision='0022'`,`down_revision='0021'`)。
- **撞号**:未跟踪的 `plans/2026-10-14-accounts-*.md` 从 `0021` 起编号(写于 head = `0020` 时),它们实施时必须顺延到 `0023` 起(若本功能先合并)。反之,若账号计划先合并,本功能顺延,SC Task 0 记录实际号码,并改本节、SC 计划与所有 head 钉子。
- head 钉子(SC Task 1 同提交全部改成新号):`tests/test_migrations.py` 5 处、`tests/test_library_models.py` 1 处、`tests/test_changelog_models.py` 1 处(`Grep "get_heads\(\) == \[" server/tests` 复核)。

## 4. 冻结:表与列

见 spec §5,逐字使用这些名字:

- `catalog_items`:`id, title, level, tags, license_note, source, source_host, source_url, status, stage, progress, error_kind, upload_total, upload_received, duration_ms, media_path, poster_path, media_mime, media_bytes, sub_source, asr_seconds, seg_count, low_confidence, ai_lang, published, published_at, retired_at, created_at, updated_at`;索引 `ix_catalog_items_status_created_at (status, created_at)`。
- `catalog_segments`:`catalog_id, idx, start_ms, end_ms, text, zh, zh_lang, analysis, analysis_lang, flags`(PK `catalog_id, idx`;FK `catalog_items.id ON DELETE CASCADE`)。
- `library_items.catalog_id`(`String(36)` 可空,无外键);唯一索引 `ux_library_items_user_id_catalog_id (user_id, catalog_id)`。
- ORM 类名:`CatalogItem`、`CatalogSegment`(`app/models.py`,紧跟 `LibraryAttempt` 之后)。

## 5. 冻结:常量、设置、错误码、计量名

| 名字 | 值 | 在哪 |
|---|---|---|
| `Settings.library_catalog_enabled` | `False` | `core/config.py`、`settings_registry`(组 `library`)、`.env.example` `LIBRARY_CATALOG_ENABLED` |
| `Settings.library_catalog_ai_daily` | `300`(0–100,000) | 同上,`LIBRARY_CATALOG_AI_DAILY`,`danger=_COST` |
| `limits.SCOPE_CATALOG_AI` | `"library_cat_ai"`(subject `limits.GLOBAL`) | `app/library/limits.py` |
| `ai.FEATURE_CAT_TRANSLATE` / `FEATURE_CAT_ANALYSIS` | `"cat_translate"` / `"cat_analysis"` | `app/library/ai.py` |
| `catalog_import.FEATURE` | `"cat_import"` | `app/library/catalog_import.py`(SI) |
| `paths.CATALOG` | `"_catalog"` | `app/library/paths.py` |
| `catalog_store.LEVELS` | `("A1","A2","B1","B2","C1","C2")` | `app/library/catalog_store.py` |
| `catalog_store.TAGS_MAX` / `TAG_MAX` / `LICENSE_MAX` / `LIST_MAX` | `5` / `16` / `300` / `200` | 同上 |
| `catalog_store.DEFAULT_AI_LANG` | `"zh-CN"` | 同上 |
| `catalog_store.ACTIVE` | `("uploading","queued","processing")` | 同上 |
| `errors.API_ERRORS` 追加 | `catalog_disabled` (404, `Built-in library is disabled`)、`catalog_not_found` (404, `Built-in item not found`)、`catalog_locked` (409, `Built-in items cannot be changed this way`) | `app/library/errors.py` |
| 审计动作(SI) | `catalog.import`、`catalog.upload`、`catalog.edit`、`catalog.publish`、`catalog.unpublish`、`catalog.retry`、`catalog.cancel`、`catalog.translate`、`catalog.segment.edit`、`catalog.delete`、`catalog.retire`、`catalog.purge`;`target_type="catalog_item"`,`after` 只含数字 / 布尔 / 状态 | `app/admin/catalog_admin.py` |

## 6. 冻结:路由与 JSON 形状

**用户侧**(SC,`routers/library_catalog.py`):

```text
GET  /api/library/catalog                       -> {"items": [CatalogCard]}
POST /api/library/catalog/{catalog_id}/add      -> {"item": ItemOut, "created": bool}
GET  /api/library/catalog/{catalog_id}/poster   -> image/jpeg
```

```jsonc
// CatalogCard  (catalog_store.public_out)
{"id": "uuid", "title": "str", "level": "B1" | null, "tags": ["news"], "license_note": "str" | null,
 "duration_ms": 61000, "seg_count": 12, "has_poster": true, "published_at": "ISO", "added_item_id": "uuid" | null}
// ItemOut = store.item_out(row)  现有键 + "catalog_id": "uuid" | null ;  source ∈ "upload" | "link" | "catalog"
// GET /api/library/config 追加 "catalog": bool
```

**管理端**(SI,`routers/admin_catalog.py`,前缀 `/api/admin/library/catalog`;角色见 spec §9):

```text
GET    ""                                  -> {"items": [CatalogAdminRow], "state": CatalogState}
GET    /{catalog_id}                       -> {"item": CatalogAdminRow, "segments": [CatalogAdminSegment]}
POST   /imports                            body ImportIn  -> {"item": CatalogAdminRow}
POST   /uploads                            body UploadIn  -> {"catalog_id": "uuid", "chunk_bytes": 8388608}
PUT    /uploads/{catalog_id}/chunks/{n}    multipart chunk -> UploadState
PUT    /uploads/{catalog_id}/subtitles     multipart file  -> {"cue_count": int}
POST   /uploads/{catalog_id}/complete      -> {"item": CatalogAdminRow}
PATCH  /{catalog_id}                       body MetaPatch -> {"item": CatalogAdminRow}
POST   /{catalog_id}/publish | /unpublish | /retry | /cancel | /translate   {} -> {"item": CatalogAdminRow}
PATCH  /{catalog_id}/segments/{idx}        body SegmentPatch -> {"segment": CatalogAdminSegment}
POST   /{catalog_id}/delete                {"reason","confirm"} -> {"id", "outcome": "deleted"|"retired", "refs": int}
POST   /{catalog_id}/purge                 {"reason","confirm"} -> {"id", "copies_deleted": int, "users": int}
GET    /{catalog_id}/media | /poster       (Cookie)
```

```jsonc
// CatalogAdminRow  (catalog_store.admin_out)
{"id","title","level","tags":[],"license_note","source":"upload"|"link","source_host","status","stage","progress",
 "error_kind","duration_ms","seg_count","translated","sub_source","low_confidence","media_bytes","has_poster",
 "media_missing","ai_lang","published","published_at","retired","refs","upload_received","upload_total",
 "created_at","updated_at"}
// CatalogAdminSegment  (catalog_store.segment_admin_out)
{"idx","start_ms","end_ms","text","zh","zh_lang","has_analysis","flags":[]}
// CatalogState
{"enabled": bool /*library_catalog_enabled*/, "available": bool /*library_available*/, "asr": bool, "ai": bool,
 "link": bool /*library_enabled and ytdlp_present()*/, "proxy_configured": bool, "ai_daily": int, "ai_today": int,
 "languages": ["zh-CN", ...] /*ai.LANGS keys*/, "levels": ["A1",...], "chunk_bytes": 8388608,
 "max_upload_mb": int, "formats": [...] /*limits.UPLOAD_EXTENSIONS*/}
// ImportIn  {"url": str<=4000, "title"?: str<=400, "level"?: str|null, "tags"?: [str], "license_note"?: str<=300, "ai_lang"?: str}
// UploadIn  {"filename": str<=255, "size": int>=1, "title"?, "level"?, "tags"?, "license_note"?, "ai_lang"?}
// UploadState {"catalog_id","status","upload_received","upload_total","chunk_bytes"}
// MetaPatch {"title"?, "level"?: str|null, "tags"?: [str], "license_note"?: str|null}   (extra=forbid; level null = 清空)
// SegmentPatch {"text"?, "zh"?, "start_ms"?, "end_ms"?}
```

## 7. 冻结:函数签名(跨车道调用的)

**`app/library/paths.py`(SC)**

```python
CATALOG = "_catalog"
def catalog_rel(catalog_id: str) -> str            # "library/_catalog/<id>"
def catalog_tmp_rel(catalog_id: str) -> str        # "library/_catalog/_tmp/<id>"
def catalog_dir(data_dir: Path, catalog_id: str) -> Path
def catalog_tmp_dir(data_dir: Path, catalog_id: str) -> Path
def remove_catalog_files(data_dir: Path, catalog_id: str) -> None   # both dirs, best effort
```

**`app/core/metering.py`(SC)**:`@contextmanager def system_scope()` — 期间 `current_user_id() is None`,退出恢复原值。

**`app/library/catalog_store.py`(SC;SI 只调用,不改)**

```python
def clean_tags(raw: list[str] | None) -> list[str]                         # ValueError("tags")
def clean_level(raw: str | None) -> str | None                             # ValueError("level")
def tags_of(row: CatalogItem) -> list[str]
def public_out(row: CatalogItem, added_item_id: str | None) -> dict        # CatalogCard
def admin_out(row: CatalogItem, *, refs: int, translated: int, media_missing: bool) -> dict
def segment_admin_out(seg: CatalogSegment) -> dict
async def create(session, *, source: str, status: str, title: str, level: str | None, tags: list[str],
                 license_note: str | None, ai_lang: str, source_url: str | None = None,
                 source_host: str | None = None, upload_total: int = 0) -> CatalogItem          # commits
async def get(session, catalog_id: str) -> CatalogItem | None              # None for a malformed id
async def get_published(session, catalog_id: str) -> CatalogItem | None    # ready ∧ published ∧ not retired
async def list_published(session, user_id: int) -> list[tuple[CatalogItem, str | None]]
async def list_all(session) -> list[CatalogItem]                           # newest first
async def segments_of(session, catalog_id: str) -> list[CatalogSegment]
async def segment_at(session, catalog_id: str, idx: int) -> CatalogSegment | None
async def write_segments(session, row: CatalogItem, sentences: list[Sentence], *,
                         flags: list[tuple[str, ...]] | None = None) -> None              # caller commits
async def set_translations(session, catalog_id: str, entries: list[tuple[int, str, str]],
                           language: str) -> set[int]                                      # commits; text guard
async def set_analysis(session, catalog_id: str, idx: int, text: str, analysis: str,
                       language: str) -> bool                                              # commits; text guard
async def set_progress(session, catalog_id: str, stage: str, progress: int, now: datetime) -> bool
async def claim_next(session, now: datetime) -> CatalogItem | None         # one queued -> processing, atomically
async def recover(session, now: datetime) -> int                           # processing -> queued
async def fail(session, catalog_id: str, kind: str, now: datetime) -> bool # processing -> failed (or ready, R9)
async def refs(session, catalog_id: str) -> int
async def ref_counts(session, ids: list[str]) -> dict[str, int]
async def translated_counts(session, rows: list[CatalogItem]) -> dict[str, int]
def media_missing(data_dir: Path, row: CatalogItem) -> bool
async def add_to_library(session, data_dir: Path, *, user_id: int, catalog_id: str,
                         now: datetime) -> tuple[LibraryItem, bool]      # LookupError when not addable; commits
async def fill_translations(session, item: LibraryItem, segs: list[LibrarySegment], language: str) -> int  # commits
async def delete_rows(session, catalog_id: str) -> None                  # segments + item; caller commits
async def collect_if_orphan(session, data_dir: Path, catalog_id: str) -> bool   # retired ∧ refs == 0 → gone; commits
async def collect_retired(session, data_dir: Path) -> int
async def purge(session, app, catalog_id: str) -> tuple[int, int]        # (copies_deleted, users); commits
```

**`app/library/ai.py`(SC)**

```python
FEATURE_CAT_TRANSLATE, FEATURE_CAT_ANALYSIS = "cat_translate", "cat_analysis"
async def translate_texts(http, settings, *, template: str | None, language: str,
                          texts: list[str]) -> dict[int, str]   # 0-based -> zh; no allowance; AiUnavailable("upstream")
async def analyze_catalog(session, http, settings, *, catalog_id: str, idx: int, text: str, language: str,
                          template: str | None, now: datetime) -> tuple[str, bool]   # (analysis, cached); AiUnavailable
```

**`app/library/pipeline.py`(SI 改)**:`FetchRequest` 末尾追加 `system: bool = False`;新增
`async def prepare_chunks(deps, media: Path, duration_ms: int, tmp: Path) -> tuple[list[Chunk], list[Silence], Path, Path]`、
`async def run_chunks(deps, chunks, wav: Path, state_path: Path, transcribe, on_chunk) -> int`,以及公开别名
`platform_cues = _platform_cues`、`fragments = _fragments`、`untimed = _untimed`、`input_file = _input_file`;`MediaTools` 协议加 `audio_only`。

**`app/library/catalog_import.py`(SI)**:`FEATURE = "cat_import"`、`SYSTEM_USER = 0`、
`async def process(deps: PipelineDeps, catalog_id: str, *, http, translate_template: str | None) -> None`。

**`app/library/catalog_jobs.py`(SI)**:`class CatalogJobs`(`pending: set[asyncio.Task]`、`running: dict[str, asyncio.Task]`、
`kick() -> None`、`async run_once() -> int`、`async cancel(catalog_id) -> None`、`async recover() -> int`、`async shutdown(wait=2.0)`、
`upload_lock(catalog_id) -> asyncio.Lock`);`def install(app) -> CatalogJobs`(设 `app.state.catalog`)。

**`app/library/media.py`(SI)**:`Ffmpeg.audio_only(self, src: Path, out_dir: Path, *, duration_ms: int, home: Path) -> Normalized`
(`Normalized(out_dir/"media.m4a", "audio/mp4", "audio")`);`tests/library_helpers.FakeTools.audio_only` 同签名(SI 加)。

**网页(SC 同步,W 扩展)**:`LibrarySource = "upload" | "link" | "catalog"`;`LibraryItem.catalogId?: string | null`;`LibraryConfig.catalog: boolean`;
`LIBRARY_SERVER_ERRORS` 三条新文本 → `web.library.errors.catalogDisabled` / `catalogNotFound` / `catalogLocked`。

**管理端(AU)**:`RequestOptions.form?: FormData`(`admin/src/api/client.ts`)。

## 8. 冻结:`main.py` 锚点(SC 放,SI 填)

SC 在 `server/app/main.py` 放三处带 `plan SI (2026-10-14-curated-library-server-import)` 字样的锚点注释:
1. `library_import.install(app)` 之后:`# --- anchor for plan SI: install_catalog(app) goes on the next line ---`
2. lifespan 里 `tasks["library"] = ...` 之后与 `app_.state.library.shutdown()` 之前:`# --- anchor for plan SI: catalog recover / shutdown ---`
3. 路由元组里 `admin_library,` 之后、`stubs` 之前:`# --- anchor for plan SI: admin_catalog, goes on the next line ---`

SC 自己的路由 `library_catalog` 放在元组里 `library_import,` 之后。`tests/background.py` 的 `catalog` 任务集由 SC 加(`getattr(state, "catalog", None)`,不存在时无影响)。

## 9. 文件归属(一个文件一个所有者;后合并的车道在前一车道合并后才能碰同一文件)

| 车道 | 独占的文件 |
|---|---|
| SC | `server/alembic/versions/0022_curated_catalog.py`、`server/app/models.py`、`app/core/{config,settings_registry,metering}.py`、`server/.env.example`、`app/library/{paths,limits,errors,store,ai,worker,catalog_store}.py`、`app/routers/{library,library_catalog}.py`、`app/main.py`(自己的一行 + 三处锚点)、`server/tests/{background,test_migrations,test_library_models,test_changelog_models,test_library_privacy,test_library_contract,catalog_helpers}.py`、`tests/test_library_catalog_{models,store,api,ai,media}.py`、`tests/fixtures/library_contract.json`(**只手工加键**)、`app/library/CLAUDE.md`(含 SI 模块的条目)、`app/CLAUDE.md`、`app/routers/CLAUDE.md`(两个新路由的条目)、`server/README.md`(备份一句);网页 `web/src/features/library/{library-api.ts,config.ts,library-contract.test.ts,locales/en.json,locales/zh-CN.json}`(只做契约同步) |
| SI | `app/library/{media,pipeline,ytdlp,catalog_import,catalog_jobs}.py`、`app/admin/catalog_admin.py`、`app/routers/admin_catalog.py`、`app/main.py`(只填三处锚点)、`app/admin/CLAUDE.md`、`tests/library_helpers.py`(只加 `FakeTools.audio_only`)、`tests/test_library_catalog_import.py`、`tests/test_library_catalog_jobs.py`、`tests/test_library_ytdlp.py`(只追加系统旗标用例)、`tests/test_admin_catalog.py`、`tests/test_library_media.py`(只追加 `audio_only` 用例) |
| AU | `admin/src/api/client.ts`(+ `client.test.ts`)、`admin/src/features/catalog/*`、`admin/src/components/layout.tsx`、`admin/src/app.tsx`、`admin/README.md`(表格一行)、`admin/src/features/library/api.ts`(`source` 联合类型加 `"catalog"`) |
| W | `docs/superpowers/design/curated-library-v1/mockup.html`;SC 合并后:`web/src/features/library/` 下的新文件(`catalog-api.ts`、`catalog-view.tsx`、`catalog-card.tsx`、`use-catalog.ts` 及测试)与 `library-list-page.tsx`、`item-card.tsx`、`item-menu.tsx`、`player-page.tsx`、`use-poster.ts`、`library.css`、`library-api.ts`、`library-contract.test.ts`、`locales/*`、`CLAUDE.md`、`web/README.md` |
| Z(控制者) | `docs/changelog/2026-10.json` |

## 10. Z:控制者的收尾(不是实现者的任务)

- [ ] 四条车道全部合并、用户在真实环境验证后,**控制者**在 `docs/changelog/2026-10.json` 追加一条**草稿**(中英都写,规则见 `docs/CLAUDE.md`:面向用户的平实措辞、不用内部术语、每项一句、≤ 4 项、`version: null`),例如标题「跟读库新增精选素材」,条目示意:「跟读库里多了『精选』页签,一键把内置素材加入自己的库」「内置素材自带逐句译文,不占你的存储空间」。只写实际上线的内容。
- [ ] 跑 `cd server && uv run pytest -q tests/test_changelog_import.py`;提醒用户在部署后运行 `docker compose exec server python -m app.admin.changelog_import` 并在管理后台发布(重建容器只在用户要求时做)。

## 11. 未验证(汇总;各车道的结果节逐条写「已做 / 未做」)

spec §13 的清单;另加:管理端浏览器上传数百 MB 文件的耗时;大陆服务器上 `LIBRARY_YTDLP_PROXY` 与 `system=True` 的真实取回;移动端「精选」页签的玻璃效果与真机滚动性能。

## Addendum (2026-10-15):视频素材保留画面

站长裁定:视频源不再只存音频。见 `2026-10-15-catalog-keep-video.md`(R-KV1–R-KV12),它覆盖本文 §7 `catalog_import` / `Ffmpeg.audio_only` 「只存音频」的部分:
视频源走 `normalize`(≤ 720p、≤ 1600 kbps)存 `media.mp4`;`CatalogAdminRow` 追加 `kind`;新管理接口 `POST /{catalog_id}/replace-media`;审计动作追加 `catalog.replace_media`。无迁移。
