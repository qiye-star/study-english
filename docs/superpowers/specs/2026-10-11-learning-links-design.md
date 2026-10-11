# 学习模块联动(解耦、可插拔)— 设计文档

- 日期:2026-10-11
- 状态:产品负责人已批准方向(两种小机制 + 六个联动全做 + 每用户开关);本文写清细节,实现计划见
  `docs/superpowers/plans/2026-10-11-learning-links.md`,视觉稿见 `docs/superpowers/design/learning-links-v1/mockup.html`。
- 前置:`docs/superpowers/specs/2026-10-10-wordbook-design.md`、`docs/superpowers/specs/2026-10-09-rank-and-rooms-design.md`、
  `docs/superpowers/specs/2026-10-09-admin-console-v2-design.md`、`docs/superpowers/design/redesign-v3/design-notes.md`。
- 并行:A(背单词回忆流程,`E:\workspace\ece-plan-recall`)与 B(目标/设置面板,`E:\workspace\ece-plan-goals`)同时写计划。
  本文只占用迁移号 **0013**(`down_revision = "0012"`;A、B 都不新增迁移),合并顺序 **A → B → C(本文)**。若 A 或 B 日后加了迁移,本文的号顺延为当时 head + 1(见 `plans/2026-10-11-wordbook-links-INDEX.md` §5)。

---

## 0. 一页摘要

**问题。** 各学习模块彼此直接引用:`AddVocabularyButton` 被对话、查词、进度、房间小结四处直接导入;练习页直接导入
`RankCard` 与 `WordbookCard`;段位 `ledger.py` 直接读 `wordbook_events`;网页 feature 之间有 21 条跨目录导入边。
想加一个「背单词 ↔ 对话」之类的联动,只能再加一条直接依赖。

**方案:两个小机制。**

1. **服务端:进程内学习事件通道**(`app/core/learning_events.py`,中性核心层)。模块只在**提交之后**发布纯数据类事件
   (`WordAnswered`、`AssessmentFinished`、`MessageSent`),不知道谁在听。联动逻辑放在新的**顶层** `app/links/`:每个联动
   一个小模块,订阅它关心的事件;同管理端一样,除 `main.py` 与 `routers/` 外**没有任何包可以导入 `app.links`**(架构测试强制)。
2. **网页:类型化扩展点注册表**(`web/src/lib/extension-points.ts` + `extension-points-react.tsx`)。消费方只渲染插槽
   (`<Slot point="wordActions" …/>`),不导入提供方;提供方在 `features/<x>/register*.ts` 里登记贡献,所有登记文件只由
   `web/src/plugins/index.ts` 一处列出。删掉一行插件(或关掉它的开关)就删掉这个联动,别处不用改。

**六个联动(全做):**

| # | 键 | 名称 | 一句话 |
|---|---|---|---|
| 1 | `word_actions` | 单词操作位置 | 四处「加入生词本」改为 `<WordActions>` 插槽;开时多一个「更多」菜单:加入词书学习 / 跟读这个词 / 查看词卡 |
| 2 | `daily_tasks` | 今日任务聚合卡 | 练习页一张卡汇总:背单词(新词+复习)、跟读一句、对话一次、段位阶段任务 |
| 3 | `mistakes` | 易错词 | 背单词里答错的词自动进入生词本里的「易错词」视图(虚拟视图,不复制词条,幂等) |
| 4 | `pron_shadow` | 发音弱词 ↔ 跟读 | 跟读评测里低分的词进「发音弱词」练习入口;今天学的新词提供例句一键跟读 |
| 5 | `chat_words` | 对话用到今日词 | 服务端按词形还原匹配用户对话是否用了今天学的新词,记一次「用过」并可得段位点;不需要大模型 |
| 6 | `rank_sources` | 段位点来源注册 | 联动可以登记**新的**段位点来源(首个:`word_in_chat`);既有段位代码路径与测试不变 |

**开关两级:** 管理端全局开关(设置注册表,热更新)+ 每用户开关(存服务端,`/api/links/prefs`,App 内「我的 → 学习联动」页)。
**全部关闭时 App 与今天完全一致**(总开关默认关闭)。联动是尽力而为的增强:失败被捕获、不带隐私地记日志、永不让主请求失败,
带简单熔断、超时、队列上限与丢弃计数;段位等关键数据继续读源表。

---

## 1. 现状(读代码得出)

| 耦合点 | 位置 | 说明 |
|---|---|---|
| 生词本按钮四处直引 | `web/src/features/chat/conversation-page.tsx:20,1228-1229`、`features/lookup/lookup-layer.tsx:11,156`、`features/progress/progress-page.tsx:16,144`、`features/rooms/extras/summary-page.tsx:6,73` | 产生 `chat→vocabulary`、`lookup→vocabulary`、`progress→vocabulary`、`rooms→vocabulary` 四条边;查词还用 `vocabularyFromLookup` |
| 练习页直引卡片 | `features/practice/practice-page.tsx:20-21,172-173` | `practice→rank`、`practice→wordbook`(本次不搬,列入基线;今日任务卡改走插槽) |
| 段位读背单词表 | `server/app/rank/ledger.py:94-103` | 经 `app.models.WordbookEvent` 读;**保留**(关键积分读源表,产品负责人裁定) |
| 跨 feature 边 | `web/src/features/**` | 当前 21 条(chat→grammar/lookup/practice/realtime/vocabulary,lookup→practice/vocabulary,practice→chat/rank/wordbook,progress→practice/vocabulary,rank→chat/practice,realtime→chat,rooms→chat/vocabulary,vocabulary→chat/lookup,wordbook→chat/rank) |
| 服务端分层 | `server/tests/test_architecture.py` | `core→models`;`admin` 只被 `routers/main` 导入;`wordbook` 是叶层 |
| 设置 | `app/core/settings_registry.py` + `runtime_settings.SettingsHub` | 每个字段一条 `SettingSpec`;热更新经 `app.state.settings` 替换;只有 `admin/settings_service.save` 能写 |
| 计量 | `app/core/metering.py` | `feature_scope`、`bind_user` 都是 contextvar(本设计的发布绑定照抄这一做法) |
| 迁移 | `server/alembic/versions/` | 本仓库当前 head `0012`;A、B 不新增迁移,本文 0013 |

---

## 2. 目标、非目标、原则

**目标**
- G1 两个机制都小而类型化:服务端一个文件(事件 + 通道)、网页两个文件(注册表 + React 插槽)。
- G2 发布方零知识:发布方只 `publish(Event(...))`,不导入 `app.links`,不判断开关。
- G3 可插拔:删除 `app/links/registry.py` 里一行或 `web/src/plugins/index.ts` 里一行即可移除一个联动,其余代码与测试不改。
- G4 全关等于今天:总开关关 → 发布立即返回、网页插槽只剩核心贡献(「加入生词本」),DOM 与今天逐字节一致。
- G5 失败隔离:联动异常不影响主请求、不影响其他联动。
- G6 六个联动按 §6 交付;管理端可见计数与最近错误;每用户可关。

**非目标**
- 不做持久化事件总线 / outbox / 跨进程投递(尽力而为,见 §4.1 选型)。
- 不重构段位内部(`points.py`、既有 `_collect` 分支、阶段任务、成就),不改 `xp_events` 既有种类的计算。
- 不搬动练习页上的 `RankCard`/`WordbookCard`(不在本次范围;基线里保留这两条边)。
- 不用大模型判定是否用到今日词(可选的大模型「用法检查」默认关、限额、402 降级)。
- 不修改背单词盒子算法与判分(P-W2 原样);「对话用到今日词」不改盒子(裁定 L-R5)。

**原则**
- 一色一义(redesign-v3):蓝 = 主操作/你;青 = 词汇/词书;琥珀 = 提醒/弱项;绿 = 完成/≥85;错误用中性;红只用于危险/退出。
- 隐私:事件只在内存;联动表不存消息正文;日志只有种类、联动键、事件类型、异常类名、毫秒。
- 数字来自本文;改数字先改本文。

---

## 3. 总体架构

