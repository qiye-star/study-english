# 悬浮圆角玻璃底栏 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **状态:全部实现任务 BLOCKED ON MOCKUP APPROVAL。** owner 规定 UI 改动先出 HTML 视觉稿、批准后才实现。视觉稿:`docs/superpowers/design/floating-glass-bar-v1/mockup.html`(浏览器直接打开即可,自包含)。owner 在视觉稿里选定透明度(A / B / C)并回答下文「待 owner 决定」后,控制者在本文件末尾加 `## Addendum (日期)` 记录选择,再解除阻塞。

**Goal:** owner 原话(译):「把下面部分的样式改成全透明的玻璃效果,带 R 角。我不告诉你是哪一部分,你自己找。」owner 当时看的是跟读库页(等级筛选芯片 + 海报列表),即**屏幕最下方**。本计划的解读:**全站底部 Tab 栏**(练习 · 对话 · 联机 · 跟读库 · 我的)由「贴边全宽、近乎不透明(72%)的磨砂条 + 顶部发丝线」改为**离开屏幕边缘的悬浮圆角玻璃胶囊**:左右 12 px、下沿 `max(10px, 安全区 − 8px)`、圆角 28 px、几乎透明的底色(推荐 10%)+ 强模糊(28 px)+ 白色高光描边 + 柔和阴影,浅色 / 深色都做;标签可读性改由「文字光晕」保证。所有给旧底栏留空间的地方改读**一个**共享变量 `--tab-bar-space`。

**Architecture:** 新增一套只给底栏用的玻璃配方 `.glass-float`(`web/src/index.css`,自带不支持模糊 / 低端机 / 减少透明度三种回退)与标签光晕 `.tab-halo`;新令牌进 `web/src/styles/theme.css`(浅 / 深两套);底栏几何(高、间距、下沿、总占位)是 `index.css` `@layer base` 里 `:root` 上的 4 个变量。`GlassTabBar`(`web/src/components/glass-tab-bar.tsx`)换成悬浮胶囊的类名;`AppShell` 的 `<main>` 底部留白、跟读库的 `--lib-tab`、选词操作条的 `bottom` 都改读 `--tab-bar-space`。其余底部玻璃面(对话 / 房间输入条、背单词与排位的 DOCK、拼写页操作条)**不改样式也不改代码**:它们 sticky / absolute 在 `<main>` 的内容框下沿,`<main>` 的留白一变就整体上移到胶囊上方 8 px。模糊层数不变(底栏仍是同一个元素、同一层)。

**Tech Stack:** React 18 + Tailwind 3 + vitest(jsdom / node)。不改服务端、不新增依赖、不改 `enjoy/`。

**依据:** owner 2026-10-14 请求(上文 Goal);`docs/superpowers/design/redesign-v3/design-notes.md`「Glass recipe」与 Rules(每屏 ≤ 3 层模糊、不对模糊元素本身做动画);`docs/superpowers/design/video-import-v1/mockup-glass.html` 的 `.tabbar`(早已画过「左右 12 px、圆角、悬浮」的底栏,本计划沿用其方向);`web/src/features/library/library.css` 头注释(全站底栏是库页第 3 层模糊)。

## Global Constraints

- **阻塞:** T1–T4 在 owner 批准视觉稿前**一律不开始**。批准时若 owner 选了 A 或 C 透明度,按「透明度取值表」改 T1 的两个值与测试期望,其余不变。
- **验证口径(如实):** 写这份计划时**没有运行任何测试、构建或 web 服务**,只读了真实代码;下面的代码与测试是「读代码推断 + 手工推演」,第一次运行时以真实结果为准修正(尤其:tailwind-merge 对 `bottom-[var(--tab-bar-bottom)]`、`p-[3px]`、`rounded-dock`、`bg-[var(--tab-on)]` 是否原样保留;Tailwind JIT 是否生成 `pb-[var(--tab-bar-space)]` 与 `bottom-[calc(var(--tab-bar-space)+0.5rem)]`)。**唯一实测**:在视觉稿里用 Chromium(Claude 浏览器面板)量过——滚动容器有 `padding-bottom` 时,`position: sticky; bottom: 0` 的 DOCK 停在内边距上沿(DOCK 下沿离手机底 99 px,胶囊上沿 91 px,间距 8 px;改成 `static` 时 DOCK 在屏幕外)。iOS Safari / Android Chrome 真机**全部未验证**,见文末「真机清单」。
- **分层:** `web/src/architecture.test.ts` 不放宽;不新增任何跨 feature 导入(`CROSS_FEATURE_BASELINE` 不变)。`components/glass-tab-bar.tsx` 仍只依赖 React 与 `@renderer/lib/utils`。
- **所有权:** 只改 `web/src/styles/theme.css`、`web/src/styles/theme.test.ts`、`web/src/index.css`、`web/src/styles/floating-tab-bar.test.ts`(新)、`web/src/components/glass-tab-bar.tsx`、`web/src/components/glass-tab-bar.test.tsx`(新)、`web/src/layout/app-shell.tsx`、`web/src/layout/layout.test.tsx`、`web/src/features/library/library.css`、`web/src/features/library/library-css.test.ts`、`web/src/features/lookup/lookup-bar.tsx`、`web/src/features/lookup/lookup-bar-offset.test.ts`(新)、`web/src/components/CLAUDE.md`、`web/src/layout/CLAUDE.md`、`docs/superpowers/design/redesign-v3/design-notes.md`(只追加 Addendum)、`docs/changelog/2026-10.json`(仅 T5,控制者)。**不碰** `enjoy/`、`server/`、`features/chat/**`、`features/rooms/**`、`features/wordbook/**`、`features/rank/**`、`features/realtime/**`、`features/agents/**`、`features/practice/**`(它们的底部玻璃面靠共享留白自动上移,不改代码)。
- **工作树是 CRLF:** 改现有文件用 Edit 工具,所有 Edit 锚点都是**单行**;锚点不匹配时先 Read 原文再改。新文件用 Write。
- **测试:** 每个任务只跑它列出的文件(`cd web && yarn vitest run <files>`)+ `src/architecture.test.ts`,外加 `yarn web:typecheck`(从仓库根)。**不跑**全量 `yarn web:test`、`yarn web:build`、E2E、容器重建(用户要求时才跑)。
- **提交:** conventional(`feat(web): …` / `docs: …`),一任务一提交,提交后该任务的测试全绿;信息以 `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` 结尾。
- **隐私:** 本计划不涉及用户数据、URL、日志。
- **文案:** 不新增、不改任何文案键(标签仍是 `web.nav.*`,`bottom-nav.test.tsx` 的 8 字符 / 4 汉字守卫不动)。

## 读代码得出的现状(写计划时核对)

