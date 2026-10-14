# 复习页答后双语 + 「中文」按钮 · 长按查词 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修正并改进计划 `2026-10-13-review-after-answer.md` 交付的复习页答后界面。**改动 A(双语 + 「中文」按钮):** (1) 「看单词选中文」(`meaning`)题答完后,每个选项**保留原来的中文**作为主行,下面加一行小字英文单词(对错项都一样),不再把中文换成英文;「看中文选单词」(`word`)题保持「单词 + 小字 `词性. 中文`」;(2) 题下「学习内容」区默认只显示英文释义 + 英文短语,区内有一个醒目的「中文」按钮(≥ 44 px,`aria-pressed`)带回中文释义与短语译文,换题复位;偏好是 `zh` / `both`、或这个词没有英文释义时直接显示中文、不出按钮;(3) 查词抽屉(`features/lookup`)在 `def_lang = en` 时也加同样的「中文」按钮(每次打开的本地状态)。**改动 B(长按查词):** 复习页答后的选项行由「双击」改为「长按 450 ms」选中该行的英文单词 → 全局选词操作条;移动 > 8 px、`pointercancel`、滚动、提前松手都取消;长按触发后紧跟的 `click` 被吞掉;屏蔽系统长按菜单;一次性提示改为「长按选项里的单词可查询」。

**Architecture:** 新增无状态组件 `web/src/components/zh-toggle.tsx`(`ZhToggle`,文案由调用方传入,同 `zh-note-fold.tsx` 的做法),wordbook 与 lookup 各自用它,**不新增跨 feature 边**。wordbook 侧「中文」规则是 `def-lang.ts` 新增的纯函数 `zhReveal()`(在 `defView()` 之上加「短语译文是否显示」「是否出按钮」);`PhrasesSection` 增加可选 `showZh`(默认 `true`,其余调用方逐字节不变);`WordCardView` 增加**可选的受控** `peek` / `onPeek`(只有答后区传,传了就不画右上角「中」,改画「中文」按钮;其余调用方逐字节不变)。选项行视图 `option-view.ts::optionRowView` 改为双语形状,与 `def_lang` 无关;`ChoiceQuestion` 头部的「中」开关删除。长按是纯状态机 `long-press.ts`(计时器由 hook 负责)+ hook `use-long-press.ts`(Pointer Events + 文档级 `scroll` 捕获监听 + `onClickCapture` 吞点击 + `onContextMenu` preventDefault)。lookup 侧规则是 `dictionary.ts` 新增纯函数 `drawerDefs()`,`DictionaryResult` 持有按 `entry` 对象复位的本地状态。

**Tech Stack:** React 18 + vitest(jsdom)+ @testing-library。不改服务端、不新增依赖、不改 `enjoy/`、不改 `features/library`。

**Spec / 依据:** `docs/superpowers/specs/2026-10-13-review-after-answer-and-library-alignment-design.md` §2、§3(§3 设计者保留意见:双击不稳就改长按);`docs/superpowers/specs/2026-10-13-defs-default-lookup-ios-design.md` D1 / D2 / §2(「中」小开关、抽屉遵守 `def_lang`);owner 2026-10-14 批准的两项改动(本计划开头 Goal)。被修订的计划:`docs/superpowers/plans/2026-10-13-review-after-answer.md`(本计划 Task 8 给它加 Addendum)。

## Global Constraints

- **验证口径(如实):** 写这份计划时**没有运行任何测试、构建或服务**,只读了真实代码;下面的代码与测试是「读代码推断 + 手工推演」,**第一次运行时以真实结果为准修正**(尤其:jsdom 26 的 `PointerEvent` 是否带上 `clientX` / `pointerId`——`components/hold-to-talk-bar.test.tsx` 已这样用,可参照;`vi.useFakeTimers()` 与 `fireEvent` 的配合;React 在捕获阶段 `stopPropagation` 后冒泡阶段的 `onClick` 不再触发)。**真机行为(iOS Safari、Android Chrome)全部未验证**,见文末「真机清单」。
- **分层:** `web/src/architecture.test.ts` 不放宽;**不新增跨 feature 导入**(`CROSS_FEATURE_BASELINE` 不变)。`ZhToggle` 放 `components/`(只依赖 `~/lib/cn`),wordbook / lookup 都只从 `~/components/zh-toggle` 导入。
- **所有权:** 只改 `web/src/components/zh-toggle*`、`web/src/components/CLAUDE.md`、`web/src/features/wordbook/**`、`web/src/features/lookup/{dictionary.ts,dictionary-result.tsx,dictionary-result.test.tsx,i18n/*.json,CLAUDE.md}`、`web/src/lib/CLAUDE.md`、`web/README.md`、`docs/superpowers/plans/2026-10-13-review-after-answer*.md`(只加 Addendum / 一行状态说明)、`docs/changelog/2026-10.json`(仅 Task 9,控制者)。**不碰** `enjoy/`、`server/`、`features/library/**`、`web/src/lib/select-word.ts`(契约不变,只改它的 CLAUDE.md 描述)。
- **隐私:** 单词、选项文字不进 URL、日志、错误体;长按代码里**没有** `console.*`。
- **工作树是 CRLF:** 改现有文件用 Edit 工具,所有 Edit 锚点都是**单行**;锚点不匹配时先 Read 原文再改。新文件用 Write。「整文件替换」= 先 Read 再 Write。
- **测试:** 每个任务只跑它列出的文件(`cd web && yarn vitest run <files>`)+ `src/architecture.test.ts`,外加 `yarn web:typecheck`(从仓库根)。**不跑**全量 `yarn web:test`、`yarn web:build`、E2E、容器重建(用户要求时才跑)。
- **提交:** conventional(`feat(web): …` / `refactor(web): …` / `docs: …`),一任务一提交,提交后该任务的测试全绿;信息以 `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` 结尾。
- **文案:** wordbook 新文案进懒加载 `web/src/features/wordbook/locales/{en,zh-CN}.json`(键前缀 `web.wordbookDefs.after.*`,`locales.test.ts` 守着两边键一致);lookup 新文案进 `web/src/features/lookup/i18n/{en,zh-CN}.json`(急切合并,只加 1 个键)。总共新增 3 个键、删除 1 个(`after.hint`)。

## 读代码得出的现状(写计划时核对)

| 项 | 结论 |
|---|---|
| 答后选项行 | `choice-question.tsx`:传了 `after` 且非 cloze 时,选项是 `<div data-testid="choice-option" role="button" tabIndex=0>`(**不是** `<button>`);`meaning` 题行 = `optionRowView()` 给的英文单词 + (`defView(...).showSenses` 时)小字中文——默认 `def_lang = en` 下中文被藏,这正是 owner 指出的错。`word` 题行 = 单词 + 小字 `meaningLine(defsZh, 40)`。 |
| 现有「中」开关 | 两处:①`choice-question.tsx` 题卡眉题右侧 `data-testid="option-peek"`(状态在复习页 `peekSlot`,按 `${key}:${attempt}` 复位,同时驱动选项行和 `AfterAnswerPanel` 的 `peek`);②`word-card.tsx` 卡片右上角 `data-testid="def-peek"`(单卡本地 `peekKey`)。二者都是 44 px 方块里一个「中」字。`word` 题的答后区是 `WordCardView`,只有②。 |
| 短语译文 | `phrases-section.tsx` 的 `PhrasesSection` 总是显示 `p.zh`(学新词页 / 已学词页 / 答后区共用;`word-card-legacy` 快照守着它的 DOM)。抽屉 `dictionary-result.tsx` 也总显示 `p.zh`。 |
| 抽屉 | `visibleDefs(entry)`:`en` 偏好且有英文释义 → 不显示中文,**没有任何办法看中文**;LLM 回退路径不经过 `DictionaryResult`。`DictionaryResult` 无状态,每次查词 `entry` 是新对象(词典结果不缓存,`lookup/CLAUDE.md`)。 |
| 双击的使用者 | `createTapTracker` / `isDoubleTap` 只在 `features/wordbook/choice-question.tsx`(及其测试)。`features/rooms/assist/assist-dock.tsx` 有一个 `onDoubleClick={toggle}`,与查词无关、不用 tracker。`features/library` 的例句选词走原生长按选择 + `word-tap.ts`,不用 tracker。 |
| 一次性提示 | `double-tap-pref.ts` 在 `WORDBOOK_PREFS_KEY`(`enjoy-web.wordbook.prefs`)JSON 里写 `doubleTapHintSeen`;`auth/device-data.clearDeviceData()` 整键删除,所以同键里的任何新字段退出登录时自动清除。 |
| Pointer 测试先例 | `components/hold-to-talk-bar.test.tsx` 用 `fireEvent.pointerDown(el, { pointerId: 1, clientX, clientY, button: 0 })` / `pointerMove` / `pointerCancel`;`hold-to-talk-bar.tsx` 读 `e.clientX ?? 0`、`onContextMenu={(e) => e.preventDefault()}`。 |
| Tailwind | `spacing.tap = 44px`(`min-h-tap`、`min-w-tap`、`h-tap` 可用);`select-none` / `select-text` 同时输出 `-webkit-` 前缀;任意属性 `[-webkit-touch-callout:none]` 可用。 |

## 本计划的裁定

- **R-Z1 选项行永远双语,与 `def_lang` 无关。** `meaning` 题:主行 = 选项原文(服务端的中文释义行,不在客户端重建),第二行小字 = 该选项所属的英文单词(`optionInfo` 按 `option` 文本匹配);正确项、错误项、未选项同样处理。`word` 题:主行 = 英文单词,小字 = `meaningLine(defsZh, 40)`(不变)。没有 `optionInfo` 的 `meaning` 行 = 旧样子(选项原文,选错划线,无 role)。`optionsCanPeek` 与题卡眉题处的「中」(`option-peek`)**删除**(选项行不再有被藏起的中文)。有单词的行不划线(状态靠 × 图标与 `sr-only` 文字,同 R-A13)。
- **R-Z2 「中文」按钮在「学习内容」区里,统一成一个组件。** `ZhToggle`(`components/zh-toggle.tsx`):圆角胶囊、可见文字「中文」/ "Chinese"、`aria-pressed`、`min-h-tap min-w-tap`;按下后**仍显示**(再点收回)。显示条件 = `zhReveal(defLang, card, peek).chip`:偏好 `en` 且这个词有英文释义,并且有中文可带回(中文释义或任一短语译文)。按下(`peek`)后中文释义行与短语译文都出现,英文行照旧。偏好 `zh` / `both` → 中文直接显示、无按钮;没有英文释义的词 → `defView` 回退中文、无按钮。状态仍由复习页 `peekSlot` 持有(按 `${key}:${attempt}` 换题复位),现在只传给 `AfterAnswerPanel`(`peek` + 新的 `onPeek`)。`meaning` 与 `word` 两种题型都可达:`meaning` 用答后区自绘的面板;`word` 用 `WordCardView` 的**受控模式**(传 `onPeek` 时不画右上角 `def-peek`,在英文释义下方画同一个 `ZhToggle`,短语译文跟随)。学新词页、已学词页、快速回忆背面等**不传** `onPeek` 的 `WordCardView` 逐字节不变(仍是右上角「中」,`word-card-legacy` 快照不动)。
- **R-Z3 短语译文跟随「中文」。** 答后区(两种题型)与抽屉:偏好 `en` 且有英文释义时,短语只显示英文,按「中文」后显示译文。实现:`PhrasesSection` 可选 `showZh`(默认 `true`,DOM 与改动前逐字节相同)。例句的中文(`WordCardView` 例句块自带的「显示/隐藏中文」)不变。
- **R-Z4 抽屉的「中文」按钮。** 纯函数 `drawerDefs(entry, peek)`(`dictionary.ts`):`hidesZh = defLang === "en" && defsEn.length > 0`;`zh = hidesZh && peek ? defsZh : visibleDefs(entry).zh`;`phraseZh = !hidesZh || peek`;`canPeek = hidesZh && (defsZh 非空 || 有短语译文)`。`DictionaryResult` 用 `useState<DictEntry | null>` 记「对哪个 entry 按了中文」,新的一次查词(新 entry 对象)自动复位;不写本机、不写服务端。`visibleDefs` 签名与行为不变(现有测试不动)。LLM 回退结果路径不变。
- **R-L1 长按只在答题后生效。** 答题前选项是 `<button>`,必须保持纯粹的点按答题(长按也只是一次普通点击 = 答题,与改动前相同);只有答后的行(`div[role=button]`,且有可查单词)挂长按处理器。cloze、学新词页、抽查题不变。
- **R-L2 长按判定。** 阈值 `LONG_PRESS_MS = 450`;位移 > `LONG_PRESS_SLOP_PX = 8`(欧氏距离,恰好 8 px 不取消)、`pointercancel`、文档任意 `scroll`(捕获阶段监听,按压期间才挂)、阈值前松手 → 取消。只认主指针(`isPrimary === false` 或 `button > 0` 忽略);第二根手指按下会作废第一根的按压。按压区域 = **整行**(≥ 52 px 高),选中的是该行的英文单词 span(`[data-option-word]`,带 `data-lookup-context`),经 `~/lib/select-word::selectWord`(用户刚手动选了别的文字时不覆盖)。计时器到点由 hook 触发,纯状态机只决定「这次按压是否仍有效」,时间只用于吞点击窗口(由调用方注入 `now`)。
- **R-L3 吞掉长按后的 click。** 长按触发后松手(`pointerup`)起 `CLICK_SWALLOW_MS = 400` 内的**第一个** `click` 在行上的 `onClickCapture` 里 `preventDefault()` + `stopPropagation()`;窗口过期或已吞一次后,后面的点击照常。`pointercancel` 后不吞(取消后浏览器不会再发 click)。答后行上的普通点按(`detail ≥ 1`)本来就什么也不做,只有 `detail === 0`(键盘 / 读屏激活)和 Enter / 空格会查词——吞点击是为了不让读屏路径或外层监听器把长按的尾巴当成一次激活。
- **R-L4 系统长按菜单与选区。** 有单词的答后行加 `select-none [-webkit-touch-callout:none]`,`onContextMenu` → `preventDefault()`(Android Chrome 长按会先发 `contextmenu`,取消它即不弹系统选词与工具条);英文单词 span 保持 `select-text`(程序化选区需要可选内容,`readSelection` 才读得到);中文主行 / 小字不可选。iOS Safari 不发 `contextmenu`:450 ms 早于系统长按选词(约 500 ms),但系统是否随后在同一个词上再起一次原生选区和「拷贝 / 查询」菜单、是否盖住我们的操作条——**未验证**,见真机清单 L-B;备选方案(真机不通过时再做,不在本轮):单词 span 平时 `select-none`,触发瞬间改内联样式为可选再 `selectWord`。
- **R-L5 键盘与读屏不变。** 有单词的行仍是 `role="button"` + `tabIndex=0`;Enter / 空格、`click.detail === 0` 一次就查。
- **R-L6 一次性提示:改名复用,换新字段。** `double-tap-pref.ts` / `double-tap-hint.tsx` 改为 `long-press-pref.ts`(字段 `longPressHintSeen`)/ `long-press-hint.tsx`(`data-testid="long-press-hint"`,文案「长按选项里的单词可查询」)。用新字段名,让看过双击提示的老用户也看到一次新提示。旧字段 `doubleTapHintSeen` 留在 JSON 里不读不删(无害,退出登录随整键清除)。双击相关的 6 个文件(3 源码 + 3 测试)在 Task 6 删除,`after.hint` 文案键同时删除。
- **R-L7 范围。** 只改复习页答后选项。跟读库 / 例句(`features/library`)已有原生长按选择,不动;`assist-dock.tsx` 的 `onDoubleClick` 与查词无关,不在范围。

