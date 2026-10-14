# 级别标注(A1–C2 说明)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** owner(中文母语的英语学习者)要求:界面上凡是出现 CEFR 级别代码(A1、A2、B1、B2、C1、C2,以及段位里的 B1+ / C1+)的地方——跟读库「精选」的级别芯片与徽标、联机创建房间的「目标水平」、对话的「英语难度」、智能体角色水平、带我学难度、记忆页「水平」、段位「对齐 CEFR」、房间小结 / 邀请页徽标、管理后台的级别列与下拉框——都要有说明,让人一眼看懂这个级别是什么意思。**只改显示,存储、提交、URL 里的值一律不变。**

**Architecture:** 一个纯函数模块 `web/src/lib/levels.ts`(`parseLevel` / `levelName` / `levelLabel` / `levelMeaning`,`t` 由调用方传入)+ 一个无状态小组件 `web/src/components/level-hint.tsx`(`LevelHint`:一行「这个级别是什么意思」)+ 急切合并的文案 `web/src/components/i18n/{zh-CN,en}.json` 里的 `web.level.*`(每种语言 13 个键)。各 feature 只从 `~/lib/levels`、`~/components/level-hint` 导入,**不新增跨 feature 边**。管理后台是独立应用(`admin/`,不能导入 `web/`),自带一份中文表 `admin/src/lib/levels.ts`,由测试读取网页的 `zh-CN.json` 逐字比对,保证只有一套说法。

**Tech Stack:** React 18 + i18next + vitest(jsdom)+ @testing-library。不改服务端、不新增依赖、不改 `enjoy/`。

**依据:** owner 2026-10-14 的请求(本计划 Goal);现有措辞来源 `web/src/features/chat/i18n/{zh-CN,en}.json` 的 `web.chat.levels`(已上线的「A2 · 初级 / B1 · 中级 / B2 · 中高级 / C1 · 高级」);跟读库精选的计划 `docs/superpowers/plans/2026-10-14-curated-library-web.md` 与设计稿 `docs/superpowers/design/curated-library-v1/mockup.html`(另一个执行者正在 `.claude/worktrees/cl-web`、分支 `feat/curated-cl-web` 上实现,本计划只在它合并后的 Task T7 里碰 `features/library`)。

## Global Constraints

- **验证口径(如实):** 写这份计划时**没有运行任何测试、构建或服务**,只读了真实代码(行号以 2026-10-14 的 `feat/curated-cl-web` 工作区为准);下面的代码与测试是「读代码推断」,**第一次运行时以真实结果为准修正**(尤其:`i18n.getFixedT(...)` 返回值能否直接当 `TFunction` 传入、默认测试语言是否为 `en`、admin 测试里 `import.meta.url` 是否为 `file://`)。真机表现(分段控件两行字、芯片换行、窄屏截断)**全部未验证**,见文末「真机 / 视觉清单」。
- **值不变(R-LV1):** `<option value>`、`role="radio"` 选中后回传的值、请求体、URL、`localStorage`、`data-testid` 全部不变;只改用户看到的文字和新增的说明行。
- **分层:** `web/src/architecture.test.ts` 不放宽;`CROSS_FEATURE_BASELINE` 不变。`lib/levels.ts` 只依赖 `i18next` 的类型;`components/level-hint.tsx` 只依赖 `react-i18next`、`~/lib/cn`、`~/lib/levels`。
- **所有权:** 只改下表「车道」列出的文件 + `web/src/{lib,components}/CLAUDE.md`、`web/README.md`、`docs/superpowers/plans/2026-10-14-curated-library-web.md`(只加 Addendum,T7)、`docs/changelog/2026-10.json`(仅 T9,控制者)。**不碰** `enjoy/`、`server/`、提示词(`web/src/features/chat/levels.ts` 的 `LEVEL_INSTRUCTIONS` / `levelHint()`,服务端 `agents/prompt.py`、`rooms/assistant.py`、`rank/grading.py`)。
- **隐私:** 不涉及用户数据;不加日志。
- **工作树是 CRLF:** 改现有文件用 Edit 工具,锚点尽量是**单行**;少数两行锚点(已标注)不匹配时先 Read 原文、按真实换行再改。新文件用 Write。
- **测试:** 每个任务只跑它列出的文件(`cd web && yarn vitest run <files>`)+ `src/architecture.test.ts`,外加 `yarn web:typecheck`(从仓库根);admin 任务跑 `cd admin && yarn vitest run <files>` + `yarn admin:typecheck`。**不跑**全量 `yarn web:test`、`yarn web:build`、E2E、容器重建(用户要求时才跑)。
- **提交:** conventional(`feat(web): …` / `feat(admin): …` / `docs: …`),一任务一提交,提交后该任务的测试全绿;信息以执行者自己的署名行结尾(如 `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`)。
- **文案:** 共享文案只进 `web/src/components/i18n/{zh-CN,en}.json` 的 `web.level`(+13 键 / 语言);`web/src/features/chat/i18n/*.json` 的 `web.chat.levels` 删掉 A2–C1 四个键(只留 `auto`);`web/src/features/rooms/create/i18n/*.json` +1 键(`levelAuto`);`web/src/features/agents/locales/*.json` 改 1 个键的文字。`i18n/i18n.test.ts` 守着每个目录两种语言键一致。西班牙语(`es`)没有网页文案,回退英文(现状)。

## 读代码得出的现状(写计划时核对)

| 项 | 结论 |
|---|---|
| 已有的级别说法 | 只有对话有:`web/src/features/chat/i18n/zh-CN.json:42` `"levels": { "auto": "自动(不限制)", "A2": "A2 · 初级", "B1": "B1 · 中级", "B2": "B2 · 中高级", "C1": "C1 · 高级" }`,英文 `Elementary / Intermediate / Upper intermediate / Advanced`;说明行 `settingsForm.levelHint`「AI 会把用词和句长控制在这个水平。」。其余地方都只显示裸代码。 |
| 各处的级别集合 | 对话 `auto, A2–C1`(`chat/levels.ts:2`);房间 `A1–C1`(服务端 `server/app/rooms/rules.py:10`,经 `config.levels` 下发,网页兜底 `settings-fields.tsx:13`);角色 `A2–C1`(`agents/types.ts:14`,服务端 `agents/personas.py:20`);记忆页 `A1–C2`(`agents/memory/memory-api.ts:11`);精选库 `A1–C2`(admin 下拉 + 服务端 `models.py:1071`);段位 `A1, A2, B1, B1+, B2, C1, C1+`(`server/app/rank/tiers.py:21-27`,经 `/api/rank/config` 的 `tiers[].cefr` 下发)。 |
| 「beginner / intermediate」式取值 | 没有找到以这类词存储的级别;唯一的非代码取值是对话的 `auto`。词书难度条 `books-page.tsx` 是 1–6 的整数(不是 CEFR,服务端 `BookSpec.cefr` 存在但**不下发**)。 |
| 同名不同义(排除) | `realtime/call-hero.tsx` 的 `LevelBar` = 音量;`components/announcement-banner.tsx`、admin `ops/*` 的 `level` = 公告 / 日志严重程度;admin `settings/doctor-card.tsx` 的 `level` = 自检级别;`agents-api.ts` 等注释里的 A1 / A2 = 计划车道名。 |
| 文案加载 | `web/src/components/i18n/*.json` 与各 feature 的 `i18n/*.json` 由 `web/src/i18n/index.ts` 的 glob **急切**合并;`agents/locales`、`agents/tutor/locales`、`agents/memory/locales`、`library/locales` 是懒加载。测试里 `test/setup.ts` 导入 `~/i18n`,所以真实文案可用;默认测试语言是 `en`(各测试 `afterEach` 切回 `en`)。 |
| 名字冲突 | `chat/levels.ts` 已导出 `levelHint(level, purpose)`(给 AI 的提示词)。新模块**不用** `levelHint` 这个名字,改叫 `levelMeaning`,`LevelHint` 只作组件名。 |
| 精选库进行中的代码(`feat/curated-cl-web`) | `catalog-view.tsx:63-68` 级别芯片 `lib-chip`(文字 = 裸代码),`catalog-card.tsx` 卡片徽标 `<span className="lib-cat-level">{card.level}</span>`;`catalog-view.test.tsx:39` `getByText("B1")`、`:84-89` 芯片文字 `["全部","A2","B1","B2"]` 与 `{ name: "A2" }`。这些在 T7 里改。 |

## 盘点:所有显示或可选级别的地方

> 统计:**网页 18 处要标注**(现在可做 16 处 + 精选库合并后 2 处,另有 1 处「若出现才改」)、网页 1 处不改;**管理后台 5 处要标注**、2 处不改;**服务端 0 处改动**(7 处只是取值或提示词)。

