# Liquid glass · L8 rank Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Read first:** `2026-10-15-liquid-glass-INDEX.md` §3, §5.4, §6; spec §2.4 rows "Rank tiers", "Achievements"; v2 `me()`
> (`.rankbar` one-row rank panel). Starts after **L2**; parallel with the other area lanes.

**Goal:** rank card = E1 panel with tier icon in ink and the accent progress bar (the one accent on the card); rank home and
match result panels; achievements mono (earned = ink icon in a well, locked = ink-3); the match conversation follows chat
(own lines graphite); buttons pills. The rank card is also shown on the practice and Me pages, so this lane's card styles
appear there.

**Architecture:** additive classes only (R-LG1); `ui.ts` constants carry the liquid tokens for every rank screen.

## Global Constraints

- Owned files: `web/src/features/rank/**` (INDEX §9).
- Assertions to respect: `match-page.test.tsx:192` (`text-green` present), `:204` and `achievements-page.test.tsx`
  (`innerHTML` must not match `/text-red|bg-red/`) — never add `liquid:text-red` / `liquid:bg-red*` in rank;
  `achievements-page.test.tsx:43-62` (`text-amber`, `text-ink`, `text-ink-3`, `bg-teal-tint`, `lucide-library-big`) stay true (additive).
- Worktree `.claude/worktrees/lg-l8`, branch `feat/lg-l8`, junctioned `node_modules`. CRLF: single-line anchors.
- Tests per task: listed files + `src/architecture.test.ts`; lane end: `cd web && yarn vitest run src/features/rank` + `yarn web:typecheck`.
- Commits `feat(web): …`, one per task, own `Co-Authored-By:` line.

## Per-file edits

| File:line | Current fragment | Append / change |
|---|---|---|
| `ui.ts:9` | `export const PRIMARY_BUTTON = cn(BASE, "bg-blue text-on-blue active:opacity-90");` | `export const PRIMARY_BUTTON = cn(BASE, "bg-blue text-on-blue active:opacity-90", LQ_PRIMARY);` |
| `ui.ts:10` | `export const GHOST_BUTTON = cn(BASE, "border-[0.5px] border-hair bg-surface text-ink active:bg-surface-2");` | `…, LQ_SECONDARY);` |
| `ui.ts:12` | `export const CARD = "rounded-card border-[0.5px] border-hair bg-surface shadow-card dark:shadow-none";` | `export const CARD = \`rounded-card border-[0.5px] border-hair bg-surface shadow-card dark:shadow-none ${LQ_PANEL}\`;` |
| `ui.ts:14` `ICON_LINK` | first string | + ` liquid:rounded-full liquid:hover:bg-wash` |
| `ui.ts` imports | — | `import { LQ_PANEL, LQ_PRIMARY, LQ_SECONDARY } from "~/components/liquid";` |
| `rank-card.tsx` root (the `Link`, Read) | its class string (if it does not already use `CARD`) | + ` ${LQ_PANEL} liquid:px-4` |
| `rank-card.tsx:44` track | `"mt-2 block h-1.5 overflow-hidden rounded-full bg-surface-2"` | + ` ${LQ_BAR_TRACK}` |
| `rank-card.tsx:47` | `eligible ? "font-semibold text-blue" : "text-ink-2"` | unchanged (accent = act here) |
| `rank-card.tsx` tier icon (Read: the tier `Icon` element) | its class | + ` ${LQ_ICON_WELL}` if it sits in a tinted square, else ` ${LQ_INK}` |
| `rank-home-page.tsx:96` track parent | the `bg-surface-2` track around `h-full rounded-full bg-blue` | track + ` ${LQ_BAR_TRACK}` |
| `rank-home-page.tsx:123` | `<span className="font-semibold tabular-nums text-blue">+{e.points}</span>` | + ` ${LQ_INK}` |
| `achievements-page.tsx:25` `TONES` values and `:26` `TIER_TONE`, `:48` fallback | `"bg-amber-tint text-amber"`, `"bg-teal-tint text-teal"`, `"bg-green-tint text-green"`, `"bg-surface-2 text-ink"`, `"bg-blue-tint text-blue"` | each + ` ${LQ_ICON_WELL}` (convert to template literals) |
| `achievements-page.tsx` earned / locked icon classes (Read; the test lines 43-62 show which elements carry `text-amber` / `text-ink-3`) | earned icon | + ` liquid:text-ink`; locked stays `text-ink-3` |
| `match-page.tsx:106` | `"max-w-[88%] self-end break-words rounded-card rounded-tr-inline bg-blue-tint px-3 py-2.5 text-body leading-dialogue text-ink"` | + ` liquid:rounded-tile liquid:rounded-tr-tail liquid:bg-graphite liquid:text-on-graphite` |
| `match-page.tsx` partner line container (Read: the sibling branch above line 100) | its card class | + ` ${LQ_TILE} liquid:rounded-tl-tail` |
| `match-page.tsx` ToneBadge / IconChip usages | — | nothing (L2 mono) |
| `match-result.tsx:57` | `verdict.passed ? "text-green" : "text-ink"` | `verdict.passed ? "text-green liquid:text-ink" : "text-ink"` and render a 16px `CheckIcon` (`text-green`, `aria-hidden`, `hidden liquid:inline`) before the verdict text when passed |
| `match-result.tsx:83` | `<span className="block h-full rounded-full bg-blue" …` | unchanged; its track (Read) + ` ${LQ_BAR_TRACK}` |
| `stage-tasks.tsx:24` | `task.complete ? "bg-blue text-on-blue" : "bg-surface-2…"` | `task.complete ? "bg-blue text-on-blue ${LQ_CHIP_ON}" : "bg-surface-2 … ${LQ_ICON_WELL}"` |
| `register-daily-tasks.tsx:58` | green check | unchanged |
| page wrappers (`rank-home-page.tsx`, `achievements-page.tsx`, `match-page.tsx`) | `px-gutter` | + ` ${LQ_PAGE}` |

---

## Task L8-1: rank constants, card, home, achievements, match

- [ ] **Step 1 (test):** Append to `rank-card.test.tsx` (or the nearest test rendering `RankCard`; Read):
```tsx
import { setLiquid } from "~/test/glass";
  it("liquid: E1 panel with the accent progress bar on a wash track (plan 2026-10-15-liquid-glass L8)", async () => {
    setLiquid(true);
    // render RankCard exactly like the first existing test, then:
    const bar = await screen.findByRole("progressbar");
    expect(bar.className).toContain("liquid:bg-wash-2");
    expect(bar.closest("a")!.className).toContain("mat-surface");
    setLiquid(false);
  });
```
  and to `achievements-page.test.tsx` one case asserting an earned tile carries `liquid:bg-wash` and its `innerHTML` still
  does not match `/text-red|bg-red/`.
- [ ] **Step 2:** Apply all rows.
- [ ] **Step 3:** Run `cd web && yarn vitest run src/features/rank src/architecture.test.ts` — green.
- [ ] **Step 4:** Commit `feat(web): liquid rank card, results and achievements`.

## Task L8-2: docs

- [ ] `web/src/features/rank/CLAUDE.md` (or the feature's notes file if none): "Liquid glass (plan 2026-10-15-liquid-glass L8): `ui.ts` constants carry the liquid tokens; achievements mono; the progress bar is the only accent on the card."
- [ ] Commit `docs(web): rank liquid notes`.

## Device checklist (UNVERIFIED)

- [ ] Rank card on the practice page next to the studio hero: only one filled accent pill on that screen (the bar is not a pill).
