# L5 影视配音 · 服务端结果(Task 0a、S1–S12)

- 日期:2026-10-21 · 分支:`worktree-agent-ae33cce7641ad93d3`(由 `feat/self-hosted-backend` 重置而来,基线 `a377ecf0`)
- 范围:Task 0a 与服务端 S1–S12,以及 A1 中属于服务端的部分(即 S10 的管理端接口)。未做 Task 0b、W1–W11,也没有做 A1 的管理端网页。
- 计划来源:计划与规格不在本分支(只存在于主检出目录的未提交文件中)。本车道只读取了它们,没有复制进分支;本文件与 `2026-10-21-l5-dubbing-results.md` 是本车道新建的。
- 测试口径:每个任务只跑它列出的文件 + `tests/test_architecture.py`。未跑全量、未跑 E2E、未重建或重启容器、未推送、未动主检出目录。
- 本车道没有合并任何东西;所有提交都在 `worktree-agent-ae33cce7641ad93d3` 上。

## 结果一览

| 任务 | 状态 | 提交 |
|---|---|---|
| Task 0a 前置核对 | 完成 | `f69259ca` |
| S1 迁移 0029 与模型 | 完成 | `f75f8a8f` |
| S2 开关、设置、包骨架 | 完成 | `394f8c8b` |
| S3 片段规则 | 完成 | `0c8dbbe4` |
| S4 打分 | 完成 | `c0738178` |
| S5 角色的库读写 | 完成 | `26f3392a` |
| S6 角色建议与提示词 | 完成 | `67b173be` |
| S7 配置与角色接口 | 完成 | `7fd6bce7` |
| S8 配音记录 | 完成 | `2762de45` |
| S9 逐句关联与收尾评分 | 完成 | `bbeb80a4` |
| S10 管理端角色标注接口 | 完成 | `d185d265` |
| S11 隐私清单与契约夹具 | 完成 | `b2c5a1ef` |
| S12 服务端文档 | 完成 | 见 git log(本文件所在的提交) |
| A1(服务端部分 = S10) | 完成;网页部分未做 | `d185d265` |

另有一个中间提交 `5d45d9bf`(本文件的临时版本),已被本次更新覆盖。

## 最终测试结果

- 最终一轮:`uv run pytest -q` 跑 23 个文件(全部 `test_dubbing_*`、`test_admin_catalog_roles`、`test_admin_catalog`、`test_admin_routes_guarded`、`test_library_store`、`test_library_catalog_store`、`test_library_api`、`test_library_ai`、`test_prompts`、`test_prompts_api`、`test_migrations`、`test_settings_registry`、`test_architecture`)→ **339 passed**(1 个无关的 `stubs.py` 重复 operation-id 警告,已存在)。
- 每个任务的分项命令与结果见下方「逐任务记录」。

## 逐任务记录

### Task 0a 前置核对(`f69259ca`)
- `alembic heads` = `0027`。
- 钉住头的断言实际为 **12 处**(计划写 10 处,漏了 `test_migrations.py` 的 548、628 两行)。
- 逐词偏移代码层核对通过:`xfyun_result.py:6`、`:58–64`、`:128`、`:132`;`tests/test_xfyun_result.py:59` 与 `services/assessment_store.py:35` 仍成立。
- 详细核对结果见 `2026-10-21-l5-dubbing-results.md`。

### S1 迁移 0029 与模型(`f75f8a8f`)
- 新增 `server/alembic/versions/0029_dubbing.py`(`down_revision = 0027`,控制者合并时需重新接链)、`LibraryDub` 模型、`library_segments.speaker` / `library_items.role_names` / `catalog_segments.speaker` / `catalog_items.role_names` / `library_attempts.dub_id` 列与索引。
- 头断言改为 `["0029"]` 共 12 处 + 新增的 `test_dubbing_models.py` 一处。`test_captcha_models.py:52` 的修订关系断言未动。
- `store.delete_item_rows` 先删 `library_dubs`;`users_admin.USER_ROWS` 登记 `LibraryDub`。
- 命令:`uv run pytest -q tests/test_dubbing_models.py tests/test_migrations.py tests/test_library_models.py tests/test_library_catalog_models.py tests/test_admin_users.py tests/test_accounts_models.py tests/test_avatars_models.py tests/test_captcha_models.py tests/test_changelog_models.py tests/test_invites_v2_models.py tests/test_architecture.py` → 通过;`tests/test_library_delete_user.py tests/test_library_store.py tests/test_admin_users.py` → 通过。
- 偏差 1:`test_library_catalog_models.py::test_models_declare_the_frozen_names` 精确列出了两张目录表的列集合,加列后补上 `role_names` / `speaker`(断言本身未放宽)。
- 偏差 2:`store.delete_item_rows` 的新删除行放在文档字符串之后(初版误放在前面,已修正)。