| # | 位置(文件:行) | 现在显示什么 | 怎么标注 | 任务 |
|---|---|---|---|---|
| W1 | `web/src/features/chat/scenario-sheet.tsx:117` | 新对话「英语难度」下拉:`自动(不限制)`、`A2 · 初级`… | 选项文字改由 `levelLabel()` 生成(结果与现在逐字相同);下拉下面加 `LevelHint`(选中级别的意思,`aria-describedby` 关联) | T2 |
| W2 | `web/src/features/chat/conversation-settings-sheet.tsx:123`、`:125` | 对话设置「英语难度」下拉 + 通用说明「AI 会把用词和句长控制在这个水平。」 | 同 W1;`LevelHint` 放在通用说明行之上 | T2 |
| W3 | `web/src/features/chat/conversation-page.tsx:1194` | 对话顶栏副标题 `场景 · B1` | 改为 `场景 · B1 · 中级`(`levelLabel`) | T2 |
| W4 | `web/src/features/chat/i18n/{zh-CN,en}.json:42` | `web.chat.levels.{auto,A2,B1,B2,C1}` | 删 A2–C1 四个键,只留 `auto`(统一到 `web.level.*`) | T2 |
| W5 | `web/src/features/rooms/create/settings-fields.tsx:124-126` | 创建房间 / 房主设置「目标水平」分段控件 `A1 A2 B1 B2 C1`(等宽 5 段) | 每段两行:代码 + 小字级别名(`中级`);控件下加 `LevelHint`,未选时显示「不选时按你的段位自动定。」 | T3 |
| W6 | `web/src/features/rooms/create/settings-message.ts:26` | 房间系统消息「房主把目标水平改为 B1」 | `把目标水平改为 B1 · 中级` | T3 |
| W7 | `web/src/features/rooms/extras/invite-page.tsx:104` | 邀请落地页徽标「水平 A2」 | 「水平 A2 · 初级」 | T3 |
| W8 | `web/src/features/rooms/extras/summary-page.tsx:37` | 房间小结徽标「咖啡店点单 · B1」 | 「咖啡店点单 · B1 · 中级」 | T3 |
| W9 | `web/src/features/rooms/agents/persona-sheet.tsx:44` | 房间里角色信息弹层的水平小标签 `B1` | `B1 · 中级` | T3 |
| W10 | `web/src/features/agents/persona-editor-sheet.tsx:152-156` | 编辑角色「英文水平」单选芯片 `A2 B1 B2 C1` | 芯片文字 `B1 · 中级`(换行排布,`flex-wrap` 已有);标题行右侧加 `LevelHint`(选中级别的意思) | T4 |
| W11 | `web/src/features/agents/memory/profile-tab.tsx:104` | 记忆页「水平」下拉 `A1…C2` | 选项 `B1 · 中级`;下拉下加 `LevelHint`(未设置时显示 `web.level.scale`) | T4 |
| W12 | `web/src/features/agents/memory/profile-tab.tsx:55` | 智能体建议卡「智能体建议把「水平」改成 B2」 | 「改成 B2 · 中高级」(`show()` 对 `level` 用 `levelLabel`) | T4 |
| W13 | `web/src/features/agents/tutor/tutor-bar.tsx:66` | 带我学条右侧 `B1`(只有 `title` 悬停提示) | 可见文字 `B1 · 中级`;`title` 保留但不再是唯一说明 | T4 |
| W14 | `web/src/features/agents/tutor/tutor-recap-card.tsx:51` | 小结「难度 B1 → B2」 | 「难度 B1 · 中级 → B2 · 中高级」 | T4 |
| W15 | `web/src/features/agents/locales/{zh-CN,en}.json:141` | `zhNoteHint`「自动 = 角色水平 A2 / B1 时附上」 | 「自动 = 角色水平 A2(初级)/ B1(中级)时附上」 | T4 |
| W16 | `web/src/features/rank/rank-home-page.tsx:90` | 段位首页「对齐 CEFR B1+」 | 「对齐 CEFR B1+ · 中级+」+ 下一行 `LevelHint`(B1 的意思) | T5 |
| W17 | `web/src/features/library/catalog-view.tsx:63-68`(`feat/curated-cl-web`) | 精选「按级别筛选」芯片 `全部 A2 B1 B2` | 芯片文字 `B1 · 中级`;芯片行下 `LevelHint`(选「全部」时显示 `web.level.scale`) | T7(合并后) |
| W18 | `web/src/features/library/catalog-card.tsx` `lib-cat-level`(`feat/curated-cl-web`) | 精选卡片级别徽标 `B1` | `B1 · 中级` | T7(合并后) |
| W19 | `web/src/features/library/item-card.tsx`(`feat/curated-cl-web` Task 3,设计稿 `mockup.html:321` 的「精选 · B1」) | 「我的」里精选副本的级别徽标(**若**该任务实现了它) | 同 W19;若没有显示级别则不做 | T7(条件) |
| W20 | `web/src/features/wordbook/books-page.tsx:22-28`、`:114` | 词书难度条(1–6 格,`aria-label`「难度 3/6」)+ 说明「难度条按词书大致排序…」 | **不改**(不是 CEFR;是否改显示「约 B1」见开放问题 Q2) | — |
| M1 | `admin/src/features/catalog/catalog-detail.tsx:136` | 精选条目「级别」下拉(写死 `A1…C2`) | 选项 `B1 · 中级(能应对大多数日常场景)` | T6 |
| M2 | `admin/src/features/catalog/meta-fields.tsx:38` | 上传 / 导入对话框「级别」下拉(`state.levels`) | 同 M1 | T6 |
| M3 | `admin/src/features/catalog/catalog-page.tsx:147` | 精选列表「级别」列 `B1` | `B1 · 中级` | T6 |
| M4 | `admin/src/features/rooms/room-detail-page.tsx:132` | 房间详情「水平」行 `B1` | `B1 · 中级` | T6 |
| M5 | `admin/src/features/agents/persona-dialog.tsx:53` | 角色审核弹窗「等级」 `B1` | `B1 · 中级` | T6 |
| M6 | `admin/src/features/prompts/strings.ts:79` | 提示词占位符说明「等级(如 B1)」 | **不改**(给运营看的占位符文档) | — |
| M7 | `admin/src/features/rank/rules-schema.ts:46-47` | 段位规则 JSON 字段名 `cefr` | **不改**(原始 JSON 编辑器) | — |
| S1 | `server/app/rooms/rules.py:10`、`:12`、`:33` | 房间级别取值、段位 → CEFR 映射 | 不改(只是值) | — |
| S2 | `server/app/rank/tiers.py:21-27` | 段位 `cefr` 取值(含 `B1+` / `C1+`) | 不改;网页 `parseLevel` 支持 `+` | — |
| S3 | `server/app/agents/personas.py:20`、`server/app/models.py:252,824,1071` | 角色 / 房间 / 精选的 `level` 列 | 不改 | — |
| S4 | `server/app/wordbook/books.py:21-27` | 词书 `cefr`(不下发) | 不改(见 Q2) | — |
| S5 | `server/app/agents/prompt.py:26`、`rooms/assistant.py:97`、`rank/grading.py:42`、`web/src/features/chat/levels.ts:10-24` | 给 AI 的提示词里的「CEFR B1」 | 不改(不是用户界面) | — |

## 本计划的裁定

- **R-LV1 只改显示。** 所有取值(`<option value>`、单选回传值、请求体、URL、本机存储、`data-testid`)逐字不变;未知取值(`X1`、空、`auto`)原样显示、没有说明。
- **R-LV2 一套说法,沿用已上线的对话措辞。** 级别名:A1 入门 / Beginner、**A2 初级 / Elementary**、B1 中级 / Intermediate、B2 中高级 / Upper intermediate、C1 高级 / Advanced、C2 精通 / Proficient(A2–C1 与 `web.chat.levels` 逐字相同,A1 / C2 新增)。一句话说明(`meaning`):
  - A1 能听懂、会用最常用的词和简单句 / Understands and uses the most common words and simple sentences
  - A2 能进行简单的日常交流 / Handles simple everyday conversations
  - B1 能应对大多数日常场景 / Copes with most everyday situations
  - B2 能流利地讨论熟悉的话题 / Talks fluently about familiar topics
  - C1 能自如地表达复杂的想法 / Expresses complex ideas with ease
  - C2 接近母语,几乎没有障碍 / Near-native; almost no difficulty
  - 总说明(`scale`):「A1–C2 是国际通用的英语水平分级(CEFR),A1 最低,C2 最高。」/ "A1–C2 is the international scale of English levels (CEFR): A1 is the lowest, C2 the highest."
- **R-LV3 唯一来源。** 纯函数 `web/src/lib/levels.ts`:`CEFR_LEVELS`、`parseLevel(code)`(去空格、转大写,接受末尾 `+`)、`levelName(t, code)`(`中级`,带 `+` 时 `中级+`)、`levelLabel(t, code)`(`B1 · 中级`;未知 → 原文;空 → `""`)、`levelMeaning(t, code)`(`+` 用基础级别的说明)。组件 `web/src/components/level-hint.tsx`:`LevelHint({ code, fallback?, id?, testId?, className? })` 渲染一个 `block` 的 `<span>`(放在 `<label>` 里也合法),没有说明也没有 `fallback` 时不渲染。文案 `web.level.{name.A1–C2, meaning.A1–C2, scale}` 放急切的 `web/src/components/i18n/*.json`。
- **R-LV4 按空间选形态(手机优先,没有悬停):**
  - (a) 下拉选项、徽标、标题、副标题、系统消息:行内 `B1 · 中级`。
  - (b) 等宽分段控件(房间目标水平,5 段约 70 px 宽,行内会被截断):两行——代码在上、小字级别名在下,段高 32 → 44 px。
  - (c) 凡是**让用户选级别**的地方(下拉、分段、单选芯片、筛选芯片),控件旁有一行 `LevelHint` 写出选中级别的意思,用 `aria-describedby` 关联。
  - (d) **不用**悬停提示、长按提示或 ⓘ 弹层:手机上没有悬停,长按是隐藏手势、发现性差,而一行说明随选择即时变化、读屏可读(偏离 owner 给的「长按 / 点 i」备选,见「与请求的偏离」1)。
- **R-LV5 段位的 `+`。** `B1+` 显示 `B1+ · 中级+`,说明用 B1 的;不新增「中级以上」之类的第二种说法。
- **R-LV6 无障碍。** 级别名是可见文字(芯片 / 单选 / 选项的可访问名自然包含它);说明行经 `aria-describedby` 关联到下拉或单选组;`title` 不作为唯一说明;触控目标不缩小(分段从 32 px 视觉加高到 44 px,命中区本来就是 44 px)。
- **R-LV7 标签名不统一。** 「英语难度」「目标水平」「英文水平」「水平」「难度」「级别」「等级」这些**字段名**本计划不改(只标注取值);是否统一见开放问题 Q1。
- **R-LV8 管理后台自带中文表。** `admin/src/lib/levels.ts`(`LEVELS_ZH`、`levelText`、`levelLong`),测试用 `node:fs` 读网页 `web/src/components/i18n/zh-CN.json` 的 `web.level` 逐字比对(与 `web/src/features/rank/test-contract.ts` 读服务端契约文件的做法相同);admin 只有中文。
- **R-LV9 精选库在它的分支合并后再做(T7)。** 本计划其余任务都不碰 `web/src/features/library/**`;T7 开始前先确认 `feat/curated-cl-web` 已合并进 `main`,并按合并后的真实代码调整锚点。
- **R-LV10 不改服务端、不改提示词。** 服务端只下发代码;给 AI 的「CEFR B1」提示词保持英文原样。

## 与请求的偏离(写计划者的裁量,均可回退)

1. **不做长按 / 悬停 / ⓘ 弹层**(R-LV4 d):紧凑处用「两行字」或「控件旁一行说明」代替。若真机上说明行显得拥挤,备选是在芯片行末加一个 44 px 的「级别说明」按钮展开全表(未在本计划实现)。
2. **A2 叫「初级」而不是 owner 举例的「基础」**:已上线的对话措辞是「A2 · 初级」,统一沿用,避免两套说法(冲突 C1)。
3. **顶栏副标题与带我学条只显示 `B1 · 中级`,不显示整句说明**:这两处是一行的条,整句会被截断;说明在选级别的地方已经出现过。

## 现有说法的冲突(写计划时发现)

