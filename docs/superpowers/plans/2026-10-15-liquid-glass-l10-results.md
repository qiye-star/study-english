# Liquid glass · L10 results (2026-10-15)

Branch `feat/lg-l10`. Plan: `2026-10-15-liquid-glass-l10-vocab-progress-plugins.md`. Targeted tests only.

## Deviations (plan vs reality)

1. `sources-strip.tsx`: the plan's lines `:30`/`:55` are actually `:30` and `:54-55` (same `cn(CHIP, ...)` fragments); `LQ_CHIP` appended to both.
2. `weak-words-page.tsx`: the plan's `inline-flex items-center gap-1` was made liquid-only (`liquid:inline-flex liquid:items-center liquid:gap-1`) so the classic span layout is untouched.
3. `weak-words-page.test.tsx`: the plan's commented stub was filled with the existing `listing()` render; row `rural` (90, green dot) and `three` (52, no dot).
4. `score-chart.test.tsx` exists: the new cases were appended using its `day()` helper instead of the plan's `StatsDay` cast.
5. `add-vocabulary-button.tsx` (outline icon/label button, `h-11 min-w-11` kept) and `daily-tasks-card.tsx`, `word-actions/*`, `chat-words-task.tsx` were read: no tint/hue classes, nothing changed (L2 covers them).
6. Vocabulary delete AlertDialog: `LQ_DIALOG` / `LQ_SECONDARY` (cancel) / `LQ_DANGER_TEXT` (delete); `data-lookup-context` marks untouched.
7. Working copies are CRLF (index LF); edits preserved CRLF.

## Verification

- `src/features/vocabulary src/features/progress src/plugins src/lookup-marks src/components src/test src/architecture.test.ts`: 46 files / 331 passed.
- `yarn web:typecheck`: clean.

## UNVERIFIED

- No browser run: accent last point on the chart, dialog bezel, mono chips.
