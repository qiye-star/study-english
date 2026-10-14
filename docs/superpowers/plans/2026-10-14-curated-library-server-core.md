# 精选库 · 服务端核心(车道 SC)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **先读** `docs/superpowers/plans/2026-10-14-curated-library-INDEX.md`(冻结的名字、形状、签名、文件归属)与 spec `docs/superpowers/specs/2026-10-14-curated-library-design.md`。本计划与 INDEX 冲突时以 INDEX 为准。

**Goal:** 冻结精选库的数据层与用户侧:迁移 `0022`、`CatalogItem` / `CatalogSegment` / `library_items.catalog_id`、两个新设置、三个错误码、目录路径、`metering.system_scope()`、`app/library/catalog_store.py`(目录读写、复制到用户库、引用数、回收、强制删除)、用户接口 `/api/library/catalog*`、副本在现有接口上的保护(重新识别 / 换字幕 409、删除后回收、条目数不计)、副本的译文补全与共享分析(系统计费)、共享媒体的安全回归测试、隐私与契约(夹具只手工加键)和网页契约同步;为车道 SI 放好 `main.py` 锚点与 `tests/background.py` 的任务集。

**Architecture:** 目录是两张系统表;用户「添加」= 一个事务里插入一行 `library_items`(`source="catalog"`、`library_bytes=0`、`media_path` 指向 `library/_catalog/<id>/media.m4a`)与复制的 `library_segments`。现有的播放、票据、Range、跟读、成绩全部不改,因为它们只按「用户 + 条目」找行、按 `media_path` 读文件,而删除只按 `library/<uid>/<item>/` 删目录。分析的共享缓存在目录句子上,首次生成用 `metering.system_scope()` + 全站每日计数 `library_cat_ai`。分层:全部新代码在 `app/library/`、`app/routers/`,`tests/test_architecture.py` 不改。

**Tech Stack:** Python 3.12(uv)、FastAPI、SQLAlchemy 2 async、Alembic、pytest + pytest-asyncio(auto)、respx;网页契约同步用 vitest。

## Global Constraints

- **合并顺序(INDEX §2):SC →(SI ‖ W)→ AU → Z。** 本车道最先合并;SI 依赖本车道的一切。
- **文件归属(INDEX §9)。** 只改本计划列出的文件。`app/main.py` 只加自己的路由一行与三处锚点注释(INDEX §8)。
- **迁移:** `0022_curated_catalog.py`;SQLite 加列 / 建表不需要 batch,降级删列用 batch;Postgres 路径不重写大表;往返测试;`test_models_match_migrations` 绿;head 钉子全部改成 `0022`(INDEX §3)。
- **隐私:** 日志、错误、审计、计量里没有标题、许可说明、URL、句子、译文、分析;只记 id、数字、种类。新 `caplog` 一律 `caplog.set_level(logging.DEBUG, logger="app")`。
- **测试口径:** 每个任务只跑它列出的文件 + `tests/test_architecture.py`:`cd server && uv run pytest -q <files> tests/test_architecture.py`。不跑全量、不跑 E2E、不重建容器。永远不打真实上游(假工具、respx 假大模型 `https://llm.test/v1/chat/completions`)。
- **契约夹具 `tests/fixtures/library_contract.json` 只手工加键**(Task 8 给出一次性脚本,只插入新键);**绝不**用 `CONTRACT_UPDATE=1` 整体重录。
- **工作树是 CRLF**:改现有文件用 Edit,新文件用 Write。
- **提交:** conventional(`feat(server): …`、`test(server): …`、`docs: …`),一个任务一个提交,该任务的测试全绿;只 `git add` 本任务列出的文件;信息以 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` 结尾。

## 文件结构

```
server/
  alembic/versions/0022_curated_catalog.py        新(Task 1)
  app/models.py                                     + CatalogItem、CatalogSegment、LibraryItem.catalog_id(Task 1)
  app/core/config.py、settings_registry.py          + library_catalog_enabled、library_catalog_ai_daily(Task 2)
  app/core/metering.py                              + system_scope()(Task 2)
  .env.example                                      + 两行(Task 2)
  app/library/errors.py                             + 三个错误码(Task 2)
  app/library/paths.py                              + 目录路径函数(Task 2)
  app/library/limits.py                             + SCOPE_CATALOG_AI;item_count 排除副本(Task 2、Task 6)
  app/library/catalog_store.py                      新(Task 3、Task 4)
  app/library/store.py                              item_out 加 catalog_id(Task 3)
  app/library/ai.py                                 + translate_texts、analyze_catalog(Task 7)
  app/library/worker.py                             sweep 后回收退役目录(Task 6)
  app/routers/library_catalog.py                    新(Task 5)
  app/routers/library.py                            config.catalog;副本保护;删除后回收;译文补全;共享分析(Task 5–7)
  app/main.py                                       路由一行 + 三处锚点(Task 5)
  tests/background.py                               + catalog 任务集(Task 5)
  tests/catalog_helpers.py                          新:造目录条目(Task 3)
  tests/test_library_catalog_models.py              新(Task 1、2)
  tests/test_library_catalog_store.py               新(Task 3、4)
  tests/test_library_catalog_api.py                 新(Task 5)
  tests/test_library_catalog_media.py               新(Task 6)
  tests/test_library_catalog_ai.py                  新(Task 7)
  tests/test_migrations.py、test_library_models.py、test_changelog_models.py   head 钉子(Task 1)
  tests/test_library_privacy.py、test_library_contract.py、fixtures/library_contract.json  (Task 8)
  app/library/CLAUDE.md、app/CLAUDE.md、app/routers/CLAUDE.md、README.md        (Task 9)
web/src/features/library/{library-api.ts,config.ts,library-contract.test.ts,locales/en.json,locales/zh-CN.json}  (Task 8)
```

## 本计划的裁定

- **R-SC1 `library_items.catalog_id` 不加外键。** 目录行的删除由应用层先处理副本(spec R1);外键在 SQLite 上本来不强制,Postgres 上加了反而让「退役后回收」与「强制删除」的顺序更脆。唯一索引 `(user_id, catalog_id)` 只负责幂等。
- **R-SC2 副本 `kind="audio"`、`library_bytes=0`、`upload_total=0`、`rebuildable=False`、`source_host=None`。** 配额(`used_bytes`)因此天然为 0;`item_count` 另外显式排除 `source == "catalog"`(spec E7)。
- **R-SC3 错误码的位置。** 新码进 `app/library/errors.API_ERRORS`,于是 `routers/library.ERRORS`、契约夹具 `errors`、网页 `LIBRARY_SERVER_ERRORS` 都按现有机制带上它们。
- **R-SC4 `config.catalog = enabled ∧ library_catalog_enabled`**,其中 `enabled` 是现有的 `library_available`。用户接口的闸门只看 `library_enabled` 与 `library_catalog_enabled`(与现有 `require_library` 只看总开关一致)。
- **R-SC5 共享分析的条件**(spec R3):副本的这一句在本人行上还没有该语言的分析,且 `language == 目录.ai_lang`,且本人句子文字与目录句子相同(`store.same_text`)。满足 → `ai.analyze_catalog`(系统计费、共享缓存)并把结果也写进本人行;否则走现有 `ai.analyze`(用户额度)。
- **R-SC6 译文补全**:`translate` 端点对副本先调 `catalog_store.fill_translations`(只在 `language == ai_lang` 且文字相同的句子上复制),然后对这几行逐个 `await session.refresh(seg)`,再走现有 `ai.translate`(只剩其他语言或改过字的句子会花用户额度)。会话 `expire_on_commit=False`(`main.py`),UPDATE 语句不会刷新已加载的对象;**不要用 `session.expire_all()`**:它会让路由里的 `item` 在下一次属性访问时做同步懒加载,在 async 会话里抛 `MissingGreenlet`。
- **R-SC7 回收的三个触发点**:用户 `DELETE /api/library/items/{id}`(之后 `collect_if_orphan`)、`LibraryWorker.sweep`(之后 `collect_retired`,**不改 `sweep` 返回的计数字典**,`tests/test_library_worker.py` 精确比对它)、SI 的管理端删除。
- **R-SC8 并发分析只花一次**:`ai.analyze_catalog` 用进程内 `(catalog_id, idx)` 锁,拿到锁后重读目录句子;单 worker 前提与票据相同。
- **R-SC9 `metering.system_scope()` 不改中间件、不改 `record`。** 只是一个把 `_user` 置 `None` 再复原的上下文管理器;请求结束后中间件本来就会复原。

---

## Task 0: 前置核对(只读,不提交)

- [ ] **Step 1:** `cd server && uv run alembic heads`,期望 `0021 (head)`。不是 `0021` → 停下:按 INDEX §3 顺延本计划所有 `0022`,并在 INDEX §3 追加一行实际号码。
- [ ] **Step 2:** `Grep "get_heads\(\) == \[" server/tests`,确认 7 处钉子(`test_migrations.py` 5、`test_library_models.py` 1、`test_changelog_models.py` 1)。
- [ ] **Step 3:** 读并确认 INDEX「写计划时读过的真实代码」里与本车道相关的签名仍然成立:`store.delete_item` / `remove_item_files` 的删除范围、`limits.used_bytes` / `item_count`、`routers/library.py::media` 的查找方式、`LibraryWorker.sweep` 的返回字典、`main.py` 里 `library_import.install(app)` 与路由元组 `admin_library,` 的位置。不一致 → 只改本计划自己的文件去适配,改不了就停下上报。

---

## Task 1: 迁移 0022、模型、head 钉子(强模型)

**Files:**
- Create: `server/alembic/versions/0022_curated_catalog.py`
- Modify: `server/app/models.py`(`LibraryItem` 加列与索引;`LibraryAttempt` 之后加两个类)
- Modify: `server/tests/test_migrations.py`、`server/tests/test_library_models.py`、`server/tests/test_changelog_models.py`(钉子 `"0021"` → `"0022"`)
- Create: `server/tests/test_library_catalog_models.py`

- [ ] **Step 1: 写失败测试** `server/tests/test_library_catalog_models.py`:

```python
"""迁移 0022_curated_catalog 与精选库模型(spec 2026-10-14-curated-library §5)。"""
import sqlite3

import pytest
from alembic import command
from alembic.script import ScriptDirectory

from app.models import CatalogItem, CatalogSegment, LibraryItem
from tests.test_migrations import _config, _tables

CATALOG_TABLES = {"catalog_items", "catalog_segments"}


def _indexes(con, table: str) -> dict[str, bool]:
    return {r[1]: bool(r[2]) for r in con.execute(f"pragma index_list({table})")}


def test_head_is_0022_and_follows_0021(tmp_path, monkeypatch):
    cfg, _db = _config(tmp_path, monkeypatch)
    script = ScriptDirectory.from_config(cfg)
    assert script.get_heads() == ["0022"]
    assert script.get_revision("0022").down_revision == "0021"


def test_0022_creates_catalog_tables_and_the_copy_column_and_round_trips(tmp_path, monkeypatch):
    cfg, db = _config(tmp_path, monkeypatch)
    command.upgrade(cfg, "0021")
    con = sqlite3.connect(db)
    con.execute("insert into users (id, username, password_hash, created_at) values (12345678, 'u', 'x', '2026-10-14')")
    con.execute("insert into library_items (id, user_id, kind, source, title, status, created_at, updated_at) "
                "values ('i1', 12345678, 'video', 'upload', 't', 'ready', '2026-10-14', '2026-10-14')")
    con.commit()
    con.close()
    command.upgrade(cfg, "0022")
    assert CATALOG_TABLES <= _tables(db)
    con = sqlite3.connect(db)
    try:
        cols = {r[1] for r in con.execute("pragma table_info(library_items)")}
        assert "catalog_id" in cols
        assert con.execute("select catalog_id from library_items where id='i1'").fetchone() == (None,)
        assert _indexes(con, "library_items")["ux_library_items_user_id_catalog_id"] is True
        assert "ix_catalog_items_status_created_at" in _indexes(con, "catalog_items")
        fks = {(r[2], r[3], r[6]) for r in con.execute("pragma foreign_key_list(catalog_segments)")}
        assert fks == {("catalog_items", "catalog_id", "CASCADE")}
        con.execute("insert into catalog_items (id, title, source, status, created_at, updated_at) "
                    "values ('c1', 'T', 'upload', 'queued', '2026-10-14', '2026-10-14')")
        row = con.execute("select ai_lang, published, progress, media_bytes, seg_count from catalog_items").fetchone()
        assert row == ("zh-CN", 0, 0, 0, 0)
        # two plain items of one user (catalog_id NULL) never collide; two copies of one catalog item do
        con.execute("insert into library_items (id, user_id, kind, source, title, status, created_at, updated_at) "
                    "values ('i2', 12345678, 'audio', 'upload', 't', 'ready', '2026-10-14', '2026-10-14')")
        con.execute("insert into library_items (id, user_id, kind, source, title, status, catalog_id, created_at, "
                    "updated_at) values ('i3', 12345678, 'audio', 'catalog', 't', 'ready', 'c1', '2026-10-14', "
                    "'2026-10-14')")
        with pytest.raises(sqlite3.IntegrityError):
            con.execute("insert into library_items (id, user_id, kind, source, title, status, catalog_id, "
                        "created_at, updated_at) values ('i4', 12345678, 'audio', 'catalog', 't', 'ready', 'c1', "
                        "'2026-10-14', '2026-10-14')")
        con.commit()
    finally:
        con.close()
    command.downgrade(cfg, "0021")
    assert not (CATALOG_TABLES & _tables(db))
    con = sqlite3.connect(db)
    try:
        assert "catalog_id" not in {r[1] for r in con.execute("pragma table_info(library_items)")}
        assert con.execute("select count(*) from library_items").fetchone() == (3,)
    finally:
        con.close()
    command.upgrade(cfg, "0022")
    assert CATALOG_TABLES <= _tables(db)