| 编号 | 冲突 | 处理 |
|---|---|---|
| C1 | owner 举例 A2 = 基础;对话已上线 A2 = 初级 | 用「初级」(R-LV2) |
| C2 | 字段名七种:英语难度(对话)、目标水平(房间)、英文水平(角色编辑)、水平(记忆页、邀请页、admin 房间)、难度(带我学)、级别(精选、admin 精选)、等级(admin 角色、admin 提示词) | 本计划不改(R-LV7,Q1) |
| C3 | 级别集合各不相同(对话 A2–C1 + 自动、房间 A1–C1、角色 A2–C1、记忆 / 精选 A1–C2、段位含 B1+ / C1+) | 集合不变;帮助函数覆盖六级 + `+` |
| C4 | `chat/levels.ts` 的 `levelHint()` 是 AI 提示词函数 | 新函数叫 `levelMeaning`,不重名 |
| C5 | 房间「目标水平」旁已有说明「影响助手的难度」 | 保留它(说的是这个设置的作用),新说明行说的是级别本身的意思 |

## 文件结构、车道与共享文件

```
web/src/lib/levels.ts(+ levels.test.ts)                               新(T1)
web/src/components/level-hint.tsx(+ level-hint.test.tsx)              新(T1)
web/src/components/i18n/{zh-CN,en}.json                                [改] +web.level(T1,唯一改它的任务)
web/src/lib/CLAUDE.md、web/src/components/CLAUDE.md                     [改](T1)
web/src/features/chat/{scenario-sheet,conversation-settings-sheet,conversation-page}.tsx、i18n/*.json   [改](T2)
web/src/features/chat/{conversation-settings-sheet,conversation-page,conversations-page}.test.tsx       [改](T2)
web/src/features/rooms/create/{settings-fields.tsx,settings-message.ts,i18n/*.json}(+ 两个测试)         [改](T3)
web/src/features/rooms/extras/{invite-page,summary-page}.tsx、invite-page.test.tsx                      [改](T3)
web/src/features/rooms/agents/persona-sheet.tsx(+ 测试)                                                 [改](T3)
web/src/features/agents/{persona-editor-sheet.tsx,locales/*.json}、memory/profile-tab.tsx、tutor/{tutor-bar,tutor-recap-card}.tsx(+ 测试)   [改](T4)
web/src/features/rank/rank-home-page.tsx(+ 测试)                                                        [改](T5)
admin/src/lib/levels.ts(+ 测试)新;admin/src/features/{catalog/catalog-detail,catalog/meta-fields,catalog/catalog-page,rooms/room-detail-page,agents/persona-dialog}.tsx、catalog-detail.test.tsx [改](T6)
web/src/features/library/{catalog-view,catalog-card}.tsx(+ catalog-view.test.tsx)、可能 item-card.tsx;docs/superpowers/plans/2026-10-14-curated-library-web.md(Addendum)   [改](T7,合并后)
web/README.md                                                                                           [改](T8)
docs/changelog/2026-10.json                                                                             [改](T9,控制者)
```

**车道(git worktree):**

| 车道 | 任务 | 说明 |
|---|---|---|
| 先行 | **T1** | 很小;其余任务都依赖它,先合并。 |
| C(chat) | **T2** | 只碰 `features/chat`。 |
| R(rooms) | **T3** | 只碰 `features/rooms`。 |
| A(agents) | **T4** | 只碰 `features/agents`。 |
| K(rank) | **T5** | 只碰 `features/rank`。 |
| M(admin) | **T6** | 只碰 `admin/`;测试读 T1 的 `zh-CN.json`,所以在 T1 合并后开始。 |
| L(library) | **T7** | **`feat/curated-cl-web` 合并进 `main` 且 T1 已合并后**才开始;只碰 `features/library` 与一份计划的 Addendum。 |
| 收尾 | **T8** | 全部合并后;`web/README.md` 与自检。 |
| 控制者 | **T9** | 合并、部署并核对后写更新日志草稿。 |

T2–T6 互不共享文件,可在 5 个工作树里**并行**;唯一共享的文件 `web/src/components/i18n/*.json` 只在 T1 里改。合并顺序:T1 → (T2 ∥ T3 ∥ T4 ∥ T5 ∥ T6) → T7(等精选库合并)→ T8 → T9。

---

## Task T1:`levels.ts` 纯函数 · `LevelHint` 组件 · 共享文案

**Files:** Create `web/src/lib/levels.ts`、`web/src/lib/levels.test.ts`、`web/src/components/level-hint.tsx`、`web/src/components/level-hint.test.tsx`;Modify `web/src/components/i18n/zh-CN.json`、`web/src/components/i18n/en.json`、`web/src/lib/CLAUDE.md`、`web/src/components/CLAUDE.md`。

- [ ] **Step 1(测试):** Write `web/src/lib/levels.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import i18n from "~/i18n";
import { CEFR_LEVELS, levelLabel, levelMeaning, levelName, parseLevel } from "./levels";

const zh = i18n.getFixedT("zh-CN");
const en = i18n.getFixedT("en");

describe("levels (plan 2026-10-14-level-annotations R-LV1..R-LV5)", () => {
  it("parses CEFR codes, tolerating case, spaces and one trailing plus", () => {
    expect(parseLevel("B1")).toEqual({ base: "B1", plus: false });
    expect(parseLevel(" b1+ ")).toEqual({ base: "B1", plus: true });
    for (const bad of ["", "auto", "B3", "X1", "B1++", null, undefined, 3]) expect(parseLevel(bad)).toBeNull();
  });

  it("reuses the chat wording for A2..C1 and adds A1 / C2, in both languages", () => {
    expect(CEFR_LEVELS.map((l) => levelLabel(zh, l))).toEqual(["A1 · 入门", "A2 · 初级", "B1 · 中级", "B2 · 中高级", "C1 · 高级", "C2 · 精通"]);
    expect(CEFR_LEVELS.map((l) => levelLabel(en, l))).toEqual([
      "A1 · Beginner", "A2 · Elementary", "B1 · Intermediate", "B2 · Upper intermediate", "C1 · Advanced", "C2 · Proficient",
    ]);
  });

  it("keeps a rank tier's plus and explains it with the base level", () => {
    expect(levelLabel(zh, "B1+")).toBe("B1+ · 中级+");
    expect(levelName(en, "c1+")).toBe("Advanced+");
    expect(levelMeaning(zh, "B1+")).toBe(levelMeaning(zh, "B1"));
  });

  it("gives one short meaning per level", () => {
    expect(levelMeaning(zh, "A2")).toBe("能进行简单的日常交流");
    expect(levelMeaning(zh, "B1")).toBe("能应对大多数日常场景");
    expect(levelMeaning(zh, "B2")).toBe("能流利地讨论熟悉的话题");
    expect(levelMeaning(en, "B1")).toBe("Copes with most everyday situations");
    for (const l of CEFR_LEVELS) {
      expect(levelMeaning(zh, l)).toBeTruthy();
      expect(levelMeaning(zh, l)).not.toContain("web.level");
      expect(levelMeaning(en, l)).not.toContain("web.level");
    }
  });

  it("never changes unknown values: raw text, no name, no meaning", () => {
    expect(levelLabel(zh, "X1")).toBe("X1");
    expect(levelLabel(zh, "")).toBe("");
    expect(levelLabel(zh, null)).toBe("");
    expect(levelName(zh, "auto")).toBeNull();
    expect(levelMeaning(zh, "auto")).toBeNull();
  });
});
```
- [ ] **Step 2(测试):** Write `web/src/components/level-hint.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "~/i18n";
import { LevelHint } from "./level-hint";

describe("LevelHint (plan 2026-10-14-level-annotations R-LV3, R-LV6)", () => {
  beforeEach(async () => { await i18n.changeLanguage("zh-CN"); });
  afterEach(async () => { await i18n.changeLanguage("en"); });

  it("shows the meaning of a known level as a block span with the given id", () => {
    render(<LevelHint code="B1" id="lv-hint" />);
    const el = screen.getByTestId("level-hint");
    expect(el.tagName).toBe("SPAN");
    expect(el).toHaveAttribute("id", "lv-hint");
    expect(el).toHaveTextContent("能应对大多数日常场景");
    expect(el.className).toMatch(/\bblock\b/);
  });

  it("uses the fallback for unknown or empty codes and renders nothing without one", () => {
    const { container } = render(<LevelHint code="auto" />);
    expect(container).toBeEmptyDOMElement();
    render(<LevelHint code={null} fallback="不选时按你的段位自动定。" testId="lv-fallback" />);
    expect(screen.getByTestId("lv-fallback")).toHaveTextContent("不选时按你的段位自动定。");
  });
});
```
- [ ] **Step 3:** Run `cd web && yarn vitest run src/lib/levels.test.ts src/components/level-hint.test.tsx` — 失败(模块不存在)。
- [ ] **Step 4:** Write `web/src/lib/levels.ts`:
```ts
import type { TFunction } from "i18next";

/**
 * CEFR 级别的显示文字(计划 2026-10-14-level-annotations R-LV1–R-LV5)。只管「给人看的字」:
 * 存储、提交、URL 里的值永远是原样的代码。`t` 由调用方传入(文案在 components/i18n 的 web.level.*)。
 * 注意:chat/levels.ts 的 levelHint() 是给 AI 的提示词,与这里无关。
 */
export const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export type CefrLevel = (typeof CEFR_LEVELS)[number];

export interface ParsedLevel { base: CefrLevel; plus: boolean }

const PATTERN = /^([ABC][12])(\+)?$/;

/** "B1" / " b1+ " → { base, plus };其他(含 "auto"、空、非字符串)→ null。 */
export function parseLevel(code: unknown): ParsedLevel | null {
  if (typeof code !== "string") return null;
  const m = PATTERN.exec(code.trim().toUpperCase());
  return m ? { base: m[1] as CefrLevel, plus: m[2] === "+" } : null;
}

/** 级别名:「中级」;段位的 "B1+" →「中级+」;未知 → null。 */
export function levelName(t: TFunction, code: unknown): string | null {
  const p = parseLevel(code);
  return p ? `${t(`web.level.name.${p.base}`)}${p.plus ? "+" : ""}` : null;
}

/** 行内标注:「B1 · 中级」;未知值原样(去首尾空格),空 / 非字符串 → ""。 */
export function levelLabel(t: TFunction, code: unknown): string {
  const p = parseLevel(code);
  if (!p) return typeof code === "string" ? code.trim() : "";
  return `${p.base}${p.plus ? "+" : ""} · ${levelName(t, code)}`;
}

/** 一句话说明(「能应对大多数日常场景」);带 + 的用基础级别的说明;未知 → null。 */
export function levelMeaning(t: TFunction, code: unknown): string | null {
  const p = parseLevel(code);
  return p ? t(`web.level.meaning.${p.base}`) : null;
}
```
- [ ] **Step 5:** Write `web/src/components/level-hint.tsx`:
```tsx
import { useTranslation } from "react-i18next";
import { cn } from "~/lib/cn";
import { levelMeaning } from "~/lib/levels";

export interface LevelHintProps {
  /** 级别代码(原样传入,如 "B1"、"B1+");未知 / 空 → 用 fallback */
  code?: string | null;
  /** 没有说明时显示的文字(如「不选时按你的段位自动定。」或 web.level.scale);不给就不渲染 */
  fallback?: string;
  /** 给 aria-describedby 用 */
  id?: string;
  testId?: string;
  className?: string;
}

/**
 * 「这个级别是什么意思」的一行说明(计划 2026-10-14-level-annotations R-LV4 c、R-LV6)。
 * 放在下拉 / 分段 / 芯片旁边,随选择变化;是 block 的 <span>,可以放进 <label>。无状态,不含自己的状态与交互。
 */
export function LevelHint({ code, fallback, id, testId = "level-hint", className }: LevelHintProps) {
  const { t } = useTranslation();
  const text = levelMeaning(t, code) ?? fallback;
  if (!text) return null;
  return (
    <span id={id} data-testid={testId} className={cn("block text-meta leading-[1.45] text-ink-2", className)}>
      {text}
    </span>
  );
}
```
- [ ] **Step 6:** Edit `web/src/components/i18n/zh-CN.json`:把单行 `  "web": {` 替换为下面两段(第二段是新的一行;`hold` 那一行不动):
```json
  "web": {
    "level": { "name": { "A1": "入门", "A2": "初级", "B1": "中级", "B2": "中高级", "C1": "高级", "C2": "精通" }, "meaning": { "A1": "能听懂、会用最常用的词和简单句", "A2": "能进行简单的日常交流", "B1": "能应对大多数日常场景", "B2": "能流利地讨论熟悉的话题", "C1": "能自如地表达复杂的想法", "C2": "接近母语,几乎没有障碍" }, "scale": "A1–C2 是国际通用的英语水平分级(CEFR),A1 最低,C2 最高。" },
```
  Edit `web/src/components/i18n/en.json` 同样(先 Read;锚点同为 `  "web": {`):