```
发布方(提交之后)                     核心层(中性)                         顶层 app/links/(联动)
wordbook/service.answer  ─┐                                               ┌─ mistakes.py   → link_mistake_words
wordbook/service.spell   ─┼─ publish(WordAnswered) ─┐                     │
routers/speech.create    ─┼─ publish(AssessmentFinished) ─► LearningBus ──┼─ pron_shadow.py → link_weak_words
routers/conversations    ─┘  publish(MessageSent) ─┘   (队列·超时·熔断)   ├─ chat_words.py → link_word_uses + link_credits
                                                        ▲ gate(联动键,用户) │
                                                        └──────────────────┤ gate.py:总开关 ∧ 联动开关 ∧ 用户偏好
                                                                           └─ rank_sources.py(登记来源;无订阅)
core/rank_sources.py(来源注册表) ◄── chat_words 登记 word_in_chat
rank/extra_sources.py ── 读 app.models.LinkCredit(不导入 links)── ledger._sync 一行导入 + 四行附加

网页:features/<x>/register*.ts ──contribute()──► lib/extension-points.ts(注册表 + 旗标)◄── plugins/links 拉取 /api/links/config
                                                           │
消费方:chat / lookup / progress / rooms / practice / vocabulary / me / app ── <Slot point=…/> (只导入 lib)
```

---

## 4. 服务端学习事件通道(`app/core/learning_events.py`)

### 4.1 选型:进程内有界 asyncio 队列 + 单消费任务(不用「提交后同步钩子」,不用 outbox)

| 方案 | 结论 | 理由 |
|---|---|---|
| 提交后同步钩子(在请求里直接调处理器) | 否 | 处理器的耗时与异常落在主请求路径上;要共享或另开会话;一个慢联动拖慢「提交答案」;隔离只能靠 try/except |
| 进程内有界队列 + 后台单任务(**选用**) | 是 | 发布 = `deque.append`(O(1),不 await),主请求零等待;每个处理器独立会话、独立超时;队列满丢弃并计数;单消费者保证同一进程内事件按发布顺序处理 |
| 持久化 outbox 表 + 轮询 | 否 | 需要额外表、轮询、清理与重放语义;联动是增强,丢失少量事件可接受(产品裁定:尽力而为),关键积分仍读源表 |

代价:进程崩溃或重启时丢失队列中尚未处理的事件(默认上限 1,000 条)。所有处理器幂等(自然键 / 唯一约束 / 单调时间戳),
因此重复处理无害;丢失只意味着某个错词没进易错词表、某次用词没被记录。多 worker 时每个进程各有一条通道,各自处理本进程
发布的事件;表写入靠唯一约束与条件更新保证正确。

### 4.2 事件目录(v1 发布的三种)

全部是 `@dataclass(frozen=True)`;时间一律 UTC 带时区;`event_id` 在构造时生成(`uuid4().hex`,32 位),只用于日志关联与去重。
构造时截断超长字段(`__post_init__`),不会抛错。

**`WordAnswered`** — 背单词每写一条**作答记录**就发布一条:即 `answer()` 与 `spell_submit()` 写的 `wordbook_events` 行,每行恰好一次。
`spell_set`(组完成)、B 计划的 `bonus` / `goal` / `reset`(不是作答)不发布;A 计划复习抽查的第一步(`outcome:"pending"`,不写事件)也不发布。

| 字段 | 类型 | 说明 |
|---|---|---|
| `user_id` | `int` | |
| `book_id` | `str` | 词书 id(≤ 16) |
| `word` | `str` | 规范化词键(与 `wordbook_events.word` 相同,截断 100) |
| `kind` | `str` | `learn` \| `relearn`(B)\| `review` \| `practice` \| `blank`(= 本次写入的事件种类) |
| `qtype` | `str \| None` | `meaning` / `word` / `cloze` / `dictation` / `spell` / `recall`(A)/ `spell_ctx` |
| `outcome` | `str` | 客观题 `correct` \| `typo` \| `inflection` \| `wrong`;三档自评(A,`qtype=recall`)`know` \| `know_chk` \| `fuzzy` \| `unknown`;`known` 只出现在 A 之前写的旧行(A 之后 `known:true` 记为 `know`) |
| `credit` | `int` | 0–100 |
| `at` | `datetime` | 即 service 里的 `now` |
| `event_id` | `str` | 自动 |

发布点(A/B 共享文件,纯附加,INDEX §3 R-E1):`server/app/wordbook/service.py` 共三处——
(1) `answer()` 客观题路径的 `await session.commit()` 之后、`return` 之前;
(2) A 新增的 `_rating_answer()` 末尾那次 `await session.commit()` 之后(`qtype=recall`,`outcome` = 写入的 outcome,`credit = 100 if eff == "know" else 0`);
    同函数里抽查 pending 分支的那次 `commit()`(只扣作答次数、不写事件)**不发布**;
(3) `spell_submit()` 里 `await session.commit()` 之后(按 `words` 列表逐词发布,`kind` 取该词写入的 `review` 或 `blank`)。

**`AssessmentFinished`** — 一次**已保存**的发音评测(`save=true`,有 `assessment_id`)。

| 字段 | 类型 | 说明 |
|---|---|---|
| `user_id` | `int` | |
| `assessment_id` | `str` | |
| `source` | `str` | `practice` \| `chat` \| …(`assessments.source`) |
| `score` | `int \| None` | `scores.pronunciation_score` 四舍五入 |
| `weak_words` | `tuple[WeakWord, ...]` | ≤ 32;`WeakWord(word: str, score: int \| None)`;判定与 `services.stats.poor_words` 相同(Mispronunciation/Omission 或准确度 < 60,Insertion 不算) |
| `good_words` | `tuple[str, ...]` | ≤ 64;准确度 ≥ 80 且无错误类型 |
| `at` | `datetime` | |
| `event_id` | `str` | 自动 |

发布点:`server/app/routers/speech.py` `create_assessment()` 在 `save_assessment(...)` 返回后(它内部已提交)。分桶用新增纯函数
`app.services.stats.word_buckets(result) -> (weak, good)`(与 `poor_words` 同一套规则,附带分数)。
「`SentencePracticed`」即 `source == "practice"` 的 `AssessmentFinished`(裁定 L-R2,不另设事件)。

**`MessageSent`** — 用户在 AI 对话里发出的一条消息(`role == "user"`)。

| 字段 | 类型 | 说明 |
|---|---|---|
| `user_id` | `int` | |
| `conversation_id` | `str` | |
| `message_id` | `str` | |
| `text` | `str` | 截断 4,000 字符;`repr=False`;只在内存里交给订阅者,**任何地方都不记录、不入库** |
| `at` | `datetime` | 消息 `created_at` |
| `event_id` | `str` | 自动 |

发布点:`server/app/routers/conversations.py` `create_messages()` 提交成功后,对 `rows` 中 `role == "user"` 的每条发布一次。

**保留名称(v1 不实现、不建类):** `WordSeen(source=lookup|chat|room, …)`(查词在网页侧,服务端无发布点)、`WordLearned` /
`WordReviewed`(= `WordAnswered.kind` 为 `learn` / `review`)、`SentencePracticed`(= `AssessmentFinished(source="practice")`)、
`PromotionPassed`、`WordAddedToNotebook`(v1 无订阅者)。新增事件:先在本文登记字段,再在核心文件加类与发布点。

### 4.3 发布 API 与绑定

```python
def bind(bus: LearningBus | None) -> None      # current_user 依赖里调用一次(同 metering.bind_user)
def publish(event) -> bool                     # 未绑定 / 总开关关 / 无订阅 / 队列满 → False;永不抛错
```

`app/core/deps.py::current_user` 在 `metering.bind_user(user.id)` 旁加一行
`learning_events.bind(getattr(request.app.state, "learning_bus", None))`。所有发布点都在已登录路由内,因此不需要改函数签名。

### 4.4 `LearningBus`