## 与已批准设计的偏离(写计划者的裁量,均可回退)

1. **短语译文也藏在「中文」后面**(R-Z3):owner 的原话是「中文」带回中文释义「及短语译文」——据此把短语译文也默认藏起;学新词页 / 已学词页的短语不受影响(`showZh` 默认 `true`)。
2. **`WordCardView` 的「中」只在答后区换成「中文」按钮**(R-Z2):学新词页、已学词页等仍是右上角小「中」(spec 2026-10-13-defs-default D1 原样),是否全站统一留作开放问题。
3. **长按按压区是整行而非只有单词**(R-L2):手机上目标更大;选中的仍只是单词。

## 文件结构、车道与共享文件

```
web/src/components/zh-toggle.tsx(+.test.tsx)                    新(T1)
web/src/components/CLAUDE.md                                      [改](T1)
web/src/features/wordbook/def-lang.ts                             [改] + zhReveal(T2);zh-reveal.test.ts 新
web/src/features/wordbook/phrases-section.tsx                     [改] showZh(T2);phrases-section-zh.test.tsx 新
web/src/features/wordbook/locales/{en,zh-CN}.json                 [改] +after.zh +after.longPressHint(T2);-after.hint(T6)
web/src/features/wordbook/after-answer-panel.tsx                  [整文件替换](T3);after-answer-panel.test.tsx [改]
web/src/features/wordbook/word-card.tsx                           [改] 受控 peek(T3);word-card-zh-chip.test.tsx 新
web/src/features/wordbook/review-page.tsx                         [改] 1 行(T3)、1 行(T6)
web/src/features/wordbook/long-press-pref.ts、long-press-hint.tsx(+tests)   新(T4)
web/src/features/wordbook/long-press.ts、use-long-press.ts(+tests)          新(T5)
web/src/features/wordbook/option-view.ts(+test)                   [整文件替换](T6)
web/src/features/wordbook/choice-question.tsx                     [整文件替换](T6);choice-question-after.test.tsx [整文件替换]
web/src/features/wordbook/review-after-answer.test.tsx            [改](T3 一个用例、T6 后半)
web/src/features/wordbook/double-tap*.ts(x) 与测试(6 个)         删除(T6)
web/src/features/lookup/dictionary.ts、dictionary-result.tsx、i18n/*.json、CLAUDE.md   [改](T7);dictionary-result.test.tsx 新
web/src/features/wordbook/CLAUDE.md、web/src/lib/CLAUDE.md、web/README.md、2026-10-13 计划与真机清单   [改](T8)
docs/changelog/2026-10.json                                       [改](T9,控制者)
```

**车道(git worktree):**

| 车道 | 任务 | 说明 |
|---|---|---|
| 先行 | **T1** | 很小;T3、T7 依赖它,先合并。 |
| W(wordbook,**串行,一个车道**) | **T2 → T3 → T4 → T6** | `choice-question.tsx`(T6)是 A、B 共用文件,只在这个车道里改一次;`review-page.tsx`(T3、T6)、`locales/*.json`(T2、T6)、`review-after-answer.test.tsx`(T3、T6)也都在本车道内顺序修改。 |
| P(并行) | **T5** | 只新建 4 个文件,不碰任何现有文件;T1 之前或之后都可开始。**T6 开始前必须已合并。** |
| L(并行) | **T7** | 只碰 `features/lookup` 的文件;T1 合并后开始。 |
| 收尾 | **T8** | 全部合并后;文档与自检。 |
| 控制者 | **T9** | 合并、部署并核对后由控制者写更新日志草稿。 |

合并顺序:T1 →(W: T2, T3, T4)∥ T5 ∥ T7 → T6 → T8 → T9。

---

## Task T1:`ZhToggle` 共享组件

**Files:** Create `web/src/components/zh-toggle.tsx`、`web/src/components/zh-toggle.test.tsx`;Modify `web/src/components/CLAUDE.md`。

- [ ] **Step 1(测试):** Write `web/src/components/zh-toggle.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ZhToggle } from "./zh-toggle";

describe("ZhToggle (plan 2026-10-14-review-bilingual-longpress R-Z2)", () => {
  it("is a 44 px toggle button named by its visible label, with aria-pressed", async () => {
    const onToggle = vi.fn();
    const { rerender } = render(<ZhToggle pressed={false} onToggle={onToggle} label="中文" />);
    const btn = screen.getByRole("button", { name: "中文" });
    expect(btn).toHaveAttribute("type", "button");
    expect(btn).toHaveAttribute("aria-pressed", "false");
    expect(btn).toHaveAttribute("data-testid", "zh-toggle");
    expect(btn.className).toMatch(/\bmin-h-tap\b/);
    expect(btn.className).toMatch(/\bmin-w-tap\b/);
    await userEvent.click(btn);
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(<ZhToggle pressed onToggle={onToggle} label="中文" />);
    expect(screen.getByRole("button", { name: "中文" })).toHaveAttribute("aria-pressed", "true");
  });

  it("takes a test id and extra classes from the caller", () => {
    render(<ZhToggle pressed={false} onToggle={vi.fn()} label="Chinese" testId="after-zh" className="mt-2.5" />);
    const btn = screen.getByTestId("after-zh");
    expect(btn).toHaveTextContent("Chinese");
    expect(btn.className).toMatch(/\bmt-2\.5\b/);
  });
});
```
- [ ] **Step 2:** Run `cd web && yarn vitest run src/components/zh-toggle.test.tsx` — 失败(模块不存在)。
- [ ] **Step 3:** Write `web/src/components/zh-toggle.tsx`:
```tsx
import { cn } from "~/lib/cn";

export interface ZhToggleProps {
  /** 当前是否显示中文 */
  pressed: boolean;
  onToggle: () => void;
  /** 可见文字(「中文」/ "Chinese"),由调用方从自己的文案传入;本组件不含文案 */
  label: string;
  testId?: string;
  className?: string;
}

/**
 * 「中文」切换按钮(计划 2026-10-14-review-bilingual-longpress R-Z2 / R-Z4):复习页答后「学习内容」区与查词抽屉共用。
 * 无状态;按下后仍显示(再点收回);44 px 命中、aria-pressed,名称就是可见文字。
 */
export function ZhToggle({ pressed, onToggle, label, testId = "zh-toggle", className }: ZhToggleProps) {
  return (
    <button type="button" data-testid={testId} aria-pressed={pressed} onClick={onToggle}
      className={cn(
        "inline-flex min-h-tap min-w-tap items-center justify-center rounded-full border-[0.5px] px-4 text-sub font-semibold",
        "transition-colors duration-fast motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        pressed ? "border-transparent bg-blue-tint text-blue" : "border-hair bg-surface text-ink-2 hover:bg-surface-2",
        className,
      )}>
      {label}
    </button>
  );
}
```
- [ ] **Step 4:** Edit `web/src/components/CLAUDE.md`:在以 `- \`zh-note-fold.tsx\` — \`ZhNoteFold\`` 开头的那一行之后加一行:
  `- \`zh-toggle.tsx\` — \`ZhToggle\`: stateless 「中文」 pill (\`aria-pressed\`, 44 px). No copy of its own (callers pass the label). Used by the wordbook after-answer panel and the lookup drawer (plan \`2026-10-14-review-bilingual-longpress\`).`
- [ ] **Step 5:** Run `cd web && yarn vitest run src/components/zh-toggle.test.tsx src/architecture.test.ts && cd .. && yarn web:typecheck` — 全绿。
- [ ] **Step 6:** Commit `feat(web): add a shared 中文 toggle chip`。

---

## Task T2:`zhReveal` · `PhrasesSection.showZh` · 文案键(车道 W)

**Files:** Modify `web/src/features/wordbook/def-lang.ts`、`phrases-section.tsx`、`locales/en.json`、`locales/zh-CN.json`;Create `zh-reveal.test.ts`、`phrases-section-zh.test.tsx`。

- [ ] **Step 1(测试):** Write `web/src/features/wordbook/zh-reveal.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { zhReveal } from "./def-lang";

const BOTH = {
  senses: [{ pos: "v", text: "说话" }],
  defsEn: [{ pos: "v", text: "speak to someone" }],
  phrases: [{ en: "talk about", zh: "谈论" }],
};

describe("zhReveal (plan 2026-10-14-review-bilingual-longpress R-Z2 / R-Z3)", () => {
  it("hides Chinese senses and phrase translations under English-only and offers the chip; peek brings both back", () => {
    expect(zhReveal("en", BOTH, false)).toMatchObject({ phraseZh: false, chip: true, view: { showSenses: false, showDefs: true } });
    expect(zhReveal("en", BOTH, true)).toMatchObject({ phraseZh: true, chip: true, view: { showSenses: true, showDefs: true } });
  });

  it.each(["zh", "both"] as const)("shows Chinese with no chip under '%s'", (lang) => {
    expect(zhReveal(lang, BOTH, false)).toMatchObject({ phraseZh: true, chip: false, view: { showSenses: true } });
  });

  it("falls back to Chinese with no chip when the word has no English definition", () => {
    expect(zhReveal("en", { ...BOTH, defsEn: [] }, false)).toMatchObject({ phraseZh: true, chip: false, view: { showSenses: true, showDefs: false } });
  });

  it("offers the chip for phrase translations alone, and none when there is no Chinese at all", () => {
    expect(zhReveal("en", { ...BOTH, senses: [] }, false)).toMatchObject({ phraseZh: false, chip: true });
    expect(zhReveal("en", { senses: [], defsEn: BOTH.defsEn, phrases: [{ en: "talk about", zh: " " }] }, false).chip).toBe(false);
  });
});
```
  Write `web/src/features/wordbook/phrases-section-zh.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "~/i18n";
import { PhrasesSection } from "./phrases-section";

const PHRASES = [{ en: "talk about", zh: "谈论" }, { en: "talk back", zh: "顶嘴" }];

beforeEach(() => { localStorage.clear(); void i18n.changeLanguage("zh-CN"); });
afterEach(() => { void i18n.changeLanguage("en"); });

describe("PhrasesSection · showZh (R-Z3)", () => {
  it("shows the translations by default (other pages unchanged)", () => {
    render(<PhrasesSection phrases={PHRASES} mode />);
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("talk about 谈论");
  });

  it("hides the translations in the summary and in the list when showZh is false", async () => {
    render(<PhrasesSection phrases={PHRASES} mode={false} showZh={false} />);
    const summary = document.querySelector("summary")!;
    expect(summary).toHaveTextContent("talk about");
    expect(summary).not.toHaveTextContent("谈论");
    await userEvent.click(summary);
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("talk about");
    expect(items[0]).not.toHaveTextContent("谈论");
    expect(items[1]).not.toHaveTextContent("顶嘴");
  });
});
```
- [ ] **Step 2:** Run `cd web && yarn vitest run src/features/wordbook/zh-reveal.test.ts src/features/wordbook/phrases-section-zh.test.tsx` — 失败。
- [ ] **Step 3:** Edit `web/src/features/wordbook/def-lang.ts`:在文件**末尾**追加:
```ts

export interface ZhReveal { view: DefView; phraseZh: boolean; chip: boolean }

/**
 * 答后「学习内容」区与受控词卡的「中文」按钮(计划 2026-10-14-review-bilingual-longpress R-Z2 / R-Z3)。纯函数,建在 defView 之上:
 * 偏好「仅英文」且这个词有英文释义时,中文释义行与短语译文默认藏起,`peek` 带回;`chip` = 有中文可带回(中文释义或任一短语译文)。
 * 偏好 zh / both、没有英文释义的词:中文直接显示,没有按钮。
 */
export function zhReveal(defLang: DefLang, card: Pick<Card, "senses" | "defsEn" | "phrases">, peek = false): ZhReveal {
  const view = defView(defLang, card, peek);
  const hidesZh = defLang === "en" && view.groups.length > 0;
  const hasZh = card.senses.length > 0 || card.phrases.some((p) => p.zh.trim() !== "");
  return { view, phraseZh: !hidesZh || peek, chip: hidesZh && hasZh };
}
```
- [ ] **Step 4:** Edit `web/src/features/wordbook/phrases-section.tsx`(三处单行替换):
  1. `export function PhrasesSection({ phrases, mode }: { phrases: readonly Phrase[]; mode: PhrasesOpen }) {`
     → `export function PhrasesSection({ phrases, mode, showZh = true }: { phrases: readonly Phrase[]; mode: PhrasesOpen; showZh?: boolean }) {`
  2. `          {open ? null : <> · <span lang="en">{first.en}</span> {first.zh}</>}`
     → `          {open ? null : showZh ? <> · <span lang="en">{first.en}</span> {first.zh}</> : <> · <span lang="en">{first.en}</span></>}`
  3. `          <li key={i}><span lang="en" className="font-medium text-ink">{p.en}</span> <span className="text-ink-2">{p.zh}</span></li>`
     → `          <li key={i}>{showZh ? <><span lang="en" className="font-medium text-ink">{p.en}</span> <span className="text-ink-2">{p.zh}</span></> : <span lang="en" className="font-medium text-ink">{p.en}</span>}</li>`
  并在组件文档注释的 ` * 收起状态的 DOM 与改动前逐字节相同(word-card-legacy 金标准)。` 一行之后加一行:
  ` * \`showZh\`(默认 true):false = 不显示短语译文(复习页答后区「中文」未按下时,计划 2026-10-14 R-Z3);true 时 DOM 与改动前逐字节相同。`
