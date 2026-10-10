# 背单词 v2 · 认识 / 模糊 / 不认识 与「快速回忆」— 设计文档

- 日期:2026-10-11 · 状态:产品负责人已确认交互(本文把它落成规则)
- 范围:`server/app/wordbook/`(新 `recall.py`,`quiz.py` 题型,`service.py` 学新词/复习/作答段落,`store.py` 追加两个查询与一个写入)、`server/app/routers/wordbook.py`(请求模型加字段)、`server/app/core/{config,settings_registry}.py`(4 个设置)、`web/src/features/wordbook/`(学新词、词卡、会话机、小结、复习页,新文件 `recall-*.tsx`)
- 实施计划:`docs/superpowers/plans/2026-10-11-wordbook-recall.md` · 视觉稿:`docs/superpowers/design/wordbook-recall-v1/mockup.html`
- 前置:`2026-10-10-wordbook-design.md`(下称「v1 spec」)§6.1 盒子映射、§6.3 学新词、§6.4 题型、§7 评审修订、§8 段位;`docs/superpowers/design/redesign-v3/design-notes.md`
- 并行:另两份计划同时在写(B = 目标/设置面板,C = 学习联动)。本功能**不新增迁移**(见 §9),不改首页、选书页、`plan.py`,不碰跨模块挂钩点。

---

## 0. 一页摘要

- **学新词**:新词卡只显示词头、音标和朗读键,中文释义被一块**遮罩**盖住(「点按显示释义」);下面三个按钮 **认识 / 模糊 / 不认识**。点遮罩 = 偷看,之后再点「认识」按「模糊」算。
- **盒子由服务端决定**(客户端只报 `rating` + `revealed_before` + `elapsed_ms`):认识(没偷看)→ **盒 2**(4 天,第 3 级);模糊 → **盒 1**(2 天,第 2 级);不认识 → **盒 0**(1 天,第 1 级);同一个词**连续两次「模糊」= 不认识**。
- **抽查**:没偷看的「认识」按比例(默认 33%,设置 0–100)被抽中,在本轮小测里出一道选释义;抽中的词先记盒 1,**答对才升到盒 2**,答错降到盒 0。点得太快(< 1 秒)的「认识」必抽。
- **本轮小测**:模糊的词排最前;不认识的词出现**两次**(选释义 + 看释义选词);抽中的认识词一次;没抽中的认识词不考。小测答错 → 当天该词回到盒 0;不改 `reps`、不产生段位事件。
- **复习新题型「快速回忆」**(`recall`):只显示词头,三个同样的自评按钮 → 翻面确认释义与例句。到期词:认识 → good、模糊 → hard、不认识 → forgot;认识按同一比例被抽查(先答一道选释义才写盒子)。从盒 3 升「已掌握」的那次复习**不出快速回忆**,必须是客观题。设置可关(默认开)。
- **防刷**:原有上限全部保留(每日新词、只学在学的书、每词每人只记一次 `learn`、每日作答 3,000、段位点每日 60 共享上限、`known` 只用于新词);每条新规则都在服务端、确定性;抽查用服务端私有的选书种子做哈希,客户端预测不了。
- **API**:`/answers` 增加 `qtype:"recall"`、`rating`、`revealed_before`、`elapsed_ms`;响应增加 `rating`、`spot_check`、`check`;`/learn/batch` 增加 `drill`;`/review/batch` 增加 `recall`(客户端声明支持);`/config` 增加 `learn:{autoplay, show_example}`。全部**追加字段**,旧客户端行为不变。

## 1. 目标、非目标、原则

**目标**
1. 学新词更快:认识的词一眼过,不认识的词多见一次,时间花在不熟的词上。
2. 复习多一种低成本题型,适合手机上碎片时间。
3. 自评不能变成刷「已掌握」或段位点的捷径。

**非目标**:改 6 盒间隔(仍是 1/2/4/7/15/30 天);引入 FSRS;用户级的个人设置面板(B 计划的范围,本功能只有管理端默认值);离线;发音评测。

**原则**
- 盒子、抽查、连续模糊、段位事件全部由服务端按确定性规则决定;客户端上报的只有「按了哪个键、按之前是否偷看、用了多久」。
- 只追加字段,不改已有字段的含义;旧网页缓存(PWA 服务工作线程可能还是旧版本)照常能学、能复习。
- 一色一义(redesign-v3):认识 = 蓝色主按钮;模糊 = 琥珀(提示/接近);不认识 = 中性;正确 = 绿;错误不用红。

