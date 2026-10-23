# 中文释义点击显示 · 配音选段与角色名 · 对话做首页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- 日期:2026-10-23 · 状态:只有文档,没有产品代码;未提交
- 基线:worktree `/home/workspace/study-english-merge`,分支 `merge/integ-10-21` @ `409a6e8a`(下文 文件:行号 都是在这个提交上打开核对过的;实现前 Task 0 重新核对)
- 裁决来源:项目负责人 2026-10-23 的三项决定(本计划照写,不再提问;真正待定的放在文末「Open questions」)。
  配音选中样式的批准稿:`dub-preview.html` 的效果 A(本地副本在会话草稿目录,私有发布 https://claude.ai/artifact/CWQqEsKRH24YK3rgoeyYXJ),**但选中色要比稿子更柔和**。
- 写计划前读过:根 `CLAUDE.md`、`docs/CLAUDE.md`、`web/CLAUDE.md`、`web/src/settings/CLAUDE.md`、`web/src/pages/CLAUDE.md`、`web/src/features/CLAUDE.md`、
  `web/src/features/{dubbing,lookup,wordbook}/CLAUDE.md`、`web/src/components/CLAUDE.md`、`web/src/lib/CLAUDE.md`、`web/src/styles/CLAUDE.md`、`web/src/layout/CLAUDE.md`、
  `web/e2e/CLAUDE.md`、`web/src/architecture.test.ts`,以及 `docs/superpowers/plans/10.21-plans/2026-10-21-l6-chat-rooms-merge.md`(本计划照它的结构写)。
- **写本计划时没有运行任何测试**,也没有改任何产品代码。

**Goal:** 三件互不相干的网页改动,各自一条车道:
- **A 中文释义:** 「我的」新增「中文释义:自动显示 / 点击后显示」(本机偏好,默认自动 = 行为不变)。选「点击后显示」时,学新词卡、复习卡、点词查词结果里的中文释义块被**原位**的「显示中文释义」控件替换,点一下只揭开这一张卡 / 这一次查词。
- **B 配音选段:** 选中句子用效果 A(浅色整行底、左侧色条、对勾、首尾「起 / 止」,半选起点虚线框 +「起」),对比柔和;角色从「角色 A…F」改成「色点 + 红·Alex / 蓝·Bella / 绿·Chris / 黄·Dana / 紫·Ethan / 橙·Fiona」,线上键仍是 A–F。
- **C 导航:** 底栏改成 对话 · 练习 · 跟读库 · 我的;`/chat` 成为首页(登录后落点、`/`、兜底 `*`),练习页仍从底栏进入。

**Architecture:** 每条车道只碰自己的目录,共享部分走现有接缝:A 用 `settings/` 的一个小偏好模块 + `components/` 的一个小揭开组件(wordbook 与 lookup 各自经 `~/settings/…`、`~/components/…` 使用,**不新增 feature→feature 边**);B 全部在 `features/dubbing/` 内(一个角色身份模块 + 一个懒加载 CSS);C 用 `lib/home-route.ts` 一个常量表达「首页」。`CROSS_FEATURE_BASELINE` 仍是 21 条(`web/src/architecture.test.ts:67-71`、`:201`、`:262`)。

**Tech Stack:** React 18 + react-router 7 + Vite + vitest + Testing Library;Playwright(只改规格并做类型检查,不运行)。

## Global Constraints

- 只改 `web/` 与本计划;**不改** `server/`(包括 `server/tests/fixtures/dubbing_contract.json`)、`enjoy/`、`admin/` 与其他上游目录;不做数据库迁移。
- 每个任务一个逻辑改动、一个提交(约定式前缀),提交后该任务列出的测试 + typecheck 为绿;提交信息末尾加会话提示的 `Co-Authored-By` 行。
- 文案只有中文、英文两份,两份同时改(`src/i18n/i18n.test.ts` 按目录比对键;配音另有 `features/dubbing/locales.test.ts`)。
- 改变目录契约的任务在同一提交里更新该目录的 `CLAUDE.md`;`web/README.md` 在最后的 Task D1 一次改完(三条车道都碰它,避免冲突)。
- 不在 URL、日志、测试快照里放词、句子、角色名、用户 id、票据;新偏好只存一个枚举值,不含任何词。
- 不跑 E2E、不重建 / 重启容器(用户要求时才做)。
- **宿主机没有 node**:所有网页测试、类型检查、构建都在 docker 里跑。下文统一写成 `web '<命令>'`,含义是:

  ```bash
  WT=/home/workspace/study-english-merge   # 并行车道各自换成自己的 worktree 路径
  web() { docker run --rm -v "$WT":/app -w /app/web node:20-bookworm bash -c "corepack enable && yarn workspaces focus web && $1"; }
  # 例:web 'yarn vitest run src/settings/zh-defs-pref.test.ts'   web 'yarn typecheck'   web 'yarn build && node scripts/check-main-bundle.mjs'
  ```
  注意:容器以 root 运行,`web/node_modules` 会是 root 所有(本 worktree 里已经如此),清理时需要 docker 或 sudo;worktree 里不要用指向主检出的 `node_modules` 符号链接(容器里跟不过去)。

## 依赖边(architecture.test.ts 规则 1–5)

| 任务 | 用到的已允许边 | 新增边 |
|---|---|---|
| A1 | `settings → lib`(`~/lib/storage`);`auth → settings`(`auth/device-data.ts` 已有同类导入 `:6-7`) | 无 |
| A2 | `components → lib`(`~/lib/cn`)、npm `lucide-react` | 无 |
| A3 | `pages → settings`、`pages → components` | 无 |
| A4 | `features/wordbook → settings`、`→ components`(wordbook `CLAUDE.md` Allowed dependencies 已列) | 无 |
| A5 | `features/lookup → settings`、`→ components`(lookup `CLAUDE.md` 已列) | 无 |
| B1–B3 | 只在 `features/dubbing/` 内部相对导入 | 无 |
| C1–C2 | `app.tsx / pages / features/{account,activation,library,dubbing} / lib/extension-points-react.tsx → lib/home-route` | 无(`lib` 是最底层,人人可用) |
| C3 | 只改 `layout/bottom-nav.tsx` 内部常量 | 无 |

wordbook 与 lookup **互不导入**:共享的只有 `settings/zh-defs-pref.ts`(规则)和 `components/zh-defs-cover.tsx`(外观 + 揭开状态)。不用扩展点:这不是可选的「学习联动」,而是两处都要遵守的同一条显示偏好,`settings/` 正是放本机显示偏好的层。

## 裁定(Rulings)

### A 中文释义

- **R-A1 偏好模块 = `web/src/settings/zh-defs-pref.ts`(新)。** 照 `settings/tts-voice-pref.ts:44-80` 的写法:模块级内存副本 + `useSyncExternalStore`。
  API:`ZH_DEFS_MODES = ["auto", "tap"] as const`、`type ZhDefsMode`、`DEFAULT_ZH_DEFS_MODE = "auto"`、`getZhDefsMode()`、`setZhDefsMode(mode)`、
  `resetZhDefsModeMemory()`、`useZhDefsMode(): ZhDefsMode`。存储键 `ZH_DEFS_PREF_KEY = "enjoy-web.defs.zh"` 加在 `web/src/lib/storage.ts`(紧跟 `:43` 的 `TTS_VOICE_PREF_KEY`);
  只在 `"tap"` 时写入 JSON 字符串 `"tap"`,选回 `"auto"` 时 `removeKey`;读到任何别的值都当 `"auto"`。登出时由 `auth/device-data.ts` 清键并重置内存(与 `:22`、`:29` 同处)。
  **不放进 `SettingsProvider`**(`settings-context.tsx:19-34`):那样要改它的存储形状和 `settings-context` / `me-page` 的整对象 `toEqual` 测试(settings `CLAUDE.md` Pitfalls),而查词抽屉、词卡只需要读一个值。
- **R-A2 与「释义显示 中英 / 仅中文 / 仅英文」的关系:** 已有的 `def_lang`(服务端偏好,`features/wordbook/def-lang-setting.tsx`,默认「仅英文」`def-lang.ts:10`)决定**有哪些语言的行**;
  新偏好只决定**本来会直接显示的中文释义块是否先藏起**。精确规则:揭开控件只在 `zhCover && 中文释义在 peek=false 时本来就显示` 时出现——
  - 词卡 / 答后区:`zhReveal(defLang, card, false).view.showSenses === true`(`def-lang.ts:70-79`、`:91-96`);查词抽屉:`drawerDefs(entry, false).zh.length > 0`(`dictionary.ts:73-85`)。
  - 所以「中英」「仅中文」、以及「仅英文」但这个词没有英文释义(回退成中文)三种情况会被盖住;「仅英文」且有英文释义时**不变**:中文仍由已有的「中」(`word-card.tsx:99-108`)/「中文」(`ZhToggle`,`after-answer-panel.tsx:62`、`dictionary-result.tsx:40-42`)带回,带回后**不再**出现第二道揭开控件(peek 本身就是显式揭开)。
  - 「短语:自动展开 / 收起」(`phrases-pref.ts`)完全不受影响。
- **R-A3 揭开组件 = `web/src/components/zh-defs-cover.tsx`(新),导出 `ZhDefsCover`。** 属性:`active: boolean`、`resetKey: unknown`、`label: string`(调用方传已翻译文字,组件不含文案,同 `ZhToggle` / `ZhNoteFold` 惯例)、
  `offsetClassName?: string`(被包块原有的上外边距类,如 `mt-3.5`)、`className?: string`(按钮外观追加,查词抽屉传玻璃井类)、`testId?: string`(默认 `zh-defs-cover`)、`children`(中文块,**原样**)。
  - `active === false` → 直接返回 `children`,不加任何包裹:默认「自动显示」下 DOM 与今天逐字节相同(`word-card-legacy.test.tsx` 快照不动)。
  - `active === true` → `<div data-testid={testId} data-state="hidden|shown" class="grid">`,三层叠在同一格(`[grid-area:1/1]`):
    ① 内容层 = `children`,隐藏时 `invisible` + `aria-hidden`;② 尺寸层 `<span aria-hidden data-zh-sizer class="invisible min-h-tap {offsetClassName}">`,**始终存在**;
    ③ 隐藏时的按钮 `<button type="button" data-testid="zh-defs-reveal" aria-expanded="false" class="min-h-tap w-full {offsetClassName} …">`(眼睛图标 + label,虚线发丝描边、`bg-surface-2` 浅底、`text-ink-2`、`rounded-badge`,不用任何 `*-tint`)。
  - 效果:格子高度 = max(中文块, 外边距 + 44 px);按钮正好占中文块的位置与大小(块矮于 44 px 时按钮为 44 px,即「同位、同大或更小、单手好点」);
    **揭开时高度不变**(尺寸层留着);与「自动显示」相比,只有一行的中文块会让卡片高约 20 px,两行以上完全相同。
  - 揭开状态在组件内,按 `resetKey` 记:`const [shownFor, setShownFor] = useState<unknown>(NONE); const shown = shownFor === resetKey;`(与 `dictionary-result.tsx:14-15` 的 `peekOf === entry` 同一手法),
    换 key 自动复位;一次揭开后不再收回(要再藏就翻到下一张)。点按后把焦点移到内容层(`tabIndex={-1}`),按钮消失不丢焦点。
  - 为什么放 `components/`:wordbook 与 lookup 都要,`components/` 是两者都能用、又不认识任何 feature 的层(`components/CLAUDE.md` Allowed dependencies);
    组件自带一点状态有先例(`zh-note-fold.tsx`)。为什么不改 `zh-toggle.tsx`:它在 `components/CLAUDE.md` 的「Never edit」名单里(锁定页读它)。
  - 隐藏的中文以 `visibility:hidden` 留在 DOM 里(只为占位)。这与 wordbook「遮罩时释义不在 DOM 里」的规则不冲突:那条管的是**计分的**回忆遮罩(`RecallCover`),本控件不计分、不发请求(见 Q9)。
- **R-A4 范围(2026-10-23 grep `senses|defsZh|meaningLine|\.zh\b|meaning` 全部命中后逐个判定):**
  - **改(在范围内):**
    1. 学新词卡 `features/wordbook/word-card.tsx:141-150`(`WordCardView` 的中文释义 `<ul>`;学新词页 `learn-page.tsx:270`)。
    2. 复习「快速回忆」背面 `recall-card.tsx:25-37`(同一个 `WordCardView`;复习页 `review-page.tsx:299`,自由复习的翻卡浏览 `free-browse.tsx:56` 也走它)。
    3. 复习答后「学习内容」`after-answer-panel.tsx:51-60`(meaning 题)与 `:38-39`(其他题型,受控 `WordCardView`)。
    4. 点词 / 选词查词抽屉的词典命中 `features/lookup/dictionary-result.tsx:26-32`(`lookup-dict-zh`)。
  - **不改(有意保留):**
    - 题目本身:`choice-question.tsx:86`、`:90`(释义题题面)、`typing-question.tsx:82`、`option-view.ts:27`(答后选项行的中文选项文字,「answered meaning rows are always bilingual」)——那是题,不是释义区。
    - 答错后的答案回顾:`word-card.tsx:181-192`(`WordRecap`,`learn-page.tsx:314`)、`session-summary.tsx:90`(小结里的错词释义)——它们就是在告诉你答案。
    - 已学词页的词卡弹层 `learned-page.tsx:57`(查阅用,不是学 / 复习;见 Q1)。
    - 按句拼写:`spell/spell-results.tsx:75`、`spell/explain-sheet.tsx:58-71`、`spell/cloze-board.tsx:97`(句子译文)。
    - 例句译文 `word-card.tsx:156`(已有「隐藏中文」开关 `:162-168`)与短语译文 `phrases-section.tsx:36`、`:42`、`dictionary-result.tsx:47`(见 Q2)。
    - 查词抽屉的大模型结果 `lookup-layer.tsx:246-261`(`AiLookup` 的 `translation`,母语可能不是中文)与「翻译」模式 `:184`(见 Q3)。
    - 其他 feature 里的「中文」:生词本 `vocabulary/review-card.tsx:43`、`vocabulary-page.tsx:289`,错题 `plugins/mistakes/mistakes-page.tsx:139`,联机小结 `rooms/extras/summary-page.tsx:71`,
      对话复盘 `chat/recap-sheet.tsx:210`、提示 `chat/hints-sheet.tsx:48`,今日单词 `plugins/pron-shadow/today-words-sheet.tsx:30`,跟读库译文 `library/translation-state.ts`——都不是「中文释义块」。
- **R-A5 接线 = 一个布尔属性 `zhCover`,和 `defLang` 一样由页面传下去。** 学新词页、复习页、自由复习浏览各调用一次 `useZhDefsMode()`,把 `zhCover={mode === "tap"}` 传给
  `WordCardView` / `RecallCard` / `AfterAnswerPanel`(属性默认 `false`)。已学词页不传 → 不变。查词抽屉的 `DictionaryResult` 自己调用 `useZhDefsMode()`(它只有一个使用处,`lookup-layer.tsx:182`)。
- **R-A6 每卡复位:** `WordCardView` 的 `resetKey = card.key`(与 `peekKey` 同,`word-card.tsx:95`;学新词页按 `key={current.key}` 重挂,复习页 `RecallCard` 按 `key={`${question.key}:${attempt}`}` 重挂);
  复习页给 `<AfterAnswerPanel>` 加 `key={slot}`(`review-page.tsx:320`,与 `peekSlot` 同一槽位语义 `:86`),同一个词再次出现也重新藏起;查词抽屉 `resetKey = entry`(新查词 = 新对象)。
- **R-A7 文案:** 「我的」一行放在 `web/src/i18n/{en,zh-CN}.json` 的 `web.me`(与 `playbackRate` 同处,`:32`):`zhDefs`「中文释义」/ "Chinese definitions",
  `zhDefsHint`「学新词、复习和查词结果里的中文释义。选「点击后显示」时先藏起,点一下再看。」/ "In new-word cards, reviews and lookups. "Show on tap" hides them until you tap.",
  `zhDefsOptions.auto`「自动显示」/ "Show automatically",`zhDefsOptions.tap`「点击后显示」/ "Show on tap"。
  词卡上的按钮复用已有的 `web.wordbookDefs.peek.label`(「显示中文释义」/ "Show Chinese definitions",`features/wordbook/locales/*.json:5`),不新增;
  查词抽屉新增 `web.lookup.zhReveal`(同样两句),放 `features/lookup/i18n/{en,zh-CN}.json`。`web.wordbookDefs.setting.help`(`locales/*.json:15`)末尾补一句「「我的 → 中文释义」可以让中文先藏起。」/ "Me → Chinese definitions can hide them until tapped."。
- **R-A8 不计分、不上报:** 揭开不改 `cardReducer` 的 `peeked` / `revealedBefore` / `elapsedMs`(`session-machine.ts:42-76`),不发请求,不写日志。

### B 配音选段与角色

- **R-B1 角色身份模块 = `web/src/features/dubbing/role-identity.tsx`(新),全 feature 唯一的角色→颜色 / 名字表。**
  `ROLE_COLOR: Record<RoleKey, "red"|"blue"|"green"|"yellow"|"purple"|"orange">`(A 红、B 蓝、C 绿、D 黄、E 紫、F 橙);
  `roleName(t, role, custom?)` = 去空白后非空的自定义名,否则 `t("web.dubbing.roles.default.<A-F>")`(Alex / Bella / Chris / Dana / Ethan / Fiona,两种语言都写);
  `roleLabel(t, role, custom?)` = `t("web.dubbing.roles.label", { color: t("web.dubbing.roles.color.<color>"), name })` → 「红·Alex」/ "Red·Alex";
  `<RoleDot role>`(`aria-hidden` 圆点,`data-role-color`)、`<RoleTag role custom?>`(圆点 + `roleLabel` 文字)。颜色**永远伴随文字**(圆点 + 颜色词 + 名字),从不只靠颜色。
- **R-B2 线上协议不变:** `ROLE_KEYS`(`dubbing-api.ts:9-10`)、保存体 `{ idx, speaker: "A".."F" }`(`role-labels.tsx:144-145`)、改名体 `{ names: { [key]: name } }`(`dub-item-page.tsx:88`)全部照旧;
  `server/tests/fixtures/dubbing_contract.json` 不动(`dubbing-contract.test.ts` 继续逐键比对);用户已存的自定义名(`RolesState.names`,`dub-item-page.tsx:70`)优先于默认名,颜色仍跟字母走(「红·Host」)。
- **R-B3 颜色令牌放 `features/dubbing/dubbing.css`(新),作用域 `.dub-root`,浅色在 `.dub-root {}`、深色在 `.dark .dub-root {}`**——照 `features/practice/shadow/shadow-sheet.css:1-40` 的先例(懒加载块带进来、不改 `theme.css`)。
  不放 `styles/theme.css`:那里「一个色相一个含义」(`styles/CLAUDE.md` Rules),红色是挂断 / 退出,角色色是身份色;而且只有配音页用,不该进主包 CSS。
  `dub-item-page.tsx:92` 的根 `div` 加 `dub-root`;`role-identity.tsx` 与 `clip-picker.tsx` 各 `import "./dubbing.css"`(都只被懒页面引用,`dubbing-lazy.test.ts` 守着 `index.ts` 不静态导入它们)。
- **R-B4 柔和取值(起点值;以 Task B1 的守卫测试为准,不过就调色值,不降阈值):**

  | 令牌 | 浅色 | 深色 | 用途 |
  |---|---|---|---|
  | `--dub-sel` | `#f3f6ff` | `#1d2230` | 选中行底(稿子是 `#dfe6ff` / `#29315c`,太重) |
  | `--dub-sel-bd` | `#d5ddf7` | `#2f3850` | 选中行描边 |
  | `--dub-sel-bar` | `#8aa0e8` | `#6f84c9` | 左侧 4 px 色条、半选虚线框 |
  | `--dub-mark-bg` / `--dub-mark-fg` | `#e4eafc` / `#2a3f8f` | `#27304a` / `#c9d4ff` | 「起 / 止」小标(稿子是实心蓝底白字,改成浅底深字) |
  | `--dub-role-{a..f}` | `#d6383a` `#2f6fe0` `#1f9254` `#b9770a` `#8a47d6` `#d2570f` | `#ff7a7c` `#7aaaff` `#5fd596` `#f0b44a` `#c597ff` `#ff9a5e` | 圆点、角色卡左边框(取自稿子) |
  | `--dub-role-{a..f}-soft` | `#fdeeee` `#eaf1ff` `#e6f7ee` `#fdf4df` `#f4ecfc` `#fdefe6` | `#4a2325` `#22335a` `#1d4231` `#4a3a14` `#3c2858` `#4d2e1a` | 角色小标底(浅色比稿子更淡) |

  文字一律用 `rgb(var(--ink))`(选中行**不**改成深蓝、不加粗到 600,只 `font-medium`);不用实心深色 / 饱和填充。守卫(Task B1):`--dub-sel` 与 `--surface` 的对比度在 1.03–1.15 之间(看得出、但不重);
  `--ink` 在 `--dub-sel`、各 `-soft` 上 ≥ 7;`--dub-mark-fg` 在 `--dub-mark-bg` 上 ≥ 4.5;每个圆点色在自己的 `-soft` 与 `--dub-sel` 上 ≥ 3(WCAG 1.4.11)。上面数值的对比度是按公式粗算的,**以测试实测为准**。
- **R-B5 选中状态(效果 A 柔和版):** 纯函数 `clipMark(selection, idx): "none" | "half" | "start" | "mid" | "end" | "single"` 放在 `clip-picker.tsx`(导出、单测)。
  每个 `<li>` 带 `data-sel={mark}`,样式全部写在 `dubbing.css` 的 `[data-sel=…]` 规则里(行底、描边、色条 `::before`、半选虚线);句子按钮 `aria-pressed` 在 `mark !== "none"` 时为 `true`(**半选起点也算按下**,今天是 `false`,`clip-picker.tsx:51`、`:63`)。
  按钮里文字后面的小标:`start`「起」、`end`「止」、`single`「起止」、`half`「起」、`mid` 用 `lucide-react` 的 `CheckIcon`(`aria-hidden`,不用 ✓ 字符,避免 `locales.test.ts` 的 emoji 检查)。
  未选中行从 `bg-white/10` 改成 `bg-surface` + 发丝描边(稿子 `.row`)。页脚半选时显示「已选起点:第 n 句,再点一句作为终点。」(新键 `clip.half`)。
  **结构不变:** 角色小标仍是句子按钮的**兄弟节点**(`clip-picker.tsx:58-60`,提交 `409a6e8a`),`clip-picker.test.tsx:49-62` 原样保留。
- **R-B6 所有显示角色的地方(2026-10-23 grep `roles.role|Role |speakerOf|take.role|roleName`):**
  - 句子角色小标:`dub-item-page.tsx:157-167`(`renderMarker`,显示 `speakerOf(idx) ?? "·"`)→ `<RoleTag>`;无角色仍是「·」;按钮 `min-h-tap`(单手好点);`aria-label` 改成「第 n 句的角色:红·Alex」/「…:未分配」。
  - 选角色卡:`role-picker.tsx:37`、`:47`(以及改名按钮 / 输入框的 aria-label `:53`、`:66`)→ 圆点 + `roleLabel`,卡片左边框用角色色,选中用 `--dub-sel` 底 + 对勾。
  - 彩排「你扮演 …」:`dub-item-page.tsx:125` 算 `roleName` → `DubSession`(`dub-session.tsx:26`、`:157`)→ `RehearsalView`(`rehearsal-view.tsx:31`)。只改 `:125` 成 `roleLabel(...)`;`RehearsalView` 新增可选 `role` 属性画圆点,`DubSession` 透传。
  - 之前的录音:`take-history.tsx:23` 显示裸字母 `take.role` → `<RoleTag role={take.role} custom={names?.[take.role]} />`,`TakeHistory` 新增可选 `names` 属性,由 `dub-item-page.tsx:188` 传入。
  - 结果页 / 录制页 / 舞台:`results-view.tsx`、`dub-results.tsx`、`recording-view.tsx`、`stage.tsx` **今天不显示角色**(grep 无命中),不改。
  - `role-labels.tsx` **不需要改**:它只管 `speakerOf` / `cycle` / 保存(字母),小标的渲染在 `dub-item-page.tsx` 的 `renderMarker`;它的测试只补一条「线上只发字母」的回归(Task B2)。
- **R-B7 文案(`features/dubbing/locales/{en,zh-CN}.json` 的 `web.dubbing.roles`,`:26-36`):** 删 `role`(「角色 {{key}}」);加 `label`「{{color}}·{{name}}」(两种语言同模板)、
  `default.{A..F}`、`color.{red,blue,green,yellow,purple,orange}`(红 / Red …)、`unassigned`「未分配」/ "No role";`rename` / `nameFor` / `sentenceRole` 的占位符从 `{{key}}` 改为 `{{role}}`(显示标签),
  `sentenceRole` 变成「第 {{n}} 句的角色:{{role}}」/ "Role of sentence {{n}}: {{role}}"。`clip.mark.{start,end,both}`(起 / 止 / 起止;Start / End / Start–End)、`clip.half`。

### C 对话做首页

- **R-C1 一个常量:`web/src/lib/home-route.ts` 导出 `HOME_PATH`。** `lib/` 是最底层,`app.tsx`、`pages/`、各 feature、`lib/extension-points-react.tsx` 都能用;不做 hook、不读配置。
- **R-C2 什么算「回首页」(改成 `HOME_PATH`):**
  `app.tsx:121`(兜底 `*`,也覆盖 `/`;没有单独的 `/` 路由)、`pages/login-page.tsx:46`(登录后默认落点)、`features/account/signup-page.tsx:46`、`:75`(已登录 / 注册成功)、
  `features/account/forgot-password-page.tsx:32`(已登录)、`lib/extension-points-react.tsx:47`(`LinkRoute` 的默认 `fallback`,注释写明它 = 兜底行为)、
  功能关闭时的退路:`features/activation/dormant-page.tsx:17`、`features/library/library-list-page.tsx:82`、`features/library/player-page.tsx:34`、`features/dubbing/dub-home-page.tsx:57`、`features/dubbing/dub-item-page.tsx:79`(见 Q5)。
  **不算(保留 `"/practice"`,它们指「练习这个页面」):** 各页返回键 `back="/practice"`(`changelog-page.tsx:129`、`rank-home-page.tsx:79`、`wordbook/home-page.tsx:112`、`wordbook/books-page.tsx:128`、
  `practice/shadow-page.tsx:87`、`practice/history-page.tsx:55`、`practice/practice-list-page.tsx:117`、`plugins/pron-shadow/weak-words-page.tsx:61`)、配音首页的返回链接 `dub-home-page.tsx:62`、
  段位任务跳转 `rank/stage-tasks.tsx:11`、`:38`、底栏标签路径与 `also` 列表、`app.tsx:81-86` 的练习路由本身。
  `useDubbingEnabled`(`dubbing/use-dubbing-enabled.ts:4`)只控制练习页入口卡显隐,不跳转,不改。`ChatHubLayout`(`pages/chat-hub.tsx:34`)只在 `/chat` 与 `/rooms` 之间切换,不假设首页,不改。
- **R-C3 PWA:** `web/public/manifest.webmanifest:4` 的 `start_url` 改成 `/chat`(与 `HOME_PATH` 一致,由守卫测试比对)。`sw.js` 不缓存 HTML、不含路径,不改,不需要升 `CACHE`。
- **R-C4 底栏顺序:** `layout/bottom-nav.tsx:30` → `[CHAT, PRACTICE, ...(libraryOn ? [LIBRARY] : []), ME]`,注释 `:29` 同步。`also` 不变:`对话` 仍覆盖 `/rooms`(`:18`),`练习` 仍覆盖 `/wordbook`(`:16`)。
  `/dub` 今天不在任何 `also` 里(停留时没有标签高亮),本计划不改(另议)。
- **R-C5 两步走:** C1 先把所有「回首页」改用 `HOME_PATH`,**值仍是 `"/practice"`**(纯重构,现有测试一条不改);C2 再把值改成 `"/chat"`、改 `start_url` 与测试期望。回滚 C2 只需一个 revert。
- **R-C6 服务端:** `server/app` 里没有指向 `/practice` 的跳转或链接(grep 只命中 `/api/practice-items` 等接口路径与 `"practice"` 枚举值);`admin/` 无命中。**不改服务端。**
- **R-C7 E2E:** `web/e2e/support/auth.ts` 导出 `HOME_URL = /\/chat$/`,登录 / 注册后的断言全部用它;依赖「登录后就在练习页」的三个规格在 `signIn` 后补 `await page.goto("/practice")`。

## 文件结构(本计划触碰的全部文件)

| 文件 | 动作 | 任务 |
|---|---|---|
| `web/src/lib/storage.ts` | 加 `ZH_DEFS_PREF_KEY` | A1 |
| `web/src/settings/zh-defs-pref.ts` + `.test.ts`、`settings/CLAUDE.md` | 新建 / 文档 | A1 |
| `web/src/auth/device-data.ts` + `.test.ts`、`auth/CLAUDE.md` | 登出清理 | A1 |
| `web/src/components/zh-defs-cover.tsx` + `.test.tsx`、`components/CLAUDE.md` | 新建 / 文档 | A2 |
| `web/src/pages/me-page.tsx` + `.test.tsx`、`web/src/i18n/{en,zh-CN}.json`、`pages/CLAUDE.md` | 「我的」一行 | A3 |
| `features/wordbook/{word-card,recall-card,after-answer-panel,learn-page,review-page,free-browse}.tsx`、`locales/{en,zh-CN}.json`、新测试 `zh-defs-cover-wiring.test.tsx`、`wordbook/CLAUDE.md` | 接线 | A4 |
| `features/lookup/{dictionary-result.tsx,glass.ts}`、`i18n/{en,zh-CN}.json`、`dictionary-result.test.tsx`、`lookup/CLAUDE.md` | 接线 | A5 |
| `features/dubbing/{dubbing.css,role-identity.tsx}` + `role-identity.test.tsx`、`dubbing-css.test.ts`、`locales/{en,zh-CN}.json`、`dubbing/CLAUDE.md` | 新建 | B1 |
| `features/dubbing/{role-picker,dub-item-page,take-history,rehearsal-view,dub-session}.tsx` + 测试 `role-picker`、`take-history`、`rehearsal-view`、`role-labels` | 角色显示 | B2 |
| `features/dubbing/clip-picker.tsx` + `clip-picker.test.tsx`、`dubbing.css`、`locales/*.json` | 选中样式 | B3 |
| `web/src/lib/home-route.ts`、`web/src/home-route.test.ts`、上文 R-C2 列出的 11 处、`lib/CLAUDE.md`、`dubbing/CLAUDE.md`(Allowed deps 一行) | 重构 | C1 |
| `lib/home-route.ts`、`public/manifest.webmanifest`、R-C2 的单测(见 C2)、`plugins/CLAUDE.md:22`、`features/activation/CLAUDE.md:4` | 切换首页 | C2 |
| `web/src/layout/bottom-nav.tsx` + `.test.tsx`、`layout/CLAUDE.md:7` | 底栏顺序 | C3 |
| `web/e2e/support/{auth,accounts}.ts`、`login`、`captcha`、`accounts`、`accounts-admin`、`practice`、`wordbook`、`links` 规格、`e2e/CLAUDE.md` | E2E | C4 |
| `web/README.md` | 文档 | D1 |

不改:`server/**`(含 `dubbing_contract.json`)、`enjoy/**`、`styles/theme.css`、`components/zh-toggle.tsx`、`features/dubbing/{role-labels,dubbing-api,clip}.ts(x)`、`pages/chat-hub.tsx`、`src/architecture.test.ts`(边不变,不需要新断言)。

---

## Task 0:核对(不提交)

- [ ] **0.1** 每条车道各开一个 worktree(从 `merge/integ-10-21` 拉分支:`feat/zh-defs`、`feat/dub-roles`、`feat/chat-home`),确认上文引用的行号仍成立;不成立以实际代码为准并在 PR 描述里记一句。重点:
  `word-card.tsx:95-108、:141-152`、`after-answer-panel.tsx:38-62`、`recall-card.tsx:25-48`、`review-page.tsx:86、:299、:320`、`learn-page.tsx:47、:270`、`free-browse.tsx:25、:56`、
  `dictionary-result.tsx:14-42`、`me-page.tsx:215-244`、`device-data.ts:18-29`、`clip-picker.tsx:51-69`、`role-picker.tsx:37-66`、`dub-item-page.tsx:79、:92、:125、:157-167、:188`、
  `take-history.tsx:23`、`bottom-nav.tsx:16-30`、`app.tsx:121`。
- [ ] **0.2** 名字没被占用:`rg -n "zh-defs|ZhDefs|zhCover|home-route|HOME_PATH|HOME_URL|role-identity|dub-root|data-sel" web/src web/e2e` 应为空(2026-10-23 读时为空)。
- [ ] **0.3** 基线绿(只跑本计划会碰的测试):
  `web 'yarn vitest run src/features/wordbook src/features/lookup src/features/dubbing src/settings src/auth/device-data.test.ts src/pages/me-page.test.tsx src/layout src/lib src/pages/login-page.test.tsx src/features/account src/features/library/library-list-page.test.tsx src/features/library/player-page.test.tsx src/features/activation src/architecture.test.ts src/i18n/i18n.test.ts src/styles'`,
  然后 `web 'yarn typecheck'`。

## 车道 A:中文释义「点击后显示」

### Task A1:本机偏好 `zh-defs-pref`

文件:`web/src/lib/storage.ts`、`web/src/settings/zh-defs-pref.ts`(新)、`web/src/settings/zh-defs-pref.test.ts`(新)、`web/src/auth/device-data.ts`、`web/src/auth/device-data.test.ts`、`settings/CLAUDE.md`、`auth/CLAUDE.md`

- [ ] **A1.1 先写失败测试**(`zh-defs-pref.test.ts`,照 `tts-voice-pref.test.ts:21-30` 的 before/after 清理):没存 → `"auto"`;`setZhDefsMode("tap")` 后存储里是 `"tap"`、`getZhDefsMode()` 为 `"tap"`;
  选回 `"auto"` 后键被删除;存储里是 `"TAP"`、`1`、`{}`、坏 JSON → `"auto"`;`renderHook(useZhDefsMode)` 在 `setZhDefsMode` 后重渲染;`resetZhDefsModeMemory()` 后重新从存储读;
  `localStorage.setItem` 抛错时 `setZhDefsMode` 不抛、内存里仍生效。`device-data.test.ts` 追加:存了 `"tap"` → `clearDeviceData()` 后键为空、`getZhDefsMode()` 为 `"auto"`。
- [ ] **A1.2 实现:** 按 R-A1;`device-data.ts` 在 `:22` 后加 `removeKey(ZH_DEFS_PREF_KEY)`,在 `:29` 后加 `resetZhDefsModeMemory()`。
- [ ] **A1.3 文档:** `settings/CLAUDE.md`「What lives here」加一行 `zh-defs-pref.ts`(键、取值、默认、登出清理、与 `def_lang` 的分工见计划 R-A2);`auth/CLAUDE.md:10` 的清单补「中文释义偏好」。
- [ ] **A1.4 验证:** `web 'yarn vitest run src/settings/zh-defs-pref.test.ts src/auth/device-data.test.ts src/architecture.test.ts && yarn typecheck'`
- [ ] **A1.5 提交:** `feat(web): device pref for showing Chinese definitions on tap`
- 回滚:`git revert`;已写入的 `enjoy-web.defs.zh` 无人读取,下次登出被清(若 A1 已回滚则留在本机,无害)。

### Task A2:原位揭开组件 `ZhDefsCover`

文件:`web/src/components/zh-defs-cover.tsx`(新)、`web/src/components/zh-defs-cover.test.tsx`(新)、`components/CLAUDE.md`

- [ ] **A2.1 先写失败测试:**
  - `active={false}`:渲染结果与直接渲染 `children` 的 `innerHTML` 完全相同(没有包裹、没有 testid)。
  - `active` 隐藏态:有 `zh-defs-cover`(`data-state="hidden"`)与按钮 `zh-defs-reveal`(名称 = 传入的 label、`aria-expanded="false"`、类含 `min-h-tap`、`w-full` 与 `offsetClassName`);
    内容层有 `aria-hidden="true"` 且类含 `invisible`;`[data-zh-sizer]` 存在且类含 `min-h-tap` 与 `offsetClassName`;`getByText(中文)` 不可见(`not.toBeVisible()`);组件源码里没有 `-tint`。
  - 点按钮后:按钮消失、`data-state="shown"`、内容层没有 `invisible` / `aria-hidden`、`[data-zh-sizer]` 仍在、`document.activeElement` 是内容层。
  - 同一 `resetKey` 重渲染保持揭开;换 `resetKey` 回到隐藏。
- [ ] **A2.2 实现:** 按 R-A3。只依赖 `react`、`lucide-react`(`EyeIcon`)、`~/lib/cn`。
- [ ] **A2.3 文档:** `components/CLAUDE.md` 在 `zh-toggle.tsx` 一行后加 `zh-defs-cover.tsx`(无文案、`resetKey` 复位、三层叠放与尺寸约定、`active=false` 时零包裹;计划 2026-10-23 R-A3)。
- [ ] **A2.4 验证:** `web 'yarn vitest run src/components/zh-defs-cover.test.tsx src/styles/liquid-colour-guard.test.ts src/architecture.test.ts && yarn typecheck'`
- [ ] **A2.5 提交:** `feat(web): ZhDefsCover hides a Chinese block in place until tapped`
- 回滚:`git revert`(此时还没有使用者)。

### Task A3:「我的 → 中文释义」

文件:`web/src/pages/me-page.tsx`、`web/src/pages/me-page.test.tsx`、`web/src/i18n/en.json`、`web/src/i18n/zh-CN.json`、`pages/CLAUDE.md`(依赖 A1)

- [ ] **A3.1 先写失败测试**(`me-page.test.tsx`,照 `:74` 附近 `me-playback-rate` 的写法):「偏好」组里 `me-zh-defs` 紧跟在 `me-playback-rate` 之后(DOM 顺序);默认显示「自动显示」;
  选 `tap` 后 `getZhDefsMode()` 为 `"tap"`、行上显示「点击后显示」,`enjoy-web.settings` 的整对象断言不变(偏好不在那个键里)。`i18n.test.ts` 不改(两份文件同时加键即通过)。
- [ ] **A3.2 实现:** 在 `me-page.tsx:220` 之后(朗读语速 `SelectRow` 结束处)加一个 `SelectRow`(`id={`${id}-zh-defs`}`、`testId="me-zh-defs"`、图标 `EyeOffIcon`、选项来自 `ZH_DEFS_MODES`),读写用 `useZhDefsMode()` / `setZhDefsMode()`;文案按 R-A7。
- [ ] **A3.3 文档:** `pages/CLAUDE.md:6` 的「偏好」列表加「中文释义(自动显示 / 点击后显示,`settings/zh-defs-pref.ts`)」。
- [ ] **A3.4 验证:** `web 'yarn vitest run src/pages/me-page.test.tsx src/i18n/i18n.test.ts src/settings && yarn typecheck'`
- [ ] **A3.5 提交:** `feat(web): 我的 → 中文释义 自动显示 / 点击后显示`
- 回滚:`git revert`;偏好仍可能留在本机,但没有入口也没有读者(A4/A5 未合入时)。

### Task A4:背单词学新词 / 复习接线

文件:`features/wordbook/word-card.tsx`、`recall-card.tsx`、`after-answer-panel.tsx`、`learn-page.tsx`、`review-page.tsx`、`free-browse.tsx`、`locales/{en,zh-CN}.json`、
新测试 `features/wordbook/zh-defs-cover-wiring.test.tsx`、`features/wordbook/CLAUDE.md`(依赖 A1、A2)

- [ ] **A4.1 先写失败测试**(新文件,`beforeEach` 切 `zh-CN`,同 `word-card-defs.test.tsx:17-24`;卡片用 `test-fixtures.ts` 的 `card()` 与 `DEFS_EN`):
  - `WordCardView zhCover defLang="both"`:`zh-defs-cover` 在、按钮「显示中文释义」在,中文行不可见、英文释义 `word-defs-en` 可见;点后中文可见、按钮消失;以新 `card.key` 重渲染 → 又藏起。
  - `defLang="zh"` 同样被盖住;`defLang="en"` 且有英文释义 → **没有** `zh-defs-cover`,`def-peek`(「中」)照旧;点「中」后中文直接显示、仍没有 `zh-defs-cover`。`defLang="en"` 但没有英文释义(回退中文)→ 被盖住。
  - `covered`(学新词遮罩)时没有 `zh-defs-cover`;揭开遮罩后才出现(遮罩逻辑不变)。
  - 不传 `zhCover`:输出与改动前相同(`word-card-legacy.test.tsx`、`word-card-defs.test.tsx`、`word-card-peek.test.tsx`、`word-card-zh-chip.test.tsx` 不改、照旧通过)。
  - `AfterAnswerPanel`(meaning 题,`defLang="both"`,`zhCover`)中文行被盖住,`offsetClassName` 是 `mt-2`;非 meaning 题走 `WordCardView` 同样被盖住;`defLang="en"` 时只有「中文」`after-zh`。
  - 页面级(在现有页面测试旁新增用例,`learn-page.test.tsx`、`review-page.test.tsx` 各一条):`setZhDefsMode("tap")` 后翻开的卡有 `zh-defs-cover`;复习页同一个词在下一题槽再次出现时又是隐藏态(`key={slot}`)。
- [ ] **A4.2 实现:**
  - `WordCardView` 新属性 `zhCover?: boolean`(默认 `false`);用 `zhReveal(defLang, card, false).view.showSenses` 判断「本来就显示」;`:141-150` 的 `<ul>` 外包
    `<ZhDefsCover active={zhCover && shownByDefault} resetKey={card.key} label={t("web.wordbookDefs.peek.label")} offsetClassName="mt-3.5">`。
  - `RecallCard` / `Back` 透传 `zhCover`;`AfterAnswerPanel` 新属性 `zhCover`,meaning 分支 `:51-60` 同样包裹(`offsetClassName="mt-2"`,`resetKey={shown.key}`),非 meaning 分支传给 `WordCardView`。
  - `learn-page.tsx`、`review-page.tsx`、`free-browse.tsx` 各调用 `useZhDefsMode()`,传 `zhCover={mode === "tap"}`;`review-page.tsx:320` 给 `<AfterAnswerPanel>` 加 `key={slot}`。`learned-page.tsx` 不改(R-A4)。
  - `locales/{en,zh-CN}.json` 的 `setting.help` 末尾补一句(R-A7)。
- [ ] **A4.3 文档:** `wordbook/CLAUDE.md` Pitfalls 的「释义显示默认…」一条后加:「「我的 → 中文释义」点击后显示(`~/settings/zh-defs-pref`):学新词、复习背面、答后区、自由复习浏览由页面传 `zhCover`,`WordCardView` / `AfterAnswerPanel` 用 `ZhDefsCover` 原位盖住**本来会显示**的中文释义(`def_lang` en 时仍是「中」/「中文」);已学词弹层不传;揭开不影响 `peeked` / `revealedBefore`(计划 2026-10-23 R-A2/R-A5/R-A8)。」
- [ ] **A4.4 验证:** `web 'yarn vitest run src/features/wordbook src/lookup-marks.test.ts src/styles/liquid-colour-guard.test.ts src/architecture.test.ts && yarn typecheck'`
- [ ] **A4.5 提交:** `feat(web): wordbook learn and review cards honour the Chinese-definition pref`
- 回滚:`git revert`;默认「自动显示」时本提交不改变任何输出。

### Task A5:点词查词结果接线

文件:`features/lookup/dictionary-result.tsx`、`features/lookup/glass.ts`、`features/lookup/i18n/{en,zh-CN}.json`、`features/lookup/dictionary-result.test.tsx`、`features/lookup/CLAUDE.md`(依赖 A1、A2;与 A4 互不依赖)

- [ ] **A5.1 先写失败测试**(`dictionary-result.test.tsx` 新 `describe("DictionaryResult · 中文释义点击显示")`,`beforeEach` 里 `setZhDefsMode("tap")`、`afterEach` 里 `resetZhDefsModeMemory()` + 清键):
  - `defLang: "both"`:`lookup-dict-zh` 在 `zh-defs-cover` 里且不可见,按钮名称「显示中文释义」,类含玻璃井令牌(`--glass-well`);点后可见;`rerender` 一个新 `entry` 对象 → 又藏起。
  - `defLang: "en"` 且有英文释义:没有 `zh-defs-cover`,`lookup-zh` 照旧;按下后中文直接可见。`defsEn: []`(回退中文)→ 被盖住。
  - 偏好 `"auto"`:现有用例全部照旧(文件里原有 `describe` 不改)。`lookup-bar.test.tsx:104`、`:177` 不受影响(默认 auto)。
- [ ] **A5.2 实现:** `DictionaryResult` 调用 `useZhDefsMode()`;`const shownByDefault = drawerDefs(entry, false).zh.length > 0`;`:26-32` 的列表外包
  `<ZhDefsCover active={mode === "tap" && shownByDefault} resetKey={entry} label={t("web.lookup.zhReveal")} className={LOOKUP_ZH_COVER}>`(在 `space-y-2` 容器里,外边距由容器给,不需要 `offsetClassName`)。
  `glass.ts` 加 `LOOKUP_ZH_COVER = "border-[color:var(--glass-well-bd)] bg-[color:var(--glass-well)]"`(不带 `rounded-full`,块状按钮;不模糊)。AI 结果与翻译模式不动(R-A4)。
- [ ] **A5.3 文档:** `lookup/CLAUDE.md` 「中文」chip 一条后加:「「我的 → 中文释义」选点击后显示时,词典命中里**本来显示**的中文释义由 `ZhDefsCover` 原位盖住(每次查词复位,`resetKey = entry`);`def_lang` en 的「中文」chip 不变;AI 结果与翻译不受影响(计划 2026-10-23 R-A4)。」
- [ ] **A5.4 验证:** `web 'yarn vitest run src/features/lookup src/styles/glass-lookup.test.ts src/styles/glass-budget.test.ts src/i18n/i18n.test.ts src/architecture.test.ts && yarn typecheck'`
- [ ] **A5.5 提交:** `feat(web): tap-lookup results honour the Chinese-definition pref`
- 回滚:`git revert`。

## 车道 B:配音选段与角色

### Task B1:角色身份表 + 柔和令牌

文件:`features/dubbing/dubbing.css`(新)、`features/dubbing/role-identity.tsx`(新)、`role-identity.test.tsx`(新)、`dubbing-css.test.ts`(新)、`locales/{en,zh-CN}.json`、`dubbing/CLAUDE.md`

- [ ] **B1.1 先写失败测试:**
  - `role-identity.test.tsx`:英文 `roleLabel(t, "A")` = `Red·Alex`,中文 = `红·Alex`;六个键各有不同颜色;`roleLabel(t, "A", "Host")` = `Red·Host`、`"  "` 视为没有自定义名;
    `<RoleTag role="B">` 渲染 `[data-role-color="blue"][aria-hidden="true"]` 圆点 + 文字 `Blue·Bella`;任何输出都不含 `Role A` / `角色 A`。
  - `dubbing-css.test.ts`(`@vitest-environment node`,照 `practice/shadow/shadow-css.test.ts:7-30` 的 `blockOf`):`.dub-root {}` 与 `.dark .dub-root {}` 都定义 R-B4 表里的每个令牌;
    按 R-B4 的四条对比度守卫计算(`--ink` / `--surface` 从 `styles/theme.css` 的 `:root` / `.dark` 读,复用 `theme.test.ts:53-64` 的算法——拷一份小函数,不导出测试工具);
    文件里没有 `backdrop-filter`;`role-identity.tsx` 与 `clip-picker.tsx` 都 `import "./dubbing.css"`(B3 前只断言前者,B3 补后者)。
  - `locales.test.ts` 不改(两种语言同键、占位符一致、无 emoji 由它保证)。
- [ ] **B1.2 实现:** 按 R-B1、R-B3、R-B4、R-B7(只加 `label`、`default.*`、`color.*`、`unassigned`;`role` 等旧键留到 B2 删,保证本提交独立为绿)。
- [ ] **B1.3 文档:** `dubbing/CLAUDE.md`「What lives here」加 `role-identity.tsx`(唯一的角色→颜色 / 默认名表,线上仍是 A–F,自定义名优先)与 `dubbing.css`(`.dub-root` 作用域令牌,浅 / 深两套,守卫 `dubbing-css.test.ts`)。
- [ ] **B1.4 验证:** `web 'yarn vitest run src/features/dubbing/role-identity.test.tsx src/features/dubbing/dubbing-css.test.ts src/features/dubbing/locales.test.ts src/features/dubbing/dubbing-lazy.test.ts src/styles/theme.test.ts && yarn typecheck'`
- [ ] **B1.5 提交:** `feat(web): dubbing role colours, default names and gentle selection tokens`
- 回滚:`git revert`(此时还没有使用者)。

### Task B2:所有角色显示改成「色点 + 名字」

文件:`features/dubbing/role-picker.tsx`、`dub-item-page.tsx`、`take-history.tsx`、`rehearsal-view.tsx`、`dub-session.tsx`、`locales/{en,zh-CN}.json`;
测试 `role-picker.test.tsx`、`take-history.test.tsx`、`rehearsal-view.test.tsx`、`role-labels.test.tsx`、`dub-session.test.tsx`(只在需要时);`dubbing/CLAUDE.md`(依赖 B1)

- [ ] **B2.1 先改 / 写测试(先红):**
  - `role-picker.test.tsx:11-13`:`/Role A/` → `/Red·Alex/`、`/Role C/` → `/Green·Chris/`、`/Role B/` → `/Blue·Bella/`;`:19` `/Host/` 不变(现在是 `Red·Host`);
    `:25-32`、`:39` 的 `"Rename role A"` → `"Rename Red·Host"`、`"Name for role A"` → `"Name for Red·Host"`。新增:每张卡里有自己颜色的圆点;选中卡 `aria-pressed="true"` 且带对勾图标。
  - `take-history.test.tsx:23`:`getByText("B")` → `getByText("Blue·Bella")`;新增「`names={{ B: "Narrator" }}` 时显示 `Blue·Narrator`」。
  - `rehearsal-view.test.tsx:35-36`:夹具改成 `roleName="Red·Alex"`,期望 `You are Red·Alex`;新增「传 `role="A"` 时有 `[data-role-color="red"]` 圆点」。
  - `role-labels.test.tsx` 新增回归:「循环到 F 再到无,保存体里只有字母 `A`..`F` / `null`,从不出现显示名」(界面不再显示字母,这条钉住线上协议,R-B2)。现有用例不改。
  - 页面接线没有单独的页面测试(`dub-item-page.tsx` 今天没有测试);小标的 `aria-label` 与 `RoleTag` 在 `role-identity.test.tsx` 里补一条 `sentenceRole` 文案用例。
- [ ] **B2.2 实现:** 按 R-B6、R-B7;删除 `roles.role` 键,`rename` / `nameFor` / `sentenceRole` 改占位符;`RehearsalView` 加可选 `role?: RoleKey`,`DubSession` 透传 `role`(它已有 `role` 属性,`dub-session.tsx:25`)。
  `rg -n "roles\.role\"|Role \{\{key\}\}|角色 \{\{key\}\}" web/src` 应为空。
- [ ] **B2.3 文档:** `dubbing/CLAUDE.md` Pitfalls 加:「角色在界面上只显示为 `RoleTag`(色点 + 颜色词 + 名字),线上 / 存储永远是 A–F;不要在任何地方再拼『角色 A』。」;`rehearsal-view.tsx:14` 注释同步。
- [ ] **B2.4 验证:** `web 'yarn vitest run src/features/dubbing && yarn typecheck'`
- [ ] **B2.5 提交:** `feat(web): dubbing shows roles as colour + name instead of Role A–F`
- 回滚:`git revert`;服务端数据从未改变,无需迁移。

### Task B3:选段「效果 A」柔和版

文件:`features/dubbing/clip-picker.tsx`、`clip-picker.test.tsx`、`dubbing.css`、`dubbing-css.test.ts`、`locales/{en,zh-CN}.json`、`dub-item-page.tsx`(根 `div` 加 `dub-root`)、`dubbing/CLAUDE.md`(依赖 B1;在 B2 之后做,避免 locales 冲突)

- [ ] **B3.1 先写失败测试**(`clip-picker.test.tsx` 新 `describe("selection design A (gentle)")`):
  - 纯函数 `clipMark`:`null` → 全 `none`;`{from:1,to:null}` → 第 1 句 `half`、其余 `none`;`{from:1,to:3}` → `start`/`mid`/`end`;`{from:2,to:2}` → `single`。
  - 渲染:每个 `li` 的 `data-sel` 与上面一致;选中(含半选)行的句子按钮 `aria-pressed="true"`,未选中 `false`;起点按钮名称含 `Start`、终点含 `End`、单句含 `Start–End`、中间行有 `[data-testid="clip-check"]`;
    半选时页脚是 `clip.half` 文案(含句号 n);选中行与未选中行的类 / 属性不同(断言 `data-sel` 而非颜色)。
  - 现有六个用例不改(尤其 `:49-62`「小标不嵌在句子按钮里」)。
  - `dubbing-css.test.ts` 补:`[data-sel="half"]` 用 `dashed`;选中规则只引用 `--dub-sel*` / `--dub-mark-*` 令牌,没有字面颜色;`clip-picker.tsx` 导入 `./dubbing.css`。
- [ ] **B3.2 实现:** 按 R-B5;`dub-item-page.tsx:92` 根 `div` 加类 `dub-root`。行仍是 `li > [小标兄弟] + button`,按钮内 `文字 + 小标`。
- [ ] **B3.3 文档:** `dubbing/CLAUDE.md` 的 `clip-picker.tsx` 条目加「选中状态 `data-sel`(none/half/start/mid/end/single),样式在 `dubbing.css`,柔和取值见计划 2026-10-23 R-B4;小标与句子按钮是兄弟节点」。
- [ ] **B3.4 验证:** `web 'yarn vitest run src/features/dubbing && yarn typecheck'`;再确认服务端契约没动:`git diff --exit-code merge/integ-10-21 -- server/`
- [ ] **B3.5 提交:** `feat(web): dubbing clip picker selection design A with gentle contrast`
- 回滚:`git revert`(B1 的令牌留着无害)。

## 车道 C:对话做首页

### Task C1:一个 `HOME_PATH`(值仍是 `/practice`,纯重构)

文件:`web/src/lib/home-route.ts`(新)、`web/src/home-route.test.ts`(新)、R-C2 列出的 11 处、`lib/CLAUDE.md`、`features/dubbing/CLAUDE.md`(Allowed dependencies 一行)

- [ ] **C1.1 先写失败测试**(`src/home-route.test.ts`,node 环境,读源码文本,与 `architecture.test.ts` 同样的 `walk`):
  - 产品代码(非测试)里没有 `Navigate to="/practice"`、`navigate("/practice"`、`?? "/practice"`、`fallback = "/practice"`;
  - `app.tsx` 含 `<Navigate to={HOME_PATH} replace />`;`login-page.tsx`、`signup-page.tsx`、`forgot-password-page.tsx`、`extension-points-react.tsx` 都引用 `HOME_PATH`;
  - `public/manifest.webmanifest` 的 `start_url === HOME_PATH`(C1 时两者都是 `/practice`,C2 时都是 `/chat`)。
- [ ] **C1.2 实现:** `export const HOME_PATH = "/practice";`(C2 改值),逐处替换 R-C2「算回首页」的 11 处;返回键等「不算」的一律不动。
- [ ] **C1.3 文档:** `lib/CLAUDE.md` 加 `home-route.ts`(`HOME_PATH`:登录后落点、兜底、功能关闭的退路;返回键不用它);`dubbing/CLAUDE.md` Allowed dependencies 加 `~/lib/home-route`。
- [ ] **C1.4 验证:** `web 'yarn vitest run src/home-route.test.ts src/architecture.test.ts src/pages/login-page.test.tsx src/pages/login-page.captcha-chunk.test.tsx src/features/account src/lib/extension-points.test.tsx src/features/activation src/features/library/library-list-page.test.tsx src/features/library/player-page.test.tsx src/features/dubbing/dub-home-page.test.tsx && yarn typecheck'`(现有期望一条不改,全部照旧通过)
- [ ] **C1.5 提交:** `refactor(web): one HOME_PATH for every go-home redirect`
- 回滚:`git revert`;行为本来就没变。

### Task C2:首页切到 `/chat`

文件:`web/src/lib/home-route.ts`、`web/public/manifest.webmanifest`;测试 `pages/login-page.test.tsx`、`pages/login-page.captcha-chunk.test.tsx`、`features/account/signup-page.test.tsx`、
`lib/extension-points.test.tsx`、`features/activation/dormant-page.test.tsx`、`features/library/library-list-page.test.tsx`、`features/library/player-page.test.tsx`、`features/dubbing/dub-home-page.test.tsx`;
`plugins/CLAUDE.md:22`、`features/activation/CLAUDE.md:4`(依赖 C1)

- [ ] **C2.1 先改测试(先红):** 这些测试里注册的 `<Route path="/practice" element={<div>practice home</div>} />` 改成 `<Route path={HOME_PATH} element={<div>home</div>} />`,
  期望文字 `practice home` → `home`,`toHaveTextContent("/practice")` / `toBe("/practice")` → `HOME_PATH`。具体位置:`login-page.test.tsx:26、:37(用例名)、:42、:68、:146、:168、:196`;
  `login-page.captcha-chunk.test.tsx:28、:56、:62`;`signup-page.test.tsx:30、:122、:151、:241`;`extension-points.test.tsx:116、:124、:145(用例名)、:148`;`dormant-page.test.tsx:34-36`;
  `library-list-page.test.tsx:36-37`;`player-page.test.tsx:57-58`;`dub-home-page.test.tsx:53、:117(用例名)、:122`。另在 `home-route.test.ts` 加 `expect(HOME_PATH).toBe("/chat")`。
  不改:`pages/chat-hub.test.tsx:70-76`(`/practice` 只是任意起点)、`use-tap-lookup.test.tsx`、`rank-*.test.tsx`、`changelog-entry.test.tsx`、`daily-tasks-card.test.tsx`、`glass-route-pin.test.tsx`(都只是把 `/practice` 当普通页面)。
- [ ] **C2.2 实现:** `HOME_PATH = "/chat"`;`manifest.webmanifest:4` → `"start_url": "/chat"`。
- [ ] **C2.3 文档:** `plugins/CLAUDE.md:22`「到了但不可见则回 `/practice`」→「回首页 `HOME_PATH`(`/chat`)」;`activation/CLAUDE.md:4`「跳回 `/practice`」→「跳回首页 `/chat`」。
- [ ] **C2.4 验证:** 同 C1.4 的命令。
- [ ] **C2.5 提交:** `feat(web): 对话 (/chat) is the home page`
- 回滚:`git revert` 这一提交即回到练习页做首页(manifest 一起回去;已安装的 PWA 在下次拉取 manifest 后跟随)。

### Task C3:底栏顺序 对话 · 练习 · 跟读库 · 我的

文件:`web/src/layout/bottom-nav.tsx`、`web/src/layout/bottom-nav.test.tsx`、`layout/CLAUDE.md`(与 C1 / C2 无依赖,可并行)

- [ ] **C3.1 先改测试:** `bottom-nav.test.tsx:27` → `["/chat", "/practice", "/me"]`,`:32` → `["/chat", "/practice", "/library", "/me"]`,用例名里的顺序描述同步;
  新增「`/wordbook/learn` 高亮练习、`/rooms/ended` 高亮对话」各一条(若 `:60-110` 的现有高亮用例已覆盖则只核对,不重复)。`layout.test.tsx:33`、`feature-flags.test.tsx:48` 只查存在,不改。
- [ ] **C3.2 实现:** 按 R-C4。
- [ ] **C3.3 文档:** `layout/CLAUDE.md:7` 的「练习 · 对话 · 跟读库 · 我的」→「对话 · 练习 · 跟读库 · 我的(对话是首页,`lib/home-route.ts`)」。
- [ ] **C3.4 验证:** `web 'yarn vitest run src/layout src/architecture.test.ts && yarn typecheck'`
- [ ] **C3.5 提交:** `feat(web): bottom nav order 对话 · 练习 · 跟读库 · 我的`
- 回滚:`git revert`。

### Task C4:E2E 规格同步(只做类型检查,不运行)

文件:`web/e2e/support/auth.ts`、`web/e2e/support/accounts.ts`、`login.spec.ts`、`captcha.spec.ts`、`accounts.spec.ts`、`accounts-admin.spec.ts`、`practice.spec.ts`、`wordbook.spec.ts`、`links.spec.ts`、`web/e2e/CLAUDE.md`(依赖 C2)

- [ ] **C4.1 改:**
  - `support/auth.ts`:导出 `export const HOME_URL = /\/chat$/;`,`:39` 改成 `await expect(page).toHaveURL(HOME_URL);`(E2E 是 CommonJS 包,不从 `src/` 导入常量)。
  - `support/accounts.ts:85` → `HOME_URL`,`:74` 注释「停在 /practice」→「停在首页 /chat」。
  - 登录 / 注册后的 `toHaveURL(/\/practice$/)` → `toHaveURL(HOME_URL)`:`login.spec.ts:14、:21`;`captcha.spec.ts:170、:231、:255、:272`;
    `accounts.spec.ts:93、:107、:111、:147、:181、:234、:262、:284、:319`;`accounts-admin.spec.ts:387`(行尾注释改成「落在首页」)。
  - 依赖「登录后就在练习页」的:`practice.spec.ts:12` 后加 `await page.goto("/practice");`(下一行要 `reference-input`);`wordbook.spec.ts:11` 后加同一行(`:14` 要练习页的 `wordbook-card`);
    `links.spec.ts:36` 之后、`:42` 之前加同一行(要练习页的 `daily-tasks-card`;`:48` 的 `reload()` 仍在 `/practice`)。
- [ ] **C4.2 不改、只核对(写进 PR 描述:「读代码核对,未运行」):** `accounts-admin.spec.ts:360-361`、`:372-373`(显式 `goto("/practice")` 再断言)、`chat.spec.ts:316-321`(点 `nav-practice` 与练习清单跳回 `/practice`)、
  `rank.spec.ts:27`、`wordbook.spec.ts:55`(显式 goto)、`login.spec.ts:30-38`(深链 `/chat`)、`login.spec.ts:48`(只量三个导航项高度,与顺序无关)、`progress.spec.ts:7`、`scenario-spot-check.spec.ts:34`(在 `/chat` 上点 `nav-chat` 不跳转)、
  `admin-v2.spec.ts:164`(任何页面都有 `nav-practice`)、其余规格都在 `signIn` 后自己 `goto`。`wordbook-recall.spec.ts` 把账号设成「中英」后断言中文——中文释义偏好默认「自动显示」,不受 A 车道影响。
- [ ] **C4.3 文档:** `e2e/CLAUDE.md` Pitfalls 加:「登录后落在首页 `/chat`(`support/auth.ts` 的 `HOME_URL`);需要练习页的规格先 `goto("/practice")`。」
- [ ] **C4.4 验证:** `web 'yarn typecheck'`(E2E 规格在 `tsconfig.json` 里,只做类型检查)。**不运行** Playwright。
- [ ] **C4.5 提交:** `test(web): e2e expects /chat after sign-in`
- 回滚:`git revert`(与 C2 一起回滚)。

## Task D1:README(三条车道都合入后)

文件:`web/README.md`

- [ ] **D1.1** `:135`「我的」偏好列表加「中文释义(自动显示 / 点击后显示,只存本机)」,并在背单词 / 查词段落各加一句行为说明与「真机未验证」标注(单手点按、揭开不跳动)。
- [ ] **D1.2** `:183` 配音段落加「角色显示为色点 + 名字(红·Alex …),线上仍是 A–F;选段选中样式为柔和的整行浅底 + 色条 + 起 / 止」。
- [ ] **D1.3** 加一句「登录后与打开 `/` 都进入「对话」(`/chat`);底部导航 对话 · 练习 · 跟读库 · 我的;PWA `start_url` 也是 `/chat`」;`:92`「停留在这些页面时高亮「练习」」不变。
- [ ] **D1.4 验证:** `rg -n "练习 · 对话" web/README.md web/src --glob '!**/*.test.*'` 只剩历史记录;`web 'yarn typecheck'`。
- [ ] **D1.5 提交:** `docs(web): README for 中文释义, dubbing roles and the chat home`

更新日志:按 `docs/CLAUDE.md`,合并、部署并经用户验证后由 Claude 写 `docs/changelog/2026-10.json` 草稿并提醒用户导入;不属于本计划的提交。

---

## 顺序与并行

- 三条车道**互相独立**,可以在三个 worktree 里并行:A(`feat/zh-defs`)、B(`feat/dub-roles`)、C(`feat/chat-home`)。D1 在三者都合入后做。
- 车道内:**A1 ∥ A2 → A3(需 A1)→ A4 ∥ A5(都需 A1、A2)**;**B1 → B2 → B3**(B3 只依赖 B1,但与 B2 同改 `locales/*.json`,串行省冲突);**C1 → C2 → C4**,**C3 与 C1/C2 并行**。
- 跨车道共享文件(合并时注意):`features/dubbing/dub-item-page.tsx`(B2 改 `:125`、`:157-167`、`:188`,B3 改 `:92`;C1 改 `:79`)与 `features/dubbing/CLAUDE.md`(B1–B3 与 C1 各加一行)——行不重叠,文本合并即可;
  `web/README.md` 只在 D1 改。建议合并顺序 C → A → B(C 的改动最分散,先落地让其他车道 rebase)。

## 风险

- **E2E 全部未运行**:C4 的改动只做类型检查;「应不变」的结论来自读代码(C4.2),**UNVERIFIED**。
- **真机未验证**:揭开控件的单手可点性、揭开时卡片不跳(jsdom 不做布局,测试只钉类名契约)、配音选中色在真机浅 / 深色与液态背景上的观感、角色小标在 360 px 宽句子行里的换行。
- **单行中文时卡片高约 20 px**(仅「点击后显示」模式;R-A3 的取舍,满足 44 px 点按区)。
- **隐藏中文留在 DOM**(`visibility:hidden`,读屏与点词都碰不到);若负责人要求「不在 DOM」,改成占位条会失去「同大小」保证(Q9)。
- **配音颜色值是粗算**:R-B4 的数值可能过不了 B1 的对比度守卫,需要微调;守卫阈值不降。
- **首页切换影响老习惯与已安装 PWA**:`start_url` 变化在 PWA 重新拉取 manifest 前不生效;书签 `/practice` 仍可用。功能关闭时的退路也从练习页变为对话页(Q5)。
- **README 截图**(`docs/images/readme/*.png`)里的底栏顺序会过时;本计划不重拍(需要演示环境,Q8)。
- **主包体积**:A 车道的 `zh-defs-pref.ts`、`ZhDefsCover` 与 4 个 `web.me` 键进主包(查词与「我的」在主包);预计 < +0.6 kB gzip,未测,以最终验证实测为准;B 车道全部在懒加载块;C 车道可忽略。
- **docker 构建的 `node_modules` 归 root**:并行 worktree 各自安装一份,占盘且清理需权限。

## 最终验证(三条车道合入、D1 之后,在合并后的 worktree 里)

- [ ] `web 'yarn vitest run'`(整套网页单测;`architecture.test.ts` 里 `CROSS_FEATURE_BASELINE.size` 仍是 21)
- [ ] `web 'yarn typecheck'`
- [ ] `web 'yarn build && node scripts/check-main-bundle.mjs'`;把主包 gzip 增量与 CSS 增量写进结果文档,超过 +0.6 kB 时停下来报告,不改基线文件 `scripts/main-bundle-baseline.json`(除非负责人同意)。
- [ ] `git diff --exit-code merge/integ-10-21 -- server/ enjoy/`(没有改服务端与上游);`rg -n "Role \{\{key\}\}|roles\.role\"" web/src` 为空;`rg -n 'Navigate to="/practice"' web/src` 为空。
- [ ] 结果写进 `docs/superpowers/plans/2026-10-23-zh-defs-dub-roles-chat-home-results.md`(实测 vs 未验证分开写)。
- [ ] 用户要求时才跑:`yarn web:e2e --project=chromium-mobile` 中的 `login`、`accounts`、`accounts-admin`、`captcha`、`practice`、`wordbook`、`links`、`chat`(需要 E2E 栈;`captcha`、`accounts*` 只能在一次性栈上跑)。

## 真机检查清单(用户执行;全部 **UNVERIFIED**)

- [ ] 「我的 → 中文释义」切到「点击后显示」:学新词卡揭开遮罩后中文位置是一块「显示中文释义」,单手拇指能点中;点后中文出现在同一位置,卡片不跳;下一张又藏起。
- [ ] 复习背面、答后「学习内容」、自由复习浏览同上;「仅英文」下的「中」/「中文」行为与改动前一致。
- [ ] 点词两次出查词抽屉:词典命中的中文释义被盖住,点开后同位显示;换个词又藏起。
- [ ] 配音选段:浅色与深色下选中行是淡淡的底 + 左色条,文字清楚、不刺眼;半选起点是虚线框 +「起」;角色小标是「色点 + 红·Alex」,点小标不清掉选段。
- [ ] 登录后、打开根地址、从主屏图标启动(重新安装或等 manifest 更新后)都进「对话」;底栏 对话 · 练习 · 跟读库 · 我的;`/wordbook/*` 高亮练习、`/rooms/*` 高亮对话。

## Open questions(2026-10-23 负责人已确认:全部按括号里的默认做;下列条目留作裁定依据)

- **Q1 已学词页的词卡弹层要不要也盖中文?**(默认:不盖,它是查阅,R-A4;要盖只需 `learned-page.tsx:57` 传 `zhCover`。)
- **Q2 短语译文 / 例句译文要不要跟随?**(默认:不跟随;例句已有自己的「隐藏中文」开关。)
- **Q3 查词抽屉的大模型结果(词典未命中时)里的中文意思要不要也盖?**(默认:不盖,R-A4。)
- **Q4 学新词页揭开遮罩后还要再点一次才看到中文,可以吗?**(默认:可以——两件事分开:遮罩是回忆计分,中文是显示偏好。备选:点击后显示模式下揭开遮罩同时揭开中文。)
- **Q5 功能关闭时(配音 / 跟读库 / 沉睡词 / 联动路由)退回首页 `/chat`,而不是练习页,可以吗?**(默认:可以,R-C2;备选:这几处保留 `/practice`。)
- **Q6 英文角色标签用 `Red·Alex` 这种写法、默认名两种语言都用 Alex…Fiona,可以吗?**(默认:可以。)
- **Q7 中间的已选句子用对勾、首尾用「起 / 止」(照稿子),而不是每行都有对勾?**(默认:照稿子。)
- **Q8 README 截图要不要随底栏顺序重拍?**(默认:本计划不拍,下次截图批次处理。)
- **Q9 隐藏的中文以 `visibility:hidden` 占位留在 DOM 里,可以吗?**(默认:可以,R-A3;它不计分。)