def test_models_declare_the_frozen_names():
    assert CatalogItem.__tablename__ == "catalog_items" and CatalogSegment.__tablename__ == "catalog_segments"
    cols = set(CatalogItem.__table__.columns.keys())
    assert cols == {"id", "title", "level", "tags", "license_note", "source", "source_host", "source_url", "status",
                    "stage", "progress", "error_kind", "upload_total", "upload_received", "duration_ms", "media_path",
                    "poster_path", "media_mime", "media_bytes", "sub_source", "asr_seconds", "seg_count",
                    "low_confidence", "ai_lang", "published", "published_at", "retired_at", "created_at", "updated_at"}
    assert set(CatalogSegment.__table__.columns.keys()) == {"catalog_id", "idx", "start_ms", "end_ms", "text", "zh",
                                                            "zh_lang", "analysis", "analysis_lang", "flags"}
    assert "catalog_id" in LibraryItem.__table__.columns
    assert not LibraryItem.__table__.columns["catalog_id"].foreign_keys  # R-SC1
```

- [ ] **Step 2:** `cd server && uv run pytest -q tests/test_library_catalog_models.py` → 失败(没有 0022、没有模型)。
- [ ] **Step 3: 迁移** `server/alembic/versions/0022_curated_catalog.py`:

```python
"""curated catalog: system-owned catalog items + sentences, and library_items.catalog_id
(spec 2026-10-14-curated-library §5)

Revision ID: 0022
Revises: 0021
Create Date: 2026-10-14 18:00:00.000000

Two new tables (no user_id: the catalog belongs to the system) and one nullable column on library_items with a unique
index (user_id, catalog_id): NULLs are distinct on SQLite and Postgres, so plain items are unaffected and a second copy
of one catalog item for one user is refused (idempotent "add"). No FK from library_items.catalog_id (plan R-SC1).
ADD COLUMN / CREATE TABLE / CREATE INDEX need no batch on SQLite; the downgrade drops the column in batch mode.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0022'
down_revision: Union[str, Sequence[str], None] = '0021'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'catalog_items',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('title', sa.String(200), nullable=False),
        sa.Column('level', sa.String(2), nullable=True),
        sa.Column('tags', sa.String(120), nullable=True),
        sa.Column('license_note', sa.String(300), nullable=True),
        sa.Column('source', sa.String(8), nullable=False),
        sa.Column('source_host', sa.String(64), nullable=True),
        sa.Column('source_url', sa.Text(), nullable=True),
        sa.Column('status', sa.String(12), nullable=False),
        sa.Column('stage', sa.String(16), nullable=True),
        sa.Column('progress', sa.SmallInteger(), nullable=False, server_default='0'),
        sa.Column('error_kind', sa.String(24), nullable=True),
        sa.Column('upload_total', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('upload_received', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('duration_ms', sa.Integer(), nullable=True),
        sa.Column('media_path', sa.String(200), nullable=True),
        sa.Column('poster_path', sa.String(200), nullable=True),
        sa.Column('media_mime', sa.String(32), nullable=True),
        sa.Column('media_bytes', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('sub_source', sa.String(10), nullable=True),
        sa.Column('asr_seconds', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('seg_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('low_confidence', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('ai_lang', sa.String(8), nullable=False, server_default='zh-CN'),
        sa.Column('published', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('published_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('retired_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index('ix_catalog_items_status_created_at', 'catalog_items', ['status', 'created_at'])
    op.create_table(
        'catalog_segments',
        sa.Column('catalog_id', sa.String(36), sa.ForeignKey('catalog_items.id', ondelete='CASCADE'),
                  primary_key=True),
        sa.Column('idx', sa.Integer(), primary_key=True, autoincrement=False),
        sa.Column('start_ms', sa.Integer(), nullable=False),
        sa.Column('end_ms', sa.Integer(), nullable=False),
        sa.Column('text', sa.Text(), nullable=False),
        sa.Column('zh', sa.Text(), nullable=True),
        sa.Column('zh_lang', sa.String(8), nullable=True),
        sa.Column('analysis', sa.Text(), nullable=True),
        sa.Column('analysis_lang', sa.String(8), nullable=True),
        sa.Column('flags', sa.String(48), nullable=True),
    )
    op.add_column('library_items', sa.Column('catalog_id', sa.String(36), nullable=True))
    op.create_index('ux_library_items_user_id_catalog_id', 'library_items', ['user_id', 'catalog_id'], unique=True)


def downgrade() -> None:
    op.drop_index('ux_library_items_user_id_catalog_id', table_name='library_items')
    with op.batch_alter_table('library_items') as batch:
        batch.drop_column('catalog_id')
    op.drop_table('catalog_segments')
    op.drop_index('ix_catalog_items_status_created_at', table_name='catalog_items')
    op.drop_table('catalog_items')
```

- [ ] **Step 4: 模型**(`server/app/models.py`)。`LibraryItem.__table_args__` 追加
  `Index("ux_library_items_user_id_catalog_id", "user_id", "catalog_id", unique=True),`;在 `last_opened_at` 之后追加
  `catalog_id: Mapped[str | None] = mapped_column(String(36), nullable=True)  # 精选库副本(spec 2026-10-14-curated-library E1;无外键,R-SC1)`。
  在 `LibraryAttempt` 之后追加:

```python
# ---- 精选库(设计文档 2026-10-14-curated-library §5;迁移 0022)----

class CatalogItem(Base):
    """系统所有的一条内置素材(只存音频 + 封面,`library/_catalog/<id>/`)。标题、许可说明、句子只给界面;
    日志、审计、计量只记 id 与数字。删除规则见 spec R1(退役 / 回收 / 强制删除)。"""
    __tablename__ = "catalog_items"
    __table_args__ = (Index("ix_catalog_items_status_created_at", "status", "created_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    title: Mapped[str] = mapped_column(String(200))
    level: Mapped[str | None] = mapped_column(String(2), nullable=True)  # A1..C2
    tags: Mapped[str | None] = mapped_column(String(120), nullable=True)  # comma-joined, <= 5
    license_note: Mapped[str | None] = mapped_column(String(300), nullable=True)
    source: Mapped[str] = mapped_column(String(8))  # upload / link
    source_host: Mapped[str | None] = mapped_column(String(64), nullable=True)
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)  # cleared when ready (spec R6)
    status: Mapped[str] = mapped_column(String(12))  # uploading / queued / processing / ready / failed / canceled
    stage: Mapped[str | None] = mapped_column(String(16), nullable=True)
    progress: Mapped[int] = mapped_column(SmallInteger, default=0, server_default="0")
    error_kind: Mapped[str | None] = mapped_column(String(24), nullable=True)
    upload_total: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
    upload_received: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    media_path: Mapped[str | None] = mapped_column(String(200), nullable=True)
    poster_path: Mapped[str | None] = mapped_column(String(200), nullable=True)
    media_mime: Mapped[str | None] = mapped_column(String(32), nullable=True)
    media_bytes: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
    sub_source: Mapped[str | None] = mapped_column(String(10), nullable=True)
    asr_seconds: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    seg_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    low_confidence: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    ai_lang: Mapped[str] = mapped_column(String(8), default="zh-CN", server_default="zh-CN")
    published: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    retired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CatalogSegment(Base):
    """目录的一句;列与 `library_segments` 同名同型(复制时一一对应)。`zh` / `analysis` 只缓存 `ai_lang` 一种语言。"""
    __tablename__ = "catalog_segments"

    catalog_id: Mapped[str] = mapped_column(ForeignKey("catalog_items.id", ondelete="CASCADE"), primary_key=True)
    idx: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    start_ms: Mapped[int] = mapped_column(Integer)
    end_ms: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    zh: Mapped[str | None] = mapped_column(Text, nullable=True)
    zh_lang: Mapped[str | None] = mapped_column(String(8), nullable=True)
    analysis: Mapped[str | None] = mapped_column(Text, nullable=True)
    analysis_lang: Mapped[str | None] = mapped_column(String(8), nullable=True)
    flags: Mapped[str | None] = mapped_column(String(48), nullable=True)
```

- [ ] **Step 5:** 7 处 head 钉子 `["0021"]` → `["0022"]`;`tests/test_library_models.py` 的测试名 `test_chain_through_0019_is_linear_and_head_is_0021` 改成 `..._head_is_0022`(断言体只改号码)。
- [ ] **Step 6:** `cd server && uv run pytest -q tests/test_library_catalog_models.py tests/test_migrations.py tests/test_library_models.py tests/test_changelog_models.py tests/test_architecture.py` → 全绿(含 `test_models_match_migrations`)。
- [ ] **Step 7: 提交** `feat(server): catalog tables and library_items.catalog_id (migration 0022)`。

---

## Task 2: 设置、错误码、路径、计数 scope、`metering.system_scope`(誊写为主)

**Files:**
- Modify: `server/app/core/config.py`(在 `library_ai_daily_global` 之后)、`server/app/core/settings_registry.py`(在 `library_ai_daily_global` 那行之后)、`server/.env.example`(「跟读库」段末)
- Modify: `server/app/core/metering.py`、`server/app/library/errors.py`、`server/app/library/paths.py`、`server/app/library/limits.py`
- Modify: `server/tests/test_library_catalog_models.py`(追加)

- [ ] **Step 1: 追加失败测试**到 `tests/test_library_catalog_models.py`:

```python
from pathlib import Path

from app.core import metering
from app.core.config import Settings
from app.core.settings_registry import SPECS
from app.library import errors, limits, paths

CID = "0f0e0d0c-0b0a-4908-8706-050403020100"


def test_new_settings_have_defaults_and_specs():
    s = Settings()
    assert s.library_catalog_enabled is False and s.library_catalog_ai_daily == 300
    assert SPECS["library_catalog_enabled"].group == "library"
    assert SPECS["library_catalog_ai_daily"].danger  # costs money (system-paid analyses)


def test_new_error_codes_are_fixed_english():
    assert errors.API_ERRORS["catalog_disabled"] == (404, "Built-in library is disabled")
    assert errors.API_ERRORS["catalog_not_found"] == (404, "Built-in item not found")
    assert errors.API_ERRORS["catalog_locked"] == (409, "Built-in items cannot be changed this way")


def test_catalog_paths_live_beside_user_dirs_and_reject_bad_ids(tmp_path):
    assert paths.catalog_rel(CID) == f"library/_catalog/{CID}"
    assert paths.catalog_tmp_rel(CID) == f"library/_catalog/_tmp/{CID}"
    assert paths.catalog_dir(tmp_path, CID) == (tmp_path / "library" / "_catalog" / CID).resolve()
    assert paths.catalog_tmp_dir(tmp_path, CID) == (tmp_path / "library" / "_catalog" / "_tmp" / CID).resolve()
    for bad in ("../x", "_tmp", "", CID.upper()):
        with pytest.raises(ValueError):
            paths.catalog_rel(bad)
    # the user library's staging root is elsewhere: its sweep never sees catalog staging
    assert not paths.catalog_tmp_dir(tmp_path, CID).is_relative_to(paths.tmp_root(tmp_path))


def test_remove_catalog_files_takes_both_dirs_only(tmp_path):
    keep = paths.item_dir(tmp_path, 7, CID)
    keep.mkdir(parents=True)
    for d in (paths.catalog_dir(tmp_path, CID), paths.catalog_tmp_dir(tmp_path, CID)):
        d.mkdir(parents=True)
        (d / "x").write_bytes(b"1")
    paths.remove_catalog_files(tmp_path, CID)
    assert not paths.catalog_dir(tmp_path, CID).exists() and not paths.catalog_tmp_dir(tmp_path, CID).exists()
    assert keep.is_dir()


def test_catalog_ai_scope_name_fits_daily_usage():
    assert limits.SCOPE_CATALOG_AI == "library_cat_ai"


def test_system_scope_unbinds_the_user_and_restores_it():
    metering.bind_user(42)
    with metering.system_scope():
        assert metering.current_user_id() is None
    assert metering.current_user_id() == 42
    metering.bind_user(None)
```

- [ ] **Step 2:** 跑 → 失败。
- [ ] **Step 3: 实现。**
  - `config.py`(`library_ai_daily_global` 之后):

```python
    # 精选库(spec 2026-10-14-curated-library E12、R3):用户可见开关;共享分析每天全站最多生成多少句(系统付费)
    library_catalog_enabled: bool = False
    library_catalog_ai_daily: int = Field(300, ge=0, le=100_000)
```

  - `settings_registry.py`(`library_ai_daily_global` 那行之后):

```python
    # 精选库(spec 2026-10-14-curated-library)
    _s("library_catalog_enabled", "library", "bool", "精选库(内置素材)",
       help_zh="关 = 用户看不到「精选」;已加入的副本照常可用;管理端导入不受影响"),
    _s("library_catalog_ai_daily", "library", "int", "精选库共享分析每日句数",
       help_zh="首次生成后所有用户共享;系统付费,不扣用户额度", danger=_COST),
```

  - `server/.env.example`(在 `# LIBRARY_AI_DAILY_GLOBAL=5000` 之后):

```text
# 精选库(内置素材):用户侧「精选」页签开关(默认关;管理端导入不受影响)
# LIBRARY_CATALOG_ENABLED=false
# 精选素材的句子 AI 分析:首次生成后所有用户共享,系统付费;每天全站最多生成多少句
# LIBRARY_CATALOG_AI_DAILY=300
```

  - `metering.py`(在 `feature_scope` 之后):

```python
@contextmanager
def system_scope():
    """Upstream calls inside are the system's (curated catalog: plan 2026-10-14-curated-library R-SC9): no user is
    charged in `upstream_calls` (user_id NULL; usage_daily rolls it up as 0). The previous user comes back on exit."""
    token = _user.set(None)
    try:
        yield
    finally:
        _user.reset(token)
```

  - `errors.py` `API_ERRORS` 末尾:

```python
    # 精选库(spec 2026-10-14-curated-library §9)
    "catalog_disabled": (404, "Built-in library is disabled"),
    "catalog_not_found": (404, "Built-in item not found"),
    "catalog_locked": (409, "Built-in items cannot be changed this way"),
```

  - `paths.py`(模块文档字符串的布局图加两行 `library/_catalog/<catalog_id>/media.m4a | poster.jpg` 与 `library/_catalog/_tmp/<catalog_id>/`;文件末尾):

```python
# ---- 精选库(spec 2026-10-14-curated-library E4):系统所有,所有用户共用 ----
CATALOG = "_catalog"


def catalog_rel(catalog_id: str) -> str:
    return f"{ROOT}/{CATALOG}/{check_item_id(catalog_id)}"


def catalog_tmp_rel(catalog_id: str) -> str:
    return f"{ROOT}/{CATALOG}/{TMP}/{check_item_id(catalog_id)}"


def catalog_dir(data_dir: Path, catalog_id: str) -> Path:
    return absolute(data_dir, catalog_rel(catalog_id))


def catalog_tmp_dir(data_dir: Path, catalog_id: str) -> Path:
    return absolute(data_dir, catalog_tmp_rel(catalog_id))


def remove_catalog_files(data_dir: Path, catalog_id: str) -> None:
    remove_tree(catalog_dir(data_dir, catalog_id))
    remove_tree(catalog_tmp_dir(data_dir, catalog_id))
```

  - `limits.py`(scope 常量旁):`SCOPE_CATALOG_AI = "library_cat_ai"  # curated catalog: system-paid shared analyses (subject "*")`。
- [ ] **Step 4:** `cd server && uv run pytest -q tests/test_library_catalog_models.py tests/test_library_settings.py tests/test_settings_registry.py tests/test_architecture.py` → 绿(`test_settings_registry.py` 强制每个字段都有 `SettingSpec`)。
- [ ] **Step 5: 提交** `feat(server): catalog settings, error codes, paths and metering system scope`。

---

## Task 3: `catalog_store` 第一部分:清洗、输出形状、读写、队列(强模型)

**Files:**
- Create: `server/app/library/catalog_store.py`
- Modify: `server/app/library/store.py`(`item_out` 加 `"catalog_id": row.catalog_id`)
- Create: `server/tests/catalog_helpers.py`、`server/tests/test_library_catalog_store.py`

- [ ] **Step 1: 测试助手** `server/tests/catalog_helpers.py`:

```python
"""精选库测试工具:直接写库造一条目录条目(含共享文件),不经过导入流水线(那是车道 SI 的事)。"""
from app.library import paths
from app.models import CatalogItem, CatalogSegment, utcnow

MEDIA = bytes(range(256)) * 16  # 4096 bytes: enough for Range tests
POSTER = b"\xff\xd8\xff\xe0fake-jpeg"
SEGMENTS = [(500, 3000, "Hello there, my friend.", "你好,我的朋友。"),
            (3200, 6000, "How are you doing today?", "你今天好吗?")]


def data_dir_of(app):
    return app.state.library.deps.data_dir


async def make_catalog(app, *, title: str = "Catalog talk", status: str = "ready", published: bool = True,
                       retired: bool = False, ai_lang: str = "zh-CN", segments=SEGMENTS, with_files: bool = True,
                       level: str | None = "B1", tags: str | None = "news,science") -> str:
    now = utcnow()
    async with app.state.sessionmaker() as s:
        row = CatalogItem(title=title, source="upload", status=status, ai_lang=ai_lang, published=published,
                          published_at=now if published else None, retired_at=now if retired else None,
                          duration_ms=6000, media_mime="audio/mp4", sub_source="uploaded", level=level, tags=tags,
                          license_note="VOA Learning English · Public domain", created_at=now, updated_at=now)
        s.add(row)
        await s.flush()
        rel = paths.catalog_rel(row.id)
        if with_files:
            folder = paths.catalog_dir(data_dir_of(app), row.id)
            folder.mkdir(parents=True, exist_ok=True)
            (folder / "media.m4a").write_bytes(MEDIA)
            (folder / "poster.jpg").write_bytes(POSTER)
        row.media_path, row.poster_path = f"{rel}/media.m4a", f"{rel}/poster.jpg"
        row.media_bytes = len(MEDIA) + len(POSTER)
        for i, (start, end, text, zh) in enumerate(segments):
            s.add(CatalogSegment(catalog_id=row.id, idx=i, start_ms=start, end_ms=end, text=text, zh=zh,
                                 zh_lang=ai_lang if zh else None))
        row.seg_count = len(segments)
        await s.commit()
        return row.id


def media_file(app, catalog_id: str):
    return paths.catalog_dir(data_dir_of(app), catalog_id) / "media.m4a"
```

- [ ] **Step 2: 失败测试** `server/tests/test_library_catalog_store.py`(第一部分):

```python
"""catalog_store(plan 2026-10-14-curated-library-server-core Task 3–4)。"""
from datetime import timedelta

import pytest
from sqlalchemy import func, select

from app.library import catalog_store, store
from app.library.segment import Sentence
from app.models import CatalogItem, CatalogSegment, LibraryItem, LibrarySegment, utcnow
from tests.catalog_helpers import SEGMENTS, data_dir_of, make_catalog, media_file
from tests.library_helpers import library_settings


@pytest.fixture
def settings_overrides(tmp_path):
    return library_settings(tmp_path, library_catalog_enabled=True)


def test_clean_level_and_tags():
    assert catalog_store.clean_level(" b1 ") == "B1" and catalog_store.clean_level("") is None
    assert catalog_store.clean_level(None) is None
    with pytest.raises(ValueError):
        catalog_store.clean_level("D1")
    assert catalog_store.clean_tags([" News ", "news", "科技", "  "]) == ["News", "科技"]
    for bad in (["a,b"], ["x" * 17], ["1", "2", "3", "4", "5", "6"], [3]):
        with pytest.raises(ValueError):
            catalog_store.clean_tags(bad)
    assert catalog_store.clean_license("  VOA   Learning ") == "VOA Learning"
    assert catalog_store.clean_license("   ") is None
    with pytest.raises(ValueError):
        catalog_store.clean_license("x" * 301)


async def test_create_get_and_outputs(app):
    async with app.state.sessionmaker() as s:
        row = await catalog_store.create(s, source="link", status="queued", title="A talk", level="A2",
                                         tags=["news", "health"], license_note="TED · CC BY-NC-ND 4.0",
                                         ai_lang="zh-CN", source_url="https://example.invalid/x",
                                         source_host="example.invalid")
        assert (await catalog_store.get(s, row.id)).title == "A talk"
        assert await catalog_store.get(s, "../etc") is None
        assert catalog_store.tags_of(row) == ["news", "health"]
        out = catalog_store.admin_out(row, refs=2, translated=0, media_missing=False)
        assert set(out) == {"id", "title", "level", "tags", "license_note", "source", "source_host", "status", "stage",
                            "progress", "error_kind", "duration_ms", "seg_count", "translated", "sub_source",
                            "low_confidence", "media_bytes", "has_poster", "media_missing", "ai_lang", "published",
                            "published_at", "retired", "refs", "upload_received", "upload_total", "created_at",
                            "updated_at"}
        assert "source_url" not in out and out["refs"] == 2 and out["retired"] is False
        card = catalog_store.public_out(row, None)
        assert set(card) == {"id", "title", "level", "tags", "license_note", "duration_ms", "seg_count", "has_poster",
                             "published_at", "added_item_id"}


async def test_list_published_hides_drafts_retired_and_unready(app):
    shown = await make_catalog(app, title="shown")
    await make_catalog(app, title="draft", published=False)
    await make_catalog(app, title="retired", retired=True)
    await make_catalog(app, title="busy", status="processing")
    async with app.state.sessionmaker() as s:
        rows = await catalog_store.list_published(s, user_id=1)
        assert [(r.id, added) for r, added in rows] == [(shown, None)]
        assert await catalog_store.get_published(s, shown) is not None
        assert len(await catalog_store.list_all(s)) == 4


async def test_write_segments_and_guarded_ai_writes(app):
    cid = await make_catalog(app, segments=[])
    async with app.state.sessionmaker() as s:
        row = await catalog_store.get(s, cid)
        await catalog_store.write_segments(s, row, [Sentence(0, 1000, "One."), Sentence(1000, 2000, "Two.")],
                                           flags=[("rate",), ()])
        await s.commit()
        segs = await catalog_store.segments_of(s, cid)
        assert [(x.idx, x.text, x.flags) for x in segs] == [(0, "One.", "rate"), (1, "Two.", None)]
        assert row.seg_count == 2
        stored = await catalog_store.set_translations(s, cid, [(0, "One.", "一。"), (1, "stale text", "二。")], "zh-CN")
        assert stored == {0}
        assert await catalog_store.set_analysis(s, cid, 1, "Two.", "### 分析", "zh-CN") is True
        assert await catalog_store.set_analysis(s, cid, 1, "changed", "### x", "zh-CN") is False
        counts = await catalog_store.translated_counts(s, [row])
        assert counts == {cid: 1}
        assert catalog_store.segment_admin_out((await catalog_store.segments_of(s, cid))[1])["has_analysis"] is True


async def test_queue_claim_recover_and_fail(app):
    now = utcnow()
    async with app.state.sessionmaker() as s:
        a = await catalog_store.create(s, source="upload", status="queued", title="a", level=None, tags=[],
                                       license_note=None, ai_lang="zh-CN")
        b = await catalog_store.create(s, source="upload", status="queued", title="b", level=None, tags=[],
                                       license_note=None, ai_lang="zh-CN")
        first = await catalog_store.claim_next(s, now)
        assert first.id == a.id and first.status == "processing"
        assert (await catalog_store.claim_next(s, now)).id == b.id
        assert await catalog_store.claim_next(s, now) is None
        assert await catalog_store.set_progress(s, a.id, "probe", 10, now) is True
        assert await catalog_store.recover(s, now) == 2
        assert (await catalog_store.claim_next(s, now)).id == a.id
        assert await catalog_store.fail(s, a.id, "no_audio", now) is True
        await s.refresh(a)
        assert (a.status, a.error_kind) == ("failed", "no_audio")
        assert await catalog_store.set_progress(s, a.id, "probe", 20, now) is False  # not processing any more


async def test_fail_of_a_translate_only_rerun_gives_the_item_back_ready(app):
    cid = await make_catalog(app, status="processing", published=False)
    async with app.state.sessionmaker() as s:
        assert await catalog_store.fail(s, cid, "upstream", utcnow()) is True
        row = await catalog_store.get(s, cid)
        await s.refresh(row)
        assert (row.status, row.error_kind, row.progress) == ("ready", "upstream", 100)


async def test_media_missing(app):
    cid = await make_catalog(app)
    async with app.state.sessionmaker() as s:
        row = await catalog_store.get(s, cid)
        assert catalog_store.media_missing(data_dir_of(app), row) is False
        media_file(app, cid).unlink()
        assert catalog_store.media_missing(data_dir_of(app), row) is True
```

- [ ] **Step 3:** 跑 `uv run pytest -q tests/test_library_catalog_store.py` → 失败。
- [ ] **Step 4: 实现** `server/app/library/catalog_store.py`(第一部分;第二部分在 Task 4 追加到同一文件末尾):

```python
"""精选库的数据库读写(spec 2026-10-14-curated-library §5、R1、E8):系统所有的目录条目与句子、输出形状、
任务队列,以及(Task 4)复制到用户库、引用数、回收与强制删除。