- [ ] **Step 5:** Edit `web/src/features/wordbook/locales/en.json`:在 `        "hint": "Double-tap an option to look it up",` 之后插入两行:
```
        "zh": "Chinese",
        "longPressHint": "Press and hold a word in an option to look it up",
```
  Edit `web/src/features/wordbook/locales/zh-CN.json`:在 `        "hint": "双击选项可查词",` 之后插入两行:
```
        "zh": "中文",
        "longPressHint": "长按选项里的单词可查询",
```
- [ ] **Step 6:** Run `cd web && yarn vitest run src/features/wordbook/zh-reveal.test.ts src/features/wordbook/phrases-section-zh.test.tsx src/features/wordbook/phrases-section.test.tsx src/features/wordbook/word-card-legacy.test.tsx src/features/wordbook/locales.test.ts src/features/wordbook/def-lang.test.ts src/architecture.test.ts && cd .. && yarn web:typecheck` — 全绿(快照**不得**更新)。
- [ ] **Step 7:** Commit `feat(web): add the wordbook 中文 reveal rule and optional phrase translations`。

---

## Task T3:答后区「中文」按钮 · `WordCardView` 受控模式 · 复习页接线(车道 W,依赖 T1、T2)

**Files:** Replace `web/src/features/wordbook/after-answer-panel.tsx`;Modify `word-card.tsx`、`review-page.tsx`、`after-answer-panel.test.tsx`、`review-after-answer.test.tsx`;Create `word-card-zh-chip.test.tsx`。

- [ ] **Step 1(测试):** Edit `web/src/features/wordbook/after-answer-panel.test.tsx`:
  1. 把 `view` 帮手整段(从 `const view = (q: Question, c: Card | undefined,` 到它的 `};`)换成:
```tsx
type Extra = { defLang?: "en" | "zh" | "both"; peek?: boolean; result?: ReturnType<typeof result>; onPeek?: () => void };
const view = (q: Question, c: Card | undefined, extra: Extra = {}) => {
  const onListen = vi.fn();
  const onPeek = extra.onPeek ?? vi.fn();
  render(<AfterAnswerPanel question={q} result={extra.result ?? result()} card={c} defLang={extra.defLang ?? "en"} peek={extra.peek ?? false}
    onPeek={onPeek} onListen={onListen} canListen />);
  return { onListen, onPeek };
};
```
  2. 第一个用例里 `expect(phrases[0]).toHaveTextContent("talk about 谈论");` 改成两行:
```tsx
    expect(phrases[0]).toHaveTextContent("talk about");
    expect(phrases[0]).not.toHaveTextContent("谈论"); // 短语译文跟着「中文」(R-Z3)
```
  3. 把用例 `it("brings the Chinese lines back with peek", () => {…});` 整个换成:
```tsx
  it("brings the Chinese lines and the phrase translations back with peek; the chip stays, pressed", () => {
    view(meaningQ, talkCard(), { peek: true });
    const panel = screen.getByTestId("after-answer-panel");
    expect(panel).toHaveTextContent("说话；谈话");
    expect(panel).toHaveTextContent("talk about 谈论");
    expect(screen.getByTestId("word-defs-en")).toBeTruthy();
    expect(screen.getByTestId("after-zh")).toHaveAttribute("aria-pressed", "true");
  });

  it("shows a visible 中文 chip under English-only that asks the page to reveal Chinese", async () => {
    const { onPeek } = view(meaningQ, talkCard());
    const chip = screen.getByTestId("after-zh");
    expect(chip).toHaveTextContent("中文");
    expect(chip).toHaveAttribute("aria-pressed", "false");
    expect(chip.className).toMatch(/\bmin-h-tap\b/);
    await userEvent.click(chip);
    expect(onPeek).toHaveBeenCalledTimes(1);
  });

  it("has no chip under 'zh' / 'both' or for a word that fell back to Chinese", () => {
    for (const defLang of ["zh", "both"] as const) {
      const { unmount } = render(<AfterAnswerPanel question={meaningQ} result={result()} card={talkCard()} defLang={defLang} peek={false} onPeek={vi.fn()} onListen={vi.fn()} />);
      expect(screen.queryByTestId("after-zh")).toBeNull();
      expect(screen.getByTestId("after-answer-panel")).toHaveTextContent("talk about 谈论");
      unmount();
    }
    view(meaningQ, talkCard({ defs_en: undefined }));
    expect(screen.queryByTestId("after-zh")).toBeNull();
  });
```
  4. 把用例 `it("follows def_lang through the card's own 中 switch under English-only", () => {…});` 整个换成:
```tsx
  it("uses the same 中文 chip instead of the card's small 中 switch, driven by the page", async () => {
    const { onPeek } = view(wordQ, talkCard(), { defLang: "en" });
    const wc = screen.getByTestId("word-card");
    expect(wc).not.toHaveTextContent("说话；谈话");
    expect(screen.queryByTestId("def-peek")).toBeNull();
    await userEvent.click(within(wc).getByTestId("after-zh"));
    expect(onPeek).toHaveBeenCalledTimes(1);
  });

  it("shows the card's Chinese senses when peek is on", () => {
    view(wordQ, talkCard(), { defLang: "en", peek: true });
    expect(screen.getByTestId("word-card")).toHaveTextContent("说话；谈话");
    expect(screen.getByTestId("after-zh")).toHaveAttribute("aria-pressed", "true");
  });
```
  Write `web/src/features/wordbook/word-card-zh-chip.test.tsx`(受控模式;不传 `onPeek` 的旧行为由 `word-card-peek.test.tsx` 与 `word-card-legacy` 快照守着):
```tsx
import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import { renderWithProviders } from "~/test/render";
import { DEFS_EN, card } from "./test-fixtures";
import { WordCardView } from "./word-card";
import type { Card } from "./wordbook-api";

const WITH_DEFS = { ...card("talk", { senses: [{ pos: "v", text: "说话；谈话" }], phrases: [{ en: "talk about", zh: "谈论" }] }), defsEn: DEFS_EN } as unknown as Card;

beforeEach(() => {
  localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
  void i18n.changeLanguage("zh-CN");
});
afterEach(() => {
  localStorage.removeItem("enjoy-web.settings");
  void i18n.changeLanguage("en");
});

describe("WordCardView · controlled 中文 chip (R-Z2)", () => {
  it("replaces the small 中 switch with the chip and hides phrase translations until peek", () => {
    renderWithProviders(<WordCardView card={WITH_DEFS} defLang="en" peek={false} onPeek={vi.fn()} />);
    expect(screen.queryByTestId("def-peek")).toBeNull();
    expect(screen.getByTestId("after-zh")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("word-card")).not.toHaveTextContent("说话；谈话");
    expect(document.querySelector("summary")).not.toHaveTextContent("谈论");
  });

  it("follows the peek prop", () => {
    renderWithProviders(<WordCardView card={WITH_DEFS} defLang="en" peek onPeek={vi.fn()} />);
    expect(screen.getByTestId("word-card")).toHaveTextContent("说话；谈话");
    expect(document.querySelector("summary")).toHaveTextContent("谈论");
  });

  it("has no chip under 'both'", () => {
    renderWithProviders(<WordCardView card={WITH_DEFS} defLang="both" peek={false} onPeek={vi.fn()} />);
    expect(screen.queryByTestId("after-zh")).toBeNull();
  });
});
```
  Edit `web/src/features/wordbook/review-after-answer.test.tsx`:把用例 `it("the 中 switch shows Chinese on the rows and in the panel, and resets for the next question", async () => {…});` 整个换成(本任务里题卡的 `option-peek` 还在,但不再是带回中文的入口):
```tsx
  it("the 中文 chip in the study panel shows Chinese senses and phrase translations, and resets for the next question", async () => {
    const user = userEvent.setup();
    setup();
    await startAndAnswer(user, /v\. 放弃；抛弃/);
    const panel = screen.getByTestId("after-answer-panel");
    expect(panel).not.toHaveTextContent("认输");
    await user.click(within(panel).getByTestId("after-zh"));
    expect(screen.getByTestId("after-answer-panel")).toHaveTextContent("接受；承认");
    expect(screen.getByTestId("after-answer-panel")).toHaveTextContent("accept defeat 认输");
    expect(screen.getByTestId("after-zh")).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "继续" }));
    await user.click(await screen.findByRole("button", { name: /carry/ }));
    await screen.findAllByTestId("choice-option");
    const wc = screen.getByTestId("word-card");
    expect(within(wc).getByTestId("after-zh")).toHaveAttribute("aria-pressed", "false"); // 换题复位
    expect(wc).not.toHaveTextContent("携带；搬运");
  });
```
- [ ] **Step 2:** Run `cd web && yarn vitest run src/features/wordbook/after-answer-panel.test.tsx src/features/wordbook/word-card-zh-chip.test.tsx src/features/wordbook/review-after-answer.test.tsx` — 新用例失败。
- [ ] **Step 3:** Replace `web/src/features/wordbook/after-answer-panel.tsx` 整文件:
```tsx
import { useTranslation } from "react-i18next";
import { SurfaceCard } from "~/components/surface-card";
import { ZhToggle } from "~/components/zh-toggle";
import { zhReveal } from "./def-lang";
import { DefinitionsEn } from "./defs-en";
import { cardForPanel } from "./option-view";
import { PhrasesSection } from "./phrases-section";
import { ListenButton, WordCardView, posLabel, type ListenProps } from "./word-card";
import type { AnswerResult, Card, DefLang, Question } from "./wordbook-api";
import "./locales";

export const AFTER_MAX_PHRASES = 3;
const MAX_SENSES = 4;

/**
 * 复习页答题后题目下方的「学习内容」(spec 2026-10-13-review-after-answer D1 / D3,计划 R-A10 / R-A11;
 * 「中文」按钮:计划 2026-10-14-review-bilingual-longpress R-Z2 / R-Z3):
 * - `meaning`(英→中):正确单词 + 英英释义 + 短语(最多 3 条,展开)+ 朗读。偏好「仅英文」且有英文释义时,中文释义与短语译文藏在
 *   「中文」按钮后面(`peek` 由复习页持有,换题复位);偏好 zh / both 或没有英文释义的词直接显示中文,没有按钮。不显示例句。
 * - `word`(中→英):正确单词的卡片 `WordCardView` 受控模式(同一个「中文」按钮,不画卡片右上角的「中」)。
 * 词卡优先取批次里的;没有时用答案里正确选项的 `optionInfo` + `phrases` + `example` 拼一张;都没有就什么也不渲染。
 */
export function AfterAnswerPanel({ question, result, card, defLang, peek, onPeek, onListen, listening, canListen }: ListenProps & {
  question: Question;
  result: Pick<AnswerResult, "optionInfo" | "correctOption" | "phrases" | "example">;
  card: Card | undefined;
  defLang: DefLang;
  peek: boolean;
  onPeek: () => void;
}) {
  const { t } = useTranslation();
  const shown = cardForPanel(card, question, result);
  if (!shown) return null;
  const listen = { onListen, listening, canListen };
  if (question.qtype === "word") {
    return (
      <WordCardView card={shown} defLang={defLang} eyebrow={t("web.wordbookDefs.after.title")} className="mt-3" phrasesOpen={false}
        peek={peek} onPeek={onPeek} {...listen} />
    );
  }
  const { view, phraseZh, chip } = zhReveal(defLang, shown, peek);
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
      {chip ? <ZhToggle pressed={peek} onToggle={onPeek} label={t("web.wordbookDefs.after.zh")} testId="after-zh" className="mt-2.5" /> : null}
      <PhrasesSection phrases={shown.phrases.slice(0, AFTER_MAX_PHRASES)} mode showZh={phraseZh} />
    </SurfaceCard>
  );
}
```
- [ ] **Step 4:** Edit `web/src/features/wordbook/word-card.tsx`(全部单行锚点):
  1. 在 import 区加一行 `import { ZhToggle } from "~/components/zh-toggle";`(放在其它 `~/components/…` 导入旁;没有的话放在 `@renderer/…` 导入之后)。
  2. `import { DEFAULT_DEF_LANG, defView } from "./def-lang";` → `import { DEFAULT_DEF_LANG, zhReveal } from "./def-lang";`
  3. `  defLang = DEFAULT_DEF_LANG, phrasesOpen = false,` → `  defLang = DEFAULT_DEF_LANG, phrasesOpen = false, peek: peekProp, onPeek,`
  4. `  defLang?: DefLang; phrasesOpen?: PhrasesOpen;` → 两行:
```tsx
  defLang?: DefLang; phrasesOpen?: PhrasesOpen;
  /** 受控「中文」(复习页答后区,计划 2026-10-14 R-Z2):传了 onPeek 就不画右上角「中」,改在英文释义下方画「中文」按钮,短语译文跟随 */
  peek?: boolean; onPeek?: () => void;
```
  5. `  const peek = peekKey === card.key;` → 两行:
```tsx
  const controlled = onPeek !== undefined;
  const peek = controlled ? peekProp === true : peekKey === card.key;
```
  6. `  const { groups: defGroups, showDefs, showSenses, canPeek } = defView(defLang, card, peek);` → `  const { view: { groups: defGroups, showDefs, showSenses, canPeek }, phraseZh, chip } = zhReveal(defLang, card, peek);`
  7. `  const peekButton = canPeek && !covered ? (` → `  const peekButton = canPeek && !covered && !controlled ? (`
  8. `          {showDefs ? <DefinitionsEn groups={defGroups} className={showSenses ? "mt-1.5" : "mt-3.5"} /> : null}` → 两行:
