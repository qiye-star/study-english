# Liquid glass · L9 wordbook (home, learn, review, quiz, spell, books, learned, goals) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Read first:** `2026-10-15-liquid-glass-INDEX.md` §3 (R-LG5 Rule 4, R-LG10 teal dropped), §5.4, §6, §7 (quiz = capsule + dock +
> tab bar); v2 mockup frames "单词本首页" (`wordbook()`: 今天 hero, `.band`, 计划 wells + ring, `.pair .half`) and
> "单词复习 · 选择题(答后)" (`quiz()`: `.opt`, `.opt.ok`, `.opt.bad`, `.mk.g/.mk.r`, `.dock.m2.capbar` with `.pill.pl` + `.pill.acc`).
> Starts after **L2**; parallel with the other area lanes.

**Goal:** wordbook without teal: a 今天 hero that is the whole decision (two 28px counts, an ink mastery band, the one accent
CTA 开始复习 N or 学新词 N, secondary pills 学新词 / 拼写), a 计划 panel (wells + ink ring with accent arc), two half panels
已学单词 / 换书; quiz options as E1 row tiles with the v2 after-answer states (correct = 1.5px ink ring + filled check +
green 正确 mark; your wrong pick = red ✕ 你的选择 + text ink-2); session docks as E2 bars whose secondary button is a plate
pill (Rule 4) and primary a solid accent pill; marks/underlines instead of amber fills; goals reset confirm keeps the red
fill (spec §2.4); snapshot regenerated deliberately.

**Architecture:** additive classes (R-LG1) everywhere; one structure branch: `WordbookHomePage` renders
`WordbookTodayLiquid` (new file) instead of the classic body when `useLiquid()` (R-LG2), same test ids. `PlanRing` switches
its conic colours under liquid. Docks get `GHOST_DOCK` for buttons placed on the blurred bar.

## Global Constraints

- Owned files: `web/src/features/wordbook/**` incl. `__snapshots__/word-card-legacy.test.tsx.snap` (after L2-9) (INDEX §9).
- Test ids to keep (both skins, once each): `wordbook-legend`, `wordbook-tomorrow`, `wordbook-streak`, `wordbook-action-review`,
  `wordbook-action-learn`, `wordbook-action-spell`, `wordbook-action-learned`, `wordbook-paused`, `choice-option`,
  `option-word`, `option-main`, `question-meaning`.
- Assertions to respect: `spell/spell-page.test.tsx` (`top-0`, not `/\bbottom-0\b/`, knob `bg-white` not `/\bbg-surface\b/`)
  — never add `bottom-*` or `bg-surface` tokens to those elements; `spell/cloze-board.test.tsx` (`border-blue` present only on
  the current cell) — never add `border-blue` elsewhere; `choice-question*.test.*`, `word-card-*.test.tsx`,
  `def-lang-setting.test.tsx`, `goals-*.test.tsx`, `phrases-section.test.tsx`, `after-answer-panel.test.tsx` use positive
  `toContain`/`toMatch` → additive is safe.
- `ZhToggle` (locked shared) is not changed; the after-answer panel keeps it as is.
- Worktree `.claude/worktrees/lg-l9`, branch `feat/lg-l9`, junctioned `node_modules`. CRLF: single-line anchors.
- Tests per task: listed files + `src/architecture.test.ts`; lane end: `cd web && yarn vitest run src/features/wordbook` + `yarn web:typecheck`.
- Commits `feat(web): …`, one per task, own `Co-Authored-By:` line.

## Rulings specific to L9

- **R-L9-1** Home primary CTA: 开始复习 N when `plan.reviewLeft > 0`, else 学新词 N when `plan.newLeft > 0`, else no accent
  pill (finished text). The other actions are secondary pills. Exactly one `wordbook-action-*` element per action.
- **R-L9-2** Mastery band (`.band`): mastered `bg-ink/85`, learning (`learned − mastered`) `bg-wash-2` + hairline, remaining
  `bg-wash`; `role="progressbar"` and the same aria values as the classic bar.