标题、许可说明、句子、译文只给界面;日志只有 id 与数字。目录只缓存 `ai_lang` 一种语言的译文与分析(E11)。"""
import logging
from datetime import datetime
from pathlib import Path

from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.library import paths, store
from app.library.limits import TITLE_MAX
from app.library.segment import Sentence
from app.models import CatalogItem, CatalogSegment, LibraryItem, LibrarySegment, iso_utc, new_uuid, utcnow

logger = logging.getLogger(__name__)

LEVELS = ("A1", "A2", "B1", "B2", "C1", "C2")
TAGS_MAX, TAG_MAX, LICENSE_MAX, LIST_MAX = 5, 16, 300, 200
DEFAULT_AI_LANG = "zh-CN"
ACTIVE = ("uploading", "queued", "processing")


# ---- cleaning (spec R7) ----

def clean_level(raw: str | None) -> str | None:
    value = (raw or "").strip().upper()
    if not value:
        return None
    if value not in LEVELS:
        raise ValueError("level")
    return value


def clean_tags(raw: list[str] | None) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for tag in raw or []:
        if not isinstance(tag, str):
            raise ValueError("tags")
        value = " ".join(tag.split())
        if not value:
            continue
        if "," in value or len(value) > TAG_MAX:
            raise ValueError("tags")
        if value.casefold() in seen:
            continue
        seen.add(value.casefold())
        out.append(value)
    if len(out) > TAGS_MAX:
        raise ValueError("tags")
    return out


def clean_license(raw: str | None) -> str | None:
    value = " ".join((raw or "").split())
    if len(value) > LICENSE_MAX:
        raise ValueError("license_note")
    return value or None


def tags_of(row: CatalogItem) -> list[str]:
    return [t for t in (row.tags or "").split(",") if t]


# ---- output shapes (INDEX §6) ----

def public_out(row: CatalogItem, added_item_id: str | None) -> dict:
    return {"id": row.id, "title": row.title, "level": row.level, "tags": tags_of(row),
            "license_note": row.license_note, "duration_ms": row.duration_ms, "seg_count": row.seg_count,
            "has_poster": row.poster_path is not None,
            "published_at": iso_utc(row.published_at) if row.published_at else None, "added_item_id": added_item_id}


def admin_out(row: CatalogItem, *, refs: int, translated: int, media_missing: bool) -> dict:
    progress = row.progress
    if row.status == "uploading" and row.upload_total:
        progress = min(100, row.upload_received * 100 // row.upload_total)
    return {
        "id": row.id, "title": row.title, "level": row.level, "tags": tags_of(row), "license_note": row.license_note,
        "source": row.source, "source_host": row.source_host, "status": row.status, "stage": row.stage,
        "progress": progress, "error_kind": row.error_kind, "duration_ms": row.duration_ms, "seg_count": row.seg_count,
        "translated": translated, "sub_source": row.sub_source, "low_confidence": row.low_confidence,
        "media_bytes": row.media_bytes, "has_poster": row.poster_path is not None, "media_missing": media_missing,
        "ai_lang": row.ai_lang, "published": row.published,
        "published_at": iso_utc(row.published_at) if row.published_at else None,
        "retired": row.retired_at is not None, "refs": refs, "upload_received": row.upload_received,
        "upload_total": row.upload_total, "created_at": iso_utc(row.created_at), "updated_at": iso_utc(row.updated_at),
    }


def segment_admin_out(seg: CatalogSegment) -> dict:
    return {"idx": seg.idx, "start_ms": seg.start_ms, "end_ms": seg.end_ms, "text": seg.text, "zh": seg.zh,
            "zh_lang": seg.zh_lang, "has_analysis": bool(seg.analysis),
            "flags": seg.flags.split(",") if seg.flags else []}


# ---- create / read ----

async def create(session: AsyncSession, *, source: str, status: str, title: str, level: str | None, tags: list[str],
                 license_note: str | None, ai_lang: str, source_url: str | None = None,
                 source_host: str | None = None, upload_total: int = 0) -> CatalogItem:
    now = utcnow()
    row = CatalogItem(title=(title or "")[:TITLE_MAX], level=level, tags=",".join(tags) or None,
                      license_note=license_note, source=source, status=status, source_url=source_url,
                      source_host=(source_host or None) and source_host[:64], ai_lang=ai_lang,
                      upload_total=upload_total, upload_received=0, created_at=now, updated_at=now)
    session.add(row)
    await session.commit()
    return row


async def get(session: AsyncSession, catalog_id: str) -> CatalogItem | None:
    if not store.is_item_id(catalog_id):
        return None
    return await session.get(CatalogItem, catalog_id)


def _visible():
    return (CatalogItem.status == "ready", CatalogItem.published.is_(True), CatalogItem.retired_at.is_(None))


async def get_published(session: AsyncSession, catalog_id: str) -> CatalogItem | None:
    if not store.is_item_id(catalog_id):
        return None
    return await session.scalar(select(CatalogItem).where(CatalogItem.id == catalog_id, *_visible()))


async def list_published(session: AsyncSession, user_id: int) -> list[tuple[CatalogItem, str | None]]:
    rows = list((await session.scalars(select(CatalogItem).where(*_visible()).order_by(
        CatalogItem.published_at.desc(), CatalogItem.id.desc()).limit(LIST_MAX))).all())
    if not rows:
        return []
    mine = dict((await session.execute(select(LibraryItem.catalog_id, LibraryItem.id).where(
        LibraryItem.user_id == user_id, LibraryItem.catalog_id.in_([r.id for r in rows])))).all())
    return [(r, mine.get(r.id)) for r in rows]


async def list_all(session: AsyncSession) -> list[CatalogItem]:
    return list((await session.scalars(select(CatalogItem).order_by(CatalogItem.created_at.desc(),
                                                                    CatalogItem.id.desc()))).all())


async def segments_of(session: AsyncSession, catalog_id: str) -> list[CatalogSegment]:
    return list((await session.scalars(select(CatalogSegment).where(CatalogSegment.catalog_id == catalog_id)
                                       .order_by(CatalogSegment.idx))).all())


async def segment_at(session: AsyncSession, catalog_id: str, idx: int) -> CatalogSegment | None:
    """Always re-reads the row (`populate_existing`): `ai.analyze_catalog` must see what a concurrent request stored."""
    return await session.scalar(select(CatalogSegment).where(CatalogSegment.catalog_id == catalog_id,
                                                             CatalogSegment.idx == idx)
                                .execution_options(populate_existing=True))


async def write_segments(session: AsyncSession, row: CatalogItem, sentences: list[Sentence], *,
                         flags: list[tuple[str, ...]] | None = None) -> None:
    """Replace every sentence of a catalog item (caller commits)."""
    await session.execute(delete(CatalogSegment).where(CatalogSegment.catalog_id == row.id))
    session.add_all(
        CatalogSegment(catalog_id=row.id, idx=i, start_ms=s.start_ms, end_ms=s.end_ms, text=s.text,
                       flags=",".join(flags[i]) if flags is not None and i < len(flags) and flags[i] else None)
        for i, s in enumerate(sentences))
    row.seg_count = len(sentences)


async def set_translations(session: AsyncSession, catalog_id: str, entries: list[tuple[int, str, str]],
                           language: str) -> set[int]:
    """Store translations under the stale-text guard (same rule as `store.set_translations`). Commits."""
    stored = set()
    for idx, text, zh in entries:
        result = await session.execute(update(CatalogSegment).where(
            CatalogSegment.catalog_id == catalog_id, CatalogSegment.idx == idx, CatalogSegment.text == text)
            .values(zh=zh, zh_lang=language))
        if result.rowcount == 1:
            stored.add(idx)
    await session.commit()
    return stored


async def set_analysis(session: AsyncSession, catalog_id: str, idx: int, text: str, analysis: str,
                       language: str) -> bool:
    result = await session.execute(update(CatalogSegment).where(
        CatalogSegment.catalog_id == catalog_id, CatalogSegment.idx == idx, CatalogSegment.text == text)
        .values(analysis=analysis, analysis_lang=language))
    await session.commit()
    return result.rowcount == 1


# ---- the import queue (run by plan SI's CatalogJobs) ----

async def set_progress(session: AsyncSession, catalog_id: str, stage: str, progress: int, now: datetime) -> bool:
    result = await session.execute(update(CatalogItem).where(CatalogItem.id == catalog_id,
                                                             CatalogItem.status == "processing")
                                   .values(stage=stage, progress=max(0, min(100, progress)), updated_at=now))
    await session.commit()
    return result.rowcount == 1


async def claim_next(session: AsyncSession, now: datetime) -> CatalogItem | None:
    """The oldest queued item becomes `processing` (UPDATE ... WHERE status='queued' + row count: safe on Postgres)."""
    for catalog_id in (await session.scalars(select(CatalogItem.id).where(CatalogItem.status == "queued")
                                             .order_by(CatalogItem.created_at, CatalogItem.id).limit(5))).all():
        result = await session.execute(update(CatalogItem).where(CatalogItem.id == catalog_id,
                                                                 CatalogItem.status == "queued")
                                       .values(status="processing", stage=None, updated_at=now))
        await session.commit()
        if result.rowcount == 1:
            return (await session.execute(select(CatalogItem).where(CatalogItem.id == catalog_id)
                                          .execution_options(populate_existing=True))).scalar_one()
    return None


async def recover(session: AsyncSession, now: datetime) -> int:
    result = await session.execute(update(CatalogItem).where(CatalogItem.status == "processing")
                                   .values(status="queued", updated_at=now))
    await session.commit()
    return result.rowcount or 0


async def fail(session: AsyncSession, catalog_id: str, kind: str, now: datetime) -> bool:
    """A failed job: `failed` + kind. An item that already has sentences (a translate-only re-run, spec R9) goes back
    to `ready` and keeps the kind so the admin sees the attempt did not work."""
    kept = int(await session.scalar(select(CatalogItem.seg_count).where(CatalogItem.id == catalog_id)) or 0)
    values = dict(error_kind=kind, stage=None, updated_at=now)
    values.update(dict(status="ready", progress=100) if kept > 0 else dict(status="failed"))
    result = await session.execute(update(CatalogItem).where(CatalogItem.id == catalog_id,
                                                             CatalogItem.status == "processing").values(**values))
    await session.commit()
    return result.rowcount == 1


# ---- counts ----

async def refs(session: AsyncSession, catalog_id: str) -> int:
    return int(await session.scalar(select(func.count()).select_from(LibraryItem)
                                    .where(LibraryItem.catalog_id == catalog_id)) or 0)


async def ref_counts(session: AsyncSession, ids: list[str]) -> dict[str, int]:
    if not ids:
        return {}
    rows = (await session.execute(select(LibraryItem.catalog_id, func.count()).where(
        LibraryItem.catalog_id.in_(ids)).group_by(LibraryItem.catalog_id))).all()
    return {cid: int(n) for cid, n in rows}


async def translated_counts(session: AsyncSession, rows: list[CatalogItem]) -> dict[str, int]:
    if not rows:
        return {}
    lang = {r.id: r.ai_lang for r in rows}
    found = (await session.execute(select(CatalogSegment.catalog_id, CatalogSegment.zh_lang, func.count()).where(
        CatalogSegment.catalog_id.in_(list(lang)), CatalogSegment.zh.is_not(None))
        .group_by(CatalogSegment.catalog_id, CatalogSegment.zh_lang))).all()
    out = {cid: 0 for cid in lang}
    for cid, zh_lang, n in found:
        if zh_lang == lang[cid]:
            out[cid] += int(n)
    return out


def media_missing(data_dir: Path, row: CatalogItem) -> bool:
    """Only a ready item can miss its media (e.g. the database was restored without the data volume, spec R10)."""
    if row.status != "ready":
        return False
    if not row.media_path:
        return True
    try:
        return not paths.absolute(data_dir, row.media_path).is_file()
    except ValueError:
        return True
```

  `store.item_out` 字典里在 `"has_poster"` 之后加 `"catalog_id": row.catalog_id,`。

- [ ] **Step 5:** `uv run pytest -q tests/test_library_catalog_store.py tests/test_library_store.py tests/test_library_api.py tests/test_architecture.py` → 绿。**`tests/test_library_contract.py` 此时会红**(条目多了 `catalog_id`):这是预期的,Task 8 手工补夹具;本任务提交前**不要**重录夹具。
- [ ] **Step 6: 提交** `feat(server): catalog store (rows, shapes, queue)`。

---

## Task 4: `catalog_store` 第二部分:复制到用户库、补译文、回收、强制删除(强模型)

**Files:** Modify `server/app/library/catalog_store.py`(末尾追加);Modify `server/tests/test_library_catalog_store.py`(追加)

- [ ] **Step 1: 追加失败测试**:

```python
async def _uid(app, name="alice") -> int:
    from app.models import User
    async with app.state.sessionmaker() as s:
        user = User(username=name, password_hash="x")
        s.add(user)
        await s.commit()
        return user.id


async def test_add_copies_the_item_and_sentences_pointing_at_the_shared_file(app):
    cid = await make_catalog(app)
    uid = await _uid(app)
    async with app.state.sessionmaker() as s:
        item, created = await catalog_store.add_to_library(s, data_dir_of(app), user_id=uid, catalog_id=cid,
                                                           now=utcnow())
        assert created is True
        assert (item.source, item.kind, item.status, item.library_bytes, item.catalog_id) == (
            "catalog", "audio", "ready", 0, cid)
        cat = await catalog_store.get(s, cid)
        assert item.media_path == cat.media_path and item.poster_path == cat.poster_path
        assert item.rebuildable is False and item.seg_count == len(SEGMENTS)
        segs = await store.segments_of(s, item.id)
        assert [(x.text, x.zh, x.zh_lang) for x in segs] == [(t, zh, "zh-CN") for _a, _b, t, zh in SEGMENTS]
        again, created = await catalog_store.add_to_library(s, data_dir_of(app), user_id=uid, catalog_id=cid,
                                                            now=utcnow())
        assert (again.id, created) == (item.id, False)
        assert await catalog_store.refs(s, cid) == 1
        assert await s.scalar(select(func.count()).select_from(LibraryItem)) == 1


async def test_add_refuses_unpublished_retired_and_missing_media(app):
    uid = await _uid(app)
    draft = await make_catalog(app, published=False)
    retired = await make_catalog(app, retired=True)
    gone = await make_catalog(app, with_files=False)
    async with app.state.sessionmaker() as s:
        for cid in (draft, retired, gone, "not-a-uuid"):
            with pytest.raises(LookupError):
                await catalog_store.add_to_library(s, data_dir_of(app), user_id=uid, catalog_id=cid, now=utcnow())


async def test_a_second_add_racing_the_first_returns_the_existing_copy(app):
    """The unique index (user_id, catalog_id) decides; the loser reads the winner's row back."""
    cid = await make_catalog(app)
    uid = await _uid(app)
    async with app.state.sessionmaker() as s1, app.state.sessionmaker() as s2:
        first, _ = await catalog_store.add_to_library(s1, data_dir_of(app), user_id=uid, catalog_id=cid, now=utcnow())
        original = catalog_store._copy_of

        async def blind(session, user_id, catalog_id):  # s2 does not see s1's row on its first look
            blind.calls += 1
            return None if blind.calls == 1 else await original(session, user_id, catalog_id)
        blind.calls = 0
        catalog_store._copy_of = blind
        try:
            second, created = await catalog_store.add_to_library(s2, data_dir_of(app), user_id=uid, catalog_id=cid,
                                                                 now=utcnow())
        finally:
            catalog_store._copy_of = original
        assert (second.id, created) == (first.id, False)