### S2 开关、设置、包骨架(`394f8c8b`)
- `config.py`:`dubbing_enabled = False`、`dubbing_suggest_daily_per_user = Field(120, ge=0, le=5000)`。
- `settings_registry.py`:`dubbing_enabled`(features 组,`danger`)与 `dubbing_suggest_daily_per_user`(library 组,int)。
- `library/limits.py`:`SCOPE_DUBBING_SUGGEST = "dubbing_suggest"`(计划放在 S6,为了让 S2 的长度测试成立而提前加入)。
- `app/dubbing/`:`__init__.py`、`errors.py`(16 个固定英文码)、`CLAUDE.md`。
- `tests/test_architecture.py`:`LAYERS` / `ALLOWED` 加 `dubbing`(admin、routers、main 各加一项);新增 `test_dubbing_layer_rules`。
- 命令:`uv run pytest -q tests/test_dubbing_basics.py tests/test_settings_registry.py tests/test_architecture.py tests/test_runtime_settings.py tests/test_admin_settings*.py` → 115 通过。
- **已知且未修复的失败(不属于本车道)**:`tests/test_limits.py::test_login_field_length_limits` 期望 422、得到 401。登录路由与该测试在本车道中均未改动(`git diff a377ecf0 -- server/app/routers server/tests/test_limits.py` 为空),因此是分支上原有的问题。**本车道未在基线上单独复跑来确认**,只能说它与本车道的改动无关。

### S3 片段规则(`0c8dbbe4`)
- `app/dubbing/clip.py`:`check`、`mine`、`speakers_in`,常量 `MAX_LINES = 12`、`MAX_MS = 90_000`(占位)。S8 之后又加了 `check_span`(只看范围与大小,建议接口用)与 `WINDOW_BEFORE_MS` / `WINDOW_AFTER_MS`(只用于下发配置)。
- 偏差 3:计划把 `clean_role` / `clean_name` 放在 `dubbing/clip.py`,但 `library` 不能导入 `dubbing`(R25),而角色名的读写在 `library/roles.py` 里需要它们。S5 把这两个函数与常量移到 `library/roles.py`,`clip.py` 改为导入并再导出,名字不变。
- 命令:`uv run pytest -q tests/test_dubbing_clip.py tests/test_architecture.py` → 40 通过。

### S4 打分(`c0738178`)
- `app/dubbing/scoring.py`:纯函数,只依赖标准库。权重 0.6/0.2/0.2、容忍 400 ms、落差 1000 ms、时长比区间 0.8–1.25、零点 0.4–2.5,全部是占位。
- 偏差 4:计划的样例断言未给出 WAV 长度。`ise_good.xml` 的最后一个词在 5140 ms 结束;按 `wav_ms + 100` 的规则,5000 ms 会被判为不可信。测试使用 5200 ms 作为**假设**的 WAV 长度,并断言 5000 ms 返回 None。
- 命令:`uv run pytest -q tests/test_dubbing_scoring.py tests/test_architecture.py tests/test_xfyun_result.py` → 95 通过。

