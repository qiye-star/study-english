# 英英默认 · 「中」小开关 · 短语设置 Implementation Plan(计划 A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 没存过偏好的用户,背单词的释义显示默认是「仅英文」;有效偏好为「仅英文」而这张卡没有英文释义时,自动按中文显示;翻开的卡片右上角有一个「中」小开关,只在这张卡上临时把中文释义显示出来;「每日目标」面板里已有的释义显示设置旁新增「短语:自动展开 / 收起」(设备级,读写 `phrases-pref.ts`)。服务端默认值改 `"en"`,契约夹具重录。已有 `defpref` 事件的用户不受影响。

**Architecture:** 服务端只改一个常量 `store.DEFAULT_DEF_LANG`(`config_out` 的默认参数与 `get_def_lang` 的回退都引用它),其余是测试与夹具。网页把「哪些行显示」写成纯函数 `defView()`(`def-lang.ts`,取代 `word-card.tsx` 里内联的 `showDefs` / `showSenses`),并导出唯一的默认值 `DEFAULT_DEF_LANG`;`WordCardView` 用它并在眉题行右侧渲染「中」开关(本卡状态,按 `card.key` 记,不写服务端、不写本机);`DefLangSetting` 在同一面板里多一个两格分段控件。新文案只进懒加载的 `locales/{en,zh-CN}.json`(`web.wordbookDefs.*`,不进主包)。

**Tech Stack:** FastAPI + SQLAlchemy + pytest(服务端);React 18 + react-i18next + Tailwind 3 + vitest + Testing Library(网页)。不新增依赖、不新增迁移、不改 `enjoy/`、不新增跨 feature 依赖。

**Spec:** `docs/superpowers/specs/2026-10-13-defs-default-lookup-ios-design.md` §1(D1–D3)、§2(本计划只实现这两节)。前置:`2026-10-12-wordbook-definitions-design.md`(已合并:`defs_en`、`def_lang`、`def-lang.ts`、`use-def-lang.ts`、`def-lang-setting.tsx`、`phrases-pref.ts`、`phrases-section.tsx` 都已存在,本计划只改它们)。

## Global Constraints

- **只动 §2 要求的东西。** 不改选择题 / 拼写题 / 快速回忆题面(D3);不动 `lookup/`、`layout/`、`vocabulary/`;不改 `wordbook-api.ts` 的类型与签名(无新字段)。
- **遮罩不变量:** `covered` 时中文释义、英文释义、「中」开关都不在 DOM 里。
- **老卡片 DOM 不变:** 没有 `defsEn` 的卡片在任何偏好下渲染结果与改动前逐字节相同(`word-card-legacy` 快照不得更新、不得 `-u`)。
- **隐私:** 「中」开关不发请求、不写 `localStorage`;短语开关只写已有的 `WORDBOOK_PREFS_KEY` 里的一个布尔值;日志 / URL 里没有词。
- **i18n:** 新键只放 `features/wordbook/locales/{en,zh-CN}.json`,中英同键,命名空间 `web.wordbookDefs.*`;英文标签 ≤ 12 字符(360 px 一行放得下;jsdom 没有布局,真实宽度未验证)。
- **UI 规范:** 触控目标 ≥ 44 px(`h-tap w-tap`);颜色只用令牌;`motion-reduce:transition-none`;无 emoji。
- **分层:** `architecture.test.ts` 不改、不放宽;`features/wordbook/index.ts` 不新增导出。
- **只跑定向测试:** 每个任务只跑该任务列出的测试文件;**全量测试(`uv run pytest -q`、`yarn web:test`)、`yarn web:build`、E2E、重建容器都只在用户要求时才跑**。
- **提交:** conventional(`feat(server): …`、`feat(web): …`、`test(web): …`、`docs: …`),一任务一提交,信息以 `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` 结尾。
- **验证口径(如实):** 写计划时读了真实代码,**没有运行任何测试或构建**。测试与实现按读到的代码写;执行者第一次运行时以真实结果为准修正。**本计划没有任何需要真机的项目**(没有 iOS / 软键盘 / 读屏专项);「中」开关在 360 / 375 px 的真实排版只有 jsdom 结构性断言,未在真实浏览器目视,用户要求时再看。

---

## 文件归属与共享文件风险

**本计划拥有(只有 A 改):**

```
server/app/wordbook/store.py                     T1  DEFAULT_DEF_LANG + 注释
server/app/wordbook/CLAUDE.md                    T5  契约 / 默认值一行
server/tests/test_wordbook_def_lang.py           T1
server/tests/test_wordbook_contract.py           T1  (录制的 PATCH 改 "zh",断言同步)
server/tests/fixtures/wordbook_contract.json     T1  重录(只应变 2 处)
web/src/features/wordbook/def-lang.ts            T2  DEFAULT_DEF_LANG、defView
web/src/features/wordbook/def-lang.test.ts       T2
web/src/features/wordbook/use-def-lang.ts        T2  只改注释
web/src/features/wordbook/use-def-lang.test.tsx  T2
web/src/features/wordbook/recall-card.tsx        T2  默认 prop 换成 DEFAULT_DEF_LANG
web/src/features/wordbook/word-card.tsx          T2 / T3
web/src/features/wordbook/word-card-defs.test.tsx   T2
web/src/features/wordbook/word-card-peek.test.tsx   T3 新
web/src/features/wordbook/locales/{en,zh-CN}.json   T3 / T4
web/src/features/wordbook/def-lang-setting.tsx   T4
web/src/features/wordbook/def-lang-setting.test.tsx T4
web/src/features/wordbook/goals-sheet.test.tsx   T2  (一个断言)
web/src/features/wordbook/wordbook-contract.test.ts T5
web/e2e/wordbook-recall.spec.ts                  T5  (一行,先切到「中英」)
web/src/features/wordbook/CLAUDE.md、web/README.md  T5
docs/superpowers/plans/2026-10-13-defs-default.md   本文件
```

**不碰:** `web/src/features/lookup/**` 与服务端新词典模块(计划 B);`web/src/layout/**`、输入框样式(计划 C);`features/wordbook/index.ts`;`wordbook-api.ts`;`word-card-legacy.test.tsx` 及其快照。

**共享文件风险(都小,且可并行):**