```python
class LearningBus:
    def __init__(self, settings: Callable[[], Any], *, clock: Callable[[], float] = time.monotonic) -> None
    def subscribe(self, event_type: type, link: str, handler: Callable[[Any], Awaitable[None]]) -> None
    def set_gate(self, gate: Callable[[str, int], Awaitable[bool]] | None) -> None
    def publish(self, event) -> bool
    async def drain(self) -> int          # 在调用方任务里处理完当前队列(测试与关停用)
    async def run(self) -> None           # 后台循环:等唤醒 → drain
    def stats(self) -> dict[str, dict]    # 每个联动的计数 + 熔断状态
    def queue(self) -> dict               # {"size", "max", "dropped"}
    def recent_errors(self) -> list[dict] # 最近 50 条 {"at","link","event","error"}
    def reset_breaker(self, link: str) -> bool
    def count(self, link: str, name: str, n: int = 1) -> None  # 联动自定义计数(如 llm_degraded),出现在 stats()[link]["extra"]
```

- `publish`:读 `settings()`(每次读,热更新);`links_enabled` 为假直接返回;没有任何订阅者直接返回;
  `len(queue) >= links_queue_max` → 丢弃(该事件每个订阅联动 `dropped += 1`,全局 `dropped += 1`),返回 False。
- 处理一条事件:对每个订阅 `(link, handler)` 依次:熔断打开 → `breaker_skipped += 1` 跳过;`gate(link, user_id)` 为假 →
  `skipped += 1`;否则 `asyncio.wait_for(handler(event), links_handler_timeout_ms / 1000)`。
- 计数(每联动):`published`、`handled`、`skipped`、`failed`、`timeouts`、`dropped`、`breaker_skipped`、`breaker_opens`、`last_ms`。
- 熔断:连续失败(异常或超时)达 `links_breaker_failures` → 打开 `links_breaker_cooldown_seconds`;到期后半开,下一条成功即关闭、
  失败立即再打开。管理员可手动复位(审计)。
- 错误记录:只记 `{"at": ISO, "link", "event": 类名, "error": 异常类名}`,环形 50 条;日志
  `links failure link=<k> event=<E> error=<Cls>`(logger `app.core.learning_events`),不带用户 id、词、文本、异常消息。
- 生命周期:`main.create_app` 建 `app.state.learning_bus`;lifespan 里 `tasks["links"] = create_task(bus.run())`;关停时
  先取消任务,再 `await bus.drain()` 一次(上限 2 秒,超时放弃)。测试不跑 lifespan,直接 `await bus.drain()`。
- 依赖:只用标准库(核心层规则)。

### 4.5 处理器契约(`app/links/*` 必须遵守)

1. 签名 `async def handle(app, event) -> None`,由联动的 `install(app, bus)` 用 `functools.partial` 绑定后订阅。
2. 自己开会话 `async with app.state.sessionmaker() as session:`,自己提交;不得复用请求会话。
3. **幂等**:同一事件处理两次结果相同(主键 / 唯一约束 + `IntegrityError` 吞掉,或 `WHERE last_event_at < :at` 的条件更新)。
4. **有界**:每条事件 ≤ 6 条 SQL、单次查询 ≤ 200 行;不发上游请求(唯一例外:`chat_words` 可选的大模型用法检查,
   独立超时 8 秒、全站日额度、402 降级,见 §6.5)。
5. 不检查开关:开关由 gate 统一判断(处理器内部只在需要「另一个联动」时问 `gate`,如 `chat_words` 写段位来源前问 `rank_sources`)。
6. 预期内的「没东西可做」直接返回;只有真正的异常才抛出(由通道计数)。
7. 日志与异常消息不含词、文本、用户输入。

### 4.6 gate(`app/links/gate.py`)

`effective(link, user) = settings.links_enabled ∧ settings.link_<key>_enabled ∧ user_pref(user, key)`;`user_pref` 缺行 = 开。
用户偏好进程内缓存 30 秒(`{user_id: (expires, {key: bool})}`,上限 10,000 个用户,LRU);`PUT /api/links/prefs` 在本进程立即失效。
多进程下其他进程最多 30 秒后生效(文档化)。

---

## 5. 段位点来源注册(联动 6 的机制)

### 5.1 注册表(`app/core/rank_sources.py`,核心层)

```python
@dataclass(frozen=True)
class RankSource:
    kind: str            # xp_events.kind,≤ 16 字符,[a-z_]
    default_points: int  # 规则里未设置时的点数
    label_zh: str
    label_en: str

def register(source: RankSource) -> None   # 同 kind 重复登记且内容相同 → 忽略;不同 → ValueError
def registered() -> tuple[RankSource, ...]
def kinds() -> frozenset[str]
def clear_for_tests() -> None
```

保留种类(不能登记):既有的 `assessment`、`voice_turn`、`chat_turn`、`vocab_review`、`active_day`、`streak_7`、`stage_task`、
`word_learned`、`spelling_set`(登记时 ValueError)。v1 唯一来源:`word_in_chat`(默认 1 点,「对话用到今日词」),由 `chat_words` 联动登记。

### 5.2 数据:`link_credits` 表

联动把「可以计分的事实」写进 `link_credits(user_id, kind, ref_id, score, created_at)`,唯一 `(user_id, kind, ref_id)`。
段位**只经 `app.models.LinkCredit` 读它**(同读 `wordbook_events` 的做法),绝不导入 `app.links`。

### 5.3 段位接入(附加,不改既有路径)

- 新文件 `app/rank/extra_sources.py`:
  - `collect(session, user_id, since, now, offset_minutes, rules) -> (list[Candidate], datetime | None)`:注册表为空 → `([], None)`,
    **不发查询**;否则读 `LinkCredit` 中 `kind ∈ kinds()`、`created_at >= since` 的行(上限 `MAX_SYNC_ROWS`),候选
    `Candidate(kind, ref_id, local_day(at), points, score, at)`,点数 = `rules.points.sources.get(kind, source.default_points)`
    (`rules is None` 时用 `default_points`);满上限时返回水位。
  - `capped(session, user_id, extra, batch, daily_cap, rules) -> list[Candidate]`:见 §5.4。
- `app/rank/ledger.py::_sync` 在 `events = rules.cap_daily(fresh, used, daily_cap)` 之后**附加四行**(取来源、合并水位、去重、追加封顶后的候选),外加一行导入(与计划 L6-1 一致)。
  既有四个来源的查询、`used` 查询、`cap_daily`、活跃日、连续、阶段任务代码一个字符不改。
- `app/rank/rules.py::PointsRule` 加两个带默认值的字段:`sources: dict[str, int] = {}`(每项 0–100,键 ≤ 16 且匹配 `[a-z_]+`)、
  `sources_daily_cap: int = 5`(0–100)。旧的已发布规则 JSON 照常解析(默认值),`DEFAULT_RULES` 与常量的逐项相等测试不变。
- 管理端段位规则编辑器保留这两个字段往返(`admin/src/features/rank/rules-schema.ts`),并显示一张「联动来源」小表
  (来源列表来自 `GET /api/admin/links` 的 `rank_sources`)。

### 5.4 与共享每日上限、阶段任务、规则版本的关系(裁定 L-R6)

- **既有种类的点数永远不因联动而变少**:`used` 查询仍只统计 `CAPPED` 既有种类,联动来源不进 `cap_daily`。
- 联动来源只吃**剩余额度**:对某本地日 d,`grant = min(points, max(0, cap − core_used(d) − extra_used(d)), max(0, sources_daily_cap − extra_used(d)))`,
  其中 `core_used(d)` = 该日既有 `CAPPED` 种类已入账点数 + 本批里这些种类封顶后的点数,`extra_used(d)` = 该日联动来源已入账点数。
  被削到 0 的候选仍写一行 `xp_events`(与既有的「被削事件保留 0 分行」一致),不会被重复评估。
- 后果(文档化):若联动来源在当天较早时入账,之后的既有活动仍按原规则得分,当天总和最多超出共享上限 `sources_daily_cap`(默认 5)。
  这是为保证「既有积分路径完全不变」而有意接受的上界。
- 阶段任务:联动来源**不计入任何阶段任务**(`StageTaskRule.kind` 字面量集合不变),不产生活跃日、不影响连续天数与成就。
- 版本:点数随段位规则版本走(`rules.points.sources`);进行中的比赛不涉及。管理端「影响预演」v1 不模拟联动来源
  (`rank_sim.recompute_points` 对未知种类返回 0,已验证),在预演页注明。