- **R-L9-3** Quiz after-answer (`.opt`): row tile radius 22 (E1 fill without `mat-*` so state shadows can apply); letter
  circle well; correct = `shadow-[inset_0_0_0_1.5px_ink]`, letter circle ink with surface check, visible mark `✓ 正确`
  (green, `aria-hidden`; the sr-only text stays); wrong = text ink-2 + visible `✕ 你的选择` (red, `aria-hidden`).
- **R-L9-4** Docks: `DOCK` = sticky `mat-chrome-bar` inset 8, radius 26; buttons on it: primary `PRIMARY` (solid accent),
  secondary `GHOST_DOCK` (= `GHOST` + `LQ_ON_BLUR`, a plate pill); any other text in a dock goes on a `plate`.
- **R-L9-5** Teal is gone under liquid everywhere in the wordbook: progress = ink, plan ring arc = accent, book badges mono.

## Per-file edits

| File:line | Current fragment | Append / change |
|---|---|---|
| `ui.ts` imports | — | `import { LQ_DANGER_SOLID, LQ_ICON_WELL, LQ_ON_BLUR, LQ_PRIMARY, LQ_SECONDARY } from "~/components/liquid";` |
| `ui.ts` `PRIMARY` | `` `${BASE} bg-blue text-on-blue active:bg-blue/90` `` | `` `${BASE} bg-blue text-on-blue active:bg-blue/90 ${LQ_PRIMARY}` `` |
| `ui.ts` `GHOST` | `` `${BASE} border-[0.5px] border-hair bg-surface text-ink active:bg-surface-2` `` | + `` ` ${LQ_SECONDARY}` `` and add after it: ``export const GHOST_DOCK = `${GHOST} ${LQ_ON_BLUR}`; // 规则 4:模糊 DOCK 上的次要按钮是托板胶囊`` |
| `ui.ts` `DANGER` | `` `${BASE} bg-red-solid text-white active:bg-red-solid/90` `` | + `` ` ${LQ_DANGER_SOLID}` `` (only the reset confirm uses it) |
| `ui.ts` `DOCK` | `"glass glass-edge-t sticky bottom-0 z-30 mt-auto flex gap-2 px-gutter pb-2.5 pt-2.5"` | + ` mat-chrome-bar liquid:mx-2 liquid:mb-2 liquid:rounded-float liquid:p-2` |
| `ui.ts` `PLAY` | first string | + ` ${LQ_ICON_WELL}` |
| `ui.ts` `ICON_LINK` | first string | + ` well liquid:rounded-full` |
| every `<div className={DOCK}>` block (`free-browse.tsx:39,57`, `learn-page.tsx:276,317`, `learned-page.tsx:181`, `recall-rating-bar.tsx:17`, `review-page.tsx:209,323`, `session-summary.tsx:99`) | buttons inside using `GHOST` | use `GHOST_DOCK` instead of `GHOST` **only inside these blocks** (Read each block) |
| `recall-rating-bar.tsx:20`, `:28` | text rows with amber icons inside the dock | wrap text containers with ` plate liquid:rounded-full liquid:px-3 liquid:py-1` (icon may stay amber 16px) |
| `recall-rating-bar.tsx:42` | `"mb-2 flex items-start gap-2.5 rounded-card bg-blue-tint px-3.5 py-3"` | + ` plate liquid:rounded-tile` |
| `recall-rating-bar.tsx:53` `TONE` | `{ know: "bg-green-tint text-green", fuzzy: "bg-amber-tint text-amber", unknown: "bg-surface-2 text…" }` | each value + ` ${LQ_ON_BLUR} liquid:text-ink` (rating buttons live in the dock) |
| `choice-question.tsx:99`, `typing-question.tsx:89`, `after-answer-panel.tsx:48`, `review-page.tsx:202`, `word-card.tsx:131` | listen keys `… rounded-full bg-blue-tint text-blue` | + ` ${LQ_ICON_WELL}` |
| `choice-question.tsx:118-119` badge | `"flex h-6 w-6 flex-none items-center justify-center rounded-[7px] text-meta font-semibold",` / `state === "correct" ? "bg-green text-on-blue" : "bg-surface-2 text-ink-2",` | first + ` liquid:size-7 liquid:rounded-full`; second → `state === "correct" ? "bg-green text-on-blue liquid:bg-ink liquid:text-surface" : "bg-surface-2 text-ink-2 liquid:bg-wash",` |
| `choice-question.tsx:121-122` icons | `<CircleCheckIcon aria-hidden className="h-5 w-5 flex-none" />` / `<XIcon aria-hidden className="h-5 w-5 flex-none text-ink-2" />` | correct → `<span aria-hidden className="flex flex-none items-center gap-1 text-meta font-semibold text-green"><CircleCheckIcon className="h-5 w-5 liquid:h-[18px] liquid:w-[18px]" /><span className="hidden liquid:inline">{t("web.wordbookDefs.after.correct")}</span></span>`; wrong → `<span aria-hidden className="flex flex-none items-center gap-1 text-meta font-semibold text-ink-2 liquid:text-red"><XIcon className="h-5 w-5 liquid:h-[18px] liquid:w-[18px]" /><span className="hidden liquid:inline">{t("web.wordbookDefs.after.yours")}</span></span>` |
| `choice-question.tsx:139-141`, `:172-174` option rows (two places) | `"flex min-h-[52px] w-full … rounded-button border-[0.5px] px-3.5 text-left text-body transition-colors duration-fast",` and the state ternary | first string + ` liquid:min-h-[60px] liquid:rounded-tile liquid:border-0 liquid:bg-[rgb(var(--mat-1-rgb)/var(--mat-1-alpha))] liquid:shadow-e1`; state: `"border-transparent bg-green-tint font-semibold text-green"` → + ` liquid:text-ink liquid:shadow-[inset_0_0_0_1.5px_rgb(var(--ink)),var(--mat-sh-1)]`; wrong unchanged (`text-ink-2`) |
| `choice-question.tsx` option list | `<ul className="mt-4 flex flex-col gap-2">` | + ` liquid:gap-2.5` |
| `typing-question.tsx:13-15` outcome `cls` | `"bg-green-tint text-green"`, `"bg-amber-tint text-amber"` ×2 | each + ` liquid:rounded-full liquid:bg-wash` (text colour stays: it is the mark) |
| `typing-question.tsx:98` | `… border-[0.5px] border-hair px-3 text-sub font-semibold text-amber …` | + ` ${LQ_SECONDARY}` (hint button: ink on wash) |
| `spell/outcome-badge.tsx:15-17` | `"bg-green-tint text-green"`, `"bg-amber-tint text-amber"` ×2 | + ` liquid:rounded-full liquid:bg-wash` |
| `spell/cloze-board.tsx:63-64` | `"rounded-t-[6px] border-blue bg-blue-tint text-blue"`, `"rounded-t-[6px] bg-blue-tint text-blue"` | + ` liquid:bg-wash` each (border/caret stay accent) |
| `spell/spell-page.tsx:49` `PRIMARY` | `cn(BTN, "bg-blue text-on-blue active:opacity-9…")` | + `, LQ_PRIMARY` |
| `spell/spell-page.tsx:57` `TOOL_ON` | `"bg-blue-tint text-blue"` | `` `bg-blue-tint text-blue ${LQ_CHIP_ON}` `` |
| `spell/spell-page.tsx:328` | `className={cn(TOOL, "bg-amber-tint text-amber")}` | `className={cn(TOOL, "bg-amber-tint text-amber", LQ_SECONDARY)}` |
| `spell/spell-page.tsx:429` | `prefs.showLength ? "bg-blue" : "bg-surface-2 shadow-hair"` | `prefs.showLength ? "bg-blue" : "bg-surface-2 shadow-hair liquid:bg-wash-2"` |
| `spell/spell-results.tsx` | element using `scoreToneClass(…)` (Read) | + ` ${LQ_INK}` and `<ScoreDot score={…} />` |
| `word-card.tsx:36` | `<mark className="rounded-[4px] bg-amber-tint px-[3px] font-semibold text-a…` | + ` ${LQ_MARK}` |
| `word-card.tsx:123`, `recall-card.tsx:59` | `… rounded-[9px] bg-surface text-blue shadow-hair">` | + ` ${LQ_ICON_WELL}` |
| `letter-diff.tsx:12` | `const U = "font-semibold text-amber underline decoration-2 underl…` | + ` liquid:text-ink` |
| `goals-fields.tsx:18` `NOTE`, `home-page.tsx:187` | `"mt-2 flex items-start gap-2 rounded-badge bg-amber-tint px-3 py-2.5 text-sub font-medium text-amber"` | + ` ${LQ_NOTE}` |
| `goals-confirm.tsx` | `AlertDialogContent` and buttons (Read) | Content + `LQ_DIALOG`; confirm keeps `DANGER` (red fill allowed here); cancel + `LQ_SECONDARY` |
| `free-review-sheet.tsx:84` | `scope === s ? "border-blue bg-blue-tint text-blue" : "border-hair bg-…"` | `scope === s ? "border-blue bg-blue-tint text-blue ${LQ_CHIP_ON}" : "border-hair bg-… ${LQ_CHIP}"` + base ` liquid:rounded-full` |
| `learned-page.tsx:136` | `className={cn(GHOST, "h-11", weak && "border-blue bg-blue-tint")}` | `className={cn(GHOST, "h-11", weak && cn("border-blue bg-blue-tint", LQ_CHIP_ON))}` |
| `box-bar.tsx:8-10` swatches | `"bg-amber"`, `"bg-teal-tint shadow-[…]"`, `"bg-teal"` | + ` liquid:bg-wash`, ` liquid:bg-wash-2`, ` liquid:bg-ink/85` |
| `box-bar.tsx:37` | `active ? "border-blue bg-blue-tint" : "border-hair bg-surface ac…"` | `active ? "border-blue bg-blue-tint ${LQ_CHIP_ON}" : "border-hair bg-surface … ${LQ_CHIP}"` |
| `books-page.tsx:27` | `i < level ? "bg-teal" : "bg-surface-2"` | `i < level ? "bg-teal liquid:bg-ink/85" : "bg-surface-2 liquid:bg-wash-2"` |
| `session-header.tsx:28` | `i < done ? "bg-teal" : i === done && current ? "b…"` | `i < done ? "bg-teal liquid:bg-ink/85" : …` (current stays accent) |
| `session-summary.tsx:33` `SPLIT` | `[["know", "bg-green"], ["fuzzy", "bg-amber"], ["u…` | values + ` liquid:bg-ink/85`, ` liquid:bg-wash-2`, ` liquid:bg-wash` |
| `wordbook-card.tsx:30`, `:47` | `… rounded-button bg-teal-tint text-teal">` | + ` ${LQ_ICON_WELL}` |
| `plan-ring.tsx` | see Task L9-2 | — |
| `home-page.tsx` | see Task L9-2 | — |
| page wrappers (`learn`, `review`, `learned`, `books`, `spell`, `home`) | `px-gutter` | + ` ${LQ_PAGE}` |

