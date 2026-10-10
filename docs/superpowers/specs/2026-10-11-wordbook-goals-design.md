# 背单词 v2 · 每日目标设置面板 — 设计文档

- 日期:2026-10-11 · 状态:产品负责人已批准交互方向(本文把它落成规则),待确认 §17 的默认裁定
- 范围:`server/app/wordbook/`(`plan.py`、`store.py` 与 `service.py` 的选书/计划部分)、`server/app/routers/wordbook.py`(新增端点)、`server/app/core/{config,settings_registry,runtime_settings}.py`(范围设置)、`web/src/features/wordbook/`(首页、选书页、新的目标面板组件)
- 实施计划:`docs/superpowers/plans/2026-10-11-wordbook-goals.md` · 视觉稿:`docs/superpowers/design/wordbook-goals-v1/mockup.html`
- 前置:`docs/superpowers/specs/2026-10-10-wordbook-design.md`(下称「v1 spec」,含 §7 评审修订)、`docs/superpowers/plans/2026-10-10-wordbook.md`、`docs/superpowers/design/redesign-v3/design-notes.md`
- 并行计划:A = 回忆式学习流程(不新增迁移)、C = 学习联动(迁移 `0013`,`down_revision = "0012"`);合并顺序 **A → B(本文)→ C**。本文**不需要迁移**;若实施中发现必须加列,取当时 head + 1(`0013`)并让 C 顺延(见 `plans/2026-10-11-wordbook-links-INDEX.md` §5)。

---

## 0. 一页摘要

- **随时改,不离开**:选书后,首页顶栏的齿轮和今日计划卡上的齿轮都打开同一个底部面板「每日目标」。面板里:每日新词(预设 10/20/30/50 + 自定义步进输入)、每日复习上限(预设 50/100/200 + 自定义 +「不限」)、顺序(乱序/书序)、「今天加练 N 个」、换书、暂停这本书、重置进度(危险,输入书名确认)。
- **三个方案** 轻松 / 标准 / 冲刺(10·100 / 20·200 / 50·不限),每个显示「约 N 天学完这本书」和「稳定后每天复习约 R 个」,在网页端按 6 盒间隔算(§4 给公式与测试值)。
- **范围变宽**:新词 1–200,复习 10–1000 或「不限」;管理员可在设置注册表里收窄(新键 §10),旧的选书记录不迁移、读取时夹到范围内。
- **立即生效**:调高当天就多给新词(`还能学 = max(0, 目标 − 今天已学)`);调低不删任何进度;积压保护规则保留并在面板里写清楚(顺带修正 v1 实现里「每次重新给 5 个」的漏洞,§3.5)。
- **连续达标**:当天新词学满目标且到期复习清零记一次「达标」;连续天数按用户本地日;**没有冻结**,暂停不保护连续(§6)。
- **服务端为准**:所有值服务端校验;用户改设置/加练/暂停每天限 60 次,重置每天 2 次;管理员改范围走 `settings_service.save`(自动审计);不改段位每日 60 点上限,不破坏 v1 评审修订里的每日新词限制(加练也走同一个检查)。
- **零迁移**:「不限」用 `review_cap = 0` 哨兵;加练、达标、重置都记进已有的 `wordbook_events`(新 kind:`bonus`、`goal`、`reset`、`relearn`,段位都不读)。

## 1. 目标、非目标、原则

**目标**
1. 用户在首页 2 次点击内改完每日量,改完马上看到今天还能学几个。
2. 让用户在选方案前就知道代价:多少天学完、每天要复习多少。
3. 给「今天还想多学」一个有上限的出口,而不是把每日目标调高再调回来。

**非目标**:每周计划、按星期几不同目标、提醒推送、连续天数冻结卡/补签、复习「提前学」(只加练新词)、改 6 盒间隔、FSRS。

**原则**
- 一个面板一个事实来源:面板里看到的「今天」数字与首页一致,都来自 `GET /today`;本地只做预览,保存后以服务端为准。
- 降低永远不删进度;只有「重置进度」会删除,而且删除范围精确定义(§8)。
- 一色一义(redesign-v3):蓝 = 主操作与选中;青 = 词书身份(进度环、预设里的天数图标);琥珀 = 连续天数、积压与超上限提醒;红只给「重置进度」;错误提示用中性色。

## 2. 入口与面板结构

### 2.1 入口

| 位置 | 控件 | 无障碍名 |
|---|---|---|
| `/wordbook` 顶栏右侧 | 44px 齿轮图标按钮(替换 v1 的「调节」链接) | 「每日目标设置」 |
| 今日计划卡右上角 | 44px 齿轮图标按钮(在进度环旁) | 「调整今天的目标」 |
| 目标达成横幅 | 次按钮「今天加练」 | 打开面板并滚动到加练区 |