| 文件 | 风险 | 处理 |
|---|---|---|
| `web/README.md` | 三份计划都可能在「背单词 / 查词 / iOS」附近追加一条 | A 只追加自己的一段(T5),冲突时两段都保留 |
| `server/app/wordbook/CLAUDE.md` | B 的新服务端模块可能改「What lives here」列表 | A 只改 Pitfalls 里 `Contract fixture` 那一行之后加一行,不动列表 |
| `web/src/features/wordbook/CLAUDE.md` | B 可能加一条 | A 只在 Pitfalls 末尾加一条 |
| `server/tests/fixtures/wordbook_contract.json` | B 若改词卡 / 配置形状也会重录 | B 不应改这些形状(spec §3.2 只加新端点);若重录发生,以后合并者再重录一次,文件由脚本生成,冲突时丢弃双方改动重录 |
| `def-lang.ts` 的 `defLangOf` / `DEFAULT_DEF_LANG` | B 的抽屉「遵守 `def_lang`」若要读偏好,会依赖它 | 合并顺序 A → B(spec §6);B 需要偏好时走插槽 / 扩展点,**不得**从 `~/features/wordbook/…` 深导入(跨 feature 边不放宽) |
| 工作区里已有的未提交改动 `web/src/features/wordbook/__snapshots__/word-card-legacy.test.tsx.snap` | 开始时 `git status` 显示它已被修改(git 只提示 LF→CRLF) | 不属于本计划:**不要 stage、不要 `-u` 重录**;T3 的验证用 `git diff --ignore-space-at-eol --stat -- <该文件>` 确认没有内容差异,若有内容差异,停下来问用户 |

**合并顺序:** A → B → C(spec §6)。A 内部:T1(服务端)→ T2 → T3 → T4 → T5(T5 的契约步骤读 T1 重录的夹具)。

---

## 本计划的裁定(spec 里所有「核对」项,读代码后的结论)

- **R-A1 服务端默认值只有一个落点。** `grep` 全 `server/app`:`"both"` 只出现在 `store.py:293`(`DEFAULT_DEF_LANG = "both"`);`service.config_out(settings, def_lang=store.DEFAULT_DEF_LANG)` 与 `store.get_def_lang` 都引用该常量,路由 `routers/wordbook.py:56` 传 `service.def_lang_of(...)`。管理端、排名、计划都不读它。裁定:只改这个常量(及其注释),不新增迁移、不回填。
- **R-A2 「已有偏好的用户不受影响」由存储形态保证。** 偏好是 `wordbook_events` 里 `kind="defpref"`、`book_id=""` 的行,`get_def_lang` 取最新一行的 `outcome`。用户**选过**「中英」就有一行 `both`,默认值改动后仍读到 `both`;没存过的用户没有这一行,才落到新默认。无法区分的只有「从没动过设置」与「从来没打开过设置」,两者本就应得到新默认(D2)。库里的值若不在 `DEF_LANGS` 里,回退到新默认(新增测试)。
- **R-A3 PATCH 校验不变。** 路由 `def_lang: Literal["both","zh","en"] | None`(未知值 422)、`service.patch_enrollment` 再校验一遍 `store.DEF_LANGS`、「值没变就不写事件、不占每日 60 次设置额度」——这条比较的是 `get_def_lang`,所以现在「相对于默认 `en`」判断。现有测试里假定默认是 `both` 的 6 处要改(T1 逐条列出)。
- **R-A4 契约夹具。** 录制的 `config.def_lang` 变为 `"en"`;`def_lang_patch` 原来 PATCH `"en"`,默认变成 `en` 后那是「无变化」,仍会返回 200 但不再代表一次真实写入,所以录制步骤改 PATCH `"zh"`(服务端测试里相应断言 `"zh"`)。重录命令 `CONTRACT_UPDATE=1`;脚本固定了随机与时间,**期望 `git diff` 只有这两处**,有别处漂移就还原夹具后手改这两行。
- **R-A5 网页里「写死 `both` 的回退」共 3 处代码 + 若干注释。** 代码:`def-lang.ts` 的 `defLangOf`、`word-card.tsx` 的 `defLang = "both"` 默认 prop、`recall-card.tsx` 的 `defLang = "both"` 默认 prop;`use-def-lang.ts` 只有注释提到 `"both"`;`link-actions.tsx` / `learn-page.tsx` / `review-page.tsx` / `learned-page.tsx` / `free-browse.tsx` 都经 `useDefLangValue()` 传值(`def-lang-wiring.test.ts` 守着,不改)。裁定:`def-lang.ts` 导出唯一的 `DEFAULT_DEF_LANG = "en"`,三处代码都引用它。依赖「默认是 both」的现有测试加显式 `defLang="both"`(T2 列出)。
- **R-A6 配置还没到的那一刻显示「仅英文」。** `useDefLangValue()` 在配置到达前返回默认值,所以偏好是「中英 / 仅中文」的用户在配置未缓存的首屏可能短暂看到英文版式再切回。`useWordbookConfig` 每个 `ApiClient` 只取一次并缓存,背单词各页先于词卡(需要先拉 batch)加载配置,但**这个先后没有实测**,标「未验证」;可接受(只影响释义行,不影响作答)。
- **R-A7 回退判定 = 纯函数 `defView(defLang, card, peek)`。** 「有效偏好」= 偏好经回退之后的值:偏好 `en` 且这张卡有英文释义才是「英文版式」;偏好 `en` 而 `groupDefs(card.defsEn)` 为空(国家 / 城市等约 135 个词、老服务端)就是中文版式,词性标签随中文行(`posLabel`)一起显示,不会出现空卡。旧代码在 `word-card.tsx` 里内联(R-DW6)——行为不变,只是搬到 `defView` 里并单测。
- **R-A8 「中」开关何时出现:** `defView().canPeek` = 偏好为 `en` **且**该卡既有英文释义又有中文释义(回退到中文的卡没有东西可切换,出现一个无效按钮反而误导)**且** `!covered`。偏好为 `both` / `zh` 时不出现。按 spec「有效偏好为 en」字面读,这就是「有效偏好」的含义,没有偏离。
- **R-A9 开关状态:** `WordCardView` 内 `useState<string | null>` 记「正在偷看的 `card.key`」,`peek = peekKey === card.key`——换卡自动复位,不需要 effect;不写服务端、不写 `localStorage`(测试断言)。学新词页 `key={current.key}` 本就重挂;复习页背面 / 翻卡浏览 / 已学词抽屉 / 联动查看词卡都走同一个 `WordCardView`,所以开关在这些地方也出现(都是「翻开的卡」)。`peek` 时显示的是「中英」版式(中文行在上、英文行在下,同 `both`)。
- **R-A10 开关位置与 DOM 兼容:** 眉题行(`eyebrow` / `badge` 所在行,`justify-between`)已经是卡片右上角;`canPeek && !covered` 时把 `badge` 与开关包进一个 `flex` 容器放在右侧(没有开关时 DOM 与改动前相同,legacy 快照不变)。按钮 `h-tap w-tap`(44 px),用 `-my-2.5 -mr-2` 负边距抵消高度,不撑高眉题行。按钮无文字的部分:可见字形「中」`aria-hidden`,可访问名称来自 `web.wordbookDefs.peek.label`,状态用 `aria-pressed`。
- **R-A11 短语设置只管学新词页,且与卡片上的手动开合是同一个值。** `phrases-pref.ts` 的 `phrasesOpen` 已经是「设备级、`null` = 自动展开」;卡片上手动收起 / 展开(`phrases-section.tsx`,仅 `mode="auto"` 即学新词页)写的也是它。设置里的分段控件读它(`readPhrasesPref() === false` ⇒「收起」,其余⇒「自动展开」)、写它,所以两处不会矛盾。复习页与已学词页(`phrasesOpen` 默认 `false`)从不读它——已核对 `learn-page.tsx:269` 是唯一传 `phrasesOpen="auto"` 的地方,`RecallCard` → `Back` → `WordCardView` 与 `learned-page.tsx:55` 都不传——所以「复习页、已学词页行为不变」成立,不需要改它们。设置界面一次只在首页的目标面板里存在,学新词页是之后才挂载的,不需要跨组件订阅。
- **R-A12 用分段控件做「开关」。** `components/` 里没有 Switch;现有的 `SegmentedControl`(radiogroup、方向键、`hit-expand` 44 px)就是该面板的惯用写法,两格「自动展开 / 收起」满足「开关」语义,不新增组件。
- **R-A13 现有 E2E 会被默认值打破。** `web/e2e/wordbook-recall.spec.ts` 在学新词翻开后断言中文释义 `senses[0].text` 可见;默认「仅英文」下,有英文释义的词不显示中文,该用例会失败。裁定(T5):用例开头用 API 把偏好设成 `both`(一行)。`wordbook.spec.ts`、`wordbook-goals.spec.ts` 不断言卡片释义,不改。E2E 本轮**不运行**(要 E2E 栈、真实上游),用户要求时再跑。
- **R-A14 主包。** `word-card.tsx`、`def-lang.ts`、`def-lang-setting.tsx`、`locales*` 都只被懒加载块引用,本计划没有新的静态导入进主包;**没有实测主包**,用户要求时用 `yarn web:build && node web/scripts/check-main-bundle.mjs --max-delta=999`(不得 `--record`)。

