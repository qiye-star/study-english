# 背单词 · 英英释义 + 学新词页短语自动展开(网页)Implementation Plan

> **先合并服务端计划 `2026-10-12-wordbook-definitions-server.md`(S → W)**:本计划的契约测试读服务端重录的 `server/tests/fixtures/wordbook_contract.json`;S 未合并时 T2 的契约步骤不能转绿(其余任务不受影响,用 fetch 模拟)。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 单词卡在中文释义之下按词性显示小号英文释义(每个词性最多 2 条);用户可在「每日目标」面板里选「释义显示:中英 / 仅中文 / 仅英文」(默认中英,乐观保存,当前页立即生效);英文释义与中文释义同属「答案」,遮罩时不在 DOM 里;选择题 / 拼写题 / 快速回忆题面不变。学新词页翻开释义后「短语」区自动展开(标题行不再重复第一条短语),用户手动收起后在本机记住;复习页、已学词页保持折叠。老版本服务端(没有 `defsEn`、没有 `defLang`)渲染结果与改动前逐字节相同。

**Architecture:** 类型进 `wordbook-api.ts`(只有类型,主包不增长);运行时辅助(`DEF_LANGS`、`defLangOf`、`saveDefLang`、`groupDefs`、词性映射)放进只被懒加载块引用的新模块 `def-lang.ts`(R-DW4)。偏好经 `use-def-lang.ts`(按 `ApiClient` 缓存的乐观覆盖层,`useSyncExternalStore`)读 / 写;`WordCardView` / `RecallCard` 用显式 prop `defLang`(默认 `"both"`)与 `phrasesOpen`(默认 `false`),各调用点传值,由一个结构性测试守住。英文释义行 = `defs-en.tsx`;短语区 = `phrases-section.tsx`(受控 `<details>`,状态在区块挂载时按本机偏好决定,挂载时刻 = 翻开时刻)+ `phrases-pref.ts`(并入已有的 `WORDBOOK_PREFS_KEY` JSON)。新文案放 `features/wordbook/locales/`(不在急切的 `**/i18n/*.json` glob 里),由 `locales.ts` 在懒加载块求值时并入 i18next(R-DW1),主包文案增量 0。

**Tech Stack:** React 18 + react-i18next + Tailwind 3 + vitest + Testing Library + `@testing-library/user-event`;不新增依赖、不改 `enjoy/`、不新增跨 feature 依赖。

**Spec:** `docs/superpowers/specs/2026-10-12-wordbook-definitions-design.md`(D1–D7 已定;本计划实现 §4 网页侧与 §5)。前置:`2026-10-11-wordbook-recall`(遮罩 / `RecallCover`)、`2026-10-11-wordbook-goals`(目标面板、乐观更新)、`2026-10-12-wordbook-learned-review`(已学词页、自由复习)。

## Global Constraints

- **契约只追加。** `Card.defsEn?: {pos, text}[]`(服务端 `defs_en`,缺省 = 没有)与配置里的偏好 `defLang`(服务端 `def_lang`)都是可选;**老服务端没有它们时一切照旧**(R-DW11、验证矩阵 V1)。
- **遮罩不变量(recall §3.1 / 本 spec §5):** `covered` 时中文释义、英文释义、例句、短语都不在 DOM 里(不靠模糊或透明度),翻开后一起出现。
- **测验不变(spec D5):** `ChoiceQuestion`、`TypingQuestion`、复习抽查题、`WordRecap`、`meaningLine`(小结 / 拼写复盘的释义行)继续用中文,不做英英题型(R-DW8)。
- **偏好只作用于「答案展示」:** `WordCardView`(学新词翻开后、已学词词卡抽屉、`RecallCard` 背面、翻卡浏览、联动「查看词卡」)。例句译文、短语译文不是释义,任何模式下都照旧。
- **主包体积增量 ≤ 0.2 kB gzip:** 基线文件 `web/scripts/main-bundle-baseline.json` 已过期,**以 T1 在改动前实测为准**;不得 `--record`,不得改基线文件(R-DW13)。
- **i18n:** 中英同键;新键只在 `features/wordbook/locales/{en,zh-CN}.json`(命名空间 `web.wordbookDefs.*`),不进 `i18n/*.json`;能复用的急切键直接复用(`web.wordbook.word.phrases`、`web.wordbook.goals.saved`)。英文标签在 360 px 下不得溢出:jsdom 没有布局,用结构性测试(标签长度、`whitespace-nowrap`、无固定像素宽度)并标注「未在真实浏览器 / 真机验证」。
- **UI 规范:** 触控目标 ≥ 44px(`min-h-tap` / `SegmentedControl` 的 `hit-expand`);无 emoji;颜色只用令牌(`text-ink-2`、`bg-surface-2`…),深色靠令牌自动适配;一色一义:英文释义不引入新色相;`prefers-reduced-motion` 下不做过渡(`motion-reduce:transition-none`)。
- **隐私:** 词与释义不进 URL、不进日志、不进 `localStorage`(本机只存 `phrasesOpen` 一个布尔值);不向任何第三方发请求;`defLang` 请求只发到 `server/`。
- **分层:** `architecture.test.ts` 不改、不放宽;新文件只用 `~/lib`、`~/api`、`~/auth`、`~/components`、`~/i18n`、`@renderer/*` 与 feature 内相对路径。
- **每个任务结束:** `cd web && yarn vitest run <任务列出的测试> src/architecture.test.ts`;车道合并前 `yarn web:typecheck && yarn web:test && yarn web:build`。提交 conventional(`feat(web): …`、`test(web): …`、`docs(web): …`),一任务一提交,信息以 `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` 结尾。
- **验证口径(如实):** 写计划时只读了代码,**没有运行任何测试或构建**。下面的测试与实现按读到的真实代码写;执行者第一次运行时以真实结果为准修正(尤其:`renderWithProviders` 的返回值、`createFetchMock` 对 `PATCH` 的匹配、jsdom 对 `<details>` / `<summary>` 的行为、`useId` 的格式)。真机、iOS Safari、读屏、360 px 真实宽度、长释义折行都标「未验证」。

---

## 文件结构与共享文件插入点

```
web/src/features/wordbook/
  wordbook-api.ts            T2:只加类型(DefEn、DefLang、Card.defsEn?、config.defLang?)
  def-lang.ts                T2 新:DEF_LANGS / isDefLang / defLangOf / DEF_LANG_PATH / saveDefLang /
                             词性映射 EN_POS_LABELS / enPosLabel / DEF_POS_CODES / MAX_DEFS_PER_POS / groupDefs
  def-lang.test.ts           T2 新
  use-def-lang.ts            T4 新:useDefLangValue()(读) / useDefLangSetting()(读 + 乐观保存)
  use-def-lang.test.tsx      T4 新
  locales.ts                 T3 新:ensureWordbookDefsI18n()
  locales/en.json  locales/zh-CN.json     T3 新:web.wordbookDefs.*
  locales.test.ts            T3 新
  test-fixtures.ts           T2 追加:DEFS_EN、defsCard()
  wordbook-contract.test.ts  T2 改:CARD 键表去掉可选的 defsEn,新增 expectCard / defs 用例
  word-card-legacy.test.tsx  T1 新(+ __snapshots__):改动前的 DOM 金标准
  defs-en.tsx                C1 新:<DefinitionsEn>
  word-card.tsx              C1:props defLang + 释义块;X2:props phrasesOpen + 替换 <details>
  recall-card.tsx            C2:Back / RecallCard 透传 defLang
  learn-page.tsx             C2:useDefLangValue + defLang;X2:phrasesOpen="auto"
  review-page.tsx  learned-page.tsx  free-browse.tsx  link-actions.tsx    C2:各一处 defLang
  def-lang-wiring.test.ts    C2 新:结构性测试(每个 <WordCardView/RecallCard> 调用都带 defLang)
  def-lang-setting.tsx       P1 新:<DefLangSetting>
  goals-sheet.tsx            P1:一行 import + 一处 <DefLangSetting />
  phrases-pref.ts            X1 新
  phrases-section.tsx        X2 新:<PhrasesSection>、MAX_PHRASES
  learn-page-defs.test.tsx   Z1 新:学新词页整页集成测试
  CLAUDE.md                  Z2
web/README.md                Z2(背单词段末尾追加一条)
docs/superpowers/plans/2026-10-12-wordbook-definitions-web.md   Z3(结果表)
```

**共享文件的插入点(同一文件被两条车道改时,后者在前者合并之后做):**

| 文件 | 先 | 后 |
|---|---|---|
| `word-card.tsx` | C1:`WordCardView` 参数列表加 `defLang = "both"`;「释义块」`{card.senses.length ? <ul…>}` 之后插 `<DefinitionsEn>` | X2:参数列表加 `phrasesOpen = false`;把 `{card.phrases.length ? <details…>}` 整块换成 `<PhrasesSection>` |
| `learn-page.tsx` | C2:`const defLang = useDefLangValue();` 与 `<WordCardView … defLang={defLang}`(紧跟 `card={current}`) | X2:同一个 `<WordCardView` 上加 `phrasesOpen="auto"` |
| `goals-sheet.tsx` | P1 独占 | — |
| `wordbook-api.ts` | T2 独占(只加类型) | — |

---

## 并行车道、文件归属与合并顺序

| 车道 | 任务 | 独占文件 | 依赖 |
|---|---|---|---|
| **T 类型 / 接口 / 文案 / 偏好 hook**(串行) | T1–T4 | `wordbook-api.ts`、`def-lang.ts`、`use-def-lang.ts`、`locales*`、`test-fixtures.ts`、`wordbook-contract.test.ts`、`word-card-legacy.test.tsx`(及各自测试) | T1 必须第一个做(记基线、录金标准) |
| **C 单词卡与调用点** | C1–C2 | `defs-en.tsx`、`word-card.tsx`(释义部分)、`recall-card.tsx`、`learn-page.tsx` / `review-page.tsx` / `learned-page.tsx` / `free-browse.tsx` / `link-actions.tsx`(只加 defLang)、`def-lang-wiring.test.ts` | T 全部 |
| **P 设置界面** | P1 | `def-lang-setting.tsx`、`goals-sheet.tsx`(+ 各自测试、`goals-sheet.test.tsx` 追加一个用例) | T 全部;与 C 无共同文件,可并行 |
| **X 短语自动展开** | X1–X2 | `phrases-pref.ts`、`phrases-section.tsx`、`word-card.tsx`(短语部分)、`learn-page.tsx`(`phrasesOpen`) | X1 只依赖 T1;X2 在 C 合并之后 |
| **final Z** | Z1–Z3 | `learn-page-defs.test.tsx`、`CLAUDE.md`、`web/README.md`、本计划文件(结果表) | S、T、C、P、X 全部合并 |

**合并顺序:** 服务端计划 S → T1 → T2 → T3 → T4 → (C1 → C2) ∥ P1 ∥ X1 → X2 → Z1 → Z2 → Z3。T2 的契约步骤需要 S 的重录夹具,放在 S 合并之后执行;其余步骤用 fetch 模拟,可提前。

**评审波:** 合并前 `/code-review high`;P1、X2 后浏览器窗格 375×812 与 360×740 的浅色 / 深色各看一遍(没有视觉稿:按 `docs/superpowers/design/wordbook-goals-v1/mockup.html` 的分段控件与 `redesign-v3/design-notes.md` 的令牌);Z3 `security-review`(本地存储、请求体、日志)。

---

## 本计划的裁定

> 规格与代码不一致或没写清的地方,按下面裁定实施;**没有改规格**。「代价」= 裁定错了的后果。