```json
  "web": {
    "level": { "name": { "A1": "Beginner", "A2": "Elementary", "B1": "Intermediate", "B2": "Upper intermediate", "C1": "Advanced", "C2": "Proficient" }, "meaning": { "A1": "Understands and uses the most common words and simple sentences", "A2": "Handles simple everyday conversations", "B1": "Copes with most everyday situations", "B2": "Talks fluently about familiar topics", "C1": "Expresses complex ideas with ease", "C2": "Near-native; almost no difficulty" }, "scale": "A1–C2 is the international scale of English levels (CEFR): A1 is the lowest, C2 the highest." },
```
- [ ] **Step 7:** Edit `web/src/lib/CLAUDE.md`:在以 `` - `hold-gesture.ts` `` 开头的那一行之后插入一行:
  `` - `levels.ts` — CEFR display text (plan `2026-10-14-level-annotations`): `parseLevel` (accepts a trailing `+` for rank tiers), `levelName` / `levelLabel` (`B1 · 中级`) / `levelMeaning` (one-line meaning); `t` is passed in, strings are `web.level.*` in `components/i18n`. Display only: stored and sent values never change. Not the same as `features/chat/levels.ts::levelHint` (AI prompt text). ``
  Edit `web/src/components/CLAUDE.md`:在以 `` - `zh-toggle.tsx` `` 开头的那一行之后插入一行:
  `` - `level-hint.tsx` — `LevelHint`: one-line meaning of a CEFR level (block `<span>`, safe inside `<label>`), shown next to every level picker and linked with `aria-describedby`; `fallback` when the code is unknown/empty. Strings `web.level.*` live in `components/i18n` (plan `2026-10-14-level-annotations`). ``
- [ ] **Step 8:** Run `cd web && yarn vitest run src/lib/levels.test.ts src/components/level-hint.test.tsx src/i18n/i18n.test.ts src/architecture.test.ts && cd .. && yarn web:typecheck` — 全绿。若 `getFixedT` 的返回类型与 `TFunction` 不兼容导致 typecheck 失败,测试里改用 `const zh = ((k: string) => i18n.t(k, { lng: "zh-CN" })) as unknown as TFunction;`(`import type { TFunction } from "i18next";`),**不要**放宽 `levels.ts` 的参数类型。
- [ ] **Step 9:** Commit `feat(web): shared CEFR level labels and meaning hint`。

---

## Task T2:对话的级别(车道 C,依赖 T1)

**Files:** Modify `web/src/features/chat/scenario-sheet.tsx`、`web/src/features/chat/conversation-settings-sheet.tsx`、`web/src/features/chat/conversation-page.tsx`、`web/src/features/chat/i18n/zh-CN.json`、`web/src/features/chat/i18n/en.json`、`web/src/features/chat/conversation-settings-sheet.test.tsx`、`web/src/features/chat/conversation-page.test.tsx`、`web/src/features/chat/conversations-page.test.tsx`。

- [ ] **Step 1(测试):** Edit `web/src/features/chat/conversation-settings-sheet.test.tsx`:在单行 `  it("shows a stored auto-read off and level", () => {` **之前**插入:
```tsx
  it("labels the levels and explains the chosen one under the select (plan 2026-10-14-level-annotations W2)", async () => {
    render(<ConversationSettingsSheet open onOpenChange={vi.fn()} ai={null} onSave={vi.fn()} config={{ ...base }} />);
    expect(screen.queryByTestId("settings-level-hint")).toBeNull(); // auto 没有说明
    expect(screen.getByRole("option", { name: "B1 · Intermediate" })).toHaveAttribute("value", "B1");
    expect(screen.getByRole("option", { name: "Auto (no limit)" })).toHaveAttribute("value", "auto");
    await userEvent.selectOptions(screen.getByTestId("settings-level"), "B1");
    expect(screen.getByTestId("settings-level-hint")).toHaveTextContent("Copes with most everyday situations");
    expect(screen.getByTestId("settings-level")).toHaveAttribute("aria-describedby", "settings-level-hint");
  });

```
  Edit `web/src/features/chat/conversation-page.test.tsx`:单行 `      expect(screen.getByTestId("conversation-level")).toHaveTextContent("B1");` → `      expect(screen.getByTestId("conversation-level")).toHaveTextContent("B1 · Intermediate");`。
  Edit `web/src/features/chat/conversations-page.test.tsx`:单行 `    await userEvent.selectOptions(screen.getByTestId("scenario-level"), "B1");` → 该行 + 新的一行:
```tsx
    await userEvent.selectOptions(screen.getByTestId("scenario-level"), "B1");
    expect(screen.getByTestId("scenario-level-hint")).toHaveTextContent("Copes with most everyday situations");
```
- [ ] **Step 2:** Run `cd web && yarn vitest run src/features/chat/conversation-settings-sheet.test.tsx src/features/chat/conversations-page.test.tsx` — 新断言失败。
- [ ] **Step 3:** Edit `web/src/features/chat/scenario-sheet.tsx`:
  1. 单行 `import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "~/components/bottom-sheet";` → 该行 + `import { LevelHint } from "~/components/level-hint";` + `import { levelLabel } from "~/lib/levels";`(各占一行)。
  2. 单行 `              <select data-testid="scenario-level" className={selectClass} value={level} disabled={busy}` → `              <select data-testid="scenario-level" aria-describedby="scenario-level-hint" className={selectClass} value={level} disabled={busy}`。
  3. **两行锚点**(第 117–118 行):
```tsx
                {LEVELS.map((l) => <option key={l} value={l}>{t(`web.chat.levels.${l}`)}</option>)}
              </select>
```
  替换为:
```tsx
                {LEVELS.map((l) => <option key={l} value={l}>{l === "auto" ? t("web.chat.levels.auto") : levelLabel(t, l)}</option>)}
              </select>
              <LevelHint code={level} id="scenario-level-hint" testId="scenario-level-hint" />
```
- [ ] **Step 4:** Edit `web/src/features/chat/conversation-settings-sheet.tsx`:
  1. 单行 `import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "~/components/bottom-sheet";` → 该行 + `import { LevelHint } from "~/components/level-hint";` + `import { levelLabel } from "~/lib/levels";`。
  2. 单行 `              <select data-testid="settings-level" className={selectClass} value={normalizeLevel(draft.level)}` → `              <select data-testid="settings-level" aria-describedby="settings-level-hint" className={selectClass} value={normalizeLevel(draft.level)}`。
  3. 单行 `                {LEVELS.map((l) => <option key={l} value={l}>{t(`web.chat.levels.${l}`)}</option>)}` → `                {LEVELS.map((l) => <option key={l} value={l}>{l === "auto" ? t("web.chat.levels.auto") : levelLabel(t, l)}</option>)}`。
  4. 单行 `              <span className={hintClass}>{t("web.chat.settingsForm.levelHint")}</span>` → 下面两行:
```tsx
              <LevelHint code={normalizeLevel(draft.level)} id="settings-level-hint" testId="settings-level-hint" />
              <span className={hintClass}>{t("web.chat.settingsForm.levelHint")}</span>
```
- [ ] **Step 5:** Edit `web/src/features/chat/conversation-page.tsx`:
  1. 单行 `import { cn } from "~/lib/cn";` → 该行 + `import { levelLabel } from "~/lib/levels";`。
  2. 单行 `      {options.level !== "auto" && <> · <span data-testid="conversation-level">{options.level}</span></>}` → `      {options.level !== "auto" && <> · <span data-testid="conversation-level">{levelLabel(t, options.level)}</span></>}`。
- [ ] **Step 6:** Edit `web/src/features/chat/i18n/zh-CN.json`:单行 `      "levels": { "auto": "自动(不限制)", "A2": "A2 · 初级", "B1": "B1 · 中级", "B2": "B2 · 中高级", "C1": "C1 · 高级" },` → `      "levels": { "auto": "自动(不限制)" },`。Edit `web/src/features/chat/i18n/en.json`:单行 `      "levels": { "auto": "Auto (no limit)", "A2": "A2 · Elementary", "B1": "B1 · Intermediate", "B2": "B2 · Upper intermediate", "C1": "C1 · Advanced" },` → `      "levels": { "auto": "Auto (no limit)" },`。
- [ ] **Step 7:** 自检:Grep `web.chat.levels` 在 `web/src` 与 `web/e2e` 下只允许出现 `web.chat.levels.auto`。
- [ ] **Step 8:** Run `cd web && yarn vitest run src/features/chat/conversation-settings-sheet.test.tsx src/features/chat/conversations-page.test.tsx src/features/chat/conversation-page.test.tsx src/i18n/i18n.test.ts src/architecture.test.ts && cd .. && yarn web:typecheck` — 全绿(`conversation-page.test.tsx` 很大,只为那一行断言跑它)。
- [ ] **Step 9:** Commit `feat(web): explain the chosen English level in chat settings`。