| 项 | 结论 |
|---|---|
| 底栏 | `web/src/layout/bottom-nav.tsx` → `GlassTabBar`(`web/src/components/glass-tab-bar.tsx`):`<nav class="glass glass-edge-t absolute inset-x-0 bottom-0 z-30 pb-[env(safe-area-inset-bottom)]">`,`<ul class="grid h-14">`,列数由 `columns` 决定(3–5)。项类名 `tabBarItemClass`:`min-h-14`,激活 `text-blue font-semibold`,否则 `text-ink-2 font-medium`,只有 `transition-colors`。`TAB_BAR_HEIGHT = "3.5rem"` 导出但**没有任何导入者**。 |
| 玻璃配方 | `web/src/index.css` `@layer utilities`:`.glass` 默认 `--glass-solid`(.94),`@supports` 下 `--glass`(浅 .72 / 深 .66)+ `blur(20px) saturate(1.8)`,`html.lite` 用 `--glass-lite` + `blur(12px)`,`prefers-reduced-transparency` 实心 `rgb(var(--surface))`。`.glass-edge-t` = 顶部发丝线。令牌在 `web/src/styles/theme.css`,`theme.test.ts` 的 `COLOR_TOKENS` 守着两套都定义。 |
| 给底栏留空间的地方(都写死 3.5rem) | ① `web/src/layout/app-shell.tsx` `<main>` 的 `pb-[calc(3.5rem+env(safe-area-inset-bottom))]`(`layout.test.tsx` 断言这个字符串);② `web/src/features/library/library.css` `--lib-tab: calc(3.5rem + env(safe-area-inset-bottom))`(`.lib-page` 负外边距延伸到底栏下、`.lib-fab` / `.lib-gblur` / `.lib-ctrl` / `.lib-speed` 都基于它);③ `web/src/features/lookup/lookup-bar.tsx` 选词操作条 `bottom-[calc(4.5rem+env(safe-area-inset-bottom))]`(= 底栏上方 1 rem)。没有别处(Grep `3\.5rem|4\.5rem|TAB_BAR_HEIGHT|lib-tab` 已核对)。 |
| 其他「底部玻璃面」 | 对话输入条 `features/chat/conversation-page.tsx`(`glass glass-edge-t absolute inset-x-0 bottom-0 z-30`,父容器 `relative flex min-h-0 flex-1 flex-col` 在 `<main>` 内容框里);房间输入条 `features/rooms/room-composer.tsx`(同样模式,`room-page.tsx` 父容器相同);背单词 `DOCK`(`features/wordbook/ui.ts`,`glass glass-edge-t sticky bottom-0 z-30 mt-auto`,用于复习 / 学新词 / 已学 / 自由浏览 / 回忆评分 / 小结);拼写页两个 sticky 条(`features/wordbook/spell/spell-page.tsx`);排位 `match-dock`(`features/rank/match-page.tsx`)。这些都在 `<main>` 里,定位基准是 `<main>` 的内容框下沿 → 跟着留白自动移动。 |
| 不在 `<main>` 里、与底栏无关的底部面 | 通话控制台 `features/realtime/realtime-call-screen.tsx`(`fixed inset-0 z-50` 全屏盖住底栏,已是 `rounded-dock` 悬浮样式);角色编辑弹层底部按钮条 `features/agents/persona-editor-sheet.tsx`(弹层内);跟读弹层 `features/practice/shadow/shadow-sheet.css`(`fixed`,z 36 盖住底栏);`components/bottom-sheet.tsx`(z 50);跟读库添加弹层 `.library-root.lib-sheet`;`AnnouncementFrame`(`web/src/app.tsx`,只有顶部横幅,底部无元素)。 |
| 跟读库模糊预算 | `library.css` 头注释 + `library-css.test.ts`「limits blur to three surfaces」:库内只有 `.lib-glass`、`.lib-gblur`、`.lib-sheet` 写 `backdrop-filter`;全站底栏是每屏第 3 层。`player-page.test.tsx` 断言 `.lib-glass, .lib-gblur` 共 2 个。 |
| 圆角令牌 | `web/tailwind.config.*` `borderRadius.dock = 28px`(通话控制台已用);`spacing.tap = 44px`;`max-w-screen-sm` = 640 px(`bottom-sheet.tsx` 已用)。 |
| 5 个标签 @ 360 px | 现在每格 72 px。新胶囊:360 − 24(左右 12)− 2(描边)− 6(内边距)= 328 → 每格 65.6 px × 56 px,仍 ≥ 44 px;英文标签 ≤ 8 字符(11 px 下约 45 px 宽)放得下。视觉稿 360 px 模式实测每格 65 × 56。 |

## 本计划的裁定

- **R-F1 范围 = 只有全站底部 Tab 栏。** 「下面部分」是 owner 在跟读库页看到的屏幕最底部元素,全站唯一常驻、所有页面都有的就是底栏;跟读库自己的控制胶囊(`.lib-ctrl`)只在播放器页,而且早已是圆角玻璃。输入条、DOCK、拼写 / 排位操作条、通话控制台、各种弹层**样式不变**(只随留白上移,R-F5)。是否也把 DOCK 改成悬浮圆角,留作开放问题 Q3,不在本轮。
- **R-F2 几何。** `<nav>`:`absolute inset-x-3 bottom-[var(--tab-bar-bottom)] z-30 mx-auto h-16 max-w-screen-sm rounded-dock p-[3px]`;`<ul class="grid h-14">` 不变。64 px = 1 px 描边 ×2 + 3 px 内边距 ×2 + 56 px 标签行;圆角 28 px,激活小胶囊圆角 24 px(28 − 3 − 1,同心)。下沿 `--tab-bar-bottom: max(10px, calc(env(safe-area-inset-bottom) - 8px))`:有 Home 横条的 iPhone(安全区 34 px)上 26 px,胶囊下沿在横条(底部约 8–13 px)之上;没有安全区的设备 10 px。平板最宽 640 px 居中。**去掉** `pb-[env(safe-area-inset-bottom)]` 与 `glass` / `glass-edge-t`。
- **R-F3 透明度(待 owner 选)。** 新令牌 `--glass-float`:浅色 `rgba(255, 255, 255, a)`、深色 `rgba(23, 25, 30, a)`,a ∈ {A 0.06, B 0.1, C 0.16};**本计划按推荐 B = 0.1 书写**。底色**永远不为 0**(最低 0.06):它让胶囊在纯色背景上仍能看出边界、并给光晕一个一致的底。模糊 `blur(28px) saturate(1.8)`(现 `.glass` 20 px;底色降到 10% 后要靠更强的模糊把下面的文字糊成色块)。
- **R-F4 可读性规则(「全透明」下的对比度)。** 底色不再保证对比度,改由三件事保证:① **文字光晕** `.tab-halo`:标签 `text-shadow: 0 0 6px var(--tab-halo), 0 0 2px var(--tab-halo)`,图标 `filter: drop-shadow(0 0 3px var(--tab-halo))`;`--tab-halo` 浅 `rgba(255, 255, 255, 0.9)`、深 `rgba(0, 0, 0, 0.6)`。规则:标签色(`--ink-2`、`--blue`)对光晕底色(白 / 黑)的对比度 ≥ 4.5:1,且光晕 alpha ≥ 0.6——由 T1 的测试守着(浅 `ink-2` 对白 ≈ 6.2:1,深 `ink-2` 对黑 ≈ 9.1:1)。② **激活项保留小胶囊底** `--tab-on`:浅 `rgba(36, 86, 219, 0.14)`、深 `rgba(143, 176, 255, 0.2)`。③ **28 px 模糊**把下层内容抹成低频色块,不会出现清晰文字压在标签下。jsdom 量不出真实合成后的对比度:深色海报 / 亮黄海报上的实际可读性列入真机清单 F-B。光晕在「减少透明度」下关闭(此时胶囊是实心)。
- **R-F5 一个共享留白变量。** `index.css` `@layer base` 的 `:root` 定义 `--tab-bar-h: 64px`、`--tab-bar-gap: 8px`、`--tab-bar-bottom`(R-F2)、`--tab-bar-space: calc(var(--tab-bar-h) + var(--tab-bar-bottom) + var(--tab-bar-gap))`(iPhone 上 98 px,原来 90 px;无安全区 82 px,原来 56 px)。`AppShell` `<main>` 用 `pb-[var(--tab-bar-space)]`;跟读库 `--lib-tab: var(--tab-bar-space)`;选词操作条 `bottom-[calc(var(--tab-bar-space)+0.5rem)]`(胶囊上方 16 px,与原来「底栏上方 1 rem」相同)。`GlassTabBar` 导出 `TAB_BAR_SPACE = "var(--tab-bar-space)"` 取代没人用的 `TAB_BAR_HEIGHT`。**不在任何页面里单独写数值。** DOCK 与输入条因此停在胶囊上方 8 px(视觉稿实测,Chromium);这 8 px 与胶囊两侧会透出滚动内容(视觉稿 D7)。对话 / 房间页的消息列表本来就止于 `<main>` 内容框,所以胶囊后面只有页面底色(与现在一样)。
- **R-F6 回退(形状不变,只换填充)。** 不支持 `backdrop-filter`:`--glass-solid`(.94)实心;`html.lite`(`layout/glass-quality.ts`,deviceMemory ≤ 4):`blur(12px)` + `--glass-float-lite`(浅 / 深 0.62);`prefers-reduced-transparency: reduce`:`rgb(var(--surface))` 实心 + 描边改 `var(--hair)` + 无光晕。三种情况都保留圆角胶囊与悬浮位置。
- **R-F7 描边与阴影。** `border: 1px solid var(--glass-float-bd)`(浅 `rgba(255, 255, 255, 0.55)`、深 `rgba(255, 255, 255, 0.16)`);`box-shadow: var(--glass-float-hi), var(--glass-float-sh)`(浅 `inset 0 1px 0 rgba(255, 255, 255, 0.7)` / `0 10px 28px -10px rgba(17, 19, 24, 0.3), 0 1px 2px rgba(17, 19, 24, 0.06)`;深 `inset 0 1px 0 rgba(255, 255, 255, 0.14)` / `0 12px 32px -10px rgba(0, 0, 0, 0.65), 0 1px 2px rgba(0, 0, 0, 0.3)`)。原顶部发丝线去掉。
- **R-F8 不动画、不加层。** `<nav>` 本身没有 `transition` / `animate-*`(design-notes 规则:不对模糊元素做动画;只有子项的 `transition-colors`);`filter: drop-shadow` 只在子项图标上,不是任何模糊元素的祖先。底栏仍是同一个元素、同一层模糊:跟读库 = 顶栏胶囊 `.lib-glass` + `.lib-gblur` + 底栏 = 3 层,与现在相同,`library-css.test.ts` 的计数(只数 `library.css`)不变。
- **R-F9 无障碍。** 标签项 `min-h-14`(56 px)、宽 ≥ 65 px(5 项 @ 360 px)、`aria-current="page"`、`focus-visible:ring-inset` 都不变;`<nav aria-label>` 不变。

