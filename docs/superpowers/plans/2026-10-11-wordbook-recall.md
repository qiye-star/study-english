# 背单词 v2 · 认识 / 模糊 / 不认识 与「快速回忆」Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 学新词改为「遮罩词卡 + 认识 / 模糊 / 不认识」三档自评(盒子、抽查、连续模糊全部由服务端确定性决定),本轮小测按评级排队;复习新增「快速回忆」题型(三档自评 → 翻面确认,认识按比例抽查);四个管理端设置;API 只追加字段,契约样例与网页类型同步。

**Architecture:** 服务端新增纯模块 `app/wordbook/recall.py`(有效评级、抽查哈希、学新词盒子、当天后续作答的目标盒);`quiz.py` 加 `recall` 题型与独立的出题哈希 `use_recall`(不改 v1 选题);`service.py` 的 `/answers` 新增自评分支 `_rating_answer` 与当天小测规则 `_learn_day_quiz`,`learn_batch` 加 `drill`,`review_batch` 接受 `recall_ok`;`store.py` 追加 `last_rating` / `first_rating_on` / `set_learn_box`;不新增迁移(评级写在 `wordbook_events.outcome`,`qtype='recall'`)。网页在 `session-machine.ts` 追加卡片 reducer 与本轮小测排队,新组件 `recall-cover.tsx` / `recall-rating-bar.tsx` / `recall-card.tsx`,改写 `learn-page.tsx`,`review-page.tsx` 增加快速回忆分支。

**Tech Stack:** FastAPI + SQLAlchemy 2 async + pydantic v2 + pytest-asyncio(Python 3.12,uv);React 18 + Tailwind 3 + vitest + Testing Library + lucide-react;Playwright。不新增依赖。

**Spec:** `docs/superpowers/specs/2026-10-11-wordbook-recall-design.md`(视觉稿 `docs/superpowers/design/wordbook-recall-v1/mockup.html`)。前置:`docs/superpowers/specs/2026-10-10-wordbook-design.md` §6–8 与评审修订、`docs/superpowers/plans/2026-10-10-wordbook.md`(P-W1–P-W8)、`docs/superpowers/design/redesign-v3/design-notes.md`。

## Global Constraints

- 只追加,不改已有字段的含义:旧客户端(PWA 缓存)照 v1 能学、能复习。`known:true` 保留为 `rating:"know"` 的别名(R-R7);`review/batch` 不带 `recall:true` 时出题与 v1 逐项相同。
- 盒子号沿用 v1(`INTERVAL_DAYS = (1, 2, 4, 7, 15, 30)`,下标 = 盒子):认识 = 盒 2、模糊 = 盒 1、不认识 = 盒 0;抽中抽查的认识先盒 1(R-R3)。不改 `app/services/vocabulary.py`。
- 当天新词的后续作答(抽查、小测、再评)只用 `store.set_learn_box`:条件 `reps = 0 且 box = 读到的值`,**不加 `reps`、不写 `last_reviewed_at`**,所以不产生 `vocab_review`(保持 v1 review B1)。未到期词仍走 `apply_lapse`(R-W5)。
- 保留全部 v1 服务端上限:当前在学的书(409)、`new_left`(429)、每词每人一次 `learn`、作答 3,000/UTC 日(429)、段位点每日 60 共享上限、`known` 只用于 `mode=learn`(422)、到期复习题型校验(422)。
- 判分与抽查确定性:同样的 `(seed, user_id, key, reps, pct, elapsed_ms)` 同样结果;不调用 LLM;不记录用户输入。
- **迁移:不新增**。为本计划预留的 `0013` 不使用;`alembic heads` 仍为 `0012`。B 计划若写了 `down_revision = "0013"`,合并时改为 `"0012"`(在 B 的计划里加 Addendum)。
- 本计划只改这些文件(与 B / C 计划不重叠):`server/app/wordbook/{recall.py(新),quiz.py,service.py(config_out 一行、学新词/复习/作答段落),store.py(末尾追加)}`、`server/app/routers/wordbook.py`(`ReviewIn`/`AnswerIn` 字段与两处调用)、`server/app/core/{config.py,settings_registry.py}`(各追加一段)、`server/tests/{wordbook_helpers.py(一处默认值),test_wordbook_learn.py(两处),test_wordbook_contract.py,test_wordbook_recall.py(新),test_wordbook_recall_api.py(新),fixtures/wordbook_contract.json(重录)}`、`web/src/features/wordbook/{wordbook-api.ts(追加),test-fixtures.ts(追加),session-machine.ts(追加),word-card.tsx,recall-cover.tsx(新),recall-rating-bar.tsx(新),recall-card.tsx(新),learn-page.tsx,review-page.tsx,session-summary.tsx,i18n/{zh-CN,en}.json(learn.*、recall.*),*.test.ts(x),wordbook-contract.test.ts}`、`web/e2e/wordbook-recall.spec.ts`(新)、两个 `CLAUDE.md` 与 `docs/superpowers/plans/e2e-results.md`(Z 车道)。**不碰** `home-page.tsx`、`books-page.tsx`、`plan.py`、跨模块挂钩点(rank / rooms / practice / me)。
- 网页文案只在 `web.wordbook.learn.*` 与 `web.wordbook.recall.*` 下新增,中英齐全;页面测试断言中文。
- 视觉:一色一义(认识 = 蓝主按钮,模糊 = 琥珀图标,不认识 = 中性;正确绿、错误中性,不用红);触控 ≥ 44px(自评键 48px、遮罩 ≥ 96px);深色;减少动态时不做变换;界面不用 emoji。
- 每个任务结束:`cd server && uv run pytest -q <任务列出的测试> tests/test_architecture.py`;涉及网页:`yarn web:typecheck && cd web && yarn vitest run src/features/wordbook src/architecture.test.ts`。车道合并前全量 `uv run pytest -q` 与 `yarn web:typecheck && yarn web:test && yarn web:build`。提交 conventional(`feat(server): …`、`feat(web): …`、`test(e2e): …`、`docs: …`),一个任务一个提交,信息以 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` 结尾。
- **写计划时的实跑(P-R0)**:S1–S6 的服务端代码与测试在会话草稿目录里的 `server/` 副本上原样实跑:`tests/test_wordbook_*.py`、`test_rank_wordbook.py`、`test_admin_wordbook.py`、`test_settings_registry.py`、`test_architecture.py`、`test_migrations.py`、`test_vocabulary_api.py` 共 278 通过,1 失败为环境原因(副本没有仓库根的 `NOTICE`,`test_wordbook_data_files.py`);契约样例在副本里重录后复跑通过。网页 `session-machine.ts` 追加部分用 Node 24(`--experimental-strip-types`)实跑通过。**React 组件与页面测试未实跑**(草稿目录跨盘符链接 `node_modules` 被沙箱拒绝),执行者第一次运行时以真实结果为准修正选择器。

---

## 文件结构与共享文件插入点

```
server/app/wordbook/recall.py            新:三档自评纯规则
server/app/wordbook/quiz.py              + "recall" 题型、RECALL_BOXES、RECALL_SHARE_PCT、use_recall、build_question 分支
server/app/wordbook/store.py             末尾追加:last_rating、first_rating_on、set_learn_box
server/app/wordbook/service.py           config_out 一行;AnswerInput 3 字段;learn_batch drill;review_batch recall_ok;
                                         _allowed_qtypes;_validate;answer() 分派;_answer_out/_learn_day_quiz/_rating_answer/_create_learned