---

## Task T3:联机房间的级别(车道 R,依赖 T1)

**Files:** Modify `web/src/features/rooms/create/settings-fields.tsx`、`web/src/features/rooms/create/settings-fields.test.tsx`、`web/src/features/rooms/create/settings-message.ts`、`web/src/features/rooms/create/settings-message.test.ts`、`web/src/features/rooms/create/i18n/zh-CN.json`、`web/src/features/rooms/create/i18n/en.json`、`web/src/features/rooms/extras/invite-page.tsx`、`web/src/features/rooms/extras/invite-page.test.tsx`、`web/src/features/rooms/extras/summary-page.tsx`、`web/src/features/rooms/agents/persona-sheet.tsx`、`web/src/features/rooms/agents/persona-sheet.test.tsx`。

- [ ] **Step 1(测试):** Edit `web/src/features/rooms/create/settings-fields.test.tsx`:
  1. 单行 `    fireEvent.click(screen.getByRole("radio", { name: "B2" }));` → `    fireEvent.click(screen.getByRole("radio", { name: /^B2/ }));`(段内现在是「B2」+「中高级」两行)。
  2. 在单行 `  it("does not go below the current member count when editing", () => {` **之前**插入:
```tsx
  it("shows each target level with its name and says what happens when none is picked (plan 2026-10-14-level-annotations W5)", () => {
    const onChange = vi.fn();
    renderWithProviders(<SettingsFields value={{ scenario: "free" }} onChange={onChange} config={CONFIG} mode="create" namePlaceholder="" minMembers={2} />);
    const b1 = screen.getByRole("radio", { name: /^B1/ });
    expect(b1.textContent).toBe("B1中级");
    expect(screen.getByRole("radio", { name: /^A1/ }).textContent).toBe("A1入门");
    expect(screen.getByTestId("room-level")).toHaveAttribute("aria-describedby", "room-level-hint");
    expect(screen.getByTestId("room-level-hint")).toHaveTextContent("不选时按你的段位自动定。");
    fireEvent.click(b1);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ level: "B1" }));
  });

  it("explains the chosen target level", () => {
    renderWithProviders(<SettingsFields value={{ scenario: "free", level: "B2" }} onChange={vi.fn()} config={CONFIG} mode="edit" namePlaceholder="" minMembers={2} />);
    expect(screen.getByRole("radio", { name: /^B2/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("room-level-hint")).toHaveTextContent("能流利地讨论熟悉的话题");
  });

```
  Edit `web/src/features/rooms/create/settings-message.test.ts`:在单行 `  it("returns null when nothing is recognised", () => {` **之前**插入:
```ts
  it("names the target level in the change message (plan 2026-10-14-level-annotations W6)", async () => {
    await i18n.changeLanguage("zh-CN");
    expect(describeSettingsChanges(i18n.t, { changes: [{ field: "level", value: "B1" }] }, SCENARIOS, "zh-CN")).toBe("房主把目标水平改为 B1 · 中级");
    expect(describeSettingsChanges(i18n.t, { changes: [{ field: "level", value: "Z9" }] }, SCENARIOS, "zh-CN")).toBe("房主把目标水平改为 Z9");
  });

```
  Edit `web/src/features/rooms/extras/invite-page.test.tsx`:单行 `    expect(screen.getByText(/A2/)).toBeTruthy();` → `    expect(screen.getByText("水平 A2 · 初级")).toBeTruthy();`。
  Edit `web/src/features/rooms/agents/persona-sheet.test.tsx`:单行 `  expect(screen.getByText("友好")).toBeInTheDocument();` → 该行 + `  expect(screen.getByText("B1 · 中级")).toBeInTheDocument();`(`EMMA.level` 是 `B1`)。
- [ ] **Step 2:** Run `cd web && yarn vitest run src/features/rooms/create/settings-fields.test.tsx src/features/rooms/create/settings-message.test.ts src/features/rooms/extras/invite-page.test.tsx src/features/rooms/agents/persona-sheet.test.tsx` — 新断言失败。
- [ ] **Step 3:** Edit `web/src/features/rooms/create/i18n/zh-CN.json`:单行 `          "levelHint": "影响助手的难度",` → 该行 + `          "levelAuto": "不选时按你的段位自动定。",`。Edit `.../en.json`:单行 `          "levelHint": "Sets the assistant's difficulty",` → 该行 + `          "levelAuto": "If you skip this, it follows your rank tier.",`。
- [ ] **Step 4:** Edit `web/src/features/rooms/create/settings-fields.tsx`(全部单行锚点):
  1. `import { cn } from "~/lib/cn";` → 该行 + `import { LevelHint } from "~/components/level-hint";` + `import { levelName } from "~/lib/levels";`。
  2. `function Segments<T extends string>({ labelledBy, value, options, onChange, disabled, testId }: {` → `function Segments<T extends string>({ labelledBy, describedBy, value, options, onChange, disabled, testId }: {`。
  3. `  labelledBy: string; value: T | undefined; options: readonly { value: T; label: string }[]; onChange(v: T): void; disabled?: boolean; testId?: string;` → `  labelledBy: string; describedBy?: string; value: T | undefined; options: readonly { value: T; label: string; sub?: string }[]; onChange(v: T): void; disabled?: boolean; testId?: string;`。
  4. `    <div role="radiogroup" aria-labelledby={labelledBy} data-testid={testId} aria-disabled={disabled || undefined}` → `    <div role="radiogroup" aria-labelledby={labelledBy} aria-describedby={describedBy} data-testid={testId} aria-disabled={disabled || undefined}`。
  5. `            className={cn("hit-expand flex h-8 min-w-0 flex-1 items-center justify-center rounded-lg px-1 text-sub font-semibold transition-colors duration-fast",` → `            className={cn("hit-expand flex min-w-0 flex-1 items-center justify-center rounded-lg px-1 text-sub font-semibold transition-colors duration-fast",`。
  6. `              on ? "bg-seg-on text-ink shadow-seg" : "text-ink-2")}>` → `              on ? "bg-seg-on text-ink shadow-seg" : "text-ink-2", o.sub ? "h-11" : "h-8")}>`。
  7. `            <span className="truncate">{o.label}</span>` → 
```tsx
            {o.sub ? (
              <span className="flex min-w-0 flex-col items-center leading-tight">
                <span className="truncate">{o.label}</span>
                <span className="truncate text-meta font-medium text-ink-2">{o.sub}</span>
              </span>
            ) : <span className="truncate">{o.label}</span>}
```
  8. `      <Segments labelledBy="room-level-label" testId="room-level" value={value.level} disabled={disabled}` → `      <Segments labelledBy="room-level-label" describedBy="room-level-hint" testId="room-level" value={value.level} disabled={disabled}`。
  9. `        options={levels.map((l) => ({ value: l, label: l }))} onChange={(level) => set({ level })} />` → 下面两行:
```tsx
        options={levels.map((l) => ({ value: l, label: l, sub: levelName(t, l) ?? undefined }))} onChange={(level) => set({ level })} />
      <LevelHint code={value.level} fallback={t("web.rooms.v2.create.levelAuto")} id="room-level-hint" testId="room-level-hint" className="mx-0.5 mt-1.5" />
```
  (加入方式那组 `Segments` 不传 `sub`,仍是 32 px 单行,DOM 与改动前相同。文件头注释里「每段等宽 32 高」后补一句「带 sub 的段 44 高、两行」。)
- [ ] **Step 5:** Edit `web/src/features/rooms/create/settings-message.ts`:
  1. `import { scenarioTitle } from "./scenario-picker";` → `import { levelLabel } from "~/lib/levels";` + 该行(`~/` 导入放前面)。
  2. `      const value = field === "scenario" ? scenarioTitle(scenarios, String(c.value), language) : String(c.value);` → `      const value = field === "scenario" ? scenarioTitle(scenarios, String(c.value), language) : field === "level" ? levelLabel(t, String(c.value)) : String(c.value);`。
- [ ] **Step 6:** Edit `web/src/features/rooms/extras/invite-page.tsx`:
  1. `import { cn } from "~/lib/cn";` → 该行 + `import { levelLabel } from "~/lib/levels";`。
  2. `                <span className={cn(badge, "bg-surface-2 text-ink-2")}>{t("web.rooms.extras.invite.level", { level: load.invite.level })}</span>` → `                <span className={cn(badge, "bg-surface-2 text-ink-2")}>{t("web.rooms.extras.invite.level", { level: levelLabel(t, load.invite.level) })}</span>`。
- [ ] **Step 7:** Edit `web/src/features/rooms/extras/summary-page.tsx`:
  1. `import { cn } from "~/lib/cn";` → 该行 + `import { levelLabel } from "~/lib/levels";`。
  2. `            <span className={cn(badge, "bg-blue-tint text-blue")}>{[scenarioName, room.level].filter(Boolean).join(" · ")}</span>` → `            <span className={cn(badge, "bg-blue-tint text-blue")}>{[scenarioName, room.level ? levelLabel(t, room.level) : null].filter(Boolean).join(" · ")}</span>`。
- [ ] **Step 8:** Edit `web/src/features/rooms/agents/persona-sheet.tsx`:
  1. `import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "~/components/bottom-sheet";` → 该行 + `import { levelLabel } from "~/lib/levels";`。
  2. `          <span className={chip}>{current.level}</span>` → `          <span className={chip}>{levelLabel(t, current.level)}</span>`。
- [ ] **Step 9:** Run `cd web && yarn vitest run src/features/rooms/create src/features/rooms/extras/invite-page.test.tsx src/features/rooms/extras/summary-page.test.tsx src/features/rooms/agents/persona-sheet.test.tsx src/features/rooms/room-settings-sheet.test.tsx src/i18n/i18n.test.ts src/architecture.test.ts && cd .. && yarn web:typecheck` — 全绿。若 `room-settings-sheet.test.tsx` / `rooms-lobby-page.test.tsx` 有按级别名精确点选的断言,改成 `/^B1/` 这样的前缀匹配(写计划时 Grep 没有找到)。
- [ ] **Step 10:** Commit `feat(web): name and explain room target levels`。

---

## Task T4:智能体的级别(车道 A,依赖 T1)

