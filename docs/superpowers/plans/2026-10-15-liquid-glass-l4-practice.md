# Liquid glass · L4 practice (home, list, history, assessment) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Read first:** `2026-10-15-liquid-glass-INDEX.md` §3, §5.4 (`LQ_*`), §6 (mapping), §7 (blur budget); v2 mockup frame
> "练习首页" (`practice()` in `liquid-glass-v2/mockup.html`). Starts after **L2** is merged; parallel with L3, L5–L11.

**Goal:** practice home as the v2 "studio": large title 练习 + date subtitle, the reference-reading hero first (`.m1.strong`,
textarea well radius 20, ghost 先听范读 pill + the one accent 开始朗读 pill), a 最近评分 panel with three score wells
(ink numbers, green/amber 6px dots), then the existing cards (段位, 单词本, daily tasks slot) and the 记录 group as panels.
History, list and assessment pages get the mapping (panels, ink scores + dots, dialogs). `features/practice/shadow/**` is
LOCKED and untouched.

**Architecture:** additive (`liquid:` / `mat-*` appended, R-LG1). The only structure change is a new liquid-only
`RecentScores` panel (own file, fetched only when `useLiquid()`), and the hero moves first via `liquid:order-first` inside a
`liquid:flex liquid:flex-col` wrapper — no duplicated DOM, every test id unchanged. The mockup's 今日 ring/streak panel is
**not** built: it would need `getStats` from `features/progress`, a new cross-feature edge that `architecture.test.ts`
forbids (deviation D-8, open question to owner via INDEX §14).

## Global Constraints

- Owned files: `web/src/features/practice/**` except `shadow/**` (INDEX §9): `practice-page.tsx`, `practice-list-page.tsx`,
  `history-page.tsx`, `assessment-page.tsx`, `mobile-score-result.tsx`, new `recent-scores.tsx` (+ test), their tests,
  `i18n/{zh-CN,en}.json`, `CLAUDE.md`.
- Never touch `features/practice/shadow/**`, `locked-pages.test.ts` guards it.
- Keep every `data-testid`, role and accessible name. Classic DOM: only added class tokens (+ the liquid-only panel).
- Blur budget: practice pages own no blur layer (capsule from L2 + tab bar = 2 when scrolled).
- Worktree `.claude/worktrees/lg-l4`, branch `feat/lg-l4`, junctioned `node_modules`. CRLF: single-line anchors.
- Tests per task: listed files + `src/architecture.test.ts`; lane end: `cd web && yarn vitest run src/features/practice` and `yarn web:typecheck`.
- Commits `feat(web): …`, one per task, own `Co-Authored-By:` line.

## Per-file edits (mapping applied; anchors are single lines from the 2026-10-15 tree)