- `link_rank_sources_enabled` 关闭或用户关掉「联动段位点」→ 联动不再写 `link_credits`(已写的照常入账)。
- **证明既有段位测试不变**:验收时 `git diff <base>..HEAD -- server/tests/test_rank_*.py server/tests/test_admin_rank*.py` 为空且全部通过;
  新增 `test_rank_extra_sources.py` 断言:注册表为空时 `_sync` 产生的 `xp_events` 与 SQL 语句数和改动前一致;
  `link_credits` 为空时结果与注册表为空时逐行相同。

---

## 6. 六个联动

每个联动 = 服务端 `app/links/<key>.py`(`SPEC: LinkSpec`,可选 `install`、`router`)+ 网页 `plugins/<key>/index.ts`(+ 各 feature 的
`register-<key>.ts*`)。所有联动接口在联动对该用户无效时返回 404 `{"error": "Link is off"}`。

### 6.1 单词操作位置(`word_actions`)

**产品。** 四处原来的「加入生词本」按钮原样保留(同测试 id、同无障碍名、同防连点与「已在生词本中」状态)。开关打开时,它旁边
多一个 44px「更多」图标按钮(`data-testid="<原 testId>-more"`,无障碍名「更多操作:<词>」),点开底部面板「单词操作」:

| 行 | 提供方 | 条件 | 行为 |
|---|---|---|---|
| 加入生词本 | vocabulary(`wordActionsMenu`) | 总是 | 同主按钮 |
| 加入词书学习 | wordbook | 背单词已开启 | `POST /api/links/wordbook/adopt`:当前在学的书里有这个词且用户还没有该词条 → 建一条 `box 0`、立即到期的词条(`source="wordbook:<book>"`,**不写 learn 事件、不得段位点**),下一次复习出现;已有词条 → 「已在学习中」;书里没有 → 行禁用并显示「当前词书里没有这个词」 |
| 跟读这个词 | practice | 总是 | `goPractice(navigate, example ?? word)` |
| 查看词卡 | wordbook | 背单词已开启 | `POST /api/links/wordbook/card`(body `{"word"}`;词不进 URL / 访问日志)→ 面板内显示词卡(复用 `WordCardView`,懒加载);找不到 → 「词书里没有这个词」 |

**插槽。** `wordActions`(行内,props `WordActionProps`)与 `wordActionsMenu`(面板里的行)。vocabulary 的行内贡献**不带联动键**
(核心贡献,任何开关下都在),「更多」按钮由 `plugins/word-actions` 以 `link: "word_actions"` 贡献。全关时插槽只渲染核心贡献,
与今天逐字节一致(测试对照 `AddVocabularyButton` 直出的 `innerHTML`)。

**查词。** `vocabularyFromLookup` 搬进 lookup feature 并改名 `wordTargetFromLookup`(输出字段与原函数逐项相同,先写对照测试再搬);
截断上限常量 `MAX_WORD_TARGET = {word: 100, meaning: 1000, example: 500}` 放进 `lib/extension-points.ts`(与
`vocabulary-api.ts` 的 `MAX_VOCAB_*` 由测试保持相等)。

### 6.2 今日任务聚合卡(`daily_tasks`)

**产品。** 练习页段位卡、背单词卡之下一张「今日任务」卡:标题「今日任务」+ 右侧「3/5 完成」;每行一个任务(图标片 + 名称 + 进度/状态 +
chevron,整行 ≥ 56px 可点):

| 行 | 提供方 | 数据 | 完成条件 | 点击 |
|---|---|---|---|---|
| 背单词 | wordbook | `GET /api/wordbook/today` 的 `plan` | `plan.goal_met ∨ (new_left == 0 ∧ review_left == 0)`(B 的达标口径,不含加练;旧服务端无 `goal_met` 时只看后半;`plan` 为 null(暂停/未选书)时整行不出现) | `/wordbook` |
| 跟读一句 | practice | `GET /api/links/today` 的 `practice_today` | ≥ 1 | 滚动到跟读区(`#shadowing`) |
| 对话一次 | chat | 同上 `chat_messages_today` | ≥ 1 | `/chat` |
| 段位阶段任务 | rank | `GET /api/rank/me` 的 `stage_tasks` | 全部 `complete` | `/rank` |
| 对话用今日词 | plugins/chat-words(联动 5) | `GET /api/links/chat-words` | `used_count ≥ min(3, 今日词数)`;今日词为 0 时不出现 | `/chat` |

没有任何行(都不可用)时整卡不渲染;某提供方未启用(背单词关、段位关)其行不出现。完成行用绿色勾 + `ink-2` 文案,未完成显示
`done/target` 数字。`/api/rank/me` 会触发同步:rank 提供方对同一 `ApiClient` 30 秒内复用一次结果。

**插槽。** `practiceHome`(练习页卡片,plugins/daily-tasks 贡献整张卡)与 `dailyTasks`(卡内每行,各 feature 贡献)。

**服务端。** `GET /api/links/today?offset=<-720..840>` → `{"practice_today": int, "chat_messages_today": int, "conversations_today": int}`,
按用户本地日计数(`assessments.source='practice'` 与 `messages.role='user'`),只返回数字。

### 6.3 易错词(`mistakes`)

**产品。** 生词本页「全部」列表上方一行入口「易错词 · 12」(琥珀图标片),进入 `/links/mistakes`:按错次数降序列出;每行:词、
释义一行(取用户该词条的 `meaning`)、「错 3 次 · 2 天前」、盒子进度点;行尾 `<WordActions>`(同 §6.1)与「移出」。
顶部说明「背单词里答错的词会自动出现在这里;连续答对 2 次后自动移出」。底部按钮「去拼写练习」(`/wordbook/spell`)。
空态:「还没有易错词。」

**规则。**
- 进入(算错):`outcome ∈ {wrong, inflection}`(笔误 `typo` 不算),或 `outcome == unknown` 且 `kind ∈ {review, practice}`(A 的复习「不认识」、
  抽查答错、「记错了」、当天再评降为不认识)。新词第一次自评为「不认识」(`kind ∈ {learn, relearn}`)**不算错**——那是新词,不是错题。
  `wrong_count += 1`,`ok_streak = 0`,`last_wrong_at = at`,清除 `cleared_at`。
- 移出(算对):`outcome ∈ {correct, know, known}` 时 `ok_streak += 1`;达到 2 → `cleared_at = at`。用户「移出」同样设 `cleared_at`。
- 中性(不改任何字段、不推进 `last_event_at`):`fuzzy`、`know_chk`(待抽查,由随后的小测结果决定)、`typo`。
- 幂等:每行带 `last_event_at`,更新条件 `last_event_at < :at`;同一事件重放不会再加一次。首次插入冲突(并发)→ 退回条件更新。
- 上限:每用户活跃(`cleared_at IS NULL`)最多 200 个;超出时最旧 `last_wrong_at` 的那个被标记移出。
- 虚拟视图:**不新增也不复制 `vocabulary_items`**;列表接口左连接 `vocabulary_items`(同用户同词最早一行)取释义与盒子。

**接口。** `GET /api/links/mistakes?page=1` → `{"items": [{"word","wrong_count","last_wrong_at","meaning","box","due_at","book_id"}], "next", "total"}`
(每页 20);`POST /api/links/mistakes/dismiss {"word"}` → `{"word"}`。

### 6.4 发音弱词 ↔ 跟读(`pron_shadow`)

**产品(弱词)。** 跟读(`source="practice"`)评测里低分的词进入「发音弱词」。入口两处:练习页跟读区参考文本框上方的来源条
(`learningSources` 插槽)里一枚「发音弱词 6」片;生词本页「易错词」下方一行「发音弱词 · 6」。`/links/weak-words` 页:每行词 +
「最近 52 分 · 出现 3 次」(分数按评分色阶:< 70 `ink-2`,70–84 琥珀,≥ 85 绿)+ 两个 44px 动作:「跟读」(带例句时跟读例句,
否则跟读单词,走现有评测接口与录音配额)与「拼写」(词在当前词书里时进入该词词卡面板;否则禁用)。顶部主按钮「连读这 5 个」把前
5 个弱词拼成一句参考文本去跟读。