- **R-DW1 文案走懒加载文件,命名空间 `web.wordbookDefs`。** `web/src/i18n/index.ts` 用 `import.meta.glob("../**/i18n/*.json", { eager: true })` 把所有 `i18n/*.json` 并进主包(wordbook 现有文案也是),新键放那里必增主包。裁定:照 `features/agents/locales.ts`(R-W3)做,`features/wordbook/locales/{en,zh-CN}.json` 不在 glob 里,`locales.ts` 的 `ensureWordbookDefsI18n()` 在模块求值时 `addResourceBundle(..., deep=true, overwrite=false)`;`word-card.tsx`、`def-lang-setting.tsx` 各 `import "./locales"`(它们只在懒加载块里)。命名空间不用 `web.wordbook.*`,避免与急切的 `web.wordbook` 子树深合并时互相覆盖。短语标题与「已保存」播报复用急切键,不新增。代价:`locales.ts` 多一个小文件;若以后有人把 `locales/` 改名成 `i18n/`,主包文案会回流(`locales.test.ts` 钉住「不在急切合并里」)。
- **R-DW2 线上形状假设(与服务端计划对表)。** 规格 §4 只说「`GET /api/wordbook/config` 返回 `def_lang`,`PATCH` 同一个设置接口接受它」。**读**:`config.defLang`(配置对象顶层,仅 `enabled: true` 分支;服务端 `def_lang`)。**写**:`PATCH /api/wordbook/settings`,体 `{"def_lang": "both"|"zh"|"en"}`,200 返回 `{"def_lang": …}`;未知值 → 422。全部集中在 `def-lang.ts` 的 `defLangOf` / `DEF_LANG_PATH` / `saveDefLang` 三处,服务端计划定稿后只可能改这三处与夹具键(Z3 第一步核对)。代价:路径或键名不同 → 改常量,测试里同步改一行。
- **R-DW3 设置放进「每日目标」面板,不放「我的 → 背单词」。** 「我的」里的背单词只是一行入口(`me-row.tsx` → `/wordbook`),不存在「我的 → 背单词」设置页;新建一页要动 `pages/` 与路由(跨层、更大风险)。目标面板(`goals-sheet.tsx`)已有分段控件(`SegmentedControl`)、乐观保存与读屏播报的先例,从首页齿轮即可到达;学新词 / 复习页没有设置入口(会话页保持干净),切换后下一次打开 / 返回即生效,在首页改完当前页(首页)立即生效。组件 `DefLangSetting` 自包含,将来要搬到别处只改一行。代价:要先进首页才能改;面板需要有进行中的词书才打得开(暂停 / 未选书时不可改,可接受)。
- **R-DW4 运行时辅助放 `def-lang.ts`,`wordbook-api.ts` 只加类型。** `wordbook-api.ts` 被主包里的 `use-wordbook-config` 引用,任何新增运行时导出都会因懒加载块也在用而留在主包。把 `DEF_LANGS` / `defLangOf` / `saveDefLang` / `groupDefs` / 词性映射放在只被懒加载块引用的 `def-lang.ts`,类型是擦除的,主包增量理论上为 0;唯一进主包的是 `link-actions.tsx` 懒加载块里多的一个 `import("./use-def-lang")`(几十字节,T1 / Z3 实测)。规格「类型 + API 在 `wordbook-api.ts`」按「类型在那里」落实。代价:函数不在 `wordbook-api.ts`,CLAUDE.md 要写明。
- **R-DW5 `defLang` 与 `phrasesOpen` 用 prop,不用 Context。** `WordCardView` 现在没有任何 hook 依赖鉴权,既有测试直接渲染它;加 `useAuth` 会让它们失败。裁定:`defLang?: DefLang`(默认 `"both"`)与 `phrasesOpen?: "auto" | boolean`(默认 `false`),各调用点用 `useDefLangValue()` 传入;`def-lang-wiring.test.ts` 扫描源码,任何不带 `defLang` 的 `<WordCardView` / `<RecallCard` 调用都失败。代价:漏传的调用点退回「中英」(规格默认),不会出错。
- **R-DW6 `en` 模式下,没有英文释义的词仍显示中文。** 规格 §5 写「`en`:不显示中文释义」。但约 700 个虚词 / 专有名词缺口在服务端没有 `defs_en`(D3),照字面做答案区是空的。裁定:`defLang === "en"` 且该卡 `groupDefs(card.defsEn)` 为空时,照常显示中文释义;有英文释义时才隐藏中文行。代价:个别词在「仅英文」下仍见中文(比空白好);若产品要求绝不显示中文,删 `showSenses` 里的 `&& showDefs` 一个条件即可。
- **R-DW7 「词性标签保留」= 词性仍可见。** 中文行被隐藏后,词性由英文释义行自带的标签(`n.` `v.` `adj.`…)承担;中文行里的词性标签随中文行一起隐藏(中文行的词性可能是 `vt.` / `vi.`,与英文行的 `v.` 并存会出现两套标签)。例句译文、短语译文不是释义,任何模式下都显示。
- **R-DW8 测验与反馈面不跟偏好走。** `ChoiceQuestion`(含「答错」后的 `WordRecap`)、`TypingQuestion`、`meaningLine` 生成的小结 / 拼写复盘行、抽查题全部保持中文(spec D5「不做英英题型」)。面板里的说明文字写明「小测仍用中文」。代价:选「仅英文」的用户在答错回顾里仍看到中文释义行;这是规格接受的边界。
- **R-DW9 词性码映射。** 服务端 `pos` ∈ `n|v|a|r|prep|pron|conj|art|num|aux|int`(spec §3);现有中文行的词性来自词书 `type` 加句点(`n.` `v.` `vt.` `adj.` `adv.` `prep.` `pron.` `num.` `conj.` `int.` `aux.` `art.`,由 `posLabel`)。映射:`n→n.`、`v→v.`、`a→adj.`、`r→adv.`、其余码原样加句点;未知码走同一个加句点回退。英文行只有 `v.`,不区分 `vt.` / `vi.`(WordNet 的动词不分及物性),与同一张卡的中文 `vt.` 并存是可接受的。每个词性一行,同一词性的两条用「; 」连成一段(一个 `lang="en"` 区块),客户端再次截到每词性 2 条(防御,服务端已限)。
- **R-DW10 短语区的状态模型。** (a)受控 `<details open={open}>`;`<summary onClick>` 里 `preventDefault()` 再自己 `setOpen`,不依赖 `toggle` 事件(浏览器对初始 `open` 属性也会发 `toggle`,jsdom 行为不同;用 click 在两处一致)。(b)初始 `open` 在区块**挂载**时算一次:`"auto"` → 本机偏好不是 `false` 就开;`true` / `false` 照传。区块只在词卡未遮罩时渲染,所以挂载时刻就是「遮罩 → 翻开」的那一刻,不需要另做转换检测;翻开后的手动开合只改本卡的状态。(c)只有 `"auto"` 模式把手动开合写入本机;`false` 模式(复习页 / 已学词页)里手动展开**不写**,否则在复习页展开再收起会写成「收起」,让学新词页不再自动展开。(d)偏好是设备级的一个布尔值(不分词),存在已有的 `WORDBOOK_PREFS_KEY` JSON 的 `phrasesOpen` 字段里(与拼写偏好合并写入,不覆盖;退出登录由 `clearDeviceData` 一并清除);读不到 / 写不了(隐私模式)当作「自动」。(e)展开时标题行只显示「短语」,不再带第一条短语预览(避免重复);收起时与改动前相同;最多 5 条不变。代价:「记住」是全局的而不是逐词;规格没说逐词,设备级最符合「手动收起后记住(本机)」。
- **R-DW11 契约:`defsEn` 可选,夹具必须含至少一张有英文释义的卡。** 现有契约测试用 `Record<keyof Card, true>` 对每张卡做键集相等,可选键会让它对「没有 defs_en 的卡」失败。裁定:键表改为 `Record<Exclude<keyof Card, "defsEn">, true>`,新增 `expectCard()`(键集去掉 `defsEn` 后相等;若有 `defsEn`:每项键恰为 `pos`/`text`、`pos` 属于 `DEF_POS_CODES`、文本非空、每词性 ≤ 2);另一个用例要求 `learn_batch.cards` 中至少一张带 `defsEn`,且 `config.defLang === "both"`。代价:S 的夹具不满足这两点时测试红 → 修 S 的录制,不放宽本测试。
- **R-DW12 先录「改动前」的 DOM 金标准。** 「老服务端渲染与改动前相同」只有在改动前就录下参照才可证。T1 在任何实现改动之前为 `WordCardView` 的三种状态(释义展开、遮罩、不显示例句)写快照测试并提交快照文件;之后每个任务都必须保持它不变(新增的 `data-testid` 只能加在新元素上,不得加在旧元素上)。
- **R-DW13 主包测量。** `check-main-bundle.mjs` 对比的 `main-bundle-baseline.json`(gzip 396.86 kB,2026-10-12)已不是当前值。T1 在改动前 `yarn web:build && node web/scripts/check-main-bundle.mjs --max-delta=999` 记下当前数字;Z3 改动后同样测,报告两个数字与差值(预算 ≤ 0.2 kB)。脚本因基线过期可能以非零码退出,不影响判断;**不得 `--record`**。CSS 增量(新用的工具类)单独报告,不在预算内。
- **R-DW14 偏好的前端缓存。** `useWordbookConfig` 每个 `ApiClient` 只取一次配置(`WeakMap` 缓存),保存后不会刷新它。裁定:`use-def-lang.ts` 维护按 `ApiClient` 为键的 `WeakMap` 覆盖层(`useSyncExternalStore`),`defLang = 覆盖 ?? config.defLang ?? "both"`;保存成功后覆盖层保留(不清除),失败时退回该次保存前的覆盖值(没有则删除);同一时刻的多次保存按递增序号,只有最后一次的失败会回退 / 报错(与 `use-goals` 的 `patch` 同款)。换账号 = 新 `ApiClient`,覆盖层自然失效。代价:另一台设备改了偏好,本设备要刷新页面才跟上。

---

## Lane T — 类型、接口、文案、偏好 hook

### Task T1: 记主包基线与「改动前」DOM 金标准

**Files:**
- Create: `web/src/features/wordbook/word-card-legacy.test.tsx`、`web/src/features/wordbook/__snapshots__/word-card-legacy.test.tsx.snap`(由首次运行生成)

**Interfaces:** 无(只录参照)。

- [ ] **Step 1: 记主包基线** — 在**未改任何源码**的工作树上:`yarn web:build && node web/scripts/check-main-bundle.mjs --max-delta=999`。把输出的 `main bundle: X kB gzip` 与 `css Y kB gzip` 抄进 Z3 的结果表「改动前」一列(若脚本因旧基线报非零码,忽略退出码,记数字)。不要 `--record`。
- [ ] **Step 2: 写金标准测试** — 创建 `web/src/features/wordbook/word-card-legacy.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "~/i18n";
import { renderWithProviders } from "~/test/render";
import { card } from "./test-fixtures";
import { WordCardView } from "./word-card";
import type { Card } from "./wordbook-api";

/**
 * 「改动前」的 DOM 金标准(计划 2026-10-12-wordbook-definitions-web R-DW12):在加英文释义与短语自动展开之前录制,
 * 之后所有任务都必须让它保持不变——老服务端(没有 defsEn、没有 defLang)渲染得和从前一样。
 * 快照文件只在这个任务里生成并提交;后面的任务不得用 -u 更新它。
 */
const TALK = card("talk", {
  senses: [{ pos: "v", text: "说话；谈话" }, { pos: "n", text: "交谈" }],
  phrases: [{ en: "talk about", zh: "谈论" }, { en: "talk back", zh: "顶嘴" }],
}) as unknown as Card;

/** useId 生成的 id(":r0:" 之类)随渲染顺序变化,换成固定占位再比较。 */
export const normalize = (html: string) => html.replace(/:r[0-9a-z]+:/g, ":rN:");

beforeEach(() => {
  localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
  void i18n.changeLanguage("zh-CN");
});
afterEach(() => {
  localStorage.removeItem("enjoy-web.settings");
  void i18n.changeLanguage("en");
});

describe("word card legacy DOM (golden recorded before the definitions work)", () => {
  it.each([
    ["uncovered, with example and phrases", {}],
    ["covered", { covered: true }],
    ["without the example block", { showExample: false }],
  ])("%s", (_name, props) => {
    const { container } = renderWithProviders(<WordCardView card={TALK} {...props} />);
    expect(normalize(container.innerHTML)).toMatchSnapshot();
  });
});
```

- [ ] **Step 3: 录制** — `cd web && yarn vitest run src/features/wordbook/word-card-legacy.test.tsx`(新快照在非 CI 环境会自动写入;若环境是 CI 模式加 `-u` **仅此一次**)。打开 `.snap` 文件确认:uncovered 的快照里有 `<details class="group mt-3 …">` 且**没有** `open` 属性,`<summary>` 内含「短语 · talk about 谈论」;covered 的快照里有 `data-testid="recall-cover"` 且没有释义文字。
- [ ] **Step 4: 提交** — `git add web/src/features/wordbook/word-card-legacy.test.tsx web/src/features/wordbook/__snapshots__` → `test(web): record legacy word-card DOM golden before the definitions work`(尾行 `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`)。

### Task T2: 类型、`def-lang.ts`、夹具、契约测试

**Files:**
- Modify: `web/src/features/wordbook/wordbook-api.ts`、`web/src/features/wordbook/test-fixtures.ts`、`web/src/features/wordbook/wordbook-contract.test.ts`
- Create: `web/src/features/wordbook/def-lang.ts`、`web/src/features/wordbook/def-lang.test.ts`

**Interfaces:**
- Produces(`wordbook-api.ts`,仅类型):`DefEn { pos: string; text: string }`、`DefLang = "both" | "zh" | "en"`、`Card.defsEn?: DefEn[]`、`WordbookConfig`(`enabled: true` 分支)`defLang?: DefLang`。
- Produces(`def-lang.ts`):`DEF_LANGS`、`isDefLang(v)`、`defLangOf(config)`、`DEF_LANG_PATH`、`saveDefLang(api, defLang)`、`MAX_DEFS_PER_POS = 2`、`EN_POS_LABELS`、`DEF_POS_CODES`、`enPosLabel(pos)`、`DefGroup { pos; label; texts }`、`groupDefs(defs)`。
- Produces(`test-fixtures.ts`):`DEFS_EN`(含一条超限的第三条,测客户端截断)、`defsCard(key, extra?)`(snake_case 服务端样例,键 `defs_en`)。

- [ ] **Step 1: 类型** — `wordbook-api.ts` 三处小改。`WordbookConfig` 的 `enabled: true` 分支末尾(`limits?` 之后)加:

```ts
      /** 释义显示偏好(spec 2026-10-12-wordbook-definitions §4)。老版本服务端没有这个键:一律经 `defLangOf`(def-lang.ts)取值。 */
      defLang?: DefLang;
```
`Sense` 之后加:

```ts
/** 英英释义(spec 2026-10-12-wordbook-definitions §4):`pos` 是服务端词性码,每个词性最多 2 条;缺口词 / 老服务端没有 `defsEn`。 */
export interface DefEn { pos: string; text: string }
/** 释义显示:中英(默认)/ 仅中文 / 仅英文。 */
export type DefLang = "both" | "zh" | "en";
```
`Card` 改为:

```ts
export interface Card { key: string; word: string; us: string; uk: string; senses: Sense[]; phrases: { en: string; zh: string }[]; examples: Example[]; defsEn?: DefEn[] }
```
(只有类型,主包不增长。)