## 2. 盒子编号对照(实测代码)

`app/services/vocabulary.py`:`INTERVAL_DAYS = (1, 2, 4, 7, 15, 30)`,**下标 = 盒子号**。

| 产品说法 | 盒子号 | 间隔 | v1 已有用法 |
|---|---:|---:|---|
| 第 1 级 | 0 | 1 天 | 新词小测后、`forgot` |
| 第 2 级 | 1 | 2 天 | — |
| **第 3 级(「高盒」)** | **2** | **4 天** | v1「我认识」(`KNOWN_BOX = 2`) |
| 第 4 级 | 3 | 7 天 | — |
| 已掌握 | 4、5 | 15 / 30 天 | `MASTERED_BOX = 4`(R-W6) |

所以「认识 → 第 3 级」= 盒 2,与 v1「我认识」完全一致;本功能**不改**任何盒子号的含义。

## 3. 学新词流程

### 3.1 词卡(遮罩态)

- 顶部:眉题「新词 2 / 5 · 四级」;词头(34px);美 / 英音标各一个 44px 朗读键(与 v1 相同)。
- 遮罩:一块与释义区同高的 `surface-2` 卡,中间「点按显示释义」+ 眼睛图标,副文字「先在心里想一想」。它是**真正的按钮**(`<button aria-expanded="false" aria-controls="…">`),高 ≥ 96px;**遮罩时释义、词性、例句、短语不在 DOM 里**(读屏和测试都拿不到,不靠模糊或透明度遮挡)。
- 不支持悬停显示、长按显示;只有点按(或键盘 Enter/Space)。
- 底部操作条(玻璃 dock)三个等宽按钮:**不认识**(次按钮,中性)/ **模糊**(次按钮,琥珀图标)/ **认识**(主按钮,蓝)。
- 偷看后:遮罩换成释义;按钮不变,条上方出现一行提示「已看过释义:点『认识』会记为『模糊』」(`aria-describedby` 关联到「认识」键)。

### 3.2 自评之后

| 按键 | 服务端结果(`rating`) | 盒子 | 卡片 | 声音 |
|---|---|---|---|---|
| 认识(没偷看) | `know`;按比例 `spot_check` | 2(抽中先 1) | 翻开释义 + 例句,顶部徽标「认识」或「认识 · 本轮抽查」 | 设置「自动朗读」开时朗读词头 |
| 认识(偷看过) | `fuzzy` | 1 | 同上,徽标「模糊」 | 同上 |
| 模糊 | `fuzzy`(连续第二次 → `unknown`) | 1(或 0) | 自动翻开释义 + 例句 | 同上 |
| 不认识 | `unknown` | 0 | 自动翻开释义 + 例句 | **总是**朗读词头(TTS 可用时),不受自动朗读设置影响 |

- 翻开后的操作条:「下一个」(主按钮,获得焦点);当评级是认识时左边多一个「记错了」(次按钮)→ 当天降级为不认识(§5.4)。
- 一张卡只能自评一次;请求失败时按钮恢复可点,遮罩状态不变,错误文字在卡下方 `role="alert"`。
- 一轮 5 张卡评完 → 本轮小测(§3.3);如果小测为空(全是没抽中的认识)直接进入小结。

### 3.3 本轮小测(会话机排队)

排队顺序(确定性,同评级内按词卡顺序):
1. 模糊的词:选释义(`meaning`)
2. 不认识的词:选释义
3. 被抽中的认识词:选释义,眉题「抽查 · 你标了『认识』」
4. 不认识的词第二次:看释义选词(`word`,来自 `/learn/batch` 新字段 `drill`),眉题「再认一次」

答错的题沿用 v1 规则回到队尾再测(每题最多 2 次);服务端只按**该词当天第一次**写盒(后续都是练习)。答错后显示词卡摘要(v1 `WordRecap`)。

### 3.4 小结

在 v1 小结(正确率环、统计卡、需要再看看的词、段位点估算)上加一行「认识 3 · 模糊 1 · 不认识 1」和「抽查 1 · 通过 1」(有抽查时)。「一次答对」= 没抽中的认识词 + 所有小测题都一次答对的词。段位点估算 = 本轮新学的词数(每词 1 点,与 v1 相同,标「估算」)。

## 4. 复习:「快速回忆」题型(`recall`)

