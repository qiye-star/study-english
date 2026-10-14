# 复习页答题后界面(option_info · 双击查词 · 学习内容区)Implementation Plan(计划 A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 复习选择题答题后:(1) 英→中题(`meaning`)的每个选项换成它对应的英文单词(对比辨析),中文默认藏起来,点「中」才看;中→英题(`word`)的每个选项显示英文单词 + 小字中文与词性;(2) 题目下方新增「学习内容」区:`meaning` = 英英释义 + 短语 + 朗读,`word` = 正确单词的卡片;(3) 双击(或 300 ms 内连点两次)某个选项 → 程序化选中它的单词 → 复用现有选词操作条(查词 · 朗读 · 加入生词本);(4) 第一次答题后在题下出一次性提示「双击选项可查词」。`cloze` 题、拼写页、学新词页、快速回忆抽查题不变。

**Architecture:** 服务端:`/api/wordbook/answers` 对 `meaning` / `word` 选择题的响应追加三个**可选**键 `option_info`、`phrases`、`example`。`/answers` 是无状态判分(请求里没有选项,干扰项是出题时按 rng 抽的,答题时无法重算),所以**出题时**把「选项原文 → 词键」记进挂在 `DictionaryStore` 上的进程内有界 LRU(`app/wordbook/option_memo.py`),答题后据此回填;取不到就整个省略 `option_info`(降级为旧形状)。网页:`ChoiceQuestion` 增加**可选** `after` 属性,只有复习页在答题后传它;传了就把 `meaning` / `word` 的选项换成非禁用的普通容器(`touch-action: manipulation`、`select-text`、`role="button"`),单词放在 `data-lookup-context` 的 span 里,双击时用新的 `~/lib/select-word`(与 `features/library/word-tap.ts::selectWord` 同一契约)程序化选中它,全局 `LookupLayer` 在选区稳定 300 ms 后自己弹出操作条。「学习内容」区是新组件 `after-answer-panel.tsx`;释义行的取舍全部走现有纯函数 `defView()`。

**Tech Stack:** FastAPI + pytest(服务端,标准库);React 18 + vitest + @testing-library(网页)。不新增依赖、不新增迁移、不改 `enjoy/`、不改 `features/library`、不改 `features/lookup`。

**Spec:** `docs/superpowers/specs/2026-10-13-review-after-answer-and-library-alignment-design.md` §1(D1–D4)、§2、§3。并行计划:B `2026-10-13-library-alignment.md`(`features/library` + `app/library` + `speech`),文件所有权与本计划不重叠。真机清单:`2026-10-13-review-after-answer-device-checklist.md`(**全部 UNVERIFIED**)。

## Global Constraints

- **验证口径(如实):** 写这份计划时**没有运行任何测试、构建或服务**,只读了真实代码;下面所有代码与测试都是「读代码推断 + 手工推演」,**第一次运行时以真实结果为准修正**(尤其:jsdom 对 `Selection.selectAllChildren` 的行为、user-event 14 的 `detail` 点击计数、`fetchMock` 对未登记路由的 404、契约夹具里选项顺序与 `defs_en` 形状)。**iOS Safari 真机**上「双击是否稳定触发程序化选中与操作条」「`touch-action: manipulation` 是否真的消除双击缩放」「`role="button"` 的 div 里文字能否被 `selectAllChildren` 选中」「操作条是否盖住底部 dock」「VoiceOver 激活」一律**未验证**,见真机清单。真实上游与真实词书数据(干扰项词面、英文释义是否齐全)没有跑过。
- **隐私:** 单词、选项文字、`choice` 不进 URL、日志、错误体。`option_memo.py` 里**没有 logging 调用**(测试守着);`/answers` 请求体没有新字段(**不新增请求字段**);`option_info` 只在判分之后返回,题面不泄露。
- **分层:** `tests/test_architecture.py`、`web/src/architecture.test.ts` 不放宽。`features/wordbook` 不导入 `features/library`(也不导入 `features/lookup` 的内部文件);选中函数放 `web/src/lib/`。
- **不改 `enjoy/`;** 不向第三方发请求。
- **所有权:** 只改 `server/app/wordbook/**`、`server/tests/**`(含 `fixtures/wordbook_contract.json`)、`web/src/features/wordbook/**`、`web/src/lib/select-word*`、`web/src/lib/CLAUDE.md`、`web/README.md`。**不碰** `web/src/features/library/**`(计划 B 独占)、`server/app/library/**`、`server/app/speech/**`、`web/src/features/lookup/**`。
- **工作树是 CRLF:** 改现有文件用 Edit 工具,新文件用 Write。本计划里所有 Edit 锚点都是**单行**文本(多行锚点在 CRLF 文件里可能不匹配);如某个锚点不匹配,先 Read 看原文再改。
- **提交:** conventional,一任务一提交,每个提交后该任务列出的测试全绿,信息以 `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` 结尾。**只在用户要求时:** 重建容器、跑全量测试、跑 E2E(会花钱)。每个任务只跑它列出的测试加架构测试。
- **文案:** 新增的 UI 文案放**懒加载**的 `web/src/features/wordbook/locales/{en,zh-CN}.json`(键前缀 `web.wordbookDefs.after.*`,不进主包的急切 i18n 合并);用到它的组件模块 `import "./locales"`。
- **顺序:** S1 → S2 → S3(服务端,契约夹具在 S3 重录)→ W1 → W2 → W3 → W4 → W5 → W6 → W7 → W8。W1 的契约测试读 S3 录制的夹具,所以 S3 必须先合。

## 对 spec「核对」项的裁定(读真实代码得出)

| spec 核对项 | 结论 |
|---|---|
| `quiz.py` 取干扰项的方式(§2.2) | `candidate_keys(index, key, rng)` 用 `question_rng(user_id, key, reps)` 派生的 `random.Random` 从同一本书里随机抽最多 24 个键,`pick_distractors` 再筛;`build_question` 最后 `rng.shuffle(options)`。`meaning` 题的选项是 `meaning_line(card)`(前两条释义,≤ 24 字),`word` / `cloze` 题是 `card.word`。**答题时无法重算**:`/answers` 只收 `(book_id, key, mode, qtype, choice, …)`;学新词 / 复习 / 自由复习取 rng 的 `reps`、是否先消耗一次 `pick_qtype` 都不同,自由复习用系统熵 `random.Random()`。结论 = R-A1(出题时记备忘)。 |
| `meaning` 题的选项 → 词怎么反查 | 释义行不能反查(没有按释义行的索引,建一个要读完整本书的词卡)。备忘里存 `(选项原文, 词键)` 对。 |
| 契约夹具与网页契约测试(§2.2) | `server/tests/test_wordbook_contract.py` 对真实应用录制 `server/tests/fixtures/wordbook_contract.json`(`CONTRACT_UPDATE=1`),`shape()` 只比键和第一个元素的形状;网页 `wordbook-contract.test.ts` 用 `Record<keyof AnswerResult, true>` 编译期绑定键表,并对 5 处答案样例做 `keysOf(x) == keys(ANSWER)`。新键全部可选 → 键表要排除它们(W1)。`answer_choice`(学新词的 `meaning` 题,先经 `learn/batch` 出题)天然命中备忘,录得到 `option_info`。 |
| `word-tap.ts` 是否存在、怎么选(§2.3) | 存在,在 `web/src/features/library/word-tap.ts`:`selectWord(el)` = 用户刚拖选了别的文字就不覆盖,否则 `removeAllRanges()` + `selectAllChildren(el)`。归计划 B 的 `features/library`,**不能**从 wordbook 导入(跨 feature 只许走 `index.ts`,而且该文件所有权在 B)。→ R-A8:在 `web/src/lib/select-word.ts` 放同契约的一份(合并后可让 library 改为 re-export,不在本轮)。 |
| `use-text-selection.ts` / `lookup-layer.tsx` 的条件 | `readSelection` 只认**锚点与焦点都在同一个 `[data-lookup-context]` 里**的选区,且不在可编辑元素里;选区稳定 300 ms(`selectionchange` 防抖)后 `LookupLayer` 出 `LookupBar`(`data-testid="lookup-bar"`,`onPointerDown`/`onMouseDown` 里 `preventDefault` 保住选区)。`LookupLayer` 由 `layout/app-shell.tsx` 全局挂载,复习页在 `AppShell` 里。→ 选项里的单词 span 自己带 `data-lookup-context`;上下文 = 它的 textContent = 单词本身(`wordTargetFromLookup` 会在 context 与词相同时不带例句)。 |
| 当前 `word-card.tsx`(别的车道刚合并默认值) | 已合并:`DEFAULT_DEF_LANG = "en"`(`def-lang.ts`);`WordCardView` 有 `defLang` 属性,内部 `defView(defLang, card, peek)`;「中」开关 `data-testid="def-peek"` 是**单卡本地状态**(`peekKey === card.key`,换卡复位,不写服务端/本机);`phrasesOpen` 默认折叠;`meaningLine(senses, max)`、`posLabel`、`HighlightedSentence`、`ListenButton`、`ListenProps` 都从 `word-card.tsx` 导出。→ 本计划只复用,不改 `word-card.tsx` / `def-lang.ts`。 |
| 视口锁(已合并)与双击缩放 | `index.css`:`html, body { position: fixed; inset: 0; overflow: hidden; overscroll-behavior: none }`,滚动只在 `AppShell` 的 `<main>`;`index.html` 的 viewport 是 `width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content`,**没有** `maximum-scale` / `user-scalable=no`。→ 双击缩放没有被 meta 挡住,**必须**在选项容器上设 `touch-action: manipulation`(Tailwind `touch-manipulation`);是否真的不缩放只有真机能证明(未验证)。 |
| 复习页现状 | `review-page.tsx` 的 `ReviewSession`:选择题答完后 `ChoiceQuestion` 的选项是 `<button disabled>`;结果行是 `<p role="status">`(现有测试用 `getByRole("status")` 取唯一一个,**新增内容不许再用 `role="status"`**);批次里 `cards` 是 `Record<key, Card>`(带 `defsEn`、`phrases`、`examples`),自由复习的批次由 `toBatch(free)` 同形。 |
| 其他用到 `ChoiceQuestion` 的地方 | `learn-page.tsx`(学新词小测 / 本轮小测;答错后有 `WordRecap`)和复习页的快速回忆**抽查题**(`result={null}`)。三个 E2E(`wordbook.spec.ts`、`wordbook-goals.spec.ts`、`wordbook-recall.spec.ts`)在学新词小测里用 `question.locator('button[data-state="correct"]')` 找答完后标绿的选项。→ R-A7:新的答后渲染**只在传了 `after` 属性时启用**(只有复习页传),其余调用方逐字节不变,E2E 选择器不用动。 |
| `def_lang` 与「中」开关的语义(§2.3) | 与卡片一致:偏好 `en`(默认)且这个词**有英文释义**时中文让位,「中」临时显示;没有英文释义的词回退成中文(`defView` 的 `showSenses`);偏好 `zh` / `both` 直接显示中文。`defView` 的第二个参数只要 `{senses, defsEn}`,所以 `option_info` 里的 `defsZh` / `defsEn` 可直接喂给它。→ R-A10。 |
| 一次性提示的本机偏好(§2.3) | 沿用 `WORDBOOK_PREFS_KEY` 的 JSON(与 `spell/prefs.ts`、`phrases-pref.ts` 合并写入同一个键,退出登录由 `auth/device-data.clearDeviceData()` 清除),字段 `doubleTapHintSeen`(布尔)。 |

## 本计划的裁定

- **R-A1 备忘而非重算。** `service._question(..., user_id=…)` 在出 `meaning` / `word` 题时,把 `((选项原文, 词键), …)`(与题面 `options` 同序)记进 `ds.option_memo`(键 `(user_id, book_id, key, qtype)`,LRU 2,048 条,标准库,无日志)。`_answer` / `_free_answer` 判分后读它。进程重启 / 多 worker / LRU 淘汰 / 选项对不上 → 整个省略 `option_info`(网页退回旧显示)。镜像按单 worker 运行(与 `_learn_locks` 同一假设);多 worker 时只会降级,不会出错。**不新增请求字段**(请求里的 `choice` 与正确项必须都在备忘的选项里才回填,防止拿别的题的备忘对不上)。
- **R-A2 只给 `meaning` / `word`。** `cloze`、打字题、自评题(含快速回忆的抽查——抽查答案走 `qtype: "recall"`)的响应**逐字不变**(没有这三个键)。键缺失 = 没有这项信息,网页一律按「可能不存在」处理。
- **R-A3 `option_info` 的形状与顺序。** `[{option, word, defs_zh:[{pos,text}], defs_en:[{pos,text}]}]`,顺序 = 出题时 `options` 的顺序(备忘里的顺序);**网页按 `option` 文本匹配,不按下标**(备忘可能来自另一次出题,宁可有的选项没信息,也不能错位)。`word` = `card.word`(词书里的写法);`defs_zh` = `card.senses[:4]`(同 `lookup.MAX_ZH`);`defs_en` = `ds.definitions.defs_for(key)`(≤ 2 条/词性、≤ 4 条,没有 = `[]`)。四个键总是都在。
- **R-A4 `phrases` / `example`。** 只属于**正确单词的词卡**:`phrases` = `card.phrases[:3]`(`[{en, zh}]`,空则省略键),`example` = `card.examples[0]`(`{id, en, zh}`,没有则省略键)。不依赖备忘(备忘缺失时这两个键仍在)。
- **R-A5 不泄露。** 三个键只在判分之后构造(`_choice_extras` 在 `commit` 之后调用);批次响应(`question_out`)不变。
- **R-A6 备忘不是判分依据。** 判分仍然只看 `(book_id, key, qtype, choice)` 与词卡(P-W2);备忘只服务展示。
- **R-A7 `after` 是选择开启。** `ChoiceQuestion` 新增可选 `after?: AfterAnswer`;`after !== undefined && result !== null && qtype !== "cloze"` 才把选项换成容器。学新词页、抽查题、cloze 保持原来的禁用按钮。(偏离 spec §2.3 的通用措辞,原因见「与 spec 的偏离」。)
- **R-A8 `selectWord` 放 `lib/`。** `web/src/lib/select-word.ts` 导出 `selectWord(el, doc?)`,契约与 `features/library/word-tap.ts` 相同(用户刚拖选了别的文字时不覆盖,返回是否改了选区);测试同形。library 那份不动(计划 B 的文件)。
- **R-A9 双击判定。** `double-tap.ts`:`createTapTracker(300)`——同一行、间隔 ≤ 300 ms 的两次点击算双击,识别后清标记(第三次重新数);原生 `dblclick` 兜底(系统双击间隔 > 300 ms 的用户),识别过双击后 600 ms 内的 `dblclick` 去重;`click` 的 `detail === 0`(键盘 / 读屏的合成激活)和 Enter / 空格一次就查。点按时间用 `performance.now()`(测试可 `vi.spyOn`)。**答题那一下不计入**:选项在答题前是 `<button>`,计数只来自答题后的容器。
- **R-A10 `def_lang` 与「中」开关。** `meaning` 题:每个选项行的中文行 = `defView(defLang, {senses: info.defsZh, defsEn: info.defsEn}, peek).showSenses ? option : null`(`option` 就是服务端的释义行原文,不在客户端重建);「中」按钮在题卡眉题行右侧,只有当**任一选项**在当前偏好下把中文藏起来(`canPeek`)时才出现,状态由复习页持有(按 `${key}:${attempt}` 复位,换题自动关),同时作用于选项行和「学习内容」区。`word` 题:选项行**始终**显示 `meaningLine(info.defsZh, 40)`(spec D3 字面:英文单词 + 小字中文与词性;用户刚看过中文题面,不受 `def_lang` 影响)。「学习内容」区:`meaning` 用 `defView`(偏好 `zh` 时改显中文,没有英文释义的词回退中文);`word` 用 `WordCardView`(自带卡片级「中」开关)。
- **R-A11 学习内容区的数据来源。** 优先用批次里的词卡(`batch.cards[key]`,含 `defsEn`、`phrases`、`examples`);没有词卡(不该发生)时,用答案里正确选项的 `optionInfo` + `phrases` + `example` 拼一张(`cardForPanel`)。所以服务端新增的 `phrases` / `example` 在复习页正常路径下与词卡同源、不改变显示,只在缺卡时兜底;spec 要求的服务端字段照做。
- **R-A12 一次性提示。** `DoubleTapHint` 挂载时读 `doubleTapHintSeen`:没看过 → 显示并立刻写 `true`(一道题内一直显示,之后每个新实例读到 `true` 不再显示);只在有可点的单词(`word` 题,或 `meaning` 题且有 `optionInfo`)时挂载;存储不可用时读 `false`、写入静默丢弃(每次都显示,不报错)。
- **R-A13 选项行的可访问性。** 有单词的行 `role="button"` + `tabIndex=0`,名称来自内容(单词 + 小字 + 一段 `sr-only` 的状态文字「正确答案 / 你选的」);Enter / 空格 = 查词。没有单词的行(旧服务端的 `meaning` 题)是无角色的普通容器,保留 `wrong → <s>` 删除线。有单词时 `wrong` 行不再划线(划线的是中文释义,现在显示的是单词)。
- **R-A14 `touch-action`。** 答后每个选项容器 `touch-manipulation`;单词 span `select-text`(Tailwind 同时输出 `-webkit-user-select` 与 `user-select`)。**不**对整个页面设 `touch-action`(视口锁已合并,不重复)。