---

## Task L9-1: constants, docks, quiz states, marks

**Files:** `ui.ts`, every DOCK block file, `choice-question.tsx`, `typing-question.tsx`, `recall-rating-bar.tsx`, `spell/**`,
`word-card.tsx`, `recall-card.tsx`, `letter-diff.tsx`, `goals-*.tsx`, `free-review-sheet.tsx`, `learned-page.tsx`, `box-bar.tsx`,
`books-page.tsx`, `session-*.tsx`, `wordbook-card.tsx`, `after-answer-panel.tsx`, `review-page.tsx`; tests below.

- [ ] **Step 1 (test):** Append to `choice-question-after.test.tsx` (Read; reuse its answered render):
```tsx
import { setLiquid } from "~/test/glass";
  it("liquid: correct ring + green mark, wrong red mark (plan 2026-10-15-liquid-glass R-L9-3)", async () => {
    setLiquid(true);
    // render an answered question where the user picked a wrong option, like the existing after-answer test, then:
    const rows = screen.getAllByTestId("choice-option");
    const correct = rows.find((r) => r.dataset.state === "correct")!;
    const wrong = rows.find((r) => r.dataset.state === "wrong")!;
    expect(correct.className).toContain("liquid:shadow-[inset_0_0_0_1.5px_rgb(var(--ink)),var(--mat-sh-1)]");
    expect(correct.querySelector(".text-green [class*='liquid:inline']")).not.toBeNull();
    expect(wrong.querySelector(".liquid\\:text-red")).not.toBeNull();
    setLiquid(false);
  });
```
  Append to `review-page.test.tsx` (or `learn-page.test.tsx`, whichever renders a dock; Read):