### 4.1 何时出题

- 出题条件:管理端 `wordbook_recall_enabled` 开 **且** 请求声明 `recall: true`(旧客户端不声明 → 永远不出) **且** 盒子 ∈ {1, 2, 4, 5} **且** `sha256("recall:{user_id}:{key}:{reps}")[:4] % 100 < 40`(`quiz.RECALL_SHARE_PCT`)。命中时这道题就是快速回忆,否则按 v1 的 `pick_qtype` 选题。快速回忆的判定用**另一条哈希**,不进 v1 的候选集合,所以 v1 的选题结果逐项不变(trial 实测:v1 全部复习测试不改即通过)。
- **盒 3 不出**:盒 3 答 good 就进入「已掌握」(盒 4),这一步必须是客观题(选择 / 拼写 / 听写)。盒 0(刚忘的词)也不出。
- 到期复习的题型校验(v1 review m2)扩展为:v1 允许的题型,外加「设置开且这次命中快速回忆」时的 `recall`。客户端因此最多在「快速回忆」和「v1 客观题」之间二选一 —— 选客观题只会更难,不是捷径。

### 4.2 交互

- **正面**:眉题「快速回忆 · 3 / 20」,词头大字、音标与朗读键,提示「想起它的意思了吗?」;底部同样三个按钮。复习里没有遮罩可点(没有偷看路径),`revealed_before` 恒为 false。
- 按「认识」:
  - 服务端未抽中 → 直接写 good;卡片翻面(释义、词性、例句),徽标「认识」,左边「记错了」,右边「继续」。
  - 服务端抽中 → 响应 `outcome:"pending"` + `check`(一道选释义题,干扰项同书),**不写盒子**;页面原地显示该题(眉题「抽查:选出它的意思」,说明「你标了『认识』,答对才算数」);作答后按结果写 good / forgot,再翻面。
- 按「模糊」/「不认识」:立即写 hard / forgot,翻面。
- 翻面动画:`prefers-reduced-motion: no-preference` 下 180ms `rotateY`;减少动态时直接切换(淡入 120ms 也不做)。
- 「记错了」:把这次改成不认识。实现上是对**刚复习过、尚未到期**的词再交一次 `rating:"unknown"` → 走 v1 的 `apply_lapse`(回盒 0、明天、不加 reps、不产生段位事件)。已经产生的那一次 `vocab_review` 段位点不收回(受每日上限约束,见 §7 风险)。
- 答错(非认识)的词照 v1 回到队尾,再出现时仍是快速回忆;第二次再按「模糊」= 连续模糊 = 不认识(未到期 → `apply_lapse`)。

## 5. 服务端规则(确定性,全部在 `recall.py` + `service.py`)

### 5.1 有效评级

```
effective = rating
if rating == know and revealed_before: effective = fuzzy          # 偷看后认识 = 模糊
if effective == fuzzy and previous == fuzzy: effective = unknown  # 连续两次模糊 = 不认识
```
`previous` = 该用户该词**最近一条**自评事件(`wordbook_events.qtype = 'recall'`,任何书、任何一天)的有效评级(`know_chk` 视为 `know`)。连续两次模糊被记为 `unknown` 后,下一次模糊不再与它连续(「两次一组」)。

### 5.2 抽查判定

```
spot_hit = pct >= 100 or (pct > 0 and sha256("spot:{seed}:{user_id}:{key}:{reps}")[:4] % 100 < pct)
needs_check = effective == know and pct > 0 and (spot_hit or (elapsed_ms is not None and elapsed_ms < 1000))
```
- `pct` = `wordbook_spot_check_pct`(默认 33);`seed` = 该书选书记录的 `seed`(服务端私有,不在任何响应里),所以客户端无法预先算出哪些词会被抽中。
- 学新词 `reps = 0`;复习用该行当前 `reps`(同一次复习结果稳定,下一次复习重新抽)。
- `pct = 0` 关闭全部抽查(含「太快必抽」)。`elapsed_ms` 是客户端计时,只会让检查变多,不会让检查变少。

### 5.3 学新词(该词还没有行,`mode = learn`)

前置校验与 v1 相同:当前在学的书(409)、`new_left > 0`(429)、每日作答上限(429)。然后:

| 有效评级 | needs_check | 建行盒子 / 到期 | 事件 `outcome` | 响应 |
|---|---|---|---|---|
| know | 否 | 2 / +4 天 | `know` | `rating:"know", spot_check:false` |
| know | 是 | **1 / +2 天**(待抽查) | `know_chk` | `rating:"know", spot_check:true` |
| fuzzy | — | 1 / +2 天 | `fuzzy` | `rating:"fuzzy"` |
| unknown | — | 0 / +1 天 | `unknown` | `rating:"unknown"` |

事件 `kind` 与 v1 相同:该用户第一次学这个词 → `learn`(计入今日新词、产生 `word_learned`),否则 `practice`;`qtype = 'recall'`;cursor 照 v1 前进。

### 5.4 当天新词的后续作答(行已存在、`reps = 0`、当天有该词的自评事件)

| 请求 | 规则 | 写入 |
|---|---|---|
| 小测选择题(`meaning`/`word`,`mode=learn`)答错 | 盒 > 0 → 盒 0 / +1 天 | `set_learn_box`(条件 `reps = 0 且 box = 读到的值`;`lapses + 1`) |
| 小测答对,当天自评 `know_chk` 且盒 = 1 | 升盒 2 / +4 天(抽查通过) | 同上(不加 lapses) |
| 小测答对,其他 | 不改 | — |
| 再次自评(「记错了」等) | **只降不升**:目标盒 < 当前盒才写 | 同上 |

全部记 `practice` 事件(不产生段位点),**不加 `reps`、不写 `last_reviewed_at`**,所以不会产生 `vocab_review`(保持 v1 review B1)。行存在但不满足条件(例如从生词本加入的词、昨天学的词)→ 只记 `practice`,不改盒,与 v1 相同。

### 5.5 复习快速回忆(`mode = review`,行存在)

| 有效评级 | 到期 | 写入 | 事件 |
|---|---|---|---|
| know,未带 `choice`,needs_check | 是 | **不写**;响应 `outcome:"pending"`、`check` = 选释义题 | 无(只扣作答次数) |
| know,带 `choice` | 是 | 按选择题判:对 → good,错 → forgot(`apply_review`) | `review` / `know` 或 `unknown` |
| know,不需要抽查 | 是 | good | `review` / `know` |
| fuzzy | 是 | hard | `review` / `fuzzy` |
| unknown(含连续模糊) | 是 | forgot | `review` / `unknown` |
| know / fuzzy | 否 | 不改(R-W5) | `practice` |
| unknown(含连续模糊、「记错了」) | 否 | `apply_lapse`(盒 0 已是忘了则不写) | `practice` / `unknown` |

`apply_review` 的乐观条件 `reps == seen_reps` 不变:连点、并发的第二次命中 0 行 → `applied:false`。

### 5.6 兼容

- `known: true`(v1 客户端)= `qtype:"recall", rating:"know", revealed_before:false, elapsed_ms:null` 的别名,同样受抽查规则约束(v1 客户端不考认识词 → 抽中的词停在盒 1,比 v1 更保守)。仍然只能 `mode=learn`(422 `Known is only for new words`)。响应 `outcome` 由 `known` 改为 `know`(v1 网页不读这个值)。
- v1 学新词路径(小测选择题直接建行、盒 0)保留,旧客户端照常。
- `qtype:"recall"` 缺 `rating` → 422 `Rating is required`。

## 6. 段位点与事件(每种结果产生什么)

| 场景 | 盒子 | `wordbook_events` | 段位(`xp_events`) |
|---|---|---|---|
| 新词任何自评(第一次学该词) | 见 §5.3 | `learn` / 有效评级 | `word_learned` +1(计入每日 60 上限) |
| 新词自评(删除后重学) | 见 §5.3 | `practice` | 无 |
| 抽查通过 / 失败、小测答错、记错了(当天新词) | §5.4 | `practice` | 无 |
| 复习快速回忆,到期且写入成功 | good / hard / forgot | `review` | `vocab_review` +1(`reps` +1,与其它题型相同) |
| 复习抽查待答(pending) | 不写 | 无 | 无 |
| 复习未到期的任何自评 | 不改或 `apply_lapse` | `practice` | 无(不加 `reps`) |

- 每日新词数(`daily_new`)限制 `learn` 事件;每词每人只记一次 `learn`;作答 3,000/天;段位点每日共享上限 60;以上都不变。
- 快速回忆和其它题型的段位点相同(每次到期复习 1 点),所以自评**不比做题多得分**;它省下的只是时间。
- 「已掌握」只能通过客观题从盒 3 升到盒 4(§4.1),自评最多把词推到盒 3。