---

## Task 1: 服务端默认值与契约夹具

**Files:**
- Modify: `server/app/wordbook/store.py`、`server/tests/test_wordbook_def_lang.py`、`server/tests/test_wordbook_contract.py`
- Regenerate: `server/tests/fixtures/wordbook_contract.json`

- [ ] **Step 1: 先改测试(应当变红)** — `server/tests/test_wordbook_def_lang.py`:

  1. 顶部 import 改为(加 `User`、`utcnow`):

```python
from app.models import User, WordbookEvent, utcnow
```

  2. 第一个测试整个替换为:

```python
async def test_default_is_en_and_the_key_sits_next_to_the_other_config_keys(app, client, tmp_path):
    h = await register(app, client, tmp_path)
    cfg = await config(client, h)
    assert cfg["def_lang"] == "en" and {"enabled", "defaults", "learn", "limits", "books"} <= set(cfg)
    assert store.DEFAULT_DEF_LANG == "en" and store.DEFAULT_DEF_LANG in store.DEF_LANGS


async def test_a_user_who_saved_both_keeps_both(app, client, tmp_path):
    """D2:默认值只影响没存过偏好的用户;存过「中英」的用户读到的还是 both(最新一行事件)。"""
    h = await register(app, client, tmp_path)
    assert (await client.patch(f"{URL}/enrollment", headers=h, json={"def_lang": "both"})).json() == {"def_lang": "both"}
    assert (await config(client, h))["def_lang"] == "both"
    assert [r[2] for r in await pref_rows(app)] == ["both"]  # 相对默认 en 是一次真实变化,写了一行


async def test_a_stored_value_that_is_not_a_language_falls_back_to_the_default(app, client, tmp_path):
    h = await register(app, client, tmp_path)
    async with app.state.sessionmaker() as s:
        user_id = await s.scalar(select(User.id))
        await store.set_def_lang(s, user_id, "fr", "2026-10-13", utcnow())
        await s.commit()
    assert (await config(client, h))["def_lang"] == "en"
```

  3. `test_it_is_per_user` 的最后两行改为(默认 en 下 PATCH `en` 是空操作,换成 `zh`):

```python
    await client.patch(f"{URL}/enrollment", headers=a, json={"def_lang": "zh"})
    assert (await config(client, a))["def_lang"] == "zh" and (await config(client, b))["def_lang"] == "en"
```

  4. `test_an_invalid_goal_with_a_def_lang_changes_neither`:第一次 PATCH 的 `"def_lang": "en"` 改 `"zh"`,第二次的 `"def_lang": "zh"` 改 `"both"`,最后一行断言改 `== "zh"`。

  5. `test_an_unchanged_value_writes_nothing_and_costs_nothing` 整个替换为:

```python
async def test_an_unchanged_value_writes_nothing_and_costs_nothing(app, client, tmp_path, monkeypatch):
    h = await register(app, client, tmp_path)
    monkeypatch.setattr(store, "SETTINGS_DAILY_MAX", 1)
    for _ in range(3):  # en is the default now: saving it again is "no change"
        assert (await client.patch(f"{URL}/enrollment", headers=h, json={"def_lang": "en"})).status_code == 200
    assert await pref_rows(app) == []
    assert (await client.patch(f"{URL}/enrollment", headers=h, json={"def_lang": "zh"})).status_code == 200
    assert (await client.patch(f"{URL}/enrollment", headers=h, json={"def_lang": "both"})).status_code == 429
    assert [r[2] for r in await pref_rows(app)] == ["zh"]
```

  6. `test_change_history_is_events_with_an_empty_book_id_and_the_latest_wins`:循环 `("en", "zh", "en")` 改 `("zh", "both", "en")`,断言行改为 `[("", "zh"), ("", "both"), ("", "en")]`,最终 `config == "en"`。

  7. `test_the_preference_rows_do_not_touch_plans_rank_or_the_admin_book_counts` 与 `test_no_user_content_in_logs` 里的 `{"def_lang": "en"}` 改 `{"def_lang": "zh"}`(要真正写入一行,断言才有意义)。

  `server/tests/test_wordbook_contract.py`:`collect_goals` 里 `json={"def_lang": "en"}` 改 `json={"def_lang": "zh"}`;文件末尾断言改为:

```python
    assert expected["config"]["def_lang"] == "en" and expected["def_lang_patch"]["def_lang"] == "zh"
```

- [ ] **Step 2: 确认变红** — `cd server && uv run pytest -q tests/test_wordbook_def_lang.py tests/test_wordbook_contract.py`。预期:默认值相关测试失败(`"both" != "en"`),契约测试因夹具未重录失败。