```tsx
import { setLiquid, textOutsidePlates } from "~/test/glass";
  it("liquid: the session dock carries only plate / solid buttons (Rule 4, R-L9-4)", async () => {
    setLiquid(true);
    // render the page to the state where the dock is visible, like an existing test, then:
    const dock = document.querySelector(".mat-chrome-bar")!;
    expect(dock).not.toBeNull();
    const loose = textOutsidePlates(dock).filter((text) => !dock.querySelector(".bg-blue")?.textContent?.includes(text));
    expect(loose).toEqual([]); // text on the solid accent pill is allowed
    setLiquid(false);
  });
```
- [ ] **Step 2:** Apply the rows for the files of this task.
- [ ] **Step 3:** Run `cd web && yarn vitest run src/features/wordbook src/architecture.test.ts` — everything green except
  `word-card-legacy.test.tsx`. Inspect its diff (only added tokens), then
  `cd web && yarn vitest run src/features/wordbook/word-card-legacy.test.tsx -u`.
- [ ] **Step 4:** Commit `feat(web): liquid wordbook docks, quiz states and marks`.

---

## Task L9-2: home `今天` hero and plan ring

**Files:** Create `web/src/features/wordbook/today-liquid.tsx`; Modify `home-page.tsx`, `plan-ring.tsx`,
`i18n/{zh-CN,en}.json`, `home-page.test.tsx`.

