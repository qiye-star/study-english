# L5 影视配音 · 服务端结果(Task 0a、S1–S12)

- 日期:2026-10-21 · 分支:`worktree-agent-ae33cce7641ad93d3`(由 `feat/self-hosted-backend` 重置而来,基线 `a377ecf0`)
- 范围:Task 0a 与服务端 S1–S12;未做 Task 0b、W1–W11、A1 的网页部分。
- 计划的来源文件不在本分支(见 `2026-10-21-l5-dubbing-results.md` 开头),只读取了主检出目录里的未提交副本。
- 测试口径:每个任务只跑它列出的文件 + `tests/test_architecture.py`;未跑全量、未跑 E2E、未重建或重启容器、未推送。

## 任务状态(进行中,随提交更新)

| 任务 | 状态 | 提交 | 说明 |
|---|---|---|---|
| Task 0a 前置核对 | 完成 | `f69259ca` | 结果见 `2026-10-21-l5-dubbing-results.md`;钉住头断言实为 12 处 |
| S1 迁移 0029 与模型 | 完成 | `f75f8a8f` | 见下方偏差 1、2 |
| S2 开关、设置、包骨架 | 完成 | `394f8c8b` | 见下方偏差 3 |
| S3 片段规则 | 完成 | `0c8dbbe4` | 角色规则移到 `library/roles.py`,见偏差 4 |
| S4 打分 | 完成 | `c0738178` | ISE 样例 wav 长度为假设值,见偏差 5 |
| S5 角色的库读写 | 完成 | `26f3392a` | `library/roles.py` 新建;`store.write_segments` 承接角色 |
| S6–S12 | 未完成 | — | 见文末「未完成」 |

## 逐任务记录

### Task 0a
- `alembic heads` = `0027`。钉住头的断言 12 处(计划写 10 处)。
- 逐词偏移代码层核对通过:`xfyun_result.py:6`、`:58–64`、`:128`、`:132`;`tests/test_xfyun_result.py:59` 与 `assessment_store.py:35` 仍成立。
- 未验证:真实讯飞上游 `beg_pos` 的起点与精度(R12 a–c)。

### S1 迁移 0029 与模型(`f75f8a8f`)
- 新增 `server/alembic/versions/0029_dubbing.py`(接 `0027`)、`LibraryDub` 模型、`speaker` / `role_names` / `dub_id` 列。
- 钉住头的断言:`get_heads() == ["0029"]`,共 12 处(`test_accounts_models`、`test_avatars_models`、`test_captcha_models`、`test_changelog_models`、`test_invites_v2_models`、`test_library_catalog_models`、`test_library_models`、`test_migrations` 的 5 处)。`test_captcha_models.py:52` 的修订关系断言不变。
- 命令:`uv run pytest -q tests/test_dubbing_models.py tests/test_migrations.py tests/test_library_models.py tests/test_library_catalog_models.py tests/test_admin_users.py tests/test_accounts_models.py tests/test_avatars_models.py tests/test_captcha_models.py tests/test_changelog_models.py tests/test_invites_v2_models.py tests/test_architecture.py` → 通过(83 + 修正后 47 项,全部通过);`test_library_delete_user.py test_library_store.py test_admin_users.py` 通过。
- 偏差 1:`tests/test_library_catalog_models.py::test_models_declare_the_frozen_names` 精确列出了 `CatalogItem` / `CatalogSegment` 的列集合,加列后需要把 `role_names` / `speaker` 加进去。这是模式约定的合理改动,断言本身未放宽。
- 偏差 2:`store.delete_item_rows` 的删除行放在函数文档字符串之后。