server/app/routers/wordbook.py           ReviewIn.recall;AnswerIn.qtype/rating/revealed_before/elapsed_ms;两处调用
server/app/core/config.py                wordbook_* 段末追加 4 个设置
server/app/core/settings_registry.py     wordbook 段末追加 4 条
web/src/features/wordbook/
  session-machine.ts                     追加 Rating、cardReducer、ratingPayload、planLearnQuiz、slotId/slotKey、learnTally
  recall-cover.tsx  recall-rating-bar.tsx  recall-card.tsx   新
  word-card.tsx  learn-page.tsx  review-page.tsx  session-summary.tsx  wordbook-api.ts  test-fixtures.ts  i18n/*
web/e2e/wordbook-recall.spec.ts          新
```

| 共享文件(B / C 也可能改) | 本计划的插入点(只追加) |
|---|---|
| `server/app/core/config.py` | `wordbook_ai_daily_per_user: int = Field(20, ge=0, le=1000)` 这一行**之后**、`wordbook_data_dir` 之前,一段带注释 `# 背单词 v2 · 三档自评与快速回忆` 的 4 行 |
| `server/app/core/settings_registry.py` | `_s("wordbook_ai_daily_per_user", …)` 这一行**之后**、`# admin` 注释之前,一段带注释 `# wordbook v2(…recall §7)` 的 4 条 |
| `server/app/wordbook/service.py` | `config_out` 里 `"defaults": …` 行之后追加 `"learn": …` 一行;其余改动都在 `# ---- 学新词、复习、作答` 段落内(B 改 `today_out`/`put_enrollment`、C 改挂钩点时互不重叠) |
| `server/app/wordbook/store.py` | 文件末尾追加一段 `# ---- 背单词 v2 · 三档自评` + 第 4 行 import 加 `timedelta`、`INTERVAL_DAYS` |
| `server/app/routers/wordbook.py` | `ReviewIn`、`AnswerIn` 类体末尾追加字段;`wordbook_review` / `wordbook_answer` 调用追加参数 |
| `server/tests/fixtures/wordbook_contract.json` | 整文件重录(`CONTRACT_UPDATE=1`);**合并顺序 A → B → C**,B / C rebase 后各自重录一次 |
| `server/tests/test_wordbook_contract.py` | `KEYS` 追加 2 个键;`collect` 在 `out["card"] = …` 之前追加一段;函数签名加 `monkeypatch` |
| `web/src/features/wordbook/wordbook-api.ts` | `QType` 联合加 `"recall"`;`Question` 之后加 `Rating`;`AnswerInput`/`AnswerResult` 末尾追加字段;`WordbookConfig` enabled 分支追加 `learn`;`WORDBOOK_SERVER_ERRORS` 末尾追加一条;`learnBatch` 返回类型加 `drill`;`reviewBatch` 加第三个可选参数 |
| `web/src/features/wordbook/test-fixtures.ts` | `CONFIG` 对象追加 `learn` 键 |
| `web/src/features/wordbook/wordbook-contract.test.ts` | `ANSWER` 键表追加 3 键;新增 2 个 `it` |
| `web/src/features/wordbook/i18n/{zh-CN,en}.json` | `web.wordbook.learn` 对象内追加键;`web.wordbook` 下新增 `recall` 对象(放在 `quiz` 对象之后) |

## 并行车道、文件归属与合并顺序

| 车道 | 任务 | 独占文件 | 依赖 |
|---|---|---|---|
| **server S**(串行,一个执行者) | S1–S6 | 上表全部 `server/**` 文件 | — |
| **web W**(串行,一个执行者) | W1–W7 | `web/src/features/wordbook/**`(本计划列出的文件) | W1–W6 按 spec §9 的形状写,可与 S 并行;W7 需 S6 已合并 |
| **final Z** | Z1–Z2 | `web/e2e/wordbook-recall.spec.ts`、`server/app/wordbook/CLAUDE.md`、`web/src/features/wordbook/CLAUDE.md`、`web/README.md`(背单词段)、`docs/superpowers/plans/e2e-results.md` | S、W 全部合并 |

**合并顺序(本计划内)**:S1 → S2 → S3 → S4 → S5 → S6 → W1 → … → W6(rebase 到 S6)→ W7 → Z1 → Z2。
**跨计划**:A(本计划)→ B(目标 / 设置面板)→ C(学习联动)。B、C 在 rebase 到 A 之后重录契约样例并处理 `config.py` / `settings_registry.py` 的相邻插入。

**评审波**:S 车道合并前 `/code-review high` + `security-review`(输入校验、确定性、私有种子、作答上限、日志卫生);W 车道合并前 `/code-review high` + 视觉对照(视觉稿 vs 真实页面,浏览器窗格 375×812 浅色与深色);Z2 对整个分支 `security-review`,真机清单见 spec §8.4,未验证项在 `e2e-results.md` 标「未验证」。

## 本计划的裁定

- **P-R0** 写计划时的实跑(见 Global Constraints)。
- **P-R1** 抽查种子 = 该书 `wordbook_enrollments.seed`(服务端私有);没有选书记录时为 0。
- **P-R2** 快速回忆出题用独立哈希 `use_recall(user_id, key, reps, box)`(40%,盒 {1,2,4,5});到期校验接受 v1 题型 ∪ {recall(设置开且命中)}。
- **P-R3** 复习抽查两步:第一次 `rating:"know"` 不带 `choice` → `outcome:"pending"` + `check`,只扣作答次数、不写盒、不记事件;第二次带 `choice` 按选释义判。
- **P-R4** 测试夹具 `tests/wordbook_helpers.enable_wordbook` 默认 `wordbook_spot_check_pct=0`(v1 的测试保持确定性);抽查测试显式传 0 / 1 / 100。
- **P-R5** 本计划改 `wordbook-api.ts` 的类型与 `reviewBatch` 签名,视为 v1 计划 P-W4 的 Addendum(只追加)。

---

## Server lane (S)

### Task S1: `recall.py` — 三档自评纯规则

**Files:**
- Create: `server/app/wordbook/recall.py`
- Test: `server/tests/test_wordbook_recall.py`

**Interfaces:**
- Produces:`Rating`、`RATINGS`、`KNOW_CHECK = "know_chk"`、`RATING_OUTCOMES`、`RECALL_QTYPE = "recall"`、`FAST_MS = 1000`、`LEARN_BOX`、`PENDING_BOX = 1`、`GRADE`;`as_rating(outcome) -> Rating | None`、`effective_rating(rating, *, revealed_before, previous) -> Rating`、`spot_hit(seed, user_id, key, reps, pct) -> bool`、`needs_check(rating, *, seed, user_id, key, reps, pct, elapsed_ms) -> bool`、`LearnDecision(box, outcome, spot_check)`、`learn_decision(rating, check) -> LearnDecision`、`learn_quiz_target(box, today_outcome, correct) -> int | None`、`learn_rerate_target(box, rating) -> int | None`

- [ ] **Step 1: 写失败测试** — `server/tests/test_wordbook_recall.py`:

```python
"""三档自评纯规则(spec 2026-10-11-wordbook-recall §5)。"""
from app.wordbook.recall import (FAST_MS, GRADE, KNOW_CHECK, LearnDecision, as_rating, effective_rating, learn_decision,
                                 learn_quiz_target, learn_rerate_target, needs_check, spot_hit)


def test_peek_turns_know_into_fuzzy():
    assert effective_rating("know", revealed_before=True, previous=None) == "fuzzy"
    assert effective_rating("know", revealed_before=False, previous="fuzzy") == "know"


def test_two_fuzzy_in_a_row_count_as_unknown_in_pairs():
    assert effective_rating("fuzzy", revealed_before=False, previous=None) == "fuzzy"
    assert effective_rating("fuzzy", revealed_before=False, previous="fuzzy") == "unknown"
    assert effective_rating("fuzzy", revealed_before=False, previous="unknown") == "fuzzy"
    assert effective_rating("know", revealed_before=True, previous="fuzzy") == "unknown"
    assert effective_rating("unknown", revealed_before=False, previous="fuzzy") == "unknown"


def test_know_check_counts_as_know_for_the_streak():
    assert as_rating(KNOW_CHECK) == "know" and as_rating("correct") is None
    assert effective_rating("fuzzy", revealed_before=False, previous=KNOW_CHECK) == "fuzzy"


def test_spot_hit_is_deterministic_and_close_to_the_ratio():
    keys = [f"w{i}" for i in range(10_000)]
    hits = sum(spot_hit(12345, 7, k, 0, 33) for k in keys)
    assert 3100 <= hits <= 3500, hits  # 写计划时实测 3,344
    assert [spot_hit(12345, 7, k, 0, 33) for k in keys[:50]] == [spot_hit(12345, 7, k, 0, 33) for k in keys[:50]]


def test_spot_hit_bounds():
    assert not any(spot_hit(1, 1, f"w{i}", 0, 0) for i in range(500))
    assert all(spot_hit(1, 1, f"w{i}", 0, 100) for i in range(500))


def test_seed_changes_the_pick():
    assert [spot_hit(1, 7, f"w{i}", 0, 33) for i in range(200)] != [spot_hit(2, 7, f"w{i}", 0, 33) for i in range(200)]


def test_needs_check_only_for_know_and_fast_taps_force_it():
    miss = next(f"w{i}" for i in range(1000) if not spot_hit(9, 7, f"w{i}", 0, 33))
    assert not needs_check("know", seed=9, user_id=7, key=miss, reps=0, pct=33, elapsed_ms=4000)
    assert needs_check("know", seed=9, user_id=7, key=miss, reps=0, pct=33, elapsed_ms=400)
    assert not needs_check("know", seed=9, user_id=7, key=miss, reps=0, pct=0, elapsed_ms=400)
    assert not needs_check("fuzzy", seed=9, user_id=7, key=miss, reps=0, pct=100, elapsed_ms=400)
    assert not needs_check("know", seed=9, user_id=7, key=miss, reps=0, pct=33, elapsed_ms=None)
    assert FAST_MS == 1000


def test_learn_decision_boxes():
    assert learn_decision("know", False) == LearnDecision(2, "know", False)
    assert learn_decision("know", True) == LearnDecision(1, KNOW_CHECK, True)
    assert learn_decision("fuzzy", True) == LearnDecision(1, "fuzzy", False)
    assert learn_decision("unknown", False) == LearnDecision(0, "unknown", False)


def test_learn_quiz_target():
    assert learn_quiz_target(1, KNOW_CHECK, True) == 2
    assert learn_quiz_target(1, KNOW_CHECK, False) == 0
    assert learn_quiz_target(1, "fuzzy", True) is None
    assert learn_quiz_target(1, "fuzzy", False) == 0
    assert learn_quiz_target(0, "unknown", False) is None
    assert learn_quiz_target(2, KNOW_CHECK, True) is None   # 已升过:不再升
    assert learn_quiz_target(0, KNOW_CHECK, True) is None   # 已降:答对也不回升


def test_rerate_only_lowers():
    assert learn_rerate_target(2, "unknown") == 0
    assert learn_rerate_target(2, "fuzzy") == 1
    assert learn_rerate_target(1, "know") is None
    assert learn_rerate_target(0, "unknown") is None
    assert GRADE == {"know": "good", "fuzzy": "hard", "unknown": "forgot"}
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd server && uv run pytest -q tests/test_wordbook_recall.py` → `ModuleNotFoundError: app.wordbook.recall`。

- [ ] **Step 3: 实现** — `server/app/wordbook/recall.py`:

```python
"""快速回忆与三档自评(spec 2026-10-11-wordbook-recall §5)。纯函数:有效评级、抽查判定、学新词盒子、当天后续作答。"""
import hashlib
from dataclasses import dataclass
from typing import Literal

Rating = Literal["know", "fuzzy", "unknown"]
RATINGS: tuple[Rating, ...] = ("know", "fuzzy", "unknown")
KNOW_CHECK = "know_chk"  # 事件 outcome:抽中抽查的「认识」(学新词)
RATING_OUTCOMES = frozenset({"know", KNOW_CHECK, "fuzzy", "unknown"})
RECALL_QTYPE = "recall"
FAST_MS = 1000           # 比这更快的「认识」必抽(pct > 0 时)
LEARN_BOX: dict[str, int] = {"know": 2, "fuzzy": 1, "unknown": 0}
PENDING_BOX = 1          # R-R3:抽中的「认识」先记盒 1
GRADE: dict[str, str] = {"know": "good", "fuzzy": "hard", "unknown": "forgot"}


def as_rating(outcome: str | None) -> Rating | None:
    """事件 outcome → 评级(know_chk 视为 know);不是自评事件 → None。"""
    if outcome == KNOW_CHECK:
        return "know"
    return outcome if outcome in RATINGS else None  # type: ignore[return-value]


def effective_rating(rating: Rating, *, revealed_before: bool, previous: str | None) -> Rating:
    """偷看后认识 = 模糊;与上一次自评连续两次模糊 = 不认识(被改记的那次不再与下一次连续)。"""
    r: Rating = "fuzzy" if rating == "know" and revealed_before else rating
    if r == "fuzzy" and as_rating(previous) == "fuzzy":
        return "unknown"
    return r


def spot_hit(seed: int, user_id: int, key: str, reps: int, pct: int) -> bool:
    if pct <= 0:
        return False
    if pct >= 100:
        return True
    digest = hashlib.sha256(f"spot:{seed}:{user_id}:{key}:{reps}".encode()).digest()
    return int.from_bytes(digest[:4], "big") % 100 < pct


def needs_check(rating: Rating, *, seed: int, user_id: int, key: str, reps: int, pct: int,
                elapsed_ms: int | None) -> bool:
    if rating != "know" or pct <= 0:
        return False
    return spot_hit(seed, user_id, key, reps, pct) or (elapsed_ms is not None and elapsed_ms < FAST_MS)


@dataclass(frozen=True)
class LearnDecision:
    box: int
    outcome: str      # know | know_chk | fuzzy | unknown(写进 wordbook_events.outcome)
    spot_check: bool


def learn_decision(rating: Rating, check: bool) -> LearnDecision:
    if rating == "know" and check:
        return LearnDecision(PENDING_BOX, KNOW_CHECK, True)
    return LearnDecision(LEARN_BOX[rating], rating, False)


def learn_quiz_target(box: int, today_outcome: str, correct: bool) -> int | None:
    """当天新词(reps = 0)在本轮小测里作答后的目标盒;None = 不改。"""
    if not correct:
        return 0 if box > 0 else None
    if today_outcome == KNOW_CHECK and box == PENDING_BOX:
        return LEARN_BOX["know"]
    return None


def learn_rerate_target(box: int, rating: Rating) -> int | None:
    """当天再次自评(「记错了」):只降不升。"""
    target = LEARN_BOX[rating]
    return target if target < box else None
```

- [ ] **Step 4: 跑测试确认通过** — Run: `cd server && uv run pytest -q tests/test_wordbook_recall.py tests/test_architecture.py` → 全部通过(实跑:10 passed)。

- [ ] **Step 5: 提交**

```bash
git add server/app/wordbook/recall.py server/tests/test_wordbook_recall.py
git commit -m "feat(server): wordbook recall rules (effective rating, spot check, learn boxes)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task S2: 设置(抽查比例、快速回忆开关、自动朗读、显示例句)与 `/config.learn`

**Files:**
- Modify: `server/app/core/config.py`、`server/app/core/settings_registry.py`、`server/app/wordbook/service.py`(`config_out`)、`server/tests/wordbook_helpers.py`
- Test: `server/tests/test_wordbook_recall_api.py`(本任务先放第一个用例)

**Interfaces:**
- Produces:`Settings.wordbook_spot_check_pct: int (0–100, 33)`、`wordbook_recall_enabled: bool (True)`、`wordbook_autoplay: bool (True)`、`wordbook_show_example: bool (True)`;`GET /config` 追加 `learn: {autoplay, show_example}`;`enable_wordbook(...)` 默认 `wordbook_spot_check_pct=0`(P-R4)

- [ ] **Step 1: 写失败测试** — 新建 `server/tests/test_wordbook_recall_api.py`,文件头与第一个用例(后续任务往这个文件追加):

```python
"""背单词 v2 · 三档自评与快速回忆的端点规则(spec 2026-10-11-wordbook-recall §5、§6)。"""
from datetime import timedelta

from sqlalchemy import select, update

from app.models import User, VocabularyItem, WordbookEnrollment, WordbookEvent, utcnow
from app.wordbook import recall, service
from app.wordbook.entry import meaning_line
from app.wordbook.index import dictionary
from tests.wordbook_helpers import enable_wordbook, make_data_dir

URL = "/api/wordbook"


async def login(app, client, tmp_path, **overrides):
    enable_wordbook(app, make_data_dir(tmp_path), **overrides)
    r = await client.post("/api/users", json={"username": "alice", "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    await client.put(f"{URL}/enrollment", headers=h, json={"book_id": "junior", "order_mode": "book"})
    return h


async def ans(client, h, **body):
    return await client.post(f"{URL}/answers", headers=h, json={"book_id": "junior", "tz_offset_minutes": 480, **body})


async def rate(client, h, key, rating, mode="learn", **extra):
    return (await ans(client, h, key=key, mode=mode, qtype="recall", rating=rating, **extra)).json()


async def row(app, word):
    async with app.state.sessionmaker() as s:
        return await s.scalar(select(VocabularyItem).where(VocabularyItem.word == word))


async def events(app):
    async with app.state.sessionmaker() as s:
        return [(e.kind, e.word, e.qtype, e.outcome) for e in
                (await s.scalars(select(WordbookEvent).order_by(WordbookEvent.id))).all()]


async def make_due(app, word):
    async with app.state.sessionmaker() as s:
        await s.execute(update(VocabularyItem).where(VocabularyItem.word == word)
                        .values(due_at=utcnow() - timedelta(hours=1)))
        await s.commit()


async def meaning(app, key):
    return meaning_line(await dictionary(app).card("junior", key))


def always_recall(monkeypatch):
    monkeypatch.setattr(service, "use_recall", lambda user_id, key, reps, box: box in (1, 2, 4, 5))


async def test_config_carries_the_learn_preferences(app, client, tmp_path):
    h = await login(app, client, tmp_path, wordbook_autoplay=False)
    cfg = (await client.get(f"{URL}/config", headers=h)).json()
    assert cfg["learn"] == {"autoplay": False, "show_example": True}
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd server && uv run pytest -q tests/test_wordbook_recall_api.py` → `KeyError: 'learn'`(或 `ValidationError` 不认识 `wordbook_autoplay`)。

- [ ] **Step 3: 实现**

`server/app/core/config.py`,在 `wordbook_ai_daily_per_user: int = Field(20, ge=0, le=1000)` 之后插入:

```python
    # 背单词 v2 · 三档自评与快速回忆(设计文档 2026-10-11-wordbook-recall §7)
    wordbook_spot_check_pct: int = Field(33, ge=0, le=100)
    wordbook_recall_enabled: bool = True
    wordbook_autoplay: bool = True
    wordbook_show_example: bool = True
```

`server/app/core/settings_registry.py`,在 `_s("wordbook_ai_daily_per_user", …)` 之后插入:

```python
    # wordbook v2(设计文档 2026-10-11-wordbook-recall §7)
    _s("wordbook_spot_check_pct", "wordbook", "int", "「认识」抽查比例(%)", min=0, max=100,
       help_zh="学新词与快速回忆里按「认识」的词按此比例抽查一道选释义;0 = 不抽查(含太快必抽)"),
    _s("wordbook_recall_enabled", "wordbook", "bool", "复习题型「快速回忆」", help_zh="自评三档后翻面确认;进入已掌握的那次复习不出此题"),
    _s("wordbook_autoplay", "wordbook", "bool", "自动朗读词头", help_zh="新词卡出现、快速回忆翻面时;「不认识」总是朗读"),
    _s("wordbook_show_example", "wordbook", "bool", "翻开后显示例句"),
```

`server/app/wordbook/service.py` 的 `config_out`,在 `"defaults": …` 行之后插入一行:

```python
        "learn": {"autoplay": settings.wordbook_autoplay, "show_example": settings.wordbook_show_example},  # recall §7
```

`server/tests/wordbook_helpers.py` 的 `enable_wordbook`:

```python
    app.state.settings = app.state.settings.model_copy(
        update={"wordbook_enabled": True, "wordbook_data_dir": str(data_dir), "wordbook_spot_check_pct": 0, **overrides})
```

- [ ] **Step 4: 跑测试确认通过** — Run: `cd server && uv run pytest -q tests/test_wordbook_recall_api.py tests/test_settings_registry.py tests/test_wordbook_api.py tests/test_architecture.py`(`test_settings_registry` 要求每个 Settings 字段都已登记或在 env-only 集合:4 个都已登记)。

- [ ] **Step 5: 提交** — `feat(server): wordbook recall settings and /config learn prefs`(信息结尾同上)。

### Task S3: `quiz.py` 快速回忆题型与 `review_batch` / 到期题型校验

**Files:**
- Modify: `server/app/wordbook/quiz.py`、`server/app/wordbook/service.py`(`review_batch`、`_allowed_qtypes`、import)、`server/app/routers/wordbook.py`(`ReviewIn`、`wordbook_review`)
- Test: `server/tests/test_wordbook_recall.py`(追加)、`server/tests/test_wordbook_recall_api.py`(追加)

**Interfaces:**
- Produces(`quiz.py`):`QType` 含 `"recall"`、`QTYPES` 末尾加 `"recall"`、`RECALL_BOXES = frozenset({1, 2, 4, 5})`、`RECALL_SHARE_PCT = 40`、`use_recall(user_id, key, reps, box) -> bool`;`build_question("recall", …)` → `prompt = {word, us}`、`options = None`、`length = None`
- Produces(`service.py`):`review_batch(..., *, tts: bool, recall_ok: bool = False)`;`_allowed_qtypes(user_id, row, card, *, recall_on=False)`
- Produces(HTTP):`POST /review/batch {…, recall?: bool = false}`

- [ ] **Step 1: 写失败测试** — 追加到 `server/tests/test_wordbook_recall.py`:

```python
async def test_recall_is_never_offered_at_box_0_or_3_and_keeps_v1_picks(tmp_path):
    from app.wordbook.index import DictionaryStore
    from app.wordbook.quiz import RECALL_SHARE_PCT, build_question, pick_qtype, question_rng, use_recall
    from tests.wordbook_helpers import make_data_dir
    keys = [f"w{i}" for i in range(5000)]
    assert not any(use_recall(7, k, 0, box) for k in keys[:500] for box in (0, 3))
    share = sum(use_recall(7, k, 0, 1) for k in keys)
    assert abs(share - 5000 * RECALL_SHARE_PCT / 100) <= 150, share
    assert [use_recall(7, k, 2, 2) for k in keys[:100]] == [use_recall(7, k, 2, 2) for k in keys[:100]]
    store = DictionaryStore(make_data_dir(tmp_path))
    card = (await store.cards("junior", ["talk"]))["talk"]
    q = build_question("recall", card, [], question_rng(7, "talk", 0))
    assert (q.qtype, q.prompt, q.options, q.length) == ("recall", {"word": "talk", "us": "tɔk"}, None, None)
    assert pick_qtype(2, card, question_rng(7, "talk", 3)) in ("word", "cloze", "dictation")  # v1 选题不变
```

追加到 `server/tests/test_wordbook_recall_api.py`(这两个用例用 `rate(...)` 先学新词,学新词自评在 S4 才实现:本任务只确认它们收集得到,S4 的 Step 4 起必须通过):

```python
async def test_due_quick_recall_grades_good_hard_forgot(app, client, tmp_path, monkeypatch):
    always_recall(monkeypatch)
    h = await login(app, client, tmp_path)
    for key in ("talk", "ability", "able"):
        await rate(client, h, key, "fuzzy")  # 盒 1
        await make_due(app, key)
    batch = (await client.post(f"{URL}/review/batch", headers=h, json={"size": 5, "recall": True})).json()
    assert {q["qtype"] for q in batch["questions"]} == {"recall"}
    q = next(q for q in batch["questions"] if q["key"] == "talk")
    assert q["prompt"] == {"word": "talk", "us": "tɔk"} and q["options"] is None and q["length"] is None
    good = await rate(client, h, "talk", "know", mode="review")
    assert (good["grade"], good["applied"], good["item"]["box"]) == ("good", True, 2)
    hard = await rate(client, h, "ability", "unknown", mode="review")
    assert (hard["grade"], hard["item"]["box"]) == ("forgot", 0)
    assert [e[0] for e in await events(app)][-2:] == ["review", "review"]
    assert (await row(app, "talk")).reps == 1  # 到期复习:与其它题型一样产生一次 vocab_review


async def test_recall_is_offered_only_when_declared_and_enabled(app, client, tmp_path, monkeypatch):
    always_recall(monkeypatch)
    h = await login(app, client, tmp_path)
    await rate(client, h, "talk", "fuzzy")
    await make_due(app, "talk")
    legacy = (await client.post(f"{URL}/review/batch", headers=h, json={"size": 5})).json()
    assert legacy["questions"][0]["qtype"] != "recall"
    enable_wordbook(app, make_data_dir(tmp_path), wordbook_recall_enabled=False)
    off = (await client.post(f"{URL}/review/batch", headers=h, json={"size": 5, "recall": True})).json()
    assert off["questions"][0]["qtype"] != "recall"
    r = await ans(client, h, key="talk", mode="review", qtype="recall", rating="know")
    assert r.status_code == 422 and r.json() == {"error": "Question type mismatch"}
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd server && uv run pytest -q tests/test_wordbook_recall.py` → `ImportError: cannot import name 'use_recall'`。

- [ ] **Step 3: 实现**

`server/app/wordbook/quiz.py`:

```python
QType = Literal["meaning", "word", "cloze", "dictation", "spell", "recall"]
QTYPES: tuple[QType, ...] = ("meaning", "word", "cloze", "dictation", "spell", "recall")
CHOICE_QTYPES: tuple[QType, ...] = ("meaning", "word", "cloze")
# 快速回忆(spec 2026-10-11-wordbook-recall §4.1):盒 0 刚忘、盒 3 → 4 是进入「已掌握」的那一步,都要客观题
RECALL_BOXES = frozenset({1, 2, 4, 5})
RECALL_SHARE_PCT = 40
```

在 `def _related` 之前加:

```python
def use_recall(user_id: int, key: str, reps: int, box: int) -> bool:
    """这次复习是否出「快速回忆」:与 pick_qtype 用不同的哈希,所以 v1 的选题结果逐项不变;
    客户端不声明支持或设置关闭时调用方不调用它。"""
    if box not in RECALL_BOXES:
        return False
    digest = hashlib.sha256(f"recall:{user_id}:{key}:{reps}".encode()).digest()
    return int.from_bytes(digest[:4], "big") % 100 < RECALL_SHARE_PCT
```

`build_question` 开头加分支:

```python
    if qtype == "recall":  # 只给词头与音标;释义在翻面后从词卡显示
        return Question(card.key, qtype, {"word": card.word, "us": card.us or card.uk}, None, None)
```

`server/app/wordbook/service.py`:import 行 `from app.wordbook.quiz import (…, pick_qtype, question_rng)` 末尾加 `use_recall`;`review_batch` 签名改为 `offset: int, now, *, tts: bool, recall_ok: bool = False) -> dict:`,循环里:

```python
        recall_on = recall_ok and settings.wordbook_recall_enabled
        qtype = "recall" if recall_on and use_recall(user_id, card.key, row.reps, row.box) else pick_qtype(
            row.box, card, rng, tts=tts)
```

`_allowed_qtypes` 整个替换为:

```python
def _allowed_qtypes(user_id: int, row: Known, card: WordCard, *, recall_on: bool = False) -> set[str]:
    """review m2:到期复习(会改盒)的题型必须是 review_batch 按 (user_id, key, reps) 选的那个。TTS 设置可能在出题后
    变化,两种都接受;网页没有 TTS 时把听写换成看释义拼写(spec §11.4),所以听写也接受 spell。
    spec recall §4.1:快速回忆开着且这次复习选中了它时,另外接受 recall(旧客户端仍按 v1 题型作答)。"""
    allowed = {pick_qtype(row.box, card, question_rng(user_id, card.key, row.reps), tts=tts) for tts in (True, False)}
    if recall_on and use_recall(user_id, card.key, row.reps, row.box):
        allowed.add("recall")
    return allowed | ({"spell"} if "dictation" in allowed else set())
```

`answer()` 里的到期校验改为:

```python
    if (p.mode == "review" and row is not None and row.due_at <= now
            and p.qtype not in _allowed_qtypes(user_id, row, card, recall_on=settings.wordbook_recall_enabled)):
        fail(QTYPE_MISMATCH)
```

`server/app/routers/wordbook.py`:

```python
class ReviewIn(LearnIn):
    size: int = Field(20, ge=1, le=20)
    recall: bool = False  # spec recall §4.1:客户端声明能显示「快速回忆」(旧客户端不传 → 不出此题)
```

`wordbook_review` 调用改为 `…, utcnow(), tts=bool(settings.tts_model_list), recall_ok=payload.recall)`。

- [ ] **Step 4: 跑测试确认通过** — Run: `cd server && uv run pytest -q tests/test_wordbook_recall.py tests/test_wordbook_quiz.py tests/test_wordbook_learn.py tests/test_architecture.py`。`test_wordbook_learn.py` 的 `pin_qtypes` 不需要改(`pick_qtype` 签名不变)。

- [ ] **Step 5: 提交** — `feat(server): quick-recall question type behind a client flag`。

### Task S4: `/answers` 学新词三档自评、当天小测与再评、`known` 别名、`drill`

**Files:**
- Modify: `server/app/wordbook/store.py`(末尾追加)、`server/app/wordbook/service.py`、`server/app/routers/wordbook.py`(`AnswerIn`、`wordbook_answer`)、`server/tests/test_wordbook_learn.py`(一行断言)
- Test: `server/tests/test_wordbook_recall_api.py`(追加)

**Interfaces:**
- Produces(`store.py`):`last_rating(session, user_id, word) -> str | None`、`first_rating_on(session, user_id, word, day) -> str | None`、`set_learn_box(session, user_id, item_id, *, seen_box, to_box, now) -> bool`
- Produces(`service.py`):`AnswerInput` 追加 `rating: str | None = None`、`revealed_before: bool = False`、`elapsed_ms: int | None = None`;`RATING_REQUIRED = (422, "Rating is required")`;`learn_batch` 响应追加 `drill`;`/answers` 响应追加 `rating`、`spot_check`、`check`(全部 answer 路径都带)
- Produces(HTTP):`POST /answers` 请求追加 `qtype:"recall"`、`rating`、`revealed_before`、`elapsed_ms (0–600000)`

- [ ] **Step 1: 写失败测试** — 追加到 `server/tests/test_wordbook_recall_api.py`:

```python
async def test_new_word_ratings_set_boxes_and_each_word_counts_once(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    know = await rate(client, h, "talk", "know", elapsed_ms=4000)
    assert (know["rating"], know["outcome"], know["spot_check"], know["item"]["box"], know["applied"]) == (
        "know", "know", False, 2, True)
    assert know["check"] is None and know["grade"] == "good" and know["correct"] is True
    assert (await rate(client, h, "ability", "fuzzy"))["item"]["box"] == 1
    assert (await rate(client, h, "able", "unknown"))["item"]["box"] == 0
    peeked = await rate(client, h, "abandon", "know", revealed_before=True)
    assert (peeked["rating"], peeked["item"]["box"], peeked["correct"]) == ("fuzzy", 1, False)
    assert await events(app) == [("learn", "talk", "recall", "know"), ("learn", "ability", "recall", "fuzzy"),
                                 ("learn", "able", "recall", "unknown"), ("learn", "abandon", "recall", "fuzzy")]
    item = await row(app, "talk")
    assert (item.reps, item.last_reviewed_at) == (0, None)  # 不是复习:不产生 vocab_review
    today = (await client.get(f"{URL}/today", headers=h, params={"tz_offset_minutes": 480})).json()
    assert today["plan"]["new_done"] == 4
    nxt = (await client.post(f"{URL}/learn/batch", headers=h, json={"size": 1})).json()
    assert [c["key"] for c in nxt["cards"]] == ["absorb"]  # cursor 前进


async def test_rating_on_a_new_word_obeys_the_daily_new_limit(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    await client.put(f"{URL}/enrollment", headers=h, json={"book_id": "junior", "daily_new": 5})
    for key in ("talk", "ability", "able", "abandon", "absorb"):
        await rate(client, h, key, "know")
    r = await ans(client, h, key="accept", mode="learn", qtype="recall", rating="know")
    assert r.status_code == 429 and r.json() == {"error": "Daily new-word limit reached"}


async def test_spot_checked_know_starts_at_box_1_and_the_round_quiz_decides(app, client, tmp_path):
    h = await login(app, client, tmp_path, wordbook_spot_check_pct=100)
    talk = await rate(client, h, "talk", "know")
    assert (talk["rating"], talk["spot_check"], talk["item"]["box"]) == ("know", True, 1)
    passed = (await ans(client, h, key="talk", mode="learn", qtype="meaning", choice=await meaning(app, "talk"))).json()
    assert (passed["correct"], passed["applied"], passed["item"]["box"]) == (True, True, 2)
    again = (await ans(client, h, key="talk", mode="learn", qtype="meaning", choice=await meaning(app, "talk"))).json()
    assert (again["applied"], again["item"]["box"]) == (False, 2)  # 只升一次
    await rate(client, h, "ability", "know")
    failed = (await ans(client, h, key="ability", mode="learn", qtype="meaning", choice="x")).json()
    assert (failed["correct"], failed["applied"], failed["item"]["box"]) == (False, True, 0)
    ability = await row(app, "ability")
    assert (ability.reps, ability.lapses, ability.last_reviewed_at) == (0, 1, None)
    assert [e[3] for e in await events(app)] == ["know_chk", "correct", "correct", "know_chk", "wrong"]
    assert [e[0] for e in await events(app)] == ["learn", "practice", "practice", "learn", "practice"]


async def test_fast_taps_are_always_checked(app, client, tmp_path):
    h = await login(app, client, tmp_path, wordbook_spot_check_pct=1)
    async with app.state.sessionmaker() as s:
        uid = await s.scalar(select(User.id).where(User.username == "alice"))
        await s.execute(update(WordbookEnrollment).values(seed=1))
        await s.commit()
    assert (await rate(client, h, "talk", "know", elapsed_ms=400))["spot_check"] is True
    slow = await rate(client, h, "ability", "know", elapsed_ms=5000)
    assert slow["spot_check"] is recall.spot_hit(1, uid, "ability", 0, 1)


async def test_no_checks_at_all_when_the_ratio_is_zero(app, client, tmp_path):
    h = await login(app, client, tmp_path, wordbook_spot_check_pct=0)
    assert (await rate(client, h, "talk", "know", elapsed_ms=10))["spot_check"] is False


async def test_a_round_quiz_miss_on_a_fuzzy_word_drops_it_without_a_review(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    await rate(client, h, "talk", "fuzzy")
    miss = (await ans(client, h, key="talk", mode="learn", qtype="meaning", choice="x")).json()
    assert (miss["applied"], miss["item"]["box"]) == (True, 0)
    hit = (await ans(client, h, key="talk", mode="learn", qtype="word", choice="talk")).json()
    assert (hit["correct"], hit["applied"], hit["item"]["box"]) == (True, False, 0)  # 答对也不回升
    talk = await row(app, "talk")
    assert (talk.reps, talk.last_reviewed_at) == (0, None)


async def test_rerating_the_same_day_only_lowers(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    await rate(client, h, "talk", "know")
    down = await rate(client, h, "talk", "unknown")
    assert (down["rating"], down["applied"], down["item"]["box"]) == ("unknown", True, 0)
    up = await rate(client, h, "talk", "know")
    assert (up["applied"], up["item"]["box"]) == (False, 0)
    assert [e[0] for e in await events(app)] == ["learn", "practice", "practice"]
    today = (await client.get(f"{URL}/today", headers=h, params={"tz_offset_minutes": 480})).json()
    assert today["plan"]["new_done"] == 1


async def test_known_alias_goes_through_the_spot_check(app, client, tmp_path):
    h = await login(app, client, tmp_path, wordbook_spot_check_pct=100)
    r = (await ans(client, h, key="talk", mode="learn", qtype="meaning", known=True)).json()
    assert (r["outcome"], r["rating"], r["spot_check"], r["item"]["box"]) == ("know", "know", True, 1)
    bad = await ans(client, h, key="talk", mode="review", qtype="meaning", known=True)
    assert bad.status_code == 422


async def test_recall_needs_a_rating(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    r = await ans(client, h, key="talk", mode="learn", qtype="recall")
    assert r.status_code == 422 and r.json() == {"error": "Rating is required"}
    r = await ans(client, h, key="talk", mode="learn", qtype="recall", rating="maybe")
    assert r.status_code == 422
    r = await ans(client, h, key="talk", mode="learn", qtype="recall", rating="know", elapsed_ms=-1)
    assert r.status_code == 422


async def test_learn_batch_carries_a_word_drill_per_card(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    batch = (await client.post(f"{URL}/learn/batch", headers=h, json={"size": 2})).json()
    assert [q["qtype"] for q in batch["drill"]] == ["word", "word"]
    assert [q["key"] for q in batch["drill"]] == [c["key"] for c in batch["cards"]]
    assert "talk" in batch["drill"][0]["options"]
```

`server/tests/test_wordbook_learn.py` 里 v1 「我认识」的断言改为新的 outcome 文本(盒子仍是 2,因为夹具默认不抽查):

```python
    assert known["outcome"] == "know" and known["item"]["box"] == 2
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd server && uv run pytest -q tests/test_wordbook_recall_api.py` → 422(`qtype` 不认识 `recall`)等。

- [ ] **Step 3: 实现**

`server/app/wordbook/store.py`:import 改为 `from datetime import datetime, timedelta` 与 `from app.services.vocabulary import INTERVAL_DAYS, MAX_EXAMPLE, MAX_MEANING`;文件末尾追加:

```python
# ---- 背单词 v2 · 三档自评(设计文档 2026-10-11-wordbook-recall §5)----

RECALL_QTYPE = "recall"
_RATING_OUTCOMES = ("know", "know_chk", "fuzzy", "unknown")


async def last_rating(session: AsyncSession, user_id: int, word: str) -> str | None:
    """该用户该词最近一条自评事件的 outcome(任何书、任何一天);没有 → None。"""
    return await session.scalar(select(WordbookEvent.outcome).where(
        WordbookEvent.user_id == user_id, WordbookEvent.word == word, WordbookEvent.qtype == RECALL_QTYPE,
        WordbookEvent.outcome.in_(_RATING_OUTCOMES)).order_by(WordbookEvent.id.desc()).limit(1))


async def first_rating_on(session: AsyncSession, user_id: int, word: str, day: str) -> str | None:
    """该词在这个本地日的第一条自评事件的 outcome(决定当天小测的抽查规则);没有 → None。"""
    return await session.scalar(select(WordbookEvent.outcome).where(
        WordbookEvent.user_id == user_id, WordbookEvent.word == word, WordbookEvent.qtype == RECALL_QTYPE,
        WordbookEvent.day == day, WordbookEvent.outcome.in_(_RATING_OUTCOMES)).order_by(WordbookEvent.id).limit(1))


async def set_learn_box(session: AsyncSession, user_id: int, item_id: str, *, seen_box: int, to_box: int,
                        now: datetime) -> bool:
    """当天新词的盒子调整(抽查通过 / 小测答错 / 当天再评):不是一次复习 —— 不加 reps、不写 last_reviewed_at,
    所以不产生 vocab_review。乐观条件 reps = 0 且 box = 读到的值;降级时 lapses + 1。不提交。"""
    result = await session.execute(
        update_(VocabularyItem)
        .where(VocabularyItem.id == item_id, VocabularyItem.user_id == user_id, VocabularyItem.reps == 0,
               VocabularyItem.box == seen_box)
        .values(box=to_box, due_at=now + timedelta(days=INTERVAL_DAYS[to_box]),
                lapses=VocabularyItem.lapses + (1 if to_box < seen_box else 0))
        .execution_options(synchronize_session=False))
    return result.rowcount == 1
```

`server/app/wordbook/service.py`:
1. import:`from dataclasses import asdict, dataclass, replace`;`from app.services.vocabulary import INTERVAL_DAYS, apply_lapse, apply_review`;`from app.wordbook import recall, store`(替换 `from app.wordbook import store`)。
2. 错误表追加 `RATING_REQUIRED = (422, "Rating is required")`。
3. 删除 `KNOWN_BOX, KNOWN_DUE = 2, timedelta(days=4)`(盒子改由 `recall.LEARN_BOX` 决定)。
4. `AnswerInput` 在 `offset: int` 之后追加:

```python
    rating: str | None = None          # 背单词 v2(spec recall §9.1):know | fuzzy | unknown
    revealed_before: bool = False
    elapsed_ms: int | None = None
```

5. `learn_batch` 的返回改为:

```python
    quiz = [question_out(await _question(ds, index, c, "meaning", question_rng(user_id, c.key, 0))) for c in cards]
    # spec recall §3.3:「不认识」的词在本轮小测里第二次出现时用看释义选词(随机源与 quiz 不同)
    drill = [question_out(await _question(ds, index, c, "word", question_rng(user_id, c.key, 1))) for c in cards]
    return {"book_id": e.book_id, "cards": [card_out(c) for c in cards], "quiz": quiz, "drill": drill}
```

6. `_validate` 在 `if p.known:` 分支之后加:

```python
    elif p.qtype == recall.RECALL_QTYPE:
        if p.rating not in recall.RATINGS:
            fail(RATING_REQUIRED)
```

7. `answer()`:`_validate(p)` 之后加 `known` 别名;作答上限之后分派自评;v1 选择题路径删去 `known` 分支;响应改用 `_answer_out`;学新词模式下行已存在时走 `_learn_day_quiz`。完整的 `answer()` 尾部与新增函数:

```python
    book_or_fail(settings, p.book_id)
    _validate(p)
    if p.known:  # R-R7:v1 的「我认识」= 没偷看的「认识」,同样受抽查规则约束
        p = replace(p, qtype=recall.RECALL_QTYPE, rating="know", revealed_before=False, elapsed_ms=None, known=False)
    await ensure_hidden(session, ds)  # review m5:create_item 会复制例句,先载入屏蔽集合
    # …(读卡、learning 校验与 v1 相同)…
    if (p.mode == "review" and row is not None and row.due_at <= now
            and p.qtype not in _allowed_qtypes(user_id, row, card, recall_on=settings.wordbook_recall_enabled)):
        fail(QTYPE_MISMATCH)
    if not await store.consume_answer(session, user_id, utc_day(now)):
        fail(ANSWER_LIMIT)
    if p.qtype == recall.RECALL_QTYPE:
        return await _rating_answer(session, ds, user_id, settings, p, card, row, learning, now)
    diff = None
    if p.qtype in CHOICE_QTYPES:
        outcome = "correct" if check_choice(p.qtype, card, p.choice) else "wrong"
        credit = 100 if outcome == "correct" else 0
    else:
        result = grade_blank(card.word, card.key, p.typed, hinted=p.hinted)
        outcome, credit = result.outcome, result.credit
        diff = [asdict(d) for d in result.diff] or None
    grade = srs_grade(outcome, p.hinted)
    applied, item_id, kind = False, row.item_id if row else None, "practice"
    if learning:
        box, due = 0, now + LEARN_DUE
        # …(v1 建行、learn/practice、cursor 不变)…
    elif p.mode == "review" and row is not None:
        applied, due = await _write_srs(session, user_id, row, grade, now)
        kind = "review" if due and applied else "practice"
    elif p.mode == "learn" and row is not None and row.reps == 0 and p.qtype in CHOICE_QTYPES:
        applied = await _learn_day_quiz(session, user_id, row, card.key, day, outcome == "correct", now)
    await store.add_event(session, user_id=user_id, book_id=p.book_id, kind=kind, word=card.key, item_id=item_id,
                          qtype=p.qtype, outcome=outcome, credit=credit, day=day, now=now)
    await session.commit()
    # Ruling Z-e:expected = 词头;correct_option = 选择题正确项原文(打字题为 null)
    option = correct_option(p.qtype, card) if p.qtype in CHOICE_QTYPES else None
    return _answer_out(outcome == "correct", outcome, grade, card, option, diff,
                       await store.known_one(session, user_id, card.key), applied)


def _answer_out(correct: bool, outcome: str, grade: str | None, card: WordCard, option: str | None, diff,
                known: Known | None, applied: bool, *, rating: str | None = None, spot_check: bool = False,
                check: dict | None = None) -> dict:
    """/answers 的响应。spec recall §9.1 追加 rating / spot_check / check(非自评题为 null / false / null)。"""
    return {"correct": correct, "outcome": outcome, "grade": grade, "expected": card.word, "correct_option": option,
            "diff": diff, "item": item_out(known), "applied": applied, "rating": rating, "spot_check": spot_check,
            "check": check}


async def _learn_day_quiz(session: AsyncSession, user_id: int, row: Known, key: str, day: str, correct: bool,
                          now) -> bool:
    """spec recall §5.4:当天自评过的新词(reps = 0)在本轮小测里答错 → 盒 0;抽查(know_chk)答对 → 盒 2。
    不是复习:不加 reps,不产生段位事件。当天没有自评(从生词本加入的词、昨天学的词)→ 不改。"""
    first = await store.first_rating_on(session, user_id, key, day)
    target = recall.learn_quiz_target(row.box, first, correct) if first else None
    if target is None:
        return False
    return await store.set_learn_box(session, user_id, row.item_id, seen_box=row.box, to_box=target, now=now)


async def _rating_answer(session: AsyncSession, ds: DictionaryStore, user_id: int, settings: Settings,
                         p: AnswerInput, card: WordCard, row: Known | None, learning: bool, now) -> dict:
    """三档自评(spec recall §5):有效评级 → 学新词建行 / 当天再评只降 / 复习 good·hard·forgot,抽查两步。"""
    day = local_day(now, p.offset)
    rating = recall.effective_rating(p.rating, revealed_before=p.revealed_before,
                                     previous=await store.last_rating(session, user_id, card.key))
    enrollment = await store.get_enrollment(session, user_id, p.book_id)
    seed = enrollment.seed if enrollment is not None else 0  # 私有种子:客户端算不出哪些词会被抽查(P-R1)
    pct = settings.wordbook_spot_check_pct
    applied, item_id, kind, outcome, spot = False, row.item_id if row else None, "practice", rating, False
    if learning:
        decision = recall.learn_decision(rating, recall.needs_check(
            rating, seed=seed, user_id=user_id, key=card.key, reps=0, pct=pct, elapsed_ms=p.elapsed_ms))
        item_id = await _create_learned(session, ds, user_id, p.book_id, card, decision.box, now)
        kind = "practice" if await store.ever_learned(session, user_id, card.key) else "learn"
        applied, outcome, spot = True, decision.outcome, decision.spot_check
    elif p.mode == "learn" and row is not None:
        if row.reps == 0 and await store.first_rating_on(session, user_id, card.key, day):
            target = recall.learn_rerate_target(row.box, rating)
            if target is not None:
                applied = await store.set_learn_box(session, user_id, row.item_id, seen_box=row.box, to_box=target,
                                                    now=now)
    elif p.mode == "review" and row is not None:
        due = row.due_at <= now
        if rating == "know" and p.choice is not None:  # 抽查的第二步:按选释义判
            outcome = "know" if check_choice("meaning", card, p.choice) else "unknown"
        elif due and recall.needs_check(rating, seed=seed, user_id=user_id, key=card.key, reps=row.reps, pct=pct,
                                        elapsed_ms=p.elapsed_ms):
            index = await index_or_fail(ds, p.book_id)
            q = await _question(ds, index, card, "meaning", question_rng(user_id, card.key, row.reps))
            await session.commit()  # 只扣了作答次数;不写盒、不记事件(R-R6)
            return _answer_out(False, "pending", None, card, None, None, row, False, rating="know", spot_check=True,
                               check=question_out(q))
        applied, due = await _write_srs(session, user_id, row, recall.GRADE[recall.as_rating(outcome)], now)
        kind = "review" if due and applied else "practice"
    eff = recall.as_rating(outcome)
    await store.add_event(session, user_id=user_id, book_id=p.book_id, kind=kind, word=card.key, item_id=item_id,
                          qtype=recall.RECALL_QTYPE, outcome=outcome, credit=100 if eff == "know" else 0, day=day,
                          now=now)
    await session.commit()
    checked = p.mode == "review" and p.choice is not None and rating == "know"
    return _answer_out(eff == "know", eff, recall.GRADE[eff], card, correct_option("meaning", card) if checked else None,
                       None, await store.known_one(session, user_id, card.key), applied, rating=eff, spot_check=spot)


async def _create_learned(session: AsyncSession, ds: DictionaryStore, user_id: int, book_id: str, card: WordCard,
                          box: int, now) -> str:
    """新词建行并推进 cursor(与 v1 学新词同一套:cursor 只在真正建行时前进)。"""
    e = await store.active_enrollment(session, user_id)
    index = await index_or_fail(ds, book_id)
    item_id = await store.create_item(session, user_id, book_id, card, box=box,
                                      due_at=now + timedelta(days=INTERVAL_DAYS[box]), now=now)
    known = await store.known_words(session, user_id)
    order = planning.permutation(len(index), e.seed, e.order_mode)
    _, cursor = planning.next_new(index.keys, order, e.cursor, known, 0)
    await store.set_cursor(session, user_id, book_id, cursor)
    return item_id
```

(`learning` 为真时 v1 的前置校验已经保证有当前在学的书且 `new_left > 0`,所以 `_create_learned` 里的 `e` 不会是 None。)

`server/app/routers/wordbook.py` 的 `AnswerIn`:`qtype: Literal["meaning", "word", "cloze", "dictation", "spell", "recall"]`,类体末尾追加:

```python
    rating: Literal["know", "fuzzy", "unknown"] | None = None  # spec recall §9.1
    revealed_before: bool = False
    elapsed_ms: int | None = Field(None, ge=0, le=600_000)
```

`wordbook_answer` 构造 `AnswerInput` 时末尾追加 `payload.rating, payload.revealed_before, payload.elapsed_ms`。

- [ ] **Step 4: 跑测试确认通过** — Run: `cd server && uv run pytest -q tests/test_wordbook_recall_api.py tests/test_wordbook_learn.py tests/test_wordbook_learn_limits.py tests/test_wordbook_rank_abuse.py tests/test_rank_wordbook.py tests/test_wordbook_spell.py tests/test_architecture.py`。

- [ ] **Step 5: 提交** — `feat(server): wordbook three-way self-rating for new words (server-decided boxes, spot check)`。

### Task S5: 复习快速回忆的抽查两步、连续模糊、记错了

**Files:**
- Test: `server/tests/test_wordbook_recall_api.py`(追加);实现已在 S4 的 `_rating_answer` 里,本任务只补规则测试并修正实跑发现的问题

**Interfaces:**
- Consumes:S3 `use_recall`、S4 `_rating_answer`
- Produces:§5.5 每一行的回归测试

- [ ] **Step 1: 写测试** — 追加:

```python
async def test_two_fuzzy_in_a_row_count_as_unknown(app, client, tmp_path, monkeypatch):
    always_recall(monkeypatch)
    h = await login(app, client, tmp_path)
    await rate(client, h, "talk", "fuzzy")
    await make_due(app, "talk")
    second = await rate(client, h, "talk", "fuzzy", mode="review")
    assert (second["rating"], second["grade"], second["item"]["box"]) == ("unknown", "forgot", 0)
    third = await rate(client, h, "talk", "fuzzy", mode="review")  # 未到期;上一条已记为 unknown,不再连续
    assert (third["rating"], third["applied"]) == ("fuzzy", False)


async def test_review_spot_check_is_two_steps(app, client, tmp_path, monkeypatch):
    always_recall(monkeypatch)
    h = await login(app, client, tmp_path, wordbook_spot_check_pct=100)
    await rate(client, h, "talk", "fuzzy")
    await rate(client, h, "ability", "fuzzy")
    for key in ("talk", "ability"):
        await make_due(app, key)
    before = len(await events(app))
    pending = await rate(client, h, "talk", "know", mode="review")
    assert (pending["outcome"], pending["grade"], pending["applied"], pending["spot_check"]) == (
        "pending", None, False, True)
    assert pending["check"]["qtype"] == "meaning" and len(pending["check"]["options"]) == 4
    assert await meaning(app, "talk") in pending["check"]["options"]
    assert len(await events(app)) == before and (await row(app, "talk")).reps == 0  # 不写盒、不记事件
    passed = await rate(client, h, "talk", "know", mode="review", choice=await meaning(app, "talk"))
    assert (passed["outcome"], passed["grade"], passed["item"]["box"]) == ("know", "good", 2)
    assert passed["correct_option"] == await meaning(app, "talk")
    failed = await rate(client, h, "ability", "know", mode="review", choice="x")
    assert (failed["outcome"], failed["rating"], failed["grade"], failed["item"]["box"]) == (
        "unknown", "unknown", "forgot", 0)


async def test_i_was_wrong_after_a_review_lapses_without_reps(app, client, tmp_path, monkeypatch):
    always_recall(monkeypatch)
    h = await login(app, client, tmp_path)
    await rate(client, h, "talk", "fuzzy")
    await make_due(app, "talk")
    await rate(client, h, "talk", "know", mode="review")  # good → 盒 2,reps 1
    oops = await rate(client, h, "talk", "unknown", mode="review")  # 未到期的「不认识」= apply_lapse
    assert (oops["applied"], oops["item"]["box"]) == (True, 0)
    talk = await row(app, "talk")
    assert (talk.reps, talk.lapses) == (1, 1)
    assert [e[0] for e in await events(app)] == ["learn", "review", "practice"]
```

- [ ] **Step 2: 跑测试** — Run: `cd server && uv run pytest -q tests/test_wordbook_recall_api.py tests/test_wordbook_recall.py`(实跑:27 passed;若有失败,修实现,不改断言里的规则)。

- [ ] **Step 3: 提交** — `test(server): quick-recall spot check, fuzzy streak and self-correction rules`。

### Task S6: 契约样例重录

**Files:**
- Modify: `server/tests/test_wordbook_contract.py`、`server/tests/fixtures/wordbook_contract.json`(重录)

**Interfaces:**
- Produces:契约新键 `answer_recall`(学新词自评,`rating:"fuzzy"`)、`answer_check`(复习抽查 pending + `check`);`learn_batch.drill`、`config.learn` 与所有 answer 样例的 `rating`/`spot_check`/`check` 进入形状

- [ ] **Step 1: 改录制** — `KEYS` 追加 `"answer_recall", "answer_check"`;`from app.wordbook import service`;`collect(app, client, tmp_path, monkeypatch)`(测试函数里传入 `monkeypatch`);在 `out["card"] = …` 之前插入:

```python
    # 背单词 v2(spec 2026-10-11-wordbook-recall §9):学新词自评;复习快速回忆的抽查待答(pending + check)
    out["answer_recall"] = (await client.post(f"{URL}/answers", headers=h, json={
        "book_id": "junior", "key": "accept", "mode": "learn", "qtype": "recall", "rating": "fuzzy",
        "revealed_before": False, "elapsed_ms": 2400})).json()
    monkeypatch.setattr(service, "use_recall", lambda user_id, key, reps, box: True)
    app.state.settings = app.state.settings.model_copy(update={"wordbook_spot_check_pct": 100})
    async with app.state.sessionmaker() as s:
        await s.execute(update(VocabularyItem).where(VocabularyItem.word == "ability")
                        .values(due_at=utcnow() - timedelta(hours=1)))
        await s.commit()
    out["answer_check"] = (await client.post(f"{URL}/answers", headers=h, json={
        "book_id": "junior", "key": "ability", "mode": "review", "qtype": "recall", "rating": "know"})).json()
```

断言段追加 `assert expected["answer_check"]["outcome"] == "pending" and expected["answer_check"]["check"]["options"]`,非空列表检查加 `("learn_batch", "drill")`。

- [ ] **Step 2: 重录并复跑** — Run(PowerShell):`cd server; $env:CONTRACT_UPDATE=1; uv run pytest -q tests/test_wordbook_contract.py; Remove-Item Env:CONTRACT_UPDATE; uv run pytest -q tests/test_wordbook_contract.py` → 两次都通过。检查样例里没有令牌与本机路径(测试已断言)。

- [ ] **Step 3: 全量** — Run: `cd server && uv run pytest -q`(约 2.5 分钟)。

- [ ] **Step 4: 提交** — `test(server): re-record the wordbook contract with recall payloads`。

---

## Web lane (W)

### Task W1: `wordbook-api.ts` 类型与调用(只追加)

**Files:**
- Modify: `web/src/features/wordbook/wordbook-api.ts`、`web/src/features/wordbook/test-fixtures.ts`、`web/src/features/wordbook/wordbook-api.test.ts`(追加一个用例)

**Interfaces:**
- Produces:`QType` 含 `"recall"`;`Rating`;`AnswerInput.rating?/revealedBefore?/elapsedMs?`;`AnswerResult.rating/spotCheck/check`、`outcome` 含 `Rating | "pending"`、`grade: Grade | null`;`WordbookConfig.learn`;`learnBatch` 返回 `drill`;`reviewBatch(api, size = 20, opts: { recall?: boolean } = {})`;`WORDBOOK_SERVER_ERRORS["Rating is required"]`

- [ ] **Step 1: 写失败测试** — 追加到 `wordbook-api.test.ts`(沿用该文件已有的 `createFetchMock` 写法):

```ts
it("asks for quick recall only when told to and sends ratings as snake_case", async () => {
  const mock = createFetchMock({
    "POST /api/wordbook/review/batch": () => json({ book_id: "cet4", questions: [], cards: [] }),
    "POST /api/wordbook/answers": () => json({ correct: true, outcome: "know", grade: "good", expected: "talk", correct_option: null, diff: null, item: { box: 2, due_at: "x" }, applied: true, rating: "know", spot_check: false, check: null }),
  });
  const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
  await reviewBatch(api, 20, { recall: true });
  await reviewBatch(api);
  const bodies = mock.calls.map((c) => JSON.parse(String(c.body)) as Record<string, unknown>);
  expect(bodies[0]).toMatchObject({ size: 20, recall: true });
  expect(bodies[1]).not.toHaveProperty("recall");
  const res = await submitAnswer(api, { bookId: "cet4", key: "talk", mode: "learn", qtype: "recall", rating: "know", revealedBefore: false, elapsedMs: 2400 });
  expect(JSON.parse(String(mock.calls[2].body))).toMatchObject({ qtype: "recall", rating: "know", revealed_before: false, elapsed_ms: 2400 });
  expect(res.spotCheck).toBe(false);
});
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/wordbook/wordbook-api.test.ts`(类型错误 / `recall` 未发送)。

- [ ] **Step 3: 实现**(只追加)

```ts
export type QType = "meaning" | "word" | "cloze" | "dictation" | "spell" | "recall";
// Question 定义之后:
/** 三档自评(spec 2026-10-11-wordbook-recall):盒子由服务端决定。 */
export type Rating = "know" | "fuzzy" | "unknown";
// WordbookConfig 的 enabled 分支追加:
//   learn: { autoplay: boolean; showExample: boolean }
export interface AnswerInput {
  bookId: BookId; key: string; mode: "learn" | "review"; qtype: QType; choice?: string; typed?: string; hinted?: boolean; known?: boolean;
  rating?: Rating; revealedBefore?: boolean; elapsedMs?: number;
}
/** `expected` = 词头;`correctOption` = 选择题正确项原文;自评题:`rating` = 有效评级,`spotCheck` = 本轮要抽查(学新词),
 *  `check` = 复习抽查题(`outcome:"pending"` 时先答它)。 */