- [ ] **Step 1:** i18n (`web.wordbook.home`, next to existing keys; Read the file): zh `"todayHero": "今天", "dueCount": "待复习", "newCount": "新词", "startReview": "开始复习 {{n}}", "learnNew": "学新词 {{n}}", "plan": "计划", "bandLegend": "已掌握 · 学习中 · 未学"`;
  en `"todayHero": "Today", "dueCount": "to review", "newCount": "new", "startReview": "Start review {{n}}", "learnNew": "Learn new {{n}}", "plan": "Plan", "bandLegend": "Mastered · learning · new"`.
- [ ] **Step 2:** Edit `plan-ring.tsx`:
  1. Imports: + `import { useLiquid } from "~/lib/glass-flag";`.
  2. Single line `  const inset = size >= 90 ? 8 : 6;` → that line + `  const liquid = useLiquid();`.
  3. Single line ``        background: `conic-gradient(rgb(var(--${tone})) 0 ${pct}%, var(--${tone}-tint) ${pct}% 100%)`,`` →
     ``        background: liquid ? `conic-gradient(rgb(var(--blue)) 0 ${pct}%, var(--ink-wash-2) ${pct}% 100%)` : `conic-gradient(rgb(var(--${tone})) 0 ${pct}%, var(--${tone}-tint) ${pct}% 100%)`,``
  4. Single line containing `tone === "teal" ? "text-teal" : "text-green"` → add `"liquid:text-ink"` as one more `cn` argument after that ternary.
  5. JSDoc: `液态皮肤:墨色文字、强调色弧、井色轨道(计划 2026-10-15-liquid-glass R-L9-5)。`