### S5 角色的库读写(`26f3392a`)
- `app/library/roles.py`:纯函数 `merge`(校验失败抛 `ValueError("roles")`,且不改动任何数据)、`roles_out`、`clean_role` / `clean_name`;读写 `apply` / `apply_catalog` / `sync_catalog_roles`,都不提交。
- `store.write_segments`:新句子按压空白后的文字承接旧句子的 `speaker`,重复文字按顺序一一对应,找不到为 `NULL`(R5);`keep_ai` 两种情况都承接。旧句子现在总是先读出再 `expunge`(之前只在 `keep_ai` 时做)。
- `catalog_store.add_to_library`:复制 `speaker` 与 `role_names`(R4)。
- 命令:`uv run pytest -q tests/test_dubbing_roles_store.py tests/test_library_store.py tests/test_library_catalog_store.py tests/test_dubbing_clip.py tests/test_architecture.py` → 78 通过;`tests/test_library_api.py tests/test_library_rebuild.py tests/test_library_catalog_api.py` → 27 通过。
- 未验证:「超过 6 个角色」的校验分支在当前代码中不可达(只有 A–F 六个合法字母),测试只覆盖上界(六个字母全部可用)。

### S6 角色建议与提示词(`67b173be`)
- `app/library/roles_ai.py`:`render`(句子经 `ai._plain` 转义,不能伪造 `</text>` 边界)、`parse`(`N. X` / `N) X` / `N: X`,字母必须在 A–F 且不能后接字母)、用户侧 `suggest`、管理端 `suggest_catalog`。默认模板 `DEFAULT_TEMPLATE` 只含占位符 `{text}`。
- **整段预留**:`suggest` 在上游调用前就要求额度能覆盖整段;不够则整段拒绝(`user_cap` / `global_cap`),不给半段建议。这是计划没有写明的选择。
- 上游失败与漏答的句子按句退还额度。
- `services/prompts.py` 登记 `library.roles`(`required={"text"}`、边界 `<text>`/`</text>`);`admin/prompts_admin.py` 增加 `default_body` 与 `test_messages` 的分支。
- 偏差 5:`tests/test_prompts.py` 与 `tests/test_prompts_api.py` 里有钉住 `PROMPTS` 键集合与概览顺序的断言,加入新键后需要更新。这是新增提示词的必然结果,断言未放宽。
- 命令:`uv run pytest -q tests/test_dubbing_suggest.py tests/test_prompts.py tests/test_prompts_api.py tests/test_library_ai.py tests/test_architecture.py tests/test_library_ai_api.py` → 108 通过。

### S7 配置与角色接口(`7fd6bce7`)
- `app/routers/dubbing.py`:`GET /api/dubbing/config`、`GET` / `PUT /api/dubbing/items/{id}/roles`、`POST /api/dubbing/items/{id}/roles/suggest`。`main.py` 注册在 `library_catalog` 之后、`stubs` 之前。
- 开关 `require_dubbing`:先鉴权(未登录 401),再看 `dubbing_enabled and library_available`,否则 404 `Dubbing is disabled`。建议额外要求 `library_ai_available`,否则 404 `Not Found`。
- 配置接口**需要登录**(与 `GET /api/library/config` 相同),计划写的是「永远应答」,这里理解为对已登录用户永远应答;未登录仍是 401。
- 副本(`catalog_id` 非空)的角色只读:PUT 与建议都返回 409 `Roles are set by the editors`。
- 建议接口:只返回草稿,不写库;片段违规 400 `Invalid clip` / `Clip is too long`;额度 429 `Daily AI limit reached` / `AI is busy today`;上游失败 503 `AI is unavailable`。失败路径也会提交一次事务,使退还生效。
- 命令:`uv run pytest -q tests/test_dubbing_api_roles.py tests/test_architecture.py` → 53 通过(其中 `test_dubbing_clip` 与 `test_architecture` 也在本轮一起跑过)。

### S8 配音记录(`2762de45`)
- `app/dubbing/takes.py`:`create`、`list_for_item`(最近 20 条,只含本人)、`get_owned`(非 uuid 直接 None)、`stale_lines`(按 `LibraryAttempt.text_hash` 与当前文字比较)、`take_out`、`remove`。
- 偏差 6:计划的删除函数名为 `delete`,与 SQLAlchemy 的 `delete` 冲突导致 `TypeError`。改名为 `takes.remove`。
- 路由:`POST /api/dubbing/items/{id}/takes`(201,`limited_user`)、`GET /items/{id}/takes`、`GET /takes/{dub_id}`、`DELETE /takes/{dub_id}`(204)。
- 输出的 `lines` 是按句号排序的**列表**(计划未定形状,这里选择列表),每项包含 `seg_idx`、`stale` 与录音时的分数字段;不含句子文字。
- 命令:`uv run pytest -q tests/test_dubbing_takes.py tests/test_dubbing_api_roles.py tests/test_architecture.py` → 35 通过。

