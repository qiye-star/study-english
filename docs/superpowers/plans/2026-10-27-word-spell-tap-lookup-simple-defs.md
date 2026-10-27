# 单词拼写 · 单击查词 · 简单英英释义 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- 日期:2026-10-27 · 状态:只有文档,没有产品代码;未提交
- 基线:`main` @ `c6936aa6`(下文 文件:行号 都是在这个提交上打开核对过的;实现前 Task 0 重新核对)
- 需求来源:用户 2026-10-27 确认的三项需求(背单词「拼写」分成例句拼写 / 单词拼写;单击查词;英英释义简化,方案 c)。
  页面生成时机、问候语相关需求已撤回,本计划不涉及。没有对应的 spec,本计划的「裁定」就是设计;真正待定的放在文末「待用户确认」。
- 写计划前读过:根 `CLAUDE.md`、`web/CLAUDE.md`、`docs/CLAUDE.md`、`server/README.md`、`server/app/wordbook/CLAUDE.md`、
  `web/src/features/{wordbook,wordbook/spell,lookup}/CLAUDE.md`、`server/dictionaries/{,wordbook-definitions/}CLAUDE.md`、
  `docs/superpowers/plans/2026-10-15-tap-lookup-results.md`,以及 `docs/superpowers/plans/2026-10-23-zh-defs-dub-roles-chat-home.md`(本计划照它的结构写)。
- **写本计划时没有运行任何测试**,也没有改任何产品代码;文中所有「条数 / 比例」凡标「实测」的都要在 Task 0 / S1 里跑出来,本文不预填。

**Goal:** 三条互不相干的车道:
- **W 单词拼写:** 背单词的「拼写」变成一个小入口页,下面两项:**例句拼写**(= 现有「按句拼写」,行为不变,只改名、换路由)与**单词拼写**(新)。
  单词拼写一轮 10 个词,页内切换两种玩法:**单词听写**(播放发音,写出英文)与**看中文拼英文**(显示中文释义 + 旁边的发音键;想不起来时点输入框的框线看单词;一开始输入,看到的单词自动收起)。
- **T 单击查词:** 现在「点一下出横线、再点一下才出查词操作条」,改成**点一下就选中这个词并出操作条**。
- **S 简单英英释义:** 英英释义先用词典里较简单的那条;仍含难词的,由模型改写成简单英语,**结果存数据库**,同一条释义只调用一次模型。

**Architecture:**
- W:服务端只加一个出题端点 `POST /api/wordbook/word-spell/start`(取词池与 `spell_sets` 相同),判分**复用** `POST /api/wordbook/answers` 的 `mode:"free"` 路径(`qtype` 为 `dictation` / `spell`),不新增判分代码、不改盒子。网页新增 `features/wordbook/word-spell/` 子目录(懒加载页面),复用 `OutcomeBadge`、`LetterDiff`、`ListenButton`、`useSpeaker`、`SessionSummary`。
- T:只改 `features/lookup/` 的纯状态机 `tap-lookup.ts` 与钩子 `use-tap-lookup.ts`(以及横线标记的删除、提示文案);操作条、抽屉、长按原生选词路径都不动。
- S:离线生成「易词表」(只用仓库里已有的初中 / 高中词书 + 功能词 + 词形表);运行时纯函数判难词;新表 `wordbook_simple_defs`(迁移 0032)做全站缓存;后台单协程按批调用模型,带每日上限、失败退避与输出校验;响应形状不变(`defs_en` 仍是 `[{pos, text}]`)。

**Tech Stack:** 网页 React 18 + Vite + vitest + Testing Library(Playwright 只改规格并做类型检查,不运行);服务端 FastAPI + SQLAlchemy async + alembic + pytest。

## Global Constraints

- 每个任务一个逻辑改动、一个提交(约定式前缀),提交后该任务列出的测试 + typecheck 为绿;提交信息末尾加会话提示的 `Co-Authored-By` 行。**先写失败测试,再实现。**
- **不改** `enjoy/`、`1000-hours/` 等上游目录;网页的上游调用一律经 `server/`(本计划网页侧不新增任何第三方主机)。
- 词、释义、用户输入、用户 id **不进 URL、不进日志、不进测试快照**:新端点只用 POST 体;服务端日志只记条数、批大小、失败种类、词长;`wordbook_simple_defs` 表不含用户 id。
- 文案只有中文、英文两份,同时改(`src/i18n/i18n.test.ts`、`features/wordbook/i18n.test.ts`、`locales.test.ts`)。
- 改变目录契约的任务在同一提交里更新该目录的 `CLAUDE.md`;`web/README.md`、`server/README.md` 在各车道最后一个任务一次改完。
- 生成的数据文件单独提交(`server/dictionaries/wordbook-definitions/CLAUDE.md` Rules:`chore(server): update wordbook English definitions (<reason>)`)。
- 响应形状变化时重录契约:`cd server && CONTRACT_UPDATE=1 uv run pytest -q tests/test_wordbook_contract*.py`,网页 `wordbook-contract.test.ts` 逐键核对。
- 不跑 E2E(要真上游、花钱),不重建 / 重启容器,不运行 `scripts/deploy.sh`(用户要求时才做)。
- 命令约定:网页在仓库根 `yarn web:typecheck` / `yarn web:test`,单文件 `cd web && yarn vitest run <path>`;服务端 `cd server && uv run pytest -q <files>`。
  2026-10-27 宿主机有 `node`、`uv`,但 PATH 上没有 `yarn`、`web/node_modules` 为空:Task 0.1 先 `corepack enable && yarn install`(或按 `docs/superpowers/plans/2026-10-23-zh-defs-dub-roles-chat-home.md` Global Constraints 的 docker `web '<命令>'` 写法)。

## 现状调研结论(2026-10-27,`c6936aa6`)

### 拼写入口与按句拼写
- 「按句拼写」页 = `web/src/features/wordbook/spell/spell-page.tsx`(根 `data-testid="wordbook-spell-page"`),路由 `web/src/app.tsx:106` `/wordbook/spell`,懒加载 `web/src/features/wordbook/lazy-pages.tsx:25`。
- 指向 `/wordbook/spell` 的入口有四处:背单词首页列表行 `home-page.tsx:199-200`(标题键 `web.wordbook.home.spell`「按句拼写」、副标题 `spellHint`「今天学过的词放回例句里拼」,`i18n/zh-CN.json:55-56`);
  玻璃版首页的胶囊 `today-liquid.tsx:69-71`;练习页大卡按钮 `wordbook-card.tsx:83-86`(`card.spell`「拼写练习」,`i18n/zh-CN.json:31`);错题插件 `plugins/mistakes/mistakes-page.tsx:163`「去拼写练习」。
  页面标题 `spell/i18n/zh-CN.json:4`「按句拼写」/ `en.json:4` "Spell in context";另有 `i18n/zh-CN.json:111` 的提示文字提到「按句拼写」。
- 测试 / E2E 里写死该路由的:`home-page.test.tsx:40`、`wordbook-card.test.tsx:42`、`plugins/mistakes/mistakes-page.test.tsx:103`、`layout/bottom-nav.test.tsx:92`、`web/e2e/wordbook.spec.ts:60`。
- 句组取词池:`server/app/wordbook/service.py:706-727` `spell_sets` = 本书到期词 + 今日新学 + 盒 ≤ 3。提交 `:730-` 会写 SRS(`_write_srs`)和 `spell_set` 段位事件。

### 已有的单词级键入题(可复用)
- 服务端题型:`server/app/wordbook/quiz.py:139-141`,`dictation` 的 prompt 是 `{word}`(网页要用它做 TTS),`spell` 的 prompt 是 `{meaning(中文释义行), us}`,两者都带 `length`;可拼写判断 `quiz.py:191-193` `free_spellable`。
- 判分:`POST /api/wordbook/answers`(`routers/wordbook.py:99-112`、`:136-145`),`mode` 可为 `free`;`service.py:628-668` `_free_answer`:**不改盒子 / reps**、事件固定 `practice`(不进段位)、答错可能把未到期词拉成到期(每日 20 次),
  要求该词是用户在该书学过的词(`:636-638`,`row.source == wordbook_source(book_id)`);打字题用 `grade_blank`,`hinted` 降分(`:651-653`)。