async def test_fill_translations_copies_only_same_language_and_same_text(app):
    cid = await make_catalog(app, segments=[(0, 1000, "One.", None), (1000, 2000, "Two.", None)])
    uid = await _uid(app)
    async with app.state.sessionmaker() as s:
        item, _ = await catalog_store.add_to_library(s, data_dir_of(app), user_id=uid, catalog_id=cid, now=utcnow())
        await catalog_store.set_translations(s, cid, [(0, "One.", "一。"), (1, "Two.", "二。")], "zh-CN")
        segs = await store.segments_of(s, item.id)
        segs[1].text = "Two, edited."
        await s.commit()
        assert await catalog_store.fill_translations(s, item, segs, "ja-JP") == 0  # not the catalog's language
        assert await catalog_store.fill_translations(s, item, segs, "zh-CN") == 1  # sentence 1 was edited
        for seg in segs:
            await s.refresh(seg)
        assert [x.zh for x in segs] == ["一。", None]


async def test_retired_items_are_collected_only_without_copies(app):
    cid = await make_catalog(app)
    uid = await _uid(app)
    async with app.state.sessionmaker() as s:
        item, _ = await catalog_store.add_to_library(s, data_dir_of(app), user_id=uid, catalog_id=cid, now=utcnow())
        row = await catalog_store.get(s, cid)
        row.published, row.retired_at = False, utcnow()
        await s.commit()
        assert await catalog_store.collect_if_orphan(s, data_dir_of(app), cid) is False  # one copy left
        assert media_file(app, cid).is_file()
        await store.delete_item_rows(s, item.id)
        await s.commit()
        assert await catalog_store.collect_retired(s, data_dir_of(app)) == 1
        assert await catalog_store.get(s, cid) is None
        assert await s.scalar(select(func.count()).select_from(CatalogSegment)) == 0
    assert not media_file(app, cid).exists()


