# 背单词 v2 · 每日目标设置面板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 选书后随时在首页打开「每日目标」底部面板修改每日新词(1–200,预设 + 自定义步进)、每日复习上限(10–1000 或「不限」)、顺序,看到三个方案(轻松/标准/冲刺)的「约 N 天学完」与稳定复习量,今天加练、暂停/继续、换书、重置进度(输入书名确认),显示连续达标天数;全部服务端校验、限流,管理员可在设置注册表收窄范围(自动审计),无数据库迁移。

**Architecture:** 服务端在 `app/wordbook/plan.py` 增加纯函数(有效值夹取、校验、计划含加练与积压修正、连续天数),`store.py` 追加选书设置/加练/达标/重置的数据函数,`service.py` 改写选书与计划部分并追加 `patch_enrollment`、`grant_bonus`、`pause`、`resume`、`reset_progress`,`routers/wordbook.py` 追加 5 个端点(重置前在路由层同步段位);「不限」= `review_cap = 0`,加练/达标/重置/重学记进已有 `wordbook_events`(新 kind,段位不读)。网页新增 `goals-math.ts`(估算与计划预览,和服务端共用一份样例表)、`goals-stepper.tsx`、`goals-fields.tsx`(选书页与面板共用)、`goals-sheet.tsx`、`use-goals.ts`(乐观更新),改写 `home-page.tsx` 与 `books-page.tsx`。

**Tech Stack:** FastAPI + SQLAlchemy 2 async + pydantic v2 + pytest-asyncio(Python 3.12,uv);React 18 + react-router + Tailwind 3 + Radix Dialog/AlertDialog + vitest + Testing Library + lucide-react;Playwright。不新增依赖,不新增迁移。

**Spec:** `docs/superpowers/specs/2026-10-11-wordbook-goals-design.md`(视觉稿 `docs/superpowers/design/wordbook-goals-v1/mockup.html`)。前置:`docs/superpowers/specs/2026-10-10-wordbook-design.md`(含 §7 评审修订)、`docs/superpowers/plans/2026-10-10-wordbook.md`、`docs/superpowers/design/redesign-v3/design-notes.md`。

## Global Constraints

- **合并顺序(跨计划)**:A(回忆式学习流程,迁移 `0013`)→ **B(本计划)** → C(学习联动,迁移 `0015`)。本计划从 A 合并后的分支头 rebase;**不新增迁移**。若实施中证明必须加列:迁移文件 `server/alembic/versions/0014_wordbook_goals.py`,`revision = "0014"`,`down_revision = "0013"`,并在本计划加 Addendum。
- **文件归属**:本计划独占 `server/app/wordbook/plan.py`、`server/app/core/{config,settings_registry,runtime_settings}.py` 中的背单词范围键、`web/src/features/wordbook/{home-page,books-page,use-today,use-wordbook-config}.tsx/ts`、新文件 `goals-*`、`use-goals.ts` 及其测试、文案 `web.wordbook.goals.*`。共享文件(`service.py`、`store.py`、`routers/wordbook.py`、`wordbook-api.ts`、契约测试与样例、两个 v1 测试文件)只在本计划列出的插入点做**追加或单点修改**(spec §14)。**不碰**学新词/复习页、会话机、题型(A)与跨模块挂点(C);`plan-ring.tsx` 本期不改。
- 分层不变:`server/tests/test_architecture.py`、`web/src/architecture.test.ts` 不放宽;`wordbook` 层不导入 `rank`(段位同步只在 `routers/wordbook.py` 调用)。
- 范围与默认(spec §3、§10):每日新词硬边界 1–200、复习上限 10–1000(`app.core.config.WORDBOOK_NEW_BOUNDS = (1, 200)`、`WORDBOOK_REVIEW_BOUNDS = (10, 1000)`);「不限」存 `review_cap = 0`;默认 20 / 100;加练每次 ≤ 20、每天 ≤ `wordbook_bonus_max`(50);积压保护 = 当天新词总数(含加练)最多 5 个,「不限」时阈值 `wordbook_review_cap_max`。
- 限流:`PATCH /enrollment`、`/enrollment/pause`、`/enrollment/resume`、`/bonus` 共用每人每 UTC 日 60 次(`daily_usage` 范围 `wordbook_settings`);`/enrollment/reset` 每人每 UTC 日 2 次(`wordbook_resets`)。先校验后扣次数。
- 事件 kind(全部 ≤ 12 字符):`relearn`(计入今日新词,无段位点)、`bonus`(`credit` = 加练数)、`goal`(一天一行)、`reset`。段位 `ledger._collect` 只读 `learn`/`spell_set`,不改。
- 错误响应 `{"error": "..."}`,原文见 spec §9;网页映射进 `WORDBOOK_SERVER_ERRORS` → `web.wordbook.goals.errors.*`。日志与审计不记确认文本、不记用户输入。
- 网页文案只放 `web/src/features/wordbook/i18n/{zh-CN,en}.json` 的 `goals` 子树(中英齐全,英文计数用 `_one/_other`);页面测试设 `zh-CN` 并断言中文。
- 视觉(redesign-v3):蓝 = 主操作/选中;青 = 词书;琥珀 = 连续天数、积压与超上限;红只给「重置进度」;触控 ≥ 44px;深色令牌;界面不用 emoji;面板是 `BottomSheet`(Radix Dialog,焦点困住、Esc 关闭、焦点回到触发按钮)。
- 每个任务结束:`cd server && uv run pytest -q <任务列出的测试> tests/test_architecture.py`;涉及网页 `yarn web:typecheck && cd web && yarn vitest run src/features/wordbook src/architecture.test.ts`;车道合并前跑全量 `cd server && uv run pytest -q` 与 `yarn web:typecheck && yarn web:test && yarn web:build`。提交 conventional(`feat(server): …`、`feat(web): …`、`test(…)`、`docs: …`),一个任务一个逻辑提交,信息以 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` 结尾。
- 数字取自 spec;改数字先改 spec。

---

## 文件结构

```
server/
  app/core/config.py                 + WORDBOOK_NEW_BOUNDS / WORDBOOK_REVIEW_BOUNDS、6 个新字段、放宽 2 个字段
  app/core/settings_registry.py      放宽 2 条、登记 6 条(分组 wordbook)
  app/core/runtime_settings.py       runtime_problems 追加 2 条交叉校验
  app/wordbook/plan.py               REVIEW_UNLIMITED、GoalLimits、effective_goals、goals_error、compute_plan(新参数 + 修正)、DayPlan(+bonus, goal_met)、streak_of
  app/wordbook/store.py              LEARN_KINDS 口径;enroll 默认值修正;追加 update_goals / pause_active / latest_paused / bonus_today / mark_goal / goal_days / reset_book / consume_settings / consume_reset
  app/wordbook/service.py            limits_of / limits_out / DEFAULT_LIMITS;config_out / enrollment_out / put_enrollment / _day_plan / today_out 改写;answer() 一行 relearn;追加 patch_enrollment / grant_bonus / pause / resume / reset_progress
  app/routers/wordbook.py            EnrollmentIn 放宽;追加 PATCH /enrollment、POST /enrollment/{pause,resume,reset}、POST /bonus;_settle_rank
  tests/fixtures/wordbook_plan_cases.json   计划样例表(服务端与网页共用)
  tests/test_wordbook_goals_plan.py  tests/test_wordbook_goals_settings.py  tests/test_wordbook_goals_api.py  tests/test_wordbook_goals_actions.py
  tests/test_wordbook_contract.py + fixtures/wordbook_contract.json   (追加 GOALS_KEYS / collect_goals,重录)
  tests/test_wordbook_api.py、tests/test_wordbook_learn_limits.py     (各单点改断言)
  app/wordbook/CLAUDE.md             (追加 pitfalls)
web/src/features/wordbook/
  goals-math.ts (+test)  goals-stepper.tsx (+test)  goals-fields.tsx (+test)  goals-sheet.tsx (+test)  use-goals.ts (+test)
  goals-test-fixtures.ts  goals-api.test.ts
  wordbook-api.ts  wordbook-contract.test.ts  use-today.ts  home-page.tsx (+test)  books-page.tsx (+test)  i18n/{zh-CN,en}.json  i18n.test.ts  CLAUDE.md
web/e2e/wordbook-goals.spec.ts
```

## 并行车道、文件归属与合并顺序

| 车道 | 任务 | 独占文件(车道进行期间只有它改) | 依赖 |
|---|---|---|---|
| **server GS**(一个执行者,串行) | GS1–GS5 | 上表 `server/` 下全部文件 | A 已合并;GS1 是本计划第一个合并的提交 |
| **web GW**(一个执行者,串行) | GW1–GW6 | 上表 `web/` 下全部文件 | 开发与 GS 并行(用 fetch 模拟);GW1 读 GS1 的样例表;GW2 起需 GS5 的契约样例 |
| **review Z** | Z1 | `docs/superpowers/plans/2026-10-11-wordbook-goals.md`(勾选与结果)| GS、GW 全部合并 |

两条车道没有共同文件:唯一的跨车道输入是只读的 `server/tests/fixtures/wordbook_plan_cases.json`(GS1 写)与 `server/tests/fixtures/wordbook_contract.json`(GS5 写)。

**合并顺序**:GS1 → GS2 → GS3 → GS4 → GS5 → GW1 → GW2 → GW3 → GW4 → GW5 → GW6 → Z1。GW 车道在 GS5 合并后 rebase(GW1 只需 GS1)。若 A 在本计划开发期间才合并,GS3 rebase 时把 `answer()` / `learn_batch` / `review_batch` 的三处单点修改重新落到 A 的等价位置,行为测试不变。

**评审波**:每条车道合并前 `/code-review high`;GS 车道另跑 `security-review`(输入校验、限流、重置的删除范围、段位同步、日志卫生);GW 车道合并前在浏览器窗格 375×812 浅色 + 深色对照视觉稿 01–09 帧,并用键盘走一遍面板(Tab 顺序、Esc、焦点返回)。Z1 对整个分支跑 `security-review` 与全量测试。

## 本计划的裁定

- **G-1 … G-9** 见 spec §16(面板唯一入口、范围与哨兵、积压修正、`relearn` 口径、加练规则、达标定义、重置范围、估算模型、Addendum)。
- **GP-1** `_day_plan(..., *, settings=None)` 是计划的唯一入口;`settings` 缺省时按硬边界计算(旧调用点不传也不会绕过加练与每日上限)。`learn_batch`、`review_batch`、`answer` 三处调用点传 `settings=settings`。
- **GP-2** `enrollment_out(e, limits)` 返回夹过的有效值;库里的值只有用户保存时才改(无迁移、不回写)。
- **GP-3** 网页 `previewPlan` 与服务端 `compute_plan` 用同一份 `wordbook_plan_cases.json` 测试;任何一边改计划规则都必须改这份表。
- **GP-4** 加练、暂停、继续、重置不做乐观更新;只有 `PATCH /enrollment` 乐观更新,失败回退,按序号丢弃过期响应。
- **GP-5** 网页 `goals-test-fixtures.ts` 只在 v1 `test-fixtures.ts` 的样例上追加字段,不修改 v1 样例(A/C 也在用)。

---

## Lane server (GS)

### Task GS1: 计划纯函数(有效值、校验、加练、积压修正、达标、连续天数)与共用样例表

**Files:**
- Modify: `server/app/wordbook/plan.py`
- Create: `server/tests/fixtures/wordbook_plan_cases.json`、`server/tests/test_wordbook_goals_plan.py`

**Interfaces:**
- Consumes:v1 `plan.py`(`BACKLOG_NEW = 5`、`DayPlan`、`compute_plan`)
- Produces(`app.wordbook.plan`):
  - `REVIEW_UNLIMITED: int = 0`
  - `@dataclass(frozen=True) class GoalLimits: new_min: int; new_max: int; review_min: int; review_max: int; unlimited: bool; bonus_max: int`
  - `DayPlan` 追加字段 `bonus: int = 0`、`goal_met: bool = False`(在 `backlog_guard` 之后;`asdict` 键序 = v1 七键 + `bonus`, `goal_met`)
  - `compute_plan(*, daily_new: int, review_cap: int | None, new_done: int, review_done: int, review_due: int, bonus: int = 0, guard_threshold: int | None = None, remaining: int | None = None) -> DayPlan`
  - `effective_goals(daily_new: int, review_cap: int, limits: GoalLimits) -> tuple[int, int | None]`
  - `goals_error(limits: GoalLimits, *, daily_new: int | None, review_cap: int | None, unlimited: bool) -> str | None`
  - `streak_of(days: Iterable[str], today: str) -> int`

- [ ] **Step 1: 写样例表** — `server/tests/fixtures/wordbook_plan_cases.json`(`in` 为 `compute_plan` 的关键字参数,`out` 为 `asdict(DayPlan)`;网页 GW1 用同一文件):

```json
[
  {"name": "basic", "in": {"daily_new": 20, "review_cap": 100, "new_done": 3, "review_done": 10, "review_due": 40},
   "out": {"new_target": 20, "new_done": 3, "new_left": 17, "review_due": 40, "review_done": 10, "review_left": 40, "backlog_guard": false, "bonus": 0, "goal_met": false}},
  {"name": "backlog_first_five", "in": {"daily_new": 20, "review_cap": 100, "new_done": 0, "review_done": 95, "review_due": 140},
   "out": {"new_target": 20, "new_done": 0, "new_left": 5, "review_due": 140, "review_done": 95, "review_left": 5, "backlog_guard": true, "bonus": 0, "goal_met": false}},
  {"name": "backlog_total_is_five", "in": {"daily_new": 20, "review_cap": 100, "new_done": 5, "review_done": 100, "review_due": 140},
   "out": {"new_target": 20, "new_done": 5, "new_left": 0, "review_due": 140, "review_done": 100, "review_left": 0, "backlog_guard": true, "bonus": 0, "goal_met": true}},
  {"name": "raised_mid_day", "in": {"daily_new": 35, "review_cap": 100, "new_done": 20, "review_done": 0, "review_due": 0},
   "out": {"new_target": 35, "new_done": 20, "new_left": 15, "review_due": 0, "review_done": 0, "review_left": 0, "backlog_guard": false, "bonus": 0, "goal_met": false}},
  {"name": "lowered_below_done", "in": {"daily_new": 10, "review_cap": 100, "new_done": 20, "review_done": 0, "review_due": 0},
   "out": {"new_target": 10, "new_done": 20, "new_left": 0, "review_due": 0, "review_done": 0, "review_left": 0, "backlog_guard": false, "bonus": 0, "goal_met": true}},
  {"name": "bonus_after_goal", "in": {"daily_new": 20, "review_cap": 100, "new_done": 20, "review_done": 30, "review_due": 0, "bonus": 10},
   "out": {"new_target": 30, "new_done": 20, "new_left": 10, "review_due": 0, "review_done": 30, "review_left": 0, "backlog_guard": false, "bonus": 10, "goal_met": true}},
  {"name": "unlimited_backlog", "in": {"daily_new": 20, "review_cap": null, "new_done": 0, "review_done": 0, "review_due": 1500, "guard_threshold": 1000},
   "out": {"new_target": 20, "new_done": 0, "new_left": 5, "review_due": 1500, "review_done": 0, "review_left": 1500, "backlog_guard": true, "bonus": 0, "goal_met": false}},
  {"name": "unlimited_ok", "in": {"daily_new": 20, "review_cap": null, "new_done": 0, "review_done": 0, "review_due": 300, "guard_threshold": 1000},
   "out": {"new_target": 20, "new_done": 0, "new_left": 20, "review_due": 300, "review_done": 0, "review_left": 300, "backlog_guard": false, "bonus": 0, "goal_met": false}},
  {"name": "few_words_left", "in": {"daily_new": 20, "review_cap": 100, "new_done": 0, "review_done": 0, "review_due": 0, "remaining": 7},
   "out": {"new_target": 20, "new_done": 0, "new_left": 7, "review_due": 0, "review_done": 0, "review_left": 0, "backlog_guard": false, "bonus": 0, "goal_met": false}},
  {"name": "book_finished", "in": {"daily_new": 20, "review_cap": 100, "new_done": 3, "review_done": 0, "review_due": 0, "remaining": 0},
   "out": {"new_target": 20, "new_done": 3, "new_left": 0, "review_due": 0, "review_done": 0, "review_left": 0, "backlog_guard": false, "bonus": 0, "goal_met": true}},
  {"name": "cap_lowered_below_done", "in": {"daily_new": 20, "review_cap": 50, "new_done": 0, "review_done": 80, "review_due": 30},
   "out": {"new_target": 20, "new_done": 0, "new_left": 20, "review_due": 30, "review_done": 80, "review_left": 0, "backlog_guard": false, "bonus": 0, "goal_met": false}},
  {"name": "no_activity", "in": {"daily_new": 20, "review_cap": 100, "new_done": 0, "review_done": 0, "review_due": 0},
   "out": {"new_target": 20, "new_done": 0, "new_left": 20, "review_due": 0, "review_done": 0, "review_left": 0, "backlog_guard": false, "bonus": 0, "goal_met": false}}
]
```

- [ ] **Step 2: 写失败测试** — `server/tests/test_wordbook_goals_plan.py`:

```python
"""goals v2 纯函数(spec 2026-10-11 §3–§6)。样例表与网页 goals-math.test.ts 共用(计划 GP-3)。"""
import json
from dataclasses import asdict
from pathlib import Path

import pytest

from app.wordbook.plan import (BACKLOG_NEW, REVIEW_UNLIMITED, GoalLimits, compute_plan, effective_goals, goals_error,
                               streak_of)

CASES = json.loads((Path(__file__).parent / "fixtures" / "wordbook_plan_cases.json").read_text(encoding="utf-8"))
LIMITS = GoalLimits(new_min=1, new_max=200, review_min=10, review_max=1000, unlimited=True, bonus_max=50)
NARROW = GoalLimits(new_min=5, new_max=50, review_min=20, review_max=300, unlimited=False, bonus_max=0)


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_compute_plan_matches_the_shared_table(case):
    assert asdict(compute_plan(**case["in"])) == case["out"]


def test_v1_calls_keep_their_results():
    p = compute_plan(daily_new=20, review_cap=100, new_done=3, review_done=10, review_due=40)
    assert (p.new_left, p.review_left, p.backlog_guard, p.bonus) == (17, 40, False, 0)
    assert list(asdict(p))[-2:] == ["bonus", "goal_met"]


def test_effective_goals_clamps_without_touching_storage():
    assert effective_goals(100, 500, NARROW) == (50, 300)
    assert effective_goals(1, 10, NARROW) == (5, 20)
    assert effective_goals(20, REVIEW_UNLIMITED, NARROW) == (20, 300)  # 「不限」被管理员关掉:按上限
    assert effective_goals(20, REVIEW_UNLIMITED, LIMITS) == (20, None)
    assert effective_goals(20, 100, LIMITS) == (20, 100)


def test_goals_error_messages():
    assert goals_error(LIMITS, daily_new=1, review_cap=1000, unlimited=False) is None
    assert goals_error(LIMITS, daily_new=None, review_cap=None, unlimited=True) is None
    assert goals_error(NARROW, daily_new=60, review_cap=None, unlimited=False) == "Daily new words out of range"
    assert goals_error(NARROW, daily_new=None, review_cap=10, unlimited=False) == "Review cap out of range"
    assert goals_error(NARROW, daily_new=None, review_cap=None, unlimited=True) == "Unlimited reviews are off"
    assert goals_error(LIMITS, daily_new=None, review_cap=100, unlimited=True) == "Conflicting review cap"


@pytest.mark.parametrize("days,today,expected", [
    (["2026-10-09", "2026-10-10", "2026-10-11"], "2026-10-11", 3),
    (["2026-10-09", "2026-10-10"], "2026-10-11", 2),  # 今天还没达标:从昨天往回数
    (["2026-10-08", "2026-10-10", "2026-10-11"], "2026-10-11", 2),
    (["2026-10-08"], "2026-10-11", 0),
    ([], "2026-10-11", 0),
    (["2026-09-30", "2026-10-01", "2026-10-01"], "2026-10-01", 2),  # 跨月;重复的日子只算一次
])
def test_streak_of(days, today, expected):
    assert streak_of(days, today) == expected


def test_constants():
    assert BACKLOG_NEW == 5 and REVIEW_UNLIMITED == 0
```

- [ ] **Step 3: 跑测试确认失败** — Run: `cd server && uv run pytest -q tests/test_wordbook_goals_plan.py` → FAIL(`ImportError: cannot import name 'REVIEW_UNLIMITED'`)

- [ ] **Step 4: 实现** — `server/app/wordbook/plan.py`:
  - 导入改为 `from collections.abc import Iterable, Mapping, Sequence` 与 `from datetime import date, datetime, timedelta, timezone`。
  - `BACKLOG_NEW = 5` 之后加 `REVIEW_UNLIMITED = 0  # wordbook_enrollments.review_cap 的「不限」哨兵(合法上限 ≥ 10;spec 2026-10-11 §3.1)`。
  - `DayPlan` 在 `backlog_guard: bool` 后追加 `bonus: int = 0` 与 `goal_met: bool = False`。
  - 用下面的代码替换 v1 的 `compute_plan`,并在其后加入其余函数:

```python
@dataclass(frozen=True)
class GoalLimits:
    """管理员允许的范围(设置注册表 wordbook_*_min/max 等,spec 2026-10-11 §10)。"""
    new_min: int
    new_max: int
    review_min: int
    review_max: int
    unlimited: bool
    bonus_max: int


def compute_plan(*, daily_new: int, review_cap: int | None, new_done: int, review_done: int, review_due: int,
                 bonus: int = 0, guard_threshold: int | None = None, remaining: int | None = None) -> DayPlan:
    """review_cap=None 表示「不限」,积压阈值改用 guard_threshold。

    积压保护(G-3):到期数超过阈值时,今天的新词总数(含加练)最多 BACKLOG_NEW 个 —— v1 写成
    min(new_left, 5),每学完 5 个又给 5 个,保护不生效。remaining = 本书未学的词数(None = 不限制)。
    达标(G-6)= 新词学满(不含加练;积压时 5 个;书快学完时按剩余)+ review_left 为 0 + 当天有活动。"""
    threshold = review_cap if review_cap is not None else guard_threshold
    guard = threshold is not None and review_due > threshold
    target = daily_new + bonus
    new_left = max(0, (min(target, BACKLOG_NEW) if guard else target) - new_done)
    if remaining is not None:
        new_left = min(new_left, max(0, remaining))
    review_left = review_due if review_cap is None else min(review_due, max(0, review_cap - review_done))
    goal_new = min(daily_new, BACKLOG_NEW) if guard else daily_new
    if remaining is not None:
        goal_new = min(goal_new, new_done + max(0, remaining))
    met = new_done + review_done > 0 and new_done >= goal_new and review_left == 0
    return DayPlan(target, new_done, new_left, review_due, review_done, review_left, guard, bonus, met)


def effective_goals(daily_new: int, review_cap: int, limits: GoalLimits) -> tuple[int, int | None]:
    """库里的值夹到当前范围(GP-2);(新词, 复习上限 | None=不限)。管理员关掉「不限」时按 review_max。"""
    new = min(max(daily_new, limits.new_min), limits.new_max)
    if review_cap == REVIEW_UNLIMITED:
        return new, None if limits.unlimited else limits.review_max
    return new, min(max(review_cap, limits.review_min), limits.review_max)


def goals_error(limits: GoalLimits, *, daily_new: int | None, review_cap: int | None, unlimited: bool) -> str | None:
    """用户提交的值在管理员范围内吗?返回错误原文(spec §9)或 None。"""
    if unlimited and review_cap is not None:
        return "Conflicting review cap"
    if daily_new is not None and not limits.new_min <= daily_new <= limits.new_max:
        return "Daily new words out of range"
    if review_cap is not None and not limits.review_min <= review_cap <= limits.review_max:
        return "Review cap out of range"
    if unlimited and not limits.unlimited:
        return "Unlimited reviews are off"
    return None


def streak_of(days: Iterable[str], today: str) -> int:
    """连续达标天数:今天已达标从今天往回数,否则从昨天往回数(G-6,无冻结)。days 为 ISO 本地日。"""
    have = {date.fromisoformat(d) for d in days}
    cur = date.fromisoformat(today)
    if cur not in have:
        cur -= timedelta(days=1)
    n = 0
    while cur in have:
        n += 1
        cur -= timedelta(days=1)
    return n
```