- [ ] **Step 3 (test):** Append to `home-page.test.tsx` (Read; reuse its "enrolled" render):
```tsx
import { setLiquid } from "~/test/glass";

describe("wordbook home in the liquid skin (plan 2026-10-15-liquid-glass L9-2)", () => {
  afterEach(() => setLiquid(false));
  it("today hero with one accent CTA, ink band, plan wells and two half panels; test ids once each", async () => {
    setLiquid(true);
    // render exactly like the existing enrolled-home test (plan with reviewLeft > 0), then:
    const review = await screen.findByTestId("wordbook-action-review");
    expect(review.className).toContain("liquid:shadow-accent");
    for (const id of ["wordbook-action-learn", "wordbook-action-spell", "wordbook-action-learned", "wordbook-tomorrow", "wordbook-streak", "wordbook-legend"]) {
      expect(screen.getAllByTestId(id), id).toHaveLength(1);
    }
    expect(screen.getByTestId("wordbook-action-learn").className).not.toContain("liquid:shadow-accent");
    expect(screen.getByRole("progressbar").className).not.toMatch(/teal/);
  });
});
```
- [ ] **Step 4:** Write `web/src/features/wordbook/today-liquid.tsx`:
```tsx
import { ChevronRightIcon, FlameIcon, KeyboardIcon, LayersIcon, ListChecksIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { LQ_NOTE, LQ_PANEL, LQ_PANEL_STRONG, LQ_TILE, LQ_WELL } from "~/components/liquid";
import { cn } from "~/lib/cn";
import { PlanRing } from "./plan-ring";
import { GHOST, PRIMARY, fmt } from "./ui";
import type { DayPlan, Progress, Streak } from "./wordbook-api";

const pct = (n: number, total: number) => (total > 0 ? Math.min(100, (n / total) * 100) : 0);

/**
 * 单词本首页的液态布局(设计稿 wordbook();计划 2026-10-15-liquid-glass L9-2):「今天」英雄面板就是全部决定 ——
 * 两个数字 + 墨色掌握带 + 唯一强调色按钮 + 两个次要胶囊;计划面板(井 + 墨色环);两个半宽面板。test id 与经典布局相同。
 */
export function WordbookTodayLiquid({ plan, progress, tomorrowDue, streak, learnedCount, extra }: {
  plan: DayPlan; progress: Progress; tomorrowDue: number; streak: Streak; learnedCount: ReactNode; extra?: ReactNode;
}) {
  const { t } = useTranslation();
  const mastered = pct(progress.mastered, progress.words);
  const learning = pct(Math.max(0, progress.learned - progress.mastered), progress.words);
  const primary = plan.reviewLeft > 0 ? "review" : plan.newLeft > 0 ? "learn" : null;
  const pill = "h-[38px] flex-1 px-[15px] text-sub";
  const well = (label: string, value: ReactNode, testId?: string) => (
    <div data-testid={testId} className={cn("px-3 py-2.5", LQ_WELL)}>
      <b className="num block text-title font-bold tracking-tightest text-ink">{value}</b>
      <span className="text-meta text-ink-2">{label}</span>
    </div>
  );
  return (
    <>
      <section aria-labelledby="wb-today" className={cn("mt-2 p-4", LQ_PANEL_STRONG)}>
        <h2 id="wb-today" className="mb-3 text-sub font-semibold text-ink-2">{t("web.wordbook.home.todayHero")}</h2>
        <div className="flex gap-7">
          <p><span className="num text-stat font-bold text-ink">{plan.reviewLeft}</span><span className="ml-1.5 text-sub text-ink-2">{t("web.wordbook.home.dueCount")}</span></p>
          <p><span className="num text-stat font-bold text-ink">{plan.newLeft}</span><span className="ml-1.5 text-sub text-ink-2">{t("web.wordbook.home.newCount")}</span></p>
        </div>
        <div role="progressbar" aria-label={t("web.wordbook.home.progressLabel")} aria-valuemin={0} aria-valuemax={100}
          aria-valuenow={Math.round(mastered)} aria-valuetext={t("web.wordbook.card.mastered", { m: fmt(progress.mastered), total: fmt(progress.words) })}
          className="mt-3.5 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-wash">
          <i className="block h-full rounded-l-full bg-ink/85" style={{ width: `${mastered}%` }} />
          <i className="block h-full bg-wash-2 shadow-[inset_0_0_0_.5px_var(--hair)]" style={{ width: `${learning}%` }} />
        </div>
        <div data-testid="wordbook-legend" className="mt-2 flex justify-between text-meta text-ink-2">
          <span>{t("web.wordbook.home.bandLegend")}</span>
          <span className="num">{fmt(progress.mastered)} / {fmt(progress.words)}</span>
        </div>
        {primary === "review" ? (
          <Link to="/wordbook/review" data-testid="wordbook-action-review" className={cn(PRIMARY, "mt-4 h-[50px] w-full")}>
            {t("web.wordbook.home.startReview", { n: plan.reviewLeft })}
          </Link>
        ) : primary === "learn" ? (
          <Link to="/wordbook/learn" data-testid="wordbook-action-learn" className={cn(PRIMARY, "mt-4 h-[50px] w-full")}>
            {t("web.wordbook.home.learnNew", { n: plan.newLeft })}
          </Link>
        ) : (
          <p className="mt-4 text-center text-sub text-ink-2">{t("web.wordbook.home.finished")}</p>
        )}
        <div className="mt-2.5 flex gap-2.5">
          {primary !== "learn" ? (
            plan.newLeft > 0
              ? <Link to="/wordbook/learn" data-testid="wordbook-action-learn" className={cn(GHOST, pill)}>{t("web.wordbook.home.learnNew", { n: plan.newLeft })}</Link>
              : <span data-testid="wordbook-action-learn" aria-disabled className={cn(GHOST, pill, "opacity-40")}>{t("web.wordbook.home.learn")}</span>
          ) : null}
          {primary !== "review" ? (
            <span data-testid="wordbook-action-review" aria-disabled className={cn(GHOST, pill, "opacity-40")}>{t("web.wordbook.home.review")}</span>
          ) : null}
          <Link to="/wordbook/spell" data-testid="wordbook-action-spell" className={cn(GHOST, pill)}>
            <KeyboardIcon aria-hidden className="size-4" />{t("web.wordbook.home.spell")}
          </Link>
        </div>
      </section>

      <section aria-labelledby="wb-plan" className={cn("mt-4 p-4", LQ_PANEL)}>
        <h2 id="wb-plan" className="mb-3 text-sub font-semibold text-ink-2">{t("web.wordbook.home.plan")}</h2>
        <div className="flex items-center gap-2.5">
          <div className="grid flex-1 grid-cols-3 gap-2.5">
            {well(t("web.wordbook.home.reviews"), `${plan.reviewDone}/${plan.reviewDone + plan.reviewLeft}`)}
            {well(t("web.wordbook.home.tomorrow"), tomorrowDue, "wordbook-tomorrow")}
            {well(t("web.wordbook.goals.streak.cell"), streak.current > 0
              ? <span className="inline-flex items-center gap-1"><FlameIcon aria-hidden className="size-4 text-amber" />{t("web.wordbook.goals.streak.cellDays", { n: streak.current, count: streak.current })}</span>
              : t("web.wordbook.goals.streak.cellNone"), "wordbook-streak")}
          </div>
          <PlanRing done={plan.newDone} target={plan.newTarget} size={52} />
        </div>
        {plan.backlogGuard ? <p role="note" className={cn("mt-3 px-3 py-2.5 text-sub", LQ_NOTE)}>{t("web.wordbook.home.backlog")}</p> : null}
      </section>

      {extra}

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Link to="/wordbook/learned" data-testid="wordbook-action-learned" className={cn("flex min-h-16 items-center gap-2.5 px-4 py-3.5", LQ_TILE)}>
          <span aria-hidden className="well flex size-[34px] flex-none items-center justify-center rounded-full"><ListChecksIcon className="size-5" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-body font-semibold text-ink">{t("web.wordbook.learned.title")}</span>
            {learnedCount}
          </span>
          <ChevronRightIcon aria-hidden className="size-[18px] flex-none text-ink-3" />
        </Link>
        <Link to="/wordbook/books" className={cn("flex min-h-16 items-center gap-2.5 px-4 py-3.5", LQ_TILE)}>
          <span aria-hidden className="well flex size-[34px] flex-none items-center justify-center rounded-full"><LayersIcon className="size-5" /></span>
          <span className="min-w-0 flex-1 text-body font-semibold text-ink">{t("web.wordbook.home.switchBook")}</span>
          <ChevronRightIcon aria-hidden className="size-[18px] flex-none text-ink-3" />
        </Link>
      </div>
    </>
  );
}
```
  (`LQ_*` and `mat-*` classes only render under liquid, and this component is only mounted under liquid, so it may also use
  plain `bg-wash` / `bg-ink/85` / `well` tokens directly.)