**Files:** Modify `web/src/features/agents/persona-editor-sheet.tsx`、`web/src/features/agents/persona-editor-sheet.test.tsx`、`web/src/features/agents/memory/profile-tab.tsx`、`web/src/features/agents/memory/profile-tab.test.tsx`、`web/src/features/agents/tutor/tutor-bar.tsx`、`web/src/features/agents/tutor/tutor-bar.test.tsx`、`web/src/features/agents/tutor/tutor-recap-card.tsx`、`web/src/features/agents/tutor/tutor-recap-card.test.tsx`、`web/src/features/agents/locales/zh-CN.json`、`web/src/features/agents/locales/en.json`。

- [ ] **Step 1(测试):** Edit `web/src/features/agents/persona-editor-sheet.test.tsx`:在单行 `  it("tries a line without saving and shows the reply; a 404 hides trying for good", async () => {` **之前**插入:
```tsx
  it("labels the level chips and explains the chosen level (plan 2026-10-14-level-annotations W10)", async () => {
    setup({}, MINE);
    expect(await screen.findByTestId("agent-editor-level-B1")).toHaveTextContent("B1 · Intermediate");
    expect(screen.getByTestId("agent-editor-level-hint")).toHaveTextContent("Copes with most everyday situations");
    await userEvent.click(screen.getByTestId("agent-editor-level-B2"));
    expect(screen.getByTestId("agent-editor-level-B2")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("agent-editor-level-hint")).toHaveTextContent("Talks fluently about familiar topics");
  });

```
  Edit `web/src/features/agents/memory/profile-tab.test.tsx`:
  1. 单行 `    expect(card).toHaveTextContent("智能体建议把「水平」改成 B2");` → `    expect(card).toHaveTextContent("智能体建议把「水平」改成 B2 · 中高级");`。
  2. 单行 `    expect(screen.getByText("你改过")).toBeTruthy();` → 该行 + 下面两行:
```tsx
    expect(screen.getByRole("option", { name: "B1 · 中级" })).toHaveAttribute("value", "B1");
    expect(screen.getByTestId("profile-level-hint")).toHaveTextContent("能应对大多数日常场景");
```
  Edit `web/src/features/agents/tutor/tutor-bar.test.tsx`:单行 `  expect(screen.getByTestId("tutor-bar")).toHaveTextContent("B1");` → `  expect(screen.getByTestId("tutor-bar")).toHaveTextContent("B1 · 中级");`。
  Edit `web/src/features/agents/tutor/tutor-recap-card.test.tsx`:单行 `  expect(screen.getByTestId("tutor-recap")).toHaveTextContent("难度 B1 → B2");` → `  expect(screen.getByTestId("tutor-recap")).toHaveTextContent("难度 B1 · 中级 → B2 · 中高级");`。
- [ ] **Step 2:** Run `cd web && yarn vitest run src/features/agents/persona-editor-sheet.test.tsx src/features/agents/memory/profile-tab.test.tsx src/features/agents/tutor/tutor-bar.test.tsx src/features/agents/tutor/tutor-recap-card.test.tsx` — 新断言失败。
- [ ] **Step 3:** Edit `web/src/features/agents/persona-editor-sheet.tsx`:
  1. `import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "~/components/bottom-sheet";` → 该行 + `import { LevelHint } from "~/components/level-hint";`;`import { cn } from "~/lib/cn";` → 该行 + `import { levelLabel } from "~/lib/levels";`。
  2. `          <span className={labelClass} id={`${uid}-level`}>{t("web.agents.editor.level")}</span>` → 下面三行(`labelClass` 是 `flex justify-between`:左边标题,右边说明):
```tsx
          <span className={labelClass}>
            <span id={`${uid}-level`}>{t("web.agents.editor.level")}</span>
            <LevelHint code={draft.level} id={`${uid}-level-hint`} testId="agent-editor-level-hint" className="text-right" />
          </span>
```
  3. `          <div role="radiogroup" aria-labelledby={`${uid}-level`} className="flex flex-wrap gap-1.5">` → `          <div role="radiogroup" aria-labelledby={`${uid}-level`} aria-describedby={`${uid}-level-hint`} className="flex flex-wrap gap-1.5">`。
  4. `                className={chipClass(draft.level === level)} onClick={() => setDraft({ ...draft, level })}>{level}</button>` → `                className={chipClass(draft.level === level)} onClick={() => setDraft({ ...draft, level })}>{levelLabel(t, level)}</button>`。
- [ ] **Step 4:** Edit `web/src/features/agents/memory/profile-tab.tsx`:
  1. `import { SurfaceCard } from "~/components/surface-card";` → `import { LevelHint } from "~/components/level-hint";` + 该行;`import { ToneBadge } from "~/components/tone-badge";` → 该行 + `import { levelLabel } from "~/lib/levels";`。
  2. `    key === "correction" ? t(`${P}.corrections.${String(value)}`) : Array.isArray(value) ? value.join(", ") : String(value);` → `    key === "correction" ? t(`${P}.corrections.${String(value)}`) : key === "level" ? levelLabel(t, value) : Array.isArray(value) ? value.join(", ") : String(value);`。
  3. **六行锚点**(第 101–106 行,Read 确认;写计划时该文件是 LF 换行):
```tsx
        {field("level", (
          <select className={FIELD} value={draft.level} onChange={set("level")}>
            <option value="">{t(`${P}.unset`)}</option>
            {LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}
          </select>
        ))}
```
  整块替换为(`field()` 的第二个参数从单个 `<select>` 变成片段):
```tsx
        {field("level", (
          <>
            <select className={FIELD} value={draft.level} onChange={set("level")} aria-describedby="profile-level-hint">
              <option value="">{t(`${P}.unset`)}</option>
              {LEVELS.map((level) => <option key={level} value={level}>{levelLabel(t, level)}</option>)}
            </select>
            <LevelHint code={draft.level} fallback={t("web.level.scale")} id="profile-level-hint" testId="profile-level-hint" className="mt-1" />
          </>
        ))}
```
- [ ] **Step 5:** Edit `web/src/features/agents/tutor/tutor-bar.tsx`:
  1. `import { ZhNoteFold } from "~/components/zh-note-fold";` → 该行 + `import { levelLabel } from "~/lib/levels";`。
  2. `        <span className="ml-auto whitespace-nowrap text-meta text-ink-2" title={t("web.agents.tutor.bar.level", { level: session.level })}>{session.level}</span>` → `        <span className="ml-auto whitespace-nowrap text-meta text-ink-2" title={t("web.agents.tutor.bar.level", { level: session.level })}>{levelLabel(t, session.level)}</span>`。
- [ ] **Step 6:** Edit `web/src/features/agents/tutor/tutor-recap-card.tsx`:
  1. `import { MAX_WORD_TARGET } from "~/lib/extension-points";` → 该行 + `import { levelLabel } from "~/lib/levels";`。
  2. `        <p className="mt-2 text-sub text-ink">{t("web.agents.tutor.recap.level", { from: recap.levelStart, to: recap.levelEnd })}</p>` → `        <p className="mt-2 text-sub text-ink">{t("web.agents.tutor.recap.level", { from: levelLabel(t, recap.levelStart), to: levelLabel(t, recap.levelEnd) })}</p>`。
- [ ] **Step 7:** Edit `web/src/features/agents/locales/zh-CN.json` 第 141 行(先 Read 取整行):把其中的 `自动 = 角色水平 A2 / B1 时附上。` 改为 `自动 = 角色水平 A2(初级)/ B1(中级)时附上。`;`en.json` 第 141 行:`Auto = for A2 / B1 personas.` → `Auto = for A2 (Elementary) / B1 (Intermediate) personas.`。
- [ ] **Step 8:** Run `cd web && yarn vitest run src/features/agents/persona-editor-sheet.test.tsx src/features/agents/memory src/features/agents/tutor src/features/agents/locales.test.ts src/architecture.test.ts && cd .. && yarn web:typecheck` — 全绿(`locales.test.ts` 若不存在就从命令里去掉;`i18n.test.ts` 不覆盖懒加载的 `locales/`)。
- [ ] **Step 9:** Commit `feat(web): name agent and tutor levels`。

---

## Task T5:段位首页的 CEFR 说明(车道 K,依赖 T1)

**Files:** Modify `web/src/features/rank/rank-home-page.tsx`、`web/src/features/rank/rank-home-page.test.tsx`。

- [ ] **Step 1(测试):** Edit `web/src/features/rank/rank-home-page.test.tsx`:在单行 `  it("links unfinished stage tasks to their practice page", async () => {` **之前**插入:
```tsx
  it("names and explains the tier's CEFR level (plan 2026-10-14-level-annotations W16)", async () => {
    const tiers = [...CONTRACT.config.tiers, { key: "gold", index: 2, cefr: "B1+", divisions: 3, division_rp: 120 }];
    setup(CONTRACT.me, undefined, { ...CONTRACT.config, tiers });
    expect(await screen.findByTestId("rank-cefr")).toHaveTextContent("对齐 CEFR B1+ · 中级+");
    expect(screen.getByTestId("rank-cefr-hint")).toHaveTextContent("能应对大多数日常场景");
  });

```
  (契约样例 `server/tests/fixtures/rank_contract.json` 只有 bronze 一档,而 `me.tier` 是 gold,所以现有用例里这一行不出现;这里补上 gold。)
- [ ] **Step 2:** Run `cd web && yarn vitest run src/features/rank/rank-home-page.test.tsx` — 新用例失败。
- [ ] **Step 3:** Edit `web/src/features/rank/rank-home-page.tsx`:
  1. `import { FeatureGate, type GateState } from "~/components/feature-gate";` → 该行 + `import { LevelHint } from "~/components/level-hint";`;`import { PageHeader } from "~/layout/page-header";` → 该行 + `import { levelLabel } from "~/lib/levels";`。
  2. `              {cefr && <p className="mt-0.5 text-meta text-ink-2">{t("web.rank.cefr", { level: cefr })}</p>}` → 下面两行:
```tsx
              {cefr && <p data-testid="rank-cefr" className="mt-0.5 text-meta text-ink-2">{t("web.rank.cefr", { level: levelLabel(t, cefr) })}</p>}
              {cefr && <LevelHint code={cefr} testId="rank-cefr-hint" className="mt-0.5 max-w-[260px]" />}
```
- [ ] **Step 4:** Run `cd web && yarn vitest run src/features/rank/rank-home-page.test.tsx src/architecture.test.ts && cd .. && yarn web:typecheck` — 全绿。
- [ ] **Step 5:** Commit `feat(web): explain the CEFR level on the rank home`。

---

## Task T6:管理后台的级别(车道 M,依赖 T1 已合并)

**Files:** Create `admin/src/lib/levels.ts`、`admin/src/lib/levels.test.ts`;Modify `admin/src/features/catalog/catalog-detail.tsx`、`admin/src/features/catalog/catalog-detail.test.tsx`、`admin/src/features/catalog/meta-fields.tsx`、`admin/src/features/catalog/catalog-page.tsx`、`admin/src/features/rooms/room-detail-page.tsx`、`admin/src/features/agents/persona-dialog.tsx`。