两个齿轮打开同一个面板(同一组件、同一状态)。选书页 `/wordbook/books` 仍可从面板里的「换书」进入。

### 2.2 面板(底部抽屉,标题「每日目标」)

副标题:`{书名} · 剩余 {n} 词 · 改动立即生效`。从上到下:

1. **方案**:三行单选卡(375 宽下三列会把文字挤成多行,所以竖排,每行 ≥ 56px)轻松 / 标准 / 冲刺。每行左侧:名称、`新词 10 · 复习 100`;右侧:`约 369 天学完`、`稳定后每天复习约 50`。当前值不匹配任何方案时三张都不选中,标题右侧显示「自定义」徽标。
2. **每日新词**:分段 `10 / 20 / 30 / 50 / 自定义`;选「自定义」或当前值不是预设时,下方出现步进器 `[−] [ 35 ] [+]  范围 1–200`。
3. **每日复习上限**:分段 `50 / 100 / 200 / 不限 / 自定义`;自定义步进器 `范围 10–1000`。管理员关掉「不限」时该段不显示。
4. **今天**(实时预览,随上面的改动立刻变):`新词 8 / 35 · 还能学 27 个`、`复习 0 / 100`。积压时一条琥珀提示:`到期 240 个,超过复习上限 100:今天新词最多 5 个(复习降到上限以内后恢复)`。
5. **估算**:`按这个设置约 106 天学完 · 稳定后每天复习约 175 个`;若稳定复习量大于复习上限,琥珀提示 `高于复习上限 100,复习会积压`。下方一行说明(§4.3)。
6. **顺序**:分段 `乱序 / 书序`;说明「改顺序后从新的顺序取词,已学的词不受影响」。
7. **今天加练**:分段 `5 / 10 / 20` + 次按钮 `加练 10 个`;不可用时按钮禁用并写原因(§5)。
8. **连续达标**:`连续达标 12 天 · 今天还差 8 个新词`(或「今天已达标」),带「达标是什么」的一行说明。
9. **列表**:`换书 ›`、`暂停这本书`、`重置进度`(红字)。后两项各有确认对话框(§7、§8)。

保存方式:分段、方案卡、顺序一点即保存;步进器在最后一次点按 600 ms 后或输入框失焦/回车时保存。保存中不锁面板;失败时退回改动前的值并在面板顶部显示错误(`role="alert"`),成功时用 `aria-live="polite"` 读一次「已保存」。

## 3. 每日量规则

### 3.1 范围与默认

| 值 | 合法范围(管理员可收窄) | 新选书默认 | 存储 |
|---|---|---|---|
| 每日新词 `daily_new` | 1–200 | `wordbook_daily_new`(20) | `wordbook_enrollments.daily_new` |
| 每日复习上限 `review_cap` | 10–1000,或「不限」 | `wordbook_review_cap`(100) | `review_cap`;**「不限」存 0** |

- 外层范围 1–200 / 10–1000 写死在代码里(`app.core.config.WORDBOOK_NEW_BOUNDS`、`WORDBOOK_REVIEW_BOUNDS`),是 pydantic 的硬边界;管理员只能在其中收窄(§10)。
- **兼容(无迁移)**:v1 的值是 5–100 / 20–500,都在新外层范围里;0 在 v1 里不可能出现,所以哨兵不会和旧数据冲突。管理员收窄后,超出范围的旧值**不改库**,读取时按 `effective_goals` 夹到范围内(计划、`/today`、作答检查都用夹过的值);用户下一次保存时写入合法值。管理员关掉「不限」时,存 0 的用户按 `wordbook_review_cap_max` 计算。

### 3.2 立即生效

- 改设置只更新 `wordbook_enrollments` 那一行,不动事件。今天的计数(`new_done`、`review_done`)来自当天事件,所以:
  - 调高新词:`new_left = max(0, new_target − new_done)` 立刻变大,首页与面板马上显示。
  - 调低新词:低于已学数时 `new_left = 0`;已学的词照常进入复习,**不删、不退回**。
  - 调低复习上限:`review_left = min(review_due, max(0, cap − review_done))` 变小;已复习的不受影响。
- 改顺序:沿用 v1 `enroll` 的行为(`cursor` 归零,已学的词被跳过);种子不变,所以切回原顺序后取词位置仍从头跳过已学词。

### 3.3 「今天已学」的口径(修订 v1)

`new_done` = 今天本书 `kind ∈ {learn, relearn}` 事件的不同词数(A 的三档自评建行同样记 `learn`/`relearn`;当天再评、小测、抽查记 `practice`,不计入)。新 kind `relearn`:一个词以前有过 `learn` 事件(别的书、删掉后重学、重置后重学)而现在再次作为新词学 → 记 `relearn`(v1 记的是 `practice`,不计入今日新词,等于绕过每日上限;重置让这个漏洞变大,所以一起修)。`relearn` 不产生 `word_learned` 段位点(段位只读 `learn`),成就「学会 N 词」仍按 `learn` 的不同词计。

