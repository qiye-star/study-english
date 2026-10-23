# 10.21 清理车道 · 执行结果(cleanup)

- 日期:2026-10-21 · 分支:`worktree-agent-a6f738768c8037f12`(由 `integ-10-21`(`be7c7367`)重置而来)
- 范围:关闭 L1 / L4 / L5 结果文档里登记的遗留项(共 9 项,见下)。
- 未推送;未动主检出目录与其他工作树;未重建或重启容器;未跑全量测试、E2E、`yarn web:build`。
- 只跑了每项列出的测试文件 + `tests/test_architecture.py`(服务端)或对应网页 / 管理端目录 + 类型检查。
- 工作树里为运行前端测试创建了 `node_modules` 联接点(根、`web/`、`admin/`),指向主检出,只读使用,未纳入提交。

## 总览

| # | 项 | 状态 | 提交 |
|---|---|---|---|
| 1 | 配置样例(`server/.env.example`) | 完成 | `68f7e97e` |
| 2 | L1 T18:`LocalStore.path_of` 白名单、隐私套件加强 | 完成(审计行断言未加,见下) | `a8ac6771`、`1468c5b1` |
| 3 | L5 服务端隐私测试非空真 | 完成 | `5f4cc54f` |
| 4 | L1 T22:bundle 导入与审计行同一事务 | 完成 | `bc7ea6a3` |
| 5 | L1 T23:管理端 bundle 对话框与详情导出按钮的组件测试 | 完成(「存储对话框」不存在,见下) | `654f6507` |
| 6 | L5 A1:管理端角色标注 | 完成 | `d2326ef1` |
| 7 | L5 网页缺口 (a)(b)(c) | 完成 (a)(b)(c);ScoreCard 详情 **跳过** | `a126c5fd`、`f736147b` |
| 8 | L4 T15:沉睡词页到词卡的入口 | 完成(走 `wordActions` 插槽,见下) | `93490e29` |
| 9 | L4 T16:对话页提示词注入的页面级测试 | 完成(实时通话路径未覆盖) | `c6f8bfa8` |

## 逐项记录

### 1. 配置样例(完成,`68f7e97e`)
- 核对:`S3_*`、`STORAGE_*`、`S3_FALLBACK_*` 在 `server/.env.example` 中已经都有占位行(L1 结果文档列出的全部键);没有真实值。
- 新增:`ACTIVATION_ENABLED=false`、`DUBBING_ENABLED=false`、`DUBBING_SUGGEST_DAILY_PER_USER=120`(占位值,未校准);`WORDBOOK_FSRS_PCT` 与 `WORDBOOK_FSRS_RETENTION_PCT` 以注释形式列出(它们是运行时设置,默认 0 与 90)。
- 新测试 `server/tests/test_env_example.py`:每个登记的名字必须在样例里出现,且必须是 `Settings` 的字段;默认值断言。
- 命令与结果:
  - 红:新测试在样例未改时 2 项失败(预期)。
  - `uv run pytest -q tests/test_env_example.py tests/test_storage_config.py tests/test_architecture.py` → 39 passed。

### 2. L1 T18(完成,`a8ac6771`、`1468c5b1`)
- `LocalStore.path_of`:现有实现已经经 `check_key`(只允许 `ROOTS` 的首段、拒绝 `..`、`.`、反斜杠、绝对路径、暂存键)与 `resolve().is_relative_to(root)` 双重检查,没有改代码。新增测试把它钉住:
  - 参数化用例(`/etc/passwd`、`C:/…`、反斜杠穿越、`library/..`、`./`、`//`、`bundles/../../app.db`、百分号编码、`library/_tmp/…`)一律 `ValueError`;
  - 符号链接逃出根目录:`stat` / `get_bytes` / `path_of` 都拒绝(测试在本机通过,未跳过);
  - 合法键返回根目录内的文件,缺失键 `BlobNotFound`。
- 架构断言(`tests/test_architecture.py`):`<store>.path_of(...)` 只允许出现在 `app/storage/` 内;附扫描器自检(能抓到 `request.app.state.storage.path_of`,忽略 `backups.path_of`)。
- 隐私套件 `tests/test_storage_privacy.py` 加强:
  - 每个「不出现」断言前都有正控制(`capture check`)或层自己的日志行(`storage op=… code=…`),捕获失效时会失败;
  - 新增:SDK 的原始 `NoSuchKey`(只能是缺失,不能泄露键)、凭据与端点泄露(`SECRET-AK-marker` / `SECRET-SK-marker` / `https://SECRET-ENDPOINT-marker.test`,出现在异常消息、`repr`、日志中都不允许)、503 响应体(固定文字、不含桶 / 键 / 端点)。