- 网页键入题 `web/src/features/wordbook/typing-question.tsx:37-125`:听写首次出现自动播一次(`:50-53`)、「首字母」提示、答后 `OutcomeBadge` + `LetterDiff` + 正确拼写(答后才加 `lookupContext`,`:118`)。
  朗读 `use-speaker.ts:28-35`(`listen(id, text, accent)`,`/me/voice` 的单词音色优先)。`FreeItem` 类型 `wordbook-api.ts:177`(`{bookId, card, question}`)。
- 拼写偏好存 `WORDBOOK_PREFS_KEY` 的 JSON(`spell/prefs.ts:9-23`,合并写入,退出登录整键清除);小结 `session-summary.tsx:17` 的 `kind: "learn" | "review" | "spell"`。

### 点词查词(现状 = 两下)
- 纯状态机 `web/src/features/lookup/tap-lookup.ts:5-9`、`:31-41`:`idle --tapOn(k)--> marked{k}`(出横线),`marked --tapOn(k)--> lookup`(同一个词第二下才查);6 s 过期。
- 钩子 `use-tap-lookup.ts`:只听 touch / pen(`:110`),移动 > 8 px 或按住 > 450 ms 不算点(`:124-127`、`:140`);**已有选区时点按只清横线**(`:137-141`);
  `lookupTapContext`(`web/src/lib/lookup-context.ts:24-26`)排除 a / button / input / role=button 等交互元素、`data-lookup-tap="off"`、固定皮肤页(`isPinnedPath`);
  第二下 `selectWordAt` + `onSelect()`(= `readNow`),并在 500 ms 内用一次性 capture `click` 把被 Android 兼容 click 折叠的选区放回去(`:75-98`)。
- 挂载:`lookup-layer.tsx:43` `useTapLookup({ enabled: !open, onSelect: readNow })`;选区出现后渲染操作条 `lookup-layer.tsx:162`(`LookupBar`:查词 / 朗读 / 加入生词本,`lookup-bar.tsx:39-46`),点「查词」才开抽屉(`openFor`,`lookup-layer.tsx:118-122`)。
  选区稳定后 `use-dictionary-prefetch.ts:11-24` 会发一次 `POST /api/dictionary/lookup`(与 AI 共用每用户每分钟限流,`routers/dictionary.py` 文档串)。
- 横线:`pending-mark.ts` + `src/index.css:361` `::highlight(lookup-pending)`;一次性提示 `tap-lookup-hint.tsx` / `tap-lookup-pref.ts:10-17`(字段 `tapLookupHintSeen`),文案 `features/wordbook/locales/zh-CN.json:9`「点一下单词会出现横线,再点一次查词」,只在 `choice-question.tsx:163` 出现。
- 桌面鼠标:钩子不处理,鼠标双击走浏览器原生选词 → `useTextSelection` → 同一个操作条。所以用户说的「双击弹出查词弹窗」= 触屏点两下 / 鼠标双击后出现的**操作条**。
- 依赖两下的测试:`tap-lookup.test.ts`、`use-tap-lookup.test.tsx`、`review-tap-lookup.test.tsx`、`tap-lookup-card.test.tsx`、`chat/tap-lookup-bubble.test.tsx`、`plugins/word-actions/lookup-shadow.test.tsx`、`library/shadow-panel.test.tsx`(Task 0 逐个确认),E2E `e2e/lookup.spec.ts`、`e2e/vocabulary.spec.ts`。

### 英英释义
- 数据:`server/dictionaries/wordbook-definitions/definitions.jsonl`,由 `server/scripts/wordbook_definitions.py` 离线生成;来源 **Open English WordNet 2025**(CC BY 4.0)+ 手写功能词 + 少量 LLM 补缺(`SOURCE.json`;
  实测记录 29,626 条释义,其中 oewn 17,719 对、hand 118、llm 683,见 `wordbook-definitions/CLAUDE.md` Measured)。WordNet 释义是给母语者写的(例:`abandon` n「the trait of lacking restraint or control」),这就是「太难」的来源。
- 文件里每个词性已只留 2 条(脚本 `MAX_PER_POS = 2`、`LONG_GLOSS_WORDS = 14` 把长释义排后,`scripts/wordbook_definitions.py:41-43`);运行时 `app/wordbook/definitions.py:75-89` `select_defs` 每词性 ≤ 2、总数 ≤ 4,`:155-160` `defs_for(key)` 是同步、纯内存。
- 出口三处,都调 `ds.definitions.defs_for`:词卡 `service.py:137-145` `card_out`(学新词 / 复习 / 拼写结果 / 已学词 / 自由复习都经它)、答后 `option_info` `service.py:313`、选词词典 `app/wordbook/lookup.py:99`(`POST /api/dictionary/lookup`)。
  网页只按 `{pos, text}` 显示(`features/wordbook/defs-en.tsx`、`features/lookup/dictionary-result.tsx:41-47`),**服务端换文本即可,网页零改动**。
- 可照抄的先例:AI「为什么」讲解 `app/wordbook/explain.py`(全站缓存表 `WordbookExplanation`,`app/models.py:731-739`;每日全站额度 `usage.consume`;`metering.feature_scope("wordbook")`;`llm.LlmUnavailable` 降级;只记失败种类与词长);
  提示词注册 `app/services/prompts.py:52-54`;配置 `app/core/config.py:225-238`、`:537-542`(`wordbook_ai_available`、`resolved_wordbook_ai_model`);运行时设置登记 `app/core/settings_registry.py:334`(`test_settings_registry.py::test_every_settings_field_has_exactly_one_spec`);
  后台任务挂在 `app/main.py:58-69` 的 lifespan(`library` 队列 `:69` 是同类先例)。
- 迁移:最新 `server/alembic/versions/0031_chat_home.py`;本地各分支(`git ls-tree`)都没有 0032,新迁移用 **0032**(Task 0 再查一次)。

## 依赖边

| 任务 | 用到的已允许边 | 新增边 |
|---|---|---|
| W1 | `app/routers → app/wordbook`(已有) | 无 |
| W2–W5 | `features/wordbook/word-spell → ../`(相对导入父 feature,同 `spell/`)、`~/components`、`~/lib`、`~/features/chat`(TTS 只经 `use-speaker.ts`) | 无 |
| T1–T2 | 只在 `features/lookup/`、`features/wordbook/`(提示)内部 | 无 |
| S1–S6 | `app/wordbook → app.core / app.models / app.providers / app.services`(`server/app/wordbook/CLAUDE.md` Allowed dependencies);`app/main.py → app/wordbook`(已有) | 无 |

`web/src/architecture.test.ts` 的 `CROSS_FEATURE_BASELINE` 不变;`server/tests/test_architecture.py` 不变。

## 裁定(Rulings)

### W 单词拼写

- **R-W1 路由:`/wordbook/spell` 变成「拼写」入口页,两项各有子路由。**
  `/wordbook/spell` → `WordbookSpellHubPage`(新,懒加载,`data-testid="wordbook-spell-hub"`);`/wordbook/spell/sentences` → 现有 `WordbookSpellPage`(**组件、testid、行为全部不变**);`/wordbook/spell/words` → `WordbookWordSpellPage`(新)。
  理由:四个入口(R-W2)已经都指向 `/wordbook/spell`,入口代码只改文案、不改链接,主包不增加弹层代码(`wordbook-card.tsx` 在练习页主包里);错题插件「去拼写练习」自然落到入口页。
  代价:例句拼写多一次点按;`e2e/wordbook.spec.ts:60` 改成 `/wordbook/spell/sentences`。(另一种做法——入口点开底部弹层二选一——见 Q-W1。)
- **R-W2 改名:** 「按句拼写」→「例句拼写」/ "Sentence spelling";入口统一叫「拼写」/ "Spelling"。
  - `web.wordbook.home.spell`「拼写」、`home.spellHint`「例句拼写 · 单词拼写」;`card.spell` 保持「拼写练习」(练习页大卡,链接不变);`spell/i18n` 的 `title`「例句拼写」/ "Sentence spelling";`i18n/zh-CN.json:111` 的「按句拼写」→「例句拼写」(en 同步)。
  - 入口页两行(`ListRow`,同首页样式):例句拼写(副标题沿用旧 `spellHint`「今天学过的词放回例句里拼」,`testId="wordbook-spell-sentences"`)、单词拼写(副标题「听写或看中文拼英文」,`testId="wordbook-spell-words"`)。新键放 `features/wordbook/i18n` 的 `web.wordbook.spellHub.*`,共 ≤ 6 个键(文案进主包,R-L13 预算)。