### 3.4 「不限」

`review_cap = None`(库里 0):`review_left = review_due`;每日作答上限 3,000 次(v1)仍然兜底。

### 3.5 积压保护(保留规则,修正实现)

- 规则(v1 §6.2):到期复习数超过复习上限时,今天少学新词,最多 5 个。
- 阈值:有上限时 = 复习上限;「不限」时 = `wordbook_review_cap_max`(默认 1000),否则「不限」会让保护永远失效。
- **修正**:v1 的 `compute_plan` 写的是 `new_left = min(new_left, 5)`,每学完 5 个又给 5 个,保护实际不生效。本文改为**今天的新词总数(含加练)**最多 5 个:`new_left = max(0, min(new_target, 5) − new_done)`。v1 测试的三个用例结果不变,新增「已学 5 个后为 0」的用例。
- 积压时面板写清楚触发原因与恢复条件;首页琥珀条文案不变。

## 4. 方案与估算(网页端计算)

### 4.1 三个方案

| id | 名称 | 每日新词 | 每日复习上限 |
|---|---|---:|---|
| `easy` | 轻松 | 10 | 100 |
| `standard` | 标准 | 20 | 200 |
| `sprint` | 冲刺 | 50 | 不限 |

点方案卡 = 一次保存两个值。方案只是预设,不存方案 id;是否选中由当前值是否完全相等决定。管理员收窄范围使某方案越界时,该方案卡禁用并显示「管理员已限制」。

### 4.2 公式(全对模型)

6 盒间隔 `INTERVAL_DAYS = (1, 2, 4, 7, 15, 30)`(`app/services/vocabulary.py`),学新词进盒 0、明天复习;每次答对进下一盒,顶盒(5)后每 30 天复习一次。于是一个词在学后第 `o` 天被复习,`o ∈ O`:

```
O = {1, 3, 7, 14, 29} ∪ {59 + 30k | k ≥ 0}
```

设剩余未学词 `W`(`progress.remaining`)、每日新词 `N`:

- **学完天数** `D = ⌈W / N⌉`(W = 0 时为 0)。
- **第 t 天的复习量**(从今天起每天学 N 个,最后一天学 `W − N(D−1)` 个):
  `R(t) = Σ_{o ∈ O, o ≤ t, t−o < D} n(t − o)`,其中 `n(s) = N`(s < D−1),`n(D−1) = W − N(D−1)`。
- **稳定后每天复习** `S = 5N`:爬到顶盒前每个词要复习 5 次(1/3/7/14/29 天),从第 29 天起每天都有 5 批词同时在复习。方案卡与估算行显示 `S`。
- **学完那天的复习量** `R(D)`:顶盒词每 30 天回来一次,越往后越多;只在面板的说明行里显示(「学到最后每天约 R(D) 个」)。
- `S > 复习上限` → 琥珀提示「高于复习上限,复习会积压」。

**测试值**(四级 4,544 词全新):

| N | D | S | R(D) |
|---:|---:|---:|---:|
| 10 | 455 | 50 | 184 |
| 20 | 228 | 100 | 204 |
| 50 | 91 | 250 | 344 |

(N = 20:`O ∩ [1, 228]` 有 11 个值;`o = 1` 落在最后一天,只有 4 个词;`4 + 10 × 20 = 204`。)视觉稿用剩余 3,684 词:轻松 369 天 · 50,标准 185 天 · 100,冲刺 74 天 · 250。

### 4.3 诚实说明

(与 A 的关系:A 合并后「认识」直接进盒 2、「模糊」进盒 1,本节的「学新词进盒 0」模型因此**偏保守**——高估复习量,不会低估;数字与测试值不改,INDEX R-G2。)

估算行下方固定一行灰字:「按全部答对估算;答错的词会回到第一盒,实际复习更多。已掌握的词每 30 天复习一次,学到后期每天复习会逐渐增加(学到最后约 R(D) 个)。」不显示任何没有依据的「正确率」假设。

## 5. 今天加练

- **是什么**:今天的新词目标学完后,再给自己 N 个新词(N ∈ 5/10/20,每次最多 20),当天有效,次日归零。加练的词与普通新词完全一样(词卡 → 小测 → 进 6 盒),走同一个 `/learn/batch` 与 `/answers`。
- **服务端约束**(`POST /api/wordbook/bonus`):
  - 有当前在学的书(409 `No active book`);
  - 今天的新词已学完:`new_left == 0`(409 `Finish today's new words first`);
  - 不在积压保护中(409 `Clear the review backlog first`);
  - 本书还有未学的词(409 `No new words left in this book`);
  - 当天本书已加练 + N ≤ `wordbook_bonus_max`(默认 50;0 = 关闭)(429 `Daily bonus limit reached`);
  - 计入每人每日 60 次的设置操作限额(429 `Too many settings changes today`)。