- [ ] **Step 3: 实现** — `server/app/wordbook/store.py` 的 `DEF_LANGS` 上方注释与常量改为:

```python
# 默认值(spec 2026-10-13-defs-default-lookup-ios-design §2):没存过偏好的用户显示「仅英文」;缺英文释义的词由网页回退成中文。
# 已存过偏好的用户读到自己最新一行事件,不受默认值影响。
DEF_LANGS = ("both", "zh", "en")
DEFAULT_DEF_LANG = "en"
```

  同文件 `get_def_lang` 与 `service.config_out` 已引用该常量,不改。`service.config_out` 行尾注释 `both | zh | en` 保持。

- [ ] **Step 4: 重录夹具** — PowerShell:`cd server; $env:CONTRACT_UPDATE=1; uv run pytest -q tests/test_wordbook_contract.py; Remove-Item Env:CONTRACT_UPDATE`。然后 `git diff --stat -- tests/fixtures/wordbook_contract.json`:期望恰好 `config.def_lang` 与 `def_lang_patch.def_lang` 两处(`"both"→"en"`、`"en"→"zh"`)。若有别的漂移,`git checkout -- tests/fixtures/wordbook_contract.json` 后手改这两行(R-A4)。

- [ ] **Step 5: 跑本任务的测试** — `cd server && uv run pytest -q tests/test_wordbook_def_lang.py tests/test_wordbook_contract.py tests/test_architecture.py`,全绿。
- [ ] **Step 6: 提交** — `git add server/app/wordbook/store.py server/tests/test_wordbook_def_lang.py server/tests/test_wordbook_contract.py server/tests/fixtures/wordbook_contract.json` → `feat(server): default the wordbook definitions display to English only`,尾行 `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`。

---

## Task 2: 默认值常量、回退纯函数 `defView`

**Files:**
- Modify: `web/src/features/wordbook/def-lang.ts`、`def-lang.test.ts`、`use-def-lang.ts`(注释)、`use-def-lang.test.tsx`、`word-card.tsx`、`recall-card.tsx`、`word-card-defs.test.tsx`、`def-lang-setting.test.tsx`、`goals-sheet.test.tsx`

**Interfaces:**
- Produces(`def-lang.ts`):`DEFAULT_DEF_LANG: DefLang = "en"`;`DefView { groups: DefGroup[]; showDefs: boolean; showSenses: boolean; canPeek: boolean }`;`defView(defLang, card: Pick<Card, "senses" | "defsEn">, peek?: boolean): DefView`。`defLangOf` 回退改用 `DEFAULT_DEF_LANG`。

- [ ] **Step 1: 写失败测试** — `def-lang.test.ts`:import 增加 `DEFAULT_DEF_LANG, defView`;把 `"reads defLang with a safe default"` 用例整个替换为:

```ts
  it("reads defLang with a safe default (old servers have no key): English only", () => {
    expect(DEFAULT_DEF_LANG).toBe("en");
    expect(defLangOf(null)).toBe("en");
    expect(defLangOf({ enabled: false })).toBe("en");
    expect(defLangOf(ON)).toBe("en");
    expect(defLangOf({ ...ON, defLang: "both" } as WordbookConfig)).toBe("both");
    expect(defLangOf({ ...ON, defLang: "zh" } as WordbookConfig)).toBe("zh");
    expect(defLangOf({ ...ON, defLang: "klingon" } as unknown as WordbookConfig)).toBe("en");
  });
```

  并在文件末尾追加:

```ts
describe("defView (which definition rows a card shows)", () => {
  const ZH = [{ pos: "v", text: "说话" }];
  const EN = [{ pos: "v", text: "speak to someone" }];
  const view = (...a: Parameters<typeof defView>) => {
    const { groups, ...flags } = defView(...a);
    return { groups: groups.length, ...flags };
  };

  it("both: Chinese rows plus English rows, nothing to peek at", () => {
    expect(view("both", { senses: ZH, defsEn: EN })).toEqual({ groups: 1, showDefs: true, showSenses: true, canPeek: false });
  });
  it("zh: Chinese rows only", () => {
    expect(view("zh", { senses: ZH, defsEn: EN })).toEqual({ groups: 1, showDefs: false, showSenses: true, canPeek: false });
  });
  it("en: English rows only, and the Chinese rows can be peeked", () => {
    expect(view("en", { senses: ZH, defsEn: EN })).toEqual({ groups: 1, showDefs: true, showSenses: false, canPeek: true });
    expect(view("en", { senses: ZH, defsEn: EN }, true)).toEqual({ groups: 1, showDefs: true, showSenses: true, canPeek: true });
  });
  it("en without English definitions falls back to Chinese and offers no peek (nothing to switch)", () => {
    for (const defsEn of [undefined, [], [{ pos: "n", text: "   " }]]) {
      expect(view("en", { senses: ZH, defsEn })).toEqual({ groups: 0, showDefs: false, showSenses: true, canPeek: false });
      expect(view("en", { senses: ZH, defsEn }, true).showSenses).toBe(true);
    }
  });
  it("en without Chinese senses has nothing to peek at either", () => {
    expect(view("en", { senses: [], defsEn: EN })).toEqual({ groups: 1, showDefs: true, showSenses: false, canPeek: false });
  });
  it("a card with neither renders no definition rows in any mode", () => {
    for (const mode of ["both", "zh", "en"] as const) {
      expect(view(mode, { senses: [], defsEn: undefined })).toEqual({ groups: 0, showDefs: false, showSenses: false, canPeek: false });
    }
  });
});
```

  其余现有测试按 R-A5 改成显式依赖:
  - `use-def-lang.test.tsx`:`"defaults to both until the config arrives…"` 两处 `toBe("both")` 改 `toBe("en")`(用例名里的 both 改 en);`"stays both on an old server…"` 改名 `stays English only…` 且断言 `toBe("en")`。
  - `def-lang-setting.test.tsx`:第一个用例标题与断言改为「仅英文」选中:`expect(screen.getByRole("radio", { name: "仅英文" })).toHaveAttribute("aria-checked", "true");`(用例名里 `中英 selected` 改 `仅英文 selected`)。
  - `goals-sheet.test.tsx` 的 `"contains the definitions segmented control, 中英 by default"`:改名 `…仅英文 by default`,断言 `getByRole("radio", { name: "仅英文" })`。
  - `word-card-defs.test.tsx`:前两个用例(`shows them under the Chinese meaning…`、`orders Chinese meaning…`)与 `ignores blank texts…` 里的 `<WordCardView card={…} />` 加 `defLang="both"`;`"an old card without defsEn renders exactly as before in every mode"` 保持(默认现在是 `en`,`PLAIN` 无英文释义,回退后与 `both` / `zh` 逐字节相同,正好覆盖 R-A7)。
  - `recall-card.test.tsx`:最后一个用例不传 `defLang`、只看短语,不改。