### S9 逐句关联与收尾评分(`bbeb80a4`)
- `store.add_attempt` 增加可选参数 `dub_id`(计划允许的唯一改动)。
- 路由 `POST /takes/{id}/lines` 的校验顺序:take 存在且属于本人 → 状态 `recording`(否则 409 `Take is finished`)→ 句子在片段内且角色相符(否则 400 `Line is not in the take`)→ 同句已录:同一 `assessment_id` 返回原结果(200),否则 409 `Line already recorded` → 评测属于本人、来源 `library`、文字相同(否则 400 `Assessment does not match the line`)→ 时序(窗口 `[start−1000, start+500]`、`capture ∈ {pcm, recorder}`、`0 ≤ voiced_ms ≤ duration_ms`,否则 400 `Invalid line timing`)→ 打分并写入。
- 写入的 take `lines` 与 `LibraryAttempt` 在同一次提交中完成;同一 take 的读改写由进程内每 take 一把 `asyncio.Lock` 串行化,并在持锁后 `refresh`(由测试 `test_lines_posted_together_both_land` 覆盖)。
- `POST /takes/{id}/finish`:对角色句子求总分(未录的计 0,并标记 `missing: true`、`reason: not_recorded`),写入 `summary`,状态改为 `done`;重复 finish 返回 409。
- 配音成绩计入该句的跟读最好成绩(`store.best_attempts` 可见,由测试覆盖)。
- 命令:`uv run pytest -q tests/test_dubbing_lines.py tests/test_dubbing_takes.py tests/test_library_api.py tests/test_dubbing_scoring.py tests/test_architecture.py` → 45 + 79 通过。
- 未覆盖:讯飞的真实偏移与 `Assessment` 行的真实生成;这里的评测行是测试中直接写库的(形状取自 `ise_good.xml` 的转换结果)。

### S10 管理端角色标注接口(`d185d265`;即 A1 的服务端部分)
- `app/admin/catalog_roles.py`:`get_roles`、`put_roles`(保存 → `sync_catalog_roles` → 审计 `catalog.roles.edit` `{lines, roles, copies}` → 提交)、`suggest`(≤ 40 句,计入 `library_cat_ai`,审计 `catalog.roles.suggest` `{lines}`)。
- `app/routers/admin_dubbing.py`:`GET /api/admin/library/catalog/{id}/roles`(viewer)、`PUT …/roles`(operator)、`POST …/roles/suggest`(operator)。不受 `DUBBING_ENABLED` 影响。
- 已发布的目录条目可以改角色(R4.4);状态不是 ready → 409 `Item is not ready`。
- 偏差 7:`tests/test_admin_catalog.py::test_catalog_admin_urls_carry_only_ids` 钉住了 `/api/admin/library/catalog*` 的完整路由表,新增两条路由后需要登记。这是模式要求,不是放宽。
- 管理端错误文本是固定英文:`Too many sentences`(超过 40 句)与 `Invalid clip`、`Invalid roles`、`Item is not ready`、`AI is busy today`、`AI is unavailable`。这些文本不在配音契约夹具里。
- 命令:`uv run pytest -q tests/test_admin_catalog_roles.py tests/test_architecture.py tests/test_admin_catalog.py tests/test_admin_routes_guarded.py` → 36 通过。

### S11 隐私清单与契约夹具(`b2c5a1ef`)
- `tests/test_dubbing_privacy.py`:
  - `ROUTES` 登记了全部 13 条配音与管理端角色路由;扫描 `app.openapi()`,新出现的路由必须登记;路径参数只允许 `item_id` / `dub_id` / `catalog_id`;查询参数为空。
  - 完整流程测试:角色名 `SECRET-ROLE`、句子 `SECRET-LINE`、模型回复 `SECRET-REPLY`,上游失败时只看错误种类;对 `caplog`(logger `app`)与 `AdminAudit` 行断言不含这些文字。