- 命令与结果:
  - `uv run pytest -q tests/test_storage_local.py` → 30 passed, 1 skipped(仅 POSIX 权限用例,既有);
  - `uv run pytest -q tests/test_architecture.py tests/test_storage_local.py` → 42 passed, 1 skipped;
  - `uv run pytest -q tests/test_storage_privacy.py` → 9 passed;
  - `uv run pytest -q tests/test_storage_privacy.py tests/test_storage_local.py tests/test_architecture.py tests/test_storage_config.py tests/test_storage_keys.py` → 106 passed, 1 skipped。
- **未完成**:计划要求的「审计行里没有这些占位值」断言没有加。隐私套件目前覆盖日志、异常字符串、`repr`、503 响应体;审计行的覆盖仍只在既有测试里。
- 注意:`test_architecture.py` 的新断言是「增加」而不是收缩白名单,没有改 `FILE_RESPONSE_ALLOWED` / `DATA_DIR_ALLOWED`。

### 3. L5 服务端隐私测试(完成,`5f4cc54f`)
- `tests/test_dubbing_privacy.py` 的完整流程用例:断言任何敏感字符串不出现之前,先发出一条正控制日志(logger `app.dubbing`),并断言 `caplog.records` 非空且含该控制记录。
- 命令与结果:`uv run pytest -q tests/test_dubbing_privacy.py tests/test_architecture.py` → 25 passed(1 个既有警告)。
- 说明:正控制只证明捕获生效,不证明该流程本身写了日志;这一点在结果里不做更强的声称。

### 4. L1 T22:bundle 导入与审计同一事务(完成,`bc7ea6a3`)
- 偏差修复:`app/library/catalog_bundle.import_bundle` 新增关键字参数 `audit`(可选,异步回调,收到新行),在唯一的 `session.commit()` 之前调用;库层不导入 `app.admin`(分层规则保持)。
- `app/admin/catalog_admin.bundle_import` 把 `audit.record(...,"catalog.bundle_import", …)` 作为回调传入,删除了导入之后的第二次提交。拒绝路径仍不写审计(沿用既有测试)。
- 新测试 `test_the_import_and_its_audit_row_commit_in_one_transaction`:强制审计写入在写入行之后抛错 → 导入回滚(目录条目不存在、无审计行);恢复后成功并恰好有 1 条审计行。修复前该测试失败(条目仍然存在),修复后通过。
- 命令与结果:`uv run pytest -q tests/test_admin_catalog_bundle.py tests/test_catalog_bundle.py tests/test_admin_catalog.py tests/test_architecture.py tests/test_admin_routes_guarded.py` → 62 passed。

### 5. L1 T23:管理端组件测试(完成,`654f6507`)
- 新文件 `admin/src/features/catalog/bundle-dialog.test.tsx`(6 个用例,API 全部 mock):只列出可导入的 bundle;没选或没填理由时按钮禁用;导入使用去空白后的理由并关闭;服务端拒绝(`Item exists`)显示映射文案且对话框保持打开;列表失败显示错误;关闭时不请求、重开时清空选择。
- `catalog-detail.test.tsx` 新增 3 个用例:ready 且未退役、有句子、有媒体时显示「导出 bundle」并提示句数;退役 / 无句子 / 媒体缺失 / 非 ready 时不显示;服务端拒绝时显示映射文案。
- 说明:计划里的「存储对话框」在管理端并不存在(存储相关界面在 `features/ops`,已有 `data-page.test.tsx`);本项覆盖的是 bundle 对话框与详情导出控件。
- 命令与结果:`cd admin && yarn vitest run src/features/catalog` → 6 文件 38 用例通过(本项提交时);`yarn typecheck`(`tsc --noEmit -p .`)无输出(通过)。

### 6. L5 A1:管理端角色标注(完成,`d2326ef1`)
- 新增 `admin/src/features/catalog/role-labels.tsx`:挂在详情页句子列表之后(仅 ready 且有句子时)。
  - 查看:所有角色可见字母与角色名;viewer 只读(无按钮、无输入框)。
  - 编辑(operator):每句在「无 → A → … → F → 无」之间循环;角色名输入框 `maxLength=24`;只提交改动过的句子与角色名;保存成功显示「已保存,并同步到 N 个学习者副本」。
  - 智能建议:按最多 40 句一段顺序请求(`seg_from`/`seg_to`),结果只作为草稿显示;「采用」才改动本地标注,保存另外 PUT;「放弃」丢弃草稿;服务端错误经 `S.errors` 映射(`AI is busy today` 等),失败后不再继续请求。
  - 文案只有 zh-CN(管理端约定);没有 `console` 调用。