- **记录**:`wordbook_events` 一行 `kind='bonus'`、`credit = N`、`day` = 本地日;今天的加练量 = 当天本书 `bonus` 事件的 `credit` 之和。并发:提交后重算,超出上限的那一次删除自己那行并返回 429(最坏情况两次都退回,用户重试即可),所以总量永不超过上限。
- **计划**:`new_target = daily_new + bonus`;积压保护仍按 §3.5 封顶 5(用户已加练、之后又积压时,积压优先)。
- **成功后**:面板关闭并进入 `/wordbook/learn`(学新词页本身不改)。
- 段位:加练学会的词照常产生 `word_learned`,与其它来源共享每日 60 点上限,不能靠加练冲段。

## 6. 连续达标(保持小)

- **达标**(某个本地日 d,针对当时的在学书):`new_done ≥ goal_new` 且 `review_left == 0` 且当天有过至少一次学习或复习(`new_done + review_done ≥ 1`)。
  - `goal_new = daily_new`(夹到范围后的值,**不含加练**);积压时 `goal_new = min(daily_new, 5)`;本书剩余新词不足时 `goal_new = min(goal_new, new_done + 剩余)`。
  - 复习上限内的到期词清零即可;「不限」时要求所有到期词清零。
- **记录**:`GET /today` 计算出 `goal_met` 为真时写一行 `kind='goal'`、`word = 'goal'`、`day = d`(同一本地日只写一次;维护模式 `maintenance_mode != "off"` 时不写)。之后当天再有新到期的词也不撤销。
- **连续天数**:`goal` 事件的不同 `day`(跨书)从今天(今天已达标)或昨天(今天未达标)往回数连续的日期。用户本地日按请求的 `tz_offset_minutes`,与计划一致;换时区可能出现空档或重复,不补偿。
- **冻结**:无。暂停、换书、重置都不冻结也不清零;没达标的那天就断。
- **展示**:首页计划卡的第四格「连续 12 天」(琥珀火焰图标;0 天时显示「连续 —」);面板里一行详情;不做排行榜、不做徽章(段位已有 `streak_7`,两者独立:段位按「活跃日」,这里按「达标日」)。

## 7. 换书、暂停与继续

- **换书**:面板「换书 ›」→ `/wordbook/books`(v1 页面,改为复用面板里的设置字段组件)。换书不清进度(v1 R-W12)。
- **暂停这本书**:确认对话框「暂停四级?」——「暂停后首页不再安排新词和复习,到期的词会累积;学习记录全部保留,随时可以继续。连续达标不会冻结。」按钮「取消 / 暂停」。`POST /enrollment/pause` 把当前书设为 `paused`,之后没有在学的书。
- **暂停后的首页**:不再跳选书页;显示「四级 · 已暂停」卡、一行说明(「暂停期间到期的词会累积,继续后按复习上限分几天复习完」;暂停时不计算计划,所以不显示到期数)、主按钮「继续学习」、次按钮「换一本」。`GET /today` 在没有在学书时返回 `paused`(最近更新的那本已暂停、仍启用的书)。练习页大卡与「我的」一行不改(暂停时显示「选一本词书」,点进去到达暂停卡)。
- **继续**:`POST /enrollment/resume {book_id}`,等同 v1 `PUT /enrollment` 只传书 id(设为 active、暂停其它,设置与进度不变)。

## 8. 重置进度(精确定义)

**会清除**(只针对这一本书):
1. 该用户 `vocabulary_items` 中 `source = 'wordbook:<book>'` 的行,即「由这本书新建、且没被收进生词本」的词的学习状态(盒子、到期时间、复习次数)。
2. 该书选书记录的取词位置:`cursor = 0`、新的随机 `seed`(新的乱序)、`started_at = now`。每日设置、顺序、状态不变。

**不会清除**:
- `wordbook_events` 全部保留(答题、学过、加练、达标、重置本身的记录),所以**今天已学的新词数不变,重置不能换来更多今日新词**;连续达标不受影响。
- 段位:`xp_events`、段位、已解锁成就全部保留。重置前服务端先跑一次段位同步(段位开启且非维护模式时),把今天还没入账的复习段位点入账,删除的行不会带走它们。之后「掌握 N 词」类成就的进度按剩余行重新计算,已解锁的不收回。
- 别的来源的词:查词/生词本收进来的词、别的书新建的词、从本书收进生词本的词(v1 评审修订:收进生词本会改 source)。这些词在本书里**仍算已学**,所以重置后「已学」可能不为 0,确认框里写明。
- 举报、AI 讲解缓存、其它书的选书记录。