- [ ] **Step 5: 跑测试确认通过** — Run: `cd server && uv run pytest -q tests/test_wordbook_goals_plan.py tests/test_wordbook_plan.py tests/test_architecture.py` → PASS(v1 `test_wordbook_plan.py` 不改仍通过)

- [ ] **Step 6: 提交**

```bash
git add server/app/wordbook/plan.py server/tests/fixtures/wordbook_plan_cases.json server/tests/test_wordbook_goals_plan.py
git commit -m "feat(server): wordbook goal limits, bonus-aware plan, backlog fix and streaks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task GS2: 范围设置键、注册表与交叉校验

**Files:**
- Modify: `server/app/core/config.py`、`server/app/core/settings_registry.py`、`server/app/core/runtime_settings.py`
- Create: `server/tests/test_wordbook_goals_settings.py`

**Interfaces:**
- Produces(`app.core.config`):`WORDBOOK_NEW_BOUNDS = (1, 200)`、`WORDBOOK_REVIEW_BOUNDS = (10, 1000)`;`Settings.wordbook_daily_new`(20,1–200)、`wordbook_review_cap`(100,10–1000)、`wordbook_daily_new_min`(1)、`wordbook_daily_new_max`(200)、`wordbook_review_cap_min`(10)、`wordbook_review_cap_max`(1000)、`wordbook_review_unlimited`(True)、`wordbook_bonus_max`(50,0–200)
- Produces(`runtime_problems`):`"WORDBOOK_DAILY_NEW must be within WORDBOOK_DAILY_NEW_MIN..WORDBOOK_DAILY_NEW_MAX"`、`"WORDBOOK_REVIEW_CAP must be within WORDBOOK_REVIEW_CAP_MIN..WORDBOOK_REVIEW_CAP_MAX"`

- [ ] **Step 1: 写失败测试** — `server/tests/test_wordbook_goals_settings.py`:

```python
"""goals v2 范围设置(spec 2026-10-11 §10):默认值、硬边界、交叉校验、管理员收窄走审计。"""
import pytest
from cryptography.fernet import Fernet
from sqlalchemy import select

from app.admin import settings_service as svc
from app.admin.audit import Actor
from app.core.config import WORDBOOK_NEW_BOUNDS, WORDBOOK_REVIEW_BOUNDS
from app.core.runtime_settings import runtime_problems
from app.core.settings_registry import SPECS, effective_bounds
from app.models import AdminAudit
from tests.admin_helpers import ADMIN_ENABLED
from tests.conftest import make_settings

ROOT = Actor("root", "superadmin", "s1", "203.0.113.5")
NEW_KEYS = ("wordbook_daily_new_min", "wordbook_daily_new_max", "wordbook_review_cap_min", "wordbook_review_cap_max",
            "wordbook_review_unlimited", "wordbook_bonus_max")


@pytest.fixture
def settings_overrides():
    return {**ADMIN_ENABLED, "settings_encryption_key": Fernet.generate_key().decode()}


def test_defaults_and_hard_bounds():
    s = make_settings()
    assert (s.wordbook_daily_new, s.wordbook_review_cap) == (20, 100)
    assert (s.wordbook_daily_new_min, s.wordbook_daily_new_max, s.wordbook_review_cap_min, s.wordbook_review_cap_max,
            s.wordbook_review_unlimited, s.wordbook_bonus_max) == (1, 200, 10, 1000, True, 50)
    assert WORDBOOK_NEW_BOUNDS == (1, 200) and WORDBOOK_REVIEW_BOUNDS == (10, 1000)
    assert effective_bounds(SPECS["wordbook_daily_new"]) == (1, 200)
    assert effective_bounds(SPECS["wordbook_review_cap"]) == (10, 1000)
    assert effective_bounds(SPECS["wordbook_bonus_max"]) == (0, 200)
    assert all(SPECS[k].group == "wordbook" and SPECS[k].apply == "hot" and not SPECS[k].danger for k in NEW_KEYS)


def test_runtime_problems_cross_check_ranges():
    assert runtime_problems(make_settings()) == []
    assert runtime_problems(make_settings(wordbook_daily_new_max=10)) == [
        "WORDBOOK_DAILY_NEW must be within WORDBOOK_DAILY_NEW_MIN..WORDBOOK_DAILY_NEW_MAX"]
    assert runtime_problems(make_settings(wordbook_review_cap_min=200)) == [
        "WORDBOOK_REVIEW_CAP must be within WORDBOOK_REVIEW_CAP_MIN..WORDBOOK_REVIEW_CAP_MAX"]


async def test_admin_narrowing_is_audited_and_inverted_ranges_are_rejected(app):
    async with app.state.sessionmaker() as s:
        result = await svc.save(s, app, ROOT, {"wordbook_daily_new_max": 50, "wordbook_review_unlimited": False},
                                reason="smaller plans")
    assert sorted(result.changed) == ["wordbook_daily_new_max", "wordbook_review_unlimited"]
    assert (app.state.settings.wordbook_daily_new_max, app.state.settings.wordbook_review_unlimited) == (50, False)
    async with app.state.sessionmaker() as s:
        audit = (await s.scalars(select(AdminAudit).order_by(AdminAudit.id))).all()
    assert audit[-1].action == "settings.update" and "wordbook_daily_new_max" in audit[-1].target_id
    async with app.state.sessionmaker() as s:
        with pytest.raises(svc.SettingsError) as err:
            await svc.save(s, app, ROOT, {"wordbook_daily_new_min": 60})  # 下限 > 默认 20 且 > 上限 50
    assert err.value.status == 422
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd server && uv run pytest -q tests/test_wordbook_goals_settings.py` → FAIL(`ImportError: cannot import name 'WORDBOOK_NEW_BOUNDS'`)

- [ ] **Step 3: 实现**

`server/app/core/config.py`:在 `WORDBOOK_BOOK_IDS = (...)` 下一行加

```python
WORDBOOK_NEW_BOUNDS = (1, 200)  # 每日新词硬边界(spec 2026-10-11 §3.1);管理员只能在其中收窄
WORDBOOK_REVIEW_BOUNDS = (10, 1000)  # 每日复习上限硬边界;「不限」在库里存 0
```

把背单词段的两个字段替换并追加六个字段(紧跟 `wordbook_review_cap` 之后):

```python
    wordbook_daily_new: int = Field(20, ge=WORDBOOK_NEW_BOUNDS[0], le=WORDBOOK_NEW_BOUNDS[1])
    wordbook_review_cap: int = Field(100, ge=WORDBOOK_REVIEW_BOUNDS[0], le=WORDBOOK_REVIEW_BOUNDS[1])
    # 用户可选范围(spec 2026-10-11 §10;交叉校验在 runtime_settings.runtime_problems)
    wordbook_daily_new_min: int = Field(1, ge=WORDBOOK_NEW_BOUNDS[0], le=WORDBOOK_NEW_BOUNDS[1])
    wordbook_daily_new_max: int = Field(200, ge=WORDBOOK_NEW_BOUNDS[0], le=WORDBOOK_NEW_BOUNDS[1])
    wordbook_review_cap_min: int = Field(10, ge=WORDBOOK_REVIEW_BOUNDS[0], le=WORDBOOK_REVIEW_BOUNDS[1])
    wordbook_review_cap_max: int = Field(1000, ge=WORDBOOK_REVIEW_BOUNDS[0], le=WORDBOOK_REVIEW_BOUNDS[1])
    wordbook_review_unlimited: bool = True
    wordbook_bonus_max: int = Field(50, ge=0, le=200)
```

`server/app/core/settings_registry.py`:把 `wordbook_daily_new` / `wordbook_review_cap` 两条替换为下面八条(位置不变):

```python
    _s("wordbook_daily_new", "wordbook", "int", "默认每日新词", help_zh="新选书的默认值", min=1, max=200),
    _s("wordbook_review_cap", "wordbook", "int", "默认每日复习上限", help_zh="新选书的默认值", min=10, max=1000),
    _s("wordbook_daily_new_min", "wordbook", "int", "每日新词下限", help_zh="用户可选的最小值"),
    _s("wordbook_daily_new_max", "wordbook", "int", "每日新词上限", help_zh="用户可选的最大值"),
    _s("wordbook_review_cap_min", "wordbook", "int", "每日复习上限·下限"),
    _s("wordbook_review_cap_max", "wordbook", "int", "每日复习上限·上限", help_zh="也是「不限」时的积压阈值"),
    _s("wordbook_review_unlimited", "wordbook", "bool", "允许「不限」复习",
       help_zh="关掉后,选了「不限」的用户按每日复习上限·上限计算"),
    _s("wordbook_bonus_max", "wordbook", "int", "每日加练上限(新词)", help_zh="0 = 关闭「今天加练」"),
```

`server/app/core/runtime_settings.py`:`runtime_problems` 的 `return problems` 之前追加

```python
    if not s.wordbook_daily_new_min <= s.wordbook_daily_new <= s.wordbook_daily_new_max:
        problems.append("WORDBOOK_DAILY_NEW must be within WORDBOOK_DAILY_NEW_MIN..WORDBOOK_DAILY_NEW_MAX")
    if not s.wordbook_review_cap_min <= s.wordbook_review_cap <= s.wordbook_review_cap_max:
        problems.append("WORDBOOK_REVIEW_CAP must be within WORDBOOK_REVIEW_CAP_MIN..WORDBOOK_REVIEW_CAP_MAX")
```

`server/.env.example` 不加条目(全部是有默认值的热设置,管理端可见)。

- [ ] **Step 4: 跑测试确认通过** — Run: `cd server && uv run pytest -q tests/test_wordbook_goals_settings.py tests/test_settings_registry.py tests/test_runtime_settings.py tests/test_wordbook_models.py tests/test_admin_settings_service.py tests/test_architecture.py` → PASS

- [ ] **Step 5: 提交**

```bash
git add server/app/core/config.py server/app/core/settings_registry.py server/app/core/runtime_settings.py server/tests/test_wordbook_goals_settings.py
git commit -m "feat(server): admin-tunable wordbook goal ranges (1-200 new, 10-1000 or unlimited reviews)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task GS3: 有效值、`PATCH /enrollment`、`relearn` 口径、`/today` 的 `paused` / `streak` / 达标

**Files:**
- Modify: `server/app/wordbook/store.py`、`server/app/wordbook/service.py`、`server/app/routers/wordbook.py`
- Modify(单点):`server/tests/test_wordbook_api.py`、`server/tests/test_wordbook_learn_limits.py`
- Create: `server/tests/test_wordbook_goals_api.py`

**Interfaces:**
- Consumes:GS1 `REVIEW_UNLIMITED`、`GoalLimits`、`effective_goals`、`goals_error`、`compute_plan`、`streak_of`;GS2 设置字段与 `WORDBOOK_*_BOUNDS`
- Produces(`store`):`LEARN_KINDS = ("learn", "relearn")`、`SETTINGS_DAILY_MAX = 60`、`RESETS_DAILY_MAX = 2`;`update_goals(session, e, *, daily_new: int | None, review_cap: int | None, order_mode: str | None, now) -> WordbookEnrollment`(提交)、`latest_paused(session, user_id, enabled) -> WordbookEnrollment | None`、`bonus_today(session, user_id, book_id, day) -> int`、`mark_goal(session, user_id, book_id, day, now) -> bool`(flush)、`goal_days(session, user_id, since: str) -> list[str]`、`consume_settings(session, user_id, day) -> bool`
- Produces(`service`):`DEFAULT_LIMITS: GoalLimits`、`limits_of(settings) -> GoalLimits`、`limits_out(limits) -> dict`、`enrollment_out(e, limits=DEFAULT_LIMITS) -> dict`(+`review_unlimited`,有效值)、`put_enrollment(..., review_unlimited: bool = False)`、`_day_plan(session, user_id, e, index, known, offset, now, *, settings: Settings | None = None)`、`today_out`(+`paused`、`streak`)、`patch_enrollment(session, user_id, settings, *, daily_new, review_cap, review_unlimited: bool, order_mode, now) -> dict`;错误常量 `NO_CHANGES`、`SETTINGS_LIMIT`
- Produces(HTTP):`PATCH /api/wordbook/enrollment`;`PUT /enrollment` 接受 1–200 / 10–1000 / `review_unlimited: true`;`GET /config` + `limits`;`GET /today` + `paused`、`streak`,`plan` + `bonus`、`goal_met`

- [ ] **Step 1: 写失败测试** — `server/tests/test_wordbook_goals_api.py`:

```python
"""goals v2:PATCH /enrollment、有效值与兼容、立即生效、relearn 口径、/today 的 paused / streak / goal(spec 2026-10-11)。"""
from datetime import date, timedelta

import pytest
from sqlalchemy import select

from app.models import WordbookEnrollment, WordbookEvent, utcnow
from app.services.usage import local_day
from tests.wordbook_helpers import enable_wordbook, make_data_dir

URL = "/api/wordbook"
TZ = 480


async def login(app, client, tmp_path, **overrides):
    enable_wordbook(app, make_data_dir(tmp_path), **overrides)
    r = await client.post("/api/users", json={"username": "alice", "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    r = await client.put(f"{URL}/enrollment", headers=h, json={"book_id": "junior", "order_mode": "book"})
    assert r.status_code == 200, r.text
    return h


async def today(client, h) -> dict:
    r = await client.get(f"{URL}/today", headers=h, params={"tz_offset_minutes": TZ})
    assert r.status_code == 200, r.text
    return r.json()


async def learn(client, h, key):
    return await client.post(f"{URL}/answers", headers=h, json={"book_id": "junior", "key": key, "mode": "learn",
                                                                "qtype": "meaning", "known": True,
                                                                "tz_offset_minutes": TZ})


async def patch(client, h, **body):
    return await client.patch(f"{URL}/enrollment", headers=h, json=body)


async def user_id_of(app) -> int:
    async with app.state.sessionmaker() as s:
        return await s.scalar(select(WordbookEnrollment.user_id).limit(1))


async def test_patch_applies_immediately_and_never_deletes_progress(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    for key in ("talk", "ability", "able"):
        assert (await learn(client, h, key)).status_code == 200
    r = await patch(client, h, daily_new=5)
    assert r.status_code == 200 and r.json()["daily_new"] == 5
    plan = (await today(client, h))["plan"]
    assert (plan["new_target"], plan["new_done"], plan["new_left"]) == (5, 3, 2)
    await patch(client, h, daily_new=2)  # 调低到已学数以下:不删进度
    t = await today(client, h)
    assert (t["plan"]["new_left"], t["progress"]["learned"]) == (0, 3)
    assert (await learn(client, h, "abandon")).json() == {"error": "Daily new-word limit reached"}
    await patch(client, h, daily_new=4)  # 再调高:当天马上多一个
    assert (await today(client, h))["plan"]["new_left"] == 1
    assert (await learn(client, h, "abandon")).status_code == 200


async def test_unlimited_reviews_and_validation(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    r = await patch(client, h, review_unlimited=True)
    assert r.status_code == 200 and (r.json()["review_unlimited"], r.json()["review_cap"]) == (True, 0)
    r = await patch(client, h, review_cap=1000)
    assert (r.json()["review_unlimited"], r.json()["review_cap"]) == (False, 1000)
    for body, error in (({}, "No changes"), ({"review_cap": 100, "review_unlimited": True}, "Conflicting review cap")):
        r = await patch(client, h, **body)
        assert r.status_code == 422 and r.json() == {"error": error}
    for body in ({"daily_new": 0}, {"daily_new": 201}, {"review_cap": 9}, {"review_cap": 1001},
                 {"review_unlimited": False}, {"order_mode": "random"}, {"book_id": "junior"}):
        assert (await patch(client, h, **body)).status_code == 422, body


async def test_order_change_restarts_the_cursor_but_keeps_learned_words(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    await learn(client, h, "talk")
    r = await patch(client, h, order_mode="shuffle")
    assert r.status_code == 200 and r.json()["order_mode"] == "shuffle"
    async with app.state.sessionmaker() as s:
        assert (await s.scalar(select(WordbookEnrollment))).cursor == 0
    assert (await today(client, h))["progress"]["learned"] == 1


async def test_admin_ranges_are_enforced_and_old_values_are_clamped(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    await patch(client, h, daily_new=150, review_unlimited=True)
    app.state.settings = app.state.settings.model_copy(update={
        "wordbook_daily_new_max": 50, "wordbook_review_unlimited": False, "wordbook_review_cap_max": 300})
    r = await patch(client, h, daily_new=60)
    assert r.status_code == 422 and r.json() == {"error": "Daily new words out of range"}
    assert (await patch(client, h, review_unlimited=True)).json() == {"error": "Unlimited reviews are off"}
    t = await today(client, h)
    e = t["enrollment"]
    assert (e["daily_new"], e["review_cap"], e["review_unlimited"]) == (50, 300, False)
    assert t["plan"]["new_target"] == 50
    async with app.state.sessionmaker() as s:  # 无迁移、不回写:库里仍是用户上次保存的值
        row = await s.scalar(select(WordbookEnrollment))
        assert (row.daily_new, row.review_cap) == (150, 0)
    cfg = (await client.get(f"{URL}/config", headers=h)).json()
    assert cfg["limits"] == {"daily_new": {"min": 1, "max": 50}, "review_cap": {"min": 10, "max": 300},
                             "review_unlimited": False, "bonus_max": 50}


async def test_put_enrollment_accepts_the_wider_ranges(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    r = await client.put(f"{URL}/enrollment", headers=h, json={"book_id": "junior", "daily_new": 1,
                                                              "review_unlimited": True})
    assert r.status_code == 200 and (r.json()["daily_new"], r.json()["review_unlimited"]) == (1, True)
    assert (await client.put(f"{URL}/enrollment", headers=h, json={"book_id": "junior", "daily_new": 0})).status_code == 422


async def test_relearn_counts_toward_the_daily_limit(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    await patch(client, h, daily_new=2)
    async with app.state.sessionmaker() as s:  # 很久以前在别的书里学过 ability(行已不在)
        s.add(WordbookEvent(user_id=await user_id_of(app), book_id="cet4", kind="learn", word="ability", item_id=None,
                            qtype=None, outcome="known", credit=100, day="2026-01-01",
                            created_at=utcnow() - timedelta(days=300)))
        await s.commit()
    assert (await learn(client, h, "ability")).status_code == 200
    assert (await learn(client, h, "talk")).status_code == 200
    assert (await learn(client, h, "able")).json() == {"error": "Daily new-word limit reached"}
    async with app.state.sessionmaker() as s:
        kinds = (await s.scalars(select(WordbookEvent.kind).where(WordbookEvent.book_id == "junior")
                                 .order_by(WordbookEvent.id))).all()
    assert kinds == ["relearn", "learn"]


async def test_goal_is_recorded_once_and_the_streak_counts_back(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    await patch(client, h, daily_new=1)
    first = await today(client, h)
    assert first["plan"]["goal_met"] is False and first["streak"] == {"current": 0, "today_met": False}
    assert first["paused"] is None
    d = date.fromisoformat(local_day(utcnow(), TZ))
    async with app.state.sessionmaker() as s:  # 前两天已达标
        for back in (1, 2):
            s.add(WordbookEvent(user_id=await user_id_of(app), book_id="junior", kind="goal", word="goal", item_id=None,
                                qtype=None, outcome="met", credit=0, day=(d - timedelta(days=back)).isoformat(),
                                created_at=utcnow()))
        await s.commit()
    assert (await today(client, h))["streak"] == {"current": 2, "today_met": False}
    await learn(client, h, "talk")  # 「我认识」→ 盒 2、4 天后到期:今天没有到期复习
    t = await today(client, h)
    assert t["plan"]["goal_met"] is True and t["streak"] == {"current": 3, "today_met": True}
    await today(client, h)
    async with app.state.sessionmaker() as s:
        assert len((await s.scalars(select(WordbookEvent.day).where(WordbookEvent.kind == "goal"))).all()) == 3


async def test_goal_is_not_written_during_maintenance(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    await patch(client, h, daily_new=1)
    await learn(client, h, "talk")
    app.state.settings = app.state.settings.model_copy(update={"maintenance_mode": "read_only"})
    t = await today(client, h)
    assert t["plan"]["goal_met"] is True and t["streak"]["today_met"] is False


async def test_settings_changes_are_rate_limited(app, client, tmp_path, monkeypatch):
    from app.wordbook import store
    monkeypatch.setattr(store, "SETTINGS_DAILY_MAX", 2)
    h = await login(app, client, tmp_path)
    assert (await patch(client, h, daily_new=0)).status_code == 422  # 校验失败不占次数
    for n in (10, 11):
        assert (await patch(client, h, daily_new=n)).status_code == 200
    r = await patch(client, h, daily_new=12)
    assert r.status_code == 429 and r.json() == {"error": "Too many settings changes today"}


@pytest.mark.parametrize("offset", [-600, 0, 840])
async def test_today_shape_for_a_fresh_user(app, client, tmp_path, offset):
    enable_wordbook(app, make_data_dir(tmp_path))
    r = await client.post("/api/users", json={"username": "bob", "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    body = (await client.get(f"{URL}/today", headers=h, params={"tz_offset_minutes": offset})).json()
    assert body == {"enrollment": None, "book": None, "plan": None, "progress": None, "tomorrow_due": 0,
                    "paused": None, "streak": {"current": 0, "today_met": False}}
```

单点修改 v1 测试(行为变化来自 spec G-2 / G-4,其余断言不动):
- `server/tests/test_wordbook_api.py::test_enroll_today_and_books`:`empty == {...}` 断言追加 `"paused": None, "streak": {"current": 0, "today_met": False}`;`today["plan"] == {...}` 断言追加 `"bonus": 0, "goal_met": False`。
- `server/tests/test_wordbook_api.py::test_enrollment_errors`:`json={"book_id": "junior", "daily_new": 1}` 改为 `"daily_new": 0`(1 现在合法)。
- `server/tests/test_wordbook_learn_limits.py::test_delete_then_relearn_does_not_log_the_word_again`:`assert kinds == ["learn", "practice", "practice"]` 改为 `["learn", "relearn", "relearn"]`(同一个词,`new_done` 仍为 1、`word_learned` 仍为 1 条,下面两条断言不变)。

- [ ] **Step 2: 跑测试确认失败** — Run: `cd server && uv run pytest -q tests/test_wordbook_goals_api.py` → FAIL(`PATCH` 405、`limits` / `paused` 键缺失)

- [ ] **Step 3: 实现 `store.py`**
  - 顶部导入改为 `from sqlalchemy import delete, func, select`(`delete` 给 GS4 的 `reset_book`)。
  - `enroll()` 新建行那一行:`daily_new=daily_new or 20, review_cap=review_cap or 100` 改为 `daily_new=daily_new if daily_new is not None else 20, review_cap=review_cap if review_cap is not None else 100`(`0` = 「不限」不能被 `or` 吞掉)。
  - `today_counts()` 与 `today_learned_keys()` 中 `WordbookEvent.kind == "learn"` 改为 `WordbookEvent.kind.in_(LEARN_KINDS)`。
  - 文件末尾追加:

```python
# ---- 每日目标(goals v2,spec 2026-10-11)----

LEARN_KINDS = ("learn", "relearn")  # 计入「今天已学新词」(G-4);段位只读 learn
SETTINGS_DAILY_MAX = 60  # PATCH /enrollment、pause、resume、bonus 共用,每人每 UTC 日
RESETS_DAILY_MAX = 2


async def update_goals(session: AsyncSession, e: WordbookEnrollment, *, daily_new: int | None, review_cap: int | None,
                       order_mode: str | None, now: datetime) -> WordbookEnrollment:
    """只改给出的字段;改顺序时 cursor 归零(已学的词被跳过,同 enroll)。提交。"""
    if order_mode and order_mode != e.order_mode:
        e.order_mode, e.cursor = order_mode, 0
    if daily_new is not None:
        e.daily_new = daily_new
    if review_cap is not None:
        e.review_cap = review_cap
    e.updated_at = now
    await session.commit()
    return e


async def latest_paused(session: AsyncSession, user_id: int, enabled: Iterable[str]) -> WordbookEnrollment | None:
    """没有在学的书时,首页显示的那本已暂停的书(最近更新、仍启用)。"""
    return await session.scalar(select(WordbookEnrollment).where(
        WordbookEnrollment.user_id == user_id, WordbookEnrollment.status == "paused",
        WordbookEnrollment.book_id.in_(tuple(enabled))).order_by(WordbookEnrollment.updated_at.desc()).limit(1))


async def bonus_today(session: AsyncSession, user_id: int, book_id: str, day: str) -> int:
    total = await session.scalar(select(func.coalesce(func.sum(WordbookEvent.credit), 0)).where(
        *_today(user_id, book_id, day), WordbookEvent.kind == "bonus"))
    return int(total or 0)


async def mark_goal(session: AsyncSession, user_id: int, book_id: str, day: str, now: datetime) -> bool:
    """当天第一次达标写一行 goal(跨书一天一行);flush 不提交。已有则返回 False。"""
    found = await session.scalar(select(WordbookEvent.id).where(
        WordbookEvent.user_id == user_id, WordbookEvent.kind == "goal", WordbookEvent.day == day).limit(1))
    if found is not None:
        return False
    await add_event(session, user_id=user_id, book_id=book_id, kind="goal", word="goal", item_id=None, qtype=None,
                    outcome="met", credit=0, day=day, now=now)
    await session.flush()
    return True


async def goal_days(session: AsyncSession, user_id: int, since: str) -> list[str]:
    rows = await session.scalars(select(func.distinct(WordbookEvent.day)).where(
        WordbookEvent.user_id == user_id, WordbookEvent.kind == "goal", WordbookEvent.day >= since))
    return list(rows.all())


async def consume_settings(session: AsyncSession, user_id: int, day: str) -> bool:
    return await usage.consume(session, "wordbook_settings", str(user_id), day, SETTINGS_DAILY_MAX)
```

- [ ] **Step 4: 实现 `service.py`**
  - 导入:`from datetime import date, timedelta`;`from app.core.config import WORDBOOK_NEW_BOUNDS, WORDBOOK_REVIEW_BOUNDS, Settings`(替换原 `from app.core.config import Settings`);`from app.wordbook.plan import GoalLimits, Known`(替换原 `from app.wordbook.plan import Known`)。
  - 错误常量:在 `REPORT_LIMIT = ...` 之后追加

```python
NO_CHANGES = (422, "No changes")
SETTINGS_LIMIT = (429, "Too many settings changes today")
NOT_ENROLLED = (409, "Book not enrolled")
GOAL_NOT_DONE = (409, "Finish today's new words first")
BACKLOG = (409, "Clear the review backlog first")
BOOK_FINISHED = (409, "No new words left in this book")
BONUS_LIMIT = (429, "Daily bonus limit reached")
RESET_LIMIT = (429, "Daily reset limit reached")
CONFIRM_MISMATCH = (422, "Confirmation does not match")
STREAK_LOOKBACK_DAYS = 400
DEFAULT_LIMITS = GoalLimits(WORDBOOK_NEW_BOUNDS[0], WORDBOOK_NEW_BOUNDS[1], WORDBOOK_REVIEW_BOUNDS[0],
                            WORDBOOK_REVIEW_BOUNDS[1], True, 50)  # 没传 settings 的调用点(GP-1)


def limits_of(settings: Settings) -> GoalLimits:
    return GoalLimits(settings.wordbook_daily_new_min, settings.wordbook_daily_new_max,
                      settings.wordbook_review_cap_min, settings.wordbook_review_cap_max,
                      settings.wordbook_review_unlimited, settings.wordbook_bonus_max)


def limits_out(limits: GoalLimits) -> dict:
    return {"daily_new": {"min": limits.new_min, "max": limits.new_max},
            "review_cap": {"min": limits.review_min, "max": limits.review_max},
            "review_unlimited": limits.unlimited, "bonus_max": limits.bonus_max}
```

  - `config_out`:返回的 dict 在 `"defaults"` 之后加 `"limits": limits_out(limits_of(settings)),`。
  - `enrollment_out` 替换为:

```python
def enrollment_out(e: WordbookEnrollment, limits: GoalLimits = DEFAULT_LIMITS) -> dict:
    """有效值(GP-2):超出当前范围的旧值夹到范围内;「不限」返回 review_cap 0 + review_unlimited true。"""
    daily_new, cap = planning.effective_goals(e.daily_new, e.review_cap, limits)
    return {"book_id": e.book_id, "status": e.status, "order_mode": e.order_mode, "daily_new": daily_new,
            "review_cap": planning.REVIEW_UNLIMITED if cap is None else cap, "started_at": iso_utc(e.started_at),
            "review_unlimited": cap is None}
```

  - `put_enrollment` 替换为:

```python
async def put_enrollment(session: AsyncSession, user_id: int, settings: Settings, *, book_id: str,
                         daily_new: int | None, review_cap: int | None, order_mode: str | None, now, seed: int,
                         review_unlimited: bool = False) -> dict:
    book_or_fail(settings, book_id)
    limits = limits_of(settings)
    if error := planning.goals_error(limits, daily_new=daily_new, review_cap=review_cap, unlimited=review_unlimited):
        raise WordbookError(422, error)
    fresh = await store.get_enrollment(session, user_id, book_id) is None
    if review_unlimited:
        review_cap = planning.REVIEW_UNLIMITED
    e = await store.enroll(
        session, user_id, book_id,
        daily_new=daily_new if daily_new is not None else (settings.wordbook_daily_new if fresh else None),
        review_cap=review_cap if review_cap is not None else (settings.wordbook_review_cap if fresh else None),
        order_mode=order_mode, now=now, seed=seed)
    return enrollment_out(e, limits)
```

  - `_day_plan` 替换为(签名追加仅限关键字的 `settings`):

```python
async def _day_plan(session: AsyncSession, user_id: int, e: WordbookEnrollment, index: BookIndex,
                    known: dict[str, Known], offset: int, now, *, settings: Settings | None = None) -> planning.DayPlan:
    """计划的唯一入口(GP-1):有效值、今日加练、本书剩余新词都在这里;作答与出题的检查因此自动包含它们。"""
    limits = limits_of(settings) if settings is not None else DEFAULT_LIMITS
    day = local_day(now, offset)
    new_done, review_done = await store.today_counts(session, user_id, e.book_id, day)
    daily_new, cap = planning.effective_goals(e.daily_new, e.review_cap, limits)
    return planning.compute_plan(daily_new=daily_new, review_cap=cap, new_done=new_done, review_done=review_done,
                                 review_due=planning.count_due(index.keys, known, now),
                                 bonus=await store.bonus_today(session, user_id, e.book_id, day),
                                 guard_threshold=limits.review_max,
                                 remaining=sum(1 for k in index.keys if k not in known))
```

  - 三个调用点各加 `settings=settings`(单点修改,spec §14):`learn_batch` 中 `(await _day_plan(session, user_id, e, index, known, offset, now)).new_left` → `(await _day_plan(session, user_id, e, index, known, offset, now, settings=settings)).new_left`;`review_batch` 中同样位置(`.review_left`);`answer()` 中 `(await _day_plan(session, user_id, e, index, known, p.offset, now)).new_left` → 加 `settings=settings`。
  - `answer()` 学新词分支:`kind = "practice" if await store.ever_learned(session, user_id, card.key) else "learn"` 改为 `kind = "relearn" if await store.ever_learned(session, user_id, card.key) else "learn"`,上一行注释改为「每个词只记一次 learn(以前学过的再学记 relearn:计入今日新词,不产生 word_learned;spec 2026-10-11 G-4)」。
  - `today_out` 替换为:

```python
async def _streak(session: AsyncSession, user_id: int, day: str) -> dict:
    since = (date.fromisoformat(day) - timedelta(days=STREAK_LOOKBACK_DAYS)).isoformat()
    days = await store.goal_days(session, user_id, since)
    return {"current": planning.streak_of(days, day), "today_met": day in days}


async def today_out(session: AsyncSession, ds: DictionaryStore, user_id: int, settings: Settings, offset: int,
                    now) -> dict:
    limits = limits_of(settings)
    day = local_day(now, offset)
    enabled = enabled_books(settings.wordbook_books)
    e = await store.active_enrollment(session, user_id)
    if e is None or e.book_id not in enabled:  # R-W12:停用的书保留选书记录与学习记录
        paused = await store.latest_paused(session, user_id, enabled) if e is None else None
        return {"enrollment": enrollment_out(e, limits) if e else None, "book": None, "plan": None, "progress": None,
                "tomorrow_due": 0, "paused": enrollment_out(paused, limits) if paused else None,
                "streak": await _streak(session, user_id, day)}
    index = await index_or_fail(ds, e.book_id)
    known = await store.known_words(session, user_id)
    day_plan = await _day_plan(session, user_id, e, index, known, offset, now, settings=settings)
    # 达标一天写一行(G-6);维护模式(只读窗口)不写
    if day_plan.goal_met and settings.maintenance_mode == "off" and await store.mark_goal(
            session, user_id, e.book_id, day, now):
        await session.commit()
    return {"enrollment": enrollment_out(e, limits), "book": book_out(book_by_id(e.book_id), available=True),
            "plan": asdict(day_plan), "progress": asdict(planning.progress_of(index.keys, known)),
            "tomorrow_due": planning.count_due_before(index.keys, known, planning.day_end(now, offset, 1)),
            "paused": None, "streak": await _streak(session, user_id, day)}
```

  - 文件末尾追加:

```python
# ---- 每日目标(goals v2,spec 2026-10-11 §3、§9)----

async def patch_enrollment(session: AsyncSession, user_id: int, settings: Settings, *, daily_new: int | None,
                           review_cap: int | None, review_unlimited: bool, order_mode: str | None, now) -> dict:
    """改当前在学的书的每日设置,立即生效(今天的计数来自事件,不受影响)。先校验后扣次数。"""
    if daily_new is None and review_cap is None and not review_unlimited and order_mode is None:
        fail(NO_CHANGES)
    e = await store.active_enrollment(session, user_id)
    if e is None:
        fail(NO_ACTIVE)
    book_or_fail(settings, e.book_id)
    limits = limits_of(settings)
    if error := planning.goals_error(limits, daily_new=daily_new, review_cap=review_cap, unlimited=review_unlimited):
        raise WordbookError(422, error)
    if not await store.consume_settings(session, user_id, utc_day(now)):
        fail(SETTINGS_LIMIT)
    cap = planning.REVIEW_UNLIMITED if review_unlimited else review_cap
    e = await store.update_goals(session, e, daily_new=daily_new, review_cap=cap, order_mode=order_mode, now=now)
    return enrollment_out(e, limits)
```

- [ ] **Step 5: 实现 `routers/wordbook.py`**
  - 导入 `from app.core.config import WORDBOOK_NEW_BOUNDS, WORDBOOK_REVIEW_BOUNDS, Settings`(替换原 `from app.core.config import Settings`),并在 `TZ_MIN, TZ_MAX = -840, 840` 下一行加 `NEW_MIN, NEW_MAX = WORDBOOK_NEW_BOUNDS` 与 `REVIEW_MIN, REVIEW_MAX = WORDBOOK_REVIEW_BOUNDS`。
  - `EnrollmentIn`:`daily_new: int | None = Field(None, ge=NEW_MIN, le=NEW_MAX)`、`review_cap: int | None = Field(None, ge=REVIEW_MIN, le=REVIEW_MAX)`,并在 `order_mode` 后加 `review_unlimited: Literal[True] | None = None`;`wordbook_enroll` 调用 `service.put_enrollment` 时加 `review_unlimited=bool(payload.review_unlimited)`。
  - 文件末尾追加:

```python
# ---- 每日目标(goals v2,spec 2026-10-11 §9)----

class GoalsPatchIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    daily_new: int | None = Field(None, ge=NEW_MIN, le=NEW_MAX)
    review_cap: int | None = Field(None, ge=REVIEW_MIN, le=REVIEW_MAX)
    review_unlimited: Literal[True] | None = None
    order_mode: Literal["shuffle", "book"] | None = None


@router.patch("/enrollment")
async def wordbook_patch_enrollment(payload: GoalsPatchIn, user: User = Depends(current_user),
                                    session: AsyncSession = Depends(get_session),
                                    settings: Settings = Depends(require_wordbook)):
    try:
        return await service.patch_enrollment(session, user.id, settings, daily_new=payload.daily_new,
                                              review_cap=payload.review_cap,
                                              review_unlimited=bool(payload.review_unlimited),
                                              order_mode=payload.order_mode, now=utcnow())
    except service.WordbookError as e:
        _raise(e)
```

- [ ] **Step 6: 跑测试确认通过** — Run: `cd server && uv run pytest -q tests/test_wordbook_goals_api.py tests/test_wordbook_api.py tests/test_wordbook_learn.py tests/test_wordbook_learn_limits.py tests/test_wordbook_spell.py tests/test_wordbook_store.py tests/test_wordbook_plan.py tests/test_rank_wordbook.py tests/test_architecture.py` → PASS(契约测试在 GS5 重录前会因 `today`/`config`/`enrollment` 形状变化失败;本任务不跑它,GS5 修复——合并前 GS3–GS5 一起评审)

- [ ] **Step 7: 提交**

```bash
git add server/app/wordbook/store.py server/app/wordbook/service.py server/app/routers/wordbook.py server/tests/test_wordbook_goals_api.py server/tests/test_wordbook_api.py server/tests/test_wordbook_learn_limits.py
git commit -m "feat(server): change wordbook daily goals any time, relearn counts toward the daily limit, goal streaks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task GS4: 今天加练、暂停 / 继续、重置进度(含段位预同步)

**Files:**
- Modify: `server/app/wordbook/store.py`(末尾追加)、`server/app/wordbook/service.py`(末尾追加)、`server/app/routers/wordbook.py`(末尾追加)
- Create: `server/tests/test_wordbook_goals_actions.py`

**Interfaces:**
- Consumes:GS3 全部
- Produces(`store`):`pause_active(session, user_id, now) -> WordbookEnrollment | None`(提交)、`reset_book(session, user_id, book_id, *, seed: int, now) -> int`(不提交)、`consume_reset(session, user_id, day) -> bool`
- Produces(`service`):`grant_bonus(session, ds, user_id, settings, size, offset, now) -> dict`、`pause(session, user_id, settings, now) -> dict`、`resume(session, user_id, settings, *, book_id, now, seed) -> dict`、`reset_progress(session, user_id, settings, *, book_id, confirm, offset, now, seed) -> dict`、`confirm_matches(confirm: str, spec: BookSpec) -> bool`
- Produces(HTTP):`POST /api/wordbook/bonus`、`POST /api/wordbook/enrollment/pause`、`POST /api/wordbook/enrollment/resume`、`POST /api/wordbook/enrollment/reset`

- [ ] **Step 1: 写失败测试** — `server/tests/test_wordbook_goals_actions.py`:

```python
"""goals v2:今天加练、暂停 / 继续、重置进度(spec 2026-10-11 §5、§7、§8)。"""
from datetime import timedelta

import pytest
from sqlalchemy import select, update

from app.models import VocabularyItem, WordbookEnrollment, WordbookEvent, XpEvent, utcnow
from tests.wordbook_helpers import enable_wordbook, make_data_dir

URL = "/api/wordbook"
TZ = 480
ELEVEN = ("talk", "ability", "able", "abandon", "absorb", "accept", "accident", "go", "child", "careful", "carry")


async def login(app, client, tmp_path, **overrides):
    enable_wordbook(app, make_data_dir(tmp_path), **overrides)
    r = await client.post("/api/users", json={"username": "alice", "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert (await client.put(f"{URL}/enrollment", headers=h,
                             json={"book_id": "junior", "order_mode": "book"})).status_code == 200
    return h


async def today(client, h) -> dict:
    return (await client.get(f"{URL}/today", headers=h, params={"tz_offset_minutes": TZ})).json()


async def learn(client, h, key):
    return await client.post(f"{URL}/answers", headers=h, json={"book_id": "junior", "key": key, "mode": "learn",
                                                                "qtype": "meaning", "known": True,
                                                                "tz_offset_minutes": TZ})


async def bonus(client, h, size):
    return await client.post(f"{URL}/bonus", headers=h, json={"size": size, "tz_offset_minutes": TZ})


async def reset(client, h, confirm, book_id="junior"):
    return await client.post(f"{URL}/enrollment/reset", headers=h,
                             json={"book_id": book_id, "confirm": confirm, "tz_offset_minutes": TZ})


async def rank_me(client, h):
    assert (await client.get("/api/rank/me", headers=h, params={"tz_offset_minutes": TZ})).status_code == 200


@pytest.mark.parametrize("method,path", [("PATCH", "/enrollment"), ("POST", "/enrollment/pause"),
                                         ("POST", "/enrollment/resume"), ("POST", "/enrollment/reset"),
                                         ("POST", "/bonus")])
async def test_goal_routes_are_off_with_the_switch(client, auth_headers, method, path):
    r = await client.request(method, URL + path, headers=auth_headers, json={})
    assert r.status_code == 404 and r.json() == {"error": "Wordbook is disabled"}


async def test_bonus_rules_and_daily_limit(app, client, tmp_path):
    h = await login(app, client, tmp_path, wordbook_bonus_max=6)
    await client.patch(f"{URL}/enrollment", headers=h, json={"daily_new": 1})
    r = await bonus(client, h, 5)
    assert r.status_code == 409 and r.json() == {"error": "Finish today's new words first"}
    assert (await learn(client, h, "talk")).status_code == 200
    r = await bonus(client, h, 5)
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["plan"]["new_target"], body["plan"]["new_left"], body["plan"]["bonus"], body["bonus_left"]) == (6, 5, 5, 1)
    assert (await bonus(client, h, 1)).json() == {"error": "Finish today's new words first"}
    for key in ("ability", "able", "abandon", "absorb", "go"):
        assert (await learn(client, h, key)).status_code == 200
    assert (await learn(client, h, "accept")).json() == {"error": "Daily new-word limit reached"}
    r = await bonus(client, h, 5)
    assert r.status_code == 429 and r.json() == {"error": "Daily bonus limit reached"}
    assert (await bonus(client, h, 1)).status_code == 200  # 正好用完上限
    t = await today(client, h)
    assert (t["plan"]["bonus"], t["plan"]["goal_met"]) == (6, True)
    assert (await bonus(client, h, 21)).status_code == 422  # 每次最多 20