```tsx
          {showDefs ? <DefinitionsEn groups={defGroups} className={showSenses ? "mt-1.5" : "mt-3.5"} /> : null}
          {onPeek && chip ? <ZhToggle pressed={peek} onToggle={onPeek} label={t("web.wordbookDefs.after.zh")} testId="after-zh" className="mt-2.5" /> : null}
```
  9. `          <PhrasesSection phrases={card.phrases.slice(0, MAX_PHRASES)} mode={phrasesOpen} />` → `          <PhrasesSection phrases={card.phrases.slice(0, MAX_PHRASES)} mode={phrasesOpen} showZh={!controlled || phraseZh} />`
- [ ] **Step 5:** Edit `web/src/features/wordbook/review-page.tsx`:`            peek={peekSlot === slot} {...listen} />` → `            peek={peekSlot === slot} onPeek={() => setPeekSlot((s) => (s === slot ? null : slot))} {...listen} />`
- [ ] **Step 6:** Run `cd web && yarn vitest run src/features/wordbook/after-answer-panel.test.tsx src/features/wordbook/word-card-zh-chip.test.tsx src/features/wordbook/word-card-peek.test.tsx src/features/wordbook/word-card-legacy.test.tsx src/features/wordbook/word-card-defs.test.tsx src/features/wordbook/review-after-answer.test.tsx src/features/wordbook/review-page.test.tsx src/features/wordbook/learn-page.test.tsx src/architecture.test.ts && cd .. && yarn web:typecheck` — 全绿,快照不更新。
- [ ] **Step 7:** Commit `feat(web): put a 中文 chip in the review study panel`。

---

## Task T4:一次性提示改为长按(车道 W,依赖 T2 的文案键)

**Files:** Create `web/src/features/wordbook/long-press-pref.ts`、`long-press-pref.test.ts`、`long-press-hint.tsx`、`long-press-hint.test.tsx`。(旧的 `double-tap-pref*` / `double-tap-hint*` 在 T6 删除。)

- [ ] **Step 1(测试):** Write `long-press-pref.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WORDBOOK_PREFS_KEY } from "~/lib/storage";
import { readLongPressHintSeen, writeLongPressHintSeen } from "./long-press-pref";
import { writePhrasesPref } from "./phrases-pref";
import { readPrefs, writePrefs } from "./spell/prefs";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("long-press hint preference (device-local, R-L6)", () => {
  it("is unseen until it has been shown once, even for someone who saw the old double-tap hint", () => {
    localStorage.setItem(WORDBOOK_PREFS_KEY, JSON.stringify({ doubleTapHintSeen: true }));
    expect(readLongPressHintSeen()).toBe(false);
    writeLongPressHintSeen();
    expect(readLongPressHintSeen()).toBe(true);
  });

  it("shares the wordbook prefs key without clobbering the other fields", () => {
    writePrefs({ showLength: true });
    writePhrasesPref(false);
    writeLongPressHintSeen();
    expect(JSON.parse(localStorage.getItem(WORDBOOK_PREFS_KEY)!)).toEqual({ showLength: true, phrasesOpen: false, longPressHintSeen: true });
    writePrefs({ showLength: false });
    expect(readLongPressHintSeen()).toBe(true);
    expect(readPrefs().showLength).toBe(false);
  });

  it("treats garbage as unseen and never throws when storage is unavailable", () => {
    localStorage.setItem(WORDBOOK_PREFS_KEY, "{nope");
    expect(readLongPressHintSeen()).toBe(false);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    expect(() => writeLongPressHintSeen()).not.toThrow();
    expect(readLongPressHintSeen()).toBe(false);
  });
});
```
  Write `long-press-hint.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import { LongPressHint } from "./long-press-hint";
import { readLongPressHintSeen } from "./long-press-pref";

beforeEach(() => {
  localStorage.clear();
  void i18n.changeLanguage("zh-CN");
});
afterEach(() => {
  vi.restoreAllMocks();
  void i18n.changeLanguage("en");
});

describe("LongPressHint", () => {
  it("shows once, remembers it, and a later instance stays hidden", () => {
    const first = render(<LongPressHint />);
    expect(screen.getByTestId("long-press-hint")).toHaveTextContent("长按选项里的单词可查询");
    expect(readLongPressHintSeen()).toBe(true);
    first.unmount();
    render(<LongPressHint />);
    expect(screen.queryByTestId("long-press-hint")).toBeNull();
  });

  it("is not a live region (the result line is the page's only status)", () => {
    render(<LongPressHint />);
    expect(screen.getByTestId("long-press-hint")).not.toHaveAttribute("role");
  });

  it("keeps showing when storage is unavailable, without throwing", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
    render(<LongPressHint />);
    expect(screen.getByTestId("long-press-hint")).toBeTruthy();
  });
});
```
- [ ] **Step 2:** Run `cd web && yarn vitest run src/features/wordbook/long-press-pref.test.ts src/features/wordbook/long-press-hint.test.tsx` — 失败。
- [ ] **Step 3:** Write `web/src/features/wordbook/long-press-pref.ts`:
```ts
import { WORDBOOK_PREFS_KEY, readJson, writeJson } from "~/lib/storage";

/**
 * 「长按选项里的单词可查询」一次性提示的本机记忆(计划 2026-10-14-review-bilingual-longpress R-L6):布尔 `longPressHintSeen`,
 * 与拼写偏好、短语偏好共用 `WORDBOOK_PREFS_KEY` 的 JSON(合并写入,不覆盖别的字段;退出登录由 clearDeviceData 整键清除)。
 * 旧字段 `doubleTapHintSeen` 不读不删(无害)。不含任何词。存储不可用时读到 false、写入静默丢弃。
 */
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function readLongPressHintSeen(): boolean {
  return readJson(WORDBOOK_PREFS_KEY, isObject)?.longPressHintSeen === true;
}

export function writeLongPressHintSeen(): void {
  const stored = readJson(WORDBOOK_PREFS_KEY, isObject) ?? {};
  writeJson(WORDBOOK_PREFS_KEY, { ...stored, longPressHintSeen: true });
}
```
  Write `web/src/features/wordbook/long-press-hint.tsx`:
```tsx
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { readLongPressHintSeen, writeLongPressHintSeen } from "./long-press-pref";
import "./locales";

/**
 * 一次性提示「长按选项里的单词可查询」(计划 2026-10-14-review-bilingual-longpress R-L6):挂载时读本机记忆,没看过就显示并马上记下;
 * 这一道题内一直显示,之后每个新实例读到「看过」就不显示。没有 role=status(复习页的结果行是唯一的 status)。
 */
export function LongPressHint() {
  const { t } = useTranslation();
  const [show] = useState(() => !readLongPressHintSeen());
  useEffect(() => {
    if (show) writeLongPressHintSeen();
  }, [show]);
  return show ? <p data-testid="long-press-hint" className="mt-3 text-sub text-ink-2">{t("web.wordbookDefs.after.longPressHint")}</p> : null;
}
```
- [ ] **Step 4:** Run `cd web && yarn vitest run src/features/wordbook/long-press-pref.test.ts src/features/wordbook/long-press-hint.test.tsx src/architecture.test.ts && cd .. && yarn web:typecheck` — 全绿。
- [ ] **Step 5:** Commit `feat(web): add the one-time long-press lookup hint`。

---

## Task T5:长按状态机与 hook(车道 P,可与任何任务并行;只新建文件)

**Files:** Create `web/src/features/wordbook/long-press.ts`、`long-press.test.ts`、`use-long-press.ts`、`use-long-press.test.tsx`。

- [ ] **Step 1(测试):** Write `long-press.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { CLICK_SWALLOW_MS, LONG_PRESS_MS, LONG_PRESS_SLOP_PX, createLongPress, movedTooFar } from "./long-press";

describe("long-press constants (R-L2 / R-L3)", () => {
  it("are 450 ms, 8 px and 400 ms", () => {
    expect([LONG_PRESS_MS, LONG_PRESS_SLOP_PX, CLICK_SWALLOW_MS]).toEqual([450, 8, 400]);
  });
});

describe("movedTooFar", () => {
  it("allows exactly the slop and rejects anything beyond it (Euclidean)", () => {
    expect(movedTooFar({ x: 0, y: 0 }, 8, 0)).toBe(false);
    expect(movedTooFar({ x: 0, y: 0 }, 9, 0)).toBe(true);
    expect(movedTooFar({ x: 0, y: 0 }, 6, 6)).toBe(true); // 8.49 px
    expect(movedTooFar({ x: 10, y: 10 }, 5, 5)).toBe(false);
  });
});

describe("createLongPress", () => {
  it("fires once for a press that is still held when the timer runs out", () => {
    const lp = createLongPress();
    lp.down("a", 0, 0);
    expect(lp.pressing()).toBe(true);
    expect(lp.fire()).toBe("a");
    expect(lp.fire()).toBeNull(); // only once
    expect(lp.pressing()).toBe(false);
  });

  it("does not fire after an early release, a cancel or a move beyond the slop", () => {
    const lp = createLongPress();
    lp.down("a", 0, 0);
    lp.up(100);
    expect(lp.fire()).toBeNull();
    lp.down("a", 0, 0);
    lp.cancel();
    expect(lp.fire()).toBeNull();
    lp.down("a", 0, 0);
    expect(lp.move(3, 3)).toBe(false); // a small wobble is fine
    expect(lp.move(20, 0)).toBe(true);
    expect(lp.fire()).toBeNull();
  });

  it("ignores movement once it has fired (the finger may settle)", () => {
    const lp = createLongPress();
    lp.down("a", 0, 0);
    lp.fire();
    expect(lp.move(50, 50)).toBe(false);
  });

  it("swallows exactly one click right after releasing a fired press", () => {
    const lp = createLongPress();
    lp.down("a", 0, 0);
    lp.fire();
    lp.up(1000);
    expect(lp.swallowClick(1000 + CLICK_SWALLOW_MS)).toBe(true);
    expect(lp.swallowClick(1000 + CLICK_SWALLOW_MS)).toBe(false);
  });

  it("does not swallow a click that comes too late, after a plain tap, or after a cancel", () => {
    const lp = createLongPress();
    lp.down("a", 0, 0);
    lp.fire();
    lp.up(1000);
    expect(lp.swallowClick(1000 + CLICK_SWALLOW_MS + 1)).toBe(false);
    lp.down("a", 0, 0);
    lp.up(2000); // released before firing
    expect(lp.swallowClick(2001)).toBe(false);
    lp.down("a", 0, 0);
    lp.fire();
    lp.cancel();
    expect(lp.swallowClick(3001)).toBe(false);
  });

  it("a new press forgets a pending swallow window", () => {
    const lp = createLongPress();
    lp.down("a", 0, 0);
    lp.fire();
    lp.up(1000);
    lp.down("b", 0, 0);
    lp.up(1050);
    expect(lp.swallowClick(1060)).toBe(false);
  });
});
```
  Write `use-long-press.test.tsx`:
```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLongPress } from "./use-long-press";

let clock = 0;
function Row({ onLong, onClick }: { onLong: (el: HTMLElement) => void; onClick: () => void }) {
  const press = useLongPress(onLong, { now: () => clock });
  return <div data-testid="row" {...press("a")} onClick={onClick}>word</div>;
}
const row = () => screen.getByTestId("row");
const down = (x = 10, y = 10) => fireEvent.pointerDown(row(), { pointerId: 1, clientX: x, clientY: y, button: 0, isPrimary: true });

beforeEach(() => { vi.useFakeTimers(); clock = 0; });
afterEach(() => { vi.useRealTimers(); });

describe("useLongPress (R-L2 / R-L3 / R-L4)", () => {
  it("calls back with the pressed element after 450 ms, not before", () => {
    const onLong = vi.fn();
    render(<Row onLong={onLong} onClick={vi.fn()} />);
    down();
    vi.advanceTimersByTime(449);
    expect(onLong).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onLong).toHaveBeenCalledWith(row());
  });

  it("cancels on a move beyond 8 px, on pointercancel, on scroll and on an early release", () => {
    const onLong = vi.fn();
    render(<Row onLong={onLong} onClick={vi.fn()} />);
    down();
    fireEvent.pointerMove(row(), { pointerId: 1, clientX: 19, clientY: 10 });
    vi.advanceTimersByTime(500);
    down();
    fireEvent.pointerCancel(row(), { pointerId: 1 });
    vi.advanceTimersByTime(500);
    down();
    fireEvent.scroll(document);
    vi.advanceTimersByTime(500);
    down();
    vi.advanceTimersByTime(300);
    fireEvent.pointerUp(row(), { pointerId: 1 });
    vi.advanceTimersByTime(500);
    expect(onLong).not.toHaveBeenCalled();
  });

  it("tolerates a wobble of up to 8 px", () => {
    const onLong = vi.fn();
    render(<Row onLong={onLong} onClick={vi.fn()} />);
    down();
    fireEvent.pointerMove(row(), { pointerId: 1, clientX: 18, clientY: 10 });
    vi.advanceTimersByTime(450);
    expect(onLong).toHaveBeenCalledTimes(1);
  });

  it("ignores a secondary mouse button", () => {
    const onLong = vi.fn();
    render(<Row onLong={onLong} onClick={vi.fn()} />);
    fireEvent.pointerDown(row(), { pointerId: 1, clientX: 10, clientY: 10, button: 2 });
    vi.advanceTimersByTime(600);
    expect(onLong).not.toHaveBeenCalled();
  });

  it("swallows the click that follows the release of a long press, once, and lets later clicks through", () => {
    const onClick = vi.fn();
    render(<Row onLong={vi.fn()} onClick={onClick} />);
    down();
    vi.advanceTimersByTime(450);
    clock = 1000;
    fireEvent.pointerUp(row(), { pointerId: 1 });
    clock = 1010;
    fireEvent.click(row());
    expect(onClick).not.toHaveBeenCalled();
    fireEvent.click(row());
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("lets a plain tap's click through", () => {
    const onClick = vi.fn();
    render(<Row onLong={vi.fn()} onClick={onClick} />);
    down();
    vi.advanceTimersByTime(100);
    fireEvent.pointerUp(row(), { pointerId: 1 });
    fireEvent.click(row());
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("suppresses the native context menu on the element", () => {
    render(<Row onLong={vi.fn()} onClick={vi.fn()} />);
    expect(fireEvent.contextMenu(row())).toBe(false); // default prevented
  });

  it("clears its timer on unmount", () => {
    const onLong = vi.fn();
    const { unmount } = render(<Row onLong={onLong} onClick={vi.fn()} />);
    down();
    unmount();
    vi.advanceTimersByTime(600);
    expect(onLong).not.toHaveBeenCalled();
  });
});
```
- [ ] **Step 2:** Run `cd web && yarn vitest run src/features/wordbook/long-press.test.ts src/features/wordbook/use-long-press.test.tsx` — 失败。
- [ ] **Step 3:** Write `web/src/features/wordbook/long-press.ts`:
```ts
/**
 * 长按判定(计划 2026-10-14-review-bilingual-longpress R-L2 / R-L3):纯状态机,不碰计时器与 DOM。
 * 计时器由 use-long-press.ts 负责:到点时调 fire(),这里只回答「这次按压是否还有效」;时间只用于吞点击窗口(调用方传入)。
 */
export const LONG_PRESS_MS = 450;
export const LONG_PRESS_SLOP_PX = 8;
/** 长按触发并松手后,这段时间内的第一个 click 是同一手势的尾巴,吞掉。 */
export const CLICK_SWALLOW_MS = 400;

export interface Point { x: number; y: number }

export const movedTooFar = (from: Point, x: number, y: number, slop = LONG_PRESS_SLOP_PX): boolean =>
  Math.hypot(x - from.x, y - from.y) > slop;

export function createLongPress(slop = LONG_PRESS_SLOP_PX, swallowMs = CLICK_SWALLOW_MS) {
  let press: (Point & { id: string }) | null = null;
  let fired = false;
  let swallowUntil: number | null = null;
  return {
    /** 按下:开始一次新的按压(忘掉上一次的吞点击窗口) */
    down(id: string, x: number, y: number): void {
      press = { id, x, y };
      fired = false;
      swallowUntil = null;
    },
    /** 移动;超出 slop 就作废这次按压并返回 true(调用方清计时器)。已触发后不再理会移动。 */
    move(x: number, y: number): boolean {
      if (press === null || fired || !movedTooFar(press, x, y, slop)) return false;
      press = null;
      return true;
    },
    /** 计时器到点:按压仍有效就返回它的 id(只触发一次),否则 null。 */
    fire(): string | null {
      if (press === null || fired) return null;
      fired = true;
      return press.id;
    },
    /** 松手:这次按压已触发的话,打开吞点击窗口。 */
    up(at: number): void {
      if (press !== null && fired) swallowUntil = at + swallowMs;
      press = null;
      fired = false;
    },
    /** pointercancel / 滚动:作废,不吞点击(取消后浏览器不会再发 click)。 */
    cancel(): void {
      press = null;
      fired = false;
    },
    /** click 到达:在窗口内就吞(返回 true),只吞一次。 */
    swallowClick(at: number): boolean {
      const hit = swallowUntil !== null && at <= swallowUntil;
      swallowUntil = null;
      return hit;
    },
    /** 正在按着且还没触发 */
    pressing(): boolean {
      return press !== null && !fired;
    },
  };
}
```
  Write `web/src/features/wordbook/use-long-press.ts`:
```ts
import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { LONG_PRESS_MS, createLongPress } from "./long-press";

export interface LongPressProps {
  onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: PointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: PointerEvent<HTMLElement>) => void;
  onClickCapture: (e: MouseEvent<HTMLElement>) => void;
  onContextMenu: (e: MouseEvent<HTMLElement>) => void;
}

/**
 * 长按(计划 2026-10-14-review-bilingual-longpress R-L2–R-L4):返回 `(id) => props`,把 props 展开到要长按的元素上。
 * 按住 `ms`(默认 450)不动 → `onLongPress(元素)`;移动 > 8 px、pointercancel、文档滚动(捕获)、提前松手 → 取消;
 * 触发后松手紧跟的一个 click 在捕获阶段被吞掉;contextmenu 一律 preventDefault(Android 不弹系统选词 / 菜单)。
 * 只认主指针、主键。触控与鼠标都走 Pointer Events。不记日志。
 */
export function useLongPress(
  onLongPress: (el: HTMLElement) => void,
  { ms = LONG_PRESS_MS, now = () => performance.now() }: { ms?: number; now?: () => number } = {},
): (id: string) => LongPressProps {
  const latest = useRef(onLongPress);
  useEffect(() => {
    latest.current = onLongPress;
  });
  const [api] = useState(() => {
    const lp = createLongPress();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let target: HTMLElement | null = null;
    let pointerId: number | null = null;
    const clear = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      document.removeEventListener("scroll", onScroll, true);
    };
    const abort = () => {
      lp.cancel();
      clear();
      pointerId = null;
      target = null;
    };
    function onScroll() {
      abort();
    }
    const mine = (e: { pointerId: number }) => pointerId === null || e.pointerId === pointerId;
    const props = (id: string): LongPressProps => ({
      onPointerDown: (e) => {
        if (e.button > 0 || e.isPrimary === false) return;
        abort();
        pointerId = e.pointerId;
        target = e.currentTarget;
        lp.down(id, e.clientX ?? 0, e.clientY ?? 0);
        document.addEventListener("scroll", onScroll, true);
        timer = setTimeout(() => {
          timer = null;
          document.removeEventListener("scroll", onScroll, true);
          if (lp.fire() !== null && target) latest.current(target);
        }, ms);
      },
      onPointerMove: (e) => {
        if (mine(e) && lp.move(e.clientX ?? 0, e.clientY ?? 0)) clear();
      },
      onPointerUp: (e) => {
        if (!mine(e)) return;
        lp.up(now());
        clear();
        pointerId = null;
        target = null;
      },
      onPointerCancel: (e) => {
        if (mine(e)) abort();
      },
      onClickCapture: (e) => {
        if (!lp.swallowClick(now())) return;
        e.preventDefault();
        e.stopPropagation();
      },
      onContextMenu: (e) => e.preventDefault(),
    });
    return { props, abort };
  });
  useEffect(() => () => api.abort(), [api]);
  return api.props;
}
```
- [ ] **Step 4:** Run `cd web && yarn vitest run src/features/wordbook/long-press.test.ts src/features/wordbook/use-long-press.test.tsx src/architecture.test.ts && cd .. && yarn web:typecheck` — 全绿。若 jsdom 的 `PointerEvent` 丢了 `clientX`(移动用例不取消),按 `hold-to-talk-bar.test.tsx` 的现成写法核对,**不要**改阈值或删用例。
- [ ] **Step 5:** Commit `feat(web): add a long-press gesture for the review options`。

---

## Task T6:`ChoiceQuestion` 双语选项行 + 长按查词;删除双击(车道 W,依赖 T3、T4、T5 已合并)

**Files:** Replace `web/src/features/wordbook/option-view.ts`、`option-view.test.ts`、`choice-question.tsx`、`choice-question-after.test.tsx`;Modify `review-page.tsx`、`review-after-answer.test.tsx`、`locales/{en,zh-CN}.json`;Delete `double-tap.ts`、`double-tap.test.ts`、`double-tap-pref.ts`、`double-tap-pref.test.ts`、`double-tap-hint.tsx`、`double-tap-hint.test.tsx`。

- [ ] **Step 1(测试):** Replace `web/src/features/wordbook/option-view.test.ts` 整文件:
```ts
import { describe, expect, it } from "vitest";
import { cardForPanel, infoFor, optionRowView } from "./option-view";
import type { Card, OptionInfo, Question } from "./wordbook-api";

const OPT = "v. 说话；谈话；n. 交谈";
const TALK: OptionInfo = {
  option: OPT, word: "talk",
  defsZh: [{ pos: "v", text: "说话；谈话" }, { pos: "n", text: "交谈" }, { pos: "n", text: "第三条" }],
  defsEn: [{ pos: "v", text: "speak to someone" }],
};
const BARE: OptionInfo = { option: "v. 放弃", word: "abandon", defsZh: [{ pos: "vt", text: "放弃" }], defsEn: [] }; // 缺口词:没有英文释义
const meaning: Question = { key: "talk", qtype: "meaning", prompt: { word: "talk" }, options: [OPT, "v. 放弃"], length: null };

describe("optionRowView · meaning (R-Z1: bilingual, whatever def_lang says)", () => {
  it("keeps the Chinese option as the main line and adds the English word as the small second line", () => {
    expect(optionRowView("meaning", OPT, TALK)).toEqual({ main: OPT, sub: "talk", word: "talk", wordLine: "sub" });
  });

  it("does the same for a word without an English definition", () => {
    expect(optionRowView("meaning", "v. 放弃", BARE)).toEqual({ main: "v. 放弃", sub: "abandon", word: "abandon", wordLine: "sub" });
  });

  it("has no word (legacy look) when the server sent no info", () => {
    expect(optionRowView("meaning", OPT, undefined)).toEqual({ main: OPT, sub: null, word: null, wordLine: null });
  });
});

describe("optionRowView · word", () => {
  it("shows the word with a small Chinese line and part of speech (spec D3)", () => {
    expect(optionRowView("word", "talk", { ...TALK, option: "talk" })).toEqual({ main: "talk", sub: "v. 说话；谈话；n. 交谈", word: "talk", wordLine: "main" });
  });

  it("uses the option text as the word when there is no info (the option is the word)", () => {
    expect(optionRowView("word", "talk", undefined)).toEqual({ main: "talk", sub: null, word: "talk", wordLine: "main" });
  });

  it("is not a thing for cloze", () => {
    expect(optionRowView("cloze", "talk", undefined)).toEqual({ main: "talk", sub: null, word: null, wordLine: null });
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
  Replace `web/src/features/wordbook/choice-question-after.test.tsx` 整文件:
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
const after = (extra: Partial<AfterAnswer> = {}): AfterAnswer => ({ info: INFO, ...extra });
const view = (q: Question, result: ChoiceResult | null, a?: AfterAnswer) =>
  render(<ChoiceQuestion question={q} result={result} onAnswer={vi.fn()} onListen={vi.fn()} after={a} />);
const rows = () => screen.getAllByTestId("choice-option");
const wordOf = (row: HTMLElement) => within(row).getByTestId("option-word").textContent;
const mainOf = (row: HTMLElement) => within(row).getByTestId("option-main").textContent;
const selected = () => window.getSelection()?.toString() ?? "";
const press = (el: HTMLElement, x = 10, y = 10) =>
  fireEvent.pointerDown(el, { pointerId: 1, clientX: x, clientY: y, button: 0, isPrimary: true });

beforeEach(() => {
  localStorage.clear();
  void i18n.changeLanguage("zh-CN");
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.getSelection()?.removeAllRanges();
  void i18n.changeLanguage("en");
});

describe("ChoiceQuestion before the answer / without `after`", () => {
  it("keeps the options as buttons until there is a result", () => {
    view(meaning, null, after());
    expect(screen.getAllByRole("button").filter((b) => b.closest("li") !== null && b.getAttribute("data-state"))).toHaveLength(3);
    expect(screen.queryByTestId("choice-option")).toBeNull();
    expect(screen.queryByTestId("long-press-hint")).toBeNull();
  });

  it("leaves the learn page / spot-check rendering alone: no `after` means disabled buttons after the answer", () => {
    view(meaning, wrongPick);
    const buttons = screen.getAllByRole("button").filter((b) => b.closest("li") !== null && b.getAttribute("data-state"));
    expect(buttons).toHaveLength(3);
    expect(buttons.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    expect(screen.queryByTestId("choice-option")).toBeNull();
  });

  it("never changes cloze, even with `after`", () => {
    view(cloze, { choice: "stop", correct: false, correctOption: "carry" }, after({ info: undefined }));
    const buttons = screen.getAllByRole("button").filter((b) => b.closest("li") !== null && b.getAttribute("data-state"));
    expect(buttons).toHaveLength(2);
    expect(buttons.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    expect(screen.queryByTestId("choice-option")).toBeNull();
  });
});

describe("ChoiceQuestion · meaning, after the answer (R-Z1: bilingual rows)", () => {
  it("keeps every option's Chinese as the main line and adds its English word underneath, on correct and wrong rows alike", () => {
    view(meaning, wrongPick, after());
    expect(rows().map(mainOf)).toEqual([OPT_TALK, "n. 事故", "v. 放弃"]);
    expect(rows().map(wordOf)).toEqual(["talk", "accident", "abandon"]);
    expect(rows().map((r) => r.getAttribute("data-state"))).toEqual(["correct", "wrong", "idle"]);
    for (const row of rows()) expect(within(row).getByTestId("option-word").closest("small")).not.toBeNull(); // 英文是小字第二行
    expect(rows()[1].querySelector("s")).toBeNull();
  });

  it("has no 中 switch on the question card any more (the study panel owns the 中文 chip)", () => {
    view(meaning, wrongPick, after());
    expect(screen.queryByTestId("option-peek")).toBeNull();
  });

  it("is not a disabled button: a div with touch-action manipulation, no native callout, and a selectable, lookup-ready word", () => {
    view(meaning, wrongPick, after());
    for (const row of rows()) {
      expect(row.tagName).toBe("DIV");
      expect(row.className).toMatch(/\btouch-manipulation\b/);
      expect(row.className).toMatch(/\bselect-none\b/);
      expect(row.className).toContain("[-webkit-touch-callout:none]");
      expect(row).toHaveAttribute("role", "button");
      expect(row).toHaveAttribute("tabindex", "0");
      const word = within(row).getByTestId("option-word");
      expect(word).toHaveAttribute("data-lookup-context");
      expect(word).toHaveAttribute("lang", "en");
      expect(word.className).toMatch(/\bselect-text\b/);
    }
    expect(screen.queryAllByRole("button").filter((b) => b.tagName === "BUTTON" && (b as HTMLButtonElement).disabled)).toHaveLength(0);
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
    expect(screen.queryByTestId("long-press-hint")).toBeNull();
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

  it("shows each word with a small Chinese line and part of speech", () => {
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
    expect(screen.getByTestId("long-press-hint")).toBeTruthy();
  });
});

describe("ChoiceQuestion · long press picks the word for the lookup bar (R-L1–R-L5)", () => {
  beforeEach(() => vi.useFakeTimers());

  it("selects the row's English word after holding for 450 ms", () => {
    view(meaning, wrongPick, after());
    press(rows()[1]);
    vi.advanceTimersByTime(449);
    expect(selected()).toBe("");
    vi.advanceTimersByTime(1);
    expect(selected()).toBe("accident");
  });

  it("works on word questions too (the word is the main line)", () => {
    view(wordQ, { choice: "stop", correct: false, correctOption: "talk" }, after({ info: WORD_INFO }));
    press(rows()[0]);
    vi.advanceTimersByTime(450);
    expect(selected()).toBe("accept");
  });

  it("does nothing for a plain tap, a move beyond 8 px, a pointercancel or a scroll", () => {
    view(meaning, wrongPick, after());
    fireEvent.click(rows()[1], { detail: 1 });
    press(rows()[1]);
    fireEvent.pointerMove(rows()[1], { pointerId: 1, clientX: 30, clientY: 10 });
    vi.advanceTimersByTime(600);
    press(rows()[1]);
    fireEvent.pointerCancel(rows()[1], { pointerId: 1 });
    vi.advanceTimersByTime(600);
    press(rows()[1]);
    fireEvent.scroll(document);
    vi.advanceTimersByTime(600);
    expect(selected()).toBe("");
  });

  it("swallows the click after the release and suppresses the native context menu", () => {
    const outer = vi.fn();
    render(<div onClick={outer}><ChoiceQuestion question={meaning} result={wrongPick} onAnswer={vi.fn()} onListen={vi.fn()} after={after()} /></div>);
    press(rows()[1]);
    vi.advanceTimersByTime(450);
    fireEvent.pointerUp(rows()[1], { pointerId: 1 });
    fireEvent.click(rows()[1], { detail: 1 });
    expect(outer).not.toHaveBeenCalled();
    fireEvent.click(rows()[1], { detail: 1 });
    expect(outer).toHaveBeenCalledTimes(1);
    expect(fireEvent.contextMenu(rows()[1])).toBe(false);
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
    press(rows()[1]);
    vi.advanceTimersByTime(450);
    expect(selected()).toBe("some text");
    elsewhere.remove();
  });

  it("is not active before the answer: holding an option and letting go just answers (R-L1)", () => {
    const onAnswer = vi.fn();
    render(<ChoiceQuestion question={meaning} result={null} onAnswer={onAnswer} onListen={vi.fn()} after={after()} />);
    const option = screen.getByRole("button", { name: /n\. 事故/ });
    press(option);
    vi.advanceTimersByTime(600);
    expect(selected()).toBe("");
    fireEvent.pointerUp(option, { pointerId: 1 });
    fireEvent.click(option);
    expect(onAnswer).toHaveBeenCalledWith("n. 事故");
  });
});

describe("ChoiceQuestion · one-time long-press hint (R-L6)", () => {
  it("shows once after the first answered question and not on the next one", () => {
    const first = view(meaning, wrongPick, after());
    expect(screen.getByTestId("long-press-hint")).toHaveTextContent("长按选项里的单词可查询");
    first.unmount();
    view(wordQ, { choice: "stop", correct: false, correctOption: "talk" }, after({ info: WORD_INFO }));
    expect(screen.queryByTestId("long-press-hint")).toBeNull();
  });
});
```
  Edit `web/src/features/wordbook/review-after-answer.test.tsx`:先 Read;把从 `describe("review page · after the answer (meaning)", () => {` 起到文件末尾的全部内容替换为下面的块(上面的 import、常量、`answerRoute`、`setup`、`rows`、`wordOf`、`startAndAnswer`、`beforeEach` / `afterEach` 保持不动;整文件 Write 亦可):