- 进入:`AssessmentFinished(source="practice")` 的每个 `weak_words` 项:`hits += 1`,`last_score = score`,`ok_streak = 0`。
- 移出:之后的评测里该词出现在 `good_words` → `ok_streak += 1`;达到 2 → `cleared_at`。用户可「移出」。
- 幂等与上限同 §6.3(`last_event_at` 条件更新,活跃 ≤ 200)。
- 聊天里的语音评测(`source="chat"`)v1 不进入(裁定 L-R3)。

**产品(今日新词例句)。** 来源条里另一枚「今日新词 8」片:点开小面板列出今天学的新词及其第一条例句(英 + 中),点一行把例句填进
跟读参考文本(和从查词「去跟读」同一路径),**仍走现有评测与配额**。

**接口。** `GET /api/links/weak-words` → `{"items": [{"word","hits","last_score","last_weak_at","example"}], "total"}`(≤ 50;`example`
取用户该词条的 `example`,可为 null);`POST /api/links/weak-words/dismiss {"word"}`;`GET /api/links/today-words?offset=` →
`{"items": [{"key","word","example": {"en","zh"} | null}]}`(≤ 20;今日 = 用户本地日本书 `kind ∈ {learn, relearn}` 的事件(随 B 的 `store.LEARN_KINDS`),`wordbook.store.today_learned_keys`
+ 词典卡片第一条例句;背单词未开或无在学书 → `items: []`)。

### 6.5 对话用到今日词(`chat_words`)

**产品。** 用户在 AI 对话里自然地用到「今日词」时,服务端记一次「用过」。可见处:今日任务卡里的「对话用今日词 2/3」一行(本联动自己的行);
背单词词卡(`wordDetailSections` 插槽)显示「今天在对话里用过」青色小标;段位「最近获得」出现「对话用到新词 +1」。

**检测(无大模型)。**
- 今日词 = 该用户在**过去 24 小时**内的 `wordbook_events.kind = 'learn'` 行(≤ 200),键 → 事件 id。(消息请求不带时区,
  用滚动 24 小时代替本地日;裁定 L-R4。)B 的 `relearn`(删掉 / 重置后重学)**不算**今日词:每个词每人一生只有一次 `learn`,
  所以 `word_in_chat` 每词最多一次,重置不能刷联动段位点(INDEX R-P4)。
- 文本 → `wordbook.textnorm.tokenize`;单词键:任一 token 的 `lemma_candidates(token)` 含该键(`textnorm` 已保证候选能变回原形,
  避免 bed→be);多词键:`textnorm.find_form(text, key)` 非空。
- 每个命中且未记过的 `learn` 事件:写 `link_word_uses(user_id, word, learn_event_id, message_id, created_at)`(唯一
  `(user_id, learn_event_id)`,每个学会的词只记第一次);若 `rank_sources` 对该用户有效,同时写
  `link_credits(kind="word_in_chat", ref_id="wic:<learn_event_id>")`。
- 每人每 24 小时最多记 `link_chat_words_daily_max`(默认 10)个。
- **不改盒子与到期**(裁定 L-R5);掌握度的记账体现在「用过」记录、展示与段位点上。

**可选大模型用法检查(默认关)。** `link_chat_words_llm_enabled = true` 时,对命中的词再问一次大模型「这个词在这句里用法是否正确」,
只有「是」才记段位点(「用过」照记)。判定**不在通道处理器里等待**(8 秒会堵住单消费者):处理器把待判定的词交给
`chat_words.JudgeRunner`(并发 2、待办 ≤ 50),由它异步写 `link_credits`;待办满则直接按确定性结果入账并计数。约束:全站每日 `link_chat_words_llm_global_daily` 次(`services.usage.consume("links_llm", "global", utc_day, cap)`),
单次超时 8 秒;上游 402(余额不足)/429/5xx/超时/解析失败 → **降级为确定性结果**(照常记分)并计数 `llm_degraded`;
`metering.record("llm", …)` 在 `feature_scope("links")` 下记录;提示词与回复不记日志。当前上游 402,所以默认关是正确的。

**接口。** `GET /api/links/chat-words?offset=` → `{"today": [{"word","used"}], "used_count"}`(今日词列表 + 是否已用)。

### 6.6 段位点来源注册(`rank_sources`)

见 §5。用户侧开关名「联动加段位点」:关闭后本用户的联动不再写 `link_credits`。管理端开关 `link_rank_sources_enabled` 同义(全站)。
本联动没有事件订阅,`install` 只做 `rank_sources.register(...)` 之外的事(`chat_words` 自己登记 `word_in_chat`;本联动负责 gate 键与说明)。

---

## 7. 开关

### 7.1 全局(设置注册表,新组 `("links", "学习联动")`,全部 `apply="hot"`)

| 键(env = 大写) | 类型 | 默认 | 范围 | 标签 | 说明 / danger |
|---|---|---|---|---|---|
| `links_enabled` | bool | `false` | | 学习联动总开关 | 关闭 = 与未安装联动完全相同 |
| `link_word_actions_enabled` | bool | `true` | | 单词操作位置 | |
| `link_daily_tasks_enabled` | bool | `true` | | 今日任务聚合卡 | |
| `link_mistakes_enabled` | bool | `true` | | 易错词 | |
| `link_pron_shadow_enabled` | bool | `true` | | 发音弱词与跟读 | |
| `link_chat_words_enabled` | bool | `true` | | 对话用到今日词 | |
| `link_rank_sources_enabled` | bool | `true` | | 联动段位点 | danger「打开后联动可以给段位加点(每日最多 sources_daily_cap)」 |
| `links_queue_max` | int | 1000 | 10–10000 | 事件队列上限 | 满了丢弃并计数 |
| `links_handler_timeout_ms` | int | 2000 | 100–10000 | 单个处理器超时(毫秒) | |
| `links_breaker_failures` | int | 5 | 1–100 | 熔断连续失败次数 | |
| `links_breaker_cooldown_seconds` | int | 60 | 5–3600 | 熔断冷却(秒) | |
| `links_retention_days` | int | 90 | 7–365 | 联动记录保留天数 | 见 §12 |
| `link_chat_words_daily_max` | int | 10 | 1–50 | 每人每日最多记录今日词 | |
| `link_chat_words_llm_enabled` | bool | `false` | | 今日词大模型用法检查 | danger = 「打开后会产生上游费用」 |
| `link_chat_words_llm_global_daily` | int | 200 | 0–10000 | 用法检查全站每日次数 | danger = 同上 |

所有写入经 `admin/settings_service.save`(审计 `settings.update`);注册表与 `Settings` 字段由 `tests/test_settings_registry.py` 保持一一对应。

### 7.2 每用户(`user_link_prefs`)

- 表:`(user_id, link_key, enabled, updated_at)`,主键 `(user_id, link_key)`;没有行 = 开。
- `GET /api/links/config` → `{"enabled": bool, "links": [{"key","global","user","effective"}]}`(六项,顺序固定;`enabled` = 总开关)。
- `PUT /api/links/prefs {"key": <LinkKey>, "enabled": bool}` → 同 `config`;总开关关时 404 `{"error": "Links are disabled"}`;未知键 422。
- 网页「我的 → 学习 → 学习联动」(只在总开关开时出现)进入 `/me/links`:六行开关,每行标题 + 一句说明;全局关的行开关禁用并显示
  「管理员已关闭」。切换即保存(乐观更新,失败回滚并 toast)。

---

## 8. 网页扩展点

### 8.1 注册表(`web/src/lib/extension-points.ts`,纯 TS,只类型导入 React)