## 与 spec 的偏离(写计划者的裁量,均可回退)

1. **范围收窄到复习页的答后界面**(R-A7):spec §2.3 写的是「`ChoiceQuestion` 答题后…」。学新词页没有 `option_info`(学新词的答案同样会带,但页面没有面板),三个 E2E 又依赖 `button[data-state="correct"]`,所以选择开启。学新词页要同样的体验是后续小改动(传 `after` + 渲染面板)。
2. **`option_info` 不保证存在**(R-A1):spec 写成响应必有;因 `/answers` 无状态,做成「命中备忘才有」,网页对缺失完整降级。
3. **顺序不再是契约**(R-A3):spec 写「与 `options` 同序」;服务端仍按出题顺序给,但网页按 `option` 文本匹配。
4. **`phrases` / `example` 只给 `meaning` / `word` 题**(R-A2),spec 写「选择题」。cloze 不改。
5. **`selectWord` 在 `lib/` 里有第二份**(R-A8):spec 说「与 `word-tap.ts` 同一做法,不写新的选中机制」——做法相同、不是新机制,但文件是副本,因为 `word-tap.ts` 属于计划 B 且跨 feature 不能导入。

## 文件结构与共享文件风险

```
server/
  app/wordbook/option_memo.py                 新(S1)
  app/wordbook/index.py                       [改] DictionaryStore.__init__ 加一行 + 一个 import(S1)
  app/wordbook/service.py                     [改] _question / _choice_extras / _answer_out / _answer / _free_answer(S2)
  app/wordbook/CLAUDE.md                      [改] What lives here + Pitfalls 各加一行(S3)
  tests/test_wordbook_option_memo.py          新(S1)
  tests/test_wordbook_option_info.py          新(S2)
  tests/test_wordbook_contract.py             [改] 加断言(S3)
  tests/fixtures/wordbook_contract.json       [重录](S3)
web/src/
  features/wordbook/wordbook-api.ts           [改] OptionInfo + AnswerResult 三个可选键(W1)
  features/wordbook/wordbook-contract.test.ts [改](W1)
  lib/select-word.ts、select-word.test.ts     新(W2)
  features/wordbook/double-tap.ts(+test)、double-tap-pref.ts(+test)、double-tap-hint.tsx(+test)   新(W3)
  features/wordbook/option-view.ts(+test)     新(W4)
  features/wordbook/locales/{en,zh-CN}.json   [改] web.wordbookDefs.after.*(W4)
  features/wordbook/choice-question.tsx       [改,整文件替换](W5);choice-question-after.test.tsx 新
  features/wordbook/after-answer-panel.tsx(+test)   新(W6)
  features/wordbook/review-page.tsx           [改] 4 处(W7);review-after-answer.test.tsx 新
  features/wordbook/CLAUDE.md、lib/CLAUDE.md、web/README.md   [改](W8)
docs/superpowers/plans/2026-10-13-review-after-answer-device-checklist.md   已交付(UNVERIFIED)
```

共享文件风险:(1) `server/app/wordbook/CLAUDE.md`、`web/src/features/wordbook/CLAUDE.md`、`web/README.md` 可能与计划 B 的追加相邻——B 不碰 `features/wordbook`,但 `web/README.md` 两边都会加一段,合并时保留双方;(2) `wordbook_contract.json` 只有本计划重录(B 用自己的夹具);(3) `server/app/wordbook/index.py` 的一行改动与 B 无交集(B 只改 `app/library`、`speech`);(4) `service.py` 里 `_answer_out` 的签名有多处调用,新参数是**仅关键字且有默认值**,不影响 `_rating_answer`;(5) 新增 UI 文案只进懒加载 `locales/`,主包不变(`locales.test.ts` 守着键一致)。

---

# 服务端

## Task S1:选项备忘 `OptionMemo`

**Files:** Create `server/app/wordbook/option_memo.py`、`server/tests/test_wordbook_option_memo.py`;Modify `server/app/wordbook/index.py`。

- [ ] **Step 1(先写测试):** Write `server/tests/test_wordbook_option_memo.py`:

```python
"""选项备忘(计划 2026-10-13-review-after-answer S1):按 (用户, 书, 词, 题型) 取、有界 LRU、模块里没有日志调用。"""
from pathlib import Path

from app.wordbook import option_memo
from app.wordbook.index import DictionaryStore
from app.wordbook.option_memo import OptionMemo
from tests.wordbook_helpers import make_data_dir

PAIRS = (("v. 说话；谈话", "talk"), ("n. 事故", "accident"))


def test_remember_and_recall_by_the_whole_slot():
    memo = OptionMemo()
    memo.remember(1, "junior", "talk", "meaning", PAIRS)
    assert memo.recall(1, "junior", "talk", "meaning") == PAIRS
    assert memo.recall(2, "junior", "talk", "meaning") is None  # another user
    assert memo.recall(1, "senior", "talk", "meaning") is None  # another book
    assert memo.recall(1, "junior", "able", "meaning") is None  # another word
    assert memo.recall(1, "junior", "talk", "word") is None  # another question type


def test_the_latest_question_for_a_slot_wins():
    memo = OptionMemo()
    memo.remember(1, "junior", "talk", "meaning", PAIRS)
    newer = (("x", "talk"),)
    memo.remember(1, "junior", "talk", "meaning", newer)
    assert memo.recall(1, "junior", "talk", "meaning") == newer and len(memo) == 1


def test_it_is_bounded_and_the_least_recently_used_goes_first():
    memo = OptionMemo(size=2)
    memo.remember(1, "junior", "a", "meaning", PAIRS)
    memo.remember(1, "junior", "b", "meaning", PAIRS)
    assert memo.recall(1, "junior", "a", "meaning") == PAIRS  # touching a makes b the oldest
    memo.remember(1, "junior", "c", "meaning", PAIRS)
    assert memo.recall(1, "junior", "b", "meaning") is None
    assert memo.recall(1, "junior", "a", "meaning") == PAIRS and len(memo) == 2


def test_clear_forgets_everything():
    memo = OptionMemo()
    memo.remember(1, "junior", "talk", "meaning", PAIRS)
    memo.clear()
    assert memo.recall(1, "junior", "talk", "meaning") is None and len(memo) == 0


def test_the_module_is_not_a_logging_site():
    source = Path(option_memo.__file__).read_text(encoding="utf-8")
    assert "logging" not in source and "logger" not in source


async def test_the_dictionary_store_carries_its_own_memo(tmp_path):
    first = DictionaryStore(make_data_dir(tmp_path))
    second = DictionaryStore(make_data_dir(tmp_path))
    assert isinstance(first.option_memo, OptionMemo) and first.option_memo is not second.option_memo
```

- [ ] **Step 2:** Run `cd server && uv run pytest -q tests/test_wordbook_option_memo.py` — expect FAIL (`ModuleNotFoundError: app.wordbook.option_memo`).

- [ ] **Step 3:** Write `server/app/wordbook/option_memo.py`(注意:模块里不要出现 `logging` / `logger` 字样,连注释也不要):

```python
"""答题后「每个选项对应哪个词」的进程内备忘(计划 2026-10-13-review-after-answer R-A1)。

`/answers` 是无状态判分(P-W2):请求里没有选项,干扰项又是出题时按 rng 抽的,答题时无法重算。所以出题时把
`(用户, 书, 词, 题型) -> ((选项原文, 词键), ...)`(与题面 options 同序)记在 `DictionaryStore` 上,答题后据此回填 `option_info`。
纯标准库;容量有界(LRU);进程重启、多进程或被淘汰时取不到,调用方就省略 `option_info`(降级,不报错)。
不打印、不持久化任何词。"""
from collections import OrderedDict

Pairs = tuple[tuple[str, str], ...]
Slot = tuple[int, str, str, str]


class OptionMemo:
    def __init__(self, size: int = 2048):
        self._size = size
        self._data: OrderedDict[Slot, Pairs] = OrderedDict()

    def remember(self, user_id: int, book_id: str, key: str, qtype: str, pairs: Pairs) -> None:
        slot = (user_id, book_id, key, qtype)
        self._data[slot] = pairs
        self._data.move_to_end(slot)
        while len(self._data) > self._size:
            self._data.popitem(last=False)

    def recall(self, user_id: int, book_id: str, key: str, qtype: str) -> Pairs | None:
        slot = (user_id, book_id, key, qtype)
        found = self._data.get(slot)
        if found is not None:
            self._data.move_to_end(slot)
        return found

    def clear(self) -> None:
        self._data.clear()

    def __len__(self) -> int:
        return len(self._data)
```

- [ ] **Step 4:** Edit `server/app/wordbook/index.py`:
  1. 在 `from app.wordbook.entry import WordCard, clean_sentence, headword_key, merge_rows, pos_mask_of, pos_parts` 这一行**之后**加一行 `from app.wordbook.option_memo import OptionMemo`。
  2. 在 `        self.definitions = Definitions(default_path(self.data_dir))  # English definitions (spec 2026-10-12 §3)` 这一行**之后**加:
```python
        self.option_memo = OptionMemo()  # 出题时记下「选项 → 词」,答题后回填 option_info(计划 2026-10-13-review-after-answer R-A1)
```

- [ ] **Step 5:** Run `cd server && uv run pytest -q tests/test_wordbook_option_memo.py tests/test_architecture.py tests/test_wordbook_index.py` — expect PASS。

- [ ] **Step 6:** Commit:
```
git add server/app/wordbook/option_memo.py server/app/wordbook/index.py server/tests/test_wordbook_option_memo.py
git commit -m "feat(server): remember which word stands behind each choice option" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
(多行信息用 `-m` 两段即可;最后一段必须是 `Co-Authored-By` 行。)

## Task S2:`/answers` 追加 `option_info` · `phrases` · `example`

**Files:** Modify `server/app/wordbook/service.py`;Create `server/tests/test_wordbook_option_info.py`。

- [ ] **Step 1(先写测试):** Write `server/tests/test_wordbook_option_info.py`:

```python
"""答题后的选项信息(计划 2026-10-13-review-after-answer S2):option_info / phrases / example(R-A1 … R-A6)。"""
from datetime import timedelta

from sqlalchemy import update

from app.models import VocabularyItem, utcnow
from app.wordbook import service
from app.wordbook.entry import meaning_line
from app.wordbook.index import dictionary
from tests.wordbook_helpers import enable_wordbook, make_data_dir, make_defs_dir

URL = "/api/wordbook"
TALK_MEANING = "v. 说话；谈话；n. 交谈"
EXTRA_KEYS = {"option_info", "phrases", "example"}