async def test_collect_never_touches_live_items(app):
    cid = await make_catalog(app)
    async with app.state.sessionmaker() as s:
        assert await catalog_store.collect_if_orphan(s, data_dir_of(app), cid) is False
    assert media_file(app, cid).is_file()


async def test_purge_deletes_every_copy_then_the_catalog_item(app):
    cid = await make_catalog(app)
    other = await make_catalog(app, title="other")
    a, b = await _uid(app, "a"), await _uid(app, "b")
    async with app.state.sessionmaker() as s:
        ia, _ = await catalog_store.add_to_library(s, data_dir_of(app), user_id=a, catalog_id=cid, now=utcnow())
        await catalog_store.add_to_library(s, data_dir_of(app), user_id=b, catalog_id=cid, now=utcnow())
        keep, _ = await catalog_store.add_to_library(s, data_dir_of(app), user_id=a, catalog_id=other, now=utcnow())
        token = app.state.library.tickets.issue(a, ia.id)
        assert await catalog_store.purge(s, app, cid) == (2, 2)
        assert await s.scalar(select(func.count()).select_from(LibraryItem)) == 1
        assert await s.get(LibraryItem, keep.id) is not None
        assert await catalog_store.get(s, cid) is None
    assert app.state.library.tickets.resolve(token, ia.id) is None
    assert not media_file(app, cid).exists() and media_file(app, other).is_file()
```

- [ ] **Step 2:** 跑 → 失败。
- [ ] **Step 3: 实现**(追加到 `catalog_store.py` 末尾):

```python
# ---- copy-on-add (spec D6, E8) ----

async def _copy_of(session: AsyncSession, user_id: int, catalog_id: str) -> LibraryItem | None:
    return await session.scalar(select(LibraryItem).where(LibraryItem.user_id == user_id,
                                                          LibraryItem.catalog_id == catalog_id))


async def add_to_library(session: AsyncSession, data_dir: Path, *, user_id: int, catalog_id: str,
                         now: datetime) -> tuple[LibraryItem, bool]:
    """(the user's copy, created). A second add returns the existing copy; a racing add loses on the unique index
    and reads the winner back. LookupError when the item is not published / ready / has no media. Commits."""
    existing = await _copy_of(session, user_id, catalog_id)
    if existing is not None:
        return existing, False
    row = await get_published(session, catalog_id)
    if row is None or media_missing(data_dir, row):
        raise LookupError(catalog_id)
    segs = await segments_of(session, row.id)
    item = LibraryItem(id=new_uuid(), user_id=user_id, kind="audio", source="catalog", title=row.title,
                       status="ready", stage=None, progress=100, duration_ms=row.duration_ms,
                       media_path=row.media_path, poster_path=row.poster_path, media_mime=row.media_mime,
                       library_bytes=0, upload_total=0, upload_received=0, sub_source=row.sub_source,
                       seg_count=len(segs), low_confidence=row.low_confidence, rebuildable=False,
                       catalog_id=row.id, created_at=now, updated_at=now)
    session.add(item)
    session.add_all(LibrarySegment(item_id=item.id, idx=s.idx, start_ms=s.start_ms, end_ms=s.end_ms, text=s.text,
                                   zh=s.zh, zh_lang=s.zh_lang, analysis=s.analysis, analysis_lang=s.analysis_lang,
                                   flags=s.flags) for s in segs)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        existing = await _copy_of(session, user_id, catalog_id)
        if existing is None:
            raise
        return existing, False
    logger.info("library catalog added item=%s catalog=%s sentences=%d", item.id, row.id, len(segs))
    return item, True


async def fill_translations(session: AsyncSession, item: LibraryItem, segs: list[LibrarySegment],
                            language: str) -> int:
    """Spec R3: copy the catalog's stored translations onto the user's copy for sentences that have none in
    `language`, only in the catalog's language and only where the user did not edit the text. Commits; returns how
    many were stored. The caller refreshes the rows it holds (expire_on_commit=False; never expire_all, R-SC6)."""
    if not item.catalog_id:
        return 0
    row = await get(session, item.catalog_id)
    if row is None or row.ai_lang != language:
        return 0
    want = {s.idx: s.text for s in segs if not (s.zh and s.zh_lang == language)}
    if not want:
        return 0
    found = [c for c in await segments_of(session, row.id)
             if c.idx in want and c.zh and c.zh_lang == language and store.same_text(c.text, want[c.idx])]
    if not found:
        return 0
    return len(await store.set_translations(session, item.id, [(c.idx, want[c.idx], c.zh) for c in found], language))


# ---- deletion (spec R1) ----

async def delete_rows(session: AsyncSession, catalog_id: str) -> None:
    """Explicit child delete (SQLite has no FK cascade); caller commits, then removes the files."""
    await session.execute(delete(CatalogSegment).where(CatalogSegment.catalog_id == catalog_id))
    await session.execute(delete(CatalogItem).where(CatalogItem.id == catalog_id))


async def collect_if_orphan(session: AsyncSession, data_dir: Path, catalog_id: str) -> bool:
    """A retired catalog item nobody uses any more: rows and files go. Commits."""
    row = await get(session, catalog_id)
    if row is None or row.retired_at is None or await refs(session, catalog_id) > 0:
        return False
    await delete_rows(session, catalog_id)
    await session.commit()
    paths.remove_catalog_files(data_dir, catalog_id)
    logger.info("library catalog collected catalog=%s", catalog_id)
    return True


async def collect_retired(session: AsyncSession, data_dir: Path) -> int:
    ids = list((await session.scalars(select(CatalogItem.id).where(CatalogItem.retired_at.is_not(None)))).all())
    done = 0
    for catalog_id in ids:
        done += await collect_if_orphan(session, data_dir, catalog_id)
    return done


async def purge(session: AsyncSession, app, catalog_id: str) -> tuple[int, int]:
    """Spec R1 forced delete: every user's copy (rows, sentences, attempts; tickets revoked, copy dirs removed), then
    the catalog rows and files. Assessments in the practice history stay. Returns (copies, users). Commits.
    A running import job must be canceled by the caller first (plan SI)."""
    data_dir = app.state.library.deps.data_dir
    copies = [(r[0], r[1]) for r in (await session.execute(select(LibraryItem.id, LibraryItem.user_id).where(
        LibraryItem.catalog_id == catalog_id))).all()]
    for item_id, _user_id in copies:
        await store.delete_item_rows(session, item_id)
    await delete_rows(session, catalog_id)
    await session.commit()
    for item_id, user_id in copies:
        app.state.library.tickets.revoke_item(item_id)
        paths.remove_item_files(data_dir, user_id, item_id)
    paths.remove_catalog_files(data_dir, catalog_id)
    logger.info("library catalog purged catalog=%s copies=%d", catalog_id, len(copies))
    return len(copies), len({u for _i, u in copies})
```

- [ ] **Step 4:** `uv run pytest -q tests/test_library_catalog_store.py tests/test_architecture.py` → 绿。若竞争测试里 SQLite 共享连接让 `s1` 的提交对 `s2` 立即可见(测试用单连接 StaticPool),它仍然测到了「第一次看不到 → `IntegrityError` → 回读」这条路(由 `blind` 打桩保证)。
- [ ] **Step 5: 提交** `feat(server): copy catalog items into a user's library, collect and purge`。

---

## Task 5: 用户接口 `/api/library/catalog*`、`config.catalog`、`main.py` 锚点、后台任务集

**Files:**
- Create: `server/app/routers/library_catalog.py`
- Modify: `server/app/routers/library.py`(`config` 加 `"catalog"`)、`server/app/main.py`、`server/tests/background.py`
- Create: `server/tests/test_library_catalog_api.py`

- [ ] **Step 1: 失败测试** `server/tests/test_library_catalog_api.py`:

```python
"""用户侧精选库接口(spec 2026-10-14-curated-library §9;INDEX §6)。"""
import pytest

from tests.catalog_helpers import POSTER, make_catalog
from tests.library_helpers import enable, library_settings
from tests.test_admin_api import register


@pytest.fixture
def settings_overrides(tmp_path):
    return library_settings(tmp_path, library_catalog_enabled=True)


async def test_config_reports_the_catalog_switch(app, client, auth_headers, monkeypatch):
    enable(monkeypatch)
    assert (await client.get("/api/library/config", headers=auth_headers)).json()["catalog"] is True
    app.state.settings = app.state.settings.model_copy(update={"library_catalog_enabled": False})
    assert (await client.get("/api/library/config", headers=auth_headers)).json()["catalog"] is False


async def test_list_add_twice_and_poster(app, client, auth_headers):
    cid = await make_catalog(app)
    r = await client.get("/api/library/catalog", headers=auth_headers)
    assert r.status_code == 200
    (card,) = r.json()["items"]
    assert card["id"] == cid and card["added_item_id"] is None and card["tags"] == ["news", "science"]
    first = await client.post(f"/api/library/catalog/{cid}/add", headers=auth_headers)
    assert first.status_code == 200 and first.json()["created"] is True
    item = first.json()["item"]
    assert (item["source"], item["catalog_id"], item["library_bytes"], item["status"]) == ("catalog", cid, 0, "ready")
    second = await client.post(f"/api/library/catalog/{cid}/add", headers=auth_headers)
    assert second.json() == {"item": second.json()["item"], "created": False}
    assert second.json()["item"]["id"] == item["id"]
    assert (await client.get("/api/library/catalog", headers=auth_headers)).json()["items"][0]["added_item_id"] == item["id"]
    poster = await client.get(f"/api/library/catalog/{cid}/poster", headers=auth_headers)
    assert poster.status_code == 200 and poster.content == POSTER and poster.headers["content-type"] == "image/jpeg"
    detail = (await client.get(f"/api/library/items/{item['id']}", headers=auth_headers)).json()
    assert [s["zh"] for s in detail["segments"]] == ["你好,我的朋友。", "你今天好吗?"]


async def test_each_user_gets_their_own_copy(app, client):
    cid = await make_catalog(app)
    _a, ha = await register(client, "anna")
    _b, hb = await register(client, "ben")
    ia = (await client.post(f"/api/library/catalog/{cid}/add", headers=ha)).json()["item"]["id"]
    ib = (await client.post(f"/api/library/catalog/{cid}/add", headers=hb)).json()["item"]["id"]
    assert ia != ib
    assert (await client.get(f"/api/library/items/{ia}", headers=hb)).status_code == 404


async def test_switches_and_unknown_items(app, client, auth_headers):
    cid = await make_catalog(app)
    draft = await make_catalog(app, published=False)
    assert (await client.post(f"/api/library/catalog/{draft}/add", headers=auth_headers)).json() == {
        "error": "Built-in item not found"}
    assert (await client.get(f"/api/library/catalog/{draft}/poster", headers=auth_headers)).status_code == 404
    assert (await client.post("/api/library/catalog/nope/add", headers=auth_headers)).status_code == 404
    assert (await client.get("/api/library/catalog")).status_code == 401
    app.state.settings = app.state.settings.model_copy(update={"library_catalog_enabled": False})
    r = await client.get("/api/library/catalog", headers=auth_headers)
    assert (r.status_code, r.json()) == (404, {"error": "Built-in library is disabled"})
    assert (await client.post(f"/api/library/catalog/{cid}/add", headers=auth_headers)).status_code == 404
    app.state.settings = app.state.settings.model_copy(update={"library_enabled": False})
    assert (await client.get("/api/library/catalog", headers=auth_headers)).json() == {"error": "Library is disabled"}


async def test_copies_keep_working_when_the_catalog_switch_is_off(app, client, auth_headers):
    cid = await make_catalog(app)
    item = (await client.post(f"/api/library/catalog/{cid}/add", headers=auth_headers)).json()["item"]
    app.state.settings = app.state.settings.model_copy(update={"library_catalog_enabled": False})
    assert (await client.get(f"/api/library/items/{item['id']}", headers=auth_headers)).status_code == 200


async def test_add_is_free_of_the_daily_import_counter_and_item_cap(app, client, auth_headers):
    app.state.settings = app.state.settings.model_copy(update={"library_imports_daily_per_user": 0,
                                                               "library_max_items": 1})
    for _ in range(2):
        cid = await make_catalog(app)
        assert (await client.post(f"/api/library/catalog/{cid}/add", headers=auth_headers)).status_code == 200
```

- [ ] **Step 2:** 跑 `uv run pytest -q tests/test_library_catalog_api.py` → 失败(404 / 无路由)。
- [ ] **Step 3: 路由** `server/app/routers/library_catalog.py`:

```python
"""精选库的用户接口 `/api/library/catalog*`(spec 2026-10-14-curated-library §9)。

先鉴权,再 `library_enabled`(404 Library is disabled),再 `library_catalog_enabled`(404 Built-in library is
disabled)。URL 里只有 uuid;日志只有 id。业务在 `app/library/catalog_store.py`。"""
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Path as PathParam, Request
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.deps import current_user, get_session, get_settings, limited_user
from app.library import catalog_store, paths, store
from app.library.errors import api_error
from app.models import User, utcnow

router = APIRouter(prefix="/api/library/catalog")
logger = logging.getLogger(__name__)

NO_STORE = {"Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff"}
CatalogId = Annotated[str, PathParam(max_length=36)]


def require_catalog(_: User = Depends(current_user), settings: Settings = Depends(get_settings)) -> Settings:
    if not settings.library_enabled:
        raise api_error("disabled")
    if not settings.library_catalog_enabled:
        raise api_error("catalog_disabled")
    return settings


@router.get("")
async def list_catalog(user: User = Depends(current_user), _: Settings = Depends(require_catalog),
                       session: AsyncSession = Depends(get_session)):
    rows = await catalog_store.list_published(session, user.id)
    return {"items": [catalog_store.public_out(row, added) for row, added in rows]}


@router.post("/{catalog_id}/add")
async def add_catalog_item(request: Request, catalog_id: CatalogId, user: User = Depends(limited_user),
                           settings: Settings = Depends(require_catalog),
                           session: AsyncSession = Depends(get_session)):
    """Spec D6 / E8: copy into the user's library (idempotent). No quota, no daily import count (E7)."""
    try:
        item, created = await catalog_store.add_to_library(session, settings.resolved_data_dir, user_id=user.id,
                                                           catalog_id=catalog_id, now=utcnow())
    except LookupError:
        raise api_error("catalog_not_found") from None
    return {"item": store.item_out(item), "created": created}


@router.get("/{catalog_id}/poster")
async def catalog_poster(catalog_id: CatalogId, _user: User = Depends(current_user),
                         settings: Settings = Depends(require_catalog), session: AsyncSession = Depends(get_session)):
    row = await catalog_store.get_published(session, catalog_id)
    if row is None or not row.poster_path:
        raise api_error("catalog_not_found")
    try:
        path = paths.absolute(settings.resolved_data_dir, row.poster_path)
    except ValueError:
        raise api_error("catalog_not_found") from None
    if not path.is_file():
        raise api_error("catalog_not_found")
    return FileResponse(path, media_type="image/jpeg", headers=NO_STORE)
```

- [ ] **Step 4: `routers/library.py::config`** 在 `"ai": …` 之后加:
  `"catalog": enabled and settings.library_catalog_enabled,  # spec 2026-10-14-curated-library E12`。
- [ ] **Step 5: `main.py`。** 路由导入元组按字母序加 `library_catalog`;路由注册元组里 `library_import,` 之后加
  `library_catalog,  # /api/library/catalog* (spec 2026-10-14-curated-library §9); before stubs`;并放 INDEX §8 的三处锚点注释(原文):
  - `library_import.install(app)` 之后:
    `# --- anchor for plan SI (2026-10-14-curated-library-server-import): install_catalog(app) goes on the next line ---`
  - lifespan 里 `tasks["library"] = …` 之后:
    `# --- anchor for plan SI (2026-10-14-curated-library-server-import): await app_.state.catalog.recover() goes on the next line ---`;
    `await app_.state.library.shutdown()` 之前:
    `# --- anchor for plan SI (2026-10-14-curated-library-server-import): await app_.state.catalog.shutdown() goes on the next line ---`
  - 路由元组 `admin_library,` 之后:
    `# --- anchor for plan SI (2026-10-14-curated-library-server-import): admin_catalog, goes on the next line (before stubs) ---`
- [ ] **Step 6: `tests/background.py::_task_sets`** 在 `library` 一段之后加:

```python
    catalog = getattr(state, "catalog", None)
    if catalog is not None:  # curated catalog import jobs (plan 2026-10-14-curated-library SI); no poll loop exists
        out.append(catalog.pending)
```

- [ ] **Step 7:** `uv run pytest -q tests/test_library_catalog_api.py tests/test_library_api.py tests/test_architecture.py` → 绿。
- [ ] **Step 8: 提交** `feat(server): user catalog endpoints (list, add, poster) and config.catalog`。

---

## Task 6: 副本的保护、配额与共享媒体的回归测试

**Files:**
- Modify: `server/app/routers/library.py`(`reprocess_item`、`put_item_subtitles`、`delete_item`)、`server/app/library/limits.py`(`item_count`)、`server/app/library/worker.py`(`sweep` 末尾)
- Create: `server/tests/test_library_catalog_media.py`

- [ ] **Step 1: 失败测试** `server/tests/test_library_catalog_media.py`:

```python
"""副本与共享文件(spec 2026-10-14-curated-library E7、E9、R1;§2 核对表的删除范围)。"""
import pytest
from sqlalchemy import select

from app.library import catalog_store, limits, paths
from app.models import LibraryItem, utcnow
from tests.admin_helpers import ADMIN_ENABLED, PASSWORD, login_as
from tests.catalog_helpers import MEDIA, POSTER, data_dir_of, make_catalog, media_file
from tests.library_helpers import SRT, enable, fake_media, library_settings, process, upload, use_fakes
from tests.test_admin_api import register


@pytest.fixture
def settings_overrides(tmp_path):
    return {**ADMIN_ENABLED, **library_settings(tmp_path, library_catalog_enabled=True)}


async def _add(client, headers, cid) -> str:
    r = await client.post(f"/api/library/catalog/{cid}/add", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["item"]["id"]


async def test_ticket_and_range_work_on_the_shared_file(app, client):
    cid = await make_catalog(app)
    _uid, h = await register(client, "anna")
    item = await _add(client, h, cid)
    url = (await client.post(f"/api/library/items/{item}/media-ticket", headers=h)).json()["url"]
    full = await client.get(url)
    assert full.status_code == 200 and full.content == MEDIA and full.headers["content-type"] == "audio/mp4"
    part = await client.get(url, headers={"Range": "bytes=100-199"})
    assert part.status_code == 206 and part.content == MEDIA[100:200]
    assert (await client.get(f"/api/library/items/{item}/poster", headers=h)).content == POSTER
    _other, h2 = await register(client, "ben")
    assert (await client.post(f"/api/library/items/{item}/media-ticket", headers=h2)).status_code == 404


async def test_deleting_a_copy_never_deletes_the_shared_file(app, client):
    cid = await make_catalog(app)
    _a, ha = await register(client, "anna")
    _b, hb = await register(client, "ben")
    ia, ib = await _add(client, ha, cid), await _add(client, hb, cid)
    assert (await client.delete(f"/api/library/items/{ia}", headers=ha)).status_code == 200
    assert media_file(app, cid).read_bytes() == MEDIA
    url = (await client.post(f"/api/library/items/{ib}/media-ticket", headers=hb)).json()["url"]
    assert (await client.get(url)).status_code == 200


async def test_deleting_a_user_keeps_the_shared_file(app, client):
    cid = await make_catalog(app)
    uid, h = await register(client, "dora")
    await _add(client, h, cid)
    admin = await login_as(app, client, "superadmin")
    await client.post("/api/admin/step-up", headers=admin, json={"password": PASSWORD})
    r = await client.request("DELETE", f"/api/admin/users/{uid}", headers=admin,
                             json={"confirm_username": "dora", "reason": "用户要求注销"})
    assert r.status_code == 200, r.text
    assert media_file(app, cid).is_file()


async def test_copies_use_no_quota_and_do_not_count_as_items(app, client, monkeypatch):
    enable(monkeypatch)
    uid, h = await register(client, "anna")
    before = (await client.get("/api/library/config", headers=h)).json()["limits"]["used_bytes"]
    for _ in range(3):
        await _add(client, h, await make_catalog(app))
    assert (await client.get("/api/library/config", headers=h)).json()["limits"]["used_bytes"] == before == 0
    async with app.state.sessionmaker() as s:
        assert await limits.item_count(s, uid) == 0


async def test_copies_cannot_be_reprocessed_or_get_new_subtitles(app, client):
    cid = await make_catalog(app)
    async with app.state.sessionmaker() as s:
        row = await catalog_store.get(s, cid)
        row.sub_source = "asr"
        await s.commit()
    _uid, h = await register(client, "anna")
    item = await _add(client, h, cid)
    locked = {"error": "Built-in items cannot be changed this way"}
    r = await client.post(f"/api/library/items/{item}/reprocess", headers=h)
    assert (r.status_code, r.json()) == (409, locked)
    r = await client.put(f"/api/library/items/{item}/subtitles", headers=h,
                         files={"file": ("t.srt", SRT, "application/x-subrip")})
    assert (r.status_code, r.json()) == (409, locked)
    assert (await client.post(f"/api/library/items/{item}/rebuild", headers=h)).json() == {
        "error": "Item cannot be rebuilt"}
    # the copy is still the user's own: title and sentence edits work
    assert (await client.patch(f"/api/library/items/{item}", headers=h, json={"title": "Mine"})).status_code == 200
    assert (await client.patch(f"/api/library/items/{item}/segments/0", headers=h,
                               json={"text": "Hello there, friend."})).status_code == 200
    assert media_file(app, cid).is_file()


async def test_deleting_the_last_copy_of_a_retired_item_collects_it(app, client):
    cid = await make_catalog(app)
    _uid, h = await register(client, "anna")
    item = await _add(client, h, cid)
    async with app.state.sessionmaker() as s:
        row = await catalog_store.get(s, cid)
        row.published, row.retired_at = False, utcnow()
        await s.commit()
    url = (await client.post(f"/api/library/items/{item}/media-ticket", headers=h)).json()["url"]
    assert (await client.get(url)).status_code == 200  # a retired item keeps working for its copies
    await client.delete(f"/api/library/items/{item}", headers=h)
    assert not media_file(app, cid).exists()
    async with app.state.sessionmaker() as s:
        assert await catalog_store.get(s, cid) is None


async def test_the_daily_sweep_collects_retired_items_without_copies(app):
    cid = await make_catalog(app, retired=True)
    counts = await app.state.library.sweep(utcnow())
    assert counts == {"expired": 0, "purged": 0, "orphans": 0}  # the sweep's own numbers are unchanged (R-SC7)
    assert not media_file(app, cid).exists()


async def test_user_uploads_still_count_and_delete_their_own_dirs(app, client, monkeypatch):
    enable(monkeypatch)
    use_fakes(app)
    uid, h = await register(client, "anna")
    mine = await upload(client, h, fake_media(), subs=SRT)
    await process(app)
    async with app.state.sessionmaker() as s:
        assert await limits.item_count(s, uid) == 1
    await client.delete(f"/api/library/items/{mine}", headers=h)
    assert not paths.item_dir(data_dir_of(app), uid, mine).exists()
```