```ts
export type LinkKey = "word_actions" | "daily_tasks" | "mistakes" | "pron_shadow" | "chat_words" | "rank_sources";
export interface LinkFlags { enabled: boolean; links: Record<LinkKey, boolean> }   // effective(每用户)
export const ALL_OFF: LinkFlags;

export interface WordTarget { word: string; meaning?: string; example?: string; source: "lookup" | "recap" | "progress" | "manual" }
export interface WordActionProps { target: WordTarget; testId: string; label?: string; variant: "icon" | "labeled" }
export interface PointProps {
  wordActions: WordActionProps;          // 行内动作(核心:加入生词本;联动:更多)
  wordActionsMenu: WordActionProps & { close: () => void };  // 「单词操作」面板里的行
  dailyTasks: { today: TodayCounts | null };                 // 今日任务卡里的行
  practiceHome: Record<string, never>;   // 练习页卡片
  learningSources: { pick: (text: string) => void };          // 跟读区来源条
  wordDetailSections: { word: string };  // 词卡底部
  notebookViews: Record<string, never>;  // 生词本页入口行
  meRows: Record<string, never>;         // 我的 → 学习 分组里的行
  appEffects: Record<string, never>;     // 登录后挂载一次的无界面组件
}
export interface Contribution<N extends keyof PointProps> {
  point: N; id: string; order?: number; link?: LinkKey; requiresLinks?: boolean; component: ComponentType<PointProps[N]>;
}
export interface RouteContribution { id: string; path: string; link?: LinkKey; requiresLinks?: boolean; component: ComponentType }

export function contribute<N extends keyof PointProps>(c: Contribution<N>): void   // 同 id 重复 → 抛错
export function contributeRoute(r: RouteContribution): void
export function contributionsFor<N extends keyof PointProps>(point: N, flags: LinkFlags): Contribution<N>[]  // 过滤 + 按 order、id 排序
export function routesFor(flags: LinkFlags): RouteContribution[]
export function setLinkFlags(next: LinkFlags): void; export function getLinkFlags(): LinkFlags
export function subscribeLinkFlags(fn: () => void): () => void
export function resetExtensionPointsForTests(): void
```

过滤规则:`link` 有值 → `flags.links[link]`;`requiresLinks` → `flags.enabled`;两者都没有 = 核心贡献,永远显示。

### 8.2 React 侧(`web/src/lib/extension-points-react.tsx`)

`useLinkFlags()`(`useSyncExternalStore`)、`useContributions(point)`、`<Slot point props />`(每个贡献包一层错误边界:贡献抛错时
渲染 null 并 `console.warn("[slot] <point>/<id> failed")`,不打印 props)、`<WordActions target testId label variant />`(= `wordActions` 插槽的便捷包装)。

### 8.3 登记与组合

- `web/src/plugins/index.ts`(由 `main.tsx` 导入一次):`import "./core"; import "./links"; import "./word-actions"; import "./daily-tasks"; import "./mistakes"; import "./pron-shadow"; import "./chat-words";`(联动 6 只在服务端,没有网页插件)
- `plugins/core.ts`:`import "~/features/vocabulary/register";`(加入生词本行内 + 面板行;无联动键)。测试 `test/setup.ts` 只导入 `~/plugins/core`,
  所以现有测试看到的正是「全关」状态。
- `plugins/links/`:`appEffects` 贡献(登录后拉取 `/api/links/config` → `setLinkFlags`;卸载时 `ALL_OFF`)、`meRows` 贡献(「学习联动」行,
  `requiresLinks`)、路由 `/me/links`(`requiresLinks`)、设置页。
- `plugins/<link>/index.ts`:导入该联动在各 feature 的 `register-<link>.ts*` 并登记插件自己的 UI(卡片、页面、路由)。
- 消费方插入点(全部只导入 `~/lib/extension-points-react`):chat 回顾两处、lookup 一处、progress 一处、rooms 小结一处(`<WordActions>`);
  practice 页 `practiceHome` 与 `learningSources` 各一处;vocabulary 页 `notebookViews` 一处;wordbook 词卡 `wordDetailSections` 一处;
  me 页 `meRows` 一处;`app.tsx` 路由 `routesFor(flags)` 与 `appEffects` 一处。

### 8.4 架构规则(`web/src/architecture.test.ts` 新增,既有规则不放宽)

1. `plugins/` 是新的组合层:只有 `main.tsx` 导入 `plugins/index`,`test/setup.ts` 可导入 `plugins/core`;features、pages、layout、lib、
   components、api、audio 都不得导入 `plugins/`。
2. `features/<x>/register*.ts(x)` 只能被 `plugins/**` 导入;`plugins/**` 只能以 `~/features/<x>`(index)或 `~/features/<x>/register*` 两种方式引用 feature。
3. 注册文件不得导入其他 feature(贡献不能制造跨 feature 边)。
4. **跨 feature 边冻结**:feature→feature 的导入对只许出现在基线表里(当前 21 条减去 §1 的四条 `→vocabulary` 与随 `vocabularyFromLookup` 搬家消失的 `vocabulary→lookup`,即 16 条);新增一条即失败。
5. `AddVocabularyButton` 只许在 `features/vocabulary/` 内部被引用。
6. 每个 `PointProps` 键至少被一个产品文件以 `point="<键>"`(或 `<WordActions`)渲染;每个 `contribute({ point })` 的点都存在(类型系统 + 测试)。

---

## 9. 管理端

- 设置页自动出现「学习联动」组(注册表驱动,不写新前端)。
- 新页 `/admin/links`(导航「配置」组,「学习联动」):
  - 顶部:总开关状态 + 「去设置」链接;队列 `size / max`、累计丢弃;「本进程统计,重启清零」小字。
  - 表格(每联动一行):名称、全局开关(只读徽标,点「去设置」改)、生效状态、`handled / skipped / failed / timeouts / dropped`、
    熔断状态(关 / 打开至 HH:mm / 半开)、关闭了该联动的用户数(`user_link_prefs.enabled = false` 计数)、操作「复位熔断」(operator,
    审计 `links.breaker.reset`,摘要只含联动键)。
  - 「段位来源」小表:`kind`、默认点数、当前规则点数、标签。
  - 「最近错误」列表(≤ 50):时间、联动、事件类型、异常类名。永不显示用户 id、词或文本。
- 接口:`GET /api/admin/links`(viewer)、`POST /api/admin/links/{key}/reset-breaker`(operator,CSRF,审计)。
- 诊断(`admin/doctor.py`):`links_breaker_open`(任一联动熔断打开,warn)、`links_dropping`(最近有丢弃,warn)——事实由
  `doctor.gather_facts` 读 `app.state.learning_bus.stats()`(核心对象,管理层无需导入 `app.links`)。
- 用量:`chat_words` 的大模型调用按 `feature="links"` 出现在用量页(既有计量,无前端改动;`admin/src/features/usage/strings.ts` 加标签「学习联动」)。

---

## 10. 数据模型(迁移 `0013_learning_links`,`down_revision = "0012"`)

```
user_link_prefs     user_id FK users ON DELETE CASCADE, link_key String(24), enabled Boolean NOT NULL, updated_at DateTime(tz)
                    PK (user_id, link_key)
link_mistake_words  user_id FK CASCADE, word String(100), book_id String(16), wrong_count Integer default 0, ok_streak Integer default 0,
                    last_event_at DateTime(tz), last_wrong_at DateTime(tz), cleared_at DateTime(tz) NULL
                    PK (user_id, word); Index ix_link_mistake_words_user_id_cleared_at (user_id, cleared_at)
link_weak_words     user_id FK CASCADE, word String(100), hits Integer default 0, last_score Integer NULL, ok_streak Integer default 0,
                    last_event_at DateTime(tz), last_weak_at DateTime(tz), cleared_at DateTime(tz) NULL
                    PK (user_id, word); Index ix_link_weak_words_user_id_cleared_at (user_id, cleared_at)
link_word_uses      id Integer PK autoincrement, user_id FK CASCADE, word String(100), learn_event_id Integer, message_id String(36),
                    created_at DateTime(tz)
                    UniqueConstraint uq_link_word_uses_user_learn (user_id, learn_event_id); Index ix_link_word_uses_user_id_created_at
link_credits        id Integer PK autoincrement, user_id FK CASCADE, kind String(16), ref_id String(80), score Integer NULL,
                    created_at DateTime(tz)
                    UniqueConstraint uq_link_credits_user_kind_ref (user_id, kind, ref_id); Index ix_link_credits_user_id_created_at
```