export interface AnswerResult {
  correct: boolean; outcome: Outcome | "known" | Rating | "pending"; grade: Grade | null; expected: string; correctOption: string | null;
  diff: DiffOp[] | null; item: ItemState | null; applied: boolean; rating: Rating | null; spotCheck: boolean; check: Question | null;
}
// WORDBOOK_SERVER_ERRORS 末尾追加:
//   "Rating is required": "web.wordbook.recall.errors.ratingRequired",
export const learnBatch = (api: ApiClient, size = 5) =>
  api.request<{ bookId: BookId; cards: Card[]; quiz: Question[]; drill: Question[] }>("POST", "/api/wordbook/learn/batch", {
    json: { size, ...tz() },
  });
export const reviewBatch = async (
  api: ApiClient,
  size = 20,
  opts: { recall?: boolean } = {},
): Promise<{ bookId: BookId; questions: Question[]; cards: Record<string, Card> }> => {
  const res = await api.request<{ bookId: BookId; questions: Question[]; cards: Card[] }>(
    "POST", "/api/wordbook/review/batch", { json: { size, ...(opts.recall ? { recall: true } : {}), ...tz() } },
  );
  return { ...res, cards: Object.fromEntries((res.cards ?? []).map((card) => [card.key, card])) };
};
```

`test-fixtures.ts` 的 `CONFIG` 追加 `learn: { autoplay: true, show_example: true }`。`review-page.tsx` 里 `enteredMastered` 用到 `r.grade === "good"`,`grade` 可为 null 不影响。

- [ ] **Step 4: 跑测试** — `yarn web:typecheck && cd web && yarn vitest run src/features/wordbook`。

- [ ] **Step 5: 提交** — `feat(web): wordbook recall API types (additive)`。

### Task W2: 会话机 — 卡片 reducer、本轮小测排队、小结计数

**Files:**
- Modify: `web/src/features/wordbook/session-machine.ts`(末尾追加)、`web/src/features/wordbook/session-machine.test.ts`(追加)

**Interfaces:**
- Produces:`Rating`(从 `wordbook-api.ts` 同名类型保持一致:`"know" | "fuzzy" | "unknown"`)、`CardState`、`CardAction`、`MAX_ELAPSED_MS`、`startCard(at)`、`cardReducer(s, a)`、`ratingPayload(s, rating, now)`、`RatedWord`、`SlotQType`、`QuizSlot`、`slotId(key, qtype)`、`slotKey(id)`、`planLearnQuiz(rated)`、`learnTally(rated, firstTry)`

- [ ] **Step 1: 写失败测试** — 追加到 `session-machine.test.ts`:

```ts
import { cardReducer, learnTally, planLearnQuiz, ratingPayload, slotId, slotKey, startCard, type RatedWord } from "./session-machine";