| File:line | Current fragment | Append / change |
|---|---|---|
| `practice-page.tsx:1` | lucide import | add `HistoryIcon` is already imported; no change |
| `practice-page.tsx` imports | `import { SurfaceCard } from "~/components/surface-card";` | + `import { LQ_FIELD_MULTI, LQ_NOTE, LQ_PAGE, LQ_PRIMARY, LQ_SECONDARY } from "~/components/liquid";` + `import { useLiquid } from "~/lib/glass-flag";` + `import { RecentScores } from "./recent-scores";` |
| `practice-page.tsx:34-37` `ICON_LINK` | `"relative inline-flex h-tap w-tap … rounded-button text-ink transition-colors duration-fast",` | same string + ` well liquid:rounded-full` (`.cbtn.well`) |
| `practice-page.tsx:104` | `      <PageHeader` | `      <PageHeader large` |
| `practice-page.tsx:116` | `      <div className="px-gutter pb-6">` | `      <div className={\`px-gutter pb-6 ${LQ_PAGE} liquid:flex liquid:flex-col\`}>` |
| `practice-page.tsx:120` | `        <SectionGroup title={t("web.practice.home.shadowing")} bare>` | wrap: `        <div className="liquid:order-first">` before it and `        </div>` after its closing `</SectionGroup>` (line 169) |
| `practice-page.tsx:122` | `          <SurfaceCard className="p-3.5">` | `          <SurfaceCard strong className="p-3.5 liquid:p-4">` |
| `practice-page.tsx:126` | Textarea `className="mt-1.5 min-h-[96px] resize-none rounded-button border-0 bg-surface-2 …"` | append `${LQ_FIELD_MULTI}` inside the string via template: change `className="…"` to ``className={`… ${LQ_FIELD_MULTI}`}`` |
| `practice-page.tsx:140` | ``className={`${BUTTON} border-[0.5px] border-hair bg-surface text-ink active:bg-surface-2`}`` | ``className={`${BUTTON} border-[0.5px] border-hair bg-surface text-ink active:bg-surface-2 ${LQ_SECONDARY}`}`` |
| `practice-page.tsx:149` | ``className={`${BUTTON} bg-blue text-on-blue active:bg-blue/90`}>`` | ``className={`${BUTTON} bg-blue text-on-blue active:bg-blue/90 ${LQ_PRIMARY}`}>`` |
| `practice-page.tsx:156` | `<div className="mt-3 space-y-2 rounded-button bg-surface-2 p-3 text-sub">` | ``<div className={`mt-3 space-y-2 rounded-button bg-surface-2 p-3 text-sub ${LQ_NOTE}`}>`` |
| `practice-page.tsx:169` (after the wrapper `</div>`) | — | `        {liquid && <RecentScores />}` and in the component body after `const today = useToday(i18n.language);` add `  const liquid = useLiquid();` |
| `history-page.tsx` imports | `import { scoreToneClass } from "~/components/score-tone";` | + `import { ScoreDot } from "~/components/score-dot";` + `import { LQ_INK, LQ_PAGE } from "~/components/liquid";` |
| `history-page.tsx` | `      <div className="px-gutter pb-6 pt-2">` | ``      <div className={`px-gutter pb-6 pt-2 ${LQ_PAGE}`}>`` |
| `history-page.tsx` | ``<span className={`num w-10 flex-none text-center text-headline font-semibold tracking-tightest ${scored ? scoreToneClass(score) : "text-ink-2"}`}>`` | ``<span className={`num flex w-12 flex-none items-center justify-center gap-1 text-headline font-semibold tracking-tightest ${scored ? scoreToneClass(score) : "text-ink-2"} ${LQ_INK}`}>`` and inside, after `{scored ? Math.round(score) : "—"}` add `{scored ? <ScoreDot score={score} /> : null}` |
| `history-page.tsx` Link row | `className="flex min-h-row items-center gap-3 py-2.5 pl-3.5 pr-3 transition-colors duration-fast active:bg-surface-2 …"` | insert ` liquid:active:bg-wash liquid:px-4` after `active:bg-surface-2` |
| `practice-list-page.tsx` | `      <div className="px-gutter pb-6 pt-2">` | ``      <div className={`px-gutter pb-6 pt-2 ${LQ_PAGE}`}>`` (+ import `LQ_DIALOG, LQ_DANGER_TEXT, LQ_PAGE, LQ_SECONDARY`) |
| `practice-list-page.tsx:137` row | `… active:bg-surface-2 …` | insert ` liquid:active:bg-wash liquid:pl-4` after `active:bg-surface-2` |
| `practice-list-page.tsx` | `<AlertDialogContent` (Read the line) | add `className={LQ_DIALOG}` (or append to an existing className) |
| `practice-list-page.tsx:164` | `<AlertDialogCancel className="h-11" disabled={deleting}>` | ``<AlertDialogCancel className={`h-11 ${LQ_SECONDARY}`} disabled={deleting}>`` |
| `practice-list-page.tsx:165` | `<AlertDialogAction data-testid="practice-item-delete-confirm" className="h-11" disabled={deleting}` | ``<AlertDialogAction data-testid="practice-item-delete-confirm" className={`h-11 ${LQ_DANGER_TEXT}`} disabled={deleting}`` |
| `assessment-page.tsx` | `        <div className="space-y-2 px-gutter pb-6 pt-2">` | ``        <div className={`space-y-2 px-gutter pb-6 pt-2 ${LQ_PAGE} liquid:space-y-4`}>`` (+ import `LQ_DIALOG, LQ_DANGER_TEXT, LQ_PAGE, LQ_PRIMARY, LQ_SECONDARY`) |
| `assessment-page.tsx:81` | `          <SurfaceCard className="p-3.5">` (first) | `          <SurfaceCard strong className="p-3.5">` |
| `assessment-page.tsx:106` | `<Button data-testid="assessment-again" className="!mt-4 h-12 w-full rounded-button text-[15px] font-semibold"` | ``<Button data-testid="assessment-again" className={`!mt-4 h-12 w-full rounded-button text-[15px] font-semibold ${LQ_PRIMARY}`}`` |
| `assessment-page.tsx` AlertDialog | `<AlertDialogContent …>`, `:119` Cancel `className="h-11"`, `:120` Action `className="h-11"` | Content `LQ_DIALOG`; Cancel ``className={`h-11 ${LQ_SECONDARY}`}``; Action ``className={`h-11 ${LQ_DANGER_TEXT}`}`` |
| `mobile-score-result.tsx:5-7` | `STROKE`, `FILL`, `TEXT` maps | leave the maps; append in use sites: ring circle `className={STROKE[tone]}` → ``className={`${STROKE[tone]} liquid:stroke-ink`}``; track `className="stroke-surface-2"` → `className="stroke-surface-2 liquid:stroke-wash-2"`; number span → add ` liquid:text-ink`; bar label score span → add ` liquid:text-ink`; bar track `bg-surface-2` → add ` liquid:bg-wash-2`; bar fill ``${FILL[bt]}`` → ``${FILL[bt]} liquid:bg-ink/85``; legend `<i className="h-2.5 w-2.5 rounded-sm …">` ×3 → add ` liquid:size-1.5 liquid:rounded-full` |