- [ ] **Step 2: 确认变红** — `cd web && yarn vitest run src/features/wordbook/def-lang.test.ts src/features/wordbook/use-def-lang.test.tsx`(`defView` / `DEFAULT_DEF_LANG` 未导出、默认值断言失败)。

- [ ] **Step 3: 实现 `def-lang.ts`** — 顶部 import 改为 `import type { Card, DefEn, DefLang, WordbookConfig } from "./wordbook-api";`;把 `DEF_LANGS` / `isDefLang` / `defLangOf` 一段替换为:

```ts
export const DEF_LANGS: readonly DefLang[] = ["both", "zh", "en"];
export const isDefLang = (v: unknown): v is DefLang => typeof v === "string" && (DEF_LANGS as readonly string[]).includes(v);

/** 没存过偏好 / 配置没到 / 老服务端没有这个键时的显示:仅英文(spec 2026-10-13-defs-default §1 D1、D2)。全站唯一的默认值落点。 */
export const DEFAULT_DEF_LANG: DefLang = "en";

/** 配置里的偏好;没有这个键 / 值不认识 / 配置没到 → DEFAULT_DEF_LANG。 */
export const defLangOf = (config: WordbookConfig | null): DefLang =>
  config?.enabled && isDefLang(config.defLang) ? config.defLang : DEFAULT_DEF_LANG;
```

  在文件末尾 `groupDefs` 之后追加:

```ts
export interface DefView {
  groups: DefGroup[];
  /** 显示英文释义行 */
  showDefs: boolean;
  /** 显示中文释义行(含词性标签) */
  showSenses: boolean;
  /** 「中」开关有意义:偏好是 en,且这张卡既有英文释义(会隐藏中文)又有中文释义 */
  canPeek: boolean;
}

/**
 * 一张翻开的卡显示哪几类释义行(spec 2026-10-13-defs-default §2.2,计划 R-A7)。纯函数。
 * 「仅英文」只在这张卡有英文释义时生效;没有(约 135 个国家 / 城市等词、老服务端)就照中文显示,不出现空卡。
 * `peek` = 用户点了这张卡的「中」:中文行回来,英文行照旧。
 */
export function defView(defLang: DefLang, card: Pick<Card, "senses" | "defsEn">, peek = false): DefView {
  const groups = groupDefs(card.defsEn);
  const hasEn = groups.length > 0;
  const hasZh = card.senses.length > 0;
  return {
    groups,
    showDefs: defLang !== "zh" && hasEn,
    showSenses: hasZh && !(defLang === "en" && hasEn && !peek),
    canPeek: defLang === "en" && hasEn && hasZh,
  };
}
```

  `use-def-lang.ts` 注释里 `config.defLang ?? "both"` 改 `config.defLang ?? DEFAULT_DEF_LANG("en")`(只改注释)。

- [ ] **Step 4: 实现 `word-card.tsx` 与 `recall-card.tsx`(不含开关)** —
  - `word-card.tsx` 第 7 行 `import { groupDefs } from "./def-lang";` → `import { DEFAULT_DEF_LANG, defView } from "./def-lang";`
  - 参数默认值 `defLang = "both", phrasesOpen = false,` → `defLang = DEFAULT_DEF_LANG, phrasesOpen = false,`
  - 把

```tsx
  const defGroups = groupDefs(card.defsEn);
  const showDefs = defLang !== "zh" && defGroups.length > 0;
  // 「仅英文」:有英文释义时中文行让位;缺口词(没有英文释义)仍显示中文,否则答案是空的(R-DW6)
  const showSenses = card.senses.length > 0 && !(defLang === "en" && showDefs);
```

    替换为

```tsx
  // 「仅英文」:有英文释义时中文行让位;缺口词(没有英文释义)回退成中文,否则答案是空的(计划 2026-10-13-defs-default R-A7)
  const { groups: defGroups, showDefs, showSenses } = defView(defLang, card);
```

    (T3 再把 `peek` 接进来。)JSX 里的 `{showSenses ? …}` 与 `{showDefs ? <DefinitionsEn groups={defGroups} …}` 不变。注释第 72 行 `默认 both` 改 `默认「仅英文」,没有英文释义的卡回退成中文`。
  - `recall-card.tsx`:加 `import { DEFAULT_DEF_LANG } from "./def-lang";`,`defLang = "both"` → `defLang = DEFAULT_DEF_LANG`。

- [ ] **Step 5: 跑本任务的测试** — `cd web && yarn vitest run src/features/wordbook/def-lang.test.ts src/features/wordbook/use-def-lang.test.tsx src/features/wordbook/word-card-defs.test.tsx src/features/wordbook/recall-card.test.tsx src/features/wordbook/def-lang-setting.test.tsx src/features/wordbook/goals-sheet.test.tsx src/features/wordbook/word-card-legacy.test.tsx src/features/wordbook/def-lang-wiring.test.ts src/architecture.test.ts`。全绿;`word-card-legacy` 快照不得有变化(没有 `defsEn`,回退后与改动前相同)。
- [ ] **Step 6: 提交** — `git add` 上述 `web/src/features/wordbook/` 下改动的源码与测试文件(**不要**加 `__snapshots__`)→ `feat(web): English-only definitions by default with a Chinese fallback for cards without English`。

---

## Task 3: 卡片右上角「中」小开关

**Files:**
- Modify: `web/src/features/wordbook/word-card.tsx`、`web/src/features/wordbook/locales/en.json`、`locales/zh-CN.json`
- Create: `web/src/features/wordbook/word-card-peek.test.tsx`

**Interfaces:** `WordCardView` 对外 props 不变(无新 prop);新增 DOM:`data-testid="def-peek"` 的按钮。

- [ ] **Step 1: 文案** — `locales/zh-CN.json` 在 `"wordbookDefs"` 下 `"label"` 之后加(顺序随意,只要中英同键):

```json
      "peek": { "label": "显示中文释义" },
```

  `locales/en.json`:

```json
      "peek": { "label": "Show Chinese definitions" },
```