async def test_bonus_is_refused_during_a_backlog_and_when_switched_off(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    for key in ELEVEN:
        assert (await learn(client, h, key)).status_code == 200
    async with app.state.sessionmaker() as s:
        await s.execute(update(VocabularyItem).values(due_at=utcnow() - timedelta(hours=1)))
        await s.commit()
    await client.patch(f"{URL}/enrollment", headers=h, json={"daily_new": 11, "review_cap": 10})
    assert (await bonus(client, h, 5)).json() == {"error": "Clear the review backlog first"}
    app.state.settings = app.state.settings.model_copy(update={"wordbook_bonus_max": 0})
    assert (await bonus(client, h, 5)).json() == {"error": "Daily bonus limit reached"}


async def test_pause_shows_the_paused_card_and_resume_keeps_settings(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    await client.patch(f"{URL}/enrollment", headers=h, json={"daily_new": 7})
    r = await client.post(f"{URL}/enrollment/pause", headers=h, json={})
    assert r.status_code == 200 and r.json()["status"] == "paused"
    t = await today(client, h)
    assert t["enrollment"] is None and t["plan"] is None and t["paused"]["book_id"] == "junior"
    assert (await client.post(f"{URL}/learn/batch", headers=h, json={"size": 5})).json() == {"error": "No active book"}
    assert (await client.post(f"{URL}/enrollment/pause", headers=h, json={})).json() == {"error": "No active book"}
    r = await client.post(f"{URL}/enrollment/resume", headers=h, json={"book_id": "junior"})
    assert r.status_code == 200 and (r.json()["status"], r.json()["daily_new"]) == ("active", 7)
    assert (await today(client, h))["paused"] is None
    r = await client.post(f"{URL}/enrollment/resume", headers=h, json={"book_id": "cet4"})
    assert r.status_code == 409 and r.json() == {"error": "Book not enrolled"}


async def test_reset_clears_only_this_books_rows_and_keeps_history(app, client, tmp_path):
    h = await login(app, client, tmp_path, rank_enabled=True)
    await client.post("/api/vocabulary", headers=h, json={"word": "accept", "source": "lookup"})
    for key in ("talk", "ability"):
        assert (await learn(client, h, key)).status_code == 200
    await rank_me(client, h)
    r = await reset(client, h, "四级")
    assert r.status_code == 422 and r.json() == {"error": "Confirmation does not match"}
    r = await reset(client, h, " 初中 ")
    assert r.status_code == 200 and r.json()["removed"] == 2 and r.json()["enrollment"]["book_id"] == "junior"
    t = await today(client, h)
    assert t["progress"]["learned"] == 1  # accept 来自查词,不清除
    assert t["plan"]["new_done"] == 2  # 事件保留:重置换不来更多今日新词
    async with app.state.sessionmaker() as s:
        kinds = (await s.scalars(select(WordbookEvent.kind).order_by(WordbookEvent.id))).all()
        xp = (await s.scalars(select(XpEvent).where(XpEvent.kind == "word_learned"))).all()
        row = await s.scalar(select(WordbookEnrollment))
    assert kinds == ["learn", "learn", "reset"] and len(xp) == 2 and row.cursor == 0
    assert (await learn(client, h, "talk")).status_code == 200
    await rank_me(client, h)
    async with app.state.sessionmaker() as s:
        last = (await s.scalars(select(WordbookEvent.kind).order_by(WordbookEvent.id.desc()).limit(1))).one()
        assert last == "relearn"
        assert len((await s.scalars(select(XpEvent).where(XpEvent.kind == "word_learned"))).all()) == 2
    assert (await today(client, h))["plan"]["new_done"] == 2  # talk 今天已经算过


async def test_reset_settles_unsynced_review_points_first(app, client, tmp_path):
    h = await login(app, client, tmp_path, rank_enabled=True)
    await learn(client, h, "talk")
    await rank_me(client, h)
    async with app.state.sessionmaker() as s:
        await s.execute(update(VocabularyItem).values(due_at=utcnow() - timedelta(hours=1)))
        await s.commit()
    q = (await client.post(f"{URL}/review/batch", headers=h,
                           json={"size": 1, "tz_offset_minutes": TZ})).json()["questions"][0]
    answer = {"choice": "x"} if q["options"] else {"typed": "x"}
    r = await client.post(f"{URL}/answers", headers=h, json={"book_id": "junior", "key": "talk", "mode": "review",
                                                            "qtype": q["qtype"], "tz_offset_minutes": TZ, **answer})
    assert r.json()["applied"] is True
    assert (await reset(client, h, "junior")).status_code == 200  # 中间没有调用 /rank/me
    async with app.state.sessionmaker() as s:
        assert len((await s.scalars(select(XpEvent).where(XpEvent.kind == "vocab_review"))).all()) == 1


async def test_reset_limits_and_unknown_books(app, client, tmp_path, monkeypatch):
    from app.wordbook import store
    monkeypatch.setattr(store, "RESETS_DAILY_MAX", 1)
    h = await login(app, client, tmp_path)
    assert (await reset(client, h, "cet4", book_id="cet4")).json() == {"error": "Book not enrolled"}
    assert (await reset(client, h, "Junior High")).status_code == 200  # 英文名也可以,不区分大小写
    r = await reset(client, h, "初中")
    assert r.status_code == 429 and r.json() == {"error": "Daily reset limit reached"}
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd server && uv run pytest -q tests/test_wordbook_goals_actions.py` → FAIL(新端点 404/405)

- [ ] **Step 3: 实现 `store.py`(末尾追加)**

```python
async def pause_active(session: AsyncSession, user_id: int, now: datetime) -> WordbookEnrollment | None:
    """把当前在学的书设为 paused 并提交;没有在学的书返回 None。"""
    e = await active_enrollment(session, user_id)
    if e is not None:
        e.status, e.updated_at = "paused", now
        await session.commit()
    return e


async def reset_book(session: AsyncSession, user_id: int, book_id: str, *, seed: int, now: datetime) -> int:
    """重置进度(spec 2026-10-11 §8):删除本书来源(source='wordbook:<book>')的 vocabulary_items 行,
    取词位置归零并换新种子。事件、段位、别的来源的词不动。不提交;返回删除的行数。"""
    result = await session.execute(delete(VocabularyItem).where(
        VocabularyItem.user_id == user_id, VocabularyItem.source == wordbook_source(book_id))
        .execution_options(synchronize_session=False))
    e = await get_enrollment(session, user_id, book_id)
    e.cursor, e.seed, e.started_at, e.updated_at = 0, seed, now, now
    return int(result.rowcount or 0)


async def consume_reset(session: AsyncSession, user_id: int, day: str) -> bool:
    return await usage.consume(session, "wordbook_resets", str(user_id), day, RESETS_DAILY_MAX)
```

- [ ] **Step 4: 实现 `service.py`(末尾追加)**

```python
BONUS_STEP_MAX = 20  # 每次最多加练 20 个(路由也校验)


async def grant_bonus(session: AsyncSession, ds: DictionaryStore, user_id: int, settings: Settings, size: int,
                      offset: int, now) -> dict:
    """今天加练 size 个新词(spec §5):今天的新词学完、不在积压中、本书还有新词、不超过每日加练上限。
    提交后重算:并发双击超出上限的那一次删掉自己那行并返回 429,总量永不超过上限。"""
    e, index = await _active(session, ds, user_id, settings)
    limits = limits_of(settings)
    if limits.bonus_max <= 0:
        fail(BONUS_LIMIT)
    known = await store.known_words(session, user_id)
    plan = await _day_plan(session, user_id, e, index, known, offset, now, settings=settings)
    if plan.backlog_guard:
        fail(BACKLOG)
    if plan.new_left > 0:
        fail(GOAL_NOT_DONE)
    if not any(k not in known for k in index.keys):
        fail(BOOK_FINISHED)
    if plan.bonus + size > limits.bonus_max:
        fail(BONUS_LIMIT)
    if not await store.consume_settings(session, user_id, utc_day(now)):
        fail(SETTINGS_LIMIT)
    day = local_day(now, offset)
    event = WordbookEvent(user_id=user_id, book_id=e.book_id, kind="bonus", word="bonus", item_id=None, qtype=None,
                          outcome="granted", credit=size, day=day, created_at=now)
    session.add(event)
    await session.commit()
    if await store.bonus_today(session, user_id, e.book_id, day) > limits.bonus_max:
        await session.delete(event)
        await session.commit()
        fail(BONUS_LIMIT)
    plan = await _day_plan(session, user_id, e, index, known, offset, now, settings=settings)
    return {"plan": asdict(plan), "bonus_left": max(0, limits.bonus_max - plan.bonus)}


async def pause(session: AsyncSession, user_id: int, settings: Settings, now) -> dict:
    if await store.active_enrollment(session, user_id) is None:
        fail(NO_ACTIVE)
    if not await store.consume_settings(session, user_id, utc_day(now)):
        fail(SETTINGS_LIMIT)
    e = await store.pause_active(session, user_id, now)
    if e is None:
        fail(NO_ACTIVE)
    return enrollment_out(e, limits_of(settings))


async def resume(session: AsyncSession, user_id: int, settings: Settings, *, book_id: str, now, seed: int) -> dict:
    """继续 = 设为 active 并暂停其它(同 PUT /enrollment 只传书 id);设置与进度不变。"""
    book_or_fail(settings, book_id)
    if await store.get_enrollment(session, user_id, book_id) is None:
        fail(NOT_ENROLLED)
    if not await store.consume_settings(session, user_id, utc_day(now)):
        fail(SETTINGS_LIMIT)
    return await put_enrollment(session, user_id, settings, book_id=book_id, daily_new=None, review_cap=None,
                                order_mode=None, now=now, seed=seed)


def confirm_matches(confirm: str, spec: BookSpec) -> bool:
    typed = confirm.strip().casefold()
    return bool(typed) and typed in {spec.id, spec.title_zh.casefold(), spec.title_en.casefold()}


async def reset_progress(session: AsyncSession, user_id: int, settings: Settings, *, book_id: str, confirm: str,
                         offset: int, now, seed: int) -> dict:
    """重置进度(spec §8,G-7)。确认文本不记日志。"""
    spec = book_or_fail(settings, book_id)
    if await store.get_enrollment(session, user_id, book_id) is None:
        fail(NOT_ENROLLED)
    if not confirm_matches(confirm, spec):
        fail(CONFIRM_MISMATCH)
    if not await store.consume_reset(session, user_id, utc_day(now)):
        fail(RESET_LIMIT)
    removed = await store.reset_book(session, user_id, book_id, seed=seed, now=now)
    await store.add_event(session, user_id=user_id, book_id=book_id, kind="reset", word=book_id, item_id=None,
                          qtype=None, outcome="reset", credit=0, day=local_day(now, offset), now=now)
    await session.commit()
    e = await store.get_enrollment(session, user_id, book_id)
    return {"removed": removed, "enrollment": enrollment_out(e, limits_of(settings))}
```

`service.py` 顶部 `from app.models import WordbookEnrollment, WordbookReport, iso_utc` 改为 `from app.models import WordbookEnrollment, WordbookEvent, WordbookReport, iso_utc`。

- [ ] **Step 5: 实现 `routers/wordbook.py`(末尾追加,导入加 `from app.rank import ledger` 与 `from app.rank.rules_store import rank_rules`)**

```python
class BonusIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    size: int = Field(10, ge=1, le=service.BONUS_STEP_MAX)
    tz_offset_minutes: int = Field(0, ge=TZ_MIN, le=TZ_MAX)


class BookIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    book_id: str = Field(max_length=16)


class ResetIn(BookIn):
    confirm: str = Field(min_length=1, max_length=40)
    tz_offset_minutes: int = Field(0, ge=TZ_MIN, le=TZ_MAX)


class EmptyIn(BaseModel):
    model_config = ConfigDict(extra="forbid")


async def _settle_rank(request: Request, session: AsyncSession, user_id: int, settings: Settings, offset: int) -> None:
    """重置会删 vocabulary_items:先把还没入账的复习段位点入账(spec §8)。段位关闭或维护模式时跳过。
    wordbook 层不导入 rank,所以在路由层做(分层规则允许 routers 导入 rank)。"""
    if not settings.rank_enabled or settings.maintenance_mode != "off":
        return
    version, rules = await rank_rules(request.app).current()
    await ledger.sync(session, user_id, utcnow(), offset, settings.rank_daily_rp_cap,
                      rules=rules if version is not None else None)


@router.post("/bonus")
async def wordbook_bonus(payload: BonusIn, request: Request, user: User = Depends(current_user),
                         session: AsyncSession = Depends(get_session), settings: Settings = Depends(require_wordbook)):
    try:
        return await service.grant_bonus(session, dictionary(request.app), user.id, settings, payload.size,
                                         payload.tz_offset_minutes, utcnow())
    except service.WordbookError as e:
        _raise(e)


@router.post("/enrollment/pause")
async def wordbook_pause(_: EmptyIn, user: User = Depends(current_user), session: AsyncSession = Depends(get_session),
                         settings: Settings = Depends(require_wordbook)):
    try:
        return await service.pause(session, user.id, settings, utcnow())
    except service.WordbookError as e:
        _raise(e)


@router.post("/enrollment/resume")
async def wordbook_resume(payload: BookIn, user: User = Depends(current_user),
                          session: AsyncSession = Depends(get_session), settings: Settings = Depends(require_wordbook)):
    try:
        return await service.resume(session, user.id, settings, book_id=payload.book_id, now=utcnow(),
                                    seed=secrets.randbelow(2**31))
    except service.WordbookError as e:
        _raise(e)


@router.post("/enrollment/reset")
async def wordbook_reset(payload: ResetIn, request: Request, user: User = Depends(current_user),
                         session: AsyncSession = Depends(get_session), settings: Settings = Depends(require_wordbook)):
    await _settle_rank(request, session, user.id, settings, payload.tz_offset_minutes)
    try:
        return await service.reset_progress(session, user.id, settings, book_id=payload.book_id,
                                            confirm=payload.confirm, offset=payload.tz_offset_minutes, now=utcnow(),
                                            seed=secrets.randbelow(2**31))
    except service.WordbookError as e:
        _raise(e)
```

- [ ] **Step 6: 跑测试确认通过** — Run: `cd server && uv run pytest -q tests/test_wordbook_goals_actions.py tests/test_wordbook_goals_api.py tests/test_wordbook_learn_limits.py tests/test_rank_wordbook.py tests/test_wordbook_rank_abuse.py tests/test_architecture.py` → PASS

- [ ] **Step 7: 提交**

```bash
git add server/app/wordbook/store.py server/app/wordbook/service.py server/app/routers/wordbook.py server/tests/test_wordbook_goals_actions.py
git commit -m "feat(server): wordbook bonus words, pause/resume and confirmed progress reset

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task GS5: 契约样例与服务端文档

**Files:**
- Modify: `server/tests/test_wordbook_contract.py`、`server/tests/fixtures/wordbook_contract.json`(重录)、`server/app/wordbook/CLAUDE.md`

**Interfaces:**
- Produces:样例新增键 `enrollment_patch`、`bonus`、`pause`、`today_paused`、`resume`、`reset`;`today`、`config`、`enrollment`、`books` 形状随 GS3 增键

- [ ] **Step 1: 改契约测试(先失败)** — `server/tests/test_wordbook_contract.py`:`KEYS = {...}` 下一行加

```python
GOALS_KEYS = {"enrollment_patch", "bonus", "pause", "today_paused", "resume", "reset"}  # 计划 2026-10-11 GS5
```

`collect()` 末尾 `return out` 前加 `out |= await collect_goals(client, h)`;`test_wordbook_payloads_match_the_web_contract` 中 `assert set(actual) == KEYS` 改为 `assert set(actual) == KEYS | GOALS_KEYS`;在 `collect()` 之后追加:

```python
async def collect_goals(client, h) -> dict:
    """goals v2(spec 2026-10-11 §9):接在 collect() 的流程之后(今天已学 5 个);重置会删词书行,所以放最后。"""
    async def ok(r):
        assert r.status_code == 200, r.text
        return r.json()
    out = {"enrollment_patch": await ok(await client.patch(f"{URL}/enrollment", headers=h, json={"daily_new": 5}))}
    out["bonus"] = await ok(await client.post(f"{URL}/bonus", headers=h, json={"size": 5}))
    out["pause"] = await ok(await client.post(f"{URL}/enrollment/pause", headers=h, json={}))
    out["today_paused"] = await ok(await client.get(f"{URL}/today", headers=h))
    out["resume"] = await ok(await client.post(f"{URL}/enrollment/resume", headers=h, json={"book_id": "junior"}))
    out["reset"] = await ok(await client.post(f"{URL}/enrollment/reset", headers=h,
                                              json={"book_id": "junior", "confirm": "初中"}))
    return out
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd server && uv run pytest -q tests/test_wordbook_contract.py` → FAIL(`shape(actual) != shape(expected)`)

- [ ] **Step 3: 重录样例** — PowerShell:`cd server; $env:CONTRACT_UPDATE=1; uv run pytest -q tests/test_wordbook_contract.py; Remove-Item Env:CONTRACT_UPDATE`。检查 diff:只多出上述键与 `limits`、`paused`、`streak`、`bonus`、`goal_met`、`review_unlimited`;没有令牌、路径。

- [ ] **Step 4: 文档** — `server/app/wordbook/CLAUDE.md` 的 Pitfalls 末尾追加:

```markdown
- Goals v2 (spec `2026-10-11-wordbook-goals-design.md`): `_day_plan(..., settings=settings)` is the only plan entry
  (effective limits, today's bonus, remaining words); `review_cap == 0` means 「不限」 (`plan.REVIEW_UNLIMITED`); stored
  values outside the admin range are clamped on read, never rewritten. New event kinds `relearn` (counts toward
  today's new words, no rank points), `bonus` (credit = words), `goal` (one per local day), `reset`; rank reads only
  `learn`/`spell_set`. `plan.compute_plan` and web `goals-math.previewPlan` share `tests/fixtures/wordbook_plan_cases.json`.
- Reset deletes only `vocabulary_items` with `source='wordbook:<book>'` and resets cursor/seed; the router syncs rank
  first. Settings/pause/resume/bonus share 60/day (`wordbook_settings`), reset 2/day (`wordbook_resets`).
```

- [ ] **Step 5: 跑测试确认通过** — Run: `cd server && uv run pytest -q` → PASS(全量)

- [ ] **Step 6: 提交**

```bash
git add server/tests/test_wordbook_contract.py server/tests/fixtures/wordbook_contract.json server/app/wordbook/CLAUDE.md
git commit -m "test(server): record the wordbook goals contract

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Lane web (GW)

### Task GW1: `goals-math.ts` — 估算公式、方案、计划预览、数字解析

**Files:**
- Create: `web/src/features/wordbook/goals-math.ts`、`web/src/features/wordbook/goals-math.test.ts`

**Interfaces:**
- Consumes:GS1 `server/tests/fixtures/wordbook_plan_cases.json`(只读)
- Produces:`INTERVAL_DAYS`、`CLIMB_REVIEWS = 5`、`BACKLOG_NEW = 5`、`reviewOffsets(horizon: number): number[]`、`daysToFinish(remaining: number, dailyNew: number): number`、`steadyReviews(dailyNew: number): number`、`reviewLoadOn(day: number, dailyNew: number, remaining: number): number`、`interface Estimate { days; steady; atFinish; overCap: boolean }`、`estimate(dailyNew: number, reviewCap: number | null, remaining: number): Estimate`、`type PresetId = "easy" | "standard" | "sprint"`、`interface GoalPreset { id: PresetId; dailyNew: number; reviewCap: number | null }`、`PRESETS`、`matchPreset(dailyNew, reviewCap): PresetId | null`、`interface PlanInput`、`interface PlanPreview`(= GW2 的 `DayPlan`)、`previewPlan(input: PlanInput): PlanPreview`、`clamp(n, min, max)`、`parseCount(text: string): number | null`

- [ ] **Step 1: 写失败测试** — `web/src/features/wordbook/goals-math.test.ts`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import camelcaseKeys from "camelcase-keys";
import { describe, expect, it } from "vitest";
import {
  PRESETS, clamp, daysToFinish, estimate, matchPreset, parseCount, previewPlan, reviewLoadOn, reviewOffsets, steadyReviews,
  type PlanInput,
} from "./goals-math";

// 计划 GP-3:与服务端 compute_plan 共用同一份样例表
const here = path.dirname(fileURLToPath(import.meta.url));
const CASES = JSON.parse(
  readFileSync(path.resolve(here, "../../../../server/tests/fixtures/wordbook_plan_cases.json"), "utf8"),
) as { name: string; in: Record<string, unknown>; out: Record<string, unknown> }[];

describe("goals-math (spec 2026-10-11 §4)", () => {
  it("lists the all-correct review days of the 6-box schedule", () => {
    expect(reviewOffsets(130)).toEqual([1, 3, 7, 14, 29, 59, 89, 119]);
    expect(reviewOffsets(0)).toEqual([]);
  });

  it("matches the spec table for CET-4 (4,544 words)", () => {
    expect([10, 20, 50].map((n) => daysToFinish(4544, n))).toEqual([455, 228, 91]);
    expect([10, 20, 50].map(steadyReviews)).toEqual([50, 100, 250]);
    expect([10, 20, 50].map((n) => reviewLoadOn(daysToFinish(4544, n), n, 4544))).toEqual([184, 204, 344]);
  });

  it("builds the review load day by day", () => {
    expect(reviewLoadOn(0, 20, 4544)).toBe(0);
    expect(reviewLoadOn(2, 20, 4544)).toBe(20);
    expect(reviewLoadOn(3, 20, 4544)).toBe(40);
    expect(reviewLoadOn(29, 20, 4544)).toBe(100); // 稳定期:5 批同时在复习
    expect(daysToFinish(0, 20)).toBe(0);
    expect(estimate(20, 100, 0)).toEqual({ days: 0, steady: 100, atFinish: 0, overCap: false });
  });

  it("gives the mockup numbers for 3,684 remaining words", () => {
    expect(PRESETS.map((p) => [p.id, estimate(p.dailyNew, p.reviewCap, 3684).days, estimate(p.dailyNew, p.reviewCap, 3684).steady]))
      .toEqual([["easy", 369, 50], ["standard", 185, 100], ["sprint", 74, 250]]);
    expect(estimate(35, 100, 3684)).toEqual({ days: 106, steady: 175, atFinish: 219, overCap: true });
    expect(estimate(20, null, 3684).overCap).toBe(false);
  });

  it("matches presets only on exact values", () => {
    expect(matchPreset(10, 100)).toBe("easy");
    expect(matchPreset(20, 200)).toBe("standard");
    expect(matchPreset(50, null)).toBe("sprint");
    expect(matchPreset(20, 100)).toBeNull();
  });

  it("mirrors the server's compute_plan on the shared table", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(12);
    for (const c of CASES) {
      expect(previewPlan(camelcaseKeys(c.in) as unknown as PlanInput), c.name).toEqual(camelcaseKeys(c.out));
    }
  });

  it("parses counts from any keyboard and clamps", () => {
    expect(parseCount("35")).toBe(35);
    expect(parseCount("３５")).toBe(35);
    expect(parseCount(" 7 ")).toBe(7);
    expect(parseCount("")).toBeNull();
    expect(parseCount("3a")).toBeNull();
    expect(parseCount("12345")).toBeNull();
    expect(clamp(250, 1, 200)).toBe(200);
    expect(clamp(-3, 1, 200)).toBe(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd web && yarn vitest run src/features/wordbook/goals-math.test.ts` → FAIL(模块不存在)

- [ ] **Step 3: 实现** — `web/src/features/wordbook/goals-math.ts`:

```ts
// 每日目标的估算与计划预览(spec 2026-10-11 §4、§12.2)。纯函数;previewPlan 与服务端 plan.compute_plan
// 共用 server/tests/fixtures/wordbook_plan_cases.json(计划 GP-3):改规则必须两边一起改。

/** = server/app/services/vocabulary.py INTERVAL_DAYS(下标 = 盒子号)。 */
export const INTERVAL_DAYS = [1, 2, 4, 7, 15, 30] as const;
const TOP_BOX = INTERVAL_DAYS.length - 1;
/** 从盒 0 爬到顶盒要答对的复习次数(学后第 1、3、7、14、29 天)。 */
export const CLIMB_REVIEWS = TOP_BOX;
/** = server plan.BACKLOG_NEW:积压时当天新词总数上限。 */
export const BACKLOG_NEW = 5;

/** 全对模型下,一个词在学后第几天被复习(≤ horizon):1、3、7、14、29,之后每 30 天。 */
export function reviewOffsets(horizon: number): number[] {
  const out: number[] = [];
  let day = 0;
  let box = 0;
  for (;;) {
    day += INTERVAL_DAYS[box];
    if (day > horizon) return out;
    out.push(day);
    box = Math.min(box + 1, TOP_BOX);
  }
}

/** D = ⌈W / N⌉ */
export const daysToFinish = (remaining: number, dailyNew: number) =>
  remaining <= 0 || dailyNew <= 0 ? 0 : Math.ceil(remaining / dailyNew);

/** S = 5N:从第 29 天起每天有 5 批词同时在复习。 */
export const steadyReviews = (dailyNew: number) => dailyNew * CLIMB_REVIEWS;

/** R(t):从今天起每天学 N 个(最后一天学剩下的),第 day 天的复习量。 */
export function reviewLoadOn(day: number, dailyNew: number, remaining: number): number {
  const days = daysToFinish(remaining, dailyNew);
  if (days === 0 || day < 1) return 0;
  const lastDay = remaining - dailyNew * (days - 1);
  let total = 0;
  for (const offset of reviewOffsets(day)) {
    const learnedOn = day - offset;
    if (learnedOn < days) total += learnedOn === days - 1 ? lastDay : dailyNew;
  }
  return total;
}

export interface Estimate { days: number; steady: number; atFinish: number; overCap: boolean }

export function estimate(dailyNew: number, reviewCap: number | null, remaining: number): Estimate {
  const days = daysToFinish(remaining, dailyNew);
  const steady = steadyReviews(dailyNew);
  return { days, steady, atFinish: reviewLoadOn(days, dailyNew, remaining), overCap: reviewCap !== null && steady > reviewCap };
}

export type PresetId = "easy" | "standard" | "sprint";
export interface GoalPreset { id: PresetId; dailyNew: number; reviewCap: number | null }

/** spec §4.1;reviewCap null = 不限 */
export const PRESETS: readonly GoalPreset[] = [
  { id: "easy", dailyNew: 10, reviewCap: 100 },
  { id: "standard", dailyNew: 20, reviewCap: 200 },
  { id: "sprint", dailyNew: 50, reviewCap: null },
];

export const matchPreset = (dailyNew: number, reviewCap: number | null): PresetId | null =>
  PRESETS.find((p) => p.dailyNew === dailyNew && p.reviewCap === reviewCap)?.id ?? null;

export interface PlanInput {
  dailyNew: number;
  /** null = 不限 */
  reviewCap: number | null;
  newDone: number;
  reviewDone: number;
  reviewDue: number;
  bonus?: number;
  guardThreshold?: number | null;
  remaining?: number | null;
}

export interface PlanPreview {
  newTarget: number; newDone: number; newLeft: number; reviewDue: number; reviewDone: number; reviewLeft: number;
  backlogGuard: boolean; bonus: number; goalMet: boolean;
}

/** 镜像服务端 compute_plan(含 G-3 积压修正与 G-6 达标)。 */
export function previewPlan(i: PlanInput): PlanPreview {
  const bonus = i.bonus ?? 0;
  const remaining = i.remaining ?? null;
  const threshold = i.reviewCap ?? i.guardThreshold ?? null;
  const guard = threshold !== null && i.reviewDue > threshold;
  const target = i.dailyNew + bonus;
  let newLeft = Math.max(0, (guard ? Math.min(target, BACKLOG_NEW) : target) - i.newDone);
  if (remaining !== null) newLeft = Math.min(newLeft, Math.max(0, remaining));
  const reviewLeft = i.reviewCap === null ? i.reviewDue : Math.min(i.reviewDue, Math.max(0, i.reviewCap - i.reviewDone));
  let goalNew = guard ? Math.min(i.dailyNew, BACKLOG_NEW) : i.dailyNew;
  if (remaining !== null) goalNew = Math.min(goalNew, i.newDone + Math.max(0, remaining));
  const goalMet = i.newDone + i.reviewDone > 0 && i.newDone >= goalNew && reviewLeft === 0;
  return { newTarget: target, newDone: i.newDone, newLeft, reviewDue: i.reviewDue, reviewDone: i.reviewDone, reviewLeft,
    backlogGuard: guard, bonus, goalMet };
}

export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** 只接受 1–4 位数字(含全角数字,中文输入法常见);其它返回 null。 */
export function parseCount(text: string): number | null {
  const ascii = text.trim().replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  return /^\d{1,4}$/.test(ascii) ? Number(ascii) : null;
}
```

- [ ] **Step 4: 跑测试确认通过** — Run: `cd web && yarn vitest run src/features/wordbook/goals-math.test.ts` → PASS

- [ ] **Step 5: 提交**

```bash
git add web/src/features/wordbook/goals-math.ts web/src/features/wordbook/goals-math.test.ts
git commit -m "feat(web): wordbook goal estimates and plan preview shared with the server table

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task GW2: API 类型与函数、`useGoals`(乐观更新)、契约测试

**Files:**
- Modify: `web/src/features/wordbook/wordbook-api.ts`、`web/src/features/wordbook/use-today.ts`、`web/src/features/wordbook/wordbook-contract.test.ts`
- Create: `web/src/features/wordbook/goals-test-fixtures.ts`、`web/src/features/wordbook/use-goals.ts`、`web/src/features/wordbook/goals-api.test.ts`、`web/src/features/wordbook/use-goals.test.ts`

**Interfaces:**
- Consumes:GS5 契约样例;GW1 `previewPlan`
- Produces(`wordbook-api.ts`,P-W4 Addendum = spec G-9):`interface GoalLimits { dailyNew: { min: number; max: number }; reviewCap: { min: number; max: number }; reviewUnlimited: boolean; bonusMax: number }`;`WordbookConfig` 启用分支 + `limits: GoalLimits`;`Enrollment` + `reviewUnlimited: boolean`;`DayPlan` + `bonus: number; goalMet: boolean`;`interface Streak { current: number; todayMet: boolean }`;`Today` + `paused: Enrollment | null; streak: Streak`;`interface GoalsPatch { dailyNew?: number; reviewCap?: number; reviewUnlimited?: true; orderMode?: OrderMode }`;`interface BonusResult { plan: DayPlan; bonusLeft: number }`;`interface ResetResult { removed: number; enrollment: Enrollment }`;`DEFAULT_LIMITS`;`limitsOf(config: WordbookConfig | null): GoalLimits`;`patchEnrollment(api, input: GoalsPatch)`;`grantBonus(api, size: number)`;`pauseEnrollment(api)`;`resumeEnrollment(api, bookId: BookId)`;`resetProgress(api, bookId: BookId, confirm: string)`;`saveEnrollment` 的 input + `reviewUnlimited?: true`
- Produces(`use-today.ts`):`useWordbookToday` 追加返回 `setToday: (today: Today) => void`
- Produces(`use-goals.ts`):`optimistic(today: Today, patch: GoalsPatch, limits: GoalLimits): Today`;`useGoals({ today, setToday, reload, limits }) => { saving: boolean; error: string | null; busy: null | "bonus" | "pause" | "resume" | "reset"; patch(input): Promise<boolean>; bonus(size): Promise<BonusResult | null>; pause(): Promise<Enrollment | null>; resume(bookId): Promise<Enrollment | null>; reset(bookId, confirm): Promise<ResetResult | null> }`

- [ ] **Step 1: 测试样例** — `web/src/features/wordbook/goals-test-fixtures.ts`(只追加字段,不改 v1 样例,GP-5):

```ts
// goals v2 的服务端响应样例(snake_case;spec 2026-10-11 §9)。只被 *.test.ts(x) 引用。
import type { GoalLimits } from "./wordbook-api";
import { CONFIG, ENROLLED_TODAY, ENROLLMENT, PLAN } from "./test-fixtures";

export const GOALS_CONFIG = {
  ...CONFIG,
  limits: { daily_new: { min: 1, max: 200 }, review_cap: { min: 10, max: 1000 }, review_unlimited: true, bonus_max: 50 },
};
export const GOALS_ENROLLMENT = { ...ENROLLMENT, review_unlimited: false };
export const GOALS_PLAN = { ...PLAN, bonus: 0, goal_met: false };
export const GOALS_TODAY = { ...ENROLLED_TODAY, enrollment: GOALS_ENROLLMENT, plan: GOALS_PLAN, paused: null, streak: { current: 12, today_met: false } };
export const GOAL_MET_TODAY = {
  ...GOALS_TODAY,
  plan: { ...GOALS_PLAN, new_done: 20, new_left: 0, review_due: 0, review_done: 34, review_left: 0, goal_met: true },
  streak: { current: 13, today_met: true },
};
export const PAUSED_TODAY = {
  enrollment: null, book: null, plan: null, progress: null, tomorrow_due: 0,
  paused: { ...GOALS_ENROLLMENT, status: "paused" }, streak: { current: 0, today_met: false },
};
/** camelCase 的范围(组件测试直接传 props) */
export const LIMITS: GoalLimits = { dailyNew: { min: 1, max: 200 }, reviewCap: { min: 10, max: 1000 }, reviewUnlimited: true, bonusMax: 50 };
```

- [ ] **Step 2: 写失败测试** — `web/src/features/wordbook/goals-api.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { GOALS_CONFIG, GOALS_ENROLLMENT, GOALS_PLAN } from "./goals-test-fixtures";
import { CONFIG } from "./test-fixtures";
import {
  DEFAULT_LIMITS, WORDBOOK_SERVER_ERRORS, grantBonus, limitsOf, patchEnrollment, pauseEnrollment, resetProgress, resumeEnrollment,
  type WordbookConfig,
} from "./wordbook-api";
import camelcaseKeys from "camelcase-keys";

describe("goals API (plan 2026-10-11 GW2)", () => {
  it("sends snake_case bodies to the goals endpoints", async () => {
    const mock = createFetchMock({
      "PATCH /api/wordbook/enrollment": () => json(GOALS_ENROLLMENT),
      "POST /api/wordbook/bonus": () => json({ plan: GOALS_PLAN, bonus_left: 40 }),
      "POST /api/wordbook/enrollment/pause": () => json({ ...GOALS_ENROLLMENT, status: "paused" }),
      "POST /api/wordbook/enrollment/resume": () => json(GOALS_ENROLLMENT),
      "POST /api/wordbook/enrollment/reset": () => json({ removed: 860, enrollment: GOALS_ENROLLMENT }),
    });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    expect((await patchEnrollment(api, { dailyNew: 35, reviewUnlimited: true })).reviewUnlimited).toBe(false);
    expect((await grantBonus(api, 10)).bonusLeft).toBe(40);
    expect((await pauseEnrollment(api)).status).toBe("paused");
    await resumeEnrollment(api, "cet4");
    expect((await resetProgress(api, "cet4", "四级")).removed).toBe(860);
    const bodies = mock.calls.map((c) => [c.method, c.url.pathname, JSON.parse(String(c.body))] as const);
    expect(bodies[0]).toEqual(["PATCH", "/api/wordbook/enrollment", { daily_new: 35, review_unlimited: true }]);
    expect(bodies[1][2]).toMatchObject({ size: 10 });
    expect(typeof bodies[1][2].tz_offset_minutes).toBe("number");
    expect(bodies[2][2]).toEqual({});
    expect(bodies[3][2]).toEqual({ book_id: "cet4" });
    expect(bodies[4][2]).toMatchObject({ book_id: "cet4", confirm: "四级" });
  });

  it("falls back to the hard limits for an older server", () => {
    expect(limitsOf(camelcaseKeys(CONFIG, { deep: true }) as unknown as WordbookConfig)).toEqual(DEFAULT_LIMITS);
    expect(limitsOf(camelcaseKeys(GOALS_CONFIG, { deep: true }) as unknown as WordbookConfig).bonusMax).toBe(50);
    expect(limitsOf(null)).toEqual(DEFAULT_LIMITS);
  });

  it("maps the new server errors to goals copy", () => {
    expect(WORDBOOK_SERVER_ERRORS["Daily bonus limit reached"]).toBe("web.wordbook.goals.errors.bonusLimit");
    expect(WORDBOOK_SERVER_ERRORS["Confirmation does not match"]).toBe("web.wordbook.goals.errors.confirmMismatch");
    expect(WORDBOOK_SERVER_ERRORS["Too many settings changes today"]).toBe("web.wordbook.goals.errors.settingsLimit");
  });
});
```

`web/src/features/wordbook/use-goals.test.ts`:

```ts
import camelcaseKeys from "camelcase-keys";
import { describe, expect, it } from "vitest";
import { GOALS_TODAY, LIMITS } from "./goals-test-fixtures";
import { optimistic } from "./use-goals";
import type { Today } from "./wordbook-api";

const today = () => camelcaseKeys(GOALS_TODAY, { deep: true }) as unknown as Today;

describe("optimistic (plan GP-4)", () => {
  it("raises today's new words at once and keeps progress", () => {
    const next = optimistic(today(), { dailyNew: 35 }, LIMITS);
    expect(next.enrollment?.dailyNew).toBe(35);
    expect(next.plan).toMatchObject({ newTarget: 35, newDone: 8, newLeft: 27 });
    expect(next.progress).toEqual(today().progress);
  });

  it("lowers below today's count without going negative", () => {
    expect(optimistic(today(), { dailyNew: 5 }, LIMITS).plan).toMatchObject({ newLeft: 0, newDone: 8 });
  });

  it("switches to unlimited reviews and back", () => {
    const unlimited = optimistic(today(), { reviewUnlimited: true }, LIMITS);
    expect(unlimited.enrollment).toMatchObject({ reviewUnlimited: true, reviewCap: 0 });
    expect(unlimited.plan?.reviewLeft).toBe(34);
    const capped = optimistic(unlimited, { reviewCap: 20 }, LIMITS);
    expect(capped.enrollment).toMatchObject({ reviewUnlimited: false, reviewCap: 20 });
    expect(capped.plan).toMatchObject({ reviewLeft: 20, backlogGuard: true, newLeft: 0 });
  });

  it("leaves a day without an active book alone", () => {
    const paused = { ...today(), enrollment: null, plan: null };
    expect(optimistic(paused, { dailyNew: 5 }, LIMITS)).toBe(paused);
  });
});
```

`capped`:reviewCap 20、reviewDue 34 > 20 → 积压;newDone 8 ≥ 5 → newLeft 0。

- [ ] **Step 3: 跑测试确认失败** — Run: `cd web && yarn vitest run src/features/wordbook/goals-api.test.ts src/features/wordbook/use-goals.test.ts` → FAIL

- [ ] **Step 4: 实现 `wordbook-api.ts`**(接口末尾追加字段;新导出追加到文件末尾)
  - `WordbookConfig` 启用分支改为 `{ enabled: true; aiAvailable: boolean; defaults: { dailyNew: number; reviewCap: number }; books: WordbookBook[]; limits: GoalLimits }`。
  - `Enrollment` 末尾加 `; reviewUnlimited: boolean`;`DayPlan` 末尾加 `; bonus: number; goalMet: boolean`;`Today` 末尾加 `; paused: Enrollment | null; streak: Streak`。
  - `saveEnrollment` 的 input 类型加 `reviewUnlimited?: true`。
  - `WORDBOOK_SERVER_ERRORS` 末尾追加:

```ts
  "No changes": "web.wordbook.goals.errors.noChanges",
  "Daily new words out of range": "web.wordbook.goals.errors.outOfRangeNew",
  "Review cap out of range": "web.wordbook.goals.errors.outOfRangeReview",
  "Unlimited reviews are off": "web.wordbook.goals.errors.unlimitedOff",
  "Conflicting review cap": "web.wordbook.goals.errors.conflicting",
  "Too many settings changes today": "web.wordbook.goals.errors.settingsLimit",
  "Book not enrolled": "web.wordbook.goals.errors.notEnrolled",
  "Finish today's new words first": "web.wordbook.goals.errors.goalNotDone",
  "Clear the review backlog first": "web.wordbook.goals.errors.backlog",
  "No new words left in this book": "web.wordbook.goals.errors.bookFinished",
  "Daily bonus limit reached": "web.wordbook.goals.errors.bonusLimit",
  "Daily reset limit reached": "web.wordbook.goals.errors.resetLimit",
  "Confirmation does not match": "web.wordbook.goals.errors.confirmMismatch",
```

  - 文件末尾追加:

```ts
// ---- 每日目标(goals v2,spec 2026-10-11 §9;计划 2026-10-11 GW2 = P-W4 Addendum)----

export interface GoalLimits { dailyNew: { min: number; max: number }; reviewCap: { min: number; max: number }; reviewUnlimited: boolean; bonusMax: number }
export interface Streak { current: number; todayMet: boolean }
export interface GoalsPatch { dailyNew?: number; reviewCap?: number; reviewUnlimited?: true; orderMode?: OrderMode }
export interface BonusResult { plan: DayPlan; bonusLeft: number }
export interface ResetResult { removed: number; enrollment: Enrollment }

/** 服务端硬边界(老版本服务端的 config 没有 limits 时使用) */
export const DEFAULT_LIMITS: GoalLimits = { dailyNew: { min: 1, max: 200 }, reviewCap: { min: 10, max: 1000 }, reviewUnlimited: true, bonusMax: 50 };

export const limitsOf = (config: WordbookConfig | null): GoalLimits =>
  (config?.enabled && config.limits ? config.limits : DEFAULT_LIMITS);

export const patchEnrollment = (api: ApiClient, input: GoalsPatch) =>
  api.request<Enrollment>("PATCH", "/api/wordbook/enrollment", { json: input });

export const grantBonus = (api: ApiClient, size: number) =>
  api.request<BonusResult>("POST", "/api/wordbook/bonus", { json: { size, ...tz() } });

export const pauseEnrollment = (api: ApiClient) =>
  api.request<Enrollment>("POST", "/api/wordbook/enrollment/pause", { json: {} });

export const resumeEnrollment = (api: ApiClient, bookId: BookId) =>
  api.request<Enrollment>("POST", "/api/wordbook/enrollment/resume", { json: { bookId } });

export const resetProgress = (api: ApiClient, bookId: BookId, confirm: string) =>
  api.request<ResetResult>("POST", "/api/wordbook/enrollment/reset", { json: { bookId, confirm, ...tz() } });
```

- [ ] **Step 5: 实现 `use-today.ts` 与 `use-goals.ts`**
  - `use-today.ts`:`return { today, error, reload };` 改为 `return { today, error, reload, setToday };`。
  - `web/src/features/wordbook/use-goals.ts`:

```ts
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { previewPlan } from "./goals-math";
import {
  WORDBOOK_SERVER_ERRORS, grantBonus, patchEnrollment, pauseEnrollment, resetProgress, resumeEnrollment,
  type BookId, type GoalLimits, type GoalsPatch, type Today,
} from "./wordbook-api";

/** 乐观更新(GP-4):把 patch 套到 today 上并用 previewPlan 重算今天;服务端结果回来后 reload 覆盖。 */
export function optimistic(today: Today, patch: GoalsPatch, limits: GoalLimits): Today {
  if (!today.enrollment || !today.plan) return today;
  const unlimited = patch.reviewUnlimited === true ? true : patch.reviewCap !== undefined ? false : today.enrollment.reviewUnlimited;
  const enrollment = {
    ...today.enrollment,
    dailyNew: patch.dailyNew ?? today.enrollment.dailyNew,
    reviewCap: unlimited ? 0 : patch.reviewCap ?? today.enrollment.reviewCap,
    reviewUnlimited: unlimited,
    orderMode: patch.orderMode ?? today.enrollment.orderMode,
  };
  const plan = previewPlan({
    dailyNew: enrollment.dailyNew, reviewCap: unlimited ? null : enrollment.reviewCap, newDone: today.plan.newDone,
    reviewDone: today.plan.reviewDone, reviewDue: today.plan.reviewDue, bonus: today.plan.bonus,
    guardThreshold: limits.reviewCap.max, remaining: today.progress?.remaining ?? null,
  });
  return { ...today, enrollment, plan };
}

type Busy = null | "bonus" | "pause" | "resume" | "reset";

/** 面板与首页共用的变更(spec §12.2)。只有 patch 乐观更新;按序号丢弃过期响应。 */
export function useGoals({ today, setToday, reload, limits }: {
  today: Today | null;
  setToday: (today: Today) => void;
  reload: () => void;
  limits: GoalLimits;
}) {
  const { api } = useAuth();
  const { t } = useTranslation();
  const seq = useRef(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const explain = useCallback((err: unknown) => setError(translateServerError(t, err, WORDBOOK_SERVER_ERRORS)), [t]);

  const patch = useCallback(async (input: GoalsPatch): Promise<boolean> => {
    if (!today?.enrollment) return false;
    const before = today;
    const id = ++seq.current;
    setToday(optimistic(today, input, limits));
    setSaving(true);
    setError(null);
    try {
      await patchEnrollment(api, input);
      if (id === seq.current) reload();
      return true;
    } catch (err) {
      if (id === seq.current) {
        setToday(before);
        explain(err);
      }
      return false;
    } finally {
      if (id === seq.current) setSaving(false);
    }
  }, [api, today, setToday, reload, limits, explain]);

  const run = useCallback(async <T,>(kind: Exclude<Busy, null>, call: () => Promise<T>): Promise<T | null> => {
    setBusy(kind);
    setError(null);
    try {
      const value = await call();
      reload();
      return value;
    } catch (err) {
      explain(err);
      return null;
    } finally {
      setBusy(null);
    }
  }, [reload, explain]);

  return {
    saving, error, busy, patch,
    bonus: (size: number) => run("bonus", () => grantBonus(api, size)),
    pause: () => run("pause", () => pauseEnrollment(api)),
    resume: (bookId: BookId) => run("resume", () => resumeEnrollment(api, bookId)),
    reset: (bookId: BookId, confirm: string) => run("reset", () => resetProgress(api, bookId, confirm)),
  };
}

export type GoalsApi = ReturnType<typeof useGoals>;
```

- [ ] **Step 6: 契约测试** — `web/src/features/wordbook/wordbook-contract.test.ts`:
  - 类型导入追加 `BonusResult, GoalLimits, ResetResult, Streak, WordbookConfig`。
  - `TODAY` 追加 `paused: true, streak: true`;`PLAN` 追加 `bonus: true, goalMet: true`;`ENROLLMENT` 追加 `reviewUnlimited: true`;其后新增

```ts
const STREAK: Record<keyof Streak, true> = { current: true, todayMet: true };
const LIMITS: Record<keyof GoalLimits, true> = { dailyNew: true, reviewCap: true, reviewUnlimited: true, bonusMax: true };
const BONUS: Record<keyof BonusResult, true> = { plan: true, bonusLeft: true };
const RESET: Record<keyof ResetResult, true> = { removed: true, enrollment: true };
```

  - `describe` 末尾追加:

```ts
  it("goals v2 payloads match (plan 2026-10-11 GW2)", () => {
    expect(keysOf(cc<Extract<WordbookConfig, { enabled: true }>>(c.config).limits)).toEqual(keys(LIMITS));
    expect(keysOf(cc<Today>(c.today).streak)).toEqual(keys(STREAK));
    expect(keysOf(cc<Enrollment>(c.enrollment_patch))).toEqual(keys(ENROLLMENT));
    const bonus = cc<BonusResult>(c.bonus);
    expect(keysOf(bonus)).toEqual(keys(BONUS));
    expect(keysOf(bonus.plan)).toEqual(keys(PLAN));
    expect(cc<Enrollment>(c.pause).status).toBe("paused");
    const paused = cc<Today>(c.today_paused);
    expect(paused.enrollment).toBeNull();
    expect(keysOf(paused.paused as Enrollment)).toEqual(keys(ENROLLMENT));
    expect(keysOf(cc<Enrollment>(c.resume))).toEqual(keys(ENROLLMENT));
    const reset = cc<ResetResult>(c.reset);
    expect(keysOf(reset)).toEqual(keys(RESET));
    expect(keysOf(reset.enrollment)).toEqual(keys(ENROLLMENT));
  });
```

- [ ] **Step 7: 跑测试确认通过** — Run: `yarn web:typecheck && cd web && yarn vitest run src/features/wordbook` → PASS

- [ ] **Step 8: 提交**

```bash
git add web/src/features/wordbook/wordbook-api.ts web/src/features/wordbook/use-today.ts web/src/features/wordbook/use-goals.ts web/src/features/wordbook/goals-test-fixtures.ts web/src/features/wordbook/goals-api.test.ts web/src/features/wordbook/use-goals.test.ts web/src/features/wordbook/wordbook-contract.test.ts
git commit -m "feat(web): wordbook goals API types, optimistic goal updates and contract keys

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task GW3: 步进器、设置字段组件与文案

**Files:**
- Create: `web/src/features/wordbook/goals-stepper.tsx`、`goals-stepper.test.tsx`、`goals-fields.tsx`、`goals-fields.test.tsx`
- Modify: `web/src/features/wordbook/i18n/zh-CN.json`、`web/src/features/wordbook/i18n/en.json`(新增 `goals` 子树)

**Interfaces:**
- Consumes:GW1、GW2;`~/components/segmented-control`
- Produces:`STEP_DEBOUNCE_MS = 600`;`GoalsStepper({ label, value, min, max, step?, onCommit, testId? })`;`interface GoalsValue { dailyNew: number; reviewCap: number | null; orderMode: OrderMode }`;`interface GoalsToday { newDone: number; reviewDone: number; reviewDue: number; bonus: number }`;`applyPatch(value: GoalsValue, patch: GoalsPatch): GoalsValue`;`valueOf(enrollment: { dailyNew: number; reviewCap: number; reviewUnlimited?: boolean; orderMode?: OrderMode }): GoalsValue`;`GoalsFields({ value, limits, remaining, today?, onChange })`

- [ ] **Step 1: 文案** — 在两个 `i18n/*.json` 的 `web.wordbook` 下新增 `goals`(键一一对应、占位符相同、复数键两种语言都有 `_one/_other`):

`zh-CN.json`:

```json
"goals": {
  "title": "每日目标",
  "open": "每日目标设置",
  "openFromRing": "调整今天的目标",
  "subtitle": "{{book}} · 剩余 {{n}} 词 · 改动立即生效",
  "saved": "已保存",
  "dailyNew": "每日新词",
  "reviewCap": "每日复习上限",
  "custom": "自定义",
  "unlimited": "不限",
  "presets": {
    "label": "方案", "custom": "自定义", "easy": "轻松", "standard": "标准", "sprint": "冲刺",
    "values": "新词 {{n}} · 复习 {{cap}}",
    "days_one": "约 {{days}} 天学完", "days_other": "约 {{days}} 天学完",
    "steady": "稳定后每天复习约 {{n}}",
    "limited": "管理员已限制"
  },
  "stepper": { "less": "减少{{label}}", "more": "增加{{label}}", "range": "范围 {{min}}–{{max}}" },
  "today": {
    "label": "今天",
    "new": "新词 {{done}} / {{target}} · 还能学 {{left}} 个",
    "review": "复习 {{done}} / {{total}}",
    "reviewUnlimited": "复习 {{done}} · 到期 {{due}}(不限)",
    "backlog": "到期 {{due}} 个,超过复习上限 {{cap}}:今天新词最多 5 个(复习降到上限以内后恢复)"
  },
  "estimate": {
    "line_one": "按这个设置约 {{days}} 天学完 · 稳定后每天复习约 {{steady}} 个",
    "line_other": "按这个设置约 {{days}} 天学完 · 稳定后每天复习约 {{steady}} 个",
    "done": "这本书的新词已经学完了",
    "overCap": "高于复习上限 {{cap}},复习会积压",
    "note": "按全部答对估算;答错的词会回到第一盒,实际复习更多。已掌握的词每 30 天复习一次,学到后期每天复习会逐渐增加(学到最后约 {{finish}} 个)。"
  },
  "order": { "label": "顺序", "note": "改顺序后从新的顺序取词,已学的词不受影响" },
  "bonus": {
    "label": "今天加练", "sizes": "加练数量", "action": "加练 {{n}} 个", "left": "今天还可加练 {{n}} 个",
    "needGoal": "先学完今天剩下的 {{n}} 个新词", "backlog": "先把复习积压清掉", "limit": "今天的加练已达上限 {{max}} 个",
    "off": "管理员关闭了加练", "finished": "这本书的新词已经学完了"
  },
  "streak": {
    "label": "连续达标",
    "days_one": "连续达标 {{n}} 天", "days_other": "连续达标 {{n}} 天",
    "none": "还没有连续达标", "todayMet": "今天已达标", "todayNew": "今天还差 {{n}} 个新词", "todayReviews": "今天还差 {{n}} 个复习",
    "help": "达标 = 当天新词学满目标(不含加练)、到期复习清零;按你手机的日期算,中断一天就重新计。",
    "cell": "连续", "cellDays_one": "{{n}} 天", "cellDays_other": "{{n}} 天", "cellNone": "—"
  },
  "rows": { "switch": "换书", "pause": "暂停这本书", "reset": "重置进度" },
  "pause": {
    "title": "暂停{{book}}?",
    "body": "暂停后首页不再安排新词和复习,到期的词会累积;学习记录全部保留,随时可以继续。连续达标不会冻结。",
    "confirm": "暂停"
  },
  "reset": {
    "title": "重置{{book}}的进度?",
    "clears": "会清除:这本书带来的词的学习状态(盒子、到期时间)和学习位置。",
    "keeps": "不会清除:答题记录、段位点与已获得的成就、连续达标、生词本和其他词书里的词(这些词仍算已学)。",
    "learned_one": "本书已学 {{n}} 词", "learned_other": "本书已学 {{n}} 词",
    "input": "输入「{{book}}」确认", "confirm": "重置进度", "done": "已重置{{book}}的进度"
  },
  "paused": { "badge": "已暂停", "note": "暂停期间到期的词会累积,继续后按复习上限分几天复习完。", "resume": "继续学习", "switch": "换一本" },
  "goalMet": { "title": "今天的目标完成了", "body": "想多学一点?可以加练几个新词。", "action": "今天加练" },
  "errors": {
    "noChanges": "没有改动", "outOfRangeNew": "每日新词超出允许范围", "outOfRangeReview": "每日复习上限超出允许范围",
    "unlimitedOff": "管理员关闭了「不限」", "conflicting": "复习上限和「不限」只能选一个", "settingsLimit": "今天改设置的次数太多了,明天再试",
    "notEnrolled": "还没选过这本书", "goalNotDone": "先学完今天的新词再加练", "backlog": "先把复习积压清掉再加练",
    "bookFinished": "这本书没有新词了", "bonusLimit": "今天的加练已达上限", "resetLimit": "今天重置次数已达上限",
    "confirmMismatch": "输入的书名不一致"
  }
}
```

`en.json`:

```json
"goals": {
  "title": "Daily goal",
  "open": "Daily goal settings",
  "openFromRing": "Adjust today's goal",
  "subtitle": "{{book}} · {{n}} words left · changes apply now",
  "saved": "Saved",
  "dailyNew": "New words per day",
  "reviewCap": "Daily review limit",
  "custom": "Custom",
  "unlimited": "No limit",
  "presets": {
    "label": "Plans", "custom": "Custom", "easy": "Relaxed", "standard": "Standard", "sprint": "Sprint",
    "values": "{{n}} new · {{cap}} reviews",
    "days_one": "about {{days}} day to finish", "days_other": "about {{days}} days to finish",
    "steady": "then about {{n}} reviews a day",
    "limited": "Limited by the admin"
  },
  "stepper": { "less": "Decrease {{label}}", "more": "Increase {{label}}", "range": "Range {{min}}–{{max}}" },
  "today": {
    "label": "Today",
    "new": "New {{done}} / {{target}} · {{left}} left",
    "review": "Reviews {{done}} / {{total}}",
    "reviewUnlimited": "Reviews {{done}} · {{due}} due (no limit)",
    "backlog": "{{due}} due, above the review limit {{cap}}: at most 5 new words today (back to normal once reviews are under the limit)"
  },
  "estimate": {
    "line_one": "About {{days}} day to finish · then about {{steady}} reviews a day",
    "line_other": "About {{days}} days to finish · then about {{steady}} reviews a day",
    "done": "You have learned every new word in this book",
    "overCap": "Above your review limit of {{cap}}: reviews will pile up",
    "note": "Assumes every answer is right; missed words go back to box 1, so expect more. Mastered words come back every 30 days, so reviews grow later on (about {{finish}} a day by the end)."
  },
  "order": { "label": "Order", "note": "New words come in the new order; learned words are not affected" },
  "bonus": {
    "label": "Extra words today", "sizes": "How many", "action": "Add {{n}} words", "left": "{{n}} more allowed today",
    "needGoal": "Finish today's {{n}} remaining new words first", "backlog": "Clear the review backlog first",
    "limit": "Today's extra words are capped at {{max}}", "off": "Extra words are turned off by the admin",
    "finished": "You have learned every new word in this book"
  },
  "streak": {
    "label": "Goal streak",
    "days_one": "{{n}}-day goal streak", "days_other": "{{n}}-day goal streak",
    "none": "No goal streak yet", "todayMet": "Goal met today", "todayNew": "{{n}} new words to go today", "todayReviews": "{{n}} reviews to go today",
    "help": "A goal day = today's new words done (extra words not needed) and due reviews cleared, by your phone's date; one missed day restarts it.",
    "cell": "Streak", "cellDays_one": "{{n}} day", "cellDays_other": "{{n}} days", "cellNone": "—"
  },
  "rows": { "switch": "Change book", "pause": "Pause this book", "reset": "Reset progress" },
  "pause": {
    "title": "Pause {{book}}?",
    "body": "No new words or reviews will be scheduled and due words will pile up; your history stays and you can resume any time. Your goal streak is not frozen.",
    "confirm": "Pause"
  },
  "reset": {
    "title": "Reset progress in {{book}}?",
    "clears": "Clears: the learning state (boxes, due dates) of words this book added, and your place in the book.",
    "keeps": "Keeps: your answer history, rank points and achievements, goal streak, and words from your word list or other books (they still count as learned).",
    "learned_one": "{{n}} word learned in this book", "learned_other": "{{n}} words learned in this book",
    "input": "Type “{{book}}” to confirm", "confirm": "Reset progress", "done": "Progress in {{book}} was reset"
  },
  "paused": { "badge": "Paused", "note": "Words keep falling due while paused; after resuming they are spread over days by your review limit.", "resume": "Resume", "switch": "Change book" },
  "goalMet": { "title": "Today's goal is done", "body": "Want a little more? Add a few extra new words.", "action": "Extra words" },
  "errors": {
    "noChanges": "Nothing to change", "outOfRangeNew": "New words per day is outside the allowed range",
    "outOfRangeReview": "Daily review limit is outside the allowed range", "unlimitedOff": "“No limit” is turned off by the admin",
    "conflicting": "Choose a review limit or “No limit”, not both", "settingsLimit": "Too many settings changes today, try tomorrow",
    "notEnrolled": "You have not picked this book yet", "goalNotDone": "Finish today's new words before adding more",
    "backlog": "Clear the review backlog before adding more", "bookFinished": "No new words left in this book",
    "bonusLimit": "Today's extra words are used up", "resetLimit": "No more resets today", "confirmMismatch": "The book name does not match"
  }
}
```

代码里给复数键传 `count`(与 `n` / `days` 相同的值)。

- [ ] **Step 2: 写失败测试** — `web/src/features/wordbook/goals-stepper.test.tsx`:

```tsx
import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import { renderWithProviders } from "~/test/render";
import { GoalsStepper, STEP_DEBOUNCE_MS } from "./goals-stepper";

beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); void i18n.changeLanguage("zh-CN"); });
afterEach(() => { vi.useRealTimers(); localStorage.removeItem("enjoy-web.settings"); void i18n.changeLanguage("en"); });

function setup(value = 20, min = 1, max = 200) {
  const onCommit = vi.fn();
  renderWithProviders(<GoalsStepper label="每日新词" value={value} min={min} max={max} onCommit={onCommit} />);
  return onCommit;
}

describe("GoalsStepper", () => {
  it("is a labelled group with 44px keys and a numeric keyboard", () => {
    setup(1);
    expect(screen.getByRole("group", { name: "每日新词" })).toBeTruthy();
    const input = screen.getByRole("textbox", { name: "每日新词" });
    expect(input).toHaveAttribute("inputmode", "numeric");
    expect(input).toHaveAttribute("enterkeyhint", "done");
    expect(input).toHaveAccessibleDescription("范围 1–200");
    expect(screen.getByRole("button", { name: "减少每日新词" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "增加每日新词" }).className).toContain("h-tap");
  });

  it("debounces taps into one commit", () => {
    vi.useFakeTimers();
    const onCommit = setup();
    const more = screen.getByRole("button", { name: "增加每日新词" });
    fireEvent.click(more);
    fireEvent.click(more);
    fireEvent.click(more);
    expect(screen.getByRole("textbox", { name: "每日新词" })).toHaveValue("23");
    expect(onCommit).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(STEP_DEBOUNCE_MS); });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(23);
  });

  it("commits typed full-width digits on Enter, clamped to the range", () => {
    const onCommit = setup();
    const input = screen.getByRole("textbox", { name: "每日新词" });
    input.focus();
    fireEvent.change(input, { target: { value: "２５０" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith(200);
    expect(input).toHaveValue("200");
  });

  it("restores the saved value when the input is not a number", () => {
    const onCommit = setup();
    const input = screen.getByRole("textbox", { name: "每日新词" });
    input.focus();
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.blur(input);
    expect(input).toHaveValue("20");
    expect(onCommit).not.toHaveBeenCalled();
  });
});
```

`web/src/features/wordbook/goals-fields.test.tsx`:

```tsx
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import { renderWithProviders } from "~/test/render";
import { GoalsFields, applyPatch, type GoalsValue } from "./goals-fields";
import { LIMITS } from "./goals-test-fixtures";

beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); void i18n.changeLanguage("zh-CN"); });
afterEach(() => { localStorage.removeItem("enjoy-web.settings"); void i18n.changeLanguage("en"); });

function setup(value: Partial<GoalsValue> = {}, extra: Partial<Parameters<typeof GoalsFields>[0]> = {}) {
  const onChange = vi.fn();
  renderWithProviders(
    <GoalsFields value={{ dailyNew: 20, reviewCap: 200, orderMode: "shuffle", ...value }} limits={LIMITS} remaining={3684} onChange={onChange} {...extra} />,
  );
  return onChange;
}

describe("GoalsFields", () => {
  it("selects the matching plan and shows its estimate", () => {
    setup();
    const standard = screen.getByRole("radio", { name: /标准/ });
    expect(standard).toHaveAttribute("aria-checked", "true");
    expect(standard).toHaveTextContent("约 185 天学完");
    expect(standard).toHaveTextContent("稳定后每天复习约 100");
    expect(screen.getByRole("radio", { name: /轻松/ })).toHaveTextContent("约 369 天学完");
    expect(screen.getByRole("radio", { name: /冲刺/ })).toHaveTextContent("新词 50 · 复习 不限");
    expect(screen.queryByTestId("goals-preset-custom")).toBeNull();
  });

  it("saves both values when a plan is picked", async () => {
    const onChange = setup();
    await userEvent.click(screen.getByRole("radio", { name: /冲刺/ }));
    expect(onChange).toHaveBeenCalledWith({ dailyNew: 50, reviewUnlimited: true });
  });

  it("opens the stepper for a custom value and warns when reviews would pile up", () => {
    setup({ dailyNew: 35, reviewCap: 100 });
    expect(screen.getByTestId("goals-preset-custom")).toHaveTextContent("自定义");
    const daily = screen.getByRole("radiogroup", { name: "每日新词" });
    expect(within(daily).getByRole("radio", { name: "自定义" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("textbox", { name: "每日新词" })).toHaveValue("35");
    expect(screen.getByTestId("goals-estimate")).toHaveTextContent("按这个设置约 106 天学完 · 稳定后每天复习约 175 个");
    expect(screen.getByTestId("goals-estimate")).toHaveTextContent("学到最后约 219 个");
    expect(screen.getByTestId("goals-overcap")).toHaveTextContent("高于复习上限 100,复习会积压");
  });

  it("previews today and explains the backlog guard", () => {
    setup({ reviewCap: 100 }, { today: { newDone: 3, reviewDone: 0, reviewDue: 240, bonus: 0 } });
    expect(screen.getByTestId("goals-today")).toHaveTextContent("新词 3 / 20 · 还能学 2 个");
    expect(screen.getByTestId("goals-backlog")).toHaveTextContent("到期 240 个,超过复习上限 100:今天新词最多 5 个");
  });

  it("commits a custom review limit through the stepper", async () => {
    const onChange = setup();
    await userEvent.click(within(screen.getByRole("radiogroup", { name: "每日复习上限" })).getByRole("radio", { name: "自定义" }));
    const input = screen.getByRole("textbox", { name: "每日复习上限" });
    await userEvent.clear(input);
    await userEvent.type(input, "350{Enter}");
    expect(onChange).toHaveBeenLastCalledWith({ reviewCap: 350 });
  });

  it("respects the admin's limits", () => {
    setup({ dailyNew: 20, reviewCap: 100 }, { limits: { ...LIMITS, dailyNew: { min: 1, max: 30 }, reviewUnlimited: false } });
    const review = screen.getByRole("radiogroup", { name: "每日复习上限" });
    expect(within(review).queryByRole("radio", { name: "不限" })).toBeNull();
    expect(within(screen.getByRole("radiogroup", { name: "每日新词" })).getAllByRole("radio").map((r) => r.textContent))
      .toEqual(["10", "20", "30", "自定义"]);
    const sprint = screen.getByRole("radio", { name: /冲刺/ });
    expect(sprint).toBeDisabled();
    expect(sprint).toHaveTextContent("管理员已限制");
  });

  it("applies patches to a draft value (books page)", () => {
    const v: GoalsValue = { dailyNew: 20, reviewCap: 100, orderMode: "shuffle" };
    expect(applyPatch(v, { reviewUnlimited: true })).toEqual({ ...v, reviewCap: null });
    expect(applyPatch({ ...v, reviewCap: null }, { reviewCap: 50, dailyNew: 10 })).toEqual({ dailyNew: 10, reviewCap: 50, orderMode: "shuffle" });
  });
});
```

- [ ] **Step 3: 跑测试确认失败** — Run: `cd web && yarn vitest run src/features/wordbook/goals-stepper.test.tsx src/features/wordbook/goals-fields.test.tsx` → FAIL

- [ ] **Step 4: 实现 `goals-stepper.tsx`**

```tsx
import { MinusIcon, PlusIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@renderer/lib/utils";
import { clamp, parseCount } from "./goals-math";

export const STEP_DEBOUNCE_MS = 600;

const KEY = cn(
  "inline-flex h-tap w-tap flex-none items-center justify-center rounded-button border-[0.5px] border-hair bg-surface text-ink",
  "transition-colors duration-fast active:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  "disabled:opacity-40 [&_svg]:h-5 [&_svg]:w-5",
);

/**
 * 步进器(spec 2026-10-11 §2.2、§12.3):− / 数字输入 / +。点按 600 ms 后提交一次;失焦或回车立即提交;
 * 越界夹到范围;非数字恢复为已保存的值。输入框 inputmode=numeric,接受全角数字。
 */
export function GoalsStepper({ label, value, min, max, step = 1, onCommit, testId }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onCommit: (value: number) => void;
  testId?: string;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [draft, setDraft] = useState(String(value));
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => setDraft(String(value)), [value]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const commit = (n: number) => {
    clearTimeout(timer.current);
    const next = clamp(n, min, max);
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };
  const nudge = (delta: number) => {
    const next = clamp((parseCount(draft) ?? value) + delta, min, max);
    setDraft(String(next));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => commit(next), STEP_DEBOUNCE_MS);
  };
  const current = parseCount(draft) ?? value;

  return (
    <div role="group" aria-labelledby={`${id}-label`} data-testid={testId} className="flex items-center gap-2">
      <span id={`${id}-label`} className="sr-only">{label}</span>
      <button type="button" className={KEY} disabled={current <= min} aria-label={t("web.wordbook.goals.stepper.less", { label })}
        onClick={() => nudge(-step)}>
        <MinusIcon aria-hidden />
      </button>
      <input type="text" inputMode="numeric" pattern="[0-9]*" enterKeyHint="done" autoComplete="off" maxLength={4}
        aria-label={label} aria-describedby={`${id}-range`} value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { const n = parseCount(draft); if (n === null) setDraft(String(value)); else commit(n); }}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        className="num h-tap w-[76px] rounded-button border-[0.5px] border-hair bg-surface-2 text-center text-title font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      <button type="button" className={KEY} disabled={current >= max} aria-label={t("web.wordbook.goals.stepper.more", { label })}
        onClick={() => nudge(step)}>
        <PlusIcon aria-hidden />
      </button>
      <span id={`${id}-range`} className="num ml-1 text-meta text-ink-2">{t("web.wordbook.goals.stepper.range", { min, max })}</span>
    </div>
  );
}
```

- [ ] **Step 5: 实现 `goals-fields.tsx`**

```tsx
import { CircleAlertIcon } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@renderer/lib/utils";
import { SegmentedControl } from "~/components/segmented-control";
import { ToneBadge } from "~/components/tone-badge";
import { PRESETS, clamp, estimate, matchPreset, previewPlan, type GoalPreset } from "./goals-math";
import { GoalsStepper } from "./goals-stepper";
import { fmt } from "./ui";
import type { GoalLimits, GoalsPatch, OrderMode } from "./wordbook-api";

export interface GoalsValue { dailyNew: number; reviewCap: number | null; orderMode: OrderMode }
export interface GoalsToday { newDone: number; reviewDone: number; reviewDue: number; bonus: number }

const NEW_OPTIONS = [10, 20, 30, 50];
const REVIEW_OPTIONS = [50, 100, 200];
const LABEL = "mb-1.5 text-sub font-semibold text-ink-2";
const NOTE = "mt-2 flex items-start gap-2 rounded-badge bg-amber-tint px-3 py-2.5 text-sub font-medium text-amber";

const inRange = (n: number, r: { min: number; max: number }) => n >= r.min && n <= r.max;
const presetAllowed = (p: GoalPreset, l: GoalLimits) =>
  inRange(p.dailyNew, l.dailyNew) && (p.reviewCap === null ? l.reviewUnlimited : inRange(p.reviewCap, l.reviewCap));

/** 选书页草稿:把一次改动套到当前值上 */
export const applyPatch = (v: GoalsValue, p: GoalsPatch): GoalsValue => ({
  dailyNew: p.dailyNew ?? v.dailyNew,
  reviewCap: p.reviewUnlimited ? null : p.reviewCap ?? v.reviewCap,
  orderMode: p.orderMode ?? v.orderMode,
});

/** 服务端 Enrollment(或 config.defaults)→ 表单值;reviewCap null = 不限 */
export const valueOf = (e: { dailyNew: number; reviewCap: number; reviewUnlimited?: boolean; orderMode?: OrderMode }): GoalsValue => ({
  dailyNew: e.dailyNew, reviewCap: e.reviewUnlimited ? null : e.reviewCap, orderMode: e.orderMode ?? "shuffle",
});

/**
 * 每日目标字段(spec 2026-10-11 §2.2):方案卡、每日新词、复习上限(含不限)、今天预览、估算、顺序。
 * 面板里每次 onChange 立即保存;选书页把它当草稿。管理员范围外的预设与选项不可选。
 */
export function GoalsFields({ value, limits, remaining, today, onChange }: {
  value: GoalsValue;
  limits: GoalLimits;
  remaining: number;
  today?: GoalsToday | null;
  onChange: (patch: GoalsPatch) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [customNew, setCustomNew] = useState(false);
  const [customReview, setCustomReview] = useState(false);
  const preset = matchPreset(value.dailyNew, value.reviewCap);
  const newOptions = NEW_OPTIONS.filter((n) => inRange(n, limits.dailyNew));
  const reviewOptions = REVIEW_OPTIONS.filter((n) => inRange(n, limits.reviewCap));
  const newChoice = customNew || !newOptions.includes(value.dailyNew) ? "custom" : String(value.dailyNew);
  const reviewChoice = customReview ? "custom"
    : value.reviewCap === null ? "unlimited"
    : reviewOptions.includes(value.reviewCap) ? String(value.reviewCap) : "custom";
  const est = estimate(value.dailyNew, value.reviewCap, remaining);
  const plan = today
    ? previewPlan({ dailyNew: value.dailyNew, reviewCap: value.reviewCap, ...today, guardThreshold: limits.reviewCap.max, remaining })
    : null;
  const capLabel = (cap: number | null) => (cap === null ? t("web.wordbook.goals.unlimited") : String(cap));

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between">
          <p id={`${id}-presets`} className={LABEL}>{t("web.wordbook.goals.presets.label")}</p>
          {preset ? null : <span data-testid="goals-preset-custom"><ToneBadge tone="gray">{t("web.wordbook.goals.presets.custom")}</ToneBadge></span>}
        </div>
        <div role="radiogroup" aria-labelledby={`${id}-presets`} className="space-y-2">
          {PRESETS.map((p) => {
            const e = estimate(p.dailyNew, p.reviewCap, remaining);
            const allowed = presetAllowed(p, limits);
            const on = preset === p.id;
            return (
              <button key={p.id} type="button" role="radio" aria-checked={on} disabled={!allowed} data-testid={`goals-preset-${p.id}`}
                onClick={() => onChange(p.reviewCap === null ? { dailyNew: p.dailyNew, reviewUnlimited: true } : { dailyNew: p.dailyNew, reviewCap: p.reviewCap })}
                className={cn(
                  "flex min-h-[56px] w-full items-center gap-3 rounded-card border-[0.5px] border-hair bg-surface px-3.5 py-2 text-left transition-colors duration-fast",
                  "active:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                  on && "shadow-[inset_0_0_0_1.5px_rgb(var(--blue))]",
                )}>
                <span className="min-w-0 flex-1">
                  <b className="block text-body font-semibold">{t(`web.wordbook.goals.presets.${p.id}`)}</b>
                  <span className="num block text-meta text-ink-2">{t("web.wordbook.goals.presets.values", { n: p.dailyNew, cap: capLabel(p.reviewCap) })}</span>
                </span>
                {allowed ? (
                  <span className="flex-none text-right">
                    <span className="num block text-sub font-medium text-ink">{t("web.wordbook.goals.presets.days", { days: fmt(e.days), count: e.days })}</span>
                    <span className="num block text-meta text-ink-2">{t("web.wordbook.goals.presets.steady", { n: fmt(e.steady) })}</span>
                  </span>
                ) : (
                  <span className="flex-none text-meta text-ink-2">{t("web.wordbook.goals.presets.limited")}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p aria-hidden className={LABEL}>{t("web.wordbook.goals.dailyNew")}</p>
        <SegmentedControl label={t("web.wordbook.goals.dailyNew")} value={newChoice} className="flex w-full" optionClassName="flex-1 min-w-0"
          onChange={(v) => { if (v === "custom") setCustomNew(true); else { setCustomNew(false); onChange({ dailyNew: Number(v) }); } }}
          options={[...newOptions.map((n) => ({ value: String(n), label: String(n) })), { value: "custom", label: t("web.wordbook.goals.custom") }]} />
        {newChoice === "custom" ? (
          <div className="mt-2">
            <GoalsStepper label={t("web.wordbook.goals.dailyNew")} value={value.dailyNew} min={limits.dailyNew.min} max={limits.dailyNew.max}
              onCommit={(n) => onChange({ dailyNew: n })} testId="goals-new-stepper" />
          </div>
        ) : null}
      </div>

      <div>
        <p aria-hidden className={LABEL}>{t("web.wordbook.goals.reviewCap")}</p>
        <SegmentedControl label={t("web.wordbook.goals.reviewCap")} value={reviewChoice} className="flex w-full" optionClassName="flex-1 min-w-0"
          onChange={(v) => {
            if (v === "custom") { setCustomReview(true); return; }
            setCustomReview(false);
            onChange(v === "unlimited" ? { reviewUnlimited: true } : { reviewCap: Number(v) });
          }}
          options={[
            ...reviewOptions.map((n) => ({ value: String(n), label: String(n) })),
            ...(limits.reviewUnlimited ? [{ value: "unlimited", label: t("web.wordbook.goals.unlimited") }] : []),
            { value: "custom", label: t("web.wordbook.goals.custom") },
          ]} />
        {reviewChoice === "custom" ? (
          <div className="mt-2">
            <GoalsStepper label={t("web.wordbook.goals.reviewCap")} value={value.reviewCap ?? clamp(200, limits.reviewCap.min, limits.reviewCap.max)}
              min={limits.reviewCap.min} max={limits.reviewCap.max} step={10} onCommit={(n) => onChange({ reviewCap: n })} testId="goals-review-stepper" />
          </div>
        ) : null}
      </div>

      {plan ? (
        <div data-testid="goals-today" className="rounded-card bg-surface-2 px-3 py-2.5 text-sub">
          <p className="font-semibold text-ink-2">{t("web.wordbook.goals.today.label")}</p>
          <p className="num mt-1 text-ink">{t("web.wordbook.goals.today.new", { done: plan.newDone, target: plan.newTarget, left: plan.newLeft })}</p>
          <p className="num text-ink">
            {value.reviewCap === null
              ? t("web.wordbook.goals.today.reviewUnlimited", { done: plan.reviewDone, due: plan.reviewDue })
              : t("web.wordbook.goals.today.review", { done: plan.reviewDone, total: plan.reviewDone + plan.reviewLeft })}
          </p>
          {plan.backlogGuard ? (
            <p role="note" data-testid="goals-backlog" className={NOTE}>
              <CircleAlertIcon aria-hidden className="mt-px h-[17px] w-[17px] flex-none" />
              <span>{t("web.wordbook.goals.today.backlog", { due: plan.reviewDue, cap: value.reviewCap ?? limits.reviewCap.max })}</span>
            </p>
          ) : null}
        </div>
      ) : null}

      <div data-testid="goals-estimate">
        <p className="num text-sub text-ink">
          {est.days > 0
            ? t("web.wordbook.goals.estimate.line", { days: fmt(est.days), steady: fmt(est.steady), count: est.days })
            : t("web.wordbook.goals.estimate.done")}
        </p>
        {est.overCap ? (
          <p role="note" data-testid="goals-overcap" className={NOTE}>
            <CircleAlertIcon aria-hidden className="mt-px h-[17px] w-[17px] flex-none" />
            <span>{t("web.wordbook.goals.estimate.overCap", { cap: value.reviewCap })}</span>
          </p>
        ) : null}
        <p className="mt-1.5 text-meta leading-dialogue text-ink-2">{t("web.wordbook.goals.estimate.note", { finish: fmt(est.atFinish) })}</p>
      </div>

      <div>
        <p aria-hidden className={LABEL}>{t("web.wordbook.goals.order.label")}</p>
        <SegmentedControl<OrderMode> label={t("web.wordbook.goals.order.label")} value={value.orderMode} className="flex w-full" optionClassName="flex-1 min-w-0"
          onChange={(v) => onChange({ orderMode: v })}
          options={[{ value: "shuffle", label: t("web.wordbook.books.order.shuffle") }, { value: "book", label: t("web.wordbook.books.order.book") }]} />
        <p className="mt-1.5 text-meta text-ink-2">{t("web.wordbook.goals.order.note")}</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: 跑测试确认通过** — Run: `yarn web:typecheck && cd web && yarn vitest run src/features/wordbook/goals-stepper.test.tsx src/features/wordbook/goals-fields.test.tsx src/features/wordbook/i18n.test.ts` → PASS

- [ ] **Step 7: 提交**

```bash
git add web/src/features/wordbook/goals-stepper.tsx web/src/features/wordbook/goals-stepper.test.tsx web/src/features/wordbook/goals-fields.tsx web/src/features/wordbook/goals-fields.test.tsx web/src/features/wordbook/i18n/zh-CN.json web/src/features/wordbook/i18n/en.json
git commit -m "feat(web): wordbook goal fields with plans, custom stepper, estimates and today preview

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task GW4: 目标面板(加练、连续达标、换书/暂停/重置)与首页集成

**Files:**
- Create: `web/src/features/wordbook/goals-sheet.tsx`、`web/src/features/wordbook/goals-sheet.test.tsx`
- Modify: `web/src/features/wordbook/home-page.tsx`、`web/src/features/wordbook/home-page.test.tsx`

**Interfaces:**
- Consumes:GW2 `useGoals`、`limitsOf`;GW3 `GoalsFields`、`valueOf`;`~/components/bottom-sheet`;`@renderer/components/ui/alert-dialog`;`sonner` 的 `toast`
- Produces:`matchesBook(text: string, book: { id: string; titleZh: string; titleEn: string }): boolean`;`GoalsSheet({ open, onOpenChange, today, limits, goals, focus? })`;首页:顶栏齿轮(「每日目标设置」)、计划卡齿轮(「调整今天的目标」)、连续格 `data-testid="wordbook-streak"`、达标横幅、暂停卡 `data-testid="wordbook-paused"`

- [ ] **Step 1: 写失败测试** — `web/src/features/wordbook/goals-sheet.test.tsx`(以首页为载体,覆盖 hook 接线):

```tsx
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { matchesBook } from "./goals-sheet";
import { GOAL_MET_TODAY, GOALS_CONFIG, GOALS_ENROLLMENT, GOALS_PLAN, GOALS_TODAY } from "./goals-test-fixtures";
import { WordbookHomePage } from "./home-page";

function setup(initial: unknown = GOALS_TODAY, extra: Record<string, Handler> = {}) {
  let current = initial;
  const mock = createFetchMock({
    "GET /api/wordbook/config": () => json(GOALS_CONFIG),
    "GET /api/wordbook/today": () => json(current),
    "PATCH /api/wordbook/enrollment": () => json(GOALS_ENROLLMENT),
    ...extra,
  });
  renderWithProviders(<WordbookHomePage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/wordbook" });
  return { mock, serve: (next: unknown) => { current = next; } };
}

async function openSheet() {
  await userEvent.click(await screen.findByRole("button", { name: "每日目标设置" }));
  return screen.findByRole("dialog", { name: "每日目标" });
}

const body = (mock: ReturnType<typeof setup>["mock"], path: string) =>
  JSON.parse(String(mock.calls.find((c) => c.url.pathname === path)!.body));

beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); void i18n.changeLanguage("zh-CN"); });
afterEach(() => { localStorage.removeItem("enjoy-web.settings"); void i18n.changeLanguage("en"); });

describe("GoalsSheet", () => {
  it("opens from both gears and gives focus back on close", async () => {
    setup();
    const sheet = await openSheet();
    expect(within(sheet).getByText("四级 · 剩余 3,684 词 · 改动立即生效")).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: "每日目标设置" })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "调整今天的目标" }));
    expect(await screen.findByRole("dialog", { name: "每日目标" })).toBeTruthy();
  });

  it("applies a new goal at once, then trusts the server", async () => {
    const { mock, serve } = setup();
    const sheet = await openSheet();
    serve({ ...GOALS_TODAY, enrollment: { ...GOALS_ENROLLMENT, daily_new: 30 }, plan: { ...GOALS_PLAN, new_target: 30, new_left: 22 } });
    await userEvent.click(within(within(sheet).getByRole("radiogroup", { name: "每日新词" })).getByRole("radio", { name: "30" }));
    expect(within(sheet).getByTestId("goals-today")).toHaveTextContent("新词 8 / 30 · 还能学 22 个");
    await waitFor(() => expect(mock.calls.filter((c) => c.url.pathname === "/api/wordbook/today")).toHaveLength(2));
    expect(body(mock, "/api/wordbook/enrollment")).toEqual({ daily_new: 30 });
    expect(screen.getByTestId("wordbook-action-learn")).toHaveTextContent("22");
    expect(within(sheet).getByText("已保存")).toBeTruthy();
  });

  it("rolls back a refused change and says why", async () => {
    setup(GOALS_TODAY, { "PATCH /api/wordbook/enrollment": () => json({ error: "Daily new words out of range" }, 422) });
    const sheet = await openSheet();
    const daily = within(sheet).getByRole("radiogroup", { name: "每日新词" });
    await userEvent.click(within(daily).getByRole("radio", { name: "50" }));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("每日新词超出允许范围");
    expect(within(daily).getByRole("radio", { name: "20" })).toHaveAttribute("aria-checked", "true");
  });

  it("explains why extra words are not available yet and shows the streak", async () => {
    setup();
    const sheet = await openSheet();
    expect(within(sheet).getByRole("button", { name: "加练 10 个" })).toBeDisabled();
    expect(within(sheet).getByText("先学完今天剩下的 12 个新词")).toBeTruthy();
    expect(within(sheet).getByTestId("goals-streak")).toHaveTextContent("连续达标 12 天 · 今天还差 12 个新词");
  });

  it("grants extra words from the goal banner and starts learning", async () => {
    const { mock } = setup(GOAL_MET_TODAY, {
      "POST /api/wordbook/bonus": () => json({ plan: { ...GOALS_PLAN, new_target: 30, new_done: 20, new_left: 10, bonus: 10, goal_met: true }, bonus_left: 40 }),
    });
    await userEvent.click(await screen.findByRole("button", { name: "今天加练" }));
    const sheet = await screen.findByRole("dialog", { name: "每日目标" });
    expect(within(sheet).getByTestId("goals-streak")).toHaveTextContent("今天已达标");
    await userEvent.click(within(sheet).getByRole("button", { name: "加练 10 个" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/wordbook/learn"));
    expect(body(mock, "/api/wordbook/bonus")).toMatchObject({ size: 10 });
  });

  it("pauses after confirmation", async () => {
    const { mock } = setup(GOALS_TODAY, { "POST /api/wordbook/enrollment/pause": () => json({ ...GOALS_ENROLLMENT, status: "paused" }) });
    const sheet = await openSheet();
    await userEvent.click(within(sheet).getByRole("button", { name: "暂停这本书" }));
    const alert = await screen.findByRole("alertdialog", { name: "暂停四级?" });
    await userEvent.click(within(alert).getByRole("button", { name: "暂停" }));
    await waitFor(() => expect(mock.calls.some((c) => c.url.pathname === "/api/wordbook/enrollment/pause")).toBe(true));
  });

  it("resets only after the book name is typed", async () => {
    const { mock } = setup(GOALS_TODAY, { "POST /api/wordbook/enrollment/reset": () => json({ removed: 860, enrollment: GOALS_ENROLLMENT }) });
    const sheet = await openSheet();
    await userEvent.click(within(sheet).getByRole("button", { name: "重置进度" }));
    const alert = await screen.findByRole("alertdialog", { name: "重置四级的进度?" });
    expect(alert).toHaveTextContent("本书已学 860 词");
    const confirm = within(alert).getByRole("button", { name: "重置进度" });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(alert).getByRole("textbox", { name: "输入「四级」确认" }), "四级");
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() => expect(mock.calls.some((c) => c.url.pathname === "/api/wordbook/enrollment/reset")).toBe(true));
    expect(body(mock, "/api/wordbook/enrollment/reset")).toMatchObject({ book_id: "cet4", confirm: "四级" });
  });

  it("matches the book by Chinese name, English name or id", () => {
    const book = { id: "cet4", titleZh: "四级", titleEn: "CET-4" };
    expect(["四级", " cet-4 ", "CET4"].map((s) => matchesBook(s, book))).toEqual([true, true, true]);
    expect(["六级", "", "cet"].map((s) => matchesBook(s, book))).toEqual([false, false, false]);
  });
});
```

`home-page.test.tsx` 的修改:
  - 导入改为 `import { GOALS_CONFIG, GOALS_PLAN, GOALS_TODAY, PAUSED_TODAY, GOALS_ENROLLMENT } from "./goals-test-fixtures";` 与 `import { NO_BOOK_TODAY } from "./test-fixtures";`;文件内 `CONFIG` → `GOALS_CONFIG`、`ENROLLED_TODAY` → `GOALS_TODAY`、`PLAN` → `GOALS_PLAN`。
  - `expect(screen.getByRole("link", { name: "词书与每日设置" })).toHaveAttribute("href", "/wordbook/books");` 替换为 `expect(screen.getByRole("button", { name: "每日目标设置" })).toBeTruthy();`。
  - `"sends readers without a book to the book picker"` 不变(`NO_BOOK_TODAY` 没有 `paused` 键,`undefined` 视同无暂停书)。
  - `describe` 末尾追加:

```tsx
  it("shows the goal streak in the plan card", async () => {
    setup(GOALS_TODAY);
    expect(await screen.findByTestId("wordbook-streak")).toHaveTextContent("连续12 天");
  });

  it("shows a dash before the first goal day", async () => {
    setup({ ...GOALS_TODAY, streak: { current: 0, today_met: false } });
    expect(await screen.findByTestId("wordbook-streak")).toHaveTextContent("连续—");
  });

  it("shows the paused book instead of the picker and resumes it", async () => {
    const mock = setup(PAUSED_TODAY, { "POST /api/wordbook/enrollment/resume": () => json(GOALS_ENROLLMENT) });
    expect(await screen.findByTestId("wordbook-paused")).toHaveTextContent("四级已暂停");
    expect(screen.queryByRole("button", { name: "每日目标设置" })).toBeNull();
    expect(screen.getByRole("link", { name: "换一本" })).toHaveAttribute("href", "/wordbook/books");
    await userEvent.click(screen.getByRole("button", { name: "继续学习" }));
    await waitFor(() => expect(mock.calls.some((c) => c.url.pathname === "/api/wordbook/enrollment/resume")).toBe(true));
    const call = mock.calls.find((c) => c.url.pathname === "/api/wordbook/enrollment/resume")!;
    expect(JSON.parse(String(call.body))).toEqual({ book_id: "cet4" });
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/wordbook$/);
  });
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd web && yarn vitest run src/features/wordbook/goals-sheet.test.tsx src/features/wordbook/home-page.test.tsx` → FAIL

- [ ] **Step 3: 实现 `goals-sheet.tsx`**

```tsx
import { ChevronRightIcon, FlameIcon, PauseIcon, RotateCcwIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@renderer/components/ui/alert-dialog";
import { cn } from "@renderer/lib/utils";
import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "~/components/bottom-sheet";
import { SegmentedControl } from "~/components/segmented-control";
import { GoalsFields, valueOf } from "./goals-fields";
import { GHOST, bookTitle, fmt } from "./ui";
import type { GoalsApi } from "./use-goals";
import type { GoalLimits, Today } from "./wordbook-api";

const BONUS_SIZES = ["5", "10", "20"] as const;
type BonusSize = (typeof BONUS_SIZES)[number];
const ROW = cn(
  "flex min-h-[56px] w-full items-center gap-3 px-3.5 text-left text-body transition-colors duration-fast active:bg-surface-2",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&>svg]:h-5 [&>svg]:w-5 [&>svg]:flex-none",
);
const SECTION = "mt-5 text-sub font-semibold text-ink-2";

/** 重置确认:中文名、英文名或 id,去首尾空白,不区分大小写(与服务端 confirm_matches 一致)。 */
export const matchesBook = (text: string, book: { id: string; titleZh: string; titleEn: string }) => {
  const typed = text.trim().toLocaleLowerCase();
  return typed.length > 0 && [book.id, book.titleZh, book.titleEn].some((v) => v.toLocaleLowerCase() === typed);
};

/**
 * 每日目标面板(spec 2026-10-11 §2.2):字段即改即存(乐观更新)、今天加练、连续达标、换书/暂停/重置。
 * BottomSheet / AlertDialog 是 Radix:焦点困在内部,Esc 关闭,关闭后焦点回到打开它的按钮。
 */
export function GoalsSheet({ open, onOpenChange, today, limits, goals, focus }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  today: Today;
  limits: GoalLimits;
  goals: GoalsApi;
  focus?: "bonus";
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [size, setSize] = useState<BonusSize>("10");
  const [confirm, setConfirm] = useState<null | "pause" | "reset">(null);
  const [typed, setTyped] = useState("");
  const [saved, setSaved] = useState(0);
  const bonusRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || focus !== "bonus") return;
    const frame = requestAnimationFrame(() => bonusRef.current?.scrollIntoView({ block: "center" }));
    return () => cancelAnimationFrame(frame);
  }, [open, focus]);

  const { enrollment, plan, book, progress, streak } = today;
  if (!enrollment || !plan || !book || !progress) return null;
  const title = bookTitle(book, i18n.language);
  const bonusLeft = Math.max(0, limits.bonusMax - plan.bonus);
  const reason = limits.bonusMax <= 0 ? t("web.wordbook.goals.bonus.off")
    : plan.backlogGuard ? t("web.wordbook.goals.bonus.backlog")
    : plan.newLeft > 0 ? t("web.wordbook.goals.bonus.needGoal", { n: plan.newLeft })
    : progress.remaining <= 0 ? t("web.wordbook.goals.bonus.finished")
    : bonusLeft <= 0 ? t("web.wordbook.goals.bonus.limit", { max: limits.bonusMax })
    : null;
  const metToday = streak.todayMet || plan.goalMet;
  const streakText = streak.current > 0
    ? t("web.wordbook.goals.streak.days", { n: streak.current, count: streak.current })
    : t("web.wordbook.goals.streak.none");
  const todayText = metToday ? t("web.wordbook.goals.streak.todayMet")
    : plan.newLeft > 0 ? t("web.wordbook.goals.streak.todayNew", { n: plan.newLeft })
    : t("web.wordbook.goals.streak.todayReviews", { n: plan.reviewLeft });

  const startBonus = async () => {
    if (await goals.bonus(Math.min(Number(size), bonusLeft))) {
      onOpenChange(false);
      navigate("/wordbook/learn");
    }
  };

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange}>
      <BottomSheetContent className="max-h-[88vh] overflow-y-auto">
        <BottomSheetHeader title={t("web.wordbook.goals.title")}
          description={t("web.wordbook.goals.subtitle", { book: title, n: fmt(progress.remaining) })} />
        {goals.error ? <p role="alert" className="mb-3 rounded-badge bg-surface-2 px-3 py-2.5 text-sub text-ink">{goals.error}</p> : null}
        <span key={saved} aria-live="polite" className="sr-only">{saved > 0 ? t("web.wordbook.goals.saved") : ""}</span>

        <GoalsFields value={valueOf(enrollment)} limits={limits} remaining={progress.remaining}
          today={{ newDone: plan.newDone, reviewDone: plan.reviewDone, reviewDue: plan.reviewDue, bonus: plan.bonus }}
          onChange={(p) => void goals.patch(p).then((ok) => { if (ok) setSaved((n) => n + 1); })} />

        <div ref={bonusRef}>
          <p className={SECTION}>{t("web.wordbook.goals.bonus.label")}</p>
          <div className="mt-1.5 flex items-center gap-2">
            <SegmentedControl<BonusSize> label={t("web.wordbook.goals.bonus.sizes")} value={size} onChange={setSize} disabled={reason !== null}
              options={BONUS_SIZES.map((n) => ({ value: n, label: n }))} />
            <button type="button" className={cn(GHOST, "h-11 flex-1")} disabled={reason !== null || goals.busy === "bonus"}
              onClick={() => void startBonus()}>
              {t("web.wordbook.goals.bonus.action", { n: Math.min(Number(size), Math.max(bonusLeft, 1)) })}
            </button>
          </div>
          <p className="mt-1.5 text-meta text-ink-2">{reason ?? t("web.wordbook.goals.bonus.left", { n: bonusLeft })}</p>
        </div>

        <p className={SECTION}>{t("web.wordbook.goals.streak.label")}</p>
        <p data-testid="goals-streak" className="mt-1.5 flex items-center gap-1.5 text-body text-ink">
          <FlameIcon aria-hidden className="h-[18px] w-[18px] flex-none text-amber" />
          <span className="num">{streakText} · {todayText}</span>
        </p>
        <p className="mt-1 text-meta leading-dialogue text-ink-2">{t("web.wordbook.goals.streak.help")}</p>

        <div className="mt-5 divide-y-[0.5px] divide-hair-2 overflow-hidden rounded-card border-[0.5px] border-hair bg-surface">
          <Link to="/wordbook/books" className={ROW} onClick={() => onOpenChange(false)}>
            <span className="flex-1">{t("web.wordbook.goals.rows.switch")}</span>
            <ChevronRightIcon aria-hidden className="text-ink-3" />
          </Link>
          <button type="button" className={ROW} onClick={() => setConfirm("pause")}>
            <PauseIcon aria-hidden className="text-ink-2" />
            <span className="flex-1">{t("web.wordbook.goals.rows.pause")}</span>
          </button>
          <button type="button" className={cn(ROW, "text-red")} onClick={() => { setTyped(""); setConfirm("reset"); }}>
            <RotateCcwIcon aria-hidden />
            <span className="flex-1">{t("web.wordbook.goals.rows.reset")}</span>
          </button>
        </div>

        <AlertDialog open={confirm === "pause"} onOpenChange={(v) => { if (!v) setConfirm(null); }}>
          <AlertDialogContent className="rounded-sheet border-[0.5px] border-hair bg-surface">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-title font-semibold text-ink">{t("web.wordbook.goals.pause.title", { book: title })}</AlertDialogTitle>
              <AlertDialogDescription className="text-sub leading-dialogue text-ink-2">{t("web.wordbook.goals.pause.body")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="h-11 rounded-button">{t("web.common.cancel")}</AlertDialogCancel>
              <AlertDialogAction className="h-11 rounded-button bg-blue text-on-blue hover:bg-blue/90"
                onClick={() => void goals.pause().then((r) => { if (r) onOpenChange(false); })}>
                {t("web.wordbook.goals.pause.confirm")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={confirm === "reset"} onOpenChange={(v) => { if (!v) setConfirm(null); }}>
          <AlertDialogContent className="rounded-sheet border-[0.5px] border-hair bg-surface">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-title font-semibold text-ink">{t("web.wordbook.goals.reset.title", { book: title })}</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-1.5 text-left text-sub leading-dialogue text-ink-2">
                  <p>{t("web.wordbook.goals.reset.clears")}</p>
                  <p>{t("web.wordbook.goals.reset.keeps")}</p>
                  <p className="num text-ink">{t("web.wordbook.goals.reset.learned", { n: fmt(progress.learned), count: progress.learned })}</p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <label className="block text-sub font-semibold text-ink">
              {t("web.wordbook.goals.reset.input", { book: title })}
              <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false}
                className="mt-1.5 h-tap w-full rounded-button border-[0.5px] border-hair bg-surface-2 px-3 text-body font-normal text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </label>
            <AlertDialogFooter>
              <AlertDialogCancel className="h-11 rounded-button">{t("web.common.cancel")}</AlertDialogCancel>
              <AlertDialogAction disabled={!matchesBook(typed, book) || goals.busy === "reset"}
                className="h-11 rounded-button bg-red-solid text-white hover:bg-red-solid/90 disabled:opacity-40"
                onClick={() => void goals.reset(book.id, typed.trim()).then((r) => {
                  if (!r) return;
                  toast.success(t("web.wordbook.goals.reset.done", { book: title }));
                  onOpenChange(false);
                })}>
                {t("web.wordbook.goals.reset.confirm")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </BottomSheetContent>
    </BottomSheet>
  );
}
```

- [ ] **Step 4: 实现 `home-page.tsx`**(`BookCard` 不变;以下为其余部分的完整替换)

```tsx
import {
  CircleAlertIcon, FlameIcon, GalleryVerticalEndIcon, KeyboardIcon, LibraryBigIcon, PauseIcon, RefreshCwIcon, Settings2Icon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
// …其余导入同 v1,另加:
import { GoalsSheet } from "./goals-sheet";
import { useGoals } from "./use-goals";
import { GHOST, ICON_LINK, PRIMARY, bookTitle, fmt } from "./ui";
import {
  WORDBOOK_SERVER_ERRORS, limitsOf, type DayPlan, type Enrollment, type Progress, type Streak, type WordbookBook,
} from "./wordbook-api";

/** 今日计划:新词环、复习、明日预测、连续达标;右上角齿轮打开目标面板(spec 2026-10-11 §2.1)。 */
function PlanCard({ plan, tomorrowDue, streak, onSettings }: { plan: DayPlan; tomorrowDue: number; streak: Streak; onSettings: () => void }) {
  const { t } = useTranslation();
  const cell = (label: string, value: ReactNode, testId?: string) => (
    <div data-testid={testId} className="text-meta text-ink-2">
      {label}
      <b className="num block text-title font-semibold text-ink">{value}</b>
    </div>
  );
  const streakValue = streak.current > 0 ? (
    <span className="inline-flex items-center gap-1">
      <FlameIcon aria-hidden className="h-4 w-4 text-amber" />
      {t("web.wordbook.goals.streak.cellDays", { n: streak.current, count: streak.current })}
    </span>
  ) : t("web.wordbook.goals.streak.cellNone");
  return (
    <SurfaceCard className="relative flex items-center gap-3.5 p-3.5 pr-12">
      <PlanRing done={plan.newDone} target={plan.newTarget} />
      <div className="grid flex-1 grid-cols-2 gap-2.5">
        {cell(t("web.wordbook.home.newWords"), `${plan.newDone} / ${plan.newTarget}`)}
        {cell(t("web.wordbook.home.reviews"), `${plan.reviewDone} / ${plan.reviewDone + plan.reviewLeft}`)}
        {cell(t("web.wordbook.home.tomorrow"), tomorrowDue, "wordbook-tomorrow")}
        {cell(t("web.wordbook.goals.streak.cell"), streakValue, "wordbook-streak")}
      </div>
      <button type="button" onClick={onSettings} aria-label={t("web.wordbook.goals.openFromRing")}
        className={cn(ICON_LINK, "absolute right-1 top-1 text-ink-2")}>
        <Settings2Icon aria-hidden />
      </button>
    </SurfaceCard>
  );
}

/** 背单词首页(spec §11.2 + goals §2、§7)。没选书 → 选书页;暂停 → 暂停卡;书被停用 → 提示换一本。 */
export function WordbookHomePage() {
  const { t, i18n } = useTranslation();
  const config = useWordbookConfig();
  const { today, error, reload, setToday } = useWordbookToday(config?.enabled !== false);
  const limits = limitsOf(config);
  const goals = useGoals({ today, setToday, reload, limits });
  const [sheet, setSheet] = useState<null | "all" | "bonus">(null);
  const editable = Boolean(today?.enrollment && today.plan && today.book && today.progress);
  const header = (
    <PageHeader title={t("web.wordbook.title")} back="/practice"
      actions={editable ? (
        <button type="button" aria-label={t("web.wordbook.goals.open")} className={ICON_LINK} onClick={() => setSheet("all")}>
          <Settings2Icon aria-hidden />
        </button>
      ) : undefined} />
  );
  let body: ReactNode;
  if (config?.enabled === false) body = <PageNote>{t("web.wordbook.errors.disabled")}</PageNote>;
  else if (error) body = <PageError message={translateServerError(t, error, WORDBOOK_SERVER_ERRORS)} onRetry={reload} />;
  else if (!today) body = <PageLoading />;
  else if (!today.enrollment) {
    const paused = today.paused;
    if (!paused) return <Navigate to="/wordbook/books" replace />;
    const pausedBook = config?.enabled ? config.books.find((b) => b.id === paused.bookId) : undefined;
    body = (
      <div data-testid="wordbook-paused" className="mt-2">
        <SurfaceCard className="p-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <ToneBadge tone="teal"><LibraryBigIcon aria-hidden />{pausedBook ? bookTitle(pausedBook, i18n.language) : paused.bookId}</ToneBadge>
            <ToneBadge tone="gray"><PauseIcon aria-hidden />{t("web.wordbook.goals.paused.badge")}</ToneBadge>
          </div>
          <p className="mt-2.5 text-sub leading-dialogue text-ink-2">{t("web.wordbook.goals.paused.note")}</p>
          {goals.error ? <p role="alert" className="mt-2 text-sub text-ink">{goals.error}</p> : null}
          <div className="mt-3 flex gap-2">
            <Link to="/wordbook/books" className={cn(GHOST, "h-11 flex-1")}>{t("web.wordbook.goals.paused.switch")}</Link>
            <button type="button" className={cn(PRIMARY, "h-11 flex-1")} disabled={goals.busy === "resume"}
              onClick={() => void goals.resume(paused.bookId)}>
              {t("web.wordbook.goals.paused.resume")}
            </button>
          </div>
        </SurfaceCard>
      </div>
    );
  } else if (!today.book || !today.plan || !today.progress) {
    body = (
      <SurfaceCard className="mt-2 p-3.5 text-center">
        <p className="text-body">{t("web.wordbook.card.bookDisabled")}</p>
        <Link to="/wordbook/books" className={cn(PRIMARY, "mt-3 h-11 w-full")}>{t("web.wordbook.home.switchBook")}</Link>
      </SurfaceCard>
    );
  } else {
    const { plan, progress, book, enrollment, streak } = today;
    const done = <span className="text-meta text-ink-2">{t("web.wordbook.home.finished")}</span>;
    body = (
      <>
        <div className="mt-2"><BookCard book={book} progress={progress} enrollment={enrollment} /></div>
        <SectionGroup title={t("web.wordbook.home.today")} bare>
          <PlanCard plan={plan} tomorrowDue={today.tomorrowDue} streak={streak} onSettings={() => setSheet("all")} />
          {plan.goalMet && plan.newLeft === 0 && limits.bonusMax > 0 ? (
            <SurfaceCard className="mt-2 flex items-center gap-3 p-3.5">
              <FlameIcon aria-hidden className="h-6 w-6 flex-none text-amber" />
              <div className="min-w-0 flex-1">
                <b className="block text-body font-semibold">{t("web.wordbook.goals.goalMet.title")}</b>
                <span className="text-meta text-ink-2">{t("web.wordbook.goals.goalMet.body")}</span>
              </div>
              <button type="button" className={cn(GHOST, "h-11")} onClick={() => setSheet("bonus")}>{t("web.wordbook.goals.goalMet.action")}</button>
            </SurfaceCard>
          ) : null}
          {/* 三个动作行与积压提示条:与 v1 完全相同(ListRow ×3 + plan.backlogGuard 的 role="note") */}
        </SectionGroup>
      </>
    );
  }
  return (
    <div>
      {header}
      <div className="px-gutter pb-6">{body}</div>
      {editable && today ? (
        <GoalsSheet open={sheet !== null} onOpenChange={(o) => { if (!o) setSheet(null); }} today={today} limits={limits} goals={goals}
          focus={sheet === "bonus" ? "bonus" : undefined} />
      ) : null}
    </div>
  );
}
```

实现时把 v1 的「三个动作行 + 积压提示条」原样保留在注释所在的位置(只是位置说明,不是待写代码);删除 `SlidersHorizontalIcon` 导入与 `PlanCard` 的 `enrollment` 参数(第四格从「每日复习上限」改为「连续」,上限在面板里)。

- [ ] **Step 5: 跑测试确认通过** — Run: `yarn web:typecheck && cd web && yarn vitest run src/features/wordbook` → PASS

- [ ] **Step 6: 提交**

```bash
git add web/src/features/wordbook/goals-sheet.tsx web/src/features/wordbook/goals-sheet.test.tsx web/src/features/wordbook/home-page.tsx web/src/features/wordbook/home-page.test.tsx
git commit -m "feat(web): daily goal sheet on the wordbook home with extra words, streak, pause and reset

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task GW5: 选书页复用设置字段

**Files:**
- Modify: `web/src/features/wordbook/books-page.tsx`、`web/src/features/wordbook/books-page.test.tsx`

**Interfaces:**
- Consumes:GW3 `GoalsFields`、`applyPatch`、`valueOf`;GW2 `limitsOf`、`saveEnrollment`(+`reviewUnlimited`)
- Produces:选书抽屉 = 方案卡 + 新词/复习上限(含自定义与不限)+ 估算 + 顺序;PUT 体在「不限」时为 `{book_id, daily_new, review_unlimited: true, order_mode}`

- [ ] **Step 1: 改测试(先失败)** — `books-page.test.tsx` 的 `"picks a book with daily settings and goes home"` 中第 45–49 行替换为:

```tsx
    const daily = within(sheet).getByRole("radiogroup", { name: "每日新词" });
    expect(within(daily).getAllByRole("radio").map((r) => r.textContent)).toEqual(["10", "20", "30", "50", "自定义"]);
    expect(within(daily).getByRole("radio", { name: "20" })).toHaveAttribute("aria-checked", "true");
    expect(within(within(sheet).getByRole("radiogroup", { name: "每日复习上限" })).getAllByRole("radio").map((r) => r.textContent))
      .toEqual(["50", "100", "200", "不限", "自定义"]);
    expect(within(within(sheet).getByRole("radiogroup", { name: "顺序" })).getByRole("radio", { name: "乱序" })).toHaveAttribute("aria-checked", "true");
```

`describe` 末尾追加:

```tsx
  it("offers plans with estimates and sends unlimited reviews", async () => {
    const mock = setup({}, NO_BOOK_TODAY);
    await userEvent.click(await screen.findByRole("button", { name: /六级/ }));
    const sheet = await screen.findByRole("dialog");
    const sprint = within(sheet).getByRole("radio", { name: /冲刺/ });
    expect(sprint).toHaveTextContent("约 80 天学完"); // 3,991 词 / 50
    await userEvent.click(sprint);
    await userEvent.click(within(sheet).getByRole("button", { name: "开始" }));
    await waitFor(() => expect(mock.calls.some((c) => c.method === "PUT")).toBe(true));
    expect(JSON.parse(String(mock.calls.find((c) => c.method === "PUT")!.body)))
      .toEqual({ book_id: "cet6", daily_new: 50, review_unlimited: true, order_mode: "shuffle" });
  });

  it("keeps a custom value instead of snapping to the nearest option", async () => {
    const mock = setup({}, { ...ENROLLED_TODAY, enrollment: { ...ENROLLMENT, daily_new: 35, review_cap: 150 } });
    await userEvent.click(await screen.findByRole("button", { name: /六级/ }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByRole("textbox", { name: "每日新词" })).toHaveValue("35");
    expect(within(sheet).getByRole("textbox", { name: "每日复习上限" })).toHaveValue("150");
    await userEvent.click(within(sheet).getByRole("button", { name: "开始" }));
    await waitFor(() => expect(mock.calls.some((c) => c.method === "PUT")).toBe(true));
    expect(JSON.parse(String(mock.calls.find((c) => c.method === "PUT")!.body)))
      .toEqual({ book_id: "cet6", daily_new: 35, review_cap: 150, order_mode: "shuffle" });
  });
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd web && yarn vitest run src/features/wordbook/books-page.test.tsx` → FAIL

- [ ] **Step 3: 实现** — `books-page.tsx`:
  - 删除 `DAILY_NEW`、`REVIEW_CAP`、`nearest`、`interface Settings` 与 `SegmentedControl` 导入;导入 `import { GoalsFields, applyPatch, valueOf, type GoalsValue } from "./goals-fields";`,`wordbook-api` 导入加 `limitsOf`。
  - 状态:`const [settings, setSettings] = useState<GoalsValue>({ dailyNew: 20, reviewCap: 100, orderMode: "shuffle" });`
  - `open(book)` 中设置改为:`setSettings(valueOf(enrollment ?? (config?.enabled ? config.defaults : { dailyNew: 20, reviewCap: 100 })));`
  - `start()` 中保存改为:

```tsx
      await saveEnrollment(api, {
        bookId: picked.id, dailyNew: settings.dailyNew, orderMode: settings.orderMode,
        ...(settings.reviewCap === null ? { reviewUnlimited: true as const } : { reviewCap: settings.reviewCap }),
      });
```

  - 抽屉:`<BottomSheetContent>` 改为 `<BottomSheetContent className="max-h-[88vh] overflow-y-auto">`;`<div className="space-y-3.5">…</div>`(两个分段与顺序)整段替换为

```tsx
            <GoalsFields value={settings} limits={limitsOf(config)} remaining={Math.max(0, picked.words - picked.learned)}
              onChange={(p) => setSettings((s) => applyPatch(s, p))} />
```

  其余(标题、`keepProgress` 说明、错误、取消/开始按钮)不变。

- [ ] **Step 4: 跑测试确认通过** — Run: `yarn web:typecheck && cd web && yarn vitest run src/features/wordbook` → PASS

- [ ] **Step 5: 提交**

```bash
git add web/src/features/wordbook/books-page.tsx web/src/features/wordbook/books-page.test.tsx
git commit -m "feat(web): book picker uses the shared goal fields (plans, custom values, no limit)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task GW6: 文案复数、E2E、文档与视觉对照

**Files:**
- Modify: `web/src/features/wordbook/i18n.test.ts`、`web/src/features/wordbook/CLAUDE.md`、`web/README.md`
- Create: `web/e2e/wordbook-goals.spec.ts`

**Interfaces:**
- Consumes:GW1–GW5;E2E 栈(`docker-compose.e2e.yml`,`WORDBOOK_ENABLED=true`)

- [ ] **Step 1: 复数测试** — `i18n.test.ts` 的 `"says 1 word, 2 words"` 用例末尾追加:

```ts
    expect(t("web.wordbook.goals.presets.days", { days: 1, count: 1 })).toBe("about 1 day to finish");
    expect(t("web.wordbook.goals.presets.days", { days: 185, count: 185 })).toBe("about 185 days to finish");
    expect(t("web.wordbook.goals.streak.cellDays", { n: 1, count: 1 })).toBe("1 day");
    expect(t("web.wordbook.goals.reset.learned", { n: 2, count: 2 })).toBe("2 words learned in this book");
```

`"keeps the Chinese copy unchanged"` 末尾追加 `expect(i18n.t("web.wordbook.goals.presets.days", { days: 1, count: 1 })).toBe("约 1 天学完");`。

- [ ] **Step 2: E2E 规格** — `web/e2e/wordbook-goals.spec.ts`(零上游;学新词步骤复用合并后 `web/e2e/wordbook.spec.ts` 的学新词写法——A 计划可能改了学新词页,以合并后的版本为准):

```ts
import { expect, test } from "@playwright/test";
import { signIn } from "./support/auth";
import { mockUpstreams } from "./support/mock-upstreams";

// 每日目标面板(计划 2026-10-11 GW6):E2E 栈 WORDBOOK_ENABLED=true;零上游。
test.use({ locale: "zh-CN" });

test("wordbook goals: change the goal in place, extra words, pause, resume, reset", async ({ page, request }) => {
  await mockUpstreams(page);
  await signIn(page, request);
  await page.goto("/wordbook/books");
  await page.getByTestId("wordbook-book-junior").click();
  await page.getByRole("button", { name: "开始" }).click();
  await expect(page).toHaveURL(/\/wordbook$/);

  // 齿轮 → 每日新词 30:不离开首页,学新词计数立刻变成 30
  await page.getByRole("button", { name: "每日目标设置" }).click();
  const sheet = page.getByRole("dialog", { name: "每日目标" });
  await sheet.getByRole("radiogroup", { name: "每日新词" }).getByRole("radio", { name: "30" }).click();
  await expect(sheet.getByTestId("goals-today")).toContainText("新词 0 / 30");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("wordbook-action-learn")).toContainText("30");

  // 自定义 1 个 → 学满(按 wordbook.spec.ts 的学新词写法学 1 个)→ 达标横幅 → 加练 5
  await page.getByRole("button", { name: "调整今天的目标" }).click();
  await sheet.getByRole("radiogroup", { name: "每日新词" }).getByRole("radio", { name: "自定义" }).click();
  await sheet.getByRole("textbox", { name: "每日新词" }).fill("1");
  await sheet.getByRole("textbox", { name: "每日新词" }).press("Enter");
  await expect(sheet.getByTestId("goals-today")).toContainText("新词 0 / 1");
  await page.keyboard.press("Escape");
  await learnOneWord(page); // 定义见下方说明:与合并后 wordbook.spec.ts 相同的词卡 → 小测步骤
  await expect(page.getByTestId("wordbook-streak")).toContainText("1 天");
  await page.getByRole("button", { name: "今天加练" }).click();
  await sheet.getByRole("radio", { name: "5", exact: true }).click();
  await sheet.getByRole("button", { name: "加练 5 个" }).click();
  await expect(page).toHaveURL(/\/wordbook\/learn$/);

  // 暂停 → 暂停卡 → 继续
  await page.goto("/wordbook");
  await page.getByRole("button", { name: "每日目标设置" }).click();
  await sheet.getByRole("button", { name: "暂停这本书" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "暂停" }).click();
  await expect(page.getByTestId("wordbook-paused")).toContainText("已暂停");
  await page.getByRole("button", { name: "继续学习" }).click();
  await expect(page.getByRole("button", { name: "每日目标设置" })).toBeVisible();

  // 重置:输入书名前按钮不可点;重置后已学归零(初中只用本书新建的词)
  await page.getByRole("button", { name: "每日目标设置" }).click();
  await sheet.getByRole("button", { name: "重置进度" }).click();
  const alert = page.getByRole("alertdialog");
  await expect(alert.getByRole("button", { name: "重置进度" })).toBeDisabled();
  await alert.getByRole("textbox").fill("初中");
  await alert.getByRole("button", { name: "重置进度" }).click();
  await expect(page.getByTestId("wordbook-legend")).toContainText("已学0");
});
```

`learnOneWord(page)` 在本文件里定义(不改 `wordbook.spec.ts`,它可能属于 A 计划):照抄合并后 `wordbook.spec.ts` 的学新词步骤,只学 1 个——点「学新词」→ 词卡 → 小测作答(答错时记下正确项再选)→ 小结「回到首页」。375×812 浅色与深色各截一张面板图存进 `docs/superpowers/plans/e2e-results.md` 的说明里(只写路径与是否一致,不提交截图文件)。

- [ ] **Step 3: 文档**
  - `web/src/features/wordbook/CLAUDE.md`「What lives here」追加一行:`goals-math.ts`(估算 D/S/R(t)、方案、`previewPlan` 镜像服务端 `compute_plan`,共用 `server/tests/fixtures/wordbook_plan_cases.json`)、`goals-stepper.tsx`、`goals-fields.tsx`(选书页与面板共用)、`goals-sheet.tsx`(每日目标面板)、`use-goals.ts`(只有 PATCH 乐观更新)、`goals-test-fixtures.ts`。Pitfalls 追加:「改计划规则必须同时改服务端 `plan.compute_plan`、`goals-math.previewPlan` 与共用样例表」「`review_cap` 为 0 表示不限,表单里用 `reviewCap: null`」「重置/暂停只在确认框里触发;红色只给重置」。
  - `web/README.md` 背单词段落追加:首页齿轮打开「每日目标」面板(范围、方案估算、加练、暂停、重置);真机未验证项:iOS 数字键盘 `inputmode`、面板内焦点陷阱与 VoiceOver 朗读顺序。

- [ ] **Step 4: 视觉对照** — `yarn web:dev`(后端用 E2E 栈或本地服务)在浏览器窗格 375×812 打开 `/wordbook` 与面板,浅色与深色分别对照 `docs/superpowers/design/wordbook-goals-v1/mockup.html` 的 01–09 帧;差异记录在本计划 Z1 的结果里(只记录,不改视觉稿)。

- [ ] **Step 5: 跑测试** — Run: `yarn web:typecheck && yarn web:test && yarn web:build`;E2E(需 E2E 栈):`yarn web:e2e --project=chromium-mobile wordbook-goals.spec.ts wordbook.spec.ts` → PASS

- [ ] **Step 6: 提交**

```bash
git add web/src/features/wordbook/i18n.test.ts web/src/features/wordbook/CLAUDE.md web/README.md web/e2e/wordbook-goals.spec.ts
git commit -m "test(web): wordbook goals e2e, plural copy and docs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Review wave (Z)

### Task Z1: 评审与合并验收

- [ ] 两条车道各跑 `/code-review high`,按发现修复(每个修复一个提交,测试先行)。
- [ ] `security-review`(整个分支):用户输入只经 pydantic + `goals_error`;限流先校验后扣次数;重置只删 `source='wordbook:<book>'` 的行(测试证明查词/其它书的行不动);段位预同步;日志与审计不含确认文本与令牌;GET `/today` 的写入幂等且维护模式不写。
- [ ] 全量:`cd server && uv run pytest -q`;`yarn web:typecheck && yarn web:test && yarn web:build`;E2E 两个背单词规格。
- [ ] 视觉:GW6 Step 4 的对照结果写进本计划的「结果」小节(浅色/深色、帧号、差异)。
- [ ] 与 C 计划交接:在本计划末尾写明 C 需要 rebase 的共享文件(`service.py`、`store.py`、`routers/wordbook.py`、`wordbook-api.ts`、契约样例)与本计划新增的事件 kind。

## 验收标准

1. 首页顶栏齿轮与计划卡齿轮都打开「每日目标」面板;不离开首页即可改每日新词(1–200,预设 10/20/30/50 + 自定义步进)、复习上限(10–1000 / 不限,预设 50/100/200 + 自定义)、顺序;改动后首页「学新词」计数立即变化,刷新后与服务端一致。
2. 调高当天立即多给新词;调低不删任何进度;积压时当天新词总数最多 5 个(含加练),面板写明原因与恢复条件。
3. 三个方案显示「约 N 天学完」与「稳定后每天复习约 5N」,数值与 spec §4.2 表一致;超过复习上限时琥珀提示。
4. 加练只在今天新词学完且无积压时可用,每次 ≤ 20、每天 ≤ 管理员上限;服务端拒绝时显示翻译后的原因;成功后进入学新词页,`/answers` 的每日新词检查包含加练。
5. 连续达标按 spec G-6 计算,一天一条 `goal` 事件,维护模式不写;首页与面板显示一致。
6. 暂停后首页显示暂停卡(不跳选书页),继续后设置与进度不变;重置需输入书名,只删本书来源的行,事件、段位点、成就、今日新词数、别的来源的词全部保留;重学记 `relearn`、计入每日新词、无段位点。
7. 管理员可在设置注册表收窄范围与关闭「不限」/加练(审计可见);min > 默认 > max 的组合被拒绝;旧选书记录不迁移、读取时夹值。
8. 契约样例与网页类型一致(契约测试不跳过);全量测试、类型检查、构建通过;面板键盘可达、焦点困住并返回、所有控件 ≥ 44px、数字输入弹出数字键盘、深色模式可读。

## 规格覆盖自查(spec → task)

| spec 章节 | 任务 |
|---|---|
| §2 入口与面板结构 | GW3(字段)、GW4(面板、两个齿轮、横幅) |
| §3.1 范围、兼容 | GS1(`effective_goals`、`goals_error`)、GS2(设置)、GS3(PATCH / PUT、夹值) |
| §3.2 立即生效 | GS3(测试 `test_patch_applies_immediately…`)、GW2(乐观更新)、GW4 |
| §3.3 `relearn` | GS3 |
| §3.4 不限、§3.5 积压修正 | GS1(样例表)、GS3、GW1 |
| §4 方案与估算 | GW1、GW3 |
| §5 今天加练 | GS4、GW4 |
| §6 连续达标 | GS1(`streak_of`)、GS3(写入与返回)、GW4 |
| §7 换书、暂停、继续 | GS4、GW4(暂停卡)、GW5(换书页) |
| §8 重置 | GS4(含段位预同步)、GW4 |
| §9 API 与契约 | GS3、GS4、GS5、GW2 |
| §10 设置注册表 | GS2 |
| §12 网页(状态、无障碍、深色、文案) | GW2–GW6 |
| §13 测试与 E2E | 全部任务 + GW6 |
| §14 协作与共享文件 | Global Constraints、各任务的单点修改说明、Z1 交接 |