### 透明度取值表(owner 选定后只改这两处 + 测试期望)

| 选项 | `theme.css` `:root` `--glass-float` | `theme.css` `.dark` `--glass-float` | T1 测试 `toBe(...)` |
|---|---|---|---|
| A 6% | `rgba(255, 255, 255, 0.06)` | `rgba(23, 25, 30, 0.06)` | 同左两列 |
| **B 10%(推荐,本计划默认)** | `rgba(255, 255, 255, 0.1)` | `rgba(23, 25, 30, 0.1)` | 同左两列 |
| C 16% | `rgba(255, 255, 255, 0.16)` | `rgba(23, 25, 30, 0.16)` | 同左两列 |

推荐 B 的理由(视觉稿目测,未在真机核对):A 在深色 / 高饱和海报上标签开始依赖光晕「发虚」;C 已接近「磨砂」而不是 owner 说的「全透明」。

## 与已批准设计的偏离(写计划者的裁量,均可回退)

1. **design-notes「Tab bar … always glass at .72」**改为悬浮胶囊 + 10% 底色(T4 给 design-notes 追加 Addendum;仅底栏,输入条 / DOCK 仍 .72)。
2. **对比度改由光晕保证**(R-F4),而不是由底色保证;这是「全透明」的直接代价。
3. **留白增加**:iPhone 上内容区底部多让出 8 px,无安全区设备多 26 px(换来胶囊下方与两侧的「悬浮」感)。

## 待 owner 决定(视觉稿「待 owner 确认的设计决定」表 D1–D8 的摘要)

- **Q1(D1)** 「下面部分」= 全站底部 Tab 栏,对吗?若指的是别的(例如跟读库播放器控制胶囊),本计划作废重写。
- **Q2(D3)** 透明度 A / B / C(推荐 B)。
- **Q3(D7)** DOCK / 输入条保持全宽玻璃条(本计划),还是下一轮也改成悬浮圆角?
- **Q4(D4)** 文字光晕是否接受(关掉后在深色海报上标签可能看不清,不推荐关)。
- **Q5(D2)** iPhone 上胶囊下沿约 26 px(横条之上)是否合适;另一种是贴到安全区上沿(34 + 8 = 42 px,更稳但更高)。
- **Q6(D8)** 跟读库列表底部渐进模糊止于胶囊上方 8 px(本计划),不延伸到屏幕底(否则与底栏叠出第 4 层)。

## 文件结构、车道与共享文件

```
web/src/styles/theme.css                          [改] +7 个颜色令牌 ×2(T1)
web/src/styles/theme.test.ts                      [改] COLOR_TOKENS +7(T1)
web/src/index.css                                 [改] :root 几何变量 + .glass-float/.tab-halo 段 + 头注释一行(T1)
web/src/styles/floating-tab-bar.test.ts           新(T1)
web/src/components/glass-tab-bar.tsx              [整文件替换](T2)
web/src/components/glass-tab-bar.test.tsx         新(T2)
web/src/layout/app-shell.tsx                      [改] 2 行(T2)
web/src/layout/layout.test.tsx                    [改] 4 行(T2)
web/src/features/library/library.css              [改] 2 行(T3)
web/src/features/library/library-css.test.ts      [改] +1 用例(T3)
web/src/features/lookup/lookup-bar.tsx            [改] 1 行(T3)
web/src/features/lookup/lookup-bar-offset.test.ts 新(T3)
web/src/components/CLAUDE.md、web/src/layout/CLAUDE.md、docs/superpowers/design/redesign-v3/design-notes.md   [改](T4)
docs/changelog/2026-10.json                       [改](T5,控制者)
```

**车道(git worktree;全部在 owner 批准后):**

| 车道 | 任务 | 说明 |
|---|---|---|
| S(样式) | **T1** | 只碰 `styles/` 与 `index.css`。 |
| C(组件) | **T2** | 只碰 `components/glass-tab-bar*`、`layout/app-shell.tsx`、`layout/layout.test.tsx`;与 T1 无 TypeScript 依赖,**可与 T1 并行开发**。 |
| F(feature 消费者) | **T3** | 只碰 `features/library` 的 2 个文件与 `features/lookup` 的 2 个文件;**可与 T1、T2 并行开发**。 |
| 收尾 | **T4** | 三者合并后;文档与自检。 |
| 控制者 | **T5** | 合并、部署并核对后由控制者写更新日志草稿。 |