- [ ] **Step 2: 写失败测试** — 创建 `web/src/features/wordbook/word-card-peek.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "~/i18n";
import { renderWithProviders } from "~/test/render";
import { DEFS_EN, card } from "./test-fixtures";
import { WordCardView } from "./word-card";
import type { Card } from "./wordbook-api";

const BASE = { senses: [{ pos: "v", text: "说话；谈话" }, { pos: "n", text: "交谈" }], phrases: [] };
const WITH_DEFS = { ...card("talk", BASE), defsEn: DEFS_EN } as unknown as Card;
const PLAIN = card("talk", BASE) as unknown as Card;
const OTHER = { ...card("walk", { senses: [{ pos: "v", text: "走路" }] }), defsEn: [{ pos: "v", text: "move on foot" }] } as unknown as Card;
const peek = () => screen.queryByTestId("def-peek");

beforeEach(() => {
  localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
  void i18n.changeLanguage("zh-CN");
});
afterEach(() => {
  localStorage.removeItem("enjoy-web.settings");
  void i18n.changeLanguage("en");
});

describe("the 中 peek switch on a word card", () => {
  it("shows only for English-only cards that have both languages, once revealed", () => {
    renderWithProviders(<WordCardView card={WITH_DEFS} defLang="en" />);
    expect(peek()).toBeTruthy();
    expect(peek()).toHaveAccessibleName("显示中文释义");
    expect(peek()).toHaveAttribute("aria-pressed", "false");
    expect(peek()).toHaveTextContent("中");
  });

  it.each(["both", "zh"] as const)("is absent in %s mode", (mode) => {
    renderWithProviders(<WordCardView card={WITH_DEFS} defLang={mode} />);
    expect(peek()).toBeNull();
  });

  it("is absent for a card that fell back to Chinese (no English definitions: nothing to switch)", () => {
    renderWithProviders(<WordCardView card={PLAIN} defLang="en" />);
    expect(peek()).toBeNull();
    expect(screen.getByText("说话；谈话")).toBeTruthy();
  });

  it("is not rendered while the card is covered (the Chinese meaning is not in the DOM)", () => {
    renderWithProviders(<WordCardView card={WITH_DEFS} defLang="en" covered onReveal={() => {}} />);
    expect(peek()).toBeNull();
    expect(screen.getByTestId("word-card")).not.toHaveTextContent("说话；谈话");
  });

  it("toggles the Chinese rows for this card only, keeping the English rows", async () => {
    renderWithProviders(<WordCardView card={WITH_DEFS} defLang="en" />);
    expect(screen.queryByText("说话；谈话")).toBeNull();
    await userEvent.click(peek()!);
    expect(peek()).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("说话；谈话")).toBeTruthy();
    expect(screen.getByTestId("word-defs-en")).toBeTruthy();
    await userEvent.click(peek()!);
    expect(peek()).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText("说话；谈话")).toBeNull();
  });

  it("resets when the card changes", async () => {
    function Pair() {
      const [word, setWord] = useState<Card>(WITH_DEFS);
      return (<><button type="button" onClick={() => setWord(OTHER)}>next</button><WordCardView card={word} defLang="en" /></>);
    }
    renderWithProviders(<Pair />);
    await userEvent.click(peek()!);
    expect(screen.getByText("说话；谈话")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "next" }));
    expect(peek()).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText("走路")).toBeNull();
  });

  it("sits at the top right next to the badge, with a 44 px target and no storage writes", async () => {
    renderWithProviders(<WordCardView card={WITH_DEFS} defLang="en" badge={<span data-testid="badge">模糊</span>} />);
    const button = peek()!;
    expect(button.className).toContain("h-tap");
    expect(button.className).toContain("w-tap");
    expect(button.className).toContain("motion-reduce:transition-none");
    expect(button.parentElement).toBe(screen.getByTestId("badge").parentElement); // same right-hand group
    expect(button.parentElement!.parentElement!.className).toContain("justify-between");
    await userEvent.click(button);
    expect(Object.keys(localStorage)).toEqual(["enjoy-web.settings"]); // nothing written: not the server, not the device
  });

  it("renders the toggle without an eyebrow or a badge too", () => {
    renderWithProviders(<WordCardView card={WITH_DEFS} defLang="en" />);
    expect(peek()!.parentElement!.className).toContain("justify-between");
  });
});
```

- [ ] **Step 3: 确认变红** — `cd web && yarn vitest run src/features/wordbook/word-card-peek.test.tsx`(找不到 `def-peek`)。

- [ ] **Step 4: 实现** — `word-card.tsx`:
  - `useState` 已导入。把 T2 的 `const { groups: defGroups, showDefs, showSenses } = defView(defLang, card);` 前面加状态并接入 `peek`:

```tsx
  // 「中」小开关:只影响这一张卡的当前显示;记的是正在偷看的 card.key,换卡自动复位;不写服务端、不写本机(R-A9)
  const [peekKey, setPeekKey] = useState<string | null>(null);
  const peek = peekKey === card.key;
  const { groups: defGroups, showDefs, showSenses, canPeek } = defView(defLang, card, peek);
  const peekButton = canPeek && !covered ? (
    <button type="button" data-testid="def-peek" aria-pressed={peek} aria-label={t("web.wordbookDefs.peek.label")}
      onClick={() => setPeekKey((k) => (k === card.key ? null : card.key))}
      className={cn(
        "-my-2.5 -mr-2 inline-flex h-tap w-tap flex-none items-center justify-center rounded-button text-body font-semibold transition-colors duration-fast motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        peek ? "bg-surface-2 text-ink" : "text-ink-2",
      )}>
      <span aria-hidden>中</span>
    </button>
  ) : null;
```

  - 眉题行(原 `{eyebrow || badge ? (…) : null}`)替换为:

```tsx
      {eyebrow || badge || peekButton ? (
        <div className="flex min-h-[22px] items-center justify-between gap-2">
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : <span />}
          {peekButton ? <div className="flex items-center gap-1.5">{badge}{peekButton}</div> : badge}
        </div>
      ) : null}
```

    (没有开关时 DOM 与改动前一致。)

- [ ] **Step 5: 跑本任务的测试** — `cd web && yarn vitest run src/features/wordbook/word-card-peek.test.tsx src/features/wordbook/word-card-defs.test.tsx src/features/wordbook/word-card-legacy.test.tsx src/features/wordbook/recall-card.test.tsx src/features/wordbook/locales.test.ts src/features/wordbook/learn-page.test.tsx src/architecture.test.ts`。全绿;`word-card-legacy` 快照不变。然后 `git diff --ignore-space-at-eol --stat -- web/src/features/wordbook/__snapshots__/` 应为空(见「共享文件风险」)。
- [ ] **Step 6: 提交** — `git add web/src/features/wordbook/word-card.tsx web/src/features/wordbook/word-card-peek.test.tsx web/src/features/wordbook/locales` → `feat(web): per-card 中 switch to peek at the Chinese definitions in English-only mode`。

---

## Task 4: 设置面板里的「短语:自动展开 / 收起」

**Files:**
- Modify: `web/src/features/wordbook/def-lang-setting.tsx`、`web/src/features/wordbook/def-lang-setting.test.tsx`、`locales/en.json`、`locales/zh-CN.json`

- [ ] **Step 1: 文案** — `locales/zh-CN.json`:把 `setting.help` 换成新文案,并在 `"wordbookDefs"` 下加 `phrases`:

```json
      "setting": {
        "label": "释义显示",
        "help": "翻开词卡后显示;小测的题面和选项仍用中文。「仅英文」下没有英文释义的词仍显示中文,卡片右上角的「中」可临时看中文。英文释义取自开放词典,仅供参考。",
        "options": { "both": "中英", "zh": "仅中文", "en": "仅英文" }
      },
      "phrases": {
        "label": "短语",
        "help": "只管学新词页:翻开词卡后短语自动展开或收起;复习页和已学词页的短语默认折叠。只保存在本机。",
        "options": { "open": "自动展开", "closed": "收起" }
      }
```

  `locales/en.json`:

```json
      "setting": {
        "label": "Definitions",
        "help": "Shown once a card is open. Quizzes stay in Chinese. In English only, words without an English definition still show Chinese; the 中 button on a card shows it for that card. English definitions come from an open dictionary and are a reference only.",
        "options": { "both": "Both", "zh": "Chinese only", "en": "English only" }
      },
      "phrases": {
        "label": "Phrases",
        "help": "Learn page only: phrases open or stay folded once a card is open. Review and learned-word pages keep them folded. Saved on this device only.",
        "options": { "open": "Auto-open", "closed": "Folded" }
      }
```

- [ ] **Step 2: 写失败测试** — `def-lang-setting.test.tsx`:import 增加 `import { WORDBOOK_PREFS_KEY, writeJson } from "~/lib/storage";`、`import { readPhrasesPref, writePhrasesPref } from "./phrases-pref";`;在顶层 `beforeEach` 里加 `localStorage.removeItem(WORDBOOK_PREFS_KEY);`;文件末尾追加:

```tsx
describe("DefLangSetting phrases switch", () => {
  const phrases = () => screen.getByRole("radiogroup", { name: "短语" });

  it("offers 自动展开 / 收起 with 自动展开 selected when nothing is stored", () => {
    setup();
    expect(within(phrases()).getAllByRole("radio").map((r) => r.textContent)).toEqual(["自动展开", "收起"]);
    expect(within(phrases()).getByRole("radio", { name: "自动展开" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/复习页和已学词页的短语默认折叠/)).toBeTruthy();
  });

  it("reflects a stored fold choice", () => {
    writePhrasesPref(false);
    setup();
    expect(within(phrases()).getByRole("radio", { name: "收起" })).toHaveAttribute("aria-checked", "true");
  });

  it("writes the device preference (merging, not replacing) and sends no request", async () => {
    writeJson(WORDBOOK_PREFS_KEY, { showLength: true });
    const mock = setup();
    await userEvent.click(within(phrases()).getByRole("radio", { name: "收起" }));
    expect(readPhrasesPref()).toBe(false);
    expect(JSON.parse(localStorage.getItem(WORDBOOK_PREFS_KEY)!)).toEqual({ showLength: true, phrasesOpen: false });
    await userEvent.click(within(phrases()).getByRole("radio", { name: "自动展开" }));
    expect(readPhrasesPref()).toBe(true);
    expect(mock.calls.some((c) => c.method !== "GET")).toBe(false); // device-level: never the server
    expect(await screen.findByText("已保存")).toBeTruthy();
  });

  it("structure for 360 px: two equal cells that never wrap, no fixed pixel widths (jsdom has no layout; real width unverified)", () => {
    setup();
    for (const r of within(phrases()).getAllByRole("radio")) {
      expect(r.className).toContain("flex-1");
      expect(r.className).toContain("whitespace-nowrap");
      expect(r.className).not.toMatch(/\bw-\[\d+px\]/);
    }
    for (const l of Object.values(en.web.wordbookDefs.phrases.options)) expect(l.length).toBeLessThanOrEqual(12);
  });
});
```

- [ ] **Step 3: 确认变红** — `cd web && yarn vitest run src/features/wordbook/def-lang-setting.test.tsx`(找不到「短语」radiogroup)。

- [ ] **Step 4: 实现** — `def-lang-setting.tsx` 整个替换为:

```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SegmentedControl } from "~/components/segmented-control";
import { DEF_LANGS } from "./def-lang";
import { readPhrasesPref, writePhrasesPref } from "./phrases-pref";
import { useDefLangSetting } from "./use-def-lang";
import type { DefLang } from "./wordbook-api";
import "./locales";

type PhrasesChoice = "open" | "closed";
const PHRASES_CHOICES: readonly PhrasesChoice[] = ["open", "closed"];

/**
 * 「释义显示:中英 / 仅中文 / 仅英文」(spec 2026-10-12-wordbook-definitions §5,R-DW3)与「短语:自动展开 / 收起」
 * (spec 2026-10-13-defs-default §2.2 ④,计划 R-A11):放在每日目标面板里。
 * 释义:三格等宽铺满,选了立刻生效并保存(乐观,失败退回并说明)。短语:设备级,读写 phrases-pref.ts(没存过 = 自动展开),
 * 不上服务端、不发请求;只管学新词页(卡片上手动开合写的是同一个值)。
 */
export function DefLangSetting() {
  const { t } = useTranslation();
  const { defLang, setDefLang, error } = useDefLangSetting();
  const [saved, setSaved] = useState(0);
  const [phrases, setPhrases] = useState<PhrasesChoice>(() => (readPhrasesPref() === false ? "closed" : "open"));
  const label = t("web.wordbookDefs.setting.label");
  const phrasesLabel = t("web.wordbookDefs.phrases.label");
  return (
    <div className="mt-5" data-testid="def-lang-setting">
      <p className="text-sub font-semibold text-ink-2">{label}</p>
      <SegmentedControl<DefLang> label={label} value={defLang} className="mt-1.5 flex w-full" optionClassName="min-w-0 flex-1 whitespace-nowrap px-2"
        onChange={(next) => void setDefLang(next).then((ok) => { if (ok) setSaved((n) => n + 1); })}
        options={DEF_LANGS.map((v) => ({ value: v, label: t(`web.wordbookDefs.setting.options.${v}`), testId: `def-lang-${v}` }))} />
      <p className="mt-1.5 text-meta leading-dialogue text-ink-2">{t("web.wordbookDefs.setting.help")}</p>
      <p className="mt-4 text-sub font-semibold text-ink-2">{phrasesLabel}</p>
      <SegmentedControl<PhrasesChoice> label={phrasesLabel} value={phrases} className="mt-1.5 flex w-full" optionClassName="min-w-0 flex-1 whitespace-nowrap px-2"
        onChange={(next) => { setPhrases(next); writePhrasesPref(next === "open"); setSaved((n) => n + 1); }}
        options={PHRASES_CHOICES.map((v) => ({ value: v, label: t(`web.wordbookDefs.phrases.options.${v}`), testId: `phrases-${v}` }))} />
      <p className="mt-1.5 text-meta leading-dialogue text-ink-2">{t("web.wordbookDefs.phrases.help")}</p>
      {error ? <p role="alert" className="mt-2 rounded-badge bg-surface-2 px-3 py-2.5 text-sub text-ink">{error}</p> : null}
      <span key={saved} aria-live="polite" className="sr-only">{saved > 0 ? t("web.wordbook.goals.saved") : ""}</span>
    </div>
  );
}
```