- SQLite batch + Postgres 安全;往返测试(升级、写一行、降级到 0012 删除这五张表、再升级)。
- `test_migrations.py::test_models_match_migrations` 保持绿色;单 head 断言由 `"0012"` 改为 `"0013"`(C 合并时改;A、B 不动它)。
- 删除用户:`admin/users_admin.delete_user` 的显式删除列表加这五张表(SQLite 无 FK 级联)。

---

## 11. API 总览

| 方法 路径 | 联动 | 角色 | 响应 |
|---|---|---|---|
| `GET /api/links/config` | — | 用户 | §7.2 |
| `PUT /api/links/prefs` | — | 用户 | §7.2 |
| `GET /api/links/today?offset=` | daily_tasks | 用户 | §6.2 |
| `POST /api/links/wordbook/adopt` | word_actions | 用户 | `{"status": "added"\|"known"\|"not_in_book", "book_id": str\|null}` |
| `POST /api/links/wordbook/card` `{"word"}`(只读;POST 让词不进 URL 与访问日志) | word_actions | 用户 | `{"book_id", "card": <wordbook card_out>, "item": {"box","due_at"}\|null}`;404 `Word not found` |
| `GET /api/links/mistakes?page=` / `POST /api/links/mistakes/dismiss` | mistakes | 用户 | §6.3 |
| `GET /api/links/weak-words` / `POST /api/links/weak-words/dismiss` | pron_shadow | 用户 | §6.4 |
| `GET /api/links/today-words?offset=` | pron_shadow | 用户 | §6.4 |
| `GET /api/links/chat-words?offset=` | chat_words | 用户 | §6.5 |
| `GET /api/admin/links` | — | viewer | §9 |
| `POST /api/admin/links/{key}/reset-breaker` | — | operator | `{"key","state":"closed"}` |

错误统一 `{"error": "..."}`;新错误原文:`Links are disabled`、`Link is off`、`Unknown link`、`Word not found`、`Wordbook is disabled`。
网页映射表 `LINKS_SERVER_ERRORS`(`plugins/links/links-api.ts`)。词作为请求体 / 查询参数传递,长度 ≤ 100,经
`services.vocabulary.validate_word` 规范化;不作路径参数。契约样例 `server/tests/fixtures/links_contract.json`(`CONTRACT_UPDATE=1` 重录),
网页 `plugins/links/links-contract.test.ts` 逐键核对。

---

## 12. 隐私、保留、限流

- 消息正文:只在 `MessageSent` 事件对象里、只在内存队列中存在到处理完毕;`link_word_uses` 只存词键与 `message_id`。
- 日志:通道与联动只记联动键、事件类名、异常类名、毫秒、计数;`caplog` 测试断言不出现词、文本、`event_id` 以外的标识。
- 保留:每日一次清理任务(`app.state.background_tasks["links_purge"]`,由 `app/links/purge.py` 提供、`main.py` 注册):删除
  `link_word_uses.created_at` 早于 `links_retention_days` 的行,删除 `cleared_at` 早于 30 天的易错词 / 弱词行。`link_credits` 与
  其他段位来源一样不清理(行很小,段位同步按水位读取)。`user_link_prefs` 随用户删除。
- 限流:所有 `/api/links/*` 用 `current_user`(读接口)或 `limited_user`(写接口:prefs、adopt、dismiss);队列上限、处理器超时、
  每用户每日今日词上限、大模型全站日额度见 §7.1;活跃易错词 / 弱词各 ≤ 200。

---

## 13. 分层规则(服务端,`server/tests/test_architecture.py`)

- 新层 `links`:可导入 `links, core, models, providers, speech, services, rank, rooms, wordbook`;**不可**导入 `realtime, admin, routers`。
- 只有 `routers` 与 `main` 可以导入 `links`(含函数内延迟导入、相对导入、`from app import links`)。
- `rank` 读 `LinkCredit` 经 `app.models`;`core/learning_events.py`、`core/rank_sources.py` 只依赖标准库(核心层规则已覆盖)。
- 新测试 `test_links_is_top_layer`(临时目录树:`rank`/`admin`/`wordbook`/`services` 导入 `app.links` 均报错;`routers` 不报;`links`
  导入 `routers` 报错)。
- `server/app/CLAUDE.md` 分层表加 `links/` 一行;新目录 `app/links/CLAUDE.md`。

---

## 14. 无障碍、国际化、深色

- 所有新控件 ≥ 44px 命中区;「更多」按钮有带词的无障碍名;底部面板用现有 `BottomSheet`(焦点圈定、Esc 关闭、关闭后焦点回到「更多」按钮)。
- 今日任务行是 `<a>`/`<button>`,完成状态写进无障碍名(「背单词,已完成」);进度数字 `tabular-nums`。
- 开关行用 `role="switch"` + `aria-checked`,禁用时 `aria-disabled` 并读出「管理员已关闭」。
- 文案:每个插件目录 `plugins/<x>/i18n/{zh-CN,en}.json`、feature 注册文件用其 feature 的 i18n;`i18n.test.ts` 的键对齐检查覆盖。
  服务端新错误原文都有网页映射。
- 深色:只用设计令牌(`ink`、`surface`、`hair`、语义色 tint);视觉稿含深色帧。

---

## 15. 测试策略(全部真实代码,不靠快照凑数)

| 层 | 测试文件 | 断言 |
|---|---|---|
| 核心通道 | `server/tests/test_learning_events.py` | 总开关关 → `publish` False 且队列空;无订阅不入队;顺序;处理器异常不影响下一个订阅者;超时计数;队满丢弃计数;熔断打开/冷却/半开/复位;gate 跳过;`bind` 跨请求隔离;日志不含文本(`caplog`);截断 |
| 来源注册 | `test_rank_sources.py` | 重复登记、保留种类拒绝、`kinds()` |
| 段位接入 | `test_rank_extra_sources.py` | 注册表空 → 不查询且结果与基线一致;共享上限只吃剩余;子上限;0 分行保留;阶段任务不变;水位 |
| 开关 | `test_links_gate.py`、`test_links_api.py` | 三级开关真值表;缓存与失效;config/prefs 形状与错误 |
| 每个联动 | `test_links_mistakes.py`、`test_links_pron_shadow.py`、`test_links_chat_words.py`、`test_links_word_actions.py`、`test_links_daily_tasks.py` | 用真实 app + 内存 SQLite,发布真实事件后 `await bus.drain()`;幂等(同一事件两次);上限;开关关时无写入;接口形状;大模型 402 降级(respx) |
| 发布点 | `test_links_publishers.py` | 背单词作答(客观题与 A 的三档自评各一次;复习抽查 pending 不发布,第二步发布一次)/ 拼写提交、评测保存、发消息各发布一次正确字段的事件;B 的 `bonus`/`goal`/`reset` 不发布;总开关关时不入队;发布失败不影响响应 |
| 全开 / 全关矩阵 | `test_links_matrix.py` | 参数化 `links_enabled ∈ {F,T}` × 每个联动开关:既有接口响应逐字节相同(背单词作答、评测、消息、生词本列表);只有开时才出现联动表行 |
| 架构 | `test_architecture.py` | §13 |
| 迁移 | `test_migrations.py` | 0013 往返 |
| 管理端 | `test_admin_links.py` | 角色、审计、无秘密、无 PII |
| 网页注册表 | `lib/extension-points.test.ts(x)` | 登记、过滤、排序、重复 id、旗标订阅、错误边界 |
| 网页矩阵 | `plugins/links-matrix.test.tsx` | 全关:四处 `<WordActions>` 的 `innerHTML` 与直接渲染 `AddVocabularyButton` 相同、无 `-more`、练习页无今日任务卡;全开:出现「更多」、今日任务卡、来源条、易错词入口 |
| 网页联动 | 各 `plugins/<x>/*.test.tsx` 与 `features/<x>/register-*.test.tsx` | 行为与中文文案 |
| 网页架构 | `architecture.test.ts` | §8.4 |
| 契约 | `server/tests/test_links_contract.py` + `web/src/plugins/links/links-contract.test.ts` | 键逐一 |
| E2E(大纲) | `web/e2e/links.spec.ts` | E2E 栈加 `LINKS_ENABLED=true`、`WORDBOOK_ENABLED=true`:选书学 5 词并故意答错 1 个 → 生词本出现「易错词 · 1」;练习页出现今日任务卡且「背单词」行有进度;查词结果里点「更多」看到四行;「我的 → 学习联动」关掉「易错词」后入口消失;不调用评测与大模型(零上游) |