**合并顺序(必须):T1 → T2 → T3 → T4 → T5。** T2 / T3 引用的 `--tab-bar-space`、`--tab-bar-bottom`、`.glass-float`、`.tab-halo`、`--tab-on` 都由 T1 定义;T1 未合并时 T2 / T3 的测试照样绿(只断言类名 / 源码),但页面会错位——所以 T2、T3 不得先于 T1 合并,也不得在 T1 之前部署。三条车道互不改同一文件。

---

## Task T1:悬浮玻璃令牌、几何变量与 `.glass-float` / `.tab-halo`(BLOCKED ON MOCKUP APPROVAL)

**Files:** Modify `web/src/styles/theme.css`、`web/src/styles/theme.test.ts`、`web/src/index.css`;Create `web/src/styles/floating-tab-bar.test.ts`。

**Interfaces(供 T2 / T3 使用):** CSS 变量 `--tab-bar-h`、`--tab-bar-gap`、`--tab-bar-bottom`、`--tab-bar-space`(`:root`);颜色令牌 `--glass-float`、`--glass-float-lite`、`--glass-float-bd`、`--glass-float-hi`、`--glass-float-sh`、`--tab-on`、`--tab-halo`(`:root` 与 `.dark`);工具类 `.glass-float`、`.tab-halo`。