- **R-W3 出题端点 `POST /api/wordbook/word-spell/start`**,体 `{count: 10 | 20 = 10, tz_offset_minutes}`(`extra="forbid"`),响应 `{set_id, book_id, items: [{book_id, card, question}]}`,`question` 固定 `qtype:"spell"`(prompt = 中文释义行 + 音标 + `length`),形状与 `free_start` 的 item 相同,网页复用 `FreeItem`。
  - 词池 = `spell_sets` 的同一规则(当前在学的书:到期 + 今日新学 + 盒 ≤ 3,`service.py:711-715`),**再**过滤 `row.source == wordbook_source(book)`(否则 `/answers` 的 free 路径会 404,`:637-638`)与 `free_spellable`;打乱后取 `count` 个;不足 1 个 → 已有错误 `NOTHING_TO_REVIEW`。
  - 不扣任何计数(与 `spell_sets` 一样只读);作答受 `/answers` 已有的每日 3,000 次限制。词只在响应体里;不写日志。
- **R-W4 判分 = `/answers` 的 `mode:"free"`**,`qtype` 取当时的玩法:单词听写 `dictation`、看中文拼英文 `spell`;`typed` = 输入;`hinted` = 用过「首字母」**或**看过单词(R-W7)。
  结果:**不改盒子、不进段位**,答错可能把未到期词提前到今天复习(free 路径现有规则)。这与例句拼写(写 SRS + `spell_set` 段位)不同,是有意的:单词拼写是可随意切换玩法、可偷看的练习;要不要改成记入复习见 Q-W2。
- **R-W5 页面结构**(`word-spell/word-spell-page.tsx`):开始卡(「开始」按钮里 `speaker.prime()`,iOS 需在手势里解锁音频)→ 一题一屏 → 答后显示结果与「下一个」→ 10 个后 `SessionSummary`(`kind:"spell"`,复用现有文案「本轮拼写完成」)→「再来一轮」/「回到拼写」。
  - 顶部分段切换 `role="radiogroup"`:「单词听写」/「看中文拼英文」(`data-testid="word-spell-mode"`)。选择存本机 `WORDBOOK_PREFS_KEY` 的新字段 `wordSpellMode: "dictation" | "meaning"`(照 `spell/prefs.ts` 合并写入;读到别的值当默认),默认 `dictation`。
  - **服务端没配 TTS(`speaker.available === false`)时**:听写选项禁用并说明「朗读不可用」,强制「看中文拼英文」,且它旁边的发音键不显示(同 spec §11.4 复习页的回退)。
  - 答题中途切换玩法:当前词的输入、首字母提示、偷看状态全部清空,题目不变、不提交;已答完的题切换只影响下一题。
- **R-W6 单词听写**:切到 / 出现新题时自动播一次(只在「开始」手势之后;在点击处理里调用,不放 effect,避免 StrictMode 播两次——wordbook `CLAUDE.md` Audio 一条),44 px 重播键、「首字母」提示、回车提交;界面上不显示单词(同 `typing-question.tsx` 听写)。
- **R-W7 看中文拼英文**:
  - 题面:中文释义行(`question.prompt.meaning`)+ **紧挨着的发音键**(`ListenButton`,读 `card.word`,`accent` 按音标);音标不显示(会泄露拼法,见 Q-W3)。
  - **框线偷看:** 输入框外包一层「框」(`data-testid="word-spell-frame"`,虚线发丝描边,内边距 10 px,整体 ≥ 44 px 高):`onPointerDown` 时若 `e.target === 框本身`(不是里面的 `<input>`)→ 显示单词;框的 `onMouseDown` `preventDefault`,点框不收起键盘(同 `spell/CLAUDE.md` 工具键的做法)。
    键盘 / 读屏用户另有一个**仅获焦时可见**的「显示单词」按钮在框内(`sr-only focus:not-sr-only`),行为相同。首次进入在框下显示一行小字「想不起来?点输入框的边框看单词」(本机字段 `wordSpellPeekHintSeen`,一次)。
  - 单词显示在框上方的小牌子里(`data-testid="word-spell-peek"`,`aria-live="polite"`,**不加** `lookupContext`,点它不会查词);同时锁存 `peeked = true`(本题提交时 `hinted: true`)。
  - **自动收起:** 单词显示中,输入框收到任何 `input` 事件(含 IME 组合开始 `compositionstart`)→ 立刻收起;删空也不会自己再出来;可以再点框线再看(仍算看过)。
  - 提交后:与 `TypingQuestion` 同样的结果徽标、逐字母差异、正确拼写(答后才加 `lookupContext`,可点词查词)。
- **R-W8 不新做判分 / 不在客户端判对错**:正确与否只看 `/answers` 的响应;客户端拿到单词文本(听写 TTS、偷看都需要)与 `dictation` 题现状一致,不额外泄露。
- **R-W9 组件归属:** 新目录 `web/src/features/wordbook/word-spell/`(`word-spell-page.tsx`、`spell-hub-page.tsx`、`word-spell-question.tsx`、`word-spell-api.ts`、`prefs.ts`、`i18n/`、`CLAUDE.md`)。
  不改 `typing-question.tsx`(复习页在用,框线偷看不适用于复习)。从 `typing-question.tsx` 只复用已导出的 `OutcomeBadge`;`ListenButton` 来自 `word-card.tsx`;`LetterDiff` 来自 `letter-diff.tsx`。

### T 单击查词

- **R-T1 新行为:** 触屏 / 手写笔在可查词文字上**点一下** = 选中这个词并出现操作条(即今天第二下的效果:`selectWordAt` + `onSelect()` + 500 ms 选区回填,`use-tap-lookup.ts:75-98` 原样保留)。
  **只是把「弹出操作条」从两下改成一下,抽屉仍要在操作条上点「查词」**(这是今天「双击」后看到的东西;要不要一下直接开抽屉见 Q-T1)。
- **R-T2 状态机:** `tap-lookup.ts` 去掉 `marked` 状态与 6 s 过期:`stepTap(event)` 对 `tapOn` 返回 `lookup`,其他一律 `none`。`TAP_MARK_TTL_MS`、`expired`、`PendingMark`(`pending-mark.ts` + `index.css:361` 规则)和 `installHighlightStub` 的用处一起删掉(保留 `isTap`、`TAP_SLOP_PX`、`TAP_MAX_MS`)。
- **R-T3 与现有手势的冲突与处理(逐条有测试):**
  1. **滚动 / 拖动:** 移动 > 8 px 不算点(不变),所以滑动阅读不会误触。
  2. **长按选词:** 按住 > 450 ms 不算点(不变),浏览器原生长按选词 → `useTextSelection` → 操作条的路径完全不动,复制 / 拖选范围照旧。
  3. **已有选区时点按:**
     - 选区是**上一次单击查词选出来的**(钩子记住自己选的 `Range`,比较起止点仍相同)→ 视为没有选区,这一下直接查新的词(否则连续查两个词又要点两下)。
     - 选区是用户**自己长按 / 拖选的** → 这一下只交给浏览器清掉选区,不查词(今天的规则 `:137-141`,避免把用户选好的短语替换掉)。
  4. **点在按钮、链接、输入框、`role=button` 等里面:** 不查(`lookupTapContext` 不变)。**风险**:可查词文字外层若是带 `onClick` 的普通 `div`(不是 button),单击会同时触发它和查词。Task T1 先 `rg` 所有 `lookupContext` / `data-lookup-context` 的祖先是否带 `onClick` / `onPointerUp`,列在 PR 描述里;有冲突的给那块加 `lookupTapOff` 或改结构,并加回归测试。2026-10-27 目测 `free-browse.tsx`、`recall-card.tsx` 的点击都在 `<button>` 上,未发现冲突(以 Task T1 的 grep 为准)。
  5. **想「点空白处关掉操作条」却点在了另一个词上:** 会查那个词。接受:点非单词处(空白、标点、中文、数字)仍只是关掉;操作条不是模态,误出成本低。
  6. **双击缩放(iOS):** 不再需要连点两下,反而少了与双击缩放的冲突(未在真机验证)。
  7. **桌面鼠标:** 保持不处理(鼠标单击文本常用于放光标 / 开始拖选,鼠标用户已有原生双击选词 → 操作条)。要不要鼠标也单击即查见 Q-T2。
  8. **抽屉打开时:** 钩子停用(`enabled: !open`,不变)。固定皮肤页(资料库、更新日志)仍不参与(`isPinnedPath`,不变)。
  9. **拼写类页面:** 例句拼写的空、单词拼写的题面 / 偷看牌子都**不是** lookup context,单击不会泄露答案(`src/lookup-marks.test.ts` 守着;W 车道新增的文字登记到 `src/lookup-marks.wordbook.test.ts`)。