`tailwind`: `stroke-wash-2` works because `wash.2` is a colour token (L0); if Tailwind does not generate `stroke-*` for
`var()` colours, use `liquid:[stroke:var(--ink-wash-2)]` instead.

## Rulings specific to L4

- **R-L4-1** Hero first under liquid via CSS order (no duplicate DOM); classic order unchanged.
- **R-L4-2** `RecentScores` shows at most 3 latest assessments as wells; hidden when empty or on error; only mounted under
  liquid (classic tests see no new request).
- **R-L4-3** The accent is used once on the home screen: 开始朗读. 先听范读 is a secondary pill; the list icon is a well circle.
- **R-L4-4** Scores: number in ink + `ScoreDot`; the classic colour classes stay for the classic skin.

---

## Task L4-1: `RecentScores` panel

**Files:** Create `web/src/features/practice/recent-scores.tsx`, `web/src/features/practice/recent-scores.test.tsx`;
Modify `web/src/features/practice/i18n/zh-CN.json`, `en.json`.

- [ ] **Step 1:** i18n: in `zh-CN.json` single line `      "home": { "shadowing": "跟读", "more": "记录" },` →
  `      "home": { "shadowing": "跟读", "more": "记录", "recent": "最近评分", "all": "全部" },`; in `en.json` the matching
  `"home"` line (Read it) gains `"recent": "Recent scores", "all": "All"`.
