# 精选库 · 服务端核心(车道 SC)· 结果

- 日期:2026-10-14 · 分支 `feat/curated-cl-core` · 计划 `2026-10-14-curated-library-server-core.md`(Task 0–9)
- INDEX 的名字、路由、形状、签名**未改动**。

## 已做

| 任务 | 提交主题 |
|---|---|
| 0 | 核对(只读):`alembic heads` = `0021`;7 处 head 钉子;锚点位置与删除范围与计划一致 |
| 1 | `feat(server): catalog tables and library_items.catalog_id (migration 0022)` |
| 2 | `feat(server): catalog settings, error codes, paths and metering system scope` |
| 3 | `feat(server): catalog store (rows, shapes, queue)` |
| 4 | `feat(server): copy catalog items into a user's library, collect and purge` |
| 5 | `feat(server): user catalog endpoints (list, add, poster) and config.catalog` |
| 6 | `feat(server): guard catalog copies, keep shared files, collect retired items` |
| 7 | `feat(server): shared, system-paid analyses and free translations for catalog copies` |
| 8 | `test(server): catalog privacy and contract keys; web contract sync` |
| 9 | `docs: curated catalog notes for the library, routers and backups` |

测试(SQLite,仅定向):新文件 `test_library_catalog_{models,store,api,media,ai}.py` 共 44 条;
`tests/test_library_*.py tests/test_migrations.py tests/test_architecture.py tests/test_changelog_models.py tests/test_settings_registry.py` 共 835 条通过(含 `test_models_match_migrations` 与 0022 往返);
网页 `src/features/library` 60 个文件 / 425 条通过(1 条原本就跳过),`yarn web:typecheck` 干净。

## 裁定与偏差(都只动测试数据 / 助手,没有动 INDEX 接口)

1. **`tests/test_library_settings.py`**(计划未列):它写死了 `library_*` 设置键集合与范围,新增两个设置后必须加入 `LIBRARY_KEYS` 与一条范围断言。
2. **`tests/test_library_store.py`、`tests/test_library_api.py`**(计划未列):`item_out` 多了 `catalog_id`、`config` 多了 `catalog`,两处精确键集 / 字典比较同步更新。
3. **`web/src/features/library/add-sheet.test.tsx`**:`LibraryConfig.catalog` 是必填,这个测试里的字面量对象补 `catalog: false`(否则 typecheck 报错)。
4. **`_uid` 测试助手(计划原文有误)**:`users.id` 是应用生成的 8 位数字、没有自增,计划里 `User(username=…)` 不带 id 会触发主键 NULL;改成显式 id。
5. **`ai.translate_texts`** 内部自己套了 `feature_scope("cat_translate")`(计划只写「由调用方计量」),这样即使 SI 忘了包也不会记到别的 feature;签名与返回不变。
6. **`analyze_catalog`** 在重读目录句子后把 `seg.text` 取成普通值再用于后续写回(提交后不依赖 ORM 对象状态);另加了一条并发用例(两个并发的首次分析只花一次调用、一次计数)。
7. **契约夹具**:只用一次性脚本插入新键(`config.catalog`、三条 `errors`、条目形状的 `catalog_id`、`catalog_list` / `catalog_add` / `catalog_add_again` / `catalog_locked`),没有跑 `CONTRACT_UPDATE=1`;已用脚本核对「去掉新增键后与 HEAD 逐值相同」。
8. 新建文件用 Write(LF);改现有文件用保留 CRLF 的脚本;Git 会提示 LF/CRLF 转换警告,无内容影响。
9. 文案 `catalogDisabled` / `catalogNotFound` / `catalogLocked` 与其它错误文案一致带句号(计划里没有句号)。

## 未验证

- Postgres 上的迁移与唯一索引(只在 SQLite 上跑过)。
- 管理端「用量」页对 `user_id` 为空的行如何显示(`system_scope` 只在服务端单元 / 接口测试里验证了不扣用户)。
- 真实大模型的共享分析质量与费用;真实 ffmpeg 产物(本车道没有导入流水线,归 SI)。
- 并发「添加」的竞争只用打桩 + SQLite 单连接验证,未在 Postgres 多连接上验证。
- 未跑全量测试、E2E、容器重建(按要求)。