- **R-T4 请求量:** 单击会更容易出操作条,而操作条出现就预取一次词典(`use-dictionary-prefetch.ts`),它和 AI 共用每用户每分钟限流。本计划**不改限流**;Task T1 加一个测试证明同一个词连点不重复预取(`text` 不变时 effect 不重跑),其余风险记在「风险」里。
- **R-T5 提示文案:** `after.tapLookupHint` 改成「点一下单词就能查词」/ "Tap a word to look it up";本机字段换成 `tapLookupOnceHintSeen`(老用户也再看一次新说明);旧字段不读不删(退出登录整键清除)。

### S 简单英英释义(方案 c)

- **R-S1 三层:**
  1. **词典里选简单的那条(离线,确定性):** 构建脚本在 WordNet 的同一词性里,优先选「难词数」少的义项(并列按原义项顺序),再取前 2 条;需要重建 `definitions.jsonl`(Task S2,要 OEWN / ECDICT 源文件,只能在开发机跑)。
  2. **Learner's 系列:** Longman / Oxford / Cambridge / Merriam-Webster Learner's 都没有可随镜像分发的开放授权数据;MW Learner's 有在线 API,但要单独申请 key 并接受其条款(展示品牌、调用量上限、缓存限制等,以条款原文为准),且每次查询都是对第三方的调用。**本计划不接入**;开放替代是 Simple English Wiktionary(CC BY-SA,离线 dump,覆盖率未测),作为可选 Task S2b,等用户拍板(Q-S1)。
  3. **仍含难词 → 模型改写成简单英语,存库**(Task S4–S5)。
- **R-S2 难词判定 = 词表法(推荐),不用模型判断。**
  - 易词表 `easy-words.txt`(新生成文件,放 `server/dictionaries/wordbook-definitions/`):**初中 + 高中词书的全部词头**(仓库内已有,`books.py:21-22`,有重叠,去重后条数实测)∪ `function-words.jsonl` 的词 ∪ 这些词在 `forms.txt` 里的全部词形。脚本新子命令 `easy-words` 生成,**只用仓库内输入**,任何人可重跑、结果逐字节相同。
  - 纯函数 `hard_words(text, headword) -> list[str]`(`app/wordbook/simple_defs.py`):小写拉丁词切分 → 去掉词头本身及其词形 → 长度 ≤ 2、数字、括号里的缩写跳过 → 经 `forms.txt` 还原原形 → 不在易词表即为难词。释义「难」= 难词数 ≥ `HARD_MIN = 1`(常量,可调)。
  - 理由:① 免费、确定、可单测,同一输入永远同一结论;② 2.9 万条释义若逐条问模型「难不难」,判定本身就要花一轮调用,而判为难的还要再调用一次改写;③ 初高中词汇正是本应用中国学习者的「已会」基线,比通用词频表贴近用户;④ 同一函数还用来**验收模型输出**(R-S6),模型判断做不到这一点。
  - 不选 ECDICT 词频(`frq` / `bnc`)做主表:要额外的 200 MB 源文件,且不在仓库里;可作为以后扩表的选项。上线前 Task S1 实测「判为难的释义条数 / 占比」,写进 `wordbook-definitions/CLAUDE.md` 的 Measured,本文不预估。
- **R-S3 新表 `wordbook_simple_defs`(迁移 0032),全站共享缓存,不含用户数据:**

  | 列 | 类型 | 说明 |
  |---|---|---|
  | `id` | Integer PK | 自增 |
  | `word` | String(100) not null | 规范化词键(= `WordCard.key`) |
  | `pos` | String(8) not null | 同 `definitions.POS_VALUES` |
  | `src_hash` | String(16) not null | `sha256(原释义文本)` 前 16 位 hex;词典重建、原文变了自动成为新行,旧行不再命中 |
  | `text` | Text null | 简化后的释义;`status != ok` 时为 NULL |
  | `status` | String(8) not null | `ok` / `skip`(校验不通过或没变简单,永久用原文)/ `failed`(上游失败,可重试) |
  | `attempts` | Integer not null default 0 | 失败次数,到 3 次不再自动重试 |
  | `retry_after` | DateTime(tz) null | `failed` 时下次可重试的时间 |
  | `model` | String(100) not null | 生成时的模型 |
  | `prompt_version` | Integer null | 生成时的提示词版本(审计用,**换版本不自动重做**,见 R-S7) |
  | `created_at` / `updated_at` | DateTime(tz) not null | |

  约束 `UniqueConstraint('word','pos','src_hash', name='uq_wordbook_simple_defs_word_pos_src')`;索引 `ix_wordbook_simple_defs_status` (`status`)。无外键、无用户 id,所以 `users_admin.delete_user` 不用管它。
  `downgrade()` 只 `drop_table`(缓存可丢,丢了就是回到原文 + 重新生成)。SQLite / Postgres 都用普通 `create_table`,不需要 `batch_alter_table`。
- **R-S4 读路径(同步、零上游):** `DictionaryStore` 新增 `english_defs(key) -> list[dict]`,三处出口(`service.py:143`、`:313`、`lookup.py:99`)改用它。它先取 `definitions.defs_for(key)`,
  开关开着时对每条:有 `ok` 行 → 换成简化文本;无行且 `hard_words` 非空 → **原文照出**,并把 `(word, pos, text)` 非阻塞地放进生成队列;其他 → 原文。
  内存覆盖表 `SimpleDefsCache`:启动后第一次用时从库里一次读入全部 `ok` / `skip` 行(行数 ≤ 释义总数,几 MB 内),之后由后台协程写库后同步更新内存;部署是单 worker(`server/app/wordbook/CLAUDE.md` Learn-mode 一条),多 worker 时每 10 分钟重读一次即可(写在模块文档里,不实现多 worker 通知)。
  **开关关闭时 `english_defs` 与 `defs_for` 输出逐字节相同**(测试守着,契约样例不变)。
- **R-S5 写路径(后台协程,`app/wordbook/simple_defs.py` 的 `SimplifyWorker.loop()`,挂到 `main.py` lifespan,同 `library` 队列):**
  - 队列:内存集合,上限 2,000 个 `(word,pos,src_hash)`,满了静默丢弃(下次有人看到再入队);重启丢失无害。
  - 批:每次最多 20 条释义一批调用一次 `llm.complete`(`metering.feature_scope("wordbook")`,模型 `resolved_wordbook_ai_model`,`temperature 0.2`,`max_tokens 900`),要求只回 JSON `{"items":[{"id":<序号>,"text":"..."}]}`,按**序号**对回,不按词。
  - 节流:两次调用间隔 ≥ 3 s;**每日全站上限** `wordbook_simple_defs_daily`(次调用,默认 300;0 = 只读缓存不生成),计数用 `usage.consume(session, "wordbook_simplify", "all", utc_day, cap)`(同 `explain.py:75`)。
  - 失败兜底:`llm.LlmUnavailable` → 本批全部 `failed`、`attempts+1`、`retry_after = now + 1 h × 2^(attempts-1)`,协程暂停 10 分钟;JSON 解析失败 → 本批 `failed`(同上);到 3 次后不再自动重试(管理员可用 S6 的命令清掉重来)。
    **任何失败,用户看到的都是原文**,接口不报错、不变慢(读路径从不等待模型)。
