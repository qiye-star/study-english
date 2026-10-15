# Liquid glass · L4 results (2026-10-15)

Branch `feat/lg-l4`. Plan: `2026-10-15-liquid-glass-l4-practice.md`. Targeted tests only.

## Deviations (plan vs reality)

1. `practice-page.test.tsx` liquid case: the page title in English is "Read aloud", not "Practice", so the heading query is
   `/练习|Read aloud/`. The `.liquid\:order-first` selector needs a doubled backslash in the TS string.
2. `RecentScores` placed after the hero wrapper and before the 记录 group (plan said "after the wrapper"); with
   `liquid:flex-col` the hero is first via `liquid:order-first`.
3. The plan's `ScoreDot` row in `history-page.tsx` is inserted on its own line after the score text; the number span also
   gets `flex … gap-1` (needed for the dot) and `w-12` as the plan says.
4. `assessment-page.tsx`: two cards share `className="p-3.5"`; the first (reference text) was matched via its following line.
5. Files written/edited keep CRLF; i18n JSON stays LF (as in the tree).

## Verification

- `src/features/practice src/architecture.test.ts`: 18 files / 171 passed (new: 2 recent-scores, 1 home, 1 history).
- `yarn web:typecheck`: clean.

## UNVERIFIED

- No browser run: `liquid:order-first` ordering vs RankCard/WordbookCard/Slot, `stroke-wash-2` generation (not asserted),
  textarea well radius and iOS 16px font, recording state look.
- Today panel not built (D-8, owner answer).