- [ ] **Step 5: 跑本任务的测试** — `cd web && yarn vitest run src/features/wordbook/def-lang-setting.test.tsx src/features/wordbook/goals-sheet.test.tsx src/features/wordbook/phrases-section.test.tsx src/features/wordbook/phrases-pref.test.ts src/features/wordbook/locales.test.ts src/architecture.test.ts`。全绿(`goals-sheet.test.tsx` 里 `getByRole("radiogroup", { name: "释义显示" })` 仍唯一)。
- [ ] **Step 6: 提交** — `git add web/src/features/wordbook/def-lang-setting.tsx web/src/features/wordbook/def-lang-setting.test.tsx web/src/features/wordbook/locales` → `feat(web): phrases auto-open switch next to the definitions setting`。

---

## Task 5: 网页契约测试、E2E 前置、文档

**Files:**
- Modify: `web/src/features/wordbook/wordbook-contract.test.ts`、`web/e2e/wordbook-recall.spec.ts`、`web/src/features/wordbook/CLAUDE.md`、`server/app/wordbook/CLAUDE.md`、`web/README.md`

- [ ] **Step 1: 契约测试同步(读 T1 重录的夹具)** — `wordbook-contract.test.ts`:在 `"definitions: defsEn on cards and defLang in the config"` 用例里 `expect(config.defLang).toBe("both");` 改为 `expect(config.defLang).toBe("en");`;在 `"definitions: PATCH enrollment with def_lang echoes def_lang (AD-1)"` 用例里 `expect(isDefLang(patch.def_lang)).toBe(true);` 之后加 `expect(patch.def_lang).toBe("zh");`。运行 `cd web && yarn vitest run src/features/wordbook/wordbook-contract.test.ts`(夹具不是 T1 重录的版本时红,这是预期的保护)。
- [ ] **Step 2: E2E 前置(R-A13)** — `web/e2e/wordbook-recall.spec.ts`,紧跟 `request.put("/api/wordbook/enrollment", …)` 那一行之后加:

```ts
  // 默认释义显示是「仅英文」(spec 2026-10-13-defs-default):本用例按中文释义断言,先把这个账号切到「中英」
  expect((await request.patch("/api/wordbook/enrollment", { headers: auth, data: { def_lang: "both" } })).status()).toBe(200);
```

  不运行(要 E2E 栈与真实上游,用户要求时才跑);类型检查(`yarn web:typecheck`)与构建同样只在用户要求时跑。
- [ ] **Step 3: 文档** —
  - `web/src/features/wordbook/CLAUDE.md` Pitfalls 末尾追加一条:

```
- 释义显示默认「仅英文」(`def-lang.ts` 的 `DEFAULT_DEF_LANG`,spec `2026-10-13-defs-default-lookup-ios-design.md` §2):组件的默认 prop、`defLangOf`、`RecallCard` 都引用它,不要再写死 `"both"`。「哪些行显示」只由纯函数 `defView()` 决定(没有英文释义的卡回退成中文);卡片右上角「中」开关(`word-card.tsx`)是单卡本地状态,按 `card.key` 复位,不写服务端也不写本机;设置里的「短语」开关与学新词页卡片上的手动开合写同一个 `phrasesOpen`(`phrases-pref.ts`)。
```

  - `server/app/wordbook/CLAUDE.md`:在 `- Contract fixture …` 那一条之后加一行:

```
- `def_lang` 默认值是 `store.DEFAULT_DEF_LANG = "en"`(无偏好行的用户);已存过偏好的用户读最新 `defpref` 事件,不受默认值影响。录制的 `def_lang_patch` 用 `"zh"`(PATCH 成默认值是空操作)。
```

  - `web/README.md`:在背单词 v2 那一条(`**背单词 v2:…`)后追加一条:

```
- **背单词:释义默认仅英文**(计划 2026-10-13-defs-default):没存过偏好的用户翻开词卡只看英文释义;这张卡没有英文释义(国家 / 城市等)时自动显示中文;卡片右上角的「中」按钮临时显示这一张卡的中文释义(不保存,换卡复位);「每日目标」面板里「短语:自动展开 / 收起」只管学新词页,存在本机。小测题面仍是中文。未在真实浏览器 / 真机验证:「中」按钮在 360 / 375 px 下与徽标的并排、深色下的按下态;E2E `wordbook-recall.spec.ts` 已改成先切到「中英」但本轮未运行。
```

- [ ] **Step 4: 本任务与整条车道的定向测试(不跑全量)** — `cd web && yarn vitest run src/features/wordbook/wordbook-contract.test.ts src/features/wordbook/def-lang-wiring.test.ts src/features/wordbook/word-card-legacy.test.tsx src/architecture.test.ts`;`cd server && uv run pytest -q tests/test_wordbook_def_lang.py tests/test_wordbook_contract.py tests/test_architecture.py`。
- [ ] **Step 5: 提交** — `git add web/src/features/wordbook/wordbook-contract.test.ts web/e2e/wordbook-recall.spec.ts web/src/features/wordbook/CLAUDE.md server/app/wordbook/CLAUDE.md web/README.md` → `docs: note the English-only default and sync the contract test and recall e2e`。

---

## 验证矩阵与未验证项

| 项 | 怎么验证 | 状态 |
|---|---|---|
| 服务端默认 `en`、旧用户保持、PATCH 校验不变、不记录内容 | T1 的 pytest(含 caplog) | 写计划时未运行 |
| 契约夹具两处变化,网页契约测试读到 | T1 重录 + T5 | 未运行 |
| 回退纯函数、开关显隐 / 单卡切换 / 换卡复位 / 遮罩不渲染、设置写本机、快照不变 | T2–T4 的 vitest | 未运行 |
| 全量 `uv run pytest -q`、`yarn web:test`、`yarn web:typecheck`、`yarn web:build`、主包体积 | 用户要求时 | **不跑** |
| `e2e/wordbook-recall.spec.ts`(已改)与其余背单词 E2E | 用户要求时(要 E2E 栈、真实上游,花钱) | **不跑** |
| 配置未到时的首屏闪烁(R-A6)、开关在 360 / 375 px 的真实排版、深色按下态 | 浏览器窗格目视 | 未验证 |
| 真机 | **无需要真机的项目** | — |