**之后**:重学这些词记 `relearn`(§3.3),计入每日新词上限,不再产生 `word_learned` 段位点。

**确认**:危险对话框(`role="alertdialog"`),标题「重置四级的进度?」,列出会/不会清除的要点与「本书已学 860 词(其中来自生词本或其它书的不会清除)」;输入框提示「输入「四级」确认」,内容与书名(中文名、英文名或 id,不区分大小写、去首尾空白)一致时红色按钮「重置进度」才可点。服务端再次校验(422 `Confirmation does not match`)。每人每 UTC 日最多 2 次(429 `Daily reset limit reached`)。在学或已暂停的书都可以重置;没选过的书 409 `Book not enrolled`。

## 9. API(`/api/wordbook/*`,登录 + `WORDBOOK_ENABLED`,错误 `{"error": "..."}`)

| 方法 路径 | 请求 | 响应 |
|---|---|---|
| `GET /config` | — | v1 + `limits: {daily_new:{min,max}, review_cap:{min,max}, review_unlimited: bool, bonus_max: int}` |
| `PUT /enrollment`(v1,放宽) | `{book_id, daily_new?: 1–200, review_cap?: 10–1000, review_unlimited?: true, order_mode?}` | `EnrollmentOut` |
| `PATCH /enrollment` | `{daily_new?, review_cap?, review_unlimited?: true, order_mode?}`(至少一项;作用于当前在学的书) | `EnrollmentOut` |
| `POST /enrollment/pause` | `{}` | `EnrollmentOut`(status `paused`) |
| `POST /enrollment/resume` | `{book_id}` | `EnrollmentOut` |
| `POST /enrollment/reset` | `{book_id, confirm, tz_offset_minutes}` | `{removed: int, enrollment: EnrollmentOut}` |
| `POST /bonus` | `{size: 1–20 = 10, tz_offset_minutes}` | `{plan: DayPlan, bonus_left: int}` |
| `GET /today` | v1 | v1 + `paused: EnrollmentOut \| null`、`streak: {current, today_met}`;`plan` + `bonus`、`goal_met` |

- `EnrollmentOut` = v1 + `review_unlimited: bool`;`daily_new` / `review_cap` 返回**夹过的有效值**(「不限」时 `review_cap` 为 0)。
- `DayPlan` = v1 七个键 + `bonus`(今天已加练)、`goal_met`。`new_target` 含加练。
- 校验:pydantic 只做外层范围(1–200、10–1000,`review_unlimited` 只接受 `true`);管理员范围在服务里查,越界 422:`Daily new words out of range`、`Review cap out of range`、`Unlimited reviews are off`、`Conflicting review cap`(同时给了上限和不限)、`No changes`(PATCH 空体)。
- 限流:`PATCH /enrollment`、`/pause`、`/resume`、`/bonus` 共用每人每 UTC 日 60 次(`daily_usage` 范围 `wordbook_settings`,429 `Too many settings changes today`);`/reset` 另计 2 次(`wordbook_resets`)。`PUT /enrollment`(选书)不计,沿用 v1。
- 日志:只记书 id、状态码与变更的键名,不记数值以外的用户输入;确认文本不入日志。
- 契约:`server/tests/fixtures/wordbook_contract.json` 新增 `enrollment_patch`、`bonus`、`pause`、`today_paused`、`resume`、`reset`;`today`、`config`、`enrollment` 的形状随之增加键;网页 `wordbook-api.ts` 类型与 `wordbook-contract.test.ts` 同一提交更新(§14)。

## 10. 设置注册表(分组「背单词」,全部热生效)

| 键 | 类型 / 默认 / 硬边界 | 标签 | 说明 |
|---|---|---|---|
| `wordbook_daily_new` | int / 20 / 1–200(v1 为 5–100) | 默认每日新词 | 新选书的默认值 |
| `wordbook_review_cap` | int / 100 / 10–1000(v1 为 20–500) | 默认每日复习上限 | 新选书的默认值 |
| `wordbook_daily_new_min` | int / 1 / 1–200 | 每日新词下限 | 用户可选的最小值 |
| `wordbook_daily_new_max` | int / 200 / 1–200 | 每日新词上限 | 用户可选的最大值 |
| `wordbook_review_cap_min` | int / 10 / 10–1000 | 每日复习上限·下限 | |
| `wordbook_review_cap_max` | int / 1000 / 10–1000 | 每日复习上限·上限 | 也是「不限」的积压阈值 |
| `wordbook_review_unlimited` | bool / true | 允许「不限」复习 | 关掉后存「不限」的用户按上一项计算 |
| `wordbook_bonus_max` | int / 50 / 0–200 | 每日加练上限(新词) | 0 = 关闭加练 |

