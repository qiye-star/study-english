# L5 影视配音 · 结果记录(Task 0a 核对结果)

- 日期:2026-10-21 · 车道:L5(服务端 S1–S12 由 `2026-10-21-l5-server-results.md` 记录)
- 基线分支:`feat/self-hosted-backend`(commit `a377ecf0`)。worktree 为 `worktree-agent-ae33cce7641ad93d3`。
- 计划文件来源:`docs/superpowers/plans/10.21-plans/` 与 spec 在本分支**不存在**(仅以未提交文件形式存在于主检出目录);
  本车道只读取它们,没有复制进本分支。本文件是本车道新建的。

## Task 0a Step 1 · 迁移头

- `uv run alembic heads` → `0027 (head)`(L3 的 0028 尚未合并,故接 `0027_captcha_replay`)。
- 钉住头的断言 `get_heads() == ["0027"]` 实际为 **12 处**(计划写的是 10 处):
  - `tests/test_accounts_models.py:29`、`test_avatars_models.py:29`、`test_captcha_models.py:51`、`test_changelog_models.py:18`、
    `test_invites_v2_models.py:51`、`test_library_catalog_models.py:26`、`test_library_models.py:16`
  - `tests/test_migrations.py:365、432、497、548、628`(计划只列了 365/432/497,漏了 548、628)
- 另有 `tests/test_captcha_models.py:52` 的 `get_revision("0027").down_revision == "0026"`,这是修订关系断言,不随头移动而改。

## Task 0a Step 2 · 逐词偏移(代码层)

以下计划引用的行号经核对仍成立:
- `providers/xfyun_result.py:6` `TICKS_PER_FRAME = 100_000`。
- `:58–64` `_timing` 把 `beg_pos/end_pos` 换成 `offset` / `duration`(100 ns 刻度)。
- `:128` `_is_speech_word`(非 `sil` 且有 `total_score`)、`:132` `to_assessment`。
- `tests/test_xfyun_result.py:59` 断言 `hello["offset"] == 1 * 100000`。
- `services/assessment_store.py:35` `result=result` 整个保存进 `assessments.result`;`:24` `save_assessment`。
- `routers/speech.py:35` `SOURCES = ("practice", "chat", "library")`;`:132` `/assessments`;`:193` `check_quota`;`:232` 返回 `assessment_id`。

偏差:无行为偏差。`word` 条目的文字键是 `"word"`(不是 `text`),计划 S4 的测试写法需按此取值。
仍未验证:真实上游 `beg_pos` 的起点与精度(R12 a–c),不在代码层能确认。

## Task 0a Step 3 / 5 · 网页与管理端挂载点(只读,仅核对位置)

- `web/src/features/library/`:目录存在;`dubbing-kit.ts`、`features/dubbing/` 均尚未创建(符合计划)。
- `web/src/lib/glass-flag.ts:9` `PINNED_PATH_PREFIXES = ["/library", "/practice/changelog"]`(计划 R16「/library* 钉在经典皮肤」成立)。
- `admin/src/features/catalog/`:`catalog-detail.tsx` 的句子区 `<section>` 在 `:127`、`:245`。
- 未核对(超出本车道服务端范围,留给 W1/W2 与 A1 时再核对):`ScoreCard` 的 CSS 变量是否只在 `library.css` 定义。

## Task 0a Step 4 · 测试守卫

- `web/src/plugins/links-matrix.test.tsx:31` `practiceHome` 期望 `["daily-tasks.card"]`。
- `web/src/architecture.test.ts:68–72` 为 `CROSS_FEATURE_BASELINE` 列表;`:200` `expect(CROSS_FEATURE_BASELINE.size).toBe(19)`。
- `server/tests/test_settings_registry.py`、`test_admin_users.py`(`USER_ROWS` 在 `app/admin/users_admin.py:42`)、`test_prompts.py`、`test_prompts_api.py`、`test_library_privacy.py` 均存在。
- `server/tests/agents_helpers.py:171` `check_contract(name, actual)`。

## 服务端锚点核对(计划 S1–S12 引用)

- `models.py`:`Assessment` `:101`、`VocabularyItem` `:127`、`WordbookEvent` `:701`、`LibraryItem` `:1000`、`LibrarySegment` `:1046`、
  `LibraryAttempt` `:1064`、`CatalogItem` `:1082`、`CatalogSegment` `:1119`(与计划一致)。
- `library/store.py`:`write_segments` `:121`、`delete_item_rows` `:183`、`add_attempt` `:340`、`best_attempts` `:353`(一致)。
- `library/catalog_store.py`:`add_to_library` `:289`、`sync_copies` `:389`(一致)。
- `library/limits.py`:`SCOPE_CATALOG_AI` `:54`、`reserve_ai` `:166`、`refund_ai` `:182`(一致)。
- `library/ai.py`:`AiUnavailable` `:59`、`_CATALOG_LOCKS` `:181`、`analyze_catalog` `:206`(一致)。
- `routers/library.py`:`require_library` `:44`、`require_ai` `:467`、assessment 校验 `:621`(一致)。
- `services/prompts.py:56` `library.translate` 等 `PromptSpec`(一致)。
- `core/config.py:286` `library_enabled`、`core/settings_registry.py:91`(一致)。
- `tests/test_architecture.py:27` `LAYERS`、`:326` `test_library_layer_rules`(一致)。

## 结论

Task 0a 服务端部分核对完毕,计划裁定可以按原样执行;唯一需要记录的偏差是钉住头的断言为 12 处而非 10 处。