- [ ] **Step 1(测试):** Write `admin/src/lib/levels.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LEVELS_ZH, levelLong, levelText } from "./levels";

type WebLevel = { name: Record<string, string>; meaning: Record<string, string> };
const webZh = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../web/src/components/i18n/zh-CN.json", import.meta.url)), "utf8"),
) as { web: { level: WebLevel } };

describe("admin levels (plan 2026-10-14-level-annotations R-LV8)", () => {
  it("uses exactly the web app's Chinese wording", () => {
    expect(Object.keys(LEVELS_ZH)).toEqual(Object.keys(webZh.web.level.name));
    for (const [code, v] of Object.entries(LEVELS_ZH)) {
      expect(v.name).toBe(webZh.web.level.name[code]);
      expect(v.meaning).toBe(webZh.web.level.meaning[code]);
    }
  });

  it("formats known codes and leaves the rest alone", () => {
    expect(levelText("B1")).toBe("B1 · 中级");
    expect(levelText("b2")).toBe("B2 · 中高级");
    expect(levelLong("A2")).toBe("A2 · 初级(能进行简单的日常交流)");
    expect(levelText("X1")).toBe("X1");
    expect(levelText(null)).toBe("");
    expect(levelLong("")).toBe("");
  });
});
```
  Edit `admin/src/features/catalog/catalog-detail.test.tsx`:单行 `    expect(document.querySelector("audio")?.getAttribute("src")).toBe(api.mediaUrl(ID));` → 该行 + `    expect(screen.getByRole("option", { name: "B1 · 中级(能应对大多数日常场景)" })).toHaveAttribute("value", "B1");`。
- [ ] **Step 2:** Run `cd admin && yarn vitest run src/lib/levels.test.ts src/features/catalog/catalog-detail.test.tsx` — 失败。
- [ ] **Step 3:** Write `admin/src/lib/levels.ts`:
```ts
/**
 * CEFR 级别的中文说明(计划 2026-10-14-level-annotations R-LV8)。管理后台不能导入网页代码,所以自带一份;
 * 必须与 web/src/components/i18n/zh-CN.json 的 web.level 逐字一致(levels.test.ts 读那个文件比对)。
 * 只用于显示:存储与提交的值不变。
 */
export const LEVELS_ZH: Record<string, { name: string; meaning: string }> = {
  A1: { name: "入门", meaning: "能听懂、会用最常用的词和简单句" },
  A2: { name: "初级", meaning: "能进行简单的日常交流" },
  B1: { name: "中级", meaning: "能应对大多数日常场景" },
  B2: { name: "中高级", meaning: "能流利地讨论熟悉的话题" },
  C1: { name: "高级", meaning: "能自如地表达复杂的想法" },
  C2: { name: "精通", meaning: "接近母语,几乎没有障碍" },
};

function parse(code: string | null | undefined): { base: string; plus: boolean } | null {
  const m = /^([ABC][12])(\+)?$/.exec((code ?? "").trim().toUpperCase());
  return m ? { base: m[1], plus: m[2] === "+" } : null;
}

/** 「B1 · 中级」;未知原样,空 → ""。 */
export function levelText(code: string | null | undefined): string {
  const p = parse(code);
  if (!p) return (code ?? "").trim();
  return `${p.base}${p.plus ? "+" : ""} · ${LEVELS_ZH[p.base].name}${p.plus ? "+" : ""}`;
}

/** 「B1 · 中级(能应对大多数日常场景)」,用于下拉选项;未知同 levelText。 */
export function levelLong(code: string | null | undefined): string {
  const p = parse(code);
  return p ? `${levelText(code)}(${LEVELS_ZH[p.base].meaning})` : levelText(code);
}
```
- [ ] **Step 4:** Edit 五个页面(全部单行锚点;导入加在各文件最后一个 `../../lib/` 或 `./strings` 导入行之后):
  1. `admin/src/features/catalog/catalog-detail.tsx`:`import { S, errorText } from "./strings";` → `import { levelLong } from "../../lib/levels";` + 该行;`            {["A1", "A2", "B1", "B2", "C1", "C2"].map((l) => <option key={l} value={l}>{l}</option>)}` → `            {["A1", "A2", "B1", "B2", "C1", "C2"].map((l) => <option key={l} value={l}>{levelLong(l)}</option>)}`。
  2. `admin/src/features/catalog/meta-fields.tsx`:`import { S } from "./strings";` → `import { levelLong } from "../../lib/levels";` + 该行;`            {state.levels.map((l) => <option key={l} value={l}>{l}</option>)}` → `            {state.levels.map((l) => <option key={l} value={l}>{levelLong(l)}</option>)}`。
  3. `admin/src/features/catalog/catalog-page.tsx`:`import { formatDuration } from "../../lib/format";` → 该行 + `import { levelText } from "../../lib/levels";`;`    { key: "level", header: S.cols.level, render: (r) => r.level ?? "—" },` → `    { key: "level", header: S.cols.level, render: (r) => (r.level ? levelText(r.level) : "—") },`。
  4. `admin/src/features/rooms/room-detail-page.tsx`:`import { formatDateTime } from "../../lib/format";` → 该行 + `import { levelText } from "../../lib/levels";`;`        <SettingRow id="level" label={ST.level} value={s.level} />` → `        <SettingRow id="level" label={ST.level} value={levelText(s.level)} />`。
  5. `admin/src/features/agents/persona-dialog.tsx`:`import { formatDateTime } from "../../lib/format";` → 该行 + `import { levelText } from "../../lib/levels";`;`    [S.dialog.level, persona.level],` → `    [S.dialog.level, levelText(persona.level)],`。
- [ ] **Step 5:** Run `cd admin && yarn vitest run src/lib/levels.test.ts src/features/catalog src/features/rooms src/features/agents && cd .. && yarn admin:typecheck` — 全绿(若某个现有测试按裸代码 `"B1"` 精确找文字,改成 `"B1 · 中级"`)。
- [ ] **Step 6:** Commit `feat(admin): show what each CEFR level means`。

---

## Task T7:跟读库「精选」的级别(车道 L;**`feat/curated-cl-web` 合并进 `main` 且 T1 已合并后**)

**Files:** Modify `web/src/features/library/catalog-view.tsx`、`web/src/features/library/catalog-card.tsx`、`web/src/features/library/catalog-view.test.tsx`、(条件)`web/src/features/library/item-card.tsx` 与 `item-card.test.tsx`、`docs/superpowers/plans/2026-10-14-curated-library-web.md`。

- [ ] **Step 0:** 确认 `git log main --oneline | grep "featured tab in the library"` 有结果;Read 上面三个文件。下面的锚点取自 2026-10-14 的 `feat/curated-cl-web`(提交 `1b73e53c`),合并后若有出入,按同样的意图改。
- [ ] **Step 1(测试):** Edit `web/src/features/library/catalog-view.test.tsx`(语言是 `setUiLanguage("zh-CN")`):
  1. `    expect(within(c).getByText("B1")).toBeInTheDocument();` → `    expect(within(c).getByText("B1 · 中级")).toBeInTheDocument();`。
  2. `    expect(chips).toEqual(["全部", "A2", "B1", "B2"]);` → 下面两行:
```tsx
    expect(chips).toEqual(["全部", "A2 · 初级", "B1 · 中级", "B2 · 中高级"]);
    expect(screen.getByTestId("catalog-level-hint")).toHaveTextContent("A1–C2 是国际通用的英语水平分级(CEFR),A1 最低,C2 最高。");
```
  3. `    fireEvent.click(screen.getByRole("button", { name: "A2" }));` → `    fireEvent.click(screen.getByRole("button", { name: "A2 · 初级" }));`。
  4. `    expect(screen.getByRole("button", { name: "A2" })).toHaveAttribute("aria-pressed", "true");` → 下面两行:
```tsx
    expect(screen.getByRole("button", { name: "A2 · 初级" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("catalog-level-hint")).toHaveTextContent("能进行简单的日常交流");
```
- [ ] **Step 2:** Run `cd web && yarn vitest run src/features/library/catalog-view.test.tsx` — 失败。
- [ ] **Step 3:** Edit `web/src/features/library/catalog-view.tsx`:
  1. 在文件的 `import { useTranslation } from "react-i18next";` 行之后加 `import { LevelHint } from "~/components/level-hint";` 与 `import { levelLabel } from "~/lib/levels";`(若该文件已有其他 `~/` 导入,放在它们旁边)。
  2. `        <div role="group" aria-label={t("web.library.catalog.levels")} className="lib-cat-levels">` → `        <div role="group" aria-label={t("web.library.catalog.levels")} aria-describedby="catalog-level-hint" className="lib-cat-levels">`。
  3. `              {l === ALL ? t("web.library.catalog.allLevels") : l}` → `              {l === ALL ? t("web.library.catalog.allLevels") : levelLabel(t, l)}`。
  4. 芯片组的闭合:Read 后找到 `{levels.length > 1 ? (` 后面那个 `</div>`(芯片组 `div` 的闭合,紧接着是 `) : null}`),把这两行替换为:
```tsx
        </div>
      ) : null}
      {levels.length > 1 ? (
        <LevelHint code={level === ALL ? null : level} fallback={t("web.level.scale")} id="catalog-level-hint" testId="catalog-level-hint" className="mx-1 mb-2 mt-1.5" />
      ) : null}
```
- [ ] **Step 4:** Edit `web/src/features/library/catalog-card.tsx`:导入区加 `import { levelLabel } from "~/lib/levels";`;`            {card.level ? <span className="lib-cat-level">{card.level}</span> : null}` → `            {card.level ? <span className="lib-cat-level">{levelLabel(t, card.level)}</span> : null}`。
- [ ] **Step 5(条件):** Grep `level` 在 `web/src/features/library/item-card.tsx`:若副本卡片显示了精选级别(设计稿 `mockup.html:321` 的「精选 · B1」),同样用 `levelLabel(t, …)` 包住,并把 `item-card.test.tsx` 里对应的裸代码断言改成 `B1 · 中级`;没有显示级别就跳过本步。
- [ ] **Step 6:** 视觉:`lib-cat-levels` 若是单行不换行、横向滚动,芯片变宽后仍可用;若会被截断,在 `web/src/features/library/library.css` 的 `.lib-cat-levels` 规则里加 `flex-wrap: wrap;`(不加 `backdrop-filter`、不加 `@keyframes`,`library-css.test.ts` 守着)。
- [ ] **Step 7:** Edit `docs/superpowers/plans/2026-10-14-curated-library-web.md`:文件末尾追加:
```markdown

## Addendum (2026-10-14,级别标注)

计划 `2026-10-14-level-annotations.md` Task T7:精选的级别芯片与卡片徽标改为「B1 · 中级」(`~/lib/levels::levelLabel`),芯片行下一行说明(`~/components/level-hint::LevelHint`,选「全部」时是 CEFR 总说明)。取值与筛选逻辑(`levelsOf`、`LEVEL_ORDER`)不变。
```
- [ ] **Step 8:** Run `cd web && yarn vitest run src/features/library/catalog-view.test.tsx src/features/library/item-card.test.tsx src/features/library/library-css.test.ts src/architecture.test.ts && cd .. && yarn web:typecheck` — 全绿。
- [ ] **Step 9:** Commit `feat(web): name and explain levels in the featured library`。