describe("new-word card (spec recall §3)", () => {
  it("a peek before rating is remembered; rating reveals; a second rating is ignored", () => {
    let c = cardReducer(startCard(1000), { type: "reveal" });
    expect(c).toEqual({ revealed: true, peeked: true, rating: null, shownAt: 1000 });
    expect(ratingPayload(c, "know", 3500.4)).toEqual({ rating: "know", revealedBefore: true, elapsedMs: 2500 });
    c = cardReducer(c, { type: "rated", rating: "fuzzy" });
    expect(c.rating).toBe("fuzzy");
    expect(cardReducer(c, { type: "rated", rating: "know" })).toBe(c);
  });

  it("rating without a peek reveals the card but is not a peek", () => {
    const d = cardReducer(startCard(0), { type: "rated", rating: "unknown" });
    expect(d).toEqual({ revealed: true, peeked: false, rating: "unknown", shownAt: 0 });
    expect(cardReducer(d, { type: "reveal" })).toBe(d);
    expect(cardReducer(d, { type: "reset", at: 5 })).toEqual(startCard(5));
  });

  it("「记错了」 turns a rated card into unknown and does nothing before rating", () => {
    expect(cardReducer(startCard(0), { type: "corrected" }).rating).toBeNull();
    expect(cardReducer(cardReducer(startCard(0), { type: "rated", rating: "know" }), { type: "corrected" }).rating).toBe("unknown");
  });

  it("clamps the elapsed time", () => {
    expect(ratingPayload(startCard(10), "know", 5).elapsedMs).toBe(0);
    expect(ratingPayload(startCard(0), "know", 10_000_000).elapsedMs).toBe(600_000);
  });
});