### S2 开关、设置、包骨架(`394f8c8b`)
- `config.py`:`dubbing_enabled = False`、`dubbing_suggest_daily_per_user = 120`(`Field(120, ge=0, le=5000)`)。
- `settings_registry.py`:`dubbing_enabled`(features,danger)与 `dubbing_suggest_daily_per_user`(library,int)各一条。
- `library/limits.py`:`SCOPE_DUBBING_SUGGEST = "dubbing_suggest"`(计划放在 S6,为了 S2 的长度测试提前加入)。
- `app/dubbing/`:`__init__.py`、`errors.py`(`API_ERRORS` 16 个固定英文码)、`CLAUDE.md`(骨架)。
- `tests/test_architecture.py`:`LAYERS`、`ALLOWED`(admin、routers、main 各加 `dubbing`)、新增 `test_dubbing_layer_rules`。
- 命令:`uv run pytest -q tests/test_dubbing_basics.py tests/test_settings_registry.py tests/test_architecture.py tests/test_runtime_settings.py tests/test_admin_settings*.py` → 115 通过。
- 已知但未修复的失败:`tests/test_limits.py::test_login_field_length_limits` 期望 422、得到 401。该测试与 `routers/` 下的登录路由在本车道中未改动(`git diff a377ecf0` 为空),因此是分支上原有的问题;本车道**未在基线上单独复跑**来确认。不属于 L5 范围。
- 偏差 3:`test_dubbing_basics.py` 的设置断言按 `SPECS` 是 dict 的形状写。

### S3 片段规则(`0c8dbbe4`)
- `app/dubbing/clip.py`:`check`、`mine`、`speakers_in`、常量 `MAX_LINES = 12`、`MAX_MS = 90_000`(占位)。
- 偏差 4:计划把 `clean_role` / `clean_name` 放在 `dubbing/clip.py`,但 `library` 不能导入 `dubbing`(R25),而角色名的读写在 `library/roles.py` 中需要它们。S5 把它们移到 `library/roles.py`,`clip.py` 改为从那里导入并再导出,名字不变。
- 命令:`uv run pytest -q tests/test_dubbing_clip.py tests/test_architecture.py` → 40 通过。

### S4 打分(`c0738178`)
- `app/dubbing/scoring.py`:纯函数 `spoken_span`、`onset_score`、`ratio_score`、`sync_score`、`line_score`、`take_summary`;占位权重 0.6/0.2/0.2、容忍 400 ms、落差 1000 ms、时长比区间 0.8–1.25、零点 0.4–2.5。只依赖标准库。
- 偏差 5:计划的样例断言未给出 WAV 长度。`ise_good.xml` 的最后一个词在 5140 ms 结束,按 `wav_ms + 100` 的规则,5000 ms 会被判为不可信。测试因此使用 5200 ms 作为假设的 WAV 长度,并断言 5000 ms 返回 None。
- 命令:`uv run pytest -q tests/test_dubbing_scoring.py tests/test_architecture.py tests/test_xfyun_result.py` → 95 通过。

### S5 角色的库读写(`26f3392a`)
- `app/library/roles.py`:`merge`(纯函数,校验失败抛 `ValueError("roles")`)、`roles_out`、`apply`、`apply_catalog`、`sync_catalog_roles`;读写函数不提交。
- `store.write_segments`:新句子按「压空白后的文字」承接旧句子的 `speaker`,重复文字按顺序一一对应;找不到为 `NULL`(R5)。`keep_ai` 两种情况都承接。
- `catalog_store.add_to_library`:复制 `speaker` 与 `role_names`(R4)。
- 命令:`uv run pytest -q tests/test_dubbing_roles_store.py tests/test_library_store.py tests/test_library_catalog_store.py tests/test_dubbing_clip.py tests/test_architecture.py` → 78 通过;`tests/test_library_api.py tests/test_library_rebuild.py tests/test_library_catalog_api.py` → 27 通过。
- 未验证:「超过 6 个角色」的校验分支在当前代码中不可达(只有 A–F 六个合法字母),测试只覆盖上界(六个字母全部可用)。

## 未完成

- S6(角色建议 `roles_ai.py`、提示词登记)、S7(配置与角色接口)、S8(配音记录)、S9(逐句关联与收尾)、S10(管理端角色接口)、S11(隐私测试与契约夹具)、S12(文档)尚未开始。
- A1(管理端网页)与全部网页任务按指令不做。