- [ ] **Step 5:** Edit `home-page.tsx`:
  1. Imports: + `import { useLiquid } from "~/lib/glass-flag";`, `import { LQ_PAGE } from "~/components/liquid";`,
     `import { WordbookTodayLiquid } from "./today-liquid";`.
  2. Single line `  const [sheet, setSheet] = useState<null | "all" | "bonus">(null);` → that line + `  const liquid = useLiquid();`.
  3. Single line `    <PageHeader title={t("web.wordbook.title")} back="/practice"` →
     `    <PageHeader large title={t("web.wordbook.title")} subtitle={liquid && today?.book ? bookTitle(today.book, i18n.language) : undefined} back="/practice"`.
  4. In the final `else {` branch: single line `    body = (` (the one right after `const done = …`) → before it insert:
```tsx
    if (liquid) {
      body = (
        <WordbookTodayLiquid plan={plan} progress={progress} tomorrowDue={today.tomorrowDue} streak={streak}
          learnedCount={learnedSummary ? <span className="num block text-meta text-ink-2">{t("web.wordbook.learned.row.count", { n: learnedSummary.total, count: learnedSummary.total })}</span> : null}
          extra={plan.goalMet && plan.newLeft === 0 && limits.bonusMax > 0 ? (
            <SurfaceCard className="mt-4 flex items-center gap-3 p-4">
              <FlameIcon aria-hidden className="h-5 w-5 flex-none text-amber" />
              <div className="min-w-0 flex-1">
                <b className="block text-body font-semibold">{t("web.wordbook.goals.goalMet.title")}</b>
                <span className="text-meta text-ink-2">{t("web.wordbook.goals.goalMet.body")}</span>
              </div>
              <button type="button" className={cn(GHOST, "h-11")} onClick={() => setSheet("bonus")}>{t("web.wordbook.goals.goalMet.action")}</button>
            </SurfaceCard>
          ) : null} />
      );
    } else
```
     so the original `body = (…);` becomes the `else` statement (classic unchanged).
  5. Single line `      <div className="px-gutter pb-6">{body}</div>` → ``      <div className={`px-gutter pb-6 ${LQ_PAGE}`}>{body}</div>``.
  6. The paused / disabled-book branches stay classic JSX (they already use `SurfaceCard`, `ToneBadge`, `GHOST`, `PRIMARY` →
     restyled through L2/L9-1).
- [ ] **Step 6:** Run `cd web && yarn vitest run src/features/wordbook src/i18n/i18n.test.ts src/architecture.test.ts` — green.
- [ ] **Step 7:** Commit `feat(web): liquid wordbook home`.

---

## Task L9-3: docs

- [ ] `web/src/features/wordbook/CLAUDE.md`: bullet "Liquid glass (plan 2026-10-15-liquid-glass L9): home = WordbookTodayLiquid (liquid only); docks = mat-chrome-bar with GHOST_DOCK plate pills (Rule 4); quiz states ring + marks; no teal under liquid; word-card-legacy snapshot regenerated deliberately."
- [ ] Commit `docs(web): wordbook liquid notes`.

## Device checklist (UNVERIFIED — needs a quick user check, spec §9)

- [ ] Monochrome quiz feedback is unmistakable at a glance (ring + filled check + green 正确; red ✕ 你的选择).
- [ ] Dock over the scrolling card: plate pill text readable in 清透 preset.