---

## Task T8:文档与自检(全部合并后)

**Files:** Modify `web/README.md`。

- [ ] **Step 1:** Edit `web/README.md`:在单行 `## E2E(Playwright,真实上游)` **之前**插入:
```markdown
## 级别标注(计划 2026-10-14-level-annotations)

凡是显示 CEFR 级别代码的地方都带上中文级别名(「B1 · 中级」;英文界面「B1 · Intermediate」),让人选级别的地方(对话「英语难度」、房间「目标水平」、角色「英文水平」、记忆页「水平」、精选「按级别筛选」)旁边有一行说明这个级别的意思(如「能应对大多数日常场景」),读屏经 `aria-describedby` 读到。房间目标水平的分段控件改为两行(代码 + 级别名),不选时说明「不选时按你的段位自动定」。段位首页「对齐 CEFR」下也有一行说明。存储与提交的值不变。共用 `src/lib/levels.ts` + `src/components/level-hint.tsx`,文案 `web.level.*` 在 `src/components/i18n`;管理后台的级别下拉 / 列 / 详情用同样的中文(`admin/src/lib/levels.ts`,测试逐字比对)。**未在真机验证**:360–390 px 宽下分段控件两行字是否截断、精选芯片与角色芯片换行后的排布、读屏是否读出说明行;清单见计划「真机 / 视觉清单」。

```
- [ ] **Step 2:** 自检(只读):
  - Grep `web.chat.levels\.(A|B|C)` 在 `web/src`、`web/e2e` 应无结果。
  - Grep `features/` 在 `web/src/lib/levels.ts`、`web/src/components/level-hint.tsx` 应无结果。
  - Grep `title=\{t\("web.agents.tutor.bar.level"` 仍可存在,但同一行的可见文字是 `levelLabel(...)`。
  - `git diff --stat main~N...main`(N = 本计划提交数)里不应出现 `enjoy/`、`server/`、`web/src/features/chat/levels.ts`。
- [ ] **Step 3:** Run `cd web && yarn vitest run src/lib/levels.test.ts src/components/level-hint.test.tsx src/features/chat/conversation-settings-sheet.test.tsx src/features/rooms/create src/features/agents/tutor src/features/rank/rank-home-page.test.tsx src/i18n/i18n.test.ts src/architecture.test.ts && cd .. && yarn web:typecheck && yarn admin:typecheck` — 全绿后才勾选本计划的任务框。**不跑** `yarn web:build`、全量与 E2E(用户要求时再跑;届时顺便看主包体积,见 UNVERIFIED)。
- [ ] **Step 4:** Commit `docs: describe level annotations`。

---

## Task T9(仅控制者):更新日志草稿

**前提:** T1–T8(或 T1–T6 + T8,若精选库尚未合并则不写精选那一句)已合并、已部署并由控制者核对。实现车道**不做**这一步。

- [ ] **Step 1:** 按 `docs/CLAUDE.md` 的写作规则,在 `docs/changelog/2026-10.json` 数组末尾追加一条(`entry_date` 用实际部署日;`version` 为 null;只写已上线的):
```json
  {
    "entry_date": "2026-10-14",
    "version": null,
    "title_zh": "英语级别一看就懂",
    "title_en": "English levels explained",
    "items": [
      { "tag": "improve", "zh": "A1、B1 这样的英语级别旁边都标上了中文名,比如「B1 · 中级」。", "en": "English levels such as A1 or B1 now show a plain name, like \"B1 · Intermediate\"." },
      { "tag": "improve", "zh": "选择对话难度、房间目标水平或角色水平时,下方会说明这个级别大概能做到什么。", "en": "When you pick a level for a chat, a room or a persona, a short line tells you what that level can do." },
      { "tag": "improve", "zh": "精选素材可以按级别筛选,每个级别都有说明。", "en": "Featured items can be filtered by level, and each level is explained." },
      { "tag": "improve", "zh": "段位页会说明你的段位大致对应的英语水平。", "en": "The rank page explains which English level your tier matches." }
    ]
  }
```
- [ ] **Step 2:** Run `cd server && uv run pytest -q tests/test_changelog_import.py`;提醒用户在服务器上运行 `docker compose exec server python -m app.admin.changelog_import`(镜像需重建后才带上新文件,重建只在用户要求时做),然后在管理后台「更新日志」里编辑并发布。

---

## 自检清单(执行者交付前对照)

1. 所有 `<option value>`、单选回传值、请求体与改动前相同(`conversation-settings-sheet.test.tsx` 的 `onSave` 断言、`settings-fields.test.tsx` 的 `onChange` 断言、`conversations-page.test.tsx` 的 POST 体断言全绿)。
2. 对话下拉的选项文字与改动前逐字相同(`B1 · 中级` / `B1 · Intermediate`),只是来源换成了 `web.level.*`。
3. 加入方式那组分段仍是 32 px 单行(没有 `sub`)。
4. 新文案:`components/i18n` +13 键 / 语言、`chat/i18n` −4 键 / 语言、`rooms/create/i18n` +1 键 / 语言;`i18n.test.ts` 绿。
5. 没有新的跨 feature 导入;`levels.ts` 只依赖 `i18next` 类型。
6. 没有改 `enjoy/`、`server/`、`chat/levels.ts`(提示词)。
7. 没有悬停才出现的说明(`title` 只作补充)。

## 真机 / 视觉清单(全部 UNVERIFIED;执行后由用户在真机上填写,摘要写进 `web/README.md`)

> jsdom 只能证明文字、属性与 `aria-describedby` 关联正确,**不能**证明排布与读屏表现。请在每条记录开头写上构建、设备、系统与浏览器版本、界面语言(中文 / English)、深浅色。

**V-A 房间「目标水平」(iPhone SE 宽 320 / 375、主流安卓 360 / 393 各看一次)**
- [ ] V-A1 创建房间弹层里 5 段等宽、每段两行「B1 / 中级」都完整显示,不截断「中高级」;英文界面下「Upper intermediate」被省略号截断是否可接受(记录截图)。
- [ ] V-A2 不选时下方说明「不选时按你的段位自动定。」;点一段后说明换成该级别的意思;房主设置弹层同样。
- [ ] V-A3 分段高度 44 px 后,弹层整体没有被挤出一屏需要额外滚动(记录前后差异)。

**V-B 对话与角色**
- [ ] V-B1 新对话面板、对话设置里的「英语难度」原生选择器(iOS 滚轮 / 安卓弹窗)选项显示「B1 · 中级」,选完后下方说明正确。
- [ ] V-B2 对话顶栏副标题「场景 · B1 · 中级 · 音色」在 360 px 宽下的截断位置可接受。
- [ ] V-B3 编辑角色「英文水平」芯片「B2 · 中高级」换行后不拥挤;标题行右侧说明在窄屏不与标题重叠(必要时记录,备选:说明移到芯片下)。
- [ ] V-B4 带我学条「B1 · 中级」不把题型文字挤没(`truncate` 生效)。

**V-C 精选与段位**
- [ ] V-C1 精选芯片「全部 · A2 · 初级 · B1 · 中级 · B2 · 中高级」在 390 px 宽下的排布(换行或横滑),说明行位置清楚。
- [ ] V-C2 精选卡片徽标「B1 · 中级」与标签同一行时不溢出。
- [ ] V-C3 段位首页「对齐 CEFR B1+ · 中级+」与下一行说明居中、不超过 260 px。

**V-D 读屏(VoiceOver / TalkBack)**
- [ ] V-D1 聚焦「目标水平」单选组时读出「B1 中级,单选按钮」以及说明行;聚焦对话「英语难度」下拉时读出说明。
- [ ] V-D2 深色模式下说明行(`text-ink-2`)对比度足够。

**V-E 管理后台(桌面浏览器)**
- [ ] V-E1 精选条目详情与上传 / 导入对话框的级别下拉显示「B1 · 中级(能应对大多数日常场景)」,下拉宽度够用;列表「级别」列、房间详情「水平」、角色审核「等级」显示「B1 · 中级」。

## UNVERIFIED(必须在交付说明里原样保留)

- 上面「真机 / 视觉清单」的全部项目。
- 主包体积:`components/i18n` 是急切文案(+13 键 / 语言,−4 键来自 chat),`lib/levels.ts` 与 `LevelHint` 可能进主包;`yarn web:build` 与 `scripts/main-bundle.mjs` 未运行(用户要求时再测,超出 0.2 kB 预算时再议是否把说明句移到懒加载)。
- `i18n.getFixedT(...)` 与 `TFunction` 类型的兼容、admin 测试里跨目录读取 `web/` 文件:以第一次运行为准(T1 Step 8 已给替代写法)。
- E2E 未运行(`e2e/scenario-spot-check.spec.ts` 用 `selectOption(c.level)` 按值选,不受影响)。

## 开放问题

- **Q1 字段名是否统一?** 现在有「英语难度 / 目标水平 / 英文水平 / 水平 / 难度 / 级别 / 等级」七种叫法(冲突 C2)。建议另开一个小计划统一成「英语水平」(对话、房间、角色、记忆)+「难度」(带我学、词书),本计划不动。
- **Q2 词书要不要显示「约 B1」?** 服务端 `server/app/wordbook/books.py` 已有每本书的 `cefr`(初中 A2、高中 B1、四级 B1+、六级 / 考研 B2、托福 / SAT C1),但 `/api/wordbook` 没有下发;要显示需要服务端加字段 + 网页 `books-page.tsx` 显示(另开任务)。
- **Q3 英文界面的「Upper intermediate」在 5 段分段控件里必然被截断**:可接受,还是英文下改用缩写(「Upper int.」)?需要 owner 看过 V-A1 截图后决定。
- **Q4 是否需要「全部级别说明」入口**(偏离 1 的备选):若真机上一行说明不够,再加一个 44 px「级别说明」按钮展开六级全表。