- [ ] **Step 1(测试):** Write `web/src/styles/floating-tab-bar.test.ts`:
```ts
// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * 计划 2026-10-14-floating-glass-bottom-bar(R-F2–R-F8):悬浮圆角玻璃底栏的令牌、几何与配方。
 * jsdom / node 没有合成与布局:这里只断言样式源码与令牌;真实模糊、对比度、安全区位置见计划的真机清单(未验证)。
 */
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const indexCss = read("../index.css");
const themeCss = read("./theme.css");

function tokens(css: string, selector: ":root" | ".dark"): Record<string, string> {
  const pattern = new RegExp(`(?:^|\\n)${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`);
  const block = css.match(pattern)?.[1] ?? "";
  return Object.fromEntries([...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}
const root = tokens(themeCss, ":root");
const dark = tokens(themeCss, ".dark");

/** 取 `header {` 之后配对大括号里的内容。 */
function blockOf(source: string, header: RegExp): string {
  const m = header.exec(source);
  if (!m) throw new Error(`missing block: ${header}`);
  const open = source.indexOf("{", m.index);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error(`unbalanced block: ${header}`);
}
const decls = (body: string) =>
  Object.fromEntries([...body.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)].map((m) => [m[1], m[2].trim()]));

/** 悬浮底栏段:从开头注释到结束注释 */
const START = "悬浮玻璃底栏(计划 2026-10-14-floating-glass-bottom-bar";
const END = "悬浮玻璃底栏结束";
const section = indexCss.slice(indexCss.indexOf(START), indexCss.indexOf(END));

const rgba = (value: string) => {
  const m = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(value);
  if (!m) throw new Error(`not rgba: ${value}`);
  return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])] as [number, number, number], a: Number(m[4]) };
};
const channels = (set: Record<string, string>, name: string) => (set[name] ?? root[name]).split(/\s+/).map(Number) as [number, number, number];
function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("floating tab bar geometry (R-F2, R-F5)", () => {
  it("defines the bar geometry once on :root in @layer base", () => {
    const base = indexCss.slice(indexCss.indexOf("@layer base"), indexCss.indexOf("@font-face"));
    const d = decls(blockOf(base, /^\s+:root\s*\{/m));
    expect(d["--tab-bar-h"]).toBe("64px");
    expect(d["--tab-bar-gap"]).toBe("8px");
    expect(d["--tab-bar-bottom"]).toBe("max(10px, calc(env(safe-area-inset-bottom) - 8px))");
    expect(d["--tab-bar-space"]).toBe("calc(var(--tab-bar-h) + var(--tab-bar-bottom) + var(--tab-bar-gap))");
  });
});

describe("floating glass tokens (R-F3, R-F4, R-F7)", () => {
  it("ships the approved tint, the same alpha in light and dark, never below 6%", () => {
    expect(root["--glass-float"]).toBe("rgba(255, 255, 255, 0.1)");
    expect(dark["--glass-float"]).toBe("rgba(23, 25, 30, 0.1)");
    for (const set of [root, dark]) {
      expect(rgba(set["--glass-float"]).a).toBeGreaterThanOrEqual(0.06);
      expect(rgba(set["--glass-float-lite"]).a).toBe(0.62);
    }
  });

  it("keeps tab labels at >= 4.5:1 against their halo colour (the halo, not the tint, carries contrast)", () => {
    for (const set of [root, dark]) {
      const halo = rgba(set["--tab-halo"]);
      expect(halo.a).toBeGreaterThanOrEqual(0.6);
      for (const fg of ["--ink-2", "--blue"]) expect(contrast(channels(set, fg), halo.rgb), fg).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("defines the border, highlight, shadow and active-pill tokens in both themes", () => {
    for (const set of [root, dark]) {
      for (const name of ["--glass-float-bd", "--glass-float-hi", "--glass-float-sh", "--tab-on"]) expect(set, name).toHaveProperty(name);
    }
    expect(root["--tab-on"]).toBe("rgba(36, 86, 219, 0.14)");
    expect(dark["--tab-on"]).toBe("rgba(143, 176, 255, 0.2)");
  });
});

describe(".glass-float recipe (R-F6, R-F8)", () => {
  it("lives in its own marked section inside @layer utilities", () => {
    const utilities = indexCss.slice(indexCss.indexOf("@layer utilities"));
    expect(utilities).toContain(START);
    expect(section.length).toBeGreaterThan(100);
  });

  it("is solid with a highlight border by default and never blurs outside @supports", () => {
    const base = decls(blockOf(section, /^\s+\.glass-float\s*\{/m));
    expect(base.background).toBe("var(--glass-solid)");
    expect(base.border).toBe("1px solid var(--glass-float-bd)");
    expect(base["box-shadow"]).toBe("var(--glass-float-hi), var(--glass-float-sh)");
    expect(base).not.toHaveProperty("backdrop-filter");
  });

  it("blurs 28px with the iOS prefix when supported, and lighter on low-end devices", () => {
    const supported = blockOf(section, /@supports \(\(-webkit-backdrop-filter: blur\(1px\)\) or \(backdrop-filter: blur\(1px\)\)\)\s*\{/);
    const full = decls(blockOf(supported, /^\s+\.glass-float\s*\{/m));
    expect(full.background).toBe("var(--glass-float)");
    expect(full["-webkit-backdrop-filter"]).toBe("blur(28px) saturate(1.8)");
    expect(full["backdrop-filter"]).toBe("blur(28px) saturate(1.8)");
    const lite = decls(blockOf(supported, /html\.lite \.glass-float\s*\{/));
    expect(lite.background).toBe("var(--glass-float-lite)");
    expect(lite["-webkit-backdrop-filter"]).toBe("blur(12px)");
  });

  it("turns solid, hairlined and halo-free with reduced transparency", () => {
    const reduced = blockOf(section, /@media \(prefers-reduced-transparency: reduce\)\s*\{/);
    expect(reduced).toMatch(/\.glass-float,\s*html\.lite \.glass-float\s*\{/);
    expect(reduced).toContain("background: rgb(var(--surface));");
    expect(reduced).toContain("border-color: var(--hair);");
    expect(reduced).toContain("backdrop-filter: none;");
    expect(reduced).toMatch(/\.tab-halo,\s*\.tab-halo svg\s*\{[^}]*text-shadow: none;[^}]*filter: none;/);
  });

  it("gives labels and icons a halo, and animates nothing in the section", () => {
    expect(decls(blockOf(section, /^\s+\.tab-halo\s*\{/m))["text-shadow"]).toBe("0 0 6px var(--tab-halo), 0 0 2px var(--tab-halo)");
    expect(decls(blockOf(section, /^\s+\.tab-halo svg\s*\{/m)).filter).toBe("drop-shadow(0 0 3px var(--tab-halo))");
    expect(section).not.toMatch(/\b(transition|animation)\s*:/);
  });
});
```
- [ ] **Step 2:** Run `cd web && yarn vitest run src/styles/floating-tab-bar.test.ts` — 失败(令牌与段落不存在)。
- [ ] **Step 3:** Edit `web/src/styles/theme.css`:在 `:root` 里的单行 `  --glass-shadow: 0 1px 0 rgba(17, 19, 24, 0.04);` **之后**插入:
```css
  /* 悬浮玻璃底栏(计划 2026-10-14-floating-glass-bottom-bar R-F3/R-F4/R-F7) */
  --glass-float: rgba(255, 255, 255, 0.1);
  --glass-float-lite: rgba(255, 255, 255, 0.62);
  --glass-float-bd: rgba(255, 255, 255, 0.55);
  --glass-float-hi: inset 0 1px 0 rgba(255, 255, 255, 0.7);
  --glass-float-sh: 0 10px 28px -10px rgba(17, 19, 24, 0.3), 0 1px 2px rgba(17, 19, 24, 0.06);
  --tab-on: rgba(36, 86, 219, 0.14);
  --tab-halo: rgba(255, 255, 255, 0.9);
```
  在 `.dark` 里的单行 `  --glass-shadow: 0 1px 0 rgba(255, 255, 255, 0.03);` **之后**插入:
```css
  --glass-float: rgba(23, 25, 30, 0.1);
  --glass-float-lite: rgba(23, 25, 30, 0.62);
  --glass-float-bd: rgba(255, 255, 255, 0.16);
  --glass-float-hi: inset 0 1px 0 rgba(255, 255, 255, 0.14);
  --glass-float-sh: 0 12px 32px -10px rgba(0, 0, 0, 0.65), 0 1px 2px rgba(0, 0, 0, 0.3);
  --tab-on: rgba(143, 176, 255, 0.2);
  --tab-halo: rgba(0, 0, 0, 0.6);
```
  (注意:`theme.test.ts` 的 `tokens()` 用 `[^}]*` 截块,值里不能出现 `}`——上面没有。)
- [ ] **Step 4:** Edit `web/src/styles/theme.test.ts`:单行 `  "--glass", "--glass-solid", "--glass-bar", "--glass-lite", "--glass-shadow",` 替换为:
```ts
  "--glass", "--glass-solid", "--glass-bar", "--glass-lite", "--glass-shadow",
  "--glass-float", "--glass-float-lite", "--glass-float-bd", "--glass-float-hi", "--glass-float-sh", "--tab-on", "--tab-halo",
```
- [ ] **Step 5:** Edit `web/src/index.css`(三处):
  1. 在单行 `  @font-face {` **之前**插入(仍在 `@layer base` 内):
```css
  /*
   * 悬浮底栏的几何(计划 2026-10-14-floating-glass-bottom-bar R-F2/R-F5):滚动区底部留白、跟读库浮层、选词操作条都只读
   * --tab-bar-space,不在页面里各写数值。下沿 = max(10px, 安全区 − 8px):有 Home 横条的 iPhone 上约 26px,横条之上;其余 10px。
   */
  :root {
    --tab-bar-h: 64px;
    --tab-bar-gap: 8px;
    --tab-bar-bottom: max(10px, calc(env(safe-area-inset-bottom) - 8px));
    --tab-bar-space: calc(var(--tab-bar-h) + var(--tab-bar-bottom) + var(--tab-bar-gap));
  }
```
  2. 头注释:在单行 ` *   .glass-bar      顶栏:滚动后才加(saturate 1.3 / .80,避免主按钮在其下晕开),自带底部发丝线` **之后**插入一行:
     ` *   .glass-float    悬浮圆角玻璃,只给全站底部 Tab 栏(近乎透明 + blur 28px + 高光描边;回退同上);.tab-halo 给标签与图标加光晕`
  3. 在单行 `  .hit-expand {` **之前**插入:
```css
  /* ----- 悬浮玻璃底栏(计划 2026-10-14-floating-glass-bottom-bar R-F3–R-F8):只给 GlassTabBar ----- */
  .glass-float {
    background: var(--glass-solid);
    border: 1px solid var(--glass-float-bd);
    box-shadow: var(--glass-float-hi), var(--glass-float-sh);
  }
  @supports ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px))) {
    .glass-float {
      background: var(--glass-float);
      -webkit-backdrop-filter: blur(28px) saturate(1.8);
      backdrop-filter: blur(28px) saturate(1.8);
    }
    html.lite .glass-float {
      background: var(--glass-float-lite);
      -webkit-backdrop-filter: blur(12px);
      backdrop-filter: blur(12px);
    }
  }
  .tab-halo {
    text-shadow: 0 0 6px var(--tab-halo), 0 0 2px var(--tab-halo);
  }
  .tab-halo svg {
    filter: drop-shadow(0 0 3px var(--tab-halo));
  }
  @media (prefers-reduced-transparency: reduce) {
    .glass-float,
    html.lite .glass-float {
      background: rgb(var(--surface));
      border-color: var(--hair);
      -webkit-backdrop-filter: none;
      backdrop-filter: none;
    }
    .tab-halo,
    .tab-halo svg {
      text-shadow: none;
      filter: none;
    }
  }
  /* ----- 悬浮玻璃底栏结束 ----- */

```
- [ ] **Step 6:** Run `cd web && yarn vitest run src/styles/floating-tab-bar.test.ts src/styles/theme.test.ts src/styles/viewport-lock.test.ts src/architecture.test.ts && cd .. && yarn web:typecheck` — 全绿。(`viewport-lock.test.ts` 切的是 `@layer base` 到 `@font-face` 之间,新 `:root` 块在这段里,但它的正则只找 `html, body {`,不受影响——以运行结果为准。)
- [ ] **Step 7:** Commit `feat(web): floating glass tokens and tab bar geometry variables`。

---

## Task T2:`GlassTabBar` 变成悬浮胶囊,`<main>` 改读共享留白(BLOCKED ON MOCKUP APPROVAL)

**Files:** Replace `web/src/components/glass-tab-bar.tsx`;Create `web/src/components/glass-tab-bar.test.tsx`;Modify `web/src/layout/app-shell.tsx`、`web/src/layout/layout.test.tsx`。

**Interfaces:** `GlassTabBar({ label, columns, className?, children })` 签名不变;`tabBarItemClass(isActive)` 签名不变;`TAB_BAR_HEIGHT` 删除(无导入者,Grep 已核对),新增 `export const TAB_BAR_SPACE = "var(--tab-bar-space)"`。

- [ ] **Step 1(测试):** Write `web/src/components/glass-tab-bar.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GlassTabBar, TAB_BAR_SPACE, tabBarItemClass } from "./glass-tab-bar";

describe("GlassTabBar (plan 2026-10-14-floating-glass-bottom-bar R-F2, R-F8)", () => {
  it("is a floating rounded glass pill inset from the screen edges", () => {
    render(<GlassTabBar label="Main" columns={5}><li>a</li></GlassTabBar>);
    const nav = screen.getByRole("navigation", { name: "Main" });
    const cls = nav.className.split(/\s+/);
    for (const c of ["glass-float", "absolute", "inset-x-3", "bottom-[var(--tab-bar-bottom)]", "z-30", "mx-auto", "h-16", "max-w-screen-sm", "rounded-dock", "p-[3px]"]) {
      expect(cls, c).toContain(c);
    }
    // 旧的全宽贴边配方不再出现:不叠第二套玻璃、没有顶部发丝线;安全区由 --tab-bar-bottom 负责
    for (const c of ["glass", "glass-edge-t", "inset-x-0", "bottom-0"]) expect(cls, c).not.toContain(c);
    expect(nav.className).not.toContain("safe-area");
    // 不对模糊元素本身做动画(design-notes)
    expect(nav.className).not.toMatch(/\b(transition|animate)/);
    const list = screen.getByRole("list");
    expect(list.className).toMatch(/\bh-14\b/);
    expect(list.style.gridTemplateColumns).toBe("repeat(5, minmax(0, 1fr))");
  });

  it("passes extra classes through", () => {
    render(<GlassTabBar label="Main" columns={3} className="test-extra"><li>a</li></GlassTabBar>);
    expect(screen.getByRole("navigation").className).toMatch(/\btest-extra\b/);
  });

  it("exposes the reserved space as one CSS variable", () => {
    expect(TAB_BAR_SPACE).toBe("var(--tab-bar-space)");
  });

  it("keeps 56px targets with a halo, and gives only the active item a concentric pill", () => {
    const on = tabBarItemClass(true).split(/\s+/);
    const off = tabBarItemClass(false).split(/\s+/);
    for (const cls of [on, off]) for (const c of ["tab-halo", "min-h-14", "rounded-[24px]", "focus-visible:ring-inset"]) expect(cls, c).toContain(c);
    expect(on).toEqual(expect.arrayContaining(["bg-[var(--tab-on)]", "text-blue", "font-semibold"]));
    expect(off).toEqual(expect.arrayContaining(["text-ink-2", "font-medium"]));
    expect(off).not.toContain("bg-[var(--tab-on)]");
  });
});
```
- [ ] **Step 2:** Run `cd web && yarn vitest run src/components/glass-tab-bar.test.tsx` — 失败。
- [ ] **Step 3:** Replace `web/src/components/glass-tab-bar.tsx` 整文件(先 Read 再 Write):
```tsx
import type { ReactNode } from "react";
import { cn } from "@renderer/lib/utils";

/**
 * 底栏占的空间(胶囊高 + 下沿 + 与上方内容的间距,含安全区),定义在 index.css 的 :root(计划 2026-10-14-floating-glass-bottom-bar R-F5)。
 * 滚动区留白、跟读库浮层、选词操作条都读这一个变量,不在页面里写数值。
 */
export const TAB_BAR_SPACE = "var(--tab-bar-space)";

/**
 * 常驻悬浮玻璃底栏(R-F2):离开屏幕左右 12px、下沿 --tab-bar-bottom(让开 Home 横条)、圆角 28、高 64(1px 描边 + 3px 内边距 + 56px 行),
 * 近乎透明的 .glass-float(index.css,含回退)。内容从其下穿过,所以父级滚动区需要 pb-[var(--tab-bar-space)]。
 * 本元素不做动画(design-notes:不对模糊元素本身做动画)。
 *   <GlassTabBar label={t("web.nav.label")} columns={3}>{items}</GlassTabBar>
 */
export function GlassTabBar({
  label,
  columns,
  className,
  children,
}: {
  label: string;
  columns: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <nav
      aria-label={label}
      className={cn(
        "glass-float absolute inset-x-3 bottom-[var(--tab-bar-bottom)] z-30 mx-auto h-16 max-w-screen-sm rounded-dock p-[3px]",
        className,
      )}
    >
      <ul className="grid h-14" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {children}
      </ul>
    </nav>
  );
}

/**
 * 底栏项的类名:≥56px 目标,24px 图标 + 11px 标签,标签与图标带光晕 .tab-halo(R-F4:近乎透明的底栏上,对比度靠光晕保证);
 * 激活为蓝色 600 + 同心小胶囊底(圆角 24 = 28 − 3 − 1)。用于 NavLink 的 className 回调。
 */
export function tabBarItemClass(isActive: boolean): string {
  return cn(
    "tab-halo flex h-full min-h-14 flex-col items-center justify-center gap-0.5 rounded-[24px] text-label tracking-[0.01em] transition-colors duration-fast",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&_svg]:h-6 [&_svg]:w-6",
    isActive ? "bg-[var(--tab-on)] font-semibold text-blue" : "font-medium text-ink-2",
  );
}
```
- [ ] **Step 4:** Edit `web/src/layout/app-shell.tsx`:
  1. 单行 ` * 玻璃底栏浮在其上,main 底部留出底栏高度,内容从玻璃下穿过。` → ` * 悬浮玻璃底栏浮在其上,main 底部留出 --tab-bar-space(index.css,计划 2026-10-14-floating-glass-bottom-bar R-F5),内容从玻璃下穿过;`
     并在其后插入一行 ` * DOCK / 输入条 sticky 或 absolute 在 main 的内容框下沿,因此自动停在胶囊上方 8px,不需要各自改。`
  2. 单行 `            className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain pb-[calc(3.5rem+env(safe-area-inset-bottom))]"` → `            className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain pb-[var(--tab-bar-space)]"`
- [ ] **Step 5:** Edit `web/src/layout/layout.test.tsx`(四个单行锚点):
  1. `    expect(nav.className).toMatch(/\bglass\b/);` → `    expect(nav.className).toMatch(/\bglass-float\b/);`
  2. `    expect(nav.className).toContain("glass-edge-t");` → `    expect(nav.className).not.toContain("glass-edge-t");`
  3. `    expect(nav.className).toContain("pb-[env(safe-area-inset-bottom)]");` → `    expect(nav.className).toContain("bottom-[var(--tab-bar-bottom)]");`
  4. `    expect(main.className).toContain("pb-[calc(3.5rem+env(safe-area-inset-bottom))]");` → `    expect(main.className).toContain("pb-[var(--tab-bar-space)]");`
  (`nav-me` 的 `text-blue`、`nav-chat` 的 `text-ink-2`、三项 `min-h-14` 的断言不变,应仍通过。)
- [ ] **Step 6:** Run `cd web && yarn vitest run src/components/glass-tab-bar.test.tsx src/layout/layout.test.tsx src/layout/bottom-nav.test.tsx src/layout/app-shell-shadow.test.tsx src/layout/app-height-coexist.test.tsx src/components/primitives.test.tsx src/architecture.test.ts && cd .. && yarn web:typecheck` — 全绿。若 tailwind-merge 吞掉了某个类(例如把 `p-[3px]` 与别的 padding 合并),以实际输出修正类名与测试,并在提交说明里写明。
- [ ] **Step 7:** Commit `feat(web): float the bottom tab bar as a rounded glass pill`。

---

## Task T3:跟读库与选词操作条改读 `--tab-bar-space`(BLOCKED ON MOCKUP APPROVAL)

**Files:** Modify `web/src/features/library/library.css`、`web/src/features/library/library-css.test.ts`、`web/src/features/lookup/lookup-bar.tsx`;Create `web/src/features/lookup/lookup-bar-offset.test.ts`。

- [ ] **Step 1(测试):** Edit `web/src/features/library/library-css.test.ts`:在单行 `  it("limits blur to three surfaces: .lib-glass, .lib-gblur and the add sheet (R-L26)", () => {` **之前**插入:
```ts
  it("reserves the global tab bar's space through the shared variable (plan 2026-10-14-floating-glass-bottom-bar R-F5)", () => {
    expect(blockOf(css, /^\.library-root\s*\{/m)).toContain("--lib-tab: var(--tab-bar-space);");
    expect(css).not.toContain("3.5rem");
  });

```
  Write `web/src/features/lookup/lookup-bar-offset.test.ts`:
```ts
// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** 计划 2026-10-14-floating-glass-bottom-bar R-F5:选词操作条浮在悬浮底栏上方 16px(--tab-bar-space 已含 8px 间距 + 0.5rem)。 */
const src = readFileSync(fileURLToPath(new URL("./lookup-bar.tsx", import.meta.url)), "utf8");

describe("LookupBar offset", () => {
  it("sits above the floating tab bar through the shared variable, not a hard-coded height", () => {
    expect(src).toContain("bottom-[calc(var(--tab-bar-space)+0.5rem)]");
    expect(src).not.toContain("4.5rem");
    expect(src).not.toContain("safe-area-inset-bottom");
  });
});
```
- [ ] **Step 2:** Run `cd web && yarn vitest run src/features/library/library-css.test.ts src/features/lookup/lookup-bar-offset.test.ts` — 这两个用例失败。
- [ ] **Step 3:** Edit `web/src/features/library/library.css`:
  1. 单行 `  /* 全站底栏的高度(glass-tab-bar 的 TAB_BAR_HEIGHT)+ 安全区:页面延伸到底栏下面,浮层贴着底栏上沿 */` → `  /* 全站悬浮底栏占的空间(index.css 的 --tab-bar-space,含安全区与 8px 间距;计划 2026-10-14-floating-glass-bottom-bar):页面延伸到底栏下面,浮层贴着它上沿 */`
  2. 单行 `  --lib-tab: calc(3.5rem + env(safe-area-inset-bottom));` → `  --lib-tab: var(--tab-bar-space);`
- [ ] **Step 4:** Edit `web/src/features/lookup/lookup-bar.tsx`:在单行 `      className="absolute bottom-[calc(4.5rem+env(safe-area-inset-bottom))] left-1/2 z-40 flex max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-0.5 rounded-full border border-border bg-surface p-1 shadow-lg select-none"` 里把 `bottom-[calc(4.5rem+env(safe-area-inset-bottom))]` 换成 `bottom-[calc(var(--tab-bar-space)+0.5rem)]`,其余字符不变。
- [ ] **Step 5:** Run `cd web && yarn vitest run src/features/library/library-css.test.ts src/features/library/player-page.test.tsx src/features/lookup/lookup-bar-offset.test.ts src/features/lookup/lookup-bar.test.tsx src/features/lookup/lookup-layer.test.tsx src/architecture.test.ts && cd .. && yarn web:typecheck` — 全绿(`player-page.test.tsx` 的「2 个 `.lib-glass, .lib-gblur`」不变;模糊计数用例不变)。
- [ ] **Step 6:** Commit `feat(web): library and lookup bar follow the shared tab bar space`。

---

## Task T4:文档与自检(T1–T3 合并后;BLOCKED ON MOCKUP APPROVAL)

**Files:** Modify `web/src/components/CLAUDE.md`、`web/src/layout/CLAUDE.md`、`docs/superpowers/design/redesign-v3/design-notes.md`。

- [ ] **Step 1:** Edit `web/src/components/CLAUDE.md`:单行 `- Layout chrome: \`glass-top-bar.tsx\`, \`glass-tab-bar.tsx\`, \`bottom-sheet.tsx\`.` → `- Layout chrome: \`glass-top-bar.tsx\`, \`glass-tab-bar.tsx\` (floating rounded glass pill, \`.glass-float\` + \`.tab-halo\`; reserved space is the CSS variable \`--tab-bar-space\`, exported as \`TAB_BAR_SPACE\`; plan \`2026-10-14-floating-glass-bottom-bar\`), \`bottom-sheet.tsx\`.`
- [ ] **Step 2:** Edit `web/src/layout/CLAUDE.md`:在单行 `- Safe-area insets and app height matter on iOS standalone PWA; test with the mobile viewport.` **之后**插入一行:
  `- The bottom tab bar floats (plan \`2026-10-14-floating-glass-bottom-bar\`): anything that must clear it reads \`var(--tab-bar-space)\` (\`index.css\` \`:root\`: bar height + \`--tab-bar-bottom\` + 8px gap, safe area included). Never hard-code \`3.5rem\` or the safe area again; docks and composers inside \`<main>\` follow \`<main>\`'s padding automatically. The bar's real blur, contrast over posters and position above the iPhone home indicator are UNVERIFIED on devices.`
- [ ] **Step 3:** Edit `docs/superpowers/design/redesign-v3/design-notes.md`:在文件末尾追加:
```markdown

## Addendum (2026-10-14) — floating tab bar

Owner request: the bottom bar becomes a fully transparent rounded glass. Plan `docs/superpowers/plans/2026-10-14-floating-glass-bottom-bar.md`, mockup `docs/superpowers/design/floating-glass-bar-v1/mockup.html`. Only the tab bar changes: a floating pill inset 12px, bottom `max(10px, safe-area − 8px)`, radius 28 (`rounded-dock`), 64px tall, `.glass-float` = tint `--glass-float` (approved alpha, never below .06) + `blur(28px) saturate(1.8)` + 1px highlight border + soft shadow; labels and icons carry a halo (`--tab-halo`) because the tint no longer guarantees contrast; the active tab keeps a `--tab-on` pill. Fallbacks keep the shape: no backdrop-filter → `--glass-solid`; `html.lite` → blur 12 + .62; reduced transparency → solid surface + hairline, no halo. Composer, docks and the call dock keep the `.glass` recipe above (.72) and sit 8px above the pill via `--tab-bar-space`. Still one blurred layer for the bar; ≤ 3 per screen unchanged.
```
- [ ] **Step 4:** 自检(只读):
  - Grep `3\.5rem|4\.5rem|TAB_BAR_HEIGHT` 在 `web/src` 下应无结果。
  - Grep `glass-edge-t` 在 `web/src/components/glass-tab-bar.tsx` 应无结果;在 `features/wordbook/ui.ts`、`features/chat/conversation-page.tsx`、`features/rooms/room-composer.tsx`、`features/rank/match-page.tsx`、`features/wordbook/spell/spell-page.tsx` 仍在(未改)。
  - Grep `backdrop-filter` 在 `web/src/features/library/library.css`:声明行数与改动前相同(`library-css.test.ts` 守着 3 个)。
  - `git diff --stat main...HEAD` 只出现「所有权」列出的文件;不应出现 `enjoy/`、`server/`、`features/chat/`、`features/rooms/`、`features/wordbook/`、`features/rank/`、`features/realtime/`。
- [ ] **Step 5:** Run `cd web && yarn vitest run src/styles src/components/glass-tab-bar.test.tsx src/layout src/features/library/library-css.test.ts src/features/library/player-page.test.tsx src/features/lookup src/architecture.test.ts && cd .. && yarn web:typecheck` — 全绿后才勾选本计划的任务框(`docs/CLAUDE.md`:合并且测试通过才勾)。**不跑** `yarn web:build`、全量与 E2E(用户要求时再跑)。
- [ ] **Step 6:** Commit `docs: describe the floating glass tab bar`。

---

## Task T5(仅控制者):更新日志草稿

**前提:** T1–T4 已合并、已部署并由控制者核对(至少一台 iPhone 与一台安卓过一遍真机清单 F-A、F-B)。实现车道**不做**这一步。

- [ ] **Step 1:** 按 `docs/CLAUDE.md` 的写作规则,在 `docs/changelog/2026-10.json` 数组末尾追加一条(`entry_date` 用实际部署日;`version` 为 null;用户语言,不写内部术语,只写已上线的):
```json
  {
    "entry_date": "2026-10-14",
    "version": null,
    "title_zh": "底部导航换成悬浮玻璃样式",
    "title_en": "A floating glass bottom bar",
    "items": [
      { "tag": "improve", "zh": "底部导航改为悬浮的圆角透明玻璃,内容可以从它下面透出来,屏幕看起来更开阔。", "en": "The bottom navigation now floats as a rounded, see-through glass bar, so your content shows through and the screen feels more open." },
      { "tag": "improve", "zh": "复习、对话等页面底部的按钮和输入框会自动让出位置,不会被导航挡住。", "en": "Buttons and the message box at the bottom of review, chat and other pages move up so the bar never covers them." },
      { "tag": "improve", "zh": "开启「减少透明度」或在较旧的手机上,底部导航会自动改用更清晰的实色样式。", "en": "With Reduce Transparency on, or on older phones, the bar switches to a clearer solid style." }
    ]
  }
```
- [ ] **Step 2:** Run `cd server && uv run pytest -q tests/test_changelog_import.py`;提醒用户在服务器上运行 `docker compose exec server python -m app.admin.changelog_import`(镜像需重建后才带上新文件,重建只在用户要求时做),然后在管理后台「更新日志」里编辑并发布。

---

## 自检清单(执行者交付前对照)

1. 底栏仍是一个 `<nav aria-label>`、`aria-current` 不变;3 / 4 / 5 个标签的顺序与高亮测试(`bottom-nav.test.tsx`)全绿,未改。
2. 没有任何页面单独写底栏高度:`3.5rem` / `4.5rem` / `TAB_BAR_HEIGHT` 在 `web/src` 中为零。
3. 输入条 / DOCK / 拼写 / 排位操作条的源码零改动。
4. 跟读库:`library.css` 只改了 `--lib-tab` 一行(+ 注释),模糊声明仍 3 个;播放器页玻璃元素仍 2 个。
5. `<nav>` 上无 `transition` / `animate-*`;`.glass-float` 段无 `transition` / `animation`。
6. 不支持模糊 / `html.lite` / 减少透明度三种回退都在 `index.css` 的标记段里,由 `floating-tab-bar.test.ts` 守着。
7. 没有新的跨 feature 导入;`architecture.test.ts` 未改。

## 真机清单(全部 UNVERIFIED;执行后由用户在真机上填写)

> jsdom / node 只能证明类名、CSS 源码与令牌数值正确。**不能**证明下面任何一项。被测构建、设备型号与系统版本、浏览器版本、深浅色、是否主屏 PWA,请记在每次测试记录的开头。

**F-A 位置与安全区(iOS Safari 标签页、iOS 主屏 PWA、Android Chrome 各一遍)**
- [ ] F-A1 胶囊左右各约 12 px,下沿在 iPhone 的 Home 横条**之上**、不压横条;上滑回桌面的手势不会误触标签。
- [ ] F-A2 没有 Home 横条的安卓手机上,胶囊下沿约 10 px,不贴边。
- [ ] F-A3 横屏(iPhone)时胶囊不被刘海 / 圆角裁切(左右安全区本轮未处理,若被裁切记录下来)。
- [ ] F-A4 iOS 键盘弹出再收起后(对话页、拼写页),胶囊回到原位,不悬在半空(与 `use-app-height.ts` 的已知未验证项一起看)。

**F-B 透明度与可读性(最关键)**
- [ ] F-B1 跟读库列表滚动时,深色海报、亮黄海报、白色海报压在胶囊下面,五个标签与图标都清楚可读(浅色、深色各看一遍)。
- [ ] F-B2 选定的透明度(A / B / C)在真机上仍像「透明玻璃」而不是磨砂条;模糊足够把下面的文字糊掉,不出现清晰文字叠在标签下。
- [ ] F-B3 当前标签的蓝色小胶囊在任何背景上都看得出。
- [ ] F-B4 iOS「减少透明度」打开:胶囊变实色、无光晕、仍是圆角悬浮。
- [ ] F-B5 低内存安卓(deviceMemory ≤ 4,`html.lite`):模糊变轻、底色更实,滚动不掉帧。

**F-C 让位**
- [ ] F-C1 复习 / 学新词 / 已学 / 拼写 / 排位页底部的按钮条整条在胶囊上方,点得到,不被遮挡;两者之间约 8 px。
- [ ] F-C2 对话页、联机房间页的输入条(含按住说话)在胶囊上方,最后一条消息不被挡。
- [ ] F-C3 选词操作条(查词 · 朗读 · 加入生词本)出现在胶囊上方,不与胶囊重叠。
- [ ] F-C4 跟读库「添加」悬浮按钮、播放器控制胶囊、速度面板都在底栏之上,没有被盖住。
- [ ] F-C5 每个页面滚到最底,最后的内容完整露出在胶囊上方。

**F-D 性能**
- [ ] F-D1 中端安卓上跟读库列表快速滚动(3 层模糊:顶栏胶囊、渐进模糊、底栏)不比改动前明显卡顿。

## UNVERIFIED(必须在交付说明里原样保留)

- 上面「真机清单」的全部项目。
- tailwind-merge 与 Tailwind JIT 对任意值类(`bottom-[var(--tab-bar-bottom)]`、`pb-[var(--tab-bar-space)]`、`bottom-[calc(var(--tab-bar-space)+0.5rem)]`、`p-[3px]`、`rounded-[24px]`、`bg-[var(--tab-on)]`)的处理:以第一次运行与构建结果为准。
- `max()` 内嵌 `env()` 在不支持 `max()` 的旧浏览器上会让 `--tab-bar-bottom` 失效(胶囊位置错乱);本应用已依赖 `backdrop-filter` / `dvh` 等较新特性,未对旧浏览器做专门回退。
- sticky DOCK 停在滚动区内边距上沿:只在 Chromium(视觉稿)实测;iOS Safari 未测(现有 DOCK 已依赖同一行为)。
- 对比度:测试只校验「标签色对光晕底色 ≥ 4.5:1」,不是对真实合成背景的对比度。
- 主包体积与 `yarn web:build` 未运行;E2E 未运行(E2E 若有按底栏坐标点击的用例,位置会变)。