- 交叉校验进 `app/core/runtime_settings.runtime_problems`:`daily_new_min ≤ daily_new ≤ daily_new_max`、`review_cap_min ≤ review_cap ≤ review_cap_max`,否则管理端保存返回 422(字段 `_`)。
- 管理员改动经 `admin/settings_service.save`:自动写 `setting_revisions` 与哈希链审计 `settings.update`;不加危险标记(不产生费用、可随时改回)。
- 用户侧没有新的配额键(`QUOTA_KEYS` 不变)。

## 11. 服务端实现要点

- `plan.py`(纯):`REVIEW_UNLIMITED = 0`、`GoalLimits`、`effective_goals`、`goals_error`、`compute_plan`(新增 `bonus`、`guard_threshold`、`remaining`,修正积压)、`DayPlan` 增加 `bonus`、`goal_met`、`streak_of(days, today)`。
- `store.py`:`today_counts` 与 `today_learned_keys` 的 learn 口径改为 `{learn, relearn}`;追加 `update_goals`、`pause_active`、`latest_paused`、`bonus_today`、`mark_goal`、`goal_days`、`reset_book`、`consume_settings`、`consume_reset`。
- `service.py`:`limits_of(settings)`、`config_out` 加 `limits`、`enrollment_out(e, limits)` 返回有效值、`put_enrollment` 加校验、`_day_plan` 加 `settings` 关键字(夹值、加练、剩余词)、`today_out` 加 `paused`/`streak` 与写达标;A 新增的 `_learn_kind` 一行改为 `relearn`(两条学新词路径共用;INDEX R-A2);追加 `patch_enrollment`、`grant_bonus`、`pause`、`resume`、`reset_progress`。
- `routers/wordbook.py`:放宽 `EnrollmentIn`;追加 5 个端点;重置前调用段位同步(路由层可以导入 `app.rank`;`wordbook` 层不导入段位,分层不变)。
- 与 v1 评审修订的关系:作答时的新词检查、每词只记一次 `learn`、作答 3,000 次上限、UTC 日用量全部保留;`_day_plan` 是唯一的计划入口,加练与夹值在里面,所以 `learn_batch`、`answer` 的检查自动包含它们。

## 12. 网页

### 12.1 组件与文件(`web/src/features/wordbook/`)

| 文件 | 内容 |
|---|---|
| `goals-math.ts` | 纯函数:`reviewOffsets`、`daysToFinish`、`steadyReviews`、`reviewLoadOn`、`estimate`、`PRESETS`、`matchPreset`、`previewPlan`(镜像 `compute_plan`)、`parseCount`、`clamp` |
| `goals-stepper.tsx` | 步进器:− / 输入框 / +,600 ms 去抖提交 |
| `goals-fields.tsx` | 方案卡 + 新词 + 复习上限 + 今天预览 + 估算 + 顺序;选书页与面板共用 |
| `goals-sheet.tsx` | 面板:字段、加练、连续达标、换书/暂停/重置与两个确认框 |
| `use-goals.ts` | 变更与乐观更新:`patch`、`bonus`、`pause`、`resume`、`reset` |
| `goals-test-fixtures.ts` | 测试样例(与 v1 `test-fixtures.ts` 分开,避免与并行计划冲突) |
| `home-page.tsx` | 齿轮 ×2、连续格、达标横幅、暂停卡 |
| `books-page.tsx` | 设置抽屉改用 `GoalsFields`(取消 `nearest` 吸附) |
| `use-today.ts` | 追加返回 `setToday` |

### 12.2 状态与乐观更新

- 面板打开时以 `useWordbookToday` 的 `today` 为准;每次改动先用 `optimistic(today, patch, limits)` 本地更新 `enrollment` 与 `plan`(`previewPlan`),再 `PATCH`;成功后 `reload()` 用服务端结果覆盖;失败退回改动前的快照并显示翻译后的错误。
- 连续改动:每次请求带递增序号,只有最后一次的成功/失败会改状态(中间的响应被丢弃),防止旧响应把新值改回去。
- 加练/暂停/继续/重置不做乐观更新:按钮显示进行中,成功后 `reload()`;加练成功进入学新词页;重置成功 `toast`「已重置四级的进度」。
- `previewPlan` 与服务端 `compute_plan` 用同一份样例表 `server/tests/fixtures/wordbook_plan_cases.json` 测试,保证两边一致。

### 12.3 无障碍