## 7. 设置(管理端设置注册表,组「背单词」,热生效)

| 键 | 类型 / 默认 | 说明 |
|---|---|---|
| `wordbook_spot_check_pct` | int / 33(0–100) | 「认识」抽查比例(%);0 = 不抽查(含太快必抽) |
| `wordbook_recall_enabled` | bool / true | 复习题型「快速回忆」;关闭后不再出题,进行中的快速回忆作答返回 422 `Question type mismatch` |
| `wordbook_autoplay` | bool / true | 新词卡出现、复习翻面时自动朗读词头(「不认识」总是朗读) |
| `wordbook_show_example` | bool / true | 翻开后显示例句 |

`/api/wordbook/config` 追加 `learn: {autoplay, show_example}`(抽查比例与快速回忆开关不下发:都由服务端执行)。用户级覆盖不在本期(B 计划的设置面板可以以后接)。

## 8. 网页

### 8.1 文件

| 文件 | 变化 |
|---|---|
| `session-machine.ts` | 追加:`Rating`、卡片 reducer(`startCard`/`cardReducer`/`ratingPayload`)、`planLearnQuiz`(本轮小测排队)、`slotId`/`slotKey`、`learnTally`(小结计数)。原有导出不变 |
| `word-card.tsx` | `WordCardView` 追加可选属性 `covered`、`onReveal`、`showExample`、`badge`;不传时与 v1 完全相同 |
| `recall-cover.tsx`(新) | 遮罩按钮 |
| `recall-rating-bar.tsx`(新) | 三个自评按钮的操作条(学新词与复习共用) |
| `recall-card.tsx`(新) | 复习快速回忆卡(正面 / 抽查 / 背面) |
| `learn-page.tsx` | 新流程:遮罩词卡 → 自评 → 翻开 → 下一个 → 本轮小测 → 小结 |
| `review-page.tsx` | `qtype === "recall"` 分支;`reviewBatch(api, 20, { recall: true })` |
| `session-summary.tsx` | `SessionStats` 追加可选 `ratings`、`checks` |
| `wordbook-api.ts` | 类型与函数只追加(§9.2) |
| `i18n/{zh-CN,en}.json` | 新键只在 `web.wordbook.learn.*`、`web.wordbook.recall.*` 下 |

### 8.2 无障碍

- 遮罩:`<button aria-expanded aria-controls>`,标签「显示释义」;展开后焦点留在原位(遮罩被释义替换时把焦点移到释义区标题,`tabIndex=-1`)。
- 三个自评键:各自完整文字标签(不只靠颜色或图标),高 48px;偷看提示通过 `aria-describedby` 关联到「认识」。
- 自评结果:`role="status" aria-live="polite"` 只播报一次「已记为模糊」等;抽查题沿用 v1 选择题的播报。
- 翻面后焦点移到「下一个 / 继续」(v1 review m7 的做法)。
- 键盘:Tab 顺序 = 朗读键 → 遮罩 → 不认识 → 模糊 → 认识;不加单键快捷键(移动端优先,避免和读屏冲突)。
- 对比度:模糊键的琥珀只用在图标和 1px 边,文字为 `ink`;深色表按 redesign-v3。

### 8.3 动效、深色、平台

- 减少动态:遮罩展开、翻面、徽标出现都只在 `prefers-reduced-motion: no-preference` 下做 150–200ms 变换;否则直接切换。
- 深色:遮罩 `surface-2` 上的文字用 `ink-2`(≥ 4.5:1);主按钮深色下文字 `#0F1013`(与 v1 相同)。
- iOS:声音必须在用户手势里解锁 —— 学新词页在第一次点遮罩 / 自评时调用 `speaker.prime()`;第一张卡出现时还没有手势,自动朗读从「第一次点击之后」开始。PWA 独立窗口与 Safari 都要验证。
- 安卓:三个按钮在 360px 宽下每个 ≥ 104px;返回键离开时已评的词已经入库(与 v1 一样,中途退出不丢)。
- 不用振动(iOS 不支持,行为不一致);不做双击放大(按钮已 ≥ 44px)。

### 8.4 需要真机确认