- [ ] **Step 2 (test):** Write `web/src/features/practice/recent-scores.test.tsx`:
```tsx
import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { setLiquid } from "~/test/glass";
import { renderWithProviders } from "~/test/render";
import { RecentScores } from "./recent-scores";

const item = (id: string, score: number | null, createdAt: string) => ({
  id, reference_text: "Hi", language: "en-US", duration_ms: 1000, created_at: createdAt,
  scores: score === null ? {} : { pronunciation_score: score },
});

describe("RecentScores (plan 2026-10-15-liquid-glass L4)", () => {
  afterEach(() => setLiquid(false));

  it("shows up to three wells with ink numbers and score dots, linking to each result", async () => {
    setLiquid(true);
    const mock = createFetchMock({
      "GET /api/assessments": () => json({ assessments: [item("a", 92, "2026-10-15T08:00:00Z"), item("b", 78, "2026-10-14T08:00:00Z"), item("c", 64, "2026-10-13T08:00:00Z")], next: null }),
    });
    renderWithProviders(<RecentScores />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    const wells = await screen.findAllByTestId("recent-score");
    expect(wells).toHaveLength(3);
    expect(wells[0]).toHaveAttribute("href", "/practice/assessments/a");
    expect(wells[0].textContent).toContain("92");
    expect(wells[0].querySelector("[data-score-dot]")!.className).toContain("bg-green");
    expect(wells[2].querySelector("[data-score-dot]")).toBeNull();
    expect(mock.calls[0].url.searchParams.get("per_page")).toBe("3");
  });

  it("renders nothing when there are no results or the request fails", async () => {
    setLiquid(true);
    const mock = createFetchMock({ "GET /api/assessments": () => json({ assessments: [], next: null }) });
    const { container } = renderWithProviders(<RecentScores />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    await waitFor(() => expect(mock.calls).toHaveLength(1));
    expect(container.querySelector("[data-testid=recent-score]")).toBeNull();
  });
});
```
  (If `camelcase-keys` is not applied by `api.request`, use camelCase keys in the fixture — check `assessment-api.test.ts`.)
- [ ] **Step 3:** Write `web/src/features/practice/recent-scores.tsx`:
```tsx
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuth } from "~/auth/auth-context";
import { LQ_WELL } from "~/components/liquid";
import { ScoreDot } from "~/components/score-dot";
import { SectionGroup } from "~/components/section-group";
import { cn } from "~/lib/cn";
import { listAssessments, type AssessmentSummary } from "./assessment-api";

/**
 * 练习首页「最近评分」(设计稿 practice() 的 .wells):最近 3 次评测,数字墨色 + 6px 分数点,点进结果页。
 * 只在液态皮肤下挂载(计划 2026-10-15-liquid-glass R-L4-2);没有结果或请求失败时不显示。
 */
export function RecentScores() {
  const { api } = useAuth();
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<AssessmentSummary[] | null>(null);
  useEffect(() => {
    let alive = true;
    listAssessments(api, 1, 3).then(
      (res) => { if (alive) setItems(res.assessments.slice(0, 3)); },
      () => { if (alive) setItems([]); },
    );
    return () => { alive = false; };
  }, [api]);
  if (!items?.length) return null;
  const day = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(i18n.language, { month: "numeric", day: "numeric" });
  };
  return (
    <SectionGroup title={t("web.practice.home.recent")}
      action={<Link to="/practice/history" className="tap-link text-sub font-semibold text-blue">{t("web.practice.home.all")} ›</Link>}>
      <div className="grid grid-cols-3 gap-2.5 px-4 pb-3 pt-1">
        {items.map((a) => {
          const score = a.scores?.pronunciationScore;
          const scored = typeof score === "number" && Number.isFinite(score);
          return (
            <Link key={a.id} to={`/practice/assessments/${a.id}`} data-testid="recent-score" className={cn("block px-3 py-2.5", LQ_WELL)}>
              <b className="num block text-headline font-bold tracking-tightest text-ink">{scored ? Math.round(score) : "—"}</b>
              <span className="flex items-center gap-1.5 text-meta text-ink-2">{scored ? <ScoreDot score={score} /> : null}{day(a.createdAt)}</span>
            </Link>
          );
        })}
      </div>
    </SectionGroup>
  );
}
```
- [ ] **Step 4:** Run `cd web && yarn vitest run src/features/practice/recent-scores.test.tsx src/i18n/i18n.test.ts src/architecture.test.ts` — green.
- [ ] **Step 5:** Commit `feat(web): recent scores panel for the liquid practice home`.