- 面板与确认框是 Radix Dialog / AlertDialog:焦点困在内部、Esc 关闭、关闭后焦点回到打开它的齿轮。
- 方案卡 `role="radiogroup"` / `role="radio"` + `aria-checked`,名字含天数与复习估算;分段沿用 `SegmentedControl`(←/→)。
- 步进器 `role="group"` + `aria-labelledby`;− / + 是 44px 按钮,`aria-label` 「减少每日新词」「增加每日新词」,到边界时 `disabled`;输入框 `type="text" inputmode="numeric" pattern="[0-9]*" enterkeyhint="done" autocomplete="off"`,`aria-describedby` 指向「范围 1–200」;接受全角数字。
- 触控 ≥ 44px(分段 32 视觉 / 44 命中);重置确认输入框有可见标签;红色按钮在禁用时 `aria-disabled` 并说明原因。
- 不靠颜色:积压/超上限提示有图标和文字;连续天数有文字。
- 尊重 `prefers-reduced-motion`(面板滑入动画由 BottomSheet 处理)。

### 12.4 深色

全部用 `theme.css` 令牌(`surface`、`surface-2`、`ink`、`ink-2`、`hair`、`blue`、`teal`、`amber`、`red`);选中方案卡 1.5px 蓝色内描边;步进器输入框 `surface-2` 底。视觉稿第 09 帧为深色面板。

### 12.5 文案

全部在 `web/src/features/wordbook/i18n/{zh-CN,en}.json` 的 `web.wordbook.goals.*` 下(中英齐全;英文计数用 i18next 复数)。新的服务端错误加进 `WORDBOOK_SERVER_ERRORS`,映射到 `web.wordbook.goals.errors.*`。

## 13. 测试与 E2E

| 层 | 内容 |
|---|---|
| 纯函数(pytest) | `compute_plan` 样例表(含积压修正、加练、不限、剩余、达标)、`effective_goals`、`goals_error`、`streak_of`(跨月、断档、今天未达标) |
| 设置 | 新键已登记、边界、`runtime_problems` 交叉校验、`settings_service.save` 拒绝 min > max 并对合法收窄写审计 |
| 路由 | PATCH 范围与管理员收窄、空体、不限开关、立即生效(调高/调低)、夹值兼容(旧值越界)、加练全部前置条件与上限、暂停/继续与 `paused`、重置清除与保留(事件、xp、今日新词数、别的来源)、`relearn` 计入上限且不加段位点、达标写入一次与连续天数、维护模式不写、限流 429 |
| 契约 | 新增六个样例键;旧键形状变化重新录制 |
| 网页(vitest) | `goals-math`(公式测试值、与服务端样例表一致)、步进器(去抖、边界、全角数字、回车)、`GoalsFields`(方案选中/自定义、不限、超上限提示)、`GoalsSheet`(乐观更新与回退、加练禁用原因、暂停/重置确认、焦点)、首页(齿轮打开面板、连续格、暂停卡、达标横幅)、选书页(新字段)、契约 |
| E2E | `web/e2e/wordbook-goals.spec.ts`(零上游):选书 → 齿轮改新词 30 → 首页「学新词」计数变化 → 学满后加练 5 → 暂停 → 继续 → 重置(输入书名)→ 进度归零;375×812 浅色与深色截图对照视觉稿 |

## 14. 与并行计划(A、C)的协作

本计划独占:`plan.py`、`home-page.tsx`、`books-page.tsx`、`plan-ring.tsx`(本期不改)、`use-today.ts`、`use-wordbook-config.ts`、新的 `goals-*` 文件与它们的测试、`web.wordbook.goals.*` 文案、`app/core` 的范围键。共享文件只做**追加**或**列明的单点修改**:

| 共享文件 | 本计划的改动 | 插入点 |
|---|---|---|
| `server/app/wordbook/service.py` | 错误常量追加在 `REPORT_LIMIT` 之后;`config_out`、`enrollment_out`、`put_enrollment`、`_day_plan`、`today_out` 改写(选书/计划部分);`learn_batch`、`review_batch`、`answer` 里的 `_day_plan(...)` 调用各加 `settings=settings`(A 合并后这三行原样还在);A 新增的 `_learn_kind` 里 `"practice" if ... else "learn"` 改为 `"relearn"`;`config_out` 的 `limits` 放在 A 的 `learn` 之后;新函数整体追加到文件末尾 `# ---- 每日目标(goals v2)----` 段 | 见计划 Task GS3 |
| `server/app/wordbook/store.py` | `today_counts`、`today_learned_keys` 的 `kind == "learn"` 改为 `kind.in_(LEARN_KINDS)`;新函数追加到文件末尾 | 同上 |
| `server/app/routers/wordbook.py` | `EnrollmentIn` 两个字段放宽并加 `review_unlimited`;新端点追加到文件末尾 | Task GS4 |
| `server/tests/test_wordbook_contract.py` + 样例 | `KEYS` 并上 `GOALS_KEYS`;`collect()` 末尾 `return` 前调用 `collect_goals` | Task GS5 |
| `web/src/features/wordbook/wordbook-api.ts` | 接口 `WordbookConfig`、`Enrollment`、`DayPlan`、`Today` 末尾追加字段;错误表末尾追加;新函数追加到文件末尾 | Task GW2 |
| `web/src/features/wordbook/wordbook-contract.test.ts` | 键表追加新键;新增一个 `it` | Task GW2 |
| `web/src/features/wordbook/i18n/*.json` | 只新增 `goals` 子树(以及 `home.settings` 文案改为「每日目标设置」) | Task GW3–GW6 |
| `server/tests/test_wordbook_api.py`、`test_wordbook_learn_limits.py` | 单点改断言(`/today` 新键;1 现在合法;`practice` → `relearn`) | Task GS3 |
| `server/app/wordbook/store.py` 的 `enroll()` | 新建行默认值 `or` → `is not None`(否则「不限」的 0 被吞掉) | Task GS3 |