| 项 | 设备 | 原因 |
|---|---|---|
| 自动朗读在第一次点击后可用、「不认识」点击后立即发声 | iPhone Safari + 主屏 PWA | 手势解锁与 TTS 异步取音频的时序只有真机准 |
| 翻面动画不卡、玻璃 dock 不闪 | 中低端安卓 Chrome | backdrop-filter + 3D 变换 |
| VoiceOver / TalkBack 读出「显示释义,已折叠」并能展开 | iOS + 安卓 | `aria-expanded` 的播报各家不同 |
| 三键 dock 与底部安全区、Tab 栏不重叠 | iPhone 有 Home 条机型 | `env(safe-area-inset-bottom)` |
| 深色下遮罩与卡片可区分 | 两平台深色模式 | 低对比层次 |

未在真机验证前,`docs/superpowers/plans/e2e-results.md` 标「未验证」。

## 9. API 变化(只追加)

### 9.1 服务端

- **`POST /answers`** 请求追加:`qtype` 可取 `"recall"`;`rating?: "know"|"fuzzy"|"unknown"`;`revealed_before?: bool = false`;`elapsed_ms?: int (0–600000)`。响应追加:`rating: "know"|"fuzzy"|"unknown"|null`(有效评级,非自评题为 null)、`spot_check: bool`(学新词:本轮要抽查)、`check: QuestionOut|null`(复习:先答这道题);`outcome` 新取值 `know`/`fuzzy`/`unknown`/`pending`;`grade` 在 `pending` 时为 null。
- **`POST /learn/batch`** 响应追加 `drill: [QuestionOut]`(每词一道 `word` 题,随机源 `(user_id, key, 1)`,与 `quiz` 的 `(user_id, key, 0)` 不同)。
- **`POST /review/batch`** 请求追加 `recall?: bool = false`。`QuestionOut.qtype` 可为 `"recall"`(`prompt = {word, us}`,`options = null`,`length = null`)。
- **`GET /config`** 追加 `learn: {autoplay: bool, show_example: bool}`。
- 新错误:422 `Rating is required`。
- **不新增迁移**:评级写在 `wordbook_events.outcome`(String(12),最长 `know_chk` 8 字符)与 `qtype = 'recall'`;抽查状态由当天的 `know_chk` 事件 + 盒子 + `reps = 0` 推出。B 也不新增迁移,所以 `0013` 由 C(学习联动,`down_revision = "0012"`)使用(见 `plans/2026-10-11-wordbook-links-INDEX.md` §5)。

### 9.2 网页类型(`wordbook-api.ts`,与契约样例同步)

```ts
export type QType = "meaning" | "word" | "cloze" | "dictation" | "spell" | "recall";
export type Rating = "know" | "fuzzy" | "unknown";
// AnswerInput 追加:rating?: Rating; revealedBefore?: boolean; elapsedMs?: number
// AnswerResult 追加:rating: Rating | null; spotCheck: boolean; check: Question | null
//   outcome: Outcome | "known" | Rating | "pending";grade: Grade | null
// learnBatch 返回追加 drill: Question[];reviewBatch(api, size = 20, opts: { recall?: boolean } = {})
// WordbookConfig(enabled)追加 learn: { autoplay: boolean; showExample: boolean }
```

契约样例 `server/tests/fixtures/wordbook_contract.json` 追加 `answer_recall`(学新词自评)、`answer_check`(复习抽查 pending)两条录制;`learn_batch`、`config` 与全部 answer 样例的形状随之更新,网页契约测试同一提交里更新。

## 10. 测试策略

| 层 | 内容 |
|---|---|
| 纯函数(pytest,真实代码) | `recall.py`:有效评级(偷看、连续模糊、两次一组)、抽查哈希的确定性与比例(写计划时实测 10,000 个键:种子 1 / 12345 / 987654321 分别命中 3,314 / 3,344 / 3,287,断言区间 3,100–3,500)、0/100 边界、太快必抽、学新词盒子表、当天再评只降、小测目标盒;`quiz.py`:`use_recall` 在盒 0、3 恒为假,5,000 个键命中率 40% ± 3%,`build_question("recall")` 的题面 |
| 端点(pytest + 迷你词书) | §5.3–5.5 每一行一个用例;`known:true` 别名受抽查约束;抽查通过/失败;小测答错降盒且 `reps` 不变、无 `vocab_review`;复习 pending 不写、带 choice 写;未到期不认识走 `apply_lapse`;盒 3 不出 recall;`recall` 未声明不出;设置关闭后 422;`Rating is required`;段位事件:新词自评产生 1 个 `word_learned`,当天后续作答不产生 |
| 契约 | 服务端录制两条新样例;网页逐键核对 `AnswerResult`、`Question`、`drill`、`config.learn` |
| 网页 reducer(vitest,真实代码) | `cardReducer`(偷看、自评后不可再评、reset)、`ratingPayload`(计时夹取)、`planLearnQuiz`(顺序、不认识两次、未抽中认识不考)、`learnTally` |
| 网页页面 | 遮罩时释义不在 DOM;`aria-expanded` 切换;偷看后「认识」请求带 `revealed_before:true`;不认识触发朗读;小测排队;复习 recall 正面 → pending 抽查 → 背面;记错了;深色无需单测 |
| E2E(大纲) | 开关打开 → 选书 → 学 5 词(各评级各一,含偷看)→ 小测(断言队列长度 = 模糊 + 不认识×2 + 抽中认识)→ 小结计数;把一个盒 1 的词改到期 → 复习出现快速回忆(`recall:true`)→ 认识 → 若 pending 则答题 → 翻面 → 记错了 |
| 视觉 | 视觉稿 vs 真实页面 375×812 浅色与深色截图 |