---

## Task L4-2: practice home edits + liquid test

**Files:** Modify `web/src/features/practice/practice-page.tsx`, `web/src/features/practice/practice-page.test.tsx`.

- [ ] **Step 1 (test):** Append to `practice-page.test.tsx` (reuse its `setup(routes)` helper; Read the file first):
```tsx
import { blurLayers, setLiquid } from "~/test/glass";

describe("practice home in the liquid skin (plan 2026-10-15-liquid-glass L4)", () => {
  afterEach(() => setLiquid(false));

  it("large title, studio hero first, one accent pill, recent scores, no own blur", async () => {
    setLiquid(true);
    setup({
      "GET /api/wordbook/config": () => json({ enabled: false }),
      "GET /api/assessments": () => json({ assessments: [], next: null }),
    });
    expect(await screen.findByRole("heading", { level: 1, name: /练习|Practice/ })).toHaveClass("text-large");
    const hero = screen.getByTestId("reference-input").closest(".mat-surface-strong")!;
    expect(hero).not.toBeNull();
    expect(hero.parentElement!.closest(".liquid\\:order-first")).not.toBeNull();
    expect(screen.getByTestId("record-toggle").className).toContain("liquid:shadow-accent");
    expect(screen.getByTestId("practice-listen").className).toContain("liquid:bg-wash");
    expect(blurLayers(document.body).length).toBeLessThanOrEqual(2);
  });
});
```
  (If `setup` requires the default routes object, pass them as the existing tests do; if `afterEach`/`screen` are not yet
  imported in the file, add them to the existing vitest/testing-library import lines.)
- [ ] **Step 2:** Apply the `practice-page.tsx` rows of the per-file table above.
- [ ] **Step 3:** Run `cd web && yarn vitest run src/features/practice/practice-page.test.tsx src/architecture.test.ts` — green (classic tests unchanged).
- [ ] **Step 4:** Commit `feat(web): liquid practice home`.

---

## Task L4-3: history, list, assessment, score result

**Files:** Modify `history-page.tsx`, `practice-list-page.tsx`, `assessment-page.tsx`, `mobile-score-result.tsx`,
`history-page.test.tsx`.

- [ ] **Step 1 (test):** Append to `history-page.test.tsx` (reuse its fetch setup):
```tsx
  it("liquid: score in ink with a dot (plan 2026-10-15-liquid-glass R-L4-4)", async () => {
    setLiquid(true);
    // render exactly like the existing "lists assessments" case, then:
    const row = (await screen.findAllByTestId("assessment-item"))[0];
    expect(row.querySelector(".num")!.className).toContain("liquid:text-ink");
    setLiquid(false);
  });
```
  (Import `setLiquid` from `~/test/glass`; copy the existing render call of the first list test into the new case.)
- [ ] **Step 2:** Apply the table rows for `history-page.tsx`, `practice-list-page.tsx`, `assessment-page.tsx`, `mobile-score-result.tsx`.
- [ ] **Step 3:** Run `cd web && yarn vitest run src/features/practice src/architecture.test.ts` — green.
- [ ] **Step 4:** Commit `feat(web): liquid practice history, list and results`.

---

## Task L4-4: docs

- [ ] `web/src/features/practice/CLAUDE.md`: add `- Liquid glass (plan 2026-10-15-liquid-glass L4): home = large title + studio hero first (CSS order) + RecentScores (liquid only); scores ink + ScoreDot. shadow/ is locked.`
- [ ] Commit `docs(web): practice liquid notes`.

## Device checklist (UNVERIFIED)

- [ ] Textarea well with radius 20 keeps the iOS 16px font rule (no zoom on focus).
- [ ] Recording state: the accent pill shows the stop icon; the timer stays ink-2 on the panel.