- [ ] **Step 2: 写失败测试** — 创建 `web/src/features/wordbook/def-lang.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { DEFS_EN } from "./test-fixtures";
import {
  DEF_LANGS, DEF_LANG_PATH, DEF_POS_CODES, defLangOf, enPosLabel, groupDefs, isDefLang, saveDefLang,
} from "./def-lang";
import { fetchLearnedCard, type WordbookConfig } from "./wordbook-api";
import { posLabel } from "./word-card";

const client = (routes: Parameters<typeof createFetchMock>[0]) => {
  const mock = createFetchMock(routes);
  return { mock, api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) };
};
const ON = { enabled: true, aiAvailable: false, defaults: { dailyNew: 20, reviewCap: 100 }, books: [], learn: { autoplay: true, showExample: true } } as WordbookConfig;

describe("definitions preference", () => {
  it("accepts exactly the three server values", () => {
    expect([...DEF_LANGS]).toEqual(["both", "zh", "en"]);
    for (const ok of ["both", "zh", "en"]) expect(isDefLang(ok)).toBe(true);
    for (const bad of ["", "EN", "english", null, undefined, 1, {}]) expect(isDefLang(bad)).toBe(false);
  });

  it("reads defLang with a safe default (old servers have no key)", () => {
    expect(defLangOf(null)).toBe("both");
    expect(defLangOf({ enabled: false })).toBe("both");
    expect(defLangOf(ON)).toBe("both");
    expect(defLangOf({ ...ON, defLang: "zh" } as WordbookConfig)).toBe("zh");
    expect(defLangOf({ ...ON, defLang: "klingon" } as unknown as WordbookConfig)).toBe("both");
  });

  it("PATCHes def_lang to the settings endpoint", async () => {
    const { mock, api } = client({ "PATCH /api/wordbook/settings": () => json({ def_lang: "en" }) });
    expect(await saveDefLang(api, "en")).toEqual({ defLang: "en" });
    const call = mock.calls[0];
    expect(call.method).toBe("PATCH");
    expect(call.url.pathname).toBe(DEF_LANG_PATH);
    expect(call.url.search).toBe("");
    expect(JSON.parse(String(call.body))).toEqual({ def_lang: "en" });
  });

  it("camelCases defs_en on cards and leaves cards without it alone", async () => {
    const { api } = client({
      "POST /api/wordbook/learned/card": () => json({
        key: "talk", word: "talk", us: "", uk: "", senses: [], phrases: [], examples: [], defs_en: [{ pos: "v", text: "exchange thoughts" }],
      }),
    });
    expect((await fetchLearnedCard(api, "cet4", "talk")).defsEn).toEqual([{ pos: "v", text: "exchange thoughts" }]);
    const old = client({ "POST /api/wordbook/learned/card": () => json({ key: "talk", word: "talk", us: "", uk: "", senses: [], phrases: [], examples: [] }) });
    expect("defsEn" in (await fetchLearnedCard(old.api, "cet4", "talk"))).toBe(false);
  });
});

describe("POS labels", () => {
  it("match the labels the Chinese rows already use (posLabel on the词书 type)", () => {
    for (const code of ["n", "v", "prep", "pron", "conj", "art", "num", "aux", "int"]) expect(enPosLabel(code)).toBe(posLabel(code));
    expect(enPosLabel("a")).toBe(posLabel("adj"));
    expect(enPosLabel("r")).toBe(posLabel("adv"));
    expect(DEF_POS_CODES).toEqual(["n", "v", "a", "r", "prep", "pron", "conj", "art", "num", "aux", "int"]);
  });
  it("falls back to a dotted code and never reads the prototype", () => {
    expect(enPosLabel("x")).toBe("x.");
    expect(enPosLabel("x.")).toBe("x.");
    expect(enPosLabel("constructor")).toBe("constructor.");
    expect(enPosLabel("")).toBe("");
  });
});

describe("groupDefs", () => {
  it("groups by POS in server order and keeps at most two texts per POS", () => {
    expect(groupDefs(DEFS_EN)).toEqual([
      { pos: "v", label: "v.", texts: ["exchange thoughts or ideas by speaking", "use language to express something"] },
      { pos: "n", label: "n.", texts: ["an exchange of ideas by speaking"] },
    ]);
  });
  it("drops blank texts and tolerates a missing or malformed list", () => {
    expect(groupDefs(undefined)).toEqual([]);
    expect(groupDefs([])).toEqual([]);
    expect(groupDefs("nope" as unknown as undefined)).toEqual([]);
    expect(groupDefs([{ pos: "n", text: "   " }, { pos: "v", text: " go " }])).toEqual([{ pos: "v", label: "v.", texts: ["go"] }]);
  });
});
```
(`posLabel("adj")` → `"adj."`;测试里中文注释的「词书」是笔误无害,执行时顺手改成「词书」亦可。)

- [ ] **Step 3: 运行确认失败** — `cd web && yarn vitest run src/features/wordbook/def-lang.test.ts`:模块不存在。
- [ ] **Step 4: 夹具** — `test-fixtures.ts` 末尾追加:

```ts
/** 英英释义样例(键 pos / text 在 snake_case 与 camelCase 下相同)。第三条 v 是故意超限的,用来测客户端截到每词性 2 条。 */
export const DEFS_EN = [
  { pos: "v", text: "exchange thoughts or ideas by speaking" },
  { pos: "v", text: "use language to express something" },
  { pos: "v", text: "a third verb definition that must not be shown" },
  { pos: "n", text: "an exchange of ideas by speaking" },
];

/** 带英文释义的服务端样例卡(snake_case:键 `defs_en`)。 */
export const defsCard = (key: string, extra: Record<string, unknown> = {}) => card(key, { defs_en: DEFS_EN, ...extra });
```

- [ ] **Step 5: 实现 `def-lang.ts`**:

```ts
// 英英释义与释义显示偏好的运行时辅助(计划 2026-10-12-wordbook-definitions-web R-DW2 / R-DW4)。
// 只被懒加载块引用:类型在 wordbook-api.ts(擦除),这里的运行时代码不进主包。
import type { ApiClient } from "~/api/client";
import type { DefEn, DefLang, WordbookConfig } from "./wordbook-api";

export const DEF_LANGS: readonly DefLang[] = ["both", "zh", "en"];
export const isDefLang = (v: unknown): v is DefLang => typeof v === "string" && (DEF_LANGS as readonly string[]).includes(v);

/** 配置里的偏好;老服务端没有这个键 / 值不认识 / 配置没到 → "both"。 */
export const defLangOf = (config: WordbookConfig | null): DefLang =>
  config?.enabled && isDefLang(config.defLang) ? config.defLang : "both";

/** 保存偏好的端点(R-DW2:与服务端计划对表,只此一处)。体里的 defLang 由 ApiClient 转成 def_lang。 */
export const DEF_LANG_PATH = "/api/wordbook/settings";
export const saveDefLang = (api: ApiClient, defLang: DefLang) =>
  api.request<{ defLang: DefLang }>("PATCH", DEF_LANG_PATH, { json: { defLang } });

/** 每个词性最多显示几条英文释义(服务端也限 2 条;客户端再截一次作防御)。 */
export const MAX_DEFS_PER_POS = 2;

/** 服务端词性码 → 显示标签,与中文行的标签写法一致(posLabel:`n.` `v.` `adj.` `adv.` …)。 */
export const EN_POS_LABELS: Readonly<Record<string, string>> = {
  n: "n.", v: "v.", a: "adj.", r: "adv.", prep: "prep.", pron: "pron.", conj: "conj.", art: "art.", num: "num.", aux: "aux.", int: "int.",
};
export const DEF_POS_CODES: readonly string[] = Object.keys(EN_POS_LABELS);

export const enPosLabel = (pos: string): string =>
  Object.prototype.hasOwnProperty.call(EN_POS_LABELS, pos) ? EN_POS_LABELS[pos] : pos && !pos.endsWith(".") ? `${pos}.` : pos;

export interface DefGroup { pos: string; label: string; texts: string[] }

/** 按词性分组(保持服务端顺序),每组最多 MAX_DEFS_PER_POS 条,丢掉空文本;缺省 / 形状不对 → []。 */
export function groupDefs(defs: readonly DefEn[] | undefined): DefGroup[] {
  if (!Array.isArray(defs)) return [];
  const groups: DefGroup[] = [];
  for (const d of defs) {
    const text = typeof d?.text === "string" ? d.text.trim() : "";
    if (!text || typeof d.pos !== "string") continue;
    let group = groups.find((g) => g.pos === d.pos);
    if (!group) {
      group = { pos: d.pos, label: enPosLabel(d.pos), texts: [] };
      groups.push(group);
    }
    if (group.texts.length < MAX_DEFS_PER_POS) group.texts.push(text);
  }
  return groups;
}
```

- [ ] **Step 6: 契约测试** — 改 `wordbook-contract.test.ts`:
  1. import 追加 `DefEn`(类型,来自 `./wordbook-api`)与 `import { DEF_POS_CODES, isDefLang } from "./def-lang";`。
  2. 把 `const CARD: Record<keyof Card, true> = {…}` 改为:

```ts
// defsEn 是可选键(缺省 = 没有英文释义):键表不含它,由 expectCard 单独核对(R-DW11)
const CARD: Record<Exclude<keyof Card, "defsEn">, true> = { key: true, word: true, us: true, uk: true, senses: true, phrases: true, examples: true };
const DEF_EN: Record<keyof DefEn, true> = { pos: true, text: true };

/** 卡片形状:基础键相等;若有 defsEn,逐项核对键、词性码、非空文本与每词性 ≤ 2 条。 */
function expectCard(card: Card) {
  expect(keysOf(card).filter((k) => k !== "defsEn")).toEqual(keys(CARD));
  const perPos = new Map<string, number>();
  for (const d of card.defsEn ?? []) {
    expect(keysOf(d)).toEqual(keys(DEF_EN));
    expect(DEF_POS_CODES).toContain(d.pos);
    expect(d.text.trim().length).toBeGreaterThan(0);
    perPos.set(d.pos, (perPos.get(d.pos) ?? 0) + 1);
  }
  for (const n of perPos.values()) expect(n).toBeLessThanOrEqual(2);
}
```
  3. 把四处 `expect(keysOf(cc<Card>(…))).toEqual(keys(CARD))` 换成 `expectCard(cc<Card>(…))`:`c.card`、`c.learned_card`、`free.items[0].card`、`review_batch` 循环里的 `cc<Card>(card)`。
  4. 在 `describe` 末尾(「never sends word-keyed maps」之后)追加:

```ts
  it("definitions: defsEn on cards and defLang in the config (spec 2026-10-12-wordbook-definitions §4)", () => {
    const batch = cc<{ cards: Card[] }>(c.learn_batch);
    for (const card of batch.cards) expectCard(card);
    expect(batch.cards.some((card) => (card.defsEn?.length ?? 0) > 0)).toBe(true);
    const config = cc<Extract<WordbookConfig, { enabled: true }>>(c.config);
    expect(isDefLang(config.defLang)).toBe(true);
    expect(config.defLang).toBe("both");
  });
```
- [ ] **Step 7: 运行** — `cd web && yarn vitest run src/features/wordbook/def-lang.test.ts src/features/wordbook/wordbook-api.test.ts src/features/wordbook/word-card-legacy.test.tsx`,全绿;`yarn web:typecheck`。契约测试 `wordbook-contract.test.ts` **在 S 合并后**才应全绿(夹具需含 `defs_en` 与 `def_lang`):S 未合并时只确认其余用例不受影响,S 合并后再跑。
- [ ] **Step 8: 提交** — `feat(web): defsEn and defLang types, helpers and contract checks`。

### Task T3: 懒加载文案 `web.wordbookDefs`

**Files:**
- Create: `web/src/features/wordbook/locales.ts`、`web/src/features/wordbook/locales/en.json`、`web/src/features/wordbook/locales/zh-CN.json`、`web/src/features/wordbook/locales.test.ts`

**Interfaces:**
- Produces:`ensureWordbookDefsI18n()`;键 `web.wordbookDefs.label`、`web.wordbookDefs.setting.label`、`.setting.help`、`.setting.options.{both,zh,en}`。

- [ ] **Step 1: 写失败测试** — `locales.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import i18n, { webMessages } from "~/i18n";
import { ensureWordbookDefsI18n } from "./locales";
import en from "./locales/en.json";
import zh from "./locales/zh-CN.json";

type Dict = Record<string, unknown>;
const keysOf = (d: unknown, prefix = ""): string[] =>
  d && typeof d === "object" ? Object.entries(d as Dict).flatMap(([k, v]) => keysOf(v, prefix ? `${prefix}.${k}` : k)) : [prefix];
const at = (d: unknown, path: string): unknown => path.split(".").reduce<unknown>((acc, k) => (acc as Dict | undefined)?.[k], d);

describe("wordbook definitions locales (R-DW1: lazy, outside the eager i18n glob)", () => {
  it("has the same keys in en and zh-CN, all under web.wordbookDefs", () => {
    expect(keysOf(en).sort()).toEqual(keysOf(zh).sort());
    expect(keysOf(en).every((k) => k.startsWith("web.wordbookDefs."))).toBe(true);
  });

  it("is not part of the eagerly merged web messages (so it cannot grow the main bundle)", () => {
    expect(at(webMessages("en"), "web.wordbookDefs")).toBeUndefined();
    expect(at(webMessages("zh-CN"), "web.wordbookDefs")).toBeUndefined();
  });

  it("merges into i18next once loaded and does not overwrite the eager wordbook keys", () => {
    ensureWordbookDefsI18n();
    ensureWordbookDefsI18n(); // 幂等
    expect(i18n.getFixedT("zh-CN")("web.wordbookDefs.setting.label")).toBe("释义显示");
    expect(i18n.getFixedT("zh-CN")("web.wordbookDefs.setting.options.zh")).toBe("仅中文");
    expect(i18n.getFixedT("en")("web.wordbookDefs.setting.options.en")).toBe("English only");
    expect(i18n.getFixedT("en")("web.wordbook.word.phrases")).toBeTruthy();
    expect(i18n.getFixedT("en")("web.wordbook.goals.saved")).toBeTruthy();
  });

  it("keeps the one-line segmented labels short enough for a 360 px sheet (jsdom has no layout; real width unverified)", () => {
    for (const key of ["both", "zh", "en"]) {
      expect(String(at(en, `web.wordbookDefs.setting.options.${key}`)).length, key).toBeLessThanOrEqual(12);
      expect(String(at(zh, `web.wordbookDefs.setting.options.${key}`)).length, key).toBeLessThanOrEqual(4);
    }
  });
});
```
- [ ] **Step 2: 文案** — `locales/zh-CN.json`:

```json
{
  "web": {
    "wordbookDefs": {
      "label": "英文释义(参考)",
      "setting": {
        "label": "释义显示",
        "help": "翻开词卡后显示;小测的题面和选项仍用中文。英文释义取自开放词典,仅供参考。",
        "options": { "both": "中英", "zh": "仅中文", "en": "仅英文" }
      }
    }
  }
}
```
`locales/en.json`:

```json
{
  "web": {
    "wordbookDefs": {
      "label": "English definitions (reference)",
      "setting": {
        "label": "Definitions",
        "help": "Shown once a card is open. Quizzes stay in Chinese. English definitions come from an open dictionary and are a reference only.",
        "options": { "both": "Both", "zh": "Chinese only", "en": "English only" }
      }
    }
  }
}
```
- [ ] **Step 3: 实现** — `locales.ts`:

```ts
import i18n from "~/i18n";
import en from "./locales/en.json";
import zh from "./locales/zh-CN.json";

/**
 * 英英释义的文案不进主包(R-DW1):`**\/i18n/*.json` 由 i18n/index.ts 急切合并,这里的 locales/ 不在那个 glob 里。
 * 用到它的模块(word-card、def-lang-setting)都 `import "./locales"`,模块求值时并入 i18next(深合并,不覆盖已有键)。
 */
let loaded = false;
export function ensureWordbookDefsI18n(): void {
  if (loaded) return;
  loaded = true;
  i18n.addResourceBundle("en", "translation", en, true, false);
  i18n.addResourceBundle("zh-CN", "translation", zh, true, false);
}

ensureWordbookDefsI18n();
```
- [ ] **Step 4: 运行** — `cd web && yarn vitest run src/features/wordbook/locales.test.ts src/features/wordbook/i18n.test.ts src/i18n`;全绿。
- [ ] **Step 5: 提交** — `feat(web): lazy wordbookDefs locale bundle`。

### Task T4: `use-def-lang.ts` — 读与乐观保存

**Files:**
- Create: `web/src/features/wordbook/use-def-lang.ts`、`web/src/features/wordbook/use-def-lang.test.tsx`

**Interfaces:**
- Produces:`useDefLangValue(): DefLang`;`useDefLangSetting(): { defLang: DefLang; setDefLang(next: DefLang): Promise<boolean>; saving: boolean; error: string | null }`。
- Consumes:`useWordbookConfig`、`defLangOf`、`saveDefLang`、`translateServerError`、`WORDBOOK_SERVER_ERRORS`、`useAuth`。

- [ ] **Step 1: 写失败测试** — `use-def-lang.test.tsx`:

```tsx
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { TestProviders } from "~/test/render";
import { CONFIG } from "./test-fixtures";
import { useDefLangSetting, useDefLangValue } from "./use-def-lang";

function setup(config: unknown = CONFIG, extra: Record<string, Handler> = {}) {
  const mock = createFetchMock({ "GET /api/wordbook/config": () => json(config), ...extra });
  const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
  const wrapper = ({ children }: { children: ReactNode }) => <TestProviders api={api}>{children}</TestProviders>;
  return { mock, api, wrapper };
}

describe("useDefLang", () => {
  it("defaults to both until the config arrives, then follows config.def_lang", async () => {
    const { wrapper } = setup({ ...CONFIG, def_lang: "zh" });
    const { result } = renderHook(() => useDefLangValue(), { wrapper });
    expect(result.current).toBe("both");
    await waitFor(() => expect(result.current).toBe("zh"));
  });

  it("stays both on an old server without def_lang", async () => {
    const { wrapper, mock } = setup(CONFIG);
    const { result } = renderHook(() => useDefLangValue(), { wrapper });
    await waitFor(() => expect(mock.calls.some((c) => c.url.pathname === "/api/wordbook/config")).toBe(true));
    expect(result.current).toBe("both");
  });

  it("applies a change at once, sends it, and every reader of the same ApiClient sees it", async () => {
    let release!: () => void;
    const { wrapper, mock } = setup(CONFIG, {
      "PATCH /api/wordbook/settings": () => new Promise<Response>((resolve) => { release = () => resolve(json({ def_lang: "en" })); }),
    });
    const setting = renderHook(() => useDefLangSetting(), { wrapper });
    const reader = renderHook(() => useDefLangValue(), { wrapper });
    let pending!: Promise<boolean>;
    act(() => { pending = setting.result.current.setDefLang("en"); });
    expect(setting.result.current.defLang).toBe("en"); // 乐观:请求还没回来
    expect(reader.result.current).toBe("en");
    expect(setting.result.current.saving).toBe(true);
    await waitFor(() => expect(mock.calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(JSON.parse(String(mock.calls.find((c) => c.method === "PATCH")!.body))).toEqual({ def_lang: "en" });
    await act(async () => { release(); await pending; });
    expect(await pending).toBe(true);
    expect(setting.result.current.saving).toBe(false);
    expect(setting.result.current.error).toBeNull();
    expect(reader.result.current).toBe("en");
  });

  it("rolls back and explains when the save fails", async () => {
    const { wrapper } = setup({ ...CONFIG, def_lang: "zh" }, { "PATCH /api/wordbook/settings": () => json({ error: "nope" }, 500) });
    const { result } = renderHook(() => useDefLangSetting(), { wrapper });
    await waitFor(() => expect(result.current.defLang).toBe("zh"));
    let ok = true;
    await act(async () => { ok = await result.current.setDefLang("en"); });
    expect(ok).toBe(false);
    expect(result.current.defLang).toBe("zh");
    expect(result.current.error).toBeTruthy();
  });

  it("a newer save wins over an older failing one", async () => {
    const fails: Array<() => void> = [];
    let calls = 0;
    const { wrapper } = setup(CONFIG, {
      "PATCH /api/wordbook/settings": () => {
        calls += 1;
        if (calls === 1) return new Promise<Response>((resolve) => { fails.push(() => resolve(json({ error: "late" }, 500))); });
        return json({ def_lang: "zh" });
      },
    });
    const { result } = renderHook(() => useDefLangSetting(), { wrapper });
    act(() => { void result.current.setDefLang("en"); });
    await act(async () => { await result.current.setDefLang("zh"); });
    await act(async () => { fails[0](); });
    expect(result.current.defLang).toBe("zh");
    expect(result.current.error).toBeNull();
  });
});
```
- [ ] **Step 2: 运行确认失败**(模块不存在)。
- [ ] **Step 3: 实现** — `use-def-lang.ts`:

```ts
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { translateServerError } from "~/api/error-messages";
import type { ApiClient } from "~/api/client";
import { useAuth } from "~/auth/auth-context";
import { defLangOf, saveDefLang } from "./def-lang";
import { useWordbookConfig } from "./use-wordbook-config";
import { WORDBOOK_SERVER_ERRORS, type DefLang } from "./wordbook-api";

/**
 * 释义显示偏好(R-DW14)。`useWordbookConfig` 每个 ApiClient 只取一次配置,保存后不会刷新,
 * 所以这里按 ApiClient 记一层「本次会话里用户选过的值」:`defLang = 覆盖 ?? config.defLang ?? "both"`。
 * 换账号 = 新 ApiClient,覆盖层自然失效。
 */
const overrides = new WeakMap<ApiClient, DefLang>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};

/** 只读(会话页 / 词卡抽屉用):没有保存状态,不触发请求。 */
export function useDefLangValue(): DefLang {
  const { api } = useAuth();
  const config = useWordbookConfig();
  const override = useSyncExternalStore(subscribe, () => overrides.get(api), () => undefined);
  return override ?? defLangOf(config);
}

/** 读 + 乐观保存(设置界面用)。多次连续保存带递增序号,只有最后一次的失败会回退 / 报错(同 use-goals 的 patch)。 */
export function useDefLangSetting() {
  const { api } = useAuth();
  const { t } = useTranslation();
  const defLang = useDefLangValue();
  const seq = useRef(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setDefLang = useCallback(async (next: DefLang): Promise<boolean> => {
    const before = overrides.get(api);
    const id = ++seq.current;
    overrides.set(api, next);
    emit();
    setSaving(true);
    setError(null);
    try {
      await saveDefLang(api, next);
      return true;
    } catch (err) {
      if (id === seq.current) {
        if (before === undefined) overrides.delete(api);
        else overrides.set(api, before);
        emit();
        setError(translateServerError(t, err, WORDBOOK_SERVER_ERRORS));
      }
      return false;
    } finally {
      if (id === seq.current) setSaving(false);
    }
  }, [api, t]);

  return { defLang, setDefLang, saving, error };
}
```
- [ ] **Step 4: 运行** — `cd web && yarn vitest run src/features/wordbook/use-def-lang.test.tsx src/architecture.test.ts`,全绿(若 `json({error}, 500)` 的错误形状与 `ApiClient` 不符,按真实 `createFetchMock` / `ApiError` 修测试数据,不改实现语义)。
- [ ] **Step 5: 提交** — `feat(web): useDefLang hook with optimistic save`。

---

## Lane C — 单词卡与调用点

### Task C1: `<DefinitionsEn>` 与 `WordCardView` 的 `defLang`

**Files:**
- Create: `web/src/features/wordbook/defs-en.tsx`、`web/src/features/wordbook/word-card-defs.test.tsx`
- Modify: `web/src/features/wordbook/word-card.tsx`

**Interfaces:**
- Produces:`DefinitionsEn({ groups, className? })`;`WordCardView` 新 prop `defLang?: DefLang`(默认 `"both"`)。
- Consumes:`groupDefs`(def-lang.ts)、`web.wordbookDefs.label`(locales)。

- [ ] **Step 1: 写失败测试** — `word-card-defs.test.tsx`:

```tsx
import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "~/i18n";
import { renderWithProviders } from "~/test/render";
import { normalize } from "./word-card-legacy.test";
import { DEFS_EN, card } from "./test-fixtures";
import { WordCardView } from "./word-card";
import type { Card } from "./wordbook-api";

const BASE = {
  senses: [{ pos: "v", text: "说话；谈话" }, { pos: "n", text: "交谈" }],
  phrases: [{ en: "talk about", zh: "谈论" }],
};
const PLAIN = card("talk", BASE) as unknown as Card;
const WITH_DEFS = { ...card("talk", BASE), defsEn: DEFS_EN } as unknown as Card;
const before = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

beforeEach(() => {
  localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
  void i18n.changeLanguage("zh-CN");
});
afterEach(() => {
  localStorage.removeItem("enjoy-web.settings");
  void i18n.changeLanguage("en");
});

describe("English definitions on the word card", () => {
  it("shows them under the Chinese meaning, per POS, at most two per POS, in lang=en", () => {
    renderWithProviders(<WordCardView card={WITH_DEFS} />);
    const list = screen.getByTestId("word-defs-en");
    expect(list).toHaveAccessibleName("英文释义(参考)");
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute("lang", "en");
    expect(rows[0]).toHaveTextContent("v. exchange thoughts or ideas by speaking; use language to express something");
    expect(rows[1]).toHaveTextContent("n. an exchange of ideas by speaking");
    expect(list).not.toHaveTextContent("third verb definition");
    expect(list.className).toContain("mt-1.5"); // 紧跟中文释义
    expect(rows[0].className).toContain("text-ink-2");
    expect(rows[0].className).toContain("text-sub");
  });

  it("orders Chinese meaning, English definitions, example, phrases", () => {
    renderWithProviders(<WordCardView card={WITH_DEFS} />);
    const zh = screen.getByText("说话；谈话");
    const en = screen.getByTestId("word-defs-en");
    const example = screen.getByText("They talk a lot.", { exact: false });
    const phrases = document.querySelector("details")!;
    expect(before(zh, en)).toBe(true);
    expect(before(en, example)).toBe(true);
    expect(before(example, phrases)).toBe(true);
  });

  it("zh hides English entirely and renders byte-for-byte what a card without defsEn renders", () => {
    const a = renderWithProviders(<WordCardView card={WITH_DEFS} defLang="zh" />);
    expect(screen.queryByTestId("word-defs-en")).toBeNull();
    const withDefs = normalize(a.container.innerHTML);
    a.unmount();
    const b = renderWithProviders(<WordCardView card={PLAIN} defLang="zh" />);
    expect(normalize(b.container.innerHTML)).toBe(withDefs);
  });

  it("en hides the Chinese meaning lines but keeps POS labels, example translation and phrase translation", () => {
    renderWithProviders(<WordCardView card={WITH_DEFS} defLang="en" />);
    expect(screen.queryByText("说话；谈话")).toBeNull();
    expect(screen.queryByText("交谈")).toBeNull();
    const list = screen.getByTestId("word-defs-en");
    expect(within(list).getByText("v.")).toBeTruthy();
    expect(within(list).getByText("n.")).toBeTruthy();
    expect(list.className).toContain("mt-3.5"); // 中文行让位后,英文行是第一块
    expect(screen.getByText("他们常常talk。")).toBeTruthy(); // 例句译文不是释义
    expect(screen.getByText("谈论")).toBeTruthy(); // 短语译文不是释义
  });

  it("en falls back to the Chinese meaning for words without English definitions (R-DW6)", () => {
    renderWithProviders(<WordCardView card={PLAIN} defLang="en" />);
    expect(screen.getByText("说话；谈话")).toBeTruthy();
    expect(screen.queryByTestId("word-defs-en")).toBeNull();
    const empty = { ...PLAIN, defsEn: [] } as Card;
    renderWithProviders(<WordCardView card={empty} defLang="en" />);
    expect(screen.getAllByText("说话；谈话")).toHaveLength(2);
  });

  it("keeps definitions out of the DOM while the card is covered, and shows them once revealed", () => {
    const view = renderWithProviders(<WordCardView card={WITH_DEFS} covered onReveal={() => {}} />);
    expect(screen.queryByTestId("word-defs-en")).toBeNull();
    expect(screen.getByTestId("word-card")).not.toHaveTextContent("exchange thoughts");
    expect(screen.getByTestId("word-card")).not.toHaveTextContent("说话；谈话");
    view.unmount();
    renderWithProviders(<WordCardView card={WITH_DEFS} />);
    expect(screen.getByTestId("word-defs-en")).toBeTruthy();
  });

  it("an old card without defsEn renders exactly as before in every mode but en-with-defs", () => {
    for (const mode of ["both", "zh", "en"] as const) {
      const first = renderWithProviders(<WordCardView card={PLAIN} defLang={mode} />);
      const html = normalize(first.container.innerHTML);
      first.unmount();
      const second = renderWithProviders(<WordCardView card={PLAIN} />);
      expect(html, mode).toBe(normalize(second.container.innerHTML));
      second.unmount();
    }
  });

  it("ignores blank texts and unknown POS codes safely", () => {
    const odd = { ...PLAIN, defsEn: [{ pos: "x", text: "odd one" }, { pos: "n", text: "  " }] } as Card;
    renderWithProviders(<WordCardView card={odd} />);
    const rows = within(screen.getByTestId("word-defs-en")).getAllByRole("listitem");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("x. odd one");
  });
});
```
`word-card-legacy.test` 里的 `normalize` 从测试文件导入会把那个文件的 `describe` 也跑一遍;为避免重复,把 `normalize` 移到 `test-fixtures.ts`(追加 `export const normalizeIds = …`,T2 已改过该文件;此处属 C 车道对 `test-fixtures.ts` 的唯一追加,T 合并后做),两个测试都从 `./test-fixtures` 引入。执行时以此为准,上面代码里的 import 改成 `import { DEFS_EN, card, normalizeIds as normalize } from "./test-fixtures";` 并删掉对 `word-card-legacy.test` 的引用;`word-card-legacy.test.tsx` 同步改为 import(不改快照内容)。

- [ ] **Step 2: 运行确认失败**(`word-defs-en` 不存在)。
- [ ] **Step 3: 实现 `defs-en.tsx`**:

```tsx
import { useTranslation } from "react-i18next";
import { cn } from "@renderer/lib/utils";
import type { DefGroup } from "./def-lang";
import "./locales";

/**
 * 英文释义行(spec 2026-10-12-wordbook-definitions §5):每个词性一行,小号 `text-ink-2`,整行 `lang="en"`
 * (词性标签与释义同属英文,读屏换英文声音)。同一词性的两条用「; 」连成一段。参考释义:列表带无障碍名称「英文释义(参考)」。
 */
export function DefinitionsEn({ groups, className }: { groups: readonly DefGroup[]; className?: string }) {
  const { t } = useTranslation();
  return (
    <ul data-testid="word-defs-en" aria-label={t("web.wordbookDefs.label")} className={cn("flex flex-col gap-1", className)}>
      {groups.map((g) => (
        <li key={g.pos} lang="en" className="text-sub leading-dialogue text-ink-2">
          <em className="mr-1.5 font-mono text-meta font-semibold not-italic">{g.label}</em>
          <span className="break-words">{g.texts.join("; ")}</span>
        </li>
      ))}
    </ul>
  );
}
```
- [ ] **Step 4: 改 `word-card.tsx`** — (a)import 区加:

```tsx
import { groupDefs } from "./def-lang";
import { DefinitionsEn } from "./defs-en";
import "./locales";
```
并把 `import type { Card, Sense } from "./wordbook-api";` 改为 `import type { Card, DefLang, Sense } from "./wordbook-api";`。(b)`WordCardView` 的参数解构加 `defLang = "both"`,类型里加 `defLang?: DefLang;`,文档注释末尾加一句「`defLang`:释义显示(`zh` 不显示英文释义,`en` 在有英文释义时不显示中文释义行;默认 `both`)」。(c)在 `const phonetics = …` 之后加:

```tsx
  const defGroups = groupDefs(card.defsEn);
  const showDefs = defLang !== "zh" && defGroups.length > 0;
  // 「仅英文」:有英文释义时中文行让位;缺口词(没有英文释义)仍显示中文,否则答案是空的(R-DW6)
  const showSenses = card.senses.length > 0 && !(defLang === "en" && showDefs);
```
(d)把释义块 `{card.senses.length ? (<ul …>…</ul>) : null}` 的条件改成 `{showSenses ? (`,其余(`<ul className="mt-3.5 flex flex-col gap-1.5">` 及内部)一字不动;紧跟其后加:

```tsx
          {showDefs ? <DefinitionsEn groups={defGroups} className={showSenses ? "mt-1.5" : "mt-3.5"} /> : null}
```
**不要**给旧元素加 `data-testid`(金标准,R-DW12)。
- [ ] **Step 5: 运行** — `cd web && yarn vitest run src/features/wordbook/word-card-defs.test.tsx src/features/wordbook/word-card-legacy.test.tsx src/features/wordbook/recall-cover.test.tsx src/features/wordbook/learn-page.test.tsx src/features/wordbook/learned-page.test.tsx`;legacy 快照**不得变化**(出现差异说明动了旧 DOM,修实现,不更新快照)。
- [ ] **Step 6: 提交** — `feat(web): English definition lines on the word card`。

### Task C2: 各调用点传 `defLang`

**Files:**
- Modify: `web/src/features/wordbook/recall-card.tsx`、`learn-page.tsx`、`review-page.tsx`、`learned-page.tsx`、`free-browse.tsx`、`link-actions.tsx`
- Create: `web/src/features/wordbook/def-lang-wiring.test.ts`、`web/src/features/wordbook/recall-card.test.tsx`

**Interfaces:** `RecallCard` 新 prop `defLang?: DefLang`(透传给 `Back` → `WordCardView`);其余文件只加一个 hook 调用与一个 prop。

- [ ] **Step 1: 写失败测试(结构 + 组件)** — `def-lang-wiring.test.ts`:

```ts
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const sources = readdirSync(here).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.endsWith("test-fixtures.ts"));

/**
 * R-DW5:`defLang` 是显式 prop,漏传会静默退回「中英」。扫描源码:每个 <WordCardView / <RecallCard / cardModule.WordCardView 的
 * JSX 起始标签(到第一个 `/>` 为止)里必须出现 `defLang=`——所以 defLang 要写在 badge 等带 `/>` 的 prop 之前。
 */
describe("definitions preference wiring", () => {
  it("passes defLang at every word-card call site", () => {
    const missing: string[] = [];
    let seen = 0;
    for (const file of sources) {
      const text = readFileSync(path.join(here, file), "utf8");
      for (const m of text.matchAll(/<(?:cardModule\.)?(?:WordCardView|RecallCard)\b[\s\S]*?\/>/g)) {
        seen += 1;
        if (!/\bdefLang=/.test(m[0])) missing.push(`${file}: ${m[0].slice(0, 60).replace(/\s+/g, " ")}`);
      }
    }
    expect(seen).toBeGreaterThanOrEqual(6); // learn、review、learned、free-browse、link-actions、recall-card(Back)
    expect(missing).toEqual([]);
  });

  it("learn, review, learned and browse read the preference with the shared hook", () => {
    for (const file of ["learn-page.tsx", "review-page.tsx", "learned-page.tsx", "free-browse.tsx"]) {
      expect(readFileSync(path.join(here, file), "utf8"), file).toContain("useDefLangValue()");
    }
  });
});
```
`recall-card.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "~/i18n";
import { renderWithProviders } from "~/test/render";
import { DEFS_EN, card } from "./test-fixtures";
import { RecallCard } from "./recall-card";
import type { Card, Question } from "./wordbook-api";

const CARD = { ...card("talk", { senses: [{ pos: "v", text: "说话；谈话" }] }), defsEn: DEFS_EN } as unknown as Card;
const QUESTION: Question = { key: "talk", qtype: "recall", prompt: { word: "talk", us: "tɔk" }, options: null, length: null };

beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); void i18n.changeLanguage("zh-CN"); });
afterEach(() => { localStorage.removeItem("enjoy-web.settings"); void i18n.changeLanguage("en"); });