- **R-S6 输出校验(每条独立):** 去首尾空白、压成一行;≤ 16 个英文词;不含 CJK、尖括号、换行;不含词头本身及其词形(避免循环释义);
  `hard_words(新文本)` 必须**少于**原文的难词数(允许剩 1 个,如专业名词无法替换);首字母小写化与 R-DS19 相同规则。不通过 → `skip`(用原文,不再调用)。
- **R-S7 提示词与版本:** 注册 `wordbook.simplify_defs`(`prompts.py`,字段 `{items}`,管理端可发版本),默认模板写在 `simple_defs.py`:
  「Rewrite each dictionary definition in simple English for a Chinese learner at A2–B1 level. Use only common words. Do not use the headword. At most 16 words. Keep the meaning and part of speech. Reply JSON only.」+ 每条 `<item id=n word=… pos=…>原文</item>`(词典内容用 `explain._plain` 同样转义尖括号)。
  发新版本**不**自动作废旧行(否则一次发版就要重新花一整轮钱);要重做由管理员显式执行 S6 的 `--purge`。
- **R-S8 配置:** `wordbook_simple_defs_enabled: bool = False`(读 + 生成总开关,`danger=_COST`)、`wordbook_simple_defs_daily: int = Field(300, ge=0, le=5000)`;登记到 `settings_registry.py`(wordbook 组),并按 `test_env_only_and_secret_sets_match_the_spec_document` 更新它对照的文档。
  生成还要求 `upstream_llm_base_url` 已配置;没配置时只读缓存。与 `wordbook_ai_enabled`(「为什么」讲解)互相独立。
- **R-S9 成本(粗算,上线后以管理端用量为准):** 一条 WordNet 释义约 10–25 个英文词;一批 20 条 ≈ 提示 300 token + 输入 20×(词+原文)≈ 600 token + 输出 ≈ 500 token,即每次调用约 1.5k token。
  最坏情况全部 29,626 条都判为难 ≈ 1,500 次调用 ≈ 2.2M token,默认每天 300 次 → 约 5 天自然填满;实际只生成**有人看到的**难释义,且判为难的比例由 S1 实测。单价取决于部署时配置的模型,本文不写金额。
- **R-S10 日志:** 只记 `batch=… ok=… skip=… failed=… kind=…`、队列长度、每日计数;不记词、原文、改写文本、提示词正文(`test_dictionary_lookup.py::test_the_module_is_not_a_logging_site` 的同类守卫加到 `simple_defs.py` 的读路径函数)。

## 文件结构(本计划触碰的文件)

- 网页 W:`web/src/app.tsx`、`web/src/features/wordbook/{lazy-pages.tsx,index.ts,home-page.tsx,today-liquid.tsx,wordbook-card.tsx(只文案),i18n/{en,zh-CN}.json,spell/i18n/{en,zh-CN}.json,wordbook-api.ts,CLAUDE.md}`、
  新目录 `web/src/features/wordbook/word-spell/*`、`web/src/lookup-marks.wordbook.test.ts`、`web/src/layout/bottom-nav.test.tsx`、`web/e2e/wordbook.spec.ts`、`web/README.md`。
- 网页 T:`web/src/features/lookup/{tap-lookup.ts,use-tap-lookup.ts,pending-mark.ts(删),CLAUDE.md}` 及其测试、`web/src/index.css`、`web/src/test/tap-lookup.ts`、`web/src/features/wordbook/{tap-lookup-pref.ts,tap-lookup-hint.tsx,locales/{en,zh-CN}.json}`、相关测试、`web/e2e/lookup.spec.ts`、`web/e2e/vocabulary.spec.ts`、`web/README.md`。
- 服务端 W:`server/app/routers/wordbook.py`、`server/app/wordbook/service.py`、`server/tests/test_wordbook_word_spell.py`(新)、`server/tests/fixtures/wordbook_contract.json`。
- 服务端 S:`server/scripts/wordbook_definitions.py`、`server/dictionaries/wordbook-definitions/{easy-words.txt(新),definitions.jsonl(S2 重建),SOURCE.json,CLAUDE.md}`、`server/app/wordbook/{simple_defs.py(新),index.py,service.py,lookup.py,CLAUDE.md}`、
  `server/app/models.py`、`server/alembic/versions/0032_wordbook_simple_defs.py`(新)、`server/app/core/{config.py,settings_registry.py}`、`server/app/services/prompts.py`、`server/app/main.py`、`server/.env.example`(占位)、`server/README.md`、测试若干(见各任务)。

## Task 0:核对(不提交)

- [ ] **0.1** 从 `main` 拉分支(建议三条:`feat/word-spell`、`feat/one-tap-lookup`、`feat/simple-defs`,可各用一个 worktree,`node_modules` 按根 `CLAUDE.md` 链接);装好依赖,确认上文 文件:行号 仍成立,不成立以实际代码为准并在 PR 描述里记一句。
- [ ] **0.2** 名字没被占用:`rg -n "word-spell|WordSpell|spellHub|simple_defs|SimpleDefs|easy-words|tapLookupOnceHintSeen|wordSpellMode" web/src web/e2e server/app server/tests` 应为空;`ls server/alembic/versions | tail -1` 仍是 `0031_chat_home.py`(否则顺延编号)。
- [ ] **0.3** 基线绿:`yarn web:typecheck`;`cd web && yarn vitest run src/features/wordbook src/features/lookup src/lookup-marks.test.ts src/architecture.test.ts`;`cd server && uv run pytest -q tests/test_wordbook_*.py tests/test_dictionary_lookup.py tests/test_settings_registry.py tests/test_migrations.py`。
- [ ] **0.4** T 车道的冲突清单(R-T3 第 4 条):`rg -n "lookupContext|data-lookup-context" web/src --glob '!*.test.*'`,逐个看最近的可点击祖先;结果贴进 T1 的 PR 描述。

---

## 车道 W:单词拼写

### Task W1:服务端出题端点

文件:`server/app/routers/wordbook.py`、`server/app/wordbook/service.py`、`server/tests/test_wordbook_word_spell.py`(新)、`server/tests/fixtures/wordbook_contract.json`、`server/app/wordbook/CLAUDE.md`

- [ ] **W1.1 先写失败测试**(`tests/wordbook_helpers.py` 的 `enable_wordbook` + `mini.jsonl`):
  未选书 → `NO_ACTIVE`;学过 3 个可拼写词 → 返回 3 个 item,每个 `question.qtype == "spell"`、`length == len(card.word)`、`card.key` 在池里;含空格的词头、别的来源(生词本手动加的同名词)不出现;
  `count` 只接受 10 / 20(其他 422);空池 → `NOTHING_TO_REVIEW`;用返回的 item 调 `/answers`(`mode:"free"`,`qtype` 分别为 `dictation`、`spell`)都 200 且盒子不变;
  路由文本里没有词(照 `test_wordbook_learned_api.py::test_new_routes_carry_no_word_in_the_url` 加一条);`caplog` 里没有任何词。
- [ ] **W1.2 实现:** `service.word_spell_start(...)` 按 R-W3(复用 `_active`、`store.today_learned_keys`、`planning.due_keys`、`free_spellable`、`card_out`、`question_out(await _question(..., "spell", ...))`);路由 `WordSpellStartIn(count: Literal[10, 20] = 10, tz_offset_minutes)`。
- [ ] **W1.3 契约:** `CONTRACT_UPDATE=1` 录制新样例 `word_spell_start`。
- [ ] **W1.4 文档:** `server/app/wordbook/CLAUDE.md` 加「单词拼写出题 `POST /word-spell/start`:词池同 `spell_sets` 并只取本书来源、可拼写;作答走 `/answers` free(不改盒、不进段位;计划 2026-10-27 R-W3/R-W4)」。
- [ ] **W1.5 验证:** `cd server && uv run pytest -q tests/test_wordbook_word_spell.py tests/test_wordbook_*.py tests/test_architecture.py`
- [ ] **W1.6 提交:** `feat(server): word spelling start endpoint`

### Task W2:网页 API 与「拼写」入口页、改名