- `api.ts` 新增 `fetchRoles` / `putRoles` / `suggestRoles`;`strings.ts` 新增 `S.roles` 与 `S.errors`(`Invalid roles`、`Invalid clip`、`Too many sentences`、`AI is busy today`);`CLAUDE.md` 一条。
- 新测试 `role-labels.test.tsx`(8 个用例,API mock):viewer 只读;循环与只保存改动;角色名上限;建议分段(0–39、40)与草稿;放弃;保存映射错误;建议每日上限后停止;无 console 输出。
- `catalog-detail.test.tsx` 增加 `fetchRoles` mock(否则挂载的角色区会访问真实网络)。
- 命令与结果:`cd admin && yarn vitest run src/features/catalog` → 7 文件 46 用例通过;`yarn typecheck` 无输出(通过)。
- 未验证:没有在浏览器里看过布局;服务端的角色接口只在服务端测试中验证过,这里用的是 mock 的形状(与 `routers/admin_dubbing.py` 的 `RolesIn` / 响应对齐,未做端到端)。

### 7. L5 网页缺口(完成 a、b、c;ScoreCard 详情跳过)
- **(a) dub-session 与 stage 的直接测试(完成,`a126c5fd`)**
  - `dub-session.test.tsx`(8 个用例,舞台、录制 hook、调度器 mock):先进入彩排;「彩排」只调用调度器、不开麦;「开始录制」同一点按调用 `dub.start` 并切到录制视图;「停止并放弃」调用 `dub.stop` 并回到彩排;「返回」调用 `onExit`;完成的录音只交给 `onDone` 一次;中断与错误的提示。
  - `stage.test.tsx`(4 个用例):视频只拿到票据 URL 与 `playsinline`;元素回报给会话;字幕与倒计时叠层;加载失败显示重试并调用 `retry`。
- **(b) 片段选择器显示封面(完成,`f736147b`)**
  - `ClipPicker` 新增可选 `poster` 属性,有值时在句子列表之上显示 `<img alt="">`。
  - `dub-item-page.tsx` 用 kit 的 `usePosterUrl(itemId, Boolean(detail?.hasPoster))` 取得封面(没有封面或失败则不显示)。
  - `clip-picker.test.tsx` 新增 1 个用例(有封面在句子之上;无封面不渲染)。
- **(c) 之前的录音列表与重新打开(完成,`f736147b`)**
  - 服务端已有列表路由 `GET /api/dubbing/items/{id}/takes`(最近 20 条,只含本人),所以做了。
  - 新文件 `take-history.tsx`:`TakeHistory`(列出录音;已完成的显示分数与「打开」,未完成标「未完成」且不可打开)与 `reopenedResult(take)`(结果只来自服务端记录:`outcomes` 为空、`urls` 为空,所以结果页的「我的」按钮保持禁用)。
  - `dub-item-page.tsx`:进入时取列表,每次录制结束后刷新;「打开」先取单条记录,再设置选择与角色并显示结果页。失败时列表隐藏,不挡住选片段。
  - 文案 `web.dubbing.takes.*`(中英)。`take-history.test.tsx`(4 个用例)。
  - 未覆盖:`dub-item-page.tsx` 的装配没有页面级测试(只测了组件与纯函数)。
- **ScoreCard 详情(跳过)**
  - 原因:`ScoreCard` 的 `save` 参数需要 `SaveSentenceState`(`features/library/save-sentence.tsx`),它的 `useSaveSentence` 与类型都没有从 kit 导出。要做到,就得往 `dubbing-kit.ts` 里加导出;而 L5 R18 冻结了 kit 的导出集合,`dubbing-kit.test.ts` 也逐个钉住了名字。这需要改计划(R18),本车道不改,故跳过,未做任何改动。
- 命令与结果:`cd web && yarn vitest run src/features/dubbing` → 25 文件 151 用例通过(含上面全部新文件);`yarn web:typecheck` 退出码 0。