不碰:学新词/复习页、会话机、题型(A);跨模块联动的挂点(C)。A 一定先合并(INDEX §2);上面的插入点已按 A 合并后的形状写好(`_learn_kind`、`config_out` 键序、`WordbookConfig` 追加),行为测试不变。

## 15. 风险

| 风险 | 对策 |
|---|---|
| 「不限」+ 高新词量 → 后期复习爆量(托福 10,367 词、每天 50 个,学完时每天数百个) | 估算行显示 S 与 R(D),超上限琥珀提示;积压保护阈值用 `review_cap_max`;作答 3,000 次/日兜底 |
| GET `/today` 写达标事件(有副作用的 GET) | 幂等(一天一行)、维护模式不写、只在 `goal_met` 时写;不写就只是少一天连续,不影响学习 |
| 重置删除行后,未入账的段位点丢失 | 重置前在路由层同步段位;测试覆盖 |
| 加练并发双击超上限 | 提交后重算并回退超出的那次 |
| 管理员收窄范围让旧值越界 | 读取时夹值,不改库;面板显示夹过的值 |
| 积压修正改变了老用户的体验(积压时当天最多 5 个) | 这是 v1 spec 的原意;面板写清触发与恢复条件 |
| 与 A/C 的共享文件冲突 | 合并顺序 A → B → C;共享文件只追加或单点修改,插入点已列明 |
| 时区变化导致连续天数跳变 | 不补偿,文档写明 |

## 16. 裁定

- **G-1** 面板是唯一的每日设置入口(选书页复用同一组字段);改动立即保存,不设「保存」按钮。
- **G-2** 范围 1–200 / 10–1000 + 「不限」;「不限」存 `review_cap = 0`;无迁移;越界旧值读取时夹值。
- **G-3** 积压保护 = 当天新词总数(含加练)最多 5 个;「不限」时阈值为 `wordbook_review_cap_max`。修正 v1 实现。
- **G-4** `new_done` 口径 = `{learn, relearn}` 的不同词;重学记 `relearn`(取代 v1「删掉后重学记 practice」)。
- **G-5** 加练只加新词,需先学完今天的新词且不在积压中,每次 ≤ 20、每天 ≤ `wordbook_bonus_max`;记 `bonus` 事件。
- **G-6** 达标 = 新词学满(不含加练)+ 到期复习清零 + 当天有活动;`goal` 事件一天一行;连续跨书;无冻结。
- **G-7** 重置只删本书来源的 `vocabulary_items` 行并重置取词位置;事件、段位、成就、别的来源的词全部保留;重置前同步段位;每天 2 次;输入书名确认。
- **G-8** 估算只在网页端算,按全对模型,显示 `D`、`S = 5N`,说明行显示 `R(D)`;不假设正确率。
- **G-9** 本文的 API 与类型变化即 v1 计划 P-W4 所需的 Addendum。

## 17. 待定问题与默认裁定

1. **达标要不要包含拼写练习?** 默认不包含(拼写是自愿练习,v1 也不计入每日计划)。
2. **加练要不要也能加复习(提前复习未到期的词)?** 默认不做:提前复习会打乱盒子间隔。
3. **连续天数要不要冻结卡?** 默认没有(产品负责人要求保持小);暂停也不冻结。
4. **重置后要不要保留旧的乱序?** 默认换新种子(用户重置通常想换个开头)。
5. **用户能不能把「不限」用在新词上?** 不能;新词最多 200(防止一次建几千行)。
6. **方案卡在选书页也显示吗?** 显示(同一组件),便于新用户一次选好。
7. **暂停后练习页大卡怎么显示?** 默认不改大卡(显示「选一本词书」,点进去看到暂停卡);若 C 计划改大卡,可顺手显示「已暂停」。
8. **重置次数 2 次/天够吗?** 默认够;误操作有确认框,正常使用不需要多次。
