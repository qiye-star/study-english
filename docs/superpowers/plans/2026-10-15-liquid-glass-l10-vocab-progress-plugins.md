# Liquid glass · L10 vocabulary + progress + plugins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Read first:** `2026-10-15-liquid-glass-INDEX.md` §3, §5.4, §6; spec §2.4 rows "Charts", "Teal". Starts after **L2**;
> parallel with the other area lanes. Small lane: most of it already changes through `SurfaceCard`, `SectionGroup`,
> `IconChip`, `ToneBadge`, `StatTile`, `LIST_CARD` (L2).

**Goal:** vocabulary review card and list without teal (speak keys = mono wells), progress chart in ink with the **latest
point in accent** (the one accent use on the screen), stat wells via L2; plugins (learning links: chat-words, mistakes,
pron-shadow, links settings, daily tasks, word actions) mono chips, ink marks, score dots.

**Architecture:** additive classes (R-LG1); one small SVG change in `score-chart.tsx` (an extra accent point element,
`hidden` in classic and shown + coloured under liquid, so classic looks identical).

## Global Constraints

- Owned files: `web/src/features/vocabulary/**`, `web/src/features/progress/**`, `web/src/plugins/**` (INDEX §9).
  `plugins/` is only imported by `main.tsx` — no new import of `plugins/` anywhere.
- Assertions to respect: `plugins/mistakes/mistakes-page.test.tsx:100` (`querySelectorAll(".bg-teal")` length 2 — additive
  keeps the plain class), `plugins/chat-words/chat-words.test.tsx:78` (`.bg-teal-tint.text-teal`), `plugins/pron-shadow/weak-words-page.test.tsx:39-41`
  (`text-ink-2` / `text-amber` / `text-green`), `vocabulary/add-vocabulary-button.test.tsx:26` (`h-11`, `min-w-11`).
- Worktree `.claude/worktrees/lg-l10`, branch `feat/lg-l10`, junctioned `node_modules`. CRLF: single-line anchors.
- Tests per task: listed files + `src/architecture.test.ts`; lane end: `cd web && yarn vitest run src/features/vocabulary src/features/progress src/plugins` + `yarn web:typecheck`.
- Commits `feat(web): …`, one per task, own `Co-Authored-By:` line.

## Per-file edits

| File:line | Current fragment | Append / change |
|---|---|---|
| `vocabulary/review-card.tsx:36` | `"flex h-tap w-tap flex-none items-center justify-center rounded-full bg-teal-tint text-teal transition-colors …"` | + ` ${LQ_ICON_WELL}` (template) |
| `vocabulary/vocabulary-page.tsx:258` | `… -11 w-11 items-center justify-center rounded-full bg-teal-tint text-teal" aria-hidden>` | + ` ${LQ_ICON_WELL}` |
| `vocabulary/vocabulary-page.tsx` page wrapper | `px-gutter` | + ` ${LQ_PAGE}` |
| `vocabulary/vocabulary-page.tsx` AlertDialog (Read) | Content / Cancel / Action | `LQ_DIALOG` / `LQ_SECONDARY` / `LQ_DANGER_TEXT` |
| `vocabulary/vocabulary-page.tsx:303` | load-more `text-blue` | unchanged |
| `vocabulary/add-vocabulary-button.tsx` (Read) | its button class | + ` liquid:rounded-full` only if it is a filled/tinted button; keep `h-11 min-w-11` |
| `progress/score-chart.tsx:42` | `className="h-32 w-full text-blue" preserveAspectRatio="none">` | `className="h-32 w-full text-blue liquid:text-ink" preserveAspectRatio="none">` |
| `progress/score-chart.tsx` points map | `{segments.flat().map((p, i) => (` block | after that block add the accent last point: `{(() => { const last = segments.flat().at(-1); return last ? <line data-testid="progress-chart-last" x1={last.x} y1={last.y} x2={last.x} y2={last.y} stroke="currentColor" strokeWidth={8} strokeLinecap="round" vectorEffect="non-scaling-stroke" className="hidden liquid:inline liquid:text-blue" /> : null; })()}` (hidden in classic → classic pixels unchanged) |
| `progress/score-chart.tsx` guides | `className="stroke-ink-3/40"` | unchanged (spec: guides ink-3/30–40) |
| `progress/progress-page.tsx` page wrapper / lists | `px-gutter`; any `LIST_CARD`/`SectionGroup` | + ` ${LQ_PAGE}`; lists change via L2 |
| `plugins/mistakes/mistakes-page.tsx:39` | `cn("size-1.5 rounded-full", i <= box ? "bg-teal" : "bg-hair")` | `cn("size-1.5 rounded-full", i <= box ? "bg-teal liquid:bg-ink/85" : "bg-hair")` |
| `plugins/pron-shadow/sources-strip.tsx:30`, `:55` | `cn(CHIP, "bg-amber-tint text-amber")`, `cn(CHIP, "bg-teal-tint text-teal")` | each + `, LQ_CHIP` |
| `plugins/pron-shadow/today-words-sheet.tsx:25` | `className="text-body font-semibold text-teal"` | + ` ${LQ_INK}` |
| `plugins/pron-shadow/weak-words-page.tsx:96` | `<span className={scoreToneClass(item.lastScore)}>{t("web.links.pron.score", …)}</span>` | `<span className={cn(scoreToneClass(item.lastScore), LQ_INK, "inline-flex items-center gap-1")}><ScoreDot score={item.lastScore} />{t("web.links.pron.score", …)}</span>` (import `cn`, `ScoreDot`, `LQ_INK`) |
| `plugins/links/links-settings-page.tsx:87` | `item.effective ? "bg-blue" : "bg-surface-2 shadow-hair"` | `item.effective ? "bg-blue" : "bg-surface-2 shadow-hair liquid:bg-wash-2"` |
| `plugins/**` pages with `px-gutter` (`mistakes-page`, `weak-words-page`, `links-settings-page`) | wrapper | + ` ${LQ_PAGE}` |
| `plugins/daily-tasks/daily-tasks-card.tsx` (Read) | it uses `SurfaceCard` | nothing (L2) unless it has tint classes — apply §6 mapping if so |
| `plugins/word-actions/*` (Read) | sheets / buttons | buttons: `LQ_PRIMARY` / `LQ_SECONDARY` per §6; sheets via L2 |
| `plugins/chat-words/chat-words-task.tsx:29` | `text-green` check | unchanged |