describe("RecallCard back (review quick recall / browse)", () => {
  it("front has no meaning at all, in any mode", () => {
    renderWithProviders(<RecallCard question={QUESTION} card={CARD} face="front" rating={null} defLang="both" />);
    expect(screen.queryByTestId("word-defs-en")).toBeNull();
    expect(screen.getByTestId("recall-card")).not.toHaveTextContent("说话；谈话");
  });

  it.each([
    ["both", true, true],
    ["zh", true, false],
    ["en", false, true],
  ] as const)("back with defLang=%s shows zh=%s en=%s", (mode, zh, en) => {
    renderWithProviders(<RecallCard question={QUESTION} card={CARD} face="back" rating={null} defLang={mode} />);
    expect(Boolean(screen.queryByText("说话；谈话"))).toBe(zh);
    expect(Boolean(screen.queryByTestId("word-defs-en"))).toBe(en);
  });

  it("keeps the phrases collapsed on the review back (only the learn page auto-opens them)", () => {
    renderWithProviders(<RecallCard question={QUESTION} card={CARD} face="back" rating={null} />);
    expect(document.querySelector("details")).not.toHaveAttribute("open");
  });
});
```
(最后一个用例在 X2 之前也应为绿:现在 `<details>` 没有 `open`。)
- [ ] **Step 2: 运行确认失败**(wiring 测试:找不到 `defLang=`)。
- [ ] **Step 3: 实现** —
  - `recall-card.tsx`:`import type { Card, DefLang, Question } from "./wordbook-api";`;`Back` 的参数加 `defLang: DefLang`,渲染改为 `<WordCardView card={card} defLang={defLang} {...listen} showExample={showExample} eyebrow={…} badge={…} />`(`defLang` 紧跟 `card`,在带 `/>` 的 `badge` 之前);`RecallCard` 参数加 `defLang = "both"`(类型 `defLang?: DefLang`),`<Back card={card} defLang={defLang} rating={rating} showExample={showExample} listen={listen} />`,并把 `Back` 的 props 类型同步。
  - `learn-page.tsx`:`import { useDefLangValue } from "./use-def-lang";`;在 `const showExample = …` 之后 `const defLang = useDefLangValue();`;`<WordCardView key={current.key} card={current} defLang={defLang} {...listen} covered=…`。
  - `review-page.tsx`:同样 import;`ReviewSession` 里 `const showExample = …` 之后 `const defLang = useDefLangValue();`;`<RecallCard key=… question={question} card={batch?.cards[question.key]} defLang={defLang} face=…`。
  - `learned-page.tsx`:`CardSheet` 里 `const showExample = …` 之后 `const defLang = useDefLangValue();`;`<WordCardView card={card} defLang={defLang} showExample=…`。
  - `free-browse.tsx`:`const defLang = useDefLangValue();`(`showExample` 之后);`<RecallCard key=… question={question} card={item.card} defLang={defLang} face=…`。
  - `link-actions.tsx`(主包里的插件文件,只动懒加载块):`LazyLinkCard` 的 `Promise.all` 加第三项 `import("./use-def-lang")`,回调参数 `([cardModule, speakerModule, defLangModule])`,`LinkCardView` 里 `const defLang = defLangModule.useDefLangValue();` 并 `<cardModule.WordCardView card={card} defLang={defLang} className=…`。(wiring 测试的第二个用例不要求这个文件用 `useDefLangValue()` 字面量形式。)
  这些调用点都**只传值**,不改其它行为。
- [ ] **Step 4: 运行** — `cd web && yarn vitest run src/features/wordbook src/architecture.test.ts`(整个 wordbook 目录,约几十秒);全绿且 `word-card-legacy` 快照未变。再 `yarn web:typecheck`。
- [ ] **Step 5: 提交** — `feat(web): pass the definitions preference to every word card`。

---

## Lane P — 设置界面

### Task P1: `<DefLangSetting>` 放进每日目标面板

**Files:**
- Create: `web/src/features/wordbook/def-lang-setting.tsx`、`web/src/features/wordbook/def-lang-setting.test.tsx`
- Modify: `web/src/features/wordbook/goals-sheet.tsx`、`web/src/features/wordbook/goals-sheet.test.tsx`(追加一个用例)

**Interfaces:**
- Produces:`DefLangSetting()`(无 props,自取偏好)。
- Consumes:`useDefLangSetting`、`SegmentedControl`、`DEF_LANGS`(def-lang.ts)、`web.wordbookDefs.setting.*`、`web.wordbook.goals.saved`(急切键,复用)。

- [ ] **Step 1: 写失败测试** — `def-lang-setting.test.tsx`:

```tsx
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { DefLangSetting } from "./def-lang-setting";
import { CONFIG } from "./test-fixtures";