describe("round quiz plan (spec recall §3.3)", () => {
  const rated: RatedWord[] = [
    { key: "talk", rating: "know", spotCheck: false }, { key: "used to", rating: "unknown", spotCheck: false },
    { key: "able", rating: "fuzzy", spotCheck: false }, { key: "absorb", rating: "know", spotCheck: true },
    { key: "abandon", rating: "fuzzy", spotCheck: false },
  ];

  it("fuzzy first, unknown twice, spot-checked know once, plain know never", () => {
    expect(planLearnQuiz(rated).map((s) => s.id)).toEqual(["meaning:able", "meaning:abandon", "meaning:used to", "meaning:absorb", "word:used to"]);
    expect(slotKey(slotId("a:b", "word"))).toBe("a:b");
  });

  it("tallies ratings, checks and first-try words", () => {
    let s = startSession(planLearnQuiz(rated).map((p) => p.id));
    for (const ok of [true, false, true, true, true, true]) s = answerCurrent(s, ok);
    expect(isFinished(s)).toBe(true);
    expect(learnTally(rated, s.firstTry)).toEqual({
      ratings: { know: 2, fuzzy: 2, unknown: 1 }, checks: { total: 1, passed: 1 }, firstTry: 4, missed: ["abandon"],
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/wordbook/session-machine.test.ts`。

- [ ] **Step 3: 实现** — 追加到 `session-machine.ts`(写计划时用 Node 24 实跑通过):

```ts
// ---- 背单词 v2:三档自评与本轮小测(spec 2026-10-11-wordbook-recall §3)----

export type Rating = "know" | "fuzzy" | "unknown";
/** 一张新词卡的界面状态:是否翻开、自评前是否偷看、自评结果(服务端返回的有效评级)、出现时刻(ms)。 */
export interface CardState { revealed: boolean; peeked: boolean; rating: Rating | null; shownAt: number }
export type CardAction =
  | { type: "reveal" }
  | { type: "rated"; rating: Rating }
  | { type: "corrected" }
  | { type: "reset"; at: number };

export const MAX_ELAPSED_MS = 600_000;

export function startCard(at: number): CardState {
  return { revealed: false, peeked: false, rating: null, shownAt: at };
}

export function cardReducer(s: CardState, a: CardAction): CardState {
  switch (a.type) {
    case "reveal":
      return s.revealed ? s : { ...s, revealed: true, peeked: s.rating === null };
    case "rated":
      return s.rating !== null ? s : { ...s, rating: a.rating, revealed: true };
    case "corrected": // 「记错了」:已自评的卡改为不认识(服务端只降不升)
      return s.rating === null ? s : { ...s, rating: "unknown" };
    case "reset":
      return startCard(a.at);
  }
}

/** 自评请求体:按下的键 + 自评前是否偷看 + 用时(夹到 0–600000 ms)。盒子由服务端决定。 */
export function ratingPayload(s: CardState, rating: Rating, now: number) {
  const elapsed = Math.round(now - s.shownAt);
  return { rating, revealedBefore: s.peeked, elapsedMs: Math.min(MAX_ELAPSED_MS, Math.max(0, Number.isFinite(elapsed) ? elapsed : 0)) };
}

export interface RatedWord { key: string; rating: Rating; spotCheck: boolean }
export type SlotQType = "meaning" | "word";
export interface QuizSlot { id: string; key: string; qtype: SlotQType }

export const slotId = (key: string, qtype: SlotQType) => `${qtype}:${key}`;
/** slotId 的逆:词本身可能含冒号,只按第一个冒号切。 */
export const slotKey = (id: string) => id.slice(id.indexOf(":") + 1);

/** 本轮小测排队:模糊 → 不认识(选释义)→ 抽中的认识 → 不认识第二次(看释义选词);没抽中的认识不考。 */
export function planLearnQuiz(rated: RatedWord[]): QuizSlot[] {
  const slot = (w: RatedWord, qtype: SlotQType): QuizSlot => ({ id: slotId(w.key, qtype), key: w.key, qtype });
  const of = (r: Rating) => rated.filter((w) => w.rating === r);
  return [
    ...of("fuzzy").map((w) => slot(w, "meaning")),
    ...of("unknown").map((w) => slot(w, "meaning")),
    ...of("know").filter((w) => w.spotCheck).map((w) => slot(w, "meaning")),
    ...of("unknown").map((w) => slot(w, "word")),
  ];
}

/** 小结计数:各评级词数、抽查数与通过数、「一次答对」(没抽中的认识 + 所有小测题都一次答对的词)。 */
export function learnTally(rated: RatedWord[], firstTry: Record<string, boolean>) {
  const ratings: Record<Rating, number> = { know: 0, fuzzy: 0, unknown: 0 };
  for (const w of rated) ratings[w.rating] += 1;
  const byKey: Record<string, boolean[]> = {};
  for (const [id, ok] of Object.entries(firstTry)) (byKey[slotKey(id)] ??= []).push(ok);
  const checked = rated.filter((w) => w.rating === "know" && w.spotCheck);
  const passed = checked.filter((w) => firstTry[slotId(w.key, "meaning")] === true).length;
  const clean = rated.filter((w) => (w.rating === "know" && !w.spotCheck) || (byKey[w.key]?.length && byKey[w.key].every(Boolean))).length;
  const missed = rated.filter((w) => byKey[w.key]?.some((ok) => !ok)).map((w) => w.key);
  return { ratings, checks: { total: checked.length, passed }, firstTry: clean, missed };
}
```

- [ ] **Step 4: 跑测试** — `cd web && yarn vitest run src/features/wordbook/session-machine.test.ts`。
- [ ] **Step 5: 提交** — `feat(web): wordbook card reducer and round quiz plan`。

### Task W3: 遮罩、自评条、评级徽标与 `WordCardView` 属性

**Files:**
- Create: `web/src/features/wordbook/recall-cover.tsx`、`web/src/features/wordbook/recall-rating-bar.tsx`
- Modify: `web/src/features/wordbook/word-card.tsx`、`web/src/features/wordbook/i18n/{zh-CN,en}.json`
- Test: `web/src/features/wordbook/recall-cover.test.tsx`

**Interfaces:**
- Produces:`RecallCover({ controls, onReveal })`;`RecallRatingBar({ onRate, busy, peeked })`;`RatingBadge({ rating, check? })`;`WordCardView` 追加可选 `covered?: boolean`、`onReveal?: () => void`、`showExample?: boolean`(默认 true)、`badge?: ReactNode`、`regionRef?: Ref<HTMLDivElement>` —— 都不传时渲染与 v1 相同

- [ ] **Step 1: 写失败测试** — `recall-cover.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import { renderWithProviders } from "~/test/render";
import { RecallRatingBar } from "./recall-rating-bar";
import { card } from "./test-fixtures";
import { WordCardView } from "./word-card";
import type { Card } from "./wordbook-api";

const TALK = card("talk", { senses: [{ pos: "v", text: "说话；谈话" }] }) as unknown as Card;

beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); void i18n.changeLanguage("zh-CN"); });
afterEach(() => { localStorage.removeItem("enjoy-web.settings"); void i18n.changeLanguage("en"); });

describe("covered word card (spec recall §3.1)", () => {
  it("keeps the meaning out of the DOM until the cover button is pressed", async () => {
    const onReveal = vi.fn();
    renderWithProviders(<WordCardView card={TALK} covered onReveal={onReveal} />);
    const cover = screen.getByRole("button", { name: /显示释义/ });
    expect(cover).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById(cover.getAttribute("aria-controls") ?? "")).not.toBeNull();
    expect(screen.getByTestId("word-card")).not.toHaveTextContent("说话；谈话");
    expect(screen.getByTestId("word-card")).not.toHaveTextContent("They talk a lot.");
    await userEvent.setup().click(cover);
    expect(onReveal).toHaveBeenCalledOnce();
  });

  it("hides the example when showExample is off", () => {
    renderWithProviders(<WordCardView card={TALK} showExample={false} />);
    expect(screen.getByTestId("word-card")).toHaveTextContent("说话；谈话");
    expect(screen.getByTestId("word-card")).not.toHaveTextContent("They talk a lot.");
  });

  it("rating bar: three labelled buttons; the peek note describes 认识", async () => {
    const onRate = vi.fn();
    renderWithProviders(<RecallRatingBar onRate={onRate} busy={false} peeked />);
    const know = screen.getByRole("button", { name: "认识" });
    expect(know).toHaveAccessibleDescription("已看过释义:点「认识」会记为「模糊」");
    await userEvent.setup().click(screen.getByRole("button", { name: "模糊" }));
    expect(onRate).toHaveBeenCalledWith("fuzzy");
    expect(screen.getByRole("button", { name: "不认识" })).toBeEnabled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**。

- [ ] **Step 3: 实现**

`recall-cover.tsx`:

```tsx
import { EyeIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

/** 新词卡的释义遮罩(spec recall §3.1、视觉稿 01):真正的按钮,≥ 96px;遮罩时释义不在 DOM 里(不靠模糊或透明度)。 */
export function RecallCover({ controls, onReveal }: { controls: string; onReveal: () => void }) {
  const { t } = useTranslation();
  return (
    <button type="button" data-testid="recall-cover" aria-expanded={false} aria-controls={controls} onClick={onReveal}
      className="mt-3.5 flex min-h-[96px] w-full flex-col items-center justify-center gap-1 rounded-badge bg-surface-2 px-4 py-4 text-center transition-colors duration-fast active:bg-surface-2/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span className="inline-flex items-center gap-1.5 text-body font-semibold text-ink">
        <EyeIcon aria-hidden className="h-5 w-5" />{t("web.wordbook.learn.reveal")}
      </span>
      <span className="text-sub text-ink-2">{t("web.wordbook.learn.revealHint")}</span>
    </button>
  );
}
```

`recall-rating-bar.tsx`:

```tsx
import { CircleCheckIcon, CircleHelpIcon, CircleXIcon } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@renderer/lib/utils";
import type { Rating } from "./session-machine";
import { DOCK, GHOST, PRIMARY } from "./ui";

/** 三档自评操作条(学新词与快速回忆共用;视觉稿 01/03/06):不认识(中性)/ 模糊(琥珀图标)/ 认识(蓝主按钮),高 48px。 */
export function RecallRatingBar({ onRate, busy, peeked = false }: { onRate: (rating: Rating) => void; busy: boolean; peeked?: boolean }) {
  const { t } = useTranslation();
  const note = useId();
  return (
    <div className={cn(DOCK, "flex-col")}>
      {peeked ? <p id={note} className="px-1 text-meta text-ink-2">{t("web.wordbook.learn.peekedNote")}</p> : null}
      <div role="group" aria-label={t("web.wordbook.learn.rate.group")} className="flex gap-2">
        <button type="button" className={cn(GHOST, "h-12 flex-1 px-2")} disabled={busy} onClick={() => onRate("unknown")}>
          <CircleXIcon aria-hidden className="text-ink-2" />{t("web.wordbook.learn.rate.unknown")}
        </button>
        <button type="button" className={cn(GHOST, "h-12 flex-1 px-2")} disabled={busy} onClick={() => onRate("fuzzy")}>
          <CircleHelpIcon aria-hidden className="text-amber" />{t("web.wordbook.learn.rate.fuzzy")}
        </button>
        <button type="button" className={cn(PRIMARY, "h-12 flex-1 px-2")} disabled={busy} onClick={() => onRate("know")}
          aria-describedby={peeked ? note : undefined}>
          <CircleCheckIcon aria-hidden />{t("web.wordbook.learn.rate.know")}
        </button>
      </div>
    </div>
  );
}

const BADGE = "inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-[7px] px-2 text-meta font-semibold";
const TONE: Record<Rating, string> = { know: "bg-green-tint text-green", fuzzy: "bg-amber-tint text-amber", unknown: "bg-surface-2 text-ink-2" };

/** 自评结果徽标(文字 + 底色,不只靠颜色)。 */
export function RatingBadge({ rating, check = false }: { rating: Rating; check?: boolean }) {
  const { t } = useTranslation();
  return <span data-testid="rating-badge" className={cn(BADGE, TONE[rating])}>{t(check ? "web.wordbook.learn.badge.knowCheck" : `web.wordbook.learn.badge.${rating}`)}</span>;
}
```

`word-card.tsx`:`WordCardView` 的属性追加 `covered`、`onReveal`、`showExample = true`、`badge`、`regionRef`;`eyebrow` 那一行改为 `{eyebrow || badge ? <div className="flex items-center justify-between gap-2">{eyebrow ? <p className="eyebrow">{eyebrow}</p> : <span />}{badge}</div> : null}`;释义、例句、短语三块包进一个区域:

```tsx
      {covered ? (
        <>
          <RecallCover controls={regionId} onReveal={() => onReveal?.()} />
          <div id={regionId} hidden />
        </>
      ) : (
        <div id={regionId} ref={regionRef} tabIndex={-1} className="outline-none">
          {/* v1 的 senses <ul>、example 块(外加 showExample 条件)、phrases <details> 原样放这里 */}
        </div>
      )}
```

(`const regionId = useId();`,`import { RecallCover } from "./recall-cover";`;例句块条件由 `example ?` 改为 `showExample && example ?`。)

i18n(`web.wordbook.learn` 对象内追加;zh-CN / en):

```json
"reveal": "显示释义", "revealHint": "先在心里想一想,再点开核对",
"peekedNote": "已看过释义:点「认识」会记为「模糊」",
"rate": { "group": "你认识这个词吗?", "know": "认识", "fuzzy": "模糊", "unknown": "不认识" },
"rated": { "know": "已记为认识", "fuzzy": "已记为模糊", "unknown": "已记为不认识", "streak": "连续两次模糊,按不认识记" },
"badge": { "know": "认识", "knowCheck": "认识 · 本轮抽查", "fuzzy": "模糊", "unknown": "不认识" },
"iWasWrong": "记错了", "spotEyebrow": "抽查 · 你标了「认识」", "drillEyebrow": "再认一次"
```

```json
"reveal": "Show meaning", "revealHint": "Think of it first, then check",
"peekedNote": "You peeked: \"I know it\" will count as \"Not sure\"",
"rate": { "group": "Do you know this word?", "know": "I know it", "fuzzy": "Not sure", "unknown": "Don't know" },
"rated": { "know": "Marked as known", "fuzzy": "Marked as not sure", "unknown": "Marked as unknown", "streak": "Not sure twice in a row, counted as unknown" },
"badge": { "know": "Known", "knowCheck": "Known · checked this round", "fuzzy": "Not sure", "unknown": "Unknown" },
"iWasWrong": "I was wrong", "spotEyebrow": "Spot check · you said you know it", "drillEyebrow": "One more time"
```

删除不再使用的 `web.wordbook.learn.known`(两种语言)。

- [ ] **Step 4: 跑测试** — `cd web && yarn vitest run src/features/wordbook`(`i18n.test.ts` 检查中英键集合与占位符一致)。
- [ ] **Step 5: 提交** — `feat(web): wordbook meaning cover and self-rating bar`。

### Task W4: 学新词页新流程

**Files:**
- Modify: `web/src/features/wordbook/learn-page.tsx`、`web/src/features/wordbook/learn-page.test.tsx`(按新流程重写用例)

**Interfaces:**
- Consumes:W1–W3;`useWordbookConfig()` 的 `learn`
- Produces:`WordbookLearnPage`(导出名与路由不变)

- [ ] **Step 1: 重写测试** — `learn-page.test.tsx`:保留文件头(TTS mock、`TTS_ROUTES`、`setup`、`answers`、`beforeEach/afterEach`),`BATCH` 追加 `drill`,`answerRoute` 改为:

```ts
const BATCH = { /* v1 的 book_id / cards / quiz 不变 */ ...V1_BATCH,
  drill: [
    { key: "talk", qtype: "word", prompt: { meaning: "v. 说话；谈话；n. 交谈" }, options: ["accept", "talk", "carry", "stop"], length: null },
    { key: "accept", qtype: "word", prompt: { meaning: "vt. 接受；承认" }, options: ["talk", "accept", "carry", "stop"], length: null },
  ],
};
const SPOT: Record<string, boolean> = {};
function answerRoute(call: RecordedCall) {
  const body = JSON.parse(String(call.body)) as { key: string; qtype: string; choice?: string; rating?: string; revealed_before?: boolean };
  if (body.qtype === "recall") {
    const rating = body.rating === "know" && body.revealed_before ? "fuzzy" : body.rating;
    const box = { know: SPOT[body.key] ? 1 : 2, fuzzy: 1, unknown: 0 }[rating as "know"];
    return json({ correct: rating === "know", outcome: rating, grade: "good", expected: body.key, correct_option: null, diff: null,
      item: { box, due_at: "x" }, applied: true, rating, spot_check: rating === "know" && Boolean(SPOT[body.key]), check: null });
  }
  const ok = body.choice === CORRECT[body.key] || body.choice === body.key;
  return json({ correct: ok, outcome: ok ? "correct" : "wrong", grade: ok ? "good" : "forgot", expected: body.key,
    correct_option: body.qtype === "word" ? body.key : CORRECT[body.key], diff: null, item: { box: 0, due_at: "x" }, applied: true,
    rating: null, spot_check: false, check: null });
}
```

用例:

```tsx
it("covers the meaning, rates, reveals and quizzes fuzzy and unknown words", async () => {
  const user = userEvent.setup();
  const mock = setup();
  const first = await screen.findByTestId("word-card");
  expect(first).not.toHaveTextContent("说话；谈话");
  expect(screen.getByRole("button", { name: /显示释义/ })).toHaveAttribute("aria-expanded", "false");
  await user.click(screen.getByRole("button", { name: "模糊" }));
  await waitFor(() => expect(screen.getByTestId("word-card")).toHaveTextContent("说话；谈话"));
  expect(screen.getByTestId("rating-badge")).toHaveTextContent("模糊");
  expect(answers(mock)[0]).toMatchObject({ key: "talk", mode: "learn", qtype: "recall", rating: "fuzzy", revealed_before: false });
  expect(typeof answers(mock)[0].elapsed_ms).toBe("number");
  await user.click(screen.getByRole("button", { name: "下一个" }));
  await user.click(await screen.findByRole("button", { name: "不认识" }));
  expect(play).toHaveBeenCalledWith(expect.any(String), "accept", "openai/tts-1", expect.any(String)); // 不认识总是朗读
  await user.click(await screen.findByRole("button", { name: "开始小测" }));
  // 队列:talk(模糊)选释义 → accept(不认识)选释义 → accept 看释义选词
  expect(await screen.findByText("talk", { selector: "[data-testid=question-word]" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: /说话；谈话；n\. 交谈/ }));
  await user.click(await screen.findByRole("button", { name: "继续" }));
  await user.click(await screen.findByRole("button", { name: /接受；承认/ }));
  await user.click(await screen.findByRole("button", { name: "继续" }));
  expect(await screen.findByText("再认一次")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: /accept/ }));
  await user.click(await screen.findByRole("button", { name: "继续" }));
  const summary = await screen.findByTestId("session-summary");
  expect(summary).toHaveTextContent("认识 0 · 模糊 1 · 不认识 1");
  expect(answers(mock).filter((a) => a.qtype !== "recall")).toHaveLength(3);
}, 15_000);

it("a peek turns 认识 into 模糊 and says so before the tap", async () => {
  const user = userEvent.setup();
  const mock = setup();
  await screen.findByTestId("word-card");
  await user.click(screen.getByRole("button", { name: /显示释义/ }));
  expect(screen.getByTestId("word-card")).toHaveTextContent("说话；谈话");
  expect(screen.getByRole("button", { name: "认识" })).toHaveAccessibleDescription("已看过释义:点「认识」会记为「模糊」");
  await user.click(screen.getByRole("button", { name: "认识" }));
  await waitFor(() => expect(answers(mock)[0]).toMatchObject({ rating: "know", revealed_before: true }));
  expect(await screen.findByTestId("rating-badge")).toHaveTextContent("模糊");
});

it("plain 认识 skips the quiz; a spot-checked 认识 is quizzed once", async () => {
  const user = userEvent.setup();
  SPOT.accept = true;
  setup();
  await screen.findByTestId("word-card");
  await user.click(screen.getByRole("button", { name: "认识" }));
  await user.click(await screen.findByRole("button", { name: "下一个" }));
  await user.click(await screen.findByRole("button", { name: "认识" }));
  expect(await screen.findByTestId("rating-badge")).toHaveTextContent("认识 · 本轮抽查");
  await user.click(screen.getByRole("button", { name: "开始小测" }));
  expect(await screen.findByText("抽查 · 你标了「认识」")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: /接受；承认/ }));
  await user.click(await screen.findByRole("button", { name: "继续" }));
  const summary = await screen.findByTestId("session-summary");
  expect(summary).toHaveTextContent("抽查 1 · 通过 1");
  expect(summary).toHaveTextContent("100%");
  delete SPOT.accept;
});

it("记错了 re-rates the word as unknown", async () => {
  const user = userEvent.setup();
  const mock = setup();
  await screen.findByTestId("word-card");
  await user.click(screen.getByRole("button", { name: "认识" }));
  await user.click(await screen.findByRole("button", { name: "记错了" }));
  await waitFor(() => expect(answers(mock)[1]).toMatchObject({ key: "talk", qtype: "recall", rating: "unknown" }));
  expect(await screen.findByTestId("rating-badge")).toHaveTextContent("不认识");
});
```

保留 v1 的「今天的新词学完了」「先选一本词书」「StrictMode」(把其中的「我认识」换成「认识」)三个用例。

- [ ] **Step 2: 跑测试确认失败**。

- [ ] **Step 3: 实现** — `learn-page.tsx` 主体(页面框架、加载 / 错误 / 空状态与 v1 相同,下面是新增状态与卡片 / 小测两个阶段):

```tsx
import { ArrowRightIcon, RotateCcwIcon } from "lucide-react";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
// …v1 的其余 import…
import { RatingBadge, RecallRatingBar } from "./recall-rating-bar";
import {
  answerCurrent, cardReducer, isFinished, learnTally, planLearnQuiz, progressOf, ratingPayload, startCard, startSession,
  type QuizSlot, type RatedWord, type Rating, type SessionState,
} from "./session-machine";

type Batch = { bookId: BookId; cards: Card[]; quiz: Question[]; drill: Question[] };

export function WordbookLearnPage() {
  // …t / api / navigate / config / speaker / rankEnabled 同 v1…
  const prefs = config?.enabled ? config.learn : undefined;
  const autoplay = prefs?.autoplay ?? true;
  const showExample = prefs?.showExample ?? true;
  const [card, dispatch] = useReducer(cardReducer, 0, startCard);
  const [rated, setRated] = useState<RatedWord[]>([]);
  const [slots, setSlots] = useState<QuizSlot[]>([]);
  const [status, setStatus] = useState("");
  const regionRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  // …phase / batch / error / index / session / result / busy / actionError / round / mounted / continueRef 同 v1…

  const current = phase === "cards" ? batch?.cards[index] : undefined;
  // 新卡出现:计时归零;自动朗读(iOS 第一次手势之前不会响,spec recall §8.3)
  useEffect(() => {
    if (!current) return;
    dispatch({ type: "reset", at: performance.now() });
    if (autoplay && speaker.available) speaker.listen(`${current.key}:auto`, current.word, "us");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在换卡时触发
  }, [current?.key]);
  useEffect(() => { if (card.rating) nextRef.current?.focus({ preventScroll: true }); }, [card.rating]);

  const reveal = () => {
    speaker.prime(); // 手势内解锁 iOS 音频
    dispatch({ type: "reveal" });
    requestAnimationFrame(() => regionRef.current?.focus({ preventScroll: true }));
  };

  const sendRating = async (rating: Rating, corrected = false) => {
    if (!batch || !current || busy) return;
    speaker.prime();
    if (rating === "unknown" && speaker.available) speaker.listen(`${current.key}:us`, current.word, "us");
    setBusy(true);
    setActionError(null);
    try {
      const payload = corrected ? { rating, revealedBefore: true, elapsedMs: 0 } : ratingPayload(card, rating, performance.now());
      const res = await submitAnswer(api, { bookId: batch.bookId, key: current.key, mode: "learn", qtype: "recall", ...payload });
      if (!mounted.current) return;
      const eff = res.rating ?? rating;
      if (corrected) dispatch({ type: "corrected" });
      else dispatch({ type: "rated", rating: eff });
      setRated((list) => [...list.filter((w) => w.key !== current.key), { key: current.key, rating: eff, spotCheck: !corrected && res.spotCheck }]);
      setStatus(t(rating === "fuzzy" && eff === "unknown" ? "web.wordbook.learn.rated.streak" : `web.wordbook.learn.rated.${eff}`));
    } catch (err) {
      if (mounted.current) setActionError(errorText(err));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const questionFor = (slot: QuizSlot | undefined) =>
    slot ? (slot.qtype === "word" ? batch?.drill : batch?.quiz)?.find((q) => q.key === slot.key) ?? null : null;

  const startQuiz = () => {
    const planned = planLearnQuiz(rated).filter((s) => questionFor(s));
    setSlots(planned);
    setSession(startSession(planned.map((s) => s.id)));
    setResult(null);
    setPhase(planned.length ? "quiz" : "summary");
  };

  const nextCard = () => {
    if (!batch) return;
    setActionError(null);
    setStatus("");
    if (index + 1 < batch.cards.length) setIndex(index + 1);
    else startQuiz();
  };

  const slot = slots.find((s) => s.id === session.current);
  const question = questionFor(slot);
  // choose / proceed 与 v1 相同(qtype 用 question.qtype:meaning 或 word)

  if (phase === "summary" && batch) {
    const tally = learnTally(rated, session.firstTry);
    const missed = tally.missed.map((key) => {
      const c = cardOf(key);
      return { key, word: c?.word ?? key, meaning: c ? meaningLine(c.senses, 40) : "" };
    });
    const stats: SessionStats = { kind: "learn", total: rated.length, firstTry: tally.firstTry, points: rankEnabled ? rated.length : null,
      missed, ratings: tally.ratings, checks: tally.checks };
    // …渲染同 v1…
  }

  if (phase === "cards" && batch && current) {
    const last = index + 1 >= batch.cards.length;
    const spot = rated.find((w) => w.key === current.key)?.spotCheck ?? false;
    return (
      <div className="flex flex-1 flex-col">
        <SessionHeader title={t("web.wordbook.learn.title")} />
        <div className="px-gutter pb-4">
          <StepBar done={index} total={batch.cards.length} />
          <WordCardView key={current.key} card={current} {...listen} covered={!card.revealed} onReveal={reveal} regionRef={regionRef}
            showExample={showExample} badge={card.rating ? <RatingBadge rating={card.rating} check={card.rating === "know" && spot} /> : null}
            eyebrow={t("web.wordbook.learn.eyebrow", { n: index + 1, total: batch.cards.length, book: book ? bookTitle(book, i18n.language) : "" })} />
          <p role="status" aria-live="polite" className="sr-only">{status}</p>
          {actionError ? <p role="alert" className="mt-3 text-sub text-ink">{actionError}</p> : null}
        </div>
        {card.rating ? (
          <div className={DOCK}>
            {card.rating === "know" ? (
              <button type="button" className={cn(GHOST, "h-12 flex-1")} disabled={busy} onClick={() => void sendRating("unknown", true)}>
                <RotateCcwIcon aria-hidden />{t("web.wordbook.learn.iWasWrong")}
              </button>
            ) : null}
            <button ref={nextRef} type="button" className={cn(PRIMARY, "h-12 flex-1")} disabled={busy} onClick={nextCard}>
              {last ? t("web.wordbook.learn.startQuiz") : t("web.wordbook.learn.next")}<ArrowRightIcon aria-hidden />
            </button>
          </div>
        ) : (
          <RecallRatingBar busy={busy} peeked={card.peeked} onRate={(r) => void sendRating(r)} />
        )}
      </div>
    );
  }

  // 小测:与 v1 相同,另外在题目上方显示眉题:
  //   slot.qtype === "word" → t("web.wordbook.learn.drillEyebrow");抽中的认识词 → t("web.wordbook.learn.spotEyebrow")
  //   <ChoiceQuestion key={`${slot.id}:${session.requeued[slot.id] ?? 0}`} question={question} … />
}
```

`load` 的 effect 里 `setRated([])`、`setSlots([])`、`setStatus("")` 与 v1 的重置放在一起。

- [ ] **Step 4: 跑测试** — `yarn web:typecheck && cd web && yarn vitest run src/features/wordbook`(页面测试为写计划时未实跑的新用例:以真实 DOM 为准修正选择器,不改流程断言)。
- [ ] **Step 5: 提交** — `feat(web): learn new words with a covered card and three-way rating`。

### Task W5: 复习「快速回忆」卡与复习页分支

**Files:**
- Create: `web/src/features/wordbook/recall-card.tsx`
- Modify: `web/src/features/wordbook/review-page.tsx`、`web/src/features/wordbook/review-page.test.tsx`(追加)、`web/src/features/wordbook/i18n/{zh-CN,en}.json`(`recall` 对象)

**Interfaces:**
- Produces:`RecallCard({ question, card, face, rating, check?, showExample?, …ListenProps })`,`face: "front" | "back"`;复习页调用 `reviewBatch(api, 20, { recall: true })`

- [ ] **Step 1: 写失败测试** — 追加到 `review-page.test.tsx`(沿用文件里的 `setup` / `answers` 写法;批次只放一题 recall):

```tsx
const RECALL_BATCH = { book_id: "cet4", questions: [{ key: "talk", qtype: "recall", prompt: { word: "talk", us: "tɔk" }, options: null, length: null }],
  cards: [card("talk", { senses: [{ pos: "v", text: "说话；谈话" }] })] };
const CHECK = { key: "talk", qtype: "meaning", prompt: { word: "talk", us: "tɔk" }, options: ["v. 说话；谈话", "n. 能力", "v. 携带", "n. 孩子"], length: null };

it("quick recall: front shows only the word; 认识 may ask a spot check first, then flips", async () => {
  const user = userEvent.setup();
  let step = 0;
  const mock = setup({
    "POST /api/wordbook/review/batch": () => json(RECALL_BATCH),
    "POST /api/wordbook/answers": () => json(step++ === 0
      ? { correct: false, outcome: "pending", grade: null, expected: "talk", correct_option: null, diff: null, item: { box: 1, due_at: "x" }, applied: false, rating: "know", spot_check: true, check: CHECK }
      : { correct: true, outcome: "know", grade: "good", expected: "talk", correct_option: "v. 说话；谈话", diff: null, item: { box: 2, due_at: "x" }, applied: true, rating: "know", spot_check: false, check: null }),
  });
  await user.click(await screen.findByRole("button", { name: /开始复习|复习/ }));
  expect(JSON.parse(String(mock.calls.find((c) => c.url.pathname === "/api/wordbook/review/batch")?.body))).toMatchObject({ recall: true });
  const front = await screen.findByTestId("recall-card");
  expect(front).toHaveTextContent("talk");
  expect(front).not.toHaveTextContent("说话；谈话");
  await user.click(screen.getByRole("button", { name: "认识" }));
  expect(await screen.findByText("抽查:选出它的意思")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: /说话；谈话/ }));
  await waitFor(() => expect(screen.getByTestId("word-card")).toHaveTextContent("说话；谈话"));
  expect(answers(mock)[1]).toMatchObject({ qtype: "recall", rating: "know", choice: "v. 说话；谈话" });
  expect(screen.getByRole("button", { name: "记错了" })).toBeTruthy();
});

it("quick recall: 模糊 flips straight away and the word comes back later", async () => {
  const user = userEvent.setup();
  setup({
    "POST /api/wordbook/review/batch": () => json(RECALL_BATCH),
    "POST /api/wordbook/answers": () => json({ correct: false, outcome: "fuzzy", grade: "hard", expected: "talk", correct_option: null, diff: null, item: { box: 1, due_at: "x" }, applied: true, rating: "fuzzy", spot_check: false, check: null }),
  });
  await user.click(await screen.findByRole("button", { name: /开始复习|复习/ }));
  await user.click(await screen.findByRole("button", { name: "模糊" }));
  expect(await screen.findByTestId("rating-badge")).toHaveTextContent("模糊");
  await user.click(screen.getByRole("button", { name: "继续" }));
  expect(await screen.findByTestId("recall-card")).toHaveTextContent("talk"); // 回到队尾再来一次
});
```

- [ ] **Step 2: 跑测试确认失败**。

- [ ] **Step 3: 实现**

`recall-card.tsx`:

```tsx
import { Volume2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SurfaceCard } from "~/components/surface-card";
import { RatingBadge } from "./recall-rating-bar";
import type { Rating } from "./session-machine";
import { ListenButton, WordCardView, type ListenProps } from "./word-card";
import type { Card, Question } from "./wordbook-api";

/** 翻面进场:减少动态时直接显示;否则 180ms rotateY(只动卡片自己,不动玻璃层)。 */
function useEntered() {
  const reduce = typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  const [entered, setEntered] = useState(reduce);
  useEffect(() => {
    if (entered) return;
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, [entered]);
  return entered;
}

/** 快速回忆(spec recall §4.2,视觉稿 06/07):正面只有词头与音标;背面 = 词卡 + 评级徽标。 */
export function RecallCard({ question, card, face, rating, showExample = true, onListen, listening, canListen }: ListenProps & {
  question: Question; card: Card | undefined; face: "front" | "back"; rating: Rating | null; showExample?: boolean;
}) {
  const { t } = useTranslation();
  const entered = useEntered();
  const listen = { onListen, listening, canListen };
  if (face === "back" && card) {
    return (
      <div style={{ transform: entered ? "none" : "perspective(800px) rotateY(80deg)", transition: "transform 180ms ease-out" }}
        className="motion-reduce:!transition-none">
        <WordCardView card={card} {...listen} showExample={showExample} eyebrow={t("web.wordbook.recall.kind")}
          badge={rating ? <RatingBadge rating={rating} /> : null} />
      </div>
    );
  }
  const word = question.prompt.word ?? "";
  return (
    <SurfaceCard data-testid="recall-card" className="flex min-h-[300px] flex-col items-center justify-center px-4 py-8 text-center">
      <p className="eyebrow">{t("web.wordbook.recall.kind")}</p>
      <h2 lang="en" data-testid="question-word" className="mt-3 break-words text-hero font-semibold tracking-[-0.02em]"
        style={{ lineHeight: 1.1, overflowWrap: "anywhere" }}>{word}</h2>
      <ListenButton id={`${question.key}:recall`} text={word} label={t("web.wordbook.word.listen.word")} {...listen}
        className="mt-3 h-tap bg-surface-2 pl-1.5 pr-3 text-body text-ink">
        <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-surface text-blue shadow-hair"><Volume2Icon className="h-[18px] w-[18px]" /></span>
        {question.prompt.us ? <span lang="en" className="font-[CharisSIL,ui-serif,serif]">{question.prompt.us}</span> : null}
      </ListenButton>
      <p className="mt-5 text-sub text-ink-2">{t("web.wordbook.recall.prompt")}</p>
    </SurfaceCard>
  );
}
```

`review-page.tsx` 的改动:
1. `const b = await reviewBatch(api, 20, { recall: true });`
2. 新状态:`const [check, setCheck] = useState<Question | null>(null);`、`const shownAt = useRef(0);`,在 `session.current` 变化时 `shownAt.current = performance.now()`;`start()` 里 `setCheck(null)`。
3. `send` 的结果处理:

```tsx
      const result = await submitAnswer(api, { bookId: batch.bookId, key: question.key, mode: "review", qtype: question.qtype, ...input });
      if (!mounted.current) return;
      if (result.outcome === "pending" && result.check) { setCheck(result.check); return; } // 抽查:先答这道题(P-R3)
      setCheck(null);
      setAnswer({ result, choice: input.choice });
      setFirst((f) => (question.key in f ? f : { ...f, [question.key]: result }));
```

4. 自评与记错了:

```tsx
  const rateRecall = (rating: Rating) =>
    void send({ rating, revealedBefore: false, elapsedMs: Math.max(0, Math.round(performance.now() - shownAt.current)) });
  const iWasWrong = async () => {
    if (!batch || !question || busy) return;
    setBusy(true);
    try {
      const result = await submitAnswer(api, { bookId: batch.bookId, key: question.key, mode: "review", qtype: "recall", rating: "unknown" });
      if (!mounted.current) return;
      setAnswer({ result });
      setFirst((f) => ({ ...f, [question.key]: result })); // 小结按改正后的结果算
    } catch (err) {
      if (mounted.current) setActionError(errorText(err));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
```

(`send` 的参数类型扩为 `{ choice?: string; typed?: string; hinted?: boolean; rating?: Rating; revealedBefore?: boolean; elapsedMs?: number }`。)

5. 渲染分支(放在 `CHOICE.has(question.qtype)` 之前):

```tsx
        {question?.qtype === "recall" ? (
          check ? (
            <>
              <p className="mb-2 text-sub font-semibold text-ink">{t("web.wordbook.recall.checkTitle")}</p>
              <p className="mb-2 text-meta text-ink-2">{t("web.wordbook.recall.checkHint")}</p>
              <ChoiceQuestion key={`${question.key}:check`} question={check} result={null} busy={busy}
                onAnswer={(choice) => void send({ rating: "know", choice })} {...listen} />
            </>
          ) : (
            <RecallCard key={`${question.key}:${attempt}`} question={question} card={batch?.cards[question.key]}
              face={answer ? "back" : "front"} rating={answer?.result.rating ?? null} showExample={showExample} {...listen} />
          )
        ) : /* v1 的选择题 / 键入题分支 */ null}
```

(`showExample` 取自 `useWordbookConfig()` 的 `learn.showExample`,默认 true。)

6. 底部:`question?.qtype === "recall" && !answer && !check` 时渲染 `<RecallRatingBar busy={busy} onRate={rateRecall} />`;有 `answer` 且 `answer.result.rating === "know"` 时继续按钮左侧加「记错了」(`GHOST`,点了调用 `iWasWrong`,之后这个按钮不再显示:`answer.result.rating` 已变为 `unknown`)。
7. 结果播报:recall 题用 `t(\`web.wordbook.learn.rated.${answer.result.rating}\`)`;抽查后答错时加一句 `t("web.wordbook.quiz.wrong", { answer: answer.result.correctOption })`。
8. 翻面后若 `config.learn.autoplay` 且 TTS 可用,朗读词头一次(`useEffect` 依赖 `answer?.result` 与 `question?.qtype === "recall"`)。

i18n 新对象 `web.wordbook.recall`(放在 `quiz` 之后):

```json
"recall": {
  "kind": "快速回忆", "prompt": "想起它的意思了吗?",
  "checkTitle": "抽查:选出它的意思", "checkHint": "你标了「认识」,答对才算数",
  "summary": { "ratings": "认识 {{know}} · 模糊 {{fuzzy}} · 不认识 {{unknown}}", "checks": "抽查 {{total}} · 通过 {{passed}}" },
  "errors": { "ratingRequired": "请选择认识、模糊或不认识" }
}
```

```json
"recall": {
  "kind": "Quick recall", "prompt": "Can you recall what it means?",
  "checkTitle": "Spot check: pick its meaning", "checkHint": "You said you know it; it counts only if you get this right",
  "summary": { "ratings": "Known {{know}} · Not sure {{fuzzy}} · Unknown {{unknown}}", "checks": "Spot checks {{total}} · passed {{passed}}" },
  "errors": { "ratingRequired": "Choose I know it, Not sure or Don't know" }
}
```

- [ ] **Step 4: 跑测试** — `yarn web:typecheck && cd web && yarn vitest run src/features/wordbook`(v1 的复习用例不传 `recall` 题,行为不变;批次请求多了 `recall: true`,若 v1 用例断言了请求体全等,改为 `toMatchObject`)。
- [ ] **Step 5: 提交** — `feat(web): quick-recall review card with spot check and self-correction`。

### Task W6: 小结显示评级与抽查

**Files:**
- Modify: `web/src/features/wordbook/session-summary.tsx`、`web/src/features/wordbook/review-page.tsx`(传 `ratings`)
- Test: `web/src/features/wordbook/session-summary.test.tsx`(新)

**Interfaces:**
- Produces:`SessionStats` 追加 `ratings?: Record<Rating, number>`、`checks?: { total: number; passed: number }`

- [ ] **Step 1: 写失败测试**

```tsx
import { screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import { renderWithProviders } from "~/test/render";
import { SessionSummary } from "./session-summary";

beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); void i18n.changeLanguage("zh-CN"); });
afterEach(() => { localStorage.removeItem("enjoy-web.settings"); void i18n.changeLanguage("en"); });

it("shows the rating split and spot checks when present", () => {
  renderWithProviders(<SessionSummary onHome={vi.fn()} stats={{ kind: "learn", total: 5, firstTry: 4, points: null, missed: [],
    ratings: { know: 2, fuzzy: 2, unknown: 1 }, checks: { total: 1, passed: 1 } }} />);
  const summary = screen.getByTestId("session-summary");
  expect(summary).toHaveTextContent("认识 2 · 模糊 2 · 不认识 1");
  expect(summary).toHaveTextContent("抽查 1 · 通过 1");
});

it("says nothing about ratings for a v1-style session", () => {
  renderWithProviders(<SessionSummary onHome={vi.fn()} stats={{ kind: "review", total: 3, firstTry: 3, points: null, missed: [] }} />);
  expect(screen.getByTestId("session-summary")).not.toHaveTextContent("抽查");
});
```

- [ ] **Step 2: 实现** — `SessionSummary` 在 `<p role="status">` 之后加:

```tsx
          {stats.ratings ? (
            <p data-testid="summary-ratings" className="mt-1 text-meta text-ink-2">
              {t("web.wordbook.recall.summary.ratings", stats.ratings)}
              {stats.checks?.total ? ` · ${t("web.wordbook.recall.summary.checks", stats.checks)}` : ""}
            </p>
          ) : null}
```

复习页小结:`ratings` = 第一次结果里 `rating` 非空的计数(没有快速回忆题时不传)。

- [ ] **Step 3: 跑测试** — `cd web && yarn vitest run src/features/wordbook`。
- [ ] **Step 4: 提交** — `feat(web): session summary shows ratings and spot checks`。

### Task W7: 网页契约测试(S6 合并后)

**Files:**
- Modify: `web/src/features/wordbook/wordbook-contract.test.ts`

- [ ] **Step 1: 改测试**

```ts
const ANSWER: Record<keyof AnswerResult, true> = { correct: true, outcome: true, grade: true, expected: true, correctOption: true, diff: true,
  item: true, applied: true, rating: true, spotCheck: true, check: true };
// …
it("recall payloads match (spec recall §9)", () => {
  const recall = cc<AnswerResult>(c.answer_recall);
  expect(keysOf(recall)).toEqual(keys(ANSWER));
  expect(recall.rating).toBe("fuzzy");
  const pending = cc<AnswerResult>(c.answer_check);
  expect(pending.outcome).toBe("pending");
  expect(keysOf(pending.check as Question)).toEqual(keys(QUESTION));
  const drill = cc<{ drill: Question[] }>(c.learn_batch).drill[0];
  expect(keysOf(drill)).toEqual(keys(QUESTION));
  const config = cc<Extract<WordbookConfig, { enabled: true }>>(c.config);
  expect(keysOf(config.learn)).toEqual(["autoplay", "showExample"]);
});
```

(import 追加 `WordbookConfig`。)

- [ ] **Step 2: 跑测试** — `cd web && yarn vitest run src/features/wordbook/wordbook-contract.test.ts`;再全量 `yarn web:typecheck && yarn web:test && yarn web:build`(记录主包大小,新组件都在懒加载的学习 / 复习页里,主包不应变化)。
- [ ] **Step 3: 提交** — `test(web): wordbook contract covers recall payloads`。

---

## Final lane (Z)

### Task Z1: E2E、文档

**Files:**
- Create: `web/e2e/wordbook-recall.spec.ts`
- Modify: `server/app/wordbook/CLAUDE.md`(What lives here 加 `recall.py`;Pitfalls 加「当天新词只用 `set_learn_box`」「抽查种子是选书 seed,不要下发」「`enable_wordbook` 默认 `wordbook_spot_check_pct=0`」)、`web/src/features/wordbook/CLAUDE.md`(加 `recall-*.tsx`、会话机新导出、`reviewBatch(..., { recall: true })`)、`web/README.md`(背单词段:三档自评、快速回忆、真机未验证项)、`docs/superpowers/plans/e2e-results.md`

- [ ] **Step 1: E2E 大纲(实现成 Playwright 用例,沿用 `web/e2e/wordbook.spec.ts` 的登录与开关夹具;E2E 栈 `docker-compose.e2e.yml`,零上游)**

```ts
test("wordbook v2: covered card, three ratings, round quiz, quick recall", async ({ page }) => {
  // 1. 登录 → /wordbook/learn(E2E 栈已开 WORDBOOK_ENABLED,书 junior,WORDBOOK_SPOT_CHECK_PCT=100 便于断言)
  // 2. 第 1 张:断言卡上没有释义文本;点「模糊」→ 释义出现、徽标「模糊」→ 下一个
  // 3. 第 2 张:点「显示释义」→ 点「认识」→ 徽标「模糊」(偷看)→ 下一个
  // 4. 第 3 张:点「不认识」→ 下一个;第 4 张:「认识」→ 徽标「认识 · 本轮抽查」;第 5 张:「认识」
  // 5. 开始小测:题数 = 模糊 2 + 不认识 2 + 抽查 2 = 6;全部答对 → 小结「认识 2 · 模糊 2 · 不认识 1」「抽查 2 · 通过 2」
  // 6. 用 E2E 管理端点或 SQL 夹具把一个盒 1 的词改到期(沿用 wordbook.spec.ts 的做法)→ /wordbook/review → 开始
  // 7. 若出现快速回忆:正面无释义 → 「认识」→ 抽查题(pct=100)→ 选对 → 翻面 → 「记错了」→ 徽标「不认识」
  // 8. 断言 /api/wordbook/today 的 new_done = 5,review_done = 1
});
```

- [ ] **Step 2: 运行** — `yarn web:e2e --project=chromium-mobile wordbook-recall`(需 E2E 栈);结果写进 `e2e-results.md`,真机清单(spec §8.4)逐项标「已验证 / 未验证」。
- [ ] **Step 3: 提交** — `test(e2e): wordbook v2 learn and quick-recall flow` 与 `docs: wordbook v2 notes`。

### Task Z2: 评审波与合并验收

- [ ] `/code-review high`(S、W 各一次)与 `security-review`(整个分支):输入校验(`rating` 枚举、`elapsed_ms` 范围、`extra="forbid"`)、确定性、私有种子不下发、作答上限、日志不含用户输入。
- [ ] 视觉对照:视觉稿 01–08 vs 真实页面(浏览器窗格 375×812,浅色 + 深色)。
- [ ] 全量:`cd server && uv run pytest -q`;`yarn web:typecheck && yarn web:test && yarn web:build`;E2E。
- [ ] 真机(spec §8.4):iPhone Safari + 主屏 PWA、安卓 Chrome(中低端)、VoiceOver、TalkBack、深色模式。

## 验收标准

1. 新词卡遮罩时释义、例句不在 DOM;遮罩是带 `aria-expanded` 的按钮,≥ 96px;偷看后「认识」记为「模糊」并在点之前提示。
2. 认识 / 模糊 / 不认识分别建行于盒 2 / 1 / 0;抽中的认识盒 1,本轮抽查答对升盒 2、答错盒 0;连续两次模糊记为不认识;全部由服务端决定(客户端改 `rating` 以外的字段不能拿到更高的盒)。
3. 本轮小测:模糊在前、不认识两次(第二次看释义选词)、抽中的认识一次、没抽中的认识不考。
4. 当天新词的后续作答不加 `reps`、不产生 `vocab_review`;每个新词只产生一个 `word_learned`;每日新词与作答上限照旧。
5. 复习:声明 `recall:true` 且设置开时,盒 1/2/4/5 的到期词约 40% 出快速回忆;盒 0、3 不出;认识按比例两步抽查;模糊 = hard,不认识 = forgot;未到期的不认识 / 记错了走 `apply_lapse`。
6. 四个设置在管理端可改并热生效;`/config.learn` 下发 `autoplay`、`show_example`。
7. 契约样例与网页类型一致(含 `answer_recall`、`answer_check`、`drill`、`config.learn`);旧客户端请求(`known:true`、不带 `recall`)照常工作。
8. 浅色 / 深色 / 减少动态 / 读屏可用;真机未验证项已标注。

## 规格覆盖自查(spec → task)

| spec | task |
|---|---|
| §2 盒子编号 | S1(`LEARN_BOX`)、S4 |
| §3.1–3.2 遮罩与自评 | W3、W4 |
| §3.3 本轮小测 | W2、W4;服务端 S4(`drill`、`_learn_day_quiz`) |
| §3.4 小结 | W2(`learnTally`)、W6 |
| §4 快速回忆 | S3、S5、W5 |
| §5.1–5.2 有效评级与抽查 | S1 |
| §5.3–5.4 学新词与当天后续作答 | S4 |
| §5.5 复习规则 | S3、S5 |
| §5.6 兼容 | S3(`recall` 需声明)、S4(`known` 别名) |
| §6 段位点与事件 | S4、S5 测试(`events`、`reps`、`last_reviewed_at`) |
| §7 设置 | S2 |
| §8 网页、无障碍、动效、平台 | W3–W6、Z1、Z2 |
| §9 API 与契约 | S2–S6、W1、W7 |
| §10 测试 | 各任务 |
| §11 风险 | Global Constraints、Z2 |