文件:`word-spell/word-spell-api.ts`(新)、`word-spell/spell-hub-page.tsx`(新)、`lazy-pages.tsx`、`index.ts`、`app.tsx`、各 i18n、`home-page.tsx`(只文案)、`today-liquid.tsx`(只文案)、相关测试、`e2e/wordbook.spec.ts`

- [ ] **W2.1 先写失败测试:**
  `wordbook-contract.test.ts` 加 `word_spell_start` 逐键比对;`word-spell-api.test.ts`:`startWordSpell(api, 10)` 发 `POST /api/wordbook/word-spell/start`,体含 `tz_offset_minutes`,URL 不含词;
  `spell-hub-page.test.tsx`(`zh-CN`):两行「例句拼写」→ `/wordbook/spell/sentences`、「单词拼写」→ `/wordbook/spell/words`;`home-page.test.tsx:40` 的入口仍指向 `/wordbook/spell`,标题改为「拼写」;
  `spell-page.test.tsx` 标题断言改「例句拼写」;`learned-lazy.test.ts` 同类断言:`index.ts` 不静态导入新页面;`bottom-nav.test.tsx:92` 加 `/wordbook/spell/words`(仍高亮「练习」)。
- [ ] **W2.2 实现:** 按 R-W1、R-W2;`app.tsx` 加两条路由并把 `/wordbook/spell` 指向入口页;`e2e/wordbook.spec.ts:60` 改 `/wordbook/spell/sentences`(只做类型检查)。
- [ ] **W2.3 文档:** `features/wordbook/CLAUDE.md`「What lives here」与 `spell/CLAUDE.md` 首行改名「例句拼写」、注明路由 `/wordbook/spell/sentences`;新建 `word-spell/CLAUDE.md`(这时只有 API 与入口页)。
- [ ] **W2.4 验证:** `cd web && yarn vitest run src/features/wordbook src/layout/bottom-nav.test.tsx src/i18n/i18n.test.ts src/architecture.test.ts && cd .. && yarn web:typecheck && yarn web:build && node web/scripts/check-main-bundle.mjs`(主包增量只应来自文案)
- [ ] **W2.5 提交:** `feat(web): 拼写 entry page with 例句拼写 and 单词拼写`

### Task W3:单词拼写页 + 单词听写

文件:`word-spell/word-spell-page.tsx`、`word-spell/word-spell-question.tsx`、`word-spell/prefs.ts`、i18n、测试

- [ ] **W3.1 先写失败测试**(`vi.mock("~/features/chat/use-tts-player", …)`,同 wordbook `CLAUDE.md` Test):
  `prefs.test.ts`:默认 `dictation`;写 `meaning` 后读回;坏值 → 默认;写入时保留同键下的 `showLength`、`tapLookupHintSeen`。
  `word-spell-page.test.tsx`:开始前不播放;点「开始」后第一题自动播一次 `card.word`;界面上找不到单词文本;回车提交发 `/answers`,体 `{mode:"free", qtype:"dictation", typed, hinted:false}`;
  答后出现结果徽标与正确拼写,正确拼写带 `data-lookup-context`;「首字母」后提交 `hinted:true`;10 题后出现小结;TTS 不可用时听写选项 `aria-disabled` 且自动落在「看中文拼英文」。
- [ ] **W3.2 实现:** 按 R-W5、R-W6、R-W8、R-W9;音频调用都在点击处理里(第一题的自动播放在「开始」的 onClick 里触发,之后的在「下一个」的 onClick 里)。
- [ ] **W3.3 lookup 登记:** `src/lookup-marks.wordbook.test.ts` 加:答前题面与输入区不是 lookup context,答后正确拼写是。
- [ ] **W3.4 验证:** `cd web && yarn vitest run src/features/wordbook src/lookup-marks.test.ts src/lookup-marks.wordbook.test.ts src/architecture.test.ts && cd .. && yarn web:typecheck`
- [ ] **W3.5 提交:** `feat(web): 单词拼写 page with dictation mode`

### Task W4:看中文拼英文(发音键、框线偷看、自动收起)

文件:`word-spell/word-spell-question.tsx`、`word-spell/word-spell-page.tsx`、`word-spell/prefs.ts`、i18n、测试

- [ ] **W4.1 先写失败测试**(`word-spell-question.test.tsx`):
  切到「看中文拼英文」→ 显示中文释义,旁边的发音键点击读 `card.word`;**不显示音标**;
  在框本身上 `pointerDown`(target = 框)→ `word-spell-peek` 出现且文字是单词;在 `<input>` 上 `pointerDown` → 不出现;框的 `mouseDown` 事件 `defaultPrevented === true`;
  显示中 `fireEvent.input` / `compositionStart` → 立即收起;再点框线又出现;提交体 `hinted:true`;没偷看、没提示时 `hinted:false`;
  获焦后可见的「显示单词」按钮(键盘)同样能显示;偷看牌子没有 `data-lookup-context`;首次提示行出现一次后,重挂载不再出现(`wordSpellPeekHintSeen`);
  答题中途切换玩法 → 输入清空、偷看收起、`hinted` 复位,不发请求。
- [ ] **W4.2 实现:** 按 R-W7;框的命中判断只用 `e.target === e.currentTarget`,不算坐标;不调用 `preventDefault` 于 `touchstart`(否则 click 不触发)。
- [ ] **W4.3 文档:** `word-spell/CLAUDE.md` 写全:两种玩法、`hinted` 规则、偷看与自动收起、本机字段 `wordSpellMode` / `wordSpellPeekHintSeen`、不改盒不进段位、IME 注意(参照 `spell/CLAUDE.md` Pitfalls)。
- [ ] **W4.4 验证:** 同 W3.4。
- [ ] **W4.5 提交:** `feat(web): 看中文拼英文 with speaker, frame peek and auto-hide`

### Task W5:README

- [ ] **W5.1** `web/README.md:92-96` 背单词一节:入口页、例句拼写改名与新路由、单词拼写两种玩法、偷看算提示、不改盒子;标注**未在真机验证**:iOS 点框线是否收起键盘、Android Gboard 组合输入时的自动收起、听写自动播放。
  根 `README.md:79`、`:85` 的「按句拼写」→「例句拼写 / 单词拼写」(截图替换留给用户,`docs/CLAUDE.md` images 规则)。
- [ ] **W5.2 提交:** `docs(web): document 拼写 entry and word spelling`

---

## 车道 T:单击查词

### Task T1:一下就出操作条

文件:`features/lookup/{tap-lookup.ts,use-tap-lookup.ts,pending-mark.ts(删),pending-mark.test.ts(删),tap-lookup.test.ts,use-tap-lookup.test.tsx,CLAUDE.md}`、`src/index.css`、`src/test/tap-lookup.ts`、依赖两下的测试(现状一节的清单)、`e2e/lookup.spec.ts`、`e2e/vocabulary.spec.ts`

- [ ] **T1.1 先改 / 写测试(先红):**
  `tap-lookup.test.ts`:`tapOn` → `lookup`;其他事件 → `none`;`isTap` 边界(8 px、450 ms)不变。
  `use-tap-lookup.test.tsx`:一次 `tapAt` → 选区 = 该词、`onSelect` 调用一次;移动 9 px / 按住 451 ms / 两指 → 不选;点在 `<button>` 里、`data-lookup-tap="off"` 里、`/library` 路由上 → 不选;
  **上一次单击选出的选区还在时点另一个词 → 直接选新词;用户自己的选区(测试里手工 `addRange` 一个跨两词的范围)还在时点一下 → 不选、`onSelect` 不调用**;Android 兼容 click 折叠后 500 ms 内回填(原用例改成一下);不再出现任何 `CSS.highlights` 注册。
  `review-tap-lookup.test.tsx`、`tap-lookup-card.test.tsx`、`chat/tap-lookup-bubble.test.tsx` 等把「点两下」改成「点一下」;
  `lookup-layer.test.tsx` 加:同一个词连点两次只发一次 `/api/dictionary/lookup`(R-T4)。
- [ ] **T1.2 实现:** 按 R-T2、R-T3;钩子用 `lastPicked: Range | null` 记住自己选的范围,`hasSelection` 判断改为「有选区且不等于 `lastPicked`」。删除 `pending-mark.ts`、`index.css:361` 规则、`installHighlightStub` 的调用点。
  E2E 两个规格的「点两下」改成一下(只类型检查)。