- `tests/test_dubbing_contract.py` 录制 `tests/fixtures/dubbing_contract.json`(`CONTRACT_UPDATE=1` 录制一次,随后不带变量验证稳定);人工检查过:无令牌、无 `secret` 字样,时间固定,角色名样例为 `Host`。
- 命令:`uv run pytest -q tests/test_dubbing_privacy.py tests/test_dubbing_contract.py tests/test_architecture.py` → 15 通过。
- 局限:隐私测试只断言「不出现」,没有断言 `caplog` 确实捕获到了日志;如果日志根本没有输出,该断言也会通过。未加这一层断言。

### S12 服务端文档(本文件所在提交)
- `server/app/dubbing/CLAUDE.md` 补全;`server/app/CLAUDE.md` 增加 dubbing 层行、迁移头改为 `0029`;`server/app/library/CLAUDE.md` 增加 `roles.py` / `roles_ai.py` 并更新导入者;`server/README.md` 增加「影视配音」一节(开关、角色、评分、占位与未验证项)。

## 待控制者处理(本车道不改的文件)

- `server/.env.example` 归 L1,本车道不改。需要追加两行(R22):
  ```
  DUBBING_ENABLED=false
  DUBBING_SUGGEST_DAILY_PER_USER=120
  ```
- `docs/superpowers/plans/10.21-plans/2026-10-21-INDEX.md` §3 的 0029 行需要补一句「含 catalog 镜像列」(R2),本车道不改 INDEX。
- 迁移撞号:本车道的 `0029_dubbing.py` 接在 `0027` 上。如果 L3 的 `0028` 先合并,控制者需要把 `down_revision` 改为 `0028`(INDEX §3 规定的做法)。所有钉住头的断言也要随之改为新头。
- `docs/changelog` 草稿与 `server/.env.example` 不在本车道范围内。

## 偏差汇总

1. 计划目录不在分支上(只在主检出的未提交文件中)。
2. 钉住头断言 12 处(计划 10 处)。
3. `clean_role` / `clean_name` 移到 `library/roles.py`(分层规则)。
4. `SCOPE_DUBBING_SUGGEST` 提前到 S2。
5. ISE 样例的 WAV 长度是假设值(5200 ms)。
6. `takes.delete` 改名为 `takes.remove`(名字冲突)。
7. 建议是整段预留、整段拒绝(计划未写明)。
8. 配置接口需要登录(与库一致)。
9. `lines` 输出为列表,未录的句子标 `missing` + `reason`(计划未定形状)。
10. 钉住的路由表与 `PROMPTS` 列表随新路由与新提示词更新(`test_admin_catalog.py`、`test_prompts.py`、`test_prompts_api.py`、`test_library_catalog_models.py`)。
11. 管理端错误文本是本车道新增的固定英文串。

## 未验证项

- 真实讯飞 ISE 的 `beg_pos` 起点与精度、Omission 词的偏移(R12 a–c)。所有测试都用 `ise_good.xml` 的转换结果或直接写库的评测行。
- 真实大模型的建议质量与格式遵从度:所有测试都用 monkeypatch 的假 `llm.complete`;没有任何真实上游调用。
- 占位数值(12 句 / 90 秒 / 窗口 / 容忍 / 权重 / 额度 / 并发)均未校准。
- 并发:进程内锁只在单 worker 下成立(与 `library/CLAUDE.md` 的前提一致);多进程部署未验证。
- `tests/test_limits.py::test_login_field_length_limits` 的失败在本分支上已存在,**未在基线单独复跑确认**(见 S2)。
- 未运行:全量测试、E2E、容器构建与重启、网页与管理端的任何测试(按指令不做)。
- 所有 `test_dubbing_*` 与相关文件都是在 Windows 上的 Python 3.12 + SQLite 环境下跑的;Postgres 路径未验证。

## 未完成

- Task 0b、网页 W1–W11、管理端网页 A1 按指令未做。
- 计划的设备清单与真机验证全部未做。