- [ ] **Step 2:** 跑 → 失败(409 没有、`item_count` 计入副本、清扫不回收)。
- [ ] **Step 3: 实现。**
  - `limits.item_count`:where 条件加 `LibraryItem.source != "catalog"`,文档字符串补一句「精选副本不计(spec 2026-10-14-curated-library E7)」。
  - `routers/library.py`:`reprocess_item` 与 `put_item_subtitles` 里 `item = await owned(...)` 之后第一行:
    `if item.source == "catalog": raise fail("catalog_locked")  # spec 2026-10-14-curated-library E9`。
  - `routers/library.py::delete_item`:

```python
@router.delete("/items/{item_id}")
async def delete_item(request: Request, item_id: ItemId, user: User = Depends(current_user),
                      settings: Settings = Depends(require_library), session: AsyncSession = Depends(get_session)):
    item = await owned(session, user, item_id)
    catalog_id = item.catalog_id
    await store.delete_item(session, request.app, item)
    if catalog_id:  # spec 2026-10-14-curated-library R1: the last copy of a retired catalog item lets it go
        await catalog_store.collect_if_orphan(session, settings.resolved_data_dir, catalog_id)
    logger.info("library item deleted item=%s", item_id)
    return {"deleted": True}
```

    (文件顶部 `from app.library import …` 加 `catalog_store`。)
  - `worker.py::sweep`:在 `counts = {...}` 之前插入(返回的字典与日志行**不变**):

```python
        try:  # spec 2026-10-14-curated-library R1: retired catalog items nobody uses any more
            async with self.deps.sessionmaker() as s:
                collected = await catalog_store.collect_retired(s, data_dir)
            if collected:
                logger.info("library sweep catalog collected=%d", collected)
        except Exception as e:  # noqa: BLE001 - the user library's sweep must not fail because of the catalog
            logger.warning("library sweep catalog failed error=%s", type(e).__name__)
```

    (顶部 `from app.library import catalog_store, limits, paths, pipeline, store`。)
- [ ] **Step 4:** `uv run pytest -q tests/test_library_catalog_media.py tests/test_library_worker.py tests/test_library_api.py tests/test_library_reprocess.py tests/test_library_delete_user.py tests/test_architecture.py` → 绿。
- [ ] **Step 5: 提交** `feat(server): guard catalog copies, keep shared files, collect retired items`。

---

## Task 7: 副本的译文补全与共享分析(`ai.py`)(强模型)

**Files:**
- Modify: `server/app/library/ai.py`、`server/app/routers/library.py`(`translate_segments`、`analyze_segment`)
- Create: `server/tests/test_library_catalog_ai.py`

- [ ] **Step 1: 失败测试** `server/tests/test_library_catalog_ai.py`:

```python
"""副本的译文与分析的计费(spec 2026-10-14-curated-library R3、§8;INDEX §7 ai.*)。"""
import httpx
import pytest
import respx
from sqlalchemy import select

from app.core import metering
from app.library import ai, catalog_store, limits
from app.models import DailyUsage
from tests.catalog_helpers import make_catalog
from tests.library_helpers import library_settings
from tests.test_admin_api import register

LLM = "https://llm.test/v1/chat/completions"


@pytest.fixture
def settings_overrides(tmp_path):
    return library_settings(tmp_path, library_catalog_enabled=True, library_ai_enabled=True)


def reply(text: str):
    return httpx.Response(200, json={"choices": [{"message": {"content": text}}]})


async def _counts(app) -> dict[tuple[str, str], int]:
    async with app.state.sessionmaker() as s:
        rows = (await s.scalars(select(DailyUsage))).all()
        return {(r.scope, r.subject): r.count for r in rows}


async def _copy(client, cid):
    uid, h = await register(client, "anna")
    item = (await client.post(f"/api/library/catalog/{cid}/add", headers=h)).json()["item"]["id"]
    return uid, h, item


@respx.mock
async def test_shared_analysis_is_generated_once_for_everyone_and_charges_no_user(app, client, monkeypatch):
    seen_users = []
    real_record = metering.record

    def spy(*a, **kw):
        seen_users.append((metering.current_user_id(), metering.current_feature()))
        return real_record(*a, **kw)

    monkeypatch.setattr(metering, "record", spy)
    route = respx.post(LLM).mock(return_value=reply("### 句子结构\n问候。"))
    cid = await make_catalog(app)
    _uid, h, item = await _copy(client, cid)
    r = await client.post(f"/api/library/items/{item}/segments/0/analysis", headers=h, json={"native_language": "zh-CN"})
    assert r.status_code == 200 and r.json() == {"analysis": "### 句子结构\n问候。", "cached": False}
    _b, hb = await register(client, "ben")
    other = (await client.post(f"/api/library/catalog/{cid}/add", headers=hb)).json()["item"]["id"]
    r = await client.post(f"/api/library/items/{other}/segments/0/analysis", headers=hb,
                          json={"native_language": "zh-CN"})
    assert r.json()["cached"] is True and route.call_count == 1
    counts = await _counts(app)
    assert counts.get((limits.SCOPE_CATALOG_AI, limits.GLOBAL)) == 1
    assert not any(scope in (limits.SCOPE_ANALYSIS, limits.SCOPE_AI_GLOBAL) for scope, _s in counts)
    assert (None, ai.FEATURE_CAT_ANALYSIS) in seen_users
    async with app.state.sessionmaker() as s:
        assert (await catalog_store.segment_at(s, cid, 0)).analysis.startswith("### 句子结构")
    detail = (await client.get(f"/api/library/items/{item}", headers=h)).json()
    assert detail["segments"][0]["has_analysis"] is True  # also stored on the user's own row


@respx.mock
async def test_other_languages_and_edited_sentences_use_the_users_own_allowance(app, client):
    respx.post(LLM).mock(side_effect=[reply("### ja"), reply("### edited")])
    cid = await make_catalog(app)
    uid, h, item = await _copy(client, cid)
    r = await client.post(f"/api/library/items/{item}/segments/0/analysis", headers=h, json={"native_language": "ja-JP"})
    assert r.status_code == 200
    await client.patch(f"/api/library/items/{item}/segments/1", headers=h, json={"text": "How are you doing, pal?"})
    r = await client.post(f"/api/library/items/{item}/segments/1/analysis", headers=h, json={"native_language": "zh-CN"})
    assert r.status_code == 200
    counts = await _counts(app)
    assert counts[(limits.SCOPE_ANALYSIS, str(uid))] == 2
    assert counts.get((limits.SCOPE_CATALOG_AI, limits.GLOBAL)) is None


@respx.mock
async def test_the_system_cap_stops_shared_analyses_with_the_existing_429(app, client):
    respx.post(LLM).mock(return_value=reply("### x"))
    app.state.settings = app.state.settings.model_copy(update={"library_catalog_ai_daily": 0})
    cid = await make_catalog(app)
    _uid, h, item = await _copy(client, cid)
    r = await client.post(f"/api/library/items/{item}/segments/0/analysis", headers=h, json={"native_language": "zh-CN"})
    assert (r.status_code, r.json()) == (429, {"error": "Daily AI limit reached"})


@respx.mock
async def test_a_failed_shared_analysis_gives_the_system_count_back(app, client):
    respx.post(LLM).mock(return_value=httpx.Response(502, json={"error": "boom"}))
    cid = await make_catalog(app)
    _uid, h, item = await _copy(client, cid)
    r = await client.post(f"/api/library/items/{item}/segments/0/analysis", headers=h, json={"native_language": "zh-CN"})
    assert r.status_code == 503
    assert (await _counts(app)).get((limits.SCOPE_CATALOG_AI, limits.GLOBAL), 0) == 0


@respx.mock
async def test_translate_fills_from_the_catalog_before_spending(app, client):
    route = respx.post(LLM).mock(return_value=reply("1. 你好吗"))
    cid = await make_catalog(app, segments=[(0, 1000, "One.", None), (1000, 2000, "Two.", None)])
    uid, h, item = await _copy(client, cid)
    async with app.state.sessionmaker() as s:  # the admin translated after the user added the item
        await catalog_store.set_translations(s, cid, [(0, "One.", "一。"), (1, "Two.", "二。")], "zh-CN")
    r = await client.post(f"/api/library/items/{item}/translate", headers=h,
                          json={"indices": [0, 1], "native_language": "zh-CN"})
    assert r.json() == {"segments": [{"idx": 0, "zh": "一。"}, {"idx": 1, "zh": "二。"}], "limited": False}
    assert route.call_count == 0 and (limits.SCOPE_TRANSLATE, str(uid)) not in await _counts(app)


@respx.mock
async def test_translate_texts_needs_no_allowance(app):
    respx.post(LLM).mock(return_value=reply("1. 一\n2. 二"))
    out = await ai.translate_texts(app.state.http, app.state.settings, template=None, language="zh-CN",
                                   texts=["One.", "Two."])
    assert out == {0: "一", 1: "二"}
    assert await _counts(app) == {}
    respx.post(LLM).mock(return_value=reply("no numbers here"))
    with pytest.raises(ai.AiUnavailable):
        await ai.translate_texts(app.state.http, app.state.settings, template=None, language="zh-CN", texts=["One."])
```

- [ ] **Step 2:** 跑 → 失败。
- [ ] **Step 3: `ai.py` 追加**(模块文档字符串补一段「精选库:`translate_texts`(导入时,不计额度)与 `analyze_catalog`(共享缓存,系统计费)」;顶部 `import asyncio`、`import weakref`,`from app.library import catalog_store, limits, store`):

```python
# ---- curated catalog (spec 2026-10-14-curated-library R3, R4) ----
FEATURE_CAT_TRANSLATE, FEATURE_CAT_ANALYSIS = "cat_translate", "cat_analysis"
_CATALOG_LOCKS: "weakref.WeakValueDictionary[tuple[str, int], asyncio.Lock]" = weakref.WeakValueDictionary()


async def translate_texts(http, settings, *, template: str | None, language: str,
                          texts: list[str]) -> dict[int, str]:
    """One batch (<= 20) for the catalog import: {0-based index: translation}. No allowance (the admin's import pays,
    metered under the caller's scope). AiUnavailable("upstream") when the model gave nothing usable."""
    if not texts:
        return {}
    max_tokens = min(TRANSLATE_TOKENS_CAP, TRANSLATE_TOKENS_BASE + TRANSLATE_TOKENS_PER_SENTENCE * len(texts))
    try:
        raw = await llm.complete(http, settings, render_translate(template, language, texts),
                                 model=settings.default_llm_model, max_tokens=max_tokens,
                                 temperature=TRANSLATE_TEMPERATURE)
    except llm.LlmUnavailable as e:
        logger.warning("library catalog translate unavailable kind=%s count=%d", e.kind, len(texts))
        raise AiUnavailable("upstream") from None
    parsed = parse_translations(raw, len(texts))
    if not parsed:
        logger.warning("library catalog translate empty count=%d", len(texts))
        raise AiUnavailable("upstream")
    return {n - 1: zh for n, zh in parsed.items()}


async def analyze_catalog(session, http, settings, *, catalog_id: str, idx: int, text: str, language: str,
                          template: str | None, now: datetime) -> tuple[str, bool]:
    """(analysis, cached) for a catalog sentence in its catalog language. Generated once, shared by every copy,
    paid by the system: the site-wide `library_cat_ai` count (AiUnavailable("global_cap") when full), upstream metered
    with no user (`metering.system_scope`). A per-sentence lock makes concurrent first requests pay once."""
    key = (catalog_id, idx)
    lock = _CATALOG_LOCKS.get(key)
    if lock is None:
        lock = _CATALOG_LOCKS[key] = asyncio.Lock()
    async with lock:
        seg = await catalog_store.segment_at(session, catalog_id, idx)  # populate_existing: sees a concurrent writer
        if seg is None or not store.same_text(seg.text, text):
            raise AiUnavailable("upstream")  # the caller checked; a concurrent admin edit lands here
        if seg.analysis and seg.analysis_lang == language:
            return seg.analysis, True
        day = limits.day_of(now)
        if not await limits.reserve(session, limits.SCOPE_CATALOG_AI, limits.GLOBAL, day, 1,
                                    settings.library_catalog_ai_daily):
            raise AiUnavailable("global_cap")
        try:
            with metering.system_scope(), metering.feature_scope(FEATURE_CAT_ANALYSIS):
                raw = await llm.complete(http, settings, render_analysis(template, language, seg.text),
                                         model=settings.default_llm_model, max_tokens=ANALYZE_MAX_TOKENS,
                                         temperature=ANALYZE_TEMPERATURE)
        except llm.LlmUnavailable as e:
            await limits.release(session, limits.SCOPE_CATALOG_AI, limits.GLOBAL, day, 1)
            logger.warning("library catalog analysis unavailable catalog=%s kind=%s", catalog_id, e.kind)
            raise AiUnavailable("upstream") from None
        body = raw.strip()[:limits.ANALYSIS_MAX]
        await catalog_store.set_analysis(session, catalog_id, idx, seg.text, body, language)
        return body, False
```

  `ai.py` 已经导入了 `catalog_store`,而 `catalog_store` 不导入 `ai`,没有环。
