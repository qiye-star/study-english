# Liquid glass · L8 results (2026-10-15)

Branch `feat/lg-l8`. Plan: `2026-10-15-liquid-glass-l8-rank.md`. Targeted tests only.

## Deviations (plan vs reality)

1. All plan anchors matched; no frozen name or ruling changed. Edits were applied with a script (exact single-line anchors, CRLF kept).
2. Tier icon: `TierBadge` disc (round, `bg-surface-2`) got `LQ_ICON_WELL`; the plan said "Read" for the element.
3. `rank-card.tsx` root already had its own card classes (not `CARD`): appended `LQ_PANEL` + `liquid:px-4` through `cn`.
4. Extra (same mapping table): `LQ_PAGE` on the rank result wrapper; `LQ_TILE` on achievement cells; `LQ_BAR_TRACK` on result dimension tracks;
   locked achievement icon uses `cn("bg-surface-2 text-ink-3", LQ_ICON_WELL, "liquid:text-ink-3")` so it stays ink-3.
5. `match-result.tsx` verdict `h2` became `inline-flex` (to place the liquid-only `CheckIcon`, `hidden liquid:inline`) — a layout-neutral change in classic.
6. Tests added with `setLiquid(true)` in try/finally: `rank-card.test.tsx` and `achievements-page.test.tsx`.

## Verification

- `src/features/rank src/components src/test src/architecture.test.ts`: 25 files / 220 passed. `yarn web:typecheck`: clean.

## UNVERIFIED

- No browser run: rank card on practice/Me next to the studio hero (one accent pill), `CheckIcon` alignment in the liquid verdict heading.