---

## Task L10-1: vocabulary + progress

- [ ] **Step 1 (test):** Append to `progress/score-chart.test.tsx` (create if missing):
```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScoreChart } from "./score-chart";

describe("ScoreChart (plan 2026-10-15-liquid-glass L10)", () => {
  it("ink line with an accent last point under liquid; classic colours unchanged", () => {
    const daily = [
      { date: "2026-10-13", avgPronunciation: 70 }, { date: "2026-10-14", avgPronunciation: 80 }, { date: "2026-10-15", avgPronunciation: 90 },
    ] as never;
    render(<ScoreChart daily={daily} label="chart" />);
    expect(screen.getByTestId("progress-chart").getAttribute("class")).toContain("liquid:text-ink");
    expect(screen.getByTestId("progress-chart-last").getAttribute("class")).toContain("liquid:text-blue");
  });
});
```
  (Match the real `StatsDay` field names from `progress-api`/`stats` types; Read `score-chart.tsx`'s `chartSegments` input.)
- [ ] **Step 2:** Apply the vocabulary and progress rows.
- [ ] **Step 3:** Run `cd web && yarn vitest run src/features/vocabulary src/features/progress src/architecture.test.ts` — green.
- [ ] **Step 4:** Commit `feat(web): liquid vocabulary and progress`.

## Task L10-2: plugins

- [ ] **Step 1 (test):** Append to `plugins/pron-shadow/weak-words-page.test.tsx`:
```tsx
  it("liquid: last score in ink with a dot (plan 2026-10-15-liquid-glass L10)", async () => {
    // render like the existing score-tone test, then on the 92-point row:
    // expect(row.querySelector("[data-score-dot]")!.className).toContain("bg-green");
    // expect(row.querySelector(".liquid\\:text-ink")).not.toBeNull();
  });
```
  (Fill in with the existing test's render and row lookup; keep the three existing class assertions.)
- [ ] **Step 2:** Apply the plugins rows.
- [ ] **Step 3:** Run `cd web && yarn vitest run src/plugins src/architecture.test.ts` — green.
- [ ] **Step 4:** Commit `feat(web): liquid learning-links plugins`.

## Task L10-3: docs

- [ ] Add one "Liquid glass" bullet to `web/src/plugins/CLAUDE.md` ("plugin UI follows the shared `LQ_*` mapping; no tints") and to the vocabulary/progress notes if they exist.
- [ ] Commit `docs(web): liquid notes for vocabulary, progress and plugins`.

## Device checklist (UNVERIFIED)

- [ ] Progress chart: the accent last point is the only accent on the progress page.