async def login(app, client, tmp_path):
    enable_wordbook(app, make_data_dir(tmp_path))
    make_defs_dir(tmp_path)  # 英文释义:option_info 的 defs_en 来自它
    r = await client.post("/api/users", json={"username": "alice", "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    await client.put(f"{URL}/enrollment", headers=h, json={"book_id": "junior", "order_mode": "book"})
    return h


async def ans(client, h, **body):
    return await client.post(f"{URL}/answers", headers=h, json={"book_id": "junior", "tz_offset_minutes": 480, **body})


async def learn_batch(client, h) -> dict:
    return (await client.post(f"{URL}/learn/batch", headers=h, json={"size": 5})).json()


async def test_a_meaning_answer_names_the_word_behind_every_option(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    talk = next(q for q in (await learn_batch(client, h))["quiz"] if q["key"] == "talk")
    wrong = next(o for o in talk["options"] if o != TALK_MEANING)
    body = (await ans(client, h, key="talk", mode="learn", qtype="meaning", choice=wrong)).json()
    assert (body["correct"], body["expected"], body["correct_option"]) == (False, "talk", TALK_MEANING)  # 旧字段不变
    info = body["option_info"]
    assert [i["option"] for i in info] == talk["options"]  # 与题面同序
    assert all(set(i) == {"option", "word", "defs_zh", "defs_en"} for i in info)
    by_option = {i["option"]: i for i in info}
    assert by_option[TALK_MEANING]["word"] == "talk"
    assert by_option[TALK_MEANING]["defs_zh"] == [{"pos": "v", "text": "说话；谈话"}, {"pos": "n", "text": "交谈"}]
    assert by_option[TALK_MEANING]["defs_en"][0] == {"pos": "v", "text": "speak to someone"}
    assert len({i["word"] for i in info}) == len(info) == 4
    store = dictionary(app)
    for i in info:  # 每个 word 确实是这条释义行的主人
        assert meaning_line(await store.card("junior", i["word"].lower())) == i["option"]


async def test_phrases_and_example_come_from_the_correct_word_card(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    await learn_batch(client, h)
    body = (await ans(client, h, key="talk", mode="learn", qtype="meaning", choice=TALK_MEANING)).json()
    card = (await client.get(f"{URL}/cards/junior/talk", headers=h)).json()
    assert body["phrases"] == card["phrases"][:3] and body["phrases"] == [{"en": "talk about", "zh": "谈论某事"}]
    assert body["example"] == card["examples"][0] and set(body["example"]) == {"id", "en", "zh"}


async def test_a_word_answer_names_the_word_of_every_option(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    drill = next(q for q in (await learn_batch(client, h))["drill"] if q["key"] == "ability")
    wrong = next(o for o in drill["options"] if o != "ability")
    body = (await ans(client, h, key="ability", mode="learn", qtype="word", choice=wrong)).json()
    info = body["option_info"]
    assert [i["option"] for i in info] == drill["options"] and [i["word"] for i in info] == drill["options"]
    ability = next(i for i in info if i["option"] == "ability")
    assert ability["defs_zh"] == [{"pos": "n", "text": "能力，能耐；才能"}]
    assert ability["defs_en"] == [{"pos": "n", "text": "the power or skill to do something"}]
    assert all(i["defs_zh"] for i in info)


async def test_cloze_typed_and_rating_answers_keep_the_old_shape(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    await learn_batch(client, h)
    cloze = (await ans(client, h, key="talk", mode="learn", qtype="cloze", choice="talk")).json()
    typed = (await ans(client, h, key="ability", mode="learn", qtype="spell", typed="ability")).json()
    rated = (await ans(client, h, key="able", mode="learn", qtype="recall", rating="know")).json()
    for body in (cloze, typed, rated):
        assert not EXTRA_KEYS & set(body)


async def test_without_a_memo_the_answer_degrades_to_the_old_option_shape(app, client, tmp_path):
    """进程重启 / 淘汰:没有 option_info,但 phrases / example 来自词卡,仍在。"""
    h = await login(app, client, tmp_path)
    await learn_batch(client, h)
    dictionary(app).option_memo.clear()
    body = (await ans(client, h, key="talk", mode="learn", qtype="meaning", choice=TALK_MEANING)).json()
    assert "option_info" not in body and body["phrases"] and body["example"]
    assert body["correct"] is True and body["correct_option"] == TALK_MEANING


async def test_a_choice_that_is_not_in_the_remembered_options_gets_no_option_info(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    await learn_batch(client, h)
    body = (await ans(client, h, key="talk", mode="learn", qtype="meaning", choice="not an option")).json()
    assert body["correct"] is False and "option_info" not in body


async def test_review_questions_remember_their_options(app, client, tmp_path, monkeypatch):
    h = await login(app, client, tmp_path)
    monkeypatch.setattr(service, "pick_qtype", lambda box, card, rng, *, tts=True: "meaning")
    await ans(client, h, key="talk", mode="learn", qtype="meaning", choice=TALK_MEANING)
    async with app.state.sessionmaker() as s:
        await s.execute(update(VocabularyItem).where(VocabularyItem.word == "talk")
                        .values(due_at=utcnow() - timedelta(hours=1)))
        await s.commit()
    (q,) = (await client.post(f"{URL}/review/batch", headers=h, json={"size": 5, "tz_offset_minutes": 480})).json()["questions"]
    assert q["qtype"] == "meaning" and TALK_MEANING in q["options"]
    wrong = next(o for o in q["options"] if o != TALK_MEANING)
    body = (await ans(client, h, key="talk", mode="review", qtype="meaning", choice=wrong)).json()
    assert [i["option"] for i in body["option_info"]] == q["options"]
    assert next(i for i in body["option_info"] if i["option"] == TALK_MEANING)["word"] == "talk"


async def test_free_review_questions_remember_their_options(app, client, tmp_path, monkeypatch):
    h = await login(app, client, tmp_path)
    monkeypatch.setattr(service, "free_choice_qtype", lambda card, rng: "meaning")
    for key in ("talk", "ability", "able"):
        await ans(client, h, key=key, mode="learn", qtype="recall", rating="know")
    free = (await client.post(f"{URL}/free/start", headers=h, json={
        "scope": "all", "mode": "choice", "count": 10, "tz_offset_minutes": 480})).json()
    item = free["items"][0]
    q = item["question"]
    wrong = next(o for o in q["options"] if o != meaning_line(await dictionary(app).card(item["book_id"], item["card"]["key"])))
    body = (await ans(client, h, book_id=item["book_id"], key=item["card"]["key"], mode="free", qtype="meaning",
                      choice=wrong)).json()
    assert [i["option"] for i in body["option_info"]] == q["options"]
    assert {i["word"] for i in body["option_info"]} >= {item["card"]["word"]}


async def test_option_info_is_not_logged(app, client, tmp_path, caplog):
    caplog.set_level("DEBUG")
    h = await login(app, client, tmp_path)
    await learn_batch(client, h)
    await ans(client, h, key="talk", mode="learn", qtype="meaning", choice=TALK_MEANING)
    assert "speak to someone" not in caplog.text and "谈论某事" not in caplog.text
```

- [ ] **Step 2:** Run `cd server && uv run pytest -q tests/test_wordbook_option_info.py` — expect FAIL(`KeyError: 'option_info'`)。

- [ ] **Step 3:** Edit `server/app/wordbook/service.py`(单行锚点):

  1. `from app.wordbook.entry import WordCard` → `from app.wordbook.entry import WordCard, meaning_line`。
  2. 在 `LEARN_DUE = timedelta(days=1)` 这一行**之后**加:
```python

OPTION_INFO_QTYPES = ("meaning", "word")  # 答题后回填「选项 → 词」的题型(cloze 不改)
MAX_ANSWER_PHRASES = 3
MAX_OPTION_DEFS_ZH = 4  # 与 lookup.MAX_ZH 相同
```
  3. 把 `async def _question(ds: DictionaryStore, index: BookIndex, card: WordCard, qtype: str, rng) -> Question:` 改为:
```python
async def _question(ds: DictionaryStore, index: BookIndex, card: WordCard, qtype: str, rng, *,
                    user_id: int | None = None) -> Question:
```
  4. 把函数体最后一行 `    return build_question(qtype, card, distractors, rng)` 替换为:
```python
    question = build_question(qtype, card, distractors, rng)
    if user_id is not None and qtype in OPTION_INFO_QTYPES and question.options is not None:
        # R-A1:出题时记下「选项原文 -> 词键」(与题面同序),答题后回填 option_info;对不上(重复文本等)就不记
        owners = {_option_text(qtype, c): c.key for c in (card, *distractors)}
        pairs = tuple((o, owners[o]) for o in question.options if o in owners)
        if len(owners) == len(question.options) == len(pairs):
            ds.option_memo.remember(user_id, index.book_id, card.key, qtype, pairs)
    return question
```
  5. 在 `_question` 函数**之前**(`async def _active(` 之前的空行处)加两个函数:
```python
def _option_text(qtype: str, card: WordCard) -> str:
    """与 quiz.build_question 放进 options 的那一项逐字相同:meaning = 释义行,word = 词头。"""
    return meaning_line(card) if qtype == "meaning" else card.word


async def _choice_extras(ds: DictionaryStore, user_id: int, p: AnswerInput, card: WordCard) -> dict:
    """/answers 的追加字段(spec 2026-10-13-review-after-answer §2.2),只给 meaning / word 选择题,全部可选:
    `phrases`(≤ 3)与 `example`(第一条例句)来自词卡,没有就省略键;`option_info` 来自出题时的备忘(R-A1),
    备忘取不到、你选的项或正确项不在其中、或有词卡读不出来时整个省略。只在判分之后调用:题面不泄露(R-A5)。"""
    if p.qtype not in OPTION_INFO_QTYPES:
        return {}
    out: dict = {}
    if card.phrases:
        out["phrases"] = [{"en": en, "zh": zh} for en, zh in card.phrases[:MAX_ANSWER_PHRASES]]
    if card.examples:
        e = card.examples[0]
        out["example"] = {"id": e.id, "en": e.en, "zh": e.zh}
    pairs = ds.option_memo.recall(user_id, p.book_id, card.key, p.qtype)
    if not pairs or p.choice is None or not {p.choice, correct_option(p.qtype, card)} <= {o for o, _ in pairs}:
        return out
    try:
        cards = await ds.cards(p.book_id, [k for _, k in pairs])
    except DataUnavailable:
        return out
    if not all(k in cards for _, k in pairs):
        return out
    out["option_info"] = [
        {"option": option, "word": cards[k].word,
         "defs_zh": [{"pos": s.pos, "text": s.text} for s in cards[k].senses[:MAX_OPTION_DEFS_ZH]],
         "defs_en": ds.definitions.defs_for(k)}
        for option, k in pairs]
    return out


```
  6. 出题处各加 `user_id=user_id`(4 处,都是单行):
     - `    quiz = [question_out(await _question(ds, index, c, "meaning", question_rng(user_id, c.key, 0))) for c in cards]` → 在 `question_rng(user_id, c.key, 0)` 之后加 `, user_id=user_id`,即 `await _question(ds, index, c, "meaning", question_rng(user_id, c.key, 0), user_id=user_id)`。
     - `    drill = [question_out(await _question(ds, index, c, "word", question_rng(user_id, c.key, 1))) for c in cards]` → 同样加 `, user_id=user_id`。
     - `        questions.append(question_out(await _question(ds, index, card, qtype, rng)))` → `await _question(ds, index, card, qtype, rng, user_id=user_id)`。
     - `            question = question_out(await _question(ds, await index_or_fail(ds, book_id), card, qtype, qrng))` → `... card, qtype, qrng, user_id=user_id))`。
     - **不改** `_rating_answer` 里抽查题那一处(`qtype: "recall"` 的抽查答案不返回 option_info,R-A2)。
  7. `_answer_out`:把签名最后一行 `                check: dict | None = None) -> dict:` 改为 `                check: dict | None = None, extras: dict | None = None) -> dict:`;把 `    return {"correct": correct, "outcome": outcome, "grade": grade, "expected": card.word, "correct_option": option,` 改为 `    out = {"correct": correct, "outcome": outcome, "grade": grade, "expected": card.word, "correct_option": option,`;把 `            "check": check}` 改为:
```python
            "check": check}
    if extras:
        out.update(extras)
    return out
```
  8. `_answer` 的收尾(`# Ruling Z-e` 注释之后)把
```python
    return _answer_out(outcome == "correct", outcome, grade, card, option, diff,
                       await store.known_one(session, user_id, card.key), applied)
```
  改为:
```python
    extras = await _choice_extras(ds, user_id, p, card) if p.qtype in CHOICE_QTYPES else None
    return _answer_out(outcome == "correct", outcome, grade, card, option, diff,
                       await store.known_one(session, user_id, card.key), applied, extras=extras)
```
  (如多行锚点不匹配,分别锚 `    return _answer_out(outcome == "correct", outcome, grade, card, option, diff,` 与 `                       await store.known_one(session, user_id, card.key), applied)` 两行改。)
  9. `_free_answer` 的收尾把
```python
    return _answer_out(correct, outcome, grade, card, option, diff, await store.known_one(session, user_id, card.key),
                       queued, rating=rating)
```
  改为:
```python
    extras = await _choice_extras(ds, user_id, p, card) if p.qtype in CHOICE_QTYPES else None
    return _answer_out(correct, outcome, grade, card, option, diff, await store.known_one(session, user_id, card.key),
                       queued, rating=rating, extras=extras)
```

- [ ] **Step 4:** Run `cd server && uv run pytest -q tests/test_wordbook_option_info.py tests/test_wordbook_option_memo.py tests/test_wordbook_learn.py tests/test_wordbook_free_answers.py tests/test_wordbook_free_start.py tests/test_wordbook_recall_api.py tests/test_architecture.py` — expect PASS。若 `test_free_review_questions_remember_their_options` 因 `free/start` 的 `items[0]` 不是 `meaning`(不该:已固定)或 `wrong` 取不到而失败,先打印 `q["options"]` 与 `item` 再按真实结果修测试,**不要**放宽断言到「有没有都行」。
- [ ] **Step 5:** Commit `feat(server): return option_info, phrases and an example with choice answers`(同样以 `Co-Authored-By` 行结尾)。

## Task S3:契约夹具重录 · 契约断言 · 服务端文档

**Files:** Modify `server/tests/test_wordbook_contract.py`、`server/tests/fixtures/wordbook_contract.json`(重录)、`server/app/wordbook/CLAUDE.md`。

- [ ] **Step 1:** Edit `server/tests/test_wordbook_contract.py`:在 `    assert expected["answer_recall"]["rating"] == "fuzzy"` 这一行**之前**加:
```python
    # 答题后的选项信息(计划 2026-10-13-review-after-answer S3):学新词的 meaning 题先经 learn/batch 出题,备忘必命中
    choice = expected["answer_choice"]
    assert choice["option_info"] and set(choice["option_info"][0]) == {"option", "word", "defs_zh", "defs_en"}
    assert choice["option_info"][0]["defs_zh"] and choice["correct_option"] in {i["option"] for i in choice["option_info"]}
    assert choice["phrases"] and set(choice["phrases"][0]) == {"en", "zh"} and set(choice["example"]) == {"id", "en", "zh"}
    assert not {"option_info", "phrases", "example"} & set(expected["answer_typed"])  # 非选择题保持旧形状
```
- [ ] **Step 2:** 重录:`cd server && CONTRACT_UPDATE=1 uv run pytest -q tests/test_wordbook_contract.py`(PowerShell:`$env:CONTRACT_UPDATE=1; uv run pytest -q tests/test_wordbook_contract.py; Remove-Item Env:CONTRACT_UPDATE`);再不带变量跑一次 `uv run pytest -q tests/test_wordbook_contract.py tests/test_dictionary_contract.py` 确认 PASS。`git diff --stat server/tests/fixtures/wordbook_contract.json` 应只多出 `answer_choice` 里的三个键(以及 `answer_free` 里可能多出的同名键:自由复习题型由固定种子决定,若它是 `meaning` / `word` 且命中备忘就会有)。**检查夹具里没有令牌 / 本机路径**(测试已断言)。
- [ ] **Step 3:** Edit `server/app/wordbook/CLAUDE.md`:
  1. 在 `- \`lookup.py\` – 选词词典(...` 那一行(What lives here 的最后一项,以 `- \`lookup.py\`` 开头)**之后**加一行:
     `- \`option_memo.py\` – 出题时记「选项原文 → 词键」的进程内有界 LRU(挂在 \`DictionaryStore.option_memo\`),答题后回填 \`/answers\` 的 \`option_info\`(无日志调用;取不到就省略)`
  2. 在 Pitfalls 里 `- Contract fixture \`tests/fixtures/wordbook_contract.json\` ...` 那一条**之后**加一条:
     `- \`/answers\` 对 \`meaning\` / \`word\` 选择题追加**可选**键 \`option_info\`(\`[{option, word, defs_zh, defs_en}]\`,与题面同序,网页按 \`option\` 文本匹配)、\`phrases\`(≤ 3)、\`example\`;只在判分后构造。\`/answers\` 无状态,所以 \`option_info\` 靠出题时的 \`option_memo\`(进程内,重启 / 淘汰 / 多 worker 取不到就省略,不是错误);\`cloze\`、打字题、自评与抽查答案不带这三个键。不要把备忘用于判分(P-W2),也不要把词或选项写进日志。`
- [ ] **Step 4:** Run `cd server && uv run pytest -q tests/test_wordbook_contract.py tests/test_wordbook_option_info.py tests/test_architecture.py` — expect PASS。
- [ ] **Step 5:** Commit `test(server): record option_info in the wordbook contract and document the memo`。

---

# 网页

## Task W1:类型与契约测试

**Files:** Modify `web/src/features/wordbook/wordbook-api.ts`、`web/src/features/wordbook/wordbook-contract.test.ts`。

- [ ] **Step 1(先改测试):** Edit `wordbook-contract.test.ts`:
  1. import 行 `  AnswerResult, BlankResult, BonusResult, BookProgress, Card, ClozeLine, DefEn, DayPlan, Enrollment, GoalLimits, ItemState, Progress, Question,` 末尾 `Question,` 之后加 ` OptionInfo,`(同一行内:`... ItemState, OptionInfo, Progress, Question,`)。
  2. 把 `const ANSWER: Record<keyof AnswerResult, true> = {` 改为:
```ts
// optionInfo / phrases / example 是可选键(spec 2026-10-13-review-after-answer §2.2:缺省 = 没有这项信息):键表不含它们,由 answerKeys 过滤、专门的用例核对
const ANSWER_OPTIONAL = ["optionInfo", "phrases", "example"] as const;
const answerKeys = (a: object) => keysOf(a).filter((k) => !(ANSWER_OPTIONAL as readonly string[]).includes(k));
const OPTION_INFO: Record<keyof OptionInfo, true> = { option: true, word: true, defsZh: true, defsEn: true };
const ANSWER: Record<Exclude<keyof AnswerResult, (typeof ANSWER_OPTIONAL)[number]>, true> = {
```
  3. 把 5 处 `expect(keysOf(X)).toEqual(keys(ANSWER));`(X = `answer` / `choice` / `recall` / `pending` / `answer`)全部改成 `expect(answerKeys(X)).toEqual(keys(ANSWER));`。可用:`cd web && sed -i -E 's/expect\(keysOf\((answer|choice|recall|pending)\)\)\.toEqual\(keys\(ANSWER\)\)/expect(answerKeys(\1)).toEqual(keys(ANSWER))/' src/features/wordbook/wordbook-contract.test.ts`,然后 `grep -n "keys(ANSWER)" src/features/wordbook/wordbook-contract.test.ts` 应显示 5 行且全是 `answerKeys(`。
  4. 在 `  it("recall payloads match (spec recall §9)", () => {` 这一行**之前**加一个新用例:
```ts
  it("choice answers carry option info, phrases and an example (spec 2026-10-13-review-after-answer §2.2)", () => {
    const choice = cc<AnswerResult>(c.answer_choice);
    expect(choice.optionInfo?.length).toBeGreaterThan(1);
    for (const info of choice.optionInfo ?? []) {
      expect(keysOf(info)).toEqual(keys(OPTION_INFO));
      for (const d of info.defsZh) expect(keysOf(d)).toEqual(["pos", "text"]);
      for (const d of info.defsEn) {
        expect(keysOf(d)).toEqual(["pos", "text"]);
        expect(DEF_POS_CODES).toContain(d.pos);
      }
    }
    expect((choice.optionInfo ?? []).map((i) => i.option)).toContain(choice.correctOption);
    expect(cc<{ quiz: Question[] }>(c.learn_batch).quiz.find((q) => q.key === "talk")?.options).toEqual((choice.optionInfo ?? []).map((i) => i.option));
    expect(choice.phrases?.length).toBeLessThanOrEqual(3);
    expect(keysOf(choice.phrases?.[0] ?? {})).toEqual(["en", "zh"]);
    expect(keysOf(choice.example ?? {})).toEqual(["en", "id", "zh"]);
    // 非选择题保持旧形状
    expect(keysOf(cc<AnswerResult>(c.answer_typed))).not.toContain("optionInfo");
  });

```
- [ ] **Step 2:** Run `cd web && yarn vitest run src/features/wordbook/wordbook-contract.test.ts` — expect FAIL(类型里没有 `optionInfo`:vitest 不做类型检查,所以实际失败在 `OptionInfo` 导入为空类型 / 断言;同时 `yarn web:typecheck` 会报错——两者任一红即视为「先红」)。
- [ ] **Step 3:** Edit `wordbook-api.ts`:
  1. 在 `export interface AnswerResult {` 的**上方**(`/** \`expected\` = 词头;...` 注释块之前)加:
```ts
/**
 * 答题后某个选项对应的词(spec 2026-10-13-review-after-answer §2.2)。`option` 是题面 options 里的原文,**按它匹配,不按下标**;
 * `defsZh` = 词卡前几条中文释义,`defsEn` = 英英释义(没有 = `[]`)。
 */
export interface OptionInfo { option: string; word: string; defsZh: Sense[]; defsEn: DefEn[] }
```
  2. 在 `AnswerResult` 里把 `  diff: DiffOp[] | null; item: ItemState | null; applied: boolean; rating: Rating | null; spotCheck: boolean; check: Question | null;` 改为:
```ts
  diff: DiffOp[] | null; item: ItemState | null; applied: boolean; rating: Rating | null; spotCheck: boolean; check: Question | null;
  /** 只在 meaning / word 选择题且服务端取得到出题备忘时有;老服务端 / 其他题型没有(spec 2026-10-13-review-after-answer §2.2) */
  optionInfo?: OptionInfo[];
  /** 正确单词的短语(≤ 3)与第一条例句;同上,可选 */
  phrases?: { en: string; zh: string }[];
  example?: Example;
```
- [ ] **Step 4:** Run `cd web && yarn vitest run src/features/wordbook/wordbook-contract.test.ts && yarn web:typecheck` — expect PASS。
- [ ] **Step 5:** Commit `feat(web): type the answer's option info, phrases and example`。

## Task W2:`lib/select-word.ts`

**Files:** Create `web/src/lib/select-word.ts`、`web/src/lib/select-word.test.ts`;Modify `web/src/lib/CLAUDE.md`。

- [ ] **Step 1(测试):** Write `web/src/lib/select-word.test.ts`:
```ts
import { afterEach, describe, expect, it } from "vitest";
import { selectWord } from "./select-word";

function mount(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.innerHTML = "";
});

describe("selectWord (same contract as features/library/word-tap.ts)", () => {
  it("selects all the text of the element", () => {
    const root = mount('<p><span id="a">talk</span> <span id="b">about</span></p>');
    expect(selectWord(root.querySelector<HTMLElement>("#a")!)).toBe(true);
    expect(window.getSelection()?.toString()).toBe("talk");
  });

  it("moves the selection from one word to another when nothing else is selected by hand", () => {
    const root = mount('<p><span id="a">talk</span> <span id="b">about</span></p>');
    selectWord(root.querySelector<HTMLElement>("#a")!);
    expect(selectWord(root.querySelector<HTMLElement>("#b")!)).toBe(false); // a is still selected and differs from b's text
    window.getSelection()?.removeAllRanges();
    expect(selectWord(root.querySelector<HTMLElement>("#b")!)).toBe(true);
    expect(window.getSelection()?.toString()).toBe("about");
  });

  it("does not override a selection the user dragged elsewhere", () => {
    const root = mount('<p id="p">some other text</p><span id="a">talk</span>');
    const range = document.createRange();
    range.selectNodeContents(root.querySelector("#p")!);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    expect(selectWord(root.querySelector<HTMLElement>("#a")!)).toBe(false);
    expect(window.getSelection()?.toString()).toBe("some other text");
  });

  it("allows re-selecting the same text", () => {
    const root = mount('<span id="a">talk</span>');
    const el = root.querySelector<HTMLElement>("#a")!;
    expect(selectWord(el)).toBe(true);
    expect(selectWord(el)).toBe(true);
    expect(window.getSelection()?.toString()).toBe("talk");
  });
});
```
  (第二个用例里「`a` 仍选中且与 b 文字不同 → false」是故意的:与 library 版同一规则——用户/上一次的选区还在时不抢。真机上点第二个词前选区通常已被点击清掉。)
- [ ] **Step 2:** Run `cd web && yarn vitest run src/lib/select-word.test.ts` — expect FAIL(模块不存在)。
- [ ] **Step 3:** Write `web/src/lib/select-word.ts`:
```ts
/**
 * 程序化选中一个元素里的全部文字(点词 / 双击答后选项):全局 LookupLayer 在 selectionchange 稳定 300 ms 后自己出现选中操作条,
 * 上下文取最近的 [data-lookup-context]。用户刚拖选了别的文字时不覆盖。返回是否改了选区。
 *
 * 与 features/library/word-tap.ts 的 selectWord 同一契约(那份归跟读库,feature 之间不能导入彼此的内部文件,所以这里放一份;
 * 计划 2026-10-13-review-after-answer R-A8)。以后 library 可以改成从这里 re-export。
 */
export function selectWord(el: HTMLElement, doc: Document = el.ownerDocument): boolean {
  const sel = doc.getSelection();
  if (!sel) return false;
  const current = sel.isCollapsed ? "" : sel.toString().trim();
  if (current && current !== (el.textContent ?? "").trim()) return false;
  sel.removeAllRanges();
  sel.selectAllChildren(el);
  return true;
}
```
- [ ] **Step 4:** Edit `web/src/lib/CLAUDE.md`:在 `- \`speech-text.ts\` — ...` 那一条**之前**加一条:`- \`select-word.ts\` — \`selectWord(el)\`: programmatic selection of an element's text so the global lookup bar appears (same contract as \`features/library/word-tap.ts\`; used by the wordbook review page's double-tap).`
- [ ] **Step 5:** Run `cd web && yarn vitest run src/lib/select-word.test.ts src/architecture.test.ts` — expect PASS。
- [ ] **Step 6:** Commit `feat(web): add a lib helper that selects an element's text for lookup`。

## Task W3:双击判定 · 一次性提示

**Files:** Create `web/src/features/wordbook/double-tap.ts`(+`.test.ts`)、`double-tap-pref.ts`(+`.test.ts`)、`double-tap-hint.tsx`(+`.test.tsx`)。

- [ ] **Step 1(测试):** Write `double-tap.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { DOUBLE_TAP_MS, createTapTracker, isDoubleTap } from "./double-tap";

describe("isDoubleTap", () => {
  it("needs a previous tap on the same target inside the window", () => {
    expect(isDoubleTap(null, "a", 1000)).toBe(false);
    expect(isDoubleTap({ id: "a", at: 1000 }, "a", 1000 + DOUBLE_TAP_MS)).toBe(true);
    expect(isDoubleTap({ id: "a", at: 1000 }, "a", 1000 + DOUBLE_TAP_MS + 1)).toBe(false);
    expect(isDoubleTap({ id: "a", at: 1000 }, "b", 1100)).toBe(false);
    expect(isDoubleTap({ id: "a", at: 1000 }, "a", 900)).toBe(false); // the clock went backwards
  });
});

describe("createTapTracker", () => {
  it("fires on the second tap and counts again from the third", () => {
    const t = createTapTracker();
    expect(t.tap("a", 1000)).toBe(false);
    expect(t.tap("a", 1200)).toBe(true);
    expect(t.tap("a", 1300)).toBe(false); // third tap starts a new pair
    expect(t.tap("a", 1450)).toBe(true);
  });

  it("restarts when the second tap lands on another row or too late", () => {
    const t = createTapTracker();
    t.tap("a", 1000);
    expect(t.tap("b", 1100)).toBe(false);
    expect(t.tap("b", 1500)).toBe(false);
  });

  it("lets a native dblclick catch a slow double click, and ignores the one that follows a recognised double tap", () => {
    const t = createTapTracker();
    t.tap("a", 1000);
    expect(t.tap("a", 1100)).toBe(true);
    expect(t.dblclick(1110)).toBe(false); // the browser's own dblclick right after: duplicate
    t.tap("a", 5000);
    t.tap("a", 5500); // 500 ms apart: not a double tap by timing
    expect(t.dblclick(5510)).toBe(true); // but the system called it a double click
    expect(t.dblclick(5600)).toBe(false);
  });

  it("reset forgets the pending tap", () => {
    const t = createTapTracker();
    t.tap("a", 1000);
    t.reset();
    expect(t.tap("a", 1100)).toBe(false);
  });
});
```
  Write `double-tap-pref.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WORDBOOK_PREFS_KEY } from "~/lib/storage";
import { readDoubleTapHintSeen, writeDoubleTapHintSeen } from "./double-tap-pref";
import { writePhrasesPref } from "./phrases-pref";
import { readPrefs, writePrefs } from "./spell/prefs";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("double-tap hint preference (device-local)", () => {
  it("is unseen until it has been shown once", () => {
    expect(readDoubleTapHintSeen()).toBe(false);
    writeDoubleTapHintSeen();
    expect(readDoubleTapHintSeen()).toBe(true);
  });

  it("shares the wordbook prefs key without clobbering the other fields", () => {
    writePrefs({ showLength: true });
    writePhrasesPref(false);
    writeDoubleTapHintSeen();
    expect(JSON.parse(localStorage.getItem(WORDBOOK_PREFS_KEY)!)).toEqual({ showLength: true, phrasesOpen: false, doubleTapHintSeen: true });
    writePrefs({ showLength: false });
    expect(readDoubleTapHintSeen()).toBe(true);
    expect(readPrefs().showLength).toBe(false);
  });

  it("treats garbage as unseen and never throws when storage is unavailable", () => {
    localStorage.setItem(WORDBOOK_PREFS_KEY, "{nope");
    expect(readDoubleTapHintSeen()).toBe(false);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    expect(() => writeDoubleTapHintSeen()).not.toThrow();
    expect(readDoubleTapHintSeen()).toBe(false);
  });
});
```
  Write `double-tap-hint.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import { DoubleTapHint } from "./double-tap-hint";
import { readDoubleTapHintSeen } from "./double-tap-pref";

beforeEach(() => {
  localStorage.clear();
  void i18n.changeLanguage("zh-CN");
});
afterEach(() => {
  vi.restoreAllMocks();
  void i18n.changeLanguage("en");
});

describe("DoubleTapHint", () => {
  it("shows once, remembers it, and a later instance stays hidden", () => {
    const first = render(<DoubleTapHint />);
    expect(screen.getByTestId("double-tap-hint")).toHaveTextContent("双击选项可查词");
    expect(readDoubleTapHintSeen()).toBe(true);
    first.unmount();
    render(<DoubleTapHint />);
    expect(screen.queryByTestId("double-tap-hint")).toBeNull();
  });

  it("keeps showing for the whole question under StrictMode (the remembered flag is written after the first render)", () => {
    render(<StrictMode><DoubleTapHint /></StrictMode>);
    expect(screen.getByTestId("double-tap-hint")).toBeTruthy();
  });

  it("speaks English too", () => {
    void i18n.changeLanguage("en");
    render(<DoubleTapHint />);
    expect(screen.getByTestId("double-tap-hint")).toHaveTextContent("Double-tap an option to look it up");
  });

  it("does not crash when storage is unavailable (it just shows every time)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    const { unmount } = render(<DoubleTapHint />);
    expect(screen.getByTestId("double-tap-hint")).toBeTruthy();
    unmount();
    render(<DoubleTapHint />);
    expect(screen.getByTestId("double-tap-hint")).toBeTruthy();
  });
});
```
  (此测试依赖 W4 的 `locales/*.json` 键 `web.wordbookDefs.after.hint`——所以 **W3 的 Step 4 先加文案**,见下。)
- [ ] **Step 2:** Run `cd web && yarn vitest run src/features/wordbook/double-tap.test.ts src/features/wordbook/double-tap-pref.test.ts src/features/wordbook/double-tap-hint.test.tsx` — expect FAIL(模块不存在)。
- [ ] **Step 3:** Write `double-tap.ts`:
```ts
/** 点两下:同一行、间隔 ≤ 300 ms(计划 2026-10-13-review-after-answer R-A9)。纯函数 + 一个小状态机,时间由调用方传入(`performance.now()`)。 */
export const DOUBLE_TAP_MS = 300;
/** 识别过双击后,这段时间内的原生 dblclick 视为同一次手势(去重)。 */
const DBLCLICK_DEDUP_MS = 600;

export interface TapMark { id: string; at: number }

export function isDoubleTap(prev: TapMark | null, id: string, at: number, windowMs = DOUBLE_TAP_MS): boolean {
  return prev !== null && prev.id === id && at - prev.at >= 0 && at - prev.at <= windowMs;
}

export function createTapTracker(windowMs = DOUBLE_TAP_MS) {
  let last: TapMark | null = null;
  let firedAt: number | null = null;
  return {
    /** 记一次点按;这一下让它成了双击就返回 true(并清掉标记:第三下重新数)。 */
    tap(id: string, at: number): boolean {
      if (isDoubleTap(last, id, at, windowMs)) {
        last = null;
        firedAt = at;
        return true;
      }
      last = { id, at };
      return false;
    },
    /** 原生 dblclick 兜底(系统双击间隔 > 窗口的用户):识别过双击之后紧跟的那一个去重。 */
    dblclick(at: number): boolean {
      const duplicate = firedAt !== null && at - firedAt < DBLCLICK_DEDUP_MS;
      firedAt = at;
      return !duplicate;
    },
    reset(): void {
      last = null;
      firedAt = null;
    },
  };
}
```
  Write `double-tap-pref.ts`:
```ts
import { WORDBOOK_PREFS_KEY, readJson, writeJson } from "~/lib/storage";

/**
 * 「双击选项可查词」一次性提示的本机记忆(计划 2026-10-13-review-after-answer R-A12):布尔 `doubleTapHintSeen`,
 * 与拼写偏好、短语偏好共用 `WORDBOOK_PREFS_KEY` 的 JSON(合并写入,不覆盖别的字段;退出登录由 clearDeviceData 清除)。
 * 不含任何词。存储不可用时读到 false、写入静默丢弃。
 */
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function readDoubleTapHintSeen(): boolean {
  return readJson(WORDBOOK_PREFS_KEY, isObject)?.doubleTapHintSeen === true;
}

export function writeDoubleTapHintSeen(): void {
  const stored = readJson(WORDBOOK_PREFS_KEY, isObject) ?? {};
  writeJson(WORDBOOK_PREFS_KEY, { ...stored, doubleTapHintSeen: true });
}
```
  Write `double-tap-hint.tsx`:
```tsx
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { readDoubleTapHintSeen, writeDoubleTapHintSeen } from "./double-tap-pref";
import "./locales";

/**
 * 一次性提示「双击选项可查词」(spec 2026-10-13-review-after-answer §2.3):挂载时读本机记忆,没看过就显示,并马上记下来;
 * 这一道题内一直显示(状态在组件里),之后每个新实例读到「看过」就不显示。没有 role=status(复习页的结果行是唯一的 status)。
 */
export function DoubleTapHint() {
  const { t } = useTranslation();
  const [show] = useState(() => !readDoubleTapHintSeen());
  useEffect(() => {
    if (show) writeDoubleTapHintSeen();
  }, [show]);
  return show ? <p data-testid="double-tap-hint" className="mt-3 text-sub text-ink-2">{t("web.wordbookDefs.after.hint")}</p> : null;
}
```
- [ ] **Step 4:** 先加文案(`double-tap-hint.test.tsx` 要用)。Edit `web/src/features/wordbook/locales/en.json`:在单行 `      "peek": { "label": "Show Chinese definitions" },` **之后**插入:
```json
      "after": {
        "title": "Learn more",
        "hint": "Double-tap an option to look it up",
        "correct": "Correct answer",
        "yours": "Your answer"
      },
```
  Edit `locales/zh-CN.json`:在单行 `      "peek": { "label": "显示中文释义" },` **之后**插入:
```json
      "after": {
        "title": "学习内容",
        "hint": "双击选项可查词",
        "correct": "正确答案",
        "yours": "你选的"
      },
```
- [ ] **Step 5:** Run `cd web && yarn vitest run src/features/wordbook/double-tap.test.ts src/features/wordbook/double-tap-pref.test.ts src/features/wordbook/double-tap-hint.test.tsx src/features/wordbook/locales.test.ts` — expect PASS(`locales.test.ts` 要求 en / zh 键相同且都在 `web.wordbookDefs.` 下)。
- [ ] **Step 6:** Commit `feat(web): double-tap tracker and the one-time lookup hint`。

## Task W4:选项行视图纯函数 `option-view.ts`

**Files:** Create `option-view.ts`、`option-view.test.ts`(同目录 `web/src/features/wordbook/`)。

- [ ] **Step 1(测试):** Write `option-view.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { cardForPanel, infoFor, optionRowView, optionsCanPeek } from "./option-view";
import type { Card, OptionInfo, Question } from "./wordbook-api";

const OPT = "v. 说话；谈话；n. 交谈";
const TALK: OptionInfo = {
  option: OPT, word: "talk",
  defsZh: [{ pos: "v", text: "说话；谈话" }, { pos: "n", text: "交谈" }, { pos: "n", text: "第三条" }],
  defsEn: [{ pos: "v", text: "speak to someone" }],
};
const BARE: OptionInfo = { option: "v. 放弃", word: "abandon", defsZh: [{ pos: "vt", text: "放弃" }], defsEn: [] }; // 缺口词:没有英文释义
const meaning: Question = { key: "talk", qtype: "meaning", prompt: { word: "talk" }, options: [OPT, "v. 放弃"], length: null };

describe("optionRowView · meaning", () => {
  it("shows the English word and hides the Chinese line under English-only", () => {
    expect(optionRowView("meaning", OPT, TALK, "en", false)).toEqual({ word: "talk", sub: null });
  });

  it("brings the Chinese line back for peek, 'zh' and 'both'", () => {
    expect(optionRowView("meaning", OPT, TALK, "en", true)).toEqual({ word: "talk", sub: OPT });
    expect(optionRowView("meaning", OPT, TALK, "zh", false)).toEqual({ word: "talk", sub: OPT });
    expect(optionRowView("meaning", OPT, TALK, "both", false)).toEqual({ word: "talk", sub: OPT });
  });

  it("falls back to Chinese for a word without an English definition, so the row is never empty of meaning", () => {
    expect(optionRowView("meaning", "v. 放弃", BARE, "en", false)).toEqual({ word: "abandon", sub: "v. 放弃" });
  });

  it("has no word (legacy look) when the server sent no info", () => {
    expect(optionRowView("meaning", OPT, undefined, "en", false)).toEqual({ word: null, sub: null });
  });
});

describe("optionRowView · word", () => {
  it("always shows the word with a small Chinese line and part of speech, whatever def_lang says (spec D3)", () => {
    for (const lang of ["en", "zh", "both"] as const) {
      expect(optionRowView("word", "talk", { ...TALK, option: "talk" }, lang, false)).toEqual({ word: "talk", sub: "v. 说话；谈话；n. 交谈" });
    }
  });

  it("uses the option text as the word when there is no info (the option is the word)", () => {
    expect(optionRowView("word", "talk", undefined, "en", false)).toEqual({ word: "talk", sub: null });
  });

  it("is not a thing for cloze", () => {
    expect(optionRowView("cloze", "talk", undefined, "en", false)).toEqual({ word: null, sub: null });
  });
});

describe("optionsCanPeek", () => {
  it("is only for meaning questions where some option hid its Chinese", () => {
    expect(optionsCanPeek("meaning", "en", [TALK, BARE])).toBe(true);
    expect(optionsCanPeek("meaning", "en", [BARE])).toBe(false); // nothing hidden
    expect(optionsCanPeek("meaning", "zh", [TALK])).toBe(false);
    expect(optionsCanPeek("meaning", "both", [TALK])).toBe(false);
    expect(optionsCanPeek("word", "en", [TALK])).toBe(false);
    expect(optionsCanPeek("meaning", "en", undefined)).toBe(false);
  });
});

describe("infoFor", () => {
  it("matches by option text, not by position", () => {
    expect(infoFor([BARE, TALK], OPT)).toBe(TALK);
    expect(infoFor([BARE, TALK], "nope")).toBeUndefined();
    expect(infoFor(undefined, OPT)).toBeUndefined();
  });
});

describe("cardForPanel", () => {
  const card: Card = { key: "talk", word: "talk", us: "tɔk", uk: "", senses: [], phrases: [], examples: [] };

  it("prefers the batch card", () => {
    expect(cardForPanel(card, meaning, { optionInfo: [TALK], correctOption: OPT })).toBe(card);
  });

  it("builds a card from the correct option's info plus the server's phrases and example when the batch has none", () => {
    const built = cardForPanel(undefined, meaning, {
      optionInfo: [BARE, TALK], correctOption: OPT,
      phrases: [{ en: "talk about", zh: "谈论" }], example: { id: "e1", en: "We talk.", zh: "我们聊天。" },
    });
    expect(built).toMatchObject({ key: "talk", word: "talk", defsEn: TALK.defsEn, senses: TALK.defsZh });
    expect(built?.phrases).toEqual([{ en: "talk about", zh: "谈论" }]);
    expect(built?.examples).toEqual([{ id: "e1", en: "We talk.", zh: "我们聊天。" }]);
  });

  it("is null when there is neither a card nor info for the correct option", () => {
    expect(cardForPanel(undefined, meaning, { correctOption: OPT })).toBeNull();
    expect(cardForPanel(undefined, meaning, { optionInfo: [BARE], correctOption: OPT })).toBeNull();
    expect(cardForPanel(undefined, meaning, { optionInfo: [TALK], correctOption: null })).toBeNull();
  });
});
```
- [ ] **Step 2:** Run `cd web && yarn vitest run src/features/wordbook/option-view.test.ts` — expect FAIL(模块不存在)。
- [ ] **Step 3:** Write `option-view.ts`:
```ts
// 答后选项行与「学习内容」区的纯函数(计划 2026-10-13-review-after-answer R-A10 / R-A11)。释义行的取舍一律走 defView,这里不重复规则。
import { defView } from "./def-lang";
import { meaningLine } from "./word-card";
import type { AnswerResult, Card, DefLang, OptionInfo, QType, Question } from "./wordbook-api";

export interface OptionRowView {
  /** 英文单词(双击查它);null = 这行没有可查的词(旧服务端的 meaning 题 / cloze),按原来的样子显示选项原文 */
  word: string | null;
  /** 单词下面的小字(中文释义行 / 词性与中文);null = 不显示 */
  sub: string | null;
}

/** 按 `option` 文本匹配(不按下标:备忘可能来自另一次出题,宁可没信息也不错位)。 */
export const infoFor = (infos: readonly OptionInfo[] | undefined, option: string): OptionInfo | undefined =>
  infos?.find((i) => i.option === option);

const viewOf = (defLang: DefLang, info: OptionInfo, peek: boolean) =>
  defView(defLang, { senses: info.defsZh ?? [], defsEn: info.defsEn ?? [] }, peek);

/**
 * 一个选项答题后显示什么。meaning 题:单词 + (按 def_lang / 「中」开关)可能显示的中文行(就是服务端的释义行原文);
 * word 题:单词 + 小字「词性. 中文」,始终显示(spec D3,不受 def_lang 影响)。
 */
export function optionRowView(qtype: QType, option: string, info: OptionInfo | undefined, defLang: DefLang, peek: boolean): OptionRowView {
  if (qtype === "word") return { word: info?.word ?? option, sub: info ? meaningLine(info.defsZh ?? [], 40) || null : null };
  if (qtype === "meaning" && info) return { word: info.word, sub: viewOf(defLang, info, peek).showSenses ? option : null };
  return { word: null, sub: null };
}

/** 「中」开关有意义:meaning 题里,有任一选项在当前偏好下把中文藏起来了。 */
export const optionsCanPeek = (qtype: QType, defLang: DefLang, infos: readonly OptionInfo[] | undefined): boolean =>
  qtype === "meaning" && (infos ?? []).some((i) => viewOf(defLang, i, false).canPeek);

/** 「学习内容」区用的词卡:优先批次里的词卡;没有就用正确选项的 info + 服务端的 phrases / example 拼一张;都没有 → null。 */
export function cardForPanel(
  card: Card | undefined,
  question: Question,
  result: Pick<AnswerResult, "optionInfo" | "correctOption" | "phrases" | "example">,
): Card | null {
  if (card) return card;
  const info = result.correctOption === null ? undefined : infoFor(result.optionInfo, result.correctOption);
  if (!info) return null;
  return {
    key: question.key, word: info.word, us: "", uk: "", senses: info.defsZh ?? [], phrases: result.phrases ?? [],
    examples: result.example ? [result.example] : [], defsEn: info.defsEn ?? [],
  };
}
```
- [ ] **Step 4:** Run `cd web && yarn vitest run src/features/wordbook/option-view.test.ts && yarn web:typecheck` — expect PASS。
- [ ] **Step 5:** Commit `feat(web): pure helpers for the answered option rows and the study panel`。

## Task W5:`ChoiceQuestion` 答后渲染

**Files:** Replace `web/src/features/wordbook/choice-question.tsx`;Create `choice-question-after.test.tsx`。

- [ ] **Step 1(测试):** Write `web/src/features/wordbook/choice-question-after.test.tsx`:
```tsx
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import { ChoiceQuestion, type AfterAnswer, type ChoiceResult } from "./choice-question";
import type { OptionInfo, Question } from "./wordbook-api";

const OPT_TALK = "v. 说话；谈话；n. 交谈";
const meaning: Question = { key: "talk", qtype: "meaning", prompt: { word: "talk", us: "tɔk" }, options: [OPT_TALK, "n. 事故", "v. 放弃"], length: null };
const INFO: OptionInfo[] = [
  { option: OPT_TALK, word: "talk", defsZh: [{ pos: "v", text: "说话；谈话" }, { pos: "n", text: "交谈" }], defsEn: [{ pos: "v", text: "speak to someone" }] },
  { option: "n. 事故", word: "accident", defsZh: [{ pos: "n", text: "事故" }], defsEn: [{ pos: "n", text: "something bad that happens by chance" }] },
  { option: "v. 放弃", word: "abandon", defsZh: [{ pos: "vt", text: "放弃" }], defsEn: [] },
];
const wordQ: Question = { key: "talk", qtype: "word", prompt: { meaning: OPT_TALK }, options: ["accept", "talk", "stop"], length: null };
const WORD_INFO: OptionInfo[] = [
  { option: "accept", word: "accept", defsZh: [{ pos: "vt", text: "接受；承认" }], defsEn: [] },
  { option: "talk", word: "talk", defsZh: [{ pos: "v", text: "说话；谈话" }, { pos: "n", text: "交谈" }], defsEn: [] },
  { option: "stop", word: "stop", defsZh: [{ pos: "v", text: "停止" }], defsEn: [] },
];
const cloze: Question = { key: "carry", qtype: "cloze", prompt: { sentence: "He _____ it.", zh: "他搬它。" }, options: ["stop", "carry"], length: null };

const wrongPick: ChoiceResult = { choice: "n. 事故", correct: false, correctOption: OPT_TALK };
const after = (extra: Partial<AfterAnswer> = {}): AfterAnswer => ({ info: INFO, defLang: "en", peek: false, onPeek: vi.fn(), ...extra });
const view = (q: Question, result: ChoiceResult | null, a?: AfterAnswer) =>
  render(<ChoiceQuestion question={q} result={result} onAnswer={vi.fn()} onListen={vi.fn()} after={a} />);
const rows = () => screen.getAllByTestId("choice-option");
const wordOf = (row: HTMLElement) => within(row).getByTestId("option-word").textContent;
// 用 fireEvent 而不是 userEvent.dblClick:user-event 在 mousedown 时会自己改选区,会干扰「程序化选中」的断言
const doubleTap = (row: HTMLElement) => {
  fireEvent.click(row, { detail: 1 });
  fireEvent.click(row, { detail: 2 });
};

beforeEach(() => {
  localStorage.clear();
  void i18n.changeLanguage("zh-CN");
});
afterEach(() => {
  vi.restoreAllMocks();
  window.getSelection()?.removeAllRanges();
  void i18n.changeLanguage("en");
});

describe("ChoiceQuestion before the answer / without `after`", () => {
  it("keeps the options as buttons until there is a result", () => {
    view(meaning, null, after());
    expect(screen.getAllByRole("button").filter((b) => b.getAttribute("data-state"))).toHaveLength(3);
    expect(screen.queryByTestId("choice-option")).toBeNull();
    expect(screen.queryByTestId("double-tap-hint")).toBeNull();
    expect(screen.queryByTestId("option-peek")).toBeNull();
  });

  it("leaves the learn page / spot-check rendering alone: no `after` means disabled buttons after the answer", () => {
    view(meaning, wrongPick);
    const buttons = screen.getAllByRole("button").filter((b) => b.getAttribute("data-state"));
    expect(buttons).toHaveLength(3);
    expect(buttons.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    expect(screen.queryByTestId("choice-option")).toBeNull();
  });

  it("never changes cloze, even with `after`", () => {
    view(cloze, { choice: "stop", correct: false, correctOption: "carry" }, after({ info: undefined }));
    const buttons = screen.getAllByRole("button").filter((b) => b.getAttribute("data-state"));
    expect(buttons).toHaveLength(2);
    expect(buttons.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    expect(screen.queryByTestId("choice-option")).toBeNull();
  });
});

describe("ChoiceQuestion · meaning, after the answer (spec D2)", () => {
  it("shows the English word on every row, Chinese hidden under English-only, with the right state on each", () => {
    view(meaning, wrongPick, after());
    expect(rows().map(wordOf)).toEqual(["talk", "accident", "abandon"]);
    expect(rows().map((r) => r.getAttribute("data-state"))).toEqual(["correct", "wrong", "idle"]);
    expect(screen.queryByText("n. 事故")).toBeNull(); // 中文不直接显示
    expect(screen.queryByText(OPT_TALK)).toBeNull();
    expect(screen.getByText("v. 放弃")).toBeTruthy(); // 缺口词(没有英文释义)回退成中文
    expect(rows()[1].querySelector("s")).toBeNull(); // 现在显示的是单词,不划线
  });

  it("is not a disabled button: a div with touch-action manipulation and a selectable, lookup-ready word", () => {
    view(meaning, wrongPick, after());
    for (const row of rows()) {
      expect(row.tagName).toBe("DIV");
      expect(row.className).toMatch(/\btouch-manipulation\b/);
      expect(row).toHaveAttribute("role", "button");
      expect(row).toHaveAttribute("tabindex", "0");
      const word = within(row).getByTestId("option-word");
      expect(word).toHaveAttribute("data-lookup-context");
      expect(word).toHaveAttribute("lang", "en");
      expect(word.className).toMatch(/\bselect-text\b/);
    }
    expect(screen.queryAllByRole("button").filter((b) => b.tagName === "BUTTON" && (b as HTMLButtonElement).disabled)).toHaveLength(0);
  });

  it("offers the 中 switch when some option hid its Chinese, and shows the Chinese lines when peek is on", async () => {
    const onPeek = vi.fn();
    const { rerender } = view(meaning, wrongPick, after({ onPeek }));
    await userEvent.click(screen.getByTestId("option-peek"));
    expect(onPeek).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("option-peek")).toHaveAttribute("aria-pressed", "false");
    rerender(<ChoiceQuestion question={meaning} result={wrongPick} onAnswer={vi.fn()} onListen={vi.fn()} after={after({ onPeek, peek: true })} />);
    expect(screen.getByTestId("option-peek")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("n. 事故")).toBeTruthy();
    expect(screen.getByText(OPT_TALK)).toBeTruthy();
  });

  it("has no 中 switch under 'zh' / 'both' (Chinese is already there) or when nothing was hidden", () => {
    for (const defLang of ["zh", "both"] as const) {
      const { unmount } = view(meaning, wrongPick, after({ defLang }));
      expect(screen.queryByTestId("option-peek")).toBeNull();
      expect(screen.getByText("n. 事故")).toBeTruthy();
      unmount();
    }
    view(meaning, wrongPick, after({ info: [INFO[2]] }));
    expect(screen.queryByTestId("option-peek")).toBeNull();
  });

  it("matches info by option text, not position (a shuffled or partial list only loses the rows it cannot match)", () => {
    view(meaning, wrongPick, after({ info: [INFO[1], INFO[0]] }));
    expect(wordOf(rows()[0])).toBe("talk");
    expect(wordOf(rows()[1])).toBe("accident");
    expect(within(rows()[2]).queryByTestId("option-word")).toBeNull(); // 没信息的行:原样显示选项原文
    expect(rows()[2]).not.toHaveAttribute("role");
    expect(rows()[2]).toHaveTextContent("v. 放弃");
  });

  it("keeps the old look when the server sent no option info (old server / memo miss): option text, struck through when wrong", () => {
    view(meaning, wrongPick, after({ info: undefined }));
    expect(rows().map((r) => r.textContent?.replace(/正确答案|你选的/g, ""))).toEqual([expect.stringContaining(OPT_TALK), expect.stringContaining("n. 事故"), expect.stringContaining("v. 放弃")]);
    expect(rows()[1].querySelector("s")).not.toBeNull();
    expect(screen.queryByTestId("double-tap-hint")).toBeNull();
    expect(screen.queryByTestId("option-peek")).toBeNull();
    expect(rows().every((r) => !r.hasAttribute("role"))).toBe(true);
  });

  it("says the state in words for screen readers (sr-only) on the correct row and on the row you picked", () => {
    view(meaning, wrongPick, after());
    expect(rows()[0]).toHaveTextContent("正确答案");
    expect(rows()[1]).toHaveTextContent("你选的");
    expect(rows()[2]).not.toHaveTextContent("你选的");
  });
});

describe("ChoiceQuestion · word, after the answer (spec D3)", () => {
  const picked: ChoiceResult = { choice: "stop", correct: false, correctOption: "talk" };

  it("shows each word with a small Chinese line and part of speech, even under English-only", () => {
    view(wordQ, picked, after({ info: WORD_INFO }));
    expect(rows().map(wordOf)).toEqual(["accept", "talk", "stop"]);
    expect(rows()[1]).toHaveTextContent("v. 说话；谈话；n. 交谈");
    expect(rows()[0]).toHaveTextContent("vt. 接受；承认");
    expect(screen.queryByTestId("option-peek")).toBeNull();
    expect(rows().map((r) => r.getAttribute("data-state"))).toEqual(["idle", "correct", "wrong"]);
  });

  it("still lets you look a word up when there is no info (the option is the word)", () => {
    view(wordQ, picked, after({ info: undefined }));
    expect(rows().map(wordOf)).toEqual(["accept", "talk", "stop"]);
    expect(screen.getByTestId("double-tap-hint")).toBeTruthy();
  });
});

describe("ChoiceQuestion · double tap picks the word for the lookup bar (spec D4, R-A9)", () => {
  const selected = () => window.getSelection()?.toString() ?? "";

  it("selects the word of a row on a double tap (two clicks inside 300 ms)", () => {
    view(meaning, wrongPick, after());
    doubleTap(rows()[1]);
    expect(selected()).toBe("accident");
  });

  it("does nothing for a single tap or for two taps further apart than 300 ms", () => {
    const clock = vi.spyOn(performance, "now");
    view(meaning, wrongPick, after());
    clock.mockReturnValue(1000);
    fireEvent.click(rows()[1], { detail: 1 });
    expect(selected()).toBe("");
    clock.mockReturnValue(1500);
    fireEvent.click(rows()[1], { detail: 1 });
    expect(selected()).toBe("");
  });

  it("counts two taps inside the window only when they hit the same row", () => {
    const clock = vi.spyOn(performance, "now");
    view(meaning, wrongPick, after());
    clock.mockReturnValue(1000);
    fireEvent.click(rows()[0], { detail: 1 });
    clock.mockReturnValue(1100);
    fireEvent.click(rows()[1], { detail: 1 });
    expect(selected()).toBe("");
    clock.mockReturnValue(1200);
    fireEvent.click(rows()[1], { detail: 1 });
    expect(selected()).toBe("accident");
  });

  it("falls back to the native dblclick for a slow double click", () => {
    const clock = vi.spyOn(performance, "now");
    view(meaning, wrongPick, after());
    clock.mockReturnValue(1000);
    fireEvent.click(rows()[2], { detail: 1 });
    clock.mockReturnValue(1500);
    fireEvent.click(rows()[2], { detail: 2 });
    clock.mockReturnValue(1510);
    fireEvent.doubleClick(rows()[2]);
    expect(selected()).toBe("abandon");
  });

  it("looks up at once from the keyboard (Enter / Space) and from an assistive-technology click (detail 0)", () => {
    view(meaning, wrongPick, after());
    fireEvent.keyDown(rows()[0], { key: "Enter" });
    expect(selected()).toBe("talk");
    window.getSelection()?.removeAllRanges();
    fireEvent.keyDown(rows()[1], { key: " " });
    expect(selected()).toBe("accident");
    window.getSelection()?.removeAllRanges();
    fireEvent.click(rows()[2], { detail: 0 });
    expect(selected()).toBe("abandon");
  });

  it("does not override text the user selected by hand elsewhere", () => {
    view(meaning, wrongPick, after());
    const elsewhere = document.createElement("p");
    elsewhere.textContent = "some text";
    document.body.appendChild(elsewhere);
    const range = document.createRange();
    range.selectNodeContents(elsewhere);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    doubleTap(rows()[1]);
    expect(selected()).toBe("some text");
    elsewhere.remove();
  });

  it("does not react to a double tap before the answer (the options are still answer buttons)", async () => {
    const onAnswer = vi.fn();
    render(<ChoiceQuestion question={meaning} result={null} onAnswer={onAnswer} onListen={vi.fn()} after={after()} />);
    await userEvent.click(screen.getByRole("button", { name: /n\. 事故/ }));
    expect(onAnswer).toHaveBeenCalledWith("n. 事故");
    expect(selected()).toBe("");
  });
});

describe("ChoiceQuestion · one-time double-tap hint (R-A12)", () => {
  it("shows once after the first answered question and not on the next one", () => {
    const first = view(meaning, wrongPick, after());
    expect(screen.getByTestId("double-tap-hint")).toHaveTextContent("双击选项可查词");
    first.unmount();
    view(wordQ, { choice: "stop", correct: false, correctOption: "talk" }, after({ info: WORD_INFO }));
    expect(screen.queryByTestId("double-tap-hint")).toBeNull();
  });
});
```
  注意:选区相关用例依赖 jsdom 的 `Selection` 实现;第一次运行若有不稳定,以真实行为修测试,但不要删掉「不覆盖手选文字」「点另一行不算双击」这两条规则的覆盖。
- [ ] **Step 2:** Run `cd web && yarn vitest run src/features/wordbook/choice-question-after.test.tsx` — expect FAIL(`after` 属性与 `option-peek` 等都还不存在)。
- [ ] **Step 3:** Replace `web/src/features/wordbook/choice-question.tsx` 整个文件(Write)为:
```tsx
import { CheckIcon, CircleCheckIcon, XIcon } from "lucide-react";
import { useState, type KeyboardEvent, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@renderer/lib/utils";
import { SurfaceCard } from "~/components/surface-card";
import { selectWord } from "~/lib/select-word";
import { DEFAULT_DEF_LANG } from "./def-lang";
import { createTapTracker } from "./double-tap";
import { DoubleTapHint } from "./double-tap-hint";
import { infoFor, optionRowView, optionsCanPeek } from "./option-view";
import { ListenButton, type ListenProps } from "./word-card";
import type { AnswerResult, DefLang, OptionInfo, Question } from "./wordbook-api";
import "./locales";

/** 选择题作答结果:你选的项、是否正确、正确项文本(不知道时为 null)。 */
export interface ChoiceResult { choice: string; correct: boolean; correctOption: string | null }

/**
 * 答题后界面的开关(计划 2026-10-13-review-after-answer R-A7):只有复习页在答题后传它。传了(且不是 cloze)才把选项换成
 * 非禁用的普通容器 + 双击查词 + 一次性提示;没传(学新词页、抽查题)逐字节保持原来的禁用按钮。
 */
export interface AfterAnswer {
  /** `/answers` 的 optionInfo;老服务端 / 备忘取不到 / 非 meaning·word 题为 undefined */
  info?: OptionInfo[];
  defLang: DefLang;
  /** 「中」开关:本题临时显示中文(meaning 题,「仅英文」下才有意义);状态由复习页持有 */
  peek: boolean;
  onPeek: () => void;
}

const LETTERS = ["A", "B", "C", "D", "E", "F"];
const BLANK = "_____";
const now = () => performance.now();

/** 例句选词的题面:把 `_____` 画成下划线空(视觉稿 .mini .gap),读屏读「空」。 */
function ClozeSentence({ sentence }: { sentence: string }) {
  const { t } = useTranslation();
  const parts = sentence.split(BLANK);
  return (
    <p lang="en" className="mt-2 text-title font-medium leading-dialogue">
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < parts.length - 1 ? (
            <span role="img" aria-label={t("web.wordbook.quiz.blank")}
              className="mx-0.5 inline-block h-[1.1em] min-w-16 border-b-2 border-ink-3 align-[-3px]">
              <span className="sr-only">{BLANK}</span>
            </span>
          ) : null}
        </span>
      ))}
    </p>
  );
}

type OptionState = "idle" | "correct" | "wrong";

/**
 * 选择题(meaning / word / cloze;spec §6.4,视觉稿 05 / 05b):题面 + 4 个 ≥ 52px 选项。
 * 结果到达后:正确项绿底 + 勾,你选错的项中性删除线 + ×,其余不变;选项不再可点。
 * 复习页答题后传 `after`(spec 2026-10-13-review-after-answer §2.3):选项换成普通容器,显示英文单词(meaning 题中文默认藏起,
 * 「中」开关才看;word 题带小字中文与词性),双击 / 300 ms 内连点两次 → 程序化选中该选项的单词 → 全局选词操作条。
 */
export function ChoiceQuestion({ question, onAnswer, result, busy = false, onListen, listening, canListen, after }: ListenProps & {
  question: Question; onAnswer: (choice: string) => void; result: ChoiceResult | null; busy?: boolean; after?: AfterAnswer;
}) {
  const { t } = useTranslation();
  const { prompt, qtype } = question;
  const [tracker] = useState(() => createTapTracker());
  const answered = result !== null && after !== undefined && qtype !== "cloze";
  const defLang = after?.defLang ?? DEFAULT_DEF_LANG;
  const peek = after?.peek ?? false;
  const canPeek = answered && optionsCanPeek(qtype, defLang, after?.info);
  const tappable = answered && (qtype === "word" || (after?.info?.length ?? 0) > 0);

  const lookUp = (row: HTMLElement) => {
    const el = row.querySelector<HTMLElement>("[data-option-word]");
    if (el) selectWord(el);
  };
  // detail === 0:键盘 / 读屏「激活」产生的合成点击,一次就查;真实点按的 detail ≥ 1
  const onRowClick = (e: MouseEvent<HTMLElement>, id: string) => {
    if (e.detail === 0 || tracker.tap(id, now())) lookUp(e.currentTarget);
  };
  const onRowDoubleClick = (e: MouseEvent<HTMLElement>) => {
    if (tracker.dblclick(now())) lookUp(e.currentTarget);
  };
  const onRowKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    lookUp(e.currentTarget);
  };

  const eyebrow = <p className="text-meta font-semibold tracking-eyebrow text-ink-2">{t(`web.wordbook.quiz.kind.${qtype}`)}</p>;
  return (
    <SurfaceCard data-testid="choice-question" className="px-4 py-[18px]">
      {canPeek ? (
        <div className="flex min-h-[22px] items-center justify-between gap-2">
          {eyebrow}
          <button type="button" data-testid="option-peek" aria-pressed={peek} aria-label={t("web.wordbookDefs.peek.label")}
            onClick={() => after?.onPeek()}
            className={cn(
              "-my-2.5 -mr-2 inline-flex h-tap w-tap flex-none items-center justify-center rounded-button text-body font-semibold transition-colors duration-fast motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              peek ? "bg-surface-2 text-ink" : "text-ink-2",
            )}>
            <span aria-hidden>中</span>
          </button>
        </div>
      ) : eyebrow}
      {qtype === "meaning" ? (
        <>
          <div className="mt-2 flex items-center gap-2.5">
            {/* min-w-0 + overflow-wrap:anywhere:长词(SAT/TOEFL)能折行,不把 375px 屏撑出横向滚动(review m6) */}
            <span data-testid="question-word" lang="en"
              className={cn("min-w-0 font-semibold tracking-[-0.02em] [overflow-wrap:anywhere]", (prompt.word ?? "").length > 14 ? "text-[26px]" : "text-[30px]")}>
              {prompt.word}
            </span>
            <ListenButton id={`${question.key}:q`} text={prompt.word ?? ""} label={t("web.wordbook.word.listen.word")}
              onListen={onListen} listening={listening} canListen={canListen}
              className="h-tap w-tap flex-none justify-center rounded-full bg-blue-tint text-blue" />
          </div>
          {prompt.us ? <p lang="en" className="mt-0.5 text-sub text-ink-2">{prompt.us}</p> : null}
        </>
      ) : qtype === "word" ? (
        <p data-testid="question-meaning" className="mt-2 text-title font-medium leading-dialogue">{prompt.meaning}</p>
      ) : (
        <>
          <ClozeSentence sentence={prompt.sentence ?? ""} />
          {prompt.zh ? <p className="mt-1 text-sub text-ink-2">{prompt.zh}</p> : null}
        </>
      )}
      <ul className="mt-4 flex flex-col gap-2">
        {(question.options ?? []).map((option, i) => {
          const state: OptionState = !result ? "idle"
            : option === result.correctOption || (result.correct && option === result.choice) ? "correct"
            : option === result.choice ? "wrong" : "idle";
          const badge = (
            <span aria-hidden className={cn(
              "flex h-6 w-6 flex-none items-center justify-center rounded-[7px] text-meta font-semibold",
              state === "correct" ? "bg-green text-on-blue" : "bg-surface-2 text-ink-2",
            )}>
              {state === "correct" ? <CheckIcon className="h-[15px] w-[15px]" strokeWidth={3} /> : LETTERS[i]}
            </span>
          );
          const icon = state === "correct" ? <CircleCheckIcon aria-hidden className="h-5 w-5 flex-none" />
            : state === "wrong" ? <XIcon aria-hidden className="h-5 w-5 flex-none text-ink-2" /> : null;
          if (answered) {
            const row = optionRowView(qtype, option, infoFor(after?.info, option), defLang, peek);
            const lookupProps = row.word ? {
              role: "button" as const, tabIndex: 0,
              onClick: (e: MouseEvent<HTMLElement>) => onRowClick(e, String(i)), onDoubleClick: onRowDoubleClick, onKeyDown: onRowKeyDown,
            } : {};
            return (
              <li key={`${i}:${option}`}>
                <div data-testid="choice-option" data-state={state} {...lookupProps}
                  className={cn(
                    "flex min-h-[52px] w-full touch-manipulation items-center gap-2.5 rounded-button border-[0.5px] px-3.5 text-left text-body transition-colors duration-fast",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    state === "correct" ? "border-transparent bg-green-tint font-semibold text-green"
                      : state === "wrong" ? "border-hair bg-surface text-ink-2" : "border-hair bg-surface text-ink",
                    row.word && "cursor-pointer",
                  )}>
                  {badge}
                  <span className="min-w-0 flex-1 py-2">
                    {row.word ? (
                      <>
                        <span data-testid="option-word" data-option-word="" data-lookup-context lang="en"
                          className="select-text break-words font-semibold">{row.word}</span>
                        {row.sub ? <small className="mt-0.5 block select-text break-words text-sub font-normal text-ink-2">{row.sub}</small> : null}
                      </>
                    ) : state === "wrong" ? <s className="decoration-[1.5px]">{option}</s> : option}
                    {state !== "idle" ? (
                      <span className="sr-only">{" "}{t(state === "correct" ? "web.wordbookDefs.after.correct" : "web.wordbookDefs.after.yours")}</span>
                    ) : null}
                  </span>
                  {icon}
                </div>
              </li>
            );
          }
          return (
            <li key={`${i}:${option}`}>
              <button type="button" data-state={state} disabled={busy || result !== null} onClick={() => onAnswer(option)}
                lang={qtype === "meaning" ? undefined : "en"}
                className={cn(
                  "flex min-h-[52px] w-full items-center gap-2.5 rounded-button border-[0.5px] px-3.5 text-left text-body transition-colors duration-fast",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
                  state === "correct" ? "border-transparent bg-green-tint font-semibold text-green"
                    : state === "wrong" ? "border-hair bg-surface text-ink-2" : "border-hair bg-surface text-ink active:bg-surface-2",
                )}>
                {badge}
                <span className="min-w-0 flex-1 py-2">{state === "wrong" ? <s className="decoration-[1.5px]">{option}</s> : option}</span>
                {icon}
              </button>
            </li>
          );
        })}
      </ul>
      {tappable ? <DoubleTapHint /> : null}
    </SurfaceCard>
  );
}

/**
 * 选择题的正确项 = 服务端 `/answers` 的 `correct_option`(Ruling Z-e:与题目 options 里那一项逐字相同)。
 * 不在选项里或为 null 时返回 null:只标出用户选错的那项,不在客户端猜。
 */
export function correctOptionOf(question: Question, result: Pick<AnswerResult, "correctOption">): string | null {
  const option = result.correctOption;
  return option !== null && (question.options ?? []).includes(option) ? option : null;
}
```
- [ ] **Step 4:** Run `cd web && yarn vitest run src/features/wordbook/choice-question-after.test.tsx src/features/wordbook/choice-question.test.ts src/features/wordbook/learn-page.test.tsx src/features/wordbook/review-page.test.tsx src/features/wordbook/locales.test.ts && yarn web:typecheck` — expect PASS(learn-page / review-page 的既有测试证明「不传 `after`」逐字不变;`getByRole("status")` 仍唯一)。若某个既有测试因为 `import "./locales"` 的副作用变红,先读它的失败信息再修,不要删既有断言。
- [ ] **Step 5:** Commit `feat(web): answered choice options become tappable containers with double-tap lookup`。

## Task W6:「学习内容」区组件

**Files:** Create `after-answer-panel.tsx`、`after-answer-panel.test.tsx`(`web/src/features/wordbook/`)。

- [ ] **Step 1(测试):** Write `after-answer-panel.test.tsx`:
```tsx
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import { AfterAnswerPanel } from "./after-answer-panel";
import { card, defsCard } from "./test-fixtures";
import type { AnswerResult, Card, OptionInfo, Question } from "./wordbook-api";

const OPT = "v. 说话；谈话；n. 交谈";
const meaningQ: Question = { key: "talk", qtype: "meaning", prompt: { word: "talk" }, options: [OPT, "n. 事故"], length: null };
const wordQ: Question = { key: "talk", qtype: "word", prompt: { meaning: OPT }, options: ["talk", "stop"], length: null };
const TALK_INFO: OptionInfo = {
  option: OPT, word: "talk", defsZh: [{ pos: "v", text: "说话；谈话" }, { pos: "n", text: "交谈" }],
  defsEn: [{ pos: "v", text: "speak to someone" }],
};

const toCard = (raw: Record<string, unknown>): Card => ({
  key: String(raw.key), word: String(raw.word), us: String(raw.us), uk: String(raw.uk),
  senses: raw.senses as Card["senses"], phrases: raw.phrases as Card["phrases"], examples: raw.examples as Card["examples"],
  defsEn: (raw.defs_en as Card["defsEn"]) ?? undefined,
});
const talkCard = (extra: Record<string, unknown> = {}) => toCard(defsCard("talk", {
  senses: [{ pos: "v", text: "说话；谈话" }, { pos: "n", text: "交谈" }],
  defs_en: [{ pos: "v", text: "speak to someone" }, { pos: "n", text: "a conversation between people" }],
  phrases: [{ en: "talk about", zh: "谈论" }, { en: "talk to", zh: "对…说" }, { en: "talk back", zh: "顶嘴" }, { en: "talk down", zh: "贬低" }],
  ...extra,
}));

const result = (extra: Partial<AnswerResult> = {}): Pick<AnswerResult, "optionInfo" | "correctOption" | "phrases" | "example"> =>
  ({ correctOption: OPT, optionInfo: [TALK_INFO], ...extra });
const view = (q: Question, c: Card | undefined, extra: { defLang?: "en" | "zh" | "both"; peek?: boolean; result?: ReturnType<typeof result> } = {}) => {
  const onListen = vi.fn();
  render(<AfterAnswerPanel question={q} result={extra.result ?? result()} card={c} defLang={extra.defLang ?? "en"} peek={extra.peek ?? false}
    onListen={onListen} canListen />);
  return { onListen };
};

beforeEach(() => { localStorage.clear(); void i18n.changeLanguage("zh-CN"); });
afterEach(() => { void i18n.changeLanguage("en"); });

describe("AfterAnswerPanel · meaning (spec D1)", () => {
  it("shows the English definitions, at most three phrases and a read-aloud button; Chinese stays hidden under English-only", async () => {
    const { onListen } = view(meaningQ, talkCard());
    const panel = screen.getByTestId("after-answer-panel");
    expect(panel).toHaveTextContent("学习内容");
    expect(within(panel).getByTestId("word-defs-en")).toHaveTextContent("speak to someone");
    expect(panel).not.toHaveTextContent("说话；谈话");
    const phrases = within(panel).getAllByRole("listitem").filter((li) => li.closest("details"));
    expect(phrases).toHaveLength(3);
    expect(phrases[0]).toHaveTextContent("talk about 谈论");
    await userEvent.click(within(panel).getByRole("button", { name: "播放读音" }));
    expect(onListen).toHaveBeenCalledWith("talk:after", "talk", undefined);
  });

  it("shows Chinese instead when the preference is 'zh'", () => {
    view(meaningQ, talkCard(), { defLang: "zh" });
    expect(screen.getByTestId("after-answer-panel")).toHaveTextContent("说话；谈话");
    expect(screen.queryByTestId("word-defs-en")).toBeNull();
  });

  it("shows both lines under 'both'", () => {
    view(meaningQ, talkCard(), { defLang: "both" });
    expect(screen.getByTestId("after-answer-panel")).toHaveTextContent("说话；谈话");
    expect(screen.getByTestId("word-defs-en")).toBeTruthy();
  });

  it("brings the Chinese lines back with peek", () => {
    view(meaningQ, talkCard(), { peek: true });
    expect(screen.getByTestId("after-answer-panel")).toHaveTextContent("说话；谈话");
    expect(screen.getByTestId("word-defs-en")).toBeTruthy();
  });

  it("falls back to Chinese for a word that has no English definition", () => {
    view(meaningQ, talkCard({ defs_en: undefined }));
    expect(screen.getByTestId("after-answer-panel")).toHaveTextContent("说话；谈话");
    expect(screen.queryByTestId("word-defs-en")).toBeNull();
  });

  it("does not show the example sentence for meaning questions (spec D1)", () => {
    view(meaningQ, talkCard());
    expect(screen.getByTestId("after-answer-panel")).not.toHaveTextContent("They talk a lot.");
  });
});

describe("AfterAnswerPanel · word (spec D3)", () => {
  it("renders the correct word's card: senses or definitions per preference, example, folded phrases, listen buttons", () => {
    view(wordQ, talkCard(), { defLang: "both" });
    const wc = screen.getByTestId("word-card");
    expect(wc).toHaveTextContent("talk");
    expect(wc).toHaveTextContent("说话；谈话");
    expect(within(wc).getByTestId("word-defs-en")).toHaveTextContent("speak to someone");
    expect(wc).toHaveTextContent("They talk a lot.");
    expect(wc.querySelector("details")).not.toHaveAttribute("open");
    expect(wc).toHaveTextContent("学习内容");
    expect(within(wc).getAllByRole("button", { name: /朗读|播放/ }).length).toBeGreaterThan(0);
  });

  it("follows def_lang through the card's own 中 switch under English-only", () => {
    view(wordQ, talkCard(), { defLang: "en" });
    expect(screen.getByTestId("word-card")).not.toHaveTextContent("说话；谈话");
    expect(screen.getByTestId("def-peek")).toBeTruthy();
  });
});

describe("AfterAnswerPanel · no batch card (R-A11)", () => {
  it("builds the card from the correct option's info plus the server's phrases and example", () => {
    view(meaningQ, undefined, { result: result({ phrases: [{ en: "talk about", zh: "谈论" }], example: { id: "e", en: "We talk.", zh: "我们聊天。" } }) });
    const panel = screen.getByTestId("after-answer-panel");
    expect(panel).toHaveTextContent("speak to someone");
    expect(panel).toHaveTextContent("talk about");
  });

  it("renders nothing when there is neither a card nor info for the correct option", () => {
    view(meaningQ, undefined, { result: result({ optionInfo: undefined }) });
    expect(screen.queryByTestId("after-answer-panel")).toBeNull();
    expect(screen.queryByTestId("word-card")).toBeNull();
  });
});

describe("AfterAnswerPanel · plain card fixtures", () => {
  it("works with the shared test card (Chinese only, no English definition) too", () => {
    view(meaningQ, toCard(card("talk", { senses: [{ pos: "v", text: "说话" }] })));
    expect(screen.getByTestId("after-answer-panel")).toHaveTextContent("说话");
  });
});
```
  说明:朗读键的名称「播放读音」取自 `i18n/zh-CN.json` 的 `web.wordbook.word.listen.word`;`talkCard()` 的第一条英文释义是 `speak to someone`;`defsCard`(`test-fixtures.ts`)产出 snake_case 的服务端样例,`toCard` 把它转成网页的 `Card`(只在测试里用)。短语区在「学习内容」里是展开的 `<details open>`,所以数 `details` 里的 `li` 即短语条数。
- [ ] **Step 2:** Run `cd web && yarn vitest run src/features/wordbook/after-answer-panel.test.tsx` — expect FAIL(模块不存在)。
- [ ] **Step 3:** Write `web/src/features/wordbook/after-answer-panel.tsx`:
```tsx
import { useTranslation } from "react-i18next";
import { SurfaceCard } from "~/components/surface-card";
import { defView } from "./def-lang";
import { DefinitionsEn } from "./defs-en";
import { cardForPanel } from "./option-view";
import { PhrasesSection } from "./phrases-section";
import { ListenButton, WordCardView, posLabel, type ListenProps } from "./word-card";
import type { AnswerResult, Card, DefLang, Question } from "./wordbook-api";
import "./locales";

export const AFTER_MAX_PHRASES = 3;
const MAX_SENSES = 4;

/**
 * 复习页答题后题目下方的「学习内容」(spec 2026-10-13-review-after-answer D1 / D3,计划 R-A10 / R-A11):
 * - `meaning`(英→中):正确单词 + 英英释义(`defView`:偏好 zh 时改显中文,没有英文释义的词回退中文,「中」开关 `peek` 带回中文)
 *   + 短语(最多 3 条,展开)+ 朗读。不显示例句。
 * - `word`(中→英):正确单词的卡片 `WordCardView`(词性与释义、英英释义、例句、短语折叠、朗读;卡片自带「中」开关)。
 * 词卡优先取批次里的;没有时用答案里正确选项的 `optionInfo` + `phrases` + `example` 拼一张;都没有就什么也不渲染。
 */
export function AfterAnswerPanel({ question, result, card, defLang, peek, onListen, listening, canListen }: ListenProps & {
  question: Question;
  result: Pick<AnswerResult, "optionInfo" | "correctOption" | "phrases" | "example">;
  card: Card | undefined;
  defLang: DefLang;
  peek: boolean;
}) {
  const { t } = useTranslation();
  const shown = cardForPanel(card, question, result);
  if (!shown) return null;
  const listen = { onListen, listening, canListen };
  if (question.qtype === "word") {
    return <WordCardView card={shown} defLang={defLang} eyebrow={t("web.wordbookDefs.after.title")} className="mt-3" phrasesOpen={false} {...listen} />;
  }
  const view = defView(defLang, shown, peek);
  return (
    <SurfaceCard data-testid="after-answer-panel" className="mt-3 px-4 pb-3 pt-4">
      <div className="flex min-h-[22px] items-center justify-between gap-2">
        <p className="eyebrow">{t("web.wordbookDefs.after.title")}</p>
        <ListenButton id={`${shown.key}:after`} text={shown.word} label={t("web.wordbook.word.listen.word")} {...listen}
          className="-my-2.5 -mr-2 h-tap w-tap justify-center rounded-full bg-blue-tint text-blue" />
      </div>
      <p lang="en" className="mt-1 break-words text-title font-semibold">{shown.word}</p>
      {view.showSenses ? (
        <ul className="mt-2 flex flex-col gap-1.5">
          {shown.senses.slice(0, MAX_SENSES).map((s, i) => (
            <li key={i} className="text-body leading-dialogue">
              {s.pos ? <em className="mr-1.5 font-mono text-meta font-semibold not-italic text-ink-2">{posLabel(s.pos)}</em> : null}
              {s.text}
            </li>
          ))}
        </ul>
      ) : null}
      {view.showDefs ? <DefinitionsEn groups={view.groups} className={view.showSenses ? "mt-1.5" : "mt-2"} /> : null}
      <PhrasesSection phrases={shown.phrases.slice(0, AFTER_MAX_PHRASES)} mode />
    </SurfaceCard>
  );
}
```
- [ ] **Step 4:** Run `cd web && yarn vitest run src/features/wordbook/after-answer-panel.test.tsx src/features/wordbook/word-card-defs.test.tsx src/features/wordbook/word-card-legacy.test.tsx && yarn web:typecheck` — expect PASS(后两个证明没动词卡)。
- [ ] **Step 5:** Commit `feat(web): the after-answer study panel for review questions`。

## Task W7:复习页接线

**Files:** Modify `web/src/features/wordbook/review-page.tsx`;Create `review-after-answer.test.tsx`。

- [ ] **Step 1(测试):** Write `web/src/features/wordbook/review-after-answer.test.tsx`:
```tsx
import "fake-indexeddb/auto";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { resetServerAiConfigCache } from "~/api/server-config";
import { LookupLayer } from "~/features/lookup";
import i18n from "~/i18n";
import { createFetchMock, json, type RecordedCall } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { WordbookReviewPage } from "./review-page";
import { CONFIG, ENROLLED_TODAY, PLAN, card, defsCard } from "./test-fixtures";

vi.mock("~/features/chat/use-tts-player", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/features/chat/use-tts-player")>()),
  useTtsPlayer: () => ({ states: {}, play: vi.fn(), playQueue: vi.fn(), stop: vi.fn(), prime: vi.fn() }),
}));

const TTS = {
  "GET /api/config/gpt_providers": () => json({ enjoyai: { models: [] } }),
  "GET /api/config/default_gpt_preset": () => json({ configuration: {} }),
  "GET /api/config/tts_providers_v2": () => json({ enjoyai: { models: ["openai/tts-1"], voices: {} } }),
  "GET /api/config/default_tts_preset": () => json({ configuration: { tts: { model: "openai/tts-1", voice: "alloy" } } }),
};

const OPT_ACCEPT = "vt. 接受；承认";
const MEANING_Q = { key: "accept", qtype: "meaning", prompt: { word: "accept", us: "əkˈsɛpt" }, options: ["v. 放弃；抛弃", OPT_ACCEPT, "v. 携带；搬运", "v. 停止"], length: null };
const WORD_Q = { key: "carry", qtype: "word", prompt: { meaning: "v. 携带；搬运" }, options: ["stop", "carry", "go", "child"], length: null };
const CLOZE_Q = { key: "go", qtype: "cloze", prompt: { sentence: "I _____ home.", zh: "我回家。" }, options: ["go", "stop", "child", "carry"], length: null };
const BATCH = {
  book_id: "cet4", questions: [MEANING_Q, WORD_Q, CLOZE_Q],
  cards: [
    defsCard("accept", { senses: [{ pos: "vt", text: "接受；承认" }], defs_en: [{ pos: "v", text: "agree to take something offered" }], phrases: [{ en: "accept defeat", zh: "认输" }] }),
    defsCard("carry", { senses: [{ pos: "vt", text: "携带；搬运" }], defs_en: [{ pos: "v", text: "hold something and take it somewhere" }] }),
    card("go"),
  ],
};
const info = (option: string, word: string, zh: [string, string], en: string[] = []) => ({
  option, word, defs_zh: [{ pos: zh[0], text: zh[1] }], defs_en: en.map((text) => ({ pos: "v", text })),
});
const INFO: Record<string, unknown[]> = {
  accept: [
    info("v. 放弃；抛弃", "abandon", ["vt", "放弃；抛弃"], ["leave something or someone for good"]),
    info(OPT_ACCEPT, "accept", ["vt", "接受；承认"], ["agree to take something offered"]),
    info("v. 携带；搬运", "carry", ["vt", "携带；搬运"], ["hold something and take it somewhere"]),
    info("v. 停止", "stop", ["v", "停止"]),
  ],
  carry: [info("stop", "stop", ["v", "停止"]), info("carry", "carry", ["vt", "携带；搬运"], ["hold it"]), info("go", "go", ["v", "去"]), info("child", "child", ["n", "孩子"])],
};
const CORRECT: Record<string, string> = { accept: OPT_ACCEPT, carry: "carry", go: "go" };
let withInfo = true;

function answerRoute(call: RecordedCall) {
  const body = JSON.parse(String(call.body)) as { key: string; choice?: string };
  const ok = body.choice === CORRECT[body.key];
  return json({
    correct: ok, outcome: ok ? "correct" : "wrong", grade: ok ? "good" : "forgot", expected: body.key, correct_option: CORRECT[body.key], diff: null,
    item: { box: 2, due_at: "x" }, applied: true, rating: null, spot_check: false, check: null,
    ...(withInfo && INFO[body.key] ? { option_info: INFO[body.key], phrases: [{ en: `${body.key} on`, zh: "短语" }], example: { id: "e", en: `They ${body.key} a lot.`, zh: "例" } } : {}),
  });
}

function setup(config: Record<string, unknown> = CONFIG) {
  const mock = createFetchMock({
    ...TTS,
    "GET /api/wordbook/config": () => json(config),
    "GET /api/wordbook/today": () => json({ ...ENROLLED_TODAY, plan: { ...PLAN, review_due: 3, review_left: 3 } }),
    "POST /api/wordbook/review/batch": () => json(BATCH),
    "POST /api/wordbook/answers": answerRoute,
    "POST /api/dictionary/lookup": () => json({ hit: false }),
  });
  renderWithProviders(<><WordbookReviewPage /><LookupLayer /></>, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/wordbook/review" });
  return mock;
}

const rows = () => screen.getAllByTestId("choice-option");
const wordOf = (row: HTMLElement) => within(row).getByTestId("option-word").textContent;
async function startAndAnswer(user: ReturnType<typeof userEvent.setup>, optionName: RegExp) {
  await user.click(await screen.findByRole("button", { name: "开始复习 3" }));
  await user.click(await screen.findByRole("button", { name: optionName }));
  await screen.findAllByTestId("choice-option");
}

beforeEach(() => {
  withInfo = true;
  localStorage.clear();
  resetServerAiConfigCache();
  localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
  void i18n.changeLanguage("zh-CN");
});
afterEach(() => {
  vi.restoreAllMocks();
  window.getSelection()?.removeAllRanges();
  localStorage.removeItem("enjoy-web.settings");
  void i18n.changeLanguage("en");
});

describe("review page · after the answer (meaning)", () => {
  it("swaps the options to English words, hides Chinese, shows the study panel and the hint; the request body is unchanged", async () => {
    const user = userEvent.setup();
    const mock = setup();
    await startAndAnswer(user, /v\. 放弃；抛弃/);
    expect(rows().map(wordOf)).toEqual(["abandon", "accept", "carry", "stop"]);
    expect(rows().map((r) => r.getAttribute("data-state"))).toEqual(["wrong", "correct", "idle", "idle"]);
    expect(screen.queryByText("v. 放弃；抛弃")).toBeNull();
    expect(rows()[3]).toHaveTextContent("v. 停止"); // 没有英文释义的词回退成中文
    expect(screen.getByRole("status")).toHaveTextContent("正确答案是"); // 仍然只有一个 status
    const panel = screen.getByTestId("after-answer-panel");
    expect(panel).toHaveTextContent("agree to take something offered");
    expect(panel).toHaveTextContent("accept defeat");
    expect(panel).not.toHaveTextContent("接受；承认");
    expect(screen.getByTestId("double-tap-hint")).toHaveTextContent("双击选项可查词");
    const sent = JSON.parse(String(mock.calls.find((c) => c.url.pathname === "/api/wordbook/answers")?.body)) as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(["book_id", "choice", "key", "mode", "qtype", "tz_offset_minutes"]);
  });

  it("the 中 switch shows Chinese on the rows and in the panel, and resets for the next question", async () => {
    const user = userEvent.setup();
    setup();
    await startAndAnswer(user, /v\. 放弃；抛弃/);
    await user.click(screen.getByTestId("option-peek"));
    expect(rows()[0]).toHaveTextContent("v. 放弃；抛弃");
    expect(screen.getByTestId("after-answer-panel")).toHaveTextContent("接受；承认");
    await user.click(screen.getByRole("button", { name: "继续" }));
    await user.click(await screen.findByRole("button", { name: /carry/ }));
    await screen.findAllByTestId("choice-option");
    expect(screen.queryByTestId("option-peek")).toBeNull(); // word 题没有选项级的「中」
    expect(screen.queryByTestId("double-tap-hint")).toBeNull(); // 只提示一次
  });

  it("honours def_lang 'zh': Chinese on the rows, no switch, Chinese in the panel", async () => {
    const user = userEvent.setup();
    setup({ ...CONFIG, def_lang: "zh" });
    await startAndAnswer(user, /v\. 放弃；抛弃/);
    expect(rows()[0]).toHaveTextContent("v. 放弃；抛弃");
    expect(screen.queryByTestId("option-peek")).toBeNull();
    expect(screen.getByTestId("after-answer-panel")).toHaveTextContent("接受；承认");
    expect(screen.queryByTestId("word-defs-en")).toBeNull();
  });

  it("degrades to the old look plus a panel built from the batch card when the server sent no option info", async () => {
    withInfo = false;
    const user = userEvent.setup();
    setup();
    await startAndAnswer(user, /v\. 放弃；抛弃/);
    expect(rows()[0]).toHaveTextContent("v. 放弃；抛弃");
    expect(rows()[0].querySelector("s")).not.toBeNull();
    expect(screen.queryByTestId("option-word")).toBeNull();
    expect(screen.queryByTestId("double-tap-hint")).toBeNull();
    expect(screen.getByTestId("after-answer-panel")).toHaveTextContent("agree to take something offered");
  });
});

describe("review page · after the answer (word and cloze)", () => {
  it("shows words with Chinese and part of speech under the options and the correct word's card below", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole("button", { name: "开始复习 3" }));
    await user.click(await screen.findByRole("button", { name: /vt\. 接受；承认/ }));
    await user.click(await screen.findByRole("button", { name: "继续" }));
    await user.click(await screen.findByRole("button", { name: /carry/ }));
    await screen.findAllByTestId("choice-option");
    expect(rows().map(wordOf)).toEqual(["stop", "carry", "go", "child"]);
    expect(rows()[1]).toHaveTextContent("vt. 携带；搬运");
    const wc = screen.getByTestId("word-card");
    expect(wc).toHaveTextContent("carry");
    expect(wc).toHaveTextContent("hold something and take it somewhere");
  });

  it("leaves cloze exactly as it was: disabled option buttons, no panel", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole("button", { name: "开始复习 3" }));
    await user.click(await screen.findByRole("button", { name: /vt\. 接受；承认/ }));
    await user.click(await screen.findByRole("button", { name: "继续" }));
    await user.click(await screen.findByRole("button", { name: /carry/ }));
    await user.click(await screen.findByRole("button", { name: "继续" }));
    await user.click(await screen.findByRole("button", { name: /go/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /go/ })).toHaveAttribute("data-state", "correct"));
    expect(screen.queryByTestId("choice-option")).toBeNull();
    expect(screen.queryByTestId("after-answer-panel")).toBeNull();
    expect(screen.queryByTestId("word-card")).toBeNull();
  });
});

describe("review page · double tap opens the lookup bar", () => {
  it("selects the option's word and the global selection bar appears", async () => {
    const user = userEvent.setup();
    setup();
    await startAndAnswer(user, /v\. 放弃；抛弃/);
    fireEvent.click(rows()[2], { detail: 1 });
    fireEvent.click(rows()[2], { detail: 2 });
    expect(window.getSelection()?.toString()).toBe("carry");
    expect(await screen.findByTestId("lookup-bar")).toBeTruthy();
    expect(screen.getByTestId("lookup-trigger")).toBeTruthy();
  });
});
```
  说明:按钮名里的「开始复习 3」「继续」沿用 `review-page.test.tsx`;`getByRole("status")` 的文案「正确答案是」来自 `web.wordbook.quiz.wrong`(zh:`正确答案是 {{answer}}`)——**第一次运行时核对真实文案**。`await user.click(findByRole("button", {name: /carry/}))` 在第二题(word 题)里选的是选项 `carry`;若按钮名因字母徽标变成 `B carry`,正则仍匹配。LookupLayer 需要的 `fake-indexeddb/auto` 已在文件顶部导入。
- [ ] **Step 2:** Run `cd web && yarn vitest run src/features/wordbook/review-after-answer.test.tsx` — expect FAIL(复习页还没传 `after`)。
- [ ] **Step 3:** Edit `web/src/features/wordbook/review-page.tsx`(单行锚点):
  1. `import { ChoiceQuestion, correctOptionOf, type ChoiceResult } from "./choice-question";` → `import { ChoiceQuestion, correctOptionOf, type AfterAnswer, type ChoiceResult } from "./choice-question";`;并在 `import { FreeBrowse } from "./free-browse";` 这一行**之前**加 `import { AfterAnswerPanel } from "./after-answer-panel";`。
  2. 在 `  const [busy, setBusy] = useState(false);` 这一行**之后**加:
```tsx
  // 答题后「中」开关(meaning 题,计划 2026-10-13-review-after-answer R-A10):记的是正在偷看的题槽,换题 / 重出自动复位
  const [peekSlot, setPeekSlot] = useState<string | null>(null);
```
  3. 在 `  const choiceResult: ChoiceResult | null = answer && question` 这个声明的**整条语句之后**(它以 `    : null;` 结尾,紧接着是 `  return (`)加:
```tsx
  // 答题后界面只给 meaning / word 选择题(cloze 与抽查题不变);选项信息可能不存在(老服务端 / 备忘取不到),下游都按缺失处理
  const slot = question ? `${question.key}:${attempt}` : "";
  const afterQuestion = answer && choiceResult && question && (question.qtype === "meaning" || question.qtype === "word") ? question : null;
  const after: AfterAnswer | undefined = afterQuestion && answer
    ? { info: answer.result.optionInfo, defLang, peek: peekSlot === slot, onPeek: () => setPeekSlot((s) => (s === slot ? null : slot)) }
    : undefined;
```
  4. 把 `            onAnswer={(choice) => void send({ choice })} {...listen} />`(第二个 `ChoiceQuestion`,key 为 `${question.key}:${attempt}` 那个——**不是**抽查题里 `onAnswer={(choice) => void send({ rating: "know", choice })}` 那个)改为 `            onAnswer={(choice) => void send({ choice })} after={after} {...listen} />`。
  5. 在 `        {actionError ? <p role="alert" className="mt-2 text-sub text-ink">{actionError}</p> : null}` 这一行**之前**加:
```tsx
        {afterQuestion && answer ? (
          <AfterAnswerPanel question={afterQuestion} result={answer.result} card={batch?.cards[afterQuestion.key]} defLang={defLang}
            peek={peekSlot === slot} {...listen} />
        ) : null}
```
- [ ] **Step 4:** Run `cd web && yarn vitest run src/features/wordbook/review-after-answer.test.tsx src/features/wordbook/review-page.test.tsx src/features/wordbook/review-free.test.tsx src/features/wordbook/learn-page.test.tsx src/features/wordbook/choice-question-after.test.tsx src/architecture.test.ts && yarn web:typecheck` — expect PASS。`review-free.test.tsx`(自由复习)沿用同一页面,答案不带 option_info 时必须仍绿;若有用例断言答题后「选项是禁用按钮」,把它改成断言容器(`choice-option`)并说明,**不要**回退实现。
- [ ] **Step 5:** Commit `feat(web): review page shows the study panel and word options after an answer`。

## Task W8:文档与自检

**Files:** Modify `web/src/features/wordbook/CLAUDE.md`、`web/README.md`;(`web/src/lib/CLAUDE.md` 与 `server/app/wordbook/CLAUDE.md` 已在 W2 / S3 改过。)

- [ ] **Step 1:** Edit `web/src/features/wordbook/CLAUDE.md`:
  1. 在 What lives here 的 `- \`session-machine.ts\` (learn/review queue), ...` 那一条之后加:
     `- Review after-answer (spec \`2026-10-13-review-after-answer-and-library-alignment-design.md\` §2, plan \`2026-10-13-review-after-answer.md\`): \`option-view.ts\` (pure: per-option row view, 中 switch rule, panel card), \`after-answer-panel.tsx\` (study panel under the question), \`double-tap.ts\` (tap tracker), \`double-tap-pref.ts\` + \`double-tap-hint.tsx\` (one-time hint, device-local). \`ChoiceQuestion\` takes an optional \`after\` prop: only the review page passes it.`
  2. 在 Pitfalls 末尾加两条:
     `- \`ChoiceQuestion\` answered-state containers exist only when \`after\` is passed (review page, meaning / word). The learn page, the spot-check question and cloze keep disabled buttons (E2E selectors \`button[data-state="correct"]\` depend on it). Never put \`role="status"\` in the after-answer area (the result line is the only one).`
     `- \`optionInfo\` / \`phrases\` / \`example\` on \`AnswerResult\` are optional (old server, memo miss, other qtypes): match info by \`option\` text, never by index; render the old look when absent. Double-tap selects the word through \`~/lib/select-word\` (same contract as the library's \`selectWord\`); the word span carries \`data-lookup-context\` so the global lookup bar accepts the selection. Double-tap on a real iPhone is UNVERIFIED (see the device checklist).`
- [ ] **Step 2:** Edit `web/README.md`:在以 `- **每日目标面板**(计划 2026-10-11-wordbook-goals)` 开头的那一行**之前**加一条:
  `- **复习页答题后界面**(计划 2026-10-13-review-after-answer):选择题(看单词选中文 / 看中文选单词)答完后,选项换成英文单词——英→中题的错误项显示它对应的单词(对比辨析),正确项保持绿色,中文默认藏起、点题卡右上角的「中」才看;中→英题的每个选项显示单词 + 小字中文与词性;题目下方出「学习内容」(英→中:英英释义 + 最多 3 条短语 + 朗读;中→英:正确单词的卡片),释义行遵守「释义显示」偏好(仅中文时改显中文,没有英文释义的词回退中文)。**双击**(300 ms 内点两下)答后的某个选项会选中它的单词并弹出选词操作条(查词 · 朗读 · 加入生词本);第一次答题后在题下提示一次「双击选项可查词」,记在本机 \`enjoy-web.wordbook.prefs\`(\`doubleTapHintSeen\`,退出登录清除)。服务端 \`/api/wordbook/answers\` 对这两种选择题追加可选的 \`option_info\`(靠出题时的进程内备忘,重启 / 多 worker 取不到就省略,网页退回旧显示)、\`phrases\`、\`example\`。例句选词、学新词小测、快速回忆抽查不变。**未在真机验证**:iPhone Safari 上双击是否稳定触发程序化选中与操作条、\`touch-action: manipulation\` 是否消除双击缩放、操作条是否盖住底部 dock、VoiceOver 激活;清单见 \`docs/superpowers/plans/2026-10-13-review-after-answer-device-checklist.md\`。`
- [ ] **Step 3:** 自检(只读,不改代码):
  - `grep -rn "role=\"status\"" web/src/features/wordbook/after-answer-panel.tsx web/src/features/wordbook/double-tap-hint.tsx web/src/features/wordbook/choice-question.tsx` 应无输出。
  - `grep -rn "features/library" web/src/features/wordbook` 应无输出(分层)。
  - `grep -n "logging\|logger" server/app/wordbook/option_memo.py` 应无输出。
  - `git diff --stat` 里**不应**出现 `enjoy/`、`web/src/features/library/`、`server/app/library/`、`server/app/speech/`、`web/src/features/lookup/`。
- [ ] **Step 4:** Run `cd web && yarn vitest run src/features/wordbook src/lib src/architecture.test.ts && yarn web:typecheck`,再 `cd server && uv run pytest -q tests/test_wordbook_option_memo.py tests/test_wordbook_option_info.py tests/test_wordbook_contract.py tests/test_architecture.py` — 全绿后才勾选本计划的任务框(`docs/CLAUDE.md`:合并且测试通过才勾)。**不要**跑 `yarn web:build` 以外的全量与 E2E(用户要求时再跑;`yarn web:build` 只在用户要求时跑,主包体积本轮没有量过)。
- [ ] **Step 5:** Commit `docs: describe the review after-answer panel and its device-verification status`。

---

## 自检清单(执行者交付前对照)

1. 响应里 `option_info` 的键恒为 `option / word / defs_zh / defs_en`;`phrases` ≤ 3;`cloze` / 打字 / 自评 / 抽查答案没有这三个键。
2. 请求体没有新字段(`review-after-answer.test.tsx` 断言键集合)。
3. 没有任何日志调用提到词或选项(`test_the_module_is_not_a_logging_site`、`test_option_info_is_not_logged`)。
4. `ChoiceQuestion` 不传 `after` 时与改动前逐字相同的行为(`choice-question-after.test.tsx` 前三个用例 + `learn-page.test.tsx` + `review-page.test.tsx` 全绿)。
5. 复习页只有一个 `role="status"`。
6. 新文案只在 `locales/*.json`,`locales.test.ts` 绿。
7. 没有改 `enjoy/`、`features/library`、`features/lookup`、`speech`、`app/library`。

## UNVERIFIED(必须在交付说明里原样保留)

- iPhone Safari(标签页与主屏 PWA)上:双击选项是否稳定触发 `selectAllChildren` 与操作条;`touch-action: manipulation` 是否让双击不缩放;`role="button"` 的 div 里的文字能否被程序化选中;操作条(`absolute bottom-[4.5rem]`)是否盖住复习页底部的 dock(继续键);VoiceOver 的激活(合成点击 `detail === 0` 的假设)。
- 真实词书里干扰项的词面与英文释义覆盖(约 135 个缺口词会回退中文);真实数据下 `meaning_line` 被截断到 24 字时选项原文与词的对应(备忘按原文,不受截断影响,但没在真实数据上跑过)。
- 多 worker / 重启 / LRU 淘汰时 `option_info` 缺失的体验(单测只模拟了 `clear()`)。
- 主包体积(`yarn web:build` 未运行)。三个 E2E 规格未运行(未改动,依赖「学新词小测仍是按钮」这一事实)。

## Addendum (2026-10-14)

计划 `2026-10-14-review-bilingual-longpress.md` 覆盖本计划的以下裁定:**R-A9**(双击)→ 长按 R-L1–R-L5,`double-tap*.ts(x)` 已删除;**R-A10** 中「meaning 题选项行按 `defView` 藏中文、题卡「中」开关」→ R-Z1(选项行永远双语)与 R-Z2(「中文」按钮移到「学习内容」区,`option-peek` 删除);**R-A12**(双击提示)→ R-L6(长按提示,新字段 `longPressHintSeen`)。其余裁定不变。真机清单中 A、B 两节(双击)作废,以新计划的「真机清单」为准。