---

## 16. 与 A、B 共享的文件与插入点(只做附加)

| 文件 | 归属 | 本文改动(精确插入点) |
|---|---|---|
| `server/app/wordbook/service.py` | A、B | `answer()` 客观题路径:`await session.commit()` + 下一行 `# Ruling Z-e` 之间插入 `learning_events.publish(WordAnswered(...))`;A 的 `_rating_answer()`:末尾 `await session.commit()` + 下一行 `checked = p.mode == "review" …` 之间插入一条发布(pending 分支不发布);`spell_submit()`:`await session.commit()` 之后插入发布循环;文件头加一行 `from app.core import learning_events`。不改任何既有行(INDEX §4) |
| `web/src/features/wordbook/word-card.tsx` | A | `WordCardView` 返回的 `SurfaceCard` 内、A 新增的 `{covered ? (…遮罩…) : (<div id={regionId}>…释义/例句/短语…</div>)}` 块之后、`</SurfaceCard>` 之前插入 `{covered ? null : <Slot point="wordDetailSections" props={{ word: card.key }} />}`(遮罩时不渲染联动区,不泄露任何释义相关信息);文件头加一行导入 |
| `web/src/features/practice/practice-page.tsx` | 仅 C(A、B 实际不改) | `<WordbookCard className="mt-2" />`(现第 173 行)之后插入 `<Slot point="practiceHome" props={{}} />`;跟读 `SectionGroup`(现第 174 行)加 `id="shadowing"`,其 `Textarea` 之前插入 `<Slot point="learningSources" props={{ pick: setReference }} />`(以实际 setter 名为准) |
| `web/src/pages/me-page.tsx` | 仅 C(A、B 实际不改) | 「学习」分组里 `<WordbookMeRow />`(现第 191 行)之后插入 `<Slot point="meRows" props={{}} />` |
| `server/app/core/config.py`、`settings_registry.py`、`server/.env.example`、`server/app/models.py`、`server/app/main.py`、`server/tests/test_migrations.py`、`server/tests/test_settings_registry.py` | A、B 改 `config.py` / `settings_registry.py`(背单词段);其余仅 C | `config.py`:在 `wordbook_data_dir: str = ""` 之后追加(A 的 4 个字段在它之前、B 的 6 个字段紧跟 `wordbook_review_cap`);`settings_registry.py`:`GROUPS` 在 `("wordbook", "背单词")` 后加 `("links", "学习联动")`,15 条追加在 `_ALL` 末尾(A 的 4 条在 `# admin` 之前,B 替换两条为八条);合并顺序 A → B → C,冲突全部是「两边都保留」(INDEX §4) |
| `web/src/app.tsx`、`web/src/main.tsx` | 仅 C(A、B 实际不改) | `app.tsx`:`AppShell` 路由内追加 `routesFor(flags).map(...)`、`appEffects` 插槽;`main.tsx`:`import "./plugins";` 一行 |

C 独占(A/B 不碰):`server/app/links/**`、`server/app/core/{learning_events,rank_sources}.py`、`server/app/rank/extra_sources.py`、
`server/app/routers/{links,admin_links}.py`、`server/alembic/versions/0013_learning_links.py`、`web/src/lib/extension-points*`、
`web/src/plugins/**`、各 feature 的 `register*.ts(x)` 与 `wordbook/link-actions.tsx`、`admin/src/features/links/**`。

---

## 17. 风险与对策

| 风险 | 对策 |
|---|---|
| 进程崩溃丢事件 | 文档化为可接受;处理器幂等;关键积分读源表;管理端可见丢弃计数 |
| 慢处理器堆积队列 | 单处理器超时 2 秒 + 熔断 + 队列上限丢弃;发布方永不等待 |
| 多进程偏好缓存不一致 | 30 秒 TTL,文档化;本进程写入即时失效 |
| 联动段位点被刷 | 每个学会的词只记一次(唯一 `learn_event_id`);每日 10 个;子上限 5 RP;只吃剩余额度 |
| 「对话用词」误判(同形词、bed→be) | 复用 `textnorm.lemma_candidates` 的反向校验;多词键要求整体匹配;不改盒子,误判代价只是 1 RP 与一个标记 |
| 插件注册副作用让首屏变大 | 注册文件只导入轻组件,重组件 `lazy()`;验收比较主包体积(增长 ≤ 8 kB gzip 前 30 kB) |
| 测试里模块缓存与 `vi.mock` 冲突 | `test/setup.ts` 只导入 `plugins/core`;联动测试各自导入所需插件 |
| 与 A/B 的文件冲突 | §16 精确插入点、合并顺序 A → B → C、C 最后 rebase |
| 迁移号冲突 | 本文 0013;开工第一步 `alembic heads` 必须输出 `0012`,否则按 INDEX §5 顺延为 head + 1 并改全部引用 |
| 上游 402 | 大模型用法检查默认关;开了也降级为确定性 |

---

## 18. 裁定与待定问题(默认裁定)

- **L-R1** 选进程内有界队列 + 单消费任务(§4.1);不做 outbox。
- **L-R2** `SentencePracticed` 合并进 `AssessmentFinished(source)`;`WordLearned`/`WordReviewed` 合并进 `WordAnswered(kind)`;一个插入点一次发布。
- **L-R3** 发音弱词 v1 只收跟读(`source="practice"`),不收聊天语音评测。*待定:要不要把聊天语音也收进来?默认不收。*
- **L-R4** 「今日词」在对话检测里 = 过去 24 小时内学的新词(消息请求无时区)。*待定:是否给消息接口加 `offset` 以用本地日?默认不加。*
- **L-R5** 对话用到今日词不改盒子与到期,只记「用过」+ 可选段位点。*待定:是否把一次正确使用算作一次「较好」复习?默认否(保持 P-W2 确定性)。*
- **L-R6** 联动段位点只吃剩余额度、有子上限、不进阶段任务与活跃日(§5.4)。*待定:子上限 5 是否合适?默认 5。*
- **L-R7** 总开关 `links_enabled` 默认关;各联动开关默认开(打开总开关即六个全开)。*待定:默认开?默认关(升级后行为不变)。*
- **L-R8** 「加入词书学习」不写 `learn` 事件、不得段位点、不推进书序游标;只对当前在学书里的词生效。
- **L-R9** 练习页的 `RankCard`/`WordbookCard` 直引不在本次搬动(列入跨 feature 基线)。
- **L-R10** 管理端计数为进程内存、重启清零;不落库。
- **L-R11** 迁移号 0013、`down_revision="0012"`,合并顺序 A → B → C;C 的实现分支在 A、B 合并后 rebase 到 main 再合并(只碰 C 独占文件的任务可提前开发,见 `plans/2026-10-11-wordbook-links-INDEX.md` §2)。

---

## 19. 需要真机确认的项(实现后在 `docs/superpowers/plans/e2e-results.md` 标注已验证 / 未验证)

- iOS Safari / 安卓 Chrome:「更多」底部面板的打开、焦点回归、滚动穿透;面板里「跟读这个词」跳转后录音权限仍在用户手势内申请。
- 练习页多一张卡后的滚动与玻璃顶栏表现(≤ 3 层模糊)、375×667 小屏。
- VoiceOver / TalkBack 读出今日任务行完成状态与开关的禁用原因。
- 深色模式下琥珀/青色小标对比度(≥ 4.5:1 文本)。
- PWA 已安装用户升级后新路由 `/me/links`、`/links/mistakes`、`/links/weak-words` 可直达(service worker 回退)。
- 真实上游下「今日新词例句」跟读的评测配额与录音配额照常扣减。