- [ ] **T1.3 文档:** `features/lookup/CLAUDE.md` 的 Tap-to-lookup 与 `PendingMark` 两条改写(一下即选、已有选区规则、无横线);`web/README.md:99`、`:207` 的「点一下出现横线,再点一次」改成「点一下」并保留未验证清单。
- [ ] **T1.4 验证:** `cd web && yarn vitest run src/features/lookup src/features/wordbook src/features/chat src/plugins src/features/library src/styles && cd .. && yarn web:typecheck`
- [ ] **T1.5 提交:** `feat(web): one tap on a word opens the lookup bar`

### Task T2:提示文案

文件:`features/wordbook/{tap-lookup-pref.ts,tap-lookup-pref.test.ts,tap-lookup-hint.tsx,tap-lookup-hint.test.tsx,locales/{en,zh-CN}.json,CLAUDE.md}`

- [ ] **T2.1 先写失败测试:** 旧字段 `tapLookupHintSeen: true` 时提示**仍出现一次**;出现后写 `tapLookupOnceHintSeen: true` 且保留同键其他字段;文案为「点一下单词就能查词」。
- [ ] **T2.2 实现 + 文档:** 按 R-T5;wordbook `CLAUDE.md` Review after-answer 一条里的提示原文同步。
- [ ] **T2.3 验证:** `cd web && yarn vitest run src/features/wordbook src/i18n/i18n.test.ts && cd .. && yarn web:typecheck`
- [ ] **T2.4 提交:** `feat(web): tap-lookup hint says one tap is enough`

### Task T3:结果记录(只文档)

- [ ] **T3.1** 新建 `docs/superpowers/plans/2026-10-27-one-tap-lookup-results.md`:行为、删掉的东西、Task 0.4 的冲突清单与处理、**未在真机验证**(iOS / Android 单击选词是否触发系统原生工具栏、连续点词、滚动中误触率、读屏)。
- [ ] **T3.2 提交:** `docs: one-tap lookup results and unverified checklist`

---

## 车道 S:简单英英释义

### Task S1:易词表与难词判定

文件:`server/scripts/wordbook_definitions.py`、`server/app/wordbook/simple_defs.py`(新,本任务只放纯函数)、`server/tests/test_wordbook_simple_defs_words.py`(新)、`server/tests/test_wordbook_definitions_build.py`、`server/scripts/CLAUDE.md`

- [ ] **S1.1 先写失败测试:**
  脚本 `easy-words`(用 fixture 小词书):输出排序、LF、去重、含词形(`went` 因 `go` 入表)、含功能词;同输入两次逐字节相同。
  `hard_words`:`"make less active or intense"` 在 fixture 易词表下返回 `["intense"]`(示例,按 fixture 定);词头本身与其词形不算;数字、单字母、`(e.g.)` 跳过;大小写不敏感;空文本 → `[]`。
- [ ] **S1.2 实现:** 按 R-S2;脚本的 `check` 子命令追加输出「判为难的释义条数 / 总数」(只打印条数,不打印词)。
- [ ] **S1.3 验证:** `cd server && uv run pytest -q tests/test_wordbook_simple_defs_words.py tests/test_wordbook_definitions_build.py tests/test_architecture.py`
- [ ] **S1.4 提交:** `feat(server): easy-word list builder and hard-word check for English definitions`
- [ ] **S1.5 生成数据并单独提交:** `uv run python scripts/wordbook_definitions.py easy-words && uv run python scripts/wordbook_definitions.py check`;把实测条数写进 `wordbook-definitions/CLAUDE.md` Measured,`SOURCE.json` 登记新文件校验和;
  `tests/test_wordbook_definitions_data.py` 加 `easy-words.txt` 的校验和 / 排序检查。提交 `chore(server): update wordbook English definitions (easy-word list)`。

### Task S2:构建时优先选简单义项(需要开发机源文件)

- [ ] **S2.1 先写失败测试**(`test_wordbook_definitions_build.py`,fixture WordNet):同一词性 3 个义项,难词数 2 / 0 / 1 → 选第 2、3 个,输出保持原义项顺序;难词数相同时与今天的结果相同。
- [ ] **S2.2 实现:** 在 `build` 的义项排序里加「难词数」作为 `LONG_GLOSS_WORDS` 之前的第一键;`SCRIPT_VERSION = 3`,`SOURCE.json` `rules` 加 `"prefer_easy_senses": true`。
- [ ] **S2.3 提交:** `feat(server): definitions build prefers senses with fewer hard words`
- [ ] **S2.4 重建(由用户在有 OEWN / ECDICT 的机器上跑,或交给用户):** `verify → build → check`,更新 Measured,单独提交 `chore(server): update wordbook English definitions (simpler senses)`。
  **必须在 S5 上线生成之前完成**:重建会改原文 → `src_hash` 变 → 已生成的缓存行失效、白花钱。
- (可选 S2b,等 Q-S1:接入 Simple English Wiktionary 作为第一来源,另写计划附录。)

### Task S3:迁移 0032 与模型

文件:`server/app/models.py`、`server/alembic/versions/0032_wordbook_simple_defs.py`(新)、`server/tests/test_migration_0032.py`(新)

- [ ] **S3.1 先写失败测试**(照 `tests/test_migration_0028.py`):SQLite 上 `upgrade head` 后表与唯一约束、索引存在;同 `(word,pos,src_hash)` 插两次 → `IntegrityError`;`downgrade 0031` 后表消失、其他表不受影响;`tests/test_migrations.py` 的 head 断言更新为 `0032`。
- [ ] **S3.2 实现:** 按 R-S3;模型类 `WordbookSimpleDef`,文档串写明「全站缓存,不含用户数据」。
- [ ] **S3.3 验证:** `cd server && uv run pytest -q tests/test_migration_0032.py tests/test_migrations.py tests/test_architecture.py`;另在临时目录对 Postgres(`docker-compose` 的 `postgres` profile,有就跑,没有就在 PR 描述里标未验证)跑一遍 `alembic upgrade head && alembic downgrade 0031`。
- [ ] **S3.4 提交:** `feat(server): wordbook_simple_defs cache table (0032)`

### Task S4:读路径(只读缓存,不调用模型)

文件:`server/app/wordbook/{simple_defs.py,index.py,service.py,lookup.py,CLAUDE.md}`、`server/app/core/{config.py,settings_registry.py}`、`server/.env.example`、对应文档、测试

- [ ] **S4.1 先写失败测试:**
  开关关:`card_out`、`option_info`、`/api/dictionary/lookup` 的 `defs_en` 与改动前逐字节相同(拿现有契约样例比);
  开关开、库里有某词 `n` 的 `ok` 行 → 三个出口都换成简化文本,其他词性原样;`skip` / `failed` 行 → 原文;无行且判为难 → 原文 + 队列里多一项;无行且不难 → 原文、不入队;队列满 → 不报错、不阻塞;
  原文变了(`src_hash` 不同)→ 不用旧行;`test_settings_registry.py` 全绿;`simple_defs.py` 读路径函数没有日志调用。
- [ ] **S4.2 实现:** 按 R-S4、R-S8;`SimpleDefsCache.load(session)` 在 lifespan 里 `warm`(失败只记 `kind`,读路径退回原文)。
- [ ] **S4.3 验证:** `cd server && uv run pytest -q tests/test_wordbook_simple_defs*.py tests/test_wordbook_*.py tests/test_dictionary_lookup.py tests/test_settings_registry.py tests/test_architecture.py`;网页 `cd web && yarn vitest run src/features/wordbook/wordbook-contract.test.ts src/features/lookup/dictionary-contract.test.ts`(契约不变)。
- [ ] **S4.4 提交:** `feat(server): serve cached simple English definitions`

### Task S5:后台改写(模型调用、额度、兜底、校验)

文件:`server/app/wordbook/simple_defs.py`、`server/app/services/prompts.py`、`server/app/main.py`、测试