```tsx
describe("review page · after the answer (meaning)", () => {
  it("keeps the Chinese options with the English word underneath, shows the study panel and the hint; the request body is unchanged", async () => {
    const user = userEvent.setup();
    const mock = setup();
    await startAndAnswer(user, /v\. 放弃；抛弃/);
    expect(rows().map(wordOf)).toEqual(["abandon", "accept", "carry", "stop"]);
    expect(rows().map((r) => within(r).getByTestId("option-main").textContent)).toEqual(["v. 放弃；抛弃", OPT_ACCEPT, "v. 携带；搬运", "v. 停止"]);
    expect(rows().map((r) => r.getAttribute("data-state"))).toEqual(["wrong", "correct", "idle", "idle"]);
    expect(screen.queryByTestId("option-peek")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("正确答案是"); // 仍然只有一个 status
    const panel = screen.getByTestId("after-answer-panel");
    expect(panel).toHaveTextContent("agree to take something offered");
    expect(panel).toHaveTextContent("accept defeat");
    expect(panel).not.toHaveTextContent("接受；承认");
    expect(panel).not.toHaveTextContent("认输");
    expect(within(panel).getByTestId("after-zh")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("long-press-hint")).toHaveTextContent("长按选项里的单词可查询");
    const sent = JSON.parse(String(mock.calls.find((c) => c.url.pathname === "/api/wordbook/answers")?.body)) as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(["book_id", "choice", "key", "mode", "qtype", "tz_offset_minutes"]);
  });

  it("the 中文 chip in the study panel shows Chinese senses and phrase translations, and resets for the next question", async () => {
    const user = userEvent.setup();
    setup();
    await startAndAnswer(user, /v\. 放弃；抛弃/);
    await user.click(within(screen.getByTestId("after-answer-panel")).getByTestId("after-zh"));
    expect(screen.getByTestId("after-answer-panel")).toHaveTextContent("接受；承认");
    expect(screen.getByTestId("after-answer-panel")).toHaveTextContent("accept defeat 认输");
    expect(screen.getByTestId("after-zh")).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "继续" }));
    await user.click(await screen.findByRole("button", { name: /carry/ }));
    await screen.findAllByTestId("choice-option");
    const wc = screen.getByTestId("word-card");
    expect(within(wc).getByTestId("after-zh")).toHaveAttribute("aria-pressed", "false"); // 换题复位
    expect(wc).not.toHaveTextContent("携带；搬运");
    expect(screen.queryByTestId("long-press-hint")).toBeNull(); // 只提示一次
  });

  it("honours def_lang 'zh': Chinese rows (as always), no chip, Chinese in the panel", async () => {
    const user = userEvent.setup();
    setup({ ...CONFIG, def_lang: "zh" });
    await startAndAnswer(user, /v\. 放弃；抛弃/);
    expect(rows()[0]).toHaveTextContent("v. 放弃；抛弃");
    expect(screen.queryByTestId("after-zh")).toBeNull();
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
    expect(screen.queryByTestId("long-press-hint")).toBeNull();
    expect(screen.getByTestId("after-answer-panel")).toHaveTextContent("agree to take something offered");
  });
});

describe("review page · after the answer (word and cloze)", () => {
  it("shows words with Chinese and part of speech under the options and the correct word's card below, with the 中文 chip", async () => {
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
    expect(within(wc).getByTestId("after-zh")).toBeTruthy();
    expect(within(wc).queryByTestId("def-peek")).toBeNull();
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

describe("review page · long press opens the lookup bar", () => {
  it("selects the option's word after a hold and the global selection bar appears", async () => {
    const user = userEvent.setup();
    setup();
    await startAndAnswer(user, /v\. 放弃；抛弃/);
    fireEvent.pointerDown(rows()[2], { pointerId: 1, clientX: 10, clientY: 10, button: 0, isPrimary: true });
    await waitFor(() => expect(window.getSelection()?.toString()).toBe("carry"), { timeout: 1500 });
    fireEvent.pointerUp(rows()[2], { pointerId: 1 });
    expect(await screen.findByTestId("lookup-bar")).toBeTruthy();
    expect(screen.getByTestId("lookup-trigger")).toBeTruthy();
  });
});
```
- [ ] **Step 2:** Run `cd web && yarn vitest run src/features/wordbook/option-view.test.ts src/features/wordbook/choice-question-after.test.tsx src/features/wordbook/review-after-answer.test.tsx` — 失败(新形状 / 长按尚未实现)。
- [ ] **Step 3:** Replace `web/src/features/wordbook/option-view.ts` 整文件:
```ts
// 答后选项行与「学习内容」区的纯函数(计划 2026-10-13-review-after-answer R-A11;选项行双语:2026-10-14-review-bilingual-longpress R-Z1)。
import { meaningLine } from "./word-card";
import type { AnswerResult, Card, OptionInfo, QType, Question } from "./wordbook-api";

export interface OptionRowView {
  /** 第一行:meaning 题 = 选项原文(服务端的中文释义行);word 题 = 英文单词;没有信息 = 选项原文 */
  main: string;
  /** 第二行小字:meaning 题 = 英文单词;word 题 = 「词性. 中文」;null = 没有 */
  sub: string | null;
  /** 长按查的英文单词;null = 这行没有可查的词(旧服务端的 meaning 题 / cloze),按原来的样子显示 */
  word: string | null;
  /** 英文单词在哪一行 */
  wordLine: "main" | "sub" | null;
}

/** 按 `option` 文本匹配(不按下标:备忘可能来自另一次出题,宁可没信息也不错位)。 */
export const infoFor = (infos: readonly OptionInfo[] | undefined, option: string): OptionInfo | undefined =>
  infos?.find((i) => i.option === option);

/**
 * 一个选项答题后显示什么(R-Z1:与 def_lang 无关,中文永远在)。
 * meaning 题:选项原文(中文)为主行 + 小字英文单词(正确项、错误项、未选项一样);word 题:英文单词 + 小字「词性. 中文」(spec D3)。
 */
export function optionRowView(qtype: QType, option: string, info: OptionInfo | undefined): OptionRowView {
  if (qtype === "word") {
    const word = info?.word ?? option;
    return { main: word, sub: info ? meaningLine(info.defsZh ?? [], 40) || null : null, word, wordLine: "main" };
  }
  if (qtype === "meaning" && info) return { main: option, sub: info.word, word: info.word, wordLine: "sub" };
  return { main: option, sub: null, word: null, wordLine: null };
}

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
- [ ] **Step 4:** Replace `web/src/features/wordbook/choice-question.tsx` 整文件(`ClozeSentence`、题面三分支、答题前的 `<button>` 分支、`correctOptionOf` 与改动前**逐字相同**,只改 import、`AfterAnswer`、组件开头、眉题、答后行、提示):
```tsx
import { CheckIcon, CircleCheckIcon, XIcon } from "lucide-react";
import type { KeyboardEvent, MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@renderer/lib/utils";
import { SurfaceCard } from "~/components/surface-card";
import { selectWord } from "~/lib/select-word";
import { LongPressHint } from "./long-press-hint";
import { infoFor, optionRowView } from "./option-view";
import { useLongPress } from "./use-long-press";
import { ListenButton, type ListenProps } from "./word-card";
import type { AnswerResult, OptionInfo, Question } from "./wordbook-api";
import "./locales";

/** 选择题作答结果:你选的项、是否正确、正确项文本(不知道时为 null)。 */
export interface ChoiceResult { choice: string; correct: boolean; correctOption: string | null }

/**
 * 答题后界面的开关(计划 2026-10-13-review-after-answer R-A7):只有复习页在答题后传它。传了(且不是 cloze)才把选项换成
 * 非禁用的普通容器 + 长按查词 + 一次性提示;没传(学新词页、抽查题)逐字节保持原来的禁用按钮。
 * 选项行本身就是双语的(计划 2026-10-14-review-bilingual-longpress R-Z1),「中文」按钮在「学习内容」区,不在这里。
 */
export interface AfterAnswer {
  /** `/answers` 的 optionInfo;老服务端 / 备忘取不到 / 非 meaning·word 题为 undefined */
  info?: OptionInfo[];
}

const LETTERS = ["A", "B", "C", "D", "E", "F"];
const BLANK = "_____";

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
 * 复习页答题后传 `after`:选项换成普通容器;meaning 题 = 中文原文 + 小字英文单词,word 题 = 英文单词 + 小字词性与中文(R-Z1);
 * 长按 450 ms → 程序化选中该行的英文单词 → 全局选词操作条(R-L1–R-L5,只在答题后)。
 */
export function ChoiceQuestion({ question, onAnswer, result, busy = false, onListen, listening, canListen, after }: ListenProps & {
  question: Question; onAnswer: (choice: string) => void; result: ChoiceResult | null; busy?: boolean; after?: AfterAnswer;
}) {
  const { t } = useTranslation();
  const { prompt, qtype } = question;
  const answered = result !== null && after !== undefined && qtype !== "cloze";
  const tappable = answered && (qtype === "word" || (after?.info?.length ?? 0) > 0);

  const lookUp = (row: HTMLElement) => {
    const el = row.querySelector<HTMLElement>("[data-option-word]");
    if (el) selectWord(el);
  };
  // 长按查词:hook 无条件调用,处理器只展开到答题后有单词的行上(R-L1)
  const press = useLongPress(lookUp);
  // detail === 0:键盘 / 读屏「激活」产生的合成点击,一次就查;真实点按(detail ≥ 1)什么也不做(R-L5)
  const onRowClick = (e: MouseEvent<HTMLElement>) => {
    if (e.detail === 0) lookUp(e.currentTarget);
  };
  const onRowKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    lookUp(e.currentTarget);
  };

  return (
    <SurfaceCard data-testid="choice-question" className="px-4 py-[18px]">
      <p className="text-meta font-semibold tracking-eyebrow text-ink-2">{t(`web.wordbook.quiz.kind.${qtype}`)}</p>
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
            const row = optionRowView(qtype, option, infoFor(after?.info, option));
            const lookupProps = row.word ? {
              role: "button" as const, tabIndex: 0, ...press(String(i)), onClick: onRowClick, onKeyDown: onRowKeyDown,
            } : {};
            const wordSpan = row.word ? (
              <span data-testid="option-word" data-option-word="" data-lookup-context lang="en" className="select-text break-words">{row.word}</span>
            ) : null;
            return (
              <li key={`${i}:${option}`}>
                <div data-testid="choice-option" data-state={state} {...lookupProps}
                  className={cn(
                    "flex min-h-[52px] w-full touch-manipulation items-center gap-2.5 rounded-button border-[0.5px] px-3.5 text-left text-body transition-colors duration-fast",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    state === "correct" ? "border-transparent bg-green-tint font-semibold text-green"
                      : state === "wrong" ? "border-hair bg-surface text-ink-2" : "border-hair bg-surface text-ink",
                    row.word && "cursor-pointer select-none [-webkit-touch-callout:none]",
                  )}>
                  {badge}
                  <span className="min-w-0 flex-1 py-2">
                    {row.wordLine === "main" ? (
                      <>
                        <span className="block font-semibold">{wordSpan}</span>
                        {row.sub ? <small className="mt-0.5 block break-words text-sub font-normal text-ink-2">{row.sub}</small> : null}
                      </>
                    ) : row.wordLine === "sub" ? (
                      <>
                        <span data-testid="option-main" className="block break-words">{row.main}</span>
                        <small className="mt-0.5 block text-sub font-medium text-ink-2">{wordSpan}</small>
                      </>
                    ) : state === "wrong" ? <s className="decoration-[1.5px]">{row.main}</s> : row.main}
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
      {tappable ? <LongPressHint /> : null}
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
  > 注:替换前先 Read 现文件,核对 `ClozeSentence`、题面分支、`<button>` 分支、`correctOptionOf` 与上面一致;若别的车道期间改过它们,以现文件为准,只套用本步列出的改动。
- [ ] **Step 5:** Edit `web/src/features/wordbook/review-page.tsx`:`    ? { info: answer.result.optionInfo, defLang, peek: peekSlot === slot, onPeek: () => setPeekSlot((s) => (s === slot ? null : slot)) }` → `    ? { info: answer.result.optionInfo }`;并把它上方注释行 `  // 答题后界面只给 meaning / word 选择题(cloze 与抽查题不变);选项信息可能不存在(老服务端 / 备忘取不到),下游都按缺失处理` 保持不变。把 `peekSlot` 声明上方的注释 `  // 答题后「中」开关(meaning 题,计划 2026-10-13-review-after-answer R-A10):记的是正在偷看的题槽,换题 / 重出自动复位` 改为 `  // 答题后「学习内容」区的「中文」按钮(计划 2026-10-14-review-bilingual-longpress R-Z2):记的是正在看中文的题槽,换题 / 重出自动复位`。
- [ ] **Step 6:** Edit `web/src/features/wordbook/locales/en.json`:删除 `        "hint": "Double-tap an option to look it up",` 这一行;`locales/zh-CN.json`:删除 `        "hint": "双击选项可查词",` 这一行。
- [ ] **Step 7:** 删除双击文件:`git rm web/src/features/wordbook/double-tap.ts web/src/features/wordbook/double-tap.test.ts web/src/features/wordbook/double-tap-pref.ts web/src/features/wordbook/double-tap-pref.test.ts web/src/features/wordbook/double-tap-hint.tsx web/src/features/wordbook/double-tap-hint.test.tsx`。然后 Grep `createTapTracker|isDoubleTap|DoubleTapHint|double-tap|after\.hint|option-peek|optionsCanPeek` 在 `web/src` 下应无结果。
- [ ] **Step 8:** Run `cd web && yarn vitest run src/features/wordbook/option-view.test.ts src/features/wordbook/choice-question-after.test.tsx src/features/wordbook/choice-question.test.ts src/features/wordbook/review-after-answer.test.tsx src/features/wordbook/review-page.test.tsx src/features/wordbook/review-free.test.tsx src/features/wordbook/learn-page.test.tsx src/features/wordbook/after-answer-panel.test.tsx src/features/wordbook/locales.test.ts src/features/wordbook/long-press.test.ts src/features/wordbook/use-long-press.test.tsx src/features/wordbook/long-press-hint.test.tsx src/architecture.test.ts && cd .. && yarn web:typecheck` — 全绿。
- [ ] **Step 9:** Commit `feat(web): bilingual review options and long-press lookup instead of double tap`。

---

## Task T7:查词抽屉的「中文」按钮(车道 L,依赖 T1;与车道 W / P 并行)

**Files:** Modify `web/src/features/lookup/dictionary.ts`、`dictionary-result.tsx`、`i18n/en.json`、`i18n/zh-CN.json`、`CLAUDE.md`;Create `web/src/features/lookup/dictionary-result.test.tsx`。

- [ ] **Step 1(测试):** Write `web/src/features/lookup/dictionary-result.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "~/i18n";
import { drawerDefs, type DictEntry } from "./dictionary";
import { DictionaryResult } from "./dictionary-result";

const entry = (over: Partial<DictEntry> = {}): DictEntry => ({
  word: "country", phonetic: "ˈkʌntri",
  defsZh: [{ pos: "n", text: "国家" }],
  defsEn: [{ pos: "n", text: "a nation with its own government" }],
  phrases: [{ en: "country club", zh: "乡村俱乐部" }],
  defLang: "en", ...over,
});

beforeEach(() => { void i18n.changeLanguage("zh-CN"); });
afterEach(() => { void i18n.changeLanguage("en"); });

describe("drawerDefs (plan 2026-10-14-review-bilingual-longpress R-Z4)", () => {
  it("hides Chinese definitions and phrase translations under English-only until peek", () => {
    expect(drawerDefs(entry(), false)).toEqual({ zh: [], en: entry().defsEn, phraseZh: false, canPeek: true });
    expect(drawerDefs(entry(), true)).toEqual({ zh: entry().defsZh, en: entry().defsEn, phraseZh: true, canPeek: true });
  });

  it("needs no chip when Chinese is already shown or the word has no English definition", () => {
    expect(drawerDefs(entry({ defLang: "both" }))).toMatchObject({ zh: entry().defsZh, phraseZh: true, canPeek: false });
    expect(drawerDefs(entry({ defLang: "zh" }))).toMatchObject({ zh: entry().defsZh, en: [], phraseZh: true, canPeek: false });
    expect(drawerDefs(entry({ defsEn: [] }))).toMatchObject({ zh: entry().defsZh, phraseZh: true, canPeek: false });
  });

  it("offers the chip for phrase translations alone, and none when there is no Chinese", () => {
    expect(drawerDefs(entry({ defsZh: [] })).canPeek).toBe(true);
    expect(drawerDefs(entry({ defsZh: [], phrases: [{ en: "country club", zh: "" }] })).canPeek).toBe(false);
  });
});

describe("DictionaryResult · 中文 chip", () => {
  it("under English-only shows English only, and the chip brings Chinese definitions and phrase translations back", async () => {
    render(<DictionaryResult entry={entry()} />);
    expect(screen.queryByTestId("lookup-dict-zh")).toBeNull();
    expect(screen.getByTestId("lookup-dict-en")).toHaveTextContent("a nation with its own government");
    expect(screen.getByTestId("lookup-dict-phrases")).toHaveTextContent("country club");
    expect(screen.getByTestId("lookup-dict-phrases")).not.toHaveTextContent("乡村俱乐部");
    const chip = screen.getByTestId("lookup-zh");
    expect(chip).toHaveTextContent("中文");
    expect(chip).toHaveAttribute("aria-pressed", "false");
    expect(chip.className).toMatch(/\bmin-h-tap\b/);
    await userEvent.click(chip);
    expect(screen.getByTestId("lookup-dict-zh")).toHaveTextContent("国家");
    expect(screen.getByTestId("lookup-dict-phrases")).toHaveTextContent("乡村俱乐部");
    expect(screen.getByTestId("lookup-dict-en")).toBeTruthy();
    expect(screen.getByTestId("lookup-zh")).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByTestId("lookup-zh"));
    expect(screen.queryByTestId("lookup-dict-zh")).toBeNull();
  });

  it("has no chip when Chinese is already shown or there is none", () => {
    for (const over of [{ defLang: "both" as const }, { defLang: "zh" as const }, { defsEn: [] }, { defsZh: [], phrases: [] }]) {
      const { unmount } = render(<DictionaryResult entry={entry(over)} />);
      expect(screen.queryByTestId("lookup-zh")).toBeNull();
      unmount();
    }
  });

  it("resets for the next lookup (a new entry object)", async () => {
    const { rerender } = render(<DictionaryResult entry={entry()} />);
    await userEvent.click(screen.getByTestId("lookup-zh"));
    rerender(<DictionaryResult entry={entry({ word: "nation" })} />);
    expect(screen.getByTestId("lookup-zh")).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByTestId("lookup-dict-zh")).toBeNull();
  });
});
```
- [ ] **Step 2:** Run `cd web && yarn vitest run src/features/lookup/dictionary-result.test.tsx` — 失败。
- [ ] **Step 3:** Edit `web/src/features/lookup/dictionary.ts`:在 `const EN_POS: Record<string, string> = {` 这一行**之前**插入:
```ts
/**
 * 抽屉的「中文」按钮(计划 2026-10-14-review-bilingual-longpress R-Z4):偏好 en 且有英文释义时,中文释义与短语译文默认藏起,
 * `peek`(用户按了「中文」)带回;`canPeek` = 有中文可带回。其余情况与 visibleDefs 相同、没有按钮。纯函数,不缓存。
 */
export function drawerDefs(
  entry: Pick<DictEntry, "defLang" | "defsZh" | "defsEn" | "phrases">,
  peek = false,
): { zh: DictDef[]; en: DictDef[]; phraseZh: boolean; canPeek: boolean } {
  const hidesZh = entry.defLang === "en" && entry.defsEn.length > 0;
  const { zh, en } = visibleDefs(entry);
  return {
    zh: hidesZh && peek ? entry.defsZh : zh,
    en,
    phraseZh: !hidesZh || peek,
    canPeek: hidesZh && (entry.defsZh.length > 0 || entry.phrases.some((p) => p.zh.trim() !== "")),
  };
}

```
- [ ] **Step 4:** Replace `web/src/features/lookup/dictionary-result.tsx` 整文件:
```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ZhToggle } from "~/components/zh-toggle";
import { drawerDefs, enPosLabel, type DictEntry } from "./dictionary";

/**
 * 抽屉里词典命中的显示:词 / 音标 / 原形 / 中文释义 / 英文释义(遵守 def_lang)/ 最多 3 条短语。
 * 偏好「仅英文」且有英文释义时,中文释义与短语译文藏在「中文」按钮后面(计划 2026-10-14-review-bilingual-longpress R-Z4);
 * 按钮状态只属于这一次查词:记的是按下时的 entry 对象,新的查词(新对象)自动复位。不写本机、不写服务端。
 */
export function DictionaryResult({ entry }: { entry: DictEntry }) {
  const { t } = useTranslation();
  const [peekOf, setPeekOf] = useState<DictEntry | null>(null);
  const peek = peekOf === entry;
  const { zh, en, phraseZh, canPeek } = drawerDefs(entry, peek);
  return (
    <div data-testid="lookup-dict" className="space-y-2">
      <p className="text-lg font-semibold">
        {entry.word}
        {entry.phonetic && <span className="ml-2 font-code font-normal text-muted-foreground">/{entry.phonetic}/</span>}
      </p>
      {entry.lemma && entry.lemma.toLowerCase() !== entry.word.toLowerCase() && (
        <p className="text-sm text-muted-foreground">{t("web.lookup.lemma")}: {entry.lemma}</p>
      )}
      {zh.length > 0 && (
        <ul data-testid="lookup-dict-zh" className="space-y-0.5">
          {zh.map((d, i) => (
            <li key={`${d.pos}|${d.text}|${i}`}>{d.pos && <span className="mr-1.5 text-sm text-muted-foreground">{d.pos}</span>}{d.text}</li>
          ))}
        </ul>
      )}
      {en.length > 0 && (
        <ul data-testid="lookup-dict-en" className="space-y-0.5 text-sm text-ink-2">
          {en.map((d, i) => (
            <li key={`${d.pos}|${d.text}|${i}`}><span className="mr-1.5 text-muted-foreground">{enPosLabel(d.pos)}</span>{d.text}</li>
          ))}
        </ul>
      )}
      {canPeek && (
        <ZhToggle pressed={peek} onToggle={() => setPeekOf(peek ? null : entry)} label={t("web.lookup.zh")} testId="lookup-zh" />
      )}
      {entry.phrases.length > 0 && (
        <div data-testid="lookup-dict-phrases">
          <p className="text-sm text-muted-foreground">{t("web.lookup.phrases")}</p>
          <ul className="space-y-0.5 text-sm">
            {entry.phrases.map((p) => <li key={p.en}><span className="font-medium">{p.en}</span>{phraseZh && p.zh && <span className="ml-2 text-muted-foreground">{p.zh}</span>}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
```
- [ ] **Step 5:** 文案:Edit `web/src/features/lookup/i18n/en.json`:`      "sourceDict": "Dictionary", "sourceAi": "AI lookup", "aiExplain": "Explain in context with AI", "barLabel": "Selection actions", "phrases": "Phrases",` → 在行尾 `"phrases": "Phrases",` 后加 ` "zh": "Chinese",`。Edit `i18n/zh-CN.json`:`      "sourceDict": "词典", "sourceAi": "AI 查询", "aiExplain": "AI 结合语境讲解", "barLabel": "选中文字操作", "phrases": "短语",` → 在行尾 `"phrases": "短语",` 后加 ` "zh": "中文",`。
- [ ] **Step 6:** Edit `web/src/features/lookup/CLAUDE.md`:
  1. What lives here 里 `- \`dictionary.ts\` (local dictionary client + pure helpers: \`lookupDictionary\`, \`visibleDefs\`, \`dictToLookup\`), \`use-dictionary-prefetch.ts\`, \`dictionary-result.tsx\`.` → 把 `` `visibleDefs`, `` 改成 `` `visibleDefs`, `drawerDefs`, ``。
  2. Pitfalls 末尾加一行:`- 「中文」 chip in the drawer (plan \`2026-10-14-review-bilingual-longpress\` R-Z4): with \`def_lang\` en and English definitions, Chinese definitions and phrase translations hide behind \`ZhToggle\` (\`data-testid="lookup-zh"\`, from \`~/components/zh-toggle\`); the state is per lookup (keyed by the entry object), never stored. No chip when Chinese already shows or there is none; the AI fallback path is unchanged.`
- [ ] **Step 7:** Run `cd web && yarn vitest run src/features/lookup/dictionary-result.test.tsx src/features/lookup/dictionary.test.ts src/features/lookup/lookup-bar.test.tsx src/features/lookup/lookup-layer.test.tsx src/architecture.test.ts && cd .. && yarn web:typecheck` — 全绿。
- [ ] **Step 8:** Commit `feat(web): add a 中文 chip to the lookup drawer under English-only`。

---

## Task T8:文档、Addendum 与自检(全部合并后)

**Files:** Modify `web/src/features/wordbook/CLAUDE.md`、`web/src/lib/CLAUDE.md`、`web/README.md`、`docs/superpowers/plans/2026-10-13-review-after-answer.md`、`docs/superpowers/plans/2026-10-13-review-after-answer-device-checklist.md`。

- [ ] **Step 1:** Edit `web/src/features/wordbook/CLAUDE.md`:
  1. What lives here 里以 `- Review after-answer (spec` 开头的那一行替换为:
     `- Review after-answer (spec \`2026-10-13-review-after-answer-and-library-alignment-design.md\` §2, plans \`2026-10-13-review-after-answer.md\` + \`2026-10-14-review-bilingual-longpress.md\`): \`option-view.ts\` (pure: bilingual per-option row view, panel card), \`after-answer-panel.tsx\` (study panel under the question, with the 中文 chip), \`long-press.ts\` (pure state machine) + \`use-long-press.ts\` (pointer hook), \`long-press-pref.ts\` + \`long-press-hint.tsx\` (one-time hint, device-local). \`ChoiceQuestion\` takes an optional \`after\` prop: only the review page passes it.`
  2. Pitfalls 里以 `` - `optionInfo` / `phrases` / `example` on `AnswerResult` are optional`` 开头的那一行替换为:
     `` - `optionInfo` / `phrases` / `example` on `AnswerResult` are optional (old server, memo miss, other qtypes): match info by `option` text, never by index; render the old look when absent. Answered meaning rows are always bilingual (Chinese option text + small English word), independent of `def_lang`. Long-press (450 ms, 8 px slop, only after answering) selects the row's word through `~/lib/select-word`; the word span carries `data-lookup-context` so the global lookup bar accepts the selection; the click after a long press is swallowed and `contextmenu` is prevented. Long-press on real iOS / Android is UNVERIFIED (see the plan's device checklist). ``
  3. Pitfalls 里以 `- 释义显示默认「仅英文」` 开头的那一行末尾(句号前)追加:`;复习页答后区不用右上角「中」,改用 \`zhReveal()\` + \`ZhToggle\`「中文」按钮(\`WordCardView\` 受控 \`peek\`/\`onPeek\`,状态在复习页按题槽复位),中文释义与短语译文一起藏 / 显(计划 \`2026-10-14-review-bilingual-longpress\` R-Z2 / R-Z3)`。
- [ ] **Step 2:** Edit `web/src/lib/CLAUDE.md`:`used by the wordbook review page's double-tap).` → `used by the wordbook review page's long-press).`
- [ ] **Step 3:** Edit `web/README.md`:先 Read;把以 `- **复习页答题后界面**(计划 2026-10-13-review-after-answer)` 开头的那一整行替换为:
  `- **复习页答题后界面**(计划 2026-10-13-review-after-answer,2026-10-14-review-bilingual-longpress 修订):选择题答完后,「看单词选中文」的每个选项保留原来的中文,下面加一行小字英文单词(对错项都一样);「看中文选单词」的每个选项显示单词 + 小字中文与词性。题目下方出「学习内容」(英→中:英英释义 + 最多 3 条短语 + 朗读;中→英:正确单词的卡片);「仅英文」偏好下中文释义与短语译文藏在区内的「中文」按钮后面(换题复位),「中文 / 中英」偏好或没有英文释义的词直接显示中文。**长按**(约 0.45 秒)答后的某个选项会选中它的英文单词并弹出选词操作条(查词 · 朗读 · 加入生词本);答题前长按不查词。第一次答题后在题下提示一次「长按选项里的单词可查询」,记在本机 \`enjoy-web.wordbook.prefs\`(\`longPressHintSeen\`,退出登录清除)。服务端 \`/api/wordbook/answers\` 对这两种选择题追加可选的 \`option_info\`(进程内备忘,取不到就省略,网页退回旧显示)、\`phrases\`、\`example\`。查词抽屉在「仅英文」下也有同样的「中文」按钮(每次查词单独记)。例句选词、学新词小测、快速回忆抽查不变。**未在真机验证**:iOS Safari / Android Chrome 上长按是否稳定触发程序化选中与操作条、系统长按菜单 / 原生选词是否被压住或盖住操作条、松手后的点击是否被吞、滚动时是否误触发、读屏激活;清单见 \`docs/superpowers/plans/2026-10-14-review-bilingual-longpress.md\`「真机清单」。`
- [ ] **Step 4:** Edit `docs/superpowers/plans/2026-10-13-review-after-answer.md`:在文件末尾追加:
```markdown

## Addendum (2026-10-14)

计划 `2026-10-14-review-bilingual-longpress.md` 覆盖本计划的以下裁定:**R-A9**(双击)→ 长按 R-L1–R-L5,`double-tap*.ts(x)` 已删除;**R-A10** 中「meaning 题选项行按 `defView` 藏中文、题卡「中」开关」→ R-Z1(选项行永远双语)与 R-Z2(「中文」按钮移到「学习内容」区,`option-peek` 删除);**R-A12**(双击提示)→ R-L6(长按提示,新字段 `longPressHintSeen`)。其余裁定不变。真机清单中 A、B 两节(双击)作废,以新计划的「真机清单」为准。
```
  Edit `docs/superpowers/plans/2026-10-13-review-after-answer-device-checklist.md`:在第一行标题之后插入一行:
  `> **2026-10-14:双击已由长按取代**(计划 \`2026-10-14-review-bilingual-longpress.md\`),本清单里与双击有关的项作废;新清单见该计划「真机清单」。`
- [ ] **Step 5:** 自检(只读):
  - Grep `role="status"` 在 `web/src/features/wordbook/{after-answer-panel.tsx,long-press-hint.tsx,choice-question.tsx}` 应无结果。
  - Grep `features/(library|lookup)/` 在 `web/src/features/wordbook` 应无结果;Grep `features/wordbook` 在 `web/src/features/lookup` 应无结果。
  - Grep `console\.` 在 `web/src/features/wordbook/{long-press.ts,use-long-press.ts}` 应无结果。
  - Grep `double-tap|doubleTap|createTapTracker` 在 `web/src` 下只允许出现在 `long-press-pref.ts` / `long-press-pref.test.ts` 的 `doubleTapHintSeen` 注释与用例里。
  - `git diff --stat main...HEAD` 里不应出现 `enjoy/`、`server/`、`web/src/features/library/`。
- [ ] **Step 6:** Run `cd web && yarn vitest run src/features/wordbook src/features/lookup src/components/zh-toggle.test.tsx src/architecture.test.ts && cd .. && yarn web:typecheck` — 全绿后才勾选本计划的任务框(`docs/CLAUDE.md`:合并且测试通过才勾)。**不跑** `yarn web:build`、全量与 E2E(用户要求时再跑)。
- [ ] **Step 7:** Commit `docs: describe bilingual review options, the 中文 chip and long-press lookup`。

---

## Task T9(仅控制者):更新日志草稿

**前提:** T1–T8 已合并、已部署并由控制者核对。实现车道**不做**这一步。

- [ ] **Step 1:** 按 `docs/CLAUDE.md` 的写作规则,在 `docs/changelog/2026-10.json` 数组末尾追加一条(`entry_date` 用实际部署日;`version` 为 null;用户语言,不写内部术语,只写已上线的):
```json
  {
    "entry_date": "2026-10-14",
    "version": null,
    "title_zh": "复习选择题:双语选项与长按查词",
    "title_en": "Review quizzes: bilingual options and press-and-hold lookup",
    "items": [
      { "tag": "fix", "zh": "看单词选中文的题答完后,选项保留中文,并在下面标出每个选项对应的英文单词。", "en": "After answering a pick-the-meaning question, the options keep their Chinese and show the English word each one belongs to." },
      { "tag": "improve", "zh": "答题后的学习内容默认显示英文释义,点「中文」按钮即可查看中文释义和短语翻译。", "en": "The study panel after each answer shows English definitions first; tap 中文 to see the Chinese meanings and phrase translations." },
      { "tag": "improve", "zh": "答题后长按选项里的单词即可查词、朗读或加入生词本,取代原来的双击。", "en": "After answering, press and hold a word in an option to look it up, hear it or save it, instead of double-tapping." },
      { "tag": "improve", "zh": "查词抽屉在只显示英文释义时,也可以点「中文」查看中文。", "en": "When the lookup drawer shows English only, tap 中文 to see the Chinese too." }
    ]
  }
```
- [ ] **Step 2:** Run `cd server && uv run pytest -q tests/test_changelog_import.py`;提醒用户在服务器上运行 `docker compose exec server python -m app.admin.changelog_import`(镜像需重建后才带上新文件,重建只在用户要求时做),然后在管理后台「更新日志」里编辑并发布。

---

## 自检清单(执行者交付前对照)

1. 不传 `after` 的 `ChoiceQuestion`(学新词页、抽查题)与改动前行为相同(`choice-question-after.test.tsx` 前三个用例、`learn-page.test.tsx`、`review-page.test.tsx` 全绿);cloze 不变。
2. 不传 `onPeek` 的 `WordCardView` DOM 不变(`word-card-legacy` 快照**未更新**、`word-card-peek.test.tsx` 全绿);`PhrasesSection` 不传 `showZh` 时 DOM 不变。
3. 复习页只有一个 `role="status"`;`/answers` 请求体键集合不变。
4. 新文案:wordbook 懒加载 `locales/*.json` +2 −1、lookup `i18n/*.json` +1,`locales.test.ts` 绿。
5. 没有新的跨 feature 导入;`ZhToggle` 只依赖 `~/lib/cn`。
6. 长按代码无日志;单词只进 DOM 选区,不进 URL / 存储。
7. 没有改 `enjoy/`、`server/`、`features/library`、`lib/select-word.ts`。

## 真机清单(全部 UNVERIFIED;执行后由用户在真机上填写,摘要写进 `web/README.md` 的「未在真机验证」)

> jsdom 只能证明:按住 450 ms 后调用了 `selectAllChildren` 且选区文字正确、移动 / 取消 / 滚动 / 提前松手不触发、松手后的 click 被吞、`contextmenu` 被 preventDefault。**不能**证明下面任何一项。被测构建、设备型号与系统版本、浏览器版本、`def_lang` 请记在每次测试记录的开头。可选调试(Safari / Chrome 远程调试控制台;**不要**贴出词表或 token):`document.addEventListener("selectionchange", () => console.log(JSON.stringify(getSelection().toString())), { passive: true });`

**L-A 长按基本功能(iOS Safari 标签页、iOS 主屏 PWA、Android Chrome 各测一遍)**
- [ ] L-A1 答完「看单词选中文」题后,按住某个选项约半秒:该行的**英文单词**被选中(高亮),约 0.3 秒后底部出现选词操作条(查词 · 朗读 · 加入生词本)。
- [ ] L-A2 按在行内的中文主行 / 字母徽标 / 空白处按住,同样选中的是该行的英文单词(整行都是按压区)。
- [ ] L-A3 「看中文选单词」题同样可用。
- [ ] L-A4 答题**前**按住一个选项再松手:只会答题一次,不查词、不弹系统菜单以外的东西。
- [ ] L-A5 松手后没有触发任何别的动作(不跳题、不重复查词、选区不被松手那一下清掉)。

**L-B 系统行为是否被压住(最关键)**
- [ ] L-B1 iOS:长按时**不**出现系统的「拷贝 / 查询 / 翻译」菜单与放大镜;若出现,记录它是否盖住我们的操作条、选区是否被改成别的范围(R-L4 备选方案的依据)。
- [ ] L-B2 Android:长按时**不**出现系统的文字选择柄与浮动工具条;不弹「复制 / 全选」;没有震动后的原生选词。
- [ ] L-B3 长按不触发页面缩放、不触发链接预览、不把整行(含中文)选中。

**L-C 取消**
- [ ] L-C1 按住后手指滑动(滚动页面):页面正常滚动,不选词。
- [ ] L-C2 普通快速点按答后选项:什么也不发生。
- [ ] L-C3 快速连点两下(旧的双击):不查词、不缩放(`touch-action: manipulation`)。

**L-D「中文」按钮**
- [ ] L-D1 「仅英文」下答完题,学习内容区里的「中文」按钮清晰可见、好点(≥ 44 px);点后出现中文释义与短语翻译,再点收回;下一题自动复位。
- [ ] L-D2 查词抽屉在「仅英文」下有「中文」按钮,点后显示中文释义与短语翻译;关掉抽屉再查别的词时复位。

**L-E 读屏**
- [ ] L-E1 VoiceOver / TalkBack:聚焦答后选项后双指轻点(激活)= 查词一次(合成点击 `detail === 0` 的假设);「中文」按钮读出「中文,切换按钮,未选中 / 已选中」。

## UNVERIFIED(必须在交付说明里原样保留)

- 上面「真机清单」的全部项目(iOS Safari 标签页 / 主屏 PWA、Android Chrome)。
- jsdom 26 的 `PointerEvent` 坐标与 React 捕获阶段 `stopPropagation` 吞点击的行为:以第一次运行结果为准。
- 主包体积(`yarn web:build` 未运行;lookup 急切文案 +1 键,`ZhToggle` 进主包——它被 lookup 用到)。E2E 未运行(学新词小测的 `button[data-state="correct"]` 选择器未受影响)。