- [ ] **Step 4: 路由 `translate_segments`**:在 `segs = await store.segments_at(...)` 之后插入:

```python
    if item.catalog_id:  # spec 2026-10-14-curated-library R3: the catalog's stored translations are free
        if await catalog_store.fill_translations(session, item, segs, language):
            for seg in segs:  # expire_on_commit=False: re-read the rows the UPDATEs changed (R-SC6)
                await session.refresh(seg)
```

  **路由 `analyze_segment`**:在 `_, template = await prompt_cache(...)` 之后、`try:` 之前插入:

```python
    seg = segs[0]
    if item.catalog_id and not (seg.analysis and seg.analysis_lang == language):  # R-SC5: shared, system-paid
        cat = await catalog_store.get(session, item.catalog_id)
        shared = await catalog_store.segment_at(session, item.catalog_id, idx) if cat is not None else None
        if cat is not None and shared is not None and language == cat.ai_lang and store.same_text(shared.text, seg.text):
            user_text = seg.text
            try:
                text, cached = await library_ai.analyze_catalog(
                    session, request.app.state.http, settings, catalog_id=cat.id, idx=idx, text=user_text,
                    language=language, template=template, now=utcnow())
            except library_ai.AiUnavailable as e:
                raise fail({"global_cap": "ai_global_cap"}.get(e.kind, "ai_unavailable")) from None
            await store.set_analysis(session, item.id, idx, user_text, text, language)
            return {"analysis": text, "cached": cached}
```

- [ ] **Step 5:** `uv run pytest -q tests/test_library_catalog_ai.py tests/test_library_ai.py tests/test_library_ai_api.py tests/test_architecture.py` → 绿。
- [ ] **Step 6: 提交** `feat(server): shared, system-paid analyses and free translations for catalog copies`。

---

## Task 8: 隐私、契约夹具(只手工加键)、网页契约同步(誊写为主)

**Files:**
- Modify: `server/tests/test_library_privacy.py`、`server/tests/test_library_contract.py`、`server/tests/fixtures/library_contract.json`
- Modify(网页,只做同步):`web/src/features/library/library-api.ts`、`config.ts`、`library-contract.test.ts`、`locales/en.json`、`locales/zh-CN.json`

- [ ] **Step 1: 隐私测试。** `ROUTES` 加
  `("GET", "/api/library/catalog"), ("POST", "/api/library/catalog/{catalog_id}/add"), ("GET", "/api/library/catalog/{catalog_id}/poster")`;
  `ALLOWED_PATH = {"item_id", "n", "idx", "catalog_id"}`。`settings_overrides` 加 `library_catalog_enabled=True`。追加用例:

```python
@respx.mock
async def test_catalog_paths_never_log_titles_licenses_or_sentences(app, client, auth_headers, caplog, monkeypatch):
    from tests.catalog_helpers import make_catalog
    caplog.set_level(logging.DEBUG, logger="app")
    enable(monkeypatch)
    cid = await make_catalog(app, title="SECRET-TITLE", segments=[(0, 1000, "SECRET-SUBTITLE one.", "SECRET-TRANSLATION")])
    respx.post(LLM).mock(side_effect=[httpx.Response(200, json={"choices": [{"message": {"content": "SECRET-ANALYSIS"}}]}),
                                      httpx.Response(502, json={"error": "SECRET-UPSTREAM"})])
    await client.get("/api/library/catalog", headers=auth_headers)
    item = (await client.post(f"/api/library/catalog/{cid}/add", headers=auth_headers)).json()["item"]["id"]
    await client.post(f"/api/library/catalog/{cid}/add", headers=auth_headers)
    await client.get(f"/api/library/catalog/{cid}/poster", headers=auth_headers)
    zh = {"native_language": "zh-CN"}
    assert (await client.post(f"/api/library/items/{item}/segments/0/analysis", headers=auth_headers, json=zh)).status_code == 200
    await client.post(f"/api/library/items/{item}/translate", headers=auth_headers, json={"indices": [0], **zh})
    await client.delete(f"/api/library/items/{item}", headers=auth_headers)
    assert any("catalog" in r.getMessage() for r in caplog.records)  # the scan saw the catalog's own lines
    assert leaked(caplog) == []
```

- [ ] **Step 2: 契约测试**(`test_library_contract.py`):`settings_overrides` 加 `library_catalog_enabled=True`;在 `out["delete"] = …` 之前追加:

```python
    from tests.catalog_helpers import make_catalog
    cid = await make_catalog(app)
    out["catalog_list"] = (await client.get("/api/library/catalog", headers=h)).json()
    out["catalog_add"] = (await client.post(f"/api/library/catalog/{cid}/add", headers=h)).json()
    out["catalog_add_again"] = (await client.post(f"/api/library/catalog/{cid}/add", headers=h)).json()
    out["catalog_locked"] = (await client.post(f"/api/library/items/{out['catalog_add']['item']['id']}/reprocess",
                                               headers=h)).json()
    assert out["catalog_add"]["created"] is True and out["catalog_add_again"]["created"] is False
    assert out["catalog_locked"] == {"error": "Built-in items cannot be changed this way"}
```

- [ ] **Step 3: 手工加键(不重录)。** 在一次性脚本里(放 scratchpad,**不提交**)只插入新键,然后人工 `git diff` 核对除新增键外没有任何改动:

```python
# scratch/add_catalog_keys.py  —  run from server/: uv run python -I <scratchpad>/add_catalog_keys.py
import json, pathlib
p = pathlib.Path("tests/fixtures/library_contract.json")
d = json.loads(p.read_text(encoding="utf-8"))

def walk(v):
    if isinstance(v, dict):
        if "has_poster" in v and "rebuildable" in v and "catalog_id" not in v:  # an item_out shape
            v["catalog_id"] = None
        for x in v.values():
            walk(x)
    elif isinstance(v, list):
        for x in v:
            walk(x)

walk(d)
d["config"]["catalog"] = True
d["errors"].update({"catalog_disabled": "Built-in library is disabled", "catalog_not_found": "Built-in item not found",
                    "catalog_locked": "Built-in items cannot be changed this way"})
item = dict(d["items"]["items"][0], source="catalog", kind="audio", catalog_id="00000000-0000-4000-8000-000000000000",
            library_bytes=0, rebuildable=False, low_confidence=False, sub_source="uploaded", status="ready",
            stage=None, progress=100, error_kind=None)
d["catalog_list"] = {"items": [{"id": "00000000-0000-4000-8000-000000000000", "title": "Catalog talk", "level": "B1",
                                "tags": ["news", "science"], "license_note": "VOA Learning English · Public domain",
                                "duration_ms": 6000, "seg_count": 2, "has_poster": True,
                                "published_at": "2026-01-01T00:00:00Z", "added_item_id": None}]}
d["catalog_add"] = {"item": item, "created": True}
d["catalog_add_again"] = {"item": item, "created": False}
d["catalog_locked"] = {"error": "Built-in items cannot be changed this way"}
p.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
```

  键的位置不影响形状比较(`shape` 对键排序);若 `git diff` 显示重排了原有内容,改为在编辑器里逐处手加。
- [ ] **Step 4:** `uv run pytest -q tests/test_library_privacy.py tests/test_library_contract.py tests/test_architecture.py` → 绿。
- [ ] **Step 5: 网页同步(只为了让现有网页测试保持绿;界面是车道 W 的事)。**
  - `library-api.ts`:`export type LibrarySource = "upload" | "link" | "catalog";`;`LibraryItem` 在 `hasPoster` 之后加
    `/** 精选副本:来源目录条目 id(spec 2026-10-14-curated-library E1);普通条目为 null。可选:旧夹具与测试数据可以不带。 */ catalogId?: string | null;`;
    `LIBRARY_SERVER_ERRORS` 加三行:
    `"Built-in library is disabled": "web.library.errors.catalogDisabled",`、`"Built-in item not found": "web.library.errors.catalogNotFound",`、
    `"Built-in items cannot be changed this way": "web.library.errors.catalogLocked",`。
  - `config.ts`(主包模块,只改这三处):`LibraryConfig` 加 `/** 精选库对用户可见(spec 2026-10-14-curated-library E12) */ catalog: boolean;`;
    `LIBRARY_DISABLED` 加 `catalog: false`;`fetchLibraryConfig` 的返回对象加 `catalog: c.catalog === true`。若 `config.test.tsx` 对整个对象 `toEqual`,同步补键。
  - `library-contract.test.ts`:`CONFIG` 加 `catalog: true`;`ITEM` 加 `catalogId: true`。
  - `locales/zh-CN.json` / `en.json` 的 `web.library.errors` 下加三键:
    `catalogDisabled`:「精选库暂未开放」/ "Built-in library is not available";`catalogNotFound`:「这条精选素材已下架」/ "This built-in item is no longer available";
    `catalogLocked`:「精选素材不能这样修改」/ "Built-in items can't be changed this way"。
  - `cd web && yarn vitest run src/features/library/library-contract.test.ts src/features/library/locales.test.ts src/features/library/config.test.tsx` → 绿;`yarn web:typecheck`(根目录)→ 绿。
- [ ] **Step 6: 提交** `test(server): catalog privacy and contract keys; web contract sync`。

---

## Task 9: 文档(誊写)

**Files:** `server/app/library/CLAUDE.md`、`server/app/CLAUDE.md`、`server/app/routers/CLAUDE.md`、`server/README.md`

- [ ] **Step 1: `app/library/CLAUDE.md`**「What lives here」追加(含车道 SI 的模块,名字按 INDEX 冻结):

```markdown
- `catalog_store.py` – 精选库(spec `2026-10-14-curated-library-design.md`):系统所有的 `catalog_items` / `catalog_segments`、
  输出形状(`public_out` / `admin_out`)、导入队列(`claim_next` / `fail` / `recover`)、**添加即复制** `add_to_library`(幂等,
  唯一索引 `(user_id, catalog_id)`)、`fill_translations`、引用数 `refs`(查询算,不存计数)、退役回收 `collect_*`、强制删除 `purge`
- `catalog_import.py` – (计划 SI)一条目录条目的处理:取回(`FetchRequest.system=True`)→ 探测 → 封面 → `audio_only` → 字幕 / 识别 →
  分句 → 翻译(`ai.translate_texts`,系统计费)→ ready(未发布)
- `catalog_jobs.py` – (计划 SI)`CatalogJobs`(`app.state.catalog`):一次一个、无轮询、`kick()` 触发、启动恢复;`pending` 在 `tests/background.py`
```

  「Pitfalls」追加:

```markdown
- 精选库:共享文件在 `library/_catalog/<id>/`,暂存在 `library/_catalog/_tmp/<id>/`(不在 `library/_tmp/`)。副本 `source="catalog"`、
  `library_bytes=0`、`media_path` 指向共享文件;**删副本 / 删用户只删 `library/<uid>/…`**,永远不按 `media_path` 删文件。
  目录文件只在「退役且引用数为 0」或强制删除时删除(spec R1)。副本不能重新识别、不能换字幕(`catalog_locked`)。
- 精选库计费:导入的识别与译文、共享分析都是系统的(`metering.system_scope()` / `bind_user(None)`,feature `cat_import` /
  `cat_translate` / `cat_analysis`);共享分析受 `library_cat_ai`(`*`)每日上限;其他母语或改过字的句子走用户自己的额度。
- 目录的标题、许可说明、句子与用户内容一样不进日志 / 审计 / 计量。
```

- [ ] **Step 2: `app/CLAUDE.md`**:迁移一行的「head `0021`」改成「head `0022`」;「Library wiring」末尾加一句:「精选库:`library_catalog` 路由(用户)在 `library_import` 之后;计划 SI 在三处带 `plan SI` 字样的锚点装 `CatalogJobs` 与 `admin_catalog`。」
- [ ] **Step 3: `routers/CLAUDE.md`**:在 `library` 条目之后加 `` `library_catalog` (/api/library/catalog*: list published built-in items, idempotent `add` = copy into the user's library, poster; gated by `LIBRARY_CATALOG_ENABLED`; ids only in URLs; before `stubs`) ``,以及(为 SI 预写)`` `admin_catalog` (/api/admin/library/catalog*: curated catalog import by link / chunked upload, publish, edit, delete / purge via `app/admin/catalog_admin.py`; audit ids and numbers only) ``。
- [ ] **Step 4: `server/README.md`** 备份一节加一句:「数据库备份不包含音频与封面文件(跟读库与精选库都一样)。服务器数据卷丢失或只恢复了数据库时,精选条目会显示『媒体缺失』,需要在管理后台重新导入。」以及「跟读库」设置表加 `LIBRARY_CATALOG_ENABLED`、`LIBRARY_CATALOG_AI_DAILY` 两行。
- [ ] **Step 5:** `uv run pytest -q tests/test_architecture.py` → 绿。**提交** `docs: curated catalog notes for the library, routers and backups`。

## 交接(给 SI / W / AU)

- `catalog_store`、`paths`、`ai.translate_texts`、`metering.system_scope`、错误码、设置、`main.py` 锚点与 `tests/background.py` 的 `catalog` 集合都已就位;签名见 INDEX §7。
- 网页的契约同步只加了类型键、错误映射与三条文案;「精选」界面、徽标、菜单、封面都归 W。
- 未验证:Postgres 上的迁移与唯一索引(只在 SQLite 跑过);管理端「用量」页对 `user_id` 为空的行的显示。