function setup(config: unknown = CONFIG, extra: Record<string, Handler> = {}) {
  const mock = createFetchMock({ "GET /api/wordbook/config": () => json(config), ...extra });
  renderWithProviders(<DefLangSetting />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
  return mock;
}
const group = () => screen.getByRole("radiogroup", { name: "释义显示" });

beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); void i18n.changeLanguage("zh-CN"); });
afterEach(() => { localStorage.removeItem("enjoy-web.settings"); void i18n.changeLanguage("en"); });

describe("DefLangSetting", () => {
  it("offers 中英 / 仅中文 / 仅英文 with 中英 selected on an old server", async () => {
    setup();
    const radios = within(group()).getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(["中英", "仅中文", "仅英文"]);
    expect(screen.getByRole("radio", { name: "中英" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/小测的题面和选项仍用中文/)).toBeTruthy();
    for (const r of radios) expect(r.className).toContain("hit-expand"); // 视觉 32px、命中 44px
  });

  it("selects the server value once the config arrives", async () => {
    setup({ ...CONFIG, def_lang: "zh" });
    await waitFor(() => expect(screen.getByRole("radio", { name: "仅中文" })).toHaveAttribute("aria-checked", "true"));
  });

  it("applies a choice before the server answers, then announces it", async () => {
    let release!: () => void;
    const mock = setup(CONFIG, {
      "PATCH /api/wordbook/settings": () => new Promise<Response>((resolve) => { release = () => resolve(json({ def_lang: "en" })); }),
    });
    await userEvent.click(screen.getByRole("radio", { name: "仅英文" }));
    expect(screen.getByRole("radio", { name: "仅英文" })).toHaveAttribute("aria-checked", "true");
    await waitFor(() => expect(mock.calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(JSON.parse(String(mock.calls.find((c) => c.method === "PATCH")!.body))).toEqual({ def_lang: "en" });
    release();
    await waitFor(() => expect(screen.getByText("已保存")).toBeTruthy());
  });

  it("goes back and says why when saving fails", async () => {
    setup({ ...CONFIG, def_lang: "zh" }, { "PATCH /api/wordbook/settings": () => json({ error: "nope" }, 500) });
    await waitFor(() => expect(screen.getByRole("radio", { name: "仅中文" })).toHaveAttribute("aria-checked", "true"));
    await userEvent.click(screen.getByRole("radio", { name: "仅英文" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "仅中文" })).toHaveAttribute("aria-checked", "true");
  });

  it("is reachable by keyboard like the other segmented controls", async () => {
    setup();
    screen.getByRole("radio", { name: "中英" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "仅中文" })).toHaveAttribute("aria-checked", "true");
  });
});
```
`goals-sheet.test.tsx` 追加(用文件里已有的 `setup` / `openSheet`):

```tsx
describe("GoalsSheet definitions setting", () => {
  it("contains the definitions segmented control, 中英 by default", async () => {
    setup();
    const sheet = await openSheet();
    expect(within(sheet).getByRole("radiogroup", { name: "释义显示" })).toBeTruthy();
    expect(within(sheet).getByRole("radio", { name: "中英" })).toHaveAttribute("aria-checked", "true");
  });
});
```
- [ ] **Step 2: 运行确认失败。**
- [ ] **Step 3: 实现 `def-lang-setting.tsx`**:

```tsx
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { SegmentedControl } from "~/components/segmented-control";
import { DEF_LANGS } from "./def-lang";
import { useDefLangSetting } from "./use-def-lang";
import type { DefLang } from "./wordbook-api";
import "./locales";

/**
 * 「释义显示:中英 / 仅中文 / 仅英文」(spec 2026-10-12-wordbook-definitions §5,R-DW3):放在每日目标面板里。
 * 三格等宽铺满(min-w-0 flex-1 + whitespace-nowrap,英文标签 ≤ 12 字符),选了立刻生效并保存(乐观,失败退回并说明)。
 */
export function DefLangSetting() {
  const { t } = useTranslation();
  const id = useId();
  const { defLang, setDefLang, error } = useDefLangSetting();
  const [saved, setSaved] = useState(0);
  const label = t("web.wordbookDefs.setting.label");
  return (
    <div className="mt-5" data-testid="def-lang-setting">
      <p id={`${id}-label`} className="text-sub font-semibold text-ink-2">{label}</p>
      <SegmentedControl<DefLang> label={label} value={defLang} className="mt-1.5 flex w-full" optionClassName="min-w-0 flex-1 whitespace-nowrap px-2"
        onChange={(next) => void setDefLang(next).then((ok) => { if (ok) setSaved((n) => n + 1); })}
        options={DEF_LANGS.map((v) => ({ value: v, label: t(`web.wordbookDefs.setting.options.${v}`), testId: `def-lang-${v}` }))} />
      <p className="mt-1.5 text-meta leading-dialogue text-ink-2">{t("web.wordbookDefs.setting.help")}</p>
      {error ? <p role="alert" className="mt-2 rounded-badge bg-surface-2 px-3 py-2.5 text-sub text-ink">{error}</p> : null}
      <span key={saved} aria-live="polite" className="sr-only">{saved > 0 ? t("web.wordbook.goals.saved") : ""}</span>
    </div>
  );
}
```
(`id` 的 `-label` 仅作视觉标题,单选组自带 `aria-label`。)
- [ ] **Step 4: 改 `goals-sheet.tsx`** — `import { DefLangSetting } from "./def-lang-setting";` 放在 `goals-fields` import 附近;在「连续达标」说明段落 `<p className="mt-1 text-meta … streak.help …</p>` 之后、`<div className="mt-5 divide-y-[0.5px] …">`(换书 / 暂停 / 重置行)之前插入一行 `<DefLangSetting />`。别的行不动。
- [ ] **Step 5: 运行** — `cd web && yarn vitest run src/features/wordbook/def-lang-setting.test.tsx src/features/wordbook/goals-sheet.test.tsx src/features/wordbook/locales.test.ts src/architecture.test.ts`,全绿。
- [ ] **Step 6: 浏览器窗格** — `yarn web:dev`(需服务端 S 已跑,否则面板的 PATCH 会失败,正好看失败回退);375×812 与 360×740、浅色 / 深色、中文 / 英文各看一次:三格铺满不换行、点中后高亮、命中区够大。看不了的写进 Z3 结果表「未验证」。
- [ ] **Step 7: 提交** — `feat(web): definitions display setting in the goals sheet`。

---

## Lane X — 学新词页短语自动展开

### Task X1: `phrases-pref.ts` — 设备级偏好

**Files:**
- Create: `web/src/features/wordbook/phrases-pref.ts`、`web/src/features/wordbook/phrases-pref.test.ts`

**Interfaces:**
- Produces:`readPhrasesPref(): boolean | null`(`null` = 没记过 = 自动)、`writePhrasesPref(open: boolean): void`。
- Consumes:`WORDBOOK_PREFS_KEY`、`readJson`、`writeJson`(`~/lib/storage`)。

- [ ] **Step 1: 写失败测试** — `phrases-pref.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WORDBOOK_PREFS_KEY } from "~/lib/storage";
import { readPhrasesPref, writePhrasesPref } from "./phrases-pref";
import { readPrefs, writePrefs } from "./spell/prefs";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("phrases preference (device-local)", () => {
  it("is null (= auto) until the user has toggled once", () => {
    expect(readPhrasesPref()).toBeNull();
  });

  it("remembers a manual close and a manual open", () => {
    writePhrasesPref(false);
    expect(readPhrasesPref()).toBe(false);
    writePhrasesPref(true);
    expect(readPhrasesPref()).toBe(true);
  });

  it("shares the wordbook prefs key without clobbering the spelling prefs", () => {
    writePrefs({ showLength: true });
    writePhrasesPref(false);
    expect(readPrefs().showLength).toBe(true);
    expect(JSON.parse(localStorage.getItem(WORDBOOK_PREFS_KEY)!)).toEqual({ showLength: true, phrasesOpen: false });
    writePrefs({ showLength: false });
    expect(readPhrasesPref()).toBe(false);
  });

  it("treats garbage as auto", () => {
    localStorage.setItem(WORDBOOK_PREFS_KEY, "{not json");
    expect(readPhrasesPref()).toBeNull();
    localStorage.setItem(WORDBOOK_PREFS_KEY, JSON.stringify({ phrasesOpen: "no" }));
    expect(readPhrasesPref()).toBeNull();
    localStorage.setItem(WORDBOOK_PREFS_KEY, JSON.stringify([1]));
    expect(readPhrasesPref()).toBeNull();
  });

  it("never throws when storage is unavailable (private mode): reads auto, writes are dropped", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
    expect(readPhrasesPref()).toBeNull();
    expect(() => writePhrasesPref(false)).not.toThrow();
  });

  it("stores nothing but one boolean (no words)", () => {
    writePhrasesPref(false);
    expect(localStorage.getItem(WORDBOOK_PREFS_KEY)).toBe('{"phrasesOpen":false}');
  });
});
```
- [ ] **Step 2: 运行确认失败。**
- [ ] **Step 3: 实现**:

```ts
import { WORDBOOK_PREFS_KEY, readJson, writeJson } from "~/lib/storage";

/**
 * 短语区的设备级偏好(R-DW10):用户手动收起 / 展开后记在本机,学新词页下次翻开时照它办;没记过(null)= 自动展开。
 * 与拼写偏好共用 `WORDBOOK_PREFS_KEY` 的 JSON(合并写入,不覆盖别的字段;退出登录由 clearDeviceData 清除)。
 * 只存一个布尔值,不含任何词。存储不可用时读到 null、写入静默丢弃。
 */
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function readPhrasesPref(): boolean | null {
  const stored = readJson(WORDBOOK_PREFS_KEY, isObject);
  return typeof stored?.phrasesOpen === "boolean" ? stored.phrasesOpen : null;
}

export function writePhrasesPref(open: boolean): void {
  const stored = readJson(WORDBOOK_PREFS_KEY, isObject) ?? {};
  writeJson(WORDBOOK_PREFS_KEY, { ...stored, phrasesOpen: open });
}
```
- [ ] **Step 4: 运行** — `cd web && yarn vitest run src/features/wordbook/phrases-pref.test.ts src/features/wordbook/spell src/auth/device-data.test.ts`;全绿。
- [ ] **Step 5: 提交** — `feat(web): device preference for the phrases section`。

### Task X2: `<PhrasesSection>` 与 `phrasesOpen`(在 C 合并之后)

**Files:**
- Create: `web/src/features/wordbook/phrases-section.tsx`、`web/src/features/wordbook/phrases-section.test.tsx`
- Modify: `web/src/features/wordbook/word-card.tsx`、`web/src/features/wordbook/learn-page.tsx`

**Interfaces:**
- Produces:`PhrasesOpen = "auto" | boolean`、`MAX_PHRASES = 5`、`PhrasesSection({ phrases, mode })`;`WordCardView` 新 prop `phrasesOpen?: PhrasesOpen`(默认 `false`)。
- Consumes:`readPhrasesPref`、`writePhrasesPref`、`web.wordbook.word.phrases`(急切键)。

- [ ] **Step 1: 写失败测试** — `phrases-section.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import { WORDBOOK_PREFS_KEY } from "~/lib/storage";
import { renderWithProviders } from "~/test/render";
import { PhrasesSection } from "./phrases-section";
import { readPhrasesPref, writePhrasesPref } from "./phrases-pref";
import { card } from "./test-fixtures";
import { WordCardView } from "./word-card";
import type { Card } from "./wordbook-api";

const PHRASES = [{ en: "talk about", zh: "谈论" }, { en: "talk back", zh: "顶嘴" }];
const details = () => document.querySelector("details")!;
const summary = () => document.querySelector("summary")!;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
  void i18n.changeLanguage("zh-CN");
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.removeItem("enjoy-web.settings");
  void i18n.changeLanguage("en");
});

describe("PhrasesSection", () => {
  it("collapsed mode (false) looks like before: closed, first phrase previewed in the summary", () => {
    renderWithProviders(<PhrasesSection phrases={PHRASES} mode={false} />);
    expect(details()).not.toHaveAttribute("open");
    expect(summary()).toHaveTextContent("短语 · talk about 谈论");
  });

  it("auto mode opens on first appearance and drops the duplicate first-phrase preview", () => {
    renderWithProviders(<PhrasesSection phrases={PHRASES} mode="auto" />);
    expect(details()).toHaveAttribute("open");
    expect(summary()).toHaveTextContent(/^短语$/);
    expect(screen.getAllByText("talk about")).toHaveLength(1);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("auto mode stays closed after the user closed it on this device", () => {
    writePhrasesPref(false);
    renderWithProviders(<PhrasesSection phrases={PHRASES} mode="auto" />);
    expect(details()).not.toHaveAttribute("open");
    expect(summary()).toHaveTextContent("短语 · talk about 谈论");
  });

  it("auto mode opens when storage is unavailable (treated as auto)", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    renderWithProviders(<PhrasesSection phrases={PHRASES} mode="auto" />);
    expect(details()).toHaveAttribute("open");
  });

  it("a manual close in auto mode is remembered; a manual reopen too; the DOM state follows React state", async () => {
    renderWithProviders(<PhrasesSection phrases={PHRASES} mode="auto" />);
    await userEvent.click(summary());
    expect(details()).not.toHaveAttribute("open");
    expect(details().open).toBe(false);
    expect(readPhrasesPref()).toBe(false);
    expect(summary()).toHaveTextContent("短语 · talk about 谈论");
    await userEvent.click(summary());
    expect(details().open).toBe(true);
    expect(readPhrasesPref()).toBe(true);
  });

  it("a manual open on a collapsed page never writes the preference (R-DW10 c)", async () => {
    renderWithProviders(<PhrasesSection phrases={PHRASES} mode={false} />);
    await userEvent.click(summary());
    expect(details().open).toBe(true);
    await userEvent.click(summary());
    expect(details().open).toBe(false);
    expect(localStorage.getItem(WORDBOOK_PREFS_KEY)).toBeNull();
  });

  it("shows at most five phrases", () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ en: `phrase ${i}`, zh: `短语${i}` }));
    renderWithProviders(<PhrasesSection phrases={many} mode={true} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
  });

  it("keeps the disclosure semantics: a real summary inside details, 44px target, no motion under reduced-motion", () => {
    renderWithProviders(<PhrasesSection phrases={PHRASES} mode="auto" />);
    expect(summary().parentElement).toBe(details());
    expect(summary().className).toContain("min-h-tap");
    expect(summary().querySelector("svg")!.getAttribute("class")).toContain("motion-reduce:transition-none");
    expect(summary().querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders nothing for a card without phrases", () => {
    renderWithProviders(<PhrasesSection phrases={[]} mode="auto" />);
    expect(document.querySelector("details")).toBeNull();
  });
});

describe("WordCardView phrasesOpen", () => {
  const TALK = card("talk", { phrases: PHRASES }) as unknown as Card;

  it("defaults to collapsed even when the device preference says open", () => {
    writePhrasesPref(true);
    renderWithProviders(<WordCardView card={TALK} />);
    expect(details()).not.toHaveAttribute("open");
  });

  it('"auto" opens only once the card is uncovered (covered: no phrases in the DOM)', () => {
    const first = renderWithProviders(<WordCardView card={TALK} covered phrasesOpen="auto" />);
    expect(document.querySelector("details")).toBeNull();
    expect(screen.getByTestId("word-card")).not.toHaveTextContent("talk about");
    first.rerender(<WordCardView card={TALK} phrasesOpen="auto" />);
    expect(details()).toHaveAttribute("open");
  });
});
```
(`first.rerender(...)` 丢失 Provider 包装;执行时改用 `renderWithProviders` 返回对象的重渲染方式:新建一个 `Wrapper` 组件持有 `covered` 状态并用 `userEvent` 点遮罩翻开,断言翻开后 `details` 带 `open`。以真实 `renderWithProviders` 行为为准。)
- [ ] **Step 2: 运行确认失败**(模块不存在)。
- [ ] **Step 3: 实现 `phrases-section.tsx`**:

```tsx
import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { readPhrasesPref, writePhrasesPref } from "./phrases-pref";

export const MAX_PHRASES = 5;
export type PhrasesOpen = "auto" | boolean;
type Phrase = { en: string; zh: string };

/**
 * 短语区(spec 2026-10-12-wordbook-definitions D6,R-DW10)。受控 <details>:`<summary>` 的 click 里 preventDefault,自己切换状态,
 * 不依赖浏览器对 `open` 属性与 `toggle` 事件的实现差异。
 * `mode`:false / true = 固定初始状态(复习页 / 已学词页传 false:折叠);"auto" = 学新词页:这个区块只在词卡翻开后才挂载,
 * 所以挂载时刻 = 遮罩 → 翻开的那一刻;本机偏好不是 false 就展开。展开时标题行不再重复第一条短语。
 * 只有 "auto" 模式把手动开合写入本机(否则在复习页展开再收起会让学新词页从此不再自动展开)。
 */
export function PhrasesSection({ phrases, mode }: { phrases: readonly Phrase[]; mode: PhrasesOpen }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<boolean>(() => (mode === "auto" ? readPhrasesPref() !== false : mode));
  if (phrases.length === 0) return null;
  const first = phrases[0];
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (mode === "auto") writePhrasesPref(next);
  };
  return (
    <details open={open} className="group mt-3 border-t-[0.5px] border-hair-2">
      <summary onClick={(e) => { e.preventDefault(); toggle(); }}
        className="flex min-h-tap cursor-pointer list-none items-center justify-between text-sub text-ink-2 [&::-webkit-details-marker]:hidden">
        <span className="truncate">
          {t("web.wordbook.word.phrases")}
          {open ? null : <> · <span lang="en">{first.en}</span> {first.zh}</>}
        </span>
        <ChevronDownIcon aria-hidden className="h-[18px] w-[18px] flex-none text-ink-3 transition-transform duration-fast motion-reduce:transition-none group-open:rotate-180" />
      </summary>
      <ul className="space-y-1 pb-1 text-sub">
        {phrases.slice(0, MAX_PHRASES).map((p, i) => (
          <li key={i}><span lang="en" className="font-medium text-ink">{p.en}</span> <span className="text-ink-2">{p.zh}</span></li>
        ))}
      </ul>
    </details>
  );
}
```
旧 DOM 对照:收起时 `<span className="truncate">短语 · <span lang="en">talk about</span> 谈论</span>` —— 旧写法是 `{t(...)} · <span lang="en">…</span> {zh}`,新写法在 `open` 为 false 时渲染的文本节点相同(`" · "`、`" "`)。金标准快照若出现文本节点拆分差异(React 合并相邻文本的方式相同,应当一致),以快照为准调整 JSX,**不更新快照**。
- [ ] **Step 4: 改 `word-card.tsx`** — import 加 `import { MAX_PHRASES, PhrasesSection, type PhrasesOpen } from "./phrases-section";`,**删除**文件顶部的 `const MAX_PHRASES = 5;` 与不再使用的 `ChevronDownIcon` import;参数解构加 `phrasesOpen = false`,类型加 `phrasesOpen?: PhrasesOpen;`(文档注释补一句:「`phrasesOpen`:短语区初始状态,`"auto"` = 翻开后自动展开并记住手动开合(学新词页);默认折叠」)。把整块 `{card.phrases.length ? (<details …>…</details>) : null}` 换成:

```tsx
          <PhrasesSection phrases={card.phrases.slice(0, MAX_PHRASES)} mode={phrasesOpen} />
```
(`PhrasesSection` 对空数组返回 `null`,与旧条件等价。)
- [ ] **Step 5: 改 `learn-page.tsx`** — 在 C2 加过 `defLang` 的那个 `<WordCardView key={current.key} card={current} defLang={defLang} …` 上追加 `phrasesOpen="auto"`(放在 `badge` 之前的 prop 区,保持 `defLang=` 仍在第一个 `/>` 之前)。review / learned / browse / link 的调用点**不传**。
- [ ] **Step 6: 运行** — `cd web && yarn vitest run src/features/wordbook src/architecture.test.ts`:`word-card-legacy` 快照不变、`def-lang-wiring`、`recall-card`("keeps the phrases collapsed on the review back")、全部 wordbook 既有测试通过。`yarn web:typecheck`。
- [ ] **Step 7: 浏览器窗格** — 学新词页:翻开后短语自动展开、标题只剩「短语」;点标题收起 → 下一张卡翻开不展开;复习页 / 已学词页词卡折叠;深色、`prefers-reduced-motion`(DevTools 模拟)下箭头不动画;键盘 Tab 到标题行按 Enter / Space 能开合。记录结果,看不了的写「未验证」。
- [ ] **Step 8: 提交** — `feat(web): auto-open phrases once the learn card is revealed`。

---

## Final lane Z

### Task Z1: 学新词页整页集成测试

**Files:**
- Create: `web/src/features/wordbook/learn-page-defs.test.tsx`

**Interfaces:** 只读;用 `learn-page.test.tsx` 同款的 TTS 模拟与路由表(复制那几行,不导出共用,以免改动既有测试文件)。

- [ ] **Step 1: 写测试**:

```tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { resetServerAiConfigCache } from "~/api/server-config";
import i18n from "~/i18n";
import { WORDBOOK_PREFS_KEY } from "~/lib/storage";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { WordbookLearnPage } from "./learn-page";
import { CONFIG, defsCard } from "./test-fixtures";

vi.mock("~/features/chat/use-tts-player", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/features/chat/use-tts-player")>()),
  useTtsPlayer: () => ({ states: {}, play: vi.fn(), playQueue: vi.fn(), stop: vi.fn(), prime: vi.fn() }),
}));

const TTS_ROUTES = {
  "GET /api/config/gpt_providers": () => json({ enjoyai: { models: [] } }),
  "GET /api/config/default_gpt_preset": () => json({ configuration: {} }),
  "GET /api/config/tts_providers_v2": () => json({ enjoyai: { models: ["openai/tts-1"], voices: {} } }),
  "GET /api/config/default_tts_preset": () => json({ configuration: { tts: { model: "openai/tts-1", voice: "alloy" } } }),
};
const BATCH = {
  book_id: "cet4",
  cards: [
    defsCard("talk", { senses: [{ pos: "v", text: "说话；谈话" }, { pos: "n", text: "交谈" }], phrases: [{ en: "talk about", zh: "谈论" }, { en: "talk back", zh: "顶嘴" }] }),
    defsCard("accept", { senses: [{ pos: "vt", text: "接受；承认" }], phrases: [{ en: "accept it", zh: "接受它" }] }),
  ],
  quiz: [],
  drill: [],
};

function setup(config: unknown = CONFIG) {
  const mock = createFetchMock({ ...TTS_ROUTES, "GET /api/wordbook/config": () => json(config), "POST /api/wordbook/learn/batch": () => json(BATCH) });
  renderWithProviders(<WordbookLearnPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/wordbook/learn" });
  return mock;
}
const reveal = async () => userEvent.click(await screen.findByTestId("recall-cover"));
const section = () => document.querySelector("details")!;

beforeEach(() => {
  localStorage.clear();
  resetServerAiConfigCache();
  localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
  void i18n.changeLanguage("zh-CN");
});
afterEach(() => { localStorage.removeItem("enjoy-web.settings"); void i18n.changeLanguage("en"); });

describe("learn page: definitions and phrases", () => {
  it("covered card has neither definitions nor phrases in the DOM; revealing shows zh, en, example, then opened phrases", async () => {
    setup();
    await screen.findByTestId("recall-cover");
    const card = screen.getByTestId("word-card");
    for (const text of ["说话；谈话", "exchange thoughts", "They talk a lot.", "talk about"]) expect(card).not.toHaveTextContent(text);
    await reveal();
    expect(await screen.findByTestId("word-defs-en")).toBeTruthy();
    expect(screen.getByText("说话；谈话")).toBeTruthy();
    expect(section()).toHaveAttribute("open");
    expect(section().querySelector("summary")).toHaveTextContent(/^短语$/);
    expect(screen.getAllByText("talk about")).toHaveLength(1);
  });

  it("does not auto-open after the user closed the phrases on this device", async () => {
    localStorage.setItem(WORDBOOK_PREFS_KEY, JSON.stringify({ phrasesOpen: false }));
    setup();
    await reveal();
    await screen.findByTestId("word-defs-en");
    expect(section()).not.toHaveAttribute("open");
    expect(section().querySelector("summary")).toHaveTextContent("短语 · talk about 谈论");
  });

  it("remembers a manual close", async () => {
    setup();
    await reveal();
    await screen.findByTestId("word-defs-en");
    await userEvent.click(section().querySelector("summary")!);
    expect(section()).not.toHaveAttribute("open");
    expect(JSON.parse(localStorage.getItem(WORDBOOK_PREFS_KEY)!)).toEqual({ phrasesOpen: false });
  });

  it.each([
    ["zh", false, true],
    ["en", true, false],
    ["both", true, true],
  ] as const)("config def_lang=%s: English=%s Chinese=%s", async (mode, en, zh) => {
    setup({ ...CONFIG, def_lang: mode });
    await screen.findByTestId("recall-cover");
    await waitFor(() => expect(screen.getByTestId("recall-cover")).toBeTruthy());
    await reveal();
    await waitFor(() => expect(Boolean(screen.queryByTestId("word-defs-en"))).toBe(en));
    expect(Boolean(screen.queryByText("说话；谈话"))).toBe(zh);
  });

  it("an old server (no def_lang in config, no defs_en on cards) looks exactly like before", async () => {
    const OLD = { ...BATCH, cards: BATCH.cards.map(({ defs_en: _drop, ...rest }) => rest) };
    const mock = createFetchMock({ ...TTS_ROUTES, "GET /api/wordbook/config": () => json(CONFIG), "POST /api/wordbook/learn/batch": () => json(OLD) });
    renderWithProviders(<WordbookLearnPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/wordbook/learn" });
    await reveal();
    expect(await screen.findByText("说话；谈话")).toBeTruthy();
    expect(screen.queryByTestId("word-defs-en")).toBeNull();
  });
});
```
(`config` 异步到达:`def_lang: "zh"` 的用例里 `reveal` 之后 `waitFor` 等偏好应用;若偶发先按 `both` 渲染再切换,断言用 `waitFor` 已覆盖。`resetServerAiConfigCache` 与 `learn-page.test.tsx` 的用法对齐,以其为准。)
- [ ] **Step 2: 运行** — `cd web && yarn vitest run src/features/wordbook/learn-page-defs.test.tsx src/features/wordbook/learn-page.test.tsx`;全绿。
- [ ] **Step 3: 提交** — `test(web): learn page definitions and phrases integration`。

### Task Z2: 文档(诚实标注)

**Files:**
- Modify: `web/src/features/wordbook/CLAUDE.md`、`web/README.md`

- [ ] **Step 1: `features/wordbook/CLAUDE.md`** — 「What lives here」末尾追加一条:

```
- Definitions (spec `2026-10-12-wordbook-definitions-design.md`, plan `…-definitions-web.md`): `defs-en.tsx` (`DefinitionsEn`, one `lang="en"`
  row per POS), `def-lang.ts` (runtime helpers kept out of `wordbook-api.ts` on purpose: `defLangOf`, `saveDefLang`, `groupDefs`,
  `EN_POS_LABELS`), `use-def-lang.ts` (`useDefLangValue` / `useDefLangSetting`, per-`ApiClient` optimistic override), `def-lang-setting.tsx`
  (segmented control inside the goals sheet), `phrases-section.tsx` + `phrases-pref.ts` (controlled `<details>`; device preference
  `phrasesOpen` inside `WORDBOOK_PREFS_KEY`), `locales.ts` + `locales/` (lazy copy, namespace `web.wordbookDefs`).
```
「Pitfalls」末尾追加:

```
- `Card.defsEn` and `config.defLang` are optional (old servers): always read them through `groupDefs` / `defLangOf`. Never add a runtime export to
  `wordbook-api.ts` for definitions code (the main chunk imports that module); put it in `def-lang.ts`.
- Definitions belong to the "answer": `WordCardView` renders them only when uncovered; quizzes, `WordRecap`, `meaningLine` stay Chinese (D5).
  `defLang` is an explicit prop (default `both`); `def-lang-wiring.test.ts` fails if a `<WordCardView` / `<RecallCard` call omits it — put `defLang=`
  before any prop containing `/>`. `en` mode still shows the Chinese meaning for words that have no English definitions (R-DW6).
- `word-card-legacy.test.tsx` snapshots the pre-definitions DOM; never update it with `-u`. Do not add `data-testid` to old elements.
- New copy for this feature goes in `locales/` (lazy), not `i18n/` (eager, main bundle). Reuse eager keys when they exist.
- `phrasesOpen`: `"auto"` only on the learn page; only `"auto"` writes the device preference. `clearSpellPrefs()` removes the whole prefs key, `phrasesOpen` included.
- Unverified: real devices, iOS Safari, VoiceOver / TalkBack on the `<details>` and the radio group, long definitions at 360 px (only structural tests),
  dark-mode contrast of `text-ink-2` small text on real screens, the real server's `PATCH /api/wordbook/settings` (assumed shape, R-DW2).
```
同时把 Pitfalls 里「Copy is merged eagerly into the main bundle, so keep new keys few」那条末尾补一句 `(definitions copy is the exception: lazy, see locales.ts)`。
- [ ] **Step 2: `web/README.md`** — 在「背单词」段落(第 93–95 行附近各 v2 / 目标面板条目之后、「未在真机验证」条目之前)追加一条:

```
- **英英释义与短语自动展开**(计划 2026-10-12-wordbook-definitions):单词卡在中文释义下按词性显示小号英文释义(每词性最多 2 条,取自开放词典,仅供参考;缺口词没有);「每日目标」面板里可选「释义显示:中英 / 仅中文 / 仅英文」(默认中英,改动立即生效并保存到服务端;「仅英文」时没有英文释义的词仍显示中文)。英文释义与中文释义一样不在遮罩下的页面里;选择题、拼写题、快速回忆、答错回顾仍用中文。学新词页翻开释义后「短语」区自动展开并去掉标题里重复的第一条短语,手动收起后在本机记住(`enjoy-web.wordbook.prefs` 的 `phrasesOpen`,退出登录清除);复习页与已学词页保持折叠。新文案走懒加载文件,主包增量见 `docs/superpowers/plans/2026-10-12-wordbook-definitions-web.md` 结果表。**未验证**:真机(iOS Safari、安卓 Chrome)、VoiceOver / TalkBack 读短语区与分段控件、360 px 下长英文释义的折行与分段控件英文标签(只有结构性测试,jsdom 没有布局)、两平台深色下小号灰字对比度;服务端 `PATCH /api/wordbook/settings` 以服务端计划为准。
```
- [ ] **Step 3: 检查** — `cd web && yarn vitest run src/architecture.test.ts` 仍绿(文档改动不影响);`git diff --stat` 只含上述两个文件。
- [ ] **Step 4: 提交** — `docs(web): wordbook definitions notes and honesty list`。

### Task Z3: 全量检查、主包测量、结果表

**Files:**
- Modify: 本计划文件(只写「结果」表与勾选)

- [ ] **Step 1: 与服务端计划对表** — 读 S 已合并的代码(`server/app/routers/wordbook.py`、`server/app/wordbook/service.py`、重录的夹具),核对 R-DW2:`defLang` 在配置里的位置、保存端点与体、`defs_en` 形状。不一致只改 `def-lang.ts` 的 `defLangOf` / `DEF_LANG_PATH` / `saveDefLang`、`test-fixtures.ts` 与相关测试的字面量,并在本节「结果」里记一行差异。
- [ ] **Step 2: 全量** — `yarn web:typecheck && yarn web:test && yarn web:build`;`cd web && yarn vitest run src/features/wordbook/wordbook-contract.test.ts`(夹具来自 S,**不得 skip**)。
- [ ] **Step 3: 主包** — `node web/scripts/check-main-bundle.mjs --max-delta=0.2`,把 `main bundle: X kB gzip` 与 `css Y kB gzip` 记入结果表「改动后」列;差值 = 改动后 − T1 的「改动前」(**不用**脚本打印的 delta,基线过期);预算 ≤ 0.2 kB。超出 → 找主包里新增的代码(预期只有 `link-actions.tsx` 的一个动态 import),修到预算内,不放宽预算、不 `--record`。另看 `web/dist/assets` 里 `home-page`、`learn-page`、`review-page` 等块是否各自引入了 `locales`(一份 JSON 会被打进共享块,可接受,记录尺寸)。
- [ ] **Step 4: 安全 / 隐私核对** — `grep -rn "defsEn\|defLang\|phrasesOpen" web/src --include=*.ts --include=*.tsx | grep -i "console\.\|localStorage\|toast"` 无意外输出;确认 localStorage 里只有一个布尔;请求只发 `PATCH /api/wordbook/settings` 到本服务。
- [ ] **Step 5: 填结果表并勾选** — 合并并全绿后才勾本计划各任务的复选框;「验证矩阵」里没跑的项写「未验证」。
- [ ] **Step 6: 提交** — `docs(web): record definitions web plan results`。

### 结果(Z3 填写)

| 项 | 改动前(T1) | 改动后(Z3) | 差值 | 预算 |
|---|---|---|---|---|
| 主包 gzip | 待填 | 待填 | 待填 | ≤ 0.2 kB |
| 主包 CSS gzip | 待填 | 待填 | 待填 | 不限(单独报告) |
| 与服务端计划不一致处 | — | 待填(无则写「无」) | — | — |

---

## 验证矩阵

| # | 内容 | 方式 | 状态 |
|---|---|---|---|
| V1 | 老服务端(无 `defsEn`、无 `defLang`)DOM 与改动前相同 | `word-card-legacy` 快照(T1 录制)+ `word-card-defs`「an old card…」+ `learn-page-defs`「old server」 | 单元 / 组件测试 |
| V2 | 遮罩时中英释义都不在 DOM | `word-card-defs`「covered」、`learn-page-defs` 首个用例、`recall-card`「front」 | 单元 / 组件测试 |
| V3 | `zh` / `en` / `both` 三种显示,`en` 的缺口词回退中文 | `word-card-defs`、`recall-card`、`learn-page-defs` | 单元 / 组件测试 |
| V4 | 测验面不变(选择题、拼写、答错回顾) | 既有 `choice-question` / `typing-question` / `review-page` / `learn-page` 测试不改且全绿;`WordRecap` / `meaningLine` 未触碰 | 既有测试 |
| V5 | 偏好乐观保存、回滚、跨组件同步、键盘 | `use-def-lang`、`def-lang-setting`、`goals-sheet` 用例 | 单元 / 组件测试 |
| V6 | 契约:`defs_en`、`def_lang` 逐键核对 | `wordbook-contract.test.ts`(依赖 S 的夹具) | S 合并后 |
| V7 | 短语:自动展开、不重复首条、手动收起记住、复习 / 已学词不展开、存储不可用 = 自动、最多 5 条、不覆盖拼写偏好 | `phrases-pref`、`phrases-section`、`learn-page-defs`、`recall-card` | 单元 / 组件测试 |
| V8 | 每个词卡调用点都传 `defLang` | `def-lang-wiring.test.ts`(源码扫描) | 结构性测试 |
| V9 | 英文标签 360 px 不溢出 | `locales.test.ts` 标签长度 + `whitespace-nowrap` / `min-w-0 flex-1` 类;**无真实布局** | 结构性;真机 **未验证** |
| V10 | 主包增量 ≤ 0.2 kB gzip | Z3 实测前后数字 | Z3 |
| V11 | 架构测试未改未放宽 | `src/architecture.test.ts` 每个任务都跑 | 既有测试 |
| V12 | 真机 / iOS Safari / 读屏 / 深色对比度 / 长英文释义折行 | 浏览器窗格 375×812、360×740 目测;其余 | **未验证**(见 Z2 文档) |
| V13 | 服务端真实 `PATCH` 端点 | 与 S 对表(Z3 Step 1);E2E 本计划不新增(`yarn web:e2e` 要真实上游与费用) | 对表;E2E **未运行** |

## 不做

- 英英选择题 / 英英拼写 / 英文释义进入快速回忆题面(spec D5、§7)。
- 已学词列表按英文释义搜索;给英文释义加朗读键;释义按用户水平改写。
- 会话页(学新词 / 复习)里的释义显示快捷开关(设置只在目标面板,R-DW3)。
- 逐词记住短语开合;服务端同步短语偏好(只存本机)。
- 在界面里加「致谢 / 许可」页(spec D7)。
- 改 `enjoy/`、改 `architecture.test.ts`、改 `web/scripts/main-bundle-baseline.json`、新增依赖。
- 修改 `wordbook-api.ts` 里任何既有类型的必填字段或函数签名(只追加可选字段)。

## Cross-plan assumptions

以下全部来自服务端计划(`2026-10-12-wordbook-definitions-server.md`)与规格 §4;本计划**只**消费这些名字,定稿后若有出入,按 Z3 Step 1 只改 `def-lang.ts` 与夹具字面量:

- **卡片字段:** 每个返回卡片的接口(`/learn/batch.cards`、`/review/batch.cards[]`、`/learned/card`、`/free/start.items[].card`、`/cards/{book}/{key}`、拼写结果里的 `card`)都可能带 `defs_en: [{pos, text}]`(网页读作 `defsEn`);缺省 = 没有;`pos` ∈ `n|v|a|r|prep|pron|conj|art|num|aux|int`;每个词性 ≤ 2 条;`text` 非空;专有名词与缺口词没有该键(或为空数组,两种都兼容)。
- **偏好读取:** `GET /api/wordbook/config`(`enabled: true` 分支)顶层 `def_lang: "both" | "zh" | "en"`(网页读作 `config.defLang`);**每用户**的值(规格说存在每用户的背单词设置里);老服务端没有该键 → 网页按 `both`。
- **偏好写入:** `PATCH /api/wordbook/settings`,JSON 体 `{"def_lang": "both"|"zh"|"en"}`,成功 200 返回 `{"def_lang": …}`;未知值 422(逐键校验);鉴权同其它背单词接口;不需要已选词书。**这是本计划假设的形状**:规格只写「`PATCH` 同一个设置接口」,而现有 `PATCH /api/wordbook/enrollment` 是按词书的目标接口(要求有进行中的书),现有 `learn.autoplay / show_example` 是管理员全局设置,没有现成的每用户设置端点。
- **夹具:** `server/tests/fixtures/wordbook_contract.json` 重录后:`config.def_lang === "both"`;`learn_batch.cards` 至少一张带非空 `defs_en`;所有卡片的基础键集不变(`key word us uk senses phrases examples`)。
- **合并顺序:** 服务端计划先合并;本计划不依赖任何别的新计划。`web/src/features/wordbook/` 的共享文件(`wordbook-api.ts`、`learn-page.tsx`、`goals-sheet.tsx`、`word-card.tsx`)被其它进行中计划同时修改时,以本计划「共享文件的插入点」表为锚点逐处合并,不整文件覆盖。
- **主包与文案:** 假设 `web/src/i18n/index.ts` 继续对 `**/i18n/*.json` 用 eager glob;`features/wordbook/locales/` 不匹配它。若有人改了 glob,`locales.test.ts`「not part of the eagerly merged web messages」会红。
- **本机存储:** `WORDBOOK_PREFS_KEY`(`lib/storage.ts`)继续是一个 JSON 对象,拼写偏好 `writePrefs` 继续合并写入而不是整体覆盖;`auth/device-data.clearDeviceData()` 继续在登出时删除该键。
- **服务端不得在日志 / URL 里出现词与释义:** 本计划的请求只有 `PATCH` 的一个枚举值,没有词。

---

## Addendum AD-1(2026-10-12,对账结果,覆盖前文)

服务端计划(`2026-10-12-wordbook-definitions-server.md`,R-DS3 / R-DS4)已定稿,与本计划的假设有一处不同,**以服务端为准**:

- **偏好写入**:`PATCH /api/wordbook/enrollment`,JSON 体 `{"def_lang": "both"|"zh"|"en"}`(可与每日目标字段一起传;单独传时不需要有在学的书);响应在原响应(有在学的书则是 enrollment 对象,否则 `{}`)上再加 `"def_lang": <值>`。**不存在** `PATCH /api/wordbook/settings`。未知值 → 422。值没变时服务端不写、不计次。
- **偏好读取**:`GET /api/wordbook/config` 顶层 `def_lang`(网页读作 `config.defLang`),与本计划一致。
- 只改 `def-lang.ts` 里写入函数的路径 / 体 / 响应解析和对应的夹具字面量、测试;其余不变。T2 的契约断言以服务端重录后的 `wordbook_contract.json` 为准(`config.def_lang`、`def_lang_patch` 键,按服务端 P1 的实际键名)。