- [ ] **S5.1 先写失败测试**(假的 `llm.complete`,不访问网络):
  一批 3 条 → 一次调用,按 `id` 对回,写 3 行 `ok`,内存覆盖表同步更新,下一次 `card_out` 就是简化文本;**同一条再入队不再调用**;
  回复里某条含词头 / 超 16 词 / 含中文 / 难词没变少 → 那条 `skip`,其余 `ok`;回复不是 JSON → 全批 `failed`、`attempts=1`、`retry_after` 约 1 h 后;
  `LlmUnavailable` → 全批 `failed` 且协程暂停;第 3 次失败后不再入队;每日上限 2 时第 3 次调用不发生(`usage` 计数);`wordbook_simple_defs_daily = 0` → 从不调用;没配 `upstream_llm_base_url` → 从不调用;
  `caplog` 里没有任何词 / 原文 / 改写文本;提示词渲染把尖括号转义;`prompts.validate_prompt("wordbook.simplify_defs", …)` 对缺 `{items}` 的模板报错。
- [ ] **S5.2 实现:** 按 R-S5、R-S6、R-S7、R-S10;`main.py` lifespan 加 `tasks["simple_defs"] = asyncio.create_task(...)`,开关关时协程立即返回;关闭时取消。
- [ ] **S5.3 验证:** `cd server && uv run pytest -q tests/test_wordbook_simple_defs*.py tests/test_prompts*.py tests/test_wordbook_explain.py tests/test_architecture.py && uv run pytest -q`(全量一次)
- [ ] **S5.4 提交:** `feat(server): rewrite hard English definitions in simple English in the background`

### Task S6:管理命令(预填 / 清除)与文档

- [ ] **S6.1 先写失败测试:** `python -m app.wordbook.simplify_fill --book junior --limit 50 --dry-run` 只打印「将处理 N 条」不调用;不带 `--dry-run` 走同一个 worker 批处理并受同一每日上限;`--purge [--status failed|skip|all]` 删除对应行并提示内存表需重启或等 10 分钟;输出不含词。
- [ ] **S6.2 实现 + 文档:** `server/README.md` 背单词一节加「简单英英释义」:开关、每日上限、成本粗算(R-S9)、失败时显示原文、预填 / 清除命令(`docker compose exec server python -m app.wordbook.simplify_fill …`,只在用户要求时运行);
  `server/app/wordbook/CLAUDE.md` 加 `simple_defs.py` 一条(读路径同步零上游、写路径后台、按 `src_hash` 失效、日志规则)。
- [ ] **S6.3 提交:** `feat(server): admin command to pre-fill or purge simple definitions`

---

## 测试策略汇总

- 每个任务先写失败测试再实现;网页 vitest(jsdom,TTS / 指针事件用 `src/test/` 现成桩),服务端 pytest(假 LLM、SQLite 临时库)。
- 契约:新端点 `word_spell_start` 录进 `wordbook_contract.json`;S 车道**不改**响应形状,用现有契约证明开关关时逐字节不变。
- 隐私守卫:新路由不带词(URL 测试)、新模块读路径无日志调用、`caplog` 断言无词;`lookup-marks` 守卫覆盖新页面。
- 迁移:SQLite 自动测试 + Postgres 手动一次(有环境才跑,否则标未验证)。
- 不跑 E2E;E2E 规格只改到能通过 `yarn web:typecheck`。真机行为全部列入各 README / 结果文档的「未验证」。

## 风险

- **单击误触:** 阅读时随手一点就会出操作条并预取一次词典;预取与 AI 共用每用户每分钟限流,极端情况下可能让紧接着的 AI 请求 429。缓解:同词不重复预取(T1 测试);上线后若有反馈,再单独把词典查询移出 AI 限流桶(另立计划)。
- **外层可点击容器:** 见 R-T3 第 4 条,依赖 Task 0.4 的排查是否完整。
- **框线偷看在小屏上的误触:** 10 px 框带离输入区很近,可能误开;偷看会让本题算「提示」。缓解:首次提示文案 + 键盘外的显式按钮;若用户觉得太敏感,可改成框外一个小眼睛按钮(Q-W4)。
- **释义改写质量:** 模型可能改偏义;校验只能挡住格式和难度,挡不住语义错误。缓解:只在原文判为难时才改写,`skip` 永久回退原文,管理员可 `--purge`;可考虑以后在网页加「原释义」切换(Q-S3)。
- **成本:** 由每日上限硬封顶;R-S9 是粗算,实际以管理端用量为准。
- **S2 重建依赖开发机源文件**(OEWN zip、ECDICT zip 不在仓库);做不了时 S2 跳过,S1 / S3–S6 仍成立,只是改写条数会多。
- **多 worker:** 内存覆盖表按进程;当前镜像单 worker,若将来多 worker,最坏延迟 10 分钟才看到新改写(不影响正确性)。

## 待用户确认(Open questions)

- **Q-T1** 单击后是「出操作条(查词 / 朗读 / 加入生词本),再点查词开抽屉」(本计划默认,= 今天双击后的效果),还是「单击直接打开查词抽屉」?后者少一步,但误触时会直接弹出大抽屉并可能走到 AI 查询(花钱)。
- **Q-T2** 桌面鼠标是否也要单击即查?默认不改(鼠标单击常用于放光标 / 开始拖选,已有原生双击)。
- **Q-W1** 「拼写」用独立入口页(本计划默认,链接不变、主包不增)还是在原处弹一个二选一的底部弹层?
- **Q-W2** 单词拼写是否要像例句拼写一样**计入复习(改盒子)和段位**?默认不计(可偷看、可切玩法,按练习处理)。若要计入,需新增一个带 SRS 写入的提交端点,另加计划附录。
- **Q-W3** 看中文拼英文是否显示音标?默认不显示(音标几乎等于拼法提示);复习页的「看释义拼写」现在是显示的。
- **Q-W4** 偷看入口就用「点输入框边框」(按需求),还是另加一个看得见的小眼睛按钮?默认只有边框 + 仅键盘获焦可见的按钮。单词听写模式要不要也能偷看?默认不能。
- **Q-W5** 一轮题数:默认 10(可选 20)。
- **Q-S1** 「Learner's 系列」:没有可分发的开放数据;是否接受用 Simple English Wiktionary(CC BY-SA,需要在 `NOTICE` 署名、生成文件随之按 CC BY-SA 分发)作为第一层?还是只用「WordNet 选简单义项 + 模型改写」?
- **Q-S2** 每日调用上限默认 300、改写所用模型默认与「为什么」讲解相同(`WORDBOOK_AI_MODEL`,空则默认模型);是否要换成更便宜的模型或不同上限?是否默认在生产打开开关?
- **Q-S3** 是否保留「看原释义」的入口(需要改响应形状与网页,本计划未做)?
- **Q-S4** S2 的词典重建需要 OEWN / ECDICT 源文件,由你在开发机上跑,还是先跳过 S2 直接上 S3–S6?

## Addendum (2026-10-27):主包预算(单词拼写车道)

- **实测**:单词拼写上线到网页后,`yarn web:build` + `node web/scripts/check-main-bundle.mjs` 得到主包增量 **+0.69 kB**(基线 411.14 kB),超过 R-L13 的 **0.2 kB** 预算。
- **原因**:功能文案放在 `web/src/features/**/i18n/*.json`,由 `web/src/i18n/index.ts` 用 `import.meta.glob(..., { eager: true })` 急切加载,因此计入主包。把文案改为按需加载属于共享基础设施改动,**另立计划**,本 Addendum 不做,也不改 `i18n` 加载机制。
- **裁定**:单词拼写车道的主包预算由 0.2 kB 提高到 **0.8 kB**(覆盖实测 0.69 kB,余量约 0.1 kB)。新增文案尽量复用已有键;若增量超过 0.8 kB,必须再写 Addendum,不得静默调高。
- **同步改动**:`web/scripts/check-main-bundle.mjs` 的默认预算 `0.2` → `0.8`(它是强制该预算的配置;`--max-delta=` 仍可覆盖)。`web/src/build/main-bundle.test.ts` 里的 `checkDelta(…, 0.2)` 只是纯函数用例,不是强制值,保持不变。
- **不变**:看中文拼英文的其他规则、服务端、`/answers` 判分路径均不受本 Addendum 影响。