## 11. 风险

| 风险 | 对策 |
|---|---|
| 用户一直按「认识」虚报 | 抽查(默认 1/3,太快必抽)+ 抽中先记盒 1;进入已掌握必须客观题;段位点与做题相同 |
| 客户端伪造 `revealed_before:false` 或大 `elapsed_ms` | 只影响抽查概率的一小部分;抽查本身用私有种子,伪造不能避开;段位点不受影响 |
| 「记错了」不收回已得的 1 个 `vocab_review` 点 | 每日 60 上限;收回需要改段位账本(跨模块,不在本期) |
| 旧 PWA 缓存的客户端 | 所有字段追加;`recall` 需客户端声明才出题;`known` 仍可用 |
| 连续模糊跨天、跨书生效让用户意外 | 有效评级在响应里返回,界面显示「连续两次模糊,按不认识记」 |
| 与 B/C 同时改共享文件 | 只追加,插入点写进计划;合并顺序 A → B → C,B/C 合并时重录契约样例 |

## 12. 裁定

- **R-R1** 盒子号沿用 v1:认识 = 盒 2、模糊 = 盒 1、不认识 = 盒 0;6 盒间隔不变。
- **R-R2** 盒子、抽查、连续模糊、事件全部由服务端确定性决定;客户端只报 `rating`/`revealed_before`/`elapsed_ms`。
- **R-R3** 抽中抽查的「认识」先记盒 1,抽查答对才升盒 2,答错盒 0,不答停在盒 1。
- **R-R4** 当天新词的后续作答只降不升(抽查通过除外),不加 `reps`,不产生段位事件。
- **R-R5** 快速回忆不出现在盒 0 与盒 3;需要客户端声明支持且设置开。
- **R-R6** 复习抽查是两步(pending → 带 `choice` 再交),pending 不写盒、不记事件。
- **R-R7** `known:true` 是 `rating:"know"` 的别名,同样抽查。
- **R-R8** 不新增迁移;`0013` 归 C(INDEX §5)。
- **R-R9** 新文案键只在 `web.wordbook.learn.*` 与 `web.wordbook.recall.*`。

## 13. 待定问题与默认裁定

1. **抽中的「认识」先记盒 1 还是直接盒 2?** 默认盒 1(R-R3):不答抽查就拿不到高盒,堵住跳过小测的捷径。若产品负责人坚持「按下即高盒」,只需把 `recall.PENDING_BOX` 改成 2(规则其余不变)。
2. **复习里能不能偷看?** 默认不能(正面没有遮罩按钮;翻面只在自评之后)。
3. **「认识」后要不要停在翻开的卡上?** 默认停(用户自己核对,可点「记错了」),多一次点击;如果嫌慢,可改为认识直接跳下一张(仅网页改动)。
4. **连续模糊是否跨书?** 默认跨(同一用户同一词一行,v1 R17)。
5. **「记错了」是否收回段位点?** 默认不收回(§11)。
6. **自动朗读默认开还是关?** 默认开;公共场合可在管理端关。用户级开关等 B 计划的设置面板。
7. **抽查比例是否按用户覆盖?** 默认不支持(全站一个值)。
8. **快速回忆占复习题的比例?** 默认 40%(盒 1、2、4、5 的到期词,常量 `RECALL_SHARE_PCT`,不做设置);想调再加设置。