### 8. L4 T15:沉睡词页到词卡的入口(完成,`93490e29`)
- 方式:不使用计划里提到的 `wordDetailSections`(那个点只在词卡内部渲染,不能从沉睡词页到达词卡)。改用 `wordActions` 插槽:`dormant-page.tsx` 每个沉睡词一行渲染 `<WordActions target={{ word, source: "progress" }} variant="icon" testId=… />`(与查词条的做法相同)。「更多」面板里的「查看词卡」行由 `features/wordbook` 的登记处(`register-word-actions.tsx`)贡献,经 `plugins/word-actions` 进入插槽。
- 结果:`features/activation` 没有导入 `features/wordbook`;没有新增跨 feature 边(架构基线未变)。
- 行为条件:「更多」按钮与「查看词卡」由 `word_actions` 联动与词书开关决定;两者都关时只剩核心的「加入生词本」。
- 测试:`dormant-page.test.tsx` 新增 1 个用例:登记一个探针贡献,检查每个沉睡词行都把自己的单词交给插槽(点击探针得到对应单词)。
- 命令与结果:`cd web && yarn vitest run src/features/activation src/architecture.test.ts src/plugins` → 24 文件通过;`yarn web:typecheck` 退出码 0。
- 未验证:没有在浏览器里点开「更多」面板看词卡(需要真实的联动与词书配置)。

### 9. L4 T16:对话页提示词注入的页面级测试(完成,`c6f8bfa8`)
- 新文件 `web/src/features/chat/conversation-page.prompt-hint.test.tsx`(单独成文件:登记点没有撤销接口,放进大测试文件会影响其他用例的 `SYS` 断言)。
- 4 个用例(真实页面、fetch mock):
  - 登记的说明接在 `SYS` 后面,用两次发送,loader 只被调用一次(「每次进入页面取一次」);
  - loader 失败 → 提示词逐字为 `SYS`;
  - loader 超时(`PROMPT_HINT_TIMEOUT_MS` 之后仍未返回)→ 逐字为 `SYS`;
  - 说明超过 `PROMPT_HINT_MAX` → 截到上限。
- 命令与结果:`cd web && yarn vitest run src/features/chat/conversation-page.prompt-hint.test.tsx` → 4 passed;`src/architecture.test.ts src/lib` → 18 文件通过。
- **未覆盖**:实时通话的 `systemPrompt` 路径(计划要求的「仍受 `START_LIMITS.systemPrompt` 截断」)没有页面级测试;需要实时通话的 harness,本车道未做。未验证。

## 未运行 / 未验证(总表)

- 未运行:全量服务端 `uv run pytest -q`、全量网页 `yarn web:test`、`yarn web:build`(主包增量与懒加载分块)、E2E、容器、推送。
- 未在真机、真实 S3 / 上游或浏览器中验证任何一项。
- 管理端 `yarn typecheck` 的成功以「没有输出」判断(`tsc` 成功时不输出);退出码未单独记录。
- 所有网页测试在 jsdom 中运行;视觉与液态玻璃层数未重新检查。
- 工具层面的说明:`test_architecture.py` 的编辑在中途出过错(误截断),已从 HEAD 还原该文件并只重新应用本次改动;最终 diff 只有新增行(36 行),没有丢失其他内容。

## 测试命令汇总(本车道提交时的最终结果)

| 范围 | 命令 | 结果 |
|---|---|---|
| 服务端 env 样例 | `uv run pytest -q tests/test_env_example.py tests/test_storage_config.py tests/test_architecture.py` | 39 passed |
| 服务端存储 | `uv run pytest -q tests/test_storage_privacy.py tests/test_storage_local.py tests/test_architecture.py tests/test_storage_config.py tests/test_storage_keys.py` | 106 passed, 1 skipped |
| 服务端配音隐私 | `uv run pytest -q tests/test_dubbing_privacy.py tests/test_architecture.py` | 25 passed |
| 服务端 bundle | `uv run pytest -q tests/test_admin_catalog_bundle.py tests/test_catalog_bundle.py tests/test_admin_catalog.py tests/test_architecture.py tests/test_admin_routes_guarded.py` | 62 passed |
| 管理端目录 | `cd admin && yarn vitest run src/features/catalog` | 7 文件 46 用例通过 |
| 管理端类型 | `cd admin && yarn typecheck` | 无输出 |
| 网页配音 | `cd web && yarn vitest run src/features/dubbing` | 25 文件 151 用例通过 |
| 网页激活 / 插件 | `cd web && yarn vitest run src/features/activation src/architecture.test.ts src/plugins` | 24 文件通过 |
| 网页对话页 | `cd web && yarn vitest run src/features/chat/conversation-page.prompt-hint.test.tsx` | 4 passed |
| 网页架构与库 | `cd web && yarn vitest run src/architecture.test.ts src/lib` | 18 文件通过 |
| 网页类型 | `yarn web:typecheck`(仓库根) | 退出码 0 |

注:「网页激活 / 插件」一行与「网页架构与库」一行是各自最后一次运行的结果;之后只改了文档与 `CLAUDE.md`。
